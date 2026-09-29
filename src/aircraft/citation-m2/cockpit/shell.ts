/**
 * Citation M2 flight-deck shell: sidewalls, headliner, windshield frame
 * (centre post, header, A-pillars), side-window frames, floor, aft
 * bulkhead, glareshield hood, crew seats. Lofted from the exterior's
 * fuselage profile (exterior.ts M2_FUSELAGE) inset by the skin/lining
 * thickness, so the window openings coincide with the exterior glazing.
 *
 * Finish (S&D15 §14 / Figure III and S&D21 Figure 3 photographs): black
 * glareshield (crackle), charcoal panel, light greige sidewall and headliner
 * linings; the windshield centre post, A-pillars and header trim are the same
 * light grey / beige as the lining (only the glareshield and lower panels are
 * black); dark carpet, light leather crew seats.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { bl } from '../../../cockpit/frame';
import { floorGeometry } from '../../../cockpit/geometry/structure';
import { roundedBox, transform, merge } from '../../../cockpit/geometry/primitives';
import {
  M2_FUSELAGE,
  loftSkin,
  fixedRange,
  windshieldHalfAngle,
  WS_BASE_X,
  WS_TOP_X,
  SIDE_WIN_AFT_X,
  SIDE_WIN_FWD_X,
  SIDE_WIN_TOP_T,
  SIDE_WIN_SILL_T,
} from '../exterior';
import { FLOOR_AFT_X, FLOOR_Z, GLARE, SEAT } from './layout';
import { hoodGeometry } from './fit';

/**
 * Crew-seat armrest fit (M2-NEW-01): raised, shortened and shifted aft, with no
 * forward support posts (fold-down armrests), so the inboard armrests clear the
 * reduced-size pedestal (pin1 / S&D21 Fig 3 photographs: the armrests pass above
 * the low aft console and end short of the throttle quadrant). EST dimensions;
 * verified geometrically by tests/aircraft/citation-m2/fixround2.test.ts.
 */
export const M2_SEAT_ARMREST = { raise_m: 0.03, length_m: 0.28, aft_m: 0.1, post: false } as const;

/** Lining inset from the outer skin (m): skin, frames and insulation (EST). */
const INSET = 0.045;
const TWO_PI = 2 * Math.PI;

