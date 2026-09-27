/**
 * Cessna 172S NAV III (G1000 NXi) with the GFC 700 AFCS: POH checklists.
 *
 * Wording from the Cessna 172S NAV III GFC 700 AFCS POH/AFM 172SPHBUS-02 (Revision 2,
 * 18 November 2010; the latest full edition found publicly), Section 4 "Normal procedures"
 * (checklist form, pages 4-4 .. 4-22) and Section 3 "Emergency procedures" (3-6 .. 3-24),
 * transcribed item by item. Sub-items keep the POH "a.", "b." labels; conditional headers
 * ("IF ENGINE STARTS", "IF LOW VOLTS ANNUNCIATOR REMAINS ON") are un-checked items with an
 * empty response. The NXi airplane has LED landing/taxi lights, so the Rev 2 "LED" variant
 * items are used. The Taxi list is not a POH checklist: it is built from the POH amplified
 * procedures "Leaning for ground operations" (4-26) and "Taxiing" (4-28, Fig 4-2), in the
 * form operator checklists derived from this POH carry it.
 *
 * Items with a `check` show a live tick. Action-sequence checks (STBY BATT TEST, autopilot
 * preflight test, magneto check, annunciation count) read the latches of
 * systems/procedures.ts. Airspeed items read the PFD air data (adc1.ias_kt).
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, AP, ENG, FDM, FUEL, NAV, SURF } from '../../core/vars';
import { ANN, C172, DOOR, FUEL_SEL, MAG, STBY_BATT } from '../c172s-common/vars';
import { G1000_BREAKERS } from '../c172s-common/systems/electrical';
import { G1K } from '../../avionics/garmin-g1000/vars';
import { C172G, ELT_ROCKER } from './vars';
import { C172G_PROC } from './systems/procedures';

type V = SimContext['vars'];
const on = (name: string) => (v: V) => v.get(name) > 0.5;
const off = (name: string) => (v: V) => v.get(name) < 0.5;
const eq = (name: string, x: number) => (v: V) => Math.round(v.get(name)) === x;
const flaps = (lo: number, hi: number) => (v: V) => v.get(SURF.flapsDeg) >= lo - 0.5 && v.get(SURF.flapsDeg) <= hi + 0.5;
const masterOn = (v: V) => v.get(C172.masterBat) > 0.5 && v.get(C172.masterAlt) > 0.5;
const masterOff = (v: V) => v.get(C172.masterBat) < 0.5 && v.get(C172.masterAlt) < 0.5;
const avionicsOn = (v: V) => v.get(C172.avionicsBus1) > 0.5 && v.get(C172.avionicsBus2) > 0.5;
const avionicsOff = (v: V) => v.get(C172.avionicsBus1) < 0.5 && v.get(C172.avionicsBus2) < 0.5;
const mixtureCutoff = (v: V) => v.get(C172.mixture) < 0.05;
const mixtureRich = (v: V) => v.get(C172.mixture) > 0.8 || v.get(FDM.pressAlt) > 3000;
const throttleIdle = (v: V) => v.get(C172.throttle) < 0.03;
const throttleFull = (v: V) => v.get(C172.throttle) > 0.97;
const rpm = (lo: number, hi: number) => (v: V) => v.get(ENG.rpm(1)) >= lo && v.get(ENG.rpm(1)) <= hi;
/** PFD airspeed within `tol` kt of `kt` (valid air data only). */
const ias = (kt: number, tol = 5) => (v: V) => v.get('adc1.valid') > 0.5 && Math.abs(v.get(ADC.ias(1)) - kt) <= tol;
const iasRange = (lo: number, hi: number) => (v: V) => v.get('adc1.valid') > 0.5 && v.get(ADC.ias(1)) >= lo && v.get(ADC.ias(1)) <= hi;
/** POH 3-5: 70 KIAS flaps UP, 65 KIAS flaps 10° - FULL. */
const glideByFlaps = (v: V) => (v.get(SURF.flapsDeg) < 5 ? ias(70)(v) : ias(65)(v));
const unitUp = (u: Parameters<typeof G1K.unitUp>[0]) => on(G1K.unitUp(u));
/** Baro setting within 0.01 inHg of the local QNH (PFD BARO: adc1, standby altimeter: adc2). */
const baroSet = (s: number) => (v: V) => v.get(ADC.baroStd(s)) < 0.5 && Math.abs(v.get(ADC.baroSetting(s)) - v.get('env.qnh_inhg', 29.92)) <= 0.015;
/** POH Fig 2-3 fuel quantity markings: yellow 0 to 5 gal, green 5 to 24 gal (Before Takeoff 10 NOTE: flight not recommended in the yellow band). */
const FUEL_YELLOW_KG = 5 * 6 * 0.45359237;
const fuelQtyOk = (v: V) => v.get(FUEL.tankKg(0)) > FUEL_YELLOW_KG && v.get(FUEL.tankKg(1)) > FUEL_YELLOW_KG;
/** Every G1000 panel circuit breaker pushed in (cb.<name> = 1). */
const CB_VARS = G1000_BREAKERS.map((b) => `cb.${b.name}`);
const breakersIn = (v: V) => CB_VARS.every((n) => v.get(n, 1) > 0.5);
/** Electrical equipment off: exterior lights, pitot heat, 12 V cabin power, fuel pump. */
const ELEC_EQUIP = [C172.beacon, C172.land, C172.taxi, C172.nav, C172.strobe, C172.pitotHeat, C172.cabinPwr12v, C172.fuelPump];
const elecEquipOff = (v: V) => ELEC_EQUIP.every((n) => v.get(n) < 0.5);
const ventsClosed = (v: V) => v.get(C172.ventLeft) < 0.05 && v.get(C172.ventRight) < 0.05;
const ventsOpen = (v: V) => v.get(C172.ventLeft) > 0.5 || v.get(C172.ventRight) > 0.5;
const heatAirOff = (v: V) => v.get(C172.cabinHeat) < 0.05 && v.get(C172.cabinAir) < 0.05;
const heatAirOn = (v: V) => v.get(C172.cabinHeat) > 0.9 && v.get(C172.cabinAir) > 0.9;
const doorsUnlatched = (v: V) => Math.round(v.get(C172.doorLeft)) === DOOR.open || Math.round(v.get(C172.doorRight)) === DOOR.open;
/** GMA 1360: COM1 MIC and NAV1 audio selected (POH 3-18 j). */
const com1Nav1 = (v: V) => Math.round(v.get(G1K.gmaMic)) === 1 && v.get(G1K.gmaSel('nav1')) > 0.5;
const adcAhrsCbIn = (v: V) => v.get('cb.adc_ahrs_ess', 1) > 0.5 && v.get('cb.adc_ahrs_avn1', 1) > 0.5;
const header = (text: string) => ({ challenge: text, response: '' });

const MASTER = 'MASTER Switch (ALT and BAT)';
const AVIONICS = 'AVIONICS Switch (BUS 1 and BUS 2)';
const STBY = 'STBY BATT Switch';
const DRAIN = 'DRAIN (at least a cupful: water, sediment, proper fuel grade)';
const TIRE = 'CHECK (proper inflation and general condition (weather checks, tread depth and wear, etc.))';

/** POH 3-17 / 3-19 "Electrical Load - REDUCE IMMEDIATELY as follows" (a-k). */
const LOAD_SHED: Checklist['items'] = [
  { challenge: 'Electrical Load', response: 'REDUCE IMMEDIATELY as follows:' },
  { challenge: 'a. AVIONICS Switch (BUS 1)', response: 'OFF', check: off(C172.avionicsBus1) },
  { challenge: 'b. PITOT HEAT Switch', response: 'OFF', check: off(C172.pitotHeat) },
  { challenge: 'c. BEACON Light Switch', response: 'OFF', check: off(C172.beacon) },
  { challenge: 'd. LAND Light Switch', response: 'OFF (use as required for landing)', check: off(C172.land) },
  { challenge: 'e. TAXI Light Switch', response: 'OFF', check: off(C172.taxi) },
  { challenge: 'f. NAV Light Switch', response: 'OFF', check: off(C172.nav) },
  { challenge: 'g. STROBE Light Switch', response: 'OFF', check: off(C172.strobe) },
  { challenge: 'h. CABIN PWR 12V Switch', response: 'OFF', check: off(C172.cabinPwr12v) },
  { challenge: 'i. COM1 and NAV1', response: 'TUNE TO ACTIVE FREQUENCY' },
  { challenge: 'j. COM1 MIC and NAV1', response: 'SELECT (COM2 MIC and NAV2 will be inoperative once AVIONICS BUS 2 is selected to OFF)', check: com1Nav1 },
  { challenge: 'k. AVIONICS Switch (BUS 2)', response: 'OFF (KEEP ON if in clouds)', check: off(C172.avionicsBus2) },
];

