/**
 * Fly-by-wire primary flight control computer, Gulfstream G650/G800 style
 * (yokes, conventional-feel "C*U" pitch law, roll-rate command, envelope
 * protections, automatic stabilizer trim).
 *
 * Public references: Gulfstream G650 FBW has Normal, Alternate and Direct
 * modes (plus maintenance); protections include AoA limiting (onset
 * ~0.88–0.93 normalized AoA, max ~0.95 with full aft yoke) and bank-angle
 * protection that returns the aircraft to 33° when the yoke is released
 * (SmartCockpit G650 Flight Controls quiz; code7700.com "Alpha
 * Protection"; Gulfstream news "G650 flight evaluates FBW in electric
 * backup mode"). Exact gains are proprietary: every gain below is EST and
 * tunable from the config.
 *
 * NORMAL law
 *   Pitch: yoke -> load-factor increment command
 *            Δnz_cmd = s·(nzMax−1) (aft) / s·(1−nzMin)·(−1) (fwd)
 *          plus speed stability ("U"): Δnz += Ku·(IAS − Uref); the pitch
 *          trim switch moves the reference speed Uref (trim for speed like a
 *          conventional aircraft); Uref follows IAS while the AP is engaged
 *          and on the ground. 1-g compensation up to 33° of bank.
 *          Protections limit Δnz: AoA (α → αmax), high speed (nose-up
 *          above Vmo+6 / Mmo+0.01), pitch attitude (+30/−15°, EST).
 *          Control: elevator = PI(Δnz error) − Kq·q, gains scaled by
 *          (Vref/IAS)²; the integrator is continuously offloaded into the
 *          stabilizer (auto-trim) so the elevator stays near neutral.
 *   Roll:  yoke -> roll-rate command (maxRollRate at full deflection); yoke
 *          released -> bank hold; beyond `bankHoldDeg` (33°) the bank returns
 *          to 33° when released and the available roll rate fades to zero
 *          at `maxBankDeg`.
 *   Yaw:   pedals direct + yaw damper (washed-out yaw rate) + turn
 *          coordination (lateral acceleration feedback).
 *   Ground: direct pitch law until lift-off (the stabilizer is set by the
 *          trim switch for takeoff), blending into normal law.
 * ALTERNATE (air data or inertial data invalid, or selected): direct laws
 *   with gains scheduled on flap position, yaw damper if rates are valid,
 *   trim switch drives the stabilizer, no protections.
 * DIRECT (FCC failure `fail.fbw.fcc`, no FCC power, or selected): fixed
 *   gearing, trim switch drives the stabilizer, no yaw damper.
 *
 * The AFCS drives the FBW through `ap.servo_pitch/roll/yaw` treated as yoke
 * equivalents (the G650 autopilot commands through the FCC).
 *
 * Vars read: input.pitch/roll/yaw, input.pitch_trim_rate, ap.servo_*,
 * ahrs1.pitch_deg/bank_deg/p/q/r_dps/nz_g/ny_g, adc1.ias_kt/mach/aoa_deg,
 * surf.flaps_deg, gear.air_ground, validity/power bindings.
 * Vars written: surf.elevator/aileron/rudder/pitch_trim, trim.pitch_units,
 * fbw.mode (string NORMAL/ALTERNATE/DIRECT), fbw.mode_code (0/1/2),
 * fbw.aoa_limit, fbw.hs_protect, fbw.bank_protect, fbw.pitch_protect,
 * fbw.ground_law, fbw.speed_ref_kt, fbw.nz_cmd.
 * Failures: fbw.fcc (-> DIRECT), fbw.adc_data (-> ALTERNATE).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { Table1D } from '../../physics/types';
import { ADC, AP, INPUT, SURF } from '../../core/vars';
import { interp1 } from '../../core/math';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { Pid, Washout, sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';
import { FCS_VARS } from './vars';

export type FbwMode = 'NORMAL' | 'ALTERNATE' | 'DIRECT';

export interface FlyByWireConfig {
  /** FCC power (any channel). */
  power: Binding;
  /** Actuator power per axis (each binding 0..1; best one wins; include the EBHAs). Default always powered. */
  actuators?: { pitch?: Binding[]; roll?: Binding[]; yaw?: Binding[] };
  /** Pilot mode selection var: 0 auto, 1 ALTERNATE, 2 DIRECT. Default ac.fcs_mode_sel. */
  modeSelectVar?: string;
  /** Air data valid. Default adc1.valid. */
  airDataValid?: Binding;
  /** Inertial data valid. Default ahrs1.att_valid. */
  inertialValid?: Binding;
  /** On ground (squat). Default gear.air_ground. */
  onGround?: Binding;
  pitch: {
    /** Max load factor (g) vs flap angle. Default 2.5 clean, 2.0 flaps (14 CFR 25.337 limits). */
    nzMax?: Table1D;
    nzMin?: Table1D;
    /** Speed-stability gain (g per kt). Default 0.01 (EST). */
    speedGain?: number;
    /** Reference-speed trim rate (kt/s at full trim switch). Default 4 (EST). */
    trimRateKtPerS?: number;
    /** Max AoA (deg) vs flaps: the AoA limiter holds α below this. */
    alphaMax: Table1D;
    /** AoA-limiter onset as a fraction of alphaMax. Default 0.9 (code7700: 0.88–0.93 NAOA). */
    alphaOnset?: number;
    vmoKt: Schedule;
    mmo: number;
    pitchUpLimitDeg?: number;
    pitchDownLimitDeg?: number;
    /** PI gains on load-factor error (elevator per g, per g·s) and pitch damping (elevator per deg/s) at `gainRefKt`. */
    kp?: number;
    ki?: number;
    kq?: number;
    /** Stabilizer auto-trim rate (normalized trim per second). Default 0.03 (EST). */
    stabRate?: number;
    /** Stabilizer display range (units) for trim.pitch_units, mapped linearly to -1..1. Default [-1, 1]. */
    stabUnits?: [number, number];
  };
  roll: {
    /** Max commanded roll rate (deg/s). Default 15 (EST). */
    maxRateDps?: number;
    bankHoldDeg?: number;
    maxBankDeg?: number;
    kp?: number;
    ki?: number;
  };
  yaw?: { yawDampGain?: number; turnCoordGain?: number; washoutS?: number };
  /** Direct/alternate gearing (surface per unit yoke) — constant or vs flap angle for pitch in ALTERNATE. */
  direct?: { pitch?: Schedule; roll?: number; yaw?: number; stabRate?: number };
  /** Reference IAS for the gain schedule (kt). Default 250. */
  gainRefKt?: number;
}

