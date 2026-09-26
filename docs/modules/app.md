# App shell: API reference

Owner: app shell. Source: `src/main.ts`, `src/App.ts`, `src/render/**`,
`src/input/**`, `src/audio/**`, `src/ui/**`, `src/platform/**`,
`src/aircraft/_test/**`, `electron/**`, `electron-builder.yml`, `build/**`,
`.github/workflows/**`, `scripts/smoke.mjs`.
Tests: `tests/app/**` (`npx vitest run tests/app`), plus `npm run smoke`.

This document tells aircraft authors what the app does for them, what it
expects from an `AircraftModule`, and which ids, vars and events they can
use for sound, input, cameras and scripting. Nothing here requires reading
the app source.

---

## 0. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server at http://localhost:5173 (`/proxy/awc` proxies aviationweather.gov for live METARs). |
| `npm run build` | Production bundle in `dist/` (relative asset URLs: loads from the dev server, `vite preview` and Electron). |
| `npm run electron:dev` | Vite + Electron pointed at the dev server (`VITE_DEV_SERVER_URL`). |
| `npm run electron:start` | Build, then run Electron on `dist/` through `app://app/index.html`. |
| `npm run dist:win` | Build + `electron-builder --win --x64`: `release/AMG-Flight-Simulator-Setup-<ver>-x64.exe` (NSIS, per user, desktop + start-menu shortcut, no admin) and `release/AMG-Flight-Simulator-<ver>-x64-portable.exe`. |
| `npm run dist:linux` / `npx electron-builder --linux dir` | Unpacked Linux build in `release/linux-unpacked/` (packaging check). |
| `npm run smoke` | Headless Chromium flies a scripted scenario against `dist/` (see section 9). |
| `node build/make-icon.mjs` | Regenerates `build/icon.png` (512 px) and `build/icon.ico` (16 to 256 px); the icon is procedural. |

CI: `.github/workflows/build-windows.yml` runs on every push (any branch) and
on demand. A Linux job runs typecheck, tests and the web build. A
`windows-latest` job (Node 22) runs `npm ci`, typecheck and tests, then
`npm run dist:win -- --publish never`, and uploads the installer and the
portable exe as workflow artifacts.

### URL parameters (dev server, preview, smoke)

`?aircraft=<id>&airport=<ICAO>&runway=<ident>|parking=<n>&state=<state>&time=HH:MM|now&date=YYYY-MM-DD&weather=<preset>|live|live:<ICAO>&quality=low|medium|high|ultra&shadows=0&autotest=1`

The flight starts straight away when `aircraft` or `airport` is present,
skipping the menu. States are `cold_dark`, `ready_to_taxi`, `takeoff` (on the
runway), `approach` (10 nm final) and `cruise`. Weather presets are `cavok`,
`scattered`, `ifr`, `storm` and `winter`. `autotest=1` selects low quality at
0.75 resolution and does not save graphics settings.

---

## 1. Launch flow and frame order

```
Main menu (aircraft, airport + runway/parking/auto, state, UTC date/time, weather)
  -> weather: preset | manual | live METAR (station or nearest, fallback CAVOK)
  -> unload previous session; set env.time_utc_hours / env.day_of_year; applyWeather()
  -> planStart(airport, spot, state, meta, surface wind)          (src/ui/startPosition.ts)
  -> world.frame.recenter(start); await world.ensureLoaded(start, 2500 m ground / 1500 m air)
  -> fdm = new FlightModel(module.fdm, vars, world, { magneticYear }); fdm.wind.setWindsAloft(...)
  -> ctx = { vars, events, world, nav, audio, fdm, storage: createStorage('ac.<id>') }
  -> instance = await module.create(ctx)
  -> app adds what the aircraft did not create (see 2.3)
  -> fdm.reposition(start); instance.applyState(state); NAV1 ILS auto-tune; radios/FMS reset; GPS acquired
  -> vehicle models + CockpitShadows.prepare; CockpitRuntime; camera.setAircraft; audio.configure;
     input.router.setMap(instance.inputMap)
  -> loop.start()  (document.body.dataset.simPhase = 'flying'; window.__sim.ready = true)
```

SimLoop callbacks (fixed step, see physics.md 1.1):

