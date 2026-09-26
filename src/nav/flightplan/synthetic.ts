/**
 * Synthetic instrument approaches for runways without a published procedure
 * (everything outside the FAA CIFP coverage, and US runways without an
 * approach), so that every runway end with known geometry has one.
 *
 * RNAV (flown as LNAV/VNAV, no SBAS FAS block):
 *   IF  'CFrr'  on the extended centreline, 5 nm before the FAF, at or above the FAF altitude
 *   FAF 'FFrr'  where a 3.0 deg path with a 50 ft TCH reaches (threshold + 1500 ft), rounded up to 100 ft
 *   MAP 'RWrr'  landing threshold, fly-over, at threshold + TCH, vertical angle 3.0 deg
 *   missed: CA runway heading to threshold + 2000 ft (rounded up), DF 'CFrr', HM at 'CFrr'
 *           (inbound = final course, right turns, 1 min legs)
 * ILS / LOC (runways with a localizer): same structure on the localizer
 * course, FAF at glideslope intercept of the same altitude, CF legs referenced
 * to the localizer, navaid frequency/course for auto-tuning.
 *
 * Sources: FAA Order 8260.3 (TERPS) / AIM 5-4-5: standard 3.0 deg glidepath,
 * FAF typically 4-6 nm from the threshold, intermediate segment >= 5 nm
 * (TERPS 2-4-3: 5 nm optimum). TCH 50 ft: EST, middle of the 40-60 ft TERPS
 * range for approach category C/D aircraft (8260.3 Table 10-1-1 height
 * groups). Fix naming follows ARINC 424 7.2.5 for unnamed terminal fixes
 * (CF = course fix / intermediate, FF = final approach fix, RW = runway).
 */
import { destinationPoint, distanceNm, initialBearing, alongTrackNm } from '../../core/geo';
import type { LatLon } from '../../core/geo';
import type { Airport, Procedure, ProcedureLeg, Runway, Waypoint } from '../types';
import { normalizeRunwayIdent } from '../procedures';

/** Standard glidepath angle (deg). AIM 5-4-5, TERPS: 3.00 deg. */
export const SYNTHETIC_GPA_DEG = 3.0;
/** EST: threshold crossing height (ft), see header. */
export const SYNTHETIC_TCH_FT = 50;
/** FAF height above the threshold (ft) before rounding (task spec / typical 1500-1800 ft). */
export const SYNTHETIC_FAF_HEIGHT_FT = 1500;
/** Intermediate segment length (nm), TERPS 2-4-3 optimum 5 nm. */
export const SYNTHETIC_IF_TO_FAF_NM = 5;
/** Missed approach climb height above threshold (ft). EST: typical published missed approach altitude. */
export const SYNTHETIC_MISSED_HEIGHT_FT = 2000;

const FT_PER_NM = 6076.12;

function roundUp100(ft: number): number {
  return Math.ceil(ft / 100) * 100;
}

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

function fix(ident: string, p: LatLon, kind: Waypoint['kind'] = 'fix'): Waypoint {
  return { ident, lat: p.lat, lon: p.lon, kind };
}

/** Landing threshold of a runway end (physical end moved by the displaced distance). */
export function runwayThreshold(r: Runway): LatLon {
  if (r.thresholdLat !== undefined && r.thresholdLon !== undefined) return { lat: r.thresholdLat, lon: r.thresholdLon };
  const disp = r.displacedFt > 0 ? r.displacedFt / FT_PER_NM : 0;
  return disp > 0 ? destinationPoint(r.lat, r.lon, r.headingTrue, disp) : { lat: r.lat, lon: r.lon };
}

function missedLegs(ifFix: Waypoint, runwayHdgTrue: number, finalCourseTrue: number, thrElev: number, magVar: number): ProcedureLeg[] {
  const missedAlt = roundUp100(thrElev + SYNTHETIC_MISSED_HEIGHT_FT);
  return [
    {
      type: 'CA',
      flyOver: false,
      course: wrap360(runwayHdgTrue - magVar),
      altitude: { kind: 'atOrAbove', lowerFt: missedAlt },
      magVar,
      missedStart: true,
    },
    { type: 'DF', fix: ifFix, flyOver: false, altitude: { kind: 'atOrAbove', lowerFt: missedAlt }, magVar },
    {
      type: 'HM',
      fix: ifFix,
      flyOver: true,
      turnDirection: 'R',
      course: wrap360(finalCourseTrue - magVar),
      holdTimeMin: 1,
      altitude: { kind: 'atOrAbove', lowerFt: missedAlt },
      magVar,
    },
  ];
}

