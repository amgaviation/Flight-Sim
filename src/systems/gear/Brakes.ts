/**
 * Wheel brakes: pressure sources (normal / alternate / accumulator /
 * emergency), anti-skid, autobrake, parking brake, brake temperatures.
 *
 * Pressure path, per side (left/right):
 *   demand = max(toe pedal, parking brake, autobrake, emergency handle) 0..1
 *   metered pressure = demand · maxPsi, limited by the active source:
 *     the first source in `sources` with pressure >= `minSourcePsi`
 *     (737NG: normal = system B, alternate = system A, then the brake
 *     accumulator; SmartCockpit 737NG Landing Gear), else the accumulator.
 *   Emergency brake (Citation pneumatic): its own pressure, no anti-skid.
 *   Anti-skid only works on sources flagged `antiskid` and above
 *   `antiskid.minSpeedKt`.
 * Anti-skid (per side): slip = 1 − wheel/reference (reference = aircraft
 *   ground speed, `gps.gs_kt` by default). Above `slipThreshold` the side's
 *   release factor drops at `releaseRate` (pressure dumped so the wheel
 *   spins back up), below it recovers at `reapplyRate`. Touchdown
 *   protection: no brake pressure in the air (squat switch) until the
 *   wheels spin up or 3 s after touchdown. Locked-wheel protection: a wheel
 *   below 30 % of the reference is fully released.
 * Autobrake (737NG, flaps2approach "Autobrake System – Review and
 *   Procedures" quoting the FCOM): settings 1 / 2 / 3 / MAX target
 *   4 / 5 / 7.2 / 14 ft/s² (MAX: 12 ft/s² below 80 kt). Armed in the air
 *   with a landing setting; activates on the ground at main-wheel spin-up
 *   with the thrust levers at idle. Disarms: selector OFF, pedal braking
 *   (> `pedalDisarm`), speedbrake lever to DOWN, thrust levers advanced
 *   (except during the first 3 s after touchdown). RTO: armed on the ground;
 *   at a wheel speed above 90 kt, retarding the thrust levers to idle
 *   applies maximum pressure (SmartCockpit 737NG Landing Gear). Below 90 kt
 *   it stays armed but does not activate. Lift-off with RTO selected
 *   disarms it. The AUTO BRAKE DISARM light flashes 2 s on disarm and stays
 *   on for a malfunction (`fail.autobrake`) or landing with RTO selected.
 *   Control: PI on (target − measured) deceleration, measured from the
 *   filtered derivative of the ground speed.
 * Parking brake: `parking.var` set -> full pressure from the accumulator
 *   ('hydraulic') or full brake ('mechanical', light aircraft).
 * Accumulator (optional): isothermal gas spring (precharge, max pressure),
 *   charged by `chargeFrom` through a check valve, drained by brake
 *   applications (EST fluid per psi) and a slow internal leak.
 * Temperatures: heat = brake fraction · μ · (m·g/2) · wheel speed per side
 *   into `heatCapacityJPerK`; Newtonian cooling with `coolingTauS`.
 *
 * Vars written: gear.brake_left/right (0..1 of maxPsi after anti-skid),
 * brakes.psi_left/right, brakes.accum_psi, brakes.source (index into
 * `sources`, -1 accumulator, -2 none), brakes.parking_set,
 * brakes.antiskid_inop, brakes.antiskid_left/right (1 while releasing),
 * brakes.autobrake_armed, brakes.autobrake_active, brakes.autobrake_mode
 * (string label), brakes.ab_disarm (light), brakes.decel_fps2,
 * brakes.temp_left_c/right_c.
 * Failures: brakes.antiskid, autobrake, brakes.left / brakes.right (no
 * pressure on that side).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { FDM, GEAR, GPS, INPUT } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { Pid, RateFilter, type BlockEnv } from '../autopilot/lib';

/** Knots per second to feet per second squared. */
export const KTS_TO_FPS2 = 1852 / 0.3048 / 3600;

