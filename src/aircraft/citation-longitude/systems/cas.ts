/**
 * Citation Longitude CAS messages (OG Section 3 "Crew Alert Messages", with
 * the triggering descriptions of Sections 5-15). Levels: red = 'warning'
 * (MASTER WARNING + tone), amber = 'caution' (MASTER CAUTION + chime), white =
 * 'advisory' (CAS only). Inhibits: TOPI = 'takeoff', LOPI = 'landing'; ESDI
 * (an engine shut down), In Air / On Ground are folded into the conditions.
 * Where the OG gives the same text in two colours, the conditions are made
 * mutually exclusive as the OG describes (e.g. BUS TIE CLOSED white, amber
 * after 5 min with both primary sources).
 *
 * Fire warnings (ENG FIRE L/R, APU FIRE) are not in the OG list (the OG does
 * not model fire protection); they follow the Citation-family convention (EST).
 */
import type { CasMessageDef } from '../../../systems/warning';
import { LB, LON_LIMITS } from '../data';
import { FUEL_LOW_KG } from './fuel';
import { LON_VARS as V } from '../vars';

const TO = 'takeoff' as const;
const TL = 'takeoff+landing' as const;
const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';
const bothRun = '(eng1.running && eng2.running)';
const primL = '(elec.gen_l_online || elec.apu_gen_online || elec.gpu_online)';
const primR = '(elec.gen_r_online || elec.ptcu_gen_online)';
/** OG CAS BRAKE FAIL: the normal (brake-by-wire) braking is lost; "only emergency/parking brakes will be available". */
export const LON_BRAKE_FAIL = '(fail.brakes.left || fail.brakes.right || (hyd.a_psi < 1000 && hyd.b_psi < 1000 && brakes.accum_psi < 1000) || !elec.brake_ctl_powered)';
const brakeFail = LON_BRAKE_FAIL;
const allAi = `(${V.aiEngL} && ${V.aiEngR} && ${V.aiWing} && ${V.aiStab})`;
/** OG 11-3 high-altitude mode: departure (latched at lift-off) or destination field above 8,000 ft (logic.ts). */
const highAlt = `(${V.highAltLatched} != 0)`;
/** OG CAS GENS OFF: generators are available but every available one is selected OFF. */
const gensOff = `((elec.gen_l_avail || elec.gen_r_avail || elec.apu_gen_avail) && !(elec.gen_l_avail && ${V.genL} == 1) && !(elec.gen_r_avail && ${V.genR} == 1) && !(elec.apu_gen_avail && ${V.genApu} == 1))`;

type Side = { s: 'L' | 'R'; l: 'l' | 'r'; i: 1 | 2; tank: string; ab: 'A' | 'B'; h: 'a' | 'b' };
const SIDES: Side[] = [
  { s: 'L', l: 'l', i: 1, tank: 'left', ab: 'A', h: 'a' },
  { s: 'R', l: 'r', i: 2, tank: 'right', ab: 'B', h: 'b' },
];

function perSide(f: (x: Side) => CasMessageDef[]): CasMessageDef[] {
  return SIDES.flatMap(f);
}

