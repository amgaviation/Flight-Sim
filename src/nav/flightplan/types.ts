/**
 * Flight plan data model shared by the plan editor (`FlightPlan`), geometry
 * builder, route parser and the FMS guidance (`nav/fms`).
 */
import type { LegType, ProcedureLeg } from '../types';

/** Where a leg came from; drives CDI scaling, VNAV phase and editing rules. */
export type PlanSegment = 'origin' | 'departure' | 'enroute' | 'arrival' | 'approach' | 'missed' | 'destination';

/** Leg type in a plan: an ARINC path terminator, or a route discontinuity marker. */
export type PlanLegType = LegType | 'DISCO';

/**
 * Computed path of one leg (filled by `computePlanGeometry`, reused in place;
 * never replaced so references stay valid). Positions in degrees, distances
 * in nm, courses in degrees TRUE.
 */
export interface LegGeometry {
  /** False when the leg could not be built (missing coordinates, unsupported data). */
  valid: boolean;
  /**
   * 'none'    no path (IF, discontinuity, or first leg)
   * 'gc'      great-circle segment start -> end
   * 'arc'     constant-radius arc (RF, AF)
   * 'heading' heading leg (V*): flown on heading, path is a no-wind prediction
   * 'hold'    racetrack at the fix (HA/HF/HM)
   * 'pt'      procedure turn (PI)
   */
  kind: 'none' | 'gc' | 'arc' | 'heading' | 'hold' | 'pt';
  startLat: number;
  startLon: number;
  /** Terminator (fix or predicted termination point). */
  endLat: number;
  endLon: number;
  /** Initial and final course along the path (deg true). */
  courseTrue: number;
  finalCourseTrue: number;
  /** Path length (nm). Holds: one circuit for HF/HA, 0 for HM. */
  lengthNm: number;
  /** True when the end point is a prediction (altitude / DME / intercept / radial terminations). */
  endEstimated: boolean;
  /** Manual termination (FM, VM, HM): the leg never sequences by itself. */
  unbounded: boolean;
  // --- arc (RF / AF) and hold parameters
  centerLat: number;
  centerLon: number;
  radiusNm: number;
  /** +1 right (clockwise), -1 left (counter-clockwise). */
  turnDir: number;
  /** Arc: bearing from centre to the start point (deg true) and swept angle (deg, > 0). */
  startRadial: number;
  sweepDeg: number;
  /** Hold: inbound course (deg true) and leg length (nm). */
  holdInboundTrue: number;
  holdLegNm: number;
  // --- fly-by transition from this leg into the next
  turnValid: boolean;
  turnRadiusNm: number;
  /** Distance before the fix at which the turn starts (nm). */
  turnAnticipationNm: number;
  /** Signed track change (deg, + = right). */
  turnAngleDeg: number;
  turnCenterLat: number;
  turnCenterLon: number;
  turnStartLat: number;
  turnStartLon: number;
  turnEndLat: number;
  turnEndLon: number;
  // --- plan-level accumulations
  /** Along-plan distance from the first leg to this leg's end (nm). */
  cumDistNm: number;
  /** VNAV predicted altitude at the leg end (ft), NaN when unknown. */
  predictedAltFt: number;
}

/** A leg of a flight plan: a procedure leg plus plan bookkeeping. */
export interface PlanLeg extends Omit<ProcedureLeg, 'type'> {
  /** Unique id; preserved by `FlightPlan.clone()` so the active leg survives EXEC. */
  readonly id: number;
  type: PlanLegType;
  segment: PlanSegment;
  /** Procedure the leg belongs to, e.g. 'RUUDY6' / 'R06-Y'. */
  procedure?: string;
  /** Airway the leg was expanded from (enroute legs). */
  airway?: string;
  /** True when the altitude or speed constraint was entered by the pilot. */
  userConstraint?: boolean;
  /** Runtime: start point of a DF leg, captured when it became active (direct-to from present position). */
  dfStartLat?: number;
  dfStartLon?: number;
  /** Computed geometry (see `LegGeometry`). */
  readonly geom: LegGeometry;
}

/** A selected procedure with its transitions. */
export interface ProcedureSelection {
  ident: string;
  runwayTransition?: string;
  enrouteTransition?: string;
}

/** Hold parameters for `FlightPlan.insertHold`. */
export interface HoldParams {
  /** Inbound course (deg magnetic); default: the course of the leg arriving at the fix. */
  inboundCourseMag?: number;
  turnDirection?: 'L' | 'R';
  /** Leg length by time (min) or distance (nm); default time per AIM 5-3-8 (1 min <= 14,000 ft, 1.5 min above). */
  legTimeMin?: number;
  legDistanceNm?: number;
}

export function emptyGeometry(): LegGeometry {
  return {
    valid: false,
    kind: 'none',
    startLat: NaN,
    startLon: NaN,
    endLat: NaN,
    endLon: NaN,
    courseTrue: NaN,
    finalCourseTrue: NaN,
    lengthNm: 0,
    endEstimated: false,
    unbounded: false,
    centerLat: NaN,
    centerLon: NaN,
    radiusNm: 0,
    turnDir: 0,
    startRadial: 0,
    sweepDeg: 0,
    holdInboundTrue: 0,
    holdLegNm: 0,
    turnValid: false,
    turnRadiusNm: 0,
    turnAnticipationNm: 0,
    turnAngleDeg: 0,
    turnCenterLat: NaN,
    turnCenterLon: NaN,
    turnStartLat: NaN,
    turnStartLon: NaN,
    turnEndLat: NaN,
    turnEndLon: NaN,
    cumDistNm: 0,
    predictedAltFt: NaN,
  };
}

/** True for leg types that terminate at their fix (the aircraft flies to the fix). */
export function endsAtFix(t: PlanLegType): boolean {
  return t === 'IF' || t === 'TF' || t === 'CF' || t === 'DF' || t === 'RF' || t === 'AF' || t === 'HF' || t === 'HA' || t === 'HM' || t === 'PI';
}

/** True for heading legs (flown on heading, not track). */
export function isHeadingLeg(t: PlanLegType): boolean {
  return t === 'VA' || t === 'VD' || t === 'VI' || t === 'VM' || t === 'VR';
}

/** True for hold legs. */
export function isHoldLeg(t: PlanLegType): boolean {
  return t === 'HA' || t === 'HF' || t === 'HM';
}

/** True for manual-termination legs (never sequence on their own). */
export function isManualLeg(t: PlanLegType): boolean {
  return t === 'FM' || t === 'VM' || t === 'HM';
}
