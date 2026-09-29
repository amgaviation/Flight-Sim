/**
 * Radio navigation signal geometry (pure, allocation-free functions).
 *
 * Sign conventions (match `vars.ts` NAV):
 *   - CDI / deviation: + = needle right = fly right (aircraft left of course).
 *   - Glideslope: + = glideslope above the aircraft = fly up.
 *   - Radials and course inputs are magnetic, referenced to the station's
 *     declination (a VOR's radials stay fixed to the declination it was
 *     aligned with, which may differ from today's variation).
 *
 * Sources:
 *   - Radio line of sight 1.23 * (sqrt(h1 ft) + sqrt(h2 ft)) nm: standard
 *     4/3-earth radio horizon (FAA-H-8083-15B Instrument Flying Handbook,
 *     ch. 9, VOR/DME line-of-sight; ITU-R P.453 k = 4/3).
 *   - VOR CDI full scale +/-10 deg (5 dots x 2 deg), AIM 1-1-3 / FAA-H-8083-15B.
 *   - Localizer course width: 700 ft at the threshold (full-scale fly-left to
 *     full-scale fly-right), AIM 1-1-9 b.3, tailored between 3 and 6 deg total.
 *   - Glideslope: path 1.4 deg thick (+/-0.7 deg full scale) for a 3 deg path,
 *     AIM 1-1-9 c.2; ICAO Annex 10 Vol I 3.1.5.6: full-scale DDM 0.175 at
 *     0.24 * theta. Null-reference antenna pattern (FAA Order 6750.16, ICAO
 *     Annex 10 Att. C 2.4): SBO ~ sin(2x), CSB ~ sin(x), x = pi*e/(2*theta),
 *     giving false glidepaths at 3*theta (reversed sensing) and 5*theta, and a
 *     carrier null (flag) at 2*theta.
 *   - Marker beacon pattern: ellipse ~2,400 ft wide x 4,200 ft long at
 *     1,000 ft above the antenna, AIM 1-1-9 e.1.
 */
import { DEG2RAD, RAD2DEG, wrap180, wrap360, clamp } from '../../core/math';
import { distanceNm, initialBearing } from '../../core/geo';

export const FT_PER_NM = 6076.12;
/** Effective earth radius for radio propagation (4/3 x 6371 km), ft. */
export const RADIO_EARTH_RADIUS_FT = (4 / 3) * 6371000 * 3.28084;

/** Radio line-of-sight range (nm) between antennas `h1Ft` and `h2Ft` above the local surface. */
export function radioLineOfSightNm(h1Ft: number, h2Ft: number): number {
  return 1.23 * (Math.sqrt(Math.max(0, h1Ft)) + Math.sqrt(Math.max(0, h2Ft)));
}

/**
 * Slant range (nm) between an aircraft and a DME antenna: the straight-line
 * distance, not the ground distance (AIM 1-1-7 b: DME is slant range).
 */
export function slantRangeNm(acLat: number, acLon: number, acAltFt: number, stLat: number, stLon: number, stElevFt: number): number {
  const d = distanceNm(acLat, acLon, stLat, stLon);
  const h = (acAltFt - stElevFt) / FT_PER_NM;
  return Math.sqrt(d * d + h * h);
}

/** Magnetic radial (bearing FROM the station) of the aircraft, using the station declination (deg, + east). */
export function vorRadial(stLat: number, stLon: number, declination: number, acLat: number, acLon: number): number {
  return wrap360(initialBearing(stLat, stLon, acLat, acLon) - declination);
}

/** Output of `vorCdi` (reusable object). */
export interface VorCdi {
  /** Angular deviation from the selected course (deg), + = fly right. */
  devDeg: number;
  /** CDI -1..1 (full scale +/-10 deg). */
  cdi: number;
  /** 1 TO, -1 FROM, 0 ambiguous (abeam the station within +/-`ambiguityDeg`). */
  toFrom: number;
}

/** VOR CDI full-scale deflection (deg): 5 dots x 2 deg. */
export const VOR_FULL_SCALE_DEG = 10;

/**
 * CDI deflection and TO/FROM for an aircraft on `radial` with `obs`
 * selected. FROM when the radial is within 90 deg of the OBS; the deviation
 * is measured against the selected radial (FROM) or its reciprocal (TO).
 */
export function vorCdi(radial: number, obs: number, out: VorCdi, ambiguityDeg = 2): VorCdi {
  const d = wrap180(radial - obs);
  const ad = Math.abs(d);
  if (ad <= 90) {
    // FROM: aircraft clockwise of the selected radial is right of course -> fly left.
    out.devDeg = -d;
    out.toFrom = ad > 90 - ambiguityDeg ? 0 : -1;
  } else {
    // TO: compare with the reciprocal; clockwise of it is left of the inbound course -> fly right.
    out.devDeg = wrap180(radial - obs - 180);
    out.toFrom = ad < 90 + ambiguityDeg ? 0 : 1;
  }
  out.cdi = clamp(out.devDeg / VOR_FULL_SCALE_DEG, -1, 1);
  return out;
}

