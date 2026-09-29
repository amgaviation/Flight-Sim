/**
 * Active / modified flight plan handling.
 *
 * - Garmin style (G1000/G3000/GTN): edits apply to the active plan
 *   immediately; `edit()` returns the active plan.
 * - Boeing style (FMC/CDU): the first edit creates a modified copy ("MOD");
 *   the active plan keeps flying until `exec()` promotes the copy (EXEC key)
 *   or `erase()` discards it (ERASE prompt). `fms.mod_pending` drives the EXEC
 *   light.
 *
 * The active leg survives EXEC by leg id (ids are preserved by
 * `FlightPlan.clone()`); a deleted active leg falls back to the next leg that
 * still exists.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import { FMS } from '../../core/vars';
import { FlightPlan, type EditStyle } from './FlightPlan';

export type PlanChangeListener = (plan: FlightPlan, reason: 'edit' | 'exec' | 'erase' | 'replace') => void;

/** EventBus events emitted by the manager. */
export const PLAN_EVENTS = {
  /** Payload `{ reason }`: the active plan changed (edit in Garmin style, exec, replace). */
  activeChanged: 'fms.plan_active_changed',
  /** The modified (MOD) plan changed or was created/erased. */
  modChanged: 'fms.plan_mod_changed',
} as const;

export class FlightPlanManager {
  readonly style: EditStyle;
  active: FlightPlan;
  modified: FlightPlan | null = null;
  private readonly vars?: SimVars;
  private readonly events?: EventBus;
  private readonly listeners = new Set<PlanChangeListener>();

  constructor(style: EditStyle, opts: { vars?: SimVars; events?: EventBus } = {}) {
    this.style = style;
    this.vars = opts.vars;
    this.events = opts.events;
    this.active = new FlightPlan(style);
    this.publish();
  }

  /** True while a Boeing-style modification awaits EXEC. */
  get pending(): boolean {
    return this.modified !== null;
  }

  /** The plan to show on edit pages (MOD plan when pending, else active). */
  get displayed(): FlightPlan {
    return this.modified ?? this.active;
  }

  /**
   * The plan edits should be applied to. Garmin: the active plan (call
   * `commit()` afterwards to notify). Boeing: the modified copy (created on
   * first use).
   */
  edit(): FlightPlan {
    if (this.style === 'garmin') return this.active;
    if (!this.modified) {
      this.modified = this.active.clone();
      this.publish();
      this.events?.emit(PLAN_EVENTS.modChanged);
    }
    return this.modified;
  }

  /** Notifies listeners after an edit (Garmin: active changed; Boeing: MOD changed). */
  commit(): void {
    if (this.style === 'garmin') this.notify(this.active, 'edit');
    else {
      this.publish();
      this.events?.emit(PLAN_EVENTS.modChanged);
    }
  }

  /** Applies `fn` to the plan returned by `edit()` and commits. */
  apply<T>(fn: (plan: FlightPlan) => T): T {
    const r = fn(this.edit());
    this.commit();
    return r;
  }

  /** Boeing EXEC: promotes the modified plan. Returns false when nothing was pending. */
  exec(): boolean {
    if (!this.modified) return false;
    const next = this.modified;
    // Keep flying the leg the active plan is on (it may have sequenced while
    // the MOD was pending), unless the modification set the active leg itself
    // (direct-to in the MOD plan).
    const cur = this.active.activeLeg;
    if (!next.explicitActive && cur) {
      const i = next.indexOfLegId(cur.id);
      if (i >= 0) next.activeLegIndex = i;
      else {
        // Active leg deleted: fly to the first following leg that still exists.
        next.activeLegIndex = -1;
        for (let k = this.active.activeLegIndex + 1; k < this.active.legs.length; k++) {
          const j = next.indexOfLegId(this.active.legs[k].id);
          if (j >= 0) {
            next.activeLegIndex = j;
            break;
          }
        }
      }
    }
    next.explicitActive = false;
    this.active = next;
    this.modified = null;
    this.active.touch();
    this.notify(this.active, 'exec');
    return true;
  }

  /** Boeing ERASE: discards the modified plan. */
  erase(): void {
    if (!this.modified) return;
    this.modified = null;
    this.publish();
    this.events?.emit(PLAN_EVENTS.modChanged);
    this.listeners.forEach((fn) => fn(this.active, 'erase'));
  }

  /**
   * Replaces the plan (route entry, stored route load). Garmin: becomes active
   * immediately. Boeing: becomes the MOD plan awaiting EXEC (ACTIVATE + EXEC).
   */
  replace(plan: FlightPlan): void {
    plan.style = this.style;
    if (this.style === 'garmin') {
      this.active = plan;
      plan.touch();
      this.notify(plan, 'replace');
    } else {
      this.modified = plan;
      this.publish();
      this.events?.emit(PLAN_EVENTS.modChanged);
    }
  }

  onChange(fn: PlanChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(plan: FlightPlan, reason: 'edit' | 'exec' | 'erase' | 'replace'): void {
    this.publish();
    this.events?.emit(PLAN_EVENTS.activeChanged, { reason });
    this.listeners.forEach((fn) => fn(plan, reason));
  }

  private publish(): void {
    if (!this.vars) return;
    this.vars.set(FMS.modPending, this.modified ? 1 : 0);
    this.vars.set(FMS.planVersion, this.vars.get(FMS.planVersion) + 1);
    this.vars.set(FMS.cruiseAltFt, this.active.cruiseAltFt);
    this.vars.setString(FMS.destIdent, this.active.destination?.icao ?? '');
  }
}
