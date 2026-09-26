/**
 * FMS core as one `Subsystem`: flight plan manager (Garmin immediate or
 * Boeing MOD/EXEC editing), plan geometry, LNAV, VNAV, approach/CDI logic
 * and performance predictions. Avionics families (G1000, G3000/G5000,
 * Epic, Fusion, 737 FMC) build their pages on top of this object and read
 * the `fms.*` vars.
 *
 *   const fms = new Fms(ctx, { style: 'boeing', engineCount: 2, speeds: {...} });
 *   systems.push(fms);                   // after Radios (GPS) and the sensors
 *   const r = await fms.loadRoute('KTEB WENTZ1 RUUDY J209 SBY KMIA');
 *   fms.plans.exec();                     // Boeing: EXEC
 *
 * Update rate: 20 Hz (SimLoop `nav`) or 60 Hz (systems). Geometry and the
 * VNAV profile are rebuilt on plan changes and every `geometryIntervalS`.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import { ADC, FMS, GPS, INPUT } from '../../core/vars';
import { distanceNm } from '../../core/geo';
import { clamp } from '../../core/math';
import type { Subsystem } from '../../aircraft/types';
import type { NavDatabase, Waypoint } from '../types';
import { normalizeRunwayIdent } from '../procedures';
import { FlightPlanManager } from '../flightplan/FlightPlanManager';
import type { EditStyle, FlightPlan } from '../flightplan/FlightPlan';
import { computePlanGeometry } from '../flightplan/geometry';
import { parseRoute, type RouteParseResult } from '../flightplan/RouteParser';
import { LnavGuidance } from './LnavGuidance';
import { VnavGuidance, type SpeedSchedule } from './VnavGuidance';
import { computeDescentProfile, profileAltitudeAt, DEFAULT_DESCENT_FPA_DEG, DEFAULT_MAX_FPA_DEG, FT_PER_NM } from './VnavPath';
import { PerformancePredictor } from './Performance';
import {
  CDI_SCALE_NM,
  TERMINAL_RADIUS_NM,
  APPROACH_RAMP_NM,
  approachRampScaleNm,
  angularLateralScaleNm,
  glidepathFullScaleFt,
} from './ApproachScaling';

/** EventBus commands understood by `Fms` (payloads in docs/modules/nav.md). */
export const FMS_EVENTS = {
  exec: 'fms.exec',
  erase: 'fms.erase',
  /** Payload `{ ident?: string; index?: number; courseMag?: number }`. */
  directTo: 'fms.direct_to',
  missedApproach: 'fms.missed_approach',
  exitHold: 'fms.exit_hold',
  /** Payload `{ index: number }`. */
  activateLeg: 'fms.activate_leg',
  /** Direct to the first leg of the loaded approach. */
  activateApproach: 'fms.activate_approach',
  /** Vectors-to-final: activate the leg into the FAF (extended final course). */
  activateVtf: 'fms.activate_vtf',
} as const;

export interface FmsOptions {
  /** Editing style: 'garmin' (immediate) or 'boeing' (MOD + EXEC). Default 'garmin'. */
  style?: EditStyle;
  adcIndex?: number;
  ahrsIndex?: number;
  /** Engines summed for fuel flow predictions (default 1). */
  engineCount?: number;
  /** Total fuel var (kg), default `fuel.total_kg`. */
  fuelVar?: string;
  /** LNAV roll command limit (deg), default 25. */
  bankLimitDeg?: number;
  /** Default descent angle for new plans (deg), default 3.0. */
  descentFpaDeg?: number;
  maxFpaDeg?: number;
  /** Predicted climb gradient for altitude-terminated legs (ft/nm), default 500. */
  climbGradientFtPerNm?: number;
  speeds?: Partial<SpeedSchedule>;
  /** LNAV behaviour at a discontinuity (default: 'extend' for garmin, 'invalid' for boeing). */
  discontinuity?: 'extend' | 'invalid';
  /** Activate the missed approach when `input.toga` is pressed during an approach (default true). */
  missedApproachOnToga?: boolean;
  /** Geometry/VNAV rebuild period (s), default 1. */
  geometryIntervalS?: number;
}

