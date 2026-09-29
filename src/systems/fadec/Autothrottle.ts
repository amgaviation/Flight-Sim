/**
 * Autothrottle: servo-driven thrust levers (the cockpit levers move),
 * speed/Mach hold, thrust-reference (N1) mode, takeoff with THR HLD,
 * descent RETARD/idle, flare RETARD, go-around, disconnect warnings.
 *
 * Styles:
 *   'boeing' (737NG A/T; SmartCockpit 737 Systems Review "Automatic
 *     Flight" §9): the A/T ARM switch (`armVar`, magnetically held) arms it
 *     (mode ARM). Modes follow the AFCS pitch mode through `ap.at_req`
 *     (LVL CHG/VNAV climb -> N1, descent -> RETARD then ARM at the aft stop,
 *     ALT HOLD/V/S/G/S -> MCP SPD or FMC SPD) or the N1/SPEED buttons
 *     (events `at.n1`, `at.spd`; pressing the active one -> ARM). Takeoff:
 *     TO/GA on the ground -> N1 (takeoff limit), THR HLD at `thrHoldKt`
 *     (84 kt NG) until `thrHoldEndFt` RA (800 ft NG) -> ARM. Flare: RETARD
 *     at 27 ft RA or 2.5 s after FLARE engages, disengages 2 s after
 *     touchdown without warning. Go-around (armed below 2000 ft RA or at
 *     G/S capture): reduced GA thrust (1000–2000 fpm climb), a second TO/GA
 *     press (`ap.ga_full` = 1) gives full GA N1. Disconnect: A/T disengage
 *     buttons (`at.disc`), ARM switch OFF, faults -> flashing red A/T lights
 *     (`at.disc_warn`) until reset by a second press (`at.disc` /
 *     `at.disc_reset`). Flashing amber A/T light when the speed is not held
 *     within +10/−5 kt with flaps extended in a speed mode (`at.spd_warn`).
 *   'bizjet' (Garmin G5000 AT, Honeywell/Collins AT): AT button
 *     (`at.engage`) toggles; default mode SPD; TO/GA on the ground -> TO
 *     (levers to the takeoff rating) with HOLD at `thrHoldKt` (60 kt EST);
 *     after `thrHoldEndFt` climb thrust; descent -> IDLE (HOLD once idle);
 *     FLC climb -> CLB thrust. Disconnect warning times out after
 *     `discWarnS` (Garmin: 5 s flashing annunciation, EST).
 *
 * Control laws (EST gains, configurable):
 *   SPD:  lever rate = kp·(Vtgt − IAS) − kd·dIAS/dt, limited by the servo
 *         rate; the lever never advances while any N1 >= the N1 limit.
 *   N1:   per-engine lever rate = kn1·(N1tgt − N1ᵢ) (N1 equalization).
 *   RETARD/IDLE: levers to idle at `retardRate`.
 *   HOLD/ARM: servo off (levers wherever the crew puts them).
 *
 * Vars read: lever vars, ap.at_req, ap.at_spd_fms, ap.sel_spd_kt, ap.sel_mach,
 * ap.spd_is_mach, fms.vnav_tgt_speed_kt/mach, ap.flare, ap.ga_full,
 * adc1.ias_kt/mach/ias_rate_kts, eng{i}.n1_pct, fadec.n1_limit_pct,
 * fadec.n1_to_pct, fadec.n1_ga_pct, ra1.alt_ft, adc1.vs_fpm, gear.air_ground,
 * surf.flaps_deg.
 * Vars written: lever vars (servo), ap.at_engaged, ap.at_mode (string),
 * at.mode_code (AtMode), at.armed, at.disc_warn, at.spd_warn, at.target_kt,
 * at.n1_target, at.servo_active, ap.btn_n1, ap.btn_spd, the ARM switch var
 * (released to 0 on disengagement, Boeing).
 * Events: at.engage, at.disc, at.disc_reset, at.n1, at.spd.
 * Aural: `warning/DisconnectAlerts` sounds the A/T disconnect tone from at.disc_warn.
 * Failures: at (A/T computer fault: disengages with warning).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ADC, AP, ENG, FMS, SURF } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { listen, type BlockEnv } from '../autopilot/lib';
import { AFCS_VARS, AtRequest } from '../autopilot/vars';
import { SENSOR_VARS } from '../sensors/vars';

export enum AtMode {
  Off = 0,
  Arm = 1,
  Speed = 2,
  Thrust = 3,
  Retard = 4,
  Idle = 5,
  Hold = 6,
  Takeoff = 7,
  GoAround = 8,
}

export type AtModeName = 'ARM' | 'SPD' | 'SPD_FMS' | 'MACH' | 'THR' | 'RETARD' | 'IDLE' | 'HOLD' | 'TO' | 'GA';

const LABELS_BOEING: Record<AtModeName, string> = {
  ARM: 'ARM', SPD: 'MCP SPD', SPD_FMS: 'FMC SPD', MACH: 'MCP SPD', THR: 'N1', RETARD: 'RETARD', IDLE: 'ARM', HOLD: 'THR HLD', TO: 'N1', GA: 'GA',
};
const LABELS_BIZJET: Record<AtModeName, string> = {
  ARM: '', SPD: 'SPD', SPD_FMS: 'FMS SPD', MACH: 'MACH', THR: 'CLB', RETARD: 'RETARD', IDLE: 'IDLE', HOLD: 'HOLD', TO: 'TO', GA: 'GA',
};

export interface AutothrottleConfig {
  engines: number[];
  style?: 'boeing' | 'bizjet';
  leverVar?: (engine: number) => string;
  /** Lever travel the servo uses [idle, max]. Default [0, 1]. */
  leverRange?: [number, number];
  /** Max servo lever rate (lever units/s). Default 0.15 (EST: idle to full in ~7 s). */
  servoRate?: number;
  /** Retard rate (lever units/s). Default 0.12 (EST). */
  retardRate?: number;
  power?: Binding;
  armVar?: string;
  speedKp?: number;
  speedKd?: number;
  n1Gain?: number;
  thrHoldKt?: number;
  thrHoldEndFt?: number;
  retardFt?: number;
  /** Boeing: RETARD at `retardFt` on any approach with at least these flaps (15, SmartCockpit). Default 15. */
  retardFlapsDeg?: number;
  disengageAfterTouchdownS?: number;
  gaArmBelowFt?: number;
  /** Reduced go-around target climb rate (fpm), Boeing. Default 1500 (midpoint of 1000–2000). */
  reducedGaVsFpm?: number;
  /** Disconnect warning duration (s); undefined = until reset. Default: boeing undefined, bizjet 5. */
  discWarnS?: number;
  labels?: Partial<Record<AtModeName, string>>;
  /** Vmo/Mmo protection: never target above these. */
  vmoKt?: number;
  mmo?: number;
  /**
   * (Appended by the g800 aircraft.) Var carrying the current Vmo (kt), e.g. an altitude-scheduled Vmo written by the
   * aircraft logic; overrides `vmoKt` while it holds a value > 0. Default none.
   */
  vmoVar?: string;
  /**
   * Always hold the selected speed, also in VNAV (`ap.at_spd_fms`): for installations whose speed selector
   * follows the FMS speed in FMS mode and overrides it in MAN (G5000 Longitude SPD knob, OG 7-4). Default false.
   */
  vnavSpeedFromSelected?: boolean;
  /**
   * (Appended by citation-longitude.) Bizjet: at the idle stop in a descent the A/T goes to HOLD (default true,
   * previous behaviour). false: it stays in IDLE (DESC) with the servo holding idle, so an airborne HOLD cannot
   * turn into climb thrust (the HOLD -> THR release is meant for the takeoff HOLD at `thrHoldEndFt`).
   */
  holdAfterDescentIdle?: boolean;
  /**
   * (Appended by citation-longitude, LON-P3-01.) Bizjet ground-engagement policy. 'toga': on the ground the AT
   * button engages the A/T into HOLD (servo off, the levers stay wherever the crew put them — OG 7-5: "HOLD will
   * only activate when on the ground"), never into a servo-driving speed/thrust mode, so pressing A/T during taxi
   * cannot spool the engines (Longitude OG Section 1 limitation: "Autothrottle ... not armed during taxi"); TO is
   * entered only through the TO/GA request, and a TO/GA press on the ground engages the A/T into TO by itself
   * (AW&ST 2019 Longitude pilot report: pressing TOGA drives the thrust levers to the takeoff rating).
   * Default: undefined = unrestricted (previous behaviour: ground engagement into SPD).
   */
  groundEngage?: 'toga';
}

