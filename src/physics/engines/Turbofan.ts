/**
 * Two-spool turbofan model driven by a `TurbofanConfig`.
 *
 * Core: N2 is a first-order spool toward the N2 that corresponds to the
 * FADEC-demanded N1 (`eng{i}.n1_cmd_pct`), with time constants looked up
 * from `spoolUpTau_s` / `spoolDownTau_s` at the current N2. N1 follows N2
 * through a static mapping (idle and max anchor points, convex above idle,
 * quadratic below idle) with a short fan lag.
 *
 * Start: starter spools N2 toward `starterMaxN2_pct`; light-off when fuel is
 * on, igniters fire and N2 >= `lightOffN2_pct`. After light-off N2 follows an
 * S-curve to idle in `startToIdle_s` (longer on hot/high days), ITT peaks at
 * `ittStartPeak_c` then settles to `ittIdle_c`.
 *   - Hot start: fuel+ignition at 50-100% of light-off N2 lights early with an
 *     ITT overshoot proportional to how early; fuel on without ignition
 *     accumulates in the combustor and makes the eventual light-off hotter.
 *   - Hung start: starter released below the self-sustaining N2 -> N2
 *     stagnates and ITT keeps rising.
 *   - Flameout: fuel removed (`fuel_on` = 0) -> combustion stops, spool-down.
 *   - Windmill: unlit N1/N2 settle at `windmill*PerKt` x TAS; relight in the
 *     air when windmill N2 reaches light-off N2 with fuel and ignition.
 * Thrust = maxThrust * thrustVsN1(N1c/n1Max) * thrustLapse(M, Hp) * (1 - 0.25 inletIce),
 * with N1 corrected to ISA at the pressure level (hot day -> less thrust at
 * the same physical N1); reverser splits it into (1 - r) forward and
 * r * reverseEfficiency backward. Fuel flow = TSFC(N1) * (1 + 0.6 M) * sqrt(theta)
 * * thrust, floored at an altitude-scaled idle flow.
 *
 * SCOPE: no compressor stall/surge, no engine fire, no oil consumption; bleed
 * pressure is a simple N2/ambient-pressure schedule for the pneumatic system.
 */
import { clamp, clamp01, interp1, interp2, smoothstep01 } from '../../core/math';
import { Vec3 } from '../../core/linalg';
import type { SimVars } from '../../core/SimVars';
import { ENG, ICE } from '../../core/vars';
import { KGS_TO_PPH, MS_TO_KT, ZERO_C_IN_K } from '../../core/units';
import { isaTemperature } from '../atmosphere';
import type { Table1D, TurbofanConfig } from '../types';
import type { EngineEnv, EngineModel } from './Engine';

/** Fan diameter-loading used to estimate windmill ram drag area. EST: 64-72 kN per m^2 of fan face (CFM56-7B, FJ44). */
const THRUST_PER_FAN_AREA = 70000;
/** Windmilling / unlit fan drag coefficient on fan face area. EST. */
const WINDMILL_CD = 0.25;

export class Turbofan implements EngineModel {
  readonly index: number;
  readonly kind = 'turbofan' as const;
  readonly cfg: TurbofanConfig;
  readonly position = new Vec3();
  readonly axis = new Vec3(1, 0, 0);
  readonly extraMoment = new Vec3();
  readonly angularMomentum = new Vec3();
  readonly propwashDq_Pa = 0;

  // ---- state
  n1 = 0;
  n2 = 0;
  itt_c = 15;
  oilTemp_c = 15;
  oilPress_psi = 0;
  thrust_N = 0;
  fuelFlow_kgs = 0;
  /** Combustion present. */
  lit = false;
  /** Start sequence finished (idle reached since light-off). */
  startComplete = false;
  /** Seconds since light-off (during the start sequence). */
  private startElapsed = 0;
  private startFromN2 = 0;
  /** Hot-start severity 0..2 for the current start. */
  hotStartSeverity = 0;
  /** Seconds of unlit fuel flow into the combustor (torching risk). */
  private unlitFuel_s = 0;
  /** Seconds the start has been hung. */
  hungTime_s = 0;

