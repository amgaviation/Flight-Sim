/**
 * 737NG CDS drawing style: colours, typeface and line widths.
 *
 * Colours follow the Boeing flight deck philosophy (FCOM 10.10 "Display
 * colours"; 14 CFR 25.1322 / AC 25-11B): white = current status and scales,
 * magenta = command information (MCP selections, FD, active route),
 * green = engaged modes / FMC reference data, cyan = labels and inactive
 * data, amber = cautions, red = warnings, and the shades are EST from
 * flight deck photographs (b737.org.uk PFD / ND images).
 *
 * Typeface: the CDS uses a Boeing sans-serif; we render with the installed
 * grotesque (Arial / Liberation Sans / Helvetica / DejaVu Sans) whose
 * proportions are close (EST). Font strings are cached per size so drawing
 * does not allocate.
 */
import type { Ctx2D } from '../../common/draw/context';

export const CDS = {
  black: '#000000',
  white: '#ffffff',
  grey: '#9aa0a8',
  darkGrey: '#3b3f46',
  tape: '#4a4e57',
  magenta: '#ff4dff',
  green: '#1ef01e',
  cyan: '#00e6ff',
  amber: '#ffb020',
  red: '#ff2020',
  sky: '#2e7fd6',
  ground: '#8a5c2e',
  blue: '#3a6fff',
  /** Engine dial fill (the swept sector) and background ring. */
  dialFill: '#6a6e76',
  dialFillDark: '#34373d',
  terrainBlack: '#000000',
} as const;

const FAMILY = '"Arial", "Liberation Sans", "Helvetica Neue", Helvetica, "DejaVu Sans", sans-serif';

const fontCache = new Map<number, string>();
const boldCache = new Map<number, string>();

/** Cached canvas font string for a pixel size (0.5 px resolution). */
export function cdsFont(sizePx: number, bold = false): string {
  const k = Math.round(sizePx * 2);
  const cache = bold ? boldCache : fontCache;
  let s = cache.get(k);
  if (!s) {
    s = `${bold ? 'bold ' : ''}${k / 2}px ${FAMILY}`;
    cache.set(k, s);
  }
  return s;
}

/** Draws text; `align` left/center/right, baseline middle unless given. */
export function text(
  ctx: Ctx2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'middle',
  bold = false,
): void {
  if (s.length === 0) return;
  ctx.font = cdsFont(size, bold);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Text with a black outline (legibility over the attitude sky/ground and terrain). */
export function haloText(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'middle', bold = false): void {
  if (s.length === 0) return;
  ctx.font = cdsFont(size, bold);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = Math.max(2, size * 0.18);
  ctx.strokeStyle = '#000000';
  ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export function textWidth(ctx: Ctx2D, s: string, size: number, bold = false): number {
  ctx.font = cdsFont(size, bold);
  return ctx.measureText(s).width;
}

export function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, w = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string, lw = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

export function fillRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Line widths (logical px on the 800 x 800 DU). EST from photographs. */
export const LW = { thin: 1.5, normal: 2.2, thick: 3.2 } as const;

/** Blink phase helper (true = visible) at `hz`. */
export function blink(timeS: number, hz = 2): boolean {
  return (timeS * hz) % 1 < 0.5;
}
