/**
 * Panel plates and the glareshield hood fitted to the cockpit lining
 * (M2-L12: "the black glareshield sweeps in a continuous arc (deeper at the
 * centre) into the side-window posts, and the panel edges meet the sidewalls",
 * S&D21 Fig 3 / S&D15 Fig III / Skies 2017 photographs).
 *
 * The outboard edges follow the interior half-width of the fuselage section
 * (`M2_FUSELAGE.halfWidth(x, z, lining inset)`) at each height of the panel
 * face, so the plates close against the lining instead of stopping short or
 * poking through it. Static geometry (merged by the builder).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { MaterialName } from '../../../cockpit/materials';
import { extrude } from '../../../cockpit/geometry/primitives';
import { M2_FUSELAGE, WS_BASE_X } from '../exterior';
import { downFace } from './layout';

/** Lining inset from the outer skin (m), as shell.ts. */
export const LINING = 0.045;

export interface FaceSpec {
  /** Body x / z of the panel face's top edge, tilt (top leaning forward, deg), face height (m). */
  topX: number;
  topZ: number;
  tiltDeg: number;
  height: number;
  /** Panel width (m): the plate's coordinate frame (u = y body). */
  width: number;
}

/** Top-edge body point of a panel given its centre / tilt / height (as CockpitBuilder places 'aft' panels). */
export function topEdge(center: [number, number, number], tiltDeg: number, height: number): [number, number] {
  const t = (tiltDeg * Math.PI) / 180;
  return [center[0] + (height / 2) * Math.sin(t), center[2] - (height / 2) * Math.cos(t)];
}

/** Interior half-width at face depth d (m down the face). */
export function faceHalfWidth(f: FaceSpec, d: number, margin = 0.004): number {
  const [x, z] = downFace(f.topX, f.topZ, f.tiltDeg, d);
  return Math.max(0.05, M2_FUSELAGE.halfWidth(x, z, LINING) - margin);
}

/**
 * Plate for an (invisible) aft-facing panel whose outboard edges follow the lining. `y0` / `y1` limit the
 * span (body y, e.g. a tilt panel ending at the pedestal); `centerY` is the panel centre's body y.
 */
export function fittedPlate(b: CockpitBuilder, p: Panel, f: FaceSpec, o: { centerY?: number; y0?: number; y1?: number; material?: MaterialName | THREE.Material; name: string; thickness?: number; maxHalf?: number }): THREE.Mesh {
  const cy = o.centerY ?? 0;
  const n = 10;
  const right: [number, number][] = [];
  const left: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const d = (f.height * k) / n;
    const hw = Math.min(o.maxHalf ?? 1, faceHalfWidth(f, d));
    const v = f.height / 2 - d;
    const yr = Math.min(hw, o.y1 ?? hw);
    const yl = Math.max(-hw, o.y0 ?? -hw);
    right.push([yr - cy, v]);
    left.push([yl - cy, v]);
  }
  const s = new THREE.Shape();
  s.moveTo(left[0][0], left[0][1]);
  for (const [u, v] of right) s.lineTo(u, v);
  for (let k = left.length - 1; k >= 0; k--) s.lineTo(left[k][0], left[k][1]);
  const g = extrude(s, { depth: o.thickness ?? 0.0032, bevel: 0.001, bevelSegments: 1, curveSegments: 2, anchor: 'front0' });
  b.trackGeometry(g);
  const mat = o.material ?? 'panel';
  const m = new THREE.Mesh(g, typeof mat === 'string' ? b.env.materials.get(mat) : mat);
  m.name = `panelPlate:${o.name}`;
  m.userData.cockpitStatic = true;
  p.addObject(m, f.width / 2, f.height / 2, { z: 0 });
  return m;
}

/**
 * Glareshield hood: top surface from the brow (a plan-view arc, deepest at the centre) forward to the
 * windshield base, drooping toward the windshield, plus the brow lip; every point clamped to the lining so
 * the hood runs into the side-window posts. Cockpit-local geometry (x right, y up, z aft) in body metres.
 */
export function hoodGeometry(o: { browX: number; browZ: number; halfSpan: number; arc: number; lip: number; slopeDeg: number }): THREE.BufferGeometry {
  const NU = 28;
  const NV = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  const t = Math.tan((o.slopeDeg * Math.PI) / 180);
  const xf = WS_BASE_X + 0.02;
  const hoodZ = (x: number) => o.browZ + (x - o.browX) * t; // body z (down +): droops forward
  const clampY = (x: number, z: number, y: number) => {
    const hw = Math.max(0, M2_FUSELAGE.halfWidth(x, z, LINING) - 0.002);
    return Math.sign(y) * Math.min(Math.abs(y), hw);
  };
  const push = (x: number, y: number, z: number) => pos.push(y, -z, -x);
  // Rows: v = 0 lip bottom, 1 brow top, 2.. top surface to the windshield.
  const rows = NV + 2;
  for (let i = 0; i <= NU; i++) {
    const y = -o.halfSpan + (2 * o.halfSpan * i) / NU;
    const xa = o.browX + o.arc * (y / o.halfSpan) ** 2;
    // Lip bottom and top (vertical face of the brow, facing aft).
    const zTop = hoodZ(xa);
    push(xa, clampY(xa, zTop + o.lip, y), zTop + o.lip);
    push(xa, clampY(xa, zTop, y), zTop);
    for (let j = 1; j <= NV; j++) {
      const x = xa + ((xf - xa) * j) / NV;
      const z = hoodZ(x);
      push(x, clampY(x, z, y), z);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b2 = (i + 1) * rows + j;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
