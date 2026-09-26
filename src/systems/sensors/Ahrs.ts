/**
 * Attitude and heading reference (solid-state AHRS, e.g. Garmin GRS 77/79
 * in the G1000/G3000/G5000) and the shared attitude publisher used by the
 * IRS block.
 *
 * Sensors are the one place allowed to read FDM truth: the AHRS samples
 * `fdm.pitch/bank/heading/rates/accelerations`, filters them and publishes
 * `ahrs{s}.*` with validity. Avionics read only `ahrs{s}.*`.
 *
 * Behaviour:
 *   - power-up: attitude invalid for `alignS` (GRS 77: "AHRS alignment
 *     normally within one minute", G1000 PG 190-00498; EST default 45 s),
 *     then heading after `hdgAlignS` (magnetometer settles).
 *   - `fail.ahrs{s}`: everything invalid. `fail.ahrs{s}.hdg` (magnetometer
 *     fault): heading invalid, attitude valid (G1000 "HDG" red X).
 *   - `fail.ahrs{s}.drift`: slow attitude drift (EST 2 deg/min bank and pitch
 *     error) — the classic "subtle AHRS failure" training scenario.
 *
 * Vars written (s = `outputIndex`): ahrs{s}.pitch_deg, bank_deg, hdg_mag_deg,
 * hdg_true_deg, turn_rate_dps, slip, valid + SENSOR_VARS p/q/r_dps,
 * nx/ny/nz_g, att_valid, hdg_valid, aligning, align_s.
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ADC, FDM } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { norm360, type BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from './vars';

/** Ball deflection at full tube travel corresponds to this lateral specific force (g). EST: ~12 deg ball arc. */
export const SLIP_FULL_SCALE_G = 0.2;

/**
 * Publishes filtered attitude/rates from FDM truth into the `ahrs{s}.*`
 * vars. Allocation-free; shared by `Ahrs` and `Irs`.
 */
export class AttitudePublisher {
  readonly index: number;
  /** Additive errors (deg) applied to the published attitude/heading (drift, misalignment). */
  pitchErr = 0;
  bankErr = 0;
  hdgErr = 0;
  private pitch = 0;
  private bank = 0;
  private init = false;
  private readonly tau: number;
  private readonly n: {
    pitch: string; bank: string; hdg: string; hdgT: string; turn: string; slip: string; valid: string;
    p: string; q: string; r: string; nx: string; ny: string; nz: string; att: string; hdgV: string;
  };

  constructor(private readonly vars: SimVars, index: number, filterTauS = 0.04) {
    this.index = index;
    this.tau = filterTauS;
    const s = index;
    this.n = {
      pitch: ADC.pitch(s), bank: ADC.bank(s), hdg: ADC.heading(s), hdgT: ADC.headingTrue(s), turn: ADC.turnRate(s),
      slip: ADC.slip(s), valid: ADC.ahrsValid(s), p: SENSOR_VARS.p(s), q: SENSOR_VARS.q(s), r: SENSOR_VARS.r(s),
      nx: SENSOR_VARS.nx(s), ny: SENSOR_VARS.ny(s), nz: SENSOR_VARS.nz(s), att: SENSOR_VARS.attValid(s), hdgV: SENSOR_VARS.hdgValid(s),
    };
  }

  /**
   * Samples truth and writes the vars. `attValid`/`hdgValid` gate the
   * validity flags; values freeze while their part is invalid (a flagged
   * display does not show them anyway). `magVarDeg` converts true to
   * magnetic heading (NaN = use the FDM's WMM variation).
   */
  publish(dt: number, attValid: boolean, hdgValid: boolean, magVarDeg = NaN): void {
    const v = this.vars;
    const n = this.n;
    const pt = v.get(FDM.pitch) + this.pitchErr;
    const bk = v.get(FDM.bank) + this.bankErr;
    if (!this.init) {
      this.pitch = pt;
      this.bank = bk;
      this.init = true;
    }
    const a = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
    this.pitch += (pt - this.pitch) * a;
    let db = bk - this.bank;
    if (db > 180) db -= 360;
    else if (db < -180) db += 360;
    this.bank += db * a;
    if (this.bank > 180) this.bank -= 360;
    else if (this.bank < -180) this.bank += 360;
    if (attValid) {
      v.set(n.pitch, this.pitch);
      v.set(n.bank, this.bank);
      v.set(n.p, v.get(FDM.p));
      v.set(n.q, v.get(FDM.q));
      v.set(n.r, v.get(FDM.r));
      v.set(n.nx, v.get(FDM.nx));
      const ny = v.get(FDM.ny);
      v.set(n.ny, ny);
      v.set(n.nz, v.get(FDM.nz));
      v.set(n.turn, v.get(FDM.turnRate));
      const slip = -ny / SLIP_FULL_SCALE_G;
      v.set(n.slip, slip > 1 ? 1 : slip < -1 ? -1 : slip);
    }
    if (hdgValid) {
      const ht = norm360(v.get(FDM.headingTrue) + this.hdgErr);
      const mv = Number.isNaN(magVarDeg) ? v.get(FDM.magVar) : magVarDeg;
      v.set(n.hdgT, ht);
      v.set(n.hdg, norm360(ht - mv));
    }
    v.set(n.att, attValid ? 1 : 0);
    v.set(n.hdgV, hdgValid ? 1 : 0);
    v.set(n.valid, attValid && hdgValid ? 1 : 0);
  }

