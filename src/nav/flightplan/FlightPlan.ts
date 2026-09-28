/**
 * Flight plan: origin/destination/alternate, departure/arrival runways,
 * SID/STAR/approach selections and the flattened leg list the FMS flies.
 *
 * The leg list is the ground truth. Each leg carries the segment it belongs
 * to (origin, departure, enroute, arrival, approach, missed, destination);
 * selecting a procedure replaces only its segment, so edits elsewhere
 * survive. Junctions between segments are normalised after every edit:
 *   - a repeated fix (STAR end = approach IAF, SID transition = first
 *     enroute fix) is merged, keeping the later leg's constraints;
 *   - an IF that does not continue the previous leg becomes a route
 *     discontinuity (Boeing style) or a direct TF connection (Garmin style);
 *   - a vectors leg (FM, VM) is always followed by a discontinuity when more
 *     legs follow (a manual hold, HM, continues along the route once exited).
 *
 * Editing semantics differ by `style` exactly where the real systems do:
 * Boeing inserts a discontinuity after a waypoint inserted on the LEGS page
 * and closes the route up to a downstream duplicate; Garmin connects directly.
 * The EXEC/erase copy-on-write behaviour lives in `FlightPlanManager`.
 */
import type { Airport, AltitudeConstraint, Procedure, ProcedureLeg, SpeedConstraint, Waypoint } from '../types';
import type { NavDatabase } from '../types';
import { distanceNm } from '../../core/geo';
import { normalizeRunwayIdent, transitionServesRunway, findTransition } from '../procedures';
import { runwayThreshold } from './synthetic';
import { expandAirway } from './airways';
import { emptyGeometry, isManualLeg, type HoldParams, type PlanLeg, type PlanLegType, type PlanSegment, type ProcedureSelection } from './types';

export type EditStyle = 'boeing' | 'garmin';

let nextLegId = 1;

/** Creates a plan leg with a fresh id and empty geometry. */
export function makeLeg(fields: Omit<Partial<PlanLeg>, 'id' | 'geom'> & { type: PlanLegType; segment: PlanSegment }): PlanLeg {
  return { flyOver: false, magVar: 0, ...fields, id: nextLegId++, geom: emptyGeometry() };
}

/** Converts a procedure leg to a plan leg. */
export function legFromProcedure(p: ProcedureLeg, segment: PlanSegment, procedure: string): PlanLeg {
  const { type, ...rest } = p;
  return makeLeg({ ...rest, type, segment, procedure });
}

const SEGMENT_ORDER: Record<PlanSegment, number> = {
  origin: 0,
  departure: 1,
  enroute: 2,
  arrival: 3,
  approach: 4,
  missed: 5,
  destination: 6,
};

/** Two fixes are "the same" when idents match and they lie within 1 nm. */
function sameFix(a: Waypoint | undefined, b: Waypoint | undefined): boolean {
  if (!a || !b || a.ident !== b.ident) return false;
  if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return true;
  return distanceNm(a.lat, a.lon, b.lat, b.lon) < 1;
}

function discoLeg(segment: PlanSegment): PlanLeg {
  return makeLeg({ type: 'DISCO', segment });
}

export class FlightPlan {
  style: EditStyle;
  name = '';
  origin: Airport | null = null;
  destination: Airport | null = null;
  alternate: Airport | null = null;
  /** Departure runway ident ('04L') or null. */
  departureRunway: string | null = null;
  /** Arrival runway ident, from the approach or set directly. */
  arrivalRunway: string | null = null;
  sid: ProcedureSelection | null = null;
  star: ProcedureSelection | null = null;
  approach: ProcedureSelection | null = null;
  /** Selected procedure objects (immutable database objects). */
  sidProcedure: Procedure | null = null;
  starProcedure: Procedure | null = null;
  approachProcedure: Procedure | null = null;
  /** Cruise altitude (ft); 0 = not set (VNAV then uses the highest constraint / current altitude). */
  cruiseAltFt = 0;
  /** Default VNAV descent flight path angle (deg). Garmin default 3.0 deg. */
  descentFpaDeg = 3.0;
  /** Cruise speed from a route string speed group (kt TAS / Mach), 0 when unset. */
  cruiseSpeedKt = 0;
  cruiseMach = 0;
  legs: PlanLeg[] = [];
  /** Index of the leg being flown (the TO leg); -1 = none. */
  activeLegIndex = -1;
  /** Increments on every change (the FMS recomputes geometry and republishes). */
  version = 0;
  /** Set when an edit chose the active leg itself (direct-to); consumed by `FlightPlanManager.exec()`. Not cloned. */
  explicitActive = false;

