/**
 * Scalar math helpers, table interpolation, smoothing filters and a seeded
 * PRNG. Everything here is allocation-free after construction so it can be
 * used on the 120 Hz physics and 60 Hz systems hot paths.
 */
import type { Table1D, Table2D } from '../physics/types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of lerp: where `v` lies between a and b (unclamped; returns 0 if a === b). */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Maps v from [inLo, inHi] to [outLo, outHi], clamped to the output range. */
export function remapClamped(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  return lerp(outLo, outHi, clamp01(invLerp(inLo, inHi, v)));
}

/** Hermite smoothstep of t in [0,1] (clamped). */
export function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Smoothstep between edges e0 and e1. */
export function smoothstep(e0: number, e1: number, v: number): number {
  return smoothstep01(invLerp(e0, e1, v));
}

export function deg(rad: number): number {
  return rad * RAD2DEG;
}

export function rad(degrees: number): number {
  return degrees * DEG2RAD;
}

/** Wraps an angle in degrees to [0, 360). */
export function wrap360(d: number): number {
  let r = d % 360;
  if (r < 0) r += 360;
  // A tiny negative input rounds to exactly 360 after the addition.
  if (r >= 360) r -= 360;
  return r;
}

/** Wraps an angle in degrees to [-180, 180). */
export function wrap180(d: number): number {
  const r = wrap360(d + 180) - 180;
  return r;
}

/** Wraps an angle in radians to [-PI, PI). */
export function wrapPi(r: number): number {
  let x = (r + Math.PI) % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x - Math.PI;
}

/** Signed smallest difference a - b in degrees, in [-180, 180). */
export function angleDiffDeg(a: number, b: number): number {
  return wrap180(a - b);
}

/** Sign with sign(0) = 0. */
export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

// ------------------------------------------------------------------ tables

/**
 * Index `i` such that xs[i] <= x < xs[i+1] (binary search), clamped to
 * [0, n-2]. `xs` must be strictly increasing with length >= 2.
 */
