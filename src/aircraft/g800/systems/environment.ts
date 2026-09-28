/**
 * G800 bleed air, air conditioning (4 zones), pressurization, ice protection,
 * APU, fire protection and oxygen.
 *
 * Bleed (SCQ pneumatics, GVI family): 5th-stage (HP5) bleed for the ECS with
 * 8th-stage (HP8) supplementing when demand exceeds HP5; precoolers in the
 * pylons (fan air); Bleed Air Controllers; the APU check valve lets APU air into
 * the bleed manifold when its pressure exceeds engine pressure; in flight the
 * APU load-control valve opens only with both engine bleeds, both packs and wing
 * anti-ice OFF (SCQ); APU starter-assisted engine starts at and below 35,000 ft
 * (SCQ). START MASTER ON opens the isolation valve and shuts off both packs
 * (SCQ powerplant). FSB App. 4: automatic engine bleed shutoff in certain
 * abnormal conditions (logic.ts).
 * ECS: two packs, four temperature zones on the G800 (FSB App. 3/4: "increased
 * ECS cabin zones from 3 to 4"): cockpit, forward, mid and aft cabin.
 * Pressurization: 10.69 psid max (GVI), 2,840-2,916 ft cabin at FL410 (GAC /
 * BJT800), 4,850 ft at FL510 (PRESS_G800 preset); AUTO / SEMI / MANUAL (GVI
 * CABIN PRESSURE CONTROL AUTO / SEMI / MANUAL), DUMP.
 * Ice (SCQ ice & rain; FSB App. 4): bleed-heated wing leading edges (two
 * independent systems linked by a crossover duct) and engine cowls (CAI valve
 * spring-loaded open, uses the engine's own bleed), electrically heated
 * windshields, cabin windows, EVS window and probes; two ice detectors; G800
 * automatic WAI inhibited on the ground and above FL350, automatic CAI above
 * FL350 (logic.ts writes the effective on commands).
 * APU (TCDS §6): Honeywell RE220(GVI); GVI limits (EGT start 1,050 / running
 * 732 degC, 45,000 ft, 40 kVA generator); battery start; automatic fire shutdown (SCQ fire).
 * Fire (SCQ fire; GVI; code450): two single-shot Halon bottles in the tail; DISCH 1 (handle
 * rotated outboard) = RIGHT bottle, DISCH 2 (inboard) = LEFT bottle; the APU uses the LEFT bottle; dual continuous
 * loops per engine; baggage smoke detector ("Aft Baggage Smoke", C450).
 * Oxygen (EST capacities): crew quick-donning masks on a crew bottle; passenger
 * masks from a separate gaseous bottle, auto-deployed at 14,000 ft cabin (EST).
 */
import type { SimContext } from '../../../core/SimContext';
import { ICE } from '../../../core/vars';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization, PRESS_G800 } from '../../../systems/pressurization';
import { IceProtection } from '../../../systems/ice';
import { Apu } from '../../../systems/apu';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { G800_LIMITS } from '../data';
import { G800_VARS as V } from '../vars';

