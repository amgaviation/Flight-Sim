# World module (`src/world`)

Global terrain, airports, sky/weather visuals and the `WorldQuery` used by physics,
radios, TAWS and cameras. Import from `src/world` (barrel `src/world/index.ts`) or the
individual files named below.

```ts
import { World, ReferenceFrame, WORLD_VARS } from '../world';
import type { GroundSample, WorldQuery, GeoPosition } from '../world/types';
```

## Contents

1. Coordinate conventions
2. Renderer requirements
3. `World` (construction, frame loop, WorldQuery, quality, stats, dispose)
4. `ReferenceFrame` (floating origin, placing objects, attitude)
5. `GroundQuery` and `GroundSample` semantics (physics)
6. SimVars read and written, events
7. Airports: what gets built, lighting, PAPI, markings
8. Sky, sun, moon, clouds, precipitation, lighting
9. Terrain streaming and LOD
10. Pure helpers (geodesy, astronomy, layouts)
11. Quality presets and performance budgets
12. Usage example (app shell) and aircraft notes
13. Limits and simplifications

---

## 1. Coordinate conventions

| Frame | Axes | Notes |
|---|---|---|
| Geodetic | lat, lon (deg, +N/+E), alt (m MSL) | WGS84 ellipsoid; heights treated as MSL everywhere (geoid ignored consistently). |
| Scene (Three.js) | x = east, y = up, z = south | Local ENU at the floating origin (`world.frame`), origin on the ellipsoid (h = 0). |
| Object-local ENU | same axes at the object's own lat/lon | Given by `frame.enuQuaternion(lat, lon)`; used by terrain tiles and airport groups. |
| Aircraft object | x right, y up, z aft (nose = -z) | Matches `cockpit/geometry.ts`. `frame.attitudeQuaternion` / `frame.nedQuaternionToLocal` produce this. |
| Physics body | x fwd, y right, z down | Only via `nedQuaternionToLocal` input. |
| `GroundSample.normal` | [east, north, up] | Unit vector in local ENU at the sample point. |

Distances in metres, angles in degrees unless a name says otherwise.

## 2. Renderer requirements (render/app agent)

- `THREE.WebGLRenderer` (all world materials are GLSL / `onBeforeCompile`; not WebGPU).
- Depth: `logarithmicDepthBuffer: true` (recommended) or `reversedDepthBuffer: true`.
  Camera `near` 0.1-0.3 m and `far` >= 1,000 km (e.g. `2e6`) - terrain goes to ~500 km.
- Tone mapping `THREE.ACESFilmicToneMapping`, `toneMappingExposure` ~1.0,
  `outputColorSpace = SRGBColorSpace`. World lighting is calibrated for this
  (horizon sky ~0.3 linear, sunlit white ~1.2) and applies its own partial eye adaptation
  (dusk/night brighten up to x80); do not add another auto-exposure on top.
- Shadows (quality high/ultra): `renderer.shadowMap.enabled = true`; set `castShadow` on
  aircraft meshes. The world's sun light shadow frustum is 120 m square centred on the camera.
- Pass the renderer to `new World({ renderer })` (pixel ratio, drawing-buffer height,
  anisotropy) or call `world.setViewport(heightPx, pixelRatio)` yourself.
- Electron/CSP: allow `connect-src https://s3.amazonaws.com` and `worker-src 'self' blob:`.
  The terrain worker is created with
  `new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })`.
  Cache Storage is used when the context is secure (https, localhost, `app://`).

Render order used by the world (so other modules can interleave):
sky dome -1000, stars -999, moon -998, base ground -10 (opaque, drawn first, no depth test for
sky objects); terrain 0; runways/taxiways 1; transparent: airport lights 10, cloud slices
21..1020 (farthest first), precipitation 40.

---

## 3. `World` (`src/world/World.ts`)

