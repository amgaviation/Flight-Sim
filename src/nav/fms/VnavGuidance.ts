/**
 * VNAV outputs: descent path deviation, top of descent, target altitude,
 * required vertical speed, phase, and FMS target speed.
 *
 * Reads baro altitude (`adc{n}.alt_ft`) and GPS ground speed; the descent
 * path comes from `computeDescentProfile` (recomputed by `Fms` with the plan
 * geometry). The along-path aircraft position is supplied by `Fms` from LNAV.
 *
 * Speed targets (kt IAS / Mach) follow the phase:
 *   CLB  climb speed, 250 kt max below 10,000 ft MSL (14 CFR 91.117(a)),
 *        limited by the next departure speed constraint;
 *   CRZ  cruise speed / Mach;
 *   DES  descent speed / Mach, 250 kt below 10,000 ft, the next arrival
 *        speed constraint, and holding speed limits (AIM 5-3-8 Table 5-3-1);
 *   APR  approach speed (aircraft-specific, set via `SpeedSchedule`).
 * Mach targets apply at or above `machTransitionFt`.
 */
import type { SimVars } from '../../core/SimVars';
import { ADC, FMS, GPS } from '../../core/vars';
import type { FlightPlan } from '../flightplan/FlightPlan';
import { isHoldLeg } from '../flightplan/types';
import { holdSpeedLimitKt } from '../flightplan/geometry';
import { emptyProfile, profileAltitudeAt, type VnavProfile } from './VnavPath';

export interface SpeedSchedule {
  climbKt: number;
  climbMach?: number;
  cruiseKt: number;
  cruiseMach?: number;
  descentKt: number;
  descentMach?: number;
  approachKt: number;
  /** Altitude (ft) at and above which Mach targets are used. EST default 28,000 ft (typical IAS/Mach crossover for 250-300 kt / M0.74-0.80). */
  machTransitionFt?: number;
}

/** Generic defaults; aircraft should supply their own schedule. EST: typical light-jet figures. */
export const DEFAULT_SPEEDS: SpeedSchedule = {
  climbKt: 250,
  cruiseKt: 250,
  descentKt: 250,
  approachKt: 140,
  machTransitionFt: 28000,
};

/** 14 CFR 91.117(a): 250 KIAS below 10,000 ft MSL. */
const SPEED_LIMIT_ALT_FT = 10000;
const SPEED_LIMIT_KT = 250;
/** VNAV deviation display starts one minute before TOD (Garmin VDI behaviour). */
const TOD_LEAD_S = 60;

export class VnavGuidance {
  readonly name = 'vnav';
  private readonly vars: SimVars;
  private readonly vAlt: string;
  speeds: SpeedSchedule;
  /** Current descent profile (replaced by `Fms` on recompute). */
  profile: VnavProfile = emptyProfile();
  /** Along-plan position of the aircraft (nm), set by `Fms` before `update`. */
  alongNm = 0;
  phase: '' | 'CLB' | 'CRZ' | 'DES' | 'APR' = '';

  constructor(vars: SimVars, opts: { adcIndex?: number; speeds?: Partial<SpeedSchedule> } = {}) {
    this.vars = vars;
    this.vAlt = ADC.baroAlt(opts.adcIndex ?? 1);
    this.speeds = { ...DEFAULT_SPEEDS, ...opts.speeds };
  }

