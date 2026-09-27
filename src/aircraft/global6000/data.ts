/**
 * Bombardier Global 6000 (BD-700-1A10 with the Global Vision Flight Deck,
 * 2 x Rolls-Royce Deutschland BR700-710A2-20): published numbers shared by
 * the FDM, systems, states, checklists and tests. Every value cites its
 * source; estimates are marked EST with the reasoning.
 *
 * Source abbreviations used throughout src/aircraft/global6000 and the
 * dossier docs/aircraft/global6000.md:
 *  - TCDS  = EASA Type Certificate Data Sheet IM.A.009 "BD-700", Issue 14
 *            (23 Jan 2026), Section 2 (BD-700-1A10 / -1A11): fuel capacities
 *            (1.4, SB 700-28-040 configuration), maximum weights (1.5), datum
 *            FS 0 = 144 in forward of the nose (1.7), BR700-710A2-20 engine
 *            limits (3.2), oil (3.3), APU RE220 GX limits (5.2), 51,000 ft /
 *            13,700 ft take-off and landing (5.4), Cat 2 (5.6), exits (5.7),
 *            tyres (5.9), minimum crew 2, 19 passengers (5.10/5.11).
 *  - SPEC  = Bombardier "Global 6000" factsheet (2017): dimensions, wing area
 *            1,021 ft^2, weights (BOW 52,230 lb, max fuel 45,050 lb), thrust
 *            14,750 lbf flat rated to ISA + 20 C, range 6,000 nm at M0.85,
 *            MMO 0.89, high speed cruise M0.88, typical cruise M0.85, take-off
 *            distance 6,476 ft (SL ISA MTOW), landing distance 2,236 ft,
 *            initial cruise altitude at MTOW 41,000 ft, 51,000 ft ceiling.
 *  - GXAG  = Bombardier Global Express training manual "Airplane General":
 *            dimensions (GX_01_002), airspeed limits placard (GX_01_018/022),
 *            eye position (GX_01_005), -30..+50 C ambient at sea level,
 *            control wheel switches, flight compartment layout (GX_01_018).
 *  - GXEL  = "Electrical" chapter: 4 x 40 kVA VFG 324-596 Hz, 40 kVA APU GEN,
 *            9 kVA RAT GEN (sheds below ~147 KIAS), 4 x 150 A TRU, 25 Ah AV
 *            battery, 42 Ah APU battery, bus priorities, EICAS messages.
 *  - GXHY  = "Hydraulics": three 3,000 psi systems, EDP 1A/2A, ACMP 1B/2B/3A/3B,
 *            RAT pump, pressure colours (green > 1,800, amber <= 1,800),
 *            HI TEMP 96 C, brake accumulator precharge 500 psi, RAT
 *            accumulator 1,000 psi, ACMP AUTO logic.
 *  - GXFU  = "Fuel System": tanks, AC primary / DC AUX pumps, transfer
 *            schedule (93 / 97 %, aft transfer at 5,500 lb per wing), crossfeed,
 *            FUEL LO QTY 600 lb, FUEL IMBALANCE 1,100 / 600 lb, recirculation,
 *            FUEL HI TEMP / WING FUEL LO TEMP (-35 C).
 *  - GXFC  = "Flight Controls": PCUs (2 per aileron / elevator, 3 rudder),
 *            stabilizer 0-14 units (2 deg ND - 12 deg NU), trim rate 0.5 -> 0.3
 *            deg/s, slats/flaps 0 IN / 0 OUT / 6 / 16 / 30, 4 MFS + 2 GS per
 *            wing, GLD logic (RA < 7 ft, wheel speed > 16 kt, 45 kt latch), stall
 *            protection (shakers, pusher, 70 KCAS inhibit).
 *  - GXLG  = "Landing Gear & Brakes": LGECU, sys 2 / 3 actuation, 28 s
 *            disagree, NWS +/-75 deg tiller / +/-7.5 deg pedals, autobrake
 *            LO/MED/HI = 4 / 8 / 13 ft/s^2, BTMS, gear horn logic, messages.
 *  - GXAPU = "Auxiliary Power Unit": RE220, 45,000 ft operating / 37,000 ft
 *            start envelope, ~45 psi bleed, starter cut-out 46-60 %, 60 s
 *            cooldown, messages.
 *  - GXFP  = "Fire Protection": FIDEEX dual loops, 2 bottles shared by both
 *            engines and the APU (squibs 1 / 2), MLG bay overheat, messages.
 *  - GXAF  = "Automatic Flight": Primus 2000 FGC roll rate 7.5 deg/s, bank 27 /
 *            17 deg (auto low bank above 35,050 ft), pitch +/-20 deg, VS -8,000 /
 *            +6,000 fpm, FLC Mach/IAS changeover 32,400 / 31,900 ft.
 *  - GXLT  = "Lighting": exterior / interior lighting controls.
 *  - FSB   = FAA Flight Standardization Board report BD-700-1A10/1A11 Rev 9
 *            (draft), appendix 6: GVFD differences (four AFDs, CTP, CCP, MKP,
 *            RSP, EDM, underspeed protection, autothrottle, triple FMS).
 *  - AOPA  = "First look at the Global 6000", AOPA Pilot, Sep 2012: FL410
 *            M0.85 490 KTAS at 3,200 lb/h (warmer than standard), landing
 *            target 116 KIAS, > 3,000 fpm at 250 KIAS (light), 4,500 ft cabin
 *            at FL450.
 *  - E018  = EASA TCDS E.018 (BR700-710 series), as quoted by the Collins
 *            Fusion suite config (src/avionics/collins-fusion/config.ts).
 */

