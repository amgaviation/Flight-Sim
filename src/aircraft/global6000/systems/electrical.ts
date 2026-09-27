/**
 * Bombardier Global 6000 electrical power generation and distribution
 * (EPGDS). Source: GXEL (Global Express training manual "Electrical"),
 * GX_01_018 (overhead ELECTRICAL panel).
 *
 * AC generation (115 V, never paralleled):
 *   GEN 1 + GEN 2 on the left engine, GEN 3 + GEN 4 on the right engine: four
 *   40 kVA variable-frequency generators (324-596 Hz, frequency ~ N2); APU GEN
 *   40 kVA 400 Hz; EXT AC (aft left fairing receptacle); RAT GEN 9 kVA 400 Hz
 *   (AC ESS only, shed below ~147 KIAS in favour of the RAT hydraulic pump).
 *   Bus priorities (GXEL, generator transfer contactors):
 *     AC BUS 1   GEN 1, GEN 4, GEN 3, GEN 2, APU GEN
 *     AC BUS 2   GEN 2, GEN 3, GEN 4, APU GEN
 *     AC BUS 3   GEN 3, GEN 2, GEN 1, APU GEN
 *     AC BUS 4   GEN 4, GEN 1, GEN 2, GEN 3, APU GEN
 *     AC ESS     RAT GEN (deployed and ON), GEN 4, GEN 1, GEN 2, GEN 3, APU GEN
 *   External AC powers all buses when selected ON (EST: lowest priority, so a
 *   running generator takes over; the EXT AC ON light stays lit, GXEL).
 *   AC BUS 2 and 3 are shed during single-generator operation (AC 1 / 4 have
 *   priority). Each bus can be isolated from the EMS CDU (EMER CNTL, MAN OFF).
 * DC (28 V): four 150 A TRUs; TRU 1 <- AC BUS 1, ESS TRU 1 <- AC BUS 2, TRU 2
 *   <- AC BUS 3 (EST mapping of the "own AC bus feeder" 1A / 2A / 3A),
 *   ESS TRU 2 <- AC ESS. DC bus priorities (GXEL, TRU transfer contactors):
 *     DC BUS 1   TRU 1, ESS TRU 1
 *     DC ESS     ESS TRU 1, ESS TRU 2, TRU 2, TRU 1
 *     BATT BUS   ESS TRU 2, ESS TRU 1, TRU 2, TRU 1
 *     DC BUS 2   TRU 2, ESS TRU 2
 *   DC BUS 1 and 2 are shed with a single TRU. The emergency tie contactor
 *   joins DC ESS and BATT BUS when either has lost its TRU. DC PWR EMER OVRD
 *   (pedestal) connects ESS TRU 1 / 2 straight to the DC ESS / BATT BUS
 *   loads when the DC power center (DCPC) has failed.
 * Batteries: AV BATT 24 V 25 Ah NiCd on the AV BATT DIR bus, APU BATT 25.2 V
 *   42 Ah NiCd on the APU BATT DIR bus (APU start via the ASCA); BATT MASTER
 *   connects both to the BATT BUS (and through the ETC to DC ESS) for >= 15
 *   min of emergency power; the DC EMER bus is hot from both battery direct
 *   buses. EXT DC feeds the APU BATT DIR bus (APU start on a weak battery).
 * SCOPE: the battery chargers (AC 2 / AC 3, GXEL) are modelled as the
 *   batteries floating on the BATT BUS through the BATT MASTER contactors;
 *   circuit breakers are the network's `cb.<load>` breakers (the real
 *   aircraft has SSPCs managed from the EMS CDU); loads are EST currents per
 *   equipment class.
 */
import type { SimContext } from '../../../core/SimContext';
import { ElectricalNetwork, SourceSelector, type LoadDef } from '../../../systems/electrical';
import type { Subsystem } from '../../types';
import { G6K_LIMITS } from '../data';
import { G6K_VARS as V } from '../vars';

export const pw = (load: string): string => `elec.${load}_powered`;

/** VFG frequency vs N2 (GXEL: 324-596 Hz; EST proportional to N2, 596 Hz at 100 %). */
const VFG_HZ = { x: [0, 100], y: [0, 596] };

