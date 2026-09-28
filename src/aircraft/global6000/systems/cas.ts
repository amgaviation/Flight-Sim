/**
 * Bombardier Global 6000 EICAS crew alerting messages (Collins Fusion EICAS
 * window, FusionCas sink). Colours (Bombardier convention, GXEL: "warning
 * red, caution amber, advisory cyan, status white"): 'warning' (MASTER
 * WARNING + aural), 'caution' (MASTER CAUTION + chime), 'advisory', 'status'.
 *
 * Texts are the Global Express EICAS message lists (GXEL AC / DC SYSTEM EICAS
 * MESSAGES, GXHY, GXFU, GXLG, GXFP, GXAPU, GXFC, GXAG doors); the colour of
 * each message follows the page of the manual it is printed on (red / amber
 * pages first, then cyan, then white). The trigger conditions come from the
 * message descriptions in those lists; thresholds and delays that the
 * manuals do not give are marked EST. Messages whose ids match
 * collins-fusion GLOBAL_CAS_TEXTS keep those ids (CAS-linked checklists).
 * Messages not in the manuals' lists (pressurization, anti-ice, packs:
 * chapters not available publicly) are EST texts in the Bombardier style.
 */
import type { CasMessageDef } from '../../../systems/warning';
import { G6K_LIMITS, LB } from '../data';
import { GLOBAL6000_FDM } from '../fdm';
import { FUEL_LOW_KG } from './fuel';
import { G6K_VARS as V } from '../vars';

const TL = 'takeoff+landing' as const;
const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';
const unusable = GLOBAL6000_FDM.mass.tanks[0].unusable_kg;

type Side = { S: 'L' | 'R'; s: 'l' | 'r'; i: 1 | 2; word: 'LEFT' | 'RIGHT' };
const L: Side = { S: 'L', s: 'l', i: 1, word: 'LEFT' };
const R: Side = { S: 'R', s: 'r', i: 2, word: 'RIGHT' };
const each = (f: (x: Side) => CasMessageDef[]): CasMessageDef[] => [...f(L), ...f(R)];
const n4 = (f: (n: 1 | 2 | 3 | 4) => CasMessageDef): CasMessageDef[] => ([1, 2, 3, 4] as const).map(f);

const anyEng = '(eng1.running || eng2.running)';
const acAny = '(elec.ac_bus1_powered || elec.ac_bus2_powered || elec.ac_bus3_powered || elec.ac_bus4_powered)';