export class Fms implements Subsystem {
  readonly name = 'fms';
  readonly plans: FlightPlanManager;
  readonly lnav: LnavGuidance;
  readonly vnav: VnavGuidance;
  readonly perf: PerformancePredictor;
  readonly db: NavDatabase;
  private readonly vars: SimVars;
  private readonly opts: FmsOptions;
  private readonly vAlt: string;
  private readonly unsubs: (() => void)[] = [];
  private geomDirty = true;
  private geomTimer = 0;
  private perfTimer = 0;
  private oceanTimer = 1e9;
  private oceanic = false;
  private lastPlan: FlightPlan | null = null;
  private lastVersion = -1;
  private lastToga = 0;
  /** Along-plan aircraft position (nm). */
  alongNm = 0;
  /** Current approach mode label written to `fms.approach_mode`. */
  approachMode = 'ENR';
  approachActive = false;

  constructor(ctx: { vars: SimVars; events?: EventBus; nav: NavDatabase }, opts: FmsOptions = {}) {
    this.vars = ctx.vars;
    this.db = ctx.nav;
    this.opts = opts;
    this.vAlt = ADC.baroAlt(opts.adcIndex ?? 1);
    this.plans = new FlightPlanManager(opts.style ?? 'garmin', { vars: ctx.vars, events: ctx.events });
    this.plans.active.descentFpaDeg = opts.descentFpaDeg ?? DEFAULT_DESCENT_FPA_DEG;
    this.lnav = new LnavGuidance(ctx.vars, this.plans, () => (this.geomDirty = true), {
      bankLimitDeg: opts.bankLimitDeg,
      discontinuity: opts.discontinuity,
      adcIndex: opts.adcIndex,
      ahrsIndex: opts.ahrsIndex,
    });
    this.vnav = new VnavGuidance(ctx.vars, { adcIndex: opts.adcIndex, speeds: opts.speeds });
    this.perf = new PerformancePredictor(ctx.vars, { engineCount: opts.engineCount, fuelVar: opts.fuelVar });
    this.plans.onChange((plan, reason) => {
      this.geomDirty = true;
      if (reason === 'replace') this.lnav.reset();
      // A new/re-flown approach clears a previous missed approach.
      else if (this.lnav.missedApproachActive && plan.activeLeg?.segment !== 'missed') this.lnav.missedApproachActive = false;
      if (!(plan.descentFpaDeg > 0)) plan.descentFpaDeg = opts.descentFpaDeg ?? DEFAULT_DESCENT_FPA_DEG;
    });
    const ev = ctx.events;
    if (ev) {
      this.unsubs.push(
        ev.on(FMS_EVENTS.exec, () => this.plans.exec()),
        ev.on(FMS_EVENTS.erase, () => this.plans.erase()),
        ev.on(FMS_EVENTS.directTo, (p) => {
          const q = (p ?? {}) as { ident?: string; index?: number; courseMag?: number };
          if (q.index !== undefined) this.directTo(q.index, q.courseMag);
          else if (q.ident) this.directTo(q.ident, q.courseMag);
        }),
        ev.on(FMS_EVENTS.missedApproach, () => this.activateMissedApproach()),
        ev.on(FMS_EVENTS.exitHold, () => this.lnav.exitHold()),
        ev.on(FMS_EVENTS.activateLeg, (p) => this.activateLeg(Number((p as { index?: number } | undefined)?.index ?? -1))),
        ev.on(FMS_EVENTS.activateApproach, () => this.activateApproach()),
        ev.on(FMS_EVENTS.activateVtf, () => this.activateVectorsToFinal()),
      );
    }
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }

  reset(): void {
    this.lnav.reset();
    this.geomDirty = true;
  }

  // ------------------------------------------------------------ commands

  /** Parses a route string and loads it (Garmin: active now; Boeing: MOD awaiting EXEC). */
  async loadRoute(route: string): Promise<RouteParseResult> {
    const r = await parseRoute(this.db, route, this.plans.style);
    r.plan.descentFpaDeg = this.opts.descentFpaDeg ?? DEFAULT_DESCENT_FPA_DEG;
    this.plans.replace(r.plan);
    this.geomDirty = true;
    return r;
  }

