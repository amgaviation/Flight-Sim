/**
 * Gulfstream G650 initial states (cold & dark, ready to taxi, takeoff,
 * cruise, approach). Every cockpit control of the inventory
 * (docs/aircraft/g650.md, vars.ts G650_CONTROL_VARS) is set to its normal
 * position for the phase (checklists.ts flow); system internals are then
 * snapped so the indications match at once. Free of Three.js (headless tests).
 *
 * Contract (docs/modules/app.md §2.4): the app has already called
 * `fdm.reposition(...)`. In-air states trim themselves: stabilizer from
 * `FlightModel.computeTrim` (the FBW auto-trim state), thrust levers from the
 * FADEC lever law by bisection on the N1 that gives the trim thrust.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, SURF } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { G650_VARS as V } from './vars';
import type { G650Systems } from './createSystems';

/** Takeoff stabilizer (normalized, EST mid-CG setting inside the -0.2..0.35 green band). */
export const TAKEOFF_STAB = 0.1;

/** Thrust-lever position giving N1 `n1` in the current conditions (bisection on the FADEC lever law). */
export function leverForN1(sys: G650Systems, ctx: SimContext, n1: number): number {
  const v = ctx.vars;
  sys.ratings.update(1 / 60);
  const idle = sys.fadec.idleN1(v.get(FDM.pressAlt), v.get('gear.air_ground') !== 0);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (sys.fadec.forwardN1(mid, idle) < n1) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Writes every cockpit switch / lever var for the state (no system snapping). */
export function setG650Switches(ctx: Pick<SimContext, 'vars'>, sys: G650Systems, s: InitialState): void {
  const v = ctx.vars;
  const powered = s !== 'cold_dark';
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = v.get('env.ambient_light', 1) < 0.5;
  const b = (x: boolean) => (x ? 1 : 0);

  // ---- ELECTRICAL POWER CONTROL / EMERGENCY POWER / FLT CTRL BATTERIES
  v.set(V.battL, b(powered));
  v.set(V.battR, b(powered));
  v.set(V.genL, 1); // GEN switches live ON (they cycle the GCU when OFF -> ON)
  v.set(V.genR, 1);
  v.set(V.apuGen, 1);
  v.set(V.extPwr, 0);
  v.set(V.gpuAvail, 0);
  v.set(V.busTieL, 1);
  v.set(V.busTieR, 1);
  v.set(V.gsb, 0);
  v.set(V.elecReset, 0);
  v.set(V.lMainTru, 1);
  v.set(V.rMainTru, 1);
  v.set(V.emerPwr, powered ? 1 : 0);
  v.set(V.ratDeploy, 0);
  v.set(V.ratGen, 1);
  v.set(V.ebhaBatt, b(powered));
  v.set(V.upsBatt, b(powered));
  v.set(V.cabinMaster, b(powered));
  v.set(V.galleyMaster, b(powered));
  // ---- APU (off once the engines run)
  v.set(V.apuMaster, 0);
  v.set(V.apuStart, 0);
  v.set(V.apuStop, 0);
  v.set(V.apuFireExt, 0);
  v.set(V.apuFireExtGuard, 0);
  v.set(V.apuFireTest, 0);
  // ---- FUEL (LIM: all operable boost pumps ON in all phases)
  for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, b(powered));
  v.set(V.xflow, 0);
  v.set(V.interTank, 0);
  v.set(V.fuelReturn, 1);
  // ---- HYDRAULICS
  v.set(V.auxPump, powered ? 1 : 0);
  v.set(V.ptu, powered ? 1 : 0);
  // ---- BLEED AIR / TEMP CONTROL / CABIN PRESSURE
  v.set(V.bleedL, b(powered));
  v.set(V.bleedR, b(powered));
  v.set(V.bleedApu, 0);
  v.set(V.isolation, 1);
  v.set(V.packL, 1);
  v.set(V.packR, 1);
  v.set(V.ramAir, 0);
  for (const z of [1, 2, 3] as const) {
    v.set(V.zoneTemp(z), z === 1 ? 21 : 22);
    v.set(V.zoneMan(z), 0);
  }
  v.set(V.pressMode, 0);
  v.set(V.ldgElevFt, -9999); // FMS destination
  v.set(V.manHold, 0);
  v.set(V.pressDump, 0);
  v.set(V.fltLdg, s === 'approach' ? 1 : 0);
  // ---- ANTI-ICE (conditions decide; knobs OFF, LIM), window heat ON, probe heaters ON
  for (const k of [V.wingL, V.wingR, V.cowlL, V.cowlR]) v.set(k, 0);
  for (const n of [1, 2, 3, 4] as const) v.set(V.probe(n), b(powered));
  for (const k of [V.wshldL, V.wshldR, V.cabinWdo, V.evsWdo]) v.set(k, b(powered));
  // ---- ENGINE START
  v.set(V.startMaster, 0);
  v.set(V.crankMaster, 0);
  v.set(V.startL, 0);
  v.set(V.startR, 0);
  v.set(V.contIgn, 0);
  // ---- FIRE TEST
  for (const k of [V.fireTestLA, V.fireTestLB, V.fireTestRA, V.fireTestRB, V.fireFaultTest]) v.set(k, 0);
  // ---- OXYGEN
  v.set(V.crewOxy, b(powered));
  v.set(V.paxOxy, 1); // AUTO
  v.set(V.paxShutoff, 1);
  v.set(V.oxyMaskL, 0);
  v.set(V.oxyMaskR, 0);
  v.set(V.oxyMaskMode, 0);
  // ---- LIGHTS
  v.set(V.ltNav, b(powered));
  v.set(V.ltBeacon, b(powered));
  v.set(V.ltStrobe, b(moving));
  const ldg = s === 'takeoff' || s === 'approach';
  v.set(V.ltLdgL, b(ldg));
  v.set(V.ltLdgR, b(ldg));
  v.set(V.ltTaxi, b(s === 'ready_to_taxi' || s === 'takeoff'));
  v.set(V.ltRecog, b(ldg));
  v.set(V.ltLogo, b(powered && night && !inAir));
  v.set(V.ltWing, 0);
  v.set(V.ltEmer, powered ? 1 : 0);
  v.set(V.seatBelt, b(moving));
  v.set(V.noSmoke, b(powered));
  v.set(V.ltPanel, powered ? (night ? 0.6 : 1) : 0);
  v.set(V.ltFlood, powered && night ? 0.25 : 0);
  v.set(V.ltDome, 0);
  // MASTER CONTROL: OFF (day mode) by day, night range (annunciators dimmed, backlighting on) at night.
  v.set(V.ltMaster, powered && night ? 0.5 : 0);
  v.set(V.vestOride, 0);
  v.set(V.ltMapL, 0);
  v.set(V.ltMapR, 0);
  for (const n of [1, 2, 3, 4] as const) v.set(V.duBrt(n), night ? 0.7 : 1);
  // ---- PEDESTAL: thrust levers, FUEL CONTROL, fire handles
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  v.set(V.fuelCtlL, b(powered));
  v.set(V.fuelCtlR, b(powered));
  v.set(V.fireHandleL, 0);
  v.set(V.fireHandleR, 0);
  v.set(V.fireDischL, 0);
  v.set(V.fireDischR, 0);
  // ---- flight controls
  const flapLever = s === 'takeoff' || s === 'ready_to_taxi' ? 2 : s === 'approach' ? 2 : 0; // flaps 20 takeoff (AIN); 20 on the approach state
  v.set(V.flapLever, flapLever);
  sys.flaps.setPosition([0, 10, 20, 39][flapLever]);
  v.set(V.speedbrake, 0);
  v.set(V.gndSpoiler, b(powered));
  v.set(V.flapOride, 0);
  v.set(V.fltCtrlReset, 0);
  v.set(V.backupPitch, 0);
  v.set(V.rollMotor, 1);
  v.set(V.autoCenter, 0);
  v.set(V.ailTrimSw, 0);
  v.set(V.rudTrimSw, 0);
  sys.ailTrim.setPosition(0);
  sys.rudTrim.setPosition(0);
  // ---- gear / brakes / steering / TAWS
  const gearDown = s !== 'cruise';
  v.set(V.gearHandle, b(gearDown));
  v.set(V.gearEmer, 0);
  v.set(V.gearLockRelease, 0);
  sys.gear.setDown(gearDown);
  // Snap the debounced squat state (and the A/T touchdown bookkeeping) to the placement: the squat debounce
  // otherwise starts from "air" for ~0.1 s after a ground placement, which the A/T took for a touchdown and then
  // auto-disengaged on every later ground engagement (found by tests/aircraft/g650/verify: A/T would not engage
  // for takeoff after a cold & dark start).
  const placedOnGround = !inAir;
  for (let i = 0; i < 3; i++) v.set(`gear.wow${i}`, placedOnGround ? 1 : 0);
  sys.gear.reset();
  v.set('gear.air_ground', placedOnGround ? 1 : 0);
  sys.at.reset();
  v.set(V.parkBrake, moving ? 0 : 1);
  v.set(V.autobrake, s === 'takeoff' ? -1 : s === 'approach' ? 1 : 0);
  v.set(V.nwsPower, b(powered));
  v.set(V.terrInhibit, 0);
  v.set(V.gpwsInhibit, 0);
  v.set(V.raasInhibit, 0);
  // IRS MODE SELECT: ON in every powered state (the IRUs align on power-up), OFF cold & dark (SmartCockpit G650
  // quiz: an IRU left ON after shutdown runs on the battery, amber ON BAT).
  for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), powered ? 2 : 0);
  for (const k of ['crew', 'reset', 'privacy', 'aft_privacy'] as const) v.set(V.cockpitCall(k), 0);
  // ---- yoke switches / tiller handle (3D cockpit, systems/cockpitInputs.ts)
  for (const k of [V.yokeTrimL, V.yokeTrimR, V.yokeDiscL, V.yokeDiscR, V.tiller3d]) v.set(k, 0);
  // ---- doors
  v.set(V.doorMain, s === 'cold_dark' ? 1 : 0);
  v.set(V.doorBaggage, 0);
  v.set(V.doorExtBaggage, 0);
}

