/**
 * Cessna 172S Skyhawk SP: published numbers shared by both cockpit variants.
 *
 * Sources (all public):
 *  - POH: Cessna 172S Information Manual / POH-AFM 172SPHUS, Revision 5
 *    (19 Jul 2004, serials 172S8001 and on), steam-gauge airplanes.
 *  - POH NAV III: Cessna 172S NAV III POH-AFM 172SPHAUS-03 (22 Dec 2005,
 *    serials 17289810 and on), G1000 airplanes. Its limitations and Section 5
 *    performance tables are identical to 172SPHUS (compared page by page).
 *  - TCDS: FAA Type Certificate Data Sheet 3A12, section XII (Model 172S).
 *  - UND: University of North Dakota "C172S Electrical System" trainer
 *    (aero.und.edu), G1000 NXi circuit-breaker list and ratings.
 * See docs/aircraft/c172s.md for the full dossier.
 *
 * Pure data (no Three.js) so the headless tests and systems can import it.
 */
import type { Table1D } from '../../physics/types';
import { AVGAS_LB_PER_GAL, LB_TO_KG } from '../../core/units';

/** kg per US gallon of avgas (POH: 6 lb/gal). */
export const KG_PER_GAL = AVGAS_LB_PER_GAL * LB_TO_KG;

/** POH Section 2 / TCDS 3A12 airspeed limits (KIAS). */
export const VSPEEDS = {
  vne: 163, // POH Fig 2-1: never exceed 163 KIAS (160 KCAS)
  vno: 129, // POH Fig 2-1: max structural cruising 129 KIAS (126 KCAS)
  va2550: 105, // POH Fig 2-1: maneuvering 105 KIAS at 2550 lb
  va2200: 98, // POH Fig 2-1: 98 KIAS at 2200 lb
  va1900: 90, // POH Fig 2-1: 90 KIAS at 1900 lb
  vfe10: 110, // POH Fig 2-1: 10 deg flaps 110 KIAS
  vfe30: 85, // POH Fig 2-1: 10-30 deg flaps 85 KIAS
  windowOpen: 163, // POH Fig 2-1: max window open speed 163 KIAS
  // POH Section 4 "Airspeeds for normal operation" (2550 lb)
  rotate: 55, // POH Sec 4 normal takeoff: "lift nose wheel at 55 KIAS"
  climbNormal: [75, 85] as const, // normal climb out 75-85 KIAS
  shortField50ft: 56, // short-field takeoff, flaps 10, speed at 50 ft
  vySl: 74, // best rate of climb, sea level
  vy10k: 72, // best rate of climb, 10,000 ft
  vxSl: 62, // best angle of climb, sea level
  vx10k: 67, // best angle of climb, 10,000 ft
  approachFlapsUp: [65, 75] as const,
  approachFlaps30: [60, 70] as const,
  shortFieldApproach: 61, // flaps 30
  balkedLanding: 60, // max power flaps 20
  maxDemoCrosswindKt: 15,
  // POH Sec 3 "Airspeeds for emergency operation"
  engineFailureFlapsUp: 70,
  engineFailureFlapsDown: 65,
  bestGlide: 68,
  precautionaryLanding: 65,
  // POH Sec 2 airspeed indicator markings (KIAS)
  whiteArc: [40, 85] as const,
  greenArc: [48, 129] as const,
  yellowArc: [129, 163] as const,
} as const;

/** POH Section 2 / TCDS limits. */
export const LIMITS = {
  maxRampLb: 2558, // POH Sec 2 normal category
  maxTakeoffLb: 2550,
  maxLandingLb: 2550,
  utilityMaxTakeoffLb: 2200,
  standardEmptyLb: 1663, // POH Sec 1
  maxUsefulLoadLb: 895,
  baggageArea1Lb: 120, // sta 82-108
  baggageArea2Lb: 50, // sta 108-142; combined max 120 lb
  cgFwdIn2550: 41.0, // TCDS: 41.0 in at 2550 lb, linear to 35.0 in at 1950 lb
  cgFwdIn1950: 35.0,
  cgAftIn: 47.3, // TCDS: 47.3 in at all weights
  loadFactorFlapsUp: [3.8, -1.52] as const, // POH Sec 2 normal category
  loadFactorFlapsDown: 3.0,
  maxRpm: 2700, // POH Sec 2
  staticRpm: [2300, 2400] as const, // TCDS / POH: static rpm at full throttle
  oilTempMaxF: 245, // POH Sec 2: 245 F (118 C)
  oilPressMinPsi: 20,
  oilPressMaxPsi: 115,
  oilPressGreen: [50, 90] as const, // POH Fig 2-3
  oilTempGreenF: [100, 245] as const,
  vacuumGreen: [4.5, 5.5] as const, // POH Fig 2-3
  fuelFlowGreenGph: [0, 12] as const,
  /** POH Fig 2-3 tachometer green arc vs pressure altitude: SL 2100-2500, 5000 ft 2100-2600, 10000 ft 2100-2700. */
  tachGreen: { x: [0, 5000, 10000], lo: [2100, 2100, 2100], hi: [2500, 2600, 2700] },
  maxSlipOneTankDryS: 30, // POH Sec 2 additional fuel limitations
  flapsTakeoffRange: [0, 10] as const, // POH Sec 2 flap limitations
  flapsLandingRange: [0, 30] as const,
} as const;