export const LB = 0.45359237;
export const LBF = 4.4482216152605;
export const FT = 0.3048;
export const KT = 0.514444;
export const IN = 0.0254;

export const G6K_LIMITS = {
  // ---------------- weights (TCDS 1.5, SPEC)
  maxRampLb: 99750,
  mtowLb: 99500,
  mlwLb: 78600,
  mzfwLb: 58000,
  bowLb: 52230, // SPEC basic operating weight (typical, includes crew)
  maxPayloadLb: 5770, // SPEC
  // ---------------- fuel (TCDS 1.4, aircraft incorporating SB 700-28-040 = Global 6000 build standard)
  mainTankLb: 15045, // each wing (2,229 US gal)
  centerTankLb: 12683,
  aftTankLb: 2275,
  usableFuelLb: 45050,
  unusableDrainableLb: 72, // total
  undrainableLb: 100, // total
  lowFuelLb: 600, // GXFU: FUEL LO QTY < 600 lb in either wing tank
  imbalanceFlightLb: 1100, // GXFU: FUEL IMBALANCE > 1,100 lb in flight
  imbalanceGroundLb: 600, // GXFU: 600-1,100 lb on the ground / takeoff / approach configuration
  wingXferAutoLb: 400, // GXFU: auto wing transfer corrects imbalances of 400 lb
  ctrXferStartPct: 93, // GXFU: centre transfer starts when a wing is below ~93 %
  ctrXferStopPct: 97, // GXFU: ... and stops above 97 %
  aftXferWingLb: 5500, // GXFU: aft transfer starts at 5,500 lb in either wing (recirculation aircraft)
  fuelLoTempC: -35, // GXFU: WING FUEL LO TEMP below -35 C
  fuelHiTempC: 54, // GXFU: FUEL HI TEMP +54 C (-9 FMQGC, recirculation off)
  // ---------------- speeds (GXAG airspeed limits placard; same airframe, TCDS note 8)
  vmoLowKt: 300, // below 8,000 ft
  vmoKt: 340, // 8,000 ft to 30,267 ft
  vmoChangeFt: 8000,
  mmo: 0.89, // 30,267 - 35,000 ft
  mmoFt: [30267, 35000, 41000, 47000, 51000],
  mmoVals: [0.89, 0.89, 0.88, 0.858, 0.842],
  vaSlKt: 254, // at sea level at 96,000 lb
  va20kKt: 250, // at 20,000 ft at 78,600 lb
  vseKt: 225, // slats out, flaps 0
  vfe6Kt: 210,
  vfe16Kt: 210,
  vfe30Kt: 185,
  vloExtKt: 200,
  vloRetKt: 200,
  vleKt: 250,
  // ---------------- altitudes / environment (TCDS 5.4, GXAG)
  maxAltFt: 51000,
  maxTakeoffLandingAltFt: 13700,
  minAmbientSlC: -30,
  maxAmbientSlC: 50,
  // ---------------- load factors (14 CFR 25.337 minimums for the transport category; the Global AFM values are not public)
  nzMaxClean: 2.5, // EST: 25.337(b) for W > 50,000 lb
  nzMinClean: -1.0,
  nzMaxFlaps: 2.0, // 25.345
  nzMinFlaps: 0,
  // ---------------- engines (TCDS 3.2, E018)
  takeoffThrustLbf: 14750, // 65.6 kN, 5 min AEO / 10 min OEI
  mctThrustLbf: 14450,
  n1TakeoffPct: 102.0,
  n1OverspeedPct: 102.5,
  n2TakeoffPct: 99.6,
  n2MctPct: 98.9,
  n2OverspeedPct: 99.8,
  n2IdleMinPct: 58, // TCDS idle range: N2 58 % minimum
  ittTakeoffC: 900,
  ittMctC: 860,
  ittOvertempC: 905,
  ittStartGroundC: 700,
  ittStartAirC: 850,
  revN1Pct: 70, // TCDS: "FADEC controls the fan rpm (N1) to 70.0 % for 30 seconds"
  flatRatedIsaDevC: 20, // SPEC: flat rated to ISA + 20 C
  oilTempMaxC: 160, // E018
  oilPressMinPsi: 25, // E018 minimum to complete the flight 172.3 kPa = 25.0 psid
  oilPressCautionPsi: 35, // E018 lower limit for flight 241.2 kPa = 35.0 psid (idle .. 72.3 % N2)
  oilQtyEngQt: 4.8 * 4, // TCDS 3.3: 4.8 US gal per engine incl. replenishment lines
  // ---------------- APU (TCDS 5.2, GXAPU)
  apuMaxRpmPct: 106,
  apuEgtStartMaxC: 1020,
  apuEgtRunMaxC: 714,
  apuStartCeilingFt: 37000,
  apuOperatingCeilingFt: 45000,
  apuBleedCeilingFt: 30000, // GXAPU: AFM limits APU bleed extraction to 30,000 ft
  apuBleedPsi: 45, // GXAPU: "approximately 45 psi bleed pressure at normal operating speed"
  apuGenKva: 40,
  // ---------------- electrical (GXEL)
  vfgKva: 40,
  vfgHzMin: 324,
  vfgHzMax: 596,
  ratGenKva: 9,
  ratShedKias: 147,
  ratDeployDelayS: 14,
  truRatedA: 150,
  avBattAh: 25, // 24 V NiCd
  apuBattAh: 42, // 25.2 V NiCd
  battEmerMin: 15, // "batteries ... minimum of 15 minutes"
  // ---------------- hydraulics (GXHY)
  hydPsi: 3000,
  hydLowPsi: 1800,
  hydHiTempC: 96,
  brakeAccPrechargePsi: 500,
  ratAccPrechargePsi: 1000,
  acmpMinOnS: 300, // "remain on for a minimum of 5 minutes"
  // ---------------- flight controls (GXFC, GXLG)
  stabUnitsMax: 14,
  stabDegMin: -2, // 0 units = 2 deg airplane nose down
  stabDegMax: 12, // 14 units = 12 deg nose up
  stabGreenBand: [4.5, 11] as [number, number], // GX_10_022 take-off green band
  trimRateLowMachDps: 0.5,
  trimRateHighMachDps: 0.3,
  apTrimRateDps: 0.5, // EST: "automatic pitch trim rate operation is from 0.5 ..." (text truncated)
  gldRaFt: 7,
  gldWheelKt: 16,
  gldLatchKt: 45,
  gldDisarmS: 40,
  stallInhibitKt: 70,
  tillerMaxDeg: 75,
  pedalSteerMaxDeg: 7.5,
  autobrakeLoFps2: 4,
  autobrakeMedFps2: 8,
  autobrakeHiFps2: 13,
  autobrakeSpinupKt: 50,
  gearDisagreeS: 28,
  maxTireSpeedKt: 182, // EST: 210 mph H38x12-19 tyre speed rating class (TCDS lists the size only)
  // ---------------- pressurization (EST from AOPA / the systems-power preset)
  cabinAtFl450Ft: 4500, // AOPA: 4,500 ft cabin at FL450
  cabinAtFl510Ft: 5680, // EST (PRESS_GLOBAL6000 preset)
  maxDiffPsi: 10.33, // EST derived (systems-power PRESS_GLOBAL6000)
  taxiDiffPsi: 0.1, // GX_01_018 placard: "pressure differential shall not exceed 0.1 psi during taxi"
  landingDiffPsi: 1.0, // "... and 1.0 psi upon initial landing"
  paxMaskFt: 14000, // EST: Part 25 typical (25.1447)
  cabinLimiterFt: 14500, // EST: outflow-valve cabin altitude limiter (Bombardier CRJ / Challenger EMER DEPRESS figure; 25.841(a)(2))
  // ---------------- crosswind
  maxDemoCrosswindKt: 29, // EST: Global AFM demonstrated crosswind (not in a public source); common operator figure
} as const;

