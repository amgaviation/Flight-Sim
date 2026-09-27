/**
 * Cessna 172S fire and cabin smoke model, so the POH Section 3 fire procedures can be flown
 * (POH 172SPHBUS-00 3-9 .. 3-12, 172SPHUS 3-7 .. 3-10): "Fire during start on ground",
 * "Engine fire in flight", "Electrical fire in flight", "Cabin fire", "Wing fire".
 *
 * Each fire starts on the rising edge of its failure (FailureManager) and burns until the
 * procedure removes what feeds it; once out it stays out until the failure is cleared and set
 * again. Growth / decay time constants are EST (no public data): chosen so that the POH action
 * puts the fire out within ~0.5-1.5 min and neglecting it lets it grow to full intensity.
 *
 *  - Engine compartment fire: fed by fuel (FUEL SHUTOFF ON and fuel flowing, or the electric FUEL
 *    PUMP running); with the fuel cut it burns out the residual fuel and oil, faster at a high
 *    airspeed (POH: "increase glide speed to find an airspeed ... which will provide an
 *    incombustible mixture"). Hot air from the engine compartment enters the cabin through the
 *    CABIN HT / CABIN AIR valves (POH: "CABIN HEAT and AIR Control Knobs - OFF").
 *  - Fire during start: an induction fire that the engine sucks in once it runs (POH: "continue
 *    cranking to get a start which would suck the flames and accumulated fuel through the carburetor
 *    [induction] and into the engine"); cranking alone slowly reduces it; with fuel still supplied and
 *    the engine stopped it keeps burning.
 *  - Electrical fire: in the wiring behind the panel; grows while that wiring is energised (any main,
 *    crossfeed, essential or avionics bus above 10 V, so the STBY BATT and MASTER switches must both
 *    be OFF), dies when de-energised; the Halon extinguisher knocks it down.
 *  - Cabin fire: only the extinguisher puts it out; fresh air (vents, CABIN AIR, windows) feeds it.
 *  - Wing fire (left wing: landing / taxi lights in the left wing leading edge, POH Sec 7; nav and
 *    strobe lights, pitot heat): fed while that wiring is energised; goes out when switched off.
 *
 * Cabin smoke (0..1): from the electrical and cabin fires, and from an engine fire through open
 * CABIN HT / CABIN AIR valves; cleared by ventilation (CABIN AIR, wing-root vents, storm windows),
 * which the POH opens only after the fire is out. The Halon agent concentration (`C172.extAgent`)
 * rises while the extinguisher discharges and is ventilated away (POH 7-79: "ventilate the cabin").
 *
 * Outputs: C172.fireEngine / fireElectrical / fireCabin / fireWing (0..1), C172.fireAny,
 * C172.cabinSmoke, C172.extAgent. Reads (option) `extDischarging`: 1 while the extinguisher discharges.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { ENG, FDM } from '../../../core/vars';
import { C172, C172_FAIL } from '../vars';

export interface C172FireOptions {
  /** Var that is 1 while the portable extinguisher discharges into the cabin. */
  extDischarging?: string;
}

/** EST fire dynamics (s). */
export const FIRE_DATA = {
  /** Growth time constant of a fed fire. */
  growS: 25,
  /** Residual engine fire (fuel cut) burn-out time constant, and at >= 100 KIAS (POH dive). */
  engineResidualS: 45,
  engineResidualFastS: 12,
  /** Induction fire: engine running sucks it in / cranking / stopped with fuel. */
  startRunningS: 3,
  startCrankingS: 15,
  /** Electrical fire decay once the wiring is de-energised; with Halon present. */
  elecDeadS: 15,
  halonS: 2.5,
  /** Halon concentration above which the extinguisher knocks a cabin/electrical fire down. */
  halonEffective: 0.25,
  /** Halon: rise per second of discharge (bottle empties in ~8 s, POH 7-79), ventilation decay. */
  halonRisePerS: 0.25,
  /** Wing fire decay once its wiring is off. */
  wingDeadS: 20,
  /** Below this intensity a fire is out. */
  outBelow: 0.02,
} as const;

interface Fire {
  fail: string;
  prevFail: boolean;
  burning: boolean;
  i: number;
}

