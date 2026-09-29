/**
 * LEGS, RTE DATA and HOLD pages.
 *
 * LEGS (FCOM 11.42): five legs per page from the active waypoint (magenta
 * on the ACT page). Label line: course (deg magnetic) and leg distance;
 * data line: waypoint and speed / altitude (constraints large, VNAV
 * predictions small). Entries:
 *   1L on page 1 of the active route    direct-to (MOD; INTC CRS at 6R)
 *   ident / lat-lon / place-bearing-distance on a left LSK
 *                                       inserts the waypoint (Boeing: legs up to an existing
 *                                       downstream copy are removed, else a discontinuity follows)
 *   empty scratchpad + left LSK         copies the waypoint (to close a discontinuity)
 *   DELETE + left LSK                   deletes the leg (not the active waypoint in flight)
 *   speed/altitude on a right LSK       "250/10000", "/FL240", "8000A", "12000B"; DELETE removes
 *   "HOLD AT XXXXX" (from the HOLD page) inserts a hold at XXXXX on that line
 * 6R: RTE DATA>, or STEP> while an ND is in PLN mode (moves the PLN centre
 * waypoint, shown with <CTR>), or INTC CRS after a direct-to.
 *
 * HOLD (FCOM 11.43): HOLD key with no hold in the route shows the LEGS
 * page with HOLD AT boxes (6L, a route fix) and PPOS> (6R); otherwise the
 * RTE HOLD page of each hold (NEXT HOLD adds another): QUAD/RADIAL, INBD
 * CRS/DIR, LEG TIME / LEG DIST, SPD/TGT ALT, FIX ETA, EFC TIME, HOLD
 * AVAIL, BEST SPEED (flaps-up maneuver speed, the FCOM holding speed),
 * EXIT HOLD> (EXEC arms the exit: "EXIT ARMED").
 */
import { GPS } from '../../../../core/vars';
import { destinationPoint } from '../../../../core/geo';
import type { FlightPlan } from '../../../../nav/flightplan/FlightPlan';
import { isHoldLeg, type PlanLeg } from '../../../../nav/flightplan/types';
import type { AltitudeConstraint, Waypoint } from '../../../../nav/types';
import type { Cdu } from '../Cdu';
import { CduColor, type CduScreen } from '../screen';
import { fmtAlt, parseCourse, parseLatLon, parseSpeedAlt } from '../entry';
import { flapManeuverSpeed } from '../../data/b738';
import { crossoverAltFt } from '../../data/perf';
import { INVALID_DELETE, INVALID_ENTRY, NOT_IN_DATABASE, boxes, fmtEta, type CduPage, type Lsk } from './common';
import { legIdent, resolveWaypoint } from './route';

const MAG = CduColor.Magenta;
/** EST average climb gradient for predicted climb altitudes (ft per nm). */
const CLIMB_FT_PER_NM = 320;

// ================================================================== helpers

/** First plan index shown on LEGS (the active waypoint; the origin leg is not listed). */
function legsStart(c: Cdu, p: FlightPlan): number {
  let i = Math.max(0, p.activeLegIndex);
  const f = c.fmc;
  if (p !== f.fms.plans.active || !f.hasActiveRoute) i = Math.max(0, p.activeLegIndex);
  while (i < p.legs.length && p.legs[i].segment === 'origin') i++;
  return i;
}

function legsIndices(c: Cdu): number[] {
  const p = c.fmc.plan;
  const out: number[] = [];
  for (let i = legsStart(c, p); i < p.legs.length; i++) {
    // One discontinuity line for consecutive discontinuities.
    if (p.legs[i].type === 'DISCO' && out.length > 0 && p.legs[out[out.length - 1]].type === 'DISCO') continue;
    out.push(i);
  }
  return out;
}

