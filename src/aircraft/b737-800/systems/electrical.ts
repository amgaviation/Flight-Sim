/**
 * Boeing 737-800 electrical system (FCOM 6.10 / 6.20 "Electrical"; LIM;
 * systems-power.md §3.7 737-800 recipe).
 *
 * AC generation: two 90 kVA IDGs (one per engine), a 90 kVA APU generator
 * (66 kVA above 32,000 ft class, LIM: APU electrical to 41,000 ft) and a
 * 90 kVA external power receptacle, 115 V / 400 Hz. Sources never parallel:
 * each AC transfer bus is powered by exactly one source through its generator
 * circuit breaker (GCB) or through the bus tie breaker (BTB) and the tie bus
 * (APU breaker APB, ground power contactor GPC). The source latch per
 * transfer bus lives in `AcSourceLogic` (the momentary GEN / APU GEN / GRD
 * PWR switches), the network only closes contactors.
 *
 *   IDG1 --GCB1-- XFR BUS 1 --BTB1--+-- TIE --BTB2-- XFR BUS 2 --GCB2-- IDG2
 *                  |  \             |  \
 *        MAIN BUS 1   TR1 -> DC BUS 1    APB (APU GEN)   GPC (GRD PWR)
 *        (CAB/UTIL)   AC STBY (normal)
 *   XFR 2 -> TR2 -> DC BUS 2 ; XFR 2 (alt XFR 1) -> TR3 -> DC BUS 2 + BATTERY BUS
 *   DC BUS 1 == cross bus tie == DC BUS 2 (opens with BUS TRANSFER OFF and in a dual-channel approach)
 *   HOT BATT BUS (48 Ah NiCd, charger from XFR 2) -> SWITCHED HOT BATT BUS (BAT ON)
 *   STANDBY: AC STBY from XFR 1 or the static inverter (battery bus); DC STBY from DC BUS 1 or the battery bus.
 *
 * Automatic behaviour: BUS TRANSFER AUTO transfers a transfer bus to the
 * opposite IDG when its own generator drops off (and back when it returns);
 * STANDBY POWER AUTO goes to battery on loss of all AC; single-generator
 * galley / main bus load shedding in flight (FCOM 6.20 "Load shedding").
 * Loads are grouped per bus with breaker names after the P6 / P18 panels;
 * currents are EST typical values for the equipment class.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import { ElectricalNetwork, BATTERY_737NG_NICD, type LoadDef } from '../../../systems/electrical';
import { EdgeDetector } from '../../../systems/util';
import { VERTICAL_MODES } from '../../../systems/autopilot';
import { B738 } from '../vars';

export const pw = (load: string): string => `elec.${load}_powered`;

const X = (i: 1 | 2) => B738.xfrSrc(i);
/** Single generator in flight: galley and main-bus loads are shed (FCOM 6.20). */
const SHED_MAIN = `gear.air_ground == 0 && !(${X(1)} == 1 && ${X(2)} == 1) && ${X(1)} != 2 && ${X(2)} != 2`;

