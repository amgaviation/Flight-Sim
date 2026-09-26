/**
 * Citation Longitude bleed air, air conditioning, pressurization, ice
 * protection, APU, fire protection and oxygen.
 *
 * Bleed (OG Section 9): each engine has LP and HP ports with PRSOVs (HP
 * regulation 31.5 +/- 2.5 psig, 52 +/- 6 psig with wing anti-ice requested),
 * a bleed PRSOV that opens only above 12 psig, the APU shutoff/check valve on
 * the LEFT manifold, a bleed isolation valve between the manifold halves and
 * a wing-only crossflow valve. L/R PRESS SOURCE valves feed the ECS manifold.
 * Air turbine starters (OG 7-2) on each manifold; start needs >= 32 psi
 * (OG 1-3).
 *
 * ECS (OG Section 10, BCA): one Air Cycle Refrigeration Pack = heat exchangers
 * + one ACM; ECS knob NORM / ACM ONLY / HEAT EXCHG ONLY; FLOW NORM/HIGH (APU:
 * 60 % of max ACS capacity in NORM, 100 % in HIGH). Two zones (cabin, cockpit)
 * with GTC temperature targets; manual supply-temperature knobs.
 *
 * Pressurization (OG Section 11, FPG p.2, BCA): 9.66 psid nominal, SL cabin
 * to 26,816 ft, 5,950 ft cabin at FL450; takeoff pre-pressurisation to ~200 ft
 * below field; landing target 200 ft below landing elevation; manual mode
 * with the CABIN ALT switch; DUMP. Relief EST +0.3 psi (CABIN DELTA P warning
 * at 10.2 psid, OG CAS).
 *
 * Ice (OG Section 12): bleed-heated wing leading edges and engine inlets,
 * EMEDS electro-mechanical expulsion de-ice on the horizontal stabilizer,
 * automatic electric windshield heat (40-45 degC), automatic pitot/static
 * heat (NORM: takeoff roll and in flight; ON: continuous), two ice detectors.
 *
 * APU (OG Section 8, BCA): Honeywell 36-150, knob OFF / ON / START, bleed
 * available 90 s after the start (OG 8-2 note), 3-position knob, unattended
 * operation with automatic fire shutdown AND extinguishing (BCA).
 *
 * Fire (EST layout from the Citation family: ENG FIRE switchlights on the
 * glareshield arm two engine bottles that can be discharged into either
 * engine; the APU has its own automatic bottle, BCA): dual-loop engine
 * detectors, single-loop APU detector.
 *
 * Oxygen (EST capacities, see docs): crew quick-donning masks from one
 * gaseous bottle; passenger masks auto-deploy at 14,000 ft cabin (EST, typical
 * Part 25 bizjet setting) from the same bottle.
 */
import type { SimContext } from '../../../core/SimContext';
import { ICE } from '../../../core/vars';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization } from '../../../systems/pressurization';
import { IceProtection } from '../../../systems/ice';
import { Apu } from '../../../systems/apu';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';

const starting = (i: number): string => `(fadec.eng${i}.starter_cmd != 0 || (fadec.eng${i}.start_state >= 1 && fadec.eng${i}.start_state <= 3))`;

