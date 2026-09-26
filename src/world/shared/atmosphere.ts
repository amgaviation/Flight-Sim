/**
 * Shared atmosphere: the analytic sky model (GLSL + an exact TypeScript
 * mirror), aerial perspective used by every world material, and the uniform
 * block all world shaders share.
 *
 * Sky model: Preetham et al., "A Practical Analytic Model for Daylight"
 * (SIGGRAPH 1999) in the formulation of Simon Wallner / three.js `Sky.js`
 * (MIT), extended with altitude (scattering coefficients scale with air
 * density: Rayleigh scale height 8.4 km, aerosol 1.25 km, the same optical
 * lengths the model uses) and a moonlit night floor.
 *
 * Aerial perspective: Koschmieder extinction with an exponential haze layer:
 * beta(h) = beta0 exp(-(h - h0) / H), integrated analytically along the view
 * ray, plus a clear-air term. beta0 = 3.912 / V for meteorological visibility
 * V (Koschmieder 1924; WMO-No. 8 "Guide to Instruments", MOR definition, 5%
 * contrast threshold).
 */
import * as THREE from 'three';

/** Wavelength-dependent Rayleigh total scattering at sea level (1/m), from three.js Sky.js (Preetham). */
export const TOTAL_RAYLEIGH: readonly [number, number, number] = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
/** pi * (2 pi / lambda)^(v - 2) * K for the three primaries (Sky.js). */
export const MIE_CONST: readonly [number, number, number] = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
export const RAYLEIGH_ZENITH_LENGTH_M = 8.4e3;
export const MIE_ZENITH_LENGTH_M = 1.25e3;
/** Koschmieder constant: -ln(0.02) (WMO uses 5%: -ln(0.05) = 3.0; aviation practice 3.912). */
export const KOSCHMIEDER = 3.912;

export interface SkyParams {
  /** Atmospheric turbidity (Preetham): 2 clear .. 10 hazy. */
  turbidity: number;
  /** Rayleigh multiplier (1 = standard). */
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** Observer altitude (m MSL). */
  altitude: number;
  /** Output exposure multiplier. */
  exposure: number;
}

export function defaultSkyParams(): SkyParams {
  return { turbidity: 3, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8, altitude: 0, exposure: 1 };
}

const CUTOFF_ANGLE = 1.6110731556870734; // pi / 1.95 (Sky.js earth-shadow hack)
const STEEPNESS = 1.5;
const EE = 1000;

export function sunIntensityFromZenithCos(zenithCos: number): number {
  const c = Math.max(-1, Math.min(1, zenithCos));
  return EE * Math.max(0, 1 - Math.exp(-(CUTOFF_ANGLE - Math.acos(c)) / STEEPNESS));
}

/** Night-sky floor radiance (linear RGB) added to the analytic sky: airglow/starlight blue-black. */
export const NIGHT_SKY: readonly [number, number, number] = [0.00035, 0.00055, 0.0011];

/**
 * CPU mirror of the GLSL `skyRadiance` below: linear RGB radiance seen along
 * unit direction `dir` (scene frame, y up) with the sun toward `sun`.
 * Allocation-free when `out` is supplied.
 */
export function skyRadiance(
  dx: number,
  dy: number,
  dz: number,
  sx: number,
  sy: number,
  sz: number,
  p: SkyParams,
  out: [number, number, number],
): [number, number, number] {
  const densR = Math.exp(-Math.max(0, p.altitude) / RAYLEIGH_ZENITH_LENGTH_M);
  const densM = Math.exp(-Math.max(0, p.altitude) / MIE_ZENITH_LENGTH_M);
  const sunE = sunIntensityFromZenithCos(sy);
  const mieTot = 0.434 * (0.2 * p.turbidity * 1e-17);
  const zen = Math.acos(Math.max(0, dy));
  const zenDeg = (zen * 180) / Math.PI;
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zenDeg, -1.253));
  const sR = RAYLEIGH_ZENITH_LENGTH_M * inv;
  const sM = MIE_ZENITH_LENGTH_M * inv;
  const cosT = dx * sx + dy * sy + dz * sz;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const fade = Math.min(1, Math.max(0, Math.pow(1 - sy, 5)));
  for (let c = 0; c < 3; c++) {
    const bR = TOTAL_RAYLEIGH[c] * p.rayleigh * densR;
    const bM = mieTot * MIE_CONST[c] * p.mieCoefficient * densM;
    const fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * fade;
    const l0 = 0.1 * fex;
    out[c] = ((lin + l0) * 0.04 + NIGHT_SKY[c]) * p.exposure;
  }
  return out;
}

