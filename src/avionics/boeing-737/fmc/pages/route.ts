/**
 * Route pages: RTE (origin / destination / runway / CO ROUTE / flight
 * number; VIA / TO airway and direct entries; ACTIVATE), DEP/ARR INDEX,
 * DEPARTURES and ARRIVALS.
 *
 * Behaviour per FCOM 11.40 / 11.42 as summarised on b737.org.uk ("Routes
 * are usually entered by inputting the CO ROUTE ... If the company route is
 * not recognised the route can be entered manually by filling in the VIA &
 * TO columns"): an airway typed in VIA box-prompts its TO waypoint; a
 * waypoint typed in TO without a VIA is a DIRECT leg; the route then must
 * be ACTIVATEd and EXECuted. Procedures are selected on DEPARTURES /
 * ARRIVALS (<SEL> until executed, <ACT> afterwards; the lists shrink to the
 * selection and its transitions).
 */
import { GPS } from '../../../../core/vars';
import type { FlightPlan } from '../../../../nav/flightplan/FlightPlan';
import { isHoldLeg, type PlanLeg } from '../../../../nav/flightplan/types';
import { normalizeRunwayIdent, transitionServesRunway } from '../../../../nav/procedures';
import type { Procedure, Waypoint } from '../../../../nav/types';
import type { Cdu } from '../Cdu';
import { CduColor, type CduScreen } from '../screen';
import { INVALID_DELETE, INVALID_ENTRY, NOT_IN_DATABASE, boxes, dashes, type CduPage, type Lsk } from './common';

const SEL = { color: CduColor.Green, small: true };

// ================================================================== helpers

/** Boeing-style approach name for VIA / ARRIVALS: 'ILS 32', 'ILS04R', 'RNV06-Y'. */
export function approachLabel(p: Procedure): string {
  const t = p.approachType ?? '';
  const pre =
    t === 'ILS' || t === 'GLS' ? t : t === 'LOC' || t === 'LOC_BC' ? 'LOC' : t === 'RNAV' || t === 'GPS' || t === 'RNP' ? 'RNV' : t.startsWith('VOR') ? 'VOR' : t.startsWith('NDB') ? 'NDB' : t.slice(0, 3) || 'APP';
  const rw = p.runways[0] ?? '';
  const suf = p.suffix ? `-${p.suffix}` : '';
  return `${pre}${rw.padStart(3, ' ')}${suf}`.slice(0, 10);
}

/** Display ident of a plan leg (fix, or the Boeing conditional-waypoint notation). */
export function legIdent(l: PlanLeg): string {
  switch (l.type) {
    case 'DISCO':
      return boxes(5);
    case 'CA':
    case 'VA':
    case 'FA': {
      const a = l.altitude?.lowerFt ?? l.altitude?.upperFt;
      return a !== undefined ? `(${Math.round(a)})` : '(ALT)';
    }
    case 'VM':
    case 'FM':
      return '(VECTOR)';
    case 'CI':
    case 'VI':
    case 'CR':
    case 'VR':
      return '(INTC)';
    case 'CD':
    case 'VD':
    case 'FD': {
      const n = l.recommendedNavaid?.ident ?? l.fix?.ident ?? '';
      return `(${n.slice(0, 3)}${Math.round(l.distanceNm ?? 0)})`;
    }
    default:
      return l.fix?.ident ?? '-----';
  }
}

export interface RteSegment {
  via: string;
  to: string;
  kind: 'sid' | 'star' | 'appr' | 'awy' | 'direct';
  /** Leg ids of the segment. */
  ids: number[];
}

/** Groups the plan legs into RTE page VIA / TO lines. */
export function routeSegments(p: FlightPlan): RteSegment[] {
  const out: RteSegment[] = [];
  // True while the last segment may be extended (no discontinuity since).
  let open = false;
  for (const l of p.legs) {
    if (l.type === 'DISCO' || l.segment === 'origin' || l.segment === 'destination' || l.segment === 'missed' || isHoldLeg(l.type)) {
      if (l.type === 'DISCO') open = false;
      continue;
    }
    let kind: RteSegment['kind'];
    let via: string;
    if (l.segment === 'departure') {
      kind = 'sid';
      via = p.sid?.ident ?? l.procedure ?? 'SID';
    } else if (l.segment === 'arrival') {
      kind = 'star';
      via = p.star?.ident ?? l.procedure ?? 'STAR';
    } else if (l.segment === 'approach') {
      kind = 'appr';
      via = p.approachProcedure ? approachLabel(p.approachProcedure) : l.procedure ?? 'APPR';
    } else if (l.airway) {
      kind = 'awy';
      via = l.airway;
    } else {
      kind = 'direct';
      via = 'DIRECT';
    }
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (open && last && last.kind === kind && last.via === via && kind !== 'direct') {
      last.ids.push(l.id);
      last.to = legIdent(l);
    } else {
      out.push({ via, to: legIdent(l), kind, ids: [l.id] });
      open = true;
    }
  }
  return out;
}

