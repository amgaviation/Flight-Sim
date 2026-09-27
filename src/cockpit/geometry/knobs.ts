/**
 * Knob caps. All caps stand on z = 0 with their axis along +Z; styles with a
 * pointer point toward +Y (12 o'clock) at zero rotation.
 *
 * Proportions are EST from avionics/panel photographs: panel knobs 12-25 mm
 * diameter, 10-16 mm tall; concentric Garmin/Collins encoders ~ 14 mm inner
 * on 22-24 mm outer.
 */
import * as THREE from 'three';
import { extrude, merge, revolve, roundedBox, transform, cylinderZ } from './primitives';

export type KnobCap =
  | 'fluted' // straight flutes (Boeing/Collins/Garmin style)
  | 'knurled' // fine straight knurl (plus diamond normal map via material 'knobKnurled')
  | 'smooth'
  | 'skirted' // grip on a wider skirt carrying the index mark
  | 'pointer' // round knob with an integral pointer nose
  | 'bar' // bar across a round base (selector)
  | 'chicken-head' // tapered pointer handle (classic selector)
  | 'wing' // large flat flap-shaped handle (fuel/bleed selectors)
  | 'key' // ignition/magneto key bow
  | 'ring' // outer ring of a concentric pair (fluted, with a centre hole)
  | 'dimmer' // small skirted rheostat knob
  | 'star'; // flat round cap with raised points round its rim (Cessna mixture: POH Sec 7 "a red knob with raised points around the circumference")

export interface KnobGeometryOptions {
  style: KnobCap;
  /** Grip diameter (m). */
  diameter: number;
  /** Height above the panel (m). */
  height: number;
  /** Number of flutes/ridges (default by style). */
  ridges?: number;
  /** Inner hole radius for 'ring' (m). */
  innerRadius?: number;
}

