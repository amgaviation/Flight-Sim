/**
 * Start positions: where and how the aircraft is placed for an initial
 * state (pure; unit tested).
 *
 *  - runway (takeoff / ground states): on the centreline, `LINEUP_M` down
 *    the runway from the pavement end, heading = runway true heading;
 *  - parking: spots on the world's generic apron (the nav database has no
 *    gate data), nose toward the runway;
 *  - approach ("10 nm final"): on the extended centreline 10 nm from the
 *    landing threshold, on a 3 deg path (or the ILS glideslope angle) above
 *    the threshold crossing height, flying the runway heading;
 *  - cruise: 40 nm out along the departure runway's heading at the
 *    aircraft's typical cruise altitude.
 */
import type { Airport, Runway } from '../nav/types';
import type { AircraftMeta, InitialState } from '../aircraft/types';
import { buildAirportLayout, runwayToLatLon } from '../world/airports/runwayModel';

export type StartSpot = { kind: 'runway'; runway: string } | { kind: 'parking'; index: number } | { kind: 'auto' };

export interface ParkingSpot {
  index: number;
  name: string;
  lat: number;
  lon: number;
  headingTrue: number;
}

export interface StartPlacement {
  lat: number;
  lon: number;
  headingTrue: number;
  onGround: boolean;
  /** Datum altitude (ft MSL) for in-air placements. */
  altFtMsl?: number;
  iasKt?: number;
  /** Runway used (ident), if any. */
  runway?: Runway;
  /** ILS on the approach runway (auto-tune). */
  ils?: { freqMhz: number; courseTrue: number; ident: string };
  description: string;
}

/** Distance from the pavement end to the line-up point (m). EST: clears the threshold markings with the nose. */
export const LINEUP_M = 45;
/** Approach start distance from the landing threshold (nm). */
export const FINAL_NM = 10;
/** Threshold crossing height (ft), FAA Order 8260.3 typical 50 ft. */
export const TCH_FT = 50;
/** Cruise start distance from the airport (nm). */
export const CRUISE_NM = 40;

const NM_M = 1852;
const FT_M = 0.3048;
const R_M = 6_371_000;

export function destination(lat: number, lon: number, brgDeg: number, distM: number): { lat: number; lon: number } {
  const d = distM / R_M;
  const b = (brgDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: ((((l2 * 180) / Math.PI + 540) % 360) - 180) };
}

/** Runway ends usable for placement (coordinates present). */
export function usableRunways(a: Airport): Runway[] {
  return a.runways.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && !(r.lat === 0 && r.lon === 0) && r.lengthFt > 0);
}

/**
 * Runway end with the largest headwind component for a surface wind (FROM,
 * true); ties and calm wind pick the longest runway. Returns undefined if
 * the airport has no usable runway.
 */
export function bestRunway(a: Airport, windFromDeg = 0, windKt = 0): Runway | undefined {
  let best: Runway | undefined;
  let score = -Infinity;
  for (const r of usableRunways(a)) {
    const head = windKt * Math.cos(((windFromDeg - r.headingTrue) * Math.PI) / 180);
    const s = head * 1000 + r.lengthFt / 100;
    if (s > score) {
      score = s;
      best = r;
    }
  }
  return best;
}

/** Parking spots on the generic apron (up to 8), numbered from the runway's A end. */
export function parkingSpots(a: Airport): ParkingSpot[] {
  let layout;
  try {
    layout = buildAirportLayout(a);
  } catch {
    return [];
  }
  const tw = layout?.taxiway;
  if (!tw) return [];
  const rw = tw.runway;
  const ap = tw.apron;
  const depth = Math.abs(ap.t1 - ap.t0);
  // Parked 40 % into the apron from its runway-side edge, facing the runway.
  const t = tw.side > 0 ? ap.t0 + depth * 0.45 : ap.t1 - depth * 0.45;
  const len = ap.s1 - ap.s0;
  const spacing = Math.max(35, Math.min(70, len / 4)); // EST: wingspan + clearance
  const n = Math.max(1, Math.min(8, Math.floor(len / spacing)));
  const out: ParkingSpot[] = [];
  const faceRunway = (rw.headingTrue + (tw.side > 0 ? -90 : 90) + 360) % 360;
  const p = { lat: 0, lon: 0 };
  for (let i = 0; i < n; i++) {
    const s = ap.s0 + spacing * (i + 0.5) + (len - spacing * n) / 2;
    runwayToLatLon(rw, s, t, p);
    out.push({ index: i, name: `Apron ${i + 1}`, lat: p.lat, lon: p.lon, headingTrue: faceRunway });
  }
  return out;
}