| Callback | Rate | App work |
|---|---|---|
| `input(realDt)` | per frame | `InputManager.poll` (keyboard, gamepads, mouse yoke), then `CommandRouter.update` |
| `systems(dt)` | 60 Hz, before FDM | `instance.systems[i].update(dt)` in array order (each in try/catch, errors reported once) |
| `physics(dt)` | 120 Hz | `vehicle.capture(fdm)` (pre-step pose for render interpolation), then `fdm.step(dt)` |
| `nav(dt)` | 20 Hz, after FDM | Radios/FMS the app added (aircraft-owned radios stay in `systems`) |
| `frame(info)` | per frame | UTC clock advance; floating-origin recenter + place aircraft; `instance.updateExterior(dt)`; `CockpitRuntime.update`; camera (head motion, look, zoom); `world.update`; cockpit shadows; render; audio; overlays/HUD |

`env.time_utc_hours` advances with **sim** time (it stops when paused, runs
faster at higher sim rates) and wraps `env.day_of_year`.

---

## 2. Aircraft integration contract

### 2.1 What the app reads from an `AircraftModule`

| Field | Used for |
|---|---|
| `meta.id` | Catalog lookup (`src/aircraft/registry.ts`; a module becomes available when `src/aircraft/<id>/index.ts` exists), storage namespace `ac.<id>` |
| `meta.name`, `avionics`, `description` | Menu, toasts |
| `meta.engines`, `engineType` | Default FMS engine count, HUD engine readout (`eng{i}.n1_pct`/`n2_pct`, or `eng{i}.rpm` for pistons) |
| `meta.typical.approachKias` | 10 nm final start speed = approachKias + 15 kt (EST: intermediate approach speed) |
| `meta.typical.cruiseAltFt`, `cruiseKtas` | Cruise start (`cruise` state): altitude and a derived IAS |
| `meta.chaseDistance_m` | Chase camera distance; orbit and fly-by scale with it |
| `fdm` | FlightModel config; audio profile (`profileFromFdm`: engine positions and classes, gear contact points) |
| `create(ctx)` | May be async. Must return the instance **without** repositioning: the app calls `fdm.reposition` and then `applyState` |

### 2.2 What the app reads from an `AircraftInstance`

| Field | Contract |
|---|---|
| `systems` | Updated at 60 Hz in array order (sources before consumers). If a `Radios` instance is in the list the app does not add its own (see 2.3). |
| `cockpit.root` | Cockpit-local frame (x right, y up, z aft; the root sits at the datum). Top-level children are hidden in external views unless `userData.visibleFromOutside = true`. |
| `cockpit.eyePosition_m` | Pilot eye in body metres; default cockpit view. The camera looks 8 deg down from the horizontal (EST: typical design eye over-the-nose view). |
| `cockpit.views` | Preset views (`name`, body `position_m`, `yawDeg`, `pitchDeg`, `fovDeg?`). `C` cycles them. |
| `exterior` | Object3D in the same local frame. Top-level children are hidden in the cockpit view unless `userData.visibleFromCockpit = true`. Flag the wings, engines and nose so they show through the windows, and leave the fuselage cabin unflagged. |
| `updateExterior(dt)` | Called every frame after placement (animate gear, surfaces, lights, fans). |
| `applyState(state)` | See 2.4. |
| `checklists` | Checklist viewer (`K`). Items with `check(vars)` show live ticks. |
| `inputMap` | Keyboard/joystick command mapping (section 4.3). |
| `dispose()` | Called on unload or reposition to another aircraft. Dispose geometries, textures and display canvases, and unsubscribe. |

**Cockpit shell.** Sun shadows in the cockpit come from `CockpitShadows`:
while the camera is in the cockpit, the world's sun shadow camera is refitted
to plus or minus 2.6 m around the eye. For shadows to fall on the panel, the
cockpit must contain opaque structure between the sun and the panel
(glareshield, window frames, roof and sidewalls). `CockpitShadows.prepare(root)` is
applied to both the cockpit and the exterior at load. It sets `castShadow`
and `receiveShadow` on opaque meshes whose material is not `MeshBasicMaterial`.
Transparent glass neither casts nor receives. To opt a mesh out, set
`castShadow = false` after load in `create()`. The app only calls `prepare`
at load and does not change flags afterwards.

### 2.3 What the app adds when the aircraft does not

| Missing in `systems` | App adds | Notes |
|---|---|---|
| `Radios` | `new Radios(ctx, { navCount: 2, adfCount: 1 })`, updated at 20 Hz | Sets `nav1/2.powered`, `adf1.powered`, `marker.powered`, `gps.powered` = 1 **only if** those vars do not exist yet. Aircraft with real avionics power should create their own `Radios` and drive the `*.powered` vars from their buses. |
| `Fms` | `new Fms(ctx, { style: 'garmin', engineCount })`, 20 Hz | Aircraft with an FMS should create their own (style, perf data). |
| `FailureManager` | `new FailureManager(vars, { events })`, first in `systems` | Registers `s.failures()` from every system that has such a method. The pause menu's Failures tab lists these. |

