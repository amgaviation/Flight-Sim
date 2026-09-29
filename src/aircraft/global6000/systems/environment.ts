/**
 * Bombardier Global 6000 bleed air, air conditioning, pressurization, ice
 * and rain protection, APU, fire protection and oxygen.
 *
 * IAMS (GXAG "IAMS: controls and monitors the airplane bleed-air,
 * environmental, cabin pressurization and anti-ice systems"). Controls on the
 * overhead BLEED/AIR COND and ANTI-ICE panels (GX_01_018): L / R ENG BLEED,
 * APU BLEED (CLSD / AUTO / OPEN), XBLEED (CLSD / AUTO / OPEN), L / R PACK,
 * TRIM AIR, RECIRC, RAM AIR, PACK CONTROL L / R MAN TEMP, TEMPERATURE COCKPIT
 * / FWD CABIN / AFT CABIN, WING and L / R COWL anti-ice (OFF / AUTO / ON), WING
 * XBLEED. Bleed architecture EST (public manual chapter not available): each
 * engine's HP/LP bleed feeds its own duct through a PRSOV; the APU load
 * control valve (~45 psi, GXAPU) feeds the left duct; the crossbleed valve
 * joins the ducts (AUTO: open for engine starts on APU / cross bleed and with
 * a single bleed source). Air turbine starters on each duct.
 * Pressurization: 4,500 ft cabin at FL450 (AOPA), 10.33 psid max (EST, the
 * systems-power PRESS_GLOBAL6000 preset); AUTO (FMS landing elevation) / MAN
 * (MAN ALT UP / DN on the outflow valves); EMERG DEPRESS; DITCHING closes the
 * outflow valves; OUTFLOW VALVE 1 / 2 CLOSED.
 * Ice (EST architecture): bleed-heated wing / slat leading edges and engine
 * cowls, ice detectors (AUTO), electrically heated windshields (L / R PBAs,
 * side windows follow), probes / AOA vanes heated automatically by the HBMU.
 * APU (GXAPU, TCDS 5.2): Honeywell RE220 GX, single rotary OFF / RUN / START,
 * starter from the APU battery (28 VDC required), starter cut-out 46 %,
 * 60 s cooldown, EGT start limit 1,020 C.
 * Fire (GXFP): FIDEEX dual loops (engines, APU), single loops in the main
 * wheel wells; two bottles, each can be discharged into either engine or the
 * APU (squib 1 = bottle 1, squib 2 = bottle 2).
 * Oxygen: crew quick-donning masks (N / 100 % / EMERGENCY), passenger
 * oxygen NORMAL (auto deploy at 14,000 ft cabin, EST) / OVERRIDE / CLOSED.
 */
import type { SimContext } from '../../../core/SimContext';
import { ICE } from '../../../core/vars';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization, PRESS_GLOBAL6000 } from '../../../systems/pressurization';
import { IceProtection } from '../../../systems/ice';
import { Apu } from '../../../systems/apu';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { G6K_LIMITS } from '../data';
import { G6K_VARS as V } from '../vars';

