# Navigation module — API reference

Owner: nav module. Source: `src/nav/**`, `scripts/build-navdata.mjs`,
generated data in `public/data/**`. Tests: `tests/nav/**`
(`npx vitest run tests/nav`, 73 tests, ~5 s; they load the real generated data).

This document is written so aircraft and avionics authors can wire radios,
GPS and the FMS into an aircraft and build FMS/CDU/MFD pages **without
reading the source**. Everything is importable from the barrel
`src/nav/index.ts` (`import { Radios, Fms, ... } from '@/nav'`).

---

## 0. Quick start

### 0.1 App level (once): the database

```ts
import { createNavDatabase } from '@/nav';
const nav = createNavDatabase();          // NavDatabaseImpl, implements NavDatabase
await nav.load();                         // fetches ./data/*.json.gz (~10 MB gz, < 2 s)
ctx.nav = nav;                            // SimContext.nav
```

### 0.2 Aircraft level: radios + FMS

```ts
import { Radios, Fms } from '@/nav';
import { NAV as NAVV, GPS as GPSV, FMS as FMSV } from '@/core/vars';   // var names live in core/vars

create(ctx) {
  const radios = new Radios(ctx, { navCount: 2, adfCount: 1 });   // + marker + GPS
  const fms = new Fms(ctx, {
    style: 'garmin',                      // 'boeing' for the 737 FMC (MOD + EXEC)
    engineCount: 2,
    speeds: { climbKt: 250, cruiseKt: 300, cruiseMach: 0.78, descentKt: 280, descentMach: 0.76, approachKt: 130 },
  });
  const systems = [elec, /* sensors (ADC/AHRS) */, radios, fms, autopilot, ...];
  // Electrical logic each step (e.g. inside your avionics-bus subsystem):
  //   vars.set(NAVV.powered(1), avionicsBusPowered && nav1Switch ? 1 : 0)
  //   vars.set(GPSV.powered, gpsBusPowered ? 1 : 0)
  //   vars.set(NAVV.markerPowered, audioPanelPowered ? 1 : 0)
  //   vars.set(NAVV.adfPowered(1), adfOn ? 1 : 0)
  // Tuning: vars.set(NAVV.activeFreq(1), 110.9); vars.set(NAVV.obs(1), 44);
  // Autopilot in LNAV/GPSS: if (vars.getBool(FMSV.lnavValid)) rollCmd = vars.get(FMSV.lnavBankCmd)
}
```

Order matters: sensors (ADC/AHRS) → `Radios` (writes `gps.*`) → `Fms`
(reads `gps.*`, `adc*`, `ahrs*`) → autopilot (reads `fms.*`, `nav*`).
Both subsystems may run at 60 Hz in the systems list or at 20 Hz in the
`SimLoop` `nav` callback; neither allocates per update (measured: radios
~12 µs, FMS ~16 µs per update with a 40-leg plan).

State presets: in `applyState('cruise' | 'approach' | ...)` call
`radios.gps?.forceAcquired()` so the GPS does not spend 45 s acquiring.

---

## 1. Data (`public/data`, `scripts/build-navdata.mjs`)

### 1.1 Regenerating

```
npm run navdata                   # = node scripts/build-navdata.mjs
node scripts/build-navdata.mjs [--offline] [--refresh] [--no-cifp] [--procedures all|major|none] [--cache DIR] [--out DIR]
```

* Node ≥ 22.18 (the parsers in `src/nav/data/*.ts` are imported through
  Node's native TypeScript type stripping; no dependencies).
* Behind a proxy: Node's `fetch` ignores `HTTPS_PROXY` unless
  `NODE_USE_ENV_PROXY=1`; the script re-executes itself with it when
  `HTTPS_PROXY` is set. Proxy CA via `NODE_EXTRA_CA_CERTS`.
* Downloads are cached in `.cache/navdata/` (7 days; `--refresh` forces,
  `--offline` uses the cache only). Run takes ~8 s from cache.

### 1.2 Sources and merge policy

| Data | Source | Currency |
|---|---|---|
| Airports, runways (both ends, lat/lon/elev/true heading/length/width/displaced/surface/lighted), frequencies, VOR/DME/TACAN/NDB | OurAirports CSV (public domain) | daily |
| Worldwide ILS/LOC/GS/ILS-DME, marker beacons, fixes, airways | FlightGear fgdata `Navaids/{nav,fix,awy}.dat.gz` (X-Plane 810/600/640 formats, GPL-2.0) | **AIRAC 2013.10** |
| US localizers/glideslopes (with published course width, TCH, declination), enroute + named terminal fixes, airways, **all SIDs/STARs/approaches** (3070 airports) | FAA CIFP (ARINC 424-18, public domain) | current AIRAC (2609, eff. 03 SEP 2026 at generation) |

* Airports: closed and balloonports excluded; heliports (`type: 'heliport'`)
  and seaplane bases kept.
* Localizers: CIFP replaces FlightGear for every airport the CIFP covers;
  FlightGear markers are kept only where the runway still has a localizer.
* Fixes: CIFP enroute + named terminal waypoints added; a FlightGear fix is
  dropped when a CIFP fix with the same ident is within 30 nm.
  Procedure-local names (`CF06`, `FF19R`, `RW04L`, ...) are not global fixes.
* Airways: for each airway name in the CIFP, FlightGear segments of that name
  within 150 nm of the CIFP airway are replaced.
* Navaid service volume (`rangeNm`, AIM 1-1-8): VOR/DME T 25, L 40, H 130 nm
  (smaller of OurAirports usage and power class); NDB compass locator 15,
  MH 25, H 50, HH 75. VOR `magVar` = slaved variation (station declination)
  when published, else local variation.
* `meta.json`: sources, cycles, counts, sizes. Current total ≈ 10.7 MB.

### 1.3 Files (formats in `src/nav/data/format.ts`)

`airports.json.gz`, `navaids.json.gz`, `ils.json.gz`, `fixes.json.gz`,
`airways.json.gz`, `meta.json`, `procedures/index.json`,
`procedures/<ident>.json.gz`. Positional arrays; only `NavDatabaseImpl`
decodes them. `NAVDATA_FORMAT_VERSION = 1`.

---

## 2. Types (`src/nav/types.ts`, append-only)

Original contract types are unchanged (`Runway`, `IlsInfo`, `Airport`,
`Navaid`, `Fix`, `AirwaySegment`, `Waypoint`, `NavDatabase`). Appended
**optional** fields (declaration merging):

| Interface | Added fields |
|---|---|
| `Runway` | `thresholdLat?`, `thresholdLon?` (landing threshold = physical end `lat/lon` moved `displacedFt` along `headingTrue`), `positionEstimated?` (source had no coordinates; synthesised at the airport reference point from the designator — ~20k small-airport runways) |
| `IlsInfo` | `kind?: 'ILS'\|'LOC'\|'LDA'\|'SDF'\|'IGS'`, `courseWidthDeg?` (CIFP published total width), `locElevFt?`, `dmeElevFt?`, `tchFt?`, `declination?`, `source?: 'CIFP'\|'FG'` |
| `Airport` | `iata?`, `gpsCode?`, `localCode?`, `magVar?` (WMM2025 at the ARP, deg + east) |
| `Navaid` | `id?` (stable index), `dmeLat?`, `dmeLon?`, `dmeElevationFt?`, `hasDme?`, `usage?`, `country?`, `channel?`, `locKind?`, `courseWidthDeg?`, `thresholdLat?`, `thresholdLon?`, `thresholdElevFt?`, `tchFt?` |
| `AirwaySegment` | `fromLat?`, `fromLon?`, `toLat?`, `toLon?`, `level?: 1\|2\|3` (low/high/both), `maxAltFt?`, `oneWay?` |
| `Waypoint` | `region?`, `navaid?: Navaid`, `airport?`, `elevationFt?` |
| `NavDatabase` | `loadProcedures?(icao): Promise<AirportProcedures \| undefined>` |

Semantics worth knowing:
* `Runway.lat/lon` is the **physical runway end** (start of pavement);
  `elevationFt` that end's elevation (or the airport's).
