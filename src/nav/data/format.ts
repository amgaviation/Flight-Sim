/**
 * Compact on-disk formats of the generated navigation data in `public/data/`.
 *
 * Every file is gzipped JSON. Records are stored as positional arrays (the
 * column order is fixed by the index constants below) because that is 3-4x
 * smaller than keyed objects before compression. Missing numeric values are
 * `null`. Latitudes/longitudes are decimal degrees (+N/+E, 6 decimals),
 * elevations feet MSL, headings/courses degrees TRUE unless named `mag`.
 *
 * Written by `scripts/build-navdata.mjs` (through the builders in this
 * folder) and read by `nav/NavDatabase.ts`. Bump `NAVDATA_FORMAT_VERSION`
 * whenever a column changes meaning.
 *
 * Runtime-import rule: this module is also loaded by Node's native type
 * stripping from the build script, so it may only contain erasable
 * TypeScript (no enums/namespaces) and no runtime relative imports.
 */

export const NAVDATA_FORMAT_VERSION = 1;

// ----------------------------------------------------------------- airports

/** Airport type codes used in `AirportRow[A_TYPE]`. */
export const AIRPORT_TYPE_CODES = {
  L: 'large_airport',
  M: 'medium_airport',
  S: 'small_airport',
  H: 'heliport',
  W: 'seaplane_base',
} as const;
export type AirportTypeCode = keyof typeof AIRPORT_TYPE_CODES;

/** Runway surface codes used in `RunwayRow[R_SURFACE]`. */
export const SURFACE_CODES = {
  A: 'asphalt',
  C: 'concrete',
  G: 'grass',
  D: 'dirt',
  V: 'gravel',
  W: 'water',
  S: 'snow',
  U: 'unknown',
} as const;
export type SurfaceCode = keyof typeof SURFACE_CODES;

/**
 * One physical runway (both ends). End coordinates are the physical runway
 * ends (start of pavement) as published by OurAirports; the landing threshold
 * is `dispFt` further along the heading. Missing coordinates are `null`
 * (about 40% of small-airport runways): the loader then synthesises an
 * estimated position from the airport reference point.
 */
export type RunwayRow = [
  lengthFt: number | null,
  widthFt: number | null,
  surface: SurfaceCode,
  lighted: 0 | 1,
  leIdent: string,
  leLat: number | null,
  leLon: number | null,
  leElevFt: number | null,
  leHdgTrue: number | null,
  leDispFt: number | null,
  heIdent: string,
  heLat: number | null,
  heLon: number | null,
  heElevFt: number | null,
  heHdgTrue: number | null,
  heDispFt: number | null,
];

/** Airport frequency: [type (e.g. 'TWR', 'ATIS', 'CTAF'), description, MHz]. */
export type FreqRow = [type: string, description: string, mhz: number];

export type AirportRow = [
  ident: string,
  name: string,
  type: AirportTypeCode,
  lat: number,
  lon: number,
  elevFt: number | null,
  country: string,
  municipality: string,
  iata: string,
  gpsCode: string,
  localCode: string,
  icaoCode: string,
  runways: RunwayRow[],
  freqs: FreqRow[],
  transitionAltFt: number | null,
];

export interface AirportsFile {
  format: 'amg-navdata/airports';
  version: number;
  rows: AirportRow[];
}

// ------------------------------------------------------------------ navaids

/** VOR/DME/TACAN/NDB type strings as in `NavaidType`. */
export type EnrouteNavaidType = 'VOR' | 'VORDME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' | 'NDBDME';

export type NavaidRow = [
  ident: string,
  name: string,
  type: EnrouteNavaidType,
  lat: number,
  lon: number,
  elevFt: number | null,
  /** MHz for VHF (VOR/DME/TACAN paired VHF frequency), kHz for NDB. */
  freq: number,
  /** Standard service volume radius (nm), AIM 1-1-8. */
  rangeNm: number,
  /** Station declination (slaved variation) for VORs, else local variation; + east. */
  magVar: number | null,
  dmeLat: number | null,
  dmeLon: number | null,
  dmeElevFt: number | null,
  country: string,
  /** 'HI' | 'LO' | 'BOTH' | 'TERMINAL' | 'RNAV' | '' */
  usage: string,
  /** Associated airport ident ('' when none). */
  airport: string,
  /** TACAN/DME channel, e.g. '114X' ('' when none). */
  channel: string,
];

export interface NavaidsFile {
  format: 'amg-navdata/navaids';
  version: number;
  rows: NavaidRow[];
}

// ---------------------------------------------------------------------- ILS

/** Localizer kind: ILS (with glideslope), LOC (localizer only), LDA, SDF, IGS. */
export type LocKind = 'ILS' | 'LOC' | 'LDA' | 'SDF' | 'IGS';

export type LocRow = [
  airport: string,
  runway: string,
  ident: string,
  kind: LocKind,
  freqMhz: number,
  lat: number,
  lon: number,
  elevFt: number | null,
  /** Front course, degrees true. */
  courseTrue: number,
  /** Published total course width (deg), when known (CIFP). */
  widthDeg: number | null,
  gsAngleDeg: number | null,
  gsLat: number | null,
  gsLon: number | null,
  gsElevFt: number | null,
  dmeLat: number | null,
  dmeLon: number | null,
  dmeElevFt: number | null,
  /** Glideslope threshold crossing height (ft). */
  tchFt: number | null,
  /** 'I' | 'II' | 'III' | '' */
  category: string,
  /** Station declination (deg, + east) when published. */
  declination: number | null,
  /** 'CIFP' (FAA, current) or 'FG' (FlightGear/X-Plane nav.dat 810). */
  source: 'CIFP' | 'FG',
];

