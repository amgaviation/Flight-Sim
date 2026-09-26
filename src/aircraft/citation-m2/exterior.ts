/**
 * Procedural exterior of the Cessna Citation M2 (Model 525), livery-neutral
 * white with subtle panel lines.
 *
 * Geometry (body axes: x forward, y right, z down, metres from the FDM datum
 * = empty CG at FS 250.0, x = (250 - FS) * 0.0254; see fdm.ts):
 *  - S&D15 §1.2 / FPG: length 42 ft 7 in (12.98 m), height 13 ft 11 in
 *    (4.24 m), span 47 ft 0 in (14.33 m) without / 47 ft 3 in with tip
 *    lights, wing area 240 ft^2, 0 deg sweep at 35 % chord, 5 deg dihedral;
 *    horizontal tail span 18 ft 8 in (5.70 m), 60.7 ft^2, 0 deg sweep at
 *    70 % chord (T-tail); vertical tail 6 ft 5 in (1.96 m) high, 46.8 ft^2,
 *    49 deg sweep at 25 % chord; tread 13 ft 0 in, wheelbase 15 ft 4 in;
 *    tyres: nose 18 x 4.4, mains 22 x 7.75R10.
 *  - TCDS §14: MAC 69.077 in, leading edge FS 228.745 (x = 0.539 m).
 *  - Engines (fdm.ts): FJ44-1AP-21 nacelles on aft-fuselage pylons, centre
 *    FS 320 (x = -1.78 m), y = +-1.32 m, z = -0.35 m (EST).
 *  - Gear contact points and the ~13 deg tail-strike attitude from fdm.ts.
 * Everything else (section shapes, nose and tail-cone lines, window shapes,
 * nacelle profile, light positions) is EST from the S&D three-view and
 * photographs, marked where it matters.
 *
 * `M2_FUSELAGE` (outer skin) and the window / windshield angular limits are
 * shared with the cockpit shell (cockpit/shell.ts) so the inside lines up
 * with the outside.
 *
 * Animated from SimVars in `update(dt)`: gear retraction (gear.pos*), strut
 * compression, nose-wheel steering, wheel spin, doors; flaps, ailerons,
 * elevators, rudder, trim tabs, upper/lower speed brakes (surf.*); fan
 * rotation (N1); cabin airstair door (ac.m2.door_cabin); exterior lights
 * (light.nav / beacon / strobe / landing_l / landing_r / recognition / taxi /
 * logo / wing from the M2 LightingSystem) with real candela through the
 * world's photometric scale.
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftWing, type FuselageStation, type WingSection } from '../_test/loft';
import { M2 } from './vars';

const D2R = Math.PI / 180;

// ============================================================================ fuselage profile

/** Outer-skin stations: body x, top z, bottom z, half-width (m). EST from the S&D side / top views (see header). */
const STATIONS: [x: number, top: number, bot: number, ry: number, n: number][] = [
  [5.62, 0.27, 0.29, 0.012, 2], // nose (radome) tip; length 12.98 m -> tail end x = -7.36
  [5.5, 0.14, 0.46, 0.17, 2.1],
  [5.3, 0.03, 0.58, 0.32, 2.2],
  [5.0, -0.08, 0.68, 0.5, 2.35],
  [4.5, -0.17, 0.77, 0.67, 2.6],
  [3.92, -0.255, 0.82, 0.785, 2.8], // windshield base (glareshield front, FS ~96)
  [3.55, -0.49, 0.84, 0.815, 2.65],
  [3.2, -0.705, 0.84, 0.83, 2.4], // windshield top edge ~FS 121 (x 3.28)
  [2.7, -0.81, 0.84, 0.835, 2.2],
  [-1.3, -0.81, 0.84, 0.835, 2.2], // constant cabin section (58 in inside width, S&D15 §1.2)
  [-2.4, -0.78, 0.78, 0.8, 2.15],
  [-3.4, -0.72, 0.64, 0.7, 2.1], // tail cone; engines hang on pylons here
  [-4.6, -0.63, 0.43, 0.54, 2.05],
  [-5.8, -0.56, 0.16, 0.35, 2],
  [-6.8, -0.52, -0.16, 0.16, 2],
  [-7.3, -0.48, -0.36, 0.035, 2],
];

/** Monotone cubic (Fritsch-Carlson) interpolation through (xs ascending, ys). */
class Pchip {
  private readonly m: number[];
  constructor(
    private readonly xs: number[],
    private readonly ys: number[],
  ) {
    const n = xs.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    const m = new Array<number>(n).fill(0);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
        const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    this.m = m;
  }
  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * this.ys[i] + (t3 - 2 * t2 + t) * h * this.m[i] + (-2 * t3 + 3 * t2) * this.ys[i + 1] + (t3 - t2) * h * this.m[i + 1];
  }
}

/**
 * Fuselage profile with smooth (monotone cubic) interpolation of the top / bottom lines and
 * half-width, and super-elliptic sections (|y/ry|^n + |(z-cz)/rz|^n = 1; n = 2 is an ellipse,
 * larger n is boxier, as the flat-sided Citation nose and cockpit).
 */
export class M2FuselageProfile extends FuselageProfile {
  private readonly top: Pchip;
  private readonly bot: Pchip;
  private readonly ry: Pchip;
  private readonly n: Pchip;
  private readonly tmp: FuselageStation = { x: 0, cz: 0, ry: 0, rz: 0 };
  constructor(st: [number, number, number, number, number][]) {
    super(st.map(([x, t, b, ry]) => ({ x, cz: (t + b) / 2, rz: (b - t) / 2, ry })));
    const asc = [...st].sort((a, b) => a[0] - b[0]);
    const xs = asc.map((s) => s[0]);
    this.top = new Pchip(xs, asc.map((s) => s[1]));
    this.bot = new Pchip(xs, asc.map((s) => s[2]));
    this.ry = new Pchip(xs, asc.map((s) => s[3]));
    this.n = new Pchip(xs, asc.map((s) => s[4]));
  }
  override at(x: number, out: FuselageStation = { x: 0, cz: 0, ry: 0, rz: 0 }): FuselageStation {
    const t = this.top.at(x);
    const b = this.bot.at(x);
    out.x = x;
    out.cz = (t + b) / 2;
    out.rz = Math.max(0.002, (b - t) / 2);
    out.ry = Math.max(0.002, this.ry.at(x));
    return out;
  }
  /** Section exponent at station x. */
  exponent(x: number): number {
    return this.n.at(x);
  }
  /** Top-of-skin z at station x. */
  topZ(x: number): number {
    return this.top.at(x);
  }
  override point(x: number, theta: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.at(x, this.tmp);
    const e = 2 / this.n.at(x);
    const ry = Math.max(0.001, s.ry - inset);
    const rz = Math.max(0.001, s.rz - inset);
    const sn = Math.sin(theta);
    const cs = Math.cos(theta);
    const by = ry * Math.sign(sn) * Math.pow(Math.abs(sn), e);
    const bz = s.cz - rz * Math.sign(cs) * Math.pow(Math.abs(cs), e);
    return out.set(by, -bz, -x);
  }
  /** Inner half-width (m) of the section at station x and height z (body), for a skin inset. */
  halfWidth(x: number, z: number, inset = 0): number {
    const s = this.at(x, this.tmp);
    const n = this.n.at(x);
    const c = Math.abs((z - s.cz) / Math.max(0.001, s.rz - inset));
    if (c >= 1) return 0;
    return Math.max(0, s.ry - inset) * Math.pow(1 - Math.pow(c, n), 1 / n);
  }
}