export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const hp = { belowPsi: 28, ratio: 1.6 }; // HP8 supplements HP5 when HP5 is low (SCQ); 28 psi EST (C450 G450: 28 psi minimum for start)
  // SCQ: APU load control valve in flight only with both engine bleeds, both packs and WAI off.
  const apuLcv = `${V.bleedApu} == 1 && apu.avail && (gear.air_ground || (${V.bleedL} == 0 && ${V.bleedR} == 0 && !${V.packOn(1)} && !${V.packOn(2)} && !${V.waiOn(1)} && !${V.waiOn(2)}))`;
  return new PneumaticSystem(ctx.vars, {
    ducts: ['l_man', 'r_man'],
    sources: [
      { id: 'bleed_l', duct: 'l_man', pressure: 'eng1.bleed_press_psi', valve: `${V.bleedL} == 1 && ${V.fireHandleL} == 0 && !ac.g800.bleed_auto_off1`, regulatedPsi: 45, maxFlowKgs: 0.9, engine: 1, hp },
      { id: 'bleed_r', duct: 'r_man', pressure: 'eng2.bleed_press_psi', valve: `${V.bleedR} == 1 && ${V.fireHandleR} == 0 && !ac.g800.bleed_auto_off2`, regulatedPsi: 45, maxFlowKgs: 0.9, engine: 2, hp },
      // APU bleed through the check valve into the (left) bleed manifold; EST 0.8 kg/s at 45 psi.
      { id: 'apu_bleed', duct: 'l_man', pressure: 'apu.bleed_psi', valve: apuLcv, regulatedPsi: 45, maxFlowKgs: 0.8 },
    ],
    valves: [{ id: 'iso', a: 'l_man', b: 'r_man', open: V.isoOpen, travelS: 3, power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered' }],
    consumers: [
      // Wing anti-ice: EST 0.15 kg/s per side from the manifold (crossover duct: the iso valve lets one side feed both).
      { id: 'wai_l', duct: 'l_man', demandKgs: `${V.waiOn(1)} * 0.15`, minPsi: 25 },
      { id: 'wai_r', duct: 'r_man', demandKgs: `${V.waiOn(2)} * 0.15`, minPsi: 25 },
      // Cowl anti-ice from the engine's own bleed (EST 0.06 kg/s).
      { id: 'cai_l', engine: 1, demandKgs: `${V.caiOn(1)} * 0.06`, minPsi: 15 },
      { id: 'cai_r', engine: 2, demandKgs: `${V.caiOn(2)} * 0.06`, minPsi: 15 },
    ],
    packs: [
      // EST 0.55 kg/s per pack (60.5 m^3 cabin: ~1 air change per 1.5 min with both packs).
      { id: 'pack_l', duct: 'l_man', on: `${V.packOn(1)} && elec.pack_ctl_l_powered`, flowKgs: 0.55, minPsi: 18 },
      { id: 'pack_r', duct: 'r_man', on: `${V.packOn(2)} && elec.pack_ctl_r_powered`, flowKgs: 0.55, minPsi: 18 },
    ],
    zones: [
      { id: 'cockpit', packs: ['pack_l'], target: V.zoneTemp(1), volumeM3: 6, heatLoadW: 1200, initialC: 20 },
      { id: 'fwd_cabin', packs: ['pack_l', 'pack_r'], target: V.zoneTemp(2), volumeM3: 18, heatLoadW: 1500, initialC: 20 },
      { id: 'mid_cabin', packs: ['pack_l', 'pack_r'], target: V.zoneTemp(4), volumeM3: 18, heatLoadW: 1500, initialC: 20 },
      { id: 'aft_cabin', packs: ['pack_r'], target: V.zoneTemp(3), volumeM3: 20, heatLoadW: 1500, initialC: 20 },
    ],
    starters: [
      { id: 'ats_l', engine: 1, duct: 'l_man', command: 'fadec.eng1.starter_cmd', valvePower: 'elec.l_ess_dc_powered', nominalPsi: 40, demandKgs: 0.5 },
      { id: 'ats_r', engine: 2, duct: 'r_man', command: 'fadec.eng2.starter_cmd', valvePower: 'elec.r_ess_dc_powered', nominalPsi: 40, demandKgs: 0.5 },
    ],
  });
}

export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  return new Pressurization(ctx.vars, {
    ...PRESS_G800,
    maxDiffPsi: G800_LIMITS.maxDiffPsi,
    reliefPsi: 10.95, // EST: safety valve just above the 10.69 psid maximum
    cabinVolumeM3: 68, // GAC 2,138 ft^3 cabin (60.5 m^3) + cockpit + baggage (EST)
    maxCabinClimbFpm: 500,
    maxCabinDescentFpm: 300,
    landingBiasFt: -200, // EST
    // SEMI: crew landing elevation; AUTO: FMS destination (falls back to the entered elevation).
    landingElevation: V.pressLdgElev,
    landingElevationAuto: `${V.pressMode} == 0`,
    destinationElevation: (ident) => {
      try {
        return typeof ctx.nav?.airport === 'function' ? ctx.nav.airport(ident)?.elevationFt : undefined;
      } catch {
        return undefined;
      }
    },
    groundPrepress: { active: `${V.toThrust} && gear.air_ground`, psi: 0.1 },
    inflowKgs: 'pneu.pack_flow_kgs',
    // AUTO -> automatic controller, SEMI -> alternate channel (crew landing elevation), MANUAL -> manual rate.
    mode: V.pressMode,
    manualCommand: V.pressManual,
    dump: `${V.pressDump} == 1 || ${V.ramAir} == 1`,
    cabinAltWarnFt: G800_LIMITS.cabinAltWarnFt,
    masksDeployFt: 14000, // EST
    masksManual: `${V.oxyPax} == 2`,
    onGround: 'gear.air_ground',
    cabinTempC: 'pneu.fwd_cabin_temp_c',
  });
}