export type MarkerRow = [
  type: 'OM' | 'MM' | 'IM',
  lat: number,
  lon: number,
  elevFt: number | null,
  /** Localizer course the marker serves (deg true); orientation of the elliptical beam. */
  courseTrue: number,
  airport: string,
  runway: string,
];

export interface IlsFile {
  format: 'amg-navdata/ils';
  version: number;
  localizers: LocRow[];
  markers: MarkerRow[];
}

// -------------------------------------------------------------------- fixes

/** Column-oriented (compresses better than rows for 150k small records). */
export interface FixesFile {
  format: 'amg-navdata/fixes';
  version: number;
  ident: string[];
  lat: number[];
  lon: number[];
  /** ICAO region code (e.g. 'K6'), '' when unknown (FlightGear data). */
  region: string[];
}

// ------------------------------------------------------------------ airways

export type AirwayRow = [
  airway: string,
  fromIdent: string,
  fromLat: number,
  fromLon: number,
  toIdent: string,
  toLat: number,
  toLon: number,
  /** 1 = low, 2 = high, 3 = both. */
  level: 1 | 2 | 3,
  baseFt: number | null,
  topFt: number | null,
  /** 0 = two-way, 1 = one-way from -> to only. */
  oneWay: 0 | 1,
];

export interface AirwaysFile {
  format: 'amg-navdata/airways';
  version: number;
  rows: AirwayRow[];
}

// --------------------------------------------------------------- procedures

/**
 * One procedure leg in compact form. Keys are short on purpose; the loader
 * converts to `ProcedureLeg` (nav/types.ts). Only present fields are written.
 */
export interface LegJson {
  /** ARINC 424 path terminator, e.g. 'TF'. */
  t: string;
  /** Fix ident, latitude, longitude, kind ('W' waypoint, 'V' VHF navaid, 'N' NDB, 'R' runway, 'A' airport, 'L' localizer). */
  f?: string;
  la?: number;
  lo?: number;
  fk?: string;
  /** 1 = fly-over. */
  fo?: 1;
  /** Required turn direction. */
  td?: 'L' | 'R';
  /** Course/heading (deg, magnetic unless `ct`). */
  c?: number;
  ct?: 1;
  /** Distance (nm) or, for holds with `tm`, leg time (min). */
  d?: number;
  tm?: number;
  /** ARINC altitude description char and altitudes (ft). */
  ad?: string;
  a1?: number;
  a2?: number;
  /** Speed limit description ('@'|'+'|'-') and speed (kt). */
  sd?: string;
  s?: number;
  /** Vertical path angle (deg, negative = descending as coded). */
  va?: number;
  /** Recommended navaid ident/lat/lon/declination (deg, + east). */
  n?: string;
  nla?: number;
  nlo?: number;
  nv?: number;
  /** Theta (magnetic bearing from navaid) and rho (nm). */
  th?: number;
  rh?: number;
  /** RF arc radius (nm) and centre fix. */
  ar?: number;
  cf?: string;
  cla?: number;
  clo?: number;
  /** Waypoint description code (4 chars, ARINC 5.17). */
  w?: string;
}

export interface ProcedureRouteJson {
  /** 'runway' | 'common' | 'enroute' (SID/STAR); 'transition' | 'final' (approach). */
  k: string;
  /** Transition identifier ('' for common/final routes). */
  tr: string;
  legs: LegJson[];
}

export interface ProcedureJson {
  /** 'SID' | 'STAR' | 'APPROACH' */
  type: string;
  ident: string;
  /** Approach type letter (ARINC route type, e.g. 'I' ILS, 'R' RNAV) for approaches. */
  at?: string;
  /** Runway ident served by an approach ('' = circling). */
  rw?: string;
  /** Approach localizer/navaid frequency (MHz), ident and course (deg true). */
  nf?: number;
  ni?: string;
  nc?: number;
  /** SBAS final approach segment data block for LPV/LP approaches. */
  fas?: {
    los: 'LPV' | 'LP' | '';
    ltpLat: number;
    ltpLon: number;
    ltpEllipsoidM: number;
    gpaDeg: number;
    fpapLat: number;
    fpapLon: number;
    courseWidthM: number;
    tchFt: number;
  };
  routes: ProcedureRouteJson[];
}

export interface ProceduresFile {
  format: 'amg-navdata/procedures';
  version: number;
  /** Airport ident in this database (OurAirports ident). */
  icao: string;
  /** Airport ident in the CIFP (FAA LID for non-ICAO airports). */
  cifpIdent: string;
  cycle: string;
  /** Airport magnetic variation (deg, + east) used for procedure courses. */
  magVar: number;
  procedures: ProcedureJson[];
}

export interface ProceduresIndexFile {
  format: 'amg-navdata/procedures-index';
  version: number;
  cycle: string;
  /** Airport ident -> number of procedures in its file. */
  airports: Record<string, number>;
}

// --------------------------------------------------------------------- meta

export interface NavdataMeta {
  format: 'amg-navdata/meta';
  version: number;
  generated: string;
  sources: { name: string; url: string; license: string; date?: string; cycle?: string }[];
  counts: Record<string, number>;
  cifp?: { cycle: string; effective: string; url: string } | null;
}