/** POH Sec 1 / Sec 2 fuel: 2 x 28.0 gal, 26.5 usable each, 1.5 gal unusable each. */
export const FUEL_DATA = {
  tankCapacityGal: 28.0,
  tankUsableGal: 26.5,
  tankUnusableGal: 1.5,
  /** Reduced (tab) fill: 17.5 gal usable per tank (POH Sec 7 "Reduced tank capacity"). */
  tabFillUsableGal: 17.5,
  /** Low-fuel warning below ~5 gal for > 60 s (POH Sec 7 "Fuel indicating"). */
  lowFuelGal: 5,
  lowFuelDelayS: 60,
  /** Engine start, taxi and takeoff allowance (POH Fig 5-7 note 1). */
  startTaxiTakeoffGal: 1.4,
} as const;

/** TCDS 3A12 172S control surface movements (degrees). */
export const SURFACE_TRAVEL = {
  aileronUp: 20, // +/-1
  aileronDown: 15, // +/-1
  elevatorUp: 28, // +1/-0
  elevatorDown: 23, // +1/-0
  elevatorTabUp: 22, // +1/-0 (tab up = nose DOWN trim)
  elevatorTabDown: 19, // +1/-0 (tab down = nose UP trim)
  rudder: 16 + 10 / 60, // 16 deg 10 min each way, measured parallel to the waterline
  flapsMax: 30, // landing 0-30 (+0/-2)
} as const;

/**
 * Flap switch detents (POH Sec 2 placard 4 and Sec 7 "Wing flap system"): the lever has
 * mechanical stops at 10 and 20 deg (lever moved right to clear them) and FULL (30 deg).
 * Lever values 0..3 = UP / 10 / 20 / FULL.
 */
export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP' },
  { lever: 1, flapDeg: 10, label: '10°', vfe: VSPEEDS.vfe10 },
  { lever: 2, flapDeg: 20, label: '20°', vfe: VSPEEDS.vfe30 },
  { lever: 3, flapDeg: 30, label: 'FULL', vfe: VSPEEDS.vfe30 },
];

/**
 * POH Figure 5-1 (sheet 1) airspeed calibration, NORMAL static source, power for level
 * flight or maximum-power descent. Stored as KIAS vs KCAS (inverse direction) per flap
 * setting so the airspeed indicator can be driven from measured CAS. The low end below
 * the published table uses the POH Figure 5-3 stall speeds (most forward CG, 2550 lb):
 * flaps UP 53 KCAS = 48 KIAS, 10 deg 51 KCAS = 43 KIAS, FULL 48 KCAS = 40 KIAS.
 * EST: below the stall entries the curve is extended with the same slope to 0.
 */
export const ASI_CAL_NORMAL: { flapDeg: number; kiasVsKcas: Table1D }[] = [
  {
    flapDeg: 0,
    kiasVsKcas: {
      x: [0, 20, 53, 56, 62, 70, 78, 87, 97, 107, 117, 127, 137, 147, 157, 200],
      y: [0, 15, 48, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 203],
    },
  },
  {
    flapDeg: 10,
    kiasVsKcas: {
      x: [0, 20, 51, 57, 63, 71, 80, 89, 99, 109, 200],
      y: [0, 12, 42.5, 50, 60, 70, 80, 90, 100, 110, 201],
    },
  },
  {
    flapDeg: 30,
    kiasVsKcas: {
      x: [0, 20, 48, 50, 56, 63, 72, 81, 86, 200],
      y: [0, 10, 39, 40, 50, 60, 70, 80, 85, 199],
    },
  },
];

/**
 * POH Figure 5-1 (sheet 2) ALTERNATE static source (windows and vents closed, heat, air and
 * defroster on maximum), flaps UP: at the same KCAS the ASI reads 0-3 kt higher than on the
 * normal source (e.g. 95 KCAS = 100 KIAS alternate vs 97 KCAS = 100 KIAS normal). Stored
 * as the KIAS increment vs KCAS; used to derive the cabin static-pressure error.
 */
