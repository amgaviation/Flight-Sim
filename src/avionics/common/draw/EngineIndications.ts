/**
 * Engine and system indications for glass EIS/EICAS pages:
 *  - `DialGauge`: round dial (Boeing 737NG N1/EGT style with digital box and
 *    N1 reference/command bugs; Garmin arc gauges for N1/RPM/ITT),
 *  - `LinearGauge`: vertical tape or horizontal bar with coloured bands and
 *    triangle pointers (Garmin EIS: single or dual L/R pointers) or a filled
 *    bar (Honeywell/Collins tapes),
 *  - `DigitalReadout`: label/value/unit with exceedance colouring.
 * Every gauge owns an `ExceedanceMonitor`: caution turns the pointer and
 * value amber/yellow, warning red; entering a higher level flashes the
 * readout (inverse video) for `flashS` seconds.
 *
 * Presets cite their limits. Angles: screen degrees clockwise from 12
 * o'clock.
 */
import { DEG2RAD, clamp } from '../../../core/math';
import { ExceedanceMonitor, type ExceedanceLimits } from '../alerting';
import { fmtFixed, fmtInt } from '../format';
import { BOEING_TYPEFACE, GARMIN_TYPEFACE, type Typeface } from '../fonts';
import { dialAngle } from '../math';
import { BOEING_PALETTE, GARMIN_PALETTE, type AvionicsPalette } from '../palette';
import { box, fillStroke, line, type Ctx2D } from './context';

/** Coloured band on a scale. */
export interface GaugeBand {
  from: number;
  to: number;
  color: string;
}

/** Scale definition shared by dials and bars. */
export interface GaugeScale {
  min: number;
  max: number;
  bands: readonly GaugeBand[];
  /** Red radial/line values (limits). */
  redlines: readonly number[];
  /** Amber caution lines. */
  amberlines: readonly number[];
  /** Tick values (major) and optional labels (same length or empty). */
  ticks: readonly number[];
  labels: readonly string[];
  /** Exceedance limits (drive pointer/readout colours). */
  limits: ExceedanceLimits;
  /** Digits after the decimal point in the readout (0..2). */
  decimals: 0 | 1 | 2;
  /** Readout rounding step in value units (e.g. 10 for RPM, 5 for EGT); 0 = none. */
  readoutStep: number;
  unit: string;
}

// ------------------------------------------------------------------ dial

export interface DialStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  startDeg: number;
  endDeg: number;
  /** Needle as a line or a filled sector from `min` (Boeing 737NG shaded N1 sector). */
  needle: 'line' | 'sector';
  arcWidth: number;
  /** Digital box offset from the dial centre (fractions of radius) and size; null = none. */
  box: { dx: number; dy: number; w: number; h: number; size: number } | null;
  labelSize: number;
  /** Grey arc for the scale background line. */
  scaleColor: string;
}

export const DIAL_BOEING: DialStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  startDeg: -130, // EST: 737NG EIS N1 dial geometry from FCOM ch.7 figures
  endDeg: 80,
  needle: 'sector',
  arcWidth: 3,
  box: { dx: 0.42, dy: -0.72, w: 0.95, h: 0.36, size: 22 },
  labelSize: 13,
  scaleColor: '#ffffff',
};

export const DIAL_GARMIN: DialStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  startDeg: -120,
  endDeg: 120,
  needle: 'line',
  arcWidth: 7,
  box: { dx: 0, dy: 0.35, w: 1.2, h: 0.42, size: 22 },
  labelSize: 13,
  scaleColor: '#ffffff',
};

export interface DialState {
  valid: boolean;
  value: number;
  /** Command / reference / target bugs (NaN = hidden): Boeing N1 command (white), reference (green), target (magenta). */
  commandValue: number;
  referenceValue: number;
  targetValue: number;
}

export interface DialGaugeOptions {
  x: number;
  y: number;
  radius: number;
  scale: GaugeScale;
  style: DialStyle;
  /** Caption under/above the dial (e.g. 'N1', 'EGT'). */
  caption?: string;
}

