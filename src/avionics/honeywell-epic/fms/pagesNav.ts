/**
 * MCDU navigation pages: ACTIVE / MOD FLT PLAN, DEP/ARR (DEPARTURE,
 * ARRIVAL, transitions), DIRECT-TO, HOLD, ROUTE entry, NAV INDEX, NAV
 * IDENT, POSITION INIT, POS SENSORS.
 *
 * Page names from code450 "FMS Procedures" (NAV INDEX, NAV IDENT, POS INIT,
 * POS SENSORS, GPS STATUS, ACTIVE FLT PLAN, HOLDING PATTERN, PERF INIT...);
 * POS INIT loads: "Last FMS Position (1R), Reference Waypoint (2R), or GPS
 * Position (3R)"; holding: "DIR key, then PATTERN (LSK 6L) -> HOLD (LSK 1L)
 * -> select waypoint -> choose turn direction -> ACTIVATE (LSK 6R)".
 * MOD / ACTIVATE: a modified plan is shown as MOD FLT PLAN until ACTIVATE
 * (6R) or CANCEL MOD (6L) (Honeywell NG FMS convention, EST layout).
 * Line layout is EST (no public page drawings): legs show the magnetic
 * course and distance on the label line, the ident (active leg magenta) and
 * the speed / altitude constraint or prediction on the data line.
 */
import { GPS } from '../../../core/vars';
import type { Airport, Procedure } from '../../../nav/types';
import type { PlanLeg } from '../../../nav/flightplan/types';
import type { CduPage, Mcdu } from './mcdu';
import { fmtAlt, fmtLat, fmtLon, fmtTime, parseAltitude, parseSpeed, parseLatLon, type CduScreen, type LskId } from './cdu';

const lskIndex = (k: LskId): number => Number(k[1]);
const isLeft = (k: LskId): boolean => k[0] === 'L';

function wrap360(d: number): number {
  const r = d % 360;
  return r <= 0 ? r + 360 : r;
}

/** Legs listed on the FPL pages (every leg of the displayed plan). */
function legs(m: Mcdu): PlanLeg[] {
  return m.shared.plan?.legs ?? [];
}

function airportOf(m: Mcdu, ident: string): Airport | undefined {
  return m.shared.db?.airport(ident.trim().toUpperCase());
}

function resolveWaypoint(m: Mcdu, ident: string) {
  const db = m.shared.db;
  if (!db) return undefined;
  const v = m.vars;
  const lat = v.get(GPS.lat);
  const lon = v.get(GPS.lon);
  const ll = parseLatLon(ident);
  if (ll) return { ident: ident.slice(0, 7), lat: ll.lat, lon: ll.lon, kind: 'latlon' as const };
  return db.resolve(ident.trim().toUpperCase(), lat, lon)[0];
}

function constraintText(l: PlanLeg, transAlt: number): string {
  const sp = l.speed ? `${Math.round(l.speed.kt)}/` : '';
  const a = l.altitude;
  let at = '';
  if (a) {
    if (a.kind === 'at') at = fmtAlt(a.lowerFt ?? a.upperFt ?? NaN, transAlt);
    else if (a.kind === 'atOrAbove') at = `${fmtAlt(a.lowerFt ?? NaN, transAlt)}A`;
    else if (a.kind === 'atOrBelow') at = `${fmtAlt(a.upperFt ?? NaN, transAlt)}B`;
    else at = `${fmtAlt(a.lowerFt ?? NaN, transAlt)}A${fmtAlt(a.upperFt ?? NaN, transAlt)}B`;
  }
  return sp + at;
}

/** Parses '250/12000A', '/FL200', '12000B', '250/' into a speed and an altitude constraint. */
function parseConstraint(s: string): { speed?: number | null; alt?: { kind: 'at' | 'atOrAbove' | 'atOrBelow'; ft: number } | null } | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  const [sp, al] = t.includes('/') ? t.split('/') : ['', t];
  const out: { speed?: number | null; alt?: { kind: 'at' | 'atOrAbove' | 'atOrBelow'; ft: number } | null } = {};
  if (sp) {
    const p = parseSpeed(sp);
    if (!p || !Number.isFinite(p.kt)) return null;
    out.speed = p.kt;
  }
  if (al) {
    const suffix = al.endsWith('A') ? 'atOrAbove' : al.endsWith('B') ? 'atOrBelow' : 'at';
    const ft = parseAltitude(suffix === 'at' ? al : al.slice(0, -1));
    if (!Number.isFinite(ft)) return null;
    out.alt = { kind: suffix, ft };
  }
  return out;
}

