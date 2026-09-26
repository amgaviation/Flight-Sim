# Physics & core utilities — API reference

Owner: physics module. Source: `src/core/**` (utilities) and `src/physics/**`.
Tests: `tests/core/**`, `tests/physics/**` (`npx vitest run tests/core tests/physics`).

This document is written so aircraft authors can build an `FdmConfig`, drive
the engines and gear from their systems, and wire the flight model into the
app **without reading the source**.

---

## 0. Conventions (read first)

| Topic | Convention |
|---|---|
| Units inside physics | SI (m, s, kg, N, Pa, K, rad). SimVars use aviation units with a suffix (`_kt`, `_ft`, `_fpm`, `_deg`, `_psi`, `_c`, `_f`, `_pph`, `_gph`, `_kg`, `_inhg`). |
| Body axes | x forward, y right, z **down**. Origin = aircraft **datum**, by convention the empty-weight CG with gear down. All `position_m` in configs are metres from the datum in body axes. |
| Attitude | Quaternion rotating **body → local NED**. Euler angles ZYX: heading ψ, pitch θ (+ nose up), bank φ (+ right wing down). |
| Position | Geodetic lat/lon (deg, +N/+E), geometric altitude (m MSL; the sim treats MSL = WGS84 ellipsoid height). Velocity in local NED. Earth rotation ignored. |
| Control signs | Normalized, pilot-intuitive: `surf.elevator` +1 = full nose-up command, `surf.aileron` +1 = roll right, `surf.rudder` +1 = yaw right. Trims use the same signs. |
| Angles | α (AoA) + when the relative wind comes from below; β (sideslip) + when the wind comes from the **right** (nose left of the relative wind). |
| Wind | "direction" is where the wind blows **from** (deg true). Internally wind vectors are the air-mass velocity in NED (where it goes **to**). |
| Hot path | `FlightModel.step` (120 Hz) and everything it calls allocate nothing. Engines precompute their var-name strings. Measured cost: ~14 µs/step in the air, ~37 µs/step on the ground (4 ground substeps), i.e. < 0.5 % of one core at 120 Hz. |

---

## 1. Core utilities (`src/core`)

### 1.1 `SimLoop.ts` — fixed-timestep loop

```ts
import { SimLoop, createRafScheduler, ManualScheduler,
         PHYSICS_HZ, SYSTEMS_HZ, NAV_HZ, PHYSICS_DT, SYSTEMS_DT, NAV_DT,
         MIN_SIM_RATE, MAX_SIM_RATE, SIM_RATE_STEPS } from '@/core/SimLoop';
```

Constants: `PHYSICS_HZ = 120`, `SYSTEMS_HZ = 60`, `NAV_HZ = 20`, `*_DT = 1/Hz`,
`MIN_SIM_RATE = 1`, `MAX_SIM_RATE = 16`, `SIM_RATE_STEPS = [1,2,4,8,16]`.

Frame algorithm (docs/ARCHITECTURE.md):

```
advance(realDt):                        // called once per animation frame
  publish sim.frame_ms = realDt*1000
  realDt clamped to maxFrameTime_s (default 0.25 s)
  input(realDt)
  if !paused: accumulator += realDt * sim.rate
     while accumulator >= 1/120 and steps < maxSubsteps:
        stepOnce()
     if the cap was hit: the remaining accumulator is DROPPED (droppedTime_s += it)
  else: run one stepOnce() per pending 'sim.step' event
  frame({ realDt, simDt, alpha, steps, paused })

stepOnce():  (k = physicsSteps counter)
  if k % 2 == 0: systems(1/60)           // BEFORE the FDM
  physics(1/120)
  if k % 6 == 0: nav(1/20)               // AFTER the FDM
  sim.time_s += 1/120 (published every step)
```

```ts
interface LoopScheduler { now(): number; request(cb: (tMs: number) => void): number; cancel(h: number): void }
function createRafScheduler(): LoopScheduler            // requestAnimationFrame + performance.now()
class ManualScheduler implements LoopScheduler {        // tests / headless
  time: number; tick(ms: number): boolean;               // advances clock, fires pending frame
  readonly hasPending: boolean;
}

interface FrameInfo { realDt: number; simDt: number; alpha: number /* 0..1 accumulator fraction */; steps: number; paused: boolean }
interface SimLoopCallbacks {
  input?(realDt: number): void;     // once per frame
  systems?(dt: number): void;       // 60 Hz (dt = 1/60)
  physics?(dt: number): void;       // 120 Hz (dt = 1/120)
  nav?(dt: number): void;           // 20 Hz (dt = 1/20)
  frame?(info: FrameInfo): void;    // once per frame after stepping (render, displays, audio)
}
interface SimLoopOptions {
  maxSubsteps?: number;      // default 48 physics steps per frame (16x at 40 fps)
  maxFrameTime_s?: number;   // default 0.25
  scheduler?: LoopScheduler; // default createRafScheduler()
  events?: EventBus;         // enables the sim.* events below
}

class SimLoop {
  constructor(vars: SimVars, callbacks: SimLoopCallbacks, options?: SimLoopOptions);
  start(): void; stop(): void; dispose(): void;      // dispose also unsubscribes events
  readonly running: boolean;
  readonly paused: boolean;  setPaused(p: boolean): void;       // sim.paused
  readonly rate: number;     setRate(r: number): void;          // sim.rate, clamped 1..16
  stepRate(dir: 1 | -1): void;                                  // through SIM_RATE_STEPS
  readonly time: number;                                        // simulated seconds
  advance(realDt_s: number): number;   // run one frame manually; returns physics steps
  stepOnce(): void;                    // exactly one physics step (+systems/nav divisors)
  resetAccumulator(): void;            // e.g. after reposition / state load
  physicsSteps: number; systemsSteps: number; navSteps: number; frames: number; droppedTime_s: number;
}
```

SimVars: writes `sim.time_s`, `sim.frame_ms`; reads/writes `sim.paused`, `sim.rate`
(initialised to 0 / 1 if absent).
Events handled (when `events` is passed): `sim.pause_toggle`, `sim.pause_set`
(payload boolean), `sim.rate_inc`, `sim.rate_dec`, `sim.rate_set` (payload number),
`sim.step` (single step while paused).

Pause stops systems, physics and nav; `input` and `frame` keep running so the
cockpit stays interactive.

### 1.2 `math.ts`

```ts
DEG2RAD, RAD2DEG, TWO_PI
clamp(v, lo, hi); clamp01(v); lerp(a, b, t); invLerp(a, b, v); remapClamped(v, inLo, inHi, outLo, outHi)
smoothstep01(t); smoothstep(e0, e1, v); deg(rad); rad(deg); sign(v); approach(cur, target, maxDelta)
wrap360(deg) -> [0,360);  wrap180(deg) -> [-180,180);  wrapPi(rad) -> [-PI,PI);  angleDiffDeg(a, b) -> a-b in [-180,180)
findSegment(xs, x)                 // binary search, clamped segment index
interp1(t: Table1D, x)             // linear, clamped, binary search, no allocation
interp2(t: Table2D, x, y)          // bilinear z[i][j] at (x[i], y[j]), clamped, no allocation
table1(x, y) / table2(x, y, z)     // validating constructors (throw on bad input)
class FirstOrderLag { value; tau; constructor(tau, initial=0); update(input, dt); reset(v) }   // exact exp discretisation
class RateLimiter   { value; riseRate; fallRate; constructor(rise, fall=rise, initial=0); update(input, dt); reset(v) }
class SecondOrderFilter { value; rate; omega; zeta; constructor(omega, zeta=1, initial=0); update(input, dt); reset(v) } // needle dynamics
class Prng { constructor(seed=1); seed(s); nextU32(); next() /*[0,1)*/; range(lo, hi); gaussian() /*N(0,1)*/ }  // sfc32, deterministic
```

