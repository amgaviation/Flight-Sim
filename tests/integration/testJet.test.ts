/**
 * End-to-end ground and takeoff behaviour of the `_test-jet` with the real
 * systems library, flight model, input command router and scripted pilot,
 * run headless through the real SimLoop (systems 60 Hz, FDM 120 Hz), wired
 * the way App.ts wires them (minus rendering). These are the numeric
 * counterparts of the browser smoke test (scripts/smoke.mjs) and run in a
 * few seconds.
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../src/core/SimLoop';
import type { SimContext } from '../../src/core/SimContext';
import { ENV, FDM, FUEL, GEAR } from '../../src/core/vars';
import { FlightModel } from '../../src/physics/FlightModel';
import { TEST_JET } from '../../src/physics/testAircraft';
import testJet from '../../src/aircraft/_test/index';
import { createTestJetSystems } from '../../src/aircraft/_test/systems';
import { applyTestJetState } from '../../src/aircraft/_test/state';
import { DEMO_VARS } from '../../src/cockpit/demo/DemoPanel';
import { CommandRouter } from '../../src/input/CommandRouter';
import { INPUT_EVENTS } from '../../src/input/actions';
import { ScriptedPilot } from '../../src/input/ScriptedPilot';
import type { AircraftInputMap, InitialState } from '../../src/aircraft/types';
import type { NavDatabase } from '../../src/nav/types';
import { FlatWorld, horizDist } from '../physics/helpers';

/** KTEB runway 1-like: 9 ft field elevation, runway true course 6 deg. */
const FIELD = { lat: 40.8501, lon: -74.0608, elevM: 9 * 0.3048, courseTrue: 6 };
const VR = testJet.meta.typical.rotateKias;

const noop = () => undefined;
const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

/** The parts of the test jet's input map these tests use (App.ts hands the full map to its CommandRouter). */
const INPUT_MAP: AircraftInputMap = {
  throttles: [DEMO_VARS.tla1, DEMO_VARS.tla2],
  throttleRange: [0, 1],
  gear: { var: DEMO_VARS.gear, up: 1, down: 0 },
  parkingBrake: { var: DEMO_VARS.park, on: 1, off: 0 },
};

interface Wind {
  dir: number;
  kt: number;
  gustKt?: number;
  turbulence?: number;
}

function makeJet(state: InitialState, wind: Wind = { dir: 0, kt: 0 }) {
  const vars = new SimVars();
  const events = new EventBus();
  const world = new FlatWorld(FIELD.elevM, 'asphalt', 0, FIELD.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, wind.dir);
  vars.set(ENV.surfaceWindKt, wind.kt);
  vars.set(ENV.surfaceGustKt, wind.gustKt ?? 0);
  vars.set(ENV.turbulence, wind.turbulence ?? 0);
  TEST_JET.mass.tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), t.capacity_kg * 0.7));
  const fdm = new FlightModel(TEST_JET, vars, world, { seed: 3, magneticYear: 2026.7 });
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: {} as NavDatabase,
    audio: AUDIO,
    fdm,
    storage: { get: <T>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f), set: (k, x) => void store.set(k, x) },
  };
  const sys = createTestJetSystems(ctx);
  fdm.reposition({ lat: FIELD.lat, lon: FIELD.lon, onGround: true, headingTrue: FIELD.courseTrue });
  applyTestJetState(ctx, sys, state);
  const router = new CommandRouter(vars, events);
  router.setMap(INPUT_MAP);
  const pilot = new ScriptedPilot(vars, events);
  const loop = new SimLoop(
    vars,
    {
      input: (dt) => router.update(dt),
      systems: (dt) => {
        pilot.update(dt);
        for (const s of sys.list) s.update(dt);
      },
      physics: (dt) => fdm.step(dt),
    },
    { scheduler: new ManualScheduler(), events },
  );
  /** Runs `seconds` of sim time in 60 Hz frames, calling `each` after every frame. */
  const run = (seconds: number, each?: () => void) => {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
      loop.advance(1 / 60);
      each?.();
    }
  };
  return { vars, events, fdm, sys, pilot, run };
}

const FINITE_VARS = [FDM.lat, FDM.lon, FDM.altMsl, FDM.pitch, FDM.bank, FDM.headingTrue, FDM.gs, FDM.vs, FDM.ias];