export class FlyByWire implements Subsystem {
  readonly name = 'fbw';
  mode: FbwMode = 'NORMAL';
  /** Stabilizer position (normalized trim). */
  stab = 0;
  /** Trim reference speed (kt). */
  uRef = 0;
  private readonly vars: SimVars;
  private readonly cfg: FlyByWireConfig;
  private readonly power: () => boolean;
  private readonly adcOk: () => boolean;
  private readonly irsOk: () => boolean;
  private readonly ground: () => boolean;
  private readonly act: { pitch: Evaluator[]; roll: Evaluator[]; yaw: Evaluator[] };
  private readonly modeSel: string;
  private readonly pitchPid: Pid;
  private readonly rollPid: Pid;
  private readonly yawWashout: Washout;
  private elev = 0;
  private ail = 0;
  private rud = 0;
  private bankRef = 0;
  private bankHolding = false;
  private wasGround = true;
  private readonly fFcc = failVar('fbw.fcc');
  private readonly fAdc = failVar('fbw.adc_data');

  constructor(env: BlockEnv, cfg: FlyByWireConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.power = compileCondition(v, cfg.power, true);
    this.adcOk = compileCondition(v, cfg.airDataValid ?? ADC.valid(1), true);
    this.irsOk = compileCondition(v, cfg.inertialValid ?? SENSOR_VARS.attValid(1), true);
    this.ground = compileCondition(v, cfg.onGround ?? 'gear.air_ground', false);
    const mk = (b?: Binding[]): Evaluator[] => (b ?? []).map((x) => compileBinding(v, x, 1));
    this.act = { pitch: mk(cfg.actuators?.pitch), roll: mk(cfg.actuators?.roll), yaw: mk(cfg.actuators?.yaw) };
    this.modeSel = cfg.modeSelectVar ?? 'ac.fcs_mode_sel';
    const p = cfg.pitch;
    this.pitchPid = new Pid({ kp: p.kp ?? 0.35, ki: p.ki ?? 0.5, iLimit: 1 / Math.max(1e-6, p.ki ?? 0.5), outLimit: 1 });
    const r = cfg.roll;
    this.rollPid = new Pid({ kp: r.kp ?? 0.04, ki: r.ki ?? 0.02, iLimit: 10, outLimit: 1 });
    this.yawWashout = new Washout(cfg.yaw?.washoutS ?? 3);
    this.stab = v.get(SURF.pitchTrim);
  }

