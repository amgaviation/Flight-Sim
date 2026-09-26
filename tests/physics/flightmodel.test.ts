import { describe, expect, it } from 'vitest';
import { FDM, GEAR, ENG, SURF, ENV, SIM } from '../../src/core/vars';
import { TEST_JET } from '../../src/physics/testAircraft';
import { TEST_PISTON } from '../../src/physics/testPiston';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { magneticDeclination } from '../../src/core/wmm';
import { FlatWorld, SEA_TAC, horizDist, jetEnginesOn, makeFdm, pistonEngineOn, run, setBrakes, setFlaps } from './helpers';
import type { FlightModel } from '../../src/physics/FlightModel';

function onRunway(fdm: FlightModel, heading = 160) {
  fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, onGround: true, headingTrue: heading });
}

describe('FlightModel on the ground', () => {
  it.each([
    ['jet', TEST_JET],
    ['piston', TEST_PISTON],
  ] as const)('(a) %s sits still for 60 s: < 0.05 m drift, < 1 cm vertical oscillation after settle', (_n, cfg) => {
    const { fdm, vars } = makeFdm(cfg);
    onRunway(fdm);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    let minA = Infinity;
    let maxA = -Infinity;
    run(fdm, 60, (t) => {
      if (t > 1) {
        minA = Math.min(minA, fdm.alt);
        maxA = Math.max(maxA, fdm.alt);
      }
    });
    expect(horizDist(p0, fdm)).toBeLessThan(0.05);
    expect(maxA - minA).toBeLessThan(0.01);
    expect(fdm.crashed).toBe(false);
    expect(vars.get(FDM.onGround)).toBe(1);
    for (const i of [0, 1, 2]) {
      expect(vars.get(GEAR.weightOnWheels(i))).toBe(1);
      expect(vars.get(GEAR.compression(i))).toBeGreaterThan(0.1);
      expect(vars.get(GEAR.compression(i))).toBeLessThan(0.9);
    }
    expect(Math.abs(vars.get(FDM.ias))).toBeLessThan(0.5);
    expect(Math.abs(vars.get(FDM.radioAlt))).toBeLessThan(1.5);
    expect(vars.get(FDM.nz)).toBeCloseTo(1, 1);
  });

  it('(b) parking brake holds the jet at idle thrust; released it rolls at taxi power', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    onRunway(fdm);
    setBrakes(vars, 1);
    jetEnginesOn(vars, fdm, 0);
    expect(vars.get(ENG.thrustN(1))).toBeGreaterThan(300);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    run(fdm, 60);
    expect(horizDist(p0, fdm)).toBeLessThan(0.05);
    // Brakes off, taxi power: it must move.
    setBrakes(vars, 0);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), 45);
    run(fdm, 20);
    expect(horizDist(p0, fdm)).toBeGreaterThan(5);
    expect(vars.get(GEAR.wheelSpeedKt(1))).toBeGreaterThan(1);
  });

  it('(b) parking brake holds the 172 at 1700 rpm run-up power', () => {
    const { fdm, vars } = makeFdm(TEST_PISTON);
    onRunway(fdm);
    setBrakes(vars, 1);
    pistonEngineOn(vars, fdm, 0.08);
    run(fdm, 5);
    expect(vars.get(ENG.rpm(1))).toBeGreaterThan(1300);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    run(fdm, 30);
    expect(horizDist(p0, fdm)).toBeLessThan(0.05);
  });

  it('holds position on a 2% slope with brakes; rolls downhill without', () => {
    const world = new FlatWorld(100, 'asphalt', 0.02);
    const { fdm, vars } = makeFdm(TEST_PISTON, world);
    // Facing north (uphill) on a slope rising 2% to the north.
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, onGround: true, headingTrue: 0 });
    setBrakes(vars, 1);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    run(fdm, 20);
    expect(horizDist(p0, fdm)).toBeLessThan(0.05);
    setBrakes(vars, 0);
    run(fdm, 20);
    expect(fdm.lat).toBeLessThan(p0.lat); // rolled south (downhill, backwards)
  });

  it('nosewheel steering turns the aircraft while taxiing', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    onRunway(fdm, 0);
    jetEnginesOn(vars, fdm, 40);
    run(fdm, 10);
    vars.set(GEAR.steerDeg, 20);
    const h0 = fdm.headingTrueDeg;
    run(fdm, 10);
    const dh = ((fdm.headingTrueDeg - h0 + 540) % 360) - 180;
    expect(dh).toBeGreaterThan(20);
    expect(fdm.crashed).toBe(false);
  });
});

