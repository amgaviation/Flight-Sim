/**
 * Gulfstream G650 bleed air, air conditioning, pressurization, ice & rain,
 * APU, fire protection and oxygen.
 *
 * Bleed (LUC pneumatics): per engine a 5th-stage port and an 8th-stage HP
 * port (HPSOV), an electro-pneumatic PRSOV regulating up to 40 psi (needs ESS
 * DC + pressure, BAC L/R), a precooler; the APU load control valve into the
 * left duct; an ISOLATION valve (L ESS DC, fails frozen) opened by START /
 * CRANK MASTER, by APU bleed on the ground, or by the switch at OPEN.
 * Air turbine starters on each duct; start needs >= 40 psi (LUC).
 * ECS (LUC air conditioning): two packs (tail), three zones (cockpit = R ACC,
 * forward and aft cabin = L ACC), hot trim air per zone, RAM AIR (both packs
 * off). START/CRANK MASTER shuts the packs (R pack at once, L pack with an
 * engine start selected) (logic.ts).
 * Pressurization (LUC, LIM, GAC, AIN): 10.69 psi max differential, relief
 * 10.80 / 11.00 psi, negative relief -0.25 psi; 3,290 ft cabin at FL410 (AIN),
 * 4,850 ft at FL510 (GAC); pre-pressurisation 0.25 psi on the takeoff roll;
 * AUTO (FMS landing field elevation) / SEMI (crew landing elevation) / MANUAL
 * (MAN HOLD knob on the outflow valve); passenger masks at 14,750 ft (LUC).
 * Ice (LUC ice): bleed wing anti-ice (130 degF target) and cowl anti-ice (5th
 * stage), four rotary knobs L WING / L COWL / R COWL / R WING (OFF / AUTO /
 * ON; AUTO from two ice detectors, inhibited above 35,000 ft), four heated air
 * data probes (MFP, ANTI-ICE HTR switchlights), electrically heated
 * windshields (L/R), cabin windows and EVS window.
 * APU (LUC apu, LIM): Honeywell RE220, MASTER / START / STOP, READY 10-16 s
 * after MASTER, starter from the left main battery, generator on line at 99 %
 * + 2 s, bleed after 60 s, 264 lb/h, EGT start 1,050 / running 732 degC.
 * Fire (LUC fire, LIM): dual-loop engine detectors (FDCU L/R), fire handles
 * rotate outward = shot 1 (RIGHT bottle), inward = shot 2 (LEFT bottle), either
 * bottle to either engine; the APU uses the LEFT bottle (FIRE EXT button).
 * Oxygen (LUC oxygen): two 123.4 ft^3 bottles at 1,800 psi (crew / passenger
 * gauges), EROS quick-donning crew masks (N / 100 % / EMERGENCY), passenger
 * rotary OFF / AUTO / MAN with deployment at 14,750 ft cabin.
 */
import type { SimContext } from '../../../core/SimContext';
import { ICE } from '../../../core/vars';
import { PneumaticSystem } from '../../../systems/pneumatic';
import { Pressurization } from '../../../systems/pressurization';
import { IceProtection } from '../../../systems/ice';
import { Apu } from '../../../systems/apu';
import { FireProtection } from '../../../systems/fire';
import { OxygenSystem } from '../../../systems/oxygen';
import { G650_LIMITS } from '../data';
import { G650_VARS as V } from '../vars';

/** Zone target: AUTO = selected temperature; MAN = the knob commands the supply (EST mapping 16..30 -> -10..60 degC demand). */
function zoneTarget(z: 1 | 2 | 3): string {
  return `${V.zoneMan(z)} == 1 ? -10 + (${V.zoneTemp(z)} - 16) * 5 : ${V.zoneTemp(z)}`;
}

