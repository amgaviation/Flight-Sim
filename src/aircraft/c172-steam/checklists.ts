/**
 * Cessna 172S (steam gauges, NAV II) checklists: the POH Section 3 / 4 lists (c172s-common
 * checklistsSteam.ts, an item-by-item 172SPHUS transcription) with the steam-only live checks
 * (procedure monitor latches, Bendix/King radio states, DG) passed in as hooks, plus the avionics
 * supplements:
 *
 *  - Supplement 15 (KAP 140 2 axis autopilot with altitude preselect) Section 3 emergency
 *    procedure, Section 4 A preflight test (limitation 1: "must be successfully completed prior
 *    to each flight"; steps 3 a-f as in the supplement, transcription of the Bakersfield Flying
 *    Club copy of Supplement 15 pp 20-21), before takeoff, after takeoff, climb / descent,
 *    heading, NAV / APR / GS coupling, missed approach and before landing.
 *  - Supplement 2 (KT 76C transponder with blind encoder) Section 3 / 4: emergency 7700, loss of
 *    communications 7600, before takeoff SBY, Mode A / Mode C in flight, self test.
 *  - Supplement 4 (Pointer 3000-11 ELT) Section 3: ELT before / after a forced landing.
 *  - Supplement 20 (KMA 28): emergency (OFF/EMG) operation, from the Figure 1 item 11 description.
 *  - KLN 94 turn-on and self test (KLN 94 Pilot's Guide 006-18207-0000 section 3.2).
 *
 * Supplements 1 (KX 155A) and 6 (KR 87) have no Section 3 procedures ("no change") and their
 * Section 4 is an operating description, so they add no list.
 *
 * The lists are ordered by flight phase (`STEAM_PHASE_ORDER`) so a supplement's list sits with
 * the POH list of its phase (KLN 94 turn-on after Starting Engine, the KAP 140 preflight before
 * Before Takeoff, KAP 140 after-takeoff with Enroute Climb ...); emergencies come last.
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, AP, FDM, NAV, SURF } from '../../core/vars';
import { c172Checklists } from '../c172s-common/checklists';
import type { C172SteamChecklistHooks } from '../c172s-common/checklistsSteam';
import { C172, ELT_SW } from '../c172s-common/vars';
import { KAP, KLN, KMA, KT, KX, ST } from './vars';
import { KT_MODE } from './avionics/kt76c';
import { STEAM_PROC } from './procedures';
import { TAKEOFF_TRIM } from '../c172s-common/states';

type V = SimContext['vars'];
const on = (name: string) => (v: V) => v.get(name) > 0.5;
const off = (name: string) => (v: V) => v.get(name) < 0.5;
const apOff = off('ap.engaged');
const avionicsOn = (v: V) => v.get(C172.avionicsBus1) > 0.5 && v.get(C172.avionicsBus2) > 0.5;
const ktMode = (m: number) => (v: V) => Math.round(v.get(KT.mode)) === m;
const squawk = (code: number) => (v: V) => Math.round(v.get(NAV.xpdrCode)) === code;
const wrap180 = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;
const header = (text: string) => ({ challenge: text, response: '' });

/** Steam-only checks for the shared POH lists. */
export const STEAM_CHECKLIST_HOOKS: C172SteamChecklistHooks = {
  avnFanHeard: on(STEAM_PROC.avnFanHeard),
  annTestOk: on(STEAM_PROC.annTestOk),
  // "Radios - ON": both KX 155A, the KMA 28 and the KT 76C on (SBY or ALT).
  radiosOn: (v) => v.get(KX(1).on) > 0.5 && v.get(KX(2).on) > 0.5 && v.get(KMA.on) > 0.5 && v.get(KT.on) > 0.5 && Math.round(v.get(KT.mode)) !== KT_MODE.off,
  // Altimeter set to the local QNH (0.02 inHg) and the DG aligned with the compass (5 deg).
  flightInstruments: (v) =>
    v.get(ADC.baroStd(1)) < 0.5 && Math.abs(v.get(ADC.baroSetting(1)) - v.get('env.qnh_inhg', 29.92)) <= 0.02 && Math.abs(wrap180(v.get(ST.dgHeading) - v.get(FDM.headingMag))) <= 5,
  magCheckOk: on(STEAM_PROC.magCheckOk),
  // NAV/GPS SET: NAV, or GPS only with the KLN 94 navigating (Supplement 19).
  navGpsSet: (v) => v.get(ST.cdiSource) < 0.5 || v.get(KLN.navReady) > 0.5,
  manualTrimChecked: (v) => [STEAM_PROC.metLhOk, STEAM_PROC.metRhOk, STEAM_PROC.metDnOk, STEAM_PROC.metUpOk, STEAM_PROC.metIntOk].every((n) => v.get(n) > 0.5),
  xpdrAlt: ktMode(KT_MODE.alt),
  maydaySquawk: (v) => Math.abs(v.get(NAV.comActive(1)) - 121.5) < 0.003 && squawk(7700)(v),
  taxiInstruments: (v) => v.get('elec.turn_coord_powered') > 0.5 && v.get('ac.vac.suction_inhg') >= 4.5,
};

