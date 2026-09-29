/**
 * Pure display math shared by the glass primitives and the analog gauges:
 * moving-tape scaling, bug placement, odometer (rolling drum) digits,
 * compass-rose angles, deviation scaling, non-linear scales and a local
 * map projection. Everything is allocation-free (results go into caller
 * supplied `out` objects where more than one number is returned).
 *
 * Screen convention: canvas pixels, x right, y DOWN. Angles on round
 * displays are measured clockwise from 12 o'clock ("up"), in radians
 * unless the name says Deg.
 */
import { DEG2RAD, clamp, wrap180, wrap360 } from '../../core/math';

// ------------------------------------------------------------------ tapes

/**
 * Screen y of `value` on a vertical moving tape whose reference line (the
 * readout pointer) is at `centerY` and currently reads `current`. Larger
 * values are drawn higher (smaller y).
 */
export function tapeY(value: number, current: number, centerY: number, pxPerUnit: number): number {
  return centerY - (value - current) * pxPerUnit;
}

/** Inverse of `tapeY`: the tape value drawn at screen y. */
export function tapeValueAtY(y: number, current: number, centerY: number, pxPerUnit: number): number {
  return current + (centerY - y) / pxPerUnit;
}

/** Smallest multiple of `step` that is >= v (first tick to draw). */
export function firstMultipleAtOrAbove(v: number, step: number): number {
  return Math.ceil(v / step - 1e-9) * step;
}

/** Largest multiple of `step` that is <= v. */
export function lastMultipleAtOrBelow(v: number, step: number): number {
  return Math.floor(v / step + 1e-9) * step;
}

/**
 * Where a bug at `y` is drawn on a tape spanning [top, bottom]:
 * clamped to the edges (Garmin parks off-scale selected-altitude bugs at
 * the tape edge; G1000 PG 190-00494-04 §2.1 "If the Selected Altitude
 * exceeds the range shown on the tape, the bug appears at the upper or
 * lower edge of the tape").
 */
export function clampBugY(y: number, top: number, bottom: number): number {
  return y < top ? top : y > bottom ? bottom : y;
}

/** -1 when `y` is above the tape (value off-scale high), +1 below, 0 on scale. */
export function bugOffscale(y: number, top: number, bottom: number): -1 | 0 | 1 {
  return y < top ? -1 : y > bottom ? 1 : 0;
}

/** Value predicted `seconds` ahead at constant rate (trend vectors). */
export function trendValue(value: number, ratePerS: number, seconds: number): number {
  return value + ratePerS * seconds;
}

// ------------------------------------------------------------------ rolling drums

/**
 * Continuous drum position for an odometer-style digit of weight `weight`
 * (1 = ones, 10 = tens, ...). The integer part (mod the drum length) is the
 * symbol centred in the window; the fraction is how far the next symbol has
 * rolled in. A drum only rolls while the lower digits pass through their last
 * `carryWindow` units (e.g. the tens drum of a speed readout rolls while the
 * ones go 9 -> 10, so carryWindow = 1). For the lowest, continuously rolling
 * drum pass carryWindow = weight.
 *
 * Garmin altitude readout: last two digits are one drum in 20 ft steps
 * (G1000 PG §2.1 "minor tick marks ... 20 feet", 737NG FCOM "increments of
 * thousands, hundreds and twenty feet"): use drumPosition(alt, 20, 20) for
 * the 20s drum (5 symbols: 00 20 40 60 80) and drumPosition(alt, 100, 20)
 * for the hundreds drum.
 *
 * Only defined for value >= 0; callers draw a minus sign separately.
 */
export function drumPosition(value: number, weight: number, carryWindow: number): number {
  const v = value < 0 ? 0 : value;
  const whole = Math.floor(v / weight);
  const rem = v - whole * weight;
  const roll = (rem - (weight - carryWindow)) / carryWindow;
  return whole + (roll <= 0 ? 0 : roll >= 1 ? 1 : roll);
}

// ------------------------------------------------------------------ round displays

/**
 * Screen angle (rad, clockwise from up) at which `bearingDeg` is drawn on a
 * compass rose rotated so that `upDeg` (heading, track or 0 for north-up)
 * is at the top. Result in [-PI, PI).
 */
export function roseAngle(bearingDeg: number, upDeg: number): number {
  return wrap180(bearingDeg - upDeg) * DEG2RAD;
}

/** x of a point at radius r and screen angle a (clockwise from up) around (cx, cy). */
export function polarX(cx: number, r: number, a: number): number {
  return cx + r * Math.sin(a);
}

/** y of a point at radius r and screen angle a (clockwise from up) around (cx, cy). */
export function polarY(cy: number, r: number, a: number): number {
  return cy - r * Math.cos(a);
}

/**
 * Linear dial: needle angle for `value` on a scale from (vMin at aMin) to
 * (vMax at aMax). Angles in any unit; clamped to the scale ends unless
 * `clampToScale` is false (needles resting on a stop pin use clamping).
 */
