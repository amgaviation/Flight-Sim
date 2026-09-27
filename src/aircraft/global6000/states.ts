/**
 * Bombardier Global 6000 initial states (cold & dark, ready to taxi, takeoff,
 * cruise, approach). Every cockpit control of the inventory
 * (docs/aircraft/global6000.md section 12, vars.ts G6K_CONTROL_VARS) is set to
 * its normal position for the phase (checklists.ts flows); system internals
 * are then snapped so the indications match at once. Free of Three.js
 * (headless tests).
 *
 * Contract (docs/modules/app.md 2.4): the app has already called
 * `fdm.reposition(...)`. In-air states trim themselves: stabilizer from
 * `FlightModel.computeTrim`, thrust levers from the FADEC lever law by
 * bisection on the N1 that gives the trim thrust.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, SURF } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { FLAP_DETENTS, G6K_LIMITS } from './data';
import { G6K_VARS as V } from './vars';
import type { G6kSystems } from './createSystems';

/** Take-off stabilizer (units, EST mid-CG setting inside the 4.5-11 green band). */
export const TAKEOFF_STAB_UNITS = 7.5;
/** Normalized FDM pitch trim -> stabilizer units (TrimAxis range 0..14, neutral 7). */
export const unitsForTrim = (t: number): number => 7 + 7 * Math.max(-1, Math.min(1, t));

