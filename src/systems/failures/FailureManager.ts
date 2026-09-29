/**
 * Failure registry and scheduler.
 *
 * Every failure has an id (e.g. `elec.gen1`, `hyd.edp_a`, `fire.eng1`). Its
 * state lives in the SimVar `fail.<id>` (0 = serviceable, 1 = failed), which
 * the system blocks read directly; the manager only *writes* those vars, so
 * blocks work without a manager (a failure is then triggered by writing the
 * var, e.g. from a debug console).
 *
 * The manager adds:
 *   - a registry with names, categories and descriptions (for the failures UI),
 *   - arming: trigger after a sim time, when crossing an altitude or airspeed,
 *     at a random time within a window, or randomly with a mean time between
 *     failures (MTBF, exponential distribution, deterministic seeded PRNG),
 *   - manual trigger/clear through methods or EventBus events.
 *
 * Every system block exposes `failures(): FailureDef[]` listing the ids it
 * reads; aircraft register them with `fm.register(block.failures())`.
 *
 * Events handled (when an EventBus is given):
 *   'fail.trigger'   payload: id (string)
 *   'fail.clear'     payload: id (string)
 *   'fail.clear_all'
 *   'fail.arm'       payload: { id: string; trigger: FailureTrigger }
 *   'fail.disarm'    payload: id (string)
 * Events emitted: 'fail.activated' (id), 'fail.cleared' (id).
 *
 * Vars written: `fail.<id>` for every registered id (initialised to 0 when
 * missing), `fail.active_count`, `fail.armed_count`.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import type { Subsystem } from '../../aircraft/types';
import { FDM, SIM } from '../../core/vars';
import { Prng } from '../../core/math';
import { failVar } from '../util/ids';

export interface FailureDef {
  /** Unique id; the state var is `fail.<id>`. Dotted ids are fine (`elec.gen1.ov`). */
  id: string;
  /** Short human-readable name ("Generator 1", "Hydraulic system A leak"). */
  name: string;
  /** UI grouping: 'electrical', 'fuel', 'hydraulic', 'pneumatic', 'pressurization', 'ice', 'apu', 'fire', 'oxygen', 'lighting', 'engine', ... */
  category: string;
  /** What happens / how the crew sees it. */
  description?: string;
}

export type FailureTrigger =
  /** Fires `afterS` simulated seconds after arming. */
  | { kind: 'time'; afterS: number }
  /** Fires when altitude (ft MSL, `fdm.alt_msl_ft`) crosses `ft` in the given direction (default: either). */
  | { kind: 'altitude'; ft: number; direction?: 'above' | 'below' | 'cross' }
  /** Fires when IAS (`fdm.ias_kt`) crosses `kt` in the given direction (default: either). */
  | { kind: 'speed'; kt: number; direction?: 'above' | 'below' | 'cross' }
  /** Random time uniformly distributed in [minS, maxS] after arming. */
  | { kind: 'window'; minS: number; maxS: number }
  /** Random failure with mean time between failures `hours` (per-update probability dt/MTBF). */
  | { kind: 'mtbf'; hours: number };

interface Armed {
  id: string;
  trigger: FailureTrigger;
  armedAt: number;
  /** Absolute sim time for time/window triggers. */
  fireAt: number;
  /** Previous sample for crossing triggers (NaN until first update). */
  prev: number;
}

export interface FailureManagerOptions {
  events?: EventBus;
  /** PRNG seed for random triggers (default 1): identical seeds reproduce the same failure times. */
  seed?: number;
  defs?: FailureDef[];
}

export class FailureManager implements Subsystem {
  readonly name = 'failures';
  private readonly defs = new Map<string, FailureDef>();
  private readonly varNames = new Map<string, string>();
  private readonly armedList: Armed[] = [];
  private readonly rng: Prng;
  private readonly offs: (() => void)[] = [];
  private time = 0;
  private activeCount = 0;