export class DialGauge {
  readonly state: DialState = { valid: true, value: 0, commandValue: NaN, referenceValue: NaN, targetValue: NaN };
  x: number;
  y: number;
  radius: number;
  scale: GaugeScale;
  style: DialStyle;
  caption: string;
  readonly exceed: ExceedanceMonitor;

  constructor(opts: DialGaugeOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.radius = opts.radius;
    this.scale = opts.scale;
    this.style = opts.style;
    this.caption = opts.caption ?? '';
    this.exceed = new ExceedanceMonitor(opts.scale.limits);
  }

  update(dt: number): void {
    if (this.state.valid) this.exceed.update(this.state.value, dt);
  }

  /** Screen angle (rad) of a scale value. */
  angle(v: number): number {
    const sc = this.scale;
    return dialAngle(v, sc.min, sc.max, this.style.startDeg, this.style.endDeg) * DEG2RAD;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const sc = this.scale;
    const s = this.state;
    const R = this.radius;
    const x = this.x;
    const y = this.y;
    const a0 = this.angle(sc.min) - Math.PI / 2;
    const a1 = this.angle(sc.max) - Math.PI / 2;
    const lvl = s.valid ? this.exceed.level : 0;
    const valColor = lvl === 2 ? p.red : lvl === 1 ? p.amber : p.white;
    // Filled sector (Boeing).
    if (s.valid && st.needle === 'sector') {
      const av = this.angle(clamp(s.value, sc.min, sc.max)) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, R - 2, a0, av);
      ctx.closePath();
      ctx.fillStyle = lvl === 2 ? 'rgba(255,32,32,0.55)' : lvl === 1 ? 'rgba(255,176,0,0.5)' : 'rgba(150,150,150,0.55)';
      ctx.fill();
    }
    // Scale arc and bands.
    ctx.beginPath();
    ctx.arc(x, y, R, a0, a1);
    ctx.strokeStyle = st.scaleColor;
    ctx.lineWidth = st.needle === 'sector' ? 2.5 : 1.5;
    ctx.stroke();
    for (let i = 0; i < sc.bands.length; i++) {
      const b = sc.bands[i];
      ctx.beginPath();
      ctx.arc(x, y, R - st.arcWidth / 2, this.angle(b.from) - Math.PI / 2, this.angle(b.to) - Math.PI / 2);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = st.arcWidth;
      ctx.stroke();
    }
    // Ticks, labels, limit lines.
    ctx.beginPath();
    for (let i = 0; i < sc.ticks.length; i++) {
      const a = this.angle(sc.ticks[i]);
      ctx.moveTo(x + R * Math.sin(a), y - R * Math.cos(a));
      ctx.lineTo(x + (R - 9) * Math.sin(a), y - (R - 9) * Math.cos(a));
    }
    ctx.strokeStyle = p.white;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < sc.labels.length && i < sc.ticks.length; i++) {
      if (!sc.labels[i]) continue;
      const a = this.angle(sc.ticks[i]);
      st.typeface.draw(ctx, sc.labels[i], x + (R - 18) * Math.sin(a), y - (R - 18) * Math.cos(a), st.labelSize, p.white, 'center', 'middle');
    }
    this.limitLines(ctx, sc.amberlines, p.amber);
    this.limitLines(ctx, sc.redlines, p.red);
    // Bugs.
    this.bug(ctx, s.referenceValue, p.green);
    this.bug(ctx, s.targetValue, p.magenta);
    this.bug(ctx, s.commandValue, p.white);
    // Needle.
    if (s.valid) {
      const a = this.angle(clamp(s.value, sc.min, sc.max * 1.05));
      line(ctx, x, y, x + (R + 2) * Math.sin(a), y - (R + 2) * Math.cos(a), valColor, 3);
      if (st.needle === 'line') {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = valColor;
        ctx.fill();
      }
    }
    // Digital box.
    if (st.box) {
      const bw = st.box.w * R;
      const bh = st.box.h * R;
      const bx = x + st.box.dx * R - bw / 2;
      const by = y + st.box.dy * R - bh / 2;
      const inverse = lvl > 0 && this.exceed.flashing && this.exceed.visible;
      box(ctx, bx, by, bw, bh, inverse ? valColor : p.black, lvl > 0 ? valColor : p.white, 2);
      const txt = s.valid ? formatValue(s.value, sc) : '---';
      st.typeface.draw(ctx, txt, bx + bw - 5, by + bh / 2 + 1, st.box.size, inverse ? p.black : valColor, 'right', 'middle');
    }
    if (this.caption) st.typeface.draw(ctx, this.caption, x, y + R * 0.85, st.labelSize + 2, p.cyan, 'center', 'middle');
  }

  private limitLines(ctx: Ctx2D, values: readonly number[], color: string): void {
    const R = this.radius;
    for (let i = 0; i < values.length; i++) {
      const a = this.angle(values[i]);
      line(ctx, this.x + (R - 12) * Math.sin(a), this.y - (R - 12) * Math.cos(a), this.x + (R + 6) * Math.sin(a), this.y - (R + 6) * Math.cos(a), color, 3.5);
    }
  }

  private bug(ctx: Ctx2D, v: number, color: string): void {
    if (!Number.isFinite(v)) return;
    const R = this.radius;
    const a = this.angle(v);
    const sx = Math.sin(a);
    const cx = Math.cos(a);
    ctx.beginPath();
    ctx.moveTo(this.x + (R + 1) * sx, this.y - (R + 1) * cx);
    ctx.lineTo(this.x + (R + 11) * sx - 5 * cx, this.y - (R + 11) * cx - 5 * sx);
    ctx.lineTo(this.x + (R + 11) * sx + 5 * cx, this.y - (R + 11) * cx + 5 * sx);
    ctx.closePath();
    fillStroke(ctx, color, '', 1);
  }
}

