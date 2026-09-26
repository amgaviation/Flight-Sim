/**
 * Pure logic for rotary controls: detented selectors, continuous knobs and
 * encoders, thumbwheels, fuel selectors.
 *
 * Detent mode (`positions` given): the knob has discrete positions in
 * clockwise order. Optional per-position spring return (e.g. magneto START
 * springs back to BOTH, "TEST" positions) and gated positions that need a
 * push/lift to enter or leave (e.g. a fuel selector OFF position). A gated
 * position can be passed by a deliberate action (click) or by a new motion
 * that starts at least `gatePauseS` after the previous one; a fast wheel spin
 * or a continuous drag stops at the gate.
 *
 * Continuous mode: value in [min, max] (clamped or wrapped) changing by
 * `step` per detent click, with speed-dependent acceleration: when the knob
 * is turned faster than `accel.slow` clicks/s the step grows to `accel.mid`,
 * and above `accel.fast` clicks/s to `accel.fastStep` (e.g. heading bug
 * 1 deg -> 10 deg). Values are quantized to the step grid to avoid float
 * drift.
 */

export interface KnobPosition {
  value: number;
  label?: string;
  /** Spring-loaded: index this position returns to when released. */
  spring?: number;
  /** Needs a push/lift to enter or leave. */
  gated?: boolean;
}

export interface KnobAccel {
  /** Step used when turning fast. */
  fastStep: number;
  /** Intermediate step (default: geometric mean of step and fastStep, rounded to step). */
  midStep?: number;
  /** Clicks per second above which midStep applies (default 6). */
  slow?: number;
  /** Clicks per second above which fastStep applies (default 14). */
  fast?: number;
}

export interface KnobLogicOptions {
  /** Detent positions (clockwise). Presence selects detent mode. */
  positions?: KnobPosition[];
  /** Detent mode: wrap past the last position (continuous-rotation selectors). */
  wrap?: boolean;
  /** Continuous mode range and step. */
  min?: number;
  max?: number;
  step?: number;
  accel?: KnobAccel;
  /** Initial value (continuous) or index (detent). */
  initial?: number;
  /** Seconds a spring position is held when reached without a pointer hold. Default 0.3. */
  momentaryHoldS?: number;
  /** Minimum pause (s) before a new motion may pass a gated detent. Default 0.35. */
  gatePauseS?: number;
}

export interface TurnResult {
  /** Change in value (continuous) or index (detent). */
  delta: number;
  /** Detent clicks actually taken. */
  clicks: number;
  /** The turn stopped at a gate or end stop. */
  blocked: 'none' | 'limit' | 'gate';
}

export class KnobLogic {
  readonly detented: boolean;
  readonly positions: readonly KnobPosition[];
  readonly wrap: boolean;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly accel: Required<KnobAccel> | null;
  readonly momentaryHoldS: number;
  readonly gatePauseS: number;
  /** Continuous value (continuous mode) or the value of the current position (detent mode). */
  value: number;
  /** Current detent index (detent mode). */
  index = 0;
  /** Pointer is holding a spring position. */
  held = false;
  /** Estimated turn rate (clicks/s). */
  rate = 0;
  private lastTurnS = -Infinity;
  private holdTimer = 0;
  private decimals: number;

