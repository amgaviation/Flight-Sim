/**
 * GPS CDI and glidepath scaling.
 *
 * Lateral full-scale deflection (one side), TSO-C146 / Garmin:
 *   ENR 2.0 nm, TERM 1.0 nm within 31 nm of the destination (AIM 1-1-17:
 *   the approach arms 30 nm from the airport and terminal sensitivity is
 *   +/-1 nm; Garmin switches at 31 nm), DPRT 1.0 nm within 30 nm of the
 *   departure airport, APR ramps 1.0 -> 0.3 nm over the 2 nm before the FAF
 *   (AIM 1-1-17), MAPR 1.0 nm after missed approach activation (AIM 1-1-17:
 *   terminal sensitivity). OCN 4.0 nm (EST: Garmin oceanic scale).
 * LPV / LNAV/VNAV final (AIM 1-1-18 c.3.b, Garmin GNS 530W guide): angular,
 * the course is `courseWidth` (usually 350 ft = 700 ft total) wide at the
 * threshold and splays from the GNSS azimuth reference point (GARP, 305 m
 * beyond the flight path alignment point); limited to 0.3 nm far out and
 * becoming linear (constant) at the threshold.
 * Vertical (RTCA DO-229, as summarised in public training material):
 *   full scale = +/-0.25 x glidepath angle, limited to 45 m near the runway
 *   and 150 m far out.
 */
import { clamp } from '../../core/math';

export const FT_PER_NM = 6076.12;
export const M_PER_FT = 0.3048;

export const CDI_SCALE_NM = {
  ENR: 2.0,
  TERM: 1.0,
  DPRT: 1.0,
  MAPR: 1.0,
  APR: 0.3,
  OCN: 4.0,
} as const;

/** Distance (nm) from the destination within which TERM scaling applies (AIM 1-1-17: 30 nm arm; Garmin switches at 31 nm). */
export const TERMINAL_RADIUS_NM = 31;
/** CDI ramp distance before the FAF (nm). */
export const APPROACH_RAMP_NM = 2;

/** Linear 1.0 -> 0.3 nm ramp over the last 2 nm before the FAF. */
export function approachRampScaleNm(distToFafNm: number): number {
  const t = clamp(distToFafNm / APPROACH_RAMP_NM, 0, 1);
  return CDI_SCALE_NM.APR + (CDI_SCALE_NM.TERM - CDI_SCALE_NM.APR) * t;
}

/**
 * Angular LPV/LNAV-VNAV lateral full-scale half-width (nm) at `distToThrNm`
 * before the threshold: `courseWidthM` at the threshold, splaying from the
 * GARP `thrToGarpNm` beyond it, limited to [courseWidth, 0.3 nm].
 */
export function angularLateralScaleNm(distToThrNm: number, courseWidthM: number, thrToGarpNm: number): number {
  const w = courseWidthM / 1852;
  const d = Math.max(0, distToThrNm);
  const g = Math.max(0.1, thrToGarpNm);
  return clamp((w * (d + g)) / g, w, CDI_SCALE_NM.APR);
}

/** Vertical full scale (ft) at `distFromGpipFt` for glidepath angle `gpaDeg` (DO-229: 0.25 x GPA, 45..150 m). */
export function glidepathFullScaleFt(distFromGpipFt: number, gpaDeg: number): number {
  const angular = Math.max(0, distFromGpipFt) * Math.tan((0.25 * gpaDeg * Math.PI) / 180);
  return clamp(angular, 45 / M_PER_FT, 150 / M_PER_FT);
}
