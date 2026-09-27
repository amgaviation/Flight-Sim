# Cessna Citation M2 (Model 525) — research dossier

Contract for the cockpit, exterior and verification agents. Every number is cited;
**EST** marks an estimate with its reasoning. Code: `src/aircraft/citation-m2/`
(`data.ts` numbers, `fdm.ts`, `vars.ts` control vars, `systems/*`, `createSystems.ts`,
`states.ts`, `checklists.ts`, `inputMap.ts`, `meta.ts`); tests:
`tests/aircraft/citation-m2/`.

## 0. Sources

| Tag | Document |
|---|---|
| TCDS | EASA TCDS IM.A.078 Issue 19 (07 May 2026), Cessna/Textron 525 — the EASA mirror of FAA TCDS A1WI; model 525 serials 525-0800 and on = M2 (525-0685, 525-1400+ = M2 Gen2) |
| ETCDS | EASA TCDS IM.E.016 Issue 13, Williams International FJ44 family (FJ44-1AP) |
| S&D15 | Textron "Specification and Description, Citation M2", Oct 2015 Rev A (units 525-0900 to TBD) |
| S&D21 | Textron "Specification and Description, Citation M2", Sep 2021 Rev F (units 525-1048 to TBD) |
| FPG | Textron "Citation M2 Flight Planning Guide" (525-0800 and on; AFM rev FMC-01 / 525OMC-00) |
| FR | flyradius.com "Cessna Citation M2 — Specifications" and "Engine FJ44-1AP-21" |
| CJ1+ S&D | Cessna "Specification & Description Citation CJ1+", Sep 2006 Rev C (predecessor with the same airframe/systems; used for panel/switch naming where the M2 documents are silent) |
| G3000 PG | Garmin G3000 Pilot's Guide 190-02046 (family docs in docs/modules/avionics-garmin-g3000.md) |

The AFM (525FMC-00 / 525FMD-00) and the FlightSafety PTM are not public. Where the
public sources do not give a switch name, position, CAS text or threshold, the
dossier uses the CJ-family convention and marks it **EST (CJ family)**.

## 1. General

- Low-wing, T-tail, twin aft-mounted turbofans, retractable tricycle gear, pressurized;
  crew 1–2 (single-pilot certified, CE-525S type rating), max 6–7 passengers (TCDS: 6 pax
  seating), 14 CFR Part 23 with Part 25 takeoff/landing performance methods (FPG p.2).
- Certification: day/night VFR/IFR, flight into known icing, RVSM (S&D15 §1.1).
- ICAO type designator C25M (Doc 8643).

## 2. Dimensions (S&D15 §1.2, S&D21, FPG p.2)

| Item | Value |
|---|---|
| Length | 42 ft 7 in (12.98 m) |
| Height | 13 ft 11 in (4.24 m) |
| Span (incl. tip lights) / without | 47 ft 3 in (14.39 m) / 47 ft 0 in (14.33 m) |
| Wing area | 240 ft² (22.30 m²); sweep 0° at 35 % chord; dihedral 5° (S&D15 §5) |
| MAC | 69.077 in (1.755 m), LE at FS 228.745 (TCDS §14) |
| Horizontal tail | span 18 ft 8 in (5.70 m), 60.7 ft² (5.64 m²), 0° sweep at 70 % chord |
| Vertical tail | height 6 ft 5 in (1.96 m), 46.8 ft² (4.35 m²), 49° sweep at 25 % chord |
| Tread / wheelbase | 13 ft 0 in (3.96 m) / 15 ft 4 in (4.67 m) |
| Cabin (fwd to aft pressure bulkhead) | 15 ft 9 in (4.80 m) long; 58 in (1.47 m) wide; 57 in (1.45 m) high (dropped aisle) |
| Cabin excl. cockpit | 11 ft 0 in (3.35 m); passenger volume 198 ft³ (FPG) |
| Datum | 94.0 in forward of the front face of the forward pressure bulkhead (TCDS §15) |
| Tires | nose 18×4.4 (6 ply), mains 22×7.75R10 (10 ply), 190 mph (S&D21 §7.3) |
| Baggage | nose 400 lb at FS 74.0 (12.9–15.6 ft³); tailcone 325 lb at FS 356.5 (30 ft³), 20×26 in door LH under the pylon (TCDS §20, S&D15/21) |

Simulator body frame (fdm.ts): datum = empty CG at **FS 250.0 (EST)**, x = (250 − FS)·0.0254 m.

## 3. Weights, CG, fuel

| Item | Value | Source |
|---|---|---|
| Max ramp | 10,800 lb (4,899 kg) | TCDS §13 |
| MTOW | 10,700 lb (4,853 kg) | TCDS |
| MLW | 9,900 lb (4,491 kg) | TCDS |
| MZFW | 8,400 lb (525-0800..1399), 8,500 lb (525-0685, 1400+) | TCDS |
| Standard empty (S&D15) / typically equipped (FPG) | 6,746 / 6,790 lb | S&D15, FPG p.3 |
| BOW (1 pilot + stores 200 lb) | 6,990 lb | FPG p.3 |
| Max payload / payload with full fuel | 1,410 / 514 lb | FPG p.3 |
| Usable fuel | 3,296 lb (492 US gal at 6.7 lb/gal), 2 wing tanks × 1,648 lb at FS 253.0 | TCDS §9.1 |
| Unusable fuel | 30.64 lb | TCDS Note 2 |
| Oil | 3.4 qt usable per engine at FS 314.74 | TCDS §9.2 |
| CG range | fwd FS 240.14 (16.5 % MAC) ≤ 7,700 lb, FS 242.43 (19.81 %) at 8,800 lb, FS 244.34 (22.58 %) at 10,700 lb, FS 244.44 (22.72 %) at 10,800 lb; aft FS 248.43 (28.5 %) | TCDS §14 |
| Load limits | flaps up −1.44 / +3.6 g; flaps 15/35: 0 / +2.0 g (S&D21 §3); −1.52 / +3.8 g quoted by S&D15 §3 | S&D |

## 4. Engines — Williams FJ44-1AP-21 (TCDS, ETCDS, FR, S&D)

| Item | Value |
|---|---|
| Takeoff thrust | 1,965 lbf (8.74 kN) SL static, flat rated to 72 °F (22.2 °C), 5 min |
| Max continuous | 1,950 lbf at 59 °F (ETCDS) |
| Bypass ratio | 2.58:1, twin spool, 3 compression / 3 turbine stages (S&D15 §8) |
| N1 limit | 104.7 % (100 % = 17,245 rpm) — FR: 104.69 % = 18,055 rpm |
| N2 limit | 100.0 % (41,200 rpm) |
| ITT | 855 °C takeoff (5 min, 10 min OEI); 835 °C max continuous; 1,000 °C starting transient (15 s) |
| Oil | 23 psig min (5 min), 120 psig max (130 for 5 min), 135 °C max |
| Dry weight / length | 468 lb / 57.9 in |
| FADEC | dual channel, powered by two engine PMAs per engine (main DC backup), time-limited dispatch (S&D15 §8) |
| Throttle detents | IDLE, CRU, CLB, TO; TO/GA button on the throttle (S&D21 §8) |
| Reversers | none (TCDS §16: thrust attenuators N/A on 525-0600+) |
| Fire detection | continuous loop per nacelle; extinguishing (Halon) system (S&D15 §8) |

**Simulator engine values (fdm.ts, all EST where not listed above):** rated N1 at SL ISA 101.5 %;
ground idle N1 25 % / N2 52 %, idle FF 125 lb/h/engine, idle ITT ~485 °C; start: starter
motoring 26 % N2, FADEC light-off 9 % N2, starter cut-out 45 % N2, light-off→idle ~27 s,
start peak ITT ~640 °C. Ratings (systems/engines.ts): corrected N1 fractions TO 1.0→1.035
(SL→FL200), CLB 0.995→1.035 (SL→FL250), CRU 0.985, flat rated to ISA+7.2 °C, capped at 104.69 %.

