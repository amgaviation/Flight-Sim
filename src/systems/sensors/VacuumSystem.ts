/**
 * Engine-driven vacuum system for the air-driven gyros of a steam-gauge
 * cockpit (Cessna 172S: attitude indicator and directional gyro on vacuum,
 * turn coordinator electric).
 *
 * Each pump's suction comes from the engine model (`eng{i}.vacuum_inhg`,
 * physics: 5.0·(1 − e^(−rpm/400)) inHg). The regulator caps the system at
 * `regulatedInHg`; a pump failure removes that pump; a line leak drops the
 * suction delivered to the gyros. The analog attitude indicator / DG read
 * `ac.vac.suction_inhg` (ANALOG_VARS.suction) and spin down / tumble on their
 * own when it is low.
 *
 * Numbers: Cessna 172S POH §7 "Vacuum System and Instruments": suction gauge
 * normal range (green arc) 4.5–5.5 in.Hg; the LOW VACUUM annunciator (VAC on
 * the steam-gauge annunciator panel) illuminates below 3.0 in.Hg.
 *
 * Vars written: ac.vac.suction_inhg, vac.low, vac.pump{n}_ok (1-based pump
 * order). Failures: vac.pump{n} (pump inoperative), vac.leak (line leak,
 * suction × 0.4 EST), vac.regulator (regulator stuck open: suction × 0.6 EST).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ENG } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from './vars';

export interface VacuumConfig {
  /** One entry per pump: suction the pump can pull (inHg). Default: one pump on `eng1.vacuum_inhg`. */
  pumps?: { suction: Binding }[];
  /** Regulator setting (inHg). Default 5.3 (EST: centre of the 4.5–5.5 green arc, slightly high). */
  regulatedInHg?: number;
  /** LOW VACUUM threshold (inHg). Default 3.0. */
  lowInHg?: number;
  /** Annunciator power (the light needs a bus). Default true. */
  annunciatorPower?: Binding;
  /** Gauge/system lag (s). Default 0.5 (EST). */
  tauS?: number;
}

export class VacuumSystem implements Subsystem {
  readonly name = 'vacuum';
  /** Suction at the gyros (inHg). */
  suction = 0;
  private readonly vars: SimVars;
  private readonly pumps: Evaluator[];
  private readonly reg: number;
  private readonly low: number;
  private readonly annPower: () => boolean;
  private readonly tau: number;
  private readonly fPump: string[];
  private readonly oPump: string[];
  private readonly fLeak = failVar('vac.leak');
  private readonly fReg = failVar('vac.regulator');

  constructor(env: BlockEnv, cfg: VacuumConfig = {}) {
    this.vars = env.vars;
    const defs = cfg.pumps ?? [{ suction: ENG.vacuumInHg(1) }];
    this.pumps = defs.map((p) => compileBinding(env.vars, p.suction, 0));
    this.fPump = defs.map((_, i) => failVar(`vac.pump${i + 1}`));
    this.oPump = defs.map((_, i) => SENSOR_VARS.vacPumpOk(i + 1));
    this.reg = cfg.regulatedInHg ?? 5.3;
    this.low = cfg.lowInHg ?? 3.0;
    this.annPower = compileCondition(env.vars, cfg.annunciatorPower, true);
    this.tau = cfg.tauS ?? 0.5;
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = this.fPump.map((_, i) => ({
      id: `vac.pump${i + 1}`,
      name: `Vacuum pump ${i + 1}`,
      category: 'instruments',
      description: 'Pump inoperative: suction decays, vacuum gyros spin down.',
    }));
    f.push({ id: 'vac.leak', name: 'Vacuum line leak', category: 'instruments', description: 'Low suction at the gyros.' });
    f.push({ id: 'vac.regulator', name: 'Vacuum regulator failure', category: 'instruments', description: 'Regulator stuck open: low suction.' });
    return f;
  }

  reset(): void {
    this.suction = this.target();
    this.vars.set(SENSOR_VARS.vacSuction, this.suction);
  }

  private target(): number {
    const v = this.vars;
    let best = 0;
    for (let i = 0; i < this.pumps.length; i++) {
      const ok = v.get(this.fPump[i]) === 0;
      const s = ok ? this.pumps[i]() : 0;
      v.set(this.oPump[i], ok && s > this.low ? 1 : 0);
      if (s > best) best = s;
    }
    let s = best > this.reg ? this.reg : best;
    if (v.get(this.fLeak) !== 0) s *= 0.4;
    if (v.get(this.fReg) !== 0) s *= 0.6;
    return s;
  }

  update(dt: number): void {
    const t = this.target();
    this.suction += (t - this.suction) * (this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1);
    this.vars.set(SENSOR_VARS.vacSuction, this.suction);
    this.vars.set(SENSOR_VARS.vacLow, this.annPower() && this.suction < this.low ? 1 : 0);
  }
}
