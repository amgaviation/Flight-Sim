/**
 * Citation M2 airframe services: hydraulics, bleed air / environmental,
 * pressurization, ice protection, fire protection, oxygen and lighting.
 * Sources per block below (abbreviations in ../data.ts).
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG, ICE } from '../../../core/vars';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization, PRESS_M2 } from '../../../systems/pressurization';
import { IceProtection } from '../../../systems/ice';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { M2, TEST_SEL } from '../vars';

// ------------------------------------------------------------------ hydraulics

/**
 * S&D15 §9.3 / S&D21 §9.8: open-center main system, "1,500 psi on demand" for
 * the landing gear, speed brakes and flaps from two engine-driven pumps
 * ("either pump can supply enough pressure and flow"); an independent
 * electrically driven system powers the wheel brakes and anti-skid and charges
 * the emergency accumulator. Open center is modelled by running the EDPs'
 * pressure compensation only while a selector valve calls for pressure
 * (`ac.m2.hyd_demand`, written by M2Logic); otherwise the system is unloaded.
 */
export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'main', nominalPsi: 1500, reservoirL: 2.5, lowPressPsi: 1000, internalLeakLpm: 1.5 }, // reservoir EST (TCDS: 16.78 lb fluid total)
      { id: 'brk', nominalPsi: 1500, reservoirL: 1.0, accumulator: { prechargePsi: 650, volumeL: 0.5 }, lowPressPsi: 900, internalLeakLpm: 0.05 }, // EST
    ],
    pumps: [
      { id: 'edp1', system: 'main', kind: 'edp', maxFlowLpm: 7, drive: `clamp(${ENG.n2(1)} / 100, 0, 1.2)`, on: `${M2.hydDemand} && !${M2.engFireBtn(1)}` }, // EST ~1.8 gpm
      { id: 'edp2', system: 'main', kind: 'edp', maxFlowLpm: 7, drive: `clamp(${ENG.n2(2)} / 100, 0, 1.2)`, on: `${M2.hydDemand} && !${M2.engFireBtn(2)}` },
      { id: 'brk_pump', system: 'brk', kind: 'electric', maxFlowLpm: 1.2, drive: 'elec.hyd_brake_pump_powered', electric: { supply: 'dc', nominalV: 28, noLoadW: 60 } },
    ],
    consumers: [
      { id: 'gear', system: 'main', demandLpm: 'gear.moving * 8' },
      { id: 'flaps', system: 'main', demandLpm: 'flaps.moving * 3' },
      { id: 'sb', system: 'main', demandLpm: 'spoilers.moving * 3' },
      { id: 'brakes', system: 'brk', demandLpm: '(brakes.psi_left + brakes.psi_right) / 3000 * 0.05' },
    ],
  });
}

// ------------------------------------------------------------------ bleed air / environmental

/**
 * S&D15 §9.5 / §9.7: engine bleed air pressurizes and heats the cabin, defogs
 * the windows and anti-ices the engine inlets, pylon inlet ducts, wings and
 * windshields; the horizontal stabilizer boots use regulated 23 psi service
 * air. The vapor-cycle A/C (electric) cools. PRESS SOURCE selects which
 * engine(s) supply the cabin; EMER brings unconditioned bleed air directly
 * into the cabin (CJ family, EST).
 * Flows EST: M2 cabin ~ 7.5 m^3, total conditioned air 0.14 kg/s (18 lb/min).
 */
export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const sel = M2.pressSource;
  return new PneumaticSystem(ctx.vars, {
    ducts: ['bleed'],
    sources: [
      { id: 'b1', duct: 'bleed', pressure: 'eng1.bleed_press_psi', valve: `!${M2.engFireBtn(1)} && elec.bleed_ctl_l_powered`, regulatedPsi: 40, maxFlowKgs: 0.3, engine: 1 },
      { id: 'b2', duct: 'bleed', pressure: 'eng2.bleed_press_psi', valve: `!${M2.engFireBtn(2)} && elec.bleed_ctl_r_powered`, regulatedPsi: 40, maxFlowKgs: 0.3, engine: 2 },
    ],
    consumers: [
      // Nacelle / pylon inlet anti-ice from each engine's own port.
      { id: 'eai1', engine: 1, demandKgs: `${M2.engAiSw(1)} * 0.03`, minPsi: 15 },
      { id: 'eai2', engine: 2, demandKgs: `${M2.engAiSw(2)} * 0.03`, minPsi: 15 },
      { id: 'wai', duct: 'bleed', demandKgs: `${M2.wingAiSw} * 0.08`, minPsi: 18 },
      { id: 'ws_l', duct: 'bleed', demandKgs: `${M2.wsBleedSw(1)} * 0.012`, minPsi: 12 },
      { id: 'ws_r', duct: 'bleed', demandKgs: `${M2.wsBleedSw(2)} * 0.012`, minPsi: 12 },
      { id: 'boots', duct: 'bleed', demandKgs: 'ice.tail_boots * 0.01', minPsi: 23 }, // 23 psi service air (S&D15 §9.7)
    ],
    packs: [
      {
        id: 'acm',
        duct: 'bleed',
        on: `${sel} == 3 || (${sel} == 1 && pneu.b1_valve_open) || (${sel} == 2 && pneu.b2_valve_open)`,
        flowKgs: `${sel} == 3 ? 0.14 : 0.1`,
        minPsi: 15,
      },
      { id: 'emer', duct: 'bleed', on: `${sel} == 4`, flowKgs: 0.1, minPsi: 10, minOutletC: 40, maxOutletC: 90 },
    ],
    zones: [
      {
        id: 'cabin',
        packs: ['acm', 'emer'],
        // AUTO needs the temperature controller (TEMP CONT breaker, L XFEED); unpowered, the mixing valve holds (manual target).
        target: `${M2.tempMode} == 0 && elec.temp_ctl_powered ? 16 + 12 * ${M2.tempSel} : ac.m2.temp_man_target`,
        volumeM3: 7.5,
        // People + avionics minus the vapor-cycle A/C (~3.5 kW cooling, EST). The evaporator air is moved by
        // the CABIN FAN blower (OFF / LOW / HIGH, R XFEED `cb.cabin_fan`); EST: with the blower off only the
        // cockpit evaporator's own flow remains (40 %), LOW 70 %, HIGH 100 % of the cooling.
        heatLoadW: `900 - elec.air_cond_powered * elec.air_cond_amps / 75 * 3500 * (0.4 + elec.cabin_fan_powered * min(${M2.cabinFan}, 2) * 0.3)`,
      },
    ],
  });
}