function landingThreshold(r: Runway): { lat: number; lon: number } {
  if (Number.isFinite(r.thresholdLat) && Number.isFinite(r.thresholdLon)) return { lat: r.thresholdLat!, lon: r.thresholdLon! };
  return r.displacedFt > 0 ? destination(r.lat, r.lon, r.headingTrue, r.displacedFt * FT_M) : { lat: r.lat, lon: r.lon };
}

/**
 * Placement for an initial state at an airport.
 * @param wind surface wind (FROM, true, kt) for automatic runway choice
 */
export function planStart(a: Airport, spot: StartSpot, state: InitialState, meta: AircraftMeta, wind: { dir: number; kt: number } = { dir: 0, kt: 0 }): StartPlacement {
  const runwayFor = (): Runway | undefined => (spot.kind === 'runway' ? usableRunways(a).find((r) => r.ident.toUpperCase() === spot.runway.toUpperCase()) : undefined) ?? bestRunway(a, wind.dir, wind.kt);
  if (state === 'approach') {
    const r = runwayFor();
    if (!r) return airborneOver(a, meta, 3000, 'Approach (no runway)');
    const thr = landingThreshold(r);
    const gs = r.ils?.gsAngleDeg ?? 3;
    const p = destination(thr.lat, thr.lon, (r.headingTrue + 180) % 360, FINAL_NM * NM_M);
    const alt = r.elevationFt + TCH_FT + Math.tan((gs * Math.PI) / 180) * FINAL_NM * (NM_M / FT_M);
    return {
      lat: p.lat,
      lon: p.lon,
      headingTrue: r.headingTrue,
      onGround: false,
      altFtMsl: Math.round(alt),
      iasKt: meta.typical.approachKias + 15, // EST: intermediate speed before final flap selection
      runway: r,
      ils: r.ils ? { freqMhz: r.ils.freqMhz, courseTrue: r.ils.courseTrue, ident: r.ils.ident } : undefined,
      description: `${FINAL_NM} nm final runway ${r.ident}${r.ils ? ` (ILS ${r.ils.ident} ${r.ils.freqMhz.toFixed(2)})` : ''}`,
    };
  }
  if (state === 'cruise') {
    const r = runwayFor();
    const hdg = r?.headingTrue ?? 0;
    const p = destination(a.lat, a.lon, hdg, CRUISE_NM * NM_M);
    return { ...airborneAt(p.lat, p.lon, hdg, meta), runway: r, description: `Cruise FL${Math.round(meta.typical.cruiseAltFt / 100)} ${CRUISE_NM} nm from ${a.icao}` };
  }
  if (spot.kind === 'parking' && state !== 'takeoff') {
    const spots = parkingSpots(a);
    const s = spots[Math.min(spots.length - 1, Math.max(0, spot.index))];
    if (s) return { lat: s.lat, lon: s.lon, headingTrue: s.headingTrue, onGround: true, description: `${a.icao} ${s.name}` };
  }
  const r = runwayFor();
  if (!r) return { lat: a.lat, lon: a.lon, headingTrue: 0, onGround: true, description: `${a.icao} reference point` };
  const p = destination(r.lat, r.lon, r.headingTrue, LINEUP_M);
  return { lat: p.lat, lon: p.lon, headingTrue: r.headingTrue, onGround: true, runway: r, description: `${a.icao} runway ${r.ident}` };
}

function airborneAt(lat: number, lon: number, hdg: number, meta: AircraftMeta): StartPlacement {
  const alt = meta.typical.cruiseAltFt;
  return { lat, lon, headingTrue: hdg, onGround: false, altFtMsl: alt, iasKt: cruiseIas(meta.typical.cruiseKtas, alt), description: 'Cruise' };
}

function airborneOver(a: Airport, meta: AircraftMeta, aglFt: number, description: string): StartPlacement {
  return { lat: a.lat, lon: a.lon, headingTrue: 0, onGround: false, altFtMsl: a.elevationFt + aglFt, iasKt: meta.typical.approachKias + 20, description };
}

/**
 * Indicated (calibrated) airspeed for a true airspeed at a pressure altitude
 * in the ISA (ICAO Doc 7488): subsonic compressible pitot relation.
 */
export function cruiseIas(ktas: number, altFt: number): number {
  const h = altFt * FT_M;
  const T0 = 288.15;
  const P0 = 101325;
  const T = h < 11000 ? T0 - 0.0065 * h : 216.65;
  const p = h < 11000 ? P0 * Math.pow(T / T0, 5.25588) : 22632.06 * Math.exp((-9.80665 * (h - 11000)) / (287.053 * 216.65));
  const a = Math.sqrt(1.4 * 287.053 * T);
  const a0 = 340.294;
  const M = (ktas * 0.514444) / a;
  const qc = p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  const cas = a0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
  return cas / 0.514444;
}
