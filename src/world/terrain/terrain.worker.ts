/**
 * Terrain worker: fetches terrarium tiles (Cache Storage + network), decodes
 * them to metres and builds render meshes off the main thread.
 *
 * Created by TileLoader with
 *   new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
 * Protocol: ./protocol.ts.
 */
import { buildTileMesh, meshTransferables } from './tileMesh';
import { configureTileCache, decodeTileBlob, fetchTileBlob, TileHttpError, canDecodeHere } from './fetchDecode';
import { TERRAIN_CACHE_MAX_ENTRIES, TERRAIN_CACHE_NAME, type WorkerRequest, type WorkerResponse } from './protocol';

// The project compiles against the DOM lib; describe the worker scope minimally.
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;

configureTileCache(TERRAIN_CACHE_NAME, TERRAIN_CACHE_MAX_ENTRIES);

function fail(id: number, e: unknown): void {
  const status = e instanceof TileHttpError ? e.status : 0;
  scope.postMessage({ type: 'error', id, status, message: String((e as Error)?.message ?? e) });
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'config':
      configureTileCache(msg.cacheName, msg.cacheMaxEntries);
      return;
    case 'load':
      void (async () => {
        try {
          if (!canDecodeHere()) throw new TileHttpError(-1, 'createImageBitmap/OffscreenCanvas unavailable in worker');
          const { blob, cached } = await fetchTileBlob(msg.url);
          const dec = await decodeTileBlob(blob);
          const mesh = msg.mesh ? buildTileMesh(dec.data, msg.mesh) : null;
          const transfer: Transferable[] = [dec.data.buffer as ArrayBuffer];
          if (mesh) transfer.push(...meshTransferables(mesh));
          scope.postMessage(
            { type: 'tile', id: msg.id, z: msg.z, x: msg.x, y: msg.y, elev: dec.data, min: dec.min, max: dec.max, mesh, cached },
            transfer,
          );
        } catch (e) {
          fail(msg.id, e);
        }
      })();
      return;
    case 'build':
      try {
        const mesh = buildTileMesh(msg.elev, msg.mesh);
        scope.postMessage({ type: 'mesh', id: msg.id, mesh }, meshTransferables(mesh));
      } catch (e) {
        fail(msg.id, e);
      }
      return;
  }
};
