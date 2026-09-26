/**
 * Exterior lights and interior dimming channels.
 *
 * Exterior: each light's intensity 0..1 is published as `light.<name>` for
 * the exterior renderer (and `light.<name>_ext` 0..1 for retractable lights).
 * Intensity = switch level × power × flash pattern, through a filament lag
 * for incandescent/halogen lamps (LED and xenon strobes are instant). Flash
 * patterns: anticollision lights flash 40-100 times per minute (14 CFR
 * 23.1401 / 25.1401 (c)); presets in `FLASH_PATTERNS`. A retractable light
 * (737NG retractable landing lights) only shines once extended ≥ 90 %.
 *
 * Interior: dimmer channels (panel backlighting, flood, dome, annunciator
 * brightness, display brightness): level = power × master × knob^gamma
 * (clamped ≥ `min` while on), lamp test forces full. Default output var is
 * `ac.light.<id>`, which is what `cockpit/Lighting.ts` zones read.
 *
 * Failures: light.<name> (lamp burnt out / light inoperative).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { Actuator } from '../util/filters';
import type { FailureDef } from '../failures/FailureManager';

/** Flash pattern: on-windows [start, end, start, end, ...] (s) within `periodS`, or a rotating beacon sweep. */
export type FlashPattern = { kind: 'flash'; periodS: number; windows: number[] } | { kind: 'rotating'; periodS: number; sharpness?: number };

export const FLASH_PATTERNS = {
  /** EST: Whelen-style double-flash wingtip strobes, 50 flashes/min pairs. */
  doubleStrobe: { kind: 'flash', periodS: 1.2, windows: [0, 0.04, 0.12, 0.16] } as FlashPattern,
  /** EST: single-flash strobe, 48/min. */
  singleStrobe: { kind: 'flash', periodS: 1.25, windows: [0, 0.05] } as FlashPattern,
  /** EST: flashing LED/incandescent red beacon, 48/min. */
  beaconFlash: { kind: 'flash', periodS: 1.25, windows: [0, 0.2] } as FlashPattern,
  /** EST: rotating beacon, 45 sweeps/min. */
  beaconRotating: { kind: 'rotating', periodS: 1.33, sharpness: 6 } as FlashPattern,
} as const;

export type LampTech = 'incandescent' | 'halogen' | 'led' | 'xenon';

export interface ExteriorLightDef {
  /** Output `light.<name>`; recommended names: nav, beacon, beacon_lower, strobe, strobe_tail, landing, landing_l, landing_r, landing_nose, taxi, turnoff_l, turnoff_r, logo, wing, recognition. */
  name: string;
  /** Switch level 0..1 (0 off). */
  on: Binding;
  /** Power available (e.g. 'elec.strobe_lts_powered'). Default powered. */
  power?: Binding;
  pattern?: FlashPattern;
  /** Pattern phase offset (s) so paired lights can alternate. */
  phaseS?: number;
  tech?: LampTech;
  /** Retractable light: extension command and travel time (s). */
  retract?: { extend: Binding; travelS: number };
}

export interface DimmerDef {
  id: string;
  /** Knob/rheostat 0..1 (or an expression, e.g. DIM/BRT: 'ac.annun_brt ? 1 : 0.35'). */
  knob: Binding;
  power?: Binding;
  /** Master dimming multiplier (e.g. a DAY/NIGHT or master panel knob). */
  master?: Binding;
  /** Lamp test: full brightness while true and powered. */
  test?: Binding;
  /** Response exponent (default 1). */
  gamma?: number;
  /** Minimum level while the knob is above 0 (default 0). */
  min?: number;
  /** Output var(s); default `ac.light.<id>`. */
  output?: string | string[];
}

export interface LightingConfig {
  /** Exterior output prefix (default 'light.'). */
  prefix?: string;
  exterior?: ExteriorLightDef[];
  dimmers?: DimmerDef[];
}

