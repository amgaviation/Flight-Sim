import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { ENG, ICE } from '../../src/core/vars';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { createEngineEnv, type EngineEnv } from '../../src/physics/engines/Engine';
import { TEST_JET } from '../../src/physics/testAircraft';
import type { TurbofanConfig } from '../../src/physics/types';
import { Atmosphere, createAirState } from '../../src/physics/atmosphere';
import { FT_TO_M, KT_TO_MS } from '../../src/core/units';

const CFG = TEST_JET.engines[0] as TurbofanConfig;

function setup(altFt = 0, tasKt = 0, oatDevC = 0) {
  const vars = new SimVars();
  const eng = new Turbofan(CFG, 1, vars);
  const env = createEngineEnv();
  const atm = new Atmosphere(29.92126, 15 + oatDevC);
  const air = atm.sample(altFt * FT_TO_M, createAirState());
  env.pressure_Pa = air.pressure_Pa;
  env.temperature_K = air.temperature_K;
  env.density_kgm3 = air.density_kgm3;
  env.speedOfSound_ms = air.speedOfSound_ms;
  env.pressureAltitude_ft = (air.pressureAltitude_m / FT_TO_M);
  env.isaDeviation_K = air.isaDeviation_K;
  env.tas_ms = tasKt * KT_TO_MS;
  env.axialSpeed_ms = env.tas_ms;
  env.mach = env.tas_ms / air.speedOfSound_ms;
  env.qbar_Pa = 0.5 * air.density_kgm3 * env.tas_ms ** 2;
  return { vars, eng, env };
}

function run(eng: Turbofan, env: EngineEnv, s: number, each?: (t: number) => void): void {
  for (let i = 0; i < Math.round(s * 120); i++) {
    eng.step(1 / 120, env);
    each?.(i / 120);
  }
}

