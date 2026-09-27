/**
 * Longitude flight-deck structure: sidewalls, headliner, windshield and
 * side-window frames lofted from the exterior fuselage sections (inset 45 mm,
 * so the glazing openings line up with the exterior glass), carpeted floor,
 * aft bulkhead, the glareshield hood (black crackle finish, following the
 * windshield base), the centre pedestal body, knee/foot-well closures and the
 * two crew seats.
 *
 * Sources: dossier §7.0 (EST geometry), exterior.ts sections. The windshield
 * is two large curved panes with a narrow centre post (dossier §7.0; BCA
 * "large windshields and windows, providing excellent visibility").
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { pedestalGeometry, floorGeometry, trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { bl } from '../../../cockpit/frame';
import { loftFuselage } from '../../_test/loft';
import { LONGITUDE_FUSELAGE as F } from '../exterior';
import { FLOOR_Z, GLARE_HOOD, LOWER_PANEL, PEDESTAL, SEAT_L, SEAT_R, SIDE_WINDOWS, WINDSHIELD } from './layout';
import { lonMaterials } from './context';

const INSET = 0.045;
const X_AFT = 6.88;

/** Interior half-width of the cockpit at body (x, z) (0 when outside the section). */
export function interiorHalfWidth(x: number, z: number, inset = INSET): number {
  const s = F.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const d = (z - s.cz) / rz;
  return d >= 1 || d <= -1 ? 0 : ry * Math.sqrt(1 - d * d);
}