export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  return new IceProtection(ctx.vars, {
    surfaces: [
      // Wing halves (combined into ice.airframe by the post logic).
      { id: 'wing_l', output: 'ice.wing_l', ratePerMin: 0.1, protection: { kind: 'thermal', active: `${V.waiOn(1)} * pneu.wai_l_ok` } },
      { id: 'wing_r', output: 'ice.wing_r', ratePerMin: 0.1, protection: { kind: 'thermal', active: `${V.waiOn(2)} * pneu.wai_r_ok` } },
      { id: 'cowl_l', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: `${V.caiOn(1)} * pneu.cai_l_ok` } },
      { id: 'cowl_r', output: ICE.inlet(2), ratePerMin: 0.15, engine: 2, protection: { kind: 'thermal', active: `${V.caiOn(2)} * pneu.cai_r_ok` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: `${V.probeHeatOn} * elec.probes_l_powered` } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: `${V.probeHeatOn} * elec.probes_r_powered` } },
      { id: 'pitot3', output: ICE.pitot(3), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: `${V.probeHeatOn} * elec.probes_l_powered` } },
      { id: 'static1', output: ICE.static(1), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: `${V.probeHeatOn} * elec.probes_l_powered` } },
      { id: 'static2', output: ICE.static(2), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: `${V.probeHeatOn} * elec.probes_r_powered` } },
      { id: 'wshld_l', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: 'ac.g800.wshld_l_on * elec.wshld_l_powered' } },
      { id: 'wshld_r', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'electric', active: 'ac.g800.wshld_r_on * elec.wshld_r_powered' } },
    ],
    detector: { power: 'elec.ice_det_powered', threshold: 0.05, holdS: 60 },
  });
}

export function createApu(ctx: Pick<SimContext, 'vars'>): Apu {
  return new Apu(ctx.vars, {
    master: `${V.apuMaster} == 1 && elec.apu_ecu_powered`,
    start: V.apuStartCmd, // START latched until the inlet door is open (logic.ts)
    starterVolts: 'elec.l_ess_dc_v',
    starterNominalV: 24,
    starterPeakA: 600, // EST: RE220 DC starter inrush on a 53 Ah NiCd
    fuelAvailable: 'fuel.apu_on',
    fire: `fire.apu_warn || ${V.fireApuDisch} == 1 || ${V.fireHandleApu} == 1`,
    bleedLoad: 'clamp01(pneu.apu_bleed_flow_kgs / 0.8)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: 48,
    bleedCeilingFt: G800_LIMITS.apuStarterAssistMaxFt, // SCQ: APU air for starter assist at and below 35,000 ft
    doorTimeS: 10,
    startTimeS: 40, // EST
    availDelayS: 2,
    cooldownS: 60,
    egtStartPeakC: 820, // EST: well below the 1,050 degC start limit (GVI)
    egtIdleC: 430, // EST
    egtBleedC: 180,
    egtGenC: 60,
    egtLimitC: G800_LIMITS.apuEgtStartC, // GVI: 1,050 degC
    altitudeFt: 'fdm.press_alt_ft',
  });
}