### 1.3 `linalg.ts` (double precision, mutating, allocation-free)

```ts
class Vec3 { x; y; z; set; setArray; copy; clone; zero; add; sub; addScaled(v, s); scale; subVectors(a,b);
             addVectors(a,b); dot; crossVectors(a,b) /* alias-safe */; length; lengthSq; normalize }
class Quat { w; x; y; z;            // body -> NED
             set; copy; identity; normalize;
             setFromEuler(psi, theta, phi);  getPsi(); getTheta(); getPhi();   // radians, ZYX
             rotate(v, out) /* body->NED */; rotateInverse(v, out) /* NED->body */;
             integrateBodyRate(wBody, dt) /* exact exponential map + renormalise */;
             toMatrix(m: Mat3) }
class Mat3 { readonly e: Float64Array(9) /* row-major */; identity; set(9 values); copy;
             mulVec(v, out); mulVecTransposed(v, out); determinant(); invertFrom(m): boolean }
```

### 1.4 `units.ts`

Multiply by `A_TO_B`. Exact definitions unless noted.
Length: `FT_TO_M`, `M_TO_FT`, `NM_TO_M` (1852), `M_TO_NM`, `IN_TO_M`, `M_TO_IN`, `SM_TO_M`, `KM_TO_NM`.
Speed: `KT_TO_MS`, `MS_TO_KT`, `FPM_TO_MS`, `MS_TO_FPM`, `KMH_TO_MS`, `FPS_TO_MS`.
Mass/force: `LB_TO_KG`, `KG_TO_LB`, `G0` (9.80665), `LBF_TO_N`, `N_TO_LBF`.
Pressure: `INHG_TO_PA` (3386.389), `PA_TO_INHG`, `PSI_TO_PA`, `PA_TO_PSI`, `HPA_TO_PA`, `PA_TO_HPA`, `INHG_TO_HPA`, `HPA_TO_INHG`.
Power/torque: `HP_TO_W` (745.69987), `W_TO_HP`, `FTLB_TO_NM`.
Volume/fuel: `USGAL_TO_L`, `L_TO_USGAL`, `USGAL_TO_M3`, `AVGAS_LB_PER_GAL` (6.0), `AVGAS_KG_PER_L` (≈0.719),
`JETA_LB_PER_GAL` (6.7), `JETA_KG_PER_L` (≈0.803), `KGS_TO_PPH`, `PPH_TO_KGS`, `AVGAS_GPH_TO_KGS`,
`AVGAS_KGS_TO_GPH`, `JETA_GPH_TO_KGS`.
Angles: `DEG_TO_RAD`, `RAD_TO_DEG`.
Temperature: `ZERO_C_IN_K`, `cToK`, `kToC`, `cToF`, `fToC`, `kToF`, `fToK`, `DELTA_C_TO_F`.

### 1.5 `geo.ts`

```ts
WGS84_A, WGS84_F, WGS84_B, WGS84_E2, WGS84_EP2, EARTH_RADIUS_NM (3440.065), EARTH_RADIUS_M
interface LatLon { lat; lon }  interface LatLonAlt extends LatLon { alt }  interface XYZ { x; y; z }
meridianRadius(latDeg) / primeVerticalRadius(latDeg)          // m
metresPerDegLat(latDeg, h=0) / metresPerDegLon(latDeg, h=0)
geodeticToEcef(lat, lon, h, out?) : XYZ
ecefToGeodetic(x, y, z, out?) : LatLonAlt                      // sub-mm, Bowring + Newton
class EnuFrame { constructor(lat, lon, alt); setReference(lat, lon, alt);
                 ecefToEnu(x,y,z,out?)  enuToEcef(e,n,u,out?)   // out.x=E, out.y=N, out.z=U
                 geodeticToEnu(lat,lon,alt,out?)  enuToGeodetic(e,n,u,out?) }
// Spherical great-circle (R = 3440.065 nm), bearings deg true, distances nm:
centralAngle(lat1, lon1, lat2, lon2) : rad
distanceNm(...); initialBearing(...); finalBearing(...)
destinationPoint(lat, lon, bearingDeg, distNm, out?) : LatLon
crossTrackNm(latA, lonA, latB, lonB, latP, lonP)   // + = P is RIGHT of course A->B (same sign as fms.xtk_nm)
alongTrackNm(latA, lonA, latB, lonB, latP, lonP)   // negative if the foot is behind A
courseIntersection(lat1, lon1, brg1, lat2, lon2, brg2, out?) : boolean   // false if parallel/diverging
intermediatePoint(lat1, lon1, lat2, lon2, f, out?)
offsetNorthEast(lat, lon, north_m, east_m, h=0, out?)          // WGS84 radii, short offsets
```

Validated against the Aviation Formulary worked examples (LAX–JFK distance,
course, cross/along-track, REO/BKE radial intersection at Boise, intermediate point).

### 1.6 `wmm.ts` — World Magnetic Model WMM2025

```ts
WMM_EPOCH (2025.0), WMM_VALID_UNTIL (2030.0)
interface MagneticField { declination; inclination; h; x; y; z; f }   // deg, nT
decimalYear(date: Date): number
magneticField(latDeg, lonDeg, altM, year, out?): MagneticField     // year clamped to 2025-2030
magneticDeclination(latDeg, lonDeg, altM, year): number            // + east ("variation")
magneticInclination(latDeg, lonDeg, altM, year): number            // + down
```

Coefficients are the official NOAA NCEI `WMM2025.COF`; every row of the official
`WMM2025_TestValues.txt` is reproduced to ≤ 0.011° and < 1 nT (test). ~0.5k flops per
call and allocation-free, but cache it (the FDM refreshes every 2 s or 0.02° of movement).

---

## 2. Flight model (`src/physics/FlightModel.ts`)

```ts
import { FlightModel, normalGravity } from '@/physics/FlightModel';
const fdm = new FlightModel(config: FdmConfig, vars: SimVars, world: WorldQuery, options?: FlightModelOptions);
```

`FlightModel` implements `FlightModelHandle` (`src/core/SimContext.ts`), so it can be
passed as `ctx.fdm`.

```ts
interface FlightModelOptions {
  seed?: number;           // gust/turbulence PRNG seed (default 1) – deterministic runs
  magneticYear?: number;   // WMM decimal year (default: current date)
  tatRecovery?: number;    // recovery factor for fdm.tat_c (default 1 = true stagnation temperature)
  groundSubsteps?: number; // substeps per step when near the ground (default 4)
}
interface RepositionOptions { lat: number; lon: number; altFtMsl?: number; onGround?: boolean; headingTrue: number; iasKt?: number }
interface TrimResult { converged: boolean; alphaDeg: number; pitchTrim: number; elevator: number; thrustN: number; tas_ms: number }
```

### 2.1 Methods

