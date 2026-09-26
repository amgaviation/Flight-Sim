/**
 * Crew and passenger oxygen.
 *
 * Crew: gaseous bottle(s) feeding diluter-demand masks. While a mask is in
 * use the regulator delivers oxygen according to its mode:
 *   NORMAL (diluter): O2 fraction rises with cabin altitude from ~0 at sea
 *     level to 100 % at about 34,000 ft (EST schedule, typical diluter-demand
 *     regulator behaviour, TSO-C89),
 *   100 %: pure oxygen on demand,
 *   EMERGENCY: 100 % with positive pressure (extra continuous flow, EST
 *     10 L/min).
 * Demand is the breathing minute volume (BTPS, default 15 L/min — EST: light
 * work), converted to NTPD at cabin pressure: V_NTPD = V_BTPS·(Pcab − 6.3 kPa)/101.3 kPa·273/310.
 * Bottle pressure falls in proportion to the gas used: psi = full × remaining / capacity.
 *
 * Passengers:
 *   'chemical': oxygen generators fire when the masks deploy (e.g. bound to
 *     'press.pax_masks') and flow for a fixed time (737: 12, 15 or 22 min
 *     generators) — cannot be stopped;
 *   'gaseous': continuous-flow masks fed from a bottle while deployed and the
 *     supply valve is open.
 *
 * Outputs (prefix default 'oxy.'): <bottle>_psi, <bottle>_low, <mask>_flow_lpm,
 * <mask>_flowing (flow indicator), pax_deployed, pax_on (oxygen flowing),
 * pax_remaining_s.
 * Failures: oxy.<bottle>.leak (pressure bleeds away), oxy.pax (pax oxygen
 * system fails to flow).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import type { Table1D } from '../../physics/types';
import { interp1 } from '../../core/math';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { pressureAtAltitudeFt } from '../pressurization/Pressurization';
import type { FailureDef } from '../failures/FailureManager';

export interface OxygenBottleDef {
  id: string;
  /** Free-gas capacity at full pressure (L NTPD), e.g. 737 crew cylinder 115 cu ft ≈ 3,256 L. */
  capacityL: number;
  /** Full pressure (psi), e.g. 1850. */
  fullPsi: number;
  /** Initial pressure (psi); default full (or the saved `<bottle>_psi` var). */
  initialPsi?: number;
  /** LOW indication threshold (psi). Default 25 % of full. */
  lowPsi?: number;
  /** Supply/shutoff valve open (default true). */
  valve?: Binding;
  /** Leak rate while `fail.oxy.<id>.leak` (L/min). Default 30 (EST). */
  leakLpm?: number;
}

export interface CrewMaskDef {
  id: string;
  bottle: string;
  /** Mask on / in use (stowage doors open). */
  inUse: Binding;
  /** Regulator mode: 0 NORMAL (diluter), 1 100 %, 2 EMERGENCY. Default 0. */
  mode?: Binding;
  /** Breathing minute volume (L/min BTPS). Default 15. */
  minuteVolumeL?: number;
  /** Mask test/flow check (press-to-test): brief high flow. */
  test?: Binding;
}

export interface PaxOxygenDef {
  kind: 'chemical' | 'gaseous';
  /** Masks deployed (auto, e.g. 'press.pax_masks', or the PASS OXY switch). */
  deploy: Binding;
  /** Chemical generator duration (s). Default 720 (12 min). */
  durationS?: number;
  /** Gaseous: bottle and flow (L/min NTPD) for all masks. */
  bottle?: string;
  flowLpm?: number;
}

export interface OxygenConfig {
  prefix?: string;
  bottles: OxygenBottleDef[];
  crew?: CrewMaskDef[];
  pax?: PaxOxygenDef;
  /** Cabin altitude (ft), default 'press.cabin_alt_ft' (unpressurised aircraft: 'fdm.press_alt_ft'). */
  cabinAltitudeFt?: Binding;
}

