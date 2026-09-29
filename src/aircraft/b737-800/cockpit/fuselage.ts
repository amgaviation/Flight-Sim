/**
 * Boeing 737-800 fuselage geometry shared by the flight-deck shell
 * (cockpit/shell.ts) and the exterior (exterior.ts), so the window openings
 * of the interior line up with the exterior glazing.
 *
 * Body axes (fdm.ts): x forward, y right, z down, metres from the datum
 * (empty CG at 21 % MAC); the ground is 3.2 m below the datum
 * (fdm.ts DATUM_HEIGHT_M). Local Three.js axes: (y, -z, -x).
 *
 * Cross-sections are quarter-ellipses around a "widest line" at height zc:
 * half-width ry, upper half-height ru, lower half-height rl. The 737 cabin
 * section is 3.76 m wide and 4.01 m tall outside (B737ORG "Tech specs";
 * dossier §2) with the widest line ~0.2 m above the datum; the nose shape
 * is EST from published three-view drawings and flight-deck photographs,
 * constrained by the dossier's design eye (EYE_CAPT [13.754, -0.53, -0.42])
 * and windshield (sill ~0.1 m below the eye, ~0.75 m ahead).
 *
 * `skinShape()` maps a 2-D outline drawn in (x, theta) parameter space
 * (theta = angle round the section, 0 = crown, +pi/2 = right side) onto the
 * skin, with holes (windows) and adaptive subdivision so the triangles
 * follow the curvature.
 */
import * as THREE from 'three';

export interface B738Station {
  x: number;
  /** Height of the widest line (body z). */
  zc: number;
  /** Half-width. */
  ry: number;
  /** Upper and lower half-heights. */
  ru: number;
  rl: number;
  /** Superellipse exponent of the upper half (2 = ellipse; > 2 = fuller crown, the flight-deck nose). Default 2. */
  nu?: number;
}

/** Section stations, nose to tail (EST between the ACAPS anchors: 39.47 m overall, 3.76 x 4.01 m section). */
const STATIONS: B738Station[] = [
  { x: 16.714, zc: 0.55, ry: 0.03, ru: 0.02, rl: 0.03 }, // radome tip (fdm.ts NOSE_TIP_X)
  { x: 16.62, zc: 0.55, ry: 0.26, ru: 0.12, rl: 0.3 },
  { x: 16.25, zc: 0.54, ry: 0.55, ru: 0.24, rl: 0.72, nu: 2.2 },
  { x: 15.65, zc: 0.5, ry: 0.8, ru: 0.36, rl: 1.08, nu: 2.8 },
  { x: 15.05, zc: 0.44, ry: 0.98, ru: 0.52, rl: 1.36, nu: 3.8 },
  { x: 14.56, zc: 0.36, ry: 1.08, ru: 0.7, rl: 1.54, nu: 5.0 },
  { x: 14.0, zc: 0.2, ry: 1.2, ru: 1.25, rl: 1.68, nu: 4.0 },
  { x: 13.4, zc: 0.06, ry: 1.36, ru: 1.46, rl: 1.84, nu: 3.0 },
  { x: 12.4, zc: -0.08, ry: 1.64, ru: 1.72, rl: 2.02, nu: 2.3 },
  { x: 11.0, zc: -0.18, ry: 1.84, ru: 1.86, rl: 2.12 },
  { x: 10.0, zc: -0.2, ry: 1.88, ru: 1.855, rl: 2.155 },
  // Constant section (cabin) to the aft pressure bulkhead region.
  { x: -9.0, zc: -0.2, ry: 1.88, ru: 1.855, rl: 2.155 },
  // Tail cone: the lower line sweeps up to the APU exhaust (tail-strike attitude 11 deg, fdm.ts).
  { x: -12.0, zc: -0.45, ry: 1.72, ru: 1.6, rl: 1.4 },
  { x: -15.0, zc: -0.8, ry: 1.3, ru: 1.2, rl: 0.62 },
  { x: -18.5, zc: -1.12, ry: 0.78, ru: 0.78, rl: 0.2 },
  { x: -21.5, zc: -1.2, ry: 0.32, ru: 0.32, rl: 0.14 },
  { x: -22.756, zc: -1.2, ry: 0.12, ru: 0.12, rl: 0.1 }, // APU exhaust: 39.47 m overall (ACAPS)
];

