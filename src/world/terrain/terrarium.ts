/**
 * Terrarium elevation encoding (AWS Terrain Tiles / Mapzen).
 *
 * Source: https://github.com/tilezen/joerd/blob/master/docs/formats.md
 *   elevation_m = (R * 256 + G + B / 256) - 32768
 * giving 1/256 m resolution over -32768..32767 m.
 */

export interface DecodedElevation {
  data: Float32Array;
  min: number;
  max: number;
}

/** Decodes one terrarium pixel. */
export function terrariumToElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Encodes an elevation into terrarium RGB (inverse of `terrariumToElevation`, 1/256 m quantized). */
export function elevationToTerrarium(elev: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const v = Math.round((elev + 32768) * 256);
  const clamped = Math.max(0, Math.min(256 * 256 * 256 - 1, v));
  out[0] = Math.floor(clamped / 65536);
  out[1] = Math.floor(clamped / 256) % 256;
  out[2] = clamped % 256;
  return out;
}

/**
 * Decodes an RGBA pixel buffer (as returned by `getImageData`) into metres.
 * Alpha is ignored (terrarium tiles are opaque).
 */
export function decodeTerrarium(rgba: ArrayLike<number>, out?: Float32Array): DecodedElevation {
  const n = rgba.length >> 2;
  const data = out && out.length >= n ? out : new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const e = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
    data[i] = e;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  if (n === 0) {
    min = 0;
    max = 0;
  }
  return { data, min, max };
}
