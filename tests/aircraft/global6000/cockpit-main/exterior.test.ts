/**
 * Global 6000 exterior: dimensions against the SPEC / GXAG three-view data and
 * animation from SimVars (gear, slats, flaps, spoilers, stabilizer, reversers,
 * lights).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../../src/core/SimVars';
import { createG6kExterior } from '../../../../src/aircraft/global6000/exterior';

/** Bounding box of the airframe meshes (lamp halo sprites and instanced windows excluded). */
function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh) b.expandByObject(c, false);
  });
  return b;
}

function gearDown(): SimVars {
  const vars = new SimVars();
  for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
  vars.set('trim.pitch_units', 7);
  return vars;
}

describe('Global 6000 exterior', () => {
  it('matches the published length, span and height; gear on the ground plane', () => {
    const ex = createG6kExterior(gearDown());
    ex.update(1 / 60);
    const b = box(ex.root);
    // Local frame: x right (span), y up, z aft (length). SPEC: 30.30 m long, 28.65 m span, 7.77 m high.
    expect(b.max.z - b.min.z).toBeGreaterThan(29.9);
    expect(b.max.z - b.min.z).toBeLessThan(30.7);
    expect(b.max.x - b.min.x).toBeGreaterThan(28.3);
    expect(b.max.x - b.min.x).toBeLessThan(29.0);
    // Ground is ~2.12 m below the datum with static strut compression (fdm.ts GEAR_Z 2.25 - 0.13).
    expect(b.max.y + 2.12).toBeGreaterThan(7.55);
    expect(b.max.y + 2.12).toBeLessThan(8.0);
    for (const n of ['gear0', 'gear1', 'gear2']) {
      const g = new THREE.Box3().setFromObject(ex.root.getObjectByName(n)!);
      // Tyres reach the extended contact height (GEAR_Z 2.25 m below the datum = local y -2.25).
      expect(g.min.y, n).toBeLessThan(-2.2);
      expect(g.min.y, n).toBeGreaterThan(-2.3);
    }
    ex.dispose();
  });

  it('animates gear, slats, flaps, spoilers, stabilizer, reversers and lights from the vars', () => {
    const vars = gearDown();
    const ex = createG6kExterior(vars);
    ex.update(1 / 60);
    const get = (n: string) => ex.root.getObjectByName(n)!;
    const leg = get('gear1');
    const flap = get('flapR_hinge');
    const slat = get('slatR_hinge');
    const mfs = get('mfsR_hinge');
    const stab = get('stabilizer');
    const q0 = leg.quaternion.clone();
    const f0 = flap.quaternion.clone();
    const fp0 = flap.position.clone();
    const sp0 = slat.position.clone();
    const m0 = mfs.quaternion.clone();
    const st0 = stab.rotation.x;
    const rev = get('engine_l').children.filter((c) => c.type === 'Group')[1];
    const r0 = rev.rotation.x;
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 0);
    vars.set('surf.flaps_deg', 30);
    vars.set('surf.slats', 1);
    vars.set('surf.spoiler_right', 1);
    vars.set('trim.pitch_units', 12);
    vars.set('eng1.reverser_pos', 1);
    vars.set('light.nav', 1);
    ex.update(1 / 60);
    expect(leg.quaternion.angleTo(q0)).toBeGreaterThan(1.4);
    expect(flap.quaternion.angleTo(f0)).toBeCloseTo((30 * Math.PI) / 180, 2);
    expect(flap.position.distanceTo(fp0)).toBeGreaterThan(0.3); // Fowler travel aft
    expect(slat.position.distanceTo(sp0)).toBeGreaterThan(0.15);
    expect(mfs.quaternion.angleTo(m0)).toBeCloseTo((40 * Math.PI) / 180, 2);
    expect(Math.abs(stab.rotation.x - st0)).toBeCloseTo((5 * Math.PI) / 180, 3);
    expect(Math.abs(rev.rotation.x - r0)).toBeGreaterThan(0.5);
    const halos: THREE.SpriteMaterial[] = [];
    ex.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) halos.push((o as THREE.Sprite).material);
    });
    expect(halos.filter((m) => m.opacity > 0.9).length).toBeGreaterThanOrEqual(3); // L / R / tail position lights
    ex.dispose();
  });
});