// ---------------------------------------------------------------- ACTIVE / MOD FLT PLAN

const FPL_FIRST = 4; // legs on page 1 (L2-L5)
const FPL_PER = 5; // legs on the following pages (L1-L5)

function fplLegAt(sub: number, k: number): number {
  if (sub === 0) return k >= 2 && k <= 5 ? k - 2 : -1;
  return k <= 5 ? FPL_FIRST + (sub - 1) * FPL_PER + (k - 1) : -1;
}

export const FPL_PAGE: CduPage = {
  id: 'FPL',
  refreshS: 1,
  pages(m) {
    const n = legs(m).length;
    return 1 + Math.max(0, Math.ceil((n - FPL_FIRST) / FPL_PER));
  },
  render(m, s, sub) {
    const sh = m.shared;
    const p = sh.plan;
    s.title = sh.modPending ? 'MOD FLT PLAN' : 'ACTIVE FLT PLAN';
    s.titleColor = sh.modPending ? 'white' : 'white';
    if (!p) {
      s.dataC(3, 'NO FMS', 'amber');
      return;
    }
    const ta = sh.perf.transAltFt;
    if (sub === 0) {
      s.labelL(1, 'ORIGIN');
      s.labelR(1, 'DEST');
      s.dataL(1, p.origin ? p.origin.icao : '□□□□', p.origin ? 'green' : 'amber');
      s.dataR(1, p.destination ? p.destination.icao : '□□□□', p.destination ? 'green' : 'amber');
    }
    const L = p.legs;
    for (let k = 1; k <= 5; k++) {
      const i = fplLegAt(sub, k);
      if (i < 0 || i >= L.length) continue;
      const l = L[i];
      if (l.type === 'DISCO') {
        s.labelC(k, '- DISCONTINUITY -');
        s.dataL(k, '□□□□□', 'amber');
        continue;
      }
      const g = l.geom;
      if (g.valid && Number.isFinite(g.courseTrue) && g.lengthNm > 0.05) {
        const crs = Math.round(wrap360(g.courseTrue - (l.magVar ?? 0)));
        s.labelL(k, ` ${crs.toString().padStart(3, '0')}°  ${g.lengthNm < 99.95 ? g.lengthNm.toFixed(1) : Math.round(g.lengthNm).toString()}NM`);
      } else if (l.type.startsWith('V') || l.type.startsWith('C')) s.labelL(k, ` ${l.type} ${Number.isFinite(l.course ?? NaN) ? Math.round(l.course!).toString().padStart(3, '0') + '°' : ''}`);
      const active = i === p.activeLegIndex;
      const name = l.fix?.ident ?? (l.altitude ? `(${Math.round(l.altitude.lowerFt ?? l.altitude.upperFt ?? 0)})` : `(${l.type})`);
      s.dataL(k, name.slice(0, 8), active ? 'magenta' : 'green');
      const c = constraintText(l, ta);
      if (c) s.dataR(k, c, l.userConstraint ? 'cyan' : 'green');
      else if (Number.isFinite(g.predictedAltFt)) s.dataR(k, fmtAlt(g.predictedAltFt, ta), 'white', true);
    }
    if (sh.modPending) {
      s.dataL(6, '<CANCEL MOD', 'white');
      s.dataR(6, 'ACTIVATE>', 'white');
    } else {
      s.dataL(6, '<DEP/ARR', 'white');
      s.dataR(6, 'PERF INIT>', 'white');
    }
  },
  lsk(m, k, sub) {
    const sh = m.shared;
    const n = lskIndex(k);
    if (n === 6) {
      if (sh.modPending) {
        if (isLeft(k)) sh.cancelMod();
        else sh.activate();
      } else if (isLeft(k)) m.show('DEPARR');
      else m.show('PERF_INIT');
      return;
    }
    const p = sh.plan;
    if (!p) return;
    if (sub === 0 && n === 1) {
      const t = m.scratch.trim();
      if (!t) {
        m.setScratch(isLeft(k) ? (p.origin?.icao ?? '') : (p.destination?.icao ?? ''));
        return;
      }
      const ap = airportOf(m, t);
      if (!ap) return m.error('NOT IN DATABASE');
      m.take();
      sh.edit((q) => (isLeft(k) ? q.setOrigin(ap) : q.setDestination(ap)));
      return;
    }
    const i = fplLegAt(sub, n);
    if (i < 0) return;
    const t = m.scratch.trim();
    if (isLeft(k)) {
      if (!t) {
        const l = p.legs[i];
        if (l?.fix) m.setScratch(l.fix.ident);
        return;
      }
      if (t === 'DELETE') {
        if (i >= p.legs.length) return;
        m.take();
        sh.edit((q) => q.deleteLeg(i));
        return;
      }
      const w = resolveWaypoint(m, t);
      if (!w) return m.error('NOT IN DATABASE');
      m.take();
      sh.edit((q) => q.insertWaypoint(Math.min(i, q.legs.length), w));
      return;
    }
    // Right side: speed / altitude constraint.
    if (i >= p.legs.length || !t) return;
    if (t === 'DELETE') {
      m.take();
      sh.edit((q) => {
        q.setAltitudeConstraint(i, null);
        q.setSpeedConstraint(i, null);
      });
      return;
    }
    const c = parseConstraint(t);
    if (!c) return m.error();
    m.take();
    sh.edit((q) => {
      if (c.alt) q.setAltitudeConstraint(i, c.alt.kind === 'at' ? { kind: 'at', lowerFt: c.alt.ft, upperFt: c.alt.ft } : c.alt.kind === 'atOrAbove' ? { kind: 'atOrAbove', lowerFt: c.alt.ft } : { kind: 'atOrBelow', upperFt: c.alt.ft });
      if (c.speed) q.setSpeedConstraint(i, { kind: 'atOrBelow', kt: c.speed });
    });
  },
};

