/**
 * Citation Longitude exterior: dimensions against the FPG three-view data and
 * animation from SimVars (gear, flaps, spoilers, lights).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../../src/core/SimVars';
import { createLongitudeExterior } from '../../../../src/aircraft/citation-longitude/exterior';

/** Bounding box of the airframe meshes (lamp halo sprites excluded). */
function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh) b.expandByObject(c, false);
  });
  return b;
}

describe('Citation Longitude exterior', () => {
  it('matches the FPG length, span and height', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createLongitudeExterior(vars);
    ex.update(1 / 60);
    const b = box(ex.root);
    // Local frame: x right (span), y up, z aft (length). FPG p.2: 22.30 m long, 21.00 m span, 5.92 m high.
    expect(b.max.z - b.min.z).toBeGreaterThan(22.0);
    expect(b.max.z - b.min.z).toBeLessThan(22.6);
    expect(b.max.x - b.min.x).toBeGreaterThan(20.6);
    expect(b.max.x - b.min.x).toBeLessThan(21.4);
    // Ground is 1.76 m below the datum with static strut compression (fdm.ts GEAR_Z 1.88 - 0.12).
    expect(b.max.y + 1.76).toBeGreaterThan(5.7);
    expect(b.max.y + 1.76).toBeLessThan(6.1);
    ex.dispose();
  });

  it('animates gear, flaps, spoilers and lights from the vars', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createLongitudeExterior(vars);
    ex.update(1 / 60);
    const leg = ex.root.getObjectByName('gear1')!;
    const flap = ex.root.getObjectByName('flapR_hinge')!;
    const spl = ex.root.getObjectByName('spl2R_hinge')!;
    const q0 = leg.quaternion.clone();
    const f0 = flap.quaternion.clone();
    const s0 = spl.quaternion.clone();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 0);
    vars.set('surf.flaps_deg', 35);
    vars.set('surf.spoiler_right', 1);
    vars.set('light.nav', 1);
    ex.update(1 / 60);
    expect(leg.quaternion.angleTo(q0)).toBeGreaterThan(1.3);
    expect(flap.quaternion.angleTo(f0)).toBeCloseTo((35 * Math.PI) / 180, 2);
    expect(spl.quaternion.angleTo(s0)).toBeCloseTo((35 * Math.PI) / 180, 2);
    const halos = [] as THREE.SpriteMaterial[];
    ex.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) halos.push((o as THREE.Sprite).material);
    });
    expect(halos.filter((m) => m.opacity > 0.9).length).toBeGreaterThanOrEqual(3); // L / R / tail position lights
    ex.dispose();
  });
});