export function createElectrical(ctx: Pick<SimContext, 'vars'>): ElectricalNetwork {
  const dc = (id: string, bus: string, amps: LoadDef['amps'], extra: Partial<LoadDef> = {}, cbA = 5): LoadDef => ({ id, bus, amps, cb: { name: id, ratingA: cbA }, ...extra });
  const ac = (id: string, bus: string, va: LoadDef['va'], extra: Partial<LoadDef> = {}, cbA = 5): LoadDef => ({ id, bus, va, cb: { name: id, ratingA: cbA }, ...extra });
  const onW = (sw: string) => `${sw} != 0`;
  const loads: LoadDef[] = [
    // ---------------------------------------------------------------- AC STANDBY bus (essential flight instruments)
    ac('du_capt_out', 'ac_stby', 90, {}, 5), // CDS display units (~90 VA each, EST)
    ac('du_capt_in', 'ac_stby', 90, {}, 5),
    ac('du_upper', 'ac_stby', 90, {}, 5),
    ac('deu1', 'ac_stby', 60, {}, 5),
    ac('irs1_ac', 'ac_stby', 110, {}, 5), // left ADIRU (AC normal, DC backup from the hot battery bus)
    ac('nav1', 'ac_stby', 40, {}, 3), // VHF NAV 1 (MMR)
    ac('ign_l', 'ac_stby', 'eng1.ignition * 60 + eng2.ignition * 60', {}, 5), // left igniters
    ac('stby_yd', 'ac_stby', 10, {}, 3),
    // ---------------------------------------------------------------- AC XFR bus 1
    ac('fmc', 'xfr1', 60, {}, 5),
    ac('cdu1', 'xfr1', 40, {}, 5),
    ac('adf1', 'xfr1', 30, {}, 3),
    ac('ign_r', 'xfr1', 'eng1.ignition * 60 + eng2.ignition * 60', {}, 5), // right igniters
    // Fuel boost pumps ~1.2 kVA each at full flow. Diagonal split (B737NG Power Sources training doc, sjap.nl,
    // "115 VAC TRANSFER BUS 1/2" load lists): XFR 1 carries BOOST PUMP TANK 1 FWD, TANK 2 AFT and CTR TANK LEFT;
    // XFR 2 carries TANK 1 AFT, TANK 2 FWD and CTR TANK RIGHT — one pump per main tank survives a transfer bus loss.
    ac('fuel_l_fwd', 'xfr1', 'fuel.l_fwd_amps * 115', {}, 15),
    ac('fuel_r_aft', 'xfr1', 'fuel.r_aft_amps * 115', {}, 15),
    ac('fuel_c_l', 'xfr1', 'fuel.c_l_amps * 115', {}, 15),
    ac('hyd_elec1', 'xfr1', 'hyd.emdp_b_va', {}, 50), // ELEC 1 pump (system B; "B SYS ELEC HYDR PUMP" on XFR 1, sjap.nl)
    ac('probe_heat_a', 'xfr1', 900, { enabled: onW(B738.probeHeat('a')), model: 'resistive' }, 15),
    ac('win_heat_l_side', 'xfr1', 1800, { enabled: onW(B738.windowHeat('l_side')), model: 'resistive' }, 20),
    ac('win_heat_r_fwd', 'xfr1', 2600, { enabled: onW(B738.windowHeat('r_fwd')), model: 'resistive' }, 25),
    ac('pack_ctl_l', 'xfr1', 80, {}, 5),
    ac('recirc_l', 'xfr1', 700, { enabled: onW(B738.recircFan(1)) }, 10),
    ac('equip_cool', 'xfr1', 600, {}, 10),
    ac('landing_retract', 'xfr1', `(${B738.landingRetract(1)} == 2) * 600 + (${B738.landingRetract(2)} == 2) * 600`, { model: 'resistive' }, 15),
    ac('wiper_l', 'xfr1', `${B738.wiper(1)} * 60`, {}, 5),
    ac('eec1_alt', 'xfr1', 30, {}, 5), // EEC 1 power during start (alternators above 15 % N2)
    ac('trim_air', 'xfr1', 20, { enabled: onW(B738.trimAir) }, 3),
    // ---------------------------------------------------------------- AC XFR bus 2
    ac('du_lower', 'xfr2', 90, {}, 5),
    ac('du_fo_in', 'xfr2', 90, {}, 5),
    ac('du_fo_out', 'xfr2', 90, {}, 5),
    ac('deu2', 'xfr2', 60, {}, 5),
    ac('cdu2', 'xfr2', 40, {}, 5),
    ac('irs2_ac', 'xfr2', 110, {}, 5),
    ac('nav2', 'xfr2', 40, {}, 3),
    ac('adf2', 'xfr2', 30, {}, 3),
    ac('fuel_l_aft', 'xfr2', 'fuel.l_aft_amps * 115', {}, 15), // BOOST PUMP TANK 1 AFT on XFR 2 (sjap.nl, see XFR 1 note)
    ac('fuel_r_fwd', 'xfr2', 'fuel.r_fwd_amps * 115', {}, 15),
    ac('fuel_c_r', 'xfr2', 'fuel.c_r_amps * 115', {}, 15),
    ac('hyd_elec2', 'xfr2', 'hyd.emdp_a_va', {}, 50), // ELEC 2 pump (system A; "A SYS ELEC HYDR PUMP" on XFR 2, sjap.nl)
    ac('hyd_stby', 'xfr2', 'hyd.stby_pump_va', {}, 25), // "STBY HYDR PUMP" on XFR BUS 2 (sjap.nl NG Power Sources)
    ac('probe_heat_b', 'xfr2', 900, { enabled: onW(B738.probeHeat('b')), model: 'resistive' }, 15),
    ac('win_heat_l_fwd', 'xfr2', 2600, { enabled: onW(B738.windowHeat('l_fwd')), model: 'resistive' }, 25),
    ac('win_heat_r_side', 'xfr2', 1800, { enabled: onW(B738.windowHeat('r_side')), model: 'resistive' }, 20),
    ac('pack_ctl_r', 'xfr2', 80, {}, 5),
    ac('recirc_r', 'xfr2', 700, { enabled: onW(B738.recircFan(2)) }, 10),
    // Weather radar transceiver: transmits (full load) while the radar is active (WXR selected on an EFIS control
    // panel, logic.ts `wxr.active`); there is no separate radar on/off switch on the NG panel (FCOM 15 / 11.30).
    ac('wxr', 'xfr2', '20 + 180 * wxr.active', {}, 5),
    ac('wiper_r', 'xfr2', `${B738.wiper(2)} * 60`, {}, 5),
    ac('eec2_alt', 'xfr2', 30, {}, 5),
    ac('tcas', 'xfr2', 120, {}, 5),
    // ---------------------------------------------------------------- MAIN buses 1 / 2 (CAB/UTIL, galleys; shed with one source in flight)
    ac('galley_fwd', 'main1', 'ac.b738.galley_va', { shed: SHED_MAIN, enabled: onW(B738.cabUtilSw) }, 50),
    ac('galley_aft', 'main2', 'ac.b738.galley_va', { shed: SHED_MAIN, enabled: onW(B738.cabUtilSw) }, 50),
    ac('ife', 'main1', 1500, { shed: SHED_MAIN, enabled: onW(B738.ifeSw) }, 20),
    ac('cabin_lts', 'main2', 1200, { shed: SHED_MAIN, enabled: onW(B738.cabUtilSw) }, 15),
    // ---------------------------------------------------------------- DC STANDBY bus (essential DC)
    dc('com1', 'dc_stby', 3, {}, 5), // VHF COMM 1
    dc('efis1', 'dc_stby', 0.5, {}, 3), // Capt EFIS control panel
    dc('fire_det', 'dc_stby', 1, {}, 5), // fire detection (engines, APU, wheel well)
    dc('fire_ext', 'batt_bus', 0.5, {}, 5),
    dc('ign_dc', 'dc_stby', 0.5, {}, 3),
    dc('stall_warn1', 'dc_stby', 0.5, {}, 3), // SMYD 1 stick shaker
    dc('isfd', 'dc_stby', 1.2, {}, 3), // Integrated standby flight display (DC standby / hot battery)
    dc('eng_ind', 'dc_stby', 1, {}, 5),
    dc('alt_flaps', 'dc_stby', `0.5 + 12 * flaps.alt_moving`, {}, 15),
    dc('stby_rud', 'dc_stby', 0.3, {}, 3),
    dc('press_altn', 'dc_stby', 0.5, {}, 3),
    // ---------------------------------------------------------------- DC bus 1
    dc('mcp1', 'dc1', 1.5, {}, 5),
    dc('fcc_a', 'dc1', 2, {}, 5), // flight control computer A
    dc('at', 'dc1', 1, {}, 5),
    dc('gps1', 'dc1', 1, {}, 3),
    dc('ra1', 'dc1', 1, {}, 3),
    dc('stab_trim', 'dc1', 'trim.pitch_in_motion * 6 + 0.2', {}, 10), // stab trim motor control
    dc('gear_ctl', 'dc1', '0.5 + 2 * gear.moving', {}, 5),
    dc('antiskid', 'dc1', 1.5, {}, 5),
    dc('autobrake', 'dc1', 0.5, {}, 3),
    dc('press_auto', 'dc1', 0.5, {}, 3),
    dc('yd', 'dc1', 0.5, {}, 3),
    dc('eng1_start', 'dc1', `0.2 + (${B738.engStart(1)} == 0) * 1.5`, {}, 5), // start valve solenoid / GRD holding coil
    dc('fuel_valves', 'dc1', '0.5', {}, 5),
    dc('bleed_ctl_l', 'dc1', 0.5, {}, 3),
    dc('wing_ai_valve', 'dc1', 0.3, {}, 3),
    dc('eng_ai1', 'dc1', 0.3, {}, 3),
    dc('taws', 'dc1', 1, {}, 3),
    dc('smyd1', 'dc1', 0.5, {}, 3),
    dc('mach_warn', 'dc1', 0.3, {}, 3),
    dc('flt_ctl_a', 'dc1', 0.3, {}, 3),
    dc('cargo_fire', 'dc1', 0.5, {}, 3),
    dc('wxr_ctl', 'dc1', 0.3, {}, 3),
    // ---------------------------------------------------------------- DC bus 2
    dc('mcp2', 'dc2', 1.5, {}, 5),
    dc('fcc_b', 'dc2', 2, {}, 5),
    dc('com2', 'dc2', 3, {}, 5),
    dc('efis2', 'dc2', 0.5, {}, 3),
    dc('gps2', 'dc2', 1, {}, 3),
    dc('ra2', 'dc2', 1, {}, 3),
    dc('xpdr', 'dc2', 1.5, {}, 5), // ATC 1
    dc('xpdr2', 'dc1', 1.5, {}, 5), // ATC 2
    dc('eng2_start', 'dc2', `0.2 + (${B738.engStart(2)} == 0) * 1.5`, {}, 5),
    dc('bleed_ctl_r', 'dc2', 0.5, {}, 3),
    dc('eng_ai2', 'dc2', 0.3, {}, 3),
    dc('smyd2', 'dc2', 0.5, {}, 3),
    dc('stall_warn2', 'dc2', 0.5, {}, 3),
    dc('flt_ctl_b', 'dc2', 0.3, {}, 3),
    dc('spoiler_ctl', 'dc2', 0.5, {}, 3),
    dc('steering', 'dc2', 0.3, {}, 3),
    dc('apu_ecu', 'batt_bus', `0.5 + apu.running * 1`, {}, 5), // APU electronic control unit (battery bus)
    // APU starter-generator: through the start converter unit from AC XFR bus 1 when available, else from the
    // battery (FCOM 7.10 "APU start": battery start or SCU start; EST current profile from the Apu block).
    dc('apu_start', 'batt_bus', '!elec.xfr1_powered * apu.starter_amps', {}, 400),
    ac('apu_scu', 'xfr1', 'elec.xfr1_powered * apu.starter_amps * 28 / 0.85', {}, 30),
    // ---------------------------------------------------------------- HOT / SWITCHED HOT BATTERY buses
    dc('irs_dc', 'sw_hot_batt', 'irs1.on_dc * 6 + irs2.on_dc * 6', {}, 10), // ADIRU DC backup
    dc('clock', 'hot_batt', 0.1, {}, 1),
    dc('fire_bottle_sq', 'hot_batt', 0.1, {}, 3), // extinguisher squibs (hot battery bus)
    dc('park_brake_valve', 'hot_batt', 0.2, {}, 3),
    dc('pax_oxy', 'hot_batt', 0.1, {}, 3),
    // ---------------------------------------------------------------- lights (exterior on AC/DC; panel lighting)
    ac('position_lts', 'xfr1', 180, { enabled: onW(B738.positionLt), model: 'resistive' }, 10),
    ac('strobe_lts', 'xfr2', 250, { enabled: `${B738.positionLt} == 1` }, 10),
    ac('anti_coll', 'xfr1', 150, { enabled: onW(B738.antiColl) }, 5),
    ac('fixed_landing', 'xfr2', `(${B738.landingFixed(1)} + ${B738.landingFixed(2)}) * 600`, { model: 'resistive' }, 15),
    ac('turnoff_lts', 'xfr2', `(${B738.turnoff(1)} + ${B738.turnoff(2)}) * 300`, { model: 'resistive' }, 10),
    ac('taxi_lt', 'xfr1', 450, { enabled: onW(B738.taxiLt), model: 'resistive' }, 10),
    ac('logo_lts', 'xfr2', 400, { enabled: onW(B738.logoLt), model: 'resistive' }, 10),
    ac('wing_lts', 'xfr1', 250, { enabled: onW(B738.wingLt), model: 'resistive' }, 5),
    ac('wheel_well_lts', 'xfr2', 100, { enabled: onW(B738.wheelWellLt), model: 'resistive' }, 5),
    dc('panel_lts', 'dc1', `3 * (${B738.panelLt(1)} + ${B738.panelLt(2)} + ${B738.ovhdPanelLt} + ${B738.pedestalPanelLt})`, { model: 'resistive' }, 15),
    dc('flood_lts', 'dc2', `2 * (${B738.backgroundLt} + ${B738.glareshieldFlood} + ${B738.pedestalFlood} + ${B738.afdsFlood})`, { model: 'resistive' }, 10),
    dc('dome_lt', 'batt_bus', `${B738.domeLt} * 1.5`, { model: 'resistive' }, 5),
    dc('annun_lts', 'dc1', 2, {}, 5), // master dim & test
    // Emergency lights: their own NiCd battery packs, charged from DC bus 1 unless the switch is OFF (FCOM 1.40);
    // the lights run on the packs (logic.ts `emer_lts_on`). EST charging current 0.5 A.
    dc('emer_lts', 'dc1', `(${B738.emerExitLt} != 0) * 0.5`, {}, 5),
    // Flight deck door lock (electric strike, FCOM 1.40): EST 0.3 A continuous, DC bus 1 (EST wiring).
    dc('fd_door_lock', 'dc1', 0.3, {}, 3),
  ];

  return new ElectricalNetwork(ctx.vars, {
    buses: [
      { id: 'idg1_out', type: 'ac' },
      { id: 'idg2_out', type: 'ac' },
      { id: 'apu_out', type: 'ac' },
      { id: 'gpu_out', type: 'ac' },
      { id: 'tie', type: 'ac' },
      { id: 'xfr1', type: 'ac' },
      { id: 'xfr2', type: 'ac' },
      { id: 'tru3_ac', type: 'ac' },
      { id: 'main1', type: 'ac' },
      { id: 'main2', type: 'ac' },
      { id: 'ac_stby', type: 'ac' },
      { id: 'dc1' },
      { id: 'dc2' },
      { id: 'tru3_dc' },
      { id: 'batt_bus' },
      { id: 'hot_batt' },
      { id: 'hot_aux' },
      { id: 'sw_hot_batt' },
      { id: 'dc_stby' },
    ],
    // FCOM 6.10 / b737.org.uk Electrics: two 48 Ah NiCd batteries, main and auxiliary
    // (BATTERY_737NG_NICD: 20-cell, 48 Ah; LIM quotes 40 Ah on older units). The auxiliary battery
    // parallels the main battery for standby power / autoland loads (60 min standby endurance class).
    batteries: [
      { id: 'batt', bus: 'hot_batt', ...BATTERY_737NG_NICD, ambientC: 'fdm.sat_c' },
      { id: 'aux_batt', bus: 'hot_aux', ...BATTERY_737NG_NICD, ambientC: 'fdm.sat_c' },
    ],
    acGenerators: [
      // IDGs: 90 kVA, 115 V 400 Hz (LIM). On line above ~50 % N2 (EST; ground idle 59 %). ENGINE fire handle pulled trips the GCB (FCOM 8.20).
      { id: 'idg1', bus: 'idg1_out', ratedKva: 90, drive: 'eng1.n2_pct', minDrive: 50, switch: `!${B738.fireHandle(1)}`, disconnect: `${B738.driveDisc(1)} && eng1.n2_pct > 20`, overloadTripPct: 150, overloadTripS: 5 },
      { id: 'idg2', bus: 'idg2_out', ratedKva: 90, drive: 'eng2.n2_pct', minDrive: 50, switch: `!${B738.fireHandle(2)}`, disconnect: `${B738.driveDisc(2)} && eng2.n2_pct > 20`, overloadTripPct: 150, overloadTripS: 5 },
      // APU generator: 90 kVA (LIM), available at 95 % N (LIM "Minimum RPM for power delivery").
      { id: 'apu_gen', bus: 'apu_out', ratedKva: 90, drive: 'apu.gen_drive', minDrive: 95 },
    ],
    externals: [{ id: 'gpu', bus: 'gpu_out', type: 'ac', available: B738.gpuConnected, ratedKva: 90 }],
    trus: [
      // TR1-3: 50 A class? The NG TRUs are 75 A units (EST from the FCOM DC meter scale); 28 V no load.
      { id: 'tru1', acBus: 'xfr1', dcBus: 'dc1', ratedA: 75 },
      { id: 'tru2', acBus: 'xfr2', dcBus: 'dc2', ratedA: 75 },
      { id: 'tru3', acBus: 'tru3_ac', dcBus: 'tru3_dc', ratedA: 75 },
      // Battery charger (FCOM 6.20: from AC ground service bus 2 / XFR 2): constant-voltage charging (EST 28.5 V, 50 A).
      { id: 'bat_chgr', acBus: 'xfr2', dcBus: 'hot_batt', ratedA: 50, noLoadV: 28.5, fullLoadV: 27.5 },
      // Auxiliary battery charger: "AUX BATTERY CHARGER" on AC ground service bus 1, normally fed from XFR 1
      // (sjap.nl NG Power Sources; the ground service buses are not modelled separately).
      { id: 'aux_bat_chgr', acBus: 'xfr1', dcBus: 'hot_aux', ratedA: 50, noLoadV: 28.5, fullLoadV: 27.5 },
    ],
    // Static inverter: 1 kVA class (EST), battery bus -> AC standby bus.
    inverters: [{ id: 'inv', dcBus: 'batt_bus', acBus: 'ac_stby', ratedVa: 1000, enabled: B738.stbyOnBatt }],
    links: [
      // ---- AC contactors (one source per island, AcSourceLogic)
      { id: 'gcb1', a: 'idg1_out', b: 'xfr1', closed: `${X(1)} == 1` },
      { id: 'gcb2', a: 'idg2_out', b: 'xfr2', closed: `${X(2)} == 1` },
      { id: 'btb1', a: 'tie', b: 'xfr1', closed: `${X(1)} >= 2 || ${X(2)} == 4` },
      { id: 'btb2', a: 'tie', b: 'xfr2', closed: `${X(2)} >= 2 || ${X(1)} == 4` },
      { id: 'apb', a: 'apu_out', b: 'tie', closed: `${X(1)} == 2 || ${X(2)} == 2` },
      { id: 'gpc', a: 'gpu_out', b: 'tie', closed: `${X(1)} == 3 || ${X(2)} == 3` },
      // Main buses (CAB/UTIL)
      { id: 'main1_relay', a: 'xfr1', b: 'main1', closed: `${B738.cabUtilSw} != 0` },
      { id: 'main2_relay', a: 'xfr2', b: 'main2', closed: `${B738.cabUtilSw} != 0` },
      // TR3 AC supply: XFR 2 normally, XFR 1 alternate (EST relay logic).
      { id: 'tr3_norm', a: 'xfr2', b: 'tru3_ac', closed: 'elec.xfr2_powered' },
      { id: 'tr3_alt', a: 'xfr1', b: 'tru3_ac', closed: '!elec.xfr2_powered' },
      // AC standby: from XFR 1 unless on battery (inverter) or STANDBY POWER OFF.
      { id: 'ac_stby_norm', a: 'xfr1', b: 'ac_stby', closed: `!${B738.stbyOnBatt} && ${B738.stbyPwrSw} == 1` },
      // ---- DC
      { id: 'tr3_dc2', a: 'tru3_dc', b: 'dc2', kind: 'diode' },
      { id: 'tr3_batt', a: 'tru3_dc', b: 'batt_bus', kind: 'diode' },
      // Cross bus tie relay: opens with BUS TRANSFER OFF and at G/S capture with both A/P channels engaged (FCOM 6.20).
      {
        id: 'cross_tie',
        a: 'dc1',
        b: 'dc2',
        closed: `${B738.busXferSw} != 0 && !(ap.channels == 2 && ap.vert_code == ${VERTICAL_MODES.indexOf('GS')})`,
      },
      { id: 'dc_stby_norm', a: 'dc1', b: 'dc_stby', kind: 'diode', closed: `!${B738.stbyOnBatt} && ${B738.stbyPwrSw} == 1` },
      { id: 'dc_stby_batt', a: 'batt_bus', b: 'dc_stby', closed: B738.stbyOnBatt },
      // Battery bus from the battery (BAT ON) when TR3 is not supplying it, or in standby-on-battery.
      { id: 'bat_bus_relay', a: 'hot_batt', b: 'batt_bus', closed: `${B738.batSw} != 0 && (!elec.tru3_online || ${B738.stbyOnBatt})`, coil: { pickupV: 14, dropoutV: 8 } },
      // Auxiliary battery: parallels the main battery for standby power (FCOM 6.10 / b737.org.uk Electrics:
      // "the auxiliary battery ... assists the main battery in supplying standby power"): same relay condition.
      { id: 'aux_bat_relay', a: 'hot_aux', b: 'batt_bus', closed: `${B738.batSw} != 0 && (!elec.tru3_online || ${B738.stbyOnBatt})`, coil: { pickupV: 14, dropoutV: 8 } },
      { id: 'sw_hot_relay', a: 'hot_batt', b: 'sw_hot_batt', closed: `${B738.batSw} != 0`, coil: { pickupV: 14, dropoutV: 8 } },
    ],
    loads,
  });
}