// ---------------------------------------------------------------- DEP / ARR

export const DEPARR_PAGE: CduPage = {
  id: 'DEPARR',
  render(m, s) {
    const p = m.shared.plan;
    s.title = 'DEP/ARR INDEX';
    s.labelL(1, 'DEPART');
    s.labelR(1, 'ARRIVE');
    s.dataL(1, `<${p?.origin?.icao ?? '----'}`, 'white');
    s.dataR(1, `${p?.destination?.icao ?? '----'}>`, 'white');
    if (p?.departureRunway) s.dataL(2, `RWY ${p.departureRunway}`, 'green', true);
    if (p?.sid) s.dataL(3, `${p.sid.ident}${p.sid.enrouteTransition ? '.' + p.sid.enrouteTransition : ''}`, 'green', true);
    if (p?.star) s.dataR(2, `${p.star.enrouteTransition ? p.star.enrouteTransition + '.' : ''}${p.star.ident}`, 'green', true);
    if (p?.approach) s.dataR(3, p.approachProcedure ? shortProc(p.approachProcedure) : p.approach.ident, 'green', true);
    s.dataL(6, '<FLT PLAN', 'white');
  },
  lsk(m, k) {
    if (k === 'L1') m.show('DEPART');
    else if (k === 'R1') m.show('ARRIVE');
    else if (k === 'L6') m.show('FPL');
  },
};

/** Compact procedure name for 11-character columns. */
export function shortProc(p: Procedure): string {
  if (p.type !== 'APPROACH') return p.ident;
  const t = p.approachType ?? '';
  const kind = t === 'RNAV' || t === 'RNP' || t === 'GPS' || t === 'FMS' ? 'RNAV' : t === 'LOC_BC' ? 'BC' : t;
  const rw = p.runways[0] ?? '';
  return `${kind}${p.suffix ? ' ' + p.suffix : ''} ${rw}`.trim().slice(0, 11);
}

interface ProcState {
  mode: 'list' | 'sidtrans' | 'apptrans' | 'startrans';
  proc: Procedure | null;
}
const procState = new WeakMap<Mcdu, ProcState>();
function pstate(m: Mcdu): ProcState {
  let s = procState.get(m);
  if (!s) procState.set(m, (s = { mode: 'list', proc: null }));
  return s;
}

/** Paged two-column list helper: rows 1..5 per page. */
function colPages(a: number, b: number): number {
  return Math.max(1, Math.ceil(Math.max(a, b) / 5));
}

