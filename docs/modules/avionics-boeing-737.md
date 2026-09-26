# Boeing 737NG avionics (`src/avionics/boeing-737`)

The 737-800 (NG) flight deck electronics as one suite: the Common Display System (six display
units, two display electronics units, EFIS control panels, display select and instrument transfer
switches), the Smiths / GE FMC (U10.x style) with two CDUs, and the Mode Control Panel with the
737 AFDS and autothrottle logic built on `src/systems/autopilot` and `src/systems/fadec`.

```ts
import {
  createB737Suite, addDisplayUnits, addMcp, addEfisPanel, addDisengageLights, addDisplaySelect,
  addDuBrightness, addCentreControls, addCdu, addTransferSwitches, B737_VARS, B737_EVENTS,
} from '../../avionics/boeing-737';
```

Tests: `tests/avionics/boeing-737/*.test.ts` (48 tests, about 5 s; they load the real navigation
database from `public/data`):

| File | Covers |
|---|---|
| `cds.test.ts` | DU format routing (NORM, MAIN PANEL DUs, LOWER DU, MFD ENG/SYS, power-up and exceedance secondary display, DU and DEU failures, DSPLY SOURCE / CDS FAULT, transfer switches), EFIS panel (map buttons, WXR/TERR exclusion, range, CTR, BARO / STD / preselect, MINS) |
| `cdu.test.ts` | Scratchpad rules, INVALID ENTRY, per-CDU pages, RTE entry + ACTIVATE + EXEC, MOD / ERASE, LEGS direct-to with INTC CRS, PERF INIT MOD + EXEC, TAKEOFF REF QRH speeds and deletion on CG change, N1 LIMIT derate + assumed temperature, CLB / CRZ / DES titles, DEP/ARR SID selection, HOLD, FIX INFO, FMC failure |
| `mcp.test.ts` | MCP knobs and windows, bank angle selector, C/O, MCP power, HDG SEL / ALT HOLD (incl. the ALT HLD light rule), CMD A/B and the DISENGAGE bar, A/P disconnect light, LVL CHG -> ALT ACQ -> ALT HOLD, V/S and the wheel steps, VOR/LOC + APP arming and capture, dual-channel LAND 3 / FLARE / ROLLOUT, LNAV / VNAV ground arming (50 / 400 ft RA), SPD INTV, A/T N1 / MCP SPD, light TEST |
| `suite.test.ts` | Suite composition, DU rendering, power bindings (DU, CDU screen, receivers), state presets, cockpit hardware build, MCP / CDU controls driving the logic |

Development previews (not bundled; run `npx vite --port 5199`):

- `src/avionics/boeing-737/dev/preview.html?state=cruise|approach|start` draws the six DUs side
  by side (`&mfd=1|2`, `&mode2=0..3`, `&ctr2=1`, `&dus=capt_out,upper`, `&cdu=KEY,KEY,T:text`
  also shows the CDUs).
- `src/avionics/boeing-737/dev/deck.html?view=main|mcp|cdu` builds the hardware with the cockpit
  library and renders it with Three.js.
- `node src/avionics/boeing-737/dev/shoot.mjs "<query>" out.png [selector] [w] [h]` screenshots
  either page (`PAGE=deck` for the hardware page).

## Contents

1. Sources and accuracy conventions
2. Integration (737-800 aircraft agent)
3. Configuration (`config.ts`)
4. Vars and events (`vars.ts`)
5. Common Display System (`cds/`)
6. PFD, ND, engine and systems formats
7. FMC and CDU (`fmc/`)
8. MCP, AFDS and autothrottle (`afds/`, `mcp/`)
9. Cockpit hardware (`cockpit.ts`)
10. Scope limits and estimates

## 1. Sources and accuracy conventions

Numbers in the code carry their source in a comment. `EST:` marks estimates with the reasoning,
and `SCOPE:` marks deliberate simplifications. The main public sources are:

- **Airframe**: FAA TCDS A16WE (737-800: MTOW 79,016 kg, MLW 66,361 kg, MZFW 62,732 kg, Vmo 340
  KIAS / Mmo 0.82, 41,000 ft); SmartCockpit "B737NG Generic Limitations" (fuel capacities, gear
  speeds, hydraulic 3,000 psi); 737-800 flap placard (1/2/5: 250, 10: 210, 15: 200, 25: 190, 30: 175,
  40: 162 kt); b737.org.uk "Flap-Speed Schedule" (maneuver speed weight bands). These are in
  `data/b738.ts`.
- **Engine**: EASA TCDS E.004 (CFM56-7B: N1 100 % = 5,175 rpm, max 104 %; N2 100 % = 14,460 rpm,
  max 105 %; EGT take-off 950 °C, max continuous 925 °C, start 725 °C; oil temperature 140 / 155 °C;
  minimum oil pressure 13 psi; -7B26 26,300 lbf); b737.org.uk "Powerplant". These are in
  `data/cfm56.ts`.
