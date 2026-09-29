/**
 * Vertical speed indicators for glass PFDs.
 *
 * Styles:
 *  - 'tape' (Garmin): fixed scale, pointer box carrying the digital value
 *    when |VS| > 100 fpm, pointer pegs at the scale ends; cyan selected-VS
 *    bug; magenta required-VS chevron (RVSI). G1000 PG 190-00494-04 §2.1
 *    "Vertical Speed Indicator" (jets: labels at 2000/4000 fpm, minor 1000;
 *    the 172 G1000 scale is +/-2000 with labels at 1000/2000).
 *  - 'needle' (Boeing 737NG / Honeywell / Collins): non-linear fixed scale,
 *    needle radiating from a pivot to the right of the scale, magenta
 *    selected-V/S bug, digital readout above (climb) or below (descent) the
 *    scale when |VS| > 400 fpm, TCAS RA green "fly-to" and red "avoid"
 *    bands (737NG FCOM 10.10 "PFD - Vertical Speed Indications": pointer 0 to
 *    6000 fpm, "Displays vertical speed when greater than 400 feet per
 *    minute ... above ... when climbing and below when descending").
 */
import { clamp } from '../../../core/math';
import { fmtInt } from '../format';
import { BOEING_TYPEFACE, COLLINS_TYPEFACE, GARMIN_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { piecewiseSigned } from '../math';
import { BOEING_PALETTE, COLLINS_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { box, fillStroke, line, type Ctx2D } from './context';

export interface VerticalSpeedStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  style: 'tape' | 'needle';
  /** |fpm| -> normalised position (0..1 of the half height); xs[0] must be 0. */
  scaleFpm: readonly number[];
  scalePos: readonly number[];
  /** Tick values (fpm, both directions) and which of them carry labels (label = value/1000). */
  ticks: readonly number[];
  labels: readonly number[];
  labelSize: number;
  /** Digital value shown when |VS| exceeds this (fpm). */
  digitalAboveFpm: number;
  /** Digital value rounding (fpm). */
  digitalRound: number;
  /** Needle pivot: distance (px) to the right of the scale's tick line. */
  pivotDx: number;
  background: string;
  lineWidth: number;
}

/** G1000 (172 and piston installations): +/-2000 fpm, labels 1 and 2, minor ticks each 500 fpm. */
export const VSI_GARMIN_2000: VerticalSpeedStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  style: 'tape',
  scaleFpm: [0, 2000],
  scalePos: [0, 1],
  ticks: [500, 1000, 1500, 2000],
  labels: [1000, 2000],
  labelSize: 18,
  digitalAboveFpm: 100,
  digitalRound: 50, // EST: Garmin shows the value in 50 fpm steps
  pivotDx: 0,
  background: 'rgba(40,40,44,0.55)',
  lineWidth: 2,
};

/** G1000 jets / G3000 / G5000: +/-4000 fpm, labels at 2000 and 4000, minor ticks at 1000. */
export const VSI_GARMIN_4000: VerticalSpeedStyle = {
  ...VSI_GARMIN_2000,
  scaleFpm: [0, 4000],
  ticks: [1000, 2000, 3000, 4000],
  labels: [2000, 4000],
};

/** 737NG: 0-6000 fpm non-linear (1, 2, 6 labels); readout above 400 fpm (FCOM). EST scale positions. */
export const VSI_BOEING: VerticalSpeedStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  style: 'needle',
  scaleFpm: [0, 1000, 2000, 6000],
  scalePos: [0, 0.47, 0.72, 1],
  ticks: [500, 1000, 1500, 2000, 4000, 6000],
  labels: [1000, 2000, 6000],
  labelSize: 18,
  digitalAboveFpm: 400,
  digitalRound: 50,
  pivotDx: 90,
  background: '#5a5f66',
  lineWidth: 2,
};

/** Primus Epic: EST non-linear +/-4000 scale with 1, 2, 4 labels. */
export const VSI_HONEYWELL: VerticalSpeedStyle = {
  ...VSI_BOEING,
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  scaleFpm: [0, 1000, 2000, 4000],
  scalePos: [0, 0.45, 0.7, 1],
  ticks: [500, 1000, 1500, 2000, 3000, 4000],
  labels: [1000, 2000, 4000],
  digitalAboveFpm: 500,
  background: 'rgba(60,64,70,0.75)',
};

export const VSI_COLLINS: VerticalSpeedStyle = { ...VSI_HONEYWELL, palette: COLLINS_PALETTE, typeface: COLLINS_TYPEFACE };

export interface VerticalSpeedState {
  valid: boolean;
  vsFpm: number;
  /** Selected V/S target (NaN = none). */
  selectedFpm: number;
  /** Required V/S to meet the VNAV target (Garmin RVSI, NaN = none). */
  requiredFpm: number;
  /** TCAS RA bands (fpm, NaN = none): fly-to (green) and avoid (red) ranges. */
  raGreenFrom: number;
  raGreenTo: number;
  raRedFrom: number;
  raRedTo: number;
}

export function createVerticalSpeedState(): VerticalSpeedState {
  return { valid: true, vsFpm: 0, selectedFpm: NaN, requiredFpm: NaN, raGreenFrom: NaN, raGreenTo: NaN, raRedFrom: NaN, raRedTo: NaN };
}

export interface VerticalSpeedOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  style: VerticalSpeedStyle;
}

export class VerticalSpeedIndicator {
  readonly state: VerticalSpeedState = createVerticalSpeedState();
  x: number;
  y: number;
  w: number;
  h: number;
  style: VerticalSpeedStyle;

