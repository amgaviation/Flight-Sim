/**
 * Moving altitude tape with rolling 20-ft drum readout, selected-altitude
 * bug and alerting box, barometric setting box (inHg / hPa / STD with
 * preselect), minimums bug, trend vector, metric readouts, VNAV target and
 * ground / landing-elevation hatching.
 *
 * Presets:
 *  - Garmin (G1000 PG 190-00494-04 §2.1 "Altimeter", "Altitude Alerting",
 *    "MDA/DH Alerting"): 600 ft visible, labels + major ticks every 100 ft,
 *    minor every 20 ft, selected altitude box above the tape (cyan), bug
 *    parked at the tape edge when off scale, magenta 6 s trend vector, baro
 *    setting below (in / hPa, STD), metric boxes, minimums bug cyan -> white
 *    within 100 ft -> yellow at minimums, ground line from the radar altimeter.
 *  - Boeing (737NG FCOM 10.10 "Altimeter"): magenta selected altitude and
 *    bug, green baro setting (IN/HPA, STD), green reference-altitude
 *    (minimums) marker, digital readout in thousands/hundreds/twenty feet,
 *    green crosshatch below 10,000 ft, negative sign below zero, no trend.
 *  - Honeywell / Collins: EST, Garmin-like element set, 100 ft labels.
 */
import { clamp } from '../../../core/math';
import type { AltitudeAlertPhase, MinimumsPhase } from '../alerting';
import { RateEstimator, blinkOn } from '../dynamics';
import { fmtBaro, fmtInt, fmtPad } from '../format';
import { BOEING_TYPEFACE, COLLINS_TYPEFACE, GARMIN_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { drumPosition, firstMultipleAtOrAbove, tapeY } from '../math';
import { BOEING_PALETTE, COLLINS_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { barberPole, box, clipRect, fillStroke, line, type Ctx2D } from './context';

export interface AltitudeTapeStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  pxPerFt: number;
  minorStep: number;
  labelStep: number;
  labelSize: number;
  minorTick: number;
  majorTick: number;
  readoutW: number;
  readoutH: number;
  readoutSize: number;
  rollWindowH: number;
  trendSeconds: number;
  trendMinFt: number;
  /** Selected altitude box colours: Garmin inverts to cyan background on "approaching". */
  alertStyle: 'garmin' | 'boeing' | 'honeywell';
  /** Crosshatch in the ten-thousands position below 10,000 ft (Boeing). */
  crosshatchBelow10k: boolean;
  /** Baro setting colour role. */
  baroColor: 'selected' | 'green';
  /** Minimums marker style. */
  minimumsStyle: 'garmin' | 'boeing';
  groundHatchA: string;
  groundHatchB: string;
  lineWidth: number;
}

export const ALT_TAPE_GARMIN: AltitudeTapeStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  pxPerFt: 0.62, // 600 ft over ~372 px
  minorStep: 20,
  labelStep: 100,
  labelSize: 22,
  minorTick: 9,
  majorTick: 18,
  readoutW: 104,
  readoutH: 40,
  readoutSize: 26,
  rollWindowH: 66,
  trendSeconds: 6,
  trendMinFt: 20,
  alertStyle: 'garmin',
  crosshatchBelow10k: false,
  baroColor: 'selected',
  minimumsStyle: 'garmin',
  groundHatchA: '#7a4a1e',
  groundHatchB: '#ffd000',
  lineWidth: 2,
};

export const ALT_TAPE_BOEING: AltitudeTapeStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  pxPerFt: 0.42,
  minorStep: 100,
  labelStep: 200,
  labelSize: 20,
  minorTick: 12,
  majorTick: 12,
  readoutW: 104,
  readoutH: 40,
  readoutSize: 24,
  rollWindowH: 56,
  trendSeconds: 0,
  trendMinFt: 0,
  alertStyle: 'boeing',
  crosshatchBelow10k: true,
  baroColor: 'green',
  minimumsStyle: 'boeing',
  groundHatchA: '#000000',
  groundHatchB: '#ffb000',
  lineWidth: 2,
};

