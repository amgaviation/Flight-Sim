/**
 * Message protocol between the main thread (TileLoader) and terrain workers.
 * Plain structured-clone data; typed arrays are transferred.
 */
import type { TileMeshData, TileMeshParams } from './tileMesh';

export interface LoadRequest {
  type: 'load';
  id: number;
  z: number;
  x: number;
  y: number;
  url: string;
  /** Build a render mesh too (null: elevation only, e.g. physics tiles). */
  mesh: TileMeshParams | null;
}

export interface BuildRequest {
  type: 'build';
  id: number;
  /** Copy of the tile elevation grid (transferred to the worker). */
  elev: Float32Array;
  mesh: TileMeshParams;
}

export interface ConfigRequest {
  type: 'config';
  /** Cache Storage bucket name ('' disables the persistent cache). */
  cacheName: string;
  /** Soft cap on cached responses; oldest entries are trimmed beyond it. */
  cacheMaxEntries: number;
}

export type WorkerRequest = LoadRequest | BuildRequest | ConfigRequest;

export interface TileResponse {
  type: 'tile';
  id: number;
  z: number;
  x: number;
  y: number;
  elev: Float32Array;
  min: number;
  max: number;
  mesh: TileMeshData | null;
  /** True when the PNG came from Cache Storage. */
  cached: boolean;
}

export interface MeshResponse {
  type: 'mesh';
  id: number;
  mesh: TileMeshData;
}

export interface ErrorResponse {
  type: 'error';
  id: number;
  /** HTTP status, 0 for network errors, -1 when decoding is unsupported in the worker. */
  status: number;
  message: string;
}

export type WorkerResponse = TileResponse | MeshResponse | ErrorResponse;

/** Default Cache Storage bucket for terrarium PNGs. */
export const TERRAIN_CACHE_NAME = 'amg-terrain-terrarium-v1';
/** EST: ~6000 tiles * ~60-120 KB = 0.4-0.7 GB on disk at most. */
export const TERRAIN_CACHE_MAX_ENTRIES = 6000;
