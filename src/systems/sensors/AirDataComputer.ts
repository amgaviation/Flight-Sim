/**
 * Air data: pitot/static pressure measurement -> IAS, Mach, altitude, VS,
 * TAS, SAT/TAT, AoA. One instance per air-data source (`adc{s}.*`).
 *
 * Works for both digital air-data computers (glass cockpits: power, BITE
 * validity) and purely pneumatic systems (172 steam gauges: `power: true`,
 * no validity logic — the instruments read the same vars).
 *
 * Measurement model (all pressures in Pa):
 *   ps_true = fdm.static_press_pa (+ static-source position error)
 *   qc_true = impact pressure of fdm.cas_kt (isentropic, subsonic/Rayleigh)
 *   pt_true = ps_true + qc_true
 *   Each port is a first-order pneumatic lag. A partially blocked port
 *   (ice or failure, 0..1) slows the line: tau = tau0 / (1 - b)^2. A fully
 *   blocked port (b >= 0.95) traps the pressure:
 *     - static blocked: altimeter frozen, VSI zero, ASI under-reads climbing
 *       and over-reads descending (FAA-H-8083-15B, ch. 5 "Blockage of the
 *       Pitot-Static System");
 *     - pitot blocked with the drain hole blocked too: ASI acts as an
 *       altimeter (over-reads when climbing); with the drain hole open the
 *       trapped pitot pressure bleeds to static and IAS falls to zero
 *       (same source).
 *   Indicated values are then recomputed from the *measured* pressures with
 *   the same ISA relations the FDM uses, so errors are physically consistent.
 *
 * Altimeter: indicated altitude = H(ps) - H(p_setting) where H is the ISA
 * pressure altitude (the Kollsman window shifts the scale by the pressure
 * altitude of the setting). STD uses 29.92 inHg.
 *
 * Vars written (s = index): adc{s}.ias_kt, mach, alt_ft, vs_fpm, tas_kt,
 * sat_c, tat_c, valid, and (SENSOR_VARS) press_alt_ft, cas_kt, aoa_deg,
 * ias_trend_kt, ias_rate_kts, pitot_blocked, static_blocked, alt_static,
 * powered. Initialised if missing: adc{s}.baro_inhg (29.92), adc{s}.baro_std (0).
 * Vars read: fdm.static_press_pa, fdm.cas_kt, fdm.tat_c, fdm.aoa_deg,
 * ice.pitot{p}, ice.static{p}, fail.* below, adc{s}.baro_inhg/baro_std.
 * Failures: adc{s} (computer), adc{s}.pitot (pitot blocked), adc{s}.static
 * (static port blocked), adc{s}.aoa (AoA vane jammed).
 */
import type { Subsystem } from '../../aircraft/types';
import type { Table1D } from '../../physics/types';
import type { FailureDef } from '../failures/FailureManager';
import { ADC, FDM, ICE } from '../../core/vars';
import { interp1 } from '../../core/math';
import { INHG_TO_PA, KT_TO_MS, MS_TO_KT, M_TO_FT } from '../../core/units';
import {
  casFromImpactPressure,
  impactPressureFromCas,
  machFromImpactPressure,
  pressureAltitude,
  speedOfSound,
} from '../../physics/atmosphere';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { RateFilter, type BlockEnv, type Schedule, sched } from '../autopilot/lib';
import { SENSOR_VARS } from './vars';

