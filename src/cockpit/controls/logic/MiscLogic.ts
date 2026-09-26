/**
 * Pure logic cores for circuit breakers, keypads, pull handles and trim
 * wheels. No Three.js; unit-testable in node.
 */

// -----------------------------------------------------------------------------
// Circuit breaker
// -----------------------------------------------------------------------------

export type BreakerState = 'in' | 'out' | 'tripped';

/**
 * Push/pull thermal circuit breaker (Klixon 7274/7277 style). `closed` =
 * button in (circuit made). A trip pops the button out and shows the white
 * collar; pushing it back in resets (trip-free: if the fault persists the
 * system trips it again).
 */
export class CircuitBreakerLogic {
  closed: boolean;
  tripped = false;
  /** Push-to-reset-only breakers (e.g. many light-aircraft breakers) cannot be pulled. */
  readonly pullable: boolean;

  constructor(o: { pullable?: boolean; closed?: boolean } = {}) {
    this.pullable = o.pullable ?? true;
    this.closed = o.closed ?? true;
  }

  get state(): BreakerState {
    return this.closed ? 'in' : this.tripped ? 'tripped' : 'out';
  }

  /** Pull out (open the circuit manually). */
  pull(): boolean {
    if (!this.closed || !this.pullable) return false;
    this.closed = false;
    this.tripped = false;
    return true;
  }

  /** Push in (reset). */
  push(): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.tripped = false;
    return true;
  }

  /** Overcurrent trip. */
  trip(): boolean {
    if (!this.closed) return false;
    this.closed = false;
    this.tripped = true;
    return true;
  }

  /** Click action: pull when in, push when out. */
  toggle(): 'pulled' | 'pushed' | 'none' {
    if (this.closed) return this.pull() ? 'pulled' : 'none';
    return this.push() ? 'pushed' : 'none';
  }

  /**
   * Follows the bound vars (closed = var != 0; tripped from the trip var).
   * Returns the transition that happened, if any.
   */
  sync(closedValue: number, trippedValue = 0): 'tripped' | 'reset' | 'opened' | null {
    const c = closedValue !== 0;
    const t = !c && trippedValue !== 0;
    if (c === this.closed && t === this.tripped) return null;
    const wasClosed = this.closed;
    this.closed = c;
    this.tripped = t;
    if (wasClosed && !c) return t ? 'tripped' : 'opened';
    if (!wasClosed && c) return 'reset';
    return t ? 'tripped' : null;
  }
}

// -----------------------------------------------------------------------------
// Keypad
// -----------------------------------------------------------------------------

export interface KeyDef {
  /** Key id; the event is `${eventPrefix}${id}` unless `event` is given. */
  id: string;
  /** Legend (may contain '\n'). Default: id. */
  label?: string;
  /** Width / height in key units (default 1). */
  w?: number;
  h?: number;
  /** Empty space of this width instead of a key. */
  spacer?: boolean;
  /** Explicit event name. */
  event?: string;
  /** PC keyboard keys (KeyboardEvent.key, case-insensitive) that press this key while the keypad has focus. */
  keys?: string[];
  /** Visual style override for this key (e.g. 'lsk' line-select dash keys, 'function'). */
  style?: string;
  /** Var whose non-zero value lights an annunciator bar in the key (e.g. EXEC). */
  lightVar?: string;
}

/**
 * Keypad logic: key lookup, event emission and PC-keyboard mapping.
 * Events: per-key `${eventPrefix}${id}` (payload: 'down'), and optionally one
 * `singleEvent` with the key id as payload. `releaseEvents` also emits
 * `${eventPrefix}${id}:up` on release (for keys that act while held, e.g. CLR).
 */
export class KeyPadLogic {
  readonly rows: readonly (readonly KeyDef[])[];
  readonly eventPrefix: string;
  readonly singleEvent: string | null;
  readonly releaseEvents: boolean;
  private readonly byId = new Map<string, KeyDef>();
  private readonly byPcKey = new Map<string, string>();
  private readonly emit: (name: string, payload?: unknown) => void;
  readonly pressed = new Set<string>();

