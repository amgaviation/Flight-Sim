/**
 * 737-800 (CFM56-7B26, winglets) performance model used by the FMC for
 * reference speeds, ECON speeds, altitude capability and the PFD speed
 * tape limits.
 *
 * All numbers here are estimates (EST): Boeing's FPPM/QRH performance tables
 * are not public. The shapes follow physics (speeds scale with sqrt(weight)
 * at constant CL; buffet margin from a Mach-dependent buffet CL) and the
 * magnitudes are fitted to published pilot-training values for the type
 * (e.g. take-off speeds around 140/142/148 kt at 65 t flaps 5, VREF30 about
 * 145 kt at 60 t), which is the level of accuracy a line pilot would check
 * against. The aircraft may replace any function through `B737Config.perf`.
 */
import { B738_WEIGHTS, B738_WING_AREA_M2 } from './b738';

// ------------------------------------------------------------------------------------ take-off speeds

/** Take-off flap settings with V-speeds: 1, 5, 10, 15, 25 (FCOM take-off flaps). */
export const TAKEOFF_FLAPS = [1, 5, 10, 15, 25] as const;

const TO_WT_T = [40, 45, 50, 55, 60, 65, 70, 75, 80];
// EST: flaps 5, dry runway, sea level ISA, 26K: V1 / VR / V2 (kt).
const TO_V1 = [106, 112, 119, 126, 132, 138, 144, 149, 154];
const TO_VR = [107, 114, 121, 128, 134, 140, 146, 151, 157];
const TO_V2 = [120, 125, 131, 136, 142, 147, 152, 156, 161];
/** EST flap corrections relative to flaps 5 (kt): fewer flaps = faster. */
const TO_FLAP_DELTA: Record<number, number> = { 1: 7, 5: 0, 10: -3, 15: -6, 25: -9 };

function lerp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0] + ((ys[1] - ys[0]) / (xs[1] - xs[0])) * (x - xs[0]);
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  const n = xs.length - 1;
  return ys[n] + ((ys[n] - ys[n - 1]) / (xs[n] - xs[n - 1])) * (x - xs[n]);
}

export interface TakeoffSpeeds {
  v1: number;
  vr: number;
  v2: number;
}

/**
 * EST take-off speeds (kt, rounded) for weight (kg), flaps, pressure altitude
 * (ft) and OAT (°C). Density altitude raises the true speeds but the KIAS
 * values only rise slightly (VMCG/VMU effects): +1 kt per 2,000 ft of pressure
 * altitude and +1 kt per 10 °C above ISA (EST).
 */
export function takeoffSpeeds(weightKg: number, flaps: number, altFt = 0, oatC = 15): TakeoffSpeeds | null {
  const d = TO_FLAP_DELTA[flaps];
  if (d === undefined || !(weightKg > 30000)) return null;
  const t = weightKg / 1000;
  const isaDev = oatC - Math.max(-56.5, 15 - 0.0019812 * altFt);
  const env = altFt / 2000 + Math.max(0, isaDev) / 10;
  const v1 = Math.round(lerp(TO_WT_T, TO_V1, t) + d + env);
  const vr = Math.max(v1, Math.round(lerp(TO_WT_T, TO_VR, t) + d + env));
  const v2 = Math.max(vr + 4, Math.round(lerp(TO_WT_T, TO_V2, t) + d + env));
  return { v1, vr, v2 };
}

/**
 * EST take-off stabilizer trim (units) from CG (% MAC), flaps and weight:
 * nose-heavy (forward CG) needs more nose-up trim. Fitted to the typical
 * 737-800 range of about 3-8 units over 8-33 % MAC.
 */
export function takeoffTrimUnits(cgPctMac: number, flaps: number, weightKg: number): number {
  const base = 8.8 - 0.2 * cgPctMac;
  const flapAdj = flaps >= 15 ? -0.25 : flaps <= 1 ? 0.25 : 0;
  const wtAdj = (weightKg - 65000) / 20000 * 0.5;
  return Math.max(0.25, Math.min(8.5, Math.round((base + flapAdj + wtAdj) * 4) / 4));
}

// ------------------------------------------------------------------------------------ landing speeds

/** Landing flaps shown on APPROACH REF with their VREF at 60 t (kt), EST. */
const VREF_60T: Record<number, number> = { 15: 155, 30: 145, 40: 138 };
export const APPROACH_FLAPS = [15, 30, 40] as const;

/** EST VREF (kt) for landing flaps at a landing weight: VREF ∝ sqrt(W) (constant CL at 1.23 VS). */
export function vref(weightKg: number, flaps: number): number {
  const v60 = VREF_60T[flaps];
  if (v60 === undefined || !(weightKg > 30000)) return NaN;
  return Math.round(v60 * Math.sqrt(weightKg / 60000));
}

// ------------------------------------------------------------------------------------ ECON speeds

export interface EconSpeeds {
  climbKt: number;
  climbMach: number;
  cruiseMach: number;
  cruiseKt: number;
  descentKt: number;
  descentMach: number;
}

/**
 * EST ECON speeds from the cost index (0-500, NG range per b737.org.uk FMC
 * page) and gross weight. CI 0 = maximum range, max CI = Vmo/Mmo in climb
 * and cruise, descent limited to 330 kt (b737.org.uk FMC page).
 */
