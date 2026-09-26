/**
 * Spoilers / speedbrakes: speedbrake lever with ARMED detent, roll-spoiler
 * mixing, automatic ground-spoiler deployment and retraction.
 *
 * Lever (default var `ac.speedbrake_lever`, 0 = DOWN .. 1 = UP):
 *   - `armedValue` (e.g. 0.08): ARMED detent (ground spoilers armed);
 *   - between `armedValue` and `flightDetent`: flight spoilers extend
 *     proportionally (in flight the extension is limited to `flightMax`);
 *   - beyond the flight detent (ground only): full extension, ground
 *     spoilers too.
 *   A separate arm switch (G650/Global/Citation GND SPLR ARM) can be given
 *   with `groundArm`; then the lever has no ARMED detent.
 * Speedbrake output: `speedbrake: 'spoilers'` writes the symmetric part into
 *   surf.spoiler_left/right (the speedbrake IS the flight spoilers: 737,
 *   G650, Global); `'panels'` writes surf.speedbrake (separate panels:
 *   Citation M2/Longitude speedbrakes). Physics warns not to double count.
 * Roll spoilers: the aileron command beyond `roll.deadband` raises the
 *   spoilers of the down-going wing: spoiler = sb + gain·(|ail| − db) on the
 *   rising side; the opposite side retracts by the same amount (737:
 *   "spoilers on the down-going wing rise", SmartCockpit 737NG Flight
 *   Controls; deflection starts at ~10° of control-wheel rotation).
 * Auto ground spoilers (737NG, SmartCockpit Landing Gear/Flight Controls):
 *   armed + thrust levers idle + (main wheel spin-up > `spinupKt` (60 kt)
 *   OR ground mode (strut compressed) with RA < `raFt` (10 ft)) -> deploy,
 *   lever back-driven to UP. RTO: on the ground, wheel speed > `rto.speedKt`
 *   (60 kt) and thrust levers idle -> deploy even when not armed. Advancing
 *   a thrust lever (`autoRetract`) retracts them and returns the lever to
 *   DOWN.
 * Lights: `spoilers.armed_light` (SPEED BRAKE ARMED), `spoilers.do_not_arm`
 *   (auto function failed and armed), `spoilers.ext_light` (in flight: lever
 *   beyond ARMED and (flaps > `extLight.flapsAboveDeg` or RA <
 *   `extLight.raBelowFt`)).
 *
 * Vars written: surf.spoiler_left/right, surf.speedbrake, surf.ground_spoilers,
 * spoilers.armed, spoilers.deployed (auto deployment active), spoilers.sb_ext
 * (symmetric extension 0..1), spoilers.moving, spoilers.armed_light,
 * spoilers.do_not_arm, spoilers.ext_light, and the lever var when back-driven.
 * Failures: spoilers.auto (auto function inoperative), spoilers.flight
 * (flight spoilers inoperative), spoilers.ground (ground spoilers inoperative).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { GEAR, SURF } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export interface SpoilerConfig {
  leverVar?: string;
  /** Lever value of the ARMED detent. Omit when a separate `groundArm` switch exists. */
  armedValue?: number;
  /** Lever value of the FLIGHT detent (full in-flight extension). Default 1. */
  flightDetent?: number;
  /** Separate ground-spoiler arm switch. */
  groundArm?: Binding;
  /** Where symmetric extension goes. Default 'spoilers'. */
  speedbrake?: 'spoilers' | 'panels';
  /** Max symmetric flight extension in flight (0..1). Default 1. */
  flightMax?: number;
  /** Roll-spoiler mixing (omit if the aircraft has none). */
  roll?: { deadband: number; gain: number; aileronVar?: string };
  /** Ground spoilers present (surf.ground_spoilers). Default true. */
  groundSpoilers?: boolean;
  auto?: {
    /** Thrust levers at idle (all). Required for deployment. */
    thrustIdle: Binding;
    /** Any thrust lever advanced (retract). Default: !thrustIdle. */
    thrustAdvanced?: Binding;
    /** Main-gear wheel speed vars (kt). Default gear.wheel_speed1_kt / 2. */
    wheelSpeedVars?: string[];
    spinupKt?: number;
    /** Ground mode (squat switch). Default gear.air_ground. */
    groundMode?: Binding;
    /** Radio altitude var (ft) and threshold for the ground-mode backup. Default ra1.alt_ft < 10. */
    raVar?: string;
    raFt?: number;
    /** RTO deployment without arming. */
    rto?: { speedKt: number };
    /** Back-drive the lever to UP when deploying and to DOWN when retracting. Default true. */
    leverBackdrive?: boolean;
  };
  /** Hydraulic/electric power 0..1 for flight and ground spoilers. Default 1. */
  flightPower?: Binding;
  groundPower?: Binding;
  /** Full-travel time (s). Default 1.5 (EST). */
  travelS?: number;
  extLight?: { flapsAboveDeg: number; raBelowFt: number; flapsVar?: string };
}

