# Systems (control side): API reference

Owner: systems-control. Sources: `src/systems/{sensors,flightcontrols,autopilot,fadec,gear,warning}`.
Tests: `tests/systems/control` (`npx vitest run tests/systems/control`, 96 tests; `plant.ts` is a small
point-mass test plant you can reuse to tune gains).

These are data-driven building blocks for the "control" half of an aircraft: sensors, primary and secondary
flight controls, trim, fly-by-wire, autopilot/flight director, FADEC and autothrottle, landing gear and
brakes, and every alerting function (CAS/EICAS, TAWS/EGPWS, stall, overspeed, altitude alerting, takeoff
configuration, TCAS). An aircraft instantiates each block with its own numbers and bindings and puts the
instances in `AircraftInstance.systems`. Every block implements `Subsystem` (`name`, `update(dt)`, plus
`reset()`/`dispose()` where it has state or listeners). Blocks that read failures also have
`failures(): FailureDef[]` for the `FailureManager`.

You can wire an aircraft from this document without reading the source. The power-side blocks (electrical,
hydraulic, fuel, bleed, ...) are in `docs/modules/systems-power.md`; this module only consumes their outputs
through bindings.

---

## 0. Conventions (read first)

| Topic | Convention |
|---|---|
| Construction | `new Block(env, config)`. `env: BlockEnv = { vars, events?, audio?, world?, nav? }`. A full `SimContext` satisfies it. Blocks that need events (buttons), audio (tones/voices), terrain (`world`) or airports (`nav`) silently do without when those are missing (tests pass `{ vars }`). |
| Update rate | Systems run at 60 Hz (`dt = 1/60`). No block allocates inside `update` (strings are rebuilt only when their content changes). |
| Bindings | Every "input" option (power, switches, conditions) is a `Binding` from `src/systems/util/binding.ts`: a number, boolean, var name, expression string (`'hyd.a_psi > 1500 && ac.ap_sw'`, `'clamp01(hyd.b_psi / 3000)'`, `'cb.ap ?? 1'`) or `(vars) => number`. Compiled once in the constructor. See systems-power.md §1.1 for the expression language. A *condition* binding is true when non-zero. A *power* binding that feeds a rate (flaps, gear, flight-control actuators) is read as a 0..1 fraction. |
| Power and hydraulics | Blocks never look at buses or hydraulic systems themselves. Pass the availability as a binding, e.g. `power: 'elec.avn_bus_powered'`, actuators `['clamp01(hyd.a_psi / 2800)', 'clamp01(hyd.b_psi / 2800)']`. |
| Failures | State var `fail.<id>` (1 = failed). Ids are listed per block. `FailureManager` is optional (it only writes those vars). |
| Sensor rule | Only `sensors/*` read FDM truth (`fdm.*`). Every other block and every display reads `adc{s}.*`, `ahrs{s}.*`, `ra{s}.*`, `irs{s}.*`, `gps.*`, `nav{r}.*`, `fms.*`, `ap.*`. Failures, lag and power loss then propagate everywhere. |
| Signs | Pilot-intuitive: + pitch = nose up, + roll = right wing down, + yaw = nose right. Surfaces are normalized −1..1. VS negative when descending. `gps.trk_mag_deg`/headings in degrees magnetic unless the name says `true`. |
| Units | Var suffixes: `_kt`, `_ft`, `_fpm`, `_deg`, `_dps`, `_g`, `_psi`, `_pct`, `_c`, `_inhg`, `_s`, `_nm`. |
| Strings | Mode names, FMA text, status text are string vars (`vars.getString`). Each is written only when it changes. |
| Aircraft-specific vars | Cockpit switches that are not in `core/vars.ts` use the `ac.` prefix (`ac.flap_lever`, `ac.gear_handle`, `ac.at_arm`, `ac.tla1`, `ac.irs1_mode`, `ac.autobrake_sel`, `ac.speedbrake_lever`, `ac.parking_brake`, `ac.fcs_mode_sel`). Every default can be overridden in the config. |
| Imports | `import { Afcs, AFCS_B737_AFDS } from '@/systems/autopilot'`, likewise `@/systems/sensors`, `@/systems/flightcontrols`, `@/systems/fadec`, `@/systems/gear`, `@/systems/warning`. Every file listed below is re-exported by its folder's `index.ts`. |

### 0.1 Recommended subsystem order

A block that reads a value written later in the same step sees the previous step's value (16 ms). This order
keeps the important chains inside one step:

```
FailureManager -> power blocks (electrical, hydraulic, fuel, bleed ... systems-power.md §0.2)
 -> sensors: AirDataComputer(s), Ahrs / Irs, RadioAltimeter(s), VacuumSystem
 -> LandingGear                         (gear.air_ground, read by almost everything)
 -> ThrustRatingComputer
 -> Afcs                                (servos, ap.trim_cmd, ap.at_req)
 -> Autothrottle                        (moves the thrust lever vars)
 -> ThrustLeverFadec, EngineStartController(s)
 -> YawDamper, StallWarning             (fcs.yd_cmd, stall.pusher_cmd)
 -> MechanicalFlightControls | FlyByWire, TrimAxis(es)
 -> Flaps, Spoilers, NosewheelSteering, Brakes
 -> Overspeed, AltitudeAlert, Taws (contains MinimumsMonitor), Tcas, TakeoffConfigWarning
 -> CasManager (owns FlightPhase), DisconnectAlerts
```

### 0.2 Inter-block protocol (who writes what)

| Var(s) | Writer | Readers |
|---|---|---|
| `adc{s}.*` (ias_kt, mach, alt_ft, vs_fpm, tas_kt, sat_c, tat_c, valid, press_alt_ft, cas_kt, aoa_deg, ias_trend_kt, ias_rate_kts) | `AirDataComputer` | AFCS, FBW, A/T, warnings, displays |
| `ahrs{s}.*` (pitch_deg, bank_deg, hdg_mag_deg, hdg_true_deg, turn_rate_dps, slip, valid, p/q/r_dps, nx/ny/nz_g, att_valid, hdg_valid) | `Ahrs` or `Irs` | AFCS, FBW, YD, warnings, displays |
| `ra{s}.alt_ft`, `ra{s}.valid`, `ra{s}.ncd` | `RadioAltimeter` | AFCS (autoland), A/T (retard), TAWS, minimums, TCAS, spoilers |
| `gear.air_ground` (1 = on ground, debounced), `gear.down_locked`, `gear.up_locked` | `LandingGear` (also for fixed gear, `retractable: false`) | nearly every block's `onGround` default |
| `ap.servo_pitch/roll/yaw` | `Afcs` | `MechanicalFlightControls` (added to the surface), `FlyByWire` (added to the yoke) |
| `ap.force_pitch/roll` | `Afcs` (Boeing style: 1 while engaged) | `MechanicalFlightControls` removes the pilot input (force-sensing CWS) |
| `ap.trim_cmd` (−1/0/+1) | `Afcs` | `TrimAxis` autopilot channel |
| `ap.at_req` (`AtRequest`), `ap.at_spd_fms`, `ap.flare`, `ap.ga_full` | `Afcs` | `Autothrottle` |
| `ap.yd_engaged` | `Afcs` (YD button / with AP) or a cockpit switch | `YawDamper` (writes it back to 0 on an automatic disengage) |
| `fcs.yd_cmd` | `YawDamper` | `MechanicalFlightControls` yaw channel |
| `stall.pusher_cmd` (≤ 0) | `StallWarning` (with a pusher) | `MechanicalFlightControls` pitch channel |
| `ac.tla{i}` (0..1, < 0 = reverse) | cockpit thrust lever and `Autothrottle` (servo) | `ThrustLeverFadec` |
| `fadec.n1_limit_pct`, `fadec.n1_<rating>_pct` | `ThrustRatingComputer` | `ThrustLeverFadec`, `Autothrottle`, N1 displays |
| `eng{i}.n1_cmd_pct`, `eng{i}.reverser_pos` | `ThrustLeverFadec` | physics engine |
| `fadec.eng{i}.starter_cmd`, `eng{i}.ignition`, `fadec.eng{i}.fuel_cmd` | `EngineStartController` | starter block / fuel system `run` binding / physics |
| `surf.*` | flight-control blocks | physics |
| `gear.pos{i}`, `gear.brake_left/right`, `gear.steer_deg` | `LandingGear`, `Brakes`, `NosewheelSteering` | physics |
| `ap.disc_warn`, `at.disc_warn` | `Afcs`, `Autothrottle` | `DisconnectAlerts` (aurals), annunciators |

---

## 1. Shared helpers: `autopilot/lib.ts`

```ts
interface BlockEnv { vars: SimVars; events?: EventBus; audio?: AudioApi; world?: WorldQuery; nav?: NavDatabase }
type Schedule = number | Table1D;                   // constant or { x: [...], y: [...] }
sched(s: Schedule, x: number): number               // constants ignore x
deadband(x, db): number                             // 0 inside ±db, continuous outside
clampAbs(x, lim): number
headingError(target, current): number               // [-180, 180)
norm360(h): number                                  // [0, 360)
payloadNumber(p, fallback): number                  // number | { value } | { delta } | { steps }
payloadBool(p, fallback): boolean                   // boolean | number | { pressed } | { value }
listen(events, offs, name, fn): void                // subscribe and remember the unsubscribe in offs[]

class Pid({ kp, ki?, kd?, iLimit?, outLimit?, dTau? })
  update(err, dt, rate?): number   // rate given -> derivative on measurement (-kd*rate)
  reset(integralOutput = 0)        // preload the integrator (bumpless transfer)
  kp, ki, kd are public (gain scheduling)
class Washout(tau)        update(x, dt) high-pass; reset(x = 0)
class RateFilter(tau = 0.5, angle = false)   update(x, dt) filtered d/dt (angle: unwraps degrees); reset(x?, rate?)
```

---

## 2. Sensors (`src/systems/sensors`)

`SENSOR_VARS` (`sensors/vars.ts`) holds every sensor var name that is not already in `core/vars.ts` `ADC`.
`s` is the 1-based sensor index.

| Builder | Var |
|---|---|
| `pressAlt(s)` | `adc{s}.press_alt_ft` (29.92 datum) |
| `cas(s)` | `adc{s}.cas_kt` |
| `aoa(s)` | `adc{s}.aoa_deg` (vane) |
| `iasTrend(s)` / `iasRate(s)` | `adc{s}.ias_trend_kt` / `adc{s}.ias_rate_kts` |
| `pitotBlocked(s)` / `staticBlocked(s)` / `altStatic(s)` / `powered(s)` | `adc{s}.pitot_blocked` / `static_blocked` / `alt_static` / `powered` |
| `p(s)` `q(s)` `r(s)` | `ahrs{s}.p_dps` / `q_dps` / `r_dps` |
| `nx(s)` `ny(s)` `nz(s)` | `ahrs{s}.nx_g` / `ny_g` / `nz_g` |
| `attValid(s)` / `hdgValid(s)` | `ahrs{s}.att_valid` / `ahrs{s}.hdg_valid` (`ahrs{s}.valid` = both) |
| `aligning(s)` / `alignRemaining(s)` | `ahrs{s}.aligning` / `ahrs{s}.align_s` |
| `irsModeSel(s)` | `ac.irs{s}_mode` (input: 0 OFF, 1 ALIGN, 2 NAV, 3 ATT) |
| `irsState(s)` | `irs{s}.state` (`IrsState`) |
| `irsAlignLight(s)` | `irs{s}.align_light` (0 off, 1 steady, 2 flashing) |
| `irsOnDc(s)` `irsDcFail(s)` `irsFault(s)` | `irs{s}.on_dc` / `dc_fail` / `fault` |
| `irsNavValid(s)` `irsLat(s)` `irsLon(s)` `irsGs(s)` `irsTrackTrue(s)` `irsPosErr(s)` `irsPosEntered(s)` | `irs{s}.nav_valid` / `lat_deg` / `lon_deg` / `gs_kt` / `trk_true_deg` / `pos_err_nm` / `pos_entered` |
| `raAlt(s)` `raValid(s)` `raNcd(s)` | `ra{s}.alt_ft` / `ra{s}.valid` / `ra{s}.ncd` |
| `vacSuction` / `vacLow` / `vacPumpOk(n)` | `ac.vac.suction_inhg` (= `ANALOG_VARS.suction`) / `vac.low` / `vac.pump{n}_ok` |

### 2.1 `AirDataComputer(env, AirDataConfig)`: `adc{s}.*`

Pitot-static measurement. It reads the true static pressure (`fdm.static_press_pa`) and CAS (`fdm.cas_kt`),
models each port as a pneumatic lag, and recomputes every indication from the **measured** pressures using the
same ISA relations as the FDM. Blockage errors are therefore physically consistent:

- **Static port blocked** (≥ 0.95): the altimeter freezes, VS goes to 0, the ASI under-reads in a climb and
  over-reads in a descent.
- **Pitot blocked** with the drain blocked (the default): the ASI behaves like an altimeter (reads high in a
  climb). With `pitotDrainOpen: true` the ASI falls to 0.
- Partial blockage (ice `ice.pitot{p}` / `ice.static{p}` 0..1) slows the line: τ / (1 − b)².

