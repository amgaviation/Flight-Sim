/**
 * Cessna 172S checklists from the POH (Section 4 normal procedures, Section 3 emergency
 * procedures). Steam: 172SPHUS Rev 5; G1000: 172SPHAUS-03 (NAV III), whose wording and the
 * standby-battery / G1000 items differ. Wording is the POH's (abbreviated where the POH item
 * is an explanation). Items with a `check` show a live tick in the checklist viewer.
 */
import type { Checklist } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, SURF } from '../../core/vars';
import { ANN, C172, FUEL_SEL, MAG, STBY_BATT } from './vars';
import type { C172Variant } from './systems/electrical';

type V = SimContext['vars'];
const on = (name: string) => (v: V) => v.get(name) > 0.5;
const off = (name: string) => (v: V) => v.get(name) < 0.5;
const eq = (name: string, x: number) => (v: V) => Math.round(v.get(name)) === x;
const flaps = (lo: number, hi: number) => (v: V) => v.get(SURF.flapsDeg) >= lo - 0.5 && v.get(SURF.flapsDeg) <= hi + 0.5;

export function c172Checklists(variant: C172Variant): Checklist[] {
  const g = variant === 'g1000';
  const avionicsOff = (v: V) => v.get(C172.avionicsBus1) < 0.5 && v.get(C172.avionicsBus2) < 0.5;
  const avionicsOn = (v: V) => v.get(C172.avionicsBus1) > 0.5 && v.get(C172.avionicsBus2) > 0.5;
  const masterOn = (v: V) => v.get(C172.masterBat) > 0.5 && v.get(C172.masterAlt) > 0.5;
  const masterOff = (v: V) => v.get(C172.masterBat) < 0.5 && v.get(C172.masterAlt) < 0.5;
  const avionicsSw = g ? 'AVIONICS Switch (BUS 1 and BUS 2)' : 'Avionics Master Switch';
  const master = g ? 'MASTER Switch (ALT and BAT)' : 'Master Switch';
  const mags = g ? 'MAGNETOS Switch' : 'Ignition Switch';

  const normal: Checklist[] = [
    {
      title: 'Preflight Inspection — Cabin',
      phase: 'preflight',
      items: [
        { challenge: 'Pitot Tube Cover', response: 'REMOVE (check for pitot blockage)' },
        { challenge: "Pilot's Operating Handbook", response: 'AVAILABLE' },
        { challenge: 'Airplane Weight and Balance', response: 'CHECKED' },
        { challenge: 'Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        { challenge: 'Control Wheel Lock', response: 'REMOVE', check: off(C172.controlLock) },
        { challenge: mags, response: 'OFF', check: eq(C172.magneto, MAG.off) },
        { challenge: avionicsSw, response: 'OFF', check: avionicsOff },
        { challenge: master, response: 'ON', check: masterOn },
        ...(g
          ? [
              { challenge: 'Primary Flight Display (PFD)', response: 'CHECK (verify PFD is ON)', check: (v: V) => v.get('elec.pfd_powered') > 0.5 },
              { challenge: 'FUEL QTY (L and R)', response: 'CHECK' },
              { challenge: 'LOW FUEL L and LOW FUEL R Annunciators', response: 'CHECK (not shown)', check: (v: V) => v.get(ANN.lowFuelL) < 0.5 && v.get(ANN.lowFuelR) < 0.5 },
              { challenge: 'OIL PRESSURE Annunciator', response: 'CHECK (shown)', check: on(ANN.oilPress) },
              { challenge: 'LOW VACUUM Annunciator', response: 'CHECK (shown)', check: on(ANN.lowVacuum) },
              { challenge: 'AVIONICS Switch (BUS 1)', response: 'ON — forward avionics fan heard, then OFF' },
              { challenge: 'AVIONICS Switch (BUS 2)', response: 'ON — aft avionics fan heard, then OFF' },
              { challenge: 'PITOT HEAT Switch', response: 'ON (pitot warm within 30 s), then OFF' },
              { challenge: 'LOW VOLTS Annunciator', response: 'CHECK (shown)', check: on(ANN.lowVolts) },
            ]
          : [
              { challenge: 'Fuel Quantity Indicators', response: 'CHECK QUANTITY; LOW FUEL annunciators extinguished', check: (v: V) => v.get(ANN.lowFuelL) < 0.5 && v.get(ANN.lowFuelR) < 0.5 },
              { challenge: 'Avionics Master Switch', response: 'ON — avionics cooling fan heard, then OFF' },
              { challenge: 'Static Pressure Alternate Source Valve', response: 'OFF', check: off(C172.altStatic) },
              { challenge: 'Annunciator Panel Switch', response: 'HOLD IN TST — all annunciators illuminate; RELEASE' },
              { challenge: 'Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
              { challenge: 'Fuel Shutoff Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
              { challenge: 'Flaps', response: 'EXTEND' },
              { challenge: 'Pitot Heat', response: 'ON (pitot warm within 30 s), then OFF' },
            ]),
        { challenge: master, response: 'OFF', check: masterOff },
        { challenge: 'Elevator Trim', response: 'SET FOR TAKEOFF' },
        ...(g
          ? [
              { challenge: 'FUEL SELECTOR Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
              { challenge: 'ALT STATIC AIR Valve', response: 'OFF', check: off(C172.altStatic) },
              { challenge: 'Fire Extinguisher', response: 'CHECK (gage in green arc)' },
            ]
          : [{ challenge: 'Baggage Door', response: 'CHECK, lock with key' }]),
      ],
    },
    {
      title: 'Preflight Inspection — Exterior',
      phase: 'preflight',
      items: [
        { challenge: 'Empennage: rudder gust lock, tail tie-down', response: 'REMOVE / DISCONNECT' },
        { challenge: 'Control surfaces and trim tab', response: 'CHECK freedom of movement and security' },
        { challenge: 'Right wing: aileron, flap, tie-down, main tire', response: 'CHECK / DISCONNECT' },
        { challenge: 'Fuel Tank Sump Quick Drain Valves (right)', response: 'DRAIN (check for water, sediment, grade)' },
        { challenge: 'Fuel Quantity (right)', response: 'CHECK VISUALLY; filler cap SECURE, vent clear' },
        { challenge: 'Nose: fuel strainer quick drain', response: 'DRAIN' },
        { challenge: 'Engine oil dipstick', response: 'CHECK (not less than 5 qt; 8 qt for extended flight)' },
        { challenge: 'Cooling air inlets, propeller and spinner, air filter', response: 'CHECK' },
        { challenge: 'Nose wheel strut and tire; static source opening', response: 'CHECK' },
        { challenge: 'Left wing: fuel quantity, cap, sump drains, main tire', response: 'CHECK / DRAIN' },
        { challenge: 'Left wing leading edge: fuel vent, stall warning opening', response: 'CHECK (horn sounds with suction)' },
        { challenge: 'Landing/taxi lights; left aileron and flap', response: 'CHECK' },
      ],
    },
    {
      title: 'Before Starting Engine',
      phase: 'before start',
      items: [
        { challenge: 'Preflight Inspection', response: 'COMPLETE' },
        { challenge: 'Passenger Briefing', response: 'COMPLETE' },
        { challenge: 'Seats and Seat Belts', response: 'ADJUST and LOCK' },
        { challenge: 'Brakes', response: 'TEST and SET', check: on(C172.parkingBrake) },
        { challenge: 'Circuit Breakers', response: 'CHECK IN' },
        { challenge: 'Electrical Equipment', response: 'OFF' },
        { challenge: avionicsSw, response: 'OFF', check: avionicsOff },
        { challenge: 'Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: 'Fuel Shutoff Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
      ],
    },
    {
      title: 'Starting Engine (With Battery)',
      phase: 'start',
      items: [
        { challenge: 'Throttle', response: 'OPEN 1/4 INCH', check: (v: V) => v.get(C172.throttle) > 0.02 && v.get(C172.throttle) < 0.2 },
        { challenge: 'Mixture', response: 'IDLE CUTOFF', check: (v: V) => v.get(C172.mixture) < 0.05 },
        ...(g
          ? [
              { challenge: 'STBY BATT Switch', response: 'TEST (hold 20 s, green TEST lamp stays on), then ARM', check: eq(C172.stbyBatt, STBY_BATT.arm) },
              { challenge: 'Engine Indicating System', response: "CHECK PARAMETERS (no red X's)" },
              { challenge: 'BUS E Volts', response: 'CHECK (24 V minimum)', check: (v: V) => v.get(C172.eBusV) >= 24 },
              { challenge: 'M BUS Volts', response: 'CHECK (1.5 V or less)', check: (v: V) => v.get(C172.mBusV) <= 1.5 },
              { challenge: 'BATT S Amps', response: 'CHECK (discharge shown)', check: (v: V) => v.get(C172.sBattA) < 0 },
              { challenge: 'STBY BATT Annunciator', response: 'CHECK (shown)', check: on(ANN.stbyBatt) },
            ]
          : []),
        { challenge: 'Propeller Area', response: 'CLEAR' },
        { challenge: master, response: 'ON', check: masterOn },
        { challenge: g ? 'BEACON Light Switch' : 'Flashing Beacon', response: 'ON', check: on(C172.beacon) },
        { challenge: g ? 'FUEL PUMP Switch' : 'Auxiliary Fuel Pump Switch', response: 'ON (if engine cold)' },
        { challenge: 'Mixture', response: 'FULL RICH until stable fuel flow (3-5 s), then IDLE CUTOFF' },
        { challenge: g ? 'FUEL PUMP Switch' : 'Auxiliary Fuel Pump Switch', response: 'OFF', check: off(C172.fuelPump) },
        { challenge: mags, response: 'START (release when engine starts)' },
        { challenge: 'Mixture', response: 'ADVANCE smoothly to RICH when engine starts', check: (v: V) => v.get(C172.mixture) > 0.8 },
        { challenge: 'Oil Pressure', response: g ? 'CHECK (green arc within 30-60 s)' : 'CHECK', check: (v: V) => v.get(ENG.oilPressPsi(1)) >= 20 },
        ...(g
          ? [
              { challenge: 'AMPS (M BATT and BATT S)', response: 'CHECK charge (positive)', check: (v: V) => v.get(C172.mBattA) > 0 && v.get(C172.sBattA) >= 0 },
              { challenge: 'LOW VOLTS Annunciator', response: 'CHECK (not shown)', check: off(ANN.lowVolts) },
            ]
          : []),
        { challenge: 'Navigation Lights', response: 'ON as required' },
        { challenge: avionicsSw, response: 'ON', check: avionicsOn },
        ...(g ? [] : [{ challenge: 'Radios', response: 'ON' }, { challenge: 'Flaps', response: 'RETRACT', check: flaps(0, 0) }]),
      ],
    },
    {
      title: 'Before Takeoff',
      phase: 'before takeoff',
      items: [
        { challenge: 'Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        { challenge: 'Seat Backs; Seats and Seat Belts', response: 'UPRIGHT; CHECK SECURE' },
        { challenge: 'Cabin Doors', response: 'CLOSED and LOCKED', check: (v: V) => v.get(C172.doorLeft) >= 2 && v.get(C172.doorRight) >= 2 },
        { challenge: 'Flight Controls', response: 'FREE and CORRECT', check: off(C172.controlLock) },
        { challenge: g ? 'Flight Instruments (PFD)' : 'Flight Instruments', response: g ? "CHECK (no red X's)" : 'CHECK and SET' },
        ...(g ? [{ challenge: 'Altimeters (PFD, standby) and G1000 ALT SEL', response: 'SET' }, { challenge: 'Standby Flight Instruments', response: 'CHECK' }] : []),
        { challenge: 'Fuel Quantity', response: 'CHECK' },
        { challenge: 'Mixture', response: 'RICH', check: (v: V) => v.get(C172.mixture) > 0.8 || v.get(FDM.pressAlt) > 3000 },
        { challenge: 'Fuel Selector Valve', response: 'RECHECK BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        ...(g ? [{ challenge: 'Elevator Trim Control', response: 'SET FOR TAKEOFF' }, { challenge: 'Manual Electric Trim', response: 'CHECK' }] : []),
        { challenge: 'Throttle', response: '1800 RPM', check: (v: V) => Math.abs(v.get(ENG.rpm(1)) - 1800) < 60 },
        { challenge: '  Magnetos', response: 'CHECK (drop ≤ 150 RPM each, ≤ 50 RPM differential)' },
        { challenge: g ? '  VAC Indicator' : '  Vacuum Gage', response: 'CHECK', check: (v: V) => v.get('ac.vac.suction_inhg') >= 4.5 },
        { challenge: g ? '  Engine Indicators; Ammeters and Voltmeters' : '  Engine Instruments and Ammeter', response: 'CHECK' },
        { challenge: 'Annunciators', response: 'CHECK (none illuminated)' },
        { challenge: 'Throttle', response: 'CHECK IDLE, then 1000 RPM or LESS', check: (v: V) => v.get(ENG.rpm(1)) <= 1050 },
        { challenge: 'Throttle Friction Lock', response: 'ADJUST' },
        ...(g
          ? [
              { challenge: 'COM and NAV Frequencies; FMS/GPS Flight Plan', response: 'SET / AS DESIRED' },
              { challenge: 'XPDR', response: 'SET' },
              { challenge: 'CDI Softkey', response: 'SELECT NAV source' },
              { challenge: 'Autopilot', response: 'OFF', check: off('ap.engaged') },
              { challenge: 'CABIN PWR 12V Switch', response: 'OFF', check: off(C172.cabinPwr12v) },
              { challenge: 'Wing Flaps', response: 'UP - 10° (10° preferred)', check: flaps(0, 10) },
              { challenge: 'Cabin Windows', response: 'CLOSED and LOCKED', check: (v: V) => v.get(C172.windowLeft) < 0.05 && v.get(C172.windowRight) < 0.05 },
              { challenge: 'STROBE Lights Switch', response: 'ON', check: on(C172.strobe) },
            ]
          : [
              { challenge: 'Strobe Lights', response: 'AS DESIRED' },
              { challenge: 'Radios and Avionics', response: 'SET' },
              { challenge: 'NAV/GPS Switch', response: 'SET' },
              { challenge: 'Autopilot', response: 'OFF', check: off('ap.engaged') },
              { challenge: 'Manual Electric Trim', response: 'CHECK' },
              { challenge: 'Elevator Trim', response: 'SET for takeoff' },
              { challenge: 'Wing Flaps', response: 'SET for takeoff (0°-10°)', check: flaps(0, 10) },
            ]),
        { challenge: 'Brakes', response: 'RELEASE', check: off(C172.parkingBrake) },
      ],
    },
    {
      title: 'Normal Takeoff',
      phase: 'takeoff',
      items: [
        { challenge: 'Wing Flaps', response: g ? 'UP - 10° (10° preferred)' : '0°-10°', check: flaps(0, 10) },
        { challenge: 'Throttle', response: 'FULL OPEN', check: (v: V) => v.get(C172.throttle) > 0.97 },
        { challenge: 'Mixture', response: 'RICH (above 3000 ft, LEAN for maximum RPM)' },
        { challenge: 'Elevator Control', response: 'LIFT NOSE WHEEL at 55 KIAS' },
        { challenge: 'Climb Speed', response: '70-80 KIAS' },
        { challenge: 'Wing Flaps', response: 'RETRACT (at safe altitude)', check: flaps(0, 0) },
      ],
    },
    {
      title: 'Short Field Takeoff',
      phase: 'takeoff',
      items: [
        { challenge: 'Wing Flaps', response: '10°', check: flaps(10, 10) },
        { challenge: 'Brakes', response: 'APPLY' },
        { challenge: 'Throttle', response: 'FULL OPEN' },
        { challenge: 'Mixture', response: 'RICH (above 3000 ft, LEAN for maximum RPM)' },
        { challenge: 'Brakes', response: 'RELEASE' },
        { challenge: 'Elevator Control', response: 'SLIGHTLY TAIL LOW' },
        { challenge: 'Climb Speed', response: '56 KIAS (until all obstacles are cleared)' },
        { challenge: 'Wing Flaps', response: 'RETRACT slowly after reaching 60 KIAS' },
      ],
    },
    {
      title: 'Enroute Climb / Cruise',
      phase: 'climb',
      items: [
        { challenge: 'Airspeed', response: '70-85 KIAS' },
        { challenge: 'Throttle', response: 'FULL OPEN' },
        { challenge: 'Mixture', response: 'RICH (above 3000 ft, LEAN for maximum RPM)' },
        { challenge: 'Cruise Power', response: '2100-2700 RPM (no more than 75 % recommended)' },
        { challenge: 'Elevator Trim', response: 'ADJUST' },
        { challenge: 'Mixture', response: 'LEAN' },
      ],
    },
    {
      title: 'Descent / Before Landing',
      phase: 'approach',
      items: [
        { challenge: 'Power', response: 'AS DESIRED' },
        { challenge: 'Mixture', response: 'ADJUST for smooth operation (full rich for idle power)' },
        { challenge: g ? 'Altimeters (PFD, standby)' : 'Altimeter', response: 'SET' },
        { challenge: g ? 'CDI Softkey' : 'NAV/GPS Switch', response: 'SET' },
        { challenge: 'Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: 'Wing Flaps', response: 'AS DESIRED (0°-10° below 110 KIAS, 10°-30° below 85 KIAS)' },
        { challenge: 'Seat Backs; Seats and Belts', response: 'UPRIGHT; SECURED and LOCKED' },
        { challenge: 'Mixture', response: 'RICH', check: (v: V) => v.get(C172.mixture) > 0.8 },
        { challenge: 'Landing/Taxi Lights', response: 'ON', check: (v: V) => v.get(C172.land) > 0.5 },
        { challenge: 'Autopilot', response: 'OFF', check: off('ap.engaged') },
        ...(g ? [{ challenge: 'CABIN PWR 12V Switch', response: 'OFF', check: off(C172.cabinPwr12v) }] : []),
      ],
    },
    {
      title: 'Normal Landing',
      phase: 'landing',
      items: [
        { challenge: 'Airspeed', response: '65-75 KIAS (flaps UP)' },
        { challenge: 'Wing Flaps', response: 'AS DESIRED (0°-10° below 110 KIAS, 10°-30° below 85 KIAS)' },
        { challenge: 'Airspeed', response: '60-70 KIAS (flaps DOWN)' },
        { challenge: 'Touchdown', response: 'MAIN WHEELS FIRST' },
        { challenge: 'Landing Roll', response: 'LOWER NOSE WHEEL GENTLY' },
        { challenge: 'Braking', response: 'MINIMUM REQUIRED' },
      ],
    },
    {
      title: 'Balked Landing',
      phase: 'landing',
      items: [
        { challenge: 'Throttle', response: 'FULL OPEN' },
        { challenge: 'Wing Flaps', response: 'RETRACT TO 20°' },
        { challenge: 'Climb Speed', response: '60 KIAS' },
        { challenge: 'Wing Flaps', response: '10° (until obstacles are cleared); RETRACT after safe altitude and 65 KIAS' },
      ],
    },
    {
      title: 'After Landing / Securing Airplane',
      phase: 'shutdown',
      items: [
        { challenge: 'Wing Flaps', response: 'UP', check: flaps(0, 0) },
        { challenge: 'Parking Brake', response: 'SET', check: on(C172.parkingBrake) },
        ...(g ? [{ challenge: 'Throttle Control', response: 'IDLE (pull full out)' }] : []),
        { challenge: 'Electrical Equipment, Autopilot', response: 'OFF' },
        { challenge: avionicsSw, response: 'OFF', check: avionicsOff },
        { challenge: 'Mixture', response: 'IDLE CUTOFF (pulled full out)', check: (v: V) => v.get(C172.mixture) < 0.05 },
        { challenge: mags, response: 'OFF', check: eq(C172.magneto, MAG.off) },
        { challenge: master, response: 'OFF', check: masterOff },
        ...(g ? [{ challenge: 'STBY BATT Switch', response: 'OFF', check: eq(C172.stbyBatt, STBY_BATT.off) }] : []),
        { challenge: 'Control Lock', response: 'INSTALL', check: on(C172.controlLock) },
        { challenge: 'Fuel Selector Valve', response: 'LEFT or RIGHT (prevent crossfeeding)', check: (v: V) => Math.round(v.get(C172.fuelSelector)) !== FUEL_SEL.both },
      ],
    },
  ];

  const emergency: Checklist[] = [
    {
      title: 'EMERGENCY — Engine Failure During Takeoff Roll',
      phase: 'emergency',
      items: [
        { challenge: 'Throttle', response: 'IDLE' },
        { challenge: 'Brakes', response: 'APPLY' },
        { challenge: 'Wing Flaps', response: 'RETRACT' },
        { challenge: 'Mixture', response: 'IDLE CUT OFF' },
        { challenge: mags, response: 'OFF' },
        { challenge: master, response: 'OFF' },
      ],
    },
    {
      title: 'EMERGENCY — Engine Failure Immediately After Takeoff',
      phase: 'emergency',
      items: [
        { challenge: 'Airspeed', response: '70 KIAS (flaps UP) / 65 KIAS (flaps DOWN)' },
        { challenge: 'Mixture', response: 'IDLE CUT OFF' },
        { challenge: 'Fuel Shutoff Valve', response: 'OFF (pull full out)', check: off(C172.fuelShutoff) },
        { challenge: mags, response: 'OFF' },
        { challenge: 'Wing Flaps', response: 'AS REQUIRED' },
        { challenge: master, response: 'OFF' },
        { challenge: 'Cabin Door', response: 'UNLATCH' },
        { challenge: 'Land', response: 'STRAIGHT AHEAD' },
      ],
    },
    {
      title: 'EMERGENCY — Engine Failure During Flight (Restart)',
      phase: 'emergency',
      items: [
        { challenge: 'Airspeed', response: '68 KIAS (best glide)' },
        { challenge: 'Fuel Shutoff Valve', response: 'ON (push full in)', check: on(C172.fuelShutoff) },
        { challenge: 'Fuel Selector Valve', response: 'BOTH', check: eq(C172.fuelSelector, FUEL_SEL.both) },
        { challenge: g ? 'FUEL PUMP Switch' : 'Auxiliary Fuel Pump Switch', response: 'ON' },
        { challenge: 'Mixture', response: 'RICH (if restart has not occurred)' },
        { challenge: mags, response: 'BOTH (or START if propeller is stopped)' },
        { challenge: g ? 'FUEL PUMP Switch' : 'Auxiliary Fuel Pump Switch', response: 'OFF (ON again if fuel flow drops to zero: engine-driven pump failure)' },
      ],
    },
    {
      title: 'EMERGENCY — Emergency Landing Without Engine Power',
      phase: 'emergency',
      items: [
        { challenge: 'Passenger Seat Backs; Seats and Belts', response: 'MOST UPRIGHT; SECURE' },
        { challenge: 'Airspeed', response: '70 KIAS (flaps UP) / 65 KIAS (flaps DOWN)' },
        { challenge: 'Mixture', response: 'IDLE CUT OFF' },
        { challenge: 'Fuel Shutoff Valve', response: 'OFF (pull full out)' },
        { challenge: mags, response: 'OFF' },
        { challenge: 'Wing Flaps', response: 'AS REQUIRED (30° recommended)' },
        { challenge: master, response: 'OFF (when landing is assured)' },
        { challenge: 'Doors', response: 'UNLATCH PRIOR TO TOUCHDOWN' },
        { challenge: 'Touchdown', response: 'SLIGHTLY TAIL LOW' },
        { challenge: 'Brakes', response: 'APPLY HEAVILY' },
      ],
    },
    {
      title: 'EMERGENCY — Engine Fire In Flight',
      phase: 'emergency',
      items: [
        { challenge: 'Mixture', response: 'IDLE CUT OFF' },
        { challenge: 'Fuel Shutoff Valve', response: 'OFF (pull out)' },
        { challenge: g ? 'FUEL PUMP Switch' : 'Auxiliary Fuel Pump Switch', response: 'OFF' },
        { challenge: master, response: 'OFF' },
        { challenge: 'Cabin Heat and Air', response: 'OFF (except overhead vents)' },
        { challenge: 'Airspeed', response: '100 KIAS (increase to find an incombustible mixture)' },
        { challenge: 'Forced Landing', response: 'EXECUTE' },
      ],
    },
    {
      title: 'EMERGENCY — Electrical Fire In Flight',
      phase: 'emergency',
      items: [
        { challenge: master, response: 'OFF' },
        ...(g ? [{ challenge: 'STBY BATT Switch', response: 'OFF' }] : []),
        { challenge: 'Vents, Cabin Air, Heat', response: 'CLOSED' },
        { challenge: 'Fire Extinguisher', response: 'ACTIVATE' },
        { challenge: avionicsSw, response: 'OFF' },
        { challenge: 'All Other Switches (except ignition)', response: 'OFF' },
        { challenge: 'Vents/Cabin Air/Heat', response: 'OPEN when fire is extinguished' },
        { challenge: 'If power is needed: Master ON, breakers CHECK (do not reset), radios ON one at a time', response: 'AS REQUIRED' },
      ],
    },
    {
      title: 'EMERGENCY — Inadvertent Icing Encounter',
      phase: 'emergency',
      items: [
        { challenge: 'Pitot Heat', response: 'ON', check: on(C172.pitotHeat) },
        { challenge: 'Course / Altitude', response: 'TURN BACK or CHANGE ALTITUDE' },
        // POH Sec 3 Inadvertent Icing step 3: cabin heat full out, both defroster outlets open.
        { challenge: 'Cabin Heat', response: 'FULL OUT; defroster outlets OPEN', check: (v: V) => v.get(C172.cabinHeat) > 0.9 && v.get(C172.defrostLeft) > 0.9 && v.get(C172.defrostRight) > 0.9 },
        { challenge: 'Cabin Air', response: 'ADJUST for maximum defroster heat and airflow' },
        { challenge: 'Throttle / Mixture', response: 'ADJUST for maximum RPM (ice in the air intake)' },
        { challenge: 'Wing Flaps', response: 'LEAVE RETRACTED' },
        { challenge: 'Approach', response: '65-75 KIAS, level-attitude landing' },
      ],
    },
    {
      title: 'EMERGENCY — Static Source Blockage',
      phase: 'emergency',
      items: [
        { challenge: g ? 'ALT STATIC AIR Valve' : 'Static Pressure Alternate Source Valve', response: 'PULL ON', check: on(C172.altStatic) },
        { challenge: 'Airspeed', response: 'Consult calibration tables (Section 5)' },
      ],
    },
    ...(g
      ? [
          {
            title: 'EMERGENCY — HIGH VOLTS Annunciator / M BAT AMPS > 40',
            phase: 'emergency',
            items: [
              { challenge: 'MASTER Switch (ALT only)', response: 'OFF', check: off(C172.masterAlt) },
              { challenge: 'Electrical Load', response: 'REDUCE: AVIONICS BUS 1 OFF, PITOT HEAT, BEACON, LAND, TAXI, NAV, STROBE, CABIN PWR 12V OFF' },
              { challenge: 'COM1 and NAV1', response: 'TUNE TO ACTIVE FREQUENCY; COM1 MIC and NAV1 SELECT' },
              { challenge: 'AVIONICS Switch (BUS 2)', response: 'OFF (KEEP ON if in clouds)' },
              { challenge: 'Land', response: 'AS SOON AS PRACTICAL' },
            ],
          },
          {
            title: 'EMERGENCY — LOW VOLTS Annunciator',
            phase: 'emergency',
            items: [
              { challenge: 'Below 1000 RPM: Throttle', response: '1000 RPM; LOW VOLTS CHECK OFF' },
              { challenge: 'MASTER Switch (ALT only)', response: 'OFF' },
              { challenge: 'Alternator Circuit Breaker (ALT FIELD)', response: 'CHECK IN', check: (v: V) => v.get('cb.alt_field', 1) > 0.5 },
              { challenge: 'MASTER Switch (ALT and BAT)', response: 'ON', check: masterOn },
              { challenge: 'LOW VOLTS Annunciator', response: 'CHECK OFF', check: off(ANN.lowVolts) },
              { challenge: 'M BUS VOLTS / M BAT AMPS', response: 'CHECK 27.5 V minimum / CHARGING (+)' },
              { challenge: 'If still on: MASTER (ALT only) OFF, reduce load, land as soon as practical', response: 'AS REQUIRED' },
            ],
          },
          {
            title: 'EMERGENCY — Vacuum System Failure (LOW VACUUM)',
            phase: 'emergency',
            items: [{ challenge: 'Vacuum Indicator (VAC)', response: 'CHECK EIS ENGINE page — pointer in green arc; do not use the standby attitude indicator if not' }],
          },
          {
            title: 'EMERGENCY — High Carbon Monoxide (CO LVL HIGH)',
            phase: 'emergency',
            items: [
              { challenge: 'CABIN HT Knob', response: 'OFF (push full in)', check: (v: V) => v.get(C172.cabinHeat) < 0.05 },
              { challenge: 'CABIN AIR Knob', response: 'ON (pull full out)', check: (v: V) => v.get(C172.cabinAir) > 0.95 },
              { challenge: 'Cabin Vents; Windows', response: 'OPEN (163 KIAS max windows open)' },
              { challenge: 'If CO LVL HIGH remains', response: 'LAND AS SOON AS PRACTICAL' },
            ],
          },
        ]
      : [
          {
            title: 'EMERGENCY — Ammeter Shows Excessive Rate of Charge',
            phase: 'emergency',
            items: [
              { challenge: 'Alternator', response: 'OFF (compass deviations of up to 25° may occur)', check: off(C172.masterAlt) },
              { challenge: 'Nonessential Electrical Equipment', response: 'OFF' },
              { challenge: 'Flight', response: 'TERMINATE as soon as practical' },
            ],
          },
          {
            title: 'EMERGENCY — Low Voltage Annunciator (VOLTS) In Flight',
            phase: 'emergency',
            items: [
              { challenge: 'Avionics Master Switch', response: 'OFF' },
              { challenge: 'Alternator Circuit Breaker (ALT FLD)', response: 'CHECK IN', check: (v: V) => v.get('cb.alt_fld', 1) > 0.5 },
              { challenge: 'Master Switch', response: 'OFF (both sides), then ON' },
              { challenge: 'Low Voltage Annunciator (VOLTS)', response: 'CHECK OFF', check: off(ANN.lowVolts) },
              { challenge: 'Avionics Master Switch', response: 'ON' },
              { challenge: 'If VOLTS illuminates again: Alternator OFF, nonessential equipment OFF', response: 'TERMINATE FLIGHT as soon as practical' },
            ],
          },
          {
            title: 'EMERGENCY — Vacuum System Failure (L VAC / VAC R)',
            phase: 'emergency',
            items: [{ challenge: 'Vacuum Gage', response: 'CHECK within normal limits (partial panel if not)' }],
          },
        ]),
  ];
  return [...normal, ...emergency];
}
