/**
 * Overspeed warning (Vmo/Mmo clacker) with optional gear and flap placard
 * warnings.
 *
 * Vmo may be a constant or a schedule vs pressure altitude (e.g. 737NG
 * 340 KIAS / M0.82; Citation M2 263 KIAS / M0.71 — TCDS values supplied by
 * the aircraft). The warning sounds when IAS > Vmo + `marginKt` or Mach >
 * Mmo + `marginMach` (EST margins 0 / 0.0; 14 CFR 25.1303(c)(1) requires the
 * warning at Vmo/Mmo + a tolerance), clears with a small hysteresis.
 * Gear placard: IAS > `vleKt` with gear not up & locked. Flaps placard:
 * the Flaps block's `flaps.overspeed`.
 *
 * Vars written: alert.overspeed, overspeed.vmo_kt (current max operating
 * speed in IAS, the lower of Vmo and the IAS equivalent of Mmo — PFD red
 * barber pole), overspeed.gear, overspeed.flaps. Tone: 'overspeed'
 * (clacker). Test binding lights and sounds it.
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ADC, ALERT } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export interface OverspeedConfig {
  vmoKt: Schedule;
  mmo?: number;
  marginKt?: number;
  marginMach?: number;
  vleKt?: number;
  gearUpLocked?: Binding;
  power?: Binding;
  test?: Binding;
  iasVar?: string;
  machVar?: string;
  altVar?: string;
  tone?: string;
}

export class Overspeed implements Subsystem {
  readonly name = 'overspeed';
  active = false;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: OverspeedConfig;
  private readonly power: () => boolean;
  private readonly test: () => boolean;
  private readonly gearUp: () => boolean;
  private readonly iasVar: string;
  private readonly machVar: string;
  private readonly altVar: string;
  private toneOn = false;

  constructor(env: BlockEnv, cfg: OverspeedConfig) {
    const v = env.vars;
    this.vars = v;
    this.audio = env.audio;
    this.cfg = cfg;
    this.power = compileCondition(v, cfg.power, true);
    this.test = compileCondition(v, cfg.test, false);
    this.gearUp = compileCondition(v, cfg.gearUpLocked ?? 'gear.up_locked', true);
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.machVar = cfg.machVar ?? ADC.mach(1);
    this.altVar = cfg.altVar ?? SENSOR_VARS.pressAlt(1);
  }

  update(_dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const ias = v.get(this.iasVar);
    const mach = v.get(this.machVar);
    const vmo = sched(c.vmoKt, v.get(this.altVar));
    let vmax = vmo;
    if (c.mmo !== undefined && mach > 0.1) vmax = Math.min(vmax, ias * (c.mmo / mach));
    const mk = c.marginKt ?? 0;
    const mm = c.marginMach ?? 0;
    const over = ias > vmo + mk || (c.mmo !== undefined && mach > c.mmo + mm);
    const clear = ias < vmo + mk - 2 && (c.mmo === undefined || mach < c.mmo + mm - 0.005);
    if (over) this.active = true;
    else if (clear) this.active = false;
    const gear = c.vleKt !== undefined && !this.gearUp() && ias > c.vleKt;
    const flaps = v.get('flaps.overspeed') !== 0;
    const powered = this.power();
    const on = powered && (this.active || gear || flaps || this.test());
    v.set(ALERT.overspeed, on ? 1 : 0);
    v.set('overspeed.vmo_kt', vmax);
    v.set('overspeed.gear', gear ? 1 : 0);
    v.set('overspeed.flaps', flaps ? 1 : 0);
    if (on !== this.toneOn) {
      this.toneOn = on;
      this.audio?.tone(c.tone ?? 'overspeed', on);
    }
  }
}