Fuel systems (`instanceof FuelSystem`) are used by the Fuel & payload tab
(tank quantities). `Apu` presence adds the APU sound.

### 2.4 `applyState(state)` expectations

The app has already called `fdm.reposition({ lat, lon, onGround, altFtMsl?, headingTrue, iasKt? })`
when `applyState` runs. The aircraft then does the following:

- Sets every switch, knob and lever var for the state (cold & dark:
  everything off, battery off, parking brake set; ready to taxi: engines
  running, avionics on, before-taxi flows done; takeoff: before-takeoff checks
  complete, flaps for takeoff, trims set, lights; approach and cruise: in-air
  configuration).
- Calls `fdm.setEnginesRunning(true|false)` (FlightModelHandle) after writing
  the engine input vars.
- **In-air states** are trimmed by the aircraft. Cast `ctx.fdm` to
  `FlightModel`, call `computeTrim(...)`, and set the pitch trim and thrust
  (the `_test-jet` shows how: `computeTrim`, trim position, then
  `Turbofan.n1ForThrust` inverted through the FADEC lever law by bisection).
  The smoke test fails when the approach state loses or gains more than 600 ft in 10 s.
- Resets the system internals that hold state (`reset()` of electrical, fuel,
  AHRS and ADC) so indications match at once. AHRS should be aligned in
  every state except cold & dark.
- After `applyState`, the app sets NAV1 to the approach ILS
  (`nav1.active_mhz`, `nav1.obs_deg` magnetic) for the `approach` state when
  the runway has one. It then calls `reset()` on radios and FMS and forces GPS
  acquisition (except cold & dark).

### 2.5 Start positions (`src/ui/startPosition.ts`)

| State | Placement |
|---|---|
| `cold_dark`, `ready_to_taxi` with a parking spot | Generic apron spot from the world's airport layout (the nav data has no gates), nose toward the runway. |
| `takeoff` and ground states with a runway | Centreline, `LINEUP_M` = 45 m from the pavement end (EST), runway true heading. |
| `approach` | Extended centreline 10 nm from the landing threshold, on the ILS glideslope angle (or 3 deg) through a 50 ft TCH (FAA Order 8260.3), speed approachKias + 15. |
| `cruise` | 40 nm out along the runway heading at `typical.cruiseAltFt`. |

Automatic runway: largest headwind component, ties go to the longest runway.
A runway with more than 3 kt of tailwind is treated as not in use (EST). For
`approach`, an ILS runway in use is preferred. Runway designators are
compared after normalization (`'01'` = `'1'`, `'RWY 6L'` = `'6L'`).

---

## 3. Weather and time

`applyWeather(vars, weather, windSink)` (`src/ui/weather/weather.ts`) writes:

| Var | Meaning |
|---|---|
| `env.qnh_inhg` | Altimeter setting |
| `env.sl_temp_c` | Sea-level temperature derived from the station temperature by the ISA lapse rate (1.98 C / 1000 ft) |
| `env.qnh_ref_elev_ft` | Elevation (ft MSL) of the reporting station / departure field; the FDM anchors QNH altimetry there so the altimeter reads field elevation on the ground |
| `env.visibility_m`, `env.cloud_cover` (0..1), `env.cloud_base_ft` (AGL), `env.precip`, `env.turbulence`, `env.icing` (0..1) | Visuals and FDM |
| `env.wind_dir_deg`, `env.wind_kt`, `env.wind_gust_kt` | Surface wind (FROM, true). Gust is the **increment** above the mean. |
| `env.dewpoint_c` (appended) | Dew point |
| `env.weather_name`, `env.metar` (string vars) | UI and ATIS-style displays |

Winds aloft go to `fdm.wind.setWindsAloft([{ altitudeFt, directionDeg, speedKt }])`.
The presets (`WEATHER_PRESETS`) and the live-METAR converter (`metarToWeather`)
produce a full `WeatherState`. `parseMetar` decodes FAA and ICAO METARs:
wind, variable wind, gusts, visibility in SM (including fractions and `M1/4SM`),
metres, `CAVOK`, RVR (ignored), weather groups, cloud layers with CB/TCU, `VV`,
temperature and dew point (including the `RMK T` group), altimeter `A`/`Q`.
Trend groups (`BECMG`, `TEMPO`, `NOSIG`) end the parse. See `tests/app/metar.test.ts`.

Live METAR: `fetchMetar(icao)` / `fetchNearestMetar(lat, lon)` call the
aviationweather.gov Data API through `src/platform/http.ts`.

