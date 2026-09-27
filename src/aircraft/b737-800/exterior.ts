/**
 * Procedural exterior of the Boeing 737-800 with blended winglets.
 *
 * Dimensions (ACAPS D6-58325-6 §2.2 / 2.3, dossier §2): length 39.47 m,
 * span 35.79 m over the winglets (34.32 m basic), tail height 12.55 m, wing
 * area 124.58 m², quarter-chord sweep 25°, wheelbase 15.6 m, main gear
 * track 5.72 m, fuselage 3.76 m wide. Anchors from fdm.ts: datum 3.2 m above
 * the ground, main gear x -1.346 / y ±2.86, nose gear x 14.254, engine
 * centrelines x 2.5 / y ±4.83 / 1.6 m above the ground, wing root at z 0.6,
 * LEMAC x 0.831 (MAC 3.958 m). Shapes between the anchors (planform kink,
 * dihedral 6°, tail surfaces, nacelle "hamster pouch" flattened lower lip,
 * winglet ~2.4 m tall) are EST from published three-view drawings.
 *
 * Animated in `update(dt)` from SimVars: gear retraction (gear.pos*, the
 * mains fold inboard into the open wheel wells without doors, the nose gear
 * forward), strut compression, nose-wheel steering, wheel spin; trailing-edge
 * flaps (surf.flaps_deg, double-slotted with aft travel), leading-edge slats
 * (surf.slats), ailerons, flight / ground spoilers, elevators, rudder,
 * stabilizer incidence (trim.pitch_units), fan rotation (eng*.n1_pct),
 * translating-sleeve reversers (eng*.reverser_pos), APU inlet door; exterior
 * lights from the LightingSystem outputs (light.*): real spot lights in
 * candela through the world's render_units_per_lux scale.
 *
 * Livery-neutral white with subtle panel lines (procedural texture).
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { loftWing, type WingSection } from '../_test/loft';
import { B738_FUSELAGE as F, B738_WINDOWS, loftSkin, mirrorPoly, skinShape } from './cockpit/fuselage';
import { MAIN_GEAR_X, NOSE_GEAR_X } from './fdm';

const D2R = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const TAIL_X = -22.756;
const NOSE_X = 16.714;

/** Wing planform (right side): LE sweep ~28° (25° at c/4), TE kink at y 5.4, dihedral 6°. */
const WING_ROOT_Y = 1.7;
const KINK_Y = 5.4;
export const TIP_Y = 17.16; // basic span 34.32 m / 2
const LE_ROOT_X = 3.29; // LEMAC 0.831 at y ~6.5
const LE_TAN = Math.tan(28 * D2R);
const DIHEDRAL = 6 * D2R;
const WING_Z = 0.6;
function chordAt(y: number): number {
  if (y <= KINK_Y) return 6.4 + ((4.35 - 6.4) * (y - WING_ROOT_Y)) / (KINK_Y - WING_ROOT_Y);
  return 4.35 + ((1.25 - 4.35) * (y - KINK_Y)) / (TIP_Y - KINK_Y);
}
function wingAt(y: number): { xLe: number; chord: number; z: number } {
  return { xLe: LE_ROOT_X - (y - WING_ROOT_Y) * LE_TAN, chord: chordAt(y), z: WING_Z - (y - WING_ROOT_Y) * Math.tan(DIHEDRAL) };
}
function sec(y: number, t: number, twistDeg = 0): WingSection {
  return { y, ...wingAt(y), t, twistDeg };
}
/** Thickness: ~15 % root, ~10 % tip (EST, BAC 449-451 sections). */
const tAt = (y: number) => 0.15 - ((0.15 - 0.105) * (y - WING_ROOT_Y)) / (TIP_Y - WING_ROOT_Y);

interface Movable {
  obj: THREE.Object3D;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
  basePos: THREE.Vector3;
  slide?: THREE.Vector3;
}

export interface B738Exterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

