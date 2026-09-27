# Bombardier Global 6000: research dossier and implementation reference

The Global 6000 is an ultra-long-range business jet: BD-700-1A10 with the Global Vision Flight Deck, powered by
2 × Rolls-Royce Deutschland BR700-710A2-20.

- **Flight controls:** hydraulically powered, cable-signalled, with yokes, slats and Fowler flaps, and a stick pusher.
- **Avionics:** Collins Pro Line Fusion ("Global Vision"): four 15.1 in AFDs, FCP, CTP, CCP, MKP, RSP and IESI.
- **Electrical:** four VFGs, an APU generator and a RAT.
- **Hydraulics:** three 3,000 psi systems.

This document collects the public data behind `src/aircraft/global6000/**`. It is also the contract for the cockpit
build (`src/aircraft/global6000/cockpit`, another agent). Every control listed in §12 has a var in `vars.ts` that a
system in `systems/**` or `createSystems.ts` consumes. The audit test in `tests/aircraft/global6000/states.test.ts`
enforces this.

## 0. Sources

| Tag | Source |
|---|---|
| TCDS | EASA Type Certificate Data Sheet IM.A.009 "BD-700", Issue 14 (23 Jan 2026), Section 2 (BD-700-1A10 / -1A11). Sections used: fuel 1.4 (SB 700-28-040 configuration), weights 1.5, datum 1.7, BR700-710A2-20 limits 3.2, oil 3.3, APU RE220 5.2, altitudes 5.4, Cat 2 5.6, exits 5.7, tyres 5.9, crew and passengers 5.10 / 5.11 |
| SPEC | Bombardier "Global 6000" factsheet (2017): dimensions, wing area 1,021 ft², BOW 52,230 lb, max fuel 45,050 lb, 14,750 lbf flat-rated to ISA + 20 °C, 6,000 nm at M0.85, MMO 0.89, take-off distance 6,476 ft (SL ISA MTOW), landing distance 2,236 ft, initial cruise altitude 41,000 ft at MTOW, ceiling 51,000 ft |
| GXAG | Bombardier Global Express training manual "Airplane General": dimensions (GX_01_002), eye position (GX_01_005), flight compartment and overhead layout (GX_01_018), airspeed limits placard (GX_01_018 / 022), control wheel switches |
| GXEL | same series, "Electrical": VFGs, APU GEN, RAT GEN, TRUs, batteries, bus priorities, messages |
| GXHY | "Hydraulics": systems 1–3, EDP / ACMP / RAT pump, AUTO logic, accumulators, pressure colours, messages |
| GXFU | "Fuel System": tanks, pumps, transfers, crossfeed, recirculation, messages |
| GXFC | "Flight Controls": PCUs, stabilizer 0–14 units, slat/flap lever, MFS / GS, ground lift dumping, stall protection |
| GXLG | "Landing Gear & Brakes": LGECU, actuation, NWS, autobrake, BTMS, horn, messages |
| GXAPU | "Auxiliary Power Unit": RE220, envelope, bleed, starter cut-out, messages |
| GXFP | "Fire Protection": FIDEEX loops, two shared bottles, MLG bay overheat |
| GXAF | "Automatic Flight": roll rate, bank limits, low-bank transition, pitch / VS limits, FLC changeover |
| GXLT | "Lighting": exterior and flight-compartment lighting controls |
| FSB | FAA Flight Standardization Board report BD-700-1A10 / 1A11, appendix 6 (Global Vision Flight Deck differences: four AFDs, CTP, CCP, MKP, RSP, EDM, autothrottle, triple FMS) |
| AOPA | "First look at the Global 6000", AOPA Pilot, Sep 2012: FL410 M0.85 490 KTAS at 3,200 lb/h, landing target 116 KIAS, 4,500 ft cabin at FL450 |
| E018 | EASA TCDS E.018 (BR700-710 series), as quoted in `src/avionics/collins-fusion/config.ts` |
| FUSION | `docs/modules/avionics-collins-fusion.md` (Collins course syllabus 523-0817473, FSB, Global 6000 cockpit photographs) |

In the code and in this document:

- `EST` marks an estimate and gives its reasoning.
- `SCOPE` marks a deliberate simplification.

The Global Express training manuals describe the BD-700-1A10 airframe and systems. The Global 6000 is the same type
(TCDS Section 2) with the Global Vision avionics and the SB 700-28-040 fuel configuration.

## 1. Dimensions, weights, capacities

| Item | Value | Source |
|---|---|---|
| Span / length / height | 94 ft 0 in (28.65 m) / 99 ft 5 in (30.30 m) / 25 ft 6 in (7.77 m) | SPEC, GXAG GX_01_002 |
| Wing area | 1,022 ft² (94.95 m²) equivalent; 35° sweep; 4 slat segments per side; double-slotted Fowler flaps (inboard / outboard) | GXAG, SPEC 1,021 ft² |
| MAC | 3.80 m | EST: taper-0.2 equivalent planform (`fdm.ts`) |
| Wheelbase / main gear track | 13.06 m / 4.18 m | GXAG three-view |
| Fuselage diameter | 2.69 m; horizontal tail span 9.68 m | GXAG |
| Tyres | nose 21×7.25-10, mains H38×12.0-19 twin | TCDS 5.9 |
| Max ramp / MTOW / MLW / MZFW | 99,750 / 99,500 / 78,600 / 58,000 lb | TCDS 1.5 |
| BOW / max payload | 52,230 lb / 5,770 lb (typical) | SPEC |
| Fuel (usable) | L / R main 15,045 lb each, centre 12,683 lb, aft 2,275 lb; total 45,050 lb | TCDS 1.4, SPEC |
| Unusable fuel | 72 lb drainable + 100 lb undrainable | TCDS 1.4 |
| Engine oil | 4.8 US gal per engine incl. lines | TCDS 3.3 |
| Occupants | minimum crew 2, 19 passengers max | TCDS 5.10 / 5.11 |
| Altitudes | 51,000 ft max operating; 13,700 ft max take-off / landing | TCDS 5.4 |
| Ambient | −30 … +50 °C at sea level | GXAG |

## 2. Powerplant: BR700-710A2-20

| Item | Value | Source |
|---|---|---|
| Thrust | take-off 14,750 lbf (65.6 kN), 5 min AEO / 10 min OEI; MCT 14,450 lbf; flat-rated to ISA + 20 °C | TCDS 3.2, SPEC |
| N1 | 102.0 % take-off; 102.5 % overspeed | TCDS 3.2 |
| N2 | 99.6 % take-off; 98.9 % MCT; 99.8 % overspeed; idle ≥ 58 % | TCDS 3.2 |
| ITT | 900 °C take-off; 860 °C MCT; 905 °C over-temperature; starting 700 °C ground / 850 °C air | TCDS 3.2 |
| Reverse | the FADEC limits N1 to 70.0 % for 30 s | TCDS 3.2 |
| Oil | 160 °C maximum. Pressure: 25 psid minimum to complete the flight; 35 psid lower limit for flight (idle to 72.3 % N2) | E018 |
| Control | dual-channel FADEC. EPR is the primary setting parameter; N1 is the alternate mode (pedestal ENGINE EPR / N1 PBAs) | GX_01_018 |
| Start | air-turbine starter on APU or cross bleed; FADEC auto start with the L / R START PBA; dry motoring with CRANK | GX_01_018, EST sequence |

### Engine model (`fdm.ts br710()`, EST calibration)

- **Thrust:** rated corrected N1 of 96.5 % gives take-off thrust. Lapse is `δ^0.8 (1 − 0.5M + 0.4M²)/√θ`.
- **Fuel:** TSFC is 0.0398 kg/N/h at rated SL static. This was calibrated so that FL410 M0.85 at 78,000 lb burns
  3,220 lb/h against the 3,200 lb/h in AOPA.
- **Idle:** N1 24 %, N2 60 %, 550 lb/h, ITT 470 °C.
- **Start:** peak ITT 560 °C; starter to 28 % N2; light-off at 15 %; about 24 s from light-off to idle.
- **Reverse:** efficiency 0.4.
- **Nacelles:** at x −9.3 m, y ±2.45 m, z −0.95 m (body frame).

### FADEC ratings (`systems/engines.ts`)

- **Ratings:** TO / GA / MCT / CLB / CRZ tables, flat to ISA + 20 °C.
- **Automatic selection:**
  - GA in the air with the slats out and the gear down.
  - CRZ above 25,000 ft when level in ALT or VALT.
- **Thrust lever law:** one MAX detent. The minimum take-off lever position is 30° TLA (GXFC GLD auto-arm), which is
  EST 0.67 of the travel.
- **Reverse:** the piggy-back reverse levers are limited to 70 % N1.

## 3. Speeds, envelope, V-speeds

| Item | Value | Source |
|---|---|---|
| VMO | 300 KIAS below 8,000 ft; 340 KIAS from 8,000 to 30,267 ft | GXAG placard |
| MMO | 0.89 up to 35,000 ft; 0.88 at 41,000; 0.858 at 47,000; 0.842 at 51,000 (linear between) | GXAG placard |
| VA | 254 KIAS at SL / 96,000 lb; 250 KIAS at 20,000 ft / 78,600 lb | GXAG |
| VFE | slats out (0 OUT) 225; flaps 6 210; flaps 16 210; flaps 30 185 KIAS | GXAG / GXFC |
| VLO / VLE | 200 / 250 KIAS | GXAG |
| Load factors | +2.5 / −1.0 clean; +2.0 / 0 flaps | EST: 14 CFR 25.337 / 25.345 minimums |
| Stall protection | shakers, pusher; inhibited below 70 KCAS | GXFC |
| Demonstrated crosswind | 29 kt | EST: operator figure, no public AFM value |

### V-speeds (EST, `data.ts vSpeeds`)

The AFM tables are not public, so the reference speeds come from the CLmax calibration:

