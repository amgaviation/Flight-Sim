/**
 * G800 normal checklists (electronic checklist on the Epic ECL windows and the
 * app checklist viewer). Item wording follows the published Gulfstream
 * challenge/response style (C450 G450-family AFM normal procedures:
 * "ELECTRIC POWER CONTROL Panel ... SET", "START MASTER ... ON", "SVO/IGN ...
 * OUT AT APPROXIMATELY 44% HP", "BCN ... ON", "Power Levers ... IDLE") adapted to
 * the Symmetry flight deck (overhead touch pages, FSB) and the G800 systems
 * modelled here. Closed-loop items carry `check` functions (autosensing).
 * Fix round 1 (layout audit): hardware names of the G700/G800 flight deck -
 * BATTERIES MAIN / FCS and EMERGENCY POWER on the forward overhead strip, the
 * AutoStart ("FUEL CONTROL ... RUN", "ENGINE START ... PRESS", code450 G700/G800
 * powerplant study sheets), PEDAL STEER, WARN INHIBIT (code450 G700 taxi checklist),
 * HUD combiner, and AUTOBRAKE / ground spoilers selected on the TSC (code450
 * G700/G800 landing gear: autobrake "selected via TSC 1-4").
 * SCOPE: abbreviated to the items the simulation models; not the AFM text.
 */
import type { Checklist } from '../types';
import type { SimVars } from '../../core/SimVars';
import { G800_VARS as V, AUTOBRAKE } from './vars';

const on = (name: string) => (v: SimVars) => v.get(name) === 1;
const off = (name: string) => (v: SimVars) => v.get(name) === 0;
const bothRunning = (v: SimVars) => v.get('eng1.running') !== 0 && v.get('eng2.running') !== 0;