export interface AirDataConfig {
  /** Air-data source index `s` (1-based) for the `adc{s}.*` output vars. */
  index: number;
  /** Computer power (glass). Default true (pneumatic instruments need none). */
  power?: Binding;
  /** Digital ADC: validity logic and power-up self test. Default true when `power` is given. */
  digital?: boolean;
  /** Power-up self-test time before data is valid (s). Default 3 (EST: typical ADC BITE). */
  selfTestS?: number;
  /** Pitot probe index for `ice.pitot{p}` (default = index). */
  pitotProbe?: number;
  /** Static port index for `ice.static{p}` (default = index). */
  staticPort?: number;
  /** Pneumatic line time constants (s). Default pitot 0.08, static 0.12 (EST: short lines, instruments add their own lag). */
  pitotTauS?: number;
  staticTauS?: number;
  /** Pitot drain hole: true = trapped pitot pressure bleeds to static when the probe is blocked (IAS -> 0). Default false (drain blocked too: ASI acts as an altimeter). */
  pitotDrainOpen?: boolean;
  /** Vertical speed filter (s). Default 0.6 (digital ADC); mechanical VSIs add their own lag in the instrument. */
  vsTauS?: number;
  /** Airspeed-indicator calibration: KIAS as a function of KCAS (inverse of the POH "airspeed calibration" table). Default IAS = CAS. */
  iasFromCas?: Table1D;
  /** Static-source position error (Pa, + = measured static pressure too high) vs KCAS. Default 0. */
  staticErrorPa?: Schedule;
  /** Alternate static source (172S: ALT STATIC AIR valve). */
  alternateStatic?: {
    /** Selected (valve open). */
    active: Binding;
    /** Additional static error (Pa) vs KCAS while selected; cabin pressure is lower than ambient -> negative. */
    errorPa: Schedule;
  };
  /** AoA vane: lag (s, default 0.1) and bias (deg, default 0). */
  aoa?: { tauS?: number; biasDeg?: number };
  /** TAT probe recovery factor used to back out SAT (default 1.0: fdm.tat_c is ideal stagnation temperature). */
  tatRecovery?: number;
  /** Airspeed trend horizon (s): Garmin 6, Boeing 10 (default 6; G1000 PG "6-second airspeed trend vector"). */
  trendS?: number;
}

/** Standard atmosphere sea-level pressure in inHg (29.92126). */
export const STD_BARO_INHG = 101325 / INHG_TO_PA;

/** ISA pressure altitude (ft) for a pressure in Pa. */
export function pressureAltitudeFt(pa: number): number {
  return pressureAltitude(pa) * M_TO_FT;
}

/** Indicated altitude (ft) of a static pressure with the altimeter set to `baroInHg`. */
export function indicatedAltitudeFt(staticPa: number, baroInHg: number): number {
  return pressureAltitudeFt(staticPa) - pressureAltitudeFt(baroInHg * INHG_TO_PA);
}

const BLOCKED = 0.95;

export class AirDataComputer implements Subsystem {
  readonly name: string;
  readonly index: number;

  private readonly vars: BlockEnv['vars'];
  private readonly power: () => boolean;
  private readonly digital: boolean;
  private readonly selfTestS: number;
  private readonly altStaticOn: (() => boolean) | null;
  private readonly altStaticErr: Schedule;
  private readonly staticErr: Schedule;
  private readonly iasTable: Table1D | undefined;
  private readonly pitotTau: number;
  private readonly staticTau: number;
  private readonly drainOpen: boolean;
  private readonly aoaTau: number;
  private readonly aoaBias: number;
  private readonly tatRecovery: number;
  private readonly trendS: number;

  // measured state
  private ps = NaN;
  private pt = NaN;
  private aoa = 0;
  private tat = 15;
  private testTimer = 0;
  private wasPowered = false;
  private readonly vsFilter: RateFilter;
  private readonly iasRate = new RateFilter(1.0);

  // var names
  private readonly o: {
    ias: string; mach: string; alt: string; vs: string; tas: string; sat: string; tat: string; valid: string;
    baro: string; std: string; pressAlt: string; cas: string; aoa: string; trend: string; rate: string;
    pitotBlk: string; staticBlk: string; altStatic: string; powered: string;
  };
  private readonly iPitotIce: string;
  private readonly iStaticIce: string;
  private readonly fAdc: string;
  private readonly fPitot: string;
  private readonly fStatic: string;
  private readonly fAoa: string;

