/**
 * Ice accretion and ice protection.
 *
 * Icing environment (evaluated once per update):
 *   visible moisture M = max(in-cloud factor, freezing precipitation)
 *     in cloud: cloud base ≤ altitude ≤ tops (tops = `cloudTopsFt` binding or
 *               base + `cloudThicknessFt`), factor = cloud cover (fraction of
 *               the time spent in cloud);
 *     freezing precipitation: `env.precip` while SAT ≤ +2 °C.
 *   temperature factor T(SAT): zero above +2 °C and below −40 °C (glaciated
 *     cloud), maximum between −5 and −15 °C (supercooled liquid water; FAA
 *     AC 91-74B / AIM 7-1-21: icing is most frequent from 0 to −20 °C).
 *   potential = env.icing (intensity 0..1: trace/light/moderate/severe) × M × T,
 *   and surfaces with TAT above 0 °C do not accrete (kinetic heating).
 *
 * Each surface accretes at `ratePerMin × potential × (TAS/refTasKt)^speedExp`
 * (fraction of "fully iced" per minute; collection efficiency ∝ speed) and
 * publishes its accretion (0..1) to its output var — the standard ones are
 * `ice.airframe`, `ice.inlet{i}`, `ice.pitot{s}`, `ice.static{s}`,
 * `ice.windshield{side}` read by the FDM, engines, ADCs and renderer.
 *
 * Protection per surface:
 *   'thermal' (bleed air) / 'electric' (heaters): while active (0..1) they
 *     prevent accretion up to `capacity` × active (excess forms runback ice)
 *     and melt existing ice at `shedRatePerMin` × active × the heat left over
 *     (1 − potential / capacity);
 *   'boots': ice builds normally; each inflation cycle (`bootCycleS`) removes
 *     `bootRemoval` of it once at least `bootMinIce` has formed;
 *   'fluid' (TKS weeping wing): prevents accretion and slowly clears it while
 *     active.
 * Natural shedding/melting above 0 °C TAT, slow sublimation in dry air.
 *
 * Ice detector (magnetostrictive probe type): `ice.detected` while the probe
 * is accreting (potential ≥ threshold), held `holdS` after the last detection
 * (EST 60 s, typical detector "ICE" signal hold), off when unpowered/failed.
 *
 * Engine anti-ice: surfaces with `engine: i` publish `eng{i}.anti_ice` =
 * protection active (the engine model adds its ITT penalty).
 *
 * Outputs (prefix default 'ice.'): <surface output var>, <id>_rate (per min),
 * <id>_protected (0/1), <id>_boots (inflation in progress), visible_moisture,
 * potential, detected, detector_fail.
 * Failures: ice.<surface>.heat (protection inoperative), ice.detector.
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import type { Table1D } from '../../physics/types';
import { ENG, ENV, FDM } from '../../core/vars';
import { interp1 } from '../../core/math';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import type { FailureDef } from '../failures/FailureManager';

export type IceProtectionKind = 'thermal' | 'electric' | 'boots' | 'fluid';

export interface IceSurfaceDef {
  id: string;
  /** Var receiving the accretion 0..1, e.g. ICE.airframe, ICE.inlet(1), ICE.pitot(1). */
  output: string;
  /** Accretion (fraction per minute) at potential 1 and the reference speed. */
  ratePerMin: number;
  /** Reference TAS (kt), default 150; speed exponent default 1 (probes use ~0.5). */
  refTasKt?: number;
  speedExp?: number;
  protection?: {
    kind: IceProtectionKind;
    /** 0..1 protection available: switch × power/bleed, e.g. 'ac.wai_sw * pneu.wai_ok'. */
    active: Binding;
    /** Icing potential fully handled at active = 1 (default 1 = everything; < 1 lets severe icing overwhelm it). */
    capacity?: number;
    /** Removal rate while active (fraction/min). Defaults: thermal 0.6, electric 1.0, fluid 0.3. */
    shedRatePerMin?: number;
    /** Boots: cycle period (s, default 60), removal per inflation (default 0.85), minimum ice before a cycle removes any (default 0.08), inflation duration (s, default 6). */
    bootCycleS?: number;
    bootRemoval?: number;
    bootMinIce?: number;
    bootInflateS?: number;
  };
  /** Engine inlet: publish `eng{engine}.anti_ice` = protection active. */
  engine?: number;
  /** Melt rate above 0 °C TAT (fraction/min at +5 °C), default 0.3. */
  meltRatePerMin?: number;
}

