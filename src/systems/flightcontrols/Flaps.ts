/**
 * Trailing-edge flaps (+ optional leading-edge slats/Krueger flaps).
 *
 * Lever -> detent -> commanded angle:
 *   The lever var carries the detent's `lever` value (a discrete cockpit
 *   Lever writes exactly those). The nearest detent is selected.
 * Flap load relief (737NG: 40 -> 30 above 163 KIAS, back below 158; 30 -> 25
 *   above 176, back below 171 — SmartCockpit 737NG Flight Controls):
 *   `loadRelief` rules retract the command to `toDeg` above `retractKt` and
 *   re-extend below `reextendKt`.
 * Drive: `normal` (hydraulic or electric) moves both panels at
 *   `rateDegPerS` scaled by the power binding (0..1; flow-limited below 1);
 *   `alternate` (737 ALTERNATE FLAPS, electric, ~1 min to flaps 15 — same
 *   source) moves them with a hold switch (-1 up / +1 down) or toward the
 *   lever command when `alternate.followLever`. No movement below 5 % power.
 * Asymmetry: the left/right panels are tracked separately; a panel jam
 *   (fail.flaps.left.jam / right.jam) with the other side moving produces
 *   an asymmetry. Above `asymmetryDeg` the normal drive shuts off and
 *   `flaps.asym` latches (reset only on the ground with power off-on: SCOPE
 *   simplified to reset()).
 * Disagree: position differs from the command by more than 1° without
 *   motion for 3 s (hydraulic loss, jam) -> `flaps.disagree`.
 * Slats: position schedule vs *flap command* (0..1), own drive time and
 *   power; `autoSlat` drives them to 1 when a condition is true while the
 *   flaps are within `flapsRange` (737 auto-slat near the stall, flaps 1–5).
 * Overspeed: `vfe` (kt) per detent -> `flaps.overspeed` when IAS exceeds the
 *   placard of the current flap position.
 *
 * Vars written: surf.flaps_deg (mean), surf.slats, flaps.cmd_deg,
 * flaps.lever_deg (detent angle before load relief), flaps.left_deg,
 * flaps.right_deg, flaps.transit, flaps.moving (0..1 for hydraulic demand),
 * flaps.load_relief, flaps.asym, flaps.disagree, flaps.overspeed,
 * flaps.detent (index), slats.pos, slats.transit.
 * Failures: flaps.left.jam, flaps.right.jam, flaps.drive (normal drive
 * inoperative), slats.drive.
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { Table1D } from '../../physics/types';
import { ADC, SURF } from '../../core/vars';
import { interp1 } from '../../core/math';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';

export interface FlapDetent {
  /** Lever var value of this detent. */
  lever: number;
  /** Flap angle commanded (deg). */
  flapDeg: number;
  label?: string;
  /** Max flap extended speed placard for this setting (KIAS). */
  vfe?: number;
}

export interface FlapLoadRelief {
  fromDeg: number;
  toDeg: number;
  retractKt: number;
  reextendKt: number;
}

export interface FlapsConfig {
  /** Lever var. Default ac.flap_lever. */
  leverVar?: string;
  detents: FlapDetent[];
  normal: {
    /** Power available 0..1 (hydraulic pressure fraction or bus). */
    power: Binding;
    /** Panel rate (deg/s) at full power. */
    rateDegPerS: number;
  };
  alternate?: {
    /** Alternate system armed (e.g. 737 ALTERNATE FLAPS master switch ARM). */
    active: Binding;
    /** Hold switch var (-1 up, 0 off, +1 down). Ignored with `followLever`. */
    switchVar?: string;
    followLever?: boolean;
    rateDegPerS: number;
    power?: Binding;
  };
  loadRelief?: FlapLoadRelief[];
  /** Left/right difference that trips the asymmetry protection (deg). Default 5 (EST). */
  asymmetryDeg?: number;
  slats?: {
    /** Slat position (0..1) vs commanded flap angle. */
    schedule: Table1D;
    /** Full-travel time (s). */
    travelS: number;
    power?: Binding;
    autoSlat?: { condition: Binding; flapsRange: [number, number] };
  };
  iasVar?: string;
  /** Initial flap angle if surf.flaps_deg is unset. Default the first detent's angle. */
  initialDeg?: number;
  /**
   * (Appended by the citation-m2 aircraft.) Follow-up handle: a lever value between two detents commands the
   * proportional angle between their `flapDeg` (Citation "any intermediate position from zero to 35 degrees").
   * Default false (nearest detent).
   */
  continuous?: boolean;
}

