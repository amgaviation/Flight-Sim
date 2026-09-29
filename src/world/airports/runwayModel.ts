/**
 * Airport layout model: pairs runway ends from the nav database, classifies
 * each end (markings, approach lights, PAPI) and plans a parallel taxiway and
 * apron so the airport reads as an airport. Pure data; no Three.js.
 *
 * References:
 *  - FAA AC 150/5340-1M "Standards for Airport Markings" (markings, Table 2-1).
 *  - FAA AC 150/5340-30J "Design and Installation Details for Airport Visual
 *    Aids" (edge/threshold/centerline/TDZ lights, PAPI siting ch. 7).
 *  - FAA AIM 2-1-1..2-1-9 (ALS, PAPI, beacons).
 *  - FAA AC 150/5300-13B "Airport Design" (shoulders, blast pads, separations).
 * Where the database lacks the information (e.g. which approach lights an end
 * really has) the choice is a documented heuristic marked EST.
 */
import type { Airport, IlsInfo, Runway } from '../../nav/types';
import { DEG2RAD, FT_TO_M, lonDelta, metresPerDegree, RAD2DEG, wrap360 } from '../geo';
import type { FlattenSurface, PavedRect, SurfaceType } from './surfaces';

export type MarkingClass = 'precision' | 'nonprecision' | 'visual' | 'none';
export type ApproachLightSystem = 'ALSF2' | 'MALSR' | 'NONE';

export interface RunwayEndModel {
  ident: string;
  /** Pavement end position (deg) as published (OurAirports runway end). */
  lat: number;
  lon: number;
  /** Threshold elevation (m MSL). */
  elevationM: number;
  /** Landing threshold displacement from the pavement end (m). */
  displacedM: number;
  ils?: IlsInfo;
  markings: MarkingClass;
  approachLights: ApproachLightSystem;
  /** Touchdown-zone lights (CAT II/III ends, AC 150/5340-30J 3.2). */
  tdzLights: boolean;
  papi: boolean;
  /** Visual glide path (deg). ILS GS angle when available, else 3.0 (AC 150/5340-30J 7.5.4.3.4). */
  papiAngleDeg: number;
  /** PAPI distance from the landing threshold (m). */
  papiDistM: number;
  reil: boolean;
  /** Blast pad length before the pavement end (m). */
  blastPadM: number;
  /** End has an instrument approach (drives yellow caution-zone edge lights). */
  instrument: boolean;
}

export interface RunwayModel {
  id: string;
  airportIcao: string;
  airportType: Airport['type'];
  ends: [RunwayEndModel, RunwayEndModel];
  /** Physical pavement length between ends (m). */
  lengthM: number;
  widthM: number;
  /** Paved shoulder width each side (m). */
  shoulderM: number;
  surface: SurfaceType;
  paved: boolean;
  lighted: boolean;
  /** Runway centreline lights installed. */
  centerlineLights: boolean;
  /** High-intensity (vs medium) edge lights. */
  hirl: boolean;
  /** Local tangent frame at end A (see surfaces.ts). */
  lat0: number;
  lon0: number;
  mLat: number;
  mLon: number;
  dirE: number;
  dirN: number;
  /** True heading A -> B (deg). */
  headingTrue: number;
}

export interface TaxiwayPlan {
  /** Runway the taxiway parallels. */
  runway: RunwayModel;
  /** +1: taxiway to the right of A->B, -1: left. */
  side: 1 | -1;
  /** Centreline offset from the runway centreline (m, unsigned). */
  offsetM: number;
  widthM: number;
  /** Along-runway extent (m) of the parallel taxiway. */
  s0: number;
  s1: number;
  /** Along-runway positions (m) of perpendicular connectors to the runway. */
  connectors: number[];
  /** Hold-short line distance from runway centreline (m). */
  holdLineM: number;
  apron: { s0: number; s1: number; t0: number; t1: number };
}

export interface AirportLayout {
  airport: Airport;
  runways: RunwayModel[];
  taxiway: TaxiwayPlan | null;
  surfaces: FlattenSurface[];
  /** Rotating beacon position (deg) or null for unlighted fields. */
  beacon: { lat: number; lon: number } | null;
  /** Reference elevation (m MSL). */
  elevationM: number;
  /** Importance score used to prioritise building (higher first). */
  importance: number;
}

