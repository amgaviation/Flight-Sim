# QA: pipeline, smoke test, diagnostics and test harnesses

Owner: final QA pass. Sources: `scripts/smoke.mjs`, `src/input/ScriptedPilot.ts`,
`src/core/FrameProfiler.ts`, the `window.__sim` debug API in `src/App.ts`,
`src/aircraft/_test/state.ts`, `tests/integration/testJet.test.ts`,
`tests/world/terrainStreaming.test.ts`.

This is the reference for anyone adding an aircraft (the eight production
types) or changing a shared module. It covers:

- the release pipeline and what "green" means;
- every smoke-test check and its threshold;
- the `window.__sim` scripting API;
- the scripted test pilot;
- the frame profiler;
- the headless integration-test pattern your aircraft should copy.

You can code against it without reading the sources.

---

## 1. Pipeline (all must pass before a hand-off)

| Step | Command | Pass criteria |
|---|---|---|
| Types | `npm run typecheck` | No output (TypeScript 7 strict, whole project). |
| Unit + integration tests | `npm test` | All files pass (vitest; `tests/**`, `src/**/*.test.ts`). The long flight tests (next row) are left out, so it takes about 3-4 min on 4 cores. |
| Long flight tests | `npm run test:long` | The six full-flight check rides `tests/aircraft/<id>/verify/fullFlight.test.ts` (cold & dark to cold & dark per jet, about 1-3 min each) and the six published-performance flights `tests/aircraft/<id>/performance.test.ts` (takeoff, climb, cruise, stall sweeps against the AFM/FPG data, 30-75 s each) pass. `AMG_LONG_TESTS=1` un-excludes them (see `vite.config.ts`), so `AMG_LONG_TESTS=1 npx vitest run <path>` runs one. `npm run test:all` runs everything. CI runs them in the `long-tests` job. |
| Web build | `npm run build` | `dist/` written, no errors. |
| Jets in the app | `npm run build && npm run jets-qa` | Prints `JETS QA PASSED`; every jet loads in every initial state (section 10). Look at the PNGs in `tests/output/jets/`. |
| Browser smoke | `npm run build && npm run smoke` | Prints `SMOKE PASSED: n/n checks`; exit code 0. Look at every PNG in `tests/output/`. |
| Dev server | `npm run dev` then `curl http://localhost:5173/` | HTML with `<div id="app">` and `/src/main.ts`; `/data/*.json.gz` served (Vite adds `Content-Encoding: gzip`; the nav loader sniffs the gzip magic, so both encodings work). |
| Packaging | `npx electron-builder --linux dir` | `release/linux-unpacked/amg-flight-sim` exists; `resources/app.asar` lists `/dist/index.html`, `/dist/assets/*`, `/dist/data/*`, `/electron/main.cjs`, `/electron/preload.cjs`, `/electron/guards.cjs`, `/package.json`, and no `node_modules` and no `.map`. |
| Packaged app runs | `xvfb-run -a release/linux-unpacked/amg-flight-sim --no-sandbox --remote-debugging-port=9335`, then playwright `connectOverCDP` (set `NO_PROXY`) | Page `app://app/index.html` reaches `__sim.phase === 'menu'` with `isSecureContext` and `window.amg`; `__sim.launch({ aircraftId: '_test-jet', airport: 'KTEB', state: 'takeoff' })` flies. `window.amg.httpGet` rejects hosts that are not allow-listed. Do not use `--headless=new`: Electron 44 segfaults there once WebGL starts. |
| Windows exe | CI: `.github/workflows/build-windows.yml` | Built on `windows-latest` (not reproducible on Linux without wine). |

`tests/output/` is ignored by git; it holds the last smoke run.

---

## 2. Smoke test (`scripts/smoke.mjs`)

It serves `dist/` with a small static server and drives headless Chromium
(playwright-core) with SwiftShader WebGL at 1280x720. Environment variables:

- `CHROMIUM_PATH`: the Chromium binary.
- `SMOKE_AIRPORT` / `SMOKE_RUNWAY`: default `KTEB` / `01`.
- `SMOKE_TIMEOUT_S`: default 240.
- `HTTPS_PROXY`.
- `SMOKE_CA_FILE`: default `NODE_EXTRA_CA_CERTS`. These CA keys are pinned with `--ignore-certificate-errors-spki-list`, and certificate verification stays on.

Terrain tiles and METARs come from the network. Offline, the terrain checks
fail by design. Every check prints a `PASS`/`FAIL` line. The script writes
`tests/output/stats.json` (every check plus profiles), `vars.json`,
`console.log` and the screenshots.

