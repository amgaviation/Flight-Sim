/**
 * Unit conversion constants and helpers.
 *
 * Physics runs in SI; SimVars carry aviation units (see CLAUDE.md). Every
 * exact constant below is exact by definition of the unit; the rest cite a
 * source.
 *
 * Usage: `const ms = kt * KT_TO_MS;` — multiply by `A_TO_B` to convert A -> B.
 */

// ---------------------------------------------------------------- length
/** International foot (exact, 1959 international yard and pound agreement). */
export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;
/** International nautical mile (exact). */
export const NM_TO_M = 1852;
export const M_TO_NM = 1 / NM_TO_M;
export const IN_TO_M = 0.0254;
export const M_TO_IN = 1 / IN_TO_M;
export const SM_TO_M = 1609.344; // statute mile (exact)
export const KM_TO_NM = 1000 / NM_TO_M;

// ---------------------------------------------------------------- speed
/** Knot = 1852 m per hour (exact). */
export const KT_TO_MS = NM_TO_M / 3600;
export const MS_TO_KT = 1 / KT_TO_MS;
export const FPM_TO_MS = FT_TO_M / 60;
export const MS_TO_FPM = 1 / FPM_TO_MS;
export const KMH_TO_MS = 1 / 3.6;
export const FPS_TO_MS = FT_TO_M;

// ---------------------------------------------------------------- mass / force
/** Avoirdupois pound (exact). */
export const LB_TO_KG = 0.45359237;
export const KG_TO_LB = 1 / LB_TO_KG;
/** Standard gravity (exact, CGPM 1901). */
export const G0 = 9.80665;
/** Pound-force = 1 lb x standard gravity (exact). */
export const LBF_TO_N = LB_TO_KG * G0;
export const N_TO_LBF = 1 / LBF_TO_N;

// ---------------------------------------------------------------- pressure
/** Inch of mercury at 0 degC: 3386.389 Pa (NIST SP 811, Appendix B.8). */
export const INHG_TO_PA = 3386.389;
export const PA_TO_INHG = 1 / INHG_TO_PA;
/** Pound-force per square inch: 6894.757 Pa (NIST SP 811, Appendix B.8). */
export const PSI_TO_PA = 6894.757293168;
export const PA_TO_PSI = 1 / PSI_TO_PA;
export const HPA_TO_PA = 100;
export const PA_TO_HPA = 0.01;
export const INHG_TO_HPA = INHG_TO_PA / 100;
export const HPA_TO_INHG = 1 / INHG_TO_HPA;

// ---------------------------------------------------------------- power / energy / torque
/** Mechanical horsepower = 550 ft·lbf/s = 745.69987 W (NIST SP 811). */
export const HP_TO_W = 745.69987158227;
export const W_TO_HP = 1 / HP_TO_W;
export const FTLB_TO_NM = FT_TO_M * LBF_TO_N;

// ---------------------------------------------------------------- volume / fuel
/** US liquid gallon = 231 in^3 = 3.785411784 L (exact). */
export const USGAL_TO_L = 3.785411784;
export const L_TO_USGAL = 1 / USGAL_TO_L;
export const USGAL_TO_M3 = USGAL_TO_L / 1000;
/**
 * Aviation gasoline (100LL) weight used by light-aircraft POHs: 6.0 lb/US gal
 * (Cessna 172S POH Section 6 fuel weight; FAA-H-8083-1B Weight & Balance
 * Handbook, "Avgas ... 6.0 lb/gal").
 */
export const AVGAS_LB_PER_GAL = 6.0;
export const AVGAS_KG_PER_L = (AVGAS_LB_PER_GAL * LB_TO_KG) / USGAL_TO_L; // ~0.719
/**
 * Jet-A/Jet-A1 planning weight: 6.7 lb/US gal (FAA-H-8083-1B Weight & Balance
 * Handbook, "Jet A ... 6.7 lb/gal"; ~0.803 kg/L at 15 degC per ASTM D1655 range).
 */
export const JETA_LB_PER_GAL = 6.7;
export const JETA_KG_PER_L = (JETA_LB_PER_GAL * LB_TO_KG) / USGAL_TO_L; // ~0.803

// ---------------------------------------------------------------- angles
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

// ---------------------------------------------------------------- temperature
export const ZERO_C_IN_K = 273.15;
export function cToK(c: number): number {
  return c + ZERO_C_IN_K;
}
export function kToC(k: number): number {
  return k - ZERO_C_IN_K;
}
export function cToF(c: number): number {
  return c * 1.8 + 32;
}
export function fToC(f: number): number {
  return (f - 32) / 1.8;
}
export function kToF(k: number): number {
  return cToF(k - ZERO_C_IN_K);
}
export function fToK(f: number): number {
  return fToC(f) + ZERO_C_IN_K;
}
/** Temperature *difference* conversion (degC delta -> degF delta). */
export const DELTA_C_TO_F = 1.8;

// ---------------------------------------------------------------- fuel flow helpers
/** kg/s -> lb/h */
export const KGS_TO_PPH = 3600 * KG_TO_LB;
export const PPH_TO_KGS = 1 / KGS_TO_PPH;
/** Avgas US gal/h -> kg/s */
export const AVGAS_GPH_TO_KGS = (AVGAS_LB_PER_GAL * LB_TO_KG) / 3600;
export const AVGAS_KGS_TO_GPH = 1 / AVGAS_GPH_TO_KGS;
/** Jet-A US gal/h -> kg/s */
export const JETA_GPH_TO_KGS = (JETA_LB_PER_GAL * LB_TO_KG) / 3600;