const _mpd = { lat: 0, lon: 0 };

function isPaved(surface: SurfaceType): boolean {
  return surface === 'asphalt' || surface === 'concrete' || surface === 'unknown';
}

/** Importance for build ordering: large > medium > small, longer runways first. */
export function airportImportance(a: Airport): number {
  const base = a.type === 'large_airport' ? 3 : a.type === 'medium_airport' ? 2 : a.type === 'small_airport' ? 1 : 0;
  let longest = 0;
  for (const r of a.runways) longest = Math.max(longest, r.lengthFt || 0);
  return base * 10000 + Math.min(9999, longest);
}

/**
 * Pairs runway ends by `oppositeIdent`. Ends without a usable partner are
 * completed by projecting `lengthFt` along the heading. Runways with no
 * coordinates or zero length are skipped.
 */
export function pairRunways(airport: Airport): [Runway, Runway][] {
  const byIdent = new Map<string, Runway>();
  for (const r of airport.runways) byIdent.set(r.ident.toUpperCase(), r);
  const seen = new Set<string>();
  const pairs: [Runway, Runway][] = [];
  for (const r of airport.runways) {
    const id = r.ident.toUpperCase();
    if (seen.has(id)) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || (r.lat === 0 && r.lon === 0)) continue;
    if (!(r.lengthFt > 0)) continue;
    seen.add(id);
    const opp = byIdent.get((r.oppositeIdent || '').toUpperCase());
    if (opp && !seen.has(opp.ident.toUpperCase()) && Number.isFinite(opp.lat) && !(opp.lat === 0 && opp.lon === 0)) {
      seen.add(opp.ident.toUpperCase());
      pairs.push([r, opp]);
    } else {
      // Synthesize the far end from heading and length.
      metresPerDegree(r.lat, _mpd);
      const L = r.lengthFt * FT_TO_M;
      const h = r.headingTrue * DEG2RAD;
      const far: Runway = {
        ...r,
        ident: r.oppositeIdent || reciprocalIdent(r.ident),
        oppositeIdent: r.ident,
        lat: r.lat + (L * Math.cos(h)) / _mpd.lat,
        lon: r.lon + (L * Math.sin(h)) / _mpd.lon,
        headingTrue: wrap360(r.headingTrue + 180),
        displacedFt: 0,
        ils: undefined,
      };
      pairs.push([r, far]);
    }
  }
  return pairs;
}

/** "09L" -> "27R", "18" -> "36", "H1" -> "H1". */
export function reciprocalIdent(ident: string): string {
  const m = /^(\d{1,2})([LCR]?)$/.exec(ident.trim().toUpperCase());
  if (!m) return ident;
  let n = (parseInt(m[1], 10) + 18) % 36;
  if (n === 0) n = 36;
  const side = m[2] === 'L' ? 'R' : m[2] === 'R' ? 'L' : m[2];
  return `${n < 10 ? n : String(n)}${side}`;
}

/** Splits a designator into numerals and optional L/C/R letter ("9L" -> ["9", "L"]). */
export function splitDesignator(ident: string): { digits: string; letter: string } {
  const m = /^0?(\d{1,2})([LCR]?)/.exec(ident.trim().toUpperCase());
  if (!m) return { digits: '', letter: '' };
  // AC 150/5340-1M 2.3.5 item 2: a single-digit designator is never preceded by a zero.
  return { digits: String(parseInt(m[1], 10)), letter: m[2] };
}

/** PAPI threshold crossing height by airport class (AC 150/5340-30J Table 7-1). */
function papiTchFt(type: Airport['type'], widthFt: number): number {
  if (type === 'large_airport') return widthFt >= 150 ? 50 : 45; // Height group 3 (B727/757) / 2 (B737)
  if (type === 'medium_airport') return 45; // Height group 2
  return 40; // Height group 1: GA, corporate jets
}

