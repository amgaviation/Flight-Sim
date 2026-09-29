/**
 * Boeing 737-800 checklists.
 *
 * Normal checklists: the Boeing 737NG Normal Checklist sequence — PREFLIGHT,
 * BEFORE START, BEFORE TAXI, BEFORE TAKEOFF, AFTER TAKEOFF, DESCENT, APPROACH,
 * LANDING, SHUTDOWN, SECURE. Wording follows the published Boeing card
 * (aviationhunt.com "Boeing 737 Normal Checklists"; cross-checked against the
 * public November-2017 737 NC card, which prints the same items). Items carry
 * live checks against the cockpit vars where the response is a switch state.
 *
 * Non-normal checklists: the key QRH procedures the simulation models
 * (dossier §8.1), with wording condensed from the Boeing 737 QRH
 * D6-27370-804 (public training copy). Their checks read the same failure /
 * system vars the systems publish, so an item reads "done" once the fault is
 * resolved or the action is in place.
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { B738, FUEL_PUMPS, WINDOW_HEATS, SPEEDBRAKE, ENG_START } from './vars';
import { B737_VARS } from '../../avionics/boeing-737/vars';

type Vars = SimContext['vars'];
const both = (f: (i: 1 | 2) => boolean): boolean => f(1) && f(2);
/** Smallest signed angle difference (deg). */
const hdgDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
/** True when every engine currently showing a fire warning satisfies `f` (memory-item checks scope to the affected engine). */
const affectedEng = (v: Vars, f: (i: 1 | 2) => boolean): boolean => both((i) => v.get(`fire.eng${i}_warn`) === 0 || f(i));
/** Hydraulic system low (LOSS OF SYSTEM A/B condition). */
const hydLow = (v: Vars, sys: 'a' | 'b'): boolean => v.get(`hyd.${sys}_psi`, 3000) < 1000;