| Option | Default | Meaning |
|---|---|---|
| `index` | required | `s` of the `adc{s}.*` outputs |
| `power` | `true` | Computer power. Giving it makes the ADC `digital`. |
| `digital` | `power !== undefined` | Digital: validity + self test; outputs freeze when unpowered. Pneumatic (172 steam): always valid, no power needed. |
| `selfTestS` | 3 (EST) | Power-up time before `valid` = 1 |
| `pitotProbe` / `staticPort` | `index` | Index of `ice.pitot{p}` / `ice.static{p}` |
| `pitotTauS` / `staticTauS` | 0.08 / 0.12 (EST) | Line lags |
| `pitotDrainOpen` | false | See above |
| `vsTauS` | 0.6 | VS filter |
| `iasFromCas` | IAS = CAS | `Table1D` KIAS vs KCAS (inverse of the POH airspeed calibration table) |
| `staticErrorPa` | 0 | Static-source position error (Pa) vs KCAS (`Schedule`) |
| `alternateStatic` | none | `{ active: Binding, errorPa: Schedule }`. While active it bypasses the (blocked/iced) external ports and adds `errorPa` (cabin pressure, usually negative, so the altimeter and ASI read high). |
| `aoa` | `{ tauS: 0.1, biasDeg: 0 }` | AoA vane |
| `tatRecovery` | 1 | TAT probe recovery factor |
| `trendS` | 6 | Airspeed trend horizon (Garmin 6 s, Boeing 10 s) |

- **Reads:** `fdm.static_press_pa`, `fdm.cas_kt`, `fdm.tat_c`, `fdm.aoa_deg`, `ice.pitot{p}`, `ice.static{p}`, `adc{s}.baro_inhg`, `adc{s}.baro_std`.
- **Writes:** `adc{s}.ias_kt`, `mach`, `alt_ft` (baro corrected), `vs_fpm`, `tas_kt`, `sat_c`, `tat_c`, `valid`, `press_alt_ft`, `cas_kt`, `aoa_deg`, `ias_trend_kt`, `ias_rate_kts`, `pitot_blocked`, `static_blocked`, `alt_static`, `powered`.
- **Initialized if missing:** `adc{s}.baro_inhg` = 29.92, `adc{s}.baro_std` = 0. The cockpit baro knob writes `adc{s}.baro_inhg`, and the STD button writes `baro_std`.
- **Failures:** `adc{s}` (computer), `adc{s}.pitot`, `adc{s}.static`, `adc{s}.aoa` (vane jammed).
- **Exported helpers:** `STD_BARO_INHG` (29.9213), `pressureAltitudeFt(pa)`, `indicatedAltitudeFt(staticPa, baroInHg)`.

A two-ADC jet uses `index: 1` and `2`, plus a standby source (`index: 3`, pneumatic, `power` omitted) for the
standby instrument.

### 2.2 `Ahrs(env, AhrsConfig)`: `ahrs{s}.*`

A solid-state AHRS (GRS 77/79). It samples FDM attitude, rates and accelerations, filters them, and
publishes them with validity.

| Option | Default | Meaning |
|---|---|---|
| `index` | required | Output `ahrs{s}` |
| `power` | true | Bus |
| `alignS` | 45 (EST, G1000 PG "within one minute") | Attitude invalid after power-up |
| `hdgAlignS` | 15 (EST) | Additional time until the heading is valid |
| `filterTauS` | 0.04 | Output filter |
| `startAligned` | false | Skip the alignment (initial states in the air) |

- **Methods:** `reset(aligned = true)`. `out: AttitudePublisher` (see below).
- **Writes:** `ahrs{s}.pitch_deg`, `bank_deg`, `hdg_mag_deg`, `hdg_true_deg`, `turn_rate_dps`, `slip` (−1..1 ball, full scale at `SLIP_FULL_SCALE_G` = 0.2 g), `valid`, `p/q/r_dps`, `nx/ny/nz_g`, `att_valid`, `hdg_valid`, `aligning`, `align_s`. Values freeze (and validity drops) while invalid.
- **Failures:** `ahrs{s}` (everything flagged), `ahrs{s}.hdg` (magnetometer: heading flagged, attitude OK), `ahrs{s}.drift` (unflagged drift: 2°/min bank, 1°/min pitch, EST).

`AttitudePublisher(vars, index, filterTauS = 0.04)` is shared by `Ahrs` and `Irs`. It has
`publish(dt, attValid, hdgValid, magVarDeg = NaN)` (NaN uses `fdm.mag_var_deg`), `invalidate()` and
`reset()`. The public `pitchErr`, `bankErr` and `hdgErr` (deg) are added to the output.

### 2.3 `Irs(env, IrsConfig)`: 737NG ADIRU / bizjet IRU

Mode selector `ac.irs{s}_mode`: 0 OFF, 1 ALIGN, 2 NAV, 3 ATT. `IrsState` enum: Off 0, Aligning 1, Nav 2,
Att 3, Fault 4.

- **Alignment.** Time vs |latitude| from `alignTime` (default `IRS_ALIGN_TIME_737`: 5 min at the equator,
  10 min at 70°, 17 min at 78.25°, per the 737NG FCOM via SmartCockpit). Moving faster than `motionLimitKt`
  (1.5 kt) restarts it and flashes ALIGN.
- **Position entry.** NAV needs a present-position entry: event `irs.pos_entry` (all units) or
  `irs{s}.pos_entry`, or `enterPosition()`. With `gpsAutoPosition` the position comes from a valid GPS. Once
  the time has elapsed without a position, ALIGN flashes.
- **Fast realign.** NAV → ALIGN on the ground gives a 30 s fast realign (`fastRealignS`).
- **ATT mode.** Attitude becomes valid after 30 s straight and level (`attAlignS`). Heading is invalid until
  event `irs{s}.hdg_entry` (payload: magnetic heading in deg); after that it drifts at `attHdgDriftDegPerHr`
  (15, EST).
- **Power.** `power` is the AC bus. `dcBackup` (default false) keeps the IRS on DC (ON DC lamp) when AC is
  lost. DC FAIL is lit while powered with no DC backup, so give a `dcBackup` binding for the 737 (hot battery
  bus). ON DC is also lit for `dcTestS` (5 s) at power-up.
- **Drift.** Pure inertial error grows at `driftNmPerHr` (2 nm/h, EST from the RNP-10 class) in flight.
  `gpsUpdating: true` (hybrid IRU: G650, Global) decays the error with a 60 s τ while the GPS is valid.

| Option | Default |
|---|---|
| `index`, `outputIndex` (the `ahrs{n}` it publishes to) | required, `index` |
| `modeVar` | `ac.irs{s}_mode` |
| `power`, `dcBackup` | true, false |
| `alignTime`, `fastRealignS`, `attAlignS`, `dcTestS`, `motionLimitKt` | `IRS_ALIGN_TIME_737`, 30, 30, 5, 1.5 |
| `requirePosition`, `gpsAutoPosition`, `gpsUpdating` | true, false, false |
| `driftNmPerHr`, `attHdgDriftDegPerHr` | 2, 15 |
| `startAligned` | false |

- **Public:** `state`, `alignRemaining`, `posEntered`, `out`, `enterPosition()`, `enterHeading(hdgMag)`, `forceAligned()` (initial states), `reset()` (goes straight to NAV if the selector is ALIGN/NAV and power is on), `dispose()`.
- **Writes:** the `ahrs{outputIndex}.*` attitude set (as §2.2), `irs{s}.state`, `align_light`, `on_dc`, `dc_fail`, `fault`, `nav_valid`, `lat_deg`, `lon_deg`, `gs_kt`, `trk_true_deg`, `pos_err_nm`, `pos_entered`, plus `ahrs{n}.aligning`/`align_s`.
- **Reads:** `fdm.lat/lon/on_ground/gs_kt/bank_deg/turn_rate_dps/hdg_mag_deg/trk_true_deg`, `gps.valid`.
- **Failure:** `irs{s}` (FAULT lamp, all outputs invalid).

### 2.4 `RadioAltimeter(env, { index, power?, maxFt = 2500, tauS = 0.1, maxBankDeg = 40, selfTestS = 2 })`

Reads `fdm.radio_alt_ft` (already referenced to the gear bottom). Above `maxFt`, or beyond `maxBankDeg` of
bank/pitch, the output is NCD: `ra{s}.ncd` = 1, `valid` = 0, altitude parked at `maxFt`. PFDs blank the RA
readout on NCD. Writes `ra{s}.alt_ft`, `ra{s}.valid`, `ra{s}.ncd`. Failure `ra{s}` (invalid, not NCD).

### 2.5 `VacuumSystem(env, VacuumConfig = {})`: 172S steam gyros

| Option | Default |
|---|---|
| `pumps` | `[{ suction: 'eng1.vacuum_inhg' }]` (engine-driven pump from physics) |
| `regulatedInHg` | 5.3 (EST, in the 4.5–5.5 green arc, 172S POH §7) |
| `lowInHg` | 3.0 (LOW VACUUM annunciator, 172S POH) |
| `annunciatorPower` | true (the VAC light needs its bus) |
| `tauS` | 0.5 |

Writes `ac.vac.suction_inhg` (the suction gauge and the analog AI/DG read it and spin down on their own),
`vac.low`, `vac.pump{n}_ok`. Failures `vac.pump{n}`, `vac.leak` (× 0.4), `vac.regulator` (× 0.6).
Public: `suction`.

---

## 3. Flight controls (`src/systems/flightcontrols`)

`FCS_VARS` (`flightcontrols/vars.ts`); `ControlAxis = 'pitch' | 'roll' | 'yaw'`.

| Builder | Var |
|---|---|
| `apServo(axis)` | `ap.servo_<axis>` |
| `apForceSensed(axis)` | `ap.force_pitch` / `ap.force_roll` |
| `ydCmd` | `fcs.yd_cmd` |
| `pusherCmd` | `stall.pusher_cmd` |
| `column(axis)` `power(axis)` `manual(axis)` `jammed(axis)` | `fcs.<axis>_column` / `_power` / `_manual` / `_jam` |
| `trimUnits(axis)` `trimMotion(axis)` `trimInMotion(axis)` `trimTakeoffOk(axis)` `trimElecAvail(axis)` | `trim.<axis>_units` / `_motion` / `_in_motion` / `_to_ok` / `_elec_avail` |
| `trimManualEvent(axis)` | event `trim.<axis>_manual` |

### 3.1 `MechanicalFlightControls(env, { pitch?, roll?, yaw?, iasVar? })`

Conventional primary controls (cable, pushrod or hydraulically boosted): pilot input plus AP servo plus
augmentation, written to `surf.elevator/aileron/rudder`.

For each axis the command is `pilot·gearing(IAS)`, plus every `addVars` entry, then limited to
`authority(IAS)` and rate limited. `ap.force_<axis>` ≠ 0 removes the pilot term (Boeing force-sensing CWS: the
AFCS turns the force into a command).

`ControlChannelConfig`:

| Option | Default |
|---|---|
| `input` / `output` | `input.<axis>` / `surf.elevator`, `surf.aileron`, `surf.rudder` |
| `addVars` | pitch `[ap.servo_pitch, stall.pusher_cmd]`, roll `[ap.servo_roll]`, yaw `[ap.servo_yaw, fcs.yd_cmd]` |
| `pilotSensedVar` | `ap.force_<axis>` for pitch/roll, none for yaw; `null` disables |
| `deadband` | 0.01 (rescaled so ±1 still gives ±1) |
| `gearing` | 1 (`Schedule` vs IAS) |
| `actuators` | none = purely mechanical. `Binding[]`, each 0..1 (e.g. hydraulic pressure fraction). The best one wins; below 0.5 the rate falls proportionally. |
| `manualReversion` | `{ authority: 0.5 }` (EST) when actuators exist: with every actuator lost (< 0.05) the pilot keeps reduced authority and servo/augmentation inputs are lost (737 manual reversion through tabs). `null` freezes the surface (rudder without standby hydraulics). |
| `rateLimit` / `manualRateLimit` | 2.5 / 1.0 full scale per s (EST) |
| `authority` | 1 (`Schedule` vs IAS: rudder ratio changer / limiter) |

- **Writes:** outputs, `fcs.<axis>_column` (total command, for back-driven yoke animation), `fcs.<axis>_power`, `fcs.<axis>_manual`, `fcs.<axis>_jam`.
- **Failures:** `fcs.<axis>.jam`, `fcs.<axis>.actuator<n>` (1-based).
- **Public:** `surface(axis)`, `reset()` (reads the outputs).

### 3.2 `TrimAxis(env, TrimAxisConfig)`: one per trim axis

Elevator trim tab, movable stabilizer, aileron or rudder trim. The position is kept in display units
(`trim.<axis>_units`, e.g. 737 stab 0..17 units) and mapped piecewise-linearly through `neutral` to the
normalized FDM command (`surf.pitch_trim` / `aileron_trim` / `rudder_trim`).

The sources, in order:

1. **Manual.** The trim wheel either writes `trim.<axis>_units` directly (any external write counts as a
   manual move) or emits `trim.<axis>_manual` with `{ delta }` in units.
2. **Pilot electric.** Switch vars −1..1. Needs `electric.power` and `electric.enable` (cutout).
3. **Autopilot.** `ap.trim_cmd`. Inhibited while the pilot trims.

| Option | Meaning |
|---|---|
| `axis`, `range: [min, max]` | Required |
| `neutral` | Units value that maps to 0 (default mid-range) |
| `increasingPositive` | default true (more units = nose up / right) |
| `positionVar`, `output`, `initial` | defaults `trim.<axis>_units`, `surf.*_trim`, neutral |
| `electric` | `{ power, enable?, switchVars? (pitch default [input.pitch_trim_rate]), rate: Schedule (units/s vs IAS), rateFlapsExtended?, limits?, limitsFlapsExtended?, columnCutout?: { inputVar?, threshold } }`. The column cutout stops electric trim that opposes a column deflection (737). |
| `autopilot` | `{ cmdVar? (ap.trim_cmd for pitch), power?, enable?, rate, rateFlapsExtended?, limits? }` |
| `manual` | `{ enable?, event? }` |
| `takeoffBand` | `[lo, hi]` units, gives `trim.<axis>_to_ok` (green band / TOCW) |
| `runawayDirection` | −1 (nose down) |
| `flapsVar`, `iasVar` | `surf.flaps_deg`, `adc1.ias_kt` |

