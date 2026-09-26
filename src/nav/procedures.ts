/**
 * Decoding of the per-airport procedure files (`public/data/procedures/*.json.gz`,
 * built from the FAA CIFP) into the typed `Procedure` model of `nav/types.ts`,
 * plus small helpers shared by the flight plan and synthetic approach code.
 *
 * ARINC 424-18 references: 5.17 waypoint description codes, 5.29 altitude
 * description, 5.261 speed limit description, 5.7 route types.
 */
import type {
  AirportProcedures,
  AltitudeConstraint,
  ApproachType,
  Procedure,
  ProcedureLeg,
  ProcedureTransition,
  SpeedConstraint,
  Waypoint,
} from './types';
import type { LegJson, ProcedureJson, ProceduresFile } from './data/format';

/** Approach route-type letter (ARINC 424 5.7) to approach type and chart name prefix. */
const APPROACH_TYPES: Record<string, { type: ApproachType; name: string }> = {
  I: { type: 'ILS', name: 'ILS' },
  L: { type: 'LOC', name: 'LOC' },
  B: { type: 'LOC_BC', name: 'LOC BC' },
  X: { type: 'LDA', name: 'LDA' },
  U: { type: 'SDF', name: 'SDF' },
  G: { type: 'IGS', name: 'IGS' },
  J: { type: 'GLS', name: 'GLS' },
  R: { type: 'RNAV', name: 'RNAV (GPS)' },
  H: { type: 'RNP', name: 'RNAV (RNP)' },
  P: { type: 'GPS', name: 'GPS' },
  F: { type: 'FMS', name: 'FMS' },
  V: { type: 'VOR', name: 'VOR' },
  S: { type: 'VOR', name: 'VOR' },
  D: { type: 'VORDME', name: 'VOR/DME' },
  T: { type: 'TACAN', name: 'TACAN' },
  N: { type: 'NDB', name: 'NDB' },
  Q: { type: 'NDBDME', name: 'NDB/DME' },
  W: { type: 'MLS', name: 'MLS' },
  Y: { type: 'MLS', name: 'MLS' },
};

const FIX_KINDS: Record<string, Waypoint['kind']> = {
  W: 'fix',
  V: 'vor',
  N: 'ndb',
  R: 'runway',
  A: 'airport',
  L: 'fix',
};

/** Normalises a runway ident: 'RW4L' / '4L' / '04L' -> '04L'. Non-numeric idents are upper-cased unchanged. */
export function normalizeRunwayIdent(id: string): string {
  const t = id.trim().toUpperCase().replace(/^RW/, '');
  const m = /^(\d{1,2})([LCRB]?)$/.exec(t);
  if (!m) return t;
  return m[1].padStart(2, '0') + m[2];
}

/**
 * True when a SID/STAR runway transition name serves a runway:
 * exact match, 'ALL', or 'nnB' (all parallel runways nn).
 */
export function transitionServesRunway(transitionName: string, runway: string): boolean {
  const t = normalizeRunwayIdent(transitionName);
  const r = normalizeRunwayIdent(runway);
  if (t === 'ALL' || t === r) return true;
  if (t.endsWith('B') && t.length === 3) return r.startsWith(t.slice(0, 2));
  return false;
}

/** Decodes the ARINC altitude description + altitudes into a constraint. */
export function decodeAltitude(code: string | undefined, a1: number | undefined, a2: number | undefined): AltitudeConstraint | undefined {
  const c = code ?? '@';
  const has1 = a1 !== undefined && Number.isFinite(a1);
  const has2 = a2 !== undefined && Number.isFinite(a2);
  switch (c) {
    case '+':
      return has1 ? { kind: 'atOrAbove', lowerFt: a1, code: c } : undefined;
    case '-':
      return has1 ? { kind: 'atOrBelow', upperFt: a1, code: c } : undefined;
    case 'B': {
      if (has1 && has2) return { kind: 'between', lowerFt: Math.min(a1!, a2!), upperFt: Math.max(a1!, a2!), code: c };
      return has1 ? { kind: 'at', lowerFt: a1, upperFt: a1, code: c } : undefined;
    }
    case 'C':
      return has2 ? { kind: 'atOrAbove', lowerFt: a2, code: c } : has1 ? { kind: 'atOrAbove', lowerFt: a1, code: c } : undefined;
    case 'G':
    case 'I':
    case 'X':
      return has1 ? { kind: 'at', lowerFt: a1, upperFt: a1, code: c, glideslopeFt: has2 ? a2 : undefined } : undefined;
    case 'H':
    case 'J':
    case 'V':
      return has1 ? { kind: 'atOrAbove', lowerFt: a1, code: c, glideslopeFt: has2 ? a2 : undefined } : undefined;
    default:
      return has1 ? { kind: 'at', lowerFt: a1, upperFt: a1, code: c } : undefined;
  }
}

