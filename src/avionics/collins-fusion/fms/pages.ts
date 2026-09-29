/**
 * FMS pages of the Pro Line Fusion FMS window (Collins FMS page structure:
 * NAV INDEX, POS INIT, ACT / MOD FPLN, ACT / MOD LEGS, DEPARTURE, ARRIVAL,
 * DIRECT-TO, PERF INIT, VNAV, PROGRESS, TAKEOFF / LANDING (TOLD), HOLD,
 * TUNE (CNS radio tuning) and MESSAGES).
 *
 * Sources / estimates:
 *  - Page titles, the ACT / MOD convention with EXEC and CANCEL MOD, LEGS
 *    page line select behaviour (line select into the scratchpad, direct-to
 *    by entering a waypoint on line 1, DELETE) follow the Collins FMS-3000 /
 *    FMS-6000 CDU convention the Fusion FMS window keeps (EST: the exact
 *    Fusion page drawings are not public).
 *  - FSB BD-700-1A10 Rev 7: "FMS RADIO tuning window, new Comm/Nav Systems
 *    (CNS) button"; "FMS Performance calculation (TOLD)"; "FMS Weight and
 *    Balance calculation"; "HF Control Page allows presetting frequencies".
 *    SCOPE: no takeoff / landing performance tables; the TOLD pages accept
 *    and display pilot-entered V-speeds (they drive the PFD speed bugs).
 */
import { FMS, GPS, NAV } from '../../../core/vars';
import { distanceNm } from '../../../core/geo';
import type { SimVars } from '../../../core/SimVars';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import type { PlanLeg } from '../../../nav/flightplan/types';
import type { Procedure, Waypoint } from '../../../nav/types';
import type { FmsHost } from './host';
import { BOX, FmsScreen, type LskId } from './screen';
import {
  fmtAlt,
  fmtAltConstraint,
  fmtCrs,
  fmtEte,
  fmtFreq,
  fmtLat,
  fmtLon,
  fmtNm,
  fmtSquawk,
  fmtTime,
  parseAdfFreq,
  parseAltitude,
  parseComFreq,
  parseHfFreq,
  parseNavFreq,
  parseSpeed,
  parseSpeedAlt,
  parseSpeedPair,
  parseSquawk,
  parseWeightLb,
} from './format';

export type FmsPageId = 'IDX' | 'POS' | 'FPLN' | 'LEGS' | 'DEP' | 'ARR' | 'DIR' | 'PERF' | 'VNAV' | 'PROG' | 'TOLD' | 'LDG' | 'HOLD' | 'TUNE' | 'MSG' | 'SEL';

export interface PageCtx {
  host: FmsHost;
  win: { state: Record<string, unknown>; side: 1 | 2 };
  vars: SimVars;
  side: 1 | 2;
}

/** Result of a line select: clear the scratchpad (ok), keep it, replace it, show an error, change page. */
export type LskResult = { ok?: boolean; keep?: boolean; scratch?: string; error?: string; page?: FmsPageId; index?: number } | void;

export interface FmsPage {
  title: string;
  pages(ctx: PageCtx): number;
  render(ctx: PageCtx, s: FmsScreen, page: number): void;
  lsk(ctx: PageCtx, k: LskId, scratch: string, page: number): LskResult;
}

const INVALID = { error: 'INVALID ENTRY' } as const;
const NOT_IN_DB = { error: 'NOT IN DATA BASE' } as const;
const NO_FMS = { error: 'FMS NOT AVAILABLE' } as const;

function lskNum(k: LskId): number {
  return Number(k[1]);
}

function titleOf(ctx: PageCtx, base: string): string {
  return `${ctx.host.modPending ? 'MOD' : 'ACT'} ${base}`;
}

function pos(ctx: PageCtx): { lat: number; lon: number } {
  return { lat: ctx.vars.get(GPS.lat), lon: ctx.vars.get(GPS.lon) };
}

// ================================================================ SELECT WPT (duplicate idents)

interface SelState {
  wpts: Waypoint[];
  ref: { lat: number; lon: number };
  from: FmsPageId;
  fromIndex: number;
  apply: (w: Waypoint) => LskResult;
}

/**
 * Resolves an ident to a waypoint; when the database holds several fixes with
 * that ident (e.g. the JST VOR and the airport whose FAA LID is JST) the
 * Collins FMS presents a SELECT WPT list, nearest first, instead of silently
 * taking one (Collins FMS-3000/6000 CDU duplicate-ident page convention).
 */
function resolveOrSelect(ctx: PageCtx, ident: string, near: { lat: number; lon: number } | undefined, from: FmsPageId, fromIndex: number, apply: (w: Waypoint) => LskResult): LskResult {
  const db = ctx.host.db;
  if (!db) return NOT_IN_DB;
  const p = near ?? pos(ctx);
  const ref = { lat: Number.isFinite(p.lat) ? p.lat : 0, lon: Number.isFinite(p.lon) ? p.lon : 0 };
  const c = db.resolve(ident.toUpperCase(), ref.lat, ref.lon);
  if (c.length === 0) return NOT_IN_DB;
  if (c.length === 1) return apply(c[0]);
  ctx.win.state.sel = { wpts: c.slice(0, 10), ref, from, fromIndex, apply } satisfies SelState;
  return { ok: true, page: 'SEL' };
}

const SEL_KIND: Readonly<Record<string, string>> = { airport: 'AIRPORT', vor: 'VOR', ndb: 'NDB', fix: 'WAYPOINT', dme: 'DME' };

const SEL: FmsPage = {
  title: 'SELECT WPT',
  pages: (ctx) => Math.max(1, Math.ceil(((ctx.win.state.sel as SelState | undefined)?.wpts.length ?? 0) / 5)),
  render(ctx, s, page) {
    s.title = 'SELECT WPT';
    const st = ctx.win.state.sel as SelState | undefined;
    if (!st) {
      s.dataC(3, 'NO SELECTION', 'amber');
      s.dataL(6, '<RETURN');
      return;
    }
    for (let i = 0; i < 5; i++) {
      const w = st.wpts[(page - 1) * 5 + i];
      if (!w) break;
      const d = distanceNm(st.ref.lat, st.ref.lon, w.lat, w.lon);
      s.labelL(i + 1, `${SEL_KIND[w.kind] ?? w.kind.toUpperCase()}  ${fmtNm(d)}NM`);
      s.dataL(i + 1, `${w.ident}  ${fmtLat(w.lat)} ${fmtLon(w.lon)}`, 'cyan');
    }
    s.dataL(6, '<RETURN');
  },
  lsk(ctx, k, _scratch, page) {
    const st = ctx.win.state.sel as SelState | undefined;
    if (k === 'L6') {
      ctx.win.state.sel = undefined;
      return { page: st?.from ?? 'IDX', index: st?.fromIndex ?? 1, keep: true };
    }
    if (!st || k[0] !== 'L') return INVALID;
    const w = st.wpts[(page - 1) * 5 + lskNum(k) - 1];
    if (!w) return INVALID;
    ctx.win.state.sel = undefined;
    const r = st.apply(w);
    return { ...(r ?? { ok: true }), page: st.from, index: st.fromIndex };
  },
};

