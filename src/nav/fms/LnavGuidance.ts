/**
 * LNAV: flies the active flight plan laterally. Evaluates the aircraft
 * against the active leg's path, sequences legs (fly-by turn anticipation,
 * fly-over, altitude / DME / intercept / radial terminations, holds,
 * procedure turns, manual terminations), flies fly-by transition arcs, and
 * writes the lateral FMS vars including the roll command
 * `fms.lnav_bank_cmd_deg` for the autopilot/flight director.
 *
 * Sensors: GPS position/ground speed/track/variation (`gps.*`), magnetic
 * heading from `ahrs{n}.hdg_mag_deg` (heading legs) and baro altitude from
 * `adc{n}.alt_ft` (altitude terminations). Never reads `fdm.*`.
 *
 * Suspension (`fms.suspended`): at the missed approach point until the missed
 * approach is activated, at a route discontinuity, after the last leg, and
 * on manual-termination legs. While suspended LNAV keeps flying the extension
 * of the current leg (Garmin "SUSP"); with `discontinuity: 'invalid'`
 * (Boeing) `fms.lnav_valid` drops to 0 at a discontinuity instead.
 */
import type { SimVars } from '../../core/SimVars';
import { ADC, FMS, GPS } from '../../core/vars';
import { destinationPoint, distanceNm, initialBearing, type LatLon } from '../../core/geo';
import { wrap180, wrap360 } from '../../core/math';
import type { FlightPlanManager } from '../flightplan/FlightPlanManager';
import type { FlightPlan } from '../flightplan/FlightPlan';
import { isHeadingLeg, isHoldLeg, type PlanLeg } from '../flightplan/types';
import { turnRadiusNm } from '../flightplan/geometry';
import { legCourseTrue } from '../procedures';
import {
  captureDistanceNm,
  evalArc,
  evalGreatCircle,
  headingBankCommand,
  newPathEval,
  trackBankCommand,
  type PathEval,
} from './PathGuidance';
import { HoldGuidance } from './HoldGuidance';

export interface LnavOptions {
  /** Roll command limit (deg). Default 25 (typical FMS/GPSS LNAV limit). */
  bankLimitDeg?: number;
  /** Assumed autopilot roll rate for turn lead (deg/s), EST 5. */
  rollRateDegS?: number;
  /** Behaviour at a route discontinuity: keep flying the extended leg ('extend', Garmin) or drop LNAV ('invalid', Boeing). */
  discontinuity?: 'extend' | 'invalid';
  adcIndex?: number;
  ahrsIndex?: number;
}

/** Time before a fly-by turn at which `fms.wpt_alert` comes on (s). Garmin "WPT" alert ~10 s. */
const WPT_ALERT_S = 10;

export class LnavGuidance {
  readonly name = 'lnav';
  private readonly vars: SimVars;
  private readonly plans: FlightPlanManager;
  private readonly markDirty: () => void;
  private readonly bankLimit: number;
  private readonly rollRate: number;
  private readonly discBehaviour: 'extend' | 'invalid';
  private readonly vHdg: string;
  private readonly vAlt: string;

  /** Latest evaluation of the path being flown. */
  readonly path: PathEval = newPathEval();
  private readonly nextEval: PathEval = newPathEval();
  readonly hold = new HoldGuidance();

  // runtime state
  missedApproachActive = false;
  suspended = false;
  valid = false;
  bankCmdDeg = 0;
  /** Along-path distance to the active leg's terminator (nm). */
  distToGoNm = 0;
  private plan: FlightPlan | null = null;
  private activeLegId = -1;
  private inTurn = false;
  private turnLeg: PlanLeg | null = null;
  private forcedDir = 0;
  private holdExitRequested = false;
  private holdCrossed = false;
  private legStartSign = 0;
  private readonly scratch: LatLon = { lat: 0, lon: 0 };
  private ptPhase = 0;
  private ptStartLat = 0;
  private ptStartLon = 0;
  private ptEndLat = 0;
  private ptEndLon = 0;