  // ---- var names (precomputed; no string building on the hot path)
  private readonly vN1Cmd: string;
  private readonly vFuelOn: string;
  private readonly vStarter: string;
  private readonly vIgn: string;
  private readonly vBleed: string;
  private readonly vRev: string;
  private readonly vAntiIce: string;
  private readonly vInletIce: string;
  private readonly oRunning: string;
  private readonly oN1: string;
  private readonly oN2: string;
  private readonly oItt: string;
  private readonly oFf: string;
  private readonly oOilP: string;
  private readonly oOilT: string;
  private readonly oThrust: string;
  private readonly oVib1: string;
  private readonly oVib2: string;
  private readonly oAcc: string;
  private readonly oBleedP: string;

  private readonly vars: SimVars;
  private readonly starterTau: number;
  private readonly selfSustainN2: number;
  private readonly ittLimitStart: number;
  private readonly n1Exp: number;
  private readonly fanArea_m2: number;
  private readonly invThrust: Table1D;

  constructor(cfg: TurbofanConfig, index: number, vars: SimVars) {
    this.cfg = cfg;
    this.index = index;
    this.vars = vars;
    this.position.setArray(cfg.position_m);
    this.axis.setArray(cfg.thrustAxis).normalize();
    this.starterTau = cfg.starterTau_s ?? 4;
    this.selfSustainN2 = cfg.selfSustainN2_pct ?? 0.75 * cfg.n2Idle_pct;
    this.ittLimitStart = cfg.ittStartLimit_c ?? cfg.ittStartPeak_c + 150;
    this.n1Exp = cfg.n1MapExponent ?? 1.3;
    this.fanArea_m2 = cfg.maxThrust_N / THRUST_PER_FAN_AREA;
    // Inverse of thrustVsN1 (monotonic) for n1ForThrust().
    this.invThrust = { x: [...cfg.thrustVsN1.y], y: [...cfg.thrustVsN1.x] };
    for (let i = 1; i < this.invThrust.x.length; i++) {
      if (!(this.invThrust.x[i] > this.invThrust.x[i - 1])) this.invThrust.x[i] = this.invThrust.x[i - 1] + 1e-9;
    }
    this.vN1Cmd = ENG.n1Cmd(index);
    this.vFuelOn = ENG.fuelOn(index);
    this.vStarter = ENG.starter(index);
    this.vIgn = ENG.ignition(index);
    this.vBleed = ENG.bleedExtract(index);
    this.vRev = ENG.reverserPos(index);
    this.vAntiIce = ENG.antiIce(index);
    this.vInletIce = ICE.inlet(index);
    this.oRunning = ENG.running(index);
    this.oN1 = ENG.n1(index);
    this.oN2 = ENG.n2(index);
    this.oItt = ENG.itt(index);
    this.oFf = ENG.fuelFlowPph(index);
    this.oOilP = ENG.oilPressPsi(index);
    this.oOilT = ENG.oilTempC(index);
    this.oThrust = ENG.thrustN(index);
    this.oVib1 = ENG.vibN1(index);
    this.oVib2 = ENG.vibN2(index);
    this.oAcc = ENG.accessoryDrive(index);
    this.oBleedP = ENG.bleedPressPsi(index);
  }

  get running(): boolean {
    return this.lit && this.startComplete;
  }

  // ------------------------------------------------------------ static maps

  /** Steady-state N1 (%) for a core speed N2 (%). */
  n1FromN2(n2: number): number {
    const c = this.cfg;
    if (n2 >= c.n2Idle_pct) {
      const fr = (n2 - c.n2Idle_pct) / (c.n2Max_pct - c.n2Idle_pct);
      return c.n1Idle_pct + (c.n1Max_pct - c.n1Idle_pct) * Math.pow(Math.max(0, fr), this.n1Exp);
    }
    const r = Math.max(0, n2) / c.n2Idle_pct;
    return c.n1Idle_pct * Math.pow(r, 2.2);
  }

  /** Core speed N2 (%) that yields N1 (%) in steady state (inverse of n1FromN2). */
  n2FromN1(n1: number): number {
    const c = this.cfg;
    if (n1 >= c.n1Idle_pct) {
      const fr = Math.pow(Math.max(0, (n1 - c.n1Idle_pct) / (c.n1Max_pct - c.n1Idle_pct)), 1 / this.n1Exp);
      return c.n2Idle_pct + fr * (c.n2Max_pct - c.n2Idle_pct);
    }
    return c.n2Idle_pct * Math.pow(Math.max(0, n1) / c.n1Idle_pct, 1 / 2.2);
  }

  /** ISA-relative temperature ratio at the pressure level (hot day > 1). */
  private thetaDev(env: EngineEnv): number {
    const tStd = isaTemperature(env.pressureAltitude_ft * 0.3048);
    return env.temperature_K / tStd;
  }