- **Displays, FMC, AFDS**: Boeing 737NG FCOM chapters 4 (Automatic Flight), 7 (Engines), 10
  (Flight Instruments, Displays) and 11 (FMS), in the versions circulating as training material;
  SmartCockpit "Boeing 737 Systems Review - Automatic Flight" [AFS]; b737.org.uk pages "Flight
  Instruments - NG", "AFDS", "FMC", "EFIS", "Powerplant"; flight deck photographs (b737.org.uk, Wikimedia
  Commons "737NG Navigation Display") for layouts. Where the photographs are ambiguous, positions
  are EST.
- **Performance** (`data/perf.ts`): Boeing FPPM / QRH tables are not public. V-speeds, VREF, ECON
  speeds, LRC, optimum / maximum altitude and buffet limits are physics-shaped estimates fitted to
  published training values (for example take-off speeds of about 140/142/148 kt at 65 t flaps 5,
  and VREF30 of about 145 kt at 60 t). Every function there is marked EST.

## 2. Integration

```ts
// In the 737-800 aircraft module's create(ctx):
const b737 = createB737Suite(ctx, {                       // ctx: SimContext (vars, events, nav, world, audio)
  power: {
    du: { capt_out: 'elec.ac_stby_powered', capt_in: 'elec.ac_stby_powered', upper: 'elec.ac_stby_powered',
          lower: 'elec.xfr2_powered', fo_in: 'elec.xfr2_powered', fo_out: 'elec.xfr2_powered' },
    deu1: 'elec.ac_stby_powered', deu2: 'elec.xfr2_powered',
    fmc: 'elec.xfr1_powered', cdu1: 'elec.xfr1_powered', cdu2: 'elec.xfr2_powered',
    mcp: 'elec.dc1_powered', efis1: 'elec.dc1_powered', efis2: 'elec.dc2_powered',
    nav1: 'elec.xfr1_powered', nav2: 'elec.xfr2_powered', adf1: ..., adf2: ..., gps: ..., marker: ...,
  },
  vars: { fuelLeftKg: 'fuel.tank0_kg', hydAPsi: 'hyd.a_psi', ... },      // see B737DisplayVars
  afds: { leverVar: (e) => `ac.tla${e}`, gains: { ... } },              // FBW-less 737: tune the Afcs gains
  trafficSource: tcas,                                                 // systems/warning Tcas (optional)
});
systems.push(elec, fuel, hyd, sensors, ...b737.systems, flightControls, ...);
failureManager.register(b737.failures());
// Cockpit: place b737.du / b737.cduDisplays / b737.mcpWindows with the cockpit.ts helpers (§9).
// AircraftInstance.applyState(state): ... b737.applyState(state);
inputMap.apToggleEvent = B737_EVENTS.mcpButton('cmd_a');   // generic AP key -> CMD A
inputMap.atDisconnectEvent = 'at.disc';                    // thrust lever A/T disconnect switches
// Control wheel A/P disconnect: event 'ap.disc'; thrust lever TO/GA switches: 'ap.toga'.
```

What the suite creates:

| Member | What it is |
|---|---|
| `radios` | `nav/Radios` (2 VHF NAV, 2 ADF, marker, GPS) unless `config.radios` is given; it is in `systems` only when the suite created it |
| `fms` | `nav/fms/Fms` in Boeing style (MOD + EXEC) unless `config.fms` is given. Same rule |
| `efis` | `EfisPanels` (both EFIS control panels) |
| `cds` | `CdsLogic` (DU routing, DEUs, transfer switches, N1 SET / SPD REF / FUEL FLOW) |
| `fmc`, `cdus[0..1]` | `B737Fmc` and the two `Cdu`s (null / empty without a navigation database) |
| `afds` | `B737Afds`: MCP, `Afcs` (preset `AFCS_B737_AFDS`), `Autothrottle` ('boeing'), FMA, lights |
| `du[0..5]` | `DisplayUnit`s in `DU_IDS` order: `capt_out, capt_in, upper, lower, fo_in, fo_out` (800 x 800) |
| `cduDisplays[0..1]` | CDU screens (560 x 480) |
| `mcpWindows[0..5]` | MCP windows: CRS L, IAS/MACH, HDG, ALT, V/S, CRS R |
| `systems` | `[radios?, fms?, 'b737_cds', 'b737_afds']`, in update order |

The `'b737_cds'` subsystem writes the power bindings (receiver `powered` vars, CDU and MCP window
display power) and then runs the EFIS panels, the CDS routing, the FMC and the CDUs.
`'b737_afds'` runs after it, so the AFDS sees the FMC targets of the same step.