  constructor(style: EditStyle = 'garmin') {
    this.style = style;
  }

  /** Deep copy (legs keep their ids, geometry is copied). */
  clone(): FlightPlan {
    const c = new FlightPlan(this.style);
    c.name = this.name;
    c.origin = this.origin;
    c.destination = this.destination;
    c.alternate = this.alternate;
    c.departureRunway = this.departureRunway;
    c.arrivalRunway = this.arrivalRunway;
    c.sid = this.sid ? { ...this.sid } : null;
    c.star = this.star ? { ...this.star } : null;
    c.approach = this.approach ? { ...this.approach } : null;
    c.sidProcedure = this.sidProcedure;
    c.starProcedure = this.starProcedure;
    c.approachProcedure = this.approachProcedure;
    c.cruiseAltFt = this.cruiseAltFt;
    c.descentFpaDeg = this.descentFpaDeg;
    c.cruiseSpeedKt = this.cruiseSpeedKt;
    c.cruiseMach = this.cruiseMach;
    c.legs = this.legs.map((l) => ({ ...l, geom: { ...l.geom } }));
    c.activeLegIndex = this.activeLegIndex;
    c.version = this.version;
    return c;
  }

  /** Marks the plan changed. */
  touch(): void {
    this.version++;
  }

  get activeLeg(): PlanLeg | undefined {
    return this.activeLegIndex >= 0 ? this.legs[this.activeLegIndex] : undefined;
  }

  indexOfLegId(id: number): number {
    return this.legs.findIndex((l) => l.id === id);
  }

  // ------------------------------------------------------------ queries

  /** Makes leg `index` the active leg (e.g. "activate leg" / "activate approach"). */
  activateLeg(index: number): boolean {
    const leg = this.legs[index];
    if (!leg || leg.type === 'DISCO') return false;
    this.activeLegIndex = index;
    this.explicitActive = true;
    this.touch();
    return true;
  }

  /** Index of the published/synthetic final approach fix leg, or -1. */
  get fafIndex(): number {
    for (let i = this.legs.length - 1; i >= 0; i--) if (this.legs[i].segment === 'approach' && this.legs[i].faf) return i;
    return -1;
  }

  /** Index of the missed approach point (last approach-segment leg), or -1. */
  get mapIndex(): number {
    for (let i = this.legs.length - 1; i >= 0; i--) if (this.legs[i].segment === 'approach') return i;
    return -1;
  }

  /** Index of the first missed approach leg, or -1. */
  get firstMissedIndex(): number {
    return this.legs.findIndex((l) => l.segment === 'missed');
  }

  /** Index of the last leg before the missed approach (the destination runway/airport or MAP). */
  get lastNonMissedIndex(): number {
    for (let i = this.legs.length - 1; i >= 0; i--) if (this.legs[i].segment !== 'missed' && this.legs[i].type !== 'DISCO') return i;
    return -1;
  }

  /** Legs of one segment (in order). */
  legsIn(segment: PlanSegment): PlanLeg[] {
    return this.legs.filter((l) => l.segment === segment);
  }

  // ------------------------------------------------------------ segment surgery