function endModel(
  airport: Airport,
  r: Runway,
  lengthFt: number,
  widthFt: number,
  paved: boolean,
  lighted: boolean,
  largeOrMedium: boolean,
): RunwayEndModel {
  const hasGs = !!(r.ils && r.ils.gsAngleDeg && r.ils.gsAngleDeg > 0);
  const instrument = !!r.ils || (largeOrMedium && paved && lengthFt >= 3000);
  // AC 150/5340-1M Table 2-1: marking scheme by approach type. Which ends have
  // RNAV/non-precision approaches is not in the database; EST: paved runways
  // >= 3000 ft at medium/large airports are treated as non-precision ends.
  let markings: MarkingClass = 'none';
  if (paved) markings = hasGs ? 'precision' : instrument ? 'nonprecision' : 'visual';

  // Approach lights (task spec + AIM 2-1-1): ALSF-2 on ILS ends at large
  // airports, MALSR on other ILS ends and on instrument ends at large
  // airports, none at small airports or unlighted runways.
  let approachLights: ApproachLightSystem = 'NONE';
  if (lighted && paved && airport.type !== 'small_airport') {
    if (hasGs && airport.type === 'large_airport') approachLights = 'ALSF2';
    else if (hasGs || (airport.type === 'large_airport' && instrument)) approachLights = 'MALSR';
  }
  const tdzLights = approachLights === 'ALSF2'; // AC 150/5340-30J 3.2: required for CAT II/III

  const papiAngleDeg = hasGs ? r.ils!.gsAngleDeg! : 3.0; // AC 150/5340-30J 7.5.4.3.4: standard 3 deg
  // AC 150/5340-30J 7.5.4.3.1: D1 = TCH * cot(lowest on-course signal), the
  // third unit set 10' below the glide path (Table 7-2 standard installation).
  const tchFt = papiTchFt(airport.type, widthFt);
  let papiDistFt = tchFt / Math.tan((papiAngleDeg - 10 / 60) * DEG2RAD);
  // AC 150/5340-30J 7.5.4.2: on ILS runways the PAPI path should coincide
  // with the glideslope, so co-locate with the GS antenna when it is known.
  if (hasGs && r.ils!.gsLat !== undefined && r.ils!.gsLon !== undefined) {
    metresPerDegree(r.lat, _mpd);
    const h = r.headingTrue * DEG2RAD;
    const e = lonDelta(r.lon, r.ils!.gsLon!) * _mpd.lon;
    const n = (r.ils!.gsLat! - r.lat) * _mpd.lat;
    const alongFt = (e * Math.sin(h) + n * Math.cos(h)) / FT_TO_M - (r.displacedFt || 0);
    if (alongFt > 500 && alongFt < 2000) papiDistFt = alongFt;
  }
  papiDistFt = Math.min(papiDistFt, lengthFt * 0.35);
  const papi = lighted && paved && lengthFt >= 3000; // EST: PAPI/VASI serve nearly all lighted paved runways >= 3000 ft

  // REIL (AIM 2-1-3): EST on lighted paved ends without an ALS at medium
  // airports or on runways >= 4000 ft.
  const reil = lighted && paved && approachLights === 'NONE' && (largeOrMedium || lengthFt >= 4000);

  // Blast pads (AC 150/5300-13B 3.9): EST 200 ft at large airports, 150 ft on
  // >= 6000 ft runways at medium airports, none elsewhere.
  let blastPadFt = 0;
  if (paved && airport.type === 'large_airport') blastPadFt = 200;
  else if (paved && airport.type === 'medium_airport' && lengthFt >= 6000) blastPadFt = 150;

  return {
    ident: r.ident,
    lat: r.lat,
    lon: r.lon,
    elevationM: (Number.isFinite(r.elevationFt) ? r.elevationFt : airport.elevationFt) * FT_TO_M,
    displacedM: Math.max(0, (r.displacedFt || 0) * FT_TO_M),
    ils: r.ils,
    markings,
    approachLights,
    tdzLights,
    papi,
    papiAngleDeg,
    papiDistM: papiDistFt * FT_TO_M,
    reil,
    blastPadM: blastPadFt * FT_TO_M,
    instrument,
  };
}