describe('FlightModel takeoff and flight', () => {
  it('(c) jet at MTOW: max-thrust roll reaches Vr and climbs when rotated', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    fdm.setStationMass(2, 120);
    onRunway(fdm, 0);
    expect(fdm.mass).toBeCloseTo(TEST_JET.mass.maxTakeoffMass_kg, 0);
    setFlaps(vars, 15);
    setBrakes(vars, 1);
    jetEnginesOn(vars, fdm, 0);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), 100);
    run(fdm, 4);
    setBrakes(vars, 0);
    const s0 = { lat: fdm.lat, lon: fdm.lon };
    let t = 0;
    while (vars.get(FDM.ias) < 110 && t < 60) {
      run(fdm, 0.05);
      t += 0.05;
    }
    expect(vars.get(FDM.ias)).toBeGreaterThanOrEqual(110);
    const roll = horizDist(s0, fdm);
    expect(roll).toBeGreaterThan(250);
    expect(roll).toBeLessThan(1200);
    expect(vars.get(FDM.onGround)).toBe(1);
    // Rotate to 10 deg and hold with a simple pitch controller.
    const alt0 = vars.get(FDM.altMsl);
    run(fdm, 25, () => {
      const e = 0.15 * (10 - fdm.pitchDeg) - 0.1 * vars.get(FDM.q);
      vars.set(SURF.elevator, Math.max(-1, Math.min(1, e)));
    });
    expect(fdm.crashed).toBe(false);
    expect(vars.get(FDM.onGround)).toBe(0);
    expect(vars.get(GEAR.weightOnWheels(1))).toBe(0);
    expect(vars.get(FDM.vs)).toBeGreaterThan(1000);
    expect(vars.get(FDM.altMsl) - alt0).toBeGreaterThan(300);
    expect(Math.abs(fdm.headingTrueDeg - 0) < 2 || Math.abs(fdm.headingTrueDeg - 360) < 2).toBe(true);
  });

  it('(d) trims for level flight at 250 KIAS / 10,000 ft and holds altitude +-50 ft for 60 s hands-off', () => {
    const { fdm, vars } = makeFdm(TEST_JET, undefined, 0.6);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), 0);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 10000, headingTrue: 90, iasKt: 250 });
    const trim = fdm.computeTrim({ iasKt: 250 });
    expect(trim.converged).toBe(true);
    expect(Math.abs(trim.pitchTrim)).toBeLessThan(0.5);
    vars.set(SURF.pitchTrim, trim.pitchTrim);
    vars.set(SURF.elevator, 0);
    const eng = fdm.engines[0] as Turbofan;
    jetEnginesOn(vars, fdm, 0);
    const n1 = eng.n1ForThrust(trim.thrustN / 2, fdm.engineEnv);
    jetEnginesOn(vars, fdm, n1);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 10000, headingTrue: 90, iasKt: 250 });
    const a0 = vars.get(FDM.altMsl);
    expect(vars.get(FDM.ias)).toBeCloseTo(250, 0);
    // Small elevator doublet as a disturbance, then hands off.
    let dev = 0;
    run(fdm, 60, (t) => {
      vars.set(SURF.elevator, t < 0.5 ? 0.03 : t < 1 ? -0.03 : 0);
      dev = Math.max(dev, Math.abs(vars.get(FDM.altMsl) - a0));
    });
    expect(dev).toBeLessThan(50);
    expect(Math.abs(vars.get(FDM.ias) - 250)).toBeLessThan(5);
    expect(Math.abs(fdm.bankDeg)).toBeLessThan(1);
    expect(vars.get(FDM.nz)).toBeCloseTo(1, 1);
  });

  it('piston airframe + engine match the POH cruise: 2400 RPM at 6000 ft ~108 KTAS', () => {
    const { fdm, vars } = makeFdm(TEST_PISTON);
    // POH cruise table is for 2550 lb: empty 1663 lb + full fuel + pilot + passengers.
    fdm.setStationMass(1, 90);
    fdm.setStationMass(2, 83);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 6000, headingTrue: 0, iasKt: 100 });
    expect(fdm.mass / 0.45359237).toBeCloseTo(2550, -1);
    const tr = fdm.computeTrim({ iasKt: 100 });
    vars.set(SURF.pitchTrim, tr.pitchTrim);
    pistonEngineOn(vars, fdm, 0.3);
    vars.set(ENG.mixture(1), 0.8); // leaned for cruise
    // Test "pilot": altitude hold (VS -> pitch -> elevator), wing leveler,
    // ball-centering rudder and a throttle loop holding 2400 RPM.
    const alt0 = vars.get(FDM.altMsl);
    const dt = 1 / 120;
    let thr = 0.3;
    let pI = fdm.pitchDeg;
    run(fdm, 240, () => {
      const altErr = alt0 - vars.get(FDM.altMsl);
      const vs = vars.get(FDM.vs);
      const e = Math.max(-500, Math.min(500, 3 * altErr)) - vs;
      pI += 0.0003 * e * dt;
      const el = 0.06 * (pI + 0.004 * e - fdm.pitchDeg) - 0.04 * vars.get(FDM.q);
      vars.set(SURF.elevator, Math.max(-0.5, Math.min(0.5, el)));
      vars.set(SURF.aileron, Math.max(-0.3, Math.min(0.3, -0.03 * fdm.bankDeg - 0.02 * vars.get(FDM.p))));
      vars.set(SURF.rudder, Math.max(-0.5, Math.min(0.5, 0.15 * vars.get(FDM.beta))));
      thr = Math.max(0, Math.min(1, thr + 0.00015 * (2400 - vars.get(ENG.rpm(1))) * dt));
      vars.set(ENG.throttle(1), thr);
    });
    expect(Math.abs(vars.get(FDM.altMsl) - alt0)).toBeLessThan(30);
    expect(vars.get(ENG.rpm(1))).toBeCloseTo(2400, -1);
    // POH Figure 5-8 (6000 ft, 2400 RPM, std temp): 108 KTAS, 57% BHP.
    const ktas = vars.get(FDM.tas);
    expect(ktas).toBeGreaterThan(103);
    expect(ktas).toBeLessThan(113);
    const pct = (vars.get(ENG.powerHp(1)) / 180) * 100;
    expect(pct).toBeGreaterThan(52);
    expect(pct).toBeLessThan(62);
  });

  it('publishes every standard fdm.* var', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    onRunway(fdm);
    run(fdm, 0.1);
    for (const [, name] of Object.entries(FDM)) {
      if (name === FDM.crashReason) continue; // string var
      expect(vars.has(name), name).toBe(true);
      expect(Number.isFinite(vars.get(name)), name).toBe(true);
    }
    expect(vars.getString(FDM.crashReason)).toBe('');
  });

  it('magnetic heading uses WMM2025 declination', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    onRunway(fdm, 160);
    const d = magneticDeclination(vars.get(FDM.lat), vars.get(FDM.lon), 100, 2026.7);
    expect(vars.get(FDM.magVar)).toBeCloseTo(d, 1);
    expect(d).toBeGreaterThan(14); // Seattle ~15 deg E
    expect(vars.get(FDM.headingMag)).toBeCloseTo(160 - d, 1);
  });

  it('wind: headwind raises IAS over ground speed; winds reported', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    vars.set(ENV.surfaceWindDir, 360);
    vars.set(ENV.surfaceWindKt, 20);
    onRunway(fdm, 0);
    run(fdm, 1);
    // 20 kt at 10 m -> ~13 kt at the CG height (~1.3 m) through the log-law surface layer.
    expect(vars.get(FDM.ias)).toBeGreaterThan(10);
    expect(vars.get(FDM.ias)).toBeLessThan(20);
    expect(vars.get(FDM.gs)).toBeLessThan(0.5);
    expect(vars.get(FDM.windDir)).toBeCloseTo(360 % 360, 0);
  });
});

