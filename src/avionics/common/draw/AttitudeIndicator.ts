/**
 * Attitude indicator (ADI) for glass PFDs: full-screen synthetic horizon or
 * a clipped "ball", pitch ladder, bank scale, slip/skid indicator, flight
 * director (single-cue command bars or cross pointers), flight path vector,
 * unusual-attitude chevrons, pitch limit indicator, rising runway, radio
 * altitude and minimums readouts.
 *
 * Sources for the presets:
 *  - Garmin G1000 PG 190-00494-04 §2.1 "Attitude Indicator": pitch marks
 *    every 10 deg (labels) up to 80, 5 deg minor marks up to 25 below / 45
 *    above, 2.5 deg marks within +/-20; bank ticks major 30/60, minor
 *    10/20/45, inverted white zero triangle; slip/skid bar beneath the roll
 *    pointer; single-cue or cross-pointer command bars with matching
 *    aircraft symbols; red extreme-pitch chevrons from +50 / -30 deg;
 *    declutter when pitch > +30/-20 or bank > 65 deg.
 *  - Boeing 737NG FCOM 10.10 "Attitude Indicator": bank scale 0/10/20/30/45/60
 *    fixed, bank pointer fills amber at >= 35 deg bank, slip/skid fills
 *    white at full scale, pitch scale 2.5 deg increments, magenta flight
 *    director, amber pitch limit indicator, flight path vector, rising
 *    runway below 2500 ft RA rising below 200 ft, radio altitude below
 *    2500 ft (digital 2500-1000, round dial below 1000).
 *  - Honeywell / Collins: same geometry family (EST: from Primus Epic and
 *    Pro Line Fusion PFD figures): fixed bank scale with 10/20/30/45/60
 *    ticks, cross-pointer or single-cue FD, black-and-white aircraft symbol.
 *
 * Usage:
 *   const adi = new AttitudeIndicator({ rect: {x:0,y:0,w:1024,h:768}, cx: 512, cy: 300, style: ADI_GARMIN });
 *   adi.state.pitch = vars.get(ADC.pitch(1)); ... ; adi.update(dt); adi.draw(ctx);
 */