export const G6K_CAS: CasMessageDef[] = [
  // ================================================================ RED (warnings)
  ...each((x) => [
    { id: `${x.s}_eng_fire`, text: `${x.S} ENG FIRE`, level: 'warning', when: `fire.eng${x.i}_warn`, aural: { callout: `${x.word} ENGINE FIRE`, priority: 9, repeatS: 6 } },
    // EST text / threshold: E018 minimum to complete the flight 25 psid.
    { id: `${x.s}_eng_oil_press`, text: `${x.S} ENG OIL PRESS`, level: 'warning', when: `eng${x.i}.running && eng${x.i}.oil_press_psi < ${G6K_LIMITS.oilPressMinPsi}`, delayS: 2, inhibit: TL },
  ]),
  { id: 'apu_fire', text: 'APU FIRE', level: 'warning', when: 'fire.apu_warn', aural: { callout: 'APU FIRE', priority: 9, repeatS: 6 } },
  { id: 'mlg_bay_ovht', text: 'MLG BAY OVHT', level: 'warning', when: 'fire.mlg_warn', aural: { callout: 'GEAR BAY OVERHEAT', priority: 8, repeatS: 8 } },
  // GXFC: red CONFIG messages with "NO TAKEOFF" during the take-off roll.
  { id: 'config_stab_trim', text: 'CONFIG STAB TRIM', level: 'warning', when: `${gnd} && ${V.toThrust} && (trim.pitch_units < ${G6K_LIMITS.stabGreenBand[0]} || trim.pitch_units > ${G6K_LIMITS.stabGreenBand[1]})`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  { id: 'config_ail_trim', text: 'CONFIG AIL TRIM', level: 'warning', when: `${gnd} && ${V.toThrust} && trim.roll_to_ok == 0`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  { id: 'config_rud_trim', text: 'CONFIG RUD TRIM', level: 'warning', when: `${gnd} && ${V.toThrust} && trim.yaw_to_ok == 0`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  // EST texts (same logic family): flaps not 6 / 16, flight spoiler lever not retracted.
  { id: 'config_flaps', text: 'CONFIG FLAPS', level: 'warning', when: `${gnd} && ${V.toThrust} && (${V.flapLever} < 1.5 || ${V.flapLever} > 3.5)`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  { id: 'config_spoilers', text: 'CONFIG SPOILERS', level: 'warning', when: `${gnd} && ${V.toThrust} && (${V.flightSpoiler} > 0.05 || surf.ground_spoilers > 0.05)`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  // GXLG: PARK BRAKE ON red "NO TAKEOFF" with the brake set and the throttles advanced for take-off.
  { id: 'park_brake_on', text: 'PARK BRAKE ON', level: 'warning', when: `${gnd} && ${V.toThrust} && ${V.parkBrake} > 0.05`, aural: { callout: 'NO TAKEOFF', priority: 7, repeatS: 3 } },
  // GXLG: GEAR (landing attempt with any gear not down and locked; the horn / TAWS voices come from the gear block).
  { id: 'gear', text: 'GEAR', level: 'warning', when: 'gear.horn && !gear.down_locked', aural: { callout: 'GEAR', priority: 8, repeatS: 3 } },
  { id: 'norm_brake_fail', text: 'NORM BRAKE FAIL', level: 'warning', when: `${gnd} && hyd.sys2_psi < 1000 && hyd.sys3_psi < 1000 && brakes.accum_psi < 1000 && !${V.parkSet}`, delayS: 1, aural: { callout: 'NORMAL BRAKE FAIL', priority: 6, repeatS: 10 } },
  { id: 'brake_ovht', text: 'BRAKE OVHT', level: 'warning', when: V.btmsWarn },
  // EST texts (pressurization chapter not public): cabin altitude above 10,000 ft (14 CFR 25.841), differential excess.
  { id: 'cabin_alt', text: 'CABIN ALT', level: 'warning', when: 'press.cabin_alt_warn', aural: { callout: 'CABIN PRESSURE', priority: 8, repeatS: 8 } },
  { id: 'cabin_delta_p', text: 'CABIN DELTA P', level: 'warning', when: `press.diff_psi > ${G6K_LIMITS.maxDiffPsi + 0.3}` },
  // EST: engine exceedance (Fusion exceedance monitor).
  { id: 'eng_exceed', text: 'ENGINE EXCEEDANCE', level: 'warning', when: 'fusion.eng.exceed', delayS: 1 },

  // ================================================================ AMBER (cautions)
  // ---- electrical (GXEL)
  { id: 'emer_pwr_only', text: 'EMER PWR ONLY', level: 'caution', when: `${air} && (elec.rat_gen_online || ${V.battEmer}) && !${acAny}` },
  ...n4((n) => ({ id: `ac_bus${n}_fail`, text: `AC BUS ${n} FAIL`, level: 'caution', when: `!elec.ac_bus${n}_powered && ${anyEng} && !${V.acBusIsol(n)} && !${V.singleGen}`, delayS: 2, inhibit: TL })),
  { id: 'ac_ess_bus_fail', text: 'AC ESS BUS FAIL', level: 'caution', when: `!elec.ac_ess_powered && (${anyEng} || elec.apu_gen_online || elec.ext_ac_online)`, delayS: 2 },
  ...n4((n) => ({ id: `gen${n}_ovld`, text: `GEN ${n} OVLD`, level: 'caution', when: `elec.gen${n}_load_pct > 110`, delayS: 5 })),
  { id: 'apu_gen_ovld', text: 'APU GEN OVLD', level: 'caution', when: 'elec.apu_gen_load_pct > 110', delayS: 5 },
  { id: 'rat_gen_fail', text: 'RAT GEN FAIL', level: 'caution', when: `${V.ratDeployed} && ${V.ratGen} == 1 && !elec.rat_gen_online && ${V.ratDrive} > ${G6K_LIMITS.ratShedKias + 10}`, delayS: 5 },
  { id: 'dc_bus1_fail', text: 'DC BUS 1 FAIL', level: 'caution', when: `!elec.dc_bus1_powered && ${V.battMaster} == 1 && !${V.dcBusIsol('dc_bus1')}`, delayS: 2 },
  { id: 'dc_bus2_fail', text: 'DC BUS 2 FAIL', level: 'caution', when: `!elec.dc_bus2_powered && ${V.battMaster} == 1 && !${V.dcBusIsol('dc_bus2')}`, delayS: 2 },
  { id: 'dc_ess_bus_fail', text: 'DC ESS BUS FAIL', level: 'caution', when: `!elec.dc_ess_powered && ${V.battMaster} == 1`, delayS: 1 },
  { id: 'batt_bus_fail', text: 'BATT BUS FAIL', level: 'caution', when: `!elec.batt_bus_powered && ${V.battMaster} == 1`, delayS: 1 },
  { id: 'dc_emer_bus_fail', text: 'DC EMER BUS FAIL', level: 'caution', when: '!elec.dc_emer_powered', delayS: 1 },
  { id: 'batt_master_off', text: 'BATT MASTER OFF', level: 'caution', when: `${V.battMaster} == 0 && (elec.dc_ess_powered || elec.batt_bus_powered)` },
  { id: 'apu_batt_fail', text: 'APU BATT FAIL', level: 'caution', when: 'elec.apu_batt_v < 18 || elec.apu_batt_overtemp || fail.elec.apu_batt', delayS: 5 },
  { id: 'av_batt_fail', text: 'AV BATT FAIL', level: 'caution', when: 'elec.av_batt_v < 18 || elec.av_batt_overtemp || fail.elec.av_batt', delayS: 5 },
  // ---- hydraulics (GXHY): both pumps of a system below 1,800 psi
  ...([1, 2, 3] as const).map(
    (n): CasMessageDef => ({ id: `hyd${n}_lo_press`, text: `HYD ${n} LO PRESS`, level: 'caution', when: `hyd.sys${n}_psi < ${G6K_LIMITS.hydLowPsi} && (${n === 3 ? `(${acAny} || ${V.ratDeployed})` : `eng${n}.running`})`, delayS: 3, inhibit: TL }),
  ),
  ...([1, 2, 3] as const).map((n): CasMessageDef => ({ id: `hyd${n}_lo_qty`, text: `HYD ${n} LO QTY`, level: 'caution', when: `hyd.sys${n}_lowqty` })),
  ...([1, 2, 3] as const).map((n): CasMessageDef => ({ id: `hyd${n}_hi_temp`, text: `HYD ${n} HI TEMP`, level: 'caution', when: `hyd.sys${n}_temp_c > ${G6K_LIMITS.hydHiTempC}` })),
  { id: 'hyd_rat_pump_fail', text: 'HYD RAT PUMP FAIL', level: 'caution', when: `${V.ratDeployed} && hyd.pumprat_lowpress && ${V.ratDrive} > 130`, delayS: 5 },
  // ---- fuel (GXFU)
  { id: 'fuel_lo_qty', text: 'FUEL LO QTY', level: 'caution', when: `fuel.tank0_kg < ${FUEL_LOW_KG + unusable} || fuel.tank2_kg < ${FUEL_LOW_KG + unusable}`, delayS: 10 },
  {
    id: 'fuel_imbalance',
    text: 'FUEL IMBALANCE',
    level: 'caution',
    when: `abs(fuel.tank0_kg - fuel.tank2_kg) > ((${air} && ${V.flapLever} < 0.5) ? ${G6K_LIMITS.imbalanceFlightLb * LB} : ${G6K_LIMITS.imbalanceGroundLb * LB})`,
    delayS: 10,
  },
  ...each((x) => [
    { id: `${x.s}_pri_fuel_pumps`, text: `${x.S} PRI FUEL PUMPS`, level: 'caution', when: `${V.priCmd(`${x.s}1` as 'l1')} && fuel.pri_${x.s}1_lowpress && fuel.pri_${x.s}2_lowpress`, delayS: 3 },
    { id: `${x.s}_eng_fuel_sov`, text: `${x.S} ENG FUEL SOV`, level: 'caution', when: `!elec.eng_sov${x.i}_powered && eng${x.i}.running`, delayS: 3 },
  ]),
  { id: 'wing_fuel_lo_temp', text: 'WING FUEL LO TEMP', level: 'caution', when: `fuel.l_main_temp_c < ${G6K_LIMITS.fuelLoTempC} || fuel.r_main_temp_c < ${G6K_LIMITS.fuelLoTempC}`, delayS: 10 },
  { id: 'wing_fuel_hi_temp', text: 'WING FUEL HI TEMP', level: 'caution', when: `fuel.l_main_temp_c > ${G6K_LIMITS.fuelHiTempC} || fuel.r_main_temp_c > ${G6K_LIMITS.fuelHiTempC}`, delayS: 10 },
  { id: 'ctr_fuel_xfer_fail', text: 'CTR FUEL XFER FAIL', level: 'caution', when: `(${V.ctrXferCmd('l')} && !fuel.ctr_xfer1_active) && (${V.ctrXferCmd('r')} && !fuel.ctr_xfer2_active)`, delayS: 10 },
  { id: 'aft_xfer_fail', text: 'AFT XFER FAIL', level: 'caution', when: `(${V.aftXferCmd('l')} && !fuel.aft_xfer1_active) && (${V.aftXferCmd('r')} && !fuel.aft_xfer2_active)`, delayS: 10 },
  { id: 'xfeed_valve_fail', text: 'XFEED VALVE FAIL', level: 'caution', when: `(${V.xfeed} == 1) != fuel.xfeed_open && !fuel.xfeed_transit`, delayS: 5 },
  // ---- engines
  ...each((x) => [
    // collins GLOBAL_CAS_TEXTS: L/R ENG FLAMEOUT (caution).
    { id: `${x.s}_eng_flameout`, text: `${x.S} ENG FLAMEOUT`, level: 'caution', when: V.engFail(x.i) },
    // EST text: oil pressure below the lower limit for flight (E018 35 psid at idle ... 45 psid at 90 % N2).
    { id: `${x.s}_eng_oil_lo`, text: `${x.S} ENG OIL LO PRESS`, level: 'caution', when: `eng${x.i}.running && eng${x.i}.oil_press_psi < ${G6K_LIMITS.oilPressCautionPsi} && eng${x.i}.oil_press_psi >= ${G6K_LIMITS.oilPressMinPsi}`, delayS: 3, inhibit: TL },
    { id: `${x.s}_eng_start_abort`, text: `${x.S} ENG START ABORT`, level: 'caution', when: `fadec.eng${x.i}.abort` }, // EST text
    { id: `${x.s}_eng_fire_fail`, text: `${x.S} ENG FIRE FAIL`, level: 'caution', when: `fire.eng${x.i}_fault` },
    { id: `${x.s}_rev_unlocked`, text: `${x.S} REV UNLOCKED`, level: 'caution', when: `${air} && fadec.eng${x.i}.rev_unlocked` }, // EST text
  ]),
  { id: 'apu_fire_fail', text: 'APU FIRE FAIL', level: 'caution', when: 'fire.apu_fault' },
  { id: 'mlg_bay_ovht_fail', text: 'MLG BAY OVHT FAIL', level: 'caution', when: 'fire.mlg_fault' },
  { id: 'fire_btl1_lo_press', text: 'FIRE BTL1 LO PRESS', level: 'caution', when: 'fire.bottle1_discharged' },
  { id: 'fire_btl2_lo_press', text: 'FIRE BTL2 LO PRESS', level: 'caution', when: 'fire.bottle2_discharged' },
  // ---- APU (GXAPU)
  { id: 'apu_overtemp', text: 'APU OVERTEMP', level: 'caution', when: `apu.egt_c > ${G6K_LIMITS.apuEgtStartMaxC}` },
  { id: 'apu_overspeed', text: 'APU OVERSPEED', level: 'caution', when: 'apu.overspeed' },
  { id: 'apu_oil_lo_press', text: 'APU OIL LO PRESS', level: 'caution', when: 'apu.low_oil' },
  // ---- flight controls (GXFC)
  { id: 'stall_protect_fail', text: 'STALL PROTECT FAIL', level: 'caution', when: `${V.pusher(1)} == 0 || ${V.pusher(2)} == 0 || !elec.spc_powered || fail.stall.warn || fail.stall.pusher` },
  { id: 'flap_fail', text: 'FLAP FAIL', level: 'caution', when: 'flaps.disagree || flaps.asym || fail.flaps.drive', delayS: 2 },
  { id: 'slat_fail', text: 'SLAT FAIL', level: 'caution', when: 'fail.slats.drive && abs(surf.slats - (ac.flap_lever > 0.5 ? 1 : 0)) > 0.1', delayS: 2 },
  { id: 'yd_off', text: 'YD OFF', level: 'caution', when: `ap.yd_engaged == 0 && ${air}`, delayS: 1 }, // GXAG EICAS image "YD OFF"
  { id: 'stab_trim_fail', text: 'STAB TRIM FAIL', level: 'caution', when: `${V.stabCh(1)} == 1 && ${V.stabCh(2)} == 1 || (!elec.stab_trim1_powered && !elec.stab_trim2_powered)`, delayS: 1 }, // EST text
  { id: 'gld_fail', text: 'GLD FAIL', level: 'caution', when: 'fail.spoilers.ground', delayS: 1 }, // EST text
  // ---- landing gear / brakes (GXLG)
  { id: 'gear_disagree', text: 'GEAR DISAGREE', level: 'caution', when: 'gear.disagree', aural: { callout: 'GEAR DISAGREE', priority: 5, repeatS: 10 } },
  { id: 'park_emer_brake_on_air', text: 'PARK/EMER BRAKE ON', level: 'caution', when: `${air} && ${V.parkBrake} > 0.05 && gear.handle_down` },
  { id: 'inbd_brk_lo_press', text: 'INBD BRK LO PRESS', level: 'caution', when: `hyd.sys3_psi < 1000 && brakes.accum_psi < 1000 && (${anyEng} || ${acAny})`, delayS: 3, inhibit: TL },
  { id: 'outbd_brk_lo_press', text: 'OUTBD BRK LO PRESS', level: 'caution', when: `hyd.sys2_psi < 1000 && (${anyEng})`, delayS: 3, inhibit: TL },
  { id: 'nose_steer_fail', text: 'NOSE STEER FAIL', level: 'caution', when: 'fail.steer || (!elec.nws1_powered && !elec.nws2_powered)', delayS: 1 },
  { id: 'autobrake_fail', text: 'AUTOBRAKE FAIL', level: 'caution', when: 'fail.autobrake' },
  { id: 'gear_sys_fail', text: 'GEAR SYS FAIL', level: 'caution', when: `fail.gear.actuation || (!elec.lgecu_a_powered && !elec.lgecu_b_powered)`, delayS: 1 },
  { id: 'nose_door', text: 'NOSE DOOR', level: 'caution', when: `gear.doors > 0.05 && !gear.moving && gear.blowdown_used`, delayS: 30 },
  // ---- doors (GXAG door warning system)
  { id: 'passenger_door', text: 'PASSENGER DOOR', level: 'caution', when: V.door('pax') },
  { id: 'cargo_door', text: 'CARGO DOOR', level: 'caution', when: V.door('bag') },
  { id: 'emer_exit_door', text: 'EMER EXIT DOOR', level: 'caution', when: V.door('emer') },
  { id: 'aft_eqpt_bay_door', text: 'AFT EQUIP BAY DOOR', level: 'caution', when: `${V.door('aft_eqpt')} || ${V.door('svc_large')}` },
  // ---- bleed / ECS / pressurization / ice (EST texts)
  ...each((x) => [
    { id: `${x.s}_bleed_fail`, text: `${x.S} BLEED FAIL`, level: 'caution', when: `${V.engBleedCmd(x.s)} && pneu.eng${x.i}_trip`, delayS: 2 },
    { id: `${x.s}_pack_fail`, text: `${x.S} PACK FAIL`, level: 'caution', when: `pneu.pack_${x.s}_trip`, delayS: 2 },
  ]),
  { id: 'press_auto_fail', text: 'CABIN PRESS AUTO FAIL', level: 'caution', when: 'press.auto_fail', delayS: 2 },
  { id: 'wing_ai_fail', text: 'WING A/ICE FAIL', level: 'caution', when: `(${V.waiCmd('l')} && pneu.wai_l_ok < 0.5) || (${V.waiCmd('r')} && pneu.wai_r_ok < 0.5)`, delayS: 10 },
  ...each((x) => [{ id: `${x.s}_cowl_ai_fail`, text: `${x.S} COWL A/ICE FAIL`, level: 'caution', when: `${V.caiCmd(x.s)} && pneu.cai_${x.s}_ok < 0.5 && eng${x.i}.running`, delayS: 10 }]),
  { id: 'wshld_heat_fail', text: 'WSHLD HEAT FAIL', level: 'caution', when: `(${V.wshldOn('l')} && !elec.wshld_l_powered) || (${V.wshldOn('r')} && !elec.wshld_r_powered)`, delayS: 5 },
  { id: 'ice_no_ai', text: 'ICE', level: 'caution', when: `ice.detected && (!${V.waiCmd('l')} || !${V.caiCmd('l')} || !${V.caiCmd('r')})`, delayS: 5 },

  // ================================================================ CYAN (advisories)
  ...n4((n) => ({ id: `gen${n}_fail`, text: `GEN ${n} FAIL`, level: 'advisory', when: `(elec.gen${n}_tripped || fail.elec.gen${n}) && ${V.gen(n)} == 1 && eng${n <= 2 ? 1 : 2}.running` })),
  { id: 'apu_gen_fail', text: 'APU GEN FAIL', level: 'advisory', when: `(elec.apu_gen_tripped || fail.elec.apu_gen) && ${V.apuGen} == 1 && apu.avail` },
  { id: 'tru1_fail', text: 'TRU 1 FAIL', level: 'advisory', when: 'elec.ac_bus1_powered && !elec.tru1_online', delayS: 1 },
  { id: 'tru2_fail', text: 'TRU 2 FAIL', level: 'advisory', when: 'elec.ac_bus3_powered && !elec.tru2_online', delayS: 1 },
  { id: 'ess_tru1_fail', text: 'ESS TRU 1 FAIL', level: 'advisory', when: 'elec.ac_bus2_powered && !elec.ess_tru1_online', delayS: 1 },
  { id: 'ess_tru2_fail', text: 'ESS TRU 2 FAIL', level: 'advisory', when: 'elec.ac_ess_powered && !elec.ess_tru2_online', delayS: 1 },
  { id: 'rat_gen_on', text: 'RAT GEN ON', level: 'advisory', when: 'elec.acess_src == 1' },
  { id: 'batt_emer_pwr_on', text: 'BATTERY EMER PWR ON', level: 'advisory', when: V.battEmer },
  ...(['1a', '2a'] as const).map((p): CasMessageDef => ({ id: `hyd_edp_${p}_fail`, text: `HYD EDP ${p.toUpperCase()} FAIL`, level: 'advisory', when: `hyd.pump${p}_lowpress && eng${p[0]}.running && ${V.sovOpen(Number(p[0]) as 1 | 2)}`, delayS: 3 })),
  ...(['1b', '2b', '3a', '3b'] as const).map((p): CasMessageDef => ({ id: `hyd_pump_${p}_fail`, text: `HYD PUMP ${p.toUpperCase()} FAIL`, level: 'advisory', when: `${V.acmpCmd(p)} && hyd.pump${p}_lowpress`, delayS: 5 })),
  ...each((x) => [
    { id: `${x.s}_pri_fuel_pump`, text: `${x.S} PRI FUEL PUMP`, level: 'advisory', when: `${V.priCmd(`${x.s}1` as 'l1')} && (fuel.pri_${x.s}1_lowpress != fuel.pri_${x.s}2_lowpress)`, delayS: 3 },
    { id: `${x.s}_aux_fuel_pump`, text: `${x.S} AUX FUEL PUMP`, level: 'advisory', when: `${V.auxCmd(x.s)} && fuel.aux_${x.s}_lowpress`, delayS: 3 },
  ]),
  { id: 'fuel_xfer_on_auto_lr', text: 'FUEL XFER ON', level: 'advisory', when: `${V.wingXferCmd('lr')} && ${V.wingXfer} == 1` },
  { id: 'fuel_xfer_on_auto_rl', text: 'FUEL XFER ON', level: 'advisory', when: `${V.wingXferCmd('rl')} && ${V.wingXfer} == 1` },
  { id: 'apu_fault', text: 'APU FAULT', level: 'advisory', when: 'apu.fault' },
  { id: 'apu_shutdown', text: 'APU SHUTDOWN', level: 'advisory', when: 'apu.fire_shutdown || (apu.fault && !apu.overspeed)' },
  { id: 'apu_in_bite', text: 'APU IN BITE', level: 'advisory', when: 'apu.state == 1' },
  { id: 'stall_warn_advance', text: 'STALL WARN ADVANCE', level: 'advisory', when: `ice.detected && !${V.waiCmd('l')}` },
  { id: 'brake_temp', text: 'BRAKE TEMP', level: 'advisory', when: 'max(brakes.temp_left_c, brakes.temp_right_c) > 300' }, // EST white-range start
  { id: 'xbleed_open', text: 'XBLEED OPEN', level: 'advisory', when: `pneu.iso_open && ${V.xbleed} != 2` }, // EST text

  // ================================================================ WHITE (status)
  { id: 'aux_press_on', text: 'AUX PRESS ON', level: 'status', when: `${V.auxPress} == 1` }, // GX PTG 13 status list
  { id: 'ext_ac_avail', text: 'EXT AC PWR AVAIL', level: 'status', when: `elec.ext_ac_avail && ${V.extAc} == 0` },
  { id: 'ext_ac_on', text: 'EXT AC PWR ON', level: 'status', when: `elec.ext_ac_online` },
  { id: 'ext_dc_avail', text: 'EXT DC PWR AVAIL', level: 'status', when: `elec.ext_dc_avail && ${V.extDc} == 0` },
  { id: 'ext_dc_on', text: 'EXT DC PWR ON', level: 'status', when: 'elec.ext_dc_online' },
  ...n4((n) => ({ id: `gen${n}_off`, text: `GEN ${n} OFF`, level: 'status', when: `${V.gen(n)} == 0` })),
  { id: 'apu_gen_off', text: 'APU GEN OFF', level: 'status', when: `${V.apuGen} == 0 && apu.avail` },
  { id: 'rat_gen_off', text: 'RAT GEN OFF', level: 'status', when: `${V.ratDeployed} && ${V.ratGen} == 0` },
  ...n4((n) => ({ id: `ac_bus${n}_man_off`, text: `AC BUS ${n} MAN OFF`, level: 'status', when: V.acBusIsol(n) })),
  { id: 'dc_bus1_man_off', text: 'DC BUS 1 MAN OFF', level: 'status', when: V.dcBusIsol('dc_bus1') },
  { id: 'dc_bus2_man_off', text: 'DC BUS 2 MAN OFF', level: 'status', when: V.dcBusIsol('dc_bus2') },
  { id: 'dc_ess_man_off', text: 'DC ESS BUS MAN OFF', level: 'status', when: V.dcBusIsol('dc_ess') },
  { id: 'batt_bus_man_off', text: 'BATT BUS MAN OFF', level: 'status', when: V.dcBusIsol('batt_bus') },
  { id: 'l_hyd_sov_clsd', text: 'L HYD SOV CLSD', level: 'status', when: `!${V.sovOpen(1)}` },
  { id: 'r_hyd_sov_clsd', text: 'R HYD SOV CLSD', level: 'status', when: `!${V.sovOpen(2)}` },
  ...each((x) => [
    { id: `${x.s}_pri_pumps_off`, text: `${x.S} PRI PUMPS OFF`, level: 'status', when: `${V.priPumps(x.s)} == 0` },
    { id: `${x.s}_aux_pump_off`, text: `${x.S} AUX PUMP OFF`, level: 'status', when: `${V.auxPump(x.s)} == 0` },
    { id: `${x.s}_eng_sov_clsd`, text: `${x.S} ENG SOV CLSD`, level: 'status', when: V.fireHandle(x.s) },
    { id: `${x.s}_eng_bleed_off`, text: `${x.S} ENG BLEED OFF`, level: 'status', when: `${V.engBleed(x.s)} == 0 || ${V.fireHandle(x.s)}` },
    { id: `${x.s}_pack_off`, text: `${x.S} PACK OFF`, level: 'status', when: `${V.pack(x.s)} == 0` }, // GX PTG 13 status list
    // GX PTG 13 status list (PACK CONTROL, V.packFlowSel 0 LO / 2 HIGH / 3 MAN; the single-pack automatic high schedule
    // is not a selection and posts nothing, EST).
    { id: `${x.s}_pack_high_flow`, text: `${x.S} PACK HIGH FLOW`, level: 'status', when: `${V.pack(x.s)} == 1 && ${V.packFlowSel} == 2` },
    { id: `${x.s}_pack_low_flow`, text: `${x.S} PACK LOW FLOW`, level: 'status', when: `${V.pack(x.s)} == 1 && ${V.packFlowSel} == 0` },
    { id: `${x.s}_pack_man_temp`, text: `${x.S} PACK MAN TEMP`, level: 'status', when: `${V.pack(x.s)} == 1 && ${V.packFlowSel} == 3` },
    { id: `${x.s}_eng_n1_mode`, text: `${x.S} ENG N1 MODE`, level: 'status', when: `${V.engN1Mode(x.i)} == 1` }, // EST text
  ]),
  { id: 'aft_fuel_xfer_off', text: 'AFT FUEL XFER OFF', level: 'status', when: `${V.aftXfer} == 0` },
  { id: 'aft_fuel_xfer_on', text: 'AFT FUEL XFER ON', level: 'status', when: `${V.aftXfer} == 2 && fuel.aft_usable_kg > 1` },
  { id: 'wing_fuel_xfer_off', text: 'WING FUEL XFER OFF', level: 'status', when: `${V.wingXfer} == 0` },
  { id: 'fuel_xfer_on_man', text: 'FUEL XFER ON', level: 'status', when: `${V.wingXfer} >= 2` },
  { id: 'xfeed_valve_open', text: 'XFEED VALVE OPEN', level: 'status', when: 'fuel.xfeed_open' },
  { id: 'apu_fuel_sov_clsd', text: 'APU FUEL SOV CLSD', level: 'status', when: `${V.fireHandle('apu')} || !elec.apu_fire_sov_powered` },
  { id: 'fuel_recirc_off', text: 'FUEL RECIRC OFF', level: 'status', when: `${V.recirc('l')} == 0 || ${V.recirc('r')} == 0` },
  { id: 'apu_bleed_on', text: 'APU BLEED ON', level: 'status', when: 'pneu.apu_valve_open' },
  { id: 'apu_bleed_off', text: 'APU BLEED OFF', level: 'status', when: `${V.apuBleed} == 0 && apu.avail` },
  { id: 'gld_manual_arm', text: 'GLD MANUAL ARM', level: 'status', when: `${V.gldManArm} == 1` },
  { id: 'gld_off', text: 'GLD OFF', level: 'status', when: `${V.gldOff} == 1` }, // EST text
  { id: 'park_emer_brake_on', text: 'PARK/EMER BRAKE ON', level: 'status', when: `${gnd} && ${V.parkBrake} > 0.05 && !${V.toThrust}` },
  { id: 'autobrake_low', text: 'AUTOBRAKE LOW', level: 'status', when: `brakes.autobrake_armed && ${V.autobrake} == 1` },
  { id: 'autobrake_med', text: 'AUTOBRAKE MED', level: 'status', when: `brakes.autobrake_armed && ${V.autobrake} == 2` },
  { id: 'autobrake_hi', text: 'AUTOBRAKE HI', level: 'status', when: `brakes.autobrake_armed && ${V.autobrake} == 3` },
  { id: 'gear_horn_muted', text: 'GEAR HORN MUTED', level: 'status', when: V.hornMuteEff },
  { id: 'nose_steer_off', text: 'NOSE STEER OFF', level: 'status', when: `${V.nwsArm} == 0` },
  { id: 'ram_air_on', text: 'RAM AIR ON', level: 'status', when: `${V.ramAir} == 1` }, // EST text
  { id: 'emerg_depress', text: 'EMERG DEPRESS ON', level: 'status', when: `${V.emerDepress} == 1` }, // EST text
  { id: 'ditching_on', text: 'DITCHING ON', level: 'status', when: `${V.ditching} == 1` }, // EST text
  { id: 'cabin_press_man', text: 'CABIN PRESS MAN', level: 'status', when: `${V.pressAutoMan} == 2` }, // EST text
  { id: 'wing_ai_on', text: 'WING A/ICE ON', level: 'status', when: `${V.waiCmd('l')} || ${V.waiCmd('r')}` }, // EST text
  ...each((x) => [{ id: `${x.s}_cowl_ai_on`, text: `${x.S} COWL A/ICE ON`, level: 'status', when: V.caiCmd(x.s) } as CasMessageDef]), // EST text
  { id: 'pass_oxy_on', text: 'PASS OXY ON', level: 'status', when: 'oxy.pax_on' }, // EST text
  { id: 'terrain_off', text: 'TERRAIN OFF', level: 'status', when: `${V.terrOff} == 1` }, // EST text
  { id: 'flap_ovrd', text: 'FLAP OVRD', level: 'status', when: `${V.flapOvrd} == 1` }, // EST text
];