- **Writes:** output, `trim.<axis>_units`, `_motion` (−1/0/+1), `_in_motion`, `_to_ok`, `_elec_avail`.
- **Failures:** `trim.<axis>.jam`, `trim.<axis>.runaway` (motor runs toward `runawayDirection` while electric power and enable are present; pulling the cutout stops it).
- **Public:** `position`, `normalize(units)`, `setPosition(units)` (applyState), `reset()`, `dispose()`.

### 3.3 `FlyByWire(env, FlyByWireConfig)`: G650/G800 style FCC

Modes (`fbw.mode`): NORMAL, ALTERNATE (air or inertial data invalid, `fail.fbw.adc_data`, or
`ac.fcs_mode_sel` = 1), DIRECT (`fail.fbw.fcc`, no FCC power, or selector = 2).

**NORMAL law.**

- **Pitch.** Yoke → load-factor increment: aft `s·(nzMax−1)`, forward `s·(1−nzMin)`. Speed stability adds
  `speedGain·(IAS − Uref)`. The pitch trim switch moves `Uref` (trim for speed); `Uref` follows IAS while the
  AP is engaged. There is 1-g compensation up to 33° of bank.
- **Pitch protections.** AoA limiter (onset `alphaOnset`·αmax, holds α below `alphaMax`), high-speed nose-up
  above Vmo+6 / Mmo+0.01, pitch attitude limits +30/−15° (EST).
- **Pitch control.** PI on the nz error with q damping and anti-windup. The integrator is offloaded into the
  stabilizer (auto-trim, `surf.pitch_trim`) so the elevator returns toward neutral.
- **Roll.** Rate command (`maxRateDps` at full wheel). Wheel released: bank hold. Beyond `bankHoldDeg` (33°)
  it returns to 33° when released, and the available rate fades to 0 at `maxBankDeg` (67°).
- **Yaw.** Pedals, plus a washed-out yaw-rate damper, plus ny turn coordination.
- **On the ground.** Direct gearing until lift-off; then the flight law starts from the current state.

**ALTERNATE / DIRECT.** Proportional gearing (`direct.pitch` scheduled vs flaps in ALTERNATE, vs IAS in
DIRECT). The trim switch drives the stabilizer at `direct.stabRate`. Yaw damping stays in ALTERNATE only.

The AFCS drives the FBW through `ap.servo_*`, treated as yoke equivalents. Do **not** add a `TrimAxis` for
pitch (the FBW owns `surf.pitch_trim` / `trim.pitch_units`) or a `YawDamper` (built in).

| Option | Default |
|---|---|
| `power` | required (FCC power, any channel) |
| `actuators` | `{ pitch?, roll?, yaw?: Binding[] }` 0..1, best wins; none = powered |
| `modeSelectVar` | `ac.fcs_mode_sel` (0 auto, 1 ALTN, 2 DIRECT) |
| `airDataValid` / `inertialValid` / `onGround` | `adc1.valid` / `ahrs1.att_valid` / `gear.air_ground` |
| `pitch.alphaMax` | required `Table1D` α (deg, vane) vs flaps |
| `pitch.vmoKt`, `pitch.mmo` | required |
| `pitch.nzMax` / `nzMin` | 2.5 / −1 clean, 2.0 / 0 flaps (14 CFR 25.337) |
| `pitch.speedGain`, `trimRateKtPerS`, `alphaOnset` | 0.01 g/kt, 4 kt/s, 0.9 (code7700: 0.88–0.93) |
| `pitch.kp`, `ki`, `kq` | 0.35, 0.5, 0.02 at `gainRefKt` (250), scaled (ref/IAS)², EST |
| `pitch.stabRate`, `stabUnits` | 0.03 /s, `[-1, 1]` (display units for `trim.pitch_units`) |
| `pitch.pitchUpLimitDeg` / `pitchDownLimitDeg` | 30 / −15 |
| `roll` | `{ maxRateDps: 15, bankHoldDeg: 33, maxBankDeg: 67, kp: 0.04, ki: 0.02 }` |
| `yaw` | `{ yawDampGain: 0.02, turnCoordGain: 0.5, washoutS: 3 }` |
| `direct` | `{ pitch: 1, roll: 1, yaw: 1, stabRate: 0.05 }` |

- **Writes:** `surf.elevator/aileron/rudder/pitch_trim`, `trim.pitch_units`, `fbw.mode` (string), `fbw.mode_code` (0/1/2), `fbw.aoa_limit`, `fbw.hs_protect`, `fbw.bank_protect`, `fbw.pitch_protect`, `fbw.ground_law`, `fbw.speed_ref_kt`, `fbw.nz_cmd`.
- **Reads:** `input.pitch/roll/yaw`, `input.pitch_trim_rate`, `ap.servo_*`, `ap.engaged`, `ahrs1.*`, `adc1.ias_kt/mach/aoa_deg/press_alt_ft`, `surf.flaps_deg`.
- **Failures:** `fbw.fcc`, `fbw.adc_data`.
- **Public:** `mode`, `stab`, `uRef`, `reset()`.

### 3.4 `Flaps(env, FlapsConfig)`

- **Lever.** The lever var holds a detent's `lever` value; the nearest detent is selected.
- **Load relief.** Rules retract the command above `retractKt` and re-extend below `reextendKt` (737NG:
  40→30 at 163/158 kt, 30→25 at 176/171 kt). Rules chain.
- **Drives.** The normal drive moves at `rateDegPerS × power` (0..1, none below 5 %). The alternate drive
  (737 ALTERNATE FLAPS, about 1 min to flaps 15) moves with a hold switch (−1 up / +1 down) or follows the
  lever.
- **Panels and asymmetry.** Left and right panels are tracked separately. A panel jam makes an asymmetry;
  beyond `asymmetryDeg` (5, EST) the normal drive stops and `flaps.asym` latches.
- **Disagree.** A command/position difference over 1° with no motion for 3 s sets `flaps.disagree`.
- **Slats.** Position vs the flap *command* (`Table1D`), with their own travel time and power.
  `autoSlat: { condition, flapsRange }` drives them to 1 (737 auto-slat).
- **Overspeed.** `vfe` per detent sets `flaps.overspeed`.

| Option | Default |
|---|---|
| `leverVar` | `ac.flap_lever` |
| `detents: FlapDetent[]` | `{ lever, flapDeg, label?, vfe? }`, required |
| `normal` | `{ power: Binding, rateDegPerS }`, required |
| `alternate` | `{ active, switchVar?, followLever?, rateDegPerS, power? }` |
| `loadRelief` | `FlapLoadRelief[] { fromDeg, toDeg, retractKt, reextendKt }` |
| `asymmetryDeg`, `slats { schedule, travelS, power?, autoSlat? }`, `iasVar`, `initialDeg` | |

- **Writes:** `surf.flaps_deg` (mean), `surf.slats`, `flaps.cmd_deg`, `flaps.lever_deg`, `flaps.left_deg`, `flaps.right_deg`, `flaps.transit`, `flaps.moving` (0..1 hydraulic demand), `flaps.load_relief`, `flaps.asym`, `flaps.disagree`, `flaps.overspeed`, `flaps.detent`, `slats.pos`, `slats.transit`.
- **Failures:** `flaps.left.jam`, `flaps.right.jam`, `flaps.drive`, `slats.drive`.
- **Public:** `left`, `right`, `slats`, `commandDeg`, `detentIndex(lever)`, `setPosition(deg)` (applyState), `reset()`.

### 3.5 `Spoilers(env, SpoilerConfig)`

The speedbrake lever (`ac.speedbrake_lever`, 0 DOWN .. 1 UP) works like this:

- `armedValue` is the ARMED detent.
- Between it and `flightDetent` the flight spoilers extend proportionally (limited to `flightMax` in the air).
- Beyond the flight detent, on the ground only: full extension including the ground spoilers.
- A separate `groundArm` switch replaces the ARMED detent (G650, Global, Citation).

Other behavior:

- **Speedbrake output.** `speedbrake: 'spoilers'` (default: the speedbrake *is* the flight spoilers, as on the
  737, G650 and Global) writes `surf.spoiler_left/right`. `'panels'` writes `surf.speedbrake` (Citation
  panels).
- **Roll spoilers.** `roll: { deadband, gain, aileronVar? }`: above the deadband, the down-going wing's
  spoilers rise.
- **Auto ground spoilers (737NG).** Deploy when armed, the thrust levers are idle, and either the wheels spin
  up (> `spinupKt`, 60) or ground mode is set with RA < `raFt` (10). The lever is back-driven to UP.
- **RTO.** On the ground, with wheel speed > `rto.speedKt` and the thrust levers idle, the spoilers deploy
  without being armed.
- **Retract.** Advancing a thrust lever retracts them and returns the lever to DOWN.

| Option | Default |
|---|---|
| `leverVar`, `armedValue`, `flightDetent` | `ac.speedbrake_lever`, none, 1 |
| `groundArm`, `speedbrake`, `flightMax`, `groundSpoilers` | none, 'spoilers', 1, true |
| `roll` | none |
| `auto` | `{ thrustIdle, thrustAdvanced?, wheelSpeedVars? ([gear.wheel_speed1_kt, gear.wheel_speed2_kt]), spinupKt: 60, groundMode? (gear.air_ground), raVar? (ra1.alt_ft), raFt: 10, rto?: { speedKt }, leverBackdrive: true }` |
| `flightPower`, `groundPower` | 1 |
| `travelS` | 1.5 (EST) |
| `extLight` | `{ flapsAboveDeg, raBelowFt, flapsVar? }` (SPEEDBRAKE EXTENDED) |

- **Writes:** `surf.spoiler_left/right`, `surf.speedbrake`, `surf.ground_spoilers`, `spoilers.armed`, `spoilers.deployed`, `spoilers.sb_ext`, `spoilers.moving`, `spoilers.armed_light`, `spoilers.do_not_arm`, `spoilers.ext_light`, and the lever var when back-driven.
- **Failures:** `spoilers.auto`, `spoilers.flight`, `spoilers.ground`.

### 3.6 `YawDamper(env, YawDamperConfig)`

A series yaw damper: washed-out yaw rate × gain(IAS), plus lateral acceleration × `nyGain`, written to
`fcs.yd_cmd`. Engaged by `engagedVar` (`ap.yd_engaged`: the AFCS YD button or a switch). Loss of power, of
the rate source, or `fail.yd` writes the engage var back to 0 and lights `yd.off_light`.

| Option | Default |
|---|---|
| `gain` | required (`Schedule` vs IAS, rudder per deg/s) |
| `engagedVar`, `power` | `ap.yd_engaged`, true |
| `rateVar`, `rateValid`, `nyVar` | `ahrs1.r_dps`, `ahrs1.att_valid`, `ahrs1.ny_g` |
| `nyGain`, `washoutS`, `authority` | 0, 3, 0.15 (EST) |
| `iasVar`, `output` | `adc1.ias_kt`, `fcs.yd_cmd` |

Writes `fcs.yd_cmd`, `yd.active`, `yd.off_light`. Failure `yd`. Public `command`.

### 3.7 `NosewheelSteering(env, SteeringConfig)`

The command is the tiller × `tiller.maxDeg` (priority while deflected), or else the pedals × `pedals.maxDeg`
× `fade(GS)`. The wheel slews at `rateDegPerS` (25, EST) while engaged, powered and with WOW. Unpowered or
disengaged, `unpowered: 'center'` (default) re-centers it; `'hold'` leaves it. It always re-centers in the
air. References: 737NG pedals ±7° and tiller ±78° (hydraulic A); 172S pedals ±10° (POH §7).

Options: `output` (`gear.steer_deg`), `tiller { input? (input.tiller), maxDeg }`,
`pedals { input? (input.yaw), maxDeg, fade? }`, `power`, `engage`, `wow` (`gear.wow0 != 0`), `speedVar`
(`gps.gs_kt`, falling back to `gear.wheel_speed0_kt`), `rateDegPerS`, `maxDeg`, `unpowered`.

Writes `gear.steer_deg`, `steer.cmd_deg`, `steer.engaged`, `steer.powered`. Failure `steer`. Public `angle`.

---

## 4. Autopilot / flight director (`src/systems/autopilot`)

### 4.1 `Afcs(env, AfcsConfig)`

One generic AFCS. `style` selects the behavior family ('garmin' GFC 700, 'kap140', 'boeing' 737 AFDS,
'honeywell' Primus Epic, 'collins' Pro Line Fusion); the presets (§4.4) fill in the rest. Build it as
`new Afcs(env, { ...PRESET, power, servoPower, sensors, gains })`.

**Each update**, in order:

1. Read the sensors (never fdm).
2. Power/validity auto-disconnect.
3. Hardware buttons: rising edges of `input.ap_disc` and `input.toga`.
4. Trim-switch disconnect and pilot override.
5. Automatic transitions.
6. Outer loops: FD bank/pitch, magnitude and rate limited.
7. Inner loops: servos, trim requests, mistrim.
8. Annunciations and the A/T request.

**Control laws** (gains in `AfcsGains`, EST):

- **Bank modes.**
  - HDG/TRK: `k·Δψ`, limited to the bank limit.
  - ROL: holds the bank at engagement (wings level below 6°).
  - LNAV: `fms.lnav_bank_cmd_deg`.
  - VOR/LOC/BC: desired track = course + clamp(xtk / (V·τ)). The cross-track comes from the angular deviation
    × DME distance. The mode flies GPS track when valid, heading otherwise. VOR over-station: the deviation is
    ignored in the cone.
- **Pitch.** Every path mode commands a vertical speed. The flight-path loop is
  `θc = γc + α̂ + kp(γc − γ) + ki∫`.
  - ALT: `vs = k·Δh`.
  - ALTS/ALTV: asymptotic capture starting at `|Δh| = |VS|·τ/60`.
  - FLC: `γc = γ + V̇/g + k·(IAS − target)`; it never moves away from the selected altitude.
  - GS/GP: nominal descent + `k·(angular dev × distance)`.
  - VPATH: `fms.vs_req_fpm − k·fms.vnav_dev_ft`.
  - FLARE: `vs = −(RA/τ + 120 fpm)`.
