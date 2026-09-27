/**
 * Shared harness for the Global 6000 overhead / side-console tests: var read/write
 * recording and the pointer gestures used to actuate controls headlessly
 * (same method as cockpit-main/coverage.test.ts).
 */
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { makeRig, type Rig } from '../helpers';
import type { InitialState } from '../../../../src/aircraft/types';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { applyG6kState } from '../../../../src/aircraft/global6000/states';

/** Records every var name read through vars.get / has / getBool while `fn` runs. */
export function recordReads(vars: SimVars, fn: () => void): Set<string> {
  const reads = new Set<string>();
  const v = vars as unknown as Record<string, (...a: unknown[]) => unknown>;
  const orig = { get: v.get.bind(vars), has: v.has.bind(vars), getBool: v.getBool?.bind(vars) };
  v.get = (n: unknown, f?: unknown) => {
    reads.add(n as string);
    return orig.get(n, f);
  };
  v.has = (n: unknown) => {
    reads.add(n as string);
    return orig.has(n);
  };
  if (orig.getBool)
    v.getBool = (n: unknown) => {
      reads.add(n as string);
      return orig.getBool!(n);
    };
  try {
    fn();
  } finally {
    const o = vars as unknown as Record<string, unknown>;
    delete o.get;
    delete o.has;
    delete o.getBool;
  }
  return reads;
}

export function systemReads(r: Rig): Set<string> {
  const all = new Set<string>();
  const run = (s: number) => {
    for (const n of recordReads(r.vars, () => r.run(s))) all.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff', 'ready_to_taxi'] as const) {
    applyG6kState(r.ctx, r.sys, st);
    run(1);
  }
  return all;
}

export function hasListener(events: EventBus, name: string): boolean {
  const h = (events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.get(name);
  return !!h && h.size > 0;
}

export function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t, ...mods };
}

/** Records the vars whose value `fn` changes (including momentary changes that are undone before it returns). */
export function recordWrites(vars: SimVars, fn: () => void): Set<string> {
  const written = new Set<string>();
  const v = vars as unknown as { set: SimVars['set']; get: SimVars['get'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    if (!Object.is(vars.get(n, NaN), x)) written.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
  return written;
}

/** Candidate gestures, tried in order until one produces a consumed effect. */
export function gestures(c: CockpitControl): ((dt: (s: number) => void) => void)[] {
  const out: ((dt: (s: number) => void) => void)[] = [];
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (const t of targets) {
    for (const button of [0, 2, 1] as const) {
      out.push((adv) => {
        c.onPointerDown?.(pointer(t, button));
        adv(0.12);
        c.onPointerUp?.(pointer(t, button));
        adv(0.4);
      });
    }
    out.push((adv) => {
      c.onPointerDown?.(pointer(t, 0, { ctrl: true }));
      c.onPointerUp?.(pointer(t, 0, { ctrl: true }));
      adv(0.3);
    });
    for (const w of [1, -1, 3]) {
      out.push((adv) => {
        c.onWheel?.(w, pointer(t));
        adv(0.4);
      });
      out.push((adv) => {
        c.onWheel?.(w, pointer(t, 0, { shift: true }));
        adv(0.4);
      });
    }
    for (const [dx, dy] of [
      [0, -120],
      [0, 120],
      [120, 0],
      [-120, 0],
    ]) {
      out.push((adv) => {
        const p = pointer(t);
        c.onPointerDown?.(p);
        for (let i = 0; i < 6; i++) {
          c.onDrag?.(dx / 6, dy / 6, p);
          adv(1 / 30);
        }
        adv(0.4);
        c.onPointerUp?.(p);
        adv(0.4);
      });
    }
  }
  return out;
}


/** Full Global 6000 cockpit (overhead + side consoles) on a headless rig; `step` advances cockpit and systems together. */
export function setupFull(state: InitialState, o: Parameters<typeof makeRig>[1] = {}) {
  const r = makeRig(state, { avionics: true, ...o });
  const { build } = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
  build.root.updateMatrixWorld(true);
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = (id: string): CockpitControl => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  const click = (id: string, button: 0 | 1 | 2 = 0) => {
    const c = ctl(id);
    const t = c.hitTargets[0] ?? c.object;
    c.onPointerDown?.(pointer(t, button));
    c.onPointerUp?.(pointer(t, button));
  };
  return { r, build, ctl, step, click };
}