export const LONGITUDE_CAS: CasMessageDef[] = [
  // =============================================================== RED WARNINGS
  ...perSide((x) => [
    { id: `eng_fire_${x.l}`, text: `ENG FIRE ${x.s}`, level: 'warning', when: `fire.eng${x.i}_warn`, aural: { callout: `Engine fire ${x.s === 'L' ? 'left' : 'right'}`, priority: 8, repeatS: 8 } },
    { id: `batt_otemp_w_${x.l}`, text: `BATTERY O'TEMP ${x.s}`, level: 'warning', when: `elec.batt_${x.l}_temp_c > ${LON_LIMITS.battOtempWarnC}`, inhibit: TL },
    // OG 1-3 limits (N1 96.79 %, N2 99.90 % transient, ITT 955 degC, 650 degC in the start) exceeded > 1 s. OG 3-5: the
    // exceedance must be logged for maintenance, so the message stays until the maintenance reset (logic.ts latch,
    // cleared by the state reset), not until MASTER WARNING is acknowledged.
    { id: `eng_exceed_${x.l}`, text: `ENG EXCEEDANCE ${x.s}`, level: 'warning', when: V.engExceed(x.i), inhibit: TL },
    { id: `engine_fail_${x.l}`, text: `ENGINE FAIL ${x.s}`, level: 'warning', when: V.engFail(x.i), aural: { callout: 'Engine fail', priority: 8, repeatS: 10 } },
    { id: `hyd_otemp_${x.h}`, text: `HYD O'TEMP ${x.ab}`, level: 'warning', when: `${V.hydTempC(x.h)} > ${LON_LIMITS.hydOtempC}`, inhibit: TL },
  ]),
  { id: 'apu_fire', text: 'APU FIRE', level: 'warning', when: 'fire.apu_warn', aural: { callout: 'APU fire', priority: 8, repeatS: 8 } },
  { id: 'brake_fail_w', text: 'BRAKE FAIL', level: 'warning', when: `${brakeFail} && (${gnd} || (ra1.valid && ra1.alt_ft < 400))`, inhibit: TO },
  { id: 'cabin_alt_w', text: 'CABIN ALTITUDE', level: 'warning', when: `press.cabin_alt_ft > (${highAlt} ? 14800 : ${LON_LIMITS.cabinAltWarnFt})`, inhibit: TL, aural: { callout: 'Cabin altitude', priority: 8, repeatS: 10 } },
  { id: 'cabin_dp', text: 'CABIN DELTA P', level: 'warning', when: `press.diff_psi > ${LON_LIMITS.cabinDeltaPWarnPsi}`, inhibit: TL },
  { id: 'gens_off', text: 'GENS OFF', level: 'warning', when: `${gensOff} && ${bothRun}`, inhibit: TL }, // ESDI inhibit (OG 3-5)
  {
    id: 'landing_gear',
    text: 'LANDING GEAR',
    level: 'warning',
    // OG 14-4: gear not down and locked with flaps beyond 2, or below 500 ft RA with the throttles near idle.
    when: `${air} && !gear.down_locked && (surf.flaps_deg > 16 || (ra1.valid && ra1.alt_ft < 500 && ${V.tla(1)} < 0.2 && ${V.tla(2)} < 0.2))`,
    aural: { callout: 'Landing gear', priority: 7, repeatS: 3 },
  },
  { id: 'no_takeoff_w', text: 'NO TAKEOFF', level: 'warning', when: `${V.noTakeoff} && ${V.toThrust}`, aural: { callout: 'No takeoff', priority: 7, repeatS: 3 } },
  { id: 'ps_button_w', text: 'P/S BUTTON ON', level: 'warning', when: `${V.pitotStatic} && ${gnd}`, delayS: 120, inhibit: TL }, // OG 1-1: prohibited beyond 2 min on the ground
  // EST (OG CAS list has no FADEC message; HTF7000 FADEC faults annunciate on the CAS): a FADEC channel fault.
  ...perSide((x) => [{ id: `eng_ctl_fault_${x.l}`, text: `ENG CONTROL FAULT ${x.s}`, level: 'caution' as const, when: V.fadecFault(x.i), delayS: 1, inhibit: TL }]),

  // =============================================================== AMBER CAUTIONS
  ...perSide((x) => [
    { id: `ai_eng_off_${x.l}`, text: `A/I ENG OFF ${x.s}`, level: 'caution', when: `${x.l === 'l' ? V.aiEngL : V.aiEngR} && pneu.eai_${x.l}_ok < 0.5 && eng${x.i}.running`, delayS: 5, inhibit: TL },
    { id: `ai_wing_off_${x.l}`, text: `A/I WING OFF ${x.s}`, level: 'caution', when: `${V.aiWing} && pneu.wai_${x.l}_ok < 0.5 && (eng1.running || eng2.running)`, delayS: 8, inhibit: TL },
    { id: `batt_disch_${x.l}`, text: `BATT DISCHARGE ${x.s}`, level: 'caution', when: `elec.batt_${x.l}_amps < -2 && ${x.l === 'l' ? V.battL : V.battR}`, delayS: 300, inhibit: TL },
    { id: `batt_amps_${x.l}`, text: `BATTERY AMPS ${x.s}`, level: 'caution', when: `abs(elec.batt_${x.l}_amps) > 300`, delayS: 2, inhibit: TL },
    { id: `batt_otemp_c_${x.l}`, text: `BATTERY O'TEMP ${x.s}`, level: 'caution', when: `elec.batt_${x.l}_temp_c > ${LON_LIMITS.battOtempCautionC} && elec.batt_${x.l}_temp_c <= ${LON_LIMITS.battOtempWarnC}`, inhibit: TL },
    { id: `batt_off_${x.l}`, text: `BATTERY OFF ${x.s}`, level: 'caution', when: `${x.l === 'l' ? V.battL : V.battR} == 0 && (elec.emer_l_powered || elec.emer_r_powered)`, inhibit: TL },
    // LFP battery: 8 x 3.0 V = 24.0 V (EST low-charge threshold).
    { id: `batt_volts_${x.l}`, text: `BATTERY VOLTS ${x.s}`, level: 'caution', when: `elec.batt_${x.l}_v < 24.0 && ${x.l === 'l' ? V.battL : V.battR}`, delayS: 3, inhibit: TL },
    { id: `brake_temp_${x.l}`, text: `BRAKE TEMP ${x.s}`, level: 'caution', when: `brakes.temp_${x.l === 'l' ? 'left' : 'right'}_c > ${LON_LIMITS.brakeTempCautionC}`, inhibit: TL },
    { id: `elec_emer_${x.l}`, text: `ELEC EMER ${x.s}`, level: 'caution', when: `${x.l === 'l' ? V.elecL : V.elecR} == 0`, inhibit: TL },
    { id: `emer_bus_off_${x.l}`, text: `EMER BUS OFF ${x.s}`, level: 'caution', when: `!elec.emer_${x.l}_powered && (elec.mission_l_powered || elec.mission_r_powered || elec.emer_l_powered || elec.emer_r_powered)`, delayS: 1, inhibit: TL },
    { id: `eng_bleed_off_c_${x.l}`, text: `ENG BLEED OFF ${x.s}`, level: 'caution', when: `${x.l === 'l' ? V.bleedEngL : V.bleedEngR} == 0 && ${gnd}`, inhibit: TL },
    { id: `fuel_inlet_cold_${x.l}`, text: `FUEL INLET COLD ${x.s}`, level: 'caution', when: `${V.fuelInletC(x.i)} < 3 && eng${x.i}.running`, delayS: 10, inhibit: TL },
    { id: `fuel_low_${x.l}`, text: `FUEL LEVEL LOW ${x.s}`, level: 'caution', when: `fuel.tank${x.i - 1}_kg < ${FUEL_LOW_KG.toFixed(1)}`, delayS: 5, inhibit: TL },
    { id: `fuel_tank_cold_${x.l}`, text: `FUEL TANK COLD ${x.s}`, level: 'caution', when: `fuel.${x.tank}_temp_c < -35`, delayS: 10, inhibit: TL },
    // OG 5-3: 75 % of the available capacity (400 A on the ground, 500 A in flight; logic.ts).
    { id: `gen_load_${x.l}`, text: `GEN LOAD ${x.s}`, level: 'caution', when: `${V.genLoadPct(x.l)} > 75`, delayS: 5, inhibit: TL },
    { id: `gen_off_${x.l}`, text: `GEN OFF ${x.s}`, level: 'caution', when: `elec.gen_${x.l}_avail && ${x.l === 'l' ? V.genL : V.genR} != 1 && !(${gensOff} && (eng1.running || eng2.running))`, delayS: 1, inhibit: TL },
    // Not in the OG list (it only covers GEN OFF = available but deselected): a generator that trips or fails
    // with its engine running and the switch ON posts GEN FAIL (EST, Citation-family CAS convention).
    { id: `gen_fail_${x.l}`, text: `GEN FAIL ${x.s}`, level: 'caution', when: `eng${x.i}.running && ${x.l === 'l' ? V.genL : V.genR} == 1 && !elec.gen_${x.l}_online`, delayS: 2, inhibit: TL },
    { id: `hyd_press_low_${x.h}`, text: `HYD PRESS LOW ${x.ab}`, level: 'caution', when: `hyd.${x.h}_lowpress && eng${x.i}.running`, delayS: 3, inhibit: TL },
    { id: `hyd_shutoff_c_${x.h}`, text: `HYD SHUTOFF ${x.ab}`, level: 'caution', when: `${x.h === 'a' ? V.hydPumpA : V.hydPumpB} == 2 && eng${x.i}.running`, inhibit: TL },
    { id: `main_bus_off_${x.l}`, text: `MAIN BUS OFF ${x.s}`, level: 'caution', when: `!elec.main_${x.l}_powered && elec.mission_${x.l}_powered`, delayS: 1, inhibit: TL },
    { id: `mission_bus_off_${x.l}`, text: `MISSION BUS OFF ${x.s}`, level: 'caution', when: `!elec.mission_${x.l}_powered && elec.emer_${x.l}_powered`, delayS: 1, inhibit: TL },
    { id: `press_src_off_c_${x.l}`, text: `PRESS SOURCE OFF ${x.s}`, level: 'caution', when: `${x.l === 'l' ? V.pressSrcL : V.pressSrcR} == 0 && ${air}`, inhibit: TL },
    { id: `gear_disagree_${x.l}`, text: `GEAR DISAGREE ${x.s}`, level: 'caution', when: `gear.disagree && gear.red${x.i}`, inhibit: TO },
  ]),
  { id: 'gear_disagree_n', text: 'GEAR DISAGREE N', level: 'caution', when: 'gear.disagree && gear.red0', inhibit: TO },
  { id: 'apu_bleed_off_c', text: 'APU BLEED OFF', level: 'caution', when: `${V.bleedApu} == 0 && apu.running && ${gnd}`, inhibit: TL },
  { id: 'apu_on_c', text: 'APU ON', level: 'caution', when: `apu.running && adc1.press_alt_ft > ${LON_LIMITS.apuMaxOpFt}`, inhibit: TL },
  { id: 'batt_low_to', text: 'BATTERY LOW TAKEOFF', level: 'caution', when: `(elec.batt_l_amps > 20 || elec.batt_r_amps > 20) && ${V.toThrust} && ${gnd}`, inhibit: TL },
  {
    id: 'bleed_iso_norm',
    text: 'BLEED ISOLATE NORM',
    level: 'caution',
    // OG 9-4: in the air with an engine shut down > 2 min, or during an in-air start, in NORM.
    when: `${V.bleedIsolate} == 0 && ${air} && (!eng1.running || !eng2.running)`,
    delayS: 120,
    inhibit: TL,
  },
  { id: 'bleed_iso_xflow_c', text: 'BLEED ISOLATE XFLOW', level: 'caution', when: `${V.bleedIsolate} && ((${gnd} && ${V.toThrust}) || (pneu.eng1_valve_open && pneu.eng2_valve_open && ac.lon.bleed.xflow_5min))`, inhibit: TL },
  { id: 'brake_fail_c', text: 'BRAKE FAIL', level: 'caution', when: `${brakeFail} && ${air} && !(ra1.valid && ra1.alt_ft < 400)`, inhibit: TL },
  { id: 'bus_tie_c', text: 'BUS TIE CLOSED', level: 'caution', when: `elec.bus_tie_closed && ${primL} && ${primR}`, delayS: 300, inhibit: TL },
  { id: 'cabin_alt_c', text: 'CABIN ALTITUDE', level: 'caution', when: `!${highAlt} && press.cabin_alt_ft > ${LON_LIMITS.cabinAltCautionFt} && press.cabin_alt_ft <= ${LON_LIMITS.cabinAltWarnFt}`, delayS: 1, inhibit: TL },
  // High-altitude mode: amber after the cabin has been above 9,800 ft for 10 min (OG 3 CAS list; OG 11-3 says 30 min,
  // the CAS list is followed). Above 14,800 ft it is the red CABIN ALTITUDE (OG 3; OG 11-3 says amber).
  { id: 'cabin_alt_c_high', text: 'CABIN ALTITUDE', level: 'caution', when: `${highAlt} && press.cabin_alt_ft > 9800 && press.cabin_alt_ft <= 14800`, delayS: 600, inhibit: TL },
  { id: 'fuel_imbalance', text: 'FUEL IMBALANCE', level: 'caution', when: `abs(fuel.imbalance_kg) > ${(LON_LIMITS.maxFuelImbalanceLb * LB).toFixed(1)}`, delayS: 10, inhibit: TL },
  { id: 'fuel_temp_miscomp', text: 'FUEL TEMP MISCOMPARE', level: 'caution', when: 'abs(fuel.left_temp_c - fuel.right_temp_c) > 5', delayS: 30, inhibit: TL },
  { id: 'fuel_xfer_fail', text: 'FUEL TRANSFER FAIL', level: 'caution', when: `${V.fuelTransfer} != 0 && fuel.boost_l_on && fuel.boost_r_on`, delayS: 5, inhibit: TL },
  {
    id: 'fuel_xfer_on_c',
    text: 'FUEL TRANSFER ON',
    level: 'caution',
    // OG 6-4: transferring into a tank already holding >= 60 lb more (or on for > 10 min: see fuel_xfer_10min).
    when: `(${V.fuelTransfer} == -1 && fuel.tank0_kg - fuel.tank1_kg > ${(60 * LB).toFixed(2)}) || (${V.fuelTransfer} == 1 && fuel.tank1_kg - fuel.tank0_kg > ${(60 * LB).toFixed(2)})`,
    delayS: 2,
    inhibit: TL,
  },
  { id: 'fuel_xfer_on_10', text: 'FUEL TRANSFER ON', level: 'caution', when: `${V.fuelTransfer} != 0`, delayS: 600, inhibit: TL },
  { id: 'gen_load_apu', text: 'GEN LOAD APU', level: 'caution', when: `${V.genLoadPct('apu')} > 75`, delayS: 5, inhibit: TL }, // 500 A ground / 400 A flight
  { id: 'gen_load_hyd', text: 'GEN LOAD HYD', level: 'caution', when: 'elec.ptcu_gen_load_pct > 75', delayS: 5, inhibit: TL },
  // OG 3-8 / 5-5: "the generator is operational and available but selected OFF" (GENS OFF covers all-off).
  { id: 'gen_off_apu', text: 'GEN OFF APU', level: 'caution', when: `elec.apu_gen_avail && ${V.genApu} != 1 && !(${gensOff} && ${bothRun})`, delayS: 1, inhibit: TL },
  { id: 'gnd_splr_fail', text: 'GND SPOILER FAIL', level: 'caution', when: 'ac.lon.gs_accum_ok <= 2', delayS: 2, inhibit: TL },
  { id: 'grd_splr_accum', text: 'GRD SPOILER ACCUM', level: 'caution', when: `ac.lon.gs_accum_ok == 3 && ${bothRun}`, delayS: 2, inhibit: TO },
  // OG 10-3: yellow on the ground, or when the system has automatically switched to heat-exchanger mode (ACM fault,
  // logic.ts) and the knob is not in that position.
  { id: 'heat_exchg_only_c', text: 'HEAT EXCHG ONLY', level: 'caution', when: `(${V.ecsMode} == 2 && ${gnd}) || ${V.ecsAutoHx}`, inhibit: TL },
  { id: 'acm_only_c', text: 'ACM ONLY', level: 'caution', when: `${V.ecsMode} == 1 && ${gnd}`, inhibit: TL },
  { id: 'hyd_gen_on_c', text: 'HYD GEN ON', level: 'caution', when: `hyd.ptcu_gen_cmd && (elec.gen_l_online || elec.gen_r_online || elec.apu_gen_online || elec.gpu_online)`, inhibit: TL },
  { id: 'icing', text: 'ICING', level: 'caution', when: `ice.detected && !${allAi}`, inhibit: TL },
  { id: 'park_brake_low', text: 'PARK BRAKE LOW PRESS', level: 'caution', when: 'brakes.parking_set && brakes.accum_psi < 1500', delayS: 2, inhibit: TL },
  { id: 'park_brake_on_c', text: 'PARK BRAKE ON', level: 'caution', when: `brakes.parking_set && (${V.tla(1)} > 0.1 || ${V.tla(2)} > 0.1) && !${V.toThrust}`, inhibit: TL },
  { id: 'press_manual', text: 'PRESS MODE MANUAL', level: 'caution', when: `${V.pressMode} == 1`, inhibit: TL },
  { id: 'ptcu_not_norm', text: 'PTCU NOT NORM', level: 'caution', when: `${V.ptcu} != 2 && ${gnd} && (eng1.running || eng2.running || fadec.eng1.starter_cmd || fadec.eng2.starter_cmd)`, inhibit: 'landing' },
  { id: 'rudder_fail', text: 'RUDDER FAIL A-B', level: 'caution', when: `hyd.a_psi < 1500 && hyd.rss_psi < 1500 && ${bothRun}`, delayS: 2, inhibit: TL },
  { id: 'rudder_stby_off', text: 'RUDDER STANDBY OFF', level: 'caution', when: `${V.rudderStby} == 0`, inhibit: TL },
  { id: 'sb_auto_stow', text: 'SPEEDBRAKE AUTO STOW', level: 'caution', when: V.sbAutoStow, inhibit: TL },
  { id: 'speedbrakes', text: 'SPEEDBRAKES', level: 'caution', when: `${air} && ra1.valid && ra1.alt_ft < 500 && spoilers.sb_ext > 0.05`, inhibit: TO },
  // STANDBY YAW DAMP engaged restores yaw damping after a normal-channel failure (logic.ts, EST).
  { id: 'yd_fail', text: 'YAW DAMPER FAIL A/B', level: 'caution', when: `${air} && (hyd.a_psi < 1500 && hyd.rss_psi < 1500 || fail.yd || (fail.yd.normal && !(${V.stbyYd} && elec.emer_r_powered))) && ${bothRun}`, delayS: 2, inhibit: TL },
  // EST text (the OG CAS list has no flap message): latched flap fault, cleared by FLAP RESET (logic.ts).
  { id: 'flap_fail', text: 'FLAP FAIL', level: 'caution', when: V.flapFault, delayS: 1, inhibit: TL },
  { id: 'ps_button_c', text: 'P/S BUTTON ON', level: 'caution', when: `${V.pitotStatic} && ${gnd} && !cas.ps_button_w`, inhibit: TL },
  // EST texts (no public Longitude CAS source): PITCH/ROLL DISCONNECT handle pulled, pitch-trim failure.
  { id: 'pitch_roll_disc', text: 'PITCH/ROLL DISC', level: 'caution', when: `${V.pitchRollDisc} != 0`, delayS: 1, inhibit: TL },
  {
    id: 'pitch_trim_fail',
    text: 'PITCH TRIM FAIL',
    level: 'caution',
    when: `fail.trim.pitch.runaway || fail.trim.pitch.jam || (${V.stabSecArm} == 0 && (${V.stabChan} == 2 ? fail.trim.stab_ch2 : fail.trim.stab_ch1))`,
    delayS: 1,
    inhibit: TL,
  },

  // =============================================================== WHITE (advisory)
  ...perSide((x) => [
    { id: `ai_eng_on_${x.l}`, text: `A/I ENG ON ${x.s}`, level: 'advisory', when: `${x.l === 'l' ? V.aiEngL : V.aiEngR} && !${allAi}`, inhibit: TL },
    { id: `eng_bleed_off_a_${x.l}`, text: `ENG BLEED OFF ${x.s}`, level: 'advisory', when: `${x.l === 'l' ? V.bleedEngL : V.bleedEngR} == 0 && ${air}`, inhibit: TL },
    { id: `dry_motor_${x.l}`, text: `ENG DRY MTR PROC ${x.s}`, level: 'advisory', when: `${V.dryMotorReq(x.i)} && ${gnd}`, inhibit: TL },
    { id: `eng_shutdown_${x.l}`, text: `ENGINE SHUTDOWN ${x.s}`, level: 'advisory', when: `${x.l === 'l' ? V.runL : V.runR} == 0 && !eng${x.i}.running && (eng1.running || eng2.running || ${air})` },
    { id: `boost_on_${x.l}`, text: `FUEL BOOST PUMP ON ${x.s}`, level: 'advisory', when: `fuel.boost_${x.l}_on`, inhibit: TL },
    { id: `hyd_aux_${x.h}`, text: `HYD AUX PUMP ON ${x.ab}`, level: 'advisory', when: `${V.ptcu} == ${x.h === 'a' ? 1 : 3}`, inhibit: TL },
    { id: `hyd_fw_shutoff_${x.h}`, text: `HYD FW SHUTOFF ${x.ab}`, level: 'advisory', when: `${x.h === 'a' ? V.hydPumpA : V.hydPumpB} == 2 && !eng${x.i}.running`, inhibit: TL },
    { id: `press_src_off_a_${x.l}`, text: `PRESS SOURCE OFF ${x.s}`, level: 'advisory', when: `${x.l === 'l' ? V.pressSrcL : V.pressSrcR} == 0 && ${gnd}`, inhibit: TL },
  ]),
  { id: 'ai_wing_on', text: 'A/I WING ON', level: 'advisory', when: `${V.aiWing} && !${allAi}`, inhibit: TL },
  { id: 'ai_wing_xflow', text: 'A/I WING XFLOW OPEN', level: 'advisory', when: V.wingXflowOpen, inhibit: TL },
  { id: 'acm_only_a', text: 'ACM ONLY', level: 'advisory', when: `${V.ecsMode} == 1 && ${air}`, inhibit: TL },
  { id: 'apu_bleed_off_a', text: 'APU BLEED OFF', level: 'advisory', when: `${V.bleedApu} == 0 && apu.running && ${air}`, inhibit: TL },
  { id: 'apu_on_a', text: 'APU ON', level: 'advisory', when: `apu.running && adc1.press_alt_ft > 20000 && adc1.press_alt_ft <= ${LON_LIMITS.apuMaxOpFt}`, inhibit: TL },
  { id: 'bleed_iso_xflow_a', text: 'BLEED ISOLATE XFLOW', level: 'advisory', when: `${V.bleedIsolate} && !(${gnd} && ${V.toThrust}) && !(pneu.eng1_valve_open && pneu.eng2_valve_open && ac.lon.bleed.xflow_5min)`, inhibit: TL },
  { id: 'bus_tie_a', text: 'BUS TIE CLOSED', level: 'advisory', when: `elec.bus_tie_closed && !cas.bus_tie_c`, inhibit: TL },
  { id: 'cabin_alt_a', text: 'CABIN ALTITUDE', level: 'advisory', when: `${highAlt} && press.cabin_alt_ft > 8000 && press.cabin_alt_ft <= 9800`, inhibit: TL },
  { id: 'grv_xflow_on', text: 'FUEL GRV XFLOW ON', level: 'advisory', when: V.gravXflow, inhibit: TL },
  { id: 'fuel_xfer_on_a', text: 'FUEL TRANSFER ON', level: 'advisory', when: `${V.fuelTransfer} != 0 && !cas.fuel_xfer_on_c && !cas.fuel_xfer_on_10`, inhibit: TL },
  { id: 'heat_exchg_only_a', text: 'HEAT EXCHG ONLY', level: 'advisory', when: `${V.ecsMode} == 2 && ${air}`, inhibit: TL },
  { id: 'hyd_gen_on_a', text: 'HYD GEN ON', level: 'advisory', when: `hyd.ptcu_gen_cmd && !cas.hyd_gen_on_c`, inhibit: TL },
  { id: 'ice_all_on', text: 'ICE PROTECT ALL ON', level: 'advisory', when: allAi, inhibit: TL },
  { id: 'no_takeoff_a', text: 'NO TAKEOFF', level: 'advisory', when: `${V.noTakeoff} && !${V.toThrust} && (eng1.running || eng2.running)` },
  { id: 'park_brake_on_a', text: 'PARK BRAKE ON', level: 'advisory', when: `brakes.parking_set && !cas.park_brake_on_c`, inhibit: TL },
  { id: 'pitot_static_on', text: 'PITOT STATIC ON', level: 'advisory', when: `${V.pitotStatic} && ${air}`, inhibit: TL },
  { id: 'ptcu_off', text: 'PTCU OFF', level: 'advisory', when: `${V.ptcu} == 0`, inhibit: TL },
  { id: 'stab_deice_on', text: 'STAB DE-ICE ON', level: 'advisory', when: `${V.aiStab} && !${allAi}`, inhibit: TL },
  // EST texts: Emergency Descent Mode in progress (BCA 2021; systems/afcsExtras.ts) and a FADEC start abort.
  { id: 'edm', text: 'EMERGENCY DESCENT', level: 'advisory', when: V.edmActive },
  ...perSide((x) => [{ id: `start_fail_${x.l}`, text: `ENG START ABORT ${x.s}`, level: 'advisory' as const, when: V.startFail(x.i), inhibit: TL }]),
];