/** Magnetic course of a leg's path (deg), NaN when none. */
function legCourseMag(l: PlanLeg): number {
  const g = l.geom;
  if (!g.valid || g.kind === 'none') return NaN;
  const t = g.kind === 'heading' && l.course !== undefined ? (l.courseIsTrue ? l.course - l.magVar : l.course) : g.courseTrue - l.magVar;
  return ((t % 360) + 360) % 360;
}

function fmtConstraint(a: AltitudeConstraint, trans: number): string {
  const lo = a.lowerFt;
  const up = a.upperFt;
  switch (a.kind) {
    case 'at':
      return fmtAlt(lo ?? up ?? NaN, trans);
    case 'atOrAbove':
      return `${fmtAlt(lo ?? NaN, trans)}A`;
    case 'atOrBelow':
      return `${fmtAlt(up ?? NaN, trans)}B`;
    default:
      return `${fmtAlt(lo ?? NaN, trans)}A${fmtAlt(up ?? NaN, trans)}B`;
  }
}

function transFor(c: Cdu, l: PlanLeg): number {
  return l.segment === 'arrival' || l.segment === 'approach' || l.segment === 'destination' || l.segment === 'missed' ? c.fmc.transLvlFt : c.fmc.transAltFt;
}

/** Predicted altitude at a leg end (VNAV descent profile, else a climb estimate capped at the cruise altitude). */
function predictedAlt(c: Cdu, p: FlightPlan, l: PlanLeg): number {
  const f = c.fmc;
  if (Number.isFinite(l.geom.predictedAltFt)) return l.geom.predictedAltFt;
  const crz = f.pd.crzAltFt;
  if (!Number.isFinite(crz)) return NaN;
  if (l.segment === 'arrival' || l.segment === 'approach' || l.segment === 'destination' || l.segment === 'missed') return NaN;
  const along = p === f.fms.plans.active ? f.fms.alongNm : 0;
  const start = f.ground ? (Number.isFinite(f.originElevFt) ? f.originElevFt : f.altFt) : f.altFt;
  return Math.min(crz, start + Math.max(0, l.geom.cumDistNm - along) * CLIMB_FT_PER_NM);
}

/** Predicted speed at a leg end: climb / cruise / descent schedule, 250 kt below 10,000 ft, Mach above the crossover. */
function predictedSpeed(c: Cdu, l: PlanLeg, alt: number): string {
  const f = c.fmc;
  if (!Number.isFinite(alt)) return '---';
  const desc = Number.isFinite(l.geom.predictedAltFt) || l.segment === 'arrival' || l.segment === 'approach';
  const crz = f.pd.crzAltFt;
  const cruise = !desc && Number.isFinite(crz) && alt >= crz - 50;
  const kt = desc ? f.descentKt : cruise ? f.cruiseKt : f.climbKt;
  const m = desc ? f.descentMach : cruise ? f.cruiseMach : f.climbMach;
  if (alt >= crossoverAltFt(kt, m)) return `.${Math.round(m * 1000)}`;
  return String(alt < 10000 ? Math.min(250, kt) : kt);
}

/** Writes the speed/altitude column of a legs line (constraints large, predictions small). */
function drawSpdAlt(c: Cdu, s: CduScreen, row: number, p: FlightPlan, l: PlanLeg, color: CduColor): void {
  const trans = transFor(c, l);
  const pa = predictedAlt(c, p, l);
  const altTxt = l.altitude ? fmtConstraint(l.altitude, trans) : Number.isFinite(pa) ? fmtAlt(Math.round(pa / 10) * 10, trans) : '-----';
  const spdTxt = l.speed ? String(Math.round(l.speed.kt)) : predictedSpeed(c, l, Number.isFinite(pa) ? pa : l.altitude?.lowerFt ?? l.altitude?.upperFt ?? NaN);
  const altCol = 24 - altTxt.length;
  s.put(row, altCol, altTxt, { small: !l.altitude, color });
  s.put(row, altCol - 1, '/', { small: false, color });
  s.put(row, altCol - 1 - spdTxt.length, spdTxt, { small: !l.speed, color });
}

