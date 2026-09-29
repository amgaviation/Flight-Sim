/**
 * Quality presets: tile counts, triangle budgets and effect resolution.
 *
 * Budgets target 60 fps on a mid-range GPU (GTX 1660 / RX 6600 class) at
 * 1080p with 'high'. Triangle counts per tile: 2 * segments^2 + skirts, so
 * 'high' (64 segments, <= 300 leaves) stays under ~2.6 M terrain triangles in
 * the worst case and ~1 M typically (most leaves are far and coarse).
 */
import type { WorldQuality } from './types';

export interface QualitySettings {
  /** Terrain grid segments per tile edge. */
  terrainSegments: number;
  /** Screen-space error threshold (px). */
  sseThresholdPx: number;
  /** Max terrain leaves (draw calls) before the SSE threshold is relaxed. */
  maxLeaves: number;
  /** Terrain view radius clamp (m). */
  minViewRadiusM: number;
  maxViewRadiusM: number;
  /** Deepest rendered terrain zoom. */
  maxRenderZoom: number;
  /** Decoded elevation tiles kept in memory (256 KB each). */
  elevationCacheTiles: number;
  /** Built tile meshes kept hidden for reuse before disposal. */
  meshCacheTiles: number;
  /** Minimum mesh uploads per frame; more while under the upload time budget, up to 4x (TerrainRenderer UPLOAD_BUDGET_MS). */
  meshUploadsPerFrame: number;
  /** Concurrent tile fetches. */
  maxConcurrentLoads: number;
  /** Stacked slices per cloud layer. */
  cloudSlices: number;
  /** Cloud layer disc radius (m). */
  cloudRadiusM: number;
  /** Precipitation particle count at precip = 1. */
  precipParticles: number;
  /** Airports built within this radius (nm), most important first. */
  airportRadiusNm: number;
  maxAirports: number;
  /** Sun shadow map for aircraft/buildings on nearby ground. */
  shadows: boolean;
  shadowMapSize: number;
  /** Airport buildings (hangars/terminal/tower). */
  buildings: boolean;
}

export const QUALITY_PRESETS: Record<WorldQuality, QualitySettings> = {
  low: {
    terrainSegments: 32,
    sseThresholdPx: 9,
    maxLeaves: 150,
    minViewRadiusM: 60_000,
    maxViewRadiusM: 220_000,
    maxRenderZoom: 13,
    elevationCacheTiles: 200,
    meshCacheTiles: 24,
    meshUploadsPerFrame: 2,
    maxConcurrentLoads: 6,
    cloudSlices: 5,
    cloudRadiusM: 50_000,
    precipParticles: 4_000,
    airportRadiusNm: 25,
    maxAirports: 6,
    shadows: false,
    shadowMapSize: 1024,
    buildings: false,
  },
  medium: {
    terrainSegments: 48,
    sseThresholdPx: 7,
    maxLeaves: 220,
    minViewRadiusM: 80_000,
    maxViewRadiusM: 320_000,
    maxRenderZoom: 14,
    elevationCacheTiles: 280,
    meshCacheTiles: 40,
    meshUploadsPerFrame: 3,
    maxConcurrentLoads: 8,
    cloudSlices: 7,
    cloudRadiusM: 70_000,
    precipParticles: 8_000,
    airportRadiusNm: 40,
    maxAirports: 10,
    shadows: false,
    shadowMapSize: 2048,
    buildings: true,
  },
  high: {
    terrainSegments: 64,
    sseThresholdPx: 6,
    maxLeaves: 300,
    minViewRadiusM: 100_000,
    maxViewRadiusM: 420_000,
    maxRenderZoom: 14,
    elevationCacheTiles: 360,
    meshCacheTiles: 64,
    meshUploadsPerFrame: 4,
    maxConcurrentLoads: 10,
    cloudSlices: 9,
    cloudRadiusM: 90_000,
    precipParticles: 14_000,
    airportRadiusNm: 40,
    maxAirports: 16,
    shadows: true,
    shadowMapSize: 2048,
    buildings: true,
  },
  ultra: {
    terrainSegments: 64,
    sseThresholdPx: 4,
    maxLeaves: 480,
    minViewRadiusM: 120_000,
    maxViewRadiusM: 500_000,
    maxRenderZoom: 15,
    elevationCacheTiles: 480,
    meshCacheTiles: 96,
    meshUploadsPerFrame: 6,
    maxConcurrentLoads: 12,
    cloudSlices: 12,
    cloudRadiusM: 110_000,
    precipParticles: 22_000,
    airportRadiusNm: 40,
    maxAirports: 24,
    shadows: true,
    shadowMapSize: 4096,
    buildings: true,
  },
};
