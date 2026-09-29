/**
 * Parser for the FAA Coded Instrument Flight Procedures (CIFP) file
 * `FAACIFP18`, an ARINC 424-18 fixed-width (132 column) text file. Public
 * domain, published every AIRAC cycle at
 * https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
 *
 * Column positions below are 0-based string indexes (ARINC column - 1),
 * from ARINC 424-18 Chapter 4 record layouts, verified against the 2609
 * cycle file. Sections parsed:
 *   D  / DB   VHF navaids / enroute NDBs            (4.1.2, 4.1.3)
 *   EA        enroute waypoints                     (4.1.4)
 *   ER        enroute airways                       (4.1.6)
 *   PA        airport reference points              (4.1.7)
 *   PC        terminal waypoints                    (4.1.4)
 *   PD/PE/PF  SIDs / STARs / approaches             (4.1.9)
 *   PG        runways                               (4.1.10)
 *   PI        localizer & glideslope                (4.1.11)
 *   PN        terminal NDBs                         (4.1.3)
 *   PP        SBAS path points (FAS data blocks)    (4.1.28)
 *
 * Runtime-import rule: loaded by Node type stripping from the build script;
 * only `import type` from sibling modules.
 */
import type { AirwayRow, LegJson, LocKind, LocRow, ProcedureJson, ProcedureRouteJson } from './format';

// ------------------------------------------------------------ field decoding

/**
 * ARINC latitude 'N40372318' (DD MM SS.ss) or high-precision 'N4037231815'
 * (DD MM SS.ssss) to decimal degrees. Returns NaN for blank/invalid input.
 */
export function arincLat(s: string): number {
  const t = s.trim();
  if (t.length < 9) return NaN;
  const h = t[0];
  if (h !== 'N' && h !== 'S') return NaN;
  const d = Number(t.slice(1, 3));
  const m = Number(t.slice(3, 5));
  const sec = Number(t.slice(5, 7) + '.' + t.slice(7));
  if (![d, m, sec].every(Number.isFinite)) return NaN;
  const v = d + m / 60 + sec / 3600;
  return h === 'S' ? -v : v;
}

/** ARINC longitude 'W073470505' (DDD MM SS.ss) or 'W07347050525' to decimal degrees. */
export function arincLon(s: string): number {
  const t = s.trim();
  if (t.length < 10) return NaN;
  const h = t[0];
  if (h !== 'E' && h !== 'W') return NaN;
  const d = Number(t.slice(1, 4));
  const m = Number(t.slice(4, 6));
  const sec = Number(t.slice(6, 8) + '.' + t.slice(8));
  if (![d, m, sec].every(Number.isFinite)) return NaN;
  const v = d + m / 60 + sec / 3600;
  return h === 'W' ? -v : v;
}

/** Magnetic variation / station declination 'E0134' -> +13.4, 'W0130' -> -13.0, 'T0000' -> 0. */
export function arincMagVar(s: string): number {
  const t = s.trim();
  if (t.length < 5) return NaN;
  const v = Number(t.slice(1, 5)) / 10;
  if (!Number.isFinite(v)) return NaN;
  if (t[0] === 'W') return -v;
  if (t[0] === 'E') return v;
  if (t[0] === 'T') return 0;
  return NaN;
}

