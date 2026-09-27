/**
 * Aircraft lifecycle for the six production jets, as the app drives it
 * (App.launch / unloadSession): module.create(ctx) -> fdm.reposition ->
 * applyState -> systems run -> dispose(). Unloading one aircraft and loading
 * the next must not leave anything behind on the shared SimVars / EventBus
 * (the app keeps both for its whole lifetime), and a second load must work.
 *
 * Checked: every SimVars and EventBus listener the aircraft added is removed
 * by dispose(), and create -> dispose -> create of the same type works.
 * Display canvases are fakes (no DOM in node); the cockpit is built for real.
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import type { SimContext } from '../../src/core/SimContext';
import { ENV } from '../../src/core/vars';
import { FlightModel } from '../../src/physics/FlightModel';
import type { AircraftModule } from '../../src/aircraft/types';
import type { NavDatabase } from '../../src/nav/types';
import { FlatWorld } from '../physics/helpers';
import { AIRCRAFT_CATALOG, isAvailable } from '../../src/aircraft/registry';
import { fakeCanvas } from '../aircraft/g800/helpers';

const JETS = ['citation-m2', 'citation-longitude', 'g650', 'g800', 'global6000', 'b737-800'];
const noop = () => undefined;

/** Minimal DOM stand-ins so display code that creates its own canvases runs in node. */
function installDomStubs(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) {
    g.document = {
      createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild: noop, addEventListener: noop, setAttribute: noop }),
    };
  }
  if (!g.OffscreenCanvas) {
    g.OffscreenCanvas = function (this: Record<string, unknown>, w: number, h: number) {
      const c = fakeCanvas() as unknown as Record<string, unknown>;
      c.width = w;
      c.height = h;
      return c;
    };
  }
}

function listenerCount(vars: SimVars, events: EventBus): number {
  let n = 0;
  for (const set of (vars as unknown as { listeners: Map<string, Set<unknown>> }).listeners.values()) n += set.size;
  for (const set of (vars as unknown as { stringListeners: Map<string, Set<unknown>> }).stringListeners.values()) n += set.size;
  for (const set of (events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.values()) n += set.size;
  n += (events as unknown as { wildcard: Set<unknown> }).wildcard.size;
  return n;
}

function makeCtx(mod: AircraftModule, vars: SimVars, events: EventBus): SimContext {
  const world = new FlatWorld(10, 'asphalt', 0, 40.85);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.oatSeaLevelC, 15);
  vars.set(ENV.ambientLight, 1);
  const store = new Map<string, unknown>();
  return {
    vars,
    events,
    world,
    nav: {} as NavDatabase,
    audio: { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop },
    fdm: new FlightModel(mod.fdm, vars, world, { seed: 1, magneticYear: 2026.7 }),
    storage: { get: <T>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f), set: (k, x) => void store.set(k, x) },
  };
}

describe('jet lifecycle (create, applyState, dispose)', () => {
  it('the catalog offers all six jets', () => {
    for (const id of JETS) {
      expect(AIRCRAFT_CATALOG.some((e) => e.id === id), id).toBe(true);
      expect(isAvailable(id), id).toBe(true);
    }
  });

  for (const id of JETS) {
    it(`${id}: dispose() removes every listener; a second load works`, async () => {
      installDomStubs();
      const entry = AIRCRAFT_CATALOG.find((e) => e.id === id)!;
      const mod = await entry.load();
      const vars = new SimVars();
      const events = new EventBus();
      const base = listenerCount(vars, events);
      for (let round = 0; round < 2; round++) {
        const ctx = makeCtx(mod, vars, events);
        const inst = await mod.create(ctx);
        (ctx.fdm as FlightModel).reposition({ lat: 40.85, lon: -74.06, onGround: true, headingTrue: 60 });
        inst.applyState('ready_to_taxi');
        for (let i = 0; i < 60; i++) for (const s of inst.systems) s.update(1 / 60);
        inst.updateExterior?.(1 / 60);
        expect(listenerCount(vars, events)).toBeGreaterThan(base);
        inst.dispose();
        // CockpitRuntime.dispose -> build.dispose() is the app's half of the unload.
        inst.cockpit.dispose?.();
        const left = listenerCount(vars, events) - base;
        expect(left, `${id}: listeners left after dispose (round ${round + 1})`).toBe(0);
      }
    }, 60_000);
  }
});

describe('jet reposition (pause menu Position: same aircraft, new state)', () => {
  for (const id of JETS) {
    it(`${id}: cruise, then each ground state: gear down, on the ground, not crashed`, async () => {
      installDomStubs();
      const mod = await AIRCRAFT_CATALOG.find((e) => e.id === id)!.load();
      const vars = new SimVars();
      const events = new EventBus();
      const ctx = makeCtx(mod, vars, events);
      const fdm = ctx.fdm as FlightModel;
      const inst = await mod.create(ctx);
      const run = (s: number) => {
        for (let i = 0; i < s * 60; i++) {
          for (const sys of inst.systems) sys.update(1 / 60);
          fdm.step(1 / 120);
          fdm.step(1 / 120);
        }
      };
      for (const state of ['cold_dark', 'ready_to_taxi', 'takeoff'] as const) {
        // The app's reposition (App.placeAndApply): FlightModel.reposition, applyState, and for ground
        // states a second reposition so the aircraft settles on the gear the state has put down.
        fdm.reposition({ lat: 40.85, lon: -74.06, altFtMsl: mod.meta.typical.cruiseAltFt, iasKt: 250, headingTrue: 60 });
        inst.applyState('cruise');
        run(3);
        expect(vars.get('fdm.on_ground'), `${id}: airborne in cruise`).toBe(0);
        fdm.reposition({ lat: 40.85, lon: -74.06, onGround: true, headingTrue: 60 });
        inst.applyState(state);
        fdm.reposition({ lat: 40.85, lon: -74.06, onGround: true, headingTrue: 60 }); // App.placeAndApply: settle again on the state's gear
        run(3);
        for (let g = 0; g < mod.fdm.gear.length; g++) {
          const idx = mod.fdm.gear[g].gearIndex;
          if (idx >= 0) expect(vars.get(`gear.pos${idx}`), `${id} ${state}: gear.pos${idx}`).toBeGreaterThan(0.98);
        }
        expect(vars.get('fdm.crashed'), `${id} ${state}: crashed (${vars.getString('fdm.crash_reason')})`).toBe(0);
        expect(vars.get('fdm.on_ground'), `${id} ${state}: on ground`).toBe(1);
      }
      inst.dispose();
      inst.cockpit.dispose?.();
    }, 120_000);
  }
});