- CLmax values: clean slats in 1.25, slats out 1.70, flaps 6 1.87, flaps 16 2.05, flaps 30 2.25.
- VS1G = √(2W / ρ₀ S CLmax).
- V2 = 1.13 × VS1G (flaps 6), per 25.107.
- VR = V2 − 4 kt; V1 = VR − 2 kt.
- VREF = 1.23 × VS1G (flaps 30), per 25.125.

At MTOW this gives VR 136 / V2 140 KIAS. At 75,000 lb, VREF + 5 is 126 KIAS; AOPA quotes a 116 KIAS landing target
when light.

### Model results (`tests/aircraft/global6000`, this build)

| Test | Result | Target |
|---|---|---|
| MTOW take-off SL ISA, slats/flaps 6 | rotation 136 KIAS, lift-off 148 KIAS; 4,693 ft to 35 ft (× 1.15 = 5,397 ft) | SPEC 6,476 ft (±15 %) |
| Accelerate-stop from V1 at MTOW (GLD + max braking, no reverse) | 6,131 ft | within 15 % of 6,476 ft |
| Stall 78,600 lb clean (slats in) | 133.0 KCAS (shaker 148.3) | 134.8 (±5 %) |
| Stall 78,600 lb slats / flaps 30 | 98.2 KCAS (shaker 105.9) | 100.5 (±5 %) |
| Stall 65,000 lb slats / flaps 30 | 90.3 KCAS | 91.4 (±5 %) |
| Climb MTOW → FL410 (FLC 250 / 300 KIAS / M0.80, A/T CLB) | 18.0 min; 1,260 fpm at FL400 | SPEC initial cruise altitude FL410 (≥ 300 fpm residual) |
| FL410 M0.85 at 96,500 lb | 487.5 KTAS, 3,697 lb/h | SPEC 487 KTAS ± 8 %; fuel flow EST 3,200–4,000 heavy |
| FL410 M0.85 at 78,000 lb | 487.5 KTAS, 3,220 lb/h | AOPA 490 / 3,200 lb/h ± 8 % |
| Vmo / Mmo | overspeed clacker and `alert.overspeed` above 300 / 340 KIAS and the MMO schedule (FL330 0.89, FL470 0.858) | GXAG placard |
| Coupled ILS | CYUL 06L: 0.008 LOC / 0.008 GS (full scale 1), -671 fpm at 200 ft; KTEB 6: 0.010 / 0.010. AP disconnected at 200 ft RA | within 1 dot (0.5 full scale) |
| Approach / touchdown attitude (full-flight check ride, 70,500 lb, VAPP 122) | 3.9° on the glideslope, 7.9° at touchdown | AAIB EW/C2008/08/09 (Global Express N618WF): mean ~4° on the approach, 8° at touchdown |
| Check ride KTEB → KPIT (`verify/fullFlight.test.ts`, 73,300 lb) | lift-off 132 KIAS at 2,266 ft; FL350 in 8.2 min; FL350 M0.85 490 KTAS 3,676 lb/h at 71,600 lb; cabin 3,500 ft / 9.47 psi | EST bands (see §16) |

## 4. Aerodynamics (`fdm.ts`, EST calibration)

- **Lift:** lift-curve slope 0.082 /° including fuselage and tail. The slats add ΔCL 0.45 and delay the stall
  (`ALPHA_STALL_SLATS`).

  | Flaps | CL0 | Stall α | Post-stall CLmax |
  |---|---|---|---|
  | 0 | 0.15 | 14° | 1.25 |
  | 6 | 0.80 | 9° | 1.42 (+ slats) |
  | 16 | 0.80 | 11° | 1.60 (+ slats) |
  | 30 | 0.80 | 11° | 1.80 (+ slats) |

- **Drag:** CD0 0.0165 clean, 0.026 with slats and flaps 6, 0.038 with flaps 16, 0.072 with flaps 30. Gear, spoiler
  and compressibility drag rise above M0.84.
- **Pitch:** T-tail with a trimmable stabilizer: Cm_δe 0.5, Cm_q −30, Cm_trim 0.35.
  - The stabilizer runs 0–14 units = −2° to +12° (GXFC).
  - The take-off green band is 4.5–11 units (GX_10_022).
- **Inertia (EST):** Ixx 300,000, Iyy 780,000, Izz 985,000 kg·m². These are radius-of-gyration estimates for a 30 m,
  45 t aircraft with aft engines. Iyy was raised so that the pusher overshoot stays within 1.15 VS-equivalent α.
- **Contacts:** tail strike at about 13.5° on compressed mains (tail cone contact at x −11.5 m, z −0.35 m); wingtips,
  nacelles, belly and nose contacts.

## 5. Systems

### 5.1 Electrical (GXEL): `systems/electrical.ts`, logic in `systems/logic.ts`

**Sources and bus priorities**

- **AC 115 V, never paralleled.** Sources:
  - VFGs: GEN 1 and GEN 2 on the left engine, GEN 3 and GEN 4 on the right. Each is 40 kVA at 324–596 Hz.
  - APU GEN: 40 kVA, 400 Hz.
  - EXT AC.
  - RAT GEN: 9 kVA. It feeds AC ESS only and sheds below about 147 KIAS in favour of the RAT hydraulic pump.
- **AC bus priorities** (priority `SourceSelector`s, `elec.<sel>_src`):

  | Bus | Priority order |
  |---|---|
  | AC 1 | 1, 4, 3, 2, APU |
  | AC 2 | 2, 3, 4, APU |
  | AC 3 | 3, 2, 1, APU |
  | AC 4 | 4, 1, 2, 3, APU |
  | AC ESS | RAT, 4, 1, 2, 3, APU |

- **Single-VFG operation** (exactly one VFG, no APU GEN or EXT AC) sheds AC 2 and AC 3.
- **DC 28 V: four 150 A TRUs.**
  - TRU 1 is fed from AC 1, ESS TRU 1 from AC 2, TRU 2 from AC 3 and ESS TRU 2 from AC ESS. The feeder mapping is EST.
  - DC bus priorities:

    | Bus | Priority order |
    |---|---|
    | DC 1 | TRU 1, ESS TRU 1 |
    | DC ESS | ESS TRU 1, ESS TRU 2, TRU 2, TRU 1 |
    | BATT BUS | ESS TRU 2, ESS TRU 1, TRU 2, TRU 1 |
    | DC 2 | TRU 2, ESS TRU 2 |

  - With a single TRU, DC 1 and DC 2 are shed.
  - The emergency tie contactor (ETC) joins DC ESS and BATT BUS.
  - DC PWR EMER OVRD bypasses a failed DCPC.
- **Batteries:** AV BATT 24 V 25 Ah and APU BATT 25.2 V 42 Ah, both NiCd.
  - BATT MASTER connects both to the BATT BUS and, through the ETC, to DC ESS. Emergency endurance is at least 15 min.
  - DC EMER is hot from the battery direct buses.
  - EXT DC feeds the APU BATT DIR bus.

**RAT**

- Deploys automatically in flight above 100 KIAS (EST) when all AC is lost or both engines are out. The delay is 14 s,
  or 0 s with both engines out or the slats/flaps out (EST).
- The manual deploy handle latches it out. It re-stows only on the ground (maintenance).

**Loads**

- Loads are EST currents per equipment class, each behind a `cb.<load>` breaker.
- The ACMP breakers are 3-phase 35 A. They are carried as their single-phase equivalent (105 A) because the network
  computes I = VA / V.

`SCOPE:`

- The SSPCs are the network breakers.
- The chargers are modelled as the batteries floating on the BATT BUS.

### 5.2 Fuel (GXFU, TCDS 1.4): `systems/fuel.ts`

- **Tanks:** L main, centre, R main, aft (FDM tank indices 0–3). Each inboard feed cell is modelled as part of its
  main tank.
- **Pumps:**
  - Two AC PRI pumps per side: L FWD on AC 2, R FWD on AC 3, R AFT on AC 4 (GXFU breaker list), and L AFT on AC 1
    (EST). They run continuously with the engine running; the PRI PUMPS PBA inhibits them.
  - DC AUX pumps: L on DC ESS, R on the BATT BUS. They back up a failed AC pump, run for take-off and landing, drive
    wing transfer and feed the APU start.
- **Crossfeed:** XFEED SOV, manual only. The APU draws from the right feed line.
- **Transfers:**
  - Centre → wings with two AC pumps: start below 93 % wing, stop above 97 %.
  - Aft → wings (AUTO) when either wing reaches 5,500 lb, or with ON.
  - Wing to wing with the AUX pumps: automatic at a 400 lb imbalance with the slat/flap lever at 0 IN, or manual
    L→R / R→L.
- **Recirculation:** automatic above 34,000 ft. It biases the wing tank temperature.
- **Messages:**
  - FUEL LO QTY below 600 lb in a wing.
  - FUEL IMBALANCE above 1,100 lb in flight, or 600 lb on the ground / take-off / approach configuration.
  - WING FUEL LO TEMP below −35 °C.
  - FUEL HI TEMP above +54 °C.
- The fire handles close the engine fuel SOVs.
- Tank quantities decrement with burn: `fuel.used_kg` > 1,000 kg over the climb test.

### 5.3 Hydraulics (GXHY): `systems/hydraulic.ts`

**Systems (3,000 psi)**

| System | Pumps | Main users |
|---|---|---|
| 1 | EDP 1A (L engine) + ACMP 1B (AC 3) | left PCUs and rudder, MFS, GS, L reverser |
| 2 | EDP 2A (R engine) + ACMP 2B (AC 2) | right PCUs and rudder, MFS, main gear actuators, R reverser, outboard brakes (accumulator) |
| 3 | ACMP 3A (AC 4, normally ON) + ACMP 3B (AC 1) + RAT pump | all PCUs, GS, gear side-brace / doors / uplocks / nose gear, inboard and park / emergency brakes, NWS |

**Pump logic (`logic.ts`)**

- **ACMP AUTO:** the B pumps run when all of the following hold:
  - the slat/flap lever is out of 0;
  - slat motion has stopped;
  - at least two VFGs are on line.

  They also run when the system's primary pump (A) fails. Once on, they stay on for at least 5 min.
- **On the APU generator alone** (ground), only one ACMP runs at a time.

