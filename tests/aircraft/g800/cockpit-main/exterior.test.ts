/**
 * G800 exterior: dimensions against the TCDS (length 30.41 m, span 31.40 m, height 7.78 m) and animation
 * from SimVars (gear, flaps, spoilers, reversers, RAT, lights).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../../src/core/SimVars';
import { createG800Exterior } from '../../../../src/aircraft/g800/exterior';

function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && c.visible && c.parent?.visible !== false) b.expandByObject(c, false);
  });
  return b;
}

describe('G800 exterior', () => {
  it('matches the TCDS length, span and height', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createG800Exterior(vars);
    ex.update(1 / 60);
    const b = box(ex.root);
    // Local frame: x right (span), y up, z aft (length).
    expect(b.max.z - b.min.z).toBeGreaterThan(30.2);
    expect(b.max.z - b.min.z).toBeLessThan(30.6);
    expect(b.max.x - b.min.x).toBeGreaterThan(30.9);
    expect(b.max.x - b.min.x).toBeLessThan(31.8);
    // Ramp 2.88 m below the datum (fdm.ts GEAR_Z 3.02 - 0.14 static deflection); TCDS height 7.78 m.
    expect(b.max.y + 2.88).toBeGreaterThan(7.6);
    expect(b.max.y + 2.88).toBeLessThan(7.95);
    // Gear down: the tyres reach the contact plane (fdm.ts GEAR_Z 3.02 below the datum, struts extended).
    expect(b.min.y).toBeLessThan(-2.95);
    ex.dispose();
  });

  it('animates gear, flaps, spoilers, reversers, RAT and lights from the vars', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createG800Exterior(vars);
    ex.update(1 / 60);
    const leg = ex.root.getObjectByName('gear1')!;
    const flap = ex.root.getObjectByName('flapR_hinge')!;
    const spl = ex.root.getObjectByName('spl2R_hinge')!;
    const q0 = leg.quaternion.clone();
    const f0 = flap.quaternion.clone();
    const s0 = spl.quaternion.clone();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 0);
    vars.set('surf.flaps_deg', 39);
    vars.set('surf.spoiler_right', 30 / 55);
    vars.set('eng1.reverser_pos', 1);
    vars.set('ac.g800.rat_deployed', 1);
    vars.set('light.nav', 1);
    for (let i = 0; i < 180; i++) ex.update(1 / 60);
    expect(leg.quaternion.angleTo(q0)).toBeGreaterThan(1.4);
    expect(flap.quaternion.angleTo(f0)).toBeCloseTo((39 * Math.PI) / 180, 2);
    expect(spl.quaternion.angleTo(s0)).toBeCloseTo((30 * Math.PI) / 180, 2);
    expect(ex.root.getObjectByName('rat')!.visible).toBe(true);
    const sleeve = ex.root.getObjectByName('engine_l')!.children.find((c) => c.children.some((m) => m.name === 'reverser_sleeve'))!;
    expect(sleeve.position.z).toBeGreaterThan(0.4);
    const halos = [] as THREE.SpriteMaterial[];
    ex.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) halos.push((o as THREE.Sprite).material);
    });
    expect(halos.filter((m) => m.opacity > 0.9).length).toBeGreaterThanOrEqual(3);
    ex.dispose();
  });
});