- **Servos.** `pitch = PI(θc − θ) − Kq·q`, `roll = PI(φc − φ) − Kp_rate·p`. Gains scale with (Vref/IAS)².
  Authority and slew are limited. A sustained pitch servo offset sets `ap.trim_cmd` (trim follow-up); a large
  one for 10 s (KAP 140: 15 s) sets `ap.mistrim`.

**Automatic transitions:**

- **LNAV / VOR / LOC / BC capture.** Uses the CDI threshold or the turn lead at the bank limit.
- **Loss of the nav signal.** After 5 s the mode reverts to the default lateral mode.
- **ALTS.**
  - Arming: ALTS arms automatically in PIT/VS/FPA/FLC/VFLC/TO/GA/CWS/VPATH when moving toward the selected
    altitude (KAP 140: only with ARM on and the AP engaged).
  - Capture and hold: capture → ALTS; within `altCaptureToHoldFt` (20 ft) it becomes ALT.
  - Selected-altitude change during capture: PIT (Garmin) or VS (Boeing).
  - Boeing ALT HOLD with a new MCP altitude arms V/S.
- **VNAV.** VPATH arms and captures (Garmin: within 150 ft of the path, descent phase, selected altitude at
  least 75 ft below). ALTV arms and captures when the VNAV target is above the selected altitude; then ALT
  and VPATH are re-armed (Garmin) or VALT (Boeing). Boeing top of descent: VALT → VPATH/VFLC.
- **GS / GP capture.** At |dev| ≤ `gsCaptureDev` with LOC/LNAV active. This clears ALTS/VPATH.
- **TO / GA speed phases.** Boeing TO: 15° until 1000 fpm, then selected speed + 20 kt (V2+20). GA: pitch,
  then FLC on the selected speed above `speedAfterClimbFpm`.
- **Boeing performance reversion.** In V/S with the speed decaying more than 5 kt below MCP speed, the mode
  goes to LVL CHG.
- **Boeing autoland.**
  - With CMD A+B, APP, LOC+GS and RA < 1500 ft: dual channel (`ap.channels` = 2), FLARE armed.
  - If FLARE is not armed by 350 ft, both A/Ps disengage.
  - FLARE at 50 ft.
  - `ap.autoland` shows LAND 3 / LAND 2 / NO AUTOLAND (both ILS receivers and RA2 monitored).
  - With `autoland.rollout` true, ROLLOUT on touchdown.

**Style behavior:**

| | garmin | kap140 | boeing | honeywell/collins |
|---|---|---|---|---|
| Mode key with AP and FD off | turns the FD on | ignored | ignored | turns the FD on |
| AP engages into | ROL/PIT (or the FD modes) | ROL/VS | CWS R/CWS P (or the FD modes; TO/GA at > 400 ft RA → LVL CHG + HDG SEL, MCP speed +20 after TO) | ROL/PIT |
| Pilot override | none (CWS button) | none | CWS reversion (dual channel: disconnect) | disconnect |
| CWS | button held: servos off, references resync on release | same | force on the column → CWS; release holds the attitude (wings level below 6° → heading hold) | – |
| TOGA in the air | GA, AP off if `ga.disconnectsAp` | – | GA; single-channel AP disconnects below 2000 ft RA; second press `ap.ga_full` = 1 | GA |
| FD off with AP on | not allowed | n/a | allowed | not allowed |

**Engagement is refused** when the power or `sensors.valid` is off, `disconnect.engageInhibit` is true, or
`fail.afcs` is set. Boeing additionally refuses with a column force (|input| > 0.1).

**Automatic disconnect** (sets `ap.disc_auto` = 1) happens on:

- power or sensor loss;
- servo power (`servoPower`, per channel for Boeing A/B) or a servo failure;
- `disconnect.auto` becoming true;
- attitude beyond `disconnect.maxBankDeg`/`maxPitchDeg`;
- YD off when `yawDamper.requiredForAp`;
- the override rule.

**Pilot disconnect** sources: the AP button, DISC (`input.ap_disc`), the trim switch when `trimDisconnects`,
and GA with `disconnectsAp`.

The disconnect warning (`ap.disc_warn`) lasts `discWarningS`, or until a second DISC / DISC_RESET.

**Public API:**

```ts
press(btn: AfcsButton, payload?)   // same as emitting the event; publishes lights/FMA immediately
engage(): boolean                  // AP button logic
disengage(auto: boolean)
update(dt); reset(); dispose(); failures()
// state (read-only by convention)
engaged, channels, cmdA, cmdB, cwsA, cwsB, lat, latArmed, vert, vertArmed (ARM bits), approach,
halfBank, cwsHeld, discWarn, pitchCmd, bankCmd (NaN = no command), pitchRef, bankRef, altRef, fpaRef, trackRef,
cfg, gains, limits
```

`DEFAULT_GAINS` and `DEFAULT_LIMITS` are exported (see `AfcsGains` / `AfcsLimits` in `types.ts`).

**Buttons and events.** `AFCS_BUTTONS`: AP, FD, FD1, FD2, YD, HDG, NAV, APR, BC, ALT, VS, FLC, VNAV, LNAV,
VORLOC, APP, LVLCHG, LVL, TOGA, DISC, DISC_RESET, CWS, UP, DN, HALF_BANK, CMD_A, CMD_B, CWS_A, CWS_B, ARM,
HDG_SYNC, CRS_SYNC, SPD_MACH, ROL, PIT, FPA.

- Each button is the event `${eventPrefix}${name.toLowerCase()}` (default prefix `ap.`: `ap.hdg`, `ap.cmd_a`,
  `ap.lvlchg`, `ap.toga`, ...).
- UP/DN take `{ steps }` or a number (default 1). They adjust the active mode's reference: PIT 0.5°, VS
  100 fpm, FLC 1 kt (nose up = slower), KAP 140 ALT 20 ft; set per aircraft with `steps`.
- CWS takes `{ pressed }`.
- HDG_SYNC sets the heading bug to the current heading. CRS_SYNC sets the OBS to the bearing to the station.
  SPD_MACH toggles IAS/Mach and converts the target.
- APR/APP arms LOC + GS, or LNAV + GP when the nav source is FMS (0); Boeing APP needs an ILS.
- NAV arms LNAV (source 0), or VOR/LOC (source 1/2). VORLOC arms the radio mode only.
- Knobs write the selected-value vars (below) directly; no event is needed.

**Selected values** (initialized to 0 if missing; written by cockpit knobs): `ap.sel_hdg_deg`,
`ap.sel_alt_ft`, `ap.sel_vs_fpm`, `ap.sel_spd_kt`, `ap.sel_mach`, `ap.spd_is_mach`, `ap.fd1_on`, `ap.fd2_on`,
`ap.yd_engaged`, `ap.nav_source` (0 FMS/GPS, 1 NAV1, 2 NAV2), `ap.bank_sel_deg` (with `bankSelector`).

**Reads:**

- Sensors (configurable in `AfcsSensors`): `ahrs1.pitch_deg/bank_deg/hdg_mag_deg/p_dps/q_dps`,
  `adc1.ias_kt/mach/tas_kt/alt_ft/vs_fpm/ias_rate_kts`, `ra1.alt_ft` (+ `ra1.valid`), `gps.gs_kt`,
  `gps.trk_mag_deg` (+ `gps.valid`), `surf.flaps_deg`. Validity is
  `sensors.valid` = `'ahrs1.valid && adc1.valid'`, and `onGround` = `gear.air_ground`.
- Nav: `nav{r}.cdi`, `dev_deg`, `dist_nm`, `obs_deg`, `loc_course_deg`, `is_loc`, `received`, `gs_dev`,
  `gs_dev_deg`, `gs_valid`, `to_from`, `bearing_deg`, `bearing_valid`.
- FMS: `fms.lnav_valid`, `xtk_nm`, `dtk_mag_deg`, `lnav_bank_cmd_deg`, `vnav_valid`, `vnav_dev_ft`,
  `vnav_tgt_alt_ft`, `vs_req_fpm`, `vnav_phase` (string CLB/CRZ/DES), `vnav_tgt_speed_kt/mach`, `gp_dev`,
  `gp_valid`, `gp_angle_deg`.
- Inputs: `input.pitch/roll/pitch_trim_rate/ap_disc/toga`, `ap.at_engaged`, `ra2.valid` (autoland).

**Writes:**

- Standard `AP` group: `ap.engaged`, `ap.fd_pitch_deg`, `ap.fd_bank_deg`, and the strings `ap.lat_active`,
  `ap.lat_armed`, `ap.vert_active`, `ap.vert_armed`.
- `AFCS_VARS`:
  - Servos, forces and trim: `ap.servo_pitch/roll/yaw`, `ap.trim_cmd`, `ap.force_pitch/roll`, `ap.mistrim`.
  - Disconnect: `ap.disc_warn`, `ap.disc_auto`.
  - Status strings: `ap.status` ('', 'FD', 'AP', 'CMD', 'CWS', 'SINGLE CH') and `ap.autoland`.
  - Flare and channels: `ap.flare_armed`, `ap.flare`, `ap.channels`, `ap.cmd_a/b`, `ap.cws_a/b`.
  - References: `ap.alt_ref_ft`, `ap.pitch_ref_deg`, `ap.spd_ref_kt`, `ap.bank_ref_deg`, `ap.bank_limit_deg`,
    `ap.half_bank`.
  - Modes and FD: `ap.cws`, `ap.fd_pitch_valid`, `ap.fd_roll_valid`, `ap.lat_code`/`ap.vert_code` (index
    into `LATERAL_MODES`/`VERTICAL_MODES`), `ap.vor_os`.
  - A/T protocol: `ap.at_req`, `ap.at_spd_fms`, `ap.ga_full`, `ap.cws_reversion`.
- Button lights `ap.btn_<name>`: ap, hdg, nav, apr, app, bc, alt, vs, flc, lvlchg, vnav, lnav, vorloc,
  cmd_a, cmd_b, cws_a, cws_b, yd, fd, half_bank, lvl, to, ga, arm.
- The FD bars are hidden (`fd_*_valid` = 0) in CWS, for Boeing FLARE, and with no modes. The FMA strings
  come from `labels` and are rebuilt only on change.

**Failures:** `afcs` (computer), `afcs.servo_pitch`, `afcs.servo_roll`.

### 4.2 Modes, arm flags, types (`types.ts`)

- `LATERAL_MODES`: NONE, ROL, LVL, HDG, TRK, LNAV, VOR, LOC, BC, TO, GA, CWS, ROLLOUT.
- `VERTICAL_MODES`: NONE, PIT, LVL, ALT, ALTS (selected-altitude capture), ALTV (VNAV target capture), VS,
  FPA, FLC, VPATH, VFLC (VNAV speed), VALT (VNAV altitude hold), GS, GP, TO, GA, FLARE, CWS.
- `ARM`: ALTS 1, ALTV 2, GS 4, GP 8, VPATH 16, FLARE 32, VS 64.

`AfcsConfig` (every field except `style`, `defaults`, `labels` is optional):

| Field | Meaning |
|---|---|
| `style`, `name`, `eventPrefix` ('ap.') | |
| `power`, `servoPower` (`Binding` or `[chA, chB]`) | AFCS computer and servo power (737: `['hyd.a_psi > 1000', 'hyd.b_psi > 1000']`) |
| `sensors: Partial<AfcsSensors>` | `pitch, bank, heading, p, q, ias, mach, tas, alt, vs, ias_rate, ra, raValid, gs, track, trackValid, valid, flaps, onGround` (var names; the last few are bindings) |
| `lateralModes`, `verticalModes` | Modes offered (others ignored) |
| `defaults` | `{ apLateral, apVertical, fdLateral?, fdVertical? }` |
| `labels: AfcsLabels` | `lateral`, `vertical`, `armedLateral`, `armedVertical`, `vorApproach`, `approachLateral`, `approachArmedLateral`, `navSuffix` (appends the receiver number: LOC1/LOC2) |
| `gains: Partial<AfcsGains>` | `pitchKp, pitchKi, pitchKq, rollKp, rollKi, rollKp_rate, gainRefKt, hdgGain, pathKp, pathKi, alphaTauS, altGain, altHoldMaxVs, altCaptureTauS, flcKp, flcAccel, vorTauS, locTauS, lnavTauS, gsGain, gsMaxCorrFpm, vpathGain, cwsPitchRate, cwsRollRate` |
| `limits: Partial<AfcsLimits>` | `maxBankDeg, lowBankDeg, maxPitchUpDeg, maxPitchDownDeg, maxRollRateDps, maxPitchRateDps, maxVsFpm, rollCommand ('bank' \| 'rate'), stdRateFraction` |
| `servos` | `{ pitch?, roll?, yaw?: { authority (0.6), rate (0.5/s) } }` |
| `nav` | `{ sourceVar, defaultReceiver, vorCaptureCdi, locCaptureCdi, lnavCaptureNm, maxInterceptVorDeg (45), maxInterceptLocDeg (30), gsCaptureDev (0.2) }` |
| `vnav` | enable VNAV button |
| `to` | `{ lateral: 'LVL'\|'HDG'\|'TRK', groundPitchDeg?, rotateKt?, pitchDeg, speedAfterLiftoff?: { addKt, minClimbFpm } }` |
| `ga` | `{ lateral: 'LVL'\|'TRK'\|'HDG', pitchDeg, disconnectsAp, speedAfterClimbFpm? }` |
| `disconnect` | `{ overrideInput (0.35), overrideTimeS (0.3), overrideAction, trimDisconnects, engageInhibit, auto, maxBankDeg, maxPitchDeg }` |
| `discWarningS` | undefined = until acknowledged |
| `cws` | 'boeing' \| 'garmin' \| 'none' |
| `yawDamper` | `{ withAp?, requiredForAp? }` |
| `bankSelector`, `altsAutoArm` (true), `altCaptureToHoldFt` (20), `selAltChangeInCapture` | |
| `autoland` | `{ flareFt 50, armBelowFt 1500, secondChannelBeforeFt 800, flareArmDeadlineFt 350, rollout, flareTauS 5, touchdownVsFpm 120 }` |
| `fdAutoOn` (true), `steps`, `rollHoldMinDeg` (6), `cwsWingsLevelDeg` (6) | |