/**
 * Edits the plan through the FMS (Boeing style: goes into the MOD plan). On
 * the ground the first leg after the origin stays the active (TO) leg, so
 * waypoints inserted in front of it during pre-flight route building are
 * flown (EST: FMS pre-flight behaviour; in flight the active leg is kept and
 * a DIRECT-TO is needed, as on the Collins / Boeing FMS).
 */
function edit(ctx: PageCtx, fn: (p: FlightPlan) => void): boolean {
  const fms = ctx.host.fms;
  if (!fms) return false;
  const p = fms.plans.edit();
  fn(p);
  if (ctx.vars.get('gear.air_ground') >= 0.5) {
    const i = p.legs.findIndex((l) => l.segment !== 'origin' && l.type !== 'DISCO' && !!l.fix);
    if (i >= 0 && i !== p.activeLegIndex) p.activateLeg(i);
  }
  fms.plans.commit();
  return true;
}

function sixth(ctx: PageCtx, s: FmsScreen, right: string): void {
  if (ctx.host.modPending) s.dataL(6, '<CANCEL MOD', 'white');
  else s.dataL(6, '<INDEX');
  if (right) s.dataR(6, right);
}

function cancelOrIndex(ctx: PageCtx): LskResult {
  if (ctx.host.modPending) {
    ctx.host.erase();
    return { keep: true };
  }
  return { page: 'IDX', keep: true };
}

const tAlt = (ctx: PageCtx): number => ctx.host.perf.transAltFt;

// ================================================================ NAV INDEX

const IDX: FmsPage = {
  title: 'NAV INDEX',
  pages: () => 1,
  render(_ctx, s) {
    s.title = 'NAV INDEX';
    s.dataL(1, '<POS INIT');
    s.dataL(2, '<FLT PLAN');
    s.dataL(3, '<DEPARTURE');
    s.dataL(4, '<ARRIVAL');
    s.dataL(5, '<HOLD');
    s.dataL(6, '<MESSAGES');
    s.dataR(1, 'PERF INIT>');
    s.dataR(2, 'VNAV>');
    s.dataR(3, 'PROGRESS>');
    s.dataR(4, 'TUNE>');
    s.dataR(5, 'TAKEOFF>');
    s.dataR(6, 'LANDING>');
  },
  lsk(_ctx, k) {
    const map: Record<LskId, FmsPageId> = { L1: 'POS', L2: 'FPLN', L3: 'DEP', L4: 'ARR', L5: 'HOLD', L6: 'MSG', R1: 'PERF', R2: 'VNAV', R3: 'PROG', R4: 'TUNE', R5: 'TOLD', R6: 'LDG' };
    return { page: map[k], keep: true };
  },
};

// ================================================================ POS INIT

const IRS_STATES = ['OFF', 'ALIGN', 'NAV', 'ATT', 'FAULT'];

const POS: FmsPage = {
  title: 'POS INIT',
  pages: () => 1,
  render(ctx, s) {
    const v = ctx.vars;
    s.title = 'POS INIT';
    s.labelL(1, 'GPS 1 POS');
    if (v.getBool(GPS.valid)) s.dataL(1, `${fmtLat(v.get(GPS.lat))} ${fmtLon(v.get(GPS.lon))}`, 'green');
    else s.dataL(1, `GPS ACQ ${Math.ceil(v.get(GPS.acquireS))}S`, 'amber');
    s.dataR(1, 'LOAD>');
    const orig = ctx.host.plan?.origin;
    s.labelL(2, 'REF APT');
    s.dataL(2, orig ? `${orig.icao} ${fmtLat(orig.lat)}` : '----');
    s.labelL(3, 'IRS 1   IRS 2   IRS 3');
    const st = [1, 2, 3].map((n) => {
      const code = Math.round(v.get(`irs${n}.state`, 2));
      const t = v.get(`ahrs${n}.align_s`);
      return code === 1 && t > 0 ? `${Math.ceil(t / 60)}MIN` : (IRS_STATES[code] ?? '----');
    });
    s.dataL(3, `${st[0].padEnd(8)}${st[1].padEnd(8)}${st[2]}`, 'green', true);
    s.labelL(4, 'UTC');
    s.dataL(4, fmtTime(v.get(GPS.utcH, v.get('env.time_utc_h'))));
    s.labelR(4, 'SATS / EPU');
    s.dataR(4, `${Math.round(v.get(GPS.sats))} / ${v.get(GPS.epuNm).toFixed(2)}NM`, 'white', true);
    s.dataR(6, 'FLT PLAN>');
    s.dataL(6, '<INDEX');
  },
  lsk(ctx, k) {
    if (k === 'R1') {
      if (!ctx.vars.getBool(GPS.valid)) return { error: 'GPS NOT VALID' };
      ctx.host.events.emit('irs.pos_entry');
      return { error: 'IRS POS LOADED' };
    }
    if (k === 'R6') return { page: 'FPLN', keep: true };
    if (k === 'L6') return { page: 'IDX', keep: true };
  },
};

// ================================================================ FPLN

interface FplnRow {
  via: string;
  to: string;
  first: number;
  last: number;
  disco: boolean;
}

function fplnRows(plan: FlightPlan): FplnRow[] {
  const rows: FplnRow[] = [];
  const legs = plan.legs;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.segment === 'origin' || l.segment === 'destination' || l.segment === 'missed') continue;
    if (l.type === 'DISCO') {
      rows.push({ via: '', to: '', first: i, last: i, disco: true });
      continue;
    }
    const via = l.airway ?? (l.segment === 'enroute' ? 'DIRECT' : (l.procedure ?? 'DIRECT'));
    const prev = rows[rows.length - 1];
    if (prev && !prev.disco && via !== 'DIRECT' && prev.via === via && prev.last === i - 1) {
      prev.last = i;
      prev.to = l.fix?.ident ?? prev.to;
      continue;
    }
    rows.push({ via, to: l.fix?.ident ?? `(${l.type})`, first: i, last: i, disco: false });
  }
  return rows;
}

/** Index before which enroute waypoints are appended (first arrival / approach / destination leg). */
function enrouteEnd(plan: FlightPlan): number {
  const i = plan.legs.findIndex((l) => l.segment === 'arrival' || l.segment === 'approach' || l.segment === 'destination' || l.segment === 'missed');
  return i < 0 ? plan.legs.length : i;
}

const FPLN_ROWS_P1 = 3;
const FPLN_ROWS_PN = 5;