export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const hp = { belowPsi: 30, ratio: 1.6 }; // EST: HP port opens at low LP pressure (idle)
  return new PneumaticSystem(ctx.vars, {
    ducts: ['l_duct', 'r_duct'],
    sources: [
      // Engine PRVs: FCOM CSP 700-6 02-10 (Global Express XRS) "supplied to 43 +/- 3 psig"; EST 1.0 kg/s capacity;
      // closed by the fire handle (logic.ts BMC rules).
      { id: 'eng1', duct: 'l_duct', pressure: 'eng1.bleed_press_psi', valve: V.engBleedCmd('l'), regulatedPsi: 43, maxFlowKgs: 1.0, engine: 1, hp },
      { id: 'eng2', duct: 'r_duct', pressure: 'eng2.bleed_press_psi', valve: V.engBleedCmd('r'), regulatedPsi: 43, maxFlowKgs: 1.0, engine: 2, hp },
      // APU load control valve (GXAPU ~45 psi), EST 0.8 kg/s.
      { id: 'apu', duct: 'l_duct', pressure: 'apu.bleed_psi', valve: V.apuBleedCmd, regulatedPsi: 45, maxFlowKgs: 0.8 },
    ],
    valves: [{ id: 'iso', a: 'l_duct', b: 'r_duct', open: V.xbleedCmd, travelS: 3, power: 'elec.bmc1_powered || elec.bmc2_powered' }],
    consumers: [
      // Wing / slat anti-ice (EST 0.2 kg/s per side); WING XBLEED opens the wing crossbleed (logic joins the demand).
      { id: 'wai_l', duct: 'l_duct', demandKgs: `0.2 * ${V.waiCmd('l')}`, minPsi: 22 },
      { id: 'wai_r', duct: 'r_duct', demandKgs: `0.2 * ${V.waiCmd('r')}`, minPsi: 22 },
      { id: 'cai_l', engine: 1, demandKgs: `0.07 * ${V.caiCmd('l')}`, minPsi: 10 },
      { id: 'cai_r', engine: 2, demandKgs: `0.07 * ${V.caiCmd('r')}`, minPsi: 10 },
      // AUX PRESS (GX PTG 13-24 "AUXILIARY PRESSURIZATION ... alternate pressurization source for the cabin in the event
      // of the loss of both cooling packs ... The ACSC commands the HASOVs to mid position and the trim valves to full
      // open to use trim air for pressurization"). EST 0.2 kg/s of hot trim air from the left duct (HASOVs at mid
      // travel: about half of one pack's flow); needs the ACSCs (BMC power) and TRIM AIR not selected OFF.
      { id: 'aux_press', duct: 'l_duct', demandKgs: `0.2 * (${V.auxPress} == 1 && ${V.trimAir} == 1 && (elec.bmc1_powered || elec.bmc2_powered))`, minPsi: 18 },
    ],
    packs: [
      // EST 0.4 kg/s per pack; the MAN TEMP knob overrides the outlet temperature demand (logic.ts biases the zones).
      // PACK CONTROL LO / NORM / HIGH / MAN scales the flow (vision.ts V.packFlowFactor, PTG 13-21 schedule).
      { id: 'pack_l', duct: 'l_duct', on: V.packCmd('l'), flowKgs: `0.4 * ${V.packFlowFactor}`, minPsi: 18, minOutletC: 2, maxOutletC: 70 },
      { id: 'pack_r', duct: 'r_duct', on: V.packCmd('r'), flowKgs: `0.4 * ${V.packFlowFactor}`, minPsi: 18, minOutletC: 2, maxOutletC: 70 },
    ],
    zones: [
      // Zone ids zone1..3 = the Fusion AIR COND page CKPT / FWD CABIN / AFT CABIN (readouts pneu.zone{n}_temp_c).
      { id: 'zone1', packs: ['pack_l', 'pack_r'], target: zoneTarget(1, 'l'), volumeM3: 9, heatLoadW: 1500, initialC: 20 },
      { id: 'zone2', packs: ['pack_l', 'pack_r'], target: zoneTarget(2, 'l'), volumeM3: 32, heatLoadW: 2500, initialC: 20 },
      { id: 'zone3', packs: ['pack_r', 'pack_l'], target: zoneTarget(3, 'r'), volumeM3: 32, heatLoadW: 2200, initialC: 20 },
    ],
    starters: [
      { id: 'start1', engine: 1, duct: 'l_duct', command: 'fadec.eng1.starter_cmd', valvePower: 'elec.start_valve1_powered', nominalPsi: 35, demandKgs: 0.6 },
      { id: 'start2', engine: 2, duct: 'r_duct', command: 'fadec.eng2.starter_cmd', valvePower: 'elec.start_valve2_powered', nominalPsi: 35, demandKgs: 0.6 },
    ],
  });
}

/**
 * Zone target temperature: the TEMPERATURE knob (16..30 degC) with TRIM AIR on. TRIM AIR OFF (GX PTG 13-29: the
 * HASOVs and trim valves close, the zones are no longer trimmed individually): every zone receives the pack air
 * controlled to the cockpit demand (EST: ACSC 2 / cockpit channel). PACK CONTROL MAN (V.packCtlMan, vision.ts): the
 * L / R MAN TEMP HOT / COLD toggles position the pack temperature control valve (V.packManTemp 0 COLD .. 1 HOT ->
 * outlet 2 .. 70 degC). AUX PRESS with both packs off (GX PTG 13-25): hot trim air only; the recirculation fans cool
 * the supply ("the recirculation system should be selected ON to reduce the supply temperatures"): EST 30 degC with
 * RECIRC, 45 degC without. Cockpit zone: EST -0.4 degC per fully open gasper.
 */
