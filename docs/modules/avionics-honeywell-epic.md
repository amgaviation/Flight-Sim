# Honeywell Primus Epic: Gulfstream PlaneView II and Symmetry (`src/avionics/honeywell-epic`)

One configurable suite builds both Gulfstream flight decks that run on Honeywell Primus Epic:

| | PlaneView II (G650 / G650ER) | Symmetry (G500 / G600 / G700 / G800) |
|---|---|---|
| Display units | 4 landscape LCDs (DU1 pilot PFD, DU2 / DU3 MFDs, DU4 copilot PFD) | 4 Honeywell DU-1310-2, same window architecture |
| Standby | 2 SMCs: standby instrument + display controller on the glareshield | 2 touch SFDs (ESIS-5000) flanking the guidance panel |
| Guidance panel | FGP across the glareshield | GP-700 |
| FMS access | 3 pedestal MCDUs | FMS app on the touch-screen controllers |
| Cursor control | 2 CCDs | 2 Mason CCDs |
| Overhead | hardware switches | 3 overhead panel touch screens (OHPTS) |
| Touch controllers | none | 4 TSCs (outboard L/R, pedestal L/R) |

The aircraft module (`src/aircraft/g650`, `src/aircraft/g800`) creates the suite with its own
airframe, engines (Rolls-Royce BR725 / Pearl 700), power buses, synoptic bindings and
checklists, adds the suite subsystem to its systems, and places the displays and hardware in its
cockpit with the helpers in `cockpit.ts`.

```ts
import {
  createEpicSuite, G650_AIRFRAME, BR725_ENGINES, G800_AIRFRAME, PEARL700_ENGINES, GULFSTREAM_CAS_TEXTS,
  addDisplayUnits, addGuidancePanel, addSmc, addMcdu, addCcd, addTsc, addOhpts, addSfd,
  addCasScrollSwitch, addDisplaySwitching, addOverheadSwitches, EPIC_HW, EPIC_VARS, EPIC_EVENTS,
} from '../../avionics/honeywell-epic';
```

Tests: `tests/avionics/honeywell-epic/*.test.ts` (window manager rules, CCD, guidance-panel event
map, display controller pages, CAS scroll rules, checklist, touch framework, overhead touch pages
and hardware writing the same vars, suite composition with a fake canvas, MCDU flows against
the real navigation database and FMS, cockpit hardware).

## Contents

1. Sources and accuracy conventions
2. Integration (G650 / G800 aircraft agents)
3. Configuration (`config.ts`)
4. SimVars and events (`vars.ts`)
5. Display units and windows
6. PFD
7. INAV map, engine, CAS, checklist, waypoint list, synoptics
8. Guidance panel (`logic/guidance.ts`)
9. Display controller / SMC (`logic/controller.ts`) and standby displays
10. CCD (`logic/cursor.ts`)
11. CAS (`logic/cas.ts`) and electronic checklist (`logic/checklist.ts`)
12. FMS / MCDU (`fms/`)
13. Symmetry touch screens (`logic/touch.ts`, `touch/tscPages.ts`, `logic/overhead.ts`)
14. Cockpit hardware (`cockpit.ts`)
15. Scope limits and estimates

## 1. Sources and accuracy conventions

Every number in the code cites its source in a comment; `EST:` marks estimates with the
reasoning, `SCOPE:` marks deliberate simplifications. Main public sources:

- Engine limits: UK CAA TCDS UK.TC.E.00082 (BR700-725A1-12) and EASA TCDS E.135 (Pearl 700,
  BR700-730B2-14): TGT start / MTO / MCT / over-temperature, N1 / N2 reference speeds and
  limits, oil pressure and temperature limits, thrust ratings (`BR725_LIMITS`,
  `PEARL700_LIMITS`).
- Airframe: EASA TCDS IM.A.169 Issue 17 (Vmo 340 KCAS; Mmo 0.925 GVI, 0.935 GVIII-G800); FAA FSB
  GVI Rev 11 and GVIII-G700 Rev 1 (G800 differences: split WAI / CAI switches, four ECS zones,
  EPR-controlled engines; CAS texts "Steer by Wire Fail", "AOA Limiting").
