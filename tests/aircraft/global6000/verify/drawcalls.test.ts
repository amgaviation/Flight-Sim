/**
 * Global 6000 flight deck render budget (docs/modules/cockpit.md §14): the
 * complete cockpit (main panel, glareshield, pedestal, overhead, side panels
 * and consoles, CCBP, yokes, seats) after static consolidation (1,153 calls
 * at this review; the MKP keyboards are the largest unmerged group). Prints the
 * largest remaining (unmerged) mesh groups so a regression is easy to trace.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { makeRig } from '../helpers';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';

function drawCalls(root: THREE.Object3D, byGroup?: Map<string, number>): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const k = Array.isArray(m.material) ? m.material.length : 1;
    n += k;
    if (byGroup) {
      let p: THREE.Object3D | null = o;
      let key = '';
      const chain: string[] = [];
      while (p && p !== root) {
        if (p.name) chain.push(p.name);
        p = p.parent;
      }
      void key;
      const id = chain.slice(-3).reverse().join(' / ').replace(/\d+/g, '#');
      byGroup.set(id, (byGroup.get(id) ?? 0) + k);
    }
  });
  return n;
}

describe('Global 6000 cockpit render budget', () => {
  it('draws the complete flight deck in < 1,200 calls (regression guard)', () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const ck = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
    const root = ck.build.root as THREE.Object3D;
    const groups = new Map<string, number>();
    const n = drawCalls(root, groups);
    const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`draw calls ${n}, merge ${JSON.stringify(ck.build.mergeStats)}\n${top.map(([k, c]) => `  ${String(c).padStart(4)} ${k}`).join('\n')}`);
    // 1,153 at this review: 254 of them are the two Fusion MKP keyboards (one mesh per key cap and legend,
    // src/avionics/collins-fusion/cockpit.ts KeyPad), the static panel parts are consolidated into 56 meshes.
    expect(n).toBeLessThan(1200);
    expect(ck.build.mergeStats?.outputMeshes ?? 0).toBeGreaterThan(0);
  });
});
