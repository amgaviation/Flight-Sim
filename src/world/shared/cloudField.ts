/**
 * Cloud coverage field shared by the cloud layer, terrain cloud shadows and
 * the CPU in-cloud (whiteout) test.
 *
 * coverage(p) = 0.45 R(p / 40.96 km) + 0.35 G(p / 10.24 km) + 0.20 A(p / 2.56 km)
 * using the shared noise texture (all scales divide the 163.84 km period, so
 * the wrapped world offset stays seamless). The threshold for a requested
 * cover fraction is taken from the field's empirical CDF, so env.cloud_cover
 * = 0.5 really covers half the sky.
 */
import type { NoiseField } from './noise';

export const CLOUD_PERIOD_M = 163840;
const S_R = 40960;
const S_G = 10240;
const S_A = 2560;

export const GLSL_CLOUD_FIELD = /* glsl */ `
uniform vec2 uCloudOffset;   // metres, wrapped to the cloud period
uniform float uCloudBase;    // m MSL
uniform float uCloudTop;     // m MSL
uniform float uCloudThresh;  // coverage threshold at the layer base
uniform float uCloudStratus; // 0 cumulus .. 1 stratus sheet
uniform float uCloudShadow;  // 0..1 strength of ground shadows
float cloudCoverage(vec2 p) {
  vec2 q = p + uCloudOffset;
  float r = texture2D(uNoiseTex, q / ${S_R.toFixed(1)}).r;
  float g = texture2D(uNoiseTex, q / ${S_G.toFixed(1)}).g;
  float a = texture2D(uNoiseTex, q / ${S_A.toFixed(1)}).a;
  return mix(0.45 * r + 0.35 * g + 0.20 * a, 0.7 * r + 0.3 * g, uCloudStratus);
}
float cloudThresholdAt(float h01) {
  // Cumulus: tops narrow (threshold rises with height), slightly rounded bases.
  float cu = uCloudThresh + (1.0 - uCloudThresh) * (0.55 * h01 * h01 + 0.08 * pow(1.0 - h01, 3.0));
  return mix(cu, uCloudThresh, uCloudStratus);
}
float cloudShadowAt(vec3 worldPos) {
  if (uCloudShadow <= 0.0 || uSunDir.y <= 0.02) return 0.0;
  float h = worldPos.y + dot(worldPos.xz, worldPos.xz) * 7.848e-8;
  float mid = 0.5 * (uCloudBase + uCloudTop);
  if (h > mid) return 0.0;
  vec2 p = worldPos.xz + uSunDir.xz / uSunDir.y * (mid - h);
  float c = cloudCoverage(p);
  float t = cloudThresholdAt(0.5);
  return smoothstep(t - 0.02, t + 0.08, c) * uCloudShadow;
}
`;

/** CPU mirror of the GLSL cloud field. */
export class CloudField {
  private readonly cdf: Float32Array;

  constructor(private readonly noise: NoiseField) {
    // Empirical CDF of the coverage function over one full period.
    const n = 96;
    const samples: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.37) / n) * CLOUD_PERIOD_M;
        const y = ((j + 0.61) / n) * CLOUD_PERIOD_M;
        samples.push(this.coverage(x, y, 0));
      }
    }
    samples.sort((a, b) => a - b);
    this.cdf = Float32Array.from(samples);
  }

  /** Coverage value at wrapped cloud coordinates (metres). */
  coverage(qx: number, qy: number, stratus: number): number {
    const nz = this.noise;
    const r = nz.sample(qx / S_R, qy / S_R, 0);
    const g = nz.sample(qx / S_G, qy / S_G, 1);
    const a = nz.sample(qx / S_A, qy / S_A, 3);
    const cu = 0.45 * r + 0.35 * g + 0.2 * a;
    const st = 0.7 * r + 0.3 * g;
    return cu + (st - cu) * stratus;
  }

  /** Threshold such that a fraction `cover` of the field exceeds it. */
  thresholdForCover(cover: number): number {
    const c = Math.min(1, Math.max(0, cover));
    if (c <= 0) return 2; // nothing exceeds 2
    if (c >= 1) return -1;
    const idx = Math.min(this.cdf.length - 1, Math.max(0, Math.floor((1 - c) * this.cdf.length)));
    return this.cdf[idx];
  }

  /** Mirror of GLSL cloudThresholdAt. */
  static thresholdAt(base: number, h01: number, stratus: number): number {
    const cu = base + (1 - base) * (0.55 * h01 * h01 + 0.08 * Math.pow(1 - h01, 3));
    return cu + (base - cu) * stratus;
  }
}
