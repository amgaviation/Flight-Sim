/**
 * Pure logic for levers (thrust/power levers, flap and speedbrake handles,
 * condition / fuel cutoff levers, push-pull plungers).
 *
 * The lever has a continuous physical position `value` in [min, max] plus
 * optional detents:
 *  - 'soft' detents are magnetic: a lever moved to within `width` of one
 *    sticks to it (TO/CLB/CRZ, speedbrake ARMED, flap detents).
 *  - 'gate' detents stop the lever. Passing a gate needs a *new motion that
 *    starts at the gate* at least `gatePauseS` after the lever arrived there
 *    (release the drag and drag again = lift the lever over the gate; a fast
 *    wheel spin stops at the gate, a pause and the next notch passes). A gate
 *    may block only one direction (e.g. a reverse latch blocks decreasing
 *    motion out of IDLE but not the return to IDLE).
 *
 * Discrete levers (e.g. flap handles) always rest on a detent: `output` is
 * the nearest reachable detent value and `endMotion()` snaps the handle to it.
 *
 * Dynamic limits (`setLimits`) implement cross-control interlocks such as a
 * reverse lever that can only be raised with the forward lever at idle.
 */

export interface LeverDetent {
  value: number;
  label?: string;
  kind?: 'soft' | 'gate';
  /** Capture half-width for soft detents (value units). Default: options.softWidth. */
  width?: number;
  /** Which motion a gate blocks. Default 'both'. */
  direction?: 'both' | 'increasing' | 'decreasing';
}

export interface LeverLogicOptions {
  min: number;
  max: number;
  initial?: number;
  detents?: LeverDetent[];
  /** Always rest on a detent (flap handle). */
  discrete?: boolean;
  /** Default soft-detent capture half-width. Default 3 % of the range. */
  softWidth?: number;
  /** Wheel/click step for continuous levers without detents. Default 5 % of range. */
  step?: number;
  /** Minimum pause (s) at a gate before a new motion may pass it. Default 0.35. */
  gatePauseS?: number;
}

export interface LeverMove {
  value: number;
  /** Gate that stopped the motion, if any. */
  blockedBy: LeverDetent | null;
  /** Detent the lever entered during this move (soft snap or gate), if any. */
  entered: LeverDetent | null;
}

const EPS = 1e-6;

export class LeverLogic {
  readonly min: number;
  readonly max: number;
  readonly detents: readonly LeverDetent[];
  readonly discrete: boolean;
  readonly softWidth: number;
  readonly step: number;
  readonly gatePauseS: number;
  /** Physical lever position. */
  value: number;
  private lo: number;
  private hi: number;
  private motionActive = false;
  private motionStartValue = NaN;
  private motionStartS = 0;
  private motionDeliberate = false;
  private arrivedGate: LeverDetent | null = null;
  private arrivedS = -Infinity;
  private lastDetent: LeverDetent | null = null;

  constructor(o: LeverLogicOptions) {
    if (!(o.max > o.min)) throw new Error('LeverLogic: max must exceed min');
    this.min = o.min;
    this.max = o.max;
    this.detents = [...(o.detents ?? [])].sort((a, b) => a.value - b.value);
    this.discrete = o.discrete ?? false;
    if (this.discrete && this.detents.length === 0) throw new Error('LeverLogic: discrete lever needs detents');
    this.softWidth = o.softWidth ?? (o.max - o.min) * 0.03;
    this.step = o.step ?? (o.max - o.min) * 0.05;
    this.gatePauseS = o.gatePauseS ?? 0.35;
    this.lo = o.min;
    this.hi = o.max;
    this.value = this.clamp(o.initial ?? o.min);
    if (this.discrete) this.value = this.nearestDetent(this.value).value;
    this.lastDetent = this.detentAt(this.value);
  }

  /** Output value: the physical position, or the nearest reachable detent for discrete levers. */
  get output(): number {
    return this.discrete ? this.nearestDetent(this.value).value : this.value;
  }

  /** Detent the lever currently rests on (within 1e-6), or null. */
  get detent(): LeverDetent | null {
    return this.detentAt(this.value);
  }

  /** True while a drag/wheel motion is in progress. */
  get moving(): boolean {
    return this.motionActive;
  }

  /** Dynamic travel limits (interlocks). Clamped to [min, max]; the lever is pushed inside. */
  setLimits(lo: number, hi: number): void {
    this.lo = Math.max(this.min, Math.min(lo, hi));
    this.hi = Math.min(this.max, Math.max(lo, hi));
    this.value = this.clamp(this.value);
  }

  /**
   * Starts a motion (pointer down / wheel notch) at time `nowS`. A
   * `deliberate` motion (a click) may leave the gate it starts on without
   * the pause rule.
   */
  beginMotion(nowS: number, deliberate = false): void {
    this.motionActive = true;
    this.motionStartValue = this.value;
    this.motionStartS = nowS;
    this.motionDeliberate = deliberate;
  }

