/**
 * Geodesy: WGS84 ellipsoid, geodetic <-> ECEF <-> local ENU conversions,
 * radii of curvature, and spherical great-circle navigation formulas.
 *
 * Conventions: latitude/longitude in degrees (north/east positive), heights
 * in metres above the ellipsoid (the sim treats MSL == ellipsoid height, see
 * world/types.ts), bearings in degrees true clockwise from north, distances
 * in nautical miles for the great-circle helpers.
 *
 * WGS84 constants: NIMA TR8350.2 (3rd ed.) Table 3.1 — a = 6378137 m,
 * 1/f = 298.257223563.
 * Great-circle formulas: Ed Williams, "Aviation Formulary" V1.47, adapted to
 * east-positive longitudes; spherical earth radius R = 3440.065 nm
 * (6371.0088 km mean radius, IUGG).
 */
import { DEG2RAD, RAD2DEG, wrap180, wrap360 } from './math';

export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
/** First eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Second eccentricity squared. */
export const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
/** Mean earth radius for spherical formulas (nm). */
export const EARTH_RADIUS_NM = 3440.065;
export const EARTH_RADIUS_M = EARTH_RADIUS_NM * 1852;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LatLonAlt extends LatLon {
  alt: number;
}

/** Plain mutable triple used for ECEF/ENU outputs (x,y,z or e,n,u). */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

// ------------------------------------------------------------------ radii

/** Meridian radius of curvature M(lat) in metres. */
export function meridianRadius(latDeg: number): number {
  const s = Math.sin(latDeg * DEG2RAD);
  const d = 1 - WGS84_E2 * s * s;
  return (WGS84_A * (1 - WGS84_E2)) / (d * Math.sqrt(d));
}

/** Prime-vertical (transverse) radius of curvature N(lat) in metres. */
export function primeVerticalRadius(latDeg: number): number {
  const s = Math.sin(latDeg * DEG2RAD);
  return WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
}

/** Metres per degree of latitude at `latDeg`, height h. */
export function metresPerDegLat(latDeg: number, h = 0): number {
  return (meridianRadius(latDeg) + h) * DEG2RAD;
}

/** Metres per degree of longitude at `latDeg`, height h. */
export function metresPerDegLon(latDeg: number, h = 0): number {
  return (primeVerticalRadius(latDeg) + h) * Math.cos(latDeg * DEG2RAD) * DEG2RAD;
}

// ------------------------------------------------------------------ ECEF

/** Geodetic (deg, deg, m) -> ECEF metres. Double precision, allocation-free with `out`. */
export function geodeticToEcef(latDeg: number, lonDeg: number, h: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  out.x = (n + h) * cl * Math.cos(lon);
  out.y = (n + h) * cl * Math.sin(lon);
  out.z = (n * (1 - WGS84_E2) + h) * sl;
  return out;
}

/**
 * ECEF metres -> geodetic. Bowring's initial estimate followed by two Newton
 * refinements: sub-millimetre everywhere from the earth's centre region
 * excluded (|r| > 1 km) up to geostationary altitude.
 */
export function ecefToGeodetic(x: number, y: number, z: number, out: LatLonAlt = { lat: 0, lon: 0, alt: 0 }): LatLonAlt {
  const p = Math.sqrt(x * x + y * y);
  const lon = Math.atan2(y, x);
  if (p < 1e-9) {
    // On the polar axis.
    out.lat = z >= 0 ? 90 : -90;
    out.lon = 0;
    out.alt = Math.abs(z) - WGS84_B;
    return out;
  }
  // Bowring (1976) parametric latitude estimate.
  const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  let lat = Math.atan2(z + WGS84_EP2 * WGS84_B * st * st * st, p - WGS84_E2 * WGS84_A * ct * ct * ct);
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const sl = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
    const cl = Math.cos(lat);
    h = Math.abs(cl) > 1e-10 ? p / cl - n : Math.abs(z) / Math.abs(sl) - n * (1 - WGS84_E2);
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + h)));
  }
  out.lat = lat * RAD2DEG;
  out.lon = lon * RAD2DEG;
  out.alt = h;
  return out;
}

// ------------------------------------------------------------------ ENU

/**
 * Local East-North-Up tangent frame anchored at a geodetic reference point.
 * Precomputes the reference ECEF position and rotation so repeated
 * conversions are cheap and allocation-free (pass `out`).
 */
export class EnuFrame {
  refLat = 0;
  refLon = 0;
  refAlt = 0;
  private readonly refEcef: XYZ = { x: 0, y: 0, z: 0 };
  private sinLat = 0;
  private cosLat = 1;
  private sinLon = 0;
  private cosLon = 1;
  private readonly tmp: XYZ = { x: 0, y: 0, z: 0 };

  constructor(latDeg = 0, lonDeg = 0, alt = 0) {
    this.setReference(latDeg, lonDeg, alt);
  }

