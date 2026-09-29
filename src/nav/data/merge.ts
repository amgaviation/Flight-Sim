/**
 * Source-merging helpers for `scripts/build-navdata.mjs`: FlightGear
 * (X-Plane 810) ILS/fix/airway data combined with the current FAA CIFP for
 * the United States, and cross-source airport ident matching.
 *
 * Policy (documented in docs/modules/nav.md):
 *  - Localizers: CIFP replaces FlightGear for every airport the CIFP covers.
 *    Marker beacons (not in the CIFP) come from FlightGear and are kept only
 *    where the runway still has a localizer.
 *  - Fixes: CIFP enroute + named terminal waypoints are added; a FlightGear
 *    fix is dropped when a CIFP fix with the same ident lies within 30 nm
 *    (duplicate or moved fix).
 *  - Airways: for every airway name present in the CIFP, FlightGear segments
 *    of that name within 150 nm of the CIFP airway are replaced.
 *
 * Runtime-import rule: loaded by Node type stripping; `import type` only.
 */
import type { AirportRow, AirwayRow, LocKind, LocRow, MarkerRow } from './format';
import type { AwyDatRecord, FixDatRecord, NavDatRecord } from './xplane';

const EARTH_RADIUS_NM = 3440.065;

/** Haversine distance in nm (local copy: no runtime imports allowed here). */
export function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dp = (lat2 - lat1) * r;
  const dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * EARTH_RADIUS_NM;
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * Finds the airport row index for an ident used by another source (ICAO code,
 * FAA LID, GPS code). When a position is given, candidates farther than
 * `maxNm` are rejected and the nearest wins.
 */