export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const hp = { belowPsi: 31.5, ratio: 1.6 }; // OG 9-2: HP PRSOV opens when LP < 31.5 psig
  return new PneumaticSystem(ctx.vars, {
    ducts: ['l_man', 'r_man', 'ecs'],
    sources: [
      // Engine bleed PRSOVs (OG 9-2: open only above 12 psig). Regulated manifold EST 45 psig; flow EST 0.6 kg/s.
      { id: 'eng1', duct: 'l_man', pressure: 'eng1.bleed_press_psi', valve: `${V.bleedEngL} && !${V.fireEngL} && eng1.bleed_press_psi > 12`, regulatedPsi: 45, maxFlowKgs: 0.6, engine: 1, hp },
      { id: 'eng2', duct: 'r_man', pressure: 'eng2.bleed_press_psi', valve: `${V.bleedEngR} && !${V.fireEngR} && eng2.bleed_press_psi > 12`, regulatedPsi: 45, maxFlowKgs: 0.6, engine: 2, hp },
      // APU bleed into the LEFT manifold (OG 9-3), available 90 s after the start (OG 8-2).
      { id: 'apu', duct: 'l_man', pressure: 'apu.bleed_psi', valve: `${V.bleedApu} && ${V.apuBleedReady}`, regulatedPsi: 45, maxFlowKgs: 0.5 },
    ],
    valves: [
      { id: 'iso', a: 'l_man', b: 'r_man', open: V.isoOpen, travelS: 3, power: 'elec.emer_l_powered || elec.emer_r_powered' },
      // PRESS SOURCE valves; closed automatically during engine starts to give the ATS the flow (OG 7-5, 10-5).
      { id: 'press_l', a: 'l_man', b: 'ecs', open: `${V.pressSrcL} && !(${starting(1)} || ${starting(2)})`, travelS: 3 },
      { id: 'press_r', a: 'r_man', b: 'ecs', open: `${V.pressSrcR} && !(${starting(2)} || (${starting(1)} && !(eng2.running && ${V.apuBleedReady})))`, travelS: 3 },
    ],
    consumers: [
      // Wing anti-ice piccolo tubes (EST 0.12 kg/s per side); XFLOW wing valve lets one side feed both (logic.ts).
      { id: 'wai_l', duct: 'l_man', demandKgs: `${V.aiWing} * (0.12 + 0.12 * (${V.wingXflowOpen} && !eng2.running))`, minPsi: 30 },
      { id: 'wai_r', duct: 'r_man', demandKgs: `${V.aiWing} * (0.12 + 0.12 * (${V.wingXflowOpen} && !eng1.running))`, minPsi: 30 },
      // Nacelle anti-ice from the engine's own port (EST 0.05 kg/s).
      { id: 'eai_l', engine: 1, demandKgs: `${V.aiEngL} * 0.05`, minPsi: 15 },
      { id: 'eai_r', engine: 2, demandKgs: `${V.aiEngR} * 0.05`, minPsi: 15 },
    ],
    packs: [
      // Single ACRP. NORM flow EST 0.42 kg/s, HIGH 0.55 kg/s (~14 cabin air changes/h... BCA: full exchange every 2.5 min).
      { id: 'pack', duct: 'ecs', on: `elec.mission_l_powered || elec.mission_r_powered`, flowKgs: `${V.flow} ? 0.55 : 0.42`, minPsi: 18, minOutletC: 2, maxOutletC: 70 },
    ],
    zones: [
      { id: 'cabin', packs: ['pack'], target: `${V.cabinTempKnob} > 0.02 ? 5 + 25 * ${V.cabinTempKnob} : ${V.cabinSetC}`, volumeM3: 21.4, heatLoadW: 1500, initialC: 20 },
      { id: 'ckpt', packs: ['pack'], target: `${V.ckptTempKnob} > 0.02 ? 5 + 25 * ${V.ckptTempKnob} : ${V.ckptSetC}`, volumeM3: 5, heatLoadW: 900, initialC: 20 },
    ],
    starters: [
      { id: 'ats1', engine: 1, duct: 'l_man', command: 'fadec.eng1.starter_cmd', valvePower: 'elec.emer_l_powered', nominalPsi: 40, demandKgs: 0.45 },
      { id: 'ats2', engine: 2, duct: 'r_man', command: 'fadec.eng2.starter_cmd', valvePower: 'elec.emer_r_powered', nominalPsi: 40, demandKgs: 0.45 },
    ],
  });
}

/** Cabin schedule: sea-level cabin to 26,816 ft (FPG p.2), then limited by 9.66 psid (5,950 ft at FL450). */
export const LONGITUDE_CABIN_SCHEDULE = { x: [0, 26816, 45000, 51000], y: [0, 0, 5950, 7000] };

export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  return new Pressurization(ctx.vars, {
    cabinVolumeM3: 30, // EST: 755 ft^3 cabin (FPG) + cockpit + walk-in baggage (~1,050 ft^3)
    maxDiffPsi: LON_LIMITS.maxDiffPsi,
    reliefPsi: 9.95, // EST: below the 10.2 psid CABIN DELTA P warning
    schedule: LONGITUDE_CABIN_SCHEDULE,
    maxCabinClimbFpm: 600, // EST
    maxCabinDescentFpm: 400, // EST
    landingBiasFt: -200, // OG 11-2: 200 ft below the landing elevation
    // GTC Cabin Pressure page: Normal (FMS destination or manual landing elevation) / Altitude Select.
    // SCOPE: Altitude Select is modelled as a landing-elevation target 200 ft above the selected cabin altitude
    // (the controller then holds that cabin altitude in cruise/descent), not as a separate control law.
    landingElevation: `${V.pressSelMode} == 1 ? ${V.pressSelCabinFt} + 200 : ${V.pressLdgElevFt}`,
    landingElevationAuto: `${V.pressSelMode} == 0 && ${V.pressLdgElevFt} < -9000`,
    destinationElevation: (ident) => {
      try {
        return typeof ctx.nav?.airport === "function" ? ctx.nav.airport(ident)?.elevationFt : undefined;
      } catch {
        return undefined;
      }
    },
    groundPrepress: { active: `${V.toThrust} && gear.air_ground`, psi: 0.1 }, // OG 11-2: ~200 ft below field on the takeoff roll
    inflowKgs: 'pneu.pack_flow_kgs',
    mode: `${V.pressMode} == 1 ? 2 : 0`,
    manualCommand: V.cabinAltSw, // UP = cabin climbs (outflow opens)
    dump: V.pressDump,
    cabinAltWarnFt: LON_LIMITS.cabinAltWarnFt,
    masksDeployFt: 14000, // EST
    masksManual: `${V.oxyPax} == 1`,
    onGround: 'gear.air_ground',
    cabinTempC: 'pneu.cabin_temp_c',
  });
}

