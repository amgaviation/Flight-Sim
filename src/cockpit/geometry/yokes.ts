/**
 * Control wheels (yokes) and columns.
 *
 * Wheel frame: origin at the hub centre, X right, Y up, Z toward the pilot.
 * The wheel rotates about Z. Each builder returns merged geometry for the
 * frame (hard plastic/metal), the grips (leather/rubber) and the hub, plus
 * anchor frames for switches on the grips (local +Z of an anchor = outward
 * surface normal where a switch sits).
 *
 * Shapes: Cessna 172 "ram's horn" wheel, bizjet M-shaped wheels (Citation,
 * Gulfstream, Global) and the Boeing 737 wheel with a chart clip. All sizes
 * EST from published flight-deck photographs; a typical transport control
 * wheel spans ~0.36-0.42 m across the grips.
 */
import * as THREE from 'three';
import { cylinderZ, merge, roundedBox, sphere, transform, tube } from './primitives';

export type YokeStyle = 'cessna' | 'bizjet' | 'gulfstream' | 'boeing' | 'ramshorn';

export interface YokeAnchor {
  position: [number, number, number];
  /** Outward normal (anchor +Z). */
  normal: [number, number, number];
  /** Anchor +Y (default world up projected). */
  up?: [number, number, number];
}

export interface YokeParts {
  frame: THREE.BufferGeometry;
  grips: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
  /** Hit-test proxy for dragging the wheel (grip volume). */
  gripBoxes: { w: number; h: number; d: number; x: number; y: number; z: number; rz: number }[];
  anchors: Record<YokeAnchorName, YokeAnchor>;
  /** Overall width (m). */
  width: number;
}

export type YokeAnchorName =
  | 'leftTop'
  | 'leftOutboard'
  | 'leftInboard'
  | 'leftFront'
  | 'leftBack'
  | 'rightTop'
  | 'rightOutboard'
  | 'rightInboard'
  | 'rightFront'
  | 'rightBack'
  | 'hub'
  | 'hubTop';

function gripTube(x: number, y0: number, y1: number, r: number, lean: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(x, y0, 0),
    new THREE.Vector3(x + lean * 0.4, (y0 + y1) / 2, 0.004),
    new THREE.Vector3(x + lean, y1, 0),
  ];
  const g = tube(pts, r, 24, 16);
  // End caps.
  const c0 = sphere(r, 16, 10);
  c0.translate(pts[0].x, pts[0].y, pts[0].z);
  const c1 = sphere(r, 16, 10);
  c1.translate(pts[2].x, pts[2].y, pts[2].z);
  const out = merge([g, c0, c1]);
  g.dispose();
  c0.dispose();
  c1.dispose();
  return out;
}

function anchorsFor(xL: number, yTop: number, yMid: number, r: number, hubZ: number, hubTopY: number): Record<YokeAnchorName, YokeAnchor> {
  const a = (x: number, y: number, z: number, nx: number, ny: number, nz: number, up?: [number, number, number]): YokeAnchor => ({
    position: [x, y, z],
    normal: [nx, ny, nz],
    up,
  });
  const xR = -xL;
  return {
    leftTop: a(xL, yTop + r * 0.9, 0, 0, 1, 0, [0, 0, -1]),
    leftOutboard: a(xL - r * 0.95, yMid, 0, -1, 0, 0),
    leftInboard: a(xL + r * 0.95, yMid, 0, 1, 0, 0),
    leftFront: a(xL, yMid + r * 0.6, r * 0.95, 0, 0, 1),
    leftBack: a(xL, yMid, -r * 0.95, 0, 0, -1),
    rightTop: a(xR, yTop + r * 0.9, 0, 0, 1, 0, [0, 0, -1]),
    rightOutboard: a(xR + r * 0.95, yMid, 0, 1, 0, 0),
    rightInboard: a(xR - r * 0.95, yMid, 0, -1, 0, 0),
    rightFront: a(xR, yMid + r * 0.6, r * 0.95, 0, 0, 1),
    rightBack: a(xR, yMid, -r * 0.95, 0, 0, -1),
    hub: a(0, 0, hubZ, 0, 0, 1),
    hubTop: a(0, hubTopY, 0, 0, 1, 0, [0, 0, -1]),
  };
}

