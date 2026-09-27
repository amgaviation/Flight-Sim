/**
 * Boeing 737-800 airframe services: pneumatics / air conditioning, cabin
 * pressurization, APU, ice & rain protection, fire protection, oxygen and
 * lighting. Each factory composes one systems-library block with the 737
 * numbers (cited inline; FCOM chapter numbers refer to the 737NG FCOM
 * volume 2 system descriptions).
 */
import type { SimContext } from '../../../core/SimContext';
import { ICE } from '../../../core/vars';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization, PRESS_737NG } from '../../../systems/pressurization';
import { Apu } from '../../../systems/apu';
import { IceProtection } from '../../../systems/ice';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { APU_LIMITS, B738_DIM, CFM56_7B26 } from '../data';
import { B738 } from '../vars';

// ------------------------------------------------------------------------------------ pneumatics

/**
 * FCOM 2.10 / 2.20 "Air systems": two engine bleed systems (5th / 9th stage,
 * PRSOV regulated ~42 psi, EST) and the APU load compressor feed the left and
 * right bleed ducts, joined by the ISOLATION VALVE (AUTO: closed when both
 * engine BLEED switches are ON and both PACKs are AUTO/HIGH, open otherwise).
 * Packs: L from the left duct, R from the right; AUTO = normal flow, HIGH =
 * high flow; in flight a single operating pack in AUTO goes to high flow.
 * Air turbine starters on both ducts (LIM: 30 psi minimum start pressure at
 * sea level). Wing anti-ice from each side duct, cowl anti-ice direct from
 * each engine.
 */
export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const packOn = (i: 1 | 2) => `${B738.pack(i)} >= 1 && elec.pack_ctl_${i === 1 ? 'l' : 'r'}_powered`;
  const packFlow = (i: 1 | 2) => {
    const o = (3 - i) as 1 | 2;
    // EST: 0.58 kg/s normal, 0.8 kg/s high flow per pack (737-800 two packs ~ 2 x 70 ppm class).
    return `(${B738.pack(i)} == 2 || (${B738.pack(i)} == 1 && ${B738.pack(o)} == 0 && gear.air_ground == 0)) ? 0.8 : 0.58`;
  };
  // ISOLATION VALVE AUTO logic (FCOM 2.20).
  const isoOpen =
    `${B738.isoValve} == 2 || (${B738.isoValve} == 1 && ` +
    `(${B738.bleed(1)} == 0 || ${B738.bleed(2)} == 0 || ${B738.pack(1)} == 0 || ${B738.pack(2)} == 0))`;
  const cabinTarget = (zone: 'cont' | 'fwd' | 'aft') => `${B738.tempSel(zone)} < 0.03 ? 22 : 18 + 12 * ${B738.tempSel(zone)}`; // AUTO C..W 18-30 degC (EST)
  return new PneumaticSystem(ctx.vars, {
    ducts: ['l_duct', 'r_duct'],
    sources: [
      {
        id: 'bleed1',
        duct: 'l_duct',
        pressure: 'eng1.bleed_press_psi',
        // Bleed air valve: BLEED ON, DC power, fire handle in (FCOM 8.20: pulling the handle closes the bleed valve).
        valve: `${B738.bleed(1)} != 0 && elec.bleed_ctl_l_powered && !${B738.fireHandle(1)}`,
        regulatedPsi: 42,
        maxFlowKgs: 1.6,
        engine: 1,
        reset: B738.tripReset,
        hp: { belowPsi: 30, ratio: 1.5 },
      },
      {
        id: 'bleed2',
        duct: 'r_duct',
        pressure: 'eng2.bleed_press_psi',
        valve: `${B738.bleed(2)} != 0 && elec.bleed_ctl_r_powered && !${B738.fireHandle(2)}`,
        regulatedPsi: 42,
        maxFlowKgs: 1.6,
        engine: 2,
        reset: B738.tripReset,
        hp: { belowPsi: 30, ratio: 1.5 },
      },
      // APU bleed into the left duct (LIM: APU bleed to 17,000 ft; the Apu block removes bleed above that).
      { id: 'apu', duct: 'l_duct', pressure: 'apu.bleed_psi', valve: `${B738.apuBleed} != 0 && apu.avail`, regulatedPsi: 45, maxFlowKgs: 1.2 },
    ],
    valves: [{ id: 'iso', a: 'l_duct', b: 'r_duct', open: isoOpen, travelS: 3, power: 'elec.xfr1_powered || elec.dc1_powered' }],
    consumers: [
      { id: 'wai_l', duct: 'l_duct', demandKgs: `${B738.wingAiValveCmd} * 0.22`, minPsi: 18 },
      { id: 'wai_r', duct: 'r_duct', demandKgs: `${B738.wingAiValveCmd} * 0.22`, minPsi: 18 },
      { id: 'eai1', engine: 1, demandKgs: `${B738.engAi(1)} * elec.eng_ai1_powered * 0.08`, minPsi: 15 },
      { id: 'eai2', engine: 2, demandKgs: `${B738.engAi(2)} * elec.eng_ai2_powered * 0.08`, minPsi: 15 },
    ],
    packs: [
      { id: 'pack1', duct: 'l_duct', on: packOn(1), flowKgs: packFlow(1), reset: B738.tripReset },
      { id: 'pack2', duct: 'r_duct', on: packOn(2), flowKgs: packFlow(2), reset: B738.tripReset },
    ],
    zones: [
      { id: 'flt_deck', packs: ['pack1'], target: cabinTarget('cont'), volumeM3: 12, heatLoadW: 2500 },
      { id: 'fwd_cab', packs: ['pack1', 'pack2'], target: cabinTarget('fwd'), volumeM3: 60, heatLoadW: 6000 },
      { id: 'aft_cab', packs: ['pack1', 'pack2'], target: cabinTarget('aft'), volumeM3: 60, heatLoadW: 7000 },
    ],
    starters: [
      { id: 'st1', engine: 1, duct: 'l_duct', command: 'fadec.eng1.starter_cmd', valvePower: 'elec.eng1_start_powered', nominalPsi: CFM56_7B26.minStartDuctPsi, demandKgs: 0.9 },
      { id: 'st2', engine: 2, duct: 'r_duct', command: 'fadec.eng2.starter_cmd', valvePower: 'elec.eng2_start_powered', nominalPsi: CFM56_7B26.minStartDuctPsi, demandKgs: 0.9 },
    ],
  });
}

