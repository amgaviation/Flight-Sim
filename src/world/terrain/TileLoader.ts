/**
 * Main-thread terrain tile scheduler.
 *
 * - Priority queue of wanted tiles, re-prioritised every frame by the terrain
 *   renderer (`beginFrame` / `request` / `endFrame`): tiles no longer wanted
 *   are dropped before they are fetched.
 * - A small pool of module workers (fetch + decode + mesh build). If workers
 *   cannot be created or cannot decode, the same work runs on the main thread.
 * - Retries network failures with exponential backoff; HTTP 4xx are
 *   remembered as missing for a while.
 */
import { tileKey, tileUrl } from './tileMath';
import { buildTileMesh, type TileMeshData, type TileMeshParams } from './tileMesh';
import { configureTileCache, decodeTileBlob, fetchTileBlob, TileHttpError, canDecodeHere } from './fetchDecode';
import { TERRAIN_CACHE_MAX_ENTRIES, TERRAIN_CACHE_NAME, type WorkerRequest, type WorkerResponse } from './protocol';

export interface LoadedTile {
  key: number;
  z: number;
  x: number;
  y: number;
  elev: Float32Array;
  min: number;
  max: number;
  mesh: TileMeshData | null;
}

export interface TileLoaderOptions {
  urlTemplate: string;
  maxConcurrent: number;
  /** Number of workers (0 forces main-thread loading). */
  workers: number;
}

interface Job {
  id: number;
  key: number;
  kind: 'load' | 'build';
  z: number;
  x: number;
  y: number;
  priority: number;
  mesh: TileMeshParams | null;
  elev: Float32Array | null;
  wanted: boolean;
  attempts: number;
  notBefore: number;
  slot: WorkerSlot | null;
}

interface WorkerSlot {
  worker: Worker;
  busy: number;
  broken: boolean;
}

const RETRY_BASE_MS = 1500;
const MAX_ATTEMPTS = 4;
/** How long a 4xx tile is remembered as missing (ms). */
const MISSING_TTL_MS = 10 * 60_000;

export class TileLoader {
  onLoaded: ((t: LoadedTile) => void) | null = null;
  onMesh: ((key: number, mesh: TileMeshData) => void) | null = null;
  /** Permanent (for now) failure: the renderer stops asking for this tile. */
  onFailed: ((key: number) => void) | null = null;

  private readonly queue = new Map<number, Job>(); // by key (load jobs)
  private readonly buildQueue = new Map<number, Job>(); // by key (mesh rebuild jobs)
  private readonly inflight = new Map<number, Job>(); // by job id
  private readonly inflightKeys = new Set<number>();
  private readonly inflightBuildKeys = new Set<number>();
  private readonly missing = new Map<number, number>(); // key -> expiry ms
  private readonly slots: WorkerSlot[] = [];
  private nextId = 1;
  private rr = 0;
  private disposed = false;
  private mainThreadBusy = 0;
  /** Counters for diagnostics. */
  readonly stats = { loaded: 0, cached: 0, failed: 0, retries: 0, built: 0 };

  constructor(private opts: TileLoaderOptions) {
    configureTileCache(TERRAIN_CACHE_NAME, TERRAIN_CACHE_MAX_ENTRIES);
    if (typeof Worker !== 'undefined') {
      for (let i = 0; i < opts.workers; i++) {
        try {
          const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module', name: `terrain-${i}` });
          const slot: WorkerSlot = { worker, busy: 0, broken: false };
          worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorkerMessage(slot, ev.data);
          worker.onerror = (ev) => {
            ev.preventDefault?.();
            slot.broken = true;
            // Requeue whatever this worker was doing; it will run elsewhere.
            for (const j of [...this.inflight.values()]) {
              if (j.slot !== slot) continue;
              this.finish(j);
              if (j.kind === 'load') this.requeue(j, 0);
            }
            if (!this.disposed) this.dispatch();
          };
          const cfg: WorkerRequest = { type: 'config', cacheName: TERRAIN_CACHE_NAME, cacheMaxEntries: TERRAIN_CACHE_MAX_ENTRIES };
          worker.postMessage(cfg);
          this.slots.push(slot);
        } catch {
          break; // fall back to the main thread
        }
      }
    }
  }

  setMaxConcurrent(n: number): void {
    this.opts.maxConcurrent = Math.max(1, n);
  }

  get pendingCount(): number {
    return this.queue.size + this.inflight.size + this.buildQueue.size;
  }

