# Garmin G3000 / G5000 integrated flight deck — API reference

Owner: avionics-garmin-g3000. Source: `src/avionics/garmin-g3000/**`.
Tests: `tests/avionics/garmin-g3000/**` (`npx vitest run tests/avionics/garmin-g3000`,
41 tests, ~4 s, real navigation data). Barrel: `src/avionics/garmin-g3000/index.ts`.

The suite implements the Garmin G3000 (Citation M2) and G5000 (Citation
Longitude) flight decks as one configurable package: two PFDs and an MFD
(GDU 1400W, 1280 x 800), two or four touchscreen controllers (GTC 570
portrait / GTC 580 landscape), the GMC 710 AFCS controller glue, the pane
system, EIS / CAS, synoptics, flight management pages, radios, TOLD, weight
and fuel, checklists, reversionary modes, power / boot. It sits on
`src/avionics/common` (canvas displays, tapes, HSI, moving map, CAS, gauges),
`src/nav` (Fms, Radios, NavDatabase) and drives `src/systems/autopilot`
(Afcs) through its EventBus events.

---

## 0. Quick start (aircraft module)

```ts
import { G3000Suite, G3000_M2_LAYOUT, g3000Controls } from '@/avionics/garmin-g3000';
import { Afcs, AFCS_GFC700_G3000 } from '@/systems/autopilot';

create(ctx) {
  const suite = new G3000Suite(ctx, {
    ...G3000_M2_LAYOUT,                    // or G5000_LONGITUDE_LAYOUT
    aircraftId: 'citation-m2',
    // unit power (Binding expressions over your electrical vars)
    power: { pfd1: 'elec.avn1_powered', mfd: 'elec.avn1_powered', pfd2: 'elec.avn2_powered',
             gtc1: 'elec.avn1_powered', gtc2: 'elec.avn2_powered' },
    gmcPower: 'elec.avn1_powered',
    radioPower: { nav1: 'elec.avn1_powered', nav2: 'elec.avn2_powered', gps: 'elec.avn1_powered', marker: 'elec.avn1_powered' },
    eis: MY_EIS,                           // optional: overrides the preset EIS (engine vars, limits)
    synoptics: MY_SYNOPTIC_PAGES,          // fuel, electrical, ECS / pressurization, anti-ice, doors ...
    checklists: MY_CHECKLISTS,
    performance: MY_TOLD_PROVIDER,         // optional TOLD computation
    trafficSource: tcas,                   // systems/warning Tcas instance (its `threats`)
    fmsOptions: { speeds: { climbKt: 240, cruiseKt: 280, cruiseMach: 0.7, descentKt: 260, approachKt: 120 } },
  });
  const afcs = new Afcs(ctx, { ...AFCS_GFC700_G3000, power: 'elec.avn1_powered' });
  const systems = [elec, sensors, ...suite.systems, afcs, ...];   // suite BEFORE the Afcs
  casManager.addSink?.(suite.casModel);                          // CAS messages shown by the suite
  // cockpit: map suite.displayList() onto the screen meshes by id ('pfd1','mfd','pfd2','gtc1'..)
  //          and build the hardware from g3000Controls(suite.cfg) (§7)
  applyState(s) { ...; suite.applyState(s); }
}
```

`suite.systems` = `[RadioPower, Radios, Fms, G3000System, Gmc710]` (radio power,
radios and FMS only when the suite created them, i.e. `radiosInstance` / `fms`
absent). Because the suite owns the `Radios` and `Fms`, the app does not add
its own. Put them **after** the ADC/AHRS sensors and **before** the Afcs: the
system writes `ap.nav_source` which the Afcs reads.

Headless (tests): `new G3000Suite(ctx, cfg, { noDisplays: true })`.

---

## 1. Configuration (`config.ts`)

`G3000Config` (everything optional except `variant` and `aircraftId`;
`resolveConfig()` fills defaults, `suite.cfg` is the resolved object):

