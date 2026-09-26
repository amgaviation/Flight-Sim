/**
 * Gulfstream G650 (GVI, 2 x Rolls-Royce BR700-725A1-12, Honeywell Primus Epic
 * "PlaneView II"): published numbers shared by the FDM, systems, states,
 * checklists and tests. Every value cites its source; estimates are EST.
 *
 * Source abbreviations used throughout src/aircraft/g650 and the dossier
 * docs/aircraft/g650.md:
 *  - TCDS = EASA Type Certificate Data Sheet IM.A.169 "Gulfstream GVI",
 *           Issue 17 (14 Jul 2026), Section 1 GVI: masses (§13), fuel (§9),
 *           Vmo/Mmo (§10), 51,000 ft (§11), crosswind 28 kt / 10 kt outside
 *           Normal law, tailwind 10 kt (§12.2), datum 100 in forward of the
 *           radome (§15), MAC 4.756 m / 187.24 in (§16), 22 occupants / 19
 *           passengers (§19), tyres (§21).
 *  - LIM  = "G650 / 650ER Selected Limitations & Info", Rev June 2022 (AFM
 *           G650ER rev 12 / G650 rev 21 excerpt, code450.com): airspeeds,
 *           load factors, altitudes, engine table, starter duty, oil, fuel,
 *           APU, RAT, autopilot, gear horn.
 *  - AIN  = M. Thurber / F. George, "Pilot report: Gulfstream G650ER", AIN
 *           Online, Oct 2017: 67,084 lb takeoff, VR 107 / V2 124, 15 min to
 *           FL430, FL450 ISA-7 M0.91 at 1,480 lb/h per engine.
 *  - LUC  = I. Luciani, G650 systems study notes (code450.com/g650):
 *           electrical, flight controls, powerplant, fuel, hydraulics, gear,
 *           APU, pneumatics, air conditioning, pressurization, ice, fire, oxygen.
 *  - SCQ  = SmartCockpit G650 systems quizzes (electrical, flight controls,
 *           hydraulics, landing gear, powerplant, fuel).
 *  - GAC  = Gulfstream G650 / G650ER specification sheets (dimensions: span
 *           99 ft 7 in, length 99 ft 9 in, height 25 ft 8 in, wing area
 *           1,283 ft^2, balanced field length 5,858 ft at MTOW SL ISA, cabin
 *           4,850 ft at FL510).
 *  - TCDSE = UK CAA TCDS UK.TC.E.00082 (BR700-725A1-12): MTO 75.2 kN, MCT
 *           66.6 kN, N1 100 % = 7,000 rpm, N2 100 % = 15,898 rpm.
 */
import { casFromMach, isaPressure } from '../../physics/atmosphere';

export const LB = 0.45359237;
export const LBF = 4.4482216152605;
export const FT = 0.3048;
export const KT = 0.514444;

