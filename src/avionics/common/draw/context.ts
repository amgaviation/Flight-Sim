/**
 * Canvas 2D helpers shared by every drawing primitive.
 *
 * Coordinates are logical display pixels (CanvasDisplay applies the
 * pixel-ratio transform before `draw`). Nothing here allocates: dash
 * patterns are shared constant arrays and paths are built in place.
 */

/** Either kind of 2D context (DOM canvas or OffscreenCanvas). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Axis-aligned rectangle in logical pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Shared dash patterns (setLineDash copies its argument, so constants are safe).
export const DASH_NONE: number[] = [];
export const DASH_SHORT: number[] = [4, 4];
export const DASH_MEDIUM: number[] = [8, 6];
export const DASH_LONG: number[] = [14, 8];
export const DASH_DOT: number[] = [2, 4];

/** Rounded-rectangle path (does not fill/stroke). */
export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Filled and/or stroked box. Pass '' to skip fill or stroke. */
export function box(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string, stroke: string, lineWidth = 1, radius = 0): void {
  ctx.beginPath();
  if (radius > 0) roundRectPath(ctx, x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Straight line segment. */
export function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Polyline path from a flat [x0, y0, x1, y1, ...] array, optionally offset/scaled. */
export function polyPath(ctx: Ctx2D, pts: ArrayLike<number>, closed: boolean, ox = 0, oy = 0, scale = 1): void {
  for (let i = 0; i < pts.length; i += 2) {
    const x = ox + pts[i] * scale;
    const y = oy + pts[i + 1] * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
}

/**
 * Polygon rotated by `angle` (rad, clockwise on screen) about (ox, oy);
 * points are in a local frame where +y is DOWN (screen convention).
 */
export function rotatedPolyPath(ctx: Ctx2D, pts: ArrayLike<number>, closed: boolean, ox: number, oy: number, angle: number, scale = 1): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < pts.length; i += 2) {
    const lx = pts[i] * scale;
    const ly = pts[i + 1] * scale;
    const x = ox + lx * c - ly * s;
    const y = oy + lx * s + ly * c;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
}

/** Fills and optionally outlines the current path. */
export function fillStroke(ctx: Ctx2D, fill: string, stroke: string, lineWidth = 1): void {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Filled triangle. */
export function triangle(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, fill: string, stroke = '', lineWidth = 1): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  fillStroke(ctx, fill, stroke, lineWidth);
}

/** Circle (filled and/or stroked). */
export function circle(ctx: Ctx2D, x: number, y: number, r: number, fill: string, stroke = '', lineWidth = 1): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillStroke(ctx, fill, stroke, lineWidth);
}

/** `ctx.save()` + rectangular clip. Pair with `ctx.restore()`. */
export function clipRect(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

/** `ctx.save()` + circular clip. Pair with `ctx.restore()`. */
export function clipCircle(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
}

/** `ctx.save()` + rounded-rectangle clip. Pair with `ctx.restore()`. */
export function clipRoundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
}

/**
 * Diagonal barber-pole / hatch fill of a rectangle (Vmo barber pole,
 * ground-proximity hatching). `stripe` = stripe width in px; two colours
 * alternate at 45 degrees. `phase` shifts the pattern (moving tapes pass the
 * tape offset so the stripes scroll with the scale).
 */
export function barberPole(ctx: Ctx2D, x: number, y: number, w: number, h: number, colorA: string, colorB: string, stripe: number, phase = 0): void {
  if (w <= 0 || h <= 0) return;
  clipRect(ctx, x, y, w, h);
  ctx.fillStyle = colorA;
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  const period = stripe * 2;
  const start = y - w - (((phase % period) + period) % period) - period;
  for (let yy = start; yy < y + h + period; yy += period) {
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy + w);
    ctx.lineTo(x + w, yy + w + stripe);
    ctx.lineTo(x, yy + stripe);
    ctx.closePath();
  }
  ctx.fillStyle = colorB;
  ctx.fill();
  ctx.restore();
}

/** Dotted/dither fill used by EGPWS-style densities is done in the terrain raster; this draws a dot grid. */
export function dotGrid(ctx: Ctx2D, x: number, y: number, w: number, h: number, spacing: number, radius: number, color: string): void {
  ctx.beginPath();
  for (let yy = y + spacing / 2; yy < y + h; yy += spacing) {
    for (let xx = x + spacing / 2; xx < x + w; xx += spacing) {
      ctx.moveTo(xx + radius, yy);
      ctx.arc(xx, yy, radius, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = color;
  ctx.fill();
}
