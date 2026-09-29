/**
 * Pure state machine for multi-position switches (toggles, rockers, gear
 * handles, the switch under a guard). No Three.js; unit-testable in node.
 *
 * Positions are indexed 0..n-1 in physical order: 0 = down (vertical switch)
 * or left (horizontal switch), n-1 = up / right.
 *
 * Features:
 *  - momentary (spring-loaded) positions: `springs[i] = j` returns from i to j
 *    when released. A position reached with `hold` stays until `release()`;
 *    reached without a hold (wheel, keyboard) it returns after
 *    `momentaryHoldS` via `tick(dt)`.
 *  - lever-lock: moving into or out of a locked position requires the handle
 *    to be pulled first (`pull()`), as on MS-type locking toggles.
 *  - inhibit hook: external interlock (e.g. landing-gear down-lock solenoid).
 */

export interface SwitchLogicOptions {
  /** Number of positions (>= 2). */
  positions: number;
  /** SimVar value per position (default: the index). */
  values?: number[];
  /** Initial position index (default 0). */
  initial?: number;
  /** Momentary positions: index -> index it springs back to. */
  springs?: Partial<Record<number, number>>;
  /** Lever-lock: positions that need a pull to enter or leave. `true` = every position. */
  locked?: number[] | boolean;
  /** Hold time (s) of a momentary position reached without a pointer hold. Default 0.25. */
  momentaryHoldS?: number;
}

export type MoveBlock = 'none' | 'limit' | 'locked' | 'inhibited';

export interface MoveResult {
  moved: boolean;
  from: number;
  to: number;
  blocked: MoveBlock;
}

export class SwitchLogic {
  readonly count: number;
  readonly values: readonly number[];
  readonly springs: ReadonlyMap<number, number>;
  readonly momentaryHoldS: number;
  private readonly lockedSet: ReadonlySet<number>;
  /** Current position index. */
  index: number;
  /** Lever-lock handle pulled out. */
  pulled = false;
  /** Pointer is holding the switch in its current position. */
  held = false;
  private holdTimer = 0;
  /**
   * Optional interlock: return false to forbid moving from `from` to `to`
   * (e.g. gear handle locked down on the ground).
   */
  inhibit: ((to: number, from: number) => boolean) | null = null;

  constructor(o: SwitchLogicOptions) {
    if (!(o.positions >= 2)) throw new Error('SwitchLogic: positions must be >= 2');
    this.count = o.positions;
    this.values = o.values ?? Array.from({ length: o.positions }, (_, i) => i);
    if (this.values.length !== this.count) throw new Error('SwitchLogic: values length must equal positions');
    const springs = new Map<number, number>();
    for (const [k, v] of Object.entries(o.springs ?? {})) if (v !== undefined) springs.set(Number(k), v);
    this.springs = springs;
    this.lockedSet =
      o.locked === true ? new Set(Array.from({ length: this.count }, (_, i) => i)) : new Set(Array.isArray(o.locked) ? o.locked : []);
    this.momentaryHoldS = o.momentaryHoldS ?? 0.25;
    this.index = clampInt(o.initial ?? 0, 0, this.count - 1);
  }

  /** SimVar value of the current position. */
  get value(): number {
    return this.values[this.index];
  }

  isLocked(i: number): boolean {
    return this.lockedSet.has(i);
  }

  hasLocks(): boolean {
    return this.lockedSet.size > 0;
  }

  isMomentary(i: number): boolean {
    return this.springs.has(i);
  }

  /** True when a move from the current position to `to` needs the lever pulled. */
  needsPull(to: number): boolean {
    return to !== this.index && (this.lockedSet.has(this.index) || this.lockedSet.has(to));
  }

  /** Why a move to `to` would be blocked ('none' if allowed). */
  check(to: number): MoveBlock {
    if (to < 0 || to >= this.count) return 'limit';
    if (to === this.index) return 'none';
    if (this.needsPull(to) && !this.pulled) return 'locked';
    if (this.inhibit && !this.inhibit(to, this.index)) return 'inhibited';
    return 'none';
  }

  /** Moves to a position if allowed. `hold` keeps a momentary position until release(). */
  moveTo(to: number, hold = false): MoveResult {
    const from = this.index;
    const blocked = this.check(to);
    if (blocked !== 'none' || to === from) return { moved: false, from, to: from, blocked };
    this.index = to;
    this.enter(hold);
    return { moved: true, from, to, blocked: 'none' };
  }

  /** Moves one position up (+1) or down (-1). */
  step(dir: 1 | -1, hold = false): MoveResult {
    return this.moveTo(this.index + dir, hold);
  }

  /**
   * Primary action for a click: 2-position switches flip; others step toward
   * `preferDir` and bounce back the other way at the end stop.
   */
  toggle(hold = false, preferDir: 1 | -1 = 1): MoveResult {
    if (this.count === 2) return this.moveTo(1 - this.index, hold);
    const r = this.step(preferDir, hold);
    if (!r.moved && r.blocked === 'limit') return this.step(preferDir === 1 ? -1 : 1, hold);
    return r;
  }

  /** Sets the position without checks (guards pushing the switch, system solenoids). */
  force(to: number): MoveResult {
    const from = this.index;
    const t = clampInt(to, 0, this.count - 1);
    if (t === from) return { moved: false, from, to: from, blocked: 'none' };
    this.index = t;
    this.held = false;
    this.holdTimer = 0;
    return { moved: true, from, to: t, blocked: 'none' };
  }

  /** Pointer released: a held momentary position springs back. */
  release(): MoveResult | null {
    this.held = false;
    const back = this.springs.get(this.index);
    if (back === undefined) return null;
    return this.force(back);
  }

  /** Timed spring return for momentary positions reached without a hold. */
  tick(dt: number): MoveResult | null {
    if (this.held || this.holdTimer <= 0) return null;
    this.holdTimer -= dt;
    if (this.holdTimer > 0) return null;
    this.holdTimer = 0;
    const back = this.springs.get(this.index);
    return back === undefined ? null : this.force(back);
  }

  pull(): void {
    this.pulled = true;
  }

  unpull(): void {
    this.pulled = false;
  }

  /** Index whose value equals `v` (or the nearest one). */
  indexOf(v: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = Math.abs(this.values[i] - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Follows an externally written value (systems resetting a switch). Returns true when the position changed. */
  sync(v: number): boolean {
    if (this.values[this.index] === v) return false;
    const i = this.indexOf(v);
    if (i === this.index) return false;
    this.index = i;
    this.held = false;
    this.holdTimer = 0;
    return true;
  }

  private enter(hold: boolean): void {
    if (this.springs.has(this.index)) {
      this.held = hold;
      this.holdTimer = hold ? 0 : this.momentaryHoldS;
    } else {
      this.held = false;
      this.holdTimer = 0;
    }
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