export class Flaps implements Subsystem {
  readonly name = 'flaps';
  left: number;
  right: number;
  slats = 0;
  commandDeg = 0;
  private readonly vars: SimVars;
  private readonly cfg: FlapsConfig;
  private readonly leverVar: string;
  private readonly power: Evaluator;
  private readonly altActive: () => boolean;
  private readonly altPower: Evaluator;
  private readonly slatPower: Evaluator;
  private readonly autoSlat: () => boolean;
  private readonly iasVar: string;
  private readonly reliefActive: boolean[];
  private asym = false;
  private stillT = 0;
  private readonly fL = failVar('flaps.left.jam');
  private readonly fR = failVar('flaps.right.jam');
  private readonly fDrive = failVar('flaps.drive');
  private readonly fSlat = failVar('slats.drive');

  constructor(env: BlockEnv, cfg: FlapsConfig) {
    if (cfg.detents.length === 0) throw new Error('Flaps: at least one detent required');
    this.vars = env.vars;
    this.cfg = cfg;
    this.leverVar = cfg.leverVar ?? 'ac.flap_lever';
    this.power = compileBinding(env.vars, cfg.normal.power, 1);
    this.altActive = compileCondition(env.vars, cfg.alternate?.active, false);
    this.altPower = compileBinding(env.vars, cfg.alternate?.power, 1);
    this.slatPower = compileBinding(env.vars, cfg.slats?.power, 1);
    this.autoSlat = compileCondition(env.vars, cfg.slats?.autoSlat?.condition, false);
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.reliefActive = (cfg.loadRelief ?? []).map(() => false);
    const v = env.vars;
    const init = v.has(SURF.flapsDeg) ? v.get(SURF.flapsDeg) : cfg.initialDeg ?? cfg.detents[0].flapDeg;
    this.left = init;
    this.right = init;
    this.commandDeg = init;
    if (cfg.slats) this.slats = interp1(cfg.slats.schedule, init);
  }

  failures(): FailureDef[] {
    const c = 'flight controls';
    const f: FailureDef[] = [
      { id: 'flaps.left.jam', name: 'Left flap jam', category: c, description: 'Left flap panel stops: asymmetry protection trips.' },
      { id: 'flaps.right.jam', name: 'Right flap jam', category: c, description: 'Right flap panel stops: asymmetry protection trips.' },
      { id: 'flaps.drive', name: 'Flap drive failure', category: c, description: 'Normal flap drive inoperative (alternate still available).' },
    ];
    if (this.cfg.slats) f.push({ id: 'slats.drive', name: 'Slat drive failure', category: c, description: 'Slats stop where they are.' });
    return f;
  }

  /** Flap angle interpolated between the detents bracketing `lever` (continuous handles). */
  private continuousDeg(lever: number): number {
    const d = this.cfg.detents;
    if (lever <= d[0].lever) return d[0].flapDeg;
    for (let i = 1; i < d.length; i++) {
      if (lever <= d[i].lever) {
        const span = d[i].lever - d[i - 1].lever;
        const f = span > 1e-9 ? (lever - d[i - 1].lever) / span : 1;
        return d[i - 1].flapDeg + (d[i].flapDeg - d[i - 1].flapDeg) * f;
      }
    }
    return d[d.length - 1].flapDeg;
  }