| Method | What it does |
|---|---|
| `step(dt)` | One physics step (the SimLoop `physics` callback). Order: env vars → mass/CG → terrain under CG → air data, wind, gusts, turbulence → **engines** → **aerodynamics** → **ground contact** → gravity → integration → crash checks → publish. |
| `reposition(opts)` | Clears a crash, zero rates. `onGround` (or no `altFtMsl`): solves the static equilibrium (altitude, pitch, roll) on the gear springs from `sampleGround`, zero velocity, stiction anchors reset — **no bounce, no creep**. In air: places the **datum** at `altFtMsl`, trims α via `computeTrim` (falls back to wing-lift balance), wings level, velocity = TAS along heading + wind. `iasKt` default = 1.4 × 1-g stall speed for the current flaps. Does **not** change engine state or any `surf.*` var. |
| `setFrozen(b)` | Slew/position freeze: no motion; engines, air data and all vars keep updating; publishes `fdm.frozen`. |
| `slew(dNorth_m, dEast_m, dUp_m, dHeadingDeg=0)` | Moves the aircraft (use while frozen for slew mode). Velocity direction rotates with heading. |
| `setStationMass(i, kg)` | Payload station mass, clamped to `[0, maxMass_kg]`. |
| `setEnginesRunning(b)` | All engines instantly to a stabilized running state at the **currently commanded** power (`n1_cmd_pct`, or throttle/mixture/mags for pistons), or shut down cold. The engine input vars (fuel_on, mags, …) must already be set, otherwise the engine flames out on the next step. Intended for `applyState()` presets. |
| `computeTrim({ iasKt? , tas_ms?, elevator? = 0 })` | Level, wings-level trim at the current altitude, mass, CG, flaps, gear, spoilers: solves α, `surf.pitch_trim` and total thrust (N, split evenly along the engines' axes, thrust-line moment included). Pure: does not change state or vars. Use `Turbofan.n1ForThrust()` to turn the thrust into an N1 command. |
| `getDatumPosition(out)` | Datum lat/lon/alt (what `fdm.lat_deg/lon_deg/alt_msl_ft` report). |

### 2.2 Public state (read-only by convention)

`lat`, `lon` (deg, **CG**), `alt` (m MSL, **CG**), `q: Quat` (body→NED), `vNed: Vec3` (m/s),
`omega: Vec3` (body rad/s), `crashed`, `crashReason`, `frozen`, `groundElevation` (m),
`windNed` (steady + gust, NED m/s), `specificForce` (body m/s²), `tas`, `cas` (m/s), `mach`,
`qbar` (Pa), `alpha`, `beta`, `alphaDot` (rad, rad/s), `mass`, `cg: Vec3`,
`headingTrueDeg`, `pitchDeg`, `bankDeg`, and the sub-models: `atmosphere: Atmosphere`,
`wind: WindModel`, `turbulence: DrydenTurbulence`, `aero: Aerodynamics`,
`engines: EngineModel[]` (cast to `Turbofan`/`Piston`), `ground: GroundContact`,
`massModel: MassModel`, `engineEnv: EngineEnv`, `air: AirState`.

The renderer should place the aircraft model at the **datum** (`fdm.lat_deg/lon_deg/alt_msl_ft`
vars or `getDatumPosition`) with attitude from `q` (or `fdm.hdg_true_deg/pitch_deg/bank_deg`).

### 2.3 SimVars read by the FDM

| Var | Use |
|---|---|
| `surf.elevator, aileron, rudder, pitch_trim, aileron_trim, rudder_trim` | −1..1 normalized commands (clamped). |
| `surf.flaps_deg` | Flap angle for all flap-indexed tables. |
| `surf.slats` | 0..1. |
| `surf.spoiler_left/right` (roll/flight spoilers), `surf.speedbrake`, `surf.ground_spoilers` | 0..1. Symmetric deployment for CL/Cm = `clamp(speedbrake + (L+R)/2)`. **Don't double count**: if your speedbrake *is* the flight spoilers, write it into `spoiler_left/right` and leave `speedbrake` 0 (or vice versa). |
| `gear.pos{i}` | Retractable gear only; default **1** if never written. Contact only when ≥ 0.98. Mean extension drives `CD_gear`/`Cm_gear`. Fixed gear ignores it. |
| `gear.brake_left/right` | 0..1 actual brake (after anti-skid / parking brake logic). |
| `gear.steer_deg` | Actual nosewheel angle (+ right), clamped to `maxSteer_deg`. |
| `fuel.tank{i}_kg` | Tank masses (default 0 if never written — the fuel system must initialise them). |
| `ice.airframe`, `ice.inlet{i}` | 0..1. |
| `eng{i}.*` inputs | See §4. |
| `env.qnh_inhg` (default 29.92126), `env.sl_temp_c` (15), `env.qnh_ref_elev_ft` (0), `env.turbulence` (0), `env.precip` (wet runway), `env.wind_dir_deg`, `env.wind_kt`, `env.wind_gust_kt` | Environment (surface wind at 10 m appended by physics; `env.qnh_ref_elev_ft` = elevation of the station that reported QNH/temperature, appended by the review pass). |

### 2.4 SimVars written by the FDM (every step)

`fdm.lat_deg, lon_deg, alt_msl_ft` (datum), `fdm.alt_agl_ft` (CG above terrain),
`fdm.radio_alt_ft` (datum + `radioAltOffset_m` along body z, above terrain; ≈0 when parked),
`fdm.pitch_deg, bank_deg, hdg_true_deg, hdg_mag_deg, mag_var_deg (+E, WMM2025), trk_true_deg, trk_mag_deg`,
`fdm.ias_kt` (= CAS, no position/instrument error — the ADC adds those), `fdm.cas_kt, tas_kt, gs_kt, mach, eas_kt`,
`fdm.vs_fpm` (inertial), `fdm.aoa_deg, beta_deg`,
`fdm.nz_g` (+1 in level flight/parked), `fdm.ny_g` (body-y specific force / g, + right; the slip **ball** moves opposite: ball = −ny), `fdm.nx_g`,
`fdm.p_dps, q_dps, r_dps, turn_rate_dps` (Euler heading rate),
`fdm.on_ground` (any landing gear loaded), `fdm.crashed`, string `fdm.crash_reason`,
`fdm.mass_kg, cg_pct_mac`,
`fdm.stall_warning` (0..1, see §3.3), `fdm.aoa_norm` (α/α_stall_eff), `fdm.alpha_stall_deg`, `fdm.buffet` (0..1),
`fdm.press_alt_ft, density_alt_ft, sat_c, tat_c, static_press_inhg, static_press_pa, density_kgm3, qbar_pa`,
`fdm.wind_dir_deg` (from, true), `fdm.wind_kt` (steady + gust, no turbulence), `fdm.ground_elev_ft`, `fdm.frozen`.
Plus `gear.wow{i}`, `gear.compression{i}` (0..1 of travel), `gear.wheel_speed{i}_kt` per gear index,
and every engine output var (§4).

### 2.5 Integration details

Semi-implicit (symplectic) Euler, quaternion exponential map + renormalisation, local
NED position converted to lat/lon with WGS84 meridian and prime-vertical radii, WGS84
normal gravity (Somigliana + free-air, `normalGravity(latDeg, h)` exported). Rotational
dynamics include rotor gyroscopic terms: `I ω̇ = M − ω × (Iω + H_rotors)`. When the CG
is within reach of the ground, each step is split into `groundSubsteps` substeps in
which ground reactions and gravity are re-evaluated (aero/engine forces held).
When the CG shifts (fuel burn, payload) the **datum** stays fixed in space.
If the terrain under a loaded gear jumps by > 0.25 m in one step (tile refinement),
the aircraft is carried with the terrain.

### 2.6 Crash detection → `fdm.crashed = 1`, `fdm.crash_reason`

| Rule | Reason string |
|---|---|
| Gear touchdown normal speed > `limits.maxSinkRateOnGround_fpm` | `Hard landing: N fpm` |
| Structure contact first-impact speed > 2 m/s | `Structure impact: <contact name>` |
| Structure contact for > 1.5 s while moving > 2.5 m/s (belly/tail scrape) | `Structure ground contact: <name>` |
| Any contact on a `water` surface | `Contact with water` |
| CG below terrain | `Terrain impact` |
| Airborne, filtered nz beyond 1.5 × `maxLoadFactor` / `minLoadFactor` | `Structural failure: load factor X g` |
| Airborne, CAS > 1.25 × `vmo_kt`, or Mach > `mmo` + 0.1 (only if `mmo` ≥ 0.4) | `Structural failure: overspeed` |

After a crash the aircraft stops moving (engines and vars keep updating) until `reposition()`.
A brief tail strike (< 1.5 s, < 2 m/s) is survivable. Model tail skids that are *meant*
to touch as a non-structure contact (`gearIndex: -1`, `isStructure` false).

---

## 3. Atmosphere and aerodynamics

### 3.1 `atmosphere.ts`

Constants: `R_STAR, M0, G0, R_AIR (287.053), GAMMA, P0, T0, RHO0, A0, R0_GEOPOTENTIAL`.

Pure ISA 1976 (geopotential metres):
`geometricToGeopotential(h)`, `geopotentialToGeometric(H)`, `isaTemperature(H)`, `isaPressure(H)`,
`isaDensity(H)`, `speedOfSound(T)`, `pressureAltitude(p)` (inverse), `densityAltitude(rho)`.
Seven layers to 84.852 km; spot values match USSA-1976 Table 1 to 1e-4.

Airspeed (SI; subsonic isentropic, Rayleigh pitot above M1):
`impactPressureRatio(M)`, `machFromImpactPressureRatio(qc/p)`, `impactPressureFromMach(M, p)`,
`machFromImpactPressure(qc, p)`, `impactPressureFromCas(cas)`, `casFromImpactPressure(qc)`,
`casFromMach(M, p)`, `machFromCas(cas, p)`, `tasFromCas(cas, p, T)`, `casFromTas(tas, p, T)`,
`easFromTas(tas, rho)`, `totalTemperature(T, M, recovery = 1)`.
E.g. M0.80 at FL350 = 271.9 KCAS; 250 KCAS at 10,000 ft ≈ 288 KTAS.

```ts
interface AirState { altitude_m; pressure_Pa; temperature_K; density_kgm3; speedOfSound_ms;
                     pressureAltitude_m /* geopotential, 29.92 */; densityAltitude_m; delta; theta; sigma; isaDeviation_K }
createAirState(): AirState
class Atmosphere {
  qnh_Pa; deltaT_K; refElevation_m;
  constructor(qnhInHg = 29.92126, seaLevelTempC = 15, refElevFt = 0);
  setConditions(qnhInHg, seaLevelTempC, refElevFt = 0): void   // cheap when unchanged
  sample(alt_m /* geometric MSL */, out: AirState): AirState   // allocation-free
  pressureAltitudeAt(zGeopotential): number
  geopotentialFromPressureAltitude(hp): number
  trueAltitudeForIndicated(indicatedFt, baroInHg): number       // geometric m
}
```
Non-standard day: constant ISA deviation at every pressure level such that the
(virtual) MSL temperature equals `env.sl_temp_c` (so the station temperature is
`env.sl_temp_c` − 1.98 °C/1000 ft × station elevation). QNH is treated as an
altimeter setting reported at `refElevFt` (`env.qnh_ref_elev_ft`): at that
elevation the pressure altitude is Hp(QNH) + elevation, i.e. an altimeter set to
QNH reads the station elevation on the ground on any day. True altitude away from
the station follows the hydrostatic integral from that anchor (warm day → true
altitude above indicated, ≈ +4 % per 10 °C of height above the station). With
`refElevFt = 0` (default) MSL pressure = QNH.

Wind:
```ts
interface WindLayer { altitudeFt /* MSL */; directionDeg /* from, true */; speedKt }
class WindModel {
  boundaryLayer_m = 600;                 // EST
  gustValue: number;                     // current gust (m/s)
  setSurfaceWind(dirDeg, speedKt, gustKt = 0)   // the FDM calls this every step from env.wind_* vars
  setWindsAloft(layers: WindLayer[])            // weather module calls fdm.wind.setWindsAloft(...); [] clears
  readonly windsAloftCount: number
  steadyWind(altMsl_m, agl_m, latDeg, out: Vec3 /* NED air velocity */): Vec3
  applyGust(dt, agl_m, wind: Vec3): void        // adds the current gust in place
  reset(seed?)
}
windFromVector(n, e, out: { dir; kt })          // NED air velocity -> from-direction/kt
```
Profile: log law (z0 = 0.03 m) below 10 m; from the 10 m wind to the gradient wind at
the top of the boundary layer by log-height interpolation of the vector (shear **and**
veer); winds-aloft layers above (linear in u/v, clamped). Without aloft layers the
gradient wind is 1.5 × surface, veered 20° (backed in the southern hemisphere) (EST).
Gusts: deterministic 1-cosine events 2–6 s long, 60–100 % of the gust increment,
1–8 s apart, along the mean wind; 30 % strength above the boundary layer.

Turbulence:
```ts
interface TurbulenceSample { u; v; w /* body m/s */; p; q; r /* rad/s */ }
createTurbulenceSample()
highAltitudeSigmaFps(altFt, t /* 0..1 */)
class DrydenTurbulence { sigmaU; sigmaW; constructor(seed); reset(seed?);
  step(dt, V_ms, agl_m, intensity /* env.turbulence */, span_m, out): TurbulenceSample }
```
MIL-F-8785C Dryden: low-altitude scale lengths/intensities (< 1000 ft), linear blend to
1000–2000 ft, Figure 7 probability-of-exceedance intensities above 2000 ft. `env.turbulence`
1/3 = light (W20 15 kt, 1e-2 curve), 2/3 = moderate (30 kt, 1e-3), 1 = severe (45 kt, 1e-5).
Includes rotational p/q/r gusts. RMS verified within 15 % of the spec values.

### 3.2 `Aerodynamics.ts`

```ts
interface AeroInputs { alpha; beta; alphaDot /* rad, rad/s */; p; q; r /* air-relative body rates */;
  tas; qbar; mach; heightAgl /* ref point above ground, m */;
  elevator; aileron; rudder; pitchTrim; aileronTrim; rudderTrim; flapsDeg; slats;
  spoilerLeft; spoilerRight; speedbrake; groundSpoilers; gearExtension; ice; propwashDq /* Pa */ }
createAeroInputs()
ICE_CLMAX_LOSS (0.30), ICE_ALPHA_STALL_LOSS (0.25), ICE_CD0_RISE (0.80)
class Aerodynamics {
  constructor(cfg: AeroConfig);
  readonly force: Vec3;  readonly moment: Vec3;    // body N, N·m about the CG
  CL; CD; CY; Cl; Cm; Cn; alphaStallEff; aoaNorm; stallWarning; buffet; stallDepth;
  readonly liftSlopePerDeg; retractableGear: boolean;
  compute(inp: AeroInputs, cg: Vec3): void
  effectiveStallAlpha(flapsDeg, slats, ice): number          // deg
  wingLift(alphaDeg, flapsDeg, slats, ice, mach): number      // basic wing CL (no GE/control/rate terms)
  alphaForLift(targetCL, flapsDeg, slats, ice, mach): number  // deg, bisection below stall
}
```

Build-up (angles in the tables are **degrees**; derivatives with respect to normalized
commands are **per unit command**; rate derivatives per radian of the nondimensional rate):

```
α_t   = (alphaStall_deg(flaps) + slats·CL_slats/CLα) · (1 − 0.25·ice)       // effective stall AoA
α'    = α remapped so the table's break at alphaStall(flaps) lands on α_t (identity below 0.5·α_t;
        post-stall offset fades out over 30°)
CL_w  = CL(α', flaps) · CL_mach(M) · GE_lift(h/b) · (1 − ice·(0.03 + 0.27·ramp)) + CL_slats·slats·ramp
CL    = CL_w + CL_de·δe·(q_tail/q) + CL_q·q̂ + CL_alphadot·α̇̂ + CL_spoiler·sym + CL_groundSpoiler·gs
CD    = CD0(flaps)(1 + 0.8·ice) + CDi_k(flaps)·CL_w²·GE_drag(h/b) + CD_mach(M) + CD_gear·gear
        + CD_spoiler·(spL+spR)/2 + CD_speedbrake·sb + CD_groundSpoiler·gs + CD_beta·β² + CD_alpha(α)
        (if CD_alpha is omitted: 1.25·sin²α blended in above the stall)
CY    = CY_beta·β + CY_dr·δr·(q_tail/q)
Cl    = Cl_beta·β + Cl_p·(1 − 1.4·stallDepth)·p̂ + Cl_r·r̂ + Cl_da·δa + Cl_dr·δr + Cl_spoiler·(spR − spL) + Cl_trim·δa_trim
Cm    = Cm0 + Cm_alpha(α') + Cm_q·q̂ + Cm_alphadot·α̇̂ + Cm_de·δe·(q_tail/q) + Cm_trim·trim + Cm_flap(flaps)
        + Cm_gear·gear + Cm_spoiler·sym + Cm_mach(M)
Cn    = Cn_beta·β + Cn_p·p̂ + Cn_r·r̂ + Cn_da·δa + Cn_dr·δr·(q_tail/q) + Cn_trim·δr_trim
p̂ = p·b/2V, q̂ = q·c/2V, r̂ = r·b/2V, α̇̂ = α̇·c/2V;  q_tail = q + propwashElevatorGain·Δq_propwash
sym = clamp(speedbrake + (spL+spR)/2);   h = height of refPoint above ground
```
Lift acts perpendicular to the relative wind in the symmetry plane, drag opposite the
relative wind, side force on body y. Moments are taken about `refPoint_m` and
transferred to the CG (so CG movement changes stability automatically).
Elevator/rudder terms use `q_tail` dimensionally, so they work at zero airspeed in the
propeller slipstream.

### 3.3 Stall warning, AoA and buffet outputs

* `stallWarning = clamp((α − 0.5·α_t)/(0.5·α_t), 0, 1)` — 0 at half the stall AoA, 1 at
  the stall. The **aircraft** decides thresholds (e.g. a 172 stall horn ≈ 0.25–0.35, a
  stick shaker ≈ 0.75–0.85, or use `fdm.aoa_norm` directly for AoA indexers).
* `aoaNorm = α/α_t` → `fdm.aoa_norm`; `α_t` → `fdm.alpha_stall_deg`.
* `buffet` = max(stall buffet from 0.88·α_t to α_t+2°, Mach buffet around
  `buffetMach − 0.15·max(0, CL−0.5)`) + speedbrake/spoiler buffet (≤0.25 × q/15 kPa)
  + gear buffet (retractable gear, ≤0.12 × q/8 kPa), clamped 0..1.
* In the stall roll damping degrades and reverses (`Cl_p·(1−1.4·stallDepth)`) → wing drop.

### 3.4 Authoring an `AeroConfig` — sign conventions and tips

* `CL` must cover −180..180° (post-stall matters for spins/upsets). Put a table
  breakpoint **at** each `alphaStall_deg(flaps)` so the peak coincides with the stall.
* With pilot-sign commands, physically: `CL_de` < 0 (nose-up elevator = TE up reduces
  tail lift), `Cm_de` > 0, `Cl_da` > 0, `Cn_da` < 0 (adverse yaw), `Cn_dr` > 0,
  `CY_dr` < 0, `Cl_dr` < 0 (small), `Cl_beta` < 0, `Cn_beta` > 0, `CY_beta` < 0,
  `Cl_p`, `Cm_q`, `Cn_r` < 0.
* `Cm_alpha` is about `refPoint_m`; its slope sets the static margin relative to the
  ref point. Pick `Cm0`/`Cm_trim` so `computeTrim()` gives |pitchTrim| < ~0.5 across the
  envelope (see the test configs for how).
* Fixed gear: either include the gear in `CD0` and set `CD_gear = 0`, or use `CD_gear`
  (fixed gear always counts as extended).
* There is no `Cl0`/`Cn0`. Factory rigging (fixed rudder/aileron tabs that cancel
  propeller torque/slipstream in cruise) belongs in the aircraft FCS as constant
  offsets on `surf.rudder_trim` / `surf.aileron_trim`.

---

## 4. Engines (`src/physics/engines/`)

```ts
interface EngineEnv { pressure_Pa; temperature_K; density_kgm3; speedOfSound_ms; pressureAltitude_ft;
  isaDeviation_K; mach; tas_ms; axialSpeed_ms; qbar_Pa; alpha_rad; beta_rad; onGround }
createEngineEnv(): EngineEnv   // SL ISA static
interface EngineModel {
  readonly index /* 1-based */; readonly kind: 'turbofan' | 'piston';
  readonly position: Vec3; readonly axis: Vec3; readonly thrust_N /* along axis, − = reverse/drag */;
  readonly extraMoment: Vec3 /* torque reaction, P-factor, slipstream yaw */; readonly angularMomentum: Vec3;
  readonly propwashDq_Pa; readonly running: boolean; readonly fuelFlow_kgs;
  step(dt, env): void;  setRunning(running, env): void;
}
```
Engines are created by the FDM (`fdm.engines[i]`, index i+1 = `eng{i+1}.*`). Thrust is
applied at `position_m` along `thrustAxis`, so asymmetric thrust and thrust-line pitch
moments are automatic.

**Fuel is not deducted by the FDM.** The aircraft fuel system reads `eng{i}.ff_pph`
(or `ff_gph`) and decrements `fuel.tank{i}_kg`, and drives `eng{i}.fuel_on` to 0 when
the engine's feed is empty or shut off.

### 4.1 `Turbofan` (`TurbofanConfig`)

Inputs: `eng{i}.n1_cmd_pct` (FADEC N1 demand; below idle → idle), `eng{i}.fuel_on`,
`eng{i}.starter`, `eng{i}.ignition`, `eng{i}.bleed_extract` (0..1), `eng{i}.reverser_pos`
(0..1), `eng{i}.anti_ice` (0/1), `ice.inlet{i}`.
Outputs: `eng{i}.running`, `n1_pct`, `n2_pct`, `itt_c`, `ff_pph`, `oil_press_psi`,
`oil_temp_c`, `thrust_n`, `vib_n1`, `vib_n2`, `accessory_drive` (= N2/100), `bleed_press_psi`.

Model:
* **Spools**: N2 first-order toward `n2FromN1(n1_cmd)` with τ = `spoolUpTau_s(N2)` or
  `spoolDownTau_s(N2)`; N1 = `n1FromN2(N2)` with a 0.5 s fan lag. Mapping: above idle
  `N1 = n1Idle + (n1Max−n1Idle)·f^1.3`, f = (N2−n2Idle)/(n2Max−n2Idle); below idle
  `N1 = n1Idle·(N2/n2Idle)^2.2`. Commanded N2 is clamped to [n2Idle, 1.03·n2Max].
* **Start**: starter spools N2 → `starterMaxN2_pct` (τ 4 s). Light-off when `fuel_on &&
  ignition && N2 ≥ 0.5·lightOffN2`. After light-off N2 follows an S-curve to idle in
  `startToIdle_s` (× up to 1.3 hot, × up to 1.5 high, × 1.5 windmill-assisted air start);
  ITT peaks at `ittStartPeak_c` ~30 % into the start and settles to `ittIdle_c`.
  `running` becomes 1 at ≥ 98 % idle N2. The **FADEC/start logic (systems) must** open
  fuel at ≥ `lightOffN2_pct` and release the starter/ignition at cut-out (typically
  45–50 % N2); the engine self-sustains above 0.75·n2Idle.
* **Hot start**: light-off below `lightOffN2` (fuel+ignition early) and/or fuel that
  flowed without ignition (`unlit fuel`) raise the ITT peak up to
  `ittStartLimit_c + 100` and beyond (`hotStartSeverity` 0..2).
* **Hung start**: starter released below self-sustaining N2 → N2 stagnates, ITT climbs
  +150 °C over 20 s (`hungTime_s`).
* **Flameout/shutdown**: `fuel_on = 0` → immediate flameout, spool-down (τ ≈ 6× spool-down
  table), ITT cools (τ 25 s).
* **Windmill**: unlit N1/N2 → `windmillN1PerKt/N2PerKt × KTAS`, with fan ram drag
  `0.25·q·A_fan` (A_fan = maxThrust/70 kN/m²). Air start when windmill N2 ≥ light-off
  with fuel + ignition.
* **Thrust**: `maxThrust · thrustVsN1(N1c/n1Max) · thrustLapse(M, Hp_ft) · (1 − 0.25·inletIce)`,
  N1c = N1/√(T/T_ISA(Hp)) (hot day → less thrust). Reverser: `T·(1−r) − T·r·reverseEfficiency`.
  Let `thrustVsN1` extend past 1.0 (e.g. to 1.05) if the FADEC may exceed `n1Max_pct` on hot days.
* **Fuel flow**: `tsfc(N1/n1Max)·(1+0.6M)·√θ·T_gross`, floor `idleFuelFlow_pph·(0.35+0.65δ)`;
  during start ramps 40→100 % of idle flow; unlit with fuel on and N2 > 5 %: 30 % idle flow.
* **ITT** (running): idle→max schedule on N1 corrected to inlet total temperature, × the
  inlet temperature ratio, +30 °C × bleed, +20 °C anti-ice, +40 °C × inlet ice; τ 2.5 s.
* **Oil**: pressure ∝ (N2/idle)² below idle, linear idle→max above, +30 % when cold;
  temperature warms to ≈ `oilTempNormal_c` (τ 150 s), cools τ 1200 s.
* **Bleed pressure**: `bleedPressMax·f^1.5·(0.35+0.65δ)`, f = (N2−0.4·idle)/(max−0.4·idle).
* **Vibration**: 0.3–0.7 units normally, +3 (N1) / +1 (N2) at full inlet ice.

Helpers: `n1FromN2(n2)`, `n2FromN1(n1)`, `grossThrust(n1, env, inletIce=0)`,
`n1ForThrust(thrustN, env, inletIce=0)`, `runningItt(n1, env, bleed, antiIce, inletIce)`.
State fields: `n1, n2, itt_c, oilTemp_c, oilPress_psi, thrust_N, fuelFlow_kgs, lit,
startComplete, hotStartSeverity, hungTime_s`.
Optional config (`TurbofanConfig` extras): `starterTau_s` (4), `selfSustainN2_pct`
(0.75·n2Idle), `ittStartLimit_c` (ittStartPeak+150), `n1MapExponent` (1.3).

### 4.2 `Piston` (`PistonConfig`) — fixed-pitch propeller

Constructor: `new Piston(cfg, index, vars, wingArea_m2, span_m)` (the FDM does this).
Inputs: `eng{i}.throttle` (0..1 butterfly), `eng{i}.mixture` (0..1, 0 = idle cut-off),
`eng{i}.mag_left`, `eng{i}.mag_right`, `eng{i}.primer` (0..1 primer delivery rate),
`eng{i}.alt_air`, `eng{i}.starter`, `eng{i}.fuel_on` (**= fuel pressure at the
servo/carburettor**: selector/valve open AND (engine-driven pump turning OR aux/boost
pump on) AND tank not empty).
Outputs: `eng{i}.running`, `rpm`, `map_inhg`, `egt_f`, `cht_f`, `ff_gph`, `ff_pph`
(transducer flow: metered + priming flow), `oil_press_psi`, `oil_temp_f`, `oil_temp_c`,
`thrust_n`, `accessory_drive` (= rpm/ratedRpm, for alternators), `vacuum_inhg`
(pump suction 5.0·(1−e^(−rpm/400)): 4.6 at 1000 rpm, 5.0 at cruise; the vacuum
**system** applies failures/regulation), `rough` (0..1), `power_hp` (brake hp).

Model: see the file header. Key behaviours:
* **Manifold pressure** from throttle area and rpm (impedance model, full throttle =
  98 % of ram pressure), 50 ms lag. `alt_air` loses ram recovery and ~1 inHg.
* **Mixture**: full-rich FAR = `1.12·FAR_bestPower/√σ` — the engine gets richer with
  altitude and must be leaned (POH: lean above 3000 ft). FAR_bestPower = 1.15 ×
  stoichiometric; best power ≈ 100 °F rich of peak EGT; peak EGT ≈ 6 % less power.
* **Priming/flooding**: `primer` (and, for `induction: 'injected'`, `fuel_on` + open
  mixture while the engine turns < 150 rpm) builds an intake fuel film (`wet`, 1 = ideal
  prime ≈ 4 s). Cranking with mixture ICO fires on the prime; the pilot must advance the
  mixture within ~5 s or it quits. > ~2.5 primes floods it (too rich to fire) until
  cranked with throttle open.
* **Ignition**: both mags 100 %, left only 93.5 %, right only 92.5 % combustion
  efficiency (run-up drop ≈ 55–70 rpm at 1800 rpm); both off → dies. Starter:
  `starterTorque_Nm` at 0 rpm falling linearly to 0 at 350 rpm (DC-motor line).
* **Propeller**: `T = CT(J)ρn²D⁴`, `Q = CP(J)ρn²D⁵/2π`; beyond the table's J (stopped or
  windmilling prop) coefficients at J_max scale with V²; negative CP windmills a dead
  engine. Torque reaction (roll), P-factor (`pFactorCoeff`), spiral slipstream yaw
  (`slipstreamYawCoeff`) and prop gyroscopic moments are applied; slipstream Δq = T/A_disk
  feeds `propwashElevatorGain`.