/** Builds the synthetic RNAV (LNAV/VNAV) approach for one runway end. */
export function syntheticRnavApproach(airport: Airport, rw: Runway): Procedure {
  const magVar = airport.magVar ?? 0;
  const id = normalizeRunwayIdent(rw.ident);
  const thr = runwayThreshold(rw);
  const thrElev = Number.isFinite(rw.elevationFt) ? rw.elevationFt : airport.elevationFt;
  const crs = rw.headingTrue;
  const tanG = Math.tan((SYNTHETIC_GPA_DEG * Math.PI) / 180);
  const fafAlt = roundUp100(thrElev + SYNTHETIC_FAF_HEIGHT_FT);
  const fafDist = (fafAlt - thrElev - SYNTHETIC_TCH_FT) / (tanG * FT_PER_NM);
  const faf = fix(`FF${id}`, destinationPoint(thr.lat, thr.lon, crs + 180, fafDist));
  const iff = fix(`CF${id}`, destinationPoint(thr.lat, thr.lon, crs + 180, fafDist + SYNTHETIC_IF_TO_FAF_NM));
  const rwFix: Waypoint = { ident: `RW${id}`, lat: thr.lat, lon: thr.lon, kind: 'runway', airport: airport.icao, elevationFt: thrElev };
  const finalLegs: ProcedureLeg[] = [
    { type: 'IF', fix: iff, flyOver: false, altitude: { kind: 'atOrAbove', lowerFt: fafAlt }, magVar, intermediateFix: true, iaf: true },
    { type: 'TF', fix: faf, flyOver: false, altitude: { kind: 'at', lowerFt: fafAlt, upperFt: fafAlt }, magVar, faf: true },
    {
      type: 'TF',
      fix: rwFix,
      flyOver: true,
      altitude: { kind: 'at', lowerFt: thrElev + SYNTHETIC_TCH_FT, upperFt: thrElev + SYNTHETIC_TCH_FT },
      verticalAngleDeg: SYNTHETIC_GPA_DEG,
      magVar,
      map: true,
    },
  ];
  return {
    type: 'APPROACH',
    ident: `R${id}`,
    name: `RNAV RWY ${id}`,
    runways: [id],
    runwayTransitions: [],
    commonLegs: [],
    transitions: [],
    finalLegs,
    missedLegs: missedLegs(iff, rw.headingTrue, crs, thrElev, magVar),
    approachType: 'RNAV',
    suffix: '',
    glidepathDeg: SYNTHETIC_GPA_DEG,
    synthetic: true,
  };
}

