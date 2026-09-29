/**
 * Converts the OurAirports CSV exports (public domain,
 * https://davidmegginson.github.io/ourairports-data/) into the compact rows of
 * `format.ts`. Used by `scripts/build-navdata.mjs`.
 *
 * Runtime-import rule: loaded by Node type stripping, so only `import type`
 * from sibling modules.
 */
import type { CsvTable } from './csv';
import type {
  AirportRow,
  AirportTypeCode,
  EnrouteNavaidType,
  FreqRow,
  NavaidRow,
  RunwayRow,
  SurfaceCode,
} from './format';

function num(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.trim();
  if (!t) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

function orNull(v: number, decimals: number): number | null {
  if (!Number.isFinite(v)) return null;
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/** Rounds a coordinate to 6 decimals (~0.1 m). */
export function roundCoord(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Maps OurAirports free-text runway surface strings (e.g. 'ASPH-G', 'TURF',
 * 'GRVL', 'CONC', 'PEM') to a surface code. PEM = "partially concrete,
 * asphalt or bitumen-bound macadam" (OurAirports data dictionary) -> asphalt.
 * 'GRE' = graded/rolled earth with grass -> grass.
 */
export function normalizeSurface(raw: string): SurfaceCode {
  const s = raw.trim().toUpperCase();
  if (!s) return 'U';
  if (/^WAT/.test(s)) return 'W';
  if (/SNOW|^ICE/.test(s)) return 'S';
  if (/^(ASP|BIT|TAR|PEM|PAV|MAC|BLACK|SEAL|BRI)/.test(s)) return 'A';
  if (/^(CON|CEM|PCC|CONCRETE)/.test(s)) return 'C';
  if (/^(GRAV|GRV|GVL|COR|CRUSH|PI[CÇ]ARRA|CALICHE|SHALE|STONE|ROCK|MURRAM|LIME)/.test(s)) return 'V';
  if (/^(TURF|GRASS|GRS|GRE|SOD|GRAS|GRAM)/.test(s)) return 'G';
  if (/^(DIRT|EARTH|SAND|CLAY|SOIL|LAT|LOAM|SILT|MUD|GROUND)/.test(s)) return 'D';
  return 'U';
}

const AIRPORT_TYPES: Record<string, AirportTypeCode | undefined> = {
  large_airport: 'L',
  medium_airport: 'M',
  small_airport: 'S',
  heliport: 'H',
  seaplane_base: 'W',
  // 'closed' and 'balloonport' are excluded.
};

/** Great-circle initial bearing (deg true) - local copy (no runtime imports allowed here). */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r;
  const p2 = lat2 * r;
  const dl = (lon2 - lon1) * r;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

export interface OurAirportsBuildResult {
  rows: AirportRow[];
  /** Index into `rows` by every code (ident, gps, icao, local, iata) for matching other sources. */
  byCode: Map<string, number[]>;
  skipped: { closed: number; balloonport: number; closedRunways: number };
}

/** Builds airport rows (with runways and frequencies) from the three OurAirports tables. */
export function buildAirports(airports: CsvTable, runways: CsvTable, freqs: CsvTable): OurAirportsBuildResult {
  // --- runways by airport ident
  const rw = {
    ident: runways.col('airport_ident'),
    length: runways.col('length_ft'),
    width: runways.col('width_ft'),
    surface: runways.col('surface'),
    lighted: runways.col('lighted'),
    closed: runways.col('closed'),
    leIdent: runways.col('le_ident'),
    leLat: runways.col('le_latitude_deg'),
    leLon: runways.col('le_longitude_deg'),
    leElev: runways.col('le_elevation_ft'),
    leHdg: runways.col('le_heading_degT'),
    leDisp: runways.col('le_displaced_threshold_ft'),
    heIdent: runways.col('he_ident'),
    heLat: runways.col('he_latitude_deg'),
    heLon: runways.col('he_longitude_deg'),
    heElev: runways.col('he_elevation_ft'),
    heHdg: runways.col('he_heading_degT'),
    heDisp: runways.col('he_displaced_threshold_ft'),
  };
  const runwaysByAirport = new Map<string, RunwayRow[]>();
  let closedRunways = 0;
  for (const r of runways.rows) {
    if (r[rw.closed] === '1') {
      closedRunways++;
      continue;
    }
    const leLat = num(r[rw.leLat]);
    const leLon = num(r[rw.leLon]);
    const heLat = num(r[rw.heLat]);
    const heLon = num(r[rw.heLon]);
    let leHdg = num(r[rw.leHdg]);
    let heHdg = num(r[rw.heHdg]);
    const haveBoth = Number.isFinite(leLat) && Number.isFinite(leLon) && Number.isFinite(heLat) && Number.isFinite(heLon);
    if (haveBoth && !(leLat === heLat && leLon === heLon)) {
      // Prefer the geometric heading; it is consistent with the end coordinates.
      if (!Number.isFinite(leHdg)) leHdg = bearing(leLat, leLon, heLat, heLon);
      if (!Number.isFinite(heHdg)) heHdg = bearing(heLat, heLon, leLat, leLon);
    } else if (Number.isFinite(leHdg) && !Number.isFinite(heHdg)) {
      heHdg = (leHdg + 180) % 360;
    } else if (Number.isFinite(heHdg) && !Number.isFinite(leHdg)) {
      leHdg = (heHdg + 180) % 360;
    }
    const row: RunwayRow = [
      orNull(num(r[rw.length]), 0),
      orNull(num(r[rw.width]), 0),
      normalizeSurface(r[rw.surface] ?? ''),
      r[rw.lighted] === '1' ? 1 : 0,
      (r[rw.leIdent] ?? '').trim(),
      Number.isFinite(leLat) ? roundCoord(leLat) : null,
      Number.isFinite(leLon) ? roundCoord(leLon) : null,
      orNull(num(r[rw.leElev]), 0),
      orNull(leHdg, 1),
      orNull(num(r[rw.leDisp]), 0),
      (r[rw.heIdent] ?? '').trim(),
      Number.isFinite(heLat) ? roundCoord(heLat) : null,
      Number.isFinite(heLon) ? roundCoord(heLon) : null,
      orNull(num(r[rw.heElev]), 0),
      orNull(heHdg, 1),
      orNull(num(r[rw.heDisp]), 0),
    ];
    const key = r[rw.ident];
    let list = runwaysByAirport.get(key);
    if (!list) runwaysByAirport.set(key, (list = []));
    list.push(row);
  }

  // --- frequencies by airport ident
  const fq = { ident: freqs.col('airport_ident'), type: freqs.col('type'), desc: freqs.col('description'), mhz: freqs.col('frequency_mhz') };
  const freqsByAirport = new Map<string, FreqRow[]>();
  for (const r of freqs.rows) {
    const mhz = num(r[fq.mhz]);
    if (!Number.isFinite(mhz) || mhz <= 0) continue;
    const key = r[fq.ident];
    let list = freqsByAirport.get(key);
    if (!list) freqsByAirport.set(key, (list = []));
    list.push([(r[fq.type] ?? '').trim().toUpperCase(), (r[fq.desc] ?? '').trim(), Math.round(mhz * 1000) / 1000]);
  }

  // --- airports
  const ap = {
    ident: airports.col('ident'),
    type: airports.col('type'),
    name: airports.col('name'),
    lat: airports.col('latitude_deg'),
    lon: airports.col('longitude_deg'),
    elev: airports.col('elevation_ft'),
    country: airports.col('iso_country'),
    municipality: airports.col('municipality'),
    icao: airports.col('icao_code'),
    iata: airports.col('iata_code'),
    gps: airports.col('gps_code'),
    local: airports.col('local_code'),
  };
  const rows: AirportRow[] = [];
  const byCode = new Map<string, number[]>();
  const addCode = (code: string, idx: number): void => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    let l = byCode.get(c);
    if (!l) byCode.set(c, (l = []));
    if (!l.includes(idx)) l.push(idx);
  };
  let closed = 0;
  let balloonport = 0;
  for (const r of airports.rows) {
    const t = r[ap.type];
    const code = AIRPORT_TYPES[t];
    if (!code) {
      if (t === 'closed') closed++;
      else if (t === 'balloonport') balloonport++;
      continue;
    }
    const lat = num(r[ap.lat]);
    const lon = num(r[ap.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ident = r[ap.ident].trim();
    const row: AirportRow = [
      ident,
      (r[ap.name] ?? '').trim(),
      code,
      roundCoord(lat),
      roundCoord(lon),
      orNull(num(r[ap.elev]), 0),
      (r[ap.country] ?? '').trim(),
      (r[ap.municipality] ?? '').trim(),
      (r[ap.iata] ?? '').trim(),
      (r[ap.gps] ?? '').trim(),
      (r[ap.local] ?? '').trim(),
      (r[ap.icao] ?? '').trim(),
      runwaysByAirport.get(ident) ?? [],
      freqsByAirport.get(ident) ?? [],
      null,
    ];
    const idx = rows.length;
    rows.push(row);
    addCode(ident, idx);
    addCode(row[9], idx);
    addCode(row[10], idx);
    addCode(row[11], idx);
    addCode(row[8], idx);
  }
  return { rows, byCode, skipped: { closed, balloonport, closedRunways } };
}

// ------------------------------------------------------------------ navaids

const NAVAID_TYPES: Record<string, EnrouteNavaidType | undefined> = {
  VOR: 'VOR',
  'VOR-DME': 'VORDME',
  VORTAC: 'VORTAC',
  TACAN: 'TACAN',
  DME: 'DME',
  NDB: 'NDB',
  'NDB-DME': 'NDBDME',
};

/**
 * Standard service volume radius (nm) for a navaid.
 *
 * VOR/DME/TACAN (AIM 1-1-8, Table 1-1-1): Terminal 25 nm, Low 40 nm,
 * High 130 nm (18,000-45,000 ft). OurAirports publishes a usage type
 * (HI/LO/BOTH/TERMINAL/RNAV) and a power class (HIGH/MEDIUM/LOW); the smaller
 * of the two implied radii is used. EST: HIGH power ~ H class (130 nm),
 * MEDIUM ~ L class (40 nm), LOW ~ T class (25 nm); default 40 nm.
 *
 * NDB (AIM 1-1-8, Table 1-1-2): compass locator 15 nm, MH 25 nm, H 50 nm,
 * HH 75 nm. EST mapping of OurAirports power: HIGH -> HH (75), MEDIUM -> H
 * (50), LOW -> MH (25); TERMINAL usage with LOW power -> compass locator (15).
 */
export function serviceRangeNm(type: EnrouteNavaidType, usage: string, power: string): number {
  const u = usage.trim().toUpperCase();
  const p = power.trim().toUpperCase();
  if (type === 'NDB' || type === 'NDBDME') {
    if (u === 'TERMINAL' && (p === 'LOW' || p === '')) return 15;
    if (p === 'HIGH') return 75;
    if (p === 'MEDIUM') return 50;
    if (p === 'LOW') return 25;
    return 25;
  }
  const byUsage = u === 'HI' || u === 'BOTH' ? 130 : u === 'LO' ? 40 : u === 'TERMINAL' ? 25 : NaN;
  const byPower = p === 'HIGH' ? 130 : p === 'MEDIUM' ? 40 : p === 'LOW' ? 25 : NaN;
  const v = Math.min(Number.isFinite(byUsage) ? byUsage : Infinity, Number.isFinite(byPower) ? byPower : Infinity);
  return Number.isFinite(v) ? v : 40;
}

/** Builds navaid rows from OurAirports `navaids.csv`. */
export function buildNavaids(t: CsvTable): NavaidRow[] {
  const c = {
    ident: t.col('ident'),
    name: t.col('name'),
    type: t.col('type'),
    freq: t.col('frequency_khz'),
    lat: t.col('latitude_deg'),
    lon: t.col('longitude_deg'),
    elev: t.col('elevation_ft'),
    country: t.col('iso_country'),
    dmeLat: t.col('dme_latitude_deg'),
    dmeLon: t.col('dme_longitude_deg'),
    dmeElev: t.col('dme_elevation_ft'),
    dmeChannel: t.col('dme_channel'),
    slaved: t.col('slaved_variation_deg'),
    magVar: t.col('magnetic_variation_deg'),
    usage: t.col('usageType'),
    power: t.col('power'),
    airport: t.col('associated_airport'),
  };
  const out: NavaidRow[] = [];
  for (const r of t.rows) {
    const type = NAVAID_TYPES[r[c.type]];
    if (!type) continue;
    const lat = num(r[c.lat]);
    const lon = num(r[c.lon]);
    const fkhz = num(r[c.freq]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(fkhz) || fkhz <= 0) continue;
    const isNdb = type === 'NDB' || type === 'NDBDME';
    const freq = isNdb ? Math.round(fkhz * 10) / 10 : Math.round(fkhz / 10) / 100;
    // VHF frequencies must be in the 108-118 MHz nav band; drop garbage.
    if (!isNdb && (freq < 108 || freq > 118)) continue;
    if (isNdb && (freq < 150 || freq > 1800)) continue;
    const isVor = type === 'VOR' || type === 'VORDME' || type === 'VORTAC';
    const slaved = num(r[c.slaved]);
    const local = num(r[c.magVar]);
    const magVar = isVor && Number.isFinite(slaved) ? slaved : local;
    let dmeLat = num(r[c.dmeLat]);
    let dmeLon = num(r[c.dmeLon]);
    // Omit the DME position when co-located (within ~10 m).
    if (Number.isFinite(dmeLat) && Number.isFinite(dmeLon) && Math.abs(dmeLat - lat) < 1e-4 && Math.abs(dmeLon - lon) < 1e-4) {
      dmeLat = NaN;
      dmeLon = NaN;
    }
    out.push([
      r[c.ident].trim(),
      (r[c.name] ?? '').trim(),
      type,
      roundCoord(lat),
      roundCoord(lon),
      orNull(num(r[c.elev]), 0),
      freq,
      serviceRangeNm(type, r[c.usage] ?? '', r[c.power] ?? ''),
      orNull(magVar, 2),
      Number.isFinite(dmeLat) ? roundCoord(dmeLat) : null,
      Number.isFinite(dmeLon) ? roundCoord(dmeLon) : null,
      orNull(num(r[c.dmeElev]), 0),
      (r[c.country] ?? '').trim(),
      (r[c.usage] ?? '').trim().toUpperCase(),
      (r[c.airport] ?? '').trim(),
      (r[c.dmeChannel] ?? '').trim().replace(/^0+/, ''),
    ]);
  }
  return out;
}
