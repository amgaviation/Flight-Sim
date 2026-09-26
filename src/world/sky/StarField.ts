/**
 * Night sky: the real bright stars (Yale BSC5, V <= 5) plus a seeded field
 * of fainter stars, rotated to the observer's horizon from local sidereal
 * time and latitude so constellations and Polaris are where they belong; and
 * the Moon, drawn as a lit sphere so its phase and terminator orientation
 * follow the actual Sun direction.
 */
import * as THREE from 'three';
import { BRIGHT_STARS, BRIGHT_STAR_STRIDE } from './brightStars';
import { bvToRgb } from './illumination';
import { DEG2RAD } from '../geo';
import { gmstDeg } from './solar';
import type { ReferenceFrame } from '../ReferenceFrame';
import type { WorldUniforms } from '../shared/atmosphere';

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aMag;
uniform float uVis;
uniform float uPixelRatio;
uniform float uTime;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 wdir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  // Atmospheric extinction ~0.2 mag per airmass (visual), plus horizon haze.
  float airmass = 1.0 / max(wdir.y + 0.025, 0.025);
  float mag = aMag + 0.22 * min(airmass, 40.0);
  float flux = pow(10.0, -0.4 * mag);
  // Scintillation near the horizon.
  float tw = 1.0 + 0.25 * smoothstep(0.5, 0.05, wdir.y) * sin(uTime * 13.0 + position.x * 97.0 + position.y * 57.0);
  float b = flux * 9.0 * uVis * tw;
  gl_PointSize = clamp(1.6 + 1.3 * log(1.0 + flux * 40.0), 1.5, 5.0) * uPixelRatio;
  vColor = aColor * min(b, 3.0);
  if (wdir.y < -0.02 || b < 0.0015) gl_PointSize = 0.0;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-r2 * 4.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uSunDirM;   // sun direction in the moon billboard frame (x right, y up, z toward viewer)