export function matchAirport(
  rows: AirportRow[],
  byCode: Map<string, number[]>,
  ident: string,
  lat = NaN,
  lon = NaN,
  maxNm = 10,
): number {
  const tryCodes = [ident.toUpperCase()];
  if (ident.length === 3 && /^[A-Z0-9]{3}$/.test(ident)) tryCodes.push('K' + ident.toUpperCase());
  let best = -1;
  let bestD = Infinity;
  for (const c of tryCodes) {
    const cands = byCode.get(c);
    if (!cands) continue;
    for (const i of cands) {
      const row = rows[i];
      const d = Number.isFinite(lat) ? distNm(lat, lon, row[3], row[4]) : 0;
      if (d > maxNm) continue;
      // Prefer the row whose primary ident equals the code, then distance.
      const bias = row[0].toUpperCase() === c ? -0.5 : 0;
      if (d + bias < bestD) {
        bestD = d + bias;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  return best;
}

/** Normalises a runway ident for matching: '4L' / '04L' / 'RW04L' -> '04L'. */
export function normRunway(id: string): string {
  const t = id.trim().toUpperCase().replace(/^RW/, '');
  const m = /^(\d{1,2})([LCR]?)$/.exec(t);
  if (!m) return t;
  return m[1].padStart(2, '0') + m[2];
}

/**
 * Builds localizer and marker rows from FlightGear nav.dat records. `mapAirport`
 * converts the nav.dat ICAO code to the database airport ident ('' = unknown,
 * record dropped).
 */
export function buildFgIls(
  recs: NavDatRecord[],
  mapAirport: (icao: string, lat: number, lon: number) => string,
): { localizers: LocRow[]; markers: MarkerRow[] } {
  const gsBy = new Map<string, NavDatRecord>();
  const dmeBy = new Map<string, NavDatRecord>();
  for (const r of recs) {
    if (r.code === 6) gsBy.set(`${r.airport}|${normRunway(r.runway)}|${r.ident}`, r);
    else if (r.code === 12 && r.airport) dmeBy.set(`${r.airport}|${normRunway(r.runway)}|${r.ident}`, r);
  }
  const localizers: LocRow[] = [];
  const markers: MarkerRow[] = [];
  for (const r of recs) {
    if (r.code === 4 || r.code === 5) {
      const apt = mapAirport(r.airport, r.lat, r.lon);
      if (!apt) continue;
      const rw = normRunway(r.runway);
      const key = `${r.airport}|${rw}|${r.ident}`;
      const gs = r.code === 4 ? gsBy.get(key) : undefined;
      const dme = dmeBy.get(key);
      const name = r.name.toUpperCase();
      let kind: LocKind = r.code === 4 ? 'ILS' : 'LOC';
      if (name.startsWith('LDA')) kind = 'LDA';
      else if (name.startsWith('SDF')) kind = 'SDF';
      else if (name.startsWith('IGS')) kind = 'IGS';
      const cat = /CAT-(III|II|I)\b/.exec(name);
      let gsAngle: number | null = null;
      if (gs) gsAngle = Math.floor(gs.extra / 1000) / 100;
      if (kind === 'ILS' && !(gsAngle && gsAngle > 0)) kind = 'LOC';
      localizers.push([
        apt,
        rw,
        r.ident,
        kind,
        Math.round(r.freq * 100) / 100,
        r6(r.lat),
        r6(r.lon),
        Number.isFinite(r.elevFt) ? r.elevFt : null,
        Math.round(r.extra * 100) / 100,
        null,
        gs && gsAngle && gsAngle > 0 ? gsAngle : null,
        gs && gsAngle ? r6(gs.lat) : null,
        gs && gsAngle ? r6(gs.lon) : null,
        gs && gsAngle && Number.isFinite(gs.elevFt) ? gs.elevFt : null,
        dme ? r6(dme.lat) : null,
        dme ? r6(dme.lon) : null,
        dme && Number.isFinite(dme.elevFt) ? dme.elevFt : null,
        null,
        cat ? cat[1] : '',
        null,
        'FG',
      ]);
    } else if (r.code === 7 || r.code === 8 || r.code === 9) {
      const apt = mapAirport(r.airport, r.lat, r.lon);
      if (!apt) continue;
      markers.push([
        r.code === 7 ? 'OM' : r.code === 8 ? 'MM' : 'IM',
        r6(r.lat),
        r6(r.lon),
        Number.isFinite(r.elevFt) ? r.elevFt : null,
        Math.round(r.extra * 100) / 100,
        apt,
        normRunway(r.runway),
      ]);
    }
  }
  return { localizers, markers };
}

/** Merges localizers: CIFP rows replace FlightGear rows for airports the CIFP covers. */
export function mergeLocalizers(fg: LocRow[], cifp: LocRow[], fgMarkers: MarkerRow[]): { localizers: LocRow[]; markers: MarkerRow[] } {
  const cifpAirports = new Set(cifp.map((r) => r[0]));
  const localizers = fg.filter((r) => !cifpAirports.has(r[0])).concat(cifp);
  const withLoc = new Set(localizers.map((r) => `${r[0]}|${normRunway(r[1])}`));
  const markers = fgMarkers.filter((m) => withLoc.has(`${m[5]}|${m[6]}`));
  return { localizers, markers };
}

export interface FixOut {
  ident: string;
  lat: number;
  lon: number;
  region: string;
}

/**
 * ARINC 424 names for procedure-local unnamed fixes (course fix, final
 * approach fix, missed approach point, runway, ...). They are only meaningful
 * inside their procedure and stay out of the global fix index.
 */
const PROCEDURE_LOCAL_FIX = /^(CF|FF|MA|RW|FD|CI|CD|FA|FI|TD|OM|MM|IM|RX|FX)\d{2}[LCR]?$/;

/** Merges FlightGear fixes with CIFP enroute and terminal waypoints. */
export function mergeFixes(fg: FixDatRecord[], cifpEnroute: FixOut[], cifpTerminal: FixOut[]): FixOut[] {
  const out: FixOut[] = [];
  const cifpByIdent = new Map<string, FixOut[]>();
  const add = (f: FixOut): void => {
    let l = cifpByIdent.get(f.ident);
    if (!l) cifpByIdent.set(f.ident, (l = []));
    // Terminal waypoints repeat per airport; keep one per position.
    for (const e of l) if (distNm(e.lat, e.lon, f.lat, f.lon) < 0.1) return;
    l.push(f);
    out.push({ ident: f.ident, lat: r6(f.lat), lon: r6(f.lon), region: f.region });
  };
  for (const f of cifpEnroute) if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) add(f);
  for (const f of cifpTerminal) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon) || PROCEDURE_LOCAL_FIX.test(f.ident)) continue;
    add(f);
  }
  for (const f of fg) {
    const l = cifpByIdent.get(f.ident);
    if (l && l.some((c) => distNm(c.lat, c.lon, f.lat, f.lon) < 30)) continue;
    out.push({ ident: f.ident, lat: r6(f.lat), lon: r6(f.lon), region: '' });
  }
  return out;
}

/** Converts FlightGear awy.dat records to rows, one row per airway name. */
export function fgAirwayRows(recs: AwyDatRecord[]): AirwayRow[] {
  const rows: AirwayRow[] = [];
  for (const r of recs) {
    for (const name of r.names) {
      rows.push([name, r.from, r6(r.fromLat), r6(r.fromLon), r.to, r6(r.toLat), r6(r.toLon), r.level, r.baseFt || null, r.topFt || null, 0]);
    }
  }
  return rows;
}

/** Replaces FlightGear airway segments by CIFP segments of the same airway name near the CIFP airway. */
export function mergeAirways(fg: AirwayRow[], cifp: AirwayRow[]): AirwayRow[] {
  const pts = new Map<string, [number, number][]>();
  for (const r of cifp) {
    let l = pts.get(r[0]);
    if (!l) pts.set(r[0], (l = []));
    l.push([r[2], r[3]], [r[5], r[6]]);
  }
  const near = (name: string, lat: number, lon: number): boolean => {
    const l = pts.get(name);
    if (!l) return false;
    for (const p of l) if (distNm(p[0], p[1], lat, lon) < 150) return true;
    return false;
  };
  const kept = fg.filter((r) => !(near(r[0], r[2], r[3]) || near(r[0], r[5], r[6])));
  return kept.concat(cifp);
}