const FPLN: FmsPage = {
  title: 'FPLN',
  pages(ctx) {
    const plan = ctx.host.plan;
    const n = plan ? fplnRows(plan).length + 1 : 1;
    return n <= FPLN_ROWS_P1 ? 1 : 1 + Math.ceil((n - FPLN_ROWS_P1) / FPLN_ROWS_PN);
  },
  render(ctx, s, page) {
    const plan = ctx.host.plan;
    s.title = titleOf(ctx, 'FPLN');
    if (!plan) {
      s.dataC(3, 'FMS NOT AVAILABLE', 'amber');
      return;
    }
    const rows = fplnRows(plan);
    let first = 0;
    let line = 3;
    let count = FPLN_ROWS_P1;
    if (page === 1) {
      s.labelL(1, 'ORIGIN');
      s.dataL(1, plan.origin ? plan.origin.icao : BOX.repeat(4), plan.origin ? 'white' : 'amber');
      s.labelR(1, 'DEST');
      s.dataR(1, plan.destination ? plan.destination.icao : BOX.repeat(4), plan.destination ? 'white' : 'amber');
      s.labelL(2, 'ORIG RWY');
      s.dataL(2, plan.departureRunway ? `RW${plan.departureRunway}` : '----');
      s.labelR(2, 'DIST / CRZ ALT');
      const dist = ctx.vars.get(FMS.distToDestNm);
      s.dataR(2, `${fmtNm(dist)}NM / ${plan.cruiseAltFt ? fmtAlt(plan.cruiseAltFt, tAlt(ctx)) : '-----'}`, 'white', true);
    } else {
      first = FPLN_ROWS_P1 + (page - 2) * FPLN_ROWS_PN;
      line = 1;
      count = FPLN_ROWS_PN;
    }
    for (let i = 0; i < count; i++) {
      const r = first + i;
      const k = line + i;
      if (k > 5) break;
      if (r < rows.length) {
        const row = rows[r];
        if (row.disco) {
          s.labelC(k, '- DISCONTINUITY -');
          s.dataC(k, BOX.repeat(5), 'amber');
          continue;
        }
        s.labelL(k, 'VIA');
        s.labelR(k, 'TO');
        s.dataL(k, row.via, row.via === 'DIRECT' ? 'white' : 'green');
        s.dataR(k, row.to, row.first <= plan.activeLegIndex && plan.activeLegIndex <= row.last ? 'magenta' : 'white');
      } else if (r === rows.length) {
        s.labelL(k, 'VIA');
        s.labelR(k, 'TO');
        const pend = ctx.win.state.fplnAirway as string | undefined;
        s.dataL(k, pend ?? '-----', pend ? 'cyan' : 'white');
        s.dataR(k, '-----');
      }
    }
    sixth(ctx, s, 'PERF INIT>');
  },
  lsk(ctx, k, scratch, page) {
    const plan = ctx.host.plan;
    const fms = ctx.host.fms;
    if (!plan || !fms) return NO_FMS;
    const n = lskNum(k);
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'PERF', keep: true };
    const db = ctx.host.db;
    if (page === 1 && n <= 2) {
      if (k === 'L1') {
        if (scratch.includes(' ')) {
          // Route string (EST shortcut for a datalinked / pre-loaded route): 'KTEB WAVEY V16 ... KBOS'.
          void fms.loadRoute(scratch);
          return { ok: true };
        }
        if (!scratch) return { scratch: plan.origin?.icao ?? '' };
        const ap = db?.airport(scratch);
        if (!ap) return NOT_IN_DB;
        edit(ctx, (p) => p.setOrigin(ap));
        return { ok: true };
      }
      if (k === 'R1') {
        if (!scratch) return { scratch: plan.destination?.icao ?? '' };
        const ap = db?.airport(scratch);
        if (!ap) return NOT_IN_DB;
        edit(ctx, (p) => p.setDestination(ap));
        return { ok: true };
      }
      if (k === 'L2') {
        if (!plan.origin) return INVALID;
        const rw = scratch.replace(/^RW/, '');
        if (!plan.origin.runways.some((r) => r.ident === rw || r.ident === rw.padStart(3, '0'))) return NOT_IN_DB;
        edit(ctx, (p) => p.setDepartureRunway(rw));
        return { ok: true };
      }
      return;
    }
    const rows = fplnRows(plan);
    const r = page === 1 ? n - 3 : FPLN_ROWS_P1 + (page - 2) * FPLN_ROWS_PN + (n - 1);
    if (r < 0 || n > 5) return;
    const isLeft = k[0] === 'L';
    if (r < rows.length) {
      const row = rows[r];
      if (scratch === 'DELETE') {
        edit(ctx, (p) => {
          for (let i = row.last; i >= row.first; i--) p.deleteLeg(i);
        });
        return { ok: true };
      }
      if (!scratch) return { scratch: isLeft ? (row.via === 'DIRECT' ? '' : row.via) : row.to };
      if (isLeft) return INVALID;
      const prevLeg = plan.legs[row.first - 1];
      const at = row.first;
      return resolveOrSelect(ctx, scratch, prevLeg?.fix ?? undefined, 'FPLN', page, (w) => {
        edit(ctx, (p) => p.insertWaypoint(at, w, { segment: 'enroute' }));
        return { ok: true };
      });
    }
    if (r === rows.length) {
      if (isLeft) {
        // Airway entry: the next TO entry is its exit fix.
        if (!/^[A-Z]{1,2}\d{1,4}$/.test(scratch)) return INVALID;
        if (!db || db.airway(scratch).length === 0) return NOT_IN_DB;
        ctx.win.state.fplnAirway = scratch;
        return { ok: true };
      }
      if (!scratch) return;
      const airway = ctx.win.state.fplnAirway as string | undefined;
      const end = enrouteEnd(plan);
      if (airway && db) {
        const entry = Math.max(0, end - 1);
        let ok = true;
        edit(ctx, (p) => {
          try {
            p.insertAirway(entry, airway, scratch, db);
          } catch {
            ok = false;
          }
        });
        ctx.win.state.fplnAirway = undefined;
        return ok ? { ok: true } : { error: 'NOT ON AIRWAY' };
      }
      const prevLeg = plan.legs[end - 1];
      return resolveOrSelect(ctx, scratch, prevLeg?.fix ?? undefined, 'FPLN', page, (w) => {
        edit(ctx, (p) => p.appendEnrouteWaypoint(w));
        return { ok: true };
      });
    }
  },
};

// ================================================================ LEGS

const LEGS_PER_PAGE = 5;

function legsFrom(plan: FlightPlan): number {
  return Math.max(0, plan.activeLegIndex);
}

function legLabel(l: PlanLeg): string {
  const g = l.geom;
  if (!g.valid || g.kind === 'none') return '';
  const crs = Number.isFinite(g.courseTrue) ? fmtCrs(g.courseTrue - (l.magVar ?? 0)) : '';
  return `${crs} ${fmtNm(g.lengthNm)}NM`;
}

