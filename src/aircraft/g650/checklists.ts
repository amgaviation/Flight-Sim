/**
 * Gulfstream G650 electronic checklists (Epic ECL). Normal procedures after
 * the published G650 / G450 flow (code450.com "Before Starting Engines",
 * "Starting Engines", LUC system notes, LIM); abnormal lists named after the
 * CAS message so selecting the message opens the list (Epic "selectable CAS
 * messages"). Items with a `check` are sensed automatically (closed loop).
 */
import type { Checklist } from '../types';
import { G650_VARS as V } from './vars';

type Vars = { get(n: string, d?: number): number };
const on = (name: string) => (v: Vars) => v.get(name) !== 0;
const off = (name: string) => (v: Vars) => v.get(name) === 0;
const eq = (name: string, val: number) => (v: Vars) => v.get(name) === val;
const both = (a: (v: Vars) => boolean, b: (v: Vars) => boolean) => (v: Vars) => a(v) && b(v);

export const G650_CHECKLISTS: Checklist[] = [
  {
    title: 'Before Starting Engines',
    phase: 'Normal',
    items: [
      { challenge: 'MAIN BATTERIES (L / R)', response: 'ON, check voltage', check: both(eq(V.battL, 1), eq(V.battR, 1)) },
      { challenge: 'FLT CTRL BATTERIES (EBHA, UPS)', response: 'ON, SPOST complete', check: both(eq(V.ebhaBatt, 1), eq(V.upsBatt, 1)) },
      { challenge: 'EMERGENCY POWER', response: 'ARM', check: eq(V.emerPwr, 1) },
      { challenge: 'EMER LTS', response: 'ARM', check: eq(V.ltEmer, 1) },
      { challenge: 'IRS MODE SELECT (IRS 1-2-3)', response: 'ON (alignment starts)', check: (v) => v.get(V.irsMode(1)) === 2 && v.get(V.irsMode(2)) === 2 && v.get(V.irsMode(3)) === 2 },
      { challenge: 'APU', response: 'MASTER ON, START, READY / generator on line', check: (v) => v.get('apu.avail') !== 0 || v.get('elec.gpu_online') !== 0 },
      { challenge: 'L / R BUS TIE', response: 'AUTO', check: both(eq(V.busTieL, 1), eq(V.busTieR, 1)) },
      { challenge: 'L / R MAIN TRU', response: 'NORM', check: both(eq(V.lMainTru, 1), eq(V.rMainTru, 1)) },
      { challenge: 'CABIN / GALLEY MASTER', response: 'As required' },
      { challenge: 'FUEL pumps (MAIN and ALT)', response: 'ON', check: (v) => v.get(V.boostL) >= 1 && v.get(V.boostR) >= 1 && v.get(V.altL) === 1 && v.get(V.altR) === 1 },
      { challenge: 'X-FLOW / INTER TANK', response: 'CLOSED', check: both(eq(V.xflow, 0), eq(V.interTank, 0)) },
      { challenge: 'AUX PUMP / PWR XFR UNIT', response: 'ARM', check: both(eq(V.auxPump, 1), eq(V.ptu, 1)) },
      { challenge: 'BLEED AIR (L / R ENG)', response: 'OFF for start (APU ON)', check: both(eq(V.bleedL, 0), eq(V.bleedR, 0)) },
      { challenge: 'ISOLATION', response: 'AUTO', check: eq(V.isolation, 1) },
      { challenge: 'ANTI-ICE knobs', response: 'OFF (start)', check: (v) => v.get(V.wingL) === 0 && v.get(V.wingR) === 0 && v.get(V.cowlL) === 0 && v.get(V.cowlR) === 0 },
      { challenge: 'WINDSHIELD / CABIN WDO / EVS WDO HEAT', response: 'ON', check: both(eq(V.wshldL, 1), eq(V.wshldR, 1)) },
      { challenge: 'CREW / PASSENGER OXYGEN', response: 'ON / AUTO', check: both(eq(V.crewOxy, 1), eq(V.paxOxy, 1)) },
      { challenge: 'CABIN PRESSURE', response: 'AUTO, landing field set', check: eq(V.pressMode, 0) },
      { challenge: 'Parking brake', response: 'SET', check: on('brakes.parking_set') },
      { challenge: 'FUEL CONTROL switches', response: 'OFF', check: both(eq(V.fuelCtlL, 0), eq(V.fuelCtlR, 0)) },
      { challenge: 'BEACON', response: 'ON', check: eq(V.ltBeacon, 1) },
    ],
  },
  {
    title: 'Starting Engines',
    phase: 'Normal',
    items: [
      { challenge: 'START MASTER', response: 'ON (isolation valve opens, packs off)', check: eq(V.startMaster, 1) },
      { challenge: 'Bleed pressure', response: 'Check 40 psi minimum', check: (v) => v.get('pneu.l_duct_psi') >= 35 || v.get('pneu.r_duct_psi') >= 35 },
      { challenge: 'R ENG start', response: 'Press; FUEL CONTROL R RUN', check: eq(V.fuelCtlR, 1) },
      { challenge: 'R engine', response: 'Stabilized at idle (TGT < 700 C)', check: on('eng2.running') },
      { challenge: 'L ENG start', response: 'Press; FUEL CONTROL L RUN', check: eq(V.fuelCtlL, 1) },
      { challenge: 'L engine', response: 'Stabilized at idle', check: on('eng1.running') },
      { challenge: 'START MASTER', response: 'OFF', check: eq(V.startMaster, 0) },
    ],
  },
  {
    title: 'After Starting Engines',
    phase: 'Normal',
    items: [
      { challenge: 'L / R GEN', response: 'ON, on line', check: both(on('elec.idg1_online'), on('elec.idg2_online')) },
      { challenge: 'BLEED AIR (L / R ENG)', response: 'ON', check: both(eq(V.bleedL, 1), eq(V.bleedR, 1)) },
      { challenge: 'APU bleed / APU', response: 'OFF / as required' },
      { challenge: 'Hydraulic pressures', response: 'Check 3,000 psi', check: (v) => v.get('hyd.left_psi') > 2700 && v.get('hyd.right_psi') > 2700 },
      { challenge: 'Probe heaters (ANTI-ICE HTR 1-4)', response: 'ON', check: (v) => v.get(V.probe(1)) === 1 && v.get(V.probe(2)) === 1 && v.get(V.probe(3)) === 1 && v.get(V.probe(4)) === 1 },
      { challenge: 'NWS POWER', response: 'ON', check: eq(V.nwsPower, 1) },
      { challenge: 'CAS', response: 'Check' },
    ],
  },
  {
    title: 'Before Taxi',
    phase: 'Normal',
    items: [
      { challenge: 'Flight controls', response: 'Check (FCC normal mode)', check: (v) => v.get('fbw.mode_code') === 0 },
      { challenge: 'Flaps', response: '10 or 20 (TO)', check: (v) => v.get('surf.flaps_deg') > 8 && v.get('surf.flaps_deg') < 22 },
      { challenge: 'Pitch trim', response: 'Green band', check: (v) => v.get('trim.pitch_units') >= -0.2 && v.get('trim.pitch_units') <= 0.35 },
      { challenge: 'GND SPOILER', response: 'ARMED', check: eq(V.gndSpoiler, 1) },
      { challenge: 'AUTOBRAKE', response: 'RTO', check: eq(V.autobrake, -1) },
      { challenge: 'TRS / V-speeds', response: 'TO set / checked' },
      { challenge: 'IRS', response: 'Aligned (no "IRS 1-2-3 Aligning")', check: (v) => v.get('ahrs1.valid') !== 0 && v.get('ahrs2.valid') !== 0 },
      { challenge: 'Taxi light', response: 'ON', check: eq(V.ltTaxi, 1) },
    ],
  },
  {
    title: 'Before Takeoff',
    phase: 'Normal',
    items: [
      { challenge: 'Parking brake', response: 'Released', check: off('brakes.parking_set') },
      { challenge: 'Speed brake', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'Strobe / landing lights', response: 'ON', check: both(eq(V.ltStrobe, 1), eq(V.ltLdgL, 1)) },
      { challenge: 'Anti-ice', response: 'As required (2 min before takeoff thrust, LIM)' },
      { challenge: 'Transponder / TCAS', response: 'TA/RA' },
      { challenge: 'CAS', response: 'No takeoff configuration messages', check: off(V.noTakeoff) },
    ],
  },
  {
    title: 'After Takeoff / Climb',
    phase: 'Normal',
    items: [
      { challenge: 'Landing gear', response: 'UP', check: on('gear.up_locked') },
      { challenge: 'Flaps', response: 'UP', check: (v) => v.get('surf.flaps_deg') < 0.5 },
      { challenge: 'Autobrake', response: 'OFF', check: eq(V.autobrake, 0) },
      { challenge: 'Pressurization', response: 'Check' },
    ],
  },
  {
    title: 'Descent / Approach',
    phase: 'Normal',
    items: [
      { challenge: 'Landing field elevation / minimums', response: 'Set' },
      { challenge: 'Landing data (VREF)', response: 'Set' },
      { challenge: 'AUTOBRAKE', response: 'As required', check: (v) => v.get(V.autobrake) >= 0 },
      { challenge: 'Anti-ice', response: 'As required' },
    ],
  },
  {
    title: 'Before Landing',
    phase: 'Normal',
    items: [
      { challenge: 'Landing gear', response: 'DOWN, 3 green', check: on('gear.down_locked') },
      { challenge: 'Flaps', response: '39', check: (v) => v.get('surf.flaps_deg') > 38 },
      { challenge: 'GND SPOILER', response: 'ARMED', check: eq(V.gndSpoiler, 1) },
      { challenge: 'Speed brake', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.05 },
    ],
  },
  {
    title: 'After Landing',
    phase: 'Normal',
    items: [
      { challenge: 'Flaps', response: 'UP', check: (v) => v.get(V.flapLever) === 0 },
      { challenge: 'Speed brake', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'Strobe / landing lights', response: 'OFF', check: both(eq(V.ltStrobe, 0), eq(V.ltLdgL, 0)) },
      { challenge: 'APU', response: 'As required' },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Normal',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: on('brakes.parking_set') },
      { challenge: 'Engines', response: 'Idle 3 min (LUC), FUEL CONTROL OFF', check: both(eq(V.fuelCtlL, 0), eq(V.fuelCtlR, 0)) },
      { challenge: 'BEACON', response: 'OFF', check: eq(V.ltBeacon, 0) },
      { challenge: 'IRS MODE SELECT (IRS 1-2-3)', response: 'OFF (no ON BAT)', check: (v) => v.get(V.irsMode(1)) === 0 && v.get(V.irsMode(2)) === 0 && v.get(V.irsMode(3)) === 0 },
      { challenge: 'EMERGENCY POWER', response: 'OFF', check: eq(V.emerPwr, 0) },
      { challenge: 'MAIN BATTERIES', response: 'OFF', check: both(eq(V.battL, 0), eq(V.battR, 0)) },
    ],
  },
  // ---------------------------------------------------------------- abnormal / emergency (CAS-selectable)
  {
    title: 'L Engine Fire',
    phase: 'Emergency',
    items: [
      { challenge: 'L thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 },
      { challenge: 'L FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlL, 0) },
      { challenge: 'L fire handle', response: 'PULL', check: eq(V.fireHandleL, 1) },
      { challenge: 'Fire handle', response: 'Rotate outward (shot 1) / inward after 30 s (shot 2)', check: on('fire.bottle_r_discharged') },
    ],
  },
  {
    title: 'R Engine Fire',
    phase: 'Emergency',
    items: [
      { challenge: 'R thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(2)) < 0.05 },
      { challenge: 'R FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlR, 0) },
      { challenge: 'R fire handle', response: 'PULL', check: eq(V.fireHandleR, 1) },
      { challenge: 'Fire handle', response: 'Rotate outward (shot 1) / inward after 30 s (shot 2)', check: on('fire.bottle_r_discharged') },
    ],
  },
  {
    title: 'APU Fire',
    phase: 'Emergency',
    items: [
      { challenge: 'APU MASTER', response: 'OFF', check: eq(V.apuMaster, 0) },
      { challenge: 'APU FIRE EXT', response: 'Press (LEFT bottle)', check: on('fire.bottle_l_discharged') },
    ],
  },
  {
    title: 'L Generator Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'L GEN', response: 'OFF, then ON (one reset)' },
      { challenge: 'If not restored: APU', response: 'Start, APU GEN on line', check: on('elec.apu_gen_online') },
      { challenge: 'L BUS TIE', response: 'AUTO (R IDG / APU powers L MAIN AC)', check: on('elec.l_main_ac_powered') },
    ],
  },
  {
    title: 'R Generator Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'R GEN', response: 'OFF, then ON (one reset)' },
      { challenge: 'If not restored: APU', response: 'Start, APU GEN on line', check: on('elec.apu_gen_online') },
      { challenge: 'R BUS TIE', response: 'AUTO', check: on('elec.r_main_ac_powered') },
    ],
  },
  {
    title: 'L Hyd System Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'PWR XFR UNIT', response: 'ARM / ON', check: (v) => v.get(V.ptu) >= 1 },
      { challenge: 'AUX PUMP', response: 'ARM (gear / flaps)', check: (v) => v.get(V.auxPump) >= 1 },
      { challenge: 'Speed', response: '285 KCAS / M0.90 maximum (midboard spoilers lost)' },
      { challenge: 'Flight time', response: 'LIM: land within 1.5 h if within 1 h of takeoff (FL270 max)' },
    ],
  },
  {
    title: 'R Hyd System Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'Speed', response: '285 KCAS / M0.90 maximum' },
      { challenge: 'Landing distance', response: 'Inboard / outboard spoilers inop: increase' },
    ],
  },
  {
    title: 'Cabin Pressure Low',
    phase: 'Emergency',
    items: [
      { challenge: 'Crew oxygen masks', response: 'ON, 100 %', check: both(on(V.oxyMaskL), on(V.oxyMaskR)) },
      { challenge: 'PASSENGER OXYGEN', response: 'MAN', check: eq(V.paxOxy, 2) },
      { challenge: 'Emergency descent', response: 'Initiate' },
    ],
  },
];