/** Altitude field: '05000' -> 5000, 'FL180' -> 18000, '-0010' -> -10; NaN when blank/unknown. */
export function arincAltitude(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  if (t.startsWith('FL')) {
    const fl = Number(t.slice(2));
    return Number.isFinite(fl) ? fl * 100 : NaN;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** Integer field scaled by `scale` (e.g. tenths -> 0.1). NaN when blank. */
function scaled(s: string, scale: number): number {
  const t = s.trim();
  if (!t) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v * scale : NaN;
}

/**
 * Course field (4 chars): '2718' -> 271.8 magnetic; '271T' -> 271 true.
 */
export function arincCourse(s: string): { deg: number; isTrue: boolean } {
  const t = s.trim();
  if (!t) return { deg: NaN, isTrue: false };
  if (t.endsWith('T')) return { deg: Number(t.slice(0, -1)), isTrue: true };
  return { deg: Number(t) / 10, isTrue: false };
}

// ---------------------------------------------------------------- data types

export interface CifpNavaid {
  ident: string;
  region: string;
  /** Airport ident for terminal NDBs (PN), '' otherwise. */
  airport: string;
  /** MHz (VHF) or kHz (NDB). */
  freq: number;
  /** ARINC navaid class (5 chars), e.g. 'VDHW ' = VOR+DME, high altitude. */
  cls: string;
  lat: number;
  lon: number;
  dmeLat: number;
  dmeLon: number;
  dmeElevFt: number;
  declination: number;
  name: string;
}

export interface CifpWaypoint {
  ident: string;
  region: string;
  /** Airport ident for terminal waypoints, '' for enroute. */
  airport: string;
  lat: number;
  lon: number;
  type: string;
}

export interface CifpAirport {
  ident: string;
  region: string;
  iata: string;
  lat: number;
  lon: number;
  magVar: number;
  elevFt: number;
  transitionAltFt: number;
  name: string;
}

export interface CifpRunway {
  airport: string;
  /** 'RW04L' */
  ident: string;
  lat: number;
  lon: number;
  lengthFt: number;
  magBearing: number;
  thresholdElevFt: number;
  displacedFt: number;
  tchFt: number;
  widthFt: number;
}

export interface CifpLocalizer {
  airport: string;
  ident: string;
  /** ARINC 5.80 ILS category code: '0' LOC only, '1'/'2'/'3' ILS CAT, 'I' IGS, 'L'/'A' LDA with/without GS, 'S'/'F' SDF with/without GS. */
  category: string;
  freqMhz: number;
  runway: string;
  lat: number;
  lon: number;
  bearing: number;
  bearingTrue: boolean;
  gsLat: number;
  gsLon: number;
  widthDeg: number;
  gsAngleDeg: number;
  declination: number;
  tchFt: number;
  gsElevFt: number;
}

export interface CifpPathPoint {
  airport: string;
  approach: string;
  runway: string;
  ltpLat: number;
  ltpLon: number;
  ltpEllipsoidM: number;
  gpaDeg: number;
  fpapLat: number;
  fpapLon: number;
  courseWidthM: number;
  tchFt: number;
  /** Level of service from the continuation record: 'LPV', 'LP' or ''. */
  los: 'LPV' | 'LP' | '';
}

export interface CifpAirwayPoint {
  route: string;
  seq: number;
  fix: string;
  region: string;
  section: string;
  subsection: string;
  desc: string;
  level: string;
  minAltFt: number;
  maxAltFt: number;
}

/** A SID/STAR/approach primary leg record, raw fields. */
export interface CifpProcRecord {
  airport: string;
  subsection: 'D' | 'E' | 'F';
  ident: string;
  routeType: string;
  transition: string;
  seq: number;
  fix: string;
  fixRegion: string;
  fixSection: string;
  fixSubsection: string;
  desc: string;
  turnDir: string;
  pathTerm: string;
  navaid: string;
  navaidRegion: string;
  navaidSection: string;
  navaidSubsection: string;
  arcRadius: string;
  theta: string;
  rho: string;
  course: string;
  distance: string;
  altDesc: string;
  alt1: string;
  alt2: string;
  speed: string;
  speedDesc: string;
  vertAngle: string;
  centerFix: string;
  centerRegion: string;
  centerSection: string;
  centerSubsection: string;
}

export interface CifpData {
  cycle: string;
  effective: string;
  vhf: CifpNavaid[];
  ndb: CifpNavaid[];
  enrouteWaypoints: CifpWaypoint[];
  terminalWaypoints: CifpWaypoint[];
  airports: Map<string, CifpAirport>;
  runways: Map<string, CifpRunway>;
  localizers: CifpLocalizer[];
  pathPoints: Map<string, CifpPathPoint>;
  airways: CifpAirwayPoint[];
  procedures: CifpProcRecord[];
}

// ------------------------------------------------------------------- parsing

function f(line: string, a: number, b: number): string {
  return line.slice(a, b + 1);
}

function parseNavaidLike(line: string, isNdb: boolean, airport: string): CifpNavaid {
  const vorLat = arincLat(f(line, 32, 40));
  const vorLon = arincLon(f(line, 41, 50));
  const dmeLat = isNdb ? NaN : arincLat(f(line, 55, 63));
  const dmeLon = isNdb ? NaN : arincLon(f(line, 64, 73));
  return {
    ident: f(line, 13, 16).trim(),
    region: f(line, 19, 20).trim(),
    airport,
    freq: isNdb ? scaled(f(line, 22, 26), 0.1) : scaled(f(line, 22, 26), 0.01),
    cls: f(line, 27, 31),
    lat: Number.isFinite(vorLat) ? vorLat : dmeLat,
    lon: Number.isFinite(vorLon) ? vorLon : dmeLon,
    dmeLat,
    dmeLon,
    dmeElevFt: isNdb ? NaN : scaled(f(line, 79, 83), 1),
    declination: arincMagVar(f(line, 74, 78)),
    name: f(line, 93, 122).trim(),
  };
}

function parseWaypoint(line: string, airport: string): CifpWaypoint {
  return {
    ident: f(line, 13, 17).trim(),
    region: f(line, 19, 20).trim(),
    airport,
    lat: arincLat(f(line, 32, 40)),
    lon: arincLon(f(line, 41, 50)),
    type: f(line, 26, 28).trim(),
  };
}

/** Parses the whole FAACIFP18 text. Continuation records (col 22/39 > '1') are ignored. */
export function parseCifp(text: string): CifpData {
  const data: CifpData = {
    cycle: '',
    effective: '',
    vhf: [],
    ndb: [],
    enrouteWaypoints: [],
    terminalWaypoints: [],
    airports: new Map(),
    runways: new Map(),
    localizers: [],
    pathPoints: new Map(),
    airways: [],
    procedures: [],
  };
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length < 100) continue;
    if (line.startsWith('HDR')) {
      // 'HDR04 ... CODED INSTRUMENT FLIGHT PROCEDURES VOLUME 2609  EFFECTIVE 03 SEP 2026'
      const m = /VOLUME\s+(\d{4})\s+EFFECTIVE\s+(\d{2} [A-Z]{3} \d{4})/.exec(line);
      if (m) {
        data.cycle = m[1];
        data.effective = m[2];
      }
      continue;
    }
    if (line[0] !== 'S') continue;
    const section = line[4];
    if (section === 'D') {
      if (line[21] !== '0' && line[21] !== '1') continue;
      if (line[5] === ' ') data.vhf.push(parseNavaidLike(line, false, ''));
      else if (line[5] === 'B') data.ndb.push(parseNavaidLike(line, true, ''));
      continue;
    }
    if (section === 'E') {
      const sub = line[5];
      if (sub === 'A') {
        if (line[21] !== '0' && line[21] !== '1') continue;
        data.enrouteWaypoints.push(parseWaypoint(line, ''));
      } else if (sub === 'R') {
        if (line[38] !== '0' && line[38] !== '1') continue;
        data.airways.push({
          route: f(line, 13, 17).trim(),
          seq: Number(f(line, 25, 28)),
          fix: f(line, 29, 33).trim(),
          region: f(line, 34, 35).trim(),
          section: line[36],
          subsection: line[37],
          desc: f(line, 39, 42),
          level: line[45],
          minAltFt: arincAltitude(f(line, 83, 87)),
          maxAltFt: arincAltitude(f(line, 93, 97)),
        });
      }
      continue;
    }
    if (section !== 'P') continue;
    const airport = f(line, 6, 9).trim();
    if (line[5] === 'N') {
      // Terminal NDB: subsection is in column 6 for PN records.
      if (line[21] !== '0' && line[21] !== '1') continue;
      data.ndb.push(parseNavaidLike(line, true, airport));
      continue;
    }
    const sub = line[12];
    switch (sub) {
      case 'A': {
        if (line[21] !== '0' && line[21] !== '1') break;
        data.airports.set(airport, {
          ident: airport,
          region: f(line, 10, 11).trim(),
          iata: f(line, 13, 15).trim(),
          lat: arincLat(f(line, 32, 40)),
          lon: arincLon(f(line, 41, 50)),
          magVar: arincMagVar(f(line, 51, 55)),
          elevFt: scaled(f(line, 56, 60), 1),
          transitionAltFt: scaled(f(line, 70, 74), 1),
          name: f(line, 93, 122).trim(),
        });
        break;
      }
      case 'C': {
        if (line[21] !== '0' && line[21] !== '1') break;
        data.terminalWaypoints.push(parseWaypoint(line, airport));
        break;
      }
      case 'G': {
        if (line[21] !== '0' && line[21] !== '1') break;
        const ident = f(line, 13, 17).trim();
        data.runways.set(`${airport}|${ident}`, {
          airport,
          ident,
          lat: arincLat(f(line, 32, 40)),
          lon: arincLon(f(line, 41, 50)),
          lengthFt: scaled(f(line, 22, 26), 1),
          magBearing: scaled(f(line, 27, 30), 0.1),
          thresholdElevFt: scaled(f(line, 66, 70), 1),
          displacedFt: scaled(f(line, 71, 74), 1),
          tchFt: scaled(f(line, 75, 76), 1),
          widthFt: scaled(f(line, 77, 79), 1),
        });
        break;
      }
      case 'I': {
        if (line[21] !== '0' && line[21] !== '1') break;
        const brg = arincCourse(f(line, 51, 54));
        data.localizers.push({
          airport,
          ident: f(line, 13, 16).trim(),
          category: line[17],
          freqMhz: scaled(f(line, 22, 26), 0.01),
          runway: f(line, 27, 31).trim(),
          lat: arincLat(f(line, 32, 40)),
          lon: arincLon(f(line, 41, 50)),
          bearing: brg.deg,
          bearingTrue: brg.isTrue,
          gsLat: arincLat(f(line, 55, 63)),
          gsLon: arincLon(f(line, 64, 73)),
          widthDeg: scaled(f(line, 83, 86), 0.01),
          gsAngleDeg: scaled(f(line, 87, 89), 0.01),
          declination: arincMagVar(f(line, 90, 94)),
          tchFt: scaled(f(line, 95, 96), 1),
          gsElevFt: scaled(f(line, 97, 101), 1),
        });
        break;
      }
      case 'P': {
        const approach = f(line, 13, 18).trim();
        const key = `${airport}|${approach}`;
        const cont = line[26];
        if (cont === '1' || cont === '0') {
          data.pathPoints.set(key, {
            airport,
            approach,
            runway: f(line, 19, 23).trim(),
            ltpLat: arincLat(f(line, 37, 47)),
            ltpLon: arincLon(f(line, 48, 59)),
            ltpEllipsoidM: scaled(f(line, 60, 65), 0.1),
            gpaDeg: scaled(f(line, 66, 69), 0.01),
            fpapLat: arincLat(f(line, 70, 80)),
            fpapLon: arincLon(f(line, 81, 92)),
            courseWidthM: scaled(f(line, 93, 97), 0.01),
            // Path point TCH: 6 digits, tenths, followed by the unit indicator ('F' feet / 'M' metres).
            tchFt: scaled(f(line, 102, 107), 0.1) * (line[108] === 'M' ? 3.28084 : 1),
            los: '',
          });
        } else {
          const pp = data.pathPoints.get(key);
          if (pp) {
            // Continuation record: '+00015+00015LPV' (orthometric heights, then level of service).
            const rest = line.slice(27, 70);
            pp.los = rest.includes('LPV') ? 'LPV' : /LP(?!V)/.test(rest) ? 'LP' : '';
          }
        }
        break;
      }
      case 'D':
      case 'E':
      case 'F': {
        if (line[38] !== '0' && line[38] !== '1') break;
        data.procedures.push({
          airport,
          subsection: sub,
          ident: f(line, 13, 18).trim(),
          routeType: line[19],
          transition: f(line, 20, 24).trim(),
          seq: Number(f(line, 26, 28)),
          fix: f(line, 29, 33).trim(),
          fixRegion: f(line, 34, 35).trim(),
          fixSection: line[36],
          fixSubsection: line[37],
          desc: f(line, 39, 42),
          turnDir: line[43],
          pathTerm: f(line, 47, 48),
          navaid: f(line, 50, 53).trim(),
          navaidRegion: f(line, 54, 55).trim(),
          navaidSection: line[78],
          navaidSubsection: line[79],
          arcRadius: f(line, 56, 61),
          theta: f(line, 62, 65),
          rho: f(line, 66, 69),
          course: f(line, 70, 73),
          distance: f(line, 74, 77),
          altDesc: line[82],
          alt1: f(line, 84, 88),
          alt2: f(line, 89, 93),
          speed: f(line, 99, 101),
          speedDesc: line[117] ?? ' ',
          vertAngle: f(line, 102, 105),
          centerFix: f(line, 106, 110).trim(),
          centerRegion: f(line, 112, 113).trim(),
          centerSection: line[114] ?? ' ',
          centerSubsection: line[115] ?? ' ',
        });
        break;
      }
      default:
        break;
    }
  }
  return data;
}

