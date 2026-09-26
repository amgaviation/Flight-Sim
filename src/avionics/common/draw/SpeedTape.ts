/**
 * Moving airspeed tape with rolling-digit readout, trend vector, speed bugs,
 * selected-speed bug/box, Vmo/Mmo and stick-shaker barber poles, low-speed
 * awareness bands, static colour ranges (piston airspeed arcs as a strip),
 * flap-limit marker and Mach readout.
 *
 * Presets:
 *  - Garmin (G1000 PG 190-00494-04 §2.1 "Airspeed Indicator"): labels and
 *    major ticks every 10 kt, minor every 5 kt, starts at 20 kt, 60 kt
 *    visible, red/white barber pole above Vmo/Mmo, red low-speed awareness
 *    band up to VLSA, pointer turns red above Vmo or below VLSA, magenta 6 s
 *    trend vector, readout text yellow when the trend crosses a limit,
 *    V-speed flags (1, R, 2, E, AP, RF), Mach shown at/above M 0.40,
 *    open green circle at 1.3 VS1.
 *  - Boeing (737NG FCOM 10.10 "Mach/Airspeed Indicator"): 10 s green trend
 *    vector, magenta airspeed cursor, green reference-speed bugs, red/black
 *    max-speed and stick-shaker barber poles, amber minimum-manoeuvre bar,
 *    readout box amber + flashing 10 s entering the amber bar, Mach shown
 *    above M .40, blanked below M .38, V1 shown digitally at the top when
 *    off scale.
 *  - Honeywell / Collins: EST, same element set with cyan selected speed.
 *
 * Usage:
 *   const tape = new SpeedTape({ x: 90, y: 110, w: 90, h: 380, style: SPEED_TAPE_GARMIN,
 *                                ranges: C172S_ASI_RANGES });
 *   tape.state.ias = vars.get(ADC.ias(1)); tape.update(dt); tape.draw(ctx);
 */
import { clamp } from '../../../core/math';
import { RateEstimator, blinkOn } from '../dynamics';
import { fmtInt, fmtMach } from '../format';
import { BOEING_TYPEFACE, COLLINS_TYPEFACE, GARMIN_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { drumPosition, firstMultipleAtOrAbove, tapeY } from '../math';
import { BOEING_PALETTE, COLLINS_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { barberPole, box, clipRect, fillStroke, line, type Ctx2D } from './context';

export interface SpeedTapeStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  pxPerKt: number;
  minorStep: number;
  labelStep: number;
  /** Lowest speed the tape shows; below it the readout shows dashes. */
  minSpeedKt: number;
  labelSize: number;
  minorTick: number;
  majorTick: number;
  /** Readout box: width, height, digit size, height of the rolling ones window. */
  readoutW: number;
  readoutH: number;
  readoutSize: number;
  rollWindowH: number;
  /** Trend vector prediction time (s); 0 = no trend vector. */
  trendSeconds: number;
  /** Minimum trend (kt) before the vector is drawn. */
  trendMinKt: number;
  trendArrow: boolean;
  /** Width of the colour strip at the tape's right edge (ranges, barber poles). */
  stripW: number;
  barberA: string;
  barberB: string;
  /** Bug rendering: Garmin V-speed flags, Boeing green bug lines, Honeywell cyan/green ticks. */
  bugStyle: 'garmin' | 'boeing' | 'honeywell';
  /** Selected-speed box above the tape. */
  selectedBox: boolean;
  /** Mach readout shown at/above this Mach, hidden below `machHide`. */
  machShow: number;
  machHide: number;
  /** Readout pointer turns red above max / below low-speed awareness (Garmin). */
  redPointer: boolean;
  /** Readout box amber + flashing when entering the min-manoeuvre band (Boeing), seconds. */
  amberFlashS: number;
  /** Where off-scale bugs are listed as text ('none' = not listed). */
  offscaleList: 'top' | 'bottom' | 'none';
  lineWidth: number;
}

export const SPEED_TAPE_GARMIN: SpeedTapeStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  pxPerKt: 6.2, // 60 kt visible on a ~370 px tape (G1000 PG: "60 knots of airspeed viewable")
  minorStep: 5,
  labelStep: 10,
  minSpeedKt: 20,
  labelSize: 22,
  minorTick: 10,
  majorTick: 18,
  readoutW: 76,
  readoutH: 40,
  readoutSize: 26,
  rollWindowH: 64,
  trendSeconds: 6,
  trendMinKt: 1,
  trendArrow: false,
  stripW: 8,
  barberA: '#ff2020',
  barberB: '#ffffff',
  bugStyle: 'garmin',
  selectedBox: true,
  machShow: 0.4,
  machHide: 0.4,
  redPointer: true,
  amberFlashS: 0,
  offscaleList: 'bottom',
  lineWidth: 2,
};