// ------------------------------------------------------------------ linear

export interface LinearStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  orientation: 'vertical' | 'horizontal';
  pointer: 'triangle' | 'fill';
  /** Band thickness (px) and pointer size. */
  thickness: number;
  pointerSize: number;
  labelSize: number;
  /** Value readout position: 'end' (right of a bar / above a tape), 'none'. */
  readout: 'end' | 'caption' | 'none';
}

export const BAR_GARMIN: LinearStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  orientation: 'horizontal',
  pointer: 'triangle',
  thickness: 6,
  pointerSize: 9,
  labelSize: 14,
  readout: 'end',
};

export const TAPE_GARMIN: LinearStyle = { ...BAR_GARMIN, orientation: 'vertical', readout: 'caption' };

export const TAPE_FILL: LinearStyle = { ...BAR_GARMIN, orientation: 'vertical', pointer: 'fill', thickness: 14, readout: 'caption' };

export interface LinearState {
  valid: boolean;
  value: number;
  /** Second pointer (e.g. right tank) — NaN = single pointer. */
  value2: number;
}

export interface LinearGaugeOptions {
  /** Start of the scale (left end / bottom) and length. */
  x: number;
  y: number;
  length: number;
  scale: GaugeScale;
  style: LinearStyle;
  caption?: string;
  /** Labels inside dual pointers (default 'L', 'R'). */
  pointerLabels?: [string, string];
}

export class LinearGauge {
  readonly state: LinearState = { valid: true, value: 0, value2: NaN };
  x: number;
  y: number;
  length: number;
  scale: GaugeScale;
  style: LinearStyle;
  caption: string;
  pointerLabels: [string, string];
  readonly exceed: ExceedanceMonitor;
  readonly exceed2: ExceedanceMonitor;

  constructor(opts: LinearGaugeOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.length = opts.length;
    this.scale = opts.scale;
    this.style = opts.style;
    this.caption = opts.caption ?? '';
    this.pointerLabels = opts.pointerLabels ?? ['L', 'R'];
    this.exceed = new ExceedanceMonitor(opts.scale.limits);
    this.exceed2 = new ExceedanceMonitor(opts.scale.limits);
  }

  update(dt: number): void {
    const s = this.state;
    if (!s.valid) return;
    this.exceed.update(s.value, dt);
    if (Number.isFinite(s.value2)) this.exceed2.update(s.value2, dt);
  }

