/**
 * GPU point-sprite renderer for an airport's lights.
 *
 * One THREE.Points per airport in the airport's local frame. The vertex
 * shader chooses the colour by the side the observer is on (bidirectional
 * edge/threshold/centreline fixtures), animates sequenced flashers, REILs
 * and the rotating beacon, attenuates by distance and atmospheric
 * extinction, and sizes sprites from the illuminance at the eye (point
 * sources never shrink below a couple of pixels). PAPI colours are computed
 * on the CPU every frame from the true elevation angle of the eye above each
 * unit (including Earth curvature) and uploaded as a small attribute range.
 */
import * as THREE from 'three';
import { EARTH_MEAN_RADIUS_M, haversineM, RAD2DEG } from '../geo';
import { LIGHT_COLORS, LightGroup, LightKind, papiWhiteness, type LightDef } from './lightLayout';

export interface PlacedLight {
  def: LightDef;
  /** Airport-local position (m). */
  x: number;
  y: number;
  z: number;
  /** Airport-local facing direction (unit, or zero for omni). */
  dx: number;
  dy: number;
  dz: number;
  /** Geodetic position of the light (deg, m MSL) for PAPI angles. */
  lat: number;
  lon: number;
  elevM: number;
}

export interface LightState {
  /** Runway/approach lights on (night or low visibility). */
  runway: boolean;
  papi: boolean;
  beacon: boolean;
  taxiway: boolean;
  /** 0 = dark night .. 1 = bright day (env.ambient_light). */
  daylight: number;
  /** Extinction for light sources (1/m). */
  extinction: number;
  /** Intensity multiplier (e.g. runway light intensity step). */
  brightness: number;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aFront;
attribute vec3 aBack;
attribute vec3 aDir;
attribute vec4 aParams; // intensity, kind, phase, period
attribute float aGroup;
uniform vec3 uCamLocal;
uniform float uTime;
uniform vec4 uGroupOn;
uniform float uPixelRatio;
uniform float uDay;
uniform float uLightBeta;
uniform float uBrightness;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vec3 toCam = uCamLocal - position;
  float d = max(length(toCam), 0.5);
  vec3 v = toCam / d;
  float on = aGroup < 0.5 ? uGroupOn.x : aGroup < 1.5 ? uGroupOn.y : aGroup < 2.5 ? uGroupOn.z : uGroupOn.w;
  float I = aParams.x * on;
  vec3 col = aFront;
  float kind = aParams.y;
  if (dot(aDir, aDir) > 0.5) {
    float c = dot(v, aDir);
    if (c < 0.0) {
      col = aBack;
      if (dot(aBack, aBack) < 1e-6) I = 0.0;
    }
    // Fixtures emit mostly along the runway axis; dim toward the side.
    I *= mix(0.12, 1.0, smoothstep(0.05, 0.6, abs(c)));
    // Elevated beams: very dim when seen from far above (> ~30 deg).
    I *= mix(1.0, 0.35, smoothstep(0.5, 0.9, v.y));
  }
  if (kind > 0.5 && kind < 1.5) {
    // Flasher: short xenon pulse at its phase in the cycle.
    float ph = fract(uTime / aParams.w - aParams.z);
    float p = min(ph, 1.0 - ph) / 0.05;
    I *= 2.5 * exp(-p * p);
  } else if (kind > 1.5 && kind < 2.5) {
    // Rotating beacon: white beam and green beam 180 deg apart, rotating about local up.
    float ang = uTime / aParams.w * 6.283185307;
    vec2 beam = vec2(sin(ang), -cos(ang));
    vec2 hv = normalize(v.xz + vec2(1e-6));
    float cw = dot(hv, beam);
    float wB = exp(-(1.0 - cw) / 0.004);
    float gB = exp(-(1.0 + cw) / 0.004);
    col = aFront * wB + aBack * gB + (aFront + aBack) * 0.01;
    I *= (wB + gB + 0.02) * smoothstep(-0.2, 0.05, v.y + 0.1);
  }
  float T = exp(-uLightBeta * d);
  float E = I * 1.0e4 / (d * d) * T * uBrightness * mix(1.0, 0.08, uDay);
  float size = E < 2e-6 ? 0.0 : clamp(1.6 + 3.2 * log(1.0 + E * 60.0) / 2.302585, 0.0, 44.0);
  gl_PointSize = size * uPixelRatio;
  vColor = col * clamp(0.3 + 0.7 * pow(E, 0.25), 0.0, 3.0);
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 10.0) + 0.22 * exp(-r2 * 2.2);
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const PAPI_RED = LIGHT_COLORS.red;
const PAPI_WHITE = LIGHT_COLORS.white;

export class AirportLights {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly front: THREE.BufferAttribute;
  /** Indices (into the vertex arrays) of PAPI units, contiguous at the end. */
  private readonly papiStart: number;
  private readonly papiCount: number;
  private readonly papiLat: Float64Array;
  private readonly papiLon: Float64Array;
  private readonly papiElev: Float64Array;
  private readonly papiAim: Float64Array;
  readonly count: number;

