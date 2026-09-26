/**
 * Terrain tile mesh builder. Pure typed-array code shared by the terrain
 * worker and the main-thread fallback.
 *
 * Each tile mesh lives in its own local frame: the Three.js ENU frame at the
 * tile centre on the ellipsoid (x = east, y = up, z = south). Vertices go
 * geodetic -> ECEF -> ENU(tile centre) in double precision, so Earth curvature
 * is exact and coordinates stay small enough for float32. The main thread
 * places the mesh with `ReferenceFrame.placeObject(mesh, centerLat, centerLon, 0)`;
 * a recenter only changes that object transform, never the vertices.
 *
 * Skirts (a strip hanging down from every edge) hide cracks between
 * neighbouring tiles of different LOD.
 */
import { DEG2RAD, MERCATOR_CIRCUMFERENCE_M, WGS84_A, WGS84_E2, enuBasis, geodeticToEcef } from '../geo';
import { createFlattenHit, evalFlatten, type FlattenSurface } from '../airports/surfaces';
import { TILE_SIZE, mercatorYToLat, tileXToLon } from './tileMath';

export interface TileMeshParams {
  z: number;
  x: number;
  y: number;
  /** Grid segments per edge. (segments + 1)^2 + 4 (segments + 1) vertices. */
  segments: number;
  /** Skirt depth (m). */
  skirtDepthM: number;
  /** Airport surfaces overlapping the tile (flattening); may be empty. */
  surfaces: FlattenSurface[];
  /** Period (m) of the tiling noise coordinates written to `aTerrain.xy`. */
  noisePeriodM: number;
}

export interface TileMeshData {
  z: number;
  x: number;
  y: number;
  centerLat: number;
  centerLon: number;
  vertexCount: number;
  /** Tile-local positions (m), xyz. */
  positions: Float32Array;
  /** Unit normals (tile-local), xyz. */
  normals: Float32Array;
  /** Per vertex: noise x, noise y (m, periodic), elevation (m MSL, negative below sea level), latitude (deg). */
  terrain: Float32Array;
  /** Per vertex: airport flatten weight 0..1. */
  flat: Float32Array;
  index: Uint16Array | Uint32Array;
  /** Bounding sphere centre (tile-local) and radius (m). */
  bsCenter: [number, number, number];
  bsRadius: number;
  /** Source elevation range (m). */
  minElev: number;
  maxElev: number;
}

/** Bilinear sample of a TILE_SIZE^2 grid at fractional pixel-centre coordinates (clamped). */
export function sampleGrid(elev: Float32Array, px: number, py: number): number {
  const n = TILE_SIZE;
  const x = px < 0 ? 0 : px > n - 1 ? n - 1 : px;
  const y = py < 0 ? 0 : py > n - 1 ? n - 1 : py;
  const i0 = Math.min(n - 2, Math.floor(x));
  const j0 = Math.min(n - 2, Math.floor(y));
  const ax = x - i0;
  const ay = y - j0;
  const r0 = j0 * n;
  const r1 = r0 + n;
  const a = elev[r0 + i0] + (elev[r0 + i0 + 1] - elev[r0 + i0]) * ax;
  const b = elev[r1 + i0] + (elev[r1 + i0 + 1] - elev[r1 + i0]) * ax;
  return a + (b - a) * ay;
}

/** Number of vertices/indices for a segment count (for budgeting). */
export function tileMeshCounts(segments: number): { vertices: number; indices: number } {
  const v = (segments + 1) * (segments + 1) + 4 * (segments + 1);
  const i = segments * segments * 6 + 4 * segments * 6;
  return { vertices: v, indices: i };
}

/**
 * Builds a tile mesh from its decoded elevation grid.
 * `elev` is row-major TILE_SIZE x TILE_SIZE metres, row 0 = north edge.
 */