  constructor(env: BlockEnv, cfg: AirDataConfig) {
    const s = cfg.index;
    this.index = s;
    this.name = `adc${s}`;
    this.vars = env.vars;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.digital = cfg.digital ?? cfg.power !== undefined;
    this.selfTestS = cfg.selfTestS ?? 3;
    this.altStaticOn = cfg.alternateStatic ? compileCondition(env.vars, cfg.alternateStatic.active) : null;
    this.altStaticErr = cfg.alternateStatic?.errorPa ?? 0;
    this.staticErr = cfg.staticErrorPa ?? 0;
    this.iasTable = cfg.iasFromCas;
    this.pitotTau = cfg.pitotTauS ?? 0.08;
    this.staticTau = cfg.staticTauS ?? 0.12;
    this.drainOpen = cfg.pitotDrainOpen ?? false;
    this.vsFilter = new RateFilter(cfg.vsTauS ?? 0.6);
    this.aoaTau = cfg.aoa?.tauS ?? 0.1;
    this.aoaBias = cfg.aoa?.biasDeg ?? 0;
    this.tatRecovery = cfg.tatRecovery ?? 1;
    this.trendS = cfg.trendS ?? 6;
    this.o = {
      ias: ADC.ias(s), mach: ADC.mach(s), alt: ADC.baroAlt(s), vs: ADC.vs(s), tas: ADC.tas(s), sat: ADC.sat(s),
      tat: ADC.tat(s), valid: ADC.valid(s), baro: ADC.baroSetting(s), std: ADC.baroStd(s),
      pressAlt: SENSOR_VARS.pressAlt(s), cas: SENSOR_VARS.cas(s), aoa: SENSOR_VARS.aoa(s), trend: SENSOR_VARS.iasTrend(s),
      rate: SENSOR_VARS.iasRate(s), pitotBlk: SENSOR_VARS.pitotBlocked(s), staticBlk: SENSOR_VARS.staticBlocked(s),
      altStatic: SENSOR_VARS.altStatic(s), powered: SENSOR_VARS.powered(s),
    };
    this.iPitotIce = ICE.pitot(cfg.pitotProbe ?? s);
    this.iStaticIce = ICE.static(cfg.staticPort ?? s);
    this.fAdc = failVar(`adc${s}`);
    this.fPitot = failVar(`adc${s}.pitot`);
    this.fStatic = failVar(`adc${s}.static`);
    this.fAoa = failVar(`adc${s}.aoa`);
    const v = env.vars;
    if (!v.has(this.o.baro)) v.set(this.o.baro, STD_BARO_INHG);
    if (!v.has(this.o.std)) v.set(this.o.std, 0);
  }

  failures(): FailureDef[] {
    const s = this.index;
    const c = 'air data';
    return [
      { id: `adc${s}`, name: `Air data computer ${s}`, category: c, description: 'ADC fails: airspeed, altitude and VS flagged.' },
      { id: `adc${s}.pitot`, name: `Pitot ${s} blocked`, category: c, description: 'Pitot probe blocked (drain per installation).' },
      { id: `adc${s}.static`, name: `Static port ${s} blocked`, category: c, description: 'Static port blocked: altimeter freezes, VSI zero.' },
      { id: `adc${s}.aoa`, name: `AoA vane ${s} jammed`, category: c, description: 'AoA vane stuck at its current angle.' },
    ];
  }

  reset(): void {
    this.ps = NaN;
    this.pt = NaN;
    this.vsFilter.reset();
    this.iasRate.reset();
    this.testTimer = this.selfTestS;
    this.wasPowered = this.power();
    this.aoa = this.vars.get(FDM.aoa);
  }

