/**
 * Cessna Citation M2 (Model 525, serials 525-0800 and on): published
 * numbers shared by the FDM, systems, states, checklists and tests.
 *
 * Sources (abbreviations used in comments throughout this folder):
 *  - TCDS  = EASA TCDS IM.A.078 Issue 19 (Cessna 525, mirrors FAA TCDS A1WI):
 *            weights, speeds, CG range, datum, MAC, fuel/oil stations,
 *            control surface travel, engine limits.
 *  - S&D15 = Textron "Specification and Description Citation M2", Oct 2015
 *            Rev A (units 525-0900 to TBD): systems descriptions.
 *  - S&D21 = Textron "Specification and Description Citation M2", Sep 2021
 *            Rev F (units 525-1048 to TBD).
 *  - FPG   = Textron "Citation M2 Flight Planning Guide" (525-0800 and on,
 *            revisions FMC-01 / 525OMC-00): V-speeds, field lengths,
 *            climb, cruise, stall speeds.
 *  - FR    = flyradius.com "Cessna Citation M2 Engine - FJ44-1AP-21"
 *            (engine limits) and "Specifications" (speeds in KIAS/KCAS).
 *  - ETCDS = EASA TCDS IM.E.016 Issue 13 (Williams FJ44 family).
 * See docs/aircraft/citation-m2.md for the full dossier.
 */

export const LB = 0.45359237;
/** Inches aft of the TCDS datum -> body x metres (datum = empty-weight CG, x forward). */
export const EMPTY_CG_FS_IN = 250.0; // EST: typical empty CG (TCDS gives no empty-CG range; see fdm.ts)
export const fs = (stationIn: number): number => (EMPTY_CG_FS_IN - stationIn) * 0.0254;

export const M2_LIMITS = {
  // TCDS §10 / FPG p.3
  vmoKt: 263, // KIAS, sea level to 30,500 ft
  mmo: 0.71, // indicated Mach above 30,500 ft
  vmoMmoChangeFt: 30500,
  vaKt: 202, // TCDS: VA at 10,700 lb (KIAS)
  vbKt: 217, // TCDS: VB
  vfe15Kt: 200, // TCDS: flaps 15 (takeoff and approach)
  vfe35Kt: 161, // TCDS: flaps 35 (landing)
  vloExtendKt: 186, // TCDS/FPG
  vloRetractKt: 175, // TCDS (525-0458 and on)
  vleKt: 186,
  vmcaF0Kt: 86,
  vmcaF15Kt: 77,
  vmcgKt: 89,
  maxTireGsKt: 165, // TCDS maximum tire ground speed
  maxAltFt: 41000, // TCDS §11
  maxAutopilotKt: 263, // TCDS: max autopilot operating speed = Vmo/Mmo
  // S&D21 design load limits
  nzMaxClean: 3.6,
  nzMinClean: -1.44,
  nzMaxFlaps: 2.0,
  // FR / TCDS engine limits (FJ44-1AP-21)
  n1RedlinePct: 104.69, // 18,055 rpm (100 % = 17,245 rpm)
  n2RedlinePct: 100.0, // 41,200 rpm
  ittTakeoffC: 855, // 5 min (10 min OEI)
  ittMcC: 835,
  ittStartTransientC: 1000, // TCDS: transient, starting, 15 s
  oilPressMinPsi: 23,
  oilPressMaxPsi: 120, // 130 psi for 5 min
  oilTempMaxC: 135,
  // S&D15 §3 / S&D21: nominal max cabin differential
  cabinDiffPsi: 8.5,
  // TCDS §13
  maxRampLb: 10800,
  mtowLb: 10700,
  mlwLb: 9900,
  mzfwLb: 8400, // TCDS 525-0800..1399 (8,500 lb for 525-1400 and on)
  usableFuelLb: 3296, // TCDS §9.1: 2 x 1,648 lb at FS 253.0
  unusableFuelLb: 30.64, // TCDS Note 2
} as const;

