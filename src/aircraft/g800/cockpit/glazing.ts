/**
 * G800 flight-deck glazing geometry shared by the cockpit shell and the
 * exterior: which parts of the fuselage skin are windows (windshield, DV
 * side window, aft side window; layout.ts GLAZING), a carved skin loft
 * (solid parts or glass parts only), and the window-frame centre lines for
 * the interior frames.
 *
 * All window regions are defined in side-view terms (body x, z) plus the
 * centre post (|y|), so the same test serves the interior shell (inset) and
 * the exterior skin. Setup-time code only (allocates freely).
 */
import * as THREE from 'three';
import { bodyToLocal } from '../../../cockpit/frame';
import { G800_FUSELAGE as F, GLAZING as G, aPillarX, edgeX } from './layout';

export type GlassKind = 0 | 1 | 2 | 3; // none, windshield, forward side window, aft side window

/** Half-width of the section at body x, height z, inset inward by `inset` (0 outside the section). */
export function halfWidth(x: number, z: number, inset = 0): number {
  const s = F.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const d = (z - s.cz) / rz;
  return d >= 1 || d <= -1 ? 0 : ry * Math.sqrt(1 - d * d);
}

/** Skin height (body z, upper surface) at body (x, y), inset inward. */
export function topZ(x: number, y: number, inset = 0): number {
  const s = F.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const q = Math.min(1, Math.abs(y) / ry);
  return s.cz - rz * Math.sqrt(1 - q * q);
}

function roundedQuad(x: number, z: number, roof: number, sill: number, aft: (z: number) => number, fwd: (z: number) => number, r: number): boolean {
  if (z < roof || z > sill) return false;
  if (x < aft(z) || x > fwd(z)) return false;
  const zc = Math.max(roof + r, Math.min(sill - r, z));
  const xa = aft(zc) + r;
  const xf = fwd(zc) - r;
  const xc = Math.max(xa, Math.min(xf, x));
  return Math.hypot(x - xc, z - zc) <= r;
}

const fs = G.fwdSide;
const as = G.aftSide;
const fwdSideAft = (z: number) => edgeX(z, fs.sillZ, fs.roofZ, fs.aftBase, fs.aftTop);
const fwdSideFwd = (z: number) => aPillarX(z) - G.aPillar.width;
const aftSideAft = (z: number) => edgeX(z, as.sillZ, as.roofZ, as.aftBase, as.aftTop);
const aftSideFwd = (z: number) => edgeX(z, as.sillZ, as.roofZ, as.fwdBase, as.fwdTop);

/** Window region at body (x, y, z). */
export function glassAt(x: number, y: number, z: number): GlassKind {
  if (z <= G.baseZ && z >= G.headerZ && x >= aPillarX(z) && Math.abs(y) >= G.postHalf) return 1;
  if (roundedQuad(x, z, fs.roofZ, fs.sillZ, fwdSideAft, fwdSideFwd, fs.corner)) return 2;
  if (roundedQuad(x, z, as.roofZ, as.sillZ, aftSideAft, aftSideFwd, as.corner)) return 3;
  return 0;
}

/**
 * Signed window function at body (x, y, z): negative inside a window (glass), positive on the solid skin,
 * roughly the distance to the nearest window edge in metres (continuous, so window edges can be cut exactly).
 */
export function glassField(x: number, y: number, z: number): number {
  // Windshield: intersection of four half-spaces.
  const ws = Math.max(z - G.baseZ, G.headerZ - z, aPillarX(z) - x, G.postHalf - Math.abs(y));
  return Math.min(ws, roundedQuadField(x, z, fs.roofZ, fs.sillZ, fwdSideAft, fwdSideFwd, fs.corner), roundedQuadField(x, z, as.roofZ, as.sillZ, aftSideAft, aftSideFwd, as.corner));
}

