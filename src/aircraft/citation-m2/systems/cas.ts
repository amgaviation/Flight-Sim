/**
 * Citation M2 Crew Alerting System messages (G3000 CAS on both PFDs,
 * S&D21 §10.3.9: master WARNING red / CAUTION amber, messages flash until
 * acknowledged with the MASTER WARNING / MASTER CAUTION switches; warnings
 * listed first).
 *
 * Texts and logic follow the CJ-family annunciators of the same type
 * certificate (525AFM-06 CJ1 AFM Section III / CAE CJ3-to-CJ/CJ1/CJ2
 * differences ch.5) and the operator M2 flows where they name the M2 G3000
 * wording ("WING ANTI-ICE COLD L-R", "ENGINE ANTI-ICE COLD L-R", "WING/ENG
 * ANTI-ICE ON", "TAIL DE-ICE ON / FAIL", "GENERATOR OFF L-R"). The M2 AFM CAS
 * list itself is not public: thresholds and texts not in those sources are
 * EST (docs/aircraft/citation-m2.md §8 is the authoritative list).
 *
 * Engine-related messages (GEN OFF, OIL PRESS, FUEL LOW PRESS, HYD FLOW LOW)
 * are posted whenever their condition exists, so they are lit before start and
 * extinguish as the engine comes up (525AFM-06 p.3-88 Starting Engines step 6:
 * "Fuel, Oil, Generator and Hydraulic Annunciators - EXTINGUISHED"). EST: with
 * the engine stopped on the ground they post without the master light (a
 * `_stop` twin with master: false), so battery-only cockpit preparation has no
 * master chime; running or airborne they light the master.
 *
 * Flight-phase inhibits (dossier §8, CJ family, EST): every caution and
 * advisory except fire, cabin altitude, gear, oil, door and the takeoff-
 * configuration messages is inhibited from 80 kt on the takeoff roll to 400 ft
 * RA and below 200 ft RA on landing (FlightPhase defaults). Warnings are never
 * inhibited.
 */
import type { CasMessageDef } from '../../../systems/warning';
import { M2_LIMITS } from '../data';
import { M2 } from '../vars';

const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';
const TL = 'takeoff+landing' as const;
const starting = '(elec.sg1_starter || elec.sg2_starter)';

function both(fn: (i: 1 | 2, s: 'L' | 'R', side: 'l' | 'r') => CasMessageDef | CasMessageDef[]): CasMessageDef[] {
  return [fn(1, 'L', 'l'), fn(2, 'R', 'r')].flat();
}

/** Engine running (above the generator cut-in) or airborne: masters light for the engine messages. */
export const runOrAir = (i: number): string => `(eng${i}.n2_pct > 45 || ${air})`;

/**
 * Engine message pair: `<id>` (engine running or airborne: master light) and `<id>_stop` (engine stopped on the
 * ground: posted without the master, pre-start / after shutdown).
 */
function engMsg(i: 1 | 2, d: CasMessageDef): CasMessageDef[] {
  return [
    { ...d, when: `(${d.when}) && ${runOrAir(i)}` },
    { ...d, id: `${d.id}_stop`, when: `(${d.when}) && !${runOrAir(i)}`, master: false },
  ];
}

/** L / R / L-R message trio (Garmin combined-side wording, M2 flows "... COLD L-R"). */
function lr(id: string, text: string, condL: string, condR: string, d: Omit<CasMessageDef, 'id' | 'text' | 'when'>): CasMessageDef[] {
  return [
    { ...d, id: `${id}_l`, text: `${text} L`, when: `(${condL}) && !(${condR})` },
    { ...d, id: `${id}_r`, text: `${text} R`, when: `(${condR}) && !(${condL})` },
    { ...d, id: `${id}_lr`, text: `${text} L-R`, when: `(${condL}) && (${condR})` },
  ];
}

const genOffBoth = `!elec.sg1_online && !elec.sg2_online && (${air} || eng1.n2_pct > 45 || eng2.n2_pct > 45)`;