```ts
class World implements WorldQuery {
  constructor(opts: WorldOptions);
  readonly frame: ReferenceFrame;          // floating origin
  readonly root: THREE.Group;              // everything the world draws; already added to opts.scene
  readonly uniforms: WorldUniforms;        // shared shader uniforms (sun dir, haze, clouds...)
  readonly environment: Environment;       // sky, sun/moon lights, clouds, precipitation, fog
  readonly terrain: TerrainRenderer;
  readonly airports: AirportManager;
  readonly store: ElevationStore;          // decoded elevation tiles
  readonly surfaces: SurfaceIndex;         // airport runway/taxiway/apron planes
  readonly ground: GroundQuery;            // the WorldQuery implementation (pure)

  // WorldQuery
  sampleGround(latDeg: number, lonDeg: number): GroundSample;
  sampleGroundInto(latDeg: number, lonDeg: number, out: GroundSample): GroundSample;
  elevationAt(latDeg: number, lonDeg: number): number;
  ensureLoaded(latDeg: number, lonDeg: number, radius_m?: number): Promise<void>;

  // Frame
  update(dt: number, camera: THREE.Camera, aircraft: GeoPosition): void;
  setViewport(heightPx: number, pixelRatio?: number): void;
  get quality(): WorldQuality;
  setQuality(level: WorldQuality): void;   // 'low' | 'medium' | 'high' | 'ultra'
  getStats(): WorldStats;
  dispose(): void;
}
```

### `WorldOptions`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scene` | `THREE.Scene` | required | `world.root` is added to it; `scene.fog` is set to a `FogExp2` the world drives. |
| `vars` | `SimVars` | required | See section 6. |
| `nav` | `NavDatabase` | required | Airports come from `nav.airportsNear()`; nothing is built until `nav.ready`. |
| `events` | `EventBus` | none | `world.recenter` is emitted here. |
| `quality` | `WorldQuality` | `'high'` | Initial preset (section 11). |
| `origin` | `{lat, lon}` | `0, 0` | Initial floating origin. The first `update` recentres on the aircraft anyway. |
| `terrainUrl` | string | AWS terrarium | Template with `{z}`, `{x}`, `{y}`. |
| `renderer` | `THREE.WebGLRenderer` | none | Pixel ratio, viewport height, max anisotropy. |
| `year` | number | current UTC year | Calendar year for `env.day_of_year`. |
| `workers` | number | `min(3, cores/2)` | Terrain workers; `0` = main-thread loading (slow, fallback only). |

### `update(dt, camera, aircraft)`

Call once per rendered frame **after** positioning the aircraft object and the camera for
the frame and **before** `renderer.render`. `aircraft` = `{ lat, lon, alt_m }` (alt MSL, m),
normally `fdm.lat_deg`, `fdm.lon_deg`, `fdm.alt_msl_ft * 0.3048`.

It, in order:
1. Recentres the floating origin when the aircraft is > 10 km from it (first call: always
   recentres on the aircraft). On a recenter it applies the rigid `delta` to the camera's
   top-level scene ancestor (or the camera itself if it has no parent) so the current frame
   renders consistently, fires `frame.onRecenter` listeners and emits `world.recenter`.
2. Streams physics tiles around the aircraft and render tiles around the camera (LOD).
3. Refreshes airports (every 2 s or 2 km), builds at most one airport per frame, updates
   all airport lights (PAPI colours from the camera eye).
4. Updates sun/moon/sky/haze/clouds/precipitation and writes the env outputs.

`dt` is clamped to [0, 1] s. The camera may be a `PerspectiveCamera` (FOV/zoom used for LOD).

### WorldQuery methods

- `sampleGround(lat, lon)`: ground under a point. **Returns an object from a 32-entry ring
  buffer**: it stays valid for the next 31 calls (enough for any gear loop). Copy fields (or
  use `sampleGroundInto`) to keep a sample. Never throws, never allocates, typically < 1 us
  (unit test asserts < 5 us). Details in section 5.
