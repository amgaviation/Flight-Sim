/**
 * Map symbol drawing: airports, runways, navaids, fixes, waypoints, TCAS
 * traffic, own-ship. All functions draw at a screen position (logical px)
 * and allocate nothing.
 *
 * Symbology sources:
 *  - TCAS traffic: RTCA DO-185B / FAA AC 20-151C traffic display symbols:
 *    other traffic = hollow diamond, proximate = filled diamond, traffic
 *    advisory = filled amber circle, resolution advisory = filled red square;
 *    relative altitude in hundreds of feet (+ above / - below) placed above
 *    the symbol for traffic above and below it for traffic below; vertical
 *    trend arrow when climbing/descending at >= 500 fpm.
 *  - Navaid shapes (hexagon VOR, VOR/DME box, VORTAC lobes, NDB dotted
 *    circle, triangle fix) follow FAA Aeronautical Chart User's Guide symbols
 *    used by Garmin/Honeywell/Collins MFDs; Boeing ND symbols (cyan/green
 *    circles, stars) per 737NG FCOM 10.20 map legend (EST sizes).
 */
import { DEG2RAD } from '../../../core/math';
import type { Typeface } from '../fonts';
import type { AvionicsPalette } from '../palette';
import { circle, fillStroke, type Ctx2D } from './context';

export type SymbolStyle = 'garmin' | 'boeing' | 'honeywell';

