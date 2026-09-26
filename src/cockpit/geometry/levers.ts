/**
 * Lever hardware: arms, knobs and quadrant slot plates.
 *
 * Knob shapes follow 14 CFR 25.781 / 23.781 "Cockpit control knob shape":
 * landing-gear control = wheel shape, wing-flap control = airfoil shape
 * (general shapes, not exact sizes). Sizes are EST from flight-deck photos.
 *
 * Frame: lever pivot at the origin, arm along +Z; the lever moves in the
 * Y-Z plane (rotation about X). Knobs are built centred on their mounting
 * point at the arm tip.
 */
import * as THREE from 'three';
import { cylinderZ, extrude, merge, revolve, roundedBox, roundedRectPath, roundedRectShape, sphere, torusZ, transform } from './primitives';

/** Lever arm from z = 0 to z = length (slight taper toward the knob). */
export function leverArmGeometry(length: number, width = 0.011, thickness = 0.006): THREE.BufferGeometry {
  const g = roundedBox(width, thickness, length, Math.min(width, thickness) * 0.35, 2);
  g.translate(0, 0, length / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 1 - 0.25 * (p.getZ(i) / length);
    p.setX(i, p.getX(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export type LeverKnobStyle =
  | 'throttle' // bizjet thrust lever grip
  | 'boeing-thrust' // 737 thrust lever knob (crossbar-like block)
  | 'ga-throttle' // round knob
  | 'flap' // airfoil (25.781)
  | 'gear' // wheel (25.781)
  | 'speedbrake' // T-bar
  | 'start' // start/fuel cutoff lever knob
  | 'condition' // tapered handle
  | 'reverser' // small piggyback reverse lever grip
  | 'ball';

/** Knob geometry for a lever tip, centred on the mounting point (arm tip at origin, knob extends +Z). */
export function leverKnobGeometry(style: LeverKnobStyle, scale = 1): THREE.BufferGeometry {
  const s = scale;
  switch (style) {
    case 'throttle': {
      // Ergonomic grip: ellipsoid wider across (X) than fore-aft (Y).
      const g = sphere(1, 28, 20);
      g.scale(0.021 * s, 0.017 * s, 0.016 * s);
      g.translate(0, 0.002 * s, 0.013 * s);
      return g;
    }
    case 'boeing-thrust': {
      const g = roundedBox(0.044 * s, 0.024 * s, 0.03 * s, 0.009 * s, 4);
      g.translate(0, 0.002 * s, 0.013 * s);
      return g;
    }
    case 'ga-throttle':
      return revolve(
        [
          [0, 0],
          [0.012 * s, 0],
          [0.017 * s, 0.006 * s],
          [0.017 * s, 0.016 * s],
          [0.013 * s, 0.021 * s],
          [0, 0.022 * s],
        ],
        32,
      );
    case 'flap': {
      // Symmetric NACA 0018-like section, chord along Y, thickness along Z, span along X.
      const chord = 0.052 * s;
      const tMax = 0.18 * chord;
      const shape = new THREE.Shape();
      const n = 24;
      const upper: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const x = (1 - Math.cos((i / n) * Math.PI)) / 2; // cosine spacing 0..1
        const yt = 5 * tMax * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
        upper.push([x * chord - chord * 0.35, yt]);
      }
      shape.moveTo(upper[0][0], 0);
      for (const [x, y] of upper) shape.lineTo(x, y);
      for (let i = upper.length - 1; i >= 0; i--) shape.lineTo(upper[i][0], -upper[i][1]);
      const span = 0.03 * s;
      const g = extrude(shape, { depth: span, bevel: 0.0015 * s, bevelSegments: 3, curveSegments: 1 });
      g.translate(0, 0, -span / 2);
      // Shape (x chord, y thickness), extrusion span -> (Y chord, Z thickness, X span): cyclic permutation.
      g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
      g.translate(0, 0, tMax * 0.5 + 0.004 * s);
      g.computeVertexNormals();
      return g;
    }
    case 'gear': {
      // Wheel (axis along +Z = along the arm, facing the pilot): tyre + hub.
      const R = 0.024 * s;
      const tyre = torusZ(R - 0.0065 * s, 0.0068 * s, 14, 40);
      tyre.scale(1, 1, 0.9);
      transform(tyre, 0, 0, 0.009 * s);
      const hub = cylinderZ(R * 0.62, R * 0.66, 0.002 * s, 0.016 * s, 32);
      const g = merge([tyre, hub]);
      tyre.dispose();
      hub.dispose();
      return g;
    }
    case 'speedbrake': {
      const bar = roundedBox(0.06 * s, 0.014 * s, 0.016 * s, 0.006 * s, 3);
      transform(bar, 0, 0, 0.012 * s);
      return bar;
    }
    case 'start': {
      const g = revolve(
        [
          [0, 0],
          [0.006 * s, 0],
          [0.011 * s, 0.006 * s],
          [0.012 * s, 0.014 * s],
          [0.009 * s, 0.02 * s],
          [0, 0.021 * s],
        ],
        28,
      );
      g.scale(1.2, 0.8, 1);
      return g;
    }
    case 'condition': {
      const g = roundedBox(0.03 * s, 0.012 * s, 0.028 * s, 0.005 * s, 3);
      transform(g, 0, 0, 0.014 * s);
      return g;
    }
    case 'reverser': {
      const g = roundedBox(0.02 * s, 0.01 * s, 0.018 * s, 0.004 * s, 3);
      transform(g, 0, 0, 0.009 * s);
      return g;
    }
    case 'ball': {
      const g = sphere(0.011 * s, 24, 16);
      g.translate(0, 0, 0.009 * s);
      return g;
    }
  }
}

/**
 * Quadrant slot cover: raised plate with a slot along Y (length) for the
 * lever to travel in, standing on z = 0.
 */
export function quadrantSlotGeometry(length: number, slotWidth: number, plateWidth = slotWidth + 0.02, height = 0.004): THREE.BufferGeometry {
  const s = roundedRectShape(plateWidth, length + 0.02, 0.006);
  s.holes.push(roundedRectPath(slotWidth, length, slotWidth / 2 - 1e-4));
  return extrude(s, { depth: height, bevel: height * 0.3, bevelSegments: 2, curveSegments: 8 });
}

/** Brush seal strip inside a slot (dark fibres), flat at z = 0. */
export function slotSealGeometry(length: number, width: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(width, length);
}
