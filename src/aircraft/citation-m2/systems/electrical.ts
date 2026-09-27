/**
 * Citation M2 DC electrical system (S&D15 §9.4, S&D21 §9.3):
 *  - "traditional parallel bus architecture ... 600 amperes at 28.5 volts DC
 *    from two engine driven 300 ampere starter/generators";
 *  - 44 Ah nickel-cadmium main battery (aft baggage area) for starts and
 *    limited backup; 24 V sealed lead-acid auxiliary battery (14 Ah S&D21,
 *    16 Ah S&D15) in the nose that supports the avionics during engine starts
 *    and adds capacity in an emergency;
 *  - digital GCUs share load; with one generator off in flight the vapor-cycle
 *    air conditioning and the interior (cabin) equipment are shed;
 *  - emergency bus fed by the battery "for a limited period of time" when all
 *    generation is lost; BATTERY switch EMER position;
 *  - no avionics master: the BATTERY switch closes the avionics relays (AOPA Pilot
 *    Mar 2014); a separate DISPATCH switch (S&D15 §10.3.T) powers GTC 1 and the
 *    MFD from the auxiliary battery for ground radio calls and flight planning;
 *  - 500 W inverter (110 V AC outlets); external power receptacle under the LH pylon.
 *
 * Bus topology (EST, CJ-family architecture from the S&D descriptions):
 *
 *   NiCd --(batt disc relay: NORMAL)-- HOT BATT --(batt relay: BATT)-- BATT BUS ==(225 A limiters)== L MAIN (gen 1) / R MAIN (gen 2)
 *                  \--(emer relay: EMER)--.         \--(diode)--> EMER BUS (--> EMER-D: GTC 1, GIA 1, audio 1)
 *                                          '--------------------->   ^ aux batt diode during starts; DISPATCH -> EMER-D
 *   BATT BUS --(avionics relay: BATT)--> AVN 1 (ADC 1, AHRS 1, AP servos)
 *   L MAIN / BATT --> L XFEED ;  R MAIN / BATT --> R XFEED --(avionics relay: BATT)--> AVN 2 (--> AVN2-D: MFD)
 *
 * Loads are grouped per bus as the CB panels do (LH/RH sidewall CB panels, S&D15 §9.4);
 * currents are EST typical values for the equipment class. Every load gets a
 * breaker `cb.<name>` so the cockpit CircuitBreaker controls work.
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { ElectricalNetwork, BATTERY_737NG_NICD, BATTERY_172S_MAIN, type LoadDef } from '../../../systems/electrical';
import { M2 } from '../vars';
import { ENGINE_STARTING } from './airframe';

/** 'elec.<load>_powered' helper. */
export const pw = (load: string): string => `elec.${load}_powered`;

const onGroundOrBothGens = '(gear.air_ground != 0 || (elec.sg1_online && elec.sg2_online))';

