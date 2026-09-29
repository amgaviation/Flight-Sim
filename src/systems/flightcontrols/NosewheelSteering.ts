/**
 * Nosewheel steering: tiller and rudder-pedal steering with authority vs
 * ground speed, powered (hydraulic/electric) or mechanical.
 *
 *   command = tiller·tillerMax  (tiller has priority when deflected)
 *           + pedals·pedalMax·fade(GS)
 *   The wheel follows the command at `rateDegPerS`, only while the nose
 *   gear is on the ground (WOW) and steering is engaged and powered.
 *   Unpowered/disengaged: `unpowered: 'center'` returns the wheel to centre
 *   (centering cam), `'hold'` leaves it where it is. SCOPE: true free
 *   castering needs the FDM contact to be non-steerable; the aircraft's
 *   `GearContactConfig` decides that (castering && steerable = spring link).
 *
 * 737NG: rudder pedals ±7°, tiller ±78°, hydraulic system A (SmartCockpit
 * 737NG Landing Gear). Cessna 172S: mechanical, pedals ±10° via springs,
 * differential braking to ±30° (172S POH §7 "Ground Control").
 *
 * Vars written: gear.steer_deg (configurable), steer.cmd_deg, steer.engaged,
 * steer.powered. Failures: steer (steering inoperative).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { Table1D } from '../../physics/types';
import { GEAR, GPS, INPUT } from '../../core/vars';
import { interp1 } from '../../core/math';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';

export interface SteeringConfig {
  /** Output var. Default gear.steer_deg. */
  output?: string;
  tiller?: { input?: string; maxDeg: number };
  pedals?: { input?: string; maxDeg: number; /** Authority multiplier vs ground speed (kt). Default 1. */ fade?: Table1D };
  /** Hydraulic/electric power available. Default true (mechanical). */
  power?: Binding;
  /** Steering engaged (NWS switch, A/S armed, tow switch off...). Default true. */
  engage?: Binding;
  /** Weight-on-wheels of the steerable gear. Default gear.wow0 != 0. */
  wow?: Binding;
  /** Ground speed source (kt). Default gps.gs_kt with fallback gear.wheel_speed0_kt. */
  speedVar?: string;
  /** Wheel slew rate (deg/s). Default 25 (EST). */
  rateDegPerS?: number;
  /** Absolute wheel limit (deg). Default max(tiller, pedals). */
  maxDeg?: number;
  unpowered?: 'center' | 'hold';
}

export class NosewheelSteering implements Subsystem {
  readonly name = 'nosewheel_steering';
  angle = 0;
  private readonly vars: SimVars;
  private readonly cfg: SteeringConfig;
  private readonly power: () => boolean;
  private readonly engage: () => boolean;
  private readonly wow: () => boolean;
  private readonly out: string;
  private readonly tillerIn: string;
  private readonly pedalIn: string;
  private readonly speedVar: string;
  private readonly maxDeg: number;
  private readonly fail = failVar('steer');

  constructor(env: BlockEnv, cfg: SteeringConfig) {
    this.vars = env.vars;
    this.cfg = cfg;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.engage = compileCondition(env.vars, cfg.engage, true);
    this.wow = compileCondition(env.vars, cfg.wow ?? `${GEAR.weightOnWheels(0)} != 0`, false);
    this.out = cfg.output ?? GEAR.steerDeg;
    this.tillerIn = cfg.tiller?.input ?? INPUT.tiller;
    this.pedalIn = cfg.pedals?.input ?? INPUT.yaw;
    this.speedVar = cfg.speedVar ?? GPS.gs;
    this.maxDeg = cfg.maxDeg ?? Math.max(cfg.tiller?.maxDeg ?? 0, cfg.pedals?.maxDeg ?? 0);
  }

  failures(): FailureDef[] {
    return [{ id: 'steer', name: 'Nosewheel steering', category: 'gear', description: 'Steering inoperative: use differential braking.' }];
  }

  reset(): void {
    this.angle = this.vars.get(this.out);
  }

  update(dt: number): void {
    const v = this.vars;
    const powered = this.power() && v.get(this.fail) === 0;
    const engaged = this.engage() && powered;
    let cmd = 0;
    const t = this.cfg.tiller ? v.get(this.tillerIn) : 0;
    if (this.cfg.tiller && Math.abs(t) > 0.02) cmd = t * this.cfg.tiller.maxDeg;
    else if (this.cfg.pedals) {
      let gs = v.get(this.speedVar);
      if (!(gs > 0)) gs = Math.abs(v.get(GEAR.wheelSpeedKt(0)));
      const fade = this.cfg.pedals.fade ? interp1(this.cfg.pedals.fade, gs) : 1;
      cmd = v.get(this.pedalIn) * this.cfg.pedals.maxDeg * fade;
    }
    cmd = cmd > this.maxDeg ? this.maxDeg : cmd < -this.maxDeg ? -this.maxDeg : cmd;
    const onGround = this.wow();
    const step = (this.cfg.rateDegPerS ?? 25) * dt;
    if (engaged && onGround) {
      this.angle += clampStep(cmd - this.angle, step);
    } else if (!engaged && (this.cfg.unpowered ?? 'center') === 'center') {
      this.angle += clampStep(-this.angle, step);
    } else if (!onGround) {
      // Airborne: centering cam straightens the wheel for retraction.
      this.angle += clampStep(-this.angle, step);
    }
    v.set(this.out, this.angle);
    v.set('steer.cmd_deg', cmd);
    v.set('steer.engaged', engaged ? 1 : 0);
    v.set('steer.powered', powered ? 1 : 0);
  }
}

function clampStep(d: number, s: number): number {
  return d > s ? s : d < -s ? -s : d;
}