| field | meaning (default) |
|---|---|
| `variant` | `'g3000'` / `'g5000'` (FMA labels, A/T cell, FD format option, TCAS II, splash) |
| `aircraftName`, `softwareVersion` | MFD database page and GTC start screen |
| `pfdCount` | 1 or 2 (2) |
| `gtcs: GtcConfig[]` | `{ id, model: 'GTC570'\|'GTC580', side, modes: ('PFD'\|'MFD'\|'NAVCOM')[], panes?, cnsBar?, orientation?, power?, pixelRatio? }` (two GTC 570 with all modes) |
| `casLocation` | `'mfd'` (EIS strip, M2) or `'pfd'` (lower inboard corner of each PFD, Longitude) |
| `casModel` | an existing `CasModel` (else one is created: `suite.casModel`) |
| `eis: EisConfig` | EIS strip sections (below) |
| `vspeeds: VSpeedDef[]` | `{ id, label, group: 'takeoff'\|'landing'\|'other', defaultKt? }` |
| `speedTape` | `vmoVar` (`overspeed.vmo_kt`), `vmoKt`, `aoaNormVar` (`stall.aoa_norm`), `shakerNorm` 0.85, `cautionNorm` 0.8, `approachRefNorm` 0.66 |
| `performance: PerformanceProvider` | `{ takeoffFlaps, landingFlaps, takeoff(input), landing(input) }` returning V-speeds / N1 / field length (TOLD) |
| `weights: WeightsConfig` | BOW, max ramp / takeoff / landing / zero fuel (lb), pax weight / max pax |
| `afcs` | `eventPrefix` ('ap.'), `autothrottle`, `speedKnob` (Longitude SPD knob), `labelMap` (G5000 `VPTH -> PATH`), `maxSelAltFt` |
| `synoptics: SynopticPageDef[]` | data-driven synoptic pages + GTC system controls (§6) |
| `checklists` | `aircraft/types` `Checklist[]` for the electronic checklist |
| `power` | `Binding` per `pfd1`/`mfd`/`pfd2`/`gtcN` (always on) |
| `gmcPower`, `radioPower` | GMC 710 power; NAV/GPS/marker/ADF receiver power (default: PFD1 power) |
| `bootS` | `{ gdu: 12, gtc: 8 }` seconds (EST) |
| `sensors` | `{ adc: 2, ahrs: 2, radioAltimeter: true }` |
| `radios` | `{ nav: 2, com: 2, adf: false, dme: true, xpdr: 2 }` |
| `taws` / `traffic` | `'A'\|'B'`, `'TAS'\|'TCAS2'` |
| `trafficSource` | `{ threats: { relBrgDeg, rangeNm, relAltFt, vsSign, level }[] }` (Tcas) |
| `fms`, `radiosInstance` | use existing instances instead of creating them |
| `fmsOptions`, `radiosOptions`, `engineCount` | options for the created FMS / radios |
| `fuelTotalVar` (`fuel.total_kg`), `fuelFlowVar`, `gearDownVar` (`gear.down_locked`), `flapsVar` (`surf.flaps_deg`), `raIndex` | input var names |
| `defaultPanes` | power-up pane contents (`PANE_CONTENT`) |
| `gduPixelRatio` | texture scale of the GDUs (0.8 -> 1024 x 640) |
| `autoReversion` | automatic reversionary mode on a display failure (false: crew uses the switches, PG §1.4) |

### 1.1 EIS sections (`EisConfig.sections`, drawn top to bottom in the 280 px strip)

`n1` (dials; `var`, `detentVar` FADEC mode label, `limitVar` V-bug, `commandVar`
T-bug, reverser vars, sync), `itt` (dials; `startScale`, `startingVar`, fire,
`digitsOnlyWhenNotRunning`, `startPsiVar`), `digital` (rows of per-engine
values with limits / step / factor / flags), `oat`, `fuel` (tanks in kg ->
lb/kg, low level, imbalance), `trim` (pitch with takeoff band, roll, yaw),
`flaps` (detents, speedbrake annunciation, gear), `cabin`, `elec`, `apu`,
`cas` (fills the rest; footer "CAS n↑ m↓"), `custom` (callback). A `trim`
followed by `flaps` is drawn side by side, an `oat` followed by `fuel` too.
`reversionary` optionally lists the sections for the reversionary display.

### 1.2 Presets (`presets.ts`)

`G3000_M2_LAYOUT`, `G5000_LONGITUDE_LAYOUT` (+ `M2_EIS`, `M2_VSPEEDS`,
`M2_GTCS`, `LONGITUDE_EIS`, `LONGITUDE_VSPEEDS`, `LONGITUDE_GTCS`). Sources
and EST markings are in the file header: M2 weights / Vmo 263 / Mmo 0.71 /
FL410 and FJ44-1AP-21 limits (ITT 855 °C T/O, 835 °C MCT, N1 104.69 %, N2
100 %, oil 23-120 psi, 135 °C); Longitude weights, ITT 955/950/650 °C, N1
96.79 %, N2 98.62 %, Vmo 325 / Mmo 0.84, FL450 from the Longitude Operating
Limitations. Default V-speeds are EST values at typical weights.