// --------------------------------------------------------------- resolution

interface Pos {
  lat: number;
  lon: number;
  /** Station declination for navaids (deg, + east), NaN otherwise. */
  decl: number;
  /** Fix kind code for LegJson.fk. */
  kind: string;
}

/**
 * Coordinate lookup for fixes referenced by procedure/airway records, keyed
 * the way ARINC references them (section/subsection + ident + region or
 * airport).
 */
export class CifpFixResolver {
  private readonly vhf = new Map<string, Pos>();
  private readonly ndb = new Map<string, Pos>();
  private readonly termNdb = new Map<string, Pos>();
  private readonly enroute = new Map<string, Pos>();
  private readonly enrouteByIdent = new Map<string, Pos[]>();
  private readonly terminal = new Map<string, Pos>();
  private readonly runways = new Map<string, Pos>();
  private readonly locs = new Map<string, Pos>();
  private readonly airports = new Map<string, Pos>();
  unresolved = 0;

  constructor(d: CifpData) {
    for (const n of d.vhf) this.vhf.set(`${n.ident}|${n.region}`, { lat: n.lat, lon: n.lon, decl: n.declination, kind: 'V' });
    for (const n of d.ndb) {
      const p = { lat: n.lat, lon: n.lon, decl: n.declination, kind: 'N' };
      if (n.airport) this.termNdb.set(`${n.airport}|${n.ident}`, p);
      else this.ndb.set(`${n.ident}|${n.region}`, p);
    }
    for (const w of d.enrouteWaypoints) {
      const p = { lat: w.lat, lon: w.lon, decl: NaN, kind: 'W' };
      this.enroute.set(`${w.ident}|${w.region}`, p);
      let l = this.enrouteByIdent.get(w.ident);
      if (!l) this.enrouteByIdent.set(w.ident, (l = []));
      l.push(p);
    }
    for (const w of d.terminalWaypoints) this.terminal.set(`${w.airport}|${w.ident}`, { lat: w.lat, lon: w.lon, decl: NaN, kind: 'W' });
    for (const r of d.runways.values()) this.runways.set(`${r.airport}|${r.ident}`, { lat: r.lat, lon: r.lon, decl: NaN, kind: 'R' });
    for (const l of d.localizers) this.locs.set(`${l.airport}|${l.ident}`, { lat: l.lat, lon: l.lon, decl: l.declination, kind: 'L' });
    for (const a of d.airports.values()) this.airports.set(a.ident, { lat: a.lat, lon: a.lon, decl: a.magVar, kind: 'A' });
  }