export const SPEED_TAPE_BOEING: SpeedTapeStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  pxPerKt: 4.2,
  minorStep: 10,
  labelStep: 20,
  minSpeedKt: 45, // EST: 737NG ADIRU airspeed floor as shown in FCOM figures ("45")
  labelSize: 20,
  minorTick: 12,
  majorTick: 12,
  readoutW: 72,
  readoutH: 40,
  readoutSize: 24,
  rollWindowH: 56,
  trendSeconds: 10,
  trendMinKt: 2,
  trendArrow: true,
  stripW: 7,
  barberA: '#ff2020',
  barberB: '#000000',
  bugStyle: 'boeing',
  selectedBox: true,
  machShow: 0.4,
  machHide: 0.38,
  redPointer: false,
  amberFlashS: 10,
  offscaleList: 'top',
  lineWidth: 2,
};

export const SPEED_TAPE_HONEYWELL: SpeedTapeStyle = {
  ...SPEED_TAPE_GARMIN,
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  pxPerKt: 4.5,
  labelStep: 20,
  minorStep: 10,
  minSpeedKt: 30,
  trendSeconds: 10, // EST: Primus Epic speed trend predicts 10 s
  trendArrow: true,
  barberA: '#ff2020',
  barberB: '#000000',
  bugStyle: 'honeywell',
  redPointer: false,
  machShow: 0.45,
  machHide: 0.4,
  offscaleList: 'bottom',
};

export const SPEED_TAPE_COLLINS: SpeedTapeStyle = {
  ...SPEED_TAPE_HONEYWELL,
  palette: COLLINS_PALETTE,
  typeface: COLLINS_TYPEFACE,
};

/** Static colour band on the strip (piston airspeed arcs). `inset` 0 = full strip width. */
export interface SpeedRange {
  fromKt: number;
  toKt: number;
  color: string;
  /** Fraction of the strip width (white arc drawn narrower on some G1000 installations). */
  widthFrac?: number;
}

/**
 * Cessna 172S airspeed markings as a G1000 tape strip: white 40-85, green
 * 48-129, yellow 129-163, red above 163 KIAS (172S POH Rev 4 Figure 2-2).
 */
export const C172S_ASI_RANGES: readonly SpeedRange[] = [
  { fromKt: 40, toKt: 85, color: '#ffffff', widthFrac: 0.5 },
  { fromKt: 48, toKt: 129, color: '#00c000', widthFrac: 1 },
  { fromKt: 129, toKt: 163, color: '#ffff00', widthFrac: 1 },
  { fromKt: 163, toKt: 400, color: '#ff2020', widthFrac: 1 },
];

/** A reference-speed bug (V1, VR, V2, VREF, VAPP, flap manoeuvre speeds ...). */
export interface SpeedBug {
  /** Short label drawn on the flag / next to the bug ('1', 'R', '2', 'RF', 'AP', 'V1', '5' ...). */
  label: string;
  kt: number;
  visible: boolean;
  /** Override colour ('' = style default: Garmin cyan/white, Boeing green). */
  color: string;
}