export function dialAngle(value: number, vMin: number, vMax: number, aMin: number, aMax: number, clampToScale = true): number {
  let t = (value - vMin) / (vMax - vMin);
  if (clampToScale) t = t < 0 ? 0 : t > 1 ? 1 : t;
  return aMin + (aMax - aMin) * t;
}

/**
 * Piecewise-linear scale through (xs[i], ys[i]), xs strictly increasing,
 * clamped at the ends. Used for non-linear dials (VSI, airspeed).
 */
export function piecewise(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (i < n - 1 && xs[i] < x) i++;
  const x0 = xs[i - 1];
  const t = (x - x0) / (xs[i] - x0);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}

/**
 * Symmetric non-linear scale for signed quantities (vertical speed): the
 * table describes |x| -> position (xs[0] must be 0), the sign is re-applied.
 */
export function piecewiseSigned(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const p = piecewise(xs, ys, Math.abs(x));
  return x < 0 ? -p : p;
}

/** Inverse of `piecewise` for monotonically increasing ys. */
export function piecewiseInverse(xs: ArrayLike<number>, ys: ArrayLike<number>, y: number): number {
  return piecewise(ys, xs, y);
}

// ------------------------------------------------------------------ deviation

/**
 * Pixel displacement of a deviation pointer. `dev` is normalised so that
 * +/-1 = full scale = `dots` dots (the `nav{r}.cdi` / `fms.cdi` / `gs_dev`
 * convention in core/vars.ts); `overshoot` extra dots of travel are allowed
 * before the pointer pegs (G1000 CDI pegs at the last dot; 0 = none).
 */
export function deviationPx(dev: number, dots: number, dotSpacingPx: number, overshoot = 0): number {
  const lim = 1 + overshoot / dots;
  return clamp(dev, -lim, lim) * dots * dotSpacingPx;
}

/** True when a normalised deviation is beyond full scale (e.g. to show XTK). */
export function deviationPegged(dev: number): boolean {
  return dev <= -1 || dev >= 1;
}

// ------------------------------------------------------------------ attitude

/** Pixel offset (down = +) of the pitch line `lineDeg` when the aircraft pitch is `pitchDeg`. */
export function pitchLineOffsetPx(lineDeg: number, pitchDeg: number, pxPerDeg: number): number {
  return (pitchDeg - lineDeg) * pxPerDeg;
}

/** Standard-rate turn, 3 deg/s (FAA-H-8083-15B Instrument Flying Handbook ch.5). */
export const STANDARD_RATE_DPS = 3;

/**
 * Bank angle (deg) for a standard-rate turn at `tasKt`: tan(phi) = V*omega/g.
 * The "15% of TAS + 7" rule of thumb (IFH) approximates this.
 */
export function standardRateBankDeg(tasKt: number): number {
  const v = tasKt * 0.514444; // kt -> m/s (1852/3600)
  const omega = STANDARD_RATE_DPS * DEG2RAD;
  return (Math.atan((v * omega) / 9.80665) * 180) / Math.PI;
}

// ------------------------------------------------------------------ map projection

/** Output of `projectLocalNm`. */
export interface LocalXY {
  x: number;
  y: number;
}

/**
 * Equirectangular local projection about (refLat, refLon): x = east nm,
 * y = north nm. `cosRefLat` = cos(refLat) precomputed by the caller.
 * SCOPE: within 300 nm of the reference the distortion is < 2 % at mid
 * latitudes, below a pixel for typical map ranges; the map re-references
 * itself on the aircraft every frame so the error never accumulates.
 */
export function projectLocalNm(lat: number, lon: number, refLat: number, refLon: number, cosRefLat: number, out: LocalXY): LocalXY {
  let dLon = lon - refLon;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  out.x = dLon * 60 * cosRefLat;
  out.y = (lat - refLat) * 60;
  return out;
}

/** Inverse of `projectLocalNm`. */
export function unprojectLocalNm(x: number, y: number, refLat: number, refLon: number, cosRefLat: number, out: { lat: number; lon: number }): { lat: number; lon: number } {
  out.lat = refLat + y / 60;
  out.lon = refLon + x / (60 * (cosRefLat > 1e-6 ? cosRefLat : 1e-6));
  if (out.lon > 180) out.lon -= 360;
  else if (out.lon < -180) out.lon += 360;
  return out;
}

/**
 * Rotates local east/north nm into screen pixels for a map whose "up"
 * direction is `upDeg` (0 = north-up, track for track-up), centred on
 * (cx, cy) with `pxPerNm`. y grows downward on screen.
 */
export function localToScreen(xNm: number, yNm: number, upSin: number, upCos: number, cx: number, cy: number, pxPerNm: number, out: LocalXY): LocalXY {
  // Rotate the world by -up: a point on bearing `up` ends up straight ahead.
  const rx = xNm * upCos - yNm * upSin;
  const ry = xNm * upSin + yNm * upCos;
  out.x = cx + rx * pxPerNm;
  out.y = cy - ry * pxPerNm;
  return out;
}

/** Normalised 0..360 wrap (re-export for display code). */
export function norm360(deg: number): number {
  return wrap360(deg);
}