// ------------------------------------------------------------------------------------ pressurization

/**
 * FCOM 2.40 "Pressurization": digital AUTO and ALTN controllers scheduled
 * from the FLT ALT (cruise) and LAND ALT selectors; MAN drives the outflow
 * valve with the spring-loaded OPEN/CLOSE switch. Max differential 8.35 psi
 * at FL370+ (8,000 ft cabin at FL410; PRESS_737NG), relief 8.95 psi (safety
 * valves 9.1 psi, LIM). Ground pre-pressurization ~0.1 psi with take-off
 * thrust in AUTO; cabin altitude warning horn at 10,000 ft; masks deploy at
 * 14,000 ft cabin (FCOM 1.20).
 */
export function createPressurization(ctx: Pick<SimContext, 'vars'>): Pressurization {
  return new Pressurization(ctx.vars, {
    ...PRESS_737NG,
    cabinVolumeM3: B738_DIM.cabinVolumeM3,
    flightAltitude: B738.fltAltFt,
    landingElevation: B738.landAltFt,
    landingElevationAuto: false,
    inflowKgs: 'pneu.pack_flow_kgs',
    // AUTO controller on DC bus 1; an unpowered AUTO controller behaves as failed -> ALTN (EST wiring).
    mode: `${B738.pressMode} == 0 && !elec.press_auto_powered ? 1 : ${B738.pressMode}`,
    manualCommand: 'ac.b738.outflow_cmd',
    groundPrepress: { active: `gear.air_ground && ${B738.pressMode} == 0 && (${B738.tla(1)} > 0.6 || ${B738.tla(2)} > 0.6)`, psi: 0.1 },
    masksManual: `${B738.passOxy} != 0`,
    onGround: 'gear.air_ground',
    cabinTempC: 'pneu.fwd_cab_temp_c',
  });
}

// ------------------------------------------------------------------------------------ APU