export class Autothrottle implements Subsystem {
  readonly name = 'autothrottle';
  mode: AtMode = AtMode.Off;
  private readonly vars: SimVars;
  private readonly cfg: AutothrottleConfig;
  private readonly boeing: boolean;
  private readonly labels: Record<AtModeName, string>;
  private readonly levers: string[];
  private readonly n1: string[];
  private readonly lever: Float64Array;
  private readonly lastWritten: Float64Array;
  private readonly power: () => boolean;
  private readonly armVar: string;
  private readonly lo: number;
  private readonly hi: number;
  private readonly offs: (() => void)[] = [];
  private prevReq = -1;
  private warn = false;
  private warnT = 0;
  private touchdownT = -1;
  private wasGround = true;
  private flareT = -1;
  private liftoffT = -1;
  private engagedBizjet = false;
  private prevArm = false;
  private readonly f = failVar('at');

  constructor(env: BlockEnv, cfg: AutothrottleConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.boeing = (cfg.style ?? 'bizjet') === 'boeing';
    this.labels = { ...(this.boeing ? LABELS_BOEING : LABELS_BIZJET), ...cfg.labels };
    this.levers = cfg.engines.map((e) => (cfg.leverVar ? cfg.leverVar(e) : `ac.tla${e}`));
    this.n1 = cfg.engines.map((e) => ENG.n1(e));
    this.lever = new Float64Array(cfg.engines.length);
    this.lastWritten = new Float64Array(cfg.engines.length).fill(NaN);
    this.power = compileCondition(v, cfg.power, true);
    this.armVar = cfg.armVar ?? 'ac.at_arm';
    this.lo = cfg.leverRange?.[0] ?? 0;
    this.hi = cfg.leverRange?.[1] ?? 1;
    // A switch already at ARM (state presets) arms the A/T on the first update.
    this.prevArm = false;
    listen(env.events, this.offs, 'at.engage', () => this.pressEngage());
    listen(env.events, this.offs, 'at.disc', () => this.pressDisconnect());
    listen(env.events, this.offs, 'at.disc_reset', () => this.clearWarning());
    listen(env.events, this.offs, 'at.n1', () => this.pressMode(AtMode.Thrust));
    listen(env.events, this.offs, 'at.spd', () => this.pressMode(AtMode.Speed));
  }

