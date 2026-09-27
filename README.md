# AMG Flight Simulator

This is a high-fidelity desktop flight simulator with fully interactive 3D
cockpits. It runs in the browser from a Vite dev server, and it also ships as
a Windows `.exe` built with Electron. The source is TypeScript, and
rendering uses three.js.

For personal and internal use by AMG Aviation Group.

## Aircraft

| Aircraft | Avionics | Status | Dossier |
|---|---|---|---|
| Cessna Citation M2 (525) | Garmin G3000 (GTC 570 touch controllers, GMC 710) | flyable | [docs/aircraft/citation-m2.md](docs/aircraft/citation-m2.md) |
| Cessna Citation Longitude (700) | Garmin G5000 (four GTC 570s, autothrottle) | flyable | [docs/aircraft/citation-longitude.md](docs/aircraft/citation-longitude.md) |
| Gulfstream G650 | Honeywell PlaneView II (Primus Epic), MCDUs, CCDs | flyable | [docs/aircraft/g650.md](docs/aircraft/g650.md) |
| Gulfstream G800 | Honeywell Symmetry (touch screens, active sidesticks) | flyable | [docs/aircraft/g800.md](docs/aircraft/g800.md) |
| Bombardier Global 6000 | Collins Pro Line Fusion (Global Vision) | flyable | [docs/aircraft/global6000.md](docs/aircraft/global6000.md) |
| Boeing 737-800 (winglets) | 737NG common display system, FMC/CDU, MCP, autoland | flyable | [docs/aircraft/b737-800.md](docs/aircraft/b737-800.md) |
| Cessna 172S Skyhawk (steam gauges) | Analog six-pack, KX 155A, KAP 140 | not built yet (greyed out in the menu) | |
| Cessna 172S Skyhawk (G1000 NXi) | Garmin G1000 NXi, GFC 700 | not built yet (greyed out in the menu) | |

An aircraft becomes selectable as soon as its module exists
(`src/aircraft/<id>/index.ts`). If none exists, the menu offers a development
**Test Jet** instead (it is still reachable with `?aircraft=_test-jet`; the
smoke test flies it).

Each jet has a complete, clickable 3D flight deck in which every modelled
switch, knob, lever, button and breaker drives a system, and every
annunciator shows real system state. Each one has been flown headless from
cold & dark to cold & dark through its cockpit controls only (engine start,
FMS route and approach, takeoff, autopilot climb, cruise, VNAV descent, ILS,
landing, shutdown); see "Checks" below. Every number (weights, speeds,
limits, thrust, fuel, electrical, hydraulic and pneumatic values, CAS
messages, AFCS modes) carries its public source in a code comment, and
estimates are marked `// EST:`. The dossier of each aircraft lists its
sources, what is modelled and what is simplified.

## Features

- **Flight model.** 6-DOF physics at 120 Hz, with aerodynamic coefficient
  tables, turbofan and piston engines, gear and ground contact, mass and
  balance, and ISA atmosphere with wind, gusts and turbulence.
- **Cockpits.** Every switch, knob, lever, button and breaker is modelled
  and drives a system. The simulated systems are electrical, fuel,
  hydraulic, bleed and pressurization, ice protection, APU, fire, oxygen,
  lighting, FADEC, autopilot, and warning (CAS/EICAS). Glass displays render
  to canvases.
- **World.** Worldwide terrain streamed from AWS Terrain Tiles, and 72,000
  airports with generated runways, markings and lighting. There is a sky
  with sun, moon and stars at the correct date and time, and weather
  visuals: clouds, visibility, rain and snow.
- **Navigation.** VOR, DME, ILS, NDB and marker receivers, plus airways,
  fixes and FAA CIFP procedures. There is FMS lateral and vertical
  navigation. Magnetic variation comes from WMM2025.
- **Weather.** Five presets: CAVOK, scattered, overcast IFR, thunderstorm
  and winter. There is also a manual editor with winds aloft, and live
  METARs from aviationweather.gov.
- **Start positions.** Any airport, on any runway or on the apron.
  Available states are cold & dark, ready to taxi, on the runway, 10 nm
  final (auto-tuned to the ILS) and cruise.
- **Views.** Pilot eye and cockpit presets with head motion, plus chase,
  orbit, tower and fly-by cameras.
- **Controls.** Keyboard, mouse (drag the cockpit controls, or use the
  mouse-yoke mode), and joysticks, yokes, pedals and throttle quadrants.
  Axis binding has live preview, deadzone, curve, invert and calibration,
  and profiles are saved per device.
- **Sound.** Fully procedural: engines, wind, rolling, touchdowns, gear and
  flap motors, a distinct click for each type of switch, stall horn,
  overspeed clacker, autopilot-disconnect cavalry charge, master
  warning/caution chimes, altitude alert, and spoken callouts.

## Running

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev            # http://localhost:5173
```

The start screen lets you pick the aircraft, airport, position, initial
state, time and weather, then **FLY**. URL parameters skip the menu, for
example
`http://localhost:5173/?aircraft=_test-jet&airport=KTEB&runway=19&state=approach&weather=ifr`
(see `docs/modules/app.md`).

