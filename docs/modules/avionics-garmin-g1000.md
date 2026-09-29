# Garmin G1000 NXi (Cessna 172S NAV III) — API reference

Owner: avionics-garmin-g1000. Source: `src/avionics/garmin-g1000/**`.
Tests: `tests/avionics/garmin-g1000/**` (`npx vitest run tests/avionics/garmin-g1000`,
28 tests, ~4 s, real navigation data, real shared `Afcs`). Barrel:
`src/avionics/garmin-g1000/index.ts`. Dev preview:
`src/avionics/garmin-g1000/dev/preview.html` (§12).

The suite implements the G1000 NXi integrated flight deck of the Cessna
172S Skyhawk (Cessna NAV III) with the GFC 700 AFCS and the optional Garmin
ESP: two GDU 1054B displays (PFD, MFD; 10.4 in, 1024 x 768), two GIA 63W
integrated avionics units (NAV/COM/GPS), GEA 71B engine/airframe unit, GSU 75
ADAHRS, GMU 44 magnetometer, GTX 345R transponder, GMA 1360 audio panel and
the GSA 81 servos. It sits on `src/avionics/common` (canvas display, tapes,
HSI, moving map, CAS window, gauges), `src/nav` (Fms, Radios, NavDatabase),
reuses the G3000 flight-plan editor / formatters / message list without
modifying them, and drives `src/systems/autopilot` (Afcs) through its
EventBus events.

Sources (cited in the code next to each number):

* **PG** — Garmin G1000 NXi Pilot's Guide for the Cessna NAV III,
  190-02177-02 Rev. A (Dec 2019, GDU 20.83); the Rev. 00 edition
  190-02177-00 A for cross checks.
* **CRG** — Cockpit Reference Guide 190-02824-00 Rev. A (system software
  4013.00).
* **POH** — Cessna 172S NAV III POH/AFM 172SPHAUS-03 (§2 limitations,
  §4 speeds, §7 systems: EIS markings, electrical, fuel, vacuum).
* Numbers without a public source are marked `// EST:` with the reasoning;
  simplified functions carry `// SCOPE:`.

---

## 0. Quick start (aircraft module `c172-g1000`)

```ts
import { G1000Suite, C172S_NXI, AFCS_GFC700_NXI, G1K, g1000Controls } from '@/avionics/garmin-g1000';
import { Afcs } from '@/systems/autopilot';

create(ctx) {
  const suite = new G1000Suite(ctx, {
    ...C172S_NXI,                 // 172S EIS, V-speeds, speed tape, CAS, ESP, unit power (C172S_NXI_POWER)
    checklists: C172S_G1000_CHECKLISTS,
    // optional: trafficSource (a Tcas-like { threats }), aglFt, airborne, stallWarning, fmsOptions ...
  });
  const afcs = new Afcs(ctx, { ...AFCS_GFC700_NXI, ...suite.afcsWiring(), gains: { ... } });
  const systems = [elec, sensors, ...suite.systems, afcs, flightControls, ...];  // suite BEFORE the Afcs
  // Flight controls: add the ESP servo increments to the AP servo inputs of MechanicalFlightControls:
  //   pitch.addVars: ['ap.servo_pitch', G1K.espServoPitch, ...], roll.addVars: ['ap.servo_roll', G1K.espServoRoll]
  // Cockpit: suite.displayList() -> screen meshes by id ('pfd', 'mfd');
  //          hardware from g1000Controls(suite.cfg) (§11).
  applyState(s) { ...; suite.applyState(s); }
}
```

`suite.systems` = `[RadioPower, Radios, Fms, G1000System]` (radio power,
radios and FMS only when the suite created them, i.e. `radiosInstance` /
`fms` absent). The app must not add its own Radios / Fms. Order: after the
ADC/AHRS sensors and the electrical system, **before** the Afcs (the system
writes `ap.nav_source`, clamps AFCS references and cancels VNV after the FMS
update). Headless: `new G1000Suite(ctx, cfg, { noDisplays: true })`.

`suite.afcsWiring()` returns `{ power: 'g1k.gia1.up', servoPower: 'g1k.servos.up' }`
(the GFC 700 computes in GIA 1 and drives the servos on the AUTOPILOT breaker;
the servos must pass their preflight test first).