/** Diluter-demand O2 fraction vs cabin altitude in NORMAL (EST, see file header). */
export const DILUTER_O2_FRACTION: Table1D = { x: [0, 8000, 15000, 25000, 34000], y: [0, 0.1, 0.3, 0.6, 1] };

class Bottle {
  remainingL: number;
  readonly valve: () => boolean;
  readonly o: Record<'psi' | 'low', string>;
  readonly failLeak: string;
  constructor(
    readonly def: OxygenBottleDef,
    vars: SimVars,
    prefix: string,
  ) {
    this.o = { psi: `${prefix}${def.id}_psi`, low: `${prefix}${def.id}_low` };
    const psi = vars.has(this.o.psi) ? vars.get(this.o.psi) : (def.initialPsi ?? def.fullPsi);
    this.remainingL = (Math.max(0, psi) / def.fullPsi) * def.capacityL;
    this.valve = compileCondition(vars, def.valve, true);
    this.failLeak = failVar(`oxy.${def.id}.leak`);
  }

  psi(): number {
    return (this.remainingL / this.def.capacityL) * this.def.fullPsi;
  }
}

class Mask {
  flow = 0;
  readonly inUse: () => boolean;
  readonly mode: Evaluator;
  readonly test: () => boolean;
  readonly o: Record<'flow_lpm' | 'flowing', string>;
  constructor(
    readonly def: CrewMaskDef,
    readonly bottle: number,
    vars: SimVars,
    prefix: string,
  ) {
    this.inUse = compileCondition(vars, def.inUse, false);
    this.mode = compileBinding(vars, def.mode, 0);
    this.test = compileCondition(vars, def.test, false);
    this.o = { flow_lpm: `${prefix}${def.id}_flow_lpm`, flowing: `${prefix}${def.id}_flowing` };
  }
}

export class OxygenSystem implements Subsystem {
  readonly name = 'oxygen';
  readonly prefix: string;
  private readonly bottles: Bottle[] = [];
  private readonly masks: Mask[] = [];
  private readonly cabinAlt: Evaluator;
  private readonly paxDeploy: () => boolean;
  private paxDeployed = false;
  private paxRemaining: number;
  private readonly paxBottle: number;
  private readonly o: Record<'pax_deployed' | 'pax_on' | 'pax_remaining_s', string>;
  private readonly fPax: string;