function decodeSpeed(sd: string | undefined, s: number | undefined): SpeedConstraint | undefined {
  if (s === undefined || !(s > 0)) return undefined;
  if (sd === '-') return { kind: 'atOrBelow', kt: s };
  if (sd === '+') return { kind: 'atOrAbove', kt: s };
  return { kind: 'at', kt: s };
}

/** Converts a compact leg to a `ProcedureLeg`. `magVar` is the airport variation (deg, + east). */
export function decodeLeg(j: LegJson, magVar: number): ProcedureLeg {
  const leg: ProcedureLeg = {
    type: j.t as ProcedureLeg['type'],
    flyOver: j.fo === 1,
    magVar: j.nv !== undefined && Number.isFinite(j.nv) ? j.nv : magVar,
  };
  if (j.f && j.la !== undefined && j.lo !== undefined) {
    leg.fix = { ident: j.f, lat: j.la, lon: j.lo, kind: FIX_KINDS[j.fk ?? 'W'] ?? 'fix' };
  } else if (j.f) {
    // Unresolved reference: keep the ident, flag with NaN coordinates.
    leg.fix = { ident: j.f, lat: NaN, lon: NaN, kind: 'fix' };
  }
  if (j.td) leg.turnDirection = j.td;
  if (j.c !== undefined) {
    leg.course = j.c;
    if (j.ct) leg.courseIsTrue = true;
  }
  if (j.d !== undefined) leg.distanceNm = j.d;
  if (j.tm !== undefined) leg.holdTimeMin = j.tm;
  const alt = decodeAltitude(j.ad, j.a1, j.a2);
  if (alt) leg.altitude = alt;
  const spd = decodeSpeed(j.sd, j.s);
  if (spd) leg.speed = spd;
  if (j.va !== undefined && j.va !== 0) leg.verticalAngleDeg = Math.abs(j.va);
  if (j.n) {
    leg.recommendedNavaid = {
      ident: j.n,
      lat: j.nla ?? NaN,
      lon: j.nlo ?? NaN,
      kind: 'vor',
      declination: j.nv,
    };
  }
  if (j.th !== undefined) leg.theta = j.th;
  if (j.rh !== undefined) leg.rho = j.rh;
  if (j.ar !== undefined) leg.arcRadiusNm = j.ar;
  if (j.cf) leg.arcCenter = { ident: j.cf, lat: j.cla ?? NaN, lon: j.clo ?? NaN, kind: 'fix' };
  if (j.w) {
    leg.descriptor = j.w;
    const role = j.w[3];
    if (role === 'A' || role === 'C' || role === 'D') leg.iaf = true;
    if (role === 'B' || role === 'I') leg.intermediateFix = true;
    if (role === 'F') leg.faf = true;
    if (role === 'M') leg.map = true;
    if (j.w[2] === 'M') leg.missedStart = true;
  }
  return leg;
}

function approachSuffix(ident: string, runway: string): string {
  if (!runway) {
    // Circling approaches: 'VOR-A', 'RNV-B'.
    const m = /-([A-Z])$/.exec(ident);
    return m ? m[1] : '';
  }
  const rest = ident.slice(1 + runway.length).replace('-', '');
  return /^[A-Z]$/.test(rest) ? rest : '';
}

/** Human-readable approach name, e.g. 'RNAV (GPS) Y RWY 06', 'ILS RWY 19', 'VOR-A'. */
export function approachName(typeLetter: string, ident: string, runway: string): string {
  const t = APPROACH_TYPES[typeLetter]?.name ?? typeLetter;
  const suffix = approachSuffix(ident, runway);
  if (!runway) return suffix ? `${t}-${suffix}` : t;
  return `${t}${suffix ? ' ' + suffix : ''} RWY ${runway}`;
}

