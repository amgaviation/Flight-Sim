/**
 * Bombardier Global 6000 checklists (normal flows and a set of non-normal
 * procedures), with live auto-checks against the system vars. Wording
 * follows the Bombardier challenge / response style; the item sequence is
 * EST from the Global Express training manuals' system descriptions (the
 * AFM / QRH checklists are proprietary). Shown by the app checklist viewer
 * and the Collins Fusion electronic checklist (FSB: "ECL linked to selected
 * CAS messages").
 */
import type { Checklist } from '../types';
import { SURF } from '../../core/vars';
import { G6K_LIMITS } from './data';
import { G6K_VARS as V } from './vars';

type Vars = Parameters<NonNullable<Checklist['items'][number]['check']>>[0];
const on = (name: string) => (v: Vars) => v.get(name) === 1;
const off = (name: string) => (v: Vars) => v.get(name) === 0;
const is = (name: string, x: number) => (v: Vars) => Math.abs(v.get(name) - x) < 0.01;
const both = (f: (i: 1 | 2) => string, x: number) => (v: Vars) => v.get(f(1)) === x && v.get(f(2)) === x;
const trimInBand = (v: Vars) => v.get('trim.pitch_units') >= G6K_LIMITS.stabGreenBand[0] && v.get('trim.pitch_units') <= G6K_LIMITS.stabGreenBand[1];