export function buildShell(b: CockpitBuilder): void {
  const mats = b.env.materials;
  const P = M2_FUSELAGE;
  const wall = mats.custom('plastic', '#9d978c', 0.75); // EST: greige lining (photograph)
  const head = mats.custom('plastic', '#b3ada2', 0.8); // EST: light greige headliner (photographs; the stock tint read olive in shadow)
  const frame = mats.custom('plastic', '#a9a397', 0.65); // light grey / beige post, pillar and header trim (M2-L38)
  const lower = mats.custom('plastic', '#3a3b3d', 0.7); // lower sidewall / kick panels
  const inward = { inset: INSET, inward: true };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string, occluder = true) => {
    const me = b.structureMesh(g, m, undefined, undefined, occluder);
    me.name = name;
    return me;
  };
  const SILL = SIDE_WIN_SILL_T;
  const TOP = SIDE_WIN_TOP_T;
  // Lower walls and floor pan below the side-window sill, aft bulkhead station to the nose.
  add(loftSkin(P, FLOOR_AFT_X, WS_BASE_X + 0.06, fixedRange(SILL, TWO_PI - SILL), 30, 30, inward), lower, 'lower_walls');
  // Headliner.
  add(loftSkin(P, FLOOR_AFT_X, WS_TOP_X, fixedRange(-TOP, TOP), 16, 12, inward), head, 'headliner');
  for (const s of [1, -1]) {
    const r = (a: number, c: number): [number, number] => (s > 0 ? [a, c] : [-c, -a]);
    // Wall aft of the side window, and the window post between the side window and the windshield.
    add(loftSkin(P, FLOOR_AFT_X, SIDE_WIN_AFT_X, fixedRange(...r(TOP, SILL)), 4, 8, inward), wall, 'aft_wall');
    add(loftSkin(P, SIDE_WIN_FWD_X, WS_TOP_X + 0.005, fixedRange(...r(TOP - 0.02, SILL)), 3, 8, inward), frame, 'a_post');
    // Side wall under the windshield (between its lower edge and the sill line).
    add(
      loftSkin(P, WS_TOP_X, WS_BASE_X + 0.06, (x) => {
        const t = windshieldHalfAngle(x, INSET);
        return s > 0 ? [Math.max(0.02, t - 0.03), SILL] : [-SILL, -Math.max(0.02, t - 0.03)];
      }, 12, 10, inward),
      lower,
      'ws_side_wall',
    );
    // Window frames: A-pillar strip along the windshield's side edge, side-window sill and header.
    add(
      loftSkin(P, WS_TOP_X - 0.01, WS_BASE_X, (x) => {
        const t = windshieldHalfAngle(x, INSET);
        return s > 0 ? [Math.max(0, t - 0.06), t + 0.005] : [-t - 0.005, -Math.max(0, t - 0.06)];
      }, 16, 2, { inset: INSET - 0.012, inward: true }),
      frame,
      'a_pillar',
    );
    add(loftSkin(P, SIDE_WIN_AFT_X - 0.04, SIDE_WIN_FWD_X + 0.04, fixedRange(...r(SILL - 0.03, SILL + 0.02)), 6, 2, { inset: INSET - 0.012, inward: true }), frame, 'side_sill');
    add(loftSkin(P, SIDE_WIN_AFT_X - 0.04, SIDE_WIN_FWD_X + 0.04, fixedRange(...r(TOP - 0.03, TOP + 0.02)), 6, 2, { inset: INSET - 0.012, inward: true }), frame, 'side_header');
    add(loftSkin(P, SIDE_WIN_AFT_X - 0.05, SIDE_WIN_AFT_X, fixedRange(...r(TOP - 0.03, SILL + 0.02)), 2, 6, { inset: INSET - 0.012, inward: true }), frame, 'side_aft_frame');
  }
  // Windshield header and centre post (two-piece windshield, S&D15 §9.7 "windshields").
  add(loftSkin(P, WS_TOP_X - 0.04, WS_TOP_X + 0.03, fixedRange(-0.97, 0.97), 3, 20, { inset: INSET - 0.012, inward: true }), frame, 'ws_header');
  add(loftSkin(P, WS_TOP_X, WS_BASE_X - 0.02, fixedRange(-0.022, 0.022), 12, 2, { inset: INSET - 0.014, inward: true }), frame, 'ws_centre_post');
  // Faint cockpit glazing (seen as a slight reflection; pick() ignores transparent glass).
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb4c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
  mats.track(glass);
  const ws = add(
    loftSkin(P, WS_TOP_X, WS_BASE_X, (x) => {
      const t = windshieldHalfAngle(x, INSET * 0.3);
      return [-t, t];
    }, 10, 16, { inset: 0.01, inward: true }),
    glass,
    'windshield_glass',
    false,
  );
  ws.castShadow = false;
  ws.renderOrder = 2;

  // Floor (carpet) and the aft bulkhead / cabin divider (EST: partial divider behind the crew seats).
  const fl = add(floorGeometry(1.3, WS_BASE_X - FLOOR_AFT_X + 0.1), mats.get('carpet'), 'floor');
  fl.position.copy(bl((FLOOR_AFT_X + WS_BASE_X) / 2, 0, FLOOR_Z));
  {
    const parts: THREE.BufferGeometry[] = [];
    // Two cabinet walls behind the seats, open aisle in the middle (local frame: x right, y up, z aft).
    for (const s of [1, -1]) {
      const g = roundedBox(0.42, 1.35, 0.05, 0.01, 2);
      transform(g, s * 0.5, 0.6, 0);
      parts.push(g);
    }
    const g = merge(parts);
    for (const p of parts) p.dispose();
    const m = add(g, wall, 'aft_divider');
    m.position.copy(bl(FLOOR_AFT_X + 0.02, 0, FLOOR_Z));
  }

  // Glareshield hood (black crackle): a plan-view arc, deepest at the centre, drooping forward to the windshield
  // base and clamped to the lining so it runs into the side-window posts (fit.ts, M2-L12).
  add(hoodGeometry({ browX: GLARE.browX, browZ: GLARE.browZ, halfSpan: GLARE.width / 2 + 0.05, arc: 0.07, lip: 0.014, slopeDeg: -GLARE.pitchDeg }), mats.get('glareshield'), 'glareshield');

  // Crew seats (bizjet style, sunk so the cushion is 0.36 m above the floor; EST photograph: light leather / sheepskin).
  for (const s of [-1, 1]) b.seat('bizjet', [SEAT.x, s * SEAT.y, SEAT.z], undefined, { armrest: M2_SEAT_ARMREST });
}