/** Sun transmittance (per channel 0..1) along the sun direction for direct lighting. */
export function sunTransmittance(sunY: number, p: SkyParams, out: [number, number, number]): [number, number, number] {
  const densR = Math.exp(-Math.max(0, p.altitude) / RAYLEIGH_ZENITH_LENGTH_M);
  const densM = Math.exp(-Math.max(0, p.altitude) / MIE_ZENITH_LENGTH_M);
  const zen = Math.acos(Math.max(0, Math.min(1, sunY)));
  const zenDeg = (zen * 180) / Math.PI;
  // Kasten & Young (1989) relative air mass, same form as the sky model.
  const inv = 1 / (Math.cos(zen) + 0.50572 * Math.pow(96.07995 - zenDeg, -1.6364));
  const mieTot = 0.434 * (0.2 * p.turbidity * 1e-17);
  for (let c = 0; c < 3; c++) {
    const bR = TOTAL_RAYLEIGH[c] * p.rayleigh * 0.5 * densR;
    const bM = mieTot * MIE_CONST[c] * p.mieCoefficient * densM;
    out[c] = Math.exp(-(bR * RAYLEIGH_ZENITH_LENGTH_M + bM * MIE_ZENITH_LENGTH_M) * inv);
  }
  return out;
}

/** GLSL sky model; identical math to `skyRadiance`. Requires uniforms declared in GLSL_WORLD_UNIFORMS. */
export const GLSL_SKY = /* glsl */ `
const vec3 TOTAL_RAYLEIGH = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MIE_CONST = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const vec3 NIGHT_SKY = vec3(0.00035, 0.00055, 0.0011);
float skySunIntensity(float zenithCos) {
  zenithCos = clamp(zenithCos, -1.0, 1.0);
  return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(zenithCos)) / 1.5)));
}
vec3 skyRadiance(vec3 dir, vec3 sunDir) {
  float densR = exp(-max(0.0, uSkyAltitude) / 8400.0);
  float densM = exp(-max(0.0, uSkyAltitude) / 1250.0);
  float sunE = skySunIntensity(sunDir.y);
  vec3 bR = TOTAL_RAYLEIGH * uSkyRayleigh * densR;
  vec3 bM = (0.434 * (0.2 * uSkyTurbidity * 1e-17)) * MIE_CONST * uSkyMie * densM;
  float zen = acos(max(0.0, dir.y));
  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - degrees(zen), -1.253));
  float sR = 8400.0 * inv;
  float sM = 1250.0 * inv;
  vec3 fex = exp(-(bR * sR + bM * sM));
  float cosT = dot(dir, sunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0));
  float g = uSkyMieG;
  float g2 = g * g;
  float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * cosT + g2, 1.5));
  vec3 ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
  vec3 lin = pow(sunE * ratio * (1.0 - fex), vec3(1.5));
  float fade = clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0);
  lin *= mix(vec3(1.0), pow(sunE * ratio * fex, vec3(0.5)), fade);
  vec3 l0 = 0.1 * fex;
  return ((lin + l0) * 0.04 + NIGHT_SKY) * uSkyExposure;
}
`;

/** Uniform objects shared by every world material (one instance per World). */
export interface WorldUniforms {
  [name: string]: THREE.IUniform;
  /** Unit vector toward the sun, scene frame. */
  uSunDir: THREE.IUniform<THREE.Vector3>;
  /** Unit vector toward the moon, scene frame. */
  uMoonDir: THREE.IUniform<THREE.Vector3>;
  /** Direct sun (or moon) light colour * intensity, linear. */
  uSunColor: THREE.IUniform<THREE.Color>;
  /** Haze colour looking away from the sun, and toward it. */
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogSunColor: THREE.IUniform<THREE.Color>;
  /** Haze extinction at the haze base (1/m), base altitude (m MSL) and scale height (m). */
  uHazeBeta: THREE.IUniform<number>;
  uHazeBase: THREE.IUniform<number>;
  uHazeScale: THREE.IUniform<number>;
  /** Clear-air extinction at sea level (1/m); scale height 8.4 km. */
  uAirBeta: THREE.IUniform<number>;
  /** Extra uniform extinction when the camera is inside cloud (1/m). */
  uCloudBeta: THREE.IUniform<number>;
  /** Camera altitude (m MSL). */
  uCamAlt: THREE.IUniform<number>;
  /** Seconds (wraps every hour to keep float precision). */
  uTime: THREE.IUniform<number>;
  /** env.ambient_light 0..1. */
  uAmbient: THREE.IUniform<number>;
  /** 0 = day, 1 = full night (sun below -12 deg). */
  uNight: THREE.IUniform<number>;
  uDayOfYear: THREE.IUniform<number>;
  uNoiseTex: THREE.IUniform<THREE.Texture | null>;
  /** Sky colours for water reflections. */
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  /** Sky model parameters. */
  uSkyTurbidity: THREE.IUniform<number>;
  uSkyRayleigh: THREE.IUniform<number>;
  uSkyMie: THREE.IUniform<number>;
  uSkyMieG: THREE.IUniform<number>;
  uSkyAltitude: THREE.IUniform<number>;
  uSkyExposure: THREE.IUniform<number>;
  /** Wetness 0..1 (precipitation) for darker ground and puddle sheen. */
  uWetness: THREE.IUniform<number>;
  /** Cloud field (see shared/cloudField.ts; declared by GLSL_CLOUD_FIELD). */
  uCloudOffset: THREE.IUniform<THREE.Vector2>;
  uCloudBase: THREE.IUniform<number>;
  uCloudTop: THREE.IUniform<number>;
  uCloudThresh: THREE.IUniform<number>;
  uCloudStratus: THREE.IUniform<number>;
  uCloudShadow: THREE.IUniform<number>;
}