---

## 4. Input

### 4.1 Vars written every frame (`InputManager.poll`)

| Var | Range | Source priority |
|---|---|---|
| `input.pitch`, `input.roll` | -1..1 | 3D yoke drag (`cockpit.yoke_active`) > mouse yoke > held key (ramped 2.0/s, springs back 3.2/s) > hardware axis |
| `input.yaw` | -1..1 | 3D pedals > held key (2.8/s) > hardware |
| `input.tiller` | -1..1 | hardware tiller axis, else 0 |
| `input.brake_left/right` | 0..1 | max of keys, hardware toe brakes, 3D toe brakes |
| `input.pitch_trim_rate` | -1..1 | trim keys, else hardware hat/axis (+ = nose up) |
| `input.ap_disc`, `input.toga` | 0/1 | held keys or buttons |
| `input.throttle{1..4}` | 0..1 | hardware throttle axes (a single axis drives all levers) |
| `input.throttle_axis_bound` | 0/1 | 1 while any hardware throttle axis is bound (cockpit levers should then follow `input.throttle{i}`) |
| `input.mixture{1..2}`, `input.mixture_axis_bound` (appended) | 0..1, 0/1 | hardware mixture axes |
| `input.throttle_rate`, `input.mixture_rate` (appended) | -1/0/1 | keyboard slew direction |
| `input.mouse_yoke` (appended) | 0/1 | mouse-yoke mode |

### 4.2 Events

`INPUT_EVENTS` (`src/input/actions.ts`) are emitted on the EventBus when the
key or button fires, whether or not the aircraft maps them:
`input.gear_toggle`, `input.flaps_up`, `input.flaps_down`,
`input.flaps_full_up`, `input.flaps_full_down`, `input.spoilers_toggle`,
`input.spoilers_arm`, `input.spoilers_retract`, `input.spoilers_extend`,
`input.parking_brake_toggle`, `input.throttle_idle`, `input.throttle_full`,
`input.reverse_toggle`, `input.mixture_rich`, `input.mixture_cutoff`,
`input.ap_toggle`, `input.at_disconnect`, `input.center_controls`,
`input.mouse_yoke_toggle`.

`APP_EVENTS`: `view.cockpit`, `view.next`, `view.prev`, `view.external`,
`view.reset`, `sim.pause_toggle`, `sim.rate_inc`, `sim.rate_dec` (the `sim.*`
events are handled by SimLoop), `ui.menu`, `ui.help`, `ui.checklist`,
`ui.debug`, `ui.fullscreen`.

### 4.3 `AircraftInputMap` (appended to `src/aircraft/types.ts`)

`CommandRouter` writes the aircraft's **own cockpit vars**. Cockpit controls
follow external writes and animate, so a key press visibly moves the 3D lever.

```ts
instance.inputMap = {
  throttles: ['ac.m2.tla1', 'ac.m2.tla2'], throttleRange: [0, 1],
  reverse: { value: -0.3 },                  // integral reverse range on the same lever
  // reverse: { vars: ['ac.b738.rev1', 'ac.b738.rev2'], full: 1 },   // separate piggy-back levers
  mixtures: ['ac.c172.mixture'], mixtureRange: [0, 1],
  flaps: { var: 'ac.m2.flap_handle', detents: [0, 1, 2, 3] },       // retract -> extend
  gear: { var: 'ac.m2.gear_handle', up: 1, down: 0 },
  speedbrake: { var: 'ac.m2.spdbrk', positions: [0, 0.5, 1], armed: 0.1 },
  parkingBrake: { var: 'ac.m2.park_brake', on: 1, off: 0 },
  apToggleEvent: 'ac.m2.ap_button', atDisconnectEvent: 'ac.m2.at_disc',
};
```

Behaviour:

- **Throttle.** F3/F2 slew at 0.4/s (full travel 2.5 s). F1 goes to idle and
  F4 to full. Holding F2 with the lever at idle keeps slewing into reverse,
  down to the `value` of an integral reverse range or up to `full` on the
  reverse levers. Shift+F2 jumps between idle and full reverse. Holding F3
  slews back out of reverse to idle before any forward thrust. When `input.throttle_axis_bound` = 1
  the router writes the hardware axis position into the throttle vars
  (mapped to `throttleRange`), so the lever follows.
- **Mixture.** Ctrl+F2/F3 slew at 0.2/s. Ctrl+F1 is cutoff and Ctrl+F4 is full rich.
- **Flaps.** F6/F7 or `[`/`]` step one detent; F5/F8 go to the ends.
- **Gear.** `G` toggles between the up and down values. It is refused with
  a `lever.gate` sound while `gear.handle_lock` = 1 or `fdm.on_ground` = 1
  (squat switch / down-lock solenoid).
