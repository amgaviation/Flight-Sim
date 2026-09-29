/**
 * G800 flight-deck structure: the interior skin carved for the windshield and
 * side windows (glazing.ts, the same regions as the exterior glass), window
 * frames, carpeted floor, aft bulkhead with the cockpit door, the black
 * crackle glareshield hood following the windshield base, the soffit under
 * the guidance panel, the panel shroud, the centre pedestal body, the two
 * side consoles (sidestick armrests) and the crew seats.
 *
 * Sources: layout.ts (dossier §9.0 geometry, EST from photographs). Colours
 * (G600 / G500 EBACE photographs, fix round 1): dark charcoal sidewalls, window
 * surrounds and A-pillars, a light-grey headliner, a stitched dark leather-like
 * glareshield with only the guidance-panel pod standing proud, black leather seats
 * (palette G800_PALETTE in index.ts). Aft pedestal: two cupholders, a storage bin
 * aft-right and a brushed bumper with a vent grille (G500 BL7C0670 c_ped).
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
  // Half-width of the hood at the brow line: overlaps INTO the interior skin by ~2 cm so no exterior
  // white shows through at the A-pillar corners (fix round 1 L04; the real glareshield rolls into the
  // A-pillar trim with no daylight gaps, g800_flying_cockpit.jpg).
  // Round 2 L04: overlap deepened 2 cm -> 3.5 cm — a thin exterior sliver still showed at the extreme
  // outboard corner from the pilot's default eye point with the 2 cm overlap.
  const wBrow = halfWidth(aPillarX(zb) - 0.01, zb, SHELL_INSET) + 0.035;
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
    // The forward edge runs 2 cm past the windshield base line into the skin (closes the corner gaps, L04).
    const xEnd = Math.max(x0 + 0.01, lo + 0.03);
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
  // Closing skirt (fix round 2 L04): a strip dropped from the hood's outboard and forward edges down
  // into the structure, so the carved exterior skin's sawtooth edge can never show through the corner
  // between the hood, the windshield base and the sidewall (it still did on the LEFT side below the
  // brow from the pilot's default eye point after the round-1 overlap fix; the real glareshield rolls
  // into the A-pillar trim with no daylight gaps, g800_flying_cockpit.jpg). Same geometry/material as
  // the hood, so no extra draw call. Both windings so it occludes from any interior angle.
  const drop = 0.14; // m, +z is down (body frame)
  const skirt = (edge: number[]) => {
    for (let s = 0; s < edge.length - 1; s++) {
      const a = edge[s];
      const b = edge[s + 1];
      const base = pos.length / 3;
      for (const k of [a, b]) {
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        uv.push(uv[k * 2], uv[k * 2 + 1]);
      }
      for (const k of [a, b]) {
        const w = new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        // cockpit-local: body +z (down) maps to local -y (bodyToLocal), so drop lowers y.
        pos.push(w.x, w.y - drop, w.z);
        uv.push(uv[k * 2], uv[k * 2 + 1] + drop * 4);
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  };
  const left: number[] = [];
  const right: number[] = [];
  const fwd: number[] = [];
  for (let i = 0; i <= nx; i++) {
    left.push(i); // j = 0 row (y = -wBrow)
    right.push(ny * row + i); // j = ny row (y = +wBrow)
  }
  for (let j = 0; j <= ny; j++) fwd.push(j * row + nx); // forward (windshield-base) edge
  skirt(left);
  skirt(right);
  skirt(fwd);
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

  // ---- skin with the window openings: light-grey headliner (top of the section) and dark charcoal sidewalls.
  const [head, walls] = splitByTheta(carvedSkin(X_AFT, X_FWD, { inset: SHELL_INSET, keep: 'solid', inward: true, dx: 0.02, segT: 300 }), 0.95);
  add(head, 'headliner', 'cockpit_headliner');
  add(walls, 'interior', 'cockpit_skin');

  // ---- window frames (tubes along the true boundaries hide the loft's cell steps): dark trim like the sidewalls.
  const fl = frameLines(SHELL_INSET + 0.012);
  const frameMat = m.get('interior');
  for (const p of fl.pillars) add(tube(p, 0.048, 24, 10), frameMat, 'a_pillar');
  for (const p of fl.post) add(tube(p, 0.018, 16, 8), 'panelDark', 'centre_post');
  for (const p of fl.edges) add(tube(p, 0.03, Math.max(16, p.length * 2), 8), frameMat, 'window_frame');

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
  // Brow / soffit width overlaps the interior skin by ~2 cm each side (fix round 1 L04: closes the
  // daylight gaps between hood, soffit and sidewall at the A-pillar junction).
  const hw = halfWidth(aPillarX(GLAZING.baseZ) - 0.01, GLAZING.baseZ, SHELL_INSET) + 0.035;
  const brow = new THREE.CylinderGeometry(0.014, 0.014, 2 * hw, 16, 1);
  brow.rotateZ(Math.PI / 2);
  add(brow, 'glareshield', 'glareshield_brow', [GLARE_HOOD.browX + 0.04, 0, GLARE_HOOD.topZ + 0.012]);
  // Glareshield face either side of the pod, out to the walls, set 40 mm forward so only the pod projects; a light
  // stitch line along the brow (G600 BL7C0704: stitched leather-like covering).
  const face = GLARE_FACE;
  // (No flat face either side of the pod: the hood brow and the soffit close the glareshield there.)
  void face;
  const stitch = new THREE.CylinderGeometry(0.0012, 0.0012, 2 * hw - 0.04, 6, 1);
  stitch.rotateZ(Math.PI / 2);
  add(stitch, m.custom('paint', '#6a6a66', 0.8), 'glareshield_stitch', [GLARE_HOOD.browX + 0.028, 0, GLARE_HOOD.topZ - 0.001], false);
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
  // Aft pedestal (G500 BL7C0670 c_ped): two deep cupholders across the end, a storage bin aft-right, a brushed
  // aluminium bumper with a vent grille wrapping the aft face.
  for (const side of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.038, 0.034, 0.05, 24, 1, true);
    add(cup, 'plasticBlack', 'cup_holder', [P.topAft[0] + 0.07, side * 0.1, P.topAft[1] + 0.021], false);
    const floor = new THREE.CircleGeometry(0.034, 24).rotateX(-Math.PI / 2);
    add(floor, 'plasticBlack', 'cup_holder_floor', [P.topAft[0] + 0.07, side * 0.1, P.topAft[1] + 0.045], false);
  }
  add(shellBin(0.1, 0.13, 0.06), 'plasticBlack', 'pedestal_bin', [12.5, 0.15, 0.024], false);
  const bumper = trimBoxGeometry(P.width + 0.02, 0.07, 0.025, 0.01);
  add(bumper, 'aluminium', 'pedestal_bumper', [P.topAft[0] - 0.006, 0, P.topAft[1] + 0.06]);
  for (let i = -8; i <= 8; i++) {
    const slat = new THREE.BoxGeometry(0.004, 0.045, 0.012);
    add(slat, 'plasticBlack', 'pedestal_grille', [P.topAft[0] - 0.02, i * 0.022, P.topAft[1] + 0.06], false);
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

  // ---- crew seats (black leather: palette seat colour, index.ts)
  b.seat('bizjet', SEAT_L);
  b.seat('bizjet', SEAT_R);
  void bl;
}

/** Open-top box (storage bin) standing on its base, cockpit-local frame (y up). */
function shellBin(w: number, l: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, 1);
  // Drop the top face (BoxGeometry groups: +x, -x, +y, -y, +z, -z; +y = top).
  const idx = g.getIndex()!;
  const keep: number[] = [];
  for (const gr of g.groups) if (gr.materialIndex !== 2) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx.getX(i));
  g.setIndex(keep);
  g.clearGroups();
  g.translate(0, -h / 2, 0);
  return g;
}