  /** Marks everything invalid (values frozen). */
  invalidate(): void {
    const v = this.vars;
    v.set(this.n.att, 0);
    v.set(this.n.hdgV, 0);
    v.set(this.n.valid, 0);
  }

  reset(): void {
    this.init = false;
    this.pitchErr = 0;
    this.bankErr = 0;
    this.hdgErr = 0;
  }
}

export interface AhrsConfig {
  /** Output index `s` for `ahrs{s}.*`. */
  index: number;
  /** AHRS power (bus). Default true. */
  power?: Binding;
  /** Attitude alignment after power-up (s). Default 45 (EST, see header). */
  alignS?: number;
  /** Additional time until heading (magnetometer) is valid (s). Default 15 (EST). */
  hdgAlignS?: number;
  /** Output filter (s). Default 0.04. */
  filterTauS?: number;
  /** Start aligned (initial states other than cold & dark call `reset()` with power on). Default false. */
  startAligned?: boolean;
}

export class Ahrs implements Subsystem {
  readonly name: string;
  readonly index: number;
  readonly out: AttitudePublisher;
  private readonly vars: SimVars;
  private readonly power: () => boolean;
  private readonly alignS: number;
  private readonly hdgAlignS: number;
  private alignT: number;
  private wasPowered = false;
  private readonly fAll: string;
  private readonly fHdg: string;
  private readonly fDrift: string;
  private readonly nAligning: string;
  private readonly nAlignS: string;

  constructor(env: BlockEnv, cfg: AhrsConfig) {
    this.index = cfg.index;
    this.name = `ahrs${cfg.index}`;
    this.vars = env.vars;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.alignS = cfg.alignS ?? 45;
    this.hdgAlignS = cfg.hdgAlignS ?? 15;
    this.out = new AttitudePublisher(env.vars, cfg.index, cfg.filterTauS);
    this.alignT = cfg.startAligned ? this.alignS + this.hdgAlignS : 0;
    this.wasPowered = !!cfg.startAligned;
    this.fAll = failVar(`ahrs${cfg.index}`);
    this.fHdg = failVar(`ahrs${cfg.index}.hdg`);
    this.fDrift = failVar(`ahrs${cfg.index}.drift`);
    this.nAligning = SENSOR_VARS.aligning(cfg.index);
    this.nAlignS = SENSOR_VARS.alignRemaining(cfg.index);
  }

  failures(): FailureDef[] {
    const s = this.index;
    return [
      { id: `ahrs${s}`, name: `AHRS ${s}`, category: 'attitude', description: 'AHRS fails: attitude and heading flagged.' },
      { id: `ahrs${s}.hdg`, name: `AHRS ${s} magnetometer`, category: 'attitude', description: 'Heading flagged; attitude remains.' },
      { id: `ahrs${s}.drift`, name: `AHRS ${s} attitude drift`, category: 'attitude', description: 'Attitude slowly drifts (2 deg/min) without a flag.' },
    ];
  }

  /** Re-synchronises; `aligned` true skips the alignment (initial states in flight). */
  reset(aligned = true): void {
    this.out.reset();
    this.alignT = aligned ? this.alignS + this.hdgAlignS : 0;
    this.wasPowered = aligned && this.power();
  }

  update(dt: number): void {
    const v = this.vars;
    const on = this.power() && v.get(this.fAll) === 0;
    if (on && !this.wasPowered) this.alignT = 0;
    this.wasPowered = on;
    if (!on) {
      this.out.invalidate();
      v.set(this.nAligning, 0);
      v.set(this.nAlignS, 0);
      return;
    }
    this.alignT += dt;
    const attOk = this.alignT >= this.alignS;
    const hdgOk = this.alignT >= this.alignS + this.hdgAlignS && v.get(this.fHdg) === 0;
    if (v.get(this.fDrift) !== 0) {
      // EST: 2 deg/min in both axes.
      this.out.bankErr += (2 / 60) * dt;
      this.out.pitchErr += (1 / 60) * dt;
    }
    this.out.publish(dt, attOk, hdgOk);
    v.set(this.nAligning, attOk ? 0 : 1);
    v.set(this.nAlignS, attOk ? 0 : this.alignS - this.alignT);
  }
}