interface BusSpec {
  id: string;
  bus: string;
  sources: { out: string; avail: string }[];
}

export interface G6kElectrical {
  net: ElectricalNetwork;
  selectors: SourceSelector[];
  /** Runs the selectors and the network once (applyState / settle). */
  settle(): void;
}

export function createElectrical(ctx: Pick<SimContext, 'vars'>): G6kElectrical {
  const v = ctx.vars;
  const dc = (id: string, bus: string, amps: LoadDef['amps'], cbA = 5, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, amps, cb: { name: id, ratingA: cbA }, ...extra });
  const ACMP_CB_A = 105;
  const ac = (id: string, bus: string, va: LoadDef['va'], cbA = 10, extra: Partial<LoadDef> = {}): LoadDef => ({ id, bus, va, cb: { name: id, ratingA: cbA }, ...extra });

  // ---------------------------------------------------------------- bus power control (priority selectors)
  const g = (n: number) => `elec.gen${n}_online`;
  const apu = 'elec.apu_gen_online';
  const ext = `elec.ext_ac_online`;
  const notSingle = `!${V.singleGen}`;
  const isolAc = (n: 1 | 2 | 3 | 4) => `!${V.acBusIsol(n)}`;
  const acSpecs: BusSpec[] = [
    { id: 'acb1', bus: 'ac_bus1', sources: [1, 4, 3, 2].map((n) => ({ out: `gen${n}_out`, avail: `${g(n)} && ${isolAc(1)}` })) },
    { id: 'acb2', bus: 'ac_bus2', sources: [2, 3, 4].map((n) => ({ out: `gen${n}_out`, avail: `${g(n)} && ${notSingle} && ${isolAc(2)}` })) },
    { id: 'acb3', bus: 'ac_bus3', sources: [3, 2, 1].map((n) => ({ out: `gen${n}_out`, avail: `${g(n)} && ${notSingle} && ${isolAc(3)}` })) },
    { id: 'acb4', bus: 'ac_bus4', sources: [4, 1, 2, 3].map((n) => ({ out: `gen${n}_out`, avail: `${g(n)} && ${isolAc(4)}` })) },
    {
      id: 'acess',
      bus: 'ac_ess',
      sources: [{ out: 'rat_out', avail: `elec.rat_gen_online && ${V.ratGen} == 1` }, ...[4, 1, 2, 3].map((n) => ({ out: `gen${n}_out`, avail: g(n) }))],
    },
  ];
  for (const s of acSpecs) {
    const shed = s.id === 'acb2' || s.id === 'acb3';
    const isol = s.id === 'acess' ? '1' : isolAc(Number(s.id.slice(3)) as 1 | 2 | 3 | 4);
    s.sources.push({ out: 'apu_gen_out', avail: `${apu} && ${shed ? notSingle : '1'} && ${isol}` });
    s.sources.push({ out: 'ext_ac_out', avail: `${ext} && ${isol}` });
  }
  const t = (id: string) => `elec.${id}_online`;
  const notSingleTru = `!${V.singleTru}`;
  const dcpcOk = `!${V.dcpcFail}`;
  const isolDc = (b: 'dc_bus1' | 'dc_bus2' | 'dc_ess' | 'batt_bus') => `!${V.dcBusIsol(b)}`;
  const dcSpecs: BusSpec[] = [
    { id: 'dcb1', bus: 'dc_bus1', sources: ['tru1', 'ess_tru1'].map((x) => ({ out: `${x}_out`, avail: `${t(x)} && ${notSingleTru} && ${dcpcOk} && ${isolDc('dc_bus1')}` })) },
    { id: 'dcess', bus: 'dc_ess', sources: ['ess_tru1', 'ess_tru2', 'tru2', 'tru1'].map((x) => ({ out: `${x}_out`, avail: `${t(x)} && ${dcpcOk} && ${isolDc('dc_ess')}` })) },
    { id: 'battbus', bus: 'batt_bus', sources: ['ess_tru2', 'ess_tru1', 'tru2', 'tru1'].map((x) => ({ out: `${x}_out`, avail: `${t(x)} && ${dcpcOk} && ${isolDc('batt_bus')}` })) },
    { id: 'dcb2', bus: 'dc_bus2', sources: ['tru2', 'ess_tru2'].map((x) => ({ out: `${x}_out`, avail: `${t(x)} && ${notSingleTru} && ${dcpcOk} && ${isolDc('dc_bus2')}` })) },
  ];
  const selectors: SourceSelector[] = [...acSpecs, ...dcSpecs].map(
    (s) => new SourceSelector(v, { id: s.id, mode: 'priority', sources: s.sources.map((x) => ({ name: x.out, available: x.avail })) }),
  );
  const links = [...acSpecs, ...dcSpecs].flatMap((s) =>
    s.sources.map((x, k) => ({ id: `${s.id}_${x.out}`, a: x.out, b: s.bus, closed: `elec.${s.id}_src == ${k + 1}` })),
  );

  // ---------------------------------------------------------------- loads
  const airborne = 'gear.air_ground == 0';
  const loads: LoadDef[] = [
    // ------------------------------------------------ DC ESS (pilot-side flight essential)
    dc('afd1', 'dc_ess', 7, 15), // AFD 1 pilot PFD (15.1 in LCD ~190 W EST)
    dc('ctp1', 'dc_ess', 0.8, 3),
    dc('ccp1', 'dc_ess', 0.3, 3),
    dc('mkp1', 'dc_ess', 0.3, 3),
    dc('fcp', 'dc_ess', 1.2, 5), // flight control panel (dual channel, EST single feed)
    dc('adc1', 'dc_ess', 0.8, 3),
    dc('irs1', 'dc_ess', 1.5, 5), // Laseref IRS 1 (EST 28 V DC feed)
    dc('afcs1', 'dc_ess', 'ap.engaged * 2 + 1.2', 5), // AFCS channel 1 (servos EST)
    dc('fadec1', 'dc_ess', 1.0, 5), // EEC channel power until the PMA takes over (EST)
    dc('ign1', 'dc_ess', '4 * eng1.ignition', 7.5),
    dc('start_valve1', 'dc_ess', '0.6 * pneu.start1_valve_open', 3),
    dc('aux_pump_l', 'dc_ess', 'fuel.aux_l_amps', 20), // GXFU: left DC AUX pump on the DC ESS bus
    dc('sfcu1', 'dc_ess', '0.8 + 15 * flaps.moving + 10 * slats.transit', 30), // slat/flap control unit 1 + PDU motors (DC)
    dc('fcu1', 'dc_ess', 1.5, 5), // flight control unit 1 (spoilers, stab trim, pitch feel, RTL)
    dc('stab_trim1', 'dc_ess', '0.5 + 12 * trim.pitch_in_motion', 20), // stab trim channel 1 (MDU motor)
    dc('lgecu_a', 'dc_ess', '0.6 + 1.5 * gear.moving', 5),
    dc('bcu_a', 'dc_ess', 1.2, 5), // brake control unit channel A (GXLG CB "BRAKE CTL CH A DC 1"; EST DC ESS)
    dc('nws1', 'dc_ess', 0.8, 3),
    dc('spc', 'dc_ess', 0.6, 3), // stall protection computer (dual channel, EST)
    dc('fideex_a', 'dc_ess', 0.4, 3),
    dc('fuel_cmptr_a', 'dc_ess', 0.6, 3),
    dc('bmc1', 'dc_ess', 0.6, 3), // IAMS bleed management computer 1
    dc('cpc1', 'dc_ess', 0.6, 3), // cabin pressure controller 1
    dc('com1', 'dc_ess', '1 + 4 * (com1.tx ?? 0)', 5),
    dc('nav1', 'dc_ess', 1.0, 3),
    dc('gps1', 'dc_ess', 0.8, 3),
    dc('iac1', 'dc_ess', 3.0, 7.5), // integrated avionics computer / DAU 1 (EST)
    dc('ice_det', 'dc_ess', 0.5, 3),
    dc('hbmu', 'dc_ess', 0.6, 3), // heater / brake temperature monitoring unit
    // ------------------------------------------------ BATT BUS (copilot-side essential)
    dc('afd4', 'batt_bus', 7, 15), // AFD 4 copilot PFD
    dc('ctp2', 'batt_bus', 0.8, 3),
    dc('adc2', 'batt_bus', 0.8, 3),
    dc('irs2', 'batt_bus', 1.5, 5),
    dc('afcs2', 'batt_bus', 'ap.engaged * 2 + 1.2', 5),
    dc('fadec2', 'batt_bus', 1.0, 5),
    dc('ign2', 'batt_bus', '4 * eng2.ignition', 7.5),
    dc('start_valve2', 'batt_bus', '0.6 * pneu.start2_valve_open', 3),
    dc('aux_pump_r', 'batt_bus', 'fuel.aux_r_amps', 20), // GXFU CB list: R AUX PUMP BATT
    dc('sfcu2', 'batt_bus', '0.8 + 15 * flaps.moving + 10 * slats.transit', 30),
    dc('fcu2', 'batt_bus', 1.5, 5),
    dc('stab_trim2', 'batt_bus', 0.5, 20),
    dc('lgecu_b', 'batt_bus', 0.6, 5),
    dc('bcu_b', 'batt_bus', 1.2, 5),
    dc('nws2', 'batt_bus', 0.8, 3),
    dc('fideex_b', 'batt_bus', 0.4, 3),
    dc('xfeed_valve', 'batt_bus', 0.3, 3), // GXFU: crossfeed SOV on the BATT bus
    dc('fuel_cmptr_b', 'batt_bus', 0.6, 3),
    dc('apu_fadec', 'batt_bus', `0.5 + 1.5 * (${V.apuSw} != 0)`, 5), // GXAPU CB: APU FADEC PWR on BATT
    dc('apu_door', 'batt_bus', 0.5, 3),
    dc('bmc2', 'batt_bus', 0.6, 3),
    dc('cpc2', 'batt_bus', 0.6, 3),
    dc('iac2', 'batt_bus', 3.0, 7.5),
    dc('com2', 'batt_bus', '1 + 4 * (com2.tx ?? 0)', 5),
    dc('ccp2', 'batt_bus', 0.3, 3),
    dc('mkp2', 'batt_bus', 0.3, 3),
    // ------------------------------------------------ DC BUS 1
    dc('afd2', 'dc_bus1', 7, 15), // AFD 2 upper centre (EICAS)
    dc('ra1', 'dc_bus1', 0.8, 3),
    dc('taws', 'dc_bus1', 1.0, 3),
    dc('radar', 'dc_bus1', 4.0, 7.5), // MultiScan (SPEC)
    dc('xpdr1', 'dc_bus1', 1.5, 5),
    dc('tcas', 'dc_bus1', 2.0, 5),
    dc('adf1', 'dc_bus1', 0.5, 3),
    dc('fms', 'dc_bus1', 1.5, 5),
    dc('ldg_lt_l', 'dc_bus1', 8, 15, { enabled: V.ltLdgL }), // wing landing light (EST 225 W)
    dc('ldg_lt_nose', 'dc_bus1', 16, 25, { enabled: `${V.ltLdgNose} && gear.pos0 > 0.95`, model: 'resistive' }), // 2 NLG sealed-beam lamps (GXLT)
    dc('taxi_lt', 'dc_bus1', 8, 15, { enabled: V.ltTaxi }),
    dc('nav_lts', 'dc_bus1', 3, 5, { enabled: V.ltNav }),
    dc('beacon', 'dc_bus1', 3, 5, { enabled: V.ltBeacon }),
    dc('logo', 'dc_bus1', 3, 5, { enabled: V.ltLogo }),
    dc('flood_lts', 'dc_bus1', `2 * (${V.ltFlood('l')} + ${V.ltFlood('c')} + ${V.ltFlood('r')})`, 7.5, { model: 'resistive' }),
    dc('integral_lts', 'dc_bus1', `1 * (${V.ltIntegral('l')} + ${V.ltIntegral('c')} + ${V.ltIntegral('r')} + ${V.ltIntegral('cb')} + ${V.ltIntegral('ovhd')})`, 7.5, { model: 'resistive' }),
    dc('hud', 'dc_bus1', `4 * ${V.hudPower}`, 7.5),
    // ------------------------------------------------ DC BUS 2
    dc('afd3', 'dc_bus2', 7, 15), // AFD 3 lower centre
    dc('ra2', 'dc_bus2', 0.8, 3),
    dc('irs3', 'dc_bus2', 1.5, 5),
    dc('xpdr2', 'dc_bus2', 1.5, 5),
    dc('adf2', 'dc_bus2', 0.5, 3),
    dc('nav2', 'dc_bus2', 1.0, 3),
    dc('gps2', 'dc_bus2', 0.8, 3),
    dc('com3', 'dc_bus2', 1.0, 3),
    dc('ldg_lt_r', 'dc_bus2', 8, 15, { enabled: V.ltLdgR }),
    dc('strobe', 'dc_bus2', 5, 7.5, { enabled: V.ltStrobe }),
    dc('wing_insp', 'dc_bus2', 3, 5, { enabled: V.ltWing }),
    dc('dome_map_lts', 'dc_bus2', `0.5 * ${V.ltDome} + 0.3 * (${V.ltMap(1)} + ${V.ltMap(2)})`, 5, { model: 'resistive' }),
    dc('cabin_dc', 'dc_bus2', 20, 40, { enabled: V.cabinPwr, shed: `${airborne} && ${V.singleGen}` }),
    dc('pass_signs', 'dc_bus2', 0.5, 3),
    // ------------------------------------------------ DC EMER (hot from both battery direct buses)
    dc('iesi', 'dc_emer', 1.5, 3), // integrated electronic standby instrument (standby ADC / AHRS)
    dc('eng_sov1', 'dc_emer', 0.3, 3), // GXFU CB: L ENG FUEL SOV DC EMER
    dc('eng_sov2', 'dc_emer', 0.3, 3),
    dc('apu_fire_sov', 'dc_emer', 0.3, 3), // GXFU CB: APU FIRE SOV DC EMER
    dc('fire_ext', 'dc_emer', 0.3, 5), // bottle squibs
    dc('emer_lts', 'dc_emer', `${V.emerLights} == 2 ? 3 : 0`, 5),
    dc('elt', 'dc_emer', `${V.elt} * 0.5`, 3),
    // ------------------------------------------------ APU BATT DIR (APU start contactor assembly)
    dc('apu_starter', 'apu_batt_dir', 'apu.starter_amps', 600), // GXAPU CB: APU START on the APU BATT
    // ------------------------------------------------ AC loads (VA)
    ac('pri_l1', 'ac_bus2', '700 * fuel.pri_l1_on', 10), // L FWD PRI pump (GXFU CB: AC 2)
    ac('pri_l2', 'ac_bus1', '700 * fuel.pri_l2_on', 10), // L AFT PRI pump (EST AC 1)
    ac('pri_r1', 'ac_bus3', '700 * fuel.pri_r1_on', 10), // R FWD PRI pump (GXFU CB: AC 3)
    ac('pri_r2', 'ac_bus4', '700 * fuel.pri_r2_on', 10), // R AFT PRI pump (GXFU CB: AC 4)
    ac('ctr_xfer1', 'ac_bus1', '700 * fuel.ctr_xfer1_active', 10), // L CTR XFER pump (EST AC 1)
    ac('ctr_xfer2', 'ac_bus4', '700 * fuel.ctr_xfer2_active', 10), // R CTR XFER pump (GXFU CB: AC 4)
    ac('aft_xfer1', 'ac_bus2', '500 * fuel.aft_xfer1_active', 10), // AFT TANK L PUMP (GXFU CB: AC 2)
    ac('aft_xfer2', 'ac_bus3', '500 * fuel.aft_xfer2_active', 10), // AFT TANK R PUMP (GXFU CB: AC 3)
    // EST: the ACMPs are 3-phase 115 V motors (~10 kVA at full 6.5 gpm / 3,000 psi, 75 % efficient). The network models AC loads
    // single-phase (I = VA / V), so each 3-phase 35 A breaker is carried as its single-phase equivalent 3 x 35 = 105 A.
    ac('acmp1b', 'ac_bus3', 'hyd.pump1b_va', ACMP_CB_A), // GXHY: ACMP 1B on AC BUS 3
    ac('acmp2b', 'ac_bus2', 'hyd.pump2b_va', ACMP_CB_A), // ACMP 2B on AC BUS 2
    ac('acmp3a', 'ac_bus4', 'hyd.pump3a_va', ACMP_CB_A), // ACMP 3A on AC BUS 4
    ac('acmp3b', 'ac_bus1', 'hyd.pump3b_va', ACMP_CB_A), // ACMP 3B on AC BUS 1
    ac('wshld_l', 'ac_bus1', `2500 * ${V.wshldOn('l')}`, 25), // L windshield (EST)
    ac('wshld_s', 'ac_bus2', `1500 * ${V.wshldOn('s')}`, 20), // side windows (EST)
    ac('wshld_r', 'ac_bus4', `2500 * ${V.wshldOn('r')}`, 25),
    ac('probe_heat', 'ac_ess', `1200 * ${V.probeHeat}`, 15), // pitot-static probes, AOA vanes, TAT (HBMU, EST)
    ac('recirc_fans', 'ac_bus3', `600 * ${V.recircFan}`, 10),
    ac('cabin_ac', 'ac_bus2', `6000 * (${V.cabinPwr} != 0)`, 60, { shed: `${airborne} && ${V.singleGen}` }), // galley / cabin (EST)
    ac('cabin_ac2', 'ac_bus3', `4000 * (${V.cabinPwr} != 0)`, 40, { shed: `${airborne} && ${V.singleGen}` }),
    ac('av_batt_chgr', 'ac_bus2', 150, 5), // GXEL: AV BATT charger on AC BUS 2
    ac('apu_batt_chgr', 'ac_bus3', 150, 5), // APU BATT charger on AC BUS 3
    ac('apu_oil_heat', 'ac_bus4', 100, 5), // GXAPU CB: APU OIL HEAT AC 4
    ac('avionics_fans', 'ac_ess', 300, 5),
  ];

  const contactor = { pickupV: 15, dropoutV: 7 }; // MIL-PRF-6106 28 V-class relay (pull-in 15 V max), drop-out EST
  const L = G6K_LIMITS;
  const net = new ElectricalNetwork(v, {
    buses: [
      ...['gen1_out', 'gen2_out', 'gen3_out', 'gen4_out', 'apu_gen_out', 'ext_ac_out', 'rat_out', 'ac_bus1', 'ac_bus2', 'ac_bus3', 'ac_bus4', 'ac_ess'].map((id) => ({ id, type: 'ac' as const })),
      ...['tru1_out', 'tru2_out', 'ess_tru1_out', 'ess_tru2_out', 'dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus', 'dc_emer', 'av_batt_dir', 'apu_batt_dir', 'ext_dc_out'].map((id) => ({ id })),
    ],
    batteries: [
      // GXEL: 24 V 25 Ah NiCd avionics battery; 25.2 V 42 Ah NiCd APU battery. EST internal resistance for the size.
      { id: 'av_batt', bus: 'av_batt_dir', chemistry: 'nicd', cells: 20, capacityAh: L.avBattAh, internalResistanceOhm: 0.035, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 25000, coolingWK: 8, overTempC: 71 } },
      { id: 'apu_batt', bus: 'apu_batt_dir', chemistry: 'nicd', cells: 21, capacityAh: L.apuBattAh, internalResistanceOhm: 0.022, ambientC: 'fdm.sat_c', thermal: { heatCapacityJK: 35000, coolingWK: 10, overTempC: 71 } },
    ],
    acGenerators: [
      // GXEL: VFG 40 kVA 115 V 324-596 Hz; GCU on line from ~idle (EST minimum drive 50 % N2, below the 58 % idle).
      { id: 'gen1', bus: 'gen1_out', ratedKva: L.vfgKva, frequency: VFG_HZ, drive: 'eng1.n2_pct', minDrive: 50, switch: `${V.gen(1)} == 1` },
      { id: 'gen2', bus: 'gen2_out', ratedKva: L.vfgKva, frequency: VFG_HZ, drive: 'eng1.n2_pct', minDrive: 50, switch: `${V.gen(2)} == 1` },
      { id: 'gen3', bus: 'gen3_out', ratedKva: L.vfgKva, frequency: VFG_HZ, drive: 'eng2.n2_pct', minDrive: 50, switch: `${V.gen(3)} == 1` },
      { id: 'gen4', bus: 'gen4_out', ratedKva: L.vfgKva, frequency: VFG_HZ, drive: 'eng2.n2_pct', minDrive: 50, switch: `${V.gen(4)} == 1` },
      // GXEL: APU generator 40 kVA 400 Hz (on line at APU on-speed).
      { id: 'apu_gen', bus: 'apu_gen_out', ratedKva: L.apuGenKva, drive: 'apu.gen_drive', minDrive: 95, switch: `${V.apuGen} == 1` },
      // GXEL: RAT GEN 9 kVA; the RAT GCU sheds the output at ~147 KIAS and below (priority to the RAT hydraulic pump).
      { id: 'rat_gen', bus: 'rat_out', ratedKva: L.ratGenKva, drive: V.ratDrive, minDrive: L.ratShedKias, switch: `${V.ratGen} == 1` },
    ],
    externals: [
      { id: 'ext_ac', bus: 'ext_ac_out', type: 'ac', available: V.extAcAvail, switch: `${V.extAc} == 1`, ratedKva: 60 }, // EST cart rating
      { id: 'ext_dc', bus: 'ext_dc_out', type: 'dc', available: V.extDcAvail, switch: `${V.extDc} == 1`, voltage: 28 },
    ],
    trus: [
      { id: 'tru1', acBus: 'ac_bus1', dcBus: 'tru1_out', ratedA: L.truRatedA },
      { id: 'ess_tru1', acBus: 'ac_bus2', dcBus: 'ess_tru1_out', ratedA: L.truRatedA },
      { id: 'tru2', acBus: 'ac_bus3', dcBus: 'tru2_out', ratedA: L.truRatedA },
      { id: 'ess_tru2', acBus: 'ac_ess', dcBus: 'ess_tru2_out', ratedA: L.truRatedA },
    ],
    links: [
      ...links,
      // ---- batteries: BATT MASTER contactors (APU start dips the whole battery bus, as in the aircraft)
      { id: 'bm_av', a: 'av_batt_dir', b: 'batt_bus', closed: `${V.battMaster} == 1`, coil: contactor },
      { id: 'bm_apu', a: 'apu_batt_dir', b: 'batt_bus', closed: `${V.battMaster} == 1`, coil: contactor },
      // ---- emergency tie contactor (ETC): DC ESS <-> BATT BUS when either has no TRU
      { id: 'etc', a: 'batt_bus', b: 'dc_ess', closed: 'elec.dcess_src == 0 || elec.battbus_src == 0' },
      // ---- DC EMER bus: hot from both battery direct buses and from the battery bus
      { id: 'emer_av', a: 'av_batt_dir', b: 'dc_emer', kind: 'diode', closed: 1 },
      { id: 'emer_apu', a: 'apu_batt_dir', b: 'dc_emer', kind: 'diode', closed: 1 },
      { id: 'emer_bb', a: 'batt_bus', b: 'dc_emer', kind: 'diode', closed: 1 },
      // ---- EXT DC -> APU BATT DIR (ASCA checks the power; BATT MASTER required, GXEL)
      { id: 'ext_dc_ctr', a: 'ext_dc_out', b: 'apu_batt_dir', closed: `${V.battMaster} == 1 && elec.ext_dc_online` },
      // ---- DC PWR EMER OVRD: ESS TRU 1 / 2 straight to the SPDAs
      { id: 'ovrd1', a: 'ess_tru1_out', b: 'dc_ess', closed: `${V.dcEmerOvrd} == 1` },
      { id: 'ovrd2', a: 'ess_tru2_out', b: 'batt_bus', closed: `${V.dcEmerOvrd} == 1` },
    ],
    loads,
  });

  const settle = (): void => {
    for (let k = 0; k < 4; k++) {
      for (const s of selectors) s.update(1 / 60);
      net.settle(8);
    }
  };
  return { net, selectors, settle };
}

