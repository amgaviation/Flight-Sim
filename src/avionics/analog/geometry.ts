/**
 * Mesh builders for electromechanical instruments. Local frame of every
 * gauge: the dial face lies in the XY plane at z = 0, +y = 12 o'clock, and
 * +z points out of the panel toward the pilot. Units: metres.
 *
 * Standard instrument sizes (ARINC 408 / AS 26 panel cut-outs): 3ATI =
 * 3-1/8 in case (the six-pack), 2ATI = 2-1/4 in (engine/system gauges).
 */
import * as THREE from 'three';

export const INSTRUMENT_SIZE = {
  /** 3-1/8 in (79.4 mm) "3ATI" case. */
  ATI3: 0.079375,
  /** 2-1/4 in (57.2 mm) "2ATI" case. */
  ATI2: 0.05715,
} as const;

/** Visible dial radius as a fraction of the case size. EST: dial ~ 0.86 of the case width. */
export const DIAL_RADIUS_FRACTION = 0.43;

/** Round bezel ring (lathe profile) around a dial of radius `innerR`, front at z = `frontZ`. */
export function roundBezelGeometry(innerR: number, outerR: number, frontZ: number, lip = 0.0025): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const back = frontZ - lip * 2.2;
  // Profile in (radius, height): inner wall -> rounded lip -> outer skirt.
  pts.push(new THREE.Vector2(innerR, back));
  pts.push(new THREE.Vector2(innerR, frontZ - lip * 0.6));
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 0.5;
    const r = innerR + lip * 0.6 - Math.cos(a) * lip * 0.6;
    const z = frontZ - lip * 0.6 + Math.sin(a) * lip * 0.6;
    pts.push(new THREE.Vector2(r, z));
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 0.5;
    const r = outerR - lip + Math.sin(a) * lip;
    const z = frontZ - (1 - Math.cos(a)) * lip;
    pts.push(new THREE.Vector2(r, z));
  }
  pts.push(new THREE.Vector2(outerR, back));
  const g = new THREE.LatheGeometry(pts, 72);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z
  return g;
}

/**
 * Square instrument front plate with a round window and rounded corners
 * (the case flange seen through the panel). Front face at z = frontZ.
 */
export function squareBezelGeometry(size: number, holeR: number, frontZ: number, thickness = 0.003, cornerR = 0.006): THREE.BufferGeometry {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + cornerR, -h);
  s.lineTo(h - cornerR, -h);
  s.quadraticCurveTo(h, -h, h, -h + cornerR);
  s.lineTo(h, h - cornerR);
  s.quadraticCurveTo(h, h, h - cornerR, h);
  s.lineTo(-h + cornerR, h);
  s.quadraticCurveTo(-h, h, -h, h - cornerR);
  s.lineTo(-h, -h + cornerR);
  s.quadraticCurveTo(-h, -h, -h + cornerR, -h);
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.3,
    bevelSize: thickness * 0.3,
    bevelSegments: 3,
    curveSegments: 48,
  });
  g.translate(0, 0, frontZ - thickness - thickness * 0.3);
  return g;
}

/** Rectangular front plate with a rectangular window (digital clocks, radios). */
export function rectBezelGeometry(w: number, h: number, winW: number, winH: number, winY: number, frontZ: number, thickness = 0.003, cornerR = 0.004): THREE.BufferGeometry {
  const s = roundedRectShape(w, h, cornerR);
  const hole = new THREE.Path();
  const hw = winW / 2;
  const r = Math.min(0.0015, winH / 4);
  hole.moveTo(-hw + r, winY - winH / 2);
  hole.lineTo(-hw, winY - winH / 2 + r);
  hole.lineTo(-hw, winY + winH / 2 - r);
  hole.lineTo(-hw + r, winY + winH / 2);
  hole.lineTo(hw - r, winY + winH / 2);
  hole.lineTo(hw, winY + winH / 2 - r);
  hole.lineTo(hw, winY - winH / 2 + r);
  hole.lineTo(hw - r, winY - winH / 2);
  hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.3, bevelSize: thickness * 0.3, bevelSegments: 2, curveSegments: 16 });
  g.translate(0, 0, frontZ - thickness - thickness * 0.3);
  return g;
}

export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const x = w / 2;
  const y = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/** Open cylinder lining the case between the dial (z = 0) and the glass (z = depth). */
export function caseWallGeometry(r: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, 64, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, depth / 2);
  return g;
}

