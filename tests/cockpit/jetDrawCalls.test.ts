/**
 * Draw-call budget of the six jet cockpits with the moving parts of keypads, breakers, push buttons
 * and annunciator lights instanced (src/cockpit/instancing.ts). Counts are node-side (visible meshes
 * of the built cockpit, one call per material), as in the aircraft render-budget tests.
 *
 * Before instancing (census at this change): M2 580, Longitude 719, G650 1,538, G800 709,
 * Global 6000 1,109, 737-800 1,793. After: 319, 288, 418, 281, 437, 925. Budgets below leave
 * ~20 % headroom for cockpit work in progress; the instanced-part counts prove where the saving is.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import type { CockpitBuildEx } from '../../src/cockpit/CockpitBuilder';
import { makeM2 } from '../aircraft/citation-m2/helpers';
import { buildM2Cockpit } from '../../src/aircraft/citation-m2/cockpit';
import { loadNav, makeB738 } from '../aircraft/b737-800/helpers';
import { buildB738Cockpit } from '../../src/aircraft/b737-800/cockpit';
import { makeRig as makeG6k } from '../aircraft/global6000/helpers';
import { fakeCanvas as fusionCanvas } from '../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../src/aircraft/global6000/cockpit';
import { cockpitRig as g650Rig } from '../aircraft/g650/cockpit-main/rig';
import { cockpitRig as g800Rig } from '../aircraft/g800/cockpit-main/rig';
import { makeRig as makeLon } from '../aircraft/citation-longitude/helpers';
import { buildLongitudeCockpit } from '../../src/aircraft/citation-longitude/cockpit';

function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

function check(name: string, build: CockpitBuildEx, budget: number, minSaved: number): void {
  const n = drawCalls(build.root as THREE.Object3D);
  const st = build.movingStats!;
  process.stdout.write(`${name}: ${n} draw calls; ${st.parts} moving parts in ${st.batches} instanced batches\n`);
  expect(st).toBeTruthy();
  expect(st.parts - st.batches).toBeGreaterThanOrEqual(minSaved);
  expect(n).toBeLessThan(budget);
}

describe('jet cockpit draw calls with instanced moving parts', () => {
  it('Citation M2', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    check('M2', buildM2Cockpit(r.ctx).build as CockpitBuildEx, 400, 220);
  }, 120_000);
  it('Citation Longitude', () => {
    const r = makeLon('ready_to_taxi', { avionics: false });
    check('Longitude', buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true }).build as CockpitBuildEx, 380, 320);
  }, 120_000);
  it('G650', async () => {
    const { ck } = await g650Rig('ready_to_taxi', false);
    check('G650', ck.build as CockpitBuildEx, 520, 900);
  }, 120_000);
  it('G800', async () => {
    const { ck } = await g800Rig('ready_to_taxi', false);
    check('G800', ck.build as CockpitBuildEx, 360, 300);
  }, 120_000);
  it('Global 6000', () => {
    const r = makeG6k('ready_to_taxi', { avionics: true });
    check('Global 6000', buildG6kCockpit(r.ctx, r.sys, { canvas: fusionCanvas() }).build as CockpitBuildEx, 540, 580);
  }, 120_000);
  it('737-800', async () => {
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    check('737-800', buildB738Cockpit(r.ctx, r.sys, { headless: true }).build as CockpitBuildEx, 1_100, 780);
  }, 120_000);
});