/** Index after the last origin / departure / enroute leg (where enroute entries go). */
function enrouteInsertIndex(p: FlightPlan): number {
  let last = -1;
  p.legs.forEach((l, i) => {
    if (l.type !== 'DISCO' && (l.segment === 'origin' || l.segment === 'departure' || l.segment === 'enroute')) last = i;
  });
  return last + 1;
}

/** Last fix before the enroute insertion point (airway entry fix). */
function lastRouteFix(p: FlightPlan): { index: number; fix: Waypoint | undefined } {
  const i = enrouteInsertIndex(p) - 1;
  return { index: i, fix: p.legs[i]?.fix };
}

/** Resolves an ident to the database waypoint nearest to a reference position. */
export function resolveWaypoint(c: Cdu, ident: string, nearLat?: number, nearLon?: number): Waypoint | undefined {
  const v = c.fmc.vars;
  const la = nearLat ?? v.get(GPS.lat);
  const lo = nearLon ?? v.get(GPS.lon);
  const all = c.fmc.db.resolve(ident, la, lo);
  // Exact ident matches first (an IATA airport code must not shadow a navaid: 'BOS' is the VOR, 'KBOS' the airport).
  // SCOPE: duplicate idents take the nearest match (no SELECT DESIRED WPT page).
  return all.find((w) => w.ident === ident) ?? all[0];
}

function selMark(active: boolean, pending: boolean): string {
  return active && !pending ? '<ACT>' : '<SEL>';
}

// ================================================================== RTE

export const rtePage: CduPage = {
  id: 'rte',
  pages(c) {
    const n = routeSegments(c.fmc.plan).length + 1;
    return 1 + Math.max(1, Math.ceil(n / 5));
  },
  render(c, s) {
    const f = c.fmc;
    const p = f.plan;
    const pre = f.routeTitlePrefix();
    const n = this.pages(c);
    s.title(`${pre}RTE 1`, c.sub + 1, n, { reverse: false });
    if (pre === 'MOD ') s.put(0, Math.max(0, Math.floor((24 - 3 - `${pre}RTE 1`.length) / 2)), 'MOD', { reverse: true });
    if (c.sub === 0) {
      s.labelL(1, 'ORIGIN');
      s.dataL(1, p.origin?.icao ?? boxes(4));
      s.labelR(1, 'DEST');
      s.dataR(1, p.destination?.icao ?? boxes(4));
      s.labelL(2, 'CO ROUTE');
      s.dataL(2, f.coRoute || dashes(10));
      s.labelR(2, 'FLT NO.');
      s.dataR(2, f.flightNumber || dashes(8));
      s.labelL(3, 'RUNWAY');
      s.dataL(3, p.departureRunway ? `RW${p.departureRunway}` : dashes(5));
    } else {
      const segs = routeSegments(p);
      const pend = c.state.get('rteVia') as string | undefined;
      s.labelL(1, 'VIA');
      s.labelR(1, 'TO');
      for (let r = 1; r <= 5; r++) {
        const i = (c.sub - 1) * 5 + (r - 1);
        if (i < segs.length) {
          s.dataL(r, segs[i].via);
          s.dataR(r, segs[i].to);
        } else if (i === segs.length) {
          s.dataL(r, pend ?? dashes(5));
          s.dataR(r, pend ? boxes(5) : dashes(5));
          break;
        }
      }
    }
    s.dashes(11);
    if (f.routeModPending) s.dataL(6, '<ERASE');
    if (!f.hasActiveRoute) {
      if (p.origin && p.destination) s.dataR(6, 'ACTIVATE>');
    } else if (f.ground) s.dataR(6, 'PERF INIT>');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.row === 6) {
      if (k.side === 'L' && f.routeModPending) f.erase();
      else if (k.side === 'R') {
        if (!f.hasActiveRoute) {
          if (!f.activateRoute()) c.error(INVALID_ENTRY);
        } else if (f.ground) c.show('perfInit');
      }
      return;
    }
    if (c.sub === 0) return rtePage1Lsk(c, k, t);
    const segs = routeSegments(f.plan);
    const i = (c.sub - 1) * 5 + (k.row - 1);
    if (i > segs.length) return;
    if (i < segs.length) return rteSegmentLsk(c, k, t, segs[i], i > 0 ? segs[i - 1] : undefined);
    // Entry line.
    if (c.isDelete && c.state.has('rteVia')) {
      c.state.delete('rteVia');
      return c.consume();
    }
    if (!t) return;
    if (k.side === 'L') {
      if (t === 'DIRECT') return c.consume();
      const awy = f.db.airway(t);
      if (awy.length === 0) return c.error(NOT_IN_DATABASE);
      const last = lastRouteFix(f.plan).fix;
      if (!last || !awy.some((sg) => sg.from === last.ident || sg.to === last.ident)) return c.error(INVALID_ENTRY);
      c.state.set('rteVia', t);
      return c.consume();
    }
    const via = c.state.get('rteVia') as string | undefined;
    if (via) {
      try {
        f.editPlan((p) => {
          const { index } = lastRouteFix(p);
          const legs = p.insertAirway(index, via, t, f.db);
          if (legs.length === 0) throw new Error('empty');
        });
      } catch {
        return c.error(INVALID_ENTRY);
      }
      c.state.delete('rteVia');
      return c.consume();
    }
    const ref = lastRouteFix(f.plan).fix;
    const w = resolveWaypoint(c, t, ref?.lat, ref?.lon);
    if (!w) return c.error(NOT_IN_DATABASE);
    f.editPlan((p) => p.insertWaypoint(enrouteInsertIndex(p), w, { segment: 'enroute' }));
    c.consume();
  },
  onShow(c) {
    c.state.delete('rteVia');
  },
};

