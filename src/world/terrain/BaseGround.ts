/**
 * Fallback ground: a huge camera-following disc at constant altitude (curved
 * with the Earth in the vertex shader). It gives a ground plane and a
 * horizon when no terrain tiles are available (offline, first seconds of
 * loading) and fills the ring beyond the terrain view radius. When terrain
 * is loaded it sits below the lowest loaded terrain so it never shows through.
 */
import * as THREE from 'three';
import { GLSL_AERIAL, GLSL_WORLD_UNIFORMS, type WorldUniforms } from '../shared/atmosphere';
import { polarDisc } from '../shared/geometry';

export class BaseGround {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly altUniform = { value: 0 };

  constructor(uniforms: WorldUniforms, radiusM = 1_200_000) {
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, fog: false, name: 'amg-base-ground' });
    const alt = this.altUniform;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { uBaseAlt: alt });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBaseAlt;\nvarying vec3 vWorldPosB;')
        .replace(
          '#include <project_vertex>',
          `vec4 wpB = modelMatrix * vec4(transformed, 1.0);
wpB.y = uBaseAlt - dot(wpB.xz, wpB.xz) * 7.848e-8;
vWorldPosB = wpB.xyz;
vec4 mvPosition = viewMatrix * wpB;
gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPosB;\n${GLSL_WORLD_UNIFORMS}\n${GLSL_AERIAL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 q = vWorldPosB.xz / 9000.0;
  float n = texture2D(uNoiseTex, q).r * 0.6 + texture2D(uNoiseTex, q * 4.3).g * 0.4;
  diffuseColor.rgb = mix(vec3(0.035, 0.050, 0.030), vec3(0.070, 0.075, 0.045), n);
}`,
        )
        .replace('#include <opaque_fragment>', 'outgoingLight = applyAerial(outgoingLight, vWorldPosB);\n#include <opaque_fragment>');
    };
    this.material.customProgramCacheKey = () => 'amg-base-ground-v1';
    this.mesh = new THREE.Mesh(polarDisc(radiusM, 64, 96, 200), this.material);
    this.mesh.name = 'base-ground';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -10;
  }

  /** Follows the camera horizontally at altitude `altM` (m MSL). */
  update(cameraWorld: THREE.Vector3, altM: number): void {
    this.mesh.position.set(cameraWorld.x, 0, cameraWorld.z);
    this.altUniform.value = altM;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
