/**
 * Flight-phase computer used for alert inhibits (CAS/EICAS, TAWS, TOCW).
 *
 * Phases: GROUND (stopped/taxi), TAKEOFF (on the ground above
 * `takeoffKt`, or airborne below `climbFt` RA after lift-off), CLIMB,
 * CRUISE (|VS| < 300 fpm), DESCENT, APPROACH (gear down or RA below
 * `approachFt`), LANDING (RA < `landingInhibit.belowFt` in the approach),
 * ROLLOUT (on the ground after a landing until below `taxiKt`).
 *
 * Inhibit windows:
 *   takeoff: IAS >= 80 kt on the takeoff roll until 400 ft RA or 30 s
 *     after lift-off (the task's "80 kt -> 400 ft"; Boeing EICAS inhibits
 *     master cautions in this window — 777 FCOM 15.20, EST for others);
 *   landing: below 200 ft RA on approach until below 75 kt on the rollout
 *     (777 FCOM 15.20 landing inhibit; EST for other types).
 *
 * Vars written: string cas.phase, cas.phase_code, cas.to_inhibit,
 * cas.ldg_inhibit.
 */
import type { SimVars } from '../../core/SimVars';
import { ADC } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export type FlightPhaseName = 'GROUND' | 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'APPROACH' | 'LANDING' | 'ROLLOUT';

export const FLIGHT_PHASES: readonly FlightPhaseName[] = ['GROUND', 'TAKEOFF', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH', 'LANDING', 'ROLLOUT'];

export interface FlightPhaseConfig {
  iasVar?: string;
  raVar?: string;
  vsVar?: string;
  onGround?: Binding;
  gearDown?: Binding;
  takeoffKt?: number;
  climbFt?: number;
  approachFt?: number;
  taxiKt?: number;
  takeoffInhibit?: { fromKt: number; toFt: number; maxAfterLiftoffS: number };
  landingInhibit?: { belowFt: number; untilKt: number };
}

export class FlightPhase {
  phase: FlightPhaseName = 'GROUND';
  takeoffInhibit = false;
  landingInhibit = false;
  private readonly vars: SimVars;
  private readonly cfg: FlightPhaseConfig;
  private readonly ground: () => boolean;
  private readonly gearDown: () => boolean;
  private readonly iasVar: string;
  private readonly raVar: string;
  private readonly vsVar: string;
  private airborneT = 0;
  private landed = false;
  private wasGround = true;
  private readonly ti: { fromKt: number; toFt: number; maxAfterLiftoffS: number };
  private readonly li: { belowFt: number; untilKt: number };

  constructor(env: BlockEnv, cfg: FlightPhaseConfig = {}) {
    this.vars = env.vars;
    this.cfg = cfg;
    this.ground = compileCondition(env.vars, cfg.onGround ?? 'gear.air_ground', true);
    this.gearDown = compileCondition(env.vars, cfg.gearDown ?? 'gear.down_locked', true);
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.raVar = cfg.raVar ?? SENSOR_VARS.raAlt(1);
    this.vsVar = cfg.vsVar ?? ADC.vs(1);
    this.ti = cfg.takeoffInhibit ?? { fromKt: 80, toFt: 400, maxAfterLiftoffS: 30 };
    this.li = cfg.landingInhibit ?? { belowFt: 200, untilKt: 75 };
  }

  update(dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const ground = this.ground();
    const ias = v.get(this.iasVar);
    const ra = v.get(this.raVar, 99999);
    const vs = v.get(this.vsVar);
    if (!ground && this.wasGround) {
      this.airborneT = 0;
      this.landed = false;
    }
    if (!ground) this.airborneT += dt;
    if (ground && !this.wasGround) this.landed = true;
    this.wasGround = ground;

    const toKt = c.takeoffKt ?? 50;
    const climbFt = c.climbFt ?? 1500;
    let p: FlightPhaseName;
    if (ground) {
      if (this.landed && ias > (c.taxiKt ?? 40)) p = 'ROLLOUT';
      else if (!this.landed && ias > toKt) p = 'TAKEOFF';
      else {
        p = 'GROUND';
        if (ias < (c.taxiKt ?? 40)) this.landed = false;
      }
    } else if (this.airborneT < 60 && ra < climbFt && vs > -300) p = 'TAKEOFF';
    else if ((this.gearDown() && ra < (c.approachFt ?? 2500)) || (ra < (c.approachFt ?? 2500) && vs < -300)) {
      p = ra < (c.landingInhibit?.belowFt ?? 200) ? 'LANDING' : 'APPROACH';
    } else if (vs > 300) p = 'CLIMB';
    else if (vs < -300) p = 'DESCENT';
    else p = 'CRUISE';
    this.phase = p;

    const ti = this.ti;
    this.takeoffInhibit = (ground && !this.landed && ias >= ti.fromKt) || (!ground && this.airborneT < ti.maxAfterLiftoffS && ra < ti.toFt && p === 'TAKEOFF');
    const li = this.li;
    this.landingInhibit = (!ground && p === 'LANDING' && ra < li.belowFt) || (ground && this.landed && ias > li.untilKt);

    v.setString('cas.phase', p);
    v.set('cas.phase_code', FLIGHT_PHASES.indexOf(p));
    v.set('cas.to_inhibit', this.takeoffInhibit ? 1 : 0);
    v.set('cas.ldg_inhibit', this.landingInhibit ? 1 : 0);
  }
}
