/**
 * Flight plan editing flows of the GTC "Active Flight Plan", "Direct To" and
 * "PROC" screens on top of the nav module's `Fms` (Garmin immediate editing,
 * docs/modules/nav.md §5-6). Everything here is UI-independent and unit
 * tested (tests/avionics/garmin-g3000/fplEditor.test.ts).
 *
 * Flows (G3000 PG 190-02046-01 §5.5 "Direct-to Navigation", §5.6 "Flight
 * Planning", §5.8 "Procedures"; G5000 CRG 190-02538-02 "Flight Management"):
 *  - Add Origin / Add Destination (airport identifier) and select the
 *    departure / arrival runway.
 *  - Add Enroute Waypoint (appends before the arrival), Insert Before /
 *    Insert After a selected waypoint, Remove waypoint, Load Airway from a
 *    waypoint with an exit fix, Hold at waypoint, Activate Leg To.
 *  - Altitude / speed constraints on a waypoint (pencil icon = crew entered).
 *  - Departure (SID + runway + enroute transition), Arrival (STAR +
 *    transition + runway), Approach (approach + transition) with Load,
 *    Load and Activate, Activate Vectors-To-Final; Remove each procedure;
 *    Activate Approach / Missed Approach.
 *  - Direct-To a flight-plan or database waypoint, optional course.
 *  - Delete flight plan, cruise altitude and descent angle (VNAV page).
 */
import type { SimVars } from '../../../core/SimVars';
import { GPS } from '../../../core/vars';
import { distanceNm } from '../../../core/geo';
import type { Fms } from '../../../nav/fms/Fms';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import type { PlanLeg, PlanSegment } from '../../../nav/flightplan/types';
import type { Airport, AirportProcedures, AltitudeConstraint, NavDatabase, Procedure, SpeedConstraint, Waypoint } from '../../../nav/types';
import { normalizeRunwayIdent } from '../../../nav/procedures';

/** A row of the flight plan list (GTC Active Flight Plan screen / MFD Flight Plan pane). */
export interface FplRow {
  kind: 'origin' | 'header' | 'leg' | 'destination' | 'disco';
  /** Main text: fix ident, airport ident, header text ('Departure - KTEB-RW24.RUUDY6'). */
  text: string;
  /** Sub text: facility name / leg annotation ('iaf', 'faf', 'map', 'HDG 240°'). */
  sub: string;
  /** Plan leg index (leg / disco rows), -1 otherwise. */
  legIndex: number;
  segment: PlanSegment | null;
  /** Row is the active leg (magenta) / the from leg. */
  active: boolean;
  from: boolean;
}

export type ProcKind = 'departure' | 'arrival' | 'approach';

/** Approach types whose final course is flown on the localizer (auto-tune + LOC/GS on APR). */
export const LOC_APPROACH_TYPES = new Set(['ILS', 'LOC', 'LOC_BC', 'LDA', 'SDF', 'IGS']);

export class FplEditor {
  readonly fms: Fms;
  readonly db: NavDatabase;
  private readonly vars: SimVars;
  private readonly procCache = new Map<string, AirportProcedures | null>();
  private readonly procPending = new Set<string>();
  /** Called after an approach has been loaded (the suite auto-tunes the localizer). */
  onApproachLoaded: ((proc: Procedure, plan: FlightPlan) => void) | null = null;
  /** Called whenever an edit changed the plan (pages refresh). */
  onChange: (() => void) | null = null;
  /** Last error text for the GTC ("Airway does not connect"). */
  lastError = '';

  constructor(fms: Fms, db: NavDatabase, vars: SimVars) {
    this.fms = fms;
    this.db = db;
    this.vars = vars;
  }

  get plan(): FlightPlan {
    return this.fms.plans.active;
  }

  private commit(): void {
    this.fms.plans.commit();
    this.onChange?.();
  }

  private pos(): { lat: number; lon: number } {
    const v = this.vars;
    return { lat: v.get(GPS.lat), lon: v.get(GPS.lon) };
  }

  // ------------------------------------------------------------ lookups