export function findSegment(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n < 2 || x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 2;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Linear interpolation in a 1-D table, clamped at both ends. Binary search,
 * no allocation. A single-point table returns its only value.
 */
export function interp1(t: Table1D, x: number): number {
  const xs = t.x;
  const ys = t.y;
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const i = findSegment(xs, x);
  const x0 = xs[i];
  const f = (x - x0) / (xs[i + 1] - x0);
  return ys[i] + (ys[i + 1] - ys[i]) * f;
}

/**
 * Bilinear interpolation in a 2-D table (`z[i][j]` at `(x[i], y[j])`),
 * clamped at the edges. Binary search on both axes, no allocation.
 */
export function interp2(t: Table2D, x: number, y: number): number {
  const xs = t.x;
  const ys = t.y;
  const nx = xs.length;
  const ny = ys.length;
  if (nx === 0 || ny === 0) return 0;
  let i: number;
  let fx: number;
  if (nx === 1 || x <= xs[0]) {
    i = 0;
    fx = 0;
  } else if (x >= xs[nx - 1]) {
    i = nx - 2;
    fx = 1;
  } else {
    i = findSegment(xs, x);
    fx = (x - xs[i]) / (xs[i + 1] - xs[i]);
  }
  let j: number;
  let fy: number;
  if (ny === 1 || y <= ys[0]) {
    j = 0;
    fy = 0;
  } else if (y >= ys[ny - 1]) {
    j = ny - 2;
    fy = 1;
  } else {
    j = findSegment(ys, y);
    fy = (y - ys[j]) / (ys[j + 1] - ys[j]);
  }
  const row0 = t.z[i];
  const row1 = nx === 1 ? row0 : t.z[i + 1];
  const j1 = ny === 1 ? j : j + 1;
  const a = row0[j] + (row0[j1] - row0[j]) * fy;
  const b = row1[j] + (row1[j1] - row1[j]) * fy;
  return a + (b - a) * fx;
}

/** Convenience constructor for 1-D tables with validation (throws on bad input). */
export function table1(x: number[], y: number[]): Table1D {
  if (x.length !== y.length || x.length === 0) throw new Error('table1: x/y length mismatch or empty');
  for (let i = 1; i < x.length; i++) if (!(x[i] > x[i - 1])) throw new Error('table1: x must be strictly increasing');
  return { x, y };
}

/** Convenience constructor for 2-D tables with validation (throws on bad input). */
export function table2(x: number[], y: number[], z: number[][]): Table2D {
  if (z.length !== x.length) throw new Error('table2: z rows must match x length');
  for (const row of z) if (row.length !== y.length) throw new Error('table2: z columns must match y length');
  for (let i = 1; i < x.length; i++) if (!(x[i] > x[i - 1])) throw new Error('table2: x must be strictly increasing');
  for (let i = 1; i < y.length; i++) if (!(y[i] > y[i - 1])) throw new Error('table2: y must be strictly increasing');
  return { x, y, z };
}

// ------------------------------------------------------------------ filters

/**
 * First-order lag (exponential smoothing) with time constant `tau` seconds:
 * dy/dt = (u - y) / tau. Discretised exactly (`1 - exp(-dt/tau)`), so it is
 * stable for any dt. `tau <= 0` passes the input straight through.
 */
export class FirstOrderLag {
  value: number;
  tau: number;

  constructor(tau: number, initial = 0) {
    this.tau = tau;
    this.value = initial;
  }

  update(input: number, dt: number): number {
    if (this.tau <= 0 || dt <= 0) {
      if (this.tau <= 0) this.value = input;
      return this.value;
    }
    const a = 1 - Math.exp(-dt / this.tau);
    this.value += (input - this.value) * a;
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
  }
}

/**
 * Rate limiter: output follows the input but changes no faster than
 * `riseRate` (units/s, increasing) and `fallRate` (units/s, decreasing).
 */
export class RateLimiter {
  value: number;
  riseRate: number;
  fallRate: number;

  constructor(riseRate: number, fallRate = riseRate, initial = 0) {
    this.riseRate = riseRate;
    this.fallRate = fallRate;
    this.value = initial;
  }

  update(input: number, dt: number): number {
    const d = input - this.value;
    const up = this.riseRate * dt;
    const down = this.fallRate * dt;
    if (d > up) this.value += up;
    else if (d < -down) this.value -= down;
    else this.value = input;
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
  }
}

/**
 * Second-order critically-damped follower (useful for needle dynamics).
 * `omega` is the natural frequency (rad/s), `zeta` the damping ratio.
 * Semi-implicit Euler; stable while omega*dt < ~1.
 */
export class SecondOrderFilter {
  value: number;
  rate = 0;
  omega: number;
  zeta: number;

  constructor(omega: number, zeta = 1, initial = 0) {
    this.omega = omega;
    this.zeta = zeta;
    this.value = initial;
  }

  update(input: number, dt: number): number {
    const w = this.omega;
    const acc = w * w * (input - this.value) - 2 * this.zeta * w * this.rate;
    this.rate += acc * dt;
    this.value += this.rate * dt;
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
    this.rate = 0;
  }
}

// ------------------------------------------------------------------ PRNG

/**
 * Deterministic seeded PRNG (sfc32 core seeded through splitmix32). Same seed
 * -> same sequence on every platform. `next()` is uniform in [0, 1);
 * `gaussian()` is standard normal (Marsaglia polar method, caches the spare).
 */
export class Prng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  private spare = 0;
  private hasSpare = false;

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 to spread the seed into four state words.
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next() | 1;
    this.hasSpare = false;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    // sfc32 (Chris Doty-Humphrey, PractRand).
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Standard normal deviate (mean 0, variance 1). */
  gaussian(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    this.hasSpare = true;
    return u * m;
  }
}
