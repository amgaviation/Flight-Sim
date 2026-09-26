/**
 * Procedural exterior of the Bombardier Global 6000 (BD-700-1A10).
 *
 * Dimensions (SPEC factsheet; GXAG GX_01_002): length 99 ft 5 in (30.30 m),
 * span 94 ft 0 in (28.65 m) over the winglets, height 25 ft 6 in (7.77 m),
 * fuselage 2.69 m diameter, wheelbase 13.06 m, main-gear track 4.18 m,
 * horizontal tail span 9.68 m; wing 1,022 ft^2 with ~35 deg sweep, four
 * leading-edge slat segments per side, double-slotted Fowler flaps (inboard /
 * outboard), ailerons, four multifunction spoilers and two ground spoilers
 * per wing (GXFC), blended winglets; T-tail with a trimmable stabilizer
 * (GXFC 0-14 units = -2 .. +12 deg); two BR700-710A2-20 on aft-fuselage
 * pylons (fdm.ts nacelles at x -9.3, y +-2.45, z -0.95) with Hurel-Dubois
 * target-type reverser doors (Flight Global: "Hurel-Dubois ... complete
 * nacelle for the BR710"); main tyres H38x12.0-19 twin, nose 21x7.25-10
 * twin (TCDS 5.9); 27 cabin windows (14 right, 13 left: Bombardier "27 large
 * windows"), main entry door forward left.
 *
 * All positions are body metres (x fwd, y right, z down) from the datum and
 * match fdm.ts (gear contacts at GEAR_Z = 2.25 m extended, ~2.12 m ground
 * with static compression; wing MAC leading edge at x 1.06 m) and the
 * cockpit (layout.ts fuselage sections and glazing). Shapes between those
 * anchors are EST from the three-view and photographs.
 *
 * Animated in `update(dt)` from SimVars: gear retraction (gear.pos*), doors
 * (gear.doors), strut compression, nosewheel steering, wheel spin; slats
 * (surf.slats), Fowler flaps (surf.flaps_deg: rotation + aft travel),
 * ailerons, multifunction / ground spoilers, elevator, rudder, stabilizer
 * incidence (trim.pitch_units); fan rotation (eng*.n1_pct), reverser doors
 * (eng*.reverser_pos); exterior lights from the LightingSystem outputs
 * (light.*, systems/lighting.ts) with real spot lights in candela through
 * the world's render_units_per_lux scale. Livery-neutral white with subtle
 * panel lines.
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type WingSection } from '../_test/loft';
import { A_PILLAR, G6K_FUSELAGE as F, NOSE_X, SIDE_WINDOWS, TAIL_X, WINDSHIELD } from './cockpit/layout';
import { GEAR_Z, HALF_TRACK, MAIN_X, NOSE_X as NOSE_GEAR_X } from './fdm';

const D2R = Math.PI / 180;

/** Wing planform, right side (EST from the three-view: LE sweep ~37 deg, trailing-edge kink ("yehudi") at 4.4 m; MAC LE at x 1.06 m, fdm.ts). */
export const G6K_WING: WingSection[] = [
  { y: 0.8, xLe: 4.55, chord: 7.0, z: 0.98, t: 0.14, twistDeg: 2 },
  { y: 4.4, xLe: 1.85, chord: 4.15, z: 0.83, t: 0.12, twistDeg: 0.5 },
  { y: 13.8, xLe: -5.25, chord: 1.2, z: 0.4, t: 0.095, twistDeg: -2.5 },
];
const TIP_Y = 13.8;

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = G6K_WING;
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
  basePos: THREE.Vector3;
  /** Translation (cockpit-local metres) at full deflection (Fowler travel / slat extension). */
  slide: THREE.Vector3;
}

