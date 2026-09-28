# Cessna Citation Longitude (Model 700): aircraft dossier

This is the contract for the Longitude cockpit, exterior and verification work.
It records the published data, the systems, the CAS list, the procedures and
the cockpit control inventory. Every control in the inventory has a SimVar in
`src/aircraft/citation-longitude/vars.ts` (`LON_VARS`), and a system in
`src/aircraft/citation-longitude/systems/**` reads it. The test
`states.test.ts › control audit` checks that no control is decorative.

Code: `src/aircraft/citation-longitude/` contains `data.ts`, `vars.ts`, `fdm.ts`, `systems/*`,
`createSystems.ts`, `states.ts`, `checklists.ts`, `inputMap.ts`, `meta.ts` and `performance.ts`.
Tests are in `tests/aircraft/citation-longitude/` (about 40 tests; the full-flight check ride in `verify/` alone takes ~75 s).

## 0. Sources (abbreviations used everywhere)

| Abbr. | Source |
|---|---|
| **FPG** | Textron Aviation, *Citation Longitude Flight Planning Guide*, FPG-JET-700-1019 (Oct 2019, rev. FM-00/PP-00). Specifications (p.2-3), V1/VR/V2 (p.4), takeoff field lengths (p.5-14), climb (p.15-16), cruise (p.17-19), descent (p.20), reserves and holding (p.21), landing and VREF (p.22-26), stall speeds (p.26), mission table (p.27-29). Mirrored at aviav.ru. |
| **OG** | *Cessna Citation Longitude Model 700 Operators Guide* (Working Title/Asobo, for MSFS; based on Textron data). Section 1 Operating Limitations, 2 Overview, 3 CAS list with inhibits, 4 Avionics, 5-16 systems, 17 Normal procedures. |
| **BCA** | J. Albright, "Pilot Report: Cessna Citation Longitude", *Business & Commercial Aviation*, March 2021 (code7700.com PDF). |
| **AOPA** | "Citation Longitude: Super-mid standout", *AOPA Pilot*, March 2021. |
| **AW** | Aviation Week, "Aircraft Overview: Cessna Citation Longitude" (TCDS summary). |
| **WIKI** | Wikipedia, "Cessna Citation Longitude" (wing area, sweep, certification dates). |
| **DGAC** | DGAC Chile, type-rating evaluation form "Textron Citation Longitude C700 CC-DRA" (2021, dgac.gob.cl): limitations card (weights, speeds, altitudes, external power 1,500 A / 26-30 V) and the emergency/abnormal checklist card (PITCH/ROLL DISCONNECT handle, MASTER DISCONNECT button). |
| **PAT** | Cessna patent US7229047 B1, "Aircraft roll disconnect mechanism": cable-operated disconnect handle within reach of both pilots. |
| **EST** | Estimate. The reasoning is given next to the number in the code. |

The FAA TCDS for the Model 700 was not available publicly on DRS during this work. The AW article quotes its key entries: engine AS907-2-1S, 7,665 lbf, 13 seats, 2,166 gal usable, Mmo 0.84 above 29,375 ft, FL450.

## 1. General, dimensions, weights

| Item | Value | Source |
|---|---|---|
| Type | Model 700 "Citation Longitude", super-midsize, 14 CFR Part 25. FAA TC 21 Sep 2019, EASA 13 Jul 2021 | FPG p.2, WIKI |
| Crew / seats | 2 pilots, up to 12 passengers (FAA 11 + 2 crew); typical 8 | OG 1-5, AW |
| Length / span / height | 73 ft 2 in (22.30 m) / 68 ft 11 in (21.00 m, over the winglets) / 19 ft 5 in (5.92 m) | FPG p.2 |
| Wheelbase / tread | 31 ft 7 in (9.62 m) / 9 ft 8 in (2.95 m) | FPG p.2 |
| Wing | 537 ft² (49.9 m²), aspect ratio 8.84, quarter-chord sweep 26.8° inboard and 28.6° outboard, no leading-edge devices, winglets | WIKI, BCA |
| Cabin | 25 ft 2 in (excluding the cockpit) × 77 in × 72 in, 755 ft³; baggage 112 ft³ / 1,115 lb (walk-in, aft) | FPG p.2 |
| Max ramp / takeoff / landing | 39,700 / 39,500 / 33,500 lb | FPG p.3, OG 1-1 |
| MZFW | 26,000 lb (FPG) / 26,800 lb (OG). The code uses 26,800 lb. | FPG p.3, OG 1-1 |
| Empty (typically equipped) / BOW (2 crew) | 23,200 / 23,600 lb | FPG p.3 |
| Usable fuel | 14,500 lb (6.7 lb/gal) in two wing tanks. AW: 2,166 gal / 14,511 lb. Single-point fuelling 14,300 lb, overwing 14,500 lb. | FPG p.3, AW, BCA |
| Payload | Max 2,400 lb; 1,600 lb with full fuel | FPG p.3 |
| Min weight in RVSM | 24,400 lb | OG 1-3 |

**FDM geometry (EST, `fdm.ts`).** The datum is the empty-weight CG, placed at 35 % MAC (was 30 % until the check-ride pass of §13: with the modelled stations every realistic loading then fell at 19-23 % MAC, forward of the 24-40 % MAC range of the OG 17-3 takeoff-trim chart; at 35 % loadings fall at 24-29 % MAC).
- MAC is 2.61 m (taper 0.30). The 25 % MAC reference point is 0.13 m ahead of the datum.
- Main gear x −0.85 m, nose gear +8.77 m, contact 1.88 m below the datum with the struts extended.
- Nacelles at x −4.3 m, y ±2.1 m, z −0.75 m. Wing tanks at (0.2, ±3.3, 0.6) m.
- Crew seats at x +7.4 m. Aft baggage at −3.4 m.
- Tail strike at about 12.5° of pitch on the main wheels.
- Inertia: Roskam radii of gyration, Ixx 78,000, Iyy 133,000, Izz 238,000 kg·m² at empty weight.

## 2. Powerplant: Honeywell HTF7700L (AS907-2-1S) ×2

| Item | Value | Source |
|---|---|---|
| Takeoff thrust | 7,665 lbf SL static, flat rated to 34 °C (93 °F). OG gives ISA+18.9; BCA says ISA+14. | FPG p.2, AW, OG 7-2 |
| FADEC | Dual-channel. Auto start, synchronization, thrust modes TO / CLB / CRU / APR / T/R. Powered by an engine alternator. | OG 7-2, 7-7, BCA |
| Limits | TO/APR: 5 min (10 min OEI), ITT 955 °C, N2 98.62 %, N1 96.79 %. CLB continuous: ITT 950 °C, N2 98.22 %, N1 96.49 %. Transient N2 99.90 % (20 s). Start ITT 650 °C. | OG 1-3 |
| Start limits | EIS start pressure ≥ 32 psi. Max ground-start tailwind 16 kt. Three starts, then 15 min cooling. Dry motor > 20 s counts as one start. Continuous motoring ≤ 5 min, then 15 min cooling. | OG 1-3 |
| Starter | Air-turbine starter on APU or cross bleed. Start time < 30 s. | OG 7-2, BCA |
| Reversers | Pivot-door type, hydraulic (L on hyd A, R on hyd B). The FADEC reduces reverse from 85 KIAS to idle by 45 KIAS. Reverse must be at idle by 45 KIAS. No reverse on touch-and-go or to back up. | OG 7-2, 1-6, BCA |
| Thrust levers | Continuous, no detents. The FADEC picks TO (full forward), CLB and CRU by range. TO/GA button on the outboard side of each handle. A/T disconnect on the front of each handle. A/T arm button aft on the lever arm. Reverser levers are lifted, then the throttles are pulled aft. | OG 7-3/7-4, BCA |

FDM model (EST unless noted):
- N1 of 91.5 % gives 7,665 lbf SL ISA.
- Ground idle: N1 22 %, N2 55 %, ITT about 485 °C, fuel flow about 250 lb/h per engine.
- Start peak ITT about 556 °C. Light-off at about 7 s; idle at about 24 s (test).
- Rating tables: corrected N1 vs altitude, flat to ISA+19, clamped to the OG limits (`systems/engines.ts`).

## 3. Speeds, limitations and performance

**Airspeeds** (OG 1-3/1-4, FPG p.3)
- Mmo is M0.84 indicated above 29,375 ft.
- Vmo is 325 KIAS from 8,000 ft to 29,375 ft. Below 8,000 ft it is linear from 305 KIAS (8,000 ft) to 290 KIAS (SL).
- VFE: flaps 1 (7°) 250, flaps 2 (15°) 230, flaps FULL (35°) 180 KIAS.
- VLE and VLO: 230 KIAS. Speedbrakes have no speed limit.
- Max tire ground speed: 195 kt.
- VMCA: flaps 1 100 KIAS, flaps 2 96 KIAS.
- Min speed in RVSM: 190 KIAS.
- Max maneuvering speed: 22,400 lb: 156 (ground) / 164 (FL250) / 178 (FL450). 39,500 lb: 222 / 241 / 264 KIAS.

**Other limits**
- Altitudes: max operating FL450. Max flaps/gear extension altitude FL180. Max takeoff/landing altitude 14,000 ft (the DGAC card for CC-DRA says 10,000 ft; probably an airframe without the high-altitude option). Max tailwind 10 kt (DGAC agrees).
- Load factor: flaps up −1.0/+2.6 g; flaps extended 0/+2.0 g; ≤ 0 g for no more than 7 s. Max landing sink rate 600 fpm.
- AFCS minimums: 400 ft AGL after takeoff and on the missed approach, 160 ft AGL on approach, 1,000 ft AGL en route.
- Autothrottle: not armed during taxi. Prohibited at or below 50 ft on a touch-and-go.
- Minimum battery temperature for a start is −20 °C.
- APU: ground start up to 13,500 ft. Air start up to 15,000 ft with 2 generators (72 % N2 minimum), or up to FL310 on battery only. Max operating FL350. Unattended operation approved.
- Icing: icing conditions are visible moisture at ≤ 10 °C SAT/RAT.
  - ENG A/I is required on the ground in icing conditions. In flight it is required below M0.52 in icing, or when ice is seen or ICING is displayed.
  - WING/STAB is required below 190 KIAS in icing, or when ice is seen or ICING is displayed.
  - Wing A/I is prohibited above 15 °C.
  - PITOT/STATIC: ON for 15 s within 1 min of takeoff in icing. ON on the ground for no more than 2 min.
- Pressurization: 9.66 ±0.1 psid nominal. SL cabin up to 26,816 ft, 5,950 ft cabin at FL450 (FPG p.2).
- Fuel: max imbalance 500 lb (2,000 lb demonstrated). No unusable fuel is shown on the gauges.

**V-speeds** (FPG p.4, KIAS, SL ISA)

| Weight (lb) | 25,500 | 29,500 | 31,500 | 34,500 | 36,500 | 37,500 | 38,500 | 39,500 |
|---|---|---|---|---|---|---|---|---|
| Flaps 2 V1/VR/V2 | 90/100/117 | 98/106/120 | 103/110/123 | 110/115/128 | 115/120/131 | 118/122/133 | 121/124/134 | 123/126/136 |
| Flaps 1 V1/VR/V2 | 96/105/123 | 101/107/123 | 107/112/127 | 115/119/133 | 121/123/137 | 123/126/138 | 126/128/140 | 128/130/142 |

**Takeoff field length** (FPG p.5, flaps 2, SL 15 °C): 2,430 / 2,890 / 3,230 / 3,740 / 4,140 / 4,360 / 4,580 / 4,810 ft for the weights above.
**VREF, flaps FULL** (FPG p.22): 23,500 lb 104 KIAS, then 106 / 108 / 110 / 112 / 116 / 121 / 125 KIAS at 33,500 lb.
**Landing distance** from 50 ft (SL, 15 °C): 2,390 ft at 23,500 lb up to 3,170 ft at 33,500 lb.
**VAPP**: VREF + ½ steady wind + gust, 5 to 20 kt (BCA: VREF 118-120, VAPP 130).
**AoA**: 0.66 on the AoA gauge is approach speed (OG 1-6).

**Stall speeds** (FPG p.26, KCAS, 1 g)

| Weight (lb) | FULL | Flaps 2 | Flaps 1 | UP |
|---|---|---|---|---|
| 33,500 | 102 | 111 | 116 | 129 |
| 29,500 | 94 | 103 | 108 | 120 |
| 27,500 | 91 | 99 | 104 | 116 |
| 23,500 | 84 | 92 | 96 | 107 |

**Climb, 270 KIAS / M0.76 max rate** (FPG p.16)

| Takeoff weight (lb) | To FL350 | To FL410 |
|---|---|---|
| 39,500 | 12 min | 17 min |
| 36,000 | 10 min | 14 min |
| 30,000 | 8 min | 11 min |

**Cruise** (FPG p.17-19, ISA, total lb/h)
- M0.80 at FL410: 457 KTAS, 1,807 lb/h at 36,000 lb.
- M0.80 at FL450: 457 KTAS, 1,573 lb/h at 32,000 lb.
- M0.82 at FL390: 469 KTAS, 1,921 lb/h at 34,000 lb.
- Mmo at FL350: 483 KTAS, 2,420 lb/h at 36,000 lb.
- Max cruise thrust at FL450: 473 KTAS, 1,712 lb/h at 32,000 lb.