* `Airport.icao` is the OurAirports `ident` (ICAO code when one exists, else
  FAA LID / local code such as `1G4`, `00AK`). `airport()` also accepts
  ICAO/GPS/local/IATA codes.
* `Navaid.freq`: MHz for VHF (VOR/DME/TACAN paired VHF, LOC, GS), kHz for
  NDBs. ILS components are separate navaids on the localizer frequency:
  type `'ILS'` (localizer with GS) / `'LOC'` (LOC, LDA, SDF, IGS without GS),
  `'GS'`, `'DME'` (with `airport`/`runway` set), markers `'OM'|'MM'|'IM'`
  (`freq` 75, `ident` = type, `courseTrue` = beam orientation).
* Localizer `courseTrue` = front course (landing direction); `magVar` on ILS
  navaids = station declination (or airport variation).

### 2.1 Procedure types

```ts
type LegType = 'IF'|'TF'|'CF'|'DF'|'FA'|'FC'|'FD'|'FM'|'CA'|'CD'|'CI'|'CR'|'VA'|'VD'|'VI'|'VM'|'VR'|'RF'|'AF'|'HA'|'HF'|'HM'|'PI';

interface AltitudeConstraint {
  kind: 'at' | 'atOrAbove' | 'atOrBelow' | 'between';
  lowerFt?: number;           // 'at' and 'atOrAbove' and 'between'
  upperFt?: number;           // 'at' and 'atOrBelow' and 'between'
  code?: string;              // ARINC 5.29 char as coded: '@','+','-','B','G','H','I','J','V','X','C'
  glideslopeFt?: number;      // GS/GP altitude at the FAF when coded (G/H/I/J/V)
}
interface SpeedConstraint { kind: 'at' | 'atOrBelow' | 'atOrAbove'; kt: number }

interface ProcedureLeg {
  type: LegType;
  fix?: Waypoint;             // terminator (or origin fix of FA/FC/FD/FM, hold fix, PI fix); NaN lat/lon if unresolved
  flyOver: boolean;
  turnDirection?: 'L' | 'R';  // required turn (forced by LNAV for large turns)
  course?: number;            // deg MAGNETIC unless courseIsTrue (course, heading, hold inbound, PI 45° leg course)
  courseIsTrue?: boolean;
  distanceNm?: number;        // FC distance, FD/CD/VD DME distance, hold leg length, PI excursion limit
  holdTimeMin?: number;
  altitude?: AltitudeConstraint;
  speed?: SpeedConstraint;
  verticalAngleDeg?: number;  // positive = descending path angle (coded on the leg into the MAP)
  recommendedNavaid?: Waypoint & { declination?: number };
  theta?: number; rho?: number;          // bearing (mag) / distance (nm) from the navaid
  arcRadiusNm?: number; arcCenter?: Waypoint;   // RF (AF: centre = recommendedNavaid, radius = rho)
  magVar: number;             // variation for course -> true (navaid declination when referenced, else airport)
  descriptor?: string;        // ARINC 5.17 waypoint description (4 chars)
  iaf?: boolean; intermediateFix?: boolean; faf?: boolean; map?: boolean; missedStart?: boolean;
}
interface ProcedureTransition { name: string; legs: ProcedureLeg[] }   // runway transitions: '04L', '04B' (all 04x), 'ALL'
type ApproachType = 'ILS'|'LOC'|'LOC_BC'|'LDA'|'SDF'|'IGS'|'GLS'|'RNAV'|'RNP'|'GPS'|'FMS'|'VOR'|'VORDME'|'TACAN'|'NDB'|'NDBDME'|'MLS';
interface FasData { levelOfService: 'LPV'|'LP'|''; ltpLat; ltpLon; ltpEllipsoidM; glidepathDeg; fpapLat; fpapLon; courseWidthM; tchFt }
interface Procedure {
  type: 'SID' | 'STAR' | 'APPROACH';
  ident: string;              // 'WENTZ1', 'R06-Y', 'I09'
  name: string;               // 'WENTZ1', 'RNAV (GPS) Y RWY 06', 'VOR-A'
  runways: string[];          // normalised ('06', '04L'); SID/STAR: runway transition names
  runwayTransitions: ProcedureTransition[];
  commonLegs: ProcedureLeg[];
  transitions: ProcedureTransition[];   // SID/STAR enroute transitions; approach transitions (feeders)
  finalLegs: ProcedureLeg[];  // approach: up to and including the MAP / runway
  missedLegs: ProcedureLeg[];
  approachType?: ApproachType; suffix?: string;
  navFrequencyMhz?: number; navIdent?: string; navCourseTrue?: number;  // ILS/LOC/VOR approaches (auto-tune)
  fas?: FasData;              // LPV/LP approaches
  glidepathDeg?: number;      // FAS GPA, coded VPA, or GS angle
  synthetic?: boolean;
}
interface AirportProcedures { icao; cycle /* '2609' or 'synthetic' */; magVar; sids; stars; approaches }
```

