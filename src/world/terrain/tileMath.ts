/**
 * Web Mercator (EPSG:3857) XYZ tile math for the AWS Terrain Tiles pyramid.
 *
 * Tiles are 256 x 256 px, zoom 0..15, x east from the antimeridian, y south
 * from 85.0511 N (Mapzen/AWS "terrarium" layout, identical to OSM slippy map
 * tiles: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames).
 */
import { DEG2RAD, MERCATOR_CIRCUMFERENCE_M, RAD2DEG } from '../geo';

/** Pixels per tile edge. */
export const TILE_SIZE = 256;
/** Deepest zoom published by AWS Terrain Tiles (terrarium). */
export const MAX_TILE_ZOOM = 15;
/** Latitude limit of the Web Mercator projection (deg). */
export const MAX_MERCATOR_LAT = 85.0511287798066;

const TWO15 = 32768; // 2^15: x, y < 2^15 at z <= 15
const TWO30 = TWO15 * TWO15;

/** Packs (z, x, y) into a unique safe integer key. */
export function tileKey(z: number, x: number, y: number): number {
  return z * TWO30 + x * TWO15 + y;
}

export function keyZ(key: number): number {
  return Math.floor(key / TWO30);
}

export function keyX(key: number): number {
  return Math.floor(key / TWO15) % TWO15;
}

export function keyY(key: number): number {
  return key % TWO15;
}

/** Key of the parent tile (z - 1). Undefined behaviour at z = 0. */
export function parentKey(key: number): number {
  return tileKey(keyZ(key) - 1, keyX(key) >> 1, keyY(key) >> 1);
}

/** Wraps a tile x index into [0, 2^z). */
export function wrapTileX(x: number, z: number): number {
  const n = 1 << z;
  return ((x % n) + n) % n;
}

/** Normalized Mercator x in [0, 1) for a longitude. */
export function mercatorX(lonDeg: number): number {
  const x = (lonDeg + 180) / 360;
  return x - Math.floor(x);
}

/** Normalized Mercator y in [0, 1] (0 = north limit) for a latitude (clamped). */
export function mercatorY(latDeg: number): number {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latDeg)) * DEG2RAD;
  return (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
}

/** Inverse of `mercatorY`. */
export function mercatorYToLat(my: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * RAD2DEG;
}

/** Fractional tile x at zoom z. */
export function lonToTileX(lonDeg: number, z: number): number {
  return mercatorX(lonDeg) * (1 << z);
}

/** Fractional tile y at zoom z. */
export function latToTileY(latDeg: number, z: number): number {
  return mercatorY(latDeg) * (1 << z);
}

/** Longitude of a tile x edge (may be fractional). */
export function tileXToLon(x: number, z: number): number {
  return (x / (1 << z)) * 360 - 180;
}

/** Latitude of a tile y edge (may be fractional). */
export function tileYToLat(y: number, z: number): number {
  return mercatorYToLat(y / (1 << z));
}

export interface TileBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

export function tileBounds(z: number, x: number, y: number, out: TileBounds): TileBounds {
  out.west = tileXToLon(x, z);
  out.east = tileXToLon(x + 1, z);
  out.north = tileYToLat(y, z);
  out.south = tileYToLat(y + 1, z);
  return out;
}

/** Ground width (m) of a tile edge at a latitude (Mercator scale is cos(lat)). */
export function tileSizeM(z: number, latDeg: number): number {
  return (MERCATOR_CIRCUMFERENCE_M * Math.cos(latDeg * DEG2RAD)) / (1 << z);
}

/** Ground size (m) of one terrarium pixel at a zoom and latitude. */
export function pixelSizeM(z: number, latDeg: number): number {
  return tileSizeM(z, latDeg) / TILE_SIZE;
}

/** Fills `out` with keys of tiles at zoom z covering a lat/lon box (handles the antimeridian). */
export function tilesCoveringBox(
  z: number,
  south: number,
  west: number,
  north: number,
  east: number,
  out: number[],
): number[] {
  const n = 1 << z;
  const y0 = Math.max(0, Math.floor(latToTileY(north, z)));
  const y1 = Math.min(n - 1, Math.floor(latToTileY(south, z)));
  let x0 = Math.floor(((west + 180) / 360) * n);
  let x1 = Math.floor(((east + 180) / 360) * n);
  if (x1 < x0) x1 += n; // crosses the antimeridian
  if (x1 - x0 >= n) {
    x0 = 0;
    x1 = n - 1;
  }
  for (let y = y0; y <= y1; y++) {
    for (let xx = x0; xx <= x1; xx++) out.push(tileKey(z, wrapTileX(xx, z), y));
  }
  return out;
}

/** Terrarium URL for a tile from a template containing {z}, {x}, {y}. */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** AWS Terrain Tiles terrarium endpoint (ARCHITECTURE.md "Data"). */
export const DEFAULT_TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