/**
 * Honeywell 131-9B APU (FCOM 7.10 "APU"; LIM): START from the battery or,
 * with AC available, through the start converter unit (starter-generator motoring), up to 120 s start cycle, AVAIL (95 %) with a
 * 90 kVA generator (to 41,000 ft) and bleed (to 17,000 ft); after APU BLEED
 * use a 60 s cooldown precedes shutdown. EGT values EST.
 */
export function createApu(ctx: Pick<SimContext, 'vars'>): Apu {
  return new Apu(ctx.vars, {
    master: `${B738.apuSw} >= 1 && elec.apu_ecu_powered`,
    // START is latched by the APU ECU and the start begins once the inlet door is fully open (FCOM 7.10).
    start: `ac.b738.apu_start_req && apu.door_open`,
    // Start converter unit on AC XFR 1 (full-strength start) or the battery bus.
    starterVolts: 'elec.xfr1_powered ? 27 : elec.batt_bus_v',
    starterNominalV: 24,
    starterPeakA: 350, // EST starter-generator inrush on the battery bus
    fuelAvailable: 'fuel.apu_on',
    fire: 'fire.apu_warn',
    bleedLoad: 'clamp01(pneu.apu_flow_kgs / 1.2)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: 48,
    bleedCeilingFt: APU_LIMITS.bleedMaxFt,
    doorTimeS: 15, // EST inlet door
    startTimeS: 55, // EST: typical start ~60 s from START (LIM: up to 120 s)
    egtStartPeakC: 720, // EST
    egtIdleC: 360, // EST
    egtBleedC: 250,
    egtGenC: 60,
    egtLimitC: 1038, // EST: 131-9B start EGT limit class
    ffIdlePph: 200, // EST 131-9B unloaded
    ffFullPph: 290, // EST bleed + generator
  });
}

// ------------------------------------------------------------------------------------ ice & rain

/**
 * FCOM 3.10 / 3.20: thermal wing anti-ice (leading-edge slats, bleed air from
 * each side duct), cowl anti-ice (engine bleed), electrically heated pitot
 * probes / AOA vanes / TAT probe (PROBE HEAT A = Capt pitot, L elevator pitot,
 * L AOA, TAT; B = F/O pitot, R elevator pitot, R AOA, aux pitot) and window
 * heat (L/R forward windows anti-ice + anti-fog, side windows anti-fog).
 * Accretion rates are EST (systems-power §8 typical values).
 */
export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  return new IceProtection(ctx.vars, {
    surfaces: [
      { id: 'wing', output: ICE.airframe, ratePerMin: 0.1, protection: { kind: 'thermal', active: `(pneu.wai_l_ok + pneu.wai_r_ok) / 2 * ${B738.wingAiValveCmd}` } },
      { id: 'inlet1', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: `pneu.eai1_ok * ${B738.engAi(1)}` } },
      { id: 'inlet2', output: ICE.inlet(2), ratePerMin: 0.15, engine: 2, protection: { kind: 'thermal', active: `pneu.eai2_ok * ${B738.engAi(2)}` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.probe_heat_a_powered' } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.probe_heat_b_powered' } },
      // Auxiliary pitot (standby/ISFD air data) heated from PROBE HEAT B (FCOM 3.20).
      { id: 'pitot3', output: ICE.pitot(3), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.probe_heat_b_powered' } },
      { id: 'ws1', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: 'elec.win_heat_l_fwd_powered' } },
      { id: 'ws2', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'electric', active: 'elec.win_heat_r_fwd_powered' } },
    ],
  });
}

// ------------------------------------------------------------------------------------ fire

const loopSel = (sw: string): string => `${sw} <= -0.5 ? 1 : ${sw} >= 0.5 ? 2 : 0`;

/**
 * FCOM 8.10 / 8.20 "Fire protection": dual-loop overheat/fire detectors per
 * engine (OVHT DET A / NORMAL / B), single-loop APU detector, wheel-well
 * detector, dual-loop cargo smoke detectors; two engine extinguisher bottles
 * (L and R, each dischargeable into either engine by rotating the pulled
 * handle; 800 psi class), one APU bottle, one cargo bottle. Pulling an
 * engine fire handle closes the fuel, bleed, hydraulic EDP supply valves,
 * trips the GCB and disables the reverser (wired in the other systems).
 */