/** Constraint text as typed ("250/10000A"). */
function constraintEntry(c: Cdu, l: PlanLeg): string {
  const sp = l.speed ? String(Math.round(l.speed.kt)) : '';
  const al = l.altitude ? fmtConstraint(l.altitude, transFor(c, l)) : '';
  return `${sp}/${al}`;
}

/** Parses a waypoint entry: ident, lat/lon, or place-bearing/distance ("JFK090/12"). */
function parseWaypointEntry(c: Cdu, t: string, near?: { lat: number; lon: number }): Waypoint | undefined {
  const ll = parseLatLon(t);
  if (ll) {
    const la = Math.abs(ll.lat);
    const lo = Math.abs(ll.lon);
    return { ident: `${ll.lat >= 0 ? 'N' : 'S'}${Math.floor(la)}${ll.lon >= 0 ? 'E' : 'W'}${Math.floor(lo)}`.slice(0, 7), lat: ll.lat, lon: ll.lon, kind: 'latlon' };
  }
  const pbd = /^([A-Z0-9]{2,5})(\d{3})\/(\d{1,3}(\.\d)?)$/.exec(t);
  if (pbd) {
    const base = resolveWaypoint(c, pbd[1], near?.lat, near?.lon);
    if (!base) return undefined;
    const mv = base.navaid?.magVar ?? c.fmc.vars.get(GPS.magVar);
    const pt = destinationPoint(base.lat, base.lon, Number(pbd[2]) + mv, Number(pbd[3]));
    const n = ((c.state.get('pbdSeq') as number | undefined) ?? 0) + 1;
    c.state.set('pbdSeq', n);
    return { ident: `${pbd[1].slice(0, 3)}${String(n).padStart(2, '0')}`, lat: pt.lat, lon: pt.lon, kind: 'user' };
  }
  if (!/^[A-Z0-9]{1,5}$/.test(t)) return undefined;
  // A waypoint already in the route is preferred (same fix object).
  const p = c.fmc.plan;
  const inPlan = p.legs.find((l) => l.fix?.ident === t && l.type !== 'DISCO');
  if (inPlan?.fix) return inPlan.fix;
  return resolveWaypoint(c, t, near?.lat, near?.lon);
}

function refNear(p: FlightPlan, idx: number): { lat: number; lon: number } | undefined {
  for (let k = idx; k >= 0; k--) {
    const f = p.legs[k]?.fix;
    if (f) return { lat: f.lat, lon: f.lon };
  }
  return undefined;
}

/** Inserts a hold at the leg with id `legId` of the edit plan. Returns the plan index of the hold. */
function insertHoldAt(c: Cdu, legId: number): void {
  const f = c.fmc;
  f.editPlan((p) => {
    const i = p.indexOfLegId(legId);
    if (i >= 0) p.insertHold(i);
  });
}

// ================================================================== LEGS