/** `AircraftInstance.applyState` of the G650. */
export function applyG650State(ctx: SimContext, sys: G650Systems, s: InitialState): void {
  const v = ctx.vars;
  setG650Switches(ctx, sys, s);
  const coldDark = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];

  sys.fuel.snapValves();
  sys.lights.snap();

  if (coldDark) {
    for (const i of [1, 2]) {
      v.set(`fadec.eng${i}.fuel_cmd`, 0);
      v.set(ENG.fuelOn(i), 0);
    }
    ctx.fdm.setEnginesRunning?.(false);
    sys.apu.setRunning(false);
    sys.hyd.setPressure('left', 0);
    sys.hyd.setPressure('right', 0);
    for (const st of sys.starts) st.reset();
    for (const i of sys.irs) i.reset();
    v.set(SURF.pitchTrim, TAKEOFF_STAB);
    sys.fbw.reset();
    sys.elec.settle();
    sys.elec.reset();
    sys.logic.reset();
    sys.post.reset();
    sys.pneu.snap(v.get('fdm.sat_c', 15));
    sys.press.settle();
    sys.suite?.applyState(s);
    return;
  }

  // ---- engines running
  if (inAir) {
    // Re-place the aircraft so its trimmed attitude reflects the flap / gear configuration of the state.
    const ias = Math.max(140, v.get(FDM.ias));
    ctx.fdm.reposition({ lat: v.get(FDM.lat), lon: v.get(FDM.lon), altFtMsl: v.get(FDM.altMsl), headingTrue: v.get(FDM.headingTrue), iasKt: ias });
  }
  for (const i of [1, 2]) {
    v.set(`fadec.eng${i}.fuel_cmd`, 1);
    v.set(ENG.fuelOn(i), 1);
  }
  sys.logic.update(1 / 60);
  sys.ratings.update(1 / 60);
  sys.fadec.update(1 / 60);
  ctx.fdm.setEnginesRunning?.(true);
  let stab = TAKEOFF_STAB;
  if (inAir) {
    const trim = fm.computeTrim?.({ iasKt: Math.max(140, v.get(FDM.ias)) });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      stab = Math.max(-1, Math.min(1, trim.pitchTrim));
      const n1 = (fm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fm.engineEnv);
      const lever = leverForN1(sys, ctx, n1);
      v.set(V.tla(1), lever);
      v.set(V.tla(2), lever);
      sys.logic.update(1 / 60);
      sys.fadec.update(1 / 60);
      ctx.fdm.setEnginesRunning?.(true);
    }
  }
  sys.hyd.setPressure('left', 3000);
  sys.hyd.setPressure('right', 3000);
  sys.apu.setRunning(false);
  for (const st of sys.starts) st.reset();
  sys.elec.settle();
  sys.elec.reset();
  sys.logic.reset();
  sys.post.reset();
  for (const i of sys.irs) {
    i.forceAligned();
    i.update(1 / 60); // publish the aligned attitude before the AFCS set-up below
  }
  for (const a of sys.adc) {
    a.reset();
    // Run the power-up self test now so the air data (FBW, AFCS) are valid when the state starts.
    for (let k = 0; k < 200; k++) a.update(1 / 60);
  }
  for (const r of sys.ra) r.update(1 / 60);
  v.set(SURF.pitchTrim, stab);
  v.set(SURF.elevator, 0);
  sys.fbw.reset();
  sys.pneu.snap(22);
  sys.press.settle();
  sys.suite?.applyState(s);

  // ---- AFCS / autothrottle set-up (guidance panel selected values)
  const hdg = v.get(FDM.headingMag);
  v.set('ap.sel_hdg_deg', Math.round(hdg));
  v.set('ap.fd1_on', 1);
  v.set('ap.fd2_on', 1);
  if (s === 'cruise') {
    const alt = Math.round(v.get(FDM.altMsl) / 100) * 100;
    v.set('ap.sel_alt_ft', alt);
    sys.afcs.update(1 / 60); // read the sensors so ALT captures the present altitude
    v.set('ap.sel_mach', Math.round(v.get(FDM.mach) * 100) / 100);
    v.set('ap.spd_is_mach', v.get(FDM.pressAlt) > 30000 ? 1 : 0);
    v.set('ap.sel_spd_kt', Math.round(v.get(FDM.ias)));
    sys.afcs.engage();
    sys.afcs.press('HDG');
    sys.afcs.press('ALT');
    sys.at.pressEngage();
  } else if (s === 'approach') {
    v.set('ap.sel_alt_ft', Math.round((v.get(FDM.altMsl) - 1500) / 100) * 100);
    v.set('ap.sel_spd_kt', Math.round(v.get(FDM.ias)));
    v.set('ap.spd_is_mach', 0);
  } else {
    v.set('ap.sel_alt_ft', 10000);
    v.set('ap.sel_spd_kt', 200);
    v.set('ap.spd_is_mach', 0);
  }
}
