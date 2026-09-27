/**
 * Citation M2 systems composition: every Subsystem in update order
 * (systems-power §0.2 / systems-control §0.1):
 *
 *   failures -> M2Logic (controls -> relays/valves) -> electrical -> fuel ->
 *   hydraulics -> bleed/ECS -> pressurization -> ice -> fire -> oxygen ->
 *   sensors (ADC 1/2/ESI, AHRS 1/2/ESI, RA) -> landing gear -> thrust ratings ->
 *   G3000 (radio power, radios, FMS, G3000 system, GMC 710) -> AFCS ->
 *   FADEC levers -> start controllers -> yaw damper, stall warning ->
 *   mechanical flight controls, trims -> flaps, speed brakes, steering, brakes ->
 *   overspeed, altitude alerter, TAWS, TCAS, takeoff config -> CAS ->
 *   disconnect aurals -> lighting -> M2LogicLate (annunciator outputs).
 *
 * The cockpit (src/aircraft/citation-m2/cockpit, other agent) maps
 * `suite.displayList()` onto its screen meshes and builds the G3000 hardware
 * from `g3000Controls(suite.cfg)`; all other controls write the vars in vars.ts.
 */
import type { SimContext } from '../../core/SimContext';
import type { Subsystem, Checklist } from '../types';
import { FailureManager, type FailureDef } from '../../systems/failures';
import { CasManager } from '../../systems/warning';
import type { ElectricalNetwork } from '../../systems/electrical';
import type { FuelSystem } from '../../systems/fuel';
import type { HydraulicSystem } from '../../systems/hydraulic';
import type { PneumaticSystem } from '../../systems/pneumatic';
import type { Pressurization } from '../../systems/pressurization';
import type { IceProtection } from '../../systems/ice';
import type { FireProtection } from '../../systems/fire';
import type { OxygenSystem } from '../../systems/oxygen';
import type { LightingSystem } from '../../systems/lighting';
import { createElectrical } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics, createPneumatics, createPressurization, createIce, createFire, createOxygen, createLighting } from './systems/airframe';
import { createEngineControls, type EngineControls } from './systems/engines';
import { createFlightControls, type FlightControlBlocks } from './systems/flight';
import { createAvionics, type AvionicsBlocks, type AvionicsOptions } from './systems/avionics';
import { M2_CAS } from './systems/cas';
import { M2Logic, M2LogicLate } from './systems/logic';
import { M2AvionicsHealth } from './systems/avionicsHealth';
import { M2, TEST_SEL } from './vars';
import { GcuController } from '../../avionics/garmin-g3000/state/Gcu';

export interface M2Systems extends EngineControls, FlightControlBlocks, AvionicsBlocks {
  /** Update-ordered list for AircraftInstance.systems. */
  list: Subsystem[];
  failures: FailureManager;
  logic: M2Logic;
  logicLate: M2LogicLate;
  avnHealth: M2AvionicsHealth;
  elec: ElectricalNetwork;
  fuel: FuelSystem;
  hyd: HydraulicSystem;
  pneu: PneumaticSystem;
  press: Pressurization;
  ice: IceProtection;
  fire: FireProtection;
  oxy: OxygenSystem;
  lights: LightingSystem;
  cas: CasManager;
  gcu: GcuController;
}

export interface CreateSystemsOptions extends AvionicsOptions {
  checklists?: Checklist[];
}

export function createSystems(ctx: SimContext, opts: CreateSystemsOptions = {}): M2Systems {
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 525 });
  const logic = new M2Logic(ctx);
  const elec = createElectrical(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);
  const eng = createEngineControls(ctx);
  const fc = createFlightControls(ctx);
  const av = createAvionics(ctx, opts);
  av.suite.system.trafficSource = av.tcas;
  const cas = new CasManager(ctx, {
    messages: M2_CAS,
    // The CAS is a G3000 function (S&D21 §10.3 / §10.3.9): no GIA (IOP) powered, no CAS and no master annunciation.
    power: 'elec.gia1_powered || elec.gia2_powered',
    lampTest: `${M2.testSel} == ${TEST_SEL.annu}`,
    sinks: [av.suite.casModel],
    // Flight-phase inhibits per message (systems/cas.ts `inhibit: 'takeoff+landing'`): FlightPhase defaults, takeoff
    // 80 kt -> 400 ft RA, landing below 200 ft RA (dossier §8, CJ family EST).
  });
  const lights = createLighting(ctx);
  const logicLate = new M2LogicLate(ctx);
  // Power-loss consequences of LRUs without a power input in the shared models (GMA, XPDR, radar, GDU cooling).
  const avnHealth = new M2AvionicsHealth(ctx, av.suite);
  // GCU 275 PFD controllers (LH / RH, under the glareshield; S&D15 §10.2.A / §10.3.D).
  const gcu = new GcuController(av.suite.system, [1, 2]);

  const list: Subsystem[] = [
    failures,
    logic,
    elec,
    fuel,
    hyd,
    pneu,
    press,
    ice,
    fire,
    oxy,
    ...av.adc,
    ...av.ahrs,
    av.ra,
    fc.gear,
    eng.ratings,
    ...av.suite.systems,
    gcu,
    avnHealth,
    av.afcs,
    eng.fadec,
    ...eng.starts,
    fc.yd,
    av.stall,
    fc.fcs,
    fc.pitchTrim,
    fc.aileronTrim,
    fc.rudderTrim,
    fc.flaps,
    fc.speedbrakes,
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
  for (const s of list) {
    if (s === failures) continue;
    const f = (s as { failures?: () => FailureDef[] }).failures;
    if (typeof f === 'function') failures.register(f.call(s));
  }
  return { list, failures, logic, logicLate, avnHealth, gcu, elec, fuel, hyd, pneu, press, ice, fire, oxy, lights, cas, ...eng, ...fc, ...av };
}
