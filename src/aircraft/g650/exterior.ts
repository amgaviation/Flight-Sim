/**
 * Procedural exterior of the Gulfstream G650 (GVI).
 *
 * Dimensions (GAC / Wikipedia G650): length 99 ft 9 in (30.41 m), span 99 ft
 * 7 in (30.36 m over the winglets), height 25 ft 8 in (7.82 m); wing 1,283
 * ft^2, 36 deg leading-edge sweep, blended winglets, no leading-edge devices,
 * single-slotted Fowler flaps (dossier §1, LUC flaps); oval fuselage with a
 * flatter lower part; eight large elliptical cabin windows per side, 28 in
 * wide (Wikipedia G650); T-tail with a movable horizontal stabilizer (LUC
 * HSTS); two Rolls-Royce BR725 (50 in fan, LUC powerplant) on aft-fuselage
 * pylons with target-type thrust reversers (dossier §2 / fdm.ts); twin-wheel
 * nose and main gear (TCDS tyres: nose 21x7.25-10, mains H37.5x12.0R19),
 * mains retracting inboard, nose forward (LUC drawings); six spoiler panels
 * (inboard / midboard / outboard per wing: roll augmentation mid + outboard
 * up to 55 deg, speed brakes 30 deg in flight, ground spoilers 55 deg with
 * flaps >= 10 deg, LUC).
 *
 * All positions are body metres (x fwd, y right, z down) from the datum
 * (empty CG) and match fdm.ts: gear contacts (nose 12.42 m, mains -1.08 m,
 * track 4.4 m, strut contact z 2.47 extended), nacelle centres (-5.3, -+2.9,
 * -0.9), wing MAC leading edge x 1.90 at the MAC station, winglet tips, tail
 * cone strike point; ground 2.35 m below the datum. Shapes between those
 * anchors are EST from three-view drawings and photographs.
 *
 * Animated in `update(dt)` from SimVars: gear retraction (gear.pos*), doors,
 * strut compression, nosewheel steering, wheel spin; flaps, ailerons,
 * spoilers (roll / speed brake / ground), elevators, rudder, stabilizer
 * incidence (surf.pitch_trim, +-5 deg = STAB_PER_DEG 0.2, logic.ts); fan
 * rotation (eng*.n1_pct), reversers (eng*.reverser_pos); exterior lights from
 * the LightingSystem outputs (light.*), real spot lights in candela through
 * the world's render_units_per_lux scale; main entry door (ac.door.main).
 *
 * Livery-neutral white with subtle panel lines (procedural texture).
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type WingSection } from '../_test/loft';
import { G650_FUSELAGE as F, NOSE_TIP_X, TAIL_CONE_X } from './cockpit/layout';
import { carvedSkin } from './cockpit/glazing';
import { NOSE_GEAR_X, MAIN_X, TRACK_M, SPAN_M } from './fdm';

const D2R = Math.PI / 180;
/** Stations where the carved (glazed) nose section of the skin starts and ends. */
const GLAZED_X0 = 12.9;
const GLAZED_X1 = 15.35;
/** Radome joint. */
const RADOME_X = 16.05;
/** Forward of this station the nose skin is visible from the cockpit (windshield base line, layout.ts GLAZING). */
const NOSE_VISIBLE_X = 14.95;

/** Wing planform, right side (EST: LE sweep 36 deg (GAC), trailing-edge kink at 5.0 m, MAC LE x 1.90 at y ~5.5 (fdm.ts), 3 deg dihedral). */
const DIHEDRAL = Math.tan(3 * D2R);
const WZ = (y: number) => 1.0 - (y - 1.25) * DIHEDRAL;
const XLE = (y: number) => 5.9 - y * Math.tan(36 * D2R);
export const G650_WING: WingSection[] = [
  { y: 1.25, xLe: XLE(1.25), chord: XLE(1.25) + 1.75, z: WZ(1.25), t: 0.14, twistDeg: 2.5 },
  { y: 5.0, xLe: XLE(5.0), chord: XLE(5.0) + 1.93, z: WZ(5.0), t: 0.12, twistDeg: 1 },
  { y: 14.3, xLe: XLE(14.3), chord: 1.5, z: WZ(14.3), t: 0.095, twistDeg: -2.5 },
];
const TIP_Y = 14.3;

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = G650_WING;
  let i = 0;
  while (i < s.length - 2 && y > s[i + 1].y) i++;
  const a = s[i];
  const b = s[i + 1];
  const t = Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
  return { xLe: a.xLe + (b.xLe - a.xLe) * t, chord: a.chord + (b.chord - a.chord) * t, z: a.z + (b.z - a.z) * t };
}

interface Movable {
  obj: THREE.Object3D;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
}