  constructor(opts: VerticalSpeedOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.style = opts.style;
  }

  update(_dt: number): void {}

  /** Screen y for a vertical speed (clamped to the scale ends). */
  yFor(fpm: number): number {
    const st = this.style;
    const pos = clamp(piecewiseSigned(st.scaleFpm, st.scalePos, fpm), -1, 1);
    const half = this.h / 2 - 12;
    return this.y + this.h / 2 - pos * half;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const x = this.x;
    const cy = this.y + this.h / 2;
    if (st.background) {
      // Garmin: plain box; needle style: tapered background like the 737 VSI.
      if (st.style === 'tape') box(ctx, x, this.y, this.w, this.h, st.background, '');
      else {
        ctx.beginPath();
        ctx.moveTo(x, this.y + 20);
        ctx.lineTo(x + this.w * 0.55, this.y);
        ctx.lineTo(x + this.w, this.y);
        ctx.lineTo(x + this.w, this.y + this.h);
        ctx.lineTo(x + this.w * 0.55, this.y + this.h);
        ctx.lineTo(x, this.y + this.h - 20);
        ctx.closePath();
        fillStroke(ctx, st.background, '', 1);
      }
    }
    // Ticks + labels.
    const tickX = st.style === 'tape' ? x : x + this.w * 0.35;
    ctx.beginPath();
    ctx.moveTo(tickX, cy);
    ctx.lineTo(tickX + 16, cy);
    for (let i = 0; i < st.ticks.length; i++) {
      const t = st.ticks[i];
      const major = st.labels.includes(t);
      const len = major ? 14 : 8;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ty = this.yFor(sgn * t);
        ctx.moveTo(tickX, ty);
        ctx.lineTo(tickX + len, ty);
      }
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = st.lineWidth;
    ctx.stroke();
    for (let i = 0; i < st.labels.length; i++) {
      const t = st.labels[i];
      const lbl = LABELS[Math.round(t / 1000)] ?? fmtInt(t / 1000);
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        st.typeface.draw(ctx, lbl, st.style === 'tape' ? tickX + 18 : tickX - 6, this.yFor(sgn * t), st.labelSize, p.white, st.style === 'tape' ? 'left' : 'right', 'middle');
      }
    }
    // TCAS RA bands.
    if (Number.isFinite(s.raRedFrom)) this.band(ctx, tickX, s.raRedFrom, s.raRedTo, p.red);
    if (Number.isFinite(s.raGreenFrom)) this.band(ctx, tickX, s.raGreenFrom, s.raGreenTo, p.green);
    if (!s.valid) {
      st.typeface.draw(ctx, 'V/S', x + this.w / 2, cy, 18, p.amber, 'center', 'middle');
      return;
    }
    // Selected V/S bug.
    if (Number.isFinite(s.selectedFpm)) {
      const by = this.yFor(s.selectedFpm);
      ctx.beginPath();
      ctx.rect(tickX - 2, by - 8, 10, 16);
      fillStroke(ctx, st.style === 'tape' ? p.selected : '', p.selected, 2);
    }
    // Required V/S chevron (magenta).
    if (Number.isFinite(s.requiredFpm)) {
      const ry = this.yFor(s.requiredFpm);
      ctx.beginPath();
      ctx.moveTo(tickX + 2, ry);
      ctx.lineTo(tickX + 16, ry - 9);
      ctx.lineTo(tickX + 16, ry - 4);
      ctx.lineTo(tickX + 9, ry);
      ctx.lineTo(tickX + 16, ry + 4);
      ctx.lineTo(tickX + 16, ry + 9);
      ctx.closePath();
      fillStroke(ctx, p.fms, '', 1);
    }
    const vs = s.vsFpm;
    const vy = this.yFor(vs);
    const showDigits = Math.abs(vs) > st.digitalAboveFpm;
    const val = Math.round(Math.abs(vs) / st.digitalRound) * st.digitalRound;
    if (st.style === 'tape') {
      // Pointer box pointing left at the scale, digits inside.
      const pw = this.w - 8;
      ctx.beginPath();
      ctx.moveTo(tickX + 2, vy);
      ctx.lineTo(tickX + 14, vy - 13);
      ctx.lineTo(tickX + 2 + pw, vy - 13);
      ctx.lineTo(tickX + 2 + pw, vy + 13);
      ctx.lineTo(tickX + 14, vy + 13);
      ctx.closePath();
      fillStroke(ctx, p.black, p.white, 1.5);
      if (showDigits) st.typeface.draw(ctx, fmtInt(vs < 0 ? -val : val), tickX + pw - 2, vy + 1, 18, p.white, 'right', 'middle');
    } else {
      // Needle from the pivot (right of the scale) to the scale line.
      const px = tickX + st.pivotDx;
      const dx = tickX - px;
      const dy = vy - cy;
      line(ctx, px + dx * 0.45, cy + dy * 0.45, tickX + 2, vy, p.white, 3);
      if (showDigits) {
        const ty = vs > 0 ? this.y - 16 : this.y + this.h + 16;
        st.typeface.draw(ctx, fmtInt(val), x + this.w / 2, ty, 20, p.white, 'center', 'middle');
      }
    }
  }

  private band(ctx: Ctx2D, tickX: number, from: number, to: number, color: string): void {
    const y0 = this.yFor(from);
    const y1 = this.yFor(to);
    box(ctx, tickX - 8, Math.min(y0, y1), 6, Math.abs(y1 - y0), color, '');
  }
}

const LABELS: Record<number, string> = { 1: '1', 2: '2', 3: '3', 4: '4', 6: '6' };