- `sampleGroundInto(lat, lon, out)`: same, into a caller-owned `GroundSample`
  (create with `createGroundSample()` from `world/GroundQuery`).
- `elevationAt(lat, lon)`: elevation (m MSL) with runway/airport flattening; sea surface = 0;
  NaN-safe (returns the fallback elevation for non-finite input).
- `ensureLoaded(lat, lon, radius_m = 2500)`: resolves when the z14 (~10 m) elevation tiles
  covering the square of half-size `radius_m` are loaded and the airports around the point
  are known (forces an airport refresh, so call it after `nav.load()`). Never rejects;
  resolves after 25 s at the latest (offline: `sampleGround(...).precise` stays false).
  The tiles are pinned in memory while the aircraft is near.

### `setQuality(level)` / `quality`

Switches every budget in `QUALITY_PRESETS[level]` at runtime (tile counts, mesh resolution,
cloud slices, shadows, airport radius/count). Existing tiles are rebuilt progressively.

### `getStats(): WorldStats`

```ts
interface WorldStats {
  terrain: { leaves; shown; meshes; triangles; pendingLoads; pendingUploads;
             completeness /* 0..1 desired leaves at target LOD */; thresholdPx; viewRadiusM };
  airports: { built; candidates; surfaces; lights };
  elevationTiles: number; tilesLoaded: number; tilesFromCache: number; tilesFailed: number;
  recenters: number; originLat: number; originLon: number; sunElevationDeg: number;
}
```
`terrain.completeness > 0.97 && pendingLoads === 0` is a good "scenery loaded" signal
for a loading screen.

### `dispose()`

Terminates workers, disposes every geometry/material/texture the world created, removes
`world.root` from the scene and clears `scene.fog` if it is the world's. Pending
`ensureLoaded` promises resolve.

---

## 4. `ReferenceFrame` (`src/world/ReferenceFrame.ts`)

Floating origin. All math in float64 on the CPU; only object transforms reach the GPU.
Round trip geodetic -> scene -> geodetic is exact to < 1 cm at 50 km (unit tested).

```ts
class ReferenceFrame {
  constructor(lat = 0, lon = 0);
  get originLat(): number; get originLon(): number;
  get version(): number;                          // +1 per recenter
  toLocal(lat, lon, altM, out: THREE.Vector3): THREE.Vector3;
  toGeodetic(x, y, z, out: { lat; lon; alt_m }): typeof out;
  vectorToGeodetic(v: THREE.Vector3, out): typeof out;
  objectGeodetic(obj: THREE.Object3D, out): typeof out;       // world position of obj
  ecefToLocal(x, y, z, out: THREE.Vector3): THREE.Vector3;
  localToEcef(x, y, z, out: number[] | Float64Array): typeof out;
  enuQuaternion(lat, lon, out: THREE.Quaternion): THREE.Quaternion;   // local ENU at (lat,lon) -> scene
  enuMatrix(lat, lon, out: THREE.Matrix4): THREE.Matrix4;
  attitudeQuaternion(lat, lon, headingTrueDeg, pitchDeg, bankDeg, out): THREE.Quaternion;
  nedQuaternionToLocal(lat, lon, qw, qx, qy, qz, out): THREE.Quaternion; // body->NED quat from the FDM
  placeObject(obj, lat, lon, altM, headingDeg = 0, pitchDeg = 0, bankDeg = 0): void;
  upAt(lat, lon, out: THREE.Vector3): THREE.Vector3;          // local vertical in scene coords
  approxAltitude(x, y, z): number;                            // y + |xz|^2 / 2R (fast, < 1 m within 100 km)
  distanceFromOrigin(lat, lon): number;                       // m, great circle
  maybeRecenter(lat, lon, thresholdM = 10000): boolean;       // World.update calls this
  recenter(lat, lon): void;
  onRecenter(fn: (e: RecenterEvent) => void): () => void;     // returns unsubscribe
}
interface RecenterEvent { lat; lon; previousLat; previousLon; version; delta: THREE.Matrix4 } // pNew = delta * pOld
const RECENTER_DISTANCE_M = 10_000;
```

