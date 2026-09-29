/**
 * Cessna 172S (steam gauges, NAV II) POH checklists, transcribed item by item from the Pilot's
 * Operating Handbook 172SPHUS: Section 4 "Checklist procedures" (4-7 .. 4-17) and the amplified
 * "Leaning for ground operations" / "Taxiing" (4-21), and Section 3 "Emergency procedures
 * checklist" (3-4 .. 3-12). Page references are those of the Revision 4 copy used for the
 * transcription (N796SP, /tmp/ref/c172-steam/n796sp_poh.pdf); the Revision 5 items the audit
 * quoted (Cabin 24 "Autopilot Static Source Opening", Before Starting 10 "Avionics Circuit
 * Breakers", Starting Engine With External Power 1-19 with the electrical check a-f, Securing 8
 * "LEFT or RIGHT") read the same.
 *
 * Item numbers are the POH's ("1.", "a."); conditional headers ("If engine starts:") and the
 * NOTE / WARNING / CAUTION texts that belong to a procedure are un-checked items with an empty
 * response. Items with a `check` show a live tick in the checklist viewer. Checks that need
 * variant-only state (the steam procedure monitor latches, the Bendix/King radios, the DG) come
 * in through `C172SteamChecklistHooks` from c172-steam/checklists.ts.
 *
 * The Taxiing list is not a POH checklist: it is the POH amplified TAXIING procedure (4-21, Fig
 * 4-2) with the brake and instrument checks operator checklists add for taxi (for example the
 * published 172R/S flow: brakes CHECK, turn coordinator / DG / compass / attitude in turns).
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, ENG, FDM, FUEL, SURF } from '../../core/vars';
import { ANN, C172, DOOR, ELT_SW, FUEL_SEL, MAG } from './vars';
import { STEAM_BREAKERS } from './systems/electrical';
import { TAKEOFF_TRIM } from './states';

type V = SimContext['vars'];
type Check = (v: V) => boolean;

/** Variant-specific checks the steam airplane passes in (c172-steam/checklists.ts). */
export interface C172SteamChecklistHooks {
  /** Preflight 11: avionics cooling fan heard. */
  avnFanHeard?: Check;
  /** Preflight 14: annunciator TST held with all annunciators lit. */
  annTestOk?: Check;
  /** Starting Engine 14 "Radios - ON": the nav/coms, audio panel and transponder on. */
  radiosOn?: Check;
  /** Before Takeoff 6 "Flight Instruments - CHECK and SET": altimeter set, DG aligned with the compass. */
  flightInstruments?: Check;
  /** Before Takeoff 10a: magneto drops measured and within limits. */
  magCheckOk?: Check;
  /** Before Takeoff 17 "NAV/GPS Switch - SET" (NAV or GPS chosen deliberately: the source agrees with the KLN 94 state). */
  navGpsSet?: Check;
  /** Before Takeoff 19 "Manual Electric Trim - CHECK" (KAP 140 preflight trim test done). */
  manualTrimChecked?: Check;
  /** Transponder in ALT (AIM 4-1-20: ALT on the airport movement area). */
  xpdrAlt?: Check;
  /** Ditching 1: COM 1 on 121.5 MHz and the transponder squawking 7700. */
  maydaySquawk?: Check;
  /** Taxiing: turn coordinator and DG respond (powered / spun up). */
  taxiInstruments?: Check;
}

const on = (name: string): Check => (v) => v.get(name) > 0.5;
const off = (name: string): Check => (v) => v.get(name) < 0.5;
const eq = (name: string, x: number): Check => (v) => Math.round(v.get(name)) === x;
const flaps = (lo: number, hi: number): Check => (v) => v.get(SURF.flapsDeg) >= lo - 0.5 && v.get(SURF.flapsDeg) <= hi + 0.5;
const rpm = (lo: number, hi: number): Check => (v) => v.get(ENG.rpm(1)) >= lo && v.get(ENG.rpm(1)) <= hi;
const all = (...c: (Check | undefined)[]): Check | undefined => (c.some((x) => !x) ? undefined : (v) => c.every((x) => x!(v)));
/** Airspeed indicator (pitot-static ADC 1) within `tol` kt of `kt`. */
const ias = (kt: number, tol = 5): Check => (v) => Math.abs(v.get(ADC.ias(1)) - kt) <= tol;
const iasRange = (lo: number, hi: number): Check => (v) => v.get(ADC.ias(1)) >= lo && v.get(ADC.ias(1)) <= hi;
/** POH 3-4: 70 KIAS flaps UP, 65 KIAS flaps DOWN. */
const glideByFlaps: Check = (v) => (v.get(SURF.flapsDeg) < 5 ? ias(70)(v) : ias(65)(v));
const masterOn: Check = (v) => v.get(C172.masterBat) > 0.5 && v.get(C172.masterAlt) > 0.5;
const masterOff: Check = (v) => v.get(C172.masterBat) < 0.5 && v.get(C172.masterAlt) < 0.5;
const avionicsOn: Check = (v) => v.get(C172.avionicsBus1) > 0.5 && v.get(C172.avionicsBus2) > 0.5;
const avionicsOff: Check = (v) => v.get(C172.avionicsBus1) < 0.5 && v.get(C172.avionicsBus2) < 0.5;
const mixtureCutoff: Check = (v) => v.get(C172.mixture) < 0.05;
/** RICH; above 3000 ft leaned for maximum RPM is the POH alternative. */
const mixtureRich: Check = (v) => v.get(C172.mixture) > 0.8 || v.get(FDM.pressAlt) > 3000;
const throttleIdle: Check = (v) => v.get(C172.throttle) < 0.03;
const throttleFull: Check = (v) => v.get(C172.throttle) > 0.97;
const magsOff = eq(C172.magneto, MAG.off);
const doorsLocked: Check = (v) => Math.round(v.get(C172.doorLeft)) === DOOR.locked && Math.round(v.get(C172.doorRight)) === DOOR.locked;
const doorsUnlatched: Check = (v) => Math.round(v.get(C172.doorLeft)) === DOOR.open || Math.round(v.get(C172.doorRight)) === DOOR.open;
/** "Vents, Cabin Air, Heat - CLOSED". */
const ventsHeatAirClosed: Check = (v) => v.get(C172.ventLeft) < 0.05 && v.get(C172.ventRight) < 0.05 && v.get(C172.cabinHeat) < 0.05 && v.get(C172.cabinAir) < 0.05;
const ventsOpen: Check = (v) => v.get(C172.ventLeft) > 0.5 || v.get(C172.ventRight) > 0.5 || v.get(C172.cabinAir) > 0.5;
/** Every steam panel breaker in (cb.<name> = 1); the avionics breakers alone (AVN BUS 1 / 2 panel). */
const CB_ALL = STEAM_BREAKERS.map((b) => `cb.${b.name}`);
const CB_AVN = STEAM_BREAKERS.filter((b) => b.bus === 'avn1' || b.bus === 'avn2').map((b) => `cb.${b.name}`);
const breakersIn = (list: readonly string[]): Check => (v) => list.every((n) => v.get(n, 1) > 0.5);
/** Electrical equipment OFF: exterior lights, pitot heat, auxiliary fuel pump, 12 V cabin power. */
const ELEC_EQUIP = [C172.beacon, C172.land, C172.taxi, C172.nav, C172.strobe, C172.pitotHeat, C172.fuelPump, C172.cabinPwr12v];
const elecEquipOff: Check = (v) => ELEC_EQUIP.every((n) => v.get(n) < 0.5);
/** Annunciator panel dark (POH Before Takeoff 11): none of the six lamps lit. */
const LAMPS = (['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'] as const).map((l) => ANN.lamp(l));
const annunciatorsOff: Check = (v) => v.get('elec.warn_powered', 1) > 0.5 && LAMPS.every((n) => v.get(n) < 0.5);
/** POH Fig 2-3: fuel quantity indicators, yellow arc 0-5 gal (EST band used as "CHECK"). */
const FUEL_YELLOW_KG = 5 * 6 * 0.45359237;
const fuelQtyOk: Check = (v) => v.get(FUEL.tankKg(0)) > FUEL_YELLOW_KG && v.get(FUEL.tankKg(1)) > FUEL_YELLOW_KG;
/** POH Fig 2-3: oil pressure green arc 50-90 PSI (minimum idle 20 PSI). */
const oilPressOk: Check = (v) => v.get(ENG.oilPressPsi(1)) >= 20;
/** Steam ammeter: battery current, + charge / - discharge (POH Sec 7 "Ammeter"). */
const ammeterNeg: Check = (v) => v.get('elec.batt_amps') < 0;
const ammeterPos: Check = (v) => v.get('elec.batt_amps') > 0;
const trimTakeoff: Check = (v) => Math.abs(v.get(C172.trimPosition) - TAKEOFF_TRIM) < 0.03;
const header = (text: string) => ({ challenge: text, response: '' });