/** Builds the runway model for a pair of ends. */
export function buildRunwayModel(airport: Airport, a: Runway, b: Runway): RunwayModel {
  const surface = (a.surface ?? 'unknown') as SurfaceType;
  const paved = isPaved(surface);
  const lighted = !!a.lighted || !!b.lighted;
  const largeOrMedium = airport.type === 'large_airport' || airport.type === 'medium_airport';

  // Local frame at end A; longitude scale at the mid-latitude keeps the
  // equirectangular error second-order over the runway length.
  metresPerDegree((a.lat + b.lat) / 2, _mpd);
  const mLat = _mpd.lat;
  const mLon = _mpd.lon;
  const e = lonDelta(a.lon, b.lon) * mLon;
  const n = (b.lat - a.lat) * mLat;
  let lengthM = Math.hypot(e, n);
  let dirE: number;
  let dirN: number;
  if (lengthM < 30) {
    // Coincident ends in the data: fall back to published heading/length.
    lengthM = Math.max(a.lengthFt, b.lengthFt) * FT_TO_M;
    dirE = Math.sin(a.headingTrue * DEG2RAD);
    dirN = Math.cos(a.headingTrue * DEG2RAD);
  } else {
    dirE = e / lengthM;
    dirN = n / lengthM;
  }
  const lengthFt = lengthM / FT_TO_M;
  const widthFt = Math.max(a.widthFt || 0, b.widthFt || 0) || (paved ? 75 : 100);
  const widthM = widthFt * FT_TO_M;

  const endA = endModel(airport, a, lengthFt, widthFt, paved, lighted, largeOrMedium);
  const endB = endModel(airport, b, lengthFt, widthFt, paved, lighted, largeOrMedium);

  // Shoulders (AC 150/5300-13B Table 3-4): EST 25 ft for large-airport
  // runways (ADG IV), 10 ft at medium airports, none at small ones.
  let shoulderFt = 0;
  if (paved && airport.type === 'large_airport') shoulderFt = widthFt >= 150 ? 25 : 15;
  else if (paved && airport.type === 'medium_airport') shoulderFt = 10;

  const anyAlsf2 = endA.approachLights === 'ALSF2' || endB.approachLights === 'ALSF2';
  // AC 150/5340-30J 3.2 / 3.2.3: centreline lights required for CAT II/III and
  // recommended on runways wider than 170 ft; EST: all large-airport runways >= 150 ft wide.
  const centerlineLights = lighted && paved && (anyAlsf2 || (airport.type === 'large_airport' && widthFt >= 150));
  const hirl = lighted && (endA.markings === 'precision' || endB.markings === 'precision' || airport.type === 'large_airport');

  return {
    id: `${airport.icao} ${a.ident}/${b.ident}`,
    airportIcao: airport.icao,
    airportType: airport.type,
    ends: [endA, endB],
    lengthM,
    widthM,
    shoulderM: shoulderFt * FT_TO_M,
    surface,
    paved,
    lighted,
    centerlineLights,
    hirl,
    lat0: a.lat,
    lon0: a.lon,
    mLat,
    mLon,
    dirE,
    dirN,
    headingTrue: wrap360(Math.atan2(dirE, dirN) * RAD2DEG),
  };
}

/** Converts runway (s, t) metres to lat/lon. */
export function runwayToLatLon(rw: RunwayModel, s: number, t: number, out: { lat: number; lon: number }): { lat: number; lon: number } {
  const e = s * rw.dirE + t * rw.dirN;
  const n = s * rw.dirN - t * rw.dirE;
  out.lat = rw.lat0 + n / rw.mLat;
  out.lon = rw.lon0 + e / rw.mLon;
  return out;
}

/** Converts lat/lon to runway (s, t) metres. */
export function latLonToRunway(rw: RunwayModel, lat: number, lon: number, out: { s: number; t: number }): { s: number; t: number } {
  const e = lonDelta(rw.lon0, lon) * rw.mLon;
  const n = (lat - rw.lat0) * rw.mLat;
  out.s = e * rw.dirE + n * rw.dirN;
  out.t = e * rw.dirN - n * rw.dirE;
  return out;
}

/** Runway surface elevation (m MSL) at along-track position s (linear between ends). */
export function runwayElevation(rw: RunwayModel, s: number): number {
  const f = rw.lengthM > 0 ? Math.min(1, Math.max(0, s / rw.lengthM)) : 0;
  return rw.ends[0].elevationM + (rw.ends[1].elevationM - rw.ends[0].elevationM) * f;
}

const _ll = { lat: 0, lon: 0 };