A full run takes about 12-13 minutes under SwiftShader. It renders 0.5-4 fps, and a frame is
clamped to 0.25 s of sim time, so sim time runs at 1/8 to 1 of real time.

### 2.1 Checks

| Check | Scenario | Threshold |
|---|---|---|
| `menu.phase`, `menu.errors` | Page with no query | `__sim.phase === 'menu'`, no uncaught error |
| `menu.catalog` | Aircraft column of the menu | All eight requested types present: Citation M2, Citation Longitude, Skyhawk (steam), Skyhawk (G1000), G650, G800, Global 6000, 737 |
| `menu.fly` | Menu | FLY enabled, departure/position list populated |
| `flight.start` | `?aircraft=_test-jet&airport=KTEB&runway=01&state=takeoff&time=15:00&weather=scattered&autotest=1` | `phase === 'flying'` |
| `scenery.terrain` | Parking brake set, wait up to 120 s | terrain completeness >= 90 % (normally 100 %, no pending loads/uploads) |
| `scenery.airports` | | >= 1 airport built |
| `scenery.runway_under_aircraft` | `__sim.ground()` | surface asphalt/concrete, `precise` |
| `cockpit.displays` | `__sim.displays()` | every display powered, not booting, `renders > 0`, lit > 15 % of its canvas |
| `cockpit.sky` | `pick(0, 0.85)` | nothing opaque above the horizon |
| `cockpit.runway_visible` | `pick` scan ahead of the glareshield | an airport (pavement) mesh is the visible surface |
| `chase.aircraft_visible` / `chase.runway_visible` | chase view | aircraft near the screen centre; pavement below it |
| `ground.parking_brake` | `input.parking_brake_toggle` through the command router | `ac.demo.park_brake === 1` |
| `ground.no_drift` | 20 s of sim time sampled every 0.4 s real | drift < 0.5 m, max GS < 0.3 kt |
| `ground.no_bounce` | same | altitude span < 0.5 ft, pitch and bank spans < 0.3 deg |
| `ground.heading` | same | heading span < 0.3 deg |
| `ground.on_ground`, `ground.engines` | same | WOW throughout; N1 > 20 % both; main bus > 26 V |
| `ground.finite` | `__sim.vars()` | every numeric var finite |
| `takeoff.controls` | `input.parking_brake_toggle`, `input.throttle_full` | brake 0, both levers 1 |
| `takeoff.accelerating` | 6 s after brake release | GS > 15 kt |
| `takeoff.runway_visible` | chase view during the roll | pavement under the aircraft |
| `takeoff.rotate_at_vr` | `__sim.pilot.takeoff()` | rotation IAS in [VR, VR+5) (VR = 110 kt, `_test-jet` `typical.rotateKias`) |
| `takeoff.liftoff` | | lift-off IAS in (VR, VR+25), distance 200 m to (runway length - 45 m) |
| `takeoff.centre_line` | | max deviation on the ground < 10 m (half-width 22.9 m) |
| `takeoff.rotation` | | max pitch 8 to 13 deg (target 10, tail contact ~14.5) |
| `takeoff.climb` | until 1,100 ft AGL or 90 s | phase `climb`, > 1,000 ft AGL, VS > 500 fpm |
| `takeoff.gear_up`, `takeoff.no_crash`, `takeoff.finite` | | gear handle up and mains retracted, not crashed, all vars finite |
| `view.orbit`, `view.tower` | climbing | the aircraft is the visible surface near the screen centre |
| `approach.flying`, `approach.trimmed` | `launch({ state: 'approach', spot: { kind: 'auto' } })` | airborne; altitude change < 600 ft in 10 s |
| `approach.ils` | when the placement has an ILS | NAV1 localizer received, \|CDI\| < 0.5 |
| `approach.chase_aircraft` | chase view | aircraft visible |
| `page.errors`, `console.errors` | whole run | no uncaught error; console errors limited to resource-load messages |

### 2.2 Screenshots

These are written to `tests/output/`:

- `menu.png`
- `cockpit.png`
- `cockpit_pedestal.png`
- `chase_lineup.png`
- `chase_roll.png`
- `climb_chase.png`
- `climb_orbit.png`
- `climb_tower.png`
- `climb_cockpit.png`
- `approach_cockpit.png`
- `approach_chase.png`
- `error.png` (only when the run aborts)

Always open them. The numeric checks cannot see colour, lighting or layout
problems.

