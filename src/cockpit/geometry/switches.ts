/**
 * Switch hardware: toggle bushings/nuts/handles, rockers, guards and fences.
 *
 * Toggle dimensions: MS24523 (MIL-DTL-3950) toggle actuator height
 * 0.665-0.695 in (~17.3 mm) above the bushing (MS24523-23 data, military-
 * fasteners.com). Bushing 15/32-32 UNS thread (11.9 mm), 9/16 in hex nut:
 * standard MS toggle mounting hardware (EST from catalogue drawings).
 */
import * as THREE from 'three';
import { cylinderZ, extrude, hexPrism, merge, revolve, roundedBox, roundedRectPath, roundedRectShape, transform, tube } from './primitives';

export const TOGGLE_DIMS = {
  bushingR: 0.00595, // 15/32 in thread / 2
  bushingH: 0.0055, // EST: protrusion above the panel including washer and nut
  nutAF: 0.0143, // 9/16 in across flats
  nutH: 0.0024,
  washerR: 0.0085,
  handleLen: 0.0173, // MS24523 actuator height ~0.68 in
  pivotZ: 0.0045, // pivot centre inside the bushing
};

/** Static base of a bat-handle toggle: lock washer with tab, hex nut and threaded bushing. `scale` 1 = MS24523 size. */
export function toggleBaseGeometry(scale = 1): THREE.BufferGeometry {
  const d = TOGGLE_DIMS;
  const washer = cylinderZ(d.washerR * scale, d.washerR * scale, 0, 0.0006 * scale, 32);
  const nut = hexPrism(d.nutAF * scale, 0.0006 * scale, (0.0006 + d.nutH) * scale, 0.2);
  const bushing = revolve(
    [
      [0, (0.0006 + d.nutH) * scale],
      [d.bushingR * scale, (0.0006 + d.nutH) * scale],
      [d.bushingR * scale, (d.bushingH - 0.0006) * scale],
      [d.bushingR * 0.92 * scale, d.bushingH * scale],
      [d.bushingR * 0.92 * scale, d.bushingH * scale],
      [d.bushingR * 0.45 * scale, d.bushingH * scale],
      [d.bushingR * 0.45 * scale, d.bushingH * scale],
      [0, d.bushingH * 0.8 * scale],
    ],
    28,
    // Thread crests suggested by fine ridges around the bushing.
    { count: 40, depth: 0.03, zMin: (0.0008 + d.nutH) * scale, zMax: (d.bushingH - 0.0008) * scale, kind: 'ridge' },
  );
  const g = merge([washer, nut, bushing]);
  washer.dispose();
  nut.dispose();
  bushing.dispose();
  return g;
}

export type ToggleHandleStyle = 'bat' | 'paddle' | 'ball' | 'lever-lock';

/**
 * Toggle handle standing along +Z from its pivot at z = 0 (the control places
 * the pivot at TOGGLE_DIMS.pivotZ inside the bushing). `length` overrides the
 * MS24523 length.
 */
export function toggleHandleGeometry(style: ToggleHandleStyle, scale = 1, length = TOGGLE_DIMS.handleLen): THREE.BufferGeometry {
  const L = length * scale;
  switch (style) {
    case 'bat':
    case 'lever-lock': {
      const g = revolve(
        [
          [0, 0],
          [0.0019 * scale, 0],
          [0.0019 * scale, L * 0.18],
          [0.00135 * scale, L * 0.5],
          [0.00165 * scale, L * 0.72],
          [0.0022 * scale, L * 0.9],
          [0.0021 * scale, L * 0.96],
          [0.0015 * scale, L * 0.995],
          [0, L],
        ],
        24,
      );
      // Flatten the tip into the classic bat: wide across, thin in the throw direction.
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const k = THREE.MathUtils.smoothstep(z, L * 0.45, L * 0.8);
        p.setX(i, p.getX(i) * (1 + 0.28 * k));
        p.setY(i, p.getY(i) * (1 - 0.3 * k));
      }
      g.computeVertexNormals();
      return g;
    }
    case 'paddle': {
      const stem = cylinderZ(0.0017 * scale, 0.0015 * scale, 0, L * 0.45, 16);
      const blade = roundedBox(0.0068 * scale, 0.0024 * scale, L * 0.62, 0.001 * scale, 3);
      transform(blade, 0, 0, L * 0.38 + L * 0.31);
      const g = merge([stem, blade]);
      stem.dispose();
      blade.dispose();
      return g;
    }
    case 'ball': {
      const g = revolve(
        [
          [0, 0],
          [0.0015 * scale, 0],
          [0.0012 * scale, L * 0.75],
          [0.0012 * scale, L * 0.8],
          [0.0022 * scale, L * 0.86],
          [0.0026 * scale, L * 0.92],
          [0.0022 * scale, L * 0.98],
          [0.0012 * scale, L * 1.02],
          [0, L * 1.03],
        ],
        20,
      );
      return g;
    }
  }
}