---

## 3. `NavDatabaseImpl` (`src/nav/NavDatabase.ts`)

```ts
new NavDatabaseImpl(options?: NavDatabaseOptions)    // or createNavDatabase(options)
interface NavDatabaseOptions {
  baseUrl?: string;              // default './data/' (relative to the page: dev server, preview, Electron app://)
  loader?: NavDataFileLoader;    // (file) => Promise<Uint8Array|ArrayBuffer|string|undefined>; overrides baseUrl
  magVarYear?: number;           // decimal year for WMM (default: now)
  synthesizeApproaches?: boolean;// default true
  onProgress?: (msg: string) => void;
}
```

Node / tests: `import { createFileLoader } from '@/nav/data/nodeLoader'`
(`createFileLoader('public/data')`; Node-only, never import from browser code).
Gzip is detected by magic bytes and decoded with `DecompressionStream`
(servers that add `Content-Encoding: gzip` also work). Helpers:
`decodeDataFile(data)`, `fetchLoader(baseUrl)`,
`headingFromRunwayIdent('09L') -> { deg: 90, isTrue: false }`.

| Member | Notes |
|---|---|
| `ready: boolean`, `load(): Promise<void>` | `load` is idempotent; all query methods return empty before ready. |
| `meta: NavdataMeta \| null`, `counts` | sources/cycles; `{ airports, navaids, fixes, airwaySegments }` |
| `airport(code)` | ident, ICAO, GPS, local or IATA code. Materialised on demand (LRU of 8000). |
| `airportsNear(lat, lon, radiusNm, limit = 50)` | sorted by distance |
| `searchAirports(query, limit = 20)` | exact codes > ident prefix > name/city word prefix > substring; larger airports first within a tier |
| `runway(icao, ident)` | '4L', '04L', 'RW04L' all match |
| `ils(icao, runway)` | `IlsInfo` of a runway end |
| `navaidsByIdent(ident)`, `navaidsNear(lat, lon, r, types?)` | all navaid kinds incl. ILS parts and markers (filter with `types`) |
| `navaidsOnFreq(freq, lat, lon, r)` | stations on a frequency (MHz or kHz), nearest first |
| `collectOnFreq(freq, lat, lon, r, out)`, `collectMarkersNear(lat, lon, r, out)` | allocation-light variants used by receivers |
| `fixesByIdent(ident)`, `fixesNear(lat, lon, r)` | |
| `resolve(ident, nearLat, nearLon): Waypoint[]` | airports (`kind 'airport'`), VOR/DME/TACAN (`'vor'`, with `navaid`), NDB (`'ndb'`), fixes (`'fix'`, with `region`), nearest first. ILS parts and markers excluded. |
| `airway(name)` | segments (with coordinates, `high`, `level`, `minAltFt`, `maxAltFt`, `oneWay`) |
| `airwaysAt(ident)` | airway names through a fix ident |
| `hasPublishedProcedures(icao)` | CIFP file exists |
| `loadProcedures(icao)` | cached promise; published procedures (CIFP) + synthetic approaches for every uncovered runway end (see 6.6). `undefined` for unknown airports. ILS approaches without a VPA get `glidepathDeg` from the GS. |

---

## 4. Radios (`src/nav/Radios.ts`, `src/nav/radios/*`)

```ts
new Radios(ctx: { vars: SimVars; nav: NavDatabase }, opts?: RadiosOptions)   // Subsystem, name 'radios'
interface RadiosOptions {
  navCount?: number;                 // default 2  -> nav1..navN
  adfCount?: number;                 // default 1  -> adf1..adfN (0 = none)
  marker?: boolean | MarkerReceiverOptions;   // default true
  gps?: boolean | GpsReceiverOptions;         // default true
  nav?: NavReceiverOptions; adf?: AdfReceiverOptions;
}
radios.nav[i]: NavReceiver  (.station, .glideslopeStation, .dmeStation: Navaid | null)
radios.adf[i]: AdfReceiver  (.station)
radios.marker, radios.gps (GpsReceiver: .forceAcquired())
radios.update(dt); radios.reset()   // reset() re-searches stations (after reposition)
```

Receivers read the aircraft position from FDM truth (`fdm.lat_deg`,
`fdm.lon_deg`, `fdm.alt_msl_ft`; ADF also `fdm.hdg_true_deg`) because they
model the physical signal.

### 4.1 NAV receiver `nav{r}` — inputs (written by the aircraft)

| Var | Meaning |
|---|---|
| `nav{r}.powered` | 0/1 receiver power (bus + switch). Off → all outputs flagged/cleared. |
| `nav{r}.active_mhz` | tuned frequency (MHz). ILS channels (108.10–111.95, odd tenths) tune localizers, others VORs. |
| `nav{r}.obs_deg` | OBS / selected course (deg magnetic), used for VOR CDI/TO-FROM. |
| `nav{r}.dme_hold` | 1 = DME keeps the frequency tuned when hold was engaged. |
| `nav{r}.stby_mhz` | not read (standby display only). |

