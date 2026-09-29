/**
 * Cockpit structure: glareshield, window frames and pillars, overhead and
 * pedestal shells, sidewalls, floor, and crew seats.
 *
 * Unless stated otherwise these builders work in the cockpit-local frame
 * (X right, Y up, Z aft) so they can be positioned directly with
 * `bodyToLocal`. Sizes are parameters; defaults are EST typical values.
 */
import * as THREE from 'three';
import { extrude, merge, roundedBox, roundedRectShape, sweep, transform, cylinderZ } from './primitives';

/**
 * Glareshield: a flat-topped hood with a rolled brow over the instrument
 * panel. Local frame: X right, Y up, Z aft; the brow's aft edge is at z = 0,
 * top surface at y = 0, extending forward to z = -depth; the brow drops to
 * y = -drop. `endTaper` narrows the far corners (m) like real glareshields.
 */
export function glareshieldGeometry(width: number, depth: number, drop = 0.07, brow = 0.03, endTaper = 0.04): THREE.BufferGeometry {
  // Cross-section in (sx = forward distance, sy = height), extruded across X.
  const s = new THREE.Shape();
  const t = 0.012;
  s.moveTo(0, -drop);
  s.lineTo(t, -drop);
  s.lineTo(t, -brow * 0.6);
  s.quadraticCurveTo(t + brow * 0.2, -t, brow, -t);
  s.lineTo(depth, -t * 1.4);
  s.lineTo(depth, 0.0);
  s.lineTo(brow, 0.004);
  s.quadraticCurveTo(0, 0.004, -0.006, -brow * 0.5);
  s.lineTo(-0.004, -drop + 0.004);
  s.quadraticCurveTo(-0.003, -drop, 0, -drop);
  const g = extrude(s, { depth: width, bevel: 0.004, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -width / 2);
  // (sx, sy, ez) -> (X = ez, Y = sy, Z = -sx): rotation (det +1).
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  if (endTaper > 0) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const f = Math.abs(x) / (width / 2);
      const z = p.getZ(i);
      // Pull the aft edge forward near the ends (plan-view taper).
      const k = THREE.MathUtils.smoothstep(f, 0.75, 1);
      p.setZ(i, z - endTaper * k * (1 - Math.min(1, -z / depth)));
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Window frame member / pillar swept along a curve through `points`
 * (cockpit-local). Section w x d with rounded corners.
 */
export function pillarGeometry(points: THREE.Vector3[], w = 0.05, d = 0.03, steps = 24): THREE.BufferGeometry {
  const s = roundedRectShape(w, d, Math.min(w, d) * 0.3);
  return sweep(s, points, steps);
}

/**
 * Open-front shell box (overhead console, pedestal sides, side consoles):
 * outer w x h x d, wall thickness t, open on the +Z face (the panel goes
 * there). Centred on the origin.
 */
export function shellBoxGeometry(w: number, h: number, d: number, t = 0.006, r = 0.01): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const back = roundedBox(w, h, t, Math.min(r, t * 0.45), 2);
  transform(back, 0, 0, -d / 2 + t / 2);
  parts.push(back);
  for (const sx of [-1, 1]) {
    const side = roundedBox(t, h, d, Math.min(r, t * 0.45), 2);
    transform(side, sx * (w / 2 - t / 2), 0, 0);
    parts.push(side);
  }
  for (const sy of [-1, 1]) {
    const tb = roundedBox(w, t, d, Math.min(r, t * 0.45), 2);
    transform(tb, 0, sy * (h / 2 - t / 2), 0);
    parts.push(tb);
  }
  const g = merge(parts);
  for (const p of parts) p.dispose();
  return g;
}

/**
 * Centre pedestal body: a wedge whose top slopes from `hAft` (at z = +len/2)
 * to `hFwd` (at z = -len/2), width w, standing on y = 0. Rounded vertical
 * edges.
 */
export function pedestalGeometry(w: number, len: number, hAft: number, hFwd: number, r = 0.015): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Side profile in (sx = z aft, sy = y).
  s.moveTo(-len / 2, 0);
  s.lineTo(len / 2, 0);
  s.lineTo(len / 2, hAft - r);
  s.quadraticCurveTo(len / 2, hAft, len / 2 - r, hAft);
  s.lineTo(-len / 2 + r, hFwd);
  s.quadraticCurveTo(-len / 2, hFwd, -len / 2, hFwd - r);
  s.closePath();
  const g = extrude(s, { depth: w, bevel: Math.min(r, 0.01), bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -w / 2);
  // (sx, sy, ez) -> (X = -ez, Y = sy, Z = sx)... use (X = ez, Y = sy, Z = -sx) with sx = z: need Z = sx.
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}

/** Floor plate w x len centred at the origin (y = 0). */
export function floorGeometry(w: number, len: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, len);
  g.rotateX(-Math.PI / 2);
  // UVs in metres for tiling carpet.
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * len);
  return g;
}

/**
 * Curved sidewall panel: a cylindrical patch of radius R (cabin cross-section)
 * spanning `len` fore-aft (Z) and angles a0..a1 (rad, from straight up,
 * positive toward +X). Faces inward.
 */
export function sidewallGeometry(R: number, len: number, a0: number, a1: number, segs = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(R, R, len, segs, 1, true, a0, a1 - a0);
  // Cylinder axis Y -> Z.
  g.rotateX(Math.PI / 2);
  // Inward facing: flip winding.
  const idx = g.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  return g;
}