/** Subsystem that runs the bus power control selectors (before the network). */
export class BusPowerControl implements Subsystem {
  readonly name = 'g6k.bus_power_control';
  constructor(private readonly selectors: SourceSelector[]) {}
  update(dt: number): void {
    for (let i = 0; i < this.selectors.length; i++) this.selectors[i].update(dt);
  }
  reset(): void {
    for (const s of this.selectors) s.reset?.();
  }
}

/**
 * Avionics power-interrupt ride-through. The ACPC / DCPC transfers are
 * break-power transfers: when a VFG drops (engine failure) the AC bus, its TRU
 * and the DC bus behind it are dead for one or two steps until the next source
 * contactor closes (and the emergency tie contactor puts the batteries on DC
 * ESS). The avionics boxes carry hold-up capacitance for exactly such
 * transfers (RTCA DO-160 section 16 power-interrupt categories), so a
 * transfer must not reboot the air data computers, drop the AFCS or blank the
 * AFDs. EST: 0.2 s hold-up (DO-160 section 16 interrupt tests go up to
 * 200 ms); anything longer is a real power loss.
 *
 * Runs right after the network: while a listed load has been powered within
 * the hold-up time, its `elec.<id>_powered` stays 1 and `elec.<id>_v` keeps
 * the last good voltage. Motors, lights and heaters are not listed (they drop
 * with the bus). No per-step allocation.
 */