export const M2_CAS: CasMessageDef[] = [
  // ------------------------------------------------------------ WARNINGS (red)
  ...both((i, s) => ({ id: `eng_fire_${s.toLowerCase()}`, text: `ENG FIRE ${s}`, level: 'warning', when: `fire.eng${i}_warn`, aural: { callout: 'ENGINE FIRE', repeatS: 10, priority: 2 } })),
  // 525AFM-06 p.3-16 "OIL PRESS L or R (Low Oil Pressure Warning)": all phases (no ground inhibit), below 23 psi.
  ...both((i, s) => engMsg(i, { id: `oil_press_${s.toLowerCase()}`, text: `OIL PRESS ${s}`, level: 'warning', when: `eng${i}.oil_press_psi < ${M2_LIMITS.oilPressMinPsi}`, delayS: 2 })),
  // Second generator failure: flashing GEN OFF + red MASTER WARNING + voice "GENERATOR FAIL" (525AFM-06 p.3-106,
  // CAE p.5-20); M2 flows "GENERATOR OFF L-R" (EST G3000 text GEN OFF L-R).
  { id: 'gen_off_lr', text: 'GEN OFF L-R', level: 'warning', when: genOffBoth, delayS: 1, aural: { callout: 'GENERATOR FAIL', repeatS: 10, priority: 3 } },
  { id: 'cabin_alt', text: 'CABIN ALTITUDE', level: 'warning', when: 'press.cabin_alt_warn', aural: { callout: 'CABIN ALTITUDE', repeatS: 5, priority: 2 } },
  { id: 'cabin_diff', text: 'CABIN DIFF PRESS', level: 'warning', when: 'press.excess_diff' },
  // CAE p.5-25 / 525AFM-06 p.3-106: BATT O'TEMP at 63 C with voice "BATTERY OVERTEMP"; above 71 C (160 F) a second
  // warning with a faster voice repeat (EST repeat periods).
  { id: 'batt_otemp', text: "BATT O'TEMP", level: 'warning', when: 'elec.batt_overtemp && elec.batt_temp_c < 71', aural: { callout: 'BATTERY OVERTEMP', repeatS: 10, priority: 3 } },
  { id: 'batt_otemp160', text: "BATT O'TEMP >160", level: 'warning', when: 'elec.batt_temp_c >= 71', aural: { callout: 'BATTERY OVERTEMP', repeatS: 3, priority: 3 } },
  { id: 'door_open', text: 'DOOR UNLOCKED', level: 'warning', when: `${air} && (${M2.doorOpen('cabin')} || ${M2.doorOpen('emer_exit')})` },
  { id: 'aoa_fail', text: 'AOA FAIL', level: 'warning', when: 'fail.adc1.aoa || fail.stall.warn' },
  { id: 'gear_unsafe', text: 'GEAR UNSAFE', level: 'warning', when: 'gear.unsafe || gear.disagree', delayS: 1 },
  { id: 'ap_trim_fail', text: 'AP TRIM FAIL', level: 'warning', when: 'fail.trim.pitch.runaway || fail.trim.pitch.jam' },
  // Takeoff configuration (EST G3000 wording; CJ family aural "TRIM" / "SPEED BRAKES" / "PARKING BRAKE" with a
  // visual annunciation): any takeoff-configuration fault except flaps (FLAPS >35 caution) at takeoff thrust.
  { id: 'to_config', text: 'T/O CONFIG', level: 'warning', when: 'alert.takeoff_config && tocw.flaps == 0' },
  // ------------------------------------------------------------ CAUTIONS (amber)
  ...both((i, s) => engMsg(i, { id: `gen_off_${s.toLowerCase()}`, text: `GEN OFF ${s}`, level: 'caution', when: `!elec.sg${i}_online && !(${genOffBoth})`, delayS: 1, inhibit: TL })),
  // EST (no CJ-family battery-discharge annunciator; 525AFM-06 p.3-86 battery-only avionics before start is normal):
  // only with an engine running or airborne.
  { id: 'batt_disch', text: 'BATT DISCHARGE', level: 'caution', when: `elec.batt_amps < -15 && !${starting} && (${air} || eng1.running || eng2.running)`, delayS: 10, inhibit: TL },
  { id: 'emer_bus', text: 'EMER BUS ON BATT', level: 'caution', when: `${M2.battSw} == -1`, inhibit: TL },
  { id: 'bus_volts_low', text: 'MAIN BUS VOLTS LOW', level: 'caution', when: `elec.batt_bus_powered && elec.batt_bus_v < 24.5 && !${starting}`, delayS: 5, inhibit: TL }, // EST
  // 525AFM-06 p.3-113 / CAE p.5-30: FUEL LOW LEVEL L/R at 220 +/-10 lb (M2 value EST 190 lb), master caution after 4 s.
  ...both((_i, s, side) => ({ id: `fuel_low_${s.toLowerCase()}`, text: `FUEL LOW LEVEL ${s}`, level: 'caution', when: `fuel.${side === 'l' ? 'left' : 'right'}_low`, delayS: 4, inhibit: TL })),
  ...both((i, s) => engMsg(i, { id: `fuel_press_low_${s.toLowerCase()}`, text: `FUEL LOW PRESS ${s}`, level: 'caution', when: `fuel.eng${i}_lowpress`, delayS: 2, inhibit: TL })),
  // 525AFM-06 p.3-113: FUEL FLTR BYPASS at ~10 psi across the filter (failure fuel.filter_l / _r, needs fuel flow).
  ...both((i, s, side) => ({ id: `fuel_fltr_${s.toLowerCase()}`, text: `FUEL FLTR BYPASS ${s}`, level: 'caution', when: `fail.fuel.filter_${side} && eng${i}.n2_pct > 45`, delayS: 2, inhibit: TL })),
  { id: 'fuel_imbal', text: 'FUEL IMBALANCE', level: 'caution', when: 'fuel.imbalance', delayS: 10, inhibit: TL },
  ...both((i, s) => ({ id: `fadec_${s.toLowerCase()}`, text: `FADEC FAULT ${s}`, level: 'caution', when: `fail.fadec.eng${i}`, inhibit: TL })),
  ...both((i, s) => ({ id: `start_fail_${s.toLowerCase()}`, text: `START ABORT ${s}`, level: 'caution', when: `fadec.eng${i}.abort`, latch: true })),
  // Open-centre system: the EDPs flow continuously (525AFM-06 p.3-102); HYD FLOW LOW whenever the pump flow is low
  // (engine stopped / below ~40 % N2 (EST), pump failed or the ENG FIRE hydraulic shutoff closed), no demand needed.
  ...both((i, s) => engMsg(i, { id: `hyd_flow_low_${s.toLowerCase()}`, text: `HYD FLOW LOW ${s}`, level: 'caution', when: `fail.hyd.edp${i} || eng${i}.n2_pct < 40 || ${M2.engFireBtn(i)}`, delayS: 3, inhibit: TL })),
  // HYD PRESS ON remaining lit after a cycle "a system problem exists" (525AFM-06 p.3-102): EST 30 s.
  { id: 'hyd_press_on_c', text: 'HYD PRESS ON', level: 'caution', when: M2.hydPressOn, delayS: 30, inhibit: TL },
  { id: 'hyd_press_low', text: 'HYD PRESS LOW', level: 'caution', when: `${M2.hydDemand} && hyd.main_psi < 1000`, delayS: 5, inhibit: TL },
  { id: 'brake_press_low', text: 'BRAKE PRESS LOW', level: 'caution', when: 'hyd.brk_psi < 900 && brakes.accum_psi < 900', delayS: 5, inhibit: TL }, // EST
  // 525AFM-06 p.3-90: ANTISKID INOP lit until the self-test completes (switch ON while stationary); also with the
  // switch OFF, a failed test / system fault or no power. Not while a starter drags the R MAIN bus down.
  {
    id: 'antiskid_inop',
    text: 'ANTISKID INOP',
    level: 'caution',
    when: `(!${M2.antiskidSw} || ac.m2.antiskid_test || ac.m2.antiskid_fail || brakes.antiskid_inop || !elec.antiskid_powered) && !${starting}`,
    inhibit: TL,
  },
  { id: 'emer_brake', text: 'EMER BRAKE ON', level: 'caution', when: `${M2.emerBrake} > 0.05 && ${air}`, inhibit: TL },
  { id: 'park_brake', text: 'PARK BRAKE ON', level: 'caution', when: `${M2.parkBrake} && (${M2.tla(1)} > 0.5 || ${M2.tla(2)} > 0.5)` },
  { id: 'flaps_fail', text: 'FLAPS FAIL', level: 'caution', when: 'flaps.disagree || flaps.asym', inhibit: TL },
  // 525AFM-06 p.3-104.1: FLAPS >35 with flaps beyond 38 deg and a throttle above ~85 % N2 on the ground (or in the air).
  { id: 'flaps_35', text: 'FLAPS >35', level: 'caution', when: `surf.flaps_deg > 38 && (${air} || eng1.n2_pct > 85 || eng2.n2_pct > 85)` },
  { id: 'gnd_flaps', text: 'GROUND FLAPS', level: 'caution', when: `${air} && ${M2.flapHandle} >= 2.9`, inhibit: TL },
  { id: 'spd_brk', text: 'SPEED BRAKE', level: 'caution', when: `surf.speedbrake > 0.1 && (surf.flaps_deg > 17 || ra1.valid && ra1.alt_ft < 500) && ${air}`, delayS: 2, inhibit: TL }, // EST
  ...both((i, s) => ({ id: `ps_cold_${s.toLowerCase()}`, text: `P/S HTR OFF ${s}`, level: 'caution', when: `${air} && !elec.pitot_${i === 1 ? 'l' : 'r'}_powered`, delayS: 2, inhibit: TL })),
  { id: 'aoa_htr', text: 'AOA HTR FAIL', level: 'caution', when: `${air} && !elec.aoa_heat_powered`, delayS: 2, inhibit: TL },
  // Anti-ice COLD: posted from selection until the surface is warm and whenever the heat is lost (valve closed at N2
  // < 75 % for the wing, 525AFM-06 p.3-99); ground check: displayed and clear within 60 s (M2 flows).
  ...lr('eng_ai_cold', 'ENGINE ANTI-ICE COLD', `${M2.engAiSw(1)} >= 1 && ac.m2.eai1_warm < 0.8`, `${M2.engAiSw(2)} >= 1 && ac.m2.eai2_warm < 0.8`, { level: 'caution', inhibit: TL }),
  ...lr('wing_ai_cold', 'WING ANTI-ICE COLD', `${M2.engAiSw(1)} >= 2 && ac.m2.wai1_warm < 0.8`, `${M2.engAiSw(2)} >= 2 && ac.m2.wai2_warm < 0.8`, { level: 'caution', inhibit: TL }),
  { id: 'tail_deice_fail', text: 'TAIL DE-ICE FAIL', level: 'caution', when: `${M2.tailDeiceSw} != 0 && !(pneu.bleed_psi > 20 && elec.tail_deice_powered)`, delayS: 10, inhibit: TL },
  // 525AFM-06 p.3-100: do not operate the boots below -35 C RAT (EST caution).
  { id: 'tail_deice_temp', text: 'TAIL DE-ICE LOW TEMP', level: 'caution', when: `${M2.tailDeiceSw} != 0 && adc1.valid && adc1.tat_c < -35`, delayS: 5, inhibit: TL },
  { id: 'ws_air_fail', text: 'W/S AIR FAIL', level: 'caution', when: `(${M2.wsBleedSw(1)} > 0 && ac.m2.ws_valve1 && pneu.ws_l_ok < 0.5) || (${M2.wsBleedSw(2)} > 0 && ac.m2.ws_valve2 && pneu.ws_r_ok < 0.5)`, delayS: 10, inhibit: TL },
  // 525AFM-06 p.3-101: overheat closes the shutoff valve and lights W/S AIR O'HEAT (also a valve open with the switch OFF).
  { id: 'ws_oheat', text: "W/S AIR O'HEAT", level: 'caution', when: 'ac.m2.ws_oheat', inhibit: TL },
  { id: 'emer_press', text: 'EMER PRESS ON', level: 'caution', when: `${M2.pressSource} == 4 || ac.m2.emer_press_auto`, inhibit: TL },
  { id: 'press_src_off', text: 'PRESS SOURCE OFF', level: 'caution', when: `${air} && ${M2.pressSource} == 0`, inhibit: TL },
  // EST: no cabin inflow in flight with the source not OFF (e.g. both bleeds lost).
  { id: 'press_src_fail', text: 'PRESS SOURCE FAIL', level: 'caution', when: `${air} && ${M2.pressSource} != 0 && pneu.pack_flow_kgs < 0.01`, delayS: 10, inhibit: TL },
  { id: 'cabin_ctrl', text: 'PRESS CTRL FAIL', level: 'caution', when: `(press.auto_fail || !elec.press_ctl_powered) && !${starting}`, delayS: 2, inhibit: TL },
  { id: 'oxy_low', text: 'OXYGEN LOW', level: 'caution', when: 'oxy.main_low', inhibit: TL },
  { id: 'door_gnd', text: 'DOOR UNLOCKED', level: 'caution', when: `${gnd} && (${M2.doorOpen('cabin')} || ${M2.doorOpen('emer_exit')})` },
  { id: 'bag_door', text: 'BAGGAGE DOOR', level: 'caution', when: `${M2.doorOpen('nose_bag_l')} || ${M2.doorOpen('nose_bag_r')} || ${M2.doorOpen('tail_bag')}` },
  { id: 'ap_fail', text: 'AFCS FAIL', level: 'caution', when: 'fail.afcs || fail.afcs.servo_pitch || fail.afcs.servo_roll', inhibit: TL },
  { id: 'yd_fail', text: 'YD FAIL', level: 'caution', when: 'fail.yd', inhibit: TL },
  { id: 'pitch_trim', text: 'PITCH TRIM', level: 'caution', when: 'ap.mistrim', inhibit: TL },
  // TAWS runs in the GDUs: a TAWS failure is only annunciated with a display powered (EST).
  { id: 'taws_fail', text: 'TAWS FAIL', level: 'caution', when: 'taws.inop && (elec.pfd1_powered || elec.mfd_powered || elec.pfd2_powered)', delayS: 5, inhibit: TL },
  { id: 'ctrl_lock', text: 'CONTROL LOCK', level: 'caution', when: `${M2.controlLock} && (eng1.running || eng2.running)` },
  // ------------------------------------------------------------ ADVISORIES (white / cyan)
  ...both((i, s) => ({ id: `start_${s.toLowerCase()}`, text: `START ${s}`, level: 'advisory', when: `fadec.eng${i}.start_state > 0 && fadec.eng${i}.start_state < 4` })),
  // Ignition: green IGN legend on the ITT scale (525AFM-06 p.3-117; systems/eis.ts), not a CAS message.
  ...both((_i, s, side) => ({ id: `boost_${s.toLowerCase()}`, text: `FUEL BOOST ON ${s}`, level: 'advisory', when: `fuel.boost_${side}_on`, inhibit: TL })),
  { id: 'fuel_xfer', text: 'FUEL TRANSFER', level: 'advisory', when: `${M2.fuelXfer} != 0`, inhibit: TL },
  { id: 'gpu', text: 'GPU ON', level: 'advisory', when: 'elec.gpu_online', inhibit: TL },
  { id: 'avn_dispatch', text: 'AVIONICS DISPATCH', level: 'advisory', when: `${M2.dispatchSw} == 1` }, // EST wording
  // 525AFM-06 p.3-102: white HYD PRESS ON while the bypass valve is closed (normal during a gear / flap / speed brake cycle).
  { id: 'hyd_press_on', text: 'HYD PRESS ON', level: 'advisory', when: 'hyd.main_psi > 1000 && !cas.hyd_press_on_c', inhibit: TL },
  { id: 'pax_oxy', text: 'PASS OXY ON', level: 'advisory', when: 'oxy.pax_on' },
  { id: 'ws_alcohol', text: 'W/S ALCOHOL ON', level: 'advisory', when: `${M2.wsAlcoholSw} && elec.ws_alcohol_powered && ${M2.wsAlcoholRemaining} > 0`, inhibit: TL },
  // 525AFM-06 p.3-104.1: "illuminate[s] when the speed brakes are fully extended".
  { id: 'spd_brk_ext', text: 'SPD BRK EXTEND', level: 'advisory', when: 'surf.speedbrake > 0.98', inhibit: TL },
  // M2 flows: cyan WING/ENG ANTI-ICE ON, TAIL DE-ICE ON (EST: ENG ANTI-ICE ON for engine-only selection).
  { id: 'wing_eng_ai_on', text: 'WING/ENG ANTI-ICE ON', level: 'advisory', when: `${M2.engAiSw(1)} >= 2 || ${M2.engAiSw(2)} >= 2`, inhibit: TL },
  { id: 'eng_ai_on', text: 'ENG ANTI-ICE ON', level: 'advisory', when: `(${M2.engAiSw(1)} == 1 || ${M2.engAiSw(2)} == 1) && ${M2.engAiSw(1)} < 2 && ${M2.engAiSw(2)} < 2`, inhibit: TL },
  { id: 'tail_deice_on', text: 'TAIL DE-ICE ON', level: 'advisory', when: `${M2.tailDeiceSw} != 0`, inhibit: TL },
  // 525AFM-06 p.3-100: white TAIL DEICE L / R when that boot reaches inflation pressure.
  ...both((i, s) => ({ id: `tail_boot_${s.toLowerCase()}`, text: `TAIL DE-ICE ${s}`, level: 'advisory', when: `ac.m2.boot${i}_press`, inhibit: TL })),
  { id: 'park_set', text: 'PARKING BRAKE', level: 'advisory', when: 'brakes.parking_set' },
];