State presets (`applyState`): every state disengages the A/P and A/T, puts the EFIS panels in MAP
(10 nm on the ground, 40 nm in the air) with TFC on, and clears the MFD. `cold_dark` switches the
F/Ds and A/T ARM off and sets the MCP to its power-up values (100 kt, heading 000, 0 ft). The
first power-up then shows the secondary engine display automatically. `ready_to_taxi` and
`takeoff` switch the F/Ds on and arm the A/T; `takeoff` also sets the MCP speed to V2 when the FMC
has one. For `cruise` and `approach`, the aircraft module engages CMD and the modes itself after
trimming.

The FMC selects the N1 rating and sends it to the aircraft's thrust rating computer through the
events `fadec.rating` (`'TO'`, `'TO-1'`, `'CLB-2'`, `'CRZ'`, `'GA'`, `'CON'`...; mapped with
`config.n1RatingIds`) and `fadec.assumed_temp`. The aircraft's TRC must not run its own `auto`
selection. The engine displays read `fadec.rating`, `fadec.n1_limit_pct` and
`fadec.assumed_temp_c`.

## 3. Configuration (`config.ts`)

`B737Config` (every field is optional; `resolveB737Config` fills the defaults):

| Field | Default | Meaning |
|---|---|---|
| `aircraftId`, `model`, `engineRating` | `'b737-800'`, `'737-800W'`, `'26K'` | IDENT page |
| `weightUnit` | `'kg'` | FMC and fuel display units (`'lb'` supported) |
| `autoland` | `'fail-operational'` | `LAND 3` / `LAND 2` / `ROLLOUT`; `'fail-passive'` = FLARE only, no ROLLOUT |
| `cduKeys` | `'menu'` | U10 MENU key, or `'dir-intc'` (older DIR INTC key) |
| `cduScreen` | `'color'` | colour LCD CDU, or `'green'` monochrome CRT |
| `oilQtyUnit` | `'qt'` | secondary engine display oil quantity |
| `pfdAoaGauge` | false | customer option AOA gauge on the PFD |
| `fdDisplay` | `'split-axis'` | F/D crossbars, or the `'single-cue'` option (magenta V-bar; the airplane symbol is not changed to the delta: SCOPE) |
| `power: B737PowerConfig` | all powered | bindings (systems-power §1.1 expression language) per DU, DEU 1/2, FMC, CDU 1/2, MCP, EFIS 1/2, NAV 1/2, ADF 1/2, GPS, marker |
| `vars: Partial<B737DisplayVars>` | `DEFAULT_DISPLAY_VARS` | the aircraft var names the displays read: fuel tanks (tank0 = main 1, tank1 = main 2, tank2 = centre), centre pumps off, engine running / start valve / oil filter bypass / oil quantity / vibration / start lever / EEC power per engine, hydraulic A/B pressure and quantity, flaps, gear, air/ground, AOA norm and stick shaker threshold, Vmo var, radio altimeter indices, TCAS RA / TA / status, EGPWS alert vars |
| `radios`, `fms`, `radiosOptions`, `fmsOptions` | created | reuse the aircraft's own receivers / FMS, or options for the created ones |
| `adiru` | `[1, 2]` | ADC / AHRS indices of the left / right ADIRU |
| `afds: B737AfdsConfig` | created | `create`, `power`, `servoPower` (default A/P A on hydraulic A, A/P B on hydraulic B, > 1,000 psi; missing vars = powered), `engageInhibit`, `autoDisconnect`, `atPower`, `leverVar`, `gains`, raw `afcs` / `autothrottle` overrides |
| `companyRoutes` | `{}` | CO ROUTE names for the RTE page (`'TEBBOS': 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS'`) |
| `trafficSource` | null | TCAS threat list for the ND traffic symbols |
| `weatherOverlay` | null | weather radar drawing hook under the ND symbology (no radar model: SCOPE) |
| `navDataName`, `opProgram` | cycle-derived, `'549849-014'` | IDENT page |
| `n1RatingIds` | identical ids | FMC rating -> aircraft TRC rating id |
| `duPixelRatio` | 1 | DU texture scale |

## 4. Vars and events (`vars.ts`)

All aircraft-specific state uses the `ac.` prefix. Side 1 = Captain, side 2 = F/O. Switches and
selectors write **input vars**. The suite follows external writes every update, so state presets
and cockpit controls can set them directly. Momentary buttons and knob encoders emit **events**,
and a knob event's payload is its click count.

**EFIS control panel** (`B737_VARS.efis*(s)`; events `B737_EVENTS.efis*(s)`):

