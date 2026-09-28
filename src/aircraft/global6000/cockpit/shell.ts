/**
 * Global 6000 flight-deck structure: sidewalls, headliner, windshield and
 * side-window frames lofted from the exterior fuselage sections (inset
 * 45 mm, so the glazing openings line up with the exterior glass), carpeted
 * floor, aft bulkhead with the flight-deck doorway, the glareshield hood
 * (black crackle finish, following the windshield base) with its soffit,
 * the centre pedestal body, knee panels / footwells and the two crew seats.
 *
 * Sources: dossier §10 (EST geometry), layout.ts. Interior finish (Global
 * Vision, photos N835GL / EB190582; AOPA "First look at the Global 6000",
 * 2012: "Leather wraps the pilot seats and sidewalls ... carbon fiber panel
 * inserts"): tan leather sidewalls and pedestal rails, carbon-fibre lower
 * sidewalls, light headliner, black windshield posts and frames, cream crew
 * seats (palette, finish.ts). Shades EST from the photographs.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { floorGeometry, trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { g6kFinish } from './finish';
import { bl } from '../../../cockpit/frame';
import { loftFuselage } from '../../_test/loft';
import { A_PILLAR, FLOOR_Z, G6K_FUSELAGE as F, GLARE_HOOD, MAIN_PANEL, PEDESTAL, SEAT_L, SEAT_R, SIDE_WINDOWS, WINDSHIELD } from './layout';

const INSET = 0.045;
/** Aft bulkhead of the flight deck (EST: ~1.4 m behind the design eye). */
export const X_AFT = 9.45;

/** Interior half-width of the cockpit at body (x, z) (0 when outside the section). */
export function interiorHalfWidth(x: number, z: number, inset = INSET): number {
  const s = F.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const d = (z - s.cz) / rz;
  return d >= 1 || d <= -1 ? 0 : ry * Math.sqrt(1 - d * d);
}

