/**
 * G800 side-console geometry regression: the outboard console panels (tiller, O2 mask box, regulator,
 * O2 FLOW lamp and their backlit legends) must stand proud of the console body top the main cockpit
 * builds at CONSOLE.topZ, otherwise the body covers the flat legends and the lamp.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONSOLE } from '../../../../src/aircraft/g800/cockpit/layout';
import { fullCockpit } from './util';

describe('G800 side consoles: geometry', () => {
  it('both console panel faces sit above the console body top (body z down)', { timeout: 180_000 }, async () => {
    const { build } = await fullCockpit('ready_to_taxi');
    build.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const name of ['panel:g800.side_l', 'panel:g800.side_r']) {
      const g = build.root.getObjectByName(name);
      expect(g, name).toBeTruthy();
      // Body frame: the cockpit root is at the body origin with no rotation, so world z = body z.
      g!.getWorldPosition(p);
      expect(p.z, name).toBeLessThan(CONSOLE.topZ - 0.004);
    }
  });
});
