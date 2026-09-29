/**
 * Horizontal situation indicator: rotating compass rose (360 deg) or
 * expanded arc, heading bug, lubber/heading box, course pointer with
 * deviation bar and dot scale, TO/FROM indicator, two bearing pointers
 * (single / double line), track mark, turn-rate indicator with 6 s trend,
 * wind vector, navigation source / flight phase / XTK annunciations and an
 * optional glideslope scale beside the rose.
 *
 * Presets:
 *  - Garmin (G1000 PG 190-00494-04 §2.1 "Horizontal Situation Indicator"):
 *    heading-up rose, cardinal letters + labels every 30 deg, major ticks 10,
 *    minor 5; single-line course pointer for GPS/NAV1, double-line for NAV2;
 *    magenta (GPS) / green (NAV) CDI; cyan heading bug; magenta track
 *    diamond; cyan single/double bearing pointers inside a white ring; turn
 *    rate ticks at half/standard rate (9 / 18 deg of 6 s heading
 *    prediction) and a magenta trend vector with an arrowhead above 4 deg/s;
 *    XTK shown when a GPS CDI is pegged (two dots).
 *  - Boeing 737NG ND "EXP"/HSI: magenta heading bug, 2-dot deviation scale,
 *    course pointer, triangle aircraft symbol, 'HDG 123 MAG' box. (FCOM 10.10
 *    / 10.20; EST element sizes.)
 *  - Honeywell / Collins: EST, same element set, cyan heading bug.
 */
import { DEG2RAD, clamp, wrap180 } from '../../../core/math';
import { fmtFixed, fmtHeading, fmtInt } from '../format';
import { BOEING_TYPEFACE, COLLINS_TYPEFACE, GARMIN_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { STANDARD_RATE_DPS, deviationPx } from '../math';
import { BOEING_PALETTE, COLLINS_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { DeviationScale, GS_SCALE_GARMIN, type DeviationScaleStyle } from './DeviationScale';
import { box, circle, fillStroke, line, type Ctx2D } from './context';

export interface HsiStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  minorTickDeg: number;
  majorTickDeg: number;
  labelDeg: number;
  /** N/E/S/W letters at the cardinal points (else numbers). */
  cardinalLetters: boolean;
  /** Labels rotate with the card (radial) or stay upright. */
  labelsRadial: boolean;
  labelSize: number;
  minorTickLen: number;
  majorTickLen: number;
  /** Translucent disc behind the rose ('' = none). */
  cardBackground: string;
  headingBox: 'garmin' | 'boeing' | 'none';
  aircraftSymbol: 'garmin' | 'boeing' | 'none';
  headingBug: 'garmin' | 'boeing';
  /** Deviation dots each side of the course line. */
  cdiDots: number;
  /** Dot spacing as a fraction of the rose radius. */
  dotSpacingFrac: number;
  /** Course pointer arrow head and tail radii as fractions of the rose radius. */
  courseHeadFrac: number;
  courseInnerFrac: number;
  /** Bearing pointers are drawn between this fraction of the radius and the rim. */
  bearingInnerFrac: number;
  /** White ring separating bearing pointers from the CDI (Garmin). */
  bearingRing: boolean;
  trackMark: 'diamond' | 'line' | 'none';
  turnRate: boolean;
  /** Turn-rate prediction time (s): G1000 6 s. */
  turnRateSeconds: number;
  lineWidth: number;
}

export const HSI_GARMIN: HsiStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  minorTickDeg: 5,
  majorTickDeg: 10,
  labelDeg: 30,
  cardinalLetters: true,
  labelsRadial: true,
  labelSize: 22,
  minorTickLen: 10,
  majorTickLen: 18,
  cardBackground: 'rgba(30,30,34,0.6)',
  headingBox: 'garmin',
  aircraftSymbol: 'garmin',
  headingBug: 'garmin',
  cdiDots: 2,
  dotSpacingFrac: 0.2,
  courseHeadFrac: 0.82,
  courseInnerFrac: 0.3,
  bearingInnerFrac: 0.5,
  bearingRing: true,
  trackMark: 'diamond',
  turnRate: true,
  turnRateSeconds: 6,
  lineWidth: 2,
};