export const legsPage: CduPage = {
  id: 'legs',
  pages(c) {
    return Math.max(1, Math.ceil(legsIndices(c).length / 5));
  },
  render(c, s) {
    const f = c.fmc;
    const p = f.plan;
    const idx = legsIndices(c);
    const n = Math.max(1, Math.ceil(idx.length / 5));
    const pre = f.routeTitlePrefix();
    s.title(`${pre}RTE 1 LEGS`, c.sub + 1, n);
    if (pre === 'MOD ') s.put(0, Math.floor((24 - 3 - `${pre}RTE 1 LEGS`.length) / 2), 'MOD', { reverse: true });
    const act = f.fms.plans.active;
    const activeIds = f.fms.plans.pending && f.hasActiveRoute ? new Set(act.legs.map((l) => l.id)) : null;
    const isAct = p === act && f.hasActiveRoute;
    let discoLabel = -1;
    for (let r = 1; r <= 5; r++) {
      const k = c.sub * 5 + r - 1;
      if (k >= idx.length) break;
      const i = idx[k];
      const l = p.legs[i];
      if (l.type === 'DISCO') {
        s.labelL(r, 'THEN');
        s.dataL(r, boxes(5));
        discoLabel = r + 1;
        continue;
      }
      const activeWpt = isAct && i === p.activeLegIndex;
      const col = activeWpt ? MAG : CduColor.White;
      // Label: course and distance (the active leg shows the distance to go).
      if (r !== discoLabel) {
        if (isHoldLeg(l.type)) s.labelL(r, 'HOLD AT');
        else {
          const crs = legCourseMag(l);
          if (l.geom.kind === 'arc') s.labelL(r, `ARC ${l.geom.turnDir > 0 ? 'R' : 'L'}`);
          else if (Number.isFinite(crs)) s.labelL(r, `${String(Math.round(crs) % 360 || 360).padStart(3, '0')}°`);
          const d = activeWpt ? f.vars.get('fms.dist_to_wpt_nm') : l.geom.lengthNm;
          if (l.geom.valid && Number.isFinite(d) && (d > 0 || activeWpt)) {
            const ds = `${d < 10 ? d.toFixed(1) : Math.round(d)}NM`;
            s.put(2 * r - 1, 13 - ds.length, ds, { small: true });
          }
        }
      }
      const reverse = activeIds !== null && !activeIds.has(l.id);
      s.dataL(r, legIdent(l), { color: col, reverse });
      if (f.plnMode && f.planCenterIndex === i) s.put(2 * r, 8, '<CTR>', { small: true });
      drawSpdAlt(c, s, 2 * r, p, l, col);
    }
    const holdAt = c.state.get('holdAt') === true;
    const intc = !!c.state.get('dirTo') && f.fms.plans.pending;
    if (discoLabel >= 1 && discoLabel <= 5) s.put(2 * discoLabel - 1, 0, ' --ROUTE DISCONTINUITY- ', { small: true });
    if (discoLabel === 6 && !holdAt) s.put(11, 0, intc ? ' --ROUTE DISC-' : ' --ROUTE DISCONTINUITY- ', { small: true });
    // Line 6
    if (holdAt) {
      s.labelL(6, 'HOLD AT');
      s.dataL(6, boxes(5));
      s.labelR(6, 'HOLD AT');
      s.dataR(6, 'PPOS>');
      return;
    }
    if (discoLabel !== 6) s.dashes(11);
    if (f.routeModPending) s.dataL(6, '<ERASE');
    if (intc) {
      s.labelR(6, 'INTC CRS');
      const crs = c.state.get('intcCrs') as number | undefined;
      s.dataR(6, crs !== undefined ? `${String(crs).padStart(3, '0')}°` : '---°');
    } else if (f.plnMode) s.dataR(6, 'STEP>');
    else s.dataR(6, 'RTE DATA>');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.row === 6) return legsRow6(c, k, t);
    const idx = legsIndices(c);
    const pos = c.sub * 5 + k.row - 1;
    const p = f.plan;
    const i = idx[pos];
    const l = i !== undefined ? p.legs[i] : undefined;
    if (k.side === 'L') {
      if (!l) {
        // Line after the end of the route: append a waypoint.
        if (!t || c.isDelete || pos !== idx.length) return;
        const w = parseWaypointEntry(c, t, refNear(p, p.legs.length - 1));
        if (!w) return c.error(NOT_IN_DATABASE);
        f.editPlan((pl) => pl.insertWaypoint(pl.legs.length, w));
        return c.consume();
      }
      if (!t) {
        if (l.type !== 'DISCO') c.copy(legIdent(l).replace(/[()]/g, ''));
        return;
      }
      if (c.isDelete) {
        const isActiveWpt = p === f.fms.plans.active ? i === p.activeLegIndex : l.id === f.fms.plans.active.activeLeg?.id;
        if ((isActiveWpt && !f.ground) || l.segment === 'origin') return c.error(INVALID_DELETE);
        f.editPlan((pl) => {
          const j = pl.indexOfLegId(l.id);
          if (j >= 0) pl.deleteLeg(j);
        });
        return c.consume();
      }
      if (t.startsWith('HOLD AT ')) {
        const id = t.slice(8).trim();
        const w = parseWaypointEntry(c, id, refNear(p, i));
        if (!w) return c.error(NOT_IN_DATABASE);
        f.editPlan((pl) => {
          const j = pl.indexOfLegId(l.id);
          const leg = pl.insertWaypoint(Math.max(0, j), w);
          const h = pl.indexOfLegId(leg.id);
          if (h >= 0) pl.insertHold(h);
        });
        c.consume();
        c.show('hold');
        return;
      }
      const w = parseWaypointEntry(c, t, refNear(p, i - 1));
      if (!w) return c.error(NOT_IN_DATABASE);
      // Direct-to: first line of the active route (FCOM 11.42 "Direct to").
      if (pos === 0 && f.hasActiveRoute && f.fms.plans.active.activeLegIndex >= 0) {
        if (!f.fms.directTo(w.kind === 'latlon' || w.kind === 'user' ? w : w.ident)) return c.error(INVALID_ENTRY);
        f.editPlan(() => undefined);
        c.state.set('dirTo', w.ident);
        c.state.delete('intcCrs');
        return c.consume();
      }
      f.editPlan((pl) => {
        const j = pl.indexOfLegId(l.id);
        pl.insertWaypoint(j >= 0 ? j : pl.legs.length, w);
      });
      return c.consume();
    }
    // Right side: speed / altitude constraints.
    if (!l || l.type === 'DISCO') return;
    if (!t) {
      if (l.altitude || l.speed) c.copy(constraintEntry(c, l));
      return;
    }
    if (c.isDelete) {
      f.editPlan((pl) => {
        const j = pl.indexOfLegId(l.id);
        pl.setAltitudeConstraint(j, null);
        pl.setSpeedConstraint(j, null);
      });
      return c.consume();
    }
    const e = parseSpeedAlt(t);
    if (!e) return c.error(INVALID_ENTRY);
    if (e.speed && !Number.isFinite(e.speed.kt)) return c.error(INVALID_ENTRY);
    if (e.speed && !Number.isFinite(e.altFt) && !l.altitude) return c.error(INVALID_ENTRY);
    f.editPlan((pl) => {
      const j = pl.indexOfLegId(l.id);
      if (Number.isFinite(e.altFt)) {
        const a = e.altFt;
        const kind = e.altKind || 'at';
        pl.setAltitudeConstraint(j, kind === 'atOrAbove' ? { kind, lowerFt: a } : kind === 'atOrBelow' ? { kind, upperFt: a } : { kind: 'at', lowerFt: a, upperFt: a });
      }
      if (e.speed) pl.setSpeedConstraint(j, { kind: 'atOrBelow', kt: e.speed.kt });
    });
    c.consume();
  },
  onShow(c) {
    c.state.delete('holdAt');
    // LEGS key: the page with the PLN centre (or page 1).
    const f = c.fmc;
    if (f.plnMode && f.planCenterIndex >= 0) {
      const pos = legsIndices(c).indexOf(f.planCenterIndex);
      if (pos >= 0) c.sub = Math.floor(pos / 5);
    }
  },
};