## 5. Limitations and speeds

| Speed | KIAS (KCAS) | Source |
|---|---|---|
| Vmo SL–30,500 ft | 263 (260) | TCDS §10 |
| Mmo ≥ 30,500 ft | 0.71 indicated (0.70 calibrated) | TCDS |
| Va (10,700 lb) | 202 (201) | TCDS |
| Vb | 217 (215) | TCDS |
| Vfe flaps 15 / 35 | 200 (198) / 161 (160); flaps 60 (ground) prohibited in flight | TCDS |
| Vlo extend / retract | 186 (185) / 175 (172) | TCDS |
| Vle | 186 (183) | TCDS |
| Vsb | no limit | TCDS, S&D21 |
| Vmca flaps 0 / 15 | 86 / 77 | TCDS |
| Vmcg | 89 (92) | TCDS |
| Max autopilot speed | 263 KIAS / 0.71 MI | TCDS |
| Max tire ground speed | 165 kt | TCDS |
| Max operating altitude | 41,000 ft | TCDS §11 |
| Single-engine service ceiling (MTOW) | 26,800 ft | FPG p.2 |
| Cabin | 8.5 psid nominal; SL cabin to 22,027 ft; 8,000 ft cabin at FL410 | S&D15 §9.5 |

Crosswind, temperature and runway-slope limits are AFM-only (not public). FPG takeoff/landing
tables are published to 50 °C OAT and 14,000 ft elevation (FPG pp.5-31) — use as the envelope (EST).

### 5.1 V-speeds and performance (FPG)

Takeoff speeds, SL ISA dry (FPG p.4):

| Weight lb | Flaps 15 V1/VR/V2 | Flaps 0 V1/VR/V2 |
|---|---|---|
| 10,700 | 100 / 105 / 111 | 105 / 111 / 119 |
| 10,300 | 98 / 103 / 109 | 104 / 108 / 117 |
| 9,900 | 96 / 100 / 107 | 102 / 105 / 115 |
| 9,500 | 96 / 99 / 106 | 99 / 102 / 113 |
| 9,000 | 96 / 98 / 106 | 97 / 99 / 110 |
| 8,000 | 97 / 98 / 108 | 97 / 99 / 111 |
| 7,500 | 97 / 98 / 108 | 97 / 99 / 112 |

- Takeoff field length (BFL, Part 25 method) flaps 15 SL ISA MTOW **3,210 ft** (S&D21, FPG);
  full SL table vs temperature 0–50 °C and weight in `systems/told.ts`.
- Landing distance (actual, from 50 ft) flaps 35 SL ISA MLW **2,590 ft**; VREF 109 (9,900) …
  95 (7,500) KIAS (FPG pp.26-31).
- Stall speeds KCAS, 0° bank, gear up or down (FPG p.32): 10,700 lb 98 / 92 / 86 (flaps 0/15/35);
  9,900 lb 95 / 88 / 83; 8,500 lb 88 / 82 / 77; 7,500 lb 83 / 78 / 73.
- Climb: 2-engine ROC 3,698 fpm, 1-engine 1,075 fpm (FPG p.3); time/fuel/distance to climb at
  MTOW: FL150 5 min/138 lb/19 nm, FL250 9/242/41, FL350 16/352/76, FL410 24/437/113 (FPG p.21).
- High-speed cruise (max cruise thrust, ISA), 9,500 lb: FL250 377 KTAS/1,122 lb/h; FL310 403/1,071;
  FL330 403/997; FL350 401/920; FL370 396/830; FL410 385/678 (FPG p.22). Long-range cruise table p.23.
  Max cruise 404 KTAS at FL330 mid-cruise weight (S&D21); NBAA IFR range 1,360 nm; ferry 1,550 nm.
- Descent: high speed 3,000 fpm / normal 2,000 fpm; FL410→SL 14 min/89 lb (high speed) (FPG p.24).
- Holding (FPG p.25): 10,000 lb 160 KIAS 620 lb/h (SL) … 517 lb/h (FL300).

## 6. Airframe systems

### 6.1 Electrical (S&D15 §9.4, S&D21 §9.3; model `systems/electrical.ts`)
- 28.5 V DC parallel-bus system, 600 A from two engine-driven **300 A starter-generators**,
  each with a digital GCU in the tailcone (paralleled, proportional load sharing).
- **44 Ah NiCd main battery** (aft baggage area, quick disconnect) for starts and limited backup;
  **24 V sealed lead-acid auxiliary battery** (14 Ah S&D21 / 16 Ah S&D15) in the nose that keeps
  the avionics up during starts and adds emergency capacity.
- Single generator in flight → vapor-cycle A/C and interior equipment are shed automatically.
- Loss of all generation → main + aux batteries feed the **emergency bus** for a limited time.
- Controls on the LH **power switch panel**; volts and generator amps on the MFD EIS.
- LH and RH circuit-breaker panels on the cockpit sidewalls; junction box in the aft baggage area;
  external power receptacle below the LH engine pylon; 500 W inverter (110 V AC: 1 copilot + 2 cabin outlets).
- AVIONICS switch **DISPATCH** position: limited avionics (radio calls, FMS planning) without the
  whole suite (S&D15 §10.3.T).
- Simulator topology (EST, CJ-family): HOT BATT → (BATT relay) → BATT BUS ⇄ (225-325 A limiters) ⇄
  L MAIN (gen 1) / R MAIN (gen 2); BATT BUS → (diode) → EMER BUS; HOT BATT → (EMER relay, BATTERY
  switch EMER) → EMER BUS; L/R MAIN and BATT BUS → (diodes) → L/R XFEED; EMER → (AVIONICS relay) →
  AVN 1; R XFEED → (AVIONICS relay, ON only) → AVN 2; AUX BATT → (diode while a starter runs) → AVN 1.
- Load placement: AVN 1 = PFD1, GTC1, GIA1, GDC1, GRS1, GMC 710, AP servos, GMA 1; AVN 2 = MFD, PFD2,
  GTC2, GIA2, GDC2, GRS2, GMA 2, radar, DME, RA, TCAS, XPDRs; EMER = ESI charge, GEA engine interface,
  fire detection, gear and flap control, igniters, FADEC backup, standby panel lights; L MAIN = L pitot,
  L boost pump, pitch trim, L landing light, nav, beacon, wing inspection, W/S alcohol, L bleed control,
  stall warning; R MAIN = R pitot, AOA heat, R boost, R landing, taxi, strobes, logo, R bleed control,
  pressurization controller, tail de-ice, anti-skid; L XFEED = panel / flood lights, avionics fans, temp
  control; R XFEED = brake hydraulic pump, cabin fan, cabin lights, pax signs, inverter, vapor-cycle A/C.
  Every load has a `cb.<load>` breaker (sidewall CB panels).
- Battery start (test): bus dips to ~15.6 V, starter current ~750 A peak, AVN 1 held at 25.5 V by the aux battery.

### 6.2 Fuel (S&D15 §9.2, S&D21 §9.2; `systems/fuel.ts`)
- Two integral wing tanks; each engine fed from its own tank automatically.
- Motive-flow **ejector pump** in each sump (driven by HP fuel returned from the FDU) + motive-flow
  scavenge pump; engine-driven pump and FADEC-controlled fuel delivery unit (FDU).
- **Electric boost pump** in each tank: engine start, fuel transfer, low fuel pressure (NORM = auto;
  ON = manual).
- Tank-to-tank transfer (FUEL TRANSFER selector, EST CJ family: L TANK / OFF / R TANK = transfer from the
  selected tank using its boost pump, sim 1,200 lb/h).
