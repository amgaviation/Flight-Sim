/**
 * Shared harness for the Citation M2 overhead / sidewall tests: the headless
 * rig (../helpers) plus the full cockpit build, var read/write recording and
 * the pointer gestures that actuate controls through their own handlers
 * (same method as cockpit-main/controls.test.ts).
 */
import * as THREE from 'three';
import { makeM2, type Rig, type RigOptions } from '../helpers';
import { buildM2Cockpit, type M2Cockpit } from '../../../../src/aircraft/citation-m2/cockpit';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { SimVars } from '../../../../src/core/SimVars';
import { M2 } from '../../../../src/aircraft/citation-m2/vars';

/** Control-id prefixes owned by the overhead / sidewall parts. */
export const PART_PREFIXES = ['m2.cb.', 'm2.ovhd.', 'm2.side.'];
export const isPartControl = (c: CockpitControl): boolean => PART_PREFIXES.some((p) => c.id.startsWith(p));

export interface CockpitRig extends Rig {
  ck: M2Cockpit;
  /** Runs the aircraft systems plus the cockpit-part subsystems for `s` seconds, and ticks every control. */
  step(s: number): void;
  control(id: string): CockpitControl;
}

export function makeCockpitRig(o: RigOptions): CockpitRig {
  const r = makeM2(o);
  const ck = buildM2Cockpit(r.ctx);
  ck.build.root.updateMatrixWorld(true);
  const step = (s: number): void => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      r.run(1 / 60);
      for (const sub of ck.systems) sub.update(1 / 60);
      for (const c of ck.build.controls) c.update?.(1 / 60);
      ck.build.update?.(1 / 60);
    }
  };
  const control = (id: string): CockpitControl => {
    const c = ck.build.controls.find((x) => x.id === id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  return { ...r, ck, step, control };
}

export function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
}

/** A left click on the control's first hit target. */
export function click(c: CockpitControl, button: 0 | 1 | 2 = 0): void {
  const t = c.hitTargets[0] ?? c.object;
  c.onPointerDown?.(pointer(t, button));
  c.onPointerUp?.(pointer(t, button));
}

/** Records every var read through vars.get / has while `fn` runs. */
export function recordReads(vars: SimVars, fn: () => void, into = new Set<string>()): Set<string> {
  const v = vars as unknown as { get: SimVars['get']; has: SimVars['has'] };
  const get = v.get.bind(vars);
  const has = v.has.bind(vars);
  v.get = (n: string, f?: number) => {
    into.add(n);
    return get(n, f);
  };
  v.has = (n: string) => {
    into.add(n);
    return has(n);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).get;
    delete (vars as unknown as Record<string, unknown>).has;
  }
  return into;
}

/** Records the vars whose value changes while `fn` runs (including momentary changes undone before it returns); every var written when `changedOnly` is false. */
export function recordWrites(vars: SimVars, fn: () => void, into = new Set<string>(), changedOnly = true): Set<string> {
  const v = vars as unknown as { set: SimVars['set'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    if (!changedOnly || !Object.is(vars.get(n, NaN), x)) into.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
  return into;
}

/** Drives a control through every generic gesture: clicks (left / right / middle) on each hit target, wheel both ways, a drag. */
export function exercise(c: CockpitControl, tick: () => void): void {
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (let k = 0; k < 2; k++) {
    for (const t of targets) {
      for (const b of [0, 2, 1] as const) {
        c.onPointerDown?.(pointer(t, b));
        for (let i = 0; i < 3; i++) tick();
        c.onPointerUp?.(pointer(t, b));
        for (let i = 0; i < 8; i++) tick();
      }
      for (const w of [1, -1, -1]) {
        c.onWheel?.(w, pointer(t));
        for (let i = 0; i < 8; i++) tick();
      }
      // Drag gesture (toggle levers under a guard are thrown by dragging, as with the mouse).
      const p = pointer(t);
      c.onPointerDown?.(p);
      c.onDrag?.(0, -60, p);
      for (let i = 0; i < 3; i++) tick();
      c.onPointerUp?.(p);
      for (let i = 0; i < 8; i++) tick();
    }
  }
}

/** Switches that enable every modelled electrical load (so each load's `_powered` flag can be observed). */
export function allLoadsOn(v: SimVars): void {
  const on: [string, number][] = [
    [M2.navLt, 1],
    [M2.antiColl, 2],
    [M2.landingLt, 2],
    [M2.taxiLt, 1],
    [M2.logoLt, 1],
    [M2.wingInspLt, 1],
    [M2.wsAlcoholSw, 1],
    [M2.pitotStaticSw, 1],
    [M2.antiskidSw, 1],
    [M2.cabinLt, 1],
    [M2.paxSafety, 2],
    [M2.cabinFan, 2],
    ['ac.m2.ac_outlet_plug', 1],
    [M2.dispatchSw, 0],
  ];
  for (const [k, x] of on) v.set(k, x);
}