/** Needle outline styles. Lengths as fractions of the dial radius. */
export interface NeedleSpec {
  /** Pointer length from the pivot to the tip. */
  length: number;
  /** Counterweight tail length behind the pivot. */
  tail: number;
  /** Width at the pivot and at the tip. */
  width: number;
  tipWidth: number;
  /** 'pointer' tapered with a sharp tip; 'sword' wide leaf (altimeter 1000 ft); 'thin' with an arrowhead at the tip (altimeter 10,000 ft); 'bar' constant width (CDI). */
  style: 'pointer' | 'sword' | 'thin' | 'bar';
  /** Extrusion thickness (m). */
  thickness?: number;
}

/** Needle geometry pointing +y from the pivot at the origin (dial radius = `dialR`). */
export function needleGeometry(spec: NeedleSpec, dialR: number): THREE.BufferGeometry {
  const L = spec.length * dialR;
  const T = spec.tail * dialR;
  const w = (spec.width * dialR) / 2;
  const tw = (spec.tipWidth * dialR) / 2;
  const s = new THREE.Shape();
  switch (spec.style) {
    case 'sword':
      s.moveTo(-w * 0.6, -T);
      s.lineTo(w * 0.6, -T);
      s.lineTo(w, L * 0.45);
      s.lineTo(0, L);
      s.lineTo(-w, L * 0.45);
      s.closePath();
      break;
    case 'thin': {
      const head = Math.max(tw * 3, 0.1 * L);
      s.moveTo(-w, -T);
      s.lineTo(w, -T);
      s.lineTo(w, L - head);
      s.lineTo(tw * 3, L - head);
      s.lineTo(0, L);
      s.lineTo(-tw * 3, L - head);
      s.lineTo(-w, L - head);
      s.closePath();
      break;
    }
    case 'bar':
      s.moveTo(-w, -T);
      s.lineTo(w, -T);
      s.lineTo(w, L);
      s.lineTo(-w, L);
      s.closePath();
      break;
    default:
      s.moveTo(-w * 0.8, -T);
      s.lineTo(w * 0.8, -T);
      s.lineTo(w, 0);
      s.lineTo(tw, L * 0.92);
      s.lineTo(0, L);
      s.lineTo(-tw, L * 0.92);
      s.lineTo(-w, 0);
      s.closePath();
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: spec.thickness ?? 0.0004, bevelEnabled: false });
  return g;
}

/** Pivot hub cap (cylinder facing +z). */
export function hubGeometry(r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 1.05, h, 24);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, h / 2);
  return g;
}

/** Knob: knurled-looking cylinder (many facets) with a chamfered face, axis +z, base at z = 0. */
export function knobGeometry(r: number, len: number): THREE.BufferGeometry {
  // Bottom to top (LatheGeometry faces outward for increasing profile height).
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(r * 0.7, 0),
    new THREE.Vector2(r, 0.0001),
    new THREE.Vector2(r, len - r * 0.18),
    new THREE.Vector2(r * 0.82, len),
    new THREE.Vector2(0, len + 0.0001),
  ];
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Slotted screw head (dome), facing +z. */
export function screwGeometry(r: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r * 0.45));
  }
  pts.reverse();
  const g = new THREE.LatheGeometry(pts, 16);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Standard materials of one gauge (disposed with the gauge). */
export interface GaugeMaterialSet {
  bezel: THREE.Material;
  wall: THREE.MeshStandardMaterial;
  needle: THREE.MeshStandardMaterial;
  hub: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  knob: THREE.Material;
  screw: THREE.Material;
}

/**
 * Creates the default material set. `lightColor` is the emissive colour of
 * luminous markings under instrument lighting (driven per frame through
 * `emissiveIntensity`).
 */
export function createGaugeMaterials(lightColor: THREE.ColorRepresentation, overrides: Partial<Pick<GaugeMaterialSet, 'bezel' | 'knob' | 'screw'>> = {}): GaugeMaterialSet {
  return {
    bezel: overrides.bezel ?? new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, name: 'gauge.bezel' }),
    wall: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.9, metalness: 0, side: THREE.BackSide, name: 'gauge.wall' }),
    needle: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.55, metalness: 0, emissive: lightColor, emissiveIntensity: 0, name: 'gauge.needle' }),
    hub: new THREE.MeshStandardMaterial({ color: '#101012', roughness: 0.4, metalness: 0.2, name: 'gauge.hub' }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#0a0c0e',
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      depthWrite: false,
      name: 'gauge.glass',
    }),
    knob: overrides.knob ?? new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide, name: 'gauge.knob' }),
    screw: overrides.screw ?? new THREE.MeshStandardMaterial({ color: '#6e7175', roughness: 0.35, metalness: 0.9, name: 'gauge.screw' }),
  };
}