export class Spoilers implements Subsystem {
  readonly name = 'spoilers';
  left = 0;
  right = 0;
  sb = 0;
  ground = 0;
  deployed = false;
  private readonly vars: SimVars;
  private readonly cfg: SpoilerConfig;
  private readonly leverVar: string;
  private readonly armSw: (() => boolean) | null;
  private readonly idle: () => boolean;
  private readonly advanced: () => boolean;
  private readonly groundMode: () => boolean;
  private readonly fPow: Evaluator;
  private readonly gPow: Evaluator;
  private readonly wheels: string[];
  private readonly aileronVar: string;
  private readonly raVar: string;
  private readonly flapsVar: string;
  private prevAdvanced = true;
  private readonly fAuto = failVar('spoilers.auto');
  private readonly fFlight = failVar('spoilers.flight');
  private readonly fGround = failVar('spoilers.ground');

  constructor(env: BlockEnv, cfg: SpoilerConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.leverVar = cfg.leverVar ?? 'ac.speedbrake_lever';
    this.armSw = cfg.groundArm !== undefined ? compileCondition(v, cfg.groundArm) : null;
    this.idle = compileCondition(v, cfg.auto?.thrustIdle, false);
    const idle = this.idle;
    this.advanced = cfg.auto?.thrustAdvanced !== undefined ? compileCondition(v, cfg.auto.thrustAdvanced) : () => !idle();
    this.groundMode = compileCondition(v, cfg.auto?.groundMode ?? 'gear.air_ground', false);
    this.fPow = compileBinding(v, cfg.flightPower, 1);
    this.gPow = compileBinding(v, cfg.groundPower, 1);
    this.wheels = cfg.auto?.wheelSpeedVars ?? [GEAR.wheelSpeedKt(1), GEAR.wheelSpeedKt(2)];
    this.aileronVar = cfg.roll?.aileronVar ?? SURF.aileron;
    this.raVar = cfg.auto?.raVar ?? SENSOR_VARS.raAlt(1);
    this.flapsVar = cfg.extLight?.flapsVar ?? SURF.flapsDeg;
  }

  failures(): FailureDef[] {
    const c = 'flight controls';
    return [
      { id: 'spoilers.auto', name: 'Auto speedbrake', category: c, description: 'No automatic ground-spoiler deployment (DO NOT ARM light when armed).' },
      { id: 'spoilers.flight', name: 'Flight spoilers', category: c, description: 'Flight spoilers inoperative (roll spoilers and speedbrake).' },
      { id: 'spoilers.ground', name: 'Ground spoilers', category: c, description: 'Ground spoilers inoperative.' },
    ];
  }

