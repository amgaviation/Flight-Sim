/**
 * Boeing 737-800 master caution / fire warning annunciations (FCOM 15.20
 * "Warning systems"; B737ORG "Warning Systems"). The 737 has no EICAS: each
 * system fault lights an amber (or red) annunciator on its own panel, and the
 * two system annunciator panels ("six-packs") on the glareshield show the
 * group of every NEW amber fault together with both MASTER CAUTION lights.
 * Pushing MASTER CAUTION extinguishes the master and group lights (the
 * system light stays on); pushing a six-pack (RECALL) lights every group that
 * has an active fault again. Fire warnings light the red master FIRE WARN
 * lights, the relevant fire handle and ring the fire bell; FIRE WARN / BELL
 * CUTOUT silences the bell.
 *
 * Each annunciator below is one CasManager message (`cas.<id>`) plus, where
 * the 737 has a dedicated light, the light var the late logic drives with
 * the same condition (plus the lights test). Groups follow FCOM 15.20:
 *   Capt panel: FLT CONT, IRS, FUEL, ELEC, APU, OVHT/DET;
 *   F/O panel:  ANTI-ICE, HYD, DOORS, ENG, OVERHEAD, AIR COND.
 * Conditions are the FCOM light descriptions; thresholds marked EST where the
 * public manuals give none. Annunciator power: DC bus / battery bus (EST).
 */
import type { CasMessageDef } from '../../../systems/warning';
import { B738, DOORS, FUEL_PUMPS, type Door, type FuelPump, type SixPackGroup } from '../vars';

export interface Annunciator extends CasMessageDef {
  /** Six-pack group (caution) or null (fire warnings). */
  group: SixPackGroup | null;
  /** Dedicated panel light var driven by the same condition (+ lights test). */
  light?: string;
}

const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';
const eng = (i: 1 | 2) => `eng${i}.n2_pct > 50`;
const pumpSide: Record<FuelPump, 1 | 2> = { l_aft: 1, l_fwd: 1, r_fwd: 2, r_aft: 2, c_l: 1, c_r: 2 };
const pumpText: Record<FuelPump, string> = { l_aft: 'L AFT', l_fwd: 'L FWD', r_fwd: 'R FWD', r_aft: 'R AFT', c_l: 'CTR L', c_r: 'CTR R' };
const doorText: Record<Door, string> = {
  fwd_entry: 'FWD ENTRY',
  aft_entry: 'AFT ENTRY',
  fwd_service: 'FWD SERVICE',
  aft_service: 'AFT SERVICE',
  fwd_cargo: 'FWD CARGO',
  aft_cargo: 'AFT CARGO',
  l_overwing: 'LEFT OVERWING',
  r_overwing: 'RIGHT OVERWING',
  equip: 'EQUIP',
  flt_deck: 'FLT DECK',
};

function a(id: string, text: string, group: SixPackGroup | null, when: string, light?: string, extra: Partial<CasMessageDef> = {}): Annunciator {
  return { id, text, level: group ? 'caution' : 'warning', group, when, light, ...extra };
}

