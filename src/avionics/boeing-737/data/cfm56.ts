/**
 * CFM56-7B display limits and an N1-limit model for the 737NG engine
 * displays and FMC N1 LIMIT page.
 *
 * Sources:
 *  [E004]  EASA TCDS E.004 (CFM56-7B series), Issue 07, 9 Jan 2023:
 *          N1 max 5,382 rpm = 104 % (100 % = 5,175 rpm), N2 max 15,183 rpm =
 *          105 % (100 % = 14,460 rpm); displayed EGT: take-off 950 °C
 *          (5 min), maximum continuous 925 °C, starting 725 °C; oil
 *          temperature maximum continuous 140 °C above idle, transitory
 *          155 °C (45 min); minimum oil pressure 90 kPa (13 psi); take-off
 *          thrust -7B26 11,699 daN (26,300 lbf).
 *  [LIM]   SmartCockpit "B737NG Generic Limitations": minimum oil pressure
 *          13 psi (red), "above yellow arc" for take-off; oil quantity
 *          prior to start 60 %.
 *  [ENG]   b737.org.uk "Powerplant": oil pressure red line 13 psi valid at
 *          all times; LOW OIL PRESSURE alert at or below the red line.
 */

export interface GaugeLimits {
  min: number;
  max: number;
  /** Amber (caution) threshold; NaN = none. */
  amber: number;
  /** Red line; NaN = none. */
  red: number;
}

/** N1 (%): dial 0-110 %, red line 104 %. [E004] */
export const CFM56_N1: GaugeLimits = { min: 0, max: 110, amber: NaN, red: 104 };
/** N2 (%): red line 105 %. [E004] */
export const CFM56_N2: GaugeLimits = { min: 0, max: 110, amber: NaN, red: 105 };
/**
 * EGT (°C): amber at the maximum continuous 925 °C, red line 950 °C (take-off
 * limit); start limit red line 725 °C shown while starting. [E004]
 */
export const CFM56_EGT: GaugeLimits & { startRed: number; dialMax: number } = { min: 0, max: 1100, amber: 925, red: 950, startRed: 725, dialMax: 1100 };
/** Oil pressure (psi): red line 13 psi [E004][ENG]; amber band 13-26 psi (EST: typical NG amber band width). */
export const CFM56_OIL_PRESS: GaugeLimits & { amberHigh: number } = { min: 0, max: 100, amber: 26, amberHigh: 26, red: 13 };
/** Oil temperature (°C): amber band from 140 (max continuous), red line 155 (transitory limit). [E004] */
export const CFM56_OIL_TEMP: GaugeLimits = { min: 0, max: 200, amber: 140, red: 155 };
/** Airborne vibration monitor (scalar units 0-5): high vibration (amber) at 4.0 units (FCOM 7.10 "Vibration Indication"; EST value). */
export const CFM56_VIB: GaugeLimits = { min: 0, max: 5, amber: 4, red: NaN };
/**
 * Oil quantity display: US quarts, EST full level 21 qt with a low-quantity
 * indication below 4 qt (PMDG/AVSIM forum summaries of the NG FCOM; EST).
 */
export const CFM56_OIL_QTY = { fullQt: 21, lowQt: 4 } as const;

/** 100 % N1 / N2 rotor speeds (rpm). [E004] */
export const CFM56_RPM_100 = { n1: 5175, n2: 14460 } as const;

// ------------------------------------------------------------------------------------------ N1 limits

/** N1 limit ratings shown on the FMC N1 LIMIT page / thrust mode display. */
export type N1Rating = 'TO' | 'TO-1' | 'TO-2' | 'CLB' | 'CLB-1' | 'CLB-2' | 'CRZ' | 'CON' | 'GA';

/**
 * EST N1-limit model (used when the aircraft's ThrustRatingComputer does not
 * publish a rating, and exported as a starting point for aircraft tables).
 *
 * Reasoning: a flat-rated turbofan holds constant corrected fan speed up to
 * its flat-rate temperature (ISA+15 °C for the -7B, i.e. 30 °C at sea level),
 * so physical N1 = N1c · sqrt(T/288.15) rises with ambient temperature until
 * the flat-rate corner, and falls slowly above it (EGT limited). The corrected
 * speeds per altitude are fitted to published 737NG QRH-style values (take-off
 * about 98-99 % at sea level/15 °C for the 26K rating, climb ~92-95 %,
 * cruise ~2-3 % below climb). Derates: 24K and 22K about 2.3 and 4.8 N1
 * points below 26K (thrust scales roughly with N1^3.5 near the top, EST).
 * These are estimates, not certified data.
 */
const ALT_FT = [0, 2000, 4000, 6000, 8000, 10000, 20000, 30000, 35000, 41000];
const TO_N1C = [98.2, 99.0, 99.8, 100.5, 101.1, 101.6, 101.6, 101.6, 101.6, 101.6];
const CLB_N1C = [92.0, 92.3, 92.6, 92.9, 93.2, 93.5, 94.6, 95.8, 96.5, 96.8];
const DERATE_POINTS: Record<string, number> = { TO: 0, 'TO-1': 2.3, 'TO-2': 4.8, CLB: 0, 'CLB-1': 3.0, 'CLB-2': 5.5 };

function lerpTable(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

/** ISA temperature (°C) at a pressure altitude (troposphere / isothermal above 36,089 ft). */
export function isaTempC(altFt: number): number {
  return Math.max(-56.5, 15 - 0.0019812 * altFt);
}

/**
 * EST N1 limit (%) for a rating at pressure altitude `altFt`, outside air
 * temperature `oatC` and optional assumed temperature (take-off ratings only).
 */
export function estimateN1Limit(rating: N1Rating, altFt: number, oatC: number, assumedC = -99): number {
  const flatC = isaTempC(altFt) + 15;
  let t = oatC;
  const takeoff = rating === 'TO' || rating === 'TO-1' || rating === 'TO-2';
  if (takeoff && assumedC > oatC) t = assumedC;
  let n1c: number;
  switch (rating) {
    case 'TO':
    case 'TO-1':
    case 'TO-2':
      n1c = lerpTable(ALT_FT, TO_N1C, altFt);
      break;
    case 'GA':
      n1c = lerpTable(ALT_FT, TO_N1C, altFt) - 0.4;
      break;
    case 'CON':
      n1c = (lerpTable(ALT_FT, TO_N1C, altFt) + lerpTable(ALT_FT, CLB_N1C, altFt)) / 2 + 0.6;
      break;
    case 'CRZ':
      n1c = lerpTable(ALT_FT, CLB_N1C, altFt) - 2.4;
      break;
    default:
      n1c = lerpTable(ALT_FT, CLB_N1C, altFt);
  }
  const tk = Math.min(t, flatC) + 273.15;
  let n1 = n1c * Math.sqrt(tk / (isaTempC(altFt) + 273.15));
  if (t > flatC) n1 -= 0.12 * (t - flatC); // EGT-limited above the flat-rate corner (EST slope)
  n1 -= DERATE_POINTS[rating] ?? 0;
  return Math.min(CFM56_N1.red, Math.max(20, n1));
}

/** Rated thrust labels for the take-off derates of a 26K engine (FMC N1 LIMIT page). */
export const CFM56_7B26_DERATES = { 'TO': '26K', 'TO-1': '24K', 'TO-2': '22K' } as const;