/** Builds the wheel parts for a style. */
export function yokeParts(style: YokeStyle, scale = 1): YokeParts {
  const s = scale;
  switch (style) {
    case 'cessna': {
      // Ram's horn: flat horizontal bar with upswept horns; rectangular hub.
      const W = 0.36 * s;
      const r = 0.0135 * s;
      const bar = tube(
        [
          new THREE.Vector3(-W / 2 + 0.01 * s, 0.035 * s, 0),
          new THREE.Vector3(-W / 2 + 0.02 * s, -0.005 * s, 0),
          new THREE.Vector3(-W * 0.3, -0.018 * s, 0),
          new THREE.Vector3(0, -0.02 * s, 0),
          new THREE.Vector3(W * 0.3, -0.018 * s, 0),
          new THREE.Vector3(W / 2 - 0.02 * s, -0.005 * s, 0),
          new THREE.Vector3(W / 2 - 0.01 * s, 0.035 * s, 0),
        ],
        r * 0.85,
        64,
        12,
      );
      const gl = gripTube(-W / 2 + 0.01 * s, 0.03 * s, 0.09 * s, r, 0.006 * s);
      const gr = gripTube(W / 2 - 0.01 * s, 0.03 * s, 0.09 * s, r, -0.006 * s);
      const hub = roundedBox(0.1 * s, 0.05 * s, 0.03 * s, 0.008 * s, 3);
      transform(hub, 0, -0.01 * s, 0.004 * s);
      const grips = merge([gl, gr]);
      gl.dispose();
      gr.dispose();
      return {
        frame: bar,
        grips,
        hub,
        gripBoxes: [
          { w: 0.04 * s, h: 0.09 * s, d: 0.035 * s, x: -W / 2 + 0.012 * s, y: 0.055 * s, z: 0, rz: 0 },
          { w: 0.04 * s, h: 0.09 * s, d: 0.035 * s, x: W / 2 - 0.012 * s, y: 0.055 * s, z: 0, rz: 0 },
          { w: W, h: 0.04 * s, d: 0.035 * s, x: 0, y: -0.015 * s, z: 0, rz: 0 },
        ],
        anchors: anchorsFor(-W / 2 + 0.013 * s, 0.09 * s, 0.06 * s, r, 0.02 * s, 0.018 * s),
        width: W,
      };
    }
    case 'bizjet':
    case 'gulfstream': {
      // M-shaped wheel: canted grips joined to a central hub by swept arms.
      const W = (style === 'gulfstream' ? 0.38 : 0.36) * s;
      const r = 0.015 * s;
      const armL = tube(
        [
          new THREE.Vector3(-0.045 * s, -0.01 * s, 0),
          new THREE.Vector3(-0.1 * s, -0.035 * s, -0.004 * s),
          new THREE.Vector3(-W / 2 + 0.02 * s, -0.03 * s, 0),
          new THREE.Vector3(-W / 2 + 0.008 * s, 0.0 * s, 0),
        ],
        r * 0.8,
        40,
        12,
      );
      const armR = armL.clone();
      armR.scale(-1, 1, 1);
      flipWinding(armR);
      const gl = gripTube(-W / 2 + 0.008 * s, -0.005 * s, 0.085 * s, r, 0.014 * s);
      const gr = gripTube(W / 2 - 0.008 * s, -0.005 * s, 0.085 * s, r, -0.014 * s);
      const hub = roundedBox(0.1 * s, 0.07 * s, 0.035 * s, 0.012 * s, 4);
      transform(hub, 0, 0, 0.004 * s);
      const frame = merge([armL, armR]);
      armL.dispose();
      armR.dispose();
      const grips = merge([gl, gr]);
      gl.dispose();
      gr.dispose();
      return {
        frame,
        grips,
        hub,
        gripBoxes: [
          { w: 0.045 * s, h: 0.11 * s, d: 0.04 * s, x: -W / 2 + 0.015 * s, y: 0.04 * s, z: 0, rz: -0.15 },
          { w: 0.045 * s, h: 0.11 * s, d: 0.04 * s, x: W / 2 - 0.015 * s, y: 0.04 * s, z: 0, rz: 0.15 },
          { w: W * 0.6, h: 0.05 * s, d: 0.04 * s, x: 0, y: -0.02 * s, z: 0, rz: 0 },
        ],
        anchors: anchorsFor(-W / 2 + 0.012 * s, 0.085 * s, 0.05 * s, r, 0.022 * s, 0.035 * s),
        width: W,
      };
    }
    case 'ramshorn': {
      // Citation Longitude ram's-horn wheel (Textron flight-deck photograph, AOPA 2021 a21_004 / c_yokeL21): two tall,
      // near-vertical grips (~0.14 m) rising from a wide flat hub block that carries the logo. Sizes EST.
      const W = 0.34 * s;
      const r = 0.0175 * s;
      const xg = W / 2 - 0.016 * s;
      const gl = gripTube(-xg, -0.02 * s, 0.12 * s, r, -0.012 * s);
      const gr = gripTube(xg, -0.02 * s, 0.12 * s, r, 0.012 * s);
      const bar = tube(
        [
          new THREE.Vector3(-xg, -0.018 * s, 0),
          new THREE.Vector3(-xg + 0.02 * s, -0.045 * s, 0.004 * s),
          new THREE.Vector3(-0.07 * s, -0.052 * s, 0.006 * s),
          new THREE.Vector3(0.07 * s, -0.052 * s, 0.006 * s),
          new THREE.Vector3(xg - 0.02 * s, -0.045 * s, 0.004 * s),
          new THREE.Vector3(xg, -0.018 * s, 0),
        ],
        r * 0.9,
        48,
        12,
      );
      const hub = roundedBox(0.17 * s, 0.07 * s, 0.05 * s, 0.014 * s, 4);
      transform(hub, 0, -0.035 * s, 0.014 * s);
      const grips = merge([gl, gr]);
      gl.dispose();
      gr.dispose();
      return {
        frame: bar,
        grips,
        hub,
        gripBoxes: [
          { w: 0.045 * s, h: 0.16 * s, d: 0.045 * s, x: -xg, y: 0.05 * s, z: 0, rz: 0.08 },
          { w: 0.045 * s, h: 0.16 * s, d: 0.045 * s, x: xg, y: 0.05 * s, z: 0, rz: -0.08 },
          { w: W * 0.6, h: 0.07 * s, d: 0.05 * s, x: 0, y: -0.035 * s, z: 0, rz: 0 },
        ],
        anchors: anchorsFor(-xg - 0.01 * s, 0.12 * s, 0.085 * s, r, 0.04 * s, 0.0),
        width: W,
      };
    }
    case 'boeing': {
      // 737: upright grips joined by a lower bow through the hub; chart clip on top of the hub.
      const W = 0.4 * s;
      const r = 0.016 * s;
      const bow = tube(
        [
          new THREE.Vector3(-W / 2 + 0.01 * s, 0.0, 0),
          new THREE.Vector3(-W * 0.38, -0.05 * s, 0),
          new THREE.Vector3(-W * 0.15, -0.07 * s, 0),
          new THREE.Vector3(0, -0.072 * s, 0),
          new THREE.Vector3(W * 0.15, -0.07 * s, 0),
          new THREE.Vector3(W * 0.38, -0.05 * s, 0),
          new THREE.Vector3(W / 2 - 0.01 * s, 0.0, 0),
        ],
        r * 0.85,
        64,
        12,
      );
      const gl = gripTube(-W / 2 + 0.01 * s, -0.005 * s, 0.1 * s, r, 0.01 * s);
      const gr = gripTube(W / 2 - 0.01 * s, -0.005 * s, 0.1 * s, r, -0.01 * s);
      const hub = roundedBox(0.13 * s, 0.1 * s, 0.04 * s, 0.014 * s, 4);
      transform(hub, 0, -0.02 * s, 0.004 * s);
      const post = roundedBox(0.02 * s, 0.07 * s, 0.02 * s, 0.006 * s, 2);
      transform(post, 0, -0.07 * s, 0);
      // Chart clip: thin plate with a spring bar on top of the hub.
      const clipPlate = roundedBox(0.12 * s, 0.004 * s, 0.05 * s, 0.0015 * s, 2);
      transform(clipPlate, 0, 0.032 * s, 0.004 * s);
      const clipBar = cylinderZ(0.003 * s, 0.003 * s, -0.055 * s, 0.055 * s, 10);
      clipBar.rotateY(Math.PI / 2);
      transform(clipBar, 0, 0.036 * s, 0.02 * s);
      const frame = merge([bow, post, clipPlate, clipBar]);
      bow.dispose();
      post.dispose();
      clipPlate.dispose();
      clipBar.dispose();
      const grips = merge([gl, gr]);
      gl.dispose();
      gr.dispose();
      return {
        frame,
        grips,
        hub,
        gripBoxes: [
          { w: 0.045 * s, h: 0.13 * s, d: 0.042 * s, x: -W / 2 + 0.014 * s, y: 0.048 * s, z: 0, rz: 0 },
          { w: 0.045 * s, h: 0.13 * s, d: 0.042 * s, x: W / 2 - 0.014 * s, y: 0.048 * s, z: 0, rz: 0 },
          { w: W * 0.8, h: 0.05 * s, d: 0.04 * s, x: 0, y: -0.06 * s, z: 0, rz: 0 },
        ],
        anchors: anchorsFor(-W / 2 + 0.014 * s, 0.1 * s, 0.06 * s, r, 0.024 * s, 0.03 * s),
        width: W,
      };
    }
  }
}

/** Column shaft: 'translate' = tube into the panel along -Z; 'pivot' = column down to a floor pivot. */
export function yokeColumnGeometry(kind: 'translate' | 'pivot', length: number, radius: number): THREE.BufferGeometry {
  if (kind === 'translate') return cylinderZ(radius, radius, -length, 0, 20);
  // Pivot column: a slightly curved box section from the hub down to y = -length.
  const g = roundedBox(radius * 2.4, length, radius * 2, radius * 0.6, 2);
  g.translate(0, -length / 2, -radius * 1.5);
  return g;
}

/** Flips triangle winding after a mirroring scale. */
export function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
}