- Display system: Gulfstream G550 Operating Manual 2A-31-00 "Electronic Display System" (window
  formats, full-window rules, reversion, MFD display switching, DISPLAY SYSTEM CONTROL, DC pages,
  CCD cursor symbols and highlight, CAS scroll switch rules, engine window compaction) and
  2A-23-40 (MCDU radio tuning); FlightGlobal "Gulfstream G650 - in the cockpit" (2008); BJT
  "Pilot report: Gulfstream G500" (touch screens, actuation on finger lift, OHPTS); Guardian Jet
  G650 / G600 specification sheets (hardware counts); code450 G450/G650 checklists (FMA, APR,
  VNAV, preview, SMC tests, CAS texts); G650ER and G600 cockpit photographs (layouts, colours).

## 2. Integration

```ts
// In the aircraft's create(ctx):
const fms = new Fms(ctx, { style: 'boeing', engineCount: 2 }); // Honeywell MOD / ACTIVATE = Boeing MOD / EXEC
const epic = createEpicSuite({ vars: ctx.vars, events: ctx.events, nav: ctx.nav, world: ctx.world, fms }, {
  variant: 'planeview2',                 // 'symmetry' for the G800
  airframe: G650_AIRFRAME,               // G800_AIRFRAME
  engines: BR725_ENGINES,                // PEARL700_ENGINES (override vars: { ...DEFAULT_ENGINE_VARS, epr: ... })
  power: {
    du: ['elec.l_ess_dc_powered', 'elec.l_main_dc_powered', 'elec.r_main_dc_powered', 'elec.r_ess_dc_powered'],
    standby: ['elec.emer_dc_powered', 'elec.r_ess_dc_powered'],
    mcdu: ['elec.l_ess_dc_powered', 'elec.r_ess_dc_powered', 'elec.l_main_dc_powered'],
    gp: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered',
  },
  checklists,                            // AircraftInstance.checklists (ECL)
  synopticBindings: { 'hyd.l.psi': 'hyd.left_psi' /* ... map to your system ids */ },
});
systems.push(/* electrical, ... */ fms, afcs, epic.system /* after electrical and sensors */);
for (const t of GULFSTREAM_CAS_TEXTS) casManager.define(t.id, t.text, t.level, whenBindingFor(t.id));
casManager.addSink(epic.cas.model);
// applyState(state): epic.applyState(state) after the systems' own preset.
```

Aircraft-side requirements:

- **AFCS** (`systems/autopilot` `Afcs`): event prefix `ap.` (default), per-side flight
  directors, `ap.nav_source` honoured (0 FMS, 1 NAV1, 2 NAV2). The guidance panel emits
  `ap.<button>` events and writes the selected-value vars (section 8).
- **Autothrottle**: `at.engage` toggles (config `events.atEngage`).
- **FADEC**: thrust rating event `fadec.rating` with the rating id (`TRS_RATINGS`: TO, GA, CLB,
  CRZ, MCT) and the string var `fadec.rating`; EPR in `ac.eng{i}.epr` (else the display derives
  EPR from N1, `eprFromN1Br700`, EST); FADEC alternate mode `ac.eng{i}.fadec_alt` (shows "ALT").
- **Systems read the overhead vars** of `GULFSTREAM_OVERHEAD_VARS` (`ac.elec.batt_l_sw`,
  `ac.fuel.boost_l_sw`, ... section 13) as their switch bindings. The G650 builds hardware
  switches for them (`addOverheadSwitches`), the G800 gets touch keys writing the same vars.
- **Synoptics** read `SystemReadouts` keys (`DEFAULT_SYSTEM_BINDINGS`, e.g. `gen.l.online`,
  `bus.l_ess_dc`, `hyd.l.psi`, `fuel.l.kg`, `pack.l.on`, `zone.1.temp`, `door.main`,
  `fc.aileron`, `wow.l` / `wow.combined`, `ice.wing_l`, `brk.l.temp`, `apu.n`, `start.1.valve`); map them to your
  component ids with `synopticBindings` (any systems/util `Binding`: var, expression or
  function; `str:` prefix for string vars). Unbound values draw as dashes.
- **Displays**: map `epic.du`, `epic.standby`, `epic.mcduDisplays` (PlaneView) or `epic.tsc`,
  `epic.ohpts` (Symmetry) and `epic.gpWindows` onto cockpit meshes; the `cockpit.ts` helpers do
  it with bezels and the physical sizes in `EPIC_HW`.
- `applyState`: `epic.applyState(state)`; `cold_dark` keeps the DU power-up self test
  (`duBootS`, default 25 s EST), the other states skip it (`epic.boot_skip`).

