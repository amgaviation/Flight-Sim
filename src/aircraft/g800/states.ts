/**
 * G800 initial states (cold & dark, ready to taxi, takeoff, cruise, approach).
 * Every control of the inventory (docs/aircraft/g800.md §9) is set to its
 * normal position for the phase (checklists.ts / dossier §8 normal
 * procedures), then the system internals are snapped so indications match at
 * once. Free of Three.js (headless tests, docs/modules/qa.md §6).
 *
 * Contract (docs/modules/app.md §2.4): the app has already called
 * `fdm.reposition(...)`. In-air states are trimmed here: the FBW stabilizer
 * from `computeTrim`, the power levers from the FADEC lever law by bisection.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, SURF } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { FLAP_DETENTS } from './data';
import { G800_VARS as V, AUTOBRAKE } from './vars';
import type { G800Systems } from './createSystems';

/** Power-lever position giving N1 `n1` in the current conditions (bisection on the FADEC lever law). */
export function leverForN1(sys: G800Systems, ctx: SimContext, n1: number): number {
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

/** Writes every cockpit switch/lever var for the state (no system snapping). */
export function setG800Switches(ctx: Pick<SimContext, 'vars'>, sys: G800Systems, s: InitialState): void {
  const v = ctx.vars;
  const powered = s !== 'cold_dark';
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = v.get('env.ambient_light', 1) < 0.5;
  const b = (x: boolean) => (x ? 1 : 0);

  // ---- overhead: electrical (Before Starting Engines: ELECTRIC POWER CONTROL SET, EMER PWR ARM)
  v.set(V.battL, b(powered));
  v.set(V.battR, b(powered));
  v.set(V.genL, 1);
  v.set(V.genR, 1);
  v.set(V.apuGen, 1);
  v.set(V.gpu, 0);
  v.set(V.gpuAvail, 0);
  v.set(V.busTie, 1);
  v.set(V.lMainTru, 1);
  v.set(V.rMainTru, 1);
  v.set(V.emerPwr, b(powered));
  v.set(V.ratDeploy, 0);
  v.set(V.cabinMaster, b(powered));
  v.set(V.galleyMaster, b(powered));
  v.set(V.apuMaster, 0);
  v.set(V.apuStart, 0);
  // ---- fuel (GVI: all operable boost pumps ON)
  v.set(V.boostL, 1);
  v.set(V.boostR, 1);
  v.set(V.altPumpL, b(powered));
  v.set(V.altPumpR, b(powered));
  v.set(V.xflow, 0);
  v.set(V.hfr, 1);
  // ---- hydraulics
  v.set(V.auxPump, 1);
  v.set(V.ptu, 1);
  // ---- bleed / ECS / pressurization
  v.set(V.bleedL, b(powered));
  v.set(V.bleedR, b(powered));
  v.set(V.bleedApu, 0);
  v.set(V.isoValve, 1);
  v.set(V.packL, b(powered));
  v.set(V.packR, b(powered));
  v.set(V.ramAir, 0);
  v.set(V.zoneTemp(1), 21);
  for (const z of [2, 3, 4] as const) v.set(V.zoneTemp(z), 22);
  v.set(V.pressMode, 0);
  v.set(V.pressLdgElev, Math.round(v.get(FDM.groundElevFt) / 100) * 100);
  v.set(V.pressManual, 0);
  v.set(V.pressDump, 0);
  // ---- ice (AUTO; heat switches ON once powered)
  v.set(V.waiL, 1);
  v.set(V.waiR, 1);
  v.set(V.caiL, 1);
  v.set(V.caiR, 1);
  v.set(V.probeHeat, 1);
  v.set(V.wshldL, b(powered));
  v.set(V.wshldR, b(powered));
  v.set(V.cabinWdoHeat, b(powered));
  v.set(V.evsWdoHeat, b(powered));
  // ---- lights
  v.set(V.ltNav, b(powered));
  v.set(V.ltBeacon, b(powered));
  v.set(V.ltStrobe, b(moving));
  const ldg = s === 'takeoff' || s === 'approach';
  v.set(V.ltLandingL, b(ldg));
  v.set(V.ltLandingR, b(ldg));
  v.set(V.ltTaxi, b(s === 'ready_to_taxi' || s === 'takeoff'));
  v.set(V.ltRecog, b(moving));
  v.set(V.ltLogo, b(powered && night && !inAir));
  v.set(V.ltWing, 0);
  v.set(V.ltEmer, b(powered));
  v.set(V.ltSeatbelt, b(moving || s === 'ready_to_taxi'));
  v.set(V.ltNoSmoke, b(powered));
  v.set(V.ltDome, 0);
  v.set(V.stormLt, 0);
  v.set(V.ltPanel, powered ? (night ? 0.6 : 0.3) : 0);
  v.set(V.ltFlood, powered && night ? 0.25 : 0);
  // ---- engine start / oxygen
  v.set(V.startMaster, 0);
  v.set(V.crankMaster, 0);
  v.set(V.startL, 0);
  v.set(V.startR, 0);
  v.set(V.contIgn, 0);
  v.set(V.oxyCrew, b(powered));
  v.set(V.oxyPax, 1);
  v.set(V.fireTest, 0);
  // ---- fire handles
  for (const k of [V.fireHandleL, V.fireHandleR, V.fireHandleApu, V.fireRotL, V.fireRotR, V.fireRotApu]) v.set(k, 0);
  // ---- center panel: gear
  const gearDown = s !== 'cruise';
  v.set(V.gearHandle, b(gearDown));
  v.set(V.gearLockRel, 0);
  v.set(V.gearAlt, 0);
  sys.gear.setDown(gearDown);
  // ---- pedestal
  for (const i of [1, 2]) {
    v.set(V.tla(i), 0);
    v.set(V.rev(i), 0);
  }
  const flapLever = s === 'cruise' || s === 'cold_dark' ? 0 : 2; // flaps 20 for takeoff and the intermediate approach
  v.set(V.flapLever, flapLever);
  sys.flaps.setPosition(FLAP_DETENTS[flapLever].flapDeg);
  v.set(V.speedbrake, 0);
  v.set(V.gndSplrArm, b(s === 'ready_to_taxi' || s === 'takeoff' || s === 'approach'));
  v.set(V.parkBrake, b(!moving));
  v.set(V.autobrake, s === 'takeoff' ? AUTOBRAKE.RTO : s === 'approach' ? AUTOBRAKE.MED : AUTOBRAKE.OFF);
  v.set(V.runL, b(powered));
  v.set(V.runR, b(powered));
  v.set(V.rollTrimSw, 0);
  v.set(V.yawTrimSw, 0);
  v.set(V.yawTrimCenter, 0);
  v.set(V.fltCtrlReset, 0);
  v.set(V.nwsSw, 1);
  sys.rollTrim.setPosition(0);
  sys.yawTrim.setPosition(0);
  // ---- sidesticks / side consoles
  for (const side of [1, 2] as const) {
    v.set(V.ssTrim(side), 0);
    v.set(V.ssDisc(side), 0);
    v.set(V.hudRocker(side), 0);
    v.set(V.ptt(side), 0);
    v.set(V.oxyMask(side), 0);
    v.set(V.oxyMode(side), 0);
  }
  v.set(V.tiller, 0);
  // ---- doors (ramp service state)
  v.set('ac.door.main', b(s === 'cold_dark'));
  v.set(V.doorOpenCmd, b(s === 'cold_dark'));
  v.set(V.doorSafety, 0);
  // ---- fix-round-1 hardware (forward overhead strip, ELECTRICAL POWER CONTROL, ENGINE CONTROL, glareshield, pedestal, HUD)
  v.set(V.fcsBattEbha, b(powered));
  v.set(V.fcsBattUps, b(powered));
  v.set(V.engStartBtn, 0);
  v.set(V.fireApuDisch, 0);
  v.set(V.ratGen, 1);
  v.set(V.elecReset, 0);
  v.set(V.busTieL, 1);
  v.set(V.busTieR, 1);
  v.set(V.engAlt(1), 0);
  v.set(V.engAlt(2), 0);
  v.set(V.warnInhibit, b(s === 'takeoff'));
  v.set(V.altTrimA, 0);
  v.set(V.altTrimB, 0);
  v.set(V.pedalSteer, 1);
  v.set(V.hudStow, b(powered));
  v.set(V.hudAuto, 1);
  v.set(V.hudBrt, 0.8);
  v.set(V.hudContr, 0.7);
  v.set(V.hudVideoBrt, 0.5);
  for (const side of [1, 2] as const) {
    v.set(V.visor(side), 0);
    v.set(V.table(side), 0);
    v.set(V.armTilt(side), 0.5);
    v.set(V.pedalAdj(side), 0.5);
  }
  v.set(V.obsMask, 0);
  v.set(V.obsMaskMode, 0);
  v.set('ac.door.baggage', 0);
}

/** `AircraftInstance.applyState` of the G800. */
export function applyG800State(ctx: SimContext, sys: G800Systems, s: InitialState): void {
  const v = ctx.vars;
  setG800Switches(ctx, sys, s);
  const coldDark = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];

  sys.fuel.snapValves();
  sys.lights.snap();
  v.set('gear.air_ground', inAir ? 0 : 1);
  // The FDM publishes the squat switches on its next step; seed them so the air/ground logic starts consistent.
  for (const i of [0, 1, 2]) v.set(`gear.wow${i}`, inAir ? 0 : 1);
  sys.gear.reset();
  sys.brakes.reset(); // re-reads air/ground (no spurious touchdown after the reposition)

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
    sys.elec.settle();
    sys.elec.reset();
    sys.logic.reset();
    for (const u of sys.irs) u.reset();
    sys.pneu.snap(v.get('fdm.sat_c', 15));
    sys.press.settle();
    v.set(SURF.pitchTrim, 0.1);
    sys.fbw.reset();
    sys.suite?.applyState(s);
    return;
  }

  // ---- engines running
  if (inAir) {
    // Re-place the aircraft so its trimmed attitude reflects the flap/gear configuration of the state.
    const ias = Math.max(130, v.get(FDM.ias));
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
  // Stabilizer: takeoff setting EST +0.1 (inside the -0.2..0.35 green band, mid CG); in the air from the trim solution.
  v.set(SURF.pitchTrim, 0.1);
  v.set(SURF.elevator, 0);
  if (inAir) {
    const trim = fm.computeTrim?.({ iasKt: Math.max(130, v.get(FDM.ias)) });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      v.set(SURF.pitchTrim, Math.max(-1, Math.min(1, trim.pitchTrim)));
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
  for (const u of sys.irs) {
    u.forceAligned();
    u.update(1 / 60);
  }
  for (const a of sys.adc) {
    a.reset();
    for (let i = 0; i < 200; i++) a.update(1 / 60); // run the power-up self test so air data are valid at once
  }
  for (const r of sys.ra) r.update(1 / 60);
  sys.fbw.reset();
  sys.pneu.snap(22);
  sys.press.settle();
  sys.suite?.applyState(s);
  sys.radios?.gps?.forceAcquired();

  // ---- AFCS / autothrottle set-up (GP-700 selected values)
  const hdg = v.get(FDM.headingMag);
  v.set('ap.sel_hdg_deg', Math.round(hdg));
  v.set('ap.fd1_on', 1);
  v.set('ap.fd2_on', 1);
  if (s === 'cruise') {
    v.set('ap.sel_alt_ft', Math.round(v.get(FDM.altMsl) / 100) * 100);
    sys.afcs.update(1 / 60);
    v.set('ap.sel_mach', Math.round(v.get(FDM.mach) * 100) / 100);
    v.set('ap.spd_is_mach', v.get(FDM.pressAlt) > 31000 ? 1 : 0);
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