- Vented surge tank near each tip; 6 capacitance probes per wing, dual-channel conditioner; overwing
  gravity filling; fuel heated by oil/fuel heat exchanger (no additive needed).
- Firewall shutoff valves closed by the ENG FIRE push buttons (EST CJ family).
- Low-fuel caution 190 lb per tank, imbalance caution 200 lb (EST).

### 6.3 Hydraulics (S&D15 §9.3, S&D21 §9.8; `systems/airframe.ts`)
- Open-center main system, 1,500 psi on demand, two engine-driven pumps (either one sufficient) for
  landing gear, speed brakes and flaps.
- Independent **electric-motor hydraulic system** for the wheel brakes and anti-skid, charges the
  emergency accumulator. Pneumatic emergency brake back-up.
- Sim: EDPs 7 L/min each (EST), open-center selector valve demand logic (`ac.m2.hyd_demand`); brake
  system 1,500 psi with 650 psi accumulator precharge (EST).

### 6.4 Pneumatics, air conditioning, pressurization (S&D15 §9.5, S&D21 §9.5)
- Engine bleed pressurizes and heats the cabin and defogs the windows; vapor-cycle A/C for cooling
  (in flight, or on the ground with GPU or the right engine running; sheds with one generator off).
- Digital auto-schedule pressurization controller, 8.5 psid; landing field elevation entered on the
  GTC; cabin altitude/rate/diff on the MFD.
- Cockpit thermostat (auto) and five-position flow divider (S&D15) — sim: TEMP AUTO/MANUAL, temp
  selector, cabin fan, air distribution (defog) knob.
- PRESS SOURCE selector OFF / L / R / NORM / EMER, CABIN DUMP, manual pressure control (EST CJ family;
  CJ1+ S&D lists "Air Source Selection", "Emergency Cabin Pressure Dump" and "Manual Pressure Control").
- Sim schedule: cabin 0 ft at SL → 8,000 ft at FL410 (linear), 500 fpm climb / 300 fpm descent limits,
  relief 8.8 psi, cabin volume 7.5 m³ (EST), CABIN ALTITUDE warning 10,000 ft, pax masks 13,500 ft (EST).

### 6.5 Ice and rain protection (S&D15 §9.7, S&D21 §9.7)
- Bleed air: engine inlets, pylon inlet ducts, wing leading edges, windshields; pilot windshield
  alcohol back-up.
- Horizontal stabilizer pneumatic boots on 23 psi service air, timer-controlled (AUTO cycle).
- Electric heat: pitot tubes, static ports, AOA vane.
- Two windshield ice-detection lights on the glareshield; wing inspection light (LH fuselage).
- Rain: windshield bleed air normally, mechanically actuated rain doors in heavy rain.

### 6.6 Fire protection
- Continuous-loop nacelle detection, Halon extinguishing (S&D15 §8, warning page).
- Glareshield: LH and RH **ENG FIRE** lighted switches (S&D15 §10.2.A). EST (CJ family): pushing
  ENG FIRE closes the fuel firewall shutoff, hydraulic shutoff and bleed valve and trips the
  generator, and arms the two **BOTTLE ARMED** lighted buttons; pushing a lit BOTTLE button discharges
  that bottle into the armed engine (two bottles, either engine). Bottle 600 psi (EST).
- Cockpit hand fire extinguisher (S&D15 §14).

### 6.7 Oxygen (S&D15 §9.6)
- 50 ft³ (1.42 m³ = 1,416 L) bottle in the nose, HP gauge, bottle regulator; quick-donning
  pressure-demand crew masks with mics (stowed above each crew shoulder, S&D21 §10.1);
  automatic drop-out constant-flow pax masks via a sequencing regulator; O₂ pressure on the MFD.
- Sim: 1,850 psi full (EST), PASS OXY selector CREW ONLY / NORM / MANUAL DROP (EST CJ family).

### 6.8 Landing gear, brakes, steering (S&D15 §7, S&D21 §7)
- Electrically controlled, hydraulically actuated, < 6 s cycle; trailing-link mains retract inboard;
  nose retracts forward with doors; chined nose tire.
- Emergency: manual uplock release (free fall) + pneumatic blow-down.
- Warning horn: gear not down, < 130 KIAS and either throttle below ~85 % N2; horn with flaps beyond
  the approach setting not silenceable (EST CJ family).
- Nose wheel steered mechanically by the pedals ±20°; castering ±95° for towing.
- Multi-disc anti-skid brakes (anti-skid above 12 kt) on the electric hydraulic system; pneumatic
  emergency brake; parking brake handle; emergency brake handle (below the panel).

### 6.9 Flight controls (S&D15 §9.1, S&D21 §9.1, TCDS §16)
- Mechanical (push rods, bellcranks, sectors, stainless cables): ailerons, elevators, rudder.
  Surface travel: elevator up 18.5° / down 15°; rudder ±30°; ailerons up 23.5° / down 20.5°.
- Trim: mechanical tabs on the LH aileron (up 20° / down 18°), elevators (up 12° / down 20°), rudder
  (±20°), driven from pedestal trim wheels/knobs; elevator trim also electric (yoke switches; the AFCS
  pitch-trim servo) and autopilot trim.
- Yaw damper (AFCS yaw servo; engages with the AP; not required for dispatch).
- Flaps: handle detents 0 / 15 / 35 / 60 (ground flaps = lift dump, deploy the speed brakes
  automatically); any position 0–35 selectable in flight.
- Speed brakes: upper (0–49°) and lower (0–68°) panels on each wing, any speed, auto-retract with either
  throttle at high thrust; electrically controlled, hydraulically actuated; designed for minimal pitch change.
- Integral control lock below the pilot's panel (rudder, elevators, ailerons, throttles).

### 6.10 Avionics (S&D15 §10, S&D21 §10.3)
- Garmin **G3000**: three GDU 1400W 14.1 in WXGA (1280×800) displays (PFD1, MFD, PFD2); two GTC 570
  5.7 in touch controllers on the pedestal; GMC 710 AFCS controller below the glareshield centre.
- Dual GIA 63W (COM 16 W 8.33 kHz, VOR/LOC/GS, WAAS GPS, FD computers) in the nose; dual GDC air data
  (dual heated pitot/static, cross-plumbed); dual GRS 77 AHRS with tail magnetometers (in-flight
  alignment); GEA 71 engine interface; dual GMA 36 audio (marker receivers); dual GTX 3000 transponders
  with ADS-B Out (ADS-B In on S&D21); Collins DME-4000 (3 channels); Collins ALT-4000 radio altimeter
  (2,500 ft); Garmin GTS 855 **TCAS I**; GWX 70 radar (40 W, 12 in antenna); **Class B TAWS**;
  ChartView; Artex C406-N ELT (RH tilt-panel remote switch); L-3 **ESI-1000** standby (3.7 in, own battery).
- PFD: full-screen horizon, speed/alt tapes with 6 s trend, VS, V-speed bugs (TOLD or manual), HSI,
  inset map, FD (cross pointer or single cue), RAT/ISA, timers.
- MFD: moving map + EIS strip on the left (N1, ITT, N2, oil, fuel flow/qty/temp, oxygen, electrical,
  pressurization).
- CAS: on **both PFDs** (lower part), red warnings / amber cautions flash until acknowledged with the
  MASTER WARNING / CAUTION switches, warnings first; up to 10 lines, scrolled by softkeys (S&D15 §10.3.E,
  S&D21 §10.3.9). Sim: `casLocation: 'pfd'`.
- Reversion switches on the glareshield (S&D15 §10.2.A / 10.3.E).

### 6.11 AFCS (GFC 700 on G3000; S&D15 §10.3.L)
- Dual FD, single GMC 710 mode controller, electric servos: roll, yaw, pitch and pitch trim; AP engage
  turns on the FD and the YD. TO/GA button on the LH throttle; CWS and AP/TRIM DISC on each yoke.