export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  const det = 'elec.fire_det_powered';
  return new FireProtection(ctx.vars, {
    zones: [
      {
        id: 'eng1',
        loops: 2,
        loopSelect: loopSel(B738.ovhtDet(1)),
        handle: B738.fireHandle(1),
        discharge: [
          { bottle: 'l_btl', command: `${B738.fireRot(1)} <= -0.5` },
          { bottle: 'r_btl', command: `${B738.fireRot(1)} >= 0.5` },
        ],
        fuelCut: `${B738.fireHandle(1)} || ${B738.startLever(1)} < 0.5`,
        power: det,
      },
      {
        id: 'eng2',
        loops: 2,
        loopSelect: loopSel(B738.ovhtDet(2)),
        handle: B738.fireHandle(2),
        discharge: [
          { bottle: 'l_btl', command: `${B738.fireRot(2)} <= -0.5` },
          { bottle: 'r_btl', command: `${B738.fireRot(2)} >= 0.5` },
        ],
        fuelCut: `${B738.fireHandle(2)} || ${B738.startLever(2)} < 0.5`,
        power: det,
      },
      { id: 'apu', loops: 1, handle: B738.fireHandleApu, discharge: [{ bottle: 'apu_btl', command: `abs(${B738.fireRotApu}) >= 0.5` }], fuelCut: `${B738.fireHandleApu} || apu.state == 0`, power: det },
      { id: 'wheel_well', loops: 1, handle: 0, power: det },
      { id: 'cargo_fwd', loops: 2, loopSelect: loopSel(B738.cargoDetSel('fwd')), handle: B738.cargoArm('fwd'), discharge: [{ bottle: 'cargo_btl', command: B738.cargoDisch }], power: 'elec.cargo_fire_powered' },
      { id: 'cargo_aft', loops: 2, loopSelect: loopSel(B738.cargoDetSel('aft')), handle: B738.cargoArm('aft'), discharge: [{ bottle: 'cargo_btl', command: B738.cargoDisch }], power: 'elec.cargo_fire_powered' },
    ],
    bottles: [
      { id: 'l_btl', chargePsi: 800 },
      { id: 'r_btl', chargePsi: 800 },
      { id: 'apu_btl', chargePsi: 600 }, // EST
      { id: 'cargo_btl', chargePsi: 600 }, // EST (LIM: cargo protection 195 min with the option)
    ],
    test: { fire: `${B738.fireTest} >= 0.5 && ${det}`, fault: `${B738.fireTest} <= -0.5 && ${det}` },
  });
}

// ------------------------------------------------------------------------------------ oxygen

/**
 * FCOM 1.20 "Oxygen": crew system from one high-pressure cylinder (114/115
 * cu ft class = ~3,250 l, 1,850 psi, EST) through quick-donning diluter
 * masks; passenger system chemical generators (12 min standard), deployed
 * automatically at 14,000 ft cabin or with the PASS OXYGEN switch ON.
 */
export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  return new OxygenSystem(ctx.vars, {
    bottles: [{ id: 'crew', capacityL: 3250, fullPsi: 1850, lowPsi: 400 }],
    // Masks: in use when pulled out of the stowage box (side consoles), or (SCOPE: the crew dons them) while the
    // cabin altitude warning is active. Regulator: 100% (stowed setting) / N (diluter) / EMERGENCY (positive pressure);
    // RESET/TEST gives the flow check (FCOM 1.20 "Flight crew oxygen masks").
    crew: ([1, 2] as const).map((s) => ({
      id: s === 1 ? 'capt' : 'fo',
      bottle: 'crew',
      inUse: `press.cabin_alt_warn || ${B738.oxyMask(s)}`,
      mode: `${B738.oxyEmer(s)} ? 2 : ${B738.oxyDiluter(s)} ? 0 : 1`,
      test: B738.oxyTest(s),
    })),
    pax: { kind: 'chemical', deploy: 'press.pax_masks', durationS: 720 },
  });
}

// ------------------------------------------------------------------------------------ lighting

/**
 * FCOM 1.40 "Lights": exterior lights on their switches and buses; panel,
 * flood and background dimmers for the cockpit lighting zones; the LIGHTS
 * switch TEST / BRT / DIM drives the annunciator brightness.
 */
