/**
 * Every engraved legend in the Longitude cockpit is visible: no opaque surface
 * lies within 3 mm in front of a label (a panel skin or body that is coplanar
 * with the plate hides the transparent label meshes behind it).
 *
 * Regression for the check-ride visual pass: the pedestal body top was
 * coplanar with the control plate and hid FUEL, BOOST, HYDRAULICS, SPEED
 * BRAKE, FLAPS...; the GMC NOSE DN legend sat under the glareshield lip.
 *
 * Allowed: switch hardware (steel nuts / bushings) over the centre of a
 * toggle's middle-position legend (shared ToggleSwitch layout; the legend
 * extends beyond the nut and stays readable).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeRig } from '../helpers';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { LabelFactory } from '../../../../src/cockpit/labels';

describe('Citation Longitude cockpit legends', () => {
  it('no opaque surface covers an engraved legend', { timeout: 120_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const labels: THREE.Mesh[] = [];
    const orig = LabelFactory.prototype.text;
    LabelFactory.prototype.text = function (this: LabelFactory, ...a: Parameters<LabelFactory['text']>) {
      const m = orig.apply(this, a);
      labels.push(m);
      return m;
    };
    let build;
    try {
      build = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true }).build;
    } finally {
      LabelFactory.prototype.text = orig;
    }
    build.root.updateMatrixWorld(true);
    const opaque: THREE.Object3D[] = [];
    build.root.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh && m.visible && !(m.material as THREE.Material).transparent) opaque.push(m);
    });
    expect(labels.length).toBeGreaterThan(300);
    const covered: string[] = [];
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const rc = new THREE.Raycaster();
    for (const l of labels) {
      // Labels merged into static batches keep their last world matrix.
      p.setFromMatrixPosition(l.matrixWorld);
      n.set(0, 0, 1).transformDirection(l.matrixWorld);
      rc.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
      rc.far = 0.05;
      const hit = rc.intersectObjects(opaque, false).find((h) => h.distance > 0.047 && h.distance < 0.04985);
      if (!hit) continue;
      const mat = (hit.object as THREE.Mesh).material as THREE.Material;
      if (mat.name === 'cockpit.steel') continue;
      covered.push(`${l.name} under ${hit.object.name} (${mat.name}) ${(0.05 - hit.distance) * 1000} mm`);
    }
    expect(covered).toEqual([]);
  });
});