/** Glareshield hood: a gently crowned shelf from the brow to the windshield base, clipped to the cockpit width, with a rolled brow. Cockpit-local geometry. */
function glareshieldHood(): THREE.BufferGeometry {
  const nx = 12;
  const ny = 28;
  const pos: number[] = [];
  const idx: number[] = [];
  const h = GLARE_HOOD;
  const v = new THREE.Vector3();
  // Top surface.
  for (let i = 0; i <= nx; i++) {
    const x = h.aftX + ((h.frontX - h.aftX) * i) / nx;
    const w = interiorHalfWidth(x, h.topZ + (h.frontZ - h.topZ) * (i / nx)) - 0.005;
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      const y = f * w;
      // Slopes down toward the windshield base (over-the-nose line) with a slight crown.
      const z = h.topZ + (h.frontZ - h.topZ) * (i / nx) - 0.012 * (1 - f * f) * (1 - i / nx);
      v.copy(bl(x, y, z));
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
  // Brow: rolled lip down the aft edge (quarter round, 30 mm).
  const base = pos.length / 3;
  const segs = 5;
  const R = 0.03;
  const w0 = interiorHalfWidth(h.aftX, h.topZ) - 0.005;
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * (Math.PI / 2);
    const dx = -R * Math.sin(a); // aft
    const dz = R * (1 - Math.cos(a)); // down
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      v.copy(bl(h.aftX + dx, f * w0, h.topZ + dz));
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
  // Planar UVs in metres for the crackle texture.
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 4, pos[i + 2] * 4);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildShell(b: CockpitBuilder): void {
  const m = b.env.materials;
  const L = lonMaterials(b.env);
  const wall = m.get('interior');
  const head = m.get('headliner');
  // Layout audit L16 (a18_002, c_lcon): below the side-window sill the sidewall, console and CB surround are black;
  // only the upper sidewall and headliner are light grey.
  const lowerWall = L.trim;
  // L53: windshield frames / pillars light grey with a dark inner edge (a18_002, Textron photograph).
  const frame = L.pillar;
  const TWO_PI = 2 * Math.PI;
  const inward = { inset: INSET, inward: true };
  const ws = WINDSHIELD;
  const sw = SIDE_WINDOWS;
  const add = (g: THREE.BufferGeometry, mat: THREE.Material | Parameters<typeof m.get>[0], name: string) => {
    const me = b.structureMesh(g, mat, undefined);
    me.name = name;
    return me;
  };
  // Lower walls and belly below the side-window sill, aft bulkhead to the windshield base and on into the nose.
  add(loftFuselage(F, X_AFT, ws.baseX + 0.4, sw.sill, TWO_PI - sw.sill, 26, 30, inward), lowerWall, 'lower_walls');
  // Headliner between the side windows, aft bulkhead to the windshield header.
  add(loftFuselage(F, X_AFT, ws.headerX, -sw.roof, sw.roof, 16, 14, inward), head, 'headliner');
  // Walls beside the windshield below the side-window line (between the A-pillar and the sill).
  const aPillar = 0.08;
  add(loftFuselage(F, ws.headerX, ws.baseX + 0.4, ws.halfAngle + aPillar, sw.sill, 8, 4, inward), lowerWall, 'ws_side_r');
  add(loftFuselage(F, ws.headerX, ws.baseX + 0.4, -sw.sill, -ws.halfAngle - aPillar, 8, 4, inward), lowerWall, 'ws_side_l');
  // Nose closure ahead of the windshield base (behind the panel; blocks light leaks).
  add(loftFuselage(F, ws.baseX, ws.baseX + 0.4, -ws.halfAngle - aPillar, ws.halfAngle + aPillar, 3, 12, inward), lowerWall, 'nose_closure');
  // Solid wall aft of the side windows.
  add(loftFuselage(F, X_AFT, sw.aft.x0, sw.roof, sw.sill, 2, 6, inward), wall, 'aft_wall_r');
  add(loftFuselage(F, X_AFT, sw.aft.x0, -sw.sill, -sw.roof, 2, 6, inward), wall, 'aft_wall_l');
  // Between the forward side window and the windshield: upper corner blocks.
  add(loftFuselage(F, sw.fwd.x1, ws.headerX, sw.roof, sw.sill, 1, 6, inward), frame, 'b_post_r');
  add(loftFuselage(F, sw.fwd.x1, ws.headerX, -sw.sill, -sw.roof, 1, 6, inward), frame, 'b_post_l');
  // Frames: A-pillars along the windshield side edges, centre post, header, window posts and sills.
  const fi = { inset: INSET - 0.014, inward: true };
  add(loftFuselage(F, ws.headerX, ws.baseX, ws.halfAngle, ws.halfAngle + aPillar, 10, 2, fi), frame, 'a_pillar_r');
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle - aPillar, -ws.halfAngle, 10, 2, fi), frame, 'a_pillar_l');
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.postHalf, ws.postHalf, 10, 2, fi), frame, 'centre_post');
  // Dark inner edge strips along the centre post and the A-pillars' glazed edges (L53).
  const edge = { inset: INSET - 0.016, inward: true };
  const eW = 0.006;
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.postHalf - eW * 0.2, -ws.postHalf + eW, 10, 1, edge), L.trim, 'centre_post_edge_l');
  add(loftFuselage(F, ws.headerX, ws.baseX, ws.postHalf - eW, ws.postHalf + eW * 0.2, 10, 1, edge), L.trim, 'centre_post_edge_r');
  add(loftFuselage(F, ws.headerX, ws.baseX, ws.halfAngle - eW * 0.2, ws.halfAngle + eW, 10, 1, edge), L.trim, 'a_pillar_edge_r');
  add(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle - eW, -ws.halfAngle + eW * 0.2, 10, 1, edge), L.trim, 'a_pillar_edge_l');
  add(loftFuselage(F, ws.headerX - 0.06, ws.headerX, -ws.halfAngle - aPillar, ws.halfAngle + aPillar, 2, 20, fi), frame, 'ws_header');
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

  // Aft bulkhead (faces forward) with the cockpit doorway frame.
  const s = F.at(X_AFT);
  const bulk = new THREE.CircleGeometry(1, 48);
  bulk.scale(s.ry - INSET, s.rz - INSET, 1);
  bulk.rotateY(Math.PI);
  add(bulk, wall, 'aft_bulkhead').position.copy(bl(X_AFT, 0, s.cz));

  // Floor (carpet) from the bulkhead to the rudder-pedal wells.
  const floorLen = 8.9 - X_AFT;
  const fl = floorGeometry(1.9, floorLen);
  add(fl, 'carpet', 'floor').position.copy(bl((X_AFT + 8.9) / 2, 0, FLOOR_Z));

  // Glareshield hood.
  const hood = add(glareshieldHood(), 'glareshield', 'glareshield');
  hood.castShadow = true;

  // (The glareshield face now rises straight from the lower tier, which is coplanar with the displays: no soffit.)

  // Centre pedestal: sloped forward section (MFD GTCs) and the main box.
  const P = PEDESTAL;
  const topLen = P.topFwd[0] - P.topAft[0];
  // Body top 3 mm below the control-panel plate: coplanar (bevelled) it covered the forward engraved legends
  // (FUEL, HYDRAULICS, SPEED BRAKE, FLAPS...) by up to 0.7 mm (check-ride visual pass).
  const PED_INSET = 0.003;
  add(pedestalGeometry(P.width, topLen, FLOOR_Z - P.topAft[1] - PED_INSET, FLOOR_Z - P.topFwd[1] - PED_INSET, 0.012), L.trim, 'pedestal').position.copy(bl((P.topFwd[0] + P.topAft[0]) / 2, 0, FLOOR_Z));
  const fwdLen = P.fwdTop[0] - P.fwdBottom[0];
  add(pedestalGeometry(P.width, fwdLen + 0.02, FLOOR_Z - P.fwdBottom[1], FLOOR_Z - P.fwdTop[1], 0.008), L.silver, 'pedestal_fwd').position.copy(bl((P.fwdTop[0] + P.fwdBottom[0]) / 2, 0, FLOOR_Z));

  // Knee panels / foot-well closures under the lower sub-panels (dark), and the forward footwell bulkhead.
  const kneeH = FLOOR_Z - LOWER_PANEL.zBottom;
  for (const side of [-1, 1]) {
    const kw = LOWER_PANEL.yOut - LOWER_PANEL.yIn;
    const knee = trimBoxGeometry(kw, 0.025, 0.05, 0.008);
    add(knee, L.trim, 'knee_bolster').position.copy(bl(LOWER_PANEL.x - 0.01, side * (LOWER_PANEL.yIn + kw / 2), LOWER_PANEL.zBottom + 0.012));
    const well = new THREE.PlaneGeometry(kw, kneeH);
    add(well, L.trim, 'footwell').position.copy(bl(8.82, side * (LOWER_PANEL.yIn + kw / 2), LOWER_PANEL.zBottom + kneeH / 2));
  }

  // Crew seats.
  b.seat('bizjet', SEAT_L);
  b.seat('bizjet', SEAT_R);
}