export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  return new Pressurization(ctx.vars, {
    ...PRESS_M2,
    // S&D15 §9.5: 8.5 psid nominal; sea-level cabin to 22,027 ft; 8,000 ft cabin at FL410.
    schedule: { x: [0, 41000], y: [0, 8000] },
    cabinVolumeM3: 7.5, // FPG: passenger cabin 198 ft^3 (5.6 m^3) + cockpit (EST)
    inflowKgs: 'pneu.pack_flow_kgs',
    // GTC entry; cleared (< -1000) -> FMS destination elevation, or with no destination the takeoff field (EST, CJ family).
    landingElevation: `${M2.landingElevFt} < -1000 ? ${M2.takeoffFieldElevFt} : ${M2.landingElevFt}`,
    landingElevationAuto: `${M2.landingElevFt} < -1000`,
    destinationElevation: (id) => ctx.nav?.airport?.(id)?.elevationFt,
    mode: `${M2.pressMode} == 2 ? 2 : 0`,
    manualCommand: M2.pressManual,
    dump: M2.cabinDump,
    masksDeployFt: 13500, // EST: CJ-family passenger mask auto deployment
    masksManual: `${M2.paxOxy} == 2`,
    onGround: 'gear.air_ground',
    // EST (CJ family): the ground solenoid opens the safety valve through the squat switch, so the cabin stays
    // unpressurised on the ground (the outflow valve alone left ~0.16 psi with both packs flowing at idle).
    safetyValveOpen: 'gear.air_ground',
    cabinTempC: 'pneu.cabin_temp_c',
  });
}

// ------------------------------------------------------------------ ice protection

/** S&D15 §9.7 / S&D21 §9.7. Accretion rates EST (systems-power guidance). */
export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  return new IceProtection(ctx.vars, {
    surfaces: [
      { id: 'wing', output: M2.iceWing, ratePerMin: 0.1, protection: { kind: 'thermal', active: `${M2.wingAiSw} * pneu.wai_ok` } },
      { id: 'tail', output: M2.iceTail, ratePerMin: 0.12, protection: { kind: 'boots', active: `(${M2.tailDeiceSw} != 0) * (pneu.bleed_psi > 20) * elec.tail_deice_powered`, bootCycleS: 60 } },
      { id: 'inlet1', output: ICE.inlet(1), engine: 1, ratePerMin: 0.15, protection: { kind: 'thermal', active: `${M2.engAiSw(1)} * pneu.eai1_ok` } },
      { id: 'inlet2', output: ICE.inlet(2), engine: 2, ratePerMin: 0.15, protection: { kind: 'thermal', active: `${M2.engAiSw(2)} * pneu.eai2_ok` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.pitot_l_powered' } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.pitot_r_powered' } },
      { id: 'static1', output: ICE.static(1), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.pitot_l_powered' } },
      { id: 'static2', output: ICE.static(2), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: 'elec.pitot_r_powered' } },
      { id: 'ws1', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'thermal', active: `max(clamp01(${M2.wsBleedSw(1)}) * pneu.ws_l_ok, ${M2.wsAlcoholSw} * elec.ws_alcohol_powered * 0.6, ${M2.airDistrib} * 0.2 * (pneu.pack_flow_kgs > 0.05))` } },
      { id: 'ws2', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'thermal', active: `max(clamp01(${M2.wsBleedSw(2)}) * pneu.ws_r_ok, ${M2.airDistrib} * 0.2 * (pneu.pack_flow_kgs > 0.05))` } },
    ],
  });
}