  /** Index of the detent nearest to the lever value. */
  detentIndex(lever: number): number {
    const d = this.cfg.detents;
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < d.length; i++) {
      const e = Math.abs(d[i].lever - lever);
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    }
    return best;
  }

  /** Puts the flaps at an angle immediately (applyState). */
  setPosition(deg: number): void {
    this.left = deg;
    this.right = deg;
    this.commandDeg = deg;
    if (this.cfg.slats) this.slats = interp1(this.cfg.slats.schedule, deg);
    this.publish(0, false);
  }

  reset(): void {
    this.asym = false;
    this.stillT = 0;
    const deg = this.vars.get(SURF.flapsDeg, this.left);
    this.left = deg;
    this.right = deg;
    this.reliefActive.fill(false);
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const ias = v.get(this.iasVar);
    const lever = v.get(this.leverVar);
    const idx = this.detentIndex(lever);
    const leverDeg = cfg.continuous ? this.continuousDeg(lever) : cfg.detents[idx].flapDeg;
    let cmd = leverDeg;

    // ---- load relief
    const rules = cfg.loadRelief;
    let relief = false;
    if (rules) {
      // Rules chain in order: each acts on the command left by the previous ones.
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (Math.abs(cmd - r.fromDeg) > 0.01) {
          this.reliefActive[i] = false;
          continue;
        }
        if (!this.reliefActive[i] && ias > r.retractKt) this.reliefActive[i] = true;
        else if (this.reliefActive[i] && ias < r.reextendKt) this.reliefActive[i] = false;
        if (this.reliefActive[i]) {
          cmd = r.toDeg;
          relief = true;
        }
      }
    }
    this.commandDeg = cmd;

    // ---- drive
    const jamL = v.get(this.fL) !== 0;
    const jamR = v.get(this.fR) !== 0;
    let rate = 0;
    let target = cmd;
    const alt = cfg.alternate;
    if (alt && this.altActive()) {
      const p = clamp01(this.altPower());
      if (p > 0.05) {
        if (alt.followLever) rate = alt.rateDegPerS * p;
        else {
          const sw = alt.switchVar ? v.get(alt.switchVar) : 0;
          if (sw !== 0) {
            rate = alt.rateDegPerS * p;
            target = sw > 0 ? this.maxDeg() : this.minDeg();
          }
        }
      }
    } else if (!this.asym && v.get(this.fDrive) === 0) {
      const p = clamp01(this.power());
      if (p > 0.05) rate = cfg.normal.rateDegPerS * p;
    }
    const step = rate * dt;
    const l0 = this.left;
    const r0 = this.right;
    if (!jamL) this.left += clampStep(target - this.left, step);
    if (!jamR) this.right += clampStep(target - this.right, step);

    // ---- asymmetry protection
    if (Math.abs(this.left - this.right) > (cfg.asymmetryDeg ?? 5)) this.asym = true;
    const moving = this.left !== l0 || this.right !== r0;

    // ---- slats
    const s = cfg.slats;
    let slatMoving = false;
    if (s) {
      let slatCmd = interp1(s.schedule, cmd);
      if (s.autoSlat && cmd >= s.autoSlat.flapsRange[0] && cmd <= s.autoSlat.flapsRange[1] && this.autoSlat()) slatCmd = 1;
      const sp = clamp01(this.slatPower());
      if (v.get(this.fSlat) === 0 && sp > 0.05 && s.travelS > 0) {
        const s0 = this.slats;
        this.slats += clampStep(slatCmd - this.slats, (sp / s.travelS) * dt);
        slatMoving = this.slats !== s0;
      }
    }

    // ---- disagree
    const mean = (this.left + this.right) / 2;
    if (Math.abs(mean - cmd) > 1 && !moving) this.stillT += dt;
    else this.stillT = 0;

    v.set('flaps.lever_deg', leverDeg);
    v.set('flaps.detent', idx);
    v.set('flaps.load_relief', relief ? 1 : 0);
    v.set('flaps.overspeed', ias > this.vfeAt(mean) ? 1 : 0);
    v.set('slats.transit', slatMoving ? 1 : 0);
    this.publish(moving ? 1 : 0, this.stillT > 3);
  }

  private publish(moving: number, disagree: boolean): void {
    const v = this.vars;
    v.set(SURF.flapsDeg, (this.left + this.right) / 2);
    v.set('flaps.cmd_deg', this.commandDeg);
    v.set('flaps.left_deg', this.left);
    v.set('flaps.right_deg', this.right);
    v.set('flaps.transit', moving);
    v.set('flaps.moving', moving);
    v.set('flaps.asym', this.asym ? 1 : 0);
    v.set('flaps.disagree', disagree ? 1 : 0);
    if (this.cfg.slats) {
      v.set(SURF.slats, this.slats);
      v.set('slats.pos', this.slats);
    }
  }

  /** Placard for a flap angle: the Vfe of the smallest detent at or above it. */
  private vfeAt(deg: number): number {
    let vfe = Infinity;
    let bestDeg = Infinity;
    for (const d of this.cfg.detents) {
      if (d.vfe === undefined) continue;
      if (d.flapDeg >= deg - 0.5 && d.flapDeg < bestDeg && deg > 0.5) {
        bestDeg = d.flapDeg;
        vfe = d.vfe;
      }
    }
    return vfe;
  }

  private maxDeg(): number {
    let m = -Infinity;
    for (const d of this.cfg.detents) m = Math.max(m, d.flapDeg);
    return m;
  }

  private minDeg(): number {
    let m = Infinity;
    for (const d of this.cfg.detents) m = Math.min(m, d.flapDeg);
    return m;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampStep(d: number, s: number): number {
  return d > s ? s : d < -s ? -s : d;
}
