import { describe, expect, it } from 'vitest';
import { Aerodynamics, createAeroInputs, ICE_ALPHA_STALL_LOSS, ICE_CLMAX_LOSS } from '../../src/physics/Aerodynamics';
import { MassModel } from '../../src/physics/MassModel';
import { GroundContact, SURFACE_PROPERTIES } from '../../src/physics/GroundContact';
import { TEST_JET } from '../../src/physics/testAircraft';
import { TEST_PISTON } from '../../src/physics/testPiston';
import { SimVars } from '../../src/core/SimVars';
import { FUEL, GEAR } from '../../src/core/vars';
import { Quat, Vec3 } from '../../src/core/linalg';
import { interp2 } from '../../src/core/math';
import { FlatWorld, makeFdm, run, SEA_TAC, horizDist } from './helpers';

const D2R = Math.PI / 180;

function clMax(aero: Aerodynamics, flaps: number, ice: number, slats = 0): { cl: number; alpha: number } {
  let best = -1;
  let at = 0;
  for (let a = 0; a <= 25; a += 0.05) {
    const cl = aero.wingLift(a, flaps, slats, ice, 0);
    if (cl > best) {
      best = cl;
      at = a;
    }
  }
  return { cl: best, alpha: at };
}

describe('Aerodynamics', () => {
  const aero = new Aerodynamics(TEST_JET.aero);
  const cg = new Vec3();

  it('reproduces the CL table in the linear range and has the stall break at alphaStall', () => {
    for (const a of [-4, 0, 3, 5]) expect(aero.wingLift(a, 0, 0, 0, 0)).toBeCloseTo(interp2(TEST_JET.aero.CL, a, 0), 9);
    const clean = clMax(aero, 0, 0);
    expect(clean.alpha).toBeCloseTo(14, 1);
    expect(clean.cl).toBeCloseTo(1.28, 2);
    const land = clMax(aero, 35, 0);
    expect(land.alpha).toBeCloseTo(12, 1);
  });

  it('airframe ice cuts CLmax ~30% and stall AoA ~25%, raises drag', () => {
    const clean = clMax(aero, 0, 0);
    const iced = clMax(aero, 0, 1);
    expect(iced.cl / clean.cl).toBeCloseTo(1 - ICE_CLMAX_LOSS, 1);
    expect(iced.alpha / clean.alpha).toBeCloseTo(1 - ICE_ALPHA_STALL_LOSS, 1);
    const inp = createAeroInputs();
    inp.alpha = 2 * D2R;
    inp.tas = 100;
    inp.qbar = 5000;
    inp.mach = 0.3;
    aero.compute(inp, cg);
    const cd0 = aero.CD;
    inp.ice = 1;
    aero.compute(inp, cg);
    expect(aero.CD).toBeGreaterThan(cd0 * 1.3);
    expect(aero.alphaStallEff).toBeCloseTo(14 * 0.75, 6);
  });

  it('slats raise CLmax by CL_slats and extend the stall AoA', () => {
    const a = new Aerodynamics({ ...TEST_JET.aero, CL_slats: 0.4 });
    const base = clMax(a, 0, 0, 0);
    const slat = clMax(a, 0, 0, 1);
    expect(slat.cl - base.cl).toBeCloseTo(0.4, 1);
    expect(slat.alpha).toBeGreaterThan(base.alpha + 3);
  });

  it('stall warning ramps 0 -> 1 between 0.5 and 1.0 of the stall AoA; buffet near stall and Mach', () => {
    const inp = createAeroInputs();
    inp.tas = 60;
    inp.qbar = 2000;
    inp.alpha = 5 * D2R;
    aero.compute(inp, cg);
    expect(aero.stallWarning).toBe(0);
    inp.alpha = 10.5 * D2R;
    aero.compute(inp, cg);
    expect(aero.stallWarning).toBeCloseTo(0.5, 6);
    expect(aero.aoaNorm).toBeCloseTo(0.75, 6);
    inp.alpha = 14 * D2R;
    aero.compute(inp, cg);
    expect(aero.stallWarning).toBe(1);
    expect(aero.buffet).toBeGreaterThan(0.3);
    inp.alpha = 1 * D2R;
    inp.mach = 0.88;
    inp.qbar = 12000;
    aero.compute(inp, cg);
    expect(aero.buffet).toBeGreaterThan(0.8);
  });

  it('ground effect increases lift and cuts induced drag near the ground', () => {
    const inp = createAeroInputs();
    inp.tas = 60;
    inp.qbar = 2200;
    inp.alpha = 8 * D2R;
    inp.heightAgl = 100;
    aero.compute(inp, cg);
    const cl = aero.CL;
    const cd = aero.CD;
    inp.heightAgl = 1.5;
    aero.compute(inp, cg);
    expect(aero.CL).toBeGreaterThan(cl * 1.04);
    expect(aero.CD).toBeLessThan(cd);
  });

  it('control signs: +elevator pitches nose up, +aileron rolls right, +rudder yaws right', () => {
    const inp = createAeroInputs();
    inp.tas = 100;
    inp.qbar = 6000;
    aero.compute(inp, cg);
    const m0 = aero.moment.clone();
    inp.elevator = 1;
    aero.compute(inp, cg);
    expect(aero.moment.y).toBeGreaterThan(m0.y);
    inp.elevator = 0;
    inp.aileron = 1;
    aero.compute(inp, cg);
    expect(aero.moment.x).toBeGreaterThan(m0.x);
    expect(aero.moment.z).toBeLessThan(m0.z); // adverse yaw
    inp.aileron = 0;
    inp.rudder = 1;
    aero.compute(inp, cg);
    expect(aero.moment.z).toBeGreaterThan(m0.z);
    expect(aero.force.y).toBeLessThan(0);
  });

  it('spoilers dump lift and add drag; differential spoilers roll', () => {
    const inp = createAeroInputs();
    inp.tas = 100;
    inp.qbar = 6000;
    inp.alpha = 3 * D2R;
    aero.compute(inp, cg);
    const cl = aero.CL;
    const cd = aero.CD;
    inp.groundSpoilers = 1;
    aero.compute(inp, cg);
    expect(aero.CL).toBeLessThan(cl - 0.5);
    expect(aero.CD).toBeGreaterThan(cd + 0.05);
    inp.groundSpoilers = 0;
    inp.spoilerRight = 1;
    aero.compute(inp, cg);
    expect(aero.Cl).toBeGreaterThan(0);
  });

  it('propwash keeps the elevator effective at zero airspeed', () => {
    const a = new Aerodynamics(TEST_PISTON.aero);
    const inp = createAeroInputs();
    inp.elevator = 1;
    inp.propwashDq = 800;
    a.compute(inp, cg);
    expect(a.moment.y).toBeGreaterThan(100);
  });
});