function legsRow6(c: Cdu, k: Lsk, t: string): void {
  const f = c.fmc;
  const holdAt = c.state.get('holdAt') === true;
  if (holdAt) {
    if (k.side === 'L') {
      if (!t) return;
      const p = f.plan;
      const start = Math.max(0, p.activeLegIndex);
      const j = p.legs.findIndex((l, i) => i >= start && l.fix?.ident === t && l.type !== 'DISCO' && !isHoldLeg(l.type));
      if (j < 0) {
        // Off-route fix: HOLD AT xxxxx goes to the scratchpad to be placed on a LEGS line.
        const w = parseWaypointEntry(c, t);
        if (!w) return c.error(NOT_IN_DATABASE);
        c.copy(`HOLD AT ${w.ident}`);
        c.state.delete('holdAt');
        return;
      }
      insertHoldAt(c, p.legs[j].id);
      c.consume();
      c.state.delete('holdAt');
      c.show('hold');
      return;
    }
    // PPOS: hold at the present position (direct to PPOS, hold there).
    const v = f.vars;
    if (!v.getBool(GPS.valid)) return c.error(INVALID_ENTRY);
    const w: Waypoint = { ident: 'PPOS', lat: v.get(GPS.lat), lon: v.get(GPS.lon), kind: 'user' };
    if (!f.fms.directTo(w)) return c.error(INVALID_ENTRY);
    f.editPlan((pl) => {
      const i = pl.activeLegIndex;
      if (i >= 0) pl.insertHold(i, { inboundCourseMag: Math.round(v.get(GPS.trackMag)) });
    });
    c.state.delete('holdAt');
    c.show('hold');
    return;
  }
  if (k.side === 'L') {
    if (f.routeModPending) {
      f.erase();
      c.state.delete('dirTo');
    }
    return;
  }
  if (c.state.get('dirTo') && f.fms.plans.pending) {
    const crs = parseCourse(t);
    if (!Number.isFinite(crs)) return c.error(INVALID_ENTRY);
    const id = c.state.get('dirTo') as string;
    if (!f.fms.directTo(id, crs)) return c.error(INVALID_ENTRY);
    f.editPlan(() => undefined);
    c.state.set('intcCrs', crs);
    return c.consume();
  }
  if (f.plnMode) {
    // STEP: next waypoint becomes the PLN centre.
    const p = f.plan;
    const idx = legsIndices(c).filter((i) => p.legs[i].fix && p.legs[i].type !== 'DISCO');
    if (idx.length === 0) return;
    const cur = idx.indexOf(f.planCenterIndex);
    const next = idx[(cur + 1) % idx.length];
    f.planCenterIndex = next;
    const pos = legsIndices(c).indexOf(next);
    if (pos >= 0) c.sub = Math.floor(pos / 5);
    return;
  }
  c.show('rteData');
}