export const HSI_BOEING: HsiStyle = {
  ...HSI_GARMIN,
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  cardinalLetters: false,
  labelSize: 20,
  cardBackground: '',
  headingBox: 'boeing',
  aircraftSymbol: 'boeing',
  headingBug: 'boeing',
  bearingRing: false,
  trackMark: 'line',
  turnRate: false,
};

export const HSI_HONEYWELL: HsiStyle = {
  ...HSI_GARMIN,
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  cardinalLetters: true,
  cardBackground: '',
  bearingRing: false,
  turnRate: false,
};

export const HSI_COLLINS: HsiStyle = { ...HSI_HONEYWELL, palette: COLLINS_PALETTE, typeface: COLLINS_TYPEFACE };

export interface BearingPointerState {
  visible: boolean;
  /** Bearing TO the station (same reference as heading). */
  bearing: number;
  /** 1 = single line, 2 = double line. */
  lines: 1 | 2;
  color: string;
}

export interface HsiState {
  valid: boolean;
  heading: number;
  /** Show a 'T' after heading values (true north reference). */
  headingIsTrue: boolean;
  selectedHeading: number;
  track: number;
  turnRateDps: number;
  courseVisible: boolean;
  course: number;
  courseColor: string;
  /** Double-line course pointer (NAV2 / second source). */
  courseDouble: boolean;
  cdiValid: boolean;
  /** -1..1 full scale (= cdiDots dots), + = fly right. */
  cdi: number;
  /** 1 = TO, -1 = FROM, 0 = none. */
  toFrom: number;
  /** Cross-track error (nm) shown when the CDI is pegged; NaN = none. */
  xtkNm: number;
  sourceLabel: string;
  phaseLabel: string;
  bearing1: BearingPointerState;
  bearing2: BearingPointerState;
  windValid: boolean;
  /** Wind direction FROM in the heading reference, speed (kt). */
  windFrom: number;
  windKt: number;
  gsVisible: boolean;
  gsValid: boolean;
  gsDev: number;
  gsColor: string;
  gsFlag: string;
}

export function createHsiState(): HsiState {
  return {
    valid: true,
    heading: 0,
    headingIsTrue: false,
    selectedHeading: NaN,
    track: NaN,
    turnRateDps: 0,
    courseVisible: false,
    course: 0,
    courseColor: '#ff00ff',
    courseDouble: false,
    cdiValid: false,
    cdi: 0,
    toFrom: 0,
    xtkNm: NaN,
    sourceLabel: '',
    phaseLabel: '',
    bearing1: { visible: false, bearing: 0, lines: 1, color: '#00ffff' },
    bearing2: { visible: false, bearing: 0, lines: 2, color: '#00ffff' },
    windValid: false,
    windFrom: 0,
    windKt: 0,
    gsVisible: false,
    gsValid: false,
    gsDev: 0,
    gsColor: '#00ff00',
    gsFlag: '',
  };
}

export interface HsiOptions {
  /** Rose centre (rose mode) or arc centre = aircraft position (arc mode). */
  cx: number;
  cy: number;
  radius: number;
  style: HsiStyle;
  mode?: 'rose' | 'arc';
  /** Visible arc span in arc mode (deg). Default 90. */
  arcSpanDeg?: number;
  /** Glideslope scale beside the rose: style + offset from the centre ({dx}). */
  gs?: { style?: DeviationScaleStyle; dx: number };
  /** Wind box offset from the centre (null = no wind box). */
  wind?: { dx: number; dy: number } | null;
}

const SIGNS = [-1, 1] as const;
const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
const TENS: string[] = [];
for (let d = 0; d < 36; d++) TENS.push(String(d));

export class Hsi {
  readonly state: HsiState = createHsiState();
  cx: number;
  cy: number;
  radius: number;
  style: HsiStyle;
  mode: 'rose' | 'arc';
  arcSpanDeg: number;
  readonly gsScale: DeviationScale | null;
  wind: { dx: number; dy: number } | null;