  update(plan: FlightPlan, activeIdx: number, approachActive: boolean, missedActive: boolean): void {
    const v = this.vars;
    const alt = v.get(this.vAlt);
    const gs = Math.max(1, v.get(GPS.gs));
    const s = this.alongNm;
    const p = this.profile;
    const cruise = p.cruiseAltFt;
    if (activeIdx < 0 || plan.legs.length === 0 || !v.getBool(GPS.valid)) {
      this.phase = '';
      v.set(FMS.vnavValid, 0);
      v.set(FMS.vnavDevFt, 0);
      v.setString(FMS.vnavPhase, '');
      return;
    }
    // ---- phase
    const tod = p.todDistNm;
    if (missedActive) this.phase = 'CLB';
    else if (approachActive) this.phase = 'APR';
    else if (p.valid && Number.isFinite(tod) && s >= tod) this.phase = 'DES';
    else if (cruise > 0 && alt < cruise - 200) this.phase = 'CLB';
    else this.phase = 'CRZ';
    v.setString(FMS.vnavPhase, this.phase);

    // ---- descent path
    const pathActive = p.valid && Number.isFinite(tod) && !missedActive && s >= tod - (gs / 3600) * TOD_LEAD_S && s <= p.eodDistNm + 0.1;
    const pathAlt = profileAltitudeAt(p, s);
    v.set(FMS.vnavValid, pathActive ? 1 : 0);
    v.set(FMS.vnavDevFt, pathActive && Number.isFinite(pathAlt) ? alt - pathAlt : 0);
    const todDist = p.valid && Number.isFinite(tod) ? Math.max(0, tod - s) : 0;
    v.set(FMS.todDistNm, todDist);
    v.set(FMS.todEteS, (todDist / gs) * 3600);

    // ---- target altitude: next constraint ahead (descent) / climb limit
    let target = cruise;
    let targetS = NaN;
    const legs = plan.legs;
    if (this.phase === 'DES' || this.phase === 'APR' || (this.phase === 'CRZ' && p.valid)) {
      for (let k = Math.max(0, activeIdx); k < legs.length; k++) {
        const l = legs[k];
        if (l.segment === 'missed') break;
        if (!l.altitude || l.type === 'DISCO') continue;
        const pa = profileAltitudeAt(p, l.geom.cumDistNm);
        target = Number.isFinite(pa) ? pa : (l.altitude.upperFt ?? l.altitude.lowerFt ?? target);
        targetS = l.geom.cumDistNm;
        break;
      }
    } else {
      for (let k = Math.max(0, activeIdx); k < legs.length; k++) {
        const l = legs[k];
        if (l.type === 'DISCO' || !l.altitude) continue;
        if (l.segment === 'arrival' || l.segment === 'approach' || l.segment === 'destination') break;
        if (l.altitude.upperFt !== undefined && l.altitude.upperFt < target) {
          target = l.altitude.upperFt;
          targetS = l.geom.cumDistNm;
          break;
        }
        if (missedActive && l.altitude.lowerFt !== undefined) {
          target = l.altitude.lowerFt;
          targetS = l.geom.cumDistNm;
          break;
        }
      }
    }
    v.set(FMS.vnavTargetAltFt, Number.isFinite(target) ? Math.round(target) : 0);
    const dTarget = Number.isFinite(targetS) ? targetS - s : NaN;
    v.set(FMS.vsRequiredFpm, Number.isFinite(dTarget) && dTarget > 0.1 ? ((target - alt) / ((dTarget / gs) * 60)) : 0);

    // ---- speed target
    const sp = this.speeds;
    let kt = sp.cruiseKt;
    let mach = sp.cruiseMach ?? 0;
    if (this.phase === 'CLB') {
      kt = sp.climbKt;
      mach = sp.climbMach ?? 0;
    } else if (this.phase === 'DES') {
      kt = sp.descentKt;
      mach = sp.descentMach ?? 0;
    } else if (this.phase === 'APR') {
      kt = sp.approachKt;
      mach = 0;
    }
    if (alt < SPEED_LIMIT_ALT_FT && this.phase !== 'APR') kt = Math.min(kt, SPEED_LIMIT_KT);
    // Next speed constraint ahead (at / at-or-below caps the target).
    for (let k = Math.max(0, activeIdx); k < legs.length; k++) {
      const l = legs[k];
      if (l.type === 'DISCO') break;
      if (l.speed && (l.speed.kind === 'at' || l.speed.kind === 'atOrBelow')) {
        // Climb constraints apply on the leg itself; descent constraints from the constrained waypoint's approach.
        if (this.phase !== 'CLB' || k === activeIdx) kt = Math.min(kt, l.speed.kt);
        break;
      }
      if (k > activeIdx + 3) break;
    }
    const active = legs[activeIdx];
    if (active && isHoldLeg(active.type)) kt = Math.min(kt, holdSpeedLimitKt(alt));
    const machOn = mach > 0 && alt >= (sp.machTransitionFt ?? 28000);
    v.set(FMS.vnavTargetSpeedKt, kt);
    v.set(FMS.vnavTargetMach, machOn ? mach : 0);
  }
}
