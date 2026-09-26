/**
 * Procedural exterior of the Gulfstream G800 (GVIII-G800).
 *
 * Dimensions (TCDS IM.A.169 / FSB App. 3): length 30.41 m, span 31.40 m over the
 * winglets, height 7.78 m, fuselage width 2.74 m. G700 wing (WIKI: 1,283 ft^2 /
 * 119.2 m^2, ~36 deg leading-edge sweep EST from the three-view, no leading-edge
 * devices BJT500) with the G800's new large swept winglets; one-piece Fowler flap
 * per wing (UltimateJet G500 flight test: "huge single piece of flap"), outboard
 * ailerons, three spoiler panels per wing (six total: speed brakes 30 deg in flight,
 * all 55 deg on the ground, SCQ); T-tail with a trimmable horizontal stabilizer
 * (BJT500: no trim tabs), two Rolls-Royce Pearl 700 on aft-fuselage pylons (51.8 in
 * fan, RR), translating-sleeve reversers (EST); twin-wheel nose gear retracting
 * forward, twin-wheel mains retracting inboard (TCDS tyres: nose 21 x 7.25-10, mains
 * H37.5 x 12.0 R19); 16 Gulfstream panoramic oval windows (GAC, 28 x 20.5 in),
 * left-forward airstair door, ram-air turbine (EST position).
 *
 * All positions are body metres (x fwd, y right, z down) from the datum (empty
 * CG) and match fdm.ts: gear contacts (nose x 12.2, mains x -1.2 / y +-2.3, z 3.02),
 * nacelle centres (-9.0, +-2.6, -0.9), wing chord plane ~1.0 m below the datum
 * (MAC 4.756 m with its leading edge at x 1.81 m), winglet tips (fdm.ts structure
 * points). Shapes between those anchors are EST from published three-views and
 * photographs.
 *
 * Animated in `update(dt)` from SimVars: gear retraction (gear.pos*), gear doors
 * (gear.doors), strut compression, nosewheel steering, wheel spin; flaps
 * (surf.flaps_deg), ailerons, spoilers / speed brakes / ground spoilers, elevators,
 * rudder, stabilizer incidence (trim.pitch_units); fan rotation (eng*.n1_pct),
 * reverser sleeves (eng*.reverser_pos); RAT (ac.g800.rat_deployed); main door
 * (ac.door.main); exterior lights from the LightingSystem outputs (light.*), with
 * real spot lights in candela through the world's render_units_per_lux scale.
 * Livery-neutral white with subtle panel lines.
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl, bodyToLocal } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type WingSection } from '../_test/loft';
import { G800_FUSELAGE } from './cockpit/layout';
import { carvedSkin, halfWidth } from './cockpit/glazing';
import { G800_VARS as V } from './vars';

const D2R = Math.PI / 180;
const NOSE_X = 15.5;
const TAIL_X = -14.91;
/** Cockpit / cabin split of the exterior skin (the cockpit part is carved for the windows). */
const X_CKPT = 11.3;

/** Wing planform, right side (EST: LE sweep ~36 deg, trailing-edge kink at y 4.8 m; ~122 m^2 incl. carry-through vs 119.2 m^2 WIKI). */
export const G800_WING: WingSection[] = [
  { y: 0.9, xLe: 5.1, chord: 7.3, z: 1.02, t: 0.14, twistDeg: 2.5 },
  { y: 4.8, xLe: 2.25, chord: 4.55, z: 0.82, t: 0.12, twistDeg: 1 },
  { y: 15.38, xLe: -5.45, chord: 1.4, z: 0.26, t: 0.095, twistDeg: -2.5 },
];
/** TCDS span 31.40 m over the winglets: tip section at 15.38 m + ~0.3 m winglet cant. */
const TIP_Y = 15.38;

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = G800_WING;
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