  constructor(opts: HsiOptions) {
    this.cx = opts.cx;
    this.cy = opts.cy;
    this.radius = opts.radius;
    this.style = opts.style;
    this.mode = opts.mode ?? 'rose';
    this.arcSpanDeg = opts.arcSpanDeg ?? 90;
    this.gsScale = opts.gs ? new DeviationScale({ x: opts.cx + opts.gs.dx, y: opts.cy, style: opts.gs.style ?? GS_SCALE_GARMIN }) : null;
    this.wind = opts.wind ?? null;
  }

  update(dt: number): void {
    this.gsScale?.update(dt);
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius;
    if (st.cardBackground && this.mode === 'rose') circle(ctx, this.cx, this.cy, R, st.cardBackground, '');
    if (!s.valid) {
      st.typeface.draw(ctx, 'HDG', this.cx, this.cy - R * 0.4, 22, p.amber, 'center', 'middle');
      this.drawSymbol(ctx);
      return;
    }
    ctx.save();
    if (this.mode === 'arc') {
      // Clip everything to the region above the aircraft within the arc.
      ctx.beginPath();
      ctx.rect(this.cx - R - 40, this.cy - R - 60, 2 * R + 80, R + 60 + R * 0.35);
      ctx.clip();
    }
    this.drawCard(ctx);
    if (st.bearingRing && (s.bearing1.visible || s.bearing2.visible) && this.mode === 'rose') {
      circle(ctx, this.cx, this.cy, R * st.bearingInnerFrac, '', p.white, 1.5);
    }
    this.drawBearing(ctx, s.bearing1);
    this.drawBearing(ctx, s.bearing2);
    if (s.courseVisible) this.drawCourse(ctx);
    if (Number.isFinite(s.track)) this.drawTrack(ctx);
    if (Number.isFinite(s.selectedHeading)) this.drawHeadingBug(ctx);
    ctx.restore();
    this.drawSymbol(ctx);
    this.drawHeadingBox(ctx);
    if (st.turnRate && this.mode === 'rose') this.drawTurnRate(ctx);
    this.drawLabels(ctx);
    if (this.gsScale && s.gsVisible) {
      const g = this.gsScale.state;
      g.valid = s.gsValid;
      g.dev = s.gsDev;
      g.color = s.gsColor;
      g.flag = s.gsFlag;
      this.gsScale.draw(ctx);
    }
    if (this.wind && s.windValid) this.drawWind(ctx);
  }

  // ---------------------------------------------------------------- card

  private drawCard(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius;
    const cx = this.cx;
    const cy = this.cy;
    const hdg = s.heading;
    const arc = this.mode === 'arc';
    const half = arc ? this.arcSpanDeg / 2 + 6 : 181;
    ctx.beginPath();
    if (arc) ctx.arc(cx, cy, R, -Math.PI / 2 - (this.arcSpanDeg / 2) * DEG2RAD, -Math.PI / 2 + (this.arcSpanDeg / 2) * DEG2RAD);
    for (let d = 0; d < 360; d += st.minorTickDeg) {
      const rel = wrap180(d - hdg);
      if (Math.abs(rel) > half) continue;
      const a = rel * DEG2RAD;
      const major = d % st.majorTickDeg === 0;
      const len = major ? st.majorTickLen : st.minorTickLen;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      ctx.moveTo(cx + R * sa, cy - R * ca);
      ctx.lineTo(cx + (R - len) * sa, cy - (R - len) * ca);
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = st.lineWidth;
    ctx.stroke();
    // Labels.
    for (let d = 0; d < 360; d += st.labelDeg) {
      const rel = wrap180(d - hdg);
      if (Math.abs(rel) > half) continue;
      const a = rel * DEG2RAD;
      const txt = st.cardinalLetters && CARDINALS[d] !== undefined ? CARDINALS[d] : TENS[d / 10];
      const rr = R - st.majorTickLen - st.labelSize * 0.62;
      if (st.labelsRadial) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        st.typeface.draw(ctx, txt, 0, -rr, st.labelSize, p.white, 'center', 'middle');
        ctx.restore();
      } else {
        st.typeface.draw(ctx, txt, cx + rr * Math.sin(a), cy - rr * Math.cos(a), st.labelSize, p.white, 'center', 'middle');
      }
    }
  }

