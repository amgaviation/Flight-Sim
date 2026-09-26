/**
 * Terrain renderer: chunked quadtree LOD of terrarium tiles around the camera.
 *
 * Each frame:
 *  1. `selectTiles` picks the desired leaves (screen-space error, distance based).
 *  2. Missing leaves are requested; while they load, their nearest ancestor
 *     with a mesh is drawn instead and every descendant of that ancestor is
 *     hidden, so coverage never overlaps and never has holes once the roots
 *     are in.
 *  3. Tile meshes are placed in the floating-origin frame from their own
 *     centre (see tileMesh.ts); a recenter only re-places objects.
 *  4. Hidden meshes are kept for a few seconds (hysteresis), then disposed.
 * Tiles at z >= 11 are rebuilt when airport surfaces overlapping them change,
 * so terrain is flattened under runways.
 */
import * as THREE from 'three';
import type { GeoPosition } from '../types';
import type { ReferenceFrame } from '../ReferenceFrame';
import type { QualitySettings } from '../quality';
import { ElevationStore } from './ElevationStore';
import { TileLoader, type LoadedTile } from './TileLoader';
import { selectTiles, tileDistanceM, viewRadiusForAltitude, type LodParams } from './lod';
import { keyX, keyY, keyZ, parentKey, tileBounds, tileKey, tileSizeM, tileYToLat, type TileBounds } from './tileMath';
import type { TileMeshData, TileMeshParams } from './tileMesh';
import { TERRAIN_NOISE_PERIOD_M } from './TerrainMaterial';
import type { SurfaceIndex, FlattenSurface } from '../airports/surfaces';

/** Tiles at or above this zoom are flattened under airports. */
export const FLATTEN_MIN_ZOOM = 11;
/** Hidden meshes older than this are disposed when over the cache budget (ms). */
const HIDDEN_TTL_MS = 4000;

interface TileRecord {
  key: number;
  z: number;
  x: number;
  y: number;
  mesh: THREE.Mesh;
  centerLat: number;
  centerLon: number;
  minElev: number;
  maxElev: number;
  lastShown: number;
  /** Signature of the airport surfaces baked into the mesh. */
  surfSig: string;
  segments: number;
  /** Needs a rebuild (airport surfaces or resolution changed since it was built). */
  stale: boolean;
}

export interface TerrainStats {
  leaves: number;
  shown: number;
  meshes: number;
  triangles: number;
  pendingLoads: number;
  /** Finished meshes waiting for their (budgeted) upload. */
  pendingUploads: number;
  /** Desired leaves that have their own mesh (0..1): 1 = fully streamed at target LOD. */
  completeness: number;
  thresholdPx: number;
  viewRadiusM: number;
}

const _bounds: TileBounds = { west: 0, east: 0, north: 0, south: 0 };

