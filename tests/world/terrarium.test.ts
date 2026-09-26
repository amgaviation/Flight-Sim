import { describe, expect, it } from 'vitest';
import { decodeTerrarium, elevationToTerrarium, terrariumToElevation } from '../../src/world/terrain/terrarium';

describe('terrarium decoding', () => {
  it('matches the published formula elev = R*256 + G + B/256 - 32768', () => {
    // Sea level: 32768 -> R=128, G=0, B=0.
    expect(terrariumToElevation(128, 0, 0)).toBe(0);
    // Mount Everest region ~ 8848 m: 32768 + 8848 = 41616 -> R=162, G=144.
    expect(terrariumToElevation(162, 144, 0)).toBe(8848);
    // Fractional metres come from the blue channel (1/256 m).
    expect(terrariumToElevation(128, 1, 128)).toBeCloseTo(1.5, 10);
    // Bathymetry is negative: Challenger Deep ~ -10,935 m.
    expect(terrariumToElevation(85, 73, 0)).toBe(85 * 256 + 73 - 32768);
    expect(terrariumToElevation(0, 0, 0)).toBe(-32768);
  });

  it('round-trips encode/decode to 1/256 m', () => {
    for (const e of [-10935.25, -0.5, 0, 0.0039, 12.5, 1655.3, 5364.9, 8848.86]) {
      const [r, g, b] = elevationToTerrarium(e);
      expect(Math.abs(terrariumToElevation(r, g, b) - e)).toBeLessThanOrEqual(1 / 512 + 1e-9);
    }
  });

  it('decodes an RGBA buffer and reports min/max', () => {
    const elevs = [0, 100.5, -20, 2500.25];
    const rgba = new Uint8ClampedArray(elevs.length * 4);
    elevs.forEach((e, i) => {
      const [r, g, b] = elevationToTerrarium(e);
      rgba.set([r, g, b, 255], i * 4);
    });
    const out = decodeTerrarium(rgba);
    expect(Array.from(out.data)).toEqual(elevs);
    expect(out.min).toBe(-20);
    expect(out.max).toBe(2500.25);
  });

  it('reuses a caller-supplied output buffer', () => {
    const rgba = new Uint8Array([128, 10, 0, 255, 128, 20, 0, 255]);
    const buf = new Float32Array(2);
    const out = decodeTerrarium(rgba, buf);
    expect(out.data).toBe(buf);
    expect(Array.from(buf)).toEqual([10, 20]);
  });
});
