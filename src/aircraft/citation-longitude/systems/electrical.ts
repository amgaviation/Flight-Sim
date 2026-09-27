/**
 * Citation Longitude 28 V DC electrical system (OG Section 5; BCA).
 *
 * OG 5-2: "dual-bus DC powered design. Each bus half consists of a battery and
 * engine driven generator ... an APU driven generator ... the
 * hydromechanically powered PTCU motor-generator ... The buses are isolated
 * during normal operations but may be tied together." Sub-buses per side:
 * Hot Battery, Service, Emergency, Mission, Main, Interior; plus the Standby
 * bus for the standby flight instruments.
 *
 * Topology (per side; links are contactors unless noted):
 *
 *   BATT (Li-ion 26.4 V 44 Ah) - HOT BATT --(BATT button)--> EMER
 *   EMER <==(ELEC button: ON = tied, EMER = isolated)==> MISSION <-- GEN (engine: 400 A gnd / 500 A flight)
 *   MISSION --(MAIN button)--> MAIN      MISSION --(INTERIOR NORM)--> INTERIOR
 *   L MISSION <==(BUS TIE: automatic on the ground, button in flight)==> R MISSION
 *   APU GEN (500 A gnd / 400 A flight) and EXT PWR on the LEFT mission bus (OG 5-3: "APU is connected
 *   to the left electrical bus system"); PTCU HYD GEN (200 A) on the right mission bus (EST side).
 *   STBY BATT (24 V 10.4 Ah lead-acid) is charged from the L MISSION bus through a diode (OG 5-3) and
 *   feeds the STANDBY bus through the STBY PWR switch.
 *   SERVICE bus: from the R mission bus (EST; ramp/service items, redundant fuel power per OG 5-2).
 *
 * The electrical side of the bus-tie automation, the standby-battery LEDs and
 * generator load bookkeeping live in `ElectricalLogic` (systems/logic.ts).
 * Loads are EST typical currents for each equipment class; every load has a
 * breaker `cb.<id>` for the cockpit CB panels.
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { ElectricalNetwork, BATTERY_172S_STANDBY, type LoadDef } from '../../../systems/electrical';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';

export const pw = (load: string): string => `elec.${load}_powered`;

/**
 * Li-ion main battery (OG 5-2: "Li-Ion type, with a nominal 26.4 V at full charge and 44 amp-hours" =
 * 8 LiFePO4 cells, True Blue Power TB44 class). Internal resistance EST 9 mOhm (LFP 44 Ah class,
 * ~1,500 A peak power at 12 V).
 */
export const BATTERY_LONGITUDE_LI: { chemistry: 'li-ion'; cells: number; capacityAh: number; internalResistanceOhm: number; fullChargeV: number } = {
  chemistry: 'li-ion',
  cells: 8,
  capacityAh: LON_LIMITS.battAh,
  internalResistanceOhm: 0.009,
  fullChargeV: 28.0, // EST: charge regulation for 8 LFP cells (3.5 V/cell)
};