export function createPneumatics(ctx: Pick<SimContext, 'vars'>): PneumaticSystem {
  const hp = { belowPsi: 30, ratio: 1.6 }; // EST: 8th-stage HPSOV opens when the 5th stage falls below 30 psi (idle)
  return new PneumaticSystem(ctx.vars, {
    ducts: ['l_duct', 'r_duct'],
    sources: [
      // PRSOV regulates up to 40 psi (LUC); EST 0.9 kg/s capacity per engine.
      { id: 'bleed_l', duct: 'l_duct', pressure: 'eng1.bleed_press_psi', valve: `${V.bleedL} == 1 && !${V.fireHandleL} && elec.bac_l_powered`, regulatedPsi: 40, maxFlowKgs: 0.9, engine: 1, hp },
      { id: 'bleed_r', duct: 'r_duct', pressure: 'eng2.bleed_press_psi', valve: `${V.bleedR} == 1 && !${V.fireHandleR} && elec.bac_r_powered`, regulatedPsi: 40, maxFlowKgs: 0.9, engine: 2, hp },
      // APU load control valve into the left duct, bleed after 60 s (LUC apu); EST 0.7 kg/s.
      // LUC apu / dossier §4.6: the LCV supplies bleed on the ground only - APU bleed cannot pressurize in flight.
      { id: 'apu_bleed', duct: 'l_duct', pressure: 'apu.bleed_psi', valve: `${V.bleedApu} == 1 && ${V.apuBleedReady} && gear.air_ground`, regulatedPsi: 45, maxFlowKgs: 0.7 },
    ],
    valves: [{ id: 'iso', a: 'l_duct', b: 'r_duct', open: V.isoCmd, travelS: 3, power: 'elec.l_ess_dc_powered' }],
    consumers: [
      // Wing anti-ice piccolo tubes (EST 0.16 kg/s per side at the 130 degF target); cowl from the 5th stage.
      { id: 'wai_l', duct: 'l_duct', demandKgs: `0.16 * ${V.waiCmd('l')}`, minPsi: 25 },
      { id: 'wai_r', duct: 'r_duct', demandKgs: `0.16 * ${V.waiCmd('r')}`, minPsi: 25 },
      { id: 'cai_l', engine: 1, demandKgs: `0.06 * ${V.caiCmd('l')}`, minPsi: 10 },
      { id: 'cai_r', engine: 2, demandKgs: `0.06 * ${V.caiCmd('r')}`, minPsi: 10 },
    ],
    packs: [
      // EST 0.32 kg/s per pack (cabin air changed every ~2 min, LUC: 100 % fresh air every 2 min).
      { id: 'pack_l', duct: 'l_duct', on: V.packLCmd, flowKgs: 0.32, minPsi: 18, minOutletC: 2, maxOutletC: 70 },
      { id: 'pack_r', duct: 'r_duct', on: V.packRCmd, flowKgs: 0.32, minPsi: 18, minOutletC: 2, maxOutletC: 70 },
    ],
    zones: [
      { id: 'cockpit', packs: ['pack_r', 'pack_l'], target: zoneTarget(1), volumeM3: 8, heatLoadW: 1500, initialC: 20 },
      { id: 'fwd_cabin', packs: ['pack_l', 'pack_r'], target: zoneTarget(2), volumeM3: 30, heatLoadW: 2500, initialC: 20 },
      { id: 'aft_cabin', packs: ['pack_l', 'pack_r'], target: zoneTarget(3), volumeM3: 30, heatLoadW: 2000, initialC: 20 },
    ],
    starters: [
      { id: 'ats_l', engine: 1, duct: 'l_duct', command: 'fadec.eng1.starter_cmd', valvePower: 'elec.start_valve_l_powered', nominalPsi: G650_LIMITS.minStartBleedPsi, demandKgs: 0.5 },
      { id: 'ats_r', engine: 2, duct: 'r_duct', command: 'fadec.eng2.starter_cmd', valvePower: 'elec.start_valve_r_powered', nominalPsi: G650_LIMITS.minStartBleedPsi, demandKgs: 0.5 },
    ],
  });
}

/** Cabin schedule: 3,290 ft at FL410 (AIN), 4,850 ft at FL510 (GAC); linear from sea level (EST). */
export const G650_CABIN_SCHEDULE = { x: [0, 41000, 51000], y: [0, G650_LIMITS.cabinAtFl410Ft, G650_LIMITS.cabinAtFl510Ft] };

export function createPressurization(ctx: Pick<SimContext, 'vars' | 'nav'>): Pressurization {
  return new Pressurization(ctx.vars, {
    cabinVolumeM3: 71, // EST: cabin 2,138 ft^3 + cockpit + 195 ft^3 baggage (GAC)
    maxDiffPsi: G650_LIMITS.maxDiffPsi,
    reliefPsi: G650_LIMITS.reliefPsi,
    negReliefPsi: 0.25, // LUC
    schedule: G650_CABIN_SCHEDULE,
    // FLIGHT: the CPC profiles the climb to the FMS cruise altitude (LUC: AUTO uses FMS data);
    // LANDING: no cruise profile, the cabin follows the schedule / descends to the landing field. SCOPE.
    flightAltitude: `${V.fltLdg} == 0 ? fms.crz_alt_ft : 0`,
    maxCabinClimbFpm: 500, // LUC
    maxCabinDescentFpm: 300, // LUC: 150-300 fpm
    landingBiasFt: -250, // LUC: LFE - 250 ft
    landingElevation: V.ldgElevFt,
    landingElevationAuto: `${V.pressMode} == 0 && ${V.ldgElevFt} < -9000`,
    destinationElevation: (ident) => {
      try {
        return typeof ctx.nav?.airport === 'function' ? ctx.nav.airport(ident)?.elevationFt : undefined;
      } catch {
        return undefined;
      }
    },
    groundPrepress: { active: `${V.toThrust} && gear.air_ground && ${V.pressMode} != 2`, psi: 0.25 }, // LUC: pre-pressurisation 0.25 psi
    inflowKgs: 'pneu.pack_flow_kgs',
    mode: V.pressMode, // 0 AUTO, 1 SEMI (second channel / crew data), 2 MANUAL
    manualCommand: V.manHold,
    dump: `${V.pressDump} == 1 || ${V.doorMain} > 0.02`,
    cabinAltWarnFt: 8000, // LUC: "Cabin Pressure Low" at 8,000 ft for landing fields SL-7,500 ft
    masksDeployFt: G650_LIMITS.paxMaskFt,
    masksManual: `${V.paxOxy} == 2`,
    onGround: 'gear.air_ground',
    cabinTempC: 'pneu.fwd_cabin_temp_c',
  });
}