  /** Screen position along the scale of value v: x for horizontal, y for vertical. */
  pos(v: number): number {
    const sc = this.scale;
    const t = clamp((v - sc.min) / (sc.max - sc.min), 0, 1);
    return this.style.orientation === 'horizontal' ? this.x + t * this.length : this.y - t * this.length;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const sc = this.scale;
    const s = this.state;
    const hor = st.orientation === 'horizontal';
    const th = st.thickness;
    // Background scale line.
    if (hor) box(ctx, this.x, this.y - th / 2, this.length, th, p.darkGrey, '');
    else box(ctx, this.x - th / 2, this.y - this.length, th, this.length, p.darkGrey, '');
    for (let i = 0; i < sc.bands.length; i++) {
      const b = sc.bands[i];
      const a = this.pos(b.from);
      const c = this.pos(b.to);
      if (hor) box(ctx, a, this.y - th / 2, c - a, th, b.color, '');
      else box(ctx, this.x - th / 2, c, th, a - c, b.color, '');
    }
    for (let i = 0; i < sc.redlines.length; i++) this.mark(ctx, sc.redlines[i], p.red, 3);
    for (let i = 0; i < sc.amberlines.length; i++) this.mark(ctx, sc.amberlines[i], p.amber, 2.5);
    for (let i = 0; i < sc.ticks.length; i++) this.mark(ctx, sc.ticks[i], p.white, 1.5, 0.6);
    const lvl = s.valid ? Math.max(this.exceed.level, Number.isFinite(s.value2) ? this.exceed2.level : 0) : 0;
    const color = lvl === 2 ? p.red : lvl === 1 ? p.yellow : p.white;
    if (s.valid) {
      if (st.pointer === 'fill') {
        const e = this.pos(s.value);
        const c = this.exceed.level === 2 ? p.red : this.exceed.level === 1 ? p.amber : p.green;
        if (hor) box(ctx, this.x, this.y - th / 2 + 2, e - this.x, th - 4, c, '');
        else box(ctx, this.x - th / 2 + 2, e, th - 4, this.y - e, c, '');
      } else if (Number.isFinite(s.value2)) {
        this.triangle(ctx, s.value, this.exceed.level, -1, this.pointerLabels[0]);
        this.triangle(ctx, s.value2, this.exceed2.level, 1, this.pointerLabels[1]);
      } else {
        this.triangle(ctx, s.value, this.exceed.level, 1, '');
      }
    }
    // Caption and readout.
    if (this.caption) {
      if (hor) st.typeface.draw(ctx, this.caption, this.x, this.y - th - 8, st.labelSize, p.white, 'left', 'bottom');
      else st.typeface.draw(ctx, this.caption, this.x, this.y + 18, st.labelSize, p.white, 'center', 'middle');
    }
    if (st.readout !== 'none' && !Number.isFinite(s.value2)) {
      const inverse = lvl > 0 && this.exceed.flashing && this.exceed.visible;
      const txt = s.valid ? formatValue(s.value, sc) : '---';
      if (hor) {
        const tw = st.typeface.width(ctx, txt, st.labelSize + 2);
        if (inverse) box(ctx, this.x + this.length - tw - 2, this.y - th - 26, tw + 4, st.labelSize + 6, color, '');
        st.typeface.draw(ctx, txt, this.x + this.length, this.y - th - 8, st.labelSize + 2, inverse ? p.black : color, 'right', 'bottom');
      } else {
        if (inverse) box(ctx, this.x - 30, this.y - this.length - 32, 60, 22, color, '');
        st.typeface.draw(ctx, txt, this.x, this.y - this.length - 20, st.labelSize + 2, inverse ? p.black : color, 'center', 'middle');
      }
    }
  }

  private mark(ctx: Ctx2D, v: number, color: string, width: number, extent = 1): void {
    const hor = this.style.orientation === 'horizontal';
    const th = this.style.thickness;
    const q = this.pos(v);
    const e = th * (0.5 + extent);
    if (hor) line(ctx, q, this.y - e, q, this.y + e, color, width);
    else line(ctx, this.x - e, q, this.x + e, q, color, width);
  }

