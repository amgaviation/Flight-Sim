/**
 * 737-800 flight-deck structure: the inner skin (sidewalls and roof) lofted
 * from the exterior fuselage sections with the six window openings cut out
 * (so they line up with the exterior glazing), window frames and the centre
 * / corner posts, carpeted floor, aft bulkhead with the flight-deck door,
 * the glareshield hood (black crackle finish, forward edge following the
 * V-shaped windshield sill), soffit, knee panels and foot wells, the
 * pedestal bodies (forward electronic panel, control stand, aft electronic
 * panel), the Captain's tiller shelf and the two crew seats.
 *
 * Colours: Boeing flight-deck grey panels (palette 'boeing', FS 595 36440),
 * light grey sidewall / headliner trim (EST from NG photographs), black
 * glareshield. Sources for the geometry: layout.ts / fuselage.ts (EST).
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { floorGeometry, pedestalGeometry, trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { bl } from '../../../cockpit/frame';
import { B738_FUSELAGE as F, B738_WINDOWS, WS_SILL_Z, mirrorPoly, offsetPoly, skinShape, xAtZ, type SkinPoly } from './fuselage';
import { AFT_PED, FLOOR_Z, GLARE, MIP, P9, SEAT_L, SEAT_R, SIDE_SHELF, STAND, X_AFT } from './layout';

/** Inner-skin inset from the outer mould line (frames + insulation + lining, EST). */
export const INSET = 0.07;
/** Forward end of the interior skin (behind the panels). */
const X_FWD = 14.85;

/** Every window opening (right and left) in parameter space. */
export function windowPolys(): SkinPoly[] {
  const out: SkinPoly[] = [];
  for (const w of [B738_WINDOWS.w1, B738_WINDOWS.w2, B738_WINDOWS.w3]) {
    out.push(w);
    out.push(mirrorPoly(w));
  }
  return out;
}

/** Floor angle on the section (theta where the inner skin meets the floor), right side. */
function floorTheta(x: number): number {
  return F.thetaAt(x, FLOOR_Z + 0.02);
}