  /** True while a load for `key` is queued or in flight. */
  isLoading(key: number): boolean {
    return this.queue.has(key) || this.inflightKeys.has(key);
  }

  isBuilding(key: number): boolean {
    return this.buildQueue.has(key) || this.inflightBuildKeys.has(key);
  }

  /** True when the tile is known to be unavailable (recent 4xx or exhausted retries). */
  isMissing(key: number, nowMs = Date.now()): boolean {
    const exp = this.missing.get(key);
    if (exp === undefined) return false;
    if (exp < nowMs) {
      this.missing.delete(key);
      return false;
    }
    return true;
  }

  /** Marks all queued jobs unwanted; `request` re-marks the ones still needed. */
  beginFrame(): void {
    for (const j of this.queue.values()) j.wanted = false;
  }

  /**
   * Requests a tile (lower priority value = sooner). `mesh` non-null asks for
   * a render mesh too; physics-only requests pass null.
   */
  request(z: number, x: number, y: number, priority: number, mesh: TileMeshParams | null): void {
    if (this.disposed) return;
    const key = tileKey(z, x, y);
    if (this.inflightKeys.has(key)) return;
    if (this.isMissing(key)) return;
    const j = this.queue.get(key);
    if (j) {
      j.wanted = true;
      j.priority = Math.min(j.priority, priority);
      if (mesh && !j.mesh) j.mesh = mesh;
      return;
    }
    this.queue.set(key, { id: 0, key, kind: 'load', z, x, y, priority, mesh, elev: null, wanted: true, attempts: 0, notBefore: 0, slot: null });
  }

  /** Requests a mesh (re)build from elevation data already on the main thread (copied). */
  requestBuild(z: number, x: number, y: number, elev: Float32Array, mesh: TileMeshParams, priority: number): void {
    if (this.disposed) return;
    const key = tileKey(z, x, y);
    if (this.inflightBuildKeys.has(key)) return;
    const j = this.buildQueue.get(key);
    if (j) {
      j.mesh = mesh;
      j.priority = Math.min(j.priority, priority);
      return;
    }
    this.buildQueue.set(key, { id: 0, key, kind: 'build', z, x, y, priority, mesh, elev, wanted: true, attempts: 0, notBefore: 0, slot: null });
  }

  cancelBuild(key: number): void {
    this.buildQueue.delete(key);
  }

  /** Dispatches queued jobs without dropping anything (usable between frames). */
  pump(): void {
    if (!this.disposed) this.dispatch();
  }

  /** Drops unwanted queued loads and dispatches jobs up to the concurrency limit. */
  endFrame(): void {
    for (const [k, j] of this.queue) if (!j.wanted) this.queue.delete(k);
    this.dispatch();
  }

  private pickNext(map: Map<number, Job>, now: number): Job | null {
    let best: Job | null = null;
    for (const j of map.values()) {
      if (j.notBefore > now) continue;
      if (!best || j.priority < best.priority) best = j;
    }
    return best;
  }

  private dispatch(): void {
    const now = Date.now();
    // Mesh rebuilds are cheap and do not need the network: run them first.
    while (this.inflight.size < this.opts.maxConcurrent + 2) {
      const j = this.pickNext(this.buildQueue, now);
      if (!j) break;
      this.buildQueue.delete(j.key);
      this.start(j);
    }
    while (this.inflight.size < this.opts.maxConcurrent) {
      const j = this.pickNext(this.queue, now);
      if (!j) break;
      this.queue.delete(j.key);
      this.start(j);
    }
  }

  private liveSlot(): WorkerSlot | null {
    const live = this.slots.filter((s) => !s.broken);
    if (live.length === 0) return null;
    // Least busy, round-robin on ties.
    let best: WorkerSlot | null = null;
    for (let i = 0; i < live.length; i++) {
      const s = live[(this.rr + i) % live.length];
      if (!best || s.busy < best.busy) best = s;
    }
    this.rr++;
    return best;
  }