describe('FlightModel crash detection, freeze and reposition', () => {
  it('hard landing above the sink-rate limit crashes', () => {
    const { fdm, vars } = makeFdm(TEST_PISTON);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 100 / 0.3048 + 12, headingTrue: 0, iasKt: 60 });
    fdm.vNed.z = 8; // 1575 fpm down
    run(fdm, 3);
    expect(fdm.crashed).toBe(true);
    expect(vars.get(FDM.crashed)).toBe(1);
    expect(vars.getString(FDM.crashReason)).toMatch(/Hard landing|Structure|Terrain/);
  });

  it('gear-up landing (belly contact while sliding) crashes', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), 0);
    onRunway(fdm, 0);
    fdm.vNed.x = 40;
    run(fdm, 5);
    expect(fdm.crashed).toBe(true);
    expect(vars.getString(FDM.crashReason)).toMatch(/Structure/);
  });

  it('frozen (slew) holds position but keeps publishing; reposition clears a crash', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 5000, headingTrue: 45, iasKt: 200 });
    fdm.setFrozen(true);
    const lat = fdm.lat;
    const alt = fdm.alt;
    vars.set(SIM.timeS, 0);
    run(fdm, 5);
    expect(fdm.lat).toBe(lat);
    expect(fdm.alt).toBe(alt);
    expect(vars.get(FDM.frozen)).toBe(1);
    expect(vars.get(FDM.ias)).toBeGreaterThan(190);
    fdm.slew(1000, 0, 100, 10);
    expect(fdm.lat).toBeGreaterThan(lat);
    expect(fdm.headingTrueDeg).toBeCloseTo(55, 3);
    fdm.setFrozen(false);
    fdm.crashed = true;
    onRunway(fdm);
    expect(fdm.crashed).toBe(false);
    expect(vars.get(FDM.crashed)).toBe(0);
  });

  it('fuel burn shifts the CG without moving the datum', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    onRunway(fdm);
    run(fdm, 1);
    const lat = vars.get(FDM.lat);
    const mac0 = vars.get(FDM.cgPctMac);
    vars.set('fuel.tank0_kg', 200);
    vars.set('fuel.tank1_kg', 200);
    run(fdm, 3);
    expect(vars.get(FDM.mass)).toBeLessThan(6000);
    expect(vars.get(FDM.cgPctMac)).not.toBeCloseTo(mac0, 2);
    expect(horizDist({ lat, lon: vars.get(FDM.lon) }, { lat: vars.get(FDM.lat), lon: vars.get(FDM.lon) })).toBeLessThan(0.05);
  });
});

describe('FlightModel terrain refinement and reposition altitude', () => {
  it('carries a parked aircraft with a terrain-data step instead of launching or crashing it', () => {
    const world = new FlatWorld(100);
    const { fdm } = makeFdm(TEST_JET, world);
    onRunway(fdm);
    run(fdm, 1);
    const agl0 = fdm.alt - 100;
    world.elevation_m = 103; // higher-resolution tile arrives: runway is 3 m higher
    run(fdm, 5);
    expect(fdm.crashed).toBe(false);
    expect(fdm.alt - 103).toBeCloseTo(agl0, 2);
    expect(Math.abs(fdm.vNed.z)).toBeLessThan(0.01);
  });

  it('in-air reposition places the datum at the requested altitude', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, altFtMsl: 8000, headingTrue: 0, iasKt: 220 });
    expect(vars.get(FDM.altMsl)).toBeCloseTo(8000, 0);
  });
});