  constructor(o: {
    rows: KeyDef[][];
    eventPrefix?: string;
    singleEvent?: string;
    releaseEvents?: boolean;
    emit: (name: string, payload?: unknown) => void;
  }) {
    this.rows = o.rows;
    this.eventPrefix = o.eventPrefix ?? '';
    this.singleEvent = o.singleEvent ?? null;
    this.releaseEvents = o.releaseEvents ?? false;
    this.emit = o.emit;
    for (const row of o.rows) {
      for (const k of row) {
        if (k.spacer) continue;
        if (this.byId.has(k.id)) throw new Error(`KeyPadLogic: duplicate key id '${k.id}'`);
        this.byId.set(k.id, k);
        for (const pk of k.keys ?? []) this.byPcKey.set(pk.toLowerCase(), k.id);
      }
    }
  }

  /** All real keys (no spacers) in row order. */
  keys(): KeyDef[] {
    const out: KeyDef[] = [];
    for (const r of this.rows) for (const k of r) if (!k.spacer) out.push(k);
    return out;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  eventName(id: string): string {
    return this.byId.get(id)?.event ?? `${this.eventPrefix}${id}`;
  }

  /** Presses a key: emits its events. Returns false for unknown keys. */
  press(id: string): boolean {
    const k = this.byId.get(id);
    if (!k) return false;
    this.pressed.add(id);
    this.emit(this.eventName(id), 'down');
    if (this.singleEvent) this.emit(this.singleEvent, id);
    return true;
  }

  release(id: string): boolean {
    if (!this.pressed.delete(id)) return false;
    if (this.releaseEvents) this.emit(`${this.eventName(id)}:up`, 'up');
    return true;
  }

  /**
   * Maps a PC key (KeyboardEvent.key) to a key id: explicit `keys` first,
   * then letters/digits to the key of the same id, then common aliases.
   */
  keyFor(pcKey: string): string | null {
    const lower = pcKey.toLowerCase();
    const explicit = this.byPcKey.get(lower);
    if (explicit) return explicit;
    if (pcKey.length === 1) {
      const up = pcKey.toUpperCase();
      if (this.byId.has(up)) return up;
    }
    const aliases: Record<string, string[]> = {
      ' ': ['SP', 'SPC', 'SPACE'],
      '.': ['.', 'DOT', 'PERIOD'],
      '/': ['/', 'SLASH'],
      '-': ['+/-', 'PLUSMINUS', '-', 'MINUS'],
      '+': ['+/-', 'PLUSMINUS', '+'],
      backspace: ['CLR', 'BKSP', 'DEL'],
      delete: ['DEL', 'CLR'],
      enter: ['ENT', 'ENTER', 'EXEC'],
      escape: ['CLR'],
    };
    for (const cand of aliases[lower] ?? []) if (this.byId.has(cand)) return cand;
    return null;
  }
}

// -----------------------------------------------------------------------------
// Pull handle (T-handles, fire handles, parking brake, emergency releases)
// -----------------------------------------------------------------------------

export interface PullHandleOptions {
  /**
   * Rotation after pulling:
   *  'none'      - pull/push only.
   *  'lock'      - rotate (+1) to lock it out (e.g. parking brake handle).
   *  'discharge' - rotate left (-1) / right (+1) while held (engine fire
   *                handles, bottle discharge), spring back to centre.
   */
  rotate?: 'none' | 'lock' | 'discharge';
  /** A pulled but unlocked handle springs back in when released. */
  springIn?: boolean;
  /** Initial state. */
  pulled?: boolean;
  rotation?: -1 | 0 | 1;
}

export class PullHandleLogic {
  readonly rotateMode: 'none' | 'lock' | 'discharge';
  readonly springIn: boolean;
  pulled: boolean;
  rotation: -1 | 0 | 1;
  /** Pointer is holding the handle. */
  held = false;
  /** External lock (e.g. fire handle solenoid): return false to forbid pulling. */
  canPull: (() => boolean) | null = null;