  /**
   * Direct-to from the present GPS position. `target`: a leg index, a
   * waypoint ident (a plan waypoint is preferred, else the nearest database
   * match) or a `Waypoint`. `courseMag` makes it a course-to-fix (Garmin
   * direct-to with course / Boeing intercept course). Returns false when the
   * target cannot be found or GPS is invalid.
   */
  directTo(target: number | string | Waypoint, courseMag?: number): boolean {
    const v = this.vars;
    if (!v.getBool(GPS.valid)) return false;
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const plan = this.plans.edit();
    let t: number | Waypoint | undefined;
    if (typeof target === 'number') t = target;
    else if (typeof target === 'string') {
      const u = target.trim().toUpperCase();
      const from = Math.max(0, plan.activeLegIndex);
      let idx = plan.legs.findIndex((l, k) => k >= from && l.fix?.ident === u && l.type !== 'DISCO');
      if (idx < 0) idx = plan.legs.findIndex((l) => l.fix?.ident === u && l.type !== 'DISCO');
      if (idx >= 0) t = idx;
      else t = this.db.resolve(u, lat, lon)[0];
    } else t = target;
    if (t === undefined) return false;
    const leg = plan.directTo(t, lat, lon, courseMag);
    this.plans.commit();
    this.geomDirty = true;
    return leg !== null;
  }

  /** Activates leg `index` of the active plan (Garmin "activate leg"). */
  activateLeg(index: number): boolean {
    const ok = this.plans.edit().activateLeg(index);
    this.plans.commit();
    this.geomDirty = true;
    return ok;
  }

  /** Direct to the first leg of the loaded approach (Garmin "Activate Approach"). */
  activateApproach(): boolean {
    this.lnav.missedApproachActive = false;
    const plan = this.plans.edit();
    const i = plan.legs.findIndex((l) => l.segment === 'approach' && l.type !== 'DISCO' && !!l.fix);
    if (i < 0) return false;
    return this.directTo(i);
  }

  /** Vectors-to-final: fly the extended final approach course into the FAF. */
  activateVectorsToFinal(): boolean {
    this.lnav.missedApproachActive = false;
    const plan = this.plans.edit();
    const faf = plan.fafIndex;
    if (faf < 0) return false;
    return this.activateLeg(faf);
  }

  activateMissedApproach(): void {
    this.lnav.activateMissedApproach();
    this.geomDirty = true;
  }

  exitHold(): void {
    this.lnav.exitHold();
  }

  /** Replaces the speed schedule used for VNAV target speeds. */
  setSpeeds(s: Partial<SpeedSchedule>): void {
    this.vnav.speeds = { ...this.vnav.speeds, ...s };
  }

  /** Sets the cruise altitude of the plan being edited (Boeing: MOD). */
  setCruiseAltitude(ft: number): void {
    this.plans.apply((p) => {
      p.cruiseAltFt = ft;
      p.touch();
    });
    this.geomDirty = true;
  }

  // ------------------------------------------------------------ update

