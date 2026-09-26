/**
 * Citation M2 normal checklists (abbreviated, CJ-family single-pilot flow;
 * sequence per the dossier §10 which cites the S&D / FPG and marks EST items).
 * Items with `check` are ticked live from the systems vars.
 */
import type { Checklist } from '../types';
import { SURF, ENG } from '../../core/vars';
import { M2, TLA } from './vars';

type V = Parameters<NonNullable<Checklist['items'][number]['check']>>[0];
const both = (f: (i: number) => boolean) => f(1) && f(2);

export const M2_CHECKLISTS: Checklist[] = [
  {
    title: 'Cockpit preparation',
    phase: 'Ground',
    items: [
      { challenge: 'Control lock', response: 'REMOVED', check: (v: V) => v.get(M2.controlLock) === 0 },
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Throttles', response: 'CUTOFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Gear handle', response: 'DOWN', check: (v) => v.get(M2.gearHandle) >= 0.5 },
      { challenge: 'Circuit breakers', response: 'IN' },
      { challenge: 'Emergency gear release / blow down', response: 'STOWED', check: (v) => v.get(M2.gearEmerRelease) === 0 && v.get(M2.gearBlowdown) === 0 },
      { challenge: 'Oxygen', response: 'CHECK PRESSURE / PASS OXY NORM', check: (v) => v.get(M2.paxOxy) === 1 },
      { challenge: 'Battery', response: 'BATT (volts 24 V min)', check: (v) => v.get(M2.battSw) === 1 && v.get('elec.batt_v') >= 24 },
      { challenge: 'Fire warning test', response: 'CHECK (SYSTEM TEST: FIRE WARN)' },
      { challenge: 'Annunciator test', response: 'CHECK (SYSTEM TEST: ANNU)' },
      { challenge: 'Fuel quantity', response: 'CHECK' },
    ],
  },
  {
    title: 'Before starting engines',
    phase: 'Ground',
    items: [
      { challenge: 'Cabin door', response: 'CLOSED AND LOCKED', check: (v) => v.get(M2.doorOpen('cabin')) === 0 },
      { challenge: 'Avionics', response: 'ON (DISPATCH for flight planning)', check: (v) => v.get(M2.avionicsSw) !== 0 },
      { challenge: 'Generators', response: 'GEN', check: (v) => both((i) => v.get(M2.genSw(i)) === 1) },
      { challenge: 'Boost pumps', response: 'NORM', check: (v) => both((i) => v.get(M2.boostSw(i)) === 0) },
      { challenge: 'Ignition', response: 'NORM', check: (v) => both((i) => v.get(M2.ignSw(i)) === 0) },
      { challenge: 'Beacon', response: 'ON', check: (v) => v.get(M2.antiColl) >= 1 },
      { challenge: 'Pass safety', response: 'BELT & NO SMOKE', check: (v) => v.get(M2.paxSafety) === 2 },
    ],
  },
  {
    title: 'Starting engines',
    phase: 'Ground',
    items: [
      { challenge: 'R ENGINE START button', response: 'PRESS (START R annunciated)' },
      { challenge: 'R throttle', response: 'IDLE at 8-10 % N2', check: (v) => v.get(M2.tla(2)) >= TLA.idle - 0.01 },
      { challenge: 'R ITT / N2', response: 'MONITOR; stable idle', check: (v) => v.get(ENG.running(2)) !== 0 },
      { challenge: 'L ENGINE START button', response: 'PRESS' },
      { challenge: 'L throttle', response: 'IDLE at 8-10 % N2', check: (v) => v.get(M2.tla(1)) >= TLA.idle - 0.01 },
      { challenge: 'L ITT / N2', response: 'MONITOR; stable idle', check: (v) => v.get(ENG.running(1)) !== 0 },
      { challenge: 'Generators', response: 'ON LINE (no GEN OFF)', check: (v) => v.get('elec.sg1_online') !== 0 && v.get('elec.sg2_online') !== 0 },
      { challenge: 'Oil pressure', response: 'CHECK', check: (v) => both((i) => v.get(ENG.oilPressPsi(i)) >= 23) },
    ],
  },
  {
    title: 'Before taxi',
    phase: 'Ground',
    items: [
      { challenge: 'Flaps', response: '15', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Trim', response: 'SET FOR TAKEOFF', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
      { challenge: 'Press source', response: 'NORM', check: (v) => v.get(M2.pressSource) === 3 },
      { challenge: 'Anti-skid', response: 'ON', check: (v) => v.get(M2.antiskidSw) !== 0 },
      { challenge: 'Avionics / FMS / TOLD', response: 'SET' },
      { challenge: 'Nav / taxi lights', response: 'ON', check: (v) => v.get(M2.navLt) !== 0 },
    ],
  },
  {
    title: 'Before takeoff',
    phase: 'Takeoff',
    items: [
      { challenge: 'Flaps', response: '15 (or 0)', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 || v.get(SURF.flapsDeg) < 1 },
      { challenge: 'Speed brakes', response: 'RETRACTED', check: (v) => v.get(SURF.speedbrake) < 0.02 },
      { challenge: 'Trim', response: 'TAKEOFF (3 axes)', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
      { challenge: 'Pitot & static heat', response: 'ON', check: (v) => v.get(M2.pitotStaticSw) !== 0 },
      { challenge: 'Anti-ice', response: 'AS REQUIRED' },
      { challenge: 'Transponder', response: 'ALT', check: (v) => v.get('xpdr.mode') >= 3 },
      { challenge: 'Landing / anti-coll lights', response: 'ON', check: (v) => v.get(M2.landingLt) >= 1 && v.get(M2.antiColl) === 2 },
      { challenge: 'CAS', response: 'CHECKED', check: (v) => v.get('cas.warning_count') === 0 },
      { challenge: 'Parking brake', response: 'RELEASED', check: (v) => v.get(M2.parkBrake) === 0 },
    ],
  },
  {
    title: 'Takeoff / climb',
    phase: 'Takeoff',
    items: [
      { challenge: 'Throttles', response: 'TO detent', check: (v) => both((i) => v.get(M2.tla(i)) > 0.98) },
      { challenge: 'Rotate at VR, gear', response: 'UP (positive rate)', check: (v) => v.get(M2.gearHandle) < 0.5 },
      { challenge: 'Flaps', response: 'UP (V2 + 10 min)', check: (v) => v.get(SURF.flapsDeg) < 1 },
      { challenge: 'Throttles', response: 'CLB detent', check: (v) => both((i) => Math.abs(v.get(M2.tla(i)) - TLA.clb) < 0.03) },
      { challenge: 'Yaw damper / autopilot', response: 'AS REQUIRED' },
      { challenge: 'Pressurization', response: 'CHECK', check: (v) => v.get('press.cabin_alt_warn') === 0 },
    ],
  },
  {
    title: 'Cruise',
    phase: 'Cruise',
    items: [
      { challenge: 'Throttles', response: 'CRU detent', check: (v) => both((i) => Math.abs(v.get(M2.tla(i)) - TLA.cru) < 0.03) },
      { challenge: 'Fuel balance', response: 'CHECK (< 200 lb)', check: (v) => v.get('fuel.imbalance') === 0 },
      { challenge: 'Ice protection', response: 'AS REQUIRED (TAT +10 degC or below in visible moisture)' },
    ],
  },
  {
    title: 'Descent / approach',
    phase: 'Landing',
    items: [
      { challenge: 'Landing field elevation', response: 'SET (GTC)' },
      { challenge: 'Altimeters', response: 'SET', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 },
      { challenge: 'Approach / minimums / VREF', response: 'SET' },
      { challenge: 'Pass safety', response: 'BELT', check: (v) => v.get(M2.paxSafety) >= 1 },
      { challenge: 'Flaps', response: '15 (below 200 KIAS)', check: (v) => v.get(SURF.flapsDeg) > 14 },
    ],
  },
  {
    title: 'Before landing',
    phase: 'Landing',
    items: [
      { challenge: 'Landing gear', response: 'DOWN, 3 GREEN', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: '35 (below 161 KIAS)', check: (v) => v.get(SURF.flapsDeg) > 34 },
      { challenge: 'Speed brakes', response: 'RETRACTED', check: (v) => v.get(SURF.speedbrake) < 0.02 },
      { challenge: 'Autopilot', response: 'DISCONNECT by minimums', check: (v) => v.get('ap.engaged') === 0 },
      { challenge: 'Landing lights', response: 'ON', check: (v) => v.get(M2.landingLt) >= 1 },
    ],
  },
  {
    title: 'After landing',
    phase: 'Ground',
    items: [
      { challenge: 'Throttles', response: 'IDLE', check: (v) => both((i) => v.get(M2.tla(i)) < 0.02) },
      { challenge: 'Ground flaps', response: 'AS REQUIRED, then 0-15' },
      { challenge: 'Speed brakes', response: 'RETRACT', check: (v) => v.get(M2.speedbrake) === 0 },
      { challenge: 'Pitot & static / anti-ice', response: 'OFF', check: (v) => v.get(M2.pitotStaticSw) === 0 },
      { challenge: 'Landing / anti-coll lights', response: 'OFF / BEACON', check: (v) => v.get(M2.landingLt) === 0 },
      { challenge: 'Transponder', response: 'AS REQUIRED' },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Avionics', response: 'OFF', check: (v) => v.get(M2.avionicsSw) === 0 },
      { challenge: 'Throttles', response: 'CUTOFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Exterior lights', response: 'OFF', check: (v) => v.get(M2.navLt) === 0 && v.get(M2.antiColl) === 0 },
      { challenge: 'Generators / battery', response: 'OFF', check: (v) => v.get(M2.battSw) === 0 },
      { challenge: 'Control lock', response: 'ENGAGED', check: (v) => v.get(M2.controlLock) !== 0 },
    ],
  },
];