uniform float uBright;
uniform sampler2D uNoiseTex;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUv, sqrt(1.0 - r2));
  // Maria: dark basaltic plains from low-frequency noise (albedo ~0.07 vs 0.12 highlands).
  float m = texture2D(uNoiseTex, vUv * 0.35 + 0.5).r;
  float albedo = mix(0.75, 1.0, smoothstep(0.42, 0.6, m));
  float lit = max(dot(n, normalize(uSunDirM)), 0.0);
  float earthshine = 0.012;
  vec3 col = vec3(1.0, 0.97, 0.9) * albedo * (lit + earthshine) * uBright;
  float edge = smoothstep(1.0, 0.96, r2);
  gl_FragColor = vec4(col * edge, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _to = new THREE.Vector3();

export class StarField {
  readonly group = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly moon: THREE.Mesh;
  private readonly moonMat: THREE.ShaderMaterial;

  constructor(uniforms: WorldUniforms, faintCount = 2500) {
    const nBright = BRIGHT_STARS.length / BRIGHT_STAR_STRIDE;
    const n = nBright + faintCount;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const rgb: [number, number, number] = [0, 0, 0];
    const put = (i: number, raDeg: number, decDeg: number, m: number, bv: number) => {
      const a = raDeg * DEG2RAD;
      const d = decDeg * DEG2RAD;
      // Equatorial unit vector: x -> (RA 0, Dec 0), z -> north celestial pole.
      pos[i * 3] = Math.cos(d) * Math.cos(a);
      pos[i * 3 + 1] = Math.cos(d) * Math.sin(a);
      pos[i * 3 + 2] = Math.sin(d);
      bvToRgb(bv, rgb);
      const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      col[i * 3] = rgb[0] / lum;
      col[i * 3 + 1] = rgb[1] / lum;
      col[i * 3 + 2] = rgb[2] / lum;
      mag[i] = m;
    };
    for (let i = 0; i < nBright; i++) {
      const o = i * BRIGHT_STAR_STRIDE;
      put(i, BRIGHT_STARS[o], BRIGHT_STARS[o + 1], BRIGHT_STARS[o + 2], BRIGHT_STARS[o + 3]);
    }
    // Faint stars 5.0 < V <= 6.5, number density rising ~x3 per magnitude (EST), uniform on the sphere.
    const rand = mulberry32(2024);
    for (let k = 0; k < faintCount; k++) {
      const u = rand();
      const m = 5.0 + 1.5 * Math.log(1 + u * (Math.pow(3, 1.5) - 1)) / Math.log(Math.pow(3, 1.5));
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      put(nBright + k, (phi * 180) / Math.PI, Math.asin(z) / DEG2RAD, m, rand() * 1.4 - 0.1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.starMat = new THREE.ShaderMaterial({
      name: 'amg-stars',
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uVis: { value: 0 }, uPixelRatio: { value: 1 }, uTime: uniforms.uTime },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.stars.matrixAutoUpdate = false;
    this.group.add(this.stars);

    this.moonMat = new THREE.ShaderMaterial({
      name: 'amg-moon',
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      uniforms: { uSunDirM: { value: new THREE.Vector3(0, 0, 1) }, uBright: { value: 1 }, uNoiseTex: uniforms.uNoiseTex },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.moonMat);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -998;
    this.group.add(this.moon);
    this.group.name = 'night-sky';
  }

  /**
   * Orients the sky for an observer at (lat, lon) at Julian day `jd` and
   * places the moon. `sunDir`/`moonDir` are scene-frame unit vectors.
   */
  update(
    frame: ReferenceFrame,
    jd: number,
    lat: number,
    lon: number,
    camera: THREE.Camera,
    cameraWorld: THREE.Vector3,
    far: number,
    starVisibility: number,
    moonDir: THREE.Vector3,
    sunDir: THREE.Vector3,
    moonBrightness: number,
    pixelRatio: number,
  ): void {
    const R = Math.max(100, far * 0.45);
    // Equatorial -> local ENU (as Three.js x=E, y=U, z=S) at LST and latitude, then the ENU tilt.
    const lst = (gmstDeg(jd) + lon) * DEG2RAD;
    const phi = lat * DEG2RAD;
    const cl = Math.cos(lst);
    const sl = Math.sin(lst);
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    // Rz(-lst): x' = x cos + y sin, y' = -x sin + y cos, z' = z; then images in ENU:
    // x' -> (0, -sin phi, cos phi), y' -> (1, 0, 0), z' -> (0, cos phi, sin phi).
    // Column j of M_enu = image of equatorial axis j.
    // v_enu = x' * Xm + y' * E + z' * P with Xm = (0, -sin phi, cos phi) (meridian point on the
    // celestial equator), E = (1, 0, 0) (east point) and P = (0, cos phi, sin phi) (celestial pole).
    // Columns: images of the equatorial x, y and z axes.
    const X = [-sl, -sp * cl, cp * cl];
    const Y = [cl, -sp * sl, cp * sl];
    const Z = [0, cp, sp];
    // ENU -> three: (e, n, u) -> (e, u, -n)
    _m.set(
      X[0], Y[0], Z[0], 0,
      X[2], Y[2], Z[2], 0,
      -X[1], -Y[1], -Z[1], 0,
      0, 0, 0, 1,
    );
    _q.setFromRotationMatrix(_m);
    frame.enuQuaternion(lat, lon, _qt);
    _q.premultiply(_qt);
    this.stars.matrix.compose(cameraWorld, _q, _v.set(R, R, R));
    this.stars.matrixWorldNeedsUpdate = true;
    this.starMat.uniforms.uVis.value = starVisibility;
    this.starMat.uniforms.uPixelRatio.value = pixelRatio;

    // Moon billboard: angular diameter ~0.52 deg (mean).
    const dist = R * 0.98;
    this.moon.position.copy(cameraWorld).addScaledVector(moonDir, dist);
    camera.getWorldQuaternion(this.moon.quaternion);
    const radius = Math.tan(0.26 * DEG2RAD) * dist;
    this.moon.scale.set(radius, radius, radius);
    this.moon.visible = moonBrightness > 0.001 && moonDir.y > -0.02;
    // Sun direction in the billboard frame (x right, y up, z toward the viewer).
    _to.copy(moonDir).negate();
    _right.set(1, 0, 0).applyQuaternion(this.moon.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.moon.quaternion);
    const zAxis = _v.set(0, 0, 1).applyQuaternion(this.moon.quaternion);
    (this.moonMat.uniforms.uSunDirM.value as THREE.Vector3).set(sunDir.dot(_right), sunDir.dot(_up), sunDir.dot(zAxis));
    this.moonMat.uniforms.uBright.value = moonBrightness;
  }

  dispose(): void {
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.moon.geometry.dispose();
    this.moonMat.dispose();
  }
}