  constructor(
    private readonly vars: SimVars,
    private readonly cfg: OxygenConfig,
  ) {
    const P = (this.prefix = cfg.prefix ?? 'oxy.');
    const ids = new IdRegistry('OxygenSystem');
    for (const b of cfg.bottles) {
      ids.add(b.id, 'bottle');
      if (!(b.capacityL > 0) || !(b.fullPsi > 0)) throw new Error(`OxygenSystem: bottle '${b.id}' needs capacityL and fullPsi > 0`);
      this.bottles.push(new Bottle(b, vars, P));
    }
    const bi = (id: string): number => {
      const i = this.bottles.findIndex((b) => b.def.id === id);
      if (i < 0) throw new Error(`OxygenSystem: unknown bottle '${id}'`);
      return i;
    };
    for (const m of cfg.crew ?? []) {
      ids.add(m.id, 'mask');
      this.masks.push(new Mask(m, bi(m.bottle), vars, P));
    }
    this.cabinAlt = compileBinding(vars, cfg.cabinAltitudeFt ?? 'press.cabin_alt_ft', 0);
    this.paxDeploy = compileCondition(vars, cfg.pax?.deploy, false);
    this.paxBottle = cfg.pax?.kind === 'gaseous' && cfg.pax.bottle ? bi(cfg.pax.bottle) : -1;
    this.paxRemaining = cfg.pax?.durationS ?? 720;
    this.o = { pax_deployed: `${P}pax_deployed`, pax_on: `${P}pax_on`, pax_remaining_s: `${P}pax_remaining_s` };
    this.fPax = failVar('oxy.pax');
    if (vars.has(this.o.pax_remaining_s)) this.paxRemaining = vars.get(this.o.pax_remaining_s);
    this.paxDeployed = vars.get(this.o.pax_deployed) !== 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const dtMin = dt / 60;
    const cabAlt = this.cabinAlt();
    const pCab = pressureAtAltitudeFt(cabAlt);
    // BTPS -> NTPD at cabin pressure (water vapour 6.3 kPa at 37 °C).
    const btpsToNtpd = (Math.max(0, pCab - 6280) / 101325) * (273.15 / 310.15);

    for (const m of this.masks) {
      const b = this.bottles[m.bottle];
      let flow = 0;
      if (b.remainingL > 0 && b.valve()) {
        if (m.test()) flow = 30; // EST: flow check
        else if (m.inUse()) {
          const mode = Math.round(m.mode());
          const frac = mode >= 1 ? 1 : interp1(DILUTER_O2_FRACTION, cabAlt);
          flow = (m.def.minuteVolumeL ?? 15) * frac * btpsToNtpd + (mode === 2 ? 10 : 0);
        }
      }
      m.flow = flow;
      b.remainingL = Math.max(0, b.remainingL - flow * dtMin);
      vars.set(m.o.flow_lpm, flow);
      vars.set(m.o.flowing, flow > 0.05 ? 1 : 0);
    }

    // Passengers.
    const pax = this.cfg.pax;
    let paxOn = false;
    if (pax) {
      if (this.paxDeploy()) this.paxDeployed = true;
      const failed = vars.get(this.fPax) !== 0;
      if (this.paxDeployed && !failed) {
        if (pax.kind === 'chemical') {
          if (this.paxRemaining > 0) {
            paxOn = true;
            this.paxRemaining = Math.max(0, this.paxRemaining - dt);
          }
        } else if (this.paxBottle >= 0) {
          const b = this.bottles[this.paxBottle];
          if (b.remainingL > 0 && b.valve()) {
            paxOn = true;
            b.remainingL = Math.max(0, b.remainingL - (pax.flowLpm ?? 40) * dtMin);
            this.paxRemaining = (b.remainingL / (pax.flowLpm ?? 40)) * 60;
          }
        }
      }
    }

    for (const b of this.bottles) {
      if (vars.get(b.failLeak) !== 0) b.remainingL = Math.max(0, b.remainingL - (b.def.leakLpm ?? 30) * dtMin);
      const psi = b.psi();
      vars.set(b.o.psi, psi);
      vars.set(b.o.low, psi < (b.def.lowPsi ?? 0.25 * b.def.fullPsi) ? 1 : 0);
    }
    vars.set(this.o.pax_deployed, this.paxDeployed ? 1 : 0);
    vars.set(this.o.pax_on, paxOn ? 1 : 0);
    vars.set(this.o.pax_remaining_s, this.paxRemaining);
  }

  /** Servicing: refills bottles, re-stows masks and replaces chemical generators. */
  service(): void {
    for (const b of this.bottles) b.remainingL = b.def.capacityL;
    this.paxDeployed = false;
    this.paxRemaining = this.cfg.pax?.durationS ?? 720;
  }

  bottlePsi(id: string): number {
    const b = this.bottles.find((x) => x.def.id === id);
    return b ? b.psi() : 0;
  }

  reset(): void {
    for (const b of this.bottles) if (this.vars.has(b.o.psi)) b.remainingL = (this.vars.get(b.o.psi) / b.def.fullPsi) * b.def.capacityL;
    this.paxDeployed = this.vars.get(this.o.pax_deployed) !== 0;
    if (this.vars.has(this.o.pax_remaining_s)) this.paxRemaining = this.vars.get(this.o.pax_remaining_s);
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = this.bottles.map((b) => ({ id: `oxy.${b.def.id}.leak`, name: `${b.def.id} oxygen leak`, category: 'oxygen', description: 'Bottle pressure bleeds away.' }));
    if (this.cfg.pax) f.push({ id: 'oxy.pax', name: 'Passenger oxygen failure', category: 'oxygen', description: 'Masks deploy but no oxygen flows.' });
    return f;
  }

  dispose(): void {
    /* nothing */
  }
}