export const C172G_CHECKLISTS: Checklist[] = [
  // ======================================================================= NORMAL (POH Section 4)
  {
    title: 'Preflight Inspection — 1 Cabin',
    phase: 'preflight',
    items: [
      { challenge: '1. Pitot Tube Cover', response: 'REMOVE (check for pitot blockage)' },
      { challenge: "2. Pilot's Operating Handbook", response: 'ACCESSIBLE TO PILOT' },
      { challenge: '3. Garmin G1000 Cockpit Reference Guide', response: 'ACCESSIBLE TO PILOT' },
      { challenge: '4. Airplane Weight and Balance', response: 'CHECKED' },
      { challenge: '5. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
      { challenge: '6. Control Wheel Lock', response: 'REMOVE', check: off(C172.controlLock) },
      { challenge: '7. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: `8. ${AVIONICS}`, response: 'OFF', check: avionicsOff },
      { challenge: `9. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: '10. Primary Flight Display (PFD)', response: 'CHECK (verify PFD is ON)', check: unitUp('pfd') },
      { challenge: '11. FUEL QTY (L and R)', response: 'CHECK', check: (v) => unitUp('pfd')(v) && unitUp('gea')(v) && fuelQtyOk(v) },
      { challenge: '12. LOW FUEL L and LOW FUEL R Annunciators', response: 'CHECK (verify annunciators are not shown on PFD)', check: (v) => v.get(ANN.lowFuelL) < 0.5 && v.get(ANN.lowFuelR) < 0.5 },
      { challenge: '13. OIL PRESSURE Annunciator', response: 'CHECK (verify annunciator is shown)', check: on(ANN.oilPress) },
      { challenge: '14. LOW VACUUM Annunciator', response: 'CHECK (verify annunciator is shown)', check: on(ANN.lowVacuum) },
      { challenge: '15. AVIONICS Switch (BUS 1)', response: 'ON', check: on(C172.avionicsBus1) },
      { challenge: '16. Forward Avionics Fan', response: 'CHECK (verify fan is heard)', check: on('ac.c172g.fwd_fan') },
      { challenge: '17. AVIONICS Switch (BUS 1)', response: 'OFF', check: off(C172.avionicsBus1) },
      { challenge: '18. AVIONICS Switch (BUS 2)', response: 'ON', check: on(C172.avionicsBus2) },
      { challenge: '19. Aft Avionics Fan', response: 'CHECK (verify fan is heard)', check: on('ac.c172g.aft_fan') },
      { challenge: '20. AVIONICS Switch (BUS 2)', response: 'OFF', check: off(C172.avionicsBus2) },
      { challenge: '21. PITOT HEAT Switch', response: 'ON (carefully check that pitot tube is warm to the touch within 30 seconds)', check: (v) => v.get('elec.pitot_heat_amps') > 1 },
      { challenge: '22. PITOT HEAT Switch', response: 'OFF', check: off(C172.pitotHeat) },
      { challenge: '23. LOW VOLTS Annunciator', response: 'CHECK (verify annunciator is shown)', check: on(ANN.lowVolts) },
      { challenge: `24. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '25. Elevator Trim Control', response: 'TAKEOFF position', check: (v) => Math.abs(v.get(C172.trimPosition) - 0.1) < 0.12 },
      { challenge: '26. FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '27. ALT STATIC AIR Valve', response: 'OFF (push full in)', check: off(C172.altStatic) },
      // POH 7-79 preflight: gage in the green arc and the lock (ring) pin secure.
      { challenge: '28. Fire Extinguisher', response: 'CHECK (verify gage pointer in green arc)', check: (v) => v.get('ac.c172g.ext_psi') >= 125 && v.get('ac.c172g.ext_pin') < 0.5 },
    ],
  },
  {
    // SCOPE: the walk-around items have no simulated state (pitot cover, tiedowns, gust lock, sump
    // contamination, oil quantity) except the baggage door (C172.baggageDoor), so they are read-and-do.
    title: 'Preflight Inspection — Exterior (2 - 8)',
    phase: 'preflight',
    items: [
      header('2 EMPENNAGE'),
      { challenge: '1. Baggage Compartment Door', response: 'CHECK (lock with key)', check: eq(C172.baggageDoor, DOOR.locked) },
      { challenge: '2. Rudder Gust Lock (if installed)', response: 'REMOVE' },
      { challenge: '3. Tail Tiedown', response: 'DISCONNECT' },
      { challenge: '4. Control Surfaces', response: 'CHECK (freedom of movement and security)' },
      { challenge: '5. Elevator Trim Tab', response: 'CHECK (security)' },
      { challenge: '6. Antennas', response: 'CHECK (security of attachment and general condition)' },
      header('3 RIGHT WING Trailing Edge'),
      { challenge: '1. Flap', response: 'CHECK (security and condition)' },
      { challenge: '2. Aileron', response: 'CHECK (freedom of movement and security)' },
      header('4 RIGHT WING'),
      { challenge: '1. Landing/Taxi Light(s)', response: 'CHECK (condition and cleanliness of cover) (If installed)' },
      { challenge: '2. Wing Tiedown', response: 'DISCONNECT' },
      { challenge: '3. Main Wheel Tire', response: TIRE },
      { challenge: '4. Fuel Tank Sump Quick Drain Valves', response: DRAIN },
      { challenge: '5. Fuel Quantity', response: 'CHECK VISUALLY (for desired level)' },
      { challenge: '6. Fuel Filler Cap', response: 'SECURE and VENT CLEAR' },
      header('5 NOSE'),
      { challenge: '1. Fuel Strainer Quick Drain Valve (located on bottom of fuselage)', response: DRAIN },
      { challenge: '2. Engine Oil Dipstick/Filler Cap: a. Oil level', response: 'CHECK (do not operate with less than 5 quarts; fill to 8 quarts for extended flight)' },
      { challenge: '   b. Dipstick/filler cap', response: 'SECURE' },
      { challenge: '3. Engine Cooling Air Inlets', response: 'CHECK (clear of obstructions)' },
      { challenge: '4. Propeller and Spinner', response: 'CHECK (for nicks and security)' },
      { challenge: '5. Air Filter', response: 'CHECK (for restrictions by dust or other foreign matter)' },
      { challenge: '6. Nosewheel Strut and Tire', response: 'CHECK (proper inflation of strut and general condition of tire (weather checks, tread depth and wear, etc.))' },
      { challenge: '7. Static Source Opening (left side of fuselage)', response: 'CHECK (verify opening is clear)' },
      header('6 LEFT WING'),
      { challenge: '1. Fuel Quantity', response: 'CHECK VISUALLY (for desired level)' },
      { challenge: '2. Fuel Filler Cap', response: 'SECURE and VENT CLEAR' },
      { challenge: '3. Fuel Tank Sump Quick Drain Valves', response: DRAIN },
      { challenge: '4. Main Wheel Tire', response: TIRE },
      header('7 LEFT WING Leading Edge'),
      { challenge: '1. Fuel Tank Vent Opening', response: 'CHECK (blockage)' },
      { challenge: '2. Stall Warning Opening', response: 'CHECK (blockage)' },
      { challenge: '3. Wing Tiedown', response: 'DISCONNECT' },
      { challenge: '4. Landing/Taxi Light(s)', response: 'CHECK (condition and cleanliness of cover)' },
      header('8 LEFT WING Trailing Edge'),
      { challenge: '1. Aileron', response: 'CHECK (freedom of movement and security)' },
      { challenge: '2. Flap', response: 'CHECK (security and condition)' },
    ],
  },
  {
    title: 'Before Starting Engine',
    phase: 'before start',
    items: [
      { challenge: '1. Preflight Inspection', response: 'COMPLETE' },
      { challenge: '2. Passenger Briefing', response: 'COMPLETE' },
      { challenge: '3. Seats and Seat Belts', response: 'ADJUST and LOCK (verify inertia reel locking)' },
      { challenge: '4. Brakes', response: 'TEST and SET', check: on(C172.parkingBrake) },
      { challenge: '5. Circuit Breakers', response: 'CHECK IN', check: breakersIn },
      { challenge: '6. Electrical Equipment', response: 'OFF', check: elecEquipOff },
      { challenge: `7. ${AVIONICS}`, response: 'OFF', check: avionicsOff },
      { challenge: '8. FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '9. FUEL SHUTOFF Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
    ],
  },
  {
    title: 'Starting Engine (With Battery)',
    phase: 'start',
    items: [
      { challenge: '1. Throttle Control', response: 'OPEN 1/4 INCH', check: (v) => v.get(C172.throttle) > 0.02 && v.get(C172.throttle) < 0.2 },
      { challenge: '2. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '3. STBY BATT Switch: a. TEST', response: '(hold for 10 seconds, verify that green TEST lamp does not go off)', check: on(C172G_PROC.stbyTestOk) },
      { challenge: '   b. ARM', response: '(verify that PFD comes on)', check: (v) => eq(C172.stbyBatt, STBY_BATT.arm)(v) && unitUp('pfd')(v) },
      { challenge: '4. Engine Indicating System', response: "CHECK PARAMETERS (verify no red X's through ENGINE page indicators)", check: on('elec.nav1_eng_powered') },
      { challenge: '5. BUS E Volts', response: 'CHECK (verify 24 VOLTS minimum shown)', check: (v) => v.get(C172.eBusV) >= 24 },
      { challenge: '6. M BUS Volts', response: 'CHECK (verify 1.5 VOLTS or less shown)', check: (v) => v.get(C172.mBusV) <= 1.5 },
      { challenge: '7. BATT S Amps', response: 'CHECK (verify discharge shown (negative))', check: (v) => v.get(C172.sBattA) < 0 },
      { challenge: '8. STBY BATT Annunciator', response: 'CHECK (verify annunciator is shown)', check: on(ANN.stbyBatt) },
      { challenge: '9. Propeller Area', response: 'CLEAR (verify that all people and equipment are at a safe distance from the propeller)' },
      { challenge: `10. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: '11. BEACON Light Switch', response: 'ON', check: on(C172.beacon) },
      header('NOTE: If engine is warm, omit priming procedure steps 12 thru 14'),
      { challenge: '12. FUEL PUMP Switch', response: 'ON', check: on(C172.fuelPump) },
      { challenge: '13. Mixture Control', response: 'SET to FULL RICH (full forward) until stable fuel flow is indicated (approximately 3 to 5 seconds), then set to IDLE CUTOFF (full aft) position.' },
      { challenge: '14. FUEL PUMP Switch', response: 'OFF', check: off(C172.fuelPump) },
      { challenge: '15. MAGNETOS Switch', response: 'START (release when engine starts)' },
      { challenge: '16. Mixture Control', response: 'ADVANCE SMOOTHLY TO RICH (when engine starts)', check: (v) => v.get(C172.mixture) > 0.8 },
      // POH Fig 2-3 / 7-32: oil pressure green band 50 to 90 PSI.
      { challenge: '17. Oil Pressure', response: 'CHECK (verify that oil pressure increases into the GREEN BAND range in 30 to 60 seconds)', check: (v) => v.get(ENG.oilPressPsi(1)) >= 50 },
      { challenge: '18. AMPS (M BATT and BATT S)', response: 'CHECK (verify charge shown (positive))', check: (v) => v.get(C172.mBattA) > 0 && v.get(C172.sBattA) > 0 },
      { challenge: '19. LOW VOLTS Annunciator', response: 'CHECK (verify annunciator is not shown)', check: off(ANN.lowVolts) },
      { challenge: '20. NAV Light Switch', response: 'ON as required' },
      { challenge: `21. ${AVIONICS}`, response: 'ON', check: avionicsOn },
    ],
  },
  {
    // Ground power: the GPU plug at the receptacle on the left cowl (cockpit shell click-spot / ground services,
    // C172G.gpuRequest -> C172.extPower, systems/variant.ts).
    title: 'Starting Engine (With External Power)',
    phase: 'start',
    items: [
      { challenge: '1. Throttle Control', response: 'OPEN 1/4 INCH', check: (v) => v.get(C172.throttle) > 0.02 && v.get(C172.throttle) < 0.2 },
      { challenge: '2. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '3. STBY BATT Switch: a. TEST', response: '(hold for 10 seconds, verify green TEST lamp does not go off)', check: on(C172G_PROC.stbyTestOk) },
      { challenge: '   b. ARM', response: '(verify that PFD comes on)', check: (v) => eq(C172.stbyBatt, STBY_BATT.arm)(v) && unitUp('pfd')(v) },
      { challenge: '4. Engine Indication System', response: "CHECK PARAMETERS (verify no red X's through ENGINE page indicators)", check: on('elec.nav1_eng_powered') },
      { challenge: '5. BUS E Volts', response: 'CHECK (verify 24 VOLTS minimum shown)', check: (v) => v.get(C172.eBusV) >= 24 },
      { challenge: '6. M BUS Volts', response: 'CHECK (verify 1.5 VOLTS or less shown)', check: (v) => v.get(C172.mBusV) <= 1.5 },
      { challenge: '7. BATT S Amps', response: 'CHECK (verify discharge shown (negative))', check: (v) => v.get(C172.sBattA) < 0 },
      { challenge: '8. STBY BATT Annunciator', response: 'CHECK (verify annunciator is shown)', check: on(ANN.stbyBatt) },
      { challenge: `9. ${AVIONICS}`, response: 'OFF', check: avionicsOff },
      { challenge: `10. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '11. Propeller Area', response: 'CLEAR (verify that all people and equipment are at a safe distance from the propeller)' },
      { challenge: '12. External Power', response: 'CONNECT (to ground power receptacle)', check: on(C172.extPower) },
      { challenge: `13. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: '14. BEACON Light Switch', response: 'ON', check: on(C172.beacon) },
      { challenge: '15. M BUS VOLTS', response: 'CHECK (verify that approximately 28 VOLTS is shown)', check: (v) => on(C172.extPower)(v) && Math.abs(v.get(C172.mBusV) - 28) <= 1 },
      header('NOTE: If engine is warm, omit priming procedure steps 16 thru 18'),
      { challenge: '16. FUEL PUMP Switch', response: 'ON', check: on(C172.fuelPump) },
      { challenge: '17. Mixture Control', response: 'SET to FULL RICH (full forward) until stable fuel flow is indicated (approximately 3 to 5 seconds), then set to IDLE CUTOFF (full aft) position.' },
      { challenge: '18. FUEL PUMP Switch', response: 'OFF', check: off(C172.fuelPump) },
      { challenge: '19. MAGNETOS Switch', response: 'START (release when engine starts)' },
      { challenge: '20. Mixture Control', response: 'ADVANCE SMOOTHLY TO RICH (when engine starts)', check: (v) => v.get(C172.mixture) > 0.8 },
      { challenge: '21. Oil Pressure', response: 'CHECK (verify oil pressure increases into the GREEN BAND range in 30 to 60 seconds)', check: (v) => v.get(ENG.oilPressPsi(1)) >= 50 },
      { challenge: '22. Power', response: 'REDUCE TO IDLE', check: throttleIdle },
      { challenge: '23. External Power', response: 'DISCONNECT FROM GROUND POWER (latch external power receptacle door)', check: off(C172.extPower) },
      { challenge: '24. Power', response: 'INCREASE (to approximately 1500 RPM for several minutes to charge battery)', check: rpm(1400, 1600) },
      { challenge: '25. AMPS (M BATT and BATT S)', response: 'CHECK (verify charge shown (positive))', check: (v) => v.get(C172.mBattA) > 0 && v.get(C172.sBattA) > 0 },
      { challenge: '26. LOW VOLTS Annunciator', response: 'CHECK (verify annunciator is not shown)', check: off(ANN.lowVolts) },
      { challenge: '27. Internal Power', response: 'CHECK' },
      { challenge: '   a. MASTER Switch (ALT)', response: 'OFF', check: off(C172.masterAlt) },
      // Rev 2: "For Airplanes Equipped With LED Landing/Taxi Lights (1) LAND Switch - ON" (the NXi has LED lights).
      { challenge: '   b. Taxi and Landing Lights (LED): LAND Switch', response: 'ON', check: on(C172.land) },
      { challenge: '   c. Throttle Control', response: 'REDUCE TO IDLE', check: throttleIdle },
      { challenge: `   d. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: '   e. Throttle Control', response: 'INCREASE (to approximately 1500 RPM)', check: rpm(1400, 1600) },
      { challenge: '   f. M BATT Ammeter', response: 'CHECK (verify battery charging, amps positive)', check: (v) => v.get(C172.mBattA) > 0 },
      { challenge: '   g. LOW VOLTS Annunciator', response: 'CHECK (verify annunciator is not shown)', check: off(ANN.lowVolts) },
      header('WARNING: If M BATT does not show a positive charge or LOW VOLTS does not go off, service or replace the battery before flight'),
      { challenge: '28. NAV Light Switch', response: 'ON (as required)' },
      { challenge: `29. ${AVIONICS}`, response: 'ON', check: avionicsOn },
    ],
  },
  {
    // Not a POH checklist: POH 172SPHBUS-02 amplified procedures "Leaning for ground operations" (4-26) and
    // "Taxiing" (4-28, Fig 4-2), with the brake and turn instrument checks operator checklists add for taxi.
    title: 'Taxi (POH amplified procedures)',
    phase: 'taxi',
    items: [
      { challenge: 'Leaning for ground operations: Throttle Control', response: 'SET to 1200 RPM' },
      { challenge: 'Mixture Control', response: 'LEAN for maximum RPM' },
      { challenge: 'Throttle Control', response: 'RPM appropriate for ground operations (800 to 1000 RPM recommended)', check: rpm(780, 1020) },
      { challenge: 'Brakes', response: 'CHECK' },
      { challenge: 'Flight Instruments', response: 'CHECK during turns (HSI heading changes, turn rate indicator, standby attitude indicator steady)', check: (v) => v.get('ahrs1.valid') > 0.5 && v.get('ac.vac.suction_inhg') >= 4.5 },
      { challenge: 'Flight Controls', response: 'POSITION for wind (Fig 4-2 Taxiing Diagram)' },
      header('NOTE: LOW VOLTS may come on at low RPM with a high electrical load; it goes off at higher RPM (verify M BATT AMPS positive)'),
    ],
  },
  {
    title: 'Before Takeoff',
    phase: 'before takeoff',
    items: [
      { challenge: '1. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
      { challenge: '2. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
      { challenge: '3. Seats and Seat Belts', response: 'CHECK SECURE' },
      { challenge: '4. Cabin Doors', response: 'CLOSED and LOCKED', check: (v) => v.get(C172.doorLeft) >= 2 && v.get(C172.doorRight) >= 2 },
      { challenge: '5. Flight Controls', response: 'FREE and CORRECT', check: off(C172.controlLock) },
      { challenge: '6. Flight Instruments (PFD)', response: "CHECK (no red X's)", check: (v) => v.get('adc1.valid') > 0.5 && v.get('ahrs1.valid') > 0.5 },
      { challenge: '7. Altimeters: a. PFD (BARO)', response: 'SET', check: baroSet(1) },
      { challenge: '   b. Standby Altimeter', response: 'SET', check: baroSet(2) },
      { challenge: '8. ALT SEL', response: 'SET', check: (v) => v.get(AP.selAltitude) >= v.get(ADC.baroAlt(1)) + 100 },
      { challenge: '9. Standby Flight Instruments', response: 'CHECK', check: (v) => v.get('ac.vac.suction_inhg') >= 4.5 },
      { challenge: '10. Fuel Quantity', response: 'CHECK (verify level is correct)', check: fuelQtyOk },
      { challenge: '11. Mixture Control', response: 'RICH', check: mixtureRich },
      { challenge: '12. FUEL SELECTOR Valve', response: 'SET BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '13. Autopilot', response: 'ENGAGE (if installed) (push AP button on either PFD or MFD bezel)', check: on(C172G_PROC.apGroundEngaged) },
      { challenge: '14. Flight Controls', response: 'CHECK (verify autopilot can be overpowered in both pitch and roll axes)', check: on(C172G_PROC.apOverpowered) },
      { challenge: '15. A/P TRIM DISC Button', response: 'PRESS (if installed) (verify autopilot disengages and aural alert is heard)', check: (v) => on(C172G_PROC.apDiscTest)(v) && off('ap.engaged')(v) },
      { challenge: '16. Flight Director', response: 'OFF (if installed) (push FD button on either PFD or MFD bezel)', check: off('ap.fd1_on') },
      { challenge: '17. Elevator Trim Control', response: 'SET FOR TAKEOFF', check: (v) => Math.abs(v.get(C172.trimPosition) - 0.1) < 0.12 },
      { challenge: '18. Throttle Control', response: '1800 RPM', check: rpm(1740, 1860) },
      { challenge: '   a. MAGNETOS Switch', response: 'CHECK (RPM drop should not exceed 175 RPM on either magneto or 50 RPM differential between magnetos)', check: on(C172G_PROC.magCheckOk) },
      { challenge: '   b. VAC Indicator', response: 'CHECK', check: (v) => v.get('ac.vac.suction_inhg') >= 4.5 && v.get('ac.vac.suction_inhg') <= 5.5 },
      // POH Fig 2-3 / 7-32: oil pressure green band 50 to 90 PSI.
      { challenge: '   c. Engine Indicators', response: 'CHECK', check: (v) => v.get(ENG.oilPressPsi(1)) >= 50 && v.get(ENG.oilPressPsi(1)) <= 90 },
      // POH 3-19: M BUS VOLTS 27.5 V minimum with the alternator on line.
      { challenge: '   d. Ammeters and Voltmeters', response: 'CHECK', check: (v) => v.get(C172.mBusV) >= 27.5 && v.get(C172.mBattA) >= 0 },
      { challenge: '19. Annunciators', response: 'CHECK (verify no annunciators are shown)', check: (v) => v.get(C172G_PROC.annunciations) === 0 && unitUp('pfd')(v) },
      { challenge: '20. Throttle Control', response: 'CHECK IDLE' },
      { challenge: '21. Throttle Control', response: '1000 RPM or LESS', check: (v) => v.get(ENG.rpm(1)) <= 1050 },
      { challenge: '22. Throttle Control Friction Lock', response: 'ADJUST', check: (v) => v.get(C172.throttleFriction) > 0.1 },
      { challenge: '23. COM Frequency(s)', response: 'SET' },
      { challenge: '24. NAV Frequency(s)', response: 'SET' },
      { challenge: '25. FMS/GPS Flight Plan', response: 'AS DESIRED (GPS availability and status can be checked on AUX-GPS STATUS page)' },
      { challenge: '26. XPDR', response: 'SET', check: eq(NAV.xpdrMode, 3) },
      { challenge: '27. CDI Softkey', response: 'SELECT NAV SOURCE' },
      { challenge: '28. CABIN PWR 12V Switch', response: 'OFF', check: off(C172.cabinPwr12v) },
      { challenge: '29. Wing Flaps', response: 'UP - 10° (10° preferred)', check: flaps(0, 10) },
      { challenge: '30. Cabin Windows', response: 'CLOSED and LOCKED', check: (v) => v.get(C172.windowLeft) < 0.05 && v.get(C172.windowRight) < 0.05 },
      { challenge: '31. STROBE Light Switch', response: 'ON', check: on(C172.strobe) },
      { challenge: '32. Brakes', response: 'RELEASE', check: off(C172.parkingBrake) },
    ],
  },
  {
    title: 'Normal Takeoff',
    phase: 'takeoff',
    items: [
      { challenge: '1. Wing Flaps', response: 'UP - 10° (10° preferred)', check: flaps(0, 10) },
      { challenge: '2. Throttle Control', response: 'FULL (push full in)', check: throttleFull },
      { challenge: '3. Mixture Control', response: 'RICH (above 3000 feet pressure altitude, lean for maximum RPM)', check: mixtureRich },
      { challenge: '4. Elevator Control', response: 'LIFT NOSEWHEEL AT 55 KIAS' },
      { challenge: '5. Climb Airspeed', response: '70 - 80 KIAS', check: iasRange(70, 80) },
      { challenge: '6. Wing Flaps', response: 'RETRACT (at safe altitude)', check: flaps(0, 0) },
    ],
  },
  {
    title: 'Short Field Takeoff',
    phase: 'takeoff',
    items: [
      { challenge: '1. Wing Flaps', response: '10°', check: flaps(10, 10) },
      { challenge: '2. Brakes', response: 'APPLY' },
      { challenge: '3. Throttle Control', response: 'FULL (push full in)', check: throttleFull },
      { challenge: '4. Mixture Control', response: 'RICH (above 3000 feet pressure altitude, lean for maximum RPM)', check: mixtureRich },
      { challenge: '5. Brakes', response: 'RELEASE' },
      { challenge: '6. Elevator Control', response: 'SLIGHTLY TAIL LOW' },
      { challenge: '7. Climb Airspeed', response: '56 KIAS (until all obstacles are cleared)' },
      { challenge: '8. Wing Flaps', response: 'RETRACT SLOWLY (when airspeed is more than 60 KIAS)' },
    ],
  },
  {
    title: 'Enroute Climb',
    phase: 'climb',
    items: [
      { challenge: '1. Airspeed', response: '70 - 85 KIAS', check: iasRange(70, 85) },
      { challenge: '2. Throttle Control', response: 'FULL (push full in)', check: throttleFull },
      { challenge: '3. Mixture Control', response: 'RICH (above 3000 feet pressure altitude, lean for maximum RPM)' },
    ],
  },
  {
    title: 'Cruise',
    phase: 'cruise',
    items: [
      { challenge: '1. Power', response: '2100 - 2700 RPM (no more than 75% power recommended)', check: rpm(2100, 2700) },
      { challenge: '2. Elevator Trim Control', response: 'ADJUST' },
      { challenge: '3. Mixture Control', response: 'LEAN (for desired performance or economy)' },
      { challenge: '4. FMS/GPS', response: 'REVIEW and BRIEF (OBS/SUSP softkey operation for holding pattern procedure (IFR))' },
    ],
  },
  {
    title: 'Descent',
    phase: 'descent',
    items: [
      { challenge: '1. Power', response: 'AS DESIRED' },
      { challenge: '2. Mixture', response: 'ADJUST (if necessary to make engine run smoothly)' },
      { challenge: '3. Altimeters: a. PFD (BARO)', response: 'SET', check: baroSet(1) },
      { challenge: '   b. Standby Altimeter', response: 'SET', check: baroSet(2) },
      { challenge: '4. ALT SEL', response: 'SET' },
      { challenge: '5. CDI Softkey', response: 'SELECT NAV SOURCE' },
      { challenge: '6. FMS/GPS', response: 'REVIEW and BRIEF (OBS/SUSP softkey operation for holding pattern procedure (IFR))' },
      { challenge: '7. FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '8. Wing Flaps', response: 'AS DESIRED (UP - 10° below 110 KIAS) (10° - FULL below 85 KIAS)' },
    ],
  },
  {
    title: 'Before Landing',
    phase: 'approach',
    items: [
      { challenge: '1. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
      { challenge: '2. Seats and Seat Belts', response: 'SECURED and LOCKED' },
      { challenge: '3. FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '4. Mixture Control', response: 'RICH', check: (v) => v.get(C172.mixture) > 0.8 },
      { challenge: '5. LAND and TAXI Light Switches', response: 'ON', check: (v) => v.get(C172.land) > 0.5 && v.get(C172.taxi) > 0.5 },
      { challenge: '6. Autopilot', response: 'OFF (if installed)', check: off('ap.engaged') },
      { challenge: '7. CABIN PWR 12V Switch', response: 'OFF', check: off(C172.cabinPwr12v) },
    ],
  },
  {
    title: 'Normal Landing',
    phase: 'landing',
    items: [
      { challenge: '1. Airspeed', response: '65 - 75 KIAS (Flaps UP)' },
      { challenge: '2. Wing Flaps', response: 'AS DESIRED (UP - 10° below 110 KIAS) (10° - FULL below 85 KIAS)' },
      { challenge: '3. Airspeed', response: '60 - 70 KIAS (Flaps FULL)' },
      { challenge: '4. Elevator Trim Control', response: 'ADJUST' },
      { challenge: '5. Touchdown', response: 'MAIN WHEELS FIRST' },
      { challenge: '6. Landing Roll', response: 'LOWER NOSEWHEEL GENTLY' },
      { challenge: '7. Braking', response: 'MINIMUM REQUIRED' },
    ],
  },
  {
    title: 'Short Field Landing',
    phase: 'landing',
    items: [
      { challenge: '1. Airspeed', response: '65 - 75 KIAS (Flaps UP)' },
      { challenge: '2. Wing Flaps', response: 'FULL', check: flaps(30, 30) },
      { challenge: '3. Airspeed', response: '61 KIAS (until flare)' },
      { challenge: '4. Elevator Trim Control', response: 'ADJUST' },
      { challenge: '5. Power', response: 'REDUCE TO IDLE (as obstacle is cleared)' },
      { challenge: '6. Touchdown', response: 'MAIN WHEELS FIRST' },
      { challenge: '7. Brakes', response: 'APPLY HEAVILY' },
      { challenge: '8. Wing Flaps', response: 'UP', check: flaps(0, 0) },
    ],
  },
  {
    title: 'Balked Landing',
    phase: 'landing',
    items: [
      { challenge: '1. Throttle Control', response: 'FULL (push full in)', check: throttleFull },
      { challenge: '2. Wing Flaps', response: 'RETRACT to 20°', check: flaps(0, 20) },
      { challenge: '3. Climb Speed', response: '60 KIAS' },
      { challenge: '4. Wing Flaps', response: '10° (as obstacle is cleared), then UP (after reaching a safe altitude and 65 KIAS)' },
    ],
  },
  {
    title: 'After Landing',
    phase: 'after landing',
    items: [
      { challenge: '1. Wing Flaps', response: 'UP', check: flaps(0, 0) },
      { challenge: '2. STROBE Light Switch', response: 'OFF', check: off(C172.strobe) },
    ],
  },
  {
    title: 'Securing Airplane',
    phase: 'shutdown',
    items: [
      { challenge: '1. Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
      { challenge: '2. Throttle Control', response: 'IDLE (pull full out)', check: throttleIdle },
      { challenge: '3. Electrical Equipment', response: 'OFF', check: elecEquipOff },
      { challenge: `4. ${AVIONICS}`, response: 'OFF', check: avionicsOff },
      { challenge: '5. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '6. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: `7. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: `8. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: '9. Control Lock', response: 'INSTALL', check: on(C172.controlLock) },
      { challenge: '10. FUEL SELECTOR Valve', response: 'LEFT or RIGHT (to prevent crossfeeding between tanks)', check: (v) => Math.round(v.get(C172.fuelSelector)) !== FUEL_SEL.both },
    ],
  },

  // ======================================================================= EMERGENCY (POH Section 3)
  {
    title: 'EMERGENCY — Engine Failure During Takeoff Roll',
    phase: 'emergency',
    items: [
      { challenge: '1. Throttle Control', response: 'IDLE (pull full out)', check: throttleIdle },
      { challenge: '2. Brakes', response: 'APPLY' },
      { challenge: '3. Wing Flaps', response: 'RETRACT', check: flaps(0, 0) },
      { challenge: '4. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '5. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: `6. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `7. ${MASTER}`, response: 'OFF', check: masterOff },
    ],
  },
  {
    title: 'EMERGENCY — Engine Failure Immediately After Takeoff',
    phase: 'emergency',
    items: [
      { challenge: '1. Airspeed', response: '70 KIAS - Flaps UP; 65 KIAS - Flaps 10° - FULL', check: glideByFlaps },
      { challenge: '2. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '3. FUEL SHUTOFF Valve', response: 'OFF (pull full out)', check: off(C172.fuelShutoff) },
      { challenge: '4. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: '5. Wing Flaps', response: 'AS REQUIRED (FULL recommended)' },
      { challenge: `6. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `7. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '8. Cabin Door', response: 'UNLATCH', check: doorsUnlatched },
      { challenge: '9. Land', response: 'STRAIGHT AHEAD' },
    ],
  },
  {
    title: 'EMERGENCY — Engine Failure During Flight (Restart Procedures)',
    phase: 'emergency',
    items: [
      { challenge: '1. Airspeed', response: '68 KIAS (best glide speed)', check: ias(68) },
      { challenge: '2. FUEL SHUTOFF Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
      { challenge: '3. FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
      { challenge: '4. FUEL PUMP Switch', response: 'ON', check: on(C172.fuelPump) },
      { challenge: '5. Mixture Control', response: 'RICH (if restart has not occurred)' },
      { challenge: '6. MAGNETOS Switch', response: 'BOTH (or START if propeller is stopped)', check: eq(C172.magneto, MAG.both) },
      { challenge: '7. FUEL PUMP Switch', response: 'OFF (NOTE: if FFLOW GPH immediately drops to zero, a sign of engine-driven fuel pump failure, return it to ON)' },
    ],
  },
  {
    title: 'EMERGENCY — Emergency Landing Without Engine Power',
    phase: 'emergency',
    items: [
      { challenge: '1. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
      { challenge: '2. Seats and Seat Belts', response: 'SECURE' },
      { challenge: '3. Airspeed', response: '70 KIAS - Flaps UP; 65 KIAS - Flaps 10° - FULL', check: glideByFlaps },
      { challenge: '4. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '5. FUEL SHUTOFF Valve', response: 'OFF (pull full out)', check: off(C172.fuelShutoff) },
      { challenge: '6. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: '7. Wing Flaps', response: 'AS REQUIRED (FULL recommended)' },
      { challenge: `8. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `9. ${MASTER}`, response: 'OFF (when landing is assured)', check: masterOff },
      { challenge: '10. Doors', response: 'UNLATCH PRIOR TO TOUCHDOWN', check: doorsUnlatched },
      { challenge: '11. Touchdown', response: 'SLIGHTLY TAIL LOW' },
      { challenge: '12. Brakes', response: 'APPLY HEAVILY' },
    ],
  },
  {
    title: 'EMERGENCY — Precautionary Landing With Engine Power',
    phase: 'emergency',
    items: [
      { challenge: '1. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
      { challenge: '2. Seats and Seat Belts', response: 'SECURE' },
      { challenge: '3. Airspeed', response: '65 KIAS', check: ias(65) },
      { challenge: '4. Wing Flaps', response: '20°', check: flaps(20, 20) },
      { challenge: '5. Selected Field', response: 'FLY OVER (noting terrain and obstructions)' },
      { challenge: '6. Wing Flaps', response: 'FULL (on final approach)', check: flaps(30, 30) },
      { challenge: '7. Airspeed', response: '65 KIAS', check: ias(65) },
      { challenge: `8. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `9. ${MASTER}`, response: 'OFF (when landing assured)', check: masterOff },
      { challenge: '10. Doors', response: 'UNLATCH PRIOR TO TOUCHDOWN', check: doorsUnlatched },
      { challenge: '11. Touchdown', response: 'SLIGHTLY TAIL LOW' },
      { challenge: '12. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '13. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: '14. Brakes', response: 'APPLY HEAVILY' },
    ],
  },
  {
    title: 'EMERGENCY — Ditching',
    phase: 'emergency',
    items: [
      { challenge: '1. Radio', response: 'TRANSMIT MAYDAY on 121.5 MHz, (give location, intentions and SQUAWK 7700)', check: (v) => Math.abs(v.get(NAV.comActive(1)) - 121.5) < 0.003 && Math.round(v.get(NAV.xpdrCode)) === 7700 },
      { challenge: '2. Heavy Objects (in baggage area)', response: 'SECURE OR JETTISON (if possible)' },
      { challenge: '3. Pilot and Passenger Seat Backs', response: 'MOST UPRIGHT POSITION' },
      { challenge: '4. Seats and Seat Belts', response: 'SECURE' },
      { challenge: '5. Wing Flaps', response: '20° - FULL', check: flaps(20, 30) },
      { challenge: '6. Power', response: 'ESTABLISH 300 FT/MIN DESCENT AT 55 KIAS (no power: 70 KIAS Flaps UP or 65 KIAS Flaps 10°)', check: ias(55) },
      { challenge: '7. Approach', response: 'High Winds, Heavy Seas - INTO THE WIND; Light Winds, Heavy Swells - PARALLEL TO SWELLS' },
      { challenge: '8. Cabin Doors', response: 'UNLATCH', check: doorsUnlatched },
      { challenge: '9. Touchdown', response: 'LEVEL ATTITUDE AT ESTABLISHED RATE OF DESCENT' },
      { challenge: '10. Face', response: 'CUSHION AT TOUCHDOWN (with folded coat)' },
      { challenge: '11. ELT', response: 'ACTIVATE', check: eq(C172G.eltRocker, ELT_ROCKER.on) },
      { challenge: '12. Airplane', response: 'EVACUATE THROUGH CABIN DOORS (if necessary, open window and flood cabin to equalize pressure so doors can be opened)' },
      { challenge: '13. Life Vests and Raft', response: 'INFLATE WHEN CLEAR OF AIRPLANE' },
    ],
  },
  {
    title: 'EMERGENCY — Fire During Start on Ground',
    phase: 'emergency',
    items: [
      { challenge: '1. MAGNETOS Switch', response: 'START (continue cranking to start the engine)' },
      header('IF ENGINE STARTS'),
      { challenge: '2. Power', response: '1800 RPM (for a few minutes)' },
      { challenge: '3. Engine', response: 'SHUTDOWN (inspect for damage)' },
      header('IF ENGINE FAILS TO START'),
      { challenge: '2. Throttle Control', response: 'FULL (push full in)', check: throttleFull },
      { challenge: '3. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '4. MAGNETOS Switch', response: 'START (continue cranking)' },
      { challenge: '5. FUEL SHUTOFF Valve', response: 'OFF (pull full out)', check: off(C172.fuelShutoff) },
      { challenge: '6. FUEL PUMP Switch', response: 'OFF', check: off(C172.fuelPump) },
      { challenge: '7. MAGNETOS Switch', response: 'OFF', check: eq(C172.magneto, MAG.off) },
      { challenge: `8. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `9. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '10. Engine', response: 'SECURE' },
      { challenge: '11. Parking Brake', response: 'RELEASE', check: off(C172.parkingBrake) },
      { challenge: '12. Fire Extinguisher', response: 'OBTAIN (have ground attendants obtain if not installed)' },
      { challenge: '13. Airplane', response: 'EVACUATE' },
      { challenge: '14. Fire', response: 'EXTINGUISH (using fire extinguisher, wool blanket, or dirt)', check: (v) => v.get(C172.fireEngine) <= 0 },
      { challenge: '15. Fire Damage', response: 'INSPECT (repair or replace damaged components and/or wiring before conducting another flight)' },
    ],
  },
  {
    title: 'EMERGENCY — Engine Fire in Flight',
    phase: 'emergency',
    items: [
      { challenge: '1. Mixture Control', response: 'IDLE CUTOFF (pull full out)', check: mixtureCutoff },
      { challenge: '2. FUEL SHUTOFF Valve', response: 'OFF (pull full out)', check: off(C172.fuelShutoff) },
      { challenge: '3. FUEL PUMP Switch', response: 'OFF', check: off(C172.fuelPump) },
      { challenge: `4. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '5. Cabin Vents', response: 'OPEN (as needed)' },
      { challenge: '6. CABIN HT and CABIN AIR Control Knobs', response: 'OFF (push full in) (to avoid drafts)', check: heatAirOff },
      { challenge: '7. Airspeed', response: '100 KIAS (If fire is not extinguished, increase glide speed to find an airspeed, within airspeed limitations, which will provide an incombustible mixture)', check: (v) => v.get('adc1.valid') > 0.5 && v.get(ADC.ias(1)) >= 95 },
      { challenge: '8. Forced Landing', response: 'EXECUTE (refer to EMERGENCY LANDING WITHOUT ENGINE POWER)' },
    ],
  },
  {
    title: 'EMERGENCY — Electrical Fire in Flight',
    phase: 'emergency',
    items: [
      { challenge: `1. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `2. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '3. Cabin Vents', response: 'CLOSED (to avoid drafts)', check: ventsClosed },
      { challenge: '4. CABIN HT and CABIN AIR Control Knobs', response: 'OFF (push full in) (to avoid drafts)', check: heatAirOff },
      { challenge: '5. Fire Extinguisher', response: 'ACTIVATE (if available)', check: on(C172.extinguisher) },
      { challenge: `6. ${AVIONICS}`, response: 'OFF', check: avionicsOff },
      { challenge: '7. All Other Switches (except MAGNETOS switch)', response: 'OFF', check: elecEquipOff },
      header('WARNING: make sure the fire is extinguished before exterior air is used to remove smoke from the cabin'),
      { challenge: '8. Cabin Vents', response: 'OPEN (when sure that fire is completely extinguished)', check: (v) => v.get(C172.fireElectrical) <= 0 && ventsOpen(v) },
      { challenge: '9. CABIN HT and CABIN AIR Control Knobs', response: 'ON (pull full out) (when sure that fire is completely extinguished)', check: (v) => v.get(C172.fireElectrical) <= 0 && heatAirOn(v) },
      header('IF FIRE HAS BEEN EXTINGUISHED AND ELECTRICAL POWER IS NECESSARY FOR CONTINUED FLIGHT TO NEAREST SUITABLE AIRPORT OR LANDING AREA'),
      { challenge: '10. Circuit Breakers', response: 'CHECK (for OPEN circuit(s), do not reset)' },
      { challenge: `11. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: `12. ${STBY}`, response: 'ARM', check: eq(C172.stbyBatt, STBY_BATT.arm) },
      { challenge: '13. AVIONICS Switch (BUS 1)', response: 'ON', check: on(C172.avionicsBus1) },
      { challenge: '14. AVIONICS Switch (BUS 2)', response: 'ON', check: on(C172.avionicsBus2) },
    ],
  },
  {
    title: 'EMERGENCY — Cabin Fire',
    phase: 'emergency',
    items: [
      { challenge: `1. ${STBY}`, response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) },
      { challenge: `2. ${MASTER}`, response: 'OFF', check: masterOff },
      { challenge: '3. Cabin Vents', response: 'CLOSED (to avoid drafts)', check: ventsClosed },
      { challenge: '4. CABIN HT and CABIN AIR Control Knobs', response: 'OFF (push full in) (to avoid drafts)', check: heatAirOff },
      { challenge: '5. Fire Extinguisher', response: 'ACTIVATE (if available)', check: on(C172.extinguisher) },
      header('WARNING: make sure the fire is extinguished before exterior air is used to remove smoke from the cabin'),
      { challenge: '6. Cabin Vents', response: 'OPEN (when sure that fire is completely extinguished)', check: (v) => v.get(C172.fireCabin) <= 0 && ventsOpen(v) },
      { challenge: '7. CABIN HT and CABIN AIR Control Knobs', response: 'ON (pull full out) (when sure that fire is completely extinguished)', check: (v) => v.get(C172.fireCabin) <= 0 && heatAirOn(v) },
      { challenge: '8. Land the airplane', response: 'as soon as possible to inspect for damage' },
    ],
  },
  {
    title: 'EMERGENCY — Wing Fire',
    phase: 'emergency',
    items: [
      { challenge: '1. LAND and TAXI Light Switches', response: 'OFF', check: (v) => v.get(C172.land) < 0.5 && v.get(C172.taxi) < 0.5 },
      { challenge: '2. NAV Light Switch', response: 'OFF', check: off(C172.nav) },
      { challenge: '3. STROBE Light Switch', response: 'OFF', check: off(C172.strobe) },
      { challenge: '4. PITOT HEAT Switch', response: 'OFF', check: off(C172.pitotHeat) },
      { challenge: 'NOTE: Sideslip', response: 'keep the flames away from the fuel tank and cabin; land as soon as possible (flaps only as required for final approach and touchdown)', check: (v) => v.get(C172.fireWing) <= 0 },
    ],
  },
  {
    title: 'EMERGENCY — Inadvertent Icing Encounter During Flight',
    phase: 'emergency',
    items: [
      { challenge: '1. PITOT HEAT Switch', response: 'ON', check: on(C172.pitotHeat) },
      { challenge: '2. Turn back or change altitude', response: '(to obtain an outside air temperature that is less conducive to icing)' },
      { challenge: '3. CABIN HT Control Knob', response: 'ON (pull full out)', check: (v) => v.get(C172.cabinHeat) > 0.9 },
      { challenge: '4. Defroster Control Outlets', response: 'OPEN (to obtain maximum windshield defroster airflow)', check: (v) => v.get(C172.defrostLeft) > 0.9 && v.get(C172.defrostRight) > 0.9 },
      { challenge: '5. CABIN AIR Control Knob', response: 'ADJUST (to obtain maximum defroster heat and airflow)' },
      { challenge: '6. Watch for signs of induction air filter icing', response: 'Adjust the throttle as necessary to hold engine RPM; adjust mixture as necessary for any change in power settings' },
      { challenge: '7. Plan a landing at the nearest airport', response: 'With an extremely rapid ice build-up, select a suitable off airport landing site' },
      { challenge: '8. With 0.25 inch or more of ice on the wing leading edges', response: 'be prepared for significantly higher power requirements, higher approach and stall speeds, and a longer landing roll' },
      { challenge: '9. Leave wing flaps retracted', response: '(flap extension with severe tail ice could cause a loss of elevator effectiveness)', check: flaps(0, 0) },
      { challenge: '10. Open left window', response: 'and, if practical, scrape ice from a portion of the windshield for visibility in the landing approach', check: (v) => v.get(C172.windowLeft) > 0.5 },
      { challenge: '11. Perform a landing approach using a forward slip', response: 'if necessary, for improved visibility' },
      { challenge: '12. Approach', response: 'at 65 to 75 KIAS depending upon the amount of ice accumulation', check: iasRange(65, 75) },
      { challenge: '13. Perform landing', response: 'in level attitude' },
      { challenge: '14. Missed approaches', response: 'should be avoided whenever possible because of severely reduced climb capability' },
    ],
  },
  {
    title: 'EMERGENCY — Static Source Blockage (Erroneous Instrument Reading Suspected)',
    phase: 'emergency',
    items: [
      { challenge: '1. ALT STATIC AIR Valve', response: 'ON (pull full out)', check: on(C172.altStatic) },
      { challenge: '2. Cabin Vents', response: 'CLOSED', check: ventsClosed },
      { challenge: '3. CABIN HT and CABIN AIR Control Knobs', response: 'ON (pull full out)', check: heatAirOn },
      { challenge: '4. Airspeed', response: 'Refer to Section 5, Figure 5-1 (Sheet 2) Airspeed Calibration, Alternate Static Source correction chart' },
    ],
  },
  {
    title: 'EMERGENCY — Excessive Fuel Vapor (Fuel Flow Stabilization)',
    phase: 'emergency',
    items: [
      header('(If flow fluctuations of 1 GPH or more, or power surges occur)'),
      { challenge: '1. FUEL PUMP Switch', response: 'ON', check: on(C172.fuelPump) },
      { challenge: '2. Mixture Control', response: 'ADJUST (as necessary for smooth engine operation)' },
      { challenge: '3. Fuel Selector Valve', response: 'SELECT OPPOSITE TANK (if vapor symptoms continue)' },
      { challenge: '4. FUEL PUMP Switch', response: 'OFF (after fuel flow has stabilized)' },
    ],
  },
  {
    title: 'ABNORMAL LANDING — Landing With a Flat Main Tire',
    phase: 'emergency',
    items: [
      { challenge: '1. Approach', response: 'NORMAL' },
      { challenge: '2. Wing Flaps', response: 'FULL', check: flaps(30, 30) },
      { challenge: '3. Touchdown', response: 'GOOD MAIN TIRE FIRST (hold airplane off flat tire as long as possible with aileron control)' },
      { challenge: '4. Directional Control', response: 'MAINTAIN (using brake on good wheel as required)' },
    ],
  },
  {
    title: 'ABNORMAL LANDING — Landing With a Flat Nose Tire',
    phase: 'emergency',
    items: [
      { challenge: '1. Approach', response: 'NORMAL' },
      { challenge: '2. Wing Flaps', response: 'AS REQUIRED (85 to 110 KIAS - Flaps UP - 10°; below 85 KIAS - Flaps 10° - FULL)' },
      { challenge: '3. Touchdown', response: 'ON MAINS (hold nosewheel off the ground as long as possible)' },
      { challenge: '4. When nosewheel touches down', response: 'maintain full up elevator as airplane slows to stop' },
    ],
  },
  {
    title: 'EMERGENCY — HIGH VOLTS Annunciator Comes On or M BATT AMPS More Than 40',
    phase: 'emergency',
    items: [
      { challenge: '1. MASTER Switch (ALT Only)', response: 'OFF', check: off(C172.masterAlt) },
      ...LOAD_SHED.map((it, i) => (i === 0 ? { ...it, challenge: '2. Electrical Load' } : it)),
      header('NOTE: below 20 M BUS VOLTS the standby battery supplies the essential bus for at least 30 minutes'),
      { challenge: '3. Land', response: 'as soon as practical (the flap motor is a large electrical load: make sure a landing is possible before extending flaps)' },
    ],
  },
  {
    title: 'EMERGENCY — LOW VOLTS Annunciator Comes On Below 1000 RPM',
    phase: 'emergency',
    items: [
      { challenge: '1. Throttle Control', response: '1000 RPM', check: rpm(950, 1050) },
      { challenge: '2. LOW VOLTS Annunciator', response: 'CHECK OFF', check: off(ANN.lowVolts) },
      header('LOW VOLTS ANNUNCIATOR REMAINS ON AT 1000 RPM'),
      { challenge: '3. Authorized maintenance personnel', response: 'must do electrical system inspection prior to next flight' },
    ],
  },
  {
    title: 'EMERGENCY — LOW VOLTS Annunciator Comes On or Does Not Go Off at Higher RPM',
    phase: 'emergency',
    items: [
      { challenge: '1. MASTER Switch (ALT Only)', response: 'OFF', check: off(C172.masterAlt) },
      { challenge: '2. ALT FIELD Circuit Breaker', response: 'CHECK IN', check: (v) => v.get('cb.alt_field', 1) > 0.5 },
      { challenge: `3. ${MASTER}`, response: 'ON', check: masterOn },
      { challenge: '4. LOW VOLTS Annunciator', response: 'CHECK OFF', check: off(ANN.lowVolts) },
      { challenge: '5. M BUS VOLTS', response: 'CHECK 27.5 V (minimum)', check: (v) => v.get(C172.mBusV) >= 27.5 },
      { challenge: '6. M BATT AMPS', response: 'CHECK CHARGING (+)', check: (v) => v.get(C172.mBattA) > 0 },
      header('IF LOW VOLTS ANNUNCIATOR REMAINS ON'),
      { challenge: '7. MASTER Switch (ALT Only)', response: 'OFF', check: off(C172.masterAlt) },
      ...LOAD_SHED.map((it, i) => (i === 0 ? { ...it, challenge: '8. Electrical Load' } : it)),
      header('NOTE: below 20 M BUS VOLTS the standby battery supplies the essential bus for at least 30 minutes'),
      { challenge: '9. Land', response: 'as soon as practical (the flap motor is a large electrical load: make sure a landing is possible before extending flaps)' },
    ],
  },
  {
    title: 'EMERGENCY — Red X: PFD Airspeed Indicator',
    phase: 'emergency',
    items: [
      { challenge: '1. ADC/AHRS Circuit Breakers (ESS BUS and AVN BUS 1)', response: 'CHECK IN (if open, reset (close) circuit breaker; if it opens again, do not reset)', check: adcAhrsCbIn },
      { challenge: '2. Standby Airspeed Indicator', response: 'USE FOR AIRSPEED INFORMATION' },
    ],
  },
  {
    title: 'EMERGENCY — Red X: PFD Altitude Indicator',
    phase: 'emergency',
    items: [
      { challenge: '1. ADC/AHRS Circuit Breakers (ESS BUS and AVN BUS 1)', response: 'CHECK IN (if open, reset (close) circuit breaker; if it opens again, do not reset)', check: adcAhrsCbIn },
      { challenge: '2. Standby Altimeter', response: 'CHECK current barometric pressure SET. USE FOR ALTITUDE INFORMATION.', check: baroSet(2) },
    ],
  },
  {
    title: 'EMERGENCY — Red X: PFD Attitude Indicator (AHRS Failure)',
    phase: 'emergency',
    items: [
      { challenge: '1. ADC/AHRS Circuit Breakers (ESS BUS and AVN BUS 1)', response: 'CHECK IN (if open, reset (close) circuit breaker; if it opens again, do not reset)', check: adcAhrsCbIn },
      { challenge: '2. Standby Attitude Indicator', response: 'USE FOR ATTITUDE INFORMATION' },
    ],
  },
  {
    title: 'EMERGENCY — Red X: Horizontal Situation Indicator (HSI)',
    phase: 'emergency',
    items: [
      { challenge: '1. ADC/AHRS Circuit Breakers (ESS BUS and AVN BUS 1)', response: 'CHECK IN (if open, reset (close) circuit breaker; if it opens again, do not reset)', check: adcAhrsCbIn },
      { challenge: '2. Non-Stabilized Magnetic Compass', response: 'USE FOR HEADING INFORMATION' },
    ],
  },
  {
    title: 'EMERGENCY — Autopilot or Electric Trim Failure (AP or PTRM Annunciator(s) Come On)',
    phase: 'emergency',
    items: [
      { challenge: '1. Control Wheel', response: 'GRASP FIRMLY (regain control of airplane)' },
      { challenge: '2. A/P TRIM DISC Button', response: 'PRESS and HOLD (throughout recovery)' },
      { challenge: '3. Elevator Trim Control', response: 'ADJUST MANUALLY (as necessary)' },
      { challenge: '4. AUTO PILOT Circuit Breaker', response: 'OPEN (pull out)', check: (v) => v.get('cb.autopilot', 1) < 0.5 },
      { challenge: '5. A/P TRIM DISC Button', response: 'RELEASE', check: off('ac.c172g.ap_disc') },
      header('WARNING: do not engage the autopilot until the cause of the malfunction has been corrected'),
    ],
  },
  {
    // In 172SPHBUS-00 (3-23) only; Revision 2 removed this checklist. Kept because the G1000 still raises the
    // PFD1 / MFD1 COOLING system messages (C172G1000LateLogic).
    title: 'EMERGENCY — Display Cooling Advisory (PFD1 / MFD1 COOLING) [172SPHBUS-00; not in Rev 2]',
    phase: 'emergency',
    items: [
      { challenge: 'CABIN HT Control Knob', response: 'REDUCE (push in) (minimum preferred)' },
      { challenge: 'Forward Avionics Fan', response: 'CHECK (feel for airflow from screen on glareshield)', check: on('ac.c172g.fwd_fan') },
      { challenge: 'If forward fan failed: STBY BATT Switch', response: 'OFF (unless needed for emergency power)' },
      { challenge: 'If advisory not off within 3 min or both come on: STBY BATT Switch', response: 'OFF (land as soon as practical)' },
    ],
  },
  {
    title: 'EMERGENCY — Vacuum System Failure (LOW VACUUM Annunciator Comes On)',
    phase: 'emergency',
    items: [
      { challenge: '1. Vacuum Indicator (VAC)', response: 'CHECK EIS ENGINE PAGE (make sure vacuum pointer is in green band limits)', check: (v) => v.get('ac.vac.suction_inhg') >= 4.5 },
      header('CAUTION: if VAC is out of the green band or the GYRO flag is shown, do not use the standby attitude indicator'),
    ],
  },
  {
    title: 'EMERGENCY — High Carbon Monoxide (CO) Level Advisory (CO LVL HIGH)',
    phase: 'emergency',
    items: [
      { challenge: '1. CABIN HT Control Knob', response: 'OFF (push full in)', check: (v) => v.get(C172.cabinHeat) < 0.05 },
      { challenge: '2. CABIN AIR Control Knob', response: 'ON (pull full out)', check: (v) => v.get(C172.cabinAir) > 0.95 },
      { challenge: '3. Cabin Vents', response: 'OPEN', check: (v) => v.get(C172.ventLeft) > 0.5 && v.get(C172.ventRight) > 0.5 },
      { challenge: '4. Cabin Windows', response: 'OPEN (163 KIAS maximum windows open speed)', check: (v) => v.get(C172.windowLeft) > 0.5 || v.get(C172.windowRight) > 0.5 },
      header('CO LVL HIGH ANNUNCIATOR REMAINS ON'),
      { challenge: '5. Land', response: 'as soon as practical' },
    ],
  },
];