function zoneTarget(z: 1 | 2 | 3, pack: 'l' | 'r'): string {
  const man = V.packManTemp(pack);
  const base = `${V.packCtlMan} == 1 ? 2 + ${man} * 68 : (${V.trimAir} == 1 ? ${V.zoneTemp(z)} : ${V.zoneTemp(1)})`;
  const aux = `${V.auxPress} == 1 && !${V.packCmd('l')} && !${V.packCmd('r')}`;
  const auxT = `(${V.recircFan} == 1 && (elec.recirc_fan_l_powered || elec.recirc_fan_r_powered) ? 30 : 45)`;
  return `(${aux} ? ${auxT} : (${base}))${z === 1 ? ` - 0.4 * ${V.gasperFlow}` : ''}`;
}

/** Cabin schedule (AOPA 4,500 ft at FL450; 5,680 ft at FL510 EST, PRESS_GLOBAL6000). */
export const G6K_CABIN_SCHEDULE = PRESS_GLOBAL6000.schedule;

/**
 * Cabin pressure control (GX PTG 13-40 .. 13-62; FCOM CSP 700-6 02-10 with SB 700-21-034, the Global 6000
 * standard: 10.33 psid maximum differential, 5,670 ft cabin at 51,000 ft, safety valves at 10.63 psid):
 *  - AUTO (either CPC) / MAN (MAN ALT UP / DN drives both OFVs slowly through the manual channel, EST 60 s travel).
 *  - RATE NORM (+500 / -300 fpm) / HIGH (up to 800 fpm descent) in AUTO.
 *  - Cabin altitude limiters (14,500 ft) and the 3,000 fpm rate limiter override AUTO and MAN and close the OFVs
 *    (logic.ts V.pressLimiter); the OFV travel limiter keeps each OFV <= 50 % open above 7 psid.
 *  - EMER DEPRESS: fast depressurization in AUTO or MAN through the manual drive, limited by the cabin altitude
 *    limiter (the rate limiter is inoperative).
 *  - OUTFLOW VALVE 1 / 2 CLOSED: that OFV driven closed (the other keeps modulating: half the outflow area); both
 *    closed = no outflow.
 *  - DITCHING (below 15,000 ft): packs off (logic.ts), depressurize, then both OFVs closed (V.ditchSeq).
 *  - Door open protection: OFVs driven open while the main entrance door is not closed and locked.
 */
export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  const L = G6K_LIMITS;
  const both = `(${V.outflowClosed(1)} == 1 && ${V.outflowClosed(2)} == 1)`;
  const one = `(${V.outflowClosed(1)} == 1) != (${V.outflowClosed(2)} == 1)`;
  const door = `${V.door('pax')} == 1`;
  const close = `${V.pressLimiter} == 1 || ${V.ditchSeq} == 2 || ${both}`;
  const open = `!(${close}) && ${door}`;
  return new Pressurization(ctx.vars, {
    ...PRESS_GLOBAL6000,
    maxDiffPsi: L.maxDiffPsi,
    reliefPsi: L.reliefPsi,
    schedule: { x: [0, 45000, 51000], y: [0, L.cabinAtFl450Ft, 5670] }, // AOPA 4,500 ft at FL450; FCOM 5,670 ft at 51,000 ft
    maxCabinDescentFpmBinding: `${V.pressRateHigh} == 1 ? ${L.pressRateHighDescFpm} : 300`,
    // EST: combined OFV area sized so the EMER DEPRESS transient gives a plausible ~5,000-10,000 fpm cabin climb
    // (comparable-type dump rates; no public Global OFV area data) while still reaching the 14,500 ft limiter
    // (pinned in fidelity/audit3-probes.test.ts). manualTravelS: "both outflow valves open slowly" (GX PTG 13-54).
    outflowValve: { manualTravelS: 60, maxAreaM2: 9e-3 },
    // Safety (positive relief) valves kept at the shared default area (independent of the smaller OFVs).
    safetyAreaM2: 0.026,
    // Limiters / ditching close stage / both OFVs CLOSED force the OFVs shut (0); one OFV CLOSED halves the outflow area;
    // the OFV travel limiter holds <= 50 % above 7 psid (GX PTG 13-59).
    outflowLimit: `(${close}) ? 0 : min(${one} ? 0.5 : 1, press.diff_psi > ${L.ofvTravelLimitPsi} ? ${L.ofvTravelLimitPos} : 1)`,
    cabinVolumeM3: 75, // EST: 2,000 ft^3 cabin (Jetcraft / Conklin) + cockpit + baggage
    negReliefPsi: 0.5, // GX PTG 13-61: negative relief at -0.5 psid
    flightAltitude: 'fms.crz_alt_ft',
    landingBiasFt: -250, // EST
    landingElevation: V.ldgElevFt,
    landingElevationAuto: `${V.ldgElevFms} == 1`,
    destinationElevation: (ident) => {
      try {
        return typeof ctx.nav?.airport === 'function' ? ctx.nav.airport(ident)?.elevationFt : undefined;
      } catch {
        return undefined;
      }
    },
    // GX_01_018 placard: differential <= 0.1 psi during taxi, <= 1.0 psi at initial landing. EST 0.1 psi pre-pressurisation
    // on the take-off roll.
    groundPrepress: { active: `${V.toThrust} && gear.air_ground && ${V.pressAutoMan} == 0`, psi: L.taxiDiffPsi },
    // Packs + AUX PRESS trim air + ram air (EST 0.05 kg/s of unpressurized ventilation through the ram air valve).
    inflowKgs: `pneu.pack_flow_kgs + pneu.aux_press_flow_kgs + 0.05 * ${V.ramValveOpen}`,
    // AUTO 0 / MAN 2; the door-open protection drives the OFVs open through the manual channel (mode 2).
    mode: `(${open}) ? 2 : ${V.pressAutoMan}`,
    manualCommand: `(${open}) ? 1 : ${V.pressManAlt}`,
    // EMER DEPRESS (AUTO or MAN) and the ditching depressurization stage drive both OFVs open; the limiters, the
    // ditching close stage and both OFVs CLOSED use the same override path (the valves move at the auto actuator rate in
    // AUTO and MAN) with the outflow limit above forcing them shut.
    dump: `${V.emerDepress} == 1 || ${V.ditchSeq} == 1 || ${close}`,
    dumpAllModes: true,
    cabinAltWarnFtBinding: V.cabAltWarnFt, // 9,000 ft (raised for high landing / take-off fields, logic.ts)
    masksDeployFt: L.paxMaskFt,
    masksManual: `${V.paxOxy} == 2`,
    onGround: 'gear.air_ground',
    cabinTempC: 'pneu.zone2_temp_c',
  });
}

