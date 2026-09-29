/**
 * Dynamic instancing of moving control parts (key caps, key legends,
 * circuit-breaker buttons, push-button caps and their lit lenses).
 *
 * Static parts are consolidated by `consolidateStatic` (merge.ts); parts that
 * move with a control (a key travelling in when pressed, a breaker popping
 * out) used to stay one draw call each: an MCDU keyboard costs ~140 calls, a
 * breaker panel ~120. Here, after the cockpit is built, every part a control
 * marked with {@link markMovingPart} is drawn by one `THREE.InstancedMesh`
 * per (geometry, material) - or per material for flat quads such as legends
 * and lenses, whose atlas UV rectangle, size, diffuse and emissive colour
 * become per-instance attributes - and the original mesh stays in the scene
 * graph as an invisible *proxy* that keeps its transform, name and material.
 *
 * Contract with the controls (KeyPad, CircuitBreaker, PushButton):
 *  - mark parts at construction: `markMovingPart(mesh, mover)`, `mover` being
 *    the group whose local transform the control animates (key group, breaker
 *    button, push-button cap) or any fixed ancestor for parts that never move;
 *  - per frame, `ControlInstances.of(control.object)` (null until the build
 *    instanced something of this control) and call `moved(mover)` after
 *    changing a mover's transform, `syncLenses()` after lens materials
 *    changed their emissive intensity, and `sync(showProxies)` once: it hides
 *    the instances while the control (or an ancestor) is invisible, and while
 *    `showProxies` is true it draws the original meshes instead (hover
 *    highlight overlays attach to them).
 *
 * Not instanced (kept as ordinary meshes): parts under a `cockpitDynamic`
 * ancestor (yokes, sidesticks, levers the aircraft moves), parts of controls
 * nested inside another control (e.g. the button of a GuardedButton, whose
 * hover rim belongs to the outer control), invisible parts, multi-material
 * meshes and buckets with fewer than `minInstances` parts.
 *
 * Like static consolidation, the transform of each mover's *parent chain* up
 * to the cockpit root is frozen at build time: anything the aircraft moves
 * after build() must be flagged `cockpitDynamic` (docs/modules/cockpit.md 3.4).
 */
import * as THREE from 'three';
import type { CockpitMaterials } from './materials';
import type { CockpitLighting } from './Lighting';

/** Mesh -> mover group, set by {@link markMovingPart}. */
const MOVERS = new WeakMap<THREE.Object3D, THREE.Object3D>();
/** Control root object -> its instanced parts. */
const CONTROLS = new WeakMap<THREE.Object3D, ControlInstances>();

/**
 * Marks `mesh` (a part of a control that moves only together with `mover`)
 * for dynamic instancing by the cockpit build.
 */
export function markMovingPart(mesh: THREE.Mesh, mover: THREE.Object3D): void {
  MOVERS.set(mesh, mover);
}

/** True when `mesh` was marked with {@link markMovingPart}. */
export function isMovingPart(mesh: THREE.Object3D): boolean {
  return MOVERS.has(mesh);
}

type BatchKind = 'solid' | 'quad' | 'lens';

interface Slot {
  batch: InstanceBatch;
  index: number;
  proxy: THREE.Mesh;
  mover: THREE.Object3D;
  /** Root <- mover.parent (frozen at build). */
  base: THREE.Matrix4;
  /** Mover <- part, including the unit-quad size/offset for quads. */
  tail: THREE.Matrix4;
  /** Lens: the proxy's per-instance material mirrored into the attributes. */
  lens: THREE.MeshStandardMaterial | null;
  lastEmissive: number;
}

const _m = new THREE.Matrix4();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

