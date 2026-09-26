/**
 * Cockpit shell for the test jet: sidewalls, floor, headliner, aft bulkhead
 * and window frames (A/B pillars, windshield centre post) around the demo
 * panel, lofted from the same fuselage cross-sections as the exterior
 * (inset 5 cm). Window openings are left open (the world is seen through
 * them); the shell casts sun shadows into the cockpit (CockpitShadows).
 */
import * as THREE from 'three';
import type { CockpitMaterials } from '../../cockpit/materials';
import { bl } from '../../cockpit/frame';
import { loftFuselage } from './loft';
import { TEST_FUSELAGE, NOSE_SPLIT_X } from './exterior';

/** Angular window limits (rad, 0 = top): side windows between the roof edge and the sill. */
export const ROOF_T = 0.55;
export const SILL_T = 1.36;
export const WS_T = 0.95;
const X_AFT = 3.55;
/** Windshield frame (A-pillar ring) station; the windshield slopes from here down to the glareshield. */
export const X_A = 4.62;
/** Side window posts. */
export const X_B = 4.25;
export const X_WIN_AFT = 3.92;
const INSET = 0.05;

export function createCockpitShell(mats: CockpitMaterials): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'cockpit_shell';
  const geos: THREE.BufferGeometry[] = [];
  const wall = mats.get('interior');
  const head = mats.get('headliner');
  const frame = mats.get('frame');
  const carpet = mats.get('carpet');
  const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    geos.push(g);
    const me = new THREE.Mesh(g, m);
    me.name = name;
    me.castShadow = true;
    me.receiveShadow = true;
    group.add(me);
    return me;
  };
  const P = TEST_FUSELAGE;
  const TWO_PI = 2 * Math.PI;
  const inward = { inset: INSET, inward: true };
  // Lower walls and belly (below the side-window sill), aft bulkhead to the windshield base.
  add(loftFuselage(P, X_AFT, NOSE_SPLIT_X, SILL_T, TWO_PI - SILL_T, 24, 28, inward), wall, 'lower_walls');
  // Headliner between the side windows.
  add(loftFuselage(P, X_AFT, X_A, -ROOF_T, ROOF_T, 18, 12, inward), head, 'headliner');
  // Below the windshield side panels (windshield glass spans +-WS_T).
  add(loftFuselage(P, X_A, NOSE_SPLIT_X, WS_T, SILL_T, 6, 3, inward), wall, 'ws_side_r');
  add(loftFuselage(P, X_A, NOSE_SPLIT_X, TWO_PI - SILL_T, TWO_PI - WS_T, 6, 3, inward), wall, 'ws_side_l');
  // Solid wall aft of the side windows.
  add(loftFuselage(P, X_AFT, X_WIN_AFT, ROOF_T, SILL_T, 4, 6, inward), wall, 'aft_wall_r');
  add(loftFuselage(P, X_AFT, X_WIN_AFT, -SILL_T, -ROOF_T, 4, 6, inward), wall, 'aft_wall_l');
  // Window frames: A-pillar ring, B-pillars, windshield centre post.
  const frameInset = { inset: INSET - 0.012, inward: true };
  add(loftFuselage(P, X_A - 0.06, X_A, -SILL_T, SILL_T, 2, 24, frameInset), frame, 'a_pillar');
  add(loftFuselage(P, X_B - 0.06, X_B, ROOF_T, SILL_T, 2, 6, frameInset), frame, 'b_pillar_r');
  add(loftFuselage(P, X_B - 0.06, X_B, -SILL_T, -ROOF_T, 2, 6, frameInset), frame, 'b_pillar_l');
  add(loftFuselage(P, X_A, NOSE_SPLIT_X - 0.01, -0.035, 0.035, 8, 2, frameInset), frame, 'center_post');
  add(loftFuselage(P, X_WIN_AFT - 0.06, X_WIN_AFT, ROOF_T, SILL_T, 2, 6, frameInset), frame, 'aft_frame_r');
  add(loftFuselage(P, X_WIN_AFT - 0.06, X_WIN_AFT, -SILL_T, -ROOF_T, 2, 6, frameInset), frame, 'aft_frame_l');
  // Aft bulkhead (faces forward).
  const s = P.at(X_AFT);
  const bulk = new THREE.CircleGeometry(1, 40);
  bulk.scale(s.ry - INSET, s.rz - INSET, 1);
  bulk.rotateY(Math.PI); // face local -z (forward)
  const bm = add(bulk, wall, 'aft_bulkhead');
  bm.position.copy(bl(X_AFT, 0, s.cz));
  // Cockpit floor (carpet) at the demo panel's floor level (body z = 0.2).
  const floor = new THREE.PlaneGeometry(1.7, NOSE_SPLIT_X - X_AFT + 0.1);
  floor.rotateX(-Math.PI / 2);
  const fm = add(floor, carpet, 'floor');
  fm.position.copy(bl((X_AFT + NOSE_SPLIT_X) / 2, 0, 0.2));
  return {
    group,
    dispose(): void {
      for (const g of geos) g.dispose();
      group.removeFromParent();
    },
  };
}
