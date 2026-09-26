/**
 * In-memory navigation database backed by the generated files in
 * `public/data/` (see `nav/data/format.ts` and `scripts/build-navdata.mjs`).
 *
 * - `load()` fetches `./data/*.json.gz` relative to the page (works from the
 *   Vite dev server, `vite preview` and the Electron `app://` protocol) and
 *   gunzips with `DecompressionStream('gzip')`. Files served already
 *   decompressed (a server adding `Content-Encoding: gzip`) are detected by
 *   the missing gzip magic bytes. Tests inject a loader
 *   (`nav/data/nodeLoader.ts`).
 * - Airports are stored as the compact rows and materialised to `Airport`
 *   objects on demand (bounded cache), so start-up stays fast.
 * - Spatial queries use 1-degree `GeoGrid` buckets; ident lookups use maps.
 * - `loadProcedures(icao)` returns published FAA CIFP procedures (US) plus
 *   synthetic ILS/RNAV approaches for every runway end without one.
 *
 * Magnetic variation (airports, stations without published declination,
 * synthetic runway headings) comes from the WMM2025 model in `core/wmm.ts`.
 */
import type {
  Airport,
  AirportProcedures,
  AirwaySegment,
  Fix,
  IlsInfo,
  Navaid,
  NavaidType,
  NavDatabase,
  Runway,
  Waypoint,
} from './types';
import type {
  AirportRow,
  AirportsFile,
  AirwaysFile,
  FixesFile,
  IlsFile,
  LocRow,
  NavaidsFile,
  NavdataMeta,
  ProceduresFile,
  ProceduresIndexFile,
  RunwayRow,
} from './data/format';
import { AIRPORT_TYPE_CODES, SURFACE_CODES } from './data/format';
import { GeoGrid } from './GeoGrid';
import { distanceNm, destinationPoint } from '../core/geo';
import { magneticDeclination, decimalYear } from '../core/wmm';
import { decodeProcedureFile, normalizeRunwayIdent } from './procedures';
import { synthesizeApproaches } from './flightplan/synthetic';

/** Returns the raw bytes (gzip or plain) or text of a data file relative to the data root, or undefined when missing. */
export type NavDataFileLoader = (file: string) => Promise<Uint8Array | ArrayBuffer | string | undefined>;

export interface NavDatabaseOptions {
  /** URL prefix of the data folder (default './data/', i.e. relative to the page). */
  baseUrl?: string;
  /** Custom file loader (tests, Node scripts). Overrides `baseUrl`. */
  loader?: NavDataFileLoader;
  /** Decimal year for magnetic variation (default: current date). */
  magVarYear?: number;
  /** Add synthetic approaches in `loadProcedures` (default true). */
  synthesizeApproaches?: boolean;
  /** Progress / warning messages. */
  onProgress?: (message: string) => void;
}

const FT_PER_NM = 6076.12;
const AIRPORT_CACHE_MAX = 8000;

/** Localizer / ILS nominal coverage used for `Navaid.rangeNm` (AIM 1-1-9 b.5: 18 nm SSV). */
const LOC_RANGE_NM = 18;
/** Glideslope usable distance (AIM 1-1-9 c.4: normally usable to 10 nm). */
const GS_RANGE_NM = 10;
/** ILS DME (AIM 1-1-7: DME reliable to 199 nm LOS; ILS DME serves the localizer volume). */
const ILS_DME_RANGE_NM = 25;