  /** Removes legs of `segments` and inserts `newLegs` at the canonical position for `segment`. */
  private replaceSegments(segments: PlanSegment[], segment: PlanSegment, newLegs: PlanLeg[]): void {
    this.legs = this.legs.filter((l) => !segments.includes(l.segment));
    const order = SEGMENT_ORDER[segment];
    let at = this.legs.findIndex((l) => SEGMENT_ORDER[l.segment] > order);
    if (at < 0) at = this.legs.length;
    this.legs.splice(at, 0, ...newLegs);
  }

  /**
   * Normalises segment junctions (merges repeated fixes, discontinuities,
   * IF -> TF connections), clamps the active index and bumps the version.
   */
  normalize(): void {
    const activeId = this.activeLeg?.id;
    const out: PlanLeg[] = [];
    const merged = new Map<number, number>();
    const lastReal = (): PlanLeg | undefined => {
      for (let i = out.length - 1; i >= 0; i--) if (out[i].type !== 'DISCO') return out[i];
      return undefined;
    };
    for (const leg of this.legs) {
      const prevAny = out[out.length - 1];
      if (leg.type === 'DISCO') {
        if (!prevAny || prevAny.type === 'DISCO') continue;
        out.push(leg);
        continue;
      }
      const prev = lastReal();
      if (prev && prevAny && prevAny.type !== 'DISCO' && (prev.type === 'FM' || prev.type === 'VM')) {
        // Vectors (manual termination): always a discontinuity before anything
        // that follows. A manual hold (HM) continues along the route once exited.
        out.push(discoLeg(leg.segment));
      }
      if (prev && (leg.type === 'IF' || leg.type === 'TF') && sameFix(prev.fix, leg.fix) && !isManualLeg(prev.type)) {
        // Repeated fix: merge into the previous leg (later constraints win).
        if (leg.altitude) prev.altitude = leg.altitude;
        if (leg.speed) prev.speed = leg.speed;
        if (leg.iaf) prev.iaf = true;
        if (leg.intermediateFix) prev.intermediateFix = true;
        if (leg.faf) prev.faf = true;
        if (leg.flyOver) prev.flyOver = true;
        merged.set(leg.id, prev.id);
        if (prevAny.type === 'DISCO' && out[out.length - 1] === prevAny) out.pop();
        continue;
      }
      if (leg.type === 'IF' && prev) {
        if (prevAny.type !== 'DISCO') {
          if (this.style === 'boeing') out.push(discoLeg(leg.segment));
          else leg.type = 'TF';
        }
      }
      out.push(leg);
    }
    while (out.length > 0 && out[out.length - 1].type === 'DISCO') out.pop();
    this.legs = out;
    if (activeId !== undefined) {
      let id = activeId;
      while (merged.has(id)) id = merged.get(id)!;
      const i = this.legs.findIndex((l) => l.id === id);
      this.activeLegIndex = i >= 0 ? i : Math.min(Math.max(-1, this.activeLegIndex), this.legs.length - 1);
    }
    if (this.activeLegIndex >= this.legs.length) this.activeLegIndex = this.legs.length - 1;
    this.touch();
  }

  // ------------------------------------------------------------ origin / destination