### Desktop app (Electron)

```bash
npm run electron:dev     # Electron window on the dev server (hot reload)
npm run electron:start   # production build in Electron
```

### Windows .exe

```bash
npm run dist:win
```

This produces two files in `release/`:

- `AMG-Flight-Simulator-Setup-<version>-x64.exe`: a per-user installer
  (no admin rights) that creates desktop and Start-menu shortcuts.
- `AMG-Flight-Simulator-<version>-x64-portable.exe`: a single file that
  runs without installing.

Every push to GitHub builds both on `windows-latest`
(`.github/workflows/build-windows.yml`). Download them from the workflow
run's **Artifacts**. The builds are not code-signed, so Windows SmartScreen
may ask for confirmation on first launch.

### Checks

```bash
npm run typecheck   # TypeScript (strict)
npm test            # unit + headless integration tests (vitest), about 4.5 min
npm run test:long   # the six full-flight check rides, cold & dark to cold & dark (about 10 min)
npm run build       # production bundle in dist/
npm run smoke       # headless browser flight, ~40 numeric checks, screenshots in tests/output/
npm run jets-qa     # every jet in every start state in the real app, screenshots in tests/output/jets/
```

The check rides (`tests/aircraft/<id>/verify/fullFlight.test.ts`) fly each
jet through its cockpit controls only: power-up and engine start, FMS route
and approach entry, taxi, takeoff, autopilot climb, cruise, VNAV descent, ILS
capture, landing, rollout and shutdown, asserting CAS, flight-mode
annunciations and published numbers at every phase. They are left out of
`npm test` to keep it short (`AMG_LONG_TESTS=1` includes them); CI runs them
in a separate job.

`docs/modules/qa.md` describes the full release pipeline, every smoke check,
the `window.__sim` scripting API and the scripted test pilot.

## Controls (defaults)

