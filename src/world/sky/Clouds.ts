/**
 * Cloud layer: a stack of horizontal slices (curved with the Earth) between
 * cloud base and top, each evaluating the shared coverage field with a
 * height-dependent threshold, so the stack reads as volumetric cumulus from
 * above, below and the side, or as a stratus sheet when overcast. Cheap: N
 * transparent full-screen-ish layers with 3 texture reads each.
 *
 * Flying through: `densityAt` evaluates the same field on the CPU; the
 * Environment turns it into an in-cloud extinction (whiteout) and fades the
 * slices nearest the camera so no hard sheets are visible.
 */
import * as THREE from 'three';
import { GLSL_AERIAL, GLSL_WORLD_UNIFORMS, type WorldUniforms } from '../shared/atmosphere';
import { CLOUD_PERIOD_M, CloudField, GLSL_CLOUD_FIELD } from '../shared/cloudField';
import { polarDisc } from '../shared/geometry';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSliceAlt;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // Curvature: the layer is at constant altitude, i.e. it drops below the tangent plane.
  w.y = uSliceAlt - dot(w.xz, w.xz) * 7.848e-8;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_WORLD_UNIFORMS}
${GLSL_AERIAL}
${GLSL_CLOUD_FIELD}
uniform float uSliceH;      // 0 base .. 1 top
uniform float uSliceAlpha;
uniform float uRadius;
uniform vec3 uAmbientSky;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  float cov = cloudCoverage(vWorld.xz);
  float horizD = length(vWorld.xz - cameraPosition.xz);
  // Per-slice threshold jitter from fine noise so slice edges never line up (no banding).
  float jit = (texture2D(uNoiseTex, (vWorld.xz + uCloudOffset) / 1280.0 + uSliceH * 7.31).a - 0.5) * 0.05;
  float thr = cloudThresholdAt(uSliceH) + jit;
  // Softer edges with distance hide the discrete slices at grazing angles.
  float soft = mix(0.14, 0.08, uCloudStratus) * (1.0 + smoothstep(2000.0, 40000.0, horizD) * 1.5);
  float dens = smoothstep(thr, thr + soft, cov);
  if (dens <= 0.003) discard;
  vec3 V = normalize(vWorld - cameraPosition);
  float horiz = horizD;
  float fade = 1.0 - smoothstep(uRadius * 0.6, uRadius, horiz);
  // Avoid visible sheets when the eye is within a slice's thickness.
  float dy = abs(cameraPosition.y + dot(cameraPosition.xz, cameraPosition.xz) * 7.848e-8 - (uCloudBase + uSliceH * (uCloudTop - uCloudBase)));
  fade *= smoothstep(15.0, 90.0, dy + horiz * 0.02);
  // Lighting: brighter tops, self-shadowed interiors and bases, forward-scattering silver lining.
  float depthIn = clamp((cov - thr) * 4.0, 0.0, 1.0);
  float sunUp = clamp(uSunDir.y * 4.0 + 0.2, 0.0, 1.0);
  float lightH = mix(0.28, 1.0, uSliceH);
  float selfShadow = mix(1.0, 0.55, depthIn * (1.0 - uSliceH));
  float cosT = dot(V, uSunDir);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.0796;
  float silver = hg * (1.0 - depthIn) * 0.9 * smoothstep(0.3, 0.9, cosT);
  vec3 direct = uSunColor * 0.9 / 3.14159 * (lightH * selfShadow + silver) * sunUp;
  vec3 ambient = uAmbientSky * mix(0.55, 1.0, uSliceH) * 0.9;
  vec3 col = direct + ambient;
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, dens * uSliceAlpha * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface CloudLayerParams {
  /** Base and top altitude (m MSL). */
  baseM: number;
  topM: number;
  /** Fractional cover 0..1. */
  cover: number;
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private slices: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; h: number }[] = [];
  private readonly field: CloudField;
  private readonly ambientSky = new THREE.Vector3();
  private radius: number;
  private threshold = 2;
  private stratus = 0;
  private params: CloudLayerParams = { baseM: 1500, topM: 2400, cover: 0 };

  constructor(
    private readonly uniforms: WorldUniforms,
    field: CloudField,
    sliceCount: number,
    radiusM: number,
  ) {
    this.field = field;
    this.radius = radiusM;
    this.geometry = polarDisc(radiusM, 56, 72);
    this.group.name = 'clouds';
    this.setSliceCount(sliceCount);
  }

  setSliceCount(n: number): void {
    for (const s of this.slices) {
      this.group.remove(s.mesh);
      s.mat.dispose();
    }
    this.slices = [];
    const alpha = 1 - Math.pow(1 - 0.96, 1 / Math.max(1, n)); // ~96% opacity through the full stack
    for (let i = 0; i < n; i++) {
      const h = (i + 0.5) / n;
      const mat = new THREE.ShaderMaterial({
        name: 'amg-cloud-slice',
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          ...this.uniforms,
          uSliceAlt: { value: 0 },
          uSliceH: { value: h },
          uSliceAlpha: { value: alpha },
          uRadius: { value: this.radius },
          uAmbientSky: { value: this.ambientSky },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.frustumCulled = false;
      mesh.name = `cloud-slice-${i}`;
      this.group.add(mesh);
      this.slices.push({ mesh, mat, h });
    }
  }

  /** Updates layer geometry/threshold. Returns false when there is no layer. */
  setParams(p: CloudLayerParams): boolean {
    this.params = p;
    this.stratus = p.cover >= 0.85 ? Math.min(1, (p.cover - 0.85) / 0.1) : 0;
    this.threshold = this.field.thresholdForCover(p.cover);
    const u = this.uniforms;
    u.uCloudBase.value = p.baseM;
    u.uCloudTop.value = p.topM;
    u.uCloudThresh.value = this.threshold;
    u.uCloudStratus.value = this.stratus;
    return p.cover > 0.01;
  }

  /** Advances the wind drift (m) of the cloud field; wraps to the noise period. */
  drift(dxM: number, dzM: number): void {
    const o = this.uniforms.uCloudOffset.value;
    o.x = (((o.x + dxM) % CLOUD_PERIOD_M) + CLOUD_PERIOD_M) % CLOUD_PERIOD_M;
    o.y = (((o.y + dzM) % CLOUD_PERIOD_M) + CLOUD_PERIOD_M) % CLOUD_PERIOD_M;
  }

  /**
   * Cloud density 0..1 at a scene position with geodetic altitude `altM`
   * (CPU mirror of the shader, used for whiteout).
   */
  densityAt(x: number, z: number, altM: number): number {
    const p = this.params;
    if (p.cover <= 0.01 || altM < p.baseM || altM > p.topM) return 0;
    const h = (altM - p.baseM) / Math.max(1, p.topM - p.baseM);
    const o = this.uniforms.uCloudOffset.value;
    const cov = this.field.coverage(x + o.x, z + o.y, this.stratus);
    const thr = CloudField.thresholdAt(this.threshold, h, this.stratus);
    const soft = 0.1 + (0.06 - 0.1) * this.stratus;
    const t = Math.min(1, Math.max(0, (cov - thr) / soft));
    return t * t * (3 - 2 * t);
  }

  /** Per-frame: follow the camera, set slice altitudes and draw order. */
  update(cameraWorld: THREE.Vector3, camAltM: number, ambientSky: THREE.Color): void {
    const p = this.params;
    this.group.visible = p.cover > 0.01;
    if (!this.group.visible) return;
    this.ambientSky.set(ambientSky.r, ambientSky.g, ambientSky.b);
    const n = this.slices.length;
    for (let i = 0; i < n; i++) {
      const s = this.slices[i];
      const alt = p.baseM + s.h * (p.topM - p.baseM);
      s.mesh.position.set(cameraWorld.x, 0, cameraWorld.z);
      s.mat.uniforms.uSliceAlt.value = alt;
      // Farthest slice (in altitude) first: transparent objects then blend back-to-front.
      s.mesh.renderOrder = 20 + Math.round(1000 - Math.min(1000, Math.abs(alt - camAltM) / 10));
    }
  }

  dispose(): void {
    for (const s of this.slices) s.mat.dispose();
    this.geometry.dispose();
  }
}