  constructor(vars: SimVars, plans: FlightPlanManager, markGeometryDirty: () => void, opts: LnavOptions = {}) {
    this.vars = vars;
    this.plans = plans;
    this.markDirty = markGeometryDirty;
    this.bankLimit = opts.bankLimitDeg ?? 25;
    this.rollRate = opts.rollRateDegS ?? 5;
    this.discBehaviour = opts.discontinuity ?? (plans.style === 'boeing' ? 'invalid' : 'extend');
    this.vHdg = ADC.heading(opts.ahrsIndex ?? 1);
    this.vAlt = ADC.baroAlt(opts.adcIndex ?? 1);
  }

  /** Requests the missed approach (sequencing past the MAP into the missed legs). */
  activateMissedApproach(): void {
    this.missedApproachActive = true;
    const plan = this.plans.active;
    const leg = plan.activeLeg;
    if (this.suspended && leg && (leg.segment === 'approach' || leg.segment === 'destination')) {
      const j = plan.firstMissedIndex;
      if (j >= 0) {
        this.suspended = false;
        plan.activeLegIndex = j;
        plan.touch();
      }
    }
  }

  /** Exits the active hold at the next fix crossing (HM legs). */
  exitHold(): void {
    this.holdExitRequested = true;
  }

  /** Clears runtime state (new plan / reposition). */
  reset(): void {
    this.activeLegId = -1;
    this.inTurn = false;
    this.turnLeg = null;
    this.suspended = false;
    this.missedApproachActive = false;
    this.holdExitRequested = false;
    this.bankCmdDeg = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const plan = this.plans.active;
    if (plan !== this.plan) {
      this.plan = plan;
      this.activeLegId = -1;
      this.inTurn = false;
      this.suspended = false;
    }
    const gpsOk = v.getBool(GPS.valid);
    if (!gpsOk || plan.legs.length === 0) {
      this.writeInvalid();
      return;
    }
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const gs = v.get(GPS.gs);
    const trk = v.get(GPS.trackTrue);
    const magVar = v.get(GPS.magVar);
    const alt = v.get(this.vAlt);

    // Auto-activate the first flyable leg of a new plan.
    if (plan.activeLegIndex < 0) {
      const first = plan.legs.findIndex((l, k) => k > 0 && l.type !== 'DISCO');
      const idx = first >= 0 ? first : plan.legs[0].type !== 'DISCO' ? 0 : -1;
      if (idx < 0) {
        this.writeInvalid();
        return;
      }
      plan.activeLegIndex = idx;
      plan.touch();
    }
    let leg = plan.legs[plan.activeLegIndex];
    if (!leg || leg.type === 'DISCO') {
      // An edit left a discontinuity active: move to the next flyable leg.
      const j = plan.legs.findIndex((l, k) => k > plan.activeLegIndex && l.type !== 'DISCO');
      if (j < 0) {
        this.writeInvalid();
        return;
      }
      plan.activeLegIndex = j;
      leg = plan.legs[j];
    }
    if (leg.id !== this.activeLegId) this.activate(plan, leg, lat, lon, trk, gs);

    // ---- evaluate + sequence (at most two sequences per update)
    for (let pass = 0; pass < 2; pass++) {
      this.evaluate(leg, lat, lon, trk, gs);
      // Re-checked every update: a suspension ends by itself when the reason
      // goes away (missed approach activated, discontinuity deleted).
      if (!this.shouldSequence(plan, leg, lat, lon, trk, gs, alt)) break;
      const next = this.nextLeg(plan);
      if (!next) {
        this.suspended = true;
        break;
      }
      // Fly-by transition arc from this leg into the next.
      const turn = leg.geom.turnValid && !leg.flyOver && !isHoldLeg(next.type) && !isHoldLeg(leg.type) && leg.type !== 'PI';
      this.inTurn = turn;
      this.turnLeg = turn ? leg : null;
      plan.activeLegIndex = plan.indexOfLegId(next.id);
      this.activate(plan, next, lat, lon, trk, gs);
      leg = next;
    }

    // ---- roll command
    let bank: number;
    if (isHeadingLeg(leg.type) && !this.inTurn) {
      const hdgCmd = leg.course ?? 0;
      bank = headingBankCommand(hdgCmd, v.get(this.vHdg), this.bankLimit, this.forcedDir);
      if (this.forcedDir !== 0 && Math.abs(wrap180(hdgCmd - v.get(this.vHdg))) < 45) this.forcedDir = 0;
    } else {
      const forced = isHoldLeg(leg.type) ? this.hold.forcedDir : this.forcedDir;
      bank = trackBankCommand(this.path.xtkNm, this.path.dtkTrue, trk, gs, this.path.bankFfDeg, this.bankLimit, forced);
      if (this.forcedDir !== 0 && Math.abs(wrap180(this.path.dtkTrue - trk)) < 45) this.forcedDir = 0;
    }
    // Smooth steps at sequencing (EST 0.5 s first-order lag; the AP adds its own roll-rate limit).
    const a = Math.min(1, dt / 0.5);
    this.bankCmdDeg += (bank - this.bankCmdDeg) * a;

    this.valid = !(this.suspended && this.discBehaviour === 'invalid' && this.nextIsDisco(plan));
    this.writeOutputs(plan, leg, lat, lon, gs, magVar);
  }

