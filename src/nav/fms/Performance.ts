/**
 * Simple FMS performance predictions: distance, ETE, ETA and fuel remaining
 * at every remaining waypoint, from the current ground speed and total fuel
 * flow (straight extrapolation, like the Garmin "fuel at destination" and the
 * FMC progress page without a performance database).
 *
 * SCOPE: no wind/temperature forecast, climb/descent fuel models or reserve
 * logic.
 */
import type { SimVars } from '../../core/SimVars';
import { ENG, ENV, FMS, FUEL, GPS } from '../../core/vars';
import { LB_TO_KG } from '../../core/units';
import type { FlightPlan } from '../flightplan/FlightPlan';

export interface PerformanceOptions {
  /** Engines summed for fuel flow (`eng{i}.ff_pph`), default 1. */
  engineCount?: number;
  /** Total fuel var (kg), default `fuel.total_kg`. */
  fuelVar?: string;
}

export class PerformancePredictor {
  private readonly vars: SimVars;
  private readonly ffVars: string[];
  private readonly fuelVar: string;
  /** Per-leg predictions, index-aligned with `plan.legs` (valid for indices >= active leg). */
  distNm = new Float64Array(64);
  eteS = new Float64Array(64);
  etaUtcH = new Float64Array(64);
  fuelKg = new Float64Array(64);
  count = 0;
  /** Total fuel flow (kg/h) used for the last prediction. */
  fuelFlowKgH = 0;

  constructor(vars: SimVars, opts: PerformanceOptions = {}) {
    this.vars = vars;
    const n = opts.engineCount ?? 1;
    this.ffVars = [];
    for (let i = 1; i <= n; i++) this.ffVars.push(ENG.fuelFlowPph(i));
    this.fuelVar = opts.fuelVar ?? FUEL.totalKg;
  }

  private ensure(n: number): void {
    if (this.distNm.length >= n) return;
    const size = Math.max(n, this.distNm.length * 2);
    this.distNm = new Float64Array(size);
    this.eteS = new Float64Array(size);
    this.etaUtcH = new Float64Array(size);
    this.fuelKg = new Float64Array(size);
  }

  /** Recomputes predictions. `alongNm` is the aircraft's along-plan position. */
  update(plan: FlightPlan, activeIdx: number, alongNm: number, lastIdx: number): void {
    const v = this.vars;
    const n = plan.legs.length;
    this.ensure(n);
    this.count = n;
    const gs = v.get(GPS.gs);
    let ffPph = 0;
    for (let k = 0; k < this.ffVars.length; k++) ffPph += v.get(this.ffVars[k]);
    this.fuelFlowKgH = ffPph * LB_TO_KG;
    const fuel = v.get(this.fuelVar);
    const utc = v.has(GPS.utcH) ? v.get(GPS.utcH) : v.get(ENV.timeUtcHours);
    for (let k = 0; k < n; k++) {
      if (k < activeIdx) {
        this.distNm[k] = 0;
        this.eteS[k] = 0;
        this.etaUtcH[k] = NaN;
        this.fuelKg[k] = NaN;
        continue;
      }
      const d = Math.max(0, plan.legs[k].geom.cumDistNm - alongNm);
      const t = gs > 20 ? (d / gs) * 3600 : NaN;
      this.distNm[k] = d;
      this.eteS[k] = t;
      this.etaUtcH[k] = Number.isFinite(t) ? (((utc + t / 3600) % 24) + 24) % 24 : NaN;
      this.fuelKg[k] = Number.isFinite(t) ? fuel - (this.fuelFlowKgH * t) / 3600 : NaN;
    }
    if (lastIdx >= 0 && lastIdx < n && lastIdx >= activeIdx) {
      v.set(FMS.eteDestS, Number.isFinite(this.eteS[lastIdx]) ? this.eteS[lastIdx] : 0);
      v.set(FMS.etaDestUtcH, Number.isFinite(this.etaUtcH[lastIdx]) ? this.etaUtcH[lastIdx] : 0);
      v.set(FMS.fuelDestKg, Number.isFinite(this.fuelKg[lastIdx]) ? this.fuelKg[lastIdx] : 0);
    } else {
      v.set(FMS.eteDestS, 0);
      v.set(FMS.etaDestUtcH, 0);
      v.set(FMS.fuelDestKg, 0);
    }
  }
}