export const DEPART_PAGE: CduPage = {
  id: 'DEPART',
  refreshS: 0.5,
  pages(m) {
    const st = pstate(m);
    const p = m.shared.plan;
    const ap = p?.origin;
    if (!ap) return 1;
    const pr = m.shared.procedures(ap.icao);
    if (st.mode === 'sidtrans' && st.proc) return colPages(st.proc.transitions.length + 1, 0);
    return colPages(ap.runways.length, pr?.sids.length ?? 0);
  },
  render(m, s, sub) {
    const st = pstate(m);
    const p = m.shared.plan;
    const ap = p?.origin;
    s.title = `DEPARTURE${ap ? ' - ' + ap.icao : ''}`;
    if (!ap) {
      s.dataC(3, 'NO ORIGIN', 'amber');
      s.dataL(6, '<DEP/ARR', 'white');
      return;
    }
    const pr = m.shared.procedures(ap.icao);
    if (st.mode === 'sidtrans' && st.proc) {
      s.labelL(1, `${st.proc.ident} TRANS`);
      const list = ['NONE', ...st.proc.transitions.map((t) => t.name)];
      for (let r = 0; r < 5; r++) {
        const t = list[sub * 5 + r];
        if (t) s.dataL(r + 1, `<${t}`, 'cyan');
      }
      s.dataL(6, '<DEP/ARR', 'white');
      return;
    }
    s.labelL(1, 'RUNWAYS');
    s.labelR(1, pr ? 'SIDS' : m.shared.procs.get(ap.icao) === 'loading' ? 'LOADING' : 'SIDS');
    for (let r = 0; r < 5; r++) {
      const rw = ap.runways[sub * 5 + r];
      if (rw) s.dataL(r + 1, `<${rw.ident}`, rw.ident === p?.departureRunway ? 'green' : 'cyan');
      const sid = pr?.sids[sub * 5 + r];
      if (sid) s.dataR(r + 1, `${sid.ident}>`, sid.ident === p?.sid?.ident ? 'green' : 'cyan');
    }
    s.dataL(6, '<DEP/ARR', 'white');
    if (m.shared.modPending) s.dataR(6, 'ACTIVATE>', 'white');
  },
  lsk(m, k, sub) {
    const st = pstate(m);
    const sh = m.shared;
    const ap = sh.plan?.origin;
    if (k === 'L6') {
      st.mode = 'list';
      m.show('DEPARR');
      return;
    }
    if (k === 'R6') {
      if (sh.modPending) sh.activate();
      return;
    }
    if (!ap) return;
    const n = lskIndex(k) - 1 + sub * 5;
    if (st.mode === 'sidtrans' && st.proc) {
      if (!isLeft(k)) return;
      const proc = st.proc;
      const name = n === 0 ? undefined : proc.transitions[n - 1]?.name;
      if (n > proc.transitions.length) return;
      sh.edit((q) => q.setSid(proc, undefined, name));
      st.mode = 'list';
      m.show('FPL');
      return;
    }
    if (isLeft(k)) {
      const rw = ap.runways[n];
      if (rw) sh.edit((q) => q.setDepartureRunway(rw.ident));
      return;
    }
    const pr = sh.procedures(ap.icao);
    const sid = pr?.sids[n];
    if (!sid) return;
    sh.edit((q) => q.setSid(sid));
    if (sid.transitions.length) {
      st.mode = 'sidtrans';
      st.proc = sid;
      m.show('DEPART', 0);
    }
  },
};