const M = 'Master Switch';
const AVM = 'Avionics Master Switch';
const IGN = 'Ignition Switch';
const PUMP = 'Auxiliary Fuel Pump Switch';
const DRAIN =
  'DRAIN at least a cupful of fuel (using sampler cup) from each sump location to check for water, sediment, and proper fuel grade before each flight and after each refueling';
const TIRE = 'CHECK for proper inflation and general condition (weather checks, tread depth and wear, etc...)';
const FLOOD_NOTE =
  'NOTE: If engine floods (engine has been primed too much), turn off auxiliary fuel pump, place mixture to idle cutoff, open throttle 1/2 to full, and motor (crank) engine. When engine starts, set mixture to full rich and close throttle promptly.';

/** POH Section 4 and Section 3 checklists of the steam 172S. */
export function c172SteamPohChecklists(h: C172SteamChecklistHooks = {}): Checklist[] {
  const normal: Checklist[] = [
    {
      title: 'Preflight Inspection — 1 Cabin',
      phase: 'preflight',
      items: [
        { challenge: '1. Pitot Tube Cover', response: 'REMOVE. Check for pitot blockage.' },
        { challenge: "2. Pilot's Operating Handbook", response: 'AVAILABLE IN THE AIRPLANE' },
        { challenge: '3. Airplane Weight and Balance', response: 'CHECKED' },
        { challenge: '4. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        { challenge: '5. Control Wheel Lock', response: 'REMOVE', check: off(C172.controlLock) },
        { challenge: `6. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: `7. ${AVM}`, response: 'OFF', check: avionicsOff },
        header('WARNING: When turning on the Master Switch, using an external power source, or pulling the propeller through by hand, treat the propeller as if the Ignition Switch were ON.'),
        { challenge: `8. ${M}`, response: 'ON', check: masterOn },
        { challenge: '9. Fuel Quantity Indicators', response: 'CHECK QUANTITY and ENSURE LOW FUEL ANNUNCIATORS (L LOW FUEL R) ARE EXTINGUISHED', check: (v) => fuelQtyOk(v) && v.get(ANN.lowFuelL) < 0.5 && v.get(ANN.lowFuelR) < 0.5 },
        { challenge: `10. ${AVM}`, response: 'ON', check: avionicsOn },
        { challenge: '11. Avionics Cooling Fan', response: 'CHECK AUDIBLY FOR OPERATION', check: h.avnFanHeard },
        { challenge: `12. ${AVM}`, response: 'OFF', check: avionicsOff },
        { challenge: '13. Static Pressure Alternate Source Valve', response: 'OFF', check: off(C172.altStatic) },
        { challenge: '14. Annunciator Panel Switch', response: 'PLACE AND HOLD IN TST POSITION and ensure all annunciators illuminate', check: h.annTestOk },
        { challenge: '15. Annunciator Panel Test Switch', response: 'RELEASE. Check that appropriate annunciators remain on.', check: (v) => v.get(C172.annSwitch) > -0.5 },
        header('NOTE: When the Master Switch is turned ON, some annunciators will flash for approximately 10 seconds before illuminating steadily.'),
        { challenge: '16. Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: '17. Fuel Shutoff Valve', response: 'ON (Push Full In)', check: on(C172.fuelShutoff) },
        { challenge: '18. Flaps', response: 'EXTEND', check: flaps(30, 30) },
        { challenge: '19. Pitot Heat', response: 'ON. (Carefully check that pitot tube is warm to touch within 30 seconds.)', check: (v) => v.get(C172.pitotHeat) > 0.5 && v.get('elec.pitot_heat_powered', 1) > 0.5 },
        { challenge: '20. Pitot Heat', response: 'OFF', check: off(C172.pitotHeat) },
        { challenge: `21. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '22. Elevator Trim', response: 'SET for takeoff', check: trimTakeoff },
        { challenge: '23. Baggage Door', response: 'CHECK, lock with key', check: eq(C172.baggageDoor, DOOR.locked) },
        // SCOPE: the KAP 140 static source (Supplement 15) cannot be blocked in the sim; read-and-do.
        { challenge: '24. Autopilot Static Source Opening (if installed)', response: 'CHECK for blockage' },
      ],
    },
    {
      // SCOPE: the walk-around items have no simulated state (covers, tie-downs, sumps, oil level); read-and-do.
      title: 'Preflight Inspection — Exterior (2 - 8)',
      phase: 'preflight',
      items: [
        header('2 EMPENNAGE'),
        { challenge: '1. Rudder Gust Lock (if installed)', response: 'REMOVE' },
        { challenge: '2. Tail Tie-Down', response: 'DISCONNECT' },
        { challenge: '3. Control Surfaces', response: 'CHECK freedom of movement and security' },
        { challenge: '4. Trim Tab', response: 'CHECK security' },
        { challenge: '5. Antennas', response: 'CHECK for security of attachment and general condition' },
        header('3 RIGHT WING Trailing Edge'),
        { challenge: '1. Aileron', response: 'CHECK freedom of movement and security' },
        { challenge: '2. Flap', response: 'CHECK for security and condition' },
        header('4 RIGHT WING'),
        { challenge: '1. Wing Tie-Down', response: 'DISCONNECT' },
        { challenge: '2. Main Wheel Tire', response: TIRE },
        { challenge: '3. Fuel Tank Sump Quick Drain Valves', response: DRAIN },
        header('WARNING: If, after repeated sampling, evidence of contamination still exists, the airplane should not be flown.'),
        { challenge: '4. Fuel Quantity', response: 'CHECK VISUALLY for desired level' },
        { challenge: '5. Fuel Filler Cap', response: 'SECURE and VENT UNOBSTRUCTED' },
        header('5 NOSE'),
        { challenge: '1. Fuel Strainer Quick Drain Valve (located on bottom of fuselage)', response: `${DRAIN}, including the fuel reservoir and fuel selector` },
        { challenge: '2. Engine Oil Dipstick/Filler Cap', response: 'CHECK oil level, then check dipstick/filler cap SECURE. Do not operate with less than five quarts. Fill to eight quarts for extended flight.' },
        { challenge: '3. Engine Cooling Air Inlets', response: 'CLEAR of obstructions' },
        { challenge: '4. Propeller and Spinner', response: 'CHECK for nicks and security' },
        { challenge: '5. Air Filter', response: 'CHECK for restrictions by dust or other foreign matter' },
        { challenge: '6. Nose Wheel Strut and Tire', response: 'CHECK for proper inflation of strut and general condition (weather checks, tread depth and wear, etc...) of tire' },
        { challenge: '7. Left Static Source Opening', response: 'CHECK for blockage' },
        header('6 LEFT WING'),
        { challenge: '1. Fuel Quantity', response: 'CHECK VISUALLY for desired level' },
        { challenge: '2. Fuel Filler Cap', response: 'SECURE and VENT UNOBSTRUCTED' },
        { challenge: '3. Fuel Tank Sump Quick Drain Valves', response: DRAIN },
        { challenge: '4. Main Wheel Tire', response: TIRE },
        header('7 LEFT WING Leading Edge'),
        { challenge: '1. Fuel Tank Vent Opening', response: 'CHECK for blockage' },
        { challenge: '2. Stall Warning Opening', response: 'CHECK for blockage. To check the system, place a clean handkerchief over the vent opening and apply suction; a sound from the warning horn will confirm system operation.' },
        { challenge: '3. Wing Tie-Down', response: 'DISCONNECT' },
        { challenge: '4. Landing/Taxi Light(s)', response: 'CHECK for condition and cleanliness of cover' },
        header('8 LEFT WING Trailing Edge'),
        { challenge: '1. Aileron', response: 'CHECK for freedom of movement and security' },
        { challenge: '2. Flap', response: 'CHECK for security and condition' },
      ],
    },
    {
      title: 'Before Starting Engine',
      phase: 'before start',
      items: [
        { challenge: '1. Preflight Inspection', response: 'COMPLETE' },
        { challenge: '2. Passenger Briefing', response: 'COMPLETE' },
        { challenge: '3. Seats and Seat Belts', response: 'ADJUST and LOCK. Ensure inertia reel locking.' },
        { challenge: '4. Brakes', response: 'TEST and SET', check: on(C172.parkingBrake) },
        { challenge: '5. Circuit Breakers', response: 'CHECK IN', check: breakersIn(CB_ALL) },
        { challenge: '6. Electrical Equipment', response: 'OFF', check: elecEquipOff },
        header('CAUTION: The avionics master switch must be OFF during engine start to prevent possible damage to avionics.'),
        { challenge: `7. ${AVM}`, response: 'OFF', check: avionicsOff },
        { challenge: '8. Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: '9. Fuel Shutoff Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
        { challenge: '10. Avionics Circuit Breakers', response: 'CHECK IN', check: breakersIn(CB_AVN) },
      ],
    },
    {
      title: 'Starting Engine (With Battery)',
      phase: 'start',
      items: [
        { challenge: '1. Throttle', response: 'OPEN 1/4 INCH', check: (v) => v.get(C172.throttle) > 0.02 && v.get(C172.throttle) < 0.2 },
        { challenge: '2. Mixture', response: 'IDLE CUTOFF', check: mixtureCutoff },
        { challenge: '3. Propeller Area', response: 'CLEAR' },
        { challenge: `4. ${M}`, response: 'ON', check: masterOn },
        { challenge: '5. Flashing Beacon', response: 'ON', check: on(C172.beacon) },
        header('NOTE: If engine is warm, omit priming procedure of steps 6, 7 and 8 below.'),
        { challenge: `6. ${PUMP}`, response: 'ON (omit if engine warm)', check: on(C172.fuelPump) },
        { challenge: '7. Mixture', response: 'SET to FULL RICH (full forward) until stable fuel flow is indicated (usually 3 to 5 seconds), then set to IDLE CUTOFF (full aft) position (omit if engine warm)' },
        { challenge: `8. ${PUMP}`, response: 'OFF (omit if engine warm)', check: off(C172.fuelPump) },
        { challenge: `9. ${IGN}`, response: 'START (release when engine starts)', check: on(ENG.running(1)) },
        { challenge: '10. Mixture', response: 'ADVANCE smoothly to RICH when engine starts', check: (v) => v.get(C172.mixture) > 0.8 },
        header(FLOOD_NOTE),
        { challenge: '11. Oil Pressure', response: 'CHECK', check: oilPressOk },
        { challenge: '12. Navigation Lights', response: 'ON as required' },
        { challenge: `13. ${AVM}`, response: 'ON', check: avionicsOn },
        { challenge: '14. Radios', response: 'ON', check: h.radiosOn },
        { challenge: '15. Flaps', response: 'RETRACT', check: flaps(0, 0) },
      ],
    },
    {
      // The GPU connection is the EXTERNAL POWER receptacle click spot (cockpit/cabin.ts, ST.gpuRequest ->
      // C172.extPower; only on the ground with the engine stopped, SteamCabinExtras).
      title: 'Starting Engine (With External Power)',
      phase: 'start',
      items: [
        { challenge: '1. Throttle', response: 'OPEN 1/4 INCH', check: (v) => v.get(C172.throttle) > 0.02 && v.get(C172.throttle) < 0.2 },
        { challenge: '2. Mixture', response: 'IDLE CUTOFF', check: mixtureCutoff },
        { challenge: '3. Propeller Area', response: 'CLEAR' },
        { challenge: `4. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '5. External Power', response: 'CONNECT to airplane receptacle', check: on(C172.extPower) },
        { challenge: `6. ${M}`, response: 'ON', check: masterOn },
        { challenge: '7. Flashing Beacon', response: 'ON', check: on(C172.beacon) },
        header('NOTE: If engine is warm, omit priming procedure of steps 8, 9 and 10 below.'),
        { challenge: `8. ${PUMP}`, response: 'ON (omit if engine warm)', check: on(C172.fuelPump) },
        { challenge: '9. Mixture', response: 'SET to FULL RICH (full forward) until stable fuel flow is indicated (usually 3 to 5 seconds), then set to IDLE CUTOFF (full aft) position (omit if engine warm)' },
        { challenge: `10. ${PUMP}`, response: 'OFF (omit if engine warm)', check: off(C172.fuelPump) },
        { challenge: `11. ${IGN}`, response: 'START (release when engine starts)', check: on(ENG.running(1)) },
        { challenge: '12. Mixture', response: 'ADVANCE smoothly to RICH when engine starts', check: (v) => v.get(C172.mixture) > 0.8 },
        header(FLOOD_NOTE),
        { challenge: '13. Oil Pressure', response: 'CHECK', check: oilPressOk },
        { challenge: '14. External Power', response: 'DISCONNECT from airplane receptacle. Secure external power door.', check: off(C172.extPower) },
        { challenge: '15. Electrical System', response: 'CHECK FOR PROPER OPERATION' },
        { challenge: `   a. ${M}`, response: 'OFF (disconnects both the battery and alternator from the system)', check: masterOff },
        { challenge: '   b. Taxi and Landing Light Switches', response: 'ON (to provide an initial electrical load on the system)', check: (v) => v.get(C172.taxi) > 0.5 && v.get(C172.land) > 0.5 },
        { challenge: '   c. Engine RPM', response: 'REDUCE to idle (minimum alternator output occurs at idle)', check: (v) => throttleIdle(v) && v.get(ENG.rpm(1)) < 800 },
        { challenge: `   d. ${M}`, response: 'ON (with taxi and landing lights switched on). The ammeter should indicate in the negative direction.', check: (v) => masterOn(v) && v.get(C172.land) > 0.5 && ammeterNeg(v) },
        { challenge: '   e. Engine RPM', response: 'INCREASE to approximately 1500 RPM', check: rpm(1400, 1600) },
        { challenge: '   f. Ammeter and Low Voltage Annunciator', response: 'CHECK (the ammeter should indicate in the positive direction and the Low Voltage Annunciator (VOLTS) should not be lighted)', check: (v) => masterOn(v) && ammeterPos(v) && off(ANN.lowVolts)(v) },
        header('NOTE: If the indications, as noted in Step "d" and Step "f", are not observed, the electrical system is not functioning properly. Corrective maintenance must be performed before flight.'),
        { challenge: '16. Navigation Lights', response: 'ON as required' },
        { challenge: `17. ${AVM}`, response: 'ON', check: avionicsOn },
        { challenge: '18. Radios', response: 'ON', check: h.radiosOn },
        { challenge: '19. Flaps', response: 'RETRACT', check: flaps(0, 0) },
      ],
    },
    {
      title: 'Leaning for Ground Operations',
      phase: 'taxi',
      items: [
        header('1. For all ground operations, after starting the engine and when the engine is running smoothly:'),
        { challenge: '   a. Throttle', response: 'set to 1200 RPM', check: rpm(1150, 1250) },
        { challenge: '   b. Mixture', response: 'lean for maximum RPM', check: (v) => v.get(C172.mixture) < 0.97 && on(ENG.running(1))(v) },
        { challenge: '   c. Throttle', response: 'set to an RPM appropriate for ground operations (800 to 1000 RPM recommended)', check: rpm(780, 1000) },
        header('NOTE: If ground operation will be required after the BEFORE TAKEOFF checklist is completed, lean the mixture again (as described above) until ready for the TAKEOFF checklist.'),
      ],
    },
    {
      title: 'Taxiing (POH amplified procedure and operator flow)',
      phase: 'taxi',
      items: [
        { challenge: 'Parking Brake', response: 'RELEASE', check: off(C172.parkingBrake) },
        { challenge: 'Brakes', response: 'CHECK (speed and use of brakes held to a minimum)' },
        { challenge: 'Flight Instruments', response: 'CHECK in turns (turn coordinator, DG, compass; attitude indicator steady)', check: h.taxiInstruments },
        { challenge: 'Flight Controls', response: 'POSITION for the wind (Figure 4-2 Taxiing Diagram)' },
        header('Taxiing over loose gravel or cinders should be done at low engine speed to avoid abrasion and stone damage to the propeller tips.'),
      ],
    },
    {
      title: 'Before Takeoff',
      phase: 'before takeoff',
      items: [
        { challenge: '1. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        { challenge: '2. Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
        { challenge: '3. Seats and Seat Belts', response: 'CHECK SECURE' },
        { challenge: '4. Cabin Doors', response: 'CLOSED and LOCKED', check: doorsLocked },
        { challenge: '5. Flight Controls', response: 'FREE and CORRECT', check: off(C172.controlLock) },
        { challenge: '6. Flight Instruments', response: 'CHECK and SET', check: h.flightInstruments },
        { challenge: '7. Fuel Quantity', response: 'CHECK', check: fuelQtyOk },
        { challenge: '8. Mixture', response: 'RICH', check: mixtureRich },
        { challenge: '9. Fuel Selector Valve', response: 'RECHECK BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: '10. Throttle', response: '1800 RPM', check: rpm(1740, 1860) },
        { challenge: '   a. Magnetos', response: 'CHECK (RPM drop should not exceed 150 RPM on either magneto or 50 RPM differential between magnetos)', check: all(h.magCheckOk, eq(C172.magneto, MAG.both)) },
        { challenge: '   b. Vacuum Gage', response: 'CHECK', check: (v) => v.get('ac.vac.suction_inhg') >= 4.5 && v.get('ac.vac.suction_inhg') <= 5.5 },
        { challenge: '   c. Engine Instruments and Ammeter', response: 'CHECK', check: (v) => v.get(ENG.oilPressPsi(1)) >= 50 && v.get(ENG.oilPressPsi(1)) <= 90 && v.get('elec.batt_amps') >= 0 },
        { challenge: '11. Annunciator Panel', response: 'Ensure no annunciators are illuminated', check: annunciatorsOff },
        { challenge: '12. Throttle', response: 'CHECK IDLE', check: (v) => throttleIdle(v) && on(ENG.running(1))(v) && v.get(ENG.rpm(1)) < 800 },
        { challenge: '13. Throttle', response: '1000 RPM or LESS', check: (v) => on(ENG.running(1))(v) && v.get(ENG.rpm(1)) <= 1000 },
        { challenge: '14. Throttle Friction Lock', response: 'ADJUST', check: (v) => v.get(C172.throttleFriction) > 0.1 },
        { challenge: '15. Strobe Lights', response: 'AS DESIRED' },
        { challenge: '16. Radios and Avionics', response: 'SET', check: h.radiosOn },
        { challenge: '17. NAV/GPS Switch (if installed)', response: 'SET', check: h.navGpsSet },
        { challenge: '18. Autopilot (if installed)', response: 'OFF', check: off('ap.engaged') },
        { challenge: '19. Manual Electric Trim (if installed)', response: 'CHECK', check: h.manualTrimChecked },
        { challenge: '20. Elevator Trim', response: 'SET for takeoff', check: trimTakeoff },
        { challenge: '21. Wing Flaps', response: 'SET for takeoff (0°-10°)', check: flaps(0, 10) },
        { challenge: '22. Brakes', response: 'RELEASE', check: off(C172.parkingBrake) },
      ],
    },
    {
      title: 'Normal Takeoff',
      phase: 'takeoff',
      items: [
        { challenge: '1. Wing Flaps', response: '0°-10°', check: flaps(0, 10) },
        { challenge: '2. Throttle', response: 'FULL OPEN', check: throttleFull },
        { challenge: '3. Mixture', response: 'RICH (above 3000 feet, LEAN to obtain maximum RPM)', check: mixtureRich },
        { challenge: '4. Elevator Control', response: 'LIFT NOSE WHEEL (at 55 KIAS)' },
        { challenge: '5. Climb Speed', response: '70-80 KIAS', check: iasRange(70, 80) },
        { challenge: '6. Wing Flaps', response: 'RETRACT', check: flaps(0, 0) },
        // AIM 4-1-20 (current practice, not a POH item): transponder ALT on the airport movement area.
        ...(h.xpdrAlt ? [{ challenge: 'Transponder (AIM 4-1-20, not a POH item)', response: 'ALT', check: h.xpdrAlt }] : []),
      ],
    },
    {
      title: 'Short Field Takeoff',
      phase: 'takeoff',
      items: [
        { challenge: '1. Wing Flaps', response: '10°', check: flaps(10, 10) },
        { challenge: '2. Brakes', response: 'APPLY' },
        { challenge: '3. Throttle', response: 'FULL OPEN', check: throttleFull },
        { challenge: '4. Mixture', response: 'RICH (above 3000 feet, LEAN to obtain maximum RPM)', check: mixtureRich },
        { challenge: '5. Brakes', response: 'RELEASE' },
        { challenge: '6. Elevator Control', response: 'SLIGHTLY TAIL LOW' },
        { challenge: '7. Climb Speed', response: '56 KIAS (until all obstacles are cleared)', check: ias(56, 4) },
        { challenge: '8. Wing Flaps', response: 'RETRACT slowly after reaching 60 KIAS', check: flaps(0, 0) },
      ],
    },
    {
      title: 'Enroute Climb',
      phase: 'climb',
      items: [
        { challenge: '1. Airspeed', response: '70-85 KIAS', check: iasRange(70, 85) },
        { challenge: '2. Throttle', response: 'FULL OPEN', check: throttleFull },
        { challenge: '3. Mixture', response: 'RICH (above 3000 feet, LEAN to obtain maximum RPM)', check: mixtureRich },
      ],
    },
    {
      title: 'Cruise',
      phase: 'cruise',
      items: [
        { challenge: '1. Power', response: '2100-2700 RPM (No more than 75% is recommended)', check: rpm(2100, 2700) },
        { challenge: '2. Elevator Trim', response: 'ADJUST' },
        { challenge: '3. Mixture', response: 'LEAN', check: (v) => v.get(C172.mixture) < 0.95 },
      ],
    },
    {
      title: 'Descent',
      phase: 'descent',
      items: [
        { challenge: '1. Power', response: 'AS DESIRED' },
        { challenge: '2. Mixture', response: 'ADJUST for smooth operation (full rich for idle power)' },
        { challenge: '3. Altimeter', response: 'SET', check: (v) => v.get(ADC.baroStd(1)) < 0.5 && Math.abs(v.get(ADC.baroSetting(1)) - v.get('env.qnh_inhg', 29.92)) <= 0.02 },
        { challenge: '4. NAV/GPS Switch', response: 'SET', check: h.navGpsSet },
        { challenge: '5. Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: '6. Wing Flaps', response: 'AS DESIRED (0° - 10° below 110 KIAS, 10° - 30° below 85 KIAS)' },
      ],
    },
    {
      title: 'Before Landing',
      phase: 'approach',
      items: [
        { challenge: '1. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
        { challenge: '2. Seats and Seat Belts', response: 'SECURED and LOCKED' },
        { challenge: '3. Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: '4. Mixture', response: 'RICH', check: (v) => v.get(C172.mixture) > 0.8 },
        { challenge: '5. Landing/Taxi Lights', response: 'ON', check: (v) => v.get(C172.land) > 0.5 && v.get(C172.taxi) > 0.5 },
        { challenge: '6. Autopilot (if installed)', response: 'OFF', check: off('ap.engaged') },
      ],
    },
    {
      title: 'Normal Landing',
      phase: 'landing',
      items: [
        { challenge: '1. Airspeed', response: '65-75 KIAS (flaps UP)' },
        { challenge: '2. Wing Flaps', response: 'AS DESIRED (0°-10° below 110 KIAS, 10°-30° below 85 KIAS)' },
        { challenge: '3. Airspeed', response: '60-70 KIAS (flaps DOWN)' },
        { challenge: '4. Touchdown', response: 'MAIN WHEELS FIRST' },
        { challenge: '5. Landing Roll', response: 'LOWER NOSE WHEEL GENTLY' },
        { challenge: '6. Braking', response: 'MINIMUM REQUIRED' },
      ],
    },
    {
      title: 'Short Field Landing',
      phase: 'landing',
      items: [
        { challenge: '1. Airspeed', response: '65-75 KIAS (flaps UP)' },
        { challenge: '2. Wing Flaps', response: 'FULL DOWN (30°)', check: flaps(30, 30) },
        { challenge: '3. Airspeed', response: '61 KIAS (until flare)', check: ias(61, 3) },
        { challenge: '4. Power', response: 'REDUCE to idle after clearing obstacle', check: throttleIdle },
        { challenge: '5. Touchdown', response: 'MAIN WHEELS FIRST' },
        { challenge: '6. Brakes', response: 'APPLY HEAVILY' },
        { challenge: '7. Wing Flaps', response: 'RETRACT', check: flaps(0, 0) },
      ],
    },
    {
      title: 'Balked Landing',
      phase: 'go-around',
      items: [
        { challenge: '1. Throttle', response: 'FULL OPEN', check: throttleFull },
        { challenge: '2. Wing Flaps', response: 'RETRACT TO 20°', check: flaps(0, 20) },
        { challenge: '3. Climb Speed', response: '60 KIAS' },
        { challenge: '4. Wing Flaps', response: '10° (until obstacles are cleared). RETRACT (after reaching a safe altitude and 65 KIAS).' },
      ],
    },
    {
      title: 'After Landing',
      phase: 'after landing',
      items: [{ challenge: '1. Wing Flaps', response: 'UP', check: flaps(0, 0) }],
    },
    {
      title: 'Securing Airplane',
      phase: 'shutdown',
      items: [
        { challenge: '1. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        { challenge: '2. Electrical Equipment, Autopilot (if installed)', response: 'OFF', check: (v) => elecEquipOff(v) && v.get('ap.engaged') < 0.5 },
        { challenge: `3. ${AVM}`, response: 'OFF', check: avionicsOff },
        { challenge: '4. Mixture', response: 'IDLE CUTOFF (pulled full out)', check: mixtureCutoff },
        { challenge: `5. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: `6. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '7. Control Lock', response: 'INSTALL', check: on(C172.controlLock) },
        { challenge: '8. Fuel Selector Valve', response: 'LEFT or RIGHT to prevent cross feeding', check: (v) => Math.round(v.get(C172.fuelSelector)) !== FUEL_SEL.both },
      ],
    },
  ];

  const emergency: Checklist[] = [
    {
      title: 'EMERGENCY — Engine Failure During Takeoff Roll',
      phase: 'emergency',
      items: [
        { challenge: '1. Throttle', response: 'IDLE', check: throttleIdle },
        { challenge: '2. Brakes', response: 'APPLY' },
        { challenge: '3. Wing Flaps', response: 'RETRACT', check: flaps(0, 0) },
        { challenge: '4. Mixture', response: 'IDLE CUT OFF', check: mixtureCutoff },
        { challenge: `5. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: `6. ${M}`, response: 'OFF', check: masterOff },
      ],
    },
    {
      title: 'EMERGENCY — Engine Failure Immediately After Takeoff',
      phase: 'emergency',
      items: [
        { challenge: '1. Airspeed', response: '70 KIAS (flaps UP); 65 KIAS (flaps DOWN)', check: glideByFlaps },
        { challenge: '2. Mixture', response: 'IDLE CUT OFF', check: mixtureCutoff },
        { challenge: '3. Fuel Shutoff Valve', response: 'OFF (Pull Full Out)', check: off(C172.fuelShutoff) },
        { challenge: `4. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: '5. Wing Flaps', response: 'AS REQUIRED' },
        { challenge: `6. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '7. Cabin Door', response: 'UNLATCH', check: doorsUnlatched },
        { challenge: '8. Land', response: 'STRAIGHT AHEAD' },
      ],
    },
    {
      title: 'EMERGENCY — Engine Failure During Flight (Restart Procedures)',
      phase: 'emergency',
      items: [
        { challenge: '1. Airspeed', response: '68 KIAS', check: ias(68) },
        { challenge: '2. Fuel Shutoff Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
        { challenge: '3. Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: `4. ${PUMP}`, response: 'ON', check: on(C172.fuelPump) },
        { challenge: '5. Mixture', response: 'RICH (if restart has not occurred)' },
        { challenge: `6. ${IGN}`, response: 'BOTH (or START if propeller is stopped)', check: (v) => eq(C172.magneto, MAG.both)(v) || eq(C172.magneto, MAG.start)(v) },
        header('NOTE: If the propeller is windmilling, the engine will restart automatically within a few seconds. If the propeller has stopped (possible at low speeds), turn the ignition switch to START, advance the throttle slowly from idle and lean the mixture from full rich as required for smooth operation.'),
        { challenge: `7. ${PUMP}`, response: 'OFF', check: off(C172.fuelPump) },
        header('NOTE: If the fuel flow indicator immediately drops to zero (indicating an engine-driven fuel pump failure), return the Auxiliary Fuel Pump Switch to the ON position.'),
      ],
    },
    {
      title: 'EMERGENCY — Emergency Landing Without Engine Power',
      phase: 'emergency',
      items: [
        { challenge: '1. Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
        { challenge: '2. Seats and Seat Belts', response: 'SECURE' },
        { challenge: '3. Airspeed', response: '70 KIAS (flaps UP); 65 KIAS (flaps DOWN)', check: glideByFlaps },
        { challenge: '4. Mixture', response: 'IDLE CUT OFF', check: mixtureCutoff },
        { challenge: '5. Fuel Shutoff Valve', response: 'OFF (Pull Full Out)', check: off(C172.fuelShutoff) },
        { challenge: `6. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: '7. Wing Flaps', response: 'AS REQUIRED (30° recommended)' },
        { challenge: `8. ${M}`, response: 'OFF (when landing is assured)', check: masterOff },
        { challenge: '9. Doors', response: 'UNLATCH PRIOR TO TOUCHDOWN', check: doorsUnlatched },
        { challenge: '10. Touchdown', response: 'SLIGHTLY TAIL LOW' },
        { challenge: '11. Brakes', response: 'APPLY HEAVILY' },
      ],
    },
    {
      title: 'EMERGENCY — Precautionary Landing With Engine Power',
      phase: 'emergency',
      items: [
        { challenge: '1. Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
        { challenge: '2. Seats and Seat Belts', response: 'SECURE' },
        { challenge: '3. Airspeed', response: '65 KIAS', check: ias(65) },
        { challenge: '4. Wing Flaps', response: '20°', check: flaps(20, 20) },
        { challenge: '5. Selected Field', response: 'FLY OVER, noting terrain and obstructions, then retract flaps upon reaching a safe altitude and airspeed' },
        { challenge: `6. ${AVM} and Electrical Switches`, response: 'OFF', check: (v) => avionicsOff(v) && elecEquipOff(v) },
        { challenge: '7. Wing Flaps', response: '30° (on final approach)', check: flaps(30, 30) },
        { challenge: '8. Airspeed', response: '65 KIAS', check: ias(65) },
        { challenge: `9. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '10. Doors', response: 'UNLATCH PRIOR TO TOUCHDOWN', check: doorsUnlatched },
        { challenge: '11. Touchdown', response: 'SLIGHTLY TAIL LOW' },
        { challenge: `12. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: '13. Brakes', response: 'APPLY HEAVILY' },
      ],
    },
    {
      title: 'EMERGENCY — Ditching',
      phase: 'emergency',
      items: [
        { challenge: '1. Radio', response: 'TRANSMIT MAYDAY on 121.5 MHz, giving location and intentions and SQUAWK 7700', check: h.maydaySquawk },
        { challenge: '2. Heavy Objects (in baggage area)', response: 'SECURE OR JETTISON (if possible)' },
        { challenge: '3. Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
        { challenge: '4. Seats and Seat Belts', response: 'SECURE' },
        { challenge: '5. Wing Flaps', response: '20° to 30°', check: flaps(20, 30) },
        { challenge: '6. Power', response: 'ESTABLISH 300 FT/MIN DESCENT AT 55 KIAS', check: (v) => ias(55)(v) && Math.abs(v.get(ADC.vs(1)) + 300) <= 150 },
        header('NOTE: If no power is available, approach at 70 KIAS with flaps up or at 65 KIAS with 10° flaps.'),
        { challenge: '7. Approach', response: 'High Winds, Heavy Seas - INTO THE WIND; Light Winds, Heavy Swells - PARALLEL TO SWELLS' },
        { challenge: '8. Cabin Doors', response: 'UNLATCH', check: doorsUnlatched },
        { challenge: '9. Touchdown', response: 'LEVEL ATTITUDE AT ESTABLISHED RATE OF DESCENT' },
        { challenge: '10. Face', response: 'CUSHION at touchdown with folded coat' },
        { challenge: '11. ELT', response: 'Activate', check: eq(C172.elt, ELT_SW.on) },
        { challenge: '12. Airplane', response: 'EVACUATE through cabin doors. If necessary, open window and flood cabin to equalize pressure so doors can be opened.' },
        { challenge: '13. Life Vests and Raft', response: 'INFLATE WHEN CLEAR OF AIRPLANE' },
      ],
    },
    {
      title: 'EMERGENCY — Fires During Start On Ground',
      phase: 'emergency',
      items: [
        { challenge: `1. ${IGN}`, response: 'START, Continue Cranking to get a start which would suck the flames and accumulated fuel into the engine', check: eq(C172.magneto, MAG.start) },
        header('If engine starts:'),
        { challenge: '2. Power', response: '1800 RPM for a few minutes', check: rpm(1700, 1900) },
        { challenge: '3. Engine', response: 'SHUTDOWN and inspect for damage' },
        header('If engine fails to start:'),
        { challenge: '4. Throttle', response: 'FULL OPEN', check: throttleFull },
        { challenge: '5. Mixture', response: 'IDLE CUT OFF', check: mixtureCutoff },
        { challenge: '6. Cranking', response: 'CONTINUE', check: eq(C172.magneto, MAG.start) },
        { challenge: '7. Fuel Shutoff Valve', response: 'OFF (Pull Full Out)', check: off(C172.fuelShutoff) },
        { challenge: `8. ${PUMP}`, response: 'OFF', check: off(C172.fuelPump) },
        { challenge: '9. Fire Extinguisher', response: 'ACTIVATE', check: on(C172.extinguisher) },
        { challenge: '10. Engine', response: 'SECURE' },
        { challenge: `   a. ${M}`, response: 'OFF', check: masterOff },
        { challenge: `   b. ${IGN}`, response: 'OFF', check: magsOff },
        { challenge: '11. Parking Brake', response: 'RELEASE', check: off(C172.parkingBrake) },
        { challenge: '12. Airplane', response: 'EVACUATE' },
        { challenge: '13. Fire', response: 'EXTINGUISH using fire extinguisher, wool blanket, or dirt', check: (v) => v.get(C172.fireEngine) <= 0 },
        { challenge: '14. Fire Damage', response: 'INSPECT, repair damage or replace damaged components or wiring before conducting another flight' },
      ],
    },
    {
      title: 'EMERGENCY — Engine Fire In Flight',
      phase: 'emergency',
      items: [
        { challenge: '1. Mixture', response: 'IDLE CUT OFF', check: mixtureCutoff },
        { challenge: '2. Fuel Shutoff Valve', response: 'Pull Out (OFF)', check: off(C172.fuelShutoff) },
        { challenge: `3. ${PUMP}`, response: 'OFF', check: off(C172.fuelPump) },
        { challenge: `4. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '5. Cabin Heat and Air', response: 'OFF (except overhead vents)', check: (v) => v.get(C172.cabinHeat) < 0.05 && v.get(C172.cabinAir) < 0.05 },
        { challenge: '6. Airspeed', response: '100 KIAS (If fire is not extinguished, increase glide speed to find an airspeed - within airspeed limitations - which will provide an incombustible mixture)', check: (v) => v.get(ADC.ias(1)) >= 95 },
        { challenge: '7. Forced Landing', response: 'EXECUTE (as described in Emergency Landing Without Engine Power)' },
      ],
    },
    {
      title: 'EMERGENCY — Electrical Fire In Flight',
      phase: 'emergency',
      items: [
        { challenge: `1. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '2. Vents, Cabin Air, Heat', response: 'CLOSED', check: ventsHeatAirClosed },
        { challenge: '3. Fire Extinguisher', response: 'ACTIVATE', check: on(C172.extinguisher) },
        { challenge: `4. ${AVM}`, response: 'OFF', check: avionicsOff },
        { challenge: '5. All Other Switches (except ignition switch)', response: 'OFF', check: elecEquipOff },
        header('WARNING: After discharging fire extinguisher and ascertaining that fire has been extinguished, ventilate the cabin.'),
        { challenge: '6. Vents/Cabin Air/Heat', response: 'OPEN when it is ascertained that fire is completely extinguished', check: (v) => v.get(C172.fireElectrical) <= 0 && ventsOpen(v) },
        header('If fire has been extinguished and electrical power is necessary for continuance of flight to nearest suitable airport or landing area:'),
        { challenge: `7. ${M}`, response: 'ON', check: masterOn },
        { challenge: '8. Circuit Breakers', response: 'CHECK for faulty circuit, do not reset' },
        { challenge: '9. Radio Switches', response: 'OFF', check: avionicsOff },
        { challenge: `10. ${AVM}`, response: 'ON', check: avionicsOn },
        { challenge: '11. Radio/Electrical Switches', response: 'ON one at a time, with delay after each until short circuit is localized' },
      ],
    },
    {
      title: 'EMERGENCY — Cabin Fire',
      phase: 'emergency',
      items: [
        { challenge: `1. ${M}`, response: 'OFF', check: masterOff },
        { challenge: '2. Vents/Cabin Air/Heat', response: 'CLOSED (to avoid drafts)', check: ventsHeatAirClosed },
        { challenge: '3. Fire Extinguisher', response: 'ACTIVATE', check: on(C172.extinguisher) },
        header('WARNING: After discharging fire extinguisher and ascertaining that fire has been extinguished, ventilate the cabin.'),
        { challenge: '4. Vents/Cabin Air/Heat', response: 'OPEN when it is ascertained that fire is completely extinguished', check: (v) => v.get(C172.fireCabin) <= 0 && ventsOpen(v) },
        { challenge: '5. Land the airplane', response: 'as soon as possible to inspect for damage' },
      ],
    },
    {
      title: 'EMERGENCY — Wing Fire',
      phase: 'emergency',
      items: [
        { challenge: '1. Landing/Taxi Light Switches', response: 'OFF', check: (v) => v.get(C172.land) < 0.5 && v.get(C172.taxi) < 0.5 },
        { challenge: '2. Navigation Light Switch', response: 'OFF', check: off(C172.nav) },
        { challenge: '3. Strobe Light Switch', response: 'OFF', check: off(C172.strobe) },
        { challenge: '4. Pitot Heat Switch', response: 'OFF', check: off(C172.pitotHeat) },
        { challenge: 'NOTE', response: 'Perform a sideslip to keep the flames away from the fuel tank and cabin. Land as soon as possible using flaps only as required for final approach and touchdown.', check: (v) => v.get(C172.fireWing) <= 0 },
      ],
    },
    {
      title: 'EMERGENCY — Inadvertent Icing Encounter',
      phase: 'emergency',
      items: [
        { challenge: '1. Turn pitot heat switch ON', response: 'ON', check: on(C172.pitotHeat) },
        { challenge: '2. Turn back or change altitude', response: 'to obtain an outside air temperature that is less conducive to icing' },
        {
          challenge: '3. Pull cabin heat control full out and open defroster outlets',
          response: 'to obtain maximum windshield defroster airflow. Adjust cabin air control to get maximum defroster heat and airflow.',
          check: (v) => v.get(C172.cabinHeat) > 0.9 && v.get(C172.defrostLeft) > 0.9 && v.get(C172.defrostRight) > 0.9,
        },
        { challenge: '4. Watch for signs of engine-related icing conditions', response: 'Change the throttle position to obtain maximum RPM (advance or retard, depending on where ice has accumulated). Adjust mixture, as required, for maximum RPM.' },
        { challenge: '5. Plan a landing at the nearest airport', response: 'With an extremely rapid ice build up, select a suitable "off airport" landing site' },
        { challenge: '6. With an ice accumulation of 1/4 inch or more on the wing leading edges', response: 'be prepared for significantly higher stall speed and a longer landing roll' },
        { challenge: '7. Leave wing flaps retracted', response: 'With a severe ice build up on the horizontal tail, flap extension could result in a loss of elevator effectiveness', check: flaps(0, 0) },
        { challenge: '8. Open left window', response: 'and, if practical, scrape ice from a portion of the windshield for visibility in the landing approach', check: (v) => v.get(C172.windowLeft) > 0.5 },
        { challenge: '9. Perform a landing approach using a forward slip', response: 'if necessary, for improved visibility' },
        { challenge: '10. Approach at 65 to 75 KIAS', response: 'depending upon the amount of the accumulation', check: iasRange(65, 75) },
        { challenge: '11. Perform a landing in level attitude', response: '' },
      ],
    },
    {
      title: 'EMERGENCY — Static Source Blockage (Erroneous Instrument Reading Suspected)',
      phase: 'emergency',
      items: [
        { challenge: '1. Static Pressure Alternate Source Valve', response: 'PULL ON', check: on(C172.altStatic) },
        { challenge: '2. Airspeed', response: 'Consult appropriate calibration tables in Section 5' },
      ],
    },
    {
      title: 'ABNORMAL LANDING — Landing With a Flat Main Tire',
      phase: 'emergency',
      items: [
        { challenge: '1. Approach', response: 'NORMAL' },
        { challenge: '2. Wing Flaps', response: '30°', check: flaps(30, 30) },
        { challenge: '3. Touchdown', response: 'GOOD MAIN TIRE FIRST, hold airplane off flat tire as long as possible with aileron control' },
        { challenge: '4. Directional Control', response: 'MAINTAIN using brake on good wheel as required' },
      ],
    },
    {
      title: 'ABNORMAL LANDING — Landing With a Flat Nose Tire',
      phase: 'emergency',
      items: [
        { challenge: '1. Approach', response: 'NORMAL' },
        { challenge: '2. Flaps', response: 'AS REQUIRED' },
        { challenge: '3. Touchdown', response: 'ON MAINS, hold nose wheel off the ground as long as possible' },
        { challenge: '4. When nose wheel touches down', response: 'maintain full up elevator as airplane slows to stop' },
      ],
    },
    {
      title: 'EMERGENCY — Ammeter Shows Excessive Rate of Charge (Full Scale Deflection)',
      phase: 'emergency',
      items: [
        { challenge: '1. Alternator', response: 'OFF', check: off(C172.masterAlt) },
        header('CAUTION: With the alternator side of the master switch OFF, compass deviations of as much as 25° may occur.'),
        { challenge: '2. Nonessential Electrical Equipment', response: 'OFF', check: (v) => v.get(C172.land) < 0.5 && v.get(C172.taxi) < 0.5 && v.get(C172.pitotHeat) < 0.5 && v.get(C172.cabinPwr12v) < 0.5 },
        { challenge: '3. Flight', response: 'TERMINATE as soon as practical' },
      ],
    },
    {
      title: 'EMERGENCY — Low Voltage Annunciator (VOLTS) Illuminates During Flight (Ammeter Indicates Discharge)',
      phase: 'emergency',
      items: [
        header('NOTE: Illumination of "VOLTS" may occur during low RPM conditions with an electrical load on the system such as during a low RPM taxi. Under these conditions, the annunciator will go out at higher RPM.'),
        { challenge: `1. ${AVM}`, response: 'OFF', check: avionicsOff },
        { challenge: '2. Alternator Circuit Breaker (ALT FLD)', response: 'CHECK IN', check: (v) => v.get('cb.alt_fld', 1) > 0.5 },
        { challenge: `3. ${M}`, response: 'OFF (both sides)', check: masterOff },
        { challenge: `4. ${M}`, response: 'ON', check: masterOn },
        { challenge: '5. Low Voltage Annunciator (VOLTS)', response: 'CHECK OFF', check: off(ANN.lowVolts) },
        { challenge: `6. ${AVM}`, response: 'ON', check: avionicsOn },
        header('If low voltage annunciator (VOLTS) illuminates again:'),
        { challenge: '7. Alternator', response: 'OFF', check: off(C172.masterAlt) },
        { challenge: '8. Nonessential Radio and Electrical Equipment', response: 'OFF' },
        { challenge: '9. Flight', response: 'TERMINATE as soon as practical' },
      ],
    },
    {
      title: 'EMERGENCY — Vacuum System Failure (L VAC or VAC R Annunciator Illuminates)',
      phase: 'emergency',
      items: [
        header('CAUTION: If vacuum is not within normal operating limits, a failure has occurred in the vacuum system and partial panel procedures may be required for continued flight.'),
        { challenge: '1. Vacuum Gage', response: 'CHECK to ensure vacuum within normal operating limits', check: (v) => v.get('ac.vac.suction_inhg') >= 4.5 && v.get('ac.vac.suction_inhg') <= 5.5 },
      ],
    },
  ];
  return [...normal, ...emergency];
}
