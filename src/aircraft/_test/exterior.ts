/**
 * Procedural exterior of the development test jet, matched to the TEST_JET
 * FDM geometry (wing 15.5 m span / 30.7 m2, gear contact points, aft
 * pylon engines at x = -3.6 m, tail cone contact at x = -7.0 m). All shapes
 * are EST (generic CJ4/Phenom-300-class light jet); nothing here is a
 * specific type.
 *
 * Animated from SimVars in `update(dt)`: gear retraction/compression/steering
 * and wheel spin, flaps, ailerons, spoilers, elevator, rudder, thrust
 * reversers, fan rotation, exterior lights (light.nav / beacon / strobe /
 * landing from LightingSystem).
 *
 * Wings, engines and the nose ahead of the windshield carry
 * `userData.visibleFromCockpit = true` (seen through the windows).
 */
import * as THREE from 'three';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type WingSection } from './loft';

/** Fuselage cross-sections (body x fwd, z down). EST shape; see header. */
export const TEST_FUSELAGE = new FuselageProfile([
  { x: 7.05, cz: 0.3, ry: 0.03, rz: 0.03 },
  { x: 6.8, cz: 0.25, ry: 0.3, rz: 0.27 },
  { x: 6.3, cz: 0.18, ry: 0.52, rz: 0.46 },
  { x: 5.8, cz: 0.1, ry: 0.68, rz: 0.62 },
  { x: 5.45, cz: 0.02, ry: 0.79, rz: 0.72 },
  { x: 5.0, cz: -0.12, ry: 0.88, rz: 0.88 },
  { x: 4.4, cz: -0.22, ry: 0.93, rz: 0.95 },
  { x: 3.0, cz: -0.25, ry: 0.95, rz: 0.97 },
  { x: -1.0, cz: -0.25, ry: 0.95, rz: 0.97 },
  { x: -3.0, cz: -0.25, ry: 0.9, rz: 0.93 },
  { x: -5.0, cz: -0.3, ry: 0.62, rz: 0.66 },
  { x: -6.5, cz: -0.38, ry: 0.32, rz: 0.38 },
  { x: -7.35, cz: -0.45, ry: 0.06, rz: 0.08 },
]);

/** Windshield base station: skin ahead of it is visible from the cockpit. */
export const NOSE_SPLIT_X = 5.45;

const D2R = Math.PI / 180;

/** Wing planform (right side). EST: root chord 2.6 m at the fuselage side, 1.1 m tip, LE sweep ~ 12 deg, 2.8 deg dihedral. */
const WING: WingSection[] = [
  { y: 0.85, xLe: 1.25, chord: 2.65, z: 0.52, t: 0.14, twistDeg: 1.5 },
  { y: 3.0, xLe: 0.8, chord: 2.0, z: 0.42, t: 0.13, twistDeg: 0.5 },
  { y: 7.75, xLe: -0.55, chord: 1.1, z: 0.14, t: 0.11, twistDeg: -1.5 },
];

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = WING;
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