  // ------------------------------------------------------------ helpers

  private nextLeg(plan: FlightPlan): PlanLeg | null {
    const i = plan.activeLegIndex;
    const next = plan.legs[i + 1];
    if (!next || next.type === 'DISCO') return null;
    const cur = plan.legs[i];
    // Hold at the MAP / runway until the missed approach is activated.
    if (next.segment === 'missed' && cur.segment !== 'missed' && !this.missedApproachActive) return null;
    return next;
  }

  private nextIsDisco(plan: FlightPlan): boolean {
    const n = plan.legs[plan.activeLegIndex + 1];
    return !!n && n.type === 'DISCO';
  }

  private activate(plan: FlightPlan, leg: PlanLeg, lat: number, lon: number, trk: number, gs: number): void {
    this.activeLegId = leg.id;
    this.suspended = false;
    this.forcedDir = leg.turnDirection === 'L' ? -1 : leg.turnDirection === 'R' ? 1 : 0;
    this.legStartSign = 0;
    this.holdCrossed = false;
    const g = leg.geom;
    // Direct-to style legs start at the present position when activated
    // (a pilot direct-to already stored its start).
    if (leg.type === 'DF' && leg.dfStartLat === undefined) {
      leg.dfStartLat = lat;
      leg.dfStartLon = lon;
      this.markDirty();
    } else if ((leg.type === 'IF' || leg.type === 'TF') && (g.kind === 'none' || !g.valid) && leg.fix) {
      leg.dfStartLat = lat;
      leg.dfStartLon = lon;
      this.markDirty();
    }
    if (isHoldLeg(leg.type) && leg.fix) {
      const atFix = distanceNm(lat, lon, leg.fix.lat, leg.fix.lon) < 1.5;
      this.hold.start(
        {
          fixLat: leg.fix.lat,
          fixLon: leg.fix.lon,
          inboundTrue: g.holdInboundTrue,
          dir: g.turnDir || 1,
          radiusNm: g.radiusNm > 0 ? g.radiusNm : 1,
          legNm: g.holdLegNm > 0 ? g.holdLegNm : 3,
        },
        lat,
        lon,
        trk,
        atFix,
      );
      this.holdExitRequested = false;
    }
    if (leg.type === 'PI' && leg.fix) {
      // Phase 0: outbound from the fix on the reciprocal of the inbound course
      // (EST 1.5 min, capped at half the coded PT limit), then phase 1: the
      // 45 deg leg for 1 min, then the reversal onto the next (inbound) leg.
      this.ptPhase = 0;
      const next = plan.legs[plan.indexOfLegId(leg.id) + 1];
      const inbound = next ? legCourseTrue(next) : NaN;
      const outCourse = Number.isFinite(inbound) ? inbound + 180 : legCourseTrue(leg);
      const limit = leg.distanceNm ?? 10;
      const d = Math.min(limit / 2, Math.max(1, (Math.max(60, gs) / 60) * 1.5));
      this.ptStartLat = leg.fix.lat;
      this.ptStartLon = leg.fix.lon;
      destinationPoint(leg.fix.lat, leg.fix.lon, outCourse, d, this.scratch);
      this.ptEndLat = this.scratch.lat;
      this.ptEndLon = this.scratch.lon;
    }
  }