  private drawHeadingBug(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const rel = wrap180(s.selectedHeading - s.heading);
    const R = this.radius;
    const arcHalf = this.arcSpanDeg / 2;
    const clampedRel = this.mode === 'arc' ? clamp(rel, -arcHalf, arcHalf) : rel;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(clampedRel * DEG2RAD);
    ctx.beginPath();
    // Notched bug straddling the rim.
    ctx.moveTo(-11, -R - 2);
    ctx.lineTo(-11, -R + 10);
    ctx.lineTo(11, -R + 10);
    ctx.lineTo(11, -R - 2);
    ctx.lineTo(5, -R - 2);
    ctx.lineTo(0, -R + 5);
    ctx.lineTo(-5, -R - 2);
    ctx.closePath();
    if (st.headingBug === 'garmin') fillStroke(ctx, p.selected, p.black, 1);
    else fillStroke(ctx, '', p.selected, 2.5);
    ctx.restore();
  }

  private drawTrack(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const rel = wrap180(s.track - s.heading);
    if (this.mode === 'arc' && Math.abs(rel) > this.arcSpanDeg / 2) return;
    const R = this.radius;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rel * DEG2RAD);
    if (st.trackMark === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -R + 1);
      ctx.lineTo(6, -R + 9);
      ctx.lineTo(0, -R + 17);
      ctx.lineTo(-6, -R + 9);
      ctx.closePath();
      fillStroke(ctx, p.trend, p.black, 1);
    } else if (st.trackMark === 'line') {
      line(ctx, 0, -R, 0, -R * 0.1, p.white, 2);
    }
    ctx.restore();
  }

  private drawBearing(ctx: Ctx2D, b: BearingPointerState): void {
    if (!b.visible) return;
    const st = this.style;
    const s = this.state;
    const R = this.radius;
    const r0 = R * st.bearingInnerFrac;
    const rel = wrap180(b.bearing - s.heading);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rel * DEG2RAD);
    ctx.beginPath();
    const tipY = -R + st.majorTickLen + 4;
    if (b.lines === 1) {
      // Head: arrow toward the station; tail on the reciprocal side.
      ctx.moveTo(0, -r0);
      ctx.lineTo(0, tipY);
      ctx.moveTo(-8, tipY + 12);
      ctx.lineTo(0, tipY);
      ctx.lineTo(8, tipY + 12);
      ctx.moveTo(0, r0);
      ctx.lineTo(0, R - st.majorTickLen - 4);
    } else {
      for (const sg of SIGNS) {
        ctx.moveTo(sg * 4, -r0);
        ctx.lineTo(sg * 4, tipY + 10);
        ctx.moveTo(sg * 4, r0);
        ctx.lineTo(sg * 4, R - st.majorTickLen - 4);
      }
      ctx.moveTo(-10, tipY + 14);
      ctx.lineTo(0, tipY);
      ctx.lineTo(10, tipY + 14);
      ctx.moveTo(0, R - st.majorTickLen - 4);
      ctx.lineTo(0, R - st.majorTickLen - 16);
    }
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawCourse(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius;
    const rel = wrap180(s.course - s.heading);
    const spacing = R * st.dotSpacingFrac;
    const color = s.courseColor;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rel * DEG2RAD);
    // Dots perpendicular to the course.
    for (let i = -st.cdiDots; i <= st.cdiDots; i++) {
      if (i === 0) continue;
      circle(ctx, i * spacing, 0, 5, '', p.white, 2);
    }
    const head = R * st.courseHeadFrac;
    const inner = R * st.courseInnerFrac;
    const w = s.courseDouble ? 4 : 0;
    ctx.beginPath();
    // Arrow head section.
    ctx.moveTo(0, -head);
    ctx.lineTo(-12, -head + 20);
    ctx.lineTo(12, -head + 20);
    ctx.closePath();
    if (w === 0) {
      ctx.moveTo(0, -head + 20);
      ctx.lineTo(0, -inner);
      ctx.moveTo(0, inner);
      ctx.lineTo(0, head);
    } else {
      for (const sg of SIGNS) {
        ctx.moveTo(sg * w, -head + 20);
        ctx.lineTo(sg * w, -inner);
        ctx.moveTo(sg * w, inner);
        ctx.lineTo(sg * w, head);
      }
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Deviation bar.
    if (s.cdiValid) {
      const dx = deviationPx(s.cdi, st.cdiDots, spacing, 0.3);
      ctx.beginPath();
      if (w === 0) {
        ctx.moveTo(dx, -inner + 4);
        ctx.lineTo(dx, inner - 4);
      } else {
        for (const sg of SIGNS) {
          ctx.moveTo(dx + sg * w, -inner + 4);
          ctx.lineTo(dx + sg * w, inner - 4);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
      // TO/FROM triangle beside the course line.
      if (s.toFrom !== 0) {
        const ty = s.toFrom > 0 ? -inner * 0.55 : inner * 0.55;
        const d = s.toFrom > 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(spacing * 0.9, ty + d * 10);
        ctx.lineTo(spacing * 0.9 - 9, ty - d * 6);
        ctx.lineTo(spacing * 0.9 + 9, ty - d * 6);
        ctx.closePath();
        fillStroke(ctx, color, p.black, 1);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- fixed symbols

  private drawSymbol(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const x = this.cx;
    const y = this.cy;
    if (st.aircraftSymbol === 'garmin') {
      // White airplane silhouette (fuselage, wings, tail).
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x + 3, y - 16);
      ctx.lineTo(x + 3, y - 6);
      ctx.lineTo(x + 20, y + 2);
      ctx.lineTo(x + 20, y + 6);
      ctx.lineTo(x + 3, y + 2);
      ctx.lineTo(x + 3, y + 14);
      ctx.lineTo(x + 9, y + 19);
      ctx.lineTo(x + 9, y + 22);
      ctx.lineTo(x, y + 19);
      ctx.lineTo(x - 9, y + 22);
      ctx.lineTo(x - 9, y + 19);
      ctx.lineTo(x - 3, y + 14);
      ctx.lineTo(x - 3, y + 2);
      ctx.lineTo(x - 20, y + 6);
      ctx.lineTo(x - 20, y + 2);
      ctx.lineTo(x - 3, y - 6);
      ctx.lineTo(x - 3, y - 16);
      ctx.closePath();
      fillStroke(ctx, p.white, p.black, 1);
    } else if (st.aircraftSymbol === 'boeing') {
      ctx.beginPath();
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x + 10, y + 14);
      ctx.lineTo(x - 10, y + 14);
      ctx.closePath();
      fillStroke(ctx, '', p.white, 2.5);
    }
  }

  private drawHeadingBox(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius;
    const x = this.cx;
    const top = this.cy - R;
    if (st.headingBox === 'garmin') {
      box(ctx, x - 34, top - 38, 68, 30, p.black, p.white, 1.5);
      ctx.beginPath();
      ctx.moveTo(x - 8, top - 8);
      ctx.lineTo(x, top);
      ctx.lineTo(x + 8, top - 8);
      fillStroke(ctx, p.black, p.white, 1.5);
      st.typeface.draw(ctx, fmtHeading(s.heading), x, top - 22, 24, p.white, 'center', 'middle');
      if (s.headingIsTrue) st.typeface.draw(ctx, 'T', x + 38, top - 22, 16, p.white, 'left', 'middle');
    } else if (st.headingBox === 'boeing') {
      ctx.beginPath();
      ctx.moveTo(x - 9, top - 14);
      ctx.lineTo(x, top);
      ctx.lineTo(x + 9, top - 14);
      ctx.closePath();
      fillStroke(ctx, '', p.white, 2);
      box(ctx, x - 30, top - 44, 60, 28, p.black, p.white, 1.5);
      st.typeface.draw(ctx, fmtHeading(s.heading), x, top - 30, 22, p.white, 'center', 'middle');
      st.typeface.draw(ctx, s.headingIsTrue ? 'TRU' : 'MAG', x + 36, top - 30, 16, p.green, 'left', 'middle');
    } else {
      line(ctx, x, top - 12, x, top + 6, p.white, 3);
    }
  }

  private drawTurnRate(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius + 6;
    const cx = this.cx;
    const cy = this.cy;
    const stdDeg = STANDARD_RATE_DPS * st.turnRateSeconds; // 18 deg for 6 s
    ctx.beginPath();
    for (const sg of SIGNS) {
      for (const f of HALF_FULL) {
        const a = sg * stdDeg * f * DEG2RAD;
        ctx.moveTo(cx + R * Math.sin(a), cy - R * Math.cos(a));
        ctx.lineTo(cx + (R + 10) * Math.sin(a), cy - (R + 10) * Math.cos(a));
      }
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = 2;
    ctx.stroke();
    const pred = clamp(s.turnRateDps * st.turnRateSeconds, -stdDeg * 1.6, stdDeg * 1.6);
    if (Math.abs(pred) > 0.5) {
      const a0 = -Math.PI / 2;
      const a1 = a0 + pred * DEG2RAD;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 4, Math.min(a0, a1), Math.max(a0, a1));
      ctx.strokeStyle = p.trend;
      ctx.lineWidth = 4;
      ctx.stroke();
      if (Math.abs(s.turnRateDps) > 4) {
        // Arrowhead: prediction no longer valid (G1000 PG).
        const ax = cx + (R + 4) * Math.cos(a1);
        const ay = cy + (R + 4) * Math.sin(a1);
        // Local -y must point along the direction of travel of the arc end.
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(pred > 0 ? a1 + Math.PI : a1);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-7, 6);
        ctx.lineTo(7, 6);
        ctx.closePath();
        fillStroke(ctx, p.trend, '', 1);
        ctx.restore();
      }
    }
  }

  private drawLabels(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const R = this.radius;
    if (s.sourceLabel) st.typeface.draw(ctx, s.sourceLabel, this.cx - R * 0.42, this.cy - R * 0.2, 18, s.courseColor, 'center', 'middle');
    if (s.phaseLabel) st.typeface.draw(ctx, s.phaseLabel, this.cx + R * 0.42, this.cy - R * 0.2, 18, s.courseColor, 'center', 'middle');
    if (Number.isFinite(s.xtkNm) && (s.cdi >= 1 || s.cdi <= -1)) {
      const txt = fmtFixed(Math.abs(s.xtkNm), Math.abs(s.xtkNm) < 10 ? 2 : 1);
      st.typeface.draw(ctx, 'XTK', this.cx - 6, this.cy + R * 0.38, 16, p.fms, 'right', 'middle');
      st.typeface.draw(ctx, txt, this.cx, this.cy + R * 0.38, 16, p.fms, 'left', 'middle');
      st.typeface.draw(ctx, s.xtkNm > 0 ? 'NM R' : 'NM L', this.cx + 46, this.cy + R * 0.38, 13, p.fms, 'left', 'middle');
    }
  }

  private drawWind(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const wd = this.wind!;
    const x = this.cx + wd.dx;
    const y = this.cy + wd.dy;
    box(ctx, x - 40, y - 26, 80, 52, p.black, p.grey, 1);
    if (s.windKt < 1) {
      st.typeface.draw(ctx, 'NO WIND', x, y, 14, p.white, 'center', 'middle');
      return;
    }
    // Arrow shows where the wind blows TO, relative to the heading-up display.
    const rel = (s.windFrom + 180 - s.heading) * DEG2RAD;
    ctx.save();
    ctx.translate(x - 20, y);
    ctx.rotate(rel);
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, -14);
    ctx.moveTo(-6, -6);
    ctx.lineTo(0, -14);
    ctx.lineTo(6, -6);
    ctx.strokeStyle = p.white;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    st.typeface.draw(ctx, fmtHeading(s.windFrom), x + 18, y - 10, 15, p.white, 'center', 'middle');
    st.typeface.draw(ctx, fmtInt(s.windKt), x + 18, y + 11, 15, p.white, 'center', 'middle');
  }
}

const HALF_FULL = [0.5, 1] as const;