| Keys | Action |
|---|---|
| Arrows or Num 8/2/4/6 | Pitch and roll |
| Q / E | Rudder |
| Num 7 / Num 1 (Home / End) | Pitch trim down / up |
| F1 / F2 / F3 / F4 | Throttle idle / decrease / increase / full (hold F2 at idle for reverse) |
| Ctrl+F1..F4 | Mixture cutoff / leaner / richer / rich |
| F5-F8 or [ ] | Flaps |
| G | Landing gear |
| / and Ctrl+/ | Speedbrake, ground spoilers arm |
| . and Ctrl+. | Brakes, parking brake |
| Z, Shift+Z | Autopilot on/off, AP disconnect |
| T, Shift+T | TO/GA, autothrottle disconnect |
| C / V | Cockpit views / external cameras |
| Shift+arrows, Space, = / - | Look around, reset view, zoom |
| P, R / Shift+R | Pause, sim rate |
| Esc | Pause menu (position, time & weather, failures, fuel & payload, controls, graphics, audio) |
| H, K, `, F11, Y | Help, checklists, debug HUD, full screen, mouse yoke |

Mouse: drag the cockpit controls with the left button. Drag on empty space
to look around, and use the wheel to zoom. Every key can be rebound in
**Controls**.

### What the keys move in each jet

The keys move the aircraft's own cockpit levers (the 3D lever follows), so
the systems see exactly what a hand on the lever would do.

| Aircraft | Flaps (F5-F8, `[` `]`) | Reverse (hold F2 at idle, Shift+F2) | Speedbrake (`/`) | `Z` (AP) | Shift+`T` (A/T disconnect) |
|---|---|---|---|---|---|
| Citation M2 | UP / 15 / 35 (the 60° ground-flap detent only on the cockpit handle) | none (no reversers) | RETRACT / EXTEND | GMC 710 AP key | none (no autothrottle) |
| Citation Longitude | UP / 1 / 2 / FULL | integral reverse range on the thrust levers | 0 / half / full | GMC AP key | A/T disconnect |
| G650 | UP / 10 / 20 / 39 | integral reverse range | 0 / half / full | guidance panel AP | A/T disconnect |
| G800 | UP / 10 / 20 / 39 | piggy-back reverse levers | 0 / half / full | AP engage | A/T disconnect |
| Global 6000 | 0 IN / 0 OUT / 6 / 16 / 30 | piggy-back reverse levers | flight spoiler lever 0 / ½ / 0.8 / full | FCP AP | A/T disconnect |
| 737-800 | UP / 1 / 2 / 5 / 10 / 15 / 25 / 30 / 40 | piggy-back reverse levers | DOWN / flight detent / UP, Ctrl+`/` ARMED | MCP CMD A | A/T disconnect |

Everything else (engine start, fuel, electrical, pressurization, FMS,
radios, lights, autobrake, TO/GA buttons on the levers, and so on) is done in
the cockpit with the mouse: click, drag or scroll the control. Hover over a
control to see its name. `C` cycles each cockpit's preset views (overhead,
pedestal, FMS, side panels), which makes the small legends readable.
`K` opens the aircraft's normal checklists, with live ticks.

## Known limitations

These are the main gaps found by the check rides and the integration QA. Each
aircraft dossier (`docs/aircraft/<id>.md`) has the full list.

**All aircraft**

- Panel geometry, breaker panel contents and some overhead layouts are
  estimates where no public drawings exist (marked `EST` in the code and the
  dossiers).
- Cockpit lighting: surfaces in shadow get little daylight fill, so white
  legends under the glareshield (overhead edges, side and breaker panels) are
  hard to read by day. Use the preset close-up views (`C`). At night the
  backlit legends read well.
- The default pilot view looks 8° down; at 16:9 the bottom row of PFD
  softkeys can sit just below the screen edge until you look down.
- Radio audio (ATC, ident tones through the audio panels), cockpit doors,
  cabin interior lighting, weather radar returns, charts, CVR and ELT hold
  state only; there is no radio or weather model behind them.
- FMS (shared nav library): the VNAV profile uses nominal leg lengths (big
  fly-by turns can step the path), there is no deceleration segment before
  the 250 kt / 10,000 ft limit, distance to destination can include the
  missed approach or leave out a hold-in-lieu-of-procedure-turn leg, and the
  thrust rating is not switched to CRZ automatically at level-off.
- Autothrottle MIN/MAX speed protection is not modelled. Hardware
  bindings that write only an autopilot-disconnect var (without sending the
  `ap.disc` event, as the 3D button does) do not disconnect the autopilot.
- On the ground, the relative-terrain map layers paint the area around the
  airport red or yellow (no suppression near runway elevation).
- Lift-off in the hand-flown check rides comes 10-17 kt above VR because the
  scripted rotation is gentle; stall speeds and field lengths match the
  published data.
- Frame rate: the flight decks draw 600-2,000 draw calls; on a real GPU this
  is fine, under software rendering it is 4-5 fps.

**Per aircraft**

- *Citation M2:* no Gen2 autothrottle; climb fuel is about 25 % above the
  Flight Planning Guide; the autopilot minimum-use heights are documented
  but not enforced.
- *Citation Longitude:* no autothrottle MIN/MAX SPD or 2 nm approach-speed
  reduction; the synoptic page artwork is schematic.
- *G650 / G800:* PERF INIT speed defaults are estimates; the G800 fifth
  touch screen (jump seat), sidestick push-to-talk and force feel, and
  triplex flight-control computer voting are not built.
- *Global 6000:* V-speeds and the flaps 6 lift curve are estimates (no public
  AFM tables); the pedestal EMS CDU duplicates the side-panel functions.
- *737-800:* the autopilot keeps VNAV ALT instead of VNAV PTH when the MCP
  altitude equals the cruise altitude (push VNAV at top of descent); the
  idle descent path is steep; NO AUTOLAND shows 2 s after touchdown; V2 is a
  few knots below 1.13 × the flaps-5 stall speed in the estimated tables.
- *Cessna 172S (both):* not built yet.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Terrain elevation | AWS Terrain Tiles (Mapzen/Tilezen, terrarium encoding), streamed at run time | Attribution: *3DEP, SRTM, GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA; and others* (see the [Tilezen data sources](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)) |
| Airports, runways, frequencies, VOR/DME/NDB | [OurAirports](https://ourairports.com/data/) | Public domain |
| US localizers, glideslopes, fixes, airways, SIDs/STARs/approaches | FAA Coded Instrument Flight Procedures (CIFP) | Public domain (US Government work) |
| Worldwide ILS, markers, fixes, airways | FlightGear `fgdata` Navaids (AIRAC 2013.10) | GPL-2.0 |
| Magnetic variation | NOAA/BGS World Magnetic Model WMM2025 | Public domain |
| Live weather | [aviationweather.gov](https://aviationweather.gov/data/api/) Data API (optional, on request) | US Government work |

The simulator ships no images or sound files. Geometry, textures and audio
are generated procedurally. Nav data is rebuilt with `npm run navdata`.
Aircraft numbers (limits, speeds, weights, thrust, systems values) come from
public sources cited next to each value in the code. Estimated values are
marked `// EST:`. **Not for real-world navigation or training credit.**

## Project structure

```
src/
  core/        SimVars, EventBus, SimLoop, math, geodesy, units, WMM
  physics/     6-DOF flight model, aerodynamics, engines, ground, mass, atmosphere
  world/       terrain tiles and LOD, airports and runways, sky and lighting, weather visuals
  nav/         nav database, radios, flight plans, FMS
  cockpit/     cockpit controls, interaction, geometry, lighting
  avionics/    display framework and avionics families
  systems/     aircraft system building blocks
  aircraft/    one folder per aircraft (index.ts exports an AircraftModule)
  render/      renderer, cameras, cockpit shadows
  input/       keyboard, joysticks, mouse yoke, bindings
  audio/       procedural sound engine and callouts
  ui/          menus, weather, pause menu, overlays
  platform/    HTTP (dev proxy / Electron IPC), storage, environment
  App.ts, main.ts
electron/      Electron main + preload (app:// protocol serves dist/)
scripts/       nav data builder, smoke test
build/         app icon (generated by build/make-icon.mjs)
docs/          ARCHITECTURE.md and per-module API references (docs/modules/*.md)
tests/         unit tests and headless integration tests (tests/integration)
```