/** Flap handle detents (S&D15 §9.1 / TCDS §16: 0, 15, 35 and 60 "ground flaps"). */
export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP', vfe: 400 },
  { lever: 1, flapDeg: 15, label: 'T.O. & APPR', vfe: M2_LIMITS.vfe15Kt },
  { lever: 2, flapDeg: 35, label: 'LAND', vfe: M2_LIMITS.vfe35Kt },
  // TCDS: flaps 60 (ground flaps) prohibited in flight; VFE placard = the 35 deg value.
  { lever: 3, flapDeg: 60, label: 'GND', vfe: M2_LIMITS.vfe35Kt },
] as const;

/** FPG p.4: V1 / VR / V2 (KIAS) vs takeoff weight (lb), sea level, ISA, dry. */
export const TAKEOFF_SPEEDS = {
  weightsLb: [7500, 8000, 8500, 9000, 9500, 9900, 10300, 10700],
  flaps15: { v1: [97, 97, 96, 96, 96, 96, 98, 100], vr: [98, 98, 98, 98, 99, 100, 103, 105], v2: [108, 108, 107, 106, 106, 107, 109, 111] },
  flaps0: { v1: [97, 97, 97, 97, 99, 102, 104, 105], vr: [99, 99, 99, 99, 102, 105, 108, 111], v2: [112, 111, 110, 110, 113, 115, 117, 119] },
};

/** FPG pp.26-31: VREF (KIAS), flaps 35, vs landing weight (lb). */
export const VREF = { weightsLb: [7500, 8000, 8500, 8900, 9300, 9500, 9700, 9900], kt: [95, 98, 101, 103, 106, 107, 108, 109] };

/** FPG p.32: stall speeds (KCAS), zero bank, gear up or down. */
export const STALL_KCAS = {
  weightsLb: [7500, 8000, 8500, 9000, 9500, 9900, 10300, 10700],
  flaps35: [73, 75, 77, 79, 81, 83, 85, 86],
  flaps15: [78, 80, 82, 85, 87, 88, 90, 92],
  flaps0: [83, 86, 88, 91, 93, 95, 97, 98],
};

/** FPG p.5: takeoff field length (ft), flaps 15, sea level, dry, zero wind, 15 degC, vs weight. */
export const TOFL_SL_15C = { weightsLb: [7500, 8000, 8500, 9000, 9500, 9900, 10300, 10700], ft: [2490, 2510, 2550, 2610, 2660, 2730, 2960, 3210] };

/** FPG p.22 "High speed cruise" (maximum cruise thrust), ISA: KTAS and total lb/h vs pressure altitude at 9,500 / 10,000 lb. */
export const HIGH_SPEED_CRUISE = [
  { altFt: 25000, w9500: { ktas: 377, pph: 1122 }, w10000: { ktas: 377, pph: 1128 } },
  { altFt: 31000, w9500: { ktas: 403, pph: 1071 }, w10000: { ktas: 402, pph: 1070 } },
  { altFt: 33000, w9500: { ktas: 403, pph: 997 }, w10000: { ktas: 402, pph: 996 } },
  { altFt: 35000, w9500: { ktas: 401, pph: 920 }, w10000: { ktas: 399, pph: 917 } },
  { altFt: 37000, w9500: { ktas: 396, pph: 830 }, w10000: { ktas: 394, pph: 827 } },
  { altFt: 41000, w9500: { ktas: 385, pph: 678 }, w10000: { ktas: 379, pph: 671 } },
];

/** FPG p.21: time / fuel / distance to climb from sea level, ISA, at 10,700 lb. */
export const CLIMB_MTOW = [
  { altFt: 15000, min: 5, lb: 138, nm: 19 },
  { altFt: 25000, min: 9, lb: 242, nm: 41 },
  { altFt: 35000, min: 16, lb: 352, nm: 76 },
  { altFt: 41000, min: 24, lb: 437, nm: 113 },
];

/** Piecewise-linear lookup with clamping. */
export function lookup(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let i = 0;
  while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}