| Var | Values |
|---|---|
| `ac.efis{s}.mins_ref` | 0 RADIO, 1 BARO (outer ring) |
| `ac.efis{s}.mins_radio_ft`, `mins_baro_ft` | minimums (-1 = blank); events `mins_inc/dec` [clicks], `mins_rst` |
| `ac.efis{s}.baro_hpa` | 0 IN, 1 HPA; events `baro_inc/dec` [clicks], `baro_std` (STD / preselect) |
| `ac.efis{s}.baro_presel_inhg` | preselected setting shown under STD |
| `ac.efis{s}.fpv`, `mtrs` | 0/1, events `fpv_push`, `mtrs_push` |
| `ac.efis{s}.nd_mode` | `NdMode`: 0 APP, 1 VOR, 2 MAP, 3 PLN; `ctr` 0/1 (event `ctr_push`) |
| `ac.efis{s}.range` | detent 0..7 = 5, 10, 20, 40, 80, 160, 320, 640 nm; `range_nm` output; `tfc` (event `tfc_push`) |
| `ac.efis{s}.vor_adf1`, `vor_adf2` | -1 ADF, 0 OFF, 1 VOR |
| `ac.efis{s}.wxr` / `sta` / `wpt` / `arpt` / `data` / `pos` / `terr` | 0/1, events `<name>_push` (WXR and TERR exclude each other) |

The EFIS panels write `adc{n}.baro_inhg` / `adc{n}.baro_std` of their side's air data and
`ap.mins{s}_ft` / `ap.mins{s}_is_ra` for the TAWS minimums callout.

**Display select, MFD, transfer switches** (inputs): `ac.cds.main_panel_dus{s}` (`MainPanelDuSel`
0 OUTBD PFD, 1 NORM, 2 INBD ENG PRI, 3 INBD PFD, 4 INBD MFD), `ac.cds.lower_du{s}` (`LowerDuSel` 0
ENG PRI, 1 NORM, 2 ND), `ac.cds.source_sel` (DISPLAYS SOURCE -1 ALL ON 1 / 0 AUTO / 1 ALL ON 2),
`ac.cds.ctl_panel_sel` (CONTROL PANEL), `ac.cds.vhf_nav_sel`, `ac.cds.irs_sel`, `ac.cds.fmc_sel` (all
-1 / 0 / 1). Events: `ac.mfd.eng`, `ac.mfd.sys`, `ac.mfd.cr`.

**CDS outputs**: `ac.cds.<du>.format` (`DuFormat`: 0 blank, 1 PFD, 2 ND, 3 primary engines, 4
secondary engines, 5 SYS, 6 compact engines), `.side`, `.failed`, `.deu`; `ac.cds.deu{n}_ok`,
`ac.cds.dsply_source` (+ `_n`), `ac.cds.fault` (CDS FAULT), `ac.cds.efis_src{s}`,
`ac.cds.adc_src{s}`, `ac.cds.nav_src{s}`, `ac.cds.eng2_auto`. DU power / brightness:
`display.b737_du_<du>.power` (written) / `.brt` (brightness knobs).

**Centre panel**: `ac.n1set.sel` (0 AUTO, 1 BOTH, 2 ENG 1, 3 ENG 2) + `ac.n1set.eng{e}_pct`,
events `ac.n1set.inc/dec`; `ac.spdref.sel` (0 AUTO, 1 V1, 2 VR, 3 WT, 4 VREF, 5 B, 6 SET) with
`ac.spdref.v1_kt/vr_kt/vref_kt/bug_kt/wt_kg`, events `ac.spdref.inc/dec`; `ac.ff_switch` (-1 RESET,
0 RATE, 1 USED) and `ac.eng{e}.fuel_used_kg`.

**MCP**: selected values in the standard `ap.*` vars (`ap.sel_spd_kt`, `ap.sel_mach`,
`ap.spd_is_mach`, `ap.sel_hdg_deg`, `ap.sel_alt_ft`, `ap.sel_vs_fpm`, `ap.sel_crs{s}_deg`,
`ap.bank_sel_deg`, `ap.fd{s}_on`), A/T ARM `ac.at_arm` (the A/T releases it), DISENGAGE bar
`ac.mcp.disengage_bar`. Events (`B737_EVENTS`): `ac.mcp.<button>` for `n1 speed co lvlchg vnav
hdgsel lnav vorloc app althld vs cmd_a cmd_b cws_a cws_b`, knobs `ac.mcp.crs{s}_inc/dec`,
`spd_inc/dec`, `hdg_inc/dec`, `alt_inc/dec` (100 ft per click), `vs_up/vs_dn` (wheel UP = nose
down), `bank_inc/dec`, pushes `spd_intv`, `alt_intv`. Outputs: window strings
`ac.mcp.win_crs{s}/win_spd/win_hdg/win_alt/win_vs`, `ac.mcp.spd_limit` (flashing 8 / A), button
lights `ac.mcp.lt_<name>` (plus `lt_at_arm`), `ac.mcp.ma{s}`, `ac.mcp.spd_intv`, `spd_blank`,
`vs_blank`, PFD speed cursor `ac.mcp.spd_cursor_kt/mach`.

