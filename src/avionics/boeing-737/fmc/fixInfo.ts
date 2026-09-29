/**
 * FIX INFO geometry: where the active route crosses a radial or a distance
 * circle of a reference fix, and the abeam point (FCOM 11.42 "FIX INFO
 * page": RAD/DIS, ETA, DTG and predicted ALT for each entry; ABEAM).
 *
 * The route is taken as the chain of leg paths (start -> end points of the
 * plan geometry) projected on a local flat plane centred at the fix (nm,
 * x east / y north); adequate within the ND ranges the page is used for
 * (errors < 0.5 % within 200 nm).
 */
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';

export interface FixCrossing {
  /** Radial (deg magnetic) and distance (nm) of the crossing from the fix. */
  radialMag: number;
  distNm: number;
  /** Along-plan distance of the crossing (nm) and the distance to go from the aircraft. */
  alongNm: number;
  dtgNm: number;
  /** Predicted altitude (ft) at the crossing, NaN when unknown. */
  altFt: number;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  s1: number;
  s2: number;
  a1: number;
  a2: number;
}

const D = Math.PI / 180;

function project(lat0: number, lon0: number, lat: number, lon: number): { x: number; y: number } {
  return { x: (lon - lon0) * 60 * Math.cos(lat0 * D), y: (lat - lat0) * 60 };
}

/** Route segments ahead of `fromAlongNm` in the local frame of the fix. */
function segments(plan: FlightPlan, lat0: number, lon0: number, fromAlongNm: number, cruiseAltFt: number): Seg[] {
  const out: Seg[] = [];
  let prevAlt = NaN;
  for (const l of plan.legs) {
    const g = l.geom;
    if (l.type === 'DISCO' || l.segment === 'missed' || !g.valid || !(g.lengthNm > 0) || !Number.isFinite(g.startLat) || !Number.isFinite(g.endLat)) continue;
    const s2 = g.cumDistNm;
    const s1 = s2 - g.lengthNm;
    const a2 = Number.isFinite(g.predictedAltFt) ? g.predictedAltFt : cruiseAltFt;
    const a1 = Number.isFinite(prevAlt) ? prevAlt : a2;
    prevAlt = a2;
    if (s2 < fromAlongNm) continue;
    const p1 = project(lat0, lon0, g.startLat, g.startLon);
    const p2 = project(lat0, lon0, g.endLat, g.endLon);
    out.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, s1, s2, a1, a2 });
  }
  return out;
}

function crossingAt(sg: Seg, t: number, magVar: number, fromAlongNm: number): FixCrossing {
  const x = sg.x1 + (sg.x2 - sg.x1) * t;
  const y = sg.y1 + (sg.y2 - sg.y1) * t;
  const along = sg.s1 + (sg.s2 - sg.s1) * t;
  const radTrue = ((Math.atan2(x, y) / D) % 360 + 360) % 360;
  return {
    radialMag: ((radTrue - magVar) % 360 + 360) % 360,
    distNm: Math.hypot(x, y),
    alongNm: along,
    dtgNm: Math.max(0, along - fromAlongNm),
    altFt: sg.a1 + (sg.a2 - sg.a1) * t,
  };
}

/** First crossing of the radial (deg magnetic) ahead of the aircraft, or null. */
export function radialCrossing(plan: FlightPlan, lat0: number, lon0: number, magVar: number, radialMag: number, fromAlongNm: number, cruiseAltFt: number): FixCrossing | null {
  const b = (radialMag + magVar) * D;
  const dx = Math.sin(b);
  const dy = Math.cos(b);
  for (const sg of segments(plan, lat0, lon0, fromAlongNm, cruiseAltFt)) {
    const ex = sg.x2 - sg.x1;
    const ey = sg.y2 - sg.y1;
    // Solve origin + u*(dx,dy) = p1 + t*e, u >= 0, t in [0,1].
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (dy * sg.x1 - dx * sg.y1) / den;
    const u = (ey * sg.x1 - ex * sg.y1) / den;
    if (t < 0 || t > 1 || u < 0) continue;
    const c = crossingAt(sg, t, magVar, fromAlongNm);
    if (c.alongNm >= fromAlongNm) return c;
  }
  return null;
}

/** First crossing of the distance circle ahead of the aircraft, or null. */
export function circleCrossing(plan: FlightPlan, lat0: number, lon0: number, magVar: number, distNm: number, fromAlongNm: number, cruiseAltFt: number): FixCrossing | null {
  for (const sg of segments(plan, lat0, lon0, fromAlongNm, cruiseAltFt)) {
    const ex = sg.x2 - sg.x1;
    const ey = sg.y2 - sg.y1;
    const a = ex * ex + ey * ey;
    const b = 2 * (sg.x1 * ex + sg.y1 * ey);
    const c = sg.x1 * sg.x1 + sg.y1 * sg.y1 - distNm * distNm;
    const disc = b * b - 4 * a * c;
    if (a < 1e-12 || disc < 0) continue;
    const r = Math.sqrt(disc);
    for (const t of [(-b - r) / (2 * a), (-b + r) / (2 * a)]) {
      if (t < 0 || t > 1) continue;
      const x = crossingAt(sg, t, magVar, fromAlongNm);
      if (x.alongNm >= fromAlongNm) return x;
    }
  }
  return null;
}

/** Abeam point: the route point ahead closest to the fix, or null. */
export function abeamPoint(plan: FlightPlan, lat0: number, lon0: number, magVar: number, fromAlongNm: number, cruiseAltFt: number): FixCrossing | null {
  let best: FixCrossing | null = null;
  for (const sg of segments(plan, lat0, lon0, fromAlongNm, cruiseAltFt)) {
    const ex = sg.x2 - sg.x1;
    const ey = sg.y2 - sg.y1;
    const a = ex * ex + ey * ey;
    if (a < 1e-12) continue;
    // Closest point of the segment (the perpendicular foot, or an end point at a turn).
    const t = Math.max(0, Math.min(1, -(sg.x1 * ex + sg.y1 * ey) / a));
    const c = crossingAt(sg, t, magVar, fromAlongNm);
    if (c.alongNm < fromAlongNm) continue;
    if (!best || c.distNm < best.distNm) best = c;
  }
  return best;
}