function surfaceBounds(rw: RunwayModel, s0: number, s1: number, t0: number, t1: number, sf: FlattenSurface): void {
  let south = 90;
  let north = -90;
  let west = Infinity;
  let east = -Infinity;
  const corners: [number, number][] = [
    [s0, t0],
    [s0, t1],
    [s1, t0],
    [s1, t1],
  ];
  for (const [s, t] of corners) {
    runwayToLatLon(rw, s, t, _ll);
    south = Math.min(south, _ll.lat);
    north = Math.max(north, _ll.lat);
    // Longitudes relative to the anchor to stay continuous across the antimeridian.
    const dl = lonDelta(rw.lon0, _ll.lon);
    west = Math.min(west, dl);
    east = Math.max(east, dl);
  }
  sf.south = south;
  sf.north = north;
  sf.west = rw.lon0 + west;
  sf.east = rw.lon0 + east;
  if (sf.west < -180) sf.west += 360;
  if (sf.east > 180) sf.east -= 360;
}

/** Terrain blend distance around airport pads (m). EST: long enough to hide DEM noise, short enough to keep local relief. */
export const FLATTEN_BLEND_M = 150;
/** Render-only terrain depression under pavement (m). */
export const PAVEMENT_SINK_M = 0.35;

function makeSurface(rw: RunwayModel, id: string, pad: { s0: number; s1: number; t0: number; t1: number }, paved: PavedRect[]): FlattenSurface {
  const sf: FlattenSurface = {
    id,
    lat0: rw.lat0,
    lon0: rw.lon0,
    mLat: rw.mLat,
    mLon: rw.mLon,
    dirE: rw.dirE,
    dirN: rw.dirN,
    lengthM: rw.lengthM,
    elevA: rw.ends[0].elevationM,
    elevB: rw.ends[1].elevationM,
    pad,
    blendM: FLATTEN_BLEND_M,
    paved,
    south: 0,
    north: 0,
    west: 0,
    east: 0,
  };
  const m = FLATTEN_BLEND_M;
  surfaceBounds(rw, pad.s0 - m, pad.s1 + m, pad.t0 - m, pad.t1 + m, sf);
  return sf;
}

/**
 * Plans the parallel taxiway and apron beside the longest paved runway.
 * Separations follow AC 150/5300-13B Table 3-8 typical values (EST by
 * airport class since the database has no taxiway geometry).
 */
export function planTaxiway(airport: Airport, runways: RunwayModel[]): TaxiwayPlan | null {
  let main: RunwayModel | null = null;
  for (const r of runways) if (r.paved && (!main || r.lengthM > main.lengthM)) main = r;
  if (!main || main.lengthM < 600) return null;
  const large = airport.type === 'large_airport';
  const medium = airport.type === 'medium_airport';
  // Runway-to-taxiway centreline separation: 400 ft for ADG III cat C/D, 500 ft ADG V; 240 ft ADG II small.
  const offsetM = (large ? 500 : medium ? 400 : 240) * FT_TO_M;
  // Taxiway width by TDG: 75 ft (TDG 5), 50 ft (TDG 3), 25 ft (TDG 1A).
  const widthM = (large ? 75 : medium ? 50 : 25) * FT_TO_M;
  // Hold line: 250 ft ADG III / 200 ft small (AC 150/5300-13B Table 3-8), EST by class.
  const holdLineM = (large || medium ? 250 : 200) * FT_TO_M;

  // Side: towards the airport reference point when it is clearly off-axis.
  const st = latLonToRunway(main, airport.lat, airport.lon, { s: 0, t: 0 });
  const side: 1 | -1 = st.t < -60 ? -1 : 1;

  const s0 = 0;
  const s1 = main.lengthM;
  const connectors: number[] = [30, main.lengthM - 30];
  // EST: an extra connector roughly every 900 m on long runways.
  const nMid = Math.floor(main.lengthM / 900) - 1;
  for (let i = 1; i <= nMid; i++) connectors.push((main.lengthM * i) / (nMid + 1));
  connectors.sort((x, y) => x - y);

  // Apron beyond the taxiway, centred on the runway midpoint (EST sizes by class).
  const apronLen = Math.min(main.lengthM * 0.6, large ? 700 : medium ? 320 : 130);
  const apronDepth = large ? 220 : medium ? 120 : 60;
  const apronGap = widthM / 2 + (large ? 60 : medium ? 40 : 20); // taxiway object-free area to apron edge
  const mid = main.lengthM / 2;
  const tIn = offsetM + apronGap;
  const apron = {
    s0: mid - apronLen / 2,
    s1: mid + apronLen / 2,
    t0: side > 0 ? tIn : -(tIn + apronDepth),
    t1: side > 0 ? tIn + apronDepth : -tIn,
  };
  return { runway: main, side, offsetM, widthM, s0, s1, connectors, holdLineM, apron };
}

