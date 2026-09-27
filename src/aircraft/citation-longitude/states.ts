/**
 * Citation Longitude initial states (cold & dark, ready to taxi, takeoff,
 * cruise, approach). Every cockpit control of the inventory
 * (docs/aircraft/citation-longitude.md) is set to its normal position for the
 * phase, following the OG Section 17 normal procedures; system internals are
 * then snapped so the indications match at once. Free of Three.js (used by
 * the headless tests, docs/modules/qa.md §6).
 *
 * Contract (docs/modules/app.md §2.4): the app has already called
 * `fdm.reposition(...)`. In-air states are trimmed here (stabilizer from
 * `computeTrim`, thrust levers from the FADEC lever law by bisection).
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { LON_VARS as V } from './vars';
import { STAB_RANGE, type LongitudeSystems } from './createSystems';
import { TLA } from './systems/logic';

/** Stabilizer position (deg) giving the normalized pitch-trim command `n` (bisection on TrimAxis.normalize). */
export function stabUnitsFor(sys: LongitudeSystems, n: number): number {
  let lo = STAB_RANGE[0];
  let hi = STAB_RANGE[1];
  // normalize() decreases with units (nose up = more negative incidence).
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sys.stab.normalize(mid) > n) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Thrust-lever position giving N1 `n1` in the current conditions (bisection on the FADEC lever law). */
export function leverForN1(sys: LongitudeSystems, ctx: SimContext, n1: number): number {
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
export function setLongitudeSwitches(ctx: Pick<SimContext, 'vars'>, sys: LongitudeSystems, s: InitialState): void {
  const v = ctx.vars;
  const powered = s !== 'cold_dark';
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = v.get('env.ambient_light', 1) < 0.5;

  // ---- electrical (pilot lower sub-panel). GEN switches live at ON (OG 5-5: safe to leave ON).
  v.set(V.battL, powered ? 1 : 0);
  v.set(V.battR, powered ? 1 : 0);
  v.set(V.genL, 1);
  v.set(V.genR, 1);
  v.set(V.genApu, 1);
  v.set(V.busTieBtn, 0);
  v.set(V.mainL, 1);
  v.set(V.mainR, 1);
  v.set(V.elecL, 1);
  v.set(V.elecR, 1);
  v.set(V.interior, 1);
  v.set(V.stbyPwr, powered ? 1 : 0);
  v.set(V.extPwr, 0);
  v.set(V.extPwrAvail, 0);
  // ---- hydraulics / fuel
  v.set(V.hydPumpA, 0);
  v.set(V.hydPumpB, 0);
  v.set(V.ptcu, 2);
  v.set(V.rudderStby, 1);
  v.set(V.boostL, 0);
  v.set(V.boostR, 0);
  v.set(V.gravXflow, 0);
  v.set(V.fuelTransfer, 0);
  v.set(V.fuelRecirc, 1);
  // ---- engines
  v.set(V.runL, powered ? 1 : 0);
  v.set(V.runR, powered ? 1 : 0);
  v.set(V.runGuardL, 0);
  v.set(V.runGuardR, 0);
  v.set(V.startL, 0);
  v.set(V.startR, 0);
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  // ---- APU: off once the engines run (OG 17-6: OFF before FL350; quiet ramp EST)
  v.set(V.apuKnob, 0);
  // ---- bleed / ECS / pressurization
  v.set(V.bleedEngL, 1);
  v.set(V.bleedEngR, 1);
  v.set(V.bleedApu, 1);
  v.set(V.bleedIsolate, 0);
  v.set(V.pressSrcL, 1);
  v.set(V.pressSrcR, 1);
  v.set(V.flow, 0);
  v.set(V.cabinTempKnob, 0);
  v.set(V.ckptTempKnob, 0);
  v.set(V.ecsMode, 0);
  v.set(V.cabinSetC, 22);
  v.set(V.ckptSetC, 21);
  v.set(V.recircFan, 0);
  v.set(V.pressDump, 0);
  v.set(V.pressDumpGuard, 0);
  v.set(V.pressMode, 0);
  v.set(V.cabinAltSw, 0);
  v.set(V.pressSelMode, 0);
  v.set(V.pressLdgElevFt, -9999); // use the FMS destination
  v.set(V.pressSelCabinFt, 0);
  // ---- ice protection: OFF (conditions decide; OG 1-5), pitot/static NORM
  v.set(V.aiEngL, 0);
  v.set(V.aiEngR, 0);
  v.set(V.aiWing, 0);
  v.set(V.aiStab, 0);
  v.set(V.pitotStatic, 0);
  // ---- fire
  v.set(V.fireEngL, 0);
  v.set(V.fireEngR, 0);
  v.set(V.bottle1, 0);
  v.set(V.bottle2, 0);
  v.set(V.fireTest, 0);
  // ---- flight controls
  const flapLever = s === 'cold_dark' || s === 'cruise' ? 0 : 2; // flaps 2 for takeoff (FPG preferred) and the approach
  v.set(V.flapLever, flapLever);
  sys.flaps.setPosition([0, 7, 15, 35][flapLever]);
  v.set(V.speedbrake, 0);
  v.set(V.ailTrimSw, 0);
  v.set(V.rudTrimSw, 0);
  v.set(V.stabSecSw, 0);
  v.set(V.stabSecGuard, 0);
  v.set(V.pitchRollDisc, 0); // PITCH/ROLL DISCONNECT stowed (columns connected)
  sys.ailTrim.setPosition(0);
  sys.rudTrim.setPosition(0);
  // OG 17-3 chart: ~-4.5 deg for a mid CG (EST) -> inside the takeoff band.
  sys.stab.setPosition(-4.5);
  // ---- gear / brakes
  const gearDown = s !== 'cruise';
  v.set(V.gearHandle, gearDown ? 1 : 0);
  v.set(V.gearEmer, 0);
  sys.gear.setDown(gearDown);
  v.set(V.parkBrake, moving ? 0 : 1);
  // ---- lights (OG 16): nav auto-on with the G5000; beacon NORM; anti-coll for takeoff/flight; landing lights below FL180
  v.set(V.ltNav, powered ? 1 : 0);
  v.set(V.ltBeaconMode, 1);
  v.set(V.ltAutoPulse, 1);
  v.set(V.ltAntiColl, moving ? 1 : 0);
  const ldg = s === 'takeoff' || s === 'approach';
  v.set(V.ltLdgL, ldg ? 1 : 0);
  v.set(V.ltLdgR, ldg ? 1 : 0);
  v.set(V.ltRecog, 0);
  v.set(V.ltPulse, 0);
  v.set(V.ltTaxi, s === 'ready_to_taxi' || s === 'takeoff' ? 1 : 0);
  v.set(V.ltWingInsp, 0);
  v.set(V.ltTailFlood, powered && night && !inAir ? 1 : 0);
  v.set(V.ltPanel, powered ? (night ? 0.6 : 1) : 0);
  v.set(V.ltFlood, powered && night ? 0.25 : 0);
  v.set(V.ltAux, powered && night ? 0.3 : 0);
  v.set(V.ltEmer, powered ? 1 : 0);
  v.set(V.ltSeatBelt, moving ? 1 : 0);
  for (const k of [V.ltPfdL, V.ltGtcL, V.ltMfd, V.ltGtcC, V.ltPfdR, V.ltGtcR]) v.set(k, night ? 0.7 : 1);
  v.set(V.ltMapL, 0);
  v.set(V.ltMapR, 0);
  // ---- oxygen
  v.set(V.oxyPax, 0);
  v.set(V.oxyMaskL, 0);
  v.set(V.oxyMaskR, 0);
  v.set(V.oxyMode, 0);
  v.set(V.oxyModeR, 0);
  v.set(V.oxyTestL, 0);
  v.set(V.oxyTestR, 0);
  v.set(V.ltDome, 0);
  v.set(V.lampTest, 0);
  // ---- fix round 1 controls (glareshield lower tier, pedestal, overhead, wheels)
  v.set(V.fireApu, 0);
  v.set(V.aprAuto, 1); // POWER RESERVE AUTO armed for every takeoff (EST normal position)
  v.set(V.aprManual, 0);
  v.set(V.stabChan, 1);
  v.set(V.stabSecArm, 0);
  v.set(V.autoGndSplr, 1);
  v.set(V.stbyYd, 0);
  v.set(V.flapReset, 0);
  // CONTROL LOCK: engaged while parked cold & dark, released in the preflight (checklists.ts).
  v.set(V.controlLock, s === 'cold_dark' ? 1 : 0);
  for (const k of [V.cvrTest, V.cvrErase, V.eventMarker, V.pttL, V.pttR, V.yokeIcsL, V.yokeIcsR, V.visorL, V.visorR]) v.set(k, 0);
  v.set(V.gasperL, 0.5);
  v.set(V.gasperR, 0.5);
  v.set(V.ltStby, night ? 0.7 : 1);
  v.set(V.altFine, 0);
  v.set(V.ltSeatBelts, moving ? 1 : 0);
  v.set(V.ltPaxSafety, moving ? 1 : 0);
}

/**
 * Re-reads the squat switches after the reposition (the systems were built before the FDM published
 * weight-on-wheels) and re-arms the A/T touchdown logic from that air/ground state. Without it the first
 * frames saw AIR, the A/T latched a "touchdown" and auto-disengaged 2 s later on every ground engagement,
 * so A/T + TO/GA takeoffs were impossible (found by verify/fullFlight.test.ts).
 */
function resetAirGround(ctx: SimContext, sys: LongitudeSystems, onGround: boolean): void {
  // The FDM writes gear.wow* only when it steps; seed them with the placement the app just made.
  for (const i of [0, 1, 2]) ctx.vars.set(`gear.wow${i}`, onGround ? 1 : 0);
  sys.gear.reset();
  sys.gear.update(0);
  sys.at.reset();
}

/** `AircraftInstance.applyState` of the Longitude. */
export function applyLongitudeState(ctx: SimContext, sys: LongitudeSystems, s: InitialState): void {
  const v = ctx.vars;
  setLongitudeSwitches(ctx, sys, s);
  const coldDark = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  // Before anything reads gear.air_ground (pressurization settle, A/T, CAS inhibits).
  resetAirGround(ctx, sys, !inAir);
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
    sys.hyd.setPressure('a', 0);
    sys.hyd.setPressure('b', 0);
    for (const st of sys.starts) st.reset();
    for (const a of sys.ahrs) a.reset(false);
    sys.elec.settle();
    sys.elec.reset();
    sys.logic.reset();
    sys.post.reset();
    sys.pneu.snap(v.get('fdm.sat_c', 15));
    // The pressurization mass balance uses the published cabin temperature: publish the snapped zone
    // temperature first (it was still 0 degC here, so the cabin started ~1.1 psid above ambient on the ramp).
    v.set('pneu.cabin_temp_c', v.get('fdm.sat_c', 15));
    sys.press.settle();
    sys.suite?.applyState(s);
    return;
  }

  // ---- engines running
  if (inAir) {
    // Re-place the aircraft so its trimmed attitude reflects the flap/gear configuration of the state.
    const ias = Math.max(120, v.get(FDM.ias));
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
  if (inAir) {
    const trim = fm.computeTrim?.({ iasKt: Math.max(120, v.get(FDM.ias)) });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      sys.stab.setPosition(stabUnitsFor(sys, Math.max(-1, Math.min(1, trim.pitchTrim))));
      const n1 = (fm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fm.engineEnv);
      const lever = leverForN1(sys, ctx, n1);
      v.set(V.tla(1), lever);
      v.set(V.tla(2), lever);
      sys.logic.update(1 / 60);
      sys.fadec.update(1 / 60);
      ctx.fdm.setEnginesRunning?.(true);
    }
  }
  sys.hyd.setPressure('a', 3000);
  sys.hyd.setPressure('b', 3000);
  sys.apu.setRunning(false);
  for (const st of sys.starts) st.reset();
  sys.elec.settle();
  sys.elec.reset();
  sys.logic.reset();
  sys.post.reset();
  for (const a of sys.ahrs) {
    a.reset(true);
    a.update(1 / 60); // publish the aligned attitude (valid) before the AFCS set-up below
  }
  for (const a of sys.adc) {
    a.reset();
    // Run the 3 s power-up self test now so the air data (and the AFCS) are valid when the state starts.
    for (let i = 0; i < 200; i++) a.update(1 / 60);
  }
  sys.pneu.snap(22);
  v.set('pneu.cabin_temp_c', 22); // see the cold & dark branch
  sys.press.settle();
  sys.suite?.applyState(s);

  // ---- AFCS / autothrottle set-up (G5000 GMC 710: selected values; OG 17: SPD knob FMS)
  const hdg = v.get(FDM.headingMag);
  v.set('ap.sel_hdg_deg', Math.round(hdg));
  v.set('ap.fd1_on', 1);
  v.set('ap.fd2_on', 1);
  if (s === 'cruise') {
    const alt = Math.round(v.get(FDM.altMsl) / 100) * 100;
    v.set('ap.sel_alt_ft', alt);
    sys.afcs.update(1 / 60); // read the sensors so ALT captures the present altitude
    v.set('ap.sel_mach', Math.round(v.get(FDM.mach) * 100) / 100);
    v.set('ap.spd_is_mach', v.get(FDM.pressAlt) > 29000 ? 1 : 0);
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

export { TLA };
