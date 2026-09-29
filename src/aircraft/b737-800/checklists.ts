/**
 * Boeing 737-800 normal checklists (the Boeing 737NG QRH "Normal Checklists"
 * sequence: BEFORE START, BEFORE TAXI, BEFORE TAKEOFF, AFTER TAKEOFF,
 * DESCENT, APPROACH, LANDING, SHUTDOWN, SECURE). Items carry live checks
 * against the cockpit vars where the response is a switch state.
 */
import type { Checklist } from '../types';
import { B738, FUEL_PUMPS, WINDOW_HEATS, SPEEDBRAKE, ENG_START } from './vars';

const both = (f: (i: 1 | 2) => boolean): boolean => f(1) && f(2);

export const B738_CHECKLISTS: Checklist[] = [
  {
    title: 'BEFORE START',
    phase: 'Ground',
    items: [
      { challenge: 'Flight deck door', response: 'Closed and locked', check: (v) => v.get(B738.door('flt_deck')) === 0 },
      { challenge: 'Fuel', response: '___ KGS, PUMPS ON', check: (v) => FUEL_PUMPS.filter((p) => !p.startsWith('c_')).every((p) => v.get(B738.fuelPump(p)) !== 0) },
      { challenge: 'Passenger signs', response: 'SET', check: (v) => v.get(B738.noSmoking) >= 1 && v.get(B738.fastenBelts) >= 1 },
      { challenge: 'Windows', response: 'Locked' },
      { challenge: 'MCP', response: 'V2 ___, HDG ___, ALT ___', check: (v) => v.get('ap.sel_spd_kt') > 100 },
      { challenge: 'Takeoff speeds', response: 'V1 ___, VR ___, V2 ___', check: (v) => v.get('ac.fmc.v1_kt') > 0 },
      { challenge: 'CDU preflight', response: 'Completed', check: (v) => v.get('ac.fmc.perf_valid') !== 0 },
      { challenge: 'Rudder and aileron trim', response: 'Free and 0', check: (v) => Math.abs(v.get('trim.yaw_units')) < 0.5 && Math.abs(v.get('trim.roll_units')) < 0.5 },
      { challenge: 'Taxi and takeoff briefing', response: 'Completed' },
      { challenge: 'ANTI COLLISION light', response: 'ON', check: (v) => v.get(B738.antiColl) !== 0 },
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
      { challenge: 'Recall', response: 'Checked', check: (v) => v.get(B738.lt.masterCaution) === 0 },
      { challenge: 'Autobrake', response: 'RTO', check: (v) => v.get(B738.autobrake) === -1 },
      { challenge: 'Engine start levers', response: 'IDLE detent', check: (v) => both((i) => v.get(B738.startLever(i)) >= 0.5) },
      { challenge: 'Flight controls', response: 'Checked' },
      { challenge: 'Ground equipment', response: 'Clear', check: (v) => v.get(B738.gpuConnected) === 0 },
    ],
  },
  {
    title: 'BEFORE TAKEOFF',
    phase: 'Takeoff',
    items: [
      { challenge: 'Flaps', response: '___, green light', check: (v) => v.get('surf.flaps_deg') >= 0.9 && v.get('surf.flaps_deg') <= 25.5 && v.get(B738.lt.leFlapsExt) !== 0 },
      { challenge: 'Stabilizer trim', response: '___ units', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
      { challenge: 'Speed brake', response: 'DOWN detent', check: (v) => v.get(B738.speedbrake) < SPEEDBRAKE.armed * 0.5 },
      { challenge: 'Transponder', response: 'TA/RA', check: (v) => v.get('xpdr.mode') === 5 },
      { challenge: 'Landing lights', response: 'ON', check: (v) => v.get(B738.landingFixed(1)) !== 0 && v.get(B738.landingFixed(2)) !== 0 },
      { challenge: 'Parking brake', response: 'Released', check: (v) => v.get('brakes.parking_set') === 0 },
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
      { challenge: 'Recall', response: 'Checked', check: (v) => v.get(B738.lt.masterCaution) === 0 },
      { challenge: 'Autobrake', response: '___', check: (v) => v.get(B738.autobrake) >= 1 },
      { challenge: 'Landing data', response: 'VREF ___, minimums ___', check: (v) => v.get('ac.fmc.vref_kt') > 0 },
      { challenge: 'Approach briefing', response: 'Completed' },
    ],
  },
  {
    title: 'APPROACH',
    phase: 'Approach',
    items: [{ challenge: 'Altimeters', response: '___', check: (v) => v.get('adc1.baro_std') === 0 && Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 }],
  },
  {
    title: 'LANDING',
    phase: 'Landing',
    items: [
      { challenge: 'ENGINE START switches', response: 'CONT', check: (v) => both((i) => v.get(B738.engStart(i)) === ENG_START.cont) },
      { challenge: 'Speed brake', response: 'ARMED', check: (v) => Math.abs(v.get(B738.speedbrake) - SPEEDBRAKE.armed) < 0.03 && v.get(B738.lt.speedbrakeArmed) !== 0 },
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
      { challenge: 'Parking brake', response: 'Set', check: (v) => v.get('brakes.parking_set') !== 0 },
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
];
