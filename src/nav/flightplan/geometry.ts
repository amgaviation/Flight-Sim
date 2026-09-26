/**
 * Plan geometry: predicted path of every leg (great circles, course lines,
 * arcs, holds, heading legs), fly-by turn transitions and cumulative
 * distances. `computePlanGeometry` fills each leg's `geom` in place and does
 * not allocate per leg (it may allocate a few scratch objects per call; the
 * FMS calls it at ~1 Hz and on plan changes).
 *
 * Turn anticipation (fly-by): R = V^2 / (g tan(phi)), anticipation distance
 * d = R tan(|dpsi|/2) (ARINC 424 Att. 2 / RTCA DO-236C 3.2.5.4.1 fly-by
 * transition). EST: phi = min(bank limit, max(5 deg, |dpsi|/2)), bank limit
 * 25 deg below FL195 and 15 deg above (DO-236 uses half the track change up
 * to about 23 deg at low altitude and a reduced bank at high altitude; the
 * 25 deg figure matches AC 20-138D App. 7 RF testing bank and typical FMS
 * LNAV bank limits). Track changes above 135 deg are flown as fly-over.
 *
 * Hold turns: standard rate (3 deg/s) or 25 deg bank, whichever is less
 * (AIM 5-3-8 b.3 (i)). Hold leg time 1 min at or below 14,000 ft MSL,
 * 1.5 min above (AIM 5-3-8 j.2) when the procedure codes none.
 */
import { destinationPoint, distanceNm, initialBearing, finalBearing, courseIntersection, type LatLon } from '../../core/geo';
import { wrap180, wrap360, DEG2RAD } from '../../core/math';
import type { FlightPlan } from './FlightPlan';
import type { LegGeometry, PlanLeg } from './types';
import { legCourseTrue } from '../procedures';

const G = 9.80665;
const KT_TO_MS = 1852 / 3600;
const M_TO_NM = 1 / 1852;

export interface GeometryParams {
  /** Ground speed (kt) for turn radii and time-based hold legs; defaults to 250 when <= 0. */
  groundSpeedKt: number;
  /** Altitude (ft) at the start of the plan (or of the active leg) for altitude-terminated legs. */
  startAltFt: number;
  /** Predicted climb gradient (ft/nm) for CA/FA/VA/HA leg lengths. EST default 500 (jet ~2000 fpm at 250 kt; 172 ~700 fpm at 75 kt). */
  climbGradientFtPerNm?: number;
  /** Fly-by bank limit (deg) below FL195. Default 25. */
  bankLimitDeg?: number;
  /** Altitude used to pick the high-altitude bank limit (ft). */
  cruiseAltFt?: number;
}

/** Fly-by turn radius (nm) for a ground speed and bank angle. */
export function turnRadiusNm(gsKt: number, bankDeg: number): number {
  const v = Math.max(30, gsKt) * KT_TO_MS;
  return ((v * v) / (G * Math.tan(Math.max(1, bankDeg) * DEG2RAD))) * M_TO_NM;
}

/** Standard-rate (3 deg/s) turn radius, limited to 25 deg bank (AIM 5-3-8), nm. */
export function holdTurnRadiusNm(gsKt: number): number {
  const v = Math.max(30, gsKt) * KT_TO_MS;
  const rStd = (v / (3 * DEG2RAD)) * M_TO_NM;
  return Math.max(rStd, turnRadiusNm(gsKt, 25));
}

/** Default hold leg time (min): 1 at or below 14,000 ft MSL, 1.5 above (AIM 5-3-8 j.2). */
export function defaultHoldMinutes(altFt: number): number {
  return altFt > 14000 ? 1.5 : 1;
}

const scratchA: LatLon = { lat: 0, lon: 0 };
const scratchB: LatLon = { lat: 0, lon: 0 };

function resetGeom(g: LegGeometry): void {
  g.valid = false;
  g.kind = 'none';
  g.startLat = NaN;
  g.startLon = NaN;
  g.endLat = NaN;
  g.endLon = NaN;
  g.courseTrue = NaN;
  g.finalCourseTrue = NaN;
  g.lengthNm = 0;
  g.endEstimated = false;
  g.unbounded = false;
  g.centerLat = NaN;
  g.centerLon = NaN;
  g.radiusNm = 0;
  g.turnDir = 0;
  g.startRadial = 0;
  g.sweepDeg = 0;
  g.holdInboundTrue = 0;
  g.holdLegNm = 0;
  g.turnValid = false;
  g.turnRadiusNm = 0;
  g.turnAnticipationNm = 0;
  g.turnAngleDeg = 0;
}