// ------------------------------------------------------------------ fire

/**
 * S&D15 §8: "A continuous loop fire detection system monitors the nacelle
 * area"; extinguishing system supplied (Halon 1301 per the S&D warning). ENG
 * FIRE lighted switches on the glareshield (S&D15 §10.2.A). CJ family: two
 * bottles, either discharges into the engine whose ENG FIRE switch is pushed
 * (BOTTLE ARMED lights) — EST for the M2. Bottle charge 600 psi EST.
 */
export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  const zone = (i: 1 | 2) => ({
    id: `eng${i}`,
    loops: 1 as const,
    handle: M2.engFireBtn(i),
    discharge: [
      { bottle: 'b1', command: M2.bottleBtn(1) },
      { bottle: 'b2', command: M2.bottleBtn(2) },
    ],
    power: 'elec.fire_det_powered',
  });
  return new FireProtection(ctx.vars, {
    zones: [zone(1), zone(2)],
    bottles: [
      { id: 'b1', chargePsi: 600 },
      { id: 'b2', chargePsi: 600 },
    ],
    test: { fire: `${M2.testSel} == ${TEST_SEL.fire}` },
  });
}

// ------------------------------------------------------------------ oxygen

/**
 * S&D15 §9.6: 50 ft^3 (1.42 m^3 = 1,416 L) bottle in the nose with a
 * high-pressure gauge and regulator; quick-donning pressure-demand crew masks;
 * automatic drop-out constant-flow passenger masks (gaseous) through a
 * sequencing regulator. Full pressure 1,850 psi EST (standard DOT 3AA).
 */
export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  return new OxygenSystem(ctx.vars, {
    bottles: [{ id: 'main', capacityL: 1416, fullPsi: 1850, lowPsi: 400 }],
    crew: [
      { id: 'crew1', bottle: 'main', inUse: M2.maskOn(1), mode: M2.maskMode(1), test: 'ac.m2.mask1_test' }, // PRESS TO TEST on the mask stowage
      { id: 'crew2', bottle: 'main', inUse: M2.maskOn(2), mode: M2.maskMode(2), test: 'ac.m2.mask2_test' }, // PRESS TO TEST on the mask stowage
    ],
    pax: { kind: 'gaseous', bottle: 'main', flowLpm: 25, deploy: `${M2.paxOxy} >= 1 && press.pax_masks` },
  });
}

// ------------------------------------------------------------------ lighting

/**
 * S&D21 §9.4: flashing red beacon, anti-collision (wingtip LED strobes),
 * position lights, landing/recognition lights with the Pulse Light system, taxi
 * lights, tail logo lights, wing inspection and ice detection lights. LED
 * lighting (S&D15 §5). Cockpit: LED panels, floodlights, overhead map lights.
 */
export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const pulse = { kind: 'flash' as const, periodS: 1.0, windows: [0, 0.5] }; // EST Pulselite ~1 Hz alternating
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: M2.navLt, power: 'elec.nav_lts_powered', tech: 'led' },
      { name: 'beacon', on: `${M2.antiColl} >= 1`, power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'strobe', on: `${M2.antiColl} >= 2`, power: 'elec.strobes_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'led' },
      { name: 'landing_l', on: `${M2.landingLt} >= 1`, power: 'elec.landing_l_powered', tech: 'led' },
      { name: 'landing_r', on: `${M2.landingLt} >= 1`, power: 'elec.landing_r_powered', tech: 'led' },
      { name: 'recognition', on: `${M2.landingLt} == 1`, power: 'elec.landing_l_powered', pattern: pulse, tech: 'led' },
      { name: 'taxi', on: M2.taxiLt, power: 'elec.taxi_lts_powered', tech: 'led' },
      { name: 'logo', on: M2.logoLt, power: 'elec.logo_lts_powered', tech: 'led' },
      { name: 'wing', on: M2.wingInspLt, power: 'elec.wing_insp_powered', tech: 'led' },
    ],
    dimmers: [
      { id: 'panel', knob: M2.panelLt, power: 'elec.panel_lts_powered || elec.stby_lts_powered', test: `${M2.testSel} == ${TEST_SEL.annu}`, min: 0.05 },
      { id: 'pedestal', knob: M2.pedestalLt, power: 'elec.panel_lts_powered', min: 0.05 },
      { id: 'flood', knob: M2.floodLt, power: 'elec.flood_lts_powered' },
      { id: 'map_l', knob: M2.mapLt(1), power: 'elec.flood_lts_powered' },
      { id: 'map_r', knob: M2.mapLt(2), power: 'elec.flood_lts_powered' },
      { id: 'cabin', knob: M2.cabinLt, power: 'elec.cabin_lts_powered' },
      // Annunciators (master caution/warning, korry lights) full bright by day, dimmed with the panel lights on (EST).
      { id: 'annun', knob: `${M2.panelLt} > 0.02 ? 0.45 : 1`, power: 'elec.emer_powered', test: `${M2.testSel} == ${TEST_SEL.annu}` },
    ],
  });
}