**FMA / AFDS lights**: strings `ac.fma.at`, `roll`, `roll_armed`, `pitch`, `pitch_armed`,
`status`; `ac.fma.roll_amber/pitch_amber/status_amber`; `ac.afds.ap_light`, `at_light`,
`fmc_light` (0 off, 1 red, 2 amber, flash already applied); `ac.afds.light_test` (-1 TEST 1 amber,
1 TEST 2 red); `ac.afds.stab_out_of_trim`. Events `ac.afds.ap_light_push`, `at_light_push`,
`fmc_light_push`.

**FMC / CDU**: outputs `ac.fmc.v1_kt/vr_kt/v2_kt/vref_kt/vref_flaps/to_flaps/gw_kg/zfw_kg/ci/
trans_alt_ft/trans_lvl_ft/ldg_elev_ft/exec_light/anp_nm/rnp_nm/clb_mode/crz_mode/des_mode/failed/
des_now/thr_red_ft/accel_ht_ft/origin_elev_ft/n1_rating/perf_valid`; `ac.cdu{s}.msg_light`,
`ofst_light`, `fail_light`, `brt`. CDU keys: event `ac.cdu{s}.key` with the key id as payload
(`L1..L6 R1..R6 INIT_REF RTE CLB CRZ DES MENU|DIR_INTC LEGS DEP_ARR HOLD PROG EXEC N1_LIMIT FIX
PREV_PAGE NEXT_PAGE A..Z 0..9 SP DEL / CLR +/- .`), plus `ac.cdu{s}.CLR:up` (CLR held 1 s clears the
line).

**Failures** (`suite.failures()`, state var `fail.<id>`): `b737.du_<du>` (six DUs), `b737.deu1`,
`b737.deu2`, `b737.fmc`, and the Afcs / autothrottle failures (`afcs`, `afcs.servo_pitch`,
`afcs.servo_roll`, `at`).

## 5. Common Display System (`cds/CdsLogic.ts`, `cds/EfisPanels.ts`, `cds/DisplayUnit.ts`)

Routing (FCOM 10.10 "Display System"; b737.org.uk "Flight Instruments - NG"):

| Control | Effect |
|---|---|
| MAIN PANEL DUs NORM | outboard = PFD, inboard = ND. When the outboard DU fails, the PFD moves to the inboard DU automatically |
| OUTBD PFD | outboard PFD, inboard blank |
| INBD ENG PRI | inboard = primary engines, upper DU blank |
| INBD PFD | inboard PFD, outboard blank |
| INBD MFD | inboard = MFD format (secondary engines / SYS), lower DU blank |
| LOWER DU ENG PRI | lower = primary engines (compact when the secondary is also wanted), upper blank |
| LOWER DU ND | lower = the selecting side's ND (the selector moved last wins) |
| Upper DU failed | primary engines move to the lower DU |
| Secondary engines wanted, lower DU unavailable | compact engine format on the upper DU |
| MFD ENG / SYS | toggle the secondary engine / systems format on the lower DU |
| Secondary engine automatic display | first power-up, a secondary exceedance lasting more than 1 s (N2 red line, oil pressure at the red line, oil temperature amber, vibration 4.0), or an engine failed / shut down in flight (FCOM 7.10) |
| DEUs | DEU 1 drives the Captain's DUs and the upper DU; DEU 2 drives the F/O's DUs and the lower DU. A failed DEU is replaced automatically by the other. In the air the PFDs show DSPLY SOURCE; on the ground before both engines run, CDS FAULT |
| DISPLAYS SOURCE ALL ON 1 / 2 | one DEU drives every DU, DSPLY SOURCE 1 / 2 |
| CONTROL PANEL BOTH ON 1 / 2 | one EFIS panel drives both sides |
| IRS BOTH ON L / R, VHF NAV BOTH ON 1 / 2 | the PFD / ND of both sides use one ADIRU / VHF NAV receiver |

DUs refresh at 30 Hz for the PFD / ND and 15 Hz for the other formats. They boot for 2 s after
power-up. An unpowered DU (binding, failure, no DEU) is black.

## 6. PFD, ND, engine and systems formats