const LEGS: FmsPage = {
  title: 'LEGS',
  pages(ctx) {
    const plan = ctx.host.plan;
    if (!plan) return 1;
    return Math.max(1, Math.ceil((plan.legs.length - legsFrom(plan)) / LEGS_PER_PAGE));
  },
  render(ctx, s, page) {
    const plan = ctx.host.plan;
    s.title = titleOf(ctx, 'LEGS');
    if (!plan) {
      s.dataC(3, 'FMS NOT AVAILABLE', 'amber');
      return;
    }
    const start = legsFrom(plan) + (page - 1) * LEGS_PER_PAGE;
    for (let i = 0; i < LEGS_PER_PAGE; i++) {
      const idx = start + i;
      const l = plan.legs[idx];
      const k = i + 1;
      if (!l) {
        if (idx === plan.legs.length) s.dataC(k, '----- END OF ROUTE -----', 'white', true);
        break;
      }
      if (l.type === 'DISCO') {
        s.labelC(k, '- DISCONTINUITY -');
        s.dataL(k, BOX.repeat(5), 'amber');
        continue;
      }
      s.labelL(k, legLabel(l), 'white');
      const active = idx === plan.activeLegIndex;
      let ident = l.fix?.ident ?? `(${l.type})`;
      if (l.type === 'HM' || l.type === 'HF' || l.type === 'HA') ident = `HOLD ${ident}`;
      s.dataL(k, ident, active ? 'magenta' : 'white');
      const sp = l.speed ? `${l.speed.kt}` : '';
      const al = l.altitude ? fmtAltConstraint(l.altitude, tAlt(ctx)) : '';
      if (sp || al) s.dataR(k, `${sp}/${al}`, l.userConstraint ? 'cyan' : 'white');
      else if (Number.isFinite(l.geom.predictedAltFt)) s.dataR(k, `---/${fmtAlt(l.geom.predictedAltFt, tAlt(ctx))}`, 'white', true);
    }
    sixth(ctx, s, 'HOLD>');
  },
  lsk(ctx, k, scratch, page) {
    const plan = ctx.host.plan;
    const fms = ctx.host.fms;
    if (!plan || !fms) return NO_FMS;
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'HOLD', keep: true };
    const n = lskNum(k);
    const idx = legsFrom(plan) + (page - 1) * LEGS_PER_PAGE + (n - 1);
    const leg = plan.legs[idx];
    if (!leg) return;
    if (k[0] === 'L') {
      if (!scratch) return leg.fix ? { scratch: leg.fix.ident } : undefined;
      if (scratch === 'DELETE') {
        if (idx === plan.activeLegIndex && leg.type !== 'DISCO') return INVALID;
        edit(ctx, (p) => p.deleteLeg(idx));
        return { ok: true };
      }
      if (idx === plan.activeLegIndex) {
        // Direct-to by entering the waypoint on the active line.
        return fms.directTo(scratch) ? { ok: true } : NOT_IN_DB;
      }
      return resolveOrSelect(ctx, scratch, plan.legs[idx - 1]?.fix ?? undefined, 'LEGS', page, (w) => {
        edit(ctx, (p) => p.insertWaypoint(idx, w));
        return { ok: true };
      });
    }
    // Right side: speed / altitude constraint.
    if (leg.type === 'DISCO') return INVALID;
    if (scratch === 'DELETE') {
      edit(ctx, (p) => {
        p.setAltitudeConstraint(idx, null);
        p.setSpeedConstraint(idx, null);
      });
      return { ok: true };
    }
    if (!scratch) return;
    const e = parseSpeedAlt(scratch);
    if (!e) return INVALID;
    edit(ctx, (p) => {
      if (e.alt !== undefined) p.setAltitudeConstraint(idx, e.alt);
      if (e.speed !== undefined) p.setSpeedConstraint(idx, e.speed);
    });
    return { ok: true };
  },
};

// ================================================================ DIRECT-TO

const DIR: FmsPage = {
  title: 'DIRECT-TO',
  pages: () => 1,
  render(ctx, s) {
    const plan = ctx.host.plan;
    s.title = ctx.host.modPending ? 'MOD DIRECT-TO' : 'DIRECT-TO';
    if (!plan) return;
    let k = 1;
    for (let i = Math.max(0, plan.activeLegIndex); i < plan.legs.length && k <= 5; i++) {
      const l = plan.legs[i];
      if (l.type === 'DISCO' || !l.fix) continue;
      s.dataL(k, `<${l.fix.ident}`, i === plan.activeLegIndex ? 'magenta' : 'white');
      s.labelL(k, k === 1 ? 'ENTER WPT OR SELECT' : '');
      k++;
    }
    sixth(ctx, s, 'LEGS>');
  },
  lsk(ctx, k, scratch) {
    const plan = ctx.host.plan;
    const fms = ctx.host.fms;
    if (!plan || !fms) return NO_FMS;
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'LEGS', keep: true };
    if (k[0] !== 'L') return;
    if (scratch) return fms.directTo(scratch) ? { ok: true, page: 'LEGS' } : NOT_IN_DB;
    let n = lskNum(k);
    for (let i = Math.max(0, plan.activeLegIndex); i < plan.legs.length; i++) {
      const l = plan.legs[i];
      if (l.type === 'DISCO' || !l.fix) continue;
      if (--n === 0) return fms.directTo(i) ? { keep: true, page: 'LEGS' } : INVALID;
    }
  },
};

// ================================================================ DEPARTURE / ARRIVAL

function listSlice<T>(list: readonly T[], page: number, per = 5): T[] {
  return list.slice((page - 1) * per, (page - 1) * per + per);
}

function runwaysOf(plan: FlightPlan): string[] {
  const o = plan.origin;
  if (!o) return [];
  return [...new Set(o.runways.map((r) => r.ident))].sort();
}

function sidsFor(procs: readonly Procedure[], rw: string | null): Procedure[] {
  if (!rw) return [...procs];
  return procs.filter((p) => p.runways.length === 0 || p.runways.includes(rw) || p.runwayTransitions.some((t) => t.name === 'ALL' || t.name === rw || (t.name.endsWith('B') && rw.startsWith(t.name.slice(0, -1)))));
}

const DEP: FmsPage = {
  title: 'DEPARTURE',
  pages(ctx) {
    const plan = ctx.host.plan;
    if (!plan?.origin) return 1;
    const procs = ctx.host.procedures(plan.origin.icao);
    const sid = ctx.win.state.depSid as string | undefined;
    const right = procs ? (sid ? (procs.sids.find((p) => p.ident === sid)?.transitions.length ?? 0) + 1 : sidsFor(procs.sids, plan.departureRunway).length) : 0;
    return Math.max(1, Math.ceil(Math.max(runwaysOf(plan).length, right) / 5));
  },
  render(ctx, s, page) {
    const plan = ctx.host.plan;
    s.title = `${plan?.origin?.icao ?? ''} DEPARTURE`.trim();
    if (!plan?.origin) {
      s.dataC(3, 'NO ORIGIN', 'amber');
      sixth(ctx, s, 'ARRIVAL>');
      return;
    }
    s.labelL(1, 'RUNWAYS');
    const rws = listSlice(runwaysOf(plan), page);
    rws.forEach((rw, i) => {
      const sel = plan.departureRunway === rw;
      s.dataL(i + 1, sel ? `${rw} <SEL>` : rw, sel ? 'green' : 'white');
    });
    const procs = ctx.host.procedures(plan.origin.icao);
    if (procs === undefined) s.dataR(1, 'LOADING', 'amber', true);
    else if (!procs) s.dataR(1, 'NONE', 'white', true);
    else {
      const sidId = ctx.win.state.depSid as string | undefined;
      const sid = sidId ? procs.sids.find((p) => p.ident === sidId) : undefined;
      if (sid) {
        s.labelR(1, 'TRANS');
        const items = ['NONE', ...sid.transitions.map((t) => t.name)];
        listSlice(items, page).forEach((t, i) => {
          const sel = (plan.sid?.enrouteTransition ?? 'NONE') === t && plan.sid?.ident === sid.ident;
          s.dataR(i + 1, sel ? `<SEL> ${t}` : t, sel ? 'green' : 'white');
        });
        s.labelC(1, sid.ident);
      } else {
        s.labelR(1, 'SIDS');
        listSlice(sidsFor(procs.sids, plan.departureRunway), page).forEach((p, i) => {
          const sel = plan.sid?.ident === p.ident;
          s.dataR(i + 1, sel ? `<SEL> ${p.ident}` : p.ident, sel ? 'green' : 'white');
        });
      }
    }
    sixth(ctx, s, 'ARRIVAL>');
  },
  lsk(ctx, k, _scratch, page) {
    const plan = ctx.host.plan;
    if (!plan || !ctx.host.fms) return NO_FMS;
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'ARR', keep: true };
    if (!plan.origin) return INVALID;
    const n = lskNum(k) - 1;
    if (k[0] === 'L') {
      const rw = listSlice(runwaysOf(plan), page)[n];
      if (!rw) return;
      edit(ctx, (p) => p.setDepartureRunway(rw));
      ctx.win.state.depSid = undefined;
      return { keep: true };
    }
    const procs = ctx.host.procedures(plan.origin.icao);
    if (!procs) return;
    const sidId = ctx.win.state.depSid as string | undefined;
    const sid = sidId ? procs.sids.find((p) => p.ident === sidId) : undefined;
    if (sid) {
      const t = listSlice(['NONE', ...sid.transitions.map((x) => x.name)], page)[n];
      if (!t) return;
      edit(ctx, (p) => p.setSid(sid, undefined, t === 'NONE' ? undefined : t));
      ctx.win.state.depSid = undefined;
      return { keep: true };
    }
    const pick = listSlice(sidsFor(procs.sids, plan.departureRunway), page)[n];
    if (!pick) return;
    edit(ctx, (p) => p.setSid(pick));
    ctx.win.state.depSid = pick.transitions.length ? pick.ident : undefined;
    return { keep: true, page: 'DEP', index: 1 };
  },
};