export interface G650Exterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/** Procedural panel-line texture (white skin, faint circumferential joints and lap joints). */
function panelLineTexture(): THREE.DataTexture {
  const W = 1024;
  const H = 256;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const ring = x % 38 === 0;
      const lap = y === 36 || y === 92 || y === 164 || y === 220;
      const v = ring || lap ? 222 : 251;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v + 2 > 255 ? 255 : v + 2;
      d[o + 3] = 255;
    }
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

export function createG650Exterior(vars: SimVars): G650Exterior {
  const root = new THREE.Group();
  root.name = 'exterior';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const skinTex = track(panelLineTexture());
  const skin = track(new THREE.MeshStandardMaterial({ color: 0xffffff, map: skinTex, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide }));
  const paint = track(new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide }));
  const greyPaint = track(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }));
  const radome = track(new THREE.MeshStandardMaterial({ color: 0xe6e7ea, roughness: 0.45, metalness: 0.02, side: THREE.DoubleSide }));
  const leMetal = track(new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.25, metalness: 0.85, side: THREE.DoubleSide }));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.85 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }));
  const glass = track(new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.04, metalness: 0.7, side: THREE.DoubleSide }));
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }));
  const chrome = track(new THREE.MeshStandardMaterial({ color: 0xe2e2e2, roughness: 0.12, metalness: 1 }));
  const gearPaint = track(new THREE.MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.4, metalness: 0.2 }));
  const wellMat = track(new THREE.MeshStandardMaterial({ color: 0x7d8288, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));

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
  const TWO_PI = 2 * Math.PI;

  // ---------------------------------------------------------------- fuselage
  const body = group('fuselage');
  mesh(loftFuselage(F, TAIL_CONE_X, GLAZED_X0, 0, TWO_PI, 180, 64), skin, 'cabin', body);
  // Flight-deck section with the windshield / side-window openings cut on the shared glazing field.
  const nose = group('nose');
  nose.userData.visibleFromCockpit = true;
  // The glazing and the skin around the flight deck hide in the cockpit view (the interior shell is there); the
  // skin ahead of the windshield base stays visible over the glareshield.
  mesh(carvedSkin(GLAZED_X0, NOSE_VISIBLE_X, { inset: 0, keep: 'solid', dx: 0.03, segT: 240 }), paint, 'flight_deck_skin', body);
  mesh(carvedSkin(NOSE_VISIBLE_X, GLAZED_X1, { inset: 0, keep: 'solid', dx: 0.02, segT: 240 }), paint, 'windshield_base_skin', nose);
  mesh(carvedSkin(GLAZED_X0, GLAZED_X1, { inset: -0.004, keep: 'glass', dx: 0.03, segT: 240 }), glass, 'windshield', body);
  mesh(loftFuselage(F, GLAZED_X1, RADOME_X, 0, TWO_PI, 20, 64), paint, 'nose_skin', nose);
  mesh(loftFuselage(F, RADOME_X, NOSE_TIP_X, 0, TWO_PI, 16, 64), radome, 'radome', nose);
  // Wing-to-body fairing under the centre section (EST from photographs).
  const FAIR = new FuselageProfile([
    { x: 6.2, cz: 1.25, ry: 0.1, rz: 0.05 },
    { x: 5.2, cz: 1.2, ry: 1.05, rz: 0.3 },
    { x: 3.6, cz: 1.18, ry: 1.45, rz: 0.38 },
    { x: -1.2, cz: 1.18, ry: 1.45, rz: 0.38 },
    { x: -2.8, cz: 1.15, ry: 1.0, rz: 0.3 },
    { x: -3.8, cz: 1.12, ry: 0.1, rz: 0.05 },
  ]);
  mesh(loftFuselage(FAIR, -3.8, 6.2, 0.9 * Math.PI / 2, TWO_PI - 0.9 * Math.PI / 2, 44, 28), paint, 'wing_fairing', body);
  // Cabin windows: eight large ellipses per side, 28 in (0.71 m) wide (Wikipedia G650); height EST 0.53 m.
  const winGeo = track(new THREE.CircleGeometry(1, 40));
  winGeo.scale(0.355, 0.265, 1);
  const winXs = [11.0, 9.62, 8.24, 6.86, 5.48, 4.1, 2.72, 1.34];
  const wins = new THREE.InstancedMesh(winGeo, glass, winXs.length * 2);
  wins.name = 'cabin_windows';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const x of winXs) {
    for (const side of [1, -1]) {
      F.point(x, side * 1.33, -0.03, pv);
      q.setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, 0, 'YXZ'));
      m4.compose(pv, q, one);
      wins.setMatrixAt(k++, m4);
    }
  }
  body.add(wins);
  // Door seams: main entry door (left, just aft of the flight deck, airstair) and the external baggage door (left aft).
  const seam = (x0: number, x1: number, t0: number, t1: number, name: string, parent: THREE.Object3D = body) => {
    const e = 0.012;
    mesh(loftFuselage(F, x0, x1, t0, t0 + e, 8, 1, { inset: -0.003 }), greyPaint, name, parent);
    mesh(loftFuselage(F, x0, x1, t1 - e, t1, 8, 1, { inset: -0.003 }), greyPaint, name, parent);
    mesh(loftFuselage(F, x0, x0 + 0.012, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, parent);
    mesh(loftFuselage(F, x1 - 0.012, x1, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, parent);
  };
  // Main door: EST 0.9 m x 1.9 m plug door hinged at its bottom (airstair), opens outward-down (ac.door.main).
  const DOOR = { x0: 11.85, x1: 12.75, t0: -2.45, t1: -0.72 };
  seam(DOOR.x0, DOOR.x1, DOOR.t0, DOOR.t1, 'entry_door_seam');
  const doorHinge = group('main_door_hinge', body);
  const dBot = F.point((DOOR.x0 + DOOR.x1) / 2, DOOR.t0, 0, new THREE.Vector3());
  doorHinge.position.copy(dBot);
  const doorGeo = loftFuselage(F, DOOR.x0 + 0.015, DOOR.x1 - 0.015, DOOR.t0 + 0.015, DOOR.t1 - 0.015, 6, 10, { inset: -0.006 });
  doorGeo.translate(-dBot.x, -dBot.y, -dBot.z);
  mesh(doorGeo, paint, 'main_door', doorHinge);
  seam(-4.3, -3.45, -2.25, -1.6, 'baggage_door');

  // ---------------------------------------------------------------- wings with movable surfaces
  const wings = group('wings');
  wings.userData.visibleFromCockpit = true;
  const movables: Record<string, Movable[]> = { flapL: [], flapR: [], ailL: [], ailR: [], splInL: [], splInR: [], splMidL: [], splMidR: [], splOutL: [], splOutR: [], elevL: [], elevR: [], rudder: [] };
  const hinge = (name: keyof typeof movables, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D) => {
    const pivot = new THREE.Group();
    pivot.name = `${name}_hinge`;
    pivot.position.copy(bl(...pivotBody));
    parent.add(pivot);
    g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    mesh(g, m, name, pivot);
    movables[name].push({ obj: pivot, axis: bl(...axisBody).normalize(), base: pivot.quaternion.clone() });
  };
  const FLAP = [1.4, 9.2]; // EST single-slotted Fowler flap span (root to ~62 % semi-span)
  const AIL = [9.4, 13.6]; // EST aileron span
  const HINGE_C = 0.74; // flap / aileron hinge at 74 % chord (EST)
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    const S = (y: number, t: number): WingSection => ({ y, ...wingAt(y), t });
    mesh(loftWing(G650_WING, { mirror, chordRange: [0, HINGE_C], n: 18 }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(loftWing([S(1.25, 0.14), S(FLAP[0], 0.14)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_root', wings);
    mesh(loftWing([S(FLAP[1], 0.105), S(AIL[0], 0.104)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([S(AIL[1], 0.097), S(TIP_Y, 0.095)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_tip', wings);
    // Leading edge (bleed-heated wing anti-ice, bare metal look).
    mesh(loftWing([S(1.4, 0.14), S(5.0, 0.12), S(TIP_Y - 0.05, 0.095)].map((s) => ({ ...s, t: s.t * 1.02 })), { mirror, chordRange: [0, 0.03], n: 6 }), leMetal, 'wing_le', wings);
    const fl = [S(FLAP[0], 0.14), S(5.0, 0.12), S(FLAP[1], 0.105)];
    const hx = (s: WingSection) => s.xLe - HINGE_C * s.chord;
    const fa = fl[0];
    const fb = fl[fl.length - 1];
    hinge(mirror ? 'flapL' : 'flapR', loftWing(fl, { mirror, chordRange: [HINGE_C, 1] }), [hx(fa), sgn * fa.y, fa.z], [hx(fb) - hx(fa), sgn * (fb.y - fa.y), fb.z - fa.z], paint, wings);
    const al = [S(AIL[0], 0.104), S(AIL[1], 0.097)];
    hinge(mirror ? 'ailL' : 'ailR', loftWing(al, { mirror, chordRange: [HINGE_C, 1] }), [hx(al[0]), sgn * al[0].y, al[0].z], [hx(al[1]) - hx(al[0]), sgn * (al[1].y - al[0].y), al[1].z - al[0].z], paint, wings);
    // Spoilers: three upper-surface panels per wing ahead of the flap (inboard / midboard / outboard, LUC).
    const panels: [keyof typeof movables, number, number][] = [
      [mirror ? 'splInL' : 'splInR', 2.0, 3.9],
      [mirror ? 'splMidL' : 'splMidR', 4.0, 6.0],
      [mirror ? 'splOutL' : 'splOutR', 6.1, 8.4],
    ];
    for (const [name, y0, y1] of panels) {
      const w0 = wingAt(y0);
      const w1 = wingAt(y1);
      const f0 = 0.55;
      const f1 = 0.73;
      const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z - 0.05 * w.chord * (1 - f * 0.9) - 0.004);
      const a = P(y0, w0, f0);
      const b = P(y1, w1, f0);
      const c = P(y1, w1, f1);
      const d = P(y0, w0, f1);
      const g = new THREE.BufferGeometry();
      g.setFromPoints(mirror ? [a, c, b, a, d, c] : [a, b, c, a, c, d]);
      g.computeVertexNormals();
      hinge(name, g, [w0.xLe - f0 * w0.chord, sgn * y0, w0.z - 0.03], [w1.xLe - w0.xLe - f0 * (w1.chord - w0.chord), sgn * (y1 - y0), w1.z - w0.z], greyPaint, wings);
    }
    // Blended winglet: canted ~30 deg outboard, swept, top at the fdm.ts winglet contact (x -6.0, y 15.18, z -0.72).
    const tip = wingAt(TIP_Y);
    const wl = group(mirror ? 'winglet_l' : 'winglet_r', wings);
    wl.position.copy(bl(tip.xLe, sgn * (TIP_Y - 0.02), tip.z));
    wl.rotation.z = -sgn * 30 * D2R;
    const wlSecs: WingSection[] = [
      { y: 0, xLe: 0, chord: 1.5, z: 0, t: 0.095 },
      { y: 0.3, xLe: -0.35, chord: 1.1, z: 0, t: 0.09 },
      { y: 1.2, xLe: -1.35, chord: 0.55, z: 0, t: 0.085 },
    ];
    mesh(loftWing(wlSecs, { vertical: true }), paint, 'winglet', wl);
  }

  // ---------------------------------------------------------------- T-tail with trimmable stabilizer
  const tail = group('tail');
  const FIN_ROOT_Z = -1.3;
  const FIN_H = 4.0;
  const fin: WingSection[] = [
    { y: 0, xLe: -6.6, chord: 5.2, z: FIN_ROOT_Z, t: 0.11 },
    { y: FIN_H, xLe: -9.6, chord: 3.0, z: FIN_ROOT_Z, t: 0.1 },
  ];
  const RUD = 0.68;
  mesh(loftWing(fin, { vertical: true, chordRange: [0, RUD] }), paint, 'fin', tail);
  // Dorsal fillet ahead of the fin root.
  mesh(loftWing([{ y: -0.05, xLe: -4.7, chord: 2.3, z: FIN_ROOT_Z - 0.2, t: 0.05 }, { y: 0.35, xLe: -6.5, chord: 0.8, z: FIN_ROOT_Z - 0.2, t: 0.08 }], { vertical: true }), paint, 'dorsal', tail);
  const finAt = (hh: number) => {
    const t = hh / FIN_H;
    return { xLe: -6.6 + (-9.6 + 6.6) * t, chord: 5.2 + (3.0 - 5.2) * t };
  };
  const r0 = finAt(0.4);
  const r1 = finAt(3.8);
  hinge(
    'rudder',
    loftWing([{ y: 0.4, ...r0, z: FIN_ROOT_Z, t: 0.11 }, { y: 3.8, ...r1, z: FIN_ROOT_Z, t: 0.1 }], { vertical: true, chordRange: [RUD, 1] }),
    [r0.xLe - RUD * r0.chord, 0, FIN_ROOT_Z - 0.4],
    [r1.xLe - RUD * r1.chord - (r0.xLe - RUD * r0.chord), 0, -(3.8 - 0.4)],
    paint,
    tail,
  );
  // Stabilizer on the fin tip: overall height 7.82 m (GAC) = 2.35 m datum height + 5.47 m to the bullet top.
  const stabZ = FIN_ROOT_Z - FIN_H - 0.08;
  const stabPivotX = -10.9;
  const stabG = group('stabilizer', tail);
  stabG.position.copy(bl(stabPivotX, 0, stabZ));
  const stabInner = group('stab_inner', stabG);
  stabInner.position.copy(bl(-stabPivotX, 0, -stabZ));
  const STAB_SEMI = 5.3; // EST (~10.6 m span)
  const stab: WingSection[] = [
    { y: 0, xLe: -9.75, chord: 2.8, z: stabZ, t: 0.1 },
    { y: STAB_SEMI, xLe: -12.6, chord: 1.1, z: stabZ - 0.1, t: 0.09 },
  ];
  const ELEV = 0.7;
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, ELEV] }), paint, 'stab', stabInner);
    const s0 = stab[0];
    const s1 = stab[1];
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [ELEV, 1] }), [s0.xLe - ELEV * s0.chord, 0, stabZ], [s1.xLe - ELEV * s1.chord - (s0.xLe - ELEV * s0.chord), mirror ? -STAB_SEMI : STAB_SEMI, s1.z - s0.z], paint, stabInner);
  }
  const bullet = new THREE.SphereGeometry(1, 24, 12);
  bullet.scale(0.24, 0.24, 1.7);
  mesh(bullet, paint, 'tail_bullet', stabInner).position.copy(bl(-11.0, 0, stabZ - 0.05));
  // APU exhaust at the tail-cone tip.
  const apuEx = new THREE.CylinderGeometry(0.08, 0.09, 0.12, 20, 1, true);
  apuEx.rotateX(Math.PI / 2);
  mesh(apuEx, dark, 'apu_exhaust', body).position.copy(bl(TAIL_CONE_X - 0.04, 0, F.at(TAIL_CONE_X).cz));

  // ---------------------------------------------------------------- engines (aft-fuselage pylons, fdm.ts positions)
  const engines = group('engines');
  const fans: THREE.Object3D[] = [];
  const reversers: THREE.Object3D[][] = [];
  const NAC_LEN = 4.6; // EST BR725 nacelle
  const NAC_R = 0.78; // EST max radius (50 in fan, LUC)
  const ENG_X = 16.7 - 22.0;
  for (const y of [-2.9, 2.9]) {
    const g = group(y < 0 ? 'engine_l' : 'engine_r', engines);
    g.position.copy(bl(ENG_X, y, -0.9));
    const prof: THREE.Vector2[] = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let r: number;
      if (t < 0.06) r = NAC_R * (0.82 + 0.18 * Math.sin((t / 0.06) * (Math.PI / 2)));
      else if (t < 0.5) r = NAC_R;
      else r = NAC_R * (1 - 0.4 * ((t - 0.5) / 0.5) ** 1.5);
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.49 - t * NAC_LEN));
    }
    const nac = new THREE.LatheGeometry(prof, 48);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(NAC_R * 0.82, 0.05, 10, 48);
    mesh(lip, leMetal, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.49, 0, 0));
    const inner = new THREE.CylinderGeometry(NAC_R * 0.8, NAC_R * 0.8, 0.6, 40, 1, true);
    inner.rotateX(Math.PI / 2);
    mesh(inner, dark, 'inlet_duct', g).position.copy(bl(NAC_LEN * 0.49 - 0.3, 0, 0));
    const fan = new THREE.Group();
    fan.position.copy(bl(NAC_LEN * 0.49 - 0.5, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(NAC_R * 0.79, 36), dark, 'fan_disc', fan);
    const blade = new THREE.BoxGeometry(0.07, NAC_R * 1.55, 0.012);
    // LUC powerplant: 24-blade fan, turning counter-clockwise seen from the front.
    for (let bIdx = 0; bIdx < 12; bIdx++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.012;
      bm.rotation.z = (bIdx / 12) * Math.PI;
      bm.rotation.y = 0.55;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.22, 0.44, 24);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, chrome, 'spinner', fan).position.z = -0.22;
    fans.push(fan);
    const plug = new THREE.ConeGeometry(0.3, 0.8, 24);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.51 - 0.25, 0, 0));
    const noz = new THREE.CylinderGeometry(NAC_R * 0.6, NAC_R * 0.6, 0.05, 36, 1, true);
    noz.rotateX(Math.PI / 2);
    mesh(noz, dark, 'nozzle', g).position.copy(bl(-NAC_LEN * 0.51 + 0.03, 0, 0));
    // Target-type reverser: upper and lower buckets hinged at the aft end, closing behind the nozzle when deployed.
    const doors: THREE.Object3D[] = [];
    for (const s of [1, -1]) {
      const piv = new THREE.Group();
      piv.position.copy(bl(-NAC_LEN * 0.51 + 0.02, 0, -s * NAC_R * 0.62));
      g.add(piv);
      const bucket = new THREE.CylinderGeometry(NAC_R * 0.63, NAC_R * 0.63, 0.75, 20, 1, true, s > 0 ? -Math.PI / 2.2 : Math.PI - Math.PI / 2.2, Math.PI / 1.1);
      bucket.rotateX(Math.PI / 2);
      bucket.translate(0, s * NAC_R * 0.62 - s * NAC_R * 0.62, 0.375);
      mesh(bucket, greyPaint, 'reverser_bucket', piv);
      doors.push(piv);
    }
    reversers.push(doors);
    // Pylon to the fuselage side.
    const side = Math.sign(y);
    const pyl = new THREE.BoxGeometry(1.0, 0.2, 2.4);
    const pm = mesh(pyl, paint, 'pylon', engines);
    pm.position.copy(bl(ENG_X - 0.1, side * 1.72, -0.85));
  }

  // ---------------------------------------------------------------- landing gear (fdm.ts contact points)
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
  const GEAR_Z = 2.47;
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, axis: [number, number, number], angle: number, trail: number) => {
    const pivot = group(`gear${index}`);
    pivot.position.copy(bl(contact[0] + trail, contact[1], pivotZ));
    const strut = group('strut', pivot);
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(0.075, 0.075, len * 0.72, 14);
    mesh(oleo, gearPaint, 'oleo', strut).position.y = -len * 0.36;
    const piston = new THREE.CylinderGeometry(0.055, 0.055, len * 0.38, 12);
    mesh(piston, chrome, 'piston', strut).position.y = -len * 0.8;
    const steer = group('steer', strut);
    steer.position.y = -len;
    const arm = new THREE.BoxGeometry(0.09, 0.09, Math.abs(trail) + 0.06);
    const am = mesh(arm, gearPaint, 'trailing_link', steer);
    am.position.z = trail / 2;
    const axle = group('axle', steer);
    axle.position.z = trail;
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 14, 30);
    tg.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, width * 0.9, 20);
    hub.rotateZ(Math.PI / 2);
    for (const off of [-width * 0.62, width * 0.62]) {
      const w = new THREE.Group();
      w.position.x = off;
      axle.add(w);
      mesh(tg.clone(), tyre, 'tyre', w);
      mesh(hub.clone(), metal, 'hub', w);
      wheels.push(w);
    }
    tg.dispose();
    hub.dispose();
    legs.push({ index, pivot, strut, steer, wheels, travel, axis: bl(...axis).normalize(), angle, radius });
  };
  // Nose: twin 21 x 7.25-10 (r 0.267 m, TCDS), retracts forward.
  makeLeg(0, [NOSE_GEAR_X, 0, GEAR_Z], 1.2, 0.267, 0.19, 0.26, [0, 1, 0], -100 * D2R, 0.2);
  // Mains: twin H37.5 x 12.0R19 (r 0.476 m, TCDS), trailing link, retract inboard (LUC drawings).
  makeLeg(1, [MAIN_X, -TRACK_M / 2, GEAR_Z], 1.0, 0.476, 0.31, 0.32, [1, 0, 0], 88 * D2R, 0.35);
  makeLeg(2, [MAIN_X, TRACK_M / 2, GEAR_Z], 1.0, 0.476, 0.31, 0.32, [1, 0, 0], -88 * D2R, 0.35);
  const doorPivots: { obj: THREE.Group; axis: THREE.Vector3; open: number }[] = [];
  const bayDoor = (name: string, hingeBody: [number, number, number], w: number, len: number, side: number, axisBody: [number, number, number], openRad: number) => {
    const p = group(name);
    p.position.copy(bl(...hingeBody));
    const d = new THREE.BoxGeometry(w, 0.012, len);
    d.translate((side * w) / 2, 0, 0);
    mesh(d, paint, name, p);
    doorPivots.push({ obj: p, axis: bl(...axisBody).normalize(), open: openRad });
  };
  bayDoor('nose_door_l', [NOSE_GEAR_X + 0.4, -0.27, 1.33], 0.26, 1.2, 1, [1, 0, 0], 85 * D2R);
  bayDoor('nose_door_r', [NOSE_GEAR_X + 0.4, 0.27, 1.33], 0.26, 1.2, -1, [1, 0, 0], -85 * D2R);
  bayDoor('main_door_l', [MAIN_X + 0.2, -0.05, 1.53], 0.95, 1.4, -1, [1, 0, 0], -80 * D2R);
  bayDoor('main_door_r', [MAIN_X + 0.2, 0.05, 1.53], 0.95, 1.4, 1, [1, 0, 0], 80 * D2R);
  const well = new THREE.BoxGeometry(2.6, 0.35, 1.5);
  mesh(well, wellMat, 'main_well', body).position.copy(bl(MAIN_X + 0.2, 0, 1.3));
  const nwell = new THREE.BoxGeometry(0.52, 0.35, 1.3);
  mesh(nwell, wellMat, 'nose_well', body).position.copy(bl(NOSE_GEAR_X + 0.4, 0, 1.15));

  // ---------------------------------------------------------------- lights
  const GLOW = 64;
  const glowData = new Uint8Array(GLOW * GLOW * 4);
  for (let y = 0; y < GLOW; y++) {
    for (let x = 0; x < GLOW; x++) {
      const r = Math.hypot(x + 0.5 - GLOW / 2, y + 0.5 - GLOW / 2) / (GLOW / 2);
      const a = Math.max(0, 1 - r);
      const o = (y * GLOW + x) * 4;
      glowData[o] = glowData[o + 1] = glowData[o + 2] = 255;
      glowData[o + 3] = Math.round(255 * a * a * a);
    }
  }
  const glowTex = track(new THREE.DataTexture(glowData, GLOW, GLOW));
  glowTex.needsUpdate = true;
  interface Lamp {
    m: THREE.MeshBasicMaterial;
    halo: THREE.SpriteMaterial;
    color: THREE.Color;
  }
  const lamp = (color: number, pos: [number, number, number], size = 0.05, parent: THREE.Object3D = root, halo = 14): Lamp => {
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
  // Position lights in the wing tips at the winglet roots (red left, green right), white on the tail cone
  // (14 CFR 25.1385-1391 layout).
  const navL = lamp(0xff1a1a, [tip.xLe - 0.1, -(TIP_Y + 0.05), tip.z], 0.05, lightsG);
  const navR = lamp(0x19ff4a, [tip.xLe - 0.1, TIP_Y + 0.05, tip.z], 0.05, lightsG);
  const navT = lamp(0xffffff, [TAIL_CONE_X + 0.05, 0, F.at(TAIL_CONE_X).cz - 0.12], 0.04, lightsG);
  // Anti-collision: white strobes in the tips and the tail; red beacons on the fin tip bullet and the belly.
  const strobeL = lamp(0xffffff, [tip.xLe - 0.35, -(TIP_Y + 0.05), tip.z], 0.045, lightsG, 22);
  const strobeR = lamp(0xffffff, [tip.xLe - 0.35, TIP_Y + 0.05, tip.z], 0.045, lightsG, 22);
  const strobeT = lamp(0xffffff, [-12.7, 0, stabZ - 0.05], 0.045, lightsG, 22);
  const beaconTop = lamp(0xff2200, [-10.4, 0, stabZ - 0.3], 0.055, lightsG, 18);
  const beaconBot = lamp(0xff2200, [-2.4, 0, 1.53], 0.055, lightsG, 18);
  // Landing lights in the wing roots (lighting.ts), recognition in the leading edge further out (EST).
  const ldgL = lamp(0xfff6e8, [XLE(1.8) - 0.05, -1.8, WZ(1.8)], 0.07, lightsG, 20);
  const ldgR = lamp(0xfff6e8, [XLE(1.8) - 0.05, 1.8, WZ(1.8)], 0.07, lightsG, 20);
  const recL = lamp(0xfff6e8, [XLE(2.4) - 0.05, -2.4, WZ(2.4)], 0.045, lightsG, 16);
  const recR = lamp(0xfff6e8, [XLE(2.4) - 0.05, 2.4, WZ(2.4)], 0.045, lightsG, 16);
  const wingL = lamp(0xfff2dd, [4.2, -1.36, -0.15], 0.03, lightsG);
  const wingR = lamp(0xfff2dd, [4.2, 1.36, -0.15], 0.03, lightsG);
  const logoL = lamp(0xfff2dd, [-10.2, -0.9, stabZ + 0.05], 0.03, lightsG);
  const logoR = lamp(0xfff2dd, [-10.2, 0.9, stabZ + 0.05], 0.03, lightsG);
  const emerL = lamp(0xfff2dd, [11.3, -1.35, -0.2], 0.03, lightsG);
  const emerW = lamp(0xfff2dd, [2.0, -1.36, 0.35], 0.03, lightsG);
  const spot = (pos: [number, number, number], target: [number, number, number], angle: number, parent: THREE.Object3D) => {
    const s = new THREE.SpotLight(0xfff4e6, 0, 1500, angle * D2R, 0.4, 2);
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    s.castShadow = false;
    parent.add(s, s.target);
    return s;
  };
  const spotL = spot([XLE(1.8) - 0.1, -1.8, WZ(1.8)], [90, -6, 8], 11, lightsG);
  const spotR = spot([XLE(1.8) - 0.1, 1.8, WZ(1.8)], [90, 6, 8], 11, lightsG);
  const taxiParent = legs[0].steer;
  const taxiLamp = track(new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false }));
  const tl = new THREE.Mesh(track(new THREE.SphereGeometry(0.045, 10, 8)), taxiLamp);
  tl.position.set(0, 0.4, -0.1);
  taxiParent.add(tl);
  const taxiSpot = new THREE.SpotLight(0xfff4e6, 0, 400, 28 * D2R, 0.5, 2);
  taxiSpot.position.set(0, 0.4, -0.12);
  taxiSpot.target.position.set(0, -2.3, -25);
  taxiParent.add(taxiSpot, taxiSpot.target);

  for (const c of root.children) if (c.userData.visibleFromCockpit === undefined) c.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const posVar = [0, 1, 2].map((i) => GEAR.pos(i));
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const n1Var = [1, 2].map((i) => ENG.n1(i));
  const revVar = [1, 2].map((i) => ENG.reverserPos(i));
  const tmpQ = new THREE.Quaternion();
  const setHinge = (list: Movable[], angle: number) => {
    for (const mv of list) mv.obj.quaternion.copy(mv.base).multiply(tmpQ.setFromAxisAngle(mv.axis, angle));
  };
  const fanAngle = [0, 0];
  const wheelAngle = [0, 0, 0];
  const setLamp = (l: Lamp, level: number) => {
    const x = level < 0 ? 0 : level > 1 ? 1 : level;
    l.m.color.copy(l.color).multiplyScalar(0.06 + 0.94 * x);
    l.halo.opacity = x;
  };
  const doorAxis = bl(1, 0, 0).normalize();

  function update(dt: number): void {
    const v = vars;
    for (const leg of legs) {
      const pos = v.get(posVar[leg.index], 1);
      leg.pivot.quaternion.setFromAxisAngle(leg.axis, (1 - pos) * leg.angle);
      leg.strut.position.y = v.get(compVar[leg.index]) * leg.travel;
      if (leg.index === 0) leg.steer.rotation.y = -v.get(GEAR.steerDeg) * D2R;
      const w = (v.get(speedVar[leg.index]) * 0.514444) / leg.radius;
      wheelAngle[leg.index] = (wheelAngle[leg.index] - w * dt) % (2 * Math.PI);
      for (const wh of leg.wheels) wh.rotation.x = wheelAngle[leg.index];
    }
    const doors = v.get('gear.doors');
    for (const d of doorPivots) d.obj.quaternion.setFromAxisAngle(d.axis, d.open * (doors > 0 ? doors : 0));
    const flaps = v.get(SURF.flapsDeg) * D2R;
    setHinge(movables.flapR, flaps);
    setHinge(movables.flapL, -flaps);
    const ail = v.get(SURF.aileron) * 20 * D2R; // EST +-20 deg aileron travel
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    // Spoilers (LUC): roll / speed brake on mid + outboard (55 deg roll, 30 deg speed brake), ground spoilers all
    // panels (55 deg, 30 deg flaps up); inboard panels follow the speed brake share (EST).
    const gsDeg = (v.get(SURF.flapsDeg) >= 9 ? 55 : 30) * v.get(SURF.groundSpoilers);
    const sl = Math.max(v.get(SURF.spoilerLeft) * 55, gsDeg) * D2R;
    const sr = Math.max(v.get(SURF.spoilerRight) * 55, gsDeg) * D2R;
    const sIn = Math.max(Math.min(v.get(SURF.spoilerLeft), v.get(SURF.spoilerRight)) * 55, gsDeg) * D2R;
    setHinge(movables.splInR, -sIn);
    setHinge(movables.splInL, sIn);
    setHinge(movables.splMidR, -sr);
    setHinge(movables.splOutR, -sr);
    setHinge(movables.splMidL, sl);
    setHinge(movables.splOutL, sl);
    const elev = v.get(SURF.elevator) * 20 * D2R; // EST +-20 deg
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 25 * D2R);
    // Stabilizer: normalized trim / 0.2 per deg (logic.ts STAB_PER_DEG), + nose up = leading edge down.
    stabG.rotation.x = (v.get(SURF.pitchTrim) / 0.2) * D2R;
    for (let i = 0; i < 2; i++) {
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 60 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
      const r = v.get(revVar[i]);
      // Buckets swing aft and inward to meet behind the nozzle (EST 70 deg).
      reversers[i][0].rotation.x = r * 70 * D2R;
      reversers[i][1].rotation.x = -r * 70 * D2R;
    }
    // Main door: airstair door hinged at the bottom, opens outward and down (EST 95 deg).
    doorHinge.quaternion.setFromAxisAngle(doorAxis, -v.get('ac.door.main') * 95 * D2R);
    const nav = v.get('light.nav');
    setLamp(navL, nav);
    setLamp(navR, nav);
    setLamp(navT, nav);
    const st = v.get('light.strobe');
    setLamp(strobeL, st);
    setLamp(strobeR, st);
    setLamp(strobeT, v.get('light.strobe_tail'));
    setLamp(beaconTop, v.get('light.beacon'));
    setLamp(beaconBot, v.get('light.beacon_lower'));
    const ll = v.get('light.landing_l');
    const lr = v.get('light.landing_r');
    setLamp(ldgL, ll);
    setLamp(ldgR, lr);
    const rec = v.get('light.recognition');
    setLamp(recL, rec);
    setLamp(recR, rec);
    const taxi = v.get('light.taxi');
    taxiLamp.color.setRGB(0.06 + 0.94 * taxi, 0.06 + 0.94 * taxi, 0.06 + 0.9 * taxi);
    const wi = v.get('light.wing');
    setLamp(wingL, wi);
    setLamp(wingR, wi);
    const lg = v.get('light.logo');
    setLamp(logoL, lg);
    setLamp(logoR, lg);
    const em = v.get('light.emer');
    setLamp(emerL, em);
    setLamp(emerW, em);
    // EST: 450,000 cd LED landing lights, 60,000 cd taxi light, in scene light units.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    spotL.intensity = Math.max(ll, rec * 0.3) * 450_000 * k;
    spotR.intensity = Math.max(lr, rec * 0.3) * 450_000 * k;
    taxiSpot.intensity = taxi * 60_000 * k;
  }

  void SPAN_M;
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