function roundedQuadField(x: number, z: number, roof: number, sill: number, aft: (z: number) => number, fwd: (z: number) => number, r: number): number {
  const zc = Math.max(roof + r, Math.min(sill - r, z));
  const dx = Math.max(aft(zc) + r - x, x - (fwd(zc) - r));
  const dz = Math.max(roof + r - z, z - (sill - r));
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return outside + Math.min(Math.max(dx, dz), 0) - r;
}

/**
 * Skin loft between body x0 (aft) and x1 (fwd), full circumference, keeping either the solid skin or only
 * the glass. Cells crossing a window edge are cut along the edge (marching triangles on glassField), so the
 * openings have smooth outlines. Cockpit-local, non-indexed. `inward`: faces point into the fuselage.
 */
export function carvedSkin(x0: number, x1: number, o: { inset: number; keep: 'solid' | 'glass'; inward?: boolean; dx?: number; segT?: number }): THREE.BufferGeometry {
  const segX = Math.max(2, Math.ceil((x1 - x0) / (o.dx ?? 0.02)));
  const segT = o.segT ?? 360;
  const sign = o.keep === 'solid' ? 1 : -1;
  const row = segT + 1;
  const px: number[] = [];
  const pt: number[] = [];
  const pf: number[] = [];
  for (let i = 0; i <= segX; i++) {
    const x = x0 + ((x1 - x0) * i) / segX;
    const s = F.at(x);
    const ry = Math.max(0.001, s.ry - o.inset);
    const rz = Math.max(0.001, s.rz - o.inset);
    for (let j = 0; j <= segT; j++) {
      const th = -Math.PI + (2 * Math.PI * j) / segT;
      px.push(x);
      pt.push(th);
      pf.push(sign * glassField(x, ry * Math.sin(th), s.cz - rz * Math.cos(th)));
    }
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ns = o.inward ? -1 : 1;
  const emit = (x: number, th: number) => {
    F.point(x, th, o.inset, v);
    pos.push(v.x, v.y, v.z);
    uv.push(x, th);
    // Analytic section normal (ellipse gradient; body (0, sin/ry, -cos/rz) -> local (y, -z, -x)), smooth shading.
    const sc = F.at(x);
    n.set(Math.sin(th) / Math.max(0.01, sc.ry), Math.cos(th) / Math.max(0.01, sc.rz), 0).normalize().multiplyScalar(ns);
    nrm.push(n.x, n.y, n.z);
  };
  // Keeps the part of triangle (a, b, c) (vertex indices, outward winding) where the field is > 0.
  const tri = (a: number, b: number, c: number) => {
    const ids = o.inward ? [a, c, b] : [a, b, c];
    const f = ids.map((k) => pf[k]);
    const inside = f.map((q) => q > 0);
    const cnt = inside.filter(Boolean).length;
    if (cnt === 0) return;
    if (cnt === 3) {
      for (const k of ids) emit(px[k], pt[k]);
      return;
    }
    const cut = (p: number, q: number): [number, number] => {
      const t = pf[p] / (pf[p] - pf[q]);
      return [px[p] + (px[q] - px[p]) * t, pt[p] + (pt[q] - pt[p]) * t];
    };
    // Rotate so the odd vertex (alone on its side) is first, keeping the winding.
    let k = 0;
    for (let m = 0; m < 3; m++) if (inside[m] !== inside[(m + 1) % 3] && inside[m] !== inside[(m + 2) % 3]) k = m;
    const A = ids[k];
    const B = ids[(k + 1) % 3];
    const C = ids[(k + 2) % 3];
    const ab = cut(A, B);
    const ac = cut(A, C);
    if (cnt === 1) {
      // Only A kept.
      emit(px[A], pt[A]);
      emit(ab[0], ab[1]);
      emit(ac[0], ac[1]);
    } else {
      // A dropped: quad ab, B, C, ac.
      emit(ab[0], ab[1]);
      emit(px[B], pt[B]);
      emit(px[C], pt[C]);
      emit(ab[0], ab[1]);
      emit(px[C], pt[C]);
      emit(ac[0], ac[1]);
    }
  };
  for (let i = 0; i < segX; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * row + j;
      const b = a + row;
      // Outward winding (loft.ts convention): (a, a+1, b) and (b, a+1, b+1).
      tri(a, a + 1, b);
      tri(b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// ---------------------------------------------------------------- frame centre lines (cockpit-local points)

/** Surface point at body (x, z) on `side` (-1 left, +1 right), inset inward. */
function sidePoint(x: number, z: number, side: number, inset: number): THREE.Vector3 {
  return bodyToLocal(x, side * halfWidth(x, z, inset), z, new THREE.Vector3());
}

/** x at which the section half-width at height z equals |y| (searching forward from xFrom). */
function xForHalfWidth(y: number, z: number, xFrom: number, inset: number): number {
  let lo = xFrom;
  let hi = 15.5;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (halfWidth(m, z, inset) > y) lo = m;
    else hi = m;
  }
  return lo;
}

/** Points along a horizontal edge (constant z) from the A-pillar to the centre post, on `side`. */
function windshieldEdge(z: number, side: number, inset: number, n = 18): THREE.Vector3[] {
  const xa = aPillarX(z);
  const y0 = halfWidth(xa, z, inset);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + (G.postHalf - y0) * (i / n);
    const x = i === 0 ? xa : xForHalfWidth(y, z, xa, inset);
    out.push(bodyToLocal(x, side * y, z, new THREE.Vector3()));
  }
  return out;
}

/** Rounded-quad outline in (x, z), mapped to the surface on `side`. */
function sideWindowOutline(roof: number, sill: number, aft: (z: number) => number, fwd: (z: number) => number, r: number, side: number, inset: number): THREE.Vector3[] {
  const pts: [number, number][] = [];
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    for (let k = 0; k <= 5; k++) {
      const a = a0 + ((a1 - a0) * k) / 5;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };
  // Angles in the (x, z) plane: 0 = +x (forward), pi/2 = +z (down).
  const zt = roof + r;
  const zb = sill - r;
  arc(fwd(zt) - r, zt, -Math.PI / 2, 0); // forward-top corner
  arc(fwd(zb) - r, zb, 0, Math.PI / 2); // forward-bottom
  arc(aft(zb) + r, zb, Math.PI / 2, Math.PI); // aft-bottom
  arc(aft(zt) + r, zt, Math.PI, 1.5 * Math.PI); // aft-top
  pts.push(pts[0]);
  return pts.map(([x, z]) => sidePoint(x, z, side, inset));
}

export interface FrameLines {
  /** Heavier members: A-pillars. */
  pillars: THREE.Vector3[][];
  /** Centre post. */
  post: THREE.Vector3[][];
  /** Windshield base / header edges and side-window outlines. */
  edges: THREE.Vector3[][];
}

export function frameLines(inset: number): FrameLines {
  const pillars: THREE.Vector3[][] = [];
  const edges: THREE.Vector3[][] = [];
  const post: THREE.Vector3[][] = [];
  for (const side of [-1, 1]) {
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const z = G.baseZ + (G.headerZ - G.baseZ) * (i / 12);
      p.push(sidePoint(aPillarX(z) - G.aPillar.width / 2, z, side, inset));
    }
    pillars.push(p);
    edges.push(windshieldEdge(G.baseZ, side, inset));
    edges.push(windshieldEdge(G.headerZ, side, inset));
    edges.push(sideWindowOutline(fs.roofZ, fs.sillZ, fwdSideAft, fwdSideFwd, fs.corner, side, inset));
    edges.push(sideWindowOutline(as.roofZ, as.sillZ, aftSideAft, aftSideFwd, as.corner, side, inset));
  }
  // Centre post: along the top of the nose between the header and base crossings.
  const xh = xForHalfWidth(0.0001, G.headerZ, 12.5, inset);
  const xb = xForHalfWidth(0.0001, G.baseZ, 12.5, inset);
  const c: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = xh + (xb - xh) * (i / 10);
    c.push(bodyToLocal(x, 0, topZ(x, 0, inset), new THREE.Vector3()));
  }
  post.push(c);
  return { pillars, post, edges };
}