export class C172Fire implements Subsystem {
  readonly name = 'c172-fire';
  private readonly eng: Fire;
  private readonly start: Fire;
  private readonly elec: Fire;
  private readonly cabin: Fire;
  private readonly wing: Fire;
  private smoke = 0;
  private agent = 0;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly opts: C172FireOptions = {},
  ) {
    const mk = (id: string): Fire => ({ fail: `fail.${id}`, prevFail: false, burning: false, i: 0 });
    this.eng = mk(C172_FAIL.fireEngine);
    this.start = mk(C172_FAIL.fireStart);
    this.elec = mk(C172_FAIL.fireElectrical);
    this.cabin = mk(C172_FAIL.fireCabin);
    this.wing = mk(C172_FAIL.fireWing);
  }

  failures(): FailureDef[] {
    const c = 'fire';
    return [
      { id: C172_FAIL.fireEngine, name: 'Engine compartment fire', category: c, description: 'Fed by fuel: mixture IDLE CUTOFF, FUEL SHUTOFF OFF, FUEL PUMP OFF; smoke enters through CABIN HT / AIR.' },
      { id: C172_FAIL.fireStart, name: 'Fire during start', category: c, description: 'Induction fire: keep cranking to start the engine and suck it in; otherwise cut the fuel.' },
      { id: C172_FAIL.fireElectrical, name: 'Electrical fire (behind the panel)', category: c, description: 'Smoke: STBY BATT and MASTER OFF, vents closed, extinguisher.' },
      { id: C172_FAIL.fireCabin, name: 'Cabin fire', category: c, description: 'Only the portable extinguisher puts it out; fresh air feeds it.' },
      { id: C172_FAIL.fireWing, name: 'Left wing fire', category: c, description: 'Fed by the wing lights / pitot heat wiring: switch them OFF.' },
    ];
  }

  reset(): void {
    for (const f of [this.eng, this.start, this.elec, this.cabin, this.wing]) {
      f.prevFail = this.vars.get(f.fail) !== 0;
      f.burning = false;
      f.i = 0;
    }
    this.smoke = 0;
    this.agent = 0;
    this.publish();
  }

  private edge(f: Fire): void {
    const on = this.vars.get(f.fail) !== 0;
    if (on && !f.prevFail) {
      f.burning = true;
      f.i = Math.max(f.i, 0.15);
    }
    if (!on) f.burning = false;
    f.prevFail = on;
  }

  /** Grows toward 1 while fed, else decays with time constant `tauS` (Infinity = holds). */
  private step(f: Fire, fed: boolean, tauS: number, dt: number): void {
    if (!f.burning) {
      f.i = 0;
      return;
    }
    if (fed) f.i += (1 - f.i) * (1 - Math.exp(-dt / FIRE_DATA.growS));
    else if (Number.isFinite(tauS)) f.i *= Math.exp(-dt / tauS);
    if (f.i < FIRE_DATA.outBelow) {
      f.burning = false;
      f.i = 0;
    }
  }

  update(dt: number): void {
    const v = this.vars;
    for (const f of [this.eng, this.start, this.elec, this.cabin, this.wing]) this.edge(f);
    const ias = v.get(FDM.ias); // physical airflow (truth), not an avionics reading
    const running = v.get(ENG.running(1)) > 0.5;
    const cranking = v.get('elec.starter_engaged') > 0.5;
    const shutoffOn = v.get(C172.fuelShutoff, 1) > 0.5;
    const pump = v.get(C172.fuelPump) > 0.5 && v.get('elec.fuel_pump_powered') > 0.5;
    const flowing = v.get(ENG.fuelFlowGph(1)) > 0.2;
    const fuelFed = shutoffOn && (flowing || pump);
    // Ventilation (same weighting as the cabin air model in logic.ts).
    const air = clamp01(v.get(C172.cabinAir));
    const heat = clamp01(v.get(C172.cabinHeat));
    const vent = air + 0.5 * clamp01(v.get(C172.windowLeft) + v.get(C172.windowRight)) + 0.3 * (v.get(C172.ventLeft) + v.get(C172.ventRight)) / 2;
    // Halon in the cabin.
    const disch = this.opts.extDischarging ? v.get(this.opts.extDischarging) > 0.5 : false;
    if (disch) this.agent = Math.min(1, this.agent + FIRE_DATA.halonRisePerS * dt);
    this.agent *= Math.exp(-dt * (0.005 + 0.03 * vent));
    const halon = this.agent > FIRE_DATA.halonEffective;

    // Engine compartment.
    this.step(this.eng, fuelFed, ias >= 95 ? FIRE_DATA.engineResidualFastS : FIRE_DATA.engineResidualS, dt);
    // Induction fire during start.
    const startTau = running ? FIRE_DATA.startRunningS : cranking ? FIRE_DATA.startCrankingS : fuelFed ? Infinity : FIRE_DATA.engineResidualS * 2;
    this.step(this.start, !running && !cranking && fuelFed, startTau, dt);
    // Electrical: any energised bus behind the panel.
    const busV = Math.max(v.get('elec.xfeed_v'), v.get('elec.bus1_v'), v.get('elec.bus2_v'), v.get('elec.ess_v'), v.get('elec.avn1_v'), v.get('elec.avn2_v'));
    const energised = busV > 10;
    this.step(this.elec, energised && !halon, halon ? FIRE_DATA.halonS : energised ? Infinity : FIRE_DATA.elecDeadS, dt);
    // Cabin: fresh air feeds it, only Halon puts it out.
    this.step(this.cabin, !halon && vent > 0.3, halon ? FIRE_DATA.halonS : Infinity, dt);
    // Left wing wiring.
    const wingLive =
      (v.get('elec.land_lt_powered') > 0.5 && v.get(C172.land) > 0.5) ||
      (v.get('elec.taxi_lt_powered') > 0.5 && v.get(C172.taxi) > 0.5) ||
      (v.get('elec.nav_lts_powered') > 0.5 && v.get(C172.nav) > 0.5) ||
      (v.get('elec.strobe_lts_powered') > 0.5 && v.get(C172.strobe) > 0.5) ||
      (v.get('elec.pitot_heat_powered') > 0.5 && v.get(C172.pitotHeat) > 0.5);
    this.step(this.wing, wingLive, FIRE_DATA.wingDeadS, dt);

    // Cabin smoke.
    const engI = Math.max(this.eng.i, this.start.i);
    const src = 0.6 * this.elec.i + 1.0 * this.cabin.i + engI * (0.05 + 0.8 * Math.max(heat, air));
    this.smoke += (0.05 * src * (1 - this.smoke) - this.smoke * (0.004 + 0.06 * vent)) * dt;
    this.smoke = clamp01(this.smoke);
    this.publish();
  }

  private publish(): void {
    const v = this.vars;
    const engI = Math.max(this.eng.i, this.start.i);
    v.set(C172.fireEngine, engI);
    v.set(C172.fireElectrical, this.elec.i);
    v.set(C172.fireCabin, this.cabin.i);
    v.set(C172.fireWing, this.wing.i);
    v.set(C172.fireAny, engI > 0 || this.elec.i > 0 || this.cabin.i > 0 || this.wing.i > 0 ? 1 : 0);
    v.set(C172.cabinSmoke, this.smoke);
    v.set(C172.extAgent, this.agent);
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