export const ASI_ALT_STATIC_DELTA: Table1D = {
  x: [56, 62, 68, 76, 85, 95, 105, 115, 125, 134, 144, 154],
  // alternate-table KIAS minus the normal-source KIAS (sheet 1, interpolated) at the same KCAS
  y: [0, 0, 2.5, 2.5, 2.2, 2, 2, 2, 2, 3, 3, 3],
};

/** POH Figure 5-3 stall speeds at 2550 lb, power off, most forward CG (KCAS), wings level. */
export const STALL_KCAS = { flapsUp: 53, flaps10: 51, flaps30: 48 } as const;
/** Same, most rearward CG (KCAS): UP 53, 10 deg 50, FULL 48. */
export const STALL_KCAS_AFT = { flapsUp: 53, flaps10: 50, flaps30: 48 } as const;

/**
 * POH Figure 5-5 short-field takeoff distance at 2550 lb (flaps 10, full throttle before
 * brake release, paved level dry runway, zero wind; lift-off 51 KIAS, 56 KIAS at 50 ft).
 * Rows: pressure altitude ft; columns 0/10/20/30/40 C; values [ground roll, total over 50 ft].
 */
export const TAKEOFF_2550 = {
  liftoffKias: 51,
  speed50ftKias: 56,
  pressAltFt: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
  tempC: [0, 10, 20, 30, 40],
  groundRollFt: [
    [860, 925, 995, 1070, 1150],
    [940, 1010, 1090, 1170, 1260],
    [1025, 1110, 1195, 1285, 1380],
    [1125, 1215, 1310, 1410, 1515],
    [1235, 1335, 1440, 1550, 1660],
    [1355, 1465, 1585, 1705, 1825],
    [1495, 1615, 1745, 1875, 2010],
    [1645, 1785, 1920, 2065, 2215],
    [1820, 1970, 2120, 2280, 2450],
  ],
  total50ftFt: [
    [1465, 1575, 1690, 1810, 1945],
    [1600, 1720, 1850, 1990, 2135],
    [1755, 1890, 2035, 2190, 2355],
    [1925, 2080, 2240, 2420, 2605],
    [2120, 2295, 2480, 2685, 2880],
    [2345, 2545, 2755, 2975, 3205],
    [2605, 2830, 3075, 3320, 3585],
    [2910, 3170, 3440, 3730, 4045],
    [3265, 3575, 3880, 4225, 4615],
  ],
} as const;

/** POH Figure 5-6 maximum rate of climb at 2550 lb, flaps up, full throttle (fpm). */
export const MAX_ROC_2550 = {
  pressAltFt: [0, 2000, 4000, 6000, 8000, 10000, 12000],
  climbKias: [74, 73, 73, 73, 72, 72, 72],
  tempC: [-20, 0, 20, 40],
  rocFpm: [
    [855, 785, 710, 645],
    [760, 695, 625, 560],
    [685, 620, 555, 495],
    [575, 515, 450, 390],
    [465, 405, 345, 285],
    [360, 300, 240, 180],
    [255, 195, 135, NaN],
  ],
} as const;

/** POH Figure 5-7 time, fuel and distance to climb (standard temperature, 2550 lb, from SL). */
export const CLIMB_STD_2550 = {
  pressAltFt: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000],
  climbKias: [74, 73, 73, 73, 73, 73, 73, 73, 72, 72, 72, 72, 72],
  rocFpm: [730, 695, 655, 620, 600, 550, 505, 455, 410, 360, 315, 265, 220],
  timeMin: [0, 1, 3, 4, 6, 8, 10, 12, 14, 17, 20, 24, 28],
  fuelGal: [0, 0.4, 0.8, 1.2, 1.5, 1.9, 2.2, 2.6, 3.0, 3.4, 3.9, 4.4, 5.0],
  distNm: [0, 2, 4, 6, 8, 10, 13, 16, 19, 22, 27, 32, 38],
} as const;

/**
 * POH Figure 5-8 cruise performance, 2550 lb, recommended lean mixture, STANDARD temperature
 * column: [pressure altitude ft, rpm, %BHP, KTAS, GPH].
 */
