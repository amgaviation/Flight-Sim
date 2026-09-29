/**
 * Procedural exterior of the Cessna Citation Longitude (Model 700).
 *
 * Dimensions (FPG p.2): length 73 ft 2 in (22.30 m), span 68 ft 11 in (21.00 m
 * over the winglets), height 19 ft 5 in (5.92 m), wheelbase 31 ft 7 in
 * (9.62 m), tread 9 ft 8 in (2.95 m). Wing 537 ft^2, quarter-chord sweep
 * 26.8/28.6 deg, winglets, no leading-edge devices (WIKI, BCA). T-tail with a
 * trimmable horizontal stabilizer (OG 15-2), two HTF7700L on aft-fuselage
 * pylons (BCA "just aft of the wings"), pivot-door reversers (OG 7-2),
 * trailing-link dual-wheel mains and a trailing-link nose gear (OG 2-5),
 * single-slotted flaps, outboard ailerons, three spoiler panels per wing
 * (outboard two = roll spoilers / speedbrakes, all three = ground spoilers,
 * OG 15-4/15-5).
 *
 * All positions are body metres (x fwd, y right, z down) from the datum
 * (empty CG) and match fdm.ts: gear contacts, nacelle centres (-4.3, +-2.1,
 * -0.75), wing MAC leading edge at x 0.78 m, ground 1.76 m below the datum
 * with static strut compression. Shapes between those anchors are EST from
 * published three-view drawings and photographs.
 *
 * Animated in `update(dt)` from SimVars: gear retraction (gear.pos*), doors
 * (gear.doors), strut compression, nosewheel steering, wheel spin; flaps
 * (surf.flaps_deg), ailerons, roll/speedbrake spoilers and ground spoilers,
 * elevator, rudder, stabilizer incidence (trim.pitch_units); fan rotation
 * (eng*.n1_pct), reversers (eng*.reverser_pos); exterior lights from the
 * LightingSystem outputs (light.*), real spot lights in candela through the
 * world's render_units_per_lux scale.
 *
 * Livery-neutral white with subtle panel lines (procedural texture).
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type FuselageStation, type WingSection } from '../_test/loft';
import { SIDE_WINDOWS, WINDSHIELD } from './cockpit/layout';

const D2R = Math.PI / 180;

/** Section from its top and bottom skin heights (body z) and half-width. */
function st(x: number, zTop: number, zBot: number, ry: number): FuselageStation {
  return { x, cz: (zTop + zBot) / 2, rz: (zBot - zTop) / 2, ry };
}

/**
 * Fuselage cross-sections. Cabin: 77 in wide x 72 in tall inside (FPG p.2)
 * with a flat floor ~0.6 m below the centreline -> outside ~2.32 m wide,
 * ~2.45 m tall (EST, 6-8 cm skin + frames). Nose: over-the-nose line ~11 deg
 * below the design eye (EST, AC 25.773-1 practice); radome tip at x 11.2 m,
 * tail cone end at x -11.05 m (22.3 m overall with the stabilizer tips).
 */
export const LONGITUDE_FUSELAGE = new FuselageProfile([
  st(11.2, 0.3, 0.36, 0.03),
  st(11.05, 0.13, 0.56, 0.27),
  st(10.7, 0.0, 0.78, 0.48),
  st(10.2, -0.09, 0.95, 0.68),
  st(9.6, -0.18, 1.07, 0.85),
  st(9.0, -0.28, 1.14, 0.97),
  st(WINDSHIELD.baseX, -0.36, 1.17, 1.03),
  st(WINDSHIELD.headerX, -1.08, 1.19, 1.12),
  st(7.4, -1.22, 1.2, 1.15),
  st(6.5, -1.245, 1.2, 1.16),
  st(-3.0, -1.245, 1.2, 1.16),
  st(-5.0, -1.22, 1.02, 1.06),
  st(-7.0, -1.17, 0.62, 0.8),
  st(-8.8, -1.08, 0.12, 0.5),
  st(-10.3, -0.98, -0.42, 0.22),
  st(-11.05, -0.92, -0.72, 0.05),
]);