### 4.2 NAV receiver outputs

| Var | Meaning |
|---|---|
| `nav{r}.received` | 1 = azimuth signal valid (flag out of view) |
| `nav{r}.is_loc` | 1 = tuned to an ILS channel |
| `nav{r}.radial_deg` | VOR: magnetic radial FROM the station (station declination). LOC: bearing from the antenna (informative). |
| `nav{r}.cdi` | −1..1, **+ = needle right (fly right)**. VOR ±10°; LOC course width/2. Back course keeps front-course sense (reverse sensing). |
| `nav{r}.dev_deg` | angular deviation, same sign as `cdi` |
| `nav{r}.to_from` | 1 TO, −1 FROM, 0 ambiguous/none. LOC: 1. |
| `nav{r}.bearing_deg`, `nav{r}.bearing_valid` | magnetic bearing TO the VOR (= radial+180) for RMI needles; not valid for localizers |
| `nav{r}.loc_course_deg` | localizer front course (magnetic, station declination) — for auto-set course |
| `nav{r}.back_course` | 1 in the back-course sector |
| `nav{r}.gs_valid`, `nav{r}.gs_dev` | glideslope flag; −1..1, **+ = glideslope above aircraft (fly up)**, full scale ±0.24·θ (0.72° at 3°) |
| `nav{r}.gs_dev_deg` | θ − elevation angle (deg) |
| `nav{r}.dme_valid`, `nav{r}.dme_nm` | slant range (nm) to the paired DME (VOR/DME, VORTAC, ILS DME, or a standalone DME/TACAN on the channel) |
| `nav{r}.dme_gs_kt`, `nav{r}.dme_tts_min` | DME ground speed (≥ 0) and time to station (0 when receding) |
| `nav{r}.ident`, `nav{r}.ident_morse` | strings: station ident ('ITEB') and its morse pattern ('.. - . -...'); '' when not received |
| `nav{r}.dme_ident`, `nav{r}.station_type` | strings: DME station ident; received type ('VOR','VORDME','VORTAC','ILS','LOC') |
| `nav{r}.signal` | 0..1 signal quality (use for ident audio volume) |
| `nav{r}.dist_nm` | horizontal distance to the VOR/LOC antenna |

Behaviour: reception needs `distance ≤ rangeNm × rangeFactor` (default
1.25; LOC coverage 25/17/10 nm by angle off course, ICAO Annex 10; back
course 60 %) **and** radio line of sight `1.23·(√(h_ac−h_stn) + √15 ft)`
(4/3 earth). Strongest station on a shared frequency wins. After retuning:
0.5 s settling flag, 1.5 s DME search. VOR cone of confusion: flag and
TO/FROM 0 within 45° of vertical (DME keeps working). Glideslope:
null-reference antenna model — false glidepath at 3θ with reversed sensing,
carrier null (flag) at 2θ and near the ground; coverage ±8° azimuth,
10 nm × rangeFactor; earth curvature included.

`NavReceiverOptions`: `rangeFactor` (1.25), `retuneIntervalS` (5),
`stationAntennaFt` (15), `settleS` (0.5), `dmeLockS` (1.5),
`coneHalfAngleDeg` (45), `gsCarrierMin` (0.2).

### 4.3 ADF `adf{r}`

Inputs: `adf{r}.powered` (0/1), `adf{r}.active_khz`, `adf{r}.mode`
(0 ANT, 1 ADF, 2 BFO; **default ADF when never written**).
Outputs: `adf{r}.rel_bearing_deg` (0 = nose, clockwise; parks at 90 when no
bearing), `adf{r}.valid`, `adf{r}.ident`, `adf{r}.ident_morse`,
`adf{r}.signal`, `adf{r}.dist_nm`. RMI card position = heading + relative
bearing (the instrument does this). Range = NDB class × rangeFactor, no
line-of-sight limit. Options: `rangeFactor`, `retuneIntervalS`, `settleS` (1).

### 4.4 Marker beacons

Inputs: `nav.marker_powered` (or `MarkerReceiverOptions.powerVar`),
`nav.marker_hi_sens` (1 = HI, pattern × 1.6). Outputs `nav.marker_outer`,
`nav.marker_middle`, `nav.marker_inner` (0/1 while inside the elliptical
beam: 2,400 × 4,200 ft at 1,000 ft above the antenna, AIM 1-1-9).
Lamps/tones (400/1300/3000 Hz) are the aircraft's.

### 4.5 GPS receiver (`GPS` const in `vars.ts`)

Inputs: `gps.powered` (0/1), `gps.fail` (1 = no solution).
Outputs (valid after acquisition: 45 s cold, 15 s if power returns within
10 min): `gps.valid`, `gps.lat_deg`, `gps.lon_deg`, `gps.alt_ft`
(geometric MSL), `gps.gs_kt`, `gps.trk_true_deg` (held below 3 kt),
`gps.trk_mag_deg`, `gps.vs_fpm`, `gps.mag_var_deg` (WMM, + east),
`gps.sats`, `gps.epu_nm`, `gps.sbas`, `gps.acq_s` (seconds to fix),
`gps.utc_h`. Options `GpsReceiverOptions`: `acquisitionS`,
`warmAcquisitionS`, `warmWindowS`, `sbas` (default true), `magVarYear`.
`forceAcquired()` for state presets.

### 4.6 Geometry helpers (`radioGeometry` namespace / `src/nav/radios/geometry.ts`)