### 4.3 AFCS → autothrottle protocol (`vars.ts`)

`AtRequest` enum in `ap.at_req`:

| Value | Name | Meaning |
|---|---|---|
| 0 | None | No pitch mode needing a particular thrust mode |
| 1 | Speed | Pitch is flying a path (ALT, VS, GS, VPATH, PIT, ...): hold speed |
| 2 | Thrust | FLC/VFLC climb: climb thrust |
| 3 | Idle | FLC/VFLC descent: retard to idle |
| 4 | Retard | FLARE |
| 5 | Takeoff | TO on the ground |
| 6 | GoAround | GA |

`ap.at_spd_fms` = 1 in VNAV modes (the A/T uses `fms.vnav_tgt_speed_kt/mach`).

### 4.4 Presets (`presets.ts`)

Each is `Omit<AfcsConfig, 'power' | 'servoPower' | 'sensors' | 'gains'>`.

| Preset | Aircraft | Highlights |
|---|---|---|
| `AFCS_GFC700_G1000` | 172S G1000 NXi | ROL/PIT defaults; bank 22°/15°; pitch +20/−15; VS ±1500; TO/GA 7° wings level; GA disconnects the AP; trim switch disconnects; warning 5 s; CWS; VNAV; LNAV label 'GPS'; VAPP |
| `AFCS_GFC700_G3000` | Citation M2 | as above + LNAV 'FMS', bank 25°/15° (EST), TO 10°, GA 7.5°, YD with AP and required for AP |
| `AFCS_GFC_G5000` | Citation Longitude | G3000 + VFLC |
| `AFCS_KAP140` | 172S steam | ROL/VS on engagement; turn-rate roll axis (90 % standard rate); no FD (`fdAutoOn: false`); labels NAV/APR/REV, 'ARM' for altitude arm; UP/DN 100 fpm, ALT 20 ft |
| `AFCS_B737_AFDS` | 737-800 | CMD A/B, CWS A/B; CWS defaults; MCP bank selector (`ap.bank_sel_deg` 10–30); TO −10° to 60 kt then 15°, V2+20; GA 15° + TRK, reduced/full GA via A/T; override → CWS; dual-channel autoland (no rollout); LNAV capture 3 nm; FMA labels HDG SEL, VOR/LOC, MCP SPD, ALT ACQ, VNAV PTH/SPD, G/S, CWS P/R, TO/GA, FLARE |
| `AFCS_PRIMUS_EPIC` | G650, G800 | ROLL/PIT; ASEL/VASEL/FLCH/VPATH/VFLCH/VALT labels; bank 27/13.5 (EST); TO/GA TRK; override disconnects; YD with AP |
| `AFCS_PROLINE_FUSION` | Global 6000 | ROLL/PITCH; ALTS CAP/VALTS CAP/FLC labels; bank 25/15 (EST); trim switch disconnects |

The preset sources are cited in the `presets.ts` header (Garmin PG 190-00498, KAP 140 PG 006-18034, SmartCockpit
737 AFDS). Values marked EST must be confirmed per aircraft.

---

## 5. FADEC, engine start and autothrottle (`src/systems/fadec`)

### 5.1 `ThrustRatingComputer(env, ThrustRatingConfig)`

N1 limits per rating from `Table2D` (x = pressure altitude ft, y = temperature °C, z = N1 %) supplied by the
aircraft (AFM/QRH N1 tables).

- **Rating ids.** Any string ('TO', 'TO-1', 'CLB', 'CRZ', 'MCT', 'GA'). The A/T expects `TO` and `GA` to
  exist, since it reads `fadec.n1_to_pct` / `fadec.n1_ga_pct`.
- **Flex.** Flex ratings (default: ids starting with 'TO') use `fadec.assumed_temp_c` when it is above the
  current temperature, never dropping more than `maxFlexN1Drop` (6, EST) points below the full rating
  (AC 25-13).
- **Selection.** `select(id)`, the event `fadec.rating` (payload: the id string), or `auto`: takeoff on the
  ground; GA while `goAroundWhen`; cruise while `cruiseWhen`; climb once `climbWhen` (or after lift-off when
  no `climbWhen` is given).

| Option | Default |
|---|---|
| `ratings` | required |
| `initial` | first key |
| `altVar`, `tempVar` | `adc1.press_alt_ft`, `adc1.sat_c` |
| `flexRatings`, `maxFlexN1Drop` | ids starting with 'TO', 6 |
| `auto` | `{ takeoff, climb, cruise?, goAround?, onGround? (gear.air_ground), climbWhen?, cruiseWhen?, goAroundWhen? }` |

- **Writes:** `fadec.rating` (string), `fadec.n1_limit_pct`, `fadec.n1_<key>_pct` for every rating (`ratingVar(id)`, key = `ratingKey(id)`: 'TO-1' → `to_1`), `fadec.flex_active`. Initializes `fadec.assumed_temp_c` = −99 (no flex).
- **Events:** `fadec.rating`, `fadec.assumed_temp` (°C).
- **Public:** `selected`, `select(id)`, `n1For(id, altFt, tempC, assumedC = -99)`, `limit(id)` (current value).

### 5.2 `ThrustLeverFadec(env, ThrustLeverConfig, ratingComputer)`

Maps the thrust lever angle to an N1 command, plus idle schedules and reversers. The lever var is `ac.tla{i}`
(0 = idle, 1 = full forward). Values −1..0 are the reverse range for integral reverse gates; the 737's
piggy-back levers use `reverseLeverVar` (0..1) instead.

- **Law `{ kind: 'linear', maxRating }`** (737NG): N1 = idle + (limit(maxRating) − idle)·lever.
- **Law `{ kind: 'detent', detents: [{ lever, rating, label }] }`** (Citation, Gulfstream, Global): rating
  detents, interpolated between them, rising linearly from idle below the first detent.
- **Idle.** `ground` / `flight` / `approach` (while `approachWhen`), each a `Schedule` vs pressure altitude.
  `onGround` defaults to `gear.air_ground`.
- **Reverse.** `{ maxN1, deployS, stowS, power?, interlock? (gear.air_ground) }`. N1 stays at idle until the
  sleeve is 90 % deployed. REV UNLKD while in transit, REV when deployed.

Other options: `engines: number[]`, `leverVar(e)`, `reverseLeverVar(e)`, `power(e)` (FADEC channel),
`altVar` (`adc1.press_alt_ft`).

- **Writes per engine:** `eng{i}.n1_cmd_pct`, `eng{i}.reverser_pos`, `fadec.eng{i}.n1_target`, `fadec.eng{i}.lever`, `fadec.eng{i}.detent` (string IDLE/CRU/CLB/TO/REV/...), `fadec.eng{i}.idle_mode` (0 ground, 1 flight, 2 approach), `fadec.eng{i}.rev_unlocked`, `fadec.eng{i}.rev_deployed`.
- **Failures:** `fadec.eng{i}` (command frozen), `rev.eng{i}` (will not deploy), `rev.eng{i}.uncmd` (uncommanded deployment).
- **Public:** `idleN1(altFt, onGround)`, `forwardN1(lever, idle)`, `idleMode`, `detentLabel`.

### 5.3 `EngineStartController(env, EngineStartConfig)`: one per engine

`StartState` enum: Off 0, Motoring 1, Fuel 2, Accel 3, Running 4, Abort 5, ManualStart 6. The status strings
are OFF, MOTORING, LIGHT-OFF, ACCEL, RUN, ABORT, START.

**Automatic start** (bizjets):

1. START press (rising edge; `startKind: 'held'` = level) → motoring with igniters.
2. Fuel on at `fuelOnN2Pct` with the run lever at RUN.
3. Light-off expected within `lightOffTimeoutS` (10).
4. Starter and igniters cut out at `starterCutoutN2Pct`.
5. RUN at 98 % of `idleN2Pct` (or `eng{i}.running`).

Auto-abort cases:

| Case | Condition |
|---|---|
| HOT | ITT over `hotStartIttC`, or predicted over it within 2 s |
| HUNG | N2 gains less than 1 % in `hungWindowS` (10) |
| NO LIGHT | No light-off within the timeout |
| STARTER | Starter engaged longer than `maxStarterS` (120) |

An abort shuts off fuel and ignition, then motors for `clearingMotorS` (15).

**Manual start** (`manual: true`; 737 GRD start): the starter follows the switch, and fuel follows the run
lever directly. At cut-out the controller writes `releaseSwitch.offValue` to `releaseSwitch.var` (the GRD
solenoid releases to OFF). There is no auto-abort.

**Running:** fuel = run lever. Ignition comes from `continuousIgnition`, or from auto relight after an
in-flight flameout.

Options: `engine`, `startSwitch`, `startKind`, `releaseSwitch`, `runLever`, `manual`, `stopSwitch`,
`fuelOnN2Pct`, `starterCutoutN2Pct`, `idleN2Pct`, `hotStartIttC`, `lightOffTimeoutS`, `hungWindowS`,
`maxStarterS`, `clearingMotorS`, `starterAvailable`, `ignitionPower`, `continuousIgnition`, `autoRelight`
(true), `onGround`, `starterVar` (`fadec.eng{i}.starter_cmd`), `ignitionVar` (`eng{i}.ignition`),
`fuelCmdVar` (`fadec.eng{i}.fuel_cmd`).

- **Wiring.** Feed `fadec.eng{i}.starter_cmd` into the systems-power starter block (or set `starterVar: 'eng{i}.starter'` when there is no starter model). Feed `fadec.eng{i}.fuel_cmd` into the FuelSystem consumer's `run` binding; never write `eng{i}.fuel_on`.
- **Writes:** the three outputs, `fadec.eng{i}.start_state`, `start_status` (string), `abort`, `abort_reason` (string HOT/HUNG/NO LIGHT/STARTER), `starter_s`.
- **Reads:** `eng{i}.n2_pct`, `eng{i}.itt_c`, `eng{i}.running`.
- **Failures:** `start.eng{i}.valve`, `start.eng{i}.ign`.
- **Public:** `state`, `abortReason`.

### 5.4 `Autothrottle(env, AutothrottleConfig)`

A servo-driven thrust-lever A/T: the cockpit lever vars move. The servo reads the current lever each step,
so the pilot can always override by moving the lever. `AtMode` enum: Off 0, Arm 1, Speed 2, Thrust 3,
Retard 4, Idle 5, Hold 6, Takeoff 7, GoAround 8.

**`style: 'boeing'`** (737NG):

- **ARM switch.** `ac.at_arm` (magnetically held; released to 0 on disengagement) arms the A/T in mode ARM.
- **Modes from `ap.at_req`.**
  - Thrust → N1 (climb limit).
  - Idle → RETARD, then ARM at the aft stop.
  - Speed → MCP SPD or FMC SPD.
  - Retard → RETARD at 27 ft RA or 2.5 s after FLARE; it disengages 2 s after touchdown.
  - Any approach with flaps ≥ 15 retards at 27 ft.
- **Buttons.** `at.n1` and `at.spd` select N1 / SPEED; pressing the active one → ARM.
- **Takeoff.** TO/GA on the ground → N1 (takeoff limit); THR HLD at 84 kt until 800 ft RA; then ARM.
- **Go-around.** Armed below 2000 ft RA. The first press gives reduced GA thrust (1500 fpm climb target); the
  second press (`ap.ga_full`) gives full GA N1.
- **Disconnect.** `at.disc` gives flashing red lights until a second press or `at.disc_reset`.
- **Speed warning.** `at.spd_warn` flashes amber when the speed is not held within +10/−5 kt with flaps
  extended.

**`style: 'bizjet'`** (G5000, Primus Epic, Pro Line Fusion AT):

- **Engage.** `at.engage` toggles; the default mode is SPD.
- **Takeoff.** TOGA on the ground → TO; HOLD at 60 kt (EST); climb thrust at 400 ft.
- **Descent.** IDLE, then HOLD at the aft stop.
- **FLC climb.** CLB.
- **Disconnect warning.** 5 s (EST).

**Laws.**

- **SPD.** Lever rate = `speedKp·err − speedKd·accel`, limited to `servoRate`. It never advances beyond the N1
  limit.
- **N1.** Per-engine lever rate = `n1Gain·(N1tgt − N1)`.
- **Speed target.** From `ap.sel_spd_kt` / `ap.sel_mach` / `ap.spd_is_mach`, or from FMS when
  `ap.at_spd_fms`. Limited by Vmo/Mmo when `vmoKt`/`mmo` are given.

| Option | Default |
|---|---|
| `engines`, `style` | required, 'bizjet' |
| `leverVar(e)`, `leverRange` | `ac.tla{e}`, `[0, 1]` |
| `servoRate`, `retardRate` | 0.15, 0.12 lever/s (EST) |
| `power`, `armVar` | true, `ac.at_arm` |
| `speedKp`, `speedKd`, `n1Gain` | 0.02, 0.08, 0.03 (EST) |
| `thrHoldKt`, `thrHoldEndFt` | boeing 84 / 800, bizjet 60 / 400 |
| `retardFt`, `retardFlapsDeg`, `disengageAfterTouchdownS` | 27, 15, 2 |
| `gaArmBelowFt`, `reducedGaVsFpm` | 2000, 1500 |
| `discWarnS` | boeing until reset, bizjet 5 |
| `labels` | override the FMA strings (`AtModeName` → text) |
| `vmoKt`, `mmo` | none |

