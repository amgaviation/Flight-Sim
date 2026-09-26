/**
 * Boeing 737-800 with blended winglets, CFM56-7B26: published numbers shared
 * by the FDM, the systems, the state presets, the checklists and the tests.
 *
 * Sources (abbreviations used in comments throughout this folder):
 *  - TCDS  = FAA TCDS A16WE (Boeing 737), 737-800 section: weights, Vmo/Mmo,
 *            maximum operating altitude.
 *  - ACAPS = Boeing D6-58325-6 "737 Airplane Characteristics for Airport
 *            Planning" (Oct 2005 / Feb 2006 revisions): weights, OEW 41,413 kg,
 *            usable fuel 6,875 USG / 20,894 kg, wheelbase 51.2 ft (15.6 m),
 *            ground clearances (engine 0.48-0.64 m, top of fuselage 5.41-5.56 m,
 *            winglet bottom 4.06-4.32 m, vertical tail 12.37-12.62 m).
 *  - LIM   = SmartCockpit "B737NG Generic Limitations" (Nov 2006): fuel,
 *            gear speeds and times, electrical, hydraulic, engine, APU,
 *            pneumatic and acceleration limits.
 *  - E004  = EASA TCDS E.004 (CFM56-7B): rotor speeds, EGT, oil limits, thrust.
 *  - B737ORG = b737.org.uk technical pages ("Powerplant", "Hydraulics",
 *            "Flight Controls", "Warning Systems", "Tech specs").
 *  - FCOM  = Boeing 737NG FCOM system descriptions (volume 2, chapters 1-16) as
 *            circulated in public training material (SmartCockpit summaries).
 * The avionics family (src/avionics/boeing-737/data) holds the same airframe
 * numbers for the displays and the FMC; they are re-exported where shared.
 */
import { B738_FLAPS, B738_FUEL, B738_SPEEDS, B738_WEIGHTS, B738_WING_AREA_M2 } from '../../avionics/boeing-737/data/b738';

export const LB = 0.45359237;
export const KT = 0.514444;

// ------------------------------------------------------------------------ geometry

/** ACAPS / B737ORG tech specs: 737-800 with winglets. */
export const B738_DIM = {
  lengthM: 39.47, // 129 ft 6 in (ACAPS §1: "129 ft 6 in long")
  spanWingletsM: 35.79, // 117 ft 5 in with blended winglets (ACAPS 2.2.12)
  spanM: 34.32, // 112 ft 7 in basic wing (ACAPS 2.2.11)
  heightM: 12.55, // 41 ft 2 in nominal (ACAPS 2.3.4: vertical tail 12.37-12.62 m)
  wheelbaseM: 15.6, // ACAPS turning table: 51.2 ft / 15.6 m
  trackM: 5.72, // 18 ft 9 in main gear track (ACAPS 2.2.12)
  wingAreaM2: B738_WING_AREA_M2, // 124.58 m^2 (1,341.2 ft^2)
  macM: 155.81 * 0.0254, // EST: NG wing MAC 155.81 in (3.958 m), commonly quoted NG W&B figure
  sweepDeg: 25, // quarter-chord sweep (B737ORG "Wings": 25 deg)
  fuselageWidthM: 3.76, // 12 ft 4 in outside width (B737ORG)
  cabinVolumeM3: 132, // EST: 737-800 pressurized volume ~4,650 ft^3 (cabin + flight deck, B737ORG pressurization page quotes ~130 m^3 class)
} as const;

// ------------------------------------------------------------------------ weights

export const B738_MASS = {
  ...B738_WEIGHTS, // TCDS/ACAPS: MTOW 79,016 kg, MLW 66,361 kg, MZFW 62,732 kg, OEW 41,413 kg
  maxTaxiKg: 79243, // ACAPS: max design taxi weight 174,700 lb
  maxPayloadKg: 21319, // ACAPS max structural payload
} as const;

// ------------------------------------------------------------------------ speeds and limits