export function createIce(ctx: Pick<SimContext, 'vars'>): IceProtection {
  const probe = (n: 1 | 2 | 3 | 4) => `${V.probeHeatOn(n)} * elec.probe${n}_powered`;
  return new IceProtection(ctx.vars, {
    surfaces: [
      // SCOPE: one airframe ice value; it is protected only as well as the weaker wing.
      { id: 'wing_l', output: ICE.airframe, ratePerMin: 0.1, protection: { kind: 'thermal', active: `min(${V.waiCmd('l')} * pneu.wai_l_ok, ${V.waiCmd('r')} * pneu.wai_r_ok)` } },
      { id: 'wing_r', output: 'ice.wing_r', ratePerMin: 0.1, protection: { kind: 'thermal', active: `${V.waiCmd('r')} * pneu.wai_r_ok` } },
      { id: 'cowl_l', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: `${V.caiCmd('l')} * pneu.cai_l_ok` } },
      { id: 'cowl_r', output: ICE.inlet(2), ratePerMin: 0.15, engine: 2, protection: { kind: 'thermal', active: `${V.caiCmd('r')} * pneu.cai_r_ok` } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe(1) } },
      { id: 'pitot2', output: ICE.pitot(2), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe(2) } },
      { id: 'pitot3', output: ICE.pitot(3), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe(3) } },
      { id: 'pitot4', output: ICE.pitot(4), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: probe(4) } },
      // The MFPs combine pitot and static sensing (one heater each).
      { id: 'static1', output: ICE.static(1), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe(1) } },
      { id: 'static2', output: ICE.static(2), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe(2) } },
      { id: 'static3', output: ICE.static(3), ratePerMin: 0.2, speedExp: 0.5, protection: { kind: 'electric', active: probe(3) } },
      { id: 'wshld_l', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldOn('l')} * elec.wshld_l_powered` } },
      { id: 'wshld_r', output: ICE.windshield(2), ratePerMin: 0.2, protection: { kind: 'electric', active: `${V.wshldOn('r')} * elec.wshld_r_powered` } },
    ],
    // LUC: two vibrating-probe detectors (L MAIN AC / R MAIN AC); CAS clears 1 min after the last ice.
    detector: { power: 'elec.ice_det_l_powered || elec.ice_det_r_powered', threshold: 0.03, holdS: 60 },
  });
}

export function createApu(ctx: Pick<SimContext, 'vars'>): Apu {
  return new Apu(ctx.vars, {
    master: `${V.apuMaster} == 1 && elec.apu_ecu_powered`,
    // In-flight start envelope: dossier §7 (abnormals) "APU if needed (in flight <= 37,000 ft)"; the generator
    // may then be used to 45,000 ft. Starts commanded above 37,000 ft press alt are inhibited (ECU envelope).
    start: `${V.apuStart} == 1 && fdm.press_alt_ft <= 37000`,
    stop: V.apuStop,
    starterVolts: 'elec.l_batt_bus_v', // LUC: the APU starter uses the left main battery
    starterNominalV: 26,
    starterPeakA: 600, // EST: RE220 starter-generator inrush on a 53 Ah NiCd
    fuelAvailable: 'fuel.apu_on',
    fire: 'fire.apu_warn',
    bleedLoad: 'clamp01(pneu.apu_bleed_flow_kgs / 0.7)',
    genLoad: 'clamp01(elec.apu_gen_load_pct / 100)',
    maxBleedPsi: 50,
    bleedCeilingFt: 30000, // LIM: starter-assisted engine starts below 30,000 ft
    doorTimeS: 13, // LUC: READY within 10-16 s of MASTER ON
    startTimeS: 35, // EST
    availDelayS: 2, // LUC: generator on line at 99 % + 2 s
    cooldownS: 60, // LUC
    starterCutoutPct: 40, // LUC: starter disengages at 40 % on the ground
    selfSustainPct: 40,
    egtLimitC: G650_LIMITS.apuEgtStartC, // LIM 1,050 degC start (732 degC running: CAS only)
    // A failed (no-light-off) start is retried after a MASTER cycle within the starter duty limits
    // (code450 APU Start Checklist; LIM starter duty 3 min / 15 s x 2): the master cycle clears the
    // latched fault already during spooldown, not only with the rotor at rest (P01).
    masterOffFaultClear: true,
    ffIdlePph: 180,
    ffFullPph: G650_LIMITS.apuFuelPph,
  });
}

export function createFire(ctx: Pick<SimContext, 'vars'>): FireProtection {
  const shot1 = (d: string) => `${d} > 0.5`; // rotate OUTWARD = shot 1 = RIGHT bottle (LIM)
  const shot2 = (d: string) => `${d} < -0.5`; // rotate INWARD = shot 2 = LEFT bottle
  return new FireProtection(ctx.vars, {
    zones: [
      // ENGINE FIRE TEST: each L/R LOOP A/B switch tests only its own engine's detection (LUC fire; dossier
      // §4.10) - pressing L LOOP A must light only the L fire warning. Per-zone test overrides carry that.
      {
        id: 'eng1',
        loops: 2,
        handle: V.fireHandleL,
        discharge: [{ bottle: 'bottle_r', command: shot1(V.fireDischL) }, { bottle: 'bottle_l', command: shot2(V.fireDischL) }],
        power: 'elec.fdcu_l_powered',
        test: { fire: `${V.fireTestLA} || ${V.fireTestLB}`, fault: V.fireFaultTest },
      },
      {
        id: 'eng2',
        loops: 2,
        handle: V.fireHandleR,
        discharge: [{ bottle: 'bottle_r', command: shot1(V.fireDischR) }, { bottle: 'bottle_l', command: shot2(V.fireDischR) }],
        power: 'elec.fdcu_r_powered',
        test: { fire: `${V.fireTestRA} || ${V.fireTestRB}`, fault: V.fireFaultTest },
      },
      // APU: single helium-tube detector; FIRE EXT (guarded) discharges the LEFT bottle (LUC apu, LIM).
      // APU TEST tests the APU detector only (LUC fire).
      {
        id: 'apu',
        loops: 1,
        handle: `${V.apuFireExtGuard} || ${V.apuFireExt}`,
        discharge: [{ bottle: 'bottle_l', command: V.apuFireExt }],
        power: 'elec.fdcu_l_powered',
        test: { fire: V.apuFireTest, fault: V.fireFaultTest },
      },
    ],
    bottles: [
      { id: 'bottle_r', chargePsi: 600, tempC: 'fdm.sat_c' }, // EST Halon 1301 charge
      { id: 'bottle_l', chargePsi: 600, tempC: 'fdm.sat_c' },
    ],
    // FAULT TEST stays system-wide (squib lamps); the per-zone overrides above carry it for the zone fault lamps.
    test: { fault: V.fireFaultTest },
  });
}

export function createOxygen(ctx: Pick<SimContext, 'vars'>): OxygenSystem {
  // LUC: 2 x 123.4 ft^3 (3,494 L NTPD) at 1,800 psi; crew gauge / passenger gauge.
  const L = G650_LIMITS.oxyBottleFt3 * 28.3168;
  return new OxygenSystem(ctx.vars, {
    bottles: [
      { id: 'crew', capacityL: L, fullPsi: G650_LIMITS.oxyFullPsi, lowPsi: 400, valve: `${V.crewOxy} == 1` },
      { id: 'pax', capacityL: L, fullPsi: G650_LIMITS.oxyFullPsi, lowPsi: 400, valve: `${V.paxShutoff} == 1` },
    ],
    crew: [
      // LUC oxygen: each EROS mask has its own N / 100 % / EMERGENCY regulator (per-side mode vars).
      { id: 'pilot', bottle: 'crew', inUse: V.oxyMaskL, mode: V.oxyMaskModeL },
      { id: 'copilot', bottle: 'crew', inUse: V.oxyMaskR, mode: V.oxyMaskModeR },
    ],
    pax: { kind: 'gaseous', deploy: `${V.paxOxy} == 2 || (${V.paxOxy} == 1 && press.pax_masks)`, bottle: 'pax', flowLpm: 60 },
  });
}