Display ids (prefix `idPrefix`, default `epic`): `epic.du1..4`, `epic.smc1..2` or
`epic.sfd1..2`, `epic.mcdu1..3`, `epic.tsc1..4`, `epic.ohpts1..3`,
`epic.gp.speed|heading|vsfpa|altitude`. Power and brightness use the standard
`display.<id>.power` / `display.<id>.brt` vars; with a `power` binding the suite writes the power
var every step; DU failures read `fail.epic.du{n}`.

## 3. Configuration (`config.ts`)

`EpicSuiteConfig`: `variant`, `airframe` (`EpicAirframe`: Vmo/Mmo, flap detents and placards,
pitch / aileron / rudder trim vars, length, windows, ECS zones, split anti-ice), `engines`
(`EpicEngineConfig`: limits, primary EPR, var names `EpicEngineVars`, EPR estimate), `sensors`
(ADC / AHRS / RA / NAV / ADF per side, standby ADC / AHRS, source counts), `events`
(`EpicEventMap`), `power` (`EpicPower` bindings), `checklists`, `synopticBindings`,
`overheadVars` (override or `null` to hide a control), `idPrefix`, `pixelRatio`, `duBootS`.
`resolveConfig()` applies the defaults and derives the engine gauge scales (`engineScales`): EPR
dial 0.8-1.8 (EST), TGT 0-1000 C with the MCT amber and MTO red lines, LP with the MTO red line,
oil pressure red below 25 / amber below 35 psid, oil temperature red above the maximum,
vibration amber at 1.8 (EST).

## 4. SimVars and events (`vars.ts`)

Suite state lives under `epic.` (`EPIC_VARS`, `EPIC_STRINGS`):

| Var | Meaning |
|---|---|
| `epic.du{n}.format / main / upper / lower` | selection per DU (`DuFormat`, `Win`) |
| `epic.du{n}.shown_main / shown_upper / shown_lower / operating` | output after reversion |
| `epic.du{n}.sw`, `epic.s{s}.mfd_sw` | DISPLAY SYSTEM CONTROL (1 NORM / 0 OFF), MFD DISPLAY SWITCHING (0 NORM / 1 PFD) |
| `epic.s{s}.hsi_mode / nav_src / fms_num / brg1 / brg2 / fpv / svs / evs / adc_sel / ahrs_sel / baro_hpa / mins_ft / mins_ra` | PFD settings per side |
| `epic.s{s}.map_range_nm / map_up / map_overlay / map_ctr / map_vsd / map_apt / map_vor / map_fix / map_tfc / pfd_range_nm` | map settings |
| `epic.s{s}.dc_page / smc_stby / test_ra / preview / chrono_s / chrono_run` | controller, RA test, ILS preview, chronometer |
| `epic.s{s}.ccd_du / ccd_x / ccd_y`, string `epic.s{s}.ccd_hover` | CCD cursor |
| `epic.gp.couple / spd_man / fpa_deg / low_bank / brt` | guidance panel |
| `epic.vspd.{v1,vr,v2,vfs,vref,vapp}`, `epic.vspd.shown` | FLT REF V-speed bugs |
| `epic.cas.hidden_above / hidden_below` | CAS scroll status |
| `epic.ecl.list / cursor / complete` | checklist |
| `epic.mcdu.mod`, `epic.mcdu{n}.msg_lt`, strings `epic.mcdu{n}.scratch / title` | FMS modification pending, MSG light |
| `epic.fms.dest_direct_nm`, `epic.fms.perf_init` | preview limit, PERF INIT confirmed |
| `epic.hf{r}.khz`, `epic.com3.data`, `epic.xpdr.unit`, `epic.radar.mode / tilt_deg / gain` | radios, radar controls |
| `epic.eng.exceed2 / compact`, `epic.boot_skip` | secondary engine exceedance, compacted engine window, boot skip |
| `epic.test.stall / stall1 / stall2 / hud / tcas / tone / apdisc`, `epic.hud.on / dcltr / brt` | SMC tests and HUD page |

