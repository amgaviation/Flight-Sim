/**
 * Procedural tileable noise shared by terrain detail, runway wear and clouds.
 *
 * One 256 x 256 RGBA8 texture, every channel periodic over the texture so
 * any integer repeat tiles seamlessly:
 *   R: fbm gradient noise, 4 cells base, 5 octaves (large features)
 *   G: fbm gradient noise, 8 cells base, 4 octaves, different seed
 *   B: Voronoi cell id (16 x 16 jittered cells): a random value per cell,
 *      used for field patchwork and cloud cell variation
 *   A: fbm gradient noise, 32 cells base, 3 octaves (fine detail)
 * The same bytes are kept on the CPU (`NoiseField.sample`) so cloud density
 * evaluated for in-cloud whiteout matches what the GPU draws.
 */
import * as THREE from 'three';

export const NOISE_SIZE = 256;

/** Deterministic 32-bit hash (lowbias32, Chris Wellons). */
function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hash2(ix: number, iy: number, seed: number): number {
  return hash32(ix * 374761393 + iy * 668265263 + seed * 2246822519);
}

/** Periodic 2D gradient noise in about [-1, 1] with integer period `per` (cells). */
function gradNoise(x: number, y: number, per: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g = (cx: number, cy: number, dx: number, dy: number): number => {
    const h = hash2(((cx % per) + per) % per, ((cy % per) + per) % per, seed);
    const a = (h / 4294967296) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n00 = g(ix, iy, fx, fy);
  const n10 = g(ix + 1, iy, fx - 1, fy);
  const n01 = g(ix, iy + 1, fx, fy - 1);
  const n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.414;
}

function fbm(x: number, y: number, baseCells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradNoise(x * cells, y * cells, cells, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

/** Generates the RGBA8 noise bytes. Deterministic. */
export function generateNoiseData(size = NOISE_SIZE, seed = 1337): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const cells = 16;
  // Jittered Voronoi sites, one per cell.
  const sites = new Float32Array(cells * cells * 3);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const h = hash2(i, j, seed + 77);
      const k = (j * cells + i) * 3;
      sites[k] = (i + 0.15 + 0.7 * ((h & 0xffff) / 65535)) / cells;
      sites[k + 1] = (j + 0.15 + 0.7 * ((h >>> 16) / 65535)) / cells;
      sites[k + 2] = (hash2(i, j, seed + 99) & 0xff) / 255;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = fbm(u, v, 4, 5, seed);
      const g = fbm(u, v, 8, 4, seed + 5000);
      const a = fbm(u, v, 32, 3, seed + 9000);
      // Nearest site on the torus.
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      let best = 1e9;
      let id = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells;
          const jj = (cj + dj + cells) % cells;
          const k = (jj * cells + ii) * 3;
          let dx = Math.abs(sites[k] - u);
          let dy = Math.abs(sites[k + 1] - v);
          if (dx > 0.5) dx = 1 - dx;
          if (dy > 0.5) dy = 1 - dy;
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            id = sites[k + 2];
          }
        }
      }
      const o = (y * size + x) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, r * 0.5 + 0.5)) * 255);
      data[o + 1] = Math.round(Math.min(1, Math.max(0, g * 0.5 + 0.5)) * 255);
      data[o + 2] = Math.round(id * 255);
      data[o + 3] = Math.round(Math.min(1, Math.max(0, a * 0.5 + 0.5)) * 255);
    }
  }
  return data;
}

/** CPU copy of the noise with GPU-equivalent bilinear, repeat-wrapped sampling. */
export class NoiseField {
  readonly data: Uint8Array;
  readonly size: number;

  constructor(data: Uint8Array, size = NOISE_SIZE) {
    this.data = data;
    this.size = size;
  }

  /** Samples channel `c` (0..3) at texture coordinates (u, v) with wrap; returns 0..1. */
  sample(u: number, v: number, c: number): number {
    const n = this.size;
    const x = u * n - 0.5;
    const y = v * n - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const ax = x - x0;
    const ay = y - y0;
    const i0 = ((x0 % n) + n) % n;
    const j0 = ((y0 % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const j1 = (j0 + 1) % n;
    const d = this.data;
    const p00 = d[(j0 * n + i0) * 4 + c];
    const p10 = d[(j0 * n + i1) * 4 + c];
    const p01 = d[(j1 * n + i0) * 4 + c];
    const p11 = d[(j1 * n + i1) * 4 + c];
    const a = p00 + (p10 - p00) * ax;
    const b = p01 + (p11 - p01) * ax;
    return (a + (b - a) * ay) / 255;
  }
}

let shared: { texture: THREE.DataTexture; field: NoiseField } | null = null;

/** Lazily created, shared noise texture + CPU field. Never disposed while the world lives. */
export function sharedNoise(): { texture: THREE.DataTexture; field: NoiseField } {
  if (shared) return shared;
  const data = generateNoiseData();
  const texture = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  shared = { texture, field: new NoiseField(data) };
  return shared;
}

/** Releases the shared noise texture (called by World.dispose). */
export function disposeSharedNoise(): void {
  if (!shared) return;
  shared.texture.dispose();
  shared = null;
}
