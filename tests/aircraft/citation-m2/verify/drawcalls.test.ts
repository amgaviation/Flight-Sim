/**
 * Citation M2 flight deck render budget (docs/modules/cockpit.md §14): after
 * static consolidation the whole cockpit (panels, glareshield, pedestal,
 * overhead fittings, both CB sidewalls, yokes, pedals, seats) draws in
 * about 565 calls with every breaker in (the CB white bands are hidden until
 * a breaker pops; the 36 blank GDU bezel softkeys carry no legend mesh). Guards against regressions (un-flagged static meshes).
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { makeM2 } from '../helpers';
import { buildM2Cockpit } from '../../../../src/aircraft/citation-m2/cockpit';

function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

describe('Citation M2 cockpit render budget', () => {
  it('draws in < 600 calls; a popped breaker shows its white band', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(r.ctx);
    const root = ck.build.root as THREE.Object3D;
    const n0 = drawCalls(root);
    expect(n0).toBeLessThan(600);
    expect(ck.build.mergeStats?.outputMeshes ?? 0).toBeGreaterThan(0);
    // Pull the DME breaker: its band becomes visible (one more draw call) on the next cockpit update.
    r.vars.set('cb.dme', 0);
    ck.build.update?.(0.05);
    expect(drawCalls(root)).toBe(n0 + 1);
    r.vars.set('cb.dme', 1);
    ck.build.update?.(0.05);
    expect(drawCalls(root)).toBe(n0);
  });
});
