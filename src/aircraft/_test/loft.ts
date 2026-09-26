/**
 * Geometry helpers for procedural airframes (body axes x fwd, y right,
 * z down, mapped to the aircraft object's local axes x right, y up, z aft).
 *
 * `FuselageProfile` describes elliptical cross-sections along body x
 * (centre height `cz`, half-width `ry`, half-height `rz`), linearly
 * interpolated between stations. `loftFuselage` builds a closed or partial
 * (angular range) skin; `loftWing` builds a tapered, swept, dihedral wing
 * from airfoil sections.
 */
import * as THREE from 'three';

export interface FuselageStation {
  x: number;
  cz: number;
  ry: number;
  rz: number;
}

export class FuselageProfile {
  constructor(readonly stations: FuselageStation[]) {
    // Sorted from nose (max x) to tail (min x) for lookup.
    this.stations.sort((a, b) => b.x - a.x);
  }

  at(x: number, out: FuselageStation = { x: 0, cz: 0, ry: 0, rz: 0 }): FuselageStation {
    const s = this.stations;
    out.x = x;
    if (x >= s[0].x) return Object.assign(out, s[0], { x });
    if (x <= s[s.length - 1].x) return Object.assign(out, s[s.length - 1], { x });
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (x <= a.x && x >= b.x) {
        const t = (a.x - x) / Math.max(1e-9, a.x - b.x);
        // Smooth (cosine) blend keeps the skin free of creases between stations.
        const k = (1 - Math.cos(Math.PI * t)) / 2;
        out.cz = a.cz + (b.cz - a.cz) * k;
        out.ry = a.ry + (b.ry - a.ry) * k;
        out.rz = a.rz + (b.rz - a.rz) * k;
        return out;
      }
    }
    return out;
  }

  /** Body point on the section at `x` for angle `theta` (rad, 0 = top, +pi/2 = right side, pi = bottom), inset inward by `inset` m. */
  point(x: number, theta: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.at(x);
    const ry = Math.max(0.001, s.ry - inset);
    const rz = Math.max(0.001, s.rz - inset);
    // Body -> local: (y, -z, -x)
    const by = ry * Math.sin(theta);
    const bz = s.cz - rz * Math.cos(theta);
    return out.set(by, -bz, -x);
  }
}

/**
 * Skin between body x0 (aft) and x1 (fwd) over the angular range
 * [theta0, theta1] (rad). `inward` flips the winding so the surface faces
 * the inside (cockpit shell seen from within).
 */
export function loftFuselage(p: FuselageProfile, x0: number, x1: number, theta0: number, theta1: number, segX: number, segT: number, opts: { inset?: number; inward?: boolean } = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= segX; i++) {
    const x = x0 + ((x1 - x0) * i) / segX;
    for (let j = 0; j <= segT; j++) {
      const th = theta0 + ((theta1 - theta0) * j) / segT;
      p.point(x, th, opts.inset ?? 0, v);
      pos.push(v.x, v.y, v.z);
      uv.push(i / segX, j / segT);
    }
  }
  const row = segT + 1;
  for (let i = 0; i < segX; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * row + j;
      const b = a + row;
      // (b - a) points forward (-z local) and (a+1 - a) toward increasing theta, so (a, a+1, b) winds
      // counter-clockwise seen from outside the section: outward-facing skin.
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

/** Symmetric NACA 4-digit thickness distribution (NACA Report 824), closed trailing edge. */
export function nacaThickness(xc: number, t: number): number {
  return 5 * t * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc * xc * xc - 0.1036 * xc * xc * xc * xc);
}

export interface WingSection {
  /** Spanwise station (body y, m, >= 0 for the right wing). */
  y: number;
  /** Leading-edge body x and chord (m). */
  xLe: number;
  chord: number;
  /** Chord-line height (body z, m). */
  z: number;
  /** Thickness ratio. */
  t: number;
  /** Nose-up twist (deg). */
  twistDeg?: number;
}

/**
 * Lofts a wing/tail surface through airfoil sections (right side; `mirror`
 * builds the left one). `chordRange` [c0, c1] trims the chordwise extent
 * (0 = LE, 1 = TE), used for movable surfaces. `vertical` builds a fin
 * (span along -z instead of +y).
 */
export function loftWing(sections: WingSection[], opts: { mirror?: boolean; chordRange?: [number, number]; n?: number; vertical?: boolean } = {}): THREE.BufferGeometry {
  const n = opts.n ?? 14;
  const [c0, c1] = opts.chordRange ?? [0, 1];
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = 2 * n;
  const sgn = opts.mirror ? -1 : 1;
  for (const s of sections) {
    const tw = ((s.twistDeg ?? 0) * Math.PI) / 180;
    for (let k = 0; k < ring; k++) {
      // Upper surface TE->LE then lower surface LE->TE (cosine spacing).
      const upper = k < n;
      const j = upper ? n - 1 - k : k - n;
      const f = (1 - Math.cos((Math.PI * j) / (n - 1))) / 2;
      const xc = c0 + (c1 - c0) * f;
      const half = nacaThickness(Math.max(0, Math.min(1, xc)), s.t) * s.chord;
      const dx = -xc * s.chord; // body x decreases toward the TE
      const dz = (upper ? -1 : 1) * half; // body z down
      const rx = dx * Math.cos(tw) - dz * Math.sin(tw);
      const rz = dx * Math.sin(tw) + dz * Math.cos(tw);
      const bx = s.xLe + rx;
      if (opts.vertical) {
        // Fin: span along -z (up), thickness along y.
        const by = rz; // thickness side to side
        const bz = s.z - s.y; // s.y = height above the root
        pos.push(by, -bz, -bx);
      } else {
        const by = sgn * s.y;
        const bz = s.z + rz;
        pos.push(by, -bz, -bx);
      }
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k;
      const b = i * ring + ((k + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      if ((opts.mirror ? 1 : 0) ^ (opts.vertical ? 1 : 0)) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  // Tip cap (fan).
  const last = (sections.length - 1) * ring;
  for (let k = 1; k < ring - 1; k++) {
    if ((opts.mirror ? 1 : 0) ^ (opts.vertical ? 1 : 0)) idx.push(last, last + k + 1, last + k);
    else idx.push(last, last + k, last + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