**Other items**

- **SOVs:** the L / R HYD SOV PBAs and the fire handles close the EDP suction SOVs.
- **Messages:**
  - HYD n LO PRESS when both pumps of a system are below 1,800 psi.
  - HYD n LO QTY.
  - HYD n HI TEMP above 96 °C.
  - HYD RAT PUMP FAIL.
- **Accumulator precharge:** brake 500 psi, RAT 1,000 psi.
- Flow rates and reservoir sizes are EST (EDP 30 gpm, ACMP 6.5 gpm, RAT 5 gpm).

### 5.4 Flight controls (GXFC): `createSystems.ts`, `systems/logic.ts`

**Primary controls and trim**

- **Primary controls:** mechanical cable-signalled PCUs (`MechanicalFlightControls`): 2 per aileron and elevator,
  3 on the rudder. They are powered by the three hydraulic systems (`hydFrac`).
- **Yaw damper:** engages automatically 3 s after AFCS power-up.
- **Stabilizer trim:** 0–14 units, neutral 7, rate 0.5 °/s falling to 0.3 °/s at high Mach. STAB CH 1 / CH 2
  disconnect PBAs.
- **Aileron trim:** split switch.
- **Rudder trim:** rotary.

**High-lift, spoilers and ground lift dumping**

- **Slat/flap lever:** 0 IN (slats in), 0 OUT (slats out, flaps 0), 6, 16, 30. The slats are sequenced before the
  flaps.
- **Flight spoiler lever:** RETRACT / 1/4 / 1/2 / FULL / MAX. The multifunction spoilers are limited with the flaps
  out (EST schedule).
- **Ground lift dumping:** auto-arms with both thrust levers below 30° TLA in the air, or with MAN ARM. It deploys at
  RA < 7 ft with wheel speed > 16 kt, latches at 45 kt, and disarms after 40 s (GXFC).

**Stall protection (SPC)**

- The configuration index is flaps (°) + 100 × slats, and sets the stall angle.
- Shaker at 0.8 and pusher at 0.9 of the stall angle of attack. The pusher drives both columns fully forward
  (EST −1.3 command).
- Inhibited below 70 KCAS.
- STALL PUSHER switches on both side panels.

### 5.5 Landing gear, brakes, steering (GXLG)

- **LGECU:** retraction on system 2, doors and uplocks on system 3. GEAR DISAGREE after 28 s.
- **Handle:** the DN LCK REL PBA overrides the handle solenoid. The manual release handle gives free fall.
- **Nose-wheel steering:** tiller ±75°, pedals ±7.5°.
- **Autobrake:** LO / MED / HI = 4 / 8 / 13 ft/s².
- **PARK/EMER BRAKE handle:** proportional emergency braking below the parking lock.
- **BTMS:** brake temperature monitoring, with BRAKE OVHT and a RESET.
- **Gear horn:** HORN MUTED is available only with both RAs invalid.
- **Take-off configuration:** red "NO TAKEOFF" CONFIG messages for flaps, stabilizer, aileron and rudder trim,
  spoilers and PARK BRAKE ON.

### 5.6 APU: Honeywell RE220 GX (GXAPU, TCDS 5.2)

- **Control:** single rotary OFF / RUN / START.
  - RUN opens the inlet door and runs the prestart BIT.
  - START is spring-loaded back to RUN.
- **Envelope and starting:**
  - The starter runs from the APU battery; starter cut-out at 46 %.
  - Start envelope 37,000 ft; operating envelope 45,000 ft; APU bleed to 30,000 ft (about 45 psi).
  - EGT start limit 1,020 °C; 60 s cooldown.
- **Fire:** an APU fire shuts the APU down automatically on the ground.

### 5.7 Bleed air, air conditioning, pressurization (IAMS; architecture EST)

**Bleed and air conditioning**

- **Bleed sources:** each engine's HP/LP bleed feeds its own duct through a PRSOV. The APU load control valve feeds
  the left duct.
- **Crossbleed (XBLEED):** in AUTO it opens for starts and with a single bleed source.
- **Engine starters:** air-turbine starters sit on each duct and need about 35 psi.
- **Packs and zones:**
  - L / R PACK, TRIM AIR, RECIRC and RAM AIR switches.
  - PACK CONTROL MAN TEMP knobs.
  - Three temperature zones (cockpit, forward cabin, aft cabin), 16–30 °C.

**Pressurization (`PRESS_GLOBAL6000`)**

- **Schedule:** 4,500 ft cabin at FL450 (AOPA); 10.33 psid maximum (EST).
- **Modes:**
  - AUTO uses the FMS landing elevation.
  - MAN drives the outflow valves with MAN ALT UP / DN at the MAN RATE setting.
- **Other controls:** OUTFLOW VALVE 1 / 2 CLOSED, EMERG DEPRESS and DITCHING (guarded).
- **Placard limits:** 0.1 psi taxi and 1.0 psi landing differential (GX_01_018).

### 5.8 Ice and rain

- **WING and L / R COWL anti-ice:** OFF / AUTO / ON, with the ice detectors driving AUTO. WING XBLEED lets one bleed
  supply both wings.
- **Windshield heat:** L / R windshield PBAs; the side windows follow.
- **Probe heat:** the probes and AOA vanes are heated automatically by the HBMU.

### 5.9 Fire (GXFP)

- **Detection:** FIDEEX dual loops on the engines and APU; single loops in the main wheel wells (MLG BAY OVHT).
- **Extinguishing:** two bottles, each able to discharge into either engine or the APU (DISCH 1 → bottle 1,
  DISCH 2 → bottle 2).
- **Fire handles:** pulling a handle arms the squibs and closes:
  - the engine fuel SOV (`fuelCut`);
  - the hydraulic SOV (`hyd.sovN_open`);
  - the bleed.

  The status messages are L/R ENG SOV CLSD and ENG BLEED OFF.
- **Test:** EMS CDU FIRE TEST.

### 5.10 Oxygen

- **Crew:** quick-donning masks with regulator N / 100 % / EMERGENCY. The crew bottle is EST 115 ft³ at 1,850 psi.
- **Passengers:** PASSENGER OXYGEN CLOSED / NORMAL / OVERRIDE. NORMAL deploys automatically at 14,000 ft cabin (EST).

### 5.11 Avionics (FUSION, FSB)

**Suite composition**

- Collins Pro Line Fusion (`createFusionSuite`, `GLOBAL6000_AIRFRAME`, `BR710A2_20_ENGINES`):
  - four AFD-6520 displays in a T arrangement;
  - FCP-5120;
  - 2 CTP, 2 CCP, 2 MKP, 2 RSP;
  - IESI.
- The aircraft builds its own `Radios` and `Fms` and passes them to the suite. The synoptics read the aircraft vars
  (`synopticBindings`).

**AFCS**

- `Afcs` is configured with `AFCS_PROLINE_FUSION`:
  - bank limit 27°, or 17° with HALF BANK; low bank is automatic above 35,050 ft (GXAF);
  - roll rate 7.5 °/s;
  - pitch ±20°;
  - VS −8,000 / +6,000 fpm.
- APPR switches the AFCS nav source to the localizer. The Fusion FCP performs a nav-to-nav transfer when the PFD
  source is FMS and an ILS approach is loaded.
- Pressing the FCP AT button engages the autothrottle.
- EDM (emergency descent mode).
- AFCS options (set by the check-ride verification, §16): armed LNAV / LOC captures only once airborne
  (`nav.groundCapture: false`, the TO lateral mode holds the runway track); VNAV climbs in VFLC (`vnavClimb`); VNAV never
  descends through the FCP altitude (`altvBoundBySel`); the VNAV modes and the A/T fly the FCP speed, which the Fusion FCP
  fills with the FMS speed in SPD FMS (`vnavSpeedFromSelected`); AoA feed-forward filter 4 s (`alphaTauS`).
- The Fusion PERF INIT / VNAV SETUP defaults are the Global's: BOW 52,230 lb (SPEC), climb 300 KIAS / M0.80, cruise
  M0.85, descent M0.85 / 300 KIAS (EST, `FMS_SPEEDS` in createSystems.ts); 250 KIAS below 10,000 ft by the FMS.

**Sensors, TAWS and CAS**

- **Sensors:** ADC ×2, IRS ×3 (OFF / ALN / NAV / ATT), standby AHRS (IESI), RA ×2.
- **Surveillance:** TAWS (EGPWS with TERR OFF, G/S WARN MUTED, FLAP OVRD) and TCAS.
- **CAS:** `CasManager` with `G6K_CAS` (146 message definitions).
  - Voices and chimes go through the IAC aural channels (AURAL MUTE: §12.1).
  - Take-off inhibit from 80 kt to 400 ft (or 30 s after lift-off); landing inhibit below 200 ft RA until 60 kt (EST).

## 6. CAS (`systems/cas.ts`)

**Message texts and colours**