const ARR: FmsPage = {
  title: 'ARRIVAL',
  pages(ctx) {
    const plan = ctx.host.plan;
    if (!plan?.destination) return 1;
    const procs = ctx.host.procedures(plan.destination.icao);
    if (!procs) return 1;
    return Math.max(1, Math.ceil(Math.max(procs.approaches.length + 1, procs.stars.length + 1) / 5));
  },
  render(ctx, s, page) {
    const plan = ctx.host.plan;
    s.title = `${plan?.destination?.icao ?? ''} ARRIVAL`.trim();
    if (!plan?.destination) {
      s.dataC(3, 'NO DESTINATION', 'amber');
      sixth(ctx, s, 'DEPARTURE>');
      return;
    }
    const procs = ctx.host.procedures(plan.destination.icao);
    if (procs === undefined) {
      s.dataC(3, 'LOADING', 'amber');
      sixth(ctx, s, 'DEPARTURE>');
      return;
    }
    if (!procs) {
      s.dataC(3, 'NO PROCEDURES', 'white');
      sixth(ctx, s, 'DEPARTURE>');
      return;
    }
    const apId = ctx.win.state.arrAppr as string | undefined;
    const ap = apId ? procs.approaches.find((p) => p.ident === apId) : undefined;
    if (ap) {
      s.labelL(1, 'APPR TRANS');
      const items = ['VECTORS', ...ap.transitions.map((t) => t.name)];
      listSlice(items, page).forEach((t, i) => {
        const sel = plan.approach?.ident === ap.ident && (plan.approach?.enrouteTransition ?? 'VECTORS') === t;
        s.dataL(i + 1, sel ? `${t} <SEL>` : t, sel ? 'green' : 'white');
      });
    } else {
      s.labelL(1, 'APPROACHES');
      listSlice(procs.approaches, page).forEach((p, i) => {
        const sel = plan.approach?.ident === p.ident;
        s.dataL(i + 1, sel ? `${p.ident} <SEL>` : p.ident, sel ? 'green' : 'white');
      });
    }
    const stId = ctx.win.state.arrStar as string | undefined;
    const st = stId ? procs.stars.find((p) => p.ident === stId) : undefined;
    if (st) {
      s.labelR(1, 'STAR TRANS');
      listSlice(['NONE', ...st.transitions.map((t) => t.name)], page).forEach((t, i) => {
        const sel = plan.star?.ident === st.ident && (plan.star?.enrouteTransition ?? 'NONE') === t;
        s.dataR(i + 1, sel ? `<SEL> ${t}` : t, sel ? 'green' : 'white');
      });
    } else {
      s.labelR(1, 'STARS');
      listSlice(procs.stars, page).forEach((p, i) => {
        const sel = plan.star?.ident === p.ident;
        s.dataR(i + 1, sel ? `<SEL> ${p.ident}` : p.ident, sel ? 'green' : 'white');
      });
    }
    sixth(ctx, s, 'DEPARTURE>');
  },
  lsk(ctx, k, _scratch, page) {
    const plan = ctx.host.plan;
    if (!plan || !ctx.host.fms) return NO_FMS;
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'DEP', keep: true };
    if (!plan.destination) return INVALID;
    const procs = ctx.host.procedures(plan.destination.icao);
    if (!procs) return;
    const n = lskNum(k) - 1;
    if (k[0] === 'L') {
      const apId = ctx.win.state.arrAppr as string | undefined;
      const ap = apId ? procs.approaches.find((p) => p.ident === apId) : undefined;
      if (ap) {
        const t = listSlice(['VECTORS', ...ap.transitions.map((x) => x.name)], page)[n];
        if (!t) return;
        edit(ctx, (p) => p.setApproach(ap, t === 'VECTORS' ? undefined : t));
        ctx.win.state.arrAppr = undefined;
        return { keep: true };
      }
      const pick = listSlice(procs.approaches, page)[n];
      if (!pick) return;
      edit(ctx, (p) => p.setApproach(pick));
      ctx.win.state.arrAppr = pick.transitions.length ? pick.ident : undefined;
      return { keep: true, page: 'ARR', index: 1 };
    }
    const stId = ctx.win.state.arrStar as string | undefined;
    const st = stId ? procs.stars.find((p) => p.ident === stId) : undefined;
    if (st) {
      const t = listSlice(['NONE', ...st.transitions.map((x) => x.name)], page)[n];
      if (!t) return;
      edit(ctx, (p) => p.setStar(st, t === 'NONE' ? undefined : t));
      ctx.win.state.arrStar = undefined;
      return { keep: true };
    }
    const pick = listSlice(procs.stars, page)[n];
    if (!pick) return;
    edit(ctx, (p) => p.setStar(pick));
    ctx.win.state.arrStar = pick.transitions.length ? pick.ident : undefined;
    return { keep: true, page: 'ARR', index: 1 };
  },
};

// ================================================================ PERF INIT / VNAV

function fmtLb(n: number): string {
  return Number.isFinite(n) ? `${(n / 1000).toFixed(1)}` : '---.-';
}