/** Supplement 15 checklists (KAP 140, DG installation). */
export const KAP140_CHECKLISTS: Checklist[] = [
  {
    title: 'KAP 140 Preflight (Perform Prior to Each Flight)',
    phase: 'before takeoff',
    items: [
      { challenge: '1. AVIONICS MASTER', response: 'ON', check: avionicsOn },
      {
        challenge: '2. POWER APPLICATION AND SELF TEST',
        response: 'PFT sequence, display test, PITCH TRIM annunciator and disconnect tone; red P out after ~30 s',
        check: (v: V) => v.get(KAP.on) > 0.5 && v.get(KAP.pft) === 0 && v.get(KAP.pLamp) < 0.5,
      },
      { challenge: '3. MANUAL ELECTRIC TRIM', response: 'TEST as follows:' },
      { challenge: '   a. LH Switch', response: 'PUSH FORWARD to DN position and hold. OBSERVE NO MOVEMENT of Elevator Trim Wheel. Release switch to center OFF.' },
      { challenge: '   b. LH Switch', response: 'PULL AFT to UP position and hold for 5 seconds. OBSERVE NO MOVEMENT of Elevator Trim Wheel. Release switch to center OFF position.', check: on(STEAM_PROC.metLhOk) },
      { challenge: '   c. RH Switch', response: 'PUSH FORWARD to DN position and hold for 5 seconds. OBSERVE NO MOVEMENT of Elevator Trim Wheel. Verify red P/T light above AP button. Release switch to center OFF position.' },
      { challenge: '   d. RH Switch', response: 'PULL AFT to UP position and hold for 5 seconds. OBSERVE NO MOVEMENT of Elevator Trim Wheel. Verify red P/T light above AP button. Release switch to center OFF position.', check: on(STEAM_PROC.metRhOk) },
      {
        challenge: '   e. LH and RH Switch',
        response:
          'PUSH FORWARD SIMULTANEOUSLY and HOLD. OBSERVE MOVEMENT of Elevator Trim Wheel in proper direction (nose down). While holding, PRESS and HOLD A/P DISC/TRIM INT Switch: OBSERVE NO MOVEMENT. RELEASE A/P DISC/TRIM INT: OBSERVE MOVEMENT. Release switches to center OFF.',
        check: (v: V) => v.get(STEAM_PROC.metDnOk) > 0.5 && v.get(STEAM_PROC.metIntOk) > 0.5,
      },
      {
        challenge: '   f. LH and RH Switch',
        response: 'PULL AFT SIMULTANEOUSLY and HOLD. OBSERVE MOVEMENT of Elevator Trim Wheel in proper direction (nose up); it stops while A/P DISC/TRIM INT is held. Release switches to center OFF.',
        check: on(STEAM_PROC.metUpOk),
      },
      { challenge: '4. FLASHING BARO SETTING', response: 'SET proper BARO setting manually (or press BARO to accept the present value)', check: off(KAP.baroFlash) },
      { challenge: '5. AUTOPILOT', response: 'ENGAGE by pressing AP button', check: (v: V) => v.get('ap.engaged') > 0.5 || v.get(STEAM_PROC.apOverpowered) > 0.5 },
      { challenge: '6. FLIGHT CONTROLS', response: 'MOVE fore, aft, left, right to verify the autopilot can be overpowered', check: on(STEAM_PROC.apOverpowered) },
      { challenge: '7. A/P DISC/TRIM INT Switch', response: 'PRESS. Verify that the autopilot disconnects.', check: apOff },
      { challenge: '8. TRIM', response: 'SET to take off position manually', check: (v: V) => Math.abs(v.get(C172.trimPosition) - TAKEOFF_TRIM) < 0.03 },
    ],
  },
  {
    title: 'KAP 140 Before Takeoff',
    phase: 'before takeoff',
    items: [
      { challenge: 'A/P DISC/TRIM INT Switch', response: 'PRESS', check: apOff },
      { challenge: 'BARO setting', response: 'CHECK', check: off(KAP.baroFlash) },
      { challenge: 'ALTITUDE SELECT Knob', response: 'ROTATE until the desired altitude is displayed', check: (v: V) => v.get(AP.selAltitude) > 0 },
    ],
  },
  {
    title: 'KAP 140 After Takeoff / Engagement',
    phase: 'climb',
    items: [
      { challenge: 'Elevator Trim', response: 'VERIFY or SET (trimmed condition before engagement)' },
      { challenge: 'Airspeed and Rate of Climb', response: 'STABILIZED (70-140 KIAS)', check: (v: V) => v.get(ADC.ias(1)) >= 70 && v.get(ADC.ias(1)) <= 140 },
      { challenge: 'AP Button', response: 'PRESS and HOLD — note ROL and VS annunciators', check: on('ap.engaged') },
      { challenge: 'ALTITUDE SELECT Knob', response: 'ROTATE to the desired altitude (ARM annunciated)', check: on(KAP.armSel) },
      { challenge: 'VERTICAL SPEED (UP / DN)', response: 'SET climb rate within +1500 / -2000 fpm (not on the performance limit)' },
    ],
  },
  {
    title: 'KAP 140 Heading / NAV Coupling (DG)',
    phase: 'cruise',
    items: [
      { challenge: 'Heading Selector Knob', response: 'SET BUG to desired heading; HDG button PRESS' },
      { challenge: 'OBS Knob', response: 'SELECT desired course' },
      { challenge: 'NAV Mode Selector Button', response: 'PRESS — note NAV ARM' },
      { challenge: 'Heading Selector Knob', response: 'ROTATE BUG to agree with OBS course (HDG flashes 5 s)' },
      { challenge: 'NAV/GPS Switch', response: 'NAV (NAV 1) or GPS as the autopilot navigation source' },
    ],
  },
  {
    title: 'KAP 140 Approach (APR) and Glideslope Coupling (DG)',
    phase: 'approach',
    items: [
      { challenge: 'BARO setting', response: 'CHECK', check: off(KAP.baroFlash) },
      { challenge: 'OBS Knob', response: 'SELECT desired approach course (for a localizer: memory aid)' },
      { challenge: 'APR Mode Selector Button', response: 'PRESS — note APR ARM' },
      { challenge: 'Heading Selector Knob', response: 'ROTATE BUG to agree with desired approach' },
      { challenge: 'Airspeed', response: 'MAINTAIN 90 KIAS minimum during coupled approaches (recommended)', check: (v: V) => v.get(ADC.ias(1)) >= 90 },
      { challenge: 'Wing Flaps', response: '10° maximum with the autopilot engaged', check: (v: V) => v.get(SURF.flapsDeg) <= 10.5 },
      { challenge: 'APR Mode', response: 'ENGAGED — note GS ARM; at glideslope centering ARM goes out', check: on('ap.engaged') },
    ],
  },
  {
    title: 'KAP 140 Missed Approach',
    phase: 'go-around',
    items: [
      { challenge: 'A/P DISC/TRIM INT Switch', response: 'PRESS to disengage AP', check: apOff },
      { challenge: 'MISSED APPROACH', response: 'EXECUTE' },
      { challenge: 'If autopilot desired: Elevator Trim', response: 'VERIFY or SET' },
      { challenge: 'Airspeed and Rate of Climb', response: 'STABILIZED' },
      { challenge: 'AP Button', response: 'PRESS and HOLD — ROL and VS; verify VSI and autopilot VS agree' },
    ],
  },
  {
    title: 'KAP 140 Before Landing',
    phase: 'landing',
    items: [{ challenge: 'A/P DISC/TRIM INT Switch', response: 'PRESS and HOLD to disengage AP (below 200 ft AGL on approaches)', check: apOff }],
  },
  {
    title: 'EMERGENCY — Autopilot, Autopilot Trim or Manual Electric Trim Malfunction',
    phase: 'emergency',
    items: [
      { challenge: 'A. Airplane Control Wheel', response: 'GRASP FIRMLY and regain aircraft control' },
      { challenge: 'B. A/P DISC/TRIM INT Switch', response: 'PRESS and HOLD throughout recovery', check: on(ST.apDisc) },
      { challenge: 'C. AIRCRAFT', response: 'RE-TRIM Manually as Needed' },
      { challenge: 'D. AUTO PILOT Circuit Breaker', response: 'PULL', check: (v: V) => v.get('cb.autopilot', 1) < 0.5 },
      { challenge: 'Do not re-engage the autopilot', response: 'until the cause has been corrected' },
    ],
  },
  {
    title: 'EMERGENCY — "CHECK PITCH TRIM" Voice Message',
    phase: 'emergency',
    items: [
      { challenge: 'a. Airplane Control Wheel', response: 'GRASP FIRMLY and regain aircraft control' },
      { challenge: 'b. A/P DISC/TRIM INT Switch', response: 'PRESS and HOLD throughout recovery' },
      { challenge: 'c. AIRPLANE', response: 'RETRIM Manually as Needed' },
      { challenge: 'd. AUTO PILOT Circuit Breaker', response: 'PULL', check: (v: V) => v.get('cb.autopilot', 1) < 0.5 },
    ],
  },
];