/** Lever-lock collar (pull ring) around the handle base. */
export function leverLockCollarGeometry(scale = 1): THREE.BufferGeometry {
  return revolve(
    [
      [0.0019 * scale, 0],
      [0.0027 * scale, 0],
      [0.0029 * scale, 0.0006 * scale],
      [0.0029 * scale, 0.0026 * scale],
      [0.0025 * scale, 0.0032 * scale],
      [0.0019 * scale, 0.0032 * scale],
    ],
    24,
  );
}

/** Rocker switch frame (static bezel with an opening) standing on z = 0. */
export function rockerFrameGeometry(w: number, h: number, border = 0.0015, depth = 0.0025): THREE.BufferGeometry {
  const s = roundedRectShape(w + border * 2, h + border * 2, border * 1.2);
  s.holes.push(roundedRectPath(w, h, border * 0.6));
  return extrude(s, { depth, bevel: Math.min(border * 0.4, depth * 0.3), bevelSegments: 2, curveSegments: 4 });
}

/**
 * Rocker cap: a box whose face is two planes meeting in a shallow ridge
 * (pressing either half tilts it). Pivot at z = 0 along X.
 */
export function rockerCapGeometry(w: number, h: number, depth = 0.006, ridge = 0.0012): THREE.BufferGeometry {
  const g = roundedBox(w * 0.96, h * 0.96, depth, Math.min(w, h) * 0.08, 2);
  g.translate(0, 0, depth / 2 - depth * 0.35);
  // Raise the centre line of the face to form the ridge.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const top = depth - depth * 0.35;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z > top - 0.0004) {
      const y = Math.abs(p.getY(i)) / (h * 0.48);
      p.setZ(i, z + ridge * (1 - Math.min(1, y)));
    }
  }
  g.computeVertexNormals();
  return g;
}

export type GuardStyle = 'cover' | 'clear' | 'box';

/**
 * Hinged guard cover in its hinge frame: the hinge axis is X through the
 * origin; the closed cover extends along -Y (length) and +Z (height), wide
 * `w` in X. Rotate the group about X by a negative angle to open it.
 */
export function guardCoverGeometry(w: number, length: number, height: number, t = 0.0011): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = t * 0.45;
  const top = roundedBox(w, length, t, r, 2);
  transform(top, 0, -length / 2, height - t / 2);
  parts.push(top);
  for (const sx of [-1, 1]) {
    const side = roundedBox(t, length, height, r, 2);
    transform(side, sx * (w / 2 - t / 2), -length / 2, height / 2);
    parts.push(side);
  }
  const front = roundedBox(w, t, height, r, 2);
  transform(front, 0, -length + t / 2, height / 2);
  parts.push(front);
  // Finger lip at the free end.
  const lip = roundedBox(w * 0.6, t * 2.2, t * 1.4, t * 0.6, 2);
  transform(lip, 0, -length - t * 0.6, height - t * 0.5);
  parts.push(lip);
  // Hinge knuckle.
  const knuckle = cylinderZ(t * 1.3, t * 1.3, -w / 2, w / 2, 12);
  knuckle.rotateY(Math.PI / 2);
  transform(knuckle, 0, 0, height * 0.35);
  parts.push(knuckle);
  const g = merge(parts);
  for (const p of parts) p.dispose();
  return g;
}

/** Static hinge block / base plate of a guard. */
export function guardBaseGeometry(w: number, length: number, t = 0.0011): THREE.BufferGeometry {
  const s = roundedRectShape(w + t * 2, length, t * 2);
  const g = extrude(s, { depth: t * 0.9, bevel: t * 0.3, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, -length / 2, 0);
  const blocks: THREE.BufferGeometry[] = [g];
  for (const sx of [-1, 1]) {
    const b = roundedBox(t * 1.8, t * 3, t * 3.2, t * 0.5, 2);
    transform(b, sx * (w / 2 + t * 0.2), 0, t * 1.6);
    blocks.push(b);
  }
  const out = merge(blocks);
  for (const b of blocks) b.dispose();
  return out;
}

/** Fixed side fences (plates) protecting a switch from inadvertent actuation. */
export function fenceGeometry(gap: number, length: number, height: number, t = 0.0012): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(-length / 2, 0);
    s.lineTo(length / 2, 0);
    s.lineTo(length / 2 - height * 0.25, height);
    s.lineTo(-length / 2 + height * 0.25, height);
    s.closePath();
    const plate = extrude(s, { depth: t, bevel: t * 0.3, bevelSegments: 1, curveSegments: 1 });
    // Shape in XY -> plate in the YZ plane at x = sx * gap / 2.
    plate.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    plate.translate(sx * (gap / 2) - t / 2, 0, 0);
    parts.push(plate);
  }
  const g = merge(parts);
  for (const p of parts) p.dispose();
  return g;
}

/** Wire bail guard: a bent rod arch over/around a switch. */
export function wireGuardGeometry(width: number, height: number, rodR = 0.0008): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(-width / 2, 0, 0),
    new THREE.Vector3(-width / 2, 0, height * 0.8),
    new THREE.Vector3(-width * 0.3, 0, height),
    new THREE.Vector3(width * 0.3, 0, height),
    new THREE.Vector3(width / 2, 0, height * 0.8),
    new THREE.Vector3(width / 2, 0, 0),
  ];
  return tube(pts, rodR, 40, 8);
}