/** One InstancedMesh and the per-instance attributes it owns. */
class InstanceBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly kind: BatchKind;
  readonly uv: THREE.InstancedBufferAttribute | null;
  readonly emissive: THREE.InstancedBufferAttribute | null;
  /** Geometry / material created for this batch (disposed with it). */
  readonly ownGeometry: THREE.BufferGeometry | null;
  readonly ownMaterial: THREE.Material | null;

  constructor(kind: BatchKind, geometry: THREE.BufferGeometry, material: THREE.Material, count: number, ownGeometry: boolean, ownMaterial: boolean) {
    this.kind = kind;
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = `moving-inst:${material.name}`;
    this.mesh.userData.cockpitMovingInstances = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.ownGeometry = ownGeometry ? geometry : null;
    this.ownMaterial = ownMaterial ? material : null;
    this.uv = kind === 'solid' ? null : new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    if (this.uv) geometry.setAttribute('instUv', this.uv);
    this.emissive = kind === 'lens' ? new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3) : null;
    if (this.emissive) {
      this.emissive.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('instEmissive', this.emissive);
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

/** Instanced parts of one control. */
export class ControlInstances {
  private readonly slots: Slot[] = [];
  private readonly byMover = new Map<THREE.Object3D, Slot[]>();
  private readonly lensSlots: Slot[] = [];
  private readonly controlObject: THREE.Object3D;
  private readonly root: THREE.Object3D;
  private hidden = false;
  private proxies = false;

  /** Instanced parts of the control whose root object is `object` (null when nothing was instanced). */
  static of(object: THREE.Object3D): ControlInstances | null {
    return CONTROLS.get(object) ?? null;
  }

  constructor(controlObject: THREE.Object3D, root: THREE.Object3D) {
    this.controlObject = controlObject;
    this.root = root;
  }

  /** Number of instanced parts. */
  get count(): number {
    return this.slots.length;
  }

  /** True while the original meshes are drawn instead of the instances. */
  get showingProxies(): boolean {
    return this.proxies;
  }

  /** @internal */
  add(slot: Slot): void {
    this.slots.push(slot);
    let l = this.byMover.get(slot.mover);
    if (!l) this.byMover.set(slot.mover, (l = []));
    l.push(slot);
    if (slot.lens) this.lensSlots.push(slot);
  }

  /** Re-places the instances of every part carried by `mover` (call after changing its transform). */
  moved(mover: THREE.Object3D): void {
    const l = this.byMover.get(mover);
    if (!l || this.hidden || this.proxies) return;
    mover.updateMatrix();
    for (let i = 0; i < l.length; i++) this.place(l[i]);
  }

  /** Copies the emissive intensity of lens parts (after their materials were updated). Allocation-free. */
  syncLenses(): void {
    const l = this.lensSlots;
    for (let i = 0; i < l.length; i++) {
      const s = l[i];
      const m = s.lens!;
      const e = m.emissiveIntensity;
      if (e === s.lastEmissive) continue;
      s.lastEmissive = e;
      const a = s.batch.emissive!;
      a.setXYZ(s.index, m.emissive.r * e, m.emissive.g * e, m.emissive.b * e);
      a.needsUpdate = true;
    }
  }

  /**
   * Per-frame visibility: instances are hidden while the control or one of its
   * ancestors is invisible, and while `showProxies` is true (the original
   * meshes are drawn instead, e.g. under the hover highlight). Allocation-free.
   */
  sync(showProxies = false): void {
    let o: THREE.Object3D | null = this.controlObject;
    let visible = true;
    while (o && o !== this.root) {
      if (!o.visible) {
        visible = false;
        break;
      }
      o = o.parent;
    }
    if (!o) visible = false;
    const hidden = !visible;
    const proxies = visible && showProxies;
    if (hidden === this.hidden && proxies === this.proxies) return;
    this.hidden = hidden;
    this.proxies = proxies;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.proxy.visible = proxies;
      if (hidden || proxies) this.hide(s);
      else {
        s.mover.updateMatrix();
        this.place(s);
      }
    }
  }

  private place(s: Slot): void {
    _m.multiplyMatrices(s.base, s.mover.matrix).multiply(s.tail);
    s.batch.mesh.setMatrixAt(s.index, _m);
    s.batch.mesh.instanceMatrix.needsUpdate = true;
  }

  private hide(s: Slot): void {
    s.batch.mesh.setMatrixAt(s.index, _zero);
    s.batch.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface MovingInstanceStats {
  /** Parts drawn as instances. */
  parts: number;
  /** InstancedMesh draw calls replacing them. */
  batches: number;
}

/** Result of {@link instanceMovingParts}: the batches (children of the root) and their resources. */
export class MovingInstances {
  readonly stats: MovingInstanceStats;
  private readonly batches: InstanceBatch[];
  private readonly materials: CockpitMaterials;
  private readonly lighting: CockpitLighting;

  constructor(batches: InstanceBatch[], stats: MovingInstanceStats, materials: CockpitMaterials, lighting: CockpitLighting) {
    this.batches = batches;
    this.stats = stats;
    this.materials = materials;
    this.lighting = lighting;
  }

  /** The InstancedMesh objects (children of the cockpit root). */
  get meshes(): THREE.InstancedMesh[] {
    return this.batches.map((b) => b.mesh);
  }

  dispose(): void {
    for (const b of this.batches) {
      b.mesh.removeFromParent();
      b.mesh.dispose();
      b.ownGeometry?.dispose();
      if (b.ownMaterial) {
        this.lighting.unregister(b.ownMaterial);
        this.materials.release(b.ownMaterial);
        b.ownMaterial.dispose();
      }
    }
    this.batches.length = 0;
  }
}

interface Candidate {
  mesh: THREE.Mesh;
  mover: THREE.Object3D;
  control: THREE.Object3D;
  kind: BatchKind;
  key: string;
  /** Quad size, centre and UV rect (quads and lenses). */
  quad: { w: number; h: number; cx: number; cy: number; u0: number; v0: number; u1: number; v1: number } | null;
}

/**
 * Replaces marked moving parts under `root` by instanced batches (see the
 * file header). Call once after the cockpit is complete (CockpitBuilder.build
 * does, after static consolidation). Returns null when nothing was instanced.
 */
export function instanceMovingParts(root: THREE.Object3D, materials: CockpitMaterials, lighting: CockpitLighting, minInstances = 2): MovingInstances | null {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const found: Candidate[] = [];
  const walk = (o: THREE.Object3D, dynamic: boolean): void => {
    if (!o.visible || dynamic || o.userData.cockpitDynamic === true) return;
    const mover = MOVERS.get(o);
    const m = o as THREE.Mesh;
    if (mover && m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
      const c = classify(m, mover, root);
      if (c) found.push(c);
    }
    for (const ch of o.children) walk(ch, dynamic);
  };
  walk(root, false);
  if (!found.length) return null;

  const buckets = new Map<string, Candidate[]>();
  for (const c of found) {
    let b = buckets.get(c.key);
    if (!b) buckets.set(c.key, (b = []));
    b.push(c);
  }
  const batches: InstanceBatch[] = [];
  const perControl = new Map<THREE.Object3D, ControlInstances>();
  let parts = 0;
  const tmp = new THREE.Matrix4();
  const quadM = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < minInstances) continue;
    const first = list[0];
    const src = first.mesh.material as THREE.MeshStandardMaterial;
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;
    let ownGeo = false;
    let ownMat = false;
    if (first.kind === 'solid') {
      geometry = first.mesh.geometry;
      material = src;
    } else {
      geometry = new THREE.PlaneGeometry(1, 1);
      ownGeo = true;
      if (first.kind === 'lens') {
        material = materials.track(lensInstanceMaterial(src));
        ownMat = true;
      } else if (src.map || src.emissiveMap || src.alphaMap) {
        material = quadInstanceMaterial(src, materials);
        const z = lighting.zoneOf(src);
        if (z) lighting.registerBacklight(material as THREE.MeshStandardMaterial, z.zone, z.gain);
        ownMat = true;
      } else material = src;
    }
    const batch = new InstanceBatch(first.kind, geometry, material, list.length, ownGeo, ownMat);
    batch.mesh.renderOrder = first.mesh.renderOrder;
    list.forEach((c, i) => {
      c.mover.updateMatrix();
      const base = new THREE.Matrix4();
      if (c.mover.parent) base.multiplyMatrices(inv, c.mover.parent.matrixWorld);
      const tail = new THREE.Matrix4().copy(c.mover.matrixWorld).invert().multiply(c.mesh.matrixWorld);
      if (c.quad) {
        const q = c.quad;
        quadM.makeScale(q.w, q.h, 1).setPosition(q.cx, q.cy, 0);
        tail.multiply(quadM);
        batch.uv!.setXYZW(i, q.u0, q.v0, q.u1, q.v1);
      }
      tmp.multiplyMatrices(base, c.mover.matrix).multiply(tail);
      batch.mesh.setMatrixAt(i, tmp);
      let lens: THREE.MeshStandardMaterial | null = null;
      if (c.kind === 'lens') {
        lens = c.mesh.material as THREE.MeshStandardMaterial;
        batch.mesh.setColorAt(i, lens.color);
        const e = lens.emissiveIntensity;
        batch.emissive!.setXYZ(i, lens.emissive.r * e, lens.emissive.g * e, lens.emissive.b * e);
      }
      c.mesh.visible = false;
      let ci = perControl.get(c.control);
      if (!ci) perControl.set(c.control, (ci = new ControlInstances(c.control, root)));
      ci.add({ batch, index: i, proxy: c.mesh, mover: c.mover, base, tail, lens, lastEmissive: lens ? lens.emissiveIntensity : 0 });
    });
    // VehicleNode hides the cockpit root's children in external views unless flagged visibleFromOutside:
    // a batch carrying parts of such a group must stay visible with it.
    if (list.some((c) => seenFromOutside(c.control, root))) batch.mesh.userData.visibleFromOutside = true;
    batch.mesh.instanceMatrix.needsUpdate = true;
    if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    batch.mesh.computeBoundingSphere();
    // Parts travel a few millimetres (key press, breaker pop-out): keep the culling sphere generous.
    if (batch.mesh.boundingSphere) batch.mesh.boundingSphere.radius += 0.02;
    root.add(batch.mesh);
    batches.push(batch);
    parts += list.length;
  }
  for (const [obj, ci] of perControl) CONTROLS.set(obj, ci);
  return batches.length ? new MovingInstances(batches, { parts, batches: batches.length }, materials, lighting) : null;
}

