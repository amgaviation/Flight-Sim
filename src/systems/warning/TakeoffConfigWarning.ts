/**
 * Takeoff configuration warning.
 *
 * Armed on the ground when the takeoff thrust condition is true (e.g. 737NG:
 * either forward thrust lever advanced for takeoff with the aircraft on the
 * ground, SmartCockpit 737NG Warning Systems). While armed, any failing
 * check sounds the warning: intermittent horn (`tone`, Boeing) and/or a
 * voice per check ("TAKEOFF FLAPS", "TAKEOFF TRIM", "PARKING BRAKE",
 * "SPOILERS" — Honeywell/Collins "NO TAKEOFF" style), repeated every
 * `voiceRepeatS`. Typical checks: flaps outside the takeoff range, stab trim
 * outside the green band (`trim.pitch_to_ok == 0`), speedbrake lever not
 * DOWN, parking brake set, doors.
 *
 * Vars written: alert.takeoff_config, tocw.<id> (1 while that check fails
 * while armed), string tocw.text (first failing check's text).
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ALERT } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import type { BlockEnv } from '../autopilot/lib';

export interface TakeoffConfigCheck {
  id: string;
  /** True when the configuration is NOT OK for takeoff. */
  bad: Binding;
  text: string;
  voice?: string;
}

export interface TakeoffConfigConfig {
  checks: TakeoffConfigCheck[];
  /** Takeoff thrust applied on the ground. */
  armed: Binding;
  power?: Binding;
  /** Intermittent horn tone id ('' = none). Default 'takeoff_config'. */
  tone?: string;
  voiceRepeatS?: number;
}

export class TakeoffConfigWarning implements Subsystem {
  readonly name = 'takeoff_config';
  active = false;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: TakeoffConfigConfig;
  private readonly checks: { def: TakeoffConfigCheck; bad: () => boolean; out: string }[];
  private readonly armed: () => boolean;
  private readonly power: () => boolean;
  private voiceT = 1e9;
  private toneOn = false;

  constructor(env: BlockEnv, cfg: TakeoffConfigConfig) {
    const v = env.vars;
    this.vars = v;
    this.audio = env.audio;
    this.cfg = cfg;
    this.checks = cfg.checks.map((d) => ({ def: d, bad: compileCondition(v, d.bad), out: `tocw.${d.id}` }));
    this.armed = compileCondition(v, cfg.armed);
    this.power = compileCondition(v, cfg.power, true);
  }

  update(dt: number): void {
    const v = this.vars;
    const armed = this.power() && this.armed();
    let first: TakeoffConfigCheck | null = null;
    for (const c of this.checks) {
      const bad = armed && c.bad();
      v.set(c.out, bad ? 1 : 0);
      if (bad && !first) first = c.def;
    }
    this.active = first !== null;
    v.set(ALERT.configWarning, this.active ? 1 : 0);
    v.setString('tocw.text', first ? first.text : '');
    const tone = this.cfg.tone ?? 'takeoff_config';
    if (tone && this.active !== this.toneOn) {
      this.toneOn = this.active;
      this.audio?.tone(tone, this.active);
    }
    if (first?.voice) {
      this.voiceT += dt;
      if (this.voiceT >= (this.cfg.voiceRepeatS ?? 3)) {
        this.voiceT = 0;
        this.audio?.callout(first.voice, 9);
      }
    } else this.voiceT = 1e9;
  }
}