export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  return new IceProtection(ctx.vars, {
    surfaces: [
      { id: 'wing', output: ICE.airframe, ratePerMin: 0.1, protection: { kind: 'thermal', active: `${V.aiWing} * max(pneu.wai_l_ok, pneu.wai_r_ok)` } },
      // EMEDS (OG 12-2, BCA): electro-mechanical expulsion; modelled as de-ice boots cycling (EST 60 s cycle).
      { id: 'stab', output: 'ice.stab', ratePerMin: 0.1, protection: { kind: 'boots', active: `${V.aiStab} * elec.stab_emeds_powered`, bootCycleS: 60, bootRemoval: 0.9, bootMinIce: 0.03, bootInflateS: 1 } },
      { id: 'inlet1', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: `${V.aiEngL} * pneu.eai_l_ok` } },
      { id: 'inlet2', output: ICE.inlet(2), ratePerMin: 0.15, engine: 2, protection: { kind: 'thermal', active: `${V.aiEngR} * pneu.eai_r_ok` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: `${V.pitotHeatOn} * elec.pitot_l_powered` } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: `${V.pitotHeatOn} * elec.pitot_r_powered` } },
      { id: 'static1', output: ICE.static(1), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: `${V.pitotHeatOn} * elec.pitot_l_powered` } },
      { id: 'static2', output: ICE.static(2), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: `${V.pitotHeatOn} * elec.pitot_r_powered` } },
      { id: 'wshld1', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldHeatOn} * elec.wshld_l_powered` } },
      { id: 'wshld2', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldHeatOn} * elec.wshld_r_powered` } },
    ],
    detector: { power: 'elec.emer_l_powered || elec.emer_r_powered', threshold: 0.05, holdS: 60 },
  });
}

export function createApu(ctx: Pick<SimContext, 'vars'>): Apu {
  return new Apu(ctx.vars, {
    master: `${V.apuKnob} >= 1 && (elec.emer_l_powered || elec.emer_r_powered)`,
    start: `${V.apuKnob} == 2`,
    starterVolts: 'elec.emer_l_v',
    starterNominalV: 26,
    starterPeakA: 450, // EST: 36-150 starter-generator class inrush
    fuelAvailable: 'fuel.apu_on',
    fire: 'fire.apu_warn',
    bleedLoad: 'clamp01(pneu.apu_flow_kgs / 0.5)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: 48,
    bleedCeilingFt: 25000, // EST: bleed available at lower altitudes only (BCA: "on the ground and at lower altitudes")
    doorTimeS: 10,
    startTimeS: 35, // BCA: "the entire process takes less than a minute"
    availDelayS: 2,
    cooldownS: 60,
    egtLimitC: 1000, // EST
  });
}

export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  return new FireProtection(ctx.vars, {
    zones: [
      {
        id: 'eng1',
        loops: 2,
        handle: V.fireEngL,
        discharge: [{ bottle: 'bottle1', command: V.bottle1 }, { bottle: 'bottle2', command: V.bottle2 }],
        power: 'elec.fire_det_powered',
      },
      {
        id: 'eng2',
        loops: 2,
        handle: V.fireEngR,
        discharge: [{ bottle: 'bottle1', command: V.bottle1 }, { bottle: 'bottle2', command: V.bottle2 }],
        power: 'elec.fire_det_powered',
      },
      // APU: unattended operation; automatic shutdown and bottle discharge (BCA). Delay EST 5 s.
      { id: 'apu', loops: 1, handle: 'fire.apu_warn', autoDischarge: { bottle: 'apu_bottle', condition: 'fire.apu_warn', delayS: 5 }, power: 'elec.fire_det_powered' },
    ],
    bottles: [
      { id: 'bottle1', chargePsi: 600, tempC: 'fdm.sat_c' }, // EST Halon 1301 bottle charge
      { id: 'bottle2', chargePsi: 600, tempC: 'fdm.sat_c' },
      { id: 'apu_bottle', chargePsi: 600, tempC: 'fdm.sat_c' },
    ],
    test: { fire: V.fireTest },
  });
}

export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  return new OxygenSystem(ctx.vars, {
    // EST: 115 ft^3 (3,256 L NTPD) composite bottle at 1,850 psi (Citation family standard / optional 77 ft^3).
    bottles: [{ id: 'main', capacityL: 3256, fullPsi: 1850, lowPsi: 400 }],
    crew: [
      { id: 'pilot', bottle: 'main', inUse: V.oxyMaskL, mode: V.oxyMode },
      { id: 'copilot', bottle: 'main', inUse: V.oxyMaskR, mode: V.oxyMode },
    ],
    pax: { kind: 'gaseous', deploy: 'press.pax_masks', bottle: 'main', flowLpm: 30 },
  });
}
