/**
 * Gulfstream G650 electronic checklists (Epic ECL). Normal procedures after
 * the published G650 / G450 flow (code450.com "Before Starting Engines",
 * "APU Start", "Engine Start", "Taxi", "Line Up", "Shutdown", "Securing";
 * LUC system notes, LIM); abnormal lists named after the CAS message so
 * selecting the message opens the list (Epic "selectable CAS messages",
 * dossier §7). Items with a `check` are sensed automatically (closed loop).
 *
 * Fix round 1 (procedures lens): fuel boost pumps ordered BEFORE the APU
 * start (code450 APU Start Checklist: "L MAIN Boost Pump ... ON" immediately
 * before "APU Master Switch ... ON", P01); discrete APU Start list; fire-test
 * items (P06); the published before-start item set (P08); PTU check on the
 * R-first engine start (P09); expanded Shutdown and a Securing list (P02);
 * Taxi / Line Up titles and phase lists (P04, P22); CAS-selectable abnormal
 * lists for the messages the sim posts (P10).
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
    // Abridged cockpit-preparation flow (code450 preflight; the walk-around itself is outside the sim).
    title: 'Cockpit Preparation',
    phase: 'Normal',
    items: [
      { challenge: 'Gear handle', response: 'DOWN', check: eq(V.gearHandle, 1) },
      { challenge: 'L / R fire handles', response: 'IN (stowed)', check: both(eq(V.fireHandleL, 0), eq(V.fireHandleR, 0)) },
      { challenge: 'FUEL CONTROL switches', response: 'OFF', check: both(eq(V.fuelCtlL, 0), eq(V.fuelCtlR, 0)) },
      { challenge: 'Power levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05 },
      { challenge: 'Speed brake', response: 'RETRACT detent', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'Parking brake', response: 'SET', check: on('brakes.parking_set') },
      { challenge: 'Fuel quantity', response: 'CHECK required fuel' },
    ],
  },
  {
    // code450 Before Starting Engines (items abridged to the modelled controls, published order).
    title: 'Before Starting Engines',
    phase: 'Normal',
    items: [
      { challenge: 'MAIN BATTERIES (Left / Right)', response: 'ON, check voltage 22 V minimum', check: (v) => v.get(V.battL) === 1 && v.get(V.battR) === 1 && v.get('elec.l_batt_bus_v') >= 22 && v.get('elec.r_batt_bus_v') >= 22 },
      { challenge: 'FLT CTRL BATTERIES (EBHA, UPS)', response: 'ON, SPOST complete', check: both(eq(V.ebhaBatt, 1), eq(V.upsBatt, 1)) },
      { challenge: 'EMERGENCY POWER', response: 'ARM', check: eq(V.emerPwr, 1) },
      { challenge: 'EMER LTS', response: 'ARM', check: eq(V.ltEmer, 1) },
      { challenge: 'IRS MODE SELECT (IRS 1-2-3)', response: 'ON (alignment starts)', check: (v) => v.get(V.irsMode(1)) === 2 && v.get(V.irsMode(2)) === 2 && v.get(V.irsMode(3)) === 2 },
      // code450 items 13-14: engine fire detection tests before start (P06).
      { challenge: 'Engine Fire Detection FAULT TEST', response: 'TESTED', check: on(V.fireTested('fault')) },
      { challenge: 'L ENG Fire Test (LOOP A / B)', response: 'TESTED', check: on(V.fireTested('l')) },
      { challenge: 'R ENG Fire Test (LOOP A / B)', response: 'TESTED', check: on(V.fireTested('r')) },
      // L MAIN boost pump ON immediately before the APU master (code450 APU Start Checklist, P01):
      // an RE220 start without boost pressure hangs with no light-off.
      { challenge: 'FUEL pumps (MAIN and ALT)', response: 'ON', check: (v) => v.get(V.boostL) >= 1 && v.get(V.boostR) >= 1 && v.get(V.altL) === 1 && v.get(V.altR) === 1 },
      { challenge: 'APU', response: 'START (APU Start checklist) / generator on line', check: (v) => v.get('apu.avail') !== 0 || v.get('elec.gpu_online') !== 0 },
      { challenge: 'L / R BUS TIE', response: 'AUTO', check: both(eq(V.busTieL, 1), eq(V.busTieR, 1)) },
      { challenge: 'L / R MAIN TRU', response: 'NORM', check: both(eq(V.lMainTru, 1), eq(V.rMainTru, 1)) },
      { challenge: 'CABIN / GALLEY MASTER', response: 'As required' },
      { challenge: 'X-FLOW / INTER TANK', response: 'CLOSED', check: both(eq(V.xflow, 0), eq(V.interTank, 0)) },
      { challenge: 'AUX PUMP / PWR XFR Unit (PTU)', response: 'ARM', check: both(eq(V.auxPump, 1), eq(V.ptu, 1)) },
      { challenge: 'BLEED AIR (L / R ENG)', response: 'OFF for start (APU ON)', check: both(eq(V.bleedL, 0), eq(V.bleedR, 0)) },
      { challenge: 'ISOLATION', response: 'AUTO', check: eq(V.isolation, 1) },
      { challenge: 'ANTI-ICE knobs', response: 'OFF (start)', check: (v) => v.get(V.wingL) === 0 && v.get(V.wingR) === 0 && v.get(V.cowlL) === 0 && v.get(V.cowlR) === 0 },
      { challenge: 'WINDSHIELD / CABIN WDO / EVS WDO HEAT', response: 'ON', check: both(eq(V.wshldL, 1), eq(V.wshldR, 1)) },
      { challenge: 'CREW / PASSENGER OXYGEN', response: 'ON / AUTO', check: both(eq(V.crewOxy, 1), eq(V.paxOxy, 1)) },
      { challenge: 'CABIN PRESSURE', response: 'AUTO, landing field set', check: eq(V.pressMode, 0) },
      // code450 items 32, 36-76 (P08): cockpit set-up before start.
      { challenge: 'SEAT BELT / NO SMOKE', response: 'ON', check: both(eq(V.seatBelt, 1), eq(V.noSmoke, 1)) },
      { challenge: 'Gear handle', response: 'DOWN, 3 green', check: (v) => v.get(V.gearHandle) === 1 && v.get('gear.down_locked') !== 0 },
      { challenge: 'L / R fire handles', response: 'IN', check: both(eq(V.fireHandleL, 0), eq(V.fireHandleR, 0)) },
      { challenge: 'Power levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05 },
      { challenge: 'Speed brake', response: 'RETRACT detent', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'Aileron / rudder trim', response: 'CHECKED, ZERO', check: (v) => Math.abs(v.get('surf.aileron_trim')) < 0.02 && Math.abs(v.get('surf.rudder_trim')) < 0.02 },
      { challenge: 'NWS POWER', response: 'OFF (ON after start)', check: eq(V.nwsPower, 0) },
      { challenge: 'Altimeters (3)', response: 'SET and cross-checked' },
      { challenge: 'V-speeds', response: 'ENTERED' },
      { challenge: 'Guidance panel', response: 'SET (heading, initial altitude)' },
      { challenge: 'Parking brake', response: 'SET', check: on('brakes.parking_set') },
      { challenge: 'FUEL CONTROL switches', response: 'OFF', check: both(eq(V.fuelCtlL, 0), eq(V.fuelCtlR, 0)) },
      { challenge: 'BEACON', response: 'ON', check: eq(V.ltBeacon, 1) },
      { challenge: 'Takeoff briefing', response: 'COMPLETED' },
    ],
  },
  {
    // code450 APU Start Checklist (P01): boost pump immediately before the master; a failed start is
    // retried after a MASTER cycle within the starter duty limits (LIM 3 min / 15 s x 2).
    title: 'APU Start',
    phase: 'Normal',
    items: [
      { challenge: 'EMERGENCY POWER', response: 'ON', check: eq(V.emerPwr, 2) },
      { challenge: 'MAIN BATTERIES', response: 'ON, 22 V minimum', check: (v) => v.get(V.battL) === 1 && v.get(V.battR) === 1 && v.get('elec.l_batt_bus_v') >= 22 },
      { challenge: 'APU Fire Test', response: 'TESTED', check: on(V.fireTested('apu')) },
      { challenge: 'L MAIN Boost Pump', response: 'ON', check: (v) => v.get(V.boostL) >= 1 },
      { challenge: 'APU MASTER Switch', response: 'ON', check: eq(V.apuMaster, 1) },
      { challenge: 'READY light (10-16 s)', response: 'ON', check: on('apu.door_open') },
      { challenge: 'APU START', response: 'PRESS (monitor EGT)', check: on('apu.running') },
      { challenge: 'APU GEN', response: 'ON, generator on line', check: (v) => v.get(V.apuGen) === 1 && v.get('elec.apu_gen_online') !== 0 },
      { challenge: 'EMERGENCY POWER', response: 'ARM', check: eq(V.emerPwr, 1) },
    ],
  },
  {
    title: 'Starting Engines',
    phase: 'Normal',
    items: [
      { challenge: 'START MASTER', response: 'ON (isolation valve opens, packs off)', check: eq(V.startMaster, 1) },
      // LIM / dossier §2: minimum bleed pressure for start 40 psi (P16).
      { challenge: 'Bleed pressure', response: 'Check 40 psi minimum', check: (v) => v.get('pneu.l_duct_psi') >= 40 || v.get('pneu.r_duct_psi') >= 40 },
      { challenge: 'R ENG start', response: 'Press; FUEL CONTROL R RUN', check: eq(V.fuelCtlR, 1) },
      { challenge: 'R engine', response: 'Stabilized at idle (TGT < 700 C)', check: on('eng2.running') },
      // The right engine is started first specifically to demonstrate the PTU pressurizing the left
      // system: "PTU Pressure - CHECK 3000 (+300/-400) PSI" (code450 Engine Start Checklist, P09).
      { challenge: 'PTU pressure', response: 'CHECK 3,000 (+300 / -400) psi (L system by PTU)', check: (v) => v.get('hyd.left_psi') >= 2600 },
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
    // Published title "Taxi" (code450, P22); brakes / flight-controls / reverser checks (P04).
    title: 'Taxi',
    phase: 'Normal',
    items: [
      { challenge: 'Brakes', response: 'CHECK on first movement' },
      { challenge: 'Flight controls', response: 'CHECK (FCC normal mode)', check: (v) => v.get('fbw.mode_code') === 0 },
      { challenge: 'Thrust reversers', response: 'CHECK (first flight of day)' },
      { challenge: 'Flaps', response: '10 or 20 (TO)', check: (v) => v.get('surf.flaps_deg') > 8 && v.get('surf.flaps_deg') < 22 },
      { challenge: 'Pitch trim', response: 'Green band', check: (v) => v.get('trim.pitch_units') >= -0.2 && v.get('trim.pitch_units') <= 0.35 },
      { challenge: 'GND SPOILER', response: 'ARMED', check: eq(V.gndSpoiler, 1) },
      { challenge: 'AUTOBRAKE', response: 'RTO', check: eq(V.autobrake, -1) },
      { challenge: 'TRS / V-speeds', response: 'TO set / checked' },
      { challenge: 'IRS', response: 'Aligned (no "IRS 1-2-3 Aligning")', check: (v) => v.get('ahrs1.valid') !== 0 && v.get('ahrs2.valid') !== 0 && v.get('ahrs3.valid') !== 0 },
      { challenge: 'Taxi light', response: 'ON', check: eq(V.ltTaxi, 1) },
    ],
  },
  {
    // Published title "Line Up" (code450, P22).
    title: 'Line Up',
    phase: 'Normal',
    items: [
      { challenge: 'Parking brake', response: 'Released', check: off('brakes.parking_set') },
      { challenge: 'Speed brake', response: 'Retracted', check: (v) => v.get(V.speedbrake) < 0.05 },
      { challenge: 'Strobe / landing lights', response: 'ON', check: both(eq(V.ltStrobe, 1), eq(V.ltLdgL, 1)) },
      { challenge: 'Anti-ice', response: 'As required (2 min before takeoff thrust, LIM)' },
      { challenge: 'Transponder / TCAS', response: 'TA/RA', check: (v) => v.get('xpdr.mode') >= 3 },
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
      // Standard Gulfstream climb flow (code450, P18).
      { challenge: 'Altimeters', response: 'STD at transition altitude' },
      { challenge: 'Landing / taxi lights', response: 'OFF at 10,000 ft', check: (v) => v.get('adc1.press_alt_ft') < 10000 || (v.get(V.ltLdgL) === 0 && v.get(V.ltTaxi) === 0) },
      { challenge: 'Seat belts', response: 'As required' },
      { challenge: 'Pressurization', response: 'Check' },
    ],
  },
  {
    // Short cruise scan (P04; standard Gulfstream flow).
    title: 'Cruise',
    phase: 'Normal',
    items: [
      { challenge: 'Pressurization', response: 'Monitor (cabin altitude / differential)' },
      { challenge: 'Fuel', response: 'Monitor quantity and balance', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) < 1000 * 0.45359237 },
      { challenge: 'Landing performance', response: 'Review for destination' },
    ],
  },
  {
    title: 'Descent / Approach',
    phase: 'Normal',
    items: [
      { challenge: 'Landing field elevation / minimums', response: 'Set' },
      { challenge: 'Landing data (VREF)', response: 'Set' },
      // Standard Gulfstream descent flow (code450, P18).
      { challenge: 'Altimeters (3)', response: 'SET and cross-checked at transition level' },
      { challenge: 'Seat belts', response: 'ON', check: eq(V.seatBelt, 1) },
      { challenge: 'Fuel', response: 'Balance check', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) < 1000 * 0.45359237 },
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
      // Gulfstream after-landing flow (code450, P19).
      { challenge: 'Transponder', response: 'STANDBY / as required', check: (v) => v.get('xpdr.mode') <= 1 },
      { challenge: 'Weather radar', response: 'OFF / STBY', check: (v) => v.get('epic.radar.mode', 0) <= 1 },
      { challenge: 'Anti-ice', response: 'As required' },
      { challenge: 'Strobe / landing lights', response: 'OFF', check: both(eq(V.ltStrobe, 0), eq(V.ltLdgL, 0)) },
      { challenge: 'APU', response: 'START for the arrival / as required' },
    ],
  },
  {
    // code450 Shutdown Checklist (P02): the published ~29-item set abridged to the modelled controls.
    title: 'Shutdown',
    phase: 'Normal',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: on('brakes.parking_set') },
      { challenge: 'Transponder', response: 'STANDBY', check: (v) => v.get('xpdr.mode') <= 1 },
      { challenge: 'PWR XFR Unit (PTU)', response: 'NOT ARM (OFF)', check: eq(V.ptu, 0) },
      { challenge: 'AUX PUMP', response: 'NOT ARM (OFF)', check: eq(V.auxPump, 0) },
      { challenge: 'SEAT BELT / NO SMOKE', response: 'OFF', check: both(eq(V.seatBelt, 0), eq(V.noSmoke, 0)) },
      { challenge: 'Engines', response: 'Idle 3 min (LUC), L / R FUEL CONTROL OFF', check: both(eq(V.fuelCtlL, 0), eq(V.fuelCtlR, 0)) },
      { challenge: 'OXYGEN systems (crew / passenger)', response: 'OFF', check: (v) => v.get(V.crewOxy) === 0 && v.get(V.paxOxy) === 0 && v.get(V.paxShutoff) === 0 },
      { challenge: 'NWS POWER', response: 'OFF', check: eq(V.nwsPower, 0) },
      { challenge: 'IRS MODE SELECT (IRS 1-2-3)', response: 'OFF (no ON BAT)', check: (v) => v.get(V.irsMode(1)) === 0 && v.get(V.irsMode(2)) === 0 && v.get(V.irsMode(3)) === 0 },
      { challenge: 'CABIN / GALLEY MASTERS', response: 'OFF', check: both(eq(V.cabinMaster, 0), eq(V.galleyMaster, 0)) },
      { challenge: 'EMERGENCY POWER', response: 'OFF', check: eq(V.emerPwr, 0) },
      { challenge: 'BLEED AIR (L / R ENG, APU)', response: 'OFF', check: (v) => v.get(V.bleedL) === 0 && v.get(V.bleedR) === 0 && v.get(V.bleedApu) === 0 },
      { challenge: 'APU', response: 'STOP / MASTER OFF (as required)', check: eq(V.apuMaster, 0) },
      { challenge: 'FUEL pumps (MAIN and ALT)', response: 'OFF', check: (v) => v.get(V.boostL) === 0 && v.get(V.boostR) === 0 && v.get(V.altL) === 0 && v.get(V.altR) === 0 },
      { challenge: 'Anti-ice / probe heaters', response: 'OFF', check: (v) => v.get(V.wingL) === 0 && v.get(V.wingR) === 0 && v.get(V.cowlL) === 0 && v.get(V.cowlR) === 0 && v.get(V.probe(1)) === 0 && v.get(V.probe(2)) === 0 && v.get(V.probe(3)) === 0 && v.get(V.probe(4)) === 0 },
      { challenge: 'Exterior lights', response: 'OFF (beacon after N2 0)', check: (v) => v.get(V.ltBeacon) === 0 && v.get(V.ltStrobe) === 0 && v.get(V.ltLdgL) === 0 && v.get(V.ltLdgR) === 0 && v.get(V.ltTaxi) === 0 },
      { challenge: 'WINDSHIELD / CABIN WDO / EVS WDO HEAT', response: 'OFF', check: (v) => v.get(V.wshldL) === 0 && v.get(V.wshldR) === 0 && v.get(V.cabinWdo) === 0 && v.get(V.evsWdo) === 0 },
      // FLT CTRL BATTERIES OFF before the mains: left ON they discharge into the FCS buses
      // ("Flight Control Battery On" advisory, P02).
      { challenge: 'FLT CTRL BATTERIES (EBHA, UPS)', response: 'OFF', check: both(eq(V.ebhaBatt, 0), eq(V.upsBatt, 0)) },
      { challenge: 'MAIN BATTERIES (Left / Right)', response: 'OFF', check: both(eq(V.battL, 0), eq(V.battR, 0)) },
      { challenge: 'Wheel chocks', response: 'IN PLACE, parking brake as required' },
    ],
  },
  {
    // code450 Securing Checklist (P02 / P04, abridged to the modelled items).
    title: 'Securing',
    phase: 'Normal',
    items: [
      { challenge: 'EMER LTS', response: 'OFF', check: eq(V.ltEmer, 0) },
      { challenge: 'GND SVC BUS', response: 'As required for servicing' },
      { challenge: 'Interior lights', response: 'OFF', check: (v) => v.get(V.ltPanel) === 0 && v.get(V.ltFlood) === 0 && v.get(V.ltDome) === 0 },
      { challenge: 'Main door', response: 'As required' },
      { challenge: 'Covers / pins', response: 'INSTALL (probes, inlets, gear pins)' },
    ],
  },
  // ---------------------------------------------------------------- abnormal / emergency (CAS-selectable)
  {
    title: 'L Engine Fire',
    phase: 'Emergency',
    items: [
      // code450 Immediate Actions (P15): confirm the affected engine; zone-1 pacing before the bottle.
      { challenge: 'Affected engine', response: 'CONFIRM (L)' },
      { challenge: 'L thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 },
      { challenge: 'If the warning persists after 10 s:', response: '' },
      { challenge: 'L FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlL, 0) },
      { challenge: 'L fire handle', response: 'PULL', check: eq(V.fireHandleL, 1) },
      { challenge: 'Fire handle', response: 'Rotate outward (shot 1) / inward after 30 s (shot 2)', check: on('fire.bottle_r_discharged') },
      // Core (internal) fires are motored, not bottled (code450: do NOT discharge for a core fire).
      { challenge: 'Tailpipe / core fire (no fire warning)', response: 'Do NOT discharge; motor the engine (CRANK)' },
    ],
  },
  {
    title: 'R Engine Fire',
    phase: 'Emergency',
    items: [
      { challenge: 'Affected engine', response: 'CONFIRM (R)' },
      { challenge: 'R thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(2)) < 0.05 },
      { challenge: 'If the warning persists after 10 s:', response: '' },
      { challenge: 'R FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlR, 0) },
      { challenge: 'R fire handle', response: 'PULL', check: eq(V.fireHandleR, 1) },
      { challenge: 'Fire handle', response: 'Rotate outward (shot 1) / inward after 30 s (shot 2)', check: on('fire.bottle_r_discharged') },
      { challenge: 'Tailpipe / core fire (no fire warning)', response: 'Do NOT discharge; motor the engine (CRANK)' },
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
    // CAS "L/R Autostart Abort" (FADEC aborted the start; P10).
    title: 'L Autostart Abort',
    phase: 'Abnormal',
    items: [
      { challenge: 'L FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlL, 0) },
      { challenge: 'Bleed pressure', response: 'VERIFY 40 psi minimum', check: (v) => v.get('pneu.l_duct_psi') >= 40 || v.get('pneu.r_duct_psi') >= 40 },
      { challenge: 'Dry motor (CRANK) 30 s if TGT high, then', response: 'Second start attempt (LIM starter duty)' },
    ],
  },
  {
    title: 'R Autostart Abort',
    phase: 'Abnormal',
    items: [
      { challenge: 'R FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlR, 0) },
      { challenge: 'Bleed pressure', response: 'VERIFY 40 psi minimum', check: (v) => v.get('pneu.l_duct_psi') >= 40 || v.get('pneu.r_duct_psi') >= 40 },
      { challenge: 'Dry motor (CRANK) 30 s if TGT high, then', response: 'Second start attempt (LIM starter duty)' },
    ],
  },
  {
    // CAS "L Engine Fail" (P10): in-flight relight (starter-assisted below 30,000 ft, LIM).
    title: 'L Engine Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'L thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 },
      { challenge: 'L FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlL, 0) },
      { challenge: 'CONT IGN', response: 'ON', check: eq(V.contIgn, 1) },
      { challenge: 'Air start (below 30,000 ft, LIM):', response: 'START MASTER ON, L ENG press, FUEL CONTROL RUN' },
      { challenge: 'L engine', response: 'Relit and stabilized', check: on('eng1.running') },
    ],
  },
  {
    title: 'R Engine Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'R thrust lever', response: 'IDLE', check: (v) => v.get(V.tla(2)) < 0.05 },
      { challenge: 'R FUEL CONTROL', response: 'OFF', check: eq(V.fuelCtlR, 0) },
      { challenge: 'CONT IGN', response: 'ON', check: eq(V.contIgn, 1) },
      { challenge: 'Air start (below 30,000 ft, LIM):', response: 'START MASTER ON, R ENG press, FUEL CONTROL RUN' },
      { challenge: 'R engine', response: 'Relit and stabilized', check: on('eng2.running') },
    ],
  },
  {
    title: 'L Generator Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'L GEN', response: 'OFF, then ON (one reset)' },
      // In-flight APU start permitted only at or below 37,000 ft (dossier §7, P21).
      { challenge: 'If not restored: APU (at / below FL370)', response: 'Start, APU GEN on line', check: (v) => v.get('elec.apu_gen_online') !== 0 || v.get('adc1.press_alt_ft') > 37000 },
      { challenge: 'L BUS TIE', response: 'AUTO (R IDG / APU powers L MAIN AC)', check: on('elec.l_main_ac_powered') },
    ],
  },
  {
    title: 'R Generator Fail',
    phase: 'Abnormal',
    items: [
      { challenge: 'R GEN', response: 'OFF, then ON (one reset)' },
      { challenge: 'If not restored: APU (at / below FL370)', response: 'Start, APU GEN on line', check: (v) => v.get('elec.apu_gen_online') !== 0 || v.get('adc1.press_alt_ft') > 37000 },
      { challenge: 'R BUS TIE', response: 'AUTO', check: on('elec.r_main_ac_powered') },
    ],
  },
  {
    // Dual generator loss (CAS "L-R Generator Fail"; dossier §7, P10): batteries 16 min, APU, RAT.
    title: 'L-R Generator Fail',
    phase: 'Emergency',
    items: [
      { challenge: 'Batteries', response: 'Hold the ESS DC buses (16 min, LUC)' },
      { challenge: 'L / R GEN', response: 'OFF, then ON (one reset each)' },
      { challenge: 'APU (at / below FL370)', response: 'Start, APU GEN on line', check: (v) => v.get('elec.apu_gen_online') !== 0 || v.get('adc1.press_alt_ft') > 37000 },
      { challenge: 'If not restored: RAT (at / above 180 KCAS)', response: 'DEPLOY, RAT GEN ON', check: (v) => v.get('elec.apu_gen_online') !== 0 || v.get('elec.rat_online') !== 0 },
      { challenge: 'EMERGENCY POWER', response: 'Verify ARM / ON', check: (v) => v.get(V.emerPwr) >= 1 },
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
    // CAS "FCC Alternate Mode" (dossier §7, P10): one reset, then the LIM speed limits.
    title: 'FCC Alternate Mode',
    phase: 'Abnormal',
    items: [
      { challenge: 'FLT CTRL RESET', response: 'PRESS (once)' },
      { challenge: 'If restored', response: 'FCC Normal mode, no further action', check: (v) => v.get('fbw.mode_code') === 0 },
      { challenge: 'If not restored: speed', response: '285 KCAS / M0.90 maximum (LIM)' },
      { challenge: 'Icing conditions', response: 'AVOID; landing crosswind 10 kt, VREF + 10 (LIM)' },
    ],
  },
  {
    title: 'FCC Direct Mode',
    phase: 'Abnormal',
    items: [
      { challenge: 'FLT CTRL RESET', response: 'PRESS (once)' },
      { challenge: 'If not restored: speed', response: '285 KCAS / M0.90 maximum (LIM); no speed brake' },
      { challenge: 'Landing', response: 'Flaps 39, VREF + 10, crosswind 10 kt (LIM)' },
    ],
  },
  {
    title: 'Cabin Pressure Low',
    phase: 'Emergency',
    items: [
      // Immediate action: crew masks ON at 100 % (dossier §7; EROS N / 100 % / EMERGENCY regulators, P07).
      { challenge: 'Crew oxygen masks', response: 'ON, 100 %', check: (v) => v.get(V.oxyMaskL) !== 0 && v.get(V.oxyMaskR) !== 0 && v.get(V.oxyMaskModeL) >= 1 && v.get(V.oxyMaskModeR) >= 1 },
      { challenge: 'PASSENGER OXYGEN', response: 'MAN', check: eq(V.paxOxy, 2) },
      // The CPC latches Emergency Descent Mode (blue EDM advisory, logic.ts) once the cabin exceeds the trip
      // with no crew response; the descent itself is flown by the crew (dossier §4.8 SCOPE).
      { challenge: 'Emergency descent', response: 'Initiate' },
    ],
  },
  {
    // P10: emergency descent as its own selectable list (standard Gulfstream immediate actions).
    title: 'Emergency Descent',
    phase: 'Emergency',
    items: [
      { challenge: 'Crew oxygen masks', response: 'ON, 100 %', check: (v) => v.get(V.oxyMaskL) !== 0 && v.get(V.oxyMaskR) !== 0 && v.get(V.oxyMaskModeL) >= 1 && v.get(V.oxyMaskModeR) >= 1 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05 },
      { challenge: 'Speed brake', response: 'EXTEND', check: (v) => v.get(V.speedbrake) > 0.5 },
      { challenge: 'Descend', response: '10,000 ft or MEA, VMO/MMO maximum' },
      { challenge: 'SEAT BELT', response: 'ON', check: eq(V.seatBelt, 1) },
    ],
  },
  {
    // CAS "L/R/L-R Fuel Level Low" (650 lb, LUC; P10).
    title: 'Fuel Level Low',
    phase: 'Abnormal',
    items: [
      { challenge: 'Boost pumps (MAIN and ALT)', response: 'Verify ON', check: (v) => v.get(V.boostL) >= 1 && v.get(V.boostR) >= 1 },
      { challenge: 'X-FLOW', response: 'As required for balance' },
      { challenge: 'Avoid', response: 'Extreme nose-low attitudes' },
      { challenge: 'Land', response: 'At the nearest suitable airport' },
    ],
  },
  {
    // CAS "Fuel Imbalance" (LUC; P10).
    title: 'Fuel Imbalance',
    phase: 'Abnormal',
    items: [
      { challenge: 'Fuel quantities', response: 'CHECK (leak suspected: no crossflow)' },
      { challenge: 'X-FLOW', response: 'OPEN, heavy-side pumps ON', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) < 1000 * 0.45359237 || v.get(V.xflow) === 1 },
      { challenge: 'When balanced: X-FLOW', response: 'CLOSED', check: (v) => Math.abs(v.get('fuel.imbalance_kg')) > 1000 * 0.45359237 || v.get(V.xflow) === 0 },
    ],
  },
];