- Modes: lateral ROL, HDG, FMS (LNAV), VOR, LOC, BC, TO, GA, LVL; vertical PIT, ALT, ALTS, VS, FLC,
  VPTH/ALTV (VNAV), GS, GP, TO, GA; bank 25° / low bank 15° (EST, systems preset `AFCS_GFC700_G3000`).
- No autothrottle on 525-0800..1399 (autothrottle added for 525-0685 / 1400+ M2 Gen2, TCDS §A.II).
- G3000 APR rule: with a LOC approach loaded the AFCS source switches to the localizer (tested).
- AFM limitations quoted by a public M2 study guide ("Citation M2 Study Notes", captmoonbeam.com, via search
  excerpt; secondary source): autopilot minimum use height 450 ft above the runway after takeoff, 1,000 ft AGL
  en route / descent, 160 ft above the runway on a GS/GP approach; **autopilot and yaw damper disengaged for
  takeoff and landing**. The check ride (§15) engages the AP above 450 ft and disconnects AP and YD at the
  200 ft DA. SCOPE: the sim does not inhibit AP engagement below these heights (crew responsibility, as in
  the aircraft).

## 7. Sim V-speed / TOLD
`systems/told.ts` implements the G3000 PERF (TOLD) provider from the FPG tables (V1/VR/V2, BFL,
VREF, landing distance; elevation factors EST).

## 8. CAS messages (`systems/cas.ts`)

Texts/thresholds: **EST (CJ family / Garmin conventions)** unless the S&D states the function.

| Level | Message | Condition (sim) |
|---|---|---|
| W | ENG FIRE L / R | nacelle loop fire (`fire.engN_warn`); aural "ENGINE FIRE" |
| W | OIL PRESS LOW L / R | N2 > 45 % and oil < 23 psi (TCDS min), 2 s |
| W | CABIN ALTITUDE | cabin ≥ 10,000 ft; aural |
| W | CABIN DIFF PRESS | diff above relief |
| W | BATT O'TEMP | NiCd over-temperature |
| W | DOOR UNLOCKED | cabin door / emergency exit open in flight |
| W | AOA FAIL | AOA vane / stall warning failed |
| W | GEAR UNSAFE | gear disagree / not down with a horn condition |
| W | AP TRIM FAIL | pitch trim runaway / jam |
| C | GEN OFF L / R | engine running, generator off line |
| C | BATT DISCHARGE | battery discharging > 15 A (not starting), 10 s |
| C | EMER BUS ON BATT | BATTERY switch EMER |
| C | MAIN BUS VOLTS LOW | bus < 24.5 V (not starting) |
| C | FUEL LEVEL LOW L / R | tank < 190 lb |
| C | FUEL PRESS LOW L / R | engine running, feed pressure low |
| C | FUEL IMBALANCE | > 200 lb |
| C | FADEC FAULT L / R | FADEC failure |
| C | START ABORT L / R | FADEC auto-abort (hot / hung / no light) |
| C | HYD FLOW LOW L / R | pressure demanded, EDP flow low / failed |
| C | HYD PRESS ON | main system pressurized > 25 s with no actuator demand |
| C | HYD PRESS LOW | pressure demanded, < 1,000 psi |
| C | BRAKE PRESS LOW | brake system and accumulator < 900 psi |
| C | ANTISKID FAIL / ANTISKID OFF | anti-skid inop with switch ON / switch OFF |
| C | EMER BRAKE ON | emergency brake pulled in flight |
| C | PARK BRAKE ON | parking brake set with throttles advanced |
| C | FLAPS FAIL | flap disagree / asymmetry |
| C | GROUND FLAPS | flap handle 60 in flight |
| C | SPEED BRAKE | speed brakes out with flaps > 17° or below 500 ft RA |
| C | P/S HTR OFF L / R, AOA HTR FAIL | heaters unpowered in flight |
| C | ENG A/I COLD L / R, WING A/I COLD | anti-ice selected, insufficient bleed flow (30 / 60 s) |
| C | TAIL DEICE FAIL | boots selected, no service air / power |
| C | W/S AIR FAIL | W/S bleed selected, no flow |
| C | EMER PRESS ON / PRESS SOURCE OFF / PRESS CTRL FAIL | PRESS SOURCE EMER / OFF in flight / controller fault |
| C | OXYGEN LOW | bottle < 400 psi |
| C | DOOR UNLOCKED (ground), BAGGAGE DOOR | doors open |
| C | AFCS FAIL, YD FAIL, PITCH TRIM | AFCS / servo failure, YD failure, AP mistrim |
| C | TAWS FAIL, CONTROL LOCK | TAWS inop; control lock engaged with an engine running |
| A | START L / R, IGNITION L / R, BOOST PUMP ON L / R | start sequence, igniters, boost pump running |
| A | FUEL TRANSFER, GPU ON, AVIONICS DISPATCH, PASS OXY ON, W/S ALCOHOL ON | as named |
| A | SPD BRK EXTEND, TAIL DEICE, RAIN DOOR OPEN, PARKING BRAKE | as named |

Flight-phase inhibits: takeoff 80 kt → 400 ft RA, landing < 200 ft RA (systems CasManager default).
Aurals: master warning tone, caution chime, overspeed clacker (Vmo/Mmo), stick shaker, gear horn,
AP disconnect (≈2 s Garmin tone), TAWS-B / TCAS I voices, altitude alerter (1,000 / 200 ft).

## 9. Cockpit control inventory

Positions: panel-local millimetres, x right from the panel's left edge, y down from its top edge
(**EST**, from the S&D figures and cockpit photographs; the cockpit agent should refine against
photos). Vars: `src/aircraft/citation-m2/vars.ts` (`M2.*`), plus standard vars where noted.
"Lit" = LED backlighting on the panel dimmer (`ac.light.panel`); korry-type lights listed.

### 9.0 Panel geometry (EST)
- Cockpit width at the panel ~1.40 m; instrument panel face ~0.60 m ahead of the design eye, tilted
  ~12° back from vertical; glareshield top ~0.06 m below eye level, depth ~0.30 m.
- Design eye (pilot): FS 130 → body x ≈ +3.05 m, y −0.33 m, z −0.30 m (≈0.85 m above the cockpit
  floor); copilot mirrored. Seats adjustable; crew seat reference FS 135 (fdm payload station).
- Main panel row (left→right): **Electrical power panel** (LH edge, ~140×220 mm) — **PFD1** (GDU 1400W
  354×237 mm bezel, centre y −0.38 m) — **MFD** (centre) — **PFD2** (y +0.38 m); displays ~20 mm apart;
  display centres ~0.12 m below the glareshield lip.
- Glareshield (full width): LH/RH MASTER WARNING/CAUTION + ENG FIRE clusters outboard of the GMC,
  **GMC 710** (330×70 mm) centred, **ESI-1000** (3.7 in, ~90×90 mm) left of the GMC above PFD1's inboard
  edge (flyradius: "pilot's upper left side"), display control units (DCU: BARO, MINS, map RANGE knobs)
  above each PFD, reversion and dimming controls centre, ice-detection lights at the windshield base.
- **Tilt panels** (S&D21 items 7/8): angled ~35° back below the display row; LH tilt panel below PFD1
  (~420×120 mm), RH tilt panel below PFD2 (~420×120 mm); landing-gear control module between them at the
  lower centre left of the pedestal top (~110×150 mm).
- **Pedestal**: centre, ~260 mm wide, from the panel bottom aft ~0.75 m, top ~0.45 m below the eye:
  two GTC 570 (150×215 mm) side by side at the forward end, then engine start/ignition panel, throttle
  quadrant (two levers), flap handle (RH side), speed brake handle (LH side), elevator trim wheel
  (vertical, LH side, ~200 mm dia. partially exposed) with indicator, rudder trim knob (aft centre),
  aileron trim knob.
