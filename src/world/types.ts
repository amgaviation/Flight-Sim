/**
 * World queries used by physics, radios, TAWS and the camera. Implemented by
 * `world/World.ts`. Heights are metres above the WGS84 ellipsoid's mean sea
 * level approximation (terrain tile elevations are MSL; geoid separation is
 * ignored consistently everywhere).
 */
export interface GroundSample {
  /** Terrain/runway surface elevation (m MSL). */
  elevation_m: number;
  /** Surface unit normal in local ENU (east, north, up). */
  normal: [number, number, number];
  /** Surface type drives friction and sound. */
  surface: 'asphalt' | 'concrete' | 'grass' | 'dirt' | 'gravel' | 'water' | 'snow' | 'unknown';
  /** True when elevation came from a loaded high-resolution source (tile or runway). */
  precise: boolean;
}

export interface WorldQuery {
  /**
   * Ground under a point. Must be fast (called per gear contact per physics step)
   * and must never throw; returns a low-resolution estimate while tiles load.
   */
  sampleGround(latDeg: number, lonDeg: number): GroundSample;
  /** Terrain elevation only (m MSL), for TAWS look-ahead and map rendering. */
  elevationAt(latDeg: number, lonDeg: number): number;
  /** Resolves once terrain around the point is loaded at physics resolution. */
  ensureLoaded(latDeg: number, lonDeg: number, radius_m?: number): Promise<void>;
}