export const ARRIVE_PAGE: CduPage = {
  id: 'ARRIVE',
  refreshS: 0.5,
  pages(m) {
    const st = pstate(m);
    const ap = m.shared.plan?.destination;
    if (!ap) return 1;
    const pr = m.shared.procedures(ap.icao);
    if ((st.mode === 'apptrans' || st.mode === 'startrans') && st.proc) return colPages(st.proc.transitions.length + 1, 0);
    return colPages(pr?.approaches.length ?? 0, pr?.stars.length ?? 0);
  },
  render(m, s, sub) {
    const st = pstate(m);
    const p = m.shared.plan;
    const ap = p?.destination;
    s.title = `ARRIVAL${ap ? ' - ' + ap.icao : ''}`;
    if (!ap) {
      s.dataC(3, 'NO DESTINATION', 'amber');
      s.dataL(6, '<DEP/ARR', 'white');
      return;
    }
    const pr = m.shared.procedures(ap.icao);
    if ((st.mode === 'apptrans' || st.mode === 'startrans') && st.proc) {
      s.labelL(1, `${shortProc(st.proc)} TRANS`);
      const list = [st.mode === 'apptrans' ? 'VECTORS' : 'NONE', ...st.proc.transitions.map((t) => t.name)];
      for (let r = 0; r < 5; r++) {
        const t = list[sub * 5 + r];
        if (t) s.dataL(r + 1, `<${t}`, 'cyan');
      }
      s.dataL(6, '<DEP/ARR', 'white');
      return;
    }
    s.labelL(1, 'APPROACHES');
    s.labelR(1, !pr && m.shared.procs.get(ap.icao) === 'loading' ? 'LOADING' : 'STARS');
    for (let r = 0; r < 5; r++) {
      const a = pr?.approaches[sub * 5 + r];
      if (a) s.dataL(r + 1, `<${shortProc(a)}`, a.ident === p?.approach?.ident ? 'green' : 'cyan');
      const st2 = pr?.stars[sub * 5 + r];
      if (st2) s.dataR(r + 1, `${st2.ident}>`, st2.ident === p?.star?.ident ? 'green' : 'cyan');
    }
    s.dataL(6, '<DEP/ARR', 'white');
    if (m.shared.modPending) s.dataR(6, 'ACTIVATE>', 'white');
  },
  lsk(m, k, sub) {
    const st = pstate(m);
    const sh = m.shared;
    const ap = sh.plan?.destination;
    if (k === 'L6') {
      st.mode = 'list';
      m.show('DEPARR');
      return;
    }
    if (k === 'R6') {
      if (sh.modPending) sh.activate();
      return;
    }
    if (!ap) return;
    const n = lskIndex(k) - 1 + sub * 5;
    if ((st.mode === 'apptrans' || st.mode === 'startrans') && st.proc) {
      if (!isLeft(k)) return;
      const proc = st.proc;
      if (n > proc.transitions.length) return;
      const name = n === 0 ? undefined : proc.transitions[n - 1]?.name;
      if (st.mode === 'apptrans') sh.edit((q) => q.setApproach(proc, name));
      else sh.edit((q) => q.setStar(proc, name));
      st.mode = 'list';
      m.show('FPL');
      return;
    }
    const pr = sh.procedures(ap.icao);
    if (isLeft(k)) {
      const a = pr?.approaches[n];
      if (!a) return;
      sh.edit((q) => q.setApproach(a));
      if (a.transitions.length) {
        st.mode = 'apptrans';
        st.proc = a;
        m.show('ARRIVE', 0);
      }
      return;
    }
    const star = pr?.stars[n];
    if (!star) return;
    sh.edit((q) => q.setStar(star));
    if (star.transitions.length) {
      st.mode = 'startrans';
      st.proc = star;
      m.show('ARRIVE', 0);
    }
  },
};

// ---------------------------------------------------------------- DIRECT-TO

export const DIRECT_PAGE: CduPage = {
  id: 'DIR',
  refreshS: 1,
  render(m, s) {
    const p = m.shared.plan;
    s.title = 'DIRECT-TO';
    s.labelL(1, 'DIRECT');
    s.dataL(1, m.scratch ? '<ENTER WPT' : '□□□□□', m.scratch ? 'white' : 'amber');
    if (p) {
      let r = 2;
      const start = Math.max(0, p.activeLegIndex);
      for (let i = start; i < p.legs.length && r <= 5; i++) {
        const l = p.legs[i];
        if (!l.fix || l.type === 'DISCO' || l.segment === 'missed') continue;
        s.dataL(r, `<${l.fix.ident}`, i === p.activeLegIndex ? 'magenta' : 'green');
        r++;
      }
      let rr = 1;
      for (let i = start; i < p.legs.length && rr <= 5; i++) {
        if (i < start + 4) continue;
        const l = p.legs[i];
        if (!l.fix || l.type === 'DISCO' || l.segment === 'missed') continue;
        s.dataR(rr, `${l.fix.ident}>`, 'green');
        rr++;
      }
    }
    s.dataL(6, '<PATTERN', 'white');
    if (m.shared.modPending) s.dataR(6, 'ACTIVATE>', 'white');
  },
  lsk(m, k) {
    const sh = m.shared;
    const fms = sh.fms;
    if (k === 'L6') {
      m.show('HOLD');
      return;
    }
    if (k === 'R6') {
      if (sh.modPending) {
        sh.activate();
        m.show('FPL');
      }
      return;
    }
    if (!fms) return;
    if (k === 'L1') {
      const t = m.scratch.trim();
      if (!t) return;
      if (!fms.directTo(t)) return m.error('NOT IN DATABASE');
      m.take();
      sh.version++;
      m.show('FPL');
      return;
    }
    // Pick the n-th listed waypoint.
    const p = sh.plan;
    if (!p) return;
    const want = isLeft(k) ? lskIndex(k) - 2 : 4 + lskIndex(k) - 1;
    let n = 0;
    const start = Math.max(0, p.activeLegIndex);
    for (let i = start; i < p.legs.length; i++) {
      const l = p.legs[i];
      if (!l.fix || l.type === 'DISCO' || l.segment === 'missed') continue;
      if (n === want) {
        if (fms.directTo(i)) {
          sh.version++;
          m.show('FPL');
        }
        return;
      }
      n++;
    }
  },
};

