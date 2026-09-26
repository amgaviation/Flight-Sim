/**
 * Shared building blocks for the control-side system blocks (flight
 * controls, autopilot, FADEC, gear, sensors, warning).
 *
 * Everything here is allocation-free after construction so it can run on
 * the 60 Hz systems path.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import type { AudioApi } from '../../core/SimContext';
import type { WorldQuery } from '../../world/types';
import type { NavDatabase } from '../../nav/types';
import type { Table1D } from '../../physics/types';
import { interp1 } from '../../core/math';

/**
 * What a block needs from the host. A full `SimContext` satisfies it; tests
 * pass `{ vars }` (plus `events`/`audio`/`world` when the block uses them).
 */
export interface BlockEnv {
  vars: SimVars;
  events?: EventBus;
  audio?: AudioApi;
  world?: WorldQuery;
  nav?: NavDatabase;
}

/** A number or a 1-D table evaluated at some scheduling variable. */
export type Schedule = number | Table1D;

/** Evaluates a `Schedule` at `x` (constants ignore `x`). */
export function sched(s: Schedule, x: number): number {
  return typeof s === 'number' ? s : interp1(s, x);
}

/** Symmetric deadband: 0 inside ±db, shifted linearly outside (continuous). */
export function deadband(x: number, db: number): number {
  if (x > db) return x - db;
  if (x < -db) return x + db;
  return 0;
}

/** Clamps `x` to ±`lim`. */
export function clampAbs(x: number, lim: number): number {
  return x > lim ? lim : x < -lim ? -lim : x;
}

/**
 * PID controller with integrator clamping (anti-windup), optional output
 * clamp with conditional integration, and a filtered derivative.
 *
 * `update(err, dt, rate?)`: when `rate` (d(measurement)/dt) is supplied the
 * derivative term is `-kd * rate` (derivative on measurement: no kick on
 * set-point changes); otherwise it is `kd * d(err)/dt` filtered with `dTau`.
 */
export class Pid {
  kp: number;
  ki: number;
  kd: number;
  iMin: number;
  iMax: number;
  outMin: number;
  outMax: number;
  /** Derivative filter time constant (s). */
  dTau: number;
  integral = 0;
  output = 0;
  private prevErr = NaN;
  private dFilt = 0;

  constructor(opts: { kp: number; ki?: number; kd?: number; iLimit?: number; outLimit?: number; dTau?: number }) {
    this.kp = opts.kp;
    this.ki = opts.ki ?? 0;
    this.kd = opts.kd ?? 0;
    const il = opts.iLimit ?? Infinity;
    this.iMin = -il;
    this.iMax = il;
    const ol = opts.outLimit ?? Infinity;
    this.outMin = -ol;
    this.outMax = ol;
    this.dTau = opts.dTau ?? 0.1;
  }

  update(err: number, dt: number, rate?: number): number {
    if (dt <= 0) return this.output;
    let d: number;
    if (rate !== undefined) {
      d = -rate;
    } else {
      const raw = Number.isNaN(this.prevErr) ? 0 : (err - this.prevErr) / dt;
      const a = this.dTau > 0 ? 1 - Math.exp(-dt / this.dTau) : 1;
      this.dFilt += (raw - this.dFilt) * a;
      d = this.dFilt;
    }
    this.prevErr = err;
    const pTerm = this.kp * err;
    const dTerm = this.kd * d;
    // Conditional integration: do not wind up further into a saturated output.
    const trial = pTerm + this.ki * this.integral + dTerm;
    const saturatedHigh = trial >= this.outMax && err > 0;
    const saturatedLow = trial <= this.outMin && err < 0;
    if (this.ki !== 0 && !saturatedHigh && !saturatedLow) {
      this.integral += err * dt;
      if (this.integral > this.iMax) this.integral = this.iMax;
      else if (this.integral < this.iMin) this.integral = this.iMin;
    }
    let u = pTerm + this.ki * this.integral + dTerm;
    if (u > this.outMax) u = this.outMax;
    else if (u < this.outMin) u = this.outMin;
    this.output = u;
    return u;
  }

  /** Clears the state. `integralOutput` preloads the integrator so the I-term equals that value. */
  reset(integralOutput = 0): void {
    this.integral = this.ki !== 0 ? integralOutput / this.ki : 0;
    this.prevErr = NaN;
    this.dFilt = 0;
    this.output = integralOutput;
  }
}

/** First-order washout (high-pass) filter: y = s·tau/(s·tau + 1) x. */
export class Washout {
  tau: number;
  private lp = 0;
  private init = false;

  constructor(tau: number) {
    this.tau = tau;
  }

  update(x: number, dt: number): number {
    if (!this.init) {
      this.lp = x;
      this.init = true;
    }
    if (this.tau > 0 && dt > 0) this.lp += (x - this.lp) * (1 - Math.exp(-dt / this.tau));
    return x - this.lp;
  }

  reset(x = 0): void {
    this.lp = x;
    this.init = true;
  }
}

/**
 * Filtered derivative ("rate taker"): d/dt of the input through a
 * first-order lag of `tau`. `angle` mode unwraps degrees.
 */
export class RateFilter {
  tau: number;
  rate = 0;
  private prev = NaN;
  private readonly angle: boolean;

  constructor(tau = 0.5, angle = false) {
    this.tau = tau;
    this.angle = angle;
  }

  update(x: number, dt: number): number {
    if (dt <= 0) return this.rate;
    if (Number.isNaN(this.prev)) {
      this.prev = x;
      return this.rate;
    }
    let d = x - this.prev;
    if (this.angle) {
      d = ((((d + 180) % 360) + 360) % 360) - 180;
    }
    this.prev = x;
    const raw = d / dt;
    const a = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
    this.rate += (raw - this.rate) * a;
    return this.rate;
  }

  reset(x = NaN, rate = 0): void {
    this.prev = x;
    this.rate = rate;
  }
}

/**
 * Subscribes `fn` to `name` when an EventBus is present and records the
 * unsubscribe function in `offs` (blocks call every entry on dispose()).
 */
export function listen(events: EventBus | undefined, offs: (() => void)[], name: string, fn: (payload?: unknown) => void): void {
  if (!events) return;
  offs.push(events.on(name, fn));
}

/** Reads a numeric event payload (number or `{ value }` / `{ delta }`), else `fallback`. */
export function payloadNumber(p: unknown, fallback: number): number {
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  if (p && typeof p === 'object') {
    const o = p as { value?: unknown; delta?: unknown; steps?: unknown };
    if (typeof o.value === 'number') return o.value;
    if (typeof o.delta === 'number') return o.delta;
    if (typeof o.steps === 'number') return o.steps;
  }
  return fallback;
}

/** Reads a boolean event payload (boolean, number, or `{ pressed }`), else `fallback`. */
export function payloadBool(p: unknown, fallback: boolean): boolean {
  if (typeof p === 'boolean') return p;
  if (typeof p === 'number') return p !== 0;
  if (p && typeof p === 'object') {
    const o = p as { pressed?: unknown; value?: unknown };
    if (typeof o.pressed === 'boolean') return o.pressed;
    if (typeof o.value === 'boolean') return o.value;
    if (typeof o.value === 'number') return o.value !== 0;
  }
  return fallback;
}

/** Signed heading error `target - current` in [-180, 180). */
export function headingError(target: number, current: number): number {
  return ((((target - current + 180) % 360) + 360) % 360) - 180;
}

/** Normalizes a heading to [0, 360). */
export function norm360(h: number): number {
  const r = ((h % 360) + 360) % 360;
  return r >= 360 ? r - 360 : r;
}