export class B738Fuselage {
  readonly stations = STATIONS;
  private readonly tmp: B738Station = { x: 0, zc: 0, ry: 0, ru: 0, rl: 0, nu: 2 };

  /** Interpolated section at body x (cosine blend between stations). */
  at(x: number, out: B738Station = this.tmp): B738Station {
    const s = this.stations;
    if (x >= s[0].x) return Object.assign(out, s[0], { x, nu: s[0].nu ?? 2 });
    if (x <= s[s.length - 1].x) return Object.assign(out, s[s.length - 1], { x, nu: s[s.length - 1].nu ?? 2 });
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (x <= a.x && x >= b.x) {
        const t = (a.x - x) / Math.max(1e-9, a.x - b.x);
        const k = (1 - Math.cos(Math.PI * t)) / 2;
        out.x = x;
        out.zc = a.zc + (b.zc - a.zc) * k;
        out.ry = a.ry + (b.ry - a.ry) * k;
        out.ru = a.ru + (b.ru - a.ru) * k;
        out.rl = a.rl + (b.rl - a.rl) * k;
        out.nu = (a.nu ?? 2) + ((b.nu ?? 2) - (a.nu ?? 2)) * k;
        return out;
      }
    }
    return out;
  }

  /**
   * Body point [y, z] on the section at x, angle theta, moved inward by `inset`. The half-width is
   * y = ry sin(theta) (so theta meshes evenly across the crown); the upper half follows the
   * superellipse |y/ry|^nu + |dz/ru|^nu = 1, the lower half an ellipse.
   */
  bodyYZ(x: number, theta: number, inset = 0): [number, number] {
    const s = this.at(x);
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const y = Math.max(0.001, s.ry - inset) * sn;
    if (c >= 0) {
      const n = s.nu ?? 2;
      const r = Math.max(0.001, s.ru - inset);
      return [y, s.zc - r * (1 - Math.min(1, Math.abs(sn) ** n)) ** (1 / n)];
    }
    return [y, s.zc - Math.max(0.001, s.rl - inset) * c];
  }

  /** Local (Three.js) point. */
  point(x: number, theta: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const [y, z] = this.bodyYZ(x, theta, inset);
    return out.set(y, -z, -x);
  }

  /** Interior half-width at body (x, z) with the given inset (0 when outside the section). */
  halfWidth(x: number, z: number, inset = 0): number {
    const s = this.at(x);
    const upper = z <= s.zc;
    const n = upper ? (s.nu ?? 2) : 2;
    const r = (upper ? s.ru : s.rl) - inset;
    const d = Math.abs((z - s.zc) / Math.max(0.001, r));
    return d >= 1 ? 0 : (s.ry - inset) * (1 - d ** n) ** (1 / n);
  }

  /** Crown (top) height at x. */
  topZ(x: number, inset = 0): number {
    const s = this.at(x);
    return s.zc - (s.ru - inset);
  }

  /** Angle theta (0..pi) of height z on the section at x (right side). */
  thetaAt(x: number, z: number): number {
    const s = this.at(x);
    if (z <= s.zc) {
      const n = s.nu ?? 2;
      const q = Math.min(1, (s.zc - z) / s.ru);
      return Math.asin(Math.min(1, (1 - q ** n) ** (1 / n)));
    }
    return Math.acos(Math.max(-1, (s.zc - z) / s.rl));
  }
}

export const B738_FUSELAGE = new B738Fuselage();

/** Scale converting theta (rad) to metres for parameter-space distances. */
const THETA_M = 1.6;