export function createElectrical(ctx: Pick<SimContext, 'vars'>): ElectricalNetwork {
  const load = (id: string, bus: string, amps: LoadDef['amps'], extra: Partial<LoadDef> = {}, cbA = 5): LoadDef => ({
    id,
    bus,
    amps,
    cb: { name: id, ratingA: cbA },
    ...extra,
  });
  const loads: LoadDef[] = [
    // ---- Battery terminal: the disconnect relay coil is held energized in DISC ("holding it in DISC drains the
    //      battery slowly", CAE p.5-23). EST 0.4 A coil.
    { id: 'batt_disc_coil', bus: 'batt_term', amps: 0.4, enabled: M2.battDisc },
    // ---- EMER bus: the M2 flows "EMER BUS ITEMS" list (landing gear indicator lights; PFD 1 in reversion mode with
    //      AHRS 2, ADC 2, the display controller and GPS 1; the left GTC with COM 1, NAV 1, transponder 1, FMS, pilot
    //      and copilot audio, cabin PA, standby flight display; AFCS control panel; flood lights) plus the CJ-family
    //      emergency-bus items of CAE p.5-25 (gear and flap control, RH pitot-static heater, voltmeter / engine
    //      instruments, fire detection, ignition).
    load('pfd1', 'emer', 6.5, {}, 10), // GDU 1400W: ~180 W at 28 V (EST); reverts on EMER (M2Logic)
    load('gtc1', 'emer_d', 1.2, {}, 5), // on the dispatch-capable branch (DISPATCH: aux battery)
    load('gia1', 'emer_d', 3.5, {}, 7.5), // COM 1 / NAV 1 / GPS 1 / FD 1
    load('audio1', 'emer_d', 1, {}, 3), // GMA 36 #1 (pilot audio, cabin PA)
    load('audio2', 'emer', 1, {}, 3), // GMA 36 #2 (copilot audio; CAE p.5-25 "Audio 1 and 2")
    load('adc2', 'emer', 0.7, {}, 3), // PFD 1 reversionary air data (M2 flows)
    load('ahrs2', 'emer', 0.8, {}, 3), // PFD 1 reversionary attitude (M2 flows)
    load('xpdr1', 'emer', 1.5, {}, 5), // GTX 3000 #1
    load('gmc', 'emer', 0.6, {}, 3), // AFCS control panel (GMC 710)
    load('flood_lts', 'emer', `2 * ${M2.floodLt} + 0.5 * ${M2.mapLt(1)} + 0.5 * ${M2.mapLt(2)}`, { model: 'resistive' }, 5),
    load('pitot_r', 'emer', 6, { model: 'resistive', enabled: M2.pitotStaticSw }, 10), // CAE p.5-25: R pitot/static heat
    load('esi', 'emer', 0.8, {}, 3), // L-3 ESI-1000 (own backup battery)
    load('gea', 'emer', 1, {}, 3), // engine instruments / voltmeter
    load('fire_det', 'emer', 0.5, {}, 3),
    load('gear_ctl', 'emer', '0.5 + 1.5 * gear.moving', {}, 5),
    load('flap_ctl', 'emer', '0.3 + 1 * flaps.moving', {}, 5),
    // Speed brake control: separate breaker (525AFM-06 p.3-102 "landing gear, flap, speed brake ... circuit breaker").
    // EST: emergency bus, beside the flap control.
    load('spd_brk', 'emer', '0.2 + 1 * spoilers.moving', {}, 5),
    load('ign1', 'emer', 'eng1.ignition * 2', {}, 5),
    load('ign2', 'emer', 'eng2.ignition * 2', {}, 5),
    load('fadec1_bkp', 'emer', 0.2, {}, 3), // FADEC normally on its PMAs (S&D15 §8)
    load('fadec2_bkp', 'emer', 0.2, {}, 3),
    load('stby_lts', 'emer', `${M2.panelLt} * 0.5`, { model: 'resistive' }, 3),
    // ---- AVN 1 (battery switch BATT; lost on EMER): ADC 1, AHRS 1 and the AP servos (525AFM-06 p.3-26: flight
    //      guidance system including the autopilot inoperative on emergency power).
    load('adc1', 'avn1', 0.7, {}, 3),
    load('ahrs1', 'avn1', 0.8, {}, 3),
    load('ap_servos', 'avn1', 'ap.engaged * 3 + 0.3', {}, 5),
    // ---- AVN 2 (MFD on the dispatch-capable branch, PFD 2, GTC 2, GIA 2, radar, DME, RA, TCAS, XPDR 2)
    load('mfd', 'avn2_d', 6.5, {}, 10),
    load('pfd2', 'avn2', 6.5, {}, 10),
    load('gtc2', 'avn2', 1.2, {}, 5),
    load('gia2', 'avn2', 3.5, {}, 7.5),
    load('radar', 'avn2', 3, {}, 5), // GWX 70 (40 W transmitter, S&D15)
    load('dme', 'avn2', 1, {}, 3), // Collins DME-4000
    load('ra', 'avn2', 1, {}, 3), // Collins ALT-4000
    load('tcas', 'avn2', 2, {}, 5), // Garmin GTS 855 TCAS I
    load('xpdr2', 'avn2', 1.5, {}, 5), // GTX 3000 #2
    // ---- L MAIN
    load('pitot_l', 'l_main', 6, { model: 'resistive', enabled: M2.pitotStaticSw }, 10),
    load('boost_l', 'l_main', 'fuel.boost_l_amps', {}, 15),
    load('trim_pitch', 'l_main', 'trim.pitch_in_motion * 2', {}, 5),
    load('landing_l', 'l_main', `${M2.landingLt} >= 1 ? 2.5 : 0`, {}, 5), // OSRAM LED (S&D15 §5)
    load('nav_lts', 'l_main', 2, { enabled: M2.navLt }, 5),
    load('beacon', 'l_main', 1.5, { enabled: `${M2.antiColl} >= 1 || ${ENGINE_STARTING}` }, 5), // beacon with START (airframe.ts)
    load('wing_insp', 'l_main', 1, { enabled: M2.wingInspLt }, 3),
    load('ws_alcohol', 'l_main', 2.5, { enabled: `${M2.wsAlcoholSw} && ${M2.wsAlcoholRemaining} > 0` }, 5), // pump stops when the reservoir is empty
    load('bleed_ctl_l', 'l_main', 0.5, {}, 3), // bleed / anti-ice valves & controllers
    load('stall_warn', 'l_main', 0.5, {}, 3),
    // ---- R MAIN
    load('aoa_heat', 'r_main', 3, { model: 'resistive', enabled: M2.pitotStaticSw }, 5),
    load('boost_r', 'r_main', 'fuel.boost_r_amps', {}, 15),
    load('landing_r', 'r_main', `${M2.landingLt} >= 1 ? 2.5 : 0`, {}, 5),
    load('taxi_lts', 'r_main', 2, { enabled: M2.taxiLt }, 5),
    load('strobes', 'r_main', 3, { enabled: `${M2.antiColl} >= 2` }, 5),
    load('logo_lts', 'r_main', 2, { enabled: M2.logoLt }, 5),
    load('bleed_ctl_r', 'r_main', 0.5, {}, 3),
    load('press_ctl', 'r_main', 0.5, {}, 3), // digital auto-schedule pressurization controller
    load('tail_deice', 'r_main', '0.5 + 1 * ac.m2.boot1_cmd + 1 * ac.m2.boot2_cmd', {}, 5),
    load('antiskid', 'r_main', 1, { enabled: M2.antiskidSw }, 5),
    // ---- L XFEED (cockpit)
    load('panel_lts', 'l_xfeed', `5.5 * ${M2.panelLt}`, { model: 'resistive' }, 7.5), // panels + pedestal on the PANELS dimmer
    load('cockpit_fans', 'l_xfeed', 1.5, {}, 5), // two glareshield avionics cooling fans (S&D15 §10.3.A)
    load('temp_ctl', 'l_xfeed', 0.5, {}, 3),
    // ---- R XFEED (cabin; shed with one generator in flight, S&D15 §9.4)
    load('hyd_brake_pump', 'r_xfeed', 'hyd.brk_pump_amps', {}, 25),
    load('cabin_fan', 'r_xfeed', `${M2.cabinFan} * 4`, { shed: `!${onGroundOrBothGens}` }, 10),
    load('cabin_lts', 'r_xfeed', 5, { enabled: M2.cabinLt, shed: `!${onGroundOrBothGens}` }, 7.5),
    load('pax_signs', 'r_xfeed', 0.5, { enabled: `${M2.paxSafety} >= 1` }, 3),
    // 500 W inverter: the outlet's switch turns it on when a plug is inserted (CAE CJ-family differences p. 5-26); copilot
    // sidewall outlet (cockpit/side). EST 2.5 A DC for a typical ~50 W device plus inverter losses.
    // "The inverter will not function with the battery switch in the EMER position" (CAE p.5-26).
    load('inverter', 'r_xfeed', 2.5, { enabled: `ac.m2.ac_outlet_plug && ${M2.battSw} != -1`, shed: `!${onGroundOrBothGens}` }, 25),
    // Vapor-cycle A/C: ground only with GPU or the right engine running; sheds in flight with a generator off (S&D15 §9.5).
    load('air_cond', 'r_xfeed', 75, {
      enabled: `${M2.airCondSw} && (gear.air_ground == 0 || elec.gpu_online || ${ENG.running(2)})`,
      shed: `!${onGroundOrBothGens}`,
    }, 100),
  ];

  const gen = (i: number) => ({
    id: `sg${i}`,
    bus: i === 1 ? 'l_main' : 'r_main',
    kind: 'starter-generator' as const,
    regulatedV: 28.5, // S&D15 §9.4
    ratedA: 300, // S&D15 §9.4
    drive: ENG.n2(i),
    minDrive: 45, // EST: GCU brings the generator on line above ~45 % N2 (below the ~52 % ground idle)
    // ENG FIRE push button trips the generator field (S&D-class fire logic, EST CJ family).
    switch: `${M2.genSw(i)} == 1 && !${M2.engFireBtn(i)}`,
    reset: `${M2.genSw(i)} == -1`,
    starter: {
      command: `fadec.eng${i}.starter_cmd`,
      bus: 'batt_bus',
      speed: ENG.n2(i),
      noLoadSpeed: 32.5, // EST ~1.25 x starterMaxN2 (26 %), physics guidance
      resistanceOhm: 0.02, // EST, systems-power doc
      nominalV: 24,
      engineStarterVar: ENG.starter(i),
      // Start relay: MIL-PRF-6106/26 28 V relay pull-in <= 15 V; drop-out EST 7 V (QA doc: never gate on the 18 V powered flag).
      contactor: { pickupV: 15, dropoutV: 7 },
    },
  });

  return new ElectricalNetwork(ctx.vars, {
    buses: [{ id: 'batt_term' }, { id: 'hot_batt' }, { id: 'batt_bus' }, { id: 'emer' }, { id: 'l_main' }, { id: 'r_main' }, { id: 'l_xfeed' }, { id: 'r_xfeed' }, { id: 'avn1' }, { id: 'avn2' }, { id: 'emer_d' }, { id: 'avn2_d' }, { id: 'aux' }],
    batteries: [
      // 44 Ah NiCd main battery (S&D15/S&D21): 20-cell NiCd class of the 737NG preset, capacity per the S&D.
      { id: 'batt', bus: 'batt_term', ...BATTERY_737NG_NICD, capacityAh: 44, ambientC: 'fdm.sat_c' },
      // 24 V 14 Ah sealed lead-acid auxiliary battery (S&D21 §9.3): RG24-15 class (13.6 Ah) scaled.
      { id: 'aux_batt', bus: 'aux', ...BATTERY_172S_MAIN, capacityAh: 14, ambientC: 'fdm.sat_c' },
    ],
    dcGenerators: [gen(1), gen(2)],
    externals: [{ id: 'gpu', bus: 'batt_bus', type: 'dc', available: M2.gpuConnected, voltage: 28 }],
    links: [
      // BATTERY DISCONNECT relay (CAE CJ-family differences p.5-23: NORMAL / DISC switch above the pilot's armrest).
      { id: 'batt_disc', a: 'batt_term', b: 'hot_batt', closed: `${M2.battDisc} == 0` },
      { id: 'batt_relay', a: 'hot_batt', b: 'batt_bus', closed: `${M2.battSw} == 1`, coil: { pickupV: 14, dropoutV: 8 } },
      { id: 'emer_relay', a: 'hot_batt', b: 'emer', closed: `${M2.battSw} == -1`, coil: { pickupV: 14, dropoutV: 8 } },
      { id: 'emer_feed', a: 'batt_bus', b: 'emer', kind: 'diode' },
      // 225 A current limiters between the generator buses and the battery bus (EST, CJ family). "Generator assist
      // start capability is disabled in flight; therefore, all starter assist airstarts are from the battery"
      // (525AFM-06 p.3-107): in flight the operating generator's limiter path is opened while the other starter runs.
      { id: 'l_limiter', a: 'l_main', b: 'batt_bus', closed: '!(gear.air_ground == 0 && elec.sg2_starter)', cb: { name: 'l_limiter', ratingA: 325 } },
      { id: 'r_limiter', a: 'r_main', b: 'batt_bus', closed: '!(gear.air_ground == 0 && elec.sg1_starter)', cb: { name: 'r_limiter', ratingA: 325 } },
      { id: 'l_xfeed_main', a: 'l_main', b: 'l_xfeed', kind: 'diode', cb: { name: 'l_xfeed', ratingA: 50 } },
      { id: 'l_xfeed_batt', a: 'batt_bus', b: 'l_xfeed', kind: 'diode' },
      { id: 'r_xfeed_main', a: 'r_main', b: 'r_xfeed', kind: 'diode', cb: { name: 'r_xfeed', ratingA: 150 } },
      { id: 'r_xfeed_batt', a: 'batt_bus', b: 'r_xfeed', kind: 'diode' },
      // Avionics relays: closed by the BATTERY switch in BATT ("no avionics switch", AOPA Mar 2014); open in EMER.
      { id: 'avn1_relay', a: 'batt_bus', b: 'avn1', kind: 'diode', closed: `${M2.battSw} == 1`, cb: { name: 'avn1', ratingA: 35 } },
      { id: 'avn2_relay', a: 'r_xfeed', b: 'avn2', kind: 'diode', closed: `${M2.battSw} == 1`, cb: { name: 'avn2', ratingA: 50 } },
      // Dispatch-capable branches: normally fed from their bus; DISPATCH connects the aux battery (AOPA Mar 2014).
      { id: 'emer_d_feed', a: 'emer', b: 'emer_d', kind: 'diode' },
      { id: 'avn2_d_feed', a: 'avn2', b: 'avn2_d', kind: 'diode' },
      { id: 'disp_relay1', a: 'aux', b: 'emer_d', kind: 'diode', closed: `${M2.dispatchSw} == 1`, cb: { name: 'dispatch', ratingA: 15 } },
      { id: 'disp_relay2', a: 'aux', b: 'avn2_d', kind: 'diode', closed: `${M2.dispatchSw} == 1` },
      // Aux battery "works in conjunction with the primary ship's battery to allow for all aircraft systems, including
      // avionics, to be powered on during engine starts" (S&D15 §9.4): it supports the emergency bus and AVN 2 while a
      // starter is engaged; recharges from the emergency bus otherwise (EST).
      { id: 'aux_support', a: 'aux', b: 'emer', kind: 'diode', closed: `${M2.battSw} == 1 && (elec.sg1_starter || elec.sg2_starter)` },
      { id: 'aux_support2', a: 'aux', b: 'avn2', kind: 'diode', closed: `${M2.battSw} == 1 && (elec.sg1_starter || elec.sg2_starter)` },
      { id: 'aux_charge', a: 'emer', b: 'aux', kind: 'diode', closed: `!(elec.sg1_starter || elec.sg2_starter) && ${M2.battSw} == 1 && ${M2.dispatchSw} != 1`, cb: { name: 'aux_batt', ratingA: 10 } },
    ],
    loads,
  });
}

/** Load ids whose `_powered` flag the avionics / other systems read. */
export const ELEC_POWER = {
  pfd1: pw('pfd1'),
  pfd2: pw('pfd2'),
  mfd: pw('mfd'),
  gtc1: pw('gtc1'),
  gtc2: pw('gtc2'),
  gia1: pw('gia1'),
  gia2: pw('gia2'),
  adc1: pw('adc1'),
  adc2: pw('adc2'),
  ahrs1: pw('ahrs1'),
  ahrs2: pw('ahrs2'),
  gmc: pw('gmc'),
  apServos: pw('ap_servos'),
  ra: pw('ra'),
  tcas: pw('tcas'),
  xpdr1: pw('xpdr1'),
  xpdr2: pw('xpdr2'),
  spdBrk: pw('spd_brk'),
  radar: pw('radar'),
  dme: pw('dme'),
  esi: pw('esi'),
  gea: pw('gea'),
  fireDet: pw('fire_det'),
  gearCtl: pw('gear_ctl'),
  flapCtl: pw('flap_ctl'),
  stallWarn: pw('stall_warn'),
  antiskid: pw('antiskid'),
  pressCtl: pw('press_ctl'),
  trim: pw('trim_pitch'),
} as const;
