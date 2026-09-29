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
- Climb schedule (FPG "cruise climb"; speed not printed): **220 KIAS / M0.60, EST** — AOPA Pilot (Mar 2014) M2
  flight test: "the VNAV profile defaults to 200 or 220 KIAS"; flown at the CLB detent this schedule matches the FPG
  time/fuel/distance within ~5 % at every tabulated level (an earlier 240 / M0.64, the CJ4 schedule, gave +25 % fuel and
  +30 % distance). The G3000 FMS speed schedule uses it (`systems/avionics.ts`).
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
- **No avionics switch**: "there is no avionics switch; a single battery switch controls both of the batteries and
  the avionics master ... there is a dispatch switch that powers GTC number 1 and the multifunction display"
  (AOPA Pilot, Mar 2014); the **DISPATCH** switch (S&D15 §10.3.T) runs them from the aux battery for ground
  radio calls and flight planning; 60 min on the battery in EMER (AOPA).
- Simulator topology (EST, CJ-family): HOT BATT → (BATT relay) → BATT BUS ⇄ (225-325 A limiters; the operating
  generator's limiter opens in flight while the other starter runs, 525AFM-06 p.3-107 battery airstarts) ⇄
  L MAIN (gen 1) / R MAIN (gen 2); BATT BUS → (diode) → EMER BUS; HOT BATT → (EMER relay, BATTERY
  switch EMER) → EMER BUS; L/R MAIN and BATT BUS → (diodes) → L/R XFEED; BATT BUS → (avionics relay, BATTERY
  BATT) → AVN 1; R XFEED → (avionics relay, BATT) → AVN 2; EMER → EMER-D and AVN 2 → AVN2-D (diodes); AUX BATT →
  (DISPATCH relay) → EMER-D and AVN2-D; AUX BATT → (diodes while a starter runs) → EMER and AVN 2 (S&D15 §9.4).
- Load placement: EMER = the M2 flows "EMER BUS ITEMS" (PFD 1 with ADC 2 / AHRS 2 in reversion, GTC 1, GIA 1
  (COM 1 / NAV 1 / GPS 1), XPDR 1, audio 1 and 2, GMC 710, flood lights, gear control and lights) plus the CJ1+
  list of CAE p.5-25 (flap control, R pitot-static heater, speed-brake control EST, ESI charge, GEA engine
  interface / voltmeter, fire detection, igniters, FADEC backup, standby panel lights); AVN 1 = ADC 1, AHRS 1,
  AP servos (lost on EMER: 525AFM-06 p.3-26 "flight guidance system, including autopilot, is inoperative");
  AVN 2 = MFD, PFD 2, GTC 2, GIA 2, radar, DME, RA, TCAS, XPDR 2; L MAIN = L pitot, L boost pump, pitch trim,
  L landing light, nav, beacon, wing inspection, W/S alcohol, L bleed control, stall warning; R MAIN = AOA heat,
  R boost, R landing, taxi, strobes, logo, R bleed control, pressurization controller, tail de-ice, anti-skid;
  L XFEED = panel lights, avionics fans, temp control; R XFEED = brake hydraulic pump, cabin fan, cabin lights,
  pax signs, inverter (not in EMER, CAE p.5-26), vapor-cycle A/C. Every load has a `cb.<load>` breaker.
- DISPATCH: MFD, GTC 1, GIA 1 and audio 1 (EST: the radio needs the audio panel) from the aux battery; PFD 1 off.
- Generator load limits on the EIS (CAE p.5-21 CJ1+): 210 A on the ground, 300 A in flight below FL350, 250 A above.
- Battery start (test): bus dips to ~15.6 V, starter current ~750 A peak, AVN 1 held at 25.5 V by the aux battery.

### 6.2 Fuel (S&D15 §9.2, S&D21 §9.2; `systems/fuel.ts`)
- Two integral wing tanks; each engine fed from its own tank automatically.
- Motive-flow **ejector pump** in each sump (driven by HP fuel returned from the FDU) + motive-flow
  scavenge pump; engine-driven pump and FADEC-controlled fuel delivery unit (FDU).
- **Electric boost pump** in each tank, switch OFF / NORM / ON (CAE p.5-30): NORM = automatic for start,
  transfer and low pressure; the low-pressure activation latches until OFF/ON and back to NORM (525AFM-06
  p.3-115); OFF inhibits every automatic operation.
- Tank-to-tank transfer: "Fuel is transferred in the direction of the arrow on the FUEL TRANSFER selector (i.e.
  if the selector is turned clockwise, the arrow points to R TANK and fuel is transferred from the left tank)"
  (525AFM-06 p.3-113): R TANK runs the LEFT pump; no transfer with the receiving tank's pump on; ~10 lb/min.
- FUEL FLTR BYPASS L/R (filter ΔP ~10 psi, failure `fuel.filter_l/_r`).
- Vented surge tank near each tip; 6 capacitance probes per wing, dual-channel conditioner; overwing
  gravity filling; fuel heated by oil/fuel heat exchanger (no additive needed).
- Firewall shutoff valves closed by the ENG FIRE push buttons (EST CJ family).
- FUEL LOW LEVEL L/R 190 lb per tank (EST; CJ family 220 ± 10 lb), master caution after 4 s; imbalance 200 lb (EST).

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
- AIR SOURCE SELECT OFF / L / BOTH / R / EMER / FRESH AIR, CABIN DUMP, manual pressure control (CJ family).
  Source selection is electric: unpowered, the source valves fail open and the source reverts to BOTH (CAE p.5-24,
  525AFM-06 p.3-26); PRESS SOURCE FAIL (EST) with no inflow in flight.
- Automatic emergency pressurization on at 14,500 ft cabin, off ~1,000 ft lower (525AFM-06 p.3-23).
- CABIN DUMP needs DC power, works in every mode, and the maximum-limit valves stop the cabin at ~14,500 ft
  (525AFM-06 p.3-119). MANUAL: UP (+1) = cabin climbs (outflow opens), DN (−1) = cabin descends.
- On the ground the safety valve is held open by the ground solenoid through the squat switch (EST, CJ family),
  so the cabin stays within ~0.05 psi of ambient with both packs flowing (`safetyValveOpen: 'gear.air_ground'`).
- Landing field elevation: GTC entry, else the FMS destination, else the takeoff field elevation latched on the
  ground (`ac.m2.to_field_elev_ft`, EST).
- Sim schedule (EST, differential-limited): cabin at the departure field / sea level to 22,000 ft, then toward
  8,000 ft at FL410, 8.5 psid on top (≈5,500 ft cabin at FL350); 500 fpm climb / 300 fpm descent limits, relief
  8.8 psi, cabin volume 7.5 m³ (EST). CABIN ALTITUDE 9,500 ft (14,500 ft high-altitude mode above 8,000 ft
  field elevation, 525AFM-06 p.3-23 / p.3-118); pax masks 14,500 ft (525AFM-06 p.3-122). Ground: larger safety
  valve area so the ramp differential stays < 0.01 psi. In-air presets take the field elevation from the nearest
  airport (`presetFieldElevationFt`).

### 6.5 Ice and rain protection (S&D15 §9.7, S&D21 §9.7)
- Bleed air: engine inlets, pylon inlet ducts, wing leading edges, windshields; pilot windshield
  alcohol back-up.
- Horizontal stabilizer pneumatic boots on 23 psi service air: AUTO inflates L then R, repeats after 3 min;
  MANUAL (momentary) inflates both while held; TAIL DE-ICE L/R advisories at inflation pressure; LOW TEMP caution
  below −35 °C RAT (EST) (525AFM-06 p.3-100).
