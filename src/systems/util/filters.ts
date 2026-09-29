/**
 * Continuous-signal filters for system models. The first-order lag, rate
 * limiter and second-order filter live in `core/math` (shared with physics
 * and avionics) and are re-exported here so system blocks have one import.
 */
export { FirstOrderLag, RateLimiter, SecondOrderFilter, approach, clamp, clamp01, lerp, interp1 } from '../../core/math';

/**
 * First-order lag whose output slope is additionally rate-limited (e.g. a
 * valve actuator: exponential approach near the target, bounded slew speed
 * far from it).
 */
export class LagRateLimiter {
  value: number;
  tau: number;
  maxRate: number;

  constructor(tau: number, maxRate: number, initial = 0) {
    this.tau = tau;
    this.maxRate = maxRate;
    this.value = initial;
  }

  update(input: number, dt: number): number {
    if (dt <= 0) return this.value;
    let target = input;
    if (this.tau > 0) {
      const a = 1 - Math.exp(-dt / this.tau);
      target = this.value + (input - this.value) * a;
    }
    const maxStep = this.maxRate * dt;
    const d = target - this.value;
    this.value += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
    return this.value;
  }

  reset(v: number): void {
    this.value = v;
  }
}

/**
 * Actuator position 0..1 moving at constant speed (full travel in `travelS`)
 * toward a commanded position; models motorized valves and outflow valves.
 * `stuck` freezes the position (failure).
 */
export class Actuator {
  position: number;
  travelS: number;
  stuck = false;

  constructor(travelS: number, initial = 0) {
    this.travelS = travelS;
    this.position = initial;
  }

  /** True while the actuator is moving toward a different command. */
  inTransit = false;

  update(command: number, dt: number): number {
    const cmd = command < 0 ? 0 : command > 1 ? 1 : command;
    if (this.stuck) {
      this.inTransit = Math.abs(cmd - this.position) > 1e-3;
      return this.position;
    }
    if (this.travelS <= 0) {
      this.position = cmd;
      this.inTransit = false;
      return cmd;
    }
    const step = dt / this.travelS;
    const d = cmd - this.position;
    if (Math.abs(d) <= step) {
      this.position = cmd;
      this.inTransit = false;
    } else {
      this.position += d > 0 ? step : -step;
      this.inTransit = true;
    }
    return this.position;
  }

  reset(p: number): void {
    this.position = p < 0 ? 0 : p > 1 ? 1 : p;
    this.inTransit = false;
  }
}
