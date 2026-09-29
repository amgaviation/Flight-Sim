/**
 * World: global terrain, airports, sky and weather visuals plus the
 * WorldQuery used by physics, radios, TAWS and the camera.
 *
 * Frame usage (see docs/modules/world.md):
 *   world.update(dt, camera, { lat, lon, alt_m })   // after positioning aircraft/camera, before render
 * Physics usage:
 *   world.sampleGround(lat, lon)                      // any time, never throws, no allocation
 *   await world.ensureLoaded(lat, lon)                // before spawning on the ground
 */
import * as THREE from 'three';
import type { SimVars } from '../core/SimVars';
import type { EventBus } from '../core/EventBus';
import type { NavDatabase } from '../nav/types';
import { WORLD_EVENTS, type GeoPosition, type GroundSample, type WorldQuality, type WorldQuery } from './types';
import { ReferenceFrame, RECENTER_DISTANCE_M, type RecenterEvent } from './ReferenceFrame';
import { QUALITY_PRESETS, type QualitySettings } from './quality';
import { ElevationStore } from './terrain/ElevationStore';
import { TileLoader } from './terrain/TileLoader';
import { TerrainRenderer, type TerrainStats } from './terrain/TerrainRenderer';
import { createTerrainMaterial } from './terrain/TerrainMaterial';
import { BaseGround } from './terrain/BaseGround';
import { DEFAULT_TERRAIN_URL, tileKey, tilesCoveringBox, keyX, keyY, keyZ, lonToTileX, latToTileY } from './terrain/tileMath';
import { SurfaceIndex } from './airports/surfaces';
import { AirportManager, type AirportManagerStats } from './airports/AirportManager';
import { createPavementMaterial } from './airports/RunwayMaterial';
import { getGlyphAtlas, disposeGlyphAtlas } from './airports/glyphAtlas';
import { createBuildingMaterials, type BuildingMaterials } from './airports/buildings';
import type { LightState } from './airports/AirportLights';
import { GroundQuery } from './GroundQuery';
import { createWorldUniforms, KOSCHMIEDER, type WorldUniforms } from './shared/atmosphere';
import { disposeSharedNoise } from './shared/noise';
import { Environment } from './sky/Environment';
import { ENV } from '../core/vars';
import { M_TO_FT, clamp } from './geo';
import { WORLD_VARS } from './worldVars';

export interface WorldOptions {
  scene: THREE.Scene;
  vars: SimVars;
  nav: NavDatabase;
  /** Optional: `world.recenter` events are emitted here. */
  events?: EventBus;
  /** Initial quality preset (default 'high'). */
  quality?: WorldQuality;
  /** Initial floating origin (default 0, 0; the first update recentres on the aircraft). */
  origin?: { lat: number; lon: number };
  /** Terrarium URL template with {z}/{x}/{y} (default AWS Terrain Tiles). */
  terrainUrl?: string;
  /** Renderer: used for pixel ratio, viewport height and max anisotropy. */
  renderer?: THREE.WebGLRenderer;
  /** Calendar year used with env.day_of_year (default: current UTC year). */
  year?: number;
  /** Terrain worker count (default min(3, cores / 2)); 0 loads on the main thread. */
  workers?: number;
}

export interface WorldStats {
  terrain: TerrainStats;
  airports: AirportManagerStats;
  elevationTiles: number;
  tilesLoaded: number;
  tilesFromCache: number;
  tilesFailed: number;
  recenters: number;
  originLat: number;
  originLon: number;
  sunElevationDeg: number;
}