export const ALT_TAPE_HONEYWELL: AltitudeTapeStyle = {
  ...ALT_TAPE_GARMIN,
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  pxPerFt: 0.5,
  minorStep: 50,
  labelStep: 100,
  trendSeconds: 6, // EST
  alertStyle: 'honeywell',
  minimumsStyle: 'boeing',
};

export const ALT_TAPE_COLLINS: AltitudeTapeStyle = { ...ALT_TAPE_HONEYWELL, palette: COLLINS_PALETTE, typeface: COLLINS_TYPEFACE };

export interface AltitudeTapeState {
  valid: boolean;
  altFt: number;
  /** Vertical speed (fpm) for the trend vector; NaN = differentiate `altFt` internally. */
  vsFpm: number;
  selectedFt: number;
  /** Selected altitude box state from AltitudeAlerter (phase + blink phase). */
  alertPhase: AltitudeAlertPhase;
  alertVisible: boolean;
  baroInHg: number;
  baroUnit: 'inhg' | 'hpa';
  baroStd: boolean;
  /** Preselected baro shown under STD (NaN = none). */
  baroPreselectInHg: number;
  /** Baro transition alert: setting flashes (Garmin light blue). */
  baroFlash: boolean;
  /** Barometric minimums (NaN = none) and alert phase. */
  minimumsFt: number;
  minimumsPhase: MinimumsPhase;
  /** Show metric boxes. */
  metric: boolean;
  /** VNAV target altitude (magenta, NaN = none). */
  vnavTargetFt: number;
  /** Ground / landing elevation (ft): hatched below it (NaN = none). */
  groundAltFt: number;
  /** Output: trend (ft) set by update(). */
  trendFt: number;
}

export function createAltitudeTapeState(): AltitudeTapeState {
  return {
    valid: true,
    altFt: 0,
    vsFpm: NaN,
    selectedFt: NaN,
    alertPhase: 'idle',
    alertVisible: true,
    baroInHg: 29.92,
    baroUnit: 'inhg',
    baroStd: false,
    baroPreselectInHg: NaN,
    baroFlash: false,
    minimumsFt: NaN,
    minimumsPhase: 'hidden',
    metric: false,
    vnavTargetFt: NaN,
    groundAltFt: NaN,
    trendFt: 0,
  };
}

export interface AltitudeTapeOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  style: AltitudeTapeStyle;
  centerY?: number;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const TWENTIES = ['00', '20', '40', '60', '80'];
const FT_PER_M = 1 / 0.3048;

export class AltitudeTape {
  readonly state: AltitudeTapeState = createAltitudeTapeState();
  x: number;
  y: number;
  w: number;
  h: number;
  centerY: number;
  style: AltitudeTapeStyle;
  private readonly rate = new RateEstimator(1);
  private time = 0;

  constructor(opts: AltitudeTapeOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.centerY = opts.centerY ?? opts.y + opts.h / 2;
    this.style = opts.style;
  }