export const CRUISE_STD: [number, number, number, number, number][] = [
  [2000, 2550, 77, 118, 10.5],
  [2000, 2500, 73, 115, 9.9],
  [2000, 2400, 64, 110, 9.0],
  [2000, 2300, 57, 104, 8.1],
  [2000, 2200, 50, 97, 7.3],
  [2000, 2100, 44, 90, 6.6],
  [4000, 2600, 77, 120, 10.4],
  [4000, 2500, 69, 115, 9.5],
  [4000, 2400, 61, 109, 8.5],
  [4000, 2300, 54, 102, 7.7],
  [4000, 2200, 48, 96, 7.0],
  [6000, 2650, 77, 122, 10.4],
  [6000, 2600, 73, 119, 9.9],
  [6000, 2500, 65, 114, 9.0],
  [6000, 2400, 57, 108, 8.2],
  [6000, 2300, 51, 101, 7.4],
  [6000, 2200, 45, 94, 6.7],
  [8000, 2700, 77, 124, 10.4],
  [8000, 2650, 72, 122, 9.9],
  [8000, 2600, 68, 119, 9.4],
  [8000, 2500, 61, 112, 8.6],
  [8000, 2400, 54, 106, 7.8],
  [8000, 2300, 48, 99, 7.1],
  [10000, 2700, 72, 123, 9.8],
  [10000, 2600, 64, 117, 9.0],
  [10000, 2500, 57, 111, 8.2],
  [10000, 2400, 51, 104, 7.5],
  [12000, 2650, 64, 119, 8.9],
  [12000, 2600, 61, 116, 8.5],
  [12000, 2500, 54, 109, 7.8],
];

/** POH Figure 5-11 short-field landing at 2550 lb (flaps 30, power off, max braking, 61 KIAS at 50 ft), SL row. */
export const LANDING_2550_SL = { tempC: [0, 10, 20, 30, 40], groundRollFt: [545, 565, 585, 605, 625], total50ftFt: [1290, 1320, 1350, 1380, 1415] } as const;

/** POH Figure 3-1 maximum glide: 68 KIAS, prop windmilling, flaps up, zero wind: ~1.5 nm per 1000 ft AGL (12,000 ft -> ~18 nm). */
export const GLIDE = { kias: 68, nmPer1000ft: 1.5 } as const;

/** POH performance-specifications page. */
export const PERF_SPEC = {
  maxSpeedSlKt: 126,
  cruise75pct8500Kt: 124,
  rocSlFpm: 730,
  serviceCeilingFt: 14000,
  takeoffGroundRollFt: 960,
  takeoffOver50ftFt: 1630,
  landingGroundRollFt: 575,
  landingOver50ftFt: 1335,
} as const;

/** Electrical system (POH Sec 7; UND C172S Electrical System trainer). */
export const ELEC_DATA = {
  /** POH NAV III equipment list 24-02-R and POH 172SPHUS 24-02-R: battery 24 V, 12.75 Ah. */
  mainBatteryAh: 12.75,
  /** POH Sec 7: 28 V, 60 A belt-driven alternator. */
  alternatorA: 60,
  /** UND: the ACU regulates the main bus to "approximately 28.5 volts" (indicated ~28 V at the WARN breaker). */
  regulatedV: 28.5,
  /** POH Sec 7 / UND: LOW VOLTS below 24.5 V. */
  lowVolts: 24.5,
  /** UND: HIGH VOLTS above 32.0 V. */
  highVolts: 32.0,
  /** POH NAV III Sec 3 "Excessive rate of charge": ACU over-voltage disconnect at ~31.75 V. */
  acuOvTripV: 31.75,
  /** POH NAV III Sec 3: standby battery takes over the ESS bus when M BUS falls below 20 V. */
  stbyTakeoverV: 20,
  /** UND: STBY BATT annunciator when the standby battery discharges > 0.5 A for > 10 s. */
  stbyAnnunAmps: 0.5,
  stbyAnnunDelayS: 10,
  /** POH NAV III Sec 3: "after thirty minutes of cruising flight ... less than 5 amps of charging". */
  cruiseChargeMaxA: 5,
  /** POH NAV III Sec 3 HIGH VOLTS procedure trigger: M BAT AMPS more than 40. */
  highChargeA: 40,
} as const;

/** POH Sec 4 checks. */
export const ENGINE_CHECKS = {
  runupRpm: 1800,
  magDropMax: 150,
  magDiffMax: 50,
  idleRpm: 600, // "engine idles (approximately 600 RPM)"
  groundLeanRpm: 1200, // leaning for ground operations
  starterCrankS: 10,
  starterCoolS: 20,
  oilPressureWithinS: [30, 60] as const, // G1000 POH: oil pressure into green in 30 to 60 s
  primeFlowS: [3, 5] as const, // aux pump + mixture rich until stable fuel flow (3-5 s)
} as const;