export const M2_FUSELAGE = new M2FuselageProfile(STATIONS);

/** Nose tip and tail-cone end stations. */
export const NOSE_X = 5.62;
export const TAIL_X = -7.3;
/** Windshield: base (glareshield front) station, top (aft) edge station, lower-edge height, max half-angle. */
export const WS_BASE_X = 3.92;
export const WS_TOP_X = 3.28;
export const WS_LOWER_Z = -0.25;
export const WS_MAX_T = 0.95;
/** Cockpit side windows: aft / forward stations and angular limits (rad from the top). */
export const SIDE_WIN_AFT_X = 2.62;
export const SIDE_WIN_FWD_X = 3.2;
export const SIDE_WIN_TOP_T = 0.5;
export const SIDE_WIN_SILL_T = 1.38;

const tmpSt: FuselageStation = { x: 0, cz: 0, ry: 0, rz: 0 };

/** Windshield half-angle at station x: the glass reaches down to WS_LOWER_Z, at most WS_MAX_T (inset: skin inset used). */
export function windshieldHalfAngle(x: number, inset = 0): number {
  const s = M2_FUSELAGE.at(x, tmpSt);
  const rz = Math.max(0.01, s.rz - inset);
  const c = (s.cz - WS_LOWER_Z) / rz;
  if (c >= 1) return 0;
  // Super-ellipse parameter: z = cz - rz * cos(t)^(2/n)  ->  cos(t) = c^(n/2).
  const cn = Math.sign(c) * Math.pow(Math.abs(c), M2_FUSELAGE.exponent(x) / 2);
  return Math.min(WS_MAX_T, Math.acos(Math.max(-1, cn)));
}

/**
 * Skin between body x0 (aft) and x1 (fwd) over a per-station angular range
 * `range(x)` = [theta0, theta1] (rad, 0 = top, + toward the right side).
 * `inward` flips the winding (surfaces seen from inside the cockpit).
 */
export function loftSkin(p: FuselageProfile, x0: number, x1: number, range: (x: number) => [number, number], segX: number, segT: number, opts: { inset?: number; inward?: boolean } = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= segX; i++) {
    const x = x0 + ((x1 - x0) * i) / segX;
    const [t0, t1] = range(x);
    for (let j = 0; j <= segT; j++) {
      const th = t0 + ((t1 - t0) * j) / segT;
      p.point(x, th, opts.inset ?? 0, v);
      pos.push(v.x, v.y, v.z);
      uv.push(x, th);
    }
  }
  const row = segT + 1;
  for (let i = 0; i < segX; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * row + j;
      const b = a + row;
      if (opts.inward) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Constant angular range helper. */
export const fixedRange =
  (a: number, b: number) =>
  (): [number, number] => [a, b];

// ============================================================================ wing / tail planforms

/** Wing chord plane below the fuselage centre line at the root (fdm.ts WING_Z). */
const WING_Z = 0.55;
const DIHEDRAL = 5 * D2R; // S&D15 §5
/** 35 % chord line station (0 deg sweep at 35 % chord, S&D15): the MAC's 35 % point, x = 0.539 - 0.35 * 1.755. */
const X35 = 0.539 - 0.35 * 1.7546;
/**
 * Wing sections (right side). EST planform matching 22.3 m^2 and MAC 1.755 m: straight tapered
 * outer panel with a trailing-edge extension (yehudi) inboard of y = 2.4 m; tip without winglet.
 */
function wingSec(y: number, chord: number, t: number, twistDeg = 0): WingSection {
  return { y, xLe: X35 + 0.35 * chord, chord, z: WING_Z - y * Math.tan(DIHEDRAL), t, twistDeg };
}
const WING: WingSection[] = [wingSec(0.55, 2.3, 0.15, 2), wingSec(2.4, 1.72, 0.14, 1), wingSec(7.05, 0.8, 0.12, -1.5)];
const SEMI_SPAN = 7.17; // 47 ft 0 in / 2 plus tip cap

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = WING;
  let i = 0;
  while (i < s.length - 2 && y > s[i + 1].y) i++;
  const a = s[i];
  const b = s[i + 1];
  const t = Math.max(0, Math.min(1.2, (y - a.y) / (b.y - a.y)));
  return { xLe: a.xLe + (b.xLe - a.xLe) * t, chord: a.chord + (b.chord - a.chord) * t, z: a.z + (b.z - a.z) * t };
}

/** Vertical tail (EST from the S&D numbers above): root on the tail cone, 49 deg sweep at 25 % chord. */
const FIN_ROOT_Z = -0.55;
const FIN_H = 2.2;
const FIN_TIP_CHORD = 1.3;
const FIN_TIP_LE = -6.0;
const FIN_ROOT_CHORD = 2.6;
const FIN_ROOT_LE = FIN_TIP_LE + 0.25 * FIN_TIP_CHORD + FIN_H * Math.tan(49 * D2R) - 0.25 * FIN_ROOT_CHORD;
/** Horizontal tail on top of the fin: root chord 1.3 m, tip 0.68 m (5.64 m^2 over 5.70 m), 0 deg sweep at 70 % chord. */
const STAB_Z = FIN_ROOT_Z - FIN_H + 0.04;
const STAB_X70 = -7.3 + 0.3 * 1.3;