function rtePage1Lsk(c: Cdu, k: Lsk, t: string): void {
  const f = c.fmc;
  if (k.side === 'L' && k.row === 1) {
    if (!t) return;
    if (!f.ground && f.hasActiveRoute) return c.error(INVALID_ENTRY);
    const ap = f.db.airport(t);
    if (!ap) return c.error(NOT_IN_DATABASE);
    f.editPlan((p) => p.setOrigin(ap));
    if (ap.transitionAltitudeFt) f.transAltFt = ap.transitionAltitudeFt;
    if (!f.refAirport) f.refAirport = ap.icao;
    c.consume();
  } else if (k.side === 'R' && k.row === 1) {
    if (!t) return;
    const ap = f.db.airport(t);
    if (!ap) return c.error(NOT_IN_DATABASE);
    f.editPlan((p) => p.setDestination(ap));
    c.consume();
  } else if (k.side === 'L' && k.row === 2) {
    if (!t) return;
    const route = f.cfg.companyRoutes[t];
    if (!route) return c.error(NOT_IN_DATABASE);
    f.coRoute = t;
    c.consume();
    void f.fms.loadRoute(route).then(() => {
      const o = f.plan.origin;
      if (o?.transitionAltitudeFt) f.transAltFt = o.transitionAltitudeFt;
      f.version++;
    });
  } else if (k.side === 'R' && k.row === 2) {
    if (c.isDelete) {
      f.flightNumber = '';
      return c.consume();
    }
    if (!t || t.length > 8) return c.error(INVALID_ENTRY);
    f.flightNumber = t;
    c.consume();
  } else if (k.side === 'L' && k.row === 3) {
    const o = f.plan.origin;
    if (c.isDelete) {
      f.editPlan((p) => p.setDepartureRunway(null));
      return c.consume();
    }
    if (!t) return;
    if (!o) return c.error(INVALID_ENTRY);
    const rw = normalizeRunwayIdent(t);
    if (!o.runways.some((r) => normalizeRunwayIdent(r.ident) === rw)) return c.error(NOT_IN_DATABASE);
    f.editPlan((p) => p.setDepartureRunway(rw));
    f.invalidateVspeeds();
    c.consume();
  }
}