function surfSignature(list: readonly FlattenSurface[]): string {
  if (list.length === 0) return '';
  let s = '';
  for (const sf of list) s += sf.id + '|';
  return s;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private readonly records = new Map<number, TileRecord>();
  private readonly pendingMeshes: { key: number; mesh: TileMeshData; sig: string }[] = [];
  /** Keys with a finished mesh waiting in `pendingMeshes`. */
  private readonly pendingKeys = new Set<number>();
  private readonly requestedSig = new Map<number, string>();
  private readonly failed = new Set<number>();
  private readonly desired: number[] = [];
  private readonly shown = new Set<number>();
  private readonly fallbacks = new Set<number>();
  private readonly candidates: number[] = [];
  private lastSurfaceVersion = -1;
  private candidatesOwn = 0;
  private readonly hiddenScratch: TileRecord[] = [];
  private readonly lod: LodParams;
  private stats: TerrainStats = { leaves: 0, shown: 0, meshes: 0, triangles: 0, pendingLoads: 0, pendingUploads: 0, completeness: 0, thresholdPx: 0, viewRadiusM: 0 };
  /** Ground elevation under the camera used for view-radius selection (m). */
  groundElevationM = 0;

  constructor(
    private readonly frame: ReferenceFrame,
    private readonly store: ElevationStore,
    private readonly loader: TileLoader,
    private readonly surfaces: SurfaceIndex,
    private readonly material: THREE.Material,
    private quality: QualitySettings,
  ) {
    this.group.name = 'terrain';
    this.lod = {
      rootZoom: 5,
      maxZoom: quality.maxRenderZoom,
      segments: quality.terrainSegments,
      viewRadiusM: quality.maxViewRadiusM,
      sseThresholdPx: quality.sseThresholdPx,
      screenHeightPx: 1080,
      fovYDeg: 60,
      maxLeaves: quality.maxLeaves,
    };
    this.store.onEvict = null;
    frame.onRecenter(() => this.replaceAll());
  }

  setQuality(q: QualitySettings): void {
    const segChanged = q.terrainSegments !== this.quality.terrainSegments;
    this.quality = q;
    this.lod.maxZoom = q.maxRenderZoom;
    this.lod.segments = q.terrainSegments;
    this.lod.sseThresholdPx = q.sseThresholdPx;
    this.lod.maxLeaves = q.maxLeaves;
    if (segChanged) {
      // Existing meshes stay until rebuilt at the new resolution.
      for (const r of this.records.values()) r.stale = true;
    }
  }

  getStats(): TerrainStats {
    return this.stats;
  }

  /** Called by the loader when a tile's elevation (and maybe mesh) arrives. */
  handleLoaded(t: LoadedTile): void {
    if (t.mesh) this.queueMesh(t.key, t.mesh);
  }

  handleMesh(key: number, mesh: TileMeshData): void {
    this.queueMesh(key, mesh);
  }

  private queueMesh(key: number, mesh: TileMeshData): void {
    const sig = this.requestedSig.get(key) ?? '';
    if (this.pendingKeys.has(key)) {
      // Replace the older pending build for the same tile.
      const i = this.pendingMeshes.findIndex((p) => p.key === key);
      if (i >= 0) this.pendingMeshes[i] = { key, mesh, sig };
      return;
    }
    this.pendingKeys.add(key);
    this.pendingMeshes.push({ key, mesh, sig });
  }

  handleFailed(key: number): void {
    this.failed.add(key);
  }

  private meshParams(z: number, x: number, y: number): { params: TileMeshParams; sig: string } {
    let list: FlattenSurface[] = [];
    if (z >= FLATTEN_MIN_ZOOM) {
      tileBounds(z, x, y, _bounds);
      list = this.surfaces.inBox(_bounds.south, _bounds.west, _bounds.north, _bounds.east);
    }
    const spacing = tileSizeM(z, tileYToLat(y + 0.5, z)) / this.quality.terrainSegments;
    return {
      params: {
        z,
        x,
        y,
        segments: this.quality.terrainSegments,
        skirtDepthM: Math.min(2500, Math.max(15, spacing * 0.35)),
        surfaces: list,
        noisePeriodM: TERRAIN_NOISE_PERIOD_M,
      },
      sig: surfSignature(list),
    };
  }

  /** Requests the mesh for a tile, reusing elevation already in the store. */
  private requestMesh(key: number, priority: number): void {
    const z = keyZ(key);
    const x = keyX(key);
    const y = keyY(key);
    if (this.failed.has(key)) {
      if (this.loader.isMissing(key)) return;
      this.failed.delete(key);
    }
    if (this.pendingKeys.has(key)) return; // a finished mesh is already waiting for upload
    const { params, sig } = this.meshParams(z, x, y);
    const data = this.store.get(key);
    if (data) {
      if (this.loader.isBuilding(key)) return;
      this.requestedSig.set(key, sig);
      this.loader.requestBuild(z, x, y, data.data.slice(), params, priority - 100);
    } else {
      if (!this.loader.isLoading(key)) this.requestedSig.set(key, sig);
      this.loader.request(z, x, y, priority, params);
    }
  }

  private upload(maxCount: number): void {
    let n = 0;
    while (this.pendingMeshes.length > 0 && n < maxCount) {
      const { key, mesh: m, sig } = this.pendingMeshes.shift()!;
      this.pendingKeys.delete(key);
      n++;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      g.setAttribute('aTerrain', new THREE.BufferAttribute(m.terrain, 4));
      g.setAttribute('aFlat', new THREE.BufferAttribute(m.flat, 1));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(m.bsCenter[0], m.bsCenter[1], m.bsCenter[2]), m.bsRadius);
      const prev = this.records.get(key);
      const mesh = new THREE.Mesh(g, this.material);
      mesh.name = `tile ${m.z}/${m.x}/${m.y}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = true;
      this.frame.placeObject(mesh, m.centerLat, m.centerLon, 0);
      mesh.visible = prev ? prev.mesh.visible : false;
      this.group.add(mesh);
      if (prev) this.disposeRecord(prev);
      this.records.set(key, {
        key,
        z: m.z,
        x: m.x,
        y: m.y,
        mesh,
        centerLat: m.centerLat,
        centerLon: m.centerLon,
        minElev: m.minElev,
        maxElev: m.maxElev,
        lastShown: prev ? prev.lastShown : 0,
        surfSig: sig,
        segments: this.quality.terrainSegments,
        // Surfaces may have changed while this mesh was being built.
        stale: m.z >= FLATTEN_MIN_ZOOM && this.meshParams(m.z, m.x, m.y).sig !== sig,
      });
    }
  }

  private disposeRecord(r: TileRecord): void {
    this.group.remove(r.mesh);
    r.mesh.geometry.dispose();
    this.records.delete(r.key);
  }

  private replaceAll(): void {
    for (const r of this.records.values()) this.frame.placeObject(r.mesh, r.centerLat, r.centerLon, 0);
  }

  /** Elevation range of a tile if known (mesh record, stored data, or an ancestor's). */
  private readonly elevRange = (key: number, out: Float64Array): boolean => {
    const r = this.records.get(key);
    if (r) {
      out[0] = r.minElev;
      out[1] = r.maxElev;
      return true;
    }
    const t = this.store.get(key);
    if (t) {
      out[0] = t.min;
      out[1] = t.max;
      return true;
    }
    return false;
  };

  private hasFallbackAncestor(key: number): boolean {
    let k = key;
    while (keyZ(k) > 0) {
      k = parentKey(k);
      if (this.fallbacks.has(k)) return true;
    }
    return false;
  }

  /**
   * Updates LOD, requests and visibility. Call between loader.beginFrame()
   * and loader.endFrame(). `cam` is the camera's geodetic position.
   */
  update(cam: GeoPosition, fovYDeg: number, screenHeightPx: number, nowMs: number): void {
    // Airport surfaces changed: flag affected high-zoom meshes for rebuild.
    const sv = this.surfaces.version;
    const surfacesChanged = sv !== this.lastSurfaceVersion;
    this.lastSurfaceVersion = sv;

    this.upload(this.quality.meshUploadsPerFrame);

    const lod = this.lod;
    lod.fovYDeg = fovYDeg;
    lod.screenHeightPx = Math.max(240, screenHeightPx);
    lod.viewRadiusM = viewRadiusForAltitude(cam.alt_m - this.groundElevationM, this.quality.minViewRadiusM, this.quality.maxViewRadiusM);
    lod.rootZoom = lod.viewRadiusM > 380_000 ? 5 : 6;
    const threshold = selectTiles(cam, lod, this.elevRange, this.desired);

    this.fallbacks.clear();
    this.candidates.length = 0;
    this.candidatesOwn = 0;
    const camLat = cam.lat;
    for (const key of this.desired) {
      const z = keyZ(key);
      const x = keyX(key);
      const y = keyY(key);
      const r = this.records.get(key);
      const size = tileSizeM(z, camLat);
      const d = tileDistanceM(z, x, y, cam, r ? r.minElev : 0, r ? r.maxElev : 0);
      const priority = d / (size * 4) + (z - lod.rootZoom) * 0.35;
      if (r) {
        if (surfacesChanged && z >= FLATTEN_MIN_ZOOM && this.meshParams(z, x, y).sig !== r.surfSig) r.stale = true;
        if (r.stale || r.segments !== this.quality.terrainSegments) this.requestMesh(key, priority);
        this.candidates.push(key);
        this.candidatesOwn++;
      } else {
        this.requestMesh(key, priority);
      }
      if (!r) {
        // Find the nearest ancestor with a mesh; request missing ancestors coarse-first.
        let k = key;
        let pz = z;
        let found = false;
        while (pz > lod.rootZoom) {
          k = parentKey(k);
          pz--;
          if (this.records.has(k)) {
            this.fallbacks.add(k);
            found = true;
            break;
          }
          this.requestMesh(k, priority - 2 - (z - pz) * 0.5);
        }
        // Zooming out: the coarse tile is not loaded yet but its four children are.
        if (!found && z < lod.maxZoom) {
          const cz = z + 1;
          const c0 = tileKey(cz, x * 2, y * 2);
          const c1 = tileKey(cz, x * 2 + 1, y * 2);
          const c2 = tileKey(cz, x * 2, y * 2 + 1);
          const c3 = tileKey(cz, x * 2 + 1, y * 2 + 1);
          if (this.records.has(c0) && this.records.has(c1) && this.records.has(c2) && this.records.has(c3)) {
            this.candidates.push(c0, c1, c2, c3);
          }
        }
      }
    }

    // Visibility: candidates unless covered by a fallback ancestor; fallbacks unless nested.
    this.shown.clear();
    for (const key of this.candidates) if (!this.hasFallbackAncestor(key)) this.shown.add(key);
    for (const key of this.fallbacks) if (!this.hasFallbackAncestor(key)) this.shown.add(key);

    let triangles = 0;
    for (const r of this.records.values()) {
      const vis = this.shown.has(r.key);
      r.mesh.visible = vis;
      if (vis) {
        r.lastShown = nowMs;
        const idx = r.mesh.geometry.index;
        if (idx) triangles += idx.count / 3;
      }
    }

    // Dispose long-hidden meshes beyond the cache budget, oldest first.
    const hidden = this.hiddenScratch;
    hidden.length = 0;
    for (const r of this.records.values()) {
      // Keep the coarse levels resident: they are the fallback coverage when zooming out.
      if (r.z <= lod.rootZoom + 2) continue;
      if (!r.mesh.visible && nowMs - r.lastShown > HIDDEN_TTL_MS) hidden.push(r);
    }
    const excess = this.records.size - this.shown.size - this.quality.meshCacheTiles;
    if (excess > 0 && hidden.length > 0) {
      hidden.sort((a, b) => a.lastShown - b.lastShown);
      for (let i = 0; i < Math.min(excess, hidden.length); i++) this.disposeRecord(hidden[i]);
    }

    this.stats = {
      leaves: this.desired.length,
      shown: this.shown.size,
      meshes: this.records.size,
      triangles,
      pendingLoads: this.loader.pendingCount,
      pendingUploads: this.pendingMeshes.length,
      completeness: this.desired.length > 0 ? this.candidatesOwn / this.desired.length : 0,
      thresholdPx: threshold,
      viewRadiusM: lod.viewRadiusM,
    };
  }

  /** Disposes every mesh (the shared material is owned by the World). */
  dispose(): void {
    for (const r of [...this.records.values()]) this.disposeRecord(r);
    this.pendingMeshes.length = 0;
    this.pendingKeys.clear();
  }
}
