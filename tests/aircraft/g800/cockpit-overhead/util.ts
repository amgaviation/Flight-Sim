/**
 * Shared helpers for the G800 overhead / side-console tests: the full cockpit (main + overhead + side) on the
 * headless rig, pointer gestures and a combined cockpit + systems stepper.
 */
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { InitialState } from '../../../../src/aircraft/types';
import { cockpitRig } from '../cockpit-main/rig';

export async function fullCockpit(state: InitialState) {
  const { r, ck } = await cockpitRig(state, false);
  const build = ck.build;
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = <T extends CockpitControl = CockpitControl>(id: string): T => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
  };
  /** Advances the cockpit (controls + hooks) and the systems / FDM together. */
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  return { r, build, ctl, step, byId };
}

export function ptr(c: CockpitControl, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}, target = c.hitTargets[0] ?? c.object): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target, ...mods };
}

export function click(c: CockpitControl, button: 0 | 1 | 2 = 0): void {
  c.onPointerDown?.(ptr(c, button));
  c.onPointerUp?.(ptr(c, button));
}