- Per-side WING/ENG ANTI-ICE switches OFF / ENG / WING/ENG (525AFM-06 p.3-99); the wing valve closes below 75 %
  N2; COLD cautions from selection until the surface is warm (EST ~35 s wing, ~20 s engine) and ~1 min after the
  heat is lost; WING/ENG ANTI-ICE ON / ENG ANTI-ICE ON / TAIL DE-ICE ON advisories (M2 flows).
- W/S bleed: EST temperature model with the overheat shut-off valve and W/S AIR O'HEAT (reset by OFF);
  alcohol reservoir 10 min (525AFM-06 p.3-101).
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
- Emergency: T-handle releases the uplocks (free fall); the blow-down knob only works after the T-handle
  (525AFM-06 p.3-103).
- Warning horn: gear not down, < 130 KIAS on the copilot's (ADC 2) airspeed and either throttle below ~85 % N2;
  horn with flaps beyond the approach setting not silenceable (EST CJ family); SYSTEM TESTS LDG GEAR sounds it.
- Anti-skid: ~3 s power-up self test (ANTISKID INOP lit; fails if moving, 525AFM-06 p.3-90); emergency brake
  nitrogen bottle EST 1,800 psi, ~120 psi per application.
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
- Flaps: follow-up handle 0–35 with a push-down gate at T.O. & APPR and a lift gate at LAND (525AFM-06 p.3-103);
  60 = ground flaps (deploy the speed brakes on the ground). 38° switch: no extension past 38° unless the handle
  is full aft and both throttles are below ~85 % N2; FLAPS >35 caution (525AFM-06 p.3-104.1).
- Speed brakes: upper (0–49°) and lower (0–68°) panels on each wing, any speed; handle or ground flaps, retracted
  whenever either throttle is at high thrust (EST switch position just above CRU) and redeployed at idle
  (525AFM-06 p.3-89.1); SPD BRK breaker; SPD BRK EXTEND when fully extended.
- Electric trim: split yoke switch (both halves), pilot over copilot, AP/TRIM DISC held interrupts electric and
  AP trim (525AFM-06 p.3-89.1); manual electric trim disconnects the AP (GFC 700).
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
| W | OIL PRESS L / R | oil < 23 psi (TCDS min), 2 s, all phases (525AFM-06 p.3-16); engine stopped on the ground: posted without master |
| W | GEN OFF L-R | both generators off line, airborne or an engine running; aural "GENERATOR FAIL"; singles suppressed (525AFM-06 p.3-106) |
| W | CABIN ALTITUDE | cabin ≥ 9,500 ft (14,500 ft above an 8,000 ft field); aural |
| W | CABIN DIFF PRESS | diff above relief |
| W | BATT O'TEMP / BATT O'TEMP >160 | NiCd ≥ 63 °C / ≥ 71 °C; voice "BATTERY OVERTEMP", faster repeat above 71 °C (CAE p.5-25) |
| W | DOOR UNLOCKED | cabin door / emergency exit open in flight |
| W | AOA FAIL | AOA vane / stall warning failed |
| W | GEAR UNSAFE | gear disagree / not down with a horn condition |
| W | AP TRIM FAIL | pitch trim runaway / jam |
| W | T/O CONFIG | takeoff thrust with speed brakes / trim / parking brake wrong (EST wording) |
| C | GEN OFF L / R | generator off line (engine stopped on the ground: no master) |
| C | BATT DISCHARGE | discharging > 15 A with an engine running or airborne, 10 s (EST) |
| C | EMER BUS ON BATT | BATTERY switch EMER |
| C | MAIN BUS VOLTS LOW | bus < 24.5 V (not starting) |
| C | FUEL LOW LEVEL L / R | tank < 190 lb (EST), 4 s |
| C | FUEL LOW PRESS L / R | feed pressure low (engine stopped on the ground: no master) |
| C | FUEL FLTR BYPASS L / R | clogged filter (~10 psi ΔP) |
| C | FUEL IMBALANCE | > 200 lb |
| C | FADEC FAULT L / R | FADEC failure |
| C | START ABORT L / R | FADEC auto-abort (hot / hung / no light) |
| C | HYD FLOW LOW L / R | EDP flow low: failed, N2 < 40 % or ENG FIRE pushed (no demand needed) |
| C | HYD PRESS ON | main system still pressurized 30 s after the cycle |
| C | HYD PRESS LOW | pressure demanded, < 1,000 psi |
| C | BRAKE PRESS LOW | brake system and accumulator < 900 psi |
| C | ANTISKID INOP | switch OFF, self test running / failed, fault or unpowered (525AFM-06 p.3-90) |
| C | EMER BRAKE ON | emergency brake pulled in flight |
| C | PARK BRAKE ON | parking brake set with throttles advanced |
| C | FLAPS FAIL | flap disagree / asymmetry |
| C | FLAPS >35 | flaps > 38° with a throttle at high thrust on the ground, or airborne (525AFM-06 p.3-104.1) |
| C | GROUND FLAPS | flap handle 60 in flight |
| C | SPEED BRAKE | speed brakes out with flaps > 17° or below 500 ft RA |
| C | P/S HTR OFF L / R, AOA HTR FAIL | heaters unpowered in flight |
| C | ENGINE ANTI-ICE COLD L / R / L-R, WING ANTI-ICE COLD L / R / L-R | selected and not yet warm / heat lost (M2 flows wording) |
| C | TAIL DE-ICE FAIL, TAIL DE-ICE LOW TEMP | no service air / power; RAT < −35 °C (EST) |
| C | W/S AIR FAIL, W/S AIR O'HEAT | no flow; overheat shut-off (525AFM-06 p.3-101) |
| C | EMER PRESS ON / PRESS SOURCE OFF / PRESS SOURCE FAIL / PRESS CTRL FAIL | EMER selected or automatic / OFF in flight / no inflow (EST) / controller fault |
| C | OXYGEN LOW | bottle < 400 psi |
| C | DOOR UNLOCKED (ground), BAGGAGE DOOR | doors open |
| C | AFCS FAIL, YD FAIL, PITCH TRIM | AFCS / servo failure, YD failure, AP mistrim |
| C | TAWS FAIL, CONTROL LOCK | TAWS inop (with a GDU powered); control lock engaged with an engine running |
| A | START L / R, FUEL BOOST ON L / R | start sequence, boost pump running (ignition: green IGN on the ITT scale) |
| A | FUEL TRANSFER, GPU ON, AVIONICS DISPATCH, PASS OXY ON, W/S ALCOHOL ON | as named |
| A | HYD PRESS ON | main system pressurized (normal during a gear / flap / speed-brake cycle, 525AFM-06 p.3-102) |
| A | SPD BRK EXTEND | speed brakes fully extended |
| A | WING/ENG ANTI-ICE ON, ENG ANTI-ICE ON, TAIL DE-ICE ON, TAIL DE-ICE L / R | M2 flows; boot at inflation pressure |
| A | PARKING BRAKE | parking brake set |

CAS power: GIA 1 or GIA 2 (the CAS is a G3000 function). Flight-phase inhibits (`inhibit: 'takeoff+landing'`)
on every caution and advisory except fire, cabin altitude, gear, oil, doors, park brake, FLAPS >35, start abort
and control lock: takeoff 80 kt → 400 ft RA, landing < 200 ft RA (FlightPhase defaults, EST CJ family).
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
  362×248 mm bezel, centre y −0.369 m) — **MFD** (centre) — **PFD2** (y +0.369 m); bezels ~7 mm apart
  (fix round 1; earlier EST 354×237 mm / 20 mm);
  display centres ~0.12 m below the glareshield lip.