/** KLN 94 turn-on (Pilot's Guide 3.2). */
export const KLN94_CHECKLISTS: Checklist[] = [
  {
    title: 'KLN 94 GPS Turn-On and Self Test',
    // After start ("Radios - ON", POH Starting Engine 14).
    phase: 'start',
    items: [
      { challenge: 'On/Off/Brightness Knob', response: 'PUSH IN (ON); adjust brightness', check: on(KLN.on) },
      { challenge: 'Power-On Page (~50 s)', response: 'CHECK ORS level' },
      { challenge: 'Self Test Page: Baro', response: 'ENTER altimeter setting' },
      { challenge: 'Self Test Page: #1 CDI (GPS selected)', response: 'CHECK half scale right, FROM; PASS' },
      { challenge: 'Self Test Page: OK?', response: 'ENT' },
      { challenge: 'Initialization Page', response: 'VERIFY date, time and waypoint; ENT' },
      { challenge: 'Database Page', response: 'CHECK expiration; ACKNOWLEDGE (ENT)', check: on(KLN.navReady) },
    ],
  },
];

/** Supplement 2 (KT 76C) Section 3 / 4 (POH 172SPHUS Supplement 2 pp S2-7 .. S2-9). */
export const KT76C_CHECKLISTS: Checklist[] = [
  {
    title: 'KT 76C Transponder — Before Takeoff (Supplement 2)',
    phase: 'before takeoff',
    items: [
      { challenge: '1. Mode Selector Knob', response: 'SBY', check: ktMode(KT_MODE.sby) },
      header('Current practice (AIM 4-1-20): transponder ALT while taxiing on the airport movement area, then for takeoff.'),
    ],
  },
  {
    title: 'KT 76C Transponder — In Flight (Supplement 2)',
    phase: 'takeoff',
    items: [
      header('TO TRANSMIT MODE C (ALTITUDE REPORTING) CODES IN FLIGHT:'),
      { challenge: '1. Transponder Code Selector Knob', response: 'SELECT assigned code' },
      { challenge: '2. Mode Selector Knob', response: 'ALT', check: ktMode(KT_MODE.alt) },
      header('NOTE: When directed by ground controller to "stop altitude squawk", turn Mode Selector Knob to ON for Mode A operation only.'),
      header('TO TRANSMIT MODE A (AIRCRAFT IDENTIFICATION) CODES IN FLIGHT:'),
      { challenge: '1. Numeric Keys 0-7', response: 'SELECT assigned code' },
      { challenge: '2. Mode Selector Knob', response: 'ON' },
      { challenge: '3. IDT Button', response: 'DEPRESS momentarily when instructed by ground controller to "squawk IDENT" ("R" will illuminate steadily indicating IDENT operation)' },
      header('TO SELF-TEST TRANSPONDER OPERATION:'),
      { challenge: '1. Mode Selector Knob', response: 'TST. Check all displays.' },
      { challenge: '2. Mode Selector Knob', response: 'SELECT desired function' },
      header('TO PROGRAM VFR CODE: Mode Selector Knob SBY; Numeric Keys 0-7 SELECT desired VFR code; IDT Button PRESS AND HOLD; VFR Code Button PRESS (while still holding IDT).'),
    ],
  },
  {
    title: 'EMERGENCY — Transponder: Emergency Signal (7700) / Loss of Communications (7600) (Supplement 2)',
    phase: 'emergency',
    items: [
      header('TO TRANSMIT AN EMERGENCY SIGNAL:'),
      { challenge: '1. Mode Selector Knob', response: 'ALT', check: ktMode(KT_MODE.alt) },
      { challenge: '2. Numeric Keys 0-7', response: 'SELECT 7700 operating code', check: squawk(7700) },
      header('TO TRANSMIT A SIGNAL REPRESENTING LOSS OF ALL COMMUNICATIONS (WHEN IN A CONTROLLED ENVIRONMENT):'),
      { challenge: '1. Mode Selector Knob', response: 'ALT', check: ktMode(KT_MODE.alt) },
      { challenge: '2. Numeric Keys 0-7', response: 'SELECT 7600 operating code', check: squawk(7600) },
    ],
  },
];