  /** Steady forward (gross) thrust (N) at physical N1 (%) in the given conditions. */
  grossThrust(n1: number, env: EngineEnv, inletIce = 0): number {
    const c = this.cfg;
    const n1c = n1 / Math.sqrt(this.thetaDev(env));
    const frac = interp1(c.thrustVsN1, n1c / c.n1Max_pct);
    const lapse = interp2(c.thrustLapse, env.mach, env.pressureAltitude_ft);
    return c.maxThrust_N * Math.max(0, frac) * lapse * (1 - 0.25 * clamp01(inletIce));
  }

  /** Physical N1 (%) that produces `thrustN` of gross thrust (clamped to the table range). */
  n1ForThrust(thrustN: number, env: EngineEnv, inletIce = 0): number {
    const c = this.cfg;
    const lapse = interp2(c.thrustLapse, env.mach, env.pressureAltitude_ft);
    const denom = c.maxThrust_N * lapse * (1 - 0.25 * clamp01(inletIce));
    const frac = denom > 0 ? thrustN / denom : 0;
    const n1cFrac = interp1(this.invThrust, frac);
    return n1cFrac * c.n1Max_pct * Math.sqrt(this.thetaDev(env));
  }

  /**
   * Steady running ITT (degC): idle..max schedule on N1 corrected to inlet
   * total temperature, scaled by the inlet temperature ratio (ITT in K is
   * proportional to T_inlet at constant corrected speed), plus bleed,
   * nacelle anti-ice and inlet-ice penalties (EST: +30, +20, +40 degC).
   */
  runningItt(n1: number, env: EngineEnv, bleed: number, antiIce: boolean, inletIce: number): number {
    const c = this.cfg;
    const thetaT = (env.temperature_K * (1 + 0.2 * env.mach * env.mach)) / 288.15;
    const n1c = n1 / Math.sqrt(thetaT);
    const x = clamp((n1c - c.n1Idle_pct) / (c.n1Max_pct - c.n1Idle_pct), -0.5, 1.2);
    const ittStd = c.ittIdle_c + (c.ittMax_c - c.ittIdle_c) * Math.sign(x) * Math.pow(Math.abs(x), 1.2);
    return (ittStd + ZERO_C_IN_K) * thetaT - ZERO_C_IN_K + 30 * bleed + (antiIce ? 20 : 0) + 40 * inletIce;
  }

  // ------------------------------------------------------------ dynamics

