/**
 * VNAV descent path construction (geometric path, Garmin-style fixed flight
 * path angle) from the plan's altitude constraints.
 *
 * Working backward from the end of descent (the last constrained point: MAP /
 * runway threshold + TCH, or the destination), each segment descends at the
 * descent angle (default 3.0 deg, or the procedure's coded vertical angle for
 * the final approach segment):
 *   - where the constant-angle line would pass ABOVE an "at or below" limit,
 *     the path levels at that limit and starts the descent later (the
 *     aircraft reaches each constraint at the waypoint);
 *   - where it would pass BELOW an "at or above" limit, a steeper geometric
 *     segment joins the two constraints (flagged `unable` above `maxFpaDeg`);
 *   - otherwise the line passes straight through.
 * The top of descent is where the path meets the cruise altitude.
 *
 * SCOPE: no idle-thrust energy path, deceleration segments or wind/ISA
 * corrections (a Boeing FMC computes an idle path; Garmin VNAV, as modelled,
 * flies a fixed angle).
 */
import type { FlightPlan } from '../flightplan/FlightPlan';
import type { PlanLeg } from '../flightplan/types';

export const FT_PER_NM = 6076.12;

/** Default descent flight path angle (deg): Garmin VNAV default 3.0, AIM 5-4-5 standard glidepath. */
export const DEFAULT_DESCENT_FPA_DEG = 3.0;
/** Steepest geometric segment accepted without the unable flag (deg). EST: 6 deg (steep-approach limit). */
export const DEFAULT_MAX_FPA_DEG = 6.0;
/** EST: end-of-descent height above a destination airport without an approach or runway (ft AGL, typical pattern altitude). */
export const DEST_EOD_HEIGHT_FT = 1500;
/** EST: threshold crossing height when a runway fix carries no altitude (ft). */
export const DEFAULT_TCH_FT = 50;

export interface VnavProfile {
  valid: boolean;
  /** Breakpoint along-plan distances (nm, ascending) and altitudes (ft). */
  s: number[];
  alt: number[];
  /** Top of descent: along-plan distance (nm) or NaN when the path never reaches cruise. */
  todDistNm: number;
  /** End of descent: along-plan distance (nm) and altitude (ft). */
  eodDistNm: number;
  eodAltFt: number;
  eodLegIndex: number;
  cruiseAltFt: number;
  /** Leg index of the first constraint that needs more than `maxFpaDeg`, or -1. */
  unableLegIndex: number;
}

export function emptyProfile(): VnavProfile {
  return { valid: false, s: [], alt: [], todDistNm: NaN, eodDistNm: NaN, eodAltFt: NaN, eodLegIndex: -1, cruiseAltFt: 0, unableLegIndex: -1 };
}

function eligible(leg: PlanLeg): boolean {
  return leg.type !== 'DISCO' && leg.segment !== 'origin' && leg.segment !== 'departure' && leg.segment !== 'missed' && leg.geom.valid;
}

/** End-of-descent altitude of a leg with no coded altitude (runway threshold + TCH, or airport + pattern height). */
function impliedEodAlt(leg: PlanLeg): number {
  const f = leg.fix;
  if (!f) return NaN;
  const elev = f.elevationFt ?? NaN;
  if (!Number.isFinite(elev)) return NaN;
  if (f.kind === 'runway') return elev + DEFAULT_TCH_FT;
  if (f.kind === 'airport') return elev + DEST_EOD_HEIGHT_FT;
  return NaN;
}

/**
 * Builds the descent profile into `out`. `cruiseAltFt` is the level the
 * descent starts from; `fpaDeg` the default angle.
 */