/** Builds a knob cap geometry (base at z = 0, axis +Z). */
export function knobGeometry(o: KnobGeometryOptions): THREE.BufferGeometry {
  const r = o.diameter / 2;
  const h = o.height;
  switch (o.style) {
    case 'fluted':
      return revolve(capProfile(r, h, 0.08), 48, { count: o.ridges ?? (r < 0.008 ? 16 : 22), depth: 0.075, zMin: h * 0.04, zMax: h * 0.86, kind: 'flute', blend: h * 0.08 });
    case 'knurled':
      return revolve(capProfile(r, h, 0.06), 96, {
        count: o.ridges ?? Math.max(24, Math.round((2 * Math.PI * r) / 0.0011)),
        depth: 0.03,
        zMin: h * 0.1,
        zMax: h * 0.82,
        kind: 'ridge',
        blend: h * 0.05,
      });
    case 'smooth':
      return revolve(capProfile(r, h, 0.1), 40);
    case 'dimmer':
    case 'skirted': {
      const rs = r * 1.38;
      const hs = h * (o.style === 'dimmer' ? 0.3 : 0.26);
      const p: [number, number][] = [
        [0, 0],
        [rs * 0.98, 0],
        [rs, hs * 0.1],
        [rs, hs * 0.7],
        [rs * 0.96, hs],
        [rs * 0.96, hs],
        [r * 1.02, hs],
        [r * 1.02, hs],
        [r, hs + 0.0004],
        [r, h * 0.9],
        [r * 0.96, h * 0.97],
        [r * 0.88, h],
        [r * 0.88, h],
        [r * 0.4, h * 1.01],
        [0, h * 1.015],
      ];
      return revolve(p, 48, { count: o.ridges ?? 18, depth: 0.08, zMin: hs + 0.0008, zMax: h * 0.88, kind: 'flute', blend: h * 0.06 });
    }
    case 'pointer': {
      const s = new THREE.Shape();
      const tip = r * 1.5;
      const a = Math.asin(Math.min(0.95, (r * 0.62) / r));
      // Arc from the right side of the nose, clockwise around the bottom, to the left side.
      s.moveTo(Math.sin(a) * r, Math.cos(a) * r);
      const segs = 36;
      for (let i = 1; i <= segs; i++) {
        const t = a + (i / segs) * (Math.PI * 2 - 2 * a);
        s.lineTo(Math.sin(t) * r, Math.cos(t) * r);
      }
      s.lineTo(0, tip);
      s.closePath();
      return extrude(s, { depth: h, bevel: Math.min(h * 0.12, 0.0012), bevelSegments: 3, curveSegments: 1 });
    }
    case 'bar': {
      const base = revolve(capProfile(r, h * 0.35, 0.1), 40);
      const bar = roundedBox(o.diameter * 0.3, o.diameter * 1.18, h * 0.9, Math.min(o.diameter * 0.12, h * 0.3), 3);
      transform(bar, 0, 0, h * 0.45 + h * 0.05);
      const g = merge([base, bar]);
      base.dispose();
      bar.dispose();
      return g;
    }
    case 'chicken-head': {
      const s = new THREE.Shape();
      const L = r * 2.2;
      const tail = r * 1.05;
      s.moveTo(0, L);
      s.bezierCurveTo(r * 0.35, L * 0.9, r * 0.95, r * 0.4, r * 0.95, 0);
      s.bezierCurveTo(r * 0.95, -tail * 0.7, r * 0.5, -tail, 0, -tail);
      s.bezierCurveTo(-r * 0.5, -tail, -r * 0.95, -tail * 0.7, -r * 0.95, 0);
      s.bezierCurveTo(-r * 0.95, r * 0.4, -r * 0.35, L * 0.9, 0, L);
      const top = extrude(s, { depth: h, bevel: Math.min(h * 0.18, 0.002), bevelSegments: 4, curveSegments: 10 });
      const hub = cylinderZ(r * 0.95, r * 0.95, 0, h * 0.25, 32);
      const g = merge([top, hub]);
      top.dispose();
      hub.dispose();
      return g;
    }
    case 'wing': {
      const s = new THREE.Shape();
      const L = o.diameter * 1.25;
      const w = o.diameter * 0.28;
      s.moveTo(0, L);
      s.bezierCurveTo(w * 0.6, L * 0.85, w, L * 0.4, w, 0);
      s.bezierCurveTo(w, -L * 0.45, w * 0.7, -L * 0.62, 0, -L * 0.62);
      s.bezierCurveTo(-w * 0.7, -L * 0.62, -w, -L * 0.45, -w, 0);
      s.bezierCurveTo(-w, L * 0.4, -w * 0.6, L * 0.85, 0, L);
      const blade = extrude(s, { depth: h, bevel: Math.min(h * 0.2, 0.0025), bevelSegments: 4, curveSegments: 12 });
      const hub = cylinderZ(w * 1.25, w * 1.1, 0, h * 0.4, 32);
      const g = merge([blade, hub]);
      blade.dispose();
      hub.dispose();
      return g;
    }
    case 'key': {
      // Key bow in the YZ plane: rounded head standing out of the escutcheon.
      const s = new THREE.Shape();
      const w = o.diameter;
      s.moveTo(-w * 0.18, 0);
      s.lineTo(w * 0.18, 0);
      s.lineTo(w * 0.2, h * 0.35);
      s.absarc(0, h * 0.62, w * 0.5, -Math.PI * 0.25, Math.PI * 1.25, false);
      s.lineTo(-w * 0.18, 0);
      const hole = new THREE.Path();
      hole.absarc(0, h * 0.78, w * 0.12, 0, Math.PI * 2, false);
      s.holes.push(hole);
      const bow = extrude(s, { depth: 0.0022, bevel: 0.0005, bevelSegments: 2, curveSegments: 16 });
      // Shape (x, y) -> panel (Y, Z); extrusion (thickness) -> X. Cyclic permutation, det +1.
      bow.translate(0, 0, -0.0011);
      bow.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
      bow.computeVertexNormals();
      return bow;
    }
    case 'star': {
      // Round cap whose rim carries `ridges` (default 12) pointed teeth; EST tooth depth 14 % of the radius
      // (photographs of the Cessna mixture knob), bevelled so the teeth read as raised points.
      const n = o.ridges ?? 12;
      const ro = r;
      const ri = r * 0.86;
      const s = new THREE.Shape();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? ro : ri;
        if (i === 0) s.moveTo(Math.sin(a) * rr, Math.cos(a) * rr);
        else s.lineTo(Math.sin(a) * rr, Math.cos(a) * rr);
      }
      s.closePath();
      const teeth = extrude(s, { depth: h * 0.92, bevel: Math.min(h * 0.1, 0.0012), bevelSegments: 2, curveSegments: 1 });
      const dome = revolve(
        [
          [0, h * 0.9],
          [ri * 0.98, h * 0.9],
          [ri * 0.9, h * 0.97],
          [ri * 0.5, h * 1.01],
          [0, h * 1.02],
        ],
        40,
      );
      const g = merge([teeth, dome]);
      teeth.dispose();
      dome.dispose();
      return g;
    }
    case 'ring': {
      const ri = o.innerRadius ?? r * 0.62;
      const p: [number, number][] = [
        [ri, h * 0.02],
        [ri, h * 0.02],
        [r * 0.97, 0],
        [r, h * 0.05],
        [r, h * 0.85],
        [r * 0.95, h],
        [r * 0.95, h],
        [ri * 1.08, h],
        [ri * 1.08, h],
        [ri, h * 0.94],
        [ri, h * 0.02],
      ];
      return revolve(p, 56, { count: o.ridges ?? 24, depth: 0.06, zMin: h * 0.08, zMax: h * 0.84, kind: 'flute', blend: h * 0.06 });
    }
  }
}

/** Profile of a cylindrical cap with a chamfered top edge and a slight dome. */
function capProfile(r: number, h: number, chamfer: number): [number, number][] {
  const c = r * chamfer;
  return [
    [0, 0],
    [r * 0.97, 0],
    [r, h * 0.03],
    [r, h - c * 1.2],
    [r - c * 0.35, h - c * 0.35],
    [r - c, h],
    [r - c, h],
    [(r - c) * 0.5, h * 1.012],
    [0, h * 1.018],
  ];
}

/** Round shaft / collar visible between a knob and the panel (static). */
export function knobShaft(radius: number, length: number): THREE.BufferGeometry {
  return cylinderZ(radius, radius, 0, length, 16);
}

/** Escutcheon ring (decorative bezel ring around a key switch or selector hub). */
export function escutcheon(outerR: number, innerR: number, h: number): THREE.BufferGeometry {
  return revolve(
    [
      [innerR, h],
      [innerR, h],
      [outerR * 0.9, h],
      [outerR, h * 0.4],
      [outerR, 0],
    ],
    48,
  );
}