Longitude GTC layout: gtc1 = pilot PFD GTC (PFD mode), gtc2 / gtc3 = MFD
GTCs (MFD mode; also control the PFD split panes), gtc4 = copilot PFD GTC;
all GTC 570 with the CNS bar. M2: gtc1 / gtc2 GTC 570 with PFD / MFD /
NAV-COM modes (mode tabs on screen).

---

## 2. Displays

| class | id | size | notes |
|---|---|---|---|
| `GduDisplay(sys, 'pfd1'\|'mfd'\|'pfd2', opts)` | `pfd1`, `mfd`, `pfd2` | 1280 x 800 logical, texture x0.8 | power var `display.<gdu>.power` (written by the system) |
| `GtcDisplay(sys, gtcCfg, opts)` | `gtc1..4` | GTC 570: 480 x 640 (x1); GTC 580: 1280 x 768 (x0.8) | touch via `onPointer` |

Both are `CanvasDisplay`s (≤ 30 Hz / 20 Hz, brightness `display.<id>.brt` or
`setBrightness`). Options: `canvas` ('dom' / 'offscreen' / canvas), `id`
(cockpit display id; power var keeps the unit id), `pixelRatio`,
`brightnessVar`, `refreshHz`.

### 2.1 GDU formats

* **Boot** (unit powered, boot timer running): Garmin logo, unit, software.
* **MFD database page** after every power-up until the rightmost MFD softkey
  or "Continue" on a GTC is pressed (`g3k.mfd.splash_ack`).
* **PFD full**: blue/brown ADI (≈8.2 px/deg, TBM CRG figure), Garmin speed
  tape (Vmo barber pole from `overspeed.vmo_kt`, low-speed awareness from the
  normalized AoA, V-speed bugs, selected speed / Mach, trend), altitude tape
  (selected altitude + alerter, baro / STD / preselect, minimums bug, VNAV
  target, radio-altitude ground band), VSI with required-VS, GS / GP / VDI,
  marker beacons, HSI (360° with CDI, TO/FROM, bearing pointers 1 / 2,
  heading / course readouts, OBS / SUSP), inset map, AFCS mode box (lateral
  armed / active, AP / YD / FD arrow, vertical active + reference / armed;
  G5000: A/T cell; mode flash 10 s), MSG icon, COM + XPDR box, navigation
  status box (leg, DIS / BRG or ETE, TOD within 1 min), wind (3 options),
  AOA gauge, radio altitude, minimums, TAWS / TCAS / LOW ALT annunciations,
  comparator and reversionary-sensor windows, DME window, data bar (TAS, GS,
  OAT, ISA, bearing info, TMR, UTC), CAS window (G5000 `casLocation: 'pfd'`).
* **PFD split**: PFD in the outboard 780 px, a display pane inboard.
* **Reversionary** (PG §1.4): EIS strip left, PFD centred (TBM CRG Fig. 3-2), PFD softkeys.
* **MFD**: EIS strip (COM header on the G3000), navigation data bar (GS, DTK,
  TRK, ETE, BRG, DIS, MSA, ETA), one full or two half panes with title tabs,
  cyan frame + tab toward the controlling GTC.
* **Softkeys**: 12 labels (two lines, cyan status, green / grey
  annunciator, subdued when unavailable). Event `g3k.<gdu>.sk<1..12>`;
  clicking the label strip also presses them. PFD tree: Map Range - / +, PFD
  Map Settings (Map Layout, Detail, Traffic, Terrain, WX overlay), Traffic
  Inset, PFD Settings (Attitude Overlays, PFD Mode FULL/SPLIT, Bearing 1 / 2,
  Other PFD Settings: Wind, AOA, Altitude Units / baro IN-HPA / Meters,
  COM1 121.5), OBS / SUSP, Active NAV, Sensors (ADC / AHRS), WX Radar
  Controls, CAS Up / Dn. Sub-levels revert after 45 s. MFD: CAS Up / Dn (only
  when scrolling is possible), Continue on the database page.

### 2.2 Pane contents (`PANE_CONTENT`, var `g3k.pane.<pfd1|mfd1|mfd2|pfd2>.content`)