  /** Airport by identifier (ICAO / FAA / IATA code). */
  airport(ident: string): Airport | undefined {
    const id = ident.trim().toUpperCase();
    return id ? this.db.airport(id) : undefined;
  }

  /** Database matches for an identifier, nearest first (duplicates list when > 1). */
  resolve(ident: string): Waypoint[] {
    const id = ident.trim().toUpperCase();
    if (!id) return [];
    const p = this.pos();
    const lat = Number.isFinite(p.lat) ? p.lat : 0;
    const lon = Number.isFinite(p.lon) ? p.lon : 0;
    return this.db.resolve(id, lat, lon);
  }

  /** Airport procedures (cached). Starts loading on first request; returns undefined until loaded. */
  procedures(icao: string): AirportProcedures | undefined {
    const k = icao.toUpperCase();
    const hit = this.procCache.get(k);
    if (hit !== undefined) return hit ?? undefined;
    if (!this.procPending.has(k) && this.db.loadProcedures) {
      this.procPending.add(k);
      this.db
        .loadProcedures(k)
        .then((p) => {
          this.procCache.set(k, p ?? null);
          this.onChange?.();
        })
        .catch(() => this.procCache.set(k, null))
        .finally(() => this.procPending.delete(k));
    }
    return undefined;
  }

  /** Awaitable procedure load (tests, preloading). */
  async loadProcedures(icao: string): Promise<AirportProcedures | undefined> {
    const k = icao.toUpperCase();
    if (this.procCache.has(k)) return this.procCache.get(k) ?? undefined;
    const p = await this.db.loadProcedures?.(k);
    this.procCache.set(k, p ?? null);
    return p;
  }

  /** Airways through a fix ident (NavDatabaseImpl.airwaysAt when available). */
  airwaysAt(ident: string): string[] {
    const fn = (this.db as unknown as { airwaysAt?: (id: string) => string[] }).airwaysAt;
    return fn ? fn.call(this.db, ident) : [];
  }

  /** Fixes reachable along `airway` from `entry` (exit candidates), in path order. */
  airwayExits(airway: string, entry: Waypoint): string[] {
    const segs = this.db.airway(airway);
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string): void => {
      let s = adj.get(a);
      if (!s) adj.set(a, (s = new Set()));
      s.add(b);
    };
    for (const s of segs) {
      add(s.from, s.to);
      if (!s.oneWay) add(s.to, s.from);
    }
    const out: string[] = [];
    const seen = new Set<string>([entry.ident]);
    const queue = [entry.ident];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
        queue.push(n);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ origin / destination

  setOrigin(ident: string, runway?: string): boolean {
    const a = this.airport(ident);
    if (!a) return this.fail(`${ident} not found`);
    this.plan.setOrigin(a, runway);
    this.activateFirstIfNone();
    this.commit();
    return true;
  }

  setDepartureRunway(runway: string | null): boolean {
    if (!this.plan.origin) return this.fail('No origin');
    this.plan.setDepartureRunway(runway);
    this.commit();
    return true;
  }

  setDestination(ident: string): boolean {
    const a = this.airport(ident);
    if (!a) return this.fail(`${ident} not found`);
    this.plan.setDestination(a);
    this.activateFirstIfNone();
    this.commit();
    return true;
  }

  setArrivalRunway(runway: string | null): boolean {
    if (!this.plan.destination) return this.fail('No destination');
    this.plan.setArrivalRunway(runway);
    this.commit();
    return true;
  }

  removeOrigin(): void {
    this.plan.setOrigin(null);
    this.commit();
  }

  removeDestination(): void {
    this.plan.setDestination(null);
    this.commit();
  }

  // ------------------------------------------------------------ waypoints

  /** Inserts `wpt` before leg `index` (Insert Before) — or after with `after`. */
  insertWaypoint(index: number, wpt: Waypoint, after = false): PlanLeg | null {
    const p = this.plan;
    let at = after ? index + 1 : index;
    // Never insert before the origin leg or after the destination leg.
    if (p.legs[0]?.segment === 'origin') at = Math.max(1, at);
    const destIdx = p.legs.findIndex((l) => l.segment === 'destination');
    if (destIdx >= 0 && at > destIdx) at = destIdx;
    const leg = p.insertWaypoint(at, wpt);
    this.activateFirstIfNone();
    this.commit();
    return leg;
  }

