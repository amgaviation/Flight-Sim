/**
 * Gulfstream G650 electrical system (LUC electrical, SCQ electrical, LIM).
 *
 * AC generation (115 V 400 Hz, never paralleled):
 *   L IDG (40 kVA) -> L MAIN AC       R IDG (40 kVA) -> R MAIN AC
 *   APU GEN (40 kVA, SL-45,000 ft) and EXT AC (40 kVA cart) -> the AC tie bus
 *   L / R BUS TIE relays (switches AUTO / ISLN) join each main AC bus to the tie
 *   bus when its IDG is off line: priority on-side IDG > APU > EXT > cross-side
 *   IDG (bus power control logic in systems/logic.ts).
 *   EMER AC is fed from L MAIN AC normally and by the RAT generator (15 kVA,
 *   >= 180 KCAS, LIM/LUC) after deployment; the RAT then also feeds the L/R ESS
 *   TRUs (LIM: "RAT provides electrical power to equipment connected to the
 *   L Ess. DC, R Ess. DC & Emer AC busses").
 * DC (28 V): five 250 A TRUs: L ESS, L MAIN, AUX, R MAIN, R ESS (LUC). L/R MAIN
 *   TRU switches select the opposite main AC bus ("R AC" / "L AC"). The AUX TRU
 *   substitutes for a failed TRU (priority ESS before MAIN, L before R) and then
 *   sheds the AUX DC (cabin) bus.
 * Batteries: two 28 V 53 Ah NiCd main batteries on the L/R battery buses,
 *   joined to the L/R ESS DC buses by the MAIN BATTERIES switches (16 min
 *   of ESS DC, LUC); the APU starter uses the left battery (LUC apu); two
 *   emergency batteries (24 V 10.5 Ah sealed lead acid, 45 min) for the
 *   L/R EMERGENCY and FLIGHT INSTRUMENT buses (standby displays, IRUs, MCDU 1/3,
 *   NAV/COM 1) when EMERGENCY POWER is ON, or ARM and an ESS DC bus falls below
 *   20 V; flight-control batteries EBHA (NiCd 28 V 53 Ah, the seven EBHA
 *   MCEs) and UPS (lead acid 24 V 10.5 Ah, FCC 1A / 2B / BFCU), 30 min of flight
 *   controls (LUC).
 * SCOPE: one `emer_dc` bus stands for the L/R EMERGENCY and FLIGHT INSTRUMENT
 *   buses; the two 60 Hz cabin converters are one AC load; the static inverter
 *   (CPC channel 1) is folded into the pressurization power binding; E-BATT,
 *   EBHA and UPS chargers are modelled as the batteries floating on their
 *   buses (the real chargers hang on EMER AC).
 * Loads are EST currents for each equipment class; every load has a breaker
 * `cb.<id>` for the cockpit CB panels.
 */
import type { SimContext } from '../../../core/SimContext';
import { ElectricalNetwork, BATTERY_G650_NICD, type LoadDef } from '../../../systems/electrical';
import { G650_LIMITS } from '../data';
import { G650_VARS as V } from '../vars';

export const pw = (load: string): string => `elec.${load}_powered`;

/** 24 V 10.5 Ah sealed lead-acid (emergency and UPS batteries, LUC): R EST 30 mOhm (Ipp ~450 A class). */
const SLA_10AH = { chemistry: 'lead-acid' as const, cells: 12, capacityAh: G650_LIMITS.eBattAh, internalResistanceOhm: 0.03 };