---

## 3. `window.__sim` (debug and scripting API, `src/App.ts`)

Available in every build (dev, `dist/`, Electron). Everything below is
synchronous unless it returns a Promise.

```ts
interface SimDebugApi {
  phase: string;      // 'boot' | 'menu' | 'loading' | 'flying' | 'error' (mirrored in document.body.dataset.simPhase)
  ready: boolean;     // true while a flight is running
  error: string;
  frames: number;     // frames rendered with an aircraft loaded
  get(name: string): number;
  getString(name: string): string;
  set(name: string, value: number): void;
  emit(event: string, payload?: unknown): void;           // EventBus, e.g. 'input.throttle_full', 'input.parking_brake_toggle'
  vars(prefixes?: string[]): Record<string, number>;      // snapshot of numeric vars (optionally by prefix)
  view(mode: 'cockpit' | 'chase' | 'orbit' | 'tower' | 'flyby' | 'next'): string;   // returns the view label
  pause(p: boolean): void;
  zoom(notches: number): void;
  stats(): { fps, render, world, loop, aircraft, renderer, camera, vehicle, placement };
  launch(partial: Partial<LaunchConfig>): Promise<void>;  // relaunch with overrides, e.g. { state: 'approach', spot: { kind: 'auto' } }

  profile(reset?: boolean): ProfileReport;                // section 5
  pick(ndcX: number, ndcY: number): PickResult | null;    // visible opaque surface under a screen point
  displays(): DisplayProbe[];                             // cockpit display health
  ground(): { surface: string; elevation_m: number; precise: boolean };   // world ground under the aircraft
  pilot: {
    takeoff(opts?: Partial<TakeoffScript>): ScriptedPilotPhase;   // section 4
    stop(): void;
    state(): { phase: ScriptedPilotPhase; log: TakeoffLog };
  };
}

interface PickResult {
  name: string;            // mesh name, e.g. 'runway KTEB 1/19', 'tile 13/2409/3074', 'cabin'
  parent: string;
  kind: 'aircraft' | 'terrain' | 'airport' | 'base-ground' | 'other';
  distance_m: number;      // along the camera ray
}
interface DisplayProbe {
  id: string;              // CockpitDisplay.id
  powered: boolean;        // display.<id>.power (or the display's powerVar) != 0
  booting: boolean;
  renders: number;         // render() calls so far
  uploads: number;         // texture uploads (render() returned true)
  lit: number;             // fraction of a 16x16 sample grid of the canvas that is not black
}
```

The main points:

- **`pick` rules.** The camera ray is intersected with the whole scene, and the nearest hit that is a visible `Mesh` (every ancestor visible) with an opaque, depth-writing material wins. Clouds, glass, sprites and points are skipped. `kind` is `aircraft` for anything under the vehicle node, `airport` under the world `airports` group, `terrain` under the `terrain` group, and `base-ground` for the fallback ground disc.
- **`pick` cost.** It raycasts every terrain triangle, which can take 50-300 ms under SwiftShader. Use it for tests only.
- **`displays().lit`.** It reads the canvas with `getImageData`. A display that is powered but draws nothing (black) reports about 0. A display still showing its boot splash reports `booting`.
- **Aircraft authors.** Name your exterior meshes meaningfully (`pick` returns the name). Keep each display's power var truthful, because the smoke asserts every display draws.

---

## 4. Scripted test pilot (`src/input/ScriptedPilot.ts`)

The scripted pilot is a test harness that flies through the normal pilot
inputs (`input.pitch`, `input.roll`, `input.yaw`, and `input.gear_toggle` on
the EventBus). That way the flight control system, nosewheel steering,
rudder, gear and FDM are exercised exactly as they are with a joystick.

It reads FDM truth (`fdm.*`), the way a pilot looks out of the window. It is
not an autopilot, and aircraft must not use it.

