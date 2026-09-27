/**
 * Citation M2 initial-state presets (docs/modules/app.md §2.4). The app has
 * already repositioned the FDM; this writes every cockpit control var of the
 * inventory for the phase, snaps the system internals, starts or stops the
 * engines and trims the in-air states. Free of Three.js so the headless tests
 * run the exact code the app runs.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, AP, ADC } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import type { M2Systems } from './createSystems';
import { FLAP_DETENTS } from './data';
import { CITATION_M2_FDM } from './fdm';
import { M2, PRESS_SRC, TLA } from './vars';
import { julianDayFromDayOfYear, sunPosition } from '../../world/sky/solar';

/**
 * Night for the lighting presets. The app sets the clock (env.time_utc_h / env.day_of_year) before
 * applyState but the world only computes env.ambient_light on its first frame, so the sun elevation is
 * computed here (NOAA algorithm, world/sky/solar.ts). EST: the crew turns the panel / logo lights on
 * once the sun is below +2 deg (dusk). Without a clock (headless tests) the ambient-light var decides.
 */
export function isNightForPreset(v: Pick<SimContext, 'vars'>['vars']): boolean {
  if (v.has('env.time_utc_h') && v.has(FDM.lat)) {
    const jd = julianDayFromDayOfYear(2026, Math.max(1, v.get('env.day_of_year', 172)), v.get('env.time_utc_h'));
    return sunPosition(jd, v.get(FDM.lat), v.get(FDM.lon)).elevationDeg < 2;
  }
  return v.get('env.ambient_light', 1) < 0.5;
}

/** Normal takeoff pitch-trim setting (units): EST mid takeoff band, from computeTrim at 115 KIAS flaps 15 (tests). */
export const TAKEOFF_TRIM = 0.3;

/** Field elevation (ft) for an in-air preset: nearest airport within 30 nm, else the terrain under the aircraft. */
export function presetFieldElevationFt(ctx: Pick<SimContext, 'vars' | 'nav' | 'world'>): number {
  const v = ctx.vars;
  const lat = v.get(FDM.lat);
  const lon = v.get(FDM.lon);
  const near = typeof ctx.nav?.airportsNear === 'function' ? ctx.nav.airportsNear(lat, lon, 30, 1) : [];
  if (near.length > 0 && Number.isFinite(near[0].elevationFt)) return near[0].elevationFt;
  const m = typeof ctx.world?.elevationAt === 'function' ? ctx.world.elevationAt(lat, lon) : 0;
  return Number.isFinite(m) ? Math.max(0, m / 0.3048) : 0;
}