/** Supplement 4 (Pointer 3000-11 ELT) Section 3 (POH 172SPHUS Supplement 4 p S4-7). */
export const ELT_CHECKLISTS: Checklist[] = [
  {
    title: 'EMERGENCY — ELT: Forced Landing (Supplement 4)',
    phase: 'emergency',
    items: [
      {
        challenge: 'Before a forced landing (especially in remote and mountainous areas): ELT Remote Switch/Annunciator',
        response: 'ON (the annunciator in the center of the rocker switch should be illuminated)',
        check: (v: V) => Math.round(v.get(C172.elt)) === ELT_SW.on,
      },
      header('Immediately after a forced landing where emergency assistance is required:'),
      { challenge: '1. ENSURE ELT ACTIVATION: a. Remote Switch/Annunciator', response: 'ON even if annunciator light is already on', check: (v: V) => Math.round(v.get(C172.elt)) === ELT_SW.on },
      { challenge: '   b. Airplane radio (if operable and safe to use)', response: 'ON, select 121.5 MHz. If the ELT can be heard transmitting, it is working properly.', check: (v: V) => Math.abs(v.get(NAV.comActive(1)) - 121.5) < 0.003 || Math.abs(v.get(NAV.comActive(2)) - 121.5) < 0.003 },
      { challenge: '   c. Antenna', response: 'Ensure clear of obstructions' },
      { challenge: '2. PRIOR TO SIGHTING RESCUE AIRCRAFT', response: 'Conserve airplane battery. Do not activate radio transceiver.' },
      { challenge: '3. AFTER SIGHTING RESCUE AIRCRAFT', response: 'Remote switch/annunciator RESET and release to AUTO; contact rescue aircraft on 121.5 MHz. If no contact, return the remote switch/annunciator to ON immediately.' },
      { challenge: '4. FOLLOWING RESCUE', response: 'Remote switch/annunciator to AUTO, terminating emergency transmissions', check: (v: V) => Math.round(v.get(C172.elt)) === ELT_SW.arm },
    ],
  },
];