* **Calibration at construction**: volumetric efficiency from `ratedFuelFlow_gph` (at
  best power), indicated work from `ratedPower_hp` at `ratedRpm`, and the throttle idle
  gap so the engine idles at `idleRpm` (SL ISA, static, full rich, warm).
* Temperatures: EGT τ 6 s (POH: "several seconds"), CHT τ 90 s, oil τ 240 s; oil pressure
  ∝ (rpm/2000)^0.8, +40 % cold, ≤ 115 psi.

State/helpers: `omega, rpm, map_Pa, egt_K, cht_K, oilTemp_K, wet, firing, roughness, phi,
brakePower_W, indicatedPower_W, shaftTorque_Nm, propTorque_Nm, fuelFlowGph, egtF, ve,
specificWork, farBestPower, idleArea`, `frictionTorque(rpm)`, `pumpingTorque(map, pExh)`,
`throttleArea(t)`, `manifoldPressure(pRam, area, rpm)`, `airFlow(map, T, rpm, pExh)`,
`fullRichFar(sigma)`, `propeller(rpm, v, rho, out)`.
Optional config (`PistonConfig` extras): `induction` ('injected'), `propRotation` (1 =
clockwise from the cockpit), `pFactorCoeff` (0.35), `slipstreamYawCoeff` (0.004),
`fullRichFactor` (1.12).

