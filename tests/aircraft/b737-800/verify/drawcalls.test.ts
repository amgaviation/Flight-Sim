/**
 * 737-800 flight deck render budget (docs/modules/cockpit.md §14): after static consolidation the
 * whole cockpit (MIP, glareshield, pedestal, forward / aft overhead, P6 / P18 breaker panels, side
 * consoles, yokes, pedals, seats) draws in ~1,760 calls with every breaker in. Guards against
 * regressions (un-flagged static meshes) and checks the breaker white band is only drawn when a
 * breaker is out.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { loadNav, makeB738 } from '../helpers';
import { buildB738Cockpit } from '../../../../src/aircraft/b737-800/cockpit';

function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

describe('737-800 cockpit render budget', () => {
  it('draws in < 1,850 calls; a pulled breaker shows its white band', async () => {
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true });
    const root = build.root as THREE.Object3D;
    const n0 = drawCalls(root);
    console.log(`cockpit draw calls ${n0}, merge ${JSON.stringify(build.mergeStats)}`);
    expect(n0).toBeLessThan(1850);
    expect(build.mergeStats?.outputMeshes ?? 0).toBeGreaterThan(0);
    r.vars.set('cb.probe_heat_a', 0);
    build.update?.(0.05);
    expect(drawCalls(root)).toBe(n0 + 1);
    r.vars.set('cb.probe_heat_a', 1);
    build.update?.(0.05);
    expect(drawCalls(root)).toBe(n0);
  });
});
