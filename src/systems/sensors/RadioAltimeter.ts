/**
 * Radio altimeter (LRRA). Measures the height of the gear-down reference
 * point above the terrain (the FDM's `fdm.radio_alt_ft`, already referenced
 * to the main-gear bottom) with a short tracker lag.
 *
 * Range: -20 .. `maxFt` (default 2500 ft: ARINC 707 LRRA / typical bizjet
 * RA range; the 737NG LRRA displays up to 2500 ft, SmartCockpit 737NG
 * Flight Instruments). Above the range the output is "no computed data"
 * (`ra{s}.ncd` = 1, `valid` = 0, altitude parked at `maxFt`), which is how
 * PFDs blank the RA readout. Beyond `maxBankDeg` of bank or pitch the beam
 * loses the ground and the RA goes NCD too (EST 40 deg).
 *
 * Vars written: ra{s}.alt_ft, ra{s}.valid, ra{s}.ncd.
 * Vars read: fdm.radio_alt_ft, fdm.bank_deg, fdm.pitch_deg.
 * Failures: ra{s} (unit failed: invalid, not NCD).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { FDM } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from './vars';

export interface RadioAltimeterConfig {
  index: number;
  power?: Binding;
  /** Maximum valid height (ft). Default 2500. */
  maxFt?: number;
  /** Tracker lag (s). Default 0.1 (EST). */
  tauS?: number;
  /** Beyond this bank/pitch (deg) the return is lost (NCD). Default 40 (EST). */
  maxBankDeg?: number;
  /** Power-up self test (s) before the output is valid. Default 2 (EST). */
  selfTestS?: number;
}

export class RadioAltimeter implements Subsystem {
  readonly name: string;
  readonly index: number;
  /** Last filtered height (ft). */
  altFt = 0;
  private readonly vars: SimVars;
  private readonly power: () => boolean;
  private readonly maxFt: number;
  private readonly tau: number;
  private readonly maxBank: number;
  private readonly testS: number;
  private test = 0;
  private wasOn = false;
  private init = false;
  private readonly f: string;
  private readonly oAlt: string;
  private readonly oValid: string;
  private readonly oNcd: string;

  constructor(env: BlockEnv, cfg: RadioAltimeterConfig) {
    this.index = cfg.index;
    this.name = `ra${cfg.index}`;
    this.vars = env.vars;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.maxFt = cfg.maxFt ?? 2500;
    this.tau = cfg.tauS ?? 0.1;
    this.maxBank = cfg.maxBankDeg ?? 40;
    this.testS = cfg.selfTestS ?? 2;
    this.f = failVar(`ra${cfg.index}`);
    this.oAlt = SENSOR_VARS.raAlt(cfg.index);
    this.oValid = SENSOR_VARS.raValid(cfg.index);
    this.oNcd = SENSOR_VARS.raNcd(cfg.index);
  }

  failures(): FailureDef[] {
    return [{ id: `ra${this.index}`, name: `Radio altimeter ${this.index}`, category: 'navigation', description: 'RA flagged.' }];
  }

  reset(): void {
    this.init = false;
    this.wasOn = this.power();
    this.test = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const on = this.power() && v.get(this.f) === 0;
    if (on && !this.wasOn) this.test = this.testS;
    this.wasOn = on;
    if (this.test > 0) this.test = Math.max(0, this.test - dt);
    const truth = v.get(FDM.radioAlt);
    if (!this.init) {
      this.altFt = truth;
      this.init = true;
    }
    this.altFt += (truth - this.altFt) * (this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1);
    const attOk = Math.abs(v.get(FDM.bank)) < this.maxBank && Math.abs(v.get(FDM.pitch)) < this.maxBank;
    const ncd = on && (this.altFt > this.maxFt || !attOk);
    const valid = on && this.test <= 0 && !ncd;
    let out = this.altFt < -20 ? -20 : this.altFt;
    if (ncd) out = this.maxFt;
    if (on) v.set(this.oAlt, out);
    v.set(this.oNcd, ncd ? 1 : 0);
    v.set(this.oValid, valid ? 1 : 0);
  }
}