---

## 5. Ground contact (`GroundContact.ts`) and mass (`MassModel.ts`)

### 5.1 Gear/structure contacts (`GearContactConfig`)

* `position_m` = contact point with the strut **fully extended**. Choose
  `springK_Npm` so the static deflection at the static load is ~40–60 % of `travel_m`;
  `dampingC_Nspm` ≈ 2·ζ·√(k·m_share), ζ 0.3–0.6. Past `travel_m` a 10× bump stop acts.
* `radioAltOffset_m` = height of the main-gear bottom **at static deflection** below the
  datum (so `fdm.radio_alt_ft` ≈ 0 when parked).
* Friction: `staticFriction`/`dynamicFriction` are tyre peak/slide μ on dry pavement
  (0.8/0.6 typical); `rollingFriction` 0.015–0.02 on pavement; `brakeCoeff` = μ demanded
  at full brake (0.5–0.6). Braking beyond the available grip locks the wheel (slide,
  wheel speed → 0, useful for anti-skid logic).
* Cornering: `N·μ_peak·sin(1.6·atan(10·slip))`, friction circle with braking.
* `steerable` + `maxSteer_deg`: wheel follows `gear.steer_deg`. `castering && !steerable`:
  free swivel (no side force). `castering && steerable` (Cessna spring link): side force
  limited to 25 % of the wheel load.
