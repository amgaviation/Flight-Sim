/**
 * G650 flight-deck structure: sidewalls, headliner and nose closure carved
 * from the exterior fuselage skin (inset 45 mm) with the windshield and side
 * window openings cut along the shared glazing field (glazing.ts), interior
 * window frames and faint glass, carpeted floor, aft bulkhead with the
 * cockpit doorway, the glareshield hood (black crackle, following the
 * windshield base), the main-panel closures and knee panels, the centre
 * pedestal body, the side consoles and the two crew seats.
 *
 * Sources: layout.ts (EST geometry from G650 / G650ER photographs), GAC /
 * BJT cabin dimensions. The G650 has no windshield wipers (hydrophobic
 * coating, LUC ice and rain), so none are modelled.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { pedestalGeometry, floorGeometry, trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { bl } from '../../../cockpit/frame';
import { markMovingPart } from '../../../cockpit/instancing';
import { G650_VARS as V } from '../vars';
import { G650_FUSELAGE as F, CONSOLE, FLOOR_Z, GLARE_FACE, GLARE_HOOD, GLAZING, LOWER_CENTRE, MAIN_PANEL, PEDESTAL, SEAT_L, SEAT_R, SHELL_INSET, X_AFT, halfWidth, topZ } from './layout';
import { carvedSkin, frameBand } from './glazing';

/** Forward end of the interior shell (just ahead of the windshield base; hidden behind the panel below). */
const X_FWD = 15.2;