export function buildTileMesh(elev: Float32Array, p: TileMeshParams): TileMeshData {
  const { z, x, y } = p;
  const seg = Math.max(1, Math.floor(p.segments));
  const row = seg + 1;
  const gridCount = row * row;
  const vertexCount = gridCount + 4 * row;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const terrain = new Float32Array(vertexCount * 4);
  const flat = new Float32Array(vertexCount);

  const n = 1 << z;
  const west = tileXToLon(x, z);
  const east = tileXToLon(x + 1, z);
  const centerLon = (west + east) / 2;
  const centerLat = mercatorYToLat((y + 0.5) / n);

  // Tile-centre ENU frame (double precision).
  const c = new Float64Array(3);
  geodeticToEcef(centerLat, centerLon, 0, c);
  const B = new Float64Array(9);
  enuBasis(centerLat, centerLon, B);

  // Per-column longitude trig and per-row latitude terms.
  const cosLon = new Float64Array(row);
  const sinLon = new Float64Array(row);
  const lonArr = new Float64Array(row);
  for (let i = 0; i < row; i++) {
    const lon = west + ((east - west) * i) / seg;
    lonArr[i] = lon;
    cosLon[i] = Math.cos(lon * DEG2RAD);
    sinLon[i] = Math.sin(lon * DEG2RAD);
  }
  const latArr = new Float64Array(row);
  const sinLat = new Float64Array(row);
  const cosLat = new Float64Array(row);
  const nRad = new Float64Array(row);
  for (let j = 0; j < row; j++) {
    const lat = mercatorYToLat((y + j / seg) / n);
    latArr[j] = lat;
    const s = Math.sin(lat * DEG2RAD);
    sinLat[j] = s;
    cosLat[j] = Math.cos(lat * DEG2RAD);
    nRad[j] = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  }

  // Periodic noise coordinates anchored in global Web Mercator metres.
  const tileM = MERCATOR_CIRCUMFERENCE_M / n;
  const P = p.noisePeriodM;
  const baseX = ((x * tileM) % P + P) % P;
  const baseY = ((y * tileM) % P + P) % P;

  const hit = createFlattenHit();
  const useFlatten = p.surfaces.length > 0;
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let j = 0; j < row; j++) {
    const py = (j / seg) * TILE_SIZE - 0.5;
    for (let i = 0; i < row; i++) {
      const px = (i / seg) * TILE_SIZE - 0.5;
      const raw = sampleGrid(elev, px, py);
      let h = raw;
      let shadeElev = raw;
      let w = 0;
      if (useFlatten) {
        evalFlatten(p.surfaces, latArr[j], lonArr[i], hit);
        if (hit.weight > 0) {
          w = hit.weight;
          const target = hit.planeElev - hit.sinkM;
          h = raw + (target - raw) * w;
          shadeElev = raw + (hit.planeElev - raw) * w;
        }
      }
      // Sea surface is flat at 0 m; the (negative) depth stays in the shading attribute.
      if (h < 0 && w < 0.5) h = 0;
      if (raw < minElev) minElev = raw;
      if (raw > maxElev) maxElev = raw;

      const nr = nRad[j];
      const ex = (nr + h) * cosLat[j] * cosLon[i];
      const ey = (nr + h) * cosLat[j] * sinLon[i];
      const ez = (nr * (1 - WGS84_E2) + h) * sinLat[j];
      const dx = ex - c[0];
      const dy = ey - c[1];
      const dz = ez - c[2];
      const e = B[0] * dx + B[1] * dy + B[2] * dz;
      const no = B[3] * dx + B[4] * dy + B[5] * dz;
      const u = B[6] * dx + B[7] * dy + B[8] * dz;
      const v = j * row + i;
      positions[v * 3] = e;
      positions[v * 3 + 1] = u;
      positions[v * 3 + 2] = -no;
      terrain[v * 4] = baseX + (i / seg) * tileM;
      terrain[v * 4 + 1] = baseY + (j / seg) * tileM;
      terrain[v * 4 + 2] = shadeElev;
      terrain[v * 4 + 3] = latArr[j];
      flat[v] = w;
    }
  }

  // Normals from the final grid (includes curvature and flattening).
  for (let j = 0; j < row; j++) {
    const ja = j > 0 ? j - 1 : j;
    const jb = j < seg ? j + 1 : j;
    for (let i = 0; i < row; i++) {
      const ia = i > 0 ? i - 1 : i;
      const ib = i < seg ? i + 1 : i;
      const pxA = (j * row + ia) * 3;
      const pxB = (j * row + ib) * 3;
      const pzA = (ja * row + i) * 3;
      const pzB = (jb * row + i) * 3;
      const tx0 = positions[pxB] - positions[pxA];
      const tx1 = positions[pxB + 1] - positions[pxA + 1];
      const tx2 = positions[pxB + 2] - positions[pxA + 2];
      const tz0 = positions[pzB] - positions[pzA];
      const tz1 = positions[pzB + 1] - positions[pzA + 1];
      const tz2 = positions[pzB + 2] - positions[pzA + 2];
      // n = tz x tx (points up for x east, z south)
      let nx = tz1 * tx2 - tz2 * tx1;
      let ny = tz2 * tx0 - tz0 * tx2;
      let nz = tz0 * tx1 - tz1 * tx0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const v = (j * row + i) * 3;
      normals[v] = nx;
      normals[v + 1] = ny;
      normals[v + 2] = nz;
    }
  }

  // Skirt vertices: copies of the edge vertices dropped along tile-local down.
  // Order: north (j=0), south (j=seg), west (i=0), east (i=seg), each by increasing i or j.
  const edgeSrc = (edge: number, k: number): number =>
    edge === 0 ? k : edge === 1 ? seg * row + k : edge === 2 ? k * row : k * row + seg;
  for (let edge = 0; edge < 4; edge++) {
    for (let k = 0; k < row; k++) {
      const src = edgeSrc(edge, k);
      const dst = gridCount + edge * row + k;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - p.skirtDepthM;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      normals[dst * 3] = normals[src * 3];
      normals[dst * 3 + 1] = normals[src * 3 + 1];
      normals[dst * 3 + 2] = normals[src * 3 + 2];
      for (let q = 0; q < 4; q++) terrain[dst * 4 + q] = terrain[src * 4 + q];
      flat[dst] = flat[src];
    }
  }

  // Indices.
  const counts = tileMeshCounts(seg);
  const index = vertexCount <= 65535 ? new Uint16Array(counts.indices) : new Uint32Array(counts.indices);
  let o = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * row + i;
      const b = a + 1;
      const d = a + row;
      const e = d + 1;
      // (v00, v01, v10) and (v10, v01, v11): counter-clockwise seen from +y.
      index[o++] = a;
      index[o++] = d;
      index[o++] = b;
      index[o++] = b;
      index[o++] = d;
      index[o++] = e;
    }
  }
  for (let edge = 0; edge < 4; edge++) {
    const outwardFirst = edge === 0 || edge === 3; // north & east: (a, b, a'), (b, b', a')
    for (let k = 0; k < seg; k++) {
      const a = edgeSrc(edge, k);
      const b = edgeSrc(edge, k + 1);
      const a2 = gridCount + edge * row + k;
      const b2 = a2 + 1;
      if (outwardFirst) {
        index[o++] = a;
        index[o++] = b;
        index[o++] = a2;
        index[o++] = b;
        index[o++] = b2;
        index[o++] = a2;
      } else {
        index[o++] = a;
        index[o++] = a2;
        index[o++] = b;
        index[o++] = b;
        index[o++] = a2;
        index[o++] = b2;
      }
    }
  }

  // Bounding sphere around the AABB centre.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  const bsCenter: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const bsRadius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;

  return {
    z,
    x,
    y,
    centerLat,
    centerLon,
    vertexCount,
    positions,
    normals,
    terrain,
    flat,
    index,
    bsCenter,
    bsRadius,
    minElev: Number.isFinite(minElev) ? minElev : 0,
    maxElev: Number.isFinite(maxElev) ? maxElev : 0,
  };
}

/** Transferable buffers of a mesh (for postMessage). */
export function meshTransferables(m: TileMeshData): ArrayBuffer[] {
  return [m.positions.buffer, m.normals.buffer, m.terrain.buffer, m.flat.buffer, m.index.buffer] as ArrayBuffer[];
}