/**
 * Skin patch over [x0, x1] x [theta0, theta1] (x0 < x1 aft to fwd). `inward`
 * flips the winding so the surface faces the inside.
 */
export function loftSkin(x0: number, x1: number, t0: number, t1: number, segX: number, segT: number, o: { inset?: number; inward?: boolean; f?: B738Fuselage } = {}): THREE.BufferGeometry {
  const f = o.f ?? B738_FUSELAGE;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= segX; i++) {
    const x = x0 + ((x1 - x0) * i) / segX;
    for (let j = 0; j <= segT; j++) {
      const th = t0 + ((t1 - t0) * j) / segT;
      f.point(x, th, o.inset ?? 0, v);
      pos.push(v.x, v.y, v.z);
      uv.push(x, th * THETA_M);
    }
  }
  const row = segT + 1;
  for (let i = 0; i < segX; i++)
    for (let j = 0; j < segT; j++) {
      const a = i * row + j;
      const b = a + row;
      if (o.inward) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A polygon in (x, theta) parameter space. */
export type SkinPoly = readonly (readonly [number, number])[];

function signedArea(p: SkinPoly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * Maps an outline with holes (parameter space) onto the skin. Triangles are
 * subdivided until no edge exceeds `maxEdge` metres (theta scaled by 1.6 m),
 * so the surface follows the section curvature.
 */
export function skinShape(outline: SkinPoly, holes: SkinPoly[], o: { inset?: number; inward?: boolean; maxEdge?: number; f?: B738Fuselage } = {}): THREE.BufferGeometry {
  const f = o.f ?? B738_FUSELAGE;
  const maxEdge = o.maxEdge ?? 0.06;
  const toV = (p: SkinPoly, ccw: boolean) => {
    const pts = p.map(([x, t]) => new THREE.Vector2(x, t * THETA_M));
    const a = signedArea(p);
    if (a > 0 !== ccw) pts.reverse();
    return pts;
  };
  // Densify the edges (<= 0.35 m) so the triangulation has no very long slivers.
  const dens = (pts: THREE.Vector2[]): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.35));
      for (let k = 0; k < n; k++) out.push(new THREE.Vector2().lerpVectors(a, b, k / n));
    }
    return out;
  };
  const contour = dens(toV(outline, true));
  const hs = holes.map((h) => dens(toV(h, false)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const px: number[] = [];
  const pt: number[] = [];
  for (const v of [...contour, ...hs.flat()]) {
    px.push(v.x);
    pt.push(v.y);
  }
  // Orient every triangle CCW in (x, theta*) (earcut does not guarantee it).
  let idx: number[] = [];
  let maxLen = 0;
  for (const [a, b, c] of tris) {
    const cross = (px[b] - px[a]) * (pt[c] - pt[a]) - (pt[b] - pt[a]) * (px[c] - px[a]);
    if (cross >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      maxLen = Math.max(maxLen, Math.hypot(px[i] - px[j], pt[i] - pt[j]));
  }
  // Uniform midpoint subdivision with shared midpoints: no T-junctions (no cracks) and shared vertices (smooth normals).
  const levels = Math.max(0, Math.min(5, Math.ceil(Math.log2(maxLen / maxEdge))));
  for (let l = 0; l < levels; l++) {
    const mid = new Map<number, number>();
    const m = (i: number, j: number): number => {
      const key = i < j ? i * 1048576 + j : j * 1048576 + i;
      let k = mid.get(key);
      if (k === undefined) {
        k = px.length;
        px.push((px[i] + px[j]) / 2);
        pt.push((pt[i] + pt[j]) / 2);
        mid.set(key, k);
      }
      return k;
    };
    const next: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const ab = m(a, b);
      const bc = m(b, c);
      const ca = m(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    idx = next;
  }
  const pos = new Float32Array(px.length * 3);
  const uv = new Float32Array(px.length * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < px.length; i++) {
    f.point(px[i], pt[i] / THETA_M, o.inset ?? 0, v);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    uv[i * 2] = px[i];
    uv[i * 2 + 1] = pt[i];
  }
  // CCW in (x, theta) is an inward face (an outward face is clockwise, see loftSkin).
  if (!o.inward) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Outward offset of a convex-ish polygon in parameter space by d metres (theta scaled). */
export function offsetPoly(p: SkinPoly, d: number): [number, number][] {
  const n = p.length;
  const ccw = signedArea(p) > 0 ? 1 : -1;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [px, pt] = p[(i + n - 1) % n];
    const [cx, ct] = p[i];
    const [nx, nt] = p[(i + 1) % n];
    // Edge normals (outward) in scaled space.
    const e1 = new THREE.Vector2(cx - px, (ct - pt) * THETA_M).normalize();
    const e2 = new THREE.Vector2(nx - cx, (nt - ct) * THETA_M).normalize();
    const n1 = new THREE.Vector2(e1.y, -e1.x).multiplyScalar(ccw);
    const n2 = new THREE.Vector2(e2.y, -e2.x).multiplyScalar(ccw);
    const m = n1.clone().add(n2).normalize();
    const k = d / Math.max(0.3, m.dot(n1));
    out.push([cx + m.x * k, ct + (m.y * k) / THETA_M]);
  }
  return out;
}

/** Mirror a right-side polygon to the left side (theta -> -theta). */
export function mirrorPoly(p: SkinPoly): [number, number][] {
  return p.map(([x, t]) => [x, -t] as [number, number]).reverse();
}

/** Body x on the skin at angle theta where the skin height is z (bisection; the nose crown rises going aft). */
export function xAtZ(theta: number, z: number, f: B738Fuselage = B738_FUSELAGE): number {
  let lo = 12.0;
  let hi = 16.6;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (f.bodyYZ(m, theta)[1] < z) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Parameter-space point of body (x, z) on the right side. */
function pxz(x: number, z: number): [number, number] {
  return [x, B738_FUSELAGE.thetaAt(x, z)];
}

/** Windshield (No. 1) sill and header heights (dossier §10.0: sill ~0.1 m below the eye; header EST ~0.37 m above). */
export const WS_SILL_Z = -0.335;
export const WS_HEADER_Z = -0.7;
/** Centre post half-angle and the outboard edge angles (bottom / top) of the No. 1 windshield (EST). */
const WS_POST = 0.022;
const WS_OUT_BOT = 1.0;
const WS_OUT_TOP = 0.97;

function windshield(): [number, number][] {
  const out: [number, number][] = [];
  const n = 8;
  // Sill (V-shaped in plan: the outboard corners sit further aft), then the header back inboard.
  for (let i = 0; i <= n; i++) {
    const t = WS_POST + ((WS_OUT_BOT - WS_POST) * i) / n;
    out.push([xAtZ(t, WS_SILL_Z), t]);
  }
  for (let i = 0; i <= n; i++) {
    const t = WS_OUT_TOP + ((WS_POST - WS_OUT_TOP) * i) / n;
    out.push([xAtZ(t, WS_HEADER_Z), t]);
  }
  return out;
}

/**
 * Flight-deck windows, right side, in (x, theta). EST from 737NG photographs:
 * No. 1 (forward windshield either side of the centre post, sill level and
 * V-shaped in plan), No. 2 (opening side window, forward edge parallel to
 * the corner post, top edge sloping down aft) and No. 3 (aft side window).
 * The late-NG deck has no eyebrow (No. 4/5) windows (dossier §10.0).
 */
export const B738_WINDOWS: Record<'w1' | 'w2' | 'w3', SkinPoly> = {
  w1: windshield(),
  w2: [pxz(14.4, -0.24), pxz(13.63, -0.13), pxz(13.63, -0.69), pxz(14.08, -0.72)],
  w3: [pxz(13.53, -0.12), pxz(13.12, -0.1), pxz(13.12, -0.65), pxz(13.53, -0.68)],
};