  /** Triangle pointer; `side` -1 above/left of the bar, +1 below/right. */
  private triangle(ctx: Ctx2D, v: number, level: 0 | 1 | 2, side: -1 | 1, label: string): void {
    const st = this.style;
    const p = st.palette;
    const q = this.pos(v);
    const ps = st.pointerSize;
    const th = st.thickness;
    const color = level === 2 ? p.red : level === 1 ? p.yellow : p.white;
    ctx.beginPath();
    if (st.orientation === 'horizontal') {
      const yb = this.y + side * (th / 2);
      ctx.moveTo(q, yb);
      ctx.lineTo(q - ps * 0.8, yb + side * ps * 1.4);
      ctx.lineTo(q + ps * 0.8, yb + side * ps * 1.4);
    } else {
      const xb = this.x + side * (th / 2);
      ctx.moveTo(xb, q);
      ctx.lineTo(xb + side * ps * 1.4, q - ps * 0.8);
      ctx.lineTo(xb + side * ps * 1.4, q + ps * 0.8);
    }
    ctx.closePath();
    fillStroke(ctx, color, p.black, 1);
    if (label) {
      const lx = st.orientation === 'horizontal' ? q : this.x + side * (th / 2 + ps * 0.95);
      const ly = st.orientation === 'horizontal' ? this.y + side * (th / 2 + ps * 0.95) : q;
      st.typeface.draw(ctx, label, lx, ly + 1, ps * 1.05, p.black, 'center', 'middle');
    }
  }
}

// ------------------------------------------------------------------ digital readout

export interface DigitalReadoutOptions {
  x: number;
  y: number;
  /** Right edge alignment of the value; label drawn to the left. */
  label: string;
  unit: string;
  decimals: 0 | 1 | 2;
  limits: ExceedanceLimits;
  palette: AvionicsPalette;
  typeface: Typeface;
  size?: number;
  /** Normal value colour ('' = palette.white; Boeing EIS uses white, Garmin green for some). */
  normalColor?: string;
  labelColor?: string;
}

export class DigitalReadout {
  valid = true;
  value = 0;
  readonly exceed: ExceedanceMonitor;
  constructor(readonly opts: DigitalReadoutOptions) {
    this.exceed = new ExceedanceMonitor(opts.limits);
  }

  update(dt: number): void {
    if (this.valid) this.exceed.update(this.value, dt);
  }

  draw(ctx: Ctx2D): void {
    const o = this.opts;
    const p = o.palette;
    const size = o.size ?? 18;
    const lvl = this.valid ? this.exceed.level : 0;
    const color = lvl === 2 ? p.red : lvl === 1 ? p.amber : o.normalColor || p.white;
    const txt = this.valid ? (o.decimals === 0 ? fmtInt(this.value) : fmtFixed(this.value, o.decimals)) : '---';
    const inverse = lvl > 0 && this.exceed.flashing && this.exceed.visible;
    if (inverse) {
      const w = o.typeface.width(ctx, txt, size);
      box(ctx, o.x - w - 3, o.y - size * 0.62, w + 6, size * 1.24, color, '');
    }
    o.typeface.draw(ctx, txt, o.x, o.y, size, inverse ? p.black : color, 'right', 'middle');
    if (o.label) o.typeface.draw(ctx, o.label, o.x - 70, o.y, size * 0.8, o.labelColor || p.white, 'left', 'middle');
    if (o.unit) o.typeface.draw(ctx, o.unit, o.x + 4, o.y + 2, size * 0.65, o.labelColor || p.cyan, 'left', 'middle');
  }
}

/** Formats a gauge value with the scale's decimals and rounding step. */
export function formatValue(v: number, sc: GaugeScale): string {
  const q = sc.readoutStep > 0 ? Math.round(v / sc.readoutStep) * sc.readoutStep : v;
  return sc.decimals === 0 ? fmtInt(q) : fmtFixed(q, sc.decimals);
}

// ------------------------------------------------------------------ presets

const GREEN = '#00c000';
const YELLOW = '#ffff00';
const RED = '#ff2020';
const WHITE = '#ffffff';

/**
 * Cessna 172S (IO-360-L2A) engine scales for a G1000 EIS. Limits from the
 * 172S POH Rev 4 Figure 2-3 "Powerplant Instrument Markings": tachometer
 * green 2100-2700 (altitude dependent upper limit), red line 2700 RPM; oil
 * temperature green 100-245 F, red 245 F; oil pressure red 20 psi, green
 * 50-90 psi, red 115 psi; fuel flow 0-12 GPH green; vacuum 4.5-5.5 inHg;
 * fuel quantity red at 0 (1.5 gal unusable each tank).
 */