export const B738_LIMITS = {
  ...B738_SPEEDS, // TCDS Vmo 340 / Mmo 0.82 / FL410; LIM gear 270/235/320, M.82
  /** Turbulent air penetration speed (FCOM L.10 / QRH): 280 KIAS / M0.76. */
  turbPenKt: 280,
  turbPenMach: 0.76,
  /** Max tire ground speed (LIM: 225 mph = 195 kt). */
  maxTireKt: 195,
  /** Acceleration limits (LIM): +2.5 / -1.0 g flaps up, +2.0 / 0 g flaps down (FCOM L.10: flaps down +2.0/0.0). */
  nzMax: 2.5,
  nzMin: -1.0,
  nzMaxFlaps: 2.0,
  /** FCOM L.10 operating limits: max takeoff/landing altitude 8,400 ft (EST: basic 8,400 ft; high-altitude option 14,000 ft). */
  maxTakeoffLandingAltFt: 8400,
  /** Max demonstrated crosswind (FCOM L.10 winglets: takeoff 33 kt, landing 33 kt; EST from the FCOM crosswind guideline table). */
  maxCrosswindKt: 33,
  /** Max tailwind component (FCOM L.10: 10 kt, 15 kt with the certified option). */
  maxTailwindKt: 10,
  /** Runway slope +/-2 % (FCOM L.10). */
  maxSlopePct: 2,
  /** Max cabin differential (relief valves) 9.1 psi; takeoff and landing 0.125 psi (FCOM L.10). */
  maxDiffPsi: 9.1,
  maxDiffLandingPsi: 0.125,
  /** Fuel temperature: >= freezing point + 3 degC (LIM); -43 degC is the usual Jet A-1 (-47 degC) planning figure (EST). */
  fuelMinC: -43,
  fuelMaxC: 49, // LIM
} as const;

/** Flap lever detents 0..8 (UP 1 2 5 10 15 25 30 40) with placard speeds (FCOM L.10 placard). */
export const B738_FLAP_DETENTS = B738_FLAPS.map((f, i) => ({ lever: i, flapDeg: f.deg, label: f.label, vfe: f.placardKt }));
/** Lever value of each flap setting (the lever var carries the detent index 0..8). */
export const FLAP_LEVER = { up: 0, f1: 1, f2: 2, f5: 3, f10: 4, f15: 5, f25: 6, f30: 7, f40: 8 } as const;

// ------------------------------------------------------------------------ fuel

/** LIM: usable fuel at 0.80 kg/l: mains 3,915 kg each, centre 13,066 kg, total 20,896 kg (6,875 USG). */
export const B738_TANKS = {
  mainKg: B738_FUEL.mainTankKg,
  centerKg: B738_FUEL.centerTankKg,
  totalKg: B738_FUEL.totalKg,
  /** EST: unusable (trapped) fuel per main tank / centre tank (typical 737 figures ~ 5 USG / tank). */
  unusableMainKg: 15,
  unusableCenterKg: 20,
  /** LOW indication below 453 kg in a main tank (FCOM 12.20). */
  lowKg: B738_FUEL.lowKg,
  imbalanceKg: B738_FUEL.imbalanceKg,
  configCenterKg: B738_FUEL.configCenterKg,
  /** Jet A density used for volume <-> mass (LIM tables at 0.80 kg/l). */
  densityKgL: 0.8,
} as const;

// ------------------------------------------------------------------------ engines

/** E004 / LIM / B737ORG: CFM56-7B26 operating limits. */
export const CFM56_7B26 = {
  thrustLbf: 26300, // E004 take-off thrust -7B26 (ACAPS: 26,300 lb SLST)
  n1RedPct: 104, // E004 (100 % = 5,175 rpm)
  n2RedPct: 105, // E004 (100 % = 14,460 rpm)
  egtTakeoffC: 950, // LIM / E004 (5 min, 10 min single engine)
  egtMctC: 925, // E004 max continuous (LIM table lists 895 for older -7B)
  egtStartC: 725, // LIM
  oilPressMinPsi: 13, // LIM red line
  oilPressAmberPsi: 26, // B737ORG: amber band 13-26 psi valid at take-off thrust
  oilTempMaxC: 155, // E004 transitory (LIM 165 momentary)
  oilTempMcC: 140, // E004 max continuous (display amber)
  starterCutoutN2Pct: 56, // B737ORG "Starter cutout is approx 56 % N2 NG's"
  fuelOnN2Pct: 25, // B737ORG: min 25 % N2 (or 20 % at max motoring) to introduce fuel
  maxReengageN2Pct: 20, // LIM: starter re-engage below 20 % N2
  starterDutyS: 120, // LIM: 2 min ON
  minStartDuctPsi: 30, // LIM: 30 psi at sea level, -0.5 psi / 1,000 ft
} as const;