/** VMO (KIAS) at pressure altitude (placard step). */
export function vmoAt(altFt: number): number {
  return altFt < G6K_LIMITS.vmoChangeFt ? G6K_LIMITS.vmoLowKt : G6K_LIMITS.vmoKt;
}

/** MMO at pressure altitude (placard, linear between the published points). */
export function mmoAt(altFt: number): number {
  const x = G6K_LIMITS.mmoFt;
  const y = G6K_LIMITS.mmoVals;
  if (altFt <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (altFt <= x[i]) return y[i - 1] + ((y[i] - y[i - 1]) * (altFt - x[i - 1])) / (x[i] - x[i - 1]);
  }
  return y[y.length - 1];
}

/** VMO schedule as a Table1D vs pressure altitude (steps approximated by a 1 ft ramp). */
export const VMO_SCHEDULE = { x: [0, 7999, 8000, 60000], y: [300, 300, 340, 340] };

/**
 * Slat / flap lever detents (GXFC slat/flap lever table): lever value
 * (ac.flap_lever, the var the Collins EICAS reads), slats, flap angle,
 * placard speed and gate. The lever has a LATCH at 0 IN and 30, GATES at
 * 0 OUT and 6, a DETENT at 16.
 */
export const FLAP_DETENTS = [
  { lever: 0, label: '0 IN', slats: 0, flapDeg: 0, vfe: undefined as number | undefined },
  { lever: 1, label: '0 OUT', slats: 1, flapDeg: 0, vfe: 225 },
  { lever: 2, label: '6', slats: 1, flapDeg: 6, vfe: 210 },
  { lever: 3, label: '16', slats: 1, flapDeg: 16, vfe: 210 },
  { lever: 4, label: '30', slats: 1, flapDeg: 30, vfe: 185 },
] as const;