- Below the panel: parking brake handle (LH), emergency brake handle, emergency gear release T-handle
  and blow-down knob, control lock (pilot side), rain removal levers (L/R sidewall).
- Sidewalls: LH and RH circuit breaker panels (~350×180 mm) forward of each seat; crew O₂ mask
  containers above each shoulder; reading/map lights overhead; floodlights; magnetic compass on the
  windshield centre post; cupholders, 110 V outlet (RH sidewall).
- Windshield: two-piece bird-resistant acrylic, bleed-air heated/defogged; centre post; lower edge
  ~FS 100 (x ≈ 3.8 m), upper edge ~FS 125, rake ~30° from horizontal (EST); side windows L/R.

### 9.1 LH instrument panel — ELECTRICAL POWER panel (S&D15 §9.4 "LH power switch panel")
| Control | Type | Positions / values | Var | Notes / position |
|---|---|---|---|---|
| BATTERY | 3-pos toggle (lever-lock out of BATT) | EMER −1 / OFF 0 / BATT 1 | `ac.m2.batt_sw` | top-left (20, 30) |
| L GEN, R GEN | 3-pos toggle | RESET −1 (spring to OFF) / OFF 0 / GEN 1 | `ac.m2.gen1_sw`, `gen2_sw` | (60, 30), (100, 30) |
| AVIONICS | 3-pos toggle | DISPATCH −1 / OFF 0 / ON 1 | `ac.m2.avionics_sw` | (20, 90) |
| CB panels (sidewalls) | pull breakers | in 1 / out 0 | `cb.<load>` for every load in §6.1 | LH/RH sidewall |
EIS shows VOLTS L/R, GEN AMPS, BATT A/V (no separate meters).

### 9.2 Glareshield
| Control | Type | Var / event | Position |
|---|---|---|---|
| MASTER WARNING (L, R) | red lighted push button | emits `cas.ack_warning`; light `alert.master_warning` | outboard of each ENG FIRE |
| MASTER CAUTION (L, R) | amber lighted push button | emits `cas.ack_caution`; light `alert.master_caution` | next to MASTER WARNING |
| ENG FIRE L / R | red lighted alternate-action push button (guard EST) | `ac.m2.eng_fire1/2` (1 = pushed); light `ac.m2.eng_fire1_lt/_2` | inboard of the master lights |
| BOTTLE 1 ARMED / BOTTLE 2 ARMED | white/amber lighted push buttons (momentary) | `ac.m2.bottle1/2`; light `ac.m2.bottle1_lt/_2` | beside the ENG FIRE buttons |
| GMC 710 | keys HDG, NAV, APR, BC, AP, YD, FD, XFR, BANK, VS, FLC, ALT, VNAV, SPD; knobs HDG (push sync), CRS1/CRS2 (push centre), ALT (dual, push sync), SPD (push); NOSE UP/DN wheel | events per `g3000Controls()` (`g3k.gmc.*`), lights `g3k.gmc.lt_*` | centre |
| DCU (L/R) | BARO knob (push STD), MINS knob (push mode), RANGE knob | `g3k.baro<s>.*`, `g3k.mins<s>.*`, `g3k.range<s>.turn` | above each PFD |
| DISPLAY REVERSION (PFD1 / MFD / PFD2) | push buttons / switches | `g3k.rev_sw.pfd1/mfd/pfd2` | centre, below the GMC |
| DIM (display dimming) | knob 0 = AUTO (photocell) … 1 | `ac.m2.display_dim` → `display.<id>.brt` | centre |
| ESI-1000 | 4 softkeys + knob (baro, brightness, menu) | self-contained (ADC/AHRS index 3, `ac.m2.esi_powered`) | left of GMC |
| Ice detection lights | (lit by WING INSP switch) | `light.wing` | windshield base |

### 9.3 Displays (GDU 1400W ×3)
12 bezel softkeys each (`g3k.<gdu>.sk1..12`), SD card slots (no function). Map onto meshes from
`sys.suite.displayList()` (ids `pfd1`, `mfd`, `pfd2`, `gtc1`, `gtc2`).

### 9.4 LH tilt panel (EST layout; items per S&D15 §10.2.C)
| Group | Control | Type | Positions / values | Var |
|---|---|---|---|---|
| ICE PROTECTION | PITOT & STATIC | toggle | OFF 0 / ON 1 | `ac.m2.pitot_static_sw` |
| | ENG ANTI-ICE L, R | toggles | OFF 0 / ON 1 | `ac.m2.eng_ai1_sw`, `eng_ai2_sw` |
| | WING ANTI-ICE | toggle | OFF 0 / ON 1 | `ac.m2.wing_ai_sw` |
| | TAIL DE-ICE | 3-pos (MANUAL spring) | MANUAL −1 / OFF 0 / AUTO 1 | `ac.m2.tail_deice_sw` |
| W/S ANTI-ICE | W/S BLEED L, R | 3-pos toggles | OFF 0 / LOW 1 / HI 2 | `ac.m2.ws_bleed1_sw`, `ws_bleed2_sw` |
| | W/S ALCOHOL | toggle (guarded EST) | OFF 0 / ON 1 | `ac.m2.ws_alcohol_sw` |
| FUEL | BOOST L, R | toggles | NORM 0 / ON 1 | `ac.m2.boost1_sw`, `boost2_sw` |
| | FUEL TRANSFER | rotary | L TANK −1 / OFF 0 / R TANK 1 | `ac.m2.fuel_xfer` |
| LIGHTS | NAV | toggle | OFF / ON | `ac.m2.nav_lt` |
| | ANTI-COLL | 3-pos | OFF 0 / BEACON 1 / ALL 2 | `ac.m2.anti_coll` |
| | LANDING / RECOG | 3-pos | OFF 0 / PULSE 1 / ON 2 | `ac.m2.landing_lt` |
| | TAXI | toggle | OFF / ON | `ac.m2.taxi_lt` |
| | TAIL (logo) | toggle | OFF / ON | `ac.m2.logo_lt` |
| | WING INSP | toggle | OFF / ON | `ac.m2.wing_insp_lt` |
| | PANEL, PEDESTAL, FLOOD | rotary dimmers (OFF detent) | 0..1 | `ac.m2.panel_lt`, `pedestal_lt`, `flood_lt` |
| | PASS SAFETY | 3-pos | OFF 0 / BELT 1 / BELT & NO SMOKE 2 | `ac.m2.pax_safety` |
| TEST | SYSTEM TEST rotary (EST, CJ1+ "rotary test switch") | OFF 0 / FIRE WARN 1 / ANNU 2 / STALL WARN 3 / O'SPEED 4 / LDG GEAR 5 / TAWS 6 | `ac.m2.test_sel` |

### 9.5 Centre — LANDING GEAR control module
| Control | Type | Values | Var |
|---|---|---|---|
| Gear handle (wheel knob) | 2-pos lever, locked DN on the ground (`gear.handle_lock`) | UP 0 / DN 1 | `ac.m2.gear_handle` |
| 3 green / red UNLOCKED lights | indicators | — | `gear.green0..2`, `gear.red0..2` |
| HORN SILENCE | push button (momentary) | — | `ac.m2.gear_horn_sil` (→ event `gear.horn_silence`) |
| ANTISKID | toggle | OFF 0 / ON 1 | `ac.m2.antiskid_sw` |