function setGc(g: LegGeometry, aLat: number, aLon: number, bLat: number, bLon: number): void {
  g.kind = 'gc';
  g.startLat = aLat;
  g.startLon = aLon;
  g.endLat = bLat;
  g.endLon = bLon;
  const d = distanceNm(aLat, aLon, bLat, bLon);
  g.lengthNm = d;
  if (d > 1e-6) {
    g.courseTrue = initialBearing(aLat, aLon, bLat, bLon);
    g.finalCourseTrue = finalBearing(aLat, aLon, bLat, bLon);
  }
  g.valid = true;
}

function setCourseLine(g: LegGeometry, aLat: number, aLon: number, crs: number, len: number, heading: boolean): void {
  const e = destinationPoint(aLat, aLon, crs, Math.max(0.01, len), scratchA);
  setGc(g, aLat, aLon, e.lat, e.lon);
  g.courseTrue = crs;
  if (heading) g.kind = 'heading';
}

function fixOk(leg: PlanLeg): boolean {
  return !!leg.fix && Number.isFinite(leg.fix.lat) && Number.isFinite(leg.fix.lon);
}

/** Along-course distance (nm) from (lat, lon) on `crs` to where the distance to (nLat, nLon) equals `dme`; NaN if never. */
export function distanceToDme(lat: number, lon: number, crs: number, nLat: number, nLon: number, dme: number): number {
  const f = (s: number): number => {
    const p = destinationPoint(lat, lon, crs, s, scratchB);
    return distanceNm(p.lat, p.lon, nLat, nLon) - dme;
  };
  let s0 = 0;
  let f0 = f(0);
  if (Math.abs(f0) < 1e-6) return 0;
  for (let s = 0.5; s <= 250; s += 0.5) {
    const f1 = f(s);
    if (Math.sign(f1) !== Math.sign(f0)) {
      let lo = s0;
      let hi = s;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(f(mid)) === Math.sign(f0)) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    s0 = s;
    f0 = f1;
  }
  return NaN;
}

/** Course (deg true) a leg flies inbound to its start, used for intercepts and turn geometry. */
function nextInboundCourse(next: PlanLeg): number {
  const g = next.geom;
  if (next.type === 'CF' || next.type === 'FA' || next.type === 'FC' || next.type === 'FD' || next.type === 'FM') {
    const c = legCourseTrue(next);
    if (Number.isFinite(c)) return c;
  }
  return g.courseTrue;
}

/**
 * Computes every leg's geometry and the fly-by transitions. Returns the total
 * plan length (nm, manual-termination legs count 0).
 */
