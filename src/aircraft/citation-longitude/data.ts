/**
 * Cessna Citation Longitude (Model 700, Honeywell HTF7700L, Garmin G5000):
 * published numbers shared by the FDM, systems, states, checklists, TOLD and
 * tests. Every value cites its source; estimates are marked EST.
 *
 * Source abbreviations used throughout src/aircraft/citation-longitude:
 *  - FPG  = Textron Aviation "Citation Longitude Flight Planning Guide",
 *           FPG-JET-700-1019 (Oct 2019, revisions FM-00 / PP-00, "developed from
 *           the Citation Longitude AFM and Electronic Operating Manual"):
 *           specifications p.2-3, V1/VR/V2 p.4, takeoff field lengths p.5-14,
 *           climb p.15-16, cruise p.17-19, descent p.20, holding p.21,
 *           landing p.22-26 (VREF), stall speeds p.26.
 *  - OG   = "Cessna Citation Longitude Model 700 Operators Guide" (Working
 *           Title / Asobo, MSFS 2020, based on Textron data): Section 1
 *           Operating Limitations, Sections 3-17 systems, CAS list, normal
 *           procedures.
 *  - BCA  = J. Albright, "Pilot Report: Cessna Citation Longitude", Business &
 *           Commercial Aviation, March 2021 (flight at 32,965 lb: V1 107 / VR 113 /
 *           V2 125, VREF 118-120, 9.66 psid, nose-wheel steering 7.5 deg pedals /
 *           80-81 deg tiller, reverse schedule 85->45 kt, ground spoilers stow
 *           at 30 kt, stick shaker AND pusher, EDM).
 *  - AOPA = "Citation Longitude: Super-mid standout", AOPA Pilot, March 2021
 *           (M0.84 = 469 KTAS at FL400, 940 pph/side, VAPP 131 / VREF 119).
 *  - AW   = Aviation Week "Aircraft Overview: Cessna Citation Longitude"
 *           (TCDS summary: HTF7700L = AS907-2-1S, 7,665 lbf, 2,166 gal usable in two
 *           1,083 gal wing tanks, Mmo 0.84 above 29,375 ft, FL450, 13 seats).
 *  - WIKI = Wikipedia "Cessna Citation Longitude" (wing area 537 ft^2, quarter-
 *           chord sweep 26.8 deg inner / 28.6 deg outer).
 * See docs/aircraft/citation-longitude.md for the full dossier.
 */

export const LB = 0.45359237;
export const LBF = 4.4482216152605;
export const FT = 0.3048;