  failures(): FailureDef[] {
    return [{ id: 'at', name: 'Autothrottle', category: 'autoflight', description: 'A/T computer fault: disengages with warning.' }];
  }

  get engaged(): boolean {
    return this.mode !== AtMode.Off;
  }

  /** AT button (bizjet): toggles engagement. */
  pressEngage(): void {
    if (this.boeing) return;
    if (this.engaged) this.disengage(true);
    else if (this.power() && this.vars.get(this.f) === 0) {
      this.engagedBizjet = true;
      // LON-P3-01 (cfg.groundEngage 'toga'): on the ground the button engages into HOLD, never a servo mode.
      this.mode = this.cfg.groundEngage === 'toga' && this.vars.get('gear.air_ground') !== 0 ? AtMode.Hold : AtMode.Speed;
      this.prevReq = -1;
      this.clearWarning();
    }
  }

  /** Disconnect button: disengages, or cancels the warning when already off. */
  pressDisconnect(): void {
    if (this.engaged) this.disengage(true);
    else this.clearWarning();
  }

  /** N1 / SPEED buttons (Boeing): select, or deselect to ARM when already active. */
  pressMode(m: AtMode): void {
    if (!this.engaged) return;
    if (this.mode === m) this.mode = AtMode.Arm;
    else if (m === AtMode.Speed || m === AtMode.Thrust) this.mode = m;
  }

  clearWarning(): void {
    this.warn = false;
    this.warnT = 0;
  }

