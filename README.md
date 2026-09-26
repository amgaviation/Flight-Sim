# AMG Flight Simulator

This is a high-fidelity desktop flight simulator with fully interactive 3D
cockpits. It runs in the browser from a Vite dev server, and it also ships as
a Windows `.exe` built with Electron. The source is TypeScript, and
rendering uses three.js.

For personal and internal use by AMG Aviation Group.

## Aircraft

| Aircraft | Avionics | Status |
|---|---|---|
| Cessna Citation M2 | Garmin G3000 | in development |
| Cessna Citation Longitude | Garmin G5000 | in development |
| Gulfstream G650 | Honeywell PlaneView II | in development |
| Gulfstream G800 | Honeywell Symmetry | in development |
| Bombardier Global 6000 | Collins Pro Line Fusion (Global Vision) | in development |
| Boeing 737-800 | 737NG common display system / FMC | in development |
| Cessna 172S Skyhawk (steam gauges) | Analog six-pack, KX 155A, KAP 140 | in development |
| Cessna 172S Skyhawk (G1000 NXi) | Garmin G1000 NXi, GFC 700 | in development |

An aircraft appears in the menu as soon as its module exists
(`src/aircraft/<id>/index.ts`). Until then the menu offers a development
**Test Jet**. It exercises the full pipeline: flight model, systems, a
clickable cockpit, a PFD, sound, and the exterior model.

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
npm test            # unit + headless integration tests (vitest)
npm run build       # production bundle in dist/
npm run smoke       # headless browser flight, ~40 numeric checks, screenshots in tests/output/
```

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
