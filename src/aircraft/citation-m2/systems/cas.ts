/**
 * Citation M2 Crew Alerting System messages (G3000 CAS on both PFDs,
 * S&D21 §10.3.9: master WARNING red / CAUTION amber, messages flash until
 * acknowledged with the MASTER WARNING / MASTER CAUTION switches; warnings
 * listed first).
 *
 * The message texts and trigger conditions follow the CJ-family / Garmin CAS
 * conventions for the systems described in the S&D; the exact AFM wording and
 * thresholds are not public, so thresholds are marked EST in the dossier
 * (docs/aircraft/citation-m2.md §8, which is the authoritative list).
 */
import type { CasMessageDef } from '../../../systems/warning';
import { M2_LIMITS } from '../data';
import { M2 } from '../vars';

const air = 'gear.air_ground == 0';
const gnd = 'gear.air_ground != 0';

function both(fn: (i: 1 | 2, s: 'L' | 'R', side: 'l' | 'r') => CasMessageDef): CasMessageDef[] {
  return [fn(1, 'L', 'l'), fn(2, 'R', 'r')];
}

const running = (i: number) => `eng${i}.n2_pct > 45`;

export const M2_CAS: CasMessageDef[] = [
  // ------------------------------------------------------------ WARNINGS (red)
  ...both((i, s) => ({ id: `eng_fire_${s.toLowerCase()}`, text: `ENG FIRE ${s}`, level: 'warning', when: `fire.eng${i}_warn`, aural: { callout: 'ENGINE FIRE', repeatS: 10, priority: 2 } })),
  ...both((i, s) => ({ id: `oil_press_low_${s.toLowerCase()}`, text: `OIL PRESS LOW ${s}`, level: 'warning', when: `${running(i)} && eng${i}.oil_press_psi < ${M2_LIMITS.oilPressMinPsi}`, delayS: 2, inhibit: ['GROUND'] })),
  { id: 'cabin_alt', text: 'CABIN ALTITUDE', level: 'warning', when: 'press.cabin_alt_warn', aural: { callout: 'CABIN ALTITUDE', repeatS: 5, priority: 2 } },
  { id: 'cabin_diff', text: 'CABIN DIFF PRESS', level: 'warning', when: 'press.excess_diff' },
  { id: 'batt_otemp', text: "BATT O'TEMP", level: 'warning', when: 'elec.batt_overtemp' },
  { id: 'door_open', text: 'DOOR UNLOCKED', level: 'warning', when: `${air} && (${M2.doorOpen('cabin')} || ${M2.doorOpen('emer_exit')})` },
  { id: 'aoa_fail', text: 'AOA FAIL', level: 'warning', when: 'fail.adc1.aoa || fail.stall.warn' },
  { id: 'gear_unsafe', text: 'GEAR UNSAFE', level: 'warning', when: 'gear.unsafe || gear.disagree', delayS: 1 },
  { id: 'ap_trim_fail', text: 'AP TRIM FAIL', level: 'warning', when: 'fail.trim.pitch.runaway || fail.trim.pitch.jam' },
  // ------------------------------------------------------------ CAUTIONS (amber)
  ...both((i, s) => ({ id: `gen_off_${s.toLowerCase()}`, text: `GEN OFF ${s}`, level: 'caution', when: `${running(i)} && !elec.sg${i}_online`, delayS: 1 })),
  { id: 'batt_disch', text: 'BATT DISCHARGE', level: 'caution', when: 'elec.batt_amps < -15 && !(elec.sg1_starter || elec.sg2_starter)', delayS: 10 }, // EST threshold
  { id: 'emer_bus', text: 'EMER BUS ON BATT', level: 'caution', when: `${M2.battSw} == -1` },
  { id: 'bus_volts_low', text: 'MAIN BUS VOLTS LOW', level: 'caution', when: 'elec.batt_bus_powered && elec.batt_bus_v < 24.5 && !(elec.sg1_starter || elec.sg2_starter)', delayS: 5 }, // EST
  ...both((i, s, side) => ({ id: `fuel_low_${s.toLowerCase()}`, text: `FUEL LEVEL LOW ${s}`, level: 'caution', when: `fuel.${side === 'l' ? 'left' : 'right'}_low`, delayS: 5 })),
  ...both((i, s) => ({ id: `fuel_press_low_${s.toLowerCase()}`, text: `FUEL PRESS LOW ${s}`, level: 'caution', when: `${running(i)} && fuel.eng${i}_lowpress`, delayS: 2 })),
  { id: 'fuel_imbal', text: 'FUEL IMBALANCE', level: 'caution', when: 'fuel.imbalance', delayS: 10 },
  ...both((i, s) => ({ id: `fadec_${s.toLowerCase()}`, text: `FADEC FAULT ${s}`, level: 'caution', when: `fail.fadec.eng${i}` })),
  ...both((i, s) => ({ id: `start_fail_${s.toLowerCase()}`, text: `START ABORT ${s}`, level: 'caution', when: `fadec.eng${i}.abort`, latch: true })),
  ...both((i, s) => ({ id: `hyd_flow_low_${s.toLowerCase()}`, text: `HYD FLOW LOW ${s}`, level: 'caution', when: `${running(i)} && ${M2.hydDemand} && (fail.hyd.edp${i} || hyd.edp${i}_flow_lpm < 0.3)`, delayS: 3 })),
  { id: 'hyd_press_on', text: 'HYD PRESS ON', level: 'caution', when: M2.hydPressOn, delayS: 25 }, // EST: open-center system pressurized too long
  { id: 'hyd_press_low', text: 'HYD PRESS LOW', level: 'caution', when: `${M2.hydDemand} && hyd.main_psi < 1000`, delayS: 5 },
  { id: 'brake_press_low', text: 'BRAKE PRESS LOW', level: 'caution', when: 'hyd.brk_psi < 900 && brakes.accum_psi < 900', delayS: 5 }, // EST
  { id: 'antiskid_fail', text: 'ANTISKID FAIL', level: 'caution', when: `${M2.antiskidSw} && (brakes.antiskid_inop || !elec.antiskid_powered)`, delayS: 1 },
  { id: 'antiskid_off', text: 'ANTISKID OFF', level: 'caution', when: `!${M2.antiskidSw}` },
  { id: 'emer_brake', text: 'EMER BRAKE ON', level: 'caution', when: `${M2.emerBrake} > 0.05 && ${air}` },
  { id: 'park_brake', text: 'PARK BRAKE ON', level: 'caution', when: `${M2.parkBrake} && (${M2.tla(1)} > 0.5 || ${M2.tla(2)} > 0.5)` },
  { id: 'flaps_fail', text: 'FLAPS FAIL', level: 'caution', when: 'flaps.disagree || flaps.asym' },
  { id: 'gnd_flaps', text: 'GROUND FLAPS', level: 'caution', when: `${air} && ${M2.flapHandle} == 3` },
  { id: 'spd_brk', text: 'SPEED BRAKE', level: 'caution', when: `surf.speedbrake > 0.1 && (surf.flaps_deg > 17 || ra1.valid && ra1.alt_ft < 500) && ${air}`, delayS: 2 }, // EST
  ...both((i, s) => ({ id: `ps_cold_${s.toLowerCase()}`, text: `P/S HTR OFF ${s}`, level: 'caution', when: `${air} && !elec.pitot_${i === 1 ? 'l' : 'r'}_powered`, delayS: 2 })),
  { id: 'aoa_htr', text: 'AOA HTR FAIL', level: 'caution', when: `${air} && !elec.aoa_heat_powered`, delayS: 2 },
  ...both((i, s) => ({ id: `eng_ai_cold_${s.toLowerCase()}`, text: `ENG A/I COLD ${s}`, level: 'caution', when: `${M2.engAiSw(i)} && pneu.eai${i}_ok < 0.8`, delayS: 30, inhibit: ['GROUND'] })),
  { id: 'wing_ai_cold', text: 'WING A/I COLD', level: 'caution', when: `${M2.wingAiSw} && pneu.wai_ok < 0.8`, delayS: 60, inhibit: ['GROUND'] },
  { id: 'tail_deice_fail', text: 'TAIL DEICE FAIL', level: 'caution', when: `${M2.tailDeiceSw} != 0 && !(pneu.bleed_psi > 20 && elec.tail_deice_powered)`, delayS: 10, inhibit: ['GROUND'] },
  { id: 'ws_air_fail', text: 'W/S AIR FAIL', level: 'caution', when: `(${M2.wsBleedSw(1)} > 0 && pneu.ws_l_ok < 0.5) || (${M2.wsBleedSw(2)} > 0 && pneu.ws_r_ok < 0.5)`, delayS: 10 },
  { id: 'emer_press', text: 'EMER PRESS ON', level: 'caution', when: `${M2.pressSource} == 4` },
  { id: 'press_src_off', text: 'PRESS SOURCE OFF', level: 'caution', when: `${air} && ${M2.pressSource} == 0` },
  { id: 'cabin_ctrl', text: 'PRESS CTRL FAIL', level: 'caution', when: 'press.auto_fail || !elec.press_ctl_powered', delayS: 2 },
  { id: 'oxy_low', text: 'OXYGEN LOW', level: 'caution', when: 'oxy.main_low' },
  { id: 'door_gnd', text: 'DOOR UNLOCKED', level: 'caution', when: `${gnd} && (${M2.doorOpen('cabin')} || ${M2.doorOpen('emer_exit')})` },
  { id: 'bag_door', text: 'BAGGAGE DOOR', level: 'caution', when: `${M2.doorOpen('nose_bag_l')} || ${M2.doorOpen('nose_bag_r')} || ${M2.doorOpen('tail_bag')}` },
  { id: 'ap_fail', text: 'AFCS FAIL', level: 'caution', when: 'fail.afcs || fail.afcs.servo_pitch || fail.afcs.servo_roll' },
  { id: 'yd_fail', text: 'YD FAIL', level: 'caution', when: 'fail.yd' },
  { id: 'pitch_trim', text: 'PITCH TRIM', level: 'caution', when: 'ap.mistrim' },
  { id: 'taws_fail', text: 'TAWS FAIL', level: 'caution', when: 'taws.inop' },
  { id: 'ctrl_lock', text: 'CONTROL LOCK', level: 'caution', when: `${M2.controlLock} && (eng1.running || eng2.running)` },
  // ------------------------------------------------------------ ADVISORIES (white)
  ...both((i, s) => ({ id: `start_${s.toLowerCase()}`, text: `START ${s}`, level: 'advisory', when: `fadec.eng${i}.start_state > 0 && fadec.eng${i}.start_state < 4` })),
  ...both((i, s) => ({ id: `ign_${s.toLowerCase()}`, text: `IGNITION ${s}`, level: 'advisory', when: `eng${i}.ignition` })),
  ...both((i, s) => ({ id: `boost_${s.toLowerCase()}`, text: `BOOST PUMP ON ${s}`, level: 'advisory', when: `fuel.boost_${i === 1 ? 'l' : 'r'}_on` })),
  { id: 'fuel_xfer', text: 'FUEL TRANSFER', level: 'advisory', when: `${M2.fuelXfer} != 0` },
  { id: 'gpu', text: 'GPU ON', level: 'advisory', when: 'elec.gpu_online' },
  { id: 'avn_dispatch', text: 'AVIONICS DISPATCH', level: 'advisory', when: `${M2.avionicsSw} == -1` },
  { id: 'pax_oxy', text: 'PASS OXY ON', level: 'advisory', when: 'oxy.pax_on' },
  { id: 'ws_alcohol', text: 'W/S ALCOHOL ON', level: 'advisory', when: M2.wsAlcoholSw },
  { id: 'spd_brk_ext', text: 'SPD BRK EXTEND', level: 'advisory', when: 'surf.speedbrake > 0.1' },
  { id: 'tail_deice', text: 'TAIL DEICE', level: 'advisory', when: 'ice.tail_boots' },
  { id: 'rain_door', text: 'RAIN DOOR OPEN', level: 'advisory', when: `${M2.rainDoor(1)} || ${M2.rainDoor(2)}` },
  { id: 'park_set', text: 'PARKING BRAKE', level: 'advisory', when: 'brakes.parking_set' },
];
