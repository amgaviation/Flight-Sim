/**
 * Boeing 737-800 initial-state presets (docs/modules/app.md §2.4). The app
 * has already repositioned the FDM; this writes every cockpit control var of
 * the inventory (docs/aircraft/b737-800.md §10) for the phase, following the
 * FCOM normal procedures (NP.21: preflight, before start, before taxi,
 * before take-off, climb/cruise, descent/approach), snaps the system
 * internals, starts or stops the engines and trims the in-air states.
 * Free of Three.js so the headless tests run the exact code the app runs.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, AP, ADC, ENV } from '../../core/vars';
import { julianDayFromDayOfYear, sunPosition } from '../../world/sky/solar';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import type { B738Systems } from './createSystems';
import { B738_FLAP_DETENTS, FLAP_LEVER, STAB } from './data';
import { B738, APU_SW, ENG_START, GEAR_LEVER, SPEEDBRAKE, XPDR_SEL, FUEL_PUMPS, HYD_PUMP_SWITCHES, WINDOW_HEATS, DOORS, ACP_RECEIVERS } from './vars';

/** Normal take-off stabilizer setting (units): EST mid green band for a mid CG (perf.ts takeoffTrimUnits ~5 at 22 % MAC). */
export const TAKEOFF_TRIM_UNITS = 5.0;
/** Take-off flaps used by the presets (FCOM: 5 is the most common setting). */
export const TAKEOFF_FLAP_LEVER = FLAP_LEVER.f5;

/**
 * Night for the presets (panel / flood / exterior lights). The app sets the UTC time and day of year before
 * applyState but the world computes env.ambient_light only on its first frame afterwards, so ambient light
 * alone read day at a night launch. The sun elevation at the aircraft is computed here from the time vars;
 * night = sun below -3 deg (EST: between sunset and the end of civil twilight, -6 deg, cockpit panel lighting
 * is needed; crews switch it on around sunset). Falls back to ambient light when no time is set.
 */
export function presetIsNight(v: SimContext['vars']): boolean {
  if (v.has(ENV.timeUtcHours) && v.has(FDM.lat)) {
    const year = new Date().getUTCFullYear();
    const doy = v.has(ENV.dayOfYear) ? v.get(ENV.dayOfYear) : 172;
    const sun = sunPosition(julianDayFromDayOfYear(year, doy, v.get(ENV.timeUtcHours)), v.get(FDM.lat), v.get(FDM.lon));
    return sun.elevationDeg < -3;
  }
  return v.get(ENV.ambientLight, 1) < 0.5;
}