/**
 * Supplement 20 (KMA 28) emergency operation. SCOPE: from the Figure 1 item 11 description of the
 * volume/power knob (OFF = emergency mode, pilot mic and headset connected directly to COM 1; audio
 * amplifier, alert tones and marker receiver inoperative); the Section 3 page itself was not found.
 */
export const KMA28_CHECKLISTS: Checklist[] = [
  {
    title: 'EMERGENCY — Audio Panel Failure: KMA 28 Emergency (EMG) Operation (Supplement 20)',
    phase: 'emergency',
    items: [
      { challenge: '1. KMA 28 Volume/Power Knob', response: 'OFF (EMG): pilot mic and headset connected directly to COM 1 (fail-safe)', check: (v: V) => v.get(KMA.power) < 0.5 },
      { challenge: '2. COM 1', response: 'USE for communication (COM 2, NAV / ADF / marker audio and the autopilot disconnect tone are not available)', check: (v: V) => v.get(KX(1).on) > 0.5 },
    ],
  },
];

/** Flight-phase order of the checklist viewer tabs. */
export const STEAM_PHASE_ORDER = [
  'preflight',
  'before start',
  'start',
  'taxi',
  'before takeoff',
  'takeoff',
  'climb',
  'cruise',
  'descent',
  'approach',
  'landing',
  'go-around',
  'after landing',
  'shutdown',
  'emergency',
] as const;

