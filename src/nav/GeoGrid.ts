/**
 * Static latitude/longitude bucket index (compressed-sparse-row layout) for
 * fast radius queries over up to a few hundred thousand points.
 *
 * Cells are `cellDeg` x `cellDeg` degrees. A query visits every cell that can
 * contain points within the radius (handling the antimeridian and the poles)
 * and hands candidate indices to a callback; the caller applies the exact
 * distance test. Querying allocates nothing.
 */
const NM_PER_DEG_LAT = 60.0;

export class GeoGrid {
  readonly cellDeg: number;
  private readonly nLat: number;
  private readonly nLon: number;
  /** cellStart[c]..cellStart[c+1] index into `items`. */
  private readonly cellStart: Int32Array;
  private readonly items: Int32Array;

  constructor(lat: ArrayLike<number>, lon: ArrayLike<number>, cellDeg = 1) {
    this.cellDeg = cellDeg;
    this.nLat = Math.ceil(180 / cellDeg);
    this.nLon = Math.ceil(360 / cellDeg);
    const nCells = this.nLat * this.nLon;
    const n = lat.length;
    const cellOf = new Int32Array(n);
    const counts = new Int32Array(nCells + 1);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(lat[i], lon[i]);
      cellOf[i] = c;
      if (c >= 0) counts[c + 1]++;
    }
    for (let c = 0; c < nCells; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.items = new Int32Array(counts[nCells]);
    const fill = new Int32Array(nCells);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      this.items[counts[c] + fill[c]++] = i;
    }
  }

  private row(lat: number): number {
    return Math.min(this.nLat - 1, Math.max(0, Math.floor((lat + 90) / this.cellDeg)));
  }

  private col(lon: number): number {
    let l = lon;
    if (l < -180 || l >= 180) l = ((((l + 180) % 360) + 360) % 360) - 180;
    return Math.min(this.nLon - 1, Math.max(0, Math.floor((l + 180) / this.cellDeg)));
  }

  private cellIndex(lat: number, lon: number): number {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return -1;
    return this.row(lat) * this.nLon + this.col(lon);
  }

  /**
   * Calls `visit(index)` for every point in cells overlapping the circle of
   * `radiusNm` around (lat, lon). Candidates may lie outside the radius.
   */
  query(lat: number, lon: number, radiusNm: number, visit: (index: number) => void): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const dLat = radiusNm / NM_PER_DEG_LAT;
    const latMin = lat - dLat;
    const latMax = lat + dLat;
    const r0 = this.row(latMin);
    const r1 = this.row(latMax);
    // Widest longitude span occurs at the latitude farthest from the equator.
    const worstLat = Math.min(89.9, Math.max(Math.abs(latMin), Math.abs(latMax)));
    const cosL = Math.cos((worstLat * Math.PI) / 180);
    const dLon = cosL > 1e-6 ? dLat / cosL : 360;
    const allLon = dLon >= 180 || latMax >= 89.9 || latMin <= -89.9;
    const c0 = allLon ? 0 : this.col(lon - dLon);
    const span = allLon ? this.nLon - 1 : Math.min(this.nLon - 1, Math.ceil((2 * dLon) / this.cellDeg) + 1);
    for (let r = r0; r <= r1; r++) {
      const base = r * this.nLon;
      for (let k = 0; k <= span; k++) {
        const c = base + ((c0 + k) % this.nLon);
        const end = this.cellStart[c + 1];
        for (let j = this.cellStart[c]; j < end; j++) visit(this.items[j]);
      }
    }
  }
}