**PFD** (`cds/Pfd.ts`): The FMA sits at the top. It has A/T, roll and pitch columns (engaged modes
green, armed modes white below them, and a 10 s white box around a newly engaged mode) and the
AFDS status (FD / CMD / CWS / SINGLE CH amber / LAND 3 / LAND 2 / NO AUTOLAND amber). The speed
tape has a rolling readout, the selected speed (magenta readout and cursor), a 10 s speed trend
vector, the Vmo and stick shaker barber poles, the amber maneuver margin, V1 / VR / REF / flap
maneuver bugs, NO VSPD, and Mach or GS below the tape. The attitude display has the pitch ladder,
bank scale with pointer and slip indicator, split-axis F/D bars or the single-cue V-bar
(`fdDisplay`), FPV, PLI, rising runway, LOC / G/S deviation, marker beacon,
radio altitude, and RADIO / BARO minimums with the alert flash. The altitude tape has a 20 ft
rolling drum, the selected altitude and the altitude alert box, BARO / STD / preselect, the
minimums pointer, the landing altitude bar and MTRS readouts. The VSI has a pointer, readout,
selected V/S bug and TCAS RA bands. The heading scale shows the selected heading bug and readout,
with MAG / TRU. Flags (SPD, ALT, ATT, HDG, VERT, LOC, G/S, FD, DSPLY SOURCE) appear when the
side's sensors are invalid.

**ND** (`cds/Nd.ts`): The modes are APP, VOR, MAP and PLN, each expanded or CTR, with ranges from
5 to 640 nm. The header shows GS / TAS, the wind arrow, TRK or HDG with MAG, and either the active
waypoint (magenta) with ETA and distance or the receiver, course and DME. The map shows the
compass arc or rose, the heading pointer and selected heading bug, the track line with range
marks, the trend vector (30 / 60 / 90 s), the green altitude range arc, and the route (active
magenta, MOD white dashed, missed approach cyan) with fly-by turns and holds. It also shows
waypoints with DATA (constraint and ETA), T/C and T/D, FIX INFO circles and radials, STA / WPT /
ARPT / POS map options, EGPWS terrain (TERR: green / amber / red density dots relative to the
aircraft altitude, from `world.elevationAt`), the WXR overlay hook, TCAS traffic (TFC), the VNAV
path pointer, RNP / ANP, the FMC L/R source, and the VOR / ADF pointers and data blocks.

**Primary engines** (`cds/EngineDisplays.ts`): TAT, thrust mode (TO / R-TO / TO-1 / CLB / CRZ /
G/A / CON with the assumed temperature), N1 dials (0-110 %, red line 104 %, reference bug and
digital readout, command sector, REV amber in transit and green when deployed), EGT dials (red
950, amber 925, start limit 725 °C while starting), the START VALVE OPEN / OIL FILTER BYPASS /
LOW OIL PRESSURE alert boxes (drawn only while active), and fuel quantity for tanks 1, 2 and CTR
with LOW, IMBAL and CONFIG. **Secondary** (lower DU): N2 dials, fuel flow or fuel used (FUEL FLOW
switch), vertical oil pressure and temperature scales, oil quantity and vibration. **Compact**:
the primary format with the secondary data as digital columns. **SYS** (`cds/SysDisplay.ts`):
hydraulic A / B quantity (RF on the ground below the refill level) and pressure, and the surface
position indicator (ailerons, elevators, rudder, flight spoilers). The SYS layout is EST.

## 7. FMC and CDU (`fmc/`)

`B737Fmc` holds the data behind the pages and runs on the `nav` FMS in Boeing editing style. The
first edit creates a MOD plan, and the active plan keeps flying until EXEC or ERASE.
Performance modifications (cost index, cruise altitude, speed modes) also wait for EXEC. Page
titles show ACT / MOD and the EXEC key light is `ac.fmc.exec_light`.

Pages (`fmc/pages/*`, per-CDU page and scratchpad):

