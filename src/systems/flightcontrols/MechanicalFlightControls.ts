/**
 * Conventional (cable/pushrod or hydraulically boosted) primary flight
 * controls: pilot input + autopilot servo + augmentation hooks -> surface
 * commands `surf.elevator/aileron/rudder`.
 *
 * Per axis:
 *   command = pilotInput (unless the AFCS senses the pilot force, see below)
 *           + Σ addVars (AP servo, yaw damper, stall pusher ...)
 *   Actuation:
 *     - no `actuators` configured: purely mechanical (Cessna 172/M2 ailerons ...);
 *     - with actuators (PCUs): authority = best actuator power 0..1. Below
 *       50 % power the surface rate falls proportionally (EST: a PCU's rate is
 *       flow-limited, flow ∝ pressure margin).
 *     - all actuators lost: `manualReversion` gives the pilot a reduced
 *       authority (737: ailerons and elevator revert to manual control through
 *       tabs, SmartCockpit 737NG Flight Controls) while servo/augmentation
 *       inputs are lost; `manualReversion: null` freezes the surface (rudder
 *       without standby hydraulics).
 *   Authority limit vs IAS (rudder limiters / ratio changers) and a rate
 *   limit are applied last. `fail.fcs.<axis>.jam` freezes the surface.
 *
 * Boeing autopilots back-drive the column and read the pilot's force
 * through transducers (CWS). While `ap.force_<axis>` is non-zero the pilot
 * input is not added to the surface (the AFCS turns it into a CWS command).
 *
 * Vars read: input.* (or configured), addVars, ap.force_pitch/roll, actuator
 * bindings, adc1.ias_kt (schedules).
 * Vars written: surf.elevator/aileron/rudder (configurable), fcs.<axis>_column,
 * fcs.<axis>_power, fcs.<axis>_manual, fcs.<axis>_jam.
 * Failures: fcs.<axis>.jam, fcs.<axis>.actuator<n> (n = 1-based actuator).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ADC, INPUT, SURF } from '../../core/vars';
import { compileBinding, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { deadband, sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { FCS_VARS, type ControlAxis } from './vars';

export interface ControlChannelConfig {
  /** Pilot input var. Default input.pitch / input.roll / input.yaw. */
  input?: string;
  /** Surface command var. Default surf.elevator / surf.aileron / surf.rudder. */
  output?: string;
  /**
   * Vars added to the command (normalized surface units). Default: pitch
   * [ap.servo_pitch, stall.pusher_cmd], roll [ap.servo_roll],
   * yaw [ap.servo_yaw, fcs.yd_cmd].
   */
  addVars?: string[];
  /** Var that removes the pilot input from the sum while non-zero. Default ap.force_<axis> (pitch/roll), none for yaw. `null` disables. */
  pilotSensedVar?: string | null;
  /** Pilot input deadband (normalized, rescaled so ±1 still gives ±1). Default 0.01. */
  deadband?: number;
  /** Pilot gearing (surface per unit input), constant or vs IAS. Default 1. */
  gearing?: Schedule;
  /** Actuator power sources (each evaluates to 0..1). Omit for a mechanical control. */
  actuators?: Binding[];
  /** Pilot authority with all actuators lost. `null` = surface frozen. Default `{ authority: 0.5 }` when actuators exist (EST). */
  manualReversion?: { authority: Schedule } | null;
  /** Surface rate limit (full scale per second) when powered. Default 2.5 (EST). */
  rateLimit?: number;
  /** Rate limit in manual reversion. Default 1.0 (EST). */
  manualRateLimit?: number;
  /** Maximum |command| vs IAS (limiter). Default 1. */
  authority?: Schedule;
}

export interface MechanicalFlightControlsConfig {
  pitch?: ControlChannelConfig;
  roll?: ControlChannelConfig;
  yaw?: ControlChannelConfig;
  /** IAS var for schedules. Default adc1.ias_kt. */
  iasVar?: string;
}

const AXES: ControlAxis[] = ['pitch', 'roll', 'yaw'];
const DEF_INPUT: Record<ControlAxis, string> = { pitch: INPUT.pitch, roll: INPUT.roll, yaw: INPUT.yaw };
const DEF_OUTPUT: Record<ControlAxis, string> = { pitch: SURF.elevator, roll: SURF.aileron, yaw: SURF.rudder };
const DEF_ADDS: Record<ControlAxis, string[]> = {
  pitch: [FCS_VARS.apServo('pitch'), FCS_VARS.pusherCmd],
  roll: [FCS_VARS.apServo('roll')],
  yaw: [FCS_VARS.apServo('yaw'), FCS_VARS.ydCmd],
};