- **Reads:** lever vars, `ap.at_req`, `ap.at_spd_fms`, `ap.sel_spd_kt`, `ap.sel_mach`, `ap.spd_is_mach`, `fms.vnav_tgt_speed_kt/mach`, `ap.flare`, `ap.ga_full`, `adc1.ias_kt/mach/ias_rate_kts`, `eng{i}.n1_pct`, `fadec.n1_limit_pct`, `fadec.n1_to_pct`, `fadec.n1_ga_pct`, `ra1.alt_ft`, `adc1.vs_fpm`, `gear.air_ground`, `surf.flaps_deg`.
- **Writes:** lever vars (servo), `ap.at_engaged`, `ap.at_mode` (string FMA), `at.mode_code`, `at.armed`, `at.disc_warn`, `at.spd_warn`, `at.target_kt`, `at.n1_target`, `at.servo_active`, `ap.btn_n1`, `ap.btn_spd`, and the ARM switch var (Boeing release).
- **Events:** `at.engage`, `at.disc`, `at.disc_reset`, `at.n1`, `at.spd`.
- **Public:** `mode`, `engaged`, `pressEngage()`, `pressDisconnect()`, `pressMode(AtMode.Thrust | AtMode.Speed)`, `clearWarning()`, `disengage(warning)`.
- **Failure:** `at`.
- **Aural:** `DisconnectAlerts` (§7.9) sounds the tone.

When a hardware throttle axis is bound (`input.throttle_axis_bound`), the cockpit lever follows the hardware,
so the aircraft should disengage the A/T or ignore the axis while it is engaged (see the open issues).

---

## 6. Landing gear and brakes (`src/systems/gear`)

### 6.1 `LandingGear(env, LandingGearConfig)`

Every aircraft needs one. Fixed-gear aircraft use `retractable: false`, because this block produces the
debounced air/ground signal `gear.air_ground` that most blocks default to.

- **Legs.** `legs: [{ index (0 nose, 1 left, 2 right), name?, extendS, retractS, freefallS? (1.3 × extendS) }]`.
  Travel rate scales with `actuation.power` (0..1) above `minPower` (0.3). Unpowered, an unlocked leg falls
  in `freefallS`; an up-locked leg stays up.
- **Handle.** `handleVar` (`ac.gear_handle`): 1 = DN, 0 = UP, `handleOffValue` = OFF (737: pressure removed).
- **Handle lock.** On the ground the lock solenoid holds the handle down (`gear.handle_lock` = 1; the cockpit
  GearHandle `inhibit` reads it) unless `handleLock.overrideVar` is set.
- **Ground retract inhibit.** `groundRetractInhibit` stops retraction on the ground even with the handle up.
- **Doors.** `{ openS, closeS }` open before and close after the legs travel.
- **Alternate extension.** `{ kind, trigger, blowdownS?, strokes? }`:
  - `'freefall'`: 737 manual extension handles.
  - `'blowdown'`: pneumatic bottle, one shot (`gear.blowdown_used`), no retraction afterwards (Citation).
  - `'handpump'`: event `gear.hand_pump` per stroke, `strokes` (40) for a full extension.
- **Squat.** `{ legs?, mode 'any'|'all', airToGroundS 0.1, groundToAirS 0.5 }`, read from the FDM `gear.wow{i}`.
- **Horn.** `{ rules: GearHornRule[], tone? ('gear_horn') }`. Rules are evaluated while the gear is not all
  down and locked. A silenceable rule is muted by the event `gear.horn_silence` until its condition clears.
- **Lights.** `{ power?, test? (alert.annun_test) }`. Green = down and locked. Red = not in agreement with the
  handle, or not down while a horn condition exists, or disagree.
- **Other options.** `disagreeS` (default 1.5 × the longest travel + 1), `initialDown` (true).

- **Writes:** `gear.pos{i}`, `gear.green{i}`, `gear.red{i}`, `gear.squat{i}`, `gear.air_ground`, `gear.down_locked`, `gear.up_locked`, `gear.transit`, `gear.moving`, `gear.doors`, `gear.handle_down`, `gear.handle_lock`, `gear.disagree`, `gear.horn`, `gear.unsafe`, `gear.blowdown_used`, `alert.gear_warning`.
- **Events:** `gear.horn_silence`, `gear.hand_pump`.
- **Failures:** `gear.actuation`, `gear.leg{i}.jam`, `gear.leg{i}.uplock`, `gear.squat{i}` (stuck in AIR).
- **Public:** `legs`, `doors`, `onGround`, `blowdownUsed`, `setDown(down)` (applyState), `reset()`, `dispose()`.

Horn rule helpers (`gear/presets.ts`, each returns `GearHornRule[]`):

- `gearHornRules({ throttleRetarded, lowAltitude, flapsVar?, approachFlapsDeg, landingFlapsDeg })`:
  transport three tiers (737: retarded + RA < 800 ft silenceable; flaps 15 + retarded not silenceable;
  flaps 25+ always).
- `gearHornRulesSimple({ throttleRetarded, lowAltitude, flapsVar?, landingFlapsDeg })`.

### 6.2 `Brakes(env, BrakeConfig)`

- **Pressure.** Demand = max(toe pedal, parking, autobrake, emergency) × `maxPsi`, limited by the first
  source with pressure ≥ `minSourcePsi` (1000, EST), else the accumulator. The 737 order is system B, then
  system A, then the accumulator.
- **Anti-skid** (per side, on sources flagged `antiskid`). Slip = 1 − wheel / reference (`gps.gs_kt`). Above
  `slipThreshold` the pressure is released; locked-wheel protection applies below 30 %; there is touchdown
  protection (no pressure in the air until spin-up or 3 s after touchdown).
- **Autobrake** (737NG levels in `AUTOBRAKE_737NG`: RTO −1, OFF 0, 1 = 4, 2 = 5, 3 = 7.2, MAX = 14 ft/s²
  (12 below 80 kt); flaps2approach, quoting the FCOM).
  - Arming: a landing setting selected in the air arms; selected on the ground, it arms after lift-off.
  - Activation: at wheel spin-up (`spinupKt` 60) with the thrust levers idle.
  - Disarm: OFF, pedals > `pedalDisarm` (0.25), speedbrake lever moved to DOWN (edge), or thrust advanced
    while active (except in the first 3 s).
  - RTO: armed on the ground; applies max pressure if the levers are retarded above `rtoSpeedKt` (90 kt);
    disarms at lift-off.
  - The disarm light flashes 2 s on a disarm and stays on for `fail.autobrake`.
  - Control: PI on deceleration.
- **Parking brake.** `{ var ('ac.parking_brake'), kind: 'hydraulic' (accumulator) | 'mechanical' }`.
- **Accumulator.** `{ chargeFrom, prechargePsi, maxPsi, applications (6, EST), antiskid (true) }`.
- **Emergency brake.** `{ var, pressurePsi? }` (Citation pneumatic; no anti-skid).
- **Temperatures.** `{ heatCapacityJPerK, coolingTauS?, mu? }` (from kinetic energy).

`BrakeSourceDef { id, pressurePsi: Binding, antiskid? (true), autobrake? (first source only) }`.
`AutobrakeConfig { selectorVar ('ac.autobrake_sel'), offValue (0), levels: AutobrakeLevel[], thrustIdle, thrustAdvanced?, speedbrakeDown?, pedalDisarm, rtoSpeedKt, spinupKt, armAfterTouchdownKt (30), maxPsi? }`.
`AutobrakeLevel { value, label, decelFps2?, decelLowFps2?, lowSpeedKt?, rto? }`.
`antiskid { enabled: Binding, wheels? ({ left: [gear.wheel_speed1_kt], right: [gear.wheel_speed2_kt] }), referenceVar?, slipThreshold?, releaseRate?, reapplyRate?, minSpeedKt? }`.
Other options: `pedals { left?, right? }` (`input.brake_left/right`), `onGround` (`gear.air_ground`).

- **Writes:** `gear.brake_left/right` (0..1 of maxPsi, after anti-skid), `brakes.psi_left/right`, `brakes.accum_psi`, `brakes.source` (index, −1 accumulator, −2 none), `brakes.parking_set`, `brakes.antiskid_inop`, `brakes.antiskid_left/right`, `brakes.autobrake_armed`, `brakes.autobrake_active`, `brakes.autobrake_mode` (string), `brakes.ab_disarm`, `brakes.decel_fps2`, `brakes.temp_left_c/right_c`.
- **Failures:** `brakes.left`, `brakes.right`, `brakes.antiskid`, `autobrake`.
- **Exported constant:** `KTS_TO_FPS2`.

---

## 7. Warning and alerting (`src/systems/warning`)

### 7.1 `FlightPhase(env, FlightPhaseConfig = {})`

This is not a Subsystem by itself; `CasManager` owns one (`cas.phase`). Phases (`FLIGHT_PHASES`): GROUND,
TAKEOFF, CLIMB, CRUISE, DESCENT, APPROACH, LANDING, ROLLOUT.

- **Takeoff inhibit:** from 80 kt until 400 ft RA or 30 s after lift-off.
- **Landing inhibit:** from 200 ft RA until 75 kt.
- Both are overridable (`takeoffInhibit { fromKt, toFt, maxAfterLiftoffS }`,
  `landingInhibit { belowFt, untilKt }`); the source is the 777 FCOM, EST for other types.

Other options: `iasVar`, `raVar`, `vsVar`, `onGround`, `gearDown` (`gear.down_locked`), `takeoffKt`, `climbFt`,
`approachFt`, `taxiKt`. Writes `cas.phase` (string), `cas.phase_code`, `cas.to_inhibit`, `cas.ldg_inhibit`.
Public: `phase`, `takeoffInhibit`, `landingInhibit`, `update(dt)`.

### 7.2 `CasManager(env, CasConfig)`: CAS / EICAS logic

`CasMessageDef { id, text, level: 'warning'|'caution'|'advisory'|'status', when: Binding, delayS?, inhibit?:
'takeoff'|'landing'|'takeoff+landing'|FlightPhaseName[], latch?, master? (warning/caution), aural?: {
callout?, tone?, priority?, repeatS? } }`.

- **Posting.** A message posts when `when` holds for `delayS`. An inhibited message posts when the inhibit
  ends if still true. `latch` keeps it posted until acknowledged.
- **Master lights.** `alert.master_warning` / `alert.master_caution` stay lit while any posted message of that
  level is unacknowledged. Events `cas.ack_warning`, `cas.ack_caution`, `cas.ack` (both) acknowledge.
- **Aurals.** The warning tone (`warningTone`, 'master_warning') plays while the master WARNING is lit. The
  caution chime (`cautionChime`, 'master_caution') plays once per new caution. Voices repeat every `repeatS`
  while unacknowledged.
- **Display order.** Warnings, cautions, advisories, status; newest first within a level.
- **Other options.** `power`, `phase` (FlightPhaseConfig), `lampTest` (`alert.annun_test`), `sinks`
  (anything with `define(id, text, level) / setActive(id, on) / acknowledge(level?)`: the avionics
  `CasWindow` model).

- **Writes:** `alert.master_warning`, `alert.master_caution`, `cas.<id>` (1 while posted), `cas.warning_count`, `cas.caution_count`, `cas.advisory_count`, `cas.status_count`, `cas.unacked_warnings`, `cas.unacked_cautions`, `cas.inhibited_count`, plus the FlightPhase vars.
- **Public:** `phase: FlightPhase`, `define(def)`, `addSink(sink)`, `list` (readonly ordered `CasEntry[] { id, text, level, active, acknowledged, inhibited, seq }`, reused), `isActive(id)`, `acknowledge(level?)`, `acknowledgeAll()`, `unackedWarnings`.

### 7.3 `AltitudeAlert(env, AltitudeAlertConfig = ALT_ALERT_GFC700)`

`alt.alert` states: 0 idle, 1 approaching (inside `approachFt`), 2 captured (inside `captureFt`), 3 deviation
(left `deviationFt` after capture). A new selected altitude re-initializes silently.

Presets:

- `ALT_ALERT_GFC700`: 1000/200/200, tone on approach and deviation.
- `ALT_ALERT_KAP140`: same bands (the KAP 140 ALERT lamp logic).
- `ALT_ALERT_737NG`: 750/200/200, tone on deviation only. Use `inhibit: 'surf.flaps_deg >= 25 || ap.vert_code == 12'`
  (12 = `VERTICAL_MODES.indexOf('GS')`, i.e. G/S captured).

Options: `approachFt`, `captureFt`, `deviationFt`, `selectedVar` (`ap.sel_alt_ft`), `altVar` (`adc1.alt_ft`),
`power`, `inhibit`, `toneOn`, `tone` ('alt_alert', played via `audio.play`), `voice { approach?, deviation? }`,
`flashS`.

Writes `alt.alert`, `alt.alert_flash`, `alt.alert_light` (lamp state including the flash phase). Public `state`.

### 7.4 `MinimumsMonitor(env, MinimumsConfig = {})`

Baro (MDA) or radio (DH) minimums come from `ap.mins{side}_ft` / `ap.mins{side}_is_ra`.

- Arms when more than `armAboveFt` above the minimums.
- Optional "APPROACHING MINIMUMS" at +`approachingFt`.
- "MINIMUMS" at the minimums.
- Re-arms `resetAboveFt` above.

Options: `side` (1), `raVar`, `baroVar`, `minimumsCallout` ('MINIMUMS'; '' = off), `approachingCallout` ('' =
off), `power`. Writes `alert.minimums`, `alert.mins_approaching`. Public `reached`.

`Taws` contains one unless `minimums: false`. Instantiate a standalone monitor only without TAWS (172 steam).