export interface G6kExterior {
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
      const ring = x % 34 === 0; // ~0.9 m frames over the 30 m loft
      const lap = y === 40 || y === 88 || y === 168 || y === 216;
      const v = ring || lap ? 216 : 250;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = Math.min(255, v + 2);
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

export function createG6kExterior(vars: SimVars): G6kExterior {
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
  const radome = track(new THREE.MeshStandardMaterial({ color: 0xe6e7e9, roughness: 0.45, metalness: 0.02, side: THREE.DoubleSide }));
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
  const ws = WINDSHIELD;
  const sw = SIDE_WINDOWS;

  // ---------------------------------------------------------------- fuselage
  const body = group('fuselage');
  // Cabin and tail cone up to the aft side window; the flight-deck skin is split around the glazing.
  mesh(loftFuselage(F, TAIL_X, sw.aft.x0, 0, TWO_PI, 150, 56), skin, 'cabin', body);
  const deck = group('flight_deck_skin', body);
  deck.userData.visibleFromCockpit = false;
  // Below the side-window sill, all round, from the aft window to the windshield base.
  mesh(loftFuselage(F, sw.aft.x0, ws.baseX, sw.sill, TWO_PI - sw.sill, 24, 30), skin, 'deck_lower', deck);
  mesh(loftFuselage(F, sw.aft.x0, ws.headerX, -sw.roof, sw.roof, 16, 12), skin, 'deck_roof', deck);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, ws.halfAngle, sw.sill, 8, 6), skin, 'ws_side_r', deck);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, -sw.sill, -ws.halfAngle, 8, 6), skin, 'ws_side_l', deck);
  for (const [x0, x1, n] of [
    [sw.aft.x1, sw.fwd.x0, 'mid_post'],
    [sw.fwd.x1, ws.headerX, 'b_post'],
  ] as [number, number, string][]) {
    mesh(loftFuselage(F, x0, x1, sw.roof, sw.sill, 2, 6), skin, `${n}_r`, deck);
    mesh(loftFuselage(F, x0, x1, -sw.sill, -sw.roof, 2, 6), skin, `${n}_l`, deck);
  }
  // Nose ahead of the windshield (seen over the glareshield): white skin, radome forward of ~13.4 m.
  const nose = group('nose');
  nose.userData.visibleFromCockpit = true;
  mesh(loftFuselage(F, ws.baseX, 13.4, 0, TWO_PI, 20, 56), paint, 'nose', nose);
  mesh(loftFuselage(F, 13.4, NOSE_X, 0, TWO_PI, 16, 56), radome, 'radome', nose);
  // Glazing: two main windshield panes and the side panes (centre post), side windows (layout.ts, cockpit shell openings).
  const glz = group('glazing', body);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, ws.postHalf, ws.halfAngle, 10, 16, { inset: -0.004 }), glass, 'windshield_r', glz);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle, -ws.postHalf, 10, 16, { inset: -0.004 }), glass, 'windshield_l', glz);
  // Windshield frame (A-pillars, centre post) in dark paint (Global black windshield surround, EST).
  mesh(loftFuselage(F, ws.headerX, ws.baseX, ws.halfAngle, ws.halfAngle + A_PILLAR * 0.5, 8, 1, { inset: -0.006 }), dark, 'a_pillar_r', glz);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, -ws.halfAngle - A_PILLAR * 0.5, -ws.halfAngle, 8, 1, { inset: -0.006 }), dark, 'a_pillar_l', glz);
  mesh(loftFuselage(F, ws.headerX, ws.baseX, -ws.postHalf, ws.postHalf, 8, 1, { inset: -0.006 }), dark, 'centre_post', glz);
  for (const w of [sw.fwd, sw.aft]) {
    mesh(loftFuselage(F, w.x0, w.x1, sw.roof, sw.sill, 6, 6, { inset: -0.004 }), glass, 'side_window_r', glz);
    mesh(loftFuselage(F, w.x0, w.x1, -sw.sill, -sw.roof, 6, 6, { inset: -0.004 }), glass, 'side_window_l', glz);
  }
  // Cabin windows: large rounded ovals, 14 right / 13 left (door forward left).
  const winShape = new THREE.Shape();
  {
    const w = 0.3;
    const h = 0.42;
    const r = 0.14;
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
  const winX = (k: number) => 8.1 - k * 0.97;
  const winList: [number, number][] = [];
  for (let k = 0; k < 14; k++) winList.push([winX(k), 1]);
  for (let k = 1; k < 14; k++) winList.push([winX(k), -1]);
  const wins = new THREE.InstancedMesh(winGeo, glass, winList.length);
  wins.name = 'cabin_windows';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  winList.forEach(([x, side], k) => {
    F.point(x, side * 1.33, -0.006, pv);
    q.setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, 0, 'YXZ'));
    m4.compose(pv, q, one);
    wins.setMatrixAt(k, m4);
  });
  body.add(wins);
  // Door outlines (thin grey seams): main entry door forward left (airstair), baggage door aft left, emergency exit over the wing right.
  const seam = (x0: number, x1: number, t0: number, t1: number, name: string) => {
    const e = 0.012;
    mesh(loftFuselage(F, x0, x1, t0, t0 + e, 8, 1, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x0, x1, t1 - e, t1, 8, 1, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x0, x0 + 0.012, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, body);
    mesh(loftFuselage(F, x1 - 0.012, x1, t0, t1, 1, 6, { inset: -0.003 }), greyPaint, name, body);
  };
  seam(8.55, 9.45, -2.42, -0.9, 'entry_door'); // EST ~0.9 m x 1.8 m airstair door
  seam(-5.9, -5.05, -2.2, -1.6, 'baggage_door');
  seam(2.3, 2.85, 0.98, 1.6, 'emer_exit');
  // Wing-to-body fairing under the centre section (EST from photographs).
  const FAIR = new FuselageProfile([
    { x: 5.6, cz: 1.08, ry: 0.1, rz: 0.05 },
    { x: 4.6, cz: 1.05, ry: 1.05, rz: 0.36 },
    { x: 2.6, cz: 1.05, ry: 1.45, rz: 0.42 },
    { x: -1.8, cz: 1.05, ry: 1.45, rz: 0.42 },
    { x: -3.3, cz: 1.0, ry: 1.05, rz: 0.32 },
    { x: -4.4, cz: 0.95, ry: 0.1, rz: 0.05 },
  ]);
  mesh(loftFuselage(FAIR, -4.4, 5.6, (0.9 * Math.PI) / 2, TWO_PI - (0.9 * Math.PI) / 2, 44, 28), paint, 'wing_fairing', body);

  // ---------------------------------------------------------------- wings with movable surfaces
  const wings = group('wings');
  wings.userData.visibleFromCockpit = true;
  const movables: Record<string, Movable[]> = { slatL: [], slatR: [], flapL: [], flapR: [], ailL: [], ailR: [], mfsL: [], mfsR: [], gsL: [], gsR: [], elevL: [], elevR: [], rudder: [] };
  const hinge = (name: keyof typeof movables, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D, slideBody?: [number, number, number]) => {
    const pivot = new THREE.Group();
    pivot.name = `${name}_hinge`;
    pivot.position.copy(bl(...pivotBody));
    parent.add(pivot);
    g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    mesh(g, m, name, pivot);
    const slide = slideBody ? bl(...slideBody) : new THREE.Vector3();
    movables[name].push({ obj: pivot, axis: bl(...axisBody).normalize(), base: pivot.quaternion.clone(), basePos: pivot.position.clone(), slide });
  };
  const FLAP_IN = [1.2, 4.4];
  const FLAP_OUT = [4.4, 9.4];
  const AIL = [9.5, 13.2];
  const HINGE_C = 0.74; // EST flap / aileron hinge line at 74 % chord
  const SLAT_C = 0.14; // EST slat chord fraction
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    const S = (y: number, t: number): WingSection => ({ y, ...wingAt(y), t });
    // Wing box between the slat and the hinge line; full-chord trailing-edge pieces where there are no movables.
    mesh(loftWing(G6K_WING, { mirror, chordRange: [SLAT_C, HINGE_C], n: 18 }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(loftWing([S(0.8, 0.14), S(1.6, 0.138)], { mirror, chordRange: [0, SLAT_C] }), leMetal, 'le_root', wings);
    mesh(loftWing([S(0.8, 0.14), S(FLAP_IN[0], 0.139)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_root', wings);
    mesh(loftWing([S(FLAP_OUT[1], 0.108), S(AIL[0], 0.107)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([S(AIL[1], 0.097), S(TIP_Y, 0.095)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_tip', wings);
    mesh(loftWing([S(13.3, 0.097), S(TIP_Y, 0.095)], { mirror, chordRange: [0, SLAT_C] }), leMetal, 'le_tip', wings);
    const hx = (s: WingSection, f: number) => s.xLe - f * s.chord;
    // Slats: four segments (GXAG), extend forward and down (EST 0.2 m travel + 20 deg droop).
    const slatSpans: [number, number][] = [
      [1.6, 4.4],
      [4.45, 7.4],
      [7.45, 10.35],
      [10.4, 13.3],
    ];
    for (const [y0, y1] of slatSpans) {
      const a = S(y0, 0.13);
      const bb = S(y1, 0.11);
      hinge(mirror ? 'slatL' : 'slatR', loftWing([a, bb], { mirror, chordRange: [0, SLAT_C] }), [hx(a, SLAT_C), sgn * a.y, a.z], [hx(bb, SLAT_C) - hx(a, SLAT_C), sgn * (bb.y - a.y), bb.z - a.z], leMetal, wings, [0.2, 0, 0.12]);
    }
    // Fowler flaps (inboard / outboard): rotate about the hinge line and travel aft (EST 0.28 chord at 30 deg).
    for (const [y0, y1] of [FLAP_IN, FLAP_OUT]) {
      const a = S(y0, 0.13);
      const bb = S(y1, 0.11);
      const aft = 0.28 * (a.chord + bb.chord) / 2 * (1 - HINGE_C) * 2.2;
      hinge(mirror ? 'flapL' : 'flapR', loftWing([a, bb], { mirror, chordRange: [HINGE_C, 1] }), [hx(a, HINGE_C), sgn * a.y, a.z], [hx(bb, HINGE_C) - hx(a, HINGE_C), sgn * (bb.y - a.y), bb.z - a.z], paint, wings, [-aft, 0, 0.08]);
    }
    const al = [S(AIL[0], 0.106), S(AIL[1], 0.097)];
    hinge(mirror ? 'ailL' : 'ailR', loftWing(al, { mirror, chordRange: [HINGE_C, 1] }), [hx(al[0], HINGE_C), sgn * al[0].y, al[0].z], [hx(al[1], HINGE_C) - hx(al[0], HINGE_C), sgn * (al[1].y - al[0].y), al[1].z - al[0].z], paint, wings);
    // Spoilers: 2 ground spoilers inboard, 4 multifunction spoilers outboard (GXFC), upper-surface panels hinged at their LE.
    const panels: [keyof typeof movables, number, number][] = [
      [mirror ? 'gsL' : 'gsR', 1.5, 2.9],
      [mirror ? 'gsL' : 'gsR', 2.95, 4.35],
      [mirror ? 'mfsL' : 'mfsR', 4.5, 5.65],
      [mirror ? 'mfsL' : 'mfsR', 5.7, 6.85],
      [mirror ? 'mfsL' : 'mfsR', 6.9, 8.05],
      [mirror ? 'mfsL' : 'mfsR', 8.1, 9.25],
    ];
    for (const [name, y0, y1] of panels) {
      const w0 = wingAt(y0);
      const w1 = wingAt(y1);
      const f0 = 0.55;
      const f1 = HINGE_C;
      const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z - 0.05 * w.chord * (1 - f * 0.9) - 0.004);
      const a = P(y0, w0, f0);
      const b2 = P(y1, w1, f0);
      const c2 = P(y1, w1, f1);
      const d2 = P(y0, w0, f1);
      const g = new THREE.BufferGeometry();
      g.setFromPoints(mirror ? [a, c2, b2, a, d2, c2] : [a, b2, c2, a, c2, d2]);
      g.computeVertexNormals();
      hinge(name, g, [w0.xLe - f0 * w0.chord, sgn * y0, w0.z - 0.03], [w1.xLe - w0.xLe - f0 * (w1.chord - w0.chord), sgn * (y1 - y0), w1.z - w0.z], greyPaint, wings);
    }
    // Blended winglet: ~2.1 m tall, canted 14 deg outboard, swept (EST; span over the winglets 28.65 m, SPEC).
    const tip = wingAt(TIP_Y);
    const wl = group(mirror ? 'winglet_l' : 'winglet_r', wings);
    wl.position.copy(bl(tip.xLe, sgn * (TIP_Y - 0.02), tip.z));
    wl.rotation.z = -sgn * 14 * D2R;
    const wlSecs: WingSection[] = [
      { y: 0, xLe: 0, chord: 1.2, z: 0, t: 0.095 },
      { y: 0.45, xLe: -0.55, chord: 0.8, z: 0, t: 0.09 },
      { y: 2.1, xLe: -1.55, chord: 0.42, z: 0, t: 0.085 },
    ];
    mesh(loftWing(wlSecs, { vertical: true }), paint, 'winglet', wl);
  }

  // ---------------------------------------------------------------- T-tail with trimmable stabilizer
  const tail = group('tail');
  const FIN_Z = -1.25;
  const FIN_H = 4.05;
  const fin: WingSection[] = [
    { y: 0, xLe: -9.9, chord: 5.0, z: FIN_Z, t: 0.11 },
    { y: FIN_H, xLe: -12.6, chord: 2.9, z: FIN_Z, t: 0.1 },
  ];
  const RUD = 0.7;
  mesh(loftWing(fin, { vertical: true, chordRange: [0, RUD] }), paint, 'fin', tail);
  mesh(loftWing([fin[0], { ...fin[0], y: 0.5, xLe: -10.25, chord: 4.77 }], { vertical: true, chordRange: [RUD, 1] }), paint, 'fin_te_root', tail);
  const finAt = (h: number) => ({ xLe: fin[0].xLe + (fin[1].xLe - fin[0].xLe) * (h / FIN_H), chord: fin[0].chord + (fin[1].chord - fin[0].chord) * (h / FIN_H) });
  const r0 = finAt(0.5);
  const r1 = finAt(FIN_H - 0.25);
  hinge(
    'rudder',
    loftWing([{ y: 0.5, ...r0, z: FIN_Z, t: 0.11 }, { y: FIN_H - 0.25, ...r1, z: FIN_Z, t: 0.1 }], { vertical: true, chordRange: [RUD, 1] }),
    [r0.xLe - RUD * r0.chord, 0, FIN_Z - 0.5],
    [r1.xLe - RUD * r1.chord - (r0.xLe - RUD * r0.chord), 0, -(FIN_H - 0.75)],
    paint,
    tail,
  );
  // Stabilizer on the fin tip: pivots for trim (GXFC 0..14 units = -2..+12 deg, leading edge down = nose-up trim).
  const stabZ = FIN_Z - FIN_H - 0.05;
  const stabPivotX = -13.4;
  const stabG = group('stabilizer', tail);
  stabG.position.copy(bl(stabPivotX, 0, stabZ));
  const stabInner = group('stab_inner', stabG);
  stabInner.position.copy(bl(-stabPivotX, 0, -stabZ));
  const HT_HALF = 9.68 / 2;
  const stab: WingSection[] = [
    { y: 0, xLe: -11.66, chord: 2.75, z: stabZ, t: 0.1 },
    { y: HT_HALF, xLe: -14.8, chord: 1.2, z: stabZ - 0.1, t: 0.09 },
  ];
  const ELEV = 0.7;
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, ELEV] }), paint, 'stab', stabInner);
    const s0 = stab[0];
    const s1 = stab[1];
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [ELEV, 1] }), [s0.xLe - ELEV * s0.chord, 0, stabZ], [s1.xLe - ELEV * s1.chord - (s0.xLe - ELEV * s0.chord), mirror ? -HT_HALF : HT_HALF, s1.z - s0.z], paint, stabInner);
  }
  const bullet = new THREE.SphereGeometry(1, 24, 12);
  bullet.scale(0.26, 0.26, 1.75);
  mesh(bullet, paint, 'tail_bullet', stabInner).position.copy(bl(-13.9, 0, stabZ));

  // ---------------------------------------------------------------- engines (aft-fuselage pylons, fdm.ts positions)
  const engines = group('engines');
  const fans: THREE.Object3D[] = [];
  const reversers: THREE.Object3D[][] = [];
  const NAC_LEN = 5.0; // EST BR710 nacelle
  const NAC_R = 0.78; // EST max radius (fan 1.22 m, BR710)
  const NAC_X = -9.55;
  for (const y of [-2.45, 2.45]) {
    const g = group(y < 0 ? 'engine_l' : 'engine_r', engines);
    g.position.copy(bl(NAC_X, y, -0.95));
    const prof: THREE.Vector2[] = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 inlet lip .. 1 exhaust
      let r: number;
      if (t < 0.06) r = NAC_R * (0.82 + 0.18 * Math.sin(((t / 0.06) * Math.PI) / 2));
      else if (t < 0.5) r = NAC_R;
      else r = NAC_R * (1 - 0.34 * ((t - 0.5) / 0.5) ** 1.5);
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.5 - t * NAC_LEN));
    }
    const nac = new THREE.LatheGeometry(prof, 48);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(NAC_R * 0.82, 0.05, 10, 48);
    mesh(lip, leMetal, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.5, 0, 0));
    const inner = new THREE.CylinderGeometry(NAC_R * 0.8, NAC_R * 0.8, 0.6, 40, 1, true);
    inner.rotateX(Math.PI / 2);
    mesh(inner, dark, 'inlet_duct', g).position.copy(bl(NAC_LEN * 0.5 - 0.3, 0, 0));
    const fan = new THREE.Group();
    fan.position.copy(bl(NAC_LEN * 0.5 - 0.55, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(NAC_R * 0.79, 36), dark, 'fan_disc', fan);
    const blade = new THREE.BoxGeometry(0.07, NAC_R * 1.55, 0.014);
    for (let k = 0; k < 12; k++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.014;
      bm.rotation.z = (k / 12) * Math.PI;
      bm.rotation.y = 0.55;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.2, 0.42, 24);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, chrome, 'spinner', fan).position.z = -0.21;
    fans.push(fan);
    const plug = new THREE.ConeGeometry(0.3, 0.8, 24);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.5 - 0.25, 0, 0));
    const noz = new THREE.CylinderGeometry(NAC_R * 0.66, NAC_R * 0.66, 0.06, 36, 1, true);
    noz.rotateX(Math.PI / 2);
    mesh(noz, dark, 'nozzle', g).position.copy(bl(-NAC_LEN * 0.5 + 0.03, 0, 0));
    // Target-type reverser doors (upper / lower) on the aft nacelle: hinged at their forward edge, the aft edges
    // swing in behind the nozzle (EST 50 deg).
    const doors: THREE.Object3D[] = [];
    const DL = 0.95;
    for (const s of [1, -1]) {
      const piv = new THREE.Group();
      const xh = -NAC_LEN * 0.5 + DL + 0.02;
      piv.position.copy(bl(xh, 0, -s * NAC_R * 0.8));
      g.add(piv);
      const door = new THREE.CylinderGeometry(NAC_R * 0.8, NAC_R * 0.68, DL, 22, 1, true, (s > 0 ? 0 : Math.PI) - Math.PI / 2.6, (2 * Math.PI) / 2.6);
      door.rotateX(-Math.PI / 2); // axis along the nacelle; theta 0 = up
      door.translate(0, -s * NAC_R * 0.8, DL / 2); // relative to the hinge at the door's forward edge
      mesh(door, greyPaint, 'reverser_door', piv);
      doors.push(piv);
    }
    reversers.push(doors);
    const pyl = new THREE.BoxGeometry(0.8, 0.2, 2.4);
    mesh(pyl, paint, 'pylon', engines).position.copy(bl(NAC_X + 0.1, Math.sign(y) * 1.32, -0.92));
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
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, axis: [number, number, number], angle: number, trail: number, strutR: number) => {
    const pivot = group(`gear${index}`);
    pivot.position.copy(bl(contact[0] + trail, contact[1], pivotZ));
    const strut = group('strut', pivot);
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(strutR, strutR, len * 0.72, 14);
    mesh(oleo, gearPaint, 'oleo', strut).position.y = -len * 0.36;
    const piston = new THREE.CylinderGeometry(strutR * 0.72, strutR * 0.72, len * 0.36, 12);
    mesh(piston, chrome, 'piston', strut).position.y = -len * 0.8;
    const steer = group('steer', strut);
    steer.position.y = -len;
    const axle = group('axle', steer);
    axle.position.z = trail;
    if (trail !== 0) {
      const arm = new THREE.BoxGeometry(0.08, 0.08, Math.abs(trail) + 0.05);
      mesh(arm, gearPaint, 'link', steer).position.z = trail / 2;
    }
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.68, radius * 0.32, 14, 30);
    tg.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width * 0.9, 20);
    hub.rotateZ(Math.PI / 2);
    const ax = new THREE.CylinderGeometry(0.05, 0.05, width * 2.3, 10);
    ax.rotateZ(Math.PI / 2);
    mesh(ax, metal, 'axle_tube', axle);
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
  // Nose: twin 21x7.25-10 (r 0.27 m), retracts forward into the nose bay (EST).
  makeLeg(0, [NOSE_GEAR_X, 0, GEAR_Z], 1.02, 0.27, 0.19, 0.28, [0, 1, 0], -100 * D2R, 0.1, 0.075);
  // Mains: twin H38x12.0-19 (r 0.48 m), retract inboard into the wing root / fairing (GXLG).
  makeLeg(1, [MAIN_X, -HALF_TRACK, GEAR_Z], 0.98, 0.48, 0.31, 0.34, [1, 0, 0], 88 * D2R, 0, 0.1);
  makeLeg(2, [MAIN_X, HALF_TRACK, GEAR_Z], 0.98, 0.48, 0.31, 0.34, [1, 0, 0], -88 * D2R, 0, 0.1);
  const doorPivots: { obj: THREE.Group; axis: THREE.Vector3; open: number }[] = [];
  const bayDoor = (name: string, hingeBody: [number, number, number], w: number, len: number, side: number, axisBody: [number, number, number], openRad: number) => {
    const p = group(name);
    p.position.copy(bl(...hingeBody));
    const d = new THREE.BoxGeometry(w, 0.012, len);
    d.translate((side * w) / 2, 0, 0);
    mesh(d, paint, name, p);
    doorPivots.push({ obj: p, axis: bl(...axisBody).normalize(), open: openRad });
  };
  bayDoor('nose_door_l', [NOSE_GEAR_X - 0.2, -0.28, 1.2], 0.27, 1.3, 1, [1, 0, 0], 85 * D2R);
  bayDoor('nose_door_r', [NOSE_GEAR_X - 0.2, 0.28, 1.2], 0.27, 1.3, -1, [1, 0, 0], -85 * D2R);
  bayDoor('main_door_l', [MAIN_X, -0.05, 1.46], 0.95, 1.35, -1, [1, 0, 0], -80 * D2R);
  bayDoor('main_door_r', [MAIN_X, 0.05, 1.46], 0.95, 1.35, 1, [1, 0, 0], 80 * D2R);
  mesh(new THREE.BoxGeometry(2.6, 0.35, 1.5), wellMat, 'main_well', body).position.copy(bl(MAIN_X, 0, 1.25));
  mesh(new THREE.BoxGeometry(0.52, 0.3, 1.35), wellMat, 'nose_well', body).position.copy(bl(NOSE_GEAR_X - 0.2, 0, 1.05));

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
  // Position lights on the wing tips under the winglet (red left, green right), white on the tail cone (14 CFR 25.1385-1391).
  const navL = lamp(0xff1a1a, [tip.xLe - 0.1, -(TIP_Y + 0.05), tip.z + 0.05], 0.05, lightsG);
  const navR = lamp(0x19ff4a, [tip.xLe - 0.1, TIP_Y + 0.05, tip.z + 0.05], 0.05, lightsG);
  const navT = lamp(0xffffff, [TAIL_X - 0.02, 0, -0.95], 0.045, lightsG);
  // Anti-collision: white strobes in the wing tips and the tail cone (GXLT: three synchronized); red / white beacons
  // top (fuselage crown aft of the wing) and bottom (belly).
  const strobeL = lamp(0xffffff, [tip.xLe - 0.4, -(TIP_Y + 0.06), tip.z + 0.03], 0.045, lightsG, 22);
  const strobeR = lamp(0xffffff, [tip.xLe - 0.4, TIP_Y + 0.06, tip.z + 0.03], 0.045, lightsG, 22);
  const strobeT = lamp(0xffffff, [TAIL_X - 0.02, 0, -0.88], 0.045, lightsG, 22);
  const beaconTop = lamp(0xff2200, [-2.0, 0, -1.47], 0.06, lightsG, 18);
  const beaconBot = lamp(0xff2200, [-5.5, 0, 1.27], 0.06, lightsG, 18);
  // Landing lights in the wing-root leading-edge fairings (L / R WING switches), nose-gear landing lights, wing-LE taxi /
  // recognition lights, logo lights on the stabilizer upper surface lighting the fin, wing inspection lights.
  const root0 = wingAt(1.5);
  const ldgL = lamp(0xfff6e8, [root0.xLe - 0.25, -1.5, root0.z + 0.05], 0.07, lightsG, 20);
  const ldgR = lamp(0xfff6e8, [root0.xLe - 0.25, 1.5, root0.z + 0.05], 0.07, lightsG, 20);
  const taxiW = wingAt(2.6);
  const taxiL = lamp(0xfff6e8, [taxiW.xLe - 0.15, -2.6, taxiW.z + 0.04], 0.05, lightsG, 18);
  const taxiR = lamp(0xfff6e8, [taxiW.xLe - 0.15, 2.6, taxiW.z + 0.04], 0.05, lightsG, 18);
  const wingL = lamp(0xfff2dd, [4.2, -1.3, -0.2], 0.035, lightsG);
  const wingR = lamp(0xfff2dd, [4.2, 1.3, -0.2], 0.035, lightsG);
  const logoL = lamp(0xfff2dd, [-13.6, -1.2, stabZ - 0.1], 0.035, lightsG);
  const logoR = lamp(0xfff2dd, [-13.6, 1.2, stabZ - 0.1], 0.035, lightsG);
  const emerL = lamp(0xfff2dd, [8.3, -1.3, 0.3], 0.03, lightsG);
  const emerR = lamp(0xfff2dd, [2.6, 1.32, 0.3], 0.03, lightsG);
  const spot = (pos: [number, number, number], target: [number, number, number], angle: number, parent: THREE.Object3D) => {
    const s = new THREE.SpotLight(0xfff4e6, 0, 1200, angle * D2R, 0.4, 2);
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    s.castShadow = false;
    parent.add(s, s.target);
    return s;
  };
  const spotL = spot([root0.xLe - 0.25, -1.5, root0.z + 0.05], [90, -6, 7], 11, lightsG);
  const spotR = spot([root0.xLe - 0.25, 1.5, root0.z + 0.05], [90, 6, 7], 11, lightsG);
  // Nose-gear landing lamps (move with the strut and the steering; lit only with the gear down, lighting.ts).
  const ngParent = legs[0].steer;
  const ngLamp = track(new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false }));
  const nl = new THREE.Mesh(track(new THREE.SphereGeometry(0.05, 10, 8)), ngLamp);
  nl.position.set(0, 0.45, -0.1);
  ngParent.add(nl);
  const ngSpot = new THREE.SpotLight(0xfff4e6, 0, 600, 16 * D2R, 0.5, 2);
  ngSpot.position.set(0, 0.45, -0.12);
  ngSpot.target.position.set(0, -1.5, -40);
  ngParent.add(ngSpot, ngSpot.target);

  for (const ch of root.children) if (ch.userData.visibleFromCockpit === undefined) ch.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const posVar = [0, 1, 2].map((i) => GEAR.pos(i));
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const n1Var = [1, 2].map((i) => ENG.n1(i));
  const revVar = [1, 2].map((i) => ENG.reverserPos(i));
  const tmpQ = new THREE.Quaternion();
  const setHinge = (list: Movable[], angle: number, slide = 0) => {
    for (const mv of list) {
      mv.obj.quaternion.copy(mv.base).multiply(tmpQ.setFromAxisAngle(mv.axis, angle));
      mv.obj.position.copy(mv.basePos).addScaledVector(mv.slide, slide);
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
      wheelAngle[leg.index] = (wheelAngle[leg.index] - w * dt) % (2 * Math.PI);
      for (const wh of leg.wheels) wh.rotation.x = wheelAngle[leg.index];
    }
    const doors = v.get('gear.doors');
    for (const d of doorPivots) d.obj.quaternion.setFromAxisAngle(d.axis, d.open * (doors > 0 ? doors : 0));
    // Slats: extend forward/down with a 20 deg droop (hinge axes run root -> tip).
    const sl = v.get(SURF.slats);
    setHinge(movables.slatR, 20 * D2R * sl, sl);
    setHinge(movables.slatL, -20 * D2R * sl, sl);
    const fd = v.get(SURF.flapsDeg);
    setHinge(movables.flapR, fd * D2R, fd / 30);
    setHinge(movables.flapL, -fd * D2R, fd / 30);
    const ail = v.get(SURF.aileron) * 20 * D2R; // EST +-20 deg aileron travel
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    // Spoilers: MFS roll / flight spoiler 0..40 deg (EST), ground spoilers + MFS on the ground 0..60 deg (GXFC GLD).
    const gs = v.get(SURF.groundSpoilers) * 60 * D2R;
    const ml = Math.max(v.get(SURF.spoilerLeft) * 40 * D2R, gs);
    const mr = Math.max(v.get(SURF.spoilerRight) * 40 * D2R, gs);
    setHinge(movables.gsR, -gs);
    setHinge(movables.gsL, gs);
    setHinge(movables.mfsR, -mr);
    setHinge(movables.mfsL, ml);
    const elev = v.get(SURF.elevator) * 20 * D2R; // EST +-20 deg
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 25 * D2R);
    // Stabilizer: units 0..14 = -2..+12 deg leading edge down (GXFC); + rotation about local x raises the LE.
    stabG.rotation.x = -(v.get('trim.pitch_units', 7) - 2) * D2R;
    for (let i = 0; i < 2; i++) {
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 60 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
      const r = v.get(revVar[i]);
      reversers[i][0].rotation.x = r * 50 * D2R; // upper door: aft edge down behind the nozzle
      reversers[i][1].rotation.x = -r * 50 * D2R;
    }
    const nav = v.get('light.nav');
    setLamp(navL, nav);
    setLamp(navR, nav);
    setLamp(navT, nav);
    const st1 = v.get('light.strobe');
    setLamp(strobeL, st1);
    setLamp(strobeR, st1);
    setLamp(strobeT, v.get('light.strobe_tail'));
    setLamp(beaconTop, v.get('light.beacon'));
    setLamp(beaconBot, v.get('light.beacon_lower'));
    const ll = v.get('light.landing_l');
    const lr = v.get('light.landing_r');
    setLamp(ldgL, ll);
    setLamp(ldgR, lr);
    const tx = Math.max(v.get('light.taxi'), v.get('light.recognition'));
    setLamp(taxiL, tx);
    setLamp(taxiR, tx);
    const ln = v.get('light.landing_nose');
    ngLamp.color.setRGB(0.06 + 0.94 * ln, 0.06 + 0.94 * ln, 0.06 + 0.9 * ln);
    const wi = v.get('light.wing');
    setLamp(wingL, wi);
    setLamp(wingR, wi);
    const lg = v.get('light.logo');
    setLamp(logoL, lg);
    setLamp(logoR, lg);
    const em = v.get('light.emer');
    setLamp(emerL, em);
    setLamp(emerR, em);
    // EST: 400,000 cd wing-root landing lights, 300,000 cd nose-gear landing lights, in scene light units.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    spotL.intensity = Math.max(ll, 0.3 * tx) * 400_000 * k;
    spotR.intensity = Math.max(lr, 0.3 * tx) * 400_000 * k;
    ngSpot.intensity = ln * 300_000 * k;
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