import { DEG2RAD, clamp } from '../../../core/math';
import type { MinimumsPhase } from '../alerting';
import { blinkOn } from '../dynamics';
import { fmtInt } from '../format';
import { GARMIN_TYPEFACE, BOEING_TYPEFACE, HONEYWELL_TYPEFACE, COLLINS_TYPEFACE, type Typeface } from '../fonts';
import { BOEING_PALETTE, COLLINS_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { DASH_SHORT, DASH_NONE, box, circle, clipCircle, clipRect, clipRoundRect, fillStroke, line, polyPath, type Ctx2D, type Rect } from './context';

// ------------------------------------------------------------------ style

export interface PitchLadderStyle {
  /** Label/major line step (deg). */
  majorStepDeg: number;
  /** Mid lines (5 deg) are drawn between -midDownDeg and +midUpDeg. */
  midStepDeg: number;
  midUpDeg: number;
  midDownDeg: number;
  /** Fine lines (2.5 deg) within +/- fineRangeDeg. 0 = none. */
  fineStepDeg: number;
  fineRangeDeg: number;
  /** Highest ladder line (deg). */
  maxDeg: number;
  /** Half widths (px) of major / mid / fine lines. */
  majorHalf: number;
  midHalf: number;
  fineHalf: number;
  /** Labels on major lines: 'both' sides, 'left', or 'none'. */
  labels: 'both' | 'left' | 'none';
  labelSize: number;
  /** Negative pitch lines drawn dashed (some Collins/Honeywell formats). */
  dashedBelow: boolean;
  /** Ladder is clipped to +/- this many degrees around the current pitch (0 = no limit). */
  visibleRangeDeg: number;
  /** Ladder clip half width (px) in the rolled frame (0 = no lateral clip). */
  clipHalfWidth: number;
  lineWidth: number;
}

export interface BankScaleStyle {
  /** Radius of the scale arc (px) from the attitude centre. */
  radius: number;
  /** Tick angles (deg, drawn both sides). */
  ticks: readonly number[];
  /** Ticks drawn long (major). Others short. */
  majorTicks: readonly number[];
  /** Ticks drawn as small hollow triangles (Garmin/Boeing 45 deg). */
  triangleTicks: readonly number[];
  minorLen: number;
  majorLen: number;
  /** Draw the arc line between the outermost ticks. */
  arc: boolean;
  /** 'sky': fixed scale, pointer rolls with the horizon (G1000, 737). 'ground': scale rolls, pointer fixed. */
  pointerMode: 'sky' | 'ground';
  /** Pointer triangle size (px). */
  pointerSize: number;
  /** Bank at which the pointer fills amber (Boeing 35 deg); Infinity = never. */
  exceedDeg: number;
  lineWidth: number;
}

export interface SlipStyle {
  style: 'trapezoid' | 'bar' | 'none';
  width: number;
  height: number;
  /** Lateral displacement (px) for slip = +/-1 (full ball deflection). */
  travel: number;
  /** Gap between pointer and slip indicator (px). */
  gap: number;
  /** Boeing: fills when at full-scale deflection. */
  fillAtFullScale: boolean;
}

export interface FlightDirectorStyle {
  style: 'single-cue' | 'cross-pointer' | 'none';
  /** Single cue: half span (px) and thickness. Cross pointer: bar half length. */
  size: number;
  thickness: number;
  /** Cross pointers: px of bar displacement per deg of bank error. */
  pxPerDegBank: number;
  /** Error clamps (deg). */
  maxPitchErrDeg: number;
  maxBankErrDeg: number;
}

export interface AircraftSymbolStyle {
  style: 'delta' | 'wings' | 'none';
  /** Half span (px). */
  size: number;
  thickness: number;
}

export interface AttitudeStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  /** Clip shape of the horizon: 'none' = fill `rect` (full-screen horizon). */
  clip: 'none' | 'rect' | 'roundRect' | 'circle';
  clipRadius: number;
  /** Sky/ground gradients (Garmin) or solid colours. */
  gradient: boolean;
  gradientPx: number;
  pxPerDeg: number;
  horizonWidth: number;
  ladder: PitchLadderStyle;
  bank: BankScaleStyle;
  slip: SlipStyle;
  fd: FlightDirectorStyle;
  symbol: AircraftSymbolStyle;
  /** Red extreme-pitch chevrons at/above these pitch angles (deg). NaN = none. */
  chevronUpDeg: number;
  chevronDownDeg: number;
  /** Declutter thresholds (deg): state.decluttered is set beyond them; FD hidden. */
  declutterPitchUp: number;
  declutterPitchDown: number;
  declutterBank: number;
  /** Heading ticks along the horizon line (Boeing/Honeywell). 0 = none; else px per deg of heading. */
  horizonHeadingPxPerDeg: number;
  /** Radio altitude readout position relative to (cx, cy); null = not drawn by the ADI. */
  radioAlt: { dx: number; dy: number; size: number; format: 'digital' | 'boeing-dial'; showBelowFt: number } | null;
  /** Minimums readout position relative to (cx, cy); null = not drawn by the ADI. */
  minimums: { dx: number; dy: number; size: number } | null;
}

const LADDER_GARMIN: PitchLadderStyle = {
  majorStepDeg: 10,
  midStepDeg: 5,
  midUpDeg: 45,
  midDownDeg: 25,
  fineStepDeg: 2.5,
  fineRangeDeg: 20,
  maxDeg: 80,
  majorHalf: 60,
  midHalf: 30,
  fineHalf: 15,
  labels: 'both',
  labelSize: 17,
  dashedBelow: false,
  visibleRangeDeg: 22,
  clipHalfWidth: 110,
  lineWidth: 2,
};

/** Garmin G1000 / G3000 / G5000 PFD attitude (1024 x 768 design, single-cue FD). */
export const ADI_GARMIN: AttitudeStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  clip: 'none',
  clipRadius: 0,
  gradient: true,
  gradientPx: 260,
  pxPerDeg: 7.2,
  horizonWidth: 2,
  ladder: LADDER_GARMIN,
  bank: {
    radius: 185,
    ticks: [10, 20, 30, 45, 60],
    majorTicks: [30, 60],
    triangleTicks: [45],
    minorLen: 10,
    majorLen: 20,
    arc: true,
    pointerMode: 'sky',
    pointerSize: 14,
    exceedDeg: Infinity,
    lineWidth: 2,
  },
  slip: { style: 'bar', width: 26, height: 6, travel: 24, gap: 3, fillAtFullScale: false },
  fd: { style: 'single-cue', size: 95, thickness: 11, pxPerDegBank: 4, maxPitchErrDeg: 15, maxBankErrDeg: 45 },
  symbol: { style: 'delta', size: 100, thickness: 12 },
  chevronUpDeg: 50,
  chevronDownDeg: -30,
  declutterPitchUp: 30,
  declutterPitchDown: -20,
  declutterBank: 65,
  horizonHeadingPxPerDeg: 0,
  radioAlt: null,
  minimums: null,
};

