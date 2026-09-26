import { describe, expect, it } from 'vitest';
import { ambientLevel, clearSkyIlluminanceLux, cloudTransmission, moonIlluminanceLux, bvToRgb } from '../../src/world/sky/illumination';
import { defaultSkyParams, layerOpticalDepth, skyRadiance, twilightLevel } from '../../src/world/shared/atmosphere';
import { CloudField } from '../../src/world/shared/cloudField';
import { NoiseField, generateNoiseData } from '../../src/world/shared/noise';
import { permanentSnowLineM, snowLineM } from '../../src/world/terrain/biome';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('illumination', () => {
  it('matches the photometric anchors (Lux table)', () => {
    expect(clearSkyIlluminanceLux(0)).toBeCloseTo(398, -1); // ~400 lux at sunrise/sunset
    expect(clearSkyIlluminanceLux(-6)).toBeCloseTo(3.4, 1); // civil twilight dark limit
    expect(clearSkyIlluminanceLux(90)).toBeGreaterThan(100_000);
    expect(clearSkyIlluminanceLux(-30)).toBeLessThan(0.01);
  });

  it('is monotonic in solar elevation', () => {
    let prev = 0;
    for (let e = -20; e <= 90; e += 0.5) {
      const l = clearSkyIlluminanceLux(e);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('maps illuminance to a 0..1 ambient level on a log scale', () => {
    expect(ambientLevel(0.1)).toBe(0);
    expect(ambientLevel(100_000)).toBeCloseTo(1, 9);
    expect(ambientLevel(400)).toBeCloseTo(0.6, 1);
    expect(ambientLevel(1e9)).toBe(1);
  });

  it('dims under cloud and moonlight is tiny', () => {
    expect(cloudTransmission(0)).toBe(1);
    expect(cloudTransmission(1)).toBeCloseTo(0.3, 9);
    expect(moonIlluminanceLux(60, 1)).toBeGreaterThan(0.15);
    expect(moonIlluminanceLux(60, 1)).toBeLessThan(0.3);
    expect(moonIlluminanceLux(-5, 1)).toBe(0);
  });

  it('colours hot stars blue and cool stars red', () => {
    const blue = bvToRgb(-0.2, [0, 0, 0]);
    const red = bvToRgb(1.6, [0, 0, 0]);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(red[0]).toBeGreaterThan(red[2]);
  });
});

describe('sky model', () => {
  const p = defaultSkyParams();
  const out: [number, number, number] = [0, 0, 0];
  const sun = (el: number) => [Math.cos((el * Math.PI) / 180), Math.sin((el * Math.PI) / 180), 0] as const;

  it('daytime zenith is blue and the horizon brighter than the zenith', () => {
    const [sx, sy, sz] = sun(45);
    skyRadiance(0, 1, 0, sx, sy, sz, p, out);
    expect(out[2]).toBeGreaterThan(out[0]);
    const z = lum(out);
    skyRadiance(-0.999, 0.04, 0, sx, sy, sz, p, out);
    expect(lum(out)).toBeGreaterThan(z);
  });

  it('sunset horizon toward the sun is red-orange', () => {
    const [sx, sy, sz] = sun(0.5);
    skyRadiance(0.999, 0.03, 0, sx, sy, sz, p, out);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it('twilight dims ~10x per 3 deg of solar depression and ends at astronomical night', () => {
    expect(twilightLevel(-3) / twilightLevel(-6)).toBeGreaterThan(5);
    expect(twilightLevel(-9) / twilightLevel(-12)).toBeGreaterThan(5);
    expect(twilightLevel(-18)).toBe(0);
    expect(twilightLevel(30)).toBe(0);
    // The sky never goes fully black in civil twilight (unlike pure single scattering).
    const [sx, sy, sz] = sun(-4);
    skyRadiance(0, 1, 0, sx, sy, sz, p, out);
    expect(lum(out)).toBeGreaterThan(0.005);
  });

  it('layer optical depth: uniform limit and exponential integral', () => {
    // Same altitude: beta * d * exp(-h/H).
    expect(layerOpticalDepth(0, 0, 1000, 1e-3, 0, 1000)).toBeCloseTo(1, 9);
    // Vertical path through the whole layer from the base: beta * H.
    expect(layerOpticalDepth(0, 50_000, 50_000, 1e-3, 0, 1000)).toBeCloseTo(1, 3);
  });
});

describe('cloud field', () => {
  const field = new CloudField(new NoiseField(generateNoiseData()));
  it('covers the requested fraction of the sky', () => {
    for (const cover of [0.2, 0.44, 0.75, 0.9]) {
      const thr = field.thresholdForCover(cover);
      let above = 0;
      const n = 60;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (field.coverage((i + 0.13) * 2731, (j + 0.71) * 2731, 0) > thr) above++;
      expect(Math.abs(above / (n * n) - cover)).toBeLessThan(0.06);
    }
    expect(field.thresholdForCover(0)).toBeGreaterThan(1);
    expect(field.thresholdForCover(1)).toBeLessThan(0);
  });
});

describe('snow line', () => {
  it('follows latitude and season', () => {
    expect(permanentSnowLineM(0)).toBe(4900);
    expect(permanentSnowLineM(46)).toBeGreaterThan(2800);
    expect(permanentSnowLineM(46)).toBeLessThan(3000);
    expect(permanentSnowLineM(-46)).toBe(permanentSnowLineM(46));
    // Northern winter (day 15) lowers the NH snow line, not the SH one.
    expect(snowLineM(46, 15)).toBeLessThan(snowLineM(46, 196));
    expect(snowLineM(-46, 196)).toBeLessThan(snowLineM(-46, 15));
  });
});