/**
 * Localizer total course width (deg): 700 ft at the threshold
 * (2 * atan(350 ft / distance antenna->threshold)), clamped to 3..6 deg
 * (AIM 1-1-9 b.3). `publishedDeg` (CIFP) wins when given.
 */
export function locCourseWidthDeg(locToThresholdNm: number, publishedDeg?: number): number {
  if (publishedDeg !== undefined && publishedDeg > 0) return publishedDeg;
  if (!(locToThresholdNm > 0)) return 5; // EST: typical width when the threshold is unknown
  const w = 2 * Math.atan(350 / (locToThresholdNm * FT_PER_NM)) * RAD2DEG;
  return clamp(w, 3, 6);
}

/** Output of `locDeviation` (reusable object). */
export interface LocDeviation {
  /** Raw angular deviation in the front-course sense (deg), + = fly right on the front course. */
  devDeg: number;
  /** Aircraft angle off the (front or back) course centreline, unsigned (deg), for coverage checks. */
  offCourseDeg: number;
  /** True when the aircraft is in the back-course sector (beyond the antenna). */
  backCourse: boolean;
  /** Horizontal distance to the antenna (nm). */
  distNm: number;
}

/**
 * Localizer deviation. The front course points along `courseTrue` toward the
 * antenna at the far end; an aircraft on final is at bearing course+180 from
 * the antenna. On the back course the needle keeps the front-course sense
 * (reverse sensing for a pilot flying the back course inbound with a plain
 * CDI), exactly like the DDM a real receiver sees.
 */
export function locDeviation(locLat: number, locLon: number, courseTrue: number, acLat: number, acLon: number, out: LocDeviation): LocDeviation {
  const brg = initialBearing(locLat, locLon, acLat, acLon);
  const a = wrap180(brg - courseTrue - 180);
  out.distNm = distanceNm(locLat, locLon, acLat, acLon);
  if (Math.abs(a) <= 90) {
    out.devDeg = a;
    out.offCourseDeg = Math.abs(a);
    out.backCourse = false;
  } else {
    const b = wrap180(brg - courseTrue);
    out.devDeg = -b;
    out.offCourseDeg = Math.abs(b);
    out.backCourse = true;
  }
  return out;
}

/**
 * Localizer coverage radius (nm) at an angle off the course centreline:
 * 25 nm within +/-10 deg, 17 nm to +/-35 deg, 10 nm beyond
 * (ICAO Annex 10 Vol I 3.1.3.3.1; the US SSV of AIM 1-1-9 b.5 is 18/10 nm,
 * signals are receivable beyond it).
 */
export function locCoverageNm(offCourseDeg: number): number {
  if (offCourseDeg <= 10) return 25;
  if (offCourseDeg <= 35) return 17;
  return 10;
}

/** Output of `glideslope` (reusable object). */
export interface GsSignal {
  /** Elevation angle of the aircraft seen from the GS antenna (deg), earth curvature included. */
  elevationDeg: number;
  /** Normalised deviation -1..1 (clamped), + = fly up. */
  dev: number;
  /** Angular deviation (deg) = angle - elevation (valid near the path), + = fly up. */
  devDeg: number;
  /** Carrier (CSB) relative strength 0..1; near 0 at the ground and at 2*theta (flag). */
  carrier: number;
  /**
   * Azimuth off the front course seen from the GS antenna itself (deg,
   * unsigned). Diagnostic only: coverage is judged about the glide path
   * centre line with `glidePathAzimuthDeg` (the antenna is offset from the runway).
   */
  azimuthOffDeg: number;
  /** Horizontal distance to the GS antenna (nm). */
  distNm: number;
}

/**
 * Glideslope signal at the aircraft. The deviation follows the null-reference
 * antenna DDM, cos(pi*e/(2*theta)), scaled so that the linear region has full
 * scale at +/-0.24*theta (0.72 deg for 3 deg). Saturates at +/-1.
 */