/** Boeing 737NG CDS PFD attitude (split-axis FD bars, rounded ADI box). */
export const ADI_BOEING: AttitudeStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  clip: 'roundRect',
  clipRadius: 40,
  gradient: false,
  gradientPx: 0,
  pxPerDeg: 8,
  horizonWidth: 2,
  ladder: {
    majorStepDeg: 10,
    midStepDeg: 5,
    midUpDeg: 90,
    midDownDeg: 90,
    fineStepDeg: 2.5,
    fineRangeDeg: 90,
    maxDeg: 90,
    majorHalf: 48,
    midHalf: 24,
    fineHalf: 12,
    labels: 'both',
    labelSize: 16,
    dashedBelow: false,
    visibleRangeDeg: 20,
    clipHalfWidth: 90,
    lineWidth: 2,
  },
  bank: {
    radius: 150,
    ticks: [10, 20, 30, 45, 60],
    majorTicks: [30, 60],
    triangleTicks: [45],
    minorLen: 10,
    majorLen: 18,
    arc: false,
    pointerMode: 'sky',
    pointerSize: 13,
    exceedDeg: 35,
    lineWidth: 2,
  },
  slip: { style: 'trapezoid', width: 26, height: 7, travel: 22, gap: 2, fillAtFullScale: true },
  fd: { style: 'cross-pointer', size: 70, thickness: 3, pxPerDegBank: 3.5, maxPitchErrDeg: 12, maxBankErrDeg: 30 },
  symbol: { style: 'wings', size: 85, thickness: 8 },
  chevronUpDeg: NaN,
  chevronDownDeg: NaN,
  declutterPitchUp: 90,
  declutterPitchDown: -90,
  declutterBank: 180,
  horizonHeadingPxPerDeg: 0,
  radioAlt: { dx: 0, dy: 150, size: 20, format: 'digital', showBelowFt: 2500 },
  minimums: { dx: 110, dy: 150, size: 16 },
};

/** Honeywell Primus Epic PFD (PlaneView II / Symmetry): large horizon, heading marks on the horizon. */
export const ADI_HONEYWELL: AttitudeStyle = {
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  clip: 'rect',
  clipRadius: 0,
  gradient: true,
  gradientPx: 220,
  pxPerDeg: 7.5,
  horizonWidth: 2,
  ladder: { ...LADDER_GARMIN, midUpDeg: 90, midDownDeg: 90, maxDeg: 90, labelSize: 16, visibleRangeDeg: 25, clipHalfWidth: 100 },
  bank: {
    radius: 175,
    ticks: [10, 20, 30, 45, 60],
    majorTicks: [30, 60],
    triangleTicks: [45],
    minorLen: 10,
    majorLen: 20,
    arc: true,
    pointerMode: 'sky',
    pointerSize: 14,
    exceedDeg: 45, // EST: Primus Epic bank pointer turns amber beyond 45 deg
    lineWidth: 2,
  },
  slip: { style: 'trapezoid', width: 28, height: 7, travel: 24, gap: 2, fillAtFullScale: false },
  fd: { style: 'single-cue', size: 90, thickness: 9, pxPerDegBank: 4, maxPitchErrDeg: 15, maxBankErrDeg: 40 },
  symbol: { style: 'wings', size: 95, thickness: 9 },
  chevronUpDeg: 45,
  chevronDownDeg: -30,
  declutterPitchUp: 30,
  declutterPitchDown: -20,
  declutterBank: 65,
  horizonHeadingPxPerDeg: 7.5,
  radioAlt: { dx: 0, dy: 165, size: 20, format: 'digital', showBelowFt: 2500 },
  minimums: { dx: 130, dy: 165, size: 16 },
};

/** Collins Pro Line Fusion (Global 6000 Vision flight deck). */
export const ADI_COLLINS: AttitudeStyle = {
  ...ADI_HONEYWELL,
  palette: COLLINS_PALETTE,
  typeface: COLLINS_TYPEFACE,
  bank: { ...ADI_HONEYWELL.bank, exceedDeg: 35 },
  fd: { ...ADI_HONEYWELL.fd, style: 'cross-pointer', size: 75, thickness: 4, pxPerDegBank: 3.5 },
  chevronUpDeg: 50,
  chevronDownDeg: -30,
};

// ------------------------------------------------------------------ state