### 9.6 RH tilt panel (EST layout)
| Group | Control | Type | Values | Var |
|---|---|---|---|---|
| PRESSURIZATION | PRESS SOURCE | rotary | OFF 0 / L 1 / R 2 / NORM 3 / EMER 4 | `ac.m2.press_source` |
| | PRESS MODE | toggle | AUTO 0 / MAN 2 | `ac.m2.press_mode` |
| | MANUAL (cabin UP/DN) | 3-pos spring-centre | DN −1 / 0 / UP 1 | `ac.m2.press_manual` |
| | CABIN DUMP | guarded toggle | NORM 0 / DUMP 1 | `ac.m2.cabin_dump` |
| ENVIRONMENTAL | AIR COND | toggle | OFF / ON | `ac.m2.air_cond_sw` |
| | CABIN FAN | 3-pos | OFF 0 / LOW 1 / HIGH 2 | `ac.m2.cabin_fan` |
| | TEMP CONTROL | toggle | AUTO 0 / MANUAL 1 | `ac.m2.temp_mode` |
| | TEMP SELECT | rotary 0 COLD … 1 HOT | continuous | `ac.m2.temp_sel` |
| | MANUAL TEMP | 3-pos spring-centre | COLD −1 / 0 / HOT 1 | `ac.m2.temp_man` |
| | AIR DISTRIBUTION (defog diverter) | rotary 0 cabin … 1 defog | continuous | `ac.m2.air_distrib` |
| OXYGEN | PASS OXY | rotary | CREW ONLY 0 / NORM 1 / MANUAL DROP 2 | `ac.m2.pax_oxy` |
| MISC | EMER COMM | guarded toggle | NORM 0 / EMER 1 (COM1 121.5) | `ac.m2.emer_comm` |
| | EVENT | push button | momentary | `ac.m2.event_marker` |
| | CVR (TEST / light) | push button | momentary | `ac.m2.cvr_test` (light `ac.m2.cvr_test_lt`) |
| | ELT | 3-pos (RESET spring) | RESET/TEST −1 / ARM 0 / ON 1 | `ac.m2.elt_sw` |
| | HOURS | flight hour meter (display) | — | — |
| | CABIN LIGHTS master | toggle | OFF / ON | `ac.m2.cabin_lt` |
| | MAP L / R | rotary dimmers | 0..1 | `ac.m2.map_lt1`, `map_lt2` |

### 9.7 Pedestal
| Control | Type | Values | Var |
|---|---|---|---|
| GTC 570 ×2 | touch screen + dual concentric knob, center knob, map knob/joystick | events per `g3000Controls()` | `g3k.gtc1.*`, `g3k.gtc2.*` |
| ENGINE START L, R | lighted push buttons (momentary) | — | `ac.m2.start1`, `start2`; light `ac.m2.start1_lt/_2` |
| START DISENGAGE | push button | momentary | `ac.m2.start_diseng` |
| IGNITION L, R | toggles | NORM 0 / ON 1 | `ac.m2.ign1_sw`, `ign2_sw` |
| Throttles L, R | levers with detents, CUTOFF gate (finger lift) | CUTOFF −0.1 / IDLE 0 / CRU 0.62 / CLB 0.82 / TO 1.0 | `ac.m2.tla1`, `tla2` |
| TO/GA | button on the LH throttle | momentary | `input.toga` |
| FLAPS handle | lever, detents | UP 0 / 15 1 / 35 2 / 60 GND 3 | `ac.m2.flap_handle` |
| SPEED BRAKE handle | 2-pos lever | RETRACT 0 / EXTEND 1 | `ac.m2.speedbrake` |
| Elevator trim wheel + indicator | wheel | units −1 ND … +1 NU (take-off band 0.05–0.55) | `ac.m2.pitch_trim` |
| Rudder trim knob | rotary | −1 NL … +1 NR | `ac.m2.rud_trim` |
| Aileron trim knob | rotary | −1 LWD … +1 RWD | `ac.m2.ail_trim` |

### 9.8 Control wheels (both), pedals
| Control | Var / event |
|---|---|
| Pitch trim switch (split rocker) | `ac.m2.yoke_trim1/2` (−1 / 0 / +1); keyboard `input.pitch_trim_rate` |
| AP/TRIM DISC | `input.ap_disc` |
| CWS | event `ap.cws` { pressed } |
| PTT / map light | audio (SCOPE) |
| Rudder pedals + toe brakes | `input.yaw`, `input.brake_left/right` (nose steering ±20°) |

### 9.9 Below the panel / misc
| Control | Type | Values | Var |
|---|---|---|---|
| PARKING BRAKE | pull handle | 0 / 1 | `ac.m2.park_brake` |
| EMERGENCY BRAKE | pull handle (proportional) | 0..1 | `ac.m2.emer_brake` |
| EMER GEAR RELEASE | T-handle | 0 / 1 | `ac.m2.gear_emer` |
| GEAR BLOW DOWN | pull knob | 0 / 1 | `ac.m2.gear_blowdown` |
| CONTROL LOCK | handle | 0 stowed / 1 engaged | `ac.m2.control_lock` |
| RAIN DOORS L / R | levers | 0 / 1 | `ac.m2.rain_door1/2` |
| Crew O₂ masks | stowage doors / regulator | on 0/1; NORMAL 0 / 100 % 1 / EMER 2 | `ac.m2.mask1_on`, `mask1_mode` (…2) |
| Doors (ground menu/exterior) | cabin, emergency exit, nose baggage L/R, tail baggage | 0 closed / 1 open | `ac.m2.door_<id>` |
| GPU | ground-services menu | 0 / 1 | `ac.m2.gpu_connected` |

## 10. Normal procedures (abbreviated flow; `checklists.ts`)
EST (CJ-family single-pilot flow; AFM Vol. 2 525NPD not public).
1. **Preflight / cockpit preparation**: control lock off, parking brake set, throttles CUTOFF, gear
   DN, CBs in, emergency gear/brake stowed, oxygen checked, PASS OXY NORM, BATTERY BATT (≥ 24 V),
   SYSTEM TEST: FIRE WARN, ANNU (lamps), STALL, O'SPEED, TAWS; fuel quantity.
2. **Before start**: doors closed, AVIONICS ON (or DISPATCH for planning), GEN switches GEN, boost NORM,
   ignition NORM, beacon ON, PASS SAFETY BELT & NO SMOKE, flight plan/TOLD on the GTC.
3. **Engine start** (right first, EST): ENGINE START R → START R advisory, N2 rises on the starter;
   at 8–10 % N2 throttle IDLE → FADEC light-off (ITT rise within 10 s), starter cut-out ~45 % N2,
   stabilized idle ~52 % N2 / 25 % N1 (EST) in ~30 s; GEN OFF R clears. Repeat left (generator-assisted).
   Abort: START DISENGAGE / throttle CUTOFF (FADEC auto-aborts HOT/HUNG/NO LIGHT).
4. **Before taxi**: flaps 15, trim T/O, PRESS SOURCE NORM, anti-skid ON, A/C as required, lights.
5. **Taxi**: brakes, steering (pedals ±20°), instruments.
6. **Before takeoff**: flaps 15 (or 0), speed brakes retracted, trims set, P/S heat ON, anti-ice as
   required (≤ 10 °C in visible moisture), XPDR ALT, landing lights ON, anti-coll ALL, CAS clear.
7. **Takeoff**: throttles TO, VR, pitch ~10°, positive rate gear UP, flaps UP at V2+10, CLB detent,
   YD/AP as required.
8. **Climb**: CLB detent, FLC 240 KIAS / M0.64 (EST schedule), pressurization check.
9. **Cruise**: CRU detent, fuel balance, ice protection.
10. **Descent**: landing elevation on the GTC, altimeters, approach/minimums/VREF, PASS SAFETY BELT.
11. **Approach**: flaps 15 below 200, gear DN below 186, flaps 35 below 161, VREF + wind.
12. **Landing**: AP off by DA/MDA (not an autoland system), throttles IDLE, ground flaps 60 (speed
    brakes deploy), brakes/anti-skid.
