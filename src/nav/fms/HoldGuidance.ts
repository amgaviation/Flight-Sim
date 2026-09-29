/**
 * Holding pattern guidance (HA / HF / HM legs): entry selection, entry
 * procedures and the racetrack, as a small state machine producing the
 * current path segment every update.
 *
 * Entry sectors (AIM 5-3-8 j.1, Figure 5-3-3), for a right-hand pattern with
 * the aircraft's track to the fix `T` and inbound course `C`
 * (d = wrap180(T - C)):
 *   direct    d in [-70, +110]
 *   teardrop  d in (+110, +180]   outbound 30 deg toward the holding side
 *   parallel  d in [-180, -70)    outbound on the non-holding side, then a
 *                                 turn of more than 180 deg back to the fix
 * Left-hand patterns mirror the sectors.
 *
 * Racetrack (right pattern): fix -> 180 deg turn -> outbound leg (parallel,
 * 2R to the right) -> 180 deg turn -> inbound leg to the fix. Turn radius and
 * leg length come from the leg geometry (standard rate / 25 deg bank, AIM
 * 5-3-8 leg timing).
 */
import { destinationPoint, distanceNm, initialBearing, type LatLon } from '../../core/geo';
import { wrap180, wrap360 } from '../../core/math';
import { evalArc, evalGreatCircle, type PathEval } from './PathGuidance';

export type HoldPhase =
  | 'TO_FIX'
  | 'TEARDROP_OUT'
  | 'PARALLEL_OUT'
  | 'PARALLEL_RETURN'
  | 'TURN_OUTBOUND'
  | 'OUTBOUND'
  | 'TURN_INBOUND'
  | 'INBOUND';

export type HoldEntry = 'DIRECT' | 'TEARDROP' | 'PARALLEL';

/** Chooses the entry for a track to the fix (deg true), inbound course (deg true) and turn direction (+1 right). */
export function holdEntryFor(trackToFix: number, inbound: number, dir: number): HoldEntry {
  const d = wrap180(trackToFix - inbound) * (dir > 0 ? 1 : -1);
  if (d >= -70 && d <= 110) return 'DIRECT';
  if (d > 110) return 'TEARDROP';
  return 'PARALLEL';
}

export interface HoldSetup {
  fixLat: number;
  fixLon: number;
  inboundTrue: number;
  /** +1 right turns, -1 left turns. */
  dir: number;
  radiusNm: number;
  legNm: number;
}

/** Hold state machine. `update` returns true when the aircraft crosses the fix inbound (pattern completed once). */
export class HoldGuidance {
  phase: HoldPhase = 'TO_FIX';
  entry: HoldEntry = 'DIRECT';
  /** Number of completed inbound fix crossings. */
  circuits = 0;
  /** Required turn direction for the current phase (0 = shortest). */
  forcedDir = 0;
  private s: HoldSetup = { fixLat: 0, fixLon: 0, inboundTrue: 0, dir: 1, radiusNm: 1, legNm: 3 };
  // Pattern points.
  private readonly c1: LatLon = { lat: 0, lon: 0 };
  private readonly c2: LatLon = { lat: 0, lon: 0 };
  private readonly o1: LatLon = { lat: 0, lon: 0 };
  private readonly o2: LatLon = { lat: 0, lon: 0 };
  private readonly i1: LatLon = { lat: 0, lon: 0 };
  private readonly segA: LatLon = { lat: 0, lon: 0 };
  private readonly segB: LatLon = { lat: 0, lon: 0 };
  private toFixStartLat = NaN;
  private toFixStartLon = NaN;

  /** (Re)starts the hold. `atFix` = the aircraft is crossing the fix now (sequenced from the leg to the fix). */
  start(setup: HoldSetup, pLat: number, pLon: number, trackTrue: number, atFix: boolean): void {
    this.s = { ...setup };
    const s = this.s;
    destinationPoint(s.fixLat, s.fixLon, s.inboundTrue + s.dir * 90, s.radiusNm, this.c1);
    destinationPoint(s.fixLat, s.fixLon, s.inboundTrue + s.dir * 90, 2 * s.radiusNm, this.o1);
    destinationPoint(this.o1.lat, this.o1.lon, s.inboundTrue + 180, s.legNm, this.o2);
    destinationPoint(this.c1.lat, this.c1.lon, s.inboundTrue + 180, s.legNm, this.c2);
    destinationPoint(s.fixLat, s.fixLon, s.inboundTrue + 180, s.legNm, this.i1);
    this.circuits = 0;
    if (atFix) this.beginEntry(trackTrue);
    else {
      this.phase = 'TO_FIX';
      this.toFixStartLat = pLat;
      this.toFixStartLon = pLon;
      this.forcedDir = 0;
    }
  }