export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  // code450 fire protection: "Rotating the fire handle outboard to the DISCH 1 position" fires the RIGHT bottle; "the fire
  // handle may be rotated to the inboard DISCH 2 position" for the LEFT bottle. Outboard is LEFT (-1) for the L handle
  // and RIGHT (+1) for the R handle (function fix round 1: both handles used to discharge DISCH 1 when rotated left).
  const disch1 = (rot: string, side: 1 | 2) => (side === 1 ? `${rot} < -0.5` : `${rot} > 0.5`);
  const disch2 = (rot: string, side: 1 | 2) => (side === 1 ? `${rot} > 0.5` : `${rot} < -0.5`);
  const shot2 = (rot: string) => `${rot} > 0.5`; // legacy APU handle var: +1 = left bottle
  const engDisch = (rot: string, side: 1 | 2) => [
    { bottle: 'bottle_r', command: disch1(rot, side) },
    { bottle: 'bottle_l', command: disch2(rot, side) },
  ];
  return new FireProtection(ctx.vars, {
    zones: [
      { id: 'eng1', loops: 2, handle: V.fireHandleL, discharge: engDisch(V.fireRotL, 1), power: 'elec.fire_det_powered' },
      { id: 'eng2', loops: 2, handle: V.fireHandleR, discharge: engDisch(V.fireRotR, 2), power: 'elec.fire_det_powered' },
      // Engine core compartment detection (GVII family: separate Engine Core Fire procedure, code450 fire p4 / p11 per
      // the function audit; EST: single loop, extinguished through the same handle and bottles as the nacelle).
      { id: 'core1', loops: 1, handle: V.fireHandleL, discharge: engDisch(V.fireRotL, 1), power: 'elec.fire_det_powered' },
      { id: 'core2', loops: 1, handle: V.fireHandleR, discharge: engDisch(V.fireRotR, 2), power: 'elec.fire_det_powered' },
      // G700/G800 (code450 fire protection study sheets): no APU fire handle; the guarded APU FIRE EXT switchlight on the
      // forward overhead strip fires the LEFT bottle ("Disch 2") into the APU. APU Fire: "APU MASTER ... OFF; APU FIRE EXT ...
      // PRESS". Squibs armed with the APU MASTER off or the button pushed (EST); the ECU shuts the APU down on a fire (SCQ).
      // The legacy handle vars (fire_apu_handle / fire_apu_rot) are still honoured (no hardware writes them).
      {
        id: 'apu',
        loops: 1,
        handle: `${V.fireApuDisch} || ${V.apuMaster} == 0 || ${V.fireHandleApu}`,
        discharge: [
          { bottle: 'bottle_l', command: `${V.fireApuDisch} > 0.5` },
          { bottle: 'bottle_l', command: shot2(V.fireRotApu) },
        ],
        power: 'elec.fire_det_powered',
      },
      // Aft baggage smoke detector (C450 "Aft Baggage Smoke" red): detection only, no bottle.
      { id: 'baggage', loops: 1, handle: 0, power: 'elec.fire_det_powered' },
    ],
    bottles: [
      { id: 'bottle_l', chargePsi: 600, tempC: 'fdm.sat_c' }, // EST Halon 1301 charge
      { id: 'bottle_r', chargePsi: 600, tempC: 'fdm.sat_c' },
    ],
    test: { fire: V.fireTest },
  });
}

export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  return new OxygenSystem(ctx.vars, {
    bottles: [
      // EST: 115 ft^3 (3,256 L NTPD) crew bottle at 1,850 psi, CREW O2 supply valve on the overhead.
      { id: 'crew', capacityL: 3256, fullPsi: 1850, lowPsi: 400, valve: `${V.oxyCrew} == 1` },
      // EST: passenger gaseous system, 2 x 115 ft^3.
      { id: 'pax', capacityL: 6512, fullPsi: 1850, lowPsi: 400 },
    ],
    crew: [
      { id: 'pilot', bottle: 'crew', inUse: V.oxyMask(1), mode: V.oxyMode(1) },
      { id: 'copilot', bottle: 'crew', inUse: V.oxyMask(2), mode: V.oxyMode(2) },
      // Observer (jump seat) mask on the right aft bulkhead (G500 BL7C0670 photograph).
      { id: 'observer', bottle: 'crew', inUse: V.obsMask, mode: V.obsMaskMode },
    ],
    pax: { kind: 'gaseous', deploy: `press.pax_masks && ${V.oxyPax} != 0`, bottle: 'pax', flowLpm: 60 },
  });
}