export function createElectrical(ctx: Pick<SimContext, 'vars'>): ElectricalNetwork {
  const dc = (id: string, bus: string, amps: LoadDef['amps'], cbA = 5, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, amps, cb: { name: id, ratingA: cbA }, ...extra });
  const ac = (id: string, bus: string, va: LoadDef['va'], cbA = 10, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, va, cb: { name: id, ratingA: cbA }, ...extra });
  const airborne = 'gear.air_ground == 0';
  const singleSource = `((elec.idg1_online ? 1 : 0) + (elec.idg2_online ? 1 : 0) + (elec.apu_gen_online ? 1 : 0) + (elec.gpu_online ? 1 : 0)) < 2`;
  const loads: LoadDef[] = [
    // ------------------------------------------------ L ESS DC (pilot-side essential)
    dc('fcc1b', 'l_ess_dc', 3.5, 7.5), // FCC 1 channel B (LUC)
    dc('du1', 'l_ess_dc', 6.5, 10), // DU 1 pilot PFD (14 in LCD ~180 W EST)
    dc('adc1', 'l_ess_dc', 0.8, 3), // ADS 1 (MFP 1 air data)
    dc('gps1', 'l_ess_dc', 0.8, 3),
    dc('afcs1', 'l_ess_dc', 'ap.engaged * 2 + 1', 5), // FGC 1 (guidance panel channel)
    dc('gp', 'l_ess_dc', 1.0, 3), // guidance panel
    dc('ccd1', 'l_ess_dc', 0.3, 3),
    dc('boost_l', 'l_ess_dc', 'fuel.boost_l_amps', 25), // L MAIN fuel pump (LUC: MAIN pumps on ESS DC, < 25 A)
    dc('ign_l', 'l_ess_dc', '4 * eng1.ignition', 7.5), // exciter A (LUC: L & R ESS DC)
    dc('fdcu_l', 'l_ess_dc', 0.5, 3), // fire detection control unit L
    dc('fecu_a', 'l_ess_dc', '0.8 + 2 * flaps.moving', 5), // FECU (L & R ESS DC, LUC)
    dc('nwscu', 'l_ess_dc', 1.2, 5), // steer-by-wire NWSCU (LUC: 28 VDC L ESS DC)
    dc('bcu_a', 'l_ess_dc', 1.5, 5), // brake control unit channel A (LUC)
    dc('lgcu1', 'l_ess_dc', '0.5 + 1.5 * gear.moving', 5), // LG controller lane 1 (LUC)
    dc('hyd_aux', 'l_ess_dc', 'hyd.aux_amps', 150), // AUX hydraulic pump (LUC: L ESS DC), 3,000 psi at 2 gpm
    dc('bac_l', 'l_ess_dc', 0.6, 3), // bleed air controller L
    dc('stall_warn', 'l_ess_dc', 0.3, 3),
    dc('probe1', 'l_ess_dc', `9 * ${V.probeHeatOn(1)}`, 15, { model: 'resistive' }), // MFP 1 heater (EST 250 W)
    dc('probe3', 'l_ess_dc', `9 * ${V.probeHeatOn(3)}`, 15, { model: 'resistive' }),
    dc('fuel_valves_l', 'l_ess_dc', 0.3, 3), // L engine SOV / crossflow valve (LUC)
    dc('cpc', 'l_ess_dc', 0.8, 3), // cabin pressure controller (ch 1 via the static inverter)
    dc('apu_ecu', 'l_ess_dc', `0.5 + 1.5 * (${V.apuMaster} != 0)`, 5), // APU ECU (L BATT bus or R ESS DC via MASTER; EST single feed)
    dc('start_valve_l', 'l_ess_dc', '0.5 * pneu.ats_l_valve_open', 3),
    dc('cowl_valve_l', 'l_ess_dc', 0.2, 3),
    // ------------------------------------------------ R ESS DC
    dc('fcc2a', 'r_ess_dc', 3.5, 7.5),
    dc('nav2', 'r_ess_dc', 1.0, 3), // VHF NAV 2
    dc('du4', 'r_ess_dc', 6.5, 10), // DU 4 copilot PFD
    dc('adc2', 'r_ess_dc', 0.8, 3),
    dc('gps2', 'r_ess_dc', 0.8, 3),
    dc('afcs2', 'r_ess_dc', 'ap.engaged * 2 + 1', 5),
    dc('ccd2', 'r_ess_dc', 0.3, 3),
    dc('boost_r', 'r_ess_dc', 'fuel.boost_r_amps', 25),
    dc('ign_r', 'r_ess_dc', '4 * eng2.ignition', 7.5),
    dc('fdcu_r', 'r_ess_dc', 0.5, 3),
    dc('fecu_b', 'r_ess_dc', 0.8, 5),
    dc('bcu_b', 'r_ess_dc', 1.5, 5),
    dc('bac_r', 'r_ess_dc', 0.6, 3),
    dc('probe2', 'r_ess_dc', `9 * ${V.probeHeatOn(2)}`, 15, { model: 'resistive' }),
    dc('probe4', 'r_ess_dc', `9 * ${V.probeHeatOn(4)}`, 15, { model: 'resistive' }),
    dc('fuel_valves_r', 'r_ess_dc', 0.3, 3), // R engine SOV / intertank valve (LUC)
    dc('start_valve_r', 'r_ess_dc', '0.5 * pneu.ats_r_valve_open', 3),
    dc('cowl_valve_r', 'r_ess_dc', 0.2, 3),
    dc('oxy_panel', 'r_ess_dc', 0.2, 3), // OXYGEN SYSTEM panel (L/R ESS DC, LUC)
    dc('fire_ext', 'r_ess_dc', 0.2, 5), // bottle squibs
    // ------------------------------------------------ L MAIN DC
    dc('du2', 'l_main_dc', 6.5, 10), // DU 2 (MFD)
    dc('alt_l', 'l_main_dc', 'fuel.alt_l_amps', 25), // L ALT fuel pump (LUC: MAIN DC)
    dc('mcdu2', 'l_main_dc', 1.0, 3),
    dc('radar', 'l_main_dc', 4.0, 7.5), // RDR-4000 (EST)
    dc('taws', 'l_main_dc', 1.0, 3),
    dc('adf', 'l_main_dc', 0.5, 3),
    dc('xpdr1', 'l_main_dc', 1.5, 5),
    dc('ldg_lt_l', 'l_main_dc', 7, 15, { enabled: V.ltLdgL }), // LED landing light (EST 200 W)
    dc('taxi_lt', 'l_main_dc', 5, 10, { enabled: V.ltTaxi }),
    dc('nav_lts', 'l_main_dc', 2, 5, { enabled: V.ltNav }),
    dc('beacon', 'l_main_dc', 2, 5, { enabled: V.ltBeacon }),
    dc('wing_insp', 'l_main_dc', 2, 5, { enabled: V.ltWing }),
    dc('panel_lts', 'l_main_dc', `3 * ${V.ltPanel} + 2 * ${V.ltFlood} + 0.5 * max(${V.ltDome}, ${V.ltMaster} > 1.05 ? 1 : 0)`, 7.5, { model: 'resistive' }), // + dome with MASTER CONTROL ORIDE
    // ------------------------------------------------ R MAIN DC
    dc('du3', 'r_main_dc', 6.5, 10), // DU 3 (MFD)
    dc('alt_r', 'r_main_dc', 'fuel.alt_r_amps', 25),
    dc('lgcu2', 'r_main_dc', 0.5, 5), // LG controller lane 2 (LUC: R MAIN DC)
    dc('tcas', 'r_main_dc', 2.0, 5),
    dc('xpdr2', 'r_main_dc', 1.5, 5),
    dc('ra', 'r_main_dc', 0.8, 3),
    dc('ldg_lt_r', 'r_main_dc', 7, 15, { enabled: V.ltLdgR }),
    dc('strobe', 'r_main_dc', 4, 7.5, { enabled: V.ltStrobe }),
    dc('recog', 'r_main_dc', 3, 5, { enabled: V.ltRecog }),
    dc('logo', 'r_main_dc', 3, 5, { enabled: V.ltLogo }),
    dc('ice_det', 'r_main_dc', 0.5, 3),
    // ------------------------------------------------ L/R EMERGENCY + FLIGHT INSTRUMENT buses (emer_dc)
    dc('smc1', 'emer_dc', 1.5, 3), // standby multifunction controller 1
    dc('smc2', 'emer_dc', 1.5, 3),
    dc('irs1', 'emer_dc', 1.2, 5), // 3 IRUs (LUC)
    dc('irs2', 'emer_dc', 1.2, 5),
    dc('irs3', 'emer_dc', 1.2, 5),
    dc('adc3', 'emer_dc', 0.8, 3), // ADS 3 (third MFP), standby air data via the SMCs
    dc('mcdu1', 'emer_dc', 1.0, 3), // MCDU 1 (standby engine page) and MCDU 3 (backup radios, LUC)
    dc('mcdu3', 'emer_dc', 1.0, 3),
    dc('nav1', 'emer_dc', 1.0, 3), // VHF NAV 1 / COM 1 (backup radios, LUC)
    dc('acp', 'emer_dc', 0.6, 3), // audio control panels
    dc('emer_lts', 'emer_dc', `${V.ltEmer} == 2 ? 3 : 0`, 5),
    // ------------------------------------------------ FCC UPS bus / EBHA bus (LUC)
    dc('fcc1a', 'fcc_ups', 3.5, 7.5),
    dc('fcc2b', 'fcc_ups', 3.5, 7.5),
    dc('bfcu', 'fcc_ups', 1.5, 5),
    dc('ebha_mce', 'ebha', '3 + 20 * (abs(surf.elevator) + abs(surf.aileron)) * 0.1', 20), // 7 MCEs (EST standby + surface motion)
    // ------------------------------------------------ AUX DC (cabin) / ground service bus
    dc('cabin_dc', 'aux_dc', 25, 40, { enabled: V.cabinMaster }),
    dc('gsb_loads', 'gsb', 4, 10), // ground service lights / refuel panel / cabin cleaning (EST)
    // ------------------------------------------------ L battery bus
    dc('apu_starter', 'l_batt_bus', 'apu.starter_amps', 600), // APU start from the left battery (LUC apu)
    // ------------------------------------------------ AC loads (VA)
    ac('wshld_l', 'l_main_ac', `2000 * ${V.wshldOn('l')}`, 25), // LF + LS windshield heaters (LUC: 104-114 F) EST
    ac('wshld_r', 'r_main_ac', `2000 * ${V.wshldOn('r')}`, 25),
    ac('cabin_wdo', 'r_main_ac', `600 * (${V.cabinWdo} != 0)`, 10),
    ac('evs_wdo', 'l_main_ac', `150 * (${V.evsWdo} != 0)`, 5),
    ac('cabin_60hz', 'l_main_ac', `3000 * (${V.cabinMaster} != 0)`, 30, { shed: `${airborne} && ${singleSource}` }), // 60 Hz converters (EST)
    ac('galley', 'r_main_ac', `5000 * (${V.galleyMaster} != 0)`, 50, { shed: `${airborne} && ${singleSource}` }), // load shed single source in flight (LUC: shed inhibited on the ground)
    ac('hscu1', 'emer_ac', 300, 5), // stabilizer control unit ch 1 (LUC: EMER AC)
    ac('hscu2', 'r_main_ac', 300, 5), // ch 2 (LUC: R MAIN AC)
    ac('ice_det_l', 'l_main_ac', 40, 3), // ice detectors (LUC: L MAIN AC / R MAIN AC)
    ac('ice_det_r', 'r_main_ac', 40, 3),
    ac('recirc_fans', 'l_main_ac', `800 * (pneu.pack_l_on || pneu.pack_r_on)`, 10), // cabin recirculation / avionics cooling (EST)
    ac('fcs_chargers', 'emer_ac', 200, 5), // EBHA / UPS chargers (LUC)
  ];
  const contactor = { pickupV: 15, dropoutV: 7 }; // MIL-PRF-6106 28 V-class relay (pull-in 15 V max), drop-out EST
  const IDG = G650_LIMITS.idgKva;
  return new ElectricalNetwork(ctx.vars, {
    buses: [
      { id: 'l_main_ac', type: 'ac' }, { id: 'r_main_ac', type: 'ac' }, { id: 'ac_tie', type: 'ac' }, { id: 'ext_ac', type: 'ac' },
      { id: 'l_ess_ac', type: 'ac' }, { id: 'r_ess_ac', type: 'ac' }, { id: 'emer_ac', type: 'ac' },
      { id: 'l_ess_dc' }, { id: 'r_ess_dc' }, { id: 'l_main_dc' }, { id: 'r_main_dc' }, { id: 'aux_tru_out' }, { id: 'aux_dc' },
      { id: 'l_batt_bus' }, { id: 'r_batt_bus' }, { id: 'emer_dc' }, { id: 'ebatt' }, { id: 'fcc_ups' }, { id: 'ups_batt_bus' },
      { id: 'ebha' }, { id: 'ebha_batt_bus' }, { id: 'gsb' },
    ],
    batteries: [
      // LUC: 2 x NiCd 21 cells 28 V 53 Ah (BATTERY_G650_NICD preset: 20 cells, 53 Ah).
      { id: 'batt_l', bus: 'l_batt_bus', ...BATTERY_G650_NICD, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 40000, coolingWK: 12, overTempC: 71 } },
      { id: 'batt_r', bus: 'r_batt_bus', ...BATTERY_G650_NICD, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 40000, coolingWK: 12, overTempC: 71 } },
      // LUC: FWD / AFT E-BATT sealed lead acid 24 V 10.5 Ah, 45 min.
      { id: 'ebatt_fwd', bus: 'ebatt', ...SLA_10AH, ambientC: 'fdm.sat_c' },
      { id: 'ebatt_aft', bus: 'ebatt', ...SLA_10AH, ambientC: 'fdm.sat_c' },
      // LUC: UPS lead acid 24 V 10.5 Ah; EBHA NiCd 28 V 53 Ah.
      { id: 'ups_batt', bus: 'ups_batt_bus', ...SLA_10AH, ambientC: 'fdm.sat_c' },
      { id: 'ebha_batt', bus: 'ebha_batt_bus', ...BATTERY_G650_NICD, ambientC: 'fdm.sat_c' },
    ],
    acGenerators: [
      // LUC: IDGs 40 kVA 115 VAC 400 Hz; GCU online above the CSD underspeed (EST 55 % HP, below the 62 % ground idle).
      // Pulling the fire handle trips the IDG off line at once (LUC fire: the handle closes the fuel and
      // hydraulic SOVs, the bleed, and disconnects the IDG); stowing the handle restores it (SCOPE: the real
      // trip latches until a GEN cycle / AC-DC RESET, but the handle itself is not normally re-stowed).
      { id: 'idg1', bus: 'l_main_ac', ratedKva: IDG, drive: 'eng1.n2_pct', minDrive: 55, switch: `${V.genL} == 1 && !${V.fireHandleL}`, reset: V.elecReset },
      { id: 'idg2', bus: 'r_main_ac', ratedKva: IDG, drive: 'eng2.n2_pct', minDrive: 55, switch: `${V.genR} == 1 && !${V.fireHandleR}`, reset: V.elecReset },
      // LUC: APU GEN 40 kVA, on line at 99 % + 2 s (apu.gen_drive reaches 100 once AVAIL).
      { id: 'apu_gen', bus: 'ac_tie', ratedKva: G650_LIMITS.apuGenKva, drive: 'apu.gen_drive', minDrive: 98, switch: `${V.apuGen} == 1`, reset: V.elecReset },
      // LUC/LIM: RAT GEN 15 kVA, drops off line below 180 KCAS.
      { id: 'rat', bus: 'emer_ac', ratedKva: G650_LIMITS.ratKva, drive: V.ratDrive, minDrive: G650_LIMITS.ratMinKt, switch: `${V.ratGen} == 1` },
    ],
    externals: [{ id: 'gpu', bus: 'ext_ac', type: 'ac', available: V.gpuAvail, switch: `${V.extPwr} == 1`, ratedKva: 40 }], // LUC: EXT AC 40 kVA
    trus: [
      { id: 'l_ess_tru', acBus: 'l_ess_ac', dcBus: 'l_ess_dc', ratedA: G650_LIMITS.truRatedA },
      { id: 'r_ess_tru', acBus: 'r_ess_ac', dcBus: 'r_ess_dc', ratedA: G650_LIMITS.truRatedA },
      { id: 'l_main_tru', acBus: 'l_main_ac', dcBus: 'l_main_dc', ratedA: G650_LIMITS.truRatedA, enabled: `${V.lMainTru} == 1` },
      { id: 'l_main_tru_x', acBus: 'r_main_ac', dcBus: 'l_main_dc', ratedA: G650_LIMITS.truRatedA, enabled: `${V.lMainTru} == 0` },
      { id: 'r_main_tru', acBus: 'r_main_ac', dcBus: 'r_main_dc', ratedA: G650_LIMITS.truRatedA, enabled: `${V.rMainTru} == 1` },
      { id: 'r_main_tru_x', acBus: 'l_main_ac', dcBus: 'r_main_dc', ratedA: G650_LIMITS.truRatedA, enabled: `${V.rMainTru} == 0` },
      // AUX TRU: input side EST R MAIN AC (the left side carries EMER AC).
      { id: 'aux_tru', acBus: 'r_main_ac', dcBus: 'aux_tru_out', ratedA: G650_LIMITS.truRatedA },
    ],
    links: [
      // ---- AC: bus power control (logic.ts)
      { id: 'ext_ctr', a: 'ext_ac', b: 'ac_tie', closed: V.extCmd },
      { id: 'l_btb', a: 'ac_tie', b: 'l_main_ac', closed: V.lBtbCmd },
      { id: 'r_btb', a: 'ac_tie', b: 'r_main_ac', closed: V.rBtbCmd },
      { id: 'l_ess_ac_feed', a: 'l_main_ac', b: 'l_ess_ac', closed: `!${V.ratMode}` },
      { id: 'r_ess_ac_feed', a: 'r_main_ac', b: 'r_ess_ac', closed: `!${V.ratMode}` },
      { id: 'emer_ac_feed', a: 'l_main_ac', b: 'emer_ac', closed: V.emerFeedCmd },
      { id: 'rat_l_ess', a: 'emer_ac', b: 'l_ess_ac', closed: V.ratMode },
      { id: 'rat_r_ess', a: 'emer_ac', b: 'r_ess_ac', closed: V.ratMode },
      // ---- DC: AUX TRU distribution / substitution (logic.ts)
      { id: 'aux_dc_feed', a: 'aux_tru_out', b: 'aux_dc', closed: `${V.auxSubst} == 0` },
      { id: 'aux_l_ess', a: 'aux_tru_out', b: 'l_ess_dc', closed: `${V.auxSubst} == 1` },
      { id: 'aux_r_ess', a: 'aux_tru_out', b: 'r_ess_dc', closed: `${V.auxSubst} == 2` },
      { id: 'aux_l_main', a: 'aux_tru_out', b: 'l_main_dc', closed: `${V.auxSubst} == 3` },
      { id: 'aux_r_main', a: 'aux_tru_out', b: 'r_main_dc', closed: `${V.auxSubst} == 4` },
      // ---- main batteries to the ESS DC buses (MAIN BATTERIES switches)
      { id: 'batt_l_rly', a: 'l_batt_bus', b: 'l_ess_dc', closed: `${V.battL} == 1`, coil: contactor },
      { id: 'batt_r_rly', a: 'r_batt_bus', b: 'r_ess_dc', closed: `${V.battR} == 1`, coil: contactor },
      // ---- emergency / flight instrument buses
      { id: 'emer_l', a: 'l_ess_dc', b: 'emer_dc', kind: 'diode', closed: 1 },
      { id: 'emer_r', a: 'r_ess_dc', b: 'emer_dc', kind: 'diode', closed: 1 },
      { id: 'ebatt_rly', a: 'ebatt', b: 'emer_dc', closed: V.ebattOn },
      { id: 'ebatt_chg', a: 'emer_dc', b: 'ebatt', kind: 'diode', closed: `${V.emerPwr} >= 1` },
      // ---- flight-control buses. The EBHA battery feeds only the 7 EBHA MCEs and the UPS battery only
      // FCC 1A / 2B and the BFCU (LUC electrical, dossier §4.1): the steering diodes feed the FCS buses
      // FROM the ESS DC buses, never back. The ideal-diode solver cannot open a diode that sits inside a
      // ring of conducting diodes (l_ess_dc -> fcc_ups <- r_ess_dc is no bridge), so each tie is also
      // gated on its ESS DC bus having a source of its own (battery relay, ESS TRU or AUX TRU
      // substitution) - with the main batteries OFF the FCS batteries then carry only their own buses.
      { id: 'ups_l', a: 'l_ess_dc', b: 'fcc_ups', kind: 'diode', closed: `${V.battL} == 1 || elec.l_ess_tru_online || ${V.auxSubst} == 1` },
      { id: 'ups_r', a: 'r_ess_dc', b: 'fcc_ups', kind: 'diode', closed: `${V.battR} == 1 || elec.r_ess_tru_online || ${V.auxSubst} == 2` },
      { id: 'ups_rly', a: 'ups_batt_bus', b: 'fcc_ups', closed: `${V.upsBatt} == 1` },
      { id: 'ebha_l', a: 'l_ess_dc', b: 'ebha', kind: 'diode', closed: `${V.battL} == 1 || elec.l_ess_tru_online || ${V.auxSubst} == 1` },
      { id: 'ebha_r', a: 'r_ess_dc', b: 'ebha', kind: 'diode', closed: `${V.battR} == 1 || elec.r_ess_tru_online || ${V.auxSubst} == 2` },
      { id: 'ebha_rly', a: 'ebha_batt_bus', b: 'ebha', closed: `${V.ebhaBatt} == 1` },
      // ---- ground service bus (LUC: R MAIN DC > R MAIN BATT)
      { id: 'gsb_main', a: 'r_main_dc', b: 'gsb', closed: `${V.gsb} == 1` },
      { id: 'gsb_batt', a: 'r_batt_bus', b: 'gsb', kind: 'diode', closed: `${V.gsb} == 1 && !elec.r_main_dc_powered` },
    ],
    loads,
  });
}
