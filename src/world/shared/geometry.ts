/**
 * Shared procedural geometry.
 */
import * as THREE from 'three';

/**
 * Horizontal disc (y = 0) with geometrically spaced rings: dense near the
 * centre (camera), sparse at the rim. Used by camera-following layers
 * (clouds, base ground) whose vertices are curved in the vertex shader.
 */
export function polarDisc(radius: number, rings: number, segments: number, innerRadius = 60): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const r = innerRadius * Math.pow(radius / innerRadius, (i - 1) / (rings - 1));
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  // Winding: counter-clockwise seen from +y.
  for (let j = 0; j < segments; j++) idx.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = 1 + i * segments + j;
      const b = 1 + i * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