  constructor(lights: PlacedLight[]) {
    // PAPI units last so their colour updates are one contiguous range.
    const sorted = [...lights.filter((l) => l.def.kind !== LightKind.Papi), ...lights.filter((l) => l.def.kind === LightKind.Papi)];
    const n = sorted.length;
    this.count = n;
    const pos = new Float32Array(n * 3);
    const front = new Float32Array(n * 3);
    const back = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    const params = new Float32Array(n * 4);
    const group = new Float32Array(n);
    const papiCount = lights.filter((l) => l.def.kind === LightKind.Papi).length;
    this.papiStart = n - papiCount;
    sorted.forEach((l, i) => {
      pos.set([l.x, l.y, l.z], i * 3);
      front.set(l.def.front, i * 3);
      if (l.def.back) back.set(l.def.back, i * 3);
      dir.set([l.dx, l.dy, l.dz], i * 3);
      params.set([l.def.intensity, l.def.kind, l.def.phase, l.def.period || 1], i * 4);
      group[i] = l.def.group;
    });
    this.papiCount = papiCount;
    this.papiLat = new Float64Array(papiCount);
    this.papiLon = new Float64Array(papiCount);
    this.papiElev = new Float64Array(papiCount);
    this.papiAim = new Float64Array(papiCount);
    for (let k = 0; k < papiCount; k++) {
      const l = sorted[this.papiStart + k];
      this.papiLat[k] = l.lat;
      this.papiLon[k] = l.lon;
      this.papiElev[k] = l.elevM;
      this.papiAim[k] = l.def.phase;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.front = new THREE.BufferAttribute(front, 3);
    this.front.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFront', this.front);
    g.setAttribute('aBack', new THREE.BufferAttribute(back, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
    g.setAttribute('aGroup', new THREE.BufferAttribute(group, 1));
    g.computeBoundingSphere();
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'amg-airport-lights',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uGroupOn: { value: new THREE.Vector4(1, 1, 1, 1) },
        uPixelRatio: { value: 1 },
        uDay: { value: 0 },
        uLightBeta: { value: 0 },
        uBrightness: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'airport-lights';
    this.points.frustumCulled = true;
    // Lights draw after opaque geometry and before cloud layers (see sky/Clouds.ts).
    this.points.renderOrder = 10;
  }

  /**
   * Per-frame update. `cameraWorld` is the eye position in scene coordinates;
   * `camLat/camLon/camAltM` its geodetic position (for PAPI angles).
   */
  update(cameraWorld: THREE.Vector3, camLat: number, camLon: number, camAltM: number, timeS: number, pixelRatio: number, st: LightState): void {
    const u = this.material.uniforms;
    this.points.updateWorldMatrix(true, false);
    _m.copy(this.points.matrixWorld).invert();
    (u.uCamLocal.value as THREE.Vector3).copy(_v.copy(cameraWorld).applyMatrix4(_m));
    u.uTime.value = timeS;
    (u.uGroupOn.value as THREE.Vector4).set(st.runway ? 1 : 0, st.papi ? 1 : 0, st.beacon ? 1 : 0, st.taxiway ? 1 : 0);
    u.uPixelRatio.value = pixelRatio;
    u.uDay.value = st.daylight;
    u.uLightBeta.value = st.extinction;
    u.uBrightness.value = st.brightness;
    if (this.papiCount === 0 || !st.papi) return;
    // PAPI: elevation angle of the eye above each unit's horizontal plane.
    const arr = this.front.array as Float32Array;
    for (let k = 0; k < this.papiCount; k++) {
      const d = Math.max(1, haversineM(camLat, camLon, this.papiLat[k], this.papiLon[k]));
      const dh = camAltM - this.papiElev[k] - (d * d) / (2 * EARTH_MEAN_RADIUS_M);
      const ang = Math.atan2(dh, d) * RAD2DEG;
      const w = papiWhiteness(ang, this.papiAim[k]);
      const o = (this.papiStart + k) * 3;
      arr[o] = PAPI_RED[0] + (PAPI_WHITE[0] - PAPI_RED[0]) * w;
      arr[o + 1] = PAPI_RED[1] + (PAPI_WHITE[1] - PAPI_RED[1]) * w;
      arr[o + 2] = PAPI_RED[2] + (PAPI_WHITE[2] - PAPI_RED[2]) * w;
    }
    this.front.clearUpdateRanges();
    this.front.addUpdateRange(this.papiStart * 3, this.papiCount * 3);
    this.front.needsUpdate = true;
  }

  /** Current PAPI whiteness pattern (for debug HUDs/tests): values 0..1 per unit. */
  papiState(out: number[]): number[] {
    out.length = 0;
    const arr = this.front.array as Float32Array;
    for (let k = 0; k < this.papiCount; k++) {
      const g = arr[(this.papiStart + k) * 3 + 1];
      out.push((g - PAPI_RED[1]) / (PAPI_WHITE[1] - PAPI_RED[1]));
    }
    return out;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export { LightGroup };