export function glideslope(
  gsLat: number,
  gsLon: number,
  gsElevFt: number,
  angleDeg: number,
  courseTrue: number,
  acLat: number,
  acLon: number,
  acAltFt: number,
  out: GsSignal,
): GsSignal {
  const dNm = distanceNm(gsLat, gsLon, acLat, acLon);
  const dFt = dNm * FT_PER_NM;
  // The beam is straight; the earth (4/3 radius) curves away under it.
  const hFt = acAltFt - gsElevFt - (dFt * dFt) / (2 * RADIO_EARTH_RADIUS_FT);
  const e = Math.atan2(hFt, Math.max(1, dFt)) * RAD2DEG;
  const theta = angleDeg > 0 ? angleDeg : 3;
  const fsd = 0.24 * theta;
  const x = (Math.PI * e) / (2 * theta);
  const k = (Math.PI * fsd) / (2 * theta); // linear-region slope normaliser
  out.elevationDeg = e;
  out.devDeg = theta - e;
  out.dev = clamp(Math.cos(x) / Math.sin(k), -1, 1);
  out.carrier = Math.abs(Math.sin(x));
  out.azimuthOffDeg = Math.abs(wrap180(initialBearing(gsLat, gsLon, acLat, acLon) - courseTrue - 180));
  out.distNm = dNm;
  return out;
}

/**
 * Along-course distance (nm) from the localizer antenna to the point on the
 * course line abeam the glideslope antenna, measured toward the approach
 * side (course + 180). This point is the origin of the glide path centre
 * line used for the glideslope azimuth coverage.
 */
export function glidePathAbeamAlongNm(locLat: number, locLon: number, courseTrue: number, gsLat: number, gsLon: number): number {
  const d = distanceNm(locLat, locLon, gsLat, gsLon);
  const b = initialBearing(locLat, locLon, gsLat, gsLon);
  return d * Math.cos(wrap180(b - courseTrue - 180) * DEG2RAD);
}

/**
 * Azimuth (deg, unsigned) of the aircraft off the centre line of the ILS
 * glide path, seen from the course-line point abeam the GS antenna. ICAO
 * Annex 10 Vol I 3.1.5.3.1 defines the glide path coverage as 8 deg in
 * azimuth on each side of the centre line of the ILS glide path (which lies
 * in the vertical plane of the localizer course), not about the GS antenna
 * itself: the antenna stands 250-650 ft beside the runway (FAA Order
 * 6750.16), so an azimuth measured from the antenna would exceed 8 deg on
 * the centre line inside ~0.5 nm and flag the glideslope at 100-200 ft.
 *
 * @param locDevDeg front-course angular deviation from `locDeviation` (deg, sign ignored)
 * @param locDistNm horizontal distance to the localizer antenna (nm)
 * @param abeamAlongNm `glidePathAbeamAlongNm` of the GS antenna
 * @returns 180 when the aircraft is past the abeam point (over the runway) or in the back-course sector
 */
export function glidePathAzimuthDeg(locDevDeg: number, locDistNm: number, abeamAlongNm: number): number {
  const a = locDevDeg * DEG2RAD;
  const along = locDistNm * Math.cos(a) - abeamAlongNm;
  if (!(along > 0)) return 180;
  return Math.atan2(Math.abs(locDistNm * Math.sin(a)), along) * RAD2DEG;
}

/** Marker beacon cone half-extents per foot of height above the antenna (AIM 1-1-9 e.1: 4,200 x 2,400 ft at 1,000 ft). */
export const MARKER_ALONG_PER_FT = 2100 / 1000;
export const MARKER_ACROSS_PER_FT = 1200 / 1000;

/**
 * True when the aircraft is inside the elliptical marker beacon pattern.
 * `sensitivity` scales the ellipse (1 = LO, recommended for ILS markers;
 * EST 1.6 for HI).
 */
export function inMarkerCone(
  mLat: number,
  mLon: number,
  mElevFt: number,
  courseTrue: number,
  acLat: number,
  acLon: number,
  acAltFt: number,
  sensitivity = 1,
): boolean {
  const h = acAltFt - mElevFt;
  if (h <= 0) return false;
  const dFt = distanceNm(mLat, mLon, acLat, acLon) * FT_PER_NM;
  if (dFt > h * MARKER_ALONG_PER_FT * sensitivity) return false; // quick reject
  const rel = (initialBearing(mLat, mLon, acLat, acLon) - courseTrue) * DEG2RAD;
  const along = dFt * Math.cos(rel);
  const across = dFt * Math.sin(rel);
  const a = h * MARKER_ALONG_PER_FT * sensitivity;
  const b = h * MARKER_ACROSS_PER_FT * sensitivity;
  return (along * along) / (a * a) + (across * across) / (b * b) <= 1;
}

/**
 * True for ILS localizer channels: 108.10-111.95 MHz with an odd tenths
 * digit (ICAO Annex 10 Vol I 3.1.3.2.1). Even tenths in that band are
 * terminal VORs.
 */
export function isLocalizerFrequency(mhz: number): boolean {
  const k = Math.round(mhz * 100);
  if (k < 10810 || k > 11195) return false;
  return Math.floor(k / 10) % 2 === 1;
}