interface LoadWaiter {
  keys: number[];
  /** true when every tile arrived (or is known missing), false on timeout. */
  resolve: (complete: boolean) => void;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Zoom kept around the aircraft for physics regardless of rendering. */
const PHYSICS_ZOOM_NEAR = 14;
const PHYSICS_ZOOM_MID = 13;
const TAWS_ZOOM = 11;
/** Below this height above ground (m) the z14 ring is kept loaded. */
const NEAR_GROUND_AGL_M = 2000;
/** ensureLoaded never waits longer than this (ms). */
const ENSURE_TIMEOUT_MS = 25_000;

const _camPos = new THREE.Vector3();
const _camGeo = { lat: 0, lon: 0, alt_m: 0 };
const _vp = new THREE.Vector2();

export class World implements WorldQuery {
  /** Floating origin; use it to place anything in scene coordinates. */
  readonly frame: ReferenceFrame;
  /** Root of everything the world draws (added to the scene). */
  readonly root = new THREE.Group();
  readonly uniforms: WorldUniforms;
  readonly environment: Environment;
  readonly terrain: TerrainRenderer;
  readonly airports: AirportManager;
  readonly store: ElevationStore;
  readonly surfaces: SurfaceIndex;
  readonly ground: GroundQuery;
  private readonly loader: TileLoader;
  private readonly baseGround: BaseGround;
  private readonly scene: THREE.Scene;
  private readonly vars: SimVars;
  private readonly events?: EventBus;
  private readonly renderer?: THREE.WebGLRenderer;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private readonly pavementMaterial: THREE.MeshStandardMaterial;
  private readonly buildingMaterials: BuildingMaterials;
  private qualityName: WorldQuality;
  private q: QualitySettings;
  private readonly physicsWanted: number[] = [];
  private readonly pinned = new Set<number>();
  private physicsSig = -1;
  private readonly waiters: LoadWaiter[] = [];
  private pendingDelta: THREE.Matrix4 | null = null;
  private recenters = 0;
  private pixelRatio = 1;
  private viewportHeight = 1080;
  private timeS = 0;
  private refFieldElev = NaN;
  private refFieldCheckMs = -Infinity;
  private initialised = false;
  private disposed = false;
  private readonly lightState: LightState = { runway: false, papi: true, beacon: false, taxiway: false, daylight: 1, extinction: 0, brightness: 1 };

  constructor(opts: WorldOptions) {
    this.scene = opts.scene;
    this.vars = opts.vars;
    this.events = opts.events;
    this.renderer = opts.renderer;
    this.qualityName = opts.quality ?? 'high';
    this.q = QUALITY_PRESETS[this.qualityName];
    this.frame = new ReferenceFrame(opts.origin?.lat ?? 0, opts.origin?.lon ?? 0);
    this.uniforms = createWorldUniforms();
    this.root.name = 'world';

    this.store = new ElevationStore(this.q.elevationCacheTiles);
    this.surfaces = new SurfaceIndex();
    this.ground = new GroundQuery(this.store, this.surfaces);

    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    this.loader = new TileLoader({
      urlTemplate: opts.terrainUrl ?? DEFAULT_TERRAIN_URL,
      maxConcurrent: this.q.maxConcurrentLoads,
      workers: opts.workers ?? Math.max(1, Math.min(3, Math.floor(cores / 2))),
    });

    // Environment first: it owns the shared noise texture referenced by the materials.
    this.environment = new Environment({ scene: this.scene, vars: this.vars, frame: this.frame, uniforms: this.uniforms, quality: this.q, year: opts.year });
    this.root.add(this.environment.group);

    this.terrainMaterial = createTerrainMaterial(this.uniforms);
    this.terrain = new TerrainRenderer(this.frame, this.store, this.loader, this.surfaces, this.terrainMaterial, this.q);
    this.root.add(this.terrain.group);
    this.baseGround = new BaseGround(this.uniforms);
    this.root.add(this.baseGround.mesh);

    const anisotropy = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 8;
    this.pavementMaterial = createPavementMaterial(this.uniforms);
    this.buildingMaterials = createBuildingMaterials();
    this.airports = new AirportManager(opts.nav, this.frame, this.surfaces, {
      uniforms: this.uniforms,
      atlas: getGlyphAtlas(Math.min(16, anisotropy)),
      pavementMaterial: this.pavementMaterial,
      buildings: this.q.buildings ? this.buildingMaterials : null,
      terrainElevation: (lat, lon) => {
        const s = this.ground.sampleGround(lat, lon);
        return s.precise ? s.elevation_m : NaN;
      },
    });
    this.airports.radiusNm = this.q.airportRadiusNm;
    this.airports.maxAirports = this.q.maxAirports;
    this.root.add(this.airports.group);

    this.loader.onLoaded = (t) => {
      this.store.add(t.z, t.x, t.y, t.elev, t.min, t.max);
      // Pin physics tiles and tiles awaited by ensureLoaded so LRU eviction cannot drop them.
      const wanted = this.physicsWanted.includes(t.key) || this.waiters.some((w) => w.keys.includes(t.key));
      if (wanted && !this.pinned.has(t.key)) {
        this.store.pin(t.key);
        this.pinned.add(t.key);
      }
      this.terrain.handleLoaded(t);
      this.checkWaiters();
    };
    this.loader.onMesh = (key, mesh) => this.terrain.handleMesh(key, mesh);
    this.loader.onFailed = (key) => {
      this.terrain.handleFailed(key);
      this.checkWaiters();
    };

    this.frame.onRecenter((e: RecenterEvent) => {
      this.pendingDelta = e.delta;
      this.recenters++;
      this.events?.emit(WORLD_EVENTS.recenter, { lat: e.lat, lon: e.lon, previousLat: e.previousLat, previousLon: e.previousLon, version: e.version });
    });

    this.scene.add(this.root);
  }