/**
 * Source selection of the two AC transfer buses (the "brain" of the 737
 * momentary switches, FCOM 6.20 "AC power system"), standby power mode and
 * the galley load. Writes `ac.b738.xfr{i}_src` (0 none, 1 own IDG, 2 APU,
 * 3 ground power, 4 opposite IDG through the bus transfer) and
 * `ac.b738.stby_on_batt`. Runs before the electrical network.
 */
export class AcSourceLogic implements Subsystem {
  readonly name = 'b738.ac_sources';
  src: [number, number] = [0, 0];
  /** 1 while the bus was auto-transferred after its own generator dropped off (auto-return armed). */
  private autoXfer: [boolean, boolean] = [false, false];
  private readonly edges = {
    grdOn: new EdgeDetector(),
    grdOff: new EdgeDetector(),
    genOn: [new EdgeDetector(), new EdgeDetector()],
    genOff: [new EdgeDetector(), new EdgeDetector()],
    apuOn: [new EdgeDetector(), new EdgeDetector()],
    apuOff: [new EdgeDetector(), new EdgeDetector()],
  };

  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}

  update(): void {
    const v = this.ctx.vars;
    const idgAvail = [v.get('elec.idg1_avail') !== 0 && v.get(B738.fireHandle(1)) === 0, v.get('elec.idg2_avail') !== 0 && v.get(B738.fireHandle(2)) === 0];
    const apuAvail = v.get('elec.apu_gen_avail') !== 0 && v.get(B738.fireHandleApu) === 0;
    const gpuAvail = v.get('elec.gpu_avail') !== 0;
    // FCOM 6.20 / 4.20: during a dual-channel (fail-operational) approach the electrical system splits into two
    // isolated sides — the automatic bus transfer is inhibited from G/S capture with both A/P channels engaged
    // (same condition that opens the DC cross bus tie), so a source failure leaves that side dead rather than
    // joining the buses.
    const dualCh = v.get('ap.channels') === 2 && v.get('ap.vert_code') === VERTICAL_MODES.indexOf('GS');
    const auto = v.get(B738.busXferSw) !== 0 && !dualCh;
    const e = this.edges;
    const s = this.src;
    // ---- manual switches (momentary)
    if (e.grdOn.rising(v.get(B738.grdPwrSw) >= 0.5) && gpuAvail) {
      s[0] = 3;
      s[1] = 3;
      this.autoXfer[0] = this.autoXfer[1] = false;
    }
    if (e.grdOff.rising(v.get(B738.grdPwrSw) <= -0.5)) for (const i of [0, 1]) if (s[i] === 3) s[i] = 0;
    for (const i of [0, 1] as const) {
      const n = (i + 1) as 1 | 2;
      const o = 1 - i;
      if (e.apuOn[i].rising(v.get(B738.apuGenSw(n)) >= 0.5) && apuAvail) {
        // The APU replaces ground power: the GPC opens and the other side drops ground power (no paralleling; EST).
        if (s[o] === 3) s[o] = 0;
        s[i] = 2;
        this.autoXfer[i] = false;
        if (s[o] === 4) s[o] = 0;
      }
      if (e.apuOff[i].rising(v.get(B738.apuGenSw(n)) <= -0.5) && s[i] === 2) s[i] = 0;
      if (e.genOn[i].rising(v.get(B738.genSw(n)) >= 0.5) && idgAvail[i]) {
        s[i] = 1;
        this.autoXfer[i] = false;
        // Ground power / APU leave that bus; if the tie is no longer used by the other side it simply opens.
      }
      if (e.genOff[i].rising(v.get(B738.genSw(n)) <= -0.5) && s[i] === 1) {
        s[i] = 0;
        this.autoXfer[i] = false;
        if (auto && s[o] === 1) s[i] = 4; // bus transfer to the operating generator
      }
    }
    // ---- automatic
    for (const i of [0, 1] as const) {
      const o = 1 - i;
      if (s[i] === 1 && !idgAvail[i]) {
        s[i] = 0;
        if (auto && s[o] === 1 && idgAvail[o]) {
          s[i] = 4;
          this.autoXfer[i] = true;
        }
      }
      if (s[i] === 4) {
        if (!auto || s[o] !== 1 || !idgAvail[o]) s[i] = 0;
        else if (this.autoXfer[i] && idgAvail[i]) {
          s[i] = 1; // automatic return to the bus's own generator
          this.autoXfer[i] = false;
        }
      }
      if (s[i] === 2 && !apuAvail) s[i] = 0;
      if (s[i] === 3 && !gpuAvail) s[i] = 0;
    }
    // A generator dropping off the other side while this side is on the tie via transfer: handled above.
    // If neither bus uses the tie for transfer and one side is on APU, keep the other side's GPU off the tie.
    if ((s[0] === 2 && s[1] === 3) || (s[0] === 3 && s[1] === 2)) s[s[0] === 3 ? 0 : 1] = 0;
    v.set(B738.xfrSrc(1), s[0]);
    v.set(B738.xfrSrc(2), s[1]);

    // ---- standby power (FCOM 6.20): BAT = battery; AUTO = battery on loss of all AC (in flight, or on the ground with BAT ON)
    const stby = v.get(B738.stbyPwrSw);
    const acLost = v.get('elec.xfr1_powered') === 0 && v.get('elec.xfr2_powered') === 0;
    const onBatt = stby <= -0.5 || (stby >= 0.5 && acLost && v.get(B738.batSw) !== 0);
    v.set(B738.stbyOnBatt, onBatt ? 1 : 0);
    // Galley load (EST 4 kVA per main bus while CAB/UTIL is on; ovens/chillers cycle).
    v.set('ac.b738.galley_va', 4000);
  }

  /** Latches sources for a state preset: 'none' (cold & dark), 'apu', 'gpu' or 'gens'. */
  select(mode: 'none' | 'apu' | 'gpu' | 'gens'): void {
    const n = mode === 'none' ? 0 : mode === 'gens' ? 1 : mode === 'apu' ? 2 : 3;
    this.src = [n, n];
    this.autoXfer = [false, false];
    const v = this.ctx.vars;
    v.set(B738.xfrSrc(1), n);
    v.set(B738.xfrSrc(2), n);
    for (const ed of [this.edges.grdOn, this.edges.grdOff]) ed.reset(false);
    for (const arr of [this.edges.genOn, this.edges.genOff, this.edges.apuOn, this.edges.apuOff]) for (const ed of arr) ed.reset(false);
  }

  reset(): void {
    const v = this.ctx.vars;
    this.src = [v.get(B738.xfrSrc(1)), v.get(B738.xfrSrc(2))];
  }
}