### 7.5 `Taws(env, TawsConfig = {})`: TAWS-A / EGPWS and TAWS-B

**Class 'A'** (G650, G800, Global, 737, Longitude) has:

- modes 1, 2A/2B, 3, 4A/4B/4C, 5 and 6 (callouts, minimums, bank angle);
- FLTA and PDA.

**Class 'B'** (G1000 172S, G3000 M2) has:

- FLTA and PDA;
- mode 1, mode 3;
- the "FIVE HUNDRED" callout.

Heights come from the RA when valid. Otherwise they are GPS altitude minus `world.elevationAt` (for aircraft
without an RA).

- **FLTA** (needs `env.world`; `env.nav` is used for the nearest-airport phase). The path is projected along
  the GPS track. Required clearance by phase follows TSO-C151c Table 3.1.1: enroute 700/500 ft, terminal
  350/300 ft, approach 150/100 ft, departure 100 ft. CAUTION TERRAIN within `cautionS` (60); TERRAIN AHEAD
  PULL UP within `warningS` (30).
- **PDA** (EST): within 10 nm of a runway, descending, configured, more than 50 % below a 3° path.
- **Aural priority** (MK V/VII): PULL UP, TERRAIN, MINIMUMS, CAUTION TERRAIN, TOO LOW TERRAIN, callouts, TOO
  LOW GEAR/FLAPS, SINK RATE, DON'T SINK, GLIDESLOPE, BANK ANGLE.
- **Events:** `taws.gs_cancel` (below 2000 ft RA), `taws.test` (on the ground: lamps for 6 s and voices).

| Option | Default |
|---|---|
| `class` | 'A' |
| `power` | true |
| `raVar`, `raValid` | `ra1.alt_ft`, `ra1.valid` |
| `baroAltVar`, `vsVar`, `iasVar`, `bankVar` | `adc1.alt_ft`, `adc1.vs_fpm`, `adc1.ias_kt`, `ahrs1.bank_deg` |
| `gsDevVar`, `gsValid`, `backCourse` | `nav1.gs_dev`, `nav1.gs_valid && nav1.is_loc`, `nav1.back_course` |
| `apEngaged`, `gearDown`, `flapsLanding`, `flapsDown`, `onGround` | `ap.engaged`, `gear.down_locked`, `surf.flaps_deg >= 25`, `surf.flaps_deg >= 1`, `gear.air_ground` |
| `mode2Airspeeds` | [220, 310] |
| `mode4` | `{ a: MODE4A_TURBOFAN, b: MODE4B_TURBOFAN }` |
| `callouts` | `{ heights (A: CALLOUTS_737NG = 2500, 1000, 500, 100, 50, 40, 30, 20, 10; B: CALLOUTS_TAWS_B = 500), words? (CALLOUT_WORDS), smart500? }` or false |
| `minimums` | `MinimumsConfig` or false |
| `bankAngle` | on for class A |
| `flta` | `{ enabled, cautionS 60, warningS 30, samples, terminalNm, approachNm }` or false |
| `pda` | true |
| `inhibits` | `{ gpws, terrain, flapOverride, gearOverride, steepApproach }` (cockpit inhibit switches) |
| `voices` | override `TAWS_VOICES_HONEYWELL` texts |

- **Writes:** `alert.taws_warning`, `alert.taws_caution`, `taws.mode1` (0/1 sink rate/2 pull up), `taws.mode2`, `taws.mode3`, `taws.mode4` (0/1 gear/2 flaps/3 terrain), `taws.mode5`, `taws.bank`, `taws.flta` (0/1/2), `taws.pda`, `taws.gs_light`, `taws.gs_cancel`, `taws.alert` (string), `taws.callout` (string), `taws.inop`, `taws.terr_inop`, `taws.test`, `taws.height_ft`, `taws.closure_fpm`, plus the MinimumsMonitor vars.
- **Failure:** `taws`.
- **Public:** `alert`, `minimums`.

**`egpwsEnvelopes.ts`** (pure functions, Honeywell MK V–VIII envelopes; points cited in the file):

```ts
mode1SinkRate(raFt, vsFpm, biasFpm = 0): boolean
mode1PullUp(raFt, vsFpm, biasFpm = 0): boolean
mode1GsBias(gsDotsBelow, raFt): number
mode2AUpperLimit(iasKt, airspeed1 = 220, airspeed2 = 310): number
mode2A(raFt, closureFpm, iasKt, airspeed1?, airspeed2?): boolean
mode2B(raFt, closureFpm, flapsLanding, baroRateFpm): boolean
limitClosureRate(raRateFpm, gsWithin2Dots, gearDown, flapsDown): number
mode3AllowedLoss(raFt): number
interface Mode4Envelope { lowKt, highKt, lowFt, maxFt }; MODE4A_TURBOFAN (190/250/500/1000), MODE4B_TURBOFAN (159/250/245/1000)
mode4(raFt, iasKt, env): 0 | 1 | 2
mode5(raFt, dotsBelow): 0 | 1 | 2
bankAngleLimit(raFt, apEngaged, raValid = true): number
fltaRequiredClearance(phase: 'enroute'|'terminal'|'approach'|'departure', descending): number
```

### 7.6 `StallWarning(env, StallWarningConfig)`

- **`kind: 'horn'`** (172S reed horn, no power). Sounds when `fdm.stall_warning` ≥ `hornThreshold` (0.3).
- **`kind: 'aoa'`** (SPC / SWPS). `aoa_norm = α(adc{s}.aoa_deg) / alphaStall(flaps)` with phase advance
  (`phaseAdvanceS` 0.3). The stick shaker fires above `shakerNorm` (0.85, EST). The optional pusher
  (`pusher: { enabled?, norm 0.95, command −0.35 }`) holds `stall.pusher_cmd` until the AoA falls below the
  shaker threshold. Inhibited on the ground.

Options: `aoaVar` (`adc1.aoa_deg`), `alphaStall` (required for 'aoa'), `flapsVar`, `power`, `test`,
`onGround`, `hornTone` ('stall_horn'), `shakerTone` ('stick_shaker').

Writes `alert.stick_shaker`, `alert.stall_horn`, `stall.aoa_norm` (for the PLI / AoA gauge), `stall.warning`,
`stall.pusher_cmd`, `stall.pusher_active`. Failures `stall.warn`, `stall.pusher`. Public `aoaNorm`.

### 7.7 `Overspeed(env, OverspeedConfig)`

The warning is on at IAS > Vmo(`Schedule` vs pressure altitude) + `marginKt`, or Mach > Mmo + `marginMach`,
with hysteresis.

- Gear placard: IAS > `vleKt` with the gear not up and locked.
- Flaps placard: `flaps.overspeed`.
- Tone: 'overspeed' (clacker).

Options: `vmoKt` (required), `mmo`, `marginKt` (0), `marginMach` (0), `vleKt`, `gearUpLocked`
(`gear.up_locked`), `power`, `test`, `iasVar`, `machVar`, `altVar`, `tone`.

Writes `alert.overspeed`, `overspeed.vmo_kt` (the lower of Vmo and the IAS equivalent of Mmo: red barber
pole), `overspeed.gear`, `overspeed.flaps`. Public `active`.

### 7.8 `TakeoffConfigWarning(env, { checks, armed, power?, tone? ('takeoff_config'), voiceRepeatS? })`

`checks: [{ id, bad: Binding, text, voice? }]` (flaps outside the takeoff range, `trim.pitch_to_ok == 0`,
speedbrake not down, parking brake set, ...). While `armed` (takeoff thrust on the ground) any failing check
sounds the horn and/or its voice. Writes `alert.takeoff_config`, `tocw.<id>`, `tocw.text` (string).

### 7.9 `DisconnectAlerts(env, DisconnectAlertsConfig = {})`

Aurals for `ap.disc_warn` / `at.disc_warn`:

- the 'ap_disconnect' tone for at most `apToneMaxS` (default Infinity = while the var is set; Garmin about
  1.5–2 s, KAP 140 2 s);
- the 'at_disconnect' tone for at most `atToneMaxS` (3);
- optional `apVoice`.

Other options: `apTone`, `atTone`, `apWarnVar`, `atWarnVar`. Writes `alert.ap_disc_aural`,
`alert.at_disc_aural`.

### 7.10 `Tcas(env, TcasConfig = {})`

TCAS II v7.1 thresholds (`TCAS_SENSITIVITY`; SL2–SL7 from the FAA "Introduction to TCAS II v7.1").

- Mode from `xpdr.mode`: 4 TA ONLY, 5 TA/RA.
- RAs are inhibited below 1000 ft AGL; descend RAs below 1100 ft.
- Proximate traffic: within 6 nm / ±1200 ft.
- Aurals: TRAFFIC TRAFFIC, CLIMB, DESCEND, CLEAR OF CONFLICT.

Traffic comes from a pluggable `TrafficSource { targets(): readonly TrafficTarget[] }`, where
`TrafficTarget` is `{ id, lat, lon, altFt, vsFpm }`. It is set via `cfg.source` or the public `source`
field. Without a source TCAS runs and shows nothing.

Options: `source`, `power`, `modeVar`, `rangeNm` (40), `maxThreats` (30), `ownAltVar`
(`adc1.press_alt_ft`), `ownVsVar`, `raVar`, `headingVar`.

- **Writes:** `tcas.ta` (count), `tcas.ra`, `tcas.ra_sense` (+1 climb / −1 descend), `tcas.ra_vs_min_fpm`, `tcas.ra_vs_max_fpm`, `tcas.status` (string TCAS OFF / TA ONLY / TA/RA / TCAS FAIL), `tcas.sl`, `tcas.count`.
- **Displays** read `threats: TcasThreat[] { id, relBrgDeg, rangeNm, relAltFt, vsSign, level (0 other, 1 proximate, 2 TA, 3 RA) }` (a reused array).
- **Static:** `Tcas.sensitivity(altMslFt, aglFt)`.
- **Failure:** `tcas`.

---

## 8. Wiring examples

These are illustrative skeletons. The numbers are placeholders; every aircraft number must be cited or marked
`// EST:` in the aircraft code (CLAUDE.md). `ctx` is the `SimContext`.

### 8.1 Cessna 172S, steam gauges + KAP 140

```ts
import { AirDataComputer, Ahrs, VacuumSystem } from '@/systems/sensors';
import { MechanicalFlightControls, TrimAxis, Flaps, NosewheelSteering } from '@/systems/flightcontrols';
import { Afcs, AFCS_KAP140 } from '@/systems/autopilot';
import { LandingGear, Brakes } from '@/systems/gear';
import { StallWarning, AltitudeAlert, ALT_ALERT_KAP140, DisconnectAlerts } from '@/systems/warning';

const adc = new AirDataComputer(ctx, { index: 1,                       // pneumatic: no power, always valid
  iasFromCas: POH_KIAS_VS_KCAS,                                        // POH airspeed calibration (inverse)
  alternateStatic: { active: 'ac.alt_static', errorPa: ALT_STATIC_ERR } });
// KAP 140 has its own rate/acceleration sensors (turn coordinator gyro + accelerometer): model them as a
// hidden AHRS on index 9 powered by the autopilot breaker, and point the AFCS at it.
const kapSensors = new Ahrs(ctx, { index: 9, power: 'elec.ap_powered', alignS: 3, hdgAlignS: 0 });
const vacuum = new VacuumSystem(ctx, {});                              // eng1.vacuum_inhg from physics
const gear = new LandingGear(ctx, { retractable: false, legs: [{ index: 0, extendS: 1, retractS: 1 },
  { index: 1, extendS: 1, retractS: 1 }, { index: 2, extendS: 1, retractS: 1 }] });
const fcs = new MechanicalFlightControls(ctx, {});                     // cables: no actuators
const trim = new TrimAxis(ctx, { axis: 'pitch', range: [-1, 1],        // trim wheel writes trim.pitch_units
  autopilot: { rate: KAP_TRIM_RATE, power: 'elec.ap_powered' } });     // KAP 140 pitch trim servo
const flaps = new Flaps(ctx, { detents: [{ lever: 0, flapDeg: 0 }, { lever: 1, flapDeg: 10, vfe: 110 },
  { lever: 2, flapDeg: 20, vfe: 85 }, { lever: 3, flapDeg: 30, vfe: 85 }],
  normal: { power: 'elec.flap_motor_powered', rateDegPerS: FLAP_RATE } });
const afcs = new Afcs(ctx, { ...AFCS_KAP140, power: 'elec.ap_powered',
  sensors: { pitch: 'ahrs9.pitch_deg', bank: 'ahrs9.bank_deg', p: 'ahrs9.p_dps', q: 'ahrs9.q_dps',
             heading: 'ac.dg.hdg_deg' /* ANALOG_VARS.dgHeadingOut: bug error vs the DG */, valid: 'ahrs9.att_valid' } });
const stall = new StallWarning(ctx, { kind: 'horn' });
const steer = new NosewheelSteering(ctx, { pedals: { maxDeg: 10 } });  // 172S POH §7 (±10°, ±30° with brakes)
const brakes = new Brakes(ctx, { sources: [{ id: 'master', pressurePsi: 1000 }], maxPsi: 1000, minSourcePsi: 0,
  parking: { kind: 'mechanical' } });                                // master cylinders: always available
// systems: [adc, kapSensors, vacuum, gear, afcs, stall, fcs, trim, flaps, steer, brakes,
//           new AltitudeAlert(ctx, ALT_ALERT_KAP140), new DisconnectAlerts(ctx, { apToneMaxS: 2 })]
```

Cockpit wiring: the KAP 140 buttons emit `ap.ap`, `ap.hdg`, `ap.nav`, `ap.apr`, `ap.bc` (REV), `ap.alt`,
`ap.up`, `ap.dn`, `ap.arm`. The baro knob writes `adc1.baro_inhg`. The yoke AP DISC button sets
`input.ap_disc`. The flap lever writes `ac.flap_lever` (0..3).