- `attitudeQuaternion`: heading true (0 = north, 90 = east), pitch + nose up, bank + right
  wing down, for an object whose nose is local -z (x right, y up). Use it for the aircraft
  object and for a free camera.
- `nedQuaternionToLocal`: same result from the physics body-to-NED quaternion
  (body x fwd, y right, z down). Unit test: agrees with `attitudeQuaternion` for ZYX Euler angles.
- `placeObject(obj, lat, lon, alt)` with zero angles orients `obj` in its local ENU frame
  (use for scenery: markers, AI traffic parked, etc.).
- Objects placed from lat/lon every frame need no recenter handling. Anything placed once
  must re-place itself in `onRecenter` (or apply `e.delta`).

---

## 5. `GroundQuery` / `GroundSample` (physics contract)

`src/world/GroundQuery.ts` (pure: no Three.js/DOM; `world.ground` is the live instance).

```ts
interface GroundSample {                        // src/world/types.ts
  elevation_m: number;                          // m MSL
  normal: [number, number, number];             // unit, local ENU [east, north, up]
  surface: 'asphalt' | 'concrete' | 'grass' | 'dirt' | 'gravel' | 'water' | 'snow' | 'unknown';
  precise: boolean;
}
class GroundQuery {
  constructor(store: ElevationStore, surfaces: SurfaceIndex);
  fallbackElevation: number;   // used where no tile is loaded (World sets nearest airport elevation)
  dayOfYear: number;           // seasonal snow classification (World copies env.day_of_year)
  sampleGround(lat, lon): GroundSample;                      // ring buffer of 32
  sampleGroundInto(lat, lon, out: GroundSample): GroundSample;
  elevationAt(lat, lon): number;
}
function createGroundSample(): GroundSample;
const GROUND_SAMPLE_RING = 32; const PRECISE_ZOOM = 12;
```

Resolution order for a point:
1. **Paved rectangles** (runway incl. shoulders and blast pads, parallel taxiway, connectors,
   apron) of airports within ~40 nm: exact plane; elevation linear along the runway between
   the two end elevations, level across; `normal` from the runway slope; `surface` = runway
   surface (`unknown` runways report `asphalt`), taxiways `asphalt`, aprons `concrete`;
   `precise = true`.
2. **Graded area** around runways (runway safety area, taxiway/apron/building zone): plane
   elevation, `surface = 'grass'`; then a 150 m blend back to terrain (normal from the
   blended field by finite differences). The rendered terrain uses the same function, so
   wheels touch what you see.
3. **Terrain**: highest-zoom loaded terrarium tile (z14 ~ 9.5 m pixels near the aircraft
   below 2,000 m AGL, z13 ~ 19 m always, z11 5x5 around the aircraft for TAWS), bilinear
   between pixel centres, seamless across tile edges; normal from the bilinear gradient.
   `precise = zoom >= 12`. Elevation <= 0 is reported as water at 0 m with an up normal.
   Above the latitude/season snow line with slope < 50 deg: `snow`. Otherwise `grass`.
4. **Nothing loaded**: `fallbackElevation` (nearest airport elevation once known, else 0),
   `surface = 'unknown'`, `precise = false`.

TAWS/look-ahead: `elevationAt` over ~50 km around the aircraft uses at least z11
(~76 m) data, plus whatever finer render tiles are loaded.

---

## 6. SimVars and events

Read (all optional; defaults in brackets):

