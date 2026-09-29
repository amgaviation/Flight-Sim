/**
 * Linear deviation scales: glideslope / glidepath / VNAV (vertical) and
 * localizer / lateral (horizontal) indicators with dot scales, plus the
 * marker-beacon annunciator.
 *
 * Conventions (core/vars.ts): deviation normalised -1..+1 = full scale.
 *  - vertical: + = path ABOVE the aircraft (fly up) -> pointer drawn above centre
 *  - horizontal: + = fly right -> pointer drawn right of centre
 *
 * Presets:
 *  - Garmin: 2 dots each side, green diamond (LOC/GS), magenta diamond (GPS
 *    glidepath), magenta chevron VDI with 2 dots = 1000 ft full scale
 *    (G1000 PG 190-00494-04 §2.1 "Vertical Deviation", "Glideslope Indicator").
 *  - Boeing 737NG: 2 dots each side, magenta pointers, deviation alerting turns
 *    the scale amber and flashes the pointer (FCOM 10.10 "Localizer Pointer
 *    and Deviation Scale").
 */
import { clamp } from '../../../core/math';
import { blinkOn } from '../dynamics';
import { BOEING_TYPEFACE, GARMIN_TYPEFACE, type Typeface } from '../fonts';
import { BOEING_PALETTE, GARMIN_PALETTE, type AvionicsPalette } from '../palette';
import { box, circle, fillStroke, line, type Ctx2D } from './context';

export interface DeviationScaleStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  orientation: 'horizontal' | 'vertical';
  /** Dots on each side of centre (full scale = this many dots). */
  dots: number;
  dotSpacing: number;
  dotRadius: number;
  /** Background panel behind the scale ('' = none). */
  background: string;
  /** Centre reference: a line across the scale or none. */
  centerMark: 'line' | 'none';
  pointer: 'diamond' | 'chevron' | 'bar';
  pointerSize: number;
  /** Extra travel (dots) before the pointer pegs. */
  overshootDots: number;
  lineWidth: number;
}

export const GS_SCALE_GARMIN: DeviationScaleStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  orientation: 'vertical',
  dots: 2,
  dotSpacing: 36,
  dotRadius: 5,
  background: 'rgba(40,40,44,0.55)',
  centerMark: 'line',
  pointer: 'diamond',
  pointerSize: 11,
  overshootDots: 0.2,
  lineWidth: 2,
};

export const VDI_GARMIN: DeviationScaleStyle = { ...GS_SCALE_GARMIN, pointer: 'chevron' };

export const GS_SCALE_BOEING: DeviationScaleStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  orientation: 'vertical',
  dots: 2,
  dotSpacing: 34,
  dotRadius: 5,
  background: '',
  centerMark: 'line',
  pointer: 'diamond',
  pointerSize: 10,
  overshootDots: 0.3,
  lineWidth: 2,
};

export const LOC_SCALE_BOEING: DeviationScaleStyle = { ...GS_SCALE_BOEING, orientation: 'horizontal' };

export interface DeviationScaleState {
  valid: boolean;
  /** Normalised deviation (-1..1 = full scale). */
  dev: number;
  /** Pointer colour (source colour: green NAV, magenta GPS/FMS). */
  color: string;
  /** Hollow pointer (preview / second source / not yet captured). */
  hollow: boolean;
  /** Short text above/next to the scale ('' none): e.g. 'G', 'V', 'L'. */
  label: string;
  /** Replaces the pointer when invalid ('' = draw nothing): e.g. 'NO GS', 'NO GP'. */
  flag: string;
  /** Deviation alerting (Boeing): amber scale, flashing pointer. */
  alert: boolean;
  /** Secondary pointer (Garmin VDI + GP, 737 "ANP"): NaN = none. */
  dev2: number;
  color2: string;
}

export function createDeviationState(color = '#00ff00'): DeviationScaleState {
  return { valid: false, dev: 0, color, hollow: false, label: '', flag: '', alert: false, dev2: NaN, color2: '#ff00ff' };
}

export interface DeviationScaleOptions {
  /** Scale centre (logical px). */
  x: number;
  y: number;
  style: DeviationScaleStyle;
}

export class DeviationScale {
  readonly state: DeviationScaleState = createDeviationState();
  x: number;
  y: number;
  style: DeviationScaleStyle;
  private time = 0;

  constructor(opts: DeviationScaleOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.style = opts.style;
  }

  update(dt: number): void {
    this.time += dt;
  }