  private start(j: Job): void {
    j.id = this.nextId++;
    this.inflight.set(j.id, j);
    if (j.kind === 'load') this.inflightKeys.add(j.key);
    else this.inflightBuildKeys.add(j.key);
    const slot = this.liveSlot();
    if (slot) {
      slot.busy++;
      if (j.kind === 'load') {
        const req: WorkerRequest = { type: 'load', id: j.id, z: j.z, x: j.x, y: j.y, url: tileUrl(this.opts.urlTemplate, j.z, j.x, j.y), mesh: j.mesh };
        slot.worker.postMessage(req);
      } else {
        const elev = j.elev!;
        const req: WorkerRequest = { type: 'build', id: j.id, elev, mesh: j.mesh! };
        slot.worker.postMessage(req, [elev.buffer as ArrayBuffer]);
        j.elev = null;
      }
      j.slot = slot;
    } else {
      j.slot = null;
      void this.runOnMainThread(j);
    }
  }

  private finish(j: Job): void {
    this.inflight.delete(j.id);
    if (j.kind === 'load') this.inflightKeys.delete(j.key);
    else this.inflightBuildKeys.delete(j.key);
    if (j.slot) j.slot.busy = Math.max(0, j.slot.busy - 1);
    j.slot = null;
  }

  private onWorkerMessage(slot: WorkerSlot, msg: WorkerResponse): void {
    const j = this.inflight.get(msg.id);
    if (!j) return;
    this.finish(j);
    if (this.disposed) return;
    if (msg.type === 'tile') {
      this.stats.loaded++;
      if (msg.cached) this.stats.cached++;
      this.onLoaded?.({ key: j.key, z: msg.z, x: msg.x, y: msg.y, elev: msg.elev, min: msg.min, max: msg.max, mesh: msg.mesh });
    } else if (msg.type === 'mesh') {
      this.stats.built++;
      this.onMesh?.(j.key, msg.mesh);
    } else {
      if (msg.status === -1) {
        // Worker cannot decode here: stop using workers, retry on the main thread.
        slot.broken = true;
        j.attempts = 0;
        this.requeue(j, 0);
      } else this.handleError(j, msg.status);
    }
    this.dispatch();
  }

  private requeue(j: Job, delayMs: number): void {
    j.notBefore = Date.now() + delayMs;
    j.wanted = true;
    if (j.kind === 'load') {
      if (!this.queue.has(j.key)) this.queue.set(j.key, j);
    } else if (!this.buildQueue.has(j.key)) this.buildQueue.set(j.key, j);
  }

  private handleError(j: Job, status: number): void {
    if (j.kind === 'build') return; // renderer will ask again if still needed
    if (status >= 400 && status < 500) {
      this.missing.set(j.key, Date.now() + MISSING_TTL_MS);
      this.stats.failed++;
      this.onFailed?.(j.key);
      return;
    }
    j.attempts++;
    if (j.attempts >= MAX_ATTEMPTS) {
      this.missing.set(j.key, Date.now() + 60_000);
      this.stats.failed++;
      this.onFailed?.(j.key);
      return;
    }
    this.stats.retries++;
    this.requeue(j, RETRY_BASE_MS * 2 ** (j.attempts - 1));
  }

  private async runOnMainThread(j: Job): Promise<void> {
    this.mainThreadBusy++;
    try {
      if (j.kind === 'load') {
        if (!canDecodeHere()) throw new TileHttpError(-3, 'no PNG decoder available');
        const { blob, cached } = await fetchTileBlob(tileUrl(this.opts.urlTemplate, j.z, j.x, j.y));
        const dec = await decodeTileBlob(blob);
        const mesh = j.mesh ? buildTileMesh(dec.data, j.mesh) : null;
        this.finish(j);
        if (this.disposed) return;
        this.stats.loaded++;
        if (cached) this.stats.cached++;
        this.onLoaded?.({ key: j.key, z: j.z, x: j.x, y: j.y, elev: dec.data, min: dec.min, max: dec.max, mesh });
      } else {
        const mesh = buildTileMesh(j.elev!, j.mesh!);
        this.finish(j);
        if (this.disposed) return;
        this.stats.built++;
        this.onMesh?.(j.key, mesh);
      }
    } catch (e) {
      this.finish(j);
      if (this.disposed) return;
      const status = e instanceof TileHttpError ? e.status : 0;
      if (status === -3) {
        this.missing.set(j.key, Date.now() + MISSING_TTL_MS);
        this.onFailed?.(j.key);
      } else this.handleError(j, status);
    } finally {
      this.mainThreadBusy--;
      if (!this.disposed) this.dispatch();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots) s.worker.terminate();
    this.slots.length = 0;
    this.queue.clear();
    this.buildQueue.clear();
    this.inflight.clear();
    this.inflightKeys.clear();
    this.inflightBuildKeys.clear();
  }
}
