/**
 * Series yaw damper: washed-out yaw rate -> rudder command, optionally with
 * turn coordination from lateral acceleration. The output `fcs.yd_cmd` is
 * summed into the rudder by `MechanicalFlightControls` (series actuator: the
 * pedals do not move), or read by `FlyByWire`.
 *
 * The washout (tau 2–4 s typical) removes the steady yaw rate of a turn so
 * the damper only opposes the Dutch roll oscillation. Gain is scheduled vs
 * IAS because rudder effectiveness grows with dynamic pressure.
 *
 * Engagement: `engagedVar` (default `ap.yd_engaged`, toggled by the YD
 * button through the AFCS or directly by a switch). Loss of power, of the
 * rate source (`rateValid`) or `fail.yd` disengages it (the var is written
 * back to 0 and `yd.off_light` illuminates — 737 YAW DAMPER light).
 *
 * Vars written: fcs.yd_cmd, yd.active, yd.off_light, engagedVar (on auto
 * disengage only). Failures: yd.
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ADC, AP } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { Washout, sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';
import { FCS_VARS } from './vars';

export interface YawDamperConfig {
  /** Engage var (1 = engaged). Default ap.yd_engaged. */
  engagedVar?: string;
  /** Power (bus / hydraulic for the actuator). Default true. */
  power?: Binding;
  /** Yaw-rate source (deg/s). Default ahrs1.r_dps. */
  rateVar?: string;
  /** Rate source validity. Default ahrs1.att_valid. */
  rateValid?: Binding;
  /** Lateral acceleration (g) for turn coordination. Default ahrs1.ny_g. */
  nyVar?: string;
  /** Rudder command per deg/s of washed-out yaw rate (normalized), constant or vs IAS. */
  gain: Schedule;
  /** Rudder command per g of lateral acceleration (turn coordination). Default 0. */
  nyGain?: Schedule;
  /** Washout time constant (s). Default 3 (EST). */
  washoutS?: number;
  /** Max |command| (normalized). Default 0.15 (EST: series YD authority a few degrees). */
  authority?: number;
  /** IAS var for schedules. Default adc1.ias_kt. */
  iasVar?: string;
  /** Output var. Default fcs.yd_cmd. */
  output?: string;
}

export class YawDamper implements Subsystem {
  readonly name = 'yaw_damper';
  command = 0;
  private readonly vars: SimVars;
  private readonly cfg: YawDamperConfig;
  private readonly engagedVar: string;
  private readonly power: () => boolean;
  private readonly valid: () => boolean;
  private readonly rateVar: string;
  private readonly nyVar: string;
  private readonly iasVar: string;
  private readonly output: string;
  private readonly washout: Washout;
  private readonly fail = failVar('yd');

  constructor(env: BlockEnv, cfg: YawDamperConfig) {
    this.vars = env.vars;
    this.cfg = cfg;
    this.engagedVar = cfg.engagedVar ?? AP.yd;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.valid = compileCondition(env.vars, cfg.rateValid ?? SENSOR_VARS.attValid(1), true);
    this.rateVar = cfg.rateVar ?? SENSOR_VARS.r(1);
    this.nyVar = cfg.nyVar ?? SENSOR_VARS.ny(1);
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.output = cfg.output ?? FCS_VARS.ydCmd;
    this.washout = new Washout(cfg.washoutS ?? 3);
  }

  failures(): FailureDef[] {
    return [{ id: 'yd', name: 'Yaw damper', category: 'flight controls', description: 'Yaw damper disengages and cannot be re-engaged.' }];
  }

  reset(): void {
    this.washout.reset(this.vars.get(this.rateVar));
    this.command = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const ok = this.power() && this.valid() && v.get(this.fail) === 0;
    let engaged = v.get(this.engagedVar) !== 0;
    if (engaged && !ok) {
      v.set(this.engagedVar, 0);
      engaged = false;
    }
    const r = v.get(this.rateVar);
    const hp = this.washout.update(r, dt);
    let cmd = 0;
    if (engaged) {
      const ias = v.get(this.iasVar);
      // Oppose yaw rate: positive (nose-right) rate -> left rudder.
      cmd = -sched(this.cfg.gain, ias) * hp;
      if (this.cfg.nyGain !== undefined) cmd -= sched(this.cfg.nyGain, ias) * v.get(this.nyVar);
      const a = this.cfg.authority ?? 0.15;
      cmd = cmd > a ? a : cmd < -a ? -a : cmd;
    }
    this.command = cmd;
    v.set(this.output, cmd);
    v.set('yd.active', engaged ? 1 : 0);
    v.set('yd.off_light', engaged ? 0 : 1);
  }
}
