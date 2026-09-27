/**
 * Boeing 737-800 exterior: dimensions against ACAPS D6-58325-6 (39.47 m long,
 * 35.79 m span over the winglets, 12.55 m tail height with the datum 3.2 m
 * above the ground) and animation from SimVars (gear, flaps, slats,
 * spoilers, reversers, lights).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../../src/core/SimVars';
import { createB738Exterior } from '../../../../src/aircraft/b737-800/exterior';

function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh && c.name !== 'lamp') b.expandByObject(c, false);
  });
  return b;
}

describe('Boeing 737-800 exterior', () => {
  it('matches the ACAPS length, span and tail height', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createB738Exterior(vars);
    ex.update(1 / 60);
    const b = box(ex.root);
    // Local frame: x right (span), y up, z aft (length).
    expect(b.max.z - b.min.z).toBeGreaterThan(39.2);
    expect(b.max.z - b.min.z).toBeLessThan(39.8);
    expect(b.max.x - b.min.x).toBeGreaterThan(35.3);
    expect(b.max.x - b.min.x).toBeLessThan(36.3);
    // Tail height above the ground (datum 3.2 m above the ground, fdm.ts).
    expect(b.max.y + 3.2).toBeGreaterThan(12.3);
    expect(b.max.y + 3.2).toBeLessThan(12.8);
    ex.dispose();
  });

  it('animates gear, flaps, slats, spoilers, reversers and lights from the vars', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createB738Exterior(vars);
    ex.update(1 / 60);
    const leg = ex.root.getObjectByName('gear1')!;
    const flap = ex.root.getObjectByName('flapOutR_hinge')!;
    const slat = ex.root.getObjectByName('slatR_hinge')!;
    const spl = ex.root.getObjectByName('splGndR_hinge')!;
    const sleeve = ex.root.getObjectByName('rev_sleeve')!;
    const q0 = leg.quaternion.clone();
    const f0 = flap.quaternion.clone();
    const fp0 = flap.position.clone();
    const sp0 = slat.position.clone();
    const s0 = spl.quaternion.clone();
    const z0 = sleeve.position.z;
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 0);
    vars.set('surf.flaps_deg', 30);
    vars.set('surf.slats', 1);
    vars.set('surf.ground_spoilers', 1);
    vars.set('eng1.reverser_pos', 1);
    vars.set('eng2.reverser_pos', 1);
    vars.set('light.nav', 1);
    vars.set('light.beacon', 1);
    ex.update(1 / 60);
    expect(leg.quaternion.angleTo(q0)).toBeGreaterThan(1.4);
    expect(flap.quaternion.angleTo(f0)).toBeCloseTo((30 * Math.PI) / 180, 2);
    expect(flap.position.distanceTo(fp0)).toBeGreaterThan(0.5); // Fowler travel
    expect(slat.position.distanceTo(sp0)).toBeGreaterThan(0.3);
    expect(spl.quaternion.angleTo(s0)).toBeCloseTo((60 * Math.PI) / 180, 2);
    expect(sleeve.position.z - z0).toBeCloseTo(0.55, 2);
    const halos: THREE.SpriteMaterial[] = [];
    ex.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) halos.push((o as THREE.Sprite).material);
    });
    // Four position lights (red, green, two white aft) + the upper beacon.
    expect(halos.filter((m) => m.opacity > 0.9).length).toBeGreaterThanOrEqual(5);
    ex.dispose();
  });
});
