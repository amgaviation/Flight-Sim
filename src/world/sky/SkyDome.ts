/**
 * Physically based sky dome (Preetham/Wallner model from shared/atmosphere),
 * with sun disc, moon glow and a starlit night floor. Rendered first, without
 * depth, following the camera.
 */
import * as THREE from 'three';
import { GLSL_SKY, GLSL_WORLD_UNIFORMS, type WorldUniforms } from '../shared/atmosphere';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_WORLD_UNIFORMS}
${GLSL_SKY}
uniform float uSunDiscScale;
uniform float uMoonLight;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  vec3 d = dir;
  float below = 0.0;
  if (d.y < 0.0) {
    below = clamp(-d.y * 12.0, 0.0, 1.0);
    d = normalize(vec3(d.x, 0.0005, d.z));
  }
  vec3 col = skyRadiance(d, uSunDir);
  // Sun disc: angular radius 0.2666 deg (mean), limb darkened.
  float cosT = dot(dir, uSunDir);
  float disc = smoothstep(0.999987, 0.999992, cosT);
  if (disc > 0.0 && uSunDir.y > -0.02) {
    vec3 fex = exp(-(TOTAL_RAYLEIGH * uSkyRayleigh * exp(-max(0.0, uSkyAltitude) / 8400.0) * 8400.0) / max(uSunDir.y + 0.03, 0.03));
    col += disc * uSunDiscScale * fex * uSkyExposure;
  }
  // Moon glow (aureole) at night.
  float cm = dot(dir, uMoonDir);
  col += uMoonLight * (exp((cm - 1.0) * 3000.0) * 0.02 + exp((cm - 1.0) * 60.0) * 0.004) * vec3(0.8, 0.85, 1.0);
  // Below the horizon (only visible where no terrain is drawn): darken to haze.
  col = mix(col, uFogColor * 0.6, below);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(uniforms: WorldUniforms) {
    this.material = new THREE.ShaderMaterial({
      name: 'amg-sky',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...uniforms,
        uSunDiscScale: { value: 60 },
        uMoonLight: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Follows the camera and keeps the dome inside the far plane. */
  update(cameraWorld: THREE.Vector3, far: number, moonLight: number): void {
    this.mesh.position.copy(cameraWorld);
    this.mesh.scale.setScalar(Math.max(100, far * 0.5));
    this.material.uniforms.uMoonLight.value = moonLight;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
