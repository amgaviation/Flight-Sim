/**
 * Gulfstream G800 (model GVIII-G800) published data: limitations, weights,
 * dimensions and performance anchors. Every number cites its source; EST marks
 * an estimate with its reasoning. The dossier docs/aircraft/g800.md lists the
 * same values with the full source list.
 *
 * Source abbreviations used throughout src/aircraft/g800:
 *   TCDS    EASA TCDS IM.A.169 Issue 17 (14 Jul 2026), Section 3 GVIII-G800
 *           (FAA TCDS T00015AT).
 *   E135    EASA TCDS E.135 Issue 02, Rolls-Royce Pearl 700 (BR700-730B2-14),
 *           as transcribed in src/avionics/honeywell-epic/config.ts PEARL700_LIMITS.
 *   FSB     FAA Flight Standardization Board Report GVIII-G700 Rev 1 (adds the
 *           GVIII-G800; App. 3 G700->G800 and App. 4 G500/G600->G700/G800
 *           differences tables, March 2025).
 *   GVI     G650/G650ER "Selected Limitations & Info" sheet, Rev 05-2020 (AFM
 *           G650 Rev 18 / G650ER Rev 9). The G800 is a GVI derivative on the same
 *           type certificate (T00015AT); GVI values are used where the FSB lists
 *           no G800 difference, and flagged "GVI".
 *   SCQ     SmartCockpit G650 systems quizzes (electrical, hydraulics, fuel,
 *           flight controls, landing gear, pneumatics, ice & rain, fire,
 *           powerplant), GVI system descriptions.
 *   GAC     gulfstream.com G800 product page (2026).
 *   BJT800  Business Jet Traveler "All about Gulfstream's G400 and G800".
 *   BJT500  Business Jet Traveler "Pilot report: Gulfstream G500" (Symmetry
 *           flight deck, active control sidesticks, touch screens).
 *   SC      Federal Register special conditions for the GVIII-G700/G800:
 *           2024-01741 (side-stick limit pilot forces), 2024-02943 (EFCS
 *           control-surface awareness).
 *   WIKI    Wikipedia "Gulfstream G650/G700/G800" (wing area, sweep).
 *   RR      Rolls-Royce / Aero-mag Pearl 700 releases (51.8 in fan, 24 blisk blades).
 *   C450    code450.com Gulfstream user's resource (G450-family CAS texts and
 *           checklist wording; Gulfstream house style).
 */

export const LB = 0.45359237;
export const LBF = 4.4482216152605;
export const FT = 0.3048;
export const KT = 0.514444;