export interface BrakeSourceDef {
  id: string;
  /** Pressure available (psi). */
  pressurePsi: Binding;
  /** Anti-skid available through this source. Default true. */
  antiskid?: boolean;
  /** Autobrake available through this source. Default true for the first source only. */
  autobrake?: boolean;
}

export interface AutobrakeLevel {
  /** Selector var value. */
  value: number;
  label: string;
  /** Landing target deceleration (ft/s²). */
  decelFps2?: number;
  /** Target below `lowSpeedKt` (e.g. 737 MAX: 12 ft/s² below 80 kt). */
  decelLowFps2?: number;
  lowSpeedKt?: number;
  /** Rejected-takeoff setting. */
  rto?: boolean;
}

export interface AutobrakeConfig {
  selectorVar?: string;
  offValue?: number;
  levels: AutobrakeLevel[];
  /** All thrust levers at idle. */
  thrustIdle: Binding;
  /** Any thrust lever advanced. Default !thrustIdle. */
  thrustAdvanced?: Binding;
  /** Speedbrake lever in the DOWN detent (disarm on the ground). Omit if not applicable. */
  speedbrakeDown?: Binding;
  /** Pedal deflection that disarms (0..1). Default 0.25 (EST). */
  pedalDisarm?: number;
  /** RTO activation wheel speed (kt). Default 90. */
  rtoSpeedKt?: number;
  /** Main-wheel spin-up speed that activates landing autobrake (kt). Default 60. */
  spinupKt?: number;
  /** Landing setting may be armed on the ground above this ground speed (kt). Default 30 (SmartCockpit 737NG). */
  armAfterTouchdownKt?: number;
  /** Max pressure the autobrake may apply (psi). Default maxPsi. */
  maxPsi?: number;
}

export interface BrakeConfig {
  pedals?: { left?: string; right?: string };
  sources: BrakeSourceDef[];
  /** Metered pressure at full pedal (psi). */
  maxPsi: number;
  /** A source counts as available above this pressure (psi). Default 1000 (EST). */
  minSourcePsi?: number;
  accumulator?: {
    chargeFrom: Binding;
    prechargePsi: number;
    maxPsi: number;
    /** Full brake applications from full charge (EST). Default 6. */
    applications?: number;
    /** Anti-skid available when braking on the accumulator. Default true (737: accumulator on the normal system). */
    antiskid?: boolean;
  };
  parking?: { var?: string; kind?: 'hydraulic' | 'mechanical' };
  emergency?: { var: string; pressurePsi?: Binding };
  antiskid?: {
    enabled: Binding;
    wheels?: { left: string[]; right: string[] };
    referenceVar?: string;
    slipThreshold?: number;
    releaseRate?: number;
    reapplyRate?: number;
    minSpeedKt?: number;
  };
  autobrake?: AutobrakeConfig;
  /** Air/ground (squat). Default gear.air_ground. */
  onGround?: Binding;
  temperature?: { heatCapacityJPerK: number; coolingTauS?: number; mu?: number };
}

class Side {
  asFactor = 1;
  psi = 0;
  temp = 15;
  releasing = false;
  constructor(readonly wheels: string[], readonly fail: string, readonly out: string, readonly oPsi: string, readonly oAs: string, readonly oTemp: string) {}
}