```ts
class ScriptedPilot {
  constructor(vars: SimVars, events?: EventBus | null);
  phase: 'idle' | 'roll' | 'rotate' | 'climb';
  readonly active: boolean;
  readonly log: TakeoffLog;
  startTakeoff(s: TakeoffScript): void;   // from the current position; resets the log
  stop(): void;                           // stops writing inputs (the next InputManager poll takes over)
  update(dt: number): void;               // call at the systems rate BEFORE the aircraft systems
}
interface TakeoffScript {
  vrKt: number;                // rotation speed (kt IAS)
  courseTrueDeg: number;       // runway centre-line course (true)
  lat?: number; lon?: number;  // a point on the centre line (default: position at start)
  pitchDeg?: number;           // target climb attitude, default 10
  rotateRateDegS?: number;     // default 3
  gearUp?: boolean;            // default true: emits input.gear_toggle once (> 50 ft AGL, VS > 300 fpm)
}
interface TakeoffLog {
  rotateIasKt; liftoffIasKt; liftoffDistM; liftoffTimeS;  // NaN until reached
  maxGroundDeviationM;   // centre line, while on the ground
  maxAirBankDeg;         // after lift-off
  maxPitchDeg;           // since rotation
  elapsedS; gearUpCommanded;
}
```

The script works in three phases:

- **Roll.** Stick neutral, wings level with aileron. Pedals hold the centre line: `-(0.04 x cross-track m + 0.12 x heading error deg + 0.25 x yaw rate deg/s)`.
- **Rotate.** At VR the pitch target ramps at 3 deg/s to `pitchDeg`, with PI+D attitude hold: P 0.25/deg, I 0.3/deg·s (anti-windup 0.8), D 0.14 per deg/s.
- **Climb.** Lift-off is confirmed after 0.5 s with no gear on the ground. The pilot then holds attitude, wings level and pedals neutral (it crabs into a crosswind), and commands gear up.

The gains are estimates (EST), tuned on the test jet in calm air, a 10 kt
direct crosswind and 230/10G16 with turbulence. On a new type, check the
takeoff log (`maxPitchDeg`, `maxGroundDeviationM`) before trusting it.

In the app, `App.stepSystems` calls `pilot.update(dt)` before the aircraft
systems, and `window.__sim.pilot.takeoff()` fills its defaults:

- VR = `meta.typical.rotateKias`.
- Course and centre-line point = the start placement's runway when starting on a runway, otherwise the current heading and position.

A reposition or relaunch stops the pilot.

Why the pilot exists: an unsteered takeoff roll in a crosswind is not a valid
test. With the nose wheel held straight, a tricycle's tyre yaw stiffness is
roughly neutral (N_nose x_nose ≈ N_main x_main). Cn_beta weathervaning and the
mains unloading as lift builds then ground-loop the aircraft, as they would a
real jet with nobody on the pedals. The old smoke test ran the roll hands-off
and drove off the runway.

---

## 5. Frame profiler (`src/core/FrameProfiler.ts`)

```ts
class FrameProfiler<Name extends string> {
  constructor(names: readonly Name[], now?: () => number);   // default performance.now
  enabled: boolean;
  id(name: Name): number;       // resolve once, outside the hot path
  begin(id: number): void;      // typed-array writes only, no allocation
  end(id: number): void;
  frame(): void;                // marks the end of a frame
  reset(): void;
  report(): ProfileReport;      // allocates; diagnostics only
}
interface ProfileReport {
  frames: number; seconds: number; frameIntervalMs: number;
  sections: { name; msPerFrame; callsPerFrame; maxMs }[];     // sorted by msPerFrame, largest first
}
```

App sections, in frame order:

| Section | Measures |
|---|---|
| `total` | From the input poll to the end of the UI update (all main-thread JS in the frame). |
| `input` | Input poll. |
| `systems` | Aircraft systems, including the scripted pilot. |
| `physics` | FDM steps. |
| `nav` | App-owned radios/FMS. |
| `vehicle` | Interpolation, floating origin and exterior animation. |
| `cockpit` | CockpitRuntime: controls, interaction, displays (canvas drawing and uploads). |
| `camera` | Camera update. |
| `world` | Terrain LOD and streaming, airports, sky. |
| `shadows` | Cockpit shadows. |
| `render` | `renderer.render`, including GPU command submission and synchronous uploads. |
| `audio` | Audio update. |
| `ui` | Overlays and status. |

`systems`, `physics` and `nav` accumulate every fixed step of the frame, so
`callsPerFrame` shows the step count. `total` excludes compositor and GPU
time, so `frameIntervalMs - total` is roughly the time spent outside the
frame's JS.

Read it with `window.__sim.profile(true)`, which returns the report and
starts a new window.

---

## 6. Headless integration tests: the pattern for each aircraft

`tests/integration/testJet.test.ts` runs the real systems, FDM, command router
and scripted pilot through the real `SimLoop` with a `ManualScheduler`
(60 frames/s: systems 60 Hz, FDM 120 Hz), on a flat `FlatWorld`
(`tests/physics/helpers.ts`). It takes seconds instead of the browser's
minutes. Every aircraft should have the same test.

