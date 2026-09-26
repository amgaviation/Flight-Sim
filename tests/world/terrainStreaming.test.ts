/**
 * TerrainRenderer streaming behaviour with a synchronous stub loader
 * (a few tiles "arrive" per frame, like the worker loader at a low frame
 * rate): the LOD must converge to its desired leaves without rebuilding the
 * same tiles over and over, and must upload coarse tiles first.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TerrainRenderer } from '../../src/world/terrain/TerrainRenderer';
import { ElevationStore } from '../../src/world/terrain/ElevationStore';
import type { LoadedTile, TileLoader } from '../../src/world/terrain/TileLoader';
import { ReferenceFrame } from '../../src/world/ReferenceFrame';
import { SurfaceIndex } from '../../src/world/airports/surfaces';
import { QUALITY_PRESETS } from '../../src/world/quality';
import { buildTileMesh, type TileMeshParams } from '../../src/world/terrain/tileMesh';
import { TILE_SIZE, tileKey } from '../../src/world/terrain/tileMath';

/** Loader stand-in: queued work completes `perFrame` jobs at a time (in request order). */
class StubLoader {
  builds = 0;
  readonly buildsByKey = new Map<number, number>();
  private readonly loading = new Set<number>();
  private readonly building = new Set<number>();
  private readonly work: (() => void)[] = [];
  terrain!: TerrainRenderer;

  constructor(private readonly store: ElevationStore) {}

  get pendingCount(): number {
    return this.work.length;
  }
  isLoading(k: number): boolean {
    return this.loading.has(k);
  }
  isBuilding(k: number): boolean {
    return this.building.has(k);
  }
  isMissing(): boolean {
    return false;
  }
  beginFrame(): void {}
  endFrame(): void {}

  private countBuild(k: number): void {
    this.builds++;
    this.buildsByKey.set(k, (this.buildsByKey.get(k) ?? 0) + 1);
  }

  request(z: number, x: number, y: number, _priority: number, params: TileMeshParams | null): void {
    const k = tileKey(z, x, y);
    if (this.loading.has(k) || this.store.has(k)) return;
    this.loading.add(k);
    this.work.push(() => {
      this.loading.delete(k);
      const elev = new Float32Array(TILE_SIZE * TILE_SIZE).fill(50);
      this.store.add(z, x, y, elev, 50, 50);
      let mesh = null;
      if (params) {
        this.countBuild(k);
        mesh = buildTileMesh(elev, params);
      }
      const t: LoadedTile = { key: k, z, x, y, elev, min: 50, max: 50, mesh };
      this.terrain.handleLoaded(t);
    });
  }

  requestBuild(z: number, x: number, y: number, elev: Float32Array, params: TileMeshParams): void {
    const k = tileKey(z, x, y);
    if (this.building.has(k)) return;
    this.building.add(k);
    this.work.push(() => {
      this.building.delete(k);
      this.countBuild(k);
      this.terrain.handleMesh(k, buildTileMesh(elev, params));
    });
  }

  /** Completes up to `n` queued jobs. */
  flush(n: number): void {
    for (let i = 0; i < n && this.work.length > 0; i++) this.work.shift()!();
  }
}

function setup() {
  const frame = new ReferenceFrame(40.85, -74.06);
  const store = new ElevationStore(400);
  const loader = new StubLoader(store);
  const q = { ...QUALITY_PRESETS.low, terrainSegments: 8 }; // small meshes keep the test fast
  const terrain = new TerrainRenderer(frame, store, loader as unknown as TileLoader, new SurfaceIndex(), new THREE.MeshBasicMaterial(), q);
  loader.terrain = terrain;
  return { terrain, loader, q };
}

const CAM = { lat: 40.85, lon: -74.06, alt_m: 12 };

describe('TerrainRenderer streaming', () => {
  it('converges to its desired leaves at a low frame rate without rebuild loops', () => {
    const { terrain, loader } = setup();
    let now = 0;
    let frames = 0;
    for (; frames < 400; frames++) {
      now += 250; // 4 fps
      loader.flush(6);
      terrain.update(CAM, 60, 720, now);
      const s = terrain.getStats();
      if (s.completeness === 1 && s.pendingUploads === 0 && loader.pendingCount === 0) break;
    }
    const s = terrain.getStats();
    expect(s.completeness).toBe(1);
    expect(frames).toBeLessThan(200);
    // Each tile is built about once (the old dispose-on-upload livelock rebuilt hidden ancestors every frame).
    let worst = 0;
    for (const n of loader.buildsByKey.values()) worst = Math.max(worst, n);
    expect(worst).toBeLessThanOrEqual(2);
    expect(loader.builds).toBeLessThan(2 * loader.buildsByKey.size);
  });

  it('uploads coarse tiles before fine ones', () => {
    const { terrain, loader } = setup();
    const internal = terrain as unknown as { records: Map<number, { z: number }>; pendingMeshes: { mesh: { z: number } }[] };
    // Frame 1 requests the leaves and (coarse-first) their missing ancestors; complete all of it at once.
    terrain.update(CAM, 60, 720, 0);
    loader.flush(10_000);
    for (let i = 0; i < 6; i++) {
      terrain.update(CAM, 60, 720, 1 + i);
      loader.flush(10_000);
    }
    // One more frame: whatever is uploaded must be at least as coarse as everything still waiting.
    terrain.update(CAM, 60, 720, 100);
    const uploaded = [...internal.records.values()].map((r) => r.z);
    const waiting = internal.pendingMeshes.map((p) => p.mesh.z);
    expect(uploaded.length).toBeGreaterThan(0);
    expect(waiting.length).toBeGreaterThan(0);
    expect(Math.max(...uploaded)).toBeLessThanOrEqual(Math.min(...waiting));
  });
});