**Holding at 5,000 ft** (FPG p.21): 1,568 lb/h at 188 KIAS at 36,000 lb.

**Model vs published** (test results):

| Check | Model | Published |
|---|---|---|
| Stall speeds | within 1 kt at 33,500 and 27,500 lb | FPG p.26 |
| Liftoff | about VR+14 kt | — |
| All-engine distance to 35 ft × 1.15 | 3,880 ft at MTOW | 4,810 ft field length |
| Accelerate-stop from V1 (+3 s) | within 15 % | 4,810 ft |
| Climb to FL410 at 36,000 lb | about 15 min | 14 min |
| M0.80 at FL410: TAS and fuel flow | within 2 % | FPG p.19 |

## 4. Systems

### 4.1 Electrical (OG 5; `systems/electrical.ts`)

**Architecture.** 28 V DC, split bus, isolated in normal operation. Each side has these buses:
- HOT BATT: battery 26.4 V Li-ion, 44 Ah (LFP, 8 cells).
- EMER: flight-critical items.
- MISSION: normal flight; the engine generator connects here.
- MAIN: redundant and high-power items; windshield heat needs a generator (BCA).
- INTERIOR: cabin.
- SERVICE: from the R mission bus.

The STANDBY bus is fed from the standby battery (24 V 10.4 Ah lead-acid, charged from the L mission bus, ≥ 180 min) through the STBY PWR switch.

**Sources.**
- Engine generators: 400 A on the ground, 500 A in flight.
- APU generator: 500 A on the ground, 400 A in flight, on the L side.
- PTCU hydraulic generator: 200 A.
- External DC power: on the L mission bus.
- Everything except the windshield heat runs on batteries only (BCA).
- GEN LOAD L/R/APU: 75 % of the rating that applies (ground or flight), computed in `logic.ts` (`ac.lon.elec.gen_*_load_pct`), also shown on the ELECTRICAL synoptic.

**Controls.**
- BATT L/R: HOT BATT ↔ EMER.
- ELEC L/R: EMER ↔ MISSION (ON / EMER).
- MAIN L/R: MISSION ↔ MAIN.
- INTERIOR: NORM / OFF.
- GEN L/R/APU: ON / OFF / RESET, with automatic connection when ready.
- BUS TIE: automatic on the ground (the button does nothing). In the air a press toggles between the two states (OG 5-5/5-6) and the crew selection masks the automation until the next automatic trigger (a new one-sided / single-battery / APU-start event) or landing.
- STBY PWR: OFF / ON / TEST with an LED. Amber = ON and the standby battery not being charged, i.e. no primary source on the L MISSION bus (OG 5-5); green = TEST with a good battery.
- EXT PWR.

**Automatic bus tie.** The tie closes when:
- only one bus half has a primary source;
- one battery came on alone at power-up;
- an APU start is in progress.

**Loads and breakers.** Every load has a breaker `cb.<load>` (list in the code). The EIS shows battery volts and amps (+ = charging).

### 4.2 Fuel (OG 6; `systems/fuel.ts`)
- **Tanks.** Two integral wing tanks, 7,250 lb usable each. A primary motive-flow ejector in each tank feeds its engine.
- **Boost pumps.** One electric boost pump per tank. In NORM it runs automatically for:
  - engine start;
  - fuel transfer;
  - APU running with the right engine stopped (right pump);
  - low fuel (< 500 lb);
  - ejector low pressure.
- **Recirculation pumps.** OG 6-2: "always on during normal operations unless the on-side fuel pump is also running or the fuel level is too low" (EST threshold: the 500 lb FUEL LEVEL LOW level). They drive temperature only. The function audit suggested a low-temperature inhibit instead; the OG puts the temperature term on the scavenge ejectors, not on the recirc pumps.
- **Scavenge ejectors** (OG 6-2): run at low fuel or very cold fuel (EST < −30 °C) with the engine running; shown on the FUEL synoptic (`ac.lon.fuel.scavenge*_on`).
- **FUEL TRANSFER knob.** L TANK: the right pump pushes fuel to the left tank. R TANK: the left pump pushes fuel to the right tank. With both pumps running the net transfer is zero and FUEL TRANSFER FAIL posts.
- **GRAVITY XFLOW.** Works in flight only.
- **APU feed.** From the right tank.
- **Engine shutoff.** The FADEC fuel command and the ENG FIRE switchlight (firewall valve) both close the engine feed.
- **Temperatures.** The tanks have a thermal model. The engine inlet temperature is the tank temperature plus 12 °C (EST, fuel-oil heat exchanger).

### 4.3 Hydraulics (OG 13; `systems/hydraulic.ts`)
- **Systems.** A (left EDP) and B (right EDP), each 3,000 psi.
- **HYD PUMP A/B switches:** NORM / MIN (EST 1,500 psi) / SHUTOFF (pump and firewall valve).
- **PTCU knob:** OFF / AUX A / NORM / AUX B / HYD GEN.
  - NORM: at power-up it charges the brake accumulators, B then A (EST 15 s each). It primes the on-side system during an engine start. Otherwise it transfers power (a bidirectional PTU).
  - AUX: an electric pump into A or B.
  - HYD GEN: a 200 A generator driven from B (OG 13-4). Moving the knob away from HYD GEN for ≥ 1 s and back toggles the source (EST window: a return within 30 s; a later selection starts again from B). The source resets to B at every power-up. CONFLICT: OG 5-7 says HYD GEN starts on A and the toggle goes to B; the Section 13 system description (B default) is followed.
  - The PTCU is inhibited with a low reservoir (EST).
- **Rudder Standby System.** A self-contained electric pump that powers the rudder when A is lost. RUDDER STANDBY NORM / OFF.
- **Users.**
  - A: rudder, left reverser, inboard brakes, gear (EST), spoilers.
  - B: outboard brakes, right reverser, nosewheel steering (EST), spoilers.
- **Accumulators.** Brakes and parking brake (Brakes block). Four ground-spoiler accumulators: GND SPOILER FAIL when two or more are low; GRD SPOILER ACCUM when one is low. Nosewheel steering.
- **Fluid temperature.** EST model. HYD O'TEMP above 135 °C.

### 4.4 Bleed, air conditioning, pressurization (OG 9-11; `systems/environment.ts`)
- **Bleed ports.** LP and HP ports per engine. The HP PRSOV opens when LP < 31.5 psig (52 psig with wing A/I requested) and regulates the HP supply to that point (OG 9-2). At ground idle the manifold therefore sits near 31.5 psig and a cross-bleed start draws it below the 32 psi start minimum; the running engine needs about IDLE + 25 % N1 (OG 17-11/17-12).
- **Valves.** The bleed PRSOV opens only above 12 psig. APU bleed feeds the L manifold. The BLEED ISOLATE valve (NORM / XFLOW) and a wing-only crossflow valve (XFLOW with wing A/I) sit between the sides. L/R PRESS SOURCE valves feed the ECS manifold.
- **Automatic start logic.** During a start the ECS supply is removed. When the left engine starts with the right engine and the APU running, the start uses APU air only. Right-first starts are recommended.
- **ACRP.** Heat exchangers plus one ACM.
  - ECS knob: NORM / ACM ONLY / HEAT EXCHG ONLY (OG 10-3). HEAT EXCHG ONLY (or the automatic switch after an ACM fault, failure `ecs.acm`) cannot cool below the RAT; ACM ONLY: outlet 10..40 °C and 80 % flow (EST). The pack outlet limits and flow come from `logic.ts`.
  - FLOW: NORM / HIGH (EST 0.42 / 0.55 kg/s). With APU bleed only: 60 % of the ACS capacity in NORM and 100 % in HIGH (OG 10-4).
  - CABIN / CKPT TEMP knobs: NORM (GTC target) or manual supply temperature.
  - Recirculation fan: AUTO / LOW / HIGH on the GTC. Its motor power (3 A / 6 A) is added to the cabin heat load (EST).
- **Pressurization.** 9.66 psid; relief EST 9.95 psid; CABIN DELTA P above 10.2 psid.
  - On the takeoff roll the cabin pre-pressurizes to about 200 ft below the field.
  - Landing target is 200 ft below landing elevation.
  - High-altitude mode when the departure (latched at lift-off) or destination field is above 8,000 ft (OG 11-3).
  - PRESS MODE MANUAL with the CABIN ALT switch (slow for 6 s, then fast; single rate modelled).
  - DUMP is guarded.
  - Passenger masks deploy at 14,000 ft cabin (EST).
- **Emergency Descent Mode** (BCA 2021; DGAC card "EMERGENCY DESCENT and EDM"; `systems/afcsExtras.ts`): cabin > 14,700 ft with the AP engaged above FL300 → HDG 90° left, selected altitude 15,000 ft, FLC at M0.82 / 315 KIAS (EST margins below Mmo/Vmo), A/T DESC (engaged if it was off). Level at 15,000 ft the speed target becomes 250 KIAS (EST). Any crew AFCS change (AP off, another lateral / vertical mode) ends EDM. Annunciation: white CAS EMERGENCY DESCENT (EST text; SCOPE: no dedicated FMA field). About 3,500-4,800 fpm from FL410.

### 4.5 Ice and rain (OG 12; `systems/environment.ts`)
- Bleed-heated wing leading edges and engine inlets.
- Stabilizer EMEDS (electro-mechanical expulsion), modelled as a 60 s de-ice cycle.
- Automatic windshield heat (40-45 °C; needs generator power). No wipers: hydrophobic coating.
- PITOT/STATIC heat in NORM: on during the takeoff roll (> 40 kt), in flight, and after an engine failure in flight. ON: continuous.
- Two ice detectors. ICING on the EIS and CAS.
- WING INSP lights.

### 4.6 APU (OG 8; `systems/environment.ts`)
- Honeywell 36-150. APU knob OFF / ON / START (spring to ON).
- ON: door and self test (about 10-15 s). START: AVAIL in less than a minute (BCA). Bleed is available 90 s after the start.
- Unattended operation: automatic fire shutdown and bottle discharge (BCA).
- CAS: white APU ON above FL200, amber above FL350.
- Start envelope (OG 8-2): ground starts to 13,500 ft, in-flight starts to FL310; above it the START command is inhibited (EST behaviour).

### 4.7 Fire protection (EST, Citation-family layout; `systems/environment.ts`)
- The OG does not model fire protection.
- Engines: dual-loop detectors. L/R ENG FIRE switchlights on the glareshield. Pushing one closes the fuel, hydraulic and bleed firewall valves and arms both bottles. BOTTLE 1 / BOTTLE 2 discharge into the armed engine.
- APU: single loop, automatic bottle.
- FIRE WARN TEST button on the overhead.

### 4.8 Oxygen (EST; `systems/environment.ts`)
- One bottle: 115 ft³, 1,850 psi (EST).
- Crew quick-donning masks with NORM / 100 % / EMER regulators.
- Passenger masks: automatic at 14,000 ft cabin, or PASS OXY manual deploy.

### 4.9 Landing gear, brakes, steering (OG 14; BCA)
- **Gear.** Trailing-link mains (dual wheels) and trailing-link nose gear. Electrically signalled, hydraulically actuated (A, EST). About 7 s cycle (EST).
  - The handle is on the copilot inboard panel.
  - EMER GEAR EXTENSION T-handle: freefall (EST; the OG does not model it).
  - The gear down-locks need hydraulic pressure to release, so no gear pins are needed (BCA).
- **Brakes.** Carbon, brake-by-wire with anti-skid.
  - Inboard brakes on A, outboard on B.
  - The EMER/PARK BRAKE handle meters emergency pressure (handle travel × 3,000 psi, limited by the accumulator) to all four assemblies through its own lines (OG 14-2/14-3); it works after a BRAKE FAIL (the `brakes.left/right` failures are the brake-by-wire channels here). PARK latches only at full travel. The toe brakes need the brake control unit (`elec.brake_ctl_powered`).
  - Automatic spin-down on gear retraction.
  - Pedal braking is disabled in the air.
  - BRAKE TEMP above 450 °C.
- **Steering.** Rudder pedals ±7.5°, left-seat tiller ±80-81° (BCA, OG). Hydraulic.

### 4.10 Flight controls (OG 15; BCA)
- **Elevator and ailerons.** Mechanical cables, no hydraulic boost (BCA).
- **Roll spoilers.** The outboard and mid spoiler panels (4) act as roll spoilers and speedbrakes, hydraulic, fly-by-wire.
- **Rudder.** Fly-by-wire and hydraulic (A, with RSS backup). It includes automatic yaw damping; there is **no YD button** and no YD annunciation (OG 4-7). Rudder authority is scaled with speed (EST limiter).
- **Speedbrake handle.** Left of the throttles. Retracted .. full, 35° panels in flight, 17.5° beyond flaps 2.
  - Auto-stow above about 30° TLA (≈ CRU) or at the stick shaker. SPEEDBRAKE AUTO STOW posts; stow the handle to reset.
  - SPEEDBRAKES posts below 500 ft on the approach.
