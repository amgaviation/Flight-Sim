/**
 * Low-level procedural geometry used by every cockpit part.
 *
 * Convention (panel frame): X right, Y up, Z out of the surface toward the
 * viewer; parts are built standing on the plane z = 0 unless noted.
 * Dimensions are metres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Rounded rectangle outline centred at (cx, cy). */
export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  traceRoundedRect(s, w, h, r, cx, cy);
  return s;
}

/** Rounded rectangle as a hole path. */
export function roundedRectPath(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Path {
  const p = new THREE.Path();
  traceRoundedRect(p, w, h, r, cx, cy);
  return p;
}

function traceRoundedRect(p: THREE.Path, w: number, h: number, r: number, cx: number, cy: number): void {
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6));
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  p.moveTo(x0 + rr, y0);
  p.lineTo(x0 + w - rr, y0);
  if (rr > 0) p.absarc(x0 + w - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  p.lineTo(x0 + w, y0 + h - rr);
  if (rr > 0) p.absarc(x0 + w - rr, y0 + h - rr, rr, 0, Math.PI / 2, false);
  p.lineTo(x0 + rr, y0 + h);
  if (rr > 0) p.absarc(x0 + rr, y0 + h - rr, rr, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + rr);
  if (rr > 0) p.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
}

/** Circle as a hole path. */
export function circlePath(r: number, cx = 0, cy = 0, segments = 48): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(cx + r, cy);
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return p;
}

/** Circle as a shape. */
export function circleShape(r: number, cx = 0, cy = 0, segments = 48): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(cx + r, cy);
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return s;
}

export interface ExtrudeOpts {
  depth: number;
  /** Bevel size (m). 0 = sharp. */
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
  /** Where the front face ends up: 'front0' puts the front (+Z) face at z = 0 (plates); 'back0' puts the back at z = 0 (parts standing on a surface). */
  anchor?: 'front0' | 'back0';
}

/**
 * Extrudes a shape along +Z with an optional rounded bevel. UVs are in shape
 * units (metres), so tiling textures use repeat = cycles per metre.
 */
export function extrude(shape: THREE.Shape | THREE.Shape[], o: ExtrudeOpts): THREE.BufferGeometry {
  const bevel = o.bevel ?? 0;
  const depth = Math.max(1e-5, o.depth - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: o.bevelSegments ?? 3,
    curveSegments: o.curveSegments ?? 12,
  });
  // Extrusion spans z in [-bevel, depth + bevel].
  if ((o.anchor ?? 'back0') === 'front0') g.translate(0, 0, -(depth + bevel));
  else g.translate(0, 0, bevel);
  g.computeVertexNormals();
  return g;
}

/** Rounded box centred at the origin. */
export function roundedBox(w: number, h: number, d: number, r: number, segments = 3): THREE.BufferGeometry {
  const rr = Math.max(1e-5, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6, d / 2 - 1e-6));
  return new RoundedBoxGeometry(w, h, d, segments, rr);
}

/** Rounded box standing on z = 0 (spans z in [0, d]). */
export function roundedBoxOnSurface(w: number, h: number, d: number, r: number, segments = 3): THREE.BufferGeometry {
  const g = roundedBox(w, h, d, r, segments);
  g.translate(0, 0, d / 2);
  return g;
}

/**
 * Surface of revolution about +Z. `profile` = [radius, z] pairs from the base
 * upward. Repeat a point to make a crisp edge. Optional `ridge` modulates the
 * radius around the circumference (flutes, grip ridges) within a z band.
 */