class Ext {
  level = 0;
  phase: number;
  readonly on: Evaluator;
  readonly power: () => boolean;
  readonly extend: () => boolean;
  readonly act: Actuator | null;
  readonly out: string;
  readonly outExt: string;
  readonly fail: string;
  readonly riseTau: number;
  readonly fallTau: number;
  constructor(
    readonly def: ExteriorLightDef,
    vars: SimVars,
    prefix: string,
  ) {
    this.on = compileBinding(vars, def.on, 0);
    this.power = compileCondition(vars, def.power, true);
    this.extend = compileCondition(vars, def.retract?.extend, false);
    this.act = def.retract ? new Actuator(def.retract.travelS, 0) : null;
    this.out = `${prefix}${def.name}`;
    this.outExt = `${prefix}${def.name}_ext`;
    this.fail = failVar(`light.${def.name}`);
    const tech = def.tech ?? 'led';
    // EST filament time constants.
    this.riseTau = tech === 'incandescent' ? 0.08 : tech === 'halogen' ? 0.06 : 0;
    this.fallTau = tech === 'incandescent' ? 0.12 : tech === 'halogen' ? 0.09 : 0;
    this.phase = def.phaseS ?? 0;
  }
}

class Dim {
  readonly knob: Evaluator;
  readonly power: () => boolean;
  readonly master: Evaluator;
  readonly test: () => boolean;
  readonly outs: string[];
  constructor(
    readonly def: DimmerDef,
    vars: SimVars,
  ) {
    this.knob = compileBinding(vars, def.knob, 0);
    this.power = compileCondition(vars, def.power, true);
    this.master = compileBinding(vars, def.master, 1);
    this.test = compileCondition(vars, def.test, false);
    this.outs = def.output === undefined ? [`ac.light.${def.id}`] : typeof def.output === 'string' ? [def.output] : [...def.output];
  }
}

export class LightingSystem implements Subsystem {
  readonly name = 'lighting';
  private readonly ext: Ext[] = [];
  private readonly dims: Dim[] = [];

  constructor(
    private readonly vars: SimVars,
    cfg: LightingConfig,
  ) {
    const P = cfg.prefix ?? 'light.';
    const ids = new IdRegistry('LightingSystem');
    for (const d of cfg.exterior ?? []) {
      ids.add(d.name, 'exterior light');
      if (d.pattern && !(d.pattern.periodS > 0)) throw new Error(`LightingSystem: light '${d.name}' pattern periodS must be > 0`);
      this.ext.push(new Ext(d, vars, P));
    }
    for (const d of cfg.dimmers ?? []) {
      ids.add(d.id, 'dimmer');
      this.dims.push(new Dim(d, vars));
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    for (const e of this.ext) {
      const d = e.def;
      const sw = clamp01(e.on());
      let target = sw > 0 && e.power() && vars.get(e.fail) === 0 ? sw : 0;
      if (e.act) {
        e.act.update(e.extend() ? 1 : 0, dt);
        if (e.act.position < 0.9) target = 0;
        vars.set(e.outExt, e.act.position);
      }
      const pat = d.pattern;
      if (pat) {
        e.phase = (e.phase + dt) % pat.periodS;
        if (target > 0) target *= patternValue(pat, e.phase);
      }
      const tau = target > e.level ? e.riseTau : e.fallTau;
      e.level = tau > 0 ? e.level + (target - e.level) * (1 - Math.exp(-dt / tau)) : target;
      if (e.level < 1e-3) e.level = 0;
      vars.set(e.out, e.level);
    }
    for (const m of this.dims) {
      const d = m.def;
      let lvl = 0;
      if (m.power()) {
        if (m.test()) lvl = 1;
        else {
          const k = clamp01(m.knob());
          if (k > 0) {
            lvl = Math.pow(k, d.gamma ?? 1) * clamp01(m.master());
            if (lvl < (d.min ?? 0)) lvl = d.min ?? 0;
          }
        }
      }
      for (const o of m.outs) vars.set(o, lvl);
    }
  }

  /** Snaps retractable lights to their commanded position (state presets). */
  snap(): void {
    for (const e of this.ext) if (e.act) e.act.reset(e.extend() ? 1 : 0);
  }

  failures(): FailureDef[] {
    return this.ext.map((e) => ({ id: `light.${e.def.name}`, name: `${e.def.name} light inoperative`, category: 'lighting' }));
  }

  dispose(): void {
    /* nothing */
  }
}

/** Instantaneous pattern intensity 0..1 at `phase` seconds into the period. */
export function patternValue(p: FlashPattern, phase: number): number {
  if (p.kind === 'flash') {
    const w = p.windows;
    for (let i = 0; i + 1 < w.length; i += 2) if (phase >= w[i] && phase < w[i + 1]) return 1;
    return 0;
  }
  // Rotating beacon seen from one direction: a sharp cosine lobe once per revolution.
  const c = Math.cos((2 * Math.PI * phase) / p.periodS);
  return c > 0 ? Math.pow(c, p.sharpness ?? 6) : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