export interface IceConfig {
  prefix?: string;
  surfaces: IceSurfaceDef[];
  detector?: {
    power?: Binding;
    /** Potential that registers as icing (default 0.05). */
    threshold?: number;
    /** Hold time (s), default 60. */
    holdS?: number;
  };
  /** Icing intensity (default 'env.icing'); `defaultIntensity` applies while that var was never written (default 0). */
  intensity?: Binding;
  defaultIntensity?: number;
  cloudBaseFt?: Binding;
  cloudTopsFt?: Binding;
  /** Cloud layer thickness when no tops binding (ft), default 5000 (EST: typical stratiform icing layer depth). */
  cloudThicknessFt?: number;
  cloudCover?: Binding;
  precip?: Binding;
  altitudeFt?: Binding;
  satC?: Binding;
  tatC?: Binding;
  tasKt?: Binding;
}

/** Relative icing likelihood vs SAT (°C) (EST shape from AIM 7-1-21 / AC 91-74B: max between −5 and −15 °C, none below −40 °C). */
export const ICING_TEMP_FACTOR: Table1D = { x: [-40, -30, -20, -15, -5, 0, 2], y: [0, 0.25, 0.65, 1, 1, 0.7, 0] };

class Surface {
  ice = 0;
  rate = 0;
  prot = 0;
  bootTimer = 0;
  inflating = 0;
  readonly active: Evaluator;
  readonly o: Record<'rate' | 'protected' | 'boots', string>;
  readonly fail: string;
  readonly engVar: string | null;
  constructor(
    readonly def: IceSurfaceDef,
    vars: SimVars,
    prefix: string,
  ) {
    this.active = compileBinding(vars, def.protection?.active, 0);
    this.o = { rate: `${prefix}${def.id}_rate`, protected: `${prefix}${def.id}_protected`, boots: `${prefix}${def.id}_boots` };
    this.fail = failVar(`ice.${def.id}.heat`);
    this.engVar = def.engine !== undefined ? ENG.antiIce(def.engine) : null;
    this.ice = vars.get(def.output, 0);
  }
}