export function createWorldUniforms(): WorldUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uFogSunColor: { value: new THREE.Color(0.8, 0.8, 0.8) },
    uHazeBeta: { value: KOSCHMIEDER / 40000 },
    uHazeBase: { value: 0 },
    uHazeScale: { value: 1500 },
    uAirBeta: { value: KOSCHMIEDER / 200000 },
    uCloudBeta: { value: 0 },
    uCamAlt: { value: 0 },
    uTime: { value: 0 },
    uAmbient: { value: 1 },
    uNight: { value: 0 },
    uDayOfYear: { value: 172 },
    uNoiseTex: { value: null },
    uSkyZenith: { value: new THREE.Color(0.2, 0.35, 0.7) },
    uSkyHorizon: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uSkyTurbidity: { value: 3 },
    uSkyRayleigh: { value: 2 },
    uSkyMie: { value: 0.005 },
    uSkyMieG: { value: 0.8 },
    uSkyAltitude: { value: 0 },
    uSkyExposure: { value: 1 },
    uWetness: { value: 0 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudBase: { value: 1500 },
    uCloudTop: { value: 2500 },
    uCloudThresh: { value: 2 },
    uCloudStratus: { value: 0 },
    uCloudShadow: { value: 0 },
  };
}

/** GLSL declarations of the shared uniforms. */
export const GLSL_WORLD_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uHazeBeta;
uniform float uHazeBase;
uniform float uHazeScale;
uniform float uAirBeta;
uniform float uCloudBeta;
uniform float uCamAlt;
uniform float uTime;
uniform float uAmbient;
uniform float uNight;
uniform float uDayOfYear;
uniform sampler2D uNoiseTex;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uSkyTurbidity;
uniform float uSkyRayleigh;
uniform float uSkyMie;
uniform float uSkyMieG;
uniform float uSkyAltitude;
uniform float uSkyExposure;
uniform float uWetness;
`;

/**
 * Aerial perspective. `worldPos` in scene coordinates; the geodetic height of
 * a scene point is approximated by y + |xz|^2 / 2R (tangent-plane drop).
 * Returns transmittance in .a and the in-scattered colour in .rgb.
 */
export const GLSL_AERIAL = /* glsl */ `
float worldAltitude(vec3 p) {
  return p.y + dot(p.xz, p.xz) * 7.848e-8; // 1 / (2 * 6371 km)
}
float layerOpticalDepth(float hA, float hB, float dist, float beta, float base, float scaleH) {
  float a = max(hA - base, -300.0);
  float b = max(hB - base, -300.0);
  float ea = exp(-a / scaleH);
  float eb = exp(-b / scaleH);
  float dh = b - a;
  float avg = abs(dh) < 1.0 ? ea : (ea - eb) * scaleH / dh;
  return beta * dist * avg;
}
vec4 aerialPerspective(vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float d = length(v);
  vec3 dir = v / max(d, 1e-3);
  float hP = worldAltitude(worldPos);
  float od = layerOpticalDepth(uCamAlt, hP, d, uHazeBeta, uHazeBase, uHazeScale)
           + layerOpticalDepth(uCamAlt, hP, d, uAirBeta, 0.0, 8400.0)
           + uCloudBeta * d;
  float T = exp(-od);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt);
  return vec4(fogCol * (1.0 - T), T);
}
vec3 applyAerial(vec3 color, vec3 worldPos) {
  vec4 a = aerialPerspective(worldPos);
  return color * a.a + a.rgb;
}
`;

/** CPU mirror of `layerOpticalDepth` (used for tests and light visibility). */
export function layerOpticalDepth(hA: number, hB: number, dist: number, beta: number, base: number, scaleH: number): number {
  const a = Math.max(hA - base, -300);
  const b = Math.max(hB - base, -300);
  const ea = Math.exp(-a / scaleH);
  const eb = Math.exp(-b / scaleH);
  const dh = b - a;
  const avg = Math.abs(dh) < 1 ? ea : ((ea - eb) * scaleH) / dh;
  return beta * dist * avg;
}