- Glareshield (full width): LH/RH MASTER WARNING/CAUTION + ENG FIRE clusters outboard of the GMC,
  **GMC 710** (241×42 mm) centred with the DIMMING / reversion panel above it, **ESI-1000** (landscape,
  ~102×86 mm) left of the GMC above PFD1's inboard edge (flyradius: "pilot's upper left side"), GCU 275
  display controllers above each PFD; ice-detection lights at the centre-post base (fix round 1, §9.2).
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

### 9.1 LH instrument panel — registration plate, limitations placard, ELECTRICAL POWER panel
Photos (pin1, listing 9525 #24, Jetcraft 525-0851): registration plate, black limitations placard, then the
~100 × 110 mm ELECTRICAL POWER panel on the lower LH edge. RH edge: registration plate only (EST "N0000").
Layout (photos pin1, S&D figures; fix round 1 function lens M2-L13): top row **L GEN | BATTERY (red lever-lock
cap) | R GEN**; second row **DISPATCH** (amber LED) and **STBY FLT DISPLAY** (STBY BATT light). The M2 has no
AVIONICS switch (AOPA Mar 2014). EST: the third switch of the second row in the photos is not legible and is
not modelled.
| Control | Type | Positions / values | Var | Notes |
|---|---|---|---|---|
| L GEN, R GEN (top row, outboard) | 3-pos toggle | RESET −1 (spring to OFF) / OFF 0 / GEN 1 | `ac.m2.gen1_sw`, `gen2_sw` | |
| BATTERY (top row, centre) | 3-pos toggle, red lever-lock cap (lock out of BATT) | EMER −1 / OFF 0 / BATT 1 | `ac.m2.batt_sw` | BATT also closes the avionics relays |
| DISPATCH (second row) + amber LED | 2-pos toggle | OFF 0 / DISPATCH 1 | `ac.m2.dispatch_sw`, LED `ac.m2.dispatch_lt` | MFD + GTC 1 + GIA 1 on the aux battery (AOPA Mar 2014) |
| STBY FLT DISPLAY (second row) | 3-pos toggle (TEST spring to ON) | OFF 0 / ON 1 / TEST 2 | `ac.m2.stby_disp_sw` | M2 flows prep "TEST/ON", shutdown "OFF"; ESI powered (bus, then its battery) only ON/TEST |
| STBY BATT light | amber indicator | ESI running on its battery (TEST or bus loss) | `ac.m2.stby_batt_lt` | EST legend |
| BATTERY DISCONNECT (LH sidewall above the armrest) | guarded 2-pos toggle | NORMAL 0 / DISC 1 | `ac.m2.batt_disc` | CAE differences p.5-23; relay NiCd ↔ HOT BATT, coil drains the battery in DISC |
| CB panels (side consoles) | pull breakers | in 1 / out 0 | `cb.<load>` for every load in §6.1 | inclined 45° console tops, coloured collars (EST) |
EIS shows VOLTS L/R, GEN AMPS, BATT A/V (no separate meters).

### 9.2 Glareshield (fix round 1 layout; photos pin1 / Skies 2017 / S&D21 Fig 3; Garmin unit images)
Left → right: MASTER WARNING (outboard) + MASTER CAUTION (inboard) at |y| 0.50 / 0.46 (mirror-symmetric,
18 mm lenses); GCU 275 (LH); ESI-1000; ENG FIRE L over BOTTLE 1 ARMED; upper centre DIMMING / reversion panel
over the GMC 710; ENG FIRE R over BOTTLE 2 ARMED; GCU 275 (RH); MC / MW. Brow lip centre: blue-ringed photocell
fitting (EST display auto-dimming source).
| Control | Type | Var / event | Notes |
|---|---|---|---|
| MASTER WARNING (L, R) | red lighted push button | emits `cas.ack_warning`; light `alert.master_warning` | outboard |
| MASTER CAUTION (L, R) | amber lighted push button | emits `cas.ack_caution`; light `alert.master_caution` | inboard |
| ENG FIRE L / R | red lighted alternate-action push button under a clear hinged cover ("LIFT COVER and PUSH", 525AFM-06 p.3-9) | `ac.m2.eng_fire1/2`; light `ac.m2.eng_fire1_lt/_2` | 32 × 27 mm, large L / R over ENG FIRE |
| BOTTLE 1 / 2 ARMED | lighted push buttons (momentary) | `ac.m2.bottle1/2`; light `ac.m2.bottle1_lt/_2` | directly below each ENG FIRE |
| GCU 275 (L / R) | RANGE knob + joystick (push PAN), CLR, ENT, dual FMS knob (push ENT), D→, COM/NAV, FPL, PROC keys, BARO knob (push STD) | `g3k.range<s>.turn/push`, `g3k.gcu<s>.joystick`, `g3k.gcu<s>.key_*`, `g3k.gcu<s>.fms_*`, `g3k.baro<s>.*` | 140 × 51 mm; logic `avionics/garmin-g3000/state/Gcu.ts` (PFD windows `g3k.pfd<s>.gcu_win`) |
| DISPLAY REV PILOT / COPILOT | 2-pos pointer rotaries | NORM 0 / REV 1 → `g3k.rev_sw.pfd1` / `pfd2` | no MFD switch: with PFD1 failed the pilot's REV reverts the MFD (SCOPE/EST, systems/logic.ts) |
| FLOOD LTS | dimmer | `ac.m2.flood_lt` | DIMMING group |
| PANELS (DAY at the stop) | dimmer | `ac.m2.panel_lt` (pedestal / tilt backlighting follows, EST); ≥ 0.98 = DAY → annunciators full bright | |
| DISPLAYS | dimmer, 0 = AUTO (photocell) | `ac.m2.display_dim` → `display.pfd1/mfd/pfd2.brt` | |
| TOUCH CONTROLS | dimmer, 0 = AUTO | `ac.m2.gtc_dim` → `display.gtc1/gtc2.brt` | |
| GMC 710 | 241 × 42 mm, six sections: HDG/APR/NAV keys, HDG knob (PUSH SYNC), BC, CRS1 (PUSH CTR) · FD / BANK · XFR (arrows) / AP, YD · ALT, VS, ALT SEL knob, VNV · NOSE DN/UP wheel, FLC / SPD · CRS2 | events per `g3000Controls()` (`g3k.gmc.*`), lights `g3k.gmc.lt_*` | |
| ESI-1000 | landscape 3.7 in (320 × 240), bezel ~102 × 86 mm, keys M / S / − / + on the bezel, light sensor | `ac.m2.esi_b1..4`; menu `ac.m2.esi_menu` (BRIGHTNESS, BARO UNIT); S = STD / exit; −/+ = baro (EST mapping) | `displays.ts` |
| Compass / eye reference / ice-detection lights | on the windshield centre post base (compass on the glareshield top, eye-reference T above it flanked by two orange ice-detection lights lit by WING INSP `light.wing`) | | EST positions (S&D15 Fig III) |

### 9.3 Displays (GDU 1400W ×3)
362 × 248 mm bezels (SE Aerospace), centres 0.369 m apart. 12 bezel softkeys each (`g3k.<gdu>.sk1..12`), SD
card slots (no function). Displays from `sys.suite.displayList()` (`pfd1`, `mfd`, `pfd2`, `gtc1`, `gtc2`).

### 9.4 LH tilt panel (one plane with the gear module, ~30° × 110 mm; names EST)
| Group | Control | Type | Positions / values | Var |
|---|---|---|---|---|
| PRESSURIZATION | CABIN DUMP | red-guarded toggle | NORM 0 / DUMP 1 | `ac.m2.cabin_dump` |
| | AIR SOURCE SELECT | rotary | OFF 0 / L 1 / BOTH 3 / R 2 / EMER 4 / FRESH AIR 5 (EST) | `ac.m2.press_source` |
| WINDSHIELD | W/S BLEED L, R | pointer rotaries (white arc) + green flow lights | OFF 0 / LOW 1 / HI 2 | `ac.m2.ws_bleed1_sw`, `ws_bleed2_sw`; lights `ac.m2.ws_bleed1_lt/2` |
| | W/S ALCOHOL | guarded toggle | OFF 0 / ON 1 | `ac.m2.ws_alcohol_sw` |
| ICE PROTECTION | P/S HEAT; L, R WING/ENG | toggles + green lights | P/S OFF 0 / ON 1; WING/ENG OFF 0 / ENG 1 / WING/ENG 2 (525AFM-06 p.3-99) | `ac.m2.pitot_static_sw`, `eng_ai1/2_sw`; lights `ac.m2.ps_heat_lt`, `ai1/2_lt` (EST mapping) |
| | TAIL (de-ice) | 3-pos (MAN spring) | MAN −1 / OFF 0 / AUTO 1 | `ac.m2.tail_deice_sw` |
| FUEL BOOST | L, R | 3-pos toggles | OFF −1 / NORM 0 / ON 1 (CAE p.5-30) | `ac.m2.boost1_sw`, `boost2_sw` |
| TEMP (next to the gear module) | CONTROL | toggle | AUTO 0 / MAN 1 | `ac.m2.temp_mode` |
| | MANUAL | 3-pos spring-centre (position dots) | COLD −1 / • 0 / HOT 1 | `ac.m2.temp_man` |

### 9.5 LANDING GEAR control module (inboard end of the LH tilt face)
| Control | Type | Values | Var |
|---|---|---|---|
| Gear handle (translucent knob, lit red while in transit / unsafe, EST CJ family) | 2-pos lever, locked DN on the ground (`gear.handle_lock`) | UP 0 / DN 1 | `ac.m2.gear_handle`; lamp `ac.m2.gear_unsafe_lt` |
| 3 green lights (triangle) | indicators | — | `gear.green0..2` |
| ANTI-SKID | toggle (right edge) | OFF 0 / ON 1 | `ac.m2.antiskid_sw` |
| HORN SIL | push button (momentary; location EST, not confirmed) | — | `ac.m2.gear_horn_sil` |
| AUX GEAR CONTROL placard | static (EST wording) | — | — |

### 9.6 RH tilt panel (two rows; photos)
| Group | Control | Type | Values | Var |
|---|---|---|---|---|
| LIGHTS | NAV | toggle | OFF / ON | `ac.m2.nav_lt` |
| | ANTI-COLL | 3-pos | OFF 0 / BCN 1 / ALL 2 | `ac.m2.anti_coll` |
| | LDG / RECOG | 3-pos | OFF 0 / PULSE 1 / ON 2 | `ac.m2.landing_lt` |
| | TAXI, TAIL, WING INSP | toggles | OFF / ON | `ac.m2.taxi_lt`, `logo_lt`, `wing_insp_lt` |
| | EMER LTS | 3-pos | OFF 0 / ARMED 1 / ON 2 | `ac.m2.emer_lts_sw` (M2 flows; EST location) |
| COMM / RECORDERS | EMER COMM | guarded toggle + green light | NORM 0 / EMER 1 (COM1 121.5) | `ac.m2.emer_comm`; light `ac.m2.emer_comm_lt` |
| | ELT | 3-pos (RESET spring) + green light | RESET −1 / ARM 0 / ON 1 | `ac.m2.elt_sw`; light `ac.m2.elt_lt` |
| | EVENT | round push button | momentary | `ac.m2.event_marker` |
| | CVR TEST | push button | momentary | `ac.m2.cvr_test` |
| | HOURS | flight hour meter | — | — |
Map lights: a dimmer on each overhead reading-light fixture (`ac.m2.map_lt1/2`, EST).

### 9.7 Pedestal (silver shroud, black lower pedestal)
| Control | Type | Values | Var |
|---|---|---|---|
| GTC 570 ×2 (115 × 181 mm) | touch screen; map knob/joystick, centre knob, dual knob on one line | events per `g3000Controls()` | `g3k.gtc1.*`, `g3k.gtc2.*` |
| Phone tray with USB outlets | static | — | — |
| ENGINE START L / DISENGAGE / R | three abutting square buttons on the sloped aft face of the shroud, legends above | momentary | `ac.m2.start1`, `start2` (lit `ac.m2.start1_lt/_2`), `start_diseng` |
| Throttles L, R | short levers, horizontal grips; slots TO / CLB / CRU / IDLE / OFF | OFF −0.1 / IDLE 0 / CRU 0.62 / CLB 0.82 / TO 1.0 | `ac.m2.tla1`, `tla2` |
| TO/GA | button on the LH throttle | momentary | `ap.toga` |
| FLAPS handle | follow-up lever 0–35 (push-down gate at T.O. & APPR 15°, lift gate at LAND 35°), GROUND FLAPS 60° – GROUND USE ONLY | 0 … 1 (15°) … 2 (35°) / 3 | `ac.m2.flap_handle` → `ac.m2.flap_lever_cmd` (38° switch) |
| SPEED BRAKE | small lever in a fore-aft slot, LH lower quadrant face | RETRACT 0 / EXTEND 1 | `ac.m2.speedbrake` |
| Elevator trim wheel + indicator | wheel | −1 ND … +1 NU | `ac.m2.pitch_trim` |
| Rudder trim knob, aileron trim knob | pointer knobs on the aft face of the black lower pedestal (rudder above aileron, EST) | −1 … +1 | `ac.m2.rud_trim`, `ail_trim` |
No ignition switches on the pedestal (S&D15 §10.2.D; AOPA Mar 2014): see §9.10.

### 9.8 Control wheels (both), pedals, armrests
| Control | Var / event |
|---|---|
| Pitch trim split switch (outboard horn top): ARM and direction halves | `ac.m2.yoke_trim_arm1/2`, `ac.m2.yoke_trim1/2` (−1 / 0 / +1) → `ac.m2.yoke_trim_cmd`; keyboard `input.pitch_trim_rate` |
| AP/TRIM DISC (red, outboard horn) | event `ap.disc` + held `ac.m2.ap_trim_disc1/2` (interrupts electric / AP trim) |
| CWS (white-ringed button on top of the inboard horn) | event `ap.cws` { pressed } |
| Hub shroud with CITATION M2 plaque; hand microphone on each column | static (SCOPE: hand-mic key not modelled) |
| PTT under each armrest | `ac.m2.ptt1/2` → `g3k.audio<n>.tx` (COM field shows TX; SCOPE: no transmission model) |
| Rudder pedals + toe brakes | `input.yaw`, `input.brake_left/right` (nose steering ±20°) |

### 9.9 Below the panel / misc
Handles on a narrow lip under the LH tilt panel (no knee panel; photos pin1 / S&D21 Fig 3 / Jetcraft).
| Control | Type | Values | Var |
|---|---|---|---|
| AUX GEAR T-handle (red) | T-handle below the gear module | 0 / 1 | `ac.m2.gear_emer` |
| GEAR BLOW DOWN (red) | pull knob | 0 / 1 | `ac.m2.gear_blowdown` |
| PARKING BRAKE | pull handle | 0 / 1 | `ac.m2.park_brake` |
| EMERGENCY BRAKE | pull handle (proportional) | 0..1 | `ac.m2.emer_brake` |
| CONTROL LOCK | handle below the pilot's panel | 0 stowed / 1 engaged | `ac.m2.control_lock` |
| RAIN DOORS L / R | levers | 0 / 1 | `ac.m2.rain_door1/2` (EST: two levers per S&D21 §9.7.2 "rain doors"; CJ1 AFM describes one handle; no M2 photo; no CAS message) |
| Crew O₂ masks | stowage doors / regulator | on 0/1; NORMAL 0 / 100 % 1 / EMER 2 | `ac.m2.mask1_on`, `mask1_mode` (…2) |
| Doors (ground menu/exterior) | cabin, emergency exit, nose baggage L/R, tail baggage | 0 closed / 1 open | `ac.m2.door_<id>` |
| GPU | ground-services menu | 0 / 1 | `ac.m2.gpu_connected` |

### 9.10 GTC Aircraft Systems controls (G3000-run functions; AOPA Mar 2014, Twin & Turbine, S&D21 §10.3.2)
| Page | Control | Values | Var / event |
|---|---|---|---|
| FUEL | L / R BOOST (mirror of the tilt switches), TRANSFER | OFF/NORM/ON; L TANK / OFF / R TANK | `ac.m2.boost1/2_sw`, `ac.m2.fuel_xfer` |
| PRESSURIZATION / ECS | LDG ELEV, CABIN TEMP, TEMP MODE, A/C, CABIN FAN, DEFOG, PRESS MODE, CABIN UP / DN | … | `ac.m2.ldg_elev_ft`, `temp_sel`, `temp_mode`, `air_cond_sw`, `cabin_fan`, `air_distrib`, `press_mode`; events `ac.m2.press_man_up/dn` (1 s valve drive each; UP = cabin climbs, DN = cabin descends) |
| CABIN | PASS SAFETY, CABIN LTS, PASS OXY | OFF/BELT/BELT & NS; on/off; CREW ONLY/NORM/MAN DROP | `ac.m2.pax_safety`, `cabin_lt`, `pax_oxy` |
| ENGINE | L / R IGNITION | NORM 0 / ON 1 | `ac.m2.ign1_sw`, `ign2_sw` (SCOPE: page layout EST) |
| SYSTEM TESTS | TEST (cycle), FIRE WARN, ANNU, TAWS | OFF 0 / FIRE WARN 1 / ANNU 2 / STALL 3 / O'SPEED 4 / LDG GEAR 5 / TAWS 6; returns to OFF after 10 s (EST) | `ac.m2.test_sel` |

## 10. Normal procedures (`checklists.ts` M2_NORMAL)
Sources: CJ-family AFM 525AFM-06 Section III normal procedures (pp.3-83..3-94) and the operator M2 flows
("Geoffs M2 Flows", 525-962), adapted to the M2 hardware (no avionics master or ignition switches; ignition, system
tests, fuel transfer and pressurization on the GTC; throttle cut-off labelled OFF; AIR SOURCE SELECT L / BOTH / R /
EMER / FRESH AIR). Lists follow the AFM phases; items with live auto-checks read the systems vars (action sequences
read the latches of `systems/procedures.ts`: GTC system tests run, CVR / mask test, electrical, trim and AP
disconnect checks, all breakers in).
1. **Preflight inspection**: battery connected, forward pressure gauges (oxygen, emergency brake bottle), covers,
   exterior doors locked.
2. **Cockpit preparation**: control lock, parking brake SET, throttles OFF, gear DN, circuit breakers IN (live),
   emergency gear / blow down stowed, air source BOTH, ice protection OFF, oxygen pressure / PASS OXY NORM, crew mask
   PRESS TO TEST and stowed, BATTERY DISCONNECT DISC → BATTERY BATT (no voltage) → DISCONNECT NORM (≥ 24 V),
   external power as required, EMER LIGHTS ARMED, STBY FLT DISPLAY TEST/ON, BATTERY EMER (emergency bus items) →
   BATT, GTC SYSTEM TESTS all items (FIRE WARN, ANNU, STALL WARN, O'SPEED, LDG GEAR, TAWS), CVR TEST, takeoff data
   computed, fuel checked / balanced, ATIS / clearance, altitude select, FMS program.
3. **Before starting engines**: parking brake, cabin door / emergency exit, passenger briefing, AIR CONDITIONING OFF,
   engine instruments, fuel balanced, external power disconnected (battery start), DISPATCH OFF, BATTERY BATT
   (avionics on), GEN switches GEN, boost NORM, engine-off CAS displayed, ignition NORM (GTC), beacon ON.
4. **Starting engines**: either engine first (the downwind engine on a battery start in a crosswind); ENGINE START →
   START annunciated; throttle IDLE at 8 % N2 minimum with N1 rotation; ITT rise within 10 s (abort if none or ITT
   rapidly approaching 1,000 C; FADEC auto-aborts HOT / HUNG / NO LIGHT); second engine; fuel / oil / generator /
   hydraulic annunciations extinguished (525AFM-06 p.3-88); oil pressure; DC amps and volts.
5. **Electrical check** (M2 flows): L GEN OFF (GENERATOR OFF L, R amps increase), R GEN OFF (GEN OFF L-R, battery
   24 V), L GEN ON, R GEN ON (amps within 20 A, 28-29 V), BATTERY OFF (systems remain on), BATTERY BATT.
6. **Before taxi**: A/C fan or auto, PASS SAFETY, GROUND FLAPS / speed-brake check (525AFM-06 p.3-89.1), trim check
   (each split-switch half alone gives no trim, AP/TRIM DISC stops trim) and 3 trims set, AP disconnect test, flight
   controls, engine anti-ice, altimeters x3 set, transponder, pressurization DEST FIELD ELEV (GTC or FMS), air source
   BOTH, anti-skid ON, GA button PUSH (FD TO), avionics / FMS, V-speeds / TOFL / weights confirmed, CAS.
7. **Taxi**: parking brake RELEASE, exterior lights, brakes, nosewheel steering, flight instruments.
8. **Before takeoff**: ice-protection check if icing expected (COLD displayed then clear within 60 s), passenger
   seats, flaps 15 or 0 per TOLD, speed brakes retracted, 3 trims set, crew briefing, TCAS TA/RA, radar, anti-ice,
   P/S heat ON, XPDR ALT, landing lights ON / anti-coll ALL, CAS (no warnings or cautions).
9. **Takeoff**: throttles TO, engine instruments, brakes release, VR.
10. **After takeoff / climb**: gear UP, flaps 0 (V2 + 10), throttles CLB, YD / pass safety / anti-ice as required,
    landing lights OFF, pressurization, at 18,000 ft altimeters 29.92 x3 and oxygen masks checked.
11. **Cruise**: CRU detent (FPG maximum cruise thrust), fuel balance, ice protection, systems / CAS.
12. **Descent**: pressurization destination field elevation, windshield defog / ice protection as required,
    altimeters QNH x3 at 18,000 ft, landing data (VREF posted), exterior lights.
13. **Approach**: landing data, briefing, minimums, FUEL TRANSFER OFF, anti-skid ON, flaps 15, seats / belts,
    PASS SAFETY, CAS.
14. **Before landing**: gear DOWN 3 green, flaps 35, speed brakes retracted before 50 ft, pressurization zero
    differential (< 0.5 psi by touchdown), airspeed VREF, AUTOPILOT AND YAW DAMPER OFF (CJ limitation), landing
    lights ON (not PULSE).
15. **Landing**: throttles IDLE, brakes, GROUND FLAPS (speed brakes deploy).
16. **All engines go-around** (M2 flows): GA button (FD GA), throttles TO, pitch 7.5°, flaps 15, gear UP with
    positive climb, flaps 0 at VAPP + 10, yaw damper ON, autopilot as desired.
17. **After landing**: P/S heat OFF, flaps 0, speed brakes retracted, radar standby, landing lights OFF / strobes off.
18. **Shutdown**: parking brake, all ice protection OFF, throttles OFF after ITT stabilized at minimum for 2 min
    (525AFM-06 p.3-94), A/C and fan OFF, beacon OFF after N2 decays, exterior lights, PASS SAFETY, cabin lights,
    EMER LIGHTS, STBY FLT DISPLAY, DISPATCH, BATTERY OFF (generator switches stay at GEN), control lock.
19. **Quick turnaround** (EST abbreviation): parking brake, battery, fuel, oxygen, TOLD / FMS, then Before starting.

### 10.1 Emergency and abnormal procedures (`checklists.ts` M2_EMERGENCY / M2_ABNORMAL)
Emergency (phase "Emergency"; wording from 525AFM-06 Section III and the CJ1 (Model 525) memory items):
- **ENG FIRE LH or RH** (p.3-9): throttle (affected) IDLE; if the light remains ENGINE FIRE button LIFT COVER and PUSH;
  either illuminated BOTTLE ARMED PUSH (memory items); ignition NORM (GTC); throttle OFF; reduce electrical load
  (300 A max); FUEL BOOST OFF then NORM; land as soon as possible; remaining bottle after 30 s if the light remains.
- **Engine failure or fire or master warning during takeoff** (below V1: brakes, throttles IDLE, speed brakes EXTEND;
  above V1: continue, V2, gear up, flaps up at 400 ft); **engine failure / precautionary shutdown**; **engine failure
  during final approach**; **emergency restart** one and two engines (ignition ON, boost ON, throttles IDLE, 240 KIAS);
  **OIL PRESS L or R** (EST).
- **Electrical fire or smoke** (p.3-17: masks DON / EMER, PASS OXY MANUAL DROP, AIR SOURCE BOTH; unknown source flood
  lights full bright, BATTERY EMER, GENs OFF); **environmental smoke or odor** (masks EMER, AIR SOURCE L, R, FRESH AIR);
  **smoke removal** (p.3-21: A/C OFF, CABIN DUMP).
- **CABIN ALT** (p.3-23: masks 100 %, emergency descent, passenger oxygen, XPDR 7700, AIR SOURCE EMER if not arrested
  by 15,000 ft) and **emergency descent** (AP/TRIM DISC, throttles IDLE, speed brakes EXTEND, moderate bank, ~15° nose
  down (CJ1 memory item; the CJ2 AFM gives 20°), MMO/VMO, 7700, PASS SAFETY, 15,000 ft or MSA).
- **BATT O'TEMP** (p.3-24/25: BATTERY EMER, then OFF on decrease, BATT DISC if the relay is stuck); **GEN OFF L-R**
  (RESET / GEN, then BATTERY EMER); **autopilot malfunction**; **electric elevator trim runaway** (AP/TRIM DISC,
  manual trim, PITCH TRIM CB pull); **emergency evacuation** (parking brake, throttles OFF, both ENG FIRE, bottles,
  battery OFF, ELT, exit).
Abnormal (phase "Abnormal", EST CJ-family wording): fuel transfer (boost OFF on the receiving side, arrow toward the
light tank), landing gear emergency extension (T-handle free fall, then blow down), hydraulic failure, ANTISKID INOP,
single-engine approach and landing.
`M2_CAS_CHECKLIST` maps the CAS messages (CABIN ALT, BATT O'TEMP, GEN OFF L-R, FUEL IMBALANCE, ANTISKID INOP,
HYD PRESS LOW, GEAR UNSAFE, PITCH TRIM, AP FAIL) to their lists; the G3000 consumes it (`casChecklists` config):
opening the GTC Checklist screen with such a message active pre-selects the linked electronic checklist. The engine-failure, fire and evacuation paths are
exercised end to end in `failures.test.ts` and `fixround1-procedures.test.ts`.

## 11. Simulation model summary and verification
- FDM (`fdm.ts`): CL tables tuned to FPG stall speeds (±2 %), drag/lapse/TSFC to the FPG
  high-speed cruise table (TAS ±1 %, FF ±1 % at FL330-FL410); climb at 220 KIAS / M0.60 matches the FPG
  time/fuel/distance table (FL250 9.0 min / 241 lb / 41 nm vs 9 / 242 / 41; FL410 ~22 min / 456 lb / 115 nm vs
  24 / 437 / 113, from 1,500 ft), inertia from Roskam radii of gyration, gear at FS 264.7 (EST), tail strike ~13°.
- Tests (`tests/aircraft/citation-m2`): cold & dark start; takeoff (AEO ×1.15 ≈ 3,200 ft, OEI at V1
  ≈ 3,290 ft vs BFL 3,210); climb; cruise FL330/FL410; stall speeds; overspeed; coupled ILS to DA;
  generator / hydraulic / fire / decompression failures; state presets.

## 12. Known gaps / SCOPE
- Exact AFM CAS wording, switch labels on the tilt panels, and several thresholds are EST (CJ family).
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
emergency lighting battery pack (EMER LTS switch OFF / ARMED / ON added in fix round 1: the M2 flows list
"EMER LIGHTS SWITCH - ARMED / OFF"; CAE CJ-family differences p. 5-17 says the CJ/CJ1/CJ2 have none; the
M2-specific source is followed). Not fitted, so not built: wipers (rain doors),
electric windshield heat (bleed air), dome / storm lights, cockpit
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
(the FILUM hold-in-lieu is removed on the GTC for the straight-in; FILUM stays in the route), W&F within 300 lb of the FDM,
TOLD V1/VR/V2 96/100/107 and BFL 2,860 ft at 9,900 lb; taxi and line-up on the centre line; TO/GA
-> FD TO/TO; TO detent N1 ~101.7 %, lift-off ~113 KIAS in ~1,970 ft (inside BFL/1.15); AP at > 450 ft
(PIT/ROL, YD on), NAV -> FMS, flaps up at V2+10, CLB detent, FLC, VNAV armed (VPTH); FL230 in ~8 min
(FPG FL250 9 min at MTOW), no cautions, cabin on schedule; cruise at the CRU detent limited to 255
KIAS (359 KTAS, ~1,070 lb/h; FPG FL250 max cruise 377 KTAS / 1,122 lb/h) with the tanks decrementing at
the engine flow; VPTH descent, baro STD / QNH at FL180; landing TOLD (VREF 107); flaps 15, APR ->
LOC/GS armed, LOC then GS capture, gear down, flaps 35, VREF+5 stabilized at 1,000 ft within 0.5 dot;
AP + YD off at the 200 ft DA; hand-flown flare, touchdown ~1,100 ft past the threshold; ground flaps
60 deploy the speed brakes; stop inside the FPG landing distance; taxi clear; shutdown (throttles
OFF, no warnings, displays off, buses dead). Block ~39 min, ~510 lb fuel.

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
- ~~Shared nav library: an approach transition that starts with a hold-in-lieu-of-PT (HF) leg lost the leg
  into the IAF~~ — fixed in fix round 1 (procedures lens, §19): the loader keeps an IF/TF into the IAF ahead of the
  hold, and removing the hold on the GTC leaves FILUM in the route.
- Cockpit lighting (shared renderer): surfaces in shadow get almost no sky fill light, so white panel
  legends in the glareshield's shadow are hard to read in daylight (every aircraft shows it).
- G3000 (shared): the MFD navigation map defaults to relative terrain, which paints the whole map red
  on the ground.

## 16. Check-airman pass (verification, second round)

**Found and fixed**
- *Climb schedule.* The FDM was not climbing 25 % "too hungry": the tests flew the CJ4 schedule (240 KIAS / M0.64). The
  FPG "cruise climb" is matched within ~5 % in time, fuel and distance at every tabulated level by **220 KIAS / M0.60**
  (AOPA: the M2 VNAV profile defaults to 200 or 220 KIAS). The G3000 FMS speed schedule, the performance test (now asserting
  time / fuel / distance to FL150 ... FL410) and the check ride use it. Vmo-limited high-speed cruise at 5,000 / 15,000 /
  25,000 ft is also asserted against FPG p.22 (fuel flow -6 / -2 / -1 %).
- *Ramp pressurization.* On every ground preset the cabin started 1.2 psi above ambient (-2,100 ft cabin): `settle()` computed
  the cabin air mass at a stale 0 degC cabin temperature and in the in-flight branch (squat switch not yet published). Even when
  settled, the outflow valve alone left 0.16 psi with the packs flowing at idle. Fixed in `states.ts` (temperature and squat
  switch before `settle()`) and by holding the safety valve open on the ground (shared additive option, below). The EIS LFE read
  "-10000" with no destination because the "not entered" sentinel reached the controller as the landing elevation, which would
  also have driven the descent schedule towards max differential; it now falls back to the takeoff field. New test
  `pressurization.test.ts`; the check ride asserts < 0.08 psi on the ramp before takeoff and after landing.
- *MFD map.* Navigation maps default to Absolute (topographic) terrain; the suite's TAWS-B default (Relative) painted the whole
  map red on the ground (EST default; the TAWS pane stays Relative).
- *Render budget.* Blank bezel softkeys no longer create a legend mesh (shared `KeyPad`): cockpit 601 -> 565 draw calls; the
  guard is now < 600.
- *Legibility.* Tilt-panel switch legends 2.4 -> 2.8 mm, group titles 2.4 -> 2.8 mm, knob position legends 1.9 -> 2.2 mm.

**Shared-library changes (additive)**
- `src/systems/pressurization/types.ts` / `Pressurization.ts`: optional `safetyValveOpen` binding (default false: no change for
  other aircraft).
- `src/cockpit/controls/KeyPad.ts`: a key whose legend is blank/whitespace gets no label mesh (nothing was drawn before either).

**Still open**
- Remaining ~565 draw calls are mostly moving parts: 63 breakers (cap + rating legend each), GMC 710 / softkeys. Instancing
  them needs a shared `CircuitBreaker` / `KeyPad` instancing path.
- Panel legends in the glareshield's shadow remain dim by day (shared renderer fill light, §15).
- The HF-leg nav-library gap in §15 was fixed in fix round 1 (§19).

## 17. Fix round 1 — layout lens (M2-L01 … L44, F26/F47/F52/F57/F60, PROC-05/11/12/15/16)
- **Glareshield**: GCU 275 ×2 replace the 3-knob DCUs (MINS knob removed; minimums on the GTC PFD page);
  upper centre DIMMING / reversion panel above the GMC 710 (two NORM/REV rotaries, FLOOD LTS / PANELS with DAY /
  DISPLAYS / TOUCH CONTROLS); GMC 710 re-laid out in its six sections at 241 × 42 mm with PUSH SYNC / PUSH CTR;
  ENG FIRE (32 × 27 mm, clear flip cover) stacked over BOTTLE ARMED; MW outboard / MC inboard on both sides;
  landscape ESI-1000 with M / S / − / + bezel keys and a menu; photocell fitting at the brow centre.
- **Centre post**: compass on the glareshield top at the post base, eye-reference T above it flanked by the
  orange ice-detection lights; the "Overhead" view became "Compass / centre post".
- **Shell**: hood lofted as a plan-view arc clamped to the lining; main, glare and tilt panel plates follow the
  lining (fit.ts); light grey centre post / pillars / header, lighter headliner; four low-intensity brow floods.
- **Instrument panel**: GDU bezels 362 × 248 mm at 0.369 m; ELECTRICAL POWER panel 100 × 110 mm (with STBY FLT
  DISPLAY) under the registration plate and limitations placard; RH edge registration plate only.
- **Tilt panels**: ~30° / 110 mm band, gear module coplanar with a seam; controls per §9.4–9.6 with green
  status lights; hardware duplicates of G3000 functions moved to GTC pages (§9.10); handles on a lip under the
  LH tilt panel (knee panel removed).
- **Pedestal**: silver shroud / black lower pedestal, GTC 570 at 115 × 181 mm with a phone tray and USB,
  ENGINE START row with engraved legends, OFF / flap / speed-brake legends per the quadrant photo, short levers
  with horizontal grips, trim knobs on the lower pedestal aft face; no ignition switches.
- **Systems**: STBY FLT DISPLAY OFF/ON/TEST, BATTERY DISCONNECT relay, FUEL BOOST OFF, AIR SOURCE BOTH /
  FRESH AIR, EMER LTS OFF/ARMED/ON, TOUCH CONTROLS dimmer, PTT → COM TX, gear-handle lamp, GTC SYSTEM TESTS /
  ENGINE / CABIN pages. Tests: `tests/aircraft/citation-m2/fixround1.test.ts`, `cockpit-main/controls.test.ts`.
- **Open / EST**: exact M2 tilt-panel legends (no legible reference found); HORN SILENCE location;
  GCU 275 key logic follows G1000-family practice (pilot's guide not public). The shared bizjet yoke horn
  height and the seat inboard-armrest fit were fixed in round 2 (§20).

## 18. Fix round 1 — function lens (M2-L13/L14, M2-F01 … F59, M2-PROC-02 … 35)
Tests: `tests/aircraft/citation-m2/fixround1-function.test.ts` (37 cases, each fails without its fix).
- **Electrical**: no AVIONICS switch; BATTERY BATT closes the avionics relays; ELECTRICAL POWER panel L GEN |
  BATTERY (red cap) | R GEN over DISPATCH (amber LED) | STBY FLT DISPLAY; DISPATCH = MFD + GTC 1 + GIA 1 (+ audio 1,
  EST) from the aux battery; EMER bus per the M2 flows / CAE p.5-25 list (XPDR split into XPDR 1 EMER / XPDR 2 AVN 2,
  audio 2, flood lights, R P/S heat, AFCS panel on EMER; ADC 1 / AHRS 1 / AP servos lost on EMER; PFD 1 reverts to
  ADC 2 / AHRS 2 and to the reversionary format automatically); aux battery supports EMER and AVN 2 during starts;
  inverter off in EMER; battery-only airstarts; SPD BRK breaker; GEN AMPS limits scheduled.
- **CAS**: power from the GIAs; CJ-family texts; engine-off GEN / OIL / FUEL LOW PRESS / HYD FLOW LOW posted
  without master before start and extinguishing during it, with masters when running or airborne; GEN OFF L-R
  warning ("GENERATOR FAIL"); BATT O'TEMP voices and >160; takeoff / landing inhibits; FLAPS >35, T/O CONFIG,
  FUEL FLTR BYPASS, W/S AIR O'HEAT, PRESS SOURCE FAIL, TAIL DE-ICE LOW TEMP (EST), anti-ice COLD L / R / L-R and
  ON advisories, white HYD PRESS ON advisory; IGNITION moved to a green IGN legend on the ITT scale; no
  RAIN DOOR / BATT DISCHARGE-on-ground nuisance messages.
- **Fuel**: transfer direction per the selector arrow, no transfer with the receiving pump on, 600 lb/h; boost
  NORM low-pressure latch.
- **Pneumatic / pressurization / oxygen**: bleed source valves fail open (selector unpowered = BOTH); automatic
  EMER pressurization 14,500 / 13,500 ft; dump needs DC, works in MANUAL, limit valves at 14,500 ft; CABIN ALTITUDE
  9,500 ft (14,500 ft high-field mode); masks 14,500 ft; differential-limited schedule with the departure field
  held; in-air presets take the nearest airport elevation; ramp differential < 0.01 psi.
- **Ice**: per-side WING/ENG switches, wing valve off below 75 % N2, warm-up / cool-down COLD logic (ground check
  shows COLD then clear), L-then-R boots with a 3 min dwell and MANUAL both, W/S overheat model, 10 min alcohol.
- **Flight controls / gear / brakes**: speed brakes retract at high thrust even with ground flaps and redeploy at
  idle; 38° flap switch; follow-up flap handle with gates; split trim switch + pilot priority; AP/TRIM DISC holds
  off electric / AP trim; yoke trim disconnects the AP; AFCS sensor validity follows the coupled side;
  blow-down only after the T-handle (free fall first); horn on ADC 2 and in the LDG GEAR test; anti-skid self
  test; finite emergency brake bottle; SPD BRK EXTEND at full extension.
- **Engines / lights / comm**: FADEC continuous ignition with engine anti-ice, on approach (gear down) and 8 s
  after touchdown; beacon during START; PULSE alternates the landing lights; EMER COMM holds COM 1 on 121.5;
  ADCs valid at once after in-air presets.
- **Shared-library additions** (additive, defaults unchanged): Pressurization `dumpAllModes`, `dumpPower`,
  `dumpLimitFt`, `cabinAltWarnFtBinding`, `departureFieldFt`; Flaps `continuous`; LandingGear
  `alternate.freefallTrigger`, `horn.test`; Afcs `disconnect.trimInputs`; G3000 EIS ITT `ignVar`.
- **Open / EST**: exact M2 G3000 CAS wording (M2 AFM not public); the third second-row switch on the ELECTRICAL
  POWER panel; M2 windshield control set (L / R W/S BLEED knobs kept) and rain-removal handle count; throttle
  high-thrust switch position (EST just above CRU); W/S temperature, boot inflation, anti-ice warm-up, emergency
  brake bottle and anti-skid test timings; the yoke split switch halves are separate cockpit controls, so mouse
  trim from the yoke needs both halves (keyboard trim unaffected).

## 19. Fix round 1 — procedures lens (M2-L42/L43, F27/F49/F61/F62/F63, PROC-01/06/07/08/17…25/32…34)
Tests: `tests/aircraft/citation-m2/fixround1-procedures.test.ts` (12 cases, each fails without its fix); the check ride
no longer works around the hold-in-lieu.
- **Checklists** (§10 / §10.1): AFM phase structure (preflight, cockpit preparation, before start, start, electrical
  check, before taxi, taxi, before takeoff, takeoff, after takeoff / climb, cruise, descent, approach, before landing,
  landing, all-engines go-around, after landing, shutdown, quick turnaround); 18 emergency and 5 abnormal lists with
  live checks; CAS → checklist map. New latches `ac.m2.sys_tests_done`, `cvr_tested`, `mask_tested`, `cb_all_in`,
  `elec_check`, `trim_check`, `ap_disc_tested` (`systems/procedures.ts`, cleared by every preset).
- **Presets**: cruise sets both throttles in the CRU detent (the required-N1 bisection saturated at TO, N1 104.4 %);
  at FL370 / 396 KTAS the FDM holds 390-399 KTAS at N1 ~99.6 %. In-air presets put all three altimeters on STD above
  the transition altitude (nearest airport's value, else 18,000 ft). In-air presets take the departure / landing
  field elevation from the nearest airport (done in the function round; asserted again here).
- **Approach preset** keeps the gear DOWN and YD ON (PROC-33, intended): it starts 10 nm out at 3,000 ft AGL, i.e.
  at glideslope intercept (3° ≈ 318 ft/nm → ~9.4 nm), where the M2 flows put the gear down; the Before landing list
  still has flaps 35, VREF, zero differential, AP / YD OFF and landing lights to fly.
- **Shared-library change (additive)**: `src/nav/flightplan/FlightPlan.ts` `setApproach` inserts an IF leg (becomes
  TF, flagged IAF, constraints copied) to the hold fix when an approach transition starts with an HF / HA leg; plans
  without such a transition are unchanged (tests/nav pass). KICT-KOKC now 140 nm to destination (148.9 nm with the
  hold, 132 nm straight-in) instead of 88 nm.
- **Open / EST**: the G3000 electronic checklist (shared) lists every list with its phase but does not open a list
  from a CAS message (`M2_CAS_CHECKLIST` is data only); abnormal wording for gear extension, hydraulic failure,
  anti-skid, OIL PRESS and single-engine restart is CJ-family EST (525AFM-06 pages not reviewed); the "Microphone
  select MIC OXY MASK" items have no switch in the sim (audio SCOPE); oxygen "pressure checked" uses the 400 psi LOW
  threshold (dispatch minimum depends on the flight, AFM Section IV not public).

## 20. Fix round 2 — layout lens (M2-L36, M2-L40, M2-NEW-01)
Tests: `tests/aircraft/citation-m2/fixround2.test.ts` (geometric checks, each fails without its fix).
- **M2-L36 — tall ram's-horn control wheels**: the shared bizjet yoke gained an additive `styleOpts`
  profile parameter (`src/cockpit/geometry/yokes.ts` `YokeStyleOpts`: `gripTop`, `gripLean`; defaults
  reproduce the original M-wheel exactly for the other jets). The M2 sets `gripTop 0.12 / gripLean 0.018`
  (EST from the S&D15 Fig III / S&D21 Fig 3 photographs), so the horns rise well above the hub with a slight
  inward cant; the grip-top switch anchors (trim split switch, CWS) and drag hit boxes follow the taller horns.
- **M2-NEW-01 — seat armrests vs pedestal**: the shared jet seat gained an additive armrest option
  (`src/cockpit/geometry/structure.ts` `SeatGeometryOpts`: raise / length / aft shift / no support posts;
  defaults unchanged). The M2 uses `M2_SEAT_ARMREST` (shell.ts: raised 3 cm, 0.28 m long, shifted 10 cm aft,
  fold-down without posts, EST from the pin1 / S&D21 Fig 3 photographs), so the inboard armrests pass above
  the low aft console (top 0.46 m vs armrest bottom 0.515 m above the floor) and end short of the throttle
  quadrant's lever zone.
- **M2-L40 — legend legibility (shared renderer)**: closed by verification, no code change. The symptom did
  not reproduce: in the fresh day screenshots (`tests/output/citation-m2-r2/view_3.png`, `view_6.png`) the
  ELECTRICAL POWER panel legends (L GEN / BATTERY / R GEN / DISPATCH / STBY DISP) and the tilt-panel bracket
  legends (PRESSURIZATION / WINDSHIELD / ICE PROTECTION / FUEL BOOST / TEMP / LANDING GEAR / LIGHTS) are
  readable. Re-open only if a shared-renderer change regresses it.
