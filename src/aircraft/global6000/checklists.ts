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
import { G6K_LIMITS, LB } from './data';
import { G6K_VARS as V } from './vars';

type Vars = Parameters<NonNullable<Checklist['items'][number]['check']>>[0];
const on = (name: string) => (v: Vars) => v.get(name) === 1;
const off = (name: string) => (v: Vars) => v.get(name) === 0;
const is = (name: string, x: number) => (v: Vars) => Math.abs(v.get(name) - x) < 0.01;
const both = (f: (i: 1 | 2) => string, x: number) => (v: Vars) => v.get(f(1)) === x && v.get(f(2)) === x;
const trimInBand = (v: Vars) => v.get('trim.pitch_units') >= G6K_LIMITS.stabGreenBand[0] && v.get('trim.pitch_units') <= G6K_LIMITS.stabGreenBand[1];

export const G6K_CHECKLISTS: Checklist[] = [
  {
    // Fix round P14: the real normal procedures begin with a safety / power-up and exterior inspection before the
    // cockpit preparation. SCOPE: no walkaround model (no ground crew / airframe inspection view), so the phase is a
    // display-only checklist that keeps the ECL phase list matching the real flow (EST wording).
    title: 'EXTERIOR INSPECTION',
    phase: 'Preflight',
    items: [
      { challenge: 'Exterior / safety inspection', response: 'COMPLETE (walkaround)' },
      { challenge: 'Gear pins / covers / chocks', response: 'REMOVED' },
      { challenge: 'Service doors / panels', response: 'SECURE' },
    ],
  },
  {
    title: 'COCKPIT PREPARATION',
    phase: 'Preflight',
    items: [
      { challenge: 'BATT MASTER', response: 'ON', check: (v) => v.get(V.battMaster) === 1 && v.get(V.battMasterSel) === 2 },
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
      // GX PTG 17-42 auto start: START selector AUTO, IGNITION normal, thrust levers IDLE, then ENGINE RUN ON.
      { challenge: 'START selector', response: 'AUTO', check: (v) => v.get(V.engStartSel) === 0 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05 },
      { challenge: 'R ENGINE RUN', response: 'ON, start monitored', check: (v) => v.get(V.engRun(2)) === 1 && v.get('eng2.running') !== 0 },
      { challenge: 'L ENGINE RUN', response: 'ON, start monitored', check: (v) => v.get(V.engRun(1)) === 1 && v.get('eng1.running') !== 0 },
      { challenge: 'N2 / ITT / oil pressure', response: 'STABILISED', check: (v) => v.get('eng1.n2_pct') > G6K_LIMITS.n2IdleMinPct && v.get('eng2.n2_pct') > G6K_LIMITS.n2IdleMinPct },
      { challenge: 'GEN 1 - 4', response: 'ON LINE', check: (v) => [1, 2, 3, 4].every((n) => v.get(`elec.gen${n}_online`) !== 0) },
    ],
  },
  {
    title: 'AFTER START',
    phase: 'Ground',
    items: [
      { challenge: 'APU BLEED', response: 'AS REQUIRED' },
      // Selected off (an unloaded cooldown may still be running, GXAPU 60 s) or kept on as required after start.
      { challenge: 'APU', response: 'OFF (or as required)', check: (v) => v.get('apu.avail') === 0 || v.get('apu.cooldown') !== 0 || v.get(V.apuSw) === 0 },
      { challenge: 'HYD pressures', response: 'CHECK', check: (v) => v.get('hyd.sys1_psi') > 2800 && v.get('hyd.sys2_psi') > 2800 && v.get('hyd.sys3_psi') > 2800 },
      { challenge: 'CAS', response: 'CHECKED' },
      { challenge: 'NOSE STEER', response: 'ARMED', check: on(V.nwsArm) },
      { challenge: 'Slats / flaps', response: '6 (or 16)', check: (v) => v.get(V.flapLever) === 2 || v.get(V.flapLever) === 3 },
      { challenge: 'Stab trim', response: 'SET (green band)', check: trimInBand },
    ],
  },
  {
    // Fix round P01: Bombardier Global normal procedures include a taxi phase with the brake check and
    // "Flight controls ... CHECKED" (free and correct on all three hydraulic systems). The AFM / QRH wording is
    // proprietary, so the items are EST from the standard Bombardier SOP / FSI-CAE training phase structure.
    title: 'TAXI',
    phase: 'Ground',
    items: [
      // Brake check at the start of taxi: normal brakes on systems 2 (outboard) and 3 (inboard), GXLG.
      { challenge: 'Brakes', response: 'CHECK', check: (v) => v.get('hyd.sys2_psi') > 1800 && v.get('hyd.sys3_psi') > 1800 },
      // Free and correct: all three hydraulic systems up and each surface tracking the pilot's input with the
      // pilot-intuitive sign (checked live while the crew sweeps the controls). SCOPE: an instantaneous check; the
      // full-travel sweep itself is crew technique.
      {
        challenge: 'Flight controls',
        response: 'FREE & CORRECT',
        check: (v) =>
          v.get('hyd.sys1_psi') > 1800 &&
          v.get('hyd.sys2_psi') > 1800 &&
          v.get('hyd.sys3_psi') > 1800 &&
          Math.abs(v.get(SURF.elevator) - v.get('input.pitch')) < 0.3 &&
          Math.abs(v.get(SURF.aileron) - v.get('input.roll')) < 0.35 &&
          Math.abs(v.get(SURF.rudder) - v.get('input.yaw')) < 0.3,
      },
      { challenge: 'Flight instruments', response: 'CHECK (heading / no flags)', check: (v) => v.get('ahrs1.valid') === 1 && v.get('ahrs2.valid') === 1 && v.get('adc1.valid') === 1 && v.get('adc2.valid') === 1 },
      { challenge: 'TAXI light', response: 'ON', check: (v) => v.get(V.ltTaxi) !== 0 },
    ],
  },
  {
    title: 'BEFORE TAKEOFF',
    phase: 'Takeoff',
    items: [
      { challenge: 'Slats / flaps', response: '6 (or 16)', check: (v) => (v.get(V.flapLever) === 2 || v.get(V.flapLever) === 3) && Math.abs(v.get(SURF.flapsDeg) - (v.get(V.flapLever) === 2 ? 6 : 16)) < 1 },
      { challenge: 'Trims (STAB / AIL / RUD)', response: 'SET', check: (v) => trimInBand(v) && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0 },
      { challenge: 'FLIGHT SPOILER lever', response: 'RETRACT', check: (v) => v.get(V.flightSpoiler) < 0.05 },
      { challenge: 'GND LIFT DUMPING', response: 'AUTO', check: is(V.gldSw, 0) },
      // SCOPE / fix round P11: our GXLG source describes an OFF / LO / MED / HI autobrake selector only (no RTO
      // position, no armed-for-takeoff mode), so the sim panel models exactly that and the item matches it: the
      // selector stays OFF for take-off (a rejected take-off is braked manually, see the REJECTED TAKEOFF checklist).
      // If an AFM / PTG source for a Global 6000 RTO function surfaces, add the arm mode and change this item.
      { challenge: 'AUTOBRAKE', response: 'OFF (no RTO mode; manual braking on a reject)', check: is(V.autobrake, 0) },
      // xpdr.mode 5 = TA/RA (core NAV.xpdrMode; Fusion CTP transponder softkeys).
      { challenge: 'Transponder', response: 'TA/RA', check: (v) => v.get('xpdr.mode') === 5 },
      { challenge: 'STROBE / landing lights', response: 'ON (STEADY / PULSE)', check: (v) => v.get(V.ltStrobe) === 1 && v.get(V.ltLdgL) !== 0 && v.get(V.ltLdgR) !== 0 },
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
      { challenge: 'Pressurization', response: 'CHECK', check: (v) => v.get('press.cabin_alt_ft') < 8200 },
      { challenge: 'Landing / taxi lights', response: 'OFF (above 10,000 ft)', check: (v) => v.get('adc1.alt_ft') < 10000 || (v.get(V.ltLdgL) === 0 && v.get(V.ltLdgR) === 0 && v.get(V.ltLdgNose) === 0 && v.get(V.ltTaxi) === 0) },
    ],
  },
  {
    // Fix round P02: real normal procedures have a climb phase (altimeters STD at transition, landing lights off at
    // 10,000 ft, pressurization check). EST wording (AFM / QRH proprietary); EST transition altitude 18,000 ft.
    title: 'CLIMB',
    phase: 'Climb',
    items: [
      { challenge: 'Altimeters', response: 'STD (transition altitude)', check: (v) => v.get('adc1.alt_ft') < 18000 || (v.get('adc1.baro_std') === 1 && v.get('adc2.baro_std') === 1) },
      { challenge: 'Landing / taxi lights', response: 'OFF (10,000 ft)', check: (v) => v.get('adc1.alt_ft') < 10000 || (v.get(V.ltLdgL) === 0 && v.get(V.ltLdgR) === 0 && v.get(V.ltLdgNose) === 0 && v.get(V.ltTaxi) === 0) },
      { challenge: 'Pressurization', response: 'CHECK (cabin climbing on schedule)', check: (v) => v.get('press.cabin_alt_ft') < 8200 },
      { challenge: 'PASS SIGNS', response: 'AS REQUIRED' },
    ],
  },
  {
    // Fix round P02: cruise checklist (pressurization, fuel balance / temperature monitoring). EST wording.
    title: 'CRUISE',
    phase: 'Cruise',
    items: [
      { challenge: 'Altimeters', response: 'STD (crosschecked)', check: (v) => v.get('adc1.alt_ft') < 18000 || (v.get('adc1.baro_std') === 1 && v.get('adc2.baro_std') === 1) },
      { challenge: 'Pressurization', response: 'CHECK', check: (v) => v.get('press.cabin_alt_ft') < 8200 },
      // GXFU: the automatic wing transfer corrects imbalances of 400 lb; more than that in cruise means it is not
      // keeping up (FUEL IMBALANCE posts at 1,100 lb in flight).
      { challenge: 'Fuel balance', response: 'CHECK (within 400 lb)', check: (v) => Math.abs(v.get('fuel.tank0_kg') - v.get('fuel.tank2_kg')) < 400 * LB },
      { challenge: 'Fuel temperature', response: 'MONITOR (above -35 C)', check: (v) => v.get('fuel.l_main_temp_c') > G6K_LIMITS.fuelLoTempC && v.get('fuel.r_main_temp_c') > G6K_LIMITS.fuelLoTempC },
    ],
  },
  {
    title: 'DESCENT',
    phase: 'Descent',
    items: [
      { challenge: 'Landing elevation', response: 'CHECK (FMS)', check: on(V.ldgElevFms) },
      { challenge: 'Approach speeds (VREF)', response: 'SET (FMS APPROACH REF)', check: (v) => v.get('fusion.vspd.vref') > 0 },
      // Set passing the transition level: above it the check is satisfied by STD still selected.
      { challenge: 'Altimeters / minimums', response: 'SET', check: (v) => v.get('adc1.alt_ft') > 18000 || (v.get('adc1.baro_std') === 0 && Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02) },
      { challenge: 'Anti-ice', response: 'AS REQUIRED' },
    ],
  },
  {
    title: 'APPROACH',
    phase: 'Approach',
    items: [
      { challenge: 'Altimeters', response: 'SET (QNH)', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 && v.get('adc1.baro_std') === 0 },
      { challenge: 'NAV source', response: 'SET (APPR for ILS)' },
      { challenge: 'AUTOBRAKE', response: 'AS REQUIRED (LO / MED / HI)', check: (v) => v.get(V.autobrake) > 0 },
      { challenge: 'GND LIFT DUMPING', response: 'AUTO', check: is(V.gldSw, 0) },
      { challenge: 'ACP', response: 'NAV / MKR AUDIO SET (ident checked)', check: (v) => v.get(V.acpSel(1, 'nav1')) === 1 || v.get(V.acpSel(2, 'nav2')) === 1 },
    ],
  },
  {
    title: 'LANDING',
    phase: 'Landing',
    items: [
      { challenge: 'Gear', response: 'DN, 3 green', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Slats / flaps', response: '30', check: (v) => v.get(V.flapLever) === 4 && v.get(SURF.flapsDeg) > 29 },
      { challenge: 'FLIGHT SPOILER lever', response: 'RETRACT', check: (v) => v.get(V.flightSpoiler) < 0.05 },
      { challenge: 'Landing lights', response: 'ON', check: (v) => v.get(V.ltLdgL) !== 0 && v.get(V.ltLdgR) !== 0 }, // STEADY or PULSE
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
      { challenge: 'Transponder', response: 'STBY', check: (v) => v.get('xpdr.mode') === 1 },
    ],
  },
  {
    title: 'SHUTDOWN',
    phase: 'Ground',
    items: [
      { challenge: 'PARK/EMER BRAKE', response: 'SET', check: (v) => v.get(V.parkSet) !== 0 },
      // Fix round P13: BR710 practice is a stabilization period at idle before shutdown (EST 2 min; operator practice,
      // no public AFM figure). The auto-check senses the levers at idle; the timing is crew technique.
      { challenge: 'Thrust levers', response: 'IDLE (warm-down, 2 min EST)', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
      { challenge: 'ENG RUN switches', response: 'OFF', check: both(V.engRun, 0) },
      { challenge: 'BEACON', response: 'OFF (engines stopped)', check: off(V.ltBeacon) },
      { challenge: 'PASS SIGNS', response: 'OFF', check: (v) => v.get(V.seatBelts) === 0 },
    ],
  },
  {
    // Fix round P13: the real flow ends with a securing / terminating checklist (EST wording).
    title: 'SECURING',
    phase: 'Ground',
    items: [
      { challenge: 'IRS', response: 'OFF', check: (v) => v.get(V.irsMode(1)) === 0 && v.get(V.irsMode(2)) === 0 && v.get(V.irsMode(3)) === 0 },
      { challenge: 'External power', response: 'AS REQUIRED' },
      { challenge: 'APU', response: 'OFF', check: off(V.apuSw) },
      { challenge: 'EMER LIGHTS', response: 'OFF', check: off(V.emerLights) },
      { challenge: 'BATT MASTER', response: 'OFF', check: (v) => v.get(V.battMaster) === 0 && v.get(V.battMasterSel) === 0 },
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
      // GX PTG 9-13: the pulled handle is turned and held >= 1 s: counter-clockwise = bottle 1, clockwise = bottle 2.
      { challenge: 'L FIRE handle', response: 'ROTATE LEFT (bottle 1), hold 1 s', check: (v) => v.get('fire.bottle1_discharged') !== 0 },
      { challenge: 'If fire persists after 30 s: L FIRE handle', response: 'ROTATE RIGHT (bottle 2)' },
    ],
  },
  {
    title: 'R ENG FIRE',
    phase: 'Emergency',
    items: [
      { challenge: 'R thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(2)) < 0.03 },
      { challenge: 'R ENG RUN switch', response: 'OFF', check: off(V.engRun(2)) },
      { challenge: 'R FIRE handle', response: 'PULL', check: on(V.fireHandle('r')) },
      { challenge: 'R FIRE handle', response: 'ROTATE LEFT (bottle 1), hold 1 s', check: (v) => v.get('fire.bottle1_discharged') !== 0 },
      { challenge: 'If fire persists after 30 s: R FIRE handle', response: 'ROTATE RIGHT (bottle 2)' },
    ],
  },
  {
    title: 'APU FIRE',
    phase: 'Emergency',
    items: [
      // GX PTG 4-16 / 9-14: pulling the handle shuts the APU down at once; the second APU shot needs the lockout pin.
      { challenge: 'APU FIRE handle', response: 'PULL', check: on(V.fireHandle('apu')) },
      { challenge: 'APU FIRE handle', response: 'ROTATE LEFT (bottle 1), hold 1 s', check: (v) => v.get('fire.bottle1_discharged') !== 0 },
      { challenge: 'APU rotary', response: 'OFF', check: off(V.apuSw) },
      { challenge: 'If fire persists: lockout pin', response: 'SLIDE, handle ROTATE RIGHT (bottle 2)' },
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
  {
    title: 'CABIN ALT',
    phase: 'Emergency',
    items: [
      { challenge: 'Crew oxygen masks', response: 'DON, 100 %', check: (v) => v.get(V.oxyMask(1)) === 1 && v.get(V.oxyMask(2)) === 1 },
      { challenge: 'Crew communication', response: 'ESTABLISH (ACP MASK)', check: (v) => v.get(V.acpMask(1)) === 1 || v.get(V.acpMask(2)) === 1 },
      // Fix round P09: one threshold everywhere — GX PTG 8-4: the oxygen compartment doors open automatically at
      // ~14,500 ft cabin altitude (data.ts paxMaskFt; environment.ts masksDeployFt uses the same limit).
      { challenge: 'PASSENGER OXYGEN', response: 'OVERRIDE if cabin > 14,500 ft', check: (v) => v.get('press.cabin_alt_ft') < G6K_LIMITS.paxMaskFt || v.get(V.paxOxy) === 2 || v.get('oxy.pax_on') !== 0 },
      { challenge: 'Emergency descent', response: 'AS REQUIRED (EDM)' },
    ],
  },
  {
    title: 'EMER DEPRESS',
    phase: 'Caution',
    items: [
      { challenge: 'EMER DEPRESS', response: 'OFF when no longer required', check: off(V.emerDepress) },
    ],
  },
  {
    title: 'ROLL SELECT',
    phase: 'Caution',
    items: [
      { challenge: 'Autopilot', response: 'DISCONNECT' },
      { challenge: 'ROLL SPLRS (free side)', response: 'PRESS (PLT CONT / CPLT CONT)', check: (v) => v.get(V.rollPriority) !== 0 },
    ],
  },
  // Fix round P03: L/R ENG FLAMEOUT / relight (the QRH wording is proprietary: EST item sequence from the FADEC
  // behaviour modelled in systems/engines.ts — windmill relight at windmill N2, starter assist below the EST
  // 21,000 ft air-start ceiling — and the TCDS 3.2 850 C in-flight starting ITT limit).
  ...(['L', 'R'] as const).map((S, k): Checklist => {
    const i = (k + 1) as 1 | 2;
    return {
      title: `${S} ENG FLAMEOUT`,
      phase: 'Caution',
      items: [
        { challenge: `${S} thrust lever`, response: 'IDLE', check: (v) => v.get(V.tla(i)) < 0.03 },
        // EST envelope guidance (data.ts airStartWindmillAltFt); the check also passes with the core windmilling
        // fast enough for a relight at altitude (fuel-on N2 18 %, engines.ts).
        { challenge: 'Relight envelope', response: 'BELOW FL300 / WINDMILL N2 (EST)', check: (v) => v.get('adc1.press_alt_ft') < G6K_LIMITS.airStartWindmillAltFt || v.get(`eng${i}.n2_pct`) > 18 },
        { challenge: `${S} ENG RUN`, response: 'OFF, then ON (restart)', check: (v) => v.get(V.engRun(i)) === 1 && (v.get(`eng${i}.running`) !== 0 || v.get(`fadec.eng${i}.start_state`) > 0 || v.get(V.autoRelight(i)) !== 0) },
        { challenge: 'ITT', response: 'MONITOR (850 C air-start limit)', check: (v) => v.get(`eng${i}.itt_c`) < G6K_LIMITS.ittStartAirC }, // TCDS 3.2
        { challenge: 'If no relight: APU', response: 'START (below 37,000 ft)' },
        { challenge: 'If no relight: starter assist', response: 'BELOW 21,000 ft (EST)' },
      ],
    };
  }),
  // Fix round P04: key QRH procedures (EST wording; the matching CAS messages, transfer switches, manual gear
  // release and EDM already exist in the model).
  {
    title: 'FUEL IMBALANCE',
    phase: 'Caution',
    items: [
      { challenge: 'AUX pumps', response: 'ON (both)', check: (v) => v.get(V.auxPump('l')) === 1 && v.get(V.auxPump('r')) === 1 },
      { challenge: 'XFEED', response: 'CLOSED', check: (v) => v.get(V.xfeed) === 0 },
      // GXFU manual wing transfer: L -> R (2) / R -> L (3) toward the light wing.
      {
        challenge: 'WING XFER',
        response: 'TOWARD LIGHT WING',
        check: (v) => {
          const d = v.get('fuel.tank0_kg') - v.get('fuel.tank2_kg');
          return Math.abs(d) < G6K_LIMITS.wingXferAutoLb * LB || v.get(V.wingXfer) === (d > 0 ? 2 : 3);
        },
      },
      { challenge: 'Imbalance', response: 'MONITOR DECREASING; balanced: WING XFER AUTO' },
    ],
  },
  {
    title: 'AC BUS FAIL',
    phase: 'Caution',
    items: [
      { challenge: 'GEN (affected)', response: 'OFF, then ON (GCU reset)' },
      { challenge: 'AC BUS ISOL (EMS CDU)', response: 'VERIFY NOT ISOLATED', check: (v) => [1, 2, 3, 4].every((n) => v.get(V.acBusIsol(n as 1)) === 0) },
      { challenge: 'If not restored: APU', response: 'START, APU GEN ON (below 37,000 ft)' },
      { challenge: 'Affected-bus loads', response: 'CHECK (synoptic)' },
    ],
  },
  {
    title: 'DC BUS FAIL',
    phase: 'Caution',
    items: [
      { challenge: 'TRUs', response: 'CHECK ON LINE', check: (v) => v.get('elec.tru1_online') !== 0 || v.get('elec.tru2_online') !== 0 },
      { challenge: 'DC BUS ISOL (EMS CDU)', response: 'VERIFY NOT ISOLATED', check: (v) => v.get(V.dcBusIsol('dc_bus1')) === 0 && v.get(V.dcBusIsol('dc_bus2')) === 0 },
      { challenge: 'Affected-bus loads', response: 'CHECK (synoptic)' },
    ],
  },
  {
    title: 'GEAR DISAGREE',
    phase: 'Caution',
    items: [
      { challenge: 'Airspeed', response: 'BELOW 200 KIAS (VLO)', check: (v) => v.get('adc1.ias_kt') < G6K_LIMITS.vloExtKt },
      { challenge: 'Gear handle', response: 'DN', check: on(V.gearHandle) },
      // GXLG: the manual release handle free-falls the gear (system 3 not required).
      { challenge: 'Manual release handle', response: 'PULL FULLY', check: (v) => v.get(V.gearManRelease) > 0.95 || v.get('gear.down_locked') !== 0 },
      { challenge: 'Gear', response: 'DOWN, 3 GREEN', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Landing distance', response: 'CORRECT (doors remain open)' },
    ],
  },
  {
    title: 'FLAP FAIL',
    phase: 'Caution',
    items: [
      { challenge: 'Airspeed', response: 'BELOW VFE OF PRESENT POSITION', check: (v) => v.get('adc1.ias_kt') < (v.get(SURF.flapsDeg) > 20 ? G6K_LIMITS.vfe30Kt : v.get(SURF.flapsDeg) > 0.5 ? G6K_LIMITS.vfe6Kt : G6K_LIMITS.vseKt) },
      { challenge: 'SLAT/FLAP RESET (EMS CDU)', response: 'PUSH' },
      { challenge: 'If flaps remain failed: approach speed', response: 'VREF CORRECTION (FMS LDG)' },
      { challenge: 'Landing distance', response: 'CORRECT' },
    ],
  },
  {
    title: 'SLAT FAIL',
    phase: 'Caution',
    items: [
      { challenge: 'Airspeed', response: 'BELOW VFE / VSE', check: (v) => v.get('adc1.ias_kt') < G6K_LIMITS.vseKt },
      { challenge: 'SLAT/FLAP RESET (EMS CDU)', response: 'PUSH' },
      { challenge: 'If slats remain failed: approach speed', response: 'VREF CORRECTION (FMS LDG)' },
      { challenge: 'Landing distance', response: 'CORRECT' },
    ],
  },
  {
    title: 'SMOKE / FUMES',
    phase: 'Emergency',
    items: [
      { challenge: 'Crew oxygen masks', response: 'DON, 100 %', check: (v) => v.get(V.oxyMask(1)) === 1 && v.get(V.oxyMask(2)) === 1 },
      { challenge: 'Crew communication', response: 'ESTABLISH (ACP MASK)', check: (v) => v.get(V.acpMask(1)) === 1 || v.get(V.acpMask(2)) === 1 },
      { challenge: 'RECIRC fan', response: 'OFF', check: off(V.recircFan) },
      { challenge: 'Source', response: 'ISOLATE (pack / electrics as required)' },
      { challenge: 'If smoke persists', response: 'LAND AT NEAREST SUITABLE AIRPORT' },
    ],
  },
  {
    title: 'EMERGENCY DESCENT',
    phase: 'Emergency',
    items: [
      { challenge: 'Crew oxygen masks', response: 'DON, 100 %', check: (v) => v.get(V.oxyMask(1)) === 1 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
      { challenge: 'FLIGHT SPOILER lever', response: 'FULL', check: (v) => v.get(V.flightSpoiler) > 0.7 },
      { challenge: 'Speed', response: 'VMO / MMO (as structure allows)' },
      { challenge: 'Level-off', response: '10,000 FT / MEA (EDM targets 15,000 ft)' }, // FSB: EDM on autopilot
      { challenge: 'PASS SIGNS', response: 'ON', check: (v) => v.get(V.seatBelts) >= 1 },
    ],
  },
  {
    // Memory items on a reject before V1 (EST wording; GLD deploys with wheel speed and reverse, GXFC).
    title: 'REJECTED TAKEOFF',
    phase: 'Emergency',
    items: [
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.03 && v.get(V.tla(2)) < 0.03 },
      { challenge: 'Wheel brakes', response: 'MAXIMUM (manual; no autobrake RTO mode)' },
      { challenge: 'Thrust reversers', response: 'MAX REV AS REQUIRED' },
      { challenge: 'Ground spoilers', response: 'VERIFY EXTENDED', check: (v) => v.get('gear.air_ground') === 0 || v.get(SURF.groundSpoilers) > 0.5 || v.get('fdm.gs_kt') < 16 },
      { challenge: 'Stopped: brake temperature', response: 'MONITOR (BTMS)' },
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
  cabin_alt: 'CABIN ALT',
  emer_depress: 'EMER DEPRESS',
  roll_select: 'ROLL SELECT',
  // Fix rounds P03 / P04
  l_eng_flameout: 'L ENG FLAMEOUT',
  r_eng_flameout: 'R ENG FLAMEOUT',
  fuel_imbalance: 'FUEL IMBALANCE',
  ac_bus1_fail: 'AC BUS FAIL',
  ac_bus2_fail: 'AC BUS FAIL',
  ac_bus3_fail: 'AC BUS FAIL',
  ac_bus4_fail: 'AC BUS FAIL',
  dc_bus1_fail: 'DC BUS FAIL',
  dc_bus2_fail: 'DC BUS FAIL',
  gear_disagree: 'GEAR DISAGREE',
  flap_fail: 'FLAP FAIL',
  slat_fail: 'SLAT FAIL',
};