function rteSegmentLsk(c: Cdu, k: Lsk, t: string, seg: RteSegment, prev: RteSegment | undefined): void {
  const f = c.fmc;
  if (!t) {
    c.copy(k.side === 'L' ? seg.via : seg.to);
    return;
  }
  if (c.isDelete) {
    f.editPlan((p) => {
      if (seg.kind === 'sid') p.setSid(null);
      else if (seg.kind === 'star') p.setStar(null);
      else if (seg.kind === 'appr') p.setApproach(null);
      else {
        for (let j = seg.ids.length - 1; j >= 0; j--) {
          const idx = p.indexOfLegId(seg.ids[j]);
          if (idx >= 0) p.deleteLeg(idx);
        }
      }
    });
    c.consume();
    return;
  }
  if (seg.kind === 'sid' || seg.kind === 'star' || seg.kind === 'appr') return c.error(INVALID_ENTRY);
  if (k.side === 'L') {
    // New airway between the previous TO and this TO.
    const awy = f.db.airway(t);
    if (awy.length === 0) return c.error(NOT_IN_DATABASE);
    try {
      f.editPlan((p) => {
        const first = p.indexOfLegId(seg.ids[0]);
        const exit = seg.to;
        for (let j = seg.ids.length - 1; j >= 0; j--) {
          const idx = p.indexOfLegId(seg.ids[j]);
          if (idx >= 0) p.deleteLeg(idx);
        }
        p.insertAirway(first - 1, t, exit, f.db);
      });
    } catch {
      return c.error(INVALID_ENTRY);
    }
    return c.consume();
  }
  // TO on an existing line: replace the waypoint (direct) or the airway exit.
  const refFix = prev ? f.plan.legs[f.plan.indexOfLegId(prev.ids[prev.ids.length - 1])]?.fix : undefined;
  if (seg.kind === 'direct') {
    const w = resolveWaypoint(c, t, refFix?.lat, refFix?.lon);
    if (!w) return c.error(NOT_IN_DATABASE);
    f.editPlan((p) => {
      const idx = p.indexOfLegId(seg.ids[0]);
      if (idx < 0) return;
      p.deleteLeg(idx);
      p.insertWaypoint(idx, w, { segment: 'enroute' });
    });
    return c.consume();
  }
  try {
    f.editPlan((p) => {
      const first = p.indexOfLegId(seg.ids[0]);
      for (let j = seg.ids.length - 1; j >= 0; j--) {
        const idx = p.indexOfLegId(seg.ids[j]);
        if (idx >= 0) p.deleteLeg(idx);
      }
      p.insertAirway(first - 1, seg.via, t, f.db);
    });
  } catch {
    return c.error(INVALID_ENTRY);
  }
  c.consume();
}

// ================================================================== DEP/ARR INDEX

export const depArrPage: CduPage = {
  id: 'depArr',
  pages: () => 1,
  render(c, s) {
    const p = c.fmc.plan;
    s.title('DEP/ARR INDEX', 1, 1);
    s.center(1, 'RTE 1', { small: true });
    if (p.origin) {
      s.dataL(1, '<DEP');
      s.center(2, p.origin.icao);
      s.dataR(1, 'ARR>');
    }
    if (p.destination) {
      s.center(4, p.destination.icao);
      s.dataR(2, 'ARR>');
    }
    s.put(11, 1, 'DEP', { small: true });
    s.center(11, 'OTHER', { small: true });
    s.put(11, 20, 'ARR', { small: true });
    s.dataL(6, '<----');
    s.dataR(6, '---->');
  },
  lsk(c, k) {
    const p = c.fmc.plan;
    if (k.row === 1 && p.origin) {
      c.state.set('procIcao', p.origin.icao);
      c.state.set('procOther', false);
      c.show(k.side === 'L' ? 'departures' : 'arrivals');
    } else if (k.row === 2 && k.side === 'R' && p.destination) {
      c.state.set('procIcao', p.destination.icao);
      c.state.set('procOther', false);
      c.show('arrivals');
    } else if (k.row === 6) {
      const t = c.scratch.trim();
      if (!t) return;
      if (!c.fmc.db.airport(t)) return c.error(NOT_IN_DATABASE);
      c.state.set('procIcao', t);
      c.state.set('procOther', true);
      c.consume();
      c.show(k.side === 'L' ? 'departures' : 'arrivals');
    }
  },
};

// ================================================================== DEPARTURES / ARRIVALS

interface ProcItem {
  text: string;
  label?: string;
  mark?: string;
  select?: () => void;
  remove?: () => void;
}

function runwayIdents(c: Cdu, icao: string): string[] {
  const ap = c.fmc.db.airport(icao);
  if (!ap) return [];
  const set = new Set<string>();
  for (const r of ap.runways) set.add(normalizeRunwayIdent(r.ident));
  return [...set].sort();
}

