/**
 * Gulfstream G650 crew alerting system messages. Colours: red = 'warning'
 * (MASTER WARNING + aural), amber = 'caution' (MASTER CAUTION + chime), blue =
 * 'advisory' (CAS only), white = 'status'. Text, colour and trigger follow
 * the published sources where one exists:
 *  - LUC system notes (code450.com/g650): electrical ("L-R AC Power Fail",
 *    "APU Power Fail", "RAT Generator On", "L Generator Off/Fail", "Fwd/Aft
 *    Emer Battery On"), hydraulics ("L/R/L-R Hyd System Fail", "L Hydraulic
 *    Quantity Low", "Aux Hyd Pump On", "PTU Hyd On", "PTU Hydraulic Fail"),
 *    fuel ("L-R Fuel Level Low" 650 lb, "Fuel Imbalance", "Fuel Crossflow Valve
 *    Open", "Fuel Inter Tank Valve Open", "R Alt Fuel Pump Fail", "Fuel Tank
 *    Temperature"), powerplant ("Oil Pressure Low" 35/25 psi, "Oil
 *    Temperature High" 160 C, "L-R Autostart Abort"), pneumatics ("Bleed
 *    Pressure Low/High", "Isolation Valve Open"), ECS ("Ram Air Selected On"),
 *    pressurization ("Cabin Pressure Low" trip vs landing field elevation,
 *    "Cabin Differential - 10.80 / - 11.00", "Cabin Pressure Manual", "CPCS
 *    Fail - Select Manual"), ice ("L-R Ice Detected", "L Wing Temperature Low",
 *    "L-R Wing / Cowl Anti-Ice ON"), flight controls ("FCC Alternate Mode",
 *    "FCC Direct Mode", "AOA Limiting", "Stall Protection Active",
 *    "Speed Brake Auto Retract", "Aircraft Configuration", "Flaps Failed"),
 *    gear / brakes ("Parking Brake On", "Brake by Wire Fail", "Brake
 *    Overheat" 600 C, "Autobrake - Low/Medium/High/RTO", "Steer by Wire Fail",
 *    "Pedal Steering Off"), fire ("L/R Engine Fire", "APU Fire", "L/R Fire
 *    Bottle Discharge", "Fire Detection Loop Fault"), oxygen ("Passenger
 *    Oxygen On").
 *  - Epic GULFSTREAM_CAS_TEXTS (FAA FSB GVI, code450 checklists): "Yaw Damper
 *    Off", "Stall Protection Unavail", "Elevator Trim Up/Down Limit", "Ground
 *    Spoiler Unarm", "IRS 1-2-3 Aligning", "Main Door", "External Baggage Door".
 * EST texts (no public source for the exact wording) are marked in the
 * comment; conditions and delays marked EST are estimates.
 */
import type { CasMessageDef } from '../../../systems/warning';
import { G650_LIMITS, LB } from '../data';
import { FUEL_LOW_KG } from './fuel';
import { G650_VARS as V } from '../vars';

const TO = 'takeoff' as const;
const TL = 'takeoff+landing' as const;
const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';

type Side = { s: 'L' | 'R'; l: 'l' | 'r'; i: 1 | 2; tank: 'left' | 'right'; hyd: 'left' | 'right' };
const L: Side = { s: 'L', l: 'l', i: 1, tank: 'left', hyd: 'left' };
const R: Side = { s: 'R', l: 'r', i: 2, tank: 'right', hyd: 'right' };

/** Per-side message pair plus the combined "L-R ..." message (Gulfstream convention): the singles clear when both. */
function lr(id: string, text: string, level: CasMessageDef['level'], when: (x: Side) => string, extra: Partial<CasMessageDef> = {}): CasMessageDef[] {
  const wl = `(${when(L)})`;
  const wr = `(${when(R)})`;
  return [
    { id: `${id}_l`, text: `L ${text}`, level, when: `${wl} && !${wr}`, ...extra },
    { id: `${id}_r`, text: `R ${text}`, level, when: `${wr} && !${wl}`, ...extra },
    { id: `${id}_lr`, text: `L-R ${text}`, level, when: `${wl} && ${wr}`, ...extra },
  ];
}
/** Per-side messages without a combined form. */
function each(f: (x: Side) => CasMessageDef[]): CasMessageDef[] {
  return [...f(L), ...f(R)];
}