/** APU (Honeywell 131-9B) limits (LIM). */
export const APU_LIMITS = {
  bleedAndElecMaxFt: 10000,
  bleedMaxFt: 17000,
  elecMaxFt: 41000,
  minRpmForPowerPct: 95,
  overspeedPct: 107,
  genKva: 90,
} as const;

// ------------------------------------------------------------------------ systems

/** LIM electrical: AC 115 V (110-120) / 400 Hz (390-410); DC 26 V (22-30); battery 24 V 48 Ah class (LIM lists 40 Ah; BATTERY_737NG_NICD preset 48 Ah). */
export const ELEC_LIMITS = { acV: 115, acMinV: 110, acMaxV: 120, hz: 400, hzMin: 390, hzMax: 410, dcV: 26, dcMinV: 22, dcMaxV: 30, idgMaxOilC: 182, idgKva: 90 } as const;

/** LIM hydraulic: 3,000 psi normal, 2,800 min, 3,500 relief; accumulator precharge 1,000 psi; RF 76 %. */
export const HYD_LIMITS = {
  normalPsi: 3000,
  minPsi: 2800,
  reliefPsi: 3500,
  lowPressPsi: 1300, // FCOM 13.20: LOW PRESSURE light below 1,300 psi
  precharge: 1000,
  refillFraction: 0.76,
  /** B737ORG "Hydraulics": reservoir full level A 5.7 USG (21.6 l), B 8.2 USG (31.1 l); standby EST 3.6 USG. */
  resAL: 21.6,
  resBL: 31.1,
  resStbyL: 13.6,
  /** B737ORG: EDP 37 gpm (NG), EMDP 6 gpm, standby 3 gpm. */
  edpLpm: 37 * 3.785,
  emdpLpm: 6 * 3.785,
  stbyLpm: 3 * 3.785,
  /** LIM: minimum fuel for ground operation of electric pumps 760 kg (heat exchanger in main tanks 1 and 2). */
  minFuelForEmdpKg: 760,
} as const;

/** Stabilizer trim (FCOM 9.20): 0-17 units, takeoff green band 3-8.5 units (EST: typical NG band, CG-dependent). */
export const STAB = {
  minUnits: 0,
  maxUnits: 17,
  /** Main electric trim stops: 3.95-14.5 flaps up, 0.05-14.5 flaps down (FCOM 9.20 "Stabilizer trim"). */
  elecUpLimits: [3.95, 14.5] as [number, number],
  elecDnLimits: [0.05, 14.5] as [number, number],
  greenBand: [3, 8.5] as [number, number],
  /** Neutral (0 normalized trim) for the FDM mapping (EST: mid of the flight range where computeTrim lands at mid CG). */
  neutral: 6.5,
  /** Trim rates (units/s): main electric flaps up 0.2 / flaps down 0.4, autopilot 0.09 / 0.27 (EST from the 737NG FCOM rate ratios; manual wheel ~ 0.5 unit per turn class). */
  mainElecUp: 0.2,
  mainElecDn: 0.4,
  apUp: 0.09,
  apDn: 0.27,
} as const;

/** Takeoff / reference performance figures used by the tests (all EST unless noted, see the dossier §5). */
export const PERF_REF = {
  /**
   * Take-off: 65 t, flaps 5, SL ISA, 26K full thrust: VR ~140 KIAS (avionics perf.ts QRH-like table).
   * Lift-off distance ~1,200 m (EST: the published FAR take-off field length at MTOW 79 t, SL ISA, is
   * ~2,300 m (Boeing Next-Generation 737 technical characteristics); field length scales ~W^2 -> ~1,570 m
   * at 65 t, and the all-engine lift-off distance is ~0.75 of it).
   */
  toWeightKg: 65000,
  toVrKt: 140,
  toLiftoffDistM: 1200,
  /** Cruise: 65 t, FL350, M0.78 ISA: 450 KTAS, total fuel flow ~2,450 kg/h (EST: widely quoted 2,200-2,600 kg/h line figure for the -800W). */
  crzWeightKg: 65000,
  crzAltFt: 35000,
  crzMach: 0.78,
  crzKtas: 450,
  crzFfKgH: 2450,
  /** Stall (1 g) at 60 t: clean ~ 150 KCAS, flaps 40 ~ 112 KCAS (EST from VREF40 138 kt / 1.23 at 60 t, perf.ts). */
  stallWeightKg: 60000,
  vsCleanKt: 150,
  vs40Kt: 112,
  vs30Kt: 118,
} as const;