/** Writes the cockpit switch / lever vars for `s` (no system snapping). */
export function setB738Switches(ctx: Pick<SimContext, 'vars'>, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const powered = !cold;
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const ground = !inAir;
  const night = presetIsNight(v);
  const fieldFt = Math.round(v.get(FDM.altMsl) - (inAir ? v.get(FDM.altAgl) : 0));

  // ------------------------------------------------ FLIGHT CONTROL panel (guarded switches stay in their normal position)
  for (const x of ['a', 'b'] as const) {
    v.set(B738.fltCtl(x), 1);
    v.set(B738.spoilerSw(x), 1);
  }
  v.set(B738.ydSw, powered ? 1 : 0);
  v.set(B738.altFlapsArm, 0);
  v.set(B738.altFlapsSw, 0);
  // ------------------------------------------------ FUEL
  const centerKg = v.get('fuel.tank2_kg');
  for (const p of FUEL_PUMPS) {
    const center = p === 'c_l' || p === 'c_r';
    // Centre pumps ON only with > 453 kg in the centre tank (FCOM NP: "if the centre tank contains more than 1,000 lb").
    v.set(B738.fuelPump(p), powered && (!center || centerKg > 453) ? 1 : 0);
  }
  v.set(B738.crossfeed, 0);
  // ------------------------------------------------ ELECTRICAL
  v.set(B738.dcMeterSel, 2);
  v.set(B738.acMeterSel, 2);
  v.set(B738.batSw, powered ? 1 : 0);
  v.set(B738.cabUtilSw, powered ? 1 : 0);
  v.set(B738.ifeSw, powered ? 1 : 0);
  v.set(B738.stbyPwrSw, 1);
  v.set(B738.grdPwrSw, 0);
  v.set(B738.busXferSw, 1);
  for (const i of [1, 2] as const) {
    v.set(B738.genSw(i), 0);
    v.set(B738.apuGenSw(i), 0);
    v.set(B738.driveDisc(i), 0);
  }
  v.set(B738.elecMaint, 0);
  // ------------------------------------------------ APU / ENGINE START
  v.set(B738.apuSw, APU_SW.off);
  // Before taxi to after take-off: CONT (FCOM NP.21 "ENGINE START switches ... CONT"); cruise OFF.
  const engStart = cold || s === 'cruise' ? ENG_START.off : ENG_START.cont;
  for (const i of [1, 2] as const) {
    v.set(B738.engStart(i), engStart);
    v.set(B738.startLever(i), cold ? 0 : 1);
    v.set(B738.tla(i), 0);
    v.set(B738.revLever(i), 0);
    v.set(B738.eec(i), 1);
    v.set(B738.engAi(i), 0);
    v.set(B738.bleed(i), 1);
    v.set(B738.pack(i), 1);
    v.set(B738.recircFan(i), 1);
    v.set(B738.fireHandle(i), 0);
    v.set(B738.fireRot(i), 0);
    v.set(B738.ovhtDet(i), 0);
    v.set(B738.yokeTrim(i), 0);
    v.set(B738.ailTrim(i), 0);
    v.set(B738.masterCaution(i), 0);
    v.set(B738.fireWarnPush(i), 0);
    v.set(B738.recall(i), 0);
    v.set(B738.belowGs(i), 0);
    v.set(B738.clockChr(i), 0);
    v.set(B738.clockEt(i), 0);
    v.set(B738.panelLt(i), powered && night ? 0.7 : powered ? 0.3 : 0);
    v.set(B738.mapLt(i), 0);
    v.set(B738.wiper(i), 0);
    v.set(B738.landingRetract(i), s === 'takeoff' || s === 'approach' ? 2 : 0);
    v.set(B738.landingFixed(i), s === 'takeoff' || s === 'approach' ? 1 : 0);
    v.set(B738.turnoff(i), s === 'takeoff' || (s === 'ready_to_taxi' && night) ? 1 : 0);
    v.set(B738.navXfer(i), 0);
    v.set(B738.navTest(i), 0);
    v.set(B738.comXfer(i), 0);
    v.set(B738.rtpPower(i), powered ? 1 : 0);
    v.set(B738.adfMode(i), powered ? 2 : 0);
    v.set(B738.adfTone(i), 0);
    v.set(B738.adfXfer(i), 0);
    v.set(B738.machTest(i), 0);
    v.set(B738.stallTest(i), 0);
  }
  v.set(B738.ignSel, 0); // BOTH (EST: common operator practice for the first flight alternates L / R)
  // ------------------------------------------------ HYDRAULICS: ENG pumps ON always, ELEC pumps ON when powered (before start)
  for (const p of HYD_PUMP_SWITCHES) v.set(B738.hydPump(p), p.startsWith('eng') || powered ? 1 : 0);
  // ------------------------------------------------ ANTI-ICE
  for (const w of WINDOW_HEATS) v.set(B738.windowHeat(w), powered ? 1 : 0); // NP: window heat ON at least 10 min before take-off
  v.set(B738.windowHeatTest, 0);
  v.set(B738.probeHeat('a'), powered ? 1 : 0); // NP.21 before taxi: PROBE HEAT ON
  v.set(B738.probeHeat('b'), powered ? 1 : 0);
  v.set(B738.tatTest, 0);
  v.set(B738.wingAi, 0);
  // ------------------------------------------------ AIR CONDITIONING / BLEED
  for (const z of ['cont', 'fwd', 'aft'] as const) v.set(B738.tempSel(z), 0.35); // AUTO, ~22 degC
  v.set(B738.tempSrcSel, 0);
  v.set(B738.trimAir, 1);
  v.set(B738.isoValve, 1);
  v.set(B738.apuBleed, 0);
  v.set(B738.tripReset, 0);
  v.set(B738.ovhtTest, 0);
  // ------------------------------------------------ PRESSURIZATION: FLT ALT = planned cruise, LAND ALT = destination (here: field)
  v.set(B738.fltAltFt, 35000);
  v.set(B738.landAltFt, Math.round(Math.max(-1000, fieldFt) / 50) * 50);
  v.set(B738.pressMode, 0);
  v.set(B738.outflowSw, 0);
  v.set(B738.altHornCutout, 0);
  // ------------------------------------------------ EXTERIOR LIGHTS
  v.set(B738.taxiLt, s === 'ready_to_taxi' || s === 'takeoff' ? 1 : 0);
  v.set(B738.logoLt, powered && night && ground ? 1 : 0);
  v.set(B738.positionLt, !powered ? 0 : moving ? 1 : -1); // STEADY on the ground, STROBE & STEADY from take-off
  v.set(B738.antiColl, s === 'ready_to_taxi' || moving ? 1 : 0);
  v.set(B738.wingLt, powered && night && s !== 'cruise' ? 1 : 0);
  v.set(B738.wheelWellLt, 0);
  // ------------------------------------------------ FORWARD OVERHEAD misc
  v.set(B738.equipCoolSupply, 0);
  v.set(B738.equipCoolExhaust, 0);
  v.set(B738.emerExitLt, powered ? 1 : 0);
  v.set(B738.noSmoking, powered ? 1 : 0);
  v.set(B738.fastenBelts, powered ? (s === 'cruise' ? 1 : 2) : 0);
  v.set(B738.attendCall, 0);
  v.set(B738.grdCall, 0);
  v.set(B738.cvrTest, 0);
  v.set(B738.cvrErase, 0);
  // Dome OFF for taxi / take-off at night (night vision, outside scan; FCTM night operations). The presets
  // start ready to move, so the dome stays off; the crew uses it at the gate.
  v.set(B738.domeLt, 0);
  v.set(B738.ovhdPanelLt, powered && night ? 0.7 : powered ? 0.3 : 0);
  v.set(B738.cbPanelLt, powered && night ? 0.4 : 0);
  // ------------------------------------------------ AFT OVERHEAD
  v.set('ac.irs1_mode', powered ? 2 : 0);
  v.set('ac.irs2_mode', powered ? 2 : 0);
  v.set(B738.isduSel, 1);
  v.set(B738.isduSys, 0);
  v.set(B738.passOxy, 0);
  // Crew oxygen masks stowed, regulators at 100 % (side consoles).
  for (const i of [1, 2] as const) {
    v.set(B738.oxyMask(i), 0);
    v.set(B738.oxyTest(i), 0);
    v.set(B738.oxyDiluter(i), 0);
    v.set(B738.oxyEmer(i), 0);
  }
  v.set(B738.fdrSw, 0);
  v.set(B738.leDevTest, 0);
  v.set(B738.svcInterphone, 0);
  v.set(B738.eltSw, 0); // ARM
  for (const d of DOORS) v.set(B738.door(d), 0);
  v.set(B738.fdDoorLock, 0);
  // ------------------------------------------------ FORWARD PANELS
  v.set(B738.lightsTest, 0);
  v.set(B738.nwsSw, 1);
  // EST: low background / glareshield flood at night (both drive the glareshield floods); 0.5 / 0.3 washed the
  // forward panel near-white in the night screenshots (3 cd floods ~0.3 m from the panel), well above the dim
  // look of an NG panel at night, where the backlit legends carry the panel.
  v.set(B738.backgroundLt, powered && night ? 0.12 : 0);
  v.set(B738.afdsFlood, powered && night ? 0.3 : 0);
  v.set(B738.glareshieldFlood, powered && night ? 0.12 : 0); // EST: see BACKGROUND above (same flood zone)
  v.set(B738.gpwsFlapInh, 0);
  v.set(B738.gpwsGearInh, 0);
  v.set(B738.gpwsTerrInh, 0);
  v.set(B738.gpwsTest, 0);
  v.set(B738.gearLever, s === 'cruise' ? GEAR_LEVER.off : GEAR_LEVER.down); // after take-off: UP then OFF (FCOM NP)
  v.set(B738.gearManualExt, 0);
  v.set(B738.gearLockOvrd, 0);
  v.set(B738.autobrake, s === 'ready_to_taxi' || s === 'takeoff' ? -1 : s === 'approach' ? 2 : 0);
  v.set(B738.isfdApp, s === 'approach' ? 1 : 0);
  v.set(B738.isfdHpa, 0);
  v.set(B738.isfdRst, 0);
  v.set(B738.isfdStd, 0);
  // ------------------------------------------------ CONTROL STAND
  v.set(B738.speedbrake, s === 'approach' ? SPEEDBRAKE.armed : SPEEDBRAKE.down);
  const flapLever = s === 'ready_to_taxi' || s === 'takeoff' ? TAKEOFF_FLAP_LEVER : s === 'approach' ? FLAP_LEVER.f15 : FLAP_LEVER.up;
  v.set(B738.flapLever, flapLever);
  v.set(B738.parkBrake, moving ? 0 : 1);
  v.set(B738.stabCutoutMain, 1);
  v.set(B738.stabCutoutAp, 1);
  v.set(B738.stabTrimOvrd, 0);
  v.set(B738.rudTrim, 0);
  v.set(B738.hornCutout, 0);
  v.set(B738.tiller3d, 0);
  // ------------------------------------------------ FIRE PANEL
  v.set(B738.fireHandleApu, 0);
  v.set(B738.fireRotApu, 0);
  v.set(B738.fireTest, 0);
  v.set(B738.extTest, 0);
  v.set(B738.bellCutout, 0);
  for (const z of ['fwd', 'aft'] as const) {
    v.set(B738.cargoDetSel(z), 0);
    v.set(B738.cargoArm(z), 0);
  }
  v.set(B738.cargoDisch, 0);
  v.set(B738.cargoTest, 0);
  // ------------------------------------------------ RADIO / ATC / WXR / audio
  for (const acp of [1, 2, 3] as const) {
    v.set(B738.acpMic(acp), 0);
    v.set(B738.acpMkrVol(acp), acp < 3 ? 0.5 : 0);
    v.set(B738.acpAltNorm(acp), 0);
    v.set(B738.acpFilter(acp), 0);
    // Receivers: VHF 1 / VHF 2, flight interphone and MKR on at mid volume on the crew panels (EST line practice).
    for (const rx of ACP_RECEIVERS) {
      if (rx !== 'spkr') v.set(B738.acpRxOn(acp, rx), acp < 3 && (rx === 'vhf1' || rx === 'vhf2' || rx === 'flt' || rx === 'mkr') ? 1 : 0);
      if (rx !== 'mkr') v.set(B738.acpRxVol(acp, rx), 0.5);
    }
    v.set(B738.acpPtt(acp), 0);
    v.set(B738.acpMaskBoom(acp), 0);
  }
  for (const s of [1, 2] as const) v.set(B738.yokeMic(s), 0);
  v.set(B738.xpdrModeSel, !powered ? XPDR_SEL.stby : moving ? XPDR_SEL.taRa : XPDR_SEL.xpndr);
  v.set(B738.xpdrAtc, 1);
  v.set(B738.xpdrAltSrc, 1);
  v.set(B738.tcasRange, 0);
  v.set(B738.xpdrIdentBtn, 0);
  if (!v.has('xpdr.code')) v.set('xpdr.code', 2000);
  v.set(B738.wxrMode, 0);
  v.set(B738.wxrGain, 0.5);
  v.set(B738.wxrTilt, s === 'cruise' ? -1 : 4);
  v.set(B738.wxrPower, moving ? 1 : 0);
  v.set(B738.pedestalPanelLt, powered && night ? 0.6 : powered ? 0.3 : 0);
  v.set(B738.pedestalFlood, powered && night ? 0.2 : 0);
  // ------------------------------------------------ ground services
  v.set(B738.gpuConnected, 0);
  // ------------------------------------------------ MCP / EFIS: set by the avionics suite applyState; baro set below.
}