export interface TestExterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export function createTestExterior(vars: SimVars): TestExterior {
  const root = new THREE.Group();
  root.name = 'exterior';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const paint = track(new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide }));
  const stripe = track(new THREE.MeshStandardMaterial({ color: 0x14325c, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide }));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.28, metalness: 0.9 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.3 }));
  const glass = track(new THREE.MeshStandardMaterial({ color: 0x10161f, roughness: 0.05, metalness: 0.6, side: THREE.DoubleSide }));
  const tyre = track(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 }));
  const chrome = track(new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 1 }));
  const fanMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D = root): THREE.Mesh => {
    track(g);
    const me = new THREE.Mesh(g, m);
    me.name = name;
    me.castShadow = true;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };

  // ---------------------------------------------------------------- fuselage
  const body = new THREE.Group();
  body.name = 'fuselage';
  root.add(body);
  mesh(loftFuselage(TEST_FUSELAGE, -7.35, NOSE_SPLIT_X, 0, 2 * Math.PI, 90, 48), paint, 'cabin', body);
  const nose = new THREE.Group();
  nose.name = 'nose';
  nose.userData.visibleFromCockpit = true;
  root.add(nose);
  mesh(loftFuselage(TEST_FUSELAGE, NOSE_SPLIT_X, 7.05, 0, 2 * Math.PI, 24, 48), paint, 'nose', nose);
  // Cheat line stripe along the cabin sides.
  mesh(loftFuselage(TEST_FUSELAGE, -5.2, 5.2, 1.62, 1.72, 60, 2, { inset: -0.004 }), stripe, 'stripe_r', body);
  mesh(loftFuselage(TEST_FUSELAGE, -5.2, 5.2, -1.72, -1.62, 60, 2, { inset: -0.004 }), stripe, 'stripe_l', body);
  // Windshield and side cockpit windows (dark glass skins slightly outside the structure).
  mesh(loftFuselage(TEST_FUSELAGE, 4.98, 5.44, -1.2, 1.2, 8, 24, { inset: -0.006 }), glass, 'windshield', body);
  mesh(loftFuselage(TEST_FUSELAGE, 3.95, 4.95, 0.66, 1.36, 10, 6, { inset: -0.006 }), glass, 'side_window_r', body);
  mesh(loftFuselage(TEST_FUSELAGE, 3.95, 4.95, -1.36, -0.66, 10, 6, { inset: -0.006 }), glass, 'side_window_l', body);
  // Cabin windows: 5 per side, oval (instanced).
  const winGeo = track(new THREE.SphereGeometry(0.17, 16, 8));
  winGeo.scale(0.02, 1, 0.8);
  const wins = new THREE.InstancedMesh(winGeo, glass, 10);
  wins.name = 'cabin_windows';
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < 5; i++) {
    const x = 2.8 - i * 0.95;
    for (const side of [1, -1]) {
      TEST_FUSELAGE.point(x, side * 1.42, -0.002, p);
      m4.makeTranslation(p.x, p.y, p.z);
      wins.setMatrixAt(k++, m4);
    }
  }
  body.add(wins);

  // ---------------------------------------------------------------- wings (with movable surfaces)
  const wings = new THREE.Group();
  wings.name = 'wings';
  wings.userData.visibleFromCockpit = true;
  root.add(wings);
  const movables: Record<string, Movable[]> = { flapL: [], flapR: [], ailL: [], ailR: [], splL: [], splR: [], elevL: [], elevR: [], rudder: [] };
  const hinge = (name: keyof typeof movables, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D) => {
    const pivot = new THREE.Group();
    pivot.position.copy(bl(...pivotBody));
    parent.add(pivot);
    g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    mesh(g, m, name, pivot);
    const axis = bl(...axisBody).normalize();
    movables[name].push({ obj: pivot, axis, base: pivot.quaternion.clone() });
  };
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    // Fixed wing box: 0..75 % chord over the flap/aileron span, full chord elsewhere.
    mesh(loftWing(WING, { mirror, chordRange: [0, 0.75] }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    // Flap: 1.0 .. 4.6 m, aft 25 % chord.
    const flapSecs = [1.0, 4.6].map((y) => ({ y, ...wingAt(y), t: 0.13 }));
    const f0 = flapSecs[0];
    hinge(mirror ? 'flapL' : 'flapR', loftWing(flapSecs, { mirror, chordRange: [0.75, 1] }), [f0.xLe - 0.75 * f0.chord, sgn * 2.8, f0.z], [flapSecs[1].xLe - flapSecs[0].xLe - 0.75 * (flapSecs[1].chord - flapSecs[0].chord), sgn * 3.6, flapSecs[1].z - flapSecs[0].z], paint, wings);
    // Aileron: 4.7 .. 7.2 m.
    const ailSecs = [4.7, 7.2].map((y) => ({ y, ...wingAt(y), t: 0.12 }));
    const a0 = ailSecs[0];
    hinge(mirror ? 'ailL' : 'ailR', loftWing(ailSecs, { mirror, chordRange: [0.75, 1] }), [a0.xLe - 0.75 * a0.chord, sgn * 5.9, a0.z], [ailSecs[1].xLe - ailSecs[0].xLe - 0.75 * (ailSecs[1].chord - ailSecs[0].chord), sgn * 2.5, ailSecs[1].z - ailSecs[0].z], paint, wings);
    // Close the trailing-edge gaps outside the movables: root stub and tip.
    mesh(loftWing([{ y: 0.85, ...wingAt(0.85), t: 0.14 }, { y: 1.0, ...wingAt(1.0), t: 0.14 }], { mirror, chordRange: [0.75, 1] }), paint, 'te_root', wings);
    mesh(loftWing([{ y: 4.6, ...wingAt(4.6), t: 0.12 }, { y: 4.7, ...wingAt(4.7), t: 0.12 }], { mirror, chordRange: [0.75, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([{ y: 7.2, ...wingAt(7.2), t: 0.11 }, { y: 7.75, ...wingAt(7.75), t: 0.11 }], { mirror, chordRange: [0.75, 1] }), paint, 'te_tip', wings);
    // Spoiler panel on the upper surface ahead of the flap (hinged at its leading edge).
    const sy0 = 2.0;
    const sy1 = 4.2;
    const w0 = wingAt(sy0);
    const w1 = wingAt(sy1);
    const spl = new THREE.BufferGeometry();
    const P = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z - 0.055 * w.chord * (1 - f));
    const v = [P(sy0, w0, 0.52), P(sy1, w1, 0.52), P(sy1, w1, 0.72), P(sy0, w0, 0.72)];
    spl.setFromPoints([v[0], v[1], v[2], v[0], v[2], v[3]]);
    spl.computeVertexNormals();
    hinge(mirror ? 'splL' : 'splR', spl, [w0.xLe - 0.52 * w0.chord, sgn * sy0, w0.z - 0.03], [w1.xLe - w0.xLe - 0.52 * (w1.chord - w0.chord), sgn * (sy1 - sy0), w1.z - w0.z], stripe, wings);
  }

  // ---------------------------------------------------------------- T-tail
  const fin: WingSection[] = [
    { y: 0, xLe: -4.9, chord: 2.3, z: -0.95, t: 0.12 },
    { y: 2.1, xLe: -6.35, chord: 1.35, z: -0.95, t: 0.11 },
  ];
  mesh(loftWing(fin, { vertical: true, chordRange: [0, 0.72] }), paint, 'fin', root);
  hinge('rudder', loftWing(fin, { vertical: true, chordRange: [0.72, 1] }), [-4.9 - 0.72 * 2.3, 0, -0.95], [(-6.35 - 0.72 * 1.35) - (-4.9 - 0.72 * 2.3), 0, -2.1], paint, root);
  const stabZ = -3.05;
  const stab: WingSection[] = [
    { y: 0, xLe: -6.2, chord: 1.4, z: stabZ, t: 0.1 },
    { y: 2.9, xLe: -6.95, chord: 0.75, z: stabZ - 0.05, t: 0.09 },
  ];
  for (const mirror of [false, true]) {
    mesh(loftWing(stab, { mirror, chordRange: [0, 0.7] }), paint, 'stab', root);
    hinge(mirror ? 'elevL' : 'elevR', loftWing(stab, { mirror, chordRange: [0.7, 1] }), [-6.2 - 0.7 * 1.4, 0, stabZ], [0, mirror ? -1 : 1, 0], paint, root);
  }

  // ---------------------------------------------------------------- engines (aft pylons)
  const engines = new THREE.Group();
  engines.name = 'engines';
  engines.userData.visibleFromCockpit = true;
  root.add(engines);
  const fans: THREE.Object3D[] = [];
  const reversers: THREE.Object3D[][] = [];
  const nacLen = 2.7;
  const nacR = 0.5;
  for (const y of [-1.5, 1.5]) {
    const g = new THREE.Group();
    g.position.copy(bl(-3.6, y, -0.7));
    engines.add(g);
    // Nacelle: lathe profile along body x (-x aft), rotated so the lathe axis is body x.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20; // 0 inlet .. 1 exhaust
      const r = nacR * (0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.6))) * (t > 0.8 ? 1 - (t - 0.8) * 0.9 : 1);
      prof.push(new THREE.Vector2(r, nacLen * 0.45 - t * nacLen));
    }
    const nac = new THREE.LatheGeometry(prof, 40);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(nacR * 0.86, 0.035, 10, 40);
    mesh(lip, metal, 'inlet_lip', g).position.copy(bl(nacLen * 0.45, 0, 0));
    // Fan disc with spinner, rotates with N1.
    const fan = new THREE.Group();
    fan.position.copy(bl(nacLen * 0.38, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(nacR * 0.84, 32), fanMat, 'fan_disc', fan);
    const blades = new THREE.BoxGeometry(0.035, nacR * 1.6, 0.012);
    for (let b = 0; b < 11; b++) {
      const bm = mesh(blades.clone(), metal, 'blade', fan);
      bm.position.z = -0.01;
      bm.rotation.z = (b / 11) * Math.PI;
      bm.rotation.y = 0.5;
    }
    blades.dispose();
    const spinner = new THREE.ConeGeometry(0.13, 0.3, 20);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, chrome, 'spinner', fan).position.z = -0.15;
    fans.push(fan);
    // Exhaust cone.
    const ex = new THREE.ConeGeometry(0.22, 0.5, 20);
    ex.rotateX(Math.PI / 2);
    mesh(ex, dark, 'exhaust', g).position.copy(bl(-nacLen * 0.55 - 0.1, 0, 0));
    // Target-type reverser doors (upper/lower), hinged at the nozzle exit rim; deployed they close behind the nozzle.
    const buckets: THREE.Object3D[] = [];
    for (const s of [1, -1]) {
      const piv = new THREE.Group();
      piv.position.copy(bl(-nacLen * 0.55, 0, -s * nacR * 0.78));
      g.add(piv);
      const door = new THREE.BoxGeometry(nacR * 1.5, 0.035, 0.5);
      door.translate(0, 0, 0.25);
      mesh(door, metal, 'reverser', piv);
      buckets.push(piv);
    }
    reversers.push(buckets);
    // Pylon to the fuselage side.
    const pyl = new THREE.BoxGeometry(Math.abs(y) - 0.75, 0.12, 1.4);
    const pm = mesh(pyl, paint, 'pylon', engines);
    pm.position.copy(bl(-3.5, y * 0.63, -0.7));
  }

  // ---------------------------------------------------------------- landing gear
  interface GearLeg {
    index: number;
    pivot: THREE.Group; // retraction rotation
    strut: THREE.Group; // compression (slides along the strut)
    steer: THREE.Group;
    wheels: THREE.Object3D[];
    travel: number;
    retractAxis: THREE.Vector3;
    retractAngle: number;
    radius: number;
  }
  const legs: GearLeg[] = [];
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, twin: boolean, retractAxis: [number, number, number], retractAngle: number) => {
    const pivot = new THREE.Group();
    pivot.position.copy(bl(contact[0], contact[1], pivotZ));
    root.add(pivot);
    const strut = new THREE.Group();
    pivot.add(strut);
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(0.05, 0.05, len, 12);
    const om = mesh(oleo, chrome, 'strut', strut);
    om.position.y = -len / 2;
    const steer = new THREE.Group();
    steer.position.y = -len;
    strut.add(steer);
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.72, radius * 0.28, 14, 28);
    tg.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 0.9, 18);
    hub.rotateZ(Math.PI / 2);
    for (const off of twin ? [-width * 0.65, width * 0.65] : [0]) {
      const w = new THREE.Group();
      w.position.x = off;
      steer.add(w);
      mesh(tg.clone(), tyre, 'tyre', w);
      mesh(hub.clone(), metal, 'hub', w);
      wheels.push(w);
    }
    tg.dispose();
    hub.dispose();
    legs.push({ index, pivot, strut, steer, wheels, travel, retractAxis: bl(...retractAxis).normalize(), retractAngle, radius });
  };
  // Nose gear retracts forward, mains retract inboard into the wing root/fuselage (EST).
  makeLeg(0, [5.0, 0, 1.55], 0.45, 0.22, 0.14, 0.25, true, [0, 1, 0], 95 * D2R);
  makeLeg(1, [-0.6, -1.9, 1.55], 0.5, 0.33, 0.2, 0.28, false, [1, 0, 0], -88 * D2R);
  makeLeg(2, [-0.6, 1.9, 1.55], 0.5, 0.33, 0.2, 0.28, false, [1, 0, 0], 88 * D2R);

  // ---------------------------------------------------------------- lights
  const lamp = (color: number, pos: [number, number, number], size = 0.06, parent: THREE.Object3D = root) => {
    const m = track(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const me = mesh(new THREE.SphereGeometry(size, 10, 8), m, 'lamp', parent);
    me.castShadow = false;
    me.position.copy(bl(...pos));
    const halo = track(new THREE.SpriteMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const sp = new THREE.Sprite(halo);
    sp.scale.setScalar(size * 14);
    sp.position.copy(me.position);
    parent.add(sp);
    return { m, halo, color: new THREE.Color(color) };
  };
  const navR = lamp(0x00ff40, [-1.75, 7.78, 0.13], 0.06, wings);
  const navL = lamp(0xff1010, [-1.75, -7.78, 0.13], 0.06, wings);
  const navT = lamp(0xffffff, [-7.35, 0, -0.45], 0.05);
  const strobeR = lamp(0xffffff, [-1.9, 7.8, 0.12], 0.05, wings);
  const strobeL = lamp(0xffffff, [-1.9, -7.8, 0.12], 0.05, wings);
  const beaconTop = lamp(0xff2000, [-6.6, 0, -3.1], 0.07);
  const beaconBot = lamp(0xff2000, [1.0, 0, 0.74], 0.07);
  const landing = new THREE.SpotLight(0xfff4e0, 0, 900, 12 * D2R, 0.35, 1.6);
  landing.position.copy(bl(5.2, 0, 0.9));
  landing.target.position.copy(bl(60, 0, 3.5));
  // The landing light must keep lighting the runway in the cockpit view.
  const landingGroup = new THREE.Group();
  landingGroup.name = 'landing_light';
  landingGroup.userData.visibleFromCockpit = true;
  landingGroup.add(landing, landing.target);
  root.add(landingGroup);
  const landingLamp = lamp(0xfff4e0, [5.25, 0, 0.92], 0.06);

  // Wings, engines, nose: visible from the cockpit. Everything else hides with the cabin group in cockpit view.
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
  const setLamp = (l: ReturnType<typeof lamp>, level: number) => {
    const x = Math.max(0, Math.min(1, level));
    l.m.color.copy(l.color).multiplyScalar(0.08 + 0.92 * x);
    l.halo.opacity = x;
  };

  function update(dt: number): void {
    const v = vars;
    for (const leg of legs) {
      const pos = v.get(posVar[leg.index], 1);
      leg.pivot.quaternion.setFromAxisAngle(leg.retractAxis, (1 - pos) * leg.retractAngle);
      leg.strut.position.y = v.get(compVar[leg.index]) * leg.travel;
      if (leg.index === 0) leg.steer.rotation.y = -v.get(GEAR.steerDeg) * D2R;
      const w = (v.get(speedVar[leg.index]) * 0.514444) / leg.radius;
      wheelAngle[leg.index] = (wheelAngle[leg.index] - w * dt) % (2 * Math.PI);
      for (const wh of leg.wheels) wh.rotation.x = wheelAngle[leg.index];
      leg.pivot.visible = pos > 0.02;
    }
    const flaps = v.get(SURF.flapsDeg) * D2R;
    // Hinge axes run root -> tip (right side +x local, left side -x): signs below give TE-down flaps,
    // right-aileron-up for right roll, spoilers up, elevator TE-up for nose-up, rudder TE-left for right yaw.
    setHinge(movables.flapR, flaps);
    setHinge(movables.flapL, -flaps);
    const ail = v.get(SURF.aileron) * 18 * D2R; // EST +-18 deg aileron travel
    setHinge(movables.ailR, -ail);
    setHinge(movables.ailL, -ail);
    setHinge(movables.splR, -v.get(SURF.spoilerRight) * 45 * D2R);
    setHinge(movables.splL, v.get(SURF.spoilerLeft) * 45 * D2R);
    const elev = v.get(SURF.elevator) * 16 * D2R; // EST +-16 deg
    setHinge(movables.elevR, -elev);
    setHinge(movables.elevL, elev);
    setHinge(movables.rudder, -v.get(SURF.rudder) * 25 * D2R);
    for (let i = 0; i < 2; i++) {
      // Visual fan speed: N1 fraction x 60 rev/s cap (a strobing real rate would alias on screen).
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 60 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
      const r = v.get(revVar[i]);
      // Upper door (index 0) swings down behind the nozzle, lower door up. EST 60 deg travel.
      reversers[i][0].rotation.x = r * 60 * D2R;
      reversers[i][1].rotation.x = -r * 60 * D2R;
    }
    const nav = v.get('light.nav');
    setLamp(navR, nav);
    setLamp(navL, nav);
    setLamp(navT, nav);
    const st = v.get('light.strobe');
    setLamp(strobeR, st);
    setLamp(strobeL, st);
    const bc = v.get('light.beacon');
    setLamp(beaconTop, bc);
    setLamp(beaconBot, bc);
    const ll = v.get('light.landing');
    setLamp(landingLamp, ll);
    // EST: ~ 600,000 cd class LED landing light; three.js SpotLight intensity in candela.
    landing.intensity = ll * 600_000 * 0.05;
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