  private rebuild(plan: FlightPlan): void {
    const v = this.vars;
    const gs = v.get(GPS.gs);
    const sp = this.vnav.speeds;
    const alt = v.get(this.vAlt);
    computePlanGeometry(plan, {
      groundSpeedKt: gs > 80 ? gs : Math.max(60, sp.climbKt),
      startAltFt: alt,
      climbGradientFtPerNm: this.opts.climbGradientFtPerNm,
      bankLimitDeg: this.opts.bankLimitDeg,
      cruiseAltFt: plan.cruiseAltFt,
    });
    let cruise = plan.cruiseAltFt;
    if (!(cruise > 0)) {
      cruise = alt;
      for (const l of plan.legs) {
        const c = l.altitude;
        if (c && l.segment !== 'missed') cruise = Math.max(cruise, c.lowerFt ?? c.upperFt ?? 0);
      }
    }
    computeDescentProfile(plan, cruise, plan.descentFpaDeg || DEFAULT_DESCENT_FPA_DEG, this.opts.maxFpaDeg ?? DEFAULT_MAX_FPA_DEG, this.vnav.profile);
    for (const l of plan.legs) l.geom.predictedAltFt = NaN;
    if (this.vnav.profile.valid) {
      for (const l of plan.legs) {
        if (l.segment === 'missed' || l.type === 'DISCO') continue;
        const s = l.geom.cumDistNm;
        if (s >= this.vnav.profile.todDistNm) l.geom.predictedAltFt = Math.round(profileAltitudeAt(this.vnav.profile, s));
      }
    }
    if (plan !== this.lastPlan || plan.version !== this.lastVersion) {
      v.set(FMS.planVersion, v.get(FMS.planVersion) + 1);
      this.lastPlan = plan;
      this.lastVersion = plan.version;
    }
    v.set(FMS.cruiseAltFt, plan.cruiseAltFt);
    v.setString(FMS.destIdent, plan.destination?.icao ?? '');
    this.geomDirty = false;
    this.geomTimer = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const plan = this.plans.active;
    this.geomTimer += dt;
    if (plan !== this.lastPlan || plan.version !== this.lastVersion || this.geomDirty || this.geomTimer >= (this.opts.geometryIntervalS ?? 1)) {
      this.rebuild(plan);
    }
    // Go-around (TO/GA) activates the missed approach during an approach.
    const toga = v.get(INPUT.toga);
    if ((this.opts.missedApproachOnToga ?? true) && toga > 0.5 && this.lastToga <= 0.5 && plan.approachProcedure) {
      const leg = plan.activeLeg;
      if (leg && (leg.segment === 'approach' || leg.segment === 'destination')) this.activateMissedApproach();
    }
    this.lastToga = toga;

    this.lnav.update(dt);
    if (plan.version !== this.lastVersion) this.geomDirty = true;

    const idx = plan.activeLegIndex;
    const leg = plan.activeLeg;
    this.alongNm = leg ? leg.geom.cumDistNm - Math.max(0, this.lnav.distToGoNm) : 0;
    this.updateApproach(plan, dt);
    this.vnav.alongNm = this.alongNm;
    this.vnav.update(plan, idx, this.approachActive, this.lnav.missedApproachActive);

    this.perfTimer += dt;
    if (this.perfTimer >= 1) {
      this.perfTimer = 0;
      const last = this.lnav.missedApproachActive ? plan.legs.length - 1 : plan.lastNonMissedIndex;
      this.perf.update(plan, idx, this.alongNm, last);
    }
  }

  /** Along-path distance (nm) from the aircraft to the end of leg `k` (0 when `k` is behind). */
  private distToLegEnd(plan: FlightPlan, k: number): number {
    const i = plan.activeLegIndex;
    if (i < 0 || k < i) return 0;
    let d = Math.max(0, this.lnav.distToGoNm);
    for (let j = i + 1; j <= k; j++) d += plan.legs[j].geom.lengthNm;
    return d;
  }