  /** Disengage; `warning` true for crew/fault disconnects (flashing lights + aural). */
  disengage(warning: boolean): void {
    this.mode = AtMode.Off;
    this.engagedBizjet = false;
    if (this.boeing) this.vars.set(this.armVar, 0);
    this.prevArm = false;
    if (warning) {
      this.warn = true;
      this.warnT = 0;
    }
  }

  reset(): void {
    this.prevReq = -1;
    this.lastWritten.fill(NaN);
    this.wasGround = this.vars.get('gear.air_ground') !== 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const lo = this.lo;
    const hi = this.hi;
    const onGround = v.get('gear.air_ground') !== 0;
    const ra = v.get(SENSOR_VARS.raAlt(1), 99999);
    const ias = v.get(ADC.ias(1));
    const req = v.get(AFCS_VARS.atRequest) as AtRequest;
    const reqChanged = req !== this.prevReq;
    this.prevReq = req;

    // ---- touchdown / liftoff bookkeeping
    if (onGround && !this.wasGround) this.touchdownT = 0;
    else if (!onGround) this.touchdownT = -1;
    else if (this.touchdownT >= 0) this.touchdownT += dt;
    if (!onGround && this.wasGround) this.liftoffT = 0;
    else if (this.liftoffT >= 0 && !onGround) this.liftoffT += dt;
    this.wasGround = onGround;

    // ---- engagement
    const ok = this.power() && v.get(this.f) === 0;
    if (this.boeing) {
      const arm = v.get(this.armVar) !== 0;
      if (arm && !this.prevArm && ok) {
        this.mode = AtMode.Arm;
        this.prevReq = -1; // re-evaluate the AFCS request on the next update
        this.clearWarning();
      } else if (!arm && this.prevArm && this.engaged) {
        this.disengage(true);
      }
      this.prevArm = v.get(this.armVar) !== 0;
    }
    // LON-P3-01 (cfg.groundEngage 'toga'): a TO/GA press on the ground engages the A/T into TO by itself.
    if (!this.boeing && this.cfg.groundEngage === 'toga' && !this.engaged && ok && onGround && reqChanged && req === AtRequest.Takeoff) {
      this.engagedBizjet = true;
      this.mode = AtMode.Takeoff;
      this.clearWarning();
    }
    if (this.engaged && !ok) this.disengage(true);

    // ---- mode logic
    if (this.engaged) {
      const flare = v.get(AFCS_VARS.flare) !== 0;
      if (flare && this.flareT < 0) this.flareT = 0;
      else if (flare) this.flareT += dt;
      else this.flareT = -1;
      if (this.touchdownT >= (cfg.disengageAfterTouchdownS ?? 2) && this.mode !== AtMode.Takeoff && this.mode !== AtMode.Hold) {
        // Automatic disengagement after landing: no warning (SmartCockpit 737 A/T).
        this.disengage(false);
      } else if (reqChanged) {
        this.applyRequest(req, onGround);
      } else if (!this.boeing && this.mode === AtMode.Arm) {
        this.mode = AtMode.Speed;
      }
    }
    if (this.engaged) {
      // Flare retard: 2.5 s after FLARE engages or at `retardFt` RA; also (Boeing) any
      // approach with landing flaps descending through `retardFt`.
      const lowRetard = ra < (cfg.retardFt ?? 27) && !onGround && v.get(SURF.flapsDeg) >= (cfg.retardFlapsDeg ?? 15) && v.get(ADC.vs(1)) < -100;
      if (!onGround && ((this.flareT >= 2.5) || (this.flareT >= 0 && ra < (cfg.retardFt ?? 27)) || lowRetard)) this.mode = AtMode.Retard;
      // Takeoff: THR HLD above thrHoldKt; release at thrHoldEndFt.
      if (this.mode === AtMode.Takeoff && ias >= (cfg.thrHoldKt ?? (this.boeing ? 84 : 60))) this.mode = AtMode.Hold;
      if (this.mode === AtMode.Hold && !onGround && ra >= (cfg.thrHoldEndFt ?? (this.boeing ? 800 : 400))) this.mode = this.boeing ? AtMode.Arm : AtMode.Thrust;
      // Descent idle: RETARD -> ARM (Boeing) / HOLD (bizjet) at the aft stop.
      if (this.mode === AtMode.Idle) {
        let allIdle = true;
        for (let k = 0; k < this.levers.length; k++) if (v.get(this.levers[k]) > this.lo + 0.01) allIdle = false;
        if (allIdle) this.mode = this.boeing ? AtMode.Arm : cfg.holdAfterDescentIdle === false ? AtMode.Idle : AtMode.Hold;
      }
    }

    // ---- servo
    let servo = false;
    const tgt = this.speedTarget();
    const n1Lim = v.get('fadec.n1_limit_pct', 100);
    let n1Tgt = NaN;
    for (let k = 0; k < this.levers.length; k++) {
      const cur = v.get(this.levers[k]);
      this.lever[k] = cur;
    }
    if (this.engaged) {
      const rate = cfg.servoRate ?? 0.15;
      let maxN1 = 0;
      for (let k = 0; k < this.n1.length; k++) maxN1 = Math.max(maxN1, v.get(this.n1[k]));
      switch (this.mode) {
        case AtMode.Speed: {
          const err = tgt - ias;
          const accel = v.get(SENSOR_VARS.iasRate(1));
          let r = (cfg.speedKp ?? 0.02) * err - (cfg.speedKd ?? 0.08) * accel;
          if (r > 0 && maxN1 >= n1Lim) r = maxN1 > n1Lim + 0.5 ? -0.02 : 0;
          r = clampAbs(r, rate);
          for (let k = 0; k < this.lever.length; k++) this.lever[k] += r * dt;
          servo = r !== 0;
          break;
        }
        case AtMode.Thrust:
        case AtMode.Takeoff:
        case AtMode.GoAround: {
          if (this.mode === AtMode.Thrust) n1Tgt = n1Lim;
          else if (this.mode === AtMode.Takeoff) n1Tgt = v.get('fadec.n1_to_pct', n1Lim);
          else n1Tgt = v.get('fadec.n1_ga_pct', n1Lim);
          const reducedGa = this.mode === AtMode.GoAround && this.boeing && v.get('ap.ga_full') === 0;
          for (let k = 0; k < this.lever.length; k++) {
            let r = (cfg.n1Gain ?? 0.03) * (n1Tgt - v.get(this.n1[k]));
            if (reducedGa) {
              // Reduced go-around: hold ~1500 fpm, never above the GA N1.
              const vsErr = (cfg.reducedGaVsFpm ?? 1500) - v.get(ADC.vs(1));
              const rv = 0.00015 * vsErr;
              if (rv < r) r = rv;
            }
            r = clampAbs(r, rate);
            this.lever[k] += r * dt;
            if (r !== 0) servo = true;
          }
          break;
        }
        case AtMode.Retard:
        case AtMode.Idle: {
          const r = cfg.retardRate ?? 0.12;
          for (let k = 0; k < this.lever.length; k++) this.lever[k] = Math.max(lo, this.lever[k] - r * dt);
          servo = true;
          break;
        }
        default:
          break;
      }
      if (servo) {
        for (let k = 0; k < this.lever.length; k++) {
          const x = this.lever[k] < lo ? lo : this.lever[k] > hi ? hi : this.lever[k];
          v.set(this.levers[k], x);
          this.lastWritten[k] = x;
        }
      }
    }

    // ---- warnings
    if (this.warn) {
      this.warnT += dt;
      const lim = cfg.discWarnS ?? (this.boeing ? undefined : 5);
      if (lim !== undefined && this.warnT >= lim) this.warn = false;
    }
    const spdMode = this.mode === AtMode.Speed;
    const flapsUp = v.get(SURF.flapsDeg) < 0.5;
    const spdWarn = this.boeing && spdMode && !onGround && !flapsUp && (ias > tgt + 10 || ias < tgt - 5);

    const name = this.modeName();
    v.set(AP.athr, this.engaged ? 1 : 0);
    v.setString(AP.athrMode, this.engaged ? this.labels[name] : '');
    v.set('at.mode_code', this.mode);
    v.set('at.armed', this.boeing && v.get(this.armVar) !== 0 ? 1 : 0);
    v.set('at.disc_warn', this.warn ? 1 : 0);
    v.set('at.spd_warn', spdWarn ? 1 : 0);
    v.set('at.target_kt', tgt);
    v.set('at.n1_target', n1Tgt);
    v.set('at.servo_active', servo ? 1 : 0);
    v.set(AFCS_VARS.button('n1'), this.mode === AtMode.Thrust ? 1 : 0);
    v.set(AFCS_VARS.button('spd'), this.mode === AtMode.Speed ? 1 : 0);
  }