/** Glareshield hood: a crowned shelf from the brow to the windshield base, clipped to the cockpit width, with a rolled brow. */
function glareshieldHood(): THREE.BufferGeometry {
  const nx = 12;
  const ny = 28;
  const pos: number[] = [];
  const idx: number[] = [];
  const h = GLARE_HOOD;
  const v = new THREE.Vector3();
  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const x = h.aftX + (h.frontX - h.aftX) * t;
    const zc = h.topZ + (h.frontZ - h.topZ) * t;
    const w = Math.max(0.05, interiorHalfWidth(x, zc) - 0.004);
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      v.copy(bl(x, f * w, zc - 0.014 * (1 - f * f) * (1 - t)));
      pos.push(v.x, v.y, v.z);
    }
  }
  const row = ny + 1;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  // Brow: rolled lip down the aft edge (quarter round, 28 mm).
  const base = pos.length / 3;
  const segs = 5;
  const R = 0.014; // EST: a tight brow so the FCP readout windows stay visible from the design eye
  const w0 = interiorHalfWidth(h.aftX, h.topZ) - 0.004;
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * (Math.PI / 2);
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      v.copy(bl(h.aftX - R * Math.sin(a), f * w0, h.topZ + R * (1 - Math.cos(a))));
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let k = 0; k < segs; k++)
    for (let j = 0; j < ny; j++) {
      const a = base + k * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 4, pos[i + 2] * 4);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildShell(b: CockpitBuilder): void {
  const m = b.env.materials;
  // Vision finish (finish.ts): tan leather sidewall band, carbon lower walls, light headliner, black frames / posts.
  const fin = g6kFinish(b.env);
  const wall = fin.carbon;
  const leather = fin.tan;
  const head = m.custom('plastic', 0xc9c6c0, 0.8);
  const frame = fin.black;
  const TWO_PI = 2 * Math.PI;
  const inward = { inset: INSET, inward: true };
  const ws = WINDSHIELD;
  const sw = SIDE_WINDOWS;
  const add = (g: THREE.BufferGeometry, mat: THREE.Material | Parameters<typeof m.get>[0], name: string) => {
    const me = b.structureMesh(g, mat, undefined);
    me.name = name;
    return me;
  };
  const noseX = ws.baseX + 0.45;
  // Lower walls and belly below the side-window sill, from the aft bulkhead into the nose.
  add(loftFuselage(F, X_AFT, noseX, sw.sill, TWO_PI - sw.sill, 26, 30, inward), wall, 'lower_walls');
  // Leather sidewall trim band just below the sill (armrest height).
  add(loftFuselage(F, X_AFT, ws.headerX, sw.sill, sw.sill + 0.28, 16, 3, { inset: INSET + 0.006, inward: true }), leather, 'sidewall_leather_r');
  add(loftFuselage(F, X_AFT, ws.headerX, -sw.sill - 0.28, -sw.sill, 16, 3, { inset: INSET + 0.006, inward: true }), leather, 'sidewall_leather_l');
  // Headliner between the side windows, aft bulkhead to the windshield header.
  add(loftFuselage(F, X_AFT, ws.headerX, -sw.roof, sw.roof, 16, 14, inward), head, 'headliner');
  // Walls beside the windshield below the side-pane line (A-pillar to the sill).
  add(loftFuselage(F, ws.headerX, noseX, ws.halfAngle + A_PILLAR, sw.sill, 8, 4, inward), frame, 'ws_side_r');
  add(loftFuselage(F, ws.headerX, noseX, -sw.sill, -ws.halfAngle - A_PILLAR, 8, 4, inward), frame, 'ws_side_l');
  // Nose closure ahead of the windshield base (behind the panel; blocks light leaks).
  add(loftFuselage(F, ws.baseX, noseX, -ws.halfAngle - A_PILLAR, ws.halfAngle + A_PILLAR, 3, 12, inward), wall, 'nose_closure');
  // Solid wall between the aft side window and the bulkhead, and between the side windows and the windshield.
  add(loftFuselage(F, X_AFT, sw.aft.x0, sw.roof, sw.sill, 2, 6, inward), wall, 'aft_wall_r');
  add(loftFuselage(F, X_AFT, sw.aft.x0, -sw.sill, -sw.roof, 2, 6, inward), wall, 'aft_wall_l');
  add(loftFuselage(F, sw.fwd.x1, ws.headerX, sw.roof, sw.sill, 1, 6, inward), frame, 'b_post_r');
  add(loftFuselage(F, sw.fwd.x1, ws.headerX, -sw.sill, -sw.roof, 1, 6, inward), frame, 'b_post_l');
  // Frames: A-pillars, centre post, header, window posts, sills and roof rails (proud of the skin by 14 mm).
  const fi = { inset: INSET - 0.014, inward: true };
  add(loftFuselage(F, ws.headerX, ws.baseX, ws.halfAngle, ws.halfAngle + A_PILLAR, 10, 2, fi), frame, 'a_pillar_r');
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle - A_PILLAR, -ws.halfAngle, 10, 2, fi), frame, 'a_pillar_l');
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.postHalf, ws.postHalf, 10, 2, fi), frame, 'centre_post');
  add(loftFuselage(F, ws.headerX - 0.07, ws.headerX, -ws.halfAngle - A_PILLAR, ws.halfAngle + A_PILLAR, 2, 20, fi), frame, 'ws_header');
  for (const [x0, x1, n] of [
    [sw.aft.x1, sw.fwd.x0, 'mid_post'],
    [sw.aft.x0 - 0.04, sw.aft.x0, 'aft_post'],
  ] as [number, number, string][]) {
    add(loftFuselage(F, x0, x1, sw.roof, sw.sill, 1, 6, fi), frame, `${n}_r`);
    add(loftFuselage(F, x0, x1, -sw.sill, -sw.roof, 1, 6, fi), frame, `${n}_l`);
  }
  add(loftFuselage(F, X_AFT, ws.headerX, sw.sill, sw.sill + 0.05, 18, 1, fi), frame, 'sill_r');
  add(loftFuselage(F, X_AFT, ws.headerX, -sw.sill - 0.05, -sw.sill, 18, 1, fi), frame, 'sill_l');
  add(loftFuselage(F, X_AFT, ws.headerX, sw.roof - 0.04, sw.roof, 18, 1, fi), frame, 'roof_r');
  add(loftFuselage(F, X_AFT, ws.headerX, -sw.roof, -sw.roof + 0.04, 18, 1, fi), frame, 'roof_l');

  // Aft bulkhead (faces forward) with a dark doorway opening to the cabin.
  const s = F.at(X_AFT);
  const bulk = new THREE.CircleGeometry(1, 48);
  bulk.scale(s.ry - INSET, s.rz - INSET, 1);
  bulk.rotateY(Math.PI);
  add(bulk, wall, 'aft_bulkhead').position.copy(bl(X_AFT, 0, s.cz));
  const door = new THREE.PlaneGeometry(0.62, 1.55);
  door.rotateY(Math.PI);
  add(door, 'panelDark', 'doorway').position.copy(bl(X_AFT + 0.004, 0, FLOOR_Z - 0.78));

  // Floor (carpet) from the bulkhead to the rudder-pedal wells.
  const fwdFloor = 11.95;
  add(floorGeometry(2.3, fwdFloor - X_AFT), 'carpet', 'floor').position.copy(bl((X_AFT + fwdFloor) / 2, 0, FLOOR_Z));

  // Glareshield hood (black crackle) and the dark soffit under its brow down to the display tops.
  add(glareshieldHood(), 'glareshield', 'glareshield');
  add(trimBoxGeometry(1.7, 0.012, 0.17), 'panelDark', 'glareshield_soffit').position.copy(bl(11.625, 0, -0.745));

  // Main panel backing box (the panel plate is built by mainPanel.ts; this closes the gap to the nose).
  const mp = MAIN_PANEL;
  const back = trimBoxGeometry(mp.width, mp.height + 0.1, 0.3, 0.01);
  add(back, 'panelDark', 'panel_backing').position.copy(bl(mp.center_m[0] + 0.24, 0, mp.center_m[2])); // front face ahead of the tilted panel's top edge

  // Centre pedestal: steep forward face (AFD 3) and the flat top, extruded side profile; tan-leather side rails on
  // both top edges and down the forward face (photos N835GL / EB190582).
  const P = PEDESTAL;
  const prof = (w: number, lift: number) => {
    const sh = new THREE.Shape();
    // Shape in (body x, -body z); extruded along the width.
    sh.moveTo(P.topAft[0], -FLOOR_Z);
    sh.lineTo(P.topAft[0], -P.topAft[1] + lift);
    sh.lineTo(P.topFwd[0], -P.topFwd[1] + lift);
    sh.lineTo(P.fwdTop[0], -P.fwdTop[1] + lift);
    sh.lineTo(P.fwdTop[0] + 0.12, -P.fwdTop[1] + lift);
    sh.lineTo(P.fwdTop[0] + 0.12, -FLOOR_Z);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    // (x_body, -z_body, e) -> local (x = e, y = -z_body, z = -x_body).
    g.rotateY(Math.PI / 2);
    g.scale(1, 1, 1);
    return g;
  };
  add(prof(P.width, -0.012), 'panelDark', 'pedestal');
  for (const side of [-1, 1]) add(prof(0.022, 0.01), leather, `pedestal_rail_${side < 0 ? 'l' : 'r'}`).position.x = side * (P.width / 2 + 0.011);

  // Knee panels (tan leather) under the main panel either side of the pedestal and the forward footwell bulkheads.
  const kneeTop = -0.34;
  const kneeH = FLOOR_Z - kneeTop;
  for (const side of [-1, 1]) {
    const yIn = P.width / 2 + 0.022;
    const yOut = 0.95;
    const kw = yOut - yIn;
    add(trimBoxGeometry(kw, 0.03, 0.06, 0.008), leather, 'knee_bolster').position.copy(bl(11.62, side * (yIn + kw / 2), kneeTop + 0.015));
    const well = new THREE.PlaneGeometry(kw, kneeH);
    add(well, 'panelDark', 'footwell').position.copy(bl(11.95, side * (yIn + kw / 2), kneeTop + kneeH / 2));
  }

  // Crew seats.
  b.seat('bizjet', SEAT_L);
  b.seat('bizjet', SEAT_R);
}