- Texts are in upper case, as on the Global EICAS.
- Where the text differs from the public GX manuals or comes from the Fusion `GLOBAL_CAS_TEXTS`, it is marked EST in
  the file. The main groups:

  | Colour | Level | Main groups |
  |---|---|---|
  | Red | warnings | L/R ENG FIRE, APU FIRE, MLG BAY OVHT, L/R ENG OIL PRESS, CONFIG STAB TRIM / AIL TRIM / RUD TRIM / FLAPS / SPOILERS, PARK BRAKE ON, GEAR, NORM BRAKE FAIL, BRAKE OVHT, CABIN ALT, CABIN DELTA P, ENGINE EXCEEDANCE |
  | Amber | cautions | EMER PWR ONLY, AC BUS n FAIL, AC ESS BUS FAIL, GEN n OVLD, RAT GEN FAIL, DC BUS 1/2 FAIL, DC ESS BUS FAIL, BATT BUS FAIL, DC EMER BUS FAIL, BATT MASTER OFF, APU/AV BATT FAIL, HYD n LO PRESS / LO QTY / HI TEMP, HYD RAT PUMP FAIL, FUEL LO QTY, FUEL IMBALANCE, L/R PRI FUEL PUMPS, L/R ENG FUEL SOV, WING FUEL LO/HI TEMP, CTR FUEL XFER FAIL, AFT XFER FAIL, XFEED VALVE FAIL, L/R ENG FLAMEOUT, ENG OIL LO PRESS, ENG START ABORT, ENG FIRE FAIL, REV UNLOCKED, FIRE BTL1/2 LO PRESS, APU OVERTEMP / OVERSPEED / OIL LO PRESS, STALL PROTECT FAIL, FLAP FAIL, SLAT FAIL, YD OFF, STAB TRIM FAIL, GLD FAIL, GEAR DISAGREE, PARK/EMER BRAKE ON, INBD / OUTBD BRK LO PRESS, NOSE STEER FAIL, AUTOBRAKE FAIL, GEAR SYS FAIL, NOSE DOOR, door messages, BLEED FAIL, PACK FAIL, CABIN PRESS AUTO FAIL, WING / COWL A/ICE FAIL, WSHLD HEAT FAIL, ICE |
  | Cyan | advisories | GEN n FAIL, APU GEN FAIL, TRU n FAIL, RAT GEN ON, BATTERY EMER PWR ON, ACMP / pump ON, transfers, ignition, anti-ice ON |
  | White | status | GEN n OFF, APU GEN OFF, RAT GEN OFF, DC BUS MAN OFF, ENG SOV CLSD, ENG BLEED OFF, APU FUEL SOV CLSD, PARKING BRAKE, N1 MODE, … |

**Warning behaviour**

- The warnings have aural callouts: "LEFT ENGINE FIRE", "NO TAKEOFF", "GEAR", "CABIN PRESSURE", and others.
- Master WARNING and master CAUTION are acknowledged with the `cas.ack_warning` / `cas.ack_caution` events.

## 7. Normal procedures (abridged, `checklists.ts`)

The full sequence is in `checklists.ts`. Auto-checks verify the switch positions and system state live.

1. **COCKPIT PREPARATION:**
   1. BATT MASTER ON, DC buses powered.
   2. EMER LIGHTS ARM, PARK/EMER BRAKE SET, gear handle DN.
   3. ENG RUN switches OFF, thrust levers IDLE, fire handles IN, EMS CDU FIRE TEST.
   4. APU START, then AVAIL; APU GEN on line.
   5. IRS 1 / 2 / 3 NAV.
   6. HYD 1B / 2B / 3B AUTO, HYD 3A ON.
2. **BEFORE START:**
   1. Doors closed, beacon ON.
   2. APU BLEED AUTO, XBLEED AUTO.
   3. PRI / AUX pumps normal.
3. **ENGINE START** (right engine first, EST):
   1. ENG RUN R, R START PBA.
   2. Monitor light-off (< 15 s), ITT (< 700 °C) and N2 to about 60 %.
   3. Repeat for the left engine.
4. **AFTER START:**
   1. GEN 1–4 on line, APU as required.
   2. Hydraulics 3,000 psi.
   3. Anti-ice as required.
5. **BEFORE TAKEOFF:**
   1. Slats/flaps 6 or 16, stabilizer trim in the green band, spoilers RETRACT.
   2. GLD armed, autobrake OFF (RTO: EST), NWS ARMED.
   3. Transponder / TCAS, no CONFIG messages.
6. **AFTER TAKEOFF:**
   1. Gear UP.
   2. Slats/flaps 0 IN.
   3. A/T CLB.
7. **DESCENT, APPROACH and LANDING:**
   1. Landing elevation, autobrake.
   2. Slats/flaps 16, then gear DN, then flaps 30.
   3. VREF + 5.
8. **AFTER LANDING:**
   1. Spoilers RETRACT.
   2. Slats/flaps 0 IN.
   3. APU as required.
9. **SHUTDOWN:**
   1. PARK BRAKE.
   2. ENG RUN OFF.
   3. BATT MASTER OFF.

In the headless start test (`start.test.ts`):

- The APU is AVAIL in under 60 s.
- The engines light off in under 15 s and reach idle in under 60 s.
- Peak start ITT is under 700 °C.
- The battery bus stays above 24 V during the air starts.

## 8. Non-normal procedures (abridged)

| CAS | Memory / QRH items (EST wording) | Model reaction verified in `failures.test.ts` |
|---|---|---|
| L/R ENG FIRE | Thrust lever IDLE, ENG RUN OFF, fire handle PULL, DISCH bottle 1; bottle 2 after 30 s if the warning persists | fuel, hydraulic SOV and bleed close; bottle discharged → FIRE BTL LO PRESS; the other side's VFGs carry all AC buses; ACMP B keeps the system pressurized |
| APU FIRE | APU fire handle, DISCH | automatic APU shutdown on the ground |
| GEN n FAIL | none (automatic transfer) | the bus transfers by priority, no bus loss |
| EMER PWR ONLY | RAT deploys (auto), land as soon as practicable | RAT GEN powers AC ESS, the RAT pump powers system 3 |
| HYD n LO PRESS | check the ACMP ON, land at the nearest suitable airport | EDP failure → ACMP B takes over; a leak → LO PRESS + LO QTY |
| CONFIG … (NO TAKEOFF) | reject the take-off or correct the configuration | flaps 0 at take-off thrust raises CONFIG FLAPS |

## 9. Initial states (`states.ts`)

| State | Engines | Configuration |
|---|---|---|
| `cold_dark` | off | every switch OFF / normal, BATT MASTER OFF, PARK BRAKE set, doors closed, gear handle DN |
| `ready_to_taxi` | both idle | VFGs on line, IRS NAV, hydraulics AUTO / 3A ON, slats/flaps 6, park brake set |
| `takeoff` | both idle | on the runway, slats/flaps 6, stabilizer 7.5 units (green band), GLD armed, NWS ARMED, landing lights ON |
| `cruise` | trimmed thrust | slats/flaps 0 IN, gear UP, AP HDG + ALT, A/T SPD / MACH, stabilizer at the `computeTrim` pitch trim |
| `approach` | trimmed thrust | slats/flaps 30, gear DN, autobrake MED, landing lights ON |

- **In-air states:** the aircraft is repositioned with the state's configuration, then:
  1. `FlightModel.computeTrim` runs.
  2. The thrust levers are set from `n1ForThrust`.
  3. The stabilizer is set from the trim result.
- **Checks:** `states.test.ts` checks that each state holds altitude within 200 ft and speed within 8 kt for 30 s,
  with no master warning or caution.

## 10. Panel geometry, eye point, windshield (EST)

**Body frame (`fdm.ts`)**

- The origin is the empty-weight CG with the gear down; x is forward, y right, z down.
- The TCDS datum FS 0 is 144 in ahead of the nose; it is not used in the FDM.
- The nose tip is at about x = +14.3 m (EST: 30.30 m length, CG about 16 m aft of the nose).

| Item | Position (body frame) | Size | Notes |
|---|---|---|---|
| Pilot / copilot design eye | x +10.9, y ∓0.49, z −1.02 m | — | GXAG GX_01_005: eye 0.49 m off the centreline, 3.14 m above the ramp (`eyeHeightOnGround_m`); seats at x 10.6 m |
| Windshield | two main panes (L / R, heated, `wshld_l` / `wshld_r`) and two side windows each side (`wshld_s`, heated side windows) | main pane EST 0.95 m wide × 0.60 m high, sloped about 30° from horizontal | the lower edge is about 0.25 m below the eye and 0.85 m ahead; the centre post is on the centreline |
| Glareshield | 0.70 m ahead of the eye, 0.05 m below it | full width 1.9 m | FCP-5120 centred (0.62 × 0.08 m, `FUSION_HW.fcp`); CTP 1 / CTP 2 either side (0.20 × 0.08 m, centres y ∓0.50); MASTER WARNING / CAUTION outboard at y ∓0.80 |
| Main instrument panel | plane 0.78 m ahead of the eye, tilted 12° aft at the top | 1.9 m wide | AFD 15.1 in (0.307 × 0.192 m active, `FUSION_HW.afd`) with 14–22 mm bezels |
| AFD 1 / 4 (PFDs) | centres y ∓0.62, 0.22 m below the eye | 0.335 × 0.228 m with the bezel | in front of each pilot, landscape |
| AFD 2 (upper centre) | centre y 0, 0.20 m below the eye | same | EICAS / MFD |
| AFD 3 (lower centre) | centre y 0, 0.45 m below the eye | same | T arrangement (FUSION) |
| IESI | y −0.28, 0.30 m below the eye | 0.085 × 0.095 m | left of the lower centre AFD |
| Gear handle panel | y +0.28, 0.38 m below the eye, right of AFD 3 | 0.12 × 0.18 m | gear handle, DN LCK REL, HORN MUTED, NOSE STEER |
| Pedestal forward | 0.55 m ahead of the eye, 0.55 m below it, between the seats | 0.42 m wide | CCP 1 / CCP 2 (0.11 × 0.15 m) at y ∓0.12; MKP 1 / MKP 2 (0.15 × 0.12 m) ahead of them |
| Pedestal centre | 0.35 m ahead of the eye, 0.60 m below it | | thrust levers with piggy-back reverse levers, A/T disconnect and TO/GA buttons; ENG RUN L / R below; ENGINE EPR/N1 PBAs; slat/flap lever (right); flight spoiler lever (left); STAB CH 1 / 2; AIL / RUD trim; PARK/EMER BRAKE handle (left rear) |
| Pedestal aft | 0.10 m ahead of the eye, 0.62 m below it | | AUTOBRAKE, GLD MAN ARM / OFF, EGPWS panel (TERR OFF, G/S WARN MUTED, FLAP OVRD), DC PWR EMER OVRD (guarded), IRS 1/2/3 mode selectors, cockpit lights (FLOOD / DISPLAY, INTEGRAL / MISC), RAT manual deploy handle |
| Overhead | from 0.25 m ahead to 0.35 m behind the eye, 0.50–0.60 m above it, sloping down forward | 0.80 m wide | GX_01_018 layout (§12.1): forward edge L ENG FIRE / APU FIRE / R ENG FIRE handles, then ELECTRICAL, HYDRAULIC, FUEL, BLEED / AIR COND, ANTI-ICE, PRESSURIZATION, ENGINE / APU, EXTERNAL LIGHTS, PASS SIGNS |
| Side panels | outboard of each seat, 0.35 m ahead of the eye, 0.45 m below it | 0.20 × 0.15 m | RSP (0.10 × 0.06 m), STALL PUSHER switch, oxygen mask stowage, map light, NOSE STEER tiller (pilot side), HUD (optional) |
| Control wheels | 0.45 m ahead of each eye, 0.40 m below it | 0.38 m wide | AP / YD / trim disconnect, pitch trim (split), PTT, TO/GA on the levers, FPV CAGE (Fusion), chronometer |