  update(dt: number): void {
    const v = this.vars;
    const powered = this.power() && v.get(this.fAdc) === 0;
    v.set(this.o.powered, powered ? 1 : 0);
    if (powered && !this.wasPowered) this.testTimer = this.digital ? this.selfTestS : 0;
    this.wasPowered = powered;

    // ---- true pressures at the ports
    const casKt = v.get(FDM.cas);
    let psTrue = v.get(FDM.staticPressPa);
    if (!(psTrue > 0)) psTrue = 101325;
    let err = sched(this.staticErr, casKt);
    const altOn = this.altStaticOn !== null && this.altStaticOn();
    if (altOn) err += sched(this.altStaticErr, casKt);
    v.set(this.o.altStatic, altOn ? 1 : 0);
    const psPort = psTrue + err;
    const qcTrue = impactPressureFromCas(Math.max(0, casKt) * KT_TO_MS);
    const ptPort = psTrue + qcTrue;

    // ---- blockages (pneumatics work without electrical power)
    const bP = Math.max(v.get(this.iPitotIce), v.get(this.fPitot) !== 0 ? 1 : 0);
    // The alternate static source bypasses the (iced/blocked) external ports.
    const bS = altOn ? 0 : Math.max(v.get(this.iStaticIce), v.get(this.fStatic) !== 0 ? 1 : 0);
    v.set(this.o.pitotBlk, bP >= BLOCKED ? 1 : 0);
    v.set(this.o.staticBlk, bS >= BLOCKED ? 1 : 0);
    if (Number.isNaN(this.ps)) {
      this.ps = psPort;
      this.pt = ptPort;
    }
    if (bS < BLOCKED) this.ps = lag(this.ps, psPort, this.staticTau / sq(1 - bS), dt);
    if (bP < BLOCKED) this.pt = lag(this.pt, ptPort, this.pitotTau / sq(1 - bP), dt);
    else if (this.drainOpen) this.pt = lag(this.pt, this.ps, 5, dt);

    // ---- derived indications
    const ps = this.ps;
    const qc = Math.max(0, this.pt - ps);
    const casMeas = casFromImpactPressure(qc) * MS_TO_KT;
    const ias = this.iasTable ? interp1(this.iasTable, casMeas) : casMeas;
    const mach = machFromImpactPressure(qc, ps);
    const pAlt = pressureAltitudeFt(ps);
    const std = v.get(this.o.std) !== 0;
    const baro = std ? STD_BARO_INHG : v.get(this.o.baro, STD_BARO_INHG);
    const alt = pAlt - pressureAltitudeFt(baro * INHG_TO_PA);
    const vs = this.vsFilter.update(alt, dt) * 60;
    const tatTrue = v.get(FDM.tat);
    this.tat = lag(this.tat, tatTrue, 1.5, dt); // EST: heated TAT probe ~1.5 s
    const satK = (this.tat + 273.15) / (1 + 0.2 * this.tatRecovery * mach * mach);
    const tas = mach * speedOfSound(satK) * MS_TO_KT;
    if (v.get(this.fAoa) === 0) this.aoa = lag(this.aoa, v.get(FDM.aoa) + this.aoaBias, this.aoaTau, dt);
    const rate = this.iasRate.update(ias, dt);

    if (this.testTimer > 0) this.testTimer = Math.max(0, this.testTimer - dt);
    const valid = powered && this.testTimer <= 0;

    // A digital ADC stops updating when unpowered (displays flag it); pneumatic
    // instruments keep reading the ports.
    if (!this.digital || powered) {
      v.set(this.o.ias, ias);
      v.set(this.o.cas, casMeas);
      v.set(this.o.mach, mach);
      v.set(this.o.alt, alt);
      v.set(this.o.pressAlt, pAlt);
      v.set(this.o.vs, vs);
      v.set(this.o.tas, tas);
      v.set(this.o.tat, this.tat);
      v.set(this.o.sat, satK - 273.15);
      v.set(this.o.aoa, this.aoa);
      v.set(this.o.rate, rate);
      v.set(this.o.trend, rate * this.trendS);
    }
    v.set(this.o.valid, this.digital ? (valid ? 1 : 0) : 1);
  }
}

function sq(x: number): number {
  const y = x < 1e-3 ? 1e-3 : x;
  return y * y;
}

function lag(y: number, u: number, tau: number, dt: number): number {
  if (tau <= 0) return u;
  return y + (u - y) * (1 - Math.exp(-dt / tau));
}