export const G650_LIMITS = {
  // ---------------- weights (TCDS §13, LIM)
  maxRampLb: 100000,
  mtowLb: 99600,
  mlwLb: 83500,
  mzfwLb: 60500,
  /** EST: basic operating weight ~54,000 lb (Aviation Week G650 overview: "BOW 54,000 lb" typical, 2 crew). */
  bowLb: 54000,
  /** Fuel usable per wing tank (TCDS §9: 22,100 lb / 3,298 US gal at 6.7 lb/gal). */
  tankUsableLb: 22100,
  usableFuelLb: 44200,
  /** EST: unusable fuel per tank (hopper sump), 50 lb. */
  tankUnusableLb: 50,
  maxFuelImbalanceLb: 2000, // LIM enroute
  maxFuelImbalanceTakeoffLb: 1000, // LIM
  lowFuelLb: 650, // LIM: "Low fuel level alert @ 650 lbs" (per hopper, LUC)
  // ---------------- speeds (LIM, TCDS §10)
  vmoKt: 340, // above 8,000 ft
  vmoLowKt: 300, // below 8,000 ft
  vmoChangeFt: 8000,
  mmo: 0.925, // 35,000 - 51,000 ft
  mmoLow: 0.875, // at 29,380 ft (linear to 0.925 at 35,000 ft, LIM)
  mmoLowFt: 29380,
  mmoHighFt: 35000,
  vaKt: 206,
  vfe10Kt: 250,
  vfe20Kt: 220,
  vfe39Kt: 190,
  vleKt: 250,
  vloKt: 225,
  vloAltKt: 175, // alternate (emergency) extension
  vmcaF20Kt: 101.5,
  vmcaF10Kt: 105,
  vmclKt: 100.5,
  vmcgKt: 105,
  maxTireGsKt: 195,
  vHoldMinKt: 160,
  vHoldIcingKt: 180,
  vTurbKt: 270,
  vTurbMach: 0.85,
  degradedKt: 285, // not-Normal law / YD inop / surface failure
  degradedMach: 0.9,
  // ---------------- altitudes (LIM, TCDS §11)
  maxAltFt: 51000,
  maxAltSinglePackFt: 48000,
  maxGearFlaps39AltFt: 20000,
  maxFlaps10_20AltFt: 25000,
  maxAirfieldFt: 15000,
  maxTailwindKt: 10,
  maxCrosswindKt: 28,
  // ---------------- load factors (LIM)
  nzMaxClean: 2.5,
  nzMinClean: -1.0,
  nzMaxFlaps: 2.0,
  nzMinFlaps: 0.0,
  // ---------------- engine BR700-725A1-12 (LIM table, TCDSE)
  takeoffThrustLbf: 16900, // 75.2 kN MTO (TCDSE); LIM: "Rated at 16,100 pounds @ 86 degF (30 degC)"
  flatRatedThrustLbf: 16100,
  flatRatingC: 30,
  mctKn: 66.6,
  n1TakeoffPct: 102.8,
  n1McPct: 102.8,
  n1OverspeedPct: 104.3,
  n2TakeoffPct: 100.0,
  n2McPct: 98.7,
  n2OverspeedPct: 101.3,
  tgtStartGroundC: 700,
  tgtStartAirC: 850,
  tgtTakeoffC: 900, // 5 min
  tgtMctC: 885,
  tgtOvertempC: 920, // 20 s
  tgtMaxBeforeStartC: 150,
  revMaxN1Pct: 78.1, // 30 s
  oilPressMinPsi: 25,
  oilPressCautionPsi: 35,
  oilTempMaxC: 160,
  oilTempMinTakeoffC: 20,
  starterCutoutN2Pct: 42, // LIM "Starter re-engagement - up to starter cut out of 42% (HP)"; LUC ignition off ~42 %
  minStartBleedPsi: 40, // LUC powerplant: minimum bleed air for a start
  // ---------------- APU Honeywell RE220 (LIM)
  apuMaxAltFt: 45000,
  apuEgtStartC: 1050,
  apuEgtRunC: 732,
  apuMaxRpmPct: 106,
  apuGenKva: 40,
  apuFuelPph: 264, // LUC apu
  // ---------------- electrical (LUC, SCQ, LIM)
  idgKva: 40,
  ratKva: 15, // LUC (SCQ quotes 30 kVA)
  ratMinKt: 180, // LIM: "RAT GEN will drop off line < 180 kts"
  truRatedA: 250,
  battAh: 53,
  eBattAh: 10.5,
  upsBattAh: 10.5,
  // ---------------- hydraulics (LUC, LIM)
  hydPsi: 3000,
  hydLowPsi: 1500, // EST from LUC: AUX pump auto-on "L press < 1,500"; PTU output fail < 1,500
  ptuOnPsi: 2400, // LUC: PTU auto ON when L < 2,400 psi
  ptuOffPsi: 2750,
  accPrechargePsi: 1200, // LIM
  // ---------------- pressurization (LIM, LUC, GAC)
  maxDiffPsi: 10.69,
  reliefPsi: 10.8,
  reliefSecondPsi: 11.0,
  maxDiffTaxiPsi: 0.3,
  cabinAtFl510Ft: 4850,
  cabinAtFl410Ft: 3290, // AIN
  paxMaskFt: 14750, // LUC oxygen: 14,750 +/- 250 ft (15,750 HIGH ALT)
  // ---------------- brakes / tyres (LUC, TCDS §21)
  brakeOverheatC: 600,
  tyrePsi: 216,
  // ---------------- oxygen (LUC)
  oxyBottleFt3: 123.4,
  oxyFullPsi: 1800,
} as const;

/**
 * Mmo (indicated) vs pressure altitude: 0.875 at 29,380 ft, linear to 0.925
 * at 35,000 ft and above (LIM). Below 29,380 ft Vmo governs.
 */
export function mmoAt(altFt: number): number {
  const L = G650_LIMITS;
  if (altFt <= L.mmoLowFt) return L.mmoLow;
  if (altFt >= L.mmoHighFt) return L.mmo;
  return L.mmoLow + ((altFt - L.mmoLowFt) / (L.mmoHighFt - L.mmoLowFt)) * (L.mmo - L.mmoLow);
}