export function econSpeeds(costIndex: number, weightKg: number, crzAltFt: number): EconSpeeds {
  const ci = Math.max(0, Math.min(500, costIndex));
  const f = Math.sqrt(ci / 500); // speeds respond strongly to low CI values
  const w = (weightKg - 65000) / 15000; // heavier = faster for max range
  const climbKt = Math.round(Math.min(340, 270 + 60 * f + 6 * w));
  const climbMach = Math.round(Math.min(0.82, 0.755 + 0.06 * f + 0.005 * w) * 1000) / 1000;
  let cruiseMach = 0.765 + 0.05 * f + 0.008 * w - Math.max(0, (37000 - crzAltFt) / 100000) * 0.1;
  cruiseMach = Math.round(Math.max(0.7, Math.min(0.82, cruiseMach)) * 1000) / 1000;
  const cruiseKt = Math.round(Math.min(340, 280 + 55 * f));
  const descentKt = Math.round(Math.min(330, 250 + 80 * f));
  const descentMach = Math.round(Math.min(0.82, 0.76 + 0.05 * f) * 1000) / 1000;
  return { climbKt, climbMach, cruiseMach, cruiseKt, descentKt, descentMach };
}

/** EST long-range cruise Mach (99 % of max range speed, b737.org.uk FMC page) vs weight and altitude. */
export function lrcMach(weightKg: number, altFt: number): number {
  const w = (weightKg - 65000) / 15000;
  return Math.round(Math.max(0.7, Math.min(0.8, 0.772 + 0.012 * w - Math.max(0, 35000 - altFt) / 200000)) * 1000) / 1000;
}

/** EST MAX RATE / MAX ANGLE climb speeds (kt): about 1.5 x / 1.3 x the clean stall speed. */
export function maxRateClimbKt(weightKg: number): number {
  return Math.round(265 * Math.sqrt(weightKg / 65000));
}
export function maxAngleClimbKt(weightKg: number): number {
  return Math.round(215 * Math.sqrt(weightKg / 65000));
}

// ------------------------------------------------------------------------------------ altitude capability

/** EST optimum altitude (ft, rounded to 100) vs gross weight: ~FL360 at 60 t, FL340 at 70 t. */
export function optimumAltitudeFt(weightKg: number): number {
  const fl = 470 - 1.8 * (weightKg / 1000);
  return Math.round(Math.max(250, Math.min(410, fl))) * 100;
}

/** EST maximum altitude (1.3 g buffet margin, thrust limited): OPT + 2,000 ft, capped at the certified FL410. */
export function maximumAltitudeFt(weightKg: number): number {
  return Math.min(41000, optimumAltitudeFt(weightKg) + 2000);
}

// ------------------------------------------------------------------------------------ buffet / maneuver margins

/** EST 737-800 buffet onset lift coefficient vs Mach (clean wing). */
const BUFFET_M = [0.4, 0.6, 0.7, 0.74, 0.78, 0.8, 0.82, 0.86];
const BUFFET_CL = [0.86, 0.76, 0.68, 0.64, 0.58, 0.54, 0.49, 0.38];

export function buffetCl(mach: number): number {
  return lerp(BUFFET_M, BUFFET_CL, mach);
}

/**
 * Speed (Mach) above which a 1.3 g pull reaches high-speed buffet (the top
 * amber "maximum maneuver" bar, FCOM: 0.3 g margin to buffet;
 * b737.org.uk Flight Instruments). Returns NaN when no such Mach below 0.9.
 * `staticPressPa` from the pressure altitude, weight in kg.
 */
export function maxManeuverMach(weightKg: number, staticPressPa: number, g = 1.3): number {
  const lift = weightKg * 9.80665 * g;
  // Find the highest Mach where q·S·CLb(M) >= lift, searching down from 0.9.
  for (let m = 0.9; m >= 0.5; m -= 0.005) {
    const q = 0.7 * staticPressPa * m * m;
    if (q * B738_WING_AREA_M2 * buffetCl(m) >= lift) return m;
  }
  return NaN;
}

/** Pressure (Pa) at a pressure altitude (ISA). */
export function pressureAtAltPa(altFt: number): number {
  const h = altFt * 0.3048;
  if (h <= 11000) return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return 22632 * Math.exp(-(h - 11000) / 6341.62);
}

/** Default gross weight (kg) used before PERF INIT: OEW + typical payload + fuel (EST). */
export const DEFAULT_GW_KG = B738_WEIGHTS.operatingEmptyKg + 14000;

// ------------------------------------------------------------------------------------ CAS / Mach

const A0_KT = 661.4786; // ISA sea-level speed of sound (kt)
const P0_PA = 101325;

/** Mach for a calibrated airspeed (kt) at a pressure altitude (ft), ISA (subsonic compressible flow). */
export function machFromCas(casKt: number, altFt: number): number {
  const qc = P0_PA * (Math.pow(1 + 0.2 * (casKt / A0_KT) ** 2, 3.5) - 1);
  const p = pressureAtAltPa(altFt);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
}

/** Calibrated airspeed (kt) for a Mach number at a pressure altitude (ft), ISA. */
export function casFromMach(mach: number, altFt: number): number {
  const p = pressureAtAltPa(altFt);
  const qc = p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  return A0_KT * Math.sqrt(5 * (Math.pow(qc / P0_PA + 1, 2 / 7) - 1));
}

/**
 * IAS/Mach crossover altitude (ft) of a speed schedule: the altitude where
 * `casKt` equals `mach` (bisection over 0-45,000 ft). Above it the FMC
 * targets the Mach number.
 */
export function crossoverAltFt(casKt: number, mach: number): number {
  if (!(casKt > 0) || !(mach > 0)) return 45000;
  let lo = 0;
  let hi = 45000;
  if (machFromCas(casKt, lo) >= mach) return 0;
  if (machFromCas(casKt, hi) < mach) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (machFromCas(casKt, mid) < mach) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}