  /** "Add Enroute Waypoint": appended before the arrival / approach / destination. */
  appendEnroute(wpt: Waypoint): PlanLeg {
    const leg = this.plan.appendEnrouteWaypoint(wpt);
    this.activateFirstIfNone();
    this.commit();
    return leg;
  }

  /** Removes leg `index` (origin/destination rows use removeOrigin/removeDestination). */
  deleteLeg(index: number): boolean {
    const leg = this.plan.legs[index];
    if (!leg) return false;
    if (leg.segment === 'origin') {
      this.removeOrigin();
      return true;
    }
    if (leg.segment === 'destination') {
      this.removeDestination();
      return true;
    }
    this.plan.deleteLeg(index);
    this.commit();
    return true;
  }

  /** Loads `airway` after leg `index` up to `exitIdent`. */
  loadAirway(index: number, airway: string, exitIdent: string): boolean {
    try {
      this.plan.insertAirway(index, airway, exitIdent, this.db);
    } catch (e) {
      return this.fail((e as Error).message);
    }
    this.commit();
    return true;
  }

  /** Manual-termination hold at the fix of leg `index`. */
  holdAt(index: number, inboundCourseMag?: number, turn: 'L' | 'R' = 'R', legTimeMin?: number, legDistanceNm?: number): boolean {
    const h = this.plan.insertHold(index, { inboundCourseMag, turnDirection: turn, legTimeMin, legDistanceNm });
    if (!h) return this.fail('No fix');
    this.commit();
    return true;
  }

  setAltitudeConstraint(index: number, kind: AltitudeConstraint['kind'] | null, ft = 0, upperFt = 0): boolean {
    const leg = this.plan.legs[index];
    if (!leg || leg.type === 'DISCO') return false;
    let c: AltitudeConstraint | null = null;
    if (kind === 'at') c = { kind, lowerFt: ft, upperFt: ft };
    else if (kind === 'atOrAbove') c = { kind, lowerFt: ft };
    else if (kind === 'atOrBelow') c = { kind, upperFt: ft };
    else if (kind === 'between') c = { kind, lowerFt: Math.min(ft, upperFt), upperFt: Math.max(ft, upperFt) };
    this.plan.setAltitudeConstraint(index, c);
    this.commit();
    return true;
  }

  setSpeedConstraint(index: number, kind: SpeedConstraint['kind'] | null, kt = 0): boolean {
    const leg = this.plan.legs[index];
    if (!leg || leg.type === 'DISCO') return false;
    this.plan.setSpeedConstraint(index, kind ? { kind, kt } : null);
    this.commit();
    return true;
  }

  activateLeg(index: number): boolean {
    const ok = this.fms.activateLeg(index);
    this.onChange?.();
    return ok;
  }

  /** Direct-To a plan leg index or a database/user waypoint (optional course, deg magnetic). */
  directTo(target: number | Waypoint, courseMag?: number): boolean {
    const ok = this.fms.directTo(target, courseMag);
    if (!ok) this.lastError = 'GPS position invalid';
    this.onChange?.();
    return ok;
  }

  /** Deletes the whole active flight plan. */
  deletePlan(): void {
    const p = this.plan;
    p.setOrigin(null);
    p.setDestination(null);
    p.legs.length = 0;
    p.activeLegIndex = -1;
    p.cruiseAltFt = 0;
    p.touch();
    this.commit();
  }

  setCruiseAltitude(ft: number): void {
    this.fms.setCruiseAltitude(ft);
    this.onChange?.();
  }

  setDescentAngle(deg: number): void {
    const p = this.plan;
    p.descentFpaDeg = Math.min(6, Math.max(1, deg));
    p.touch();
    this.commit();
  }

  // ------------------------------------------------------------ procedures

