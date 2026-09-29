# Collins Pro Line Fusion: Bombardier Global Vision Flight Deck (`src/avionics/collins-fusion`)

The suite models the Rockwell Collins Pro Line Fusion avionics as installed in the Bombardier
Global 5000 / 6000 **Global Vision Flight Deck** (BD-700-1A10 / 1A11), configured for the Global
6000 with Rolls-Royce BR700-710A2-20 engines.

| Unit | Model |
|---|---|
| 4 Adaptive Flight Displays (AFD-6520, 15.1 in landscape) | T arrangement: AFD 1 pilot PFD, AFD 2 upper centre, AFD 3 lower centre, AFD 4 copilot PFD. Each AFD shows one full window, two halves, or halves split into quarters. |
| FCP-5120 flight control panel (glareshield) | mode keys, HDG / CRS 1 / CRS 2 / SPD / ALT knobs, pitch wheel, EDM, CPL |
| 2 CTP-6000 control tuning panels (glareshield) | radios, PFD settings (NAV SRC, bearings, SVS, HSI format, baro unit), standby HSI, BARO and MINS knobs |
| 2 CCP-6000 cursor control panels (pedestal) | trackball, ENTER / MENU / BACK, display select, DATA knob |
| 2 MKP-6000 multifunction keyboards | FMS scratchpad, FMS page keys, CHK/SYS, CAS scroll, display memories |
| 2 RSP reversion switch panels | ADC, ATT/HDG, DSPL; AFCS 1 / 2 |
| IESI | standby attitude / airspeed / altitude / heading with its own baro knob |

```ts
import {
  createFusionSuite, GLOBAL6000_AIRFRAME, BR710A2_20_ENGINES, GLOBAL_CAS_TEXTS,
  addAfds, addFcp, addCtp, addCcp, addMkp, addRsp, addIesi, FUSION_HW, FUSION_VARS, FUSION_EVENTS,
} from '../../avionics/collins-fusion';
```

Tests: `tests/avionics/collins-fusion/*.test.ts` (53 tests: window layout and reversion,
CCP cursor model, FCP event map / APPR nav-to-nav transfer / EDM, CTP tuning and PFD settings,
RSP sources, CAS list, checklist, synoptic readout bindings, suite composition with a fake
canvas (every window content in every slot size, menus, MKP keys, timers), FMS entry flows
against the real navigation database and nav `Fms`, map graphical flight planning, cockpit
hardware). Visual check: `src/avionics/collins-fusion/dev/preview.html` (section 13).

## Contents

1. Sources and accuracy conventions
2. Integration (Global 6000 aircraft agent)
3. Configuration (`config.ts`)
4. SimVars and events (`vars.ts`)
5. Displays, windows, layout and reversion (`logic/layout.ts`, `displays/afd.ts`)
6. CCP cursor model (`logic/cursor.ts`)
7. PFD (`displays/pfd.ts`, `displays/svs.ts`)
8. EICAS and CAS (`displays/eicas.ts`, `logic/cas.ts`)
9. Multifunction windows: map, FMS, systems, checklist, VSD, charts, EVS
10. Glareshield and pedestal panels: FCP, CTP, MKP, RSP, IESI
11. FMS (`fms/`)
12. Cockpit hardware (`cockpit.ts`)
13. Development preview and verification
14. Scope limits and estimates

## 1. Sources and accuracy conventions

Every number in the code cites its source in a comment; `EST:` marks estimates with the
reasoning, `SCOPE:` marks deliberate simplifications. Public sources used:

