import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { ENG } from '../../src/core/vars';
import { Piston } from '../../src/physics/engines/Piston';
import { createEngineEnv, type EngineEnv } from '../../src/physics/engines/Engine';
import { TEST_PISTON, TEST_PISTON_ENGINE } from '../../src/physics/testPiston';
import { Atmosphere, createAirState } from '../../src/physics/atmosphere';
import { FT_TO_M, KT_TO_MS } from '../../src/core/units';

/**
 * Validation against the Cessna 172S POH (172SPHUS Rev 4):
 *  - Section 4 "Warm up": engine idles at approximately 600 RPM.
 *  - Section 4 "Magneto check" at 1800 RPM: drop should not exceed 150 RPM on
 *    either magneto or 50 RPM differential between magnetos.
 *  - Section 4 "Takeoff power check": full-throttle static run-up turns
 *    approximately 2300-2400 RPM with the mixture leaned for maximum RPM.
 *  - Section 5 Figure 5-8 cruise performance, 2550 lb, recommended lean
 *    (50 degF rich of peak EGT, Section 4 Figure 4-4), standard temperature:
 *      6000 ft, 2400 RPM: 57% BHP, 108 KTAS, 8.2 GPH
 *      8000 ft, 2700 RPM: 77% BHP, 124 KTAS, 10.4 GPH
 *  - Section 2 Figure 2-3: vacuum gage green arc 4.5-5.5 in.Hg.
 */

function setup(altFt = 0, tasKt = 0) {
  const vars = new SimVars();
  const eng = new Piston(TEST_PISTON_ENGINE, 1, vars, TEST_PISTON.aero.wingArea_m2, TEST_PISTON.aero.span_m);
  const env = createEngineEnv();
  const atm = new Atmosphere();
  const air = atm.sample(altFt * FT_TO_M, createAirState());
  env.pressure_Pa = air.pressure_Pa;
  env.temperature_K = air.temperature_K;
  env.density_kgm3 = air.density_kgm3;
  env.speedOfSound_ms = air.speedOfSound_ms;
  env.pressureAltitude_ft = altFt;
  env.tas_ms = tasKt * KT_TO_MS;
  env.axialSpeed_ms = env.tas_ms;
  env.qbar_Pa = 0.5 * air.density_kgm3 * env.tas_ms * env.tas_ms;
  env.mach = env.tas_ms / air.speedOfSound_ms;
  env.onGround = tasKt === 0;
  vars.set(ENG.fuelOn(1), 1);
  vars.set(ENG.magLeft(1), 1);
  vars.set(ENG.magRight(1), 1);
  vars.set(ENG.mixture(1), 1);
  vars.set(ENG.throttle(1), 0);
  return { vars, eng, env };
}

function run(eng: Piston, env: EngineEnv, seconds: number): void {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) eng.step(1 / 120, env);
}

/** Throttle setting that holds `rpm` (bisection on steady-state rpm). */
function setRpm(eng: Piston, env: EngineEnv, vars: SimVars, rpm: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 18; k++) {
    const mid = 0.5 * (lo + hi);
    vars.set(ENG.throttle(1), mid);
    run(eng, env, 4);
    if (eng.rpm < rpm) lo = mid;
    else hi = mid;
  }
  vars.set(ENG.throttle(1), 0.5 * (lo + hi));
  run(eng, env, 8);
  return 0.5 * (lo + hi);
}