export const G800_CHECKLISTS: Checklist[] = [
  {
    title: 'Before Starting Engines',
    phase: 'Ground',
    items: [
      { challenge: 'Parking Brake', response: 'SET', check: (v) => v.get('brakes.parking_set') !== 0 },
      { challenge: 'BATTERIES MAIN L / R', response: 'ON', check: (v) => v.get(V.battL) === 1 && v.get(V.battR) === 1 },
      { challenge: 'BATTERIES FCS EBHA / UPS', response: 'ON', check: (v) => v.get(V.fcsBattEbha) === 1 && v.get(V.fcsBattUps) === 1 },
      { challenge: 'Battery voltage', response: '20 V MINIMUM', check: (v) => v.get('elec.batt_l_v') >= 20 && v.get('elec.batt_r_v') >= 20 },
      { challenge: 'APU', response: 'START / AVAILABLE', check: (v) => v.get('apu.avail') !== 0 },
      { challenge: 'APU GEN', response: 'ON LINE', check: (v) => v.get('elec.apu_gen_online') !== 0 },
      { challenge: 'EMERGENCY POWER', response: 'ARM', check: on(V.emerPwr) },
      { challenge: 'Fire detection', response: 'TESTED' },
      { challenge: 'IRSs', response: 'ALIGNED', check: (v) => v.get('ahrs1.valid') !== 0 && v.get('ahrs2.valid') !== 0 && v.get('ahrs3.valid') !== 0 },
      { challenge: 'FMS', response: 'INITIALIZED / FLIGHT PLAN LOADED' },
      { challenge: 'APU BLEED', response: 'ON', check: on(V.bleedApu) },
      { challenge: 'L / R BOOST pumps', response: 'AUTO', check: (v) => v.get(V.boostL) >= 1 && v.get(V.boostR) >= 1 },
      { challenge: 'Power levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05 },
      { challenge: 'L / R FUEL CONTROL', response: 'OFF', check: (v) => v.get(V.runL) === 0 && v.get(V.runR) === 0 },
      { challenge: 'BEACON', response: 'ON', check: on(V.ltBeacon) },
    ],
  },
  {
    title: 'Engine Start',
    phase: 'Ground',
    items: [
      { challenge: 'Bleed pressure', response: '28 PSI MINIMUM', check: (v) => v.get('pneu.l_man_psi') >= 28 || bothRunning(v) },
      { challenge: 'R FUEL CONTROL', response: 'RUN', check: on(V.runR) },
      { challenge: 'ENGINE START', response: 'PRESS (AUTOSTART)' },
      { challenge: 'SVO / IGN', response: 'OUT AT APPROX 42 % HP', check: (v) => v.get('eng2.running') !== 0 && v.get('eng2.starter') === 0 },
      { challenge: 'R oil pressure / hydraulic pressure', response: 'CHECK', check: (v) => v.get('eng2.oil_press_psi') > 35 && v.get('hyd.right_psi') > 2800 },
      { challenge: 'L FUEL CONTROL', response: 'RUN', check: on(V.runL) },
      { challenge: 'ENGINE START', response: 'PRESS (AUTOSTART)' },
      { challenge: 'L oil pressure / hydraulic pressure', response: 'CHECK', check: (v) => v.get('eng1.oil_press_psi') > 35 && v.get('hyd.left_psi') > 2800 },
      { challenge: 'L / R GEN', response: 'ON LINE', check: (v) => v.get('elec.idg1_online') !== 0 && v.get('elec.idg2_online') !== 0 },
    ],
  },
  {
    title: 'Before Taxi',
    phase: 'Ground',
    items: [
      { challenge: 'APU GEN / APU', response: 'AS REQUIRED' },
      { challenge: 'L / R ENG BLEED', response: 'ON', check: (v) => v.get(V.bleedL) === 1 && v.get(V.bleedR) === 1 },
      { challenge: 'L / R PACK', response: 'ON', check: (v) => v.get(V.packL) === 1 && v.get(V.packR) === 1 },
      { challenge: 'Flight controls', response: 'CHECKED / FCS NORMAL', check: (v) => v.get('fbw.mode_code') === 0 },
      { challenge: 'Flaps', response: '10 OR 20', check: (v) => v.get(V.flapLever) === 1 || v.get(V.flapLever) === 2 },
      { challenge: 'NOSEWHEEL STEERING / PEDAL STEER', response: 'ON', check: (v) => v.get(V.nwsSw) === 1 && v.get(V.pedalSteer) === 1 },
      { challenge: 'GROUND SPOILERS (TSC)', response: 'ARMED', check: on(V.gndSplrArm) },
      { challenge: 'HUD combiner', response: 'DEPLOY FOR USE / CHECK', check: (v) => v.get(V.hudStow) === 1 },
      { challenge: 'TAXI light', response: 'ON', check: on(V.ltTaxi) },
    ],
  },
  {
    title: 'Before Takeoff',
    phase: 'Takeoff',
    items: [
      { challenge: 'TRS / V-speeds', response: 'TO / SET' },
      { challenge: 'Flaps', response: '10 OR 20', check: (v) => { const f = v.get('surf.flaps_deg'); return (f > 9 && f < 11) || (f > 19 && f < 21); } },
      { challenge: 'Stabilizer trim', response: 'GREEN BAND', check: (v) => { const t = v.get('trim.pitch_units'); return t >= -0.2 && t <= 0.35; } },
      { challenge: 'Speed brake', response: 'RETRACTED', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'AUTOBRAKE (TSC)', response: 'RTO', check: (v) => v.get(V.autobrake) === AUTOBRAKE.RTO },
      { challenge: 'WARN INHIBIT', response: 'INHIBIT', check: on(V.warnInhibit) },
      { challenge: 'Anti-ice', response: 'AS REQUIRED' },
      { challenge: 'STROBE / LANDING lights', response: 'ON', check: (v) => v.get(V.ltStrobe) === 1 && v.get(V.ltLandingL) === 1 && v.get(V.ltLandingR) === 1 },
      { challenge: 'CAS', response: 'CHECKED', check: (v) => v.get('cas.warning_count') === 0 && v.get('cas.caution_count') === 0 },
      { challenge: 'Parking brake', response: 'RELEASED', check: (v) => v.get('brakes.parking_set') === 0 },
    ],
  },
  {
    title: 'After Takeoff / Climb',
    phase: 'Climb',
    items: [
      { challenge: 'Landing gear', response: 'UP', check: (v) => v.get('gear.up_locked') !== 0 },
      { challenge: 'Flaps', response: 'UP', check: (v) => v.get('surf.flaps_deg') < 0.5 },
      { challenge: 'AUTOBRAKE (TSC)', response: 'OFF', check: (v) => v.get(V.autobrake) === AUTOBRAKE.OFF },
      { challenge: 'WARN INHIBIT', response: 'OFF', check: off(V.warnInhibit) },
      { challenge: 'TRS', response: 'CLB', check: (v) => v.getString('fadec.rating') === 'CLB' },
      { challenge: 'Pressurization', response: 'CHECKED', check: (v) => v.get('press.cabin_alt_warn') === 0 },
      { challenge: 'LANDING lights', response: 'OFF ABOVE 10,000 FT' },
    ],
  },
  {
    title: 'Descent / Approach',
    phase: 'Approach',
    items: [
      { challenge: 'Landing elevation', response: 'SET / CHECKED' },
      { challenge: 'Altimeters', response: 'SET', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 || v.get('adc1.baro_std') !== 0 },
      { challenge: 'Approach / minimums', response: 'SET' },
      { challenge: 'AUTOBRAKE (TSC)', response: 'AS REQUIRED' },
      { challenge: 'GROUND SPOILERS (TSC)', response: 'ARMED', check: on(V.gndSplrArm) },
    ],
  },
  {
    title: 'Before Landing',
    phase: 'Landing',
    items: [
      { challenge: 'Landing gear', response: 'DOWN, THREE GREEN', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: '39', check: (v) => v.get('surf.flaps_deg') > 38 },
      { challenge: 'Speed brake', response: 'RETRACTED', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'LANDING lights', response: 'ON', check: (v) => v.get(V.ltLandingL) === 1 && v.get(V.ltLandingR) === 1 },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get('brakes.parking_set') !== 0 },
      { challenge: 'L / R FUEL CONTROL', response: 'OFF', check: (v) => v.get(V.runL) === 0 && v.get(V.runR) === 0 },
      { challenge: 'BEACON / exterior lights', response: 'OFF', check: (v) => v.get(V.ltBeacon) === 0 && v.get(V.ltStrobe) === 0 },
      { challenge: 'APU', response: 'OFF', check: off(V.apuMaster) },
      { challenge: 'EMERGENCY POWER', response: 'OFF', check: off(V.emerPwr) },
      { challenge: 'BATTERIES FCS EBHA / UPS', response: 'OFF', check: (v) => v.get(V.fcsBattEbha) === 0 && v.get(V.fcsBattUps) === 0 },
      { challenge: 'BATTERIES MAIN L / R', response: 'OFF', check: (v) => v.get(V.battL) === 0 && v.get(V.battR) === 0 },
    ],
  },
];
