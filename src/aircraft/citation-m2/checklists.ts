/**
 * Citation M2 normal checklists (abbreviated, CJ-family single-pilot flow;
 * sequence per the dossier §10 which cites the S&D / FPG and marks EST items).
 * Items with `check` are ticked live from the systems vars.
 */
import type { Checklist } from '../types';
import { SURF, ENG } from '../../core/vars';
import { M2, PRESS_SRC, TLA } from './vars';

type V = Parameters<NonNullable<Checklist['items'][number]['check']>>[0];
const both = (f: (i: number) => boolean) => f(1) && f(2);

export const M2_CHECKLISTS: Checklist[] = [
  {
    title: 'Cockpit preparation',
    phase: 'Ground',
    items: [
      { challenge: 'Control lock', response: 'REMOVED', check: (v: V) => v.get(M2.controlLock) === 0 },
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get(M2.parkBrake) !== 0 },
      { challenge: 'Throttles', response: 'OFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Gear handle', response: 'DOWN', check: (v) => v.get(M2.gearHandle) >= 0.5 },
      { challenge: 'Circuit breakers', response: 'IN' },
      { challenge: 'Emergency gear release / blow down', response: 'STOWED', check: (v) => v.get(M2.gearEmerRelease) === 0 && v.get(M2.gearBlowdown) === 0 },
      { challenge: 'Oxygen', response: 'CHECK PRESSURE / PASS OXY NORM', check: (v) => v.get(M2.paxOxy) === 1 },
      // AFM preliminary cockpit inspection 6-8 / M2 flows: battery disconnect check (CAE differences p.5-23).
      { challenge: 'Battery disconnect switch', response: 'BATT DISC', check: (v) => v.get(M2.battDisc) === 1 },
      { challenge: 'Battery switch', response: 'BATT (no voltage indication)', check: (v) => v.get(M2.battSw) === 1 && v.get('elec.batt_bus_v') < 5 },
      { challenge: 'Battery disconnect switch', response: 'NORM (24 volts minimum)', check: (v) => v.get(M2.battDisc) === 0 && v.get(M2.battSw) === 1 && v.get('elec.batt_v') >= 24 },
      { challenge: 'STBY FLT DISPLAY switch', response: 'TEST / ON', check: (v) => v.get(M2.stbyDispSw) >= 1 },
      // CJ-family AFM cockpit inspection (BATTERY EMER check) / M2 flows EMER BUS ITEMS: PFD 1 in reversion (AHRS 2,
      // ADC 2, GPS 1), left GTC (COM 1, NAV 1, XPDR 1), audio, AFCS control panel, flood lights, gear lights.
      { challenge: 'Battery switch', response: 'EMER (check emergency bus items)', check: (v) => v.get('elec.emer_powered') !== 0 && v.get('elec.pfd1_powered') !== 0 && v.get('elec.avn1_powered') === 0 },
      { challenge: 'Battery switch', response: 'BATT', check: (v) => v.get(M2.battSw) === 1 },
      { challenge: 'EMER LIGHTS switch', response: 'ARMED', check: (v) => v.get(M2.emerLtsSw) === 1 },
      { challenge: 'System tests (GTC)', response: 'FIRE WARN - CHECKED' },
      { challenge: 'System tests (GTC)', response: 'ANNU - CHECKED' },
      { challenge: 'Fuel quantity', response: 'CHECK' },
    ],
  },
  {
    title: 'Before starting engines',
    phase: 'Ground',
    items: [
      { challenge: 'Cabin door', response: 'CLOSED AND LOCKED', check: (v) => v.get(M2.doorOpen('cabin')) === 0 },
      // No avionics switch (AOPA Mar 2014): the BATTERY switch powers the avionics; DISPATCH (GTC 1 + MFD on the aux
      // battery) is only for ground comm / flight planning before the battery is on.
      { challenge: 'DISPATCH switch', response: 'OFF', check: (v) => v.get(M2.dispatchSw) === 0 },
      { challenge: 'Avionics', response: 'ON (battery BATT)', check: (v) => v.get('elec.pfd1_powered') !== 0 && v.get('elec.mfd_powered') !== 0 && v.get('elec.pfd2_powered') !== 0 },
      { challenge: 'Generators', response: 'GEN', check: (v) => both((i) => v.get(M2.genSw(i)) === 1) },
      { challenge: 'Boost pumps', response: 'NORM', check: (v) => both((i) => v.get(M2.boostSw(i)) === 0) },
      // 525AFM-06 p.3-88 Starting Engines step 6 checks these extinguish after the start.
      { challenge: 'CAS', response: 'GEN OFF / OIL PRESS / FUEL LOW PRESS / HYD FLOW LOW displayed', check: (v) => v.get('cas.gen_off_l_stop') + v.get('cas.gen_off_r_stop') > 0 },
      { challenge: 'Ignition (GTC ENGINE page)', response: 'NORM', check: (v) => both((i) => v.get(M2.ignSw(i)) === 0) },
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
      // 525AFM-06 p.3-88 step 6: "Fuel, Oil, Generator and Hydraulic Annunciators - EXTINGUISHED".
      {
        challenge: 'Fuel, oil, generator, hydraulic annunciations',
        response: 'EXTINGUISHED',
        check: (v) => ['gen_off', 'oil_press', 'fuel_press_low', 'hyd_flow_low'].every((m) => ['l', 'r'].every((s) => v.get(`cas.${m}_${s}`) === 0 && v.get(`cas.${m}_${s}_stop`) === 0)),
      },
      { challenge: 'Oil pressure', response: 'CHECK', check: (v) => both((i) => v.get(ENG.oilPressPsi(i)) >= 23) },
    ],
  },
  {
    title: 'Before taxi',
    phase: 'Ground',
    items: [
      // 525AFM-06 p.3-89.1 Before Taxi 6: electric trim check.
      { challenge: 'Electric elevator trim', response: 'CHECK: each half alone no trim; AP/TRIM DISC stops trim; pilot overrides copilot' },
      // 525AFM-06 p.3-89.1 Before Taxi 7: flap / speed brake check.
      { challenge: 'GROUND FLAPS', response: 'SELECT: both speed brakes deploy', check: (v) => v.get(M2.flapHandle) >= 2.9 && v.get(SURF.speedbrake) > 0.95 },
      { challenge: 'Throttles > 85 % N2', response: 'speed brakes RETRACT, FLAPS >35 displayed; IDLE: speed brakes redeploy' },
      { challenge: 'Flaps', response: 'T.O. & APPR: speed brakes retract' },
      // 525AFM-06 p.3-90: anti-skid self test completed while stationary.
      { challenge: 'Anti-skid', response: 'ON, ANTISKID INOP out', check: (v) => v.get(M2.antiskidSw) !== 0 && v.get('cas.antiskid_inop') === 0 },
      { challenge: 'Flaps', response: '15', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Trim', response: 'SET FOR TAKEOFF', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
      { challenge: 'Air source select', response: 'BOTH', check: (v) => v.get(M2.pressSource) === PRESS_SRC.both },
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
      // 525AFM-06 p.3-91 / M2 flows ICE PROTECTION CHECKS (N2 > 75 % / 70 %): WING/ENG ANTI-ICE ON; ENGINE and WING
      // ANTI-ICE COLD L-R displayed then clear within 60 s; TAIL DE-ICE ON, no TAIL DE-ICE FAIL.
      { challenge: 'Ice protection check (if icing expected)', response: 'WING/ENG and TAIL: COLD displayed then clear' },
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
      { challenge: 'Throttles', response: 'OFF', check: (v) => both((i) => v.get(M2.tla(i)) < -0.05) },
      { challenge: 'Exterior lights', response: 'OFF', check: (v) => v.get(M2.navLt) === 0 && v.get(M2.antiColl) === 0 },
      { challenge: 'STBY FLT DISPLAY switch', response: 'OFF', check: (v) => v.get(M2.stbyDispSw) === 0 },
      { challenge: 'EMERGENCY LIGHTS switch', response: 'OFF', check: (v) => v.get(M2.emerLtsSw) === 0 },
      { challenge: 'Generators / battery', response: 'OFF', check: (v) => v.get(M2.battSw) === 0 },
      { challenge: 'Control lock', response: 'ENGAGED', check: (v) => v.get(M2.controlLock) !== 0 },
    ],
  },
  // ------------------------------------------------------------------ abnormal (EST, CJ-family AFM wording)
  {
    title: 'ENGINE FIRE',
    phase: 'Abnormal',
    items: [
      { challenge: 'Throttle (affected engine)', response: 'OFF' },
      // 525AFM-06 p.3-9 step 2.
      { challenge: 'ENGINE FIRE button (affected engine)', response: 'LIFT COVER and PUSH', check: (v) => v.get(M2.engFireBtn(1)) !== 0 || v.get(M2.engFireBtn(2)) !== 0 },
      { challenge: 'BOTTLE ARMED light (either)', response: 'PUSH' },
      { challenge: 'FUEL BOOST switch (affected engine)', response: 'OFF, then NORM' },
    ],
  },
  {
    // 525AFM-06 "Electric Elevator Trim Runaway" (CJ-family memory item: AUTOPILOT/TRIM DISENGAGE BUTTON - PRESS).
    title: 'ELECTRIC ELEVATOR TRIM RUNAWAY',
    phase: 'Abnormal',
    items: [
      { challenge: 'AP/TRIM DISC button', response: 'PRESS AND HOLD', check: (v) => v.get(M2.apTrimDisc(1)) !== 0 || v.get(M2.apTrimDisc(2)) !== 0 },
      { challenge: 'Elevator trim', response: 'TRIM MANUALLY (trim wheel)' },
      { challenge: 'PITCH TRIM circuit breaker (LH panel)', response: 'PULL', check: (v) => v.get('cb.trim_pitch') === 0 },
      { challenge: 'AP/TRIM DISC button', response: 'RELEASE' },
    ],
  },
  {
    // 525AFM-06 p.3-26 GEN OFF L AND R (dual generator failure).
    title: 'GEN OFF L-R',
    phase: 'Abnormal',
    items: [
      { challenge: 'Generators', response: 'RESET, then GEN', check: (v) => both((i) => v.get(M2.genSw(i)) === 1) },
      { challenge: 'If not restored: BATTERY switch', response: 'EMER (flight guidance incl. autopilot inoperative)', check: (v) => v.get(M2.battSw) === -1 },
      { challenge: 'Land', response: 'AS SOON AS PRACTICAL' },
    ],
  },
  {
    title: 'ENVIRONMENTAL SMOKE OR ODOR',
    phase: 'Abnormal',
    items: [
      { challenge: 'Oxygen masks', response: 'DON, 100 %', check: (v) => v.get(M2.maskOn(1)) !== 0 && v.get(M2.maskMode(1)) >= 1 },
      { challenge: 'Air source select', response: 'L (check for smoke)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.l },
      { challenge: 'Air source select', response: 'R (check for smoke)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.r },
      { challenge: 'Air source select', response: 'FRESH AIR (cabin will depressurize)', check: (v) => v.get(M2.pressSource) === PRESS_SRC.fresh },
    ],
  },
  {
    title: 'FUEL TRANSFER',
    phase: 'Abnormal',
    items: [
      // CJ AFM limitations 525FM-15 p.2-11: boost pump OFF on the side receiving fuel.
      // CJ AFM limitations 525FM-15 p.2-11 / 525AFM-06 p.3-113: no transfer with the receiving tank's boost pump on.
      { challenge: 'FUEL BOOST switch (receiving side)', response: 'OFF', check: (v) => (v.get(M2.fuelXfer) === 1 ? v.get(M2.boostSw(2)) : v.get(M2.boostSw(1))) === -1 },
      // The arrow points to the receiving tank: R TANK moves fuel left -> right (525AFM-06 p.3-113).
      { challenge: 'FUEL TRANSFER', response: 'SELECT (arrow toward the light tank)', check: (v) => v.get(M2.fuelXfer) !== 0 },
      { challenge: 'Fuel balance', response: 'MONITOR; TRANSFER OFF, BOOST NORM when balanced' },
    ],
  },
];
