/**
 * G800 flight-deck structure: the interior skin carved for the windshield and
 * side windows (glazing.ts, the same regions as the exterior glass), window
 * frames, carpeted floor, aft bulkhead with the cockpit door, the black
 * crackle glareshield hood following the windshield base, the soffit under
 * the guidance panel, the panel shroud, the centre pedestal body, the two
 * side consoles (sidestick armrests) and the crew seats.
 *
 * Sources: layout.ts (dossier §9.0 geometry, EST from photographs). The
 * Symmetry flight deck has a light-grey trimmed interior with a black
 * glareshield and dark-grey panels (G500/G600/G700 press photographs, EST
 * colours: palette 'gulfstream').
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { floorGeometry, pedestalGeometry, trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { tube } from '../../../cockpit/geometry/primitives';
import { bl, bodyToLocal } from '../../../cockpit/frame';
import { carvedSkin, frameLines, halfWidth } from './glazing';
import { CONSOLE, FLOOR_Z, G800_FUSELAGE as F, GLARE_FACE, GLARE_HOOD, GLAZING, MAIN_PANEL, PEDESTAL, SEAT_L, SEAT_R, SHELL_INSET, X_AFT, aPillarX } from './layout';

/** Forward end of the interior loft (nose bulkhead ahead of the windshield base). */
const X_FWD = 13.95;

/**
 * Glareshield hood: from the brow over the guidance panel forward to the windshield base curve, clipped
 * to the cockpit width at the windshield line (so it wraps into the A-pillar corners). Slight crown.
 * Cockpit-local geometry with planar metre UVs for the crackle texture.
 */