| Var | Use |
|---|---|
| `env.time_utc_h` [system clock] | Sun/moon/stars. |
| `env.day_of_year` [system clock] | Sun/moon, seasonal snow line. |
| `env.visibility_m` [40,000] | Haze extinction (Koschmieder, 3.912 / V); >= 8 km blends to ~80 km clear-air range. |
| `env.cloud_base_ft` [5,000] | **AGL of the reference field** (nearest airport within 50 nm, else terrain under camera), like a METAR. |
| `env.cloud_cover` [0] | 0..1 fraction (FEW ~0.19, SCT ~0.44, BKN ~0.75, OVC 1). >= 0.85 becomes a stratus sheet. |
| `env.precip` [0] | 0..1 rain/snow intensity (snow when the air at the camera is below +1 C). |
| `env.sl_temp_c` [15] | Snow vs rain (standard lapse 6.5 C/km). |
| `fdm.wind_dir_deg`, `fdm.wind_kt` | Cloud drift and precipitation streaks. |

Written (every `update`):

| Var | Meaning |
|---|---|
| `env.sun_elev_deg` | Apparent (refraction-corrected) sun elevation at the camera, NOAA algorithm. |
| `env.ambient_light` | 0..1, log-scaled illuminance: 0 = 0.1 lux, 0.6 ~ sunrise (400 lux), 1 = 100,000 lux. Includes moonlight and cloud dimming (below/in cloud). Use for display auto-dimming. |
| `world.cloud_base_msl_ft`, `world.cloud_top_msl_ft` | Current layer (EST thickness 600-1,300 m). |
| `world.in_cloud` | 0..1 cloud density at the camera (whiteout). |
| `world.sun_az_deg`, `world.moon_elev_deg` | Sun azimuth (true), moon elevation. |
| `world.cam_agl_ft` | Camera height above terrain/runway. |
| `world.tiles_pending` | Terrain tiles queued or in flight. |

Names are exported as `WORLD_VARS` (`src/world/worldVars.ts`).

Events (`opts.events`): `WORLD_EVENTS.recenter` = `'world.recenter'`, payload
`{ lat, lon, previousLat, previousLon, version }` (degrees). For the transform, subscribe to
`world.frame.onRecenter` instead (payload has `delta`).

---

## 7. Airports (`src/world/airports/`)

Built automatically from `nav.airportsNear(aircraft, 40 nm)` (quality radius), most
important first (large > medium > small, then longest runway, then distance), at most
`maxAirports` (6-24 by quality), one per frame; unloaded beyond 1.15x the radius.
Physics surfaces are registered for every airport within max(radius, 20 nm) regardless of
the visual budget. Heliports, seaplane bases and closed fields are skipped.

Per airport (`buildAirportLayout(airport)` in `runwayModel.ts`, pure):
- Runway ends paired by `oppositeIdent`; a missing far end is synthesised from heading and
  `lengthFt`. Local frame at end A; length/heading from the end coordinates.
- Classification per end (AC 150/5340-1M Table 2-1): ILS with glideslope = precision;
  paved >= 3,000 ft at medium/large airports = non-precision (EST: RNAV approaches are not
  in the database); other paved = visual; unpaved = no markings.
- Approach lights: ALSF-2 on ILS ends at large airports; MALSR on other ILS ends and on
  instrument ends at large airports; none at small airports. TDZ lights with ALSF-2.
  Centreline lights with ALSF-2 or on large-airport runways >= 150 ft wide.
  HIRL on precision/large-airport runways, MIRL otherwise. REIL on lighted ends without ALS
  at medium airports or on runways >= 4,000 ft.