/** Builds the full layout for an airport. Returns null when nothing usable. */
export function buildAirportLayout(airport: Airport): AirportLayout | null {
  if (airport.type === 'heliport' || airport.type === 'closed') return null;
  const runways: RunwayModel[] = [];
  for (const [a, b] of pairRunways(airport)) {
    const rw = buildRunwayModel(airport, a, b);
    if (rw.lengthM > 50 && rw.surface !== 'water') runways.push(rw);
  }
  if (runways.length === 0) return null;
  const taxiway = planTaxiway(airport, runways);

  const surfaces: FlattenSurface[] = [];
  for (const rw of runways) {
    const halfPaved = rw.widthM / 2 + rw.shoulderM;
    // Graded runway safety area around the runway: AC 150/5300-13B RSA widths
    // 500 ft (C/D) / 120-150 ft (small); EST half-widths below.
    const rsaHalf = rw.airportType === 'large_airport' ? 75 : rw.airportType === 'medium_airport' ? 60 : 30;
    const blastA = rw.ends[0].blastPadM;
    const blastB = rw.ends[1].blastPadM;
    const paved: PavedRect[] = [
      {
        s0: -blastA,
        s1: rw.lengthM + blastB,
        t0: -halfPaved,
        t1: halfPaved,
        surface: rw.paved ? (rw.surface === 'unknown' ? 'asphalt' : rw.surface) : rw.surface,
        sinkM: rw.paved ? PAVEMENT_SINK_M : 0,
      },
    ];
    const pad = { s0: -blastA - 60, s1: rw.lengthM + blastB + 60, t0: -rsaHalf, t1: rsaHalf };
    if (taxiway && taxiway.runway === rw) {
      // Extend the graded area to cover the taxiway and apron on that side.
      const tw = taxiway;
      // Graded area extends past the apron far edge to hold terminal/hangar buildings (EST 110 m).
      const tOut = tw.side > 0 ? Math.max(tw.apron.t1, tw.offsetM + tw.widthM) + 110 : Math.min(tw.apron.t0, -tw.offsetM - tw.widthM) - 110;
      if (tw.side > 0) pad.t1 = tOut;
      else pad.t0 = tOut;
      const tc = tw.side * tw.offsetM;
      paved.push({ s0: tw.s0 - tw.widthM / 2, s1: tw.s1 + tw.widthM / 2, t0: tc - tw.widthM / 2, t1: tc + tw.widthM / 2, surface: 'asphalt', sinkM: PAVEMENT_SINK_M });
      for (const cs of tw.connectors) {
        const t0 = tw.side > 0 ? halfPaved : tc;
        const t1 = tw.side > 0 ? tc : -halfPaved;
        paved.push({ s0: cs - tw.widthM / 2, s1: cs + tw.widthM / 2, t0, t1, surface: 'asphalt', sinkM: PAVEMENT_SINK_M });
      }
      paved.push({ ...tw.apron, surface: 'concrete', sinkM: PAVEMENT_SINK_M });
    }
    surfaces.push(makeSurface(rw, rw.id, pad, paved));
  }

  const lighted = runways.some((r) => r.lighted);
  let beacon: { lat: number; lon: number } | null = null;
  if (lighted) {
    // EST: beacon beside the apron (or 150 m off the main runway midpoint).
    const main = taxiway?.runway ?? runways[0];
    const t = taxiway ? (taxiway.side > 0 ? taxiway.apron.t1 + 40 : taxiway.apron.t0 - 40) : main.widthM / 2 + 150;
    const s = taxiway ? taxiway.apron.s1 + 30 : main.lengthM / 2;
    beacon = runwayToLatLon(main, s, t, { lat: 0, lon: 0 });
  }

  return {
    airport,
    runways,
    taxiway,
    surfaces,
    beacon,
    elevationM: airport.elevationFt * FT_TO_M,
    importance: airportImportance(airport),
  };
}