export function createElectrical(ctx: Pick<SimContext, 'vars'>): ElectricalNetwork {
  const load = (id: string, bus: string, amps: LoadDef['amps'], extra: Partial<LoadDef> = {}, cbA = 5): LoadDef => ({
    id,
    bus,
    amps,
    cb: { name: id, ratingA: cbA },
    ...extra,
  });
  const loads: LoadDef[] = [
    // ---- EMER L: pilot-side flight-critical avionics (G5000 GDU PFD1, PFD GTC, GIA #1, GDC #1, AHRS #1, GMC, AFCS)
    load('pfd1', 'emer_l', 6.5, {}, 10), // GDU 1400W class ~180 W (EST)
    load('gtc1', 'emer_l', 1.2, {}, 5),
    load('gia1', 'emer_l', 3.5, {}, 7.5),
    load('adc1', 'emer_l', 0.8, {}, 3),
    load('ahrs1', 'emer_l', 1.2, {}, 3), // Litef LCR-100 AHRS (BCA)
    load('gmc', 'emer_l', 0.6, {}, 3),
    load('afcs', 'emer_l', 'ap.engaged * 3 + 0.5', {}, 5),
    load('fadec_l_aux', 'emer_l', 0.5, {}, 3), // FADEC back-up power (engine alternator is primary, OG 7-2)
    load('flaps', 'emer_l', '1 + 35 * flaps.moving', {}, 50), // electric flap drive (OG 15-1: "flaps are electronically actuated")
    load('fire_det', 'emer_l', 0.5, {}, 3),
    load('stall_warn', 'emer_l', 0.4, {}, 3),
    load('ra', 'emer_l', 0.8, {}, 3),
    load('ext_lt_nav', 'emer_l', 2, { enabled: V.ltNav, model: 'resistive' }, 5),
    load('ign_l', 'emer_l', '6 * eng1.ignition', {}, 7.5),
    load('apu_starter', 'emer_l', 'apu.starter_amps', {}, 500), // APU start (OG 5-5: bus tie closes for the APU start)
    // ---- EMER R: copilot-side
    load('pfd2', 'emer_r', 6.5, {}, 10),
    load('gtc4', 'emer_r', 1.2, {}, 5),
    load('gia2', 'emer_r', 3.5, {}, 7.5),
    load('adc2', 'emer_r', 0.8, {}, 3),
    load('ahrs2', 'emer_r', 1.2, {}, 3),
    load('fadec_r_aux', 'emer_r', 0.5, {}, 3),
    load('xpdr1', 'emer_r', 1.5, {}, 5),
    load('ign_r', 'emer_r', '6 * eng2.ignition', {}, 7.5),
    load('gear_ctl', 'emer_r', '0.5 + 2 * gear.moving', {}, 5), // gear control valves (electrically signalled, hydraulic)
    load('brake_ctl', 'emer_r', 1.5, {}, 5), // brake-by-wire controller (BCA)
    load('rudder_ctl', 'emer_r', 1.5, {}, 5), // rudder control unit (FBW rudder)
    // ---- MISSION L: MFD, centre GTC, fuel pump, PTCU motor (AUX), cockpit services
    load('mfd', 'mission_l', 6.5, {}, 10),
    load('gtc2', 'mission_l', 1.2, {}, 5),
    load('boost_l', 'mission_l', 'fuel.boost_l_amps', {}, 15),
    load('recirc_l', 'mission_l', `2 * ${V.recircOn(1)}`, {}, 5),
    load('pitot_l', 'mission_l', `9 * ${V.pitotHeatOn}`, { model: 'resistive' }, 15),
    load('ptcu_motor', 'mission_l', 'hyd.ptcu_pump_a_amps + hyd.ptcu_pump_b_amps', {}, 150),
    load('stab_emeds', 'mission_l', `${V.aiStab} * 12`, {}, 20), // EMEDS pulse supply (BCA: DC-powered magnets)
    load('ecs_fans', 'mission_l', `4 + 3 * pneu.pack_on + (${V.recircFan} == 2 ? 6 : 3)`, {}, 15), // recirculation fan AUTO/LOW 3 A, HIGH 6 A (EST)
    load('apu_ecu', 'mission_l', `1 + 2 * (${V.apuKnob} >= 1)`, {}, 5),
    load('panel_lts', 'mission_l', `3 * ${V.ltPanel} + 2 * ${V.ltFlood}`, { model: 'resistive' }, 7.5),
    load('ext_lt_beacon', 'mission_l', 1.5, { enabled: 'light.beacon > 0', model: 'resistive' }, 5),
    load('ext_lt_strobe', 'mission_l', 3, { enabled: V.ltAntiColl }, 7.5),
    load('ext_lt_taxi', 'mission_l', 4, { enabled: V.ltTaxi }, 7.5),
    // ---- MISSION R
    load('gtc3', 'mission_r', 1.2, {}, 5),
    load('boost_r', 'mission_r', 'fuel.boost_r_amps', {}, 15),
    load('recirc_r', 'mission_r', `2 * ${V.recircOn(2)}`, {}, 5),
    load('pitot_r', 'mission_r', `9 * ${V.pitotHeatOn}`, { model: 'resistive' }, 15),
    load('rss_pump', 'mission_r', 'hyd.rss_pump_amps', {}, 30),
    load('radar', 'mission_r', 4, {}, 7.5),
    load('tcas', 'mission_r', 2, {}, 5),
    load('xpdr2', 'mission_r', 1.5, {}, 5),
    load('ext_lt_recog', 'mission_r', 3, { enabled: `${V.ltRecog} || ${V.ltPulse}` }, 7.5),
    // ---- MAIN L/R: redundant / high-power items (windshield heat only with a generator, BCA)
    load('wshld_l', 'main_l', `35 * ${V.wshldHeatOn}`, { model: 'resistive' }, 50),
    load('wshld_r', 'main_r', `35 * ${V.wshldHeatOn}`, { model: 'resistive' }, 50),
    load('ldg_lt_l', 'main_l', 6, { enabled: V.ltLdgL }, 10),
    load('ldg_lt_r', 'main_r', 6, { enabled: V.ltLdgR }, 10),
    load('wing_insp', 'main_l', 2, { enabled: V.ltWingInsp }, 5),
    load('tail_flood', 'main_r', 3, { enabled: V.ltTailFlood }, 5),
    load('galley', 'main_r', 25, { enabled: 'gear.air_ground == 0 || elec.gen_l_online || elec.gen_r_online || elec.apu_gen_online' }, 40),
    // ---- INTERIOR
    load('cabin_l', 'int_l', 18, {}, 30),
    load('cabin_r', 'int_r', 18, {}, 30),
    // ---- STANDBY
    load('stby_inst', 'stby', 1.5, {}, 5),
    // ---- HOT BATT L: cockpit dome light (EST: Citation-family entry/dome lighting on the hot battery bus so it
    // works with the batteries off; ~30 W LED fixture). Added with the overhead panel.
    load('dome_lt', 'hot_l', 1.2, { enabled: V.ltDome, model: 'resistive' }, 5),
    // ---- SERVICE (R): refuel panel, service lights (EST)
    load('service', 'svc', 1, {}, 5),
  ];
  const genSwitch = (sw: string) => `${sw} == 1`;
  const genReset = (sw: string) => `${sw} == 2`;
  const contactor = { pickupV: 15, dropoutV: 7 }; // MIL-PRF-6106 28 V-class relay (pull-in 15 V max), drop-out EST
  return new ElectricalNetwork(ctx.vars, {
    buses: [
      { id: 'hot_l' }, { id: 'hot_r' }, { id: 'emer_l' }, { id: 'emer_r' }, { id: 'mission_l' }, { id: 'mission_r' },
      { id: 'main_l' }, { id: 'main_r' }, { id: 'int_l' }, { id: 'int_r' }, { id: 'stby_hot' }, { id: 'stby' }, { id: 'svc' },
    ],
    batteries: [
      { id: 'batt_l', bus: 'hot_l', ...BATTERY_LONGITUDE_LI, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 12000, coolingWK: 6, overTempC: LON_LIMITS.battOtempWarnC } },
      { id: 'batt_r', bus: 'hot_r', ...BATTERY_LONGITUDE_LI, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 12000, coolingWK: 6, overTempC: LON_LIMITS.battOtempWarnC } },
      // OG 5-3: standby battery 24 V 10.4 Ah lead-acid, >= 180 min for the standby instruments.
      { id: 'stby_batt', bus: 'stby_hot', ...BATTERY_172S_STANDBY, capacityAh: LON_LIMITS.stbyBattAh, internalResistanceOhm: 0.035, ambientC: 'fdm.sat_c' },
    ],
    dcGenerators: [
      // OG 5-3: engine generators 28 V, 400 A ground / 500 A in flight (rating modelled at 500 A; load CAS at 75 %).
      { id: 'gen_l', bus: 'mission_l', kind: 'generator', regulatedV: 28.0, ratedA: LON_LIMITS.genFlightA, drive: ENG.n2(1), minDrive: 50, switch: genSwitch(V.genL), reset: genReset(V.genL) },
      { id: 'gen_r', bus: 'mission_r', kind: 'generator', regulatedV: 28.0, ratedA: LON_LIMITS.genFlightA, drive: ENG.n2(2), minDrive: 50, switch: genSwitch(V.genR), reset: genReset(V.genR) },
      // OG 5-3: APU generator 28 V, 500 A ground / 400 A in flight.
      { id: 'apu_gen', bus: 'mission_l', kind: 'generator', regulatedV: 28.0, ratedA: LON_LIMITS.apuGenGroundA, drive: 'apu.gen_drive', minDrive: 95, switch: genSwitch(V.genApu), reset: genReset(V.genApu) },
      // OG 5-3: PTCU generator mode 28 V, 200 A max; drive = PTCU hydraulic motor speed fraction x 100 (logic.ts).
      { id: 'ptcu_gen', bus: 'mission_r', kind: 'generator', regulatedV: 27.8, ratedA: LON_LIMITS.ptcuGenA, drive: 'hyd.ptcu_gen_drive', minDrive: 90 },
    ],
    // GPU: 28 V regulated at the aircraft receptacle (EST: remote-sensing ground power unit, 1.5 mOhm cable/contactor
    // drop). With the library default 4 mOhm the bus sagged to ~27.2 V under the ~180 A ground load, below the Li-ion
    // battery EMF, so the batteries discharged on ground power (OG 17-2 expects "BATT Amps 0 or Charging").
    externals: [{ id: 'gpu', bus: 'mission_l', type: 'dc', available: V.extPwrAvail, switch: V.extPwr, voltage: 28, resistanceOhm: 0.0015 }],
    links: [
      { id: 'batt_l_rly', a: 'hot_l', b: 'emer_l', closed: `${V.battL} && !fail.elec.batt_l_rly`, coil: contactor },
      { id: 'batt_r_rly', a: 'hot_r', b: 'emer_r', closed: `${V.battR} && !fail.elec.batt_r_rly`, coil: contactor },
      { id: 'elec_l_rly', a: 'emer_l', b: 'mission_l', closed: V.elecL },
      { id: 'elec_r_rly', a: 'emer_r', b: 'mission_r', closed: V.elecR },
      { id: 'main_l_rly', a: 'mission_l', b: 'main_l', closed: V.mainL, cb: { name: 'main_l_feed', ratingA: 150 } },
      { id: 'main_r_rly', a: 'mission_r', b: 'main_r', closed: V.mainR, cb: { name: 'main_r_feed', ratingA: 150 } },
      // INTERIOR NORM: the interior logic connects cabin loads when a generator/external source carries them (EST shed on battery).
      { id: 'int_l_rly', a: 'mission_l', b: 'int_l', closed: `${V.interior} && (elec.gen_l_online || elec.apu_gen_online || elec.gpu_online || elec.gen_r_online)` },
      { id: 'int_r_rly', a: 'mission_r', b: 'int_r', closed: `${V.interior} && (elec.gen_r_online || elec.gen_l_online || elec.apu_gen_online || elec.gpu_online)` },
      { id: 'bus_tie', a: 'mission_l', b: 'mission_r', closed: V.busTieCmd, cb: { name: 'bus_tie', ratingA: 400 } },
      { id: 'stby_chg', a: 'mission_l', b: 'stby_hot', kind: 'diode', closed: 1 },
      { id: 'stby_sw', a: 'stby_hot', b: 'stby', closed: `${V.stbyPwr} >= 1` },
      { id: 'svc_feed', a: 'mission_r', b: 'svc', kind: 'diode', closed: 1 },
    ],
    loads,
  });
}