export class Brakes implements Subsystem {
  readonly name = 'brakes';
  accumPsi: number;
  abArmed = false;
  abActive = false;
  private readonly vars: SimVars;
  private readonly cfg: BrakeConfig;
  private readonly sources: { psi: Evaluator; antiskid: boolean; autobrake: boolean }[];
  private readonly accCharge: Evaluator;
  private readonly asEnabled: () => boolean;
  private readonly ground: () => boolean;
  private readonly abIdle: () => boolean;
  private readonly abAdvanced: () => boolean;
  private readonly abSbDown: (() => boolean) | null;
  private readonly emergPsi: Evaluator;
  private readonly sides: [Side, Side];
  private readonly pedalL: string;
  private readonly pedalR: string;
  private readonly refVar: string;
  private readonly parkVar: string;
  private readonly abSel: string;
  private readonly decelRate = new RateFilter(0.4);
  private readonly abPid = new Pid({ kp: 0.08, ki: 0.12, iLimit: 12, outLimit: 1 });
  private touchdownT = -1;
  private wasGround = true;
  private tdProtect = 0;
  private disarmFlash = 0;
  private abLevel = -1;
  /** Landing setting selected on the ground at low speed: arms once airborne. */
  private abPending = false;
  private rtoRiskArmed = false;
  private prevSel = NaN;
  private prevSbDown = true;
  private prevAppliedL = 0;
  private prevAppliedR = 0;
  private readonly fAs = failVar('brakes.antiskid');
  private readonly fAb = failVar('autobrake');

  constructor(env: BlockEnv, cfg: BrakeConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.sources = cfg.sources.map((s, i) => ({
      psi: compileBinding(v, s.pressurePsi, 0),
      antiskid: s.antiskid ?? true,
      autobrake: s.autobrake ?? i === 0,
    }));
    this.accCharge = compileBinding(v, cfg.accumulator?.chargeFrom, 0);
    this.accumPsi = cfg.accumulator ? v.get('brakes.accum_psi', cfg.accumulator.maxPsi) : 0;
    this.asEnabled = compileCondition(v, cfg.antiskid?.enabled, false);
    this.ground = compileCondition(v, cfg.onGround ?? 'gear.air_ground', false);
    const ab = cfg.autobrake;
    this.abIdle = compileCondition(v, ab?.thrustIdle, false);
    const idle = this.abIdle;
    this.abAdvanced = ab?.thrustAdvanced !== undefined ? compileCondition(v, ab.thrustAdvanced) : () => !idle();
    this.abSbDown = ab?.speedbrakeDown !== undefined ? compileCondition(v, ab.speedbrakeDown) : null;
    this.emergPsi = compileBinding(v, cfg.emergency?.pressurePsi, cfg.maxPsi);
    const wl = cfg.antiskid?.wheels?.left ?? [GEAR.wheelSpeedKt(1)];
    const wr = cfg.antiskid?.wheels?.right ?? [GEAR.wheelSpeedKt(2)];
    this.sides = [
      new Side(wl, failVar('brakes.left'), GEAR.brakeLeft, 'brakes.psi_left', 'brakes.antiskid_left', 'brakes.temp_left_c'),
      new Side(wr, failVar('brakes.right'), GEAR.brakeRight, 'brakes.psi_right', 'brakes.antiskid_right', 'brakes.temp_right_c'),
    ];
    this.pedalL = cfg.pedals?.left ?? INPUT.brakeLeft;
    this.pedalR = cfg.pedals?.right ?? INPUT.brakeRight;
    this.refVar = cfg.antiskid?.referenceVar ?? GPS.gs;
    this.parkVar = cfg.parking?.var ?? 'ac.parking_brake';
    this.abSel = ab?.selectorVar ?? 'ac.autobrake_sel';
    this.wasGround = this.ground();
  }

  failures(): FailureDef[] {
    const c = 'brakes';
    const f: FailureDef[] = [
      { id: 'brakes.left', name: 'Left brakes', category: c, description: 'No brake pressure on the left side.' },
      { id: 'brakes.right', name: 'Right brakes', category: c, description: 'No brake pressure on the right side.' },
    ];
    if (this.cfg.antiskid) f.push({ id: 'brakes.antiskid', name: 'Anti-skid', category: c, description: 'Anti-skid inoperative (ANTISKID INOP).' });
    if (this.cfg.autobrake) f.push({ id: 'autobrake', name: 'Autobrake', category: c, description: 'Autobrake inoperative (AUTO BRAKE DISARM light).' });
    return f;
  }