1. **Keep `applyState` free of Three.js.** Put it in a separate file, like `src/aircraft/_test/state.ts` (`applyTestJetState(ctx, sys, state)`, with `createTestJetSystems(ctx)` in `systems.ts`). Your cockpit build can then stay out of the test.
2. **Build the context.** Use `SimVars`, `EventBus`, `FlatWorld(elev, 'asphalt', 0, lat)`, `new FlightModel(YOUR_FDM, vars, world, { seed, magneticYear })`, a no-op `AudioApi`, `nav: {} as NavDatabase` (or a real database via `nodeLoader` if your systems need it) and a Map-backed `storage`.
3. **Position and prepare.** Call `fdm.reposition({ lat, lon, onGround: true, headingTrue })`, then `applyYourState(ctx, sys, 'takeoff')`. Create `new CommandRouter(vars, events)` and call `.setMap(yourInputMap)`.
4. **Build the loop.** Use `new SimLoop(vars, { input: dt => router.update(dt), systems: dt => { pilot.update(dt); for (const s of systems) s.update(dt); }, physics: dt => fdm.step(dt) }, { scheduler: new ManualScheduler(), events })`, then call `loop.advance(1 / 60)` in a loop.
5. **Assert, at minimum:**
   - **Parking brake at idle for 20 s, in 230/10G16 wind with turbulence.** Drift < 0.3 m, GS < 0.2 kt, heading change < 0.2 deg, altitude span < 10 cm, pitch span < 0.3 deg, all vars finite.
   - **Full thrust with `pilot.startTakeoff({ vrKt, courseTrueDeg })` for 45 s.** Test in calm air, a 10 kt direct crosswind and gusts. Rotation at VR; lift-off speed and distance within your AFM data (cite them); centre-line deviation < 5 m; max pitch below your tail-strike attitude; > 1,000 ft AGL; gear up.
   - **Cold and dark, then start.** Drive only the cockpit switch vars (battery, generators, fuel, run levers, start). Both engines reach idle; generators come on line; bus voltage is regulated. Check the bus dip and the starter current against your AFM or maintenance data.
   - **In-air states (`approach`, `cruise`).** Repositioned in the air as the app does (`reposition({ altFtMsl, iasKt })`, then `applyState`). They must hold altitude (the test jet uses 300 ft), IAS within 10 kt and bank within 5 deg for 20 s, hands-off.

---

## 7. Changes made by the QA pass (for maintainers)

- **Terrain could hide runways.**
  - **Problem.** Coarse terrain tiles, drawn as fallbacks while finer tiles stream in or as far LOD, were not flattened below zoom 10. Their vertex-based flattening also missed pads narrower than a grid cell. The unflattened surface rose above the pavement, and the runway disappeared in chase and tower views.
  - **Fix.** A grid-aware clearance at every zoom (`surfaces.ts` `evalClearance`, `tileMesh.ts`, `FLATTEN_MIN_ZOOM = 0`) keeps every cell that overlaps pavement below it.
  - **Tests.** `tests/world/tileMesh.test.ts`.
- **Terrain streaming livelock.**
  - **Problem.** A freshly uploaded mesh had `lastShown = 0`. If it was hidden in its first frame, the cache trim disposed it at once, so it was rebuilt every frame and coarse fallbacks never cleared at low quality.
  - **Fix.** The hidden-TTL now starts at upload. Uploads are coarse-first and time-budgeted (2 ms, up to 4x the preset count).
  - **Tests.** `tests/world/terrainStreaming.test.ts`.
- **Beach everywhere in low-lying land.**
  - **Problem.** The shader drew sand wherever the elevation was 0.5-3 m. The KTEB/KEWR Meadowlands and other coastal plains showed large pale polygons.
  - **Fix.** A per-vertex coast mask (water dilated by 60 m), packed into `aFlat` as +2 (`tileMesh.ts` `coastMask`, `COAST_FLAG`).
  - **Related.** Coarse tiles now get the geometric pavement clearance only. The flatten weight and shading are applied at z >= 10, as before.
  - **Tests.** `tests/world/tileMesh.test.ts`.
