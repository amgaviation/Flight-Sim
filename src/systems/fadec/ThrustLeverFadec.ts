/**
 * FADEC/EEC thrust-lever law: thrust lever angle -> N1 command, idle
 * schedules, thrust reversers.
 *
 * Lever var (default `ac.tla{i}`): normalized, 0 = forward idle, 1 = full
 * forward; negative values (-1..0) = reverse range for levers with an
 * integral reverse gate (bizjets), or a separate reverse lever var
 * (`reverseLeverVar`, 0..1, 737 piggy-back levers).
 *
 * Forward laws:
 *   'linear' (737NG EEC: N1 proportional to TLA, full forward = full rated
 *     takeoff thrust at the current conditions; the EEC protects the N1
 *     redline; SmartCockpit 737NG Engines): N1 = idle + (N1(maxRating) −
 *     idle)·lever.
 *   'detent' (Citation, Gulfstream, Global FADECs: CRU/CLB/TO(MCT) detents
 *     select a rating; between detents the N1 is interpolated): detents must
 *     be listed by increasing lever value; below the first detent N1 rises
 *     linearly from idle.
 * Idle: ground idle on the ground, flight idle in the air, approach idle
 *   (higher, for go-around spool-up time) while `idle.approachWhen` is true
 *   (flaps/gear in landing configuration or anti-ice). Physics clamps any
 *   command below the engine's ground-idle N1 to that idle.
 * Reversers: commanded when the lever is in the reverse range and the
 *   interlock (`reverse.interlock`, default gear.air_ground) permits. The
 *   sleeve moves in `deployS`/`stowS` with power; N1 is held at idle until
 *   the sleeve is 90 % deployed (reverse thrust interlock), then follows the
 *   reverse lever up to `reverse.maxN1`. REV UNLKD (amber) while in transit,
 *   REV (green) when deployed.
 * Failures: fadec.eng{i} (FADEC fault: N1 command frozen — alternate/
 *   "fixed" mode; SCOPE), rev.eng{i} (reverser will not deploy),
 *   rev.eng{i}.uncmd (uncommanded deployment).
 *
 * Vars written per engine: eng{i}.n1_cmd_pct, eng{i}.reverser_pos,
 * fadec.eng{i}.n1_target, fadec.eng{i}.lever (effective), string
 * fadec.eng{i}.detent ('IDLE', 'CRU', 'CLB', 'TO', 'REV', ...),
 * fadec.eng{i}.idle_mode (0 ground, 1 flight, 2 approach),
 * fadec.eng{i}.rev_unlocked, fadec.eng{i}.rev_deployed.
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ENG } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';
import type { ThrustRatingComputer } from './ThrustRatingComputer';

export interface ThrustDetent {
  lever: number;
  rating: string;
  label: string;
}

export type ThrustLaw = { kind: 'linear'; maxRating: string } | { kind: 'detent'; detents: ThrustDetent[] };

export interface ThrustLeverConfig {
  engines: number[];
  leverVar?: (engine: number) => string;
  reverseLeverVar?: (engine: number) => string;
  law: ThrustLaw;
  idle: {
    /** N1 (%) vs pressure altitude (ft). */
    ground: Schedule;
    flight: Schedule;
    approach?: Schedule;
    approachWhen?: Binding;
    onGround?: Binding;
  };
  reverse?: {
    maxN1: number;
    deployS: number;
    stowS: number;
    power?: Binding;
    interlock?: Binding;
  };
  /** FADEC channel power per engine. Default always. */
  power?: (engine: number) => Binding;
  altVar?: string;
}

class EngLane {
  rev = 0;
  lastCmd = 0;
  readonly power: () => boolean;
  readonly lever: string;
  readonly revLever: string | null;
  readonly fFadec: string;
  readonly fRev: string;
  readonly fRevUncmd: string;
  readonly o: { cmd: string; rev: string; target: string; lever: string; detent: string; idle: string; unlk: string; dep: string };
  constructor(vars: SimVars, readonly engine: number, cfg: ThrustLeverConfig) {
    this.power = compileCondition(vars, cfg.power?.(engine), true);
    this.lever = cfg.leverVar ? cfg.leverVar(engine) : `ac.tla${engine}`;
    this.revLever = cfg.reverseLeverVar ? cfg.reverseLeverVar(engine) : null;
    this.fFadec = failVar(`fadec.eng${engine}`);
    this.fRev = failVar(`rev.eng${engine}`);
    this.fRevUncmd = failVar(`rev.eng${engine}.uncmd`);
    const p = `fadec.eng${engine}.`;
    this.o = {
      cmd: ENG.n1Cmd(engine), rev: ENG.reverserPos(engine), target: `${p}n1_target`, lever: `${p}lever`, detent: `${p}detent`,
      idle: `${p}idle_mode`, unlk: `${p}rev_unlocked`, dep: `${p}rev_deployed`,
    };
  }
}

export class ThrustLeverFadec implements Subsystem {
  readonly name = 'fadec_levers';
  private readonly vars: SimVars;
  private readonly cfg: ThrustLeverConfig;
  private readonly rc: ThrustRatingComputer;
  private readonly lanes: EngLane[];
  private readonly approach: () => boolean;
  private readonly ground: () => boolean;
  private readonly revPower: Evaluator;
  private readonly revInterlock: () => boolean;
  private readonly altVar: string;