function procLists(c: Cdu, dep: boolean): { left: ProcItem[]; right: ProcItem[]; icao: string; loading: boolean } {
  const f = c.fmc;
  const icao = (c.state.get('procIcao') as string | undefined) ?? (dep ? f.plan.origin?.icao : f.plan.destination?.icao) ?? '';
  const other = c.state.get('procOther') === true;
  const procs = icao ? f.procedures(icao) : null;
  const left: ProcItem[] = [];
  const right: ProcItem[] = [];
  if (!icao) return { left, right, icao, loading: false };
  const p = f.plan;
  const act = f.fms.plans.active;
  const pending = f.fms.plans.pending;
  const hasAct = f.hasActiveRoute;
  const inPlan = !other && (dep ? p.origin?.icao === icao : p.destination?.icao === icao);
  const edit = (fn: (pl: FlightPlan) => void): (() => void) | undefined => (inPlan ? () => f.editPlan(fn) : undefined);
  const rwys = runwayIdents(c, icao);
  if (dep) {
    const sids = procs && procs !== 'loading' ? procs.sids : [];
    const selSid = inPlan ? p.sidProcedure : null;
    const rw = inPlan ? p.departureRunway : null;
    if (selSid) {
      const actSame = hasAct && act.sid?.ident === selSid.ident;
      left.push({ text: selSid.ident, label: 'SIDS', mark: selMark(actSame, pending && !actSame), remove: edit((pl) => pl.setSid(null)) });
      selSid.transitions.forEach((tr, i) => {
        const sel = p.sid?.enrouteTransition === tr.name;
        if (p.sid?.enrouteTransition && !sel) return;
        const actSame = hasAct && act.sid?.enrouteTransition === tr.name;
        left.push({
          text: tr.name,
          label: i === 0 || (p.sid?.enrouteTransition && sel) ? 'TRANS' : undefined,
          mark: sel ? selMark(actSame, pending && !actSame) : undefined,
          select: edit((pl) => pl.setSid(selSid, pl.sid?.runwayTransition, tr.name)),
          remove: edit((pl) => pl.setSid(selSid, pl.sid?.runwayTransition, undefined)),
        });
      });
    } else {
      sids
        .filter((sp) => !rw || sp.runwayTransitions.length === 0 || sp.runwayTransitions.some((t) => transitionServesRunway(t.name, rw)) || sp.runways.includes(rw))
        .forEach((sp, i) => left.push({ text: sp.ident, label: i === 0 ? 'SIDS' : undefined, select: edit((pl) => pl.setSid(sp)) }));
      if (left.length === 0) left.push({ text: '', label: 'SIDS' });
    }
    const served = selSid && selSid.runwayTransitions.length > 0 ? rwys.filter((r) => selSid.runwayTransitions.some((t) => transitionServesRunway(t.name, r))) : rwys;
    const list = rw ? [rw] : served;
    list.forEach((r, i) => {
      const actSame = hasAct && act.departureRunway === r;
      right.push({
        text: r,
        label: i === 0 ? 'RUNWAYS' : undefined,
        mark: rw === r ? selMark(actSame, pending && !actSame) : undefined,
        select: edit((pl) => pl.setDepartureRunway(r)),
        remove: edit((pl) => pl.setDepartureRunway(null)),
      });
    });
  } else {
    const stars = procs && procs !== 'loading' ? procs.stars : [];
    const apps = procs && procs !== 'loading' ? procs.approaches : [];
    const selStar = inPlan ? p.starProcedure : null;
    const selApp = inPlan ? p.approachProcedure : null;
    if (selStar) {
      const actSame = hasAct && act.star?.ident === selStar.ident;
      left.push({ text: selStar.ident, label: 'STARS', mark: selMark(actSame, pending && !actSame), remove: edit((pl) => pl.setStar(null)) });
      selStar.transitions.forEach((tr, i) => {
        const sel = p.star?.enrouteTransition === tr.name;
        if (p.star?.enrouteTransition && !sel) return;
        const actSame = hasAct && act.star?.enrouteTransition === tr.name;
        left.push({
          text: tr.name,
          label: i === 0 || (p.star?.enrouteTransition && sel) ? 'TRANS' : undefined,
          mark: sel ? selMark(actSame, pending && !actSame) : undefined,
          select: edit((pl) => pl.setStar(selStar, tr.name)),
          remove: edit((pl) => pl.setStar(selStar, undefined)),
        });
      });
    } else {
      stars.forEach((sp, i) => left.push({ text: sp.ident, label: i === 0 ? 'STARS' : undefined, select: edit((pl) => pl.setStar(sp)) }));
      if (left.length === 0) left.push({ text: '', label: 'STARS' });
    }
    if (selApp) {
      const actSame = hasAct && act.approach?.ident === selApp.ident;
      right.push({ text: approachLabel(selApp), label: 'APPROACHES', mark: selMark(actSame, pending && !actSame), remove: edit((pl) => pl.setApproach(null)) });
      selApp.transitions.forEach((tr, i) => {
        const sel = p.approach?.enrouteTransition === tr.name;
        if (p.approach?.enrouteTransition && !sel) return;
        const actSame = hasAct && act.approach?.enrouteTransition === tr.name;
        right.push({
          text: tr.name,
          label: i === 0 || (p.approach?.enrouteTransition && sel) ? 'TRANS' : undefined,
          mark: sel ? selMark(actSame, pending && !actSame) : undefined,
          select: edit((pl) => pl.setApproach(selApp, tr.name)),
          remove: edit((pl) => pl.setApproach(selApp)),
        });
      });
    } else {
      apps.forEach((ap, i) => right.push({ text: approachLabel(ap), label: i === 0 ? 'APPROACHES' : undefined, select: edit((pl) => pl.setApproach(ap)) }));
      const arw = inPlan ? p.arrivalRunway : null;
      rwys.forEach((r, i) => {
        const actSame = hasAct && act.arrivalRunway === r && !act.approachProcedure;
        right.push({
          text: r,
          label: i === 0 ? 'RUNWAYS' : undefined,
          mark: arw === r ? selMark(actSame, pending && !actSame) : undefined,
          select: edit((pl) => {
            pl.setApproach(null);
            pl.setArrivalRunway(r);
          }),
          remove: edit((pl) => pl.setArrivalRunway(null)),
        });
      });
    }
  }
  return { left, right, icao, loading: procs === 'loading' };
}

