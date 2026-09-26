/**
 * Sun and Moon positions.
 *
 * Sun: NOAA solar position algorithm as implemented by the NOAA Global
 * Monitoring Laboratory calculators (https://gml.noaa.gov/grad/solcalc/,
 * "General Solar Position Calculations" and the calculator source), which in
 * turn follows J. Meeus, "Astronomical Algorithms" (2nd ed., ch. 25 low
 * accuracy method, ch. 28 equation of time). Stated accuracy about 0.01 deg in
 * elevation for 1800-2100 (NOAA). Includes NOAA's atmospheric refraction
 * approximation. Delta T (TT - UT) is ignored, like NOAA.
 *
 * Moon: low-precision formulae of the Astronomical Almanac (section D,
 * "Low precision formulas for the Moon's coordinates"), accurate to ~0.3 deg,
 * adequate for rendering and moonlight.
 */
import { DEG2RAD, RAD2DEG, wrap360 } from '../geo';

/** Julian Day for a Gregorian calendar date at 0h UT (Meeus eq. 7.1; NOAA calcJD). */
export function julianDay0h(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

/** Julian Day for a year, day of year (1-based) and UT hours. */
export function julianDayFromDayOfYear(year: number, dayOfYear: number, utcHours: number): number {
  return julianDay0h(year, 1, 1) + (dayOfYear - 1) + utcHours / 24;
}

/** Julian Day of a JS Date (UTC). */
export function julianDayFromDate(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0. */
export function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

export interface SunPosition {
  /** Apparent (refraction-corrected) elevation above the horizon (deg). */
  elevationDeg: number;
  /** Geometric elevation without refraction (deg). */
  trueElevationDeg: number;
  /** Azimuth clockwise from true north (deg, 0..360). */
  azimuthDeg: number;
  declinationDeg: number;
  /** Equation of time (minutes). */
  equationOfTimeMin: number;
  hourAngleDeg: number;
  /** Earth-Sun distance (AU). */
  distanceAu: number;
}

export function createSunPosition(): SunPosition {
  return { elevationDeg: 0, trueElevationDeg: 0, azimuthDeg: 0, declinationDeg: 0, equationOfTimeMin: 0, hourAngleDeg: 0, distanceAu: 1 };
}

/**
 * NOAA atmospheric refraction correction (deg) for a geometric elevation (deg).
 * Same piecewise formula as the NOAA calculators.
 */
export function noaaRefractionDeg(elevDeg: number): number {
  if (elevDeg > 85) return 0;
  const te = Math.tan(elevDeg * DEG2RAD);
  let arcsec: number;
  if (elevDeg > 5) arcsec = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / (te * te * te * te * te);
  else if (elevDeg > -0.575) arcsec = 1735 + elevDeg * (-518.2 + elevDeg * (103.4 + elevDeg * (-12.79 + elevDeg * 0.711)));
  else arcsec = -20.774 / te;
  return arcsec / 3600;
}

/**
 * Sun position for a Julian Day (UT) and observer latitude/longitude
 * (deg, + north / + east). Allocation-free with `out`.
 */
export function sunPosition(jd: number, latDeg: number, lonDeg: number, out: SunPosition = createSunPosition()): SunPosition {
  const T = julianCentury(jd);
  // NOAA calcGeomMeanLongSun / calcGeomMeanAnomalySun / calcEccentricityEarthOrbit
  const L0 = wrap360(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const mr = M * DEG2RAD;
  // calcSunEqOfCenter
  const C =
    Math.sin(mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnom * DEG2RAD));
  // calcSunApparentLong
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG2RAD);
  // calcMeanObliquityOfEcliptic / calcObliquityCorrection
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const eps0 = 23 + (26 + seconds / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG2RAD);
  // calcSunDeclination
  const decl = Math.asin(Math.sin(eps * DEG2RAD) * Math.sin(lambda * DEG2RAD)) * RAD2DEG;
  // calcEquationOfTime (minutes)
  const yv = Math.tan((eps * DEG2RAD) / 2) ** 2;
  const l0r = L0 * DEG2RAD;
  const eqTime =
    4 *
    RAD2DEG *
    (yv * Math.sin(2 * l0r) -
      2 * e * Math.sin(mr) +
      4 * e * yv * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * yv * yv * Math.sin(4 * l0r) -
      1.25 * e * e * Math.sin(2 * mr));

  // True solar time (minutes) from UT minutes of the day.
  const utMin = ((((jd + 0.5) % 1) + 1) % 1) * 1440;
  let tst = utMin + eqTime + 4 * lonDeg;
  tst = ((tst % 1440) + 1440) % 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;

  const latR = latDeg * DEG2RAD;
  const decR = decl * DEG2RAD;
  let csz = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(ha * DEG2RAD);
  csz = Math.max(-1, Math.min(1, csz));
  const zenith = Math.acos(csz) * RAD2DEG;
  const azDenom = Math.cos(latR) * Math.sin(zenith * DEG2RAD);
  let az: number;
  if (Math.abs(azDenom) > 0.001) {
    let azRad = (Math.sin(latR) * Math.cos(zenith * DEG2RAD) - Math.sin(decR)) / azDenom;
    azRad = Math.max(-1, Math.min(1, azRad));
    az = 180 - Math.acos(azRad) * RAD2DEG;
    if (ha > 0) az = -az;
  } else az = latDeg > 0 ? 180 : 0;
  az = wrap360(az);

  const geoElev = 90 - zenith;
  out.trueElevationDeg = geoElev;
  out.elevationDeg = geoElev + noaaRefractionDeg(geoElev);
  out.azimuthDeg = az;
  out.declinationDeg = decl;
  out.equationOfTimeMin = eqTime;
  out.hourAngleDeg = ha;
  out.distanceAu = R;
  return out;
}

/** Greenwich mean sidereal time (deg) for a Julian Day UT (Meeus eq. 12.4). */
export function gmstDeg(jd: number): number {
  const T = julianCentury(jd);
  return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000));
}