`navMap` 0, `traffic` 1, `weather` 2 (radar controls only: SCOPE), `taws` 3,
`flightPlan` 4 (table + current VNAV profile), `procedure` 5 (preview),
`waypointInfo` 6, `nearest` 7, `checklist` 8, `synoptics` 9 (page index
`g3k.pane.<p>.synoptic`), `charts` 10 (no chart database: SCOPE),
`tripPlanning` 11, `gpsStatus` 12, `weightFuel` 13, `told` 14. Synoptics,
checklist, W&F and TOLD are half-size only. Maps: heading / track / north up,
detail levels, relative terrain (when a WorldQuery is available), traffic,
range rings (Garmin range = inner ring), map pointer with bearing / distance /
lat-lon (`sys.pointers[pane]`).

---

## 3. GTC (touchscreen controllers)

Screen: CNS bar (Audio & Radios, COM1 / COM2 active + standby, XPDR code /
mode; touching opens the tuning / transponder screens), mode tabs (portrait
units with several modes), title tab, page, button bar (Back / Cancel, Home,
MSG (blinks while unread), Full / Half (MFD) or Split / Full (PFD), up to two
page buttons such as Enter / Load / Activate / Up / Down), label bar with the
knob functions. GTC 580: button bar and label bar on the right; the label bar
boxes the active control mode with a green arrow. Touch acts on release
inside the button; the button is blue while touched.

Screens (class, file):

* **Home** (MFD) `MfdHomePage`: Map, Traffic, Weather (put on the controlled
  pane; second touch opens Map / Traffic / Weather Radar settings), Direct
  To, Flight Plan, PROC, Aircraft Systems, Checklist, Utilities, PERF (or
  Weight and Fuel without a performance provider on the G3000), Waypoint
  Info, Nearest.
* **PFD Home** `PfdHomePage`: Speed Bugs, Timers, Minimums, PFD Map
  Settings, Traffic Map, Sensors, PFD Settings, Nav Source, OBS, Bearing 1 /
  2, CAS Scroll Up / Down (PFD CAS or reversionary), Wx Radar Controls,
  Direct To.
* **NAV/COM Home** `NavComHomePage`: COM MIC / active (touch = swap) /
  STBY (keypad) / MON, NAV active / STBY, XPDR, Mode, IDENT, ADF, Audio &
  Radios.
* Keypads (`pages/keypads.ts`): `NumericKeypadPage` (frequencies, codes,
  altitudes, speeds, times; Enter in the button bar; invalid entry keeps the
  keypad open with "Invalid entry"), `AlphaKeypadPage` (identifiers; hint
  shows the airport name; inner knob cycles the character, outer adds /
  deletes), `ListSelectPage` (duplicates, procedures, runways, transitions,
  airways, checklists, frequencies).
* Radios (`pages/radios.ts`): COM / NAV / ADF standby keypads with XFER and
  Find (nearby / flight plan airport COM frequencies, nearby VOR / ILS),
  `XpdrPage` (code 0-7 only, VFR, STBY / ON / ALT or STBY / TA ONLY / TA/RA,
  IDENT), `AudioRadiosPage` (MIC / MON, NAV / DME / ADF / marker audio,
  speaker, standby frequencies).
* Flight plan (`pages/fpl.ts`): `FlightPlanPage` (rows: origin, procedure
  headers, waypoints with DTK / DIS / altitude constraint, destination, Add
  Origin / Add Enroute Waypoint / Add Destination; touching the ALT box opens
  the constraint keypad; Flight Plan Options, PROC, Direct To),
  `WaypointOptionsPage` (Insert Before / After, Load Airway -> exit list,
  Activate Leg To, Direct To, Remove, Altitude Constraint, Hold, Waypoint
  Info), `AirportOptionsPage` (runway, departure / arrival / approach,
  change / remove), `SegmentOptionsPage` (remove procedure, activate
  approach / VTF / missed), `FplOptionsPage` (cruise altitude, VNAV descent
  angle, delete plan).
* PROC / Direct-To (`pages/proc.ts`): `ProcPage`, `ProcSelectPage`
  (airport, procedure, transition, runway, Load / Load and Activate /
  Activate Vectors to Final; previews on the controlled pane and restores it
  on exit), `DirectToPage` (identifier keypad or flight plan waypoint list,
  optional course, Activate).
* PFD (`pages/pfd.ts`): `SpeedBugsPage` (per V-speed value keypad + On/Off,
  Takeoff On, Landing On, Restore Defaults, G5000 N1 Target), `TimersPage`
  (up / down, preset HH:MM:SS, start / stop, reset), `MinimumsPage` (Off /
  Baro / Temp Comp / Radio Alt, value, destination temperature, corrected
  value), `SensorsPage`, `PfdSettingsPage` (wind, AOA, baro units, meters,
  DME window, SVT flag, horizon heading, FD format (G5000) / baro sync, nav
  angle), `PfdMapSettingsPage` (layout, range, orientation, terrain,
  detail, symbols).