export interface AttitudeState {
  valid: boolean;
  pitch: number;
  /** + = right wing down. */
  bank: number;
  /** Slip/skid ball -1..1 (+ = ball right, i.e. more right rudder needed ... = skidding left turn). */
  slip: number;
  heading: number;
  fdVisible: boolean;
  /** Commanded pitch/bank (deg) from AP.fdPitch / AP.fdBank. */
  fdPitch: number;
  fdBank: number;
  fpvVisible: boolean;
  /** Flight path angle (deg) and drift (track - heading, deg). */
  fpaDeg: number;
  driftDeg: number;
  /** Pitch-limit indicator: pitch (deg) of stick-shaker onset; NaN = hidden. */
  pliDeg: number;
  radioAltValid: boolean;
  radioAltFt: number;
  /** Minimums readout (value, source label, alert phase from MinimumsAlerter, blink phase). */
  minimumsFt: number;
  minimumsIsRadio: boolean;
  minimumsPhase: MinimumsPhase;
  minimumsVisible: boolean;
  /** Boeing rising runway: shown on an ILS below 2500 ft RA; `locDev` -1..1 (+ = runway right). */
  risingRunway: boolean;
  locDev: number;
  /** Output: set by update() when the attitude exceeds the declutter limits. */
  decluttered: boolean;
}

export function createAttitudeState(): AttitudeState {
  return {
    valid: true,
    pitch: 0,
    bank: 0,
    slip: 0,
    heading: 0,
    fdVisible: false,
    fdPitch: 0,
    fdBank: 0,
    fpvVisible: false,
    fpaDeg: 0,
    driftDeg: 0,
    pliDeg: NaN,
    radioAltValid: false,
    radioAltFt: 0,
    minimumsFt: NaN,
    minimumsIsRadio: false,
    minimumsPhase: 'hidden',
    minimumsVisible: true,
    risingRunway: false,
    locDev: 0,
    decluttered: false,
  };
}

/**
 * Radio altitude display resolution (G1000 PG Table 2-4): nearest 5 ft
 * below 200 ft, 10 ft to 1500 ft, 50 ft to 2500 ft.
 */
export function quantizeRadioAlt(ft: number): number {
  const a = Math.abs(ft);
  const q = a < 200 ? 5 : a < 1500 ? 10 : 50;
  return Math.round(ft / q) * q;
}

export interface AttitudeIndicatorOptions {
  /** Area the horizon fills / is clipped to (logical px). */
  rect: Rect;
  /** Attitude reference point (aircraft symbol centre). */
  cx: number;
  cy: number;
  style: AttitudeStyle;
}

// Aircraft symbol shapes (screen frame, +y down), unit half-span 1.
const DELTA_SHAPE = [0, 0, -1, 0.36, -0.62, 0.36, 0, 0.14, 0.62, 0.36, 1, 0.36];
/** Chevron pointing down (+y), unit half-width; flipped for nose-low chevrons. */
const CHEVRON = [-1, -0.5, 0, 0.3, 1, -0.5, 1, -0.1, 0, 0.7, -1, -0.1];
const SIGNS = [-1, 1] as const;

export class AttitudeIndicator {
  readonly state: AttitudeState = createAttitudeState();
  rect: Rect;
  cx: number;
  cy: number;
  style: AttitudeStyle;
  private time = 0;
  private gradCtx: Ctx2D | null = null;
  private skyGrad: CanvasGradient | null = null;
  private groundGrad: CanvasGradient | null = null;

  constructor(opts: AttitudeIndicatorOptions) {
    this.rect = opts.rect;
    this.cx = opts.cx;
    this.cy = opts.cy;
    this.style = opts.style;
  }

  update(dt: number): void {
    this.time += dt;
    const s = this.state;
    const st = this.style;
    s.decluttered = s.pitch > st.declutterPitchUp || s.pitch < st.declutterPitchDown || Math.abs(s.bank) > st.declutterBank;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const r = this.rect;
    ctx.save();
    // Clip to the ball/box shape.
    if (st.clip === 'rect' || st.clip === 'none') clipRect(ctx, r.x, r.y, r.w, r.h);
    else if (st.clip === 'roundRect') clipRoundRect(ctx, r.x, r.y, r.w, r.h, st.clipRadius);
    else clipCircle(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2);

    if (!s.valid) {
      // Failed attitude: black ball with the vendor failure flag.
      box(ctx, r.x, r.y, r.w, r.h, '#000000', '');
      ctx.restore();
      this.drawFailFlag(ctx);
      ctx.restore();
      return;
    }

    this.drawHorizon(ctx);
    this.drawBankScale(ctx);
    if (s.fpvVisible) this.drawFpv(ctx);
    if (s.fdVisible && !s.decluttered) this.drawFlightDirector(ctx);
    if (s.risingRunway) this.drawRisingRunway(ctx);
    this.drawSymbol(ctx);
    ctx.restore(); // clip
    this.drawReadouts(ctx);
    ctx.restore();
  }

