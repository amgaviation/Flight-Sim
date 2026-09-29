/**
 * Lateral path evaluation (great-circle segments and constant-radius arcs)
 * and the LNAV roll-command law. Allocation-free.
 *
 * Roll law (non-linear "L1"-style track guidance):
 *   intercept   = atan(xtk / L), limited to 45 deg
 *   trackCmd    = dtk - intercept
 *   turn rate   = wrap(trackCmd - track) / tau
 *   bank        = feed-forward (arcs) + atan(V * rate / g), limited
 * Linearised, cross-track obeys x'' + x'/tau + V/(L tau) x = 0, so choosing
 * L = 2 V tau gives a damping ratio of 0.7 at every speed. tau grows with
 * speed (8 s + V/60 s, EST) so heavy jets use gentler corrections.
 */
import { destinationPoint, distanceNm, initialBearing, finalBearing, crossTrackNm, alongTrackNm, type LatLon } from '../../core/geo';
import { clamp, wrap180, wrap360, DEG2RAD, RAD2DEG } from '../../core/math';

const G = 9.80665;
const KT_TO_MS = 1852 / 3600;

/** Result of evaluating the aircraft against a path segment (reused object). */
export interface PathEval {
  /** Cross-track error (nm), + = aircraft right of the path. */
  xtkNm: number;
  /** Desired track at the abeam point (deg true). */
  dtkTrue: number;
  /** Along-path distance still to fly to the segment end (nm); negative once past it. */
  distToGoNm: number;
  /** Feed-forward bank for curved paths (deg, + right). */
  bankFfDeg: number;
}

export function newPathEval(): PathEval {
  return { xtkNm: 0, dtkTrue: 0, distToGoNm: 0, bankFfDeg: 0 };
}

const foot: LatLon = { lat: 0, lon: 0 };

/** Evaluates a great-circle segment A->B. */
export function evalGreatCircle(aLat: number, aLon: number, bLat: number, bLon: number, pLat: number, pLon: number, out: PathEval): PathEval {
  const len = distanceNm(aLat, aLon, bLat, bLon);
  if (len < 1e-6) {
    out.xtkNm = 0;
    out.dtkTrue = initialBearing(pLat, pLon, bLat, bLon);
    out.distToGoNm = distanceNm(pLat, pLon, bLat, bLon);
    out.bankFfDeg = 0;
    return out;
  }
  out.xtkNm = crossTrackNm(aLat, aLon, bLat, bLon, pLat, pLon);
  const along = alongTrackNm(aLat, aLon, bLat, bLon, pLat, pLon);
  out.distToGoNm = len - along;
  const crs0 = initialBearing(aLat, aLon, bLat, bLon);
  if (along > 0.05 && along < len - 0.05) {
    destinationPoint(aLat, aLon, crs0, along, foot);
    out.dtkTrue = finalBearing(aLat, aLon, foot.lat, foot.lon);
  } else if (along >= len - 0.05) {
    out.dtkTrue = finalBearing(aLat, aLon, bLat, bLon);
  } else {
    out.dtkTrue = crs0;
  }
  out.bankFfDeg = 0;
  return out;
}

/**
 * Evaluates a constant-radius arc around C (radius r nm, dir +1 clockwise /
 * -1 counter-clockwise) that starts on `startRadial` (deg true, from C) and
 * sweeps `sweepDeg`.
 */
export function evalArc(
  cLat: number,
  cLon: number,
  r: number,
  dir: number,
  startRadial: number,
  sweepDeg: number,
  pLat: number,
  pLon: number,
  gsKt: number,
  out: PathEval,
): PathEval {
  const rho = distanceNm(cLat, cLon, pLat, pLon);
  const th = initialBearing(cLat, cLon, pLat, pLon);
  out.xtkNm = dir > 0 ? r - rho : rho - r;
  out.dtkTrue = wrap360(th + dir * 90);
  let swept = dir > 0 ? wrap360(th - startRadial) : wrap360(startRadial - th);
  // Points just before the arc start appear as ~360 deg swept.
  if (swept > sweepDeg + (360 - sweepDeg) / 2) swept -= 360;
  out.distToGoNm = ((sweepDeg - swept) * DEG2RAD) * r;
  const v = Math.max(30, gsKt) * KT_TO_MS;
  out.bankFfDeg = dir * Math.atan((v * v) / (G * Math.max(0.05, r) * 1852)) * RAD2DEG;
  return out;
}

/** Track-loop time constant (s) for a ground speed (EST, see header). */
export function guidanceTau(gsKt: number): number {
  return 8 + Math.max(0, gsKt) / 60;
}

/**
 * Roll command (deg, + right) to fly a path. `forcedDir` (+1 right, -1 left)
 * makes large track changes turn the published way (holds, procedure turns,
 * legs coded with a turn direction).
 */
export function trackBankCommand(
  xtkNm: number,
  dtkTrue: number,
  trackTrue: number,
  gsKt: number,
  bankFfDeg: number,
  bankLimitDeg: number,
  forcedDir = 0,
): number {
  const v = Math.max(40, gsKt);
  const tau = guidanceTau(v);
  const lookAheadNm = 2 * (v / 3600) * tau;
  const intercept = clamp(Math.atan2(xtkNm, lookAheadNm) * RAD2DEG, -45, 45);
  let err = wrap180(dtkTrue - intercept - trackTrue);
  if (forcedDir !== 0 && Math.sign(err) !== forcedDir && Math.abs(err) > 30) err += forcedDir * 360;
  const rate = (err * DEG2RAD) / tau;
  const bank = bankFfDeg + Math.atan((v * KT_TO_MS * rate) / G) * RAD2DEG;
  return clamp(bank, -bankLimitDeg, bankLimitDeg);
}

/**
 * Roll command (deg) to fly a heading: 1 deg of bank per deg of heading error
 * (EST, typical heading-select gain), limited; `forcedDir` as above.
 */
export function headingBankCommand(hdgCmd: number, hdg: number, bankLimitDeg: number, forcedDir = 0, gain = 1): number {
  let err = wrap180(hdgCmd - hdg);
  if (forcedDir !== 0 && Math.sign(err) !== forcedDir && Math.abs(err) > 30) err += forcedDir * 360;
  return clamp(err * gain, -bankLimitDeg, bankLimitDeg);
}

/** Capture distance (nm) to start turning onto a course `interceptDeg` away: R (1 - cos(dpsi)). */
export function captureDistanceNm(radiusNm: number, interceptDeg: number): number {
  const a = Math.min(90, Math.abs(interceptDeg)) * DEG2RAD;
  return radiusNm * (1 - Math.cos(a));
}