export const B738_ANNUNCIATORS: Annunciator[] = [
  // ================================================================ FIRE WARNINGS (red; master FIRE WARN + bell)
  a('eng1_fire', 'ENGINE 1 FIRE', null, 'fire.eng1_warn', B738.lt.fireHandleLt(1)),
  a('eng2_fire', 'ENGINE 2 FIRE', null, 'fire.eng2_warn', B738.lt.fireHandleLt(2)),
  a('apu_fire', 'APU FIRE', null, 'fire.apu_warn', B738.lt.fireHandleApuLt),
  a('wheel_well_fire', 'WHEEL WELL FIRE', null, 'fire.wheel_well_warn', B738.lt.wheelWell),
  a('cargo_fire_fwd', 'FWD CARGO FIRE', null, 'fire.cargo_fwd_warn', B738.lt.cargoFire('fwd')),
  a('cargo_fire_aft', 'AFT CARGO FIRE', null, 'fire.cargo_aft_warn', B738.lt.cargoFire('aft')),

  // ================================================================ FLT CONT
  a('fltctl_a_lowpress', 'FLT CONTROL A LOW PRESSURE', 'flt_cont', `!(${B738.fltCtl('a')} == -1 && ${B738.stbyRudder}) && (${B738.fltCtl('a')} != 1 || hyd.a_psi < 1300)`, B738.lt.fltCtlLowPress('a')),
  a('fltctl_b_lowpress', 'FLT CONTROL B LOW PRESSURE', 'flt_cont', `!(${B738.fltCtl('b')} == -1 && ${B738.stbyRudder}) && (${B738.fltCtl('b')} != 1 || hyd.b_psi < 1300)`, B738.lt.fltCtlLowPress('b')),
  a('stby_low_qty', 'STBY LOW QUANTITY', 'flt_cont', 'hyd.stby_qty < 0.5', B738.lt.stbyLowQty),
  // Standby LOW PRESSURE: standby pump commanded (armed) and pressure low (FCOM 9.20).
  a('stby_low_press', 'STBY LOW PRESSURE', 'flt_cont', `${B738.stbyPumpCmd} && hyd.stby_psi < 1300`, B738.lt.stbyLowPress, { delayS: 3 }),
  a('feel_diff', 'FEEL DIFF PRESS', 'flt_cont', `${air} && surf.flaps_deg < 0.5 && abs(hyd.a_psi - hyd.b_psi) > 1000`, B738.lt.feelDiffPress, { delayS: 5 }),
  a('speed_trim_fail', 'SPEED TRIM FAIL', 'flt_cont', '!(elec.fcc_a_powered || elec.fcc_b_powered) || fail.b738.speed_trim', B738.lt.speedTrimFail),
  a('mach_trim_fail', 'MACH TRIM FAIL', 'flt_cont', '!(elec.fcc_a_powered || elec.fcc_b_powered) || fail.b738.mach_trim', B738.lt.machTrimFail),
  a('auto_slat_fail', 'AUTO SLAT FAIL', 'flt_cont', 'fail.slats.drive || (hyd.b_psi < 1300 && hyd.a_psi < 1300 && surf.flaps_deg > 0.5)', B738.lt.autoSlatFail, { delayS: 2 }),
  // YAW DAMPER light: yaw damper not engaged (FCOM 9.20).
  a('yaw_damper', 'YAW DAMPER', 'flt_cont', `${B738.ydSw} == 0 || yd.active == 0`, B738.lt.yawDamper),

  // ================================================================ IRS
  ...([1, 2] as const).flatMap((s) => [
    a(`irs${s}_fault`, `IRS ${s === 1 ? 'L' : 'R'} FAULT`, 'irs', `irs${s}.fault`),
    a(`irs${s}_on_dc`, `IRS ${s === 1 ? 'L' : 'R'} ON DC`, 'irs', `irs${s}.on_dc && ac.irs${s}_mode > 0`, undefined, { delayS: 6 }),
    a(`irs${s}_dc_fail`, `IRS ${s === 1 ? 'L' : 'R'} DC FAIL`, 'irs', `irs${s}.dc_fail`),
  ]),
  // GPS light: GPS receiver fault / no position (after the ~90 s acquisition, EST).
  a('gps', 'GPS', 'irs', 'ac.b738.gps_installed && gps.powered && gps.valid == 0', undefined, { delayS: 90 }),

  // ================================================================ FUEL
  ...FUEL_PUMPS.map((p) =>
    // Main pump LOW PRESSURE also with the switch OFF; centre pumps only when ON. Six-pack only in flight or with the engine running (EST inhibit).
    a(`fuel_lp_${p}`, `FUEL PUMP ${pumpText[p]} LOW PRESSURE`, 'fuel', `fuel.${p}_lowpress && (${air} || ${eng(pumpSide[p])} || ${B738.fuelPump(p)} != 0)`, B738.lt.fuelLowPress(p), { delayS: 1 }),
  ),
  a('filter_bypass1', 'FUEL FILTER BYPASS 1', 'fuel', 'fail.b738.fuel_filter1', B738.lt.filterBypass(1)),
  a('filter_bypass2', 'FUEL FILTER BYPASS 2', 'fuel', 'fail.b738.fuel_filter2', B738.lt.filterBypass(2)),

  // ================================================================ ELEC
  a('bat_discharge', 'BAT DISCHARGE', 'elec', 'ac.b738.bat_disch_cond', B738.lt.batDischarge),
  a('tr_unit', 'TR UNIT', 'elec', `(${gnd} && (!elec.tru1_online || !elec.tru2_online || !elec.tru3_online) && elec.xfr1_powered && elec.xfr2_powered) || (${air} && (!elec.tru1_online || (!elec.tru2_online && !elec.tru3_online)))`, B738.lt.trUnit, { delayS: 1 }),
  a('elec', 'ELEC', 'elec', `${gnd} && (fail.elec.dc1.fault || fail.elec.dc2.fault || fail.elec.dc_stby.fault || fail.elec.batt_bus.fault)`, B738.lt.elec),
  a('stby_pwr_off', 'STANDBY PWR OFF', 'elec', '!elec.ac_stby_powered || !elec.dc_stby_powered || !elec.batt_bus_powered', B738.lt.stbyPwrOff, { delayS: 1 }),
  ...([1, 2] as const).flatMap((i) => [
    a(`xfr_bus_off${i}`, `TRANSFER BUS ${i} OFF`, 'elec', `!elec.xfr${i}_powered`, B738.lt.xfrBusOff(i)),
    // SOURCE OFF: no source selected (manually or automatically) for the transfer bus.
    a(`source_off${i}`, `SOURCE OFF ${i}`, 'elec', `${B738.xfrSrc(i)} == 0 || ${B738.xfrSrc(i)} == 4`, B738.lt.sourceOff(i)),
    // DRIVE: IDG low oil pressure (engine stopped, drive disconnected or failed).
    a(`drive${i}`, `DRIVE ${i}`, 'elec', `elec.idg${i}_drive_lowpress`, B738.lt.drive(i)),
  ]),

  // ================================================================ APU
  a('apu_low_oil', 'APU LOW OIL PRESSURE', 'apu', `apu.low_oil || (${B738.apuSw} >= 1 && apu.n_pct > 10 && apu.n_pct < 90 && apu.starting == 0 && apu.running == 0)`, B738.lt.apuLowOil),
  a('apu_fault', 'APU FAULT', 'apu', 'apu.fault && apu.overspeed == 0 && apu.low_oil == 0', B738.lt.apuFault),
  a('apu_overspeed', 'APU OVERSPEED', 'apu', 'apu.overspeed', B738.lt.apuOverspeed),

  // ================================================================ OVHT/DET
  a('eng1_ovht', 'ENG 1 OVERHEAT', 'ovht_det', 'fire.eng1_ovht', B738.lt.engOvht(1)),
  a('eng2_ovht', 'ENG 2 OVERHEAT', 'ovht_det', 'fire.eng2_ovht', B738.lt.engOvht(2)),
  a('fire_det_fault', 'FIRE DETECTION FAULT', 'ovht_det', 'fire.eng1_fault || fire.eng2_fault', B738.lt.fireFault),
  a('apu_det_inop', 'APU DET INOP', 'ovht_det', 'fire.apu_fault', B738.lt.apuDetInop),

  // ================================================================ ANTI-ICE
  ...(['l_side', 'l_fwd', 'r_fwd', 'r_side'] as const).map((w) =>
    a(`win_ovht_${w}`, `WINDOW HEAT ${w.toUpperCase().replace('_', ' ')} OVERHEAT`, 'anti_ice', `fail.b738.win_heat_${w} && ${B738.windowHeat(w)} != 0`, B738.lt.windowOverheat(w)),
  ),
  // Probe heat lights: probe not heated (switch OFF or no power), FCOM 3.20.
  a('probe_capt_pitot', 'CAPT PITOT', 'anti_ice', '!elec.probe_heat_a_powered', B738.lt.probeOff('capt_pitot')),
  a('probe_l_elev_pitot', 'L ELEV PITOT', 'anti_ice', '!elec.probe_heat_a_powered', B738.lt.probeOff('l_elev_pitot')),
  a('probe_l_alpha', 'L ALPHA VANE', 'anti_ice', '!elec.probe_heat_a_powered', B738.lt.probeOff('l_alpha')),
  a('probe_temp', 'TEMP PROBE', 'anti_ice', `!elec.probe_heat_a_powered && ${air}`, B738.lt.probeOff('temp_probe')),
  a('probe_fo_pitot', 'F/O PITOT', 'anti_ice', '!elec.probe_heat_b_powered', B738.lt.probeOff('fo_pitot')),
  a('probe_r_elev_pitot', 'R ELEV PITOT', 'anti_ice', '!elec.probe_heat_b_powered', B738.lt.probeOff('r_elev_pitot')),
  a('probe_r_alpha', 'R ALPHA VANE', 'anti_ice', '!elec.probe_heat_b_powered', B738.lt.probeOff('r_alpha')),
  a('probe_aux_pitot', 'AUX PITOT', 'anti_ice', '!elec.probe_heat_b_powered', B738.lt.probeOff('aux_pitot')),
  // COWL ANTI-ICE: duct over-pressure (EST: nacelle anti-ice valve failed open/over-pressure failure).
  a('cowl_ai1', 'COWL ANTI-ICE 1', 'anti_ice', 'fail.b738.cowl_ai1', B738.lt.cowlAi(1)),
  a('cowl_ai2', 'COWL ANTI-ICE 2', 'anti_ice', 'fail.b738.cowl_ai2', B738.lt.cowlAi(2)),

  // ================================================================ HYD
  a('hyd_lp_eng1', 'HYD ENG 1 LOW PRESSURE', 'hyd', `hyd.edp_a_lowpress && (${air} || eng1.running)`, B738.lt.hydLowPress('eng1')),
  a('hyd_lp_elec2', 'HYD ELEC 2 LOW PRESSURE', 'hyd', `hyd.emdp_a_lowpress && (${air} || ${B738.hydPump('elec2')} != 0 || eng1.running || eng2.running)`, B738.lt.hydLowPress('elec2')),
  a('hyd_lp_elec1', 'HYD ELEC 1 LOW PRESSURE', 'hyd', `hyd.emdp_b_lowpress && (${air} || ${B738.hydPump('elec1')} != 0 || eng1.running || eng2.running)`, B738.lt.hydLowPress('elec1')),
  a('hyd_lp_eng2', 'HYD ENG 2 LOW PRESSURE', 'hyd', `hyd.edp_b_lowpress && (${air} || eng2.running)`, B738.lt.hydLowPress('eng2')),
  a('hyd_ovht_elec1', 'HYD ELEC 1 OVERHEAT', 'hyd', 'hyd.emdp_b_overheat', B738.lt.hydOverheat('elec1')),
  a('hyd_ovht_elec2', 'HYD ELEC 2 OVERHEAT', 'hyd', 'hyd.emdp_a_overheat', B738.lt.hydOverheat('elec2')),

  // ================================================================ DOORS (amber door lights)
  ...DOORS.map((d) => a(`door_${d}`, `${doorText[d]} DOOR`, 'doors', `${B738.door(d)} != 0`, B738.lt.doorLt(d))),

  // ================================================================ ENG
  // REVERSER: reverser commanded to stow but not stowed after 12 s, or isolation / control valve disagreement (FCOM 7.20).
  a('reverser1', 'REVERSER 1', 'eng', 'ac.b738.rev_fault1', B738.lt.reverser(1), { delayS: 12 }),
  a('reverser2', 'REVERSER 2', 'eng', 'ac.b738.rev_fault2', B738.lt.reverser(2), { delayS: 12 }),
  a('engine_control1', 'ENGINE CONTROL 1', 'eng', `${gnd} && (fail.fadec.eng1 || !(eng1.n2_pct > 15 || elec.eec1_alt_powered) && eng1.running)`, B738.lt.engineControl(1)),
  a('engine_control2', 'ENGINE CONTROL 2', 'eng', `${gnd} && (fail.fadec.eng2 || !(eng2.n2_pct > 15 || elec.eec2_alt_powered) && eng2.running)`, B738.lt.engineControl(2)),
  a('eec_altn1', 'EEC 1 ALTN', 'eng', `${B738.eec(1)} == 0`),
  a('eec_altn2', 'EEC 2 ALTN', 'eng', `${B738.eec(2)} == 0`),

  // ================================================================ OVERHEAD
  a('equip_cool_supply', 'EQUIP COOLING SUPPLY OFF', 'overhead', `${B738.equipCoolSupply} == 0 && fail.b738.equip_cool_supply`, B738.lt.equipCoolOff('supply')),
  a('equip_cool_exhaust', 'EQUIP COOLING EXHAUST OFF', 'overhead', `${B738.equipCoolExhaust} == 0 && fail.b738.equip_cool_exhaust`, B738.lt.equipCoolOff('exhaust')),
  a('emer_exit_not_armed', 'EMERGENCY EXIT LIGHTS NOT ARMED', 'overhead', `${B738.emerExitLt} != 1`, B738.lt.emerExitNotArmed),
  a('fdr_off', 'FLT REC OFF', 'overhead', `${B738.fdrSw} == 0 && !(eng1.running || eng2.running) && ${gnd}`, B738.lt.fdrOff),
  a('pseu', 'PSEU', 'overhead', `${gnd} && (gear.disagree || fail.gear.squat1 || fail.gear.squat2)`, B738.lt.pseu),

  // ================================================================ AIR COND
  a('pack1', 'PACK L', 'air_cond', `pneu.pack1_trip || (${B738.pack(1)} >= 1 && !pneu.pack1_on && ${air})`, B738.lt.packTrip(1), { delayS: 2 }),
  a('pack2', 'PACK R', 'air_cond', `pneu.pack2_trip || (${B738.pack(2)} >= 1 && !pneu.pack2_on && ${air})`, B738.lt.packTrip(2), { delayS: 2 }),
  a('wing_body_ovht1', 'WING-BODY OVERHEAT L', 'air_cond', 'pneu.l_duct_leak', B738.lt.wingBodyOvht(1)),
  a('wing_body_ovht2', 'WING-BODY OVERHEAT R', 'air_cond', 'pneu.r_duct_leak', B738.lt.wingBodyOvht(2)),
  a('bleed_trip1', 'BLEED TRIP OFF 1', 'air_cond', 'pneu.bleed1_trip', B738.lt.bleedTripOff(1)),
  a('bleed_trip2', 'BLEED TRIP OFF 2', 'air_cond', 'pneu.bleed2_trip', B738.lt.bleedTripOff(2)),
  a('zone_temp', 'ZONE TEMP', 'air_cond', 'fail.b738.zone_temp', B738.lt.zoneTemp(1)),
  a('auto_fail', 'AUTO FAIL', 'air_cond', `press.auto_fail || (${B738.pressMode} == 0 && !elec.press_auto_powered)`, B738.lt.autoFail),
  // OFF SCHED DESCENT: descent started before reaching the FLT ALT (FCOM 2.40).
  a('off_sched_descent', 'OFF SCHED DESCENT', 'air_cond', 'ac.b738.off_sched_descent', B738.lt.offSchedDescent),
];

/** Annunciator id -> group (six-pack logic). */
export const ANNUNCIATOR_GROUP: Record<string, SixPackGroup | null> = Object.fromEntries(B738_ANNUNCIATORS.map((x) => [x.id, x.group]));