  // ---------------------------------------------------------------- horizon + ladder

  private ensureGradients(ctx: Ctx2D): void {
    if (this.gradCtx === ctx) return;
    const p = this.style.palette;
    const g = this.style.gradientPx;
    this.skyGrad = ctx.createLinearGradient(0, -g, 0, 0);
    this.skyGrad.addColorStop(0, p.sky);
    this.skyGrad.addColorStop(1, p.skyHorizon);
    this.groundGrad = ctx.createLinearGradient(0, 0, 0, g);
    this.groundGrad.addColorStop(0, p.groundHorizon);
    this.groundGrad.addColorStop(1, p.ground);
    this.gradCtx = ctx;
  }

  private drawHorizon(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const k = st.pxPerDeg;
    const R = Math.hypot(this.rect.w, this.rect.h) + Math.abs(s.pitch) * k + 50;
    const hy = s.pitch * k; // horizon offset (down = +) in the rolled frame
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(-s.bank * DEG2RAD);
    // Sky and ground.
    ctx.translate(0, hy);
    if (st.gradient) {
      this.ensureGradients(ctx);
      ctx.fillStyle = p.sky;
      ctx.fillRect(-R, -2 * R, 2 * R, 2 * R - st.gradientPx);
      ctx.fillStyle = this.skyGrad!;
      ctx.fillRect(-R, -st.gradientPx, 2 * R, st.gradientPx);
      ctx.fillStyle = this.groundGrad!;
      ctx.fillRect(-R, 0, 2 * R, st.gradientPx);
      ctx.fillStyle = p.ground;
      ctx.fillRect(-R, st.gradientPx, 2 * R, 2 * R);
    } else {
      ctx.fillStyle = p.sky;
      ctx.fillRect(-R, -2 * R, 2 * R, 2 * R);
      ctx.fillStyle = p.ground;
      ctx.fillRect(-R, 0, 2 * R, 2 * R);
    }
    // Horizon line.
    line(ctx, -R, 0, R, 0, p.white, st.horizonWidth);
    if (st.horizonHeadingPxPerDeg > 0) this.drawHorizonHeading(ctx);
    ctx.translate(0, -hy);
    this.drawLadder(ctx);
    if (Number.isFinite(s.pliDeg)) this.drawPli(ctx);
    ctx.restore();
  }

