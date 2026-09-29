/**
 * Fix round 2 regression tests (layout lens): geometric checks that fail
 * without the round-2 fixes.
 *
 *  - M2-L36: tall ram's-horn control wheels (S&D15 Fig III / S&D21 Fig 3
 *    photographs): the grip-top switch anchors sit well above the hub, higher
 *    than the generic bizjet M-wheel profile they replaced.
 *  - M2-NEW-01: the crew seats' inboard armrests clear the reduced-size
 *    pedestal (photographs: armrests pass above the low aft console and end
 *    short of the throttle quadrant's lever zone).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeM2 } from './helpers';
import { buildM2Cockpit } from '../../../src/aircraft/citation-m2/cockpit';
import { M2_SEAT_ARMREST } from '../../../src/aircraft/citation-m2/cockpit/shell';
import { seatGeometry } from '../../../src/cockpit/geometry/structure';
import { FLOOR_Z, PEDESTAL, SEAT } from '../../../src/aircraft/citation-m2/cockpit/layout';

describe('M2 fix round 2 (layout)', () => {
  const rig = makeM2({ state: 'ready_to_taxi' });
  const ck = buildM2Cockpit(rig.ctx);
  const root = ck.build.root as THREE.Object3D;
  root.updateMatrixWorld(true);

  it('M2-L36: yokes have tall ram\'s-horn grips', () => {
    for (const side of [1, 2]) {
      const yoke = ck.build.controls.find((c) => c.id === `m2.yoke${side}`);
      expect(yoke, `m2.yoke${side}`).toBeTruthy();
      const top = yoke!.object.getObjectByName('yokeAnchor:leftTop');
      expect(top, 'grip-top anchor').toBeTruthy();
      // Wheel-local y of the grip top above the hub centre: the default bizjet profile puts it at
      // 0.085 * 1.05 + r * 0.9 = 0.103 m; the M2 ram's-horn profile at 0.12 * 1.05 + r * 0.9 = 0.140 m.
      expect(top!.position.y).toBeGreaterThan(0.12);
    }
  });

  it('M2-NEW-01: inboard seat armrests clear the pedestal', () => {
    // The built cockpit consolidates static meshes, so probe the seat geometry with the exact
    // armrest options the shell passes (M2_SEAT_ARMREST) and place it as shell.ts does.
    const parts = seatGeometry('bizjet', 0, { armrest: M2_SEAT_ARMREST });
    // Pedestal quadrant deck height above the floor (pedestal.ts profile: panel faces 4 mm below H(z)).
    const deckTop = FLOOR_Z - PEDESTAL.quadrantZ; // 0.49 m
    // The throttle / flap / speed-brake lever zone starts at the quadrant's aft edge plus a margin.
    const leverZoneX = PEDESTAL.quadrantAftX + 0.15;
    const sink = SEAT.z - FLOOR_Z; // seat origin sunk below the floor line (shell.ts)
    const v = new THREE.Vector3();
    let armMinH = Infinity; // lowest armrest / post vertex height above the floor
    let armMaxX = -Infinity; // most forward armrest vertex (body x)
    let n = 0;
    const pos = parts.frame.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Seat local (x right, y up, z aft) -> body: x = SEAT.x - z, height above floor = y - sink.
      const bodyX = SEAT.x - v.z;
      const h = v.y - sink;
      // Armrest / support-post vertices: everything in the frame above the base and rails (base top
      // 0.36 local = 0.25 above the floor).
      if (h > 0.3) {
        n++;
        armMinH = Math.min(armMinH, h);
        armMaxX = Math.max(armMaxX, bodyX);
      }
    }
    for (const g of [parts.frame, parts.cushion, parts.back]) g.dispose();
    expect(n, 'armrest vertices found').toBeGreaterThan(0);
    expect(armMinH, 'armrest bottom above the quadrant deck').toBeGreaterThan(deckTop + 0.01);
    expect(armMaxX, 'armrest ends short of the lever zone').toBeLessThan(leverZoneX);
  });
});