| Key | Pages |
|---|---|
| INIT REF | INIT/REF INDEX, IDENT, POS INIT / POS REF / POS SHIFT, PERF INIT (GW / CRZ CG / TRIP / CRZ ALT, PLAN / FUEL, ZFW, RESERVES, COST INDEX, CRZ WIND, ISA DEV, T/C OAT, TRANS ALT) + PERF LIMITS, TAKEOFF REF 1/2 (flaps, N1, CG and trim, QRH V1 / VR / V2 selection, runway, GW / TOW, PRE-FLT STATUS; RW WIND / SLOPE / COND, ACCEL HT, EO ACCEL HT, THR REDUCTION, SEL TEMP), APPROACH REF (GW, flaps 15 / 30 / 40 VREFs, landing reference, ILS), NAV DATA, NAV STATUS. Goes to the next unfinished pre-flight page |
| N1 LIMIT | pre-flight: SEL / OAT assumed temperature, TO / TO-1 / TO-2 and CLB / CLB-1 / CLB-2 with ACT / SEL; in flight: AUTO, GA, CON, CLB, CRZ |
| RTE | RTE 1: ORIGIN, DEST, RUNWAY, FLT NO, CO ROUTE; then VIA / TO pages with airways and DIRECT, ACTIVATE |
| DEP ARR | DEP/ARR INDEX, DEPARTURES (SIDs, transitions, runways), ARRIVALS (STARs, transitions, approaches) |
| LEGS | ACT / MOD RTE LEGS with course and distance, speed / altitude (constraints large, predictions small), direct-to and INTC CRS, delete, discontinuities, PLN mode STEP / CTR, RTE DATA (ETA, wind) |
| HOLD | hold at a route fix or PPOS: QUAD / RADIAL, INBD CRS / DIR, LEG TIME / LEG DIST, SPD / TGT ALT, EFC, HOLD AVAIL, BEST SPEED, EXIT HOLD |
| PROG | PROGRESS 1/3 (FROM / TO / NEXT, DEST ETA and fuel, fuel quantity), 2/3 (wind, XTK, VTK, TAS, SAT, fuel used), RNP PROGRESS |
| CLB / CRZ / DES | ECON (cost index speeds), MAX RATE / MAX ANGLE, LRC, selected speeds, SPD REST, OPT / MAX altitude, TURB N1, E/D, WPT / ALT, FPA / V/B / V/S, DES NOW, FORECAST |
| FIX | FIX INFO 1/2: fix, radial / distance entries, ABEAM, ETA / DTG / ALT, drawn on the ND |
| MENU | <FMC <ACT> (ACARS / DFDAU subsystems are not simulated) |

Scratchpad (FCOM 11.40): 24 characters. CLR deletes one character, or the whole line when held
1 s. DEL writes DELETE. +/- toggles the sign. INVALID ENTRY, NOT IN DATA BASE and INVALID DELETE
stay on the CDU that made the entry until CLR. FMC alerting messages (MSG light plus the amber FMC
light) and advisory messages (MSG light) show on both CDUs, and CLR removes them.

Outputs: V-speeds and VREF drive the PFD bugs. ECON / selected speeds are written into the FMS
speed schedule and give the VNAV target speeds. The N1 rating goes to the TRC. T/C and T/D go to
the ND, and the destination elevation to the PFD landing altitude bar. FMC failure
(`fail.b737.fmc` or no power) blanks the CDUs, lights CDU FAIL, and removes LNAV / VNAV guidance
from the AFDS (the AFDS forces `fms.lnav_valid` / `fms.vnav_valid` to 0).

## 8. MCP, AFDS and autothrottle (`afds/Afds.ts`, `mcp/McpWindow.ts`)

The generic `Afcs` (preset `AFCS_B737_AFDS`) provides the mode logic: CMD / CWS channels,
HDG SEL, LNAV, VOR/LOC, APP (LOC + G/S), LVL CHG (`FLC` = MCP SPD), V/S, ALT HOLD, ALT ACQ, VNAV
SPD / PTH, TO/GA, dual-channel autoland (LAND 3 / FLARE / ROLLOUT) and the disconnect warning. On
top of it, `B737Afds` adds the 737 behaviour:

- **MCP knobs**: speed 1 kt / 0.01 M, heading 1°, altitude 100 ft per click (0-50,000 ft), and a V/S
  wheel in 50 fpm steps below 1,000 fpm and 100 fpm above. Course L drives NAV 1 and course R
  drives NAV 2. The bank angle selector has 10 / 15 / 20 / 25 / 30° positions. C/O toggles IAS /
  Mach, and the MCP speed changes over automatically at FL260 [AFS].
- **LNAV / VNAV armed on the ground** (with an F/D on): LNAV engages at 50 ft RA and VNAV at 400 ft
  RA [AFS]. Before that the FMA shows them white (armed).
- **TO/GA roll annunciation** until another roll mode or CMD.
- **VNAV target speed**: V2 + 20 kt below the acceleration height, limited to the flap placard
  minus 5 kt. SPD INTV opens the IAS/MACH window and makes the MCP speed the VNAV target.
- **VNAV ALT**: capturing an MCP altitude below the FMC cruise altitude levels in VNAV ALT. VNAV
  resumes the climb or descent.
- **ALT INTV**: in cruise it sets a new cruise altitude. In climb or descent it deletes the next
  constraint between the aircraft and the MCP altitude. DES NOW starts a 1,000 fpm VNAV descent
  before T/D.
- **Windows**: IAS/MACH is blank in VNAV unless intervened. V/S is blank unless V/S is engaged. A
  flashing 8 marks overspeed limiting (flap placard / Vmo) and a flashing A marks underspeed
  limiting (0.85 × flap maneuver speed, EST).