export const B738_CHECKLISTS: Checklist[] = [
  {
    // Boeing NC PREFLIGHT (aviationhunt.com; 2017 card: OXYGEN / NAV & INSTR TRANS SWITCHES / WINDOW HEAT /
    // PRESSURIZATION MODE SELECTOR / FLIGHT INSTRUMENTS / PARKING BRAKE / ENG START LEVERS).
    title: 'PREFLIGHT',
    phase: 'Ground',
    items: [
      // Tested = mask RESET/TEST flow check (momentary, not latched); the check verifies bottle pressure and both
      // regulators at 100 % (diluter selector in the stowed 100 % position). EST threshold 500 psi (min dispatch band).
      { challenge: 'Oxygen', response: 'Tested, 100%', check: (v) => v.get('oxy.crew_psi', 0) > 500 && both((i) => v.get(B738.oxyDiluter(i)) === 0) },
      // All five transfer selectors on the instrument transfer panel in NORMAL / AUTO.
      {
        challenge: 'Navigation transfer and display switches',
        response: 'NORMAL, AUTO',
        check: (v) =>
          v.get(B737_VARS.displaysSource) === 0 && v.get(B737_VARS.controlPanelSel) === 0 && v.get(B737_VARS.vhfNavSel) === 0 && v.get(B737_VARS.irsSel) === 0 && v.get(B737_VARS.fmcSel) === 0,
      },
      { challenge: 'Window heat', response: 'ON', check: (v) => WINDOW_HEATS.every((w) => v.get(B738.windowHeat(w)) !== 0) },
      { challenge: 'Pressurization mode selector', response: 'AUTO', check: (v) => v.get(B738.pressMode) === 0 },
      // Cross-check: both compasses agree and both altimeters set to QNH.
      {
        challenge: 'Flight instruments',
        response: 'Heading ___, altimeter ___',
        check: (v) =>
          hdgDiff(v.get('ahrs1.hdg_mag_deg', 0), v.get('ahrs2.hdg_mag_deg', 0)) < 3 &&
          both((i) => v.get(`adc${i}.baro_std`) === 0 && Math.abs(v.get(`adc${i}.baro_inhg`, 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02),
      },
      { challenge: 'Parking brake', response: 'Set', check: (v) => v.get('brakes.parking_set') !== 0 },
      { challenge: 'Engine start levers', response: 'CUTOFF', check: (v) => both((i) => v.get(B738.startLever(i)) < 0.5) },
    ],
  },
  {
    title: 'BEFORE START',
    phase: 'Ground',
    items: [
      { challenge: 'Flight deck door', response: 'Closed and locked', check: (v) => v.get(B738.door('flt_deck')) === 0 },
      // Pumps corresponding to the fuel load: mains always; centre pumps ON with > 1,000 lb (453 kg) in the
      // centre tank (FCOM NP, same rule as states.ts).
      {
        challenge: 'Fuel',
        response: '___ KGS, PUMPS ON',
        check: (v) => FUEL_PUMPS.every((p) => (p.startsWith('c_') && v.get('fuel.tank2_kg', 0) <= 453 ? true : v.get(B738.fuelPump(p)) !== 0)),
      },
      { challenge: 'Passenger signs', response: 'ON', check: (v) => v.get(B738.noSmoking) >= 1 && v.get(B738.fastenBelts) >= 1 }, // 2017 NC card: "PASSENGER SIGNS ... ON"
      { challenge: 'Windows', response: 'Locked', check: (v) => both((i) => v.get(B738.windowCrank(i)) === 0) },
      { challenge: 'MCP', response: 'V2 ___, HDG ___, ALT ___', check: (v) => v.get('ap.sel_spd_kt') > 100 },
      { challenge: 'Takeoff speeds', response: 'V1 ___, VR ___, V2 ___', check: (v) => v.get('ac.fmc.v1_kt') > 0 },
      { challenge: 'CDU preflight', response: 'Completed', check: (v) => v.get('ac.fmc.perf_valid') !== 0 },
      { challenge: 'Rudder and aileron trim', response: 'Free and 0', check: (v) => Math.abs(v.get('trim.yaw_units')) < 0.5 && Math.abs(v.get('trim.roll_units')) < 0.5 },
      { challenge: 'Taxi and takeoff briefing', response: 'Completed' },
      { challenge: 'Anti collision lights', response: 'ON', check: (v) => v.get(B738.antiColl) !== 0 }, // plural per the Boeing card
    ],
  },
  {
    title: 'BEFORE TAXI',
    phase: 'Ground',
    items: [
      { challenge: 'Generators', response: 'On', check: (v) => v.get(B738.xfrSrc(1)) === 1 && v.get(B738.xfrSrc(2)) === 1 },
      { challenge: 'Probe heat', response: 'On', check: (v) => v.get(B738.probeHeat('a')) !== 0 && v.get(B738.probeHeat('b')) !== 0 },
      { challenge: 'Anti-ice', response: 'As required' },
      { challenge: 'Isolation valve', response: 'AUTO', check: (v) => v.get(B738.isoValve) === 1 },
      { challenge: 'ENGINE START switches', response: 'CONT', check: (v) => both((i) => v.get(B738.engStart(i)) === ENG_START.cont) },
      // Recall = push the six-pack and verify no annunciation remains: a cancelled master caution with the fault
      // still latched is not a clean recall, so the check also requires no caution condition to be active.
      { challenge: 'Recall', response: 'Checked', check: (v) => v.get(B738.lt.masterCaution) === 0 && v.get('cas.caution_count', 0) === 0 },
      { challenge: 'Autobrake', response: 'RTO', check: (v) => v.get(B738.autobrake) === -1 },
      { challenge: 'Engine start levers', response: 'IDLE detent', check: (v) => both((i) => v.get(B738.startLever(i)) >= 0.5) },
      { challenge: 'Flight controls', response: 'Checked' },
      { challenge: 'Ground equipment', response: 'Clear', check: (v) => v.get(B738.gpuConnected) === 0 },
    ],
  },
  {
    // Exactly two items on the Boeing card (aviationhunt.com; 2017 card agrees). Transponder, lights, speedbrake
    // and parking brake are flow items, not checklist items; the takeoff preset sets them (states.ts).
    title: 'BEFORE TAKEOFF',
    phase: 'Takeoff',
    items: [
      { challenge: 'Flaps', response: '___, green light', check: (v) => v.get('surf.flaps_deg') >= 0.9 && v.get('surf.flaps_deg') <= 25.5 && v.get(B738.lt.leFlapsExt) !== 0 },
      { challenge: 'Stabilizer trim', response: '___ units', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
    ],
  },
  {
    title: 'AFTER TAKEOFF',
    phase: 'Climb',
    items: [
      { challenge: 'Engine bleeds', response: 'On', check: (v) => both((i) => v.get(B738.bleed(i)) !== 0) },
      { challenge: 'Packs', response: 'AUTO', check: (v) => both((i) => v.get(B738.pack(i)) === 1) },
      { challenge: 'Landing gear', response: 'UP and OFF', check: (v) => v.get(B738.gearLever) === 0.5 && v.get('gear.up_locked') !== 0 },
      { challenge: 'Flaps', response: 'UP, no lights', check: (v) => v.get('surf.flaps_deg') < 0.1 && v.get(B738.lt.leFlapsTransit) === 0 && v.get(B738.lt.leFlapsExt) === 0 },
    ],
  },
  {
    title: 'DESCENT',
    phase: 'Descent',
    items: [
      { challenge: 'Pressurization', response: 'LAND ALT ___', check: (v) => v.get(B738.landAltFt) > -1000 },
      { challenge: 'Recall', response: 'Checked', check: (v) => v.get(B738.lt.masterCaution) === 0 && v.get('cas.caution_count', 0) === 0 },
      { challenge: 'Autobrake', response: '___', check: (v) => v.get(B738.autobrake) >= 1 },
      { challenge: 'Landing data', response: 'VREF ___, minimums ___', check: (v) => v.get('ac.fmc.vref_kt') > 0 },
      { challenge: 'Approach briefing', response: 'Completed' },
    ],
  },
  {
    // Cross-check of both pilots' altimeters (the item exists to catch a mis-set side).
    title: 'APPROACH',
    phase: 'Approach',
    items: [
      {
        challenge: 'Altimeters',
        response: '___',
        check: (v) => both((i) => v.get(`adc${i}.baro_std`) === 0 && Math.abs(v.get(`adc${i}.baro_inhg`, 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02),
      },
    ],
  },
  {
    title: 'LANDING',
    phase: 'Landing',
    items: [
      { challenge: 'ENGINE START switches', response: 'CONT', check: (v) => both((i) => v.get(B738.engStart(i)) === ENG_START.cont) },
      { challenge: 'Speedbrake', response: 'ARMED', check: (v) => Math.abs(v.get(B738.speedbrake) - SPEEDBRAKE.armed) < 0.03 && v.get(B738.lt.speedbrakeArmed) !== 0 }, // one word per the Boeing card
      { challenge: 'Landing gear', response: 'Down', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: '___, green light', check: (v) => v.get('surf.flaps_deg') >= 29.5 && v.get(B738.lt.leFlapsExt) !== 0 },
    ],
  },
  {
    title: 'SHUTDOWN',
    phase: 'Ground',
    items: [
      { challenge: 'Fuel pumps', response: 'Off', check: (v) => FUEL_PUMPS.every((p) => v.get(B738.fuelPump(p)) === 0) },
      { challenge: 'Probe heat', response: 'Off', check: (v) => v.get(B738.probeHeat('a')) === 0 && v.get(B738.probeHeat('b')) === 0 },
      { challenge: 'Hydraulic panel', response: 'Set', check: (v) => v.get(B738.hydPump('elec1')) === 0 && v.get(B738.hydPump('elec2')) === 0 },
      { challenge: 'Flaps', response: 'UP', check: (v) => v.get('surf.flaps_deg') < 0.1 },
      // 2017 NC card: "RELEASED / SET TO PARK" — with chocks in place the brake is normally released to cool,
      // so either state is correct and there is no auto-check (no chock model to condition on).
      { challenge: 'Parking brake', response: 'Released / Set to park' },
      { challenge: 'Engine start levers', response: 'CUTOFF', check: (v) => both((i) => v.get(B738.startLever(i)) < 0.5) },
      { challenge: 'Weather radar', response: 'Off', check: (v) => v.get('wxr.active') === 0 }, // WXR deselected on both EFIS panels
    ],
  },
  {
    title: 'SECURE',
    phase: 'Ground',
    items: [
      { challenge: 'IRSs', response: 'OFF', check: (v) => v.get('ac.irs1_mode') === 0 && v.get('ac.irs2_mode') === 0 },
      { challenge: 'Emergency exit lights', response: 'OFF', check: (v) => v.get(B738.emerExitLt) === 0 },
      { challenge: 'Window heat', response: 'Off', check: (v) => WINDOW_HEATS.every((w) => v.get(B738.windowHeat(w)) === 0) },
      { challenge: 'Packs', response: 'OFF', check: (v) => both((i) => v.get(B738.pack(i)) === 0) },
    ],
  },

  // ================================================================ QRH non-normal checklists (D6-27370-804)
  {
    // QRH 8.2. Steps 1-4 are memory items; checks scope to engines with an active fire warning.
    title: 'ENGINE FIRE or Engine Severe Damage or Separation',
    phase: 'Non-normal',
    items: [
      { challenge: 'Autothrottle (if engaged)', response: 'Disengage', check: (v) => v.get('fire.eng1_warn') === 0 && v.get('fire.eng2_warn') === 0 ? true : v.get('ap.at_engaged', 0) === 0 },
      { challenge: 'Thrust lever (affected engine)', response: 'Confirm ... Close', check: (v) => affectedEng(v, (i) => v.get(B738.tla(i)) < 0.05) },
      { challenge: 'Engine start lever (affected engine)', response: 'Confirm ... CUTOFF', check: (v) => affectedEng(v, (i) => v.get(B738.startLever(i)) < 0.5) },
      { challenge: 'Engine fire switch (affected engine)', response: 'Confirm ... Pull', check: (v) => affectedEng(v, (i) => v.get(B738.fireHandle(i)) !== 0) },
      { challenge: 'If the fire switch or ENG OVERHEAT light stays illuminated: fire switch', response: 'Rotate to the stop, hold 1 second' },
      { challenge: 'If still illuminated after 30 seconds: fire switch', response: 'Rotate to the other stop, hold 1 second' },
      { challenge: 'ISOLATION VALVE switch', response: 'CLOSE', check: (v) => v.get('fire.eng1_warn') === 0 && v.get('fire.eng2_warn') === 0 ? true : v.get(B738.isoValve) === 0 },
      { challenge: 'PACK switch (affected side)', response: 'OFF', check: (v) => affectedEng(v, (i) => v.get(B738.pack(i)) === 0) },
      { challenge: 'APU BLEED air switch', response: 'OFF', check: (v) => v.get('fire.eng1_warn') === 0 && v.get('fire.eng2_warn') === 0 ? true : v.get(B738.apuBleed) === 0 },
      { challenge: 'Plan to land at the nearest suitable airport', response: '' },
    ],
  },
  {
    // QRH 2.1 CABIN ALTITUDE WARNING or Rapid Depressurization (memory items). Checks apply while the warning is active.
    title: 'CABIN ALTITUDE WARNING or Rapid Depressurization',
    phase: 'Non-normal',
    items: [
      { challenge: 'Oxygen masks', response: 'Don, 100%', check: (v) => v.get('press.cabin_alt_warn') === 0 || both((i) => v.get(B738.oxyMask(i)) !== 0) },
      { challenge: 'Crew communications', response: 'Establish' },
      { challenge: 'Pressurization mode selector', response: 'MAN', check: (v) => v.get('press.cabin_alt_warn') === 0 || v.get(B738.pressMode) === 2 },
      { challenge: 'Outflow VALVE switch', response: 'Hold in CLOSE until the valve indicates fully closed' },
      { challenge: 'If cabin altitude is not controllable: passenger signs', response: 'ON' },
      { challenge: 'If cabin altitude exceeds 14,000 ft: PASS OXYGEN switch', response: 'ON', check: (v) => v.get('press.cabin_alt_ft', 0) < 14000 || v.get(B738.passOxy) !== 0 || v.get('press.pax_masks', 0) !== 0 },
      { challenge: 'If cabin altitude is not controllable', response: 'Emergency Descent checklist' },
    ],
  },
  {
    // QRH 2.7: resetting FLT ALT to the actual altitude restores the schedule and extinguishes the light (logic.ts).
    title: 'OFF SCHED DESCENT',
    phase: 'Non-normal',
    items: [
      { challenge: 'Landing at airport of departure', response: 'Continue normal operation' },
      { challenge: 'Not landing at airport of departure: FLT ALT indicator', response: 'Reset to actual airplane altitude', check: (v) => v.get('ac.b738.off_sched_descent', 0) === 0 },
    ],
  },
  {
    // QRH 6.1 DRIVE (generator drive malfunction; single IDG loss).
    title: 'DRIVE',
    phase: 'Non-normal',
    items: [
      { challenge: 'Generator drive DISCONNECT switch (affected side)', response: 'Confirm ... Hold in DISCONNECT momentarily' },
      { challenge: 'APU (if available)', response: 'START', check: (v) => (v.get(B738.lt.drive(1)) === 0 && v.get(B738.lt.drive(2)) === 0) || v.get('apu.running', 0) !== 0 },
      // Both transfer buses back on a selected source (SOURCE OFF condition is xfrSrc 0 / 4, cas.ts).
      { challenge: 'When APU is running: APU GEN switch (affected side)', response: 'ON', check: (v) => both((i) => v.get(B738.xfrSrc(i)) !== 0 && v.get(B738.xfrSrc(i)) !== 4) },
    ],
  },
  {
    // QRH 6.2 LOSS OF BOTH ENGINE DRIVEN GENERATORS (SOURCE OFF / TRANSFER BUS OFF / GEN OFF BUS both sides).
    title: 'Loss of Both Engine Driven Generators',
    phase: 'Non-normal',
    items: [
      { challenge: 'Engine GEN switches (both)', response: 'ON, one at a time' },
      { challenge: 'YAW DAMPER switch', response: 'ON', check: (v) => v.get(B738.ydSw) !== 0 },
      { challenge: 'APU (if available; not above 25,000 ft)', response: 'START' },
      { challenge: 'When APU is running: APU GEN switches (both)', response: 'ON, one at a time', check: (v) => both((i) => v.get(B738.xfrSrc(i)) !== 0 && v.get(B738.xfrSrc(i)) !== 4) },
    ],
  },
  {
    // QRH 13.2 LOSS OF SYSTEM A. Checks apply while system A pressure is low.
    title: 'Loss of System A',
    phase: 'Non-normal',
    items: [
      { challenge: 'System A FLT CONTROL switch', response: 'Confirm ... STBY RUD', check: (v) => !hydLow(v, 'a') || v.get(B738.fltCtl('a')) === -1 },
      { challenge: 'System A HYD PUMP switches (both)', response: 'OFF', check: (v) => !hydLow(v, 'a') || (v.get(B738.hydPump('eng1')) === 0 && v.get(B738.hydPump('elec2')) === 0) },
      { challenge: 'NOSE WHEEL STEERING switch', response: 'ALT', check: (v) => !hydLow(v, 'a') || v.get(B738.nwsSw) === 0 },
      { challenge: 'Plan for manual gear extension', response: '' },
      { challenge: 'Deferred: Landing data', response: 'VREF ___, Minimums ___' },
    ],
  },
  {
    // QRH 13.4 LOSS OF SYSTEM B. Checks apply while system B pressure is low.
    title: 'Loss of System B',
    phase: 'Non-normal',
    items: [
      { challenge: 'System B FLT CONTROL switch', response: 'Confirm ... STBY RUD', check: (v) => !hydLow(v, 'b') || v.get(B738.fltCtl('b')) === -1 },
      { challenge: 'System B HYD PUMP switches (both)', response: 'OFF', check: (v) => !hydLow(v, 'b') || (v.get(B738.hydPump('elec1')) === 0 && v.get(B738.hydPump('eng2')) === 0) },
      { challenge: 'Plan a flaps 15 landing', response: 'Set VREF 15' },
      { challenge: 'Do not arm the autobrake; use manual braking', response: '', check: (v) => !hydLow(v, 'b') || v.get(B738.autobrake) <= 0 },
      { challenge: 'Deferred: ALTERNATE FLAPS master switch', response: 'ARM (extend flaps 15 electrically, 230K max)' },
      { challenge: 'Deferred: GROUND PROXIMITY FLAP INHIBIT switch', response: 'FLAP INHIBIT', check: (v) => !hydLow(v, 'b') || v.get(B738.gpwsFlapInh) !== 0 },
    ],
  },
  {
    // QRH 2.5 BLEED TRIP OFF (engine bleed air overheat / overpressure).
    title: 'BLEED TRIP OFF',
    phase: 'Non-normal',
    items: [
      { challenge: 'TRIP RESET switch', response: 'Push' },
      { challenge: 'BLEED TRIP OFF light stays illuminated: PACK switch (affected side)', response: 'OFF', check: (v) => both((i) => v.get(B738.lt.bleedTripOff(i)) === 0 || v.get(B738.pack(i)) === 0) },
      { challenge: 'Avoid icing conditions', response: '' },
    ],
  },
  {
    // QRH 2.8 PACK (pack trip / pack control failure).
    title: 'PACK',
    phase: 'Non-normal',
    items: [
      { challenge: 'Temperature selectors (all)', response: 'Select warmer temperature' },
      { challenge: 'TRIP RESET switch', response: 'Push' },
      { challenge: 'PACK light stays illuminated: PACK switch (affected side)', response: 'OFF', check: (v) => both((i) => v.get(B738.lt.packTrip(i)) === 0 || v.get(B738.pack(i)) === 0) },
    ],
  },
];