  constructor(o: PullHandleOptions = {}) {
    this.rotateMode = o.rotate ?? 'none';
    this.springIn = o.springIn ?? false;
    this.pulled = o.pulled ?? false;
    this.rotation = o.rotation ?? 0;
  }

  get locked(): boolean {
    return this.rotateMode === 'lock' && this.rotation !== 0;
  }

  pull(hold = false): 'pulled' | 'blocked' | 'none' {
    if (this.pulled) return 'none';
    if (this.canPull && !this.canPull()) return 'blocked';
    this.pulled = true;
    this.held = hold;
    return 'pulled';
  }

  /** Push back in (unlocks first for lock-type handles). */
  push(): boolean {
    if (!this.pulled) return false;
    if (this.rotateMode === 'lock') this.rotation = 0;
    if (this.rotateMode === 'discharge' && this.rotation !== 0) return false; // must return to centre first
    this.pulled = false;
    this.held = false;
    return true;
  }

  /** Rotates (only when pulled). Lock handles accept dir +1 (lock) / -1 (unlock). */
  rotate(dir: -1 | 1, hold = false): boolean {
    if (!this.pulled || this.rotateMode === 'none') return false;
    if (this.rotateMode === 'lock') {
      const r: 0 | 1 = dir > 0 ? 1 : 0;
      if (r === this.rotation) return false;
      this.rotation = r;
      return true;
    }
    if (this.rotation === dir) return false;
    this.rotation = dir;
    this.held = hold;
    return true;
  }

  /**
   * Pointer released: discharge rotation springs back to centre, and a
   * spring-in handle that is not locked goes back in. Returns true if state changed.
   */
  release(): boolean {
    this.held = false;
    let changed = false;
    if (this.rotateMode === 'discharge' && this.rotation !== 0) {
      this.rotation = 0;
      changed = true;
    }
    if (this.springIn && this.pulled && !this.locked) {
      this.pulled = false;
      changed = true;
    }
    return changed;
  }

  sync(pulled: number, rotation = 0): boolean {
    const p = pulled !== 0;
    const r = (rotation > 0.5 ? 1 : rotation < -0.5 ? -1 : 0) as -1 | 0 | 1;
    if (p === this.pulled && r === this.rotation) return false;
    this.pulled = p;
    this.rotation = r;
    return true;
  }
}

// -----------------------------------------------------------------------------
// Trim wheel
// -----------------------------------------------------------------------------

/**
 * Trim wheel: a bounded trim position whose wheel angle is proportional to
 * the position, so the wheel spins whenever trim moves (manual or electric).
 */
export class TrimWheelLogic {
  readonly min: number;
  readonly max: number;
  /** Trim value change per wheel revolution. */
  readonly perRev: number;
  value: number;

  constructor(o: { min: number; max: number; perRev: number; initial?: number }) {
    if (!(o.max > o.min)) throw new Error('TrimWheelLogic: max must exceed min');
    if (!(o.perRev > 0)) throw new Error('TrimWheelLogic: perRev must be > 0');
    this.min = o.min;
    this.max = o.max;
    this.perRev = o.perRev;
    this.value = Math.min(o.max, Math.max(o.min, o.initial ?? 0));
  }

  /** Wheel angle (radians) for a trim value. */
  angleOf(v: number): number {
    return ((v - this.min) / this.perRev) * Math.PI * 2;
  }

  /** Turns the wheel by `revs` revolutions; returns the value change actually applied (stops at the ends). */
  turn(revs: number): number {
    const before = this.value;
    this.value = Math.min(this.max, Math.max(this.min, this.value + revs * this.perRev));
    return this.value - before;
  }

  sync(v: number): boolean {
    const c = Math.min(this.max, Math.max(this.min, v));
    if (c === this.value) return false;
    this.value = c;
    return true;
  }

  /** Number of spoke passages (for clack sounds) between two wheel angles. */
  static spokesPassed(a0: number, a1: number, spokes: number): number {
    const k = spokes / (Math.PI * 2);
    return Math.abs(Math.floor(a1 * k) - Math.floor(a0 * k));
  }
}