  // ------------------------------------------------------------------ WorldQuery

  /**
   * Ground under a point: elevation (m MSL), ENU unit normal, surface type and
   * precision. Returns an object from a 32-entry ring buffer (valid for the
   * next 31 calls); copy it or use `sampleGroundInto` to keep it. Never throws.
   */
  sampleGround(latDeg: number, lonDeg: number): GroundSample {
    return this.ground.sampleGround(latDeg, lonDeg);
  }

  /** Allocation-free variant writing into a caller-owned sample. */
  sampleGroundInto(latDeg: number, lonDeg: number, out: GroundSample): GroundSample {
    return this.ground.sampleGroundInto(latDeg, lonDeg, out);
  }

  /** Terrain/runway elevation (m MSL); sea surface 0. Never throws. */
  elevationAt(latDeg: number, lonDeg: number): number {
    return this.ground.elevationAt(latDeg, lonDeg);
  }

  /**
   * Resolves when z14 terrain (~10 m) covering `radius_m` around the point is
   * loaded and airport surfaces near it are known. Never rejects: resolves
   * after 25 s even if tiles could not be fetched (offline), in which case
   * sampleGround reports `precise: false` and the fallback elevation.
   */
  ensureLoaded(latDeg: number, lonDeg: number, radius_m = 2500): Promise<void> {
    return this.ensureLoadedWithin(latDeg, lonDeg, radius_m, ENSURE_TIMEOUT_MS).then(() => undefined);
  }