export const LON_LIMITS = {
  // --- weights (FPG p.3; OG 1-1 lists MZFW 26,800 lb for a later mod status, FPG 26,000 lb)
  maxRampLb: 39700,
  mtowLb: 39500,
  mlwLb: 33500,
  mzfwLb: 26800, // OG 1-1 (FPG p.3: 26,000 lb); the higher value is used by the G5000 W&F page
  emptyLb: 23200, // FPG p.3: typically-equipped empty weight
  bowLb: 23600, // FPG p.3: BOW incl. 2 crew & stores 400 lb
  usableFuelLb: 14500, // FPG p.3 (6.7 lb/gal); AW: 14,511 lb / 2,166 gal
  tankUsableLb: 7250, // FPG / 2 (AW: 1,083 gal per wing tank)
  maxFuelImbalanceLb: 500, // OG 1-3
  minRvsmWeightLb: 24400, // OG 1-3
  // --- speeds (OG 1-3/1-4, FPG p.3)
  mmo: 0.84, // indicated, above 29,375 ft
  vmoKt: 325, // 8,000 - 29,375 ft
  vmoSlKt: 290, // linear 290 KIAS at SL -> 305 KIAS at 8,000 ft
  vmo8000Kt: 305,
  vmoMmoChangeFt: 29375,
  vfe1Kt: 250, // flaps 1 (7 deg)
  vfe2Kt: 230, // flaps 2 (15 deg)
  vfeFullKt: 180, // flaps FULL (35 deg)
  vleKt: 230,
  vloKt: 230,
  maxTireGsKt: 195,
  vmcaF1Kt: 100, // FPG p.3
  vmcaF2Kt: 96,
  minRvsmIasKt: 190,
  maxFlapGearAltFt: 18000, // OG 1-2
  // maneuvering speed (OG 1-4)
  va: { weightsLb: [22400, 39500], groundKt: [156, 222], fl250Kt: [164, 241], fl450Kt: [178, 264] },
  // --- altitudes
  maxAltFt: 45000, // OG 1-2
  maxTakeoffLandingAltFt: 14000, // OG 1-1
  maxTailwindKt: 10, // OG 1-1
  // --- load factors (OG 1-4)
  nzMaxClean: 2.6,
  nzMinClean: -1.0,
  nzMaxFlaps: 2.0,
  nzMinFlaps: 0.0,
  maxLandingSinkFpm: 600, // OG 1-4
  // --- engine limits HTF7700L (OG 1-3)
  n1TakeoffPct: 96.79, // TO / APR, 5 min (10 min OEI)
  n2TakeoffPct: 98.62,
  n2TransientPct: 99.9, // 20 s
  ittTakeoffC: 955,
  n1ClbPct: 96.49, // CLB continuous
  n2ClbPct: 98.22,
  ittClbC: 950,
  ittStartC: 650,
  minStartPsi: 32, // EIS start pressure, OG 1-3
  maxStartTailwindKt: 16,
  flatRatingC: 34, // FPG p.2: flat rated to 93 degF / 34 degC (OG: ISA+18.9)
  takeoffThrustLbf: 7665, // FPG p.2, AW (TCDS)
  // --- APU Honeywell 36-150 (OG 1-5, 8-2)
  apuMaxGroundStartFt: 13500,
  apuMaxAirStartFt: 31000,
  apuMaxOpFt: 35000,
  // --- electrical (OG 5-2/5-3)
  battNominalV: 26.4, // Li-ion, 44 Ah (optional battery modelled by OG)
  battAh: 44,
  stbyBattV: 24, // 10.4 Ah lead-acid
  stbyBattAh: 10.4,
  genGroundA: 400, // engine generator: 400 A ground, 500 A in flight
  genFlightA: 500,
  apuGenGroundA: 500, // APU generator: 500 A ground, 400 A in flight
  apuGenFlightA: 400,
  ptcuGenA: 200,
  battMinStartTempC: -20, // OG 1-5
  battOtempCautionC: 63, // OG CAS
  battOtempWarnC: 71,
  // --- hydraulics (OG 13-2)
  hydPsi: 3000,
  hydOtempC: 135,
  // --- pressurization (FPG p.2, OG 11-2/11-3, BCA)
  maxDiffPsi: 9.66,
  cabinDeltaPWarnPsi: 10.2,
  cabinAltAt45kFt: 5950,
  slCabinToFt: 26816,
  cabinAltCautionFt: 8500,
  cabinAltWarnFt: 9800,
  // --- ice (OG 1-5)
  wingAiMaxTempC: 15,
  // --- brakes (OG CAS)
  brakeTempCautionC: 450,
} as const;

/** Vmo (KIAS) vs pressure altitude (OG 1-4): 290 at SL, linear to 305 at 8,000 ft, then 325. */
export const VMO_SCHEDULE = { x: [0, 8000, 8000.1, 29375, 45000], y: [290, 305, 325, 325, 325] };

/** FPG p.4: V1 / VR / V2 (KIAS), SL ISA dry, vs takeoff weight (lb). */
export const TAKEOFF_SPEEDS = {
  weightsLb: [25500, 29500, 31500, 34500, 36500, 37500, 38500, 39500],
  flaps2: { v1: [90, 98, 103, 110, 115, 118, 121, 123], vr: [100, 106, 110, 115, 120, 122, 124, 126], v2: [117, 120, 123, 128, 131, 133, 134, 136] },
  flaps1: { v1: [96, 101, 107, 115, 121, 123, 126, 128], vr: [105, 107, 112, 119, 123, 126, 128, 130], v2: [123, 123, 127, 133, 137, 138, 140, 142] },
};