function seenFromOutside(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.visibleFromOutside === true) return true;
  return false;
}

/** Owner control, nesting check and bucket key of a marked mesh (null = not instanceable). */
function classify(mesh: THREE.Mesh, mover: THREE.Object3D, root: THREE.Object3D): Candidate | null {
  // Owner control: nearest ancestor carrying userData.control; skip controls nested in another control.
  let control: THREE.Object3D | null = null;
  let moverIsAncestor = mover === mesh;
  for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) {
    if (o === mover) moverIsAncestor = true;
    if (o.userData.control) {
      if (control) return null; // nested control
      control = o;
    }
  }
  if (!control || !moverIsAncestor || mover === mesh) return null;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const geo = mesh.geometry;
  if (geo.type === 'PlaneGeometry' && geo.getAttribute('position')?.count === 4) {
    const quad = quadOf(geo);
    if (!quad) return null;
    if (mat.userData?.cockpitLens === true) {
      const tex = mat.emissiveMap ?? mat.map;
      return { mesh, mover, control, kind: 'lens', key: `lens|${tex ? tex.uuid : '-'}|${mat.transparent ? 't' : 'o'}`, quad };
    }
    return { mesh, mover, control, kind: 'quad', key: `quad|${mat.uuid}`, quad };
  }
  return { mesh, mover, control, kind: 'solid', key: `solid|${geo.uuid}|${mat.uuid}`, quad: null };
}