// ============================================================================ exterior builder

interface Movable {
  obj: THREE.Object3D;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
}

export interface M2Exterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export function createM2Exterior(vars: SimVars): M2Exterior {
  const root = new THREE.Group();
  root.name = 'exterior:citation-m2';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const std = (color: number, roughness: number, metalness: number, side: THREE.Side = THREE.FrontSide) => track(new THREE.MeshStandardMaterial({ color, roughness, metalness, side }));
  const paint = std(0xf3f4f5, 0.3, 0.06, THREE.DoubleSide);
  const seam = std(0xc9ccd0, 0.45, 0.05, THREE.DoubleSide);
  const metal = std(0xb9bdc3, 0.3, 0.85);
  const dark = std(0x1c1e21, 0.55, 0.3);
  const glass = std(0x0e141c, 0.06, 0.7, THREE.DoubleSide);
  const tyre = std(0x141414, 0.92, 0);
  const chrome = std(0xdadada, 0.14, 1);
  const wellMat = std(0x8d9196, 0.7, 0.2, THREE.DoubleSide);
  const deice = std(0x2a2b2d, 0.8, 0.05, THREE.DoubleSide); // stabilizer boots (black rubber)
  const leSteel = std(0xc6c9cd, 0.25, 0.8, THREE.DoubleSide); // bleed-heated wing leading edges

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D = root): THREE.Mesh => {
    track(g);
    const me = new THREE.Mesh(g, m);
    me.name = name;
    me.castShadow = true;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };
  const P = M2_FUSELAGE;
  const TWO_PI = 2 * Math.PI;

  // ---------------------------------------------------------------- fuselage
  const body = new THREE.Group();
  body.name = 'fuselage';
  root.add(body);
  // Cabin and tail cone (aft of the windshield top), full circle.
  mesh(loftSkin(P, TAIL_X, WS_TOP_X, fixedRange(0, TWO_PI), 120, 56), paint, 'cabin', body);
  mesh(loftSkin(P, TAIL_X - 0.04, TAIL_X + 0.001, fixedRange(0, TWO_PI), 1, 24), dark, 'tail_cone_cap', body);
  // Windshield (two-piece, centre post) and the nose skin around it: visible from the cockpit.
  const nose = new THREE.Group();
  nose.name = 'nose';
  nose.userData.visibleFromCockpit = true;
  root.add(nose);
  mesh(
    loftSkin(P, WS_TOP_X, WS_BASE_X, (x) => {
      const t = windshieldHalfAngle(x);
      return [t, TWO_PI - t];
    }, 24, 48),
    paint,
    'nose_sides',
    nose,
  );
  mesh(loftSkin(P, WS_BASE_X, NOSE_X, fixedRange(0, TWO_PI), 40, 48), paint, 'nose', nose);
  mesh(
    loftSkin(P, WS_TOP_X, WS_BASE_X, (x) => {
      const t = windshieldHalfAngle(x);
      return [-t, t];
    }, 16, 24, { inset: -0.004 }),
    glass,
    'windshield',
    body,
  );
  mesh(loftSkin(P, WS_TOP_X, WS_BASE_X - 0.02, fixedRange(-0.016, 0.016), 12, 2, { inset: -0.007 }), dark, 'windshield_post', body);
  // Radome seam (ahead of the nose baggage doors) and nose baggage door outlines (EST positions).
  mesh(loftSkin(P, 4.99, 5.01, fixedRange(0, TWO_PI), 1, 48, { inset: -0.002 }), seam, 'radome_seam', nose);
  for (const s of [1, -1]) {
    mesh(loftSkin(P, 4.05, 4.07, fixedRange(s * 0.55, s * 1.75), 1, 10, { inset: -0.002 }), seam, 'nose_bag_seam_aft', nose);
    mesh(loftSkin(P, 4.84, 4.86, fixedRange(s * 0.55, s * 1.75), 1, 10, { inset: -0.002 }), seam, 'nose_bag_seam_fwd', nose);
  }
  // Cockpit side windows.
  for (const s of [1, -1]) {
    const [a, b] = s > 0 ? [SIDE_WIN_TOP_T, SIDE_WIN_SILL_T] : [-SIDE_WIN_SILL_T, -SIDE_WIN_TOP_T];
    mesh(loftSkin(P, SIDE_WIN_AFT_X, SIDE_WIN_FWD_X, fixedRange(a, b), 8, 6, { inset: -0.004 }), glass, s > 0 ? 'side_window_r' : 'side_window_l', body);
  }
  // Cabin windows (EST: CJ-family large ovals, 3 left aft of the airstair door, 4 right incl. the emergency exit).
  const winGeo = track(new THREE.SphereGeometry(0.5, 20, 10));
  winGeo.scale(1, 1, 0.02);
  const winPts: [number, number][] = [
    [1.55, -1],
    [0.8, -1],
    [0.05, -1],
    [2.35, 1],
    [1.55, 1],
    [0.8, 1],
    [0.05, 1],
  ];
  const wins = new THREE.InstancedMesh(winGeo, glass, winPts.length);
  wins.name = 'cabin_windows';
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pnt = new THREE.Vector3();
    const n = new THREE.Vector3();
    const sc = new THREE.Vector3(0.36, 0.46, 1); // EST ~14 x 18 in window
    winPts.forEach(([x, s], k) => {
      const th = s * 1.42;
      P.point(x, th, -0.003, pnt);
      n.set(s, 0.12, 0).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      m4.compose(pnt, q, sc);
      wins.setMatrixAt(k, m4);
    });
  }
  body.add(wins);
  // Emergency exit outline (right, over the wing) and tail-cone baggage door (left, under the pylon).
  mesh(loftSkin(P, 0.52, 0.54, fixedRange(1.05, 1.85), 1, 8, { inset: -0.002 }), seam, 'emer_exit_seam', body);
  mesh(loftSkin(P, 0.52 - 0.62, 0.54 - 0.62, fixedRange(1.05, 1.85), 1, 8, { inset: -0.002 }), seam, 'emer_exit_seam', body);
  mesh(loftSkin(P, -2.6, -2.58, fixedRange(-2.3, -1.6), 1, 6, { inset: -0.002 }), seam, 'tail_bag_seam', body);
  mesh(loftSkin(P, -3.26, -3.24, fixedRange(-2.3, -1.6), 1, 6, { inset: -0.002 }), seam, 'tail_bag_seam', body);
  // Pressure bulkhead / fuselage splice lines.
  for (const x of [2.35, -0.84, -2.1]) mesh(loftSkin(P, x - 0.008, x + 0.008, fixedRange(0, TWO_PI), 1, 48, { inset: -0.0015 }), seam, 'splice', body);
  // Wing-to-body fairing (belly).
  {
    const g = new THREE.SphereGeometry(1, 32, 12, 0, TWO_PI, Math.PI / 2, Math.PI / 2);
    g.scale(0.78, 0.26, 2.2);
    const fm = mesh(g, paint, 'wing_fairing', body);
    fm.position.copy(bl(-0.35, 0, 0.62));
  }

  // Airstair door (LH forward, S&D: "single airstair door"), hinged at its lower edge: opens outward and down.
  const door = new THREE.Group();
  door.name = 'cabin_door';
  {
    const x0 = 1.95;
    const x1 = 2.55;
    const th0 = -2.05;
    const th1 = -0.62;
    const hingePt = P.point((x0 + x1) / 2, th0, 0, new THREE.Vector3());
    door.position.copy(hingePt);
    body.add(door);
    const g = loftSkin(P, x0, x1, fixedRange(th0, th1), 6, 12, { inset: -0.003 });
    g.translate(-hingePt.x, -hingePt.y, -hingePt.z);
    mesh(g, paint, 'door_panel', door);
    const inner = loftSkin(P, x0 + 0.02, x1 - 0.02, fixedRange(th0 + 0.03, th1 - 0.03), 4, 8, { inset: 0.05 });
    inner.translate(-hingePt.x, -hingePt.y, -hingePt.z);
    mesh(inner, dark, 'door_inner', door);
    // Door outline seam on the fuselage.
    mesh(loftSkin(P, x0 - 0.012, x0, fixedRange(th0, th1), 1, 10, { inset: -0.0025 }), seam, 'door_seam', body);
    mesh(loftSkin(P, x1, x1 + 0.012, fixedRange(th0, th1), 1, 10, { inset: -0.0025 }), seam, 'door_seam', body);
  }

  // ---------------------------------------------------------------- wings with movable surfaces
  const wings = new THREE.Group();
  wings.name = 'wings';
  wings.userData.visibleFromCockpit = true;
  root.add(wings);
  const movables: Record<string, Movable[]> = { flapL: [], flapR: [], ailL: [], ailR: [], ailTab: [], sbUL: [], sbUR: [], sbLL: [], sbLR: [], elevL: [], elevR: [], elevTabL: [], elevTabR: [], rudder: [], rudTab: [] };
  const hinge = (name: keyof typeof movables, g: THREE.BufferGeometry, pivotBody: [number, number, number], axisBody: [number, number, number], m: THREE.Material, parent: THREE.Object3D) => {
    const pivot = new THREE.Group();
    const abs = bl(...pivotBody);
    // Parent may itself be a hinge (trim tabs ride on their surface): express the pivot in the parent's frame.
    root.updateMatrixWorld(true);
    pivot.position.copy(abs).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(parent.matrixWorld).invert());
    parent.add(pivot);
    g.translate(-abs.x, -abs.y, -abs.z);
    mesh(g, m, String(name), pivot);
    const axis = bl(...axisBody).normalize();
    movables[name].push({ obj: pivot, axis, base: pivot.quaternion.clone() });
    return pivot;
  };
  const FLAP_Y: [number, number] = [0.62, 4.55]; // EST: wide-span flaps (S&D15 §9.1)
  const AIL_Y: [number, number] = [4.6, 6.85];
  const TE_FRAC = 0.74;
  for (const mirror of [false, true]) {
    const sgn = mirror ? -1 : 1;
    // Fixed wing box (LE to 74 % chord), heated LE strip, tip cap.
    mesh(loftWing([...WING, { ...wingSec(SEMI_SPAN, 0.72, 0.1, -1.5) }], { mirror, chordRange: [0.03, TE_FRAC] }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(loftWing([...WING, { ...wingSec(SEMI_SPAN, 0.72, 0.1, -1.5) }], { mirror, chordRange: [0, 0.035] }), leSteel, 'wing_le', wings);
    const sec = (y: number, t: number) => ({ y, ...wingAt(y), t });
    // Flap (single slotted, EST) and aileron: aft 26 % chord.
    const fS = [sec(FLAP_Y[0], 0.15), sec(2.4, 0.14), sec(FLAP_Y[1], 0.13)];
    const f0 = fS[0];
    const f2 = fS[2];
    hinge(mirror ? 'flapL' : 'flapR', loftWing(fS, { mirror, chordRange: [TE_FRAC, 1] }), [f0.xLe - TE_FRAC * f0.chord, sgn * f0.y, f0.z], [f2.xLe - TE_FRAC * f2.chord - (f0.xLe - TE_FRAC * f0.chord), sgn * (f2.y - f0.y), f2.z - f0.z], paint, wings);
    const aS = [sec(AIL_Y[0], 0.13), sec(AIL_Y[1], 0.12)];
    const a0 = aS[0];
    const a1 = aS[1];
    const ailAxis: [number, number, number] = [a1.xLe - TE_FRAC * a1.chord - (a0.xLe - TE_FRAC * a0.chord), sgn * (a1.y - a0.y), a1.z - a0.z];
    const ailP = hinge(mirror ? 'ailL' : 'ailR', loftWing(aS, { mirror, chordRange: [TE_FRAC, 1] }), [a0.xLe - TE_FRAC * a0.chord, sgn * a0.y, a0.z], ailAxis, paint, wings);
    if (mirror) {
      // Aileron trim tab on the LH aileron only (S&D15 §9.1), inboard 35 % of the aileron span.
      const tS = [sec(AIL_Y[0] + 0.1, 0.13), sec(AIL_Y[0] + 0.85, 0.13)];
      const t0 = tS[0];
      const t1 = tS[1];
      hinge('ailTab', loftWing(tS, { mirror, chordRange: [0.92, 1] }), [t0.xLe - 0.92 * t0.chord, -t0.y, t0.z], [t1.xLe - 0.92 * t1.chord - (t0.xLe - 0.92 * t0.chord), -(t1.y - t0.y), t1.z - t0.z], dark, ailP);
    }
    // Trailing-edge closures outside the movables.
    mesh(loftWing([sec(FLAP_Y[1], 0.13), sec(AIL_Y[0], 0.13)], { mirror, chordRange: [TE_FRAC, 1] }), paint, 'te_mid', wings);
    mesh(loftWing([sec(AIL_Y[1], 0.12), { ...wingSec(SEMI_SPAN, 0.72, 0.1, -1.5) }], { mirror, chordRange: [TE_FRAC, 1] }), paint, 'te_tip', wings);
    // Speed brakes: upper (0-49 deg) and lower (0-68 deg) panels at mid span ahead of the flaps (TCDS §16, S&D15 §9.1).
    const sy0 = 2.55;
    const sy1 = 3.75;
    const w0 = wingAt(sy0);
    const w1 = wingAt(sy1);
    for (const lower of [false, true]) {
      const zs = lower ? 1 : -1;
      const g = new THREE.BufferGeometry();
      const Pt = (y: number, w: { xLe: number; chord: number; z: number }, f: number) => bl(w.xLe - f * w.chord, sgn * y, w.z + zs * 0.052 * w.chord * (1 - f * 0.7) + zs * 0.004);
      const q = [Pt(sy0, w0, 0.5), Pt(sy1, w1, 0.5), Pt(sy1, w1, 0.68), Pt(sy0, w0, 0.68)];
      // Front face toward the outside of the wing surface.
      if (lower !== mirror) g.setFromPoints([q[0], q[2], q[1], q[0], q[3], q[2]]);
      else g.setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]);
      g.computeVertexNormals();
      const key = (lower ? (mirror ? 'sbLL' : 'sbLR') : mirror ? 'sbUL' : 'sbUR') as keyof typeof movables;
      const hz = w0.z + zs * 0.052 * w0.chord * 0.65;
      hinge(key, g, [w0.xLe - 0.5 * w0.chord, sgn * sy0, hz], [w1.xLe - 0.5 * w1.chord - (w0.xLe - 0.5 * w0.chord), sgn * (sy1 - sy0), w1.z - w0.z], seam, wings);
    }
  }

  // ---------------------------------------------------------------- T-tail
  const tail = new THREE.Group();
  tail.name = 'empennage';
  root.add(tail);
  const fin: WingSection[] = [
    { y: -0.25, xLe: FIN_ROOT_LE + 0.25 * Math.tan(49 * D2R) * 0.6, chord: FIN_ROOT_CHORD + 0.1, z: FIN_ROOT_Z, t: 0.11 },
    { y: FIN_H, xLe: FIN_TIP_LE, chord: FIN_TIP_CHORD, z: FIN_ROOT_Z, t: 0.1 },
  ];
  mesh(loftWing(fin, { vertical: true, chordRange: [0, 0.7] }), paint, 'fin', tail);
  // Dorsal fin fillet (EST).
  {
    const g = loftWing(
      [
        { y: -0.2, xLe: FIN_ROOT_LE + 0.9, chord: 1.2, z: FIN_ROOT_Z, t: 0.08 },
        { y: 0.35, xLe: FIN_ROOT_LE - 0.05, chord: 0.5, z: FIN_ROOT_Z, t: 0.08 },
      ],
      { vertical: true },
    );
    mesh(g, paint, 'dorsal', tail);
  }
  const rudRoot = FIN_ROOT_LE - 0.7 * FIN_ROOT_CHORD;
  const rudTip = FIN_TIP_LE - 0.7 * FIN_TIP_CHORD;
  const rudP = hinge('rudder', loftWing([fin[0], fin[1]].map((s) => ({ ...s, y: Math.max(0.05, s.y) })), { vertical: true, chordRange: [0.7, 1] }), [rudRoot, 0, FIN_ROOT_Z - 0.05], [rudTip - rudRoot, 0, -FIN_H], paint, tail);
  // Rudder trim tab (S&D15 §9.1), lower third.
  {
    const y0 = 0.3;
    const y1 = 0.95;
    const le = (y: number) => FIN_ROOT_LE + (FIN_TIP_LE - FIN_ROOT_LE) * (y / FIN_H);
    const ch = (y: number) => FIN_ROOT_CHORD + (FIN_TIP_CHORD - FIN_ROOT_CHORD) * (y / FIN_H);
    const secs: WingSection[] = [
      { y: y0, xLe: le(y0), chord: ch(y0), z: FIN_ROOT_Z, t: 0.09 },
      { y: y1, xLe: le(y1), chord: ch(y1), z: FIN_ROOT_Z, t: 0.09 },
    ];
    const px = le(y0) - 0.93 * ch(y0);
    const px1 = le(y1) - 0.93 * ch(y1);
    hinge('rudTab', loftWing(secs, { vertical: true, chordRange: [0.93, 1.001] }), [px, 0, FIN_ROOT_Z - y0], [px1 - px, 0, -(y1 - y0)], dark, rudP);
  }
  // Horizontal stabilizer: 0 deg sweep at 70 % chord, pneumatic de-ice boots on the leading edges (S&D15 §9.7).
  const stab = (y: number): WingSection => {
    const c = 1.3 + ((0.68 - 1.3) * y) / 2.85;
    return { y, xLe: STAB_X70 + 0.7 * c, chord: c, z: STAB_Z - y * Math.tan(-1.5 * D2R), t: 0.1 };
  };
  const stabSecs = [stab(0), stab(2.85)];
  for (const mirror of [false, true]) {
    mesh(loftWing(stabSecs, { mirror, chordRange: [0.08, 0.7] }), paint, 'stab', tail);
    mesh(loftWing(stabSecs, { mirror, chordRange: [0, 0.08] }), deice, 'stab_boot', tail);
    const eS = stabSecs;
    const e0 = eS[0];
    const e1 = eS[1];
    const sgn = mirror ? -1 : 1;
    const eAxis: [number, number, number] = [e1.xLe - 0.7 * e1.chord - (e0.xLe - 0.7 * e0.chord), sgn * 2.85, e1.z - e0.z];
    const ep = hinge(mirror ? 'elevL' : 'elevR', loftWing(eS, { mirror, chordRange: [0.7, 1] }), [e0.xLe - 0.7 * e0.chord, 0, e0.z], eAxis, paint, tail);
    // Elevator trim tabs (both elevators, S&D15 §9.1), inboard.
    const tS = [stab(0.35), stab(1.3)];
    const t0 = tS[0];
    const t1 = tS[1];
    hinge(mirror ? 'elevTabL' : 'elevTabR', loftWing(tS, { mirror, chordRange: [0.93, 1.001] }), [t0.xLe - 0.93 * t0.chord, sgn * t0.y, t0.z], [t1.xLe - 0.93 * t1.chord - (t0.xLe - 0.93 * t0.chord), sgn * (t1.y - t0.y), t1.z - t0.z], dark, ep);
  }
  // Fin/stab junction bullet fairing.
  {
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      prof.push(new THREE.Vector2(0.11 * Math.sin(Math.PI * Math.min(1, t * 1.25)) + 0.001, 1.2 * (0.5 - t)));
    }
    const g = new THREE.LatheGeometry(prof, 20);
    g.rotateX(-Math.PI / 2);
    const bm = mesh(g, paint, 'bullet', tail);
    bm.position.copy(bl(STAB_X70 + 0.35, 0, STAB_Z - 0.06));
  }

  // ---------------------------------------------------------------- engines (FJ44-1AP-21 on aft pylons)
  const engines = new THREE.Group();
  engines.name = 'engines';
  engines.userData.visibleFromCockpit = true;
  root.add(engines);
  const fans: THREE.Object3D[] = [];
  const NAC_LEN = 2.15; // EST: FJ44-1AP 57.9 in engine (ETCDS) + inlet / exhaust
  const NAC_R = 0.37; // EST
  for (const y of [-1.32, 1.32]) {
    const g = new THREE.Group();
    g.position.copy(bl(-1.78, y, -0.35));
    engines.add(g);
    const prof: THREE.Vector2[] = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 inlet lip .. 1 exhaust
      let r: number;
      if (t < 0.12) r = NAC_R * (0.84 + 0.16 * Math.sin((t / 0.12) * (Math.PI / 2)));
      else if (t < 0.6) r = NAC_R;
      else r = NAC_R * (1 - 0.42 * Math.pow((t - 0.6) / 0.4, 1.4));
      prof.push(new THREE.Vector2(r, NAC_LEN * 0.46 - t * NAC_LEN));
    }
    const nac = new THREE.LatheGeometry(prof, 40);
    nac.rotateX(-Math.PI / 2);
    mesh(nac, paint, 'nacelle', g);
    const lip = new THREE.TorusGeometry(NAC_R * 0.86, 0.03, 10, 40);
    mesh(lip, leSteel, 'inlet_lip', g).position.copy(bl(NAC_LEN * 0.46, 0, 0));
    // Inlet duct (dark) and fan with spinner (rotates with N1).
    const duct = new THREE.CylinderGeometry(NAC_R * 0.84, NAC_R * 0.8, 0.3, 32, 1, true);
    duct.rotateX(Math.PI / 2);
    const dm = mesh(duct, dark, 'inlet_duct', g);
    dm.position.copy(bl(NAC_LEN * 0.46 - 0.15, 0, 0));
    (dm.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const fan = new THREE.Group();
    fan.position.copy(bl(NAC_LEN * 0.46 - 0.28, 0, 0));
    g.add(fan);
    mesh(new THREE.CircleGeometry(NAC_R * 0.8, 32), dark, 'fan_disc', fan);
    const blade = new THREE.BoxGeometry(0.03, NAC_R * 1.56, 0.01);
    for (let b = 0; b < 12; b++) {
      const bm = mesh(blade.clone(), metal, 'fan_blade', fan);
      bm.position.z = -0.012;
      bm.rotation.z = (b / 12) * Math.PI;
      bm.rotation.y = 0.55;
    }
    blade.dispose();
    const spinner = new THREE.ConeGeometry(0.11, 0.24, 20);
    spinner.rotateX(-Math.PI / 2);
    mesh(spinner, dark, 'spinner', fan).position.z = -0.13;
    fans.push(fan);
    // Exhaust: mixer nozzle and centre plug.
    const plug = new THREE.ConeGeometry(0.13, 0.35, 20);
    plug.rotateX(Math.PI / 2);
    mesh(plug, dark, 'exhaust_plug', g).position.copy(bl(-NAC_LEN * 0.54 - 0.12, 0, 0));
    const noz = new THREE.CylinderGeometry(NAC_R * 0.58, NAC_R * 0.58, 0.08, 28, 1, true);
    noz.rotateX(Math.PI / 2);
    const nm = mesh(noz, dark, 'nozzle', g);
    nm.position.copy(bl(-NAC_LEN * 0.54 + 0.02, 0, 0));
    // Pylon to the fuselage side (inboard edge inside the skin), aerofoil-ish box.
    const pylW = Math.abs(y) - 0.5;
    const pyl = new THREE.BoxGeometry(pylW, 0.09, 1.25);
    const pm = mesh(pyl, paint, 'pylon', engines);
    pm.position.copy(bl(-1.85, Math.sign(y) * (0.5 + pylW / 2), -0.36));
  }

  // ---------------------------------------------------------------- landing gear
  interface GearLeg {
    index: number;
    pivot: THREE.Group;
    strut: THREE.Group;
    steer: THREE.Group;
    wheels: THREE.Object3D[];
    travel: number;
    retractAxis: THREE.Vector3;
    retractAngle: number;
    radius: number;
    doors: { obj: THREE.Object3D; axis: THREE.Vector3; angle: number }[];
  }
  const legs: GearLeg[] = [];
  const makeLeg = (index: number, contact: [number, number, number], pivotZ: number, radius: number, width: number, travel: number, retractAxis: [number, number, number], retractAngle: number, trailing: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.copy(bl(contact[0], contact[1], pivotZ));
    root.add(pivot);
    const strut = new THREE.Group();
    pivot.add(strut);
    const len = contact[2] - radius - pivotZ;
    const oleo = new THREE.CylinderGeometry(0.045, 0.05, len, 12);
    const om = mesh(oleo, metal, 'strut', strut);
    om.position.y = -len / 2;
    const chromeG = new THREE.CylinderGeometry(0.035, 0.035, len * 0.35, 12);
    mesh(chromeG, chrome, 'piston', strut).position.y = -len * 0.8;
    const steer = new THREE.Group();
    steer.position.y = -len;
    strut.add(steer);
    const wheels: THREE.Object3D[] = [];
    const tg = new THREE.TorusGeometry(radius * 0.7, radius * 0.3, 14, 28);
    tg.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, width * 0.85, 18);
    hub.rotateZ(Math.PI / 2);
    const w = new THREE.Group();
    // Trailing-link mains: the axle sits ~0.2 m aft of the strut (S&D15 §7).
    if (trailing) {
      const link = new THREE.BoxGeometry(0.05, 0.06, 0.24);
      const lm = mesh(link, metal, 'trailing_link', steer);
      lm.position.set(0, 0.02, 0.1);
      w.position.z = 0.2;
    }
    steer.add(w);
    mesh(tg, tyre, 'tyre', w);
    mesh(hub, metal, 'hub', w);
    wheels.push(w);
    legs.push({ index, pivot, strut, steer, wheels, travel, retractAxis: bl(...retractAxis).normalize(), retractAngle, radius, doors: [] });
    return legs[legs.length - 1];
  };
  // fdm.ts: nose FS 80.7 (x 4.30), mains FS 264.7 (x -0.373), tread 3.96 m, contact z 1.40 extended.
  const noseLeg = makeLeg(0, [4.3, 0, 1.4], 0.66, 0.229, 0.112, 0.2, [0, 1, 0], 100 * D2R, false); // 18 x 4.4, retracts forward
  const mlX = -0.373;
  makeLeg(1, [mlX - 0.2, -1.98, 1.4], 0.42, 0.284, 0.197, 0.25, [1, 0, 0], -86 * D2R, true); // 22 x 7.75, retracts inboard
  makeLeg(2, [mlX - 0.2, 1.98, 1.4], 0.42, 0.284, 0.197, 0.25, [1, 0, 0], 86 * D2R, true);
  // Nose gear doors (two, hinged along the keel edges).
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.copy(bl(4.2, s * 0.13, 0.77));
    root.add(piv);
    const dg = new THREE.BoxGeometry(0.012, 0.34, 0.95);
    dg.translate(0, -0.17, 0);
    mesh(dg, paint, 'nose_door', piv);
    noseLeg.doors.push({ obj: piv, axis: bl(1, 0, 0).normalize(), angle: s * 80 * D2R });
  }
  // Wheel wells (dark recesses seen when the gear is down).
  {
    const nw = new THREE.BoxGeometry(0.24, 0.02, 0.95);
    const wm = mesh(nw, wellMat, 'nose_well', body);
    wm.position.copy(bl(4.2, 0, 0.76));
  }

  // ---------------------------------------------------------------- lights
  const GLOW = 64;
  const glowData = new Uint8Array(GLOW * GLOW * 4);
  for (let yy = 0; yy < GLOW; yy++) {
    for (let xx = 0; xx < GLOW; xx++) {
      const r = Math.hypot(xx + 0.5 - GLOW / 2, yy + 0.5 - GLOW / 2) / (GLOW / 2);
      const a = Math.max(0, 1 - r);
      const o = (yy * GLOW + xx) * 4;
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
  const lamp = (color: number, pos: [number, number, number], size = 0.04, parent: THREE.Object3D = root, halo = 14): Lamp => {
    const m = track(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const me = mesh(track(new THREE.SphereGeometry(size, 10, 8)), m, 'lamp', parent);
    me.castShadow = false;
    me.position.copy(bl(...pos));
    const hm = track(new THREE.SpriteMaterial({ color, map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const sp = new THREE.Sprite(hm);
    sp.scale.setScalar(size * halo);
    sp.position.copy(me.position);
    parent.add(sp);
    return { m, halo: hm, color: new THREE.Color(color) };
  };
  const tip = wingAt(SEMI_SPAN);
  const tipZ = tip.z;
  // Position lights (14 CFR 23.1385): red left tip, green right tip (forward-facing), white aft on each tip; LED.
  const navR = lamp(0x10ff50, [tip.xLe - 0.12, SEMI_SPAN + 0.03, tipZ], 0.035, wings);
  const navL = lamp(0xff1a10, [tip.xLe - 0.12, -SEMI_SPAN - 0.03, tipZ], 0.035, wings);
  const navAftR = lamp(0xffffff, [tip.xLe - 0.72, SEMI_SPAN + 0.02, tipZ], 0.028, wings);
  const navAftL = lamp(0xffffff, [tip.xLe - 0.72, -SEMI_SPAN - 0.02, tipZ], 0.028, wings);
  const strobeR = lamp(0xf4f7ff, [tip.xLe - 0.3, SEMI_SPAN + 0.04, tipZ], 0.03, wings, 20);
  const strobeL = lamp(0xf4f7ff, [tip.xLe - 0.3, -SEMI_SPAN - 0.04, tipZ], 0.03, wings, 20);
  // Red flashing beacons: top of the T-tail bullet and belly (S&D21 §9.4).
  const beaconTop = lamp(0xff2200, [STAB_X70 + 0.35, 0, STAB_Z - 0.2], 0.045, tail, 16);
  const beaconBot = lamp(0xff2200, [0.4, 0, 0.9], 0.045, body, 16);
  // Landing / recognition lights in the wing-root leading edges, taxi light on the nose gear (EST positions).
  const lroot = wingAt(1.05);
  const landL = lamp(0xfff6e8, [lroot.xLe + 0.01, -1.05, lroot.z], 0.05, wings, 12);
  const landR = lamp(0xfff6e8, [lroot.xLe + 0.01, 1.05, lroot.z], 0.05, wings, 12);
  const taxiLamp = lamp(0xfff6e8, [0.05, 0, 0.62], 0.035, noseLeg.strut, 10);
  // Logo lights (upper stabilizer surface, shining on the fin) and wing inspection light (LH fuselage).
  const logoL = lamp(0xffffff, [STAB_X70 + 0.2, -0.9, STAB_Z - 0.06], 0.02, tail, 8);
  const logoR = lamp(0xffffff, [STAB_X70 + 0.2, 0.9, STAB_Z - 0.06], 0.02, tail, 8);
  const inspPos: [number, number, number] = [1.2, -0.8, -0.1];
  const inspLamp = lamp(0xffffff, inspPos, 0.02, body, 8);

  // Real lights (spot, candela via world.render_units_per_lux). EST intensities for LED aviation lamps.
  const spot = (color: number, pos: [number, number, number], target: [number, number, number], angleDeg: number, parent: THREE.Object3D, name: string): THREE.SpotLight => {
    const s = new THREE.SpotLight(color, 0, 900, angleDeg * D2R, 0.4, 2);
    s.name = name;
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    parent.add(s, s.target);
    return s;
  };
  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'lights';
  lightsGroup.userData.visibleFromCockpit = true;
  root.add(lightsGroup);
  const landSpotL = spot(0xfff4e6, [lroot.xLe + 0.02, -1.05, lroot.z], [80, -3, 4.5], 11, lightsGroup, 'landing_l');
  const landSpotR = spot(0xfff4e6, [lroot.xLe + 0.02, 1.05, lroot.z], [80, 3, 4.5], 11, lightsGroup, 'landing_r');
  const taxiSpot = spot(0xfff4e6, [4.35, 0, 0.95], [30, 0, 1.35], 30, lightsGroup, 'taxi');
  const inspSpot = spot(0xffffff, inspPos, [0.2, -3.5, 0.3], 14, lightsGroup, 'wing_insp');

  for (const c of root.children) if (c.userData.visibleFromCockpit === undefined) c.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const posVar = [0, 1, 2].map((i) => GEAR.pos(i));
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const n1Var = [1, 2].map((i) => ENG.n1(i));
  const doorVar = M2.doorOpen('cabin');
  const tmpQ = new THREE.Quaternion();
  const setHinge = (list: Movable[], angle: number) => {
    for (const mv of list) mv.obj.quaternion.copy(mv.base).multiply(tmpQ.setFromAxisAngle(mv.axis, angle));
  };
  const fanAngle = [0, 0];
  const wheelAngle = [0, 0, 0];
  let doorPos = vars.get(doorVar);
  const setLamp = (l: Lamp, level: number) => {
    const x = Math.max(0, Math.min(1, level));
    l.m.color.copy(l.color).multiplyScalar(0.06 + 0.94 * x);
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
      leg.pivot.visible = pos > 0.01;
      // Nose doors: open while the gear is in transit or down (they stay open with the gear down, EST).
      const dOpen = Math.min(1, pos * 4);
      for (const d of leg.doors) d.obj.quaternion.setFromAxisAngle(d.axis, dOpen * d.angle);
    }
    const flaps = v.get(SURF.flapsDeg) * D2R;
    setHinge(movables.flapR, flaps);
    setHinge(movables.flapL, -flaps);
    // TCDS §16: ailerons up 23.5 / down 20.5 deg; + aileron = right roll (right aileron up).
    const ail = v.get(SURF.aileron);
    const ailDeg = (d: number) => (d >= 0 ? d * 23.5 : d * 20.5) * D2R;
    setHinge(movables.ailR, -ailDeg(ail));
    // Left aileron moves opposite (down for right roll); its hinge axis runs tip-ward (-y), hence the sign.
    setHinge(movables.ailL, ailDeg(-ail));
    setHinge(movables.ailTab, (v.get(SURF.aileronTrim) * -19) * D2R);
    // Speed brakes: upper 0-49 deg, lower 0-68 deg (TCDS §16).
    const sb = v.get(SURF.speedbrake);
    setHinge(movables.sbUR, -sb * 49 * D2R);
    setHinge(movables.sbUL, sb * 49 * D2R);
    setHinge(movables.sbLR, sb * 68 * D2R);
    setHinge(movables.sbLL, -sb * 68 * D2R);
    // Elevator up 18.5 / down 15 deg (TCDS); + elevator = nose up (TE up).
    const e = v.get(SURF.elevator);
    const eDeg = (e >= 0 ? e * 18.5 : e * 15) * D2R;
    setHinge(movables.elevR, -eDeg);
    setHinge(movables.elevL, eDeg);
    // Elevator trim tab up 12 / down 20 deg (TCDS): nose-up trim = tab down.
    const pt = v.get(SURF.pitchTrim);
    const tabDeg = (pt >= 0 ? pt * 20 : pt * 12) * D2R;
    setHinge(movables.elevTabR, tabDeg);
    setHinge(movables.elevTabL, -tabDeg);
    // Rudder +-30 deg (TCDS), + rudder = right yaw (TE right); rudder tab +-20 deg.
    setHinge(movables.rudder, -v.get(SURF.rudder) * 30 * D2R);
    setHinge(movables.rudTab, v.get(SURF.rudderTrim) * 20 * D2R);
    for (let i = 0; i < 2; i++) {
      fanAngle[i] = (fanAngle[i] + (v.get(n1Var[i]) / 100) * 50 * dt * 2 * Math.PI) % (2 * Math.PI);
      fans[i].rotation.z = fanAngle[i];
    }
    // Airstair door: ~3 s to open / close (EST, hydraulic-damped manual door).
    const dTarget = v.get(doorVar) !== 0 ? 1 : 0;
    doorPos += Math.max(-dt / 3, Math.min(dt / 3, dTarget - doorPos));
    door.rotation.set(0, 0, 0);
    door.rotateOnAxis(bl(1, 0, 0).normalize(), -doorPos * 95 * D2R);

    const nav = v.get('light.nav');
    setLamp(navR, nav);
    setLamp(navL, nav);
    setLamp(navAftR, nav);
    setLamp(navAftL, nav);
    const st = v.get('light.strobe');
    setLamp(strobeR, st);
    setLamp(strobeL, st);
    const bc = v.get('light.beacon');
    setLamp(beaconTop, bc);
    setLamp(beaconBot, bc);
    const rec = v.get('light.recognition');
    const ll = Math.max(v.get('light.landing_l'), rec);
    const lr = Math.max(v.get('light.landing_r'), rec);
    setLamp(landL, ll);
    setLamp(landR, lr);
    const tx = v.get('light.taxi');
    setLamp(taxiLamp, tx);
    const lg = v.get('light.logo');
    setLamp(logoL, lg);
    setLamp(logoR, lg);
    const wi = v.get('light.wing');
    setLamp(inspLamp, wi);
    // EST candela: LED landing lights ~400,000 cd each, taxi ~60,000 cd, wing inspection ~3,000 cd.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    landSpotL.intensity = ll * 400_000 * k;
    landSpotR.intensity = lr * 400_000 * k;
    taxiSpot.intensity = tx * 60_000 * k;
    inspSpot.intensity = wi * 3_000 * k;
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