  /** Resolves a fix reference. `airport` is the owning airport for terminal references. */
  resolve(ident: string, region: string, section: string, subsection: string, airport: string): Pos | undefined {
    if (!ident) return undefined;
    let p: Pos | undefined;
    if (section === 'D') p = subsection === 'B' ? this.ndb.get(`${ident}|${region}`) : this.vhf.get(`${ident}|${region}`);
    else if (section === 'E') p = this.enroute.get(`${ident}|${region}`);
    else if (section === 'P') {
      if (subsection === 'C') p = this.terminal.get(`${airport}|${ident}`);
      else if (subsection === 'G') p = this.runways.get(`${airport}|${ident}`);
      else if (subsection === 'N') p = this.termNdb.get(`${airport}|${ident}`);
      else if (subsection === 'I') p = this.locs.get(`${airport}|${ident}`);
      else if (subsection === 'A') p = this.airports.get(ident);
    }
    if (!p) {
      // Fallbacks for loosely coded references.
      p =
        this.terminal.get(`${airport}|${ident}`) ??
        this.enroute.get(`${ident}|${region}`) ??
        this.vhf.get(`${ident}|${region}`) ??
        this.ndb.get(`${ident}|${region}`) ??
        this.termNdb.get(`${airport}|${ident}`);
      if (!p) {
        const l = this.enrouteByIdent.get(ident);
        if (l && l.length === 1) p = l[0];
      }
    }
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      this.unresolved++;
      return undefined;
    }
    return p;
  }
}