export class IceProtection implements Subsystem {
  readonly name = 'ice';
  readonly prefix: string;
  private readonly surfaces: Surface[] = [];
  private readonly intensity: Evaluator;
  private readonly hasIntensityVar: boolean;
  private readonly intensityVarName: string | null;
  private readonly cloudBase: Evaluator;
  private readonly cloudTops: Evaluator | null;
  private readonly cover: Evaluator;
  private readonly precip: Evaluator;
  private readonly alt: Evaluator;
  private readonly sat: Evaluator;
  private readonly tat: Evaluator;
  private readonly tas: Evaluator;
  private readonly detPower: () => boolean;
  private detHold = 0;
  private readonly vDet: string;
  private readonly vDetFail: string;
  private readonly vMoist: string;
  private readonly vPot: string;
  private readonly fDet: string;
  potential = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly cfg: IceConfig,
  ) {
    const P = (this.prefix = cfg.prefix ?? 'ice.');
    const ids = new IdRegistry('IceProtection');
    for (const d of cfg.surfaces) {
      ids.add(d.id, 'surface');
      this.surfaces.push(new Surface(d, vars, P));
    }
    this.intensityVarName = cfg.intensity === undefined ? ENV.icing : typeof cfg.intensity === 'string' && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(cfg.intensity) ? cfg.intensity : null;
    this.hasIntensityVar = this.intensityVarName !== null;
    this.intensity = compileBinding(vars, cfg.intensity ?? ENV.icing, 0);
    this.cloudBase = compileBinding(vars, cfg.cloudBaseFt ?? ENV.cloudBaseFt, 0);
    this.cloudTops = cfg.cloudTopsFt !== undefined ? compileBinding(vars, cfg.cloudTopsFt) : null;
    this.cover = compileBinding(vars, cfg.cloudCover ?? ENV.cloudCover, 0);
    this.precip = compileBinding(vars, cfg.precip ?? ENV.precip, 0);
    this.alt = compileBinding(vars, cfg.altitudeFt ?? FDM.altMsl, 0);
    this.sat = compileBinding(vars, cfg.satC ?? FDM.sat, 15);
    this.tat = compileBinding(vars, cfg.tatC ?? FDM.tat, 15);
    this.tas = compileBinding(vars, cfg.tasKt ?? FDM.tas, 0);
    this.detPower = compileCondition(vars, cfg.detector?.power, true);
    this.vDet = `${P}detected`;
    this.vDetFail = `${P}detector_fail`;
    this.vMoist = `${P}visible_moisture`;
    this.vPot = `${P}potential`;
    this.fDet = failVar('ice.detector');
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const cfg = this.cfg;
    const dtMin = dt / 60;

    // ---- environment
    let intensity = this.intensity();
    if (this.hasIntensityVar && this.intensityVarName && !vars.has(this.intensityVarName)) intensity = cfg.defaultIntensity ?? 0;
    const alt = this.alt();
    const base = this.cloudBase();
    const tops = this.cloudTops ? this.cloudTops() : base + (cfg.cloudThicknessFt ?? 5000);
    const cover = clamp01(this.cover());
    const sat = this.sat();
    const tat = this.tat();
    const inCloud = cover > 0.05 && base > 0 && alt >= base && alt <= tops ? cover : 0;
    const frz = sat <= 2 ? clamp01(this.precip()) : 0;
    const moisture = Math.max(inCloud, frz);
    const tf = interp1(ICING_TEMP_FACTOR, sat);
    // Kinetic heating: surfaces above 0 °C total temperature stay clear.
    const surfaceFactor = tat >= 1 ? 0 : tat <= 0 ? 1 : 1 - tat;
    const potential = clamp01(intensity) * moisture * tf * surfaceFactor;
    this.potential = potential;
    const tas = Math.max(20, this.tas());

    // ---- surfaces
    for (const s of this.surfaces) {
      const d = s.def;
      const pr = d.protection;
      const failed = vars.get(s.fail) !== 0;
      const act = pr && !failed ? clamp01(s.active()) : 0;
      s.prot = act;
      const speed = Math.pow(tas / (d.refTasKt ?? 150), d.speedExp ?? 1);
      const baseRate = d.ratePerMin * speed;
      let accrete = baseRate * potential;
      let removal = 0;
      s.inflating = Math.max(0, s.inflating - dt);
      if (pr && act > 0) {
        switch (pr.kind) {
          case 'thermal':
          case 'electric': {
            const cap = (pr.capacity ?? 1) * act;
            accrete = baseRate * Math.max(0, potential - cap);
            // Heat left over after melting the impinging water sheds existing ice.
            removal = (pr.shedRatePerMin ?? (pr.kind === 'thermal' ? 0.6 : 1.0)) * act * Math.max(0, 1 - potential / cap);
            break;
          }
          case 'fluid': {
            const cap = (pr.capacity ?? 1) * act;
            accrete = baseRate * Math.max(0, potential - cap);
            removal = (pr.shedRatePerMin ?? 0.3) * act * Math.max(0, 1 - potential / cap);
            break;
          }
          case 'boots': {
            s.bootTimer += dt;
            const cyc = pr.bootCycleS ?? 60;
            if (s.bootTimer >= cyc) {
              s.bootTimer -= cyc;
              s.inflating = pr.bootInflateS ?? 6;
              if (s.ice >= (pr.bootMinIce ?? 0.08)) s.ice *= 1 - (pr.bootRemoval ?? 0.85);
            }
            break;
          }
        }
      } else if (pr?.kind === 'boots') {
        s.bootTimer = 0;
      }
      // Natural melting above freezing, slow sublimation in dry air.
      if (tat > 0) removal += (d.meltRatePerMin ?? 0.3) * clamp(tat / 5, 0.2, 2);
      else if (moisture === 0) removal += 0.01;
      s.rate = accrete;
      s.ice = clamp01(s.ice + (accrete - removal * (s.ice > 0 ? 1 : 0)) * dtMin);
      if (s.ice < 1e-6) s.ice = 0;
      vars.set(d.output, s.ice);
      vars.set(s.o.rate, accrete);
      vars.set(s.o.protected, act > 0.5 ? 1 : 0);
      if (pr?.kind === 'boots') vars.set(s.o.boots, s.inflating > 0 ? 1 : 0);
      if (s.engVar) vars.set(s.engVar, act > 0.5 ? 1 : 0);
    }

    // ---- detector
    const detFailed = vars.get(this.fDet) !== 0;
    const powered = this.detPower();
    if (powered && !detFailed && potential >= (cfg.detector?.threshold ?? 0.05)) this.detHold = cfg.detector?.holdS ?? 60;
    else this.detHold = Math.max(0, this.detHold - dt);
    vars.set(this.vDet, powered && !detFailed && this.detHold > 0 ? 1 : 0);
    vars.set(this.vDetFail, detFailed ? 1 : 0);
    vars.set(this.vMoist, moisture);
    vars.set(this.vPot, potential);
  }

  /** Clears all ice (e.g. repositioning to a new flight). */
  clearIce(): void {
    for (const s of this.surfaces) {
      s.ice = 0;
      this.vars.set(s.def.output, 0);
    }
  }

  reset(): void {
    for (const s of this.surfaces) s.ice = this.vars.get(s.def.output, 0);
    this.detHold = 0;
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    for (const s of this.surfaces) {
      if (!s.def.protection) continue;
      f.push({ id: `ice.${s.def.id}.heat`, name: `${s.def.id} ice protection failure`, category: 'ice', description: 'Protection inoperative: ice accretes in icing conditions.' });
    }
    if (this.cfg.detector) f.push({ id: 'ice.detector', name: 'Ice detector failure', category: 'ice', description: 'No ICE detection; detector FAIL indication.' });
    return f;
  }

  dispose(): void {
    /* nothing */
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