const PERF: FmsPage = {
  title: 'PERF INIT',
  pages: () => 1,
  render(ctx, s) {
    const h = ctx.host;
    const p = h.perf;
    const af = h.cfg.airframe;
    s.title = 'PERF INIT';
    s.labelL(1, 'BOW (LB x1000)');
    s.dataL(1, fmtLb(p.bowLb), 'cyan');
    s.labelL(2, 'PAX / CARGO');
    s.dataL(2, fmtLb(p.payloadLb), 'cyan');
    const zfw = h.zfwLb();
    s.labelL(3, 'ZFW');
    s.dataL(3, fmtLb(zfw), zfw > af.mzfwLb ? 'amber' : 'white');
    s.labelL(4, 'FUEL');
    s.dataL(4, fmtLb(h.fuelLb()), 'green');
    const gw = h.gwLb();
    s.labelL(5, 'GWT');
    s.dataL(5, fmtLb(gw), gw > af.mtowLb ? 'amber' : 'white');
    const plan = h.plan;
    s.labelR(1, 'CRZ ALT');
    s.dataR(1, plan?.cruiseAltFt ? fmtAlt(plan.cruiseAltFt, p.transAltFt) : BOX.repeat(5), plan?.cruiseAltFt ? 'cyan' : 'amber');
    s.labelR(2, 'TRANS ALT');
    s.dataR(2, fmtAlt(p.transAltFt, 1e9), 'cyan');
    s.labelR(3, 'RESERVES');
    s.dataR(3, fmtLb(p.reservesLb), 'cyan');
    s.labelR(4, 'MTOW / MLW');
    s.dataR(4, `${fmtLb(af.mtowLb)} / ${fmtLb(af.mlwLb)}`, 'white', true);
    s.dataR(5, p.confirmed ? 'INIT COMPLETE' : 'CONFIRM INIT>', p.confirmed ? 'green' : 'white');
    s.dataL(6, '<INDEX');
    s.dataR(6, 'VNAV>');
  },
  lsk(ctx, k, scratch) {
    const h = ctx.host;
    const p = h.perf;
    switch (k) {
      case 'L1':
      case 'L2':
      case 'R3': {
        const w = parseWeightLb(scratch);
        if (!Number.isFinite(w)) return INVALID;
        if (k === 'L1') p.bowLb = w;
        else if (k === 'L2') p.payloadLb = w;
        else p.reservesLb = w;
        p.confirmed = false;
        return { ok: true };
      }
      case 'R1': {
        const ft = parseAltitude(scratch);
        if (!Number.isFinite(ft) || ft > 51000) return INVALID; // 51,000 ft maximum operating altitude (TCDS IM.A.009)
        h.fms?.setCruiseAltitude(ft);
        return { ok: true };
      }
      case 'R2': {
        const ft = parseAltitude(scratch);
        if (!Number.isFinite(ft) || ft < 3000) return INVALID;
        p.transAltFt = ft;
        return { ok: true };
      }
      case 'R5':
        p.confirmed = true;
        h.applySpeeds();
        return { keep: true };
      case 'L6':
        return { page: 'IDX', keep: true };
      case 'R6':
        return { page: 'VNAV', keep: true };
    }
  },
};

function fmtPair(kt: number, mach: number): string {
  return `${Math.round(kt)}/.${Math.round(mach * 100).toString().padStart(2, '0')}`;
}

const VNAV: FmsPage = {
  title: 'VNAV SETUP',
  pages: () => 1,
  render(ctx, s) {
    const p = ctx.host.perf;
    const v = ctx.vars;
    s.title = 'VNAV SETUP';
    s.labelL(1, 'CLIMB SPD');
    s.dataL(1, fmtPair(p.climbKt, p.climbMach), 'cyan');
    s.labelL(2, 'CRUISE SPD');
    s.dataL(2, fmtPair(p.cruiseKt, p.cruiseMach), 'cyan');
    s.labelL(3, 'DESCENT SPD');
    s.dataL(3, fmtPair(p.descentKt, p.descentMach), 'cyan');
    s.labelL(4, 'DESCENT ANGLE');
    s.dataL(4, `${p.vpaDeg.toFixed(1)}°`, 'cyan');
    s.labelR(1, 'SPD LIMIT');
    s.dataR(1, '250/10000', 'white', true); // 14 CFR 91.117(a)
    s.labelR(2, 'VNAV PHASE');
    s.dataR(2, v.getString(FMS.vnavPhase) || '----', 'green');
    s.labelR(3, 'TGT ALT');
    s.dataR(3, fmtAlt(v.get(FMS.vnavTargetAltFt), p.transAltFt), 'magenta');
    s.labelR(4, 'TOD');
    s.dataR(4, v.get(FMS.todDistNm) > 0 ? `${fmtNm(v.get(FMS.todDistNm))}NM ${fmtEte(v.get(FMS.todEteS))}` : '----', 'white', true);
    s.dataL(6, '<PERF INIT');
    s.dataR(6, 'PROGRESS>');
  },
  lsk(ctx, k, scratch) {
    const p = ctx.host.perf;
    if (k === 'L6') return { page: 'PERF', keep: true };
    if (k === 'R6') return { page: 'PROG', keep: true };
    if (k === 'L4') {
      const a = Number(scratch);
      if (!(a >= 1 && a <= 6)) return INVALID; // FMS maxFpaDeg 6
      p.vpaDeg = a;
      ctx.host.applySpeeds();
      return { ok: true };
    }
    if (k === 'L1' || k === 'L2' || k === 'L3') {
      const sp = parseSpeedPair(scratch);
      if (!sp) return INVALID;
      const set = (kt: 'climbKt' | 'cruiseKt' | 'descentKt', m: 'climbMach' | 'cruiseMach' | 'descentMach') => {
        if (Number.isFinite(sp.kt)) p[kt] = sp.kt;
        if (Number.isFinite(sp.mach)) p[m] = sp.mach;
      };
      if (k === 'L1') set('climbKt', 'climbMach');
      else if (k === 'L2') set('cruiseKt', 'cruiseMach');
      else set('descentKt', 'descentMach');
      ctx.host.applySpeeds();
      return { ok: true };
    }
  },
};

// ================================================================ PROGRESS

const PROG: FmsPage = {
  title: 'PROGRESS',
  pages: () => 1,
  render(ctx, s) {
    const v = ctx.vars;
    s.title = 'PROGRESS';
    s.labelL(1, 'TO');
    s.dataL(1, v.getString(FMS.nextWptIdent) || '----', 'magenta');
    s.labelR(1, 'DIST / ETE');
    s.dataR(1, `${fmtNm(v.get(FMS.distToWptNm))} ${fmtEte(v.get(FMS.eteToWptS))}`);
    s.labelL(2, 'NEXT');
    s.dataL(2, v.getString(FMS.afterWptIdent) || '----');
    s.labelL(3, 'DEST');
    s.dataL(3, v.getString(FMS.destIdent) || '----');
    s.labelR(3, 'DIST / ETE / FUEL');
    const fuel = v.get(FMS.fuelDestKg) * 2.20462;
    s.dataR(3, `${fmtNm(v.get(FMS.distToDestNm))} ${fmtEte(v.get(FMS.eteDestS))} ${fmtLb(fuel)}`, 'white', true);
    s.labelL(4, 'XTK');
    const xtk = v.get(FMS.xtkNm);
    s.dataL(4, Number.isFinite(xtk) ? `${xtk >= 0 ? 'R' : 'L'}${Math.abs(xtk).toFixed(2)}NM` : '----');
    s.labelR(4, 'GS / TAS');
    s.dataR(4, `${Math.round(v.get(GPS.gs))} / ${Math.round(v.get('adc1.tas_kt'))}`);
    s.labelL(5, 'NAV MODE');
    s.dataL(5, v.getString(FMS.approachMode) || '----', 'green');
    s.labelR(5, 'FUEL (LB)');
    s.dataR(5, fmtLb(ctx.host.fuelLb()), 'green');
    s.dataL(6, '<INDEX');
    s.dataR(6, 'LEGS>');
  },
  lsk(_ctx, k) {
    if (k === 'L6') return { page: 'IDX', keep: true };
    if (k === 'R6') return { page: 'LEGS', keep: true };
  },
};