### 8.2 Cessna 172S G1000 NXi (GFC 700)

As above, with these changes:

- Replace the KAP 140 sensors with `new AirDataComputer(ctx, { index: 1, power: 'elec.adc_powered' })` (GDC 74)
  and `new Ahrs(ctx, { index: 1, power: 'elec.ahrs_powered' })` (GRS 79).
- Build the AFCS as `new Afcs(ctx, { ...AFCS_GFC700_G1000, power: 'elec.afcs_powered' })` (default sensors).
- Add `new Taws(ctx, { class: 'B', minimums: {} })` (the NXi has no RA, so heights come from GPS minus
  terrain).
- Use `AltitudeAlert(ctx, ALT_ALERT_GFC700)` and a `CasManager` with the NXi annunciations (LOW VACUUM, LOW
  FUEL L/R, OIL PRESSURE, LOW VOLTS, ...), with sinks = the PFD `CasWindow` model.

Buttons: AP, FD, HDG, NAV, APR, VS, FLC, ALT, VNV (`ap.vnav`), NOSE UP/DN (`ap.up`/`ap.dn`), CWS (hold:
`{ pressed }`), TOGA (`input.toga` or `ap.toga`), LVL (`ap.lvl`). The CDI softkey writes `ap.nav_source`.

### 8.3 Boeing 737-800 (NG)

```ts
const adc1 = new AirDataComputer(ctx, { index: 1, power: 'elec.ac_xfr1_powered', trendS: 10 });
const adc2 = new AirDataComputer(ctx, { index: 2, power: 'elec.ac_xfr2_powered', trendS: 10 });
const irs1 = new Irs(ctx, { index: 1, power: 'elec.ac_xfr1_powered', dcBackup: 'elec.hot_bat_powered' });
const irs2 = new Irs(ctx, { index: 2, power: 'elec.ac_xfr2_powered', dcBackup: 'elec.hot_bat_powered' });
const ra1 = new RadioAltimeter(ctx, { index: 1 }), ra2 = new RadioAltimeter(ctx, { index: 2 });
const A = 'clamp01(hyd.a_psi / 2800)', B = 'clamp01(hyd.b_psi / 2800)', S = 'clamp01(hyd.stby_psi / 2800)';
const fcs = new MechanicalFlightControls(ctx, {
  pitch: { actuators: [A, B] }, roll: { actuators: [A, B] },
  yaw: { actuators: [A, B, S], manualReversion: null } });
const stab = new TrimAxis(ctx, { axis: 'pitch', range: [0, 17], neutral: NEUTRAL_UNITS,
  electric: { power: 'elec.stab_trim_powered', enable: 'ac.stab_trim_main_elec', rate: MAIN_ELEC_RATE_UP,
              rateFlapsExtended: MAIN_ELEC_RATE_DN, limits: [3.95, 14.5], limitsFlapsExtended: [0.05, 14.5],
              columnCutout: { threshold: 0.2 } },
  autopilot: { enable: 'ac.stab_trim_autopilot', rate: AP_TRIM_RATE_UP, rateFlapsExtended: AP_TRIM_RATE_DN },
  takeoffBand: GREEN_BAND });
const afcs = new Afcs(ctx, { ...AFCS_B737_AFDS, power: 'elec.dc1_powered && elec.dc2_powered',
  servoPower: ['hyd.a_psi > 1000', 'hyd.b_psi > 1000'],
  disconnect: { ...AFCS_B737_AFDS.disconnect, engageInhibit: 'ac.stab_trim_autopilot == 0' } });
const trc = new ThrustRatingComputer(ctx, { ratings: { TO: N1_TO, 'TO-1': N1_TO1, 'TO-2': N1_TO2, CLB: N1_CLB,
  CRZ: N1_CRZ, GA: N1_GA }, auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA',
  goAroundWhen: 'surf.flaps_deg > 0.5 && !gear.air_ground' } });
const levers = new ThrustLeverFadec(ctx, { engines: [1, 2], law: { kind: 'linear', maxRating: 'TO' },
  reverseLeverVar: (e) => `ac.rev_lever${e}`, idle: { ground: IDLE_GND, flight: IDLE_FLT, approach: IDLE_APP,
  approachWhen: 'surf.flaps_deg >= 15 || gear.down_locked' },
  reverse: { maxN1: REV_MAX_N1, deployS: 2, stowS: 2, power: 'hyd.a_psi > 1000' } }, trc);
const at = new Autothrottle(ctx, { engines: [1, 2], style: 'boeing', vmoKt: 340, mmo: 0.82 });
// Autobrake: selector ac.autobrake_sel -1..4 = RTO/OFF/1/2/3/MAX
const brakes = new Brakes(ctx, { maxPsi: 3000,
  sources: [{ id: 'normal', pressurePsi: 'hyd.b_psi' }, { id: 'alternate', pressurePsi: 'hyd.a_psi' }],
  accumulator: { chargeFrom: 'hyd.b_psi', prechargePsi: ACCUM_PRECHARGE, maxPsi: 3000 },
  antiskid: { enabled: 'elec.antiskid_powered' }, parking: { kind: 'hydraulic' },
  autobrake: { levels: AUTOBRAKE_737NG, thrustIdle: 'ac.tla1 < 0.05 && ac.tla2 < 0.05',
               speedbrakeDown: 'ac.speedbrake_lever < 0.02' } });
// + Flaps (loadRelief 40->30 @163/158, 30->25 @176/171; alternate ~1 min to 15), Spoilers (armedValue, roll
// mixing, auto + RTO), LandingGear (legs 0..2, handleOffValue, alternate 'freefall',
// gearHornRules({ throttleRetarded: 'ac.tla1 < 0.1 || ac.tla2 < 0.1', lowAltitude: 'ra1.valid && ra1.alt_ft < 800',
// approachFlapsDeg: 15, landingFlapsDeg: 25 })), NosewheelSteering (tiller 78, pedals 7, power A),
// YawDamper (engagedVar ap.yd_engaged, power 'hyd.b_psi > 1000'), StallWarning ('aoa', shaker),
// Overspeed, AltitudeAlert(ALT_ALERT_737NG), Taws (class A), Tcas, TakeoffConfigWarning, CasManager (master
// caution recall/six-pack), DisconnectAlerts.
```

MCP wiring:

- CMD A/B → `ap.cmd_a`/`ap.cmd_b`; CWS A/B → `ap.cws_a`/`ap.cws_b`.
- HDG SEL → `ap.hdg`; LNAV → `ap.lnav`; VOR/LOC → `ap.vorloc`; APP → `ap.app`; LVL CHG → `ap.lvlchg`;
  V/S → `ap.vs`; ALT HLD → `ap.alt`; VNAV → `ap.vnav`.
- F/D switches → `ap.fd1`/`ap.fd2`, or write `ap.fd1_on`/`ap.fd2_on`.
- Bank angle selector → `ap.bank_sel_deg`.
- A/T ARM switch → `ac.at_arm`; N1 → `at.n1`; SPEED → `at.spd`; C/O → `ap.spd_mach`.
- Disengage bar → `ap.disc`; yoke disconnect → `input.ap_disc`; TO/GA → `input.toga`.
- A/T disengage → `at.disc`.

The FMA reads `ap.at_mode`, `ap.lat_active`, `ap.lat_armed`, `ap.vert_active`, `ap.vert_armed` and
`ap.status`.

### 8.4 Gulfstream G650 / G800 (FBW, Primus Epic)

```ts
const fbw = new FlyByWire(ctx, { power: 'elec.fcc_powered',
  actuators: { pitch: [HYD_L, HYD_R, EBHA], roll: [HYD_L, HYD_R, EBHA], yaw: [HYD_L, HYD_R, EBHA] },
  airDataValid: 'adc1.valid || adc2.valid', inertialValid: 'ahrs1.att_valid || ahrs2.att_valid',
  pitch: { alphaMax: ALPHA_MAX_VS_FLAPS, vmoKt: VMO_SCHEDULE, mmo: 0.925, stabUnits: STAB_UNITS },
  roll: { bankHoldDeg: 33, maxBankDeg: 67 } });
const afcs = new Afcs(ctx, { ...AFCS_PRIMUS_EPIC, power: 'elec.afcs_powered', sensors: { valid: 'ahrs1.valid && adc1.valid' } });
const irs = [1, 2, 3].map((s) => new Irs(ctx, { index: s, power: `elec.irs${s}_powered`, gpsUpdating: true,
  gpsAutoPosition: true, requirePosition: true, alignTime: IRU_ALIGN_TIME }));
const stall = new StallWarning(ctx, { kind: 'aoa', alphaStall: ALPHA_STALL_VS_FLAPS });  // FBW AoA limiter covers protection
const at = new Autothrottle(ctx, { engines: [1, 2], style: 'bizjet', vmoKt: 340, mmo: 0.925 });
const levers = new ThrustLeverFadec(ctx, { engines: [1, 2], law: { kind: 'detent', detents: [
  { lever: 0.6, rating: 'CRZ', label: 'CRZ' }, { lever: 0.8, rating: 'CLB', label: 'CLB' },
  { lever: 1.0, rating: 'TO', label: 'TO/GA' }] }, idle: { ground: IDLE_GND, flight: IDLE_FLT } }, trc);
```

No `TrimAxis` for pitch and no `YawDamper` are used (FBW). `input.pitch_trim_rate` trims the FBW reference
speed.

### 8.5 Citation M2 (G3000) / Longitude (G5000) / Global 6000 (Pro Line Fusion)

- **M2.** `Afcs(AFCS_GFC700_G3000)`, `MechanicalFlightControls` (manual cables: no actuators), `YawDamper`
  (the rudder servo is the YD: `ap.yd_engaged`), `Spoilers({ speedbrake: 'panels', groundArm: ... })`,
  `LandingGear` with `alternate: { kind: 'blowdown' }`, `Brakes` with `emergency` (pneumatic), a detent
  `ThrustLeverFadec`, and `EngineStartController` (auto start). Add `Taws({ class: 'B' })` or class A if
  the RA option is installed.
- **Longitude.** `Afcs(AFCS_GFC_G5000)` + `Autothrottle({ style: 'bizjet' })`, and hydraulic-boosted
  `MechanicalFlightControls`.
- **Global 6000.** `Afcs(AFCS_PROLINE_FUSION)` + `Autothrottle`, hydraulic `MechanicalFlightControls` with
  three actuators per axis, slats (`Flaps.slats`), `StallWarning({ kind: 'aoa', pusher: {} })`, and Taws
  class A.

---

## 9. Tests (`tests/systems/control`)

| File | Covers |
|---|---|
| `plant.ts` | `TestPlant(vars, { tasKt, altFt, hdgDeg, controls: 'servo'\|'surface', thrust: 'hold'\|'cmd'\|'lever', ... })`: point-mass longitudinal/lateral plant with ILS geometry (`enableIls`), writes the sensor vars directly. Use it to tune AFCS/FBW gains for a new aircraft. |
| `afcs.test.ts` | HDG, ALTS/ALT, VS, FLC, LOC/GS capture, VOR, LNAV, GFC 700 CWS and GA, KAP 140, Boeing CMD/CWS, autoland status, FMA/button lights |
| `flightcontrols.test.ts` | mechanical mixing and reversion, trim sources/runaway/cutout, flaps load relief/asymmetry, spoilers auto/RTO, YD, steering, FBW rate command/bank protection/path hold/AoA limiter/DIRECT |
| `fadec.test.ts` | ratings and flex, linear/detent laws, reversers, auto/manual start and aborts, Boeing and bizjet A/T |
| `gear.test.ts` | extension/retraction, handle lock, freefall/blowdown/hand pump, horn tiers, anti-skid, autobrake levels/RTO/disarm, parking brake, accumulator |
| `warning.test.ts` | CAS latching/order/inhibits, EGPWS envelopes (published points), TAWS modes/callouts/FLTA/failure, altitude alerter, minimums, stall, overspeed, TOCW, disconnect aurals, TCAS |
| `sensors.test.ts` | ADC vs ISA truth, baro setting, VS, pitot/static blockage, alternate static, power loss, AoA jam; AHRS alignment/magnetometer/drift; IRS alignment vs latitude, position entry, motion, DC backup, drift, ATT mode, fault; RA NCD; vacuum |

---

## 10. Known simplifications

- All control-law gains (AFCS, FBW, A/T, anti-skid, autobrake PI) are EST, tuned on the test plant. Retune
  per aircraft with `plant.ts` or in the sim, and cite what you can.
- **AFCS with FBW.** `ap.servo_*` are treated as yoke equivalents by the FBW (Δnz / roll-rate commands).
  AFCS inner-loop gains for FBW aircraft should be retuned (lower `pitchKp`/`pitchKi`).
- **737.** No autoland rollout (`rollout: false`, as the NG FCOM describes), no Mach trim / speed trim, and
  no stab-trim autoland bias.
- **A/T.** It does not disconnect on a manual override. When a hardware throttle axis is bound
  (`input.throttle_axis_bound`), the aircraft must decide whether the axis or the A/T servo owns `ac.tla{i}`.
- **VNAV.** VPATH asks the A/T for speed mode (no thrust-idle path descent logic in the A/T).
- **TAWS.** PDA is simplified (EST). Mode 4C is folded into mode 3/4 logic. FLTA uses point samples along the
  track (no swath/turn prediction).
- **TCAS.** No coordination with the intruder, no RA strength changes (increase/reversal). There is no
  traffic generator.
- **IRS.** Drift direction is deterministic per unit. The GPS hybrid is a simple decay.
- **Flaps.** An asymmetry trips the protection but does not create a rolling moment (the FDM reads the mean
  flap angle).
- **Steering.** There is no free-castering FDM mode (set in the aircraft's gear contact config).