  private evaluate(leg: PlanLeg, lat: number, lon: number, trk: number, gs: number): void {
    const out = this.path;
    const g = leg.geom;
    if (this.inTurn && this.turnLeg) {
      const t = this.turnLeg.geom;
      const dir = t.turnAngleDeg > 0 ? 1 : -1;
      const startRadial = initialBearing(t.turnCenterLat, t.turnCenterLon, t.turnStartLat, t.turnStartLon);
      evalArc(t.turnCenterLat, t.turnCenterLon, t.turnRadiusNm, dir, startRadial, Math.abs(t.turnAngleDeg), lat, lon, gs, out);
      if (out.distToGoNm <= 0 || Math.abs(out.xtkNm) > 2 * t.turnRadiusNm) this.inTurn = false;
      else {
        // Distance to go of the new leg for display.
        this.distToGoNm = this.legDistToGo(leg, lat, lon, trk, gs);
        return;
      }
    }
    this.distToGoNm = this.legDistToGo(leg, lat, lon, trk, gs);
  }

  /** Evaluates the leg path into `this.path` and returns the along-path distance to its terminator. */
  private legDistToGo(leg: PlanLeg, lat: number, lon: number, trk: number, gs: number): number {
    const out = this.inTurn ? this.nextEval : this.path;
    const g = leg.geom;
    if (isHoldLeg(leg.type)) {
      const crossed = this.hold.update(lat, lon, trk, gs, out);
      if (crossed) this.holdCrossed = true;
      return this.hold.distanceToFix(lat, lon);
    }
    if (leg.type === 'PI') {
      evalGreatCircle(this.ptStartLat, this.ptStartLon, this.ptEndLat, this.ptEndLon, lat, lon, out);
      return out.distToGoNm;
    }
    switch (g.kind) {
      case 'gc':
      case 'heading':
        evalGreatCircle(g.startLat, g.startLon, g.endLat, g.endLon, lat, lon, out);
        if (g.kind === 'heading') {
          out.xtkNm = 0;
          out.dtkTrue = g.courseTrue;
        }
        return out.distToGoNm;
      case 'arc':
        evalArc(g.centerLat, g.centerLon, g.radiusNm, g.turnDir, g.startRadial, g.sweepDeg, lat, lon, gs, out);
        return out.distToGoNm;
      default: {
        // No path: direct to the fix (or hold heading).
        if (leg.fix) {
          out.xtkNm = 0;
          out.dtkTrue = initialBearing(lat, lon, leg.fix.lat, leg.fix.lon);
          out.distToGoNm = distanceNm(lat, lon, leg.fix.lat, leg.fix.lon);
          out.bankFfDeg = 0;
          return out.distToGoNm;
        }
        out.xtkNm = 0;
        out.dtkTrue = trk;
        out.distToGoNm = 0;
        out.bankFfDeg = 0;
        return 0;
      }
    }
  }