  step(dt: number, env: EngineEnv): void {
    const c = this.cfg;
    const v = this.vars;
    const fuelOn = v.getBool(this.vFuelOn);
    const starter = v.getBool(this.vStarter);
    const ignition = v.getBool(this.vIgn);
    const n1Cmd = v.get(this.vN1Cmd);
    const bleed = clamp01(v.get(this.vBleed));
    const rev = clamp01(v.get(this.vRev));
    const antiIce = v.getBool(this.vAntiIce);
    const inletIce = clamp01(v.get(this.vInletIce));
    const oat = env.temperature_K - ZERO_C_IN_K;
    const tasKt = env.tas_ms * MS_TO_KT;
    const windN2 = c.windmillN2PerKt * tasKt;
    const windN1 = c.windmillN1PerKt * tasKt;
    const delta = env.pressure_Pa / 101325;
    const thetaAmb = env.temperature_K / 288.15;

    // ---- combustion state transitions
    if (this.lit && !fuelOn) {
      // Flameout / shutdown: fuel removed.
      this.lit = false;
      this.startComplete = false;
      this.hungTime_s = 0;
    }
    if (!this.lit) {
      const unlitFlow = fuelOn && this.n2 > 5;
      if (unlitFlow && !ignition) this.unlitFuel_s += dt;
      else if (!fuelOn) this.unlitFuel_s = Math.max(0, this.unlitFuel_s - dt * 0.2); // drains/evaporates
      if (fuelOn && ignition && this.n2 >= 0.5 * c.lightOffN2_pct) {
        this.lit = true;
        this.startComplete = this.n2 >= 0.98 * c.n2Idle_pct;
        this.startElapsed = 0;
        this.startFromN2 = this.n2;
        this.hungTime_s = 0;
        const early = clamp01((c.lightOffN2_pct - this.n2) / (0.5 * c.lightOffN2_pct));
        this.hotStartSeverity = clamp(early + this.unlitFuel_s / 10, 0, 2);
        this.unlitFuel_s = 0;
      }
    }

    // ---- core speed
    let n2 = this.n2;
    let ittTarget: number;
    let ittTau = 3;
    let ff_kgs = 0;
    if (this.lit && !this.startComplete) {
      // Start sequence after light-off.
      const hotFactor = 1 + 0.3 * Math.max(0, (env.temperature_K - 288.15) / 30) + 0.5 * (1 - Math.min(1, delta));
      // Ram air keeps a windmilling core turning like a starter would (air start),
      // but the acceleration is slower. EST: windmill starts take ~1.5x as long.
      const windAssist = windN2 >= c.lightOffN2_pct;
      const dur = c.startToIdle_s * hotFactor * (!starter && windAssist ? 1.5 : 1);
      const hung = !starter && !windAssist && n2 < this.selfSustainN2;
      if (hung) {
        this.hungTime_s += dt;
        // No acceleration without the starter below self-sustaining speed: slow decay.
        n2 -= 0.005 * n2 * dt;
      } else {
        this.hungTime_s = 0;
        this.startElapsed += dt;
        const sched = this.startFromN2 + (c.n2Idle_pct - this.startFromN2) * smoothstep01(this.startElapsed / dur);
        if (sched > n2) n2 = sched;
      }
      if (n2 >= 0.98 * c.n2Idle_pct || this.startElapsed >= dur) {
        this.startComplete = true;
        n2 = Math.max(n2, 0.98 * c.n2Idle_pct);
      }
      const tp = 0.3 * dur;
      const tt = this.startElapsed / tp;
      const shape = tt * Math.exp(1 - tt);
      const peak = c.ittStartPeak_c + this.hotStartSeverity * (this.ittLimitStart - c.ittStartPeak_c + 100);
      ittTarget = c.ittIdle_c + (peak - c.ittIdle_c) * shape + 150 * clamp01(this.hungTime_s / 20);
      ittTau = 1.0;
      const progress = clamp01((n2 - this.startFromN2) / Math.max(1, c.n2Idle_pct - this.startFromN2));
      ff_kgs = (c.idleFuelFlow_pph / KGS_TO_PPH) * (0.4 + 0.6 * progress) * (1 + 0.3 * this.hotStartSeverity);
    } else if (this.lit) {
      // Normal running: first-order toward the commanded core speed.
      const n1Target = Math.max(c.n1Idle_pct, n1Cmd);
      const n2Target = clamp(this.n2FromN1(n1Target), c.n2Idle_pct, c.n2Max_pct * 1.03);
      const tau = Math.max(0.05, interp1(n2Target >= n2 ? c.spoolUpTau_s : c.spoolDownTau_s, n2));
      n2 += (n2Target - n2) * (1 - Math.exp(-dt / tau));
      ittTarget = 0; // computed below from N1
    } else {
      // Unlit: starter motoring, windmilling or spooling down.
      const target = Math.max(windN2, starter ? c.starterMaxN2_pct : 0);
      if (target > n2) {
        const tau = starter ? this.starterTau : 6;
        n2 += (target - n2) * (1 - Math.exp(-dt / tau));
      } else {
        const tau = Math.max(1, interp1(c.spoolDownTau_s, n2) * 6);
        n2 += (target - n2) * (1 - Math.exp(-dt / tau));
      }
      ittTarget = oat;
      ittTau = 25;
      if (fuelOn && n2 > 5) ff_kgs = 0.3 * (c.idleFuelFlow_pph / KGS_TO_PPH);
    }
    if (n2 < 0) n2 = 0;
    this.n2 = n2;

    // ---- fan
    let n1Ss = this.n1FromN2(n2);
    if (!this.lit) n1Ss = Math.max(n1Ss, windN1);
    this.n1 += (n1Ss - this.n1) * (1 - Math.exp(-dt / 0.5));
    const n1 = this.n1;

    // ---- thrust
    let gross = 0;
    if (this.lit) {
      gross = this.grossThrust(n1, env, inletIce);
      this.thrust_N = gross * (1 - rev) - gross * rev * c.reverseEfficiency;
    } else {
      // Unlit fan: ram (windmill) drag.
      this.thrust_N = -WINDMILL_CD * env.qbar_Pa * this.fanArea_m2;
    }

    // ---- fuel flow and ITT when running
    if (this.lit && this.startComplete) {
      const nfrac = n1 / c.n1Max_pct;
      const tsfc = interp1(c.tsfc, nfrac) * (1 + (c.tsfcMachFactor ?? 0.6) * env.mach) * Math.sqrt(thetaAmb); // kg/(N h)
      const idleFloor = (c.idleFuelFlow_pph / KGS_TO_PPH) * (0.35 + 0.65 * Math.min(1, delta));
      ff_kgs = Math.max(idleFloor, (tsfc * gross) / 3600);
      ittTarget = this.runningItt(n1, env, bleed, antiIce, inletIce);
      ittTau = 2.5;
    }
    this.fuelFlow_kgs = ff_kgs;
    this.itt_c += (ittTarget - this.itt_c) * (1 - Math.exp(-dt / ittTau));

    // ---- oil
    const n2i = c.n2Idle_pct;
    let pOil: number;
    if (n2 <= n2i) pOil = c.oilPressIdle_psi * (n2 / n2i) * (n2 / n2i);
    else pOil = c.oilPressIdle_psi + (c.oilPressMax_psi - c.oilPressIdle_psi) * clamp01((n2 - n2i) / (c.n2Max_pct - n2i));
    const coldFactor = 1 + 0.3 * clamp01((c.oilTempNormal_c - this.oilTemp_c) / 60);
    this.oilPress_psi = pOil * coldFactor;
    const oilTarget = this.lit
      ? oat + (c.oilTempNormal_c - oat) * (0.6 + 0.4 * clamp01((n2 - n2i) / (c.n2Max_pct - n2i)))
      : oat;
    const oilTau = this.lit ? 150 : 1200;
    this.oilTemp_c += (oilTarget - this.oilTemp_c) * (1 - Math.exp(-dt / oilTau));

    this.publish(n1, n2, inletIce, delta);
  }

