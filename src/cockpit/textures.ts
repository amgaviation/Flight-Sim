/**
 * Procedural surface textures for cockpit materials.
 *
 * Everything is generated into `THREE.DataTexture`s from tileable noise, so it
 * works without a canvas (node tests, workers) and needs no bundled images.
 * Normal maps use the OpenGL convention Three.js expects (+Y = +v).
 */
import * as THREE from 'three';
import { Prng } from '../core/math';

/** Tileable value noise on a `size` x `size` grid with `period` lattice cells per side. */
export function tileNoise(size: number, period: number, seed: number): Float32Array {
  const rng = new Prng(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const out = new Float32Array(size * size);
  const s = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % period) * period;
    const r1 = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % period;
      const c1 = (x0 + 1) % period;
      const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
      const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** Sum of octaves of {@link tileNoise}; result roughly 0..1. */
export function fbm(size: number, basePeriod: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves && period <= size; o++) {
    const n = tileNoise(size, period, seed + o * 7919);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Tileable Worley (cellular) distance field: distance to the nearest and second-nearest feature point. */
export function worley(size: number, cells: number, seed: number): { f1: Float32Array; f2: Float32Array } {
  const rng = new Prng(seed);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rng.next();
    py[i] = rng.next();
  }
  const f1 = new Float32Array(size * size);
  const f2 = new Float32Array(size * size);
  const cs = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / cs;
      const gy = y / cs;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let d1 = 1e9;
      let d2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = cx + ox;
          const iy = cy + oy;
          const wx = ((ix % cells) + cells) % cells;
          const wy = ((iy % cells) + cells) % cells;
          const fx = ix + px[wy * cells + wx];
          const fy = iy + py[wy * cells + wx];
          const d = Math.hypot(fx - gx, fy - gy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      f1[y * size + x] = d1;
      f2[y * size + x] = d2;
    }
  }
  return { f1, f2 };
}

/** Converts a tileable height field to an RGBA normal map texture. */
export function heightToNormalTexture(h: Float32Array, size: number, strength: number, name: string): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yr = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[yr + xp] - h[yr + xm]) * 0.5 * strength;
      const dy = (h[yp + x] - h[ym + x]) * 0.5 * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yr + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), name, false);
}

/** Converts a 0..1 field to a single-value (grey) texture, e.g. a roughness map (read from G). */
export function fieldToGreyTexture(f: Float32Array, size: number, lo: number, hi: number, name: string, srgb = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < f.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, lo + (hi - lo) * f[i])) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), name, srgb);
}

function finishTexture(t: THREE.DataTexture, name: string, srgb: boolean): THREE.DataTexture {
  t.name = name;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Wrinkle ("crackle") paint used on glareshields and some bizjet panels:
 * irregular raised cells with narrow valleys, plus fine grain.
 */
export function crackleNormal(size = 256, seed = 11): THREE.DataTexture {
  const { f1, f2 } = worley(size, 22, seed);
  const grain = fbm(size, 32, 3, seed + 3);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const edge = Math.min(1, (f2[i] - f1[i]) * 3.2); // 0 at cell borders
    h[i] = Math.sqrt(edge) * 0.8 + grain[i] * 0.25;
  }
  return heightToNormalTexture(h, size, 5, 'cockpit.crackle.normal');
}

/** Grain for smooth painted panels (very subtle orange peel). */
export function paintNormal(size = 256, seed = 5): THREE.DataTexture {
  const n = fbm(size, 16, 4, seed, 0.55);
  return heightToNormalTexture(n, size, 1.2, 'cockpit.paint.normal');
}

/** Pebbled leather: Worley cells with soft grooves. */
export function leatherNormal(size = 256, seed = 23): THREE.DataTexture {
  const { f1, f2 } = worley(size, 28, seed);
  const n = fbm(size, 32, 2, seed + 1);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, (f2[i] - f1[i]) * 2.5) * 0.9 + n[i] * 0.1;
  return heightToNormalTexture(h, size, 3.5, 'cockpit.leather.normal');
}