  failures(): FailureDef[] {
    return [
      { id: 'fbw.fcc', name: 'Flight control computers', category: 'flight controls', description: 'FCCs fail: DIRECT mode (backup).' },
      { id: 'fbw.adc_data', name: 'FBW air data', category: 'flight controls', description: 'Air data to the FCCs lost: ALTERNATE mode.' },
    ];
  }

  reset(): void {
    const v = this.vars;
    this.stab = v.get(SURF.pitchTrim);
    this.uRef = v.get(ADC.ias(1));
    this.pitchPid.reset(v.get(SURF.elevator));
    this.rollPid.reset(0);
    this.elev = v.get(SURF.elevator);
    this.ail = 0;
    this.rud = 0;
    this.bankHolding = false;
    this.wasGround = this.ground();
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    // ---- mode
    const sel = v.get(this.modeSel);
    const fccOk = this.power() && v.get(this.fFcc) === 0;
    const dataOk = this.adcOk() && this.irsOk() && v.get(this.fAdc) === 0;
    let mode: FbwMode;
    if (!fccOk || sel >= 2) mode = 'DIRECT';
    else if (!dataOk || sel >= 1) mode = 'ALTERNATE';
    else mode = 'NORMAL';
    if (mode !== this.mode) {
      // Bumpless: preload the integrators with the current surfaces.
      this.pitchPid.reset(this.elev);
      this.rollPid.reset(0);
    }
    this.mode = mode;

    const flaps = v.get(SURF.flapsDeg);
    const ias = v.get(ADC.ias(1));
    const onGround = this.ground();
    const yoke = v.get(INPUT.pitch) + v.get(FCS_VARS.apServo('pitch'));
    const wheel = v.get(INPUT.roll) + v.get(FCS_VARS.apServo('roll'));
    const pedal = v.get(INPUT.yaw) + v.get(FCS_VARS.apServo('yaw'));
    const trimSw = v.get(INPUT.pitchTrimRate);
    const apOn = v.get(AP.engaged) !== 0;

    let aoaLim = false;
    let hsProt = false;
    let bankProt = false;
    let pitchProt = false;
    let nzCmdOut = 1;
    const d = cfg.direct ?? {};
    const directStabRate = d.stabRate ?? 0.05;

    if (mode === 'NORMAL' && !onGround) {
      const p = cfg.pitch;
      const theta = v.get(ADC.pitch(1));
      const phi = v.get(ADC.bank(1));
      const q = v.get(SENSOR_VARS.q(1));
      const nz = v.get(SENSOR_VARS.nz(1));
      const alpha = v.get(SENSOR_VARS.aoa(1));
      const mach = v.get(ADC.mach(1));
      if (this.wasGround) {
        // Lift-off: start the flight law from the current state.
        this.pitchPid.reset(this.elev);
        this.uRef = ias;
        this.bankRef = phi;
      }
      // Reference speed (U): trim switch moves it, AP engagement keeps it synchronised.
      if (apOn) this.uRef = ias;
      else this.uRef -= trimSw * (p.trimRateKtPerS ?? 4) * dt;
      const nzMax = p.nzMax ? interp1(p.nzMax, flaps) : flaps > 0.5 ? 2.0 : 2.5;
      const nzMin = p.nzMin ? interp1(p.nzMin, flaps) : flaps > 0.5 ? 0 : -1;
      let dnz = yoke >= 0 ? yoke * (nzMax - 1) : yoke * (1 - nzMin);
      // Faster than the trim reference -> nose up (positive speed stability).
      if (!apOn) dnz += (p.speedGain ?? 0.01) * (ias - this.uRef);
      // Protections.
      const aMax = interp1(p.alphaMax, flaps);
      const onset = aMax * (p.alphaOnset ?? 0.9);
      if (alpha > onset) {
        const lim = 0.15 * (aMax - alpha) - 0.05 * q; // EST: 0.15 g/deg, with rate anticipation
        if (dnz > lim) {
          dnz = lim;
          aoaLim = true;
        }
      }
      const vmo = sched(p.vmoKt, v.get(SENSOR_VARS.pressAlt(1)));
      const over = Math.max(ias - (vmo + 6), (mach - (p.mmo + 0.01)) * 600);
      if (over > 0) {
        dnz = Math.max(dnz, 0.02 * over);
        hsProt = true;
      }
      const up = p.pitchUpLimitDeg ?? 30;
      const dn = p.pitchDownLimitDeg ?? -15;
      if (theta > up - 5 && dnz > 0.1 * (up - theta)) {
        dnz = 0.1 * (up - theta);
        pitchProt = true;
      } else if (theta < dn + 5 && dnz < 0.1 * (dn - theta)) {
        dnz = 0.1 * (dn - theta);
        pitchProt = true;
      }
      const c = Math.cos((Math.min(Math.abs(phi), 33) * Math.PI) / 180);
      const nzCmd = 1 / c + dnz;
      nzCmdOut = nzCmd;
      const gs = this.gainScale(ias);
      this.pitchPid.kp = (p.kp ?? 0.35) * gs;
      this.pitchPid.ki = (p.ki ?? 0.5) * gs;
      const e = nzCmd - nz;
      this.elev = this.pitchPid.update(e, dt) - (p.kq ?? 0.02) * gs * q;
      // Auto-trim: offload the integrator into the stabilizer.
      const iOut = this.pitchPid.ki * this.pitchPid.integral;
      if (Math.abs(iOut) > 0.02) {
        const step = Math.sign(iOut) * (p.stabRate ?? 0.03) * dt;
        this.stab = clamp1(this.stab + step);
      }

      // ---- roll (rate command, bank hold / protection)
      const r = cfg.roll;
      const maxRate = r.maxRateDps ?? 15;
      const hold = r.bankHoldDeg ?? 33;
      const maxBank = r.maxBankDeg ?? 67;
      const pRate = v.get(SENSOR_VARS.p(1));
      let pCmd: number;
      if (Math.abs(wheel) > 0.05) {
        this.bankHolding = false;
        pCmd = wheel * maxRate;
        if (Math.sign(pCmd) === Math.sign(phi) && Math.abs(phi) > hold) {
          pCmd *= Math.max(0, (maxBank - Math.abs(phi)) / (maxBank - hold));
          bankProt = true;
        }
      } else {
        if (!this.bankHolding) {
          this.bankHolding = true;
          this.bankRef = phi;
        }
        if (Math.abs(this.bankRef) > hold) {
          this.bankRef = Math.sign(this.bankRef) * hold;
          bankProt = true;
        }
        if (Math.abs(phi) > hold + 1) bankProt = true;
        pCmd = clamp(1.0 * (this.bankRef - phi), -maxRate / 3, maxRate / 3);
      }
      this.rollPid.kp = (r.kp ?? 0.04) * gs;
      this.rollPid.ki = (r.ki ?? 0.02) * gs;
      this.ail = this.rollPid.update(pCmd - pRate, dt) + 0.02 * gs * pCmd;
      this.ail = clamp1(this.ail);

      // ---- yaw
      const y = cfg.yaw ?? {};
      const rRate = v.get(SENSOR_VARS.r(1));
      const ny = v.get(SENSOR_VARS.ny(1));
      this.rud = clamp1(pedal - (y.yawDampGain ?? 0.02) * this.yawWashout.update(rRate, dt) - (y.turnCoordGain ?? 0.5) * ny);
    } else {
      // Ground law / ALTERNATE / DIRECT: proportional gearing.
      const pg = sched(d.pitch ?? 1, mode === 'ALTERNATE' ? flaps : ias);
      this.elev = clamp1(yoke * pg);
      this.ail = clamp1(wheel * (d.roll ?? 1));
      let yd = 0;
      if (mode !== 'DIRECT' && this.irsOk()) yd = (cfg.yaw?.yawDampGain ?? 0.02) * this.yawWashout.update(v.get(SENSOR_VARS.r(1)), dt);
      this.rud = clamp1(pedal * (d.yaw ?? 1) - yd);
      this.stab = clamp1(this.stab + trimSw * directStabRate * dt);
      this.uRef = ias;
      this.bankHolding = false;
    }
    this.wasGround = onGround;

    // ---- actuators
    this.drive(SURF.elevator, this.elev, this.act.pitch, dt);
    this.drive(SURF.aileron, this.ail, this.act.roll, dt);
    this.drive(SURF.rudder, this.rud, this.act.yaw, dt);
    v.set(SURF.pitchTrim, this.stab);
    const u = cfg.pitch.stabUnits ?? [-1, 1];
    v.set(FCS_VARS.trimUnits('pitch'), u[0] + ((this.stab + 1) / 2) * (u[1] - u[0]));

    v.setString('fbw.mode', mode);
    v.set('fbw.mode_code', mode === 'NORMAL' ? 0 : mode === 'ALTERNATE' ? 1 : 2);
    v.set('fbw.aoa_limit', aoaLim ? 1 : 0);
    v.set('fbw.hs_protect', hsProt ? 1 : 0);
    v.set('fbw.bank_protect', bankProt ? 1 : 0);
    v.set('fbw.pitch_protect', pitchProt ? 1 : 0);
    v.set('fbw.ground_law', onGround ? 1 : 0);
    v.set('fbw.speed_ref_kt', this.uRef);
    v.set('fbw.nz_cmd', nzCmdOut);
  }

  private gainScale(ias: number): number {
    const ref = this.cfg.gainRefKt ?? 250;
    const k = (ref / Math.max(60, ias)) ** 2;
    return k < 0.25 ? 0.25 : k > 6 ? 6 : k;
  }

  /** Moves a surface toward `cmd` with the best actuator's power (rate 3/s full power, EST). */
  private drive(name: string, cmd: number, acts: Evaluator[], dt: number): void {
    let p = acts.length === 0 ? 1 : 0;
    for (let i = 0; i < acts.length; i++) {
      const x = acts[i]();
      if (x > p) p = x > 1 ? 1 : x;
    }
    const cur = this.vars.get(name);
    if (p < 0.05) return;
    const step = 3 * p * dt;
    const dlt = cmd - cur;
    this.vars.set(name, cur + (dlt > step ? step : dlt < -step ? -step : dlt));
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp1(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