  /**
   * Moves toward `target` within the current motion, applying gates and soft
   * detents. Call beginMotion first (an implicit motion is started otherwise).
   */
  moveTo(target: number, nowS = this.motionStartS): LeverMove {
    if (!this.motionActive) this.beginMotion(nowS);
    const from = this.value;
    let to = this.clamp(target);
    let blockedBy: LeverDetent | null = null;
    if (to !== from) {
      const dir = to > from ? 1 : -1;
      // Gates between from and to, nearest first.
      for (let i = 0; i < this.detents.length; i++) {
        const d = this.detents[dir > 0 ? i : this.detents.length - 1 - i];
        if (d.kind !== 'gate') continue;
        if (d.direction === 'increasing' && dir < 0) continue;
        if (d.direction === 'decreasing' && dir > 0) continue;
        const ahead = dir > 0 ? d.value > from + EPS && d.value < to - EPS : d.value < from - EPS && d.value > to + EPS;
        const leaving = Math.abs(d.value - from) <= EPS && Math.abs(to - d.value) > EPS;
        if (ahead) {
          to = d.value;
          blockedBy = d;
          break;
        }
        if (leaving && !this.mayPass(d)) {
          to = d.value;
          blockedBy = d;
          break;
        }
      }
      // Soft detents: magnetic capture near the target.
      if (!blockedBy) {
        for (const d of this.detents) {
          if (d.kind === 'gate') continue;
          const w = d.width ?? this.softWidth;
          if (Math.abs(to - d.value) <= w) {
            to = d.value;
            break;
          }
        }
      }
    }
    this.value = this.clamp(to);
    const now = this.detentAt(this.value);
    // Landing on a gate starts its pause timer.
    if (now && now.kind === 'gate' && Math.abs(from - now.value) > EPS) {
      this.arrivedGate = now;
      this.arrivedS = nowS;
    }
    const entered = now && now !== this.lastDetent ? now : null;
    this.lastDetent = now;
    return { value: this.value, blockedBy, entered };
  }

  /** Moves by a delta within the current motion. */
  moveBy(delta: number, nowS?: number): LeverMove {
    return this.moveTo(this.value + delta, nowS);
  }

  /** Ends the motion; discrete levers snap to the nearest reachable detent. */
  endMotion(): number {
    this.motionActive = false;
    if (this.discrete) this.value = this.nearestDetent(this.value).value;
    this.lastDetent = this.detentAt(this.value);
    return this.value;
  }

  /**
   * One wheel notch / click: moves to the next detent in `dir` (discrete
   * levers or levers with detents within reach) or by `step`. `deliberate`
   * (clicks) passes a gate the lever rests on without the pause rule.
   */
  stepDetent(dir: 1 | -1, nowS: number, deliberate = false): LeverMove {
    this.beginMotion(nowS, deliberate);
    let target: number;
    const next = this.nextDetent(dir);
    if (this.discrete) target = next ? next.value : this.value;
    else {
      const stepTarget = this.value + dir * this.step;
      target = next && (dir > 0 ? next.value <= stepTarget + EPS : next.value >= stepTarget - EPS) ? next.value : stepTarget;
    }
    const r = this.moveTo(target, nowS);
    this.endMotion();
    return { ...r, value: this.value };
  }

  /** Follows an externally written value (autothrottle back-driving, hardware axis, state load). */
  sync(v: number): boolean {
    const c = this.clamp(v);
    if (this.motionActive) return false;
    if (Math.abs(c - this.value) < EPS) return false;
    this.value = c;
    this.lastDetent = this.detentAt(c);
    return true;
  }

  /** Label of the detent at the current position, or of the nearest detent for discrete levers. */
  label(): string {
    const d = this.discrete ? this.nearestDetent(this.value) : this.detentAt(this.value);
    return d?.label ?? '';
  }

  /** Nearest detent reachable from the current position without crossing a gate. */
  nearestDetent(v: number): LeverDetent {
    let best: LeverDetent | null = null;
    let bestD = Infinity;
    for (const d of this.detents) {
      if (d.value < this.lo - EPS || d.value > this.hi + EPS) continue;
      if (this.gateBetween(v, d.value)) continue;
      const dist = Math.abs(d.value - v);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best ?? this.detents[0] ?? { value: v };
  }

  private nextDetent(dir: 1 | -1): LeverDetent | null {
    const n = this.detents.length;
    for (let i = 0; i < n; i++) {
      const d = this.detents[dir > 0 ? i : n - 1 - i];
      if (dir > 0 ? d.value > this.value + EPS : d.value < this.value - EPS) {
        if (d.value < this.lo - EPS || d.value > this.hi + EPS) return null;
        return d;
      }
    }
    return null;
  }

  private mayPass(g: LeverDetent): boolean {
    // Must be a motion that started on the gate, after the pause.
    if (Math.abs(this.motionStartValue - g.value) > EPS) return false;
    if (this.motionDeliberate) return true;
    if (this.arrivedGate === g && this.motionStartS - this.arrivedS < this.gatePauseS) return false;
    return true;
  }

  private gateBetween(a: number, b: number): boolean {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (const d of this.detents) if (d.kind === 'gate' && d.value > lo + EPS && d.value < hi - EPS) return true;
    return false;
  }

  private detentAt(v: number): LeverDetent | null {
    for (const d of this.detents) if (Math.abs(d.value - v) <= EPS) return d;
    return null;
  }

  private clamp(v: number): number {
    return Math.min(this.hi, Math.max(this.lo, v));
  }
}