/**
 * Splits the carved skin into the headliner (section angle |theta| < thetaMax, theta = 0 at the crown; uv.y holds
 * theta) and the sidewalls, by triangle centroid.
 */
function splitByTheta(g: THREE.BufferGeometry, thetaMax: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = g.index ? g.toNonIndexed() : g;
  const names = Object.keys(src.attributes);
  const uv = src.getAttribute('uv');
  const n = uv.count;
  const out = [new Map<string, number[]>(), new Map<string, number[]>()];
  for (const o of out) for (const k of names) o.set(k, []);
  for (let i = 0; i < n; i += 3) {
    const th = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
    const o = out[Math.abs(th) < thetaMax ? 0 : 1];
    for (const k of names) {
      const at = src.getAttribute(k);
      const arr = o.get(k)!;
      for (let j = i; j < i + 3; j++) for (let c = 0; c < at.itemSize; c++) arr.push(at.array[j * at.itemSize + c]);
    }
  }
  const make = (m: Map<string, number[]>) => {
    const r = new THREE.BufferGeometry();
    for (const k of names) r.setAttribute(k, new THREE.Float32BufferAttribute(m.get(k)!, src.getAttribute(k).itemSize));
    return r;
  };
  const res: [THREE.BufferGeometry, THREE.BufferGeometry] = [make(out[0]), make(out[1])];
  g.dispose();
  if (src !== g) src.dispose();
  return res;
}