export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  const probe = `${V.probeHeat} * elec.probe_heat_powered`;
  return new IceProtection(ctx.vars, {
    surfaces: [
      // SCOPE: one airframe ice value (the less protected wing).
      { id: 'wing_l', output: ICE.airframe, ratePerMin: 0.1, protection: { kind: 'thermal', active: `min(${V.waiCmd('l')} * pneu.wai_l_ok, ${V.waiCmd('r')} * pneu.wai_r_ok)` } },
      { id: 'wing_r', output: 'ice.wing_r', ratePerMin: 0.1, protection: { kind: 'thermal', active: `${V.waiCmd('r')} * pneu.wai_r_ok` } },
      { id: 'cowl_l', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: `${V.caiCmd('l')} * pneu.cai_l_ok` } },
      { id: 'cowl_r', output: ICE.inlet(2), ratePerMin: 0.15, engine: 2, protection: { kind: 'thermal', active: `${V.caiCmd('r')} * pneu.cai_r_ok` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'pitot3', output: ICE.pitot(3), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'static1', output: ICE.static(1), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'static2', output: ICE.static(2), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'static3', output: ICE.static(3), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe } },
      { id: 'windshield_l', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldOn('l')} * elec.wshld_l_powered` } },
      { id: 'windshield_r', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldOn('r')} * elec.wshld_r_powered` } },
    ],
    detector: { power: 'elec.ice_det_powered', threshold: 0.03, holdS: 60 },
  });
}

export function createApu(ctx: Pick<SimContext, 'vars'>): Apu {
  return new Apu(ctx.vars, {
    master: `${V.apuSw} >= 1 && elec.apu_fadec_powered`,
    start: `${V.apuSw} == 2`,
    starterVolts: 'elec.apu_batt_dir_v', // GXAPU CB: APU START on the APU battery (ASCA)
    starterNominalV: 25.2,
    starterPeakA: 500, // EST: RE220 starter inrush on the 42 Ah NiCd
    fuelAvailable: V.apuFuelOk, // fuel.apu_on with a 2 s changeover ride-through (logic.ts G6kPostLogic)
    // FADEC immediate shutdown (logic.ts): ground fire 5 s, APU fire handle pulled, BATT MASTER OFF without AC power.
    fire: V.apuFireShutdown,
    bleedLoad: 'clamp01(pneu.apu_flow_kgs / 0.8)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: G6K_LIMITS.apuBleedPsi,
    bleedCeilingFt: G6K_LIMITS.apuBleedCeilingFt,
    startCeilingFt: G6K_LIMITS.apuStartCeilingFt, // GXAPU / TCDS 5.2: RE220 start envelope 37,000 ft
    operatingCeilingFt: G6K_LIMITS.apuOperatingCeilingFt, // GXAPU: operating envelope 45,000 ft (auto shutdown above)
    doorTimeS: 10, // EST: inlet door + prestart BIT (APU IN BITE)
    startTimeS: 40, // EST
    availDelayS: 2,
    cooldownS: 60, // GXAPU: 60 s unloaded cooldown
    starterCutoutPct: 46, // GXAPU: starter cut-out at 46 % at sea level
    selfSustainPct: 40,
    egtLimitC: G6K_LIMITS.apuEgtStartMaxC,
    ffIdlePph: 170, // EST
    ffFullPph: 290, // EST RE220 loaded
  });
}