/** Windshield base x at lateral position y (where the inner skin reaches the glareshield line). */
function baseXAt(y: number): number {
  let lo = 13.8;
  let hi = 16.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (topZ(mid, y, SHELL_INSET) < GLAZING.baseZ) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Glareshield hood: a gently crowned shelf from the brow forward to the windshield base, clipped to the
 * cabin width, with a rolled brow (30 mm). Cockpit-local geometry, UVs in metres (crackle texture).
 */
function glareshieldHood(): THREE.BufferGeometry {
  const nx = 16;
  const ny = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  const h = GLARE_HOOD;
  const v = new THREE.Vector3();
  const w0 = halfWidth(h.browX, h.topZ, SHELL_INSET) - 0.004;
  const row = ny + 1;
  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      const y = f * w0;
      const xEnd = baseXAt(y) + 0.02;
      const x = h.browX + (xEnd - h.browX) * t;
      // Rises gently to the windshield base line, slight crown in the middle.
      const zEnd = Math.min(GLAZING.baseZ + 0.01, topZ(xEnd, y, SHELL_INSET) + 0.01);
      const z = h.topZ + (zEnd - h.topZ) * t - 0.01 * (1 - f * f) * Math.sin(Math.PI * t);
      v.copy(bl(x, y, z));
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const a = i * row + j;
      const b = a + row;
      // Faces up (+y local): (a, a+1, b) winds CCW seen from above with x right / z aft.
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // Brow: quarter-round lip down the aft edge.
  const base = pos.length / 3;
  const segs = 6;
  const R = 0.03;
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * (Math.PI / 2);
    for (let j = 0; j <= ny; j++) {
      const f = -1 + (2 * j) / ny;
      v.copy(bl(h.browX - R * Math.sin(a), f * w0, h.topZ + R * (1 - Math.cos(a))));
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let k = 0; k < segs; k++)
    for (let j = 0; j < ny; j++) {
      const a = base + k * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
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

/** Vertical closure plate in the body y-z plane at station x, between |y| in [y0, y1] and z in [z0, z1] (faces aft). */
function closure(b: CockpitBuilder, name: string, x: number, y0: number, y1: number, z0: number, z1: number, mat: 'panelDark' | 'panel' | 'interior'): void {
  const g = new THREE.PlaneGeometry(Math.abs(y1 - y0), Math.abs(z1 - z0));
  const m = b.structureMesh(g, mat, [x, (y0 + y1) / 2, (z0 + z1) / 2]);
  m.name = name;
}

export function buildShell(b: CockpitBuilder): void {
  const m = b.env.materials;
  const wall = m.get('interior');
  // Window frames and trim: dark grey (G650 photographs: charcoal window reveals against the cream sidewalls).
  const frame = m.get('panelDark');
  const add = (g: THREE.BufferGeometry, mat: THREE.Material | Parameters<typeof m.get>[0], name: string, occluder = true) => {
    const me = b.structureMesh(g, mat, undefined, undefined, occluder);
    me.name = name;
    return me;
  };
  // ---- skin: solid parts of the flight-deck section (walls, headliner, nose closure), openings cut.
  // segT 360 (was 256): finer sampling keeps the centre-post cladding near GLAZING.postHalf instead of a
  // wide tapered wedge (Flickr 52948762561: slim constant-width post).
  add(carvedSkin(X_AFT, X_FWD, { inset: SHELL_INSET, keep: 'solid', inward: true, dx: 0.02, segT: 360 }), wall, 'shell');
  // Window reveals (frames around every opening, 45 mm band just proud of the wall).
  add(frameBand(X_AFT + 0.4, X_FWD, { inset: SHELL_INSET - 0.012, width: 0.022, inward: true, dx: 0.012, segT: 360, theta: [-2.2, 2.2] }), frame, 'window_frames');
  // Faint glass on the inside (reflections), non-occluding.
  const glass = add(carvedSkin(X_AFT + 0.4, X_FWD, { inset: SHELL_INSET - 0.02, keep: 'glass', inward: true, dx: 0.02, segT: 256, theta: [-2.2, 2.2] }), 'windowGlass', 'glass_inner', false);
  glass.castShadow = false;
  glass.userData.cockpitStatic = false;

  // ---- aft bulkhead (faces forward) with the cockpit doorway (0.6 m wide, EST).
  const s = F.at(X_AFT);
  const shape = new THREE.Shape();
  const ry = s.ry - SHELL_INSET;
  const rz = s.rz - SHELL_INSET;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const px = ry * Math.sin(t);
    const py = rz * Math.cos(t);
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  const door = new THREE.Path();
  const floorY = s.cz - FLOOR_Z; // local height of the floor relative to the section centre (body z down)
  door.moveTo(-0.3, floorY);
  door.lineTo(0.3, floorY);
  door.lineTo(0.3, floorY + 1.78);
  door.lineTo(-0.3, floorY + 1.78);
  door.closePath();
  shape.holes.push(door);
  const bulk = new THREE.ShapeGeometry(shape, 8);
  bulk.rotateY(Math.PI);
  add(bulk, wall, 'aft_bulkhead').position.copy(bl(X_AFT, 0, s.cz));
  // Doorway: dark cabin beyond (a plane 0.3 m aft).
  const dark = new THREE.PlaneGeometry(0.7, 1.9);
  add(dark, 'panelDark', 'doorway_dark').position.copy(bl(X_AFT - 0.3, 0, FLOOR_Z - 0.95));
  // Flight-deck divider door (cabin photographs show a divider/door at the aft bulkhead; leaf geometry EST).
  // Hinged on the left jamb, swings aft into the vestibule with V.doorCockpit (side console DOOR key).
  {
    const leafG = new THREE.PlaneGeometry(0.6, 1.78);
    b.trackGeometry(leafG);
    leafG.translate(0.3, 0, 0); // hinge at the left edge
    const leaf = new THREE.Mesh(leafG, m.get('interior'));
    leaf.name = 'g650_cockpit_door';
    const hinge = new THREE.Group();
    hinge.name = 'g650_cockpit_door_hinge';
    hinge.position.copy(bl(X_AFT, -0.3, FLOOR_Z - 0.89));
    hinge.add(leaf);
    b.root.add(hinge);
    markMovingPart(leaf, hinge);
    const vars = b.env.vars;
    let shown = NaN;
    b.onUpdate((dt) => {
      // First-order tracking of the commanded position (EST ~1.5 s swing).
      const cmd = vars.get(V.doorCockpit);
      const cur = Number.isNaN(shown) ? cmd : shown;
      const next = cur + (cmd - cur) * Math.min(1, dt / 0.4);
      if (next !== shown) {
        shown = next;
        hinge.rotation.y = -next * (Math.PI / 2) * 0.95;
      }
    });
  }

  // ---- floor (carpet) from the bulkhead to the rudder-pedal wells.
  const fx1 = 15.0;
  const fw = 2 * halfWidth((X_AFT + fx1) / 2, FLOOR_Z, SHELL_INSET);
  add(floorGeometry(fw, fx1 - X_AFT), 'carpet', 'floor').position.copy(bl((X_AFT + fx1) / 2, 0, FLOOR_Z));

  // ---- glareshield hood and the soffit between its face and the display band.
  add(glareshieldHood(), 'glareshield', 'glareshield').castShadow = true;
  const faceBot = { x: GLARE_FACE.center_m[0] - (GLARE_FACE.height / 2) * Math.sin((GLARE_FACE.tiltDeg * Math.PI) / 180), z: GLARE_FACE.center_m[2] + (GLARE_FACE.height / 2) * Math.cos((GLARE_FACE.tiltDeg * Math.PI) / 180) };
  const mpTop = { x: MAIN_PANEL.center_m[0] + (MAIN_PANEL.height / 2) * Math.sin((MAIN_PANEL.tiltDeg * Math.PI) / 180), z: MAIN_PANEL.center_m[2] - (MAIN_PANEL.height / 2) * Math.cos((MAIN_PANEL.tiltDeg * Math.PI) / 180) };
  const sw = 2 * halfWidth(faceBot.x, faceBot.z, SHELL_INSET) - 0.01;
  const soff = trimBoxGeometry(sw, 0.008, mpTop.x - faceBot.x + 0.02, 0.003);
  add(soff, 'panelDark', 'glareshield_soffit').position.copy(bl((mpTop.x + faceBot.x) / 2, 0, faceBot.z + 0.004));
  // Glareshield face ends beyond the face panel (black, to the sidewalls).
  const faceHalf = GLARE_FACE.width / 2;
  const wallAtFace = halfWidth(GLARE_FACE.center_m[0], GLARE_FACE.center_m[2], SHELL_INSET);
  if (wallAtFace > faceHalf + 0.005) {
    for (const side of [-1, 1]) {
      const wdt = wallAtFace - faceHalf;
      const g = new THREE.PlaneGeometry(wdt, GLARE_FACE.height);
      g.rotateX(-(GLARE_FACE.tiltDeg * Math.PI) / 180);
      add(g, 'glareshield', 'glare_face_end').position.copy(bl(GLARE_FACE.center_m[0] + 0.004, side * (faceHalf + wdt / 2), GLARE_FACE.center_m[2]));
    }
  }

  // ---- main panel closures outboard of the display band (to the sidewalls) and knee panels below it.
  const mpHalf = MAIN_PANEL.width / 2;
  const mpWall = halfWidth(MAIN_PANEL.center_m[0], MAIN_PANEL.center_m[2], SHELL_INSET);
  if (mpWall > mpHalf + 0.005) {
    for (const side of [-1, 1]) {
      const wdt = mpWall - mpHalf + 0.01;
      const g = new THREE.PlaneGeometry(wdt, MAIN_PANEL.height);
      g.rotateX(-(MAIN_PANEL.tiltDeg * Math.PI) / 180);
      add(g, 'panelDark', 'panel_wing').position.copy(bl(MAIN_PANEL.center_m[0] + 0.006, side * (mpHalf + wdt / 2 - 0.01), MAIN_PANEL.center_m[2]));
    }
  }
  const kneeTop = MAIN_PANEL.center_m[2] + (MAIN_PANEL.height / 2) * Math.cos((MAIN_PANEL.tiltDeg * Math.PI) / 180);
  const kneeX = MAIN_PANEL.center_m[0] - (MAIN_PANEL.height / 2) * Math.sin((MAIN_PANEL.tiltDeg * Math.PI) / 180) + 0.02;
  for (const side of [-1, 1]) {
    const yIn = LOWER_CENTRE.yOut;
    const yOut = halfWidth(kneeX, kneeTop + 0.1, SHELL_INSET) - 0.01;
    // Knee panel (dark, slightly tilted) from the display band down to the pedal wells, with a padded bolster on top.
    closure(b, 'knee_panel', kneeX + 0.03, side * yIn, side * yOut, kneeTop, kneeTop + 0.2, 'panelDark');
    const bol = trimBoxGeometry(yOut - yIn, 0.03, 0.06, 0.01);
    add(bol, 'panelDark', 'knee_bolster').position.copy(bl(kneeX, side * ((yIn + yOut) / 2), kneeTop + 0.015));
    // Forward footwell bulkhead behind the pedals.
    closure(b, 'footwell', 15.0, side * 0.2, side * (halfWidth(15.0, 0.0, SHELL_INSET) - 0.01), kneeTop + 0.2, FLOOR_Z, 'panelDark');
  }
  // Closure under the lower centre panels down to the pedestal sides.
  for (const side of [-1, 1]) {
    closure(b, 'lower_centre_skirt', LOWER_CENTRE.x + 0.01, side * LOWER_CENTRE.yIn, side * LOWER_CENTRE.yOut, LOWER_CENTRE.zBottom, FLOOR_Z, 'panelDark');
  }

  // ---- centre pedestal body: sloped forward section (MCDU 1 / 2) and the main box to the floor.
  const P = PEDESTAL;
  const topLen = P.topFwd[0] - P.topAft[0];
  add(pedestalGeometry(P.width, topLen, FLOOR_Z - P.topAft[1], FLOOR_Z - P.topFwd[1], 0.012), 'panelDark', 'pedestal').position.copy(bl((P.topFwd[0] + P.topAft[0]) / 2, 0, FLOOR_Z));
  const fwdLen = P.fwdTop[0] - P.fwdBottom[0];
  add(pedestalGeometry(P.width, fwdLen + 0.02, FLOOR_Z - P.fwdBottom[1], FLOOR_Z - P.fwdTop[1], 0.006), 'panelDark', 'pedestal_fwd').position.copy(bl((P.fwdTop[0] + P.fwdBottom[0]) / 2, 0, FLOOR_Z));

  // ---- side consoles (bodies; the side-console builder populates the tops).
  for (const side of [-1, 1]) {
    const xMid = (CONSOLE.xFwd + CONSOLE.xAft) / 2;
    const len = CONSOLE.xFwd - CONSOLE.xAft;
    const yOut = halfWidth(xMid, CONSOLE.topZ, SHELL_INSET) - 0.005;
    const w = yOut - CONSOLE.yIn;
    const hgt = FLOOR_Z - CONSOLE.topZ;
    add(trimBoxGeometry(w, hgt, len, 0.012), 'panelDark', 'side_console').position.copy(bl(xMid, side * (CONSOLE.yIn + w / 2), CONSOLE.topZ + hgt / 2));
    // Armrest pad along the inboard edge.
    add(trimBoxGeometry(0.07, 0.035, len * 0.55, 0.014), 'leather', 'console_armrest').position.copy(bl(CONSOLE.xAft + len * 0.3, side * (CONSOLE.yIn + 0.04), CONSOLE.topZ - 0.018));
  }

  // ---- crew seats.
  b.seat('bizjet', SEAT_L);
  b.seat('bizjet', SEAT_R);
}