function procPage(dep: boolean): CduPage {
  return {
    id: dep ? 'departures' : 'arrivals',
    pages(c) {
      const l = procLists(c, dep);
      return Math.max(1, Math.ceil(Math.max(l.left.length, l.right.length) / 5));
    },
    render(c, s: CduScreen) {
      const l = procLists(c, dep);
      const n = Math.max(1, Math.ceil(Math.max(l.left.length, l.right.length) / 5));
      s.title(`${l.icao} ${dep ? 'DEPARTURES' : 'ARRIVALS'}`, c.sub + 1, n);
      for (let r = 1; r <= 5; r++) {
        const i = c.sub * 5 + r - 1;
        const a = l.left[i];
        const b = l.right[i];
        if (a) {
          if (a.label) s.labelL(r, a.label);
          s.dataL(r, a.text);
          if (a.mark) s.put(2 * r, Math.max(a.text.length + 1, 7), a.mark, SEL);
        }
        if (b) {
          if (b.label) s.labelR(r, b.label);
          s.dataR(r, b.text);
          if (b.mark) s.put(2 * r, 24 - b.text.length - 6, b.mark, SEL);
        }
      }
      if (l.loading) s.center(9, 'LOADING', { small: true });
      s.dashes(11);
      const f = c.fmc;
      s.dataL(6, f.routeModPending ? '<ERASE' : '<INDEX');
      s.dataR(6, 'ROUTE>');
    },
    lsk(c, k) {
      const f = c.fmc;
      if (k.row === 6) {
        if (k.side === 'L') {
          if (f.routeModPending) f.erase();
          else c.show('depArr');
        } else c.show('rte');
        return;
      }
      const l = procLists(c, dep);
      const it = (k.side === 'L' ? l.left : l.right)[c.sub * 5 + k.row - 1];
      if (!it || !it.text) return;
      if (c.isDelete) {
        if (!it.remove || !it.mark) return c.error(INVALID_DELETE);
        it.remove();
        return c.consume();
      }
      if (c.scratch) return c.error(INVALID_ENTRY);
      if (!it.select) return;
      it.select();
      // The list shrinks to the selection: back to page 1.
      c.sub = 0;
    },
  };
}

export const departuresPage = procPage(true);
export const arrivalsPage = procPage(false);