export function computePlanGeometry(plan: FlightPlan, p: GeometryParams): number {
  const legs = plan.legs;
  const gs = p.groundSpeedKt > 0 ? p.groundSpeedKt : 250;
  const grad = p.climbGradientFtPerNm ?? 500;
  let pLat = NaN;
  let pLon = NaN;
  let alt = p.startAltFt;
  let cum = 0;
  const maxAlt = p.cruiseAltFt && p.cruiseAltFt > 0 ? p.cruiseAltFt : 60000;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const g = leg.geom;
    resetGeom(g);
    const known = Number.isFinite(pLat) && Number.isFinite(pLon);
    const ct = legCourseTrue(leg);
    switch (leg.type) {
      case 'DISCO':
        g.valid = true;
        pLat = NaN;
        pLon = NaN;
        break;
      case 'IF':
        if (fixOk(leg)) {
          // An IF flown as the active leg (plan start, after a discontinuity) is a direct-to from where it was activated.
          if (leg.dfStartLat !== undefined && leg.dfStartLon !== undefined && distanceNm(leg.dfStartLat, leg.dfStartLon, leg.fix!.lat, leg.fix!.lon) > 1e-4) {
            setGc(g, leg.dfStartLat, leg.dfStartLon, leg.fix!.lat, leg.fix!.lon);
            break;
          }
          g.valid = true;
          g.startLat = g.endLat = leg.fix!.lat;
          g.startLon = g.endLon = leg.fix!.lon;
        }
        break;
      case 'TF':
        if (!fixOk(leg)) break;
        if (known && distanceNm(pLat, pLon, leg.fix!.lat, leg.fix!.lon) > 1e-4) setGc(g, pLat, pLon, leg.fix!.lat, leg.fix!.lon);
        else if (!known && leg.dfStartLat !== undefined && leg.dfStartLon !== undefined && distanceNm(leg.dfStartLat, leg.dfStartLon, leg.fix!.lat, leg.fix!.lon) > 1e-4) {
          // TF without a defined start (after a discontinuity) activated as a direct-to.
          setGc(g, leg.dfStartLat, leg.dfStartLon, leg.fix!.lat, leg.fix!.lon);
        } else {
          g.valid = true;
          g.startLat = g.endLat = leg.fix!.lat;
          g.startLon = g.endLon = leg.fix!.lon;
        }
        break;
      case 'DF': {
        if (!fixOk(leg)) break;
        const sLat = leg.dfStartLat ?? pLat;
        const sLon = leg.dfStartLon ?? pLon;
        if (Number.isFinite(sLat) && distanceNm(sLat, sLon, leg.fix!.lat, leg.fix!.lon) > 1e-4) setGc(g, sLat, sLon, leg.fix!.lat, leg.fix!.lon);
        else {
          g.valid = true;
          g.startLat = g.endLat = leg.fix!.lat;
          g.startLon = g.endLon = leg.fix!.lon;
        }
        break;
      }
      case 'CF': {
        if (!fixOk(leg) || !Number.isFinite(ct)) break;
        const f = leg.fix!;
        const toFix = known ? distanceNm(pLat, pLon, f.lat, f.lon) : NaN;
        const len = Math.max(leg.distanceNm ?? 0, Number.isFinite(toFix) ? toFix : 5, 0.5);
        const s = destinationPoint(f.lat, f.lon, ct + 180, len, scratchA);
        setGc(g, s.lat, s.lon, f.lat, f.lon);
        g.courseTrue = ct;
        g.finalCourseTrue = ct;
        if (Number.isFinite(toFix)) g.lengthNm = toFix;
        break;
      }
      case 'FA':
      case 'FC':
      case 'FD':
      case 'FM': {
        if (!fixOk(leg) || !Number.isFinite(ct)) break;
        const f = leg.fix!;
        let len = 0;
        if (leg.type === 'FA') {
          const target = leg.altitude?.lowerFt ?? leg.altitude?.upperFt ?? alt;
          len = Math.max(0.5, (target - alt) / grad);
          g.endEstimated = true;
        } else if (leg.type === 'FC') len = leg.distanceNm ?? 1;
        else if (leg.type === 'FD') {
          const n = leg.recommendedNavaid;
          len = n && leg.distanceNm !== undefined ? distanceToDme(f.lat, f.lon, ct, n.lat, n.lon, leg.distanceNm) : NaN;
          if (!Number.isFinite(len)) len = leg.distanceNm ?? 5;
          g.endEstimated = true;
        } else {
          len = 20; // display length only
          g.unbounded = true;
        }
        setCourseLine(g, f.lat, f.lon, ct, len, false);
        if (g.unbounded) g.lengthNm = 0;
        break;
      }
      case 'CA':
      case 'VA':
      case 'CD':
      case 'VD':
      case 'CI':
      case 'VI':
      case 'CR':
      case 'VR':
      case 'VM': {
        if (!known || !Number.isFinite(ct)) break;
        const heading = leg.type[0] === 'V';
        let len = 1;
        const t = leg.type[1];
        if (t === 'A') {
          const target = leg.altitude?.lowerFt ?? leg.altitude?.upperFt ?? alt;
          len = Math.max(0.5, (target - alt) / grad);
          g.endEstimated = true;
        } else if (t === 'D') {
          const n = leg.recommendedNavaid;
          len = n && leg.distanceNm !== undefined ? distanceToDme(pLat, pLon, ct, n.lat, n.lon, leg.distanceNm) : NaN;
          if (!Number.isFinite(len)) len = 3;
          g.endEstimated = true;
        } else if (t === 'I') {
          len = 5;
          g.endEstimated = true;
          const next = legs[i + 1];
          if (next && fixOk(next)) {
            const nc = next.course !== undefined ? legCourseTrue(next) : initialBearing(pLat, pLon, next.fix!.lat, next.fix!.lon);
            if (Number.isFinite(nc) && courseIntersection(pLat, pLon, ct, next.fix!.lat, next.fix!.lon, nc + 180, scratchB)) {
              const d = distanceNm(pLat, pLon, scratchB.lat, scratchB.lon);
              if (d < 200) len = Math.max(0.1, d);
            }
          }
        } else if (t === 'R') {
          len = 5;
          g.endEstimated = true;
          const n = leg.recommendedNavaid;
          if (n && leg.theta !== undefined && Number.isFinite(n.lat)) {
            const radial = wrap360(leg.theta + (n.declination ?? leg.magVar));
            if (courseIntersection(pLat, pLon, ct, n.lat, n.lon, radial, scratchB)) {
              const d = distanceNm(pLat, pLon, scratchB.lat, scratchB.lon);
              if (d < 200) len = Math.max(0.1, d);
            }
          }
        } else {
          len = 20;
          g.unbounded = true;
        }
        setCourseLine(g, pLat, pLon, ct, len, heading);
        if (g.unbounded) g.lengthNm = 0;
        break;
      }
      case 'RF':
      case 'AF': {
        if (!fixOk(leg)) break;
        const c = leg.type === 'RF' ? leg.arcCenter : leg.recommendedNavaid;
        if (!c || !Number.isFinite(c.lat) || !known) {
          if (known) setGc(g, pLat, pLon, leg.fix!.lat, leg.fix!.lon);
          break;
        }
        const f = leg.fix!;
        const r = leg.type === 'RF' ? leg.arcRadiusNm ?? distanceNm(c.lat, c.lon, f.lat, f.lon) : leg.rho ?? distanceNm(c.lat, c.lon, f.lat, f.lon);
        const dir = leg.turnDirection === 'L' ? -1 : 1;
        const a0 = initialBearing(c.lat, c.lon, pLat, pLon);
        const a1 = initialBearing(c.lat, c.lon, f.lat, f.lon);
        const sweep = dir > 0 ? wrap360(a1 - a0) : wrap360(a0 - a1);
        g.kind = 'arc';
        g.valid = true;
        g.centerLat = c.lat;
        g.centerLon = c.lon;
        g.radiusNm = r;
        g.turnDir = dir;
        g.startRadial = a0;
        g.sweepDeg = sweep;
        g.startLat = pLat;
        g.startLon = pLon;
        g.endLat = f.lat;
        g.endLon = f.lon;
        g.courseTrue = wrap360(a0 + dir * 90);
        g.finalCourseTrue = wrap360(a1 + dir * 90);
        g.lengthNm = r * sweep * DEG2RAD;
        break;
      }
      case 'HA':
      case 'HF':
      case 'HM': {
        if (!fixOk(leg)) break;
        const f = leg.fix!;
        const inbound = Number.isFinite(ct) ? ct : known ? initialBearing(pLat, pLon, f.lat, f.lon) : 0;
        const r = holdTurnRadiusNm(Math.min(gs, holdSpeedLimitKt(alt) * 1.1));
        const legNm = leg.distanceNm ?? ((leg.holdTimeMin ?? defaultHoldMinutes(alt)) / 60) * Math.min(gs, holdSpeedLimitKt(alt) * 1.1);
        g.kind = 'hold';
        g.valid = true;
        g.startLat = g.endLat = f.lat;
        g.startLon = g.endLon = f.lon;
        g.holdInboundTrue = inbound;
        g.holdLegNm = legNm;
        g.radiusNm = r;
        g.turnDir = leg.turnDirection === 'L' ? -1 : 1;
        g.courseTrue = inbound;
        g.finalCourseTrue = inbound;
        g.lengthNm = leg.type === 'HM' ? 0 : 2 * legNm + 2 * Math.PI * r;
        g.unbounded = leg.type === 'HM';
        break;
      }
      case 'PI': {
        if (!fixOk(leg) || !Number.isFinite(ct)) break;
        const f = leg.fix!;
        g.kind = 'pt';
        g.valid = true;
        g.startLat = g.endLat = f.lat;
        g.startLon = g.endLon = f.lon;
        g.courseTrue = ct;
        g.radiusNm = turnRadiusNm(Math.min(gs, 200), 25);
        g.turnDir = leg.turnDirection === 'L' ? -1 : 1;
        // EST: 2 min outbound total + 180 deg turn back to the fix.
        g.lengthNm = 2 * (2 * gs) / 60 + Math.PI * g.radiusNm;
        // After the reversal the aircraft heads back along the reciprocal of the outbound 45 deg leg.
        g.finalCourseTrue = wrap360(ct + 180);
        break;
      }
    }
    if (g.valid && leg.type !== 'DISCO') {
      if (Number.isFinite(g.endLat)) {
        pLat = g.endLat;
        pLon = g.endLon;
      }
      if (g.unbounded && leg.type !== 'HM') {
        // Manual termination: the following leg has no defined start.
        pLat = NaN;
        pLon = NaN;
      }
    } else if (!g.valid) {
      // Unknown path: continue from the fix if there is one.
      if (fixOk(leg)) {
        pLat = leg.fix!.lat;
        pLon = leg.fix!.lon;
        g.endLat = pLat;
        g.endLon = pLon;
      }
    }
    // Altitude prediction for the next altitude-terminated leg.
    if (leg.type === 'CA' || leg.type === 'VA' || leg.type === 'FA' || leg.type === 'HA') {
      const target = leg.altitude?.lowerFt ?? leg.altitude?.upperFt;
      if (target !== undefined) alt = Math.max(alt, target);
    } else {
      alt = Math.min(maxAlt, alt + g.lengthNm * grad);
      if (leg.altitude?.upperFt !== undefined) alt = Math.min(alt, leg.altitude.upperFt);
    }
    cum += g.lengthNm;
    g.cumDistNm = cum;
  }

  // Fly-by transitions.
  const bankLow = p.bankLimitDeg ?? 25;
  const bankHigh = Math.min(bankLow, 15);
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i];
    const b = legs[i + 1];
    const ga = a.geom;
    const gb = b.geom;
    if (!ga.valid || !gb.valid || a.flyOver || b.type === 'DISCO') continue;
    if (ga.kind !== 'gc' && ga.kind !== 'arc') continue;
    if (a.type !== 'TF' && a.type !== 'DF' && a.type !== 'CF' && a.type !== 'RF' && a.type !== 'AF') continue;
    if (gb.kind !== 'gc' && gb.kind !== 'arc') continue;
    if (b.type === 'CA' || b.type === 'CD' || b.type === 'CI' || b.type === 'CR' || b.type === 'DF') continue;
    const cin = ga.finalCourseTrue;
    const cout = b.type === 'CF' ? nextInboundCourse(b) : gb.courseTrue;
    if (!Number.isFinite(cin) || !Number.isFinite(cout)) continue;
    const dpsi = wrap180(cout - cin);
    const ad = Math.abs(dpsi);
    if (ad < 1 || ad > 135) continue;
    const bank = Math.min(p.startAltFt > 19500 ? bankHigh : bankLow, Math.max(5, ad / 2));
    let r = turnRadiusNm(gs, bank);
    const t = Math.tan((ad / 2) * DEG2RAD);
    let d = r * t;
    const lim = 0.5 * Math.min(ga.lengthNm > 0 ? ga.lengthNm : Infinity, gb.lengthNm > 0 ? gb.lengthNm : Infinity);
    if (d > lim) {
      d = lim;
      r = d / t;
    }
    const dir = dpsi > 0 ? 1 : -1;
    const fLat = ga.endLat;
    const fLon = ga.endLon;
    const s = destinationPoint(fLat, fLon, cin + 180, d, scratchA);
    ga.turnStartLat = s.lat;
    ga.turnStartLon = s.lon;
    const c = destinationPoint(s.lat, s.lon, cin + dir * 90, r, scratchB);
    ga.turnCenterLat = c.lat;
    ga.turnCenterLon = c.lon;
    const e = destinationPoint(fLat, fLon, cout, d, scratchA);
    ga.turnEndLat = e.lat;
    ga.turnEndLon = e.lon;
    ga.turnValid = true;
    ga.turnRadiusNm = r;
    ga.turnAnticipationNm = d;
    ga.turnAngleDeg = dpsi;
  }
  return cum;
}

/** Maximum holding airspeed (KIAS) by altitude: 200 up to 6,000 ft, 230 to 14,000 ft, 265 above (AIM 5-3-8 j.4, Table 5-3-1). */
export function holdSpeedLimitKt(altFt: number): number {
  if (altFt <= 6000) return 200;
  if (altFt <= 14000) return 230;
  return 265;
}
