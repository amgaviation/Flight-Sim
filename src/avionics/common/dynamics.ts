/**
 * Motion models for indicators: damped needles, filtered rates for trend
 * vectors, and blink timing. All allocation-free.
 */

/** Options for `NeedleDynamics`. */
export interface NeedleDynamicsOptions {
  /**
   * Undamped natural frequency (rad/s). Electromechanical instrument
   * movements settle in roughly 0.3..1 s: omega 8..15. EST: typical
   * d'Arsonval meter movement / pneumatic capsule response.
   */
  omega?: number;
  /** Damping ratio (1 = critical; 0.6..0.8 gives a slight, realistic overshoot). */
  zeta?: number;
  /** Maximum needle speed (units/s), e.g. a geared movement. Infinity = none. */
  maxRate?: number;
  /** Mechanical stops (the needle rests on a stop pin outside the scale). */
  min?: number;
  max?: number;
  /** Coefficient of restitution when hitting a stop (0 = dead stop, 0.3 = small bounce). */
  restitution?: number;
  /** Treat the value as an angle in degrees and chase the shortest way round (compass cards). */
  circular?: boolean;
  initial?: number;
}

/**
 * Damped second-order needle: x'' = w^2 (target - x) - 2 zeta w x', with an
 * optional rate limit and end stops. Integrated semi-implicitly with
 * sub-steps so that w*dt <= 0.25 for any frame time (stable through frame
 * hitches). For circular scales the error is wrapped to [-180, 180) and the
 * value kept in [0, 360).
 */
export class NeedleDynamics {
  value: number;
  rate = 0;
  omega: number;
  zeta: number;
  maxRate: number;
  min: number;
  max: number;
  restitution: number;
  readonly circular: boolean;

  constructor(opts: NeedleDynamicsOptions = {}) {
    this.omega = opts.omega ?? 10;
    this.zeta = opts.zeta ?? 0.75;
    this.maxRate = opts.maxRate ?? Infinity;
    this.min = opts.min ?? -Infinity;
    this.max = opts.max ?? Infinity;
    this.restitution = opts.restitution ?? 0.2;
    this.circular = opts.circular ?? false;
    this.value = opts.initial ?? 0;
  }

  /** Advances the needle toward `target` by `dt` seconds; returns the new value. */
  update(target: number, dt: number): number {
    if (!(dt > 0)) return this.value;
    const w = this.omega;
    const n = Math.max(1, Math.ceil((w * dt) / 0.25));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      let err = target - this.value;
      if (this.circular) err = ((((err + 180) % 360) + 360) % 360) - 180;
      const acc = w * w * err - 2 * this.zeta * w * this.rate;
      this.rate += acc * h;
      if (this.rate > this.maxRate) this.rate = this.maxRate;
      else if (this.rate < -this.maxRate) this.rate = -this.maxRate;
      this.value += this.rate * h;
      if (this.value < this.min) {
        this.value = this.min;
        if (this.rate < 0) this.rate = -this.rate * this.restitution;
      } else if (this.value > this.max) {
        this.value = this.max;
        if (this.rate > 0) this.rate = -this.rate * this.restitution;
      }
    }
    if (this.circular) this.value = ((this.value % 360) + 360) % 360;
    return this.value;
  }

  /** Jumps to `value` with zero velocity. */
  reset(value: number): void {
    this.value = value;
    this.rate = 0;
  }
}

/**
 * Filtered time derivative for trend vectors: differentiates the input and
 * smooths the result with a first-order lag of `tau` seconds (raw
 * differentiation of 30 Hz display data is too noisy to draw).
 * EST: tau 1.0 s gives a steady G1000-like trend vector.
 */
export class RateEstimator {
  rate = 0;
  tau: number;
  private last = NaN;

  constructor(tau = 1) {
    this.tau = tau;
  }

  update(value: number, dt: number): number {
    if (!(dt > 0)) return this.rate;
    if (Number.isNaN(this.last) || !Number.isFinite(value)) {
      this.last = value;
      return this.rate;
    }
    const raw = (value - this.last) / dt;
    this.last = value;
    const a = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
    this.rate += (raw - this.rate) * a;
    return this.rate;
  }

  /** Circular-input variant (headings): differentiates the wrapped difference. */
  updateAngle(deg: number, dt: number): number {
    if (!(dt > 0)) return this.rate;
    if (Number.isNaN(this.last)) {
      this.last = deg;
      return this.rate;
    }
    let d = deg - this.last;
    d = ((((d + 180) % 360) + 360) % 360) - 180;
    this.last = deg;
    const a = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
    this.rate += (d / dt - this.rate) * a;
    return this.rate;
  }

  reset(value = NaN): void {
    this.last = value;
    this.rate = 0;
  }
}

/**
 * Blink timing helper: true during the lit part of each cycle.
 * EST default 1.6 Hz: flight-deck flashing cues (G1000 altitude alert box,
 * 737 minimums readout) blink at roughly 1-2 Hz in manufacturer videos.
 */
export function blinkOn(timeS: number, hz = 1.6, duty = 0.5): boolean {
  const f = timeS * hz;
  return f - Math.floor(f) < duty;
}

/**
 * Timed flasher: `trigger()` starts flashing for `duration` seconds
 * (Infinity = until `stop()`); `update(dt)` advances; `visible` is true
 * whenever the element should be drawn (always true when not flashing).
 */
export class Flasher {
  duration: number;
  hz: number;
  private remaining = 0;
  private t = 0;

  constructor(duration = 5, hz = 1.6) {
    this.duration = duration;
    this.hz = hz;
  }

  trigger(duration = this.duration): void {
    this.remaining = duration;
    this.t = 0;
  }

  stop(): void {
    this.remaining = 0;
  }

  get active(): boolean {
    return this.remaining > 0;
  }

  /** Current visibility (lit phase) while flashing; true when idle. */
  get visible(): boolean {
    return this.remaining <= 0 || blinkOn(this.t, this.hz);
  }

  update(dt: number): void {
    if (this.remaining > 0) {
      this.remaining -= dt;
      this.t += dt;
    }
  }
}
