/**
 * Panels, bezels, fasteners and display surfaces.
 *
 * Panels are plates whose front face is the plane z = 0 (they extend to
 * z = -thickness), with rounded corners, a rolled bevel on every edge
 * (including cutout edges) and optional fasteners. Panel UVs are in metres.
 *
 * Instrument sizes: ARINC 408 / "ATI" round instrument cases, 3 1/8 in
 * (3ATI, 79.4 mm) and 2 1/4 in (2ATI, 57.2 mm) panel holes (ARINC 408A).
 * The square mounting-screw pattern (3.5 in / 88.9 mm diagonal pitch for
 * 3ATI) is EST from instrument installation drawings.
 */
import * as THREE from 'three';
import { circlePath, extrude, merge, revolve, roundedRectPath, roundedRectShape } from './primitives';

export const ATI3_HOLE = 0.0794; // 3 1/8 in
export const ATI2_HOLE = 0.0572; // 2 1/4 in

export type Cutout =
  | { shape: 'rect'; u: number; v: number; w: number; h: number; r?: number }
  | { shape: 'circle'; u: number; v: number; d: number };

export interface PanelGeometryOptions {
  width: number;
  height: number;
  /** Plate thickness (default 3.2 mm, 1/8 in panel). */
  thickness?: number;
  /** Corner radius (default 4 mm). */
  radius?: number;
  /** Edge bevel/round-over (default 1 mm). */
  bevel?: number;
  /** Cutouts in panel coordinates (centre-origin, metres). */
  cutouts?: Cutout[];
}

/** Panel plate geometry, centred at the origin, front face at z = 0. */
export function panelGeometry(o: PanelGeometryOptions): THREE.BufferGeometry {
  const t = o.thickness ?? 0.0032;
  const bevel = Math.min(o.bevel ?? 0.001, t * 0.45);
  const s = roundedRectShape(o.width, o.height, o.radius ?? 0.004);
  for (const c of o.cutouts ?? []) {
    if (c.shape === 'circle') s.holes.push(circlePath(c.d / 2, c.u, c.v, 64));
    else s.holes.push(roundedRectPath(c.w, c.h, c.r ?? 0.0015, c.u, c.v));
  }
  return extrude(s, { depth: t, bevel, bevelSegments: 2, curveSegments: 10, anchor: 'front0' });
}

export type ScrewKind = 'phillips' | 'slot' | 'hex' | 'dzus';

/**
 * Screw head geometry standing on z = 0 with groups for multi-material:
 * group 0 = side (plain metal), group 1 = top (recess texture).
 * The bottom cap is dropped (it sits flush against the panel, never visible),
 * so every panel's screw instanced mesh renders in 2 draws instead of 3
 * (fix round 1: merge static geometry to stay inside the draw-call budgets).
 */
export function screwHeadGeometry(kind: ScrewKind, diameter: number): THREE.BufferGeometry {
  const r = diameter / 2;
  const h = kind === 'dzus' ? r * 0.45 : r * 0.38;
  // Slightly domed top via a two-step cylinder is not needed at this size; the
  // normal map on the top cap provides the dome and recess shading.
  const g = new THREE.CylinderGeometry(kind === 'dzus' ? r * 0.92 : r * 0.9, r, h, kind === 'hex' ? 6 : 20, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, h / 2);
  // Keep groups 0 (side) and 1 (top cap); drop group 2 (bottom cap, hidden in the panel).
  const idx = g.getIndex();
  if (idx && g.groups.length >= 3) {
    const [side, top] = g.groups;
    const keep: number[] = [];
    for (const gr of [side, top]) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx.getX(i));
    g.setIndex(keep);
    g.clearGroups();
    g.addGroup(0, side.count, 0);
    g.addGroup(side.count, top.count, 1);
  }
  return g;
}

/**
 * Fastener positions around a panel edge: corners plus evenly spaced
 * intermediate screws when a side is longer than `maxPitch`.
 */