// ================================================================== RTE DATA

export const rteDataPage: CduPage = {
  id: 'rteData',
  pages(c) {
    return Math.max(1, Math.ceil(legsIndices(c).length / 5));
  },
  render(c, s) {
    const f = c.fmc;
    const p = f.plan;
    const idx = legsIndices(c);
    s.title(`${f.routeTitlePrefix()}RTE 1 DATA`, c.sub + 1, Math.max(1, Math.ceil(idx.length / 5)));
    s.labelL(1, 'ETA');
    s.put(1, 8, 'WPT', { small: true });
    s.labelR(1, 'WIND');
    const crz = f.perf.crzAltFt;
    for (let r = 1; r <= 5; r++) {
      const i = idx[c.sub * 5 + r - 1];
      if (i === undefined) break;
      const l = p.legs[i];
      if (l.type === 'DISCO') {
        s.put(2 * r, 8, boxes(5));
        continue;
      }
      s.dataL(r, fmtEta(f.etaLeg(p, i)).padEnd(8, ' ').slice(0, 7), { small: true });
      s.put(2 * r, 8, legIdent(l), { color: i === p.activeLegIndex && p === f.fms.plans.active ? MAG : CduColor.White });
      const pa = predictedAlt(c, p, l);
      const atCrz = Number.isFinite(crz) && Number.isFinite(pa) && pa >= crz - 50;
      const w = atCrz ? f.crzWind : { dir: NaN, kt: NaN };
      s.dataR(r, Number.isFinite(w.dir) ? `${String(Math.round(w.dir) % 360).padStart(3, '0')}°/${String(Math.round(w.kt)).padStart(3, ' ')}` : '---°/---', { small: true });
    }
    s.dashes(11);
    s.dataL(6, '<LEGS');
  },
  lsk(c, k) {
    if (k.side === 'L' && k.row === 6) c.show('legs');
  },
};