* MFD (`pages/mfd.ts`): `MapSettingsPage`, `TrafficSettingsPage` (mode via
  `xpdr.mode`, altitude range), `WeatherRadarPage` (state only), `TawsPage`
  (inhibit switches, GS inhibit, test), `SystemsPage` + `SynopticControlsPage`,
  `ChecklistPage` (lists, check items, next list; center / lower knob moves
  and checks), `NearestPage` (+ `NearestOptionsPage`: Direct To, Waypoint
  Info, tune VOR), `WaypointInfoPage`, `UtilitiesPage` (Trip Planning, GPS
  Status, Avionics Settings, Initialization, Weight and Fuel, Minimums,
  Timers, TAWS Settings, Charts), `AvionicsSettingsPage` (baro sync, 8.33 kHz
  spacing, nav angle, flight ID), `InitializationPage`, `WeightFuelPage`,
  `PerfPage` + `ToldPage` (auto-fill from the plan runway, ADC OAT, baro,
  gross / landing weight; Calculate via the provider; Send to PFD applies the
  V-speed bugs and the N1 target), `MessagesPage`.

### 3.1 Knobs (`GtcController.knob`, label bar defaults)

| knob | MFD mode | PFD mode | NAV/COM mode |
|---|---|---|---|
| upper outer / inner (dual) | display pane selection | COM standby MHz / kHz | COM standby MHz / kHz |
| upper push / hold | — | COM1 <-> COM2 / swap | COM1 <-> COM2 / swap |
| lower (GTC 580) / map knob (GTC 570) | map range of the pane | PFD map range | COM volume |
| lower push | map pointer on / off | — | squelch |
| joystick {x, y} | pans the map pointer | — | — |
| center (GTC 570) | COM volume, push squelch (checklist: item / check) | same | same |

Pages may take over the knobs (keypads: data entry; lists: scroll). Events:
`g3k.<gtc>.upper_outer|upper_inner|lower|center` (signed clicks, or `_inc` /
`_dec` with positive clicks = the cockpit `RotaryKnob` encoder convention),
`upper_push`, `upper_hold`, `lower_push`, `center_push`, `joystick`,
`mode_pfd|mode_mfd|mode_navcom` (GTC 580 bezel softkeys).

Only one GTC in MFD mode may control panes it shares with another GTC (PG
§1.3): selecting MFD mode sends the other one to NAV/COM.

---

## 4. `G3000System` (state, logic, AFCS glue)

Subsystem (60 Hz). Key members: `cfg`, `fms`, `fpl: FplEditor`, `cas`,
`timer`, `vspeeds`, `mins`, `told`, `wf`, `checklists`, `messages`, `maps`,
`pointers`, `radar`, `ui` (nearest kind, waypoint-info ident, procedure
preview, synoptic), `trafficSource`, `casRows`, `revision`.

* **Units**: `unitUp(id)`, `unitPowered`, `unitBooting`, `forceBooted()`.
  Failure var `fail.g3k.<unit>`. Writes `display.<unit>.power`,
  `g3k.<unit>.powered`, `g3k.<unit>.booting`.
* **Reversion** (PG §1.4): MFD switch (or PFD1 failure with
  `autoReversion`) -> MFD reversionary and PFD2 split; PFD1 switch (or MFD
  failure with `autoReversion`) -> PFD1 reversionary and PFD2 split;
  `isReversionary(gdu)`; switches `g3k.rev_sw.<gdu>`.
* **Panes**: `paneContent`, `setPaneContent`, `paneVisible`, `setMfdHalf`
  (refused for half-only contents), `setPfdSplit`, `gtcPane(gtc)`,
  `cycleGtcPane`, `paneOwner`, `setGtcMode`, `paneRangeStep`,
  `pfdRangeStep` (Garmin range set `G3K_MAP_RANGES`, 250 ft .. 1000 nm).
* **PFD settings**: `navSource/setNavSource/cycleNavSource` (FMS -> NAV1 ->
  NAV2), `cycleBearing`, `toggleObs` (OBS = course-to-fix direct-to on the
  FMS CDI; SUSP at the MAP activates the missed approach), `setSensor`.