const genSw = (x: Side) => (x.l === 'l' ? V.genL : V.genR);
const fireHandle = (x: Side) => (x.l === 'l' ? V.fireHandleL : V.fireHandleR);
/** LUC: "Cabin Pressure Low" trip altitude vs landing field elevation (AUTO/SEMI). */
const cabinLowFt = `(press.ldg_elev_ft <= 7500 ? 8000 : press.ldg_elev_ft <= 9500 ? 10000 : press.ldg_elev_ft <= 14000 ? 14500 : 15500)`;

export const G650_CAS: CasMessageDef[] = [
  // ================================================================ RED
  ...each((x) => [
    { id: `eng_fire_${x.l}`, text: `${x.s} Engine Fire`, level: 'warning', when: `fire.eng${x.i}_warn`, aural: { callout: `Engine fire ${x.s === 'L' ? 'left' : 'right'}`, priority: 9, repeatS: 8 } },
    { id: `oil_press_w_${x.l}`, text: `${x.s} Oil Pressure Low`, level: 'warning', when: `eng${x.i}.running && eng${x.i}.oil_press_psi < ${G650_LIMITS.oilPressMinPsi}`, delayS: 2, inhibit: TL },
    { id: `oil_temp_w_${x.l}`, text: `${x.s} Oil Temperature High`, level: 'warning', when: `eng${x.i}.oil_temp_c > ${G650_LIMITS.oilTempMaxC}`, inhibit: TL },
    // EST text: engine stopped with its FUEL CONTROL switch at RUN (FADEC flameout detection).
    { id: `eng_fail_${x.l}`, text: `${x.s} Engine Fail`, level: 'warning', when: V.engFail(x.i), aural: { callout: 'Engine fail', priority: 8, repeatS: 10 } },
  ]),
  { id: 'apu_fire', text: 'APU Fire', level: 'warning', when: 'fire.apu_warn', aural: { callout: 'APU fire', priority: 9, repeatS: 8 } },
  { id: 'cabin_press_low', text: 'Cabin Pressure Low', level: 'warning', when: `press.cabin_alt_ft > ${cabinLowFt} || (${V.pressMode} == 2 && press.cabin_alt_ft > 8000)`, aural: { callout: 'Cabin pressure', priority: 8, repeatS: 10 } },
  { id: 'cabin_diff_11', text: 'Cabin Differential - 11.00', level: 'warning', when: `press.diff_psi > ${G650_LIMITS.reliefSecondPsi}` },
  { id: 'aircraft_config', text: 'Aircraft Configuration', level: 'warning', when: V.aircraftConfig, delayS: 1, aural: { callout: 'Speed brake', priority: 6, repeatS: 5 } },
  { id: 'fuel_tank_temp_w', text: 'Fuel Tank Temperature', level: 'warning', when: 'fuel.left_temp_c < -37 || fuel.right_temp_c < -37 || fuel.left_temp_c >= 54 || fuel.right_temp_c >= 54', delayS: 10, inhibit: TL },
  // EST text: takeoff thrust with the aircraft not in takeoff configuration (flaps 10/20, trim in the green band,
  // speed brake stowed, parking brake off, Normal law: LIM "T/O prohibited ... other than Normal").
  { id: 'to_config', text: 'Takeoff Configuration', level: 'warning', when: `${V.noTakeoff} && ${V.toThrust}`, aural: { callout: 'Takeoff configuration', priority: 7, repeatS: 3 } },

  // ================================================================ AMBER
  // ---- electrical
  ...lr('gen_fail', 'Generator Fail', 'caution', (x) => `eng${x.i}.running && ${genSw(x)} == 1 && !elec.idg${x.i}_online`, { delayS: 2, inhibit: TL }),
  ...lr('gen_off', 'Generator Off', 'caution', (x) => `eng${x.i}.running && ${genSw(x)} == 0`, { inhibit: TL }),
  ...lr('ac_fail', 'AC Power Fail', 'caution', (x) => `!elec.${x.l}_main_ac_powered && (elec.l_ess_dc_powered || elec.r_ess_dc_powered) && (eng1.running || eng2.running || elec.apu_gen_online || elec.gpu_online)`, { delayS: 1, inhibit: TL }),
  ...lr('ess_tru_fail', 'Ess TRU Fail', 'caution', (x) => `elec.${x.l}_ess_ac_powered && !elec.${x.l}_ess_tru_online`, { delayS: 2, inhibit: TL }), // EST text
  ...lr('ess_dc_fail', 'Ess DC Power Fail', 'caution', (x) => `!elec.${x.l}_ess_dc_powered && elec.emer_dc_powered`, { delayS: 1, inhibit: TL }), // EST text
  { id: 'apu_power_fail', text: 'APU Power Fail', level: 'caution', when: `apu.avail && ${V.apuGen} == 1 && !elec.apu_gen_online`, delayS: 3, inhibit: TL },
  { id: 'rat_gen_on', text: 'RAT Generator On', level: 'caution', when: 'elec.rat_online', inhibit: TL },
  ...lr('main_batt_off', 'Main Battery Off', 'caution', (x) => `${x.l === 'l' ? V.battL : V.battR} == 0 && (elec.l_ess_dc_powered || elec.r_ess_dc_powered)`, { inhibit: TL }), // EST text
  { id: 'fcs_batt_off', text: 'Flight Control Battery Off', level: 'caution', when: `(${V.ebhaBatt} == 0 || ${V.upsBatt} == 0) && (eng1.running || eng2.running)`, inhibit: TL }, // EST text
  // ---- hydraulics
  ...lr('hyd_fail', 'Hyd System Fail', 'caution', (x) => `hyd.${x.hyd}_lowpress && eng${x.i}.running`, { delayS: 3, inhibit: TL }),
  ...lr('hyd_qty', 'Hydraulic Quantity Low', 'caution', (x) => `hyd.${x.hyd}_lowqty`, { delayS: 5, inhibit: TL }),
  { id: 'ptu_fail', text: 'PTU Hydraulic Fail', level: 'caution', when: `${V.ptuCmd} && hyd.left_psi < ${G650_LIMITS.hydLowPsi}`, delayS: 10, inhibit: TL },
  // ---- fuel
  ...lr('fuel_low', 'Fuel Level Low', 'caution', (x) => `fuel.tank${x.i - 1}_kg < ${FUEL_LOW_KG.toFixed(1)}`, { delayS: 5, inhibit: TL }),
  ...lr('main_pump_fail', 'Main Fuel Pump Fail', 'caution', (x) => `${x.l === 'l' ? V.boostL : V.boostR} >= 1 && !fuel.boost_${x.l}_on && fuel.${x.tank}_usable_kg > 1`, { delayS: 3, inhibit: TL }),
  ...lr('alt_pump_fail', 'Alt Fuel Pump Fail', 'caution', (x) => `${x.l === 'l' ? V.altL : V.altR} >= 1 && !fuel.alt_${x.l}_on && fuel.${x.tank}_usable_kg > 1`, { delayS: 3, inhibit: TL }),
  ...lr('fuel_press', 'Engine Fuel Pressure', 'caution', (x) => `eng${x.i}.running && fuel.eng${x.i}_lowpress && !fuel.eng${x.i}_suction`, { delayS: 3, inhibit: TL }),
  { id: 'fuel_tank_temp_c', text: 'Fuel Tank Temperature', level: 'caution', when: '(fuel.left_temp_c < -34.5 && fuel.left_temp_c >= -37) || (fuel.right_temp_c < -34.5 && fuel.right_temp_c >= -37)', delayS: 10, inhibit: TL },
  { id: 'xflow_open_c', text: 'Fuel Crossflow Valve Open', level: 'caution', when: 'fuel.xflow_open', delayS: 600, inhibit: TL }, // LUC/SCQ: blue -> amber after 5-10 min
  // ---- powerplant
  ...lr('oil_press_c', 'Oil Pressure Low', 'caution', (x) => `eng${x.i}.running && eng${x.i}.oil_press_psi < ${G650_LIMITS.oilPressCautionPsi} && eng${x.i}.oil_press_psi >= ${G650_LIMITS.oilPressMinPsi}`, { delayS: 3, inhibit: TL }),
  ...lr('autostart_abort', 'Autostart Abort', 'caution', (x) => `fadec.eng${x.i}.abort`, { inhibit: TL }),
  ...lr('eng_exceed', 'Engine Exceedance', 'caution', (x) => `eng${x.i}.n1_pct > ${G650_LIMITS.n1TakeoffPct + 0.1} || eng${x.i}.n2_pct > ${G650_LIMITS.n2TakeoffPct + 0.1} || eng${x.i}.itt_c > ${G650_LIMITS.tgtTakeoffC}`, { delayS: 1, latch: true, inhibit: TL }), // EST text
  // ---- bleed / ECS / pressurization
  ...lr('bleed_low', 'Bleed Pressure Low', 'caution', (x) => `${x.l === 'l' ? V.bleedL : V.bleedR} == 1 && eng${x.i}.running && pneu.${x.l}_duct_psi < 5`, { delayS: 10, inhibit: TL }),
  ...lr('bleed_high', 'Bleed Pressure High', 'caution', (x) => `pneu.${x.l}_duct_psi > 75`, { delayS: 3, inhibit: TL }),
  { id: 'ram_air', text: 'Ram Air Selected On', level: 'caution', when: `${V.ramAir} == 1`, inhibit: TL },
  { id: 'cabin_diff_1080', text: 'Cabin Differential - 10.80', level: 'caution', when: `press.diff_psi > ${G650_LIMITS.reliefPsi} && press.diff_psi <= ${G650_LIMITS.reliefSecondPsi}`, delayS: 2, inhibit: TL },
  { id: 'cabin_manual', text: 'Cabin Pressure Manual', level: 'caution', when: `${V.pressMode} == 2`, inhibit: TL },
  { id: 'cpcs_fail', text: 'CPCS Fail - Select Manual', level: 'caution', when: `press.auto_fail && press.altn_fail && ${V.pressMode} != 2`, delayS: 2, inhibit: TL },
  { id: 'pax_oxy_on', text: 'Passenger Oxygen On', level: 'caution', when: 'oxy.pax_on' },
  // ---- ice
  { id: 'ice_detected', text: 'L-R Ice Detected', level: 'caution', when: `ice.detected && ${air}`, inhibit: TL },
  ...lr('wing_temp_low', 'Wing Temperature Low', 'caution', (x) => `${V.waiCmd(x.l)} && pneu.wai_${x.l}_ok < 0.5`, { delayS: 120, inhibit: TL }),
  ...lr('cowl_ai_fail', 'Cowl Anti-Ice Fail', 'caution', (x) => `${V.caiCmd(x.l)} && pneu.cai_${x.l}_ok < 0.5 && eng${x.i}.running`, { delayS: 10, inhibit: TL }), // EST text
  ...lr('probe_heat', 'Probe Heat Fail', 'caution', (x) => (x.l === 'l' ? `(${V.probeHeatOn(1)} && !elec.probe1_powered) || (${V.probeHeatOn(3)} && !elec.probe3_powered)` : `(${V.probeHeatOn(2)} && !elec.probe2_powered) || (${V.probeHeatOn(4)} && !elec.probe4_powered)`), { delayS: 5, inhibit: TL }), // EST text
  // ---- flight controls
  { id: 'fcc_alternate', text: 'FCC Alternate Mode', level: 'caution', when: 'fbw.mode_code == 1', inhibit: TO },
  { id: 'fcc_direct', text: 'FCC Direct Mode', level: 'caution', when: 'fbw.mode_code == 2', inhibit: TO },
  { id: 'stall_prot_unavail', text: 'Stall Protection Unavail', level: 'caution', when: 'fbw.mode_code != 0 && (eng1.running || eng2.running)', inhibit: TO },
  { id: 'stall_prot_active', text: 'Stall Protection Active', level: 'caution', when: `${air} && stall.aoa_norm >= 0.96` },
  { id: 'yaw_damper_off', text: 'Yaw Damper Off', level: 'caution', when: `fbw.mode_code == 2 && (eng1.running || eng2.running)`, inhibit: TO },
  { id: 'sb_auto_retract', text: 'Speed Brake Auto Retract', level: 'caution', when: V.sbAutoRetract, inhibit: TL },
  { id: 'flaps_failed', text: 'Flaps Failed', level: 'caution', when: 'flaps.asym || flaps.disagree', delayS: 2, inhibit: TO },
  { id: 'steer_fail', text: 'Steer by Wire Fail', level: 'caution', when: `${V.nwsPower} == 1 && ${gnd} && (eng1.running || eng2.running) && (!elec.nwscu_powered || hyd.left_psi < 1000 || fail.steer)`, delayS: 2, inhibit: TL },
  { id: 'brake_bbw_fail', text: 'Brake by Wire Fail', level: 'caution', when: '(!elec.bcu_a_powered && !elec.bcu_b_powered) || fail.brakes.left || fail.brakes.right', delayS: 2, inhibit: TO },
  { id: 'brake_overheat', text: 'Brake Overheat', level: 'caution', when: `brakes.temp_left_c > ${G650_LIMITS.brakeOverheatC} || brakes.temp_right_c > ${G650_LIMITS.brakeOverheatC}`, inhibit: TL },
  { id: 'gear_disagree', text: 'Landing Gear Disagree', level: 'caution', when: 'gear.disagree', inhibit: TO }, // EST text
  // LIM: "Max. Operating Altitude w/interior baggage door open: 40,000 ft" (EST text).
  { id: 'int_baggage_door', text: 'Baggage Door Open', level: 'caution', when: `${V.doorBaggage} > 0.02 && adc1.press_alt_ft > 40000`, delayS: 2 },
  { id: 'ext_baggage_door', text: 'External Baggage Door', level: 'caution', when: `${V.doorExtBaggage} > 0.02 && (eng1.running || eng2.running)` },
  // ---- fire
  { id: 'bottle_r_disch', text: 'R Fire Bottle Discharge', level: 'caution', when: 'fire.bottle_r_discharged' },
  { id: 'bottle_l_disch', text: 'L Fire Bottle Discharge', level: 'caution', when: 'fire.bottle_l_discharged' },
  { id: 'fire_loop_fault', text: 'Fire Detection Loop Fault', level: 'caution', when: 'fire.eng1_fault || fire.eng2_fault', delayS: 0.5 },

  // ================================================================ BLUE (advisory)
  { id: 'fwd_emer_batt', text: 'Fwd Emer Battery On', level: 'advisory', when: V.ebattOn },
  { id: 'aft_emer_batt', text: 'Aft Emer Battery On', level: 'advisory', when: V.ebattOn },
  { id: 'aux_hyd_on', text: 'Aux Hyd Pump On', level: 'advisory', when: 'hyd.aux_on', inhibit: TL },
  { id: 'ptu_on', text: 'PTU Hyd On', level: 'advisory', when: 'hyd.ptu_active', inhibit: TL },
  { id: 'fuel_imbalance', text: 'Fuel Imbalance', level: 'advisory', when: `abs(fuel.imbalance_kg) > ${(1000 * LB).toFixed(1)}`, delayS: 10, inhibit: TL },
  { id: 'xflow_open_a', text: 'Fuel Crossflow Valve Open', level: 'advisory', when: 'fuel.xflow_open && !cas.xflow_open_c', inhibit: TL },
  { id: 'intertank_open', text: 'Fuel Inter Tank Valve Open', level: 'advisory', when: `${V.interTank} == 1`, inhibit: TL },
  { id: 'isolation_valve_open', text: 'Isolation Valve Open', level: 'advisory', when: `pneu.iso_open && !(${V.startMaster} == 1 || ${V.crankMaster} == 1)`, inhibit: TL },
  ...lr('wing_ai_on', 'Wing Anti-Ice ON', 'advisory', (x) => V.waiCmd(x.l), { inhibit: TL }),
  ...lr('cowl_ai_on', 'Cowl Anti-Ice ON', 'advisory', (x) => V.caiCmd(x.l), { inhibit: TL }),
  { id: 'aoa_limiting', text: 'AOA Limiting', level: 'advisory', when: `fbw.aoa_limit && ${air}` },
  { id: 'hs_protect', text: 'High Speed Protect Active', level: 'advisory', when: 'fbw.hs_protect' },
  { id: 'elev_trim_up', text: 'Elevator Trim Up Limit', level: 'advisory', when: 'trim.pitch_units >= 0.98', inhibit: TL },
  { id: 'elev_trim_dn', text: 'Elevator Trim Down Limit', level: 'advisory', when: 'trim.pitch_units <= -0.98', inhibit: TL },
  { id: 'sb_extended', text: 'Speed Brake Extended', level: 'advisory', when: `spoilers.sb_ext > 0.05 && ${air}`, inhibit: TL },
  { id: 'gnd_spoiler_unarm', text: 'Ground Spoiler Unarm', level: 'advisory', when: `${V.gndSpoiler} == 0 && (eng1.running || eng2.running)`, inhibit: TL },
  { id: 'parking_brake_on', text: 'Parking Brake On', level: 'advisory', when: 'brakes.parking_set', inhibit: TL },
  { id: 'autobrake_low', text: 'Autobrake - Low', level: 'advisory', when: `${V.autobrake} == 1` },
  { id: 'autobrake_med', text: 'Autobrake - Medium', level: 'advisory', when: `${V.autobrake} == 2` },
  { id: 'autobrake_high', text: 'Autobrake - High', level: 'advisory', when: `${V.autobrake} == 3` },
  { id: 'autobrake_rto', text: 'Autobrake - RTO', level: 'advisory', when: `${V.autobrake} == -1` },
  { id: 'pedal_steering_off', text: 'Pedal Steering Off', level: 'advisory', when: `${V.nwsPower} == 0 && (eng1.running || eng2.running)` },
  { id: 'irs_aligning', text: 'IRS 1-2-3 Aligning', level: 'advisory', when: 'ahrs1.aligning || ahrs2.aligning || ahrs3.aligning' },
  { id: 'main_door', text: 'Main Door', level: 'advisory', when: `${V.doorMain} > 0.02` },
  { id: 'fcs_batt_disch', text: 'Flight Control Battery On', level: 'advisory', when: V.fcsBatt, inhibit: TL }, // EST text (LUC: "ON" legend when discharging)
  { id: 'cont_ign', text: 'Continuous Ignition On', level: 'advisory', when: `${V.contIgn} == 1`, inhibit: TL }, // EST text
  ...lr('fuel_return_on', 'Fuel Return On', 'advisory', (x) => V.hfrsOn(x.i), { inhibit: TL }), // EST text

  // ================================================================ WHITE (status)
  ...each((x) => [{ id: `fire_handle_${x.l}`, text: `${x.s} Fire Handle Pulled`, level: 'status' as const, when: fireHandle(x) }]), // EST text
];