---

## 1. Configuration (`config.ts`, `presets.ts`)

`G1000Config` (all optional except `aircraftId`; `resolveConfig` fills defaults):

| field | default | meaning |
|---|---|---|
| `aircraftName` | aircraftId | power-on page / System Status |
| `softwareVersion` | `'System 4013.00'` (EST) | power-on page |
| `bezel` | both `GDU1054B` | `GDU1050` removes HDG / ALT knobs and AFCS keys (PG §1.1) |
| `afcs` | true | GFC 700 installed (AFCS keys, status box) |
| `esp` | false in the default, true in `C172S_NXI` | `true` = `ESP_C172` limits (PG §8.11), or a partial override |
| `power` | `{}` (always powered) | per-LRU power `Binding` (§2) |
| `bootS` | gdu 15, gia 10, adahrs 30, xpdr 5, gma 2, servos 5 (EST except gma) | self-test / boot times |
| `eis` | `PLACEHOLDER_EIS` | `G1kEisConfig` (§8) |
| `vspeeds` | `[]` | `VSpeedDef[]` (`C172S_VSPEEDS`: G 68, R 55, X 62, Y 74 KIAS, POH §4) |
| `speedTape` | no ranges, Vne 400 | `{ ranges, vneKt }` (`C172S_SPEED_RANGES`, Vne 163) |
| `cas` | `[]` | `CasDef[]` (`C172S_CAS`, §7) |
| `casModel` | new `CasModel(['warning','caution','advisory'])` | share an existing model |
| `checklists` | `[]` | `Checklist[]` (grouped by `phase`; a phase matching /emerg/i is the EMER group) |
| `radios` | `{ nav: 2, adf: false, dme: false }` | optional KR 87 ADF / KN 63 DME |
| `traffic` | `'none'` (`'ADSB'` in the preset, EST GTX 345R) | enables TFC Map / traffic softkeys |
| `trafficSource` | none | `{ threats }` (systems/warning Tcas) for the maps |
| `terrain` | `'SVT'` | `'SVT'` (Terrain-SVT) or `'TAWS-B'` page title / SVT softkeys |
| `aglFt` | GPS altitude − `ctx.world.elevationAt` | height above terrain for ESP (200 ft gate) |
| `airborne` | `gps.gs_kt > 30 \|\| adc1.tas_kt > 50` (PG §8.11 inference) | XPDR air/ground, flight timer, alerts |
| `stallWarning` | `alert.stall_horn` (preset: `ac.c172.stall_horn`) | USP activation in altitude-critical modes |
| `fms`, `radiosInstance`, `fmsOptions`, `radiosOptions` | created by the suite | the suite's Fms uses `fuelVar: g1k.fuel.rem_kg` (totalizer) and a 22° LNAV bank limit (PG Table 7-3) |
| `flapsVar`, `pixelRatio` (0.9), `autoReversion` (true) | | |

`presets.ts`: `C172S_NXI` (complete preset), `C172S_EIS`, `C172S_CAS`,
`C172S_VSPEEDS`, `C172S_SPEED_RANGES`, `C172S_NXI_POWER`,
`AVGAS_KG_PER_GAL` (2.7216). The preset reads the c172s-common vars:
`fuel.left_ind_kg` / `fuel.right_ind_kg` (gauged, −1 gal = failed
transmitter → red X), `ac.c172.m_bus_v`, `e_bus_v`, `m_batt_a`, `s_batt_a`,
`ac.vac.suction_inhg`, `ac.c172.ann.*` (CAS), `eng1.*` engine vars.

---

## 2. LRUs, power, boot, reversionary mode (`state/units.ts`, `System`)

Units (`G1kUnit`): `pfd`, `mfd`, `gia1`, `gia2`, `com1`, `com2`, `gea`,
`adahrs`, `gmu`, `xpdr`, `gma`, `servos`, `dme`, `adf`. Each follows its
`power` binding and `fail.g1k.<unit>`; after power-up it self-tests for its
boot time. Vars: `g1k.<unit>.powered / .booting / .up`, and
`display.pfd.power` / `display.mfd.power`.