- **Speedbrake.** `/` toggles stowed and fully extended. Ctrl+`/` goes to
  `armed`.
- **Parking brake.** Ctrl+`.` toggles.
- **AP and A/T.** `Z` emits `apToggleEvent` and Shift+`T` emits
  `atDisconnectEvent`. Shift+`Z` holds `input.ap_disc`; `T` holds `input.toga`.

### 4.4 Default keyboard

| Keys | Action |
|---|---|
| Arrows / Num 8 2 4 6 | Elevator and ailerons (ramped; spring back) |
| Q / E, Num 0 / Num Enter | Rudder |
| Num 5 | Centre ailerons and rudder |
| Num 7 / Home, Num 1 / End | Pitch trim nose down / nose up |
| `.` / `,` / Shift+`/` / Ctrl+`.` | Both brakes / left brake / right brake / parking brake |
| F1 F2 F3 F4, Num 9 / Num 3 | Throttle idle / decrease / increase / full |
| Shift+F2 | Thrust reverse toggle |
| Ctrl+F1..F4 | Mixture cutoff / leaner / richer / rich |
| F5 F6 F7 F8, `[` `]` | Flaps full up / up / down / full down |
| G | Gear |
| `/`, Ctrl+`/` | Speedbrake toggle, ground spoilers arm |
| Z, Shift+Z | AP engage toggle, AP disconnect (hold) |
| T, Shift+T | TO/GA (hold), A/T disconnect |
| C, Shift+C | Cockpit view / next cockpit preset, previous view |
| V, Shift+V | External camera cycle, next view |
| Shift+arrows, Space | Look around, reset view |
| `=` `-`, Num + / Num - | Zoom |
| P, R, Shift+R | Pause, sim rate faster/slower (1 to 16x) |
| Esc, H, K, backquote, F11, Y | Pause menu, keyboard help, checklists, debug HUD, full screen, mouse yoke |

Mouse: the left button drags cockpit controls (`CockpitRuntime`). The left
or right button dragged on empty space looks around, and the wheel over empty
space zooms. Keys are ignored while a text field has focus or when an event was
`defaultPrevented`. Rebinding is in the Controls tab and is stored under `input.keys`.

### 4.5 Joysticks, yokes, pedals, throttle quadrants

Gamepad API. Each device gets a profile keyed by its `Gamepad.id`, stored in
`input.devices.<id>`. Axes can be bound to any `AxisTarget`: `pitch`,
`roll`, `yaw`, `tiller`, `throttle`, `throttle1..4`, `mixture`,
`mixture1..2`, `brakes`, `brake_left`, `brake_right`, `pitch_trim`,
`look_x`, `look_y`, or `hat_look` (DirectInput POV hat decoded from its
axis). Each axis has invert, deadzone, a response curve (0 = linear, 1 =
cubic), sensitivity, and calibration: move the axis through its full range
for 5 s. Buttons can bind to any action. The default profile is chosen by
device class, detected from the id and the axis count (gamepad, rudder
pedals, throttle quadrant, yoke, joystick). The Controls tab shows the live
axis values.

Mouse yoke (`Y`): the cursor position maps to the controls. 75 % of the
half-screen gives full deflection, with a 3 % deadzone. Cockpit clicking is
disabled while the mouse yoke is active.

---

## 5. Audio (`src/audio`)

Everything is synthesized with WebAudio at load; there are no sample files.
The `AudioContext` is created on the first user gesture (browser autoplay
policy). Before that, every call is accepted and tones are remembered.

### 5.1 `AudioApi` ids (`ctx.audio`)

- **`play(id, { volume, rate, position })`, one-shots.** All
  `COCKPIT_SOUNDS` ids (`switch.toggle`, `switch.toggle_heavy`,
  `switch.rocker`, `switch.guard_open/close`, `button.press/release`,
  `key.press`, `knob.detent`, `knob.selector`, `knob.push`, `lever.detent`,
  `lever.gate`, `lever.slide`, `gear.handle`, `cb.pull/push/trip`,
  `handle.pull/push/rotate`, `fuel.selector`, `trim.wheel`, `yoke.button`),
  plus `gear.lock`, `touchdown`, `tyre.squeal`, `master_caution` (single
  chime), `alt_alert` / `alert.altitude` (C5-E5-G5 chord), `chime`,
  `chime.triple`, `relay.click`. An unknown id plays the closest family
  sound: `switch.*` plays a toggle click, `knob.*` a detent, `alert.*` a
  chime. `position` is in body metres and is spatialized with HRTF.