// --------------------------------------------------------------- procedures

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Route-type letter -> route kind, per ARINC 424 5.7 (SID/STAR) and 5.7 approach route types. */
export function routeKind(subsection: 'D' | 'E' | 'F', routeType: string): string | null {
  if (subsection === 'D') {
    if ('14FT'.includes(routeType)) return 'runway';
    if ('25M'.includes(routeType)) return 'common';
    if ('36SV'.includes(routeType)) return 'enroute';
    return null; // '0' engine-out SIDs are not modelled
  }
  if (subsection === 'E') {
    if ('147F'.includes(routeType)) return 'enroute';
    if ('258M'.includes(routeType)) return 'common';
    if ('369S'.includes(routeType)) return 'runway';
    return null;
  }
  if (routeType === 'A') return 'transition';
  if (routeType === 'Z') return 'missed';
  return 'final';
}

/** Runway served by an approach ident ('I06-Z' -> '06', 'R04LY' -> '04L', 'RNV-A' -> ''). */
export function approachRunway(ident: string): string {
  const m = /^[A-Z](\d{2}[LCR]?)/.exec(ident);
  return m ? m[1] : '';
}

/** Converts one primary procedure record into a compact leg. */
export function procLegJson(r: CifpProcRecord, res: CifpFixResolver): LegJson {
  const leg: LegJson = { t: r.pathTerm };
  if (r.fix) {
    leg.f = r.fix;
    const p = res.resolve(r.fix, r.fixRegion, r.fixSection, r.fixSubsection, r.airport);
    if (p) {
      leg.la = r6(p.lat);
      leg.lo = r6(p.lon);
      leg.fk = p.kind;
    }
  }
  if (r.desc[1] === 'Y' || r.desc[1] === 'B') leg.fo = 1;
  if (r.turnDir === 'L' || r.turnDir === 'R') leg.td = r.turnDir;
  const crs = arincCourse(r.course);
  if (Number.isFinite(crs.deg)) {
    leg.c = r2(crs.deg);
    if (crs.isTrue) leg.ct = 1;
  }
  const dist = r.distance.trim();
  if (dist) {
    if (dist.startsWith('T')) {
      const tm = Number(dist.slice(1)) / 10;
      if (Number.isFinite(tm)) leg.tm = tm;
    } else {
      const d = Number(dist) / 10;
      if (Number.isFinite(d)) leg.d = d;
    }
  }
  const a1 = arincAltitude(r.alt1);
  const a2 = arincAltitude(r.alt2);
  if (Number.isFinite(a1) || Number.isFinite(a2)) {
    leg.ad = r.altDesc === ' ' ? '@' : r.altDesc;
    if (Number.isFinite(a1)) leg.a1 = a1;
    if (Number.isFinite(a2)) leg.a2 = a2;
  }
  const spd = scaled(r.speed, 1);
  if (Number.isFinite(spd) && spd > 0) {
    leg.s = spd;
    leg.sd = r.speedDesc === ' ' ? '@' : r.speedDesc;
  }
  const va = scaled(r.vertAngle, 0.01);
  if (Number.isFinite(va) && va !== 0) leg.va = va;
  if (r.navaid) {
    leg.n = r.navaid;
    const p = res.resolve(r.navaid, r.navaidRegion, r.navaidSection, r.navaidSubsection, r.airport);
    if (p) {
      leg.nla = r6(p.lat);
      leg.nlo = r6(p.lon);
      if (Number.isFinite(p.decl)) leg.nv = Math.round(p.decl * 10) / 10;
    }
  }
  const th = scaled(r.theta, 0.1);
  const rh = scaled(r.rho, 0.1);
  if (Number.isFinite(th)) leg.th = th;
  if (Number.isFinite(rh)) leg.rh = rh;
  const ar = scaled(r.arcRadius, 0.001);
  if (Number.isFinite(ar) && ar > 0) leg.ar = ar;
  if (r.centerFix && (r.pathTerm === 'RF' || r.pathTerm === 'AF')) {
    leg.cf = r.centerFix;
    const p = res.resolve(r.centerFix, r.centerRegion, r.centerSection, r.centerSubsection, r.airport);
    if (p) {
      leg.cla = r6(p.lat);
      leg.clo = r6(p.lon);
    }
  }
  if (r.desc.trim()) leg.w = r.desc;
  return leg;
}

