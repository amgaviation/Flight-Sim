/**
 * ICAO/FAA route string parsing into a `FlightPlan`.
 *
 *   KTEB WENTZ1 RUUDY J209 SBY ... KMIA
 *   KTEB/24 RUUDY6.WAVEY J209 SBY DCT ENE ENE.PARCH3 KMIA/09
 *   EGLL N0450F350 CPT L9 KENET DCT 5030N00800W KJFK
 *
 * Tokens:
 *   - first / last token: origin / destination airport, optional '/RWY'
 *   - SID: an ident of the origin's SIDs ('WENTZ1'); the enroute transition
 *     is either dotted ('RUUDY6.WAVEY') or the next token when it names one
 *   - STAR: an ident of the destination's STARs; the transition is dotted
 *     ('ENE.PARCH3') or the preceding waypoint when it names one
 *   - airway: a known airway name between two fixes; expanded with
 *     `expandAirway` (coordinates disambiguate duplicate idents)
 *   - 'DCT' is ignored; speed/level groups ('N0450F350', 'M078F390',
 *     'K0830S1130', 'A045') set cruise altitude/speed; 'FIX/N0450F350' too
 *   - latitude/longitude: '4030N07350W', '40N073W', 'N4030W07350'
 *   - anything else resolves as an airport/navaid/fix nearest to the
 *     previous point (`NavDatabase.resolve`)
 * Unresolvable tokens are reported in `errors` and skipped.
 */
import type { NavDatabase, Procedure, Waypoint } from '../types';
import { FlightPlan, type EditStyle } from './FlightPlan';
import { expandAirway } from './airways';
import { normalizeRunwayIdent } from '../procedures';

export interface RouteParseResult {
  plan: FlightPlan;
  /** Tokens that could not be used. */
  errors: string[];
  /** Tokens accepted with an assumption (e.g. SID without matching runway transition). */
  warnings: string[];
}

/**
 * Parses an ICAO speed/level group (ICAO Doc 4444 App. 2 Item 15): a speed
 * (N0450 kt, M078 Mach, K0830 km/h) followed by a level (F350 flight level,
 * A045 altitude in hundreds of ft, S1130 / M0840 tens of metres), or a level
 * alone. Returns null when the token is not one.
 */
export function parseSpeedLevel(tok: string): { speedKt?: number; mach?: number; altFt?: number } | null {
  const m = /^(?:(N\d{4}|M\d{3}|K\d{4})(F\d{3}|A\d{3}|S\d{4}|M\d{4})|(F\d{3}|A\d{3}|S\d{4}))$/.exec(tok);
  if (!m) return null;
  const out: { speedKt?: number; mach?: number; altFt?: number } = {};
  const spd = m[1];
  if (spd) {
    const v = Number(spd.slice(1));
    if (spd[0] === 'N') out.speedKt = v;
    else if (spd[0] === 'M') out.mach = v / 100;
    else out.speedKt = v / 1.852; // km/h -> kt
  }
  const lvl = m[2] ?? m[3];
  const v = Number(lvl.slice(1));
  if (lvl[0] === 'F' || lvl[0] === 'A') out.altFt = v * 100;
  else out.altFt = (v * 10) / 0.3048; // S / M: tens of metres
  return out;
}

/** Parses latitude/longitude waypoint tokens; null when not a coordinate. */
export function parseLatLon(tok: string): { lat: number; lon: number } | null {
  let m = /^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/.exec(tok);
  if (m) {
    const lat = (Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0)) * (m[3] === 'S' ? -1 : 1);
    const lon = (Number(m[4]) + (m[5] ? Number(m[5]) / 60 : 0)) * (m[6] === 'W' ? -1 : 1);
    return lat <= 90 && lon <= 180 ? { lat, lon } : null;
  }
  m = /^([NS])(\d{2})(\d{2})?([EW])(\d{3})(\d{2})?$/.exec(tok);
  if (m) {
    const lat = (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0)) * (m[1] === 'S' ? -1 : 1);
    const lon = (Number(m[5]) + (m[6] ? Number(m[6]) / 60 : 0)) * (m[4] === 'W' ? -1 : 1);
    return lat <= 90 && lon <= 180 ? { lat, lon } : null;
  }
  return null;
}

/** Display ident of a lat/lon waypoint: 'N35W075' for whole degrees (Boeing style), else the entered token. */
export function latLonIdent(lat: number, lon: number, token: string): string {
  if (Number.isInteger(lat) && Number.isInteger(lon)) {
    return `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}`;
  }
  return token;
}

function findProc(list: Procedure[], ident: string): Procedure | undefined {
  const u = ident.toUpperCase();
  return list.find((p) => p.ident.toUpperCase() === u);
}

function splitAirport(tok: string): { ident: string; runway?: string } {
  const [ident, rw] = tok.split('/');
  return { ident, runway: rw && /^\d{1,2}[LCR]?$/.test(rw) ? rw : undefined };
}

/**
 * Parses a route string into a new plan. Async because procedures are loaded
 * on demand (`NavDatabase.loadProcedures`).
 */