/** Stabilizer units (0..14) -> degrees (GXFC: 0 units = 2 deg ND, 14 units = 12 deg NU). */
export function stabDeg(units: number): number {
  return G6K_LIMITS.stabDegMin + (units / G6K_LIMITS.stabUnitsMax) * (G6K_LIMITS.stabDegMax - G6K_LIMITS.stabDegMin);
}

/**
 * Reference speeds at a weight (EST: derived from the FDM calibration and
 * the placard ratios, not AFM tables which are not public).
 *  - VS1G by configuration from CLmax (fdm.ts calibration: 1.25 clean slats
 *    in, 1.70 slats out flaps 0, 1.87 flaps 6, 2.05 flaps 16, 2.25 flaps 30).
 *  - VREF = 1.23 VS1G (14 CFR 25.125), V2 = 1.13 VS1G (25.107), VR = V2 - 4 kt
 *    (EST typical rotation margin for the Global class).
 */
export const CLMAX = { clean: 1.25, slatsOut: 1.7, f6: 1.87, f16: 2.05, f30: 2.25 } as const;
export const WING_AREA_FT2 = 1022; // GXAG equivalent wing area 1,022 ft^2 (94.95 m^2); SPEC 1,021 ft^2

/** 1-g stall speed (KCAS) at a weight for a CLmax (sea-level density; CAS = EAS below ~M0.3). */
export function vs1g(weightLb: number, clMax: number): number {
  // V = sqrt(2 W / (rho0 S CL)); rho0 = 0.0023769 slug/ft^3; 1 ft/s = 0.592484 kt.
  const fps = Math.sqrt((2 * weightLb) / (0.0023769 * WING_AREA_FT2 * clMax));
  return fps * 0.592484;
}

export interface VSpeeds {
  vs1g: number;
  v1: number;
  vr: number;
  v2: number;
  vref: number;
}

/** EST take-off (flaps 6) and landing (flaps 30) speeds for a weight. */
export function vSpeeds(weightLb: number): VSpeeds {
  const vsTo = vs1g(weightLb, CLMAX.f6);
  const v2 = 1.13 * vsTo;
  const vr = v2 - 4;
  return { vs1g: vsTo, v1: vr - 2, vr, v2, vref: 1.23 * vs1g(weightLb, CLMAX.f30) };
}

/** Oil pressure lower limits vs N2 (E018: 241.2 kPa .. 72.3 % N2 -> 310.3 kPa at 90 %). */
export function oilPressCaution(n2: number): number {
  const lo = 35.0;
  const hi = 45.0;
  if (n2 <= 72.3) return lo;
  if (n2 >= 90) return hi;
  return lo + ((hi - lo) * (n2 - 72.3)) / (90 - 72.3);
}