export interface SpeedTapeState {
  valid: boolean;
  ias: number;
  mach: number;
  /** Acceleration (kt/s) from the ADC/IRS; NaN = estimate from `ias` internally. */
  accelKtS: number;
  /** Selected speed bug (kt) and Mach; NaN = none. */
  selectedKt: number;
  selectedMach: number;
  selectedIsMach: boolean;
  /** Selected speed comes from the FMS (magenta) rather than the pilot (selected colour). */
  selectedManaged: boolean;
  /** Maximum speed (Vmo/Mmo or placard, kt): barber pole above. NaN = none. */
  maxKt: number;
  /** Stick-shaker / minimum speed (kt): barber pole below. NaN = none. */
  minKt: number;
  /** Minimum manoeuvring speed (Boeing amber bar top). NaN = none. */
  minManeuverKt: number;
  /** Garmin low-speed awareness (red band up to VLSA). NaN = none. */
  lowSpeedAwarenessKt: number;
  /** Maximum flap/gear placard speed marker (amber tick); NaN = none. */
  flapLimitKt: number;
  /** Garmin open green circle (1.3 VS1) / Boeing flaps-up green dot. NaN = none. */
  greenDotKt: number;
  /** Reference speed bugs (caller-owned fixed array). */
  bugs: SpeedBug[];
  /** Outputs set by update(): overspeed, low-speed and trend. */
  overspeed: boolean;
  lowSpeed: boolean;
  trendKt: number;
}

export function createSpeedTapeState(bugCount = 8): SpeedTapeState {
  const bugs: SpeedBug[] = [];
  for (let i = 0; i < bugCount; i++) bugs.push({ label: '', kt: 0, visible: false, color: '' });
  return {
    valid: true,
    ias: 0,
    mach: 0,
    accelKtS: NaN,
    selectedKt: NaN,
    selectedMach: NaN,
    selectedIsMach: false,
    selectedManaged: false,
    maxKt: NaN,
    minKt: NaN,
    minManeuverKt: NaN,
    lowSpeedAwarenessKt: NaN,
    flapLimitKt: NaN,
    greenDotKt: NaN,
    bugs,
    overspeed: false,
    lowSpeed: false,
    trendKt: 0,
  };
}

export interface SpeedTapeOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  style: SpeedTapeStyle;
  /** Reference line (readout) y; default = vertical centre. */
  centerY?: number;
  ranges?: readonly SpeedRange[];
  bugCount?: number;
}

export class SpeedTape {
  readonly state: SpeedTapeState;
  x: number;
  y: number;
  w: number;
  h: number;
  centerY: number;
  style: SpeedTapeStyle;
  ranges: readonly SpeedRange[];
  private readonly rate = new RateEstimator(1);
  private time = 0;
  private amberLeft = 0;
  private wasInAmber = false;
  private machShown = false;

  constructor(opts: SpeedTapeOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.centerY = opts.centerY ?? opts.y + opts.h / 2;
    this.style = opts.style;
    this.ranges = opts.ranges ?? [];
    this.state = createSpeedTapeState(opts.bugCount ?? 8);
  }

  update(dt: number): void {
    this.time += dt;
    const s = this.state;
    const st = this.style;
    const accel = Number.isFinite(s.accelKtS) ? s.accelKtS : this.rate.update(s.ias, dt);
    s.trendKt = accel * st.trendSeconds;
    s.overspeed = Number.isFinite(s.maxKt) && s.ias > s.maxKt;
    s.lowSpeed = (Number.isFinite(s.lowSpeedAwarenessKt) && s.ias < s.lowSpeedAwarenessKt) || (Number.isFinite(s.minKt) && s.ias < s.minKt);
    // Boeing: readout amber and flashing for 10 s when entering the minimum manoeuvre band.
    const inAmber = Number.isFinite(s.minManeuverKt) && s.ias < s.minManeuverKt;
    if (inAmber && !this.wasInAmber) this.amberLeft = st.amberFlashS;
    this.wasInAmber = inAmber;
    if (this.amberLeft > 0) this.amberLeft -= dt;
    // Mach readout hysteresis.
    if (s.mach >= st.machShow) this.machShown = true;
    else if (s.mach < st.machHide) this.machShown = false;
  }