// ================================================================ TOLD

type Vs = 'v1' | 'vr' | 'v2' | 'vt' | 'vref' | 'vapp';

function vsLine(ctx: PageCtx, s: FmsScreen, k: number, label: string, id: Vs, right: boolean): void {
  const kt = ctx.host.vspd(id);
  const txt = kt > 0 ? `${Math.round(kt)}` : '---';
  if (right) {
    s.labelR(k, label);
    s.dataR(k, txt, kt > 0 ? 'cyan' : 'white');
  } else {
    s.labelL(k, label);
    s.dataL(k, txt, kt > 0 ? 'cyan' : 'white');
  }
}

function vsEntry(ctx: PageCtx, id: Vs, scratch: string): LskResult {
  if (scratch === 'DELETE') {
    ctx.host.setVspd(id, 0);
    return { ok: true };
  }
  const sp = parseSpeed(scratch);
  if (!sp || !Number.isFinite(sp.kt) || sp.kt < 80 || sp.kt > 250) return INVALID;
  ctx.host.setVspd(id, sp.kt);
  return { ok: true };
}

const TOLD: FmsPage = {
  title: 'TAKEOFF',
  pages: () => 1,
  render(ctx, s) {
    const plan = ctx.host.plan;
    s.title = 'TAKEOFF REF';
    vsLine(ctx, s, 1, 'V1', 'v1', false);
    vsLine(ctx, s, 2, 'VR', 'vr', false);
    vsLine(ctx, s, 3, 'V2', 'v2', false);
    vsLine(ctx, s, 4, 'VT', 'vt', false);
    s.labelR(1, 'RWY');
    s.dataR(1, plan?.departureRunway ? `${plan.origin?.icao ?? ''} ${plan.departureRunway}` : '----');
    s.labelR(2, 'T/O FLAPS');
    s.dataR(2, `${(ctx.win.state.toFlaps as string | undefined) ?? '16'}`, 'cyan');
    s.labelR(3, 'OAT');
    s.dataR(3, `${Math.round(ctx.vars.get('adc1.sat_c'))}°C`);
    s.dataC(5, 'SPEEDS: PILOT ENTRY', 'grey', true);
    s.dataL(6, '<INDEX');
    s.dataR(6, 'LANDING>');
  },
  lsk(ctx, k, scratch) {
    if (k === 'L1') return vsEntry(ctx, 'v1', scratch);
    if (k === 'L2') return vsEntry(ctx, 'vr', scratch);
    if (k === 'L3') return vsEntry(ctx, 'v2', scratch);
    if (k === 'L4') return vsEntry(ctx, 'vt', scratch);
    if (k === 'R2') {
      if (scratch !== '6' && scratch !== '16') return INVALID; // Global takeoff flap settings (slat/flap lever 6 / 16)
      ctx.win.state.toFlaps = scratch;
      return { ok: true };
    }
    if (k === 'L6') return { page: 'IDX', keep: true };
    if (k === 'R6') return { page: 'LDG', keep: true };
  },
};

const LDG: FmsPage = {
  title: 'LANDING',
  pages: () => 1,
  render(ctx, s) {
    const plan = ctx.host.plan;
    s.title = 'APPROACH REF';
    vsLine(ctx, s, 1, 'VREF', 'vref', false);
    vsLine(ctx, s, 2, 'VAPP', 'vapp', false);
    s.labelR(1, 'DEST RWY');
    s.dataR(1, plan?.arrivalRunway ? `${plan.destination?.icao ?? ''} ${plan.arrivalRunway}` : '----');
    s.labelR(2, 'LDG FLAPS');
    s.dataR(2, '30', 'white');
    s.dataC(5, 'SPEEDS: PILOT ENTRY', 'grey', true);
    s.dataL(6, '<INDEX');
    s.dataR(6, 'TAKEOFF>');
  },
  lsk(ctx, k, scratch) {
    if (k === 'L1') return vsEntry(ctx, 'vref', scratch);
    if (k === 'L2') return vsEntry(ctx, 'vapp', scratch);
    if (k === 'L6') return { page: 'IDX', keep: true };
    if (k === 'R6') return { page: 'TOLD', keep: true };
  },
};

// ================================================================ HOLD

const HOLD: FmsPage = {
  title: 'HOLD',
  pages: () => 1,
  render(ctx, s) {
    const plan = ctx.host.plan;
    const st = ctx.win.state;
    const fix = (st.holdFix as string | undefined) ?? plan?.activeLeg?.fix?.ident ?? '';
    s.title = ctx.host.modPending ? 'MOD HOLD' : 'HOLD';
    s.labelL(1, 'HOLD FIX');
    s.dataL(1, fix || BOX.repeat(5), fix ? 'white' : 'amber');
    s.labelL(2, 'INBD CRS / DIR');
    const crs = st.holdCrs as number | undefined;
    s.dataL(2, `${crs !== undefined ? fmtCrs(crs) : 'AUTO'} / ${(st.holdDir as string | undefined) ?? 'R'}`, 'cyan');
    s.labelL(3, 'LEG TIME');
    s.dataL(3, `${((st.holdTime as number | undefined) ?? 1).toFixed(1)} MIN`, 'cyan');
    if (ctx.vars.getBool(FMS.inHold)) {
      s.dataR(5, 'EXIT HOLD>', 'white');
      s.labelR(5, ctx.vars.getString(FMS.holdEntry) || 'IN HOLD');
    }
    s.dataR(4, 'INSERT HOLD>');
    sixth(ctx, s, 'LEGS>');
  },
  lsk(ctx, k, scratch) {
    const st = ctx.win.state;
    const plan = ctx.host.plan;
    if (k === 'L6') return cancelOrIndex(ctx);
    if (k === 'R6') return { page: 'LEGS', keep: true };
    if (k === 'L1') {
      if (!scratch) return INVALID;
      if (!plan?.legs.some((l) => l.fix?.ident === scratch)) return { error: 'NOT IN FLT PLAN' };
      st.holdFix = scratch;
      return { ok: true };
    }
    if (k === 'L2') {
      const m = /^(\d{1,3})?\/?([LR])?$/.exec(scratch);
      if (!m || (!m[1] && !m[2])) return INVALID;
      if (m[1]) {
        const c = Number(m[1]);
        if (c < 1 || c > 360) return INVALID;
        st.holdCrs = c;
      }
      if (m[2]) st.holdDir = m[2];
      return { ok: true };
    }
    if (k === 'L3') {
      const t = Number(scratch);
      if (!(t >= 0.5 && t <= 5)) return INVALID;
      st.holdTime = t;
      return { ok: true };
    }
    if (k === 'R4') {
      if (!plan) return NO_FMS;
      const fix = (st.holdFix as string | undefined) ?? plan.activeLeg?.fix?.ident;
      const idx = plan.legs.findIndex((l, i) => i >= Math.max(0, plan.activeLegIndex) && l.fix?.ident === fix);
      if (idx < 0) return { error: 'NOT IN FLT PLAN' };
      let ok = false;
      edit(ctx, (p) => {
        ok = p.insertHold(idx, { inboundCourseMag: st.holdCrs as number | undefined, turnDirection: (st.holdDir as 'L' | 'R' | undefined) ?? 'R', legTimeMin: (st.holdTime as number | undefined) ?? 1 }) !== null;
      });
      return ok ? { keep: true } : INVALID;
    }
    if (k === 'R5' && ctx.vars.getBool(FMS.inHold)) {
      ctx.host.fms?.exitHold();
      return { keep: true };
    }
  },
};

