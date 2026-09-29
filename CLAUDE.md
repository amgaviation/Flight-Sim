# AMG Flight Simulator

A high-fidelity desktop flight simulator. Browser app (Vite + TypeScript + Three.js) that also ships as a Windows `.exe` through Electron. Personal/internal use only. See `docs/ARCHITECTURE.md` for the full design.

## Commands

- `npm run dev`: dev server at http://localhost:5173
- `npm run typecheck`: `tsc --noEmit` (TypeScript 7, strict)
- `npm test`: vitest unit tests (`tests/**/*.test.ts`, `src/**/*.test.ts`), without the long flight tests
- `npm run test:long`: the long flight tests: the six full-flight check rides (`tests/aircraft/*/verify/fullFlight.test.ts`) and the six published-performance flights (`tests/aircraft/*/performance.test.ts`). They are excluded unless `AMG_LONG_TESTS=1`, so run a single one with `AMG_LONG_TESTS=1 npx vitest run <path>`
- `npm run jets-qa`: after a build, loads every jet in every initial state in headless Chromium and writes screenshots to `tests/output/jets/`
- `npm run build`: production bundle into `dist/`
- `npm run smoke`: headless Chromium boots the built app, flies a scripted scenario, and writes screenshots to `tests/output/`
- `npm run navdata`: regenerates `public/data/*` from OurAirports and FlightGear sources
- `npm run electron:dev` / `npm run dist:win`: Electron dev run / Windows installer (CI builds the exe on `windows-latest`)

## Hard rules

- **Everything in a cockpit works.** Every modeled switch, knob, button, lever and breaker changes SimVars that some system consumes, and every annunciator reflects real system state. Don't add decorative-only controls. If a real control's function is out of scope, make it change state and show that state, with a `// SCOPE:` comment explaining what's simplified.
- **Accuracy over invention.** Numbers for limits, speeds, weights, thrust, fuel, electrical voltages, hydraulic pressures and display layouts come from public sources (type certificate data sheets, manufacturer spec sheets, FAA handbooks, published AFM/POH excerpts, training manuals). Put the source in a comment next to the number (`// TCDS A1WI: MTOW 10,700 lb`). When a value has to be estimated, mark it `// EST:` and give the reasoning.
- **Shared contracts are append-only**: `src/core/vars.ts`, `src/core/SimContext.ts`, `src/physics/types.ts`, `src/cockpit/types.ts`, `src/world/types.ts`, `src/nav/types.ts`, `src/aircraft/types.ts`. You may add fields or vars. Never rename or remove them, and never change their meaning or sign convention.
- **State crosses module boundaries only through `SimVars`** (continuous state) and `EventBus` (momentary commands). Standard var names are in `src/core/vars.ts`. Aircraft-specific vars use the `ac.` prefix.
- **Avionics read sensor vars** (`adc*`, `ahrs*`, `nav*`, `fms.*`, `ap.*`), never FDM truth (`fdm.*`). That way failures, lag and power loss propagate. Exceptions are GPS position and ground speed.
- **Nothing on the per-step hot path allocates.** Physics runs at 120 Hz and systems at 60 Hz. Reuse vectors and arrays there. Glass displays render to canvases at ≤30 Hz (electromechanical gauges ≤60 Hz).
- **No runtime network dependencies** except terrain tiles (AWS Terrain Tiles, terrarium) and optional live METARs (aviationweather.gov through `src/platform/http.ts`). Geometry, textures and sounds are procedural or bundled.
- **Units**: SI inside physics. SimVars carry aviation units with a suffix (`_kt`, `_ft`, `_fpm`, `_deg`, `_psi`, `_c`, `_pph`, `_kg`).
- **Signs**: pilot-intuitive normalized controls (+pitch = nose up, +roll = right, +yaw = right). Body axes are x forward, y right, z down.

## Layout

- `src/core`: SimVars, EventBus, SimLoop, math, geodesy, units, magnetic variation
- `src/physics`: 6-DOF FDM, aerodynamics, engines (turbofan, piston), ground contact, mass/balance, atmosphere
- `src/world`: terrain tiles and LOD, airports and runways, lighting, sky, weather visuals
- `src/nav`: nav database, radios (VOR/LOC/GS/DME/ADF/markers), flight plan, FMS core, magnetic model
- `src/cockpit`: interaction manager, control primitives, cockpit geometry helpers, lighting
- `src/avionics`: display framework plus avionics families (`garmin-g1000/`, `garmin-g3000/` covering G3000 and G5000, `honeywell-epic/` covering PlaneView II and Symmetry, `collins-fusion/`, `boeing-737/`, `analog/`)
- `src/systems`: reusable aircraft-system building blocks (electrical, fuel, hydraulic, bleed/pressurization, ice protection, FADEC, autopilot core, TAWS/GPWS, CAS/EICAS, lighting)
- `src/aircraft/<id>/`: one folder per aircraft, `index.ts` default-exports an `AircraftModule`
- `src/render`, `src/input`, `src/audio`, `src/ui`, `src/platform`: app shell
- `electron/`: Electron main/preload (CommonJS). The `app://` protocol serves `dist/`
