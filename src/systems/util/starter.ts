/**
 * Starter output driver shared by electric starters / starter-generators
 * (electrical) and air-turbine starters (pneumatic).
 *
 * The physics engine models read `eng{i}.starter` as a boolean
 * (docs/modules/physics.md §4): a turbofan's N2 spools toward
 * `starterMaxN2_pct` with time constant `starterTau_s` (default 4 s) while it
 * is set and decays with τ = 6 s while it is clear; a piston engine gets the
 * full `starterTorque_Nm·(1 − rpm/350)` while it is set.
 *
 * SCOPE: a weak battery, a sagging bus or low duct pressure must crank the
 * engine more slowly, so the driver pulse-width-modulates the boolean with a
 * sigma-delta modulator at the systems rate (60 Hz, faster than the engine
 * spool dynamics). For a turbine the duty is chosen so that the engine's
 * *starter-only equilibrium N2* scales with the requested strength r:
 *
 *   equilibrium: d/τs·(Nmax − N) = (1 − d)/τd·N   ->   N/Nmax = (d/τs) / (d/τs + (1 − d)/τd)
 *   inverse:     d = r·τs / (τd·(1 − r) + r·τs)
 *
 * For a piston engine the average torque is proportional to the duty, so
 * d = r (a DC motor's stall torque scales with its terminal voltage).
 */
import type { SimVars } from '../../core/SimVars';
import { SigmaDelta } from './timers';

export type StarterEngineKind = 'turbine' | 'piston';

/** Physics turbofan: unlit N2 decay time constant with the starter released (Turbofan.ts, `tau = starter ? starterTau : 6`). */
export const TURBINE_STARTER_DECAY_TAU_S = 6;
/** Physics turbofan default `starterTau_s` (TurbofanConfigExtras). */
export const TURBINE_STARTER_TAU_S = 4;

/** Duty cycle giving a turbine starter-only equilibrium N2 of `r`·starterMaxN2 (see file header). */
export function starterDutyForSpeedRatio(r: number, starterTau = TURBINE_STARTER_TAU_S, decayTau = TURBINE_STARTER_DECAY_TAU_S): number {
  if (r <= 0) return 0;
  if (r >= 1) return 1;
  return (r * starterTau) / (decayTau * (1 - r) + r * starterTau);
}

export interface StarterDriverOptions {
  /** Var to drive, usually `ENG.starter(i)` = `eng{i}.starter`. */
  engineStarterVar: string;
  kind: StarterEngineKind;
  /** Engine `starterTau_s` if the aircraft overrides the physics default of 4 s. */
  starterTau?: number;
}

export class StarterDriver {
  readonly engineStarterVar: string;
  readonly kind: StarterEngineKind;
  readonly starterTau: number;
  /** Last duty (0..1) and last written output (0/1). */
  duty = 0;
  output: 0 | 1 = 0;
  private readonly sd = new SigmaDelta();

  constructor(
    private readonly vars: SimVars,
    opts: StarterDriverOptions,
  ) {
    this.engineStarterVar = opts.engineStarterVar;
    this.kind = opts.kind;
    this.starterTau = opts.starterTau ?? TURBINE_STARTER_TAU_S;
  }

  /**
   * Call every systems update. `engaged` = starter motor/valve powered;
   * `strength` 0..1 = achievable starter speed (turbine) or torque (piston)
   * relative to nominal conditions.
   */
  update(engaged: boolean, strength: number): 0 | 1 {
    if (!engaged || strength <= 0) {
      this.duty = 0;
      this.sd.reset();
      this.output = 0;
    } else {
      this.duty = this.kind === 'turbine' ? starterDutyForSpeedRatio(strength, this.starterTau) : Math.min(1, strength);
      this.output = this.duty >= 1 ? 1 : this.sd.update(this.duty);
    }
    this.vars.set(this.engineStarterVar, this.output);
    return this.output;
  }

  reset(): void {
    this.sd.reset();
    this.duty = 0;
    this.output = 0;
  }
}