Events the suite listens to (`EPIC_EVENTS`): `epic.gp.<control>` (buttons) and
`epic.gp.<knob>_inc/_dec` (click count), `epic.ccd{s}.move {dx, dy}`, `.enter`, `.menu`,
`.du` (0/1/2), `.data` ({steps, inner} or number), `.data_inc/_dec`, `.data_in_inc/_dec`;
`epic.dc{s}.lsk` (1-10), `.page` (page id or `STBY`), `.set` / `.set_inc` / `.set_dec`;
`epic.mcdu{n}.key` (key id); `epic.cas.scroll` (+1/-1), `epic.cas.scroll_up/_dn`;
`epic.chrono{s}` (`startstop` / `reset`). Events it emits: `ap.*`, `at.engage`, `fadec.rating`,
`taws.test`, `tcas.test`, `fms.exec`, `fms.erase`.

## 5. Display units and windows

`EpicDisplayUnit` (1024 x 788 logical px, 14-in landscape LCD) composes the windows chosen by
`WindowManager` (`logic/windows.ts`):

- split = 2/3 window (683 px) + two 1/6 windows (341 x 394) with the column outboard on the PFD
  DUs and inboard on the MFDs; or one full window;
- full PFD only on DU1/DU4, full MAP only on DU2 or DU3 and never both; full MAP on DU2 forces
  engine + CAS on DU3, on DU3 CAS on DU2's lower window; full MAP reverts on an adjacent DU
  failure, a secondary engine exceedance (`epic.eng.exceed2`, computed by the suite from the oil
  pressure / temperature / vibration limits) or a checklist call-up (`checklistCalledUp()`);
- MFD DISPLAY SWITCHING shows the side's PFD on DU2 / DU3; a DU off / failed / unpowered goes
  black; when a side has no PFD displayed the SMC / SFD shows the attitude;
- EST: a CAS window and a primary engine window are forced onto a working DU when none is shown;
  the primary engine window compacts (adds oil pressure / temperature) when no secondary engine
  window is displayed.

Window contents (`Win`): PFD, MAP, Engine, Secondary Engine, CAS, Checklist, Waypoint List, 12
synoptics, Blank. The CCD MENU key opens the window-content menu of the window under the cursor
(formats allowed in that window, plus Full / Split for the 2/3 window); ENTER selects. Mouse
use in the 3D cockpit emulates the CCD: move = cursor (DU1-2 pilot, DU3-4 copilot), click =
ENTER, long press (0.5 s) = MENU, wheel = DATA knob.

## 6. PFD (`displays/pfd.ts`)

FMA (A/T, lateral active / armed, vertical active / armed, AP with the PFD CMD coupling arrow;
new modes boxed 10 s, EST; AFCS names mapped to Honeywell text: ASEL, VASEL, FLCH, VFLCH, VPATH,
PTCH, ROLL), attitude with SmartView synthetic vision or the EVS picture (`svs.ts`, section 15;
EVS selected on the controller HUD page, `epic.s{s}.evs`), white delta aircraft
symbol, magenta single-cue FD, flight path symbol with guidance cue and acceleration caret (FPV
on), pitch limit indicator, low-speed barber pole and the normalized AOA readout (lower left, as
in the G650ER photograph) from `stall.aoa_norm` (EST shaker at 0.85),
Vmo/Mmo barber pole (`overspeed.vmo_kt`, else the airframe Vmo/Mmo), V-speed bugs, selected /
FMS speed (magenta when FMS), altitude tape with selected altitude alerting, baro (inHg / hPa /
STD), VSI with TCAS RA band, radio altitude box, minimums (RA / BARO, MIN when reached),
deviation scales (LOC / GS green, FMS GP / VNAV magenta, preview cyan hollow), HSI arc / rose /
arc-map with course, CDI, bearing pointers (VOR / ADF / FMS), heading bug, wind, navigation
source block (FMS1, LOC1, VOR1 ...), preview course needle, sensor reversion flags (amber
"ADC 2", "IRS 3"). Sensors come from the side's selected ADC / IRS (`adc{n}.*`, `ahrs{n}.*`,
`ra{n}.*`), never from `fdm.*`.

## 7. Other windows

- **INAV map** (`mapWindow.ts`): menu bar (Map Data / Map View drop-downs, range - / +, WX,
  TERR, TCAS), MovingMap (airports, navaids, fixes, flight plan, EGPWS terrain, TOD, selected
  altitude arc), compass arc / rose, data blocks, vertical situation display with the terrain
  profile along the track (+/- 1 nm corridor, EST), selected altitude and VNAV target. Weather
  radar layer (radar controls `epic.radar.mode / tilt_deg / gain` on the TSC WEATHER app): WX
  mode draws green / yellow / red returns in the +/-60 deg scan sector, GMAP a topographic
  ground picture, OFF / STBY nothing (section 15 for the procedural returns).