- **FAA FSB report BD-700-1A10 Rev 7, appendix 6** (Global Express to Global 6000 differences):
  four AFDs; FCP; CTP for radios and PFD selection ("CTP is the primary panel for PFD
  selection", "Standby HSI on CTP"); MKP / CCP; RSP ("AFCS 1-2 switch relocated to reversion
  switch panel"); "DU presentation, nine (9) memory selections"; FPV "caged and uncaged vice
  flight director command bars", "FPV Cage button on yoke"; "Takeoff mode pitch target box";
  "Preselect altitudes appear in feet and meters"; "Color changes for non-normal navigation
  sources"; SVS "Presented on PFD and HUD"; "EVS Head-Down Display can be presented on any MFW";
  "TAWS overlaid on MFW, VSD and HUD"; "Vertical Situation Display"; "FMS graphical flight
  planning"; "Electronic Checklist (ECL) linked to selected CAS messages"; EICAS synoptic /
  checklist selection "controlled by CHK/SYS key on the MKP"; "Emergency Descent Mode (EDM)
  button on FCP"; "Altitude knob PUSH FINE function"; "Auto Nav to Nav Transfer on Missed
  Approach"; "Same Integrated Electronic Standby (IESI) Instrument"; "Triple FMS installation".
- **EASA TCDS E.018 Issue 16** (BR700-710 engines): N1 102.1 % take-off / 102.5 % overspeed,
  N2 99.6 % take-off / 98.9 % MCT / 99.8 % overspeed, TGT 700 C start on ground / 850 C start
  in flight / 900 C take-off / 860 C MCT / 905 C overtemperature, oil temperature 160 C,
  N2-dependent oil pressure limits, 14,750 lbf take-off / 14,455 lbf MCT, 100 % N1 = 7431 rpm,
  100 % N2 = 15898 rpm (`BR710A2_20_ENGINES`).
- **EASA TCDS IM.A.009** (BD-700): fuel capacities with SB 700-28-040 (wings 15,045 lb each,
  centre 12,683 lb, aft 2,275 lb), MTOW 99,500 / MLW 78,600 / MZFW 58,000 lb, 51,000 ft
  ceiling.
- **Bombardier Global Express training manuals** (Airplane General, Electrical, Hydraulics,
  Fuel, Flight Controls, Landing Gear, APU, Automatic Flight, Navigation): airspeed placard
  (VMO 300 / 340 KIAS, MMO 0.89-0.842, VFE, VLO, VLE), slat / flap positions, stabilizer trim
  band, EICAS page contents, CAS colours, synoptic page contents and colour logic (hydraulic
  pressure green 1800-3200 psi, amber <= 1800, white > 3200; distribution table; brake
  pressure; brake temperature index 00-05 green / 06-16 white / 17-39 red; slat colours;
  electrical bus / source categories), guidance panel heritage (FD, CPL, AP, YD, FLC, NAV,
  BANK, HDG PUSH SYNC, VNAV, ALT, APR, VS, BC, SPD PUSH CHG).
- **AIN, "Flying the Vision Flight Deck in Bombardier's Global 6000" (2012)**: split windows,
  default arrangement, one cursor per pilot (pilot cross, copilot X), EICAS window not
  reachable by the cursor, bump rule, waypoint menus on the map, SVS in full colour.
- **AOPA "First look at the Global 6000" (2012)**, **Collins course syllabus 523-0817473**
  (unit part names: AFD-6520, FCP-5120, CTP-6000, CCP-6000, MKP-6000, RSP-6200).

What is EST (no public drawing available): exact page geometry, fonts and shades, MKP / CTP key
sets, the CTP page layout, quarter-window sizes, reversion placement details, cursor gain, EDM
target values, map range set, VSD scales. Section 14 lists the scope limits.

## 2. Integration (Global 6000 aircraft agent)

```ts
// In the aircraft module (create own Radios / Fms with power vars, QA lesson).
const fms = new Fms(ctx, { style: 'boeing', engineCount: 2 });          // Collins MOD + EXEC semantics
const afcs = new Afcs(ctx, AFCS_PROLINE_FUSION);                           // systems/autopilot preset
const fusion = createFusionSuite({ ...ctx, fms }, {
  airframe: GLOBAL6000_AIRFRAME,
  engines: BR710A2_20_ENGINES,
  power: {
    afd: ['elec.dc_ess_powered', 'elec.dc_bus1_powered', 'elec.dc_bus2_powered', 'elec.dc_ess_powered'],
    ctp: ['elec.dc_ess_powered', 'elec.dc_bus2_powered'],
    ccp: [...], mkp: [...], fcp: 'elec.dc_ess_powered', iesi: 'elec.batt_bus_powered',
  },
  checklists,                                   // AircraftInstance.checklists
  casChecklists: { hyd1_lo: 'HYD SYS 1 LO PRESS' },   // CAS id -> checklist title (linked ECL)
  synopticBindings: { 'gen1.v': 'elec.idg1_v', ... },  // map to the aircraft's system var ids
});
systems.push(radios, fms, afcs, fusion.system);  // suite after the electrical system
casManager.addSink(fusion.cas.model);
// Message texts / levels from GLOBAL_CAS_TEXTS, conditions from the aircraft's systems:
for (const t of GLOBAL_CAS_TEXTS) casManager.define({ id: t.id, text: t.text, level: t.level, when: whenFor(t.id) });
// Cockpit: addAfds / addFcp / addCtp / addCcp / addMkp / addRsp / addIesi (section 12).
fusion.applyState(state);                        // from AircraftInstance.applyState
```

- Displays: `fusion.displays` = `[afd1..4, ctp1, ctp2, iesi]` (ids `fusion.afd1` ...).
- AFCS: the FCP emits `ap.<event>` (prefix configurable); the AFCS reads `ap.sel_*`,
  `ap.nav_source` (0 FMS, else the NAV receiver index) and lights `ap.btn_*`. The suite writes
  `ap.nav_source` from the coupled side's PFD NAV SRC every step.
- APPR (QA lesson): with the coupled PFD on FMS and an ILS / LOC-type approach in the active
  plan, APPR tunes the on-side NAV receiver to the localizer, sets its course, switches that
  PFD to NAV and `ap.nav_source` to the receiver before emitting `ap.apr`, so the AFCS flies
  the localizer (`FusionSuite.approachInfo()` provides frequency / course / ident).
- Autothrottle: FCP AT emits `at.engage` (configurable).
- Failures: `fail.fusion.afd{n}` blanks an AFD (reversion follows).

## 3. Configuration (`config.ts`)

`FusionSuiteConfig`: `airframe` (`FusionAirframe`), `engines` (`FusionEngineConfig`), optional
`sensors` (ADC / AHRS / RA per side, standby ADC 3 / AHRS 4, third IRS, NAV / ADF receivers,
COM count), `events`, `power` (Bindings per unit; unset = always powered), `checklists`,
`casChecklists`, `synopticBindings`, `idPrefix` ('fusion'), `pixelRatio`, `afdBootS` (EST 18 s),
`fuelUnit` ('lb' | 'kg'), `transitionAltFt` (18,000).

- `GLOBAL6000_AIRFRAME`: VMO / MMO schedules, flap detents (lever 0 IN / 0 OUT / 6 / 16 / 30,
  VFE NaN / 225 / 210 / 210 / 185 KIAS), VLO 200, VLE 250, stabilizer 0-14 units with the
  4.5-11 take-off band, tank set, weights, ECS zones, doors, and the vars the EICAS reads
  (`trim.pitch_units`, `surf.*`, `ac.flap_lever`, `gear.pos{i}`, `gear.handle_down`,
  `brakes.parking_set`).
- `BR710A2_20_ENGINES`: limits above; `DEFAULT_ENGINE_VARS` (`eng{i}.n1_pct`, `n2_pct`,
  `itt_c`, `ff_pph`, `oil_press_psi`, `oil_temp_c`, `running`, `ignition`, `ac.eng{i}.epr`,
  `ac.eng{i}.n1_mode`, `fadec.eng{i}.start_state`, reverser vars, `fadec.rating` (string),
  `fadec.n1_limit_pct`). A missing EPR var is derived from N1 (EST curve, `eprFromN1`).
- Helpers: `vmoAt`, `mmoAt`, `flapDetentFor`, `oilPressLimit`, `engineScales`, `resolveConfig`.

## 4. SimVars and events (`vars.ts`)

Suite state lives under `fusion.`; standard vars are written where the real controls write
them (`ap.sel_*`, `nav{n}.*`, `com{n}.*`, `adf{n}.*`, `xpdr.*`, `adc{n}.baro_inhg`, `ap.minimums*`).

| Var | Meaning |
|---|---|
| `fusion.afd{n}.full`, `.win_{f,l,r,lu,ll,ru,rl}`, `.split_{l,r}` | selected layout of AFD n (content codes `Win`) |
| `fusion.afd{n}.op`, `.rev` | output: AFD operating / showing a reversionary composite |
| `fail.fusion.afd{n}` | failure injection |
| `fusion.s{s}.pfd_afd`, `fusion.eicas_afd` | output: AFD showing side s's PFD / the EICAS |
| `fusion.s{s}.sys_page` | synoptic page (`SysPage`: STATUS, AC, DC, FUEL, HYD, F/CTL, BLEED, A/ICE, ECS, DOORS) |
| `fusion.s{s}.nav_src` (0 FMS, 1 NAV1, 2 NAV2), `.brg1/.brg2` (0 OFF, 1 VOR, 2 ADF, 3 FMS) | PFD sources (CTP) |
| `fusion.s{s}.svs`, `.hsi_rose`, `.baro_hpa`, `.baro_pre`, `.metric`, `.fpv_caged` | PFD settings |
| `fusion.s{s}.adc_src`, `.ahrs_src`, `.ra_src` | output: sensor indices after RSP reversion |
| `fusion.ctp{s}.page` (0 RADIO, 1 PFD, 2 HSI), `.sel` | CTP page and selected radio line |
| `fusion.rsp{s}.adc` (0 NORM, 1 X-SIDE, 2 STBY), `.att` (0 NORM, 1 IRS 3), `.dspl` (0 NORM, 1 REV), `fusion.rsp.afcs` | RSP |
| `fusion.fcp.cpl` (1 / 2), `.spd_fms`, `.alt_fine`, `.edm`, `.brt` | FCP state |
| `fusion.ccp{s}.du/.x/.y/.vis`, string `fusion.ccp{s}.hover` | cursor position and hot spot |
| `fusion.mkp.exec`, `fusion.mkp{s}.msg` | EXEC / MSG annunciators |
| `fusion.vspd.{v1,vr,v2,vt,vref,vapp}` | V-speeds from the TOLD pages (PFD bugs) |
| `fusion.cas.scroll`, `.hidden_below`, `fusion.ecl.list/.cursor/.complete` | CAS / checklist state |
| `fusion.boot_skip`, `fusion.eng.exceed`, `fusion.iesi.baro_inhg`, `fusion.s{s}.chrono_s/.chrono_run` | misc |
| strings `fusion.s{s}.fms_page`, `.fms_scratch` | FMS window page / scratchpad |

Events (`FUSION_EVENTS`): `fusion.fcp.<id>` (buttons, knob `_inc` / `_dec` with the click
count), `fusion.ccp{s}.move {dx, dy}` / `.enter` / `.menu` / `.back` / `.data` / `.data_inc` /
`.data_dec` / `.data_in_inc` / `.data_in_dec` / `.dsp` ('PFD' | 'UPR' | 'LWR'),
`fusion.mkp{s}.key` (key id), `fusion.ctp{s}.lsk` (1-6), `fusion.ctp{s}.key` (CTP key id),
`fusion.ctp{s}.<tune_out|tune_in|baro|mins>_<inc|dec>`, `.tune_push` / `.baro_push` /
`.mins_push`, `fusion.s{s}.fpv_cage`, `fusion.iesi.baro_inc|baro_dec|baro_push`,
`fusion.s{s}.chrono` ('startstop' | 'reset').

## 5. Displays, windows, layout and reversion

`AdaptiveFlightDisplay` (1024 x 640 logical px, 16:10 EST) composes the windows the
`LayoutManager` shows on it. Window contents (`Win`): PFD, EICAS, MAP, FMS, SYSTEMS, CHECKLIST,
VSD, CHARTS, EVS, BLANK. Slots: `F` (full), `L` / `R` (halves, 512 x 640), `LU` / `LL` / `RU` /
`RL` (quarters, 512 x 320). Rules (`allowedIn`, EST from AIN / FSB):

- PFD only on the outboard AFDs, full or in the outboard half; the outboard half of a split
  PFD display always shows the PFD.
- EICAS, FMS and SYSTEMS need a half window; MAP / CHECKLIST / VSD / CHARTS / EVS fit halves
  and quarters; full-screen multifunction formats only on the centre AFDs.
- EICAS is unique (selecting it elsewhere swaps it with the old place) and cannot be replaced
  directly.

Default layout (EST, AIN "navigation on the center display and system synoptics"): AFD 1 PFD |
MAP, AFD 2 EICAS | SYSTEMS, AFD 3 FMS (pilot) | FMS (copilot), AFD 4 MAP | PFD. Nine memories
per pilot (`store` / `recall`; memory 2 = full PFDs with EICAS | MAP upper and SYSTEMS | FMS
lower; memory 3 = approach with CHARTS next to each PFD).

Reversion (recomputed only when an AFD's operating state or an RSP DSPL switch changes; EST
placement): a lost outboard AFD moves that PFD to its half of AFD 2 (AFD 3 if AFD 2 is also
lost); EICAS is always shown somewhere (AFD 2 L -> AFD 3 L -> AFD 2 R -> AFD 3 R -> AFD 1 R ->
AFD 4 L); RSP DSPL REV makes the on-side outboard AFD a PFD + EICAS composite (that EICAS wins).
A booting AFD counts as operating (no reversion flicker at power-up).

Window ownership: outboard AFDs belong to their pilot; on the centre AFDs the left half / full
window belongs to the pilot, the right half to the copilot. The owner selects the FMS window
side, the synoptic page and the map / VSD / chart instance.

AFD features: power-up self test (EST 18 s, skipped with `fusion.boot_skip` = 1, set by
`applyState` for running states), window separators, cursor drawing (pilot cross, copilot X,
cyan), cyan highlight of the hot spot under a cursor, and the **window menu** (CCP MENU): the
contents allowed in the window, format commands FULL / SPLIT / SPLIT UPPER / LOWER / JOIN HALF,
then the window's own options (map formats and overlays, synoptic pages). Mouse in the 3D
cockpit: move = cursor of the side (AFD 1 pilot, AFD 4 copilot, centre AFDs by half), click =
ENTER, long press = MENU, wheel = DATA.

`FusionSuite.showWindow(side, win)` brings a content up for a side when no window of that side
shows it (EST order: lower centre half, other upper centre half, own upper centre half, inboard
half of the PFD display); used by the MKP FMS / CHK/SYS keys.

## 6. CCP cursor model (`logic/cursor.ts`)

The four AFDs form a virtual desktop in the T arrangement (AFD 1, 2, 4 across, AFD 3 below
AFD 2). The pilot reaches AFD 1-3, the copilot AFD 2-4 (EST). Trackball drag x `CCP_GAIN` (1.6,
EST); the cursor slides along edges it cannot cross; entering the EICAS window jumps over it
in the direction of travel (AIN: "the only place on the display that the cursor can't go");
entering the window that holds the other pilot's cursor removes that cursor (bump rule);
display select keys jump to the on-side PFD display / upper / lower centre; the cursor hides
after 30 s without motion (EST) or when its AFD fails. `CursorRouter` routes ENTER / MENU /
BACK / DATA to the AFD under the cursor.

## 7. PFD

Full (1024 x 640) or half (512 x 640) format, per side, reading only sensor vars (after RSP
source selection): ADI with the Collins style, SVS terrain underlay (polar-grid sampler of
`WorldQuery.elevationAt`, hypsometric tint, range haze, origin / destination runways; FSB
"Synthetic Vision ... Presented on PFD"), **flight path vector** with the guidance cue flown
inside it (FSB "FPV vice flight director command bars"; caged / uncaged with the yoke FPV CAGE
event), speed tape (selected speed / Mach, managed-speed colour, VMO / MMO barber pole from
`vmoAt` / `mmoAt`, flap / gear limit, shaker speed from the AoA ratio, V-speed bugs from the
TOLD pages), altitude tape (selected altitude in feet with metric option, baro setting / STD /
preselect, VNAV target, ground reference from the RA), VSI (half format: digital V/S above /
below the scale), glideslope / GP / VNAV deviation, localizer scale, radio altitude and
minimums (RA / BARO from the CTP), marker beacons, amber source annunciations for reverted
sensors, HSI (ARC or ROSE from the CTP; FMS magenta, VOR / LOC green, cross-side source amber;
bearing pointers VOR / ADF / FMS), FMA (A/T | lateral | AP / YD | vertical | approach / EDM,
armed modes white below active green, 5 s flash on mode change per the GX AFCS manual),
couple-side label, low-bank arc, pitch limit indicator.

## 8. EICAS and CAS

EICAS window (half window): EPR readouts and rating / N1 limit (FADEC `fadec.rating`,
`fadec.n1_limit_pct`), N1 and ITT dials with digital boxes, N2, FF, oil temperature and
pressure (N2-dependent limits), IGN / START flags, the CAS list, fuel quantities (tank set,
total, 10 lb resolution, low wing fuel amber below 600 lb per GX), gear (DN green, UP white,
hatched amber in transit / disagreement), slat / flap (flap position bar with detent ticks, slats
in transit white), spoilers (RET / FLT / GND), trims (stab units with the take-off green
band, aileron, rudder), PARK BRAKE. Exceedance monitors run every systems step
(`fusion.eng.exceed`).

`FusionCas`: register `fusion.cas.model` as a CasManager sink. Colours red / amber / cyan /
white ("warnings, cautions, advisories and status messages are presented on the EICAS primary
display", GX Electrical). Warnings first and never scrolled off; the rest scrolls with the MKP
CAS UP / DN keys (the cursor cannot enter the EICAS window) with a hidden-message count; new
warnings / cautions flash until acknowledged (`cas.ack_warning`, `cas.ack_caution`, `cas.ack`).
`GLOBAL_CAS_TEXTS` lists Global message texts from the GX manuals for the aircraft's
CasManager definitions.

## 9. Multifunction windows

- **MAP** (`displays/map.ts`): ARC (heading up, 120 deg compass arc), ROSE and PLAN (north up)
  over the common `MovingMap` (Collins palette, ranges 2-640 NM EST): active route magenta,
  pending MOD route dashed white, airports / VOR / NDB / fixes, TAWS terrain, traffic,
  heading bug, range hot spots, top data bar (GS, active waypoint, DTK, distance).
  **Graphical flight planning**: cursor ENTER on a flight plan waypoint opens its menu
  (DIRECT-TO, HOLD AT, DELETE, CLOSE) acting on the FMS (MOD + EXEC). Window menu: formats and
  overlay toggles.
- **FMS** (`displays/fmsText.ts`): the owner's FMS page as a 24 x 14 CDU page (large / small
  fonts, CDU colours) with line-select hot spots for L1-L6 / R1-R6 (FSB "soft buttons on
  displays"); DATA knob = PREV / NEXT.
- **SYSTEMS** (`displays/synoptics.ts`): tab bar (cursor-selectable) and the pages STATUS
  (brake temperature index, APU RPM / EGT, crew oxygen, oil quantity, doors summary, status
  messages), AC ELECTRICAL (GEN 1-4 / APU GEN V, KVA, HZ; AC BUS 1-4, AC ESS, RAT GEN, EXT AC;
  MAN OFF / SHED legends), DC ELECTRICAL (TRU 1 / 2, ESS TRU 1 / 2 V / A; DC BUS 1 / 2, DC ESS,
  BATT BUS, DC EMER; AV / APU BATT V, A, temperature, CHARGER), FUEL (wing / AUX / aft tanks,
  temperatures, pumps, crossfeed and engine feed valves, TOTAL FUEL, FUEL USED), HYDRAULIC
  (reservoir quantity in 2 % steps, temperature, pumps 1A / 1B / 2A / 2B / 3A / 3B and the RAT
  pump when deployed, SOVs, pressure colour logic, distribution table, INBD / OUTBD brakes),
  FLIGHT CONTROLS (ailerons, elevators, rudder, four multifunction spoilers and ground
  spoilers per side, FLAP, SLAT IN / OUT / TRANSIT colour logic), BLEED (engine / APU bleed
  pressures and valves, isolation valve, packs, wing anti-ice, start valves), ANTI-ICE (wing,
  cowl, windshield, probes, ICE), AIR COND / PRESS (zone temperatures actual / selected, packs,
  cabin altitude, rate, differential pressure, landing elevation, outflow valve), DOORS (door
  symbols and list). Every value comes from a readout key (`logic/readouts.ts`,
  `DEFAULT_READOUT_BINDINGS`) that defaults to the systems-library var naming and is remapped
  per aircraft with `synopticBindings`; unwritten vars draw amber dashes (invalid data).
- **CHECKLIST** (`displays/checklistWin.ts`, `logic/checklist.ts`): INDEX (normal / non-normal
  groups), items with check boxes, closed-loop items sensed at 4 Hz, cursor ENTER checks an
  item, DATA moves the current item, RESET, NEXT, CHECKLIST COMPLETE; CAS-linked opening via
  MKP CHK/SYS.
- **VSD** (`displays/vsd.ts`): terrain profile along the track (2 Hz, 64 samples) coloured by
  clearance, own ship, flight path line, selected altitude, FMS vertical profile from the
  active plan's predicted altitudes with waypoint idents; ranges 5-160 NM (EST).
- **CHARTS** (`displays/chartEvs.ts`): airport diagram from the navigation database (runways
  to scale, lengths / widths, own ship), origin on the ground and destination airborne, ORIG /
  DEST selection. SCOPE: no Jeppesen charts (IFIS charts are licensed data).
- **EVS**: simulated infrared picture from the SVS sampler in monochrome limited to 8 NM, with
  horizon, heading scale and boresight. SCOPE: no thermal targets or weather attenuation.

## 10. Glareshield and pedestal panels

**FCP** (`logic/fcp.ts`), event `fusion.fcp.<id>`:

| Key / knob | Action |
|---|---|
| `fd1`, `fd2`, `ap`, `yd`, `hdg`, `nav`, `bc`, `bank`, `flc`, `vs`, `vnav`, `alt`, `toga` | `ap.fd1`, `ap.fd2`, `ap.ap`, `ap.yd`, `ap.hdg`, `ap.nav` (after syncing the nav source), `ap.bc`, `ap.half_bank`, `ap.flc`, `ap.vs`, `ap.vnav`, `ap.alt`, `ap.toga` |
| `appr` | nav-to-nav transfer to the plan's localizer when the coupled PFD is on FMS, then `ap.apr` |
| `at` | `at.engage` |
| `cpl` | coupled side 1 / 2 (`fusion.fcp.cpl`, arrows on the key) |
| `spd_man` | speed target MAN / FMS (FMS: VNAV target speed / Mach written to `ap.sel_spd` / `ap.sel_mach`) |
| `edm` | Emergency Descent Mode: 15,000 ft, 90 deg left turn, VMO / MMO margin speed, AP + AT + HDG + FLC (EST values) |
| `hdg_inc/dec`, `hdg_push` | heading bug; `ap.hdg_sync` |
| `crs1/crs2_inc/dec`, `_push` | OBS / selected course of the PFD's receiver; PUSH = direct course to the station |
| `alt_inc/dec`, `alt_push` | 1,000 ft steps snapped to the grid, FINE = 100 ft; 0-51,000 ft |
| `spd_inc/dec`, `spd_push` | 1 kt / 0.01 Mach (turning selects MAN); `ap.spd_mach` |
| `pitch_inc/dec` | pitch wheel `ap.up` / `ap.dn` {steps} |

Lights: `FCP_LIGHTS` (AFCS `ap.btn_*`, `ap.at_engaged`, FD, EDM, SPD MAN/FMS).

**CTP** (`logic/ctp.ts`, `displays/ctpDisplay.ts`, 480 x 240 logical px EST): RADIO page (COM
on-side, NAV, ADF on the left keys; ATC code / mode / IDENT, COM 3, DME HOLD on the right;
select a line, TUNE outer / inner knob sets the standby, second press or TUNE push transfers;
COM 1 MHz / 25 kHz in 118-136.975 MHz, NAV 1 MHz / 50 kHz, ADF 100 / 1 kHz, squawk octal digit
pairs), PFD page (NAV SRC FMS -> on-side -> cross-side, BRG 1 / BRG 2, SVS, HSI ARC / ROSE, baro
IN / HPA; baro and minimums readouts), standby HSI page; keys COM NAV ADF ATC DME IDENT PFD HSI
NAVSRC BRG1 BRG2; BARO knob 0.01 inHg / 1 hPa (preselect while STD, PUSH STD), MINS knob 10 ft
(PUSH RA / BARO). IDENT resets after 18 s (FAA AIM).

**MKP** (`logic/mkp.ts`, key ids `MKP_KEYS`): A-Z, 0-9, DOT, SLASH, PLUSMINUS, SP, CLR,
CLRALL, DEL, EXEC, PREV, NEXT, FMS page keys IDX FPLN LEGS DEPARR DIR PERF PROG VNAV HOLD TUNE
MSG (bring the FMS window up if needed), FMS, CHKSYS (a linked CAS message opens its checklist,
else SYSTEMS <-> CHECKLIST), CAS_UP / CAS_DN, MEM / STO + digit 1-9 (display memories). EST
key set and two-key memory sequence.

**RSP** (`logic/sources.ts`): ADC NORM / X-SIDE / STBY, ATT/HDG NORM / IRS 3, DSPL NORM / REV,
AFCS 1 / 2. Reverted sources are annunciated amber on the PFD.

**IESI** (`displays/iesi.ts`, 400 x 400 logical px EST): standby attitude, airspeed, altitude
with its own baro setting (standby ADC), slip, heading; attitude alignment 90 s (EST) unless
`fusion.boot_skip`.

## 11. FMS (`fms/`)

One `FmsHost` wraps the aircraft's nav `Fms` (Boeing edit style: modifications go into a MOD
plan, EXEC activates, CANCEL MOD / L6 erases; FSB "Triple FMS installation" SCOPE: one FMS
instance), performance data, V-speeds, procedure cache and messages. Each pilot has an
`FmsWindowModel` (page, page number, scratchpad, per-page state). Pages (`FMS_PAGES`): NAV INDEX,
POS INIT, ACT / MOD FPLN (origin / destination / runway, VIA / TO rows, airway entry, route
string shortcut), ACT / MOD LEGS (waypoint insert, DELETE, direct-to on line 1, speed /
altitude constraints `250/12000A`, `FL240B`, `5000A7000B`), DEPARTURE / ARRIVAL (runways,
SIDs / STARs / approaches, transitions), DIRECT-TO, PERF INIT (BOW, payload, reserves, cruise
altitude <= 51,000 ft, transition altitude, weights against MTOW / MZFW), VNAV (speed schedule,
VPA), PROGRESS, TAKEOFF / APPROACH REF (pilot-entered V-speeds -> PFD bugs; SCOPE: no TOLD
performance tables), HOLD (fix, inbound course / turn, leg time, INSERT / EXIT HOLD), CNS TUNE
(COM 1-3, NAV 1-2, ADF 1-2, ATC code / mode, DME HOLD, HF page), MESSAGES. Entry conventions:
line select with an empty scratchpad copies the line into the scratchpad; errors (INVALID
ENTRY, NOT IN DATA BASE, NOT IN FLT PLAN) replace the scratchpad until CLR. On the ground the
first leg after the origin stays the active leg while the route is built (EST pre-flight
behaviour).

## 12. Cockpit hardware (`cockpit.ts`)

`addAfds(panel, suite, [[x, y] x 4])` (0.307 x 0.192 m active area, bezels), `addFcp`,
`addCtp(side)` (screen, 3 + 3 line keys aligned with the page rows, function keys, TUNE / BARO
/ MINS knobs), `addCcp(side)` (`CcpTrackball` drag control, ENTER / MENU / BACK, PFD / UPR /
LWR keys, concentric DATA knob), `addMkp(side)` (keyboard with PC keyboard input, EXEC and MSG
lights), `addRsp(side)` (toggle switches writing the RSP vars), `addIesi`. Sizes in
`FUSION_HW` (EST except the AFD). Controls emit the suite events, so every key is functional.

## 13. Development preview and verification

```
npx vite --port 5199
http://localhost:5199/src/avionics/collins-fusion/dev/preview.html?state=cruise
```

Query: `state` = cruise | approach | ground | boot | rev | split, `sys` = synoptic page 0-9,
`menu=1` (window menu open on AFD 3), `ctp` = pfd | hsi, `mem=2`, `fms` / `fms2` = FMS page ids,
`chkl=1`, `win` = content code for AFD 3 R, `cas` = 0 | 2, `static=1`. The page loads the real
navigation database and nav `Fms`, the `AFCS_PROLINE_FUSION` AFCS and a synthetic sine-field
terrain (SVS / VSD / EVS only). `window.__fusion` exposes the suite. Screenshots of every state
and page were inspected during development.

Verification commands: `npx tsc --noEmit -p tsconfig.json` (no collins-fusion errors),
`npx vitest run tests/avionics/collins-fusion`, `npm run build`.

## 14. Scope limits and estimates

- Page geometry, fonts, shades, key sets and layouts of the CTP / MKP / CCP are EST (no public
  Collins drawings); the look follows Pro Line Fusion press images and AIN / FSB descriptions.
- One FMS instance serves all three FMS positions; no datalink, no TOLD performance
  computation, no weight-and-balance module beyond the PERF INIT sums.
- CHARTS shows a database airport diagram (no Jeppesen charts); EVS is a synthetic image; no
  weather radar or lightning overlay on the map; no HUD.
- SVS has no obstacles or terrain-alert colouring; terrain comes from `WorldQuery.elevationAt`.
- Synoptic topology (which bus feeds what, bleed / fuel line routing) is simplified from the
  Global Express figures; values are only as good as the aircraft's `synopticBindings`.
- Reversion placement, cursor gain / idle time, EDM target values, map / VSD range sets, CAS
  row counts and the power-up test duration are EST.
- No global6000 aircraft module exists in this change; the suite is verified with the dev
  preview and the unit tests, not with the app smoke run.