* Below 0.3 m/s: stiction anchor (critically damped spring to a ground point) limited to
  rolling resistance (unbraked), brake force (braked) and lateral grip — parked aircraft
  do not creep; parking brake holds idle/run-up thrust; unbraked aircraft roll when
  thrust exceeds rolling resistance or on a slope steeper than it.
* `retractable` gear contacts only when `gear.pos{i}` ≥ 0.98.
* `isStructure` contacts (tail, wingtips, belly, nacelles): stiff springs along the
  terrain normal with sliding friction; they trigger the crash rules (§2.6).
* Surfaces (`GroundSample.surface`) multiply friction / rolling resistance:
  asphalt/concrete/unknown 1.0/1.0, grass 0.55/4, dirt 0.65/3, gravel 0.6/3.5, snow 0.3/5,
  water 0.08/20 (EST). `env.precip` reduces paved friction up to 45 % (wet runway).

`SURFACE_PROPERTIES`, class `ContactState` (per contact: `compression, normalForce,
inContact, touchdownSpeed, contactTime, skidding, wheelSpeed, surface`), class
`GroundContact` (`contacts`, `forceBody`, `momentBody`, `onGround`, `maxTouchdownSpeed`,
`structureImpactSpeed`, `structureContactTime`, `structureContactName`, `touchingWater`,
`maxReach`, `wetness`, `sampleTerrain()`, `clearTerrain()`, `compute(dPos, q, vNed, wBody,
cg, dt)`, `publish()`, `reset()`, `isActive(i)`). Writes `gear.wow{i}`,
`gear.compression{i}` (max over contacts sharing the index), `gear.wheel_speed{i}_kt`.
Terrain is sampled with `WorldQuery.sampleGround` once per contact per step, only while
the CG is within `maxReach + 10 m` of the ground; the returned object is copied
immediately (implementations may reuse it).

