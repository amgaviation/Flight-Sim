/**
 * Gulfstream G650 exterior: dimensions against the GAC figures and animation
 * from SimVars (gear, flaps, spoilers, stabilizer, reversers, door, lights).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../../src/core/SimVars';
import { createG650Exterior } from '../../../../src/aircraft/g650/exterior';

/** Bounding box of the airframe meshes (lamp halo sprites and instanced windows excluded). */
function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh) b.expandByObject(c, false);
  });
  return b;
}

describe('G650 exterior', () => {
  it('matches the GAC length, span and height', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createG650Exterior(vars);
    ex.update(1 / 60);
    const b = box(ex.root);
    // Local frame: x right (span), y up, z aft (length). GAC: 30.41 m long, 30.36 m span, 7.82 m high.
    expect(b.max.z - b.min.z).toBeGreaterThan(30.0);
    expect(b.max.z - b.min.z).toBeLessThan(30.8);
    expect(b.max.x - b.min.x).toBeGreaterThan(29.8);
    expect(b.max.x - b.min.x).toBeLessThan(30.9);
    // Ground is 2.35 m below the datum with static strut compression (fdm.ts GEAR_Z 2.47 - 0.12).
    expect(b.max.y + 2.35).toBeGreaterThan(7.5);
    expect(b.max.y + 2.35).toBeLessThan(8.1);
    // Wheels reach the ground (fdm contact at z 2.47 with the struts extended).
    expect(-b.min.y).toBeGreaterThan(2.4);
    expect(-b.min.y).toBeLessThan(2.55);
    ex.dispose();
  });

  it('animates gear, flaps, spoilers, stabilizer, reversers, main door and lights from the vars', () => {
    const vars = new SimVars();
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 1);
    const ex = createG650Exterior(vars);
    ex.update(1 / 60);
    const get = (n: string) => ex.root.getObjectByName(n)!;
    const leg = get('gear1');
    const flap = get('flapR_hinge');
    const spl = get('splOutR_hinge');
    const stab = get('stabilizer');
    const door = get('main_door_hinge');
    const q = (o: THREE.Object3D) => o.quaternion.clone();
    const [q0, f0, s0, st0, d0] = [q(leg), q(flap), q(spl), q(stab), q(door)];
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, 0);
    vars.set('surf.flaps_deg', 39);
    vars.set('surf.spoiler_right', 1);
    vars.set('surf.pitch_trim', 0.6);
    vars.set('eng1.reverser_pos', 1);
    vars.set('ac.door.main', 1);
    vars.set('light.nav', 1);
    ex.update(1 / 60);
    expect(leg.quaternion.angleTo(q0)).toBeGreaterThan(1.3);
    expect(flap.quaternion.angleTo(f0)).toBeCloseTo((39 * Math.PI) / 180, 2);
    expect(spl.quaternion.angleTo(s0)).toBeCloseTo((55 * Math.PI) / 180, 2);
    expect(stab.quaternion.angleTo(st0)).toBeCloseTo((3 * Math.PI) / 180, 2);
    expect(door.quaternion.angleTo(d0)).toBeGreaterThan(1.4);
    const halos: THREE.SpriteMaterial[] = [];
    ex.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) halos.push((o as THREE.Sprite).material);
    });
    expect(halos.filter((m) => m.opacity > 0.9).length).toBeGreaterThanOrEqual(3);
    ex.dispose();
  });
});