export function revolve(
  profile: [number, number][],
  segments = 32,
  ridge?: {
    count: number;
    /** Fractional radius reduction in the grooves (e.g. 0.06). */
    depth: number;
    zMin: number;
    zMax: number;
    /** 'flute' = rounded grooves between flat lands; 'ridge' = sharp triangular ridges; 'scallop' = round lobes. */
    kind?: 'flute' | 'ridge' | 'scallop';
    /** Blend distance (m) at band edges. */
    blend?: number;
  },
): THREE.BufferGeometry {
  const cols = segments + 1;
  const rows = profile.length;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  // Cumulative profile length for v.
  const len: number[] = [0];
  for (let i = 1; i < rows; i++) len.push(len[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const total = len[rows - 1] || 1;
  const kind = ridge?.kind ?? 'flute';
  for (let i = 0; i < rows; i++) {
    const [r, z] = profile[i];
    let band = 0;
    if (ridge && z >= ridge.zMin && z <= ridge.zMax) {
      const b = ridge.blend ?? 0.0005;
      band = Math.min(1, (z - ridge.zMin) / b, (ridge.zMax - z) / b);
      band = Math.max(0, band);
    }
    for (let j = 0; j < cols; j++) {
      const t = (j / segments) * Math.PI * 2;
      let rr = r;
      if (ridge && band > 0 && r > 0) {
        const ph = (t * ridge.count) / (Math.PI * 2);
        const f = ph - Math.floor(ph); // 0..1 within one ridge period
        let groove: number;
        if (kind === 'ridge') groove = Math.abs(f * 2 - 1); // 0 at crest, 1 at root
        else if (kind === 'scallop') groove = 1 - Math.sin(f * Math.PI);
        else groove = f < 0.55 ? 0 : Math.sin(((f - 0.55) / 0.45) * Math.PI); // flat land + round groove
        rr = r * (1 - ridge.depth * groove * band);
      }
      const k = (i * cols + j) * 3;
      pos[k] = Math.sin(t) * rr;
      pos[k + 1] = Math.cos(t) * rr;
      pos[k + 2] = z;
      const q = (i * cols + j) * 2;
      uv[q] = j / segments;
      uv[q + 1] = len[i] / total;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Seam: average normals of the duplicated first/last columns.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rows; i++) {
    const a = i * cols;
    const b = a + segments;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Cylinder along +Z from z0 to z1. */
export function cylinderZ(rBottom: number, rTop: number, z0: number, z1: number, segments = 24, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, z1 - z0, segments, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Hexagonal prism (nut) along +Z, `acrossFlats` wide. */
export function hexPrism(acrossFlats: number, z0: number, z1: number, chamfer = 0.15): THREE.BufferGeometry {
  const R = acrossFlats / Math.sqrt(3);
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    if (i === 0) s.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    else s.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  s.closePath();
  const bevel = (z1 - z0) * chamfer;
  const g = extrude(s, { depth: z1 - z0, bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, z0);
  return g;
}

/** Torus in the XY plane (around Z). */
export function torusZ(R: number, r: number, radial = 12, tubular = 32, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(R, r, radial, tubular, arc);
}

/** Tube along a smooth curve through `points`. */
export function tube(points: THREE.Vector3[], radius: number, tubular = 48, radial = 10, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** Sphere. */
export function sphere(r: number, w = 20, h = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h);
}

/**
 * Extrudes a 2D profile (in the section's XY) along a 3D polyline/curve,
 * e.g. window frames and pillars. The profile's X maps to the curve normal,
 * Y to the binormal.
 */
export function sweep(profile: THREE.Shape, points: THREE.Vector3[], steps = 32, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.2);
  const g = new THREE.ExtrudeGeometry(profile, { steps, bevelEnabled: false, extrudePath: curve });
  g.computeVertexNormals();
  return g;
}

/**
 * Merges geometries into one (all converted to non-indexed with position,
 * normal and uv). Inputs are not disposed.
 */
export function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geoms.map(prepareForMerge);
  const out = mergeGeometries(prepared, false);
  for (const p of prepared) p.dispose();
  if (!out) throw new Error('merge: incompatible geometries');
  return out;
}

/** Clone reduced to non-indexed position/normal/uv (for merging). */
export function prepareForMerge(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(c.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
  if (!c.getAttribute('normal')) c.computeVertexNormals();
  if (!c.getAttribute('uv')) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c.getAttribute('position').count * 2), 2));
  c.clearGroups();
  c.morphAttributes = {};
  // Ensure plain Float32 attributes (InterleavedBufferAttribute from some generators).
  for (const name of ['position', 'normal', 'uv']) {
    const a = c.getAttribute(name);
    if (!(a instanceof THREE.BufferAttribute) || !(a.array instanceof Float32Array)) {
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
      c.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
  }
  return c;
}

/** Applies a translation/rotation (Euler XYZ, radians) to a geometry in place and returns it. */
export function transform(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1): THREE.BufferGeometry {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s, s, s));
  g.applyMatrix4(_m);
  return g;
}

/** An invisible hit box mesh (raycast target) centred at (x, y, z). */
export function hitBox(material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.visible = false;
  m.userData.hitBox = true;
  m.name = 'hitbox';
  return m;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