function hoodGeometry(): THREE.BufferGeometry {
  const ny = 40;
  const nx = 14;
  const zb = GLAZING.baseZ;
  const x0 = GLARE_HOOD.browX + 0.04;
  // Half-width of the hood at the brow line (limited by the cockpit wall at the hood height).
  const wBrow = halfWidth(aPillarX(zb) - 0.01, zb, SHELL_INSET) - 0.004;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= ny; j++) {
    const y = -wBrow + (2 * wBrow * j) / ny;
    // Forward end: where the interior skin at the base height narrows to |y| (the windshield base line).
    let lo = x0;
    let hi = X_FWD;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (halfWidth(m, zb, SHELL_INSET) > Math.abs(y)) lo = m;
      else hi = m;
    }
    const xEnd = Math.max(x0 + 0.01, lo + 0.01);
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = x0 + (xEnd - x0) * t;
      const f = y / wBrow;
      const z = GLARE_HOOD.topZ + (zb + 0.012 - GLARE_HOOD.topZ) * t - 0.008 * (1 - f * f) * (1 - t);
      v.copy(bodyToLocal(x, y, z, v));
      pos.push(v.x, v.y, v.z);
      uv.push(y * 4, x * 4);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1); // faces up
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildShell(b: CockpitBuilder): void {
  const m = b.env.materials;
  const add = (g: THREE.BufferGeometry, mat: THREE.Material | Parameters<typeof m.get>[0], name: string, pos?: [number, number, number], occluder = true) => {
    const me = b.structureMesh(g, mat, pos, undefined, occluder);
    me.name = name;
    return me;
  };

  // ---- skin: light-grey trimmed sidewalls and headliner with the window openings.
  add(carvedSkin(X_AFT, X_FWD, { inset: SHELL_INSET, keep: 'solid', inward: true, dx: 0.02, segT: 300 }), 'interior', 'cockpit_skin');

  // ---- window frames (tubes along the true boundaries hide the loft's cell steps)
  const fl = frameLines(SHELL_INSET + 0.012);
  const frameMat = m.get('headliner');
  for (const p of fl.pillars) add(tube(p, 0.034, 24, 10), frameMat, 'a_pillar');
  for (const p of fl.post) add(tube(p, 0.018, 16, 8), 'panelDark', 'centre_post');
  for (const p of fl.edges) add(tube(p, 0.02, Math.max(16, p.length * 2), 8), frameMat, 'window_frame');

  // ---- floor (carpet) from the bulkhead to the pedal wells
  const fw = 2 * halfWidth(12.4, FLOOR_Z, SHELL_INSET);
  add(floorGeometry(fw, 13.7 - X_AFT), 'carpet', 'floor', [(X_AFT + 13.7) / 2, 0, FLOOR_Z]);

  // ---- aft bulkhead (faces forward) with the cockpit door
  const s = F.at(X_AFT);
  const bulk = new THREE.CircleGeometry(1, 48);
  bulk.scale(s.ry - SHELL_INSET, s.rz - SHELL_INSET, 1);
  bulk.rotateY(Math.PI);
  add(bulk, 'interior', 'aft_bulkhead', [X_AFT, 0, s.cz]);
  const door = trimBoxGeometry(0.62, 1.78, 0.02, 0.01);
  add(door, 'panelDark', 'cockpit_door', [X_AFT + 0.012, 0, FLOOR_Z - 0.89]);

  // ---- glareshield hood (black crackle) and its rolled brow
  add(hoodGeometry(), 'glareshield', 'glareshield').castShadow = true;
  const hw = halfWidth(aPillarX(GLAZING.baseZ) - 0.01, GLAZING.baseZ, SHELL_INSET) - 0.004;
  const brow = new THREE.CylinderGeometry(0.014, 0.014, 2 * hw, 16, 1);
  brow.rotateZ(Math.PI / 2);
  add(brow, 'glareshield', 'glareshield_brow', [GLARE_HOOD.browX + 0.04, 0, GLARE_HOOD.topZ + 0.012]);
  // Face backing either side of the GP / SFD strip, out to the walls (the face panel covers the middle).
  const face = GLARE_FACE;
  for (const side of [-1, 1]) {
    const w = hw - face.width / 2 + 0.01;
    if (w <= 0.005) continue;
    const g = trimBoxGeometry(w, face.height + 0.02, 0.02, 0.004);
    const me = add(g, 'glareshield', 'glareshield_face_end', [face.center_m[0] + 0.012, side * (face.width / 2 + w / 2 - 0.005), face.center_m[2]]);
    me.rotation.x = THREE.MathUtils.degToRad(face.tiltDeg);
  }
  // Soffit under the guidance panel back to the top of the display band (dark).
  const soffitLen = 0.2;
  const soffit = trimBoxGeometry(2 * hw, 0.01, soffitLen, 0.003);
  add(soffit, 'panelDark', 'glareshield_soffit', [face.center_m[0] + soffitLen / 2 - 0.01, 0, face.center_m[2] + face.height / 2 * Math.cos(THREE.MathUtils.degToRad(face.tiltDeg)) + 0.004]);

  // ---- panel shroud: dark closure behind and around the instrument panels, from the soffit to the knee line.
  const mp = MAIN_PANEL;
  const shroudW = 2 * halfWidth(13.46, -0.2, SHELL_INSET);
  add(new THREE.PlaneGeometry(shroudW, 0.62).rotateY(0), 'panelDark', 'panel_shroud', [mp.center_m[0] + 0.1, 0, -0.26]);
  // Lower closure under the panels (knee bolster line) down to the pedal well.
  for (const side of [-1, 1]) {
    const kw = 0.52;
    add(trimBoxGeometry(kw, 0.03, 0.09, 0.01), 'panelDark', 'knee_bolster', [13.34, side * 0.69, -0.2]);
  }
  // Forward footwell bulkhead across the full width (closes the nose behind the pedals and the pedestal).
  add(new THREE.PlaneGeometry(2 * halfWidth(13.64, 0.1, SHELL_INSET), FLOOR_Z + 0.24), 'panelDark', 'footwell', [13.64, 0, (FLOOR_Z - 0.24) / 2]);

  // ---- centre pedestal body: sloped forward section (TSCs) and the main box (throttle quadrant, CCDs)
  const P = PEDESTAL;
  const topLen = P.topFwd[0] - P.topAft[0];
  add(pedestalGeometry(P.width, topLen, FLOOR_Z - P.topAft[1] - 0.004, FLOOR_Z - P.topFwd[1] - 0.004, 0.012), 'panelDark', 'pedestal', [(P.topFwd[0] + P.topAft[0]) / 2, 0, FLOOR_Z]);
  const fwdLen = P.fwdTop[0] - P.fwdBottom[0];
  add(pedestalGeometry(P.width, fwdLen + 0.02, FLOOR_Z - P.fwdBottom[1] - 0.004, FLOOR_Z - P.fwdTop[1] - 0.004, 0.008), 'panelDark', 'pedestal_fwd', [(P.fwdTop[0] + P.fwdBottom[0]) / 2 + 0.005, 0, FLOOR_Z]);
  // Cup holders in the aft end of the pedestal (BJT500).
  for (const side of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.038, 0.034, 0.012, 24, 1, true);
    add(cup, 'plasticBlack', 'cup_holder', [P.topAft[0] + 0.07, side * 0.1, P.topAft[1] - 0.004], false);
  }

  // ---- side consoles (armrest ledges) from the floor to the console top, out to the sidewall
  for (const side of [-1, 1]) {
    const yOut = halfWidth(12.6, CONSOLE.topZ, SHELL_INSET) - 0.01;
    const w = yOut - CONSOLE.yIn;
    const h = FLOOR_Z - CONSOLE.topZ;
    const len = CONSOLE.xFwd - CONSOLE.xAft;
    add(trimBoxGeometry(w, h, len, 0.02), 'interior', 'side_console', [(CONSOLE.xFwd + CONSOLE.xAft) / 2, side * (CONSOLE.yIn + w / 2), CONSOLE.topZ + h / 2]);
    // Dark top cap (the mount area of the console controls).
    add(trimBoxGeometry(w - 0.01, 0.006, len - 0.01, 0.003), 'panelDark', 'side_console_top', [(CONSOLE.xFwd + CONSOLE.xAft) / 2, side * (CONSOLE.yIn + w / 2), CONSOLE.topZ - 0.001]);
  }

  // ---- crew seats
  b.seat('bizjet', SEAT_L);
  b.seat('bizjet', SEAT_R);
  void bl;
}