- **`tone(id, on)`, continuous alerts.** `stall_horn` (reed horn),
  `stick_shaker`, `overspeed` (clacker, 8 Hz, EST), `ap_disconnect` (cavalry
  charge), `at_disconnect`, `master_warning` (repeating chime),
  `gear_horn`, `takeoff_config`, and `marker_outer`/`middle`/`inner` (400,
  1300 and 3000 Hz keying per AIM 1-1-9).
- **`loop(id)`, continuous sounds with gain and rate handles.**
  `noise.white`, `noise.pink`, `noise.brown`, `hum.motor`, `hum.hydraulic`,
  `gyro.whine`, `fan.avionics`, or any tone id.
- **`callout(text, priority = 5)`.** Uses speechSynthesis. A higher priority
  interrupts a lower one. The same text is dropped while it is queued or
  playing, and queued callouts older than 6 s are dropped. When speech is
  unavailable, the fallback is a chime plus a caption. Suggested priorities:
  9 for PULL UP and WINDSHEAR, 8 for STALL, 7 for TERRAIN and SINK RATE, 5
  for MINIMUMS and altitude callouts.

### 5.2 Automatic sounds (no aircraft code needed)

| Sound | Driven by |
|---|---|
| Turbofan (fan tone and blade-pass, core whine, combustion roar, starter) | `eng{i}.n1_pct`, `n2_pct`, `thrust_n`, `starter`, `ignition`, `running`, `reverser_pos` |
| Piston (firing frequency, prop blade-pass, roughness) | `eng{i}.rpm`, `power_hp`, `roughness`, `running`, `starter` |
| APU | `apu.n_pct` (when the aircraft has an `Apu` system) |
| Airflow, buffet, rain | `fdm.ias_kt` (scales with dynamic pressure), `fdm.buffet`, `env.precip` when SAT > 1 C |
| Rolling, pavement joints, touchdowns, tyre squeal | `fdm.on_ground`, `fdm.gs_kt`, `gear.wow{i}`, `fdm.vs_fpm` |
| Gear lock thumps, gear and flap hydraulic/motor hum | `gear.pos{i}` reaching 0 or 1 or moving; rate of change of `surf.flaps_deg` |

Engine classes come from `profileFromFdm`. A turbofan above 60 kN is CFM56
class (5380 rpm N1 at 100 %, 24 fan blades); otherwise it is business-jet
class (EST). A piston is IO-360 class (4 cylinders, 2 blades), or 6-cylinder
from 500 cu in. The cockpit insulation (a low-pass on the exterior bus) is
1.1 kHz at 0.4 gain for jets and 2.6 kHz at 0.85 for pistons (EST). Volumes
come in six groups (master, engines, environment, cockpit, alerts, voice),
set in the Audio tab and stored under `settings.audio`.

---

## 6. Rendering and cameras (`src/render`)

The renderer is `THREE.WebGLRenderer` with a logarithmic depth buffer, ACES
Filmic tone mapping (exposure 1), sRGB output and `PCFShadowMap`. Near
planes are 0.05 m in the cockpit and 0.3 m outside, and the far plane is
2000 km. `GraphicsSettings` holds `quality` (low to ultra, passed to
`world.setQuality`), `shadows`, `resolutionScale` (0.5 to 1.5),
`cockpitFovDeg` (default 55 deg vertical), `headMotion` and `showFps`. They
are stored under `settings.graphics`.

**Floating origin.** Each frame the app reads the FDM geodetic position,
calls `world.frame.maybeRecenter`, and places the aircraft group with
`frame.toLocal` and `frame.nedQuaternionToLocal`. At launch and on
reposition it pre-recenters, so the first frame never jumps.

**Render interpolation** (`VehicleNode`, `src/render/VehicleNode.ts`). Physics
steps at a fixed 120 Hz, so on a 75/90/144/165 Hz display a frame advances
by 0, 1 or 2 steps; drawing the latest step would make the aircraft and
the cockpit camera judder. `vehicle.capture(fdm)` runs before every physics
step, and `vehicle.readSource(fdm, frameInfo.alpha)` draws
`prev + (latest − prev)·alpha` (normalised quaternion lerp for the
attitude), i.e. up to one step (8.3 ms) behind the physics. Paused frames
draw the latest state; moves of more than 200 m or 10 deg between captures
(reposition, slew, state presets) snap, and `vehicle.resetInterpolation()`
is called after every reposition. `vehicle.geo` / `vehicle.attitude` hold
the drawn pose (cameras use `geo`). Cockpit instruments keep reading the
latest SimVars.

