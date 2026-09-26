/**
 * True-airspeed ring of an airspeed indicator (172S POH §7 "Airspeed
 * Indicator": "rotate the lower left knob until pressure altitude aligns
 * with outside air temperature in the twelve o'clock window. True airspeed
 * ... can now be read in the lower window").
 *
 * It is a circular slide rule. With the ring rotated by rho, the TAS
 * factor it represents is k = TAS/IAS (= sqrt(rho0/rho) for small
 * compressibility). Choosing
 *   - the ring rotation              rho_ring = -S ln k
 *   - pressure-altitude marks on the ring at   +0.5 S ln(p0 / p(PA))
 *   - fixed OAT marks on the dial at            -0.5 S ln(T / T0)
 * makes "PA mark over OAT mark" equivalent to k^2 = (p0/p)(T/T0) = rho0/rho,
 * i.e. the correct TAS factor. TAS marks printed on the ring at the dial
 * angle of their own speed then read TAS under the needle when the dial is
 * locally logarithmic; S = v a'(v) at a reference speed makes it exact
 * there and close nearby (as on the real instrument).
 */
import { pressureAtAltitudeInHg, ISA_SL_INHG } from './altimeter';

export const ISA_T0_K = 288.15;

/** Density ratio sigma = rho/rho0 for pressure altitude (ft) and OAT (deg C). */
export function densityRatio(paFt: number, oatC: number): number {
  const pr = pressureAtAltitudeInHg(paFt) / ISA_SL_INHG;
  return pr / ((oatC + 273.15) / ISA_T0_K);
}

/** TAS/IAS factor (incompressible): 1/sqrt(sigma). */
export function tasFactor(paFt: number, oatC: number): number {
  return 1 / Math.sqrt(densityRatio(paFt, oatC));
}

/** Ring rotation (deg, clockwise) for factor k with scale S (deg per unit ln). */
export function ringRotationDeg(k: number, scaleDeg: number): number {
  return -scaleDeg * Math.log(k);
}

/** Ring-relative angle (deg) of a pressure-altitude mark. */
export function paMarkDeg(paFt: number, scaleDeg: number): number {
  return 0.5 * scaleDeg * Math.log(ISA_SL_INHG / pressureAtAltitudeInHg(paFt));
}

/** Dial angle (deg) of a fixed OAT mark. */
export function oatMarkDeg(oatC: number, scaleDeg: number): number {
  return -0.5 * scaleDeg * Math.log((oatC + 273.15) / ISA_T0_K);
}

/** TAS factor k indicated when PA mark `paFt` is aligned with OAT mark `oatC` (inverse check of the design). */
export function alignedFactor(paFt: number, oatC: number, scaleDeg: number): number {
  // rho_ring + paMark = oatMark  =>  -S ln k = oatMark - paMark
  return Math.exp(-(oatMarkDeg(oatC, scaleDeg) - paMarkDeg(paFt, scaleDeg)) / scaleDeg);
}