export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  const zone = (id: string, z: 'l' | 'apu' | 'r', power: string) => ({
    id,
    loops: 2 as const,
    handle: V.fireHandle(z),
    // Fuel to the zone cut by the handle (engine / APU SOVs) or the ENG RUN switch / APU rotary at OFF.
    fuelCut: `${V.fireHandle(z)} || ${z === 'apu' ? `${V.apuSw} == 0` : `${V.engRun(z === 'l' ? 1 : 2)} == 0`}`,
    discharge: [
      { bottle: 'bottle1', command: V.fireDisch(z, 1) },
      { bottle: 'bottle2', command: V.fireDisch(z, 2) },
    ],
    power,
  });
  return new FireProtection(ctx.vars, {
    zones: [
      zone('eng1', 'l', 'elec.fideex_a_powered || elec.fideex_b_powered'),
      zone('eng2', 'r', 'elec.fideex_a_powered || elec.fideex_b_powered'),
      zone('apu', 'apu', 'elec.fideex_a_powered || elec.fideex_b_powered'),
      // Main wheel wells: single loop, detection only (GXFP).
      { id: 'mlg', loops: 1, handle: 0, power: 'elec.fideex_a_powered || elec.fideex_b_powered' },
    ],
    bottles: [
      { id: 'bottle1', chargePsi: 600, tempC: 'fdm.sat_c' }, // EST Halon 1301 charge
      { id: 'bottle2', chargePsi: 600, tempC: 'fdm.sat_c' },
    ],
    test: { fire: V.fireTest },
  });
}

export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  // EST: crew bottle 115 ft^3 (3,256 L NTPD) at 1,850 psi; passenger bottles 2 x 115 ft^3 (gaseous system). The GX PTG
  // 8-4 gives four 50.1 ft^3 (1,418 L) bottles at 1,850 psi shared by crew and passengers; the split is kept (SCOPE).
  const ft3 = 28.3168;
  return new OxygenSystem(ctx.vars, {
    bottles: [
      // Crew supply: each side console has its OXYGEN SUPPLY LOWER DISCONNECT ON / OFF (GX PTG 15-10 side console
      // drawing); the bottle feeds while either is ON, and each mask only with its own side's supply ON (below).
      { id: 'crew', capacityL: 115 * ft3, fullPsi: 1850, lowPsi: 400, valve: `${V.crewOxy} == 1 || ${V.crewOxyR} == 1` },
      { id: 'pax', capacityL: 230 * ft3, fullPsi: 1850, lowPsi: 400, valve: `${V.paxOxy} >= 1` },
    ],
    crew: [
      // Each stowage box has its own N / 100 % regulator selector and RESET / TEST (FCOM 01-10-37 / -46).
      // Regulator N / 100 % lever and the EMERGENCY push (100 % oxygen, continuous positive pressure, GX PTG 8-4 / 8-7):
      // mode 0 N, 1 100 %, 2 EMERGENCY.
      { id: 'pilot', bottle: 'crew', inUse: `${V.oxyMask(1)} == 1 && ${V.crewOxy} == 1`, mode: `${V.oxyEmer(1)} == 1 ? 2 : ${V.oxyMaskMode}`, test: `${V.oxyTest(1)} == 1 && ${V.crewOxy} == 1` },
      { id: 'copilot', bottle: 'crew', inUse: `${V.oxyMask(2)} == 1 && ${V.crewOxyR} == 1`, mode: `${V.oxyEmer(2)} == 1 ? 2 : ${V.oxyMaskModeR}`, test: `${V.oxyTest(2)} == 1 && ${V.crewOxyR} == 1` },
    ],
    pax: { kind: 'gaseous', deploy: `${V.paxOxy} == 2 || (${V.paxOxy} == 1 && press.pax_masks)`, bottle: 'pax', flowLpm: 60 },
  });
}