## 11. Implementation map

| File | Contents |
|---|---|
| `data.ts` | `G6K_LIMITS`, VMO / MMO schedules, slat/flap detents, stabilizer units, CLmax and V-speeds |
| `vars.ts` | `G6K_VARS` (controls and derived vars), `G6K_CONTROL_VARS` (audit list), `G6K_EVENTS` |
| `fdm.ts` | `GLOBAL6000_FDM` (geometry, aero tables, BR710 engines, gear, tanks, stations, contacts) |
| `systems/electrical.ts` | `createElectrical` (network, priority selectors, bus power control, settle) |
| `systems/fuel.ts` | four tanks, PRI / AUX pumps, crossfeed, transfers |
| `systems/hydraulic.ts` | systems 1–3, EDPs, ACMPs, RAT pump, consumers |
| `systems/environment.ts` | pneumatics, pressurization, ice, APU, fire, oxygen |
| `systems/engines.ts` | FADEC ratings and lever law, start controllers, autothrottle |
| `systems/logic.ts` | `G6kLogic` (bus shedding, RAT, ACMP AUTO, FMQGC, IAMS, spoilers / GLD, SPC, brakes, BTMS, config); `G6kPostLogic` (engine fail latch, YD auto-engage, G/S cancel bridge) |
| `systems/cas.ts` | `G6K_CAS` |
| `systems/lighting.ts` | exterior and interior lighting and dimmers (display brightness to `display.fusion.*.brt`) |
| `createSystems.ts` | composition and update order; Fusion suite; radios / FMS; AFCS; A/T; stall; overspeed with the MMO schedule; TAWS; TCAS; CAS with IAC aural gating; failures |
| `states.ts` | `applyG6kState` (every switch set per state, in-air trim) |
| `checklists.ts` | `G6K_CHECKLISTS`, `G6K_CAS_CHECKLISTS` |
| `meta.ts`, `inputMap.ts` | catalogue metadata; input bindings (reverse, flap detents 0–4, speedbrake detents, AP toggle event) |
| `tests/aircraft/global6000/*` | start (a), performance (b–e), approach (f), failures (g), states and control audit |

## 12. Cockpit control inventory

**Table conventions**

- `V.` names refer to `G6K_VARS` in `vars.ts`.
- Plain names are the literal var names.
- Momentary controls write 1 while held and 0 on release.
- PBA = push-button annunciator (switchlight).
- Positions and sizes are EST from GX_01_018 and Global 6000 cockpit photographs, using the §10 frame.

### 12.1 Overhead panel (GX_01_018), forward to aft