/** Supplement lists that precede the POH list of their phase (performed before it). */
const BEFORE_POH = new Set(['KAP 140 Preflight (Perform Prior to Each Flight)']);

/** All steam-variant checklists: POH normal / emergency (shared) with the supplements, in phase order. */
export function c172SteamChecklists(): Checklist[] {
  const poh = c172Checklists('steam', STEAM_CHECKLIST_HOOKS);
  const supp = [...KLN94_CHECKLISTS, ...KT76C_CHECKLISTS, ...KAP140_CHECKLISTS, ...ELT_CHECKLISTS, ...KMA28_CHECKLISTS];
  const rank = (c: Checklist, i: number, isSupp: boolean): number => {
    const p = (STEAM_PHASE_ORDER as readonly string[]).indexOf(c.phase);
    const phase = p < 0 ? STEAM_PHASE_ORDER.length : p;
    const sub = isSupp ? (BEFORE_POH.has(c.title) ? 0 : 2) : 1;
    return phase * 1e6 + sub * 1e4 + i;
  };
  const ranked = [...poh.map((c, i) => ({ c, r: rank(c, i, false) })), ...supp.map((c, i) => ({ c, r: rank(c, i, true) }))];
  ranked.sort((a, b) => a.r - b.r);
  return ranked.map((x) => x.c);
}

export const C172_STEAM_CHECKLISTS: Checklist[] = c172SteamChecklists();
