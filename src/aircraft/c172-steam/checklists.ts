/**
 * Cessna 172S (steam gauges, NAV II) checklists: the POH Section 3 / 4 lists shared with the
 * G1000 variant (c172s-common, 172SPHUS Rev 5 wording) plus the avionics supplements:
 *
 *  - Supplement 15 (KAP 140 2 axis autopilot with altitude preselect) Section 3 emergency
 *    procedure, Section 4 A preflight test (limitation 1: "must be successfully completed prior
 *    to each flight"), before takeoff, after takeoff, climb / descent, altitude hold, heading,
 *    NAV / APR / REV / GS coupling, missed approach and before landing.
 *  - KLN 94 turn-on and self test (KLN 94 Pilot's Guide 006-18207-0000 section 3.2).
 *
 * Wording is the supplement's, abbreviated where the item is an explanation.
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, AP, SURF } from '../../core/vars';
import { c172Checklists } from '../c172s-common/checklists';
import { C172 } from '../c172s-common/vars';
import { KAP, KLN, ST } from './vars';

type V = SimContext['vars'];
const on = (name: string) => (v: V) => v.get(name) > 0.5;
const off = (name: string) => (v: V) => v.get(name) < 0.5;
const apOff = off('ap.engaged');
const avionicsOn = (v: V) => v.get(C172.avionicsBus1) > 0.5 && v.get(C172.avionicsBus2) > 0.5;

/** Supplement 15 checklists (KAP 140, DG installation). */
export const KAP140_CHECKLISTS: Checklist[] = [
  {
    title: 'KAP 140 Preflight (Perform Prior to Each Flight)',
    phase: 'before takeoff',
    items: [
      { challenge: 'AVIONICS MASTER Switch', response: 'ON', check: avionicsOn },
      {
        challenge: 'POWER APPLICATION AND SELF-TEST',
        response: 'PFT sequence, display test, PITCH TRIM annunciator and disconnect tone; red P out after ~30 s',
        check: (v: V) => v.get(KAP.on) > 0.5 && v.get(KAP.pft) === 0 && v.get(KAP.pLamp) < 0.5,
      },
      { challenge: 'MANUAL ELECTRIC TRIM — LH switch DN / UP alone', response: 'NO MOVEMENT of elevator trim wheel' },
      { challenge: 'RH switch DN / UP alone, hold 5 s', response: 'NO MOVEMENT; red P/T on the autopilot display' },
      { challenge: 'LH and RH forward / aft together', response: 'Trim wheel moves nose DN / nose UP; stops while A/P DISC/TRIM INT held' },
      { challenge: 'FLASHING BARO SETTING', response: 'SET (or press BARO to accept)', check: off(KAP.baroFlash) },
      { challenge: 'AUTOPILOT', response: 'ENGAGE (press AP button)', check: on('ap.engaged') },
      { challenge: 'FLIGHT CONTROLS', response: 'MOVE fore, aft, left and right to verify the autopilot can be overpowered' },
      { challenge: 'A/P DISC/TRIM INT Switch', response: 'PRESS; verify that the autopilot disconnects', check: apOff },
      { challenge: 'TRIM', response: 'SET to takeoff position manually' },
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
      { challenge: 'Airspeed', response: 'MAINTAIN 90 KIAS minimum during coupled approaches (recommended)', check: (v: V) => v.get(ADC.ias(1)) >= 80 },
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
      { challenge: 'AP Button', response: 'PRESS — ROL and VS; verify VSI and autopilot VS agree' },
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
    phase: 'before takeoff',
    items: [
      { challenge: 'On/Off/Brightness Knob', response: 'PUSH IN (ON); adjust brightness', check: on(KLN.on) },
      { challenge: 'Power-On Page (~50 s)', response: 'CHECK ORS level' },
      { challenge: 'Self Test Page: Baro', response: 'ENTER altimeter setting' },
      { challenge: 'Self Test Page: #1 CDI (GPS selected)', response: 'CHECK half scale right, FROM; annunciators on; PASS' },
      { challenge: 'Self Test Page: OK?', response: 'ENT' },
      { challenge: 'Initialization Page', response: 'VERIFY date, time and waypoint; ENT' },
      { challenge: 'Database Page', response: 'CHECK expiration; ACKNOWLEDGE (ENT)', check: on(KLN.navReady) },
    ],
  },
];

/** All steam-variant checklists: POH normal / emergency (shared), then the supplements. */
export function c172SteamChecklists(): Checklist[] {
  const base = c172Checklists('steam');
  const normal = base.filter((c) => c.phase !== 'emergency');
  const emergency = base.filter((c) => c.phase === 'emergency');
  const kapEmergency = KAP140_CHECKLISTS.filter((c) => c.phase === 'emergency');
  const kapNormal = KAP140_CHECKLISTS.filter((c) => c.phase !== 'emergency');
  return [...normal, ...KLN94_CHECKLISTS, ...kapNormal, ...emergency, ...kapEmergency];
}

export const C172_STEAM_CHECKLISTS: Checklist[] = c172SteamChecklists();