describe('MassModel', () => {
  it('sums mass, CG and applies the parallel-axis theorem', () => {
    const vars = new SimVars();
    const mm = new MassModel(TEST_JET.mass, vars);
    const empty = TEST_JET.mass.emptyMass_kg + 180; // two pilots by default
    expect(mm.mass).toBeCloseTo(empty, 6);
    vars.set(FUEL.tankKg(0), 1000);
    vars.set(FUEL.tankKg(1), 0);
    expect(mm.update()).toBe(true);
    expect(mm.mass).toBeCloseTo(empty + 1000, 6);
    expect(mm.cg.y).toBeLessThan(-0.2); // left-heavy
    // Point mass at (x, y, z) about the CG adds m*d^2 terms.
    const ixxBefore = new MassModel(TEST_JET.mass, null);
    const withFuel = new MassModel(TEST_JET.mass, null);
    withFuel.setTankMass(0, 1000);
    withFuel.setTankMass(1, 1000);
    withFuel.update();
    const d = TEST_JET.mass.tanks[0].position_m[1];
    expect(withFuel.inertia.e[0] - ixxBefore.inertia.e[0]).toBeGreaterThan(2000 * d * d * 0.9);
    expect(mm.update()).toBe(false); // unchanged -> no recompute
  });

  it('station masses clamp to limits and %MAC follows the CG', () => {
    const mm = new MassModel(TEST_PISTON.mass, null);
    const mac = TEST_PISTON.aero.mac_m;
    const before = mm.cgPercentMac(mac);
    mm.setStationMass(4, 1000); // baggage 2 max 50 lb
    mm.update();
    expect(mm.stationMass[4]).toBeCloseTo(50 * 0.45359237, 6);
    expect(mm.cgPercentMac(mac)).toBeGreaterThan(before);
  });
});

describe('GroundContact', () => {
  it('surface table covers every surface type with sane values', () => {
    for (const s of ['asphalt', 'concrete', 'grass', 'dirt', 'gravel', 'water', 'snow', 'unknown'] as const) {
      expect(SURFACE_PROPERTIES[s].friction).toBeGreaterThan(0);
      expect(SURFACE_PROPERTIES[s].friction).toBeLessThanOrEqual(1);
      expect(SURFACE_PROPERTIES[s].rolling).toBeGreaterThanOrEqual(1);
    }
  });

  it('retracted gear carries no load', () => {
    const vars = new SimVars();
    const gc = new GroundContact(TEST_JET.gear, vars);
    const q = new Quat();
    const cg = new Vec3();
    gc.sampleTerrain(new FlatWorld(0), SEA_TAC.lat, SEA_TAC.lon, 1.3, q, cg);
    gc.compute(new Vec3(), q, new Vec3(), new Vec3(), cg, 0);
    expect(gc.forceBody.z).toBeLessThan(-1000);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), 0.5);
    gc.compute(new Vec3(), q, new Vec3(), new Vec3(), cg, 0);
    // Only structure contacts could touch; at 1.3 m none do.
    expect(gc.forceBody.z).toBeCloseTo(0, 6);
  });

  it('braking stops the jet sooner on dry asphalt than on grass or a wet runway', () => {
    const stop = (surface: 'asphalt' | 'grass', wet: number): number => {
      const { fdm, vars } = makeFdm(TEST_JET, new FlatWorld(100, surface));
      vars.set('env.precip', wet);
      fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, onGround: true, headingTrue: 0 });
      fdm.vNed.x = 30;
      const p0 = { lat: fdm.lat, lon: fdm.lon };
      vars.set(GEAR.brakeLeft, 1);
      vars.set(GEAR.brakeRight, 1);
      run(fdm, 20);
      expect(fdm.vNed.x).toBeLessThan(0.3);
      return horizDist(p0, fdm);
    };
    const dry = stop('asphalt', 0);
    const wet = stop('asphalt', 1);
    const grass = stop('grass', 0);
    expect(dry).toBeGreaterThan(60); // ~V^2/(2 * 0.5 g)
    expect(dry).toBeLessThan(140);
    expect(wet).toBeGreaterThan(dry * 1.2);
    expect(grass).toBeGreaterThan(dry * 1.2);
  });
});