/** Writes the cockpit switch / lever vars for `s` (no system snapping). */
export function setM2Switches(ctx: Pick<SimContext, 'vars'>, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const powered = !cold;
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = isNightForPreset(v);

  // Electrical power panel
  v.set(M2.battSw, powered ? 1 : 0);
  for (const i of [1, 2]) v.set(M2.genSw(i), powered ? 1 : 0);
  v.set(M2.dispatchSw, 0); // no avionics master: the BATTERY switch powers the avionics (AOPA Mar 2014)
  v.set(M2.stbyDispSw, powered ? 1 : 0); // STBY FLT DISPLAY ON (prep TEST / ON; shutdown OFF)
  v.set(M2.battDisc, 0); // NORMAL
  // Engine start / throttles
  for (const i of [1, 2]) {
    v.set(M2.startBtn(i), 0);
    v.set(M2.ignSw(i), 0);
    v.set(M2.tla(i), cold ? TLA.cutoff : TLA.idle);
    v.set(M2.boostSw(i), 0);
    v.set(M2.engFireBtn(i), 0);
    v.set(M2.bottleBtn(i), 0);
    v.set(M2.engAiSw(i), 0);
    v.set(M2.wsBleedSw(i), 0);
    v.set(M2.maskOn(i), 0);
    v.set(M2.maskMode(i), 0);
    v.set(M2.yokeTrim(i), 0);
    v.set(M2.yokeTrimArm(i), 0);
    v.set(M2.apTrimDisc(i), 0);
    v.set(M2.rainDoor(i), 0);
    v.set(M2.mapLt(i), 0);
  }
  v.set(M2.startDiseng, 0);
  v.set(M2.fuelXfer, 0);
  // Ice protection: P/S heat on for takeoff and in flight (before-takeoff flow).
  v.set(M2.pitotStaticSw, moving ? 1 : 0);
  v.set(M2.tailDeiceSw, 0);
  v.set(M2.wsAlcoholSw, 0);
  // Pressurization / ECS
  v.set(M2.pressSource, PRESS_SRC.both);
  v.set(M2.cabinDump, 0);
  v.set(M2.pressMode, 0);
  v.set(M2.pressManual, 0);
  v.set(M2.landingElevFt, -9999); // not entered: FMS destination elevation (auto)
  v.set(M2.airCondSw, powered ? 1 : 0);
  v.set(M2.cabinFan, powered ? 1 : 0);
  v.set(M2.tempMode, 0);
  v.set(M2.tempSel, 0.5);
  v.set(M2.tempManual, 0);
  v.set(M2.airDistrib, 0.3);
  // Oxygen
  v.set(M2.paxOxy, 1);
  // Gear / brakes / lock
  v.set(M2.gearHandle, s === 'cruise' ? 0 : 1);
  v.set(M2.gearHornSilence, 0);
  v.set(M2.gearEmerRelease, 0);
  v.set(M2.gearBlowdown, 0);
  v.set(M2.antiskidSw, 1);
  v.set(M2.parkBrake, moving ? 0 : 1);
  v.set(M2.emerBrake, 0);
  v.set(M2.controlLock, cold ? 1 : 0);
  // Flaps / speed brake / trims
  const flapLever = s === 'cold_dark' || s === 'cruise' ? 0 : 1; // 15 deg for taxi/takeoff and the 10 nm approach start
  v.set(M2.flapHandle, flapLever);
  v.set(M2.speedbrake, 0);
  v.set(M2.aileronTrim, 0);
  v.set(M2.rudderTrim, 0);
  // Exterior lights
  v.set(M2.navLt, powered ? 1 : 0);
  v.set(M2.antiColl, !powered ? 0 : moving ? 2 : 1);
  v.set(M2.landingLt, s === 'takeoff' || s === 'approach' ? 2 : 0);
  v.set(M2.taxiLt, s === 'ready_to_taxi' || s === 'takeoff' ? 1 : 0);
  v.set(M2.logoLt, powered && night ? 1 : 0);
  v.set(M2.wingInspLt, 0);
  // Cockpit / cabin lights
  v.set(M2.panelLt, powered && night ? 0.6 : 0);
  v.set(M2.pedestalLt, powered && night ? 0.5 : 0);
  v.set(M2.floodLt, powered && night ? 0.2 : 0);
  v.set(M2.displayDim, 0);
  v.set(M2.gtcDim, 0);
  v.set(M2.paxSafety, !powered ? 0 : s === 'cruise' ? 1 : 2);
  v.set(M2.cabinLt, powered ? 1 : 0);
  // Misc
  v.set(M2.emerComm, 0);
  v.set(M2.eventMarker, 0);
  v.set(M2.cvrTest, 0);
  v.set(M2.eltSw, 0);
  v.set(M2.testSel, 0);
  v.set(M2.emerLtsSw, powered ? 1 : 0); // ARMED (prep), OFF at shutdown
  for (const i of [1, 2]) v.set(M2.ptt(i), 0);
  for (const d of ['cabin', 'emer_exit', 'nose_bag_l', 'nose_bag_r', 'tail_bag'] as const) v.set(M2.doorOpen(d), 0);
  // AFCS references (FD on with power; AP off; YD off on the ground).
  v.set(AP.fdOn(1), powered ? 1 : 0);
  v.set(AP.fdOn(2), powered ? 1 : 0);
  v.set(AP.yd, inAir ? 1 : 0);
}