  setReference(latDeg: number, lonDeg: number, alt: number): void {
    this.refLat = latDeg;
    this.refLon = lonDeg;
    this.refAlt = alt;
    geodeticToEcef(latDeg, lonDeg, alt, this.refEcef);
    this.sinLat = Math.sin(latDeg * DEG2RAD);
    this.cosLat = Math.cos(latDeg * DEG2RAD);
    this.sinLon = Math.sin(lonDeg * DEG2RAD);
    this.cosLon = Math.cos(lonDeg * DEG2RAD);
  }

  /** ECEF -> ENU (out.x = east, out.y = north, out.z = up). */
  ecefToEnu(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
    const dx = x - this.refEcef.x;
    const dy = y - this.refEcef.y;
    const dz = z - this.refEcef.z;
    const sl = this.sinLat;
    const cl = this.cosLat;
    const so = this.sinLon;
    const co = this.cosLon;
    const e = -so * dx + co * dy;
    const n = -sl * co * dx - sl * so * dy + cl * dz;
    const u = cl * co * dx + cl * so * dy + sl * dz;
    out.x = e;
    out.y = n;
    out.z = u;
    return out;
  }

  /** ENU -> ECEF. */
  enuToEcef(e: number, n: number, u: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
    const sl = this.sinLat;
    const cl = this.cosLat;
    const so = this.sinLon;
    const co = this.cosLon;
    out.x = this.refEcef.x - so * e - sl * co * n + cl * co * u;
    out.y = this.refEcef.y + co * e - sl * so * n + cl * so * u;
    out.z = this.refEcef.z + cl * n + sl * u;
    return out;
  }

  /** Geodetic -> ENU relative to the reference. */
  geodeticToEnu(latDeg: number, lonDeg: number, alt: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
    geodeticToEcef(latDeg, lonDeg, alt, this.tmp);
    return this.ecefToEnu(this.tmp.x, this.tmp.y, this.tmp.z, out);
  }

  /** ENU relative to the reference -> geodetic. */
  enuToGeodetic(e: number, n: number, u: number, out: LatLonAlt = { lat: 0, lon: 0, alt: 0 }): LatLonAlt {
    this.enuToEcef(e, n, u, this.tmp);
    return ecefToGeodetic(this.tmp.x, this.tmp.y, this.tmp.z, out);
  }
}

// ------------------------------------------------------------------ great circle (spherical)

/** Central angle (radians) between two points (haversine; well-conditioned for short distances). */
export function centralAngle(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG2RAD;
  const s1 = Math.sin(dp / 2);
  const s2 = Math.sin(dl / 2);
  const a = s1 * s1 + Math.cos(p1) * Math.cos(p2) * s2 * s2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Great-circle distance in nautical miles (R = 3440.065 nm). */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return centralAngle(lat1, lon1, lat2, lon2) * EARTH_RADIUS_NM;
}

/** Initial true bearing (deg, 0..360) from point 1 to point 2. */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * RAD2DEG);
}

/** Final true bearing (deg) on arrival at point 2 when flying the great circle from point 1. */
export function finalBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return wrap360(initialBearing(lat2, lon2, lat1, lon1) + 180);
}

/** Destination point from a start, true bearing (deg) and distance (nm). */
export function destinationPoint(latDeg: number, lonDeg: number, bearingDeg: number, distNm: number, out: LatLon = { lat: 0, lon: 0 }): LatLon {
  const d = distNm / EARTH_RADIUS_NM;
  const p1 = latDeg * DEG2RAD;
  const l1 = lonDeg * DEG2RAD;
  const th = bearingDeg * DEG2RAD;
  const sp1 = Math.sin(p1);
  const cp1 = Math.cos(p1);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const sp2 = sp1 * cd + cp1 * sd * Math.cos(th);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
  const l2 = l1 + Math.atan2(Math.sin(th) * sd * cp1, cd - sp1 * sp2);
  out.lat = p2 * RAD2DEG;
  out.lon = wrap180(l2 * RAD2DEG);
  return out;
}

/**
 * Cross-track distance (nm) of point P from the great-circle course A->B.
 * Positive = P is RIGHT of course (matches the Aviation Formulary convention
 * and the FMS xtk sign in vars.ts).
 */
export function crossTrackNm(latA: number, lonA: number, latB: number, lonB: number, latP: number, lonP: number): number {
  const d13 = centralAngle(latA, lonA, latP, lonP);
  const t13 = initialBearing(latA, lonA, latP, lonP) * DEG2RAD;
  const t12 = initialBearing(latA, lonA, latB, lonB) * DEG2RAD;
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12)))) * EARTH_RADIUS_NM;
}

/**
 * Along-track distance (nm) from A to the foot of the perpendicular from P
 * onto the great circle A->B. Negative when the foot lies behind A.
 */