/** Mean obliquity of the ecliptic (deg), Meeus eq. 22.2 (as in the NOAA calculator). */
export function meanObliquityDeg(jd: number): number {
  const T = julianCentury(jd);
  return 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
}

export interface MoonPosition {
  /** Geocentric ecliptic longitude/latitude (deg). */
  eclLonDeg: number;
  eclLatDeg: number;
  /** Right ascension / declination (deg). */
  raDeg: number;
  decDeg: number;
  /** Topocentric-ignoring horizontal coordinates (deg). Parallax (< 1 deg) is ignored. */
  elevationDeg: number;
  azimuthDeg: number;
  /** Illuminated fraction 0..1. */
  illuminated: number;
  /** Phase angle Sun-Moon elongation (deg, 0 = new, 180 = full). */
  elongationDeg: number;
  /** Position angle proxy: +1 waxing, -1 waning. */
  waxing: number;
}

export function createMoonPosition(): MoonPosition {
  return { eclLonDeg: 0, eclLatDeg: 0, raDeg: 0, decDeg: 0, elevationDeg: 0, azimuthDeg: 0, illuminated: 0, elongationDeg: 0, waxing: 1 };
}

function sind(d: number): number {
  return Math.sin(d * DEG2RAD);
}

/** Equatorial (RA/Dec, deg) to horizontal elevation/azimuth (deg) for an observer. */
export function equatorialToHorizontal(
  raDeg: number,
  decDeg: number,
  jd: number,
  latDeg: number,
  lonDeg: number,
  out: { elevationDeg: number; azimuthDeg: number },
): void {
  const lst = gmstDeg(jd) + lonDeg;
  const H = (lst - raDeg) * DEG2RAD;
  const phi = latDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimuth measured from north, clockwise.
  const y = -Math.sin(H) * Math.cos(dec);
  const x = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H);
  out.elevationDeg = alt * RAD2DEG;
  out.azimuthDeg = wrap360(Math.atan2(y, x) * RAD2DEG);
}

/** Moon position (Astronomical Almanac low-precision formulae) and phase. Allocation-free with `out`. */
export function moonPosition(jd: number, latDeg: number, lonDeg: number, out: MoonPosition = createMoonPosition()): MoonPosition {
  const T = julianCentury(jd);
  const lam =
    218.32 +
    481267.881 * T +
    6.29 * sind(135.0 + 477198.87 * T) -
    1.27 * sind(259.3 - 413335.36 * T) +
    0.66 * sind(235.7 + 890534.22 * T) +
    0.21 * sind(269.9 + 954397.74 * T) -
    0.19 * sind(357.5 + 35999.05 * T) -
    0.11 * sind(186.5 + 966404.03 * T);
  const bet =
    5.13 * sind(93.3 + 483202.02 * T) +
    0.28 * sind(228.2 + 960400.89 * T) -
    0.28 * sind(318.3 + 6003.15 * T) -
    0.17 * sind(217.6 - 407332.21 * T);
  const lamR = wrap360(lam) * DEG2RAD;
  const betR = bet * DEG2RAD;
  const eps = meanObliquityDeg(jd) * DEG2RAD;
  // Ecliptic -> equatorial.
  const l = Math.cos(betR) * Math.cos(lamR);
  const m = Math.cos(eps) * Math.cos(betR) * Math.sin(lamR) - Math.sin(eps) * Math.sin(betR);
  const nn = Math.sin(eps) * Math.cos(betR) * Math.sin(lamR) + Math.cos(eps) * Math.sin(betR);
  out.eclLonDeg = wrap360(lam);
  out.eclLatDeg = bet;
  out.raDeg = wrap360(Math.atan2(m, l) * RAD2DEG);
  out.decDeg = Math.asin(Math.max(-1, Math.min(1, nn))) * RAD2DEG;
  equatorialToHorizontal(out.raDeg, out.decDeg, jd, latDeg, lonDeg, out);

  // Phase from the Sun's apparent longitude (NOAA/Meeus low accuracy).
  const L0 = 280.46646 + T * 36000.76983;
  const M = (357.52911 + T * 35999.05029) * DEG2RAD;
  const sunLon = wrap360(L0 + 1.914602 * Math.sin(M) + 0.019993 * Math.sin(2 * M));
  const cosE = Math.cos(betR) * Math.cos(lamR - sunLon * DEG2RAD);
  const elong = Math.acos(Math.max(-1, Math.min(1, cosE))) * RAD2DEG;
  out.elongationDeg = elong;
  // Illuminated fraction k = (1 + cos i) / 2 (Meeus eq. 48.1) with phase angle
  // i ~ 180 deg - elongation (Meeus 48.3 with the Earth-Moon/Earth-Sun distance ratio neglected).
  out.illuminated = (1 - Math.cos(elong * DEG2RAD)) / 2;
  out.waxing = wrap360(out.eclLonDeg - sunLon) < 180 ? 1 : -1;
  return out;
}

/**
 * Unit vector toward a body in the Three.js local ENU frame (x = east,
 * y = up, z = south) from elevation/azimuth (deg).
 */
export function horizontalToVector(elevationDeg: number, azimuthDeg: number, out: { x: number; y: number; z: number }): void {
  const el = elevationDeg * DEG2RAD;
  const az = azimuthDeg * DEG2RAD;
  const c = Math.cos(el);
  out.x = c * Math.sin(az);
  out.y = Math.sin(el);
  out.z = -c * Math.cos(az);
}
