/**
 * Chooses, builds and unloads airports around the aircraft and maintains the
 * airport surface index used by physics and terrain flattening.
 *
 * - Every ~2 s (or after moving 2 km) queries the nav database for airports
 *   within the quality radius (default 40 nm), ranks them by importance
 *   (large > medium > small, longest runway) and distance, and keeps the top
 *   `maxAirports` built. At most one airport is built per frame.
 * - Physics surfaces cover every non-heliport airport within the radius
 *   (and at least 20 nm), independent of the visual budget, so the gear always
 *   rolls on an exact runway plane.
 */
import * as THREE from 'three';
import type { NavDatabase, Airport } from '../../nav/types';
import type { ReferenceFrame } from '../ReferenceFrame';
import { haversineM, NM_TO_M } from '../geo';
import { buildAirportLayout, type AirportLayout } from './runwayModel';
import { buildAirport, type AirportBuildContext, type BuiltAirport } from './AirportBuilder';
import type { SurfaceIndex, FlattenSurface } from './surfaces';
import type { LightState } from './AirportLights';

const REFRESH_MS = 2000;
const REFRESH_MOVE_M = 2000;

export interface AirportManagerStats {
  built: number;
  candidates: number;
  surfaces: number;
  lights: number;
}

export class AirportManager {
  readonly group = new THREE.Group();
  private readonly built = new Map<string, BuiltAirport>();
  private readonly layouts = new Map<string, AirportLayout | null>();
  private wanted: AirportLayout[] = [];
  private readonly wantedIds = new Set<string>();
  private lastRefreshMs = -Infinity;
  private lastLat = NaN;
  private lastLon = NaN;
  private surfaceKey = '';
  radiusNm = 40;
  maxAirports = 12;

  constructor(
    private readonly nav: NavDatabase,
    private readonly frame: ReferenceFrame,
    private readonly surfaces: SurfaceIndex,
    private readonly ctx: AirportBuildContext,
  ) {
    this.group.name = 'airports';
    frame.onRecenter(() => {
      for (const b of this.built.values()) this.place(b);
    });
  }

  private place(b: BuiltAirport): void {
    this.frame.placeObject(b.group, b.layout.airport.lat, b.layout.airport.lon, 0);
  }

  private layoutFor(a: Airport): AirportLayout | null {
    let l = this.layouts.get(a.icao);
    if (l === undefined) {
      try {
        l = buildAirportLayout(a);
      } catch {
        l = null; // malformed record: never retry
      }
      this.layouts.set(a.icao, l);
      if (this.layouts.size > 4000) {
        // Bound the cache: drop the oldest half (Map preserves insertion order).
        let n = 0;
        for (const k of this.layouts.keys()) {
          if (n++ > 2000) break;
          if (!this.built.has(k)) this.layouts.delete(k);
        }
      }
    }
    return l;
  }

  /** Nearest airport elevation (m) within `radiusNm`, or NaN (fallback ground before tiles load). */
  nearestElevation(lat: number, lon: number, radiusNm = 10): number {
    if (!this.nav.ready) return NaN;
    try {
      const near = this.nav.airportsNear(lat, lon, radiusNm, 1);
      return near.length > 0 ? near[0].elevationFt * 0.3048 : NaN;
    } catch {
      return NaN;
    }
  }

  /**
   * Re-evaluates which airports are wanted around (lat, lon) and updates the
   * physics surface index. Synchronous; `force` bypasses the throttle.
   */
  refresh(lat: number, lon: number, nowMs: number, force = false): void {
    if (!this.nav.ready) return;
    const moved = Number.isFinite(this.lastLat) ? haversineM(lat, lon, this.lastLat, this.lastLon) : Infinity;
    if (!force && nowMs - this.lastRefreshMs < REFRESH_MS && moved < REFRESH_MOVE_M) return;
    this.lastRefreshMs = nowMs;
    this.lastLat = lat;
    this.lastLon = lon;
    let near: Airport[] = [];
    const radius = Math.max(this.radiusNm, 20);
    try {
      near = this.nav.airportsNear(lat, lon, radius, 300);
    } catch {
      near = [];
    }
    const layouts: { l: AirportLayout; d: number }[] = [];
    for (const a of near) {
      if (a.type === 'heliport' || a.type === 'closed' || a.type === 'seaplane_base') continue;
      const l = this.layoutFor(a);
      if (!l) continue;
      layouts.push({ l, d: haversineM(lat, lon, a.lat, a.lon) });
    }
    // Physics surfaces: every airport in range.
    const surf: FlattenSurface[] = [];
    const keyParts: string[] = [];
    for (const { l } of layouts) {
      surf.push(...l.surfaces);
      keyParts.push(l.airport.icao);
    }
    keyParts.sort();
    const key = keyParts.join(',');
    if (key !== this.surfaceKey) {
      this.surfaceKey = key;
      this.surfaces.set(surf);
    }
    // Visual set: importance first, then distance, within the visual radius.
    const r = this.radiusNm * NM_TO_M;
    const vis = layouts.filter((x) => x.d <= r);
    vis.sort((a, b) => b.l.importance - a.l.importance || a.d - b.d);
    // Always include the closest airport (you might be parked there).
    const chosen = vis.slice(0, this.maxAirports);
    const closest = layouts.reduce<{ l: AirportLayout; d: number } | null>((m, x) => (!m || x.d < m.d ? x : m), null);
    if (closest && !chosen.includes(closest) && closest.d <= r) chosen[chosen.length - 1] = closest;
    this.wanted = chosen.map((x) => x.l);
    this.wantedIds.clear();
    for (const l of this.wanted) this.wantedIds.add(l.airport.icao);
  }

  /** Builds/unloads incrementally and updates lights. */
  update(
    cameraWorld: THREE.Vector3,
    camLat: number,
    camLon: number,
    camAltM: number,
    timeS: number,
    pixelRatio: number,
    lightState: LightState,
  ): void {
    const wantedIds = this.wantedIds;
    // Unload airports no longer wanted (with hysteresis on distance).
    for (const [id, b] of this.built) {
      if (wantedIds.has(id)) continue;
      const d = haversineM(camLat, camLon, b.layout.airport.lat, b.layout.airport.lon);
      if (d > this.radiusNm * NM_TO_M * 1.15 || this.built.size > this.maxAirports + 2) {
        b.dispose();
        this.built.delete(id);
      }
    }
    // Build at most one airport per frame, most important first.
    for (const l of this.wanted) {
      if (this.built.has(l.airport.icao)) continue;
      try {
        const b = buildAirport(l, this.ctx);
        this.place(b);
        this.group.add(b.group);
        this.built.set(l.airport.icao, b);
      } catch (e) {
        console.warn(`[world] failed to build airport ${l.airport.icao}`, e);
        this.layouts.set(l.airport.icao, null);
      }
      break;
    }
    for (const b of this.built.values()) b.lights.update(cameraWorld, camLat, camLon, camAltM, timeS, pixelRatio, lightState);
  }

  /** Built airport by ICAO (for debugging/tests: e.g. PAPI state). */
  get(icao: string): BuiltAirport | undefined {
    return this.built.get(icao);
  }

  getStats(): AirportManagerStats {
    let lights = 0;
    for (const b of this.built.values()) lights += b.lights.count;
    return { built: this.built.size, candidates: this.wanted.length, surfaces: this.surfaces.surfaces.length, lights };
  }

  dispose(): void {
    for (const b of this.built.values()) b.dispose();
    this.built.clear();
    this.layouts.clear();
    this.wanted = [];
    this.wantedIds.clear();
  }
}