- **Ground spoilers.** All six panels at 60°, fully automatic.
  - Deploy: wheel speed > 35 kt with both throttles at idle, or RTO above 60 kt (EST).
  - Stow: below 30 kt or when the throttles are advanced.
  - The accumulators allow deployment after a hydraulic loss.
- **Trims.**
  - Electric horizontal stabilizer: yoke switches (primary channel 1 / 2, breakers STAB TRIM PRI 1 L EMER / PRI 2 R EMER), plus the secondary trim (SECONDARY TRIM + rocker, breaker STAB TRIM SEC R EMER, half rate EST; SCOPE: same actuator). MASTER DISCONNECT held interrupts the primary channel, including a runaway; the secondary is not interrupted, and engaging it disengages the primary (runaway gone). Display in degrees; takeoff band −7.5..−0.5° (EST around the OG 17-3 chart). The EIS scale is the stabilizer in degrees with that band.
  - OG 17-3 takeoff trim chart (read off the graph): −6.45° at 24 % MAC, −5.15° at 28 %, −3.9° at 32 %, −2.5° at 36 % and flat to 40 %. The FDM (`Cm0` 0.10, `Cm_trim` 0.203) trims to it at V2 / flaps 2, and the ground states set the chart stab for the loaded CG (`states.ts takeoffStabDeg`). The audit's "0° at 40 % MAC" does not match the published graph.
  - Electric aileron and rudder trim.
  - All three trims must be in the green band for takeoff, or NO TAKEOFF posts.