// ---------------------------------------------------------------- HOLD

export const HOLD_PAGE: CduPage = {
  id: 'HOLD',
  refreshS: 0,
  render(m, s) {
    const h = m.shared.hold;
    const p = m.shared.plan;
    s.title = 'HOLDING PATTERN';
    const def = h.ident || p?.activeLeg?.fix?.ident || '';
    s.labelL(1, 'HOLD AT');
    s.dataL(1, def || '□□□□□', def ? 'cyan' : 'amber');
    s.labelL(2, 'INBD CRS');
    s.dataL(2, Number.isFinite(h.courseMag) ? `${Math.round(h.courseMag).toString().padStart(3, '0')}°` : 'AUTO', 'cyan');
    s.labelL(3, 'TURN DIR');
    s.dataL(3, h.turn === 'L' ? 'L' : 'R', 'cyan');
    s.labelL(4, 'LEG TIME');
    s.dataL(4, `${h.legMin.toFixed(1)} MIN`, 'cyan');
    if (m.shared.fms?.lnav && m.vars.get('fms.in_hold') !== 0) s.dataR(1, 'EXIT HOLD>', 'white');
    s.dataL(6, '<DIRECT-TO', 'white');
    s.dataR(6, 'ACTIVATE>', 'white');
  },
  lsk(m, k) {
    const sh = m.shared;
    const h = sh.hold;
    const t = m.scratch.trim();
    switch (k) {
      case 'L1':
        if (t) {
          h.ident = m.take().toUpperCase();
          m.invalidate();
        }
        return;
      case 'L2': {
        if (t === 'DELETE') {
          m.take();
          h.courseMag = NaN;
          return;
        }
        const c = Number(t);
        if (!(c >= 0 && c <= 360)) return m.error();
        m.take();
        h.courseMag = c;
        return;
      }
      case 'L3':
        h.turn = h.turn === 'L' ? 'R' : 'L';
        m.invalidate();
        return;
      case 'L4': {
        const x = Number(t);
        if (!(x >= 0.5 && x <= 5)) return m.error();
        m.take();
        h.legMin = x;
        return;
      }
      case 'R1':
        if (m.vars.get('fms.in_hold') !== 0) sh.events.emit('fms.exit_hold');
        return;
      case 'L6':
        m.show('DIR');
        return;
      case 'R6': {
        const p = sh.plan;
        const ident = h.ident || p?.activeLeg?.fix?.ident || '';
        if (!p || !ident) return m.error('NO HOLD FIX');
        const from = Math.max(0, p.activeLegIndex);
        let idx = p.legs.findIndex((l, i) => i >= from && l.fix?.ident === ident);
        if (idx < 0) idx = p.legs.findIndex((l) => l.fix?.ident === ident);
        if (idx < 0) return m.error('NOT IN FLT PLAN');
        const ok = sh.edit((q) => q.insertHold(idx, { inboundCourseMag: Number.isFinite(h.courseMag) ? h.courseMag : undefined, turnDirection: h.turn, legTimeMin: h.legMin }));
        if (ok) {
          if (sh.modPending) sh.activate();
          h.ident = '';
          m.show('FPL');
        }
        return;
      }
    }
  },
};

// ---------------------------------------------------------------- ROUTE entry