/** Thrust-lever position giving N1 `n1` in the current conditions (bisection on the FADEC lever law). */
export function leverForN1(sys: G6kSystems, ctx: SimContext, n1: number): number {
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
export function setG6kSwitches(ctx: Pick<SimContext, 'vars'>, sys: G6kSystems, s: InitialState): void {
  const v = ctx.vars;
  const powered = s !== 'cold_dark';
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = v.get('env.ambient_light', 1) < 0.5;
  const b = (x: boolean) => (x ? 1 : 0);

  // ---- ELECTRICAL (GEN / APU GEN / RAT GEN PBAs live in their normal state; BATT MASTER is the master switch)
  v.set(V.extAc, 0);
  for (const n of [1, 2, 3, 4] as const) {
    v.set(V.gen(n), 1);
    v.set(V.acBusIsol(n), 0);
  }
  v.set(V.extDc, 0);
  v.set(V.apuGen, 1);
  v.set(V.ratGen, 1);
  v.set(V.battMaster, b(powered));
  v.set(V.cabinPwr, b(powered));
  for (const bus of ['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus'] as const) v.set(V.dcBusIsol(bus), 0);
  v.set(V.extAcAvail, 0);
  v.set(V.extDcAvail, 0);
  // ---- WINDSHIELD HEAT / HYD SOV / HYD pumps (1B / 2B / 3B AUTO, 3A ON)
  v.set(V.wshldL, b(powered));
  v.set(V.wshldR, b(powered));
  v.set(V.hydSovL, 0);
  v.set(V.hydSovR, 0);
  v.set(V.hydPump('1b'), powered ? 1 : 0);
  v.set(V.hydPump('2b'), powered ? 1 : 0);
  v.set(V.hydPump('3b'), powered ? 1 : 0);
  v.set(V.hydPump('3a'), powered ? 2 : 0);
  // ---- AURAL / PASS SIGNS / EMER LIGHTS
  v.set(V.auralMute(1), 0);
  v.set(V.auralMute(2), 0);
  v.set(V.noSmoking, powered ? 1 : 0);
  v.set(V.seatBelts, powered ? 1 : 0);
  v.set(V.emerLights, powered ? 1 : 0);
  // ---- EXTERNAL LIGHTS
  const ldg = s === 'takeoff' || s === 'approach';
  v.set(V.ltLdgL, b(ldg));
  v.set(V.ltLdgR, b(ldg));
  v.set(V.ltLdgNose, b(ldg));
  v.set(V.ltTaxi, b(s === 'ready_to_taxi' || s === 'takeoff'));
  v.set(V.ltNav, b(powered));
  v.set(V.ltBeacon, b(powered));
  v.set(V.ltStrobe, b(moving));
  v.set(V.ltWing, 0);
  v.set(V.ltLogo, b(powered && night && !inAir));
  // ---- APU (off once the engines run); ENGINE panel
  v.set(V.apuSw, 0);
  v.set(V.engStart(1), 0);
  v.set(V.engStart(2), 0);
  v.set(V.engCrank(1), 0);
  v.set(V.engCrank(2), 0);
  v.set(V.ignition, 0);
  // ---- FUEL (all normal / AUTO, crossfeed closed)
  for (const x of ['l', 'r'] as const) {
    v.set(V.priPumps(x), 1);
    v.set(V.auxPump(x), 1);
    v.set(V.recirc(x), 1);
  }
  v.set(V.xfeed, 0);
  v.set(V.aftXfer, 1);
  v.set(V.wingXfer, 1);
  // ---- BLEED / AIR COND
  v.set(V.engBleed('l'), 1);
  v.set(V.engBleed('r'), 1);
  v.set(V.apuBleed, 1);
  v.set(V.xbleed, 1);
  v.set(V.pack('l'), 1);
  v.set(V.pack('r'), 1);
  v.set(V.trimAir, 1);
  v.set(V.recircFan, 1);
  v.set(V.ramAir, 0);
  v.set(V.packCtlMan, 0); // PACK CONTROL NORM
  v.set(V.packManTemp('l'), 0.5);
  v.set(V.packManTemp('r'), 0.5);
  v.set(V.zoneTemp(1), 21);
  v.set(V.zoneTemp(2), 22);
  v.set(V.zoneTemp(3), 22);
  // ---- ANTI-ICE (AUTO; conditions decide)
  v.set(V.wingAi, 1);
  v.set(V.cowlAi('l'), 1);
  v.set(V.cowlAi('r'), 1);
  v.set(V.wingXbleed, 0);
  // ---- FIRE
  for (const z of ['l', 'apu', 'r'] as const) {
    v.set(V.fireHandle(z), 0);
    v.set(V.fireDisch(z, 1), 0);
    v.set(V.fireDisch(z, 2), 0);
  }
  v.set(V.fireTest, 0);
  // ---- PRESSURIZATION / ELT
  v.set(V.pressAutoMan, 0);
  v.set(V.pressManAlt, 0);
  v.set(V.pressManRate, 0.5);
  v.set(V.ldgElevFms, 1);
  v.set(V.ldgElevSlew, 0);
  v.set(V.ldgElevFt, v.get('fdm.ground_elev_ft', 0));
  v.set(V.outflowClosed(1), 0);
  v.set(V.outflowClosed(2), 0);
  v.set(V.emerDepress, 0);
  v.set(V.emerDepressGuard, 0);
  v.set(V.ditching, 0);
  v.set(V.elt, 0);
  // ---- SIDE PANELS
  v.set(V.pusher(1), 1);
  v.set(V.pusher(2), 1);
  v.set(V.stallTest, 0);
  v.set(V.oxyMask(1), 0);
  v.set(V.oxyMask(2), 0);
  v.set(V.oxyMaskMode, 0);
  v.set(V.oxyMaskModeR, 0);
  v.set(V.oxyTest(1), 0);
  v.set(V.oxyTest(2), 0);
  v.set(V.crewOxy, b(powered));
  v.set(V.paxOxy, 1);
  v.set(V.hudPower, b(powered));
  // ---- PEDESTAL
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  v.set(V.revLever(1), 0);
  v.set(V.revLever(2), 0);
  v.set(V.engRun(1), b(powered));
  v.set(V.engRun(2), b(powered));
  v.set(V.engN1Mode(1), 0);
  v.set(V.engN1Mode(2), 0);
  // Slats / flaps: 6 for taxi / take-off (EST typical), 30 on the approach state (10 nm final), 0 IN in cruise / cold.
  const lever = s === 'ready_to_taxi' || s === 'takeoff' ? 2 : s === 'approach' ? 4 : 0;
  v.set(V.flapLever, lever);
  sys.flaps.setPosition(FLAP_DETENTS[lever].flapDeg);
  sys.flaps.slats = lever >= 1 ? 1 : 0;
  v.set(SURF.slats, sys.flaps.slats);
  v.set('slats.pos', sys.flaps.slats);
  v.set(V.flightSpoiler, 0);
  v.set(V.stabCh(1), 0);
  v.set(V.stabCh(2), 0);
  v.set(V.ailTrimSw, 0);
  v.set(V.rudTrimSw, 0);
  sys.ailTrim.setPosition(0);
  sys.rudTrim.setPosition(0);
  sys.stab.setPosition(TAKEOFF_STAB_UNITS);
  v.set(V.terrOff, 0);
  v.set(V.gsMute, 0);
  v.set(V.flapOvrd, 0);
  v.set(V.flapOvrdGuard, 0);
  v.set(V.gldManArm, 0);
  v.set(V.gldOff, 0);
  v.set(V.autobrake, s === 'approach' ? 2 : 0);
  const gearDown = s !== 'cruise';
  v.set(V.gearHandle, b(gearDown));
  sys.gear.setDown(gearDown);
  v.set(V.gearDnLckRel, 0);
  v.set(V.gearManRelease, 0);
  v.set(V.nwsArm, b(powered));
  v.set(V.hornMute, 0);
  v.set(V.btmsReset, 0);
  v.set(V.parkBrake, moving ? 0 : 1);
  v.set(V.dcEmerOvrd, 0);
  v.set(V.dcEmerOvrdGuard, 0);
  v.set(V.ratDeploy, 0);
  for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), powered ? 2 : 0);
  // ---- COCKPIT LIGHTS
  for (const z of ['l', 'c', 'r'] as const) {
    v.set(V.ltFlood(z), powered && night ? 0.3 : 0);
    v.set(V.ltDisplay(z), night ? 0.7 : 1);
  }
  for (const z of ['l', 'c', 'r', 'cb', 'ovhd'] as const) v.set(V.ltIntegral(z), powered ? (night ? 0.6 : 0.9) : 0);
  v.set(V.ltMaster, powered ? 2 : 0);
  v.set(V.ltDome, 0);
  v.set(V.ltMap(1), 0);
  v.set(V.ltMap(2), 0);
  v.set(V.annunTest, 0);
  // ---- doors
  v.set(V.door('pax'), s === 'cold_dark' ? 1 : 0);
  for (const d of ['emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small'] as const) v.set(V.door(d), 0);
}