  constructor(
    private readonly vars: SimVars,
    opts: FailureManagerOptions = {},
  ) {
    this.rng = new Prng(opts.seed ?? 1);
    if (opts.defs) this.register(opts.defs);
    const ev = opts.events;
    this.events = ev;
    if (ev) {
      this.offs.push(
        ev.on('fail.trigger', (p) => {
          if (typeof p === 'string') this.trigger(p);
        }),
        ev.on('fail.clear', (p) => {
          if (typeof p === 'string') this.clear(p);
        }),
        ev.on('fail.clear_all', () => this.clearAll()),
        ev.on('fail.arm', (p) => {
          const a = p as { id?: unknown; trigger?: unknown } | undefined;
          if (a && typeof a.id === 'string' && a.trigger && typeof a.trigger === 'object') this.arm(a.id, a.trigger as FailureTrigger);
        }),
        ev.on('fail.disarm', (p) => {
          if (typeof p === 'string') this.disarm(p);
        }),
      );
    }
    this.publishCounts();
  }

  private readonly events: EventBus | undefined;

  // ------------------------------------------------------------ registry

  /** Registers one or more failures. Re-registering an id replaces its description. Initialises `fail.<id>` to 0 if missing. */
  register(defs: FailureDef | readonly FailureDef[]): void {
    const list = Array.isArray(defs) ? defs : [defs as FailureDef];
    for (const d of list) {
      if (!d.id || /\s/.test(d.id)) throw new Error(`FailureManager: invalid failure id '${d.id}'`);
      this.defs.set(d.id, d);
      const v = failVar(d.id);
      this.varNames.set(d.id, v);
      if (!this.vars.has(v)) this.vars.set(v, 0);
    }
    this.publishCounts();
  }

  unregister(id: string): void {
    this.defs.delete(id);
    this.varNames.delete(id);
    this.disarm(id);
  }

  /** All registered failures, in registration order. */
  list(): FailureDef[] {
    return [...this.defs.values()];
  }

  /** Registered failures grouped by category. */
  byCategory(): Map<string, FailureDef[]> {
    const m = new Map<string, FailureDef[]>();
    for (const d of this.defs.values()) {
      let l = m.get(d.category);
      if (!l) m.set(d.category, (l = []));
      l.push(d);
    }
    return m;
  }

  get(id: string): FailureDef | undefined {
    return this.defs.get(id);
  }

  // ------------------------------------------------------------ state

  isActive(id: string): boolean {
    return this.vars.get(this.varNames.get(id) ?? failVar(id)) !== 0;
  }

  /** Ids of all active (registered) failures. */
  active(): string[] {
    const out: string[] = [];
    for (const [id, v] of this.varNames) if (this.vars.get(v) !== 0) out.push(id);
    return out;
  }

  /** Fails `id` now (works for unregistered ids too; the var is `fail.<id>`). Disarms it. */
  trigger(id: string): void {
    const v = this.varNames.get(id) ?? failVar(id);
    this.disarm(id);
    if (this.vars.get(v) === 0) {
      this.vars.set(v, 1);
      this.events?.emit('fail.activated', id);
    }
    this.publishCounts();
  }

  /** Repairs `id`. */
  clear(id: string): void {
    const v = this.varNames.get(id) ?? failVar(id);
    if (this.vars.get(v) !== 0) {
      this.vars.set(v, 0);
      this.events?.emit('fail.cleared', id);
    }
    this.publishCounts();
  }

  /** Repairs every registered failure and disarms everything. */
  clearAll(): void {
    this.armedList.length = 0;
    for (const id of this.varNames.keys()) this.clear(id);
    this.publishCounts();
  }

  // ------------------------------------------------------------ arming