  private publish(n1: number, n2: number, inletIce: number, delta: number): void {
    const c = this.cfg;
    const v = this.vars;
    v.set(this.oRunning, this.running ? 1 : 0);
    v.set(this.oN1, n1);
    v.set(this.oN2, n2);
    v.set(this.oItt, this.itt_c);
    v.set(this.oFf, this.fuelFlow_kgs * KGS_TO_PPH);
    v.set(this.oOilP, this.oilPress_psi);
    v.set(this.oOilT, this.oilTemp_c);
    v.set(this.oThrust, this.thrust_N);
    const spin1 = clamp01(n1 / 10);
    const spin2 = clamp01(n2 / 10);
    v.set(this.oVib1, spin1 * (0.4 + 0.3 * (n1 / 100) + 3.0 * inletIce));
    v.set(this.oVib2, spin2 * (0.3 + 0.3 * (n2 / 100) + 1.0 * inletIce));
    v.set(this.oAcc, n2 / 100);
    const b = clamp01((n2 - 0.4 * c.n2Idle_pct) / (c.n2Max_pct - 0.4 * c.n2Idle_pct));
    v.set(this.oBleedP, c.bleedPressMax_psi * Math.pow(b, 1.5) * (0.35 + 0.65 * Math.min(1, delta)));
  }

  setRunning(running: boolean, env: EngineEnv): void {
    const c = this.cfg;
    const oat = env.temperature_K - ZERO_C_IN_K;
    this.unlitFuel_s = 0;
    this.hungTime_s = 0;
    this.hotStartSeverity = 0;
    if (running) {
      this.lit = true;
      this.startComplete = true;
      const v = this.vars;
      const n1Target = Math.max(c.n1Idle_pct, v.get(this.vN1Cmd));
      this.n2 = clamp(this.n2FromN1(n1Target), c.n2Idle_pct, c.n2Max_pct * 1.03);
      this.n1 = this.n1FromN2(this.n2);
      this.oilTemp_c = oat + (c.oilTempNormal_c - oat) * (0.6 + 0.4 * clamp01((this.n2 - c.n2Idle_pct) / (c.n2Max_pct - c.n2Idle_pct)));
      this.itt_c = this.runningItt(this.n1, env, clamp01(v.get(this.vBleed)), v.getBool(this.vAntiIce), clamp01(v.get(this.vInletIce)));
      // Publishes outputs (a zero-length step). If fuel_on is 0 the engine flames out here, as it should.
      this.step(1e-9, env);
    } else {
      this.lit = false;
      this.startComplete = false;
      const tasKt = env.tas_ms * MS_TO_KT;
      this.n2 = c.windmillN2PerKt * tasKt;
      this.n1 = c.windmillN1PerKt * tasKt;
      this.itt_c = oat;
      this.oilTemp_c = oat;
      this.step(1e-6, env);
    }
  }
}