// ================================================================ TUNE (CNS)

function radioLine(s: FmsScreen, k: number, right: boolean, label: string, act: string, stby: string): void {
  if (right) {
    s.labelR(k, label);
    s.dataR(k, act, 'green');
    s.put(2 * k, 24 - act.length - 1 - stby.length, stby, 'cyan', true);
  } else {
    s.labelL(k, label);
    s.dataL(k, act, 'green');
    s.put(2 * k, act.length + 1, stby, 'cyan', true);
  }
}

const TUNE: FmsPage = {
  title: 'TUNE',
  pages: () => 2,
  render(ctx, s, page) {
    const v = ctx.vars;
    const sn = ctx.host.cfg.sensors;
    s.title = 'CNS TUNE';
    if (page === 1) {
      for (let r = 1; r <= 3; r++) radioLine(s, r, false, `COM ${r}`, fmtFreq(v.get(NAV.comActive(r)), 3), fmtFreq(v.get(NAV.comStandby(r)), 3));
      for (let i = 0; i < 2; i++) {
        const rx = sn.nav[i];
        radioLine(s, 4 + i, false, `NAV ${i + 1}  ${v.getString(NAV.ident(rx))}`, fmtFreq(v.get(NAV.activeFreq(rx)), 2), fmtFreq(v.get(NAV.standbyFreq(rx)), 2));
      }
      for (let i = 0; i < 2; i++) {
        const rx = sn.adf[i];
        radioLine(s, 1 + i, true, `ADF ${i + 1}`, `${Math.round(v.get(NAV.adfActive(rx)))}`, `${Math.round(v.get(NAV.adfStandby(rx)))}`);
      }
      s.labelR(3, 'ATC CODE');
      s.dataR(3, fmtSquawk(v.get(NAV.xpdrCode)), 'green');
      s.labelR(4, 'ATC MODE');
      const m = Math.round(v.get(NAV.xpdrMode));
      s.dataR(4, ['OFF', 'STBY', 'ON', 'ALT', 'TA ONLY', 'TA/RA'][m] ?? 'STBY', 'green');
      s.labelR(5, 'DME HOLD');
      s.dataR(5, v.getBool(NAV.dmeHold(sn.nav[ctx.side - 1])) ? 'ON' : 'OFF', 'cyan');
      s.dataL(6, '<INDEX');
      s.dataR(6, 'HF>');
    } else {
      for (let i = 0; i < 2; i++) {
        s.labelL(i + 1, `HF ${i + 1}`);
        s.dataL(i + 1, (ctx.host.hf[i] / 1000).toFixed(4), 'green');
      }
      s.dataL(6, '<INDEX');
      s.dataR(6, 'VHF>');
    }
  },
  lsk(ctx, k, scratch, page) {
    const v = ctx.vars;
    const sn = ctx.host.cfg.sensors;
    if (k === 'L6') return { page: 'IDX', keep: true };
    if (k === 'R6') return { page: 'TUNE', index: page === 1 ? 2 : 1, keep: true };
    const swap = (a: string, b: string) => {
      const x = v.get(a);
      v.set(a, v.get(b));
      v.set(b, x);
    };
    if (page === 2) {
      if (k === 'L1' || k === 'L2') {
        const f = parseHfFreq(scratch);
        if (!Number.isFinite(f)) return INVALID;
        ctx.host.hf[k === 'L1' ? 0 : 1] = f;
        v.set(`fusion.hf${k === 'L1' ? 1 : 2}.khz`, f);
        return { ok: true };
      }
      return;
    }
    const n = lskNum(k);
    if (k[0] === 'L') {
      if (n <= 3) {
        if (!scratch) {
          swap(NAV.comActive(n), NAV.comStandby(n));
          return { keep: true };
        }
        const f = parseComFreq(scratch);
        if (!Number.isFinite(f)) return INVALID;
        v.set(NAV.comStandby(n), f);
        return { ok: true };
      }
      if (n <= 5) {
        const rx = sn.nav[n - 4];
        if (!scratch) {
          swap(NAV.activeFreq(rx), NAV.standbyFreq(rx));
          return { keep: true };
        }
        const f = parseNavFreq(scratch);
        if (!Number.isFinite(f)) return INVALID;
        v.set(NAV.standbyFreq(rx), f);
        return { ok: true };
      }
      return;
    }
    if (n <= 2) {
      const rx = sn.adf[n - 1];
      if (!scratch) {
        swap(NAV.adfActive(rx), NAV.adfStandby(rx));
        return { keep: true };
      }
      const f = parseAdfFreq(scratch);
      if (!Number.isFinite(f)) return INVALID;
      v.set(NAV.adfStandby(rx), f);
      return { ok: true };
    }
    if (n === 3) {
      const c = parseSquawk(scratch);
      if (!Number.isFinite(c)) return INVALID;
      v.set(NAV.xpdrCode, c);
      return { ok: true };
    }
    if (n === 4) {
      const modes = [1, 3, 4, 5];
      const i = modes.indexOf(Math.round(v.get(NAV.xpdrMode)));
      v.set(NAV.xpdrMode, modes[(i + 1) % modes.length]);
      return { keep: true };
    }
    if (n === 5) {
      const rx = sn.nav[ctx.side - 1];
      v.set(NAV.dmeHold(rx), v.getBool(NAV.dmeHold(rx)) ? 0 : 1);
      return { keep: true };
    }
  },
};

// ================================================================ MESSAGES

const MSG: FmsPage = {
  title: 'MESSAGES',
  pages: () => 1,
  render(ctx, s) {
    s.title = 'FMS MESSAGES';
    const m = ctx.host.messages;
    if (!m.length) s.dataC(3, 'NO MESSAGES', 'white');
    m.slice(-5).forEach((t, i) => s.dataL(i + 1, t, 'amber'));
    s.dataL(6, '<INDEX');
    s.dataR(6, 'CLEAR>');
  },
  lsk(ctx, k) {
    if (k === 'L6') return { page: 'IDX', keep: true };
    if (k === 'R6') {
      ctx.host.clearMessage();
      return { keep: true };
    }
  },
};

export const FMS_PAGES: Readonly<Record<FmsPageId, FmsPage>> = { IDX, POS, FPLN, LEGS, DEP, ARR, DIR, PERF, VNAV, PROG, TOLD, LDG, HOLD, TUNE, MSG, SEL };

/** Page ids in the order used by tests / documentation. */
export const FMS_PAGE_IDS = Object.keys(FMS_PAGES) as FmsPageId[];
