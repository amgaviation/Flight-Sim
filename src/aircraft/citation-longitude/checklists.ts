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
      { challenge: 'External power / APU', response: 'As desired (BATT amps 0 or charging)', check: (v) => v.get('elec.gpu_online') !== 0 || v.get('apu.avail') !== 0 },
      { challenge: 'Exterior / interior lights', response: 'ON / check / OFF, or as required' },
    ],
  },
  {
    title: 'Cockpit Preparation',
    phase: 'Preflight',
    items: [
      { challenge: 'Cockpit inspection', response: 'Complete' },
      { challenge: 'APU knob', response: 'ON / START', check: (v) => v.get('apu.avail') !== 0 },
      { challenge: 'External power', response: 'Disconnected', check: off('elec.gpu_online') },
      { challenge: 'Engine dry motor', response: 'Consider', check: (v) => v.get(V.dryMotorReq(1)) === 0 && v.get(V.dryMotorReq(2)) === 0 },
      { challenge: 'Trims', response: 'Check / set for takeoff (stab per CG chart)', check: (v) => v.get('trim.pitch_to_ok') !== 0 && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0 },
      { challenge: 'Weight and fuel (MFD GTC: PERF)', response: 'Completed' },
      { challenge: 'Takeoff data (MFD GTC: PERF)', response: 'Completed' },
      { challenge: 'V speeds', response: 'Verify / set' },
      { challenge: 'Pressurization LDG ELEV', response: 'Verify / set' },
      { challenge: 'Fuel quantity and balance', response: 'Check', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) < 227 },
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
      { challenge: 'ENGINE RUN/STOP button (R first)', response: 'RUN', check: on(V.runR) },
      { challenge: 'START pressure', response: 'Verify >= 32 psi' },
      { challenge: 'ENGINE STARTER button', response: 'Push' },
      { challenge: 'Engine instruments', response: 'Monitor (ITT < 650 C)', check: on('eng2.running') },
      { challenge: 'Opposite engine', response: 'Repeat', check: (v) => v.get('eng1.running') !== 0 && v.get(V.runL) !== 0 },
      { challenge: 'EIS / CAS', response: 'Check', check: (v) => v.get('elec.gen_l_online') !== 0 && v.get('elec.gen_r_online') !== 0 },
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
      // EST items from the pedestal / glareshield switchlights in the photographs (AFM text not public).
      { challenge: 'AUTO GROUND SPOILERS button', response: 'NORM (armed)', check: on(V.autoGndSplr) },
      { challenge: 'POWER RESERVE', response: 'AUTO (armed)', check: (v) => v.get(V.aprAuto) !== 0 && v.get(V.aprManual) === 0 },
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
      { challenge: 'Exterior lights', response: 'As required' },
      { challenge: 'EIS / CAS', response: 'Check (no NO TAKEOFF)', check: off(V.noTakeoff) },
    ],
  },
  {
    title: 'Takeoff',
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
      { challenge: 'Altimeters (RVSM)', response: 'Crosscheck within 200 ft' },
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
      { challenge: 'ENGINE STARTER', response: 'Release at 20 % N2 or 15 s' }, // OG 7-6
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
