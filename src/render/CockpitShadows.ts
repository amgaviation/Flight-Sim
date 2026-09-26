/**
 * Tight sun shadows for the cockpit.
 *
 * The world's sun light (world.environment.sunLight) casts shadows over a
 * 120 m square around the camera, i.e. ~6 cm texels at 2048 px: good for the
 * aircraft on the ramp, useless inside a cockpit. While the camera is in the
 * cockpit this controller re-fits the same light's shadow camera to a few
 * metres around the eye (millimetre texels: glareshield, window frames and
 * pillars throw crisp shadows across the panel), and restores the world's
 * frustum in external views. Call `update()` every frame AFTER world.update()
 * (the world re-aims the light each frame).
 */
import * as THREE from 'three';

/** Half-size (m) of the cockpit shadow frustum. EST: covers a 737 flight deck from the pilot's eye. */
export const COCKPIT_SHADOW_HALF_M = 2.6;
const LIGHT_DISTANCE_M = 30;

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class CockpitShadows {
  private readonly light: THREE.DirectionalLight;
  private readonly saved: { l: number; r: number; t: number; b: number; near: number; far: number; bias: number; normalBias: number };
  private fitted = false;
  enabled = true;

  constructor(light: THREE.DirectionalLight) {
    this.light = light;
    const c = light.shadow.camera as THREE.OrthographicCamera;
    this.saved = { l: c.left, r: c.right, t: c.top, b: c.bottom, near: c.near, far: c.far, bias: light.shadow.bias, normalBias: light.shadow.normalBias };
  }

  /** Marks meshes of a model as shadow casters/receivers (opaque meshes only: label quads and glass must not cast). */
  static prepare(root: THREE.Object3D, cast = true, receive = true): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const opaque = mats.every((m) => m && !m.transparent && (m as THREE.MeshBasicMaterial).alphaTest === 0 && m.visible !== false);
      const basic = mats.every((m) => (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true);
      mesh.castShadow = cast && opaque && !basic;
      mesh.receiveShadow = receive && !basic;
    });
  }

  /**
   * @param inCockpit camera inside the cockpit
   * @param eyeWorld  camera world position
   */
  update(inCockpit: boolean, eyeWorld: THREE.Vector3): void {
    const light = this.light;
    const c = light.shadow.camera as THREE.OrthographicCamera;
    if (inCockpit && this.enabled && light.castShadow) {
      _dir.copy(light.position).sub(light.target.position);
      if (_dir.lengthSq() < 1e-9) return;
      _dir.normalize();
      _eye.copy(eyeWorld);
      light.target.position.copy(_eye);
      light.target.updateMatrixWorld();
      light.position.copy(_eye).addScaledVector(_dir, LIGHT_DISTANCE_M);
      light.updateMatrixWorld();
      if (!this.fitted) {
        c.left = -COCKPIT_SHADOW_HALF_M;
        c.right = COCKPIT_SHADOW_HALF_M;
        c.top = COCKPIT_SHADOW_HALF_M;
        c.bottom = -COCKPIT_SHADOW_HALF_M;
        c.near = LIGHT_DISTANCE_M - 12;
        c.far = LIGHT_DISTANCE_M + 12;
        light.shadow.bias = -0.00015;
        light.shadow.normalBias = 0.004;
        c.updateProjectionMatrix();
        this.fitted = true;
      }
    } else if (this.fitted) {
      const s = this.saved;
      c.left = s.l;
      c.right = s.r;
      c.top = s.t;
      c.bottom = s.b;
      c.near = s.near;
      c.far = s.far;
      light.shadow.bias = s.bias;
      light.shadow.normalBias = s.normalBias;
      c.updateProjectionMatrix();
      this.fitted = false;
    }
  }
}
