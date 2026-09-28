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
      // Engine PRSOVs, EST 45 psi regulation, 1.0 kg/s capacity; closed by the fire handle.
      { id: 'eng1', duct: 'l_duct', pressure: 'eng1.bleed_press_psi', valve: V.engBleedCmd('l'), regulatedPsi: 45, maxFlowKgs: 1.0, engine: 1, hp },
      { id: 'eng2', duct: 'r_duct', pressure: 'eng2.bleed_press_psi', valve: V.engBleedCmd('r'), regulatedPsi: 45, maxFlowKgs: 1.0, engine: 2, hp },
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
 * Zone target temperature: the TEMPERATURE knob (16..30 degC); with TRIM AIR
 * OFF the zones follow the pack outlet (EST: target pulled toward 18 degC),
 * with the PACK CONTROL MAN TEMP knob out of AUTO the pack outlet demand is
 * the knob (COLD 2 degC .. HOT 70 degC) while PACK CONTROL is at MAN.
 */
function zoneTarget(z: 1 | 2 | 3, pack: 'l' | 'r'): string {
  const man = V.packManTemp(pack);
  // PACK CONTROL at MAN (V.packCtlMan, vision.ts): the L / R MAN TEMP HOT / COLD toggles set the pack outlet demand.
  // Cockpit zone: EST -0.4 degC per fully open gasper (the gaspers blow conditioned air at the crew stations and the
  // cockpit temperature sensor; no published figure). AUX PRESS ON: hot trim air only (EST 30 degC supply) when both
  // packs are off.
  const base = `${V.packCtlMan} == 1 ? 2 + ${man} * 68 : (${V.trimAir} == 1 ? ${V.zoneTemp(z)} : 18)`;
  const aux = `${V.auxPress} == 1 && !${V.packCmd('l')} && !${V.packCmd('r')}`;
  return `(${aux} ? 30 : (${base}))${z === 1 ? ` - 0.4 * ${V.gasperFlow}` : ''}`;
}

/** Cabin schedule (AOPA 4,500 ft at FL450; 5,680 ft at FL510 EST, PRESS_GLOBAL6000). */
export const G6K_CABIN_SCHEDULE = PRESS_GLOBAL6000.schedule;

export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  const closed = `(${V.outflowClosed(1)} == 1 && ${V.outflowClosed(2)} == 1) || ${V.ditching} == 1`;
  return new Pressurization(ctx.vars, {
    ...PRESS_GLOBAL6000,
    cabinVolumeM3: 75, // EST: 2,000 ft^3 cabin (Jetcraft / Conklin) + cockpit + baggage
    negReliefPsi: 0.5,
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
    groundPrepress: { active: `${V.toThrust} && gear.air_ground && ${V.pressAutoMan} == 0`, psi: G6K_LIMITS.taxiDiffPsi },
    inflowKgs: 'pneu.pack_flow_kgs + pneu.aux_press_flow_kgs', // packs + AUX PRESS trim air
    // AUTO 0 / MAN 2 (MAN ALT toggle on the outflow valves); both OUTFLOW VALVE CLOSED or DITCHING -> manual, closing.
    mode: `(${closed}) ? 2 : ${V.pressAutoMan}`,
    manualCommand: `(${closed}) ? -1 : ${V.pressManAlt} * (0.3 + 0.7 * ${V.pressManRate})`,
    // EMER DEPRESS drives the outflow valves open until the outflow valves' pneumatic cabin-altitude limiter takes
    // over. EST: 14,500 ft (the Bombardier CRJ / Challenger FCOMs give EMER DEPRESS "cabin altitude limited to
    // 14,500 ft"; 14 CFR 25.841(a)(2) keeps the cabin below 15,000 ft after any probable failure). Without the limiter
    // the dump took the cabin to ~38,600 ft at FL410 (found by verify/abnormal.test.ts).
    // The limiter anticipates with the cabin rate over the ~5 s outflow valve travel (EST) so the cabin does not
    // overshoot while the valves close.
    dump: `${V.emerDepress} == 1 && !(${V.ditching} == 1) && press.cabin_alt_ft + max(0, press.cabin_rate_fpm) * 5 / 60 < ${G6K_LIMITS.cabinLimiterFt}`,
    cabinAltWarnFt: 10000, // EST: CABIN ALT warning at 10,000 ft (14 CFR 25.841(b)(6))
    masksDeployFt: G6K_LIMITS.paxMaskFt,
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
    fire: 'fire.apu_warn || fire.apu_armed',
    bleedLoad: 'clamp01(pneu.apu_flow_kgs / 0.8)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: G6K_LIMITS.apuBleedPsi,
    bleedCeilingFt: G6K_LIMITS.apuBleedCeilingFt,
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
  // EST: crew bottle 115 ft^3 (3,256 L NTPD) at 1,850 psi; passenger bottles 2 x 115 ft^3 (gaseous system).
  const ft3 = 28.3168;
  return new OxygenSystem(ctx.vars, {
    bottles: [
      { id: 'crew', capacityL: 115 * ft3, fullPsi: 1850, lowPsi: 400, valve: `${V.crewOxy} == 1` },
      { id: 'pax', capacityL: 230 * ft3, fullPsi: 1850, lowPsi: 400, valve: `${V.paxOxy} >= 1` },
    ],
    crew: [
      // Each stowage box has its own N / 100 % regulator selector and RESET / TEST (FCOM 01-10-37 / -46).
      { id: 'pilot', bottle: 'crew', inUse: V.oxyMask(1), mode: V.oxyMaskMode, test: `${V.oxyTest(1)} == 1` },
      { id: 'copilot', bottle: 'crew', inUse: V.oxyMask(2), mode: V.oxyMaskModeR, test: `${V.oxyTest(2)} == 1` },
    ],
    pax: { kind: 'gaseous', deploy: `${V.paxOxy} == 2 || (${V.paxOxy} == 1 && press.pax_masks)`, bottle: 'pax', flowLpm: 60 },
  });
}