### 5.2 `MassModel`

```ts
class MassModel {
  constructor(cfg: MassConfig, vars: SimVars | null);
  mass; fuelMass; readonly cg: Vec3; readonly inertia: Mat3; readonly inertiaInv: Mat3;
  readonly tankMass: Float64Array; readonly stationMass: Float64Array;
  update(): boolean                 // reads fuel.tank{i}_kg (clamped to capacity); recomputes when changed
  setStationMass(i, kg); setTankMass(i, kg) /* when vars is null */; cgPercentMac(mac_m): number
}
```
Empty inertia (`Ixx, Iyy, Izz, Ixz` about the empty CG) + point masses, parallel-axis
transfer to the current CG. Tensor `[[Ixx,0,−Ixz],[0,Iyy,0],[−Ixz,0,Izz]]` with
`Ixz = ∫xz dm`. `%MAC = (macLeadingEdge_m − cg.x)/mac·100`. Stations start at
`defaultMass_kg`.

---

## 6. Test configurations

* `src/physics/testAircraft.ts` → `TEST_JET: FdmConfig`: generic ~7,500 kg twin turbofan
  light jet (CJ4/Phenom 300 class, **all EST**): S 30.7 m², b 15.5 m, 2 × 16 kN, flaps
  0/15/35, retractable gear (indices 0 nose, 1 left, 2 right), reversers (35 %),
  Vs ≈ 107 kt clean / 84 kt land at MLW, Vmo 305 / Mmo 0.77.
* `src/physics/testPiston.ts` → `TEST_PISTON: FdmConfig`, `TEST_PISTON_ENGINE: PistonConfig`:
  172S-class single (POH-cited where possible: 174 ft², 36 ft 1 in, 1663/2550 lb, 56 gal,
  IO-360-L2A 180 hp/2700, 76 in prop), fixed gear with castering/steerable nosewheel.

