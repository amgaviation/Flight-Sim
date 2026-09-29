/**
 * G650 flight-deck glazing shared by the cockpit shell and the exterior:
 * a signed window field over the fuselage skin (windshield, forward DV side
 * window, aft side window; layout.ts GLAZING), a skin loft carved along that
 * field (solid skin or glass only, with the window edges cut exactly), and
 * helpers for the interior window frames.
 *
 * Window regions are defined in side-view terms (body x, z) plus the centre
 * post (|y|), so the same test serves the interior shell (inset) and the
 * exterior skin. Setup-time code (allocates freely).
 */
import * as THREE from 'three';
import { G650_FUSELAGE as F, GLAZING as G, aPillarX, edgeX } from './layout';

const fs = G.fwdSide;
const as = G.aftSide;
const fwdSideAft = (z: number) => edgeX(z, fs.sillZ, fs.roofZ, fs.aftBase, fs.aftTop);
const fwdSideFwd = (z: number) => aPillarX(z) - G.aPillar.width;
const aftSideAft = (z: number) => edgeX(z, as.sillZ, as.roofZ, as.aftBase, as.aftTop);
const aftSideFwd = (z: number) => edgeX(z, as.sillZ, as.roofZ, as.fwdBase, as.fwdTop);

/** Signed distance-like field of a rounded quadrilateral in (x, z): negative inside. */
function roundedQuadField(x: number, z: number, roof: number, sill: number, aft: (z: number) => number, fwd: (z: number) => number, r: number): number {
  const zc = Math.max(roof + r, Math.min(sill - r, z));
  const dx = Math.max(aft(zc) + r - x, x - (fwd(zc) - r));
  const dz = Math.max(roof + r - z, z - (sill - r));
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return outside + Math.min(Math.max(dx, dz), 0) - r;
}

/** Windshield field (negative on the glass). */
export function windshieldField(x: number, y: number, z: number): number {
  return Math.max(z - G.baseZ, G.headerZ - z, aPillarX(z) - x, G.postHalf - Math.abs(y));
}

/**
 * Signed window field at body (x, y, z): negative inside a window (glass), positive on the solid skin, roughly
 * the distance to the nearest window edge in metres (continuous, so edges can be cut exactly).
 */
export function glassField(x: number, y: number, z: number): number {
  return Math.min(
    windshieldField(x, y, z),
    roundedQuadField(x, z, fs.roofZ, fs.sillZ, fwdSideAft, fwdSideFwd, fs.corner),
    roundedQuadField(x, z, as.roofZ, as.sillZ, aftSideAft, aftSideFwd, as.corner),
  );
}

/**
 * Skin loft between body x0 (aft) and x1 (fwd), full circumference, keeping the part where
 * `sign * field(x, y, z) > offset` (sign +1 = solid skin, -1 = glass). Triangles crossing the boundary are
 * clipped along the linearly interpolated field, so the openings have smooth outlines. Cockpit-local,
 * non-indexed, analytic section normals. `inward`: faces point into the fuselage.
 */
export function carvedSkin(
  x0: number,
  x1: number,
  o: { inset: number; keep: 'solid' | 'glass'; inward?: boolean; dx?: number; segT?: number; offset?: number; field?: (x: number, y: number, z: number) => number; theta?: [number, number] },
): THREE.BufferGeometry {
  const field = o.field ?? glassField;
  const segX = Math.max(2, Math.ceil((x1 - x0) / (o.dx ?? 0.02)));
  const segT = o.segT ?? 320;
  const [t0, t1] = o.theta ?? [-Math.PI, Math.PI];
  const sign = o.keep === 'solid' ? 1 : -1;
  const off = o.offset ?? 0;
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
      const th = t0 + ((t1 - t0) * j) / segT;
      px.push(x);
      pt.push(th);
      pf.push(sign * field(x, ry * Math.sin(th), s.cz - rz * Math.cos(th)) - off);
    }
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ns = o.inward ? -1 : 1;
  const emit = (x: number, th: number) => {
    F.point(x, th, o.inset, v);
    pos.push(v.x, v.y, v.z);
    uv.push(x, th);
    const sc = F.at(x);
    n.set(Math.sin(th) / Math.max(0.01, sc.ry), Math.cos(th) / Math.max(0.01, sc.rz), 0).normalize().multiplyScalar(ns);
    nrm.push(n.x, n.y, n.z);
  };
  // Clip triangle (a, b, c) (grid indices) to field > 0; fan-triangulate the kept polygon.
  const polyX: number[] = [];
  const polyT: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    const ids = [a, b, c];
    polyX.length = 0;
    polyT.length = 0;
    for (let k = 0; k < 3; k++) {
      const p = ids[k];
      const q = ids[(k + 1) % 3];
      const fp = pf[p];
      const fq = pf[q];
      if (fp > 0) {
        polyX.push(px[p]);
        polyT.push(pt[p]);
      }
      if ((fp > 0) !== (fq > 0)) {
        const t = fp / (fp - fq);
        polyX.push(px[p] + (px[q] - px[p]) * t);
        polyT.push(pt[p] + (pt[q] - pt[p]) * t);
      }
    }
    for (let k = 1; k + 1 < polyX.length; k++) {
      const order = o.inward ? [0, k + 1, k] : [0, k, k + 1];
      for (const m of order) emit(polyX[m], polyT[m]);
    }
  };
  for (let i = 0; i < segX; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * row + j;
      const b = a + row;
      // Outward winding as in loftFuselage: (a, a+1, b), (b, a+1, b+1).
      tri(a, a + 1, b);
      tri(b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Window frame band: the skin strip where 0 < field < width around every window opening (interior trim or the
 * exterior frame seal), carved from the same field.
 */
export function frameBand(x0: number, x1: number, o: { inset: number; width: number; inward?: boolean; dx?: number; segT?: number; theta?: [number, number] }): THREE.BufferGeometry {
  const w = o.width;
  // keep where field > 0 and field < w: max-combine into one field "inside the band" > 0.
  return carvedSkin(x0, x1, {
    inset: o.inset,
    keep: 'solid',
    inward: o.inward,
    dx: o.dx,
    segT: o.segT,
    theta: o.theta,
    field: (x, y, z) => {
      const f = glassField(x, y, z);
      return Math.min(f, w - f);
    },
  });
}