- **Engine** (`engineWindows.ts`): EPR / TGT / LP dials with digital boxes, rating, target bug,
  ALT (LP control) annunciation, HP and FF digital; compacted format adds oil. **Secondary
  engine**: oil pressure / temperature, LP / HP vibration, hydraulic pressures (L, Aux, PTU, R),
  fuel tank temperatures, fuel quantity (lb).
- **CAS** (`sixthWindows.ts`): section 11, plus the trim / flap strip (pitch trim with the
  takeoff band, aileron and rudder trim, flap scale 0/10/20/39).
- **Checklist**: title, check boxes (auto-sensed items filled green), dotted leaders, cursor box,
  "Show Items", "Chklst Funct" (index, next / previous, reset list / all), "Active Abnormal",
  "Undo Items"; DATA knob moves the cursor, ENTER checks.
- **Waypoint list**: active plan from the active leg, course, cumulative distance, ETE,
  altitude constraints.
- **Synoptics** (`synoptics.ts`): Summary, AC Power, DC Power, Hydraulics, Fuel, ECS /
  Pressurization (3 or 4 zones), Doors, Flight Controls (after the G650ER photograph: pitch trim
  and stab / elevator position scales, front view with spoiler / aileron / rudder positions, WOW
  and combined WOW), Ice Protection (split WAI / CAI on the G800), Brakes (after the same
  photograph: four brake pressure bars on a 0-3000 psi scale, inboard / outboard accumulators,
  brake temperatures), APU / Bleed, Engine Start; drawn in a 341 x 394 design space and scaled x2 in
  the 2/3 window. Colours: green powered / flowing / open, white or grey off / closed, amber
  faults (EST schematics).

## 8. Guidance panel (`logic/guidance.ts`)

`GP_CONTROLS` lists every control. Buttons (`epic.gp.<id>`) -> AFCS: `fd1`/`fd2` -> `ap.fd1/2`,
`ap` -> `ap.ap`, `yd` -> `ap.yd`, `hdg_btn` -> `ap.hdg`, `hdg_push` -> `ap.hdg_sync`, `nav` ->
`ap.nav`, `apr` -> `ap.apr`, `bc` -> `ap.bc`, `lowbank` -> `ap.half_bank`, `flch` -> `ap.flc`,
`vs_btn` -> `ap.vs`, `fpa` -> `ap.fpa`, `vnav` -> `ap.vnav` (only with the FMS as the coupled
source), `alt_btn` -> `ap.alt`, `spd_push` -> `ap.spd_mach`, `at` -> `at.engage`; `man` toggles the
speed source (MAN / FMS), `pfdcmd` swaps the coupled side, `crs{1,2}_push` = course direct,
`baro{1,2}_push` = STD. Knobs (`<id>_inc/_dec`): `hdg`, `crs1/2` (on-side receiver OBS +
`ap.sel_crs{s}_deg`), `spd` (kt or Mach), `alt` (1000 ft) / `alt_fine` (100 ft), `vs` (AFCS
`ap.up/dn` in VS / FPA / PIT), `baro1/2`. Lights: `GP_LIGHTS` (AFCS `ap.btn_*`, FD, A/T, MAN).

The AFCS always follows the coupled side's NAV SRC (`ap.nav_source`). APR with the FMS as the
source and an ILS / LOC / LDA / SDF / IGS approach in the active plan tunes the on-side NAV
receiver, sets its course and switches NAV SRC to that receiver before arming (QA lesson:
the AFCS must fly the LOC, not the FMS path). Within 75 nm along the plan and 30 nm direct of
the destination (code450) the receivers are auto-tuned and the PFD shows cyan preview needles.
Windows (`windows.speed / heading / vsfpa / altitude`, legends) are cached strings; the
`GpWindowDisplay`s draw them (amber LCD on PlaneView, blue-white on the GP-700, EST).

## 9. Display controller, SMC and standby displays