export type SeatStyle = 'airline' | 'bizjet' | 'ga';

export interface SeatParts {
  cushion: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  frame: THREE.BufferGeometry;
}

/**
 * Crew seat (low-poly but properly proportioned), local frame X right, Y up,
 * Z aft, origin on the floor under the front of the seat pan. Seat reference
 * point height ~0.42 m (airline), 0.36 m (GA) EST.
 */
export function seatGeometry(style: SeatStyle, panRaise = 0): SeatParts {
  // (panRaise appended by b737-800, additive: raises the seat pan / back / armrests by panRaise metres on a
  // taller pedestal base, for decks whose design-eye geometry needs a higher cushion. Default 0 = unchanged.)
  const ga = style === 'ga';
  const W = ga ? 0.46 : 0.52;
  const panH = (ga ? 0.34 : 0.42) + panRaise;
  const panD = ga ? 0.46 : 0.5;
  const pan = roundedBox(W, 0.1, panD, 0.035, 4);
  transform(pan, 0, panH, panD / 2);
  // Bolsters.
  const bolsters: THREE.BufferGeometry[] = [pan];
  for (const sx of [-1, 1]) {
    const b = roundedBox(0.07, 0.05, panD * 0.9, 0.02, 3);
    transform(b, sx * (W / 2 - 0.035), panH + 0.05, panD / 2);
    bolsters.push(b);
  }
  const backH = ga ? 0.58 : 0.7;
  const back = roundedBox(W * 0.96, backH, 0.11, 0.04, 4);
  transform(back, 0, panH + 0.05 + backH / 2, panD + 0.04, -0.2, 0, 0);
  const head = roundedBox(W * 0.6, 0.18, 0.1, 0.04, 4);
  transform(head, 0, panH + 0.08 + backH + 0.07, panD + 0.12, -0.2, 0, 0);
  const cushion = merge(bolsters);
  for (const b of bolsters) b.dispose();
  const backM = merge(ga ? [back] : [back, head]);
  back.dispose();
  head.dispose();
  // Frame: pedestal base, rails, armrests for jets.
  const fr: THREE.BufferGeometry[] = [];
  const base = roundedBox(W * 0.7, panH - 0.06, panD * 0.7, 0.02, 2);
  transform(base, 0, (panH - 0.06) / 2, panD / 2);
  fr.push(base);
  for (const sx of [-1, 1]) {
    const rail = roundedBox(0.03, 0.02, 0.8, 0.008, 2);
    transform(rail, sx * W * 0.3, 0.01, panD / 2);
    fr.push(rail);
    if (!ga) {
      const arm = roundedBox(0.06, 0.05, 0.32, 0.02, 3);
      transform(arm, sx * (W / 2 + 0.035), panH + 0.2, panD * 0.55);
      fr.push(arm);
      const post = cylinderZ(0.012, 0.012, 0, 0.14, 12);
      post.rotateX(-Math.PI / 2);
      transform(post, sx * (W / 2 + 0.035), panH + 0.04, panD * 0.75);
      fr.push(post);
    }
  }
  const frame = merge(fr);
  for (const f of fr) f.dispose();
  return { cushion, back: backM, frame };
}

/** Rudder pedal assembly parts (one pedal): pad and arm. Local frame: pivot at origin, pedal pad facing aft (+Z). */
export function pedalGeometry(style: 'hanging' | 'floor', w = 0.09, h = 0.16): { pad: THREE.BufferGeometry; arm: THREE.BufferGeometry } {
  const pad = roundedBox(w, h, 0.012, 0.006, 3);
  const arm = roundedBox(0.018, style === 'hanging' ? 0.22 : 0.12, 0.014, 0.004, 2);
  if (style === 'hanging') {
    // Pivot above; pad hangs below.
    transform(pad, 0, -0.2 - h / 2 + 0.03, 0.01);
    transform(arm, 0, -0.11, 0);
  } else {
    // Floor pivot at the bottom of the pad (Cessna): pad rises above the pivot.
    transform(pad, 0, h / 2, 0.01);
    transform(arm, 0, 0.06, -0.012);
  }
  return { pad, arm };
}

/** Ribbed anti-slip strips on a pedal pad (merged into the pad material group). */
export function pedalTreadGeometry(w: number, h: number, ribs = 6): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < ribs; i++) {
    const r = roundedBox(w * 0.8, 0.004, 0.003, 0.0012, 1);
    transform(r, 0, -h / 2 + (h * (i + 0.5)) / ribs, 0.0075);
    parts.push(r);
  }
  const g = merge(parts);
  for (const p of parts) p.dispose();
  return g;
}

/** Plain beveled box helper (static trim pieces, consoles). Centred at the origin. */
export function trimBoxGeometry(w: number, h: number, d: number, r = 0.004): THREE.BufferGeometry {
  return roundedBox(w, h, d, r, 3);
}

/** Flat plate with rounded corners standing on z = 0 (placard backing plates, doublers). */
export function plateGeometry(w: number, h: number, t = 0.0012, r = 0.002): THREE.BufferGeometry {
  return extrude(roundedRectShape(w, h, r), { depth: t, bevel: t * 0.3, bevelSegments: 1, curveSegments: 4 });
}