  /** True while the Mach readout is displayed. */
  get machVisible(): boolean {
    return this.machShown;
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
    const k = st.pxPerKt;
    box(ctx, x, y, w, h, p.tapeBackground, '');
    if (!s.valid) {
      st.typeface.draw(ctx, 'IAS', x + w / 2, cy, 22, p.amber, 'center', 'middle');
      return;
    }
    const v = Math.max(s.ias, st.minSpeedKt);
    const right = x + w;
    const stripX = right - st.stripW;
    clipRect(ctx, x, y, w, h);

    // Static ranges on the strip.
    for (let i = 0; i < this.ranges.length; i++) {
      const r = this.ranges[i];
      const y0 = tapeY(r.toKt, v, cy, k);
      const y1 = tapeY(Math.max(r.fromKt, st.minSpeedKt), v, cy, k);
      if (y1 < y || y0 > y + h) continue;
      const ww = st.stripW * (r.widthFrac ?? 1);
      box(ctx, right - ww, Math.max(y0, y - 2), ww, Math.min(y1, y + h + 2) - Math.max(y0, y - 2), r.color, '');
    }
    // Barber poles.
    if (Number.isFinite(s.maxKt)) {
      const yb = tapeY(s.maxKt, v, cy, k);
      if (yb > y) barberPole(ctx, stripX, y, st.stripW, yb - y, st.barberA, st.barberB, 6, -yb);
    }
    if (Number.isFinite(s.minKt)) {
      const yt = tapeY(s.minKt, v, cy, k);
      if (yt < y + h) barberPole(ctx, stripX, yt, st.stripW, y + h - yt, st.barberA, st.barberB, 6, -yt);
    }
    if (Number.isFinite(s.lowSpeedAwarenessKt)) {
      const yt = tapeY(s.lowSpeedAwarenessKt, v, cy, k);
      if (yt < y + h) box(ctx, stripX, yt, st.stripW, y + h - yt, p.red, '');
    }
    if (Number.isFinite(s.minManeuverKt)) {
      const yt = tapeY(s.minManeuverKt, v, cy, k);
      const yb = Number.isFinite(s.minKt) ? tapeY(s.minKt, v, cy, k) : y + h;
      if (yt < y + h) {
        ctx.beginPath();
        ctx.moveTo(right - st.stripW - 2, yt);
        ctx.lineTo(right - 2, yt);
        ctx.lineTo(right - 2, yb);
        ctx.strokeStyle = p.amber;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    if (Number.isFinite(s.flapLimitKt)) {
      const yf = tapeY(s.flapLimitKt, v, cy, k);
      line(ctx, stripX - 10, yf, right, yf, p.amber, 3);
    }

    // Ticks and labels.
    const vTop = v + (cy - y) / k;
    const vBot = v - (y + h - cy) / k;
    ctx.beginPath();
    for (let t = firstMultipleAtOrAbove(Math.max(vBot, st.minSpeedKt), st.minorStep); t <= vTop; t += st.minorStep) {
      const ty = tapeY(t, v, cy, k);
      const major = Math.abs(t / st.labelStep - Math.round(t / st.labelStep)) < 1e-6;
      const len = major ? st.majorTick : st.minorTick;
      ctx.moveTo(stripX - len, ty);
      ctx.lineTo(stripX, ty);
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = st.lineWidth;
    ctx.stroke();
    for (let t = firstMultipleAtOrAbove(Math.max(vBot, st.minSpeedKt), st.labelStep); t <= vTop + st.labelStep; t += st.labelStep) {
      const ty = tapeY(t, v, cy, k);
      st.typeface.draw(ctx, fmtInt(t), stripX - st.majorTick - 6, ty, st.labelSize, p.white, 'right', 'middle');
    }

    // Green dot / circle.
    if (Number.isFinite(s.greenDotKt)) {
      const gy = tapeY(s.greenDotKt, v, cy, k);
      ctx.beginPath();
      ctx.arc(right - st.stripW - 10, gy, 6, 0, Math.PI * 2);
      fillStroke(ctx, st.bugStyle === 'boeing' ? p.green : '', p.green, 2);
    }

    // Reference bugs on the tape.
    this.drawBugs(ctx, v, false);

    // Selected speed bug.
    const sel = s.selectedIsMach && Number.isFinite(s.selectedMach) && s.mach > 0.05 ? s.ias * (s.selectedMach / s.mach) : s.selectedKt;
    if (Number.isFinite(sel)) {
      const color = s.selectedManaged ? p.fms : p.selected;
      const by = clamp(tapeY(sel, v, cy, k), y, y + h);
      ctx.beginPath();
      if (st.bugStyle === 'boeing') {
        // Magenta "airspeed cursor": two stacked triangles on the tape edge.
        ctx.moveTo(right, by - 10);
        ctx.lineTo(right - 12, by - 10);
        ctx.lineTo(right - 12, by + 10);
        ctx.lineTo(right, by + 10);
        ctx.moveTo(right - 12, by);
        ctx.lineTo(right, by);
        fillStroke(ctx, '', color, 2.5);
      } else {
        // Garmin/Honeywell notched bug.
        ctx.moveTo(right, by - 11);
        ctx.lineTo(right - 12, by - 11);
        ctx.lineTo(right - 12, by - 5);
        ctx.lineTo(right - 6, by);
        ctx.lineTo(right - 12, by + 5);
        ctx.lineTo(right - 12, by + 11);
        ctx.lineTo(right, by + 11);
        ctx.closePath();
        fillStroke(ctx, color, p.black, 1);
      }
    }

    // Trend vector.
    if (st.trendSeconds > 0 && Math.abs(s.trendKt) >= st.trendMinKt) {
      const tx = stripX - 4;
      const ty = clamp(tapeY(v + s.trendKt, v, cy, k), y, y + h);
      line(ctx, tx, cy, tx, ty, p.trend, 3);
      if (st.trendArrow) {
        const d = ty < cy ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 6, ty + 10 * d);
        ctx.lineTo(tx + 6, ty + 10 * d);
        ctx.closePath();
        fillStroke(ctx, p.trend, '', 1);
      }
    }
    ctx.restore(); // tape clip

    this.drawReadout(ctx);
    if (st.selectedBox && Number.isFinite(sel)) this.drawSelectedBox(ctx, s.selectedIsMach);
    if (this.machShown) {
      const color = s.overspeed && st.redPointer ? p.red : p.white;
      st.typeface.draw(ctx, fmtMach(s.mach, 3), x + w / 2, y + h + 22, 22, color, 'center', 'middle');
    }
    if (st.offscaleList !== 'none') this.drawBugs(ctx, v, true);
  }

  // ---------------------------------------------------------------- pieces

  private drawBugs(ctx: Ctx2D, v: number, offscale: boolean): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const k = st.pxPerKt;
    const right = this.x + this.w;
    let row = 0;
    for (let i = 0; i < s.bugs.length; i++) {
      const b = s.bugs[i];
      if (!b.visible || !Number.isFinite(b.kt)) continue;
      const by = tapeY(b.kt, v, this.centerY, k);
      const onScale = by >= this.y && by <= this.y + this.h;
      if (onScale === offscale) continue;
      const color = b.color || (st.bugStyle === 'boeing' ? p.green : st.bugStyle === 'honeywell' ? p.cyan : p.white);
      if (offscale) {
        // Listed as text above/below the tape ("V1 125").
        const ly = st.offscaleList === 'top' ? this.y - 40 - row * 20 : this.y + this.h + 50 + row * 20;
        st.typeface.draw(ctx, b.label, this.x + 6, ly, 17, color, 'left', 'middle');
        st.typeface.draw(ctx, fmtInt(b.kt), this.x + this.w - 4, ly, 17, color, 'right', 'middle');
        row++;
        continue;
      }
      if (st.bugStyle === 'garmin') {
        // Flag to the right of the tape: black box with the label.
        const fw = 12 + b.label.length * 9;
        box(ctx, right + 2, by - 10, fw, 20, p.black, color, 1.5);
        st.typeface.draw(ctx, b.label, right + 2 + fw / 2, by + 1, 16, color, 'center', 'middle');
      } else {
        line(ctx, right - 14, by, right + 8, by, color, 2.5);
        st.typeface.draw(ctx, b.label, right + 11, by, 16, color, 'left', 'middle');
      }
    }
  }

  private drawReadout(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const cy = this.centerY;
    const rw = st.readoutW;
    const rh = st.readoutH;
    const rx = this.x + this.w - rw - 6;
    const below = s.ias < st.minSpeedKt;
    let fill = p.readoutBackground;
    let textColor = p.white;
    let border = p.readoutBorder;
    if (st.redPointer && (s.overspeed || s.lowSpeed)) fill = p.red;
    else if (st.redPointer) {
      const pred = s.ias + s.trendKt;
      if ((Number.isFinite(s.maxKt) && pred > s.maxKt) || (Number.isFinite(s.lowSpeedAwarenessKt) && pred < s.lowSpeedAwarenessKt)) textColor = p.yellow;
    }
    if (this.amberLeft > 0 || (this.wasInAmber && st.amberFlashS > 0)) {
      border = p.amber;
      if (this.amberLeft > 0 && !blinkOn(this.time)) border = p.readoutBorder;
    }
    const wy = st.rollWindowH;
    // Box with a pointer notch toward the tape scale.
    ctx.beginPath();
    ctx.moveTo(rx, cy - rh / 2);
    ctx.lineTo(rx + rw - 22, cy - rh / 2);
    ctx.lineTo(rx + rw - 22, cy - wy / 2);
    ctx.lineTo(rx + rw, cy - wy / 2);
    ctx.lineTo(rx + rw, cy - 8);
    ctx.lineTo(rx + rw + 10, cy);
    ctx.lineTo(rx + rw, cy + 8);
    ctx.lineTo(rx + rw, cy + wy / 2);
    ctx.lineTo(rx + rw - 22, cy + wy / 2);
    ctx.lineTo(rx + rw - 22, cy + rh / 2);
    ctx.lineTo(rx, cy + rh / 2);
    ctx.closePath();
    fillStroke(ctx, fill, border, 2);
    if (below) {
      st.typeface.draw(ctx, '---', rx + rw / 2, cy, st.readoutSize, textColor, 'center', 'middle');
      return;
    }
    const v = Math.max(0, s.ias);
    const dh = st.readoutSize * 1.05;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx + 1, cy - wy / 2 + 1, rw - 2, wy - 2);
    ctx.clip();
    // Ones drum (continuous) in the tall window, tens and hundreds roll on carry.
    const onesX = rx + rw - 11;
    this.drum(ctx, drumPosition(v, 1, 1), onesX, cy, dh, textColor, 10);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx + 1, cy - rh / 2 + 1, rw - 24, rh - 2);
    ctx.clip();
    const cw = st.readoutSize * 0.55;
    this.drum(ctx, drumPosition(v, 10, 1), onesX - cw, cy, dh, textColor, 10, true);
    if (v >= 99) this.drum(ctx, drumPosition(v, 100, 1), onesX - 2 * cw, cy, dh, textColor, 10, true);
    ctx.restore();
  }

  /**
   * Draws a rolling digit drum centred at (x, cy): symbol floor(pos) mod n
   * at the centre, neighbours above/below offset by the fractional roll.
   */
  private drum(ctx: Ctx2D, pos: number, x: number, cy: number, dh: number, color: string, n: number, blankZero = false): void {
    const st = this.style;
    const base = Math.floor(pos);
    const frac = pos - base;
    for (let j = -1; j <= 2; j++) {
      const d = (((base + j) % n) + n) % n;
      if (blankZero && base + j <= 0) continue;
      const yy = cy + (frac - j) * dh;
      st.typeface.draw(ctx, DIGITS[d], x, yy, st.readoutSize, color, 'center', 'middle');
    }
  }

  private drawSelectedBox(ctx: Ctx2D, isMach: boolean): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const color = s.selectedManaged ? p.fms : p.selected;
    const bx = this.x;
    const by = this.y - 34;
    box(ctx, bx, by, this.w, 30, p.black, st.bugStyle === 'boeing' ? '' : p.grey, 1);
    const txt = isMach ? fmtMach(s.selectedMach, 3) : fmtInt(s.selectedKt);
    st.typeface.draw(ctx, txt, bx + this.w - 8, by + 16, 22, color, 'right', 'middle');
  }
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