export function screwPattern(width: number, height: number, inset: number, maxPitch = 0.2): [number, number][] {
  const out: [number, number][] = [];
  const x0 = -width / 2 + inset;
  const x1 = width / 2 - inset;
  const y0 = -height / 2 + inset;
  const y1 = height / 2 - inset;
  const nx = Math.max(1, Math.ceil((x1 - x0) / maxPitch));
  const ny = Math.max(1, Math.ceil((y1 - y0) / maxPitch));
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    out.push([x, y0], [x, y1]);
  }
  for (let j = 1; j < ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    out.push([x0, y], [x1, y]);
  }
  return out;
}

/**
 * Instanced screw heads (one draw call per panel). Random-ish rotation per
 * screw makes the recesses look real.
 */
export function screwInstances(
  positions: [number, number][],
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[],
  seed = 1,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, materials, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  let x = seed * 9301 + 49297;
  positions.forEach(([u, v], i) => {
    x = (x * 9301 + 49297) % 233280;
    e.set(0, 0, (x / 233280) * Math.PI);
    q.setFromEuler(e);
    p.set(u, v, 0);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'screws';
  return mesh;
}

/**
 * Round instrument bezel (ring standing on z = 0 around a hole of `holeD`),
 * with a rolled lip. Returns ring geometry; the glass is separate.
 */
export function roundBezelGeometry(holeD: number, width = 0.004, height = 0.0035): THREE.BufferGeometry {
  const ri = holeD / 2 - 0.0005;
  const ro = holeD / 2 + width;
  return revolve(
    [
      [ri, -0.004],
      [ri, height * 0.7],
      [ri + width * 0.15, height],
      [ri + width * 0.45, height],
      [ro - width * 0.2, height * 0.8],
      [ro, height * 0.3],
      [ro, 0],
      [ro * 0.98, 0],
    ],
    64,
  );
}

/** Square instrument flange (3ATI style) with a round hole, standing on z = 0. */
export function squareFlangeGeometry(size: number, holeD: number, thickness = 0.0015, radius = 0.004): THREE.BufferGeometry {
  const s = roundedRectShape(size, size, radius);
  s.holes.push(circlePath(holeD / 2, 0, 0, 64));
  return extrude(s, { depth: thickness, bevel: thickness * 0.35, bevelSegments: 2, curveSegments: 8 });
}

/**
 * Rectangular display / instrument bezel frame around a w x h opening,
 * standing on z = 0 (face at z = depth). Rounded outer and inner corners,
 * rolled edges.
 */
export function rectBezelGeometry(w: number, h: number, border: number | [number, number, number, number], depth = 0.006, outerR = 0.006, innerR = 0.002): THREE.BufferGeometry {
  const [bl, br, bt, bb] = typeof border === 'number' ? [border, border, border, border] : border;
  const W = w + bl + br;
  const H = h + bt + bb;
  const cx = (br - bl) / 2;
  const cy = (bt - bb) / 2;
  const s = roundedRectShape(W, H, outerR, cx, cy);
  s.holes.push(roundedRectPath(w, h, innerR, 0, 0));
  return extrude(s, { depth, bevel: Math.min(depth * 0.25, 0.0015), bevelSegments: 3, curveSegments: 8 });
}

/** Glass disc / plate for instrument faces (use materials.displayGlass()). */
export function glassDiscGeometry(d: number): THREE.BufferGeometry {
  return new THREE.CircleGeometry(d / 2, 48);
}

/**
 * Display screen plane (w x h) facing +Z with standard UVs (v = 1 at the top),
 * for DisplayManager. The canvas maps edge to edge.
 */
export function displayScreenGeometry(w: number, h: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, h);
}

/**
 * Recessed cavity behind a cutout: an open box (4 walls + back) from z = 0
 * down to z = -depth, inner size w x h. Seen through panel gaps and around
 * recessed displays.
 */
export function recessGeometry(w: number, h: number, depth: number, wall = 0.001): THREE.BufferGeometry {
  const ring = roundedRectShape(w + wall * 2, h + wall * 2, 0.0015);
  ring.holes.push(roundedRectPath(w, h, 0.001));
  const walls = extrude(ring, { depth, anchor: 'front0' });
  const back = extrude(roundedRectShape(w + wall * 2, h + wall * 2, 0.0015), { depth: wall, anchor: 'front0' });
  back.translate(0, 0, -depth);
  const out = merge([walls, back]);
  walls.dispose();
  back.dispose();
  return out;
}