- **Lights**: mode button lights, APP until LOC and G/S are both captured, ALT HLD off when ALT
  HOLD engaged at the MCP altitude, MA on the master F/D side, A/T ARM.
- **Disengage lights**: A/P flashes red after a disconnect until it is reset (disconnect switch or
  a push on the light). A/T flashes red after a disconnect, and flashes amber when the speed is
  not held. FMC is amber for an alerting FMC message. TEST 1 lights all amber; TEST 2 lights A/P
  and A/T red.
- **DISENGAGE bar**: disconnects the A/P and inhibits engagement. The A/P servos need hydraulic
  pressure (A/P A on system A, A/P B on system B).
- **Autothrottle** (`systems/fadec/Autothrottle`, 'boeing'): ARM, N1, MCP SPD / FMC SPD, RETARD,
  THR HLD, ARM, GA. The FMA A/T column shows `ap.at_mode`.

## 9. Cockpit hardware (`cockpit.ts`)

Each helper places its unit centred at (x, y) in the parent panel's convention and returns the
sub-panel. Every control writes a suite var or emits a suite event.

| Helper | Controls (ids) |
|---|---|
| `addDisplayUnits(panel, suite, at?)` | the six DUs (active area 0.17 m square, bezel 17 mm; default positions `B737_DU_LAYOUT`) |
| `addMcp(b, parent, x, y, suite)` | windows; `b737.mcp.crs1/crs2/spd/hdg/alt` knobs (spd push SPD INTV, alt push ALT INTV, hdg outer = bank angle); `vs_wheel`; buttons `n1 speed co vnav lvlchg hdgsel lnav vorloc app althld vs cmd_a cmd_b cws_a cws_b` with light bars; `fd1/fd2` + MA lights; `at_arm` + light; `disengage` bar |
| `addEfisPanel(b, parent, x, y, side)` | `b737.efis{s}.mins` (RADIO/BARO ring, set, RST), `fpv`, `mtrs`, `baro` (IN/HPA, set, STD), `vor_adf1/2`, `mode` (push CTR), `range` (push TFC), `wxr sta wpt arpt data pos terr` |
| `addDisengageLights(b, parent, x, y, side)` | `b737.asa{s}.ap/at/fmc` P/RST lights; `test` switch (side 1) |
| `addDisplaySelect(b, parent, x, y, side)` | `b737.dsp{s}.main` (MAIN PANEL DUs), `lower` (LOWER DU) |
| `addDuBrightness(b, panel, x, y, dus)` | `b737.brt.<du>` brightness knobs |
| `addCentreControls(b, parent, x, y)` | `b737.mfd.eng/sys/cr`, `b737.n1set`, `b737.spdref`, `b737.ffsw` |
| `addCdu(b, parent, x, y, suite, side)` | screen, `b737.cdu{s}.lskL/lskR`, `keys` (function and alpha-numeric keys, EXEC light, PC keyboard after a click), CALL / MSG / FAIL / OFST annunciators, `brt` |
| `addTransferSwitches(b, panel, x, y)` | `b737.xfr.vhf_nav/irs/fmc/source/ctl` |

The sizes (in `B737_HW`) are EST from photographs against the 8 x 8 in DU. The aircraft agent
owns the flight deck geometry, the standby instruments (ISFD), the autobrake / gear panel, the
thrust levers with the TO/GA and A/T disconnect switches, and the control wheel A/P disconnect
switches.

## 10. Scope limits and estimates

- Performance data (V-speeds, VREF, ECON, LRC, altitude capability, buffet) are physics-shaped
  estimates, not Boeing tables (§1).
- There is one FMC: FMC transfer BOTH ON L / R is stored but has no effect. There is no RTE 2,
  RTA, lateral OFFSET (OFST light always off), ENG OUT pages, step climb, ACARS / datalink (CALL
  light never lights) or uplinks. DES FORECAST winds are stored and displayed but not used by the
  VNAV path.
- The FMC position is the GPS position (no IRS / radio position mixing). ANP is the GPS EPU
  (`gps.epu_nm`), or `irs<n>.pos_err_nm` when GPS is lost; POS SHIFT shows the GPS-derived values.
- VHF NAV tuning is manual (no FMC autotuning of the ILS). VOR/LOC and APP use the receiver of the
  engaged channel.
- There is no weather radar model: the WXR button toggles the state and draws through the
  `weatherOverlay` hook when the aircraft supplies one.
- The SYS format layout is EST (no public photograph). The hydraulic quantity RF logic is
  simplified.
- A/P / A/T disengage lights use two-segment lenses (upper legend red, lower legend amber) instead
  of a single lens that changes colour.
- The DU brightness knobs control the whole DU. The separate WXR / TERR brightness (inner knobs)
  is not modelled.
- MCP light bar colour (green) and window font are EST from photographs.