  reset(): void {
    this.abArmed = false;
    this.abActive = false;
    this.abLevel = -1;
    this.touchdownT = -1;
    this.wasGround = this.ground();
    this.decelRate.reset();
    this.abPid.reset(0);
    for (const s of this.sides) {
      s.asFactor = 1;
      s.psi = 0;
    }
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const onGround = this.ground();
    const ref = Math.max(0, v.get(this.refVar));
    const refDecel = -this.decelRate.update(ref, dt) * KTS_TO_FPS2;
    v.set('brakes.decel_fps2', refDecel);

    // ---- touchdown / liftoff bookkeeping
    if (onGround && !this.wasGround) {
      this.touchdownT = 0;
      this.tdProtect = 3;
    }
    if (!onGround) this.touchdownT = -1;
    else if (this.touchdownT >= 0) this.touchdownT += dt;
    if (this.tdProtect > 0) this.tdProtect = Math.max(0, this.tdProtect - dt);

    // ---- sources
    const minPsi = cfg.minSourcePsi ?? 1000;
    let srcIdx = -2;
    let srcPsi = 0;
    for (let i = 0; i < this.sources.length; i++) {
      const p = this.sources[i].psi();
      if (p >= minPsi) {
        srcIdx = i;
        srcPsi = p;
        break;
      }
    }
    const acc = cfg.accumulator;
    if (acc) {
      const charge = this.accCharge();
      if (charge > this.accumPsi) this.accumPsi += (Math.min(charge, acc.maxPsi) - this.accumPsi) * (1 - Math.exp(-dt / 2));
      this.accumPsi -= this.accumPsi * dt * (1 / (8 * 3600)); // EST: slow internal leak (8 h time constant)
      if (srcIdx === -2 && this.accumPsi > acc.prechargePsi * 1.01) {
        srcIdx = -1;
        srcPsi = this.accumPsi;
      }
    }
    const src = srcIdx >= 0 ? this.sources[srcIdx] : null;
    const viaAccumAs = srcIdx === -1 && (acc?.antiskid ?? true);
    const asAvail = !!cfg.antiskid && this.asEnabled() && v.get(this.fAs) === 0 && (src ? src.antiskid : viaAccumAs);

    // ---- demand
    let dL = v.get(this.pedalL);
    let dR = v.get(this.pedalR);
    const pedalMax = Math.max(dL, dR);
    const parkSet = v.get(this.parkVar) !== 0;
    if (parkSet) {
      dL = 1;
      dR = 1;
    }

    // ---- autobrake
    const abDemand = this.autobrake(dt, onGround, ref, refDecel, pedalMax, src !== null && src.autobrake);
    if (abDemand > dL) dL = abDemand;
    if (abDemand > dR) dR = abDemand;

    // ---- per side pressure + anti-skid
    const emergency = cfg.emergency ? v.get(cfg.emergency.var) : 0;
    const aS = cfg.antiskid;
    const minAsKt = aS?.minSpeedKt ?? 10;
    const accPrev = this.accumPsi;
    for (let k = 0; k < 2; k++) {
      const s = this.sides[k];
      const demand = k === 0 ? dL : dR;
      let psi = Math.min(demand * cfg.maxPsi, srcPsi);
      if (cfg.parking?.kind === 'mechanical' && parkSet) psi = cfg.maxPsi;
      // Anti-skid
      s.releasing = false;
      if (asAvail && aS) {
        let wheel = Infinity;
        for (let i = 0; i < s.wheels.length; i++) wheel = Math.min(wheel, Math.abs(v.get(s.wheels[i])));
        if (!Number.isFinite(wheel)) wheel = ref;
        if (!onGround && psi > 0 && !parkSet) {
          psi = 0; // touchdown protection: no pressure before wheel spin-up
        } else if (this.tdProtect > 0 && wheel < 0.5 * ref && ref > minAsKt) {
          psi = 0;
        } else if (ref > minAsKt) {
          const slip = 1 - wheel / ref;
          if (slip > (aS.slipThreshold ?? 0.12) || wheel < 0.3 * ref) {
            s.asFactor = Math.max(0, s.asFactor - (aS.releaseRate ?? 6) * dt);
            s.releasing = true;
          } else {
            s.asFactor = Math.min(1, s.asFactor + (aS.reapplyRate ?? 1.5) * dt);
          }
          psi *= s.asFactor;
        } else s.asFactor = 1;
      } else s.asFactor = 1;
      // Emergency / pneumatic brake: bypasses anti-skid
      if (emergency > 0) psi = Math.max(psi, Math.min(emergency * cfg.maxPsi, this.emergPsi()));
      if (v.get(s.fail) !== 0) psi = 0;
      s.psi = psi;
      v.set(s.out, cfg.maxPsi > 0 ? psi / cfg.maxPsi : 0);
      v.set(s.oPsi, psi);
      v.set(s.oAs, s.releasing ? 1 : 0);
    }

    // ---- accumulator consumption (fluid per applied pressure increase)
    if (acc && srcIdx === -1) {
      const apps = acc.applications ?? 6;
      const perPsi = (acc.maxPsi - acc.prechargePsi) / (apps * 2 * acc.maxPsi);
      const inc = Math.max(0, this.sides[0].psi - this.prevAppliedL) + Math.max(0, this.sides[1].psi - this.prevAppliedR);
      this.accumPsi = Math.max(acc.prechargePsi * 0.98, accPrev - inc * perPsi);
    }
    this.prevAppliedL = this.sides[0].psi;
    this.prevAppliedR = this.sides[1].psi;

    // ---- temperatures
    const t = cfg.temperature;
    if (t) {
      const mass = v.get(FDM.mass);
      const mu = t.mu ?? 0.35;
      for (let k = 0; k < 2; k++) {
        const s = this.sides[k];
        let wheel = 0;
        for (let i = 0; i < s.wheels.length; i++) wheel = Math.max(wheel, Math.abs(v.get(s.wheels[i])));
        const frac = cfg.maxPsi > 0 ? s.psi / cfg.maxPsi : 0;
        const power = onGround ? frac * mu * mass * 9.80665 * 0.5 * wheel * 0.514444 : 0;
        s.temp += (power * dt) / t.heatCapacityJPerK;
        const amb = v.get(FDM.sat, 15);
        s.temp += (amb - s.temp) * (1 - Math.exp(-dt / (t.coolingTauS ?? 1800)));
        v.set(s.oTemp, s.temp);
      }
    }

    v.set('brakes.accum_psi', this.accumPsi);
    v.set('brakes.source', srcIdx);
    v.set('brakes.parking_set', parkSet ? 1 : 0);
    v.set('brakes.antiskid_inop', cfg.antiskid && !(this.asEnabled() && v.get(this.fAs) === 0) ? 1 : 0);
    this.wasGround = onGround;
  }

