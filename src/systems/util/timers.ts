/**
 * Discrete-logic helpers for system control units (GCUs, pump controllers,
 * valve sequencers, annunciator logic). All are allocation-free per update
 * and deterministic (time comes from the caller's `dt`).
 */

/** On-delay timer (TON): output goes true once the input has been true for `delayS`. */
export class OnDelay {
  delayS: number;
  elapsed = 0;
  output = false;

  constructor(delayS: number) {
    this.delayS = delayS;
  }

  update(input: boolean, dt: number): boolean {
    if (input) {
      this.elapsed += dt;
      if (this.elapsed >= this.delayS) this.output = true;
    } else {
      this.elapsed = 0;
      this.output = false;
    }
    return this.output;
  }

  reset(state = false): void {
    this.output = state;
    this.elapsed = state ? this.delayS : 0;
  }
}

/** Off-delay timer (TOF): output follows a true input immediately and stays true `delayS` after it drops. */
export class OffDelay {
  delayS: number;
  remaining = 0;
  output = false;

  constructor(delayS: number) {
    this.delayS = delayS;
  }

  update(input: boolean, dt: number): boolean {
    if (input) {
      this.remaining = this.delayS;
      this.output = true;
    } else if (this.output) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.remaining = 0;
        this.output = false;
      }
    }
    return this.output;
  }

  reset(state = false): void {
    this.output = state;
    this.remaining = state ? this.delayS : 0;
  }
}

/** Set/reset latch. `resetDominant` (default) = reset wins when both are true. */
export class Latch {
  output: boolean;
  readonly resetDominant: boolean;

  constructor(initial = false, resetDominant = true) {
    this.output = initial;
    this.resetDominant = resetDominant;
  }

  update(set: boolean, reset: boolean): boolean {
    if (this.resetDominant) {
      if (reset) this.output = false;
      else if (set) this.output = true;
    } else {
      if (set) this.output = true;
      else if (reset) this.output = false;
    }
    return this.output;
  }

  reset(state = false): void {
    this.output = state;
  }
}

/**
 * Schmitt trigger: turns on when the input reaches `on`, off when it falls to
 * `off`. With `on < off` it is inverted (e.g. a low-voltage light: on at
 * <= 24.5 V, off at >= 25.0 V -> `new Hysteresis(24.5, 25.0, true)`).
 */
export class Hysteresis {
  readonly on: number;
  readonly off: number;
  /** true = "low" trigger: active at/below `on`, cleared at/above `off`. */
  readonly low: boolean;
  output: boolean;

  constructor(on: number, off: number, low = false, initial = false) {
    this.on = on;
    this.off = off;
    this.low = low;
    this.output = initial;
  }

  update(x: number): boolean {
    if (this.low) {
      if (x <= this.on) this.output = true;
      else if (x >= this.off) this.output = false;
    } else {
      if (x >= this.on) this.output = true;
      else if (x <= this.off) this.output = false;
    }
    return this.output;
  }

  reset(state = false): void {
    this.output = state;
  }
}

/** Edge detector. `update` returns +1 on a rising edge, -1 on a falling edge, 0 otherwise. */
export class EdgeDetector {
  prev: boolean;

  constructor(initial = false) {
    this.prev = initial;
  }

  update(input: boolean): -1 | 0 | 1 {
    const p = this.prev;
    this.prev = input;
    if (input && !p) return 1;
    if (!input && p) return -1;
    return 0;
  }

  /** True only on the update where the input went false -> true. */
  rising(input: boolean): boolean {
    return this.update(input) === 1;
  }

  reset(state = false): void {
    this.prev = state;
  }
}

/** Monostable: a rising trigger produces a true output for `durationS` (retriggerable). */
export class Pulse {
  durationS: number;
  remaining = 0;
  private prev = false;

  constructor(durationS: number) {
    this.durationS = durationS;
  }

  get output(): boolean {
    return this.remaining > 0;
  }

  update(trigger: boolean, dt: number): boolean {
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dt);
    if (trigger && !this.prev) this.remaining = this.durationS;
    this.prev = trigger;
    return this.remaining > 0;
  }

  reset(): void {
    this.remaining = 0;
    this.prev = false;
  }
}

/** Accumulating stopwatch. */
export class Stopwatch {
  elapsed = 0;
  running = false;

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.elapsed = 0;
    this.running = false;
  }

  update(dt: number): number {
    if (this.running) this.elapsed += dt;
    return this.elapsed;
  }
}

/** Clamped integrator: value += rate * dt, limited to [min, max]. */
export class Integrator {
  value: number;
  min: number;
  max: number;

  constructor(initial = 0, min = -Infinity, max = Infinity) {
    this.value = initial;
    this.min = min;
    this.max = max;
  }

  update(rate: number, dt: number): number {
    let v = this.value + rate * dt;
    if (v < this.min) v = this.min;
    else if (v > this.max) v = this.max;
    this.value = v;
    return v;
  }

  reset(v: number): void {
    this.value = v;
  }
}

/**
 * Periodic on/off pattern generator (beacons, strobes, flashing annunciators).
 * `windows` are [start, end) pairs in seconds within `periodS`, e.g. a Whelen
 * double-flash strobe: `new Flasher(1.1, [0, 0.06, 0.16, 0.22])`.
 */
export class Flasher {
  readonly periodS: number;
  readonly windows: Float64Array;
  phase: number;

  constructor(periodS: number, windows: readonly number[], phase = 0) {
    if (!(periodS > 0)) throw new Error('Flasher: periodS must be > 0');
    if (windows.length % 2 !== 0) throw new Error('Flasher: windows must be [start, end] pairs');
    this.periodS = periodS;
    this.windows = Float64Array.from(windows);
    this.phase = ((phase % periodS) + periodS) % periodS;
  }

  update(dt: number): boolean {
    this.phase += dt;
    if (this.phase >= this.periodS) this.phase %= this.periodS;
    return this.isOn();
  }

  isOn(): boolean {
    const w = this.windows;
    for (let i = 0; i < w.length; i += 2) if (this.phase >= w[i] && this.phase < w[i + 1]) return true;
    return false;
  }

  reset(phase = 0): void {
    this.phase = phase;
  }
}

/**
 * First-order sigma-delta modulator: turns a duty cycle 0..1 into a 0/1
 * stream whose running average equals the duty. Used to drive boolean engine
 * inputs (e.g. `eng.starter`) with a fractional strength.
 */
export class SigmaDelta {
  acc = 0;

  update(duty: number): 0 | 1 {
    const d = duty <= 0 ? 0 : duty >= 1 ? 1 : duty;
    this.acc += d;
    if (this.acc >= 1 - 1e-9) {
      this.acc -= 1;
      return 1;
    }
    return 0;
  }

  reset(): void {
    this.acc = 0;
  }
}