export interface CifpAirportProcedures {
  airport: string;
  magVar: number;
  procedures: ProcedureJson[];
}

/**
 * Groups procedure records by airport and builds compact procedure objects.
 * Approach navaid info (localizer frequency/course) and SBAS FAS data blocks
 * are attached to approaches.
 */
export function buildCifpProcedures(d: CifpData, res: CifpFixResolver): Map<string, CifpAirportProcedures> {
  const out = new Map<string, CifpAirportProcedures>();
  const procIndex = new Map<string, { proc: ProcedureJson; routes: Map<string, ProcedureRouteJson> }>();
  const locByKey = new Map<string, CifpLocalizer>();
  for (const l of d.localizers) locByKey.set(`${l.airport}|${l.ident}`, l);
  const vhfByKey = new Map<string, CifpNavaid>();
  for (const n of d.vhf) vhfByKey.set(`${n.ident}|${n.region}`, n);

  for (const r of d.procedures) {
    const kind = routeKind(r.subsection, r.routeType);
    if (!kind) continue;
    let ap = out.get(r.airport);
    if (!ap) {
      const a = d.airports.get(r.airport);
      ap = { airport: r.airport, magVar: a && Number.isFinite(a.magVar) ? a.magVar : 0, procedures: [] };
      out.set(r.airport, ap);
    }
    const pkey = `${r.airport}|${r.subsection}|${r.ident}`;
    let pe = procIndex.get(pkey);
    if (!pe) {
      const proc: ProcedureJson = {
        type: r.subsection === 'D' ? 'SID' : r.subsection === 'E' ? 'STAR' : 'APPROACH',
        ident: r.ident,
        routes: [],
      };
      if (r.subsection === 'F') {
        proc.rw = approachRunway(r.ident);
        const pp = d.pathPoints.get(`${r.airport}|${r.ident}`);
        if (pp && Number.isFinite(pp.ltpLat)) {
          proc.fas = {
            los: pp.los,
            ltpLat: r6(pp.ltpLat),
            ltpLon: r6(pp.ltpLon),
            ltpEllipsoidM: pp.ltpEllipsoidM,
            gpaDeg: pp.gpaDeg,
            fpapLat: r6(pp.fpapLat),
            fpapLon: r6(pp.fpapLon),
            courseWidthM: pp.courseWidthM,
            tchFt: Math.round(pp.tchFt * 10) / 10,
          };
        }
      }
      pe = { proc, routes: new Map() };
      procIndex.set(pkey, pe);
      ap.procedures.push(proc);
    }
    const rkey = `${r.routeType}|${r.transition}`;
    let route = pe.routes.get(rkey);
    if (!route) {
      route = { k: kind, tr: kind === 'common' || kind === 'final' ? '' : r.transition, legs: [] };
      pe.routes.set(rkey, route);
      pe.proc.routes.push(route);
    }
    if (kind === 'final' && !pe.proc.at) pe.proc.at = r.routeType;
    route.legs.push(procLegJson(r, res));
    // Approach navaid (localizer / VOR) from the recommended navaid of final legs.
    if (r.subsection === 'F' && kind === 'final' && pe.proc.nf === undefined && r.navaid) {
      if (r.navaidSection === 'P' && r.navaidSubsection === 'I') {
        const loc = locByKey.get(`${r.airport}|${r.navaid}`);
        if (loc && Number.isFinite(loc.freqMhz)) {
          pe.proc.nf = loc.freqMhz;
          pe.proc.ni = loc.ident;
          const decl = Number.isFinite(loc.declination) ? loc.declination : ap.magVar;
          pe.proc.nc = r2(((loc.bearingTrue ? loc.bearing : loc.bearing + decl) + 360) % 360);
        }
      } else if (r.navaidSection === 'D' && r.navaidSubsection === ' ') {
        const n = vhfByKey.get(`${r.navaid}|${r.navaidRegion}`);
        if (n && Number.isFinite(n.freq)) {
          pe.proc.nf = n.freq;
          pe.proc.ni = n.ident;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ airways

/** Builds airway segments from ER records (consecutive fixes of the same route, split at 'E' end-of-segment codes). */
export function buildCifpAirways(d: CifpData, res: CifpFixResolver): AirwayRow[] {
  const rows: AirwayRow[] = [];
  let prev: CifpAirwayPoint | null = null;
  let prevPos: Pos | undefined;
  for (const p of d.airways) {
    const pos = res.resolve(p.fix, p.region, p.section, p.subsection, '');
    if (prev && prev.route === p.route && prev.desc[1] !== 'E' && prevPos && pos) {
      const level = prev.level === 'H' ? 2 : prev.level === 'L' ? 1 : 3;
      rows.push([
        p.route,
        prev.fix,
        r6(prevPos.lat),
        r6(prevPos.lon),
        p.fix,
        r6(pos.lat),
        r6(pos.lon),
        level,
        Number.isFinite(prev.minAltFt) ? prev.minAltFt : null,
        Number.isFinite(prev.maxAltFt) ? prev.maxAltFt : null,
        0,
      ]);
    }
    prev = p;
    prevPos = pos;
  }
  return rows;
}

// --------------------------------------------------------------- localizers

/** Localizer kind and glideslope presence from the ARINC 5.80 category code. */
export function locKindFromCategory(cat: string): { kind: LocKind; hasGs: boolean; category: string } {
  switch (cat) {
    case '1':
      return { kind: 'ILS', hasGs: true, category: 'I' };
    case '2':
      return { kind: 'ILS', hasGs: true, category: 'II' };
    case '3':
      return { kind: 'ILS', hasGs: true, category: 'III' };
    case 'I':
      return { kind: 'IGS', hasGs: true, category: '' };
    case 'L':
      return { kind: 'LDA', hasGs: true, category: '' };
    case 'A':
      return { kind: 'LDA', hasGs: false, category: '' };
    case 'S':
      return { kind: 'SDF', hasGs: true, category: '' };
    case 'F':
      return { kind: 'SDF', hasGs: false, category: '' };
    default:
      return { kind: 'LOC', hasGs: false, category: '' };
  }
}

/**
 * Localizer rows from PI records. The DME comes from the VHF navaid record
 * with the same ident and frequency (ILS DME); the localizer antenna
 * elevation is taken as the runway threshold elevation (EST: ILS antennas sit
 * at runway level; CIFP does not code the localizer elevation).
 */
export function buildCifpLocalizers(d: CifpData): LocRow[] {
  const dmeByIdent = new Map<string, CifpNavaid>();
  for (const n of d.vhf) if (Number.isFinite(n.dmeLat)) dmeByIdent.set(`${n.ident}|${Math.round(n.freq * 100)}`, n);
  const rows: LocRow[] = [];
  for (const l of d.localizers) {
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon) || !Number.isFinite(l.bearing)) continue;
    const k = locKindFromCategory(l.category);
    const rw = d.runways.get(`${l.airport}|${l.runway}`);
    const a = d.airports.get(l.airport);
    const decl = Number.isFinite(l.declination) ? l.declination : a && Number.isFinite(a.magVar) ? a.magVar : 0;
    const course = l.bearingTrue ? l.bearing : (l.bearing + decl + 360) % 360;
    const gsOk = k.hasGs && Number.isFinite(l.gsLat) && Number.isFinite(l.gsLon) && l.gsAngleDeg > 0;
    const dme = dmeByIdent.get(`${l.ident}|${Math.round(l.freqMhz * 100)}`);
    rows.push([
      l.airport,
      l.runway.replace(/^RW/, ''),
      l.ident,
      k.kind === 'ILS' && !gsOk ? 'LOC' : k.kind,
      Math.round(l.freqMhz * 100) / 100,
      r6(l.lat),
      r6(l.lon),
      rw && Number.isFinite(rw.thresholdElevFt) ? rw.thresholdElevFt : a && Number.isFinite(a.elevFt) ? a.elevFt : null,
      r2(course),
      Number.isFinite(l.widthDeg) && l.widthDeg > 0 ? r2(l.widthDeg) : null,
      gsOk ? r2(l.gsAngleDeg) : null,
      gsOk ? r6(l.gsLat) : null,
      gsOk ? r6(l.gsLon) : null,
      gsOk && Number.isFinite(l.gsElevFt) ? l.gsElevFt : null,
      dme ? r6(dme.dmeLat) : null,
      dme ? r6(dme.dmeLon) : null,
      dme && Number.isFinite(dme.dmeElevFt) ? dme.dmeElevFt : null,
      Number.isFinite(l.tchFt) && l.tchFt > 0 ? l.tchFt : null,
      k.category,
      Number.isFinite(decl) ? decl : null,
      'CIFP',
    ]);
  }
  return rows;
}