/** `AircraftInstance.applyState` of the 737-800. */
export function applyB738State(ctx: SimContext, sys: B738Systems, s: InitialState): void {
  const v = ctx.vars;
  setB738Switches(ctx, s);
  const cold = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';

  // Surfaces and gear to their commanded positions.
  sys.flaps.setPosition(B738_FLAP_DETENTS[Math.round(v.get(B738.flapLever))].flapDeg);
  sys.gear.setDown(s !== 'cruise');
  // The FDM publishes the weight-on-wheels vars only on its first step; seed them so the squat switches
  // start in the right state instead of reporting a spurious touchdown a moment after the state load
  // (which would, e.g., trip the A/T automatic disengagement 2 s later).
  for (const i of [0, 1, 2]) v.set(`gear.wow${i}`, inAir ? 0 : 1);
  sys.gear.reset();
  sys.stab.setPosition(inAir ? STAB.neutral : TAKEOFF_TRIM_UNITS);
  sys.aileronTrim.setPosition(0);
  sys.rudderTrim.setPosition(0);

  // Electrical sources: gens with engines running; nothing in cold & dark.
  sys.acSources.select(cold ? 'none' : 'gens');
  sys.apu.setRunning(false);
  sys.logic.reset();
  sys.logic.update(1 / 60);
  sys.acSources.update();
  sys.fuel.snapValves();
  sys.lights.snap();
  sys.elec.settle();
  sys.oxy.reset();
  sys.fire.reset();

  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];
  if (cold) {
    ctx.fdm.setEnginesRunning?.(false);
    for (const st of sys.starts) st.reset();
    for (const i of sys.irs) i.reset();
    for (const a of sys.adc) a.reset();
    sys.isfdAhrs.reset(false);
    sys.hyd.setPressure('a', 0);
    sys.hyd.setPressure('b', 0);
    sys.hyd.setPressure('stby', 0);
    // Air/ground state before the suite reset: otherwise the A/T touchdown bookkeeping sees a landing at the
    // first update and disarms an A/T ARM set during the preflight 2 s later (the post-touchdown disengage).
    sys.gear.update(1 / 60);
    sys.suite.applyState(s);
    sys.press.settle();
    sys.pneu.snap(15);
    sys.cas.reset();
    sys.logicLate.reset();
    sys.elec.settle();
    return;
  }

  if (inAir) {
    // Re-place so the trimmed attitude reflects the configuration, then trim pitch (stabilizer) and thrust.
    const ias = Math.max(140, v.get(FDM.ias));
    ctx.fdm.reposition({ lat: v.get(FDM.lat), lon: v.get(FDM.lon), altFtMsl: v.get(FDM.altMsl), headingTrue: v.get(FDM.headingTrue), iasKt: ias });
    const trim = fm.computeTrim?.({ iasKt: ias });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      const t = Math.max(-1, Math.min(1, trim.pitchTrim));
      sys.stab.setPosition(STAB.neutral + t * (t >= 0 ? STAB.maxUnits - STAB.neutral : STAB.neutral - STAB.minUnits));
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
      v.set(B738.tla(1), lo);
      v.set(B738.tla(2), lo);
    }
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    v.set(AP.selAltitude, Math.round(v.get(FDM.altMsl) / 100) * 100);
    v.set(AP.selSpeed, Math.round(ias));
    // Pressurization FLT ALT: the cruise level in cruise; for the approach the (already passed) cruise level.
    v.set(B738.fltAltFt, s === 'cruise' ? Math.round(v.get(FDM.altMsl) / 500) * 500 : 35000);
  } else {
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    v.set(AP.selAltitude, Math.round((v.get(FDM.altMsl) + 5000) / 1000) * 1000);
  }
  // Altimeters: QNH (STD in cruise above the transition altitude).
  const std = s === 'cruise' ? 1 : 0;
  for (const i of [1, 2, 3]) {
    v.set(ADC.baroSetting(i), v.get('env.qnh_inhg', 29.92));
    v.set(ADC.baroStd(i), i < 3 ? std : 0);
  }

  sys.logic.update(1 / 60);
  sys.ratings.update(1 / 60);
  sys.fadec.update(1 / 60);
  for (const i of [1, 2]) {
    v.set(`fadec.eng${i}.fuel_cmd`, 1);
    v.set(ENG.fuelOn(i), 1);
  }
  ctx.fdm.setEnginesRunning?.(true);
  for (const st of sys.starts) st.reset();
  sys.acSources.select('gens');
  sys.elec.settle();
  sys.fuel.update(1 / 60);
  sys.hyd.setPressure('a', 3000);
  sys.hyd.setPressure('b', 3000);
  sys.hyd.setPressure('stby', 0);
  for (const i of sys.irs) {
    i.forceAligned();
    i.reset();
  }
  for (const a of sys.adc) a.reset();
  sys.isfdAhrs.reset(true);
  // Air/ground state before the suite reset: the A/T touchdown bookkeeping reads gear.air_ground on reset.
  sys.gear.update(1 / 60);
  sys.suite.applyState(s);
  sys.press.settle();
  sys.pneu.snap(22);
  sys.yd.reset?.();
  sys.cas.reset();
  sys.logicLate.reset();

  // In the air: engage CMD A with heading select and altitude hold, A/T in MCP SPD, once the air data is valid
  // (the suite leaves the A/P off; B738Logic performs the engagement a few seconds after the state load).
  sys.logic.pendingApEngage = inAir;
}