`DisplayControllerLogic` pages (`DC_MENU`): PFD (FPV, SVS, HSI format, BRG 1/2, MINS source and
value, BARO unit, NAV SRC), MAP (range, orientation, terrain, WX, TCAS, centre, VSD, airports,
navaids), SENSOR (ADC, IRS, FMS source), FLT REF (V-speeds, show), TEST (HUD, RAD ALT, STALL -
pilot shaker then copilot shaker, TCAS, EGPWS, TONE, AP DISC), CHKLST, 1/6-2/3 (synoptics and
windows into the side's MFD: 2/3, upper or lower), TRS (thrust rating), NAV (source, FMS, DME
hold, NAV frequency and course), HUD (on, declutter, brightness, EVS on the PFD). LSK 1-5 left, 6-10 right; the
SET knob adjusts the selected item, else the PFD map range. PlaneView SMCs return to the standby
instrument after 30 s (EST). Symmetry uses the same pages on the TSC "Display Control" app.

`SmcDisplay`: standby instrument (standby ADC / AHRS: attitude, speed, altitude, baro, heading)
or the controller page. `SfdDisplay`: touch standby instrument; the baro field opens - / + /
STD / unit keys (keys act on finger lift).

## 10. CCD (`logic/cursor.ts`)

Pilot cursor green `+` on DU 1-3, copilot cyan `x` on DU 2-4; the touch pad moves it (gain 1.6
EST) across DU edges, DU keys jump, ENTER / MENU / DATA go to the window under the cursor; the
hot spot under a cursor draws with a blue fill and white outline; the cursor hides after 20 s
(EST) and when the CCD is unpowered.

## 11. CAS and checklist

`GulfstreamCas` wraps a `CasModel` (register it as a `CasManager` sink): warnings pinned and
never scrolled, only acknowledged cautions and advisories scroll, a status bar shows the number
hidden above / below, a new caution recalls all scrolled messages and a new advisory the
scrolled advisories (G550 OM). New warnings / cautions flash inverse video until acknowledged
(EST). `GULFSTREAM_CAS_TEXTS` lists published message texts. "Selectable CAS messages" (FSB
GVIII-G700 ECL philosophy): ENTER on a CAS message opens the checklist whose title matches the
message (`ChecklistLogic.findForCas`) in the side's MFD 2/3 window (EST placement) and reverts a
full MAP.

`ChecklistLogic`: manual checks advance the cursor, closed-loop items auto-sense at 4 Hz, Undo,
Show Items (remaining only), first abnormal / emergency list, completion var.

## 12. FMS / MCDU (`fms/`)

`FmsShared` (one per aircraft: the `Fms`, PERF INIT data, message queue, procedure cache) and
`Mcdu` (one per MCDU or TSC FMS app: scratchpad, CLR / DEL, LSK dispatch, page refresh). Pages
(`EPIC_CDU_PAGES`): FPL (origin / destination, legs with course / distance / constraints,
insert / delete, speed-altitude constraints, MOD FLT PLAN with CANCEL MOD / ACTIVATE), DEP/ARR
index, DEPARTURE (runway, SID, transition), ARRIVAL (approach, transition / vectors, STAR),
DIRECT-TO, HOLD, ROUTE, NAV INDEX, NAV IDENT, POS INIT, POS SENSORS, PERF INDEX, PERF INIT (3
pages, CONFIRM INIT), VNAV, PROGRESS, FUEL MGT, RADIO 1/2 and 2/2 (COM 1-3, NAV 1-2, DME hold,
ADF, HF, XPDR code / mode / unit, COM3 data), MESSAGES, DATALINK, MCDU MENU, STBY ENGINE, BKUP
RADIO. Function keys: FPL, NAV, PERF, PROG, DIR, RADIO, MSG, DLK, MENU, PREV, NEXT. Entry
formats: `parseAltitude`, `parseSpeedPair`, `parseComFreq`, `parseNavFreq`, `parseAdfFreq`,
`parseHfFreq`, `parseSquawk`, `parseLatLon`. Page layouts are EST (no public page drawings).

## 13. Symmetry touch screens

`TouchScreenLogic` (pages of plain-data widgets, action on finger lift over the same widget,
guarded functions need a confirmation tap within 4 s, page history) and `TouchDisplay` (renders
the widgets). TSC apps (`buildTscPages`): HOME, RADIOS (+ keypad), FMS (hosted MCDU with soft
LSKs, function keys and keyboard), CHECKLIST, DISPLAY (controller pages), SYNOPTIC (windows on
the side's MFD), GUIDANCE (targets and mode keys through `GuidancePanelLogic`), WEATHER (radar
mode, tilt, gain), XPDR / TCAS (code, mode, IDENT, ATC 1/2, TCAS test), UTILITY (chronometer, DU
brightness). The pedestal TSCs start on the FMS app.