export const G800_LIMITS = {
  // ------------------------------------------------------------ weights (TCDS §13; FSB App. 3)
  maxRampLb: 106000, // TCDS: max taxi 106,000 lb
  mtowLb: 105600, // TCDS: max take-off 105,600 lb
  mlwLb: 83500, // TCDS: max landing 83,500 lb
  mzfwLb: 60500, // TCDS: max zero fuel 60,500 lb
  minFlightWeightLb: 56000, // FSB App. 3: minimum flight weight 56,000 lb
  maxPayloadLb: 6200, // GAC / BJT800: maximum payload 6,200 lb
  /** EST: basic operating weight = MZFW - max payload = 54,300 lb (GAC/BJT800 numbers; same as the published G700 BOW). */
  bowLb: 54300,
  /** EST: empty weight carried by the FDM = BOW - 2 crew (400 lb) - crew stores/unusable fuel (300 lb). */
  emptyLb: 53600,
  // ------------------------------------------------------------ fuel (TCDS §9)
  fuelTankLb: 24700, // TCDS: right / left 24,700 lb (3,686 US gal) each at 6.7 lb/gal
  fuelTotalLb: 49400, // TCDS: 49,400 lb / 7,373 US gal / 22,407 kg
  fuelUnusableTankLb: 60, // EST: typical integral wing tank with a hopper and ejector scavenge (GVI hopper 190 gal)
  hopperLb: 1283, // SCQ fuel: each hopper up to 190 US gal / 1,283 lb
  fuelLowLb: 650, // GVI: low fuel level alert at 650 lb (96 gal) per side
  maxImbalanceLb: 2000, // GVI: max fuel imbalance 2,000 lb (balance before 1,000 lb)
  maxImbalanceTakeoffLb: 1000, // GVI: max fuel imbalance for takeoff 1,000 lb
  // ------------------------------------------------------------ dimensions (TCDS §4, §15, §16; FSB; WIKI)
  spanM: 31.4, // TCDS: wingspan 31.40 m (103.02 ft)
  lengthM: 30.41, // TCDS: fuselage length 30.41 m (99.78 ft)
  heightFt: 25.54, // FSB App. 3: height 25.54 ft
  fuselageWidthM: 2.74, // TCDS: fuselage width at constant section 2.74 m
  wingAreaFt2: 1283, // WIKI: G700/G800 wing 1,283 ft^2 (33 deg sweep, new winglets)
  macM: 4.756, // TCDS §16: MAC 4.756 m (187.24 in)
  sweepDeg: 33, // WIKI
  datumNote: 'TCDS §15: datum 100.0 in forward of the radome',
  cgZfwPctMac: [35.0, 45.0] as [number, number], // FSB App. 3: zero-fuel CG limits 35.00 % - 45.00 % MAC
  // ------------------------------------------------------------ airspeeds
  vmoKt: 340, // TCDS §10: VMO 340 KCAS
  vmoLowKt: 300, // GVI: VMO 300 KCAS below 8,000 ft (FSB lists no G800 difference)
  vmoLowBelowFt: 8000, // GVI
  mmo: 0.935, // TCDS §10: MMO 0.935
  vaKt: 206, // GVI: VA 206 KCAS
  vfe10Kt: 250, // GVI: VFE flaps 10 250 KCAS
  vfe20Kt: 220, // GVI: VFE flaps 20 220 KCAS
  vfe39Kt: 190, // FSB App. 4: max flaps down (39 deg) 190 KCAS (G800)
  vleKt: 250, // GVI: VLE 250 KCAS
  vloKt: 225, // GVI: VLO normal 225 KCAS
  vloAltKt: 175, // GVI: VLO alternate (emergency) extension 175 KCAS
  vturbKt: 270, // GVI: turbulence penetration 270 KCAS / M0.85 above 10,000 ft
  vturbMach: 0.85,
  vturbLowKt: 240, // GVI: below 10,000 ft
  vtireKt: 195, // GVI: tire speed 195 kt ground speed
  vmcgKt: 104, // FSB App. 3: VMCG 104 KCAS at SL
  vmcaF10Kt: 109, // FSB App. 3: flaps 10 VMCA 109 KCAS
  vmcaF20Kt: 111, // FSB App. 3: flaps 20 VMCA 111 KCAS
  vmclKt: 106, // FSB App. 3: VMCL 106 KCAS
  vDegradedLawKt: 285, // GVI: degraded flight control law / yaw damper inop 285 KCAS / M0.90
  vDegradedLawMach: 0.9,
  vHoldMinKt: 160, // GVI
  vHoldIcingKt: 180, // GVI: holding in icing flaps 0, min 180 KCAS
  vWindmillStartMinKt: 250, // GVI: windmill airstart 250-340 KCAS below 30,000 ft
  vRatMinKt: 160, // SCQ electrical: RAT minimum 160 KCAS (GVI)
  // ------------------------------------------------------------ altitudes / environment
  maxAltFt: 51000, // TCDS §11/§12.2: 51,000 ft pressure altitude
  maxAltSinglePackFt: 48000, // GVI
  maxAltFlaps39Ft: 20000, // GVI: landing flaps 39 max 20,000 ft
  maxAltFlaps1020Ft: 25000, // GVI: flaps 10/20 max 25,000 ft
  maxAltGearFt: 20000, // GVI: landing gear extended 20,000 ft
  maxAirportElevFt: 15000, // FSB App. 3: max airport elevation 15,000 ft
  runwaySlopePct: 2, // TCDS §12.2: +/-2 %
  maxTailwindKt: 10, // TCDS §12.2
  maxCrosswindTakeoffKt: 30, // TCDS §12.2: takeoff crosswind 30 kt incl. gusts
  maxCrosswindLandingKt: 33, // TCDS §12.2: demonstrated landing crosswind 33 kt incl. gusts
  maxCrosswindDegradedLawKt: 10, // TCDS §12.2: landing in Alternate/Direct/Backup law
  minTempC: -50, // GVI: operating temperature -50 to +55 degC at SL
  maxTempC: 55,
  // ------------------------------------------------------------ load factors (GVI)
  nzMaxClean: 2.5, // GVI: flaps 0 -1 to +2.5 g
  nzMinClean: -1.0,
  nzMaxFlaps: 2.0, // GVI: flaps 10/20/39 0 to +2.0 g
  nzMinFlaps: 0,
  // ------------------------------------------------------------ pressurization (GVI; GAC)
  maxDiffPsi: 10.69, // GVI: max cabin pressure differential 10.69 psi
  maxDiffTakeoffLandingPsi: 0.3, // GVI
  cabinAltAt41kFt: 2840, // GAC: 2,840 ft cabin at 41,000 ft (BJT800: 2,916 ft)
  cabinAltAt51kFt: 4850, // EST: G500 report, max cabin 4,850 ft at FL510 (same 10.7 psid Gulfstream schedule; PRESS_G800 preset)
  cabinAltWarnFt: 8000, // C450: "CABIN PRESS LOW is usually set at 8,000 ft cabin altitude" (Gulfstream red CAS)
  // ------------------------------------------------------------ engines (E135; GVI)
  thrustLbf: 18250, // TCDS §5 / E135: 81.2 kN (18,250 lb) SL static standard day
  n1RefRpm: 6500, // E135: N1 100 % = 6,500 rpm
  n2RefRpm: 19000, // E135: N2 100 % = 19,000 rpm
  n1MtoPct: 96.6, // E135: N1 MTO/MCT 96.6 %
  n1OverspeedPct: 97.8, // E135
  n2MtoPct: 102.2, // E135: N2 MTO/MCT 102.2 %
  n2OverspeedPct: 103.4, // E135
  tgtStartGroundC: 800, // E135: TGT start (ground) 800 degC
  tgtStartFlightC: 850, // E135: TGT start (in flight) 850 degC
  tgtMtoC: 940, // E135: TGT MTO / MCT 940 degC
  tgtTransientC: 950, // E135: 2 min transient
  oilPressMinPsi: 25, // E135 / GVI: engine must be shut down below 25 psid
  oilPressIdleMinPsi: 35, // E135: minimum to start a flight, idle to 72.3 % NH
  oilTempMaxC: 170, // E135: oil scavenge temperature 170 degC steady
  starterCutoutN2Pct: 42, // GVI / SCQ powerplant: SVO/IGN extinguish at ~42 % HP; starter re-engagement up to 42 % HP
  maxResidualTgtStartC: 120, // C450S G700/G800 powerplant: "Max TGT prior to start 120 C" (GVI sheet: 150 degC)
  // C450S G700/G800 powerplant: FADEC rotor-bow avoidance - an engine shut down more than 20 min and less than 5 h
  // earlier is dry-motored for 50 s before light-off (SVO displayed, CAS "Engine Start Protect").
  rotorBowMinOffS: 20 * 60,
  rotorBowMaxOffS: 5 * 3600,
  rotorBowMotorS: 50,
  maxStartCrosswindKt: 30, // GVI
  reverseIdleByKt: 60, // GVI: idle reverse position by 60 KCAS
  // ------------------------------------------------------------ APU (TCDS §6: Honeywell RE220(GVI); GVI limits)
  apuMaxAltFt: 45000, // GVI: APU max operating altitude 45,000 ft; gen 100 % (40 kVA) SL-45,000 ft
  apuEgtStartC: 1050, // GVI: max EGT start 1,050 degC
  apuEgtRunC: 732, // GVI: max EGT running 732 degC
  apuMaxRotorPct: 106, // GVI
  apuGenKva: 40, // GVI / SCQ electrical
  apuAirstartGuaranteedFt: 37000, // GVI (with ASC 123)
  apuStarterAssistMaxFt: 35000, // SCQ pneumatics: APU starter-assisted engine starts at and below 35,000 ft
  // ------------------------------------------------------------ electrical (SCQ electrical, GVI)
  idgKva: 40, // SCQ: IDG 40 kVA, 3-phase 115/200 VAC 400 Hz
  ratKva: 30, // SCQ: RAT 30 kVA
  battAh: 53, // SCQ: main batteries 53 Ah NiCd (systems-power preset BATTERY_G650_NICD)
  battMinPreflightV: 20, // SCQ: minimum preflight battery voltage 20 V
  upsBattAh: 10.5, // SCQ: UPS battery 24 V 10.5 Ah lithium (FCC power)
  emerBattArmV: 20, // SCQ: emergency batteries connect when an essential DC bus drops below 20 VDC (EMER PWR ARM)
  truRatedA: 250, // EST: C450 G450-family TRU rating 250 A at 28 V (GV architecture retained, C450)
  // ------------------------------------------------------------ hydraulics (SCQ hydraulics; GVI)
  hydPsi: 3000, // SCQ: EDP 3,000-3,500 psi constant pressure
  ptuFailPsi: 1500, // SCQ: "PTU Hydraulic Fail" when PTU output < 1,500 psi
  accumPrechargePsi: 1200, // GVI: L/R accumulator precharge 1,200 psi at 70 degF
  hydReservoirLeftGal: 3.0, // GVI: max reservoir qty indicated left 2.8-3.0 gal
  hydReservoirRightGal: 1.6, // GVI: right 1.4-1.6 gal
  // ------------------------------------------------------------ gear / brakes / steering
  tirePsi: 216, // TCDS §21: nominal 216 psi nose and main
  brakeOverheatC: 450, // SCQ landing gear: brake overheat alert above 450 degC
  antiskidMinKt: 15, // SCQ: no anti-skid protection below 15 kt
  pedalSteerDeg: 7, // FSB App. 4: normal max pedal steering command +/-7 deg (G800)
  tillerSteerDeg: 80, // EST: GVI-family tiller authority (not published in the sources; Gulfstream class ~80 deg)
  minTurnWidthFt: 61, // FSB App. 3: min taxiway width for 180-deg turn 61 ft
  gearHornAglFt: 500, // SCQ / GVI: gear warning below 500 ft AGL with both throttles idle, flaps < 22 deg
  gearHornFlapsDeg: 22, // GVI: flaps > 22 deg and gear not down: horn cannot be muted
  // ------------------------------------------------------------ autopilot (GVI)
  apMinEngageFt: 200, // GVI: autopilot minimum engage height 200 ft AGL
  apMinDisengageIlsFt: 80, // GVI: 80 ft AGL on ILS/LPV
  apMinDisengageFt: 200, // GVI: all other operations
  // ------------------------------------------------------------ ice (FSB App. 4; GVI; SCQ)
  autoWaiCaiInhibitFt: 35000, // FSB App. 4: Auto WAI inhibited on ground and > FL350, auto CAI inhibited > FL350
  waiBeforeTakeoffS: 120, // GVI: wing & cowl anti-ice ON at least 2 min before takeoff thrust (G800: FSB lists a difference, EST same)
} as const;