function decodeProcedure(p: ProcedureJson, magVar: number): Procedure {
  const proc: Procedure = {
    type: p.type as Procedure['type'],
    ident: p.ident,
    name: p.ident,
    runways: [],
    runwayTransitions: [],
    commonLegs: [],
    transitions: [],
    finalLegs: [],
    missedLegs: [],
  };
  for (const r of p.routes) {
    const legs = r.legs.map((l) => decodeLeg(l, magVar));
    if (r.k === 'runway') {
      const name = r.tr === 'ALL' ? 'ALL' : normalizeRunwayIdent(r.tr);
      proc.runwayTransitions.push({ name, legs });
    } else if (r.k === 'common') {
      proc.commonLegs.push(...legs);
    } else if (r.k === 'enroute' || r.k === 'transition') {
      proc.transitions.push({ name: r.tr, legs });
    } else if (r.k === 'final') {
      // Split at the first missed-approach leg (ARINC 5.17 col 42 'M'), or after the MAP.
      let split = legs.findIndex((l) => l.missedStart);
      if (split < 0) {
        const mapIdx = legs.findIndex((l) => l.map);
        split = mapIdx >= 0 ? mapIdx + 1 : legs.length;
      }
      proc.finalLegs.push(...legs.slice(0, split));
      proc.missedLegs.push(...legs.slice(split));
    } else if (r.k === 'missed') {
      proc.missedLegs.push(...legs);
    }
  }
  if (proc.type === 'APPROACH') {
    const letter = p.at ?? p.ident[0];
    const rw = p.rw ? normalizeRunwayIdent(p.rw) : '';
    proc.approachType = APPROACH_TYPES[letter]?.type ?? 'RNAV';
    proc.name = approachName(letter, p.ident, rw);
    proc.suffix = approachSuffix(p.ident, p.rw ?? '');
    if (rw) proc.runways = [rw];
    if (p.nf !== undefined) proc.navFrequencyMhz = p.nf;
    if (p.ni !== undefined) proc.navIdent = p.ni;
    if (p.nc !== undefined) proc.navCourseTrue = p.nc;
    if (p.fas) {
      proc.fas = {
        levelOfService: p.fas.los,
        ltpLat: p.fas.ltpLat,
        ltpLon: p.fas.ltpLon,
        ltpEllipsoidM: p.fas.ltpEllipsoidM,
        glidepathDeg: p.fas.gpaDeg,
        fpapLat: p.fas.fpapLat,
        fpapLon: p.fas.fpapLon,
        courseWidthM: p.fas.courseWidthM,
        tchFt: p.fas.tchFt,
      };
      proc.glidepathDeg = p.fas.gpaDeg;
    }
    if (proc.glidepathDeg === undefined) {
      const va = proc.finalLegs.find((l) => l.verticalAngleDeg !== undefined);
      if (va) proc.glidepathDeg = va.verticalAngleDeg;
    }
  } else {
    const rws = new Set<string>();
    for (const t of proc.runwayTransitions) rws.add(t.name);
    proc.runways = [...rws];
  }
  return proc;
}

/** Decodes a procedure file into `AirportProcedures` (SIDs, STARs, approaches sorted by ident). */
export function decodeProcedureFile(file: ProceduresFile, icao: string): AirportProcedures {
  const out: AirportProcedures = { icao, cycle: file.cycle, magVar: file.magVar, sids: [], stars: [], approaches: [] };
  for (const p of file.procedures) {
    const proc = decodeProcedure(p, file.magVar);
    if (proc.type === 'SID') out.sids.push(proc);
    else if (proc.type === 'STAR') out.stars.push(proc);
    else out.approaches.push(proc);
  }
  const byIdent = (a: Procedure, b: Procedure): number => a.ident.localeCompare(b.ident);
  out.sids.sort(byIdent);
  out.stars.sort(byIdent);
  out.approaches.sort(byIdent);
  return out;
}

/** Finds a transition by name (case-insensitive), or undefined. */
export function findTransition(list: ProcedureTransition[], name: string | undefined): ProcedureTransition | undefined {
  if (!name) return undefined;
  const n = name.toUpperCase();
  return list.find((t) => t.name.toUpperCase() === n);
}

/** Converts a leg's course to true degrees (NaN when the leg has no course). */
export function legCourseTrue(leg: Pick<ProcedureLeg, 'course' | 'courseIsTrue' | 'magVar'>): number {
  if (leg.course === undefined) return NaN;
  const v = leg.courseIsTrue ? leg.course : leg.course + leg.magVar;
  return ((v % 360) + 360) % 360;
}