class Channel {
  surface = 0;
  readonly input: string;
  readonly output: string;
  readonly adds: string[];
  readonly sensed: string | null;
  readonly db: number;
  readonly gearing: Schedule;
  readonly actuators: Evaluator[];
  readonly actFail: string[];
  readonly manual: { authority: Schedule } | null;
  readonly rate: number;
  readonly manualRate: number;
  readonly authority: Schedule;
  readonly fJam: string;
  readonly oColumn: string;
  readonly oPower: string;
  readonly oManual: string;
  readonly oJam: string;

  constructor(vars: SimVars, readonly axis: ControlAxis, cfg: ControlChannelConfig) {
    this.input = cfg.input ?? DEF_INPUT[axis];
    this.output = cfg.output ?? DEF_OUTPUT[axis];
    this.adds = cfg.addVars ?? DEF_ADDS[axis];
    this.sensed = cfg.pilotSensedVar === null ? null : cfg.pilotSensedVar ?? (axis === 'yaw' ? null : FCS_VARS.apForceSensed(axis));
    this.db = cfg.deadband ?? 0.01;
    this.gearing = cfg.gearing ?? 1;
    this.actuators = (cfg.actuators ?? []).map((b) => compileBinding(vars, b, 1));
    this.actFail = (cfg.actuators ?? []).map((_, i) => failVar(`fcs.${axis}.actuator${i + 1}`));
    this.manual = cfg.manualReversion === undefined ? (this.actuators.length ? { authority: 0.5 } : null) : cfg.manualReversion;
    this.rate = cfg.rateLimit ?? 2.5;
    this.manualRate = cfg.manualRateLimit ?? 1.0;
    this.authority = cfg.authority ?? 1;
    this.fJam = failVar(`fcs.${axis}.jam`);
    this.oColumn = FCS_VARS.column(axis);
    this.oPower = FCS_VARS.power(axis);
    this.oManual = FCS_VARS.manual(axis);
    this.oJam = FCS_VARS.jammed(axis);
  }
}

export class MechanicalFlightControls implements Subsystem {
  readonly name = 'flight_controls';
  private readonly vars: SimVars;
  private readonly ch: Channel[];
  private readonly iasVar: string;

  constructor(env: BlockEnv, cfg: MechanicalFlightControlsConfig = {}) {
    this.vars = env.vars;
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.ch = AXES.map((a) => new Channel(env.vars, a, cfg[a] ?? {}));
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    for (const c of this.ch) {
      f.push({ id: `fcs.${c.axis}.jam`, name: `${c.axis} control jam`, category: 'flight controls', description: 'Surface frozen in its current position.' });
      c.actFail.forEach((_, i) =>
        f.push({ id: `fcs.${c.axis}.actuator${i + 1}`, name: `${c.axis} actuator ${i + 1}`, category: 'flight controls', description: 'Actuator (PCU) inoperative.' }),
      );
    }
    return f;
  }

  /** Current surface position of an axis (normalized). */
  surface(axis: ControlAxis): number {
    return this.ch[AXES.indexOf(axis)].surface;
  }

  reset(): void {
    for (const c of this.ch) c.surface = this.vars.get(c.output);
  }

  update(dt: number): void {
    const v = this.vars;
    const ias = v.get(this.iasVar);
    for (const c of this.ch) {
      // ---- actuator power
      let power = c.actuators.length === 0 ? 1 : 0;
      for (let i = 0; i < c.actuators.length; i++) {
        if (v.get(c.actFail[i]) !== 0) continue;
        let p = c.actuators[i]();
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        if (p > power) power = p;
      }
      const manual = c.actuators.length > 0 && power < 0.05;

      // ---- command
      const sensed = c.sensed !== null && v.get(c.sensed) !== 0;
      // Deadband rescaled so full deflection still gives full command.
      const pilot = sensed ? 0 : (deadband(v.get(c.input), c.db) / (1 - c.db)) * sched(c.gearing, ias);
      let cmd = pilot;
      if (!manual) for (let i = 0; i < c.adds.length; i++) cmd += v.get(c.adds[i]);
      else if (c.manual) cmd = pilot * sched(c.manual.authority, ias);
      const lim = sched(c.authority, ias);
      if (cmd > lim) cmd = lim;
      else if (cmd < -lim) cmd = -lim;
      v.set(c.oColumn, cmd);

      // ---- actuator dynamics
      const jam = v.get(c.fJam) !== 0;
      if (!jam && !(manual && c.manual === null)) {
        const rate = manual ? c.manualRate : c.rate * (power >= 0.5 ? 1 : power / 0.5);
        const step = rate * dt;
        const d = cmd - c.surface;
        c.surface += d > step ? step : d < -step ? -step : d;
      }
      v.set(c.output, c.surface);
      v.set(c.oPower, power);
      v.set(c.oManual, manual ? 1 : 0);
      v.set(c.oJam, jam ? 1 : 0);
    }
  }
}