/** Size, centre and UV rectangle of a 4-vertex XY quad (a PlaneGeometry, possibly translated with custom UVs). */
function quadOf(geo: THREE.BufferGeometry): Candidate['quad'] {
  const p = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (!p || !uv) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p.getZ(i)) > 1e-9) return null;
    x0 = Math.min(x0, p.getX(i));
    x1 = Math.max(x1, p.getX(i));
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
    u0 = Math.min(u0, uv.getX(i));
    u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i));
    v1 = Math.max(v1, uv.getY(i));
  }
  // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right; texture V grows upward.
  if (!(uv.getX(0) <= uv.getX(1) && uv.getY(0) >= uv.getY(2))) return null;
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, u0, v0, u1, v1 };
}

/** Vertex patch: per-instance atlas UV rectangle for map, alpha map and emissive map. */
function patchQuadUv(shader: { vertexShader: string }): void {
  shader.vertexShader =
    'attribute vec4 instUv;\n' +
    shader.vertexShader.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = mix( instUv.xy, instUv.zw, uv );\n#endif\n#ifdef USE_ALPHAMAP\n\tvAlphaMapUv = mix( instUv.xy, instUv.zw, uv );\n#endif\n#ifdef USE_EMISSIVEMAP\n\tvEmissiveMapUv = mix( instUv.xy, instUv.zw, uv );\n#endif',
    );
}

/** Label/legend material for a quad batch: same look as `src`, UVs from the instance. */
function quadInstanceMaterial(src: THREE.MeshStandardMaterial, materials: CockpitMaterials): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.copy(src);
  m.name = `${src.name}#inst`;
  m.userData = {};
  m.onBeforeCompile = (shader) => patchQuadUv(shader);
  m.customProgramCacheKey = () => 'cockpitInstQuad';
  materials.patchInterior(m);
  return m;
}

/**
 * Lens material for a lens batch: diffuse (dark tinted lens) from the
 * instance colour, emissive colour x intensity from `instEmissive`, legend
 * UVs from `instUv`. Built from the first lens of the batch (same texture,
 * roughness, metalness).
 */
function lensInstanceMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: src.roughness,
    metalness: src.metalness,
    map: src.map,
    emissive: 0xffffff,
    emissiveMap: src.emissiveMap,
    emissiveIntensity: 1,
    transparent: src.transparent,
    depthWrite: src.depthWrite,
  });
  m.name = 'cockpit.lens#inst';
  m.onBeforeCompile = (shader) => {
    patchQuadUv(shader);
    shader.vertexShader = shader.vertexShader
      .replace('attribute vec4 instUv;\n', 'attribute vec4 instUv;\nattribute vec3 instEmissive;\nvarying vec3 vInstEmissive;\n')
      .replace('void main() {', 'void main() {\n\tvInstEmissive = instEmissive;');
    shader.fragmentShader =
      'varying vec3 vInstEmissive;\n' + shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vInstEmissive;');
  };
  m.customProgramCacheKey = () => 'cockpitInstLens';
  return m;
}
