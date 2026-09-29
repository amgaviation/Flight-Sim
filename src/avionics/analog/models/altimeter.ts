/**
 * Sensitive altimeter math: pressure altitude from static pressure,
 * indicated altitude for a Kollsman (baro) setting, three-pointer angles
 * and the Kollsman drum.
 *
 * Pressure altitude uses the ISA troposphere relation (ICAO Doc 7488;
 * NOAA/NWS pressure-altitude formula):
 *     h = 145366.45 ft * (1 - (p / 29.92126 inHg)^0.190263)
 * (0.190263 = R L / (g M) for the ISA lapse rate 6.5 K/km). An altimeter
 * set to K reads the pressure altitude difference h(p_static) - h(K).
 */

export const ISA_SL_INHG = 29.92126;
const H_SCALE_FT = 145366.45;
const EXPONENT = 0.190263;

/** ISA pressure altitude (ft) for a static pressure (inHg). */
export function pressureAltitudeFt(pInHg: number): number {
  return H_SCALE_FT * (1 - Math.pow(pInHg / ISA_SL_INHG, EXPONENT));
}

/** Static pressure (inHg) for an ISA pressure altitude (ft) (inverse of pressureAltitudeFt). */
export function pressureAtAltitudeInHg(paFt: number): number {
  return ISA_SL_INHG * Math.pow(1 - paFt / H_SCALE_FT, 1 / EXPONENT);
}

/** Indicated altitude (ft) for pressure altitude `paFt` with the Kollsman window set to `kollsmanInHg`. */
export function indicatedAltitudeFt(paFt: number, kollsmanInHg: number): number {
  return paFt - pressureAltitudeFt(kollsmanInHg);
}

/** Pointer angles (deg clockwise from 12 o'clock) of a three-pointer altimeter. */
export interface AltimeterPointers {
  /** Long pointer: one revolution per 1,000 ft. */
  hundreds: number;
  /** Short wide pointer: one revolution per 10,000 ft. */
  thousands: number;
  /** Thin pointer with the triangular tip: one revolution per 100,000 ft. */
  tenThousands: number;
}

export function altimeterPointers(altFt: number, out: AltimeterPointers): AltimeterPointers {
  out.hundreds = (altFt / 1000) * 360;
  out.thousands = (altFt / 10000) * 360;
  out.tenThousands = (altFt / 100000) * 360;
  return out;
}

/**
 * Kollsman setting range of a typical light-aircraft sensitive altimeter
 * (United Instruments 5934 series: 28.1-31.0 inHg / 946-1050 mb).
 */
export const KOLLSMAN_MIN_INHG = 28.1;
export const KOLLSMAN_MAX_INHG = 31.0;

/** mb (hPa) per inHg (NIST SP 811: 1 inHg = 33.8639 hPa). */
export const HPA_PER_INHG = 33.86389;

/**
 * Drum rotation (deg) that brings `inHg` under the right-hand (3 o'clock)
 * window. The drum scale runs `degPerInHg` degrees per inHg; the mb scale
 * is printed 180 deg away so the left window shows the same setting in mb.
 */
export function kollsmanDrumAngle(inHg: number, degPerInHg: number): number {
  return (inHg - ISA_SL_INHG) * degPerInHg;
}