export async function parseRoute(db: NavDatabase, route: string, style: EditStyle = 'garmin'): Promise<RouteParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = new FlightPlan(style);
  const tokens = route
    .toUpperCase()
    .replace(/[,;]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length < 2) {
    errors.push('route needs at least an origin and a destination');
    return { plan, errors, warnings };
  }
  const o = splitAirport(tokens[0]);
  const d = splitAirport(tokens[tokens.length - 1]);
  const origin = db.airport(o.ident);
  const dest = db.airport(d.ident);
  if (!origin) errors.push(`unknown origin ${o.ident}`);
  if (!dest) errors.push(`unknown destination ${d.ident}`);
  if (origin) plan.setOrigin(origin, o.runway);
  const originProcs = origin && db.loadProcedures ? await db.loadProcedures(origin.icao) : undefined;
  const destProcs = dest && db.loadProcedures ? await db.loadProcedures(dest.icao) : undefined;

  let prev: Waypoint | null = origin ? { ident: origin.icao, lat: origin.lat, lon: origin.lon, kind: 'airport' } : null;
  let sid: { proc: Procedure; trans?: string } | null = null;
  let star: { proc: Procedure; trans?: string } | null = null;
  const enroute: { w: Waypoint; airway?: string }[] = [];
  const mid = tokens.slice(1, -1);

  for (let k = 0; k < mid.length; k++) {
    const raw = mid[k];
    if (raw === 'DCT') continue;
    // FIX/N0450F350: speed/level change at a fix.
    const [tok, sl] = raw.includes('/') && !/^\d/.test(raw) ? raw.split('/') : [raw, undefined];
    if (sl) {
      const g = parseSpeedLevel(sl);
      if (g?.altFt) plan.cruiseAltFt = Math.max(plan.cruiseAltFt, g.altFt);
    }
    const group = parseSpeedLevel(tok);
    if (group) {
      if (group.altFt) plan.cruiseAltFt = group.altFt;
      if (group.speedKt) plan.cruiseSpeedKt = group.speedKt;
      if (group.mach) plan.cruiseMach = group.mach;
      continue;
    }
    // SID (first procedure-like token after the origin).
    if (!sid && enroute.length === 0 && originProcs) {
      const [pName, pTrans] = tok.split('.');
      const proc = findProc(originProcs.sids, pName);
      if (proc) {
        let trans = pTrans;
        if (!trans && mid[k + 1] && proc.transitions.some((t) => t.name === mid[k + 1])) trans = mid[k + 1];
        sid = { proc, trans };
        if (trans) {
          const tLegs = proc.transitions.find((t) => t.name === trans)?.legs;
          const last = tLegs && tLegs[tLegs.length - 1]?.fix;
          if (last && Number.isFinite(last.lat)) prev = { ...last };
          if (!pTrans) k++; // consumed the transition token
        } else {
          const last = proc.commonLegs[proc.commonLegs.length - 1]?.fix;
          if (last && Number.isFinite(last.lat)) prev = { ...last };
        }
        continue;
      }
    }
    // STAR (possibly dotted TRANS.STAR), only near the end of the route.
    if (!star && destProcs) {
      const parts = tok.split('.');
      const sName = parts.length === 2 ? parts[1] : parts[0];
      const sTrans = parts.length === 2 ? parts[0] : undefined;
      const proc = findProc(destProcs.stars, sName);
      if (proc) {
        let trans = sTrans;
        if (!trans && prev && proc.transitions.some((t) => t.name === prev!.ident)) trans = prev.ident;
        star = { proc, trans };
        // 'DCT TRANS.STAR' means direct to the transition fix: make sure the
        // route reaches it so the STAR connects (the repeated fix is merged).
        if (trans && (enroute.length === 0 || enroute[enroute.length - 1].w.ident !== trans)) {
          const first = proc.transitions.find((t) => t.name === trans)?.legs[0]?.fix;
          if (first && Number.isFinite(first.lat)) enroute.push({ w: { ...first } });
        }
        continue;
      }
    }
    // Airway between the previous fix and the next token.
    const next = mid[k + 1];
    if (prev && next && next !== 'DCT' && /^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(tok) && db.airway(tok).length > 0) {
      try {
        const exitIdent = next.split('/')[0].split('.')[0];
        const fixes = expandAirway(db, tok, prev, exitIdent);
        for (const w of fixes) enroute.push({ w, airway: tok });
        prev = fixes[fixes.length - 1];
        k++; // exit fix consumed
        continue;
      } catch (e) {
        errors.push(`${tok}: ${(e as Error).message}`);
        continue;
      }
    }
    // Coordinates.
    const ll = parseLatLon(tok);
    if (ll) {
      const w: Waypoint = { ident: latLonIdent(ll.lat, ll.lon, tok), lat: ll.lat, lon: ll.lon, kind: 'latlon' };
      enroute.push({ w });
      prev = w;
      continue;
    }
    // Plain ident.
    const cands = db.resolve(tok, prev?.lat ?? origin?.lat ?? NaN, prev?.lon ?? origin?.lon ?? NaN);
    if (cands.length === 0) {
      errors.push(`unknown waypoint ${tok}`);
      continue;
    }
    if (cands.length > 1) warnings.push(`${tok}: ${cands.length} matches, using the nearest`);
    enroute.push({ w: cands[0] });
    prev = cands[0];
  }

  if (sid) plan.setSid(sid.proc, undefined, sid.trans);
  for (const e of enroute) plan.appendEnrouteWaypoint(e.w, e.airway);
  if (dest) {
    plan.setDestination(dest);
    if (d.runway) plan.setArrivalRunway(normalizeRunwayIdent(d.runway));
  }
  if (star) plan.setStar(star.proc, star.trans);
  if (sid && o.runway && !plan.sid?.runwayTransition && sid.proc.runwayTransitions.length > 0) warnings.push(`${sid.proc.ident}: no runway transition for ${o.runway}`);
  return { plan, errors, warnings };
}