describe('_test-jet on the runway (takeoff state)', () => {
  it('holds still on the parking brake at idle in gusty wind: no drift, no bounce, all finite', () => {
    const j = makeJet('takeoff', { dir: 230, kt: 10, gustKt: 6, turbulence: 0.15 });
    j.events.emit(INPUT_EVENTS.parkingBrakeToggle);
    expect(j.vars.get(DEMO_VARS.park)).toBe(1);
    j.run(2); // settle onto the gear
    const p0 = { lat: j.vars.get(FDM.lat), lon: j.vars.get(FDM.lon) };
    const alt0 = j.vars.get(FDM.altMsl);
    const hdg0 = j.vars.get(FDM.headingTrue);
    let maxGs = 0;
    let altSpan = 0;
    let pitchMin = Infinity;
    let pitchMax = -Infinity;
    let finite = true;
    j.run(20, () => {
      const v = j.vars;
      maxGs = Math.max(maxGs, v.get(FDM.gs));
      altSpan = Math.max(altSpan, Math.abs(v.get(FDM.altMsl) - alt0));
      pitchMin = Math.min(pitchMin, v.get(FDM.pitch));
      pitchMax = Math.max(pitchMax, v.get(FDM.pitch));
      for (const k of FINITE_VARS) if (!Number.isFinite(v.get(k))) finite = false;
    });
    const drift = horizDist(p0, { lat: j.vars.get(FDM.lat), lon: j.vars.get(FDM.lon) });
    expect(finite).toBe(true);
    expect(j.vars.get(FDM.onGround)).toBe(1);
    expect(j.vars.get('eng1.running')).toBe(1);
    expect(j.vars.get('eng2.running')).toBe(1);
    expect(drift).toBeLessThan(0.3);
    expect(maxGs).toBeLessThan(0.2);
    expect(Math.abs(j.vars.get(FDM.headingTrue) - hdg0)).toBeLessThan(0.2);
    // Gusts rock the airframe on its struts a little; no bouncing.
    expect(altSpan).toBeLessThan(0.1 / 0.3048);
    expect(pitchMax - pitchMin).toBeLessThan(0.3);
  });

  const winds: [string, Wind][] = [
    ['calm', { dir: 0, kt: 0 }],
    ['10 kt direct crosswind from the left', { dir: 276, kt: 10 }],
    ['smoke weather: 230/10G16, light turbulence', { dir: 230, kt: 10, gustKt: 6, turbulence: 0.15 }],
  ];
  for (const [label, wind] of winds) {
    it(`accelerates at full thrust, holds the centre line, rotates at VR and climbs away (${label})`, () => {
      const j = makeJet('takeoff', wind);
      const v = j.vars;
      j.events.emit(INPUT_EVENTS.throttleFull);
      j.run(0.1); // the router moves the levers
      expect(v.get(DEMO_VARS.tla1)).toBe(1);
      j.pilot.startTakeoff({ vrKt: VR, courseTrueDeg: FIELD.courseTrue });
      let finite = true;
      j.run(45, () => {
        for (const k of FINITE_VARS) if (!Number.isFinite(v.get(k))) finite = false;
      });
      const log = j.pilot.log;
      expect(finite).toBe(true);
      expect(v.get(FDM.crashed)).toBe(0);
      expect(j.pilot.phase).toBe('climb');
      expect(log.rotateIasKt).toBeGreaterThanOrEqual(VR);
      expect(log.rotateIasKt).toBeLessThan(VR + 3);
      // Lift-off a few knots above VR, inside a light-jet ground roll (EST: 300-1,200 m at this weight, sea level).
      expect(log.liftoffIasKt).toBeGreaterThan(VR);
      expect(log.liftoffIasKt).toBeLessThan(VR + 20);
      expect(log.liftoffDistM).toBeGreaterThan(300);
      expect(log.liftoffDistM).toBeLessThan(1200);
      // Stays on a 150 ft (45 m) runway, well inside the edge.
      expect(log.maxGroundDeviationM).toBeLessThan(5);
      expect(log.maxAirBankDeg).toBeLessThan(8);
      // Rotation to the 10 deg target without a large overshoot (tail cone contacts at ~14.5 deg on the mains).
      expect(log.maxPitchDeg).toBeGreaterThan(9);
      expect(log.maxPitchDeg).toBeLessThan(12.5);
      // Climbing away with the gear coming up.
      expect(v.get(FDM.altAgl)).toBeGreaterThan(1000);
      expect(v.get(FDM.vs)).toBeGreaterThan(1000);
      expect(log.gearUpCommanded).toBe(true);
      expect(v.get(DEMO_VARS.gear)).toBe(1);
      expect(v.get(GEAR.pos(1))).toBeLessThan(0.02);
    });
  }
});
