/**
 * EIS fuel totalizer and engine hours (PG 190-02177-02 §3 "Engine Indication
 * System", Table 3-1 "EIS Softkeys"; POH 172SPHAUS-03 §7 "Fuel Flow"):
 *
 *  - GAL USED integrates the fuel flow since the last RST Fuel;
 *    GAL REM = the pilot-entered amount minus GAL USED. The totalizer does
 *    not measure the tanks: "the fuel totalizer ... is not a fuel quantity
 *    indicator" — GAL REM is only as good as the starting value.
 *  - Softkeys (Engine > System > GAL REM): -10 GAL / -1 GAL / +1 GAL /
 *    +10 GAL adjust, 35 GAL / 53 GAL preset the remaining fuel; System >
 *    RST Fuel "resets calculated fuel remaining to default and resets fuel
 *    used to zero" (PG Table 1-4).
 *  - ENG HRS: hour meter that runs while the engine oil pressure is above
 *    20 psi (the same oil-pressure switch as the Hobbs meter, POH §7).
 *
 * Also keeps the trip data used by the Aux - Trip Planning / Utility pages:
 * flight time (airborne), trip odometer (GPS ground speed), total odometer,
 * maximum ground speed and departure time.
 */
import type { SimVars } from '../../../core/SimVars';
import { GPS } from '../../../core/vars';
import { compileBinding, type Evaluator } from '../../../systems/util/binding';
import type { G1kEisConfig } from '../config';
import { G1K } from '../vars';

/** Engine-hours counting threshold (POH §7: hour meter via the oil pressure switch, 20 psi). */
const ENG_HRS_OIL_PSI = 20;

export class FuelTotalizer {
  private readonly ff: Evaluator;
  private readonly oil: Evaluator;
  private readonly hours: Evaluator | null;
  readonly presets: readonly number[];
  private wasAirborne = false;

  constructor(private readonly vars: SimVars, private readonly eis: G1kEisConfig) {
    this.ff = compileBinding(vars, eis.totalizer.fuelFlowGph, 0);
    this.oil = compileBinding(vars, eis.oilPress.value, 0);
    this.hours = eis.engineHours !== undefined ? compileBinding(vars, eis.engineHours, 0) : null;
    this.presets = eis.totalizer.presetsGal;
    if (!vars.has(G1K.fuelRemGal)) vars.set(G1K.fuelRemGal, eis.totalizer.defaultGal);
    if (!vars.has(G1K.fuelUsedGal)) vars.set(G1K.fuelUsedGal, 0);
    if (!vars.has(G1K.engineHours)) vars.set(G1K.engineHours, 0);
  }

  get remainingGal(): number {
    return this.vars.get(G1K.fuelRemGal);
  }
  get usedGal(): number {
    return this.vars.get(G1K.fuelUsedGal);
  }

  /** RST Fuel softkey (PG Table 1-4): "Resets calculated fuel remaining to default and resets fuel used to zero". */
  resetFuel(): void {
    this.vars.set(G1K.fuelRemGal, this.eis.totalizer.defaultGal);
    this.vars.set(G1K.fuelUsedGal, 0);
  }

  /** -10 / -1 / +1 / +10 GAL softkeys. */
  adjust(gal: number): void {
    const v = this.vars;
    v.set(G1K.fuelRemGal, Math.max(0, Math.min(999, v.get(G1K.fuelRemGal) + gal)));
  }

  /** 35 GAL / 53 GAL softkeys: "Sets remaining fuel to 35 gallons" (PG Table 1-4). */
  preset(gal: number): void {
    this.vars.set(G1K.fuelRemGal, gal);
  }

  /** Engine hours shown on the EIS. */
  engineHours(): number {
    return this.hours ? this.hours() : this.vars.get(G1K.engineHours);
  }

  update(dt: number, eaPowered: boolean, airborne: boolean): void {
    const v = this.vars;
    // The GEA / GIA must be up for the integration (the totalizer runs in the system).
    if (eaPowered) {
      const gph = Math.max(0, this.ff());
      const used = (gph * dt) / 3600;
      if (used > 0) {
        v.set(G1K.fuelUsedGal, v.get(G1K.fuelUsedGal) + used);
        v.set(G1K.fuelRemGal, Math.max(0, v.get(G1K.fuelRemGal) - used));
      }
      if (!this.hours && this.oil() > ENG_HRS_OIL_PSI) v.set(G1K.engineHours, v.get(G1K.engineHours) + dt / 3600);
    }
    // FMS fuel predictions use the totalizer (fuel on board = GAL REM, 6.0 lb/gal = 2.7216 kg/gal).
    v.set(G1K.fuelRemKg, v.get(G1K.fuelRemGal) * 2.7216);
    // Trip data (GPS).
    if (airborne && !this.wasAirborne) v.set(G1K.departureTimeH, v.get(GPS.utcH));
    this.wasAirborne = airborne;
    if (airborne) v.set(G1K.flightTimeS, v.get(G1K.flightTimeS) + dt);
    if (v.get(GPS.valid) >= 0.5) {
      const gs = v.get(GPS.gs);
      const nm = (gs * dt) / 3600;
      if (gs > 1) {
        v.set(G1K.tripOdoNm, v.get(G1K.tripOdoNm) + nm);
        v.set(G1K.odometerNm, v.get(G1K.odometerNm) + nm);
      }
      if (gs > v.get(G1K.maxGsKt)) v.set(G1K.maxGsKt, gs);
    }
  }

  /** Aux - Utility page resets (flight timer, trip odometer, max speed). */
  resetTrip(what: 'flight' | 'trip' | 'odometer' | 'maxgs' | 'all'): void {
    const v = this.vars;
    if (what === 'flight' || what === 'all') v.set(G1K.flightTimeS, 0);
    if (what === 'trip' || what === 'all') v.set(G1K.tripOdoNm, 0);
    if (what === 'odometer' || what === 'all') v.set(G1K.odometerNm, 0);
    if (what === 'maxgs' || what === 'all') v.set(G1K.maxGsKt, 0);
  }
}