/** Airport symbol with the longest runway's orientation (screen angle rad, clockwise from up). */
export function drawAirportSymbol(ctx: Ctx2D, x: number, y: number, runwayAngle: number, kind: 'towered' | 'untowered' | 'soft' | 'private', style: SymbolStyle, p: AvionicsPalette, size = 8): void {
  if (style === 'boeing') {
    circle(ctx, x, y, size, '', p.cyan, 2);
    return;
  }
  // Garmin: towered blue, non-towered magenta, soft-surface hollow circle.
  const color = kind === 'towered' ? '#3a7bff' : kind === 'untowered' ? p.magenta : kind === 'private' ? p.grey : p.magenta;
  if (kind === 'soft') {
    circle(ctx, x, y, size, '', color, 2);
  } else {
    circle(ctx, x, y, size, color, p.black, 1);
    if (Number.isFinite(runwayAngle)) {
      const s = Math.sin(runwayAngle) * (size + 3);
      const c = Math.cos(runwayAngle) * (size + 3);
      ctx.beginPath();
      ctx.moveTo(x - s, y + c);
      ctx.lineTo(x + s, y - c);
      ctx.strokeStyle = p.white;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

/** Runway as a scaled rectangle between its two threshold points (screen coords). */
export function drawRunway(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, widthPx: number, color: string, outline: string): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const w = Math.max(2, widthPx) / 2;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  ctx.beginPath();
  ctx.moveTo(x0 + nx, y0 + ny);
  ctx.lineTo(x1 + nx, y1 + ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.lineTo(x0 - nx, y0 - ny);
  ctx.closePath();
  fillStroke(ctx, color, outline, 1);
}

export type NavaidSymbolKind = 'VOR' | 'VORDME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' | 'FIX' | 'WPT';

/** Navaid / fix symbol. `color` '' = style default. */
export function drawNavaidSymbol(ctx: Ctx2D, x: number, y: number, kind: NavaidSymbolKind, style: SymbolStyle, p: AvionicsPalette, size = 8, color = ''): void {
  const c = color || (style === 'boeing' ? p.cyan : kind === 'NDB' ? '#c08040' : kind === 'FIX' || kind === 'WPT' ? p.white : p.cyan);
  if (style === 'boeing') {
    if (kind === 'FIX' || kind === 'WPT') {
      // 4-point star.
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = i % 2 === 0 ? size : size * 0.3;
        const px = x + r * Math.sin(a);
        const py = y - r * Math.cos(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      fillStroke(ctx, '', c, 1.5);
    } else if (kind === 'NDB') {
      circle(ctx, x, y, size * 0.8, '', c, 1.5);
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      fillStroke(ctx, '', c, 1.5);
    } else {
      circle(ctx, x, y, size * 0.8, '', c, 2);
    }
    return;
  }
  switch (kind) {
    case 'FIX':
    case 'WPT': {
      ctx.beginPath();
      ctx.moveTo(x, y - size * 0.8);
      ctx.lineTo(x + size * 0.7, y + size * 0.5);
      ctx.lineTo(x - size * 0.7, y + size * 0.5);
      ctx.closePath();
      fillStroke(ctx, kind === 'WPT' ? c : '', c, 1.5);
      break;
    }
    case 'NDB': {
      // Dotted circle rings.
      ctx.beginPath();
      for (let ring = 1; ring <= 2; ring++) {
        const r = size * 0.45 * ring;
        const nDots = 6 * ring;
        for (let i = 0; i < nDots; i++) {
          const a = (i / nDots) * Math.PI * 2;
          const px = x + r * Math.cos(a);
          const py = y + r * Math.sin(a);
          ctx.moveTo(px + 1.2, py);
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        }
      }
      ctx.moveTo(x + 2, y);
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      break;
    }
    case 'DME': {
      ctx.beginPath();
      ctx.rect(x - size * 0.7, y - size * 0.6, size * 1.4, size * 1.2);
      fillStroke(ctx, '', c, 1.5);
      break;
    }
    default: {
      // VOR hexagon (+ DME box / TACAN lobes).
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 6;
        const px = x + size * 0.6 * Math.cos(a);
        const py = y + size * 0.6 * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.moveTo(x + 1.5, y);
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      if (kind === 'VORDME') ctx.rect(x - size * 0.8, y - size * 0.7, size * 1.6, size * 1.4);
      fillStroke(ctx, '', c, 1.5);
      if (kind === 'VORTAC' || kind === 'TACAN') {
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
          const lx = x + size * 0.85 * Math.cos(a);
          const ly = y + size * 0.85 * Math.sin(a);
          ctx.moveTo(lx + 3, ly);
          ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        }
        ctx.fillStyle = c;
        ctx.fill();
      }
    }
  }
}

/** TCAS threat level: 0 other, 1 proximate, 2 traffic advisory, 3 resolution advisory. */
export type TrafficLevel = 0 | 1 | 2 | 3;

const REL_ALT_TEXT: string[] = [];
for (let i = -99; i <= 99; i++) REL_ALT_TEXT.push((i >= 0 ? '+' : '-') + String(Math.abs(i)).padStart(2, '0'));

/**
 * TCAS / TIS / TAS traffic symbol with relative altitude tag (hundreds of
 * feet) and vertical trend arrow (|vs| >= 500 fpm).
 */
export function drawTrafficSymbol(ctx: Ctx2D, x: number, y: number, level: TrafficLevel, relAltFt: number, vsFpm: number, p: AvionicsPalette, typeface: Typeface, baseColor: string, size = 9): void {
  const color = level === 3 ? p.red : level === 2 ? p.amber : baseColor;
  ctx.beginPath();
  if (level === 3) {
    ctx.rect(x - size * 0.75, y - size * 0.75, size * 1.5, size * 1.5);
  } else if (level === 2) {
    ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.75, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.75, y);
    ctx.closePath();
  }
  fillStroke(ctx, level === 0 ? '' : color, color, 1.5);
  if (Number.isFinite(relAltFt)) {
    const h = Math.max(-99, Math.min(99, Math.round(relAltFt / 100)));
    const above = h >= 0;
    const ty = above ? y - size - 9 : y + size + 10;
    typeface.draw(ctx, REL_ALT_TEXT[h + 99], x, ty, 14, color, 'center', 'middle', p.black);
  }
  if (Math.abs(vsFpm) >= 500) {
    const up = vsFpm > 0;
    const ax = x + size + 7;
    ctx.beginPath();
    ctx.moveTo(ax, y + (up ? 7 : -7));
    ctx.lineTo(ax, y + (up ? -7 : 7));
    ctx.moveTo(ax - 4, y + (up ? -3 : 3));
    ctx.lineTo(ax, y + (up ? -7 : 7));
    ctx.lineTo(ax + 4, y + (up ? -3 : 3));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * Own-ship symbol at (x, y) pointing along screen angle `angle` (rad,
 * clockwise from up): Garmin white airplane, Boeing white triangle,
 * Honeywell cyan-outlined airplane.
 */
export function drawOwnship(ctx: Ctx2D, x: number, y: number, angle: number, style: SymbolStyle, p: AvionicsPalette, size = 16): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  if (style === 'boeing') {
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.6, size * 0.8);
    ctx.lineTo(-size * 0.6, size * 0.8);
    ctx.closePath();
    fillStroke(ctx, '', p.white, 2.5);
  } else {
    const s = size / 20;
    ctx.moveTo(0, -20 * s);
    ctx.lineTo(3 * s, -14 * s);
    ctx.lineTo(3 * s, -5 * s);
    ctx.lineTo(18 * s, 3 * s);
    ctx.lineTo(18 * s, 7 * s);
    ctx.lineTo(3 * s, 3 * s);
    ctx.lineTo(3 * s, 13 * s);
    ctx.lineTo(8 * s, 17 * s);
    ctx.lineTo(8 * s, 20 * s);
    ctx.lineTo(0, 17 * s);
    ctx.lineTo(-8 * s, 20 * s);
    ctx.lineTo(-8 * s, 17 * s);
    ctx.lineTo(-3 * s, 13 * s);
    ctx.lineTo(-3 * s, 3 * s);
    ctx.lineTo(-18 * s, 7 * s);
    ctx.lineTo(-18 * s, 3 * s);
    ctx.lineTo(-3 * s, -5 * s);
    ctx.lineTo(-3 * s, -14 * s);
    ctx.closePath();
    fillStroke(ctx, style === 'honeywell' ? '' : p.white, style === 'honeywell' ? p.cyan : p.black, style === 'honeywell' ? 2 : 1);
  }
  ctx.restore();
}

/** Localizer "feather": a narrow wedge from the runway threshold outbound along the approach. */
export function drawLocalizerFeather(ctx: Ctx2D, x: number, y: number, inboundScreenAngle: number, lengthPx: number, color: string): void {
  // Points outbound (opposite the inbound course).
  const a = inboundScreenAngle + Math.PI;
  const half = 3 * DEG2RAD; // EST: narrow wedge
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + lengthPx * Math.sin(a - half), y - lengthPx * Math.cos(a - half));
  ctx.lineTo(x + lengthPx * 0.93 * Math.sin(a), y - lengthPx * 0.93 * Math.cos(a));
  ctx.lineTo(x + lengthPx * Math.sin(a + half), y - lengthPx * Math.cos(a + half));
  ctx.closePath();
  fillStroke(ctx, '', color, 1.5);
}
