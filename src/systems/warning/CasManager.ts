/**
 * Crew alerting system logic (CAS / EICAS): message conditions, flight-
 * phase inhibits, master warning/caution latching, chimes and voices, and
 * the ordered message list for the display.
 *
 * Levels follow 14 CFR 25.1322: warning (red, master WARNING + continuous
 * aural), caution (amber, master CAUTION + single chime), advisory
 * (cyan/white), status (white, no master). Behaviour per the CAS window
 * conventions (G1000 PG §3.2 / Boeing EICAS): a new warning/caution lights
 * its master light and is "unacknowledged" (flashes on Garmin displays)
 * until the master light is pushed; display order is warnings, cautions,
 * advisories, status, newest first within a level.
 *
 * Per message: `when` (binding) must hold for `delayS` (debounce); messages
 * may be inhibited in flight phases (`inhibit`: 'takeoff', 'landing', or a
 * list of `FlightPhaseName`s) — an inhibited message posts as soon as the
 * inhibit ends if still true; `latch` keeps a message posted after its
 * condition clears until it has been acknowledged; `aural` plays a voice
 * callout (repeating every `repeatS` while unacknowledged) or a tone.
 *
 * Masters: `alert.master_warning` / `alert.master_caution` stay lit while
 * any posted message of that level is unacknowledged (they latch: clearing
 * the condition does not extinguish them). Pushing the light (events
 * `cas.ack_warning`, `cas.ack_caution`, `cas.ack` for both) acknowledges.
 * The warning tone runs while the master WARNING is lit (Boeing fire bell /
 * Garmin warning chime repeat), the caution chime plays once per new caution.
 * Lamp test lights both masters.
 *
 * Display: `list` (readonly, reused array of CasEntry, ordered) and any
 * number of `sinks` with the `CasModel` API of avionics/common/draw/CasWindow
 * (define / setActive / acknowledge) are kept in sync.
 *
 * Vars written: alert.master_warning, alert.master_caution, cas.<id> (1 while
 * posted), cas.warning_count, cas.caution_count, cas.advisory_count,
 * cas.status_count, cas.unacked_warnings, cas.unacked_cautions,
 * cas.inhibited_count, plus FlightPhase vars (cas.phase ...).
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ALERT } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { listen, type BlockEnv } from '../autopilot/lib';
import { FlightPhase, type FlightPhaseConfig, type FlightPhaseName } from './FlightPhase';

export type CasLevel = 'warning' | 'caution' | 'advisory' | 'status';

const RANK: Record<CasLevel, number> = { warning: 0, caution: 1, advisory: 2, status: 3 };

export interface CasMessageDef {
  id: string;
  text: string;
  level: CasLevel;
  when: Binding;
  delayS?: number;
  inhibit?: 'takeoff' | 'landing' | 'takeoff+landing' | FlightPhaseName[];
  latch?: boolean;
  /** Lights the master light for its level. Default true for warning/caution. */
  master?: boolean;
  aural?: { callout?: string; tone?: string; priority?: number; repeatS?: number };
}

/** Anything with the CasModel display API (avionics/common/draw/CasWindow). */
export interface CasSink {
  define(id: string, text: string, level: CasLevel): unknown;
  setActive(id: string, on: boolean): void;
  acknowledge(level?: CasLevel): void;
}

export interface CasEntry {
  readonly id: string;
  readonly text: string;
  readonly level: CasLevel;
  /** Posted (displayed). */
  active: boolean;
  acknowledged: boolean;
  /** Condition true but held back by an inhibit. */
  inhibited: boolean;
  /** Post sequence (larger = newer). */
  seq: number;
}

export interface CasConfig {
  messages: CasMessageDef[];
  /** CAS computer / display power. Default true. */
  power?: Binding;
  phase?: FlightPhaseConfig;
  /** Lamp test. Default alert.annun_test. */
  lampTest?: Binding;
  /** Continuous warning tone id (while master WARNING is lit). Default 'master_warning'; '' = none. */
  warningTone?: string;
  /** One-shot caution chime id. Default 'master_caution'; '' = none. */
  cautionChime?: string;
  sinks?: CasSink[];
}