/** FPG p.5: takeoff field length (ft), flaps 2, sea level, 15 degC, vs weight (same weights as TAKEOFF_SPEEDS). */
export const TOFL_SL_ISA_F2_FT = [2430, 2890, 3230, 3740, 4140, 4360, 4580, 4810];

/** FPG p.22: VREF (KIAS, flaps FULL) vs landing weight (lb). */
export const VREF = { weightsLb: [23500, 24500, 25500, 26500, 27500, 29500, 31500, 33500], kt: [104, 106, 108, 110, 112, 116, 121, 125] };
/** FPG p.22: landing distance from 50 ft (ft), SL 15 degC, flaps FULL, dry. */
export const LDG_DIST_SL_ISA_FT = [2390, 2470, 2540, 2610, 2690, 2840, 3010, 3170];

/** FPG p.26: 1-g stall speeds (KCAS), zero bank, gear up or down, vs weight (lb). */
export const STALL_KCAS = {
  weightsLb: [23500, 24500, 25500, 26500, 27500, 29500, 31500, 33500],
  full: [84, 86, 88, 90, 91, 94, 98, 102],
  f2: [92, 94, 96, 98, 99, 103, 107, 111],
  f1: [96, 98, 100, 102, 104, 108, 112, 116],
  up: [107, 109, 111, 114, 116, 120, 125, 129],
};

/** FPG p.17-19: selected ISA cruise points (total fuel flow, lb/h) used for calibration and tests. */
export const CRUISE_POINTS = [
  { name: 'M0.80 FL410 36,000 lb', altFt: 41000, weightLb: 36000, mach: 0.8, ktas: 457, pph: 1807 },
  { name: 'M0.80 FL450 32,000 lb', altFt: 45000, weightLb: 32000, mach: 0.8, ktas: 457, pph: 1573 },
  { name: 'M0.82 FL390 34,000 lb', altFt: 39000, weightLb: 34000, mach: 0.82, ktas: 469, pph: 1921 },
  { name: 'MMO FL350 36,000 lb', altFt: 35000, weightLb: 36000, mach: 0.84, ktas: 483, pph: 2420 },
  { name: 'M0.80 FL310 34,000 lb', altFt: 31000, weightLb: 34000, mach: 0.8, ktas: 468, pph: 2363 },
] as const;

/** FPG p.17: maximum cruise thrust speed (KTAS) where thrust (not Mmo) limits. */
export const MAX_CRUISE_POINTS = [
  { altFt: 41000, weightLb: 39000, ktas: 476, pph: 2119 },
  { altFt: 43000, weightLb: 36000, ktas: 473, pph: 1904 },
  { altFt: 45000, weightLb: 32000, ktas: 473, pph: 1712 },
] as const;

/** FPG p.16: max-rate climb 270 KIAS / M0.76, ISA, time to altitude (min) from sea level. */
export const CLIMB_TIME_MIN = { weightsLb: [26000, 30000, 33000, 36000, 38000, 39500], fl350: [7, 8, 9, 10, 11, 12], fl410: [9, 11, 13, 14, 16, 17] };

/** FPG p.21: holding (KIAS, lb/h total) at 5,000 ft vs weight. */
export const HOLDING = { weightsLb: [24000, 27000, 30000, 33000, 36000, 38000], kias: [160, 160, 170, 179, 188, 194], pph5000: [1193, 1245, 1352, 1459, 1568, 1642] };

/** Flap detents: OG 15-5 and BCA (1 = 7 deg, 2 = 15 deg, FULL = 35 deg). */
export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP', vfe: 325 },
  { lever: 1, flapDeg: 7, label: '1', vfe: LON_LIMITS.vfe1Kt },
  { lever: 2, flapDeg: 15, label: '2', vfe: LON_LIMITS.vfe2Kt },
  { lever: 3, flapDeg: 35, label: 'FULL', vfe: LON_LIMITS.vfeFullKt },
];

export function interpTable(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}
