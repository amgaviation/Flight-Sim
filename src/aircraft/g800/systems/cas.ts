/**
 * G800 Crew Alerting System messages (CasManager definitions; the Epic suite's
 * GulfstreamCas presents them). Gulfstream CAS text style is mixed case with
 * the side prefix ("L Engine Fire"); a published "L-R" message is two
 * messages here.
 *
 * Text sources:
 *  - [EPIC] GULFSTREAM_CAS_TEXTS (src/avionics/honeywell-epic/logic/cas.ts:
 *    FAA FSB GVI Rev 11, code450 checklists, G650ER CAS photograph).
 *  - [C450] code450.com abnormal pages (G450-family published texts: "Engine
 *    Fire, L-R", "APU Fire", "Aft Baggage Smoke", "Fire Bottle Discharge, L-R",
 *    "Fire Detection Loop Fault", "Cabin Pressure Low", "Cabin Pressure Manual",
 *    "CPCS Fail—Select Manual", "Bleed Pressure Low, L-R", "Bleed Air Hot, L-R",
 *    "ACS Fail, L-R", "Main Fuel Pump Fail, L-R", "Alt Fuel Pump Fail, L-R",
 *    "Fuel Pressure Low, L-R", "Fuel Level Low, L-R", "Fuel Imbalance",
 *    "Fuel Tank Temperature", "Oil Pressure Low", "Engine ALT Control, L-R",
 *    "Autostart Abort", "APU Generator On", "Autobrake Medium").
 *  - [SCQ] SmartCockpit G650 quizzes ("PTU Hydraulic Fail", "Aux Hydraulic Pump
 *    Overload", "Speed Brake Auto Retract", "Stabilizer Failed").
 *  - [EST] no public G800 text: composed in the same Gulfstream style.
 *  - [AUD] texts given by the function audit from code450 G700 / G800 pages not re-verified here (fix round 1).
 * Consequential lines (">" prefix, Gulfstream directive consequential alerts, AFM 00-20-20 per the audit) are posted
 * with their parent message's level and do not light the master lamp again.
 * Levels follow the sources (red = warning, amber = caution, blue = advisory).
 * WARN INHIBIT (glareshield) holds a few nuisance cautions back on the takeoff roll (`ac.g800.warn_inh_active`,
 * logic.ts; EST function). Conditions are this simulation's system states; inhibits: takeoff/landing
 * phase inhibits (CasManager FlightPhase, 777-style defaults, EST) for
 * nuisance cautions.
 */
import type { CasMessageDef } from '../../../systems/warning';
import { G800_LIMITS, LB } from '../data';
import { IMBALANCE_FLIGHT_KG, IMBALANCE_GROUND_KG } from './fuel';
import { G800_VARS as V } from '../vars';

const sides = [
  { s: 'L', i: 1, idg: 'idg1', l: 'l', hyd: 'left', batt: 'batt_l', fuel: 'left', tank: 0 },
  { s: 'R', i: 2, idg: 'idg2', l: 'r', hyd: 'right', batt: 'batt_r', fuel: 'right', tank: 1 },
] as const;