`radioLineOfSightNm(h1Ft, h2Ft)`, `slantRangeNm(acLat, acLon, acAltFt, stLat, stLon, stElevFt)`,
`vorRadial(stLat, stLon, declination, acLat, acLon)`,
`vorCdi(radial, obs, out: VorCdi, ambiguityDeg = 2)` → `{devDeg, cdi, toFrom}`,
`locDeviation(locLat, locLon, courseTrue, acLat, acLon, out)` → `{devDeg, offCourseDeg, backCourse, distNm}`,
`locCourseWidthDeg(locToThresholdNm, publishedDeg?)`, `locCoverageNm(offCourseDeg)`,
`glideslope(gsLat, gsLon, gsElevFt, angleDeg, courseTrue, acLat, acLon, acAltFt, out)` → `{elevationDeg, dev, devDeg, carrier, azimuthOffDeg, distNm}`,
`inMarkerCone(mLat, mLon, mElevFt, courseTrue, acLat, acLon, acAltFt, sensitivity = 1)`,
`isLocalizerFrequency(mhz)`, `VOR_FULL_SCALE_DEG = 10`, `FT_PER_NM`. `morse(ident)`.

---

## 5. Flight plans (`src/nav/flightplan/*`)

### 5.1 `PlanLeg`, `LegGeometry`

`PlanLeg` = `ProcedureLeg` fields plus:

| Field | Meaning |
|---|---|
| `id` (readonly) | unique, preserved by `clone()` (active leg survives EXEC) |
| `type` | a `LegType` or `'DISCO'` (route discontinuity marker, no fix) |
| `segment` | `'origin' \| 'departure' \| 'enroute' \| 'arrival' \| 'approach' \| 'missed' \| 'destination'` |
| `procedure?`, `airway?` | source procedure ident / airway name |
| `userConstraint?` | pilot-entered constraint |
| `dfStartLat?`, `dfStartLon?` | runtime start of direct-to legs |
| `geom` (readonly object, updated in place) | `LegGeometry` below |