// ================================================================== HOLD

function holdIndices(c: Cdu): number[] {
  const p = c.fmc.plan;
  const out: number[] = [];
  const start = Math.max(0, p.activeLegIndex - 1);
  // Published missed-approach holds count once the missed approach is flown.
  const missed = c.fmc.vars.get('fms.missed_active') !== 0;
  p.legs.forEach((l, i) => {
    if (i >= start && isHoldLeg(l.type) && (l.segment !== 'missed' || missed)) out.push(i);
  });
  return out;
}

const QUAD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const holdPage: CduPage = {
  id: 'hold',
  pages(c) {
    return Math.max(1, holdIndices(c).length);
  },
  onShow(c) {
    const holds = holdIndices(c);
    if (holds.length === 0) {
      c.show('legs');
      c.state.set('holdAt', true);
      return;
    }
    c.sub = holds.length - 1;
  },
  render(c, s) {
    const f = c.fmc;
    const p = f.plan;
    const holds = holdIndices(c);
    const i = holds[c.sub];
    const pre = f.routeTitlePrefix();
    s.title(`${pre}RTE 1 HOLD`, c.sub + 1, Math.max(1, holds.length));
    if (i === undefined) return;
    const l = p.legs[i];
    const w = f.perfWeightKg;
    s.labelL(1, 'FIX');
    s.dataL(1, l.fix?.ident ?? '-----');
    const inbd = l.course ?? 0;
    const radial = (inbd + 180) % 360;
    s.labelL(2, 'QUAD/RADIAL');
    s.dataL(2, `${QUAD[Math.round(radial / 45) % 8]}/${String(Math.round(radial)).padStart(3, '0')}°`);
    s.labelL(3, 'INBD CRS/DIR');
    s.dataL(3, `${String(Math.round(inbd) % 360).padStart(3, '0')}°/${l.turnDirection ?? 'R'} TURN`);
    s.labelL(4, 'LEG TIME');
    const alt = l.altitude?.lowerFt ?? l.altitude?.upperFt ?? f.altFt;
    const tMin = l.distanceNm === undefined ? l.holdTimeMin ?? (alt > 14000 ? 1.5 : 1.0) : NaN;
    s.dataL(4, Number.isFinite(tMin) ? `${tMin.toFixed(1)}MIN` : '-.-MIN');
    s.labelL(5, 'LEG DIST');
    s.dataL(5, l.distanceNm !== undefined ? `${l.distanceNm.toFixed(1)}NM` : '--.-NM');
    const best = flapManeuverSpeed(0, w);
    s.labelR(1, 'SPD/TGT ALT');
    const spd = l.speed ? String(l.speed.kt) : String(best);
    s.dataR(1, `${spd}/${l.altitude ? fmtAlt(alt, f.transAltFt) : '-----'}`);
    s.labelR(2, 'FIX ETA');
    // ETA at the hold fix: the leg before the hold ends at the fix.
    s.dataR(2, fmtEta(f.etaLeg(p, Math.max(0, i - 1))));
    s.labelR(3, 'EFC TIME');
    const efc = f.efc.get(l.id);
    s.dataR(3, efc !== undefined ? fmtEta(efc).replace(/\.\dz$/, 'z') : '----z');
    s.labelR(4, 'HOLD AVAIL');
    const ff = f.fms.perf.fuelFlowKgH;
    const fdest = f.vars.get('fms.fuel_dest_kg');
    const avail = Number.isFinite(f.reservesKg) && ff > 100 && fdest > 0 ? ((fdest - f.reservesKg) / ff) * 60 : NaN;
    s.dataR(4, Number.isFinite(avail) && avail > 0 ? `${Math.floor(avail / 60)}+${String(Math.floor(avail % 60)).padStart(2, '0')}` : '-+--');
    s.labelR(5, 'BEST SPEED');
    s.dataR(5, `${best}KT`);
    s.dashes(11);
    s.dataL(6, '<NEXT HOLD');
    const inThis = f.fms.plans.active.activeLegIndex === f.fms.plans.active.indexOfLegId(l.id) && f.vars.get('fms.in_hold') !== 0;
    if (f.exitHoldArmed && inThis) s.dataR(6, 'EXIT ARMED', { color: CduColor.Green });
    else if (inThis || (f.exitHoldPending && inThis)) s.dataR(6, 'EXIT HOLD>', { reverse: f.exitHoldPending });
  },
  lsk(c, k) {
    const f = c.fmc;
    const holds = holdIndices(c);
    const i = holds[c.sub];
    const t = c.scratch.trim();
    if (k.side === 'L' && k.row === 6) {
      c.show('legs');
      c.state.set('holdAt', true);
      return;
    }
    if (i === undefined) return;
    const l = f.plan.legs[i];
    if (k.side === 'R' && k.row === 6) {
      const act = f.fms.plans.active;
      if (act.activeLegIndex === act.indexOfLegId(l.id)) {
        f.exitHoldPending = true;
        f.version++;
      }
      return;
    }
    if (!t) return;
    const upd = (fn: (h: PlanLeg) => void): void =>
      f.editPlan((pl) => {
        const j = pl.indexOfLegId(l.id);
        if (j < 0) return;
        fn(pl.legs[j]);
        pl.touch();
      });
    if (k.side === 'L' && k.row === 2) {
      const m = /^(N|NE|E|SE|S|SW|W|NW)?\/?(\d{1,3})$/.exec(t);
      if (!m || Number(m[2]) > 360) return c.error(INVALID_ENTRY);
      upd((h) => (h.course = (Number(m[2]) + 180) % 360));
      return c.consume();
    }
    if (k.side === 'L' && k.row === 3) {
      const m = /^(\d{1,3})?(?:\/([LR]))?$/.exec(t.replace(/ TURN$/, ''));
      if (!m || (!m[1] && !m[2]) || (m[1] && Number(m[1]) > 360)) return c.error(INVALID_ENTRY);
      upd((h) => {
        if (m[1]) h.course = Number(m[1]) % 360;
        if (m[2]) h.turnDirection = m[2] as 'L' | 'R';
      });
      return c.consume();
    }
    if (k.side === 'L' && k.row === 1) {
      if (t === 'R' || t === 'L') {
        upd((h) => (h.turnDirection = t));
        return c.consume();
      }
      return c.error(INVALID_ENTRY);
    }
    if (k.side === 'L' && (k.row === 4 || k.row === 5)) {
      const n = Number(t);
      if (!/^\d{1,2}(\.\d)?$/.test(t) || n <= 0 || n > 30) return c.error(INVALID_ENTRY);
      upd((h) => {
        if (k.row === 4) {
          h.holdTimeMin = n;
          h.distanceNm = undefined;
        } else {
          h.distanceNm = n;
          h.holdTimeMin = undefined;
        }
      });
      return c.consume();
    }
    if (k.side === 'R' && k.row === 1) {
      const e = parseSpeedAlt(t);
      if (!e || (e.speed && !Number.isFinite(e.speed.kt))) return c.error(INVALID_ENTRY);
      upd((h) => {
        if (e.speed) h.speed = { kind: 'atOrBelow', kt: e.speed.kt };
        if (Number.isFinite(e.altFt)) h.altitude = { kind: 'at', lowerFt: e.altFt, upperFt: e.altFt };
        h.userConstraint = true;
      });
      return c.consume();
    }
    if (k.side === 'R' && k.row === 3) {
      const m = /^(\d{2})(\d{2})Z?$/.exec(t);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return c.error(INVALID_ENTRY);
      f.efc.set(l.id, Number(m[1]) + Number(m[2]) / 60);
      return c.consume();
    }
    c.error(INVALID_ENTRY);
  },
};