/**
 * Vmo/Mmo as one IAS schedule vs pressure altitude (kt): 300 below 8,000 ft,
 * 340 above (LIM); from 29,380 ft the IAS equivalent of the Mmo line (so the
 * Overspeed block's Mach limit, 0.925, only has to cover FL350 and above).
 */
export const VMO_SCHEDULE = (() => {
  const x: number[] = [0, 7999, 8000, 29380];
  const y: number[] = [300, 300, 340, 340];
  for (let ft = 30000; ft <= 51000; ft += 1000) {
    const p = isaPressure(ft * FT);
    const cas = casFromMach(mmoAt(ft), p) / KT;
    x.push(ft);
    y.push(Math.round(Math.min(340, cas) * 10) / 10);
  }
  return { x, y };
})();

/** Flap handle detents: UP / 10 / TO-20 / DOWN 39 (LUC flight controls), VFE (LIM). */
export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP', vfe: 340 },
  { lever: 1, flapDeg: 10, label: '10', vfe: G650_LIMITS.vfe10Kt },
  { lever: 2, flapDeg: 20, label: '20', vfe: G650_LIMITS.vfe20Kt },
  { lever: 3, flapDeg: 39, label: '39', vfe: G650_LIMITS.vfe39Kt },
];

/**
 * 1-g maximum lift coefficients, EST (no public G650 stall-speed chart):
 * derived from the published speeds so that
 *  - flaps 20 at 67,084 lb gives VSR 110 kt -> V2 = 1.13 VSR = 124 kt (AIN: V2 124);
 *  - flaps 39 at MLW 83,500 lb gives VSR 114 kt -> VREF = 1.23 VSR = 140 kt
 *    (LIM example "VREF 140");
 *  - clean 1.05 and flaps 10 1.20: typical increments of a single-slotted
 *    Fowler flap on a 36 deg swept wing without leading-edge devices (GAC).
 */
export const CLMAX = { f0: 1.05, f10: 1.2, f20: 1.28, f39: 1.47 } as const;

/** Wing reference area (GAC: 1,283 ft^2). */
export const WING_AREA_M2 = 1283 * 0.09290304;

/** 1-g stall speed (KCAS, zero thrust) for weight (lb) and CLmax. */
export function vsKcas(weightLb: number, clmax: number): number {
  const w = weightLb * LB * 9.80665;
  return Math.sqrt((2 * w) / (1.225 * WING_AREA_M2 * clmax)) / KT;
}

/**
 * Takeoff speeds, flaps 20 (EST from 14 CFR 25.107 with the CLMAX above):
 * V2 = max(1.13 VSR, 1.10 VMCA 101.5 = 112 kt); VR = max(1.05 VMCA = 107 kt
 * (AIN: VR 107 at 67,084 lb), V2 - 17 kt); V1 = VR - 3 kt (balanced EST).
 */
export function takeoffSpeeds(weightLb: number): { v1: number; vr: number; v2: number } {
  const vsr = vsKcas(weightLb, CLMAX.f20);
  const v2 = Math.max(1.13 * vsr, 1.1 * G650_LIMITS.vmcaF20Kt);
  const vr = Math.max(1.05 * G650_LIMITS.vmcaF20Kt, v2 - 17);
  return { v1: Math.round(vr - 3), vr: Math.round(vr), v2: Math.round(v2) };
}

/** VREF flaps 39 = 1.23 VSR (14 CFR 25.125), not below 1.05 VMCL. */
export function vref(weightLb: number): number {
  return Math.round(Math.max(1.23 * vsKcas(weightLb, CLMAX.f39), 1.05 * G650_LIMITS.vmclKt));
}

/** GAC: balanced field length 5,858 ft at MTOW, sea level, ISA (flaps 20 EST). */
export const TOFL_MTOW_SL_ISA_FT = 5858;

/**
 * AIN G650ER pilot report cruise point: FL450, ISA-7 degC, M0.91, 1,480 lb/h
 * per engine; weight EST 64,500 lb (took off at 67,084 lb, 15 min climb to
 * FL430 ~ 1,600 lb burn, plus the step to FL450).
 */
export const CRUISE_POINT = { altFt: 45000, isaDevC: -7, mach: 0.91, pphPerEngine: 1480, weightLb: 64500 } as const;
/** AIN: 67,084 lb takeoff, climb to FL430 in 15 min. */
export const CLIMB_POINT = { weightLb: 67084, altFt: 43000, minutes: 15 } as const;

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