  /** Heading tick marks every 10 deg along the horizon (rolled frame, origin on the horizon). */
  private drawHorizonHeading(ctx: Ctx2D): void {
    const st = this.style;
    const k = st.horizonHeadingPxPerDeg;
    const h = this.state.heading;
    const span = this.rect.w / 2 / k;
    ctx.beginPath();
    const first = Math.ceil((h - span) / 10) * 10;
    for (let d = first; d <= h + span; d += 10) {
      const x = (d - h) * k;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 8);
    }
    ctx.strokeStyle = st.palette.white;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawLadder(ctx: Ctx2D): void {
    const st = this.style;
    const L = st.ladder;
    const p = st.palette;
    const s = this.state;
    const k = st.pxPerDeg;
    const pitch = s.pitch;
    const lo = L.visibleRangeDeg > 0 ? pitch - L.visibleRangeDeg : -L.maxDeg;
    const hi = L.visibleRangeDeg > 0 ? pitch + L.visibleRangeDeg : L.maxDeg;
    ctx.save();
    if (L.clipHalfWidth > 0 && L.visibleRangeDeg > 0) {
      const hh = L.visibleRangeDeg * k;
      ctx.beginPath();
      ctx.rect(-L.clipHalfWidth, -hh, L.clipHalfWidth * 2, hh * 2);
      ctx.clip();
    }
    const step = L.fineStepDeg > 0 ? L.fineStepDeg : L.midStepDeg;
    const start = Math.max(-L.maxDeg, Math.ceil(lo / step) * step);
    const end = Math.min(L.maxDeg, hi);
    ctx.lineWidth = L.lineWidth;
    ctx.strokeStyle = p.white;
    // Solid lines (and dashed ones in a second pass when requested).
    for (let pass = 0; pass < (L.dashedBelow ? 2 : 1); pass++) {
      ctx.setLineDash(pass === 1 ? DASH_SHORT : DASH_NONE);
      ctx.beginPath();
      for (let d = start; d <= end + 1e-6; d += step) {
        if (Math.abs(d) < 1e-6) continue; // horizon drawn separately
        if (L.dashedBelow && (pass === 0) !== d > 0) continue;
        const half = this.ladderHalf(d);
        if (half <= 0) continue;
        const y = (pitch - d) * k;
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash(DASH_NONE);
    // Labels on major lines.
    if (L.labels !== 'none') {
      const first = Math.ceil(lo / L.majorStepDeg) * L.majorStepDeg;
      for (let d = Math.max(first, -L.maxDeg); d <= end + 1e-6; d += L.majorStepDeg) {
        if (Math.abs(d) < 1e-6) continue;
        const y = (pitch - d) * k;
        const txt = fmtInt(Math.abs(d));
        const off = L.majorHalf + 6;
        st.typeface.draw(ctx, txt, -off, y, L.labelSize, p.white, 'right', 'middle', p.black);
        if (L.labels === 'both') st.typeface.draw(ctx, txt, off, y, L.labelSize, p.white, 'left', 'middle', p.black);
      }
    }
    // Extreme-pitch chevrons pointing at the horizon.
    if (!Number.isNaN(st.chevronUpDeg)) {
      for (let d = st.chevronUpDeg + 5; d <= L.maxDeg; d += 10) {
        if (d >= lo && d <= hi) this.chevron(ctx, (pitch - d) * k, 1);
      }
    }
    if (!Number.isNaN(st.chevronDownDeg)) {
      for (let d = st.chevronDownDeg - 5; d >= -L.maxDeg; d -= 10) {
        if (d >= lo && d <= hi) this.chevron(ctx, (pitch - d) * k, -1);
      }
    }
    ctx.restore();
  }

  /** Half-width of the ladder line at pitch `d` (0 = no line). */
  private ladderHalf(d: number): number {
    const L = this.style.ladder;
    const ad = Math.abs(d);
    if (Math.abs(ad / L.majorStepDeg - Math.round(ad / L.majorStepDeg)) < 1e-6) return L.majorHalf;
    if (Math.abs(ad / L.midStepDeg - Math.round(ad / L.midStepDeg)) < 1e-6) {
      const lim = d > 0 ? L.midUpDeg : L.midDownDeg;
      return ad <= lim + 1e-6 ? L.midHalf : 0;
    }
    return L.fineStepDeg > 0 && ad <= L.fineRangeDeg + 1e-6 ? L.fineHalf : 0;
  }

  /** Red chevron at y (rolled frame); dir +1 = nose-high chevron pointing down toward the horizon. */
  private chevron(ctx: Ctx2D, y: number, dir: 1 | -1): void {
    const w = this.style.ladder.majorHalf * 0.5;
    ctx.beginPath();
    for (let i = 0; i < CHEVRON.length; i += 2) {
      const x = CHEVRON[i] * w;
      const yy = y + CHEVRON[i + 1] * w * 0.7 * dir;
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.closePath();
    fillStroke(ctx, this.style.palette.red, this.style.palette.white, 1.5);
  }

  /** Boeing amber pitch-limit indicator at the stick-shaker pitch (rolled frame). */
  private drawPli(ctx: Ctx2D): void {
    const st = this.style;
    const y = (this.state.pitch - this.state.pliDeg) * st.pxPerDeg;
    const x0 = st.symbol.size * 0.55;
    const x1 = st.symbol.size * 1.05;
    ctx.beginPath();
    for (const sgn of SIGNS) {
      ctx.moveTo(sgn * x0, y + 10);
      ctx.lineTo(sgn * x0, y);
      ctx.lineTo(sgn * x1, y);
      for (let t = 0; t < 3; t++) {
        const xx = sgn * (x0 + 8 + t * 12);
        ctx.moveTo(xx, y);
        ctx.lineTo(xx + sgn * 6, y - 8);
      }
    }
    ctx.strokeStyle = st.palette.amber;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- bank scale

  private drawBankScale(ctx: Ctx2D): void {
    const st = this.style;
    const b = st.bank;
    const p = st.palette;
    const s = this.state;
    const R = b.radius;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    // Scale (rolls with the horizon in 'ground' mode).
    ctx.save();
    if (b.pointerMode === 'ground') ctx.rotate(-s.bank * DEG2RAD);
    ctx.strokeStyle = p.white;
    ctx.lineWidth = b.lineWidth;
    ctx.beginPath();
    const maxTick = b.ticks.length > 0 ? b.ticks[b.ticks.length - 1] : 60;
    if (b.arc) ctx.arc(0, 0, R, -Math.PI / 2 - maxTick * DEG2RAD, -Math.PI / 2 + maxTick * DEG2RAD);
    for (const t of b.ticks) {
      if (b.triangleTicks.includes(t)) continue;
      const len = b.majorTicks.includes(t) ? b.majorLen : b.minorLen;
      for (const sgn of SIGNS) {
        const a = sgn * t * DEG2RAD;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        ctx.moveTo(R * sa, -R * ca);
        ctx.lineTo((R + len) * sa, -(R + len) * ca);
      }
    }
    ctx.stroke();
    for (const t of b.triangleTicks) {
      for (const sgn of SIGNS) {
        ctx.save();
        ctx.rotate(sgn * t * DEG2RAD);
        ctx.beginPath();
        ctx.moveTo(0, -R);
        ctx.lineTo(-5, -R - 10);
        ctx.lineTo(5, -R - 10);
        ctx.closePath();
        fillStroke(ctx, '', p.white, 1.5);
        ctx.restore();
      }
    }
    // Zero index: inverted white triangle.
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.lineTo(-b.pointerSize * 0.7, -R - b.pointerSize);
    ctx.lineTo(b.pointerSize * 0.7, -R - b.pointerSize);
    ctx.closePath();
    fillStroke(ctx, b.pointerMode === 'ground' ? '' : p.white, p.white, 1.5);
    ctx.restore();

    // Pointer + slip indicator (roll with the horizon in 'sky' mode).
    if (b.pointerMode === 'sky') ctx.rotate(-s.bank * DEG2RAD);
    const exceed = Math.abs(s.bank) >= b.exceedDeg;
    const pc = exceed ? p.amber : p.white;
    ctx.beginPath();
    ctx.moveTo(0, -R + 1);
    ctx.lineTo(-b.pointerSize * 0.7, -R + b.pointerSize);
    ctx.lineTo(b.pointerSize * 0.7, -R + b.pointerSize);
    ctx.closePath();
    fillStroke(ctx, exceed || this.style.slip.style === 'bar' ? pc : '', pc, 2);
    this.drawSlip(ctx, -R + b.pointerSize + st.slip.gap, pc, exceed);
    ctx.restore();
  }

  private drawSlip(ctx: Ctx2D, y: number, color: string, exceed: boolean): void {
    const sl = this.style.slip;
    if (sl.style === 'none') return;
    const slip = clamp(this.state.slip, -1, 1);
    const dx = slip * sl.travel;
    const full = Math.abs(this.state.slip) >= 0.99;
    ctx.beginPath();
    if (sl.style === 'trapezoid') {
      const w = sl.width;
      ctx.moveTo(dx - w * 0.35, y);
      ctx.lineTo(dx + w * 0.35, y);
      ctx.lineTo(dx + w * 0.5, y + sl.height);
      ctx.lineTo(dx - w * 0.5, y + sl.height);
      ctx.closePath();
    } else {
      ctx.rect(dx - sl.width / 2, y, sl.width, sl.height);
    }
    const filled = sl.style === 'bar' || (sl.fillAtFullScale && full) || exceed;
    fillStroke(ctx, filled ? color : '', color, 2);
  }

  // ---------------------------------------------------------------- symbols

  private drawFlightDirector(ctx: Ctx2D): void {
    const st = this.style;
    const fd = st.fd;
    const s = this.state;
    const p = st.palette;
    if (fd.style === 'none') return;
    const pe = clamp(s.fdPitch - s.pitch, -fd.maxPitchErrDeg, fd.maxPitchErrDeg);
    const be = clamp(s.fdBank - s.bank, -fd.maxBankErrDeg, fd.maxBankErrDeg);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    if (fd.style === 'single-cue') {
      // Command bars: a "target aircraft" at the commanded attitude.
      ctx.rotate(be * DEG2RAD);
      ctx.translate(0, -pe * st.pxPerDeg);
      const w = fd.size;
      const t = fd.thickness;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-w, w * 0.36);
      ctx.lineTo(-w, w * 0.36 + t);
      ctx.lineTo(0, t * 0.9);
      ctx.lineTo(w, w * 0.36 + t);
      ctx.lineTo(w, w * 0.36);
      ctx.closePath();
      fillStroke(ctx, p.flightDirector, p.black, 1.5);
    } else {
      // Cross pointers: vertical bar = roll command, horizontal = pitch command.
      const half = fd.size;
      const dx = be * fd.pxPerDegBank;
      const dy = -pe * st.pxPerDeg;
      ctx.lineCap = 'butt';
      line(ctx, dx, -half, dx, half, p.black, fd.thickness + 2);
      line(ctx, -half, dy, half, dy, p.black, fd.thickness + 2);
      line(ctx, dx, -half, dx, half, p.flightDirector, fd.thickness);
      line(ctx, -half, dy, half, dy, p.flightDirector, fd.thickness);
    }
    ctx.restore();
  }

  private drawFpv(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const k = st.pxPerDeg;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(-s.bank * DEG2RAD);
    const x = clamp(s.driftDeg, -20, 20) * k;
    const y = (s.pitch - s.fpaDeg) * k;
    const r = 9;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - r - 16, y);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + r + 16, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y - r - 10);
    ctx.strokeStyle = st.palette.black;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = st.palette.white;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawRisingRunway(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    // Rises from 100 px below the symbol at 200 ft RA to the symbol at 0 ft.
    const h = s.radioAltValid ? clamp(s.radioAltFt / 200, 0, 1) : 1;
    const y = this.cy + 22 + h * 90;
    const x = this.cx + clamp(s.locDev, -1.2, 1.2) * 2 * 30;
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.lineTo(x + 22, y + 12);
    ctx.lineTo(x - 22, y + 12);
    ctx.closePath();
    ctx.moveTo(x, y + 12);
    ctx.lineTo(x, this.cy + 22 + 102);
    fillStroke(ctx, '', st.palette.green, 2);
  }

  private drawSymbol(ctx: Ctx2D): void {
    const st = this.style;
    const sym = st.symbol;
    const p = st.palette;
    const x = this.cx;
    const y = this.cy;
    if (sym.style === 'delta') {
      ctx.beginPath();
      polyPath(ctx, DELTA_SHAPE, true, x, y, sym.size);
      fillStroke(ctx, p.aircraftSymbol, p.aircraftSymbolOutline, 2);
    } else if (sym.style === 'wings') {
      const w = sym.size;
      const t = sym.thickness;
      const gap = w * 0.38;
      ctx.beginPath();
      for (const sgn of SIGNS) {
        // L-shaped wing: outer bar then a downward tab at the inner end.
        ctx.moveTo(x + sgn * w, y - t / 2);
        ctx.lineTo(x + sgn * gap, y - t / 2);
        ctx.lineTo(x + sgn * gap, y + t * 2.2);
        ctx.lineTo(x + sgn * (gap + t), y + t * 2.2);
        ctx.lineTo(x + sgn * (gap + t), y + t / 2);
        ctx.lineTo(x + sgn * w, y + t / 2);
        ctx.closePath();
      }
      ctx.rect(x - t / 2, y - t / 2, t, t);
      fillStroke(ctx, p.aircraftSymbol, p.aircraftSymbolOutline, 2);
    }
  }

  // ---------------------------------------------------------------- readouts

  private drawReadouts(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const p = st.palette;
    const ra = st.radioAlt;
    if (ra && s.radioAltValid && s.radioAltFt <= ra.showBelowFt) {
      const x = this.cx + ra.dx;
      const y = this.cy + ra.dy;
      const reached = s.minimumsIsRadio && s.minimumsPhase === 'reached';
      const color = reached ? p.amber : p.white;
      if (ra.format === 'boeing-dial' && s.radioAltFt < 1000) {
        // Round dial: circumference shrinks with height (737NG FCOM).
        const rr = ra.size * 1.6;
        circle(ctx, x, y, rr + 3, p.black, '');
        ctx.beginPath();
        ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + (Math.max(0, s.radioAltFt) / 1000) * Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      st.typeface.draw(ctx, fmtInt(quantizeRadioAlt(s.radioAltFt)), x, y, ra.size, color, 'center', 'middle', p.black);
    }
    const mn = st.minimums;
    if (mn && Number.isFinite(s.minimumsFt) && s.minimumsPhase !== 'hidden' && s.minimumsVisible) {
      const reached = s.minimumsPhase === 'reached';
      const color = reached ? p.amber : p.green;
      const x = this.cx + mn.dx;
      const y = this.cy + mn.dy;
      st.typeface.draw(ctx, s.minimumsIsRadio ? 'RADIO' : 'BARO', x, y - mn.size, mn.size * 0.85, color, 'center', 'middle', p.black);
      st.typeface.draw(ctx, fmtInt(s.minimumsFt), x, y + 2, mn.size, color, 'center', 'middle', p.black);
    }
  }

  private drawFailFlag(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const txt = 'ATT';
    const w = 70;
    const h = 30;
    box(ctx, this.cx - w / 2, this.cy - h / 2, w, h, p.black, p.amber, 2);
    st.typeface.draw(ctx, txt, this.cx, this.cy, 22, p.amber, 'center', 'middle');
  }

  /** Elapsed time (s) since construction (for callers syncing blink phases). */
  get elapsed(): number {
    return this.time;
  }

  /** Blink helper bound to this instrument's clock. */
  blink(hz = 1.6): boolean {
    return blinkOn(this.time, hz);
  }
}