/** Builds the synthetic ILS (or LOC/LDA/SDF) approach for a runway end with a localizer. Returns undefined without one. */
export function syntheticIlsApproach(airport: Airport, rw: Runway): Procedure | undefined {
  const ils = rw.ils;
  if (!ils) return undefined;
  const magVar = airport.magVar ?? 0;
  const id = normalizeRunwayIdent(rw.ident);
  const thr = runwayThreshold(rw);
  const thrElev = Number.isFinite(rw.elevationFt) ? rw.elevationFt : airport.elevationFt;
  const crs = ils.courseTrue;
  const hasGs = ils.gsAngleDeg !== undefined && ils.gsAngleDeg > 0 && ils.gsLat !== undefined && ils.gsLon !== undefined;
  const gsAngle = hasGs ? ils.gsAngleDeg! : SYNTHETIC_GPA_DEG;
  // Distances are measured back along the localizer course from the antenna.
  const locToThr = Math.max(0, alongTrackNm(ils.locLat, ils.locLon, ...backPoint(ils.locLat, ils.locLon, crs), thr.lat, thr.lon));
  const fafAlt = roundUp100(thrElev + SYNTHETIC_FAF_HEIGHT_FT);
  let fafFromLoc: number;
  if (hasGs) {
    const gsElev = ils.gsElevFt ?? thrElev;
    const locToGs = Math.max(0, alongTrackNm(ils.locLat, ils.locLon, ...backPoint(ils.locLat, ils.locLon, crs), ils.gsLat!, ils.gsLon!));
    fafFromLoc = locToGs + (fafAlt - gsElev) / (Math.tan((gsAngle * Math.PI) / 180) * FT_PER_NM);
  } else {
    fafFromLoc = locToThr + (fafAlt - thrElev - SYNTHETIC_TCH_FT) / (Math.tan((gsAngle * Math.PI) / 180) * FT_PER_NM);
  }
  const back = crs + 180;
  const faf = fix(`FF${id}`, destinationPoint(ils.locLat, ils.locLon, back, fafFromLoc));
  const iff = fix(`CF${id}`, destinationPoint(ils.locLat, ils.locLon, back, fafFromLoc + SYNTHETIC_IF_TO_FAF_NM));
  const rwFix: Waypoint = { ident: `RW${id}`, lat: thr.lat, lon: thr.lon, kind: 'runway', airport: airport.icao, elevationFt: thrElev };
  const loc: Waypoint & { declination?: number } = { ident: ils.ident, lat: ils.locLat, lon: ils.locLon, kind: 'vor', declination: magVar };
  const crsMag = wrap360(crs - magVar);
  const tch = ils.tchFt ?? SYNTHETIC_TCH_FT;
  const finalLegs: ProcedureLeg[] = [
    { type: 'IF', fix: iff, flyOver: false, altitude: { kind: 'atOrAbove', lowerFt: fafAlt }, magVar, recommendedNavaid: loc, intermediateFix: true, iaf: true },
    {
      type: 'CF',
      fix: faf,
      flyOver: false,
      course: crsMag,
      altitude: hasGs ? { kind: 'at', lowerFt: fafAlt, upperFt: fafAlt, code: 'G', glideslopeFt: fafAlt } : { kind: 'at', lowerFt: fafAlt, upperFt: fafAlt },
      magVar,
      recommendedNavaid: loc,
      faf: true,
    },
    {
      type: 'CF',
      fix: rwFix,
      flyOver: true,
      course: crsMag,
      altitude: { kind: 'at', lowerFt: thrElev + tch, upperFt: thrElev + tch },
      verticalAngleDeg: gsAngle,
      magVar,
      recommendedNavaid: loc,
      map: true,
    },
  ];
  const kind = ils.kind ?? (hasGs ? 'ILS' : 'LOC');
  const type = kind === 'ILS' && hasGs ? 'ILS' : kind === 'LDA' ? 'LDA' : kind === 'SDF' ? 'SDF' : kind === 'IGS' ? 'IGS' : 'LOC';
  return {
    type: 'APPROACH',
    ident: `${type === 'ILS' ? 'I' : type === 'LDA' ? 'X' : type === 'SDF' ? 'U' : 'L'}${id}`,
    name: `${type} RWY ${id}`,
    runways: [id],
    runwayTransitions: [],
    commonLegs: [],
    transitions: [],
    finalLegs,
    missedLegs: missedLegs(iff, rw.headingTrue, crs, thrElev, magVar),
    approachType: type,
    suffix: '',
    navFrequencyMhz: ils.freqMhz,
    navIdent: ils.ident,
    navCourseTrue: crs,
    glidepathDeg: hasGs ? gsAngle : undefined,
    synthetic: true,
  };
}

/** A point 10 nm behind (lat, lon) on the reciprocal of `crs`: defines the approach course line for along-track maths. */
function backPoint(lat: number, lon: number, crs: number): [number, number] {
  const p = destinationPoint(lat, lon, crs + 180, 10);
  return [p.lat, p.lon];
}

/**
 * Synthetic approaches for every runway end of `airport` that no procedure in
 * `existing` serves. Heliports, water runways and runways shorter than 1000 ft
 * are skipped. For each uncovered end: an ILS/LOC approach when a localizer
 * exists, plus an RNAV approach.
 */
export function synthesizeApproaches(airport: Airport, existing: Procedure[]): Procedure[] {
  if (airport.type === 'heliport' || airport.type === 'closed') return [];
  const served = new Set<string>();
  for (const p of existing) for (const r of p.runways) served.add(normalizeRunwayIdent(r));
  const out: Procedure[] = [];
  for (const rw of airport.runways) {
    if (!/^\d{1,2}[LCR]?$/.test(rw.ident.trim())) continue;
    if (!Number.isFinite(rw.lat) || !Number.isFinite(rw.lon) || !Number.isFinite(rw.headingTrue)) continue;
    if (rw.surface === 'water' || !(rw.lengthFt >= 1000)) continue;
    const id = normalizeRunwayIdent(rw.ident);
    if (served.has(id)) continue;
    const ils = syntheticIlsApproach(airport, rw);
    if (ils) out.push(ils);
    out.push(syntheticRnavApproach(airport, rw));
    served.add(id);
  }
  return out;
}

/** Straight-line distance helper re-exported for tests (nm). */
export function thresholdDistanceNm(rw: Runway, lat: number, lon: number): number {
  const t = runwayThreshold(rw);
  return distanceNm(t.lat, t.lon, lat, lon);
}

/** Bearing from a runway threshold to a point (deg true). */
export function bearingFromThreshold(rw: Runway, lat: number, lon: number): number {
  const t = runwayThreshold(rw);
  return initialBearing(t.lat, t.lon, lat, lon);
}