| Panel | Label | Type | Positions (value) | Spring / guard | Lighting | Var | Location / size |
|---|---|---|---|---|---|---|---|
| FIRE | L ENG FIRE / APU FIRE / R ENG FIRE handles | T-handle, pull | 0 stowed / 1 pulled | — | red FIRE in the handle | `V.fireHandle('l'/'apu'/'r')` = `ac.g6k.fire.<z>_handle` | forward edge, left / centre / right, 80 × 30 mm handles |
| FIRE | DISCH 1 / DISCH 2 (under each handle) | PBA | momentary 1 | armed only with the handle pulled | DISCH amber when the bottle is empty | `V.fireDisch(z, 1/2)` | under each handle, 20 mm squares |
| ELECTRICAL | EXT AC | PBA | 1 ON | — | AVAIL (cart) / ON | `ac.elec.ext_ac_sw` (cart `V.extAcAvail`) | top-left group, 20 mm squares |
| ELECTRICAL | GEN 1 / GEN 2 / GEN 3 / GEN 4 | PBA | 1 normal / 0 OFF (OFF → ON resets the GCU) | — | OFF white, FAIL amber | `ac.elec.gen{n}_sw` | row of four |
| ELECTRICAL | APU GEN | PBA | 1 normal / 0 OFF | — | OFF / FAIL | `ac.elec.apu_gen_sw` | centre |
| ELECTRICAL | RAT GEN | PBA | 1 normal / 0 OFF | — | ON when on line | `ac.elec.rat_gen_sw` | right |
| ELECTRICAL | EXT DC | PBA | 1 ON | — | AVAIL / ON | `ac.elec.ext_dc_sw` (unit `V.extDcAvail`) | |
| ELECTRICAL | BATT MASTER | toggle | 1 ON / 0 OFF | — | — | `ac.elec.batt_master_sw` | lower left, 15 mm lever |
| ELECTRICAL | CABIN PWR | toggle | 1 ON | — | — | `ac.elec.cabin_pwr_sw` | lower right |
| EMS CDU (EMER CNTL page) | AC BUS 1–4 / DC BUS 1, 2, DC ESS, BATT BUS MAN OFF | soft keys | 1 isolated | — | MAN OFF on the page, status CAS | `ac.elec.ac_bus{n}_isol`, `ac.elec.<bus>_isol` | EMS CDU (EST: pedestal) |
| WINDSHIELD HEAT | L / R | PBA | 1 ON / 0 OFF-RESET | — | OFF / FAIL | `ac.ice.wshld_l_sw`, `ac.ice.wshld_r_sw` | |
| HYDRAULIC | L / R HYD SOV | PBA | 0 open / 1 CLOSED | — | CLOSED white | `ac.hyd.sov_l_sw`, `ac.hyd.sov_r_sw` | |
| HYDRAULIC | PUMP 1B / 2B / 3B | rotary | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.hyd.pump1b_sw` / `2b` / `3b` | 25 mm knobs |
| HYDRAULIC | PUMP 3A | toggle | 0 OFF / 2 ON | — | — | `ac.hyd.pump3a_sw` | |
| AURAL WARNING | IAC 1 / IAC 2 MUTED | PBA | 1 muted | — | MUTED white | `V.auralMute(1/2)` | the CAS voices / chimes go silent only with both muted (`SCOPE`, createSystems.ts) |
| FUEL | L / R PRI PUMPS | PBA | 1 normal / 0 OFF | — | OFF / FAIL | `ac.fuel.pri_l_sw`, `ac.fuel.pri_r_sw` | |
| FUEL | L / R AUX PUMP | PBA | 1 normal / 0 OFF | — | ON / FAIL | `ac.fuel.aux_l_sw`, `ac.fuel.aux_r_sw` | |
| FUEL | XFEED | PBA | 1 OPEN | — | OPEN | `ac.fuel.xfeed_sw` | |
| FUEL | L / R RECIRC | PBA | 1 normal / 0 OFF | — | OFF | `ac.fuel.recirc_l_sw`, `ac.fuel.recirc_r_sw` | |
| FUEL | AFT XFER | rotary | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.fuel.aft_xfer_sw` | |
| FUEL | WING XFER | rotary | 0 OFF / 1 AUTO / 2 L→R / 3 R→L | — | — | `ac.fuel.wing_xfer_sw` | |
| BLEED / AIR COND | L / R ENG BLEED | rotary | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.bleed.l_sw`, `ac.bleed.r_sw` | |
| BLEED / AIR COND | APU BLEED | rotary | 0 CLSD / 1 AUTO / 2 OPEN | — | — | `ac.bleed.apu_sw` | |
| BLEED / AIR COND | XBLEED | rotary | 0 CLSD / 1 AUTO / 2 OPEN | — | — | `ac.bleed.xbleed_sw` | |
| BLEED / AIR COND | L / R PACK | PBA | 1 normal / 0 OFF | — | OFF / FAIL | `ac.ecs.pack_l_sw`, `ac.ecs.pack_r_sw` | |
| BLEED / AIR COND | TRIM AIR, RECIRC | PBA | 1 normal / 0 OFF | — | OFF | `ac.ecs.trim_air_sw`, `ac.ecs.recirc_sw` | |
| BLEED / AIR COND | RAM AIR | PBA | 1 ON | guarded | ON | `ac.ecs.ram_air_sw` | |
| BLEED / AIR COND | PACK CONTROL L / R MAN TEMP | knob | 0 AUTO (full CCW), 0.05–1 COLD → HOT | — | — | `V.packManTemp('l'/'r')` | |
| BLEED / AIR COND | TEMPERATURE COCKPIT / FWD CABIN / AFT CABIN | knob | 16–30 °C | — | — | `ac.ecs.zone{1,2,3}_temp_c` | |
| ANTI-ICE | WING | rotary | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.ice.wing_sw` | |
| ANTI-ICE | L / R COWL | rotary | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.ice.cowl_l_sw`, `ac.ice.cowl_r_sw` | |
| ANTI-ICE | WING XBLEED | PBA | 1 ON | — | ON | `V.wingXbleed` | |
| PRESSURIZATION | AUTO / MAN | PBA | 0 AUTO / 2 MAN | — | MAN | `ac.press.mode_sw` | |
| PRESSURIZATION | MAN ALT | toggle | −1 DN / 0 / +1 UP | spring to centre | — | `ac.press.manual_cmd` | |
| PRESSURIZATION | MAN RATE | knob | 0 LOW … 1 HIGH | — | — | `V.pressManRate` | |
| PRESSURIZATION | LDG ELEV FMS / MAN, LDG ELEV knob | PBA + knob | 1 FMS / 0 MAN; −1,000 … 14,000 ft | — | MAN | `V.ldgElevFms`, `ac.press.ldg_elev_ft` | |
| PRESSURIZATION | OUTFLOW VALVE 1 / 2 CLOSED | PBA | 1 closed | — | CLOSED | `V.outflowClosed(1/2)` | |
| PRESSURIZATION | EMERG DEPRESS | PBA | 1 ON | guarded (`V.emerDepressGuard`) | ON | `ac.press.dump_sw` | |
| PRESSURIZATION | DITCHING | PBA | 1 ON | guarded | ON | `V.ditching` | |
| ENGINE | L / R START | PBA | momentary 1 (FADEC auto start) | spring | IN PROG | `V.engStart(1/2)` | |
| ENGINE | L / R CRANK | PBA | 1 crank (alternate action) | — | ON | `V.engCrank(1/2)` | |
| ENGINE | IGNITION | PBA | 1 ON (continuous) / 0 AUTO | — | ON | `ac.eng.ign_sw` | |
| APU | APU | rotary | 0 OFF / 1 RUN / 2 START | START springs back to RUN | — | `ac.apu.master_sw` | |
| EXTERNAL LIGHTS | LANDING L WING / NLG / R WING | toggles | 1 ON | — | — | `ac.light.landing_l_sw`, `…_nose_sw`, `…_r_sw` | aft row |
| EXTERNAL LIGHTS | TAXI/RECOG, NAV, BEACON, STROBE, WING INSP, LOGO | toggles | 1 ON | — | — | `ac.light.taxi_sw`, `nav_sw`, `beacon_sw`, `strobe_sw`, `wing_sw`, `logo_sw` | |
| PASS SIGNS | NO SMKG / SEAT BLTS | toggles | 0 OFF / 1 AUTO / 2 ON | — | — | `ac.cabin.nosmoke_sw`, `ac.cabin.seatbelt_sw` | |
| EMER LIGHTS | EMER LIGHTS | toggle | 0 OFF / 1 ARM / 2 ON | guarded at ARM | — | `ac.light.emer_sw` | |
| ELT | ELT | toggle | 0 ARM / 1 ON | guarded | — | `V.elt` | |
| COCKPIT | DOME | toggle | 1 ON | — | — | `ac.light.dome_sw` | aft edge |

### 12.2 Glareshield

| Label | Type | Positions | Spring / guard | Lighting | Var / event | Location |
|---|---|---|---|---|---|---|
| FCP-5120: FD 1 / 2, CPL, AP, YD, AT, HDG, NAV, APPR, BC, BANK, FLC, VS, VNAV, ALT, SPD MAN/FMS, EDM | PBAs | momentary | spring | bar lights `ap.btn_*`, `ap.at_engaged`, `fusion.edm` | events `fusion.fcp.<id>` (FCP_BUTTONS) | centre, 0.62 × 0.08 m |
| FCP knobs HDG (PUSH SYNC), CRS 1 / CRS 2 (PUSH DCT), SPD (PUSH IAS/MACH), ALT (PUSH FINE), pitch wheel | knobs / wheel | clicks | — | — | `fusion.fcp.<knob>_inc/_dec`, `…_push` | FCP |
| CTP 1 / CTP 2 | keys, LSKs, TUNE outer / inner, BARO, MINS | momentary | — | — | `fusion.ctp{s}.*` | 0.20 × 0.08 m, y ∓0.50 |
| MASTER WARNING / MASTER CAUTION | PBA | momentary (acknowledge) | — | red / amber flashing | events `cas.ack_warning` / `cas.ack_caution`; lights `alert.master_warning` / `alert.master_caution` | outboard, y ∓0.80, 30 × 25 mm |

### 12.3 Main instrument panel

| Label | Type | Positions | Var | Location |
|---|---|---|---|---|
| AFD 1–4 | displays | — | `display.fusion.afdN.power` / `.brt` | §10 |
| IESI with BARO knob (push STD) | display + knob | clicks | `fusion.iesi.baro_inc/_dec/_push` | §10 |
| LDG GEAR handle | wheel-shaped lever | 1 DN / 0 UP | `V.gearHandle` = `ac.g6k.gear_handle` | right centre panel, 60 mm wheel |
| DN LCK REL | PBA | momentary 1 | `V.gearDnLckRel` | beside the handle |
| HORN MUTED | PBA | 1 muted (only with both RAs invalid) | `V.hornMute` | beside the handle |
| NOSE STEER | PBA | 1 ARMED / 0 OFF | `V.nwsArm` | beside the handle |
| BTMS OVHT WARN RESET | PBA | momentary 1 | `V.btmsReset` | beside the handle |
| Gear lights | 3 green / red | — | `gear.*` (LGECU) | above the handle |

### 12.4 Pedestal

| Label | Type | Positions | Spring / guard | Var | Location |
|---|---|---|---|---|---|
| Thrust levers L / R | levers | 0 IDLE … 1 MAX (one MAX detent; take-off minimum 0.67) | — | `ac.tla1`, `ac.tla2` | centre, 0.18 m apart |
| Reverse levers (piggy-back) | levers | 0 stowed … 1 MAX REV (IDLE REV about 0.1); only at thrust lever IDLE on the ground | — | `V.revLever(1/2)` | on the thrust levers |
| A/T disconnect, TO/GA | buttons on the levers | momentary | spring | `input.at_disc`, `input.toga` | |
| ENG RUN L / R | toggles (lift to move) | 1 RUN / 0 OFF | lift-lock | `V.engRun(1/2)` | below the levers |
| ENGINE EPR / N1 | PBAs | 0 EPR / 1 N1 | — | `ac.eng1.n1_mode`, `ac.eng2.n1_mode` | |
| SLAT/FLAP lever | lever | 0 (0 IN) / 1 (0 OUT) / 2 (6) / 3 (16) / 4 (30) | latch at 0 IN and 30, gates at 0 OUT and 6 | `ac.flap_lever` | right of the levers |
| FLIGHT SPOILER lever | lever | 0 RETRACT / 0.25 1/4 / 0.5 1/2 / 0.8 FULL / 1.0 MAX | detents | `V.flightSpoiler` | left of the levers |
| STAB CH 1 / CH 2 | PBAs | 1 = disconnected | guarded | `V.stabCh(1/2)` | aft |
| AIL trim | split switch | −1 LWD / 0 / +1 RWD | spring to centre | `V.ailTrimSw` | aft |
| RUD trim | rotary | −1 NL / 0 / +1 NR | spring to centre | `V.rudTrimSw` | aft |
| PARK/EMER BRAKE | handle | 0 stowed … 1 locked (proportional below the lock) | — | `V.parkBrake` | left rear |
| AUTOBRAKE | rotary | 0 OFF / 1 LO / 2 MED / 3 HI | solenoid-held | `ac.autobrake_sel` | aft |
| GND LIFT DUMPING MAN ARM / OFF | PBAs | 1 | — | `V.gldManArm`, `V.gldOff` | aft |
| EGPWS: TERR OFF, G/S WARN MUTED, FLAP OVRD | PBAs | 1 OFF / momentary / 1 OVRD | FLAP OVRD guarded | `V.terrOff`, `V.gsMute`, `V.flapOvrd` (guard `V.flapOvrdGuard`) | aft |
| DC PWR EMER OVRD | PBA | 1 OVRD | guarded (`V.dcEmerOvrdGuard`) | `V.dcEmerOvrd` | aft |
| RAT manual deploy | T-handle | 1 pulled | latched | `V.ratDeploy` | aft floor |
| IRS 1 / 2 / 3 | rotaries | 0 OFF / 1 ALN / 2 NAV / 3 ATT | — | `ac.irs1_mode` … `ac.irs3_mode` | aft |
| CCP 1 / 2 | trackball, ENTER, MENU, BACK, DSP keys, DATA knob | — | — | `fusion.ccp{s}.*` | forward, y ∓0.12 |
| MKP 1 / 2 | keyboards | — | — | `fusion.mkp{s}.key` | forward |
| COCKPIT LIGHTS: FLOOD L / CTR / R, DISPLAY L / CTR / R, INTEGRAL L / CTR / R / CB / OVHD, MASTER DIM, map lights | knobs, toggle | 0 … 1; MASTER 0 OFF / 1 DIM / 2 BRT | — | `V.ltFlood(z)`, `V.ltDisplay(z)`, `V.ltIntegral(z)`, `V.ltMaster`, `V.ltMap(1/2)` | aft (the DISPLAY knobs set the AFD brightness) |
| LAMP TEST | PBA | momentary 1 | spring | `alert.annun_test` | lighting panel |
| EMS CDU TEST: FIRE TEST, STALL TEST | soft keys | momentary 1 | — | `V.fireTest`, `V.stallTest` | EMS CDU |

### 12.5 Side panels, control wheels, others

| Label | Type | Positions | Var | Location |
|---|---|---|---|---|
| STALL PUSHER (pilot / copilot) | toggle | 1 ON / 0 OFF | `V.pusher(1/2)` | side panels |
| RSP 1 / 2 (ADC, ATT/HDG, DSPL, AFCS) | switches | Fusion RSP | Fusion RSP vars | side panels |
| Oxygen masks | stowage box | 1 in use | `V.oxyMask(1/2)`, regulator `V.oxyMaskMode` (0 N / 1 100 % / 2 EMER) | outboard |
| Crew oxygen supply | valve | 1 ON | `ac.oxy.crew_sw` | side panel |
| PASSENGER OXYGEN | rotary | 0 CLOSED / 1 NORMAL / 2 OVERRIDE | `ac.oxy.pax_sw` | side panel |
| NOSE STEER tiller | handwheel | ±75° | `input.tiller` | pilot side console |
| HUD power (optional) | toggle | 1 ON | `V.hudPower` | copilot / pilot side |
| Control wheel: AP/SP DISC, pitch trim (split), TCS, PTT, FPV CAGE, chronometer | switches | momentary | `input.ap_disc`, `input.pitch_trim_rate`, `fusion.s{s}.fpv_cage`, `fusion.s{s}.chrono` | yokes |
| Doors (exterior / cabin agents) | — | 1 open | `ac.door.pax_open`, `emer`, `bag`, `aft_eqpt`, `svc_large`, `svc_small` | — |

## 13. Known simplifications and open points

**Estimated values (no public source)**

- The pressurization, bleed and ice architecture details are EST; the public GX chapters for these systems were not
  available.
- The EST text messages are marked in `cas.ts`.
- Take-off, landing and climb tables are not public. V-speeds come from the CLmax calibration (§3), and climb and
  cruise from the fdm calibration against SPEC / AOPA.
- The cockpit geometry (§10) is EST from photographs and the GXAG eye-position figure.

**Engines and electrical `SCOPE` items**

- EPR mode drives the physics through N1. EPR is displayed as derived by the Fusion suite.
- The SSPCs are modelled as network breakers.
- The battery chargers are modelled as floating batteries.

**Model choices**

- The TRU feeder mapping (§5.1) is EST.
- The ACMP breakers are single-phase equivalents of 3-phase breakers.
- The IAC aural mute gates only the CAS voices and chimes. TAWS / TCAS / stall aurals are unaffected.

## 14. Main cockpit, exterior and module (cockpit agent)

**Files**

| File | Contents |
|---|---|
| `index.ts` | `AircraftModule`: systems + cockpit + exterior + `applyG6kState` + checklists + input map |
| `cockpit/layout.ts` | flight-deck geometry: fuselage sections (shared with the exterior), eye points, main panel, AFD / IESI / gear-panel positions, glareshield, windshield and side-window glazing, pedestal, yokes, pedals, seats, tiller, overhead / side mounts |
| `cockpit/context.ts` | builder context, legend helpers, cockpit-derived lamp vars (`ac.g6k.ck.*`, never read by systems), overhead / side extension contract |
| `cockpit/index.ts` | `buildG6kCockpit(ctx, sys, { mainOnly?, canvas? })`, lighting zones and lights, preset views `G6K_VIEWS`, glob-loads `cockpit/overhead/index.ts` and `cockpit/side/index.ts` |
| `cockpit/shell.ts` | walls, headliner, frames, floor, bulkhead, crackle glareshield hood, pedestal body, knee panels, seats |
| `cockpit/mainPanel.ts` | AFD 1-4 (T), IESI, landing-gear panel, limitation placards |
| `cockpit/glareshield.ts` | FCP-5120, CTP 1 / 2, MASTER WARNING / CAUTION |
| `cockpit/pedestal.ts` | MKP 1 / 2, CCP 1 / 2, quadrant, trims, AUTOBRAKE, GLD, EGPWS, IRS, DC PWR EMER OVRD, EMS CDU, COCKPIT LIGHTS, PARK/EMER BRAKE, RAT and gear manual release handles |
| `cockpit/emsCdu.ts` | EMS CDU (EMER CNTL bus isolation, FIRE / STALL TEST) logic + display |
| `cockpit/flightControls.ts` | yokes (AP/SP DISC, pitch trim, TCS, FPV CAGE, CHRONO), pedals, NOSE STEER handwheel |
| `systems/cockpitInputs.ts` | merges the 3D wheel trim / AP-SP DISC / tiller vars with the hardware inputs (the input module rewrites `input.*` every frame) |
| `exterior.ts` | procedural exterior (§14.3) |

**14.1 Geometry decisions (EST)**

- Design eye from §10 (x 10.9, y ∓0.49, z −1.02). With the GXAG eye height the inner crown is only ~0.34 m above
  the eye, so the overhead mount sits ~0.27 m above the eye (not the 0.50–0.60 m of §10), and the floor is 1.22 m
  below the eye.
- Glareshield brow 0.19 m below and 0.70 m ahead of the eye (15° over-the-nose line); §10's "0.05 m below the eye"
  would block the forward view. Upper AFD row 0.40 m below the eye at 0.78 m; AFD 3 directly under AFD 2; the
  pedestal top 0.41 m above the floor runs under AFD 3.
- Windshield: two main panes with a centre post and wrap-round side panes (loft band ±0.8 rad), two side windows per
  side. The exterior glazing uses the same regions.

**14.2 Control coverage**

`tests/aircraft/global6000/cockpit-main/coverage.test.ts` actuates every main-cockpit control (≈130 incl. the
Fusion hardware) and requires each to change a var a system reads or emit a handled event: 0 unbound.
`functional.test.ts` checks system reactions (EMS CDU bus isolation and fire test, wheel trim and AP/SP DISC
interrupt, tiller steering and the gear-handle lock, reverse-lever / thrust-lever interlock, flap lever, ENG RUN
shutdown, master warning acknowledge, lamp test, FCP AP). Built here but placed on panels that belong to other
inventory sections: the tiller (§12.5) and the EMS CDU (§12.1 / §12.4 TEST and EMER CNTL functions).

SCOPE: control-wheel push-to-talk / intercom switches are not built (no radio-transmit model); the EMS CDU has no
SSPC (circuit-breaker) pages; the handwheel has no centring spring.

**14.3 Exterior**

Length 30.3 m, span 28.65 m, height ~7.7 m (tested). Kinked planform (LE ~37°), four slat segments (extend and
droop with `surf.slats`), inboard / outboard Fowler flaps (rotation + aft travel), ailerons, 4 MFS + 2 ground
spoilers per wing, blended winglets, T-tail with a trimmable stabilizer (`trim.pitch_units` 0–14 = −2…+12°),
elevators, rudder, BR710 nacelles on pylons with target-type reverser doors (Hurel-Dubois nacelle), twin-wheel
gear retracting with `gear.pos*`, doors, compression, steering and wheel spin, 27 cabin windows (14 R / 13 L),
entry / baggage / emergency-exit seams. Lights from `light.*` (systems/lighting.ts): nav, wing-tip and tail strobes,
upper / lower beacons, wing-root landing lights and nose-gear landing lights (real spot lights, candela ×
`world.render_units_per_lux`), taxi / recognition, wing inspection, logo, emergency.

## 15. Overhead panel, side consoles and circuit breakers (overhead agent)

**Sources**

| Tag | Source |
|---|---|
| FCOM-AG | Bombardier Global Express FCOM CSP 700-6 Vol. 2 "Airplane General", Rev 51 (Aug 2006): 01-10-35 flight compartment arrangement (GF0110_018), 01-10-36 aft view of the 280 bulkhead (CCBP), 01-10-37 / -38 pilot's side console and side panel, 01-10-41 overhead panel drawing GF0110_024, 01-10-45 / -46 copilot's side panel and console |
| FCOM-EL | Global 5000 / Express FCOM CSP 700-5000-6 Vol. 2 chapter 7 "Electrical": 07-10-9 .. 12 EMS CDU (SSPC control, STATUS page, "THERM CB CANT BE CHANGED FROM CDU"), 07-10-36 RAT TEST, 07-20-1 CCBP drawing FGF0720_005, 07-20-2 .. 38 breaker lists by system and bus (names, bus, location SSPC / CCBP / ACPC / DCPC / ASCA), 07-20-39 SWITCH CONTROL, 07-20-40 .. 42 TEST CONTROL (FIRE TEST 10 s, STALL TEST 20 s ground only) |

**Files**

| File | Contents |
|---|---|
| `cockpit/overhead/layout.ts` | drawing-to-panel transform (GF0110_024 text positions in PDF points, 0.78 m / 385 pt), plate modules |
| `cockpit/overhead/index.ts` | `buildOverhead`: FIRE DISCH handles L / APU / R with bottle 1 / 2 PBAs, DOME, TEMPERATURE, RECIRC / TRIM AIR / RAM AIR (guarded), AURAL WARNING IAC 1 / 2, ELT (guarded), HYDRAULIC (SOVs, pumps 1B / 3A / 3B / 2B), ELECTRICAL (BATT MASTER, EXT AC / DC, GEN 1-4, APU GEN, RAT GEN), FUEL (WING XFER, AUX / PRI PUMP, XFEED SOV, AFT XFER, RECIRC), ENGINE (IGNITION, CRANK, START), APU rotary, BLEED / AIR COND (MAN TEMP, PACK CONTROL, PACKs, ENG BLEED, XBLEED, APU BLEED), ANTI-ICE (COWLs, WING, WING XBLEED), PRESSURIZATION (AUTO/MAN, MAN ALT, LDG ELEV slew, RATE, LDG ELEV FMS/MAN, EMER DEPRESS and DITCHING guarded, OUTFLOW VALVE 1 / 2), WINDSHIELD HEAT, EXTERNAL LIGHTS, PASS SIGNS, EMER LIGHTS (guarded at ARM); derived legend vars `ac.g6k.ck.oh.*` |
| `cockpit/side/index.ts` | side consoles (mask stowage, N / 100 % regulator, RESET / TEST, flow blinker, headset panel, crew oxygen supply, PASSENGER OXYGEN with PASS ON / LOW), side panels (EMS CDU 1 / 2, STALL PUSHER, MAP LT, HUD power, map-light heads), CCBP on the 280 bulkhead |
| `cockpit/side/emsCdu.ts` | EMS CDU logic (SYS / BUS / STAT / CNTL / TEST / EMER CNTL pages, SSPC pull / reset, auto STATUS on a trip, 2 min blanking) and screen |
| `cockpit/side/cbTable.ts` | every network breaker (`cb.<load>`) with its EMS name, system group, bus and location |
| `cockpit/side/oxygenMask.ts` | quick-donning mask stowage box control |
| `cockpit/side/auralTest.ts` | AURAL WARNING TEST 1 / 2 sequencer (IAC 1 / 2 generators) |
| `tests/aircraft/global6000/cockpit-overhead/*` | coverage (0 unbound of 120), breakers (directory = network, CCBP pull, EMS SSPC pull / reset, thermal lock-out, trip + STATUS + reset), flows (power-up BATT -> EXT AC -> APU GEN -> VFGs with legends, fire test / handle / bottle, IAC mute, LDG ELEV slew, lamp test and INTEGRAL OVHD) |

**Differences from the §12.1 / §12.5 inventory (FCOM drawing wins)**

- Hydraulic pumps 1B / 3B / 2B and 3A, PASS SIGNS and EXTERNAL LIGHTS are toggle switches (legends stacked ON / OFF / AUTO), not rotaries.
- WING XBLEED is a rotary FROM L / AUTO / FROM R (`V.wingXbleed` 1 / 0 / 2); logic.ts feeds the other wing from the selected
  engine and opens it automatically in AUTO with one engine bleed.
- BEACON is RED / OFF / WHT (`V.ltBeacon` 1 / 0 / 2); lighting.ts treats both as on. SCOPE: one beacon colour is rendered.
- PACK CONTROL NORM / MAN (`V.packCtlMan`, new): the L / R MAN TEMP knobs act only in MAN (environment.ts).
- LDG ELEV is a spring-loaded UP / DN toggle (`V.ldgElevSlew`, new; logic.ts slews 500 ft/s EST and selects MAN) plus
  the LDG ELEV FMS / MAN switchlight; RATE is NORM / HIGH (`V.pressManRate` 0.5 / 1).
- Each crew mask has its own N / 100 % regulator (`V.oxyMaskModeR` for the copilot, new) and RESET / TEST
  (`V.oxyTest(n)`, new; OxygenSystem mask test flow).
- CABIN PWR is on the EMS CDU SWITCH CONTROL page (07-20-39), not an overhead toggle.
- The EMS CDUs are on the pilot's and copilot's side panels (07-10-9). The pedestal EMS unit built by the main cockpit
  duplicates EMER CNTL / FIRE / STALL TEST on the same vars (left in place).

**Circuit protection**

- The network's ~120 breakers are listed in `cbTable.ts`. SSPC breakers (DC loads) are pulled / reset from either EMS
  CDU. CCBP breakers (13 modelled thermal breakers: windshield / window / probe heat, SLAT/FLAP PWR 1 / 2, STAB TRIM
  CH 1 / 2, ICE DETECTOR, STBY ADI, battery chargers) are physical `CircuitBreaker`s on the bulkhead panel. ACPC / DCPC /
  ASCA breakers are thermal breakers outside the flight deck: the EMS shows them but cannot change them (FCOM).
- A trip (over-current, `fail.elec.<load>.short`) brings up the STATUS page on both CDUs with the trip highlighted.

**AURAL WARNING TEST 1 / 2** (`cockpit/side/auralTest.ts`, FCOM CSP 700-5000-6 Rev 2A 03-10-16 / -17): the EMS CDU
TEST page activation key starts (or terminates) IAC n's test sequence in the FCOM priority order ("AURAL WARNING TEST n",
STALL + shaker, overspeed, triple chime, NO TAKEOFF, fire / smoke / cabin altitude / gear bay / reverser / brake voices,
single chime, GEAR, cavalry charge, AUTOTHROTTLE, ALTITUDE, C-chord, double C-chord, chime, trim clacker, MINIMUMS,
SELCAL). It is silent with that IAC muted on the overhead or its breaker out (`elec.iac<n>_powered`); step timing EST;
`ac.g6k.ck.ems.aural_test<n>` = 1 while it runs. Test: `cockpit-overhead/auralTest.test.ts`.

Overhead back-lighting gain 1.9 (EST, was 1.4 like the main panel): the night legends were barely legible from the seat.

**Systems fixes made with the overhead build**

- `logic.ts` G6kPostLogic: APU fuel supply ride-through (`V.apuFuelOk`, 2 s EST). Selecting APU GEN OFF with the APU
  generator as the only AC source used to flame the APU out in one step (the AC PRI pumps stopped one step before
  the DC AUX pump was commanded).

**SCOPE / not built**

AUX PRESS PBA and the pack LO / HIGH legend (function not in the public FCOM chapters), the "EMS" legend beside BATT
MASTER, gasper, standby compass, CVR area microphone, clock, CVR panel, pitot-static SELECT VALVE, printer. RAT TEST
(maintenance BIT) is not on the TEST page; the two EMS CDUs are not linked. No windshield wipers (none on
the FCOM overhead). No cockpit-door control (the FCOM lists none). Map lights are emissive lamp heads only (the
cockpit's real-light budget is used by the floods and dome light).


## 16. Check-ride verification (adversarial review pass)

`tests/aircraft/global6000/verify/fullFlight.test.ts` (rig `verify/flightRig.ts`) flies one continuous flight
KTEB 24 → RAV → NASTY → ILS 28R KPIT at FL350 from cold & dark to cold & dark. The crew acts only through the cockpit
control vars, the FCP / CTP / MKP events the 3D panels emit and FMS-window line selects (the CCP cursor ENTER), plus
yoke, pedals, toe brakes and the NOSE STEER handwheel. The checklists' live auto-checks (checklists.ts) are asserted at
COCKPIT PREPARATION, BEFORE START, ENGINE START, AFTER START, BEFORE TAKEOFF, AFTER TAKEOFF, DESCENT, APPROACH and
LANDING. Steps: BATT MASTER → APU battery start (APU battery dips to ~20 V while cranking) → APU GEN → hydraulics, IRS
NAV, fuel, pushers, windshield heat → APU BLEED / XBLEED → R then L auto start (peak ITT 559 °C) → APU off (60 s
cooldown) → IRS alignment → FMS: FPLN origin / destination, DEPARTURE runway 24, RAV on the first free VIA / TO row,
ARRIVAL I28R via NASTY, EXEC, PERF INIT (BOW, payload, FL350, CONFIRM INIT), TAKEOFF REF V1 / VR / V2 and flaps 6 → FCP
ALT / HDG / SPD knobs → taxi on the handwheel → A/T, TOGA (TO / TO, A/T TO → HOLD), LNAV armed → rotate at VR → gear up →
AP, LNAV, FLC, slats / flaps up, VNAV (VFLC, 250 → 300 KIAS / M0.80) → baro STD (CTP) → FL350 CRZ rating, RVSM hold,
M0.85, fuel tanks decrement at the engine flow → VNAV path descent with FLIGHT SPOILER use → baro QNH → APPROACH REF
VREF / VAPP → slats / flaps 6 → APPR (nav-to-nav: NAV1 tuned, PFD NAV SRC LOC1, `ap.nav_source` 1) → LOC / GS capture →
flaps 16, gear, flaps 30, VAPP → AP/SP DISC at 200 ft → hand flare (A/T RETARD) → GLD, reversers (N1 ≤ 70 %), autobrake
MED → taxi clear → APU start, ENG RUN OFF → IRS / APU / BATT MASTER OFF (cold & dark, no CAS, no master caution).

`verify/inventory.test.ts` is the reverse audit of the §12 inventory: every `G6K_CONTROL_VARS` entry is written by a 3D
control of the complete flight deck (exempt: ground carts, doors, EMS CDU page entries, LDG ELEV ft which the slew switch
drives).

`verify/drawcalls.test.ts` guards the render budget: 1,153 draw calls for the complete flight deck (static parts
consolidated into 56 meshes); 254 of them are the two Fusion MKP keyboards (one mesh per key, collins-fusion
cockpit.ts). Headless SwiftShader measured 1,041 calls / 769 k triangles in the pilot view. Visual check
(scripts/lon-shots.mjs on a scratch build, KTEB, day 15:00 and night 03:30): pilot / copilot, glareshield, centre
panel, pedestal, overhead, side panels, CCBP, chase view. The Pedestal preset view was moved inboard (it looked through
the pilot's inboard armrest).

**Defects found and fixed in this pass**

| Defect | Fix |
|---|---|
| A/T could not be engaged for take-off: the ground placement looked like a touchdown to the A/T, which auto-disengaged every ground engagement | states.ts snaps the squat state and resets the A/T bookkeeping |
| YD OFF on the take-off after a cold start: the power-up YD engagement happened before the IRS alignment and dropped out | logic.ts waits for a valid attitude before the automatic engagement |
| LNAV armed on the ground captured immediately (lateral TO replaced on the runway) | `nav.groundCapture: false` |
| VNAV press in a climb only armed the path (no VFLC climb) | `vnavClimb: true` |
| VNAV (VALTS) followed the next approach constraint through the 5,000 ft FCP altitude | `altvBoundBySel: true` |
| SPD MAN on the FCP was ignored in VPATH (A/T kept the FMS speed) | `vnavSpeedFromSelected` (AFCS and A/T) |
| CONFIRM INIT replaced the Global speed schedule with the suite's generic one (VNAV climbed at 250 KIAS to FL300) | Fusion perf defaults set from `FMS_SPEEDS` |
| A/T speed loop hunted ±15 % N1 (20 s period) on the flaps-30 approach | A/T gains Kp 0.01 (EST) |
| Coupled ILS pitch oscillation ±3.5° (8 s period, VS −150 … −1,150 fpm) | `alphaTauS` 4 s |
| Glide-path attitude ~0.5–1° (AAIB: ~4°) | flaps-30 lift curve cl0 1.05 → 0.80, stall 10 → 11° (CLmax unchanged) |
| Late lift-off with flaps 6 (CL ~1.4 at the lift-off AoA) | flaps-6 cl0 0.62 → 0.80, stall 11 → 9° (CLmax unchanged) |
| MASTER CAUTION lit in a cold & dark cockpit (CAS powered from the hot DC EMER bus) | CAS on DC ESS / BATT bus only |

**Remaining gaps found by the check ride**

- Waypoint idents shared with an airport's FAA LID resolve to the airport first (JST → KJST, HAR → KCXY) because the
  Fusion FMS has no duplicate-ident selection page (`src/avionics/collins-fusion/fms/pages.ts resolve`, other agent's
  module). The check ride uses RAV.
- The AP/SP DISC var alone does not disconnect the AP; the 3D button emits `ap.disc` itself (hardware bindings must
  emit the event too).
- Engaging the AP in the TO vertical mode reverts to PITCH (shared AFCS behaviour); the crew then selects FLC / VNAV.
- The light-weight (73,000 lb) lift-off comes ~VR + 16 kt after a 2.5 °/s rotation (high thrust-to-weight
  acceleration during the rotation); take-off V-speeds remain the CLmax-derived EST values.