describe('Piston engine vs Cessna 172S POH', () => {
  it('starts: prime, crank, fire, then runs on mixture RICH; idles ~600-700 rpm', () => {
    const { vars, eng, env } = setup();
    // POH Starting Engine: throttle open 1/4 inch, aux pump on + mixture rich 3-5 s to prime, mixture idle cutoff, crank.
    vars.set(ENG.throttle(1), 0.06);
    vars.set(ENG.mixture(1), 1);
    run(eng, env, 4); // priming (fuel pressure available, engine stopped)
    expect(eng.wet).toBeGreaterThan(0.6);
    vars.set(ENG.mixture(1), 0);
    vars.set(ENG.starter(1), 1);
    let firedAt = -1;
    for (let i = 0; i < 120 * 6; i++) {
      eng.step(1 / 120, env);
      if (firedAt < 0 && eng.rpm > 450) firedAt = i / 120;
    }
    expect(firedAt).toBeGreaterThan(0);
    vars.set(ENG.starter(1), 0);
    vars.set(ENG.mixture(1), 1); // "when engine starts, advance mixture smoothly to RICH"
    run(eng, env, 20);
    expect(eng.running).toBe(true);
    vars.set(ENG.throttle(1), 0);
    run(eng, env, 15);
    expect(eng.rpm).toBeGreaterThan(600);
    expect(eng.rpm).toBeLessThan(700);
    expect(vars.get(ENG.mapInHg(1))).toBeGreaterThan(7);
    expect(vars.get(ENG.mapInHg(1))).toBeLessThan(14);
  });

  it('dies without a prime (mixture idle cutoff, no fuel film) and floods when over-primed', () => {
    const a = setup();
    a.vars.set(ENG.mixture(1), 0);
    a.vars.set(ENG.starter(1), 1);
    run(a.eng, a.env, 6);
    expect(a.eng.running).toBe(false);

    const b = setup();
    b.vars.set(ENG.throttle(1), 0.06);
    b.vars.set(ENG.mixture(1), 1);
    run(b.eng, b.env, 16); // aux pump on with mixture rich for 16 s -> flooded
    expect(b.eng.wet).toBeGreaterThan(2.5);
    b.vars.set(ENG.mixture(1), 0);
    b.vars.set(ENG.starter(1), 1);
    run(b.eng, b.env, 2);
    expect(b.eng.firing).toBe(false); // too rich to fire
    // Flooded start: throttle full open, crank to clear.
    b.vars.set(ENG.throttle(1), 1);
    let fired = false;
    for (let i = 0; i < 120 * 30 && !fired; i++) {
      b.eng.step(1 / 120, b.env);
      fired = b.eng.firing;
    }
    expect(fired).toBe(true);
  });

  it('full-throttle static rpm is within the POH 2300-2400 band', () => {
    const { vars, eng, env } = setup();
    eng.setRunning(true, env);
    vars.set(ENG.throttle(1), 1);
    run(eng, env, 15);
    // Lean for maximum RPM (POH): sweep mixture.
    let best = 0;
    for (let m = 1; m >= 0.55; m -= 0.025) {
      vars.set(ENG.mixture(1), m);
      run(eng, env, 3);
      best = Math.max(best, eng.rpm);
    }
    expect(best).toBeGreaterThan(2290);
    expect(best).toBeLessThan(2420);
    vars.set(ENG.mixture(1), 1);
    run(eng, env, 10);
    expect(eng.rpm).toBeGreaterThan(2270);
    expect(eng.rpm).toBeLessThan(2420);
    expect(vars.get(ENG.mapInHg(1))).toBeGreaterThan(28.5);
  });

  it('magneto check at 1800 rpm: single-mag drop 50-150 rpm, differential <= 50', () => {
    const { vars, eng, env } = setup();
    eng.setRunning(true, env);
    setRpm(eng, env, vars, 1800);
    const both = eng.rpm;
    expect(Math.abs(both - 1800)).toBeLessThan(10);
    vars.set(ENG.magRight(1), 0);
    run(eng, env, 6);
    const left = eng.rpm;
    vars.set(ENG.magRight(1), 1);
    run(eng, env, 6);
    vars.set(ENG.magLeft(1), 0);
    run(eng, env, 6);
    const right = eng.rpm;
    const dropL = both - left;
    const dropR = both - right;
    expect(dropL).toBeGreaterThan(50);
    expect(dropL).toBeLessThan(150);
    expect(dropR).toBeGreaterThan(50);
    expect(dropR).toBeLessThan(150);
    expect(Math.abs(dropL - dropR)).toBeLessThanOrEqual(50);
    // Both off: engine dies.
    vars.set(ENG.magRight(1), 0);
    run(eng, env, 10);
    expect(eng.running).toBe(false);
    expect(eng.rpm).toBeLessThan(100);
  });

  it('vacuum 4.5-5.5 inHg above 1000 rpm; idle cut-off stops the engine', () => {
    const { vars, eng, env } = setup();
    eng.setRunning(true, env);
    setRpm(eng, env, vars, 1200);
    const vac = vars.get(ENG.vacuumInHg(1));
    expect(vac).toBeGreaterThanOrEqual(4.5);
    expect(vac).toBeLessThanOrEqual(5.5);
    vars.set(ENG.mixture(1), 0);
    run(eng, env, 12);
    expect(eng.running).toBe(false);
  });

  function cruiseAt(altFt: number, tasKt: number, rpm: number) {
    const { vars, eng, env } = setup(altFt, tasKt);
    eng.setRunning(true, env);
    // POH leaning with EGT: find peak EGT, then enrich to 50 degF rich of peak.
    let mix = 1;
    for (let pass = 0; pass < 2; pass++) {
      setRpm(eng, env, vars, rpm);
      let peak = -Infinity;
      let peakMix = 1;
      for (let m = 1; m >= 0.4; m -= 0.01) {
        vars.set(ENG.mixture(1), m);
        run(eng, env, 0.3);
        eng.egt_K = eng.egt_K; // lagged value is fine for relative search after settling below
      }
      for (let m = 1; m >= 0.4; m -= 0.01) {
        vars.set(ENG.mixture(1), m);
        run(eng, env, 40);
        const egt = vars.get(ENG.egtF(1));
        if (egt > peak) {
          peak = egt;
          peakMix = m;
        } else if (egt < peak - 30) break;
      }
      // Enrich until EGT is 50 F below peak.
      mix = peakMix;
      for (let m = peakMix; m <= 1; m += 0.005) {
        vars.set(ENG.mixture(1), m);
        run(eng, env, 40);
        mix = m;
        if (vars.get(ENG.egtF(1)) <= peak - 50) break;
      }
    }
    setRpm(eng, env, vars, rpm);
    run(eng, env, 40);
    return { hp: vars.get(ENG.powerHp(1)), gph: vars.get(ENG.fuelFlowGph(1)), rpm: eng.rpm, mix };
  }

  it('POH cruise 6000 ft / 2400 RPM / 108 KTAS: 57% BHP, 8.2 GPH (recommended lean)', () => {
    const r = cruiseAt(6000, 108, 2400);
    const pct = (r.hp / 180) * 100;
    expect(pct).toBeGreaterThan(52);
    expect(pct).toBeLessThan(62);
    expect(r.gph).toBeGreaterThan(7.4);
    expect(r.gph).toBeLessThan(9.0);
  }, 60000);

  it('POH cruise 8000 ft / 2700 RPM / 124 KTAS: 77% BHP, 10.4 GPH', () => {
    const r = cruiseAt(8000, 124, 2700);
    const pct = (r.hp / 180) * 100;
    expect(pct).toBeGreaterThan(71);
    expect(pct).toBeLessThan(83);
    expect(r.gph).toBeGreaterThan(9.4);
    expect(r.gph).toBeLessThan(11.4);
  }, 60000);
});