  private shouldSequence(plan: FlightPlan, leg: PlanLeg, lat: number, lon: number, trk: number, gs: number, alt: number): boolean {
    const g = leg.geom;
    const t = leg.type;
    const dtg = this.distToGoNm;
    if (t === 'FM' || t === 'VM') {
      this.suspended = true;
      return false;
    }
    if (isHoldLeg(t)) {
      const crossed = this.holdCrossed;
      this.holdCrossed = false;
      if (!crossed) return false;
      if (t === 'HF') return true;
      if (t === 'HA') return alt >= (leg.altitude?.lowerFt ?? leg.altitude?.upperFt ?? -Infinity);
      if (this.holdExitRequested) {
        this.holdExitRequested = false;
        return true;
      }
      return false;
    }
    if (t === 'PI') {
      if (this.ptPhase === 0 && dtg <= 0) {
        this.ptPhase = 1;
        const course = legCourseTrue(leg);
        const d = Math.max(0.5, (gs / 60) * 1); // 1 min on the 45 deg leg (EST standard technique)
        this.ptStartLat = lat;
        this.ptStartLon = lon;
        destinationPoint(lat, lon, course, d, this.scratch);
        this.ptEndLat = this.scratch.lat;
        this.ptEndLon = this.scratch.lon;
        return false;
      }
      if (this.ptPhase === 1 && dtg <= 0) {
        // Reverse (coded turn direction) onto the inbound leg.
        const next = plan.legs[plan.activeLegIndex + 1];
        if (next) next.turnDirection = next.turnDirection ?? leg.turnDirection;
        return true;
      }
      return false;
    }
    if (t === 'CA' || t === 'FA' || t === 'VA') {
      const target = leg.altitude?.lowerFt ?? leg.altitude?.upperFt;
      return target === undefined ? dtg <= 0 : alt >= target;
    }
    if (t === 'CD' || t === 'FD' || t === 'VD') {
      const n = leg.recommendedNavaid;
      if (!n || leg.distanceNm === undefined || !Number.isFinite(n.lat)) return dtg <= 0;
      const s = Math.sign(distanceNm(lat, lon, n.lat, n.lon) - leg.distanceNm);
      if (this.legStartSign === 0) this.legStartSign = s || 1;
      return s !== this.legStartSign;
    }
    if (t === 'CR' || t === 'VR') {
      const n = leg.recommendedNavaid;
      if (!n || leg.theta === undefined || !Number.isFinite(n.lat)) return dtg <= 0;
      const radial = wrap360(leg.theta + (n.declination ?? leg.magVar));
      const s = Math.sign(wrap180(initialBearing(n.lat, n.lon, lat, lon) - radial));
      if (this.legStartSign === 0) this.legStartSign = s || 1;
      return s !== this.legStartSign;
    }
    if (t === 'CI' || t === 'VI') {
      const next = plan.legs[plan.activeLegIndex + 1];
      if (!next || !next.geom.valid) return dtg <= 0;
      const ng = next.geom;
      const e = this.nextEval;
      if (ng.kind === 'arc') evalArc(ng.centerLat, ng.centerLon, ng.radiusNm, ng.turnDir, ng.startRadial, ng.sweepDeg, lat, lon, gs, e);
      else if (Number.isFinite(ng.startLat)) evalGreatCircle(ng.startLat, ng.startLon, ng.endLat, ng.endLon, lat, lon, e);
      else return dtg <= 0;
      const s = Math.sign(e.xtkNm);
      if (this.legStartSign === 0) this.legStartSign = s || 1;
      const cap = captureDistanceNm(turnRadiusNm(gs, this.bankLimit), wrap180(e.dtkTrue - trk));
      return Math.abs(e.xtkNm) <= cap || s !== this.legStartSign;
    }
    if (t === 'FC') return dtg <= 0;
    // Legs ending at a fix.
    if (!leg.flyOver && g.turnValid) {
      const bank = Math.min(this.bankLimit, Math.max(5, Math.abs(g.turnAngleDeg) / 2));
      const lead = (gs / 3600) * (bank / this.rollRate) * 0.5;
      return dtg <= g.turnAnticipationNm + lead;
    }
    return dtg <= 0;
  }

  // ------------------------------------------------------------ outputs

  private writeInvalid(): void {
    const v = this.vars;
    this.valid = false;
    v.set(FMS.lnavValid, 0);
    v.set(FMS.lnavBankCmd, 0);
    v.set(FMS.xtkNm, 0);
    v.set(FMS.toFrom, 0);
    v.set(FMS.suspended, 0);
    v.set(FMS.inHold, 0);
    v.set(FMS.wptAlert, 0);
    v.setString(FMS.holdEntry, '');
    this.bankCmdDeg = 0;
  }

  /** Display ident for legs without a fix (Boeing-style pseudo waypoints). */
  private legIdent(leg: PlanLeg | undefined): string {
    if (!leg) return '';
    if (leg.type === 'DISCO') return '';
    const t = leg.type;
    if (t === 'CA' || t === 'VA' || t === 'FA') return `(${Math.round(leg.altitude?.lowerFt ?? leg.altitude?.upperFt ?? 0)})`;
    if (t === 'CI' || t === 'VI') return '(INTC)';
    if (t === 'VM' || t === 'FM') return '(VECTORS)';
    if (t === 'CD' || t === 'VD' || t === 'FD') return `(${leg.recommendedNavaid?.ident ?? ''}${leg.distanceNm !== undefined ? '/' + leg.distanceNm : ''})`;
    if (t === 'CR' || t === 'VR') return `(${leg.recommendedNavaid?.ident ?? ''}${leg.theta !== undefined ? Math.round(leg.theta).toString().padStart(3, '0') : ''})`;
    return leg.fix?.ident ?? '';
  }

