/**
 * Boeing 737-800 systems composition: every Subsystem in update order
 * (systems-power §0.2 / systems-control §0.1):
 *
 *   failures -> AC source selection -> glue logic (controls -> commands) ->
 *   electrical -> APU -> fuel -> hydraulics -> pneumatics / packs ->
 *   pressurization -> ice -> fire -> oxygen -> sensors (IRS 1/2, ADC 1/2/ISFD,
 *   ISFD attitude, RA 1/2) -> landing gear -> thrust ratings -> 737NG
 *   avionics suite (radios, FMS, CDS + FMC + CDUs, MCP / AFDS / A/T) -> EEC
 *   levers -> start controllers -> yaw damper, stall warning -> flight
 *   controls, stabilizer / aileron / rudder trim -> flaps, speedbrakes,
 *   steering, brakes -> overspeed, altitude alert, EGPWS, TCAS, take-off
 *   config -> annunciators (CAS) -> disconnect aurals -> lighting ->
 *   late logic (indicator outputs, master caution, fire bell).
 *
 * The cockpit (src/aircraft/b737-800/cockpit, other agent) maps the suite's
 * displays (`suite.displays`) onto its DU / CDU / MCP window meshes and
 * builds the hardware with the avionics cockpit helpers; every other control
 * writes the vars in vars.ts.
 */
import type { SimContext } from '../../core/SimContext';
import type { Subsystem } from '../types';
import { FailureManager, type FailureDef } from '../../systems/failures';
import { CasManager } from '../../systems/warning';
import type { ElectricalNetwork } from '../../systems/electrical';
import type { FuelSystem } from '../../systems/fuel';
import type { HydraulicSystem } from '../../systems/hydraulic';
import type { PneumaticSystem } from '../../systems/pneumatic';
import type { Pressurization } from '../../systems/pressurization';
import type { Apu } from '../../systems/apu';
import type { IceProtection } from '../../systems/ice';
import type { FireProtection } from '../../systems/fire';
import type { OxygenSystem } from '../../systems/oxygen';
import type { LightingSystem } from '../../systems/lighting';
import { createElectrical, AcSourceLogic } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics } from './systems/hydraulic';
import { createPneumatics, createPressurization, createApu, createIce, createFire, createOxygen, createLighting } from './systems/airframe';
import { createEngineControls, type EngineControls } from './systems/engines';
import { createFlightControls, type FlightControlBlocks } from './systems/flight';
import { createAvionics, type AvionicsBlocks, type AvionicsOptions } from './systems/avionics';
import { B738_ANNUNCIATORS } from './systems/cas';
import { B738Logic, B738LogicLate } from './systems/logic';

export interface B738Systems extends EngineControls, FlightControlBlocks, AvionicsBlocks {
  /** Update-ordered list for AircraftInstance.systems. */
  list: Subsystem[];
  failures: FailureManager;
  acSources: AcSourceLogic;
  logic: B738Logic;
  logicLate: B738LogicLate;
  elec: ElectricalNetwork;
  apu: Apu;
  fuel: FuelSystem;
  hyd: HydraulicSystem;
  pneu: PneumaticSystem;
  press: Pressurization;
  ice: IceProtection;
  fire: FireProtection;
  oxy: OxygenSystem;
  lights: LightingSystem;
  cas: CasManager;
}

export type CreateSystemsOptions = AvionicsOptions;

export function createSystems(ctx: SimContext, opts: CreateSystemsOptions = {}): B738Systems {
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 738 });
  const acSources = new AcSourceLogic(ctx);
  const logic = new B738Logic(ctx);
  const elec = createElectrical(ctx);
  const apu = createApu(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);
  const av = createAvionics(ctx, opts);
  // Without an FMC (no navigation database) the thrust rating computer selects its ratings itself.
  const eng = createEngineControls(ctx, { autoRating: !av.suite.fmc });
  const fc = createFlightControls(ctx);
  const cas = new CasManager(ctx, {
    messages: B738_ANNUNCIATORS.map(({ group: _g, light: _l, ...m }) => m),
    power: 'elec.dc1_powered || elec.dc2_powered || elec.batt_bus_powered || elec.dc_stby_powered',
    lampTest: 'ac.b738.lights_test >= 0.5',
    // The 737 master caution is silent; the fire bell and the warning horns are driven by the late logic.
    cautionChime: '',
    warningTone: '',
    // Master caution inhibits: none on the 737 beyond the per-light conditions (FCOM 15.20).
  });
  const lights = createLighting(ctx);
  const logicLate = new B738LogicLate(ctx);
  logicLate.cas = cas;

  const list: Subsystem[] = [
    failures,
    acSources,
    logic,
    elec,
    apu,
    fuel,
    hyd,
    pneu,
    press,
    ice,
    fire,
    oxy,
    ...av.irs,
    ...av.adc,
    av.isfdAhrs,
    ...av.ra,
    fc.gear,
    eng.ratings,
    ...av.suite.systems,
    eng.fadec,
    ...eng.starts,
    fc.yd,
    av.stall,
    fc.fcs,
    fc.stab,
    fc.aileronTrim,
    fc.rudderTrim,
    fc.flaps,
    fc.spoilers,
    fc.steering,
    fc.brakes,
    av.overspeed,
    av.altAlert,
    av.taws,
    av.tcas,
    av.tocw,
    cas,
    av.disc,
    lights,
    logicLate,
  ];
  const seen = new Set<string>();
  for (const s of [...list, av.suite]) {
    if (s === failures) continue;
    const f = (s as { failures?: () => FailureDef[] }).failures;
    if (typeof f !== 'function') continue;
    const defs = f.call(s).filter((d) => !seen.has(d.id));
    for (const d of defs) seen.add(d.id);
    failures.register(defs);
  }
  return { list, failures, acSources, logic, logicLate, elec, apu, fuel, hyd, pneu, press, ice, fire, oxy, lights, cas, ...eng, ...fc, ...av };
}