  reset(): void {
    this.deployed = false;
    this.prevAdvanced = this.advanced();
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const lever = v.get(this.leverVar);
    const armedDetent = cfg.armedValue;
    const leverArmed = armedDetent !== undefined && Math.abs(lever - armedDetent) < 0.02;
    const armed = this.armSw ? this.armSw() : leverArmed;
    const onGround = this.groundMode();
    const autoOk = v.get(this.fAuto) === 0;
    const a = cfg.auto;

    // ---- automatic deployment / retraction
    if (a && autoOk) {
      const idle = this.idle();
      let wheel = 0;
      for (let i = 0; i < this.wheels.length; i++) wheel = Math.max(wheel, Math.abs(v.get(this.wheels[i])));
      const spun = wheel > (a.spinupKt ?? 60);
      const raLow = v.get(this.raVar, 0) < (a.raFt ?? 10);
      const landing = armed && idle && (spun || (onGround && raLow));
      const rto = a.rto !== undefined && onGround && idle && wheel > a.rto.speedKt;
      const adv = this.advanced();
      if (!this.deployed && (landing || rto)) {
        this.deployed = true;
        if (a.leverBackdrive ?? true) v.set(this.leverVar, 1);
      } else if (this.deployed && adv && !this.prevAdvanced) {
        this.deployed = false;
        if (a.leverBackdrive ?? true) v.set(this.leverVar, 0);
      } else if (this.deployed && !onGround && !spun) {
        this.deployed = false; // bounced / went around without advancing: nothing holds them out
      }
      this.prevAdvanced = adv;
    } else {
      this.deployed = false;
    }

    // ---- symmetric (speedbrake) command
    const leverNow = v.get(this.leverVar);
    const start = armedDetent !== undefined ? armedDetent + 0.02 : 0.02;
    const fd = cfg.flightDetent ?? 1;
    let sbCmd = leverNow <= start ? 0 : Math.min(1, (leverNow - start) / Math.max(1e-3, fd - start));
    if (!onGround) sbCmd = Math.min(sbCmd, cfg.flightMax ?? 1);
    if (this.deployed || (onGround && leverNow > fd + 0.01)) sbCmd = 1;
    const gsCmd = (cfg.groundSpoilers ?? true) && onGround && (this.deployed || leverNow > fd + 0.01) ? 1 : 0;

    // ---- roll mixing
    let rollR = 0;
    let rollL = 0;
    if (cfg.roll) {
      const ail = v.get(this.aileronVar);
      const m = Math.abs(ail) - cfg.roll.deadband;
      if (m > 0) {
        const r = Math.min(1, m * cfg.roll.gain);
        if (ail > 0) rollR = r;
        else rollL = r;
      }
    }
    const fOk = v.get(this.fFlight) === 0;
    const fp = fOk ? clamp01(this.fPow()) : 0;
    const gp = v.get(this.fGround) === 0 ? clamp01(this.gPow()) : 0;
    const step = dt / (cfg.travelS ?? 1.5);
    const panels = cfg.speedbrake === 'panels';
    let lCmd: number;
    let rCmd: number;
    if (panels) {
      lCmd = rollL;
      rCmd = rollR;
    } else {
      lCmd = clamp01(sbCmd + rollL - rollR);
      rCmd = clamp01(sbCmd + rollR - rollL);
    }
    const l0 = this.left;
    const r0 = this.right;
    if (fp > 0.05) {
      this.left += clampStep(lCmd - this.left, step * fp);
      this.right += clampStep(rCmd - this.right, step * fp);
      if (panels) this.sb += clampStep(sbCmd - this.sb, step * fp);
    }
    if (gp > 0.05) this.ground += clampStep(gsCmd - this.ground, step * gp);
    if (!panels) this.sb = Math.min(this.left, this.right);

    v.set(SURF.spoilerLeft, this.left);
    v.set(SURF.spoilerRight, this.right);
    v.set(SURF.speedbrake, panels ? this.sb : 0);
    v.set(SURF.groundSpoilers, this.ground);
    v.set('spoilers.armed', armed ? 1 : 0);
    v.set('spoilers.deployed', this.deployed ? 1 : 0);
    v.set('spoilers.sb_ext', this.sb);
    v.set('spoilers.moving', this.left !== l0 || this.right !== r0 ? 1 : 0);
    v.set('spoilers.armed_light', armed && autoOk ? 1 : 0);
    v.set('spoilers.do_not_arm', armed && !autoOk ? 1 : 0);
    const el = cfg.extLight;
    const ext = !!el && !onGround && leverNow > start && (v.get(this.flapsVar) > el.flapsAboveDeg || v.get(this.raVar, 99999) < el.raBelowFt);
    v.set('spoilers.ext_light', ext ? 1 : 0);
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampStep(d: number, s: number): number {
  return d > s ? s : d < -s ? -s : d;
}