  /** Departure: SID ident with runway (optional) and enroute transition. */
  loadDeparture(sidIdent: string, runway?: string, enrouteTransition?: string): boolean {
    const p = this.plan;
    if (!p.origin) return this.fail('No origin');
    const procs = this.procCache.get(p.origin.icao.toUpperCase());
    const sid = procs?.sids.find((s) => s.ident === sidIdent);
    if (!sid) return this.fail(`${sidIdent} not loaded`);
    if (runway) p.setDepartureRunway(runway);
    p.setSid(sid, runway ? normalizeRunwayIdent(runway) : undefined, enrouteTransition);
    this.activateFirstIfNone();
    this.commit();
    return true;
  }

  removeDeparture(): void {
    this.plan.setSid(null);
    this.commit();
  }

  /** Arrival: STAR ident with enroute transition and runway (optional). */
  loadArrival(starIdent: string, enrouteTransition?: string, runway?: string): boolean {
    const p = this.plan;
    if (!p.destination) return this.fail('No destination');
    const procs = this.procCache.get(p.destination.icao.toUpperCase());
    const star = procs?.stars.find((s) => s.ident === starIdent);
    if (!star) return this.fail(`${starIdent} not loaded`);
    if (runway) p.setArrivalRunway(runway);
    p.setStar(star, enrouteTransition, runway ? normalizeRunwayIdent(runway) : undefined);
    this.activateFirstIfNone();
    this.commit();
    return true;
  }

  removeArrival(): void {
    this.plan.setStar(null);
    this.commit();
  }

  /**
   * Approach: `mode` 'load' just loads it, 'activate' flies direct to the
   * first approach fix, 'vtf' activates vectors-to-final (leg into the FAF).
   * Loading an approach at another airport makes it the destination.
   */
  loadApproach(airport: string, approachIdent: string, transition?: string, mode: 'load' | 'activate' | 'vtf' = 'load'): boolean {
    const a = this.airport(airport);
    if (!a) return this.fail(`${airport} not found`);
    const procs = this.procCache.get(a.icao.toUpperCase());
    const appr = procs?.approaches.find((x) => x.ident === approachIdent);
    if (!appr) return this.fail(`${approachIdent} not loaded`);
    const p = this.plan;
    if (!p.destination || p.destination.icao !== a.icao) p.setDestination(a);
    p.setApproach(appr, transition);
    this.activateFirstIfNone();
    this.fms.plans.commit();
    this.onApproachLoaded?.(appr, p);
    if (mode === 'activate') this.fms.activateApproach();
    else if (mode === 'vtf') this.fms.activateVectorsToFinal();
    this.onChange?.();
    return true;
  }

  removeApproach(): void {
    this.plan.setApproach(null);
    this.commit();
  }

  activateApproach(): boolean {
    const ok = this.fms.activateApproach();
    this.onChange?.();
    return ok;
  }

  activateVtf(): boolean {
    const ok = this.fms.activateVectorsToFinal();
    this.onChange?.();
    return ok;
  }

  activateMissedApproach(): void {
    this.fms.activateMissedApproach();
    this.onChange?.();
  }

  /** True when the loaded approach is flown on a localizer (ILS/LOC/LDA/SDF). */
  approachIsLoc(): boolean {
    const t = this.plan.approachProcedure?.approachType;
    return !!t && LOC_APPROACH_TYPES.has(t);
  }

  // ------------------------------------------------------------ rows