**Camera modes** (`CameraSystem`):

| Mode | Description |
|---|---|
| `cockpit` | Pilot eye plus the aircraft's presets (0.35 s transitions). Mouse or keys look around (yaw ±175 deg, pitch ±85 deg). Zoom range is 12 to 95 deg vertical FOV. Head motion is a spring: the head moves 2 cm per g vertically, 3.5 cm per g laterally and 4.5 cm per g fore/aft, limited to 6 cm, with buffet and runway-roughness shake (EST). |
| `chase` | Behind and above at `chaseDistance_m` (zoom 0.3x to 12x). It follows the aircraft's heading with a 0.6 s lag. |
| `orbit` | Free orbit around the aircraft. Drag or look keys to rotate, zoom for distance. |
| `tower` | Fixed 30 m above the ground, 300 m from the reference point of the nearest airport (within 12 nm), perpendicular to its longest runway (EST). Auto-zooms on the aircraft. It moves to a new airport when the aircraft is more than 25 km away. |
| `flyby` | Placed ahead on the track (6 s lead, 250 to 1500 m) and offset sideways. It re-places itself once the aircraft is 1.6 times the start distance past. |

The chase and orbit cameras stay at least 1.5 m above the terrain. The audio
listener follows the camera, with Doppler from the camera's closing speed.

---

## 7. UI (`src/ui`)

- **Main menu.** Aircraft picker (entries whose module does not exist yet
  are shown as IN DEVELOPMENT), airport search (ICAO, name or city), runway
  and parking list, initial state, UTC date and time (the Dawn, Morning,
  Noon, Dusk and Night buttons pick local mean solar time at the airport's
  longitude), and
  weather (presets, a manual editor including a winds-aloft table, or live
  METAR by station or nearest).
- **Pause menu (Esc).** Tabs for Position (reposition, state), Time &
  weather, Failures, Fuel & payload, Controls, Graphics and Audio. Resume
  and Quit to menu. The sim pauses while it is open.
- **Overlays.** Toasts, callout captions, the PAUSED badge, a status line
  (sim rate, mouse yoke, crash), the optional FPS counter, and the debug HUD
  (backquote). The checklist viewer (`K`) and keyboard help (`H`) are
  side-docked. None of this covers the view by default.

---

## 8. Platform (`src/platform`)

- **`http()` / `fetchText(url)` / `fetchJson(url)`.** Try routes in order:
  `electron` (IPC `http:get` in the main process, allow-listed https hosts only,
  currently `aviationweather.gov`, re-checked on the final URL after redirects;
  only the app's own page may call it — `electron/guards.cjs`), then `proxy` (dev server only:
  `https://aviationweather.gov/...` becomes `/proxy/awc/...`), then
  `direct` (CORS). Each response carries `route`.
