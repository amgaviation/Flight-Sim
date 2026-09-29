/**
 * Bus source selection logic (bus power control unit / BPCU behaviour).
 *
 * A `SourceSelector` decides which of several candidate sources feeds a bus
 * and publishes the choice as an index var; the aircraft's contactor
 * bindings then read it, e.g. `closed: 'elec.xfr1_sel_src == 2'`.
 *
 * Modes:
 *  - 'priority': the highest-priority available source is selected
 *    automatically (Global/Gulfstream-style automatic AC bus priority:
 *    onside generator > APU generator > external > cross-side generator).
 *  - 'manual': a rising edge on a source's `select` binding latches it
 *    (Boeing 737 momentary GEN/APU GEN/GRD POWER switches: the new source
 *    replaces the old one); `deselect` (GEN OFF) drops it. If the latched
 *    source becomes unavailable the bus is unpowered, unless `autoTransfer`
 *    is true (737 BUS TRANSFER AUTO), in which case the highest-priority
 *    available `autoCandidate` takes over and control returns to the
 *    manually selected source when it recovers.
 *
 * A non-zero `transferDelayS` makes every change pass through 0 (no source)
 * for that time (break-before-make: EST ~50 ms transfer gap on real BPCUs).
 *
 * Outputs: `<prefix><id>_src` (0 = none, 1..n = 1-based index into
 * `sources`), `<prefix><id>_off` (1 while nothing is selected).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { compileCondition, type Binding } from '../util/binding';
import { checkId } from '../util/ids';

export interface SourceSelectorSource {
  /** Label for debugging/UI. */
  name?: string;
  /** Source can power the bus (e.g. 'elec.gen1_avail'). */
  available: Binding;
  /** Manual mode: rising edge selects this source. */
  select?: Binding;
  /** Manual mode with autoTransfer: may be used as an automatic alternate (default true). */
  autoCandidate?: boolean;
}

export interface SourceSelectorDef {
  id: string;
  mode: 'priority' | 'manual';
  /** Candidates in priority order (first = highest priority). */
  sources: SourceSelectorSource[];
  /** Manual mode: rising edge deselects the current source. */
  deselect?: Binding;
  /** Manual mode: automatic transfer to an alternate when the selected source fails (default false). */
  autoTransfer?: Binding;
  /** Manual mode: initial selection (1-based, 0 = none). Default 0. */
  initial?: number;
  transferDelayS?: number;
  /** Var prefix (default 'elec.'). */
  prefix?: string;
}

export class SourceSelector implements Subsystem {
  readonly name: string;
  /** 1-based manual selection (0 = none). */
  selected: number;
  /** Currently output source (after delays/auto-transfer). */
  output = 0;
  private target = 0;
  private gapTimer = 0;
  private readonly avail: (() => boolean)[];
  private readonly selects: ((() => boolean) | null)[];
  private readonly prevSelect: Uint8Array;
  private readonly autoCand: Uint8Array;
  private readonly deselect: () => boolean;
  private prevDeselect = false;
  private readonly autoTransfer: () => boolean;
  private readonly delay: number;
  private readonly vSrc: string;
  private readonly vOff: string;

  constructor(
    private readonly vars: SimVars,
    private readonly def: SourceSelectorDef,
  ) {
    checkId(def.id, 'SourceSelector');
    if (def.sources.length === 0) throw new Error(`SourceSelector '${def.id}': no sources`);
    this.name = `selector.${def.id}`;
    this.avail = def.sources.map((s) => compileCondition(vars, s.available, false));
    this.selects = def.sources.map((s) => (s.select !== undefined ? compileCondition(vars, s.select, false) : null));
    this.prevSelect = new Uint8Array(def.sources.length);
    this.autoCand = Uint8Array.from(def.sources.map((s) => (s.autoCandidate === false ? 0 : 1)));
    this.deselect = compileCondition(vars, def.deselect, false);
    this.autoTransfer = compileCondition(vars, def.autoTransfer, false);
    this.delay = def.transferDelayS ?? 0;
    const p = def.prefix ?? 'elec.';
    this.vSrc = `${p}${def.id}_src`;
    this.vOff = `${p}${def.id}_off`;
    this.selected = vars.has(this.vSrc) ? vars.get(this.vSrc) : (def.initial ?? 0);
    this.output = this.selected;
    this.target = this.selected;
    // Arm edge detection with the current switch states so a held switch does not select on load.
    for (let i = 0; i < this.selects.length; i++) this.prevSelect[i] = this.selects[i]?.() ? 1 : 0;
    this.prevDeselect = this.deselect();
  }

  update(dt: number): void {
    const n = this.avail.length;
    let want = 0;
    if (this.def.mode === 'priority') {
      for (let i = 0; i < n; i++) {
        if (this.avail[i]()) {
          want = i + 1;
          break;
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const f = this.selects[i];
        if (!f) continue;
        const on = f();
        if (on && this.prevSelect[i] === 0 && this.avail[i]()) this.selected = i + 1;
        this.prevSelect[i] = on ? 1 : 0;
      }
      const d = this.deselect();
      if (d && !this.prevDeselect) this.selected = 0;
      this.prevDeselect = d;
      if (this.selected > 0 && this.avail[this.selected - 1]()) want = this.selected;
      else if (this.selected > 0 && this.autoTransfer()) {
        for (let i = 0; i < n; i++) {
          if (i + 1 !== this.selected && this.autoCand[i] && this.avail[i]()) {
            want = i + 1;
            break;
          }
        }
      }
    }
    // Break-before-make transfer gap.
    if (want !== this.target) {
      this.target = want;
      this.gapTimer = this.output !== 0 && want !== 0 ? this.delay : 0;
      if (this.gapTimer > 0) this.output = 0;
    }
    if (this.gapTimer > 0) {
      this.gapTimer -= dt;
      if (this.gapTimer <= 0) this.output = this.target;
    } else this.output = this.target;
    this.vars.set(this.vSrc, this.output);
    this.vars.set(this.vOff, this.output === 0 ? 1 : 0);
  }

  reset(): void {
    if (this.vars.has(this.vSrc)) {
      this.selected = this.vars.get(this.vSrc);
      this.output = this.target = this.selected;
    }
    this.gapTimer = 0;
  }

  /** Forces a manual selection (applyState presets). */
  select(index1: number): void {
    this.selected = Math.max(0, Math.min(this.avail.length, Math.round(index1)));
  }
}