13. **After landing / shutdown**: flaps up, speed brakes retract, P/S heat off, lights; AVIONICS OFF,
    throttles CUTOFF, lights OFF, BATTERY OFF, control lock ON.

### 10.1 Key abnormal procedures (EST, CJ family)
- **Engine fire**: throttle CUTOFF, ENG FIRE push, BOTTLE (lit) push; second bottle after 30 s if the
  warning persists; single-engine procedures (tested).
- **Generator failure**: GEN RESET then GEN; if off line: single-generator, loads shed (tested).
- **Dual generator failure**: shed loads, BATTERY EMER → emergency bus (PFD1, GTC1, COM/NAV 1, ESI).
- **Hydraulic failure**: gear by emergency release + blow-down, flaps/speed brakes inoperative (tested).
- **Emergency descent / CABIN ALTITUDE**: masks on 100 %, PASS OXY (auto drop at 13,500 ft), descend (tested).
- **Anti-skid failure**: brake gently; emergency brake without anti-skid.

## 11. Simulation model summary and verification
- FDM (`fdm.ts`): CL tables tuned to FPG stall speeds (±2 %), drag/lapse/TSFC to the FPG
  high-speed cruise table (TAS ±1 %, FF ±1 % at FL330-FL410), climb schedule to 24 min to FL410
  (sim ~26 min), inertia from Roskam radii of gyration, gear at FS 264.7 (EST), tail strike ~13°.
- Tests (`tests/aircraft/citation-m2`): cold & dark start; takeoff (AEO ×1.15 ≈ 3,200 ft, OEI at V1
  ≈ 3,290 ft vs BFL 3,210); climb; cruise FL330/FL410; stall speeds; overspeed; coupled ILS to DA;
  generator / hydraulic / fire / decompression failures; state presets.

## 12. Known gaps / SCOPE
- Exact AFM CAS wording, switch labels on the tilt panels, and several thresholds are EST (CJ family).
- Climb fuel ~25 % above the FPG (single TSFC-vs-N1 curve cannot match both climb and cruise).
- Control lock modelled as jammed primary controls; rain doors only drive a windshield-rain output.
- No thrust attenuators/reversers (correct for the M2); no autothrottle (Gen2 option not modelled).
- Vapor-cycle A/C is a heat sink in the cabin zone model; no pack/ACM temperature detail.
- Weather radar, ChartView, CVR/ELT are state-only (G3000 family scope).

## 13. Flight deck and exterior implementation (cockpit-main agent)

Code: `src/aircraft/citation-m2/index.ts` (AircraftModule), `exterior.ts`,
`cockpit/` (`index.ts` assembles; `layout.ts` geometry; `shell.ts`, `panels.ts`,
`lower.ts`, `pedestal.ts`, `flightControls.ts`, `displays.ts` ESI-1000 + hour
meter, `controls.ts` GTC map knob / joystick, `logic.ts` GTC knob push / hold).
Test: `tests/aircraft/citation-m2/cockpit-main/controls.test.ts` (writes the
coverage report `tests/output/citation-m2-cockpit-coverage.txt`: 133 controls,
0 unbound).

**Layout sources.** S&D15 §10.2 lists the panels left to right (glareshield,
instrument panel, tilt panel, pedestal, beneath the panel); the S&D Figure III
photograph gives the arrangement. The tilt panel follows the S&D order
(pressurization, ice, W/S, fuel, manual temp | gear module | lighting, EMER
COMM, event, CVR, hour meter, ELT); items the S&D does not list there (SYSTEM
TEST, cabin fan / air distribution, PASS OXY, cabin lights) sit with the
nearest group (EST). The ESI-1000 is on the centre glareshield panel left of
the GMC 710 (S&D15 §10.2.A; L-3 bezel 3 x 4 in, four buttons). All positions
and sizes in `layout.ts` are EST from the photograph.

**Eye point.** x 2.99 / y -0.33 / z -0.42 (6 cm aft of the §9.0 estimate so the
PFD centre is ~26 deg below the horizon; z from a 0.76 m seated eye height
above the cushion with the floor at z 0.70). Seats, yokes and pedals are
placed around it.

**Bindings (beyond §9).** Yoke AP/TRIM DISC, CWS and the TO/GA button emit the
AFCS events `ap.disc`, `ap.cws` {pressed}, `ap.toga` (the `input.*` vars are
rewritten by the input module every frame, so cockpit buttons use the events).
ESI-1000 buttons: `ac.m2.esi_b1..4` (BARO -, BARO +, STD, BRT) handled by
`EsiController` (writes `adc3.baro_inhg` / `adc3.baro_std`). GTC dual knob
push: `ac.m2.gtc<n>_upper_push` -> `GtcKnobPushLogic` emits `upper_push` (< 0.8 s)
or `upper_hold`. Lamp test = SYSTEM TEST ANNU (`ac.m2.ckpt_lamp_test`);
annunciators dim with the panel lights (`ac.light.annun`).

**Overhead / sidewalls.** `cockpit/overhead/index.ts` and `cockpit/side/index.ts`
are picked up automatically when they exist (`import.meta.glob`): each default-
exports `(b: CockpitBuilder, c: M2CockpitContext) => void`; `c.mounts` holds
groups at `MOUNTS.overhead / sideL / sideR`, `c.systems` takes extra
subsystems. Not built by the main deck: crew oxygen masks (`ac.m2.mask*`), the
sidewall CB panels (`cb.*`), map-light fixtures (the MAP L/R dimmers are on the
RH tilt panel per §9.6), magnetic compass, cup holders.

**Exterior.** Outer skin `M2_FUSELAGE` (monotone-cubic stations, super-elliptic
sections) shared with the cockpit shell; wing / tail / nacelles from the S&D
dimensions and TCDS surface travels; animated gear (nose forward, trailing-link
mains inboard, nose doors), flaps, ailerons + LH trim tab, upper / lower speed
brakes, elevators + tabs, rudder + tab, fans, airstair door
(`ac.m2.door_cabin`), exterior lights (LED, EST candela through
`world.render_units_per_lux`).

## 14. Overhead and sidewalls (cockpit-overhead agent)

Code: `src/aircraft/citation-m2/cockpit/overhead/` (`index.ts` headliner fittings,
`compass.ts`, `mask.ts`) and `cockpit/side/` (`index.ts` sidewalls, `breakers.ts`
CB table, `outlet.ts`, `services.ts` subsystem, `interior.ts` lining profile);
both mount through the `import.meta.glob` hook of `cockpit/index.ts`. Tests:
`tests/aircraft/citation-m2/cockpit-overhead/` (coverage report
`tests/output/citation-m2-overhead-coverage.txt`: 74 controls, 0 unbound).

**What the M2 has up there.** No overhead switch panel: every system switch is
on the instrument / tilt panels, glareshield and pedestal (S&D15 §10.2). The
S&D15 §10.4 "miscellaneous cockpit equipment" list gives the rest: magnetic
compass, eye position reference indicator, two ventilation air outlets, oxygen
system control, two oxygen masks, two reading lights, a floodlight; §11.1:
reading lights, air outlets, sidewall map pockets, dual cupholders per crew
seat, a 110 V outlet in the copilot sidewall; §14: cockpit fire extinguisher,
emergency lighting battery pack. Not fitted, so not built: wipers (rain doors),
electric windshield heat (bleed air), dome / storm lights, emergency-lighting
switch (CAE CJ-family differences p. 5-17: none on the CJ/CJ1/CJ2), cockpit
door, audio control panel (GMA 36 run from the GTCs, S&D15 §10.3.H).