export const C172S_SCALES = {
  rpm: {
    min: 0,
    max: 3000,
    bands: [{ from: 2100, to: 2700, color: GREEN }],
    redlines: [2700],
    amberlines: [],
    ticks: [0, 500, 1000, 1500, 2000, 2500, 3000],
    labels: ['0', '', '10', '', '20', '', '30'],
    limits: { warnHigh: 2700 },
    decimals: 0,
    readoutStep: 10,
    unit: 'RPM',
  } satisfies GaugeScale,
  oilTempF: {
    min: 75,
    max: 250,
    bands: [{ from: 100, to: 245, color: GREEN }],
    redlines: [245],
    amberlines: [],
    ticks: [],
    labels: [],
    limits: { warnHigh: 245 },
    decimals: 0,
    readoutStep: 1,
    unit: '°F',
  } satisfies GaugeScale,
  oilPressPsi: {
    min: 0,
    max: 120,
    bands: [
      { from: 20, to: 50, color: YELLOW }, // EST: G1000 172 shows the 20-50 psi range as caution
      { from: 50, to: 90, color: GREEN },
      { from: 90, to: 115, color: YELLOW }, // EST
    ],
    redlines: [20, 115],
    amberlines: [],
    ticks: [],
    labels: [],
    limits: { warnLow: 20, cautionLow: 50, cautionHigh: 90, warnHigh: 115 },
    decimals: 0,
    readoutStep: 1,
    unit: 'PSI',
  } satisfies GaugeScale,
  fuelFlowGph: {
    min: 0,
    max: 20,
    bands: [{ from: 0, to: 12, color: GREEN }],
    redlines: [],
    amberlines: [],
    ticks: [0, 5, 10, 15, 20],
    labels: [],
    limits: {},
    decimals: 1,
    readoutStep: 0,
    unit: 'GPH',
  } satisfies GaugeScale,
  vacuumInHg: {
    min: 3,
    max: 7,
    bands: [{ from: 4.5, to: 5.5, color: GREEN }],
    redlines: [],
    amberlines: [],
    ticks: [],
    labels: [],
    limits: { cautionLow: 4.5, cautionHigh: 5.5 },
    decimals: 1,
    readoutStep: 0,
    unit: 'IN HG',
  } satisfies GaugeScale,
  fuelQtyGal: {
    min: 0,
    max: 30,
    bands: [
      { from: 0, to: 1.5, color: RED },
      { from: 1.5, to: 26, color: WHITE },
    ],
    redlines: [0],
    amberlines: [],
    ticks: [0, 10, 20, 30],
    labels: ['0', '10', '20', 'F'],
    limits: { warnLow: 1.5 },
    decimals: 0,
    readoutStep: 1,
    unit: 'GAL',
  } satisfies GaugeScale,
} as const;

/**
 * 737NG N1 dial: 0-110 %, red line at the N1 limit (104 % for the CFM56-7B;
 * EASA TCDS E.004 CFM56-7B: max N1 104 %), amber band not used.
 */
export const B737_N1_SCALE: GaugeScale = {
  min: 0,
  max: 110,
  bands: [],
  redlines: [104],
  amberlines: [],
  ticks: [0, 20, 40, 60, 80, 100],
  labels: ['0', '2', '4', '6', '8', '10'],
  limits: { warnHigh: 104 },
  decimals: 1,
  readoutStep: 0,
  unit: '%',
};

/**
 * 737NG EGT dial: red line 950 C (CFM56-7B takeoff EGT limit, EASA TCDS
 * E.004), amber band 925-950 C is the continuous limit exceedance region
 * (EST: FCOM "EGT amber band" shown for 5 min takeoff).
 */
export const B737_EGT_SCALE: GaugeScale = {
  min: 0,
  max: 1000,
  bands: [{ from: 925, to: 950, color: '#ffb000' }],
  redlines: [950],
  amberlines: [925],
  ticks: [0, 200, 400, 600, 800, 1000],
  labels: [],
  limits: { cautionHigh: 925, warnHigh: 950 },
  decimals: 0,
  readoutStep: 1,
  unit: '°C',
};
