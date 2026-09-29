/**
 * G800 electrical power system. Public data are for the GVI (G650) architecture
 * the GVIII family retains (C450: "Gulfstream ... retained the basic [GV]
 * system on every airplane that has followed"); G800-specific ratings are not
 * published, so the GVI numbers are used and flagged.
 *
 * Sources (SCQ electrical; GVI limitations; systems-power doc G650 recipe):
 *  - Two engine IDGs, 40 kVA, 3-phase 115/200 VAC, 400 Hz.
 *  - APU generator 40 kVA (100 % load SL-45,000 ft), comes on line at 99 % APU speed.
 *  - RAT 30 kVA, minimum 160 KCAS, manual deployment only (handle/cable); powers
 *    the L ESS DC, R ESS DC and EMER AC buses (GVI limitations).
 *  - Buses: L/R MAIN AC, ESS AC, EMER AC; L/R MAIN DC, L/R ESS DC; ground
 *    service; five TRUs (GV family: L/R MAIN, L/R ESS, AUX; 250 A, 26-29 V unregulated, C450).
 *  - Two 24 V 53 Ah NiCd main batteries (minimum preflight 20 V, charging above 22 V with AC).
 *  - Emergency batteries: ARMED when an ESS DC bus drops below 20 VDC (even
 *    momentarily); up to 45 min (EMER PWR switch OFF/ARM).
 *  - UPS: single 24 V 10.5 Ah lithium battery for flight-critical loads (FCCs).
 *  - Load shed inhibited on the ground, available in flight; all transfers
 *    no-break except external AC <-> APU (SCOPE: the solver has no transfer gap).
 *
 * Topology (EST where not described above):
 *   IDG1 -> [GCB1] -> L MAIN AC <-[AC TIE]-> R MAIN AC <- [GCB2] <- IDG2
 *   APU GEN -> [APB L / APB R] ; GPU -> [EPC L / EPC R]      (priority: onside IDG > APU > GPU > cross-tie)
 *   L MAIN AC -> L ESS AC (alternate from R MAIN AC); R likewise
 *   L ESS AC -> EMER AC (normal); RAT -> EMER AC -> both ESS AC buses (RAT mode)
 *   TRUs: L/R MAIN (switchable), L/R ESS, EMER (the "AUX" TRU of the GV family)
 *   L BATT <-(BATT sw)-> L ESS DC ; R BATT <-> R ESS DC ; MAIN DC -> ESS DC (diodes)
 *   L/R ESS DC -> EMER DC (diodes) ; EMER DC -> UPS bus (diode, charges the UPS battery)
 *   E-BATT FWD pair -> L ESS DC, E-BATT AFT pair -> R ESS DC (diodes) while that pair's EMER PWR
 *   latch is set (logic.ts; two independent pairs, code450 G700/G800 electrical; fix round 1 F08)
 * Load currents are EST typical values for each equipment class.
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { ElectricalNetwork, BATTERY_G650_NICD, type LoadDef } from '../../../systems/electrical';
import { G800_LIMITS } from '../data';
import { G800_VARS as V } from '../vars';

export const pw = (load: string): string => `elec.${load}_powered`;

/** Source-selection codes written by the logic: 0 none, 1 onside IDG, 2 APU, 3 GPU. */
export const AC_SRC = { none: 0, idg: 1, apu: 2, gpu: 3 } as const;
export const L_AC_SRC = 'ac.g800.l_ac_src';
export const R_AC_SRC = 'ac.g800.r_ac_src';