  /**
   * Builds the list rows: origin, procedure headers, legs, destination.
   * Allocates (page refresh only, keyed on `fms.plan_version`).
   */
  rows(): FplRow[] {
    const p = this.plan;
    const rows: FplRow[] = [];
    const active = p.activeLegIndex;
    let lastHeader: string | null = null;
    for (let i = 0; i < p.legs.length; i++) {
      const l = p.legs[i];
      if (l.segment === 'origin') {
        rows.push({ kind: 'origin', text: p.origin?.icao ?? l.fix?.ident ?? '', sub: p.origin?.name ?? '', legIndex: i, segment: 'origin', active: i === active, from: i === active - 1 });
        continue;
      }
      if (l.segment === 'destination') {
        rows.push({ kind: 'destination', text: l.fix?.ident ?? p.destination?.icao ?? '', sub: p.destination?.name ?? '', legIndex: i, segment: 'destination', active: i === active, from: i === active - 1 });
        continue;
      }
      const header = this.headerFor(l.segment);
      if (header !== lastHeader) {
        rows.push({ kind: 'header', text: header, sub: '', legIndex: -1, segment: l.segment, active: false, from: false });
        lastHeader = header;
      }
      if (l.type === 'DISCO') {
        rows.push({ kind: 'disco', text: 'DISCONTINUITY', sub: '', legIndex: i, segment: l.segment, active: false, from: false });
        continue;
      }
      rows.push({ kind: 'leg', text: legIdent(l), sub: legSub(l), legIndex: i, segment: l.segment, active: i === active, from: i === active - 1 });
    }
    return rows;
  }

  /** Header text per segment (Garmin: "Departure - KTEB-RW24.RUUDY6.WAVEY", "Enroute", "Approach - KCOS-RNAV Y 35R"). */
  headerFor(seg: PlanSegment): string {
    const p = this.plan;
    switch (seg) {
      case 'departure':
        return `Departure - ${p.origin?.icao ?? ''}${p.departureRunway ? `-RW${p.departureRunway}` : ''}.${p.sid?.ident ?? ''}${p.sid?.enrouteTransition ? `.${p.sid.enrouteTransition}` : ''}`;
      case 'arrival':
        return `Arrival - ${p.destination?.icao ?? ''}-${p.star?.enrouteTransition ? `${p.star.enrouteTransition}.` : ''}${p.star?.ident ?? ''}${p.arrivalRunway ? `.RW${p.arrivalRunway}` : ''}`;
      case 'approach':
        return `Approach - ${p.destination?.icao ?? ''}-${p.approachProcedure?.name ?? p.approach?.ident ?? ''}`;
      case 'missed':
        return 'Missed Approach';
      default:
        return 'Enroute';
    }
  }

  // ------------------------------------------------------------ helpers

  private activateFirstIfNone(): void {
    const p = this.plan;
    if (p.activeLegIndex >= 0 || p.legs.length < 2) return;
    const i = p.legs.findIndex((l, k) => k > 0 && l.type !== 'DISCO' && !!l.fix);
    if (i > 0) p.activateLeg(i);
  }

  private fail(msg: string): false {
    this.lastError = msg;
    return false;
  }

  /** Distance / bearing helpers for list rows. */
  static distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    return distanceNm(a.lat, a.lon, b.lat, b.lon);
  }
}

/** Display ident of a leg (fix ident, or the path terminator annotation for fixless legs). */
export function legIdent(l: PlanLeg): string {
  if (l.fix?.ident) {
    if (l.type === 'HM' || l.type === 'HF' || l.type === 'HA') return `HOLD ${l.fix.ident}`;
    return l.fix.ident;
  }
  switch (l.type) {
    case 'CA':
    case 'VA':
    case 'FA':
      return l.altitude?.lowerFt !== undefined ? `${Math.round(l.altitude.lowerFt)}FT` : 'ALT';
    case 'VM':
    case 'FM':
      return 'MANSEQ';
    case 'VI':
    case 'CI':
      return 'INTRCPT';
    case 'VD':
    case 'CD':
    case 'FD':
      return l.distanceNm !== undefined ? `D${Math.round(l.distanceNm)}` : 'DME';
    case 'VR':
    case 'CR':
      return 'RADIAL';
    default:
      return l.type;
  }
}

/** Sub label: approach fix role or heading of a heading leg. */
export function legSub(l: PlanLeg): string {
  if (l.faf) return 'faf';
  if (l.map) return 'map';
  if (l.iaf) return 'iaf';
  if (l.missedStart) return 'mahp';
  if ((l.type.startsWith('V') || l.type === 'FM' || l.type === 'CA') && l.course !== undefined) return `HDG ${String(Math.round(l.course)).padStart(3, '0')}°`;
  if (l.airway) return l.airway;
  return '';
}