  private originLeg(): PlanLeg | null {
    const a = this.origin;
    if (!a) return null;
    let fix: Waypoint = { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', airport: a.icao, elevationFt: a.elevationFt };
    if (this.departureRunway) {
      const rw = a.runways.find((r) => normalizeRunwayIdent(r.ident) === this.departureRunway);
      if (rw) {
        const t = runwayThreshold(rw);
        fix = { ident: `RW${this.departureRunway}`, lat: t.lat, lon: t.lon, kind: 'runway', airport: a.icao, elevationFt: rw.elevationFt };
      }
    }
    return makeLeg({ type: 'IF', segment: 'origin', fix, magVar: a.magVar ?? 0 });
  }

  private destinationLeg(): PlanLeg | null {
    const a = this.destination;
    if (!a) return null;
    let fix: Waypoint = { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', airport: a.icao, elevationFt: a.elevationFt };
    if (this.arrivalRunway) {
      const rw = a.runways.find((r) => normalizeRunwayIdent(r.ident) === this.arrivalRunway);
      if (rw) {
        const t = runwayThreshold(rw);
        fix = { ident: `RW${this.arrivalRunway}`, lat: t.lat, lon: t.lon, kind: 'runway', airport: a.icao, elevationFt: rw.elevationFt };
      }
    }
    return makeLeg({ type: 'TF', segment: 'destination', fix, magVar: a.magVar ?? 0 });
  }

  /** Sets the origin airport (clears the departure runway and SID). */
  setOrigin(airport: Airport | null, runway?: string): void {
    this.origin = airport;
    this.departureRunway = runway ? normalizeRunwayIdent(runway) : null;
    this.sid = null;
    this.sidProcedure = null;
    const o = this.originLeg();
    this.replaceSegments(['origin', 'departure'], 'origin', o ? [o] : []);
    this.normalize();
  }

  /** Selects the departure runway; rebuilds the SID runway transition when a SID is loaded. */
  setDepartureRunway(runway: string | null): void {
    this.departureRunway = runway ? normalizeRunwayIdent(runway) : null;
    const o = this.originLeg();
    this.replaceSegments(['origin'], 'origin', o ? [o] : []);
    if (this.sidProcedure && this.sid) this.setSid(this.sidProcedure, undefined, this.sid.enrouteTransition);
    else this.normalize();
  }

  /** Sets the destination airport (clears STAR, approach and arrival runway). */
  setDestination(airport: Airport | null): void {
    this.destination = airport;
    this.arrivalRunway = null;
    this.star = null;
    this.starProcedure = null;
    this.approach = null;
    this.approachProcedure = null;
    const d = this.destinationLeg();
    this.replaceSegments(['arrival', 'approach', 'missed', 'destination'], 'destination', d ? [d] : []);
    this.normalize();
  }

  /** Arrival runway without an approach (visual): the destination leg ends at the threshold. */
  setArrivalRunway(runway: string | null): void {
    this.arrivalRunway = runway ? normalizeRunwayIdent(runway) : null;
    if (!this.approachProcedure) {
      const d = this.destinationLeg();
      this.replaceSegments(['destination'], 'destination', d ? [d] : []);
    }
    if (this.starProcedure && this.star) this.setStar(this.starProcedure, this.star.enrouteTransition);
    else this.normalize();
  }

  setAlternate(airport: Airport | null): void {
    this.alternate = airport;
    this.touch();
  }

  // ------------------------------------------------------------ procedures

  /**
   * Loads a SID: runway transition (explicit, or the one serving the
   * departure runway), common route, and enroute transition.
   */
  setSid(proc: Procedure | null, runwayTransition?: string, enrouteTransition?: string): void {
    if (!proc) {
      this.sid = null;
      this.sidProcedure = null;
      this.replaceSegments(['departure'], 'departure', []);
      this.normalize();
      return;
    }
    const rwT = runwayTransition
      ? findTransition(proc.runwayTransitions, normalizeRunwayIdent(runwayTransition)) ?? findTransition(proc.runwayTransitions, runwayTransition)
      : this.departureRunway
        ? proc.runwayTransitions.find((t) => transitionServesRunway(t.name, this.departureRunway!))
        : proc.runwayTransitions.length === 1
          ? proc.runwayTransitions[0]
          : undefined;
    const enT = findTransition(proc.transitions, enrouteTransition);
    const legs: PlanLeg[] = [];
    const name = proc.ident;
    for (const l of rwT?.legs ?? []) legs.push(legFromProcedure(l, 'departure', name));
    for (const l of proc.commonLegs) legs.push(legFromProcedure(l, 'departure', name));
    for (const l of enT?.legs ?? []) legs.push(legFromProcedure(l, 'departure', name));
    this.sid = { ident: proc.ident, runwayTransition: rwT?.name, enrouteTransition: enT?.name };
    this.sidProcedure = proc;
    this.replaceSegments(['departure'], 'departure', legs);
    this.normalize();
  }

  /** Loads a STAR: enroute transition, common route, runway transition (explicit or serving the arrival runway). */
  setStar(proc: Procedure | null, enrouteTransition?: string, runwayTransition?: string): void {
    if (!proc) {
      this.star = null;
      this.starProcedure = null;
      this.replaceSegments(['arrival'], 'arrival', []);
      this.normalize();
      return;
    }
    const enT = findTransition(proc.transitions, enrouteTransition);
    const rwT = runwayTransition
      ? findTransition(proc.runwayTransitions, normalizeRunwayIdent(runwayTransition)) ?? findTransition(proc.runwayTransitions, runwayTransition)
      : this.arrivalRunway
        ? proc.runwayTransitions.find((t) => transitionServesRunway(t.name, this.arrivalRunway!))
        : proc.runwayTransitions.length === 1
          ? proc.runwayTransitions[0]
          : undefined;
    const legs: PlanLeg[] = [];
    const name = proc.ident;
    for (const l of enT?.legs ?? []) legs.push(legFromProcedure(l, 'arrival', name));
    for (const l of proc.commonLegs) legs.push(legFromProcedure(l, 'arrival', name));
    for (const l of rwT?.legs ?? []) legs.push(legFromProcedure(l, 'arrival', name));
    this.star = { ident: proc.ident, enrouteTransition: enT?.name, runwayTransition: rwT?.name };
    this.starProcedure = proc;
    this.replaceSegments(['arrival'], 'arrival', legs);
    this.normalize();
  }

  /**
   * Loads an approach (optional transition, final, missed approach). The
   * destination leg is replaced by the approach; the arrival runway becomes
   * the approach runway. `null` removes the approach.
   */
  setApproach(proc: Procedure | null, transition?: string): void {
    if (!proc) {
      this.approach = null;
      this.approachProcedure = null;
      const d = this.destinationLeg();
      this.replaceSegments(['approach', 'missed', 'destination'], 'destination', d ? [d] : []);
      this.normalize();
      return;
    }
    const tr = findTransition(proc.transitions, transition);
    const legs: PlanLeg[] = [];
    for (const l of tr?.legs ?? []) legs.push(legFromProcedure(l, 'approach', proc.ident));
    for (const l of proc.finalLegs) legs.push(legFromProcedure(l, 'approach', proc.ident));
    // A transition that starts with a hold-in-lieu-of-procedure-turn (HF/HA) at the IAF: the aircraft first
    // flies to the IAF (ARINC 424 transitions are entered with an IF at the hold fix; some sources omit it).
    // Keep an IF leg into the IAF ahead of the hold so the route, the distance to destination and the TOD
    // include the leg to the IAF, and removing the hold (straight-in) leaves the fix in place.
    const first = legs[0];
    if (first && (first.type === 'HF' || first.type === 'HA') && first.fix) {
      legs.unshift(makeLeg({ type: 'IF', segment: 'approach', procedure: proc.ident, fix: first.fix, altitude: first.altitude, speed: first.speed, iaf: true, magVar: first.magVar }));
    }
    const missed = proc.missedLegs.map((l) => legFromProcedure(l, 'missed', proc.ident));
    this.approach = { ident: proc.ident, enrouteTransition: tr?.name };
    this.approachProcedure = proc;
    if (proc.runways[0]) this.arrivalRunway = proc.runways[0];
    this.replaceSegments(['approach', 'missed', 'destination'], 'approach', legs);
    this.replaceSegments(['missed'], 'missed', missed);
    // Re-pick the STAR runway transition for the new runway.
    if (this.starProcedure && this.star && !this.star.runwayTransition) this.setStar(this.starProcedure, this.star.enrouteTransition);
    else this.normalize();
  }

  // ------------------------------------------------------------ leg editing

  /** Segment for a leg inserted at `index` (enroute between procedures). */
  private segmentAt(index: number): PlanSegment {
    const next = this.legs[index];
    const prev = this.legs[index - 1];
    if (next && prev && next.segment === prev.segment && next.segment !== 'origin' && next.segment !== 'destination') return next.segment;
    return 'enroute';
  }

  /**
   * Inserts a TF leg to `wpt` before `index` (index = legs.length appends).
   * Boeing style: if the waypoint already exists downstream, the legs in
   * between are deleted (the route closes up); otherwise a discontinuity
   * follows the new waypoint. Garmin style connects directly.
   */
  insertWaypoint(index: number, wpt: Waypoint, opts: { segment?: PlanSegment; airway?: string } = {}): PlanLeg {
    const i = Math.max(0, Math.min(index, this.legs.length));
    if (this.style === 'boeing') {
      for (let k = i; k < this.legs.length; k++) {
        if (sameFix(this.legs[k].fix, wpt) && this.legs[k].type !== 'DISCO') {
          this.legs.splice(i, k - i);
          this.normalize();
          return this.legs[i];
        }
      }
    }
    const leg = makeLeg({
      type: 'TF',
      segment: opts.segment ?? this.segmentAt(i),
      fix: wpt,
      airway: opts.airway,
      magVar: this.legs[i - 1]?.magVar ?? this.legs[i]?.magVar ?? this.origin?.magVar ?? 0,
    });
    const add: PlanLeg[] = [leg];
    if (this.style === 'boeing' && i < this.legs.length && this.legs[i].type !== 'DISCO' && !opts.airway) add.push(discoLeg(leg.segment));
    this.legs.splice(i, 0, ...add);
    if (this.activeLegIndex >= i) this.activeLegIndex += add.length;
    this.normalize();
    return leg;
  }

  /** Appends an enroute waypoint before the arrival/approach/destination legs. */
  appendEnrouteWaypoint(wpt: Waypoint, airway?: string): PlanLeg {
    let at = this.legs.findIndex((l) => SEGMENT_ORDER[l.segment] > SEGMENT_ORDER.enroute);
    if (at < 0) at = this.legs.length;
    const leg = makeLeg({ type: 'TF', segment: 'enroute', fix: wpt, airway, magVar: this.legs[at - 1]?.magVar ?? this.origin?.magVar ?? 0 });
    this.legs.splice(at, 0, leg);
    if (this.activeLegIndex >= at) this.activeLegIndex++;
    this.normalize();
    return leg;
  }

  /**
   * Expands `airway` from the fix of leg `entryIndex` to `exitIdent` and
   * inserts the fixes after the entry leg. Returns the inserted legs; throws
   * when the airway does not connect the two fixes.
   */
  insertAirway(entryIndex: number, airway: string, exitIdent: string, db: NavDatabase): PlanLeg[] {
    const entry = this.legs[entryIndex]?.fix;
    if (!entry) throw new Error(`leg ${entryIndex} has no fix to enter ${airway}`);
    const fixes = expandAirway(db, airway, entry, exitIdent);
    const seg: PlanSegment = this.legs[entryIndex].segment === 'destination' ? 'enroute' : this.legs[entryIndex].segment === 'origin' ? 'enroute' : this.legs[entryIndex].segment;
    const legs = fixes.map((w) => makeLeg({ type: 'TF', segment: seg, fix: w, airway, magVar: this.legs[entryIndex].magVar }));
    this.legs.splice(entryIndex + 1, 0, ...legs);
    if (this.activeLegIndex > entryIndex) this.activeLegIndex += legs.length;
    this.normalize();
    return legs;
  }

  /**
   * Deletes leg `index`. Deleting a discontinuity connects the next leg
   * directly (its IF becomes a TF). The route closes up in both styles.
   */
  deleteLeg(index: number): void {
    const leg = this.legs[index];
    if (!leg) return;
    if (leg.type === 'DISCO') {
      const next = this.legs[index + 1];
      if (next && next.type === 'IF') next.type = 'TF';
    }
    this.legs.splice(index, 1);
    if (this.activeLegIndex > index) this.activeLegIndex--;
    else if (this.activeLegIndex === index) this.activeLegIndex = Math.min(index, this.legs.length - 1);
    this.normalize();
  }

  /** Sets (or clears with null) the altitude constraint of a leg (pilot entry). */
  setAltitudeConstraint(index: number, c: AltitudeConstraint | null): void {
    const leg = this.legs[index];
    if (!leg || leg.type === 'DISCO') return;
    leg.altitude = c ?? undefined;
    leg.userConstraint = true;
    this.touch();
  }

  /** Sets (or clears with null) the speed constraint of a leg (pilot entry). */
  setSpeedConstraint(index: number, c: SpeedConstraint | null): void {
    const leg = this.legs[index];
    if (!leg || leg.type === 'DISCO') return;
    leg.speed = c ?? undefined;
    leg.userConstraint = true;
    this.touch();
  }

  /**
   * Inserts a manual-termination hold (HM) at the fix of leg `index` (after
   * it). An existing hold at that fix is replaced. Returns the hold leg.
   */
  insertHold(index: number, p: HoldParams = {}): PlanLeg | null {
    const at = this.legs[index];
    if (!at || !at.fix) return null;
    if (this.legs[index + 1] && (this.legs[index + 1].type === 'HM' || this.legs[index + 1].type === 'HF' || this.legs[index + 1].type === 'HA') && sameFix(this.legs[index + 1].fix, at.fix)) {
      this.legs.splice(index + 1, 1);
    }
    const inboundTrue = Number.isFinite(at.geom.finalCourseTrue) ? at.geom.finalCourseTrue : NaN;
    const course = p.inboundCourseMag ?? (Number.isFinite(inboundTrue) ? (((inboundTrue - at.magVar) % 360) + 360) % 360 : 0);
    const hold = makeLeg({
      type: 'HM',
      segment: at.segment === 'origin' ? 'enroute' : at.segment,
      fix: at.fix,
      flyOver: true,
      turnDirection: p.turnDirection ?? 'R',
      course,
      holdTimeMin: p.legDistanceNm === undefined ? p.legTimeMin : undefined,
      distanceNm: p.legDistanceNm,
      altitude: at.altitude,
      magVar: at.magVar,
      userConstraint: true,
    });
    this.legs.splice(index + 1, 0, hold);
    if (this.activeLegIndex > index) this.activeLegIndex++;
    this.normalize();
    return hold;
  }

  /**
   * Direct-to (from present position). `target` is a leg index in this plan
   * or a waypoint. For an in-plan target the leg becomes a DF (or a CF when a
   * course is given: "direct-to with course" / Boeing intercept course);
   * Boeing style deletes the legs before it. An off-plan waypoint is inserted
   * before the active leg followed by a discontinuity.
   */
  directTo(target: number | Waypoint, fromLat: number, fromLon: number, courseMag?: number): PlanLeg | null {
    let i: number;
    if (typeof target === 'number') {
      i = target;
      const leg = this.legs[i];
      if (!leg || !leg.fix || leg.type === 'DISCO') return null;
      if (this.style === 'boeing' && i > 0) {
        this.legs.splice(0, i);
        i = 0;
      }
    } else {
      i = Math.max(0, this.activeLegIndex);
      const seg: PlanSegment = this.legs[i]?.segment ?? 'enroute';
      const leg = makeLeg({ type: 'TF', segment: seg === 'origin' ? 'enroute' : seg, fix: target, magVar: this.legs[i]?.magVar ?? 0 });
      this.legs.splice(i, 0, leg, discoLeg(leg.segment));
    }
    const leg = this.legs[i];
    if (courseMag !== undefined) {
      leg.type = 'CF';
      leg.course = courseMag;
      leg.courseIsTrue = false;
    } else {
      leg.type = 'DF';
    }
    leg.dfStartLat = fromLat;
    leg.dfStartLon = fromLon;
    this.activeLegIndex = i;
    this.normalize();
    // Re-find the leg: normalisation may have shifted indices.
    this.activeLegIndex = this.indexOfLegId(leg.id);
    this.explicitActive = true;
    return leg;
  }
}