class Msg implements CasEntry {
  active = false;
  acknowledged = true;
  inhibited = false;
  seq = 0;
  timer = 0;
  repeatT = 0;
  readonly id: string;
  readonly text: string;
  readonly level: CasLevel;
  readonly var: string;
  constructor(
    readonly def: CasMessageDef,
    readonly cond: () => boolean,
    readonly masters: boolean,
  ) {
    this.id = def.id;
    this.text = def.text;
    this.level = def.level;
    this.var = `cas.${def.id}`;
  }
}

export class CasManager implements Subsystem {
  readonly name = 'cas';
  readonly phase: FlightPhase;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: CasConfig;
  private readonly msgs: Msg[] = [];
  private readonly byId = new Map<string, Msg>();
  private readonly sorted: Msg[] = [];
  private readonly power: () => boolean;
  private readonly lampTest: () => boolean;
  private readonly sinks: CasSink[];
  private readonly offs: (() => void)[] = [];
  private seq = 0;
  private dirty = true;
  private warningToneOn = false;
  private readonly cmp = (a: Msg, b: Msg): number => RANK[a.level] - RANK[b.level] || b.seq - a.seq;

  constructor(env: BlockEnv, cfg: CasConfig) {
    this.vars = env.vars;
    this.audio = env.audio;
    this.cfg = cfg;
    this.phase = new FlightPhase(env, cfg.phase);
    this.power = compileCondition(env.vars, cfg.power, true);
    this.lampTest = compileCondition(env.vars, cfg.lampTest ?? ALERT.annunTest, false);
    this.sinks = cfg.sinks ?? [];
    for (const d of cfg.messages) this.define(d);
    listen(env.events, this.offs, 'cas.ack_warning', () => this.acknowledge('warning'));
    listen(env.events, this.offs, 'cas.ack_caution', () => this.acknowledge('caution'));
    listen(env.events, this.offs, 'cas.ack', () => this.acknowledge());
  }

  /** Adds (or replaces) a message at setup time. */
  define(d: CasMessageDef): void {
    if (this.byId.has(d.id)) throw new Error(`CasManager: duplicate message id '${d.id}'`);
    const m = new Msg(d, compileCondition(this.vars, d.when), d.master ?? (d.level === 'warning' || d.level === 'caution'));
    this.msgs.push(m);
    this.byId.set(d.id, m);
    for (const s of this.sinks) s.define(d.id, d.text, d.level);
    this.dirty = true;
  }

  /** Connects a display model after construction (existing messages are defined in it). */
  addSink(s: CasSink): void {
    this.sinks.push(s);
    for (const m of this.msgs) {
      s.define(m.id, m.text, m.level);
      s.setActive(m.id, m.active);
    }
  }

  /** Posted messages in display order (reused array; do not keep references across updates). */
  get list(): readonly CasEntry[] {
    if (this.dirty) {
      this.sorted.length = 0;
      for (const m of this.msgs) if (m.active) this.sorted.push(m);
      this.sorted.sort(this.cmp);
      this.dirty = false;
    }
    return this.sorted;
  }

  isActive(id: string): boolean {
    return this.byId.get(id)?.active ?? false;
  }

  /** Master WARNING / CAUTION push (or all levels). */
  acknowledge(level?: CasLevel): void {
    for (const m of this.msgs) if (m.active && (!level || m.level === level)) m.acknowledged = true;
    for (const s of this.sinks) s.acknowledge(level);
  }

  /** Marks every posted message acknowledged (power-up: existing messages do not flash). */
  acknowledgeAll(): void {
    this.acknowledge();
  }

  get unackedWarnings(): number {
    return this.count('warning', true);
  }