- PAPI (4-box) on lighted paved runway ends >= 3,000 ft: left side, inboard unit 50 ft
  (30 ft small GA) from the edge, 20-30 ft spacing, aiming +30'/+10'/-10'/-30' about the
  glide path (ILS GS angle or 3.0 deg), distance = TCH * cot(GP - 10') with TCH 40/45/50 ft
  by airport class, or co-located with the GS antenna when known.
  `BuiltAirport.lights.papiState(out)` returns per-unit whiteness (0 red .. 1 white).
- Parallel taxiway (500/400/240 ft offset, 75/50/25 ft wide by class), connectors every
  ~900 m with runway holding position markings (250/200 ft from centreline), apron and,
  for medium/large (quality >= medium), terminal/tower/hangars.
- Blast pads (200 ft large, 150 ft medium >= 6,000 ft) with yellow chevrons; shoulders
  25/10 ft.

Markings (`markings.ts`, drawn analytically in the runway shader): threshold stripes by
width (Table 2-2), designators with FAA proportions (Figure A-6) from a procedural glyph
atlas, letter nearest the threshold, centreline 120/80 ft stretched to fit, aiming point at
1,020 ft (150/100 ft long), TDZ groups 3-2-2-1-1 at 520/1520/2020/2520/3020 ft trimmed per
Tables 2-3/2-4, edge stripes, displaced-threshold bar/arrows/arrowheads, blast-pad
chevrons. Asphalt vs concrete (slab joints), rubber deposits, wear, wet darkening.

Lights (`lightLayout.ts` pure + `AirportLights.ts` GPU): bidirectional colours (edge
white/yellow caution zone facing each instrument end, threshold green/end red, centreline
colour coding), sequenced flashers "twice a second", rotating beacon white/green 24
flashes/min, blue taxiway edge lights. On when `env.ambient_light < 0.5` or visibility
< 5 km or in cloud; PAPI always; beacon dusk-to-dawn or visibility < 5 km. Sprite size and
brightness follow the illuminance at the eye with atmospheric extinction (lights reach
farther than objects), dimmed in daylight.

`world.airports.get(icao): BuiltAirport | undefined` gives `{ icao, layout, group, lights, dispose() }`.

---

## 8. Sky and environment (`src/world/sky/`, `world.environment`)

```ts
class Environment {
  readonly sunLight: THREE.DirectionalLight;   // sun by day, moon at night; follows the camera
  readonly hemiLight: THREE.HemisphereLight;   // sky/ground ambient (pi * sky radiance)
  readonly sky: SkyDome; readonly stars: StarField; readonly clouds: CloudLayer;
  readonly precipitation: Precipitation; readonly fog: THREE.FogExp2;
  get sunDirection(): THREE.Vector3;           // scene frame unit vector
  get sunElevationDeg(): number;
  jd: number;                                  // Julian day (UT) of the last update
  lux: number;                                 // horizontal illuminance used for env.ambient_light
}
```
- Sun: NOAA solar position (tested against NOAA calculator output to 0.002 deg).
  Moon: Astronomical Almanac low-precision formulae, phase from Sun-Moon elongation,
  drawn as a lit sphere (correct terminator). Stars: 1,630 real stars (Yale BSC5, V <= 5)
  + 2,500 faint ones, rotated by local sidereal time and latitude, extinction near the horizon.
- Sky: Preetham single scattering (altitude-aware) plus a twilight term calibrated to the
  civil/nautical twilight illuminance curve; partial eye adaptation.
- Haze: exponential layer from the field elevation (scale height 1.5 km; 400 m below
  5 km visibility; 120 m in fog) + Rayleigh clear air; the same aerial perspective is applied
  by terrain, runways, clouds and the base ground. `scene.fog` (FogExp2) is matched at the
  visibility distance for other materials (aircraft exterior).
- Clouds: one layer of 5-12 stacked slices (quality), coverage field calibrated so the
  covered fraction equals `env.cloud_cover`, cumulus tops narrowing with height, stratus
  sheet when overcast, wind drift, cloud shadows on terrain/runways (broken cumulus), whiteout
  inside cloud (CPU mirror `clouds.densityAt(x, z, altM)`).
- Precipitation: world-anchored rain streaks (8 m/s) / snow (1 m/s) around the camera,
  streak direction from the relative wind (horizontal streaks at approach speed).
- Wetness: pavement and terrain darken/gloss with rain (slow dry-out).

---

## 9. Terrain (`src/world/terrain/`)

- Data: AWS Terrain Tiles terrarium PNG, `elev = R*256 + G + B/256 - 32768` (`terrarium.ts`),
  fetched and decoded in module workers (`terrain.worker.ts`) with Cache Storage (bucket
  `amg-terrain-terrarium-v1`, ~6,000 tiles max) + in-memory LRU (`ElevationStore`).
- LOD (`lod.ts`): quadtree from z5/z6 roots over a view radius of horizon + 195 km
  (clamped per quality to 220-500 km), split while `vertexSpacing * K / distance >
  threshold` with `K = h / (2 tan(fov/2))`; independent of view direction. Leaf budget
  enforced by relaxing the threshold.
- Meshes (`tileMesh.ts`): per-tile ENU frame, geodetic -> ECEF -> ENU in float64, skirts,
  airport flattening for z >= 11 (rebuilt when airport surfaces change), sea flattened to 0.
- Material (`TerrainMaterial.ts`): MeshStandardMaterial + onBeforeCompile (scene lights,
  landing lights and shadows work). Biomes: grass, forest, farmland patchwork, dry grass and
  desert (subtropical belts, high continental plains), boreal/tundra, rock by slope,
  seasonal snow line by latitude, water with depth colour/shoreline/foam/ripples/glint/sky
  reflection, detail noise near the camera. Noise is anchored to Web Mercator metres
  (deterministic per place).
- `BaseGround`: camera-following disc below all loaded terrain (or at the fallback
  elevation when offline) so there is always a ground plane and a horizon.

---

## 10. Pure helpers (usable anywhere, including workers/tests)

`src/world/geo.ts`: `WGS84_A/F/B/E2`, `EARTH_MEAN_RADIUS_M`, `DEG2RAD`, `RAD2DEG`,
`FT_TO_M`, `M_TO_FT`, `NM_TO_M`, `geodeticToEcef(lat, lon, h, out)`,
`ecefToGeodetic(x, y, z, out)`, `enuBasis(lat, lon, out9)`, `haversineM`,
`initialBearingDeg`, `destinationPoint(lat, lon, brg, dist, out)`, `metresPerDegree(lat, out)`,
`primeVerticalRadius`, `meridianRadius`, `horizonDistanceM(h)`, `wrapLon`, `wrap360`,
`lonDelta`, `smoothstep`, `clamp`, `lerp`.

`src/world/sky/solar.ts`: `julianDay0h(y, m, d)`, `julianDayFromDayOfYear(y, doy, utcH)`,
`julianDayFromDate(date)`, `sunPosition(jd, lat, lon, out?) -> { elevationDeg,
trueElevationDeg, azimuthDeg, declinationDeg, equationOfTimeMin, hourAngleDeg, distanceAu }`,
`moonPosition(jd, lat, lon, out?) -> { elevationDeg, azimuthDeg, raDeg, decDeg, illuminated,
elongationDeg, waxing, ... }`, `gmstDeg(jd)`, `noaaRefractionDeg(el)`,
`horizontalToVector(el, az, out)` (to scene-style x=E, y=U, z=S).

`src/world/sky/illumination.ts`: `clearSkyIlluminanceLux(sunElDeg)`,
`moonIlluminanceLux(moonElDeg, illuminated)`, `cloudTransmission(cover)`, `ambientLevel(lux)`.

`src/world/airports/lightLayout.ts`: `papiWhiteness(elevDeg, aimDeg)`,
`papiAimingAngles(gpDeg)`, `papiWhiteCount(elevDeg, gpDeg)`, `runwayLights(rw)`,
`approachLights(rw, end)`, `papiLights`, `reilLights`, `taxiwayLights`, `LIGHT_COLORS`.

`src/world/airports/runwayModel.ts`: `buildAirportLayout(airport)`, `pairRunways`,
`reciprocalIdent`, `splitDesignator`, `runwayToLatLon(rw, s, t, out)`,
`latLonToRunway(rw, lat, lon, out)`, `runwayElevation(rw, s)`.

`src/world/airports/surfaces.ts`: `FlattenSurface`, `SurfaceIndex`, `evalFlatten`.
`src/world/terrain/tileMath.ts`: slippy-map tile math. `src/world/terrain/lod.ts`: LOD.

---

## 11. Quality presets (`QUALITY_PRESETS` in `src/world/quality.ts`)

| | low | medium | high (default) | ultra |
|---|---|---|---|---|
| Terrain segments / tile | 32 | 48 | 64 | 64 |
| SSE threshold (px) | 9 | 7 | 6 | 4 |
| Max terrain leaves (draw calls) | 150 | 220 | 300 | 480 |
| View radius (km) | 60-220 | 80-320 | 100-420 | 120-500 |
| Deepest render zoom | 13 | 14 | 14 | 15 |
| Elevation cache (256 KB/tile) | 200 | 280 | 360 | 480 |
| Cloud slices | 5 | 7 | 9 | 12 |
| Precip particles | 4k | 8k | 14k | 22k |
| Airports (radius nm / max) | 25 / 6 | 40 / 10 | 40 / 16 | 40 / 24 |
| Sun shadows / buildings | no / no | no / yes | 2048 / yes | 4096 / yes |

Worst-case terrain triangles ~ leaves * 2 * segments^2 (high: ~2.5 M; typical ~0.5-1 M
because most leaves are far and coarse). Airport lights are one draw call per airport.
Hidden tile meshes are kept up to `meshCacheTiles`, then disposed (GPU buffers freed).

---

## 12. Usage

App shell (render module):

```ts
const world = new World({ scene, vars, nav, events, renderer, quality: 'high' });
await nav.load();
await world.ensureLoaded(startLat, startLon);            // before spawning on a runway
fdm.reposition({ lat: startLat, lon: startLon, onGround: true, headingTrue: rwyHdg });

function frame(dt: number) {
  const lat = vars.get(FDM.lat), lon = vars.get(FDM.lon), altM = vars.get(FDM.altMsl) * 0.3048;
  // 1) place the aircraft (camera is a child of the cockpit/aircraft object)
  world.frame.toLocal(lat, lon, altM, aircraftObject.position);
  world.frame.attitudeQuaternion(lat, lon, vars.get(FDM.headingTrue), vars.get(FDM.pitch),
                                 vars.get(FDM.bank), aircraftObject.quaternion);
  // 2) world (may recenter and shift aircraftObject by the delta for this frame)
  world.update(dt, camera, { lat, lon, alt_m: altM });
  renderer.render(scene, camera);
}
```

Physics / systems (`SimContext.world` is the World as a `WorldQuery`):

```ts
const g = ctx.world.sampleGround(contactLat, contactLon);
const hAgl = contactAltM - g.elevation_m;            // use g.normal (ENU) for the contact plane
const mu = g.surface === 'asphalt' || g.surface === 'concrete' ? 0.8 : 0.5;
```

Aircraft modules: landing/taxi lights should be `THREE.SpotLight`s on the exterior; the
terrain, runway and taxiway materials are MeshStandardMaterial and are lit by them.
Radar altimeter / TAWS: use `elevationAt`. Nothing in `src/world` needs aircraft data.

---

## 13. Limits and simplifications (SCOPE)

- No land-cover or water-body data: lakes/rivers above sea level are not water; land
  below sea level (e.g. Death Valley, polders) renders as water. Biomes are climate heuristics.
- Runways: level across the width (no crown), linear profile between ends; crossing runways
  with different end elevations can show a small step at the intersection.
- Taxiway layout, apron and buildings are generic (the database has no taxiway geometry).
- Approach light geometry beyond the AIM figure (barrette pitch, crossbar details) is EST.
- One cloud layer; no cloud self-shadowing volume raymarch; no lightning.
- Terrain noise scale is Web Mercator based (features shrink ~1/cos(lat) at high latitude).
- Mercator tiles stop at 85.05 deg latitude; the base ground covers the poles.