  /** Mode for a new AFCS request. */
  private applyRequest(req: AtRequest, onGround: boolean): void {
    switch (req) {
      case AtRequest.Takeoff:
        if (onGround) this.mode = AtMode.Takeoff;
        break;
      case AtRequest.GoAround:
        if (!onGround && this.gaArmed()) this.mode = AtMode.GoAround;
        break;
      case AtRequest.Retard:
        if (!onGround) this.mode = AtMode.Retard;
        break;
      case AtRequest.Idle:
        this.mode = AtMode.Idle;
        break;
      case AtRequest.Thrust:
        // LON-P3-01 (cfg.groundEngage 'toga'): no servo-driving speed/thrust mode on the ground - stay in HOLD.
        if (!this.boeing && this.cfg.groundEngage === 'toga' && onGround) this.mode = AtMode.Hold;
        else this.mode = AtMode.Thrust;
        break;
      case AtRequest.Speed:
        if (!this.boeing && this.cfg.groundEngage === 'toga' && onGround) this.mode = AtMode.Hold;
        else this.mode = AtMode.Speed;
        break;
      default:
        // No AFDS pitch mode: Boeing keeps its mode; bizjets fall back to SPD.
        if (!this.boeing && this.mode !== AtMode.Hold && this.mode !== AtMode.Takeoff) this.mode = AtMode.Speed;
        break;
    }
  }