`LegGeometry` (deg true / nm): `valid`, `kind: 'none'|'gc'|'arc'|'heading'|'hold'|'pt'`,
`startLat/Lon`, `endLat/Lon` (terminator; predicted for CA/VA/FA/CD/CI/CR...),
`courseTrue`, `finalCourseTrue`, `lengthNm`, `endEstimated`, `unbounded`
(FM/VM/HM), arc: `centerLat/Lon`, `radiusNm`, `turnDir` (+1 right), `startRadial`, `sweepDeg`;
hold: `holdInboundTrue`, `holdLegNm`, `radiusNm`, `turnDir`;
fly-by transition into the next leg: `turnValid`, `turnRadiusNm`,
`turnAnticipationNm`, `turnAngleDeg` (+ right), `turnCenterLat/Lon`,
`turnStartLat/Lon`, `turnEndLat/Lon`; `cumDistNm` (plan distance to this
leg's end), `predictedAltFt` (VNAV path altitude at the leg end after the TOD, else NaN).
Map displays draw: `gc` start→end, `arc`, the turn arc, holds as racetracks
(inbound course, leg length, radius, direction), `heading` legs as a
dashed line.

Helpers: `emptyGeometry()`, `endsAtFix(t)`, `isHeadingLeg(t)`, `isHoldLeg(t)`, `isManualLeg(t)`.

### 5.2 `FlightPlan`

```ts
new FlightPlan(style: 'garmin' | 'boeing' = 'garmin')
```

| Member | Notes |
|---|---|
| `origin`, `destination`, `alternate: Airport \| null` | |
| `departureRunway`, `arrivalRunway: string \| null` | normalised ('04L') |
| `sid`, `star`, `approach: ProcedureSelection \| null` | `{ ident, runwayTransition?, enrouteTransition? }` (approach transition in `enrouteTransition`) |
| `sidProcedure`, `starProcedure`, `approachProcedure: Procedure \| null` | the selected database objects |
| `cruiseAltFt` (0 = unset), `descentFpaDeg` (3.0), `cruiseSpeedKt`, `cruiseMach` | |
| `legs: PlanLeg[]`, `activeLegIndex` (−1 none), `activeLeg`, `version` | `version` increments on every change |
| `clone()`, `touch()`, `normalize()`, `indexOfLegId(id)` | |
| `fafIndex`, `mapIndex`, `firstMissedIndex`, `lastNonMissedIndex`, `legsIn(segment)` | |
| `setOrigin(airport, runway?)` | clears departure runway/SID; origin leg = IF at the runway threshold (`RWxx`) or airport |
| `setDepartureRunway(rw)` | re-picks the SID runway transition |
| `setDestination(airport)` | clears STAR/approach/arrival runway; destination leg = TF to the airport (or `RWxx`) |
| `setArrivalRunway(rw)`, `setAlternate(a)` | |
| `setSid(proc \| null, runwayTransition?, enrouteTransition?)` | runway transition defaults to the one serving `departureRunway` (or the only one) |
| `setStar(proc \| null, enrouteTransition?, runwayTransition?)` | runway transition defaults to the arrival runway's |
| `setApproach(proc \| null, transition?)` | replaces the destination leg with transition + final legs (segment `approach`) and missed legs (`missed`); sets `arrivalRunway` |
| `insertWaypoint(index, wpt, { segment?, airway? })` | TF before `index`. Boeing: discontinuity after it, or closes up to a downstream duplicate. Garmin: direct connection. |
| `appendEnrouteWaypoint(wpt, airway?)` | before arrival/approach/destination |
| `insertAirway(entryIndex, airway, exitIdent, db)` | expands after leg `entryIndex` (throws if not connected) |
| `deleteLeg(index)` | closes the route; deleting a `DISCO` connects the next leg |
| `setAltitudeConstraint(index, c \| null)`, `setSpeedConstraint(index, c \| null)` | pilot entries |
| `insertHold(index, { inboundCourseMag?, turnDirection?='R', legTimeMin?, legDistanceNm? })` | HM after the fix of leg `index` (inbound default = course arriving at the fix, needs geometry) |
| `directTo(target: number \| Waypoint, fromLat, fromLon, courseMag?)` | leg index → DF (CF with a course); Boeing deletes earlier legs. Off-plan waypoint → inserted before the active leg + discontinuity. Sets `activeLegIndex`. |
| `activateLeg(index)` | |

Junction rules (`normalize()`, run by every edit): repeated fix (same ident
within 1 nm) merges, later constraints win; an `IF` that does not continue
the route becomes a `DISCO` (Boeing) or a `TF` (Garmin); FM/VM (vectors)
are always followed by a `DISCO`; an HM hold continues along the route once
exited.

`makeLeg(fields)` / `legFromProcedure(procLeg, segment, procIdent)` create legs.

### 5.3 `FlightPlanManager`

```ts
new FlightPlanManager(style, { vars?, events? })
```

| Member | Garmin | Boeing |
|---|---|---|
| `active`, `modified`, `pending`, `displayed` | `modified` always null | MOD copy while pending; `displayed` = MOD or active |
| `edit()` | returns `active` | creates/returns the MOD copy |
| `commit()` | notify (active changed) | notify (MOD changed) |
| `apply(fn)` | `fn(edit()); commit()` | same |
| `exec()` | no-op (false) | MOD → active; active leg kept by id unless the MOD chose one (direct-to) |
| `erase()` | no-op | discards the MOD |
| `replace(plan)` | becomes active | becomes the MOD (needs EXEC) |
| `onChange(fn)` | `fn(plan, 'edit'\|'exec'\|'erase'\|'replace')` | |

Writes `fms.mod_pending` (EXEC light), `fms.plan_version`, `fms.crz_alt_ft`,
`fms.dest`. Emits `PLAN_EVENTS.activeChanged` (`'fms.plan_active_changed'`,
payload `{reason}`) and `PLAN_EVENTS.modChanged` (`'fms.plan_mod_changed'`).

### 5.4 Route strings

```ts
parseRoute(db, 'KTEB/24 WENTZ1 RUUDY WHITE J209 SBY DCT ACORI.FROGZ5 KMIA/09', style?): Promise<RouteParseResult>
interface RouteParseResult { plan: FlightPlan; errors: string[]; warnings: string[] }
```

First/last tokens: origin/destination (optional `/RWY`). SID: an origin SID
ident, transition dotted (`RUUDY6.WAVEY`) or the next token. STAR:
destination STAR ident, transition dotted (`ENE.PARCH3`) or the previous
fix. Airways between two fixes are expanded (`expandAirway(db, airway,
entryWaypoint, exitIdent)`, coordinates disambiguate duplicates, one-way
respected). `DCT` ignored. ICAO speed/level groups (`N0450F350`,
`M078F390`, `K0830S1130`, `F350`, `A045`, `FIX/N0450F350`) set
`cruiseAltFt`/`cruiseSpeedKt`/`cruiseMach`. Lat/lon: `4030N07350W`,
`40N073W`, `N4030W07350` (whole degrees named `N40W073`). Other tokens:
`db.resolve` nearest to the previous point (warning if ambiguous).
Helpers `parseSpeedLevel(tok)`, `parseLatLon(tok)`, `latLonIdent(...)`.

### 5.5 Geometry

`computePlanGeometry(plan, { groundSpeedKt, startAltFt, climbGradientFtPerNm? = 500, bankLimitDeg? = 25, cruiseAltFt? }): number`
(total length; `Fms` calls it for you). Fly-by: `R = V²/(g·tan φ)`,
`φ = min(bank limit (15° above FL195), max(5°, |Δψ|/2))`, anticipation
`R·tan(|Δψ|/2)` limited to half the shorter leg; > 135° and fly-over legs
have none. Also `turnRadiusNm(gs, bank)`, `holdTurnRadiusNm(gs)`
(standard rate or 25°), `holdSpeedLimitKt(alt)` (200/230/265 kt, AIM 5-3-8),
`defaultHoldMinutes(alt)` (1 min ≤ 14,000 ft, else 1.5).

### 5.6 Synthetic approaches (`synthetic.ts`)

For every runway end without a published approach (heliports, water and
< 1000 ft runways excluded): `R<rw>` RNAV (`approachType 'RNAV'`,
`glidepathDeg 3`, no FAS → flown as LNAV/VNAV) and, where a localizer
exists, `I<rw>` / `L<rw>` / `X<rw>` / `U<rw>` with `navFrequencyMhz`,
`navIdent`, `navCourseTrue`. Legs: IF `CFrr` (5 nm before the FAF, at or
above the FAF altitude) → FAF `FFrr` (threshold + 1500 ft rounded up to
100 ft, placed where a 3° path with 50 ft TCH — or the glideslope — reaches
it, ≈4.5 nm) → MAP `RWrr` (threshold, fly-over, TCH, VPA 3°) → missed:
CA runway heading to threshold+2000 ft (rounded up) → DF `CFrr` → HM
`CFrr` (right turns, 1 min). `synthetic: true`. Functions:
`synthesizeApproaches(airport, existing)`, `syntheticRnavApproach(airport, rw)`,
`syntheticIlsApproach(airport, rw)`, `runwayThreshold(rw)`.

### 5.7 Procedure helpers (`procedures.ts`)

`normalizeRunwayIdent('RW4L') -> '04L'`, `transitionServesRunway('04B', '04R') -> true`,
`legCourseTrue(leg)`, `approachName(letter, ident, rw)`, `findTransition(list, name)`,
`decodeProcedureFile(file, icao)`.

---

## 6. FMS (`src/nav/fms/*`)

### 6.1 `Fms` (Subsystem, name `'fms'`)

```ts
new Fms(ctx: { vars; events?; nav }, opts?: FmsOptions)
interface FmsOptions {
  style?: 'garmin' | 'boeing';       // default 'garmin'
  adcIndex?: number; ahrsIndex?: number;   // sensor indices (default 1)
  engineCount?: number;              // fuel-flow sum eng1..N ff_pph (default 1)
  fuelVar?: string;                  // default 'fuel.total_kg'
  bankLimitDeg?: number;             // LNAV roll limit, default 25
  descentFpaDeg?: number;            // default 3.0
  maxFpaDeg?: number;                // VNAV 'unable' threshold, default 6
  climbGradientFtPerNm?: number;     // default 500 (prediction of altitude-terminated legs)
  speeds?: Partial<SpeedSchedule>;   // VNAV targets (6.4)
  discontinuity?: 'extend' | 'invalid';   // default: garmin 'extend', boeing 'invalid'
  missedApproachOnToga?: boolean;    // input.toga during an approach activates the missed approach (default true)
  geometryIntervalS?: number;        // geometry/VNAV rebuild period, default 1
}
```

| Member | Notes |
|---|---|
| `plans: FlightPlanManager` | edit via `fms.plans.apply(p => ...)` |
| `lnav: LnavGuidance`, `vnav: VnavGuidance`, `perf: PerformancePredictor`, `db` | |
| `loadRoute(route): Promise<RouteParseResult>` | parse + `plans.replace` (Boeing: EXEC needed) |
| `directTo(target: number \| string \| Waypoint, courseMag?)` | from the GPS position; string = plan waypoint first, else nearest database match. Boeing: goes into the MOD. |
| `activateLeg(index)`, `activateApproach()` (direct to the first approach leg), `activateVectorsToFinal()` (activates the leg into the FAF) | |
| `activateMissedApproach()`, `exitHold()` | |
| `setSpeeds(partial)`, `setCruiseAltitude(ft)` | |
| `alongNm`, `approachMode`, `approachActive` | current along-plan position, mode label |
| `update(dt)`, `reset()`, `dispose()` | |

Events handled (`FMS_EVENTS`): `'fms.exec'`, `'fms.erase'`,
`'fms.direct_to'` (payload `{ ident?: string; index?: number; courseMag?: number }`),
`'fms.missed_approach'`, `'fms.exit_hold'`, `'fms.activate_leg'` (`{ index }`),
`'fms.activate_approach'`, `'fms.activate_vtf'`.

Sensors read: `gps.*` (position, GS, track, variation, SBAS, validity),
`adc{n}.alt_ft`, `ahrs{n}.hdg_mag_deg`, `eng{i}.ff_pph`, `fuel.total_kg`,
`env.time_utc_h`/`gps.utc_h`, `input.toga`. Never `fdm.*`.

### 6.2 LNAV behaviour

* A newly loaded plan auto-activates its first flyable leg after the origin.
* Paths: great circles (TF/DF/CF/FA/FC/FD/FM/CA/CD/CI/CR), arcs (RF/AF),
  fly-by turn arcs, holds (entry: direct/teardrop/parallel per AIM 5-3-8
  sectors, then racetrack), procedure turns (1.5 min outbound, 1 min on the
  45° leg, reversal in the coded direction), heading legs (V*: flown on
  heading, 1° bank per ° of error).
* Sequencing: fly-by at `turnAnticipationNm + roll lead` before the fix;
  fly-over when passed; CA/FA/VA at the baro altitude; CD/FD/VD at the DME
  distance; CI/VI when the next leg is captured; CR/VR on crossing the
  radial; HF after one circuit; HA at the fix once the altitude is reached;
  HM on `exitHold()`; FM/VM never (suspended).
* Suspension (`fms.suspended = 1`): at the MAP until the missed approach is
  activated (API, event, or TO/GA), after a leg followed by a `DISCO`, at the
  end of the plan, on FM/VM. LNAV keeps flying the extended leg; with
  `discontinuity: 'invalid'` `fms.lnav_valid` drops to 0 at a discontinuity.
* Roll law: `bank = ff + atan(V·(Δtrack/τ)/g)`, intercept `atan(xtk/L)`
  (≤ 45°), `L = 2Vτ`, `τ = 8 s + GS/60` (ζ ≈ 0.7); limited to
  `bankLimitDeg`; required turn directions forced for large turns; 0.5 s
  smoothing. Tested: < 0.25 nm cross-track through 45°/90° fly-by turns,
  < 0.15 nm on RF arcs (180 kt, 5°/s roll rate).

### 6.3 Approach mode and CDI

`fms.approach_mode` / `fms.cdi_scale_nm` (full-scale, one side):
`DPRT` 1.0 (departure segment within 30 nm of the origin), `TERM` 1.0
(within 31 nm of the destination), `ENR` 2.0, `OCN` 4.0 (no airport within
200 nm), approach active from 2 nm before the FAF: ramps 1.0 → 0.3 nm to
the FAF, then `LPV` (FAS LPV + `gps.sbas`), `LP`, `LNAV/VNAV` (VPA or
synthetic RNAV), or `LNAV`; after the FAF the LPV / LNAV/VNAV scale is
angular (course width at threshold, splay from the GARP, 0.3 nm max);
`MAPR` 1.0 after missed approach activation. `fms.cdi = clamp(−xtk/scale)`
(+ = fly right). Approach glidepath: `fms.gp_valid`, `fms.gp_dev`
(−1..1, + = path above aircraft; full scale 0.25·GPA, 45–150 m),
`fms.gp_angle_deg`; LPV uses GPS (geometric) altitude, others baro.
ILS/LOC approaches do not produce `gp_*` — fly them on `nav{r}` (VLOC).

### 6.4 VNAV

* Descent path (`computeDescentProfile(plan, cruiseAltFt, fpaDeg=3, maxFpaDeg=6, out?)`):
  backward from the last constrained point (MAP/runway threshold + TCH, or
  destination airport + 1500 ft AGL) at the descent angle (coded VPA on the
  final segment); level at "at or below" limits (arrive at each constraint
  at its waypoint), steeper geometric segment for unmet "at or above"
  (`unableLegIndex` beyond `maxFpaDeg`); TOD where it meets cruise.
  `profileAltitudeAt(profile, s)`, `descentDistanceNm(deltaFt, fpa)`.
  Cruise altitude = `plan.cruiseAltFt`, or the highest constraint / current
  altitude when unset. Climb and departure constraints are not part of the
  path (climb targets below).
* Outputs: `fms.vnav_valid` (from 1 min before the TOD to the end of
  descent), `fms.vnav_dev_ft` (+ above path), `fms.tod_dist_nm`,
  `fms.tod_ete_s`, `fms.vnav_tgt_alt_ft` (descent: path altitude at the next
  constrained waypoint; climb: next at-or-below limit or cruise),
  `fms.vs_req_fpm`, `fms.vnav_phase` ('CLB'|'CRZ'|'DES'|'APR'|'').
* Speeds: `SpeedSchedule { climbKt, climbMach?, cruiseKt, cruiseMach?, descentKt, descentMach?, approachKt, machTransitionFt? = 28000 }`
  (defaults 250/250/250/140). `fms.vnav_tgt_speed_kt` = phase speed, max
  250 kt below 10,000 ft (91.117), capped by the next at/at-or-below speed
  constraint, hold limits in holds; `fms.vnav_tgt_mach` = Mach target at or
  above `machTransitionFt` (0 otherwise).

### 6.5 Performance

Every second: per-leg `perf.distNm[k]`, `perf.eteS[k]`, `perf.etaUtcH[k]`,
`perf.fuelKg[k]` (index-aligned with `plan.legs`, valid from the active leg;
`perf.count`, `perf.fuelFlowKgH`). Destination: `fms.ete_dest_s`,
`fms.eta_dest_utc_h`, `fms.fuel_dest_kg`. Straight extrapolation of current
GS and total fuel flow.

### 6.6 All `fms.*` vars written

Existing: `fms.active_leg`, `fms.xtk_nm` (+ right of course),
`fms.dtk_mag_deg`, `fms.dtk_true_deg`, `fms.dist_to_wpt_nm` (straight line
to the active waypoint), `fms.brg_to_wpt_deg` (mag), `fms.ete_wpt_s`,
`fms.next_wpt` (active waypoint ident; pseudo idents `(1000)`, `(INTC)`,
`(VECTORS)`, `(SEA/8)`, `(SEA120)`), `fms.dest`, `fms.dist_to_dest_nm`
(along path to the last non-missed leg), `fms.lnav_valid`,
`fms.vnav_tgt_alt_ft`, `fms.vnav_dev_ft`, `fms.vnav_valid`,
`fms.tod_dist_nm`, `fms.cdi_scale_nm`, `fms.approach_mode`.
Appended (`FMS` const; `fms.from_wpt` is `'P.POS'` for a direct-to from present position): `fms.lnav_bank_cmd_deg` (+ right),
`fms.vnav_tgt_speed_kt`, `fms.vnav_tgt_mach`, `fms.cdi`, `fms.gp_dev`,
`fms.gp_valid`, `fms.gp_angle_deg`, `fms.from_wpt`, `fms.after_wpt`,
`fms.to_from`, `fms.leg_type`, `fms.next_dtk_mag_deg`, `fms.suspended`,
`fms.in_hold`, `fms.hold_entry` ('DIRECT'|'TEARDROP'|'PARALLEL'|''),
`fms.wpt_alert` (≈10 s before a turn), `fms.ete_dest_s`,
`fms.eta_dest_utc_h`, `fms.fuel_dest_kg`, `fms.vs_req_fpm`,
`fms.tod_ete_s`, `fms.vnav_phase`, `fms.crz_alt_ft`, `fms.plan_version`
(re-read the plan when it changes), `fms.mod_pending`,
`fms.approach_active`, `fms.missed_active`.

---

## 7. Recipes

**G1000 / G3000 (Garmin)**: `new Fms(ctx, { style: 'garmin' })`. FPL page
lists `fms.plans.active.legs` (skip `DISCO` or show "VECTORS"/gap), active
leg `fms.active_leg` (magenta), `geom.predictedAltFt` for VNAV altitudes.
Direct-to key → `ctx.events.emit('fms.direct_to', { ident })`. Loading an
ILS: `plan.setApproach(proc, trans)` then tune
`nav1.active_mhz = proc.navFrequencyMhz` (auto-tune) and set the course from
`proc.navCourseTrue` − variation. CDI source GPS: HSI uses `fms.cdi`,
`fms.dtk_mag_deg`, `fms.to_from`, scale label `fms.approach_mode`; VLOC:
`nav{r}.cdi`, `nav{r}.to_from`, `nav{r}.gs_dev`. Glidepath diamond:
`fms.gp_valid/gp_dev`; VNAV VDI: `fms.vnav_valid/vnav_dev_ft`.

**737 FMC (Boeing)**: `new Fms(ctx, { style: 'boeing', engineCount: 2, speeds })`.
LEGS page edits through `fms.plans.edit()` + `fms.plans.commit()`; show
`plans.displayed`; EXEC light = `fms.mod_pending`; EXEC key →
`events.emit('fms.exec')`, ERASE → `'fms.erase'`. RTE page:
`fms.loadRoute(text)` then EXEC. LNAV engage requires `fms.lnav_valid`.

**Autopilot**: LNAV/GPSS roll = `fms.lnav_bank_cmd_deg` (already limited to
`bankLimitDeg`; apply your roll-rate limit). VNAV PATH: pitch toward
`fms.vnav_dev_ft` = 0 with `fms.vs_req_fpm` as feed-forward; capture
altitude `min(ap.sel_alt_ft, fms.vnav_tgt_alt_ft)`. LOC/GS: `nav{r}.cdi`,
`nav{r}.gs_dev` (+ fly up), `nav{r}.dev_deg`/`gs_dev_deg` for gain
scheduling. Go-around: `input.toga` also activates the missed approach.

---

## 8. Conventions and gotchas

* Courses in `ProcedureLeg.course` are magnetic; convert with
  `legCourseTrue(leg)`. Geometry is all true.
* `nav{r}.cdi` / `fms.cdi`: + = fly right. `fms.xtk_nm`: + = right of
  course. `nav{r}.gs_dev` / `fms.gp_dev`: + = fly up. `fms.vnav_dev_ft`:
  + = above path.
* A route discontinuity is a plan leg with `type === 'DISCO'`; UI code must
  skip or render it.
* Plan legs are mutable shared objects; mutate through `FlightPlan`
  methods (they normalise and bump `version`), not directly.
* `NavDatabase.loadProcedures` is optional on the interface; call it as
  `db.loadProcedures?.(icao)`.
* Tests load the full database from `public/data` via `createFileLoader`.
