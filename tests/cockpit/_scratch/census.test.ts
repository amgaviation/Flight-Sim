import { describe, it } from 'vitest';
import type * as THREE from 'three';
import { makeM2 } from '../../aircraft/citation-m2/helpers';
import { buildM2Cockpit } from '../../../src/aircraft/citation-m2/cockpit';
import { loadNav, makeB738 } from '../../aircraft/b737-800/helpers';
import { buildB738Cockpit } from '../../../src/aircraft/b737-800/cockpit';
import { makeRig as makeG6k } from '../../aircraft/global6000/helpers';
import { fakeCanvas as fusionCanvas } from '../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../src/aircraft/global6000/cockpit';
import { cockpitRig as g650Rig } from '../../aircraft/g650/cockpit-main/rig';
import { cockpitRig as g800Rig } from '../../aircraft/g800/cockpit-main/rig';
import { makeRig as makeLon } from '../../aircraft/citation-longitude/helpers';
import { buildLongitudeCockpit } from '../../../src/aircraft/citation-longitude/cockpit';

function census(name: string, root: THREE.Object3D): void {
  let n = 0;
  const by = new Map<string, number>();
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const k = Array.isArray(m.material) ? m.material.length : 1;
    n += k;
    let p: THREE.Object3D | null = o;
    let cls = m.userData.cockpitMerged ? 'merged' : 'structure';
    while (p) {
      const c = p.userData.control;
      if (c) { cls = c.constructor.name; if (['PushButton','KeyPad','CircuitBreaker','AnnunciatorLight'].includes(cls)) cls += ':' + ((m.material as THREE.Material).name.replace(/\.label\..*/, '.label').replace(/cockpit\./, '')); break; }
      p = p.parent;
    }
    by.set(cls, (by.get(cls) ?? 0) + k);
  });
  process.stdout.write(`${name}: ${n} calls  ${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
}

describe('census', () => {
  it('m2', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    census('m2', buildM2Cockpit(r.ctx).build.root);
  });
  it('b738', async () => {
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    census('b738', buildB738Cockpit(r.ctx, r.sys, { headless: true }).build.root);
  }, 120000);
  it('g6k', () => {
    const r = makeG6k('ready_to_taxi', { avionics: true });
    census('g6k', buildG6kCockpit(r.ctx, r.sys, { canvas: fusionCanvas() }).build.root);
  }, 120000);
  it('g650', async () => {
    const { ck } = await g650Rig('ready_to_taxi', false);
    census('g650', ck.build.root);
  }, 120000);
  it('g800', async () => {
    const { ck } = await g800Rig('ready_to_taxi', false);
    census('g800', ck.build.root);
  }, 120000);
  it('lon', () => {
    const r = makeLon('ready_to_taxi', { avionics: false });
    census('lon', buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true }).build.root);
  }, 120000);
});