  /** A/T GA armed: below `gaArmBelowFt` RA (or G/S captured, Boeing: the AFCS requests GA only then). */
  private gaArmed(): boolean {
    return this.vars.get(SENSOR_VARS.raAlt(1), 99999) < (this.cfg.gaArmBelowFt ?? 2000) || !this.boeing;
  }

  private speedTarget(): number {
    const v = this.vars;
    const fms = v.get(AFCS_VARS.atSpeedFms) !== 0 && !this.cfg.vnavSpeedFromSelected;
    const ias = v.get(ADC.ias(1));
    const mach = v.get(ADC.mach(1));
    let tgt: number;
    let tgtMach = 0;
    if (fms) {
      tgt = v.get(FMS.vnavTargetSpeedKt, ias);
      tgtMach = v.get(FMS.vnavTargetMach);
    } else {
      tgt = v.get(AP.selSpeed, ias);
      if (v.get(AP.speedIsMach) !== 0) tgtMach = v.get(AP.selMach);
    }
    if (tgtMach > 0 && mach > 0.05) tgt = ias * (tgtMach / mach);
    const vmoV = this.cfg.vmoVar ? v.get(this.cfg.vmoVar) : 0;
    if (vmoV > 0) tgt = Math.min(tgt, vmoV - 3);
    else if (this.cfg.vmoKt !== undefined) tgt = Math.min(tgt, this.cfg.vmoKt - 3);
    if (this.cfg.mmo !== undefined && mach > 0.05) tgt = Math.min(tgt, ias * ((this.cfg.mmo - 0.005) / mach));
    return tgt;
  }

  private modeName(): AtModeName {
    switch (this.mode) {
      case AtMode.Speed: {
        if (this.vars.get(AFCS_VARS.atSpeedFms) !== 0) return 'SPD_FMS';
        return this.vars.get(AP.speedIsMach) !== 0 ? 'MACH' : 'SPD';
      }
      case AtMode.Thrust:
        return 'THR';
      case AtMode.Retard:
        return 'RETARD';
      case AtMode.Idle:
        return this.boeing ? 'RETARD' : 'IDLE';
      case AtMode.Hold:
        return 'HOLD';
      case AtMode.Takeoff:
        return 'TO';
      case AtMode.GoAround:
        return 'GA';
      default:
        return 'ARM';
    }
  }
}

function clampAbs(x: number, l: number): number {
  return x > l ? l : x < -l ? -l : x;
}