/** `AircraftInstance.applyState` of the Citation M2. */
export function applyM2State(ctx: SimContext, sys: M2Systems, s: InitialState): void {
  const v = ctx.vars;
  setM2Switches(ctx, s);
  const cold = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';

  // Surfaces and gear to their commanded positions.
  const flapDeg = FLAP_DETENTS[Math.round(v.get(M2.flapHandle))].flapDeg;
  sys.flaps.setPosition(flapDeg);
  sys.gear.setDown(s !== 'cruise');
  sys.pitchTrim.setPosition(s === 'cold_dark' || s === 'ready_to_taxi' || s === 'takeoff' ? TAKEOFF_TRIM : 0);
  sys.aileronTrim.setPosition(0);
  sys.rudderTrim.setPosition(0);

  sys.logic.reset();
  // Departure / landing field elevations for the pressurization controller. In the air there is no ground latch:
  // take the nearest airport (the approach preset's destination), else the terrain under the start point.
  if (inAir) {
    const f = presetFieldElevationFt(ctx);
    v.set(M2.takeoffFieldElevFt, f);
    v.set(M2.landingElevFt, s === 'approach' ? f : -9999);
  }
  sys.logic.update(1 / 60);
  sys.logic.snapState(inAir);
  sys.fuel.snapValves();
  sys.lights.snap();
  sys.elec.settle();
  sys.hyd.setPressure('main', 0);
  sys.hyd.setPressure('brk', cold ? 0 : 1500);
  sys.oxy.reset();
  sys.fire.reset();

  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];
  if (cold) {
    ctx.fdm.setEnginesRunning?.(false);
    for (const st of sys.starts) st.reset();
    for (const a of sys.ahrs) a.reset(false);
    for (const a of sys.adc) a.reset();
    sys.suite.applyState(s);
    // Cabin temperature first (snap() publishes it on the next update): settle() computes the cabin air mass
    // at 'pneu.cabin_temp_c', and a stale 0 degC gave a cabin 1.2 psi above ambient on the ramp.
    sys.pneu.snap(15);
    v.set('pneu.cabin_temp_c', 15);
    v.set('gear.air_ground', 1); // squat switch (the gear system republishes it next frame): ground-mode settle, outflow valve open
    sys.press.settle();
    sys.afcs.reset();
    sys.cas.reset();
    return;
  }

  if (inAir) {
    // Re-place so the trimmed attitude reflects the configuration, then trim pitch and thrust.
    const ias = Math.max(110, v.get(FDM.ias));
    ctx.fdm.reposition({ lat: v.get(FDM.lat), lon: v.get(FDM.lon), altFtMsl: v.get(FDM.altMsl), headingTrue: v.get(FDM.headingTrue), iasKt: ias });
    const trim = fm.computeTrim?.({ iasKt: ias });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      sys.pitchTrim.setPosition(Math.max(-1, Math.min(1, trim.pitchTrim)));
      // Aileron trim for the lateral CG offset (single pilot in the left seat): lift acts on the
      // centre line, the CG sits slightly left, so the pilot trims right-wing-down.
      if (fm.cg && fm.mass && fm.qbar) {
        const a = CITATION_M2_FDM.aero;
        const need = (fm.mass * 9.80665 * -fm.cg.y) / (fm.qbar * a.wingArea_m2 * a.span_m * (a.Cl_trim ?? 0.004));
        sys.aileronTrim.setPosition(Math.max(-1, Math.min(1, need)));
      }
      const n1 = (fm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fm.engineEnv);
      sys.ratings.update(1 / 60);
      const idle = sys.fadec.idleN1(v.get(FDM.pressAlt), false);
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (sys.fadec.forwardN1(mid, idle) < n1) lo = mid;
        else hi = mid;
      }
      v.set(M2.tla(1), lo);
      v.set(M2.tla(2), lo);
    }
    // AFCS references: hold the current heading and altitude.
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    v.set(AP.selAltitude, Math.round(v.get(FDM.altMsl) / 100) * 100);
  } else {
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    v.set(AP.selAltitude, Math.round((v.get(FDM.altMsl) + 5000) / 1000) * 1000);
  }
  // Baro set to the local QNH.
  for (const i of [1, 2, 3]) v.set(ADC.baroSetting(i), v.get('env.qnh_inhg', 29.92));

  sys.logic.update(1 / 60);
  sys.ratings.update(1 / 60);
  sys.fadec.update(1 / 60);
  for (const i of [1, 2]) {
    v.set(`fadec.eng${i}.fuel_cmd`, 1);
    v.set(ENG.fuelOn(i), 1);
  }
  ctx.fdm.setEnginesRunning?.(true);
  for (const st of sys.starts) st.reset();
  sys.elec.settle();
  sys.fuel.update(1 / 60);
  for (const a of sys.ahrs) a.reset(true);
  for (const a of sys.adc) a.reset({ powered: true }); // air data running all along: no power-up self test
  sys.suite.applyState(s);
  sys.pneu.snap(22); // cabin temperature first (see the cold branch)
  v.set('pneu.cabin_temp_c', 22);
  if (!inAir) v.set('gear.air_ground', 1); // squat switch, as in the cold branch
  sys.press.settle();
  sys.afcs.reset();
  sys.yd.reset?.();
  sys.cas.reset();
}
