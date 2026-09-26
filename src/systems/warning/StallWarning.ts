/**
 * Stall warning and protection.
 *
 * kind 'horn' — pneumatic/reed stall warning (Cessna 172S: a reed horn in
 *   the left wing leading edge driven by the airflow, no electrical power;
 *   172S POH §7 "Stall Warning System": sounds 5–10 kt above the stall).
 *   Uses the FDM's physical stall-proximity output `fdm.stall_warning`
 *   (0 at half the stall AoA .. 1 at the stall); it sounds above
 *   `hornThreshold` (default 0.3; physics.md §3.3 suggests 0.25–0.35).
 *   A pitot-heat style heated vane with a switch is 'aoa'.
 * kind 'aoa' — stall warning & protection computer (SWPS/SPC) from the
 *   AoA vane (`adc{s}.aoa_deg`): normalized AoA = α / αstall(flaps), with
 *   phase advance `k·dα/dt`. Stick shaker above `shakerNorm` (EST default
 *   0.85: shaker margin ~7 % above the 1-g stall speed ⇒ ~0.86 α/αs),
 *   optional pusher above `pusherNorm` (EST 0.95) — pushes a nose-down
 *   elevator increment `pusherCmd` until the AoA falls below the shaker
 *   threshold (G650/Global/Citation have pushers/"stall barrier" functions
 *   in some variants; configure per aircraft). Inhibited on the ground.
 *
 * Vars written: alert.stick_shaker, alert.stall_horn, stall.aoa_norm (for
 * PLI / AoA indexers), stall.warning, stall.pusher_cmd (<= 0),
 * stall.pusher_active. Tones: 'stick_shaker', 'stall_horn'.
 * Failures: stall.warn (no warning), stall.pusher (pusher inoperative).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import type { Table1D } from '../../physics/types';
import { ALERT, FDM, SURF } from '../../core/vars';
import { interp1 } from '../../core/math';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { RateFilter, type BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';
import { FCS_VARS } from '../flightcontrols/vars';

export interface StallWarningConfig {
  kind: 'horn' | 'aoa';
  hornThreshold?: number;
  aoaVar?: string;
  /** Stall AoA (deg, vane reference) vs flap angle. Required for 'aoa'. */
  alphaStall?: Table1D;
  flapsVar?: string;
  shakerNorm?: number;
  /** Phase advance (s): normAoA + k·d(normAoA)/dt. Default 0.3 (EST). */
  phaseAdvanceS?: number;
  pusher?: { enabled?: Binding; norm?: number; command?: number };
  power?: Binding;
  test?: Binding;
  onGround?: Binding;
  hornTone?: string;
  shakerTone?: string;
}

export class StallWarning implements Subsystem {
  readonly name = 'stall_warning';
  aoaNorm = 0;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: StallWarningConfig;
  private readonly power: () => boolean;
  private readonly test: () => boolean;
  private readonly ground: () => boolean;
  private readonly pusherEnabled: () => boolean;
  private readonly aoaVar: string;
  private readonly flapsVar: string;
  private readonly rate = new RateFilter(0.3);
  private pushing = false;
  private hornOn = false;
  private shakerOn = false;
  private readonly fWarn = failVar('stall.warn');
  private readonly fPusher = failVar('stall.pusher');

  constructor(env: BlockEnv, cfg: StallWarningConfig) {
    if (cfg.kind === 'aoa' && !cfg.alphaStall) throw new Error("StallWarning: 'aoa' needs alphaStall");
    const v = env.vars;
    this.vars = v;
    this.audio = env.audio;
    this.cfg = cfg;
    this.power = compileCondition(v, cfg.power, true);
    this.test = compileCondition(v, cfg.test, false);
    this.ground = compileCondition(v, cfg.onGround ?? 'gear.air_ground', false);
    this.pusherEnabled = compileCondition(v, cfg.pusher?.enabled, cfg.pusher !== undefined);
    this.aoaVar = cfg.aoaVar ?? SENSOR_VARS.aoa(1);
    this.flapsVar = cfg.flapsVar ?? SURF.flapsDeg;
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [{ id: 'stall.warn', name: 'Stall warning', category: 'warning', description: 'No stall warning.' }];
    if (this.cfg.pusher) f.push({ id: 'stall.pusher', name: 'Stick pusher', category: 'warning', description: 'Pusher inoperative.' });
    return f;
  }

  reset(): void {
    this.rate.reset();
    this.pushing = false;
  }

  update(dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const failed = v.get(this.fWarn) !== 0;
    let horn = false;
    let shaker = false;
    let pushCmd = 0;
    if (c.kind === 'horn') {
      // Pneumatic reed horn: works without power; the FDM value is the physical airflow effect.
      const s = v.get(FDM.stallWarn);
      this.aoaNorm = s;
      horn = !failed && (s >= (c.hornThreshold ?? 0.3) || this.test());
    } else {
      const powered = this.power();
      const alpha = v.get(this.aoaVar);
      const as = interp1(c.alphaStall!, v.get(this.flapsVar));
      const norm = as > 0 ? alpha / as : 0;
      const r = this.rate.update(norm, dt);
      this.aoaNorm = norm;
      const eff = norm + (c.phaseAdvanceS ?? 0.3) * Math.max(0, r);
      const air = !this.ground();
      shaker = powered && !failed && ((air && eff >= (c.shakerNorm ?? 0.85)) || this.test());
      const p = c.pusher;
      if (p && powered && air && !failed && this.pusherEnabled() && v.get(this.fPusher) === 0) {
        if (!this.pushing && eff >= (p.norm ?? 0.95)) this.pushing = true;
        else if (this.pushing && norm < (c.shakerNorm ?? 0.85)) this.pushing = false;
      } else this.pushing = false;
      if (this.pushing) pushCmd = p?.command ?? -0.35;
    }
    v.set(ALERT.stickShaker, shaker ? 1 : 0);
    v.set(ALERT.stallHorn, horn ? 1 : 0);
    v.set('stall.aoa_norm', this.aoaNorm);
    v.set('stall.warning', shaker || horn ? 1 : 0);
    v.set(FCS_VARS.pusherCmd, pushCmd);
    v.set('stall.pusher_active', this.pushing ? 1 : 0);
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.audio?.tone(c.hornTone ?? 'stall_horn', horn);
    }
    if (shaker !== this.shakerOn) {
      this.shakerOn = shaker;
      this.audio?.tone(c.shakerTone ?? 'stick_shaker', shaker);
    }
  }
}