export function createElectrical(ctx: Pick<SimContext, 'vars'>): ElectricalNetwork {
  const dc = (id: string, bus: string, amps: LoadDef['amps'], cbA = 5, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, amps, cb: { name: id, ratingA: cbA }, ...extra });
  const ac = (id: string, bus: string, va: LoadDef['va'], cbA = 10, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, va, cb: { name: id, ratingA: cbA }, ...extra });
  const singleSourceInFlight = `gear.air_ground == 0 && (elec.idg1_online + elec.idg2_online + elec.apu_gen_online) < 2`;
  const loads: LoadDef[] = [
    // ---------------- L ESS DC: pilot-side flight-critical avionics
    dc('du1', 'l_ess_dc', 5.5, 10), // DU-1310 14 in LCD ~150 W (EST)
    dc('tsc1', 'l_ess_dc', 1.4, 5), // outboard left touch screen controller
    dc('tsc2', 'l_ess_dc', 1.4, 5), // pedestal left TSC
    dc('sfd1', 'l_ess_dc', 0.8, 3), // ESIS-5000 touch standby display
    dc('ohpts1', 'l_ess_dc', 1.2, 5),
    dc('gp', 'l_ess_dc', 1.0, 5), // GP-700 guidance panel (also fed from R ESS through its own diode: 'gp_r')
    dc('ccd1', 'l_ess_dc', 0.3, 3),
    dc('adc1', 'l_ess_dc', 0.9, 3),
    dc('irs1', 'l_ess_dc', 1.8, 5), // Laseref-class IRU (EST DC input)
    dc('ra1', 'l_ess_dc', 0.8, 3),
    dc('radio1', 'l_ess_dc', 2.5, 5), // NAV/COM 1, marker, ADF
    dc('xpdr1', 'l_ess_dc', 1.4, 5),
    dc('afcs', 'l_ess_dc', 'ap.engaged * 3 + 1', 7.5), // guidance computer + servo power (FCC coupling)
    dc('fadec_l_aux', 'l_ess_dc', 0.6, 3), // FADEC aircraft power (engine PMA powers it above ~10 % HP)
    dc('ign_l', 'l_ess_dc', '7 * eng1.ignition', 7.5),
    dc('fire_det', 'l_ess_dc', 0.5, 3), // SCQ fire: detection powered through the essential DC buses
    dc('stall_warn', 'l_ess_dc', 0.4, 3),
    dc('gear_ctl', 'l_ess_dc', '0.6 + 2 * gear.moving', 5), // LGCU (electrically controlled, hydraulically actuated)
    dc('brake_ctl_l', 'l_ess_dc', 1.5, 5), // brake-by-wire (inboard)
    dc('nws_ctl', 'l_ess_dc', 1.0, 5), // steer-by-wire
    dc('flap_ctl', 'l_ess_dc', '0.5 + 1.5 * flaps.moving', 5), // electrically controlled, hydraulically powered flaps (SCQ)
    dc('egpws', 'l_ess_dc', 1.0, 3),
    dc('cas_l', 'l_ess_dc', 0.5, 3), // CAS / DCN node
    dc('apu_ecu', 'l_ess_dc', `0.8 + 1.5 * (${V.apuMaster}) + fuel.apu_pump_amps`, 5),
    dc('apu_starter', 'l_ess_dc', 'apu.starter_amps', 400), // RE220 electric starter (battery start, GVI)
    dc('pack_ctl_l', 'l_ess_dc', 0.5, 3),
    dc('press_ctl', 'l_ess_dc', 0.8, 3),
    // ---------------- R ESS DC: copilot-side
    dc('du4', 'r_ess_dc', 5.5, 10),
    dc('tsc4', 'r_ess_dc', 1.4, 5),
    dc('tsc3', 'r_ess_dc', 1.4, 5),
    dc('sfd2', 'r_ess_dc', 0.8, 3),
    dc('ohpts3', 'r_ess_dc', 1.2, 5),
    dc('gp_r', 'r_ess_dc', 0.2, 3),
    dc('ccd2', 'r_ess_dc', 0.3, 3),
    dc('adc2', 'r_ess_dc', 0.9, 3),
    dc('irs2', 'r_ess_dc', 1.8, 5),
    dc('ra2', 'r_ess_dc', 0.8, 3),
    dc('radio2', 'r_ess_dc', 2.5, 5),
    dc('xpdr2', 'r_ess_dc', 1.4, 5),
    dc('tcas', 'r_ess_dc', 2.0, 5),
    dc('fadec_r_aux', 'r_ess_dc', 0.6, 3),
    dc('ign_r', 'r_ess_dc', '7 * eng2.ignition', 7.5),
    dc('brake_ctl_r', 'r_ess_dc', 1.5, 5), // outboard
    dc('cas_r', 'r_ess_dc', 0.5, 3),
    dc('pack_ctl_r', 'r_ess_dc', 0.5, 3),
    dc('oxy_ctl', 'r_ess_dc', 0.3, 3),
    dc('trim_ctl', 'r_ess_dc', '0.3 + 2 * (trim.roll_in_motion + trim.yaw_in_motion)', 5),
    // ---------------- L / R MAIN DC
    dc('du2', 'l_main_dc', 5.5, 10),
    dc('ohpts2', 'l_main_dc', 1.2, 5),
    dc('boost_l', 'l_ess_dc', 'fuel.boost_l_amps', 20), // EST: main boost pumps on the essential buses (flight critical)
    dc('alt_pump_l', 'l_main_dc', 'fuel.alt_l_amps', 15),
    dc('radar', 'l_main_dc', 4.0, 7.5),
    dc('fms', 'l_main_dc', 1.5, 5),
    // VHF 3 / HF 1 / HF 2 transceivers and the PA amplifier (function fix round 1; EST buses and currents: non-essential
    // radios on the main DC buses; transmit current while keyed from systems/audio.ts).
    dc('com3', 'r_main_dc', `1.0 + 5 * ${V.comTx(3)}`, 5),
    dc('hf1', 'l_main_dc', `1.5 + 20 * ac.g800.hf1_tx`, 25),
    dc('hf2', 'r_main_dc', `1.5 + 20 * ac.g800.hf2_tx`, 25),
    dc('pa', 'l_main_dc', `1.0 + 4 * ${V.paTx}`, 5), // PA amplifier draws while keyed (EST 4 A audio power; fix F07)
    dc('ice_det', 'l_main_dc', 0.6, 3),
    dc('panel_lts', 'l_main_dc', `4 * ${V.ltPanel} + 3 * ${V.ltFlood} + 1.5 * ${V.ltDome} + 2 * ${V.stormLt}`, 10, { model: 'resistive' }),
    dc('ext_nav', 'l_main_dc', 2.0, 5, { enabled: V.ltNav, model: 'resistive' }),
    dc('ext_beacon', 'l_main_dc', 1.5, 5, { enabled: V.ltBeacon }),
    dc('ext_ldg_l', 'l_main_dc', 6.0, 10, { enabled: V.ltLandingL }),
    dc('ext_taxi', 'l_main_dc', 4.0, 7.5, { enabled: V.ltTaxi }),
    dc('ext_wing', 'l_main_dc', 2.0, 5, { enabled: V.ltWing }),
    dc('hud_l', 'l_main_dc', 3.0, 7.5),
    dc('du3', 'r_main_dc', 5.5, 10),
    dc('boost_r', 'r_ess_dc', 'fuel.boost_r_amps', 20),
    dc('alt_pump_r', 'r_main_dc', 'fuel.alt_r_amps', 15),
    dc('evs', 'r_main_dc', 2.5, 5),
    dc('ext_strobe', 'r_main_dc', 4.0, 7.5, { enabled: V.ltStrobe }),
    dc('ext_ldg_r', 'r_main_dc', 6.0, 10, { enabled: V.ltLandingR }),
    dc('ext_recog', 'r_main_dc', 3.0, 5, { enabled: V.ltRecog }),
    dc('ext_logo', 'r_main_dc', 2.0, 5, { enabled: V.ltLogo }),
    dc('cabin_signs', 'r_main_dc', `0.5 * (${V.ltSeatbelt} + ${V.ltNoSmoke})`, 3),
    dc('hud_r', 'r_main_dc', 3.0, 7.5),
    // ---------------- EMER DC / UPS
    dc('adc3', 'emer_dc', 0.8, 3), // standby air data
    dc('irs3', 'emer_dc', 1.8, 5), // third IRS (standby attitude source)
    dc('emer_lts', 'emer_dc', `3 * ac.g800.emer_lts_on`, 5),
    dc('fcc', 'ups', 3.5, 7.5), // flight control computers (two dual-channel FCCs), UPS-backed (SCQ)
    dc('bfcu', 'ups', 0.8, 3), // backup flight control unit
    // ---------------- AC loads
    ac('galley', 'l_main_ac', 7500, 40, { enabled: V.galleyMaster, shed: singleSourceInFlight }),
    ac('cabin_l', 'l_main_ac', 2500, 20, { enabled: V.cabinMaster }),
    ac('cabin_r', 'r_main_ac', 2500, 20, { enabled: V.cabinMaster, shed: singleSourceInFlight }),
    ac('wshld_l', 'l_main_ac', 2200, 20, { enabled: 'ac.g800.wshld_l_on', model: 'resistive' }), // windshield heat (AC, EST 2.2 kVA)
    ac('wshld_r', 'r_main_ac', 2200, 20, { enabled: 'ac.g800.wshld_r_on', model: 'resistive' }),
    ac('cabin_wdo', 'r_main_ac', 900, 10, { enabled: V.cabinWdoHeat, model: 'resistive' }),
    ac('evs_wdo', 'r_main_ac', 250, 5, { enabled: V.evsWdoHeat, model: 'resistive' }),
    ac('aux_hyd', 'r_main_ac', 'hyd.aux_va', 40), // AUX hydraulic pump (AC motor)
    ac('probes_l', 'l_ess_ac', `900 * ${V.probeHeatOn}`, 10, { model: 'resistive' }), // pitot / AOA / TAT probe heat
    ac('probes_r', 'r_ess_ac', `900 * ${V.probeHeatOn}`, 10, { model: 'resistive' }),
    ac('pack_fans', 'emer_ac', `300 * (${V.packOn(1)} + ${V.packOn(2)})`, 10),
  ];
  const coil = { pickupV: 15, dropoutV: 7 }; // MIL-PRF-6106 28 V-class contactor: pull-in 15 V max, drop-out EST
  const genSw = (sw: string) => `${sw} == 1`;
  return new ElectricalNetwork(ctx.vars, {
    buses: [
      { id: 'idg1_out', type: 'ac' }, { id: 'idg2_out', type: 'ac' }, { id: 'apu_out', type: 'ac' }, { id: 'gpu_out', type: 'ac' }, { id: 'rat_out', type: 'ac' },
      { id: 'l_main_ac', type: 'ac' }, { id: 'r_main_ac', type: 'ac' }, { id: 'l_ess_ac', type: 'ac' }, { id: 'r_ess_ac', type: 'ac' }, { id: 'emer_ac', type: 'ac' },
      { id: 'l_main_dc' }, { id: 'r_main_dc' }, { id: 'l_ess_dc' }, { id: 'r_ess_dc' }, { id: 'emer_dc' },
      { id: 'batt_l_bus' }, { id: 'batt_r_bus' }, { id: 'ups' }, { id: 'ups_batt_bus' }, { id: 'ebatt_fwd_bus' }, { id: 'ebatt_aft_bus' },
    ],
    batteries: [
      { id: 'batt_l', bus: 'batt_l_bus', ...BATTERY_G650_NICD, ambientC: 'fdm.sat_c' },
      { id: 'batt_r', bus: 'batt_r_bus', ...BATTERY_G650_NICD, ambientC: 'fdm.sat_c' },
      // SCQ: UPS single 24 V 10.5 Ah lithium (7 Li-ion cells EST), internal resistance EST 30 mOhm.
      { id: 'ups_batt', bus: 'ups_batt_bus', chemistry: 'li-ion', cells: 7, capacityAh: G800_LIMITS.upsBattAh, internalResistanceOhm: 0.03, ambientC: 20 },
      // code450 G700/G800 electrical: four 24 V 9 Ah emergency batteries in TWO INDEPENDENT PAIRS (forward
      // and aft), each pair with its own "Fwd/Aft Emer Battery On" advisory. Each pair is modelled as one
      // 9 Ah string (fix round 1 F08; EST NiCd chemistry, EST pairing of the two units within a pair).
      { id: 'ebatt_fwd', bus: 'ebatt_fwd_bus', chemistry: 'nicd', cells: 20, capacityAh: 9, internalResistanceOhm: 0.03, ambientC: 20 },
      { id: 'ebatt_aft', bus: 'ebatt_aft_bus', chemistry: 'nicd', cells: 20, capacityAh: 9, internalResistanceOhm: 0.03, ambientC: 20 },
    ],
    acGenerators: [
      { id: 'idg1', bus: 'idg1_out', ratedKva: G800_LIMITS.idgKva, frequency: 400, drive: ENG.n2(1), minDrive: 50, switch: genSw(V.genL), reset: `${V.genL} == 0 || ac.g800.elec_reset_pulse` },
      { id: 'idg2', bus: 'idg2_out', ratedKva: G800_LIMITS.idgKva, frequency: 400, drive: ENG.n2(2), minDrive: 50, switch: genSw(V.genR), reset: `${V.genR} == 0 || ac.g800.elec_reset_pulse` },
      // SCQ: APU generator on line at 99 % speed; 40 kVA to 45,000 ft (GVI).
      { id: 'apu_gen', bus: 'apu_out', ratedKva: G800_LIMITS.apuGenKva, frequency: 400, drive: 'apu.gen_drive', minDrive: 99, switch: genSw(V.apuGen) },
      // SCQ: RAT 30 kVA, min 160 KCAS; drive = deployed x IAS (logic.ts).
      { id: 'rat', bus: 'rat_out', ratedKva: G800_LIMITS.ratKva, frequency: 400, drive: V.ratSpeed, minDrive: G800_LIMITS.vRatMinKt },
    ],
    externals: [{ id: 'gpu', bus: 'gpu_out', type: 'ac', available: V.gpuAvail, switch: `${V.gpu} == 1`, ratedKva: 90 }],
    trus: [
      { id: 'l_main_tru', acBus: 'l_main_ac', dcBus: 'l_main_dc', ratedA: G800_LIMITS.truRatedA, enabled: `${V.lMainTru} == 1` },
      { id: 'r_main_tru', acBus: 'r_main_ac', dcBus: 'r_main_dc', ratedA: G800_LIMITS.truRatedA, enabled: `${V.rMainTru} == 1` },
      { id: 'l_ess_tru', acBus: 'l_ess_ac', dcBus: 'l_ess_dc', ratedA: G800_LIMITS.truRatedA },
      { id: 'r_ess_tru', acBus: 'r_ess_ac', dcBus: 'r_ess_dc', ratedA: G800_LIMITS.truRatedA },
      { id: 'emer_tru', acBus: 'emer_ac', dcBus: 'emer_dc', ratedA: 100 }, // EST
    ],
    links: [
      // ---- AC source contactors (commands from logic.ts: priority onside IDG > APU > GPU)
      { id: 'gcb1', a: 'idg1_out', b: 'l_main_ac', closed: `${L_AC_SRC} == 1` },
      { id: 'gcb2', a: 'idg2_out', b: 'r_main_ac', closed: `${R_AC_SRC} == 1` },
      { id: 'apb_l', a: 'apu_out', b: 'l_main_ac', closed: `${L_AC_SRC} == 2` },
      { id: 'apb_r', a: 'apu_out', b: 'r_main_ac', closed: `${R_AC_SRC} == 2` },
      { id: 'epc_l', a: 'gpu_out', b: 'l_main_ac', closed: `${L_AC_SRC} == 3` },
      { id: 'epc_r', a: 'gpu_out', b: 'r_main_ac', closed: `${R_AC_SRC} == 3` },
      { id: 'ac_tie', a: 'l_main_ac', b: 'r_main_ac', closed: `${V.busTieCmd} && !fail.elec.ac_tie` },
      // ---- essential / emergency AC
      { id: 'l_ess_ac_n', a: 'l_main_ac', b: 'l_ess_ac', closed: '!ac.g800.rat_mode && elec.l_main_ac_powered' },
      { id: 'l_ess_ac_x', a: 'r_main_ac', b: 'l_ess_ac', closed: '!ac.g800.rat_mode && !elec.l_main_ac_powered && elec.r_main_ac_powered' },
      { id: 'r_ess_ac_n', a: 'r_main_ac', b: 'r_ess_ac', closed: '!ac.g800.rat_mode && elec.r_main_ac_powered' },
      { id: 'r_ess_ac_x', a: 'l_main_ac', b: 'r_ess_ac', closed: '!ac.g800.rat_mode && !elec.r_main_ac_powered && elec.l_main_ac_powered' },
      { id: 'emer_ac_n', a: 'l_ess_ac', b: 'emer_ac', closed: '!ac.g800.rat_mode' },
      { id: 'rat_ctc', a: 'rat_out', b: 'emer_ac', closed: 'ac.g800.rat_mode' },
      { id: 'l_ess_ac_rat', a: 'emer_ac', b: 'l_ess_ac', closed: 'ac.g800.rat_mode' },
      { id: 'r_ess_ac_rat', a: 'emer_ac', b: 'r_ess_ac', closed: 'ac.g800.rat_mode' },
      // ---- DC
      { id: 'dc_tie', a: 'l_main_dc', b: 'r_main_dc', closed: `ac.g800.bus_tie_auto == 1 && (!elec.l_main_tru_online != !elec.r_main_tru_online)` },
      { id: 'l_main_ess', a: 'l_main_dc', b: 'l_ess_dc', kind: 'diode' },
      { id: 'r_main_ess', a: 'r_main_dc', b: 'r_ess_dc', kind: 'diode' },
      { id: 'batt_l_ctc', a: 'batt_l_bus', b: 'l_ess_dc', closed: `${V.battL} == 1`, coil },
      { id: 'batt_r_ctc', a: 'batt_r_bus', b: 'r_ess_dc', closed: `${V.battR} == 1`, coil },
      { id: 'l_ess_emer', a: 'l_ess_dc', b: 'emer_dc', kind: 'diode' },
      { id: 'r_ess_emer', a: 'r_ess_dc', b: 'emer_dc', kind: 'diode' },
      { id: 'emer_ups', a: 'emer_dc', b: 'ups', kind: 'diode' },
      // BATTERIES FCS UPS switchlight (code450 G700/G800 electrical): connects the UPS battery to the FCC UPS bus.
      { id: 'ups_batt_ctc', a: 'ups_batt_bus', b: 'ups', closed: `${V.fcsBattUps} == 1` },
      // Two independent pairs (F08): the FWD pair feeds the L ESS DC bus, the AFT pair the R ESS DC bus,
      // each on its own contactor state (logic.ts latches them per pair; EST bus assignment).
      { id: 'ebatt_fwd_ctc', a: 'ebatt_fwd_bus', b: 'l_ess_dc', kind: 'diode', closed: V.ebattFwdOn },
      { id: 'ebatt_aft_ctc', a: 'ebatt_aft_bus', b: 'r_ess_dc', kind: 'diode', closed: V.ebattAftOn },
      // E-batt pairs are kept charged from their onside ESS DC bus through a charging diode (EST).
      { id: 'ebatt_fwd_chg', a: 'l_ess_dc', b: 'ebatt_fwd_bus', kind: 'diode', closed: 'elec.l_ess_tru_online' },
      { id: 'ebatt_aft_chg', a: 'r_ess_dc', b: 'ebatt_aft_bus', kind: 'diode', closed: 'elec.r_ess_tru_online' },
    ],
    loads,
  });
}