  /**
   * Same as ensureLoaded with a caller-chosen timeout. Resolves `true` when
   * every tile arrived or is known to be missing (offline, 404), `false` when
   * the timeout expired first (slow network or a busy CPU); the requests stay
   * queued either way.
   */
  ensureLoadedWithin(latDeg: number, lonDeg: number, radius_m: number, timeoutMs: number): Promise<boolean> {
    if (this.disposed || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return Promise.resolve(true);
    this.airports.refresh(latDeg, lonDeg, performance.now(), true);
    const fe = this.airports.nearestElevation(latDeg, lonDeg);
    if (Number.isFinite(fe) && this.store.size === 0) this.ground.fallbackElevation = fe;
    const dLat = radius_m / 111_000;
    const dLon = radius_m / (111_000 * Math.max(0.05, Math.cos((latDeg * Math.PI) / 180)));
    const keys: number[] = [];
    tilesCoveringBox(PHYSICS_ZOOM_NEAR, latDeg - dLat, lonDeg - dLon, latDeg + dLat, lonDeg + dLon, keys);
    const missing = keys.filter((k) => !this.store.has(k) && !this.loader.isMissing(k));
    if (missing.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const w: LoadWaiter = { keys, resolve, deadline: performance.now() + timeoutMs, timer: null };
      w.timer = setTimeout(() => this.finishWaiter(w, false), timeoutMs);
      this.waiters.push(w);
      for (const k of missing) this.loader.request(keyZ(k), keyX(k), keyY(k), -2000, null);
      this.loader.pump();
    });
  }

  private finishWaiter(w: LoadWaiter, complete = true): void {
    const i = this.waiters.indexOf(w);
    if (i >= 0) this.waiters.splice(i, 1);
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    // Keep the spawn area resident.
    for (const k of w.keys) {
      if (this.store.has(k) && !this.pinned.has(k)) {
        this.store.pin(k);
        this.pinned.add(k);
      }
    }
    w.resolve(complete);
  }

  private checkWaiters(): void {
    for (const w of [...this.waiters]) {
      if (w.keys.every((k) => this.store.has(k) || this.loader.isMissing(k))) this.finishWaiter(w);
    }
  }

  // ------------------------------------------------------------------ Frame update

  /** Sets the render viewport (device pixels) when no renderer was supplied. */
  setViewport(heightPx: number, pixelRatio = 1): void {
    this.viewportHeight = Math.max(1, heightPx);
    this.pixelRatio = Math.max(0.25, pixelRatio);
  }

  /** Current quality preset name. */
  get quality(): WorldQuality {
    return this.qualityName;
  }

  /** Switches quality preset (tile budgets, clouds, shadows, airports). */
  setQuality(level: WorldQuality): void {
    this.qualityName = level;
    this.q = QUALITY_PRESETS[level];
    this.store.maxTiles = this.q.elevationCacheTiles;
    this.loader.setMaxConcurrent(this.q.maxConcurrentLoads);
    this.terrain.setQuality(this.q);
    this.environment.setQuality(this.q);
    this.airports.radiusNm = this.q.airportRadiusNm;
    this.airports.maxAirports = this.q.maxAirports;
  }

  /** Physics/TAWS tiles around the aircraft (re-requested every frame; pinned when loaded). */
  private updatePhysicsTiles(lat: number, lon: number, aglM: number): void {
    const near = aglM < NEAR_GROUND_AGL_M;
    const x13 = Math.floor(lonToTileX(lon, PHYSICS_ZOOM_MID));
    const y13 = Math.floor(latToTileY(lat, PHYSICS_ZOOM_MID));
    const sig = (x13 * 32768 + y13) * 2 + (near ? 1 : 0);
    if (sig !== this.physicsSig) {
      this.physicsSig = sig;
      const want: number[] = [];
      const ring = (z: number, r: number) => {
        const n = 1 << z;
        const cx = Math.floor(lonToTileX(lon, z));
        const cy = Math.floor(latToTileY(lat, z));
        for (let dy = -r; dy <= r; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= n) continue;
          for (let dx = -r; dx <= r; dx++) want.push(tileKey(z, (((cx + dx) % n) + n) % n, y));
        }
      };
      ring(PHYSICS_ZOOM_MID, 1);
      ring(TAWS_ZOOM, 2);
      if (near) ring(PHYSICS_ZOOM_NEAR, 1);
      // Unpin what is no longer wanted (except tiles held for pending ensureLoaded calls).
      const held = new Set<number>();
      for (const w of this.waiters) for (const k of w.keys) held.add(k);
      for (const k of this.pinned) {
        if (!want.includes(k) && !held.has(k)) {
          this.store.unpin(k);
          this.pinned.delete(k);
        }
      }
      this.physicsWanted.length = 0;
      this.physicsWanted.push(...want);
      for (const k of want) {
        if (this.store.has(k) && !this.pinned.has(k)) {
          this.store.pin(k);
          this.pinned.add(k);
        }
      }
    }
    for (const k of this.physicsWanted) {
      if (!this.store.has(k)) this.loader.request(keyZ(k), keyX(k), keyY(k), -1000 + keyZ(k) * 0.01, null);
    }
    for (const w of this.waiters) for (const k of w.keys) if (!this.store.has(k)) this.loader.request(keyZ(k), keyX(k), keyY(k), -2000, null);
  }