  private writeOutputs(plan: FlightPlan, leg: PlanLeg, lat: number, lon: number, gs: number, magVar: number): void {
    const v = this.vars;
    const i = plan.activeLegIndex;
    const p = this.path;
    v.set(FMS.activeLegIndex, i);
    v.set(FMS.lnavValid, this.valid ? 1 : 0);
    v.set(FMS.lnavBankCmd, this.valid ? this.bankCmdDeg : 0);
    v.set(FMS.xtkNm, p.xtkNm);
    v.set(FMS.desiredTrackTrue, wrap360(p.dtkTrue));
    v.set(FMS.dtkMag, wrap360(p.dtkTrue - magVar));
    v.setString(FMS.legType, leg.type);
    v.setString(FMS.nextWptIdent, this.legIdent(leg));
    let prevIdent = '';
    for (let k = i - 1; k >= 0; k--) {
      const l = plan.legs[k];
      if (l.type === 'DISCO') break;
      if (l.fix) {
        prevIdent = l.fix.ident;
        break;
      }
    }
    if (leg.type === 'DF' && leg.dfStartLat !== undefined) prevIdent = prevIdent || 'P.POS';
    v.setString(FMS.fromWptIdent, prevIdent);
    const after = plan.legs[i + 1];
    v.setString(FMS.afterWptIdent, after && after.type !== 'DISCO' ? this.legIdent(after) : '');
    v.set(FMS.nextDtkMag, after && Number.isFinite(after.geom.courseTrue) ? wrap360(after.geom.courseTrue - magVar) : 0);
    // Straight-line distance/bearing to the active waypoint (Garmin DIS/BRG).
    const tLat = leg.fix ? leg.fix.lat : leg.geom.endLat;
    const tLon = leg.fix ? leg.fix.lon : leg.geom.endLon;
    let dist = this.distToGoNm;
    let brg = p.dtkTrue;
    if (Number.isFinite(tLat) && Number.isFinite(tLon)) {
      dist = distanceNm(lat, lon, tLat, tLon);
      brg = initialBearing(lat, lon, tLat, tLon);
    }
    v.set(FMS.distToWptNm, dist);
    v.set(FMS.bearingToWptMag, wrap360(brg - magVar));
    v.set(FMS.eteToWptS, gs > 5 ? (dist / gs) * 3600 : 0);
    // Along-path distance to the destination (last non-missed leg).
    let toDest = Math.max(0, this.distToGoNm);
    const last = this.missedApproachActive ? plan.legs.length - 1 : plan.lastNonMissedIndex;
    for (let k = i + 1; k <= last; k++) toDest += plan.legs[k].geom.lengthNm;
    v.set(FMS.distToDestNm, toDest);
    const pastFix = this.suspended && this.distToGoNm < 0;
    const holdOutbound = isHoldLeg(leg.type) && (this.hold.phase === 'OUTBOUND' || this.hold.phase === 'TURN_OUTBOUND' || this.hold.phase === 'TEARDROP_OUT' || this.hold.phase === 'PARALLEL_OUT');
    v.set(FMS.toFrom, pastFix || holdOutbound ? -1 : 1);
    v.set(FMS.suspended, this.suspended ? 1 : 0);
    v.set(FMS.inHold, isHoldLeg(leg.type) && this.hold.phase !== 'TO_FIX' ? 1 : 0);
    v.setString(FMS.holdEntry, isHoldLeg(leg.type) ? this.hold.entry : '');
    v.set(FMS.missedActive, this.missedApproachActive ? 1 : 0);
    // Waypoint alert ~10 s before a turn at the active waypoint.
    let alert = 0;
    if (gs > 30 && !this.inTurn && after && after.type !== 'DISCO') {
      const lead = leg.geom.turnValid ? leg.geom.turnAnticipationNm : 0;
      const tToTurn = ((this.distToGoNm - lead) / gs) * 3600;
      if (tToTurn <= WPT_ALERT_S && tToTurn > -5) alert = 1;
    }
    v.set(FMS.wptAlert, alert);
  }
}