/** Glareshield hood: top surface from the lip forward to the windshield sill (V-shaped), with a rolled brow. */
function glareshieldHood(): THREE.BufferGeometry {
  const ny = 32;
  const nx = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const halfW = F.halfWidth(GLARE.lipX, GLARE.topZ, INSET) - 0.01;
  // Forward edge x for a spanwise station: the windshield sill line (solved on the skin), limited to the cockpit.
  const frontAt = (y: number): number => {
    const ay = Math.abs(y);
    // theta of the sill at this y: search along the sill polyline of the windshield.
    let best = GLARE.frontX;
    let bestD = 1e9;
    for (let t = 0.0; t <= 1.3; t += 0.01) {
      const x = xAtZ(t, WS_SILL_Z);
      const [yy] = F.bodyYZ(x, t, 0);
      const d = Math.abs(yy - ay);
      if (d < bestD) {
        bestD = d;
        best = x;
      }
    }
    return Math.max(GLARE.lipX + 0.02, best - 0.005);
  };
  const fronts: number[] = [];
  for (let j = 0; j <= ny; j++) fronts.push(frontAt(-halfW + (2 * halfW * j) / ny));
  for (let i = 0; i <= nx; i++) {
    const f = i / nx;
    for (let j = 0; j <= ny; j++) {
      const y = -halfW + (2 * halfW * j) / ny;
      const x = GLARE.lipX + (fronts[j] - GLARE.lipX) * f;
      const z = GLARE.topZ + (GLARE.frontZ - GLARE.topZ) * f;
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
  // Brow: rolled lip down the aft edge to the face top (quarter round, 25 mm).
  const base = pos.length / 3;
  const segs = 5;
  const R = 0.018;
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * (Math.PI / 2);
    for (let j = 0; j <= ny; j++) {
      const y = -halfW + (2 * halfW * j) / ny;
      v.copy(bl(GLARE.lipX - R * Math.sin(a), y, GLARE.topZ + R * (1 - Math.cos(a))));
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
  const wall = m.custom('paint', 0xb9bab5, 0.75); // EST light warm grey lining (NG photographs)
  const roof = m.custom('paint', 0xc4c5c1, 0.8);
  const frame = m.custom('paint', 0x8f918d, 0.6); // window frames / posts, darker grey
  const add = (g: THREE.BufferGeometry, mat: THREE.Material | Parameters<typeof m.get>[0], name: string, pos?: [number, number, number]) => {
    const me = b.structureMesh(g, mat, pos);
    me.name = name;
    return me;
  };
  const wins = windowPolys();
  // ---- inner skin: sidewalls + roof from the aft bulkhead to behind the panel, down to the floor.
  const tf0 = floorTheta(X_AFT);
  const tf1 = floorTheta(X_FWD);
  const outline: [number, number][] = [
    [X_AFT, -tf0],
    [X_AFT, tf0],
    [X_FWD, tf1],
    [X_FWD, -tf1],
  ];
  // Split into the roof (headliner colour) above the window tops and the walls below: one mesh each would need
  // a shared boundary; the whole lining uses the wall colour and the roof strip is overlaid slightly inside.
  add(skinShape(outline, wins, { inset: INSET, inward: true, maxEdge: 0.15 }), wall, 'lining');
  add(skinShape([[X_AFT, -0.75], [X_AFT, 0.75], [13.95, 0.62], [13.95, -0.62]], [], { inset: INSET + 0.004, inward: true, maxEdge: 0.15 }), roof, 'headliner');
  // Lower sidewall panels below the window line (darker grey, EST from NG photographs).
  const lower = m.custom('paint', 0x8c8e8a, 0.7);
  for (const sg of [-1, 1]) {
    const pts: [number, number][] = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const x = X_AFT + ((X_FWD - X_AFT) * i) / n;
      // Top of the dark lower panels: just below the side windows, rising forward to the windshield sill.
      const zTop = x >= 14.47 ? -0.32 : x >= 14.38 ? -0.21 - ((x - 14.38) / 0.09) * 0.11 : -0.09 - ((x - 13.6) / 0.78) * 0.12;
      pts.push([x, sg * F.thetaAt(x, Math.min(zTop, -0.06))]);
    }
    for (let i = n; i >= 0; i--) {
      const x = X_AFT + ((X_FWD - X_AFT) * i) / n;
      pts.push([x, sg * floorTheta(x)]);
    }
    add(skinShape(pts, [], { inset: INSET + 0.003, inward: true, maxEdge: 0.15 }), lower, 'lower_sidewall');
  }
  // ---- window frames (rings around each opening) and reveals.
  for (const w of wins) {
    add(skinShape(offsetPoly(w, 0.03), [w], { inset: INSET + 0.012, inward: true, maxEdge: 0.12 }), frame, 'window_frame');
  }
  // Reveal: short band from the glass line to the lining along each window edge (hides the gap in the skin).
  for (const w of wins) {
    const n = w.length;
    const pos: number[] = [];
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [x0, t0] = w[i];
      const [x1, t1] = w[(i + 1) % n];
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const p = (s: number): [number, number] => [x0 + ((x1 - x0) * s) / steps, t0 + ((t1 - t0) * s) / steps];
        const [ax, at] = p(k);
        const [bx, bt] = p(k + 1);
        F.point(ax, at, 0.0, va);
        const a2 = F.point(ax, at, INSET + 0.012, new THREE.Vector3());
        F.point(bx, bt, 0.0, vb);
        const b2 = F.point(bx, bt, INSET + 0.012, new THREE.Vector3());
        pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, a2.x, a2.y, a2.z, vb.x, vb.y, vb.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = m.custom('paint', 0x7d7f7b, 0.7);
    const mesh = add(g, mat, 'window_reveal');
    (mesh.material as THREE.Material).side = THREE.DoubleSide;
  }

  // ---- floor
  const floorLen = 14.9 - X_AFT;
  add(floorGeometry(2.4, floorLen), 'carpet', 'floor', [(X_AFT + 14.9) / 2, 0, FLOOR_Z]);

  // ---- aft bulkhead (faces forward) with the flight-deck door frame and door (EST 0.6 x 1.85 m, centred).
  {
    const s = F.at(X_AFT);
    const shape = new THREE.Shape();
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const [y, z] = F.bodyYZ(X_AFT, th, INSET);
      const zz = Math.min(z, FLOOR_Z);
      if (i === 0) shape.moveTo(y, -zz);
      else shape.lineTo(y, -zz);
    }
    const door = new THREE.Path();
    door.moveTo(-0.31, -FLOOR_Z);
    door.lineTo(0.31, -FLOOR_Z);
    door.lineTo(0.31, -FLOOR_Z + 1.86);
    door.lineTo(-0.31, -FLOOR_Z + 1.86);
    door.closePath();
    shape.holes.push(door);
    const g = new THREE.ShapeGeometry(shape, 12);
    // ShapeGeometry lies in local XY facing +Z (aft); the bulkhead faces forward: rotate 180 deg about Y.
    g.rotateY(Math.PI);
    const me = add(g, wall, 'aft_bulkhead');
    me.position.set(0, 0, -X_AFT);
    void s;
    // Door (closed, slightly recessed) with its frame.
    add(new THREE.BoxGeometry(0.62, 1.86, 0.04), m.custom('paint', 0x8a8c88, 0.55), 'flight_deck_door', [X_AFT - 0.03, 0, FLOOR_Z - 0.93]);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.03), 'chrome', 'door_handle', [X_AFT - 0.002, 0.24, FLOOR_Z - 1.0]);
  }

  // ---- glareshield hood, soffit, face backing
  add(glareshieldHood(), 'glareshield', 'glareshield');
  const gw = GLARE.face.width;
  // Soffit from the face back to the MIP top edge (v 0.3 in the MIP frame).
  const xMipTop = MIP.center_m[0] + 0.3 * Math.sin(((MIP.tiltDeg ?? 15) * Math.PI) / 180);
  const xFace = GLARE.face.center_m[0];
  add(trimBoxGeometry(gw + 0.2, 0.012, xMipTop - xFace + 0.02, 0.006), 'panelDark', 'glareshield_soffit', [(xFace + xMipTop) / 2, 0, GLARE.soffitZ]);
  // Underside of the brow overhang between the rolled lip and the P7 face (the hood is a single surface).
  const browW = 2 * (F.halfWidth(GLARE.lipX, GLARE.topZ, INSET) - 0.01);
  add(trimBoxGeometry(browW, 0.014, xFace - GLARE.lipX + 0.012, 0.003), 'glareshield', 'glareshield_brow_under', [(GLARE.lipX + xFace) / 2 - 0.004, 0, GLARE.topZ + 0.011]);
  // Glareshield face backing (full width behind the P7 sub-panels, crackle black).
  add(trimBoxGeometry(2 * (F.halfWidth(GLARE.lipX, GLARE.face.center_m[2], INSET) - 0.01), GLARE.face.height, 0.02, 0.004), 'glareshield', 'glareshield_face', [GLARE.face.center_m[0] + 0.012, 0, GLARE.face.center_m[2]]);

  // ---- MIP backing (dark, behind the stepped P1 / P2 / P3 outline so the gaps above the lower outboard
  // sections and between the plates show the structure, not the forward lining).
  b.structureMesh(new THREE.BoxGeometry(MIP.width + 0.02, MIP.height, 0.01), 'panelDark', [MIP.center_m[0] + 0.03, 0, MIP.center_m[2]], new THREE.Euler((-(MIP.tiltDeg ?? 15) * Math.PI) / 180, 0, 0)).name = 'mip_backing';
  // ---- MIP side fillers between the panel ends and the sidewalls.
  for (const s of [-1, 1]) {
    const yIn = MIP.width / 2;
    const yOut = F.halfWidth(MIP.center_m[0], 0.05, INSET) - 0.02;
    if (yOut > yIn + 0.01) add(new THREE.BoxGeometry(yOut - yIn, MIP.height + 0.02, 0.03), 'panel', 'mip_side', [MIP.center_m[0] + 0.02, s * (yIn + yOut) / 2, MIP.center_m[2]]);
  }

  // ---- knee areas and foot wells under P1 / P3 (dark grey), forward wall. SCBG drawing: the MIP lower strips
  // end flush (no knee bolster bars); a flush dark skirt closes the underside from the strip bottom edge
  // (z ~0.127) forward to the foot-well wall.
  for (const s of [-1, 1]) {
    const w = MIP.width / 2 - P9.width / 2;
    const zSkirt = 0.135;
    add(new THREE.BoxGeometry(14.86 - 14.51, 0.006, w + 0.02).rotateY(Math.PI / 2), 'panelDark', 'knee_skirt', [(14.86 + 14.51) / 2, s * (P9.width / 2 + w / 2), zSkirt]);
    add(new THREE.PlaneGeometry(w + 0.25, FLOOR_Z - zSkirt).rotateY(0), 'panelDark', 'footwell', [14.86, s * (P9.width / 2 + (w + 0.25) / 2), (FLOOR_Z + zSkirt) / 2]);
  }

  // ---- pedestal bodies (dark grey): P9 forward electronic panel box, control stand, aft electronic panel.
  const pedMat = 'panelDark';
  {
    // P9 body: wedge under the sloping P9 face (top from x 14.535 z 0.04 down to the stand front x 14.24 z 0.40).
    const xF = 14.545;
    const xA = 14.23;
    add(pedestalGeometry(P9.width, xF - xA, FLOOR_Z - 0.405, FLOOR_Z - 0.047, 0.01), pedMat, 'p9_body', [(xF + xA) / 2, 0, FLOOR_Z]);
  }
  add(pedestalGeometry(STAND.width, STAND.xFwd - STAND.xAft, FLOOR_Z - STAND.aftZ - 0.004, FLOOR_Z - STAND.fwdZ - 0.004, 0.012), pedMat, 'control_stand', [(STAND.xFwd + STAND.xAft) / 2, 0, FLOOR_Z]);
  add(pedestalGeometry(AFT_PED.width, AFT_PED.xFwd - AFT_PED.xAft, FLOOR_Z - AFT_PED.topZ - 0.004, FLOOR_Z - AFT_PED.topZ - 0.004, 0.012), pedMat, 'aft_pedestal', [(AFT_PED.xFwd + AFT_PED.xAft) / 2, 0, FLOOR_Z]);

  // ---- sidewall shelves (left: tiller; right: F/O console front), EST.
  for (const s of [-1, 1]) {
    const sh = SIDE_SHELF;
    const w = sh.yOut - sh.yIn;
    add(trimBoxGeometry(w, 0.03, sh.xFwd - sh.xAft, 0.008), 'panel', 'side_shelf', [(sh.xFwd + sh.xAft) / 2, s * (sh.yIn + w / 2), sh.z + 0.015]);
    add(new THREE.BoxGeometry(w, FLOOR_Z - sh.z - 0.03, sh.xFwd - sh.xAft), 'panelDark', 'side_shelf_body', [(sh.xFwd + sh.xAft) / 2, s * (sh.yIn + w / 2 + 0.02), (FLOOR_Z + sh.z + 0.03) / 2]);
  }

  // ---- crew seats
  b.seat('airline', SEAT_L);
  b.seat('airline', SEAT_R);
}