export const G800_CAS: CasMessageDef[] = [
  // =============================================================== WARNINGS (red)
  ...sides.map((x): CasMessageDef => ({ id: `eng_fire_${x.l}`, text: `${x.s} Engine Fire`, level: 'warning', when: `fire.eng${x.i}_warn`, aural: { callout: `${x.s === 'L' ? 'Left' : 'Right'} engine fire`, priority: 8, repeatS: 5 } })), // [C450]
  // Directive consequential line under each engine fire: posted while that power lever is not at idle. [AUD]
  ...sides.map((x): CasMessageDef => ({ id: `eng_fire_${x.l}_idle`, text: `> Reduce ${x.s} Throttle To Idle`, level: 'warning', master: false, when: `fire.eng${x.i}_warn && ${V.tla(x.i)} > 0.05` })),
  // Engine core compartment fire (GVII family separate core-fire detection, [AUD]; text [EST]).
  ...sides.map((x): CasMessageDef => ({ id: `core_fire_${x.l}`, text: `${x.s} Engine Core Fire`, level: 'warning', when: `fire.core${x.i}_warn`, aural: { callout: `${x.s === 'L' ? 'Left' : 'Right'} engine fire`, priority: 8, repeatS: 5 } })),
  { id: 'apu_fire', text: 'APU Fire', level: 'warning', when: 'fire.apu_warn', aural: { callout: 'A P U fire', priority: 8, repeatS: 5 } }, // [C450]
  { id: 'apu_fire_fail', text: '> APU Fail', level: 'warning', master: false, when: 'fire.apu_warn && !apu.running' }, // [AUD] consequential (ECU fire shutdown)
  { id: 'aft_baggage_smoke', text: 'Aft Baggage Smoke', level: 'warning', when: 'fire.baggage_warn' }, // [EPIC][C450]
  { id: 'cabin_press_low', text: 'Cabin Pressure Low', level: 'warning', when: 'press.cabin_alt_warn', aural: { callout: 'Cabin pressure', priority: 8, repeatS: 5 } }, // [C450] 8,000 ft cabin
  ...sides.map((x): CasMessageDef => ({ id: `acs_fail_${x.l}`, text: `${x.s} ACS Fail`, level: 'warning', when: `pneu.pack_${x.l}_trip` })), // [C450] "ACS FAIL, L-R" (red)
  { id: 'overspeed', text: 'Overspeed', level: 'warning', when: 'alert.overspeed', master: true }, // [EST] (clacker from Overspeed)
  { id: 'gear_not_down', text: 'Landing Gear Not Down', level: 'warning', when: 'alert.gear_warning' }, // [EST] (horn from LandingGear)
  { id: 'fcc_direct', text: 'FCC Direct Mode', level: 'warning', when: `fbw.mode_code == 2 && !${V.fcsBackup} && fcc.power_ok` }, // [EST]
  // BACKUP: FCCs lost, the BFCU flies the aircraft (BJT500 four modes; SCQ two dual-channel FCCs + BFCU). [EST] text.
  { id: 'fcs_backup', text: 'Flight Control Backup Mode', level: 'warning', when: V.fcsBackup },
  { id: 'fcs_fail', text: 'Flight Control Fail', level: 'warning', when: 'gear.air_ground == 0 && !fcc.power_ok' }, // [EST] no FCC and no BFCU power
  { id: 'takeoff_config', text: 'Takeoff Config', level: 'warning', when: 'alert.takeoff_config' }, // [EST] Gulfstream TOCW red CAS; the aural names the item (TakeoffConfigWarning)
  // Reverser unlock in flight (fix round 1 F01): the G450-family CAS carries a red "Reverser Unlock, L-R"
  // warning with an aural (code450 abnormal pages); posted when the FADEC sees the sleeve unlocked or in
  // transit without a reverse-lever command. Mixed-case per the G800 style.
  ...sides.map((x): CasMessageDef => ({
    id: `rev_unlock_${x.l}`,
    text: `${x.s} Reverser Unlock`,
    level: 'warning',
    when: `gear.air_ground == 0 && (fadec.eng${x.i}.rev_unlocked || eng${x.i}.reverser_pos > 0.05) && ${V.rev(x.i)} < 0.02`,
    aural: { callout: `${x.s === 'L' ? 'Left' : 'Right'} reverser unlock`, priority: 8, repeatS: 5 },
  })),

  // =============================================================== CAUTIONS (amber)
  // ---- electrical
  ...sides.map((x): CasMessageDef => ({ id: `gen_off_${x.l}`, text: `${x.s} Generator Off`, level: 'caution', when: `eng${x.i}.running && !elec.${x.idg}_online && !ac.g800.warn_inh_active`, delayS: 3 })), // [EST]
  ...sides.map((x): CasMessageDef => ({ id: `main_ac_fail_${x.l}`, text: `${x.s} Main AC Bus Fail`, level: 'caution', when: `(eng1.running || eng2.running || apu.avail) && !elec.${x.l}_main_ac_powered && !ac.g800.warn_inh_active`, delayS: 2 })), // [EST] style of C450 "Essential AC-Bus Fail"
  { id: 'ess_ac_fail', text: 'Essential AC-Bus Fail', level: 'caution', when: '(eng1.running || eng2.running || apu.avail) && (!elec.l_ess_ac_powered || !elec.r_ess_ac_powered)', delayS: 2 }, // [C450]
  ...sides.map((x): CasMessageDef => ({ id: `main_tru_fail_${x.l}`, text: `${x.s} Main TRU Fail`, level: 'caution', when: `elec.${x.l}_main_ac_powered && !elec.${x.l}_main_tru_online`, delayS: 2 })), // [EST]
  ...sides.map((x): CasMessageDef => ({ id: `ess_dc_fail_${x.l}`, text: `${x.s} Ess DC Bus Fail`, level: 'caution', when: `(${x.l === 'l' ? V.battL : V.battR} == 1 || eng${x.i}.running) && !elec.${x.l}_ess_dc_powered`, delayS: 1 })), // [EST]
  ...sides.map((x): CasMessageDef => ({ id: `batt_disch_${x.l}`, text: `${x.s} Main Batt Discharge`, level: 'caution', when: `elec.${x.batt}_amps < -8`, delayS: 10 })), // [SCQ] main battery amber when powering the ESS buses alone; text EST
  { id: 'emer_pwr_on', text: 'Emergency Power On', level: 'caution', when: V.ebattOn }, // [EST]
  // ---- hydraulics
  ...sides.map((x): CasMessageDef => ({ id: `hyd_low_${x.l}`, text: `${x.s} Hydraulic Pressure Low`, level: 'caution', when: `eng${x.i}.running && hyd.${x.hyd}_lowpress && !ac.g800.warn_inh_active`, delayS: 2 })), // [EST]
  ...sides.map((x): CasMessageDef => ({ id: `hyd_qty_${x.l}`, text: `${x.s} Hydraulic Quantity Low`, level: 'caution', when: `hyd.${x.hyd}_lowqty` })), // [EST]
  { id: 'ptu_fail', text: 'PTU Hydraulic Fail', level: 'caution', when: `${V.ptuOn} && hyd.right_psi > 2200 && hyd.left_psi < ${G800_LIMITS.ptuFailPsi}`, delayS: 5 }, // [SCQ]
  { id: 'aux_hyd_overload', text: 'Aux Hydraulic Pump Overload', level: 'caution', when: 'hyd.aux_overheat' }, // [SCQ]
  // ---- fuel
  // Low engine inlet pressure while the FADEC commands fuel (not only while running: a suction-feed loss shows before and
  // after the flameout; function fix round 1). [C450]
  ...sides.map((x): CasMessageDef => ({ id: `fuel_press_${x.l}`, text: `${x.s} Fuel Pressure Low`, level: 'caution', when: `fadec.eng${x.i}.fuel_cmd && fuel.eng${x.i}_lowpress && (eng${x.i}.running || gear.air_ground == 0)`, delayS: 2 })),
  ...sides.map((x): CasMessageDef => ({ id: `boost_fail_${x.l}`, text: `${x.s} Main Fuel Pump Fail`, level: 'caution', when: `fuel.boost_${x.l}_lowpress`, delayS: 2 })), // [C450]
  ...sides.map((x): CasMessageDef => ({ id: `alt_pump_fail_${x.l}`, text: `${x.s} Alt Fuel Pump Fail`, level: 'caution', when: `fuel.alt_${x.l}_lowpress`, delayS: 2 })), // [C450]
  ...sides.map((x): CasMessageDef => ({ id: `fuel_low_${x.l}`, text: `${x.s} Fuel Level Low`, level: 'caution', when: `fuel.tank${x.tank}_kg < ${(G800_LIMITS.fuelLowLb * LB).toFixed(1)}`, delayS: 5 })), // [C450] 650 lb (GVI)
  // GVI limitation: 2,000 lb max imbalance, 1,000 lb for takeoff. EST: 1,000 lb on the ground, 2,000 lb in flight. [C450] text
  { id: 'fuel_imbalance', text: 'Fuel Imbalance', level: 'caution', when: `abs(fuel.tank0_kg - fuel.tank1_kg) > (gear.air_ground ? ${IMBALANCE_GROUND_KG.toFixed(1)} : ${IMBALANCE_FLIGHT_KG.toFixed(1)})`, delayS: 10 },
  { id: 'fuel_tank_temp', text: 'Fuel Tank Temperature', level: 'caution', when: 'min(fuel.left_temp_c, fuel.right_temp_c) < -37', delayS: 5 }, // [C450] GVI min fuel tank temperature -37 degC
  // ---- engines
  ...sides.map((x): CasMessageDef => ({ id: `oil_press_${x.l}`, text: `${x.s} Engine Oil Pressure Low`, level: 'caution', when: `eng${x.i}.running && eng${x.i}.oil_press_psi < ${G800_LIMITS.oilPressMinPsi}`, delayS: 2 })), // [C450] "Oil Pressure Low" (25 psid, E135)
  ...sides.map((x): CasMessageDef => ({ id: `autostart_abort_${x.l}`, text: `${x.s} Autostart Abort`, level: 'caution', when: `fadec.eng${x.i}.abort` })), // [C450]
  // Amber on the G700 / G800 (C450S G700 powerplant p32 per the audit; the G450 text was blue).
  ...sides.map((x): CasMessageDef => ({ id: `eng_alt_ctl_${x.l}`, text: `${x.s} Engine ALT Control`, level: 'caution', when: `fail.fadec.eng${x.i} || ${V.engAlt(x.i)}` })),
  // "L-R Eng Fail" [AUD]: fuel commanded, engine not running, airborne (no N2 gate: a flameout posts at once).
  ...sides.map((x): CasMessageDef => ({ id: `eng_fail_${x.l}`, text: `${x.s} Eng Fail`, level: 'caution', when: `gear.air_ground == 0 && fadec.eng${x.i}.fuel_cmd && !eng${x.i}.running && !(fadec.eng${x.i}.start_state >= 1 && fadec.eng${x.i}.start_state <= 3)`, delayS: 1 })),
  // Engine limits (E135 via G800_LIMITS / PEARL700 limits; texts [EST] in Gulfstream style).
  ...sides.map((x): CasMessageDef => ({ id: `oil_temp_${x.l}`, text: `${x.s} Engine Oil Temp High`, level: 'caution', when: `eng${x.i}.oil_temp_c > 170`, delayS: 2 })), // E135 / GVI max 170 degC
  ...sides.map((x): CasMessageDef => ({ id: `eng_exceed_${x.l}`, text: `${x.s} Engine Exceedance`, level: 'caution', when: `eng${x.i}.running && (eng${x.i}.n1_pct > 97.8 || eng${x.i}.n2_pct > 103.4 || eng${x.i}.itt_c > 950)`, delayS: 1 })), // E135 overspeed / transient TGT
  ...sides.map((x): CasMessageDef => ({ id: `start_protect_${x.l}`, text: `${x.s} Engine Start Protect`, level: 'advisory', when: V.startProtect(x.i) })), // C450S G700/G800 powerplant
  // Amber ground variant of the reverser unlock (fix round 1 F01): sleeve unlocked / in transit on the ground
  // without a reverse command past the normal stow time ([EST] text in the F01 warning's style; delay lets a
  // commanded stow transit finish without a nuisance caution).
  ...sides.map((x): CasMessageDef => ({ id: `rev_unlock_gnd_${x.l}`, text: `${x.s} Reverser Unlock`, level: 'caution', when: `gear.air_ground && (fadec.eng${x.i}.rev_unlocked || eng${x.i}.reverser_pos > 0.05) && ${V.rev(x.i)} < 0.02`, delayS: 5 })),
  // ---- bleed / ECS / pressurization
  ...sides.map((x): CasMessageDef => ({ id: `bleed_low_${x.l}`, text: `${x.s} Bleed Pressure Low`, level: 'caution', when: `eng${x.i}.running && pneu.bleed_${x.l}_valve_open && pneu.${x.l}_man_psi < 12 && !ac.g800.warn_inh_active`, delayS: 5, inhibit: ['GROUND'] })), // [C450]
  ...sides.map((x): CasMessageDef => ({ id: `bleed_hot_${x.l}`, text: `${x.s} Bleed Air Hot`, level: 'caution', when: `pneu.bleed_${x.l}_trip` })), // [C450]
  { id: 'cabin_press_manual', text: 'Cabin Pressure Manual', level: 'caution', when: `${V.pressMode} == 2` }, // [C450]
  { id: 'cpcs_fail', text: 'CPCS Fail—Select Manual', level: 'caution', when: 'press.auto_fail && press.altn_fail' }, // [C450]
  // ---- ice
  ...sides.map((x): CasMessageDef => ({ id: `wai_fail_${x.l}`, text: `${x.s} Wing Anti-Ice Fail`, level: 'caution', when: `${V.waiOn(x.i)} && pneu.wai_${x.l}_ok < 0.5`, delayS: 120 })), // [EST] (SCQ: amber after 2 min out of temperature)
  ...sides.map((x): CasMessageDef => ({ id: `cai_fail_${x.l}`, text: `${x.s} Cowl Anti-Ice Fail`, level: 'caution', when: `${V.caiOn(x.i)} && pneu.cai_${x.l}_ok < 0.5`, delayS: 20 })), // [EST]
  // Per-probe heat monitoring (fix round 1 F09): GVI-family CAS annunciates individual probe-heat failures
  // per side so the crew knows which ADS to distrust (SCQ ice & rain; side-labeled texts [EST] in GVI style).
  // Pitot 1 / static 1 and the standby pitot 3 are on the L probes bus, pitot 2 / static 2 on the R (environment.ts).
  { id: 'pitot_heat_fail_l', text: 'L Pitot Heat Fail', level: 'caution', when: `${V.probeHeatOn} && (fail.ice.pitot1.heat || !elec.probes_l_powered)`, delayS: 2 },
  { id: 'pitot_heat_fail_r', text: 'R Pitot Heat Fail', level: 'caution', when: `${V.probeHeatOn} && (fail.ice.pitot2.heat || !elec.probes_r_powered)`, delayS: 2 },
  { id: 'pitot_heat_fail_std', text: 'Std Pitot Heat Fail', level: 'caution', when: `${V.probeHeatOn} && (fail.ice.pitot3.heat || !elec.probes_l_powered)`, delayS: 2 },
  { id: 'static_heat_fail_l', text: 'L Static Heat Fail', level: 'caution', when: `${V.probeHeatOn} && (fail.ice.static1.heat || !elec.probes_l_powered)`, delayS: 2 },
  { id: 'static_heat_fail_r', text: 'R Static Heat Fail', level: 'caution', when: `${V.probeHeatOn} && (fail.ice.static2.heat || !elec.probes_r_powered)`, delayS: 2 },
  // ---- fire protection
  { id: 'fire_loop_fault', text: 'Fire Detection Loop Fault', level: 'caution', when: 'fire.eng1_fault || fire.eng2_fault || fire.apu_fault' }, // [C450]
  { id: 'bottle_l', text: 'L Fire Bottle Discharge', level: 'caution', when: 'fire.bottle_l_discharged' }, // [C450]
  { id: 'bottle_r', text: 'R Fire Bottle Discharge', level: 'caution', when: 'fire.bottle_r_discharged' },
  { id: 'apu_fault', text: 'APU Fault', level: 'caution', when: 'apu.fault' }, // [EST]
  // ---- flight controls
  { id: 'fcc_alternate', text: 'FCC Alternate Mode', level: 'caution', when: 'fbw.mode_code == 1' }, // [EPIC]
  { id: 'stall_prot_unavail', text: 'Stall Protection Unavail', level: 'caution', when: 'fbw.mode_code != 0' }, // [EPIC] (GVI: SPS operable only in Normal mode)
  { id: 'steer_by_wire_fail', text: 'Steer by Wire Fail', level: 'caution', when: '(eng1.running || eng2.running || gear.air_ground == 0) && (fail.steer || !elec.nws_ctl_powered)', delayS: 1 }, // [EPIC]
  { id: 'pedal_steer_fail', text: 'Pedal Steering Fail', level: 'caution', when: `fail.steer.pedal && ${V.pedalSteer} == 1`, delayS: 1 }, // [EPIC]
  // FCCs / BFCU (two dual-channel FCCs + BFCU, SCQ). [EST] texts.
  { id: 'fcc_fail', text: 'FCC Fail', level: 'caution', when: `${V.fccFault} && fcc.power_ok && (eng1.running || eng2.running || gear.air_ground == 0)`, delayS: 1 },
  { id: 'bfcu_fail', text: 'BFCU Fail', level: 'caution', when: '!elec.bfcu_powered && elec.fcc_powered && (eng1.running || eng2.running || gear.air_ground == 0)', delayS: 1 },
  { id: 'speed_brake_auto_retract', text: 'Speed Brake Auto Retract', level: 'caution', when: `gear.air_ground == 0 && ${V.speedbrake} > 0.1 && !${V.idleBoth}`, delayS: 1 }, // [SCQ]
  { id: 'flap_fail', text: 'Flap Fail', level: 'caution', when: 'flaps.disagree || flaps.asym' }, // [EST]
  { id: 'stab_fail', text: 'Stabilizer Failed', level: 'caution', when: 'fail.fbw.stab' }, // [SCQ] jammed horizontal stabilizer (failure fbw.stab; fix round 1 F13)
  { id: 'trim_up_limit', text: 'Elevator Trim Up Limit', level: 'advisory', when: 'surf.pitch_trim > 0.98' }, // [EPIC]
  { id: 'trim_dn_limit', text: 'Elevator Trim Down Limit', level: 'advisory', when: 'surf.pitch_trim < -0.98' }, // [EPIC]
  { id: 'aoa_limiting', text: 'AOA Limiting', level: 'advisory', when: 'fbw.aoa_limit' }, // [EPIC]
  // ---- gear / brakes
  { id: 'gear_disagree', text: 'Landing Gear Disagree', level: 'caution', when: 'gear.disagree' }, // [EST]
  { id: 'brake_overheat', text: 'Brake Overheat', level: 'caution', when: `max(brakes.temp_left_c, brakes.temp_right_c) > ${G800_LIMITS.brakeOverheatC}` }, // [SCQ] 450 degC
  { id: 'antiskid_fail', text: 'Antiskid Fail', level: 'caution', when: 'brakes.antiskid_inop && (eng1.running || eng2.running)', delayS: 2 }, // [EST]
  // ---- sensors / avionics (function fix round 1; [AUD] GVI-family style, texts [EST])
  ...[1, 2, 3].map((n): CasMessageDef => ({ id: `ads_fail_${n}`, text: `ADS ${n} Fail`, level: 'caution', when: `!adc${n}.valid && (elec.l_ess_dc_powered || elec.r_ess_dc_powered)`, delayS: 5 })),
  ...[1, 2, 3].map((n): CasMessageDef => ({ id: `irs_fail_${n}`, text: `IRS ${n} Fail`, level: 'caution', when: `!ahrs${n}.att_valid && !ahrs${n}.aligning && (elec.l_ess_dc_powered || elec.r_ess_dc_powered)`, delayS: 5 })),
  ...[1, 2].map((n): CasMessageDef => ({ id: `ra_fail_${n}`, text: `Rad Alt ${n} Fail`, level: 'caution', when: `(fail.ra${n} || !elec.ra${n}_powered) && (eng1.running || eng2.running)`, delayS: 5 })),
  { id: 'tcas_fail', text: 'TCAS Fail', level: 'caution', when: '(fail.tcas || !elec.tcas_powered) && (eng1.running || eng2.running)', delayS: 5 },
  { id: 'taws_fail', text: 'TAWS Fail', level: 'caution', when: 'taws.inop && (eng1.running || eng2.running)', delayS: 5 },
  { id: 'fms_fail', text: 'FMS Fail', level: 'caution', when: '!elec.fms_powered && (eng1.running || eng2.running || apu.avail)', delayS: 3 },
  // ---- ice / window heat (EST texts)
  ...sides.map((x): CasMessageDef => ({ id: `wshld_heat_fail_${x.l}`, text: `${x.s} Windshield Heat Fail`, level: 'caution', when: `ac.g800.wshld_${x.l}_on && !elec.wshld_${x.l}_powered && (eng1.running || eng2.running || apu.avail)`, delayS: 5 })),
  { id: 'cabin_wdo_heat_fail', text: 'Cabin Window Heat Fail', level: 'caution', when: `${V.cabinWdoHeat} == 1 && !elec.cabin_wdo_powered && (eng1.running || eng2.running || apu.avail)`, delayS: 5 },
  { id: 'ice_det_fail', text: 'Ice Detector Fail', level: 'caution', when: 'ice.detector_fail || ((eng1.running || eng2.running) && !elec.ice_det_powered)', delayS: 5 },
  // ---- oxygen
  { id: 'crew_oxy_low', text: 'Crew Oxygen Low', level: 'caution', when: 'oxy.crew_low' }, // [EST]

  // =============================================================== ADVISORIES (blue)
  { id: 'aux_hyd_on', text: 'Aux Hydraulic On', level: 'advisory', when: 'hyd.aux_on' }, // [EPIC]
  { id: 'apu_gen_on', text: 'APU Generator On', level: 'advisory', when: 'elec.apu_gen_online && (eng1.running || eng2.running)' }, // [C450]
  { id: 'isolation_valve_open', text: 'Isolation Valve Open', level: 'advisory', when: `pneu.iso_open && ${V.startMaster} == 0` }, // [EPIC]
  { id: 'gnd_spoiler_unarm', text: 'Ground Spoiler Unarm', level: 'advisory', when: `${V.gndSplrArm} == 0 && gear.air_ground && (eng1.running || eng2.running)` }, // [EPIC]
  { id: 'stuck_mic', text: 'Stuck Mic', level: 'advisory', when: V.stuckMic }, // [EST] Honeywell-style stuck-microphone message (systems/audio.ts)
  { id: 'pedal_steering_off', text: 'Pedal Steering Off', level: 'advisory', when: `${V.pedalSteer} == 0` }, // [EPIC] PEDAL STEER switchlight OFF
  { id: 'terr_inhibit', text: 'Terrain Inhibit', level: 'advisory', when: V.tawsTerrInh }, // [EST] TSC TAWS
  { id: 'gpws_inhibit', text: 'GPWS Inhibit', level: 'advisory', when: V.tawsGpwsInh }, // [EST]
  { id: 'taws_flap_ovrd', text: 'TAWS Flap Override', level: 'advisory', when: V.tawsFlapOvrd }, // [EST]
  { id: 'edm', text: 'Emergency Descent Mode', level: 'advisory', when: V.edmActive }, // [EST] (FMA EDM not drawn, SCOPE)
  { id: 'xflow_open', text: 'Fuel Crossflow Open', level: 'advisory', when: `${V.xflow} == 1` }, // [EST]
  { id: 'parking_brake_on', text: 'Parking Brake On', level: 'advisory', when: 'brakes.parking_set' }, // [EPIC]
  { id: 'main_door', text: 'Main Door', level: 'advisory', when: 'ac.door.main > 0.02' }, // [EPIC]
  { id: 'irs_aligning', text: 'IRS 1-2-3 Aligning', level: 'advisory', when: 'ahrs1.aligning || ahrs2.aligning || ahrs3.aligning' }, // [EPIC]
  { id: 'rat_deployed', text: 'RAT Deployed', level: 'advisory', when: V.ratDeployed }, // [EST]
  { id: 'rat_gen_on', text: 'RAT Generator On', level: 'advisory', when: 'ac.g800.rat_mode' }, // code450 G700/G800 electrical (blue)
  { id: 'fcs_batt_ebha_on', text: 'EBHA Battery On', level: 'advisory', when: `${V.fcsBattEbha} && !elec.emer_ac_powered && elec.emer_dc_powered` }, // [EST] text
  // Per-pair advisories (code450 G700/G800 electrical: two independent pairs; fix round 1 F08).
  { id: 'fwd_emer_batt_on', text: 'Fwd Emer Battery On', level: 'advisory', when: V.ebattFwdOn },
  { id: 'aft_emer_batt_on', text: 'Aft Emer Battery On', level: 'advisory', when: V.ebattAftOn },
  { id: 'door_safety', text: 'Main Door Safety On', level: 'advisory', when: `${V.doorSafety} && gear.air_ground` }, // [EST]
  { id: 'ice_detected', text: 'Ice Detected', level: 'advisory', when: 'ice.detected' }, // [EST]
  { id: 'hfr_on', text: 'Heated Fuel Return On', level: 'advisory', when: V.hfrActive }, // [EST]
  { id: 'pax_oxy_on', text: 'Passenger Oxygen On', level: 'advisory', when: 'oxy.pax_on' }, // [EST]
  { id: 'autobrake_low', text: 'Autobrake Low', level: 'advisory', when: `brakes.autobrake_armed && ${V.autobrake} == 1` }, // [C450] style "Autobrake Medium"
  { id: 'autobrake_med', text: 'Autobrake Medium', level: 'advisory', when: `brakes.autobrake_armed && ${V.autobrake} == 2` }, // [C450]
  { id: 'autobrake_high', text: 'Autobrake High', level: 'advisory', when: `brakes.autobrake_armed && ${V.autobrake} == 3` },
  { id: 'autobrake_rto', text: 'Autobrake RTO', level: 'advisory', when: `brakes.autobrake_armed && ${V.autobrake} == -1` },
  { id: 'cont_ign', text: 'Continuous Ignition On', level: 'advisory', when: `${V.contIgn} == 1` }, // [EST]
];
