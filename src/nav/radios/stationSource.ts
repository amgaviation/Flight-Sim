/**
 * Adapter between receivers and the NavDatabase: uses the allocation-free
 * `collectOnFreq` / `collectMarkersNear` of `NavDatabaseImpl` when available,
 * otherwise the plain `NavDatabase` interface (allocates on retune only).
 */
import type { Navaid, NavDatabase } from '../types';

interface CollectingDb {
  collectOnFreq(freq: number, lat: number, lon: number, radiusNm: number, out: Navaid[]): number;
  collectMarkersNear(lat: number, lon: number, radiusNm: number, out: Navaid[]): number;
}

function isCollecting(db: NavDatabase): db is NavDatabase & CollectingDb {
  return typeof (db as Partial<CollectingDb>).collectOnFreq === 'function';
}

export class StationSource {
  constructor(private readonly db: NavDatabase) {}

  /** Stations on `freq` (MHz VHF / kHz NDB) within `radiusNm`, nearest first, into `out`. */
  onFreq(freq: number, lat: number, lon: number, radiusNm: number, out: Navaid[]): number {
    out.length = 0;
    if (!this.db.ready || !(freq > 0)) return 0;
    if (isCollecting(this.db)) return this.db.collectOnFreq(freq, lat, lon, radiusNm, out);
    for (const n of this.db.navaidsOnFreq(freq, lat, lon, radiusNm)) out.push(n);
    return out.length;
  }

  /** Marker beacons within `radiusNm` into `out`. */
  markersNear(lat: number, lon: number, radiusNm: number, out: Navaid[]): number {
    out.length = 0;
    if (!this.db.ready) return 0;
    if (isCollecting(this.db)) return this.db.collectMarkersNear(lat, lon, radiusNm, out);
    for (const n of this.db.navaidsNear(lat, lon, radiusNm, ['OM', 'MM', 'IM'])) out.push(n);
    return out.length;
  }
}