  /** CDI scale, approach mode, lateral CDI and approach glidepath. */
  private updateApproach(plan: FlightPlan, dt: number): void {
    const v = this.vars;
    const valid = this.lnav.valid && v.getBool(GPS.valid);
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const i = plan.activeLegIndex;
    const leg = plan.activeLeg;
    const proc = plan.approachProcedure;
    const faf = plan.fafIndex;
    const map = plan.mapIndex;
    let mode = 'ENR';
    let scale: number = CDI_SCALE_NM.ENR;
    let apprActive = false;
    let distToThr = NaN;
    const vertical = !!proc && (proc.fas?.levelOfService === 'LPV' || proc.glidepathDeg !== undefined) && !(proc.approachType === 'ILS' || proc.approachType === 'LOC' || proc.approachType === 'LOC_BC' || proc.approachType === 'LDA' || proc.approachType === 'SDF' || proc.approachType === 'IGS');
    if (leg && this.lnav.missedApproachActive && leg.segment === 'missed') {
      mode = 'MAPR';
      scale = CDI_SCALE_NM.MAPR;
    } else if (leg && proc && faf >= 0 && map >= 0 && i <= map && (leg.segment === 'approach' || i >= faf)) {
      const dFaf = i <= faf ? this.distToLegEnd(plan, faf) : 0;
      if (i > faf || dFaf <= APPROACH_RAMP_NM) {
        apprActive = true;
        const sbas = v.getBool(GPS.sbas);
        if (proc.fas?.levelOfService === 'LPV' && sbas) mode = 'LPV';
        else if (proc.fas?.levelOfService === 'LP' && sbas) mode = 'LP';
        else if (vertical) mode = 'LNAV/VNAV';
        else mode = 'LNAV';
        distToThr = this.distToLegEnd(plan, map);
        if (i > faf && (mode === 'LPV' || mode === 'LNAV/VNAV' || mode === 'LP')) {
          let widthM = 350 * 0.3048;
          let garpNm = (8000 + 1000) / FT_PER_NM;
          if (proc.fas) {
            widthM = proc.fas.courseWidthM;
            garpNm = distanceNm(proc.fas.ltpLat, proc.fas.ltpLon, proc.fas.fpapLat, proc.fas.fpapLon) + 305 / 1852;
          } else if (plan.destination && plan.arrivalRunway) {
            const rw = plan.destination.runways.find((r) => normalizeRunwayIdent(r.ident) === plan.arrivalRunway);
            if (rw && rw.lengthFt > 0) garpNm = (rw.lengthFt + 1000) / FT_PER_NM;
          }
          scale = angularLateralScaleNm(distToThr, widthM, garpNm);
        } else {
          scale = i > faf ? CDI_SCALE_NM.APR : approachRampScaleNm(dFaf);
        }
      } else {
        mode = 'TERM';
        scale = CDI_SCALE_NM.TERM;
      }
    } else if (leg) {
      const dest = plan.destination;
      const orig = plan.origin;
      const toDest = dest ? distanceNm(lat, lon, dest.lat, dest.lon) : Infinity;
      const fromOrig = orig ? distanceNm(lat, lon, orig.lat, orig.lon) : Infinity;
      if ((leg.segment === 'origin' || leg.segment === 'departure') && fromOrig <= 30) {
        mode = 'DPRT';
        scale = CDI_SCALE_NM.DPRT;
      } else if (toDest <= TERMINAL_RADIUS_NM || leg.segment === 'approach') {
        mode = 'TERM';
        scale = CDI_SCALE_NM.TERM;
      } else {
        // Oceanic: no airport within 200 nm (checked every 30 s).
        this.oceanTimer += dt;
        if (this.oceanTimer >= 30) {
          this.oceanTimer = 0;
          this.oceanic = this.db.ready && this.db.airportsNear(lat, lon, 200, 1).length === 0;
        }
        mode = this.oceanic ? 'OCN' : 'ENR';
        scale = this.oceanic ? CDI_SCALE_NM.OCN : CDI_SCALE_NM.ENR;
      }
    }
    this.approachMode = mode;
    this.approachActive = apprActive;
    v.setString(FMS.approachMode, valid ? mode : '');
    v.set(FMS.cdiScaleNm, scale);
    v.set(FMS.approachActive, apprActive ? 1 : 0);
    v.set(FMS.cdi, valid ? clamp(-this.lnav.path.xtkNm / scale, -1, 1) : 0);

    // ---- approach glidepath (LPV / LNAV/VNAV / synthetic)
    let gpValid = false;
    if (valid && apprActive && vertical && proc && map >= 0 && Number.isFinite(distToThr)) {
      const gpa = proc.fas?.glidepathDeg ?? proc.glidepathDeg ?? DEFAULT_DESCENT_FPA_DEG;
      const mapLeg = plan.legs[map];
      const thrElev = mapLeg.fix?.elevationFt ?? (mapLeg.altitude?.lowerFt !== undefined ? mapLeg.altitude.lowerFt - 50 : NaN);
      const tch = proc.fas?.tchFt ?? (mapLeg.altitude?.lowerFt !== undefined && Number.isFinite(thrElev) ? mapLeg.altitude.lowerFt - thrElev : 50);
      if (Number.isFinite(thrElev)) {
        const tanG = Math.tan((gpa * Math.PI) / 180);
        const dGpipFt = distToThr * FT_PER_NM + tch / tanG;
        const pathAlt = thrElev + dGpipFt * tanG;
        // LPV is geometric (SBAS) altitude; baro-VNAV uses the barometric altitude.
        const alt = this.approachMode === 'LPV' ? v.get(GPS.alt) : v.get(this.vAlt);
        const fsd = glidepathFullScaleFt(dGpipFt, gpa);
        v.set(FMS.gpDev, clamp((pathAlt - alt) / fsd, -1, 1));
        v.set(FMS.gpAngleDeg, gpa);
        gpValid = dGpipFt > 0;
      }
    }
    v.set(FMS.gpValid, gpValid ? 1 : 0);
    if (!gpValid) v.set(FMS.gpDev, 0);
  }
}

export type { SpeedSchedule };