/** Gunzips (when gzip magic present) and decodes UTF-8. Uses DecompressionStream (browser and Node >= 18). */
export async function decodeDataFile(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  if (typeof data === 'string') return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const stream = new Blob([copy]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

/** Default browser loader: `fetch(baseUrl + file)`; undefined on 404. */
export function fetchLoader(baseUrl: string): NavDataFileLoader {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return async (file) => {
    const res = await fetch(base + file);
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  };
}

/** Heading (deg, magnetic) implied by a runway designator: '09L' -> 90, 'N' -> 360 (true), 'NE' -> 45 (true). */
export function headingFromRunwayIdent(ident: string): { deg: number; isTrue: boolean } | null {
  const t = ident.trim().toUpperCase();
  const m = /^0?(\d{1,2})[LCR]?$/.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 36) return { deg: n * 10, isTrue: false };
    return null;
  }
  const card: Record<string, number> = { N: 360, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  if (t in card) return { deg: card[t], isTrue: true };
  return null;
}

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

function isVhfType(t: NavaidType): boolean {
  return t !== 'NDB' && t !== 'NDBDME' && t !== 'OM' && t !== 'MM' && t !== 'IM';
}

function freqKey(freq: number): number {
  return Math.round(freq * 100);
}

export class NavDatabaseImpl implements NavDatabase {
  private _ready = false;
  private loading: Promise<void> | null = null;
  private readonly loader: NavDataFileLoader;
  private readonly year: number;
  private readonly opts: NavDatabaseOptions;

  // airports
  private airportRows: AirportRow[] = [];
  private airportLat = new Float64Array(0);
  private airportLon = new Float64Array(0);
  private airportGrid: GeoGrid | null = null;
  private readonly airportCodes = new Map<string, number[]>();
  private readonly airportCache = new Map<number, Airport>();
  private searchText: string[] | null = null;

  // navaids (enroute + ILS components + markers)
  private navaids: Navaid[] = [];
  private navaidGrid: GeoGrid | null = null;
  private readonly navaidIdent = new Map<string, Navaid[]>();
  private readonly navaidFreq = new Map<number, Navaid[]>();
  private readonly ilsByRunway = new Map<string, IlsInfo>();

  // fixes
  private fixIdent: string[] = [];
  private fixRegion: string[] = [];
  private fixLat = new Float64Array(0);
  private fixLon = new Float64Array(0);
  private fixGrid: GeoGrid | null = null;
  private readonly fixByIdent = new Map<string, number[]>();

  // airways
  private airwayRows: AirwaysFile['rows'] = [];
  private readonly airwayByName = new Map<string, number[]>();
  private readonly airwayCache = new Map<string, AirwaySegment[]>();
  private airwaysByFix: Map<string, Set<string>> | null = null;

  // procedures
  private procIndex: ProceduresIndexFile | null = null;
  private readonly procCache = new Map<string, Promise<AirportProcedures | undefined>>();

  /** Contents of `meta.json` (sources, cycles, counts), when present. */
  meta: NavdataMeta | null = null;

  constructor(options: NavDatabaseOptions = {}) {
    this.opts = options;
    this.loader = options.loader ?? fetchLoader(options.baseUrl ?? './data/');
    this.year = options.magVarYear ?? decimalYear(new Date());
  }

  get ready(): boolean {
    return this._ready;
  }

  /** Number of airports / navaids / fixes / airway segments loaded. */
  get counts(): { airports: number; navaids: number; fixes: number; airwaySegments: number } {
    return { airports: this.airportRows.length, navaids: this.navaids.length, fixes: this.fixIdent.length, airwaySegments: this.airwayRows.length };
  }

  /** Loads all data files. Safe to call more than once (returns the same promise). */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.doLoad();
    return this.loading;
  }

  private progress(msg: string): void {
    this.opts.onProgress?.(msg);
  }

  private async json<T>(file: string, required: boolean): Promise<T | undefined> {
    const raw = await this.loader(file);
    if (raw === undefined) {
      if (required) throw new Error(`nav data file missing: ${file}`);
      return undefined;
    }
    return JSON.parse(await decodeDataFile(raw)) as T;
  }

  private async doLoad(): Promise<void> {
    const [airports, navaids, ils, fixes, airways, procIndex, meta] = await Promise.all([
      this.json<AirportsFile>('airports.json.gz', true),
      this.json<NavaidsFile>('navaids.json.gz', true),
      this.json<IlsFile>('ils.json.gz', true),
      this.json<FixesFile>('fixes.json.gz', true),
      this.json<AirwaysFile>('airways.json.gz', true),
      this.json<ProceduresIndexFile>('procedures/index.json', false).catch(() => undefined),
      this.json<NavdataMeta>('meta.json', false).catch(() => undefined),
    ]);
    this.meta = meta ?? null;
    this.procIndex = procIndex ?? null;
    this.indexAirports(airports!);
    this.indexIls(ils!);
    this.indexNavaids(navaids!, ils!);
    this.indexFixes(fixes!);
    this.indexAirways(airways!);
    this._ready = true;
    const c = this.counts;
    this.progress(`nav database: ${c.airports} airports, ${c.navaids} navaids, ${c.fixes} fixes, ${c.airwaySegments} airway segments`);
  }

  // ------------------------------------------------------------ indexing

  private indexAirports(f: AirportsFile): void {
    const rows = f.rows;
    this.airportRows = rows;
    const n = rows.length;
    this.airportLat = new Float64Array(n);
    this.airportLon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      this.airportLat[i] = r[3];
      this.airportLon[i] = r[4];
      for (const code of [r[0], r[11], r[9], r[10], r[8]]) {
        const c = code ? code.toUpperCase() : '';
        if (!c) continue;
        let l = this.airportCodes.get(c);
        if (!l) this.airportCodes.set(c, (l = []));
        if (!l.includes(i)) l.push(i);
      }
    }
    this.airportGrid = new GeoGrid(this.airportLat, this.airportLon, 1);
  }

  private indexIls(f: IlsFile): void {
    for (const r of f.localizers) {
      const info: IlsInfo = {
        ident: r[2],
        freqMhz: r[4],
        courseTrue: r[8],
        locLat: r[5],
        locLon: r[6],
        kind: r[3],
        source: r[20],
      };
      if (r[7] !== null) info.locElevFt = r[7];
      if (r[9] !== null) info.courseWidthDeg = r[9];
      if (r[10] !== null && r[11] !== null && r[12] !== null) {
        info.gsAngleDeg = r[10];
        info.gsLat = r[11];
        info.gsLon = r[12];
        if (r[13] !== null) info.gsElevFt = r[13];
      }
      if (r[14] !== null && r[15] !== null) {
        info.dmeLat = r[14];
        info.dmeLon = r[15];
        if (r[16] !== null) info.dmeElevFt = r[16];
      }
      if (r[17] !== null) info.tchFt = r[17];
      if (r[18]) info.category = r[18];
      if (r[19] !== null) info.declination = r[19];
      this.ilsByRunway.set(`${r[0]}|${normalizeRunwayIdent(r[1])}`, info);
    }
  }

  private addNavaid(n: Navaid): void {
    n.id = this.navaids.length;
    this.navaids.push(n);
    if (n.type !== 'OM' && n.type !== 'MM' && n.type !== 'IM') {
      const key = n.ident.toUpperCase();
      let l = this.navaidIdent.get(key);
      if (!l) this.navaidIdent.set(key, (l = []));
      l.push(n);
      const fk = freqKey(n.freq);
      let fl = this.navaidFreq.get(fk);
      if (!fl) this.navaidFreq.set(fk, (fl = []));
      fl.push(n);
    }
  }

  private indexNavaids(f: NavaidsFile, ils: IlsFile): void {
    for (const r of f.rows) {
      const type = r[2];
      const n: Navaid = {
        ident: r[0],
        name: r[1],
        type,
        lat: r[3],
        lon: r[4],
        elevationFt: r[5] ?? 0,
        freq: r[6],
        rangeNm: r[7],
        magVar: r[8] ?? magneticDeclination(r[3], r[4], 0, this.year),
        hasDme: type === 'VORDME' || type === 'VORTAC' || type === 'TACAN' || type === 'DME' || type === 'NDBDME',
        country: r[12],
        usage: r[13],
      };
      if (r[9] !== null && r[10] !== null) {
        n.dmeLat = r[9];
        n.dmeLon = r[10];
      }
      if (r[11] !== null) n.dmeElevationFt = r[11];
      if (r[14]) n.airport = r[14];
      if (r[15]) n.channel = r[15];
      this.addNavaid(n);
    }
    for (const r of ils.localizers) this.addIlsNavaids(r);
    for (const m of ils.markers) {
      this.addNavaid({
        ident: m[0],
        name: `${m[5]} ${m[6]} ${m[0]}`,
        type: m[0],
        lat: m[1],
        lon: m[2],
        elevationFt: m[3] ?? 0,
        freq: 75,
        rangeNm: 1,
        magVar: 0,
        courseTrue: m[4],
        airport: m[5],
        runway: m[6],
      });
    }
    const lat = new Float64Array(this.navaids.length);
    const lon = new Float64Array(this.navaids.length);
    this.navaids.forEach((n, i) => {
      lat[i] = n.lat;
      lon[i] = n.lon;
    });
    this.navaidGrid = new GeoGrid(lat, lon, 1);
  }

  private addIlsNavaids(r: LocRow): void {
    const aptIdx = this.airportIndex(r[0]);
    const apt = aptIdx >= 0 ? this.materialize(aptIdx) : undefined;
    const rwId = normalizeRunwayIdent(r[1]);
    const rw = apt?.runways.find((x) => normalizeRunwayIdent(x.ident) === rwId);
    const decl = r[19] ?? apt?.magVar ?? magneticDeclination(r[5], r[6], 0, this.year);
    const hasGs = r[10] !== null && r[11] !== null && r[12] !== null;
    const thr = rw ? { thresholdLat: rw.thresholdLat, thresholdLon: rw.thresholdLon, thresholdElevFt: rw.elevationFt } : {};
    const loc: Navaid = {
      ident: r[2],
      name: `${r[0]} ${rwId} ${r[3]}`,
      type: r[3] === 'ILS' && hasGs ? 'ILS' : 'LOC',
      lat: r[5],
      lon: r[6],
      elevationFt: r[7] ?? rw?.elevationFt ?? apt?.elevationFt ?? 0,
      freq: r[4],
      rangeNm: LOC_RANGE_NM,
      magVar: decl,
      courseTrue: r[8],
      airport: r[0],
      runway: rwId,
      locKind: r[3],
      hasDme: r[14] !== null,
      ...thr,
    };
    if (r[9] !== null) loc.courseWidthDeg = r[9];
    if (hasGs) loc.gsAngleDeg = r[10]!;
    this.addNavaid(loc);
    if (hasGs) {
      const gs: Navaid = {
        ident: r[2],
        name: `${r[0]} ${rwId} GS`,
        type: 'GS',
        lat: r[11]!,
        lon: r[12]!,
        elevationFt: r[13] ?? loc.elevationFt,
        freq: r[4],
        rangeNm: GS_RANGE_NM,
        magVar: decl,
        courseTrue: r[8],
        gsAngleDeg: r[10]!,
        airport: r[0],
        runway: rwId,
        ...thr,
      };
      if (r[17] !== null) gs.tchFt = r[17];
      this.addNavaid(gs);
    }
    if (r[14] !== null && r[15] !== null) {
      this.addNavaid({
        ident: r[2],
        name: `${r[0]} ${rwId} DME`,
        type: 'DME',
        lat: r[14],
        lon: r[15],
        elevationFt: r[16] ?? loc.elevationFt,
        freq: r[4],
        rangeNm: ILS_DME_RANGE_NM,
        magVar: decl,
        airport: r[0],
        runway: rwId,
        hasDme: true,
      });
    }
  }

  private indexFixes(f: FixesFile): void {
    const n = f.ident.length;
    this.fixIdent = f.ident;
    this.fixRegion = f.region;
    this.fixLat = Float64Array.from(f.lat);
    this.fixLon = Float64Array.from(f.lon);
    for (let i = 0; i < n; i++) {
      const k = f.ident[i];
      let l = this.fixByIdent.get(k);
      if (!l) this.fixByIdent.set(k, (l = []));
      l.push(i);
    }
    this.fixGrid = new GeoGrid(this.fixLat, this.fixLon, 1);
  }

  private indexAirways(f: AirwaysFile): void {
    this.airwayRows = f.rows;
    f.rows.forEach((r, i) => {
      const k = r[0].toUpperCase();
      let l = this.airwayByName.get(k);
      if (!l) this.airwayByName.set(k, (l = []));
      l.push(i);
    });
  }

  // ------------------------------------------------------------ airports

  private airportIndex(code: string): number {
    const l = this.airportCodes.get(code.trim().toUpperCase());
    if (!l || l.length === 0) return -1;
    // Prefer the airport whose primary ident is the code.
    for (const i of l) if (this.airportRows[i][0].toUpperCase() === code.trim().toUpperCase()) return i;
    return l[0];
  }

  private materialize(i: number): Airport {
    const cached = this.airportCache.get(i);
    if (cached) return cached;
    const r = this.airportRows[i];
    const magVar = magneticDeclination(r[3], r[4], (r[5] ?? 0) * 0.3048, this.year);
    const a: Airport = {
      icao: r[0],
      name: r[1],
      lat: r[3],
      lon: r[4],
      elevationFt: r[5] ?? 0,
      type: AIRPORT_TYPE_CODES[r[2]],
      country: r[6],
      municipality: r[7],
      runways: [],
      frequencies: r[13].map((f) => ({ type: f[0], description: f[1], mhz: f[2] })),
      magVar,
    };
    if (r[8]) a.iata = r[8];
    if (r[9]) a.gpsCode = r[9];
    if (r[10]) a.localCode = r[10];
    if (r[14] !== null) a.transitionAltitudeFt = r[14];
    else if (r[6] === 'US') a.transitionAltitudeFt = 18000; // 14 CFR 91.121 / AIM 7-2-2: US transition altitude 18,000 ft
    a.runways = this.buildRunways(a, r[12], magVar);
    if (this.airportCache.size >= AIRPORT_CACHE_MAX) {
      // Map preserves insertion order: drop the oldest quarter.
      let k = 0;
      for (const key of this.airportCache.keys()) {
        if (k++ >= AIRPORT_CACHE_MAX / 4) break;
        this.airportCache.delete(key);
      }
    }
    this.airportCache.set(i, a);
    return a;
  }

  private buildRunways(a: Airport, rows: RunwayRow[], magVar: number): Runway[] {
    const out: Runway[] = [];
    const anyCoords = rows.some((r) => (r[5] !== null && r[6] !== null) || (r[11] !== null && r[12] !== null));
    for (const r of rows) {
      const surface = SURFACE_CODES[r[2]] ?? 'unknown';
      const lengthFt = r[0] ?? 0;
      const widthFt = r[1] ?? 0;
      const lighted = r[3] === 1;
      const le = { ident: r[4], lat: r[5], lon: r[6], elev: r[7], hdg: r[8], disp: r[9] };
      const he = { ident: r[10], lat: r[11], lon: r[12], elev: r[13], hdg: r[14], disp: r[15] };
      let estimated = false;
      // Headings: published, else from the designator (+ variation for magnetic numbers).
      const hdgFor = (ident: string, hdg: number | null): number => {
        if (hdg !== null && Number.isFinite(hdg)) return hdg;
        const h = headingFromRunwayIdent(ident);
        return h ? wrap360(h.isTrue ? h.deg : h.deg + magVar) : NaN;
      };
      let leHdg = hdgFor(le.ident, le.hdg);
      let heHdg = hdgFor(he.ident, he.hdg);
      if (!Number.isFinite(leHdg) && Number.isFinite(heHdg)) leHdg = wrap360(heHdg + 180);
      if (!Number.isFinite(heHdg) && Number.isFinite(leHdg)) heHdg = wrap360(leHdg + 180);
      const Lnm = (lengthFt > 0 ? lengthFt : 2000) / FT_PER_NM;
      let leLat = le.lat;
      let leLon = le.lon;
      let heLat = he.lat;
      let heLon = he.lon;
      if (leLat === null || leLon === null || heLat === null || heLon === null) {
        if (leLat !== null && leLon !== null && Number.isFinite(leHdg)) {
          const p = destinationPoint(leLat, leLon, leHdg, Lnm);
          heLat = p.lat;
          heLon = p.lon;
          estimated = true;
        } else if (heLat !== null && heLon !== null && Number.isFinite(heHdg)) {
          const p = destinationPoint(heLat, heLon, heHdg, Lnm);
          leLat = p.lat;
          leLon = p.lon;
          estimated = true;
        } else if (!anyCoords) {
          // EST: no runway coordinates at this airport: centre the runway on the reference point.
          const h = Number.isFinite(leHdg) ? leHdg : 0;
          if (!Number.isFinite(leHdg)) {
            leHdg = 0;
            heHdg = 180;
          }
          const p1 = destinationPoint(a.lat, a.lon, h + 180, Lnm / 2);
          const p2 = destinationPoint(a.lat, a.lon, h, Lnm / 2);
          leLat = p1.lat;
          leLon = p1.lon;
          heLat = p2.lat;
          heLon = p2.lon;
          estimated = true;
        } else {
          continue; // other runways are surveyed; do not invent overlapping pavement
        }
      }
      const mk = (e: typeof le, lat: number, lon: number, hdg: number, oppIdent: string): Runway => {
        const disp = e.disp ?? 0;
        const thr = disp > 0 ? destinationPoint(lat, lon, hdg, disp / FT_PER_NM) : { lat, lon };
        const rw: Runway = {
          ident: e.ident,
          oppositeIdent: oppIdent,
          lat,
          lon,
          elevationFt: e.elev ?? a.elevationFt,
          headingTrue: hdg,
          lengthFt,
          widthFt,
          displacedFt: disp,
          surface,
          lighted,
          thresholdLat: thr.lat,
          thresholdLon: thr.lon,
        };
        if (estimated) rw.positionEstimated = true;
        const ils = this.ilsByRunway.get(`${a.icao}|${normalizeRunwayIdent(e.ident)}`);
        if (ils) rw.ils = ils;
        return rw;
      };
      if (le.ident) out.push(mk(le, leLat!, leLon!, leHdg, he.ident));
      if (he.ident) out.push(mk(he, heLat!, heLon!, heHdg, le.ident));
    }
    return out;
  }

  airport(icao: string): Airport | undefined {
    if (!this._ready) return undefined;
    const i = this.airportIndex(icao);
    return i >= 0 ? this.materialize(i) : undefined;
  }

  airportsNear(lat: number, lon: number, radiusNm: number, limit = 50): Airport[] {
    if (!this.airportGrid) return [];
    const hits: { i: number; d: number }[] = [];
    this.airportGrid.query(lat, lon, radiusNm, (i) => {
      const d = distanceNm(lat, lon, this.airportLat[i], this.airportLon[i]);
      if (d <= radiusNm) hits.push({ i, d });
    });
    hits.sort((a, b) => a.d - b.d);
    const n = Math.min(limit, hits.length);
    const out: Airport[] = new Array(n);
    for (let k = 0; k < n; k++) out[k] = this.materialize(hits[k].i);
    return out;
  }

  /**
   * Ranked airport search over ident, ICAO/GPS/local/IATA codes, name and
   * municipality (case-insensitive). Exact code matches first, then ident
   * prefixes, then word-prefix and substring name matches; larger airports
   * rank higher within a tier.
   */
  searchAirports(query: string, limit = 20): Airport[] {
    const q = query.trim().toUpperCase();
    if (!q || !this._ready) return [];
    if (!this.searchText) this.searchText = this.airportRows.map((r) => `${r[1]} ${r[7]}`.toUpperCase());
    const typeBonus: Record<string, number> = { L: 30, M: 20, S: 10, W: 5, H: 0 };
    const hits: { i: number; s: number }[] = [];
    const rows = this.airportRows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let s = 0;
      if (r[0].toUpperCase() === q || r[11] === q || r[9] === q || r[8] === q || r[10] === q) s = 1000;
      else if (r[0].toUpperCase().startsWith(q)) s = 600 - (r[0].length - q.length);
      else {
        const t = this.searchText[i];
        const k = t.indexOf(q);
        if (k === 0 || (k > 0 && t[k - 1] === ' ')) s = 300;
        else if (k > 0) s = 150;
      }
      if (s > 0) hits.push({ i, s: s + (typeBonus[r[2]] ?? 0) });
    }
    hits.sort((a, b) => b.s - a.s || rows[a.i][0].localeCompare(rows[b.i][0]));
    return hits.slice(0, limit).map((h) => this.materialize(h.i));
  }

  /** Runway end of an airport by ident ('4L', '04L' and 'RW04L' all match). */
  runway(icao: string, ident: string): Runway | undefined {
    const a = this.airport(icao);
    if (!a) return undefined;
    const id = normalizeRunwayIdent(ident);
    return a.runways.find((r) => normalizeRunwayIdent(r.ident) === id);
  }

  // ------------------------------------------------------------ navaids

  navaidsByIdent(ident: string): Navaid[] {
    return (this.navaidIdent.get(ident.trim().toUpperCase()) ?? []).slice();
  }

  navaidsNear(lat: number, lon: number, radiusNm: number, types?: NavaidType[]): Navaid[] {
    if (!this.navaidGrid) return [];
    const hits: { n: Navaid; d: number }[] = [];
    this.navaidGrid.query(lat, lon, radiusNm, (i) => {
      const n = this.navaids[i];
      if (types && !types.includes(n.type)) return;
      const d = distanceNm(lat, lon, n.lat, n.lon);
      if (d <= radiusNm) hits.push({ n, d });
    });
    hits.sort((a, b) => a.d - b.d);
    return hits.map((h) => h.n);
  }

  navaidsOnFreq(freq: number, lat: number, lon: number, radiusNm: number): Navaid[] {
    const out: Navaid[] = [];
    this.collectOnFreq(freq, lat, lon, radiusNm, out);
    return out;
  }

  /**
   * Allocation-light variant of `navaidsOnFreq` for receivers: clears `out`,
   * fills it with stations on `freq` (MHz for VHF, kHz for NDB) within
   * `radiusNm`, sorted by distance, and returns the count.
   */
  collectOnFreq(freq: number, lat: number, lon: number, radiusNm: number, out: Navaid[]): number {
    out.length = 0;
    const l = this.navaidFreq.get(freqKey(freq));
    if (!l) return 0;
    for (const n of l) {
      if (distanceNm(lat, lon, n.lat, n.lon) <= radiusNm) out.push(n);
    }
    if (out.length > 1) out.sort((a, b) => distanceNm(lat, lon, a.lat, a.lon) - distanceNm(lat, lon, b.lat, b.lon));
    return out.length;
  }

  /** Marker beacons within `radiusNm` (clears and fills `out`). */
  collectMarkersNear(lat: number, lon: number, radiusNm: number, out: Navaid[]): number {
    out.length = 0;
    if (!this.navaidGrid) return 0;
    this.navaidGrid.query(lat, lon, radiusNm, (i) => {
      const n = this.navaids[i];
      if ((n.type === 'OM' || n.type === 'MM' || n.type === 'IM') && distanceNm(lat, lon, n.lat, n.lon) <= radiusNm) out.push(n);
    });
    return out.length;
  }

  /** ILS / localizer serving a runway end, if any. */
  ils(icao: string, runway: string): IlsInfo | undefined {
    const a = this.airport(icao);
    if (!a) return undefined;
    return this.ilsByRunway.get(`${a.icao}|${normalizeRunwayIdent(runway)}`);
  }

  /** True for VHF stations (VOR/DME/TACAN/LOC/GS), false for NDBs and markers. */
  static isVhf(n: Navaid): boolean {
    return isVhfType(n.type);
  }

  // ------------------------------------------------------------ fixes

  private fixAt(i: number): Fix {
    const f: Fix = { ident: this.fixIdent[i], lat: this.fixLat[i], lon: this.fixLon[i] };
    const reg = this.fixRegion[i];
    if (reg) f.region = reg;
    return f;
  }

  fixesByIdent(ident: string): Fix[] {
    const l = this.fixByIdent.get(ident.trim().toUpperCase());
    return l ? l.map((i) => this.fixAt(i)) : [];
  }

  fixesNear(lat: number, lon: number, radiusNm: number): Fix[] {
    if (!this.fixGrid) return [];
    const hits: { i: number; d: number }[] = [];
    this.fixGrid.query(lat, lon, radiusNm, (i) => {
      const d = distanceNm(lat, lon, this.fixLat[i], this.fixLon[i]);
      if (d <= radiusNm) hits.push({ i, d });
    });
    hits.sort((a, b) => a.d - b.d);
    return hits.map((h) => this.fixAt(h.i));
  }

  // ------------------------------------------------------------ resolve

  /**
   * Resolves an ident to every matching airport, VOR/DME/TACAN, NDB and fix,
   * sorted by distance from (nearLat, nearLon). Localizers, glideslopes and
   * marker beacons are not route waypoints and are excluded.
   */
  resolve(ident: string, nearLat: number, nearLon: number): Waypoint[] {
    const u = ident.trim().toUpperCase();
    if (!u || !this._ready) return [];
    const out: { w: Waypoint; d: number }[] = [];
    const push = (w: Waypoint): void => {
      const d = Number.isFinite(nearLat) && Number.isFinite(nearLon) ? distanceNm(nearLat, nearLon, w.lat, w.lon) : 0;
      out.push({ w, d });
    };
    const aIdx = this.airportCodes.get(u);
    if (aIdx) {
      for (const i of aIdx) {
        const r = this.airportRows[i];
        push({ ident: r[0], lat: r[3], lon: r[4], kind: 'airport', airport: r[0], elevationFt: r[5] ?? 0 });
      }
    }
    for (const n of this.navaidIdent.get(u) ?? []) {
      if (n.type === 'LOC' || n.type === 'ILS' || n.type === 'GS' || (n.type === 'DME' && n.runway)) continue;
      push({ ident: n.ident, lat: n.lat, lon: n.lon, kind: n.type === 'NDB' || n.type === 'NDBDME' ? 'ndb' : 'vor', navaid: n });
    }
    for (const i of this.fixByIdent.get(u) ?? []) {
      const w: Waypoint = { ident: this.fixIdent[i], lat: this.fixLat[i], lon: this.fixLon[i], kind: 'fix' };
      if (this.fixRegion[i]) w.region = this.fixRegion[i];
      push(w);
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.w);
  }

  // ------------------------------------------------------------ airways

  private segmentAt(i: number): AirwaySegment {
    const r = this.airwayRows[i];
    const s: AirwaySegment = {
      airway: r[0],
      from: r[1],
      to: r[4],
      high: r[7] !== 1,
      fromLat: r[2],
      fromLon: r[3],
      toLat: r[5],
      toLon: r[6],
      level: r[7],
      oneWay: r[10] === 1,
    };
    if (r[8] !== null) s.minAltFt = r[8];
    if (r[9] !== null) s.maxAltFt = r[9];
    return s;
  }

  airway(name: string): AirwaySegment[] {
    const k = name.trim().toUpperCase();
    let c = this.airwayCache.get(k);
    if (!c) {
      c = (this.airwayByName.get(k) ?? []).map((i) => this.segmentAt(i));
      this.airwayCache.set(k, c);
    }
    return c.slice();
  }

  /** Names of airways passing through a fix ident. */
  airwaysAt(ident: string): string[] {
    if (!this.airwaysByFix) {
      const m = new Map<string, Set<string>>();
      for (const r of this.airwayRows) {
        for (const f of [r[1], r[4]]) {
          let s = m.get(f);
          if (!s) m.set(f, (s = new Set()));
          s.add(r[0]);
        }
      }
      this.airwaysByFix = m;
    }
    return [...(this.airwaysByFix.get(ident.trim().toUpperCase()) ?? [])];
  }

  // ------------------------------------------------------------ procedures

  /** True when published (CIFP) procedures exist for the airport. */
  hasPublishedProcedures(icao: string): boolean {
    const a = this.airport(icao);
    return !!(a && this.procIndex && this.procIndex.airports[a.icao]);
  }

  loadProcedures(icao: string): Promise<AirportProcedures | undefined> {
    const a = this.airport(icao);
    if (!a) return Promise.resolve(undefined);
    let p = this.procCache.get(a.icao);
    if (!p) {
      p = this.doLoadProcedures(a);
      this.procCache.set(a.icao, p);
    }
    return p;
  }

  private async doLoadProcedures(a: Airport): Promise<AirportProcedures | undefined> {
    let procs: AirportProcedures = { icao: a.icao, cycle: 'synthetic', magVar: a.magVar ?? 0, sids: [], stars: [], approaches: [] };
    if (this.procIndex && this.procIndex.airports[a.icao]) {
      try {
        const file = await this.json<ProceduresFile>(`procedures/${a.icao}.json.gz`, false);
        if (file) procs = decodeProcedureFile(file, a.icao);
      } catch (e) {
        this.progress(`procedures for ${a.icao} failed to load: ${String(e)}`);
      }
    }
    if (this.opts.synthesizeApproaches !== false) {
      // ILS glidepath angle for published ILS approaches lacking a VPA.
      for (const p of procs.approaches) {
        if (p.glidepathDeg === undefined && p.runways[0]) {
          const ils = this.ilsByRunway.get(`${a.icao}|${p.runways[0]}`);
          if (ils?.gsAngleDeg && (p.approachType === 'ILS' || p.approachType === 'LDA' || p.approachType === 'IGS')) p.glidepathDeg = ils.gsAngleDeg;
        }
      }
      procs.approaches.push(...synthesizeApproaches(a, procs.approaches));
    }
    return procs;
  }
}

/** Creates (but does not load) the navigation database. */
export function createNavDatabase(options?: NavDatabaseOptions): NavDatabaseImpl {
  return new NavDatabaseImpl(options);
}