export const G6K_CHECKLISTS: Checklist[] = [
  {
    title: 'COCKPIT PREPARATION',
    phase: 'Preflight',
    items: [
      { challenge: 'BATT MASTER', response: 'ON', check: on(V.battMaster) },
      { challenge: 'DC EMER / BATT / DC ESS buses', response: 'POWERED', check: (v) => v.get('elec.dc_ess_powered') !== 0 && v.get('elec.dc_emer_powered') !== 0 },
      { challenge: 'EMER LIGHTS', response: 'ARM', check: is(V.emerLights, 1) },
      { challenge: 'PARK/EMER BRAKE', response: 'SET', check: (v) => v.get(V.parkSet) !== 0 },
      { challenge: 'Gear handle', response: 'DN', check: on(V.gearHandle) },
      { challenge: 'ENG RUN switches', response: 'OFF', check: both(V.engRun, 0) },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
      { challenge: 'FIRE handles', response: 'IN', check: (v) => v.get(V.fireHandle('l')) === 0 && v.get(V.fireHandle('r')) === 0 && v.get(V.fireHandle('apu')) === 0 },
      { challenge: 'EMS CDU FIRE TEST', response: 'COMPLETE' },
      { challenge: 'APU', response: 'START, AVAIL', check: (v) => v.get('apu.avail') !== 0 },
      { challenge: 'APU GEN', response: 'ON LINE', check: (v) => v.get('elec.apu_gen_online') !== 0 },
      { challenge: 'IRS 1 / 2 / 3', response: 'NAV', check: (v) => v.get(V.irsMode(1)) === 2 && v.get(V.irsMode(2)) === 2 && v.get(V.irsMode(3)) === 2 },
      { challenge: 'HYD pumps 1B / 2B / 3B', response: 'AUTO', check: (v) => v.get(V.hydPump('1b')) === 1 && v.get(V.hydPump('2b')) === 1 && v.get(V.hydPump('3b')) === 1 },
      { challenge: 'HYD pump 3A', response: 'ON', check: is(V.hydPump('3a'), 2) },
      { challenge: 'FUEL panel', response: 'NORMAL (no lights), XFEED closed', check: (v) => v.get(V.xfeed) === 0 && v.get(V.priPumps('l')) === 1 && v.get(V.priPumps('r')) === 1 && v.get(V.auxPump('l')) === 1 && v.get(V.auxPump('r')) === 1 },
      { challenge: 'STALL PUSHER switches', response: 'ON', check: both(V.pusher, 1) },
      { challenge: 'WINDSHIELD HEAT', response: 'ON', check: (v) => v.get(V.wshldL) === 1 && v.get(V.wshldR) === 1 },
      { challenge: 'Pressurization', response: 'AUTO, LDG ELEV FMS', check: (v) => v.get(V.pressAutoMan) === 0 && v.get(V.ldgElevFms) === 1 },
      { challenge: 'FMS', response: 'PROGRAMMED (TOLD entered)' },
    ],
  },
  {
    title: 'BEFORE START',
    phase: 'Ground',
    items: [
      { challenge: 'Doors', response: 'CLOSED', check: (v) => v.get(V.door('pax')) === 0 && v.get(V.door('bag')) === 0 && v.get(V.door('emer')) === 0 },
      { challenge: 'BEACON', response: 'ON', check: on(V.ltBeacon) },
      { challenge: 'NAV lights', response: 'ON', check: on(V.ltNav) },
      { challenge: 'PASS SIGNS', response: 'AUTO', check: (v) => v.get(V.seatBelts) >= 1 },
      { challenge: 'APU BLEED', response: 'AUTO / OPEN', check: (v) => v.get(V.apuBleed) >= 1 },
      { challenge: 'XBLEED', response: 'AUTO', check: is(V.xbleed, 1) },
      { challenge: 'PARK/EMER BRAKE', response: 'SET', check: (v) => v.get(V.parkSet) !== 0 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
    ],
  },
  {
    title: 'ENGINE START',
    phase: 'Ground',
    items: [
      { challenge: 'Duct pressure', response: 'CHECK (APU bleed)', check: (v) => v.get('pneu.l_duct_psi') > 25 },
      { challenge: 'R ENG RUN', response: 'RUN', check: on(V.engRun(2)) },
      { challenge: 'R START', response: 'PUSH, start monitored', check: (v) => v.get('eng2.running') !== 0 },
      { challenge: 'L ENG RUN', response: 'RUN', check: on(V.engRun(1)) },
      { challenge: 'L START', response: 'PUSH, start monitored', check: (v) => v.get('eng1.running') !== 0 },
      { challenge: 'N2 / ITT / oil pressure', response: 'STABILISED', check: (v) => v.get('eng1.n2_pct') > G6K_LIMITS.n2IdleMinPct && v.get('eng2.n2_pct') > G6K_LIMITS.n2IdleMinPct },
      { challenge: 'GEN 1 - 4', response: 'ON LINE', check: (v) => [1, 2, 3, 4].every((n) => v.get(`elec.gen${n}_online`) !== 0) },
    ],
  },
  {
    title: 'AFTER START',
    phase: 'Ground',
    items: [
      { challenge: 'APU BLEED', response: 'AS REQUIRED' },
      { challenge: 'APU', response: 'OFF (or as required)' },
      { challenge: 'HYD pressures', response: 'CHECK', check: (v) => v.get('hyd.sys1_psi') > 2800 && v.get('hyd.sys2_psi') > 2800 && v.get('hyd.sys3_psi') > 2800 },
      { challenge: 'CAS', response: 'CHECKED' },
      { challenge: 'NOSE STEER', response: 'ARMED', check: on(V.nwsArm) },
      { challenge: 'Slats / flaps', response: '6 (or 16)', check: (v) => v.get(V.flapLever) === 2 || v.get(V.flapLever) === 3 },
      { challenge: 'Stab trim', response: 'SET (green band)', check: trimInBand },
    ],
  },
  {
    title: 'BEFORE TAKEOFF',
    phase: 'Takeoff',
    items: [
      { challenge: 'Slats / flaps', response: '6 (or 16)', check: (v) => (v.get(V.flapLever) === 2 || v.get(V.flapLever) === 3) && Math.abs(v.get(SURF.flapsDeg) - (v.get(V.flapLever) === 2 ? 6 : 16)) < 1 },
      { challenge: 'Trims (STAB / AIL / RUD)', response: 'SET', check: (v) => trimInBand(v) && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0 },
      { challenge: 'FLIGHT SPOILER lever', response: 'RETRACT', check: (v) => v.get(V.flightSpoiler) < 0.05 },
      { challenge: 'GND LIFT DUMPING', response: 'NORMAL (not OFF)', check: off(V.gldOff) },
      { challenge: 'Transponder', response: 'TA/RA' },
      { challenge: 'STROBE / landing lights', response: 'ON', check: (v) => v.get(V.ltStrobe) === 1 && v.get(V.ltLdgL) === 1 && v.get(V.ltLdgR) === 1 },
      { challenge: 'PARK/EMER BRAKE', response: 'RELEASED', check: (v) => v.get(V.parkBrake) < 0.05 },
      { challenge: 'CAS', response: 'NO CONFIG messages', check: (v) => v.get(V.noTakeoff) === 0 },
    ],
  },
  {
    title: 'AFTER TAKEOFF',
    phase: 'Climb',
    items: [
      { challenge: 'Gear', response: 'UP', check: (v) => v.get(V.gearHandle) === 0 && v.get('gear.up_locked') !== 0 },
      { challenge: 'Slats / flaps', response: '0 IN', check: (v) => v.get(V.flapLever) === 0 && v.get(SURF.flapsDeg) < 0.5 && v.get(SURF.slats) < 0.05 },
      { challenge: 'Autothrottle / thrust', response: 'CLB', check: (v) => v.getString('fadec.rating') === 'CLB' },
      { challenge: 'Pressurization', response: 'CHECK' },
      { challenge: 'Landing / taxi lights', response: 'OFF (above 10,000 ft)' },
    ],
  },
  {
    title: 'DESCENT',
    phase: 'Descent',
    items: [
      { challenge: 'Landing elevation', response: 'CHECK (FMS)', check: on(V.ldgElevFms) },
      { challenge: 'Approach speeds (VREF)', response: 'SET (FMS APPROACH REF)' },
      { challenge: 'Altimeters / minimums', response: 'SET' },
      { challenge: 'Anti-ice', response: 'AS REQUIRED' },
    ],
  },
  {
    title: 'APPROACH',
    phase: 'Approach',
    items: [
      { challenge: 'Altimeters', response: 'SET (QNH)', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 && v.get('adc1.baro_std') === 0 },
      { challenge: 'NAV source', response: 'SET (APPR for ILS)' },
      { challenge: 'AUTOBRAKE', response: 'AS REQUIRED' },
      { challenge: 'GND LIFT DUMPING', response: 'NORMAL', check: off(V.gldOff) },
    ],
  },
  {
    title: 'LANDING',
    phase: 'Landing',
    items: [
      { challenge: 'Gear', response: 'DN, 3 green', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Slats / flaps', response: '30', check: (v) => v.get(V.flapLever) === 4 && v.get(SURF.flapsDeg) > 29 },
      { challenge: 'FLIGHT SPOILER lever', response: 'RETRACT', check: (v) => v.get(V.flightSpoiler) < 0.05 },
      { challenge: 'Landing lights', response: 'ON', check: (v) => v.get(V.ltLdgL) === 1 && v.get(V.ltLdgR) === 1 },
    ],
  },
  {
    title: 'AFTER LANDING',
    phase: 'Ground',
    items: [
      { challenge: 'Reverse levers', response: 'STOWED', check: (v) => v.get(V.revLever(1)) < 0.02 && v.get(V.revLever(2)) < 0.02 },
      { challenge: 'Slats / flaps', response: '0 IN', check: is(V.flapLever, 0) },
      { challenge: 'STROBE / landing lights', response: 'OFF', check: (v) => v.get(V.ltStrobe) === 0 && v.get(V.ltLdgL) === 0 && v.get(V.ltLdgR) === 0 },
      { challenge: 'APU', response: 'AS REQUIRED' },
      { challenge: 'Transponder', response: 'STBY' },
    ],
  },
  {
    title: 'SHUTDOWN',
    phase: 'Ground',
    items: [
      { challenge: 'PARK/EMER BRAKE', response: 'SET', check: (v) => v.get(V.parkSet) !== 0 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
      { challenge: 'ENG RUN switches', response: 'OFF', check: both(V.engRun, 0) },
      { challenge: 'BEACON', response: 'OFF (engines stopped)', check: off(V.ltBeacon) },
      { challenge: 'IRS', response: 'OFF', check: (v) => v.get(V.irsMode(1)) === 0 && v.get(V.irsMode(2)) === 0 && v.get(V.irsMode(3)) === 0 },
      { challenge: 'APU', response: 'OFF', check: off(V.apuSw) },
      { challenge: 'EMER LIGHTS', response: 'OFF', check: off(V.emerLights) },
      { challenge: 'BATT MASTER', response: 'OFF', check: off(V.battMaster) },
    ],
  },
  // ------------------------------------------------------------------ non-normal (CAS-linked in the ECL)
  {
    title: 'L ENG FIRE',
    phase: 'Emergency',
    items: [
      { challenge: 'L thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 },
      { challenge: 'L ENG RUN switch', response: 'OFF', check: off(V.engRun(1)) },
      { challenge: 'L FIRE handle', response: 'PULL', check: on(V.fireHandle('l')) },
      { challenge: 'L DISCH 1', response: 'PUSH', check: (v) => v.get('fire.bottle1_discharged') !== 0 },
      { challenge: 'If fire persists after 30 s: L DISCH 2', response: 'PUSH' },
    ],
  },
  {
    title: 'R ENG FIRE',
    phase: 'Emergency',
    items: [
      { challenge: 'R thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(2)) < 0.03 },
      { challenge: 'R ENG RUN switch', response: 'OFF', check: off(V.engRun(2)) },
      { challenge: 'R FIRE handle', response: 'PULL', check: on(V.fireHandle('r')) },
      { challenge: 'R DISCH 1', response: 'PUSH', check: (v) => v.get('fire.bottle1_discharged') !== 0 },
      { challenge: 'If fire persists after 30 s: R DISCH 2', response: 'PUSH' },
    ],
  },
  {
    title: 'APU FIRE',
    phase: 'Emergency',
    items: [
      { challenge: 'APU FIRE handle', response: 'PULL', check: on(V.fireHandle('apu')) },
      { challenge: 'APU DISCH 1', response: 'PUSH' },
      { challenge: 'APU rotary', response: 'OFF', check: off(V.apuSw) },
    ],
  },
  {
    title: 'EMER PWR ONLY',
    phase: 'Emergency',
    items: [
      { challenge: 'RAT', response: 'DEPLOYED (auto or manual handle)', check: (v) => v.get(V.ratDeployed) !== 0 },
      { challenge: 'GEN 1 - 4', response: 'OFF, then ON (reset)' },
      { challenge: 'APU (below 37,000 ft)', response: 'START' },
      { challenge: 'Airspeed', response: 'ABOVE 147 KIAS (RAT GEN on line)' },
    ],
  },
  {
    title: 'HYD 1 LO PRESS',
    phase: 'Caution',
    items: [
      { challenge: 'HYD pump 1B', response: 'ON', check: is(V.hydPump('1b'), 2) },
      { challenge: 'If pressure not restored: L HYD SOV', response: 'CLOSED' },
      { challenge: 'Landing distance', response: 'CORRECT (MFS / L reverser inoperative)' },
    ],
  },
  {
    title: 'HYD 2 LO PRESS',
    phase: 'Caution',
    items: [
      { challenge: 'HYD pump 2B', response: 'ON', check: is(V.hydPump('2b'), 2) },
      { challenge: 'Gear extension', response: 'MANUAL RELEASE if required' },
      { challenge: 'Landing distance', response: 'CORRECT (outboard brakes / R reverser inoperative)' },
    ],
  },
  {
    title: 'HYD 3 LO PRESS',
    phase: 'Caution',
    items: [
      { challenge: 'HYD pump 3B', response: 'ON', check: is(V.hydPump('3b'), 2) },
      { challenge: 'Gear', response: 'MANUAL RELEASE for extension' },
      { challenge: 'Nosewheel steering / inboard brakes', response: 'INOPERATIVE' },
    ],
  },
];

/** CAS id -> checklist title (Fusion CAS-linked ECL). */
export const G6K_CAS_CHECKLISTS: Readonly<Record<string, string>> = {
  l_eng_fire: 'L ENG FIRE',
  r_eng_fire: 'R ENG FIRE',
  apu_fire: 'APU FIRE',
  emer_pwr_only: 'EMER PWR ONLY',
  hyd1_lo_press: 'HYD 1 LO PRESS',
  hyd2_lo_press: 'HYD 2 LO PRESS',
  hyd3_lo_press: 'HYD 3 LO PRESS',
};