function panelLineTexture(): THREE.DataTexture {
  const W = 1024;
  const H = 256;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const ring = x % 26 === 0;
      const lap = y % 43 === 0;
      const v = ring || lap ? 222 : 250;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = Math.min(255, v + 2);
      d[o + 3] = 255;
    }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createB738Exterior(vars: SimVars): B738Exterior {
  const root = new THREE.Group();
  root.name = 'exterior';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const skinTex = track(panelLineTexture());
  skinTex.repeat.set(1 / 40, 1 / 12);
  const skin = track(new THREE.MeshStandardMaterial({ color: 0xffffff, map: skinTex, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide }));
  const paint = track(new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.34, metalness: 0.05, side: THREE.DoubleSide }));
  const grey = track(new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide }));
  const radome = track(new THREE.MeshStandardMaterial({ color: 0xdadcdf, roughness: 0.5, metalness: 0.02, side: THREE.DoubleSide }));
  const leMetal = track(new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.85, side: THREE.DoubleSide }));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xb2b6bc, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }));
  const glass = track(new THREE.MeshStandardMaterial({ color: 0x0a1016, roughness: 0.05, metalness: 0.7, side: THREE.DoubleSide }));
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }));
  const chrome = track(new THREE.MeshStandardMaterial({ color: 0xe2e2e2, roughness: 0.12, metalness: 1 }));
  const gearPaint = track(new THREE.MeshStandardMaterial({ color: 0xd4d6d8, roughness: 0.4, metalness: 0.25 }));
  const wellMat = track(new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));
  const cascade = track(new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D = root): THREE.Mesh => {
    track(g);
    const me = new THREE.Mesh(g, m);
    me.name = name;
    me.castShadow = true;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };
  const group = (name: string, parent: THREE.Object3D = root): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };

  // ---------------------------------------------------------------- fuselage
  const body = group('fuselage');
  mesh(loftSkin(TAIL_X, 14.9, 0, TWO_PI, 180, 64), skin, 'cabin', body);
  const nose = group('nose');
  nose.userData.visibleFromCockpit = true;
  mesh(loftSkin(14.9, 15.75, 0, TWO_PI, 14, 64), paint, 'nose', nose);
  mesh(loftSkin(15.75, NOSE_X, 0, TWO_PI, 16, 64), radome, 'radome', nose);
  // Flight-deck glazing (same polygons as the cockpit shell openings).
  const glz = group('glazing', body);
  for (const w of [B738_WINDOWS.w1, B738_WINDOWS.w2, B738_WINDOWS.w3]) {
    mesh(skinShape(w, [], { inset: -0.006, maxEdge: 0.08 }), glass, 'ws_r', glz);
    mesh(skinShape(mirrorPoly(w), [], { inset: -0.006, maxEdge: 0.08 }), glass, 'ws_l', glz);
  }
  // Cabin windows: 737-800 window pitch 20 in (0.508 m), EST ~0.25 x 0.36 m rounded windows, rows broken at the exits.
  const winShape = new THREE.Shape();
  {
    const w = 0.24;
    const h = 0.34;
    const r = 0.1;
    winShape.moveTo(-w / 2 + r, -h / 2);
    winShape.lineTo(w / 2 - r, -h / 2);
    winShape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    winShape.lineTo(w / 2, h / 2 - r);
    winShape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    winShape.lineTo(-w / 2 + r, h / 2);
    winShape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    winShape.lineTo(-w / 2, -h / 2 + r);
    winShape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  }
  const winGeo = track(new THREE.ShapeGeometry(winShape, 6));
  const winXs: number[] = [];
  for (let x = 10.3; x > -12.2; x -= 0.508) {
    // Gaps at the overwing exits (x ~ +0.9 / +0.1) and the doors.
    if (Math.abs(x - 0.5) < 0.62) continue;
    winXs.push(x);
  }
  const wins = new THREE.InstancedMesh(winGeo, glass, winXs.length * 2);
  wins.name = 'cabin_windows';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const x of winXs)
    for (const side of [1, -1]) {
      const th = side * F.thetaAt(x, -0.45);
      F.point(x, th, -0.008, pv);
      q.setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, 0, 'YXZ'));
      m4.compose(pv, q, one);
      wins.setMatrixAt(k++, m4);
    }
  body.add(wins);
  // Door outlines (thin grey seams): L1 / R1 forward, L2 / R2 aft (EST 0.86 x 1.83 m), overwing exits.
  const seam = (x0: number, x1: number, z0: number, z1: number, side: number, name: string) => {
    const t0 = side * F.thetaAt((x0 + x1) / 2, z1);
    const t1 = side * F.thetaAt((x0 + x1) / 2, z0);
    const [ta, tb] = t0 < t1 ? [t0, t1] : [t1, t0];
    const e = 0.012;
    mesh(loftSkin(x0, x1, ta, ta + e, 8, 1, { inset: -0.004 }), grey, name, body);
    mesh(loftSkin(x0, x1, tb - e, tb, 8, 1, { inset: -0.004 }), grey, name, body);
    mesh(loftSkin(x0, x0 + 0.012, ta, tb, 1, 6, { inset: -0.004 }), grey, name, body);
    mesh(loftSkin(x1 - 0.012, x1, ta, tb, 1, 6, { inset: -0.004 }), grey, name, body);
  };
  for (const side of [-1, 1]) {
    seam(11.1, 11.96, -1.33, 0.5, side, 'door_fwd');
    seam(-12.7, -11.84, -1.25, 0.5, side, 'door_aft');
    seam(0.55, 1.06, -0.9, 0.08, side, 'overwing_exit');
    seam(-0.1, 0.41, -0.9, 0.08, side, 'overwing_exit');
  }
  // Wing-to-body fairing (belly bulge from the wing LE to aft of the gear wells).
  const fair = group('wing_fairing', body);
  for (const side of [-1, 1]) {
    const shape: [number, number][] = [
      [4.3, side * 2.45],
      [4.3, side * 3.14],
      [-4.4, side * 3.14],
      [-4.4, side * 2.45],
    ];
    mesh(skinShape(shape, [], { inset: -0.12, maxEdge: 0.25 }), paint, 'fairing', fair);
  }
  mesh(loftSkin(-4.4, 4.3, Math.PI - 0.72, Math.PI + 0.72, 30, 12, { inset: -0.12 }), paint, 'fairing_belly', fair);

  // ---------------------------------------------------------------- wings, surfaces, winglets
  const wings = group('wings');
  wings.userData.visibleFromCockpit = true;
  const movables: Record<string, Movable[]> = {
    flapInL: [], flapInR: [], flapOutL: [], flapOutR: [], ailL: [], ailR: [], slatL: [], slatR: [],
    splFlL: [], splFlR: [], splGndL: [], splGndR: [], elevL: [], elevR: [], rudder: [],
  };
  const hinge = (name: string, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D, slideBody?: [number, number, number]) => {
    const pivot = new THREE.Group();
    pivot.name = `${name}_hinge`;
    pivot.position.copy(bl(...pivotBody));
    parent.add(pivot);
    g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    mesh(g, m, name, pivot);
    const slide = slideBody ? bl(...slideBody).sub(bl(0, 0, 0)) : undefined;
    movables[name].push({ obj: pivot, axis: bl(...axisBody).sub(bl(0, 0, 0)).normalize(), base: pivot.quaternion.clone(), basePos: pivot.position.clone(), slide });
  };
  const HINGE_C = 0.72; // TE devices from 72 % chord (EST)
  const FLAP_IN: [number, number] = [WING_ROOT_Y + 0.25, KINK_Y + 0.2];
  const FLAP_OUT: [number, number] = [KINK_Y + 0.3, 12.3];
  const AIL: [number, number] = [12.4, 16.2];
  const SLAT: [number, number] = [5.9, 16.8];
  const SLAT_C = 0.14;
  for (const mirror of [false, true]) {
    const sg = mirror ? -1 : 1;
    const L = mirror ? 'L' : 'R';
    const S = (y: number) => sec(y, tAt(y));
    // Wing box: slat chord outboard of the engine is movable, so the fixed box starts aft of it there.
    mesh(loftWing([S(WING_ROOT_Y), S(KINK_Y), S(SLAT[0])], { mirror, chordRange: [0, HINGE_C], n: 18 }), paint, `wing_in_${L}`, wings);
    mesh(loftWing([S(SLAT[0]), S(KINK_Y + 0.6), S(SLAT[1]), S(TIP_Y)].sort((a, b) => a.y - b.y), { mirror, chordRange: [SLAT_C, HINGE_C], n: 16 }), paint, `wing_out_${L}`, wings);
    mesh(loftWing([S(SLAT[1]), S(TIP_Y)], { mirror, chordRange: [0, SLAT_C], n: 6 }), leMetal, `wing_tip_le_${L}`, wings);
    // Fixed TE between the devices.
    mesh(loftWing([S(WING_ROOT_Y), S(FLAP_IN[0])], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_root', wings);
    mesh(loftWing([S(FLAP_IN[1]), S(FLAP_OUT[0])], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_kink', wings);
    mesh(loftWing([S(AIL[1]), S(TIP_Y)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_tip', wings);
    mesh(loftWing([S(FLAP_OUT[1]), S(AIL[0])], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_gap', wings);
    const hx = (s: WingSection, f: number) => s.xLe - f * s.chord;
    const dev = (name: string, y0: number, y1: number, c0: number, c1: number, m: THREE.Material, slide?: [number, number, number]) => {
      const a = S(y0);
      const b = S(y1);
      const piv: [number, number, number] = [hx(a, c0), sg * a.y, a.z];
      const axis: [number, number, number] = [hx(b, c0) - hx(a, c0), sg * (b.y - a.y), b.z - a.z];
      hinge(name, loftWing([a, b], { mirror, chordRange: [c0, c1] }), piv, axis, m, wings, slide);
    };
    // Double-slotted flaps: rotate and move aft (Fowler travel ~0.9 m at 40, EST).
    dev(`flapIn${L}`, FLAP_IN[0], FLAP_IN[1], HINGE_C, 1, paint, [-0.9, 0, 0.25]);
    dev(`flapOut${L}`, FLAP_OUT[0], FLAP_OUT[1], HINGE_C, 1, paint, [-0.7, 0, 0.2]);
    dev(`ail${L}`, AIL[0], AIL[1], HINGE_C, 1, paint);
    // Slats: move forward and droop (EST 0.35 m travel, 20 deg droop at full extend).
    dev(`slat${L}`, SLAT[0], SLAT[1], 0, SLAT_C, leMetal, [0.35, 0, 0.12]);
    // Inboard Krueger flaps (not animated separately: part of the fixed LE in this model, SCOPE).
    mesh(loftWing([S(WING_ROOT_Y + 0.1), S(SLAT[0] - 1.9)], { mirror, chordRange: [0, 0.06], n: 6 }), leMetal, 'krueger_le', wings);
    // Spoilers: flight spoilers (4 panels, y 6.0-11.8) and ground spoilers (2 panels inboard), hinged at their LE.
    const splr = (name: string, y0: number, y1: number) => {
      const w0 = wingAt(y0);
      const w1 = wingAt(y1);
      const f0 = 0.55;
      const f1 = 0.71;
      const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sg * y, w.z - 0.045 * w.chord * (1 - f * 0.8) - 0.012);
      const a = P(y0, w0, f0);
      const b2 = P(y1, w1, f0);
      const c2 = P(y1, w1, f1);
      const d2 = P(y0, w0, f1);
      const g = new THREE.BufferGeometry();
      g.setFromPoints(mirror ? [a, c2, b2, a, d2, c2] : [a, b2, c2, a, c2, d2]);
      g.computeVertexNormals();
      const piv: [number, number, number] = [w0.xLe - f0 * w0.chord, sg * y0, w0.z - 0.045 * w0.chord * (1 - f0 * 0.8) - 0.012];
      hinge(name, g, piv, [w1.xLe - w0.xLe - f0 * (w1.chord - w0.chord), sg * (y1 - y0), w1.z - w0.z], grey, wings);
    };
    for (let i = 0; i < 4; i++) splr(`splFl${L}`, 6.1 + i * 1.45, 6.1 + (i + 1) * 1.45 - 0.05);
    for (let i = 0; i < 2; i++) splr(`splGnd${L}`, 2.2 + i * 1.6, 2.2 + (i + 1) * 1.6 - 0.05);
    // Blended winglet (Aviation Partners): ~2.4 m tall, canted ~15 deg outboard, 0.735 m span increase each side (ACAPS 35.79 m).
    const tip = wingAt(TIP_Y);
    const wl = group(`winglet_${L}`, wings);
    wl.position.copy(bl(tip.xLe - 0.05, sg * (TIP_Y - 0.08), tip.z));
    wl.rotation.z = -sg * 16 * D2R;
    const wlSecs: WingSection[] = [
      { y: 0, xLe: 0, chord: 1.3, z: 0, t: 0.1 },
      { y: 0.45, xLe: -0.55, chord: 0.95, z: 0, t: 0.09 },
      { y: 2.45, xLe: -1.9, chord: 0.5, z: 0, t: 0.08 },
    ];
    mesh(loftWing(wlSecs, { vertical: true }), paint, 'winglet', wl);
  }

  // ---------------------------------------------------------------- engines (CFM56-7B26)
  const engines = group('engines');
  engines.userData.visibleFromCockpit = true;
  const fans: THREE.Object3D[] = [];
  const sleeves: THREE.Object3D[] = [];
  const NAC_LEN = 4.0; // EST nacelle + exhaust
  const NAC_R = 1.02; // EST max half-width (fan 61 in = 1.55 m, E004)
  const ENG_X = 2.5;
  for (const y of [-4.83, 4.83]) {
    const g = group(y < 0 ? 'engine_l' : 'engine_r', engines);
    g.position.copy(bl(ENG_X, y, 1.6));
    const prof: THREE.Vector2[] = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let r: number;
      if (t < 0.07) r = NAC_R * (0.84 + 0.16 * Math.sin((t / 0.07) * (Math.PI / 2)));
      else if (t < 0.5) r = NAC_R;
      else r = NAC_R * (1 - 0.35 * ((t - 0.5) / 0.5) ** 1.5);
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.52 - t * NAC_LEN * 0.82));
    }
    const nac = new THREE.LatheGeometry(prof, 48);
    nac.rotateX(-Math.PI / 2);
    // Flattened lower lip ("hamster pouch": accessories moved to the sides for ground clearance), EST 12 %.
    const pa = nac.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) if (pa.getY(i) < 0) pa.setY(i, pa.getY(i) * 0.86);
    pa.needsUpdate = true;
    nac.computeVertexNormals();
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(NAC_R * 0.86, 0.05, 10, 48);
    lip.scale(1, 0.93, 1);
    mesh(lip, leMetal, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.52, 0, 0.0));
    const duct = new THREE.CylinderGeometry(NAC_R * 0.82, NAC_R * 0.82, 0.7, 40, 1, true);
    duct.rotateX(Math.PI / 2);
    mesh(duct, dark, 'inlet_duct', g).position.copy(bl(NAC_LEN * 0.52 - 0.35, 0, 0));
    const fan = group('fan', g);
    fan.position.copy(bl(NAC_LEN * 0.52 - 0.62, 0, 0));
    mesh(new THREE.CircleGeometry(NAC_R * 0.8, 40), dark, 'fan_disc', fan);
    const blade = new THREE.BoxGeometry(0.1, NAC_R * 1.56, 0.015);
    for (let bI = 0; bI < 24; bI++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.015;
      bm.rotation.z = (bI / 24) * Math.PI;
      bm.rotation.y = 0.5;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.28, 0.55, 24);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, metal, 'spinner', fan).position.z = -0.27;
    fans.push(fan);
    // Translating sleeve (thrust reverser): moves aft ~0.55 m and exposes the cascades (EST).
    const sleeve = group('rev_sleeve', g);
    const sl = new THREE.CylinderGeometry(NAC_R * 1.003, NAC_R * 0.95, 0.9, 44, 1, true);
    sl.rotateX(Math.PI / 2);
    mesh(sl, grey, 'sleeve', sleeve).position.copy(bl(-0.35, 0, 0));
    sleeves.push(sleeve);
    const cas = new THREE.CylinderGeometry(NAC_R * 0.96, NAC_R * 0.96, 0.55, 44, 1, true);
    cas.rotateX(Math.PI / 2);
    mesh(cas, cascade, 'cascades', g).position.copy(bl(0.15, 0, 0));
    // Core exhaust nozzle and plug.
    const noz = new THREE.CylinderGeometry(0.46, 0.52, 0.8, 32, 1, true);
    noz.rotateX(Math.PI / 2);
    mesh(noz, metal, 'core_nozzle', g).position.copy(bl(-NAC_LEN * 0.3 - 0.4, 0, 0));
    const plug = new THREE.ConeGeometry(0.3, 0.9, 24);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.3 - 1.1, 0, 0));
    // Pylon from the nacelle top to the wing lower surface.
    const w = wingAt(Math.abs(y));
    const pyl = new THREE.BoxGeometry(0.34, 0.9, 3.6);
    const pm = mesh(pyl, paint, 'pylon', engines);
    pm.position.copy(bl(ENG_X - 0.6, y, (1.6 - NAC_R + w.z + 0.25) / 2 - 0.1));
  }

  // ---------------------------------------------------------------- tail: fin + rudder, stabilizer + elevators
  const tail = group('tail');
  const FIN_ROOT_Z = -1.62;
  const FIN_H = 7.7; // to the fin tip at 12.55 m (ACAPS) above the ground: z = 3.2 - 12.55 = -9.35
  const fin: WingSection[] = [
    { y: 0, xLe: -13.9, chord: 6.6, z: FIN_ROOT_Z, t: 0.11 },
    { y: FIN_H, xLe: -13.9 - FIN_H * Math.tan(37 * D2R), chord: 1.9, z: FIN_ROOT_Z, t: 0.1 },
  ];
  // Dorsal fin fairing.
  mesh(loftWing([{ y: 0, xLe: -10.5, chord: 3.8, z: FIN_ROOT_Z + 0.05, t: 0.05 }, { y: 0.7, xLe: -13.2, chord: 1.8, z: FIN_ROOT_Z + 0.05, t: 0.08 }], { vertical: true }), paint, 'dorsal', tail);
  const RUD = 0.7;
  mesh(loftWing(fin, { vertical: true, chordRange: [0, RUD] }), paint, 'fin', tail);
  const finAt = (h: number) => ({ xLe: fin[0].xLe + (fin[1].xLe - fin[0].xLe) * (h / FIN_H), chord: fin[0].chord + (fin[1].chord - fin[0].chord) * (h / FIN_H) });
  const r0 = finAt(0.3);
  const r1 = finAt(FIN_H - 0.2);
  hinge(
    'rudder',
    loftWing([{ y: 0.3, ...r0, z: FIN_ROOT_Z, t: 0.11 }, { y: FIN_H - 0.2, ...r1, z: FIN_ROOT_Z, t: 0.1 }], { vertical: true, chordRange: [RUD, 1] }),
    [r0.xLe - RUD * r0.chord, 0, FIN_ROOT_Z - 0.3],
    [r1.xLe - RUD * r1.chord - (r0.xLe - RUD * r0.chord), 0, -(FIN_H - 0.5)],
    paint,
    tail,
  );
  // Stabilizer: whole surface pivots about its rear spar for trim.
  const STAB_Z = -1.05;
  const stabPivotX = -19.9;
  const stabG = group('stabilizer', tail);
  stabG.position.copy(bl(stabPivotX, 0, STAB_Z));
  const stabInner = group('stab_inner', stabG);
  stabInner.position.copy(bl(0, 0, 0).sub(bl(stabPivotX, 0, STAB_Z)));
  const STAB_SPAN = 7.18; // 14.35 m span (EST, ACAPS three-view)
  const stab: WingSection[] = [
    { y: 0.6, xLe: -17.3, chord: 4.1, z: STAB_Z, t: 0.1 },
    { y: STAB_SPAN, xLe: -17.3 - (STAB_SPAN - 0.6) * Math.tan(30 * D2R), chord: 1.3, z: STAB_Z - (STAB_SPAN - 0.6) * Math.tan(7 * D2R), t: 0.09 },
  ];
  const ELEV = 0.7;
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, ELEV] }), paint, 'stab', stabInner);
    const s0 = stab[0];
    const s1 = stab[1];
    const sg = mirror ? -1 : 1;
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [ELEV, 1] }), [s0.xLe - ELEV * s0.chord, sg * s0.y, s0.z], [s1.xLe - ELEV * s1.chord - (s0.xLe - ELEV * s0.chord), sg * (s1.y - s0.y), s1.z - s0.z], paint, stabInner);
  }
  // APU exhaust and inlet door (right side of the tail cone).
  const apuEx = new THREE.CylinderGeometry(0.13, 0.13, 0.25, 16, 1, true);
  apuEx.rotateX(Math.PI / 2);
  mesh(apuEx, dark, 'apu_exhaust', tail).position.copy(bl(TAIL_X + 0.1, 0, -1.2));
  const apuDoor = group('apu_door', tail);
  apuDoor.position.copy(bl(-19.2, F.bodyYZ(-19.2, 1.2)[0], F.bodyYZ(-19.2, 1.2)[1]));
  mesh(new THREE.BoxGeometry(0.02, 0.28, 0.5).translate(0, 0.14, 0), grey, 'apu_inlet_door', apuDoor);

  // ---------------------------------------------------------------- landing gear
  interface GearLeg {
    index: number;
    pivot: THREE.Group;
    strut: THREE.Group;
    steer: THREE.Group;
    wheels: THREE.Object3D[];
    travel: number;
    axis: THREE.Vector3;
    angle: number;
    radius: number;
  }
  const legs: GearLeg[] = [];
  const CONTACT_Z = 3.36; // fdm.ts MAIN_EXT_Z = NOSE_EXT_Z (full extension)
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, axis: [number, number, number], angle: number, strutR: number) => {
    const pivot = group(`gear${index}`);
    pivot.position.copy(bl(contact[0], contact[1], pivotZ));
    const strut = group('strut', pivot);
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(strutR, strutR, len * 0.72, 16);
    mesh(oleo, gearPaint, 'oleo', strut).position.y = -len * 0.36;
    const piston = new THREE.CylinderGeometry(strutR * 0.72, strutR * 0.72, len * 0.4, 14);
    mesh(piston, chrome, 'piston', strut).position.y = -len * 0.78;
    const steer = group('steer', strut);
    steer.position.y = -len;
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.68, radius * 0.32, 14, 30);
    tg.rotateY(Math.PI / 2);
    tg.scale(width / (radius * 0.64), 1, 1);
    const hub = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width * 0.92, 20);
    hub.rotateZ(Math.PI / 2);
    const axle = new THREE.CylinderGeometry(0.05, 0.05, width * 2.4, 10);
    axle.rotateZ(Math.PI / 2);
    mesh(axle, metal, 'axle', steer);
    for (const off of [-width * 0.62, width * 0.62]) {
      const w = new THREE.Group();
      w.position.x = off;
      steer.add(w);
      mesh(tg.clone(), tyre, 'tyre', w);
      mesh(hub.clone(), metal, 'hub', w);
      wheels.push(w);
    }
    tg.dispose();
    hub.dispose();
    legs.push({ index, pivot, strut, steer, wheels, travel, axis: bl(...axis).sub(bl(0, 0, 0)).normalize(), angle, radius });
  };
  // Nose: 27 x 7.75 R15 twin wheels (EST 0.69 m), retracts forward into the nose bay (FCOM 14.20).
  makeLeg(0, [NOSE_GEAR_X, 0, CONTACT_Z], 1.75, 0.345, 0.2, 0.3, [0, 1, 0], -95 * D2R, 0.09);
  // Mains: H44.5 x 16.5-21 dual wheels (EST 1.13 m), retract inboard; no main wheel doors (wheels flush in the belly).
  makeLeg(1, [MAIN_GEAR_X, -2.86, CONTACT_Z], 1.3, 0.565, 0.42, 0.4, [1, 0, 0], -88 * D2R, 0.13);
  makeLeg(2, [MAIN_GEAR_X, 2.86, CONTACT_Z], 1.3, 0.565, 0.42, 0.4, [1, 0, 0], 88 * D2R, 0.13);
  // Nose gear doors (two, along the keel) and the main-gear strut doors on the wing.
  const doorPivots: { obj: THREE.Group; axis: THREE.Vector3; open: number }[] = [];
  const bayDoor = (name: string, hingeBody: [number, number, number], w: number, len: number, side: number, axisBody: [number, number, number], openRad: number) => {
    const p = group(name);
    p.position.copy(bl(...hingeBody));
    const d = new THREE.BoxGeometry(w, 0.015, len);
    d.translate((side * w) / 2, 0, 0);
    mesh(d, paint, name, p);
    doorPivots.push({ obj: p, axis: bl(...axisBody).sub(bl(0, 0, 0)).normalize(), open: openRad });
  };
  const noseBot = F.bodyYZ(NOSE_GEAR_X, Math.PI)[1];
  bayDoor('nose_door_l', [NOSE_GEAR_X + 0.1, -0.3, noseBot - 0.02], 0.29, 1.7, 1, [1, 0, 0], 85 * D2R);
  bayDoor('nose_door_r', [NOSE_GEAR_X + 0.1, 0.3, noseBot - 0.02], 0.29, 1.7, -1, [1, 0, 0], -85 * D2R);
  mesh(new THREE.BoxGeometry(0.58, 0.4, 1.8), wellMat, 'nose_well', body).position.copy(bl(NOSE_GEAR_X + 0.1, 0, noseBot - 0.22));
  for (const side of [-1, 1]) mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 24).rotateZ(Math.PI / 2), wellMat, 'main_well', body).position.copy(bl(MAIN_GEAR_X, side * 1.3, 1.36));

  // ---------------------------------------------------------------- lights
  const GLOW = 64;
  const glowData = new Uint8Array(GLOW * GLOW * 4);
  for (let y = 0; y < GLOW; y++)
    for (let x = 0; x < GLOW; x++) {
      const r = Math.hypot(x + 0.5 - GLOW / 2, y + 0.5 - GLOW / 2) / (GLOW / 2);
      const a = Math.max(0, 1 - r);
      const o = (y * GLOW + x) * 4;
      glowData[o] = glowData[o + 1] = glowData[o + 2] = 255;
      glowData[o + 3] = Math.round(255 * a * a * a);
    }
  const glowTex = track(new THREE.DataTexture(glowData, GLOW, GLOW));
  glowTex.needsUpdate = true;
  interface Lamp {
    m: THREE.MeshBasicMaterial;
    halo: THREE.SpriteMaterial;
    color: THREE.Color;
  }
  const lamp = (color: number, pos: [number, number, number], size = 0.06, parent: THREE.Object3D = root, halo = 14): Lamp => {
    const m = track(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const me = mesh(new THREE.SphereGeometry(size, 10, 8), m, 'lamp', parent);
    me.castShadow = false;
    me.receiveShadow = false;
    me.position.copy(bl(...pos));
    const hm = track(new THREE.SpriteMaterial({ color, map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const sp = new THREE.Sprite(hm);
    sp.scale.setScalar(size * halo);
    sp.position.copy(me.position);
    sp.name = 'lamp_halo';
    parent.add(sp);
    return { m, halo: hm, color: new THREE.Color(color) };
  };
  const lightsG = group('lights');
  lightsG.userData.visibleFromCockpit = true;
  const tip = wingAt(TIP_Y);
  // Position lights in the wingtip leading edge (red left, green right), white aft position lights on the tip TE (14 CFR 25.1385-1391).
  const navL = lamp(0xff1a1a, [tip.xLe - 0.1, -(TIP_Y + 0.02), tip.z], 0.05, lightsG);
  const navR = lamp(0x19ff4a, [tip.xLe - 0.1, TIP_Y + 0.02, tip.z], 0.05, lightsG);
  const navTL = lamp(0xffffff, [tip.xLe - tip.chord - 0.05, -(TIP_Y - 0.05), tip.z], 0.04, lightsG);
  const navTR = lamp(0xffffff, [tip.xLe - tip.chord - 0.05, TIP_Y - 0.05, tip.z], 0.04, lightsG);
  // Strobes: wingtips and the tail cone (white).
  const strobeL = lamp(0xffffff, [tip.xLe - 0.3, -(TIP_Y + 0.03), tip.z], 0.05, lightsG, 24);
  const strobeR = lamp(0xffffff, [tip.xLe - 0.3, TIP_Y + 0.03, tip.z], 0.05, lightsG, 24);
  const strobeT = lamp(0xffffff, [TAIL_X + 0.35, 0, -1.4], 0.05, lightsG, 24);
  // Anti-collision beacons: upper fuselage above the wing and lower fuselage (red).
  const beaconTop = lamp(0xff2200, [0.8, 0, F.topZ(0.8) - 0.06], 0.08, lightsG, 16);
  const beaconBot = lamp(0xff2200, [-2.2, 0, F.bodyYZ(-2.2, Math.PI)[1] + 0.2], 0.08, lightsG, 16);
  // Fixed landing lights in the wing-root leading edge, runway turnoff lights next to them; retractable landing lights in the fairing.
  const ldgFixL = lamp(0xfff6e8, [wingAt(3.0).xLe - 0.05, -3.0, wingAt(3.0).z], 0.07, lightsG, 18);
  const ldgFixR = lamp(0xfff6e8, [wingAt(3.0).xLe - 0.05, 3.0, wingAt(3.0).z], 0.07, lightsG, 18);
  const turnL = lamp(0xfff6e8, [wingAt(2.5).xLe - 0.02, -2.5, wingAt(2.5).z], 0.05, lightsG, 14);
  const turnR = lamp(0xfff6e8, [wingAt(2.5).xLe - 0.02, 2.5, wingAt(2.5).z], 0.05, lightsG, 14);
  const retr: THREE.Group[] = [];
  const ldgRetL = lamp(0xfff6e8, [0, 0, 0], 0.07, (retr[0] = group('ldg_retract_l', lightsG)), 18);
  const ldgRetR = lamp(0xfff6e8, [0, 0, 0], 0.07, (retr[1] = group('ldg_retract_r', lightsG)), 18);
  retr[0].position.copy(bl(3.6, -1.95, 1.72));
  retr[1].position.copy(bl(3.6, 1.95, 1.72));
  // Logo lights on the stabilizer upper surfaces (illuminating the fin), wing scan lights on the fuselage ahead of the wing.
  const logoL = lamp(0xfff2dd, [stab[0].xLe - 1.0, -2.2, STAB_Z - 0.25], 0.04, lightsG);
  const logoR = lamp(0xfff2dd, [stab[0].xLe - 1.0, 2.2, STAB_Z - 0.25], 0.04, lightsG);
  const wingSL = lamp(0xfff2dd, [5.2, -1.86, -0.3], 0.04, lightsG);
  const wingSR = lamp(0xfff2dd, [5.2, 1.86, -0.3], 0.04, lightsG);
  const wellLt = lamp(0xfff2dd, [MAIN_GEAR_X, 0, 1.2], 0.04, lightsG);
  const spot = (pos: [number, number, number], target: [number, number, number], angle: number, parent: THREE.Object3D) => {
    const s = new THREE.SpotLight(0xfff4e6, 0, 1500, angle * D2R, 0.4, 2);
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    s.castShadow = false;
    parent.add(s, s.target);
    return s;
  };
  const spotL = spot([wingAt(3.0).xLe, -3.0, wingAt(3.0).z], [120, -8, 9], 10, lightsG);
  const spotR = spot([wingAt(3.0).xLe, 3.0, wingAt(3.0).z], [120, 8, 9], 10, lightsG);
  const taxiParent = legs[0].steer;
  const taxiLamp = track(new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false }));
  const tl = new THREE.Mesh(track(new THREE.SphereGeometry(0.05, 10, 8)), taxiLamp);
  tl.position.set(0, 0.6, -0.12);
  taxiParent.add(tl);
  const taxiSpot = new THREE.SpotLight(0xfff4e6, 0, 500, 26 * D2R, 0.5, 2);
  taxiSpot.position.set(0, 0.6, -0.15);
  taxiSpot.target.position.set(0, -2.5, -30);
  taxiParent.add(taxiSpot, taxiSpot.target);

  for (const c of root.children) if (c.userData.visibleFromCockpit === undefined) c.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const posVar = [0, 1, 2].map((i) => GEAR.pos(i));
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const n1Var = [1, 2].map((i) => ENG.n1(i));
  const revVar = [1, 2].map((i) => ENG.reverserPos(i));
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const setHinge = (list: Movable[], angle: number, slide = 0) => {
    for (const mv of list) {
      mv.obj.quaternion.copy(mv.base).multiply(tmpQ.setFromAxisAngle(mv.axis, angle));
      mv.obj.position.copy(mv.basePos);
      if (mv.slide && slide !== 0) mv.obj.position.add(tmpV.copy(mv.slide).multiplyScalar(slide));
    }
  };
  const fanAngle = [0, 0];
  const wheelAngle = [0, 0, 0];
  const setLamp = (l: Lamp, level: number) => {
    const x = level < 0 ? 0 : level > 1 ? 1 : level;
    l.m.color.copy(l.color).multiplyScalar(0.06 + 0.94 * x);
    l.halo.opacity = x;
  };

  function update(dt: number): void {
    const v = vars;
    for (const leg of legs) {
      const pos = v.get(posVar[leg.index], 1);
      leg.pivot.quaternion.setFromAxisAngle(leg.axis, (1 - pos) * leg.angle);
      leg.strut.position.y = v.get(compVar[leg.index]) * leg.travel;
      if (leg.index === 0) leg.steer.rotation.y = -v.get(GEAR.steerDeg) * D2R;
      const w = (v.get(speedVar[leg.index]) * 0.514444) / leg.radius;
      wheelAngle[leg.index] = (wheelAngle[leg.index] - w * dt) % TWO_PI;
      for (const wh of leg.wheels) wh.rotation.x = wheelAngle[leg.index];
    }
    const doors = v.get('gear.doors');
    for (const d of doorPivots) d.obj.quaternion.setFromAxisAngle(d.axis, d.open * (doors > 0 ? doors : 0));
    // Flaps: 40 deg max deflection shown up to 40 (FCOM detents), Fowler travel proportional (EST: full travel by flaps 15).
    const fd = v.get(SURF.flapsDeg);
    const flaps = Math.min(40, fd) * D2R;
    const fowler = Math.min(1, fd / 15);
    setHinge(movables.flapInR, flaps, fowler);
    setHinge(movables.flapOutR, flaps, fowler);
    setHinge(movables.flapInL, -flaps, fowler);
    setHinge(movables.flapOutL, -flaps, fowler);
    const sl = v.get(SURF.slats);
    setHinge(movables.slatR, -sl * 20 * D2R, sl);
    setHinge(movables.slatL, sl * 20 * D2R, sl);
    const ail = v.get(SURF.aileron) * 20 * D2R; // EST +-20 deg
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    // Spoilers: flight spoilers up to ~38 deg in flight (roll + speedbrake), all panels ~60 deg on the ground (EST).
    const gs = v.get(SURF.groundSpoilers) * 60 * D2R;
    const sb = v.get(SURF.speedbrake);
    const fl = Math.max(Math.min(1, v.get(SURF.spoilerLeft) + sb) * 38 * D2R, gs);
    const fr = Math.max(Math.min(1, v.get(SURF.spoilerRight) + sb) * 38 * D2R, gs);
    setHinge(movables.splFlR, -fr);
    setHinge(movables.splFlL, fl);
    setHinge(movables.splGndR, -gs);
    setHinge(movables.splGndL, gs);
    const elev = v.get(SURF.elevator) * 20 * D2R; // EST
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 24 * D2R);
    // Stabilizer: 0 units ~ +4 deg (LE up, nose down) .. 17 units ~ -12.9 deg (EST: units ~ deg of travel).
    stabG.rotation.x = (-4.2 + v.get('trim.pitch_units', 6) * 0.99) * D2R * -1;
    for (let i = 0; i < 2; i++) {
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 50 * dt * TWO_PI) % TWO_PI;
      fans[i].rotation.z = fanAngle[i];
      sleeves[i].position.z = v.get(revVar[i]) * 0.55;
    }
    apuDoor.rotation.z = -v.get('apu.inlet_door') * 0.6;
    const nav = v.get('light.nav');
    setLamp(navL, nav);
    setLamp(navR, nav);
    setLamp(navTL, nav);
    setLamp(navTR, nav);
    const st = v.get('light.strobe');
    setLamp(strobeL, st);
    setLamp(strobeR, st);
    setLamp(strobeT, v.get('light.strobe_tail'));
    setLamp(beaconTop, v.get('light.beacon'));
    setLamp(beaconBot, v.get('light.beacon_lower'));
    const lfL = v.get('light.landing_l');
    const lfR = v.get('light.landing_r');
    setLamp(ldgFixL, lfL);
    setLamp(ldgFixR, lfR);
    setLamp(turnL, v.get('light.turnoff_l'));
    setLamp(turnR, v.get('light.turnoff_r'));
    const lrL = v.get('light.landing_retract_l');
    const lrR = v.get('light.landing_retract_r');
    setLamp(ldgRetL, lrL);
    setLamp(ldgRetR, lrR);
    retr[0].rotation.x = -v.get('light.landing_retract_l_ext') * 1.3;
    retr[1].rotation.x = -v.get('light.landing_retract_r_ext') * 1.3;
    setLamp(logoL, v.get('light.logo'));
    setLamp(logoR, v.get('light.logo'));
    setLamp(wingSL, v.get('light.wing'));
    setLamp(wingSR, v.get('light.wing'));
    setLamp(wellLt, v.get('light.wheel_well'));
    const taxi = v.get('light.taxi');
    taxiLamp.color.setRGB(0.06 + 0.94 * taxi, 0.06 + 0.94 * taxi, 0.06 + 0.9 * taxi);
    // EST: 600 W PAR-64 class landing lights ~400,000 cd each (fixed + retractable per side combined), taxi ~150,000 cd,
    // turnoff ~60,000 cd (folded into the landing spots' side).
    const kx = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    spotL.intensity = (lfL * 400_000 + lrL * 400_000 + v.get('light.turnoff_l') * 60_000) * kx;
    spotR.intensity = (lfR * 400_000 + lrR * 400_000 + v.get('light.turnoff_r') * 60_000) * kx;
    taxiSpot.intensity = taxi * 150_000 * kx;
  }

  return {
    root,
    update,
    dispose(): void {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) me.geometry.dispose();
      });
      root.removeFromParent();
    },
  };
}
