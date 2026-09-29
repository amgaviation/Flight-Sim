/**
 * Cessna 172S G1000 NXi cockpit: control coverage audit (CLAUDE.md "Everything in a cockpit works").
 * Every control of the cockpit build is actuated through its own pointer / wheel / drag handlers (the
 * code paths the mouse uses); each must change a var that a system, the exterior model or a cockpit
 * indicator reads, or emit an event that something handles. Unbound controls must be none.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as fs from 'node:fs';
import { makeG1k, type G1kRig } from './helpers';
import { fakeCanvas } from './fakeCanvas';
import { buildC172G1000Cockpit, type C172G1000Cockpit } from '../../../src/aircraft/c172-g1000/cockpit';
import { g1000Controls } from '../../../src/avionics/garmin-g1000/controls';
import { COCKPIT_VARS, type CockpitControl, type ControlPointer } from '../../../src/cockpit/types';
import { AnnunciatorLight, CircuitBreaker } from '../../../src/cockpit/controls';
import { ANALOG_VARS } from '../../../src/avionics/analog';
import { createC172Exterior } from '../../../src/aircraft/c172s-common/exterior';
import { C172, DOOR, MAG } from '../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../src/aircraft/c172-g1000/vars';
import { JewelLamp } from '../../../src/aircraft/c172-g1000/cockpit/jewelLamp';
import type { InitialState } from '../../../src/aircraft/types';

const g = globalThis as unknown as { OffscreenCanvas?: unknown };
const hadOffscreen = 'OffscreenCanvas' in g;
const prevOffscreen = g.OffscreenCanvas;
beforeAll(() => {
  g.OffscreenCanvas = class {
    constructor(w: number, h: number) {
      return fakeCanvas(w, h);
    }
  };
});
afterAll(() => {
  if (hadOffscreen) g.OffscreenCanvas = prevOffscreen;
  else delete g.OffscreenCanvas;
});

/**
 * Instrument knob settings read only by the instrument itself (the airspeed indicator's TAS ring, the
 * attitude indicator's miniature-airplane adjustment): the instrument is their consumer.
 */
const INSTRUMENT_STATE = new Set<string>([ANALOG_VARS.asiTasRing, ANALOG_VARS.aiSymbolOffset]);

interface Rec {
  writes: Set<string>;
  events: Set<string>;
}

function pointer(obj: THREE.Object3D, button: 0 | 1 | 2, ctrl = false): ControlPointer {
  const point = new THREE.Vector3();
  obj.getWorldPosition(point);
  return { button, shift: false, ctrl, alt: false, point, object: obj };
}

function tick(c: CockpitControl, n = 8): void {
  for (let i = 0; i < n; i++) c.update?.(0.05);
}

/** Every generic gesture: clicks (left / right / middle) on each hit target, wheel both ways, a drag. */
function exercise(c: CockpitControl, cycles = 3): void {
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (let k = 0; k < cycles; k++) {
    for (const t of targets) {
      for (const b of [0, 2, 1] as const) {
        const p = pointer(t, b);
        c.onPointerDown?.(p);
        tick(c, 3);
        c.onPointerUp?.(p);
        tick(c);
      }
      const p = pointer(t, 0);
      c.onWheel?.(1, p);
      tick(c);
      c.onWheel?.(-1, p);
      tick(c);
      c.onWheel?.(-1, p);
      tick(c);
      c.onPointerDown?.(p);
      c.onDrag?.(35, -60, p);
      tick(c, 2);
      c.onDrag?.(-20, 90, p);
      tick(c, 2);
      c.onPointerUp?.(p);
      tick(c);
    }
  }
}

function build(r: G1kRig): C172G1000Cockpit {
  const ck = buildC172G1000Cockpit(r.ctx, r.sys.suite.cfg, { analog: true });
  ck.build.root.updateMatrixWorld(true);
  return ck;
}

/** Vars read by the systems, the exterior and the cockpit hook while they run 1 s in a state. */
function recordReads(state: InitialState, setup?: (r: G1kRig) => void, writes?: Set<string>): Set<string> {
  const read = new Set<string>();
  const r = makeG1k({ state, ...(state === 'cruise' || state === 'approach' ? { air: { altFtMsl: 5000, iasKt: 105 } } : {}) });
  const ck = build(r);
  const ext = createC172Exterior(r.vars, { ledLights: true });
  setup?.(r);
  const get = r.vars.get.bind(r.vars);
  const set = r.vars.set.bind(r.vars);
  r.vars.get = (name: string, fallback?: number) => {
    read.add(name);
    return get(name, fallback);
  };
  r.vars.set = (name: string, value: number) => {
    writes?.add(name);
    set(name, value);
  };
  for (let i = 0; i < 60; i++) {
    r.run(1 / 60);
    ck.build.update?.(1 / 60);
    ext.update(1 / 60);
  }
  r.vars.get = get;
  r.vars.set = set;
  ext.dispose();
  ck.build.dispose?.();
  return read;
}