/**
 * Windshield wipers (FCOM 3.20 "Windshield wipers"): one blade per No. 1 windshield, pivoting at the lower
 * outboard part of the sill and parking along the sill toward the centre post; the blade sweeps up across the
 * glass with `ac.b738.wiper_sweep{1,2}` (logic.ts: 0 parked .. 1 full sweep, AC motor powered). Pivot position,
 * blade length (EST ~0.55 m) and sweep (EST ~65 deg) from 737NG photographs. Dynamic meshes (not merged).
 */
export function buildWipers(b: CockpitBuilder, vars: { get(n: string): number }): void {
  const mat = b.env.materials.custom('paint', 0x1a1a1a, 0.5);
  const L = 0.55;
  const SWEEP = (65 * Math.PI) / 180;
  const blades: { m: THREE.Mesh; piv: THREE.Vector3; park: THREE.Vector3; up: THREE.Vector3; v: string }[] = [];
  for (const side of [1, -1] as const) {
    // Right side (theta > 0) = F/O wiper 2, left = Captain wiper 1.
    const th = side * 0.62;
    const x = xAtZ(Math.abs(th), WS_SILL_Z) - 0.03;
    const piv = F.point(x, th, -0.012);
    const a = F.point(x, th - side * 0.05, -0.012).sub(piv).normalize(); // along the sill toward the centre post
    const up = F.point(x + 0.05, th, -0.012).sub(piv);
    up.addScaledVector(a, -up.dot(a)).normalize(); // up the glass, orthogonal to the sill direction
    const geo = new THREE.BoxGeometry(L, 0.012, 0.008).translate(L / 2, 0, 0);
    b.trackGeometry(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = `wiper_blade_${side > 0 ? 2 : 1}`;
    b.addStructure(m, undefined, { occluder: false, static: false });
    m.position.copy(piv);
    blades.push({ m, piv, park: a, up, v: `ac.b738.wiper_sweep${side > 0 ? 2 : 1}` });
  }
  const X = new THREE.Vector3(1, 0, 0);
  const dir = new THREE.Vector3();
  const prev = [NaN, NaN];
  b.onUpdate(() => {
    for (let k = 0; k < blades.length; k++) {
      const w = blades[k];
      const s = vars.get(w.v);
      if (s === prev[k]) continue;
      prev[k] = s;
      const ang = s * SWEEP;
      dir.copy(w.park).multiplyScalar(Math.cos(ang)).addScaledVector(w.up, Math.sin(ang)).normalize();
      w.m.quaternion.setFromUnitVectors(X, dir);
    }
  });
}