export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const P = 'elec.';
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: `${B738.positionLt} != 0`, power: `${P}position_lts_powered`, tech: 'incandescent' },
      { name: 'strobe', on: `${B738.positionLt} == 1`, power: `${P}strobe_lts_powered`, pattern: FLASH_PATTERNS.doubleStrobe, tech: 'xenon' },
      { name: 'strobe_tail', on: `${B738.positionLt} == 1`, power: `${P}strobe_lts_powered`, pattern: FLASH_PATTERNS.singleStrobe, tech: 'xenon', phaseS: 0.35 },
      { name: 'beacon', on: B738.antiColl, power: `${P}anti_coll_powered`, pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'beacon_lower', on: B738.antiColl, power: `${P}anti_coll_powered`, pattern: FLASH_PATTERNS.beaconFlash, tech: 'led', phaseS: 0.5 },
      // Fixed inboard landing lights (wing root) and retractable outboard landing lights.
      { name: 'landing_l', on: B738.landingFixed(1), power: `${P}fixed_landing_powered`, tech: 'halogen' },
      { name: 'landing_r', on: B738.landingFixed(2), power: `${P}fixed_landing_powered`, tech: 'halogen' },
      { name: 'landing_retract_l', on: `${B738.landingRetract(1)} == 2`, power: `${P}landing_retract_powered`, tech: 'halogen', retract: { extend: `${B738.landingRetract(1)} >= 1`, travelS: 8 } },
      { name: 'landing_retract_r', on: `${B738.landingRetract(2)} == 2`, power: `${P}landing_retract_powered`, tech: 'halogen', retract: { extend: `${B738.landingRetract(2)} >= 1`, travelS: 8 } },
      { name: 'taxi', on: B738.taxiLt, power: `${P}taxi_lt_powered`, tech: 'halogen' },
      { name: 'turnoff_l', on: B738.turnoff(1), power: `${P}turnoff_lts_powered`, tech: 'halogen' },
      { name: 'turnoff_r', on: B738.turnoff(2), power: `${P}turnoff_lts_powered`, tech: 'halogen' },
      { name: 'logo', on: B738.logoLt, power: `${P}logo_lts_powered`, tech: 'incandescent' },
      { name: 'wing', on: B738.wingLt, power: `${P}wing_lts_powered`, tech: 'incandescent' },
      { name: 'wheel_well', on: B738.wheelWellLt, power: `${P}wheel_well_lts_powered`, tech: 'incandescent' },
    ],
    dimmers: [
      { id: 'panel_capt', knob: B738.panelLt(1), power: `${P}panel_lts_powered`, gamma: 1.5 },
      { id: 'panel_fo', knob: B738.panelLt(2), power: `${P}panel_lts_powered`, gamma: 1.5 },
      { id: 'panel_ovhd', knob: B738.ovhdPanelLt, power: `${P}panel_lts_powered`, gamma: 1.5 },
      { id: 'panel_pedestal', knob: B738.pedestalPanelLt, power: `${P}panel_lts_powered`, gamma: 1.5 },
      { id: 'background', knob: B738.backgroundLt, power: `${P}flood_lts_powered` },
      { id: 'flood_gs', knob: B738.glareshieldFlood, power: `${P}flood_lts_powered` },
      { id: 'flood_afds', knob: B738.afdsFlood, power: `${P}flood_lts_powered` },
      { id: 'flood_pedestal', knob: B738.pedestalFlood, power: `${P}flood_lts_powered` },
      { id: 'dome', knob: `${B738.domeLt} / 2`, power: `${P}dome_lt_powered` },
      { id: 'cb', knob: B738.cbPanelLt, power: `${P}panel_lts_powered` },
      { id: 'map_capt', knob: B738.mapLt(1), power: `${P}flood_lts_powered` },
      { id: 'map_fo', knob: B738.mapLt(2), power: `${P}flood_lts_powered` },
      // Annunciators: LIGHTS switch DIM (-1) = ~40 % (EST), TEST (1) = all lamps on.
      { id: 'annun', knob: `${B738.lightsTest} <= -0.5 ? 0.4 : 1`, power: `${P}annun_lts_powered`, test: `${B738.lightsTest} >= 0.5` },
    ],
  });
}