- **Flaps.** Electric, lever on the right of the pedestal. UP / 1 (7°) / 2 (15°) / FULL (35°).
- **Stall protection.** Stick shaker (AoA 0.82 normalized, EST; the gauge is amber from 0.8) and stick pusher (0.97, EST) (BCA).
- **FBW limits.** No envelope protection overrides the pilot. The A/T gives min/max speed protection (BCA; `systems/afcsExtras.ts`).
- **PITCH/ROLL DISCONNECT** (DGAC abnormal card, AOPA, PAT). A T-handle splits the pilot's and copilot's columns and wheels, so each drives its own half of the elevator and ailerons after a jam. Model (`systems/pitchRollDisconnect.ts`): pulled, the surface is ½ operative half (the flying pilot's input) + ½ other half (frozen at the jam, or trailing at neutral). The AP disconnects and cannot be engaged while it is latched (EST). SCOPE: it is reset in the cockpit (a maintenance action on the aircraft). The handle position on the pedestal is EST.
- **MASTER DISCONNECT** (the AP/TRIM DISC button on each wheel, and the hardware/keyboard AP DISC). Pressing it disconnects the AP. While it is held it interrupts electric trim and the pusher, and disengages nosewheel steering (DGAC abnormal card: "NOSEWHEEL STEERING MALFUNCTION: MASTER DISCONNECT push and hold").
- **Pilot gearing (EST, `createSystems.ts` `PILOT_GEARING`).** The elevator and ailerons are cable driven, so the deflection a pilot can hold is force-limited (blow-down). The spring-centred sim column/wheel is geared with IAS:
  - pitch: full to 130 KIAS, then (130/V)²;
  - roll: full to 180 KIAS, then (180/V)².
  - Results: 30 % column gives about 2 g at 250-320 KIAS; full wheel gives 45 / 43 / 34 °/s at 150 / 250 / 320 KIAS (`verify/handling.test.ts`).
  - Roll authority `Cl_da` + `Cl_spoiler` was reduced from 0.05 + 0.05 to 0.028 + 0.022 (pb/2V ≈ 0.11).

### 4.11 Avionics: Garmin G5000 (OG 4; BCA; `src/avionics/garmin-g3000`)
- **Displays.** Three 14 in GDUs (PFD L, MFD, PFD R), landscape 16:10. PFDs and MFD can be split.
- **Controllers.** Four GTC 570 touchscreen controllers: an outboard PFD GTC per pilot, and two MFD GTCs below the MFD on the forward pedestal.
- **GMC 710.** AFCS controller on the glareshield centre.
- **Display controllers.** Two, above each PFD: BARO knob with STD push, map RANGE and MINS knobs (EST layout).
- **Sensors and radios.** Dual ADC, dual AHRS (Litef LCR-100), dual GPS/SBAS, FMS, TCAS II, ADS-B transponder, TAWS-A.
- **Standby.** Standby flight display on the standby bus.
- **CAS.** On the lower inboard corner of each PFD. MASTER WARNING and MASTER CAUTION switchlights above each PFD.

### 4.12 AFCS and autothrottle (OG 4-7, 7-4/7-5; BCA)
- **Lateral modes:** ROL, HDG, FMS (LNAV), VOR, LOC, BC, TO, GA.
- **Vertical modes:** PIT, ALT, ALTS, ALTV, VS, FLC, PATH (VNAV path; G5000 CRG 190-02538-02 p.156 annunciates PATH), VFLC (VNAV climb), GS, GP, TO, GA.
- **AP behaviour.** Engage limits: 400 ft after takeoff, 160 ft on approach. TO/GA disconnects the AP (BCA). Go-around pitch 7.5°. Not autoland capable.
- **A/T modes:** TO, HOLD (on the ground above 60 kt after TO/GA, or as soon as a lever is advanced to T/O by hand with the A/T engaged, until 400 ft; OG 7-5), CLIMB, DESC (stays DESC at the idle stop; no HOLD in the air), SPD, RETARD (below 40 ft), MAX SPD, MIN SPD.
- **A/T protection** (`systems/afcsExtras.ts`, EST thresholds): above 400 ft RA, MIN SPD at AoA 0.72 of the stall AoA (cleared below 0.60) drives the levers to TO and stows the speedbrakes (needs the A/T engaged); MAX SPD within 2 kt of Vmo/Mmo (cleared 8 kt below) retards and engages the A/T if it was off (BCA).
- **Speed selection.** SPD knob FMS / MAN.
- **Approach speeds.** A pilot-selectable approach bug speed reduces to VREF plus an additive at 2 nm (BCA). Not modelled: open issue.

### 4.13 Lighting (OG 16)
- **Overhead.**
  - Exterior buttons: L LDG, R LDG, RECOG, PULSE, TAXI, WING INSP, TAIL FLOOD, ANTI COLL.
  - Knobs: PANEL, FLOOD, AUX.
- **GTC Exterior Lights page.** NAV: selected ON automatically when the G5000 powers up (rising edge of GDU power, `logic.ts`); BEACON OFF / NORM / ON, NORM at power-up (NORM: on with RUN or a starter engaged); auto PULSE on TCAS TA/RA. Both stay crew-selectable afterwards.
- **Dimmers.** PFD/GTC dual knobs on the outboard lower panels. MFD/GTC dual knob on the forward pedestal. MAP LIGHT knobs.
- **Emergency lights.** EMER LTS OFF / ARM / ON.

## 5. CAS messages (OG Section 3; `systems/cas.ts`)

Inhibits:
- **TOPI** (takeoff, OG 3-3, event latched): set by lift-off, the IAS rising through 85 kt, or IAS > 30 kt with a brake failure; cancelled > 30 s airborne, above 400 ft, IAS < 50 kt (< 30 kt with a brake failure), after 90 s, or when the throttles leave T/O.
- **LOPI** (landing, OG 3-4, event latched): set by touchdown or the RA dropping through 400 ft; cancelled 30 s on the ground, RA > 500 ft, IAS < 50 kt, or after 90 s.
- **ESDI**: an engine is shut down.

**Red: MASTER WARNING and tone**

| Message | Condition | Inhibit |
|---|---|---|
| BATTERY O'TEMP L/R | > 71 °C | TOPI, LOPI |
| BRAKE FAIL | brakes inoperative below 400 ft | TOPI |
| CABIN ALTITUDE | > 9,800 ft (14,800 ft in high-altitude mode; OG 3, OG 11-3 says amber there) | TOPI, LOPI |
| CABIN DELTA P | > 10.2 psid | TOPI, LOPI |
| ENG EXCEEDANCE L/R | N1 / N2 / ITT beyond limits > 1 s; latched until the maintenance (state) reset, not cleared by MASTER WARNING (OG 3-5) | TOPI, LOPI |
| ENGINE FAIL L/R | FADEC: engine stopped with RUN selected | none |
| GENS OFF | generators available but all selected off | TOPI, LOPI, ESDI |
| HYD O'TEMP A/B | > 135 °C | TOPI, LOPI |
| LANDING GEAR | not down and locked with flaps > 2, or below 500 ft with the throttles near idle (voice "LANDING GEAR") | none |
| NO TAKEOFF | pre-flight conditions not met (flaps, trims, speedbrake, parking brake, XFLOW) with the throttles at TO | in air |
| P/S BUTTON ON | ON on the ground for more than 2 min (replaces the amber one) | TOPI, LOPI |
| ENG FIRE L/R, APU FIRE | fire detected (EST) | none |

**Amber: MASTER CAUTION and chime**
- A/I ENG OFF L/R, A/I WING OFF L/R.
- APU BLEED OFF (on the ground). APU ON (above FL350).
- BATT DISCHARGE L/R (> 5 min). BATTERY AMPS L/R (> 300 A). BATTERY LOW TAKEOFF (> 20 A charging at TO thrust). BATTERY O'TEMP L/R (> 63 °C). BATTERY OFF L/R. BATTERY VOLTS L/R (< 24.0 V, EST).
- BLEED ISOLATE NORM (engine out > 2 min in flight). BLEED ISOLATE XFLOW (TO thrust on the ground, or > 5 min with both bleeds).
- BRAKE FAIL (in flight). BRAKE TEMP L/R (> 450 °C).
- BUS TIE CLOSED (> 5 min with both primaries).
- CABIN ALTITUDE (> 8,500 ft; high-altitude mode: > 9,800 ft for 10 min, OG 3 CAS list; OG 11-3 says 30 min).
- ELEC EMER L/R. EMER BUS OFF L/R. MAIN BUS OFF L/R. MISSION BUS OFF L/R.
- ENG BLEED OFF L/R (on the ground).
- FUEL IMBALANCE (> 500 lb). FUEL INLET COLD L/R (< 3 °C). FUEL LEVEL LOW L/R (< 500 lb). FUEL TANK COLD L/R (< −35 °C). FUEL TEMP MISCOMPARE (> 5 °C). FUEL TRANSFER FAIL. FUEL TRANSFER ON (into a tank already 60 lb heavier, or on > 10 min).
- GEAR DISAGREE L/R/N.
- GEN LOAD L/R/APU/HYD (> 75 % of the ground / flight rating). GEN OFF L/R/APU (available but selected OFF, also with other generators online; suppressed only by GENS OFF). **GEN FAIL L/R** (EST addition, no Longitude source: the OG list has only GEN OFF / GENS OFF; kept so a tripped generator with its switch ON has a crew cue; the ELECTRICAL synoptic also shows the tripped source).
- GND SPOILER FAIL. GRD SPOILER ACCUM.
- HEAT EXCHG ONLY (on the ground, or the pack switched automatically to heat-exchanger mode after an ACM fault with the knob elsewhere; OG 10-3) and ACM ONLY (on the ground).
- EST texts (no public Longitude source): ENG CONTROL FAULT L/R (FADEC channel fault, `fail.fadec.eng*`), PITCH/ROLL DISC (handle pulled), PITCH TRIM FAIL (runaway / jam / failed selected primary channel).
- HYD GEN ON (another source available). HYD PRESS LOW A/B. HYD SHUTOFF A/B (pump available).
- ICING (not all four anti-ice buttons ON).
- PARK BRAKE LOW PRESS. PARK BRAKE ON (throttles advanced below TO).
- PRESS MODE MANUAL. PRESS SOURCE OFF L/R (in air).
- PTCU NOT NORM (on the ground during an engine start or with an engine running).
- RUDDER FAIL A-B. RUDDER STANDBY OFF.
- SPEEDBRAKE AUTO STOW. SPEEDBRAKES (< 500 ft).
- YAW DAMPER FAIL A/B.
- P/S BUTTON ON (on the ground, first 2 min; never together with the red one).

**White: CAS only**
- A/I ENG ON L/R, A/I WING ON, A/I WING XFLOW OPEN, STAB DE-ICE ON, ICE PROTECT ALL ON.
- ACM ONLY and HEAT EXCHG ONLY (in air).
- APU BLEED OFF (in air). APU ON (above FL200).
- BLEED ISOLATE XFLOW. BUS TIE CLOSED.
- CABIN ALTITUDE (high-altitude mode, > 8,000 ft).
- ENG BLEED OFF L/R (in air). ENG DRY MTR PROC L/R (15-180 min after shutdown). ENGINE SHUTDOWN L/R.
- FUEL BOOST PUMP ON L/R. FUEL GRV XFLOW ON. FUEL TRANSFER ON.
- HYD AUX PUMP ON A/B. HYD FW SHUTOFF A/B. HYD GEN ON. PTCU OFF.
- NO TAKEOFF (throttles not advanced).
- PARK BRAKE ON.
- PITOT STATIC ON (in air). PRESS SOURCE OFF L/R (on the ground).
- EST texts: EMERGENCY DESCENT (EDM in progress), ENG START ABORT L/R (FADEC start abort: hot, hung, no light-off, or no rotation within 10 s, e.g. no starter air).

## 6. Normal procedures (OG 17; `checklists.ts`)

1. **Cockpit inspection.** CONTROL LOCK UNLOCK (EST item). STBY PWR to TEST (green ≥ 10 s), then ON. EMER LTS to ARM. Gear DOWN. BATT L/R ON and check volts. EIS/CAS. GPU and/or APU ON/START (BATT amps 0 or charging). Lights.
2. **Cockpit preparation.**
   - APU running; GPU disconnected.
   - Dry motor if the engines were shut down 15-180 min ago.
   - Trims set per the CG chart.
   - PERF: weight and fuel, TOLD, V-speeds. Pressurization LDG ELEV. Fuel balance.
   - AP engage/disengage test (first flight of the day).
3. **Before start.** EMER/PARK BRAKE set (PARK BRAKE ON).
4. **Starting engines (APU).** Throttle IDLE, then for each engine, right first:
   - RUN/STOP → RUN;
   - START psi ≥ 32;
   - STARTER push;
   - monitor (ITT < 650 °C).
   Then check the EIS/CAS.
5. **Before taxi.** Flight controls. Speedbrakes retracted. Flaps 1 or 2. Instruments aligned; altimeters within 75 ft of the field and 50 ft of each other. ENG A/I as required. AUTO GROUND SPOILERS armed, POWER RESERVE AUTO (EST items).
6. **Taxi.** Lights. Park brake stowed. Brakes. NWS. Reversers deploy/stow check.
7. **Before takeoff.** Flaps, speedbrakes, trims, ice protection, V-speeds displayed, SPD knob FMS, briefing. In icing, P/S ON for 15 s. Lights. EIS/CAS (no NO TAKEOFF).
8. **Takeoff.** Throttles TO; A/T shows green HOLD (with the A/T engaged, HOLD comes as soon as the levers reach T/O on the ground); N1 matches, green TO. Release the brakes. Rotate at VR to 10°.
9. **After takeoff.**
   - Gear UP with a positive rate.
   - Flaps UP at or above V2+20.
   - Throttles CLB. Pressurization check. Altimeters.
   - APU OFF before FL350.
10. **Cruise.** CRU. RVSM: AP, altimeters within 200 ft.
11. **Descent.** LDG ELEV. APU (at or below FL310) as desired. Altimeters.
12. **Approach.** Landing data, minimums, altimeters, briefing, flaps 1-2.
13. **Before landing.** Gear down (3 green), flaps FULL, speedbrakes retracted, AP off before 160 ft, VREF minimum.
14. **Landing.** A/T RETARD at 50 ft; throttles IDLE; brakes after nosewheel touchdown; reversers, at idle by 45 KIAS.
15. **Go-around.** TO/GA; throttles TO; 7.5° pitch; flaps 2; VAPP minimum; gear UP with a positive rate; flaps UP at VAPP+10.
16. **Shutdown.** Throttles IDLE; park brake; ENG A/I OFF; RUN/STOP STOP; EMER LTS OFF; STBY PWR OFF; APU OFF; lights OFF; BATT OFF.
17. **Also listed:** quick turn, APU start, dry motor (STOP + hold START until 20 % N2 or 15 s, OG 7-6), cross-bleed start (running engine at idle + 25 % N1: at plain idle the HP-regulated manifold is below 32 psi).

Key abnormal procedures and the modelled reactions:

| Event | Modelled reaction | Crew action |
|---|---|---|
| Generator failure | Automatic bus tie, GEN FAIL | GEN RESET |
| Dual generator loss | APU generator (FL310 start) or PTCU HYD GEN | ELEC EMER to preserve the batteries |
| Hydraulic A loss | RSS powers the rudder | — |
| Hydraulic A+B loss | Accumulators give ground spoilers, NWS and park/emergency brakes | — |
| Engine fire | — | ENG FIRE switchlight, bottle switchlight above it, the other bottle if still burning |
| APU fire | Automatic APU shutdown and bottle discharge (5 s) | APU FIRE switchlight (APU off, fuel shutoff, bottle) |
| Engine failure at takeoff thrust | POWER RESERVE AUTO: APR on the operating engine (EST) | MANUAL POWER RESERVE (WINDSHEAR, DGAC) |
| Brake-by-wire failure (BRAKE FAIL) | Toe brakes lost | EMER/PARK BRAKE handle, metered (DGAC) |
| Primary pitch-trim runaway | PITCH TRIM FAIL (EST) | MASTER DISCONNECT push and hold (DGAC); SECONDARY TRIM (EST) |
| FADEC fault | ENG CONTROL FAULT (EST) | Throttle as required; RUN/STOP STOP if uncontrollable (DGAC uncommanded thrust) |
| Start without starter air | ENG START ABORT after 10 s (EST) | Establish ≥ 32 psi |
| Cabin > 14,700 ft, AP on, > FL300 | EDM: 90° left, FLC descent to 15,000 ft, A/T DESC | Masks 100 %, MIC SEL MASK, MIC/INPH as required (DGAC) |
| Flap drive fault | FLAP FAIL, flaps held (EST) | FLAP RESET |
| Yaw-damper normal channel | YAW DAMPER FAIL A/B | STANDBY YAW DAMP |
| Primary stab-trim channel | Trim inoperative on that channel | STAB PRI TRIM CHANNEL SELECT, then SECONDARY TRIM |
| Cabin altitude | Passenger masks at 14,000 ft | Emergency descent, crew masks |

Emergency / abnormal checklists (`checklists.ts`, DGAC C700 card): CABIN ALTITUDE, EMERGENCY DESCENT and EDM, WINDSHEAR,
BRAKE FAIL / WHEEL BRAKE FAILURE, PRIMARY PITCH TRIM RUNAWAY (+ EST secondary-trim continuation), JAMMED PITCH OR ROLL
CONTROL SYSTEM, NOSEWHEEL STEERING MALFUNCTION, INADVERTENT STALL / PUSH, AT HOLD FAIL, BATTERY O'TEMP, ENG CONTROL FAULT /
UNCOMMANDED THRUST.

## 7. Cockpit control inventory

Rebuilt in the layout-audit fix round 1 (§14) from the AOPA 2021 flight-deck photographs (pilot-seat view a21_004,
close-ups c_gs21, c_top21, c_lowL21, c_lowR21, c_oh, c_lcon, c_yokeL21, a21_006) and the Textron panel / pedestal
photographs (_pedfwd, _pedaft). Where a photograph and the OG disagree, the photograph is followed and the conflict
is noted. Panel coordinates are x right / y up from the panel centre (or x right / y down / aft from the top-left
corner where noted), in mm. Body frame: x forward, y right, z down, from the datum (fdm.ts). Legends: normal state
cyan in the upper half, off-normal state in the lower half; unlit lenses near black.

### 7.0 Geometry (`cockpit/layout.ts`)
- **Floor** z +0.62. **Design eyes** (7.55, ∓0.50, −0.55): 1.17 m above the floor (EST).
- **Display band** (three GDU 1400W): centre z −0.085, face tilted 10°, PFD centres ±0.41 m (Textron photograph).
- **Second (lower glareshield) tier**: 88 mm tall, coplanar with the display band, so it cannot shade the screens.
- **GMC tier (glareshield face)**: 80 mm, 20° tilt, rising from the tier top; hood brow 30 mm above.
  Over-the-nose line over the brow ≈ 9.6° (EST). The whole PFD, FMA row included, is visible from both eyes
  (`fixRound1.test.ts` L01).
- **Outboard GTC wedges**: at y ±0.80, turned 25° toward the pilot, below / outboard of the PFDs.
- **Lower band**: black knee-pod face (z +0.045..+0.225) with a 260 mm system sub-panel under the inboard half of each
  PFD and a 130 mm dimmer strip outboard of the yoke column; column wells to the floor.
- **Yokes**: ram's-horn wheels, hub (8.05, ±0.45, +0.04), about the PFD bottom edge.
- **Pedestal**: 0.36 m wide; silver nose surround with the MFD GTCs, black top x 8.11 → 7.28, rounded black side rails.
- **Overhead**: single LIGHTS strip 0.56 × 0.11 m just aft of the windshield header.
- **Consoles**: from the seat to the GTC wedges; tiller knob in the left console top; CB grid panels on the forward
  sidewall, turned 30° toward the pilot.
- **Finish**: deck, tiers, pedestal, consoles and lower sidewall black / charcoal; headliner and upper sidewall light
  grey; windshield frames light grey with a dark inner edge; centre post ≈ 65 mm.

### 7.1 Glareshield, GMC tier (left to right; c_gs21)

| Control | Type / positions | Var / event | Position |
|---|---|---|---|
| L bottle switchlight | Square, momentary, dark until armed; ARMED (green) / DISCH (amber) (legend EST) | `ac.lon.fire.bottle1`; lights `ac.lon.ck.bottle1_armed`, `fire.bottle1_discharged` | Directly above L ENG FIRE, 30 mm |
| L ENG FIRE | Red switchlight, push-latch, clear guard | `ac.lon.fire.eng_l`; light `fire.eng1_warn` | −238 from the GMC centre; 36×27 mm |
| GMC 710 (425×75 mm) | FD / L CRS knob (PUSH DIR) · VS key over NOSE wheel (DN top, UP bottom) · VNAV, FLC over SPD knob (green SPD light, FMS / MAN ring, PUSH IAS MACH) · AP over CPL (green arrows) · NAV, HDG, APPR over BANK, HDG knob (PUSH SYNC), B/C · ALT key over ALT knob (PUSH FINE) · FD / R CRS knob (PUSH DIR). No A/T, SPD or YD key. | `g3k.gmc.key_*`, `g3k.gmc.*`; ALT knob `lon.gmc.alt*` → 1,000 / 100 ft (FINE, `ac.lon.gmc.alt_fine`, EST); SPD push = `g3k.gmc.key_spd` (IAS/MACH); ring = `g3k.gmc.spd_push` (FMS/MAN, `g3k.spd_fms`); SPD light = A/T engaged (EST) | Centre |
| ENG FIRE R, R bottle switchlight | Mirror image | `ac.lon.fire.eng_r`, `ac.lon.fire.bottle2` | +238 |
| APU FIRE | Red switchlight, push-latch, clear guard | `ac.lon.fire.apu`: APU shutdown, APU fuel shutoff, APU bottle discharge (EST function); light `fire.apu_warn` | +282 |

### 7.2 Lower glareshield tier (left to right; c_top21)

| Control | Type | Var / event | Position (from centre) |
|---|---|---|---|
| MASTER CAUTION RESET (L) | Amber switchlight 30×24 mm | event `cas.ack_caution`; `alert.master_caution` | −423 (outboard) |
| MASTER WARNING RESET (L) | Red switchlight 30×24 mm | event `cas.ack_warning`; `alert.master_warning` | −384 |
| L display controller (140×50 mm, black) | RANGE knob (PUSH PAN, joystick) · CLR over ENT · PFD dual knob (PUSH ENT) · -D-> over FPL · COM/NAV over PROC · BARO knob (PUSH STD) | GCU logic (`state/Gcu.ts`, created in createSystems): `g3k.range1.*`, `g3k.gcu1.*`, `g3k.baro1.*` | −290 |
| MAX AIRSPEED LIMITS placard | FLAP 1: 250, 2: 230, FULL: 180 KIAS; GEAR EXT/OPERATING 230 KIAS; TURBULENT AIR 235 KIAS / .75M | data.ts `vfe*`, `vleKt`, `vTurbKt`, `mTurb` | −165 |
| POWER RESERVE MANUAL | Switchlight, ON (white) | `ac.lon.eng.apr_manual` | −107 |
| POWER RESERVE AUTO | Switchlight in a yellow frame, ARM (cyan) / APR (green) (legends EST) | `ac.lon.eng.apr_auto`; `ac.lon.eng.apr_active` | −66 |
| Standby flight display | 86 mm bezel, BARO knob lower right (push STD) | `adc3.baro_inhg`, `adc3.baro_std`; power `elec.stby_inst_powered` | 0 |
| Knob right of the standby | STBY display brightness (EST function) | `ac.lon.lt.stby` → `display.stby.brt` | +69 |
| Registration placard | Framed tail number (EST registration) | — | +159 |
| R display controller, MASTER WARNING / CAUTION RESET (R) | Mirror image | `g3k.*2`, `g3k.gcu2.*` | +290, +384, +423 |

SCOPE: minimums are set on the GTC PFD page (no MINS knob on the Longitude controller); display reversion is
automatic / GTC (no reversion switch visible on the controller, EST).

### 7.3 Main instrument panel and GTC wedges

| Control / display | Type | Var | Position |
|---|---|---|---|
| L PFD / MFD / R PFD | GDU 1400W 14.1 in | `pfd1`, `mfd`, `pfd2` | x −410 / 0 / +410 |
| Gasper L / R | Eyeball outlet: click open / closed, wheel 25 % steps, drag aims (SCOPE: airflow state) | `ac.lon.ecs.gasper_l/_r` → `ac.lon.ecs.gasper_flow` | Upper outboard PFD corners |
| L PFD GTC / R PFD GTC | GTC 570 on the outboard wedges | `gtc1`, `gtc4` | Body y ±0.80 |

### 7.4 Pilot lower sub-panel: ELECTRICAL (c_lowL21; OG Fig 5-3-1, 5-4..5-6)

Plate 260 × 180 mm under the inboard half of the L PFD, white bus mimic joining the controls.

| Row | Control | Type / legends | Var |
|---|---|---|---|
| 1 | L MAIN, R MAIN | ON (cyan) / OFF (white) | `ac.lon.elec.main_l/_r` |
| 1 | L ELEC, R ELEC | NORM (cyan) / EMER (amber) | `ac.lon.elec.elec_l/_r` |
| 1 | INTERIOR | NORM (cyan) / OFF (white) | `ac.lon.elec.interior` |
| 2 | STBY PWR | Toggle ON (up) / OFF (centre, engraved left) / TEST (down, momentary); amber / green LED left of the switch (OG 5-5) | `ac.lon.elec.stby_pwr` (1 / 0 / 2); LED `ac.lon.elec.stby_led` |
| 2 | L GEN, R GEN | Toggle ON / OFF / RESET (momentary); OFF engraved outboard (left of L GEN, right of R GEN) | `ac.lon.elec.gen_l/_r` |
| 2 | BUS TIE | OPEN (cyan) / CLOSED (amber) | `ac.lon.elec.bus_tie`; `ac.lon.elec.bus_tie_closed` |
| 3 | APU GEN | Toggle ON / OFF / RESET, OFF engraved left | `ac.lon.elec.gen_apu` |
| 3 | L BATT, R BATT | ON (cyan) / OFF (amber) | `ac.lon.elec.batt_l/_r` |
| 3 | EXT PWR | AVAIL (white) / ON (cyan) | `ac.lon.elec.ext_pwr`; `elec.gpu_avail` |
| Strip | L PFD GTC DIM | Dual knob (outer PFD, inner GTC), OFF arc | `ac.lon.lt.pfd_l`, `ac.lon.lt.gtc_l` |
| Strip | MAP LIGHT | Knob, MIN arc | `ac.lon.lt.map_l` |

### 7.5 Copilot lower sub-panel: LANDING GEAR / ICE PROTECTION (c_lowR21; OG Fig 12-3-1, 14-4-1)

| Control | Type | Var |
|---|---|---|
| LANDING GEAR handle | Wheel handle DN / UP in its slot, GEAR UP ↕ GEAR DOWN arrow, bracketed title; no position lights (gear on the EIS); down-lock on the ground | `ac.lon.gear_handle` (1 DN) |
| ICE PROTECTION ENGINE L / R | OFF (cyan, lower) / ON (white, upper), under an ENGINE bracket | `ac.lon.ice.eng_l/_r` |
| WING / STAB | Same | `ac.lon.ice.wing`, `ac.lon.ice.stab` |
| PITOT/STATIC | NORM (cyan, upper) / ON (amber) | `ac.lon.ice.pitot_static` |
| R PFD GTC DIM, MAP LIGHT | As on the L side | `ac.lon.lt.pfd_r`, `gtc_r`, `map_r` |
| EMER GEAR EXTENSION | Red T-handle on the copilot knee-pod face (EST: not visible in c_lowR21) | `ac.lon.gear_emer` |

### 7.6 Pedestal, forward section (_pedfwd, c_pedFL2, c_ped21)

| Area | Control | Type / legends | Var |
|---|---|---|---|
| Nose | MFD GTC L / R | GTC 570 × 2 in the silver surround | `gtc2`, `gtc3` |
| Left column | MFD / GTCs dimmer | Dual knob, OFF arc | `ac.lon.lt.mfd`, `ac.lon.lt.gtc_c` |
| Left column | STABILIZER PRIMARY TRIM CHANNEL SELECT | Switchlight, alternates CH 1 / CH 2 (cyan) (EST: ch 1 on the L emer bus, ch 2 on the R) | `ac.lon.trim.stab_chan` (1 / 2) |
| Left column | SECONDARY TRIM | Switchlight in a yellow frame, NORM (cyan) / ENGAGED (amber); engaged = primary (wheel) trim off, rocker active (EST) | `ac.lon.trim.stab_sec_arm` |
| Left column | NOSE DOWN / NOSE UP | Spring-loaded rocker | `ac.lon.trim.stab_sec_sw` (−1 / 0 / +1) → `ac.lon.trim.stab_sec_cmd` |
| Left column | AUTO GROUND SPOILERS | Switchlight, dark when armed, OFF (amber) disarmed (EST legend) | `ac.lon.fc.auto_gnd_splr` |
| Left column | STANDBY YAW DAMP | Switchlight NORM (cyan) / ON (white) (EST legends) | `ac.lon.fc.stby_yd` |
| Quadrant | SPEEDBRAKE | Lever RET (fwd) .. EXT (aft), continuous, wedge scale, vertical engraving, cylindrical grip | `ac.lon.speedbrake` 0..1 |
| Quadrant | Thrust levers L / R | Silver arms, horizontal cylindrical grips; IDLE 0 .. TO 1 (CRU ≈ 0.62, CLB ≈ 0.80), lift the reverse range −1..0; held at idle by CONTROL LOCK | `ac.tla1`, `ac.tla2` |
| Quadrant | TO/GA (outboard end of each grip), AT DISC (inboard top, black), AT paddle (outboard side of the arm) | Momentary | events `ap.toga`, `at.disc`, `at.engage` |
| Quadrant | FUEL RECIRC PUMP | NORM (cyan) / OFF | `ac.lon.fuel.recirc` |
| Right column | HYDRAULIC PUMP A / B | Toggles NORM / MIN / SHUTOFF (lever-locked), MIN engraved between | `ac.lon.hyd.pump_a/_b` |
| Right column | POWER TRANSFER (PTCU) | Rotary OFF / AUX A / NORM / AUX B / HYD GEN (photo shows two switchlights under this bracket, legends illegible; the OG knob is kept) | `ac.lon.hyd.ptcu` |
| Right column | RUDDER STANDBY | NORM (cyan) / OFF (amber) | `ac.lon.hyd.rudder_stby` |
| Right column | FUEL: BOOST PUMP L / R | NORM (cyan, upper) / ON (amber) | `ac.lon.fuel.boost_l/_r` |
| Right column | GRAVITY XFLOW | OPEN (upper) / CLOSED (cyan, lower) | `ac.lon.fuel.grav_xflow` |
| Right column | TRANSFER | Rotary L TANK / OFF / R TANK | `ac.lon.fuel.transfer` |

### 7.7 Pedestal, aft section (_pedaft, c_pedA2, a21_006)

| Area | Control | Type / legends | Var |
|---|---|---|---|
| Aft left | EMER / PARK BRAKE | Lever with red / white striped grip in a slotted recess, OFF .. PARK | `ac.lon.park_brake` |
| Aft left | CONTROL LOCK | Lever UNLOCK (up / fwd) / LOCK (down / aft); only with both levers at idle; LOCK holds the surfaces, keeps the thrust at idle, AP inhibit, NO TAKEOFF (EST) | `ac.lon.fc.control_lock` |
| Centre | ENGINE: L RUN/STOP · STARTER L / R · R RUN/STOP | RUN (cyan) / STOP, clear guards; START (white) momentary | `ac.lon.eng.run_l/_r`, `start_l/_r` |
| Centre | PRESSURIZATION: CKPT TEMP · ECS · CABIN TEMP | Temp knobs NORM / COLD / HOT / MANUAL; ECS NORM (top) / HEAT EXCHG ONLY (left) / ACM ONLY (right). Photo order followed (OG MSFS art: CABIN left / CKPT right, ACM left) | `ac.lon.ecs.ckpt_temp`, `ecs.mode`, `ecs.cabin_temp` |
| Centre | CABIN DUMP (red guard) · FLOW · CABIN ALT (UP / HLD / DN) · PRESS MODE (NORM / MANUAL, cyan) | | `ac.lon.press.dump`, `bleed.flow`, `press.cabin_alt_sw`, `press.mode` |
| Centre | L PRESS SOURCE · APU BLEED · R PRESS SOURCE | NORM (cyan) / OFF (amber) | `ac.lon.bleed.press_src_l`, `bleed.apu`, `press_src_r` |
| Centre | L ENG BLEED · BLEED ISOLATE · R ENG BLEED | NORM / OFF; isolate NORM / XFLOW; duct mimic with WING A/I taps | `ac.lon.bleed.eng_l`, `isolate`, `eng_r` |
| Centre | COCKPIT VOICE RECORDER: TEST (green) + HOLD 5 SEC light · HEADSET jack · ERASE (red) | Momentary; status after 5 s held with the CVR powered; ERASE on the ground with the park brake set (SCOPE: no audio) | `ac.lon.cvr.test`, `cvr.erase`; `cvr.test_ok`, `cvr.erased` |
| Aft right | FLAP lever | 0 / 1 (7°) / 2 (15°) / FULL (35°) | `ac.lon.flap_lever` 0..3 |
| Aft right | FLAP RESET | Momentary, FAIL (amber) while a flap fault is latched (EST function) | `ac.lon.fc.flap_reset`; `ac.lon.fc.flap_fault` |
| Aft right | APU box: OFF / ON / START (spring to ON); EVENT MARKER | Rotary; momentary (SCOPE: FDR event count) | `ac.lon.apu.knob`; `ac.lon.fdr.event_marker` → `fdr.event_count` |
| Aft end | AIL TRIM, RUD TRIM | Spring-loaded; EST position (not in the photographs) | `ac.lon.trim.ail_sw`, `trim.rud_sw` |
| Aft face | PITCH/ROLL DISCONNECT | Red flag "PULL": pull = split both, rotate up = PITCH RECONNECT, down = ROLL RECONNECT, push = reset (mount EST) | `ac.lon.fc.pitch_roll_disc` (0..3) |

### 7.8 Overhead LIGHTS strip (c_oh; OG Fig 16-2-1, 16-3-2)

| Controls (left to right) | Type | Var |
|---|---|---|
| L LDG, R LDG, TAXI, RECOG, PULSE | Switchlights, ON (cyan) | `ac.lon.lt.ldg_l`, `ldg_r`, `taxi`, `recog`, `pulse` |
| PANEL (MIN .. DAY), FLOOD (MIN), AUX (MIN) | Knobs with engraved arcs | `ac.lon.lt.panel`, `flood`, `aux` |
| EMER LTS | Lever-lock toggle in a ring guard: ARM (up) / ON (centre, engraved at the side) / OFF (down) | `ac.lon.lt.emer` (1 / 2 / 0) |
| ANTI COLL, WING INSP, TAIL FLOOD, PAX SAFETY, SEAT BELTS | Switchlights, ON (cyan) | `ac.lon.lt.anti_coll`, `wing_insp`, `tail_flood`, `pax_safety_btn`, `seat_belts` |

Headliner: two round fixtures either side of the strip with the flood lights; sun visors on rails above the side
windows (`ac.lon.visor_l/_r`, SCOPE shading state). Not on the real overhead, moved to GTC pages (§7.10): DOME,
PASS OXY, FIRE WARN TEST, ANNUN TEST.

### 7.9 Yokes, pedals, side consoles
- **Yokes** (ram's horn): pitch / roll through `input.pitch` / `input.roll`; outboard grip (c_yokeL21): AP/TRIM DISC
  (red, `ac.lon.yoke.disc_l/_r`, event `ap.disc`), ICS push (`ac.lon.yoke.ics_l/_r`, SCOPE), split pitch-trim switch
  (`ac.lon.yoke.trim_l/_r`); PTT trigger on the back of the grip (`ac.lon.yoke.ptt_l/_r` → `ac.lon.com.transmitting`,
  SCOPE). Inboard grip face: MIC/INPH rocker (inboard MIC / outboard INPH = hot intercom; `ac.lon.audio.mic_inph_l/_r`
  → `ac.lon.audio.intercom_hot_l/_r`; DGAC CABIN ALTITUDE step 3; EST position, SCOPE no audio model).
- **Rudder pedals**: `input.yaw`, toe brakes.
- **Tiller**: black finger-grip knob in the forward left console (`ac.lon.tiller`, ±81°).
- **Oxygen**: mask in a console cup with the white hose loop and red squeeze tabs (`ac.lon.oxy.mask_l/_r`); regulator
  NORM / 100 % / EMER, PRESS TO TEST and FLOW beside the cup (EST positions). MIC SEL switchlight aft of them (MASK green /
  BOOM white, `ac.lon.audio.mic_sel_l/_r` → mask mic live `ac.lon.audio.mask_mic_l/_r` with the mask in use; DGAC CABIN
  ALTITUDE step 2; EST position, SCOPE no audio model).
- **Circuit breakers**: forward sidewall grid panels (columns N.. left / AA.. right, rows 1-5), name under each
  breaker; every breaker is a `cb.<load>` of the network.

### 7.10 GTC system pages (touchscreen)

Written by the G5000 synoptic controls (`systems/synoptics.ts`):
- Exterior lights: `ac.lon.lt.nav`, `ac.lon.lt.beacon_mode`, `ac.lon.lt.auto_pulse`; CKPT DOME `ac.lon.lt.dome` (SCOPE).
- Temperature: `ac.lon.ecs.cabin_set_c`, `ac.lon.ecs.ckpt_set_c`, `ac.lon.ecs.recirc_fan`.
- Cabin Pressure: `ac.lon.press.sel_mode`, `ac.lon.press.ldg_elev_ft` (−9999 = FMS destination), `ac.lon.press.sel_cabin_ft`;
  PAX OXY AUTO / DEPLOY `ac.lon.oxy.pax` (SCOPE).
- Tests: FIRE WARN (`ac.lon.fire.test`), ANNUN lamp test (`alert.annun_test`).

## 8. Integration notes for the cockpit, index.ts and exterior agents

- **Building the systems.** `createLongitudeSystems(ctx, { noDisplays })` returns `LongitudeSystems`. It includes `suite` (the G3000Suite in the G5000 layout). Map `suite.displayList()` onto the screen meshes: `pfd1`, `mfd`, `pfd2`, `gtc1`..`gtc4`. Build the GMC, display-controller and GTC hardware from `g3000Controls(suite.cfg)`.
- **Other exports.**
  - `applyLongitudeState(ctx, sys, state)` in `states.ts`.
  - `LONGITUDE_META`, `LONGITUDE_INPUT_MAP`, `LONGITUDE_CHECKLISTS`.
  - `CITATION_LONGITUDE_FDM` (default export of `fdm.ts`).
- **Lights and indications.**
  - Lights for exterior rendering: `light.nav`, `beacon`, `beacon_lower`, `strobe`, `strobe_tail`, `landing_l`/`landing_r`, `recognition`, `pulse_l`/`pulse_r`, `taxi`, `wingtip_taxi`, `wing`, `logo`, `emer`.
  - Interior dimmers: `ac.light.panel`, `flood`, `aux`, `map_l`, `map_r`, `seatbelt`, `no_smoking`.
  - Display brightness: `display.<id>.brt`.
- **Pushbutton annunciators** use the control var itself, plus these system states:
  - `elec.gpu_avail`
  - `ac.lon.elec.bus_tie_closed`
  - `fuel.boost_*_on`
  - `ac.lon.hyd.ptcu_mode` (string)
  - `fire.eng*_warn`
  - `fadec.eng*.starter_cmd`
  - `alert.master_*`
- **Thrust levers.** Lever `ac.tla{i}`: the A/T servo writes the same var, so the lever must follow external writes. The FADEC reads `ac.lon.tla_eff{i}`: the reverse range is scaled by the 85→45 kt schedule.

## 9. Scope, simplifications and open issues

- **Not modelled:**
  - (Emergency Descent Mode and the A/T MIN SPD / MAX SPD protection are modelled since the function fix round, §15.)
  - The 2-nm approach-speed reduction.
  - Secondary stab trim as a separate motor (separate switch path and breaker, same actuator: SCOPE).
  - Windshield heat controller temperatures.
  - The CABIN ALT switch's two rates.
  - The standby display's own boot / test.
  - Doors and door CAS (the OG does not list any).
  - Weather radar (G5000 state only).
- **Fire protection and oxygen:** layout and capacities are EST, because the OG does not describe them.
- **Hydraulic assignments** of the gear and nosewheel steering (A / B) are EST.
- **Liftoff speed.** The scripted 3°/s rotation lifts off at about VR+15 kt; explained by the all-engine acceleration (§15.2), not changed.
- **FPG takeoff field lengths** are factored balanced-field values. The tests check the all-engine 35 ft distance × 1.15 and the accelerate-stop distance against them. One-engine-inoperative accelerate-go is not tested.
- **Minor data conflict:** MZFW is 26,000 lb (FPG) vs 26,800 lb (OG).

## 10. Main cockpit and exterior build

Code: `src/aircraft/citation-longitude/cockpit/` (everything except `overhead/` and `side/`),
`exterior.ts` and `index.ts`. Tests: `tests/aircraft/citation-longitude/cockpit-main/`.

### 10.1 Files

| File | Contents |
|---|---|
| `cockpit/layout.ts` | Every body-frame number of the flight deck: design eye, panel frames, GDU / GTC sizes, pedestal, yokes, pedals, seats, windshield and side-window stations, mount frames for the overhead and side consoles, tiller position. |
| `cockpit/shell.ts` | Sidewalls, headliner, window frames lofted from the exterior sections, floor, aft bulkhead, glareshield hood, soffit, pedestal body, knee and foot-well closures, seats. |
| `cockpit/mainPanel.ts` | L PFD / MFD / R PFD (GDU 1400W with 12 softkeys each), outboard PFD GTCs, standby display with its BARO knob, pilot and copilot lower sub-panels. |
| `cockpit/glareshield.ts` | MASTER WARNING / CAUTION (both sides), GDU controllers, ENG FIRE switchlights, BOTTLE 1 / 2, GMC 710. |
| `cockpit/pedestal.ts` | MFD GTCs, fuel, hydraulics, speedbrake, thrust levers with TO/GA, A/T disconnect and A/T arm buttons on the handles, flaps, trims, engine RUN/STOP and START, air conditioning, pressurization, APU, bleed air. |
| `cockpit/flightControls.ts` | Two control wheels (AP/TRIM DISC, pitch trim), two sets of rudder pedals with toe brakes, the nosewheel tiller. |
| `cockpit/garmin.ts` | G5000 hardware built from `g3000Controls(cfg)`: GDU bezels and softkeys, GTC 570 units and knobs, GMC 710, GDU controllers. |
| `cockpit/controls.ts` | `GtcMapKnob`: GTC 570 map knob with joystick (turn, push, drag to pan). |
| `cockpit/standby.ts` | Standby flight display (ADC 3 / AHRS 3, standby bus). |
| `cockpit/context.ts` | Build context and the extension contract for the overhead / side builders. |
| `cockpit/index.ts` | `buildLongitudeCockpit(ctx, sys, suite, { headless?, mainOnly? })`: lighting zones and lights, derived annunciator states, preset views. |
| `exterior.ts` | `createLongitudeExterior(vars)` and the shared `LONGITUDE_FUSELAGE` sections. |
| `systems/cockpitInputs.ts` | Merges the 3D wheel trim switches, AP/TRIM DISC and tiller into the systems (see 10.3). |

### 10.2 Geometry (EST unless noted)

- Floor z +0.62 m. Design eye (7.55, ∓0.50, −0.55) m, 1.17 m above the floor.
- Display band: centre (8.34, 0, −0.165) m, tilted 10°. PFDs at y ±0.49 m, GTCs at ±0.755 m.
- Standby display in the gap between the L PFD and the MFD.
- Glareshield face: 1.80 × 0.09 m, tilted 25°. The hood top is at z −0.39 m at the brow and slopes to −0.33 m at the windshield base. That keeps the over-the-nose line about 11° below the eye.
- Pedestal: 0.36 m wide. The forward face is tilted about 30° and carries the two MFD GTCs; the flat top runs from x 8.10 to 7.28 m.
- The fuselage sections come from the FPG dimensions: length 22.30 m, span 21.0 m, height 5.92 m. `tests/.../exterior.test.ts` checks all three.

### 10.3 Changes to the core agent's files

- **`vars.ts`.** Added `yokeTrimL/R`, `yokeDiscL/R`, `tiller3d`, `yokeTrimCmd`, `tillerCmd` and `discHeld`. The new inputs are also listed in `LON_CONTROL_VARS`.
- **`createSystems.ts`.** The new `LongitudeCockpitInputs` subsystem runs right after the logic block, and three bindings use it:
  - stabilizer trim `switchVars` gets `yokeTrimCmd`, and trim `enable` is `!discHeld`;
  - the stall-warning pusher `enabled` is `!discHeld`;
  - nosewheel steering takes `tiller.input = tillerCmd`.
- **Why the change was needed.** The app's input module rewrites `input.pitch_trim_rate`, `input.ap_disc` and `input.tiller` every frame, so 3D controls cannot write those vars directly.
- **Trim priority and AP disconnect.** The pilot's wheel trim has priority over the copilot's (EST). Operating a wheel trim switch disconnects the AP (Garmin GFC behaviour).

### 10.4 Shared-library change

`src/cockpit/controls/Lever.ts` has a new read-only `handle` getter that returns the moving arm group. It is additive. The Longitude uses it to mount the TO/GA, A/T DISC and A/T ARM buttons on the thrust-lever handles.

### 10.5 Lighting

| Zone | Var | Drives |
|---|---|---|
| `panel` | `ac.light.panel` | Label backlighting (PANEL knob) |
| `flood` | `ac.light.flood` | Two headliner flood lights |
| `map_l`, `map_r` | `ac.light.map_l/_r` | Map lights |
| `aux` | `ac.light.aux` | LED strip under the glareshield (EST) |

- Annunciator lenses are powered from the emergency buses. They dim when the PANEL knob is out of DAY (EST).
- The exterior uses real spot lights for the landing L / R (400,000 cd, EST) and taxi (60,000 cd, EST) lights, scaled by `world.render_units_per_lux`. Every other light is a lamp sprite driven by `light.*`.

### 10.6 Verification

- `coverage.test.ts` actuates every control through its pointer handlers. Each one must change a var that a system reads, or emit an event that has a listener. The indicator lamps must be driven by system vars. Result: 166 of 166 bound.
- `functional.test.ts` checks the system reactions to the controls:
  - batteries power the emergency buses;
  - wheel trim moves the stabilizer, and AP/TRIM DISC interrupts it;
  - the tiller steers;
  - the gear handle is locked on the ground;
  - thrust levers change the FADEC N1 command;
  - ENG FIRE arms the bottles and BOTTLE discharges them.
- `exterior.test.ts` checks the dimensions and the animation.
- For screenshots, run `node scripts/lon-shots.mjs` (options in the file header). It writes to `tests/output/citation-longitude/`.

### 10.7 Scope and open items (cockpit / exterior)

- **Not built:**
  - PTT and intercom switches on the wheels (no transmit model).
  - The GTC dual-knob push-and-hold (COM swap). The swap is available on the GTC screen.
- **No lamp-test writer.** Nothing writes `alert.annun_test` in this aircraft yet. The overhead builder is the natural owner if the Longitude has an annunciator test.
- **Tiller.** It has no centring spring; it stays where it is left.
- **Layout.** The GMC 710 key layout and the lower-panel positions are EST from photographs. The standby display position is EST.
- **Exterior.** The flaps rotate about a hinge line; the Fowler translation is not modelled. The reversers are shown as two pivot doors per engine (EST).

## 11. Overhead panel, side consoles and circuit breakers

Code: `src/aircraft/citation-longitude/cockpit/overhead/index.ts`, `cockpit/side/index.ts`,
`cockpit/side/breakers.ts`, `cockpit/side/oxygenMask.ts`. Tests:
`tests/aircraft/citation-longitude/cockpit-overhead/`. Both builders are loaded by
`cockpit/index.ts` through `import.meta.glob`.

### 11.1 Overhead panel (EST geometry: 0.40 × 0.30 m, x 7.96 → 7.66, forward end 12° lower)

| Row (fwd → aft) | Control | Var / effect |
|---|---|---|
| EXTERIOR LIGHTS | L LDG, R LDG, RECOG, PULSE, TAXI, WING INSP, TAIL FLOOD, ANTI COLL Korry buttons (white ON legend, EST colour) | `ac.lon.lt.*` → `LightingSystem` (OG 16-3/16-4) |
| COCKPIT LIGHTS | PANEL (DAY at full), FLOOD, AUX dimmers; DOME toggle; EMER LTS OFF / ARM / ON (lever-locked out of OFF) | `ac.lon.lt.panel/flood/aux/dome/emer` |
| PASS SIGNS / OXYGEN / TEST | PASS SAFETY OFF / SEAT BELT / PASS SAFETY; PASS OXY guarded NORM / MAN DEPLOY + PASS OXY ON lens; FIRE WARN TEST; ANNUN TEST | `ac.lon.lt.pass_safety`, `ac.lon.oxy.pax` (lens `oxy.pax_on`), `ac.lon.fire.test`, `alert.annun_test` |

- Fixtures: dome light (spot, 6 cd EST, hot-battery load `dome_lt`), cockpit emergency-light lens
  (`light.emer`), two flood-light eyeballs (the lights themselves are in `cockpit/index.ts`).
- Not fitted, so not built: wipers (OG 12-3: hydrophobic coating), windshield-heat switches (automatic, OG 12-3),
  storm lights (FLOOD at full is the thunderstorm setting; SCOPE).

### 11.2 Side consoles (EST: y ±0.90, 0.16 m wide, top z 0.20)

- Forward end: crew quick-donning mask in its stowage box (click = don / stow, `ac.lon.oxy.mask_l/_r`), regulator
  NORM / 100 % / EMER (`ac.lon.oxy.mode` pilot, `ac.lon.oxy.mode_r` copilot), PRESS TO TEST (`ac.lon.oxy.test_l/_r`),
  FLOW indicator (`oxy.pilot_flowing` / `oxy.copilot_flowing`).
- Circuit breakers: one sidewall panel per side below the side-window sill (0.56 m long, height sized to the breaker
  rows, at most 0.25 m, EST position, clear of the armrests). Every network breaker ≤ 50 A is on a panel, grouped by bus (L: EMER, MISSION, MAIN / INTERIOR /
  STBY / HOT BATT; R: EMER, MISSION, MAIN / INTERIOR / SERVICE), bound to `cb.<load>` / `cb.<load>_tripped`.
  Feeders above 50 A (APU starter, PTCU motor, MAIN feeds, BUS TIE) are J-box current limiters, not panel breakers.
  A network breaker missing from the table is placed automatically in an L/R MISC group.
- MIC SEL MASK / BOOM switchlight per console (function fix round 1, §15).
- No audio panel (G5000 audio is the GTC "Audio & Radios" page, OG 4), no jacks / PTT, no cockpit-door control (SCOPE).

### 11.3 Systems changes made with this work

- `vars.ts`: `ltDome`, `oxyModeR`, `oxyTestL/R`, `lampTest` (= `alert.annun_test`), added to `LON_CONTROL_VARS`.
- `systems/electrical.ts`: load `dome_lt` on the hot L battery bus (1.2 A, 5 A breaker); GPU source resistance 1.5 mΩ
  (the 4 mΩ default let the bus sag to ~27.2 V under the ground load, below the Li-ion EMF, so the batteries
  discharged on ground power; OG 17-2 expects "BATT amps 0 or charging").
- `systems/lighting.ts`: dimmer `dome` → `ac.light.dome`.
- `systems/environment.ts`: copilot mask regulator `oxyModeR`; both masks get PRESS TO TEST.
- `createSystems.ts`: the CAS lamp test is bound explicitly to `alert.annun_test` (same as the library default).
- `states.ts`: resets the new vars.
- `cockpit/index.ts`: two preset views (left / right console) and a re-aimed Overhead view.

### 11.4 Verification

- `coverage.test.ts`: 84 overhead / side / breaker controls, all bound (18 overhead, 8 side console, 58 breakers).
- `breakers.test.ts`: every ≤ 50 A network breaker is on a panel; pulling PFD 1 / MFD / AHRS 2 / STBY INST / TAXI LTS /
  DOME LT removes that load's power (AHRS 2 invalid, taxi light dark), pushing restores it; a short trips LDG LT L
  (control pops, light dark), re-trips while the fault persists, and resets after it clears.
- `flows.test.ts`: cold & dark → BATT → EXT PWR (AVAIL → ON, bus tie CLOSED, batteries not discharging) → APU GEN →
  both engine generators (bus tie OPEN, generator CAS clear) through the cockpit controls; the lamp test is dark
  unpowered and lights every lens and both masters when powered; EMER LTS ARM on total emergency-bus loss; PASS
  SAFETY signs; FIRE WARN TEST; PASS OXY guard; crew-mask test, don and regulator.
- Screenshots: `node scripts/lon-shots.mjs` with `SHOT_VIEWS=9` (views 6 overhead, 8 / 9 consoles); night with
  `SHOT_TIME=02:00`.


## 12. Check-ride verification pass (full normal procedure, performance, visuals)

Code: `tests/aircraft/citation-longitude/verify/` (`flightRig.ts`, `fullFlight.test.ts`, `synoptics.test.ts`).

### 12.1 The check ride (`fullFlight.test.ts`, ~75 s)

One continuous flight KICT 01R → KMCI ILS 01L (route `ICT EMP`, CYPRE transition, FL280), real navigation database,
headless G5000, real SimLoop, and a two-field world (flat at each field elevation, linear blend between). The crew acts
only through cockpit vars, GMC keys / knob events, the G5000 flight-plan editor and TOLD model (the GTC pages'
back end), yoke, pedals, tiller and toe brakes. Every phase asserts CAS / FMA / numbers:

| Phase | What is checked |
|---|---|
| Cold & dark | no power, cabin unpressurized (ΔP < 0.05 psi), no warnings |
| Cockpit inspection | STBY PWR TEST green LED; BATT L/R > 24.5 V; mission buses powered |
| APU | AVAIL < 60 s; bus dip > 16 V; APU GEN on line; APU bleed after 90 s, start pressure ≥ 32 psi |
| Engine starts (R, L) | idle < 35 s; peak ITT < 650 °C; generators on line; hydraulics > 2,800 psi |
| Avionics / FMS | AHRS aligned, GPS valid; route, cruise FL280, ILS 01L via CYPRE loaded; W&F gross within 400 lb of the FDM mass; TOLD V1/VR/V2, field length, takeoff N1 |
| Taxi | pure-pursuit taxi onto the runway, ≤ 20 kt, lined up < 15 m off the centre line |
| Takeoff | no NO TAKEOFF; SPD FMS; A/T engaged + TO/GA → FMA TO / TO / A/T TO, FMS armed; A/T HOLD above 60 kt; takeoff N1 = TOLD N1 ± 1 % and ≤ 96.79 %; liftoff < 0.85 × TOLD field length and < V2 + 8; < 5 m centre-line deviation |
| After takeoff | AP engages into PIT with FMS captured; flaps up at V2 + 20; FLC → A/T CLIMB; VNAV → VFLC; level FL280 in ALTS/ALT; STD baro above FL180; bank < 30°, IAS < Vmo; no cautions |
| Cruise | ALT ± 60 ft, M0.70-0.84; fuel flow 1,500-3,200 pph (2,446 pph at M0.76); cabin < 3,000 ft at 9.66 psid; tank quantity decrements at the engine flow (± 10 %) |
| Descent | VNAV PATH captured at TOD; IAS < Vmo; baro set below FL180 |
| Approach | MAN speed; flaps 1 / 2 / FULL on schedule; speedbrakes as needed; NAV1 auto-tuned to I-MCI; APR arms LOC + GS; LOC / GS captured; gear down; at 1,000 ft RA: IAS within 8 kt of VAPP, 450-1,000 fpm, LOC/GS within ½ scale, no warnings |
| Landing | AP disconnect at 160 ft (OG 1-7); A/T RETARD; touchdown > −600 fpm, VAPP −20..+5 kt, 500-3,000 ft past the threshold |
| Rollout | ground spoilers deploy (≥ 0.9) and stow below 30 kt; reverse N1 > 50 %, reverse at idle by 45 kt; A/T disengaged; 25 kt with > 1,000 ft of runway left; < 10 m off the centre line |
| Taxi in / shutdown | clear of the runway; ENGINE SHUTDOWN R (white) while L runs, no ENGINE FAIL; both engines stopped, hydraulics bleed down; batteries off → dark |

Numbers from the last run: liftoff 127 KIAS (VR 110, V2 123) 1,879 ft from brake release (TOLD field length
3,390 ft); FL280 reached 6.6 min after brake release; M0.76 / 452 KTAS / 2,446 pph at FL280 and 31,000 lb; touchdown
116 KIAS 1,214 ft past the threshold; 25 kt at 3,870 ft with 0.45 brake pressure and reversers.

### 12.2 Defects found and fixed

| # | Defect (found by) | Fix |
|---|---|---|
| 1 | A/T could never be engaged on the ground: the systems were built before the FDM published weight-on-wheels, the first frames saw AIR, the A/T latched a "touchdown" and auto-disengaged 2 s after every ground engagement (TOGA takeoff impossible) | `states.ts` `resetAirGround`: seeds `gear.wow*` from the placement, re-reads the squat switches and resets the A/T before anything reads `gear.air_ground` |
| 2 | Every start (cold & dark included) began with the cabin ~1.1-1.8 psid above ambient on the ramp and bled down at up to 20,000 fpm: the pressurization settle used the not-yet-published 0 °C cabin temperature | `states.ts` publishes the snapped zone temperature before `press.settle()` |
| 3 | Armed FMS captured on the takeoff roll, so the FMA lost TO at brake release | Afcs option `nav.groundCapture: false` (Longitude only): armed modes capture once airborne |
| 4 | VFLC (G5000 VNAV climb) was in the mode list but unreachable; VNAV only armed the descent path | Afcs option `vnavClimb` (G5000 CRG 190-02538-02 p.154: the VNAV key arms PATH, FLC and ALTV as the profile needs) |
| 5 | **Safety:** ALTV followed the live VNAV target; when the constrained waypoint sequenced during the capture it tracked each lower constraint and descended through the selected altitude to the runway threshold (flew to 60 ft AGL at 215 kt 5 nm short) | Afcs option `altvBoundBySel` (Longitude on): the ALTV target is bounded by the selected altitude |
| 6 | SPD knob MAN was ignored in VNAV: the AFCS and A/T flew the FMS speed in PATH/VFLC (A/T added thrust at 300 KIAS with 210 kt selected) | Afcs and Autothrottle option `vnavSpeedFromSelected` (Longitude on): the G5000 copies the FMS speed into the selected speed in FMS mode (OG 7-4), so both always use the selected speed |
| 7 | The GTC-only controls (NAV / BEACON / AUTO PULSE, cabin / cockpit temperature, recirc fan, cabin pressure mode, landing elevation, cabin altitude select) had no page: `createSystems` passed no synoptics | `systems/synoptics.ts`: six MFD synoptic pages with those GTC controls; `verify/synoptics.test.ts` |
| 8 | TOLD returned no takeoff N1, so the PFD N1 reference bug stayed empty | `performance.ts` `takeoffN1`: the FADEC TO rating table at the runway pressure altitude / OAT |
| 9 | FMA said VPTH (G3000 wording) | G5000 label PATH (CRG p.156) |
| 10 | Pedestal, MFD-GTC and overhead preset views too far / clipped for the legends to be read | Overhead view re-aimed square to the panel; MFD GTC view raised; two new pedestal close-ups (forward, aft) |

### 12.3 Shared-library changes (all additive, opt-in, default behaviour unchanged)

- `src/systems/autopilot/types.ts` + `Afcs.ts`: `nav.groundCapture`, `vnavClimb`, `altvBoundBySel`, `vnavSpeedFromSelected`.
- `src/systems/fadec/Autothrottle.ts`: `vnavSpeedFromSelected`.
- `scripts/lon-shots.mjs`: `SHOT_OUT` output directory.

### 12.4 Remaining gaps (honest list)

- **Liftoff speed** is VR + 17 kt (127 vs V2 123) with the scripted 3°/s rotation: the pilot script applies only ~40 %
  elevator and the nose wheel needs ~1.5 s to unstick. All-engine distances meet the FPG; a real crew rotates faster.
  The FDM lift curve was left as calibrated (stall speeds within 1 kt of the FPG).
- **FMS (shared nav library):** (a) `dist_to_dest` and the VNAV profile use nominal leg lengths, so a large fly-by turn
  (EMP→BUM→final, 18 nm anticipation at FL200) makes the distance step 17 nm and the path deviation +5,000 ft at the
  sequence; the check-ride route avoids it with the CYPRE transition. (b) The FMS speed stays 300 KIAS until 10,000 ft
  instead of decelerating to 250 kt before it (14 CFR 91.117). (c) `FplEditor` keeps the destination leg active after
  enroute waypoints are inserted before it: the crew must "Activate Leg" on the first waypoint on the ground.
- **ALTV after a sequenced constraint** now levels at the next constraint or the selected altitude, but the PATH
  re-capture after a level segment needs the path to come back within 150 ft; the aircraft may level early above the
  path (seen at DASHI 5,000 ft) instead of following a continuous path.
- **A/T MIN / MAX SPD** protection and the 2-nm approach-speed reduction are still not modelled; no autobrake exists on the
  Longitude, so none is modelled.
- **A/T `reset()`** does not clear its touchdown timer (shared library); the Longitude avoids the latch through `resetAirGround`.
- **Terrain map on the ground** (fixed in the integration QA): the MFD and PFD inset maps now default to Absolute (topographic) terrain like the M2; the TAWS pane stays Relative (EST default, not from the pilot's guide).
- **Draw calls / triangles:** pilot view ~875 draw calls, cockpit 974 meshes / 354 k triangles (instanced bezel
  hardware 74 k, breaker panels 28 k), exterior 42 k triangles; SwiftShader runs ~4 fps (GPU-bound software rasteriser).
  No merge was done in this pass.

## 13. Second check-ride pass (adversarial review, 2026-09)

This pass re-walked the control inventory against the code (every `LON_VARS` control is written by a cockpit control or GTC page; the remaining vars are system outputs). It re-flew the check ride and probed the handling, loading and visuals.

### 13.1 Defects found and fixed

| # | Defect (how found) | Fix |
|---|---|---|
| 1 | **Handling.** 30 % aft column at 250 KIAS pitched the aircraft at 29 °/s (3.7 g) and fired the stick pusher. Full wheel rolled at 102 / 191 / 247 °/s at 150 / 250 / 320 KIAS (pb/2V 0.22). Found by a scripted step-input probe. | Roll authority reduced to `Cl_da` 0.028 + `Cl_spoiler` 0.022 (pb/2V ≈ 0.11, Roskam business-jet class). Pilot gearing vs IAS (`PILOT_GEARING`, EST blow-down of the cable elevator/ailerons). Now 30 % column ≈ 2 g at 250-320 KIAS and full wheel 45 / 43 / 34 °/s. Low-speed pitch authority is unchanged: full column still reaches the shaker at 150 KIAS. `verify/handling.test.ts`. |
| 2 | **Loading.** Every realistic loading computed at 19-23 % MAC, forward of the 24-40 % MAC range of the OG 17-3 takeoff-trim chart. MTOW with full fuel was at 19.4 %. Found by the trim-vs-CG probe. | Empty-CG estimate moved from 30 % to 35 % MAC (`fdm.ts`). Loadings are now 24-29 % MAC. The FPG performance tests, stall speeds and the check ride are unchanged within their tolerances. |
| 3 | **Missing control.** PITCH/ROLL DISCONNECT handle (DGAC abnormal card "Jammed pitch or roll control system"; AOPA; PAT). | Red T-handle on the pedestal (position EST), `ac.lon.fc.pitch_roll_disc`, and `systems/pitchRollDisconnect.ts` (§4.10). A jammed half stays frozen while the other half follows the operative wheel. The AP disconnects and is inhibited. `pitchRollDisconnect.test.ts`. |
| 4 | **MASTER DISCONNECT did not affect steering.** The DGAC card uses it for a nosewheel steering malfunction. The keyboard/hardware AP DISC did not interrupt trim or the pusher either. | NWS `engage: !disc_held`. `disc_held` now includes `input.ap_disc`. Tested. |
| 5 | **FMS 250 kt limit.** The FMS descent target stayed 300 KIAS until 10,000 ft, so the aircraft crossed 10,000 ft fast. | Opt-in `SpeedSchedule.speedLimitDecelFt` (shared VNAV, additive, default 0). The Longitude uses 3,000 ft (EST deceleration segment). The check ride asserts the target is ≤ 250 kt at 12,800 ft and IAS < 256 kt below 10,000 ft in the climb. |
| 6 | **Visual: forward pedestal legends invisible** (FUEL, BOOST L/R, GRAV XFLOW, HYDRAULICS, PTCU, SPEED BRAKE, FLAPS, MFD GTC). The pedestal body's bevelled top was coplanar with the control plate, up to 0.7 mm above it at the forward end. Found in the pedestal-forward screenshot, then by raycasting every label. | Body top set 3 mm below the plate (`shell.ts`). `cockpit-main/labels.test.ts` raycasts all ~340 legends and fails on any opaque skin within 3 mm in front of one. |
| 7 | **Visual:** the GMC NOSE "DN" legend was under the glareshield lip. | Wheel and legends moved up 3-4 mm. |
| 8 | **Test infrastructure.** The check-ride log was invisible because vitest hides console output for passing tests. One breaker test had no timeout (it failed under load). | `AMG_FLIGHT_LOG=<file>` writes the log. The breaker test has an explicit timeout. |

### 13.2 Shared-library change (additive)
- `src/nav/fms/VnavGuidance.ts`: optional `SpeedSchedule.speedLimitDecelFt` (default 0, no change for other aircraft).

### 13.3 Numbers from this pass
- Check ride (KICT 01R → KMCI ILS 01L, 31,600 lb):
  - Liftoff 127 KIAS, 1,872 ft from brake release.
  - FL280 at 6.6 min.
  - Cruise M0.76 / 452 KTAS / 2,450 pph.
  - FMS target 250 kt at 12,800 ft in the descent.
  - Touchdown 116 KIAS, −16 fpm, 1,232 ft past the threshold.
  - 25 kt at 3,877 ft.
- Rendering (SwiftShader, 1280×720, pilot view):
  - 858 draw calls, 659 k triangles, all 8 displays at 14-16 Hz, ~4 fps.
  - The cockpit alone has 702 visible meshes and 351 k triangles.

### 13.4 Remaining gaps (honest list)
- **Longitudinal trim model.** Resolved in the function fix round (§4.10, §15): `Cm0` 0.10 / `Cm_trim` 0.203 trim to the OG 17-3 chart (read off the graph: ~0.33° per % MAC, flat above 36 %), and the ground states set the chart value. `Cm_de` unchanged (it does not set the liftoff speed, §15.2).
- **Liftoff speed** is still VR + 14-17 kt with the scripted 3°/s rotation (unchanged by the CG move). All-engine distances meet the FPG.
- **Draw calls.** The remaining ~700 cockpit meshes are per-control moving parts: 58 breakers × 3 meshes, and ~250 push-button caps, lenses and legends. Instancing them needs per-instance transforms in the shared control library (not an additive change). The panels' static parts are already consolidated (`merge.ts`).
- **Toggle middle-position legends** (GEN OFF, STBY PWR ON) are partly under the switch nut: this is the shared ToggleSwitch layout. They are still readable.
- **MFD terrain on the ground**: fixed in the integration QA (maps default to Absolute terrain, see above).
- The PITCH/ROLL DISCONNECT handle position, and whether the Longitude posts a CAS message for it, are not published. No CAS message was invented.

## 14. Layout-audit fix round 1 (AOPA 2021 / Textron photographs)

All 54 layout gaps (L01-L54) and LON-F-22 / LON-F-35 / LON-F-36 / LON-PROC-06 / LON-PROC-27 were addressed; §7 is
the resulting inventory. Main points:

- **Geometry (L01).** The first build's glareshield face sat 0.1 m aft of the displays and hid the top ~45 mm of
  every PFD. The display band is now 80 mm lower, the lower glareshield tier is coplanar with it and the GMC tier
  rises from the tier top. `fixRound1.test.ts` casts rays from both design eyes to the top corners / centre of all
  three screens.
- **New systems functions** (all EST where the AFM text is not public, and marked in the code):
  - APU FIRE switchlight (environment.ts);
  - POWER RESERVE MANUAL / AUTO and the APR trigger (logic.ts);
  - stab-trim channel select and secondary trim (cockpitInputs.ts, createSystems.ts);
  - AUTO GROUND SPOILERS and STANDBY YAW DAMP (logic.ts; new failure `yd.normal`);
  - FLAP RESET / flap-fault latch with CAS FLAP FAIL (EST text);
  - CONTROL LOCK (crewControls.ts: surfaces held, thrust interlock, AP inhibit, NO TAKEOFF);
  - CVR test / erase, EVENT MARKER, PTT / ICS, gaspers, visors (crewControls.ts, SCOPE);
  - PITCH/ROLL DISCONNECT four-state handle (pitchRollDisconnect.ts);
  - ALT knob PUSH FINE (crewControls.ts);
  - display controllers on the GCU logic.
- **States / checklists.** cold & dark has the CONTROL LOCK engaged; the Cockpit Inspection checklist starts with
  CONTROL LOCK UNLOCK; Before Taxi checks AUTO GROUND SPOILERS and POWER RESERVE AUTO.
- **EIS.** Flap scale 0 / 7 / 15 / 35 with the selected-position cyan bug; the thrust-mode label is the governing
  rating (CRU below CLB), APR while the reserve is in force, magenta under the A/T (OG 7-7).
- **Superseded text.** §10.2 and §11.1-§11.2 geometry descriptions refer to the first build; §7 is current.

### 14.1 Shared-library changes (additive, default behaviour unchanged)
- `src/cockpit/controls/PushButton.ts`: optional `unlitTint` (passed to LegendFace) and `lightBar.unlitTint`.
- `src/cockpit/geometry/levers.ts`: LeverKnobStyle `'cylinder-grip'`.
- `src/cockpit/geometry/yokes.ts`: YokeStyle `'ramshorn'`.
- `src/avionics/garmin-g3000/config.ts` + `gdu/Eis.ts`: EisN1Section `modeColorByAt`, EisFlapsSection
  `selectedVar` / `selectedDeg` (cyan selected-flap bug).
- `src/avionics/garmin-g3000/presets.ts`: LONGITUDE_EIS only (flap detents, selected bug, thrust-mode var).

### 14.2 Remaining gaps (honest list)
- Legends of the bottle, POWER RESERVE, STAB CHANNEL, SECONDARY TRIM, AUTO GROUND SPOILERS, STANDBY YAW DAMP and FLAP
  RESET switchlights are not legible in the photographs: EST.
- The POWER TRANSFER area shows two switchlights in the Textron photograph; the OG PTCU knob is kept.
- The EMER GEAR handle, aileron / rudder trim controls and the PITCH/ROLL DISCONNECT mount position are EST.
- "TRIM" under the MFD / GTCs dimmer (c_pedFL2) is not engraved (meaning unclear).
- The pilot's default view still shows the lower side windshield left of the panel wrap (cheek loft, EST shape).

## 15. Function-audit fix round 1 (OG / DGAC / BCA function lens)

Tests: `tests/aircraft/citation-longitude/functionFix1.test.ts` (each fails without its fix).

### 15.1 Fixed
- **EIS** (`createSystems.ts LONGITUDE_EIS_SIM`): SPOILERS reads `ac.lon.spoiler_ind` = max(speedbrake, ground-spoiler)
  extension (was the unused `surf.speedbrake`); stab trim in degrees with the NO TAKEOFF band as the green band.
- **Electrical**: BUS TIE toggles in the air over the automation; STBY PWR amber LED only when not charging; GEN LOAD vs
  the ground / flight rating; new trim and standby-pitot breakers (STAB TRIM PRI 1 / PRI 2 / SEC, AIL TRIM, RUD TRIM,
  P/S HT STBY).
- **PTCU HYD GEN** source toggle from the exit edge only; B at power-up.
- **Lights**: NAV ON and beacon NORM at G5000 power-up.
- **A/T**: HOLD on the ground when the levers are advanced by hand; stays DESC at the idle stop in flight (the shared
  bizjet A/T turned an airborne HOLD into CLIMB thrust on every FLC descent); MIN SPD / MAX SPD protection.
- **EDM** (§4.4).
- **Brakes**: EMER/PARK BRAKE proportional and independent of the normal (brake-by-wire) path; PARK at full travel.
- **Pitch trim**: MASTER DISCONNECT held stops a primary runaway; secondary trim independent (half rate); breakers.
- **ECS**: ACM ONLY / HEAT EXCHG ONLY limits, automatic heat-exchanger mode (failure `ecs.acm`), APU-only flow, recirc
  fan heat.
- **APU** start envelope (FL310 in flight, 13,500 ft on the ground).
- **Engines**: no-rotation start abort (10 s, EST) with ENG START ABORT; ENG CONTROL FAULT; HP bleed regulated to
  31.5 / 52 psig (cross-bleed needs IDLE + 25 % N1); wing A/I valves 4 s after selection with the idle raised; dry
  motor 20 % N2; ENG EXCEEDANCE latched until the maintenance reset.
- **CAS**: event-latched TOPI / LOPI (OG 3-3/3-4); high-altitude mode from the departure or destination; 10 min delay
  for the high-alt amber CABIN ALTITUDE; single P/S BUTTON ON; GEN OFF APU with engine generators online; HEAT EXCHG
  ONLY automatic case; PITCH/ROLL DISC and PITCH TRIM FAIL (EST texts).
- **Synoptics**: PRE-FLIGHT (NO TAKEOFF reasons), FLIGHT CONTROLS, SUMMARY (shutdown time, dry motor, exceedance, brake
  temperatures), PROPULSION (engine digits, APU); FUEL recirc / scavenge pumps; ELECTRICAL generator load %.
- **Audio**: MIC SEL and MIC/INPH controls (§7.9).
- **Flight model**: stab trim vs CG follows the OG 17-3 chart (§4.10); ground states set the chart stab.
- **Standby air data**: own pitot / static probe (3) with its heater (EST).
- **TOLD**: FIELD ELEV > LIMIT above 14,000 ft (OG 1-1; DGAC card 10,000 ft conflict noted in `data.ts`).
- **Checklists**: DGAC emergency / abnormal items (§6).

### 15.2 Not changed (with the reason)
- Liftoff about VR + 15 kt: at 34,000 lb the all-engine acceleration is ~5.7 kt/s (T/W 0.45); the OG rotation (10° at
  ~3°/s) reaches the ~7.2° liftoff attitude 2.6 s after VR. Raising `Cm_de` (0.95 → 1.6) does not change it (the
  rotation rate, not the elevator authority, sets it); the FPG VR–V2 spread (13 kt) is the OEI V2. Liftoff stays
  below V2 + 8 (check ride).
- ELEC EMER endurance ~2 h: OG 5-2 says "over 40 minutes", a floor that 2 h meets; no public load data justify
  heavier EMER-bus loads.
- PITCH/ROLL DISCONNECT handle position: still EST (no photograph of it).
- GEN FAIL L/R kept as an EST message (§5).

### 15.3 Shared-library changes (additive, opt-in, default behaviour unchanged)
- `systems/gear/Brakes.ts`: `emergency.bypassFailures`.
- `systems/flightcontrols/TrimAxis.ts`: `electric.runawayEnable`.
- `systems/pneumatic/types.ts` + `PneumaticSystem.ts`: `PackDef.minOutletCBinding / maxOutletCBinding`,
  `BleedSourceDef.hp.regulation`.
- `systems/fadec/EngineStartController.ts`: `noRotationS / noRotationN2Pct`.
- `systems/fadec/Autothrottle.ts`: `holdAfterDescentIdle`.
- `systems/warning/FlightPhase.ts`: `takeoffInhibit.latch`, `landingInhibit.latch`.