`C172S_NXI_POWER` (c172s-common loads, POH NAV III Fig 7-7): pfd
`elec.pfd_powered` (ESS + AVN 1 diode-ORed), mfd `elec.mfd_powered`, gia1 /
gea `elec.nav1_eng_powered`, com1 `elec.comm1_powered`, gia2
`elec.nav2_powered`, com2 `elec.comm2_powered`, adahrs / gmu
`elec.adc_ahrs_powered`, xpdr `elec.xpndr_powered`, gma
`elec.audio_powered`, servos `elec.autopilot_powered`.

Receiver power written by `RadioPower`: `nav1.powered` = GIA 1, `nav2.powered`
= GIA 2, `gps.powered` = either GIA, `nav.marker_powered` = GMA (marker
receiver in the GMA 1360), `adf1.powered` = ADF unit.

Reversionary (PG §1.3): automatic when the other display is not up (so with
AVIONICS BUS 2 off the PFD shows PFD + EIS for engine start); DISPLAY BACKUP
(`g1k.gma.display_backup` event, latch `g1k.display_backup`) puts both
displays in reversionary mode. `g1k.<gdu>.reversionary`. NAV / COM validity
(`g1k.nav<r>.valid`, `g1k.com<r>.valid`): IAU r up **and** its display up
(GIA 1 ↔ PFD, GIA 2 ↔ MFD; PG: "the NAV and COM functions provided to the
failed display by the IAU are flagged as invalid"), COM also its COMM
breaker. Invalid radios show a red X and refuse tuning.

Power-cycle effects: MFD power-on page returns (`g1k.mfd.splash_ack` = 0; ENT
acknowledges and shows Map - Navigation Map), minimums reset (PG §2.4), ESP
re-enabled (PG §8.11).

---

## 3. Bezel controls and events (`vars.ts` `G1K_EVENTS`)

Both GDUs have identical bezels (PG Figure 1-2) and send `g1k.<gdu>.<name>`
(`<gdu>` = `pfd` | `mfd`). Encoders take signed clicks (number or `{delta}`)
on the name, or positive clicks on `<name>_inc` / `<name>_dec`.

| control | events | function |
|---|---|---|
| NAV VOL / ID | `nav_vol`, `nav_vol_push` | volume of the boxed NAV (readout 2 s), Morse ident audio on/off |
| NAV ↔ | `nav_xfer` | swap boxed NAV |
| NAV dual knob | `nav_outer`, `nav_inner`, `nav_push` | MHz / 50 kHz, push = tuning box NAV1 ↔ NAV2 |
| HDG | `hdg`, `hdg_push` | heading bug, push = HDG SYNC |
| AFCS keys | `key_ap`, `key_fd`, `key_hdg`, `key_alt`, `key_nav`, `key_vnv`, `key_apr`, `key_bc`, `key_vs`, `key_flc`, `key_nose_up`, `key_nose_dn` | → `ap.*` events (§9) |
| ALT dual knob | `alt_outer`, `alt_inner` | 1000 / 100 ft, stops once on the baro minimums |
| COM VOL / SQ | `com_vol`, `com_vol_push` | volume, automatic squelch on/off ('SQ' shown when off) |
| COM ↔ | `com_xfer`, `com_xfer_up` | swap; held 2 s = 121.500 (EMERG) |
| COM dual knob | `com_outer`, `com_inner`, `com_push` | 25 / 8.33 kHz channels, push = COM1 ↔ COM2 |
| CRS / BARO | `baro` (outer), `crs` (inner), `crs_push` | baro 0.01 inHg / 1 hPa (leaves STD); course of the CDI receiver or GPS OBS; push = CRS CTR |
| RANGE joystick | `range`, `range_push`, `joystick` {x,y} | 28 Garmin ranges (250 ft .. 1000 nm); MFD map pointer |
| D→ MENU FPL PROC CLR ENT | `key_dto`, `key_menu`, `key_fpl`, `key_proc`, `key_clr` (+`key_clr_up`), `key_ent` | §5 / §6 |
| FMS dual knob | `fms_outer`, `fms_inner`, `fms_push` | cursor / data entry; MFD page groups |
| softkeys | `sk1` .. `sk12` | §4 |

Other events: GMA keys `g1k.gma.key_<key>` (+ `_up`), `g1k.gma.vol`,
`g1k.gma.crsr`, `g1k.gma.vol_push` (+ `_up`), `g1k.gma.display_backup`;
`g1k.ptt` (payload pressed / 1 / 0), `g1k.cas.ack` (also `cas.ack`,
`cas.ack_warning`, `cas.ack_caution`), `g1k.ap_disc_hold` (AP DISC release;
press = `ap.disc`), `ap.cws` (payload pressed).

---

## 4. Softkeys (`state/softkeys.ts`, `state/menus.ts`)

`SoftkeyController`: levels with Back; "softkeys revert to the previous level
after 45 seconds of inactivity" (PG §1.4); subdued when disabled;
annunciator bar green (on) / grey (off). `sys.softkeysOf(gdu)`,
`sys.pressSoftkey(gdu, i)`.

PFD (both GDUs in PFD / reversionary format; PG Table 1-3, Figure 1-10):

* **top**: CAS (only with > 12 CAS lines; `Engine` in reversionary mode, EST) |
  Map/HSI | TFC Map | PFD Opt | OBS (SUSP when suspended) | CDI | DME /
  ADF/DME (if installed) | XPDR | Ident | Tmr/Ref | Nearest | Alerts
* **Map/HSI**: Layout | Detail | Traffic | TER (Off / Topo / REL) | WX LGND |
  NEXRAD | METAR | Lightning | Back
* **Layout**: Map Off | Inset Map | HSI Map | Inset Trfc | HSI Trfc | Back
* **PFD Opt**: SVT | Wind | DME | Bearing 1 | Bearing 2 | ALT Units | STD
  Baro | Back; **SVT**: Pathways, Terrain, HDG LBL, APT Sign; **Wind**: Off,
  Option 1, 2, 3; **ALT Units**: Meters, IN, HPA
* **XPDR** (Figure 4-14): Standby | On | ALT | VFR | Code | Ident | Back;
  **Code**: 0-7 | Ident | BKSP | Back
* **Engine** (reversionary): Engine | Lean | System (+ GAL REM keys)
* Alerts key (position 12 on every level): flashing Warning (red) /
  Caution (amber) / Advisory / Message, black-on-white Alerts when messages
  remain (§7).

Positions inside the sub-levels the PG lists without a figure are EST
(options left to right, Back at 11).

MFD (per page, `Page.softkeys` root):

* **Navigation Map**: Engine | Map Opt | Detail (All / 3 / 2 / 1) | Charts
  (subdued, SCOPE: no chart database) | Checklist
* **Map Opt**: Traffic | Inset (VSD, state only) | TER | AWY (Off / On / LO /
  HI) | STRMSCP | NEXRAD | XM LTNG | METAR | Legend | Back
* **Engine** (PG Table 3-1): Engine | Lean (CYL SLCT, Assist) | System (RST
  Fuel, GAL REM → -10 / -1 / +1 / +10 GAL, 35 GAL, 53 GAL)
* Traffic map: Operate / Standby, ALT Mode, Motion; Terrain: View 360 / Arc,
  Legend; WPT Airport: Info-1, Info-2, DP, STAR, APR (open procedure loading),
  WX (subdued); AUX GPS Status: GPS1 / GPS2; AUX System Setup: Setup 1 /
  Setup 2; FPL: Cncl VNV / Enbl VNV, ACT Leg, Charts; Checklist: Check /
  Uncheck, Exit, EMER.

---

## 5. PFD windows (`state/pages.ts`, lower right x 720-1022 / y 490-708)

`sys.openPfdWindow(id)`, `togglePfdWindow`, `closeWindow`; `g1k.pfd.window`
codes (`PFD_WINDOWS`): 1 Tmr/Ref, 2 Nearest, 3 Alerts, 4 FPL, 5 D→, 6 PROC,
7 DME, 8 procedure loading. The FMS knob acts on the open window; CLR clears
or closes it; MENU shows the page menu (with no window: PFD Setup Menu —
display / key backlight Auto / Manual ± 10 %).

* **Timer/References** (`TmrRefPage`): timer HH:MM:SS, UP / DN, Start? /
  Stop? / Reset? (count-down reaching zero raises TIMER EXPIRD and counts up);
  GLIDE / Vr / Vx / Vy values (1 kt, `*` when changed) On / Off; MINS OFF /
  BARO / TEMP COMP, value (10 ft), temperature. MENU: All References On /
  Off, Restore Defaults.
* **Nearest Airports**: 25 nearest within 200 nm (no heliports / seaplane
  bases), BRG / DIS / approach class / runway length / COM frequency; ENT on
  a frequency loads the COM standby; ENT on an identifier lists the airport
  frequencies; D→ preselects the highlighted airport.
* **Alerts**: system messages, newest first (FMS knob scrolls).
* **Flight Plan**: legs with DTK / DIS; small knob on a row starts
  identifier entry that inserts before it (last row appends; origin /
  destination inferred); CLR → 'Remove …?' confirmation. MENU: Activate Leg,
  Delete Flight Plan, Remove Departure / Arrival / Approach.
* **Direct To**: identifier (auto-completed), name, BRG / DIS, CRS,
  Activate?; a waypoint already in the flight plan is flown as that leg.
  MENU: Cancel Direct-To NAV.
* **Procedures** (PROC): Activate Vector-to-Final, Activate Approach,
  Activate Missed Approach, Select Approach / Arrival / Departure (open the
  loading window), loaded procedures.
* **Procedure loading**: airport, procedure, transition ('Vectors' = VTF for
  approaches), runway (SID / STAR), approach MINS (sets the PFD minimums),
  LOAD? / ACTIVATE?.
* **DME Tuning** (KN 63 only): NAV1 / NAV2 / HOLD (`nav<r>.dme_hold`).

XPDR code entry with the FMS knob (Code level): small knob = two octal digits,
large knob = next pair, ENT activates (else 10 s); softkey entry activates
5 s after the fourth digit; 10 s without a digit cancels (PG §4.4).

---

## 6. MFD pages (`state/mfd.ts`, `gdu/Mfd.ts`)

Page groups (large FMS knob without cursor; small knob = page; page group
window 3 s, EST): **MAP** Navigation Map, Traffic Map, Terrain-SVT (or TAWS-B);
**WPT** Airport, Intersection, VOR, NDB Information; **AUX** Trip Planning,
Utility, GPS Status, System Setup (1 / 2), System Status; **FPL** Active
Flight Plan; **NRST** Nearest Airports, Intersections, VOR, NDB. Overlays:
Direct-to, Procedures, procedure loading, Checklist. FPL key toggles the
Active Flight Plan page, CLR held 2 s = Navigation Map, ENT acknowledges the
power-on page. `g1k.mfd.group`, `g1k.mfd.page`.

* System Setup 1: time format (UTC / local 12 / 24 h) and offset, nav angle
  (magnetic / true), baro units, arrival alert on/off and distance, GPS CDI
  (Auto / 2.0 / 1.0 / 0.3 nm — rescales the PFD CDI; SCOPE: the AFCS keeps
  the FMS automatic scaling), MFD data bar fields (4 of BRG DIS DTK END ETA
  ETE FOB FOD GS TAS TKE TRK VSR XTK; default GS DTK TRK ETE), COM channel
  spacing 25 / 8.33 kHz. Setup 2: Stability & Protection Enabled / Disabled.
  MENU: Restore System Defaults.
* Utility: generic timer (shared with the PFD), flight time, departure time,
  trip odometer, odometer, max GS, engine hours; MENU resets.
* Trip Planning (automatic, present position): GS, fuel flow, fuel on board,
  DTK / DIS / ETE to the waypoint and destination, ETA, fuel required /
  remaining at destination, endurance, range, efficiency.
* GPS Status: solution, satellites, EPU, HFOM / VFOM (EST from EPU), SBAS,
  position, time, altitude, GS, track, signal bars.
* System Status: airframe, software, LRU ✓ / X list, databases.
* Checklist: Group, Checklist, items (ENT / Check toggles), '*Checklist
  Finished*' green / '*Checklist Not Finished*' amber, 'Go to Next
  Checklist?', EMER. MENU: Check All, Uncheck All, Reset All Checklists.

---

## 7. Alerting (`state/alerts.ts`)

`AlertSystem.cas` (CasModel, acknowledgeable levels warning / caution /
advisory). CAS conditions (`CasDef`, optional `delayS`) evaluate only with the
GEA and a display up; messages present at power-up are acknowledged
(Appendix A). Warning: repeating chime `audio.tone('master_warning')` until
acknowledged; caution: single `audio.play('master_caution')`.

`C172S_CAS` (Appendix A): warnings CO LVL HIGH, HIGH VOLTS, LOW VOLTS, OIL
PRESSURE, USP ACTIVE; cautions LOW FUEL L, LOW FUEL R, LOW VACUUM, STBY BATT;
advisories ESP OFF, AP AIL DISC (roll servo failure, EST mapping).

Alerts softkey (`g1k.alerts.key` 0 Alerts / 1 Message / 2 Advisory /
3 Caution / 4 Warning): pressing a CAS label acknowledges that level; Message
or Alerts opens the Alerts window and marks messages read.

System messages (texts verbatim from Appendix A): GPS NAV LOST, XPDR1 FAIL,
HDG FAULT, COM1 / COM2 PTT (stuck mic, transmitter stops after 35 s),
WPT ARRIVAL, APR INACTV, SLCT FREQ, SLCT NAV, TIMER EXPIRD, arrival alert.

Altitude alerting (`sys.altAlert`, common `AltitudeAlerter`): 1000 ft
approach cue, within 200 ft cue + `alt_alert` tone, ±200 ft deviation (yellow
+ tone). Minimums (`sys.minsAlert`): cyan within 2500 ft, white within 100 ft,
amber at minimums with the "Minimums, minimums" callout; armed 150 ft above,
reset 50 ft above, inhibited on the ground.

---

## 8. EIS (`gdu/Eis.ts`, `state/fuel.ts`)

ENGINE page: RPM arc (green top 2500 / 2600 / 2700 RPM by pressure altitude,
red 2700-3000, value / pointer / label red and flashing at ≥ 2780 RPM), FFLOW
GPH, OIL PRES PSI, OIL TEMP °F, EGT °F (hottest cylinder number on the
pointer), VAC, FUEL QTY GAL (L / R, float limit 24 gal, LOW FUEL amber mark
after 60 s, flashing red at empty, red X on transmitter failure), ENG HRS,
ELECTRICAL (M BUS E volts red at ≤ 24.5 V, M BATT S amps amber when
discharging). LEAN page: RPM, FFLOW, per-cylinder EGT columns and CHT marks
(selected / hottest cyan), EGT / CHT values, Assist ΔPEAK. SYSTEM page: OIL
PSI / °F, FUEL CALC (FFLOW GPH, GAL USED, GAL REM), ELECTRICAL, ENG HRS. Any
red exceedance returns the EIS to the ENGINE page. Red X over the strip
when the GEA is down. SCOPE: per-cylinder EGT / CHT use a fixed EST spread
of the engine's single EGT / CHT.

Totalizer: GAL USED integrates fuel flow; GAL REM = set value − used; RST
Fuel "resets calculated fuel remaining to default and resets fuel used to
zero"; ±1 / ±10 GAL, 35 / 53 GAL (PG Table 1-4). `g1k.fuel.rem_gal`,
`used_gal`, `rem_kg` (FMS fuel predictions). Engine hours count while oil
pressure > 20 psi.

---

## 9. GFC 700 glue (`state/afcs.ts`, `System`)

`AFCS_GFC700_NXI` = `AFCS_GFC700_G1000` + `altCaptureToHoldFt: 50` (PG §7.3)
and `maxVsFpm: 2000`. `AfcsMonitor` clamps the VS reference to −2000..+1500
fpm and FLC to 70..150 KIAS (PG Table 7-2). AFCS keys emit `ap.ap`, `ap.fd`,
`ap.hdg`, `ap.alt`, `ap.nav`, `ap.vnav`, `ap.apr`, `ap.bc`, `ap.vs`,
`ap.flc`, `ap.up` / `ap.dn` {steps: 1}. External: `ap.disc`, `ap.cws`,
`ap.toga` (GA button), `ap.lvl` (ESP).

* CDI source `g1k.pfd.cdi_src` (0 GPS, 1 NAV1, 2 NAV2) → `ap.nav_source`;
  CDI softkey moves the NAV tuning box. APR with GPS on the CDI and an ILS /
  LOC approach loaded arms LOC / GS on NAV1 (`afcsNavOverride`); the CDI
  switches to NAV1 automatically when the FAF is active within 15 nm, the LOC
  is received and the GPS CDI is within 1.2 x full scale (PG §2.1); the
  course follows the localizer course once per station.
* Approach auto-tune (PG §4.3): GPS on the CDI → LOC frequency into both NAV
  active fields (matching standby transferred); NAV on the CDI → that
  receiver's standby. Loading another approach resets the minimums.
* VNV: Cncl VNV / Enbl VNV (`g1k.vnv.enabled`) — while cancelled the system
  writes `fms.vnav_valid = 0` after the FMS update (no VDI / RVSI, no VPTH).
* AFCS status annunciation (`g1k.afcs.status`, level 0 yellow / 1 red /
  2 white): PFT white while the servos self-test (tone at completion), red
  PFT when servo power is present but the servos failed, AFCS red (GIA 1 down,
  `fail.afcs`, or servo power off), PTRM (pitch trim jam / runaway), ROLL /
  PTCH (servo failures), ↑ELE / ↓ELE (Afcs pitch mistrim), AIL→ / ←AIL (roll
  servo offset > 0.25 for 10 s, EST).
* Overspeed protection: MAXSPD (flashing amber) within 2 kt (EST) of Vne in
  PIT / VS / FLC / VPTH / ALTS / ALTV; SCOPE: in PIT / VS the reference is
  raised one NOSE UP step per second instead of limiting the command.

---

## 10. ESP / USP, GMA 1360, GTX 345R, radios

**ESP** (`state/esp.ts`, PG §8.11): active above 200 ft AGL, GS > 30 kt or TAS
> 50 kt, AP off, within ±50° pitch / ±75° bank, not interrupted (CWS or AP DISC
held); roll engage 45° / force 30-75° / disengage 30° (roll limit indicator
`g1k.esp.roll_limit` 45 → 30 while engaged); pitch +16/+20/+14°, −16/−20/−14°;
above Vne nose-up force; below 55 KIAS for 1 s nose-down (not without GPS);
engaged > 10 s of 20 s → "Engaging Autopilot" + `ap.lvl`. Outputs
`g1k.esp.servo_pitch / _roll` (normalized surface increments, max 0.12 /
0.15 EST slip-clutch authority) — the aircraft adds them to its flight
controls. **USP** (AP engaged): MINSPD / USP activation at 60 KIAS (PG Tables
7-7 / 7-8), stall warning in altitude-critical modes, single "Airspeed"
callout, red UNDERSPEED PROTECT ACTIVE; SCOPE: the reference is stepped nose
down twice per second instead of the mode reverting to armed.

**GMA 1360** (`state/audio.ts`): COM1 / COM2 MIC (select the receiver too),
simultaneous press = Split-COM, receiver keys, TEL / MUS1 / MUS2 OFF → WHITE →
BLUE (one Bluetooth source), ICS keys, SPKR/PA (hold 2 s = PA: no COM
selected), MKR/MUTE (on / muted until the next marker / off; drives the
`marker_*` tones), HI SENS (`nav.marker_hi_sens`), MAN SQ, PLAY (SCOPE: no
recorded audio; play indication per block), VOL/SQ + CRSR cursor (times out
10 s, EST), Blue-Select, Bluetooth discoverable (hold 2 s, 90 s; SCOPE: never
pairs), 2 s self-test, fail-safe (COM1 transmit only). AUX MIC is not used in
the NAV III (no effect). Lights `g1k.gma.lt_<key>` (0 off, 1 white, 2 blue,
0.5 flash phase).

**GTX 345R** (`state/xpdr.ts`): STBY / ON / ALT (`xpdr.mode` 1 / 2 / 3), VFR
1200 ↔ previous code, 18 s IDENT (inhibited in STBY), code entry (§5), 'R'
reply indication airborne, mode / code white on the ground and green
airborne; `g1k.xpdr.flight_id` (string, SCOPE: shown only).

**Radios** (`state/radios.ts`): §3; volumes `g1k.nav<r>.vol`,
`g1k.com<r>.vol` (0..100 %), `g1k.com<r>.squelch`, TX `g1k.com<r>.tx`.

---

## 11. Displays and controls (`gdu/*`, `controls.ts`)

`GduDisplay` (CanvasDisplay 1024 x 768, 30 Hz, pixel ratio 0.9): formats off
/ boot (Garmin splash) / MFD power-on page / PFD / reversionary / MFD
(`display.format`). Backlight: automatic (`display.<id>.brt` or the cockpit
dimmer) or manual `g1k.<gdu>.brt_manual` / `brt_pct`. Clicking a softkey label
presses it. Layout constants in `gdu/style.ts` (measured from PG Figure 2-1).

PFD (`gdu/Pfd.ts`): full-screen attitude (7 px/deg, bank arc r 200, single-cue
FD, chevrons, declutter), airspeed tape (60 kt, 172S bands, V-speed bugs, list
below 20 KIAS, TAS box, FLC reference), altimeter (600 ft, selected altitude
box with alerting, baro, minimums bug), VSI (±2000), GS / GP / VDI, markers,
HSI (bearing pointers, OBS / SUSP / DR, flight phase), HDG and CRS / DTK
boxes, wind (options 1-3), DME info, bearing info windows, BARO MIN / COMP MIN,
top bar, CAS window, OAT, XPDR box, UTC / LCL / TMR, inset / HSI map, AFCS
status annunciation, MAXSPD / MINSPD, UNDERSPEED PROTECT ACTIVE, ESP roll
limit indicators, SVT symbology (flight path marker, horizon heading labels;
SCOPE: no synthetic terrain imagery).

MFD (`gdu/Mfd.ts`): EIS strip, navigation data bar and page title, pages
(§6), page group window, pop-ups.

`g1000Controls(cfg)`: every control with `id`, `unit` (`pfd` / `mfd` / `gma`
/ `yoke` / `panel`), `kind`, `label`, `press` / `release` / `incEvent` /
`decEvent` / `innerIncEvent` / `innerDecEvent` / `joystick`, `lightVar`
(AFCS keys: `ap.btn_*`, `ap.engaged`, `ap.fd1_on`; GMA: `g1k.gma.lt_*`;
DISPLAY BACKUP: `g1k.display_backup`) and `pos` (mm, EST). Unit sizes
`UNIT_SIZE_MM` (GDU 1054B 315 x 223, GMA 1360 58 x 223, EST).

---

## 12. Tests and preview

* `tests/avionics/garmin-g1000/system.test.ts`: power / boot / power-on page,
  reversionary modes and radio validity, PFD softkey tree, XPDR entry
  (softkeys and FMS knob), CDI / bearings / STD Baro / layouts, radios (EMERG
  hold, volume), knobs (HDG SYNC, ALT with minimums stop, CRS, baro), GMA 1360,
  CAS / Alerts key / chimes, TIMER EXPIRD, totalizer, EIS auto-return, MFD
  page navigation / setup / checklists, Tmr/Ref, Nearest, Direct-to, FPL
  insertion, controls map.
* `tests/avionics/garmin-g1000/afcs.test.ts` (real `Afcs`): ROL / PIT
  default, HDG, VS / NOSE UP and the +1500 limit, FLC 70 kt floor, manual
  disconnect, ALTS → ALT at 50 ft, GA, APR arming LOC with GPS on the CDI and
  auto-tune, VNV cancel, ESP roll + automatic LVL, ESP low speed and the
  200 ft gate, USP, AFCS status annunciations, MAXSPD.
* Preview: `npx vite --port 5199` →
  `/src/avionics/garmin-g1000/dev/preview.html?state=cruise|approach|ground|rev|boot|splash`
  with `page=<mfd page id>`, `win=<pfd window>`, `eis=lean|system`,
  `map=hsi`; `window.__g1k` for automation.