  /** Applies a recenter delta to the camera's top-level scene ancestor so this frame stays consistent. */
  private applyRecenterToCamera(camera: THREE.Camera): void {
    const delta = this.pendingDelta;
    this.pendingDelta = null;
    if (!delta) return;
    let top: THREE.Object3D = camera;
    while (top.parent && top.parent !== this.scene) top = top.parent;
    if (top.parent === this.scene && top !== this.root) {
      top.applyMatrix4(delta);
      top.updateMatrixWorld(true);
    } else if (!camera.parent) {
      camera.applyMatrix4(delta);
      camera.updateMatrixWorld(true);
    }
  }

  /**
   * Per-frame update: floating origin, terrain LOD/streaming, airports and
   * lights, sky/sun/moon, fog, clouds and precipitation.
   * @param dt frame time (s)
   * @param camera the render camera, already positioned for this frame
   * @param aircraft aircraft geodetic position (alt_m MSL); drives recentering and physics tiles
   */
  update(dt: number, camera: THREE.Camera, aircraft: GeoPosition): void {
    if (this.disposed) return;
    const now = performance.now();
    const step = Number.isFinite(dt) ? clamp(dt, 0, 1) : 0;
    this.timeS += step;

    // Floating origin: first frame recentres unconditionally on the aircraft.
    const acOk = Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon);
    if (acOk) {
      if (!this.initialised) {
        this.initialised = true;
        if (this.frame.distanceFromOrigin(aircraft.lat, aircraft.lon) > 1) {
          this.frame.recenter(aircraft.lat, aircraft.lon);
          // The camera was positioned in the old frame this frame.
          this.applyRecenterToCamera(camera);
        }
      } else if (this.frame.maybeRecenter(aircraft.lat, aircraft.lon, RECENTER_DISTANCE_M)) {
        this.applyRecenterToCamera(camera);
      }
    }

    if (this.renderer) {
      this.pixelRatio = this.renderer.getPixelRatio();
      this.renderer.getDrawingBufferSize(_vp);
      this.viewportHeight = _vp.y;
    }

    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    this.frame.toGeodetic(_camPos.x, _camPos.y, _camPos.z, _camGeo);

    // Ground and field references.
    const groundCam = this.ground.elevationAt(_camGeo.lat, _camGeo.lon);
    const groundAc = acOk ? this.ground.elevationAt(aircraft.lat, aircraft.lon) : groundCam;
    if (now - this.refFieldCheckMs > 5000) {
      this.refFieldCheckMs = now;
      this.refFieldElev = this.airports.nearestElevation(_camGeo.lat, _camGeo.lon, 50);
      if (this.store.size === 0 && Number.isFinite(this.refFieldElev)) this.ground.fallbackElevation = this.refFieldElev;
    }
    this.ground.dayOfYear = this.vars.get(ENV.dayOfYear, this.ground.dayOfYear);
    this.terrain.groundElevationM = Number.isFinite(groundCam) ? groundCam : 0;

    // Streaming: physics first, then render tiles.
    this.loader.beginFrame();
    if (acOk) this.updatePhysicsTiles(aircraft.lat, aircraft.lon, aircraft.alt_m - groundAc);
    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.isPerspectiveCamera ? persp.getEffectiveFOV() : 60;
    this.terrain.update(_camGeo, fov, this.viewportHeight, now);
    this.loader.endFrame();

