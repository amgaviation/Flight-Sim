/**
 * Rain and snow particles in a box around the camera. Particles are
 * world-anchored (the camera flies through them) and wrapped into the box in
 * the vertex shader; streak length and direction follow the particle
 * velocity relative to the camera (motion blur over ~1/40 s), so rain turns
 * into horizontal streaks at approach speeds. No per-frame CPU work besides
 * a few uniforms.
 *
 * Fall speeds: raindrops ~6.5-9 m/s (Gunn & Kinzer 1949, 2-5 mm drops),
 * snowflakes ~1 m/s (Locatelli & Hobbs 1974).
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed; // xyz position seed, w density rank
attribute float aEnd;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec3 uStreak;
uniform float uDensity;
uniform float uSnow;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = aSeed.xyz * uBox + uOffset;
  if (uSnow > 0.5) p.xz += 0.6 * vec2(sin(uTime * 1.3 + aSeed.x * 40.0), cos(uTime * 1.1 + aSeed.z * 40.0));
  p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  if (aEnd > 0.5) p -= uStreak;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  float d = length(p - uCam);
  vAlpha = step(aSeed.w, uDensity) * (1.0 - smoothstep(uBox.x * 0.25, uBox.x * 0.5, d)) * smoothstep(0.3, 2.0, d);
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Precipitation {
  readonly lines: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private readonly box = new THREE.Vector3(80, 60, 80);
  private readonly offset = new THREE.Vector3();
  private readonly lastCam = new THREE.Vector3();
  private readonly camVel = new THREE.Vector3();
  private hasLast = false;

  constructor(maxParticles: number) {
    const n = Math.max(1, maxParticles);
    const seed = new Float32Array(n * 2 * 4);
    const end = new Float32Array(n * 2);
    const pos = new Float32Array(n * 2 * 3);
    let s = 12345;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const x = rand();
      const y = rand();
      const z = rand();
      const w = (i + 0.5) / n;
      for (let k = 0; k < 2; k++) {
        seed.set([x, y, z, w], (i * 2 + k) * 4);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      name: 'amg-precip',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uBox: { value: this.box },
        uOffset: { value: this.offset },
        uStreak: { value: new THREE.Vector3() },
        uDensity: { value: 0 },
        uSnow: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uOpacity: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.name = 'precipitation';
    this.lines.renderOrder = 40;
  }

  /**
   * @param intensity env.precip 0..1
   * @param snow true below freezing
   * @param windE/windN wind (m/s) toward east/north
   * @param brightness ambient light factor for the particle colour
   */
  update(dt: number, cameraWorld: THREE.Vector3, intensity: number, snow: boolean, windE: number, windN: number, brightness: number, timeS: number): void {
    const on = intensity > 0.01;
    this.lines.visible = on;
    if (dt > 0 && this.hasLast) {
      this.camVel.subVectors(cameraWorld, this.lastCam).divideScalar(dt);
      // Ignore teleports and recenters.
      if (this.camVel.lengthSq() > 400 * 400) this.camVel.set(0, 0, 0);
    }
    this.lastCam.copy(cameraWorld);
    this.hasLast = true;
    if (!on) return;
    const fall = snow ? 1.0 : 8.0; // m/s
    // Particle velocity in scene axes (x = east, y = up, z = south).
    const vx = windE;
    const vy = -fall;
    const vz = -windN;
    this.offset.x = (this.offset.x + vx * dt) % this.box.x;
    this.offset.y = (this.offset.y + vy * dt) % this.box.y;
    this.offset.z = (this.offset.z + vz * dt) % this.box.z;
    // Perceived streak length ~ motion over 1/12 s for rain (persistence of vision, EST), shorter for snow.
    const exposure = snow ? 1 / 90 : 1 / 12;
    const u = this.material.uniforms;
    (u.uCam.value as THREE.Vector3).copy(cameraWorld);
    (u.uStreak.value as THREE.Vector3).set(vx - this.camVel.x, vy - this.camVel.y, vz - this.camVel.z).multiplyScalar(exposure);
    u.uDensity.value = Math.min(1, intensity);
    u.uSnow.value = snow ? 1 : 0;
    u.uTime.value = timeS;
    const b = 0.15 + 0.85 * brightness;
    (u.uColor.value as THREE.Color).setRGB(0.75 * b, 0.78 * b, 0.82 * b);
    u.uOpacity.value = snow ? 0.85 : 0.18;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