  get unackedCautions(): number {
    return this.count('caution', true);
  }

  reset(): void {
    for (const m of this.msgs) {
      m.timer = 0;
      m.active = false;
      m.inhibited = false;
      m.acknowledged = true;
      for (const s of this.sinks) s.setActive(m.id, false);
    }
    this.dirty = true;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.audio?.tone(this.cfg.warningTone ?? 'master_warning', false);
  }

  update(dt: number): void {
    const v = this.vars;
    this.phase.update(dt);
    const powered = this.power();
    const toInh = this.phase.takeoffInhibit;
    const ldgInh = this.phase.landingInhibit;
    const ph = this.phase.phase;
    let newCaution = false;
    let inhibitedCount = 0;
    for (const m of this.msgs) {
      const cond = powered && m.cond();
      m.timer = cond ? m.timer + dt : 0;
      const ready = cond && m.timer >= (m.def.delayS ?? 0);
      const inh = ready && this.inhibited(m.def, toInh, ldgInh, ph);
      m.inhibited = inh;
      if (inh) inhibitedCount++;
      const want = (ready && !inh) || (m.def.latch === true && m.active && !m.acknowledged && powered);
      if (want && !m.active) {
        m.active = true;
        m.acknowledged = !m.masters;
        m.seq = ++this.seq;
        m.repeatT = 0;
        this.dirty = true;
        for (const s of this.sinks) s.setActive(m.id, true);
        if (m.masters && m.level === 'caution') newCaution = true;
        const a = m.def.aural;
        if (a?.callout) this.audio?.callout(a.callout, a.priority ?? (m.level === 'warning' ? 8 : 5));
        if (a?.tone) this.audio?.play(a.tone);
      } else if (!want && m.active) {
        m.active = false;
        this.dirty = true;
        for (const s of this.sinks) s.setActive(m.id, false);
      } else if (m.active && !m.acknowledged && m.def.aural?.callout && m.def.aural.repeatS) {
        m.repeatT += dt;
        if (m.repeatT >= m.def.aural.repeatS) {
          m.repeatT = 0;
          this.audio?.callout(m.def.aural.callout, m.def.aural.priority ?? 8);
        }
      }
      v.set(m.var, m.active ? 1 : 0);
    }
    const uw = this.count('warning', true);
    const uc = this.count('caution', true);
    const test = powered && this.lampTest();
    v.set(ALERT.masterWarning, uw > 0 || test ? 1 : 0);
    v.set(ALERT.masterCaution, uc > 0 || test ? 1 : 0);
    v.set('cas.warning_count', this.count('warning', false));
    v.set('cas.caution_count', this.count('caution', false));
    v.set('cas.advisory_count', this.count('advisory', false));
    v.set('cas.status_count', this.count('status', false));
    v.set('cas.unacked_warnings', uw);
    v.set('cas.unacked_cautions', uc);
    v.set('cas.inhibited_count', inhibitedCount);
    const tone = this.cfg.warningTone ?? 'master_warning';
    const toneOn = uw > 0;
    if (tone && toneOn !== this.warningToneOn) {
      this.warningToneOn = toneOn;
      this.audio?.tone(tone, toneOn);
    }
    const chime = this.cfg.cautionChime ?? 'master_caution';
    if (chime && newCaution) this.audio?.play(chime);
  }

  private inhibited(d: CasMessageDef, to: boolean, ldg: boolean, ph: FlightPhaseName): boolean {
    const i = d.inhibit;
    if (!i) return false;
    if (i === 'takeoff') return to;
    if (i === 'landing') return ldg;
    if (i === 'takeoff+landing') return to || ldg;
    return i.includes(ph);
  }

  private count(level: CasLevel, unackedOnly: boolean): number {
    let n = 0;
    for (const m of this.msgs) if (m.active && m.level === level && (!unackedOnly || (!m.acknowledged && m.masters))) n++;
    return n;
  }
}