/** Woven fabric: two perpendicular sinusoidal thread sets with noise. */
export function fabricNormal(size = 256, seed = 31, threads = 48): THREE.DataTexture {
  const n = tileNoise(size, 64, seed);
  const h = new Float32Array(size * size);
  const k = (2 * Math.PI * threads) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const over = (Math.floor((x * threads) / size) + Math.floor((y * threads) / size)) & 1;
      const a = Math.abs(Math.sin(x * k * 0.5));
      const b = Math.abs(Math.sin(y * k * 0.5));
      h[y * size + x] = (over ? a : b) * 0.8 + n[y * size + x] * 0.2;
    }
  }
  return heightToNormalTexture(h, size, 2.5, 'cockpit.fabric.normal');
}

/** Cut-pile carpet: high-frequency noise. */
export function carpetNormal(size = 256, seed = 41): THREE.DataTexture {
  const n = fbm(size, 64, 3, seed, 0.6);
  return heightToNormalTexture(n, size, 4, 'cockpit.carpet.normal');
}

/** Diamond knurl (two crossing helical ridge sets), tiled `count` times around a knob. */
export function knurlNormal(size = 128, ridges = 16): THREE.DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * ridges;
      const v = (y / size) * ridges;
      const a = 1 - Math.abs(((u + v) % 1) * 2 - 1);
      const b = 1 - Math.abs(((u - v + ridges) % 1) * 2 - 1);
      h[y * size + x] = Math.min(a, b);
    }
  }
  return heightToNormalTexture(h, size, 6, 'cockpit.knurl.normal');
}

/** Brushed metal roughness: noise stretched along u. */
export function brushedRoughness(size = 256, seed = 53): THREE.DataTexture {
  const n = new Float32Array(size * size);
  const rng = new Prng(seed);
  const row = new Float32Array(size);
  for (let y = 0; y < size; y++) row[y] = rng.next();
  const fine = tileNoise(size, 128, seed + 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) n[y * size + x] = row[y] * 0.7 + fine[y * size + x] * 0.3;
  return fieldToGreyTexture(n, size, 0.25, 0.45, 'cockpit.brushed.rough');
}

/**
 * Screw-head top albedo: metal disc with a recess (Phillips cross, slot, Dzus
 * slot or hex socket). Mapped on the planar UVs of a cylinder cap.
 */
export function screwHeadTexture(kind: 'phillips' | 'slot' | 'hex', size = 64): { map: THREE.DataTexture; normal: THREE.DataTexture } {
  const albedo = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.hypot(dx, dy);
      let recess = 0;
      if (kind === 'phillips') {
        const arm = Math.max(0, 1 - r / 0.62);
        const w = 0.07 + 0.1 * arm;
        if ((Math.abs(dx) < w && Math.abs(dy) < 0.62) || (Math.abs(dy) < w && Math.abs(dx) < 0.62)) recess = 1;
        if (r < 0.16) recess = 1;
      } else if (kind === 'slot') {
        if (Math.abs(dy) < 0.09 && Math.abs(dx) < 0.92) recess = 1;
      } else {
        // hex socket (flat-to-flat ~0.5 of the head)
        const ang = Math.atan2(dy, dx);
        const sector = Math.PI / 3;
        const a = ((ang % sector) + sector) % sector - sector / 2;
        if (r * Math.cos(a) < 0.3) recess = 1;
      }
      // Edge chamfer darkening and dome shading.
      const dome = Math.max(0, 1 - r * r);
      h[y * size + x] = dome * 0.3 - recess * 0.6;
      const shade = recess ? 0.18 : 0.62 + 0.25 * dome;
      const i = (y * size + x) * 4;
      const v = Math.round(Math.min(1, shade) * 255);
      albedo[i] = v;
      albedo[i + 1] = v;
      albedo[i + 2] = v;
      albedo[i + 3] = 255;
    }
  }
  const map = finishTexture(new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat), `cockpit.screw.${kind}`, true);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const normal = heightToNormalTexture(h, size, 3, `cockpit.screw.${kind}.normal`);
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  return { map, normal };
}