/** Flap detents: handle positions UP/10/20/39 (G800_AIRFRAME flap scale 0/10/20/39; GVI VFE). */
export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP' },
  { lever: 1, flapDeg: 10, label: '10', vfe: G800_LIMITS.vfe10Kt },
  { lever: 2, flapDeg: 20, label: '20', vfe: G800_LIMITS.vfe20Kt },
  { lever: 3, flapDeg: 39, label: '39', vfe: G800_LIMITS.vfe39Kt },
];

/**
 * VMO schedule vs pressure altitude (kt): 300 KCAS below 8,000 ft, 340 KCAS above
 * (GVI; TCDS). EST: 500 ft linear transition to keep the barber pole continuous.
 */
export const VMO_SCHEDULE = { x: [0, 7500, 8000, 60000], y: [G800_LIMITS.vmoLowKt, G800_LIMITS.vmoLowKt, G800_LIMITS.vmoKt, G800_LIMITS.vmoKt] };

/**
 * Performance anchors used to calibrate and verify the FDM
 * (tests/aircraft/g800/performance.test.ts). Where no published figure exists
 * the value is derived from published range / field-length numbers (EST, see
 * each comment and the dossier §4).
 */
export const G800_PERF = {
  /** GAC: takeoff distance 5,812 ft (1,771 m) at MTOW, SL ISA (BJT800: 6,000 ft). */
  takeoffFieldLengthFt: 5812,
  /**
   * EST: all-engines distance to 35 ft ~= 0.78 x the balanced field length for a
   * twin whose TOFL is OEI accelerate-go/stop limited (typical Part 25 twin ratio
   * 0.75-0.8); 0.78 x 5,812 = 4,530 ft.
   */
  aeoTakeoffTo35FtFt: 4530,
  /** GAC: long-range cruise M0.85, 8,200 nm max range; M0.90 high-speed cruise 7,000 nm. */
  lrcMach: 0.85,
  hscMach: 0.9,
  rangeLrcNm: 8200,
  rangeHscNm: 7000,
  /** GAC: initial cruise altitude 41,000 ft. */
  initialCruiseFt: 41000,
  /**
   * EST (Breguet from GAC range): with 104,900 lb start / 60,900 lb end weight
   * (BOW 54,300 + 1,600 lb payload + 5,000 lb NBAA reserves) the mean specific
   * burn at M0.85 (488 KTAS) is W x 0.0324 per hour, i.e. 2,750 lb/h total at
   * 85,000 lb; at M0.90 (7,000 nm, 516 KTAS) W x 0.0401 per hour = 3,400 lb/h at 85,000 lb.
   */
  lrcFfPerLbHr: 0.0324,
  hscFfPerLbHr: 0.0401,
  /**
   * EST 1-g stall speeds (KCAS) at 83,500 lb (MLW) and 105,600 lb (MTOW) from
   * the FDM CLmax design values (dossier §4.3): Gulfstream swept wing without
   * leading-edge devices (BJT500), single-slotted Fowler flaps. Vref (1.23
   * Vsr, 14 CFR 25.125) at MLW flaps 39 = 131 KIAS; VMCL 106 KCAS (FSB) is
   * well below.
   */
  vs1gMlwClean: 124,
  vs1gMlwF39: 106,
  vs1gMtowF20: 125,
  vrefMlw: 131,
  /** EST takeoff speeds at MTOW flaps 20, SL ISA: V2 = 1.13 Vsr ~ 141; VR ~ 137; V1 ~ 133 (above VMCG 104). */
  v1Mtow: 133,
  vrMtow: 137,
  v2Mtow: 141,
} as const;

/** Vref (KIAS) vs landing weight (lb), flaps 39: 1.23 x Vs1g (EST from the FDM CLmax, see G800_PERF). */
export function vref(weightLb: number): number {
  return Math.round(G800_PERF.vrefMlw * Math.sqrt(weightLb / G800_LIMITS.mlwLb));
}

/** EST takeoff V-speeds at flaps 20 scaled with sqrt(weight) from the MTOW values, floored by VMCG/VMCA. */
export function takeoffSpeeds(weightLb: number): { v1: number; vr: number; v2: number } {
  const k = Math.sqrt(weightLb / G800_LIMITS.mtowLb);
  const v2 = Math.max(Math.round(G800_PERF.v2Mtow * k), Math.round(1.1 * G800_LIMITS.vmcaF20Kt));
  const vr = Math.max(Math.round(G800_PERF.vrMtow * k), Math.round(1.05 * G800_LIMITS.vmcaF20Kt));
  const v1 = Math.min(vr, Math.max(Math.round(G800_PERF.v1Mtow * k), G800_LIMITS.vmcgKt + 2));
  return { v1, vr, v2 };
}