**Circuit breakers.** LH / RH sidewall panels (S&D15 §9.4) carry one
`CircuitBreaker` per network breaker <= 50 A (every load plus the AVN 1 / AVN 2 /
L XFEED / AUX BATT feeders), grouped EMERGENCY BUS / AVIONICS 1 / LEFT MAIN /
LEFT CROSSFEED and AVIONICS 2 / RIGHT MAIN / RIGHT CROSSFEED; L / R IGN and
PITCH TRIM on the left panel per the CAE CJ-family text. The > 50 A breakers
(generator-bus limiters, R XFEED feed, vapor-cycle A/C) are junction-box
limiters, not on the panels. Names, grouping and layout are EST.

**Controls and what reads them.** Crew masks (`ac.m2.mask<n>_on`), regulator
N / 100% / EMER (`ac.m2.mask<n>_mode`), PRESS TO TEST (`ac.m2.mask<n>_test`) and
the flow lamps (`oxy.crew<n>_flowing`) -> OxygenSystem; 110 V outlet plug
(`ac.m2.ac_outlet_plug`) -> inverter load enable, outlet LED from
`ac.m2.ac_outlet_v`; breakers -> ElectricalNetwork.

**Systems changes (bug fixes for loads whose power nothing read).** W/S
ALCOHOL anti-ice now needs `elec.ws_alcohol_powered`; AUTO cabin temperature
needs `elec.temp_ctl_powered` (unpowered: the mixing valve holds the manual
target); inverter load enabled by the outlet plug (2.5 A EST); crew mask test
bindings. `M2CabinServices` (cockpit/side/services.ts) forces the DME outputs
invalid with `elec.dme_powered` = 0, publishes the outlet voltage and runs the
5 g inertia emergency-lighting battery pack (`ac.m2.emer_lts`, 10 min EST).

**Compass.** Drum card with reverse sensing, EST damping (tau 1.2 s),
northerly turning error (latitude / 15 x bank x cos heading) and
acceleration error, internal lamp on the panel-lights circuit; reads
`fdm.hdg_mag_deg` (the compass is its own sensor).

**Views added.** Headliner / crew oxygen, LH circuit breakers, RH circuit
breakers; the Overhead view now looks at the compass / windshield header.

**Second pass: every breaker has a consumer.** A new test (`consumers.test.ts`) records the reads
of every panel breaker's `elec.<load>_powered` flag. Six were read by nothing: xpdr, radar, audio2,
cockpit_fans, cabin_fan and pax_signs. They are now consumed as follows:
- `systems/avionicsHealth.ts` (`M2AvionicsHealth`, after the G3000 systems) posts Garmin system
  messages. The wording follows the G1000 PG 190-00498-07 App. A; its use on the M2's G3000 is EST.
  - "GMA1/2 FAIL". The marker receiver is now powered by either GMA (`audio1 || audio2`).
  - "XPDR1 FAIL", with IDENT dropped; `ac.m2.xpdr_reply` is published.
  - "GWX FAIL", with the G3000 radar forced to STBY.
  - "PFD1/MFD1/PFD2 COOLING" from an EST GDU thermal model driven by the avionics fans (rise +12 C
    with fans, +40 C without, tau 10 min, hot above 50 C). A hot GDU dims to 60 % (`M2LogicLate`).
- The CABIN FAN (evaporator blower) scales vapor-cycle A/C cooling: OFF 40 %, LOW 70 %, HIGH 100 %
  (EST, `airframe.ts`).
- The passenger signs publish `ac.m2.pass_belt_lt` / `pass_nosmk_lt` and play the cabin chime.
- The avionics and cabin fans drive the `fan.avionics` audio loop (`side/services.ts`).

CB names are now engraved at 2.7 mm and group titles at 3.1 mm (earlier they were 2.1 mm and hard to
read), and the CB views sit closer to the panels.

## 15. Check ride (verification agent)

Tests: `tests/aircraft/citation-m2/verify/` (`flightRig.ts` rig, `fullFlight.test.ts`,
`alerts.test.ts`, `drawcalls.test.ts`).

**Full flight** (`fullFlight.test.ts`, ~1 min headless): one continuous single-pilot flight KICT 19R ->
PER -> FILUM -> ILS 17R KOKC at FL230, driven only through cockpit vars, GMC 710 keys, the G3000
flight-plan / TOLD back end and the pilot's yoke / pedals / toe brakes (no autothrottle: a simple
"hand on the levers" speed loop). Asserted at each step: cold & dark; SYSTEM TEST FIRE / ANNU lamps;
battery starts R then L (peak ITT ~640 C, bus dip ~15 V, GEN OFF clears); AHRS / GPS valid; FMS route
(the FILUM hold-in-lieu is removed for the straight-in, see below), W&F within 300 lb of the FDM,
TOLD V1/VR/V2 96/100/107 and BFL 2,860 ft at 9,900 lb; taxi and line-up on the centre line; TO/GA
-> FD TO/TO; TO detent N1 ~101.7 %, lift-off ~113 KIAS in ~1,970 ft (inside BFL/1.15); AP at > 450 ft
(PIT/ROL, YD on), NAV -> FMS, flaps up at V2+10, CLB detent, FLC, VNAV armed (VPTH); FL230 in ~8 min
(FPG FL250 9 min at MTOW), no cautions, cabin on schedule; cruise at the CRU detent limited to 255
KIAS (359 KTAS, ~1,070 lb/h; FPG FL250 max cruise 377 KTAS / 1,122 lb/h) with the tanks decrementing at
the engine flow; VPTH descent, baro STD / QNH at FL180; landing TOLD (VREF 107); flaps 15, APR ->
LOC/GS armed, LOC then GS capture, gear down, flaps 35, VREF+5 stabilized at 1,000 ft within 0.5 dot;
AP + YD off at the 200 ft DA; hand-flown flare, touchdown ~1,100 ft past the threshold; ground flaps
60 deploy the speed brakes; stop inside the FPG landing distance; taxi clear; shutdown (throttles
CUTOFF, no warnings, displays off, buses dead). Block ~39 min, ~510 lb fuel.

**Spot checks** (`alerts.test.ts`): gear horn (< 130 KIAS, throttle idle, silenceable) and the
non-silenceable flaps-35 horn; takeoff-configuration warning (flaps 35 / speed brakes / parking
brake at TO thrust); speed-brake auto-retract with a throttle above ~85 % N2; ground flaps deploy the
speed brakes on the ground only, GROUND FLAPS caution in flight; night detection for the presets.

**Fixes made in this pass**
- Night presets: `states.ts` decided "night" from `env.ambient_light`, which the world only computes on
  its first frame, so night starts had every panel dimmer off. It now computes the sun elevation from
  the clock the app sets before `applyState` (`isNightForPreset`, NOAA algorithm in
  `world/sky/solar.ts`); the night screenshots show the panels backlit.
- Render budget: the 63 circuit-breaker white bands (only visible with a breaker out) are hidden while
  the breaker is in: cockpit 682 -> 618 draw calls, whole frame 835 -> 771 (smoke view, KTEB).
- `fdm.ts` header said the empty CG was FS 247.0; the code (and the rest of the dossier) uses FS 250.0.

**Known gaps found (not fixed, outside this aircraft's files)**
- Shared nav library: an approach transition that starts with a hold-in-lieu-of-PT (HF) leg is
  appended without the TF leg into the IAF, and the HF geometry length excludes the inbound distance,
  so `fms.dist_to_dest_nm` / TOD are short by that leg (88 nm instead of 140 nm on KICT-KOKC).
  Deleting the HF leg on the GTC (the crew's "straight-in" action) also drops its fix; the test
  re-inserts FILUM.
- Cockpit lighting (shared renderer): surfaces in shadow get almost no sky fill light, so white panel
  legends in the glareshield's shadow are hard to read in daylight (every aircraft shows it).
- G3000 (shared): the MFD navigation map defaults to relative terrain, which paints the whole map red
  on the ground.