  /** Pixel offset of the pointer along the scale (+ = right / up on screen as a positive number). */
  pointerOffset(dev: number): number {
    const st = this.style;
    const lim = 1 + st.overshootDots / st.dots;
    return clamp(dev, -lim, lim) * st.dots * st.dotSpacing;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const p = st.palette;
    const vert = st.orientation === 'vertical';
    const half = (st.dots + 0.6) * st.dotSpacing;
    if (st.background) {
      const t = st.pointerSize * 2 + 8;
      if (vert) box(ctx, this.x - t / 2, this.y - half, t, half * 2, st.background, '');
      else box(ctx, this.x - half, this.y - t / 2, half * 2, t, st.background, '');
    }
    const scaleColor = s.alert ? p.amber : p.white;
    // Dots.
    for (let i = -st.dots; i <= st.dots; i++) {
      if (i === 0) continue;
      const o = i * st.dotSpacing;
      circle(ctx, vert ? this.x : this.x + o, vert ? this.y - o : this.y, st.dotRadius, '', scaleColor, st.lineWidth);
    }
    if (st.centerMark === 'line') {
      const l = st.pointerSize * 1.4;
      if (vert) line(ctx, this.x - l, this.y, this.x + l, this.y, scaleColor, st.lineWidth);
      else line(ctx, this.x, this.y - l, this.x, this.y + l, scaleColor, st.lineWidth);
    }
    if (s.label) st.typeface.draw(ctx, s.label, vert ? this.x : this.x - half - 6, vert ? this.y - half - 6 : this.y, 16, p.white, vert ? 'center' : 'right', vert ? 'bottom' : 'middle');
    if (!s.valid) {
      if (s.flag) st.typeface.draw(ctx, s.flag, this.x, this.y, 15, p.amber, 'center', 'middle', p.black);
      return;
    }
    if (s.alert && !blinkOn(this.time)) return;
    if (Number.isFinite(s.dev2)) this.pointer(ctx, s.dev2, s.color2, true);
    this.pointer(ctx, s.dev, s.color, s.hollow);
  }

  private pointer(ctx: Ctx2D, dev: number, color: string, hollow: boolean): void {
    const st = this.style;
    const vert = st.orientation === 'vertical';
    const o = this.pointerOffset(dev);
    const x = vert ? this.x : this.x + o;
    const y = vert ? this.y - o : this.y;
    const r = st.pointerSize;
    ctx.beginPath();
    if (st.pointer === 'diamond') {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.75, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.75, y);
      ctx.closePath();
    } else if (st.pointer === 'chevron') {
      // VNAV chevron pointing at the scale (from the right for vertical scales).
      if (vert) {
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r * 0.4, y - r * 0.8);
        ctx.lineTo(x + r * 0.4, y - r * 0.35);
        ctx.lineTo(x - r * 0.2, y);
        ctx.lineTo(x + r * 0.4, y + r * 0.35);
        ctx.lineTo(x + r * 0.4, y + r * 0.8);
      } else {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x - r * 0.8, y + r * 0.4);
        ctx.lineTo(x - r * 0.35, y + r * 0.4);
        ctx.lineTo(x, y - r * 0.2);
        ctx.lineTo(x + r * 0.35, y + r * 0.4);
        ctx.lineTo(x + r * 0.8, y + r * 0.4);
      }
      ctx.closePath();
    } else {
      if (vert) ctx.rect(x - r * 1.4, y - 2, r * 2.8, 4);
      else ctx.rect(x - 2, y - r * 1.4, 4, r * 2.8);
    }
    fillStroke(ctx, hollow ? '' : color, hollow ? color : st.palette.black, hollow ? 2 : 1);
  }
}

/** Marker beacon kinds: 1 outer (cyan "O"), 2 middle (amber "M"), 3 inner (white "I"). */
export type MarkerKind = 0 | 1 | 2 | 3;

/**
 * Marker-beacon annunciation. Colours per AIM 1-1-9 / TSO-C35 lamp
 * convention (outer blue/cyan, middle amber, inner white); Garmin draws a
 * boxed letter, Boeing the two-letter legend.
 */
export function drawMarkerBeacon(ctx: Ctx2D, x: number, y: number, kind: MarkerKind, style: 'garmin' | 'boeing', palette: AvionicsPalette, typeface: Typeface, size = 20): void {
  if (kind === 0) return;
  const color = kind === 1 ? palette.cyan : kind === 2 ? palette.amber : palette.white;
  if (style === 'garmin') {
    const letter = kind === 1 ? 'O' : kind === 2 ? 'M' : 'I';
    box(ctx, x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2, color, palette.black, 1);
    typeface.draw(ctx, letter, x, y + 1, size, palette.black, 'center', 'middle');
  } else {
    const txt = kind === 1 ? 'OM' : kind === 2 ? 'MM' : 'IM';
    circle(ctx, x, y, size * 0.95, palette.black, color, 2);
    typeface.draw(ctx, txt, x, y, size * 0.8, color, 'center', 'middle');
  }
}
