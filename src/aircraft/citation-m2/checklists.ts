/**
 * Citation M2 checklists: normal (AFM Section III phases), emergency and abnormal.
 *
 * Sources: CJ-family AFM 525AFM-06 Section III (Emergency Procedures TOC p.3-5/3-6, ENG FIRE LH or RH p.3-9, Engine
 * Failure/Precautionary Shutdown p.3-8, Engine Failure During Final Approach p.3-9, Electrical Fire or Smoke p.3-17,
 * Smoke Removal p.3-21, CABIN ALT p.3-23, Emergency Descent / BATT O'TEMP p.3-24/3-25, Autopilot Malfunction /
 * Electric Elevator Trim Runaway / Emergency Evacuation p.3-28; Normal Procedures pp.3-83..3-94); "CJ1 Memory Items
 * and Limitations" (Model 525 SN 360 and subsequent: takeoff engine failure, emergency restart, emergency descent);
 * operator M2 flows ("Geoffs M2 Flows", 525-962: cockpit preparation, electrical check, trim checks, ice protection
 * checks, all-engine go-around and every normal phase). The M2 hardware differs from the CJ1/CJ2 panels (AOPA Pilot
 * Mar 2014): no avionics master or ignition switches (ignition, system tests, transfer and pressurization on the GTC),
 * the throttle cut-off position is labelled OFF, and the AIR SOURCE SELECT reads L / BOTH / R / EMER / FRESH AIR.
 *
 * Items with `check` are ticked live from the systems vars (the app's checklist panel); the G3000 electronic
 * checklist lists the same lists under their phase (G3000 checks are manual, as in the real system).
 * Action-sequence items (system tests, CVR / mask test, electrical, trim and AP disconnect checks) read the latches of
 * systems/procedures.ts.
 */
import type { Checklist } from '../types';
import { SURF, ENG, ADC } from '../../core/vars';
import { M2, PRESS_SRC, TEST_SEL, TLA } from './vars';

type V = Parameters<NonNullable<Checklist['items'][number]['check']>>[0];
const both = (f: (i: number) => boolean) => f(1) && f(2);
const either = (f: (i: number) => boolean) => f(1) || f(2);
const all3 = (f: (i: number) => boolean) => f(1) && f(2) && f(3);

/** US transition altitude (14 CFR 91.121 / AIM 7-2-2): altimeters to 29.92 above, local QNH below. */
export const TRANSITION_ALT_FT = 18000;
/** GTC SYSTEM TESTS required before flight (M2 flows "SYS TEST ALL ITEMS"; dossier §10 item 1). */
const ALL_TESTS = [TEST_SEL.fire, TEST_SEL.annu, TEST_SEL.stall, TEST_SEL.overspeed, TEST_SEL.gear, TEST_SEL.taws].reduce((m, t) => m | (1 << t), 0);