export function computeDescentProfile(
  plan: FlightPlan,
  cruiseAltFt: number,
  fpaDeg = DEFAULT_DESCENT_FPA_DEG,
  maxFpaDeg = DEFAULT_MAX_FPA_DEG,
  out: VnavProfile = emptyProfile(),
): VnavProfile {
  out.valid = false;
  out.s.length = 0;
  out.alt.length = 0;
  out.todDistNm = NaN;
  out.unableLegIndex = -1;
  out.cruiseAltFt = cruiseAltFt;
  const legs = plan.legs;
  // End of descent: the last eligible leg with a usable altitude.
  let e = -1;
  let eAlt = NaN;
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i];
    if (!eligible(l)) continue;
    const c = l.altitude;
    let a = NaN;
    if (c) a = c.kind === 'atOrAbove' ? (c.lowerFt ?? NaN) : (c.upperFt ?? c.lowerFt ?? NaN);
    if (!Number.isFinite(a) && (l.segment === 'approach' || l.segment === 'destination')) a = impliedEodAlt(l);
    if (Number.isFinite(a)) {
      e = i;
      eAlt = a;
      break;
    }
  }
  if (e < 0 || !(cruiseAltFt > eAlt)) {
    out.eodLegIndex = e;
    out.eodAltFt = eAlt;
    out.eodDistNm = e >= 0 ? legs[e].geom.cumDistNm : NaN;
    return out;
  }
  const rs: number[] = [];
  const ra: number[] = [];
  let curS = legs[e].geom.cumDistNm;
  let curAlt = eAlt;
  let curIdx = e;
  rs.push(curS);
  ra.push(curAlt);
  const maxSlope = Math.tan((maxFpaDeg * Math.PI) / 180) * FT_PER_NM;
  let reachedCruise = false;
  for (let j = e - 1; j >= 0 && !reachedCruise; j--) {
    const l = legs[j];
    if (!eligible(l)) continue;
    const angle = legs[curIdx].verticalAngleDeg ?? fpaDeg;
    const g = Math.tan((angle * Math.PI) / 180) * FT_PER_NM;
    const sj = l.geom.cumDistNm;
    if (!(sj < curS)) continue;
    const aGeo = curAlt + (curS - sj) * g;
    if (aGeo >= cruiseAltFt) {
      reachedCruise = true;
      break;
    }
    const c = l.altitude;
    if (!c) continue;
    const lo = c.lowerFt ?? -Infinity;
    const hi = c.upperFt ?? Infinity;
    if (aGeo > hi) {
      const sBreak = curS - (hi - curAlt) / g;
      rs.push(sBreak, sj);
      ra.push(hi, hi);
      curS = sj;
      curAlt = hi;
    } else if (aGeo < lo) {
      if ((lo - curAlt) / (curS - sj) > maxSlope && out.unableLegIndex < 0) out.unableLegIndex = j;
      rs.push(sj);
      ra.push(lo);
      curS = sj;
      curAlt = lo;
    } else {
      rs.push(sj);
      ra.push(aGeo);
      curS = sj;
      curAlt = aGeo;
    }
    curIdx = j;
  }
  // Top of descent from the last point at the angle of the segment before it.
  const angle = legs[curIdx].verticalAngleDeg ?? fpaDeg;
  const g = Math.tan((angle * Math.PI) / 180) * FT_PER_NM;
  const tod = curS - (cruiseAltFt - curAlt) / g;
  rs.push(tod);
  ra.push(cruiseAltFt);
  out.todDistNm = tod;
  for (let k = rs.length - 1; k >= 0; k--) {
    out.s.push(rs[k]);
    out.alt.push(ra[k]);
  }
  out.eodDistNm = legs[e].geom.cumDistNm;
  out.eodAltFt = eAlt;
  out.eodLegIndex = e;
  out.valid = true;
  return out;
}

/** Path altitude (ft) at an along-plan distance (cruise before TOD, EOD altitude after EOD). */
export function profileAltitudeAt(p: VnavProfile, s: number): number {
  if (!p.valid || p.s.length === 0) return NaN;
  const n = p.s.length;
  if (s <= p.s[0]) return p.alt[0];
  if (s >= p.s[n - 1]) return p.alt[n - 1];
  for (let k = 1; k < n; k++) {
    if (s <= p.s[k]) {
      const s0 = p.s[k - 1];
      const s1 = p.s[k];
      const t = s1 > s0 ? (s - s0) / (s1 - s0) : 1;
      return p.alt[k - 1] + (p.alt[k] - p.alt[k - 1]) * t;
    }
  }
  return p.alt[n - 1];
}

/** Descent distance (nm) to lose `deltaFt` at `fpaDeg`. */
export function descentDistanceNm(deltaFt: number, fpaDeg = DEFAULT_DESCENT_FPA_DEG): number {
  return deltaFt / (Math.tan((fpaDeg * Math.PI) / 180) * FT_PER_NM);
}
