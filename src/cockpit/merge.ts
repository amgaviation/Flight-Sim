/**
 * Static mesh consolidation for cockpits.
 *
 * A cockpit has thousands of small static parts (switch bushings, knob
 * shafts, bezels, engraved labels). After construction, meshes flagged
 * `userData.cockpitStatic = true` are consolidated relative to the cockpit
 * root:
 *  - parts sharing geometry and material (e.g. 300 toggle bushings) become
 *    one THREE.InstancedMesh (no vertex duplication);
 *  - remaining parts are merged per material (labels of all panels become a
 *    handful of meshes).
 *
 * Excluded: meshes below an ancestor flagged `userData.cockpitDynamic = true`
 * (yokes, pedals, anything the aircraft animates), multi-material meshes and
 * instanced meshes. Transforms are frozen at consolidation time.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prepareForMerge } from './geometry/primitives';

export interface MergeStats {
  inputMeshes: number;
  instanced: number;
  merged: number;
  outputMeshes: number;
}

/** Consolidates static meshes under `root`. Returns the created meshes (owned by the caller) and stats. */
export function consolidateStatic(root: THREE.Object3D, minInstances = 3): { meshes: THREE.Mesh[]; stats: MergeStats } {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const candidates: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D, dynamic: boolean): void => {
    const dyn = dynamic || o.userData.cockpitDynamic === true;
    const m = o as THREE.Mesh;
    if (!dyn && m.isMesh && m.userData.cockpitStatic === true && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && m.visible) {
      candidates.push(m);
    }
    for (const c of o.children) walk(c, dyn);
  };
  walk(root, false);

  // Bucket by geometry + material.
  const byGeoMat = new Map<string, THREE.Mesh[]>();
  for (const m of candidates) {
    const key = `${m.geometry.uuid}|${(m.material as THREE.Material).uuid}`;
    let b = byGeoMat.get(key);
    if (!b) byGeoMat.set(key, (b = []));
    b.push(m);
  }
  const out: THREE.Mesh[] = [];
  const toMerge = new Map<THREE.Material, THREE.Mesh[]>();
  const rel = new THREE.Matrix4();
  let instanced = 0;
  for (const bucket of byGeoMat.values()) {
    const mat = bucket[0].material as THREE.Material;
    if (bucket.length >= minInstances) {
      const im = new THREE.InstancedMesh(bucket[0].geometry, mat, bucket.length);
      bucket.forEach((m, i) => {
        rel.multiplyMatrices(inv, m.matrixWorld);
        im.setMatrixAt(i, rel);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.renderOrder = bucket[0].renderOrder;
      im.name = `static-inst:${mat.name}`;
      im.userData.cockpitMerged = true;
      out.push(im);
      instanced += bucket.length;
    } else {
      let list = toMerge.get(mat);
      if (!list) toMerge.set(mat, (list = []));
      list.push(...bucket);
    }
  }
  let merged = 0;
  for (const [mat, list] of toMerge) {
    if (list.length < 2) {
      // Not worth merging; keep the original mesh.
      continue;
    }
    const geoms: THREE.BufferGeometry[] = [];
    for (const m of list) {
      const g = prepareForMerge(m.geometry);
      rel.multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(rel);
      geoms.push(g);
    }
    const g = mergeGeometries(geoms, false);
    for (const x of geoms) x.dispose();
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = list[0].renderOrder;
    mesh.name = `static-merged:${mat.name}`;
    mesh.userData.cockpitMerged = true;
    mesh.userData.ownsGeometry = true;
    out.push(mesh);
    merged += list.length;
    for (const m of list) m.userData.__consolidated = true;
  }
  // Remove consolidated originals.
  for (const m of candidates) {
    const key = `${m.geometry.uuid}|${(m.material as THREE.Material).uuid}`;
    const inInstanced = (byGeoMat.get(key)?.length ?? 0) >= minInstances;
    if (inInstanced || m.userData.__consolidated) {
      m.removeFromParent();
      delete m.userData.__consolidated;
    }
  }
  for (const m of out) root.add(m);
  return { meshes: out, stats: { inputMeshes: candidates.length, instanced, merged, outputMeshes: out.length } };
}