export function alongTrackNm(latA: number, lonA: number, latB: number, lonB: number, latP: number, lonP: number): number {
  const d13 = centralAngle(latA, lonA, latP, lonP);
  const t13 = initialBearing(latA, lonA, latP, lonP) * DEG2RAD;
  const t12 = initialBearing(latA, lonA, latB, lonB) * DEG2RAD;
  const dxt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12))));
  const c = Math.cos(dxt);
  const ratio = c === 0 ? 1 : Math.cos(d13) / c;
  const dat = Math.acos(Math.max(-1, Math.min(1, ratio)));
  return (Math.cos(t13 - t12) < 0 ? -dat : dat) * EARTH_RADIUS_NM;
}

/**
 * Intersection of two great-circle courses: from point 1 on true bearing
 * brg1 and from point 2 on bearing brg2. Writes the intersection *ahead* of
 * both points to `out` and returns true; returns false when the courses are
 * parallel/diverging (infinite or ambiguous intersection).
 */
export function courseIntersection(
  lat1: number,
  lon1: number,
  brg1: number,
  lat2: number,
  lon2: number,
  brg2: number,
  out: LatLon = { lat: 0, lon: 0 },
): boolean {
  const p1 = lat1 * DEG2RAD;
  const l1 = lon1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const l2 = lon2 * DEG2RAD;
  const t13 = brg1 * DEG2RAD;
  const t23 = brg2 * DEG2RAD;
  const dp = p2 - p1;
  const dl = l2 - l1;
  const d12 = 2 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  if (Math.abs(d12) < 1e-12) {
    out.lat = lat1;
    out.lon = lon1;
    return true;
  }
  const cA = (Math.sin(p2) - Math.sin(p1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(p1));
  const cB = (Math.sin(p1) - Math.sin(p2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(p2));
  const ta = Math.acos(Math.max(-1, Math.min(1, cA)));
  const tb = Math.acos(Math.max(-1, Math.min(1, cB)));
  const t12 = Math.sin(dl) > 0 ? ta : 2 * Math.PI - ta;
  const t21 = Math.sin(dl) > 0 ? 2 * Math.PI - tb : tb;
  const a1 = t13 - t12; // angle p2-p1-p3
  const a2 = t21 - t23; // angle p1-p2-p3
  const s1 = Math.sin(a1);
  const s2 = Math.sin(a2);
  if (s1 === 0 && s2 === 0) return false; // infinite intersections
  if (s1 * s2 < 0) return false; // ambiguous (courses diverge)
  const c1 = Math.cos(a1);
  const c2 = Math.cos(a2);
  const c3 = -c1 * c2 + s1 * s2 * Math.cos(d12);
  const d13 = Math.atan2(Math.sin(d12) * s1 * s2, c2 + c1 * c3);
  // The near intersection is behind both points (courses diverge); the only
  // "ahead" solution is more than a quarter of the globe away.
  if (d13 > Math.PI / 2) return false;
  const p3 = Math.asin(Math.max(-1, Math.min(1, Math.sin(p1) * Math.cos(d13) + Math.cos(p1) * Math.sin(d13) * Math.cos(t13))));
  const dl13 = Math.atan2(Math.sin(t13) * Math.sin(d13) * Math.cos(p1), Math.cos(d13) - Math.sin(p1) * Math.sin(p3));
  out.lat = p3 * RAD2DEG;
  out.lon = wrap180((l1 + dl13) * RAD2DEG);
  return true;
}

/** Intermediate point at fraction f (0..1) along the great circle between two points. */
export function intermediatePoint(lat1: number, lon1: number, lat2: number, lon2: number, f: number, out: LatLon = { lat: 0, lon: 0 }): LatLon {
  const d = centralAngle(lat1, lon1, lat2, lon2);
  if (d < 1e-15) {
    out.lat = lat1;
    out.lon = lon1;
    return out;
  }
  const p1 = lat1 * DEG2RAD;
  const l1 = lon1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const l2 = lon2 * DEG2RAD;
  const a = Math.sin((1 - f) * d) / Math.sin(d);
  const b = Math.sin(f * d) / Math.sin(d);
  const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
  const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
  const z = a * Math.sin(p1) + b * Math.sin(p2);
  out.lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  out.lon = Math.atan2(y, x) * RAD2DEG;
  return out;
}

/**
 * Moves a geodetic point by a local north/east offset in metres using the
 * WGS84 radii (accurate for offsets of a few km). Allocation-free with `out`.
 */
export function offsetNorthEast(latDeg: number, lonDeg: number, north_m: number, east_m: number, h = 0, out: LatLon = { lat: 0, lon: 0 }): LatLon {
  const m = meridianRadius(latDeg) + h;
  const n = primeVerticalRadius(latDeg) + h;
  const cl = Math.max(1e-9, Math.cos(latDeg * DEG2RAD));
  out.lat = latDeg + (north_m / m) * RAD2DEG;
  out.lon = wrap180(lonDeg + (east_m / (n * cl)) * RAD2DEG);
  return out;
}
