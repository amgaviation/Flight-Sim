/**
 * Pure axis processing for joysticks, yokes, throttle quadrants and pedals:
 * calibration, inversion, deadzone and response curve. No DOM, no state;
 * unit tested in tests/app/input.test.ts.
 */

export interface AxisCalibration {
  /** Raw reading (Gamepad API units, nominally -1..1) at the physical minimum, centre and maximum. */
  min: number;
  center: number;
  max: number;
}

export const DEFAULT_CALIBRATION: Readonly<AxisCalibration> = { min: -1, center: 0, max: 1 };

export interface AxisShape {
  invert: boolean;
  /** Fraction of travel around centre (bipolar) or at the low end (unipolar) that reads 0. 0..0.5 */
  deadzone: number;
  /**
   * Response curve 0..1: 0 = linear; higher = finer control near centre
   * (out = (1 - c) x + c x^3 for bipolar axes, (1 - c) x + c x^2 for unipolar).
   */
  curve: number;
  /** Output scale (sensitivity), 0.1..1. */
  sensitivity: number;
}

export const DEFAULT_SHAPE: Readonly<AxisShape> = { invert: false, deadzone: 0.04, curve: 0, sensitivity: 1 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Raw reading -> -1..1 using a three-point calibration (piecewise linear around the centre). */
export function calibrateBipolar(raw: number, cal: AxisCalibration): number {
  if (!Number.isFinite(raw)) return 0;
  const { min, center, max } = cal;
  // Support reversed hardware (min > max) by normalising the direction.
  const dir = max >= min ? 1 : -1;
  const lo = dir > 0 ? min : max;
  const hi = dir > 0 ? max : min;
  const c = clamp(center, lo, hi);
  let v: number;
  if (raw >= c) v = hi - c > 1e-6 ? (raw - c) / (hi - c) : 0;
  else v = c - lo > 1e-6 ? (raw - c) / (c - lo) : 0;
  return clamp(v * dir, -1, 1);
}

/** Raw reading -> 0..1 between the calibrated min and max (throttles, toe brakes, mixture). */
export function calibrateUnipolar(raw: number, cal: AxisCalibration): number {
  if (!Number.isFinite(raw)) return 0;
  const span = cal.max - cal.min;
  if (Math.abs(span) < 1e-6) return 0;
  return clamp((raw - cal.min) / span, 0, 1);
}

/** Centre deadzone with rescaling so full deflection still reaches +-1. */
export function deadzoneBipolar(v: number, dz: number): number {
  const d = clamp(dz, 0, 0.5);
  const a = Math.abs(v);
  if (a <= d) return 0;
  return (Math.sign(v) * (a - d)) / (1 - d);
}

/** Low-end deadzone (and a small high-end saturation of the same size) for unipolar axes. */
export function deadzoneUnipolar(v: number, dz: number): number {
  const d = clamp(dz, 0, 0.5) * 0.5;
  if (v <= d) return 0;
  if (v >= 1 - d) return 1;
  return (v - d) / (1 - 2 * d);
}

export function curveBipolar(v: number, c: number): number {
  const k = clamp(c, 0, 1);
  return (1 - k) * v + k * v * v * v;
}

export function curveUnipolar(v: number, c: number): number {
  const k = clamp(c, 0, 1);
  return (1 - k) * v + k * v * v;
}

/** Full chain for a bipolar control axis (pitch, roll, yaw, tiller): -1..1. */
export function processBipolar(raw: number, cal: AxisCalibration, s: AxisShape): number {
  let v = calibrateBipolar(raw, cal);
  if (s.invert) v = -v;
  v = deadzoneBipolar(v, s.deadzone);
  v = curveBipolar(v, s.curve);
  return clamp(v * clamp(s.sensitivity, 0.05, 1), -1, 1);
}

/** Full chain for a unipolar axis (throttle, mixture, brakes): 0..1. */
export function processUnipolar(raw: number, cal: AxisCalibration, s: AxisShape): number {
  let v = calibrateUnipolar(raw, cal);
  if (s.invert) v = 1 - v;
  v = deadzoneUnipolar(v, s.deadzone);
  v = curveUnipolar(v, s.curve);
  return clamp(v * clamp(s.sensitivity, 0.05, 1), 0, 1);
}

/**
 * Keyboard axis ramp: while a direction key is held the value moves toward
 * +-1 at `rate` per second; released, it returns to 0 at `returnRate`
 * (a spring-centred control). `hold = 0` means no key.
 */
export function rampKeyAxis(current: number, hold: -1 | 0 | 1, dt: number, rate: number, returnRate: number): number {
  if (hold !== 0) {
    // Reversing direction snaps through centre quickly, as a pilot would.
    const r = Math.sign(current) !== hold && current !== 0 ? Math.max(rate, returnRate) : rate;
    return clamp(current + hold * r * dt, -1, 1);
  }
  if (current > 0) return Math.max(0, current - returnRate * dt);
  if (current < 0) return Math.min(0, current + returnRate * dt);
  return 0;
}

/** Records the extremes seen during a calibration sweep. */
export class CalibrationRecorder {
  min = Infinity;
  max = -Infinity;
  last = 0;
  samples = 0;
  add(raw: number): void {
    if (!Number.isFinite(raw)) return;
    this.last = raw;
    this.samples++;
    if (raw < this.min) this.min = raw;
    if (raw > this.max) this.max = raw;
  }
  /** Calibration from the sweep; the current reading becomes the centre (for bipolar axes). */
  result(centerRaw: number = this.last): AxisCalibration | null {
    if (this.samples < 2 || this.max - this.min < 0.2) return null;
    return { min: this.min, center: clamp(centerRaw, this.min, this.max), max: this.max };
  }
}