    // Base ground: below all loaded terrain, or at the fallback elevation when offline.
    const terrainLoaded = this.store.size > 0;
    const baseAlt = terrainLoaded ? this.lowestLoadedElevation() - 60 : this.ground.fallbackElevation - 0.4;
    this.baseGround.update(_camPos, baseAlt);

    // Airports.
    if (acOk) this.airports.refresh(aircraft.lat, aircraft.lon, now);
    const env = this.environment;
    env.update(step, camera, _camPos, _camGeo.lat, _camGeo.lon, _camGeo.alt_m, this.terrain.groundElevationM, this.refFieldElev, this.pixelRatio);
    const vis = this.vars.has(ENV.visibilityM) ? this.vars.get(ENV.visibilityM) : 40_000;
    const ambient = this.uniforms.uAmbient.value;
    const ls = this.lightState;
    // Runway lights on from sunset (ambient 0.62 ~ 400 lux) or in low visibility (< 5 km ~ 3 SM,
    // the 14 CFR 91.155 basic VFR minimum) or inside cloud.
    ls.runway = ambient < 0.62 || vis < 5000 || this.uniforms.uCloudBeta.value > 0;
    ls.taxiway = ls.runway;
    ls.beacon = ambient < 0.62 || vis < 5000; // AIM 2-1-9: sunset to sunrise, and in IMC in controlled airspace
    ls.papi = true;
    ls.daylight = ambient;
    // Lights penetrate haze farther than objects (Allard's law); EST factor 0.5 of object extinction.
    ls.extinction = 0.5 * (KOSCHMIEDER / Math.max(50, vis)) + this.uniforms.uCloudBeta.value * 0.6;
    ls.brightness = 1;
    this.airports.update(_camPos, _camGeo.lat, _camGeo.lon, _camGeo.alt_m, this.timeS, this.pixelRatio, ls);
    this.buildingMaterials.setNight(this.uniforms.uNight.value);

    // Diagnostics.
    this.vars.set(WORLD_VARS.camAglFt, (_camGeo.alt_m - groundCam) * M_TO_FT);
    this.vars.set(WORLD_VARS.tilesPending, this.loader.pendingCount);
  }

  private lowestLoadedElevation(): number {
    // Lower bound of the terrain around the camera from the coarse (z4-z7) tiles covering it.
    let lo = Infinity;
    for (let z = 4; z <= 7; z++) {
      const t = this.store.findTile(_camGeo.lat, _camGeo.lon, z);
      if (t) lo = Math.min(lo, Math.max(t.min, -500));
    }
    return Number.isFinite(lo) ? lo : 0;
  }

  getStats(): WorldStats {
    return {
      terrain: this.terrain.getStats(),
      airports: this.airports.getStats(),
      elevationTiles: this.store.size,
      tilesLoaded: this.loader.stats.loaded,
      tilesFromCache: this.loader.stats.cached,
      tilesFailed: this.loader.stats.failed,
      recenters: this.recenters,
      originLat: this.frame.originLat,
      originLon: this.frame.originLon,
      sunElevationDeg: this.environment.sunElevationDeg,
    };
  }

  /** Releases every GPU resource, worker and listener owned by the world. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of [...this.waiters]) this.finishWaiter(w);
    this.loader.dispose();
    this.terrain.dispose();
    this.airports.dispose();
    this.environment.dispose();
    this.baseGround.dispose();
    this.terrainMaterial.dispose();
    this.pavementMaterial.dispose();
    this.buildingMaterials.dispose();
    disposeGlyphAtlas();
    disposeSharedNoise();
    this.store.clear();
    if (this.scene.fog === this.environment.fog) this.scene.fog = null;
    this.root.removeFromParent();
  }
}