  constructor(o: KnobLogicOptions) {
    this.positions = o.positions ?? [];
    this.detented = this.positions.length > 0;
    this.wrap = o.wrap ?? false;
    this.momentaryHoldS = o.momentaryHoldS ?? 0.3;
    this.gatePauseS = o.gatePauseS ?? 0.35;
    if (this.detented) {
      this.min = 0;
      this.max = this.positions.length - 1;
      this.step = 1;
      this.accel = null;
      this.index = Math.max(0, Math.min(this.positions.length - 1, Math.round(o.initial ?? 0)));
      this.value = this.positions[this.index].value;
      this.decimals = 0;
    } else {
      this.min = o.min ?? 0;
      this.max = o.max ?? 1;
      this.step = o.step ?? (this.max - this.min) / 20;
      if (!(this.step > 0)) throw new Error('KnobLogic: step must be > 0');
      this.decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(this.step)) + 2));
      if (o.accel) {
        const mid = o.accel.midStep ?? Math.max(this.step, Math.round(Math.sqrt(this.step * o.accel.fastStep) / this.step) * this.step);
        this.accel = { fastStep: o.accel.fastStep, midStep: mid, slow: o.accel.slow ?? 6, fast: o.accel.fast ?? 14 };
      } else this.accel = null;
      this.value = this.clampOrWrap(o.initial ?? this.min);
    }
  }

  /** Label of the current detent (detent mode) or ''. */
  get label(): string {
    return this.detented ? (this.positions[this.index].label ?? '') : '';
  }

  /** Step size the next click will use given the current turn-rate estimate. */
  currentStep(): number {
    if (!this.accel) return this.step;
    if (this.rate >= this.accel.fast) return this.accel.fastStep;
    if (this.rate >= this.accel.slow) return this.accel.midStep;
    return this.step;
  }

  /**
   * Turns by `clicks` detents (+ = clockwise) at time `nowS` (seconds, any
   * monotonic clock; used for acceleration and gate pauses).
   * `deliberate` = a click (always passes gates); `hold` keeps a spring
   * position until release().
   */
  turn(clicks: number, nowS: number, opts: { deliberate?: boolean; hold?: boolean } = {}): TurnResult {
    const n = Math.trunc(clicks);
    if (n === 0) return { delta: 0, clicks: 0, blocked: 'none' };
    const dt = nowS - this.lastTurnS;
    const newMotion = dt >= this.gatePauseS;
    if (dt > 0.35) this.rate = 0;
    else {
      const inst = Math.abs(n) / Math.max(dt, 0.004);
      this.rate = this.rate * 0.5 + inst * 0.5;
    }
    this.lastTurnS = nowS;
    return this.detented ? this.turnDetent(n, opts.deliberate === true || newMotion, opts.hold === true) : this.turnContinuous(n);
  }

  /** Jumps to a detent index (detent mode), ignoring gates. */
  setIndex(i: number): boolean {
    if (!this.detented) return false;
    const t = Math.max(0, Math.min(this.positions.length - 1, Math.round(i)));
    if (t === this.index) return false;
    this.index = t;
    this.value = this.positions[t].value;
    this.enterSpring(false);
    return true;
  }

  /** Pointer released: spring positions return. Returns true if the knob moved. */
  release(): boolean {
    this.held = false;
    if (!this.detented) return false;
    const back = this.positions[this.index].spring;
    if (back === undefined) return false;
    this.holdTimer = 0;
    return this.forceIndex(back);
  }

  /** Timed spring return (positions reached without a hold). */
  tick(dt: number): boolean {
    if (this.held || this.holdTimer <= 0) return false;
    this.holdTimer -= dt;
    if (this.holdTimer > 0) return false;
    this.holdTimer = 0;
    const back = this.detented ? this.positions[this.index].spring : undefined;
    return back === undefined ? false : this.forceIndex(back);
  }

  /** Follows an externally written value. Returns true when state changed. */
  sync(v: number): boolean {
    if (this.detented) {
      if (this.positions[this.index].value === v) return false;
      let best = this.index;
      let bestD = Infinity;
      for (let i = 0; i < this.positions.length; i++) {
        const d = Math.abs(this.positions[i].value - v);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best === this.index) return false;
      this.index = best;
      this.value = this.positions[best].value;
      this.held = false;
      this.holdTimer = 0;
      return true;
    }
    if (v === this.value) return false;
    this.value = v;
    return true;
  }

  /** Continuous mode: fraction of the range (0..1) for visual mapping. */
  fraction(): number {
    if (this.detented) return this.positions.length > 1 ? this.index / (this.positions.length - 1) : 0;
    return this.max > this.min ? (this.value - this.min) / (this.max - this.min) : 0;
  }

  private turnDetent(n: number, passGates: boolean, hold: boolean): TurnResult {
    const dir = n > 0 ? 1 : -1;
    const count = this.positions.length;
    let taken = 0;
    let blocked: TurnResult['blocked'] = 'none';
    const start = this.index;
    for (let k = 0; k < Math.abs(n); k++) {
      let next = this.index + dir;
      if (next < 0 || next >= count) {
        if (!this.wrap) {
          blocked = 'limit';
          break;
        }
        next = (next + count) % count;
      }
      const gated = this.positions[this.index].gated || this.positions[next].gated;
      // Only the first click of a new/deliberate motion may cross a gate.
      if (gated && !(passGates && taken === 0)) {
        blocked = 'gate';
        break;
      }
      this.index = next;
      taken++;
    }
    this.value = this.positions[this.index].value;
    if (taken > 0) this.enterSpring(hold);
    let delta = this.index - start;
    if (this.wrap && taken > 0) delta = dir * taken;
    return { delta, clicks: taken, blocked };
  }

  private turnContinuous(n: number): TurnResult {
    const s = this.currentStep();
    const before = this.value;
    const raw = before + n * s;
    const next = this.clampOrWrap(raw);
    this.value = next;
    const blocked = !this.wrap && (raw > this.max || raw < this.min) ? 'limit' : 'none';
    let delta = next - before;
    if (this.wrap) delta = n * s;
    return { delta, clicks: next === before && !this.wrap ? 0 : Math.abs(n), blocked };
  }

  private clampOrWrap(v: number): number {
    let out: number;
    if (this.wrap) {
      const span = this.max - this.min;
      out = ((((v - this.min) % span) + span) % span) + this.min;
    } else out = Math.min(this.max, Math.max(this.min, v));
    return Number(out.toFixed(this.decimals));
  }

  private forceIndex(i: number): boolean {
    if (i === this.index) return false;
    this.index = i;
    this.value = this.positions[i].value;
    this.held = false;
    return true;
  }

  private enterSpring(hold: boolean): void {
    if (this.positions[this.index]?.spring !== undefined) {
      this.held = hold;
      this.holdTimer = hold ? 0 : this.momentaryHoldS;
    } else {
      this.held = false;
      this.holdTimer = 0;
    }
  }
}