const qnhSet = (v: V) => all3((i) => v.get(ADC.baroStd(i)) === 0 && Math.abs(v.get(ADC.baroSetting(i), 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02);
const stdSet = (v: V) => all3((i) => v.get(ADC.baroStd(i)) !== 0);
/** Landing field elevation set: GTC entry, or the FMS destination the controller uses automatically (S&D15 §9.5). */
const lfeSet = (v: V) => v.get(M2.landingElevFt) > -1000 || v.getString('fms.dest') !== '';
const casClear = (v: V) => v.get('cas.warning_count') === 0 && v.get('cas.caution_count') === 0;
const trims3 = (v: V) => v.get('trim.pitch_to_ok') !== 0 && Math.abs(v.get(M2.aileronTrim)) < 0.1 && Math.abs(v.get(M2.rudderTrim)) < 0.1;
const toldSent = (v: V) => v.get('g3k.vspd.V1.src') === 2 && v.get('g3k.vspd.VR.src') === 2;
const vref = (v: V) => v.get('g3k.vspd.VREF.kt', NaN);
const extLightsOff = (v: V) => v.get(M2.navLt) === 0 && v.get(M2.antiColl) === 0 && v.get(M2.landingLt) === 0 && v.get(M2.taxiLt) === 0 && v.get(M2.logoLt) === 0 && v.get(M2.wingInspLt) === 0;
const iceOff = (v: V) => v.get(M2.pitotStaticSw) === 0 && both((i) => v.get(M2.engAiSw(i)) === 0 && v.get(M2.wsBleedSw(i)) === 0) && v.get(M2.tailDeiceSw) === 0 && v.get(M2.wsAlcoholSw) === 0;

// ======================================================================================== NORMAL
export const M2_NORMAL: Checklist[] = [
  {
    title: 'Preflight inspection',
    phase: 'Preflight',
    items: [
      // M2 flows PREFLIGHT: BATTERY CONNECTED, FORWARD PRESSURE GAUGES CHECKED, EXTER DOORS LOCKED.
      { challenge: 'Battery', response: 'CONNECTED' },
      { challenge: 'Forward pressure gauges (oxygen, emergency gear / brake)', response: 'CHECKED', check: (v: V) => v.get('oxy.main_psi') > 400 && v.get(M2.emerBrakeBottlePsi, 1800) > 1000 },
      { challenge: 'Covers, pins, chocks', response: 'REMOVED' },
      { challenge: 'Exterior doors', response: 'LOCKED', check: (v) => ['nose_bag_l', 'nose_bag_r', 'tail_bag'].every((d) => v.get(M2.doorOpen(d as 'tail_bag')) === 0) },
    ],
  },
  {
    title: 'Cockpit preparation',
    phase: 'Ground',
    items: [
      { challenge: 'Control lock', response: 'REMOVED', check: (v) => v.get(M2.controlLock) === 0 },
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Throttles', response: 'OFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Gear handle', response: 'DOWN', check: (v) => v.get(M2.gearHandle) >= 0.5 },
      // M2 flows CIRCUIT BREAKERS IN; AFM cockpit inspection "all circuit breakers - CHECK".
      { challenge: 'Circuit breakers', response: 'IN', check: (v) => v.get(M2.cbAllIn) === 1 },
      { challenge: 'Emergency gear release / blow down', response: 'STOWED', check: (v) => v.get(M2.gearEmerRelease) === 0 && v.get(M2.gearBlowdown) === 0 },
      // M2 flows BLEEDS BOTH / ICE EQUIP OFF.
      { challenge: 'Air source select', response: 'BOTH', check: (v) => v.get(M2.pressSource) === PRESS_SRC.both },
      { challenge: 'Ice protection', response: 'OFF', check: iceOff },
      // EST: "pressure checked" = above the 400 psi LOW threshold (bottle 1,850 psi full, systems/airframe.ts); the
      // dispatch minimum depends on the flight's oxygen duration (AFM Section IV, not public).
      { challenge: 'Oxygen', response: 'PRESSURE CHECKED / PASS OXY NORM', check: (v) => v.get(M2.paxOxy) === 1 && v.get('oxy.main_psi') > 400 },
      // AFM cockpit inspection: masks CHECKED and STOWED (PRESS TO TEST, flow indicator); M2 flows 18K "MASKS CHECKED".
      { challenge: 'Crew oxygen mask', response: 'TESTED (flow) and STOWED', check: (v) => (v.get(M2.maskTested) & 1) !== 0 && both((i) => v.get(M2.maskOn(i)) === 0) },
      // AFM preliminary cockpit inspection 6-8 / M2 flows: battery disconnect check (CAE differences p.5-23).
      { challenge: 'Battery disconnect switch', response: 'BATT DISC', check: (v) => v.get(M2.battDisc) === 1 },
      { challenge: 'Battery switch', response: 'BATT (no voltage indication)', check: (v) => v.get(M2.battSw) === 1 && v.get('elec.batt_bus_v') < 5 },
      { challenge: 'Battery disconnect switch', response: 'NORM (24 volts minimum)', check: (v) => v.get(M2.battDisc) === 0 && v.get(M2.battSw) === 1 && v.get('elec.batt_v') >= 24 },
      { challenge: 'External power', response: 'AS REQUIRED (28 V)' },
      { challenge: 'EMER LIGHTS switch', response: 'ARMED', check: (v) => v.get(M2.emerLtsSw) === 1 },
      { challenge: 'STBY FLT DISPLAY switch', response: 'TEST / ON', check: (v) => v.get(M2.stbyDispSw) >= 1 },
      // CJ-family AFM cockpit inspection (BATTERY EMER check) / M2 flows EMER BUS ITEMS: PFD 1 in reversion (AHRS 2,
      // ADC 2, GPS 1), left GTC (COM 1, NAV 1, XPDR 1), audio, AFCS control panel, flood lights, gear lights.
      { challenge: 'Battery switch', response: 'EMER (check emergency bus items)', check: (v) => v.get('elec.emer_powered') !== 0 && v.get('elec.pfd1_powered') !== 0 && v.get('elec.avn1_powered') === 0 },
      { challenge: 'Battery switch', response: 'BATT (avionics on)', check: (v) => v.get(M2.battSw) === 1 },
      // M2 flows SYS TEST ALL ITEMS (GTC Aircraft Systems > SYSTEM TESTS); CJ limitation: satisfactory stall warning
      // checks before flight.
      { challenge: 'System tests (GTC)', response: "ALL ITEMS CHECKED (FIRE WARN, ANNU, STALL WARN, O'SPEED, LDG GEAR, TAWS)", check: (v) => (v.get(M2.sysTestsDone) & ALL_TESTS) === ALL_TESTS },
      { challenge: 'Cockpit voice recorder', response: 'TEST', check: (v) => v.get(M2.cvrTested) !== 0 },
      { challenge: 'Takeoff data (GTC PERF)', response: 'COMPUTED', check: toldSent },
      { challenge: 'Fuel quantity', response: 'CHECK / BALANCED', check: (v) => v.get('fuel.imbalance') === 0 },
      { challenge: 'ATIS / clearance', response: 'NOTED' },
      { challenge: 'Altitude select', response: 'SET', check: (v) => v.get('ap.sel_alt_ft') > 0 },
      { challenge: 'FMS', response: 'PROGRAM', check: (v) => v.getString('fms.dest') !== '' },
    ],
  },
  {
    title: 'Before starting engines',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET / UNCHOCKED', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Cabin door', response: 'CLOSED AND LOCKED', check: (v) => v.get(M2.doorOpen('cabin')) === 0 && v.get(M2.doorOpen('emer_exit')) === 0 },
      { challenge: 'Passenger briefing', response: 'COMPLETE' },
      // AFM Before Starting Engines "Air Conditioner - OFF"; M2 flows "AC OFF" (the load comes on with the first generator).
      { challenge: 'Air conditioning', response: 'OFF', check: (v) => v.get(M2.airCondSw) === 0 },
      { challenge: 'Engine instruments', response: 'CHECK' },
      { challenge: 'Fuel quantity', response: 'CHECKED AND BALANCED', check: (v) => v.get('fuel.imbalance') === 0 },
      { challenge: 'External power', response: 'DISCONNECTED (battery start) / AS REQUIRED', check: (v) => v.get(M2.gpuConnected) === 0 },
      // No avionics switch (AOPA Mar 2014): the BATTERY switch powers the avionics; DISPATCH (GTC 1 + MFD on the aux
      // battery) is only for ground comm / flight planning before the battery is on.
      { challenge: 'DISPATCH switch', response: 'OFF', check: (v) => v.get(M2.dispatchSw) === 0 },
      { challenge: 'Battery switch', response: 'BATT (avionics on)', check: (v) => v.get('elec.pfd1_powered') !== 0 && v.get('elec.mfd_powered') !== 0 && v.get('elec.pfd2_powered') !== 0 },
      { challenge: 'Generators', response: 'GEN', check: (v) => both((i) => v.get(M2.genSw(i)) === 1) },
      { challenge: 'Boost pumps', response: 'NORM', check: (v) => both((i) => v.get(M2.boostSw(i)) === 0) },
      // 525AFM-06 p.3-88 Starting Engines step 6 checks these extinguish after the start.
      { challenge: 'CAS', response: 'GEN OFF / OIL PRESS / FUEL LOW PRESS / HYD FLOW LOW displayed', check: (v) => v.get('cas.gen_off_l_stop') + v.get('cas.gen_off_r_stop') > 0 },
      { challenge: 'Ignition (GTC ENGINE page)', response: 'NORM', check: (v) => both((i) => v.get(M2.ignSw(i)) === 0) },
      { challenge: 'Beacon', response: 'ON', check: (v) => v.get(M2.antiColl) >= 1 },
    ],
  },
  {
    title: 'Starting engines',
    phase: 'Ground',
    items: [
      // 525AFM-06 Starting Engines: either engine may be started first (the downwind engine first for a battery start
      // in a crosswind).
      { challenge: 'ENGINE START button (first engine)', response: 'PRESS (either; downwind first on battery start)', check: (v) => either((i) => v.get(M2.startLight(i)) !== 0 || v.get(ENG.running(i)) !== 0) },
      { challenge: 'Throttle', response: 'IDLE at 8 % N2 minimum (N1 rotation)', check: (v) => either((i) => v.get(M2.tla(i)) >= TLA.idle - 0.01) },
      { challenge: 'ITT', response: 'RISE within 10 s (abort if no rise, or ITT rapidly approaching 1,000 C)', check: (v) => either((i) => v.get(ENG.running(i)) !== 0) },
      { challenge: 'ENGINE START button (second engine)', response: 'PRESS', check: (v) => both((i) => v.get(M2.startLight(i)) !== 0 || v.get(ENG.running(i)) !== 0) },
      { challenge: 'Throttle', response: 'IDLE at 8 % N2 minimum (N1 rotation)', check: (v) => both((i) => v.get(M2.tla(i)) >= TLA.idle - 0.01) },
      { challenge: 'ITT', response: 'RISE within 10 s; stable idle', check: (v) => both((i) => v.get(ENG.running(i)) !== 0) },
      // 525AFM-06 p.3-88 step 6: "Fuel, Oil, Generator and Hydraulic Annunciators - EXTINGUISHED".
      {
        challenge: 'Fuel, oil, generator, hydraulic annunciations',
        response: 'EXTINGUISHED',
        check: (v) => ['gen_off', 'oil_press', 'fuel_press_low', 'hyd_flow_low'].every((m) => ['l', 'r'].every((s) => v.get(`cas.${m}_${s}`) === 0 && v.get(`cas.${m}_${s}_stop`) === 0)),
      },
      { challenge: 'Oil pressure', response: 'CHECK', check: (v) => both((i) => v.get(ENG.oilPressPsi(i)) >= 23) },
      { challenge: 'DC amps and volts', response: 'CHECK (28-29 V)', check: (v) => v.get('elec.sg1_online') !== 0 && v.get('elec.sg2_online') !== 0 && v.get('elec.l_main_v') >= 27.5 },
    ],
  },
  {
    // M2 flows ELECTRICAL CHECK (after both engines are running; before-start flow "ELECTRICAL SYSTEM CHECK").
    title: 'Electrical check',
    phase: 'Ground',
    items: [
      { challenge: 'L GEN switch', response: 'OFF: L amps 0, R amps increase, GENERATOR OFF L', check: (v) => (v.get(M2.elecCheck) & 1) !== 0 },
      { challenge: 'R GEN switch', response: 'OFF: GENERATOR OFF L-R, battery 24 V' },
      { challenge: 'L GEN switch', response: 'GEN: L amps positive, 28-29 V, GENERATOR OFF R', check: (v) => (v.get(M2.elecCheck) & 2) !== 0 },
      { challenge: 'R GEN switch', response: 'GEN: amps within 20 A, 28-29 V, GEN OFF cleared', check: (v) => both((i) => v.get(M2.genSw(i)) === 1 && v.get(`elec.sg${i}_online`) !== 0) },
      { challenge: 'Battery switch', response: 'OFF: all systems and displays remain on' },
      { challenge: 'Battery switch', response: 'BATT (28-29 V)', check: (v) => v.get(M2.battSw) === 1 },
    ],
  },
  {
    title: 'Before taxi',
    phase: 'Ground',
    items: [
      // M2 flows BEFORE TAXI.
      { challenge: 'Air conditioning', response: 'FAN or AUTO', check: (v) => v.get(M2.airCondSw) === 1 || v.get(M2.cabinFan) >= 1 },
      { challenge: 'Pass safety', response: 'BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) === 2 },
      // 525AFM-06 p.3-89.1 Before Taxi 7: flap / speed brake (ground flaps) check.
      { challenge: 'GROUND FLAPS', response: 'SELECT: both speed brakes deploy', check: (v) => v.get(M2.flapHandle) >= 2.9 && v.get(SURF.speedbrake) > 0.95 },
      { challenge: 'Throttles > 85 % N2', response: 'speed brakes RETRACT, FLAPS >35 displayed; IDLE: speed brakes redeploy' },
      { challenge: 'Flaps', response: 'T.O. & APPR: speed brakes retract' },
      // 525AFM-06 p.3-89.1 Before Taxi 6 / M2 flows TRIM CHECKS: each half alone no trim, AP/TRIM DISC stops trim.
      { challenge: 'Trims', response: 'CHECK: each half alone no trim; AP/TRIM DISC stops trim', check: (v) => (v.get(M2.trimCheck) & 3) === 3 },
      { challenge: 'Trims', response: '3 SET FOR TAKEOFF', check: trims3 },
      { challenge: 'Autopilot', response: 'DISCONNECT TEST', check: (v) => v.get(M2.apDiscTested) !== 0 },
      { challenge: 'Flight controls', response: 'FREE AND CORRECT' },
      { challenge: 'Engine anti-ice', response: 'AS REQUIRED' },
      { challenge: 'Altimeters (PFD 1, PFD 2, standby)', response: 'SET / CHECK', check: qnhSet },
      { challenge: 'Transponder', response: 'CHECK / SET', check: (v) => v.get('xpdr.mode') >= 1 },
      { challenge: 'Pressurization', response: 'DEST FIELD ELEV (GTC or FMS)', check: lfeSet },
      { challenge: 'Air source select', response: 'BOTH', check: (v) => v.get(M2.pressSource) === PRESS_SRC.both },
      // 525AFM-06 p.3-90: anti-skid self test completed while stationary.
      { challenge: 'Anti-skid', response: 'ON, ANTISKID INOP out', check: (v) => v.get(M2.antiskidSw) !== 0 && v.get('cas.antiskid_inop') === 0 },
      { challenge: 'GA button', response: 'PUSH (FD TO)', check: (v) => v.getString('ap.vert_active') === 'TO' },
      { challenge: 'Avionics / FMS', response: 'SET UP / CHECK' },
      { challenge: 'V-speeds / TOFL / weights', response: 'POSTED / CONFIRM', check: toldSent },
      { challenge: 'Flight instruments', response: 'CHECK' },
      { challenge: 'CAS', response: 'CHECK', check: (v) => v.get('cas.warning_count') === 0 },
    ],
  },
  {
    title: 'Taxi',
    phase: 'Ground',
    items: [
      // AFM Taxi / M2 flows TAXI: parking brake released here, brakes and steering checked on the roll.
      { challenge: 'Parking brake', response: 'RELEASE', check: (v) => v.get(M2.parkBrake) === 0 },
      { challenge: 'Exterior lights', response: 'AS REQUIRED (NAV, TAXI)', check: (v) => v.get(M2.navLt) !== 0 },
      { challenge: 'Brakes', response: 'CHECK' },
      { challenge: 'Nosewheel steering', response: 'CHECK' },
      { challenge: 'Flight instruments', response: 'CHECK' },
    ],
  },
  {
    title: 'Before takeoff',
    phase: 'Takeoff',
    items: [
      // 525AFM-06 p.3-91 / M2 flows ICE PROTECTION CHECKS (N2 > 75 % / 70 %): WING/ENG ANTI-ICE ON; ENGINE and WING
      // ANTI-ICE COLD L-R displayed then clear within 60 s; TAIL DE-ICE ON, no TAIL DE-ICE FAIL.
      { challenge: 'Ice protection check (if icing expected)', response: 'WING/ENG and TAIL: COLD displayed then clear' },
      { challenge: 'Passenger seats', response: 'UPRIGHT / OUTBOARD' },
      // FPG p.4 publishes flaps 0 and flaps 15 takeoff speeds.
      { challenge: 'Flaps', response: 'CHECK / SET (15 or 0 per TOLD)', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 || v.get(SURF.flapsDeg) < 1 },
      { challenge: 'Speed brakes', response: 'RETRACTED', check: (v) => v.get(SURF.speedbrake) < 0.02 },
      { challenge: 'Trims', response: '3 SET FOR TAKEOFF', check: trims3 },
      { challenge: 'Crew briefing', response: 'COMPLETE' },
      { challenge: 'TCAS', response: 'TA / RA' },
      { challenge: 'Radar', response: 'AS REQUIRED' },
      { challenge: 'Anti-ice', response: 'AS REQUIRED (10 C or below in visible moisture)' },
      { challenge: 'Pitot & static heat', response: 'ON', check: (v) => v.get(M2.pitotStaticSw) !== 0 },
      { challenge: 'Transponder', response: 'ALT', check: (v) => v.get('xpdr.mode') >= 3 },
      { challenge: 'Exterior lights (landing / recog, anti-coll)', response: 'ON / ALL', check: (v) => v.get(M2.landingLt) === 2 && v.get(M2.antiColl) === 2 },
      // AFM "Annunciator panel - CHECKED" (no unexpected cautions).
      { challenge: 'CAS', response: 'CHECK (no warnings or cautions)', check: casClear },
    ],
  },
  {
    title: 'Takeoff',
    phase: 'Takeoff',
    items: [
      { challenge: 'Throttles', response: 'TO detent', check: (v) => both((i) => v.get(M2.tla(i)) > 0.98) },
      { challenge: 'Engine instruments', response: 'CHECK (N1 on the TO target)' },
      { challenge: 'Brakes', response: 'RELEASE', check: (v) => v.get(M2.parkBrake) === 0 && v.get('input.brake_left') < 0.05 && v.get('input.brake_right') < 0.05 },
      { challenge: 'Rotate', response: 'VR, pitch ~10 deg' },
    ],
  },
  {
    title: 'After takeoff / climb',
    phase: 'Climb',
    items: [
      { challenge: 'Landing gear', response: 'UP (positive rate)', check: (v) => v.get(M2.gearHandle) < 0.5 },
      { challenge: 'Flaps', response: '0 (V2 + 10 minimum)', check: (v) => v.get(SURF.flapsDeg) < 1 },
      { challenge: 'Throttles', response: 'CLB detent', check: (v) => both((i) => Math.abs(v.get(M2.tla(i)) - TLA.clb) < 0.03) },
      { challenge: 'Yaw damper', response: 'AS REQUIRED' },
      { challenge: 'Pass safety', response: 'AS REQUIRED' },
      { challenge: 'Anti-ice', response: 'AS REQUIRED' },
      { challenge: 'Landing / recog lights', response: 'OFF', check: (v) => v.get(M2.landingLt) === 0 },
      { challenge: 'Pressurization', response: 'CHECK', check: (v) => v.get('press.cabin_alt_warn') === 0 },
      // 525AFM-06 After Takeoff-Climb 11 "Altimeters - SET to 29.92 at transition altitude and CROSSCHECK"; M2 flows 18K.
      { challenge: 'Altimeters (18,000 ft)', response: '29.92 (STD) x3, CROSSCHECK', check: stdSet },
      { challenge: 'Oxygen masks (18,000 ft)', response: 'CHECKED', check: (v) => (v.get(M2.maskTested) & 1) !== 0 },
    ],
  },
  {
    title: 'Cruise',
    phase: 'Cruise',
    items: [
      // FPG p.22 high-speed cruise = maximum cruise thrust, the CRU detent (S&D21 §8).
      { challenge: 'Throttles', response: 'CRU detent', check: (v) => both((i) => Math.abs(v.get(M2.tla(i)) - TLA.cru) < 0.03) },
      { challenge: 'Fuel balance', response: 'CHECK (< 200 lb)', check: (v) => v.get('fuel.imbalance') === 0 },
      { challenge: 'Ice protection', response: 'AS REQUIRED (TAT +10 C or below in visible moisture)' },
      { challenge: 'All systems (station check)', response: 'CHECK', check: casClear },
    ],
  },
  {
    title: 'Descent',
    phase: 'Descent',
    items: [
      { challenge: 'Pressurization', response: 'DEST FIELD ELEVATION (GTC or FMS)', check: lfeSet },
      // AFM Descent: defog / windshield air for descent into warm moist air (M2 cockpit air diverter; EST mapping).
      { challenge: 'Windshield defog (cockpit air)', response: 'AS REQUIRED' },
      { challenge: 'Ice protection systems', response: 'AS REQUIRED' },
      { challenge: 'Altimeters (18,000 ft)', response: 'SET local QNH x3, CROSSCHECK', check: qnhSet },
      { challenge: 'Landing data', response: 'CONFIRM (VREF posted)', check: (v) => Number.isFinite(vref(v)) },
      { challenge: 'Exterior lights', response: 'AS REQUIRED' },
    ],
  },
  {
    title: 'Approach',
    phase: 'Approach',
    items: [
      { challenge: 'Landing data & V-speeds', response: 'POSTED AND CONFIRMED', check: (v) => Number.isFinite(vref(v)) },
      { challenge: 'Crew briefing', response: 'COMPLETE' },
      { challenge: 'Avionics / flight instruments', response: 'CHECK' },
      { challenge: 'Minimums', response: 'SET' },
      { challenge: 'Fuel transfer (GTC)', response: 'OFF', check: (v) => v.get(M2.fuelXfer) === 0 },
      { challenge: 'Anti-skid', response: 'ON', check: (v) => v.get(M2.antiskidSw) !== 0 && v.get('cas.antiskid_inop') === 0 },
      { challenge: 'Exterior lights', response: 'AS REQUIRED' },
      { challenge: 'Ice protection systems', response: 'AS REQUIRED' },
      { challenge: 'Flaps', response: '15 (T.O. & APPR, 200 KIAS max)', check: (v) => v.get(SURF.flapsDeg) > 14 },
      { challenge: 'Seats / belts', response: 'UPRIGHT, OUTBOARD / SECURE' },
      { challenge: 'Pass safety', response: 'BELT or BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) >= 1 },
      { challenge: 'CAS', response: 'CHECK', check: casClear },
    ],
  },
  {
    title: 'Before landing',
    phase: 'Approach',
    items: [
      { challenge: 'Landing gear', response: 'DOWN (3 GREEN)', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: '35 (LAND, 161 KIAS max)', check: (v) => v.get(SURF.flapsDeg) > 34 },
      { challenge: 'Speed brakes', response: 'RETRACTED (before 50 ft)', check: (v) => v.get(SURF.speedbrake) < 0.02 },
      // 525AFM-06 p.3-9 / M2 flows APPROACH "PRESSURIZATION DIFFERENTIAL < 0.5 PSI BY TOUCHDOWN".
      { challenge: 'Pressurization', response: 'CHECK ZERO DIFFERENTIAL (< 0.5 psi)', check: (v) => v.get('press.diff_psi') < 0.5 },
      // EST tolerance: VREF (bug) to VREF + 10 for wind additives.
      { challenge: 'Airspeed', response: 'VREF', check: (v) => Math.abs(v.get(ADC.ias(1)) - vref(v) - 2.5) <= 7.5 },
      // CJ limitation (525FM-15): "Autopilot and yaw damper must be OFF for takeoff and landing"; M2 flows DISENGAGE.
      { challenge: 'Autopilot and yaw damper', response: 'OFF (by minimums)', check: (v) => v.get('ap.engaged') === 0 && v.get('ap.yd_engaged') === 0 },
      { challenge: 'Landing / recog lights', response: 'ON', check: (v) => v.get(M2.landingLt) === 2 },
    ],
  },
  {
    title: 'Landing',
    phase: 'Landing',
    items: [
      { challenge: 'Throttles', response: 'IDLE', check: (v) => both((i) => v.get(M2.tla(i)) < 0.02 && v.get(M2.tla(i)) > -0.05) },
      { challenge: 'Brakes', response: 'AS REQUIRED (anti-skid)' },
      // 525AFM-06 p.3-103: flap handle to GROUND FLAPS (60 deg) after touchdown deploys the speed brakes.
      { challenge: 'Flaps', response: 'GROUND FLAPS (speed brakes deploy)', check: (v) => v.get(M2.flapHandle) >= 2.9 && v.get(SURF.speedbrake) > 0.95 },
    ],
  },
  {
    // M2 flows ALL ENGINE GO-AROUND.
    title: 'All engines go-around',
    phase: 'Go-around',
    items: [
      { challenge: 'GA button', response: 'PUSH (FD GA)', check: (v) => v.getString('ap.vert_active') === 'GA' },
      { challenge: 'Throttles', response: 'TO', check: (v) => both((i) => v.get(M2.tla(i)) > 0.98) },
      { challenge: 'Pitch attitude', response: '7.5 deg initially, then as required (FD GA)' },
      { challenge: 'Flaps', response: '15', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Landing gear (positive climb)', response: 'UP', check: (v) => v.get(M2.gearHandle) < 0.5 },
      { challenge: 'Flaps', response: 'AS REQUIRED (flaps 0 at VAPP + 10)' },
      { challenge: 'Airspeed / throttles', response: 'AS REQUIRED' },
      { challenge: 'Yaw damper', response: 'ON', check: (v) => v.get('ap.yd_engaged') !== 0 },
      { challenge: 'Autopilot', response: 'AS DESIRED' },
    ],
  },
  {
    title: 'After landing',
    phase: 'Ground',
    items: [
      { challenge: 'Pitot & static heat', response: 'OFF', check: (v) => v.get(M2.pitotStaticSw) === 0 },
      // M2 flows AFTER LANDING "FLAPS 0"; AFM "Flaps - UP".
      { challenge: 'Flaps', response: '0 (UP)', check: (v) => v.get(M2.flapHandle) < 0.05 && v.get(SURF.flapsDeg) < 1 },
      { challenge: 'Speed brakes', response: 'RETRACTED', check: (v) => v.get(SURF.speedbrake) < 0.02 },
      { challenge: 'Ice protection', response: 'AS REQUIRED' },
      { challenge: 'Radar', response: 'STANDBY' },
      { challenge: 'Landing lights / strobes', response: 'OFF / BEACON', check: (v) => v.get(M2.landingLt) === 0 && v.get(M2.antiColl) <= 1 },
      { challenge: 'Transponder', response: 'AS REQUIRED' },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET / WHEELS CHOCKED', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Ice protection systems (all)', response: 'OFF', check: iceOff },
      // 525AFM-06 p.3-94: "Throttles - OFF after allowing ITT to stabilize at minimum value for two minutes".
      { challenge: 'Throttles', response: 'OFF (after ITT stabilized at minimum for 2 min)', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Air conditioning & defog (cabin fan)', response: 'OFF', check: (v) => v.get(M2.airCondSw) === 0 && v.get(M2.cabinFan) === 0 },
      { challenge: 'Beacon', response: 'OFF (after N2 decays)', check: (v) => v.get(M2.antiColl) === 0 && both((i) => v.get(ENG.n2(i)) < 10) },
      { challenge: 'Exterior lights', response: 'OFF', check: extLightsOff },
      { challenge: 'Pass safety', response: 'OFF', check: (v) => v.get(M2.paxSafety) === 0 },
      { challenge: 'Cabin lights', response: 'OFF', check: (v) => v.get(M2.cabinLt) === 0 },
      { challenge: 'EMERGENCY LIGHTS switch', response: 'OFF', check: (v) => v.get(M2.emerLtsSw) === 0 },
      { challenge: 'STBY FLT DISPLAY switch', response: 'OFF', check: (v) => v.get(M2.stbyDispSw) === 0 },
      { challenge: 'DISPATCH switch', response: 'OFF', check: (v) => v.get(M2.dispatchSw) === 0 },
      // The generator switches stay at GEN (AFM); only the battery is switched off.
      { challenge: 'Battery switch', response: 'OFF', check: (v) => v.get(M2.battSw) === 0 },
      { challenge: 'Control lock', response: 'ENGAGED', check: (v) => v.get(M2.controlLock) !== 0 },
    ],
  },
  {
    // AFM Quick Turnaround (EST abbreviation): shutdown and cockpit-preparation items that are skipped between legs.
    title: 'Quick turnaround',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Battery switch', response: 'BATT', check: (v) => v.get(M2.battSw) === 1 },
      { challenge: 'Fuel quantity', response: 'CHECK / BALANCED', check: (v) => v.get('fuel.imbalance') === 0 },
      { challenge: 'Oxygen', response: 'PRESSURE CHECKED', check: (v) => v.get('oxy.main_psi') > 400 },
      { challenge: 'Takeoff data / FMS', response: 'COMPUTED / PROGRAM', check: toldSent },
      { challenge: 'Continue with', response: 'BEFORE STARTING ENGINES' },
    ],
  },
];

// ======================================================================================== EMERGENCY
export const M2_EMERGENCY: Checklist[] = [
  {
    // CJ1 memory items (Model 525) / 525AFM-06 p.3-7.
    title: 'ENGINE FAILURE OR FIRE OR MASTER WARNING DURING TAKEOFF',
    phase: 'Emergency',
    items: [
      { challenge: 'Below V1: brakes', response: 'AS REQUIRED' },
      { challenge: 'Below V1: throttles', response: 'IDLE', check: (v) => both((i) => v.get(M2.tla(i)) < 0.02) },
      { challenge: 'Below V1: speed brakes', response: 'EXTEND', check: (v) => v.get(M2.speedbrake) >= 0.5 },
      { challenge: 'Above V1: directional control', response: 'MAINTAIN' },
      { challenge: 'Above V1: rotate', response: 'VR, climb at V2' },
      { challenge: 'Landing gear (positive rate of climb)', response: 'UP', check: (v) => v.get(M2.gearHandle) < 0.5 },
      { challenge: 'At 400 ft AGL', response: 'FLAPS UP at V2 + 10 or VENR (lower), accelerate to VENR', check: (v) => v.get(SURF.flapsDeg) < 1 },
    ],
  },
  {
    // 525AFM-06 p.3-8 (M2: ignition on the GTC ENGINE page, fuel transfer on the GTC FUEL page, no ENGINE SYNC knob).
    title: 'ENGINE FAILURE / PRECAUTIONARY SHUTDOWN',
    phase: 'Emergency',
    items: [
      { challenge: 'Throttle (affected engine)', response: 'OFF', check: (v) => either((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Ignition (affected engine, GTC)', response: 'NORM', check: (v) => both((i) => v.get(M2.ignSw(i)) === 0) },
      { challenge: 'GEN switch (affected engine)', response: 'OFF', check: (v) => either((i) => v.get(M2.genSw(i)) === 0) },
      { challenge: 'Electrical load', response: 'REDUCE as required; 300 A maximum' },
      { challenge: 'Fuel transfer (GTC)', response: 'AS REQUIRED' },
      { challenge: 'ENGINE FIRE button (affected engine)', response: 'LIFT COVER and PUSH (if severe failure or fire)' },
      { challenge: 'FUEL BOOST (affected engine)', response: 'ON (if firewall shutoff not closed)' },
      { challenge: 'Land', response: 'AS SOON AS POSSIBLE (single-engine approach and landing)' },
    ],
  },
  {
    // 525AFM-06 p.3-9.
    title: 'ENGINE FAILURE DURING FINAL APPROACH',
    phase: 'Emergency',
    items: [
      { challenge: 'Thrust (operating engine)', response: 'INCREASE as required' },
      { challenge: 'Airspeed', response: 'VAPP' },
      { challenge: 'Flaps', response: 'T.O. & APPR', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Rudder trim', response: 'TOWARD operating engine as desired' },
      { challenge: 'Throttle (affected engine)', response: 'OFF', check: (v) => either((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Landing gear', response: 'DOWN and LOCKED', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: 'LAND (when landing assured)' },
      { challenge: 'Pressurization', response: 'CHECK ZERO DIFFERENTIAL', check: (v) => v.get('press.diff_psi') < 0.5 },
      { challenge: 'Autopilot and yaw damper', response: 'OFF (at or above minimums)', check: (v) => v.get('ap.engaged') === 0 && v.get('ap.yd_engaged') === 0 },
      { challenge: 'Airspeed', response: 'VREF' },
      { challenge: 'Speed brakes', response: 'RETRACTED PRIOR TO 50 FT AGL', check: (v) => v.get(SURF.speedbrake) < 0.02 },
    ],
  },
  {
    // 525AFM-06 p.3-9 ENG FIRE LH or RH (Engine Fire Warning Light Illuminated); steps 1-3 are memory items.
    title: 'ENG FIRE LH or RH',
    phase: 'Emergency',
    items: [
      { challenge: 'Throttle (affected engine)', response: 'IDLE', check: (v) => either((i) => v.get(M2.engFireLight(i)) !== 0 ? v.get(M2.tla(i)) < 0.02 : false) || either((i) => v.get(M2.engFireBtn(i)) !== 0) },
      { challenge: 'If light remains: ENGINE FIRE button (affected engine)', response: 'LIFT COVER and PUSH', check: (v) => either((i) => v.get(M2.engFireBtn(i)) !== 0) },
      { challenge: 'Either illuminated BOTTLE ARMED button', response: 'PUSH', check: (v) => v.get('fire.b1_discharged') !== 0 || v.get('fire.b2_discharged') !== 0 },
      { challenge: 'Ignition (affected engine, GTC)', response: 'NORM', check: (v) => both((i) => v.get(M2.ignSw(i)) === 0) },
      { challenge: 'Throttle (affected engine)', response: 'OFF', check: (v) => either((i) => v.get(M2.engFireBtn(i)) !== 0 && v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Electrical load', response: 'REDUCE as required; 300 A maximum' },
      { challenge: 'FUEL BOOST switch (affected engine)', response: 'OFF, then NORM' },
      { challenge: 'Land', response: 'AS SOON AS POSSIBLE' },
      { challenge: 'If fire light remains after 30 s: remaining BOTTLE ARMED button', response: 'PUSH', check: (v) => v.get('fire.b1_discharged') !== 0 && v.get('fire.b2_discharged') !== 0 },
    ],
  },
  {
    // CJ1 memory items (Model 525) "EMERGENCY RESTART - TWO ENGINES" (M2: ignition on the GTC ENGINE page).
    title: 'EMERGENCY RESTART - TWO ENGINES',
    phase: 'Emergency',
    items: [
      { challenge: 'Ignition (GTC)', response: 'BOTH ON', check: (v) => both((i) => v.get(M2.ignSw(i)) === 1) },
      { challenge: 'FUEL BOOST pumps', response: 'BOTH ON', check: (v) => both((i) => v.get(M2.boostSw(i)) === 1) },
      { challenge: 'Throttles', response: 'IDLE', check: (v) => both((i) => Math.abs(v.get(M2.tla(i)) - TLA.idle) < 0.02) },
      { challenge: 'If altitude allows', response: 'INCREASE AIRSPEED TO 240 KIAS' },
      { challenge: 'If no windmilling relight: ENGINE START button', response: 'PRESS (starter-assisted restart within the airstart envelope)' },
    ],
  },
  {
    // EST (CJ family 525AFM-06 p.3-11, text not reviewed): windmilling / starter-assisted relight of one engine.
    title: 'EMERGENCY RESTART - ONE ENGINE',
    phase: 'Emergency',
    items: [
      { challenge: 'Throttle (affected engine)', response: 'OFF', check: (v) => either((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'GEN switch (affected engine)', response: 'OFF' },
      { challenge: 'FUEL BOOST (affected engine)', response: 'ON', check: (v) => either((i) => v.get(M2.boostSw(i)) === 1) },
      { challenge: 'Ignition (affected engine, GTC)', response: 'ON', check: (v) => either((i) => v.get(M2.ignSw(i)) === 1) },
      { challenge: 'ENGINE START button (affected engine)', response: 'PRESS (below airstart envelope limits)' },
      { challenge: 'Throttle (affected engine)', response: 'IDLE at 8 % N2 minimum' },
      { challenge: 'ITT / N2', response: 'MONITOR; stable idle', check: (v) => both((i) => v.get(ENG.running(i)) !== 0) },
      { challenge: 'GEN switch / ignition / boost', response: 'GEN / NORM / NORM', check: (v) => both((i) => v.get(M2.genSw(i)) === 1 && v.get(M2.ignSw(i)) === 0 && v.get(M2.boostSw(i)) === 0) },
    ],
  },
  {
    // EST (CJ family 525AFM-06 p.3-16 "OIL PRESS L or R", text not reviewed): precautionary shutdown if confirmed.
    title: 'OIL PRESS L or R',
    phase: 'Emergency',
    items: [
      { challenge: 'Oil pressure (affected engine)', response: 'CHECK (confirm with the EIS)' },
      { challenge: 'Throttle (affected engine)', response: 'IDLE' },
      { challenge: 'If pressure below limit', response: 'ENGINE FAILURE / PRECAUTIONARY SHUTDOWN procedure' },
      { challenge: 'Land', response: 'AS SOON AS PRACTICAL' },
    ],
  },
  {
    // 525AFM-06 p.3-17 (M2: PASS OXY selector MANUAL DROP; EMER bus list per the M2 flows EMER BUS ITEMS).
    title: 'ELECTRICAL FIRE OR SMOKE',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen masks', response: 'DON and EMER', check: (v) => v.get(M2.maskOn(1)) !== 0 && v.get(M2.maskMode(1)) === 2 },
      { challenge: 'Microphone select', response: 'MIC OXY MASK' },
      { challenge: 'Smoke goggles', response: 'DON (if required)' },
      { challenge: 'PASS OXY selector', response: 'MANUAL DROP', check: (v) => v.get(M2.paxOxy) === 2 },
      { challenge: 'Passenger oxygen', response: 'MAKE SURE passengers are receiving oxygen', check: (v) => v.get('oxy.pax_on') !== 0 },
      { challenge: 'Pass safety', response: 'BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) === 2 },
      { challenge: 'Air source select', response: 'BOTH', check: (v) => v.get(M2.pressSource) === PRESS_SRC.both },
      { challenge: 'Unknown source: flood lights', response: 'FULL BRIGHT', check: (v) => v.get(M2.floodLt) >= 0.95 },
      { challenge: 'Unknown source: battery switch', response: 'EMER', check: (v) => v.get(M2.battSw) === -1 },
      { challenge: 'Unknown source: L / R GEN switches', response: 'OFF (EMER bus on the battery for at least 30 min)', check: (v) => both((i) => v.get(M2.genSw(i)) === 0) },
      { challenge: 'Pressurization', response: 'MANUAL (automatic control, dump and source selection inoperative)' },
      { challenge: 'Land', response: 'AS SOON AS POSSIBLE' },
    ],
  },
  {
    // CJ1 memory items: masks DON and EMER, MIC OXY MASK; then the source isolation (525AFM-06 p.3-20).
    title: 'ENVIRONMENTAL SMOKE OR ODOR',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen masks', response: 'DON and EMER', check: (v) => v.get(M2.maskOn(1)) !== 0 && v.get(M2.maskMode(1)) === 2 },
      { challenge: 'Microphone select', response: 'MIC OXY MASK' },
      { challenge: 'Air source select', response: 'L (check for smoke)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.l },
      { challenge: 'Air source select', response: 'R (check for smoke)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.r },
      { challenge: 'Air source select', response: 'FRESH AIR (cabin will depressurize)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.fresh },
    ],
  },
  {
    // 525AFM-06 p.3-21.
    title: 'SMOKE REMOVAL',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen masks', response: 'DON and EMER', check: (v) => v.get(M2.maskOn(1)) !== 0 && v.get(M2.maskMode(1)) === 2 },
      { challenge: 'Microphone select', response: 'MIC OXY MASK' },
      { challenge: 'Smoke goggles', response: 'DON (if required)' },
      { challenge: 'PASS OXY selector', response: 'MANUAL DROP', check: (v) => v.get(M2.paxOxy) === 2 },
      { challenge: 'Passenger oxygen', response: 'MAKE SURE passengers are receiving oxygen', check: (v) => v.get('oxy.pax_on') !== 0 },
      { challenge: 'Pass safety', response: 'BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) === 2 },
      { challenge: 'Air conditioning', response: 'OFF', check: (v) => v.get(M2.airCondSw) === 0 },
      { challenge: 'Normal DC power: CABIN DUMP', response: 'DUMP (cabin altitude ~15,000 ft max)', check: (v) => v.get(M2.cabinDump) !== 0 },
      { challenge: 'Emergency descent', response: 'AS REQUIRED' },
      { challenge: 'Land', response: 'AS SOON AS POSSIBLE' },
    ],
  },
  {
    // 525AFM-06 p.3-23: cabin altitude above 9,500 +/- 400 ft (14,500 ft high-altitude mode).
    title: 'CABIN ALT',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen masks', response: 'DON and 100 %', check: (v) => v.get(M2.maskOn(1)) !== 0 && v.get(M2.maskMode(1)) >= 1 },
      { challenge: 'Microphone select', response: 'MIC OXY MASK' },
      { challenge: 'Emergency descent', response: 'AS REQUIRED' },
      { challenge: 'Passenger oxygen', response: 'MAKE SURE passengers are receiving oxygen', check: (v) => v.get('oxy.pax_on') !== 0 },
      { challenge: 'Transponder', response: 'EMERGENCY (7700)', check: (v) => v.get('xpdr.code') === 7700 },
      { challenge: 'If not arrested by 15,000 ft cabin: AIR SOURCE SELECT', response: 'EMER', check: (v) => v.get(M2.pressSource) === PRESS_SRC.emer || v.get('press.cabin_alt_ft') < 9500 },
      { challenge: 'W/S BLEED', response: 'OFF (as required in icing conditions)' },
    ],
  },
  {
    // CJ1 memory items (Model 525): "Airplane pitch attitude - approximately 15 degrees nose down" (the CJ2 AFM
    // 525AFM-06 p.3-24 gives 20 deg); steps 5-11 from 525AFM-06 p.3-24.
    title: 'EMERGENCY DESCENT',
    phase: 'Emergency',
    items: [
      { challenge: 'AP/TRIM DISC button', response: 'PRESS and RELEASE', check: (v) => v.get('ap.engaged') === 0 },
      { challenge: 'Throttles', response: 'IDLE', check: (v) => both((i) => v.get(M2.tla(i)) < 0.02 && v.get(M2.tla(i)) > -0.05) },
      { challenge: 'Speed brakes', response: 'EXTEND', check: (v) => v.get(M2.speedbrake) >= 0.5 },
      { challenge: 'Bank', response: 'INITIATE MODERATE BANK' },
      { challenge: 'Pitch attitude', response: 'APPROXIMATELY 15 DEG NOSE DOWN' },
      { challenge: 'Airspeed', response: 'MMO / VMO' },
      { challenge: 'Transponder', response: 'EMERGENCY (7700)', check: (v) => v.get('xpdr.code') === 7700 },
      { challenge: 'Pass safety', response: 'BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) === 2 },
      { challenge: 'ATC', response: 'ADVISE, obtain local altimeter setting' },
      { challenge: 'Altitude', response: '15,000 ft MSL or MSA, whichever is higher' },
      { challenge: 'Land', response: 'AS SOON AS POSSIBLE' },
    ],
  },
  {
    // 525AFM-06 p.3-24 / 3-25 BATT O'TEMP.
    title: "BATT O'TEMP",
    phase: 'Emergency',
    items: [
      { challenge: 'Volt / amp', response: 'NOTE' },
      { challenge: 'Battery switch', response: 'EMER', check: (v) => v.get(M2.battSw) === -1 },
      { challenge: 'Volt / amp', response: 'NOTE DECREASE' },
      { challenge: 'If decrease: battery switch', response: 'OFF (voltmeter inoperative)', check: (v) => v.get(M2.battSw) === 0 },
      { challenge: "If BATT O'TEMP remains or >160 warning", response: 'LEAVE OFF, LAND AS SOON AS POSSIBLE' },
      { challenge: "If BATT O'TEMP extinguishes: battery switch", response: 'BATT' },
      { challenge: 'If no decrease (relay stuck): battery switch BATT, BATTERY DISCONNECT', response: 'LIFT GUARD and DISCONNECT (12 h maximum)', check: (v) => v.get(M2.battDisc) === 1 },
    ],
  },
  {
    // 525AFM-06 p.3-26 GEN OFF L and R (dual generator failure).
    title: 'GEN OFF L-R',
    phase: 'Emergency',
    items: [
      { challenge: 'Generators', response: 'RESET, then GEN', check: (v) => both((i) => v.get(M2.genSw(i)) === 1) },
      { challenge: 'If not restored: BATTERY switch', response: 'EMER (flight guidance incl. autopilot inoperative)', check: (v) => v.get(M2.battSw) === -1 },
      { challenge: 'Land', response: 'AS SOON AS PRACTICAL' },
    ],
  },
  {
    // 525AFM-06 p.3-28 (M2: AFCS breakers on the CB panels instead of the CJ2's IAPS / FGC).
    title: 'AUTOPILOT MALFUNCTION',
    phase: 'Emergency',
    items: [
      { challenge: 'AP/TRIM DISC button', response: 'PRESS and RELEASE', check: (v) => v.get('ap.engaged') === 0 },
      { challenge: 'Autopilot circuit breakers', response: 'PULL (if required)' },
    ],
  },
  {
    // 525AFM-06 p.3-28.
    title: 'ELECTRIC ELEVATOR TRIM RUNAWAY',
    phase: 'Emergency',
    items: [
      { challenge: 'AP/TRIM DISC button', response: 'PRESS and RELEASE', check: (v) => v.get('ap.engaged') === 0 },
      { challenge: 'Throttles', response: 'AS REQUIRED' },
      { challenge: 'Speed brakes', response: 'AS REQUIRED' },
      { challenge: 'Manual elevator trim (trim wheel)', response: 'AS REQUIRED' },
      { challenge: 'PITCH TRIM circuit breaker (LH panel)', response: 'PULL', check: (v) => v.get('cb.trim_pitch') === 0 },
    ],
  },
  {
    // 525AFM-06 p.3-28 / CJ1 memory items.
    title: 'EMERGENCY EVACUATION',
    phase: 'Emergency',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Throttles', response: 'BOTH OFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'L / R ENGINE FIRE buttons', response: 'BOTH PRESS', check: (v) => both((i) => v.get(M2.engFireBtn(i)) !== 0) },
      { challenge: 'Illuminated BOTTLE ARMED buttons', response: 'BOTH PRESS (if fire suspected)' },
      { challenge: 'Battery switch', response: 'OFF', check: (v) => v.get(M2.battSw) === 0 },
      { challenge: 'ELT', response: 'MAKE SURE ACTIVATED (if required)' },
      { challenge: 'Airplane and area', response: 'CHECK FOR BEST ESCAPE ROUTE' },
      { challenge: 'Cabin door or emergency exit', response: 'OPEN; move away from the airplane', check: (v) => v.get(M2.doorOpen('cabin')) !== 0 || v.get(M2.doorOpen('emer_exit')) !== 0 },
    ],
  },
];

// ======================================================================================== ABNORMAL
export const M2_ABNORMAL: Checklist[] = [
  {
    title: 'FUEL TRANSFER',
    phase: 'Abnormal',
    items: [
      // CJ AFM limitations 525FM-15 p.2-11 / 525AFM-06 p.3-113: no transfer with the receiving tank's boost pump on.
      { challenge: 'FUEL BOOST switch (receiving side)', response: 'OFF', check: (v) => (v.get(M2.fuelXfer) === 1 ? v.get(M2.boostSw(2)) : v.get(M2.boostSw(1))) === -1 },
      // The arrow points to the receiving tank: R TANK moves fuel left -> right (525AFM-06 p.3-113).
      { challenge: 'FUEL TRANSFER (GTC)', response: 'SELECT (arrow toward the light tank)', check: (v) => v.get(M2.fuelXfer) !== 0 },
      { challenge: 'Fuel balance', response: 'MONITOR; TRANSFER OFF, BOOST NORM when balanced' },
    ],
  },
  {
    // EST (CJ family abnormal procedures; S&D15 §7: free fall after the uplock release, pneumatic blow-down backup).
    title: 'LANDING GEAR EMERGENCY EXTENSION',
    phase: 'Abnormal',
    items: [
      { challenge: 'Airspeed', response: '186 KIAS maximum (VLO)' },
      { challenge: 'Gear handle', response: 'DOWN', check: (v) => v.get(M2.gearHandle) >= 0.5 },
      { challenge: 'EMERGENCY GEAR RELEASE T-handle', response: 'PULL (gear free falls)', check: (v) => v.get(M2.gearEmerRelease) !== 0 },
      { challenge: 'If not 3 green: gear BLOW DOWN', response: 'PULL (gear cannot be retracted afterwards)', check: (v) => v.get(M2.gearBlowdown) !== 0 || v.get('gear.down_locked') !== 0 },
      { challenge: 'Landing gear', response: '3 GREEN', check: (v) => v.get('gear.down_locked') !== 0 },
    ],
  },
  {
    // EST (CJ family: open-center main hydraulics power the gear, flaps and speed brakes, S&D15 §9.3).
    title: 'HYDRAULIC FAILURE (HYD PRESS LOW)',
    phase: 'Abnormal',
    items: [
      { challenge: 'Landing gear', response: 'EMERGENCY EXTENSION procedure' },
      { challenge: 'Flaps / speed brakes', response: 'INOPERATIVE (no-flap landing distance, FPG)' },
      { challenge: 'Airspeed', response: 'VREF for the flap setting' },
      { challenge: 'Brakes', response: 'NORMAL (independent electric brake system) or EMERGENCY BRAKE' },
    ],
  },
  {
    // EST (CJ family): anti-skid inoperative -> brake with care, emergency brake has no anti-skid.
    title: 'ANTISKID INOP',
    phase: 'Abnormal',
    items: [
      { challenge: 'ANTI-SKID switch', response: 'OFF, then ON (self test)' },
      { challenge: 'If INOP remains: ANTI-SKID switch', response: 'OFF', check: (v) => v.get(M2.antiskidSw) === 0 },
      { challenge: 'Landing distance', response: 'INCREASE per FPG (anti-skid inoperative)' },
      { challenge: 'Brakes', response: 'APPLY with care (no anti-skid protection)' },
    ],
  },
  {
    // EST (CJ family 525AFM-06 abnormal "Single-Engine Approach and Landing").
    title: 'SINGLE-ENGINE APPROACH AND LANDING',
    phase: 'Abnormal',
    items: [
      { challenge: 'Fuel transfer (GTC)', response: 'AS REQUIRED (balance < 200 lb)' },
      { challenge: 'Flaps', response: 'T.O. & APPR', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Landing gear', response: 'DOWN (when landing assured)', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: 'LAND (when landing assured)' },
      { challenge: 'Airspeed', response: 'VREF' },
      { challenge: 'Autopilot and yaw damper', response: 'OFF (by minimums)', check: (v) => v.get('ap.engaged') === 0 && v.get('ap.yd_engaged') === 0 },
    ],
  },
];

/** Every list in the order the G3000 electronic checklist shows them (normal, emergency, abnormal). */
export const M2_CHECKLISTS: Checklist[] = [...M2_NORMAL, ...M2_EMERGENCY, ...M2_ABNORMAL];

/** CAS message id -> checklist title (the G3000 M2 CAS links to its electronic checklist). */
export const M2_CAS_CHECKLIST: Record<string, string> = {
  cabin_alt: 'CABIN ALT',
  batt_otemp: "BATT O'TEMP",
  batt_otemp160: "BATT O'TEMP",
  gen_off_lr: 'GEN OFF L-R',
  fuel_imbal: 'FUEL TRANSFER',
  antiskid_inop: 'ANTISKID INOP',
  hyd_press_low: 'HYDRAULIC FAILURE (HYD PRESS LOW)',
  gear_unsafe: 'LANDING GEAR EMERGENCY EXTENSION',
  pitch_trim: 'ELECTRIC ELEVATOR TRIM RUNAWAY',
  ap_fail: 'AUTOPILOT MALFUNCTION',
};