Validation (tests):
* 172-class vs POH: idle 620 rpm (~9 inHg); full-throttle static 2359 rpm (POH
  2300–2400); magneto drop 57/66 rpm at 1800 (POH ≤ 150, ≤ 50 differential); standalone
  engine leaned to 50 °F rich of peak (POH "Recommended Lean") at 6000 ft/2400 rpm/108 KTAS:
  103 hp = 57.2 % BHP, 8.41 GPH (POH Figure 5-8: 57 %, 8.2 GPH); at 8000 ft/2700 rpm/
  124 KTAS: 135.5 hp = 75.3 %, 10.8 GPH (POH: 77 %, 10.4 GPH); **full airframe** at
  2400 rpm/6000 ft/2550 lb flies **108.4 KTAS at 57 % power** (POH: 108 KTAS, 57 %).
* Jet: sits 60 s with 0 mm drift / 0 mm oscillation; parking brake holds idle thrust
  (2 mm); MTOW max-thrust roll to 110 KIAS in ~450 m, climbs > 2,500 fpm at 10° pitch;
  trimmed 250 KIAS/10,000 ft holds ±6 ft for 120 s hands-off (±50 ft after a doublet);
  start to idle in `startToIdle_s` ±15 %, flameout on fuel cut, hot/hung starts.

---

## 7. Usage examples

### 7.1 App shell wiring

```ts
const vars = new SimVars(); const events = new EventBus();
const fdm = new FlightModel(aircraft.fdm, vars, world);
const instance = await aircraft.create({ vars, events, world, nav, audio, fdm, storage });
const loop = new SimLoop(vars, {
  input: (dt) => input.poll(dt),
  systems: (dt) => { for (const s of instance.systems) s.update(dt); },
  physics: (dt) => fdm.step(dt),
  nav: (dt) => radios.update(dt),
  frame: (f) => { world.update(camera); instance.cockpit.update?.(f.realDt); displays.render(f.realDt); renderer.render(scene, camera); },
}, { events });
fdm.reposition({ lat: 47.4636, lon: -122.3079, onGround: true, headingTrue: 163 });
loop.resetAccumulator(); loop.start();
// weather module:
vars.set(ENV.qnhInHg, 30.12); vars.set(ENV.oatSeaLevelC, 8);
vars.set(ENV.surfaceWindDir, 190); vars.set(ENV.surfaceWindKt, 12); vars.set(ENV.surfaceGustKt, 8);
fdm.wind.setWindsAloft([{ altitudeFt: 9000, directionDeg: 230, speedKt: 35 }, { altitudeFt: 30000, directionDeg: 260, speedKt: 90 }]);
```

### 7.2 Aircraft `applyState('cruise')`

```ts
// systems set their switches/vars first (fuel_on, n1_cmd via FADEC, gear up, flaps 0) ...
for (const i of [1, 2]) { vars.set(ENG.fuelOn(i), 1); vars.set(ENG.n1Cmd(i), 85); }
for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), 0);
// Reposition FIRST: setEnginesRunning stabilizes the engines at the current flight condition.
ctx.fdm.reposition({ lat, lon, altFtMsl: 35000, headingTrue: 90, iasKt: 250 });
ctx.fdm.setEnginesRunning?.(true);
// optional exact trim (FlightModel instance available to the shell):
const t = fdm.computeTrim({ iasKt: 250 });
vars.set(SURF.pitchTrim, t.pitchTrim);
const n1 = (fdm.engines[0] as Turbofan).n1ForThrust(t.thrustN / 2, fdm.engineEnv);
```

### 7.3 Turbofan start logic (systems/FADEC side)

```ts
// each 60 Hz systems tick, for engine i:
if (startSelected && bleedOrStarterPowerAvailable) vars.set(ENG.starter(i), 1);
vars.set(ENG.ignition(i), startSelected || continuousIgnition ? 1 : 0);
if (vars.get(ENG.n2(i)) >= cfg.lightOffN2_pct && throttleAtIdle && fuelAvailable) vars.set(ENG.fuelOn(i), 1);
if (vars.get(ENG.n2(i)) >= 46) { vars.set(ENG.starter(i), 0); startSelected = false; }   // starter cut-out
vars.set(ENG.n1Cmd(i), fadecN1ForThrottleLever(tla, vars.get(FDM.pressAlt), vars.get(FDM.sat)));
```

### 7.4 172 start (systems side, POH sequence)

```ts
// aux pump ON + mixture RICH 3-5 s -> primes (fuel_on = 1 while aux pump pressurises)
vars.set(ENG.fuelOn(1), auxPumpOn || engineDrivenPumpTurning ? 1 : 0);
vars.set(ENG.mixture(1), mixtureLever);        // 0 = idle cut-off
vars.set(ENG.magLeft(1), key === 'L' || key === 'BOTH' || key === 'START' ? 1 : 0);
vars.set(ENG.magRight(1), key === 'R' || key === 'BOTH' || key === 'START' ? 1 : 0);
vars.set(ENG.starter(1), key === 'START' && busVolts > 20 ? 1 : 0);
```

### 7.5 Fuel system burning fuel

```ts
const burnKg = (vars.get(ENG.fuelFlowPph(i)) * PPH_TO_KGS) * dt;   // PPH_TO_KGS from core/units
vars.set(FUEL.tankKg(feedTank), Math.max(0, vars.get(FUEL.tankKg(feedTank)) - burnKg));
```

---

## 8. Contract additions made by physics (append-only)

* `vars.ts` `ENG`: `vacuumInHg(i)` → `eng{i}.vacuum_inhg`, `roughness(i)` → `eng{i}.rough`,
  `powerHp(i)` → `eng{i}.power_hp`.
* `vars.ts` `FDM`: `buffet`, `crashReason` (string), `aoaNorm`, `alphaStall`, `eas`, `frozen`.
* `vars.ts` `ENV`: `surfaceWindDir` (`env.wind_dir_deg`), `surfaceWindKt` (`env.wind_kt`),
  `surfaceGustKt` (`env.wind_gust_kt`).
* `SimContext.ts` `FlightModelHandle`: optional `setEnginesRunning?(running)`.
* `physics/types.ts`: optional `PistonConfig` fields (`induction`, `propRotation`,
  `pFactorCoeff`, `slipstreamYawCoeff`, `fullRichFactor`) and `TurbofanConfig` fields
  (`starterTau_s`, `selfSustainN2_pct`, `ittStartLimit_c`, `n1MapExponent`), declared as
  `PistonConfigExtras`/`TurbofanConfigExtras` and merged into the config interfaces.

## 9. Known limitations (SCOPE)

* Earth rotation, transport rate and the centripetal term are ignored (≈0.3 % lift at
  Mach 0.8); geoid separation ignored consistently (MSL = ellipsoid).
* Constant ISA deviation with altitude (no inversions); temperature aloft is not
  layer-configurable.
* Aerodynamics are a linear-in-controls coefficient build-up: no aeroelasticity, no
  explicit downwash lag beyond `CL_alphadot/Cm_alphadot`, no tailplane stall from ice,
  no deep-stall hysteresis, no Cl0/Cn0 terms.
* Turbofans: no surge/stall, fire, oil consumption; bleed pressure is a schedule.
* Pistons: fixed-pitch propellers only (no constant-speed governor), no turbo/supercharger,
  no carburettor icing, no detonation; P-factor and slipstream constants are EST.
* Gear: normal force along the terrain normal (strut bending not modelled); tyres do not
  blow; anti-skid is the systems' job (the FDM reports locked-wheel speed).
* Crash thresholds (structure impact 2 m/s, scrape 1.5 s, overload 1.5× limit, overspeed
  1.25 Vmo) are estimates.