export const ROUTE_PAGE: CduPage = {
  id: 'ROUTE',
  refreshS: 0,
  render(m, s) {
    s.title = 'ROUTE ENTRY';
    const r = m.shared.lastRoute;
    s.labelL(1, 'ADD TO ROUTE');
    s.dataL(1, '<SCRATCHPAD', 'white');
    for (let i = 0; i < 4; i++) {
      const line = r.slice(i * 24, i * 24 + 24);
      if (line) s.dataL(2 + i, line, 'cyan', true);
    }
    s.dataL(6, '<CLEAR', 'white');
    s.dataR(6, 'LOAD ROUTE>', 'white');
  },
  lsk(m, k) {
    const sh = m.shared;
    if (k === 'L1') {
      const t = m.take().trim().toUpperCase();
      if (t) sh.lastRoute = sh.lastRoute ? `${sh.lastRoute} ${t}` : t;
      m.invalidate();
    } else if (k === 'L6') {
      sh.lastRoute = '';
      m.invalidate();
    } else if (k === 'R6') {
      const fms = sh.fms;
      if (!fms || !sh.lastRoute) return m.error();
      fms
        .loadRoute(sh.lastRoute)
        .then((r) => {
          sh.post(r.errors.length ? 'ROUTE ERRORS' : 'ROUTE LOADED');
          sh.version++;
        })
        .catch(() => sh.post('ROUTE ERRORS'));
      m.show('FPL');
    }
  },
};

// ---------------------------------------------------------------- NAV INDEX / IDENT / POS

export const NAV_INDEX_PAGE: CduPage = {
  id: 'NAV_INDEX',
  refreshS: 0,
  render(_m, s) {
    s.title = 'NAV INDEX';
    s.dataL(1, '<NAV IDENT', 'white');
    s.dataL(2, '<POS INIT', 'white');
    s.dataL(3, '<POS SENSORS', 'white');
    s.dataL(4, '<ROUTE', 'white');
    s.dataL(5, '<DEP/ARR', 'white');
    s.dataL(6, '<PATTERN', 'white');
    s.dataR(1, 'FLT PLAN>', 'white');
    s.dataR(2, 'DIRECT-TO>', 'white');
    s.dataR(3, 'PERF>', 'white');
    s.dataR(4, 'PROGRESS>', 'white');
  },
  lsk(m, k) {
    const map: Partial<Record<LskId, string>> = { L1: 'NAV_IDENT', L2: 'POS_INIT', L3: 'POS_SENSORS', L4: 'ROUTE', L5: 'DEPARR', L6: 'HOLD', R1: 'FPL', R2: 'DIR', R3: 'PERF_INDEX', R4: 'PROG' };
    const id = map[k];
    if (id) m.show(id);
  },
};

export const NAV_IDENT_PAGE: CduPage = {
  id: 'NAV_IDENT',
  refreshS: 1,
  render(m, s) {
    const v = m.vars;
    s.title = 'NAV IDENT';
    const utc = v.get(GPS.utcH, v.get('env.time_utc_h'));
    s.labelL(1, 'UTC');
    s.dataL(1, fmtTime(utc), 'green');
    const db = m.shared.db as unknown as { meta?: { cycles?: Record<string, string> } } | null;
    const cyc = db?.meta?.cycles ? Object.values(db.meta.cycles)[0] ?? '' : '';
    s.labelL(2, 'ACTIVE NDB');
    s.dataL(2, `WORLD ${cyc}`.trim(), 'green');
    s.labelR(1, 'ACFT');
    s.dataR(1, m.shared.perf.acftType, 'green');
    s.labelL(3, 'SW');
    s.dataL(3, 'NG FMS EPIC', 'green');
    s.dataR(6, 'POS INIT>', 'white');
    s.dataL(6, '<NAV INDEX', 'white');
  },
  lsk(m, k) {
    if (k === 'R6') m.show('POS_INIT');
    else if (k === 'L6') m.show('NAV_INDEX');
  },
};