  constructor(env: BlockEnv, cfg: ThrustLeverConfig, ratings: ThrustRatingComputer) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.rc = ratings;
    this.lanes = cfg.engines.map((e) => new EngLane(v, e, cfg));
    this.approach = compileCondition(v, cfg.idle.approachWhen, false);
    this.ground = compileCondition(v, cfg.idle.onGround ?? 'gear.air_ground', true);
    this.revPower = compileBinding(v, cfg.reverse?.power, 1);
    this.revInterlock = compileCondition(v, cfg.reverse?.interlock ?? 'gear.air_ground', false);
    this.altVar = cfg.altVar ?? SENSOR_VARS.pressAlt(1);
    if (cfg.law.kind === 'detent') {
      const d = cfg.law.detents;
      for (let i = 1; i < d.length; i++) if (!(d[i].lever > d[i - 1].lever)) throw new Error('ThrustLeverFadec: detents must increase');
    }
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    for (const l of this.lanes) {
      const e = l.engine;
      f.push({ id: `fadec.eng${e}`, name: `FADEC ${e}`, category: 'engine', description: 'FADEC fault: N1 frozen at the last command.' });
      if (this.cfg.reverse) {
        f.push({ id: `rev.eng${e}`, name: `Reverser ${e} inoperative`, category: 'engine', description: 'Thrust reverser will not deploy.' });
        f.push({ id: `rev.eng${e}.uncmd`, name: `Reverser ${e} uncommanded deploy`, category: 'engine', description: 'Reverser deploys without command.' });
      }
    }
    return f;
  }

  /** Idle mode of the last `idleN1` call: 0 ground, 1 flight, 2 approach. */
  idleMode = 0;
  /** Detent label of the last `forwardN1` call ('' between detents). */
  detentLabel = '';

  /** Idle N1 (%) for the conditions; sets `idleMode`. */
  idleN1(altFt: number, onGround: boolean): number {
    const i = this.cfg.idle;
    if (onGround) {
      this.idleMode = 0;
      return sched(i.ground, altFt);
    }
    if (i.approach !== undefined && this.approach()) {
      this.idleMode = 2;
      return sched(i.approach, altFt);
    }
    this.idleMode = 1;
    return sched(i.flight, altFt);
  }

  /** Forward-thrust N1 (%) for a lever position 0..1; sets `detentLabel`. */
  forwardN1(lever: number, idle: number): number {
    const law = this.cfg.law;
    const rc = this.rc;
    if (law.kind === 'linear') {
      const max = rc.limit(law.maxRating);
      const l = lever < 0 ? 0 : lever > 1 ? 1 : lever;
      this.detentLabel = l < 0.01 ? 'IDLE' : l > 0.99 ? law.maxRating : '';
      return idle + (max - idle) * l;
    }
    const d = law.detents;
    if (lever <= d[0].lever) {
      const n1d = rc.limit(d[0].rating);
      const f = d[0].lever > 0 ? Math.max(0, lever) / d[0].lever : 1;
      this.detentLabel = lever < 0.01 ? 'IDLE' : Math.abs(lever - d[0].lever) < 0.01 ? d[0].label : '';
      return idle + (n1d - idle) * f;
    }
    for (let k = 1; k < d.length; k++) {
      if (lever <= d[k].lever) {
        const a = rc.limit(d[k - 1].rating);
        const b = rc.limit(d[k].rating);
        const f = (lever - d[k - 1].lever) / (d[k].lever - d[k - 1].lever);
        this.detentLabel = Math.abs(lever - d[k].lever) < 0.01 ? d[k].label : Math.abs(lever - d[k - 1].lever) < 0.01 ? d[k - 1].label : '';
        return a + (b - a) * f;
      }
    }
    const top = d[d.length - 1];
    this.detentLabel = top.label;
    return rc.limit(top.rating);
  }

  reset(): void {
    for (const l of this.lanes) {
      l.rev = this.vars.get(l.o.rev);
      l.lastCmd = this.vars.get(l.o.cmd);
    }
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const alt = v.get(this.altVar);
    const onGround = this.ground();
    const idle = this.idleN1(alt, onGround);
    const idleMode = this.idleMode;
    const rv = cfg.reverse;
    const revPow = clamp01(this.revPower());
    for (const l of this.lanes) {
      let lever = v.get(l.lever);
      let revLever = 0;
      if (l.revLever) revLever = Math.max(0, v.get(l.revLever));
      else if (lever < 0) revLever = -lever;
      if (lever < 0) lever = 0;

      // ---- reverser sleeve
      let revCmd = revLever > 0.02 && this.revInterlock() && v.get(l.fRev) === 0;
      if (v.get(l.fRevUncmd) !== 0) revCmd = true;
      if (rv && revPow > 0.05) {
        const target = revCmd ? 1 : 0;
        const tS = target > l.rev ? rv.deployS : rv.stowS;
        l.rev += clampStep(target - l.rev, (revPow / Math.max(0.05, tS)) * dt);
      }
      // ---- N1 command
      let n1: number;
      let label: string;
      if (rv && (revLever > 0.02 || l.rev > 0.02)) {
        n1 = l.rev >= 0.9 ? idle + (rv.maxN1 - idle) * Math.min(1, revLever) : idle;
        label = 'REV';
      } else {
        n1 = this.forwardN1(lever, idle);
        label = this.detentLabel;
      }
      if (!Number.isFinite(n1)) n1 = idle;
      const fadecOk = l.power() && v.get(l.fFadec) === 0;
      if (fadecOk) l.lastCmd = n1;
      v.set(l.o.cmd, l.lastCmd);
      v.set(l.o.rev, rv ? l.rev : 0);
      v.set(l.o.target, n1);
      v.set(l.o.lever, revLever > 0 ? -revLever : lever);
      v.setString(l.o.detent, label);
      v.set(l.o.idle, idleMode);
      v.set(l.o.unlk, l.rev > 0.02 && l.rev < 0.98 ? 1 : 0);
      v.set(l.o.dep, l.rev >= 0.98 ? 1 : 0);
    }
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampStep(d: number, s: number): number {
  return d > s ? s : d < -s ? -s : d;
}
