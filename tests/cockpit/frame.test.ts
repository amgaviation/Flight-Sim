import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bodyToLocal, localToBody, objectPointToBody, panelBasis, placeOnPanel, placePanel, viewQuaternion } from '../../src/cockpit/frame';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function expectVec(a: THREE.Vector3, b: THREE.Vector3) {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
}

describe('frame conversions', () => {
  it('maps body axes to the Three.js cockpit frame and back', () => {
    const out = new THREE.Vector3();
    expectVec(bodyToLocal(1, 0, 0, out), v(0, 0, -1)); // forward = -z
    expectVec(bodyToLocal(0, 1, 0, out), v(1, 0, 0)); // right = +x
    expectVec(bodyToLocal(0, 0, 1, out), v(0, -1, 0)); // down = -y
    const b = localToBody(bodyToLocal(0.3, -0.4, -1.2, out));
    expect(b[0]).toBeCloseTo(0.3, 12);
    expect(b[1]).toBeCloseTo(-0.4, 12);
    expect(b[2]).toBeCloseTo(-1.2, 12);
  });

  it('builds right-handed panel bases for every facing', () => {
    for (const facing of ['aft', 'up', 'down', 'left', 'right', 'fwd'] as const) {
      const bs = panelBasis({ center_m: [0, 0, 0], facing });
      const n = new THREE.Vector3().crossVectors(bs.u, bs.v);
      expectVec(n, bs.n);
    }
    const main = panelBasis({ center_m: [1, 0, -1], facing: 'aft' });
    expectVec(main.n, v(0, 0, 1)); // toward the pilot (aft)
    expectVec(main.v, v(0, 1, 0)); // labels upright
    expectVec(main.origin, v(0, 1, -1));
    const ovhd = panelBasis({ center_m: [0, 0, 0], facing: 'down' });
    expectVec(ovhd.n, v(0, -1, 0)); // faces down
    expectVec(ovhd.v, v(0, 0, 1)); // label tops toward the tail
    const ped = panelBasis({ center_m: [0, 0, 0], facing: 'up' });
    expectVec(ped.v, v(0, 0, -1)); // label tops toward the nose
  });

  it('positive tilt turns the normal toward the panel +v (main panel faces up toward the eye)', () => {
    const b = panelBasis({ center_m: [0, 0, 0], facing: 'aft', tiltDeg: 10 });
    expect(b.n.y).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 9);
    expect(b.n.z).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 9);
    const y = panelBasis({ center_m: [0, 0, 0], facing: 'aft', yawDeg: 20 });
    expect(y.n.x).toBeGreaterThan(0);
    const r = panelBasis({ center_m: [0, 0, 0], facing: 'aft', rollDeg: 90 });
    expectVec(r.u, v(0, 1, 0));
  });

  it('placePanel + placeOnPanel put a control where expected in body axes', () => {
    const root = new THREE.Group();
    const panel = placePanel(new THREE.Group(), { center_m: [0.8, -0.3, -0.7], facing: 'aft' });
    root.add(panel);
    const ctl = placeOnPanel(new THREE.Object3D(), 0.1, 0.05, { z: 0.01 });
    panel.add(ctl);
    const b = objectPointToBody(ctl, root, null);
    // u = right (+y body), v = up (-z body), n = aft (-x body).
    expect(b[0]).toBeCloseTo(0.8 - 0.01, 9);
    expect(b[1]).toBeCloseTo(-0.3 + 0.1, 9);
    expect(b[2]).toBeCloseTo(-0.7 - 0.05, 9);
  });

  it('viewQuaternion: yaw right looks toward +x, pitch up toward +y', () => {
    const fwd = v(0, 0, -1).applyQuaternion(viewQuaternion(90, 0));
    expectVec(fwd, v(1, 0, 0));
    const up = v(0, 0, -1).applyQuaternion(viewQuaternion(0, 90));
    expectVec(up, v(0, 1, 0));
  });
});