/** `AircraftInstance.applyState` of the Global 6000. */
export function applyG6kState(ctx: SimContext, sys: G6kSystems, s: InitialState): void {
  const v = ctx.vars;
  setG6kSwitches(ctx, sys, s);
  const coldDark = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];
  // Snap the debounced squat state and the A/T touchdown bookkeeping to the placement. Without it the A/T saw the
  // ground placement as a touchdown and auto-disengaged ("after landing") every later ground engagement, so the FCP
  // A/T could not be engaged for take-off (found by tests/aircraft/global6000/verify/fullFlight.test.ts).
  for (let i = 0; i < 3; i++) v.set(`gear.wow${i}`, inAir ? 0 : 1);
  sys.gear.reset();
  v.set('gear.air_ground', inAir ? 0 : 1);
  sys.at.reset();

  sys.fuel.snapValves();
  sys.lights.snap();
  v.set(V.ratDeployed, 0);
  v.set('ap.yd_engaged', coldDark ? 0 : 1);

  if (coldDark) {
    for (const i of [1, 2]) {
      v.set(`fadec.eng${i}.fuel_cmd`, 0);
      v.set(ENG.fuelOn(i), 0);
    }
    ctx.fdm.setEnginesRunning?.(false);
    sys.apu.setRunning(false);
    for (const n of ['sys1', 'sys2', 'sys3']) sys.hyd.setPressure(n, 0);
    for (const st of sys.starts) st.reset();
    for (const i of sys.irs) i.reset();
    sys.logic.reset();
    sys.logic.update(1 / 60);
    sys.settleElec();
    sys.elec.reset();
    sys.post.reset();
    sys.pneu.snap(v.get('fdm.sat_c', 15));
    sys.press.settle();
    sys.suite?.applyState(s);
    return;
  }

  // ---- engines running
  if (inAir) {
    // Re-place the aircraft so its trimmed attitude reflects the slat / flap / gear configuration of the state.
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
  let units = TAKEOFF_STAB_UNITS;
  if (inAir) {
    const trim = fm.computeTrim?.({ iasKt: Math.max(130, v.get(FDM.ias)) });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      units = unitsForTrim(trim.pitchTrim);
      const n1 = (fm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fm.engineEnv);
      const lever = leverForN1(sys, ctx, n1);
      v.set(V.tla(1), lever);
      v.set(V.tla(2), lever);
      sys.logic.update(1 / 60);
      sys.fadec.update(1 / 60);
      ctx.fdm.setEnginesRunning?.(true);
    }
  }
  sys.stab.setPosition(units);
  for (const n of ['sys1', 'sys2', 'sys3']) sys.hyd.setPressure(n, G6K_LIMITS.hydPsi);
  sys.apu.setRunning(false);
  for (const st of sys.starts) st.reset();
  sys.logic.reset();
  for (let k = 0; k < 3; k++) sys.logic.update(1 / 60);
  sys.settleElec();
  sys.elec.reset();
  sys.post.reset();
  for (const i of sys.irs) {
    i.forceAligned();
    i.update(1 / 60); // publish the aligned attitude before the AFCS set-up below
  }
  sys.standbyAhrs.reset(true);
  for (const a of sys.adc) {
    a.reset();
    for (let k = 0; k < 200; k++) a.update(1 / 60); // self test done: air data valid when the state starts
  }
  for (const r of sys.ra) r.update(1 / 60);
  v.set(SURF.elevator, 0);
  sys.pneu.snap(22);
  sys.press.settle();
  sys.suite?.applyState(s);

  // ---- AFCS / autothrottle set-up (FCP selected values)
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