describe('Turbofan', () => {
  it('normal start: starter -> light-off at lightOffN2 -> idle in startToIdle_s; ITT peaks then settles', () => {
    const { vars, eng, env } = setup();
    vars.set(ENG.starter(1), 1);
    vars.set(ENG.ignition(1), 1);
    let lightOff = -1;
    let idleAt = -1;
    let ittPeak = 0;
    let t = 0;
    for (let i = 0; i < 120 * 90; i++) {
      // FADEC-like logic: fuel at light-off N2, starter cut-out at 50% N2.
      if (eng.n2 >= CFG.lightOffN2_pct) vars.set(ENG.fuelOn(1), 1);
      if (eng.n2 >= 50) {
        vars.set(ENG.starter(1), 0);
        vars.set(ENG.ignition(1), 0);
      }
      eng.step(1 / 120, env);
      t = i / 120;
      if (lightOff < 0 && eng.lit) lightOff = t;
      if (idleAt < 0 && eng.running) idleAt = t;
      ittPeak = Math.max(ittPeak, eng.itt_c);
    }
    expect(lightOff).toBeGreaterThan(0);
    const startTime = idleAt - lightOff;
    expect(startTime).toBeGreaterThan(CFG.startToIdle_s * 0.85);
    expect(startTime).toBeLessThan(CFG.startToIdle_s * 1.15);
    expect(eng.n2).toBeCloseTo(CFG.n2Idle_pct, 0);
    expect(eng.n1).toBeCloseTo(CFG.n1Idle_pct, 0);
    expect(ittPeak).toBeGreaterThan(CFG.ittStartPeak_c - 60);
    expect(ittPeak).toBeLessThan(CFG.ittStartPeak_c + 60);
    expect(eng.itt_c).toBeCloseTo(CFG.ittIdle_c, -1);
    expect(vars.get(ENG.running(1))).toBe(1);
    expect(vars.get(ENG.fuelFlowPph(1))).toBeCloseTo(CFG.idleFuelFlow_pph, -1);
    expect(vars.get(ENG.oilPressPsi(1))).toBeGreaterThan(CFG.oilPressIdle_psi * 0.9);
    expect(vars.get(ENG.accessoryDrive(1))).toBeCloseTo(CFG.n2Idle_pct / 100, 2);
  });

  it('flames out when fuel is cut and spools down', () => {
    const { vars, eng, env } = setup();
    vars.set(ENG.fuelOn(1), 1);
    eng.setRunning(true, env);
    expect(eng.running).toBe(true);
    vars.set(ENG.fuelOn(1), 0);
    run(eng, env, 1 / 60);
    expect(eng.lit).toBe(false);
    expect(vars.get(ENG.running(1))).toBe(0);
    expect(vars.get(ENG.fuelFlowPph(1))).toBe(0);
    run(eng, env, 60);
    expect(eng.n2).toBeLessThan(10);
    expect(eng.itt_c).toBeLessThan(CFG.ittIdle_c - 150);
  });

  it('hot start when fuel+ignition come early at low N2; hung start when starter drops out', () => {
    const hot = setup();
    hot.vars.set(ENG.starter(1), 1);
    hot.vars.set(ENG.ignition(1), 1);
    hot.vars.set(ENG.fuelOn(1), 1); // fuel before rotation
    let peak = 0;
    run(hot.eng, hot.env, 40, () => (peak = Math.max(peak, hot.eng.itt_c)));
    expect(hot.eng.hotStartSeverity).toBeGreaterThan(0.2);
    expect(peak).toBeGreaterThan(CFG.ittStartPeak_c + 60);

    const hung = setup();
    hung.vars.set(ENG.starter(1), 1);
    hung.vars.set(ENG.ignition(1), 1);
    run(hung.eng, hung.env, 30, () => {
      if (hung.eng.n2 >= CFG.lightOffN2_pct) hung.vars.set(ENG.fuelOn(1), 1);
      if (hung.eng.n2 >= 25) hung.vars.set(ENG.starter(1), 0); // starter released too early
    });
    expect(hung.eng.running).toBe(false);
    expect(hung.eng.n2).toBeLessThan(0.75 * CFG.n2Idle_pct);
    expect(hung.eng.hungTime_s).toBeGreaterThan(5);
  });

  it('accelerates to takeoff thrust within a few seconds; thrust ~ max at SLS', () => {
    const { vars, eng, env } = setup();
    vars.set(ENG.fuelOn(1), 1);
    eng.setRunning(true, env);
    vars.set(ENG.n1Cmd(1), 100);
    let t95 = -1;
    run(eng, env, 15, (t) => {
      if (t95 < 0 && eng.thrust_N > 0.95 * CFG.maxThrust_N) t95 = t;
    });
    expect(t95).toBeGreaterThan(1);
    expect(t95).toBeLessThan(8);
    expect(eng.thrust_N).toBeGreaterThan(0.97 * CFG.maxThrust_N);
    expect(eng.thrust_N).toBeLessThan(1.03 * CFG.maxThrust_N);
    expect(eng.itt_c).toBeCloseTo(CFG.ittMax_c, -1);
  });

  it('thrust lapses with altitude and Mach; hot day reduces thrust at the same N1', () => {
    const sl = setup(0, 0);
    const fl = setup(35000, 450);
    const hot = setup(0, 0, 25);
    for (const s of [sl, fl, hot]) {
      s.vars.set(ENG.fuelOn(1), 1);
      s.vars.set(ENG.n1Cmd(1), 95);
      s.eng.setRunning(true, s.env);
      run(s.eng, s.env, 5);
    }
    expect(fl.eng.thrust_N / sl.eng.thrust_N).toBeGreaterThan(0.15);
    expect(fl.eng.thrust_N / sl.eng.thrust_N).toBeLessThan(0.35);
    expect(hot.eng.thrust_N).toBeLessThan(sl.eng.thrust_N * 0.97);
    // Cruise fuel flow is well below takeoff but above the idle floor.
    expect(fl.vars.get(ENG.fuelFlowPph(1))).toBeLessThan(sl.vars.get(ENG.fuelFlowPph(1)));
  });

  it('n1ForThrust inverts the steady thrust map', () => {
    const { eng, env } = setup(10000, 250);
    for (const T of [2000, 5000, 9000]) {
      const n1 = eng.n1ForThrust(T, env);
      expect(eng.grossThrust(n1, env)).toBeCloseTo(T, -1);
    }
  });

  it('reverser produces reverse thrust; inlet ice reduces thrust and raises vibration', () => {
    const { vars, eng, env } = setup();
    vars.set(ENG.fuelOn(1), 1);
    vars.set(ENG.n1Cmd(1), 80);
    eng.setRunning(true, env);
    run(eng, env, 3);
    const fwd = eng.thrust_N;
    const vib0 = vars.get(ENG.vibN1(1));
    vars.set(ENG.reverserPos(1), 1);
    run(eng, env, 0.1);
    expect(eng.thrust_N).toBeLessThan(0);
    expect(-eng.thrust_N).toBeCloseTo(fwd * CFG.reverseEfficiency, -2);
    vars.set(ENG.reverserPos(1), 0);
    vars.set(ICE.inlet(1), 1);
    run(eng, env, 1);
    expect(eng.thrust_N).toBeLessThan(0.8 * fwd);
    expect(vars.get(ENG.vibN1(1))).toBeGreaterThan(vib0 + 2);
  });

  it('windmills in flight when shut down and relights with fuel + ignition', () => {
    const { vars, eng, env } = setup(15000, 280);
    run(eng, env, 30);
    expect(eng.n2).toBeGreaterThan(8);
    expect(eng.n1).toBeGreaterThan(15);
    expect(eng.thrust_N).toBeLessThan(0); // windmill drag
    vars.set(ENG.fuelOn(1), 1);
    vars.set(ENG.ignition(1), 1);
    run(eng, env, 60);
    expect(eng.running).toBe(true);
  });
});
