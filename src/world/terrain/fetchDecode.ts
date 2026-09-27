/**
 * Terrarium PNG fetch + decode, usable from a worker or the main thread.
 *
 * - Responses are cached in Cache Storage when available. `caches` only
 *   exists in secure contexts (https, localhost, Electron app://) and may
 *   throw SecurityError; every access is guarded and failures fall back to
 *   plain fetch.
 * - Decoding uses createImageBitmap with premultiplyAlpha 'none' and
 *   colorSpaceConversion 'none' so RGB bytes (the elevation encoding) are
 *   never colour-managed, then an OffscreenCanvas (or a DOM canvas) readback.
 */
import { decodeTerrarium, type DecodedElevation } from './terrarium';
import { TILE_SIZE } from './tileMath';

export class TileHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let cachePromise: Promise<Cache | null> | null = null;
let cacheName = '';
let cacheMax = 0;
let putsSinceTrim = 0;

/** Configures the persistent cache ('' disables it). */
export function configureTileCache(name: string, maxEntries: number): void {
  cacheName = name;
  cacheMax = maxEntries;
  cachePromise = null;
}

function openCache(): Promise<Cache | null> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    if (!cacheName) return null;
    try {
      if (typeof caches === 'undefined' || !caches) return null;
      return await caches.open(cacheName);
    } catch {
      return null; // insecure context or storage disabled
    }
  })();
  return cachePromise;
}

async function trimCache(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    const excess = keys.length - cacheMax;
    // Cache.keys() returns requests in insertion order (Service Workers spec), oldest first.
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch {
    /* ignore */
  }
}

/** Fetches a tile PNG as a Blob, using Cache Storage when possible. */
export async function fetchTileBlob(url: string): Promise<{ blob: Blob; cached: boolean }> {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return { blob: await hit.blob(), cached: true };
    } catch {
      /* fall through to network */
    }
  }
  // A stalled request (proxy or network hiccup) used to hold its tile forever, and a ground start then
  // waited out the app's 120 s scenery timeout (jets QA). Abort it so the loader retries (status 0).
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TILE_FETCH_TIMEOUT_MS) : null;
  try {
    let res: Response;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl?.signal });
    } catch (e) {
      throw new TileHttpError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) throw new TileHttpError(res.status, `HTTP ${res.status}`);
    let blob: Blob;
    try {
      blob = await res.clone().blob();
    } catch (e) {
      throw new TileHttpError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (cache) {
      try {
        await cache.put(url, res);
        if (cacheMax > 0 && ++putsSinceTrim >= 200) {
          putsSinceTrim = 0;
          void trimCache(cache);
        }
      } catch {
        /* quota or opaque response: ignore */
      }
    }
    return { blob, cached: false };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Per-request time limit for a terrain tile (fetch + body), ms. EST: tiles are ~50-150 kB. */
export const TILE_FETCH_TIMEOUT_MS = 20_000;

let scratchCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function getCanvas(): OffscreenCanvas | HTMLCanvasElement {
  if (scratchCanvas) return scratchCanvas;
  if (typeof OffscreenCanvas !== 'undefined') scratchCanvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  else if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    scratchCanvas = c;
  } else throw new TileHttpError(-1, 'no canvas available to decode PNG');
  return scratchCanvas;
}

/** True when this context can decode PNGs to pixels. */
export function canDecodeHere(): boolean {
  return typeof createImageBitmap === 'function' && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
}

/** Decodes a terrarium PNG Blob into elevations (metres). */
export async function decodeTileBlob(blob: Blob): Promise<DecodedElevation> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = getCanvas();
    if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
      canvas.width = bmp.width;
      canvas.height = bmp.height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new TileHttpError(-1, '2d context unavailable');
    ctx.clearRect(0, 0, bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.width !== TILE_SIZE || bmp.height !== TILE_SIZE) throw new TileHttpError(-2, `unexpected tile size ${bmp.width}x${bmp.height}`);
    return decodeTerrarium(img.data);
  } finally {
    bmp.close();
  }
}