export interface G800Exterior {
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
      const ring = x % 34 === 0;
      const lap = y === 36 || y === 92 || y === 164 || y === 220;
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

/**
 * Flat 2D shape (u = body x forward, v = up) projected onto the fuselage side at `side`, raised `lift` m
 * off the skin: windows, door outlines. Cockpit-local geometry.
 */
function skinDecal(shape: THREE.Shape, xc: number, zc: number, side: -1 | 1, lift: number, segs = 32): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, segs);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = xc + p.getX(i);
    const z = zc - p.getY(i);
    const y = side * (halfWidth(x, z, -lift) || 0.01);
    bodyToLocal(x, y, z, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // Face outward: ShapeGeometry winds CCW in (u, v); u fwd = -local z, v up = +local y -> normal +local x (right).
  if (side < 0) {
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 1));
      idx.setX(i + 1, a);
    }
  }
  g.computeVertexNormals();
  return g;
}

export function createG800Exterior(vars: SimVars): G800Exterior {
  const root = new THREE.Group();
  root.name = 'exterior';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const skinTex = track(panelLineTexture());
  skinTex.repeat.set(1, 1);
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
  const F = G800_FUSELAGE;
  const TWO_PI = 2 * Math.PI;

  // ---------------------------------------------------------------- fuselage
  const body = group('fuselage');
  mesh(loftFuselage(F, TAIL_X, X_CKPT, 0, TWO_PI, 180, 64), skin, 'cabin', body);
  // Cockpit section (window openings) and the nose / radome ahead of it: seen from the cockpit through the glazing.
  const nose = group('nose');
  nose.userData.visibleFromCockpit = true;
  mesh(carvedSkin(X_CKPT, 14.3, { inset: 0, keep: 'solid', dx: 0.025, segT: 240 }), paint, 'cockpit_skin', nose);
  mesh(loftFuselage(F, 14.3, NOSE_X, 0, TWO_PI, 24, 64), radome, 'radome', nose);
  // Glazing (exterior only: hidden in the cockpit view so it never blocks the pilots' view).
  const glz = group('glazing', body);
  mesh(carvedSkin(X_CKPT, 14.3, { inset: -0.004, keep: 'glass', dx: 0.02, segT: 300 }), glass, 'flight_deck_glazing', glz);
  // Wing-to-body fairing: belly fairing under the centre section (EST).
  const FAIR = new FuselageProfile([
    { x: 6.2, cz: 1.3, ry: 0.1, rz: 0.05 },
    { x: 5.2, cz: 1.26, ry: 1.2, rz: 0.34 },
    { x: 3.2, cz: 1.24, ry: 1.55, rz: 0.4 },
    { x: -1.8, cz: 1.24, ry: 1.55, rz: 0.4 },
    { x: -3.4, cz: 1.2, ry: 1.1, rz: 0.32 },
    { x: -4.6, cz: 1.14, ry: 0.12, rz: 0.05 },
  ]);
  mesh(loftFuselage(FAIR, -4.6, 6.2, 0.62 * Math.PI, TWO_PI - 0.62 * Math.PI, 48, 28), paint, 'wing_fairing', body);
  // Cabin windows: 16 Gulfstream panoramic ovals (GAC), 8 per side, 28 x 20.5 in (0.71 x 0.52 m) (GAC), EST pitch.
  const oval = new THREE.Shape();
  oval.absellipse(0, 0, 0.355, 0.26, 0, TWO_PI, false, 0);
  const winXs = [9.75, 8.2, 6.65, 5.1, 3.55, 2.0, 0.45, -1.1];
  const WIN_Z = -0.22;
  for (const side of [-1, 1] as const) for (const x of winXs) mesh(skinDecal(oval, x, WIN_Z, side, 0.004, 40), glass, 'cabin_window', body);
  // Door outlines (thin seams): baggage door (left aft, EST) and the emergency exit (right, over the wing, EST).
  const seamShape = (w: number, h: number, r: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const hole = new THREE.Path();
    const e = 0.012;
    hole.moveTo(-w / 2 + e + r, -h / 2 + e);
    hole.lineTo(w / 2 - e - r, -h / 2 + e);
    hole.quadraticCurveTo(w / 2 - e, -h / 2 + e, w / 2 - e, -h / 2 + e + r);
    hole.lineTo(w / 2 - e, h / 2 - e - r);
    hole.quadraticCurveTo(w / 2 - e, h / 2 - e, w / 2 - e - r, h / 2 - e);
    hole.lineTo(-w / 2 + e + r, h / 2 - e);
    hole.quadraticCurveTo(-w / 2 + e, h / 2 - e, -w / 2 + e, h / 2 - e - r);
    hole.lineTo(-w / 2 + e, -h / 2 + e + r);
    hole.quadraticCurveTo(-w / 2 + e, -h / 2 + e, -w / 2 + e + r, -h / 2 + e);
    s.holes.push(hole);
    return s;
  };
  mesh(skinDecal(seamShape(0.9, 0.95, 0.12), -5.6, 0.25, -1, 0.003, 8), greyPaint, 'baggage_door', body);
  mesh(skinDecal(seamShape(0.55, 0.9, 0.2), 1.2, -0.2, 1, 0.003, 8), greyPaint, 'emergency_exit', body);

  // Main entry door (airstair, left forward, EST 0.9 x 1.75 m): hinged at the sill, opens outward and down.
  const DOOR = { x0: 10.35, x1: 11.25, zTop: -1.12, zSill: 0.62 };
  const doorTheta = (z: number) => -Math.acos(Math.max(-1, Math.min(1, (F.at((DOOR.x0 + DOOR.x1) / 2).cz - z) / F.at((DOOR.x0 + DOOR.x1) / 2).rz)));
  const doorPivot = group('main_door');
  const hingeLocal = bodyToLocal((DOOR.x0 + DOOR.x1) / 2, -halfWidth((DOOR.x0 + DOOR.x1) / 2, DOOR.zSill, 0), DOOR.zSill, new THREE.Vector3());
  doorPivot.position.copy(hingeLocal);
  const doorGeo = loftFuselage(F, DOOR.x0, DOOR.x1, doorTheta(DOOR.zTop), doorTheta(DOOR.zSill), 8, 12, { inset: -0.006 });
  doorGeo.translate(-hingeLocal.x, -hingeLocal.y, -hingeLocal.z);
  mesh(doorGeo, paint, 'door_panel', doorPivot);
  // Seam around the door.
  mesh(skinDecal(seamShape(DOOR.x1 - DOOR.x0 + 0.02, DOOR.zSill - DOOR.zTop + 0.02, 0.12), (DOOR.x0 + DOOR.x1) / 2, (DOOR.zTop + DOOR.zSill) / 2, -1, 0.002, 8), greyPaint, 'entry_door_seam', body);
  // Door opening (dark) behind the door panel.
  mesh(skinDecal(seamShape(DOOR.x1 - DOOR.x0 - 0.02, DOOR.zSill - DOOR.zTop - 0.02, 0.1), (DOOR.x0 + DOOR.x1) / 2, (DOOR.zTop + DOOR.zSill) / 2, -1, 0.0015, 8), dark, 'door_opening', body);

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
  const FLAP = [1.45, 9.4]; // EST one-piece Fowler flap span (fuselage side to ~62 % semi-span)
  const AIL = [9.6, 14.4]; // EST aileron span
  const HINGE_C = 0.75; // flap / aileron hinge at 75 % chord (EST)
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    const S = (y: number, t: number): WingSection => ({ y, ...wingAt(y), t });
    mesh(loftWing(G800_WING, { mirror, chordRange: [0, HINGE_C], n: 18 }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(loftWing([S(0.9, 0.14), S(FLAP[0], 0.14)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_root', wings);
    mesh(loftWing([S(FLAP[1], 0.105), S(AIL[0], 0.105)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([S(AIL[1], 0.096), S(TIP_Y, 0.095)], { mirror, chordRange: [HINGE_C, 1] }), paint, 'te_tip', wings);
    mesh(loftWing([S(1.2, 0.14), S(4.8, 0.12), S(TIP_Y - 0.05, 0.095)].map((s) => ({ ...s, t: s.t * 1.02 })), { mirror, chordRange: [0, 0.035], n: 6 }), leMetal, 'wing_le', wings);
    const fl = [S(FLAP[0], 0.14), S(4.8, 0.12), S(FLAP[1], 0.105)];
    const fa = fl[0];
    const fb = fl[fl.length - 1];
    const hx = (s: WingSection) => s.xLe - HINGE_C * s.chord;
    hinge(mirror ? 'flapL' : 'flapR', loftWing(fl, { mirror, chordRange: [HINGE_C, 1] }), [hx(fa), sgn * fa.y, fa.z], [hx(fb) - hx(fa), sgn * (fb.y - fa.y), fb.z - fa.z], paint, wings);
    const al = [S(AIL[0], 0.104), S(AIL[1], 0.096)];
    hinge(mirror ? 'ailL' : 'ailR', loftWing(al, { mirror, chordRange: [HINGE_C, 1] }), [hx(al[0]), sgn * al[0].y, al[0].z], [hx(al[1]) - hx(al[0]), sgn * (al[1].y - al[0].y), al[1].z - al[0].z], paint, wings);
    // Spoilers: three upper-surface panels ahead of the flap (inboard = ground spoiler; outer two = roll / speed brake).
    const panels: [keyof typeof movables, number, number][] = [
      [mirror ? 'spl1L' : 'spl1R', 2.4, 4.6],
      [mirror ? 'spl2L' : 'spl2R', 4.7, 6.8],
      [mirror ? 'spl3L' : 'spl3R', 6.9, 9.0],
    ];
    for (const [name, y0, y1] of panels) {
      const w0 = wingAt(y0);
      const w1 = wingAt(y1);
      const f0 = 0.55;
      const f1 = 0.74;
      const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z - 0.05 * w.chord * (1 - f * 0.9) - 0.006);
      const a = P(y0, w0, f0);
      const b = P(y1, w1, f0);
      const c = P(y1, w1, f1);
      const d = P(y0, w0, f1);
      const g = new THREE.BufferGeometry();
      g.setFromPoints(mirror ? [a, c, b, a, d, c] : [a, b, c, a, c, d]);
      g.computeVertexNormals();
      hinge(name, g, [w0.xLe - f0 * w0.chord, sgn * y0, w0.z - 0.05], [w1.xLe - w0.xLe - f0 * (w1.chord - w0.chord), sgn * (y1 - y0), w1.z - w0.z], greyPaint, wings);
    }
    // Winglet: large swept blended winglet, canted ~12 deg outboard, ~1.3 m tall (fdm.ts winglet tip 1.2 m above the tip).
    const tip = wingAt(TIP_Y);
    const wl = group(mirror ? 'winglet_l' : 'winglet_r', wings);
    wl.position.copy(bl(tip.xLe, sgn * (TIP_Y - 0.02), tip.z));
    wl.rotation.z = -sgn * 12 * D2R;
    const wlSecs: WingSection[] = [
      { y: 0, xLe: 0, chord: 1.45, z: 0, t: 0.095 },
      { y: 0.3, xLe: -0.45, chord: 1.05, z: 0, t: 0.09 },
      { y: 1.3, xLe: -1.25, chord: 0.5, z: 0, t: 0.08 },
    ];
    mesh(loftWing(wlSecs, { vertical: true }), paint, 'winglet', wl);
  }

  // ---------------------------------------------------------------- T-tail with trimmable stabilizer
  const tail = group('tail');
  const FIN_Z = -1.25;
  const fin: WingSection[] = [
    { y: 0, xLe: -6.9, chord: 6.0, z: FIN_Z, t: 0.11 },
    { y: 3.35, xLe: -10.25, chord: 3.3, z: FIN_Z, t: 0.1 },
  ];
  const RUD = 0.72;
  mesh(loftWing(fin, { vertical: true, chordRange: [0, RUD] }), paint, 'fin', tail);
  const finAt = (h: number) => {
    const t = h / 3.35;
    return { xLe: -6.9 + (-10.25 + 6.9) * t, chord: 6.0 + (3.3 - 6.0) * t };
  };
  const r0 = finAt(0.45);
  const r1 = finAt(3.25);
  hinge(
    'rudder',
    loftWing([{ y: 0.45, ...r0, z: FIN_Z, t: 0.11 }, { y: 3.25, ...r1, z: FIN_Z, t: 0.1 }], { vertical: true, chordRange: [RUD, 1] }),
    [r0.xLe - RUD * r0.chord, 0, FIN_Z - 0.45],
    [r1.xLe - RUD * r1.chord - (r0.xLe - RUD * r0.chord), 0, -(3.25 - 0.45)],
    paint,
    tail,
  );
  // Stabilizer on the fin tip: height 7.78 m (TCDS) = 2.88 m datum height on the ramp + 4.9 m to the bullet top.
  const stabZ = -4.62;
  const stabPivotX = -12.3;
  const stabG = group('stabilizer', tail);
  stabG.position.copy(bl(stabPivotX, 0, stabZ));
  const stabInner = group('stab_inner', stabG);
  stabInner.position.copy(bl(-stabPivotX, 0, -stabZ));
  // EST: 10.6 m span, 33 deg LE sweep; tip trailing edge at the 30.41 m overall length (TCDS).
  const stab: WingSection[] = [
    { y: 0, xLe: -10.45, chord: 3.0, z: stabZ, t: 0.1 },
    { y: 5.3, xLe: -13.85, chord: 1.06, z: stabZ - 0.05, t: 0.09 },
  ];
  const ELEV = 0.7;
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, ELEV] }), paint, 'stab', stabInner);
    const s0 = stab[0];
    const s1 = stab[1];
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [ELEV, 1] }), [s0.xLe - ELEV * s0.chord, 0, stabZ], [s1.xLe - ELEV * s1.chord - (s0.xLe - ELEV * s0.chord), mirror ? -5.3 : 5.3, s1.z - s0.z], paint, stabInner);
  }
  const bullet = new THREE.SphereGeometry(1, 24, 12);
  bullet.scale(0.24, 0.24, 1.9);
  mesh(bullet, paint, 'tail_bullet', stabInner).position.copy(bl(-11.7, 0, stabZ));

  // ---------------------------------------------------------------- engines (aft-fuselage pylons, fdm.ts positions)
  const engines = group('engines');
  const fans: THREE.Object3D[] = [];
  const sleeves: THREE.Object3D[] = [];
  const NAC_LEN = 4.4; // EST Pearl 700 nacelle
  const NAC_R = 0.82; // EST max radius (51.8 in fan, RR)
  for (const y of [-2.6, 2.6]) {
    const g = group(y < 0 ? 'engine_l' : 'engine_r', engines);
    g.position.copy(bl(-9.0, y, -0.9));
    const prof: THREE.Vector2[] = [];
    const N = 30;
    // Forward cowl (inlet to the reverser break at 45 % length).
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 0.45;
      const r = t < 0.06 ? NAC_R * (0.82 + 0.18 * Math.sin((t / 0.06) * (Math.PI / 2))) : NAC_R;
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.49 - t * NAC_LEN));
    }
    const nac = new THREE.LatheGeometry(prof, 48);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle_fwd', g);
    // Aft cowl = reverser translating sleeve (slides aft to expose the cascades).
    const sp: THREE.Vector2[] = [];
    for (let i = 0; i <= N; i++) {
      const t = 0.45 + (i / N) * 0.47;
      const r = t < 0.6 ? NAC_R : NAC_R * (1 - 0.34 * ((t - 0.6) / 0.32) ** 1.3);
      sp.push(new THREE.Vector2(r, NAC_LEN * 0.49 - t * NAC_LEN));
    }
    const sleeve = new THREE.Group();
    g.add(sleeve);
    const sg = new THREE.LatheGeometry(sp, 48);
    sg.rotateX(-Math.PI / 2);
    mesh(sg, paint, 'reverser_sleeve', sleeve);
    sleeves.push(sleeve);
    // Cascade band (dark) under the sleeve.
    const casc = new THREE.CylinderGeometry(NAC_R * 0.96, NAC_R * 0.96, 0.4, 40, 1, true);
    casc.rotateX(Math.PI / 2);
    mesh(casc, dark, 'cascades', g).position.copy(bl(NAC_LEN * 0.49 - 0.45 * NAC_LEN - 0.2, 0, 0));
    const lip = new THREE.TorusGeometry(NAC_R * 0.83, 0.05, 10, 48);
    mesh(lip, leMetal, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.49, 0, 0));
    const inner = new THREE.CylinderGeometry(NAC_R * 0.8, NAC_R * 0.8, 0.6, 40, 1, true);
    inner.rotateX(Math.PI / 2);
    mesh(inner, dark, 'inlet_duct', g).position.copy(bl(NAC_LEN * 0.49 - 0.3, 0, 0));
    const fan = new THREE.Group();
    fan.position.copy(bl(NAC_LEN * 0.49 - 0.5, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(NAC_R * 0.79, 40), dark, 'fan_disc', fan);
    // 24-blade fan blisk (RR); 12 drawn blades read as the same disc at speed.
    const blade = new THREE.BoxGeometry(0.06, NAC_R * 1.55, 0.012);
    for (let k = 0; k < 12; k++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.012;
      bm.rotation.z = (k / 12) * Math.PI;
      bm.rotation.y = 0.55;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.2, 0.42, 24);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, chrome, 'spinner', fan).position.z = -0.21;
    fans.push(fan);
    const plug = new THREE.ConeGeometry(0.3, 0.75, 24);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.43 - 0.3, 0, 0));
    const noz = new THREE.CylinderGeometry(NAC_R * 0.64, NAC_R * 0.64, 0.05, 36, 1, true);
    noz.rotateX(Math.PI / 2);
    mesh(noz, dark, 'nozzle', g).position.copy(bl(-NAC_LEN * 0.43 + 0.03, 0, 0));
    // Pylon to the fuselage side.
    const pyl = new THREE.BoxGeometry(0.95, 0.22, 2.3);
    mesh(pyl, paint, 'pylon', engines).position.copy(bl(-9.2, Math.sign(y) * 1.4, -0.86));
  }

  // ---------------------------------------------------------------- ram-air turbine (EST: deploys from the right wing-root fairing)
  const ratPivot = group('rat');
  ratPivot.position.copy(bl(4.0, 1.05, 1.42));
  const ratStrut = new THREE.BoxGeometry(0.07, 0.6, 0.12);
  ratStrut.translate(0, -0.3, 0);
  mesh(ratStrut, gearPaint, 'rat_strut', ratPivot);
  const ratHub = new THREE.Group();
  ratHub.position.set(0, -0.6, -0.06);
  ratPivot.add(ratHub);
  const ratBlade = new THREE.BoxGeometry(0.05, 0.62, 0.01);
  mesh(ratBlade.clone(), metal, 'rat_blade', ratHub);
  mesh(ratBlade.clone(), metal, 'rat_blade', ratHub).rotation.z = Math.PI / 2;
  ratBlade.dispose();

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
    const oleo = new THREE.CylinderGeometry(strutR, strutR, len * 0.72, 16);
    mesh(oleo, gearPaint, 'oleo', strut).position.y = -len * 0.36;
    const piston = new THREE.CylinderGeometry(strutR * 0.75, strutR * 0.75, len * 0.36, 14);
    mesh(piston, chrome, 'piston', strut).position.y = -len * 0.8;
    const steer = group('steer', strut);
    steer.position.y = -len;
    const arm = new THREE.BoxGeometry(0.09, 0.09, Math.abs(trail) + 0.06);
    mesh(arm, gearPaint, 'trailing_link', steer).position.z = trail / 2;
    const axle = group('axle', steer);
    axle.position.z = trail;
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 14, 32);
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
  // Nose: twin 21 x 7.25-10 (0.27 m radius), retracts forward into the nose bay (EST).
  makeLeg(0, [12.2, 0, 3.02], 1.25, 0.27, 0.19, 0.3, [0, 1, 0], -100 * D2R, 0.2, 0.075);
  // Mains: twin H37.5 x 12.0 R19 (0.476 m radius), retract inboard into the wing root / belly (EST).
  makeLeg(1, [-1.2, -2.3, 3.02], 1.18, 0.476, 0.31, 0.35, [1, 0, 0], 88 * D2R, 0.35, 0.11);
  makeLeg(2, [-1.2, 2.3, 3.02], 1.18, 0.476, 0.31, 0.35, [1, 0, 0], -88 * D2R, 0.35, 0.11);
  const doorPivots: { obj: THREE.Group; axis: THREE.Vector3; open: number }[] = [];
  const bayDoor = (name: string, hingeBody: [number, number, number], w: number, len: number, side: number, axisBody: [number, number, number], openRad: number) => {
    const p = group(name);
    p.position.copy(bl(...hingeBody));
    const d = new THREE.BoxGeometry(w, 0.014, len);
    d.translate((side * w) / 2, 0, 0);
    mesh(d, paint, name, p);
    doorPivots.push({ obj: p, axis: bl(...axisBody).normalize(), open: openRad });
  };
  bayDoor('nose_door_l', [12.35, -0.3, 1.36], 0.28, 1.25, 1, [1, 0, 0], 85 * D2R);
  bayDoor('nose_door_r', [12.35, 0.3, 1.36], 0.28, 1.25, -1, [1, 0, 0], -85 * D2R);
  bayDoor('main_door_l', [-0.9, -0.05, 1.63], 0.85, 1.4, -1, [1, 0, 0], -80 * D2R);
  bayDoor('main_door_r', [-0.9, 0.05, 1.63], 0.85, 1.4, 1, [1, 0, 0], 80 * D2R);
  mesh(new THREE.BoxGeometry(3.2, 0.36, 1.5), wellMat, 'main_well', body).position.copy(bl(-0.9, 0, 1.44));
  mesh(new THREE.BoxGeometry(0.6, 0.3, 1.3), wellMat, 'nose_well', body).position.copy(bl(12.35, 0, 1.22));

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
  // Position lights at the winglet roots (red left, green right), white on the tail cone (14 CFR 25.1385-1391 layout).
  const navL = lamp(0xff1a1a, [tip.xLe - 0.1, -(TIP_Y + 0.05), tip.z], 0.05, lightsG);
  const navR = lamp(0x19ff4a, [tip.xLe - 0.1, TIP_Y + 0.05, tip.z], 0.05, lightsG);
  const navT = lamp(0xffffff, [TAIL_X + 0.05, 0, -0.83], 0.045, lightsG);
  // Anti-collision: white LED strobes in the wingtips and the tail cone; red beacons on the top and the belly.
  const strobeL = lamp(0xffffff, [tip.xLe - 0.35, -(TIP_Y + 0.06), tip.z], 0.045, lightsG, 22);
  const strobeR = lamp(0xffffff, [tip.xLe - 0.35, TIP_Y + 0.06, tip.z], 0.045, lightsG, 22);
  const strobeT = lamp(0xffffff, [TAIL_X + 0.02, 0, -0.9], 0.045, lightsG, 22);
  const beaconTop = lamp(0xff2200, [3.0, 0, -1.5], 0.06, lightsG, 18);
  const beaconBot = lamp(0xff2200, [-3.2, 0, 1.52], 0.06, lightsG, 18);
  // Landing / recognition: wing-root leading edges (EST, GVI family).
  const ldgL = lamp(0xfff6e8, [4.55, -1.55, 1.1], 0.06, lightsG, 20);
  const ldgR = lamp(0xfff6e8, [4.55, 1.55, 1.1], 0.06, lightsG, 20);
  // Wing inspection lights on the fuselage sides ahead of the wing, logo lights on the stabilizer lighting the fin.
  const wingL = lamp(0xfff2dd, [6.2, -1.33, -0.35], 0.035, lightsG);
  const wingR = lamp(0xfff2dd, [6.2, 1.33, -0.35], 0.035, lightsG);
  const logoL = lamp(0xfff2dd, [-12.0, -1.6, stabZ - 0.06], 0.035, lightsG);
  const logoR = lamp(0xfff2dd, [-12.0, 1.6, stabZ - 0.06], 0.035, lightsG);
  const emerL = lamp(0xfff2dd, [1.2, -1.35, 0.3], 0.03, lightsG);
  const emerR = lamp(0xfff2dd, [1.2, 1.35, 0.3], 0.03, lightsG);
  const spot = (pos: [number, number, number], target: [number, number, number], angle: number, parent: THREE.Object3D) => {
    const s = new THREE.SpotLight(0xfff4e6, 0, 1200, angle * D2R, 0.4, 2);
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    s.castShadow = false;
    parent.add(s, s.target);
    return s;
  };
  const spotL = spot([4.6, -1.55, 1.12], [90, -6, 7], 11, lightsG);
  const spotR = spot([4.6, 1.55, 1.12], [90, 6, 7], 11, lightsG);
  // Taxi light on the nose gear (moves with the strut and the steering).
  const taxiParent = legs[0].steer;
  const taxiLamp = track(new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false }));
  const tl = new THREE.Mesh(track(new THREE.SphereGeometry(0.045, 10, 8)), taxiLamp);
  tl.position.set(0, 0.42, -0.1);
  taxiParent.add(tl);
  const taxiSpot = new THREE.SpotLight(0xfff4e6, 0, 400, 28 * D2R, 0.5, 2);
  taxiSpot.position.set(0, 0.42, -0.12);
  taxiSpot.target.position.set(0, -1.6, -25);
  taxiParent.add(taxiSpot, taxiSpot.target);

  // Wings, nose (cockpit skin + radome), lights: visible from the cockpit windows. Everything else hides in the cockpit view.
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
    taxi: 'light.taxi',
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
  let ratSpin = 0;
  let ratPos = 0;
  let doorPos = 0;
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
    setHinge(movables.flapR, flaps);
    setHinge(movables.flapL, -flaps);
    const ail = v.get(SURF.aileron) * 20 * D2R; // EST +-20 deg aileron travel
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    // Spoilers: 55 deg full scale (ground), speed brakes 30 deg in flight = 30/55 of the scale (SCQ, createSystems.ts).
    const gs = v.get(SURF.groundSpoilers);
    const sb = v.get(SURF.speedbrake);
    const sl = Math.max(v.get(SURF.spoilerLeft), sb, gs) * 55 * D2R;
    const sr = Math.max(v.get(SURF.spoilerRight), sb, gs) * 55 * D2R;
    setHinge(movables.spl1R, -Math.max(gs, sb) * 55 * D2R);
    setHinge(movables.spl1L, Math.max(gs, sb) * 55 * D2R);
    setHinge(movables.spl2R, -sr);
    setHinge(movables.spl3R, -sr);
    setHinge(movables.spl2L, sl);
    setHinge(movables.spl3L, sl);
    const elev = v.get(SURF.elevator) * 20 * D2R; // EST +-20 deg
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 25 * D2R);
    // Stabilizer incidence: trim units -1..1 -> EST -5..+5 deg (nose-up trim = leading edge down).
    stabG.rotation.x = -v.get('trim.pitch_units') * 5 * D2R;
    for (let i = 0; i < 2; i++) {
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 60 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
      // Translating sleeve slides 0.45 m aft (EST).
      sleeves[i].position.z = v.get(revVar[i]) * 0.45;
    }
    // RAT: swings down out of the fairing in ~2 s, turbine speed from the airflow.
    const ratTarget = v.get(V.ratDeployed) !== 0 ? 1 : 0;
    ratPos += Math.max(-dt / 2, Math.min(dt / 2, ratTarget - ratPos));
    ratPivot.rotation.x = (ratPos - 1) * 95 * D2R;
    ratPivot.visible = ratPos > 0.01;
    ratSpin = (ratSpin + ratPos * Math.min(60, v.get('fdm.ias_kt') / 4) * dt) % (2 * Math.PI);
    ratHub.rotation.z = ratSpin;
    // Main door: airstair opens outward and down (~8 s EST), hinge at the sill.
    const doorTarget = v.get('ac.door.main') > 0.5 ? 1 : 0;
    doorPos += Math.max(-dt / 8, Math.min(dt / 8, doorTarget - doorPos));
    doorPivot.rotation.z = doorPos * 100 * D2R;
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
    const ll = Math.max(v.get(L.ldgL), recog);
    const lr = Math.max(v.get(L.ldgR), recog);
    setLamp(ldgL, ll);
    setLamp(ldgR, lr);
    const taxi = v.get(L.taxi);
    taxiLamp.color.setRGB(0.06 + 0.94 * taxi, 0.06 + 0.94 * taxi, 0.06 + 0.9 * taxi);
    const wi = v.get(L.wing);
    setLamp(wingL, wi);
    setLamp(wingR, wi);
    const lg = v.get(L.logo);
    setLamp(logoL, lg);
    setLamp(logoR, lg);
    const em = v.get(L.emer);
    setLamp(emerL, em);
    setLamp(emerR, em);
    // EST: 400,000 cd LED landing lights, 60,000 cd taxi light (bizjet LED fixture class), in scene light units.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    spotL.intensity = ll * 400_000 * k;
    spotR.intensity = lr * 400_000 * k;
    taxiSpot.intensity = taxi * 60_000 * k;
  }
  update(0);

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