  update(dt: number): void {
    this.time += dt;
    const s = this.state;
    const fpm = Number.isFinite(s.vsFpm) ? s.vsFpm : this.rate.update(s.altFt, dt) * 60;
    s.trendFt = (fpm / 60) * this.style.trendSeconds;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.h;
    const cy = this.centerY;
    const k = st.pxPerFt;
    box(ctx, x, y, w, h, p.tapeBackground, '');
    this.drawBaro(ctx);
    if (!s.valid) {
      st.typeface.draw(ctx, 'ALT', x + w / 2, cy, 22, p.amber, 'center', 'middle');
      return;
    }
    const v = s.altFt;
    clipRect(ctx, x, y, w, h);
    // Ground / landing elevation hatching.
    if (Number.isFinite(s.groundAltFt)) {
      const gy = tapeY(s.groundAltFt, v, cy, k);
      if (gy < y + h) {
        barberPole(ctx, x, Math.max(gy, y), w * 0.35, y + h - Math.max(gy, y), st.groundHatchA, st.groundHatchB, 5, -gy);
        line(ctx, x, gy, x + w, gy, st.groundHatchB, 2);
      }
    }
    // Ticks and labels (ticks on the left edge, labels to their right).
    const vTop = v + (cy - y) / k;
    const vBot = v - (y + h - cy) / k;
    ctx.beginPath();
    for (let t = firstMultipleAtOrAbove(vBot, st.minorStep); t <= vTop; t += st.minorStep) {
      const ty = tapeY(t, v, cy, k);
      const major = Math.abs(t / st.labelStep - Math.round(t / st.labelStep)) < 1e-6;
      ctx.moveTo(x, ty);
      ctx.lineTo(x + (major ? st.majorTick : st.minorTick), ty);
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = st.lineWidth;
    ctx.stroke();
    for (let t = firstMultipleAtOrAbove(vBot - st.labelStep, st.labelStep); t <= vTop + st.labelStep; t += st.labelStep) {
      const ty = tapeY(t, v, cy, k);
      st.typeface.draw(ctx, fmtInt(t), x + w - 6, ty, st.labelSize, p.white, 'right', 'middle');
    }
    // Minimums bug.
    if (Number.isFinite(s.minimumsFt) && s.minimumsPhase !== 'hidden' && s.minimumsPhase !== 'inhibited') {
      const my = tapeY(s.minimumsFt, v, cy, k);
      if (my >= y && my <= y + h) {
        const color = st.minimumsStyle === 'boeing' ? (s.minimumsPhase === 'reached' ? p.amber : p.green) : s.minimumsPhase === 'reached' ? p.yellow : s.minimumsPhase === 'near' ? p.white : p.cyan;
        ctx.beginPath();
        if (st.minimumsStyle === 'garmin') {
          ctx.moveTo(x, my);
          ctx.lineTo(x + 12, my - 9);
          ctx.lineTo(x + 12, my - 3);
          ctx.lineTo(x + 26, my - 3);
          ctx.lineTo(x + 26, my + 3);
          ctx.lineTo(x + 12, my + 3);
          ctx.lineTo(x + 12, my + 9);
          ctx.closePath();
          fillStroke(ctx, color, p.black, 1);
        } else {
          ctx.moveTo(x, my);
          ctx.lineTo(x + w * 0.5, my);
          ctx.moveTo(x, my);
          ctx.lineTo(x + 10, my - 8);
          ctx.moveTo(x, my);
          ctx.lineTo(x + 10, my + 8);
          fillStroke(ctx, '', color, 3);
        }
      }
    }
    // Selected altitude bug (parked at the tape edge when off scale).
    if (Number.isFinite(s.selectedFt)) {
      const by = clamp(tapeY(s.selectedFt, v, cy, k), y, y + h);
      ctx.beginPath();
      ctx.moveTo(x, by - 12);
      ctx.lineTo(x + 14, by - 12);
      ctx.lineTo(x + 14, by + 12);
      ctx.lineTo(x, by + 12);
      ctx.lineTo(x, by + 5);
      ctx.lineTo(x + 7, by);
      ctx.lineTo(x, by - 5);
      ctx.closePath();
      fillStroke(ctx, st.alertStyle === 'boeing' ? '' : p.selected, st.alertStyle === 'boeing' ? p.selected : p.black, st.alertStyle === 'boeing' ? 2.5 : 1);
    }
    // Trend vector.
    if (st.trendSeconds > 0 && Math.abs(s.trendFt) >= st.trendMinFt) {
      const ty = clamp(tapeY(v + s.trendFt, v, cy, k), y, y + h);
      line(ctx, x + 4, cy, x + 4, ty, p.trend, 3);
    }
    ctx.restore();
    this.drawReadout(ctx);
    this.drawSelectedBox(ctx);
    if (Number.isFinite(s.vnavTargetFt)) {
      st.typeface.draw(ctx, fmtInt(s.vnavTargetFt), x + w + 60, y - 18, 18, p.fms, 'center', 'middle');
      st.typeface.draw(ctx, 'FT', x + w + 60 + 32, y - 18, 13, p.fms, 'left', 'middle');
    }
  }

  private drawReadout(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const cy = this.centerY;
    const rw = st.readoutW;
    const rh = st.readoutH;
    const rx = this.x + 8;
    const wy = st.rollWindowH;
    const tw = st.readoutSize * 1.25; // width of the rolling 20s drum
    ctx.beginPath();
    ctx.moveTo(rx - 10, cy);
    ctx.lineTo(rx, cy - 8);
    ctx.lineTo(rx, cy - rh / 2);
    ctx.lineTo(rx + rw - tw, cy - rh / 2);
    ctx.lineTo(rx + rw - tw, cy - wy / 2);
    ctx.lineTo(rx + rw, cy - wy / 2);
    ctx.lineTo(rx + rw, cy + wy / 2);
    ctx.lineTo(rx + rw - tw, cy + wy / 2);
    ctx.lineTo(rx + rw - tw, cy + rh / 2);
    ctx.lineTo(rx, cy + rh / 2);
    ctx.lineTo(rx, cy + 8);
    ctx.closePath();
    fillStroke(ctx, p.readoutBackground, p.readoutBorder, 2);
    const neg = s.altFt < 0;
    const a = Math.abs(s.altFt);
    const dh = st.readoutSize * 1.0;
    // Twenty-foot drum.
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx + rw - tw + 1, cy - wy / 2 + 1, tw - 2, wy - 2);
    ctx.clip();
    const pos20 = drumPosition(a, 20, 20);
    const base = Math.floor(pos20);
    const frac = pos20 - base;
    for (let j = -2; j <= 2; j++) {
      const d = (((base + j) % 5) + 5) % 5;
      st.typeface.draw(ctx, TWENTIES[d], rx + rw - tw / 2, cy + (frac - j) * dh * 0.9, st.readoutSize * 0.8, p.white, 'center', 'middle');
    }
    ctx.restore();
    // Hundreds, thousands, ten-thousands drums (carry while the 20s roll 80 -> 100).
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx + 1, cy - rh / 2 + 1, rw - tw - 1, rh - 2);
    ctx.clip();
    const cw = st.readoutSize * 0.56;
    let dx = rx + rw - tw - cw * 0.55;
    this.digitDrum(ctx, drumPosition(a, 100, 20), dx, cy, dh, false, st.readoutSize * 0.85);
    dx -= cw * 1.05;
    const big = st.readoutSize;
    this.digitDrum(ctx, drumPosition(a, 1000, 20), dx, cy, dh, a < 1000, big);
    dx -= cw * 1.05;
    if (a >= 9980) this.digitDrum(ctx, drumPosition(a, 10000, 20), dx, cy, dh, a < 10000, big);
    else if (st.crosshatchBelow10k && !neg) this.crosshatch(ctx, dx, cy, cw * 0.9, dh * 0.8);
    if (neg) st.typeface.draw(ctx, '-', dx - (a >= 9980 ? cw : 0), cy, big, p.white, 'center', 'middle');
    ctx.restore();
    if (s.metric) {
      const m = Math.round((s.altFt / FT_PER_M) / 1);
      box(ctx, this.x + 8, cy - rh / 2 - 30, rw - 10, 26, p.black, p.white, 1);
      st.typeface.draw(ctx, fmtInt(m), this.x + rw - 20, cy - rh / 2 - 17, 18, p.white, 'right', 'middle');
      st.typeface.draw(ctx, 'M', this.x + rw - 16, cy - rh / 2 - 17, 14, p.cyan, 'left', 'middle');
    }
  }

  private digitDrum(ctx: Ctx2D, pos: number, x: number, cy: number, dh: number, blankZero: boolean, size: number): void {
    const st = this.style;
    const base = Math.floor(pos);
    const frac = pos - base;
    for (let j = -1; j <= 2; j++) {
      const n = base + j;
      if (n < 0) continue;
      if (blankZero && n % 10 === 0 && n === 0) continue;
      st.typeface.draw(ctx, DIGITS[n % 10], x, cy + (frac - j) * dh, size, st.palette.white, 'center', 'middle');
    }
  }

  private crosshatch(ctx: Ctx2D, x: number, cy: number, w: number, h: number): void {
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const t = (i / 3) * w;
      ctx.moveTo(x - w / 2 + t, cy - h / 2);
      ctx.lineTo(x - w / 2, cy - h / 2 + (t * h) / w);
      ctx.moveTo(x + w / 2 - t, cy + h / 2);
      ctx.lineTo(x + w / 2, cy + h / 2 - (t * h) / w);
    }
    ctx.strokeStyle = this.style.palette.green;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawSelectedBox(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    if (!Number.isFinite(s.selectedFt)) return;
    const bx = this.x;
    const by = this.y - 36;
    const bw = this.w;
    let fill = p.black;
    let text = p.selected;
    let border = st.alertStyle === 'boeing' ? '' : p.grey;
    const vis = s.alertVisible;
    switch (st.alertStyle) {
      case 'garmin':
        if (s.alertPhase === 'approaching') {
          fill = vis ? p.cyan : p.black;
          text = vis ? p.black : p.cyan;
        } else if (s.alertPhase === 'deviation') text = vis ? p.yellow : p.black;
        else if (s.alertPhase === 'near' && !vis) text = p.black;
        break;
      case 'boeing':
        if (s.alertPhase === 'approaching' || s.alertPhase === 'near') border = p.white;
        else if (s.alertPhase === 'deviation') border = vis ? p.amber : '';
        break;
      case 'honeywell':
        if (s.alertPhase === 'approaching' || s.alertPhase === 'near') border = vis ? p.white : '';
        else if (s.alertPhase === 'deviation') text = vis ? p.amber : p.black;
        break;
    }
    box(ctx, bx, by, bw, 32, fill, border, 2);
    st.typeface.draw(ctx, fmtInt(s.selectedFt), bx + bw - 8, by + 17, 22, text, 'right', 'middle');
    if (s.metric) {
      box(ctx, bx, by - 28, bw, 26, p.black, p.grey, 1);
      st.typeface.draw(ctx, fmtInt(Math.round(s.selectedFt / FT_PER_M)), bx + bw - 22, by - 14, 18, p.selected, 'right', 'middle');
      st.typeface.draw(ctx, 'M', bx + bw - 18, by - 14, 14, p.cyan, 'left', 'middle');
    }
  }

  private drawBaro(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const bx = this.x;
    const by = this.y + this.h + 4;
    const color = st.baroColor === 'green' ? p.green : p.selected;
    if (s.baroFlash && !blinkOn(this.time)) return;
    box(ctx, bx, by, this.w, 30, p.black, st.baroColor === 'green' ? '' : p.grey, 1);
    if (s.baroStd) {
      st.typeface.draw(ctx, 'STD', bx + this.w / 2, by + 16, 22, color, 'center', 'middle');
      if (Number.isFinite(s.baroPreselectInHg)) {
        const pre = fmtBaro(s.baroPreselectInHg, s.baroUnit);
        st.typeface.draw(ctx, pre, bx + this.w / 2, by + 44, 16, p.white, 'center', 'middle');
      }
      return;
    }
    const txt = fmtBaro(s.baroInHg, s.baroUnit);
    st.typeface.draw(ctx, txt, bx + this.w - 34, by + 16, 22, color, 'right', 'middle');
    st.typeface.draw(ctx, s.baroUnit === 'inhg' ? 'IN' : 'HPA', bx + this.w - 30, by + 18, 14, color, 'left', 'middle');
  }
}

/** Formats an altitude as flight level text ("FL350"). */
export function flightLevelText(altFt: number): string {
  return `FL${fmtPad(Math.round(altFt / 100), 3)}`;
}