describe('Cessna 172S G1000 NXi cockpit controls', () => {
  it('every control drives a var something reads or an event something handles (coverage report)', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const bld = ck.build;
    const handled = (rig.events as unknown as { handlers: Map<string, Set<unknown>> }).handlers;
    const g1kEvents = new Set<string>();
    for (const c of g1000Controls(rig.sys.suite.cfg)) for (const e of [c.press, c.release, c.incEvent, c.decEvent, c.innerIncEvent, c.innerDecEvent, c.joystick]) if (e) g1kEvents.add(e);
    const inputSrc = fs.readFileSync('src/input/InputManager.ts', 'utf8');
    const inputVars = new Set(Object.entries(COCKPIT_VARS).filter(([k]) => inputSrc.includes(k)).map(([, v]) => v));

    const recs = new Map<string, Rec>();
    let cur: Rec | null = null;
    const set = rig.vars.set.bind(rig.vars);
    rig.vars.set = (name: string, value: number) => {
      if (cur && rig.vars.get(name, NaN) !== value) cur.writes.add(name);
      set(name, value);
    };
    const offAny = rig.events.onAny((name) => cur?.events.add(name));
    for (const c of bld.controls) {
      cur = { writes: new Set(), events: new Set() };
      recs.set(c.id, cur);
      exercise(c);
    }
    cur = null;
    offAny();
    rig.vars.set = set;

    const sysWrites = new Set<string>();
    const read = new Set<string>();
    for (const st of ['cold_dark', 'ready_to_taxi', 'cruise', 'approach'] as const) for (const n of recordReads(st, undefined, sysWrites)) read.add(n);
    // Night / avionics-dimmer operation (the AVIONICS dimmer and key lighting act there).
    for (const n of recordReads('ready_to_taxi', (r) => r.vars.set('env.ambient_light', 0.05), sysWrites)) read.add(n);
    for (const n of inputVars) read.add(n);

    const report: string[] = [];
    const unbound: string[] = [];
    for (const c of bld.controls) {
      if (c instanceof AnnunciatorLight) {
        const segs = (c as unknown as { o: { segments: { var?: string }[] } }).o.segments;
        const lampVars = segs.map((sg) => sg.var).filter((x): x is string => !!x);
        const ok = lampVars.length > 0 && lampVars.every((x) => sysWrites.has(x));
        report.push(`${c.id.padEnd(34)} indicator: ${lampVars.join(', ')}${ok ? '' : ' (NOT WRITTEN BY A SYSTEM)'}`);
        if (!ok) unbound.push(`${c.id} (indicator var not written by any system)`);
        continue;
      }
      if (c instanceof JewelLamp) {
        const ok = sysWrites.has(c.lampVar);
        report.push(`${c.id.padEnd(34)} indicator: ${c.lampVar}${ok ? '' : ' (NOT WRITTEN BY A SYSTEM)'}`);
        if (!ok) unbound.push(`${c.id} (indicator var not written by any system)`);
        continue;
      }
      if (c instanceof CircuitBreaker && !(c as unknown as { o: { pullable?: boolean } }).o.pullable) {
        // Push-to-reset breakers (ELEC BUS 1 / 2, CROSSFEED): bound when the electrical network trips / reads them.
        const v = (c as unknown as { o: { var: string } }).o.var;
        const ok = read.has(v);
        report.push(`${c.id.padEnd(34)} push-to-reset breaker: ${v}${ok ? '' : ' (NOT READ BY THE ELECTRICAL SYSTEM)'}`);
        if (!ok) unbound.push(`${c.id} (breaker var ${v} not read)`);
        continue;
      }
      if (c.hitTargets.length === 0 && !c.onPointerDown && !c.onWheel && !(c as { onDrag?: unknown }).onDrag) {
        // Pure indicators (magnetic compass): nothing to operate.
        report.push(`${c.id.padEnd(34)} indicator (no pilot input)`);
        continue;
      }
      const r = recs.get(c.id)!;
      const vars = [...r.writes].filter((w) => read.has(w) || INSTRUMENT_STATE.has(w));
      const evs = [...r.events].filter((e) => (handled.get(e)?.size ?? 0) > 0 || g1kEvents.has(e));
      report.push(`${c.id.padEnd(34)} vars: ${vars.join(', ') || '-'} | events: ${evs.join(', ') || '-'}`);
      if (vars.length === 0 && evs.length === 0) unbound.push(`${c.id} (wrote ${[...r.writes].join(',') || 'nothing'}; emitted ${[...r.events].join(',') || 'nothing'})`);
    }
    fs.mkdirSync('tests/output', { recursive: true });
    fs.writeFileSync('tests/output/c172-g1000-cockpit-coverage.txt', `${bld.controls.length} controls, ${unbound.length} unbound\n${report.join('\n')}\n`);
    bld.dispose?.();
    expect(bld.controls.length).toBeGreaterThan(150);
    expect(unbound).toEqual([]);
  });

  it('every pilot-operable 172S var is bound to a cockpit control', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const written = new Set<string>();
    const set = rig.vars.set.bind(rig.vars);
    rig.vars.set = (name: string, value: number) => {
      if (rig.vars.get(name, NaN) !== value) written.add(name);
      set(name, value);
    };
    for (const c of ck.build.controls) exercise(c, 2);
    rig.vars.set = set;
    const inventory = [
      C172.masterBat, C172.masterAlt, C172.avionicsBus1, C172.avionicsBus2, C172.stbyBatt, C172.cabinPwr12v,
      C172.magneto, C172.throttle, C172.throttleFriction, C172.mixture, C172.fuelPump, C172.fuelSelector, C172.fuelShutoff,
      C172.flapLever, C172.parkingBrake, C172.controlLock, C172.trimPosition,
      C172.beacon, C172.land, C172.taxi, C172.nav, C172.strobe, C172.pitotHeat,
      C172.dimPanel, C172.dimRadio, C172.dimPedestal, C172.dimStbyInd, C172.floodLeft, C172.floodRight, C172.domeCourtesy, C172.mapLight,
      C172.cabinHeat, C172.cabinAir, C172.defrostLeft, C172.defrostRight, C172.altStatic, C172.ventLeft, C172.ventRight,
      C172G.doorHandleLeft, C172G.doorHandleRight, C172G.doorPullLeft, C172G.doorPullRight, C172.windowLeft, C172.windowRight,
      C172G.extPin, C172G.gpuRequest,
      C172G.met, C172G.apDisc, C172G.cws, C172G.pttPilot, C172G.pttCopilot, C172G.pttHandMic, C172G.ga, C172G.eltRocker, C172G.keyTag, C172G.extTrigger,
      C172G.glovebox, C172G.outletDevice, C172G.auxAudioCable,
      'cb.pfd_ess', 'cb.adc_ahrs_avn1', 'cb.mfd', 'cb.autopilot', 'g1k.display_backup', 'adc2.baro_inhg',
    ];
    const missing = inventory.filter((v) => !written.has(v));
    ck.build.dispose?.();
    expect(missing).toEqual([]);
  });

  it('breakers: ESS / AVN buses pull, ELEC / X-FEED buses are push-to-reset only (POH Sec 7)', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const byId = new Map(ck.build.controls.map((c) => [c.id, c]));
    const click = (id: string) => {
      const c = byId.get(id)!;
      const p = pointer(c.hitTargets[0] ?? c.object, 0);
      c.onPointerDown?.(p);
      c.onPointerUp?.(p);
      tick(c);
    };
    click('c172g.cb.mfd');
    expect(rig.vars.get('cb.mfd')).toBe(0);
    click('c172g.cb.land_lt');
    expect(rig.vars.get('cb.land_lt', 1)).toBe(1);
    ck.build.dispose?.();
  });

  it('ignition key, magnetos and the control lock act through the shared logic', () => {
    const rig = makeG1k({ state: 'cold_dark' });
    const ck = build(rig);
    const byId = new Map(ck.build.controls.map((c) => [c.id, c]));
    const clickHold = (id: string) => {
      const c = byId.get(id)!;
      const p = pointer(c.hitTargets[0] ?? c.object, 0);
      c.onPointerDown?.(p);
      tick(c, 2);
      rig.run(0.1);
      c.onPointerUp?.(p);
      tick(c, 2);
      rig.run(0.1);
    };
    expect(rig.vars.get(C172.keyIn)).toBe(0);
    clickHold('c172g.key_tag');
    expect(rig.vars.get(C172.keyIn)).toBe(1);
    // Control lock installed in the cold & dark preset; the lock pin removes it.
    expect(rig.vars.get(C172.controlLock)).toBe(1);
    clickHold('c172g.control_lock');
    expect(rig.vars.get(C172.controlLock)).toBe(0);
    // Magnetos turn with the key in; the key cannot be removed unless OFF.
    rig.vars.set(C172.magneto, MAG.both);
    rig.run(0.1);
    clickHold('c172g.key_tag');
    expect(rig.vars.get(C172.keyIn)).toBe(1);
    rig.vars.set(C172.magneto, MAG.off);
    rig.run(0.1);
    clickHold('c172g.key_tag');
    expect(rig.vars.get(C172.keyIn)).toBe(0);
    // Door handle: OPEN unlatches the door, which swings outward on the ground; the handle springs back to CLOSE.
    rig.vars.set(C172G.doorHandleLeft, DOOR.open);
    for (let i = 0; i < 60; i++) {
      rig.run(1 / 30);
      ck.build.update?.(1 / 30);
    }
    expect(rig.vars.get(C172.doorLeft)).toBe(DOOR.open);
    expect(rig.vars.get(C172G.doorHandleLeft)).toBe(DOOR.closed);
    const door = ck.build.root.getObjectByName('door_l')!;
    expect(Math.abs(door.rotation.y)).toBeGreaterThan(0.8);
    ck.build.dispose?.();
  });
});
