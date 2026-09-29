/**
 * Citation Longitude normal checklists (OG Section 17 "Normal Procedures")
 * and the emergency / abnormal items of the DGAC Chile C700 card (2021), with
 * automatic checks against the cockpit/system vars where the item is
 * observable. Items marked EST are not on the card (Citation-family practice).
 */
import type { Checklist } from '../types';
import { LON_VARS as V } from './vars';

const on = (name: string) => (v: { get(n: string, d?: number): number }) => v.get(name) !== 0;
const off = (name: string) => (v: { get(n: string, d?: number): number }) => v.get(name) === 0;
const eq = (name: string, val: number) => (v: { get(n: string, d?: number): number }) => v.get(name) === val;

export const LONGITUDE_CHECKLISTS: Checklist[] = [
  {
    title: 'Cockpit Inspection',
    phase: 'Preflight',
    items: [
      // EST item (the OG does not model the control lock; photograph: CONTROL LOCK lever, UNLOCK up / LOCK down).
      { challenge: 'CONTROL LOCK lever', response: 'UNLOCK', check: off(V.controlLock) },
      { challenge: 'STBY PWR switch', response: 'TEST and hold (green light min 10 s) / ON', check: eq(V.stbyPwr, 1) },
      { challenge: 'EMER LTS switch', response: 'ARM', check: eq(V.ltEmer, 1) },
      { challenge: 'LANDING GEAR handle', response: 'DOWN', check: eq(V.gearHandle, 1) },
      { challenge: 'BATT buttons (both)', response: 'ON, check volts', check: (v) => v.get(V.battL) !== 0 && v.get(V.battR) !== 0 },
      { challenge: 'EIS / CAS', response: 'Check' },
      // OG 17-2 item 6 sub-steps a-e (LON-P3-15): EXT PWR and/or APU, with the combined auto-check on the last.
      { challenge: 'External power / APU', response: 'As desired:' },
      { challenge: 'a. EXT PWR button (if AVAIL illuminated)', response: 'ON' },
      { challenge: 'b. BATT amps', response: '0 or charging' },
      { challenge: 'c. (and/or) APU knob', response: 'ON / START' },
      { challenge: 'd. External power', response: 'Disconnected' },
      { challenge: 'e. BATT amps', response: '0 or charging', check: (v) => v.get('elec.gpu_online') !== 0 || v.get('apu.avail') !== 0 },
      { challenge: 'Exterior / interior lights', response: 'ON / check / OFF, or as required' },
    ],
  },
  {
    title: 'Cockpit Preparation',
    phase: 'Preflight',
    items: [
      { challenge: 'Cockpit inspection', response: 'Complete' },
      { challenge: 'EIS / CAS', response: 'Check' }, // OG 17-3 item 2 (LON-P3-03)
      { challenge: 'APU knob', response: 'ON / START', check: (v) => v.get('apu.avail') !== 0 },
      { challenge: 'External power', response: 'Disconnected', check: off('elec.gpu_online') },
      { challenge: 'Engine dry motor', response: 'Consider', check: (v) => v.get(V.dryMotorReq(1)) === 0 && v.get(V.dryMotorReq(2)) === 0 },
      { challenge: 'ATIS / Clearance', response: 'As required' }, // OG 17-3 item 6 (LON-P3-03)
      { challenge: 'Trims', response: 'Check / set for takeoff (stab per CG chart)', check: (v) => v.get('trim.pitch_to_ok') !== 0 && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0 },
      { challenge: 'Weight and fuel (MFD GTC: PERF)', response: 'Completed' },
      { challenge: 'Takeoff data (MFD GTC: PERF)', response: 'Completed' },
      { challenge: 'V speeds', response: 'Verify / set' },
      { challenge: 'Pressurization LDG ELEV', response: 'Verify / set' },
      { challenge: 'Fuel quantity and balance', response: 'Check', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) < 227 },
      // OG 17-3 item 13 (LON-P3-03): a momentary ground action (engage, verify, disengage), so no steady auto-check.
      { challenge: 'Autopilot (First Flight of Day)', response: 'Engage / Disengage' },
    ],
  },
  {
    title: 'Before Start',
    phase: 'Ground',
    items: [
      { challenge: 'EMER/PARK BRAKE handle', response: 'Set (PARK BRAKE ON displayed)', check: on('brakes.parking_set') },
      { challenge: 'EIS / CAS', response: 'Check' },
    ],
  },
  {
    title: 'Starting Engines (Using APU)',
    phase: 'Ground',
    items: [
      { challenge: 'Throttles', response: 'IDLE', check: (v) => Math.abs(v.get(V.tla(1))) < 0.03 && Math.abs(v.get(V.tla(2))) < 0.03 },
      // OG 17-4 item 2: "ENGINE RUN/STOP Button (either engine) - RUN" (LON-P3-07; right-first is only the OG 9
      // bleed-routing recommendation, not a checklist requirement, so the checks are symmetric).
      { challenge: 'ENGINE RUN/STOP button (either engine — R recommended)', response: 'RUN', check: (v) => v.get(V.runL) !== 0 || v.get(V.runR) !== 0 },
      { challenge: 'START pressure', response: 'Verify >= 32 psi' },
      { challenge: 'ENGINE STARTER button', response: 'Push' },
      { challenge: 'Engine instruments', response: 'Monitor (ITT < 650 C)', check: (v) => v.get('eng1.running') !== 0 || v.get('eng2.running') !== 0 },
      { challenge: 'Opposite engine', response: 'Repeat steps 1 thru 4', check: (v) => v.get('eng1.running') !== 0 && v.get('eng2.running') !== 0 && v.get(V.runL) !== 0 && v.get(V.runR) !== 0 },
      { challenge: 'EIS / CAS', response: 'Check', check: (v) => v.get('elec.gen_l_online') !== 0 && v.get('elec.gen_r_online') !== 0 },
    ],
  },
  {
    // OG 17-12 (LON-P3-06): second engine started with bleed air cross-fed from the running engine.
    title: 'Starting Engines (Using Cross-Bleed)',
    phase: 'Ground',
    items: [
      { challenge: 'Operating engine throttle', response: 'IDLE + 25 % N1 minimum', check: (v) => Math.max(v.get('eng1.n1_pct'), v.get('eng2.n1_pct')) >= 45 }, // ground idle ~22 % N1 + 25
      { challenge: 'Throttle (engine being started)', response: 'IDLE' },
      { challenge: 'ENGINE RUN/STOP button', response: 'RUN' },
      { challenge: 'START pressure', response: 'Verify >= 32 psi', check: (v) => v.get(V.startPsi) >= 32 },
      { challenge: 'ENGINE STARTER button', response: 'Push' },
      { challenge: 'Engine instruments', response: 'Monitor (ITT < 650 C)', check: (v) => v.get('eng1.running') !== 0 && v.get('eng2.running') !== 0 },
      { challenge: 'Throttles', response: 'IDLE', check: (v) => Math.abs(v.get(V.tla(1))) < 0.03 && Math.abs(v.get(V.tla(2))) < 0.03 },
      { challenge: 'EIS / CAS', response: 'Check' },
    ],
  },
  {
    title: 'Before Taxi',
    phase: 'Ground',
    items: [
      { challenge: 'Flight controls', response: 'Free and correct / check' },
      { challenge: 'Speedbrakes', response: 'Check / retracted', check: (v) => v.get(V.speedbrake) < 0.02 },
      { challenge: 'Flaps', response: 'Set for takeoff (1 or 2)', check: (v) => v.get('surf.flaps_deg') > 5 && v.get('surf.flaps_deg') < 17 },
      { challenge: 'Flight instruments / avionics', response: 'Aligned / no flags; altimeters within 75 ft of field, 50 ft of each other', check: (v) => v.get('ahrs1.valid') !== 0 && v.get('ahrs2.valid') !== 0 },
      { challenge: 'ENGINE ICE PROTECTION buttons', response: 'As required' },
      // EST items from the pedestal / glareshield switchlights in the photographs (AFM text not public); tagged
      // (EST) in the challenge so they read as operator additions to the 5-item OG 17-4 list (LON-P3-18).
      { challenge: 'AUTO GROUND SPOILERS button (EST)', response: 'NORM (armed)', check: on(V.autoGndSplr) },
      { challenge: 'POWER RESERVE (EST)', response: 'AUTO (armed)', check: (v) => v.get(V.aprAuto) !== 0 && v.get(V.aprManual) === 0 },
    ],
  },
  {
    title: 'Taxi',
    phase: 'Ground',
    items: [
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'EMER/PARK BRAKE handle', response: 'Stowed', check: off('brakes.parking_set') },
      { challenge: 'Brakes', response: 'Check' },
      { challenge: 'Nosewheel steering', response: 'Check' },
      { challenge: 'Thrust reversers', response: 'Check (T/R DEPLOY green) / stowed', check: (v) => v.get('eng1.reverser_pos') < 0.02 && v.get('eng2.reverser_pos') < 0.02 },
    ],
  },
  {
    title: 'Before Takeoff',
    phase: 'Takeoff',
    items: [
      { challenge: 'Flaps', response: 'Set for takeoff', check: (v) => v.get('surf.flaps_deg') > 5 && v.get('surf.flaps_deg') < 17 },
      { challenge: 'Speedbrakes', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.02 },
      { challenge: 'Trims', response: 'Set for takeoff', check: (v) => v.get('trim.pitch_to_ok') !== 0 && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0 },
      { challenge: 'Ice protection systems', response: 'Check, as required' },
      { challenge: 'V speeds', response: 'Displayed' },
      { challenge: 'SPD knob', response: 'FMS' },
      { challenge: 'Crew briefing', response: 'Complete (rolling takeoff: +500 ft)' },
      { challenge: 'Radar', response: 'As required' },
      { challenge: 'PITOT/STATIC (icing, within 1 min of takeoff)', response: 'ON 15 s then NORM', check: off(V.pitotStatic) },
      // OG 17-5 (LON-P3-04): the last four items follow the "----CLEARED FOR TAKEOFF----" divider.
      { challenge: '---- CLEARED FOR TAKEOFF ----', response: '' },
      { challenge: 'Flight controls', response: 'Free', check: off(V.controlLock) },
      { challenge: 'ICE PROTECTION buttons', response: 'As required' },
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'EIS / CAS', response: 'Check (no NO TAKEOFF)', check: off(V.noTakeoff) },
    ],
  },
  {
    title: 'Takeoff (Static)',
    phase: 'Takeoff',
    items: [
      { challenge: 'Throttles', response: 'TO', check: (v) => v.get(V.tla(1)) > 0.95 && v.get(V.tla(2)) > 0.95 },
      { challenge: 'Autothrottle (if used)', response: 'Check green HOLD' },
      { challenge: 'EIS / CAS', response: 'Check (N1 matches command, green TO)' },
      { challenge: 'Brakes', response: 'Release' },
      { challenge: 'Elevator control', response: 'Rotate at VR (10 deg initial pitch)' },
    ],
  },
  {
    // OG 17-6 "Rolling Takeoff" (LON-P3-16): brakes released first, throttles to TO within 500 ft of brake release.
    title: 'Takeoff (Rolling)',
    phase: 'Takeoff',
    items: [
      { challenge: 'Brakes', response: 'Release' },
      { challenge: 'Throttles (within 500 ft of brake release)', response: 'TO', check: (v) => v.get(V.tla(1)) > 0.95 && v.get(V.tla(2)) > 0.95 },
      { challenge: 'Autothrottle (if used)', response: 'Check green HOLD' },
      { challenge: 'EIS / CAS', response: 'Check (N1 matches command, green TO)' },
      { challenge: 'Elevator control', response: 'Rotate at VR (10 deg initial pitch)' },
    ],
  },
  {
    title: 'After Takeoff / Climb',
    phase: 'Climb',
    items: [
      { challenge: 'Landing gear (positive rate)', response: 'UP', check: eq(V.gearHandle, 0) },
      { challenge: 'Flaps (at or above V2 + 20)', response: 'UP', check: (v) => v.get('surf.flaps_deg') < 0.5 },
      { challenge: 'Throttles', response: 'CLB' },
      { challenge: 'Ice protection', response: 'As required' },
      { challenge: 'Pressurization', response: 'Check', check: (v) => v.get('press.cabin_alt_ft') < 8500 },
      { challenge: 'Altimeters (transition altitude)', response: 'Set' },
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'APU knob (prior to climb above FL350)', response: 'OFF' },
    ],
  },
  {
    title: 'Cruise',
    phase: 'Cruise',
    items: [
      { challenge: 'Throttles', response: 'CRU or as desired' },
      { challenge: 'Autopilot (RVSM)', response: 'As required' },
      { challenge: 'Altimeters (RVSM)', response: 'Crosscheck (within 200 ft at 1 hour intervals or less)' }, // OG 17-7 item 3
    ],
  },
  {
    title: 'Descent',
    phase: 'Descent',
    items: [
      { challenge: 'Pressurization LDG ELEV', response: 'Verify landing elevation' },
      { challenge: 'APU knob (at or below FL310)', response: 'ON / START, as desired' },
      { challenge: 'Altimeters (transition level)', response: 'Set' },
      { challenge: 'Exterior lights', response: 'As required' },
    ],
  },
  {
    title: 'Approach',
    phase: 'Approach',
    items: [
      { challenge: 'Landing data', response: 'Confirm (V speeds set, landing distance calculated)' },
      { challenge: 'Ice protection', response: 'As required' },
      { challenge: 'FMS / navigation aids', response: 'Set, as required' },
      { challenge: 'Minimums', response: 'Set' },
      { challenge: 'Altimeters', response: 'Verify setting', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 },
      { challenge: 'Crew briefing', response: 'Complete' },
      { challenge: 'Flaps', response: '1 or 2, when desired' },
    ],
  },
  {
    title: 'Before Landing',
    phase: 'Landing',
    items: [
      { challenge: 'Landing gear', response: 'DOWN (3 green)', check: on('gear.down_locked') },
      { challenge: 'Flaps', response: 'FULL', check: (v) => v.get('surf.flaps_deg') > 34 },
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'Speedbrakes', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.02 },
      { challenge: 'EIS / CAS', response: 'Check' },
      { challenge: 'Autopilot (before 160 ft AGL)', response: 'Disengage' },
      { challenge: 'Airspeed', response: 'VREF minimum' },
    ],
  },
  {
    title: 'Landing',
    phase: 'Landing',
    items: [
      { challenge: 'Autothrottle (if used)', response: 'Check green RETARD at 50 ft' },
      { challenge: 'Throttles', response: 'IDLE' },
      { challenge: 'Brakes (after nosewheel touchdown)', response: 'Apply' },
      { challenge: 'Thrust reversers', response: 'Deploy (reverse idle by 45 KIAS)' },
    ],
  },
  {
    title: 'Go-Around',
    phase: 'Landing',
    items: [
      { challenge: 'TO/GA button', response: 'Push' },
      { challenge: 'Throttles', response: 'TO' },
      { challenge: 'Pitch attitude', response: '7.5 deg nose up initially' },
      { challenge: 'Flaps', response: '2' },
      { challenge: 'Climb airspeed', response: 'VAPP minimum' },
      { challenge: 'Landing gear (positive rate)', response: 'UP' },
      { challenge: 'Flaps (at or above VAPP + 10)', response: 'UP' },
      { challenge: 'SPD knob', response: 'FMS' },
      { challenge: 'Throttles', response: 'As required' }, // OG 17-8 item 9 (LON-P3-17)
    ],
  },
  {
    title: 'After Landing',
    phase: 'Ground',
    items: [
      { challenge: 'Thrust reversers', response: 'Stow', check: (v) => v.get('eng1.reverser_pos') < 0.02 && v.get('eng2.reverser_pos') < 0.02 },
      { challenge: 'Flaps', response: 'As desired' },
      { challenge: 'ENGINE ice protection', response: 'As required' },
      { challenge: 'WING ice protection', response: 'OFF', check: off(V.aiWing) },
      { challenge: 'STAB ice protection', response: 'OFF', check: off(V.aiStab) },
      { challenge: 'Exterior lights', response: 'As required' },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Ground',
    items: [
      { challenge: 'Throttles', response: 'IDLE' },
      { challenge: 'EMER/PARK BRAKE handle', response: 'Set', check: on('brakes.parking_set') },
      { challenge: 'ENGINE ICE PROTECTION buttons', response: 'OFF', check: (v) => v.get(V.aiEngL) === 0 && v.get(V.aiEngR) === 0 },
      { challenge: 'ENGINE RUN/STOP buttons', response: 'STOP', check: (v) => v.get(V.runL) === 0 && v.get(V.runR) === 0 },
      { challenge: 'EMER LTS switch', response: 'OFF', check: eq(V.ltEmer, 0) },
      { challenge: 'STBY PWR switch', response: 'OFF', check: eq(V.stbyPwr, 0) },
      { challenge: 'APU knob', response: 'OFF', check: eq(V.apuKnob, 0) },
      { challenge: 'Exterior lights', response: 'OFF' },
      { challenge: 'BATT buttons (both)', response: 'OFF', check: (v) => v.get(V.battL) === 0 && v.get(V.battR) === 0 },
    ],
  },
  {
    // OG 17-10 "Quick Turn" (LON-P3-05): turnaround without a full shutdown flow; return to Cockpit Preparation.
    title: 'Quick Turn',
    phase: 'Ground',
    items: [
      { challenge: 'Throttles', response: 'IDLE', check: (v) => Math.abs(v.get(V.tla(1))) < 0.03 && Math.abs(v.get(V.tla(2))) < 0.03 },
      { challenge: 'EMER/PARK BRAKE handle', response: 'Set', check: on('brakes.parking_set') },
      { challenge: 'ENGINE ICE PROTECTION buttons', response: 'OFF', check: (v) => v.get(V.aiEngL) === 0 && v.get(V.aiEngR) === 0 },
      { challenge: 'ENGINE RUN/STOP buttons', response: 'STOP', check: (v) => v.get(V.runL) === 0 && v.get(V.runR) === 0 },
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'Electrical power source (APU ON/START or EXT PWR)', response: 'As desired (BATT amps 0 or charging)', check: (v) => v.get('apu.avail') !== 0 || v.get('elec.gpu_online') !== 0 },
      { challenge: 'Before the next flight', response: 'Return to Cockpit Preparation' },
    ],
  },
  {
    title: 'Starting APU',
    phase: 'Ground',
    items: [
      { challenge: 'EIS / CAS', response: 'Check' },
      { challenge: 'APU knob', response: 'ON (green RPM / EGT digits within 10 s)', check: (v) => v.get(V.apuKnob) >= 1 },
      { challenge: 'APU knob (at or below FL310)', response: 'START' },
      { challenge: 'APU RPM', response: 'Stabilizes 98-100 %', check: (v) => v.get('apu.n_pct') > 97 },
      { challenge: 'APU BLEED', response: 'NORM', check: on(V.bleedApu) },
      { challenge: 'APU GEN switch', response: 'ON', check: eq(V.genApu, 1) },
      { challenge: 'Environmental controls', response: 'As desired' },
    ],
  },
  {
    title: 'Engine Dry Motor',
    phase: 'Ground',
    items: [
      { challenge: 'Throttle (affected side)', response: 'IDLE' },
      { challenge: 'ENGINE RUN/STOP (affected side)', response: 'STOP' },
      { challenge: 'ENGINE STARTER (affected side)', response: 'Push and hold' },
      // OG 17-11 item 4: "Release when N2 19% or 15s Elapsed Time" (the OG 7-6 narrative says 20 %; the checklist
      // section is the operative text — LON-P3-14).
      { challenge: 'ENGINE STARTER', response: 'Release at 19 % N2 or 15 s' },
      { challenge: 'Next start attempt', response: 'When ENG DRY MTR PROC clears', check: (v) => v.get(V.dryMotorReq(1)) === 0 && v.get(V.dryMotorReq(2)) === 0 },
    ],
  },
  // ================================================================ DGAC C700 card: emergency / abnormal
  {
    title: 'CABIN ALTITUDE',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen mask', response: 'Don and 100 %', check: (v) => v.get(V.oxyMaskL) !== 0 && v.get(V.oxyMode) >= 1 },
      { challenge: 'MIC SEL buttons (both)', response: 'MASK', check: (v) => v.get(V.micSelL) !== 0 && v.get(V.micSelR) !== 0 },
      { challenge: 'MIC/INPH switches (both)', response: 'Outboard, as required to enable intercom' },
      { challenge: 'Descent', response: 'Initiate max rate descent to a safe altitude' },
    ],
  },
  {
    title: 'EMERGENCY DESCENT and EDM',
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen mask', response: 'Don and 100 %', check: (v) => v.get(V.oxyMaskL) !== 0 && v.get(V.oxyMode) >= 1 },
      { challenge: 'MIC SEL buttons (both)', response: 'MASK', check: (v) => v.get(V.micSelL) !== 0 && v.get(V.micSelR) !== 0 },
      { challenge: 'MIC/INPH switches (both)', response: 'Outboard, as required to enable intercom' },
      { challenge: 'Descent', response: 'Initiate max rate descent to a safe altitude (EDM: AP turns 90 deg left, descends to 15,000 ft)' },
    ],
  },
  {
    title: 'WINDSHEAR',
    phase: 'Emergency',
    items: [
      { challenge: 'Autothrottle', response: 'Disengage', check: off('ap.at_engaged') },
      { challenge: 'Autopilot', response: 'Disengage', check: off('ap.engaged') },
      { challenge: 'Throttles', response: 'TO' },
      { challenge: 'Pitch attitude', response: '7.5 deg nose up initially' },
      { challenge: 'MANUAL POWER RESERVE button', response: 'ON', check: on(V.aprManual) },
    ],
  },
  {
    title: 'BRAKE FAIL / WHEEL BRAKE FAILURE',
    phase: 'Emergency',
    items: [
      { challenge: 'In flight', response: 'Climb to a safe altitude' },
      { challenge: 'On the ground: EMER/PARK BRAKE handle', response: 'Apply smoothly until stopped, then SET', check: on('brakes.parking_set') },
    ],
  },
  {
    title: 'PRIMARY PITCH TRIM RUNAWAY',
    phase: 'Emergency',
    items: [
      { challenge: 'MASTER DISCONNECT button', response: 'Push and hold' },
      // EST continuation (not on the card): disengage the primary channel and retrim with the secondary trim.
      { challenge: 'SECONDARY TRIM (EST)', response: 'ENGAGED', check: on(V.stabSecArm) },
      { challenge: 'Secondary trim rocker (EST)', response: 'Retrim as required' },
    ],
  },
  {
    title: 'JAMMED PITCH OR ROLL CONTROL SYSTEM',
    phase: 'Emergency',
    items: [
      { challenge: 'Control wheel', response: 'Relax pressure' },
      { challenge: 'PITCH/ROLL DISCONNECT handle', response: 'Pull until latched', check: (v) => v.get(V.pitchRollDisc) !== 0 },
      { challenge: 'Operative control wheel', response: 'Identify, recover airplane attitude' },
    ],
  },
  {
    title: 'NOSEWHEEL STEERING MALFUNCTION',
    phase: 'Emergency',
    items: [{ challenge: 'MASTER DISCONNECT button', response: 'Push and hold' }],
  },
  {
    title: 'INADVERTENT STALL / PUSH',
    phase: 'Emergency',
    items: [
      { challenge: 'Pitch attitude', response: '0 to 5 deg nose down initially' },
      { challenge: 'Roll attitude', response: 'Wings level' },
      { challenge: 'Autothrottle', response: 'Disengage', check: off('ap.at_engaged') },
      { challenge: 'Throttles', response: 'TO' },
    ],
  },
  {
    title: 'AT HOLD FAIL',
    phase: 'Abnormal',
    items: [
      { challenge: 'Below V1', response: 'Takeoff - abort' },
      { challenge: 'Above V1: throttles', response: 'TO' },
    ],
  },
  // ---------------- LON-P3-08: key emergency/abnormal procedures beyond the DGAC card. The controls and system
  // responses are all modelled (fire shutoff/bottles, cross-bleed air start, APU/PTCU generators, RSS, oxygen/MIC);
  // item sequencing marked EST follows Citation-family QRH practice where no public C700 text exists.
  {
    title: 'ENGINE FIRE L or R',
    phase: 'Emergency',
    items: [
      { challenge: 'ENG FIRE switchlight (affected side)', response: 'Push (fuel, hydraulics and bleed shut off; bottles armed)', check: (v) => v.get(V.fireEngL) !== 0 || v.get(V.fireEngR) !== 0 },
      { challenge: 'BOTTLE 1 ARMED switchlight', response: 'Push (discharge)' },
      { challenge: 'If ENG FIRE remains illuminated after 30 s: BOTTLE 2', response: 'Push (discharge)' },
      // The fire switch cuts fuel with RUN still selected, so the red ENGINE FAIL posts until RUN/STOP is set to STOP.
      { challenge: 'ENGINE RUN/STOP button (affected side)', response: 'STOP', check: (v) => v.get(V.runL) === 0 || v.get(V.runR) === 0 },
      { challenge: 'Land', response: 'As soon as possible' }, // EST (standard fire-procedure closure)
    ],
  },
  {
    title: 'ENGINE FAILURE / SHUTDOWN IN FLIGHT',
    phase: 'Emergency',
    items: [
      { challenge: 'Throttle (affected side)', response: 'IDLE' },
      { challenge: 'ENGINE RUN/STOP button (affected side)', response: 'STOP', check: (v) => v.get(V.runL) === 0 || v.get(V.runR) === 0 },
      { challenge: 'Rudder / aileron trim', response: 'As required' },
      { challenge: 'APU knob (at or below FL310)', response: 'Consider ON / START' },
      { challenge: '---- AIR START (no fire / damage suspected) ----', response: '' },
      // OG 7 / 17-12 cross-bleed: the operating engine at idle + 25 % N1 gives >= 32 psi starter pressure (EST in
      // flight; the OG publishes the requirement for ground cross-bleed starts).
      { challenge: 'a. Operating engine', response: 'IDLE + 25 % N1 minimum' },
      { challenge: 'b. ENGINE RUN/STOP button (affected side)', response: 'RUN' },
      { challenge: 'c. START pressure', response: 'Verify >= 32 psi' },
      { challenge: 'd. ENGINE STARTER button', response: 'Push' },
      { challenge: 'e. Engine instruments', response: 'Monitor (ITT < 650 C)', check: (v) => v.get('eng1.running') !== 0 && v.get('eng2.running') !== 0 },
    ],
  },
  {
    title: 'DUAL GENERATOR FAILURE', // EST flow (dossier §6 abnormal table: APU gen or PTCU HYD GEN, ELEC EMER)
    phase: 'Emergency',
    items: [
      { challenge: 'GEN switches (both)', response: 'RESET, then ON' },
      { challenge: 'If not restored: APU knob (at or below FL310)', response: 'ON / START, APU GEN ON' },
      { challenge: 'Or: PTCU knob', response: 'HYD GEN', check: (v) => v.get('elec.gen_l_online') !== 0 || v.get('elec.gen_r_online') !== 0 || v.get('elec.apu_gen_online') !== 0 || v.get(V.ptcu) === 4 },
      { challenge: 'If on batteries only: ELEC L and R buttons', response: 'EMER (shed the main buses)' },
      { challenge: 'Land', response: 'As soon as practical' },
    ],
  },
  {
    title: 'HYD SYSTEM A or B FAILURE', // EST flow (OG 13: A also feeds the rudder with RSS backup; accumulators)
    phase: 'Abnormal',
    items: [
      { challenge: 'Hydraulic pressure / quantity (synoptics)', response: 'Check' },
      { challenge: 'HYDRAULIC PUMP knob (affected side)', response: 'MIN; SHUTOFF if overheat or quantity loss' },
      { challenge: 'System A failed', response: 'Rudder on the standby (RSS) system; L reverser inoperative' },
      { challenge: 'System B failed', response: 'R reverser inoperative; ground spoilers on the accumulator' },
      { challenge: 'Landing distance', response: 'Plan for the increase; land as soon as practical' },
    ],
  },
  {
    title: 'SMOKE / FUMES', // EST flow (Citation-family practice; masks/MIC per the DGAC CABIN ALTITUDE items)
    phase: 'Emergency',
    items: [
      { challenge: 'Oxygen masks', response: 'Don and 100 %', check: (v) => v.get(V.oxyMaskL) !== 0 && v.get(V.oxyMode) >= 1 },
      { challenge: 'MIC SEL buttons (both)', response: 'MASK', check: (v) => v.get(V.micSelL) !== 0 && v.get(V.micSelR) !== 0 },
      { challenge: 'PRESS SOURCE button (suspected side)', response: 'OFF (isolate the bleed source)' },
      { challenge: 'If smoke persists', response: 'Consider descent and PRESS DUMP (guarded)' },
      { challenge: 'Land', response: 'As soon as possible' },
    ],
  },
  {
    title: "BATTERY O'TEMP L or R",
    phase: 'Emergency',
    items: [{ challenge: 'BATT button (affected side)', response: 'OFF' }],
  },
  {
    // DGAC UNCOMMANDED ENGINE THRUST / UNRESPONSIVE OR JAMMED THROTTLE (the card's ground item), with the FADEC
    // ENG CONTROL FAULT CAS (EST text) as the trigger.
    title: 'ENG CONTROL FAULT / UNCOMMANDED THRUST',
    phase: 'Abnormal',
    items: [
      { challenge: 'On the ground: engine fire button (affected side)', response: 'Push' },
      { challenge: 'In flight: throttle (affected side)', response: 'As required' },
      { challenge: 'If thrust is uncontrollable: ENGINE RUN/STOP (affected side)', response: 'STOP' },
    ],
  },
];