/** Load / bus power flags the other systems and the avionics read. */
export const POWER = {
  duCaptOut: pw('du_capt_out'),
  duCaptIn: pw('du_capt_in'),
  duUpper: pw('du_upper'),
  duLower: pw('du_lower'),
  duFoIn: pw('du_fo_in'),
  duFoOut: pw('du_fo_out'),
  deu1: pw('deu1'),
  deu2: pw('deu2'),
  fmc: pw('fmc'),
  cdu1: pw('cdu1'),
  cdu2: pw('cdu2'),
  mcp: `(${pw('mcp1')} || ${pw('mcp2')})`,
  efis1: pw('efis1'),
  efis2: pw('efis2'),
  nav1: pw('nav1'),
  nav2: pw('nav2'),
  adf1: pw('adf1'),
  adf2: pw('adf2'),
  gps: `(${pw('gps1')} || ${pw('gps2')})`,
  marker: pw('nav1'),
  fccA: pw('fcc_a'),
  fccB: pw('fcc_b'),
  at: pw('at'),
  irs1: pw('irs1_ac'),
  irs2: pw('irs2_ac'),
  isfd: pw('isfd'),
  ra1: pw('ra1'),
  ra2: pw('ra2'),
  taws: pw('taws'),
  tcas: pw('tcas'),
  xpdr: 'elec.xpdr_sel_powered',
  stallWarn: `(${pw('smyd1')} || ${pw('smyd2')})`,
  machWarn: pw('mach_warn'),
  stabTrim: pw('stab_trim'),
  yd: pw('yd'),
  antiskid: pw('antiskid'),
  autobrake: pw('autobrake'),
  gearCtl: pw('gear_ctl'),
  fireDet: pw('fire_det'),
  pressAuto: pw('press_auto'),
  pressAltn: pw('press_altn'),
  altFlaps: pw('alt_flaps'),
} as const;