- **Test jet could not start from cold and dark.**
  - **Problem.** `starterAvailable` was bound to `elec.batt_bus_powered` (18 V threshold). The realistic ~16 V cranking dip at ~800 A made the start controller release the starter every other step, so N2 never rose.
  - **Fix.** Availability is now `elec.batt_bus_v >= 7`, and a start relay coil models the physics (pull-in 15 V, MIL-PRF-6106/26; drop-out 7 V, EST). The pitfall is documented in `EngineStartController` and systems-control.md.
  - **Tests.** `tests/integration/testJet.test.ts` (cold-and-dark start: light-off ~6 s, idle ~28 s, peak ITT ~650 °C).
- **Landing light 40x brighter than the sun.** A 30,000 "cd" SpotLight with decay 1.6 was used against a sun of about 3 scene units. The world now publishes `world.render_units_per_lux`, and the test jet uses 600,000 cd x that scale with decay 2. Every aircraft light must follow this rule (docs/modules/world.md).
- **Smoke test.**
  - **Before.** The takeoff was hands-off (no pilot), so the jet ground-looped off the runway in the crosswind and never rotated. The run still passed, because it only checked GS > 15 kt.
  - **Now.** The scripted pilot flies the takeoff, and every requirement is checked numerically (section 2).
- **Electron sender and navigation guard.** The dev-server check was a string prefix, so `http://localhost:51730` passed for `http://localhost:5173`. It now compares origins (`electron/guards.cjs`), and `will-navigate` uses the same guard. Tested in `tests/app/electronGuards.test.ts`.
- **Per-frame allocations in `App.frame`.** The camera inputs were two object literals per frame, and the status line was rebuilt every frame. Both are now reused or cached.
- **Test jet `applyState`.** It moved to `src/aircraft/_test/state.ts` so headless tests use the app's code path.

---

## 8. Performance baseline (smoke, SwiftShader, 1280x720 at 0.75 scale, `quality=low`)

From `tests/output/stats.json` (`profileGround`: cockpit view, parked; `profileFlight`: chase view, takeoff and climb):

| Section (ms per frame) | Parked, cockpit | Takeoff, chase |
|---|---|---|
| total main-thread JS | 12.3-12.8 | 8.5 |
| render (JS side of `renderer.render`, 250 draw calls) | 5.9-6.2 | 2.7 |
| physics (30 steps/frame, the 0.25 s frame clamp) | 1.9 | 1.3 |
| world (terrain LOD, airports, sky) | 1.5 | 1.6 |
| systems (15 steps/frame) | 1.1 | 1.2 |
| cockpit (controls + 2 displays) | 1.0 | 1.0 |
| vehicle, nav, input, camera, audio, ui, shadows | < 0.8 each | < 0.5 each |
| **frame interval** | **~2,000 ms** | **~1,450 ms** |

What the numbers show:

- **The main thread is not the bottleneck.** At a real 60 fps each frame runs 2 physics and 1 systems step, so the fixed-rate work is about 0.2 ms. The JS total would be about 6-9 ms of a 16.7 ms budget.
- **The GPU is.** SwiftShader rasterises on the CPU, and the frame interval is its GPU work. Per frame that is about 480k triangles (283k of terrain) and a heavy per-fragment terrain shader. There is also a logarithmic depth buffer, which writes `gl_FragDepth` and so disables early-Z (renderer description: `log depth on`).
- **No per-frame JS hot spots.** The ones found (camera input literals and the status string) were removed.
- **Run time.** The smoke runs at about 0.5-1 fps, so simulated time advances at 1/8 to 1/4 of real time, and the run takes ~12 minutes.

---

## 9. Known issues (open)

- **Land below sea level renders and behaves as sea.**
  - **Where.** EHAM and the Dutch polders, the Caspian and Dead Sea depressions, Death Valley, New Orleans.
  - **Cause.** Terrain at or below 0 m is flattened to a 0 m sea surface. The mesh (`tileMesh.ts`), the shader and physics (`GroundQuery`, surface `water`) all do this. Terrarium elevation cannot tell a polder from shallow sea. At EHAM the airport pad is correct, but the surrounding land is water at 0 m, 3-4 m above the runways.
  - **Fix.** Bundle a land/water mask built by `npm run navdata` (for example from Natural Earth 10 m land polygons, public domain). Terrain tiles and `GroundQuery` would then classify water from the mask instead of `elevation <= 0`.
- **No land-use data.** Cities render as farmland and forest (the biomes are procedural). Only airports have buildings.
- **Headless Electron.** `--headless=new` segfaults as soon as WebGL starts. Under Xvfb the packaged app runs and flies. The Windows exe is only built in CI and was not run here.
- **Slow smoke.** The smoke needs network access to AWS Terrain Tiles and takes ~12 minutes under SwiftShader.