- **`createStorage(namespace)`.** localStorage under `amgsim.<ns>.<key>`
  (JSON), with an in-memory fallback. Namespaces in use: `settings` (keys
  `launch`, `graphics`, `audio`), `input` (`keys`, `devices.*`), and
  `ac.<aircraftId>` (the aircraft's own `ctx.storage`).
- **Environment.** `isElectron()`, `isDevServer()`, `platformLabel()`,
  `appVersion()`, and `toggleFullscreen()` (Electron window or DOM
  fullscreen). `getBridge()` returns `window.amg` when running in Electron
  (`AmgBridge`: `httpGet`, `toggleFullscreen`, `setFullscreen`,
  `isFullscreen`, `quit`, `versions`, `platform`).

**Electron** (`electron/main.cjs`, Electron 44). The privileged `app://`
scheme (standard, secure, fetch, CORS, stream) serves `dist/` through
`protocol.handle`, with a CSP on HTML: `connect-src` is self plus the AWS
terrain tiles S3 hosts. The window is 1920x1080, with no menu, F11 for
full screen, and F12 for devtools in unpacked builds (or
`AMG_DEVTOOLS=1`). `backgroundThrottling` is off. The renderer runs with
`contextIsolation`, `sandbox` and no `nodeIntegration`. There is a single
instance lock, and the GPU blocklist is ignored. External links open in the
system browser, and navigation away from the app is blocked.

---

## 9. Scripting and diagnostics: `window.__sim`

```ts
interface SimDebugApi {
  phase: string;            // 'boot' | 'menu' | 'loading' | 'flying' | 'error' (also document.body.dataset.simPhase)
  ready: boolean;           // true once a flight is running
  error: string;
  frames: number;
  get(name): number; getString(name): string; set(name, value): void;
  emit(event, payload?): void;
  vars(prefixes?: string[]): Record<string, number>;
  view(mode: 'cockpit'|'chase'|'orbit'|'tower'|'flyby'|'next'): string;
  pause(p: boolean): void;
  zoom(notches: number): void;
  stats(): { fps, render, world, loop, aircraft, renderer, camera, vehicle, placement };
  launch(partial: Partial<LaunchConfig>): Promise<void>;   // e.g. { state: 'approach', spot: { kind: 'auto' } }
  profile(reset?: boolean): ProfileReport;                  // per-frame JS time by stage (FrameProfiler)
  pick(ndcX, ndcY): PickResult | null;                      // visible opaque surface under a screen point
  displays(): DisplayProbe[];                               // cockpit display power / renders / lit fraction
  ground(): { surface, elevation_m, precise };              // world ground under the aircraft
  pilot: { takeoff(opts?): phase; stop(): void; state(): { phase, log } };   // scripted test pilot
}
```

`docs/modules/qa.md` is the full reference: argument and result types, the
`ScriptedPilot` takeoff script and its gains, the profiler sections, and the
headless integration-test pattern. The app calls the scripted pilot
(`App.pilot`, idle unless started) at 60 Hz before the aircraft systems, so its
`input.pitch/roll/yaw` override the frame's device values. A reposition or
relaunch stops it.

`scripts/smoke.mjs` serves `dist/` and drives Chromium through
playwright-core, headless with SwiftShader WebGL. Set `CHROMIUM_PATH` to use
a different browser; the default is `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
`HTTPS_PROXY` is passed to Chromium. `SMOKE_CA_FILE` (default
`NODE_EXTRA_CA_CERTS`) lists extra CA certificates to trust, such as a
TLS-inspecting proxy's CA. Only those CA keys are added, pinned with
`--ignore-certificate-errors-spki-list`, and certificate verification stays
on.

The scenario asserts about 40 numeric checks, listed in `docs/modules/qa.md`
section 2:

1. Menu with no query: the aircraft catalog lists the eight requested types.
2. `_test-jet` lined up at KTEB rwy 01 (scattered weather). Terrain converges,
   the runway is under the aircraft, the displays draw, the sky is visible,
   and the runway is visible from the cockpit and chase views.
3. Parking brake for 20 s of sim time: no drift, no bounce, every var finite.
   The frame profile is logged.
4. Scripted takeoff. Brakes off and full thrust go through the input router.
   The `ScriptedPilot` holds the centre line and rotates at VR. The aircraft
   must lift off within the runway and climb above 1,000 ft with the gear up,
   and it must be visible in the orbit and tower views.
5. 10 nm final: the altitude must stay within 600 ft over 10 s. When the
   placement has an ILS, NAV1 must receive the localizer.

The script fails on any uncaught page error, any unexpected console error or
any failed check. It writes `tests/output/*.png`, `vars.json`, `stats.json`
(every check plus the profiles) and `console.log`.

---

## 10. The `_test-jet` development aircraft (`src/aircraft/_test`)

The `_test-jet` is a pipeline test harness, not a real type. The menu hides
it once any real aircraft module exists; `?aircraft=_test-jet` still loads
it. It uses:

- the `TEST_JET` FDM (physics fixtures);
- the cockpit demo panel (`buildDemoCockpit(ctx, 'citation')`), moved into
  a lofted cockpit shell with windshield, pillars and sidewalls;
- a Test PFD (1024x768 canvas, 30 Hz) built from `avionics/common` tapes,
  ADI and HSI;
- an electrical system with a battery, two 300 A starter-generators and an
  avionics relay;
- a two-tank fuel system with ejector and boost pumps, crossfeed and
  firewall valves;
- FADEC with a detent law; gear with a horn; flaps 0/7/15/35; spoilers; brakes;
  steering; a stall warning (AoA); an engine 1 fire loop with handle and
  bottle;
- an exterior with animated surfaces, gear, reversers, fans and lights.

Its `applyState` lives in `state.ts` (`applyTestJetState(ctx, sys, state)`,
free of Three.js), so the headless integration test
(`tests/integration/testJet.test.ts`) runs the same code as the app. The
landing light is a 600,000 cd class lamp scaled by the world's photometric
var `world.render_units_per_lux`, with `decay = 2`. Copy that for every
exterior light.

All numbers are EST. Its `index.ts` shows the full integration pattern:
`inputMap`, `applyState` with in-air trim, checklists with live checks, and
exterior visibility flags.