  /** Arms `id` with a trigger (replaces an existing arming of the same id). */
  arm(id: string, trigger: FailureTrigger): void {
    this.disarm(id);
    let fireAt = Infinity;
    if (trigger.kind === 'time') fireAt = this.time + Math.max(0, trigger.afterS);
    else if (trigger.kind === 'window') {
      const lo = Math.max(0, Math.min(trigger.minS, trigger.maxS));
      const hi = Math.max(trigger.minS, trigger.maxS);
      fireAt = this.time + this.rng.range(lo, hi);
    } else if (trigger.kind === 'mtbf' && !(trigger.hours > 0)) {
      throw new Error(`FailureManager: MTBF must be > 0 h for '${id}'`);
    }
    this.armedList.push({ id, trigger, armedAt: this.time, fireAt, prev: NaN });
    this.publishCounts();
  }

  disarm(id: string): void {
    const l = this.armedList;
    for (let i = l.length - 1; i >= 0; i--) {
      if (l[i].id === id) {
        l[i] = l[l.length - 1];
        l.pop();
      }
    }
    this.publishCounts();
  }

  /** Currently armed failures (copies; for UI). */
  armed(): { id: string; trigger: FailureTrigger; armedAt: number; fireAt: number }[] {
    return this.armedList.map((a) => ({ id: a.id, trigger: a.trigger, armedAt: a.armedAt, fireAt: a.fireAt }));
  }

  /**
   * Arms `count` random registered failures (optionally from one category)
   * to occur uniformly within [minS, maxS] from now. Returns the chosen ids.
   */
  armRandom(count: number, minS: number, maxS: number, category?: string): string[] {
    const pool = [...this.defs.values()].filter((d) => (!category || d.category === category) && !this.isActive(d.id));
    const chosen: string[] = [];
    for (let k = 0; k < count && pool.length > 0; k++) {
      const i = Math.min(pool.length - 1, Math.floor(this.rng.next() * pool.length));
      const d = pool.splice(i, 1)[0];
      this.arm(d.id, { kind: 'window', minS, maxS });
      chosen.push(d.id);
    }
    return chosen;
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    this.time += dt;
    const l = this.armedList;
    if (l.length === 0) return;
    const alt = this.vars.get(FDM.altMsl);
    const ias = this.vars.get(FDM.ias);
    for (let i = l.length - 1; i >= 0; i--) {
      const a = l[i];
      const t = a.trigger;
      let fire = false;
      switch (t.kind) {
        case 'time':
        case 'window':
          fire = this.time >= a.fireAt;
          break;
        case 'mtbf':
          fire = this.rng.next() < dt / (t.hours * 3600);
          break;
        case 'altitude':
          fire = crossed(a.prev, alt, t.ft, t.direction ?? 'cross');
          a.prev = alt;
          break;
        case 'speed':
          fire = crossed(a.prev, ias, t.kt, t.direction ?? 'cross');
          a.prev = ias;
          break;
      }
      if (fire) {
        // Remove first so trigger() -> disarm() does not touch the loop index.
        l[i] = l[l.length - 1];
        l.pop();
        this.trigger(a.id);
      }
    }
  }

  /** Re-synchronises counts after a state load (failure vars restored by SimVars.restore). */
  reset(): void {
    this.time = this.vars.get(SIM.timeS, this.time);
    for (const a of this.armedList) a.prev = NaN;
    this.publishCounts();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private publishCounts(): void {
    let n = 0;
    for (const v of this.varNames.values()) if (this.vars.get(v) !== 0) n++;
    this.activeCount = n;
    this.vars.set('fail.active_count', n);
    this.vars.set('fail.armed_count', this.armedList.length);
  }

  /** Number of active registered failures (as of the last change). */
  get activeFailures(): number {
    return this.activeCount;
  }
}

function crossed(prev: number, cur: number, level: number, dir: 'above' | 'below' | 'cross'): boolean {
  if (Number.isNaN(prev)) {
    // First sample: 'above' fires if already above (armed while higher), likewise 'below'.
    if (dir === 'above') return cur >= level;
    if (dir === 'below') return cur <= level;
    return false;
  }
  const up = prev < level && cur >= level;
  const down = prev > level && cur <= level;
  if (dir === 'above') return up;
  if (dir === 'below') return down;
  return up || down;
}