/** Wing planform, right side (EST from the three-view; LE sweep ~30 deg, trailing-edge kink at 4.0 m; MAC LE at x 0.78 m, fdm.ts). */
export const LONGITUDE_WING: WingSection[] = [
  { y: 0.9, xLe: 2.59, chord: 3.99, z: 0.81, t: 0.15, twistDeg: 2 },
  { y: 4.0, xLe: 0.78, chord: 2.5, z: 0.54, t: 0.13, twistDeg: 0.5 },
  { y: 10.05, xLe: -2.7, chord: 1.03, z: 0.02, t: 0.105, twistDeg: -2 },
];
/** Wing tip station (winglet root). */
const TIP_Y = 10.05;

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = LONGITUDE_WING;
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

export interface LongitudeExterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/** Procedural panel-line texture (white skin, faint lines every ~1 m along and a few stringer joints around). */
function panelLineTexture(): THREE.DataTexture {
  const W = 1024;
  const H = 256;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      // Circumferential joints every 52 px (~1 m over the 19.7 m cabin loft), longitudinal lap joints at 4 heights.
      const ring = x % 52 === 0;
      const lap = y === 40 || y === 88 || y === 168 || y === 216;
      const v = ring || lap ? 214 : 250;
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

export function createLongitudeExterior(vars: SimVars): LongitudeExterior {
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
  const radome = track(new THREE.MeshStandardMaterial({ color: 0xe8e9eb, roughness: 0.45, metalness: 0.02, side: THREE.DoubleSide }));
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
  const F = LONGITUDE_FUSELAGE;
  const TWO_PI = 2 * Math.PI;

  // ---------------------------------------------------------------- fuselage
  const body = group('fuselage');
  mesh(loftFuselage(F, -11.05, WINDSHIELD.baseX, 0, TWO_PI, 140, 56), skin, 'cabin', body);
  // Nose ahead of the windshield (seen over the glareshield): white skin, radome forward of ~10.3 m.
  const nose = group('nose');
  nose.userData.visibleFromCockpit = true;
  mesh(loftFuselage(F, WINDSHIELD.baseX, 10.35, 0, TWO_PI, 20, 56), paint, 'nose', nose);
  mesh(loftFuselage(F, 10.35, 11.2, 0, TWO_PI, 14, 56), radome, 'radome', nose);
  // Wing-to-body fairing: flat belly fairing under the centre section (EST from photographs).
  const FAIR = new FuselageProfile([
    { x: 3.6, cz: 0.95, ry: 0.1, rz: 0.05 },
    { x: 2.9, cz: 0.92, ry: 0.95, rz: 0.3 },
    { x: 1.6, cz: 0.92, ry: 1.32, rz: 0.36 },
    { x: -1.0, cz: 0.92, ry: 1.32, rz: 0.36 },
    { x: -2.6, cz: 0.88, ry: 0.95, rz: 0.3 },
    { x: -3.4, cz: 0.85, ry: 0.1, rz: 0.05 },
  ]);
  mesh(loftFuselage(FAIR, -3.4, 3.6, 0.9 * Math.PI / 2, TWO_PI - 0.9 * Math.PI / 2, 40, 28), paint, 'wing_fairing', body);
  // Glazing: windshield (two panes, centre post) and the side windows, matching the cockpit shell openings.
  const glz = group('glazing', body);
  const ws = WINDSHIELD;
  mesh(loftFuselage(F, ws.headerX, ws.baseX, ws.postHalf, ws.halfAngle, 10, 16, { inset: -0.004 }), glass, 'windshield_r', glz);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle, -ws.postHalf, 10, 16, { inset: -0.004 }), glass, 'windshield_l', glz);
  for (const w of [SIDE_WINDOWS.fwd, SIDE_WINDOWS.aft]) {
    mesh(loftFuselage(F, w.x0, w.x1, SIDE_WINDOWS.roof, SIDE_WINDOWS.sill, 6, 6, { inset: -0.004 }), glass, 'side_window_r', glz);
    mesh(loftFuselage(F, w.x0, w.x1, -SIDE_WINDOWS.sill, -SIDE_WINDOWS.roof, 6, 6, { inset: -0.004 }), glass, 'side_window_l', glz);
  }
  // Cabin windows: six large windows per side (EST count/positions from photographs), rounded rectangles.
  const winShape = new THREE.Shape();
  {
    const w = 0.34;
    const h = 0.46;
    const r = 0.12;
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
  const winXs = [4.95, 3.8, 2.65, 1.5, 0.35, -0.8];
  const wins = new THREE.InstancedMesh(winGeo, glass, winXs.length * 2);
  wins.name = 'cabin_windows';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const x of winXs) {
    for (const side of [1, -1]) {
      const th = side * 1.36;
      F.point(x, th, -0.006, pv);
      // Face outward: the shape's +z normal points to local +x (right) or -x (left), tilted with the skin.
      q.setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, 0, 'YXZ'));
      m4.compose(pv, q, one);
      wins.setMatrixAt(k++, m4);
    }
  }
  body.add(wins);
  // Main entry door outline (left forward, airstair) and baggage door (left aft): thin grey seams on the skin.
  const seam = (x0: number, x1: number, t0: number, t1: number, name: string) => {
    const e = 0.012;
    mesh(loftFuselage(F, x0, x1, t0, t0 + e, 8, 1, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x0, x1, t1 - e, t1, 8, 1, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x0, x0 + 0.012, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x1 - 0.012, x1, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, body);
  };
  seam(5.55, 6.4, -2.35, -0.95, 'entry_door'); // EST 0.85 m x ~1.6 m airstair door
  seam(-3.9, -3.1, -2.2, -1.55, 'baggage_door');

  // ---------------------------------------------------------------- wings with movable surfaces
  const wings = group('wings');
  wings.userData.visibleFromCockpit = true;
  const movables: Record<string, Movable[]> = { flapL: [], flapR: [], ailL: [], ailR: [], spl1L: [], spl1R: [], spl2L: [], spl2R: [], spl3L: [], spl3R: [], elevL: [], elevR: [], rudder: [] };
  const hinge = (name: keyof typeof movables, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D) => {
    const pivot = new THREE.Group();
    pivot.name = `${name}_hinge`;
    pivot.position.copy(bl(...pivotBody));
    parent.add(pivot);
    g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    mesh(g, m, name, pivot);
    movables[name].push({ obj: pivot, axis: bl(...axisBody).normalize(), base: pivot.quaternion.clone() });
  };
  const FLAP = [1.25, 6.0]; // EST flap span (fuselage side to ~60 % semi-span)
  const AIL = [6.2, 9.45]; // EST aileron span
  const HINGE_C = 0.72; // flap/aileron hinge at 72 % chord (EST)
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    const S = (y: number, t: number): WingSection => ({ y, ...wingAt(y), t });
    // Fixed box forward of the hinge line where movables exist, full chord elsewhere.
    mesh(loftWing(LONGITUDE_WING, { mirror, chordRange: [0, HINGE_C], n: 18 }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(loftWing([S(0.9, 0.15), S(FLAP[0], 0.15)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_root', wings);
    mesh(loftWing([S(FLAP[1], 0.125), S(AIL[0], 0.125)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([S(AIL[1], 0.107), S(TIP_Y, 0.105)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_tip', wings);
    // Leading-edge strip (bleed-heated, bare metal look).
    mesh(loftWing([S(1.2, 0.15), S(4.0, 0.13), S(TIP_Y - 0.05, 0.105)].map((s) => ({ ...s, t: s.t * 1.02 })), { mirror, chordRange: [0, 0.035], n: 6 }), leMetal, 'wing_le', wings);
    // Flap and aileron.
    const fl = [S(FLAP[0], 0.15), S(4.0, 0.13), S(FLAP[1], 0.125)];
    const fa = fl[0];
    const fb = fl[fl.length - 1];
    const hx = (s: WingSection) => s.xLe - HINGE_C * s.chord;
    hinge(mirror ? 'flapL' : 'flapR', loftWing(fl, { mirror, chordRange: [HINGE_C, 1] }), [hx(fa), sgn * fa.y, fa.z], [hx(fb) - hx(fa), sgn * (fb.y - fa.y), fb.z - fa.z], paint, wings);
    const al = [S(AIL[0], 0.12), S(AIL[1], 0.107)];
    hinge(mirror ? 'ailL' : 'ailR', loftWing(al, { mirror, chordRange: [HINGE_C, 1] }), [hx(al[0]), sgn * al[0].y, al[0].z], [hx(al[1]) - hx(al[0]), sgn * (al[1].y - al[0].y), al[1].z - al[0].z], paint, wings);
    // Spoilers: three upper-surface panels ahead of the flap, hinged at their leading edge (OG 15-4).
    const panels: [keyof typeof movables, number, number][] = [
      [mirror ? 'spl1L' : 'spl1R', 1.6, 3.0],
      [mirror ? 'spl2L' : 'spl2R', 3.05, 4.45],
      [mirror ? 'spl3L' : 'spl3R', 4.5, 5.9],
    ];
    for (const [name, y0, y1] of panels) {
      const w0 = wingAt(y0);
      const w1 = wingAt(y1);
      const f0 = 0.5;
      const f1 = 0.7;
      const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z - 0.052 * w.chord * (1 - f * 0.9) - 0.004);
      const a = P(y0, w0, f0);
      const b = P(y1, w1, f0);
      const c = P(y1, w1, f1);
      const d = P(y0, w0, f1);
      const g = new THREE.BufferGeometry();
      g.setFromPoints(mirror ? [a, c, b, a, d, c] : [a, b, c, a, c, d]);
      g.computeVertexNormals();
      hinge(name, g, [w0.xLe - f0 * w0.chord, sgn * y0, w0.z - 0.03], [w1.xLe - w0.xLe - f0 * (w1.chord - w0.chord), sgn * (y1 - y0), w1.z - w0.z], greyPaint, wings);
    }
    // Winglet: canted ~15 deg outboard, swept, ~1.4 m tall (EST from photographs; span over the winglets 21.0 m, FPG).
    const tip = wingAt(TIP_Y);
    const wl = group(mirror ? 'winglet_l' : 'winglet_r', wings);
    wl.position.copy(bl(tip.xLe, sgn * (TIP_Y - 0.02), tip.z));
    wl.rotation.z = -sgn * 18 * D2R; // lean the top outboard (local z = aft axis)
    const wlSecs: WingSection[] = [
      { y: 0, xLe: 0, chord: 1.05, z: 0, t: 0.1 },
      { y: 0.35, xLe: -0.35, chord: 0.8, z: 0, t: 0.1 },
      { y: 1.4, xLe: -1.05, chord: 0.45, z: 0, t: 0.09 },
    ];
    mesh(loftWing(wlSecs, { vertical: true }), paint, 'winglet', wl);
  }

  // ---------------------------------------------------------------- T-tail with trimmable stabilizer
  const tail = group('tail');
  const fin: WingSection[] = [
    { y: 0, xLe: -6.1, chord: 4.3, z: -0.95, t: 0.11 },
    { y: 3.0, xLe: -8.5, chord: 2.3, z: -0.95, t: 0.1 },
  ];
  const RUD = 0.7;
  mesh(loftWing(fin, { vertical: true, chordRange: [0, RUD] }), paint, 'fin', tail);
  const finAt = (h: number) => {
    const t = h / 3.0;
    return { xLe: -6.1 + (-8.5 + 6.1) * t, chord: 4.3 + (2.3 - 4.3) * t };
  };
  const r0 = finAt(0.35);
  const r1 = finAt(2.85);
  hinge(
    'rudder',
    loftWing([{ y: 0.35, ...r0, z: -0.95, t: 0.11 }, { y: 2.85, ...r1, z: -0.95, t: 0.1 }], { vertical: true, chordRange: [RUD, 1] }),
    [r0.xLe - RUD * r0.chord, 0, -0.95 - 0.35],
    [r1.xLe - RUD * r1.chord - (r0.xLe - RUD * r0.chord), 0, -(2.85 - 0.35)],
    paint,
    tail,
  );
  // Stabilizer: whole surface pivots for trim (incidence = trim.pitch_units deg, OG 17-3 chart range).
  // Stabilizer on the fin tip: overall height 5.92 m (FPG p.2) = 1.76 m datum height + 4.16 m to the bullet top.
  const stabZ = -3.96;
  const stabPivotX = -9.3;
  const stabG = group('stabilizer', tail);
  stabG.position.copy(bl(stabPivotX, 0, stabZ));
  const stabInner = group('stab_inner', stabG);
  stabInner.position.copy(bl(-stabPivotX, 0, -stabZ));
  const stab: WingSection[] = [
    { y: 0, xLe: -8.6, chord: 2.1, z: stabZ, t: 0.1 },
    { y: 4.15, xLe: -10.25, chord: 0.85, z: stabZ - 0.07, t: 0.09 },
  ];
  const ELEV = 0.68;
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, ELEV] }), paint, 'stab', stabInner);
    const s0 = stab[0];
    const s1 = stab[1];
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [ELEV, 1] }), [s0.xLe - ELEV * s0.chord, 0, stabZ], [s1.xLe - ELEV * s1.chord - (s0.xLe - ELEV * s0.chord), mirror ? -4.15 : 4.15, s1.z - s0.z], paint, stabInner);
  }
  // Bullet fairing at the fin / stabilizer junction.
  const bullet = new THREE.SphereGeometry(1, 24, 12);
  bullet.scale(0.19, 0.19, 1.45);
  mesh(bullet, paint, 'tail_bullet', stabInner).position.copy(bl(-9.55, 0, stabZ));

  // ---------------------------------------------------------------- engines (aft-fuselage pylons, fdm.ts positions)
  const engines = group('engines');
  const fans: THREE.Object3D[] = [];
  const reversers: THREE.Object3D[][] = [];
  const NAC_LEN = 3.5; // EST HTF7700L nacelle
  const NAC_R = 0.62; // EST max radius (fan 0.87 m, HTF7000 family)
  for (const y of [-2.1, 2.1]) {
    const g = group(y < 0 ? 'engine_l' : 'engine_r', engines);
    g.position.copy(bl(-4.3, y, -0.75));
    const prof: THREE.Vector2[] = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 inlet lip .. 1 exhaust
      let r: number;
      if (t < 0.06) r = NAC_R * (0.8 + 0.2 * Math.sin((t / 0.06) * Math.PI / 2));
      else if (t < 0.55) r = NAC_R;
      else r = NAC_R * (1 - 0.38 * ((t - 0.55) / 0.45) ** 1.4);
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.49 - t * NAC_LEN));
    }
    const nac = new THREE.LatheGeometry(prof, 44);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(NAC_R * 0.8, 0.045, 10, 44);
    mesh(lip, leMetal, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.49, 0, 0));
    const inner = new THREE.CylinderGeometry(NAC_R * 0.78, NAC_R * 0.78, 0.5, 40, 1, true);
    inner.rotateX(Math.PI / 2);
    mesh(inner, dark, 'inlet_duct', g).position.copy(bl(NAC_LEN * 0.49 - 0.25, 0, 0));
    const fan = new THREE.Group();
    fan.position.copy(bl(NAC_LEN * 0.49 - 0.42, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(NAC_R * 0.77, 36), dark, 'fan_disc', fan);
    const blade = new THREE.BoxGeometry(0.05, NAC_R * 1.5, 0.012);
    for (let b = 0; b < 12; b++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.012;
      bm.rotation.z = (b / 12) * Math.PI;
      bm.rotation.y = 0.55;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.16, 0.34, 24);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, chrome, 'spinner', fan).position.z = -0.17;
    fans.push(fan);
    // Exhaust nozzle and mixer plug.
    const plug = new THREE.ConeGeometry(0.24, 0.6, 24);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.51 - 0.2, 0, 0));
    const noz = new THREE.CylinderGeometry(NAC_R * 0.62, NAC_R * 0.62, 0.05, 36, 1, true);
    noz.rotateX(Math.PI / 2);
    mesh(noz, dark, 'nozzle', g).position.copy(bl(-NAC_LEN * 0.51 + 0.03, 0, 0));
    // Pivot-door reverser: upper and lower doors pivot about a transverse axis at mid-door (OG 7-2).
    const doors: THREE.Object3D[] = [];
    for (const s of [1, -1]) {
      const piv = new THREE.Group();
      piv.position.copy(bl(-0.95, 0, -s * NAC_R * 0.99));
      g.add(piv);
      const door = new THREE.CylinderGeometry(NAC_R * 1.005, NAC_R * 0.97, 0.9, 20, 1, true, s > 0 ? -Math.PI / 3.2 : Math.PI - Math.PI / 3.2, (2 * Math.PI) / 3.2);
      door.rotateX(Math.PI / 2);
      // Cylinder axis now along local z (body -x); centre it on the pivot (the patch sits at the nacelle skin).
      door.translate(0, s * NAC_R * 0.99, 0);
      mesh(door, greyPaint, 'reverser_door', piv);
      doors.push(piv);
    }
    reversers.push(doors);
    // Pylon to the fuselage side.
    const pyl = new THREE.BoxGeometry(0.72, 0.16, 1.9);
    const pm = mesh(pyl, paint, 'pylon', engines);
    pm.position.copy(bl(-4.15, Math.sign(y) * 1.33, -0.72));
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
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, twin: boolean, axis: [number, number, number], angle: number, trail: number) => {
    const pivot = group(`gear${index}`);
    pivot.position.copy(bl(contact[0] + trail, contact[1], pivotZ));
    const strut = group('strut', pivot);
    // Static compression is part of the contact height (fdm GEAR_Z at full extension).
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(0.06, 0.06, len * 0.75, 14);
    mesh(oleo, gearPaint, 'oleo', strut).position.y = -len * 0.375;
    const piston = new THREE.CylinderGeometry(0.045, 0.045, len * 0.35, 12);
    mesh(piston, chrome, 'piston', strut).position.y = -len * 0.8;
    const steer = group('steer', strut);
    steer.position.y = -len;
    // Trailing link: arm from the strut foot back to the axle.
    const arm = new THREE.BoxGeometry(0.07, 0.07, Math.abs(trail) + 0.05);
    const am = mesh(arm, gearPaint, 'trailing_link', steer);
    am.position.z = trail / 2;
    const axle = group('axle', steer);
    axle.position.z = trail; // trail > 0: axle aft of the strut foot (local +z = aft)
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 14, 30);
    tg.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, width * 0.9, 20);
    hub.rotateZ(Math.PI / 2);
    for (const off of twin ? [-width * 0.62, width * 0.62] : [0]) {
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
  // Nose: twin wheels (EST), trailing link, retracts forward into the nose bay.
  makeLeg(0, [8.77, 0, 1.88], 0.98, 0.24, 0.17, 0.2, true, [0, 1, 0], -100 * D2R, 0.22);
  // Mains: dual wheels, trailing link, retract inboard into the belly (EST, OG 14-2).
  makeLeg(1, [-0.85, -1.475, 1.88], 0.86, 0.34, 0.21, 0.26, true, [1, 0, 0], 86 * D2R, 0.32);
  makeLeg(2, [-0.85, 1.475, 1.88], 0.86, 0.34, 0.21, 0.26, true, [1, 0, 0], -86 * D2R, 0.32);
  // Gear doors: nose bay doors (two, along the keel) and main-gear inboard doors on the belly.
  const doorPivots: { obj: THREE.Group; axis: THREE.Vector3; open: number }[] = [];
  const bayDoor = (name: string, hingeBody: [number, number, number], w: number, len: number, side: number, axisBody: [number, number, number], openRad: number) => {
    const p = group(name);
    p.position.copy(bl(...hingeBody));
    const d = new THREE.BoxGeometry(w, 0.012, len);
    d.translate((side * w) / 2, 0, 0);
    mesh(d, paint, name, p);
    doorPivots.push({ obj: p, axis: bl(...axisBody).normalize(), open: openRad });
  };
  bayDoor('nose_door_l', [8.75, -0.24, 1.14], 0.23, 0.95, 1, [1, 0, 0], 85 * D2R);
  bayDoor('nose_door_r', [8.75, 0.24, 1.14], 0.23, 0.95, -1, [1, 0, 0], -85 * D2R);
  bayDoor('main_door_l', [-0.6, -0.05, 1.21], 0.65, 1.1, -1, [1, 0, 0], -80 * D2R);
  bayDoor('main_door_r', [-0.6, 0.05, 1.21], 0.65, 1.1, 1, [1, 0, 0], 80 * D2R);
  // Wheel wells (dark recesses visible with the doors open).
  const well = new THREE.BoxGeometry(2.3, 0.3, 1.2);
  mesh(well, wellMat, 'main_well', body).position.copy(bl(-0.6, 0, 1.0));
  const nwell = new THREE.BoxGeometry(0.46, 0.3, 1.0);
  mesh(nwell, wellMat, 'nose_well', body).position.copy(bl(8.75, 0, 1.0));

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
  const tipX = wingAt(TIP_Y).xLe;
  const tipZ = wingAt(TIP_Y).z;
  // Position lights in the winglet roots (red left, green right), white on the tail cone (14 CFR 25.1385-1391 layout).
  const navL = lamp(0xff1a1a, [tipX - 0.05, -(TIP_Y + 0.02), tipZ], 0.045, lightsG);
  const navR = lamp(0x19ff4a, [tipX - 0.05, TIP_Y + 0.02, tipZ], 0.045, lightsG);
  const navT = lamp(0xffffff, [-11.02, 0, -0.84], 0.04, lightsG);
  // Anti-collision: white strobes in the wingtips and the tail bullet trailing edge; red beacons on the bullet and the belly.
  const strobeL = lamp(0xffffff, [tipX - 0.25, -(TIP_Y + 0.03), tipZ], 0.04, lightsG, 22);
  const strobeR = lamp(0xffffff, [tipX - 0.25, TIP_Y + 0.03, tipZ], 0.04, lightsG, 22);
  const strobeT = lamp(0xffffff, [-11.02, 0, stabZ], 0.04, lightsG, 22);
  const beaconTop = lamp(0xff2200, [-9.2, 0, stabZ - 0.21], 0.05, lightsG, 18);
  const beaconBot = lamp(0xff2200, [-1.9, 0, 1.24], 0.05, lightsG, 18);
  // Landing / recognition / pulse: belly lights L and R ahead of the wing (lighting.ts; EST position).
  const ldgL = lamp(0xfff6e8, [3.1, -0.55, 1.17], 0.055, lightsG, 20);
  const ldgR = lamp(0xfff6e8, [3.1, 0.55, 1.17], 0.055, lightsG, 20);
  const wtaxiL = lamp(0xfff6e8, [tipX - 0.5, -(TIP_Y - 0.05), tipZ + 0.06], 0.035, lightsG);
  const wtaxiR = lamp(0xfff6e8, [tipX - 0.5, TIP_Y - 0.05, tipZ + 0.06], 0.035, lightsG);
  const wingL = lamp(0xfff2dd, [2.2, -1.12, -0.05], 0.03, lightsG);
  const wingR = lamp(0xfff2dd, [2.2, 1.12, -0.05], 0.03, lightsG);
  const logoL = lamp(0xfff2dd, [-9.7, -0.9, stabZ - 0.08], 0.03, lightsG);
  const logoR = lamp(0xfff2dd, [-9.7, 0.9, stabZ - 0.08], 0.03, lightsG);
  const emerL = lamp(0xfff2dd, [5.9, -1.17, -0.1], 0.03, lightsG);
  const emerW = lamp(0xfff2dd, [0.9, -1.16, 0.2], 0.03, lightsG);
  // Real spot lights (candela x the world's photometric scale): landing L / R and the nose-gear taxi light.
  const spot = (pos: [number, number, number], target: [number, number, number], angle: number, parent: THREE.Object3D) => {
    const s = new THREE.SpotLight(0xfff4e6, 0, 1200, angle * D2R, 0.4, 2);
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    s.castShadow = false;
    parent.add(s, s.target);
    return s;
  };
  const spotL = spot([3.1, -0.55, 1.2], [80, -4, 6], 11, lightsG);
  const spotR = spot([3.1, 0.55, 1.2], [80, 4, 6], 11, lightsG);
  // Taxi light on the nose gear (moves with the strut and the steering).
  const taxiParent = legs[0].steer;
  const taxiLamp = new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false });
  track(taxiLamp);
  const tl = new THREE.Mesh(track(new THREE.SphereGeometry(0.04, 10, 8)), taxiLamp);
  tl.position.set(0, 0.35, -0.08);
  taxiParent.add(tl);
  const taxiSpot = new THREE.SpotLight(0xfff4e6, 0, 400, 28 * D2R, 0.5, 2);
  taxiSpot.position.set(0, 0.35, -0.1);
  taxiSpot.target.position.set(0, -1.3, -25);
  taxiParent.add(taxiSpot, taxiSpot.target);

  // Wings, winglets, nose, lights: visible from the cockpit windows. Everything else hides in the cockpit view.
  for (const c of root.children) if (c.userData.visibleFromCockpit === undefined) c.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const posVar = [0, 1, 2].map((i) => GEAR.pos(i));
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const n1Var = [1, 2].map((i) => ENG.n1(i));
  const revVar = [1, 2].map((i) => ENG.reverserPos(i));
  const L = {
    nav: 'light.nav',
    strobe: 'light.strobe',
    strobeTail: 'light.strobe_tail',
    beacon: 'light.beacon',
    beaconLower: 'light.beacon_lower',
    ldgL: 'light.landing_l',
    ldgR: 'light.landing_r',
    recog: 'light.recognition',
    pulseL: 'light.pulse_l',
    pulseR: 'light.pulse_r',
    taxi: 'light.taxi',
    wtaxi: 'light.wingtip_taxi',
    wing: 'light.wing',
    logo: 'light.logo',
    emer: 'light.emer',
  };
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
    // Hinge axes run root -> tip: right side toward +x local, left side toward -x.
    setHinge(movables.flapR, flaps);
    setHinge(movables.flapL, -flaps);
    const ail = v.get(SURF.aileron) * 20 * D2R; // EST +-20 deg aileron travel
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    // Spoilers: panels 2-3 = roll spoilers / speedbrakes (35 deg in flight, OG 15-4); all three = ground spoilers (60 deg, OG 15-5).
    const gs = v.get(SURF.groundSpoilers) * 60 * D2R;
    const sl = Math.max(v.get(SURF.spoilerLeft) * 35 * D2R, gs);
    const sr = Math.max(v.get(SURF.spoilerRight) * 35 * D2R, gs);
    setHinge(movables.spl1R, -gs);
    setHinge(movables.spl1L, gs);
    setHinge(movables.spl2R, -sr);
    setHinge(movables.spl3R, -sr);
    setHinge(movables.spl2L, sl);
    setHinge(movables.spl3L, sl);
    const elev = v.get(SURF.elevator) * 18 * D2R; // EST +-18 deg
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 25 * D2R);
    // Stabilizer incidence (deg, negative = leading edge down = nose-up trim).
    stabG.rotation.x = v.get('trim.pitch_units', -3.5) * D2R;
    for (let i = 0; i < 2; i++) {
      // Visual fan speed: N1 fraction x 60 rev/s cap (a real rate would alias on screen).
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 60 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
      const r = v.get(revVar[i]);
      // Pivot doors: the forward edge swings out and the aft edge in across the jet (EST 45 deg).
      reversers[i][0].rotation.x = -r * 45 * D2R;
      reversers[i][1].rotation.x = r * 45 * D2R;
    }
    const nav = v.get(L.nav);
    setLamp(navL, nav);
    setLamp(navR, nav);
    setLamp(navT, nav);
    const st1 = v.get(L.strobe);
    setLamp(strobeL, st1);
    setLamp(strobeR, st1);
    setLamp(strobeT, v.get(L.strobeTail));
    setLamp(beaconTop, v.get(L.beacon));
    setLamp(beaconBot, v.get(L.beaconLower));
    const recog = v.get(L.recog);
    const ll = Math.max(v.get(L.ldgL), recog, v.get(L.pulseL));
    const lr = Math.max(v.get(L.ldgR), recog, v.get(L.pulseR));
    setLamp(ldgL, ll);
    setLamp(ldgR, lr);
    const taxi = v.get(L.taxi);
    taxiLamp.color.setRGB(0.06 + 0.94 * taxi, 0.06 + 0.94 * taxi, 0.06 + 0.9 * taxi);
    const wt = v.get(L.wtaxi);
    setLamp(wtaxiL, wt);
    setLamp(wtaxiR, wt);
    const wi = v.get(L.wing);
    setLamp(wingL, wi);
    setLamp(wingR, wi);
    const lg = v.get(L.logo);
    setLamp(logoL, lg);
    setLamp(logoR, lg);
    const em = v.get(L.emer);
    setLamp(emerL, em);
    setLamp(emerW, em);
    // EST: 400,000 cd LED landing lights (Whelen/Aveo class), 60,000 cd taxi light, in scene light units.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    spotL.intensity = ll * 400_000 * k;
    spotR.intensity = lr * 400_000 * k;
    taxiSpot.intensity = taxi * 60_000 * k;
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