* **Knobs**: `hdgTurn/Push` (sync), `crsTurn/Push` (VOR/LOC OBS, FMS OBS
  course, push = centre / LOC course), `altTurn` (1000 / 100 ft, 10 ft with
  an approach active, stops once at the baro minimums), `altPush` (sync to
  nearest 10 ft), `spdTurn/Push` (Longitude MAN / FMS speed), `xfr`,
  `baroTurn/Push` (0.01 inHg / 1 hPa, synced sides, STD with preselect),
  `minsTurn/Push` (OFF -> BARO -> RA -> OFF).
* **Radios**: `swapCom`, `stepComStandby`, `setComStandby`, `com121`,
  `swapNav`, `stepNavStandby`, `setNavStandby`, ADF, `setSquawk`,
  `setXpdrMode`, `ident` (18 s, DO-181E), `setMic`.
* **ILS rule** (G5000 CRG "Selecting Glideslope Mode", PG §2.1 CDI):
  loading a LOC-type approach auto-tunes every NAV receiver and sets the
  course; `prepareApproach()` (called by the GMC APR key) overrides
  `ap.nav_source` to the on-side receiver when the coupled CDI is FMS and a
  localizer is received, so the Afcs arms **LOC / GS** instead of FMS / GP;
  the CDI switches FMS -> LOC automatically when the FAF leg is active within
  15 nm, the localizer is received, the FMS CDI is within 1.2 dots and LOC is
  armed or captured (or immediately once LOC is captured). A manual source
  change cancels the override. Tested in `system.test.ts`.
* **Comparators** (2 Hz): ALT 200 ft, IAS 10 kt, HDG 6°, PIT 5°, ROL 6° (EST
  from the G1000 table) -> `g3k.miscomp` bitmask and PFD windows; "BOTH ON
  ADCn / AHRSn".
* **Messages**: GPS NAV LOST, GPS ACQUIRING, TOD within 1 minute, TAWS
  UNAVAILABLE, BARO DISAGREE, SENSOR MISCOMPARE, XPDR IN STANDBY (airborne).
* `applyState(state)`: cold & dark resets the splash / minimums / timers;
  other states skip the boot, restore the V-speed groups, select the nav
  source (NAV1 for 'approach'), and set the transponder to ALT (TA/RA).

`FplEditor` (UI-independent flight-plan flows, `state/FplEditor.ts`):
`setOrigin`, `setDestination`, runways, `appendEnroute`, `insertWaypoint`
(never before origin / after destination), `deleteLeg`, `loadAirway`,
`airwaysAt`, `airwayExits`, `holdAt`, `setAltitudeConstraint`,
`setSpeedConstraint`, `activateLeg`, `directTo`, `deletePlan`,
`setCruiseAltitude`, `setDescentAngle`, `loadDeparture`, `loadArrival`,
`loadApproach(apt, id, transition?, 'load'|'activate'|'vtf')`,
`activateApproach`, `activateVtf`, `activateMissedApproach`,
`approachIsLoc`, `rows()`, `resolve(ident)` (nearest first), `lastError`.

---

## 5. SimVars and events

All suite vars live in `g3k.*` (see `vars.ts` for the complete, commented
list). Frequently used:

| var | meaning |
|---|---|
| `g3k.<unit>.powered` / `.booting`, `display.<unit>.power` | unit power / boot |
| `g3k.mfd.splash_ack` | MFD database page acknowledged |
| `g3k.rev_sw.<gdu>` (input), `g3k.<gdu>.reversionary` | reversion switch / state |
| `g3k.pfd<s>.split`, `g3k.mfd.half`, `g3k.pane.<p>.content/.synoptic/.range_nm` | layout |
| `g3k.<gtc>.mode` (0 PFD, 1 MFD, 2 NAV/COM), `g3k.<gtc>.pane` | GTC state |
| `g3k.pfd<s>.nav_src` (0 FMS, 1 NAV1, 2 NAV2), `.brg1_src/.brg2_src` (0 off, 1 NAV1, 2 NAV2, 3 FMS, 4 ADF), `.obs`, `.obs_crs` | CDI / bearings |
| `g3k.pfd<s>.map` (0 off, 1 inset, 2 HSI map), `.map_range_nm`, `.traffic_inset`, `.wind` (0-3), `.aoa_mode`, `.baro_hpa`, `.meters`, `.adc`, `.ahrs`, `.dme_win`, `.baro_presel`, `.fd_format`, `.svt`, `.hzn_hdg` | PFD settings |
| `g3k.mins.mode/.ft/.temp_c` -> `ap.mins<s>_ft`, `ap.mins<s>_is_ra` | minimums |
| `g3k.vspd.<ID>.kt/.on/.src` | V-speed bugs |
| `g3k.n1_target`, `g3k.spd_fms`, `g3k.fd_side` | N1 bug, FMS speed, coupled FD |
| `g3k.timer.s/.running/.dir/.preset_s`, `g3k.trip.flight_s/.odo_nm` | timers |
| `g3k.audio<s>.mic/.com<r>_mon/.nav<r>/.adf/.dme/.mkr/.com<r>_vol`, `g3k.com<r>.squelch`, `g3k.audio.speaker` | audio panel |
| `g3k.xpdr.ident_s`, `g3k.xpdr.flight_id` (string) | transponder |
| `g3k.msg.unread/.count`, `g3k.miscomp` | messages / comparator |
| `g3k.taws.inhibit_terr/.inhibit_gpws/.flap_ovrd` | bind the Taws `inhibits` to these |
| `g3k.traffic.alt_range` | traffic altitude filter setting |
| `g3k.gmc.lt_<key>`, `g3k.gmc.lt_xfr_l/_r`, `g3k.gmc.powered` | GMC 710 key lights |
| `g3k.wf.*`, `g3k.told.*`, `g3k.init.accepted` | W&F, TOLD, initialization |