  private beginEntry(trackTrue: number): void {
    const s = this.s;
    this.entry = holdEntryFor(trackTrue, s.inboundTrue, s.dir);
    if (this.entry === 'DIRECT') {
      this.phase = 'TURN_OUTBOUND';
      this.forcedDir = s.dir;
    } else if (this.entry === 'TEARDROP') {
      this.phase = 'TEARDROP_OUT';
      const crs = s.inboundTrue + 180 - s.dir * 30;
      this.segA.lat = s.fixLat;
      this.segA.lon = s.fixLon;
      destinationPoint(s.fixLat, s.fixLon, crs, s.legNm, this.segB);
      this.forcedDir = s.dir;
    } else {
      this.phase = 'PARALLEL_OUT';
      this.segA.lat = s.fixLat;
      this.segA.lon = s.fixLon;
      destinationPoint(s.fixLat, s.fixLon, s.inboundTrue + 180, s.legNm, this.segB);
      this.forcedDir = -s.dir;
    }
  }

  /**
   * Evaluates the current phase into `out` and advances phases.
   * Returns true when the fix was crossed inbound at the end of a circuit.
   */
  update(pLat: number, pLon: number, trackTrue: number, gsKt: number, out: PathEval): boolean {
    const s = this.s;
    switch (this.phase) {
      case 'TO_FIX':
        evalGreatCircle(this.toFixStartLat, this.toFixStartLon, s.fixLat, s.fixLon, pLat, pLon, out);
        if (out.distToGoNm <= 0) this.beginEntry(trackTrue);
        return false;
      case 'TEARDROP_OUT':
        evalGreatCircle(this.segA.lat, this.segA.lon, this.segB.lat, this.segB.lon, pLat, pLon, out);
        if (out.distToGoNm <= 0) {
          this.phase = 'INBOUND';
          this.forcedDir = s.dir;
        }
        return false;
      case 'PARALLEL_OUT':
        evalGreatCircle(this.segA.lat, this.segA.lon, this.segB.lat, this.segB.lon, pLat, pLon, out);
        if (out.distToGoNm <= 0) {
          this.phase = 'PARALLEL_RETURN';
          this.segA.lat = pLat;
          this.segA.lon = pLon;
          this.forcedDir = -s.dir;
        }
        return false;
      case 'PARALLEL_RETURN':
        evalGreatCircle(this.segA.lat, this.segA.lon, s.fixLat, s.fixLon, pLat, pLon, out);
        // Turn the long way (toward the holding side) until pointing at the fix.
        if (Math.abs(wrap180(initialBearing(pLat, pLon, s.fixLat, s.fixLon) - trackTrue)) < 45) this.forcedDir = 0;
        if (out.distToGoNm <= 0) {
          this.phase = 'TURN_OUTBOUND';
          this.forcedDir = s.dir;
        }
        return false;
      case 'TURN_OUTBOUND': {
        const start = wrap360(s.inboundTrue - s.dir * 90);
        evalArc(this.c1.lat, this.c1.lon, s.radiusNm, s.dir, start, 180, pLat, pLon, gsKt, out);
        if (out.distToGoNm <= 0.05 * s.radiusNm) {
          this.phase = 'OUTBOUND';
          this.forcedDir = 0;
        }
        return false;
      }
      case 'OUTBOUND':
        evalGreatCircle(this.o1.lat, this.o1.lon, this.o2.lat, this.o2.lon, pLat, pLon, out);
        if (out.distToGoNm <= 0) {
          this.phase = 'TURN_INBOUND';
          this.forcedDir = s.dir;
        }
        return false;
      case 'TURN_INBOUND': {
        const start = wrap360(s.inboundTrue + s.dir * 90);
        evalArc(this.c2.lat, this.c2.lon, s.radiusNm, s.dir, start, 180, pLat, pLon, gsKt, out);
        if (out.distToGoNm <= 0.05 * s.radiusNm) {
          this.phase = 'INBOUND';
          this.forcedDir = 0;
        }
        return false;
      }
      case 'INBOUND': {
        evalGreatCircle(this.i1.lat, this.i1.lon, s.fixLat, s.fixLon, pLat, pLon, out);
        if (this.forcedDir !== 0 && Math.abs(wrap180(out.dtkTrue - trackTrue)) < 45) this.forcedDir = 0;
        if (out.distToGoNm <= 0) {
          this.circuits++;
          this.phase = 'TURN_OUTBOUND';
          this.forcedDir = s.dir;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  /** Straight-line distance to the hold fix (nm). */
  distanceToFix(pLat: number, pLon: number): number {
    return distanceNm(pLat, pLon, this.s.fixLat, this.s.fixLon);
  }
}