export const POS_INIT_PAGE: CduPage = {
  id: 'POS_INIT',
  refreshS: 1,
  render(m, s) {
    const v = m.vars;
    s.title = 'POSITION INIT';
    const lastLat = v.get('epic.fms.last_lat', NaN);
    const lastLon = v.get('epic.fms.last_lon', NaN);
    s.labelL(1, 'LAST POS');
    s.dataL(1, Number.isFinite(lastLat) ? `${fmtLat(lastLat)} ${fmtLon(lastLon)}` : '---.-- ----.--', 'green', true);
    s.dataR(1, 'LOAD>', 'white');
    const ref = m.shared.plan?.origin;
    s.labelL(2, `REF WPT ${ref?.icao ?? ''}`.trim());
    s.dataL(2, ref ? `${fmtLat(ref.lat)} ${fmtLon(ref.lon)}` : '□□□□□', ref ? 'green' : 'amber', !!ref);
    s.dataR(2, 'LOAD>', 'white');
    const gpsOk = v.get(GPS.valid) !== 0;
    s.labelL(3, 'GPS POS');
    s.dataL(3, gpsOk ? `${fmtLat(v.get(GPS.lat))} ${fmtLon(v.get(GPS.lon))}` : '---.-- ----.--', 'green', true);
    s.dataR(3, 'LOAD>', 'white');
    if (v.get('epic.fms.pos_init') !== 0) s.dataC(4, 'POS INIT COMPLETE', 'green', true);
    s.dataL(6, '<NAV INDEX', 'white');
    s.dataR(6, 'FLT PLAN>', 'white');
  },
  lsk(m, k) {
    const v = m.vars;
    const load = (lat: number, lon: number): void => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return m.error('POSITION INVALID');
      v.set('epic.fms.pos_lat', lat);
      v.set('epic.fms.pos_lon', lon);
      v.set('epic.fms.pos_init', 1);
      m.shared.events.emit(m.shared.cfg.events.irsPosEntry, { lat, lon });
      m.invalidate();
    };
    if (k === 'R1') load(v.get('epic.fms.last_lat', NaN), v.get('epic.fms.last_lon', NaN));
    else if (k === 'R2') {
      const ref = m.shared.plan?.origin;
      if (ref) load(ref.lat, ref.lon);
      else m.error('NO REF WPT');
    } else if (k === 'R3') {
      if (v.get(GPS.valid) === 0) return m.error('GPS INVALID');
      load(v.get(GPS.lat), v.get(GPS.lon));
    } else if (k === 'L2') {
      const t = m.scratch.trim();
      const ap = t ? airportOf(m, t) : undefined;
      if (t && !ap) return m.error('NOT IN DATABASE');
      if (ap) {
        m.take();
        m.shared.edit((q) => q.setOrigin(ap));
      }
    } else if (k === 'L6') m.show('NAV_INDEX');
    else if (k === 'R6') m.show('FPL');
  },
};

const IRS_STATES = ['OFF', 'ALIGN', 'NAV', 'ATT', 'FAULT'];

export const POS_SENSORS_PAGE: CduPage = {
  id: 'POS_SENSORS',
  refreshS: 1,
  render(m, s) {
    const v = m.vars;
    s.title = 'POS SENSORS';
    const gpsOk = v.get(GPS.valid) !== 0;
    s.labelL(1, 'GPS');
    s.dataL(1, gpsOk ? `NAV  EPU ${v.get(GPS.epuNm).toFixed(2)}` : v.get(GPS.powered) !== 0 ? `ACQ  ${Math.round(v.get(GPS.acquireS))}S` : 'OFF', gpsOk ? 'green' : 'amber', true);
    s.dataR(1, gpsOk ? (v.get(GPS.sbas) !== 0 ? 'SBAS' : '') : '', 'green', true);
    for (let n = 1; n <= 3; n++) {
      const st = v.get(`irs${n}.state`, -1);
      if (st < 0) continue;
      const name = IRS_STATES[st] ?? '---';
      s.labelL(n + 1, `IRS ${n}`);
      const t = st === 1 ? `${name} ${Math.ceil(v.get(`ahrs${n}.align_s`) / 60)}MIN` : name;
      s.dataL(n + 1, t, st === 2 ? 'green' : st === 4 ? 'amber' : 'white', true);
      if (st === 2) s.dataR(n + 1, `${v.get(`irs${n}.pos_err_nm`).toFixed(1)}NM`, 'green', true);
    }
    s.dataL(6, '<NAV INDEX', 'white');
  },
  lsk(m, k) {
    if (k === 'L6') m.show('NAV_INDEX');
  },
};

export const NAV_PAGES: readonly CduPage[] = [FPL_PAGE, DEPARR_PAGE, DEPART_PAGE, ARRIVE_PAGE, DIRECT_PAGE, HOLD_PAGE, ROUTE_PAGE, NAV_INDEX_PAGE, NAV_IDENT_PAGE, POS_INIT_PAGE, POS_SENSORS_PAGE];

// Re-exported for the Symmetry FMS app.
export type { CduScreen };