export const HOLDUP_S = 0.2;
export const HOLDUP_LOADS = [
  'afd1', 'afd2', 'afd3', 'afd4', 'ctp1', 'ctp2', 'ccp1', 'ccp2', 'mkp1', 'mkp2', 'fcp',
  'adc1', 'adc2', 'irs1', 'irs2', 'irs3', 'afcs1', 'afcs2', 'fadec1', 'fadec2',
  'sfcu1', 'sfcu2', 'fcu1', 'fcu2', 'lgecu_a', 'lgecu_b', 'bcu_a', 'bcu_b', 'nws1', 'nws2', 'spc',
  'fideex_a', 'fideex_b', 'fuel_cmptr_a', 'fuel_cmptr_b', 'bmc1', 'bmc2', 'cpc1', 'cpc2', 'hbmu',
  'com1', 'com2', 'com3', 'nav1', 'nav2', 'gps1', 'gps2', 'iac1', 'iac2',
  'ra1', 'ra2', 'taws', 'xpdr1', 'xpdr2', 'tcas', 'adf1', 'adf2', 'fms',
] as const;

export class PowerHoldup implements Subsystem {
  readonly name = 'g6k.power_holdup';
  private readonly pw: string[];
  private readonly vv: string[];
  private readonly off: Float64Array;
  private readonly lastV: Float64Array;

  constructor(
    private readonly vars: SimContext['vars'],
    loads: readonly string[] = HOLDUP_LOADS,
  ) {
    this.pw = loads.map((l) => `elec.${l}_powered`);
    this.vv = loads.map((l) => `elec.${l}_v`);
    this.off = new Float64Array(loads.length).fill(HOLDUP_S);
    this.lastV = new Float64Array(loads.length);
  }

  update(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < this.pw.length; i++) {
      if (v.get(this.pw[i]) !== 0) {
        this.off[i] = 0;
        this.lastV[i] = v.get(this.vv[i]);
      } else if (this.off[i] < HOLDUP_S) {
        this.off[i] += dt;
        if (this.off[i] < HOLDUP_S) {
          v.set(this.pw[i], 1);
          v.set(this.vv[i], this.lastV[i]);
        }
      }
    }
  }

  reset(): void {
    const v = this.vars;
    for (let i = 0; i < this.pw.length; i++) {
      const on = v.get(this.pw[i]) !== 0;
      this.off[i] = on ? 0 : HOLDUP_S;
      this.lastV[i] = on ? v.get(this.vv[i]) : 0;
    }
  }
}