Standard vars written for other systems: `nav/com` frequencies and OBS,
`xpdr.code/mode/ident`, `ap.sel_hdg/alt/spd/mach/crs<s>`, `ap.nav_source`,
`adc<n>.baro_inhg/baro_std`, `nav{r}.powered`, `gps.powered`,
`nav.marker_powered` (with the suite's radios).

Inputs read besides the standard ADC / AHRS / GPS / NAV / FMS / AP vars:
`stall.aoa_norm`, `overspeed.vmo_kt`, `ra<n>.valid/.alt_ft/.ncd`,
`ahrs<n>.aligning/.att_valid/.hdg_valid`, `adc<n>.aoa_deg/.ias_rate_kts/.press_alt_ft`,
`gear.air_ground`, `gear.down_locked`, `surf.flaps_deg`, `tcas.ta/.ra/.ra_vs_min_fpm/.ra_vs_max_fpm`,
`alert.taws_warning/_caution`, `taws.alert/.inop/.test`, `ap.disc_warn`,
`ap.mistrim`, `at.disc_warn`, `at.target_kt`, `fadec.*` (EIS), `press.*`,
`env.time_utc_h`, engine / fuel vars per the EIS config.

Events (`G3K_EVENTS`): softkeys `g3k.<gdu>.sk<i>`; GTC knobs (§3.1); baro
`g3k.baro<s>.turn/.push`; `g3k.range<s>.turn`; `g3k.mins<s>.turn/.push`;
GMC 710 `g3k.gmc.hdg/.hdg_push/.crs<s>/.crs<s>_push/.alt_outer/.alt_inner/.alt_push/.spd/.spd_push/.xfr/.nose`
(every turn event also accepts `_inc` / `_dec`); GMC keys
`g3k.gmc.key_<hdg|nav|apr|bc|ap|yd|fd|fd1|fd2|xfr|bank|vs|flc|alt|vnav|spd|at>`;
`g3k.cas.ack` (and `cas.ack`, `cas.ack_warning`, `cas.ack_caution`).

GMC 710 key -> AFCS event (`gmc/Gmc710.ts`): HDG `ap.hdg`, NAV `ap.nav`,
APR `prepareApproach()` + `ap.apr`, BC `ap.bc`, AP `ap.ap`, YD `ap.yd`, FD
`ap.fd`, FD1/FD2 `ap.fd1/fd2`, BANK `ap.half_bank`, VS `ap.vs`, FLC
`ap.flc`, ALT `ap.alt`, VNAV `ap.vnav`, SPD `ap.spd_mach`, XFR (suite),
A/T `at.engage` (autothrottle installations). Keys and knobs are dead when
`gmcPower` is off.

---

## 6. Synoptics (`gdu/synoptic.ts`)

`SynopticPageDef = { id, title, label?, width?, height?, elements?, draw?, controls? }`
in design coordinates (default 500 x 700, scaled into the pane). Elements:
`line` (flow lines, active binding, arrow), `text`, `box`, `bus`, `source`
(gen / batt / ext / apu), `valve`, `pump`, `tank` (qty binding + capacity),
`readout` (value binding, limits), `bar`, `indicator`, `door`, `engine`,
`aircraft`, `surface`. Every value is a `Binding` (var name or expression)
compiled once. `controls: SynopticControl[]` (`toggle` var, `cycle` var +
values / labels, `button` event + payload, `number` var with keypad range)
appear on the GTC when that page is selected (fuel pumps, cabin temperature,
pressurization, anti-ice ...).

---

## 7. Hardware controls for the cockpit (`controls.ts`)

`g3000Controls(cfg)` returns `G3kControl[]`: `{ id, unit, kind: 'button' | 'knob' | 'dualKnob' | 'wheel' | 'joystick' | 'switch', label, press?, hold?, incEvent?, decEvent?, innerIncEvent?, innerDecEvent?, joystick?, var?, lightVar?, lightVar2?, pos }`
for the GMC 710 (keys with light vars, CRS1 / HDG / ALT (dual) / CRS2 / SPD
knobs, NOSE wheel), the 12 softkeys of each GDU, each GTC's knobs /
joystick / mode softkeys, the baro / minimums / range knobs and the
reversion switches. Event names plug directly into the cockpit `PushButton`
(`event`) and `RotaryKnob` (`incEvent` / `decEvent` / `push.event`)
options. `pos` (mm on the unit face) and `UNIT_SIZE_MM` are EST.

---

## 8. Preview and tests

Preview harness (not bundled): `npx vite --port 5199`, open
`/src/avionics/garmin-g3000/dev/preview.html?ac=m2|longitude&state=cruise|approach|ground|split|rev|boot[&gtc=580]`.
`window.__g3k` exposes the suite for automation (`suite.gtcs[i].tapLabel('Flight Plan')`).

Tests: `radios.test.ts` (tuning rules, keypad parsing, formats),
`models.test.ts` (timer, V-speeds, minimums / temp comp, checklists,
messages, W&F, TOLD), `fplEditor.test.ts` (plan editing, airways,
procedures, direct-to with the real database), `system.test.ts` (power /
boot, reversion, panes / GTC modes, knobs, baro, IDENT, GMC -> AFCS, the ILS
APR rule, softkeys, controls), `gtc.test.ts` (keypads, transponder, knobs,
home -> pane, flight plan editing through the GTC, PROC / VTF, Direct-To,
speed bugs, minimums, timers, messages).

---

## 9. Scope / simplifications (honest list)

* **SVT**: the flag exists but no synthetic terrain is rendered on the PFD
  (blue / brown only). The PFD "HSI map" layout draws a 120° compass arc over
  the moving map inside the HSI circle (simplified geometry).
* **Weather radar, datalink weather, Stormscope, charts, SafeTaxi, obstacle
  database**: controls and states only; no returns / imagery (no data source).
* **Procedure preview**: the pane shows the nav map with a preview banner,
  not the unloaded procedure geometry.
* **Terrain** on the maps needs a `WorldQuery` (`ctx.world`); MSA in the MFD
  data bar is the highest sampled terrain within ~10 nm + 1000 / 2000 ft (EST).
* **Audio panel**: selections are stored in vars; the actual audio routing /
  volume / squelch must be applied by the aircraft's audio logic.
* **TOLD**: computed only through the aircraft's `PerformanceProvider`; no
  built-in performance tables.
* **Traffic**: map symbols come from `trafficSource.threats` (relative
  bearing / range / altitude); the altitude-range filter var is not applied
  to the symbols yet.
* **Telephone / SMS, crew profiles, scheduled messages, user waypoints,
  holding pattern editing (course / time), speed constraints on the GTC,
  VNAV per-leg editing beyond constraints**: not implemented.
* **Layout numbers** (screen positions, GTC sizes, control positions, some
  EIS scale ends and default V-speeds) are EST from the pilot's-guide
  figures, marked in the code.
* Reversion follows the PG: the crew selects it with the DISPLAY REVERSION
  switches (`g3k.rev_sw.<gdu>`); `autoReversion: true` makes a failed
  display switch automatically (convenience for cockpits without switches).

---

## 10. Sources

Garmin G3000 Pilot's Guide for the Socata TBM 930, 190-02046-01 Rev. A (and
the TBM 930 Cockpit Reference Guide 190-02047-02, screen figures); Garmin
G5000 Cockpit Reference Guide (Citation XLS+ / Latitude family) 190-02538-02;
Citation Longitude Operator's Guide (Model 700 Operating Limitations,
avionics chapter); Textron / flyradius.com Citation M2 specifications and
FJ44-1AP-21 limits; ICAO Annex 10 (COM / NAV channelling), DO-181E (IDENT),
ICAO PANS-OPS Doc 8168 (cold-temperature correction).