Overhead: `overheadPanels(airframe)` defines ELEC, FUEL, HYD, ECS, ICE, LIGHTS, ENGINE panels
(controls, positions, momentary / guarded / continuous, status readouts). `buildOverheadPages`
turns them into OHPTS touch pages (default pages ELEC / FUEL / ECS on the three screens);
`addOverheadSwitches` turns them into PlaneView hardware switches. Both write the vars of
`GULFSTREAM_OVERHEAD_VARS`, e.g. `ac.elec.batt_l_sw`, `ac.elec.gen_l_sw`, `ac.fuel.boost_l_sw`
(0 OFF, 1 AUTO, 2 ON), `ac.fuel.xflow_sw`, `ac.hyd.aux_pump_sw`, `ac.bleed.iso_sw`,
`ac.ecs.zone{1..4}_temp_c`, `ac.press.mode_sw`, `ac.ice.wing_l_sw` / `_r_sw` and
`ac.ice.cowl_l_sw` / `_r_sw` (EST: the G650 has single WING and COWL switches that write both
sides' vars, inferred from the FSB "increased number of anti-ice switches" G800 difference), `ac.light.nav_sw`, `ac.eng.start_l_btn`
(momentary), `ac.oxy.crew_sw` ... (full list in `logic/overhead.ts`; `overheadVars` renames or
hides entries).

## 14. Cockpit hardware (`cockpit.ts`)

All helpers place the unit centred at (x, y) in the parent panel convention:

| Helper | Creates |
|---|---|
| `addDisplayUnits(panel, suite, [[x, y] x4])` | four DU screens with bezels (0.282 x 0.217 m) |
| `addGuidancePanel(b, panel, x, y, suite)` | GP sub-panel: 4 LCD windows, BARO / CRS knobs with push, speed / heading / altitude (outer 1000 / inner 100) knobs, VS wheel, lit mode keys, PFD CMD with L / R arrows |
| `addSmc(b, panel, x, y, suite, side)` | PlaneView SMC: screen, 2 x 5 LSKs aligned to the screen rows, 10 function keys, STBY key, SET knob |
| `addMcdu(b, panel, x, y, suite, n)` | PlaneView MCDU: screen, 12 LSKs, function keys, alphanumeric keyboard (PC keyboard when focused), MSG light |
| `addCcd(b, panel, x, y, suite, side)` | CCD: drag touch pad (`CcdTouchPad`, pointer lock), ENTER, MENU, DU keys, concentric DATA knob |
| `addTsc / addOhpts / addSfd(panel, x, y, suite, n)` | Symmetry touch screens with bezels |
| `addCasScrollSwitch(b, panel, x, y)` | spring-loaded UP / DN CAS scroll toggle |
| `addDisplaySwitching(b, panel, x, y)` | MFD DISPLAY SWITCHING L / R and DISPLAY SYSTEM CONTROL DU 1-4 |
| `addOverheadSwitches(b, panel, x, y, def)` | PlaneView overhead switch rows from an `OverheadPanelDef` |

## 15. Scope limits and estimates

- SmartView is a range-banded terrain silhouette (painter's algorithm over `elevationAt`
  samples, 4 Hz) without runways, obstacles or terrain-alert colours.
- Weather-radar returns are procedural cells (the sim has no discrete precipitation cells):
  their density and intensity follow `env.precip`, `env.cloud_cover` and the radar gain; no
  attenuation or tilt geometry. No datalink weather, no charts, no map panning. Traffic symbols
  need a `TrafficSource` in the aircraft's TCAS (none exists).
- The HUD is not drawn (the HUD page only keeps `epic.hud.*` state for a HUD module). EVS on the
  PFD is the same terrain model drawn as a monochrome picture to 8 nm (EST), without runway
  lights, heat sources or weather attenuation.
- Automatic checklist call-up by a new CAS message is not modelled (selecting the message
  opens it; the window manager's `checklistCalledUp()` hook exists).
- The fifth Symmetry TSC is not modelled; the Symmetry FMS app hosts the MCDU page set rather than
  Symmetry's graphical FMS pages.
- Overhead hardware switches carry no annunciator legends (status on the synoptics / CAS).
- EST values: DU boot time (25 s), CCD gain and park time, SMC return-to-standby time, FMA box
  time, V-speed / VNAV deviation scaling (500 ft full scale), flap placards, EPR dial range and
  EPR-from-N1 curve, page line layouts, synoptic drawings, hardware sizes and layouts, colours.