  /** Returns the autobrake demand 0..1 and updates the arming/activation state. */
  private autobrake(dt: number, onGround: boolean, ref: number, decel: number, pedal: number, sourceOk: boolean): number {
    const ab = this.cfg.autobrake;
    const v = this.vars;
    if (!ab) return 0;
    const sel = v.get(this.abSel);
    const failed = v.get(this.fAb) !== 0;
    let level = -1;
    if (sel !== (ab.offValue ?? 0)) {
      for (let i = 0; i < ab.levels.length; i++) if (Math.abs(ab.levels[i].value - sel) < 0.01) level = i;
    }
    const lv = level >= 0 ? ab.levels[level] : null;
    let disarm = false;
    if (this.disarmFlash > 0) this.disarmFlash = Math.max(0, this.disarmFlash - dt);
    const selChanged = sel !== this.prevSel;
    this.prevSel = sel;

    // ---- arming
    if (!lv || failed) {
      if (this.abArmed || this.abActive) disarm = true;
      this.abArmed = false;
      this.abActive = false;
    } else if (selChanged) {
      // Re-arm on selection: landing modes arm in the air (or on the ground above the arm speed), RTO on the ground.
      const canLandArm = !onGround || ref > (ab.armAfterTouchdownKt ?? 30);
      this.abArmed = lv.rto ? onGround : canLandArm;
      this.abPending = !lv.rto && !canLandArm;
      this.abActive = false;
      this.abLevel = level;
    }
    if (!lv || failed) this.abPending = false;
    if (this.abPending && !onGround) {
      this.abPending = false;
      this.abArmed = true;
    }
    if (lv && lv.rto && !onGround && (this.abArmed || this.abActive)) {
      // Lift-off with RTO selected disarms it.
      this.abArmed = false;
      this.abActive = false;
      disarm = true;
    }

    // ---- activation
    let wheel = 0;
    for (const s of this.sides) for (let i = 0; i < s.wheels.length; i++) wheel = Math.max(wheel, Math.abs(v.get(s.wheels[i])));
    const idle = this.abIdle();
    if (this.abArmed && lv && onGround) {
      if (lv.rto) {
        if (wheel > (ab.rtoSpeedKt ?? 90)) this.rtoRiskArmed = true;
        if (this.rtoRiskArmed && idle) {
          this.abActive = true;
          this.abArmed = false;
        }
      } else if (idle && wheel > (ab.spinupKt ?? 60)) {
        this.abActive = true;
        this.abArmed = false;
        this.abPid.reset(0.3);
      }
    }
    if (!onGround) this.rtoRiskArmed = false;

    // ---- disarm while active/armed
    const sbDownNow = this.abSbDown !== null && this.abSbDown();
    const sbStowed = sbDownNow && !this.prevSbDown && onGround;
    this.prevSbDown = sbDownNow;
    if ((this.abActive || this.abArmed) && lv) {
      const pedalDisarm = pedal > (ab.pedalDisarm ?? 0.25);
      // Thrust advance disarms an active autobrake (landing: except the first 3 s after touchdown).
      const thrust = this.abActive && this.abAdvanced() && (lv.rto === true || !(this.touchdownT >= 0 && this.touchdownT < 3));
      // Speedbrake lever moved to DOWN on the ground after landing.
      const sbDown = sbStowed && this.abActive && !lv.rto;
      if (pedalDisarm || (thrust && onGround) || sbDown) {
        this.abActive = false;
        this.abArmed = false;
        this.abPending = false;
        disarm = true;
      }
    }
    if (disarm) this.disarmFlash = 2;
    const rtoOnLanding = !!lv && lv.rto === true && onGround && this.touchdownT >= 0 && this.touchdownT < 10 && !this.abActive;
    v.set('brakes.autobrake_armed', this.abArmed ? 1 : 0);
    v.set('brakes.autobrake_active', this.abActive ? 1 : 0);
    v.setString('brakes.autobrake_mode', lv ? lv.label : 'OFF');
    v.set('brakes.ab_disarm', this.disarmFlash > 0 || failed || rtoOnLanding ? 1 : 0);

    if (!this.abActive || !lv || !sourceOk) return 0;
    const maxFrac = (ab.maxPsi ?? this.cfg.maxPsi) / this.cfg.maxPsi;
    if (lv.rto) return maxFrac;
    let target = lv.decelFps2 ?? 6;
    if (lv.decelLowFps2 !== undefined && ref < (lv.lowSpeedKt ?? 80)) target = lv.decelLowFps2;
    if (ref < 3) return this.abPid.output; // stopped: hold the pressure until disarmed
    return Math.min(maxFrac, Math.max(0, this.abPid.update(target - decel, dt)));
  }
}
