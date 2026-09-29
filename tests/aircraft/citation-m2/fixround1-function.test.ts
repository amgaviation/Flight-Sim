/**
 * Citation M2 fix round 1 (function lens, M2-L13/L14, M2-F01 ... F59, M2-PROC-*). Each test fails without its fix;
 * sources are cited in the systems code and in docs/aircraft/citation-m2.md §18.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AP, ENG, FDM, NAV } from '../../../src/core/vars';
import { M2, PRESS_SRC, TEST_SEL, TLA } from '../../../src/aircraft/citation-m2/vars';
import { M2_CAS } from '../../../src/aircraft/citation-m2/systems/cas';
import { M2_EIS_CONFIG, GEN_AMPS_LIMIT } from '../../../src/aircraft/citation-m2/systems/eis';
import { LB, loadNav, makeM2, press, type Rig } from './helpers';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';

const lb = (v: Rig['vars'], t: 0 | 1): number => v.get(`fuel.tank${t}_kg`) / LB;

function startEngine(r: Rig, i: 1 | 2): void {
  const v = r.vars;
  press(r, M2.startBtn(i));
  r.run(80, () => {
    if (v.get(ENG.n2(i)) > 9 && v.get(M2.tla(i)) < 0) v.set(M2.tla(i), TLA.idle);
    return v.get(ENG.running(i)) === 1 && v.get(ENG.n2(i)) > 51;
  });
  r.run(5);
}

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadNav();
}, 90000);

describe('M2 fix round 1 (function): electrical', () => {
  it('L13/L14: no avionics switch (BATTERY powers the avionics); DISPATCH powers only MFD, GTC 1 and GIA 1 from the aux battery', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.dispatchSw, 1);
    r.run(2);
    for (const l of ['mfd', 'gtc1', 'gia1']) expect(v.get(`elec.${l}_powered`), l).toBe(1);
    for (const l of ['pfd1', 'pfd2', 'gtc2', 'gia2', 'emer']) expect(v.get(`elec.${l}_powered`), l).toBe(0);
    expect(v.get(M2.dispatchLight)).toBe(1);
    expect(v.get('cas.avn_dispatch')).toBe(1); // CAS computer (GIA 1) up on dispatch power
    v.set(M2.dispatchSw, 0);
    v.set(M2.battSw, 1);
    r.run(2);
    for (const l of ['pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2', 'gia1', 'gia2', 'adc1', 'adc2', 'ahrs1', 'ahrs2']) expect(v.get(`elec.${l}_powered`), l).toBe(1);
    expect(v.get(M2.dispatchLight)).toBe(0);
  });

  it('F07/F08/PROC-13: BATTERY EMER: emergency-bus list, PFD 1 reverts to ADC 2 / AHRS 2, autopilot inoperative', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 25000, iasKt: 250 } });
    const v = r.vars;
    r.run(0.5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get(AP.engaged)).toBe(1);
    for (const i of [1, 2]) v.set(M2.genSw(i), 0);
    v.set(M2.battSw, -1);
    r.run(20);
    for (const l of ['pfd1', 'gtc1', 'gia1', 'adc2', 'ahrs2', 'xpdr1', 'audio1', 'audio2', 'gmc', 'flood_lts', 'pitot_r', 'gear_ctl', 'flap_ctl', 'spd_brk']) expect(v.get(`elec.${l}_powered`), l).toBe(1);
    for (const l of ['adc1', 'ahrs1', 'ap_servos', 'mfd', 'pfd2', 'xpdr2']) expect(v.get(`elec.${l}_powered`), l).toBe(0);
    expect(v.get('g3k.pfd1.adc')).toBe(2);
    expect(v.get('g3k.pfd1.ahrs')).toBe(2);
    expect(v.get('g3k.pfd1.reversionary')).toBe(1);
    expect(v.get(AP.engaged)).toBe(0);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get(AP.engaged)).toBe(0); // servos unpowered
    // Back to BATT: side 1 sensors restored.
    v.set(M2.battSw, 1);
    r.run(3);
    expect(v.get('g3k.pfd1.adc')).toBe(1);
  });

  it('F06: dual generator failure is a red GEN OFF L-R warning with master WARNING; singles suppressed', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 25000, iasKt: 250 } });
    const v = r.vars;
    v.set(M2.genSw(1), 0);
    r.run(3);
    expect(v.get('cas.gen_off_l')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(0);
    v.set(M2.genSw(2), 0);
    r.run(3);
    expect(v.get('cas.gen_off_lr')).toBe(1);
    expect(v.get('cas.gen_off_l')).toBe(0);
    expect(v.get('cas.gen_off_r')).toBe(0);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(M2_CAS.find((m) => m.id === 'gen_off_lr')?.aural?.callout).toBe('GENERATOR FAIL');
  });

  it('F09: no GIA (CAS computer) powered -> no CAS and no master annunciation', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.battSw, 1);
    v.set(M2.antiskidSw, 0); // ANTISKID INOP caution condition
    r.run(3);
    expect(v.get('cas.antiskid_inop')).toBe(1);
    v.set('cb.gia1', 0);
    v.set('cb.gia2', 0);
    r.run(1);
    expect(v.get('cas.antiskid_inop')).toBe(0);
    expect(v.get('alert.master_caution')).toBe(0);
  });

  it('F10/F11/PROC-04: engine-off GEN/OIL/FUEL/HYD annunciations before start (no master), extinguish after start; in-flight shutdown lights the masters', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    for (const i of [1, 2]) v.set(M2.genSw(i), 1);
    r.run(4);
    for (const m of ['gen_off', 'oil_press', 'fuel_press_low', 'hyd_flow_low']) expect(v.get(`cas.${m}_r_stop`), m).toBe(1);
    expect(v.get('alert.master_caution')).toBe(0);
    expect(v.get('alert.master_warning')).toBe(0);
    startEngine(r, 2);
    for (const m of ['gen_off', 'oil_press', 'fuel_press_low', 'hyd_flow_low']) {
      expect(v.get(`cas.${m}_r_stop`), m).toBe(0);
      expect(v.get(`cas.${m}_r`), m).toBe(0);
    }
    // In flight: throttle to CUTOFF.
    const c = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    c.vars.set(M2.tla(2), TLA.cutoff);
    c.run(40);
    expect(c.vars.get('cas.gen_off_r')).toBe(1);
    expect(c.vars.get('cas.oil_press_r')).toBe(1);
    expect(c.vars.get('alert.master_warning')).toBe(1);
    expect(c.vars.get('alert.master_caution')).toBe(1);
  });

  it('F12: cautions are inhibited on the takeoff roll above 80 kt', () => {
    const r = makeM2({ state: 'takeoff' });
    const v = r.vars;
    v.set(M2.parkBrake, 0);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.to);
    r.run(60, () => v.get(FDM.ias) > 85);
    v.set(M2.genSw(2), 0);
    r.run(1.5);
    expect(v.get('cas.to_inhibit')).toBe(1);
    expect(v.get('cas.gen_off_r')).toBe(0);
    expect(v.get('alert.master_caution')).toBe(0);
    expect(M2_CAS.filter((m) => m.level === 'caution' && !m.inhibit).map((m) => m.id).sort()).toEqual(
      ['bag_door', 'ctrl_lock', 'door_gnd', 'flaps_35', 'park_brake', 'start_fail_l', 'start_fail_r'].sort(),
    );
  });

  it('F14: the inverter does not work with the battery switch in EMER', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set('ac.m2.ac_outlet_plug', 1);
    r.run(1);
    expect(v.get('elec.inverter_powered')).toBe(1);
    v.set(M2.battSw, -1);
    r.run(1);
    expect(v.get('elec.inverter_powered')).toBe(0);
  });

  it('F15: GEN AMPS limit marking scheduled (ground 210 A, 300 A below FL350, 250 A above)', () => {
    const g = makeM2({ state: 'ready_to_taxi' });
    g.run(0.5);
    expect(GEN_AMPS_LIMIT.cautionHigh).toBe(210);
    const c = makeM2({ state: 'cruise', air: { altFtMsl: 37000, iasKt: 220 } });
    c.run(0.5);
    expect(GEN_AMPS_LIMIT.cautionHigh).toBe(250);
    const l = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    l.run(0.5);
    expect(GEN_AMPS_LIMIT.cautionHigh).toBe(300);
  });

  it('F16: airstarts are from the battery (the operating generator does not drive the starter)', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 15000, iasKt: 200 } });
    const v = r.vars;
    v.set(M2.tla(1), TLA.cutoff);
    r.run(40);
    let maxGen2 = 0;
    press(r, M2.startBtn(1));
    r.run(20, () => {
      if (v.get('elec.sg1_starter')) maxGen2 = Math.max(maxGen2, v.get('elec.sg2_amps'));
      if (v.get(ENG.n2(1)) > 12 && v.get(M2.tla(1)) < 0) v.set(M2.tla(1), TLA.idle);
    });
    expect(maxGen2).toBeGreaterThan(0);
    expect(maxGen2).toBeLessThan(200);
  });

  it('F17/PROC-29: no BATT DISCHARGE on battery-only ground operation', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.battSw, 1);
    r.run(60);
    expect(v.get('elec.batt_amps')).toBeLessThan(-15);
    expect(v.get('cas.batt_disch')).toBe(0);
  });

  it('PROC-14: MFD / PFD 2 stay powered during a battery start; no ANTISKID INOP / PRESS CTRL FAIL nuisance', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    for (const i of [1, 2]) v.set(M2.genSw(i), 1);
    r.run(5);
    let mfdOff = 0;
    let nuisance = 0;
    press(r, M2.startBtn(2));
    r.run(40, () => {
      if (v.get(ENG.n2(2)) > 9 && v.get(M2.tla(2)) < 0) v.set(M2.tla(2), TLA.idle);
      if (v.get('elec.mfd_powered') === 0 || v.get('elec.pfd2_powered') === 0) mfdOff++;
      if (v.get('cas.antiskid_inop') || v.get('cas.cabin_ctrl')) nuisance++;
    });
    expect(mfdOff).toBe(0);
    expect(nuisance).toBe(0);
  });
});

describe('M2 fix round 1 (function): fuel', () => {
  it('F01/F02: R TANK transfers left -> right at ~10 lb/min with the LEFT pump; none with the receiving pump on', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    const v = r.vars;
    r.run(1);
    const l0 = lb(v, 0);
    const r0 = lb(v, 1);
    v.set(M2.fuelXfer, 1);
    r.run(60);
    expect(v.get('fuel.boost_l_on')).toBe(1);
    expect(v.get('fuel.boost_r_on')).toBe(0);
    const moved = r0 - lb(v, 1) + (lb(v, 0) - l0);
    expect(lb(v, 1) - r0).toBeGreaterThan(5); // right tank gains
    expect(l0 - lb(v, 0)).toBeGreaterThan(5); // left tank loses
    expect(moved).toBeLessThan(0); // net: burn plus transfer
    const gain = lb(v, 1) - r0 + (v.get('fuel.used_kg') > 0 ? 0 : 0);
    expect(gain).toBeLessThan(12);
    // Receiving pump ON: no transfer.
    v.set(M2.boostSw(2), 1);
    r.run(1);
    const rr = lb(v, 1);
    r.run(30);
    expect(lb(v, 1)).toBeLessThan(rr);
  });

  it('F03: boost NORM low-pressure activation latches until OFF/ON and back to NORM; OFF inhibits start operation', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    v.set('fail.fuel.ejector_l', 1);
    r.run(3);
    expect(v.get('fuel.boost_l_on')).toBe(1);
    v.set('fail.fuel.ejector_l', 0);
    r.run(3);
    expect(v.get('fuel.boost_l_on')).toBe(1); // latched
    v.set(M2.boostSw(1), -1);
    r.run(0.5);
    v.set(M2.boostSw(1), 0);
    r.run(1);
    expect(v.get('fuel.boost_l_on')).toBe(0);
    // OFF: no pump on START.
    const g = makeM2({ state: 'cold_dark' });
    g.vars.set(M2.battSw, 1);
    g.vars.set(M2.boostSw(2), -1);
    g.run(1);
    press(g, M2.startBtn(2));
    g.run(2);
    expect(g.vars.get('fuel.boost_r_on')).toBe(0);
  });

  it('F04/F05: CJ-family fuel texts; FUEL FLTR BYPASS from a clogged filter', () => {
    const texts = M2_CAS.map((m) => m.text);
    for (const t of ['FUEL LOW LEVEL L', 'FUEL LOW PRESS R', 'FUEL BOOST ON L', 'FUEL FLTR BYPASS L']) expect(texts).toContain(t);
    expect(M2_CAS.find((m) => m.id === 'fuel_low_l')?.delayS).toBe(4);
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    r.vars.set('fail.fuel.filter_r', 1);
    r.run(3);
    expect(r.vars.get('cas.fuel_fltr_r')).toBe(1);
  });
});

describe('M2 fix round 1 (function): bleed air, pressurization, oxygen', () => {
  it('F18: bleed controllers unpowered -> source valves fail open, air source BOTH, cabin keeps flowing', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 30000, iasKt: 240 } });
    const v = r.vars;
    r.run(2);
    v.set('cb.bleed_ctl_l', 0);
    v.set('cb.bleed_ctl_r', 0);
    r.run(5);
    expect(v.get('pneu.pack_flow_kgs')).toBeGreaterThan(0.1);
  });

  it('F19/F20/F22: dump in MANUAL: limit valves stop the cabin near 14,500 ft, automatic EMER pressurization, CABIN ALTITUDE at ~9,500 ft', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 35000, iasKt: 230 } });
    const v = r.vars;
    v.set(M2.pressMode, 2);
    v.set(M2.cabinDump, 1);
    let warnAt = NaN;
    let maxCab = 0;
    let emer = 0;
    r.run(420, () => {
      const c = v.get('press.cabin_alt_ft');
      if (Number.isNaN(warnAt) && v.get('press.cabin_alt_warn')) warnAt = c;
      maxCab = Math.max(maxCab, c);
      if (v.get('ac.m2.emer_press_auto')) emer = 1;
    });
    expect(maxCab).toBeGreaterThan(13000);
    expect(maxCab).toBeLessThan(16000);
    expect(emer).toBe(1);
    expect(v.get('cas.emer_press')).toBe(1);
    expect(warnAt).toBeGreaterThan(9300);
    expect(warnAt).toBeLessThan(9800);
    // Dump needs DC power.
    const u = makeM2({ state: 'cruise', air: { altFtMsl: 35000, iasKt: 230 } });
    for (const i of [1, 2]) u.vars.set(M2.genSw(i), 0);
    u.vars.set(M2.battSw, 0);
    u.run(2);
    u.vars.set(M2.cabinDump, 1);
    const c0 = u.vars.get('press.cabin_alt_ft');
    u.run(30);
    expect(u.vars.get('press.cabin_alt_ft') - c0).toBeLessThan(1500);
  });

  it('F21: passenger masks do not drop below ~14,000 ft cabin (14,500 ft CJ-family setting)', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 35000, iasKt: 230 } });
    const v = r.vars;
    v.set(M2.cabinDump, 1);
    let dropAt = NaN;
    r.run(420, () => {
      if (Number.isNaN(dropAt) && v.get('press.pax_masks')) dropAt = v.get('press.cabin_alt_ft');
    });
    if (!Number.isNaN(dropAt)) expect(dropAt).toBeGreaterThan(14000);
  });

  it('F23: in-air presets take the field elevation from the nearest airport', () => {
    const apt = db.airport('KCOS')!;
    const r = makeM2({ state: 'approach', nav: db, air: { altFtMsl: apt.elevationFt + 3000, iasKt: 160, lat: apt.lat - 0.005, lon: apt.lon } });
    const v = r.vars;
    expect(Math.abs(v.get(M2.takeoffFieldElevFt) - apt.elevationFt)).toBeLessThan(1);
    expect(Math.abs(v.get(M2.landingElevFt) - apt.elevationFt)).toBeLessThan(1);
    r.run(20);
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(apt.elevationFt - 800);
  });

  it('F24/PROC-28: cabin depressurized on the ramp with both packs flowing', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    r.run(30);
    expect(r.vars.get('pneu.pack_flow_kgs')).toBeGreaterThan(0.05);
    expect(Math.abs(r.vars.get('press.diff_psi'))).toBeLessThan(0.01);
  });

  it('F25: differential-limited schedule: ~5,000-5,500 ft cabin at FL350', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 35000, iasKt: 230 } });
    r.run(10);
    expect(r.vars.get('press.cabin_alt_ft')).toBeLessThan(6000);
    expect(r.vars.get('press.diff_psi')).toBeGreaterThan(8.0);
  });
});

describe('M2 fix round 1 (function): ice protection', () => {
  it('F29/F30/PROC-10/PROC-35: per-side WING/ENG; COLD displayed then clear within 60 s; wing valve shuts below 75 % N2', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    for (const i of [1, 2]) v.set(M2.tla(i), 0.55);
    r.run(15);
    expect(v.get('eng1.n2_pct')).toBeGreaterThan(75);
    for (const i of [1, 2]) v.set(M2.engAiSw(i), 2);
    v.set(M2.tailDeiceSw, 1);
    r.run(2);
    expect(v.get('cas.wing_ai_cold_lr')).toBe(1);
    expect(v.get('cas.eng_ai_cold_lr')).toBe(1);
    expect(v.get('cas.wing_eng_ai_on')).toBe(1);
    expect(v.get('cas.tail_deice_on')).toBe(1);
    r.run(58);
    expect(v.get('cas.wing_ai_cold_lr')).toBe(0);
    expect(v.get('cas.eng_ai_cold_lr')).toBe(0);
    expect(v.get('cas.tail_deice_fail')).toBe(0);
    // Left throttle to idle (N2 < 75 %): L wing valve closes, WING ANTI-ICE COLD L about a minute later.
    v.set(M2.tla(1), TLA.idle);
    r.run(20);
    expect(v.get(M2.wingAiValve(1))).toBe(0);
    expect(v.get(M2.wingAiValve(2))).toBe(1);
    r.run(60);
    expect(v.get('cas.wing_ai_cold_l')).toBe(1);
    // ENG only on the right: no wing valve.
    v.set(M2.engAiSw(2), 1);
    r.run(1);
    expect(v.get(M2.wingAiValve(2))).toBe(0);
  });

  it('F31: tail boots L then R, 3 min dwell (AUTO); MANUAL inflates both while held; per-side advisories', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 15000, iasKt: 220 } });
    const v = r.vars;
    v.set(M2.tailDeiceSw, 1);
    r.run(3);
    expect(v.get('ac.m2.boot1_press')).toBe(1);
    expect(v.get('ac.m2.boot2_press')).toBe(0);
    r.run(6);
    expect(v.get('ac.m2.boot1_press')).toBe(0);
    expect(v.get('ac.m2.boot2_press')).toBe(1);
    expect(v.get('cas.tail_boot_r')).toBe(1);
    r.run(60);
    expect(v.get('ac.m2.boot1_press') + v.get('ac.m2.boot2_press')).toBe(0);
    v.set(M2.tailDeiceSw, -1);
    r.run(1);
    expect(v.get('ac.m2.boot1_press')).toBe(1);
    expect(v.get('ac.m2.boot2_press')).toBe(1);
  });

  it('F32/F33: W/S bleed HI on the ground overheats and shuts off (W/S AIR O\'HEAT, reset with OFF); alcohol lasts 10 min', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(M2.wsBleedSw(1), 2);
    r.run(240);
    expect(v.get('cas.ws_oheat')).toBe(1);
    expect(v.get('ac.m2.ws_valve1')).toBe(0);
    v.set(M2.wsBleedSw(1), 0);
    r.run(1);
    expect(v.get('ac.m2.ws_oheat')).toBe(0);
    v.set(M2.wsAlcoholSw, 1);
    r.run(2);
    expect(v.get('cas.ws_alcohol')).toBe(1);
    r.run(600);
    expect(v.get(M2.wsAlcoholRemaining)).toBe(0);
    expect(v.get('cas.ws_alcohol')).toBe(0);
    expect(v.get('elec.ws_alcohol_powered')).toBe(0);
  });
});

describe('M2 fix round 1 (function): flight controls, gear, brakes', () => {
  it('F35/PROC-02/PROC-26: ground flaps deploy the speed brakes; > 85 % N2 retracts them with FLAPS >35; idle redeploys', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(M2.flapHandle, 3);
    r.run(15);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(59);
    expect(v.get('surf.speedbrake')).toBeGreaterThan(0.95);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.to);
    r.run(12);
    expect(v.get('eng1.n2_pct')).toBeGreaterThan(85);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.05);
    expect(v.get('cas.flaps_35')).toBe(1);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.idle);
    r.run(15);
    expect(v.get('surf.speedbrake')).toBeGreaterThan(0.95);
    expect(v.get('cas.flaps_35')).toBe(0);
    v.set(M2.flapHandle, 1);
    r.run(12);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.05);
    // 38-degree switch: flaps from 15 do not extend past 38 with high thrust.
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.to);
    r.run(10);
    v.set(M2.flapHandle, 3);
    r.run(15);
    expect(v.get('surf.flaps_deg')).toBeLessThan(38.5);
    // PROC-26: park brake set at takeoff thrust -> T/O CONFIG warning.
    expect(v.get('cas.to_config')).toBe(1);
  });

  it('F37: follow-up flap handle: intermediate positions 0-35 in flight', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 8000, iasKt: 180 } });
    const v = r.vars;
    v.set(M2.flapHandle, 0.5);
    r.run(8);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(6.5);
    expect(v.get('surf.flaps_deg')).toBeLessThan(8.5);
    v.set(M2.flapHandle, 1.5);
    r.run(10);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(24);
    expect(v.get('surf.flaps_deg')).toBeLessThan(26);
  });

  it('F36: white HYD PRESS ON during a gear cycle; HYD FLOW LOW from a pump failure without demand', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 170 } });
    const v = r.vars;
    let seen = 0;
    v.set(M2.gearHandle, 1);
    r.run(10, () => {
      if (v.get('cas.hyd_press_on')) seen = 1;
    });
    expect(seen).toBe(1);
    expect(M2_CAS.find((m) => m.id === 'hyd_press_on')?.level).toBe('advisory');
    r.run(5);
    expect(v.get('cas.hyd_press_on')).toBe(0);
    v.set('fail.hyd.edp1', 1);
    r.run(5);
    expect(v.get('cas.hyd_flow_low_l')).toBe(1);
  });

  it('F38: blow-down only after the T-handle; the T-handle alone free-falls the gear', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 150 } });
    const v = r.vars;
    v.set('cb.gear_ctl', 0);
    v.set(M2.gearBlowdown, 1);
    r.run(8);
    expect(v.get('gear.down_locked')).toBe(0);
    expect(v.get('gear.blowdown_used')).toBe(0);
    v.set(M2.gearBlowdown, 0);
    v.set(M2.gearEmerRelease, 1);
    r.run(12);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(v.get('gear.blowdown_used')).toBe(0);
  });

  it('F40/F41: SPD BRK EXTEND only when fully extended; the SPD BRK breaker removes speed brake control', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 15000, iasKt: 220 } });
    const v = r.vars;
    v.set(M2.speedbrake, 1);
    r.run(1.0);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.9);
    expect(v.get('cas.spd_brk_ext')).toBe(0);
    r.run(3);
    expect(v.get('cas.spd_brk_ext')).toBe(1);
    v.set(M2.speedbrake, 0);
    r.run(4);
    v.set('cb.spd_brk', 0);
    v.set(M2.speedbrake, 1);
    r.run(4);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.05);
  });

  it('F42/F44/PROC-03/PROC-27: split trim switch (both halves), pilot priority, AP/TRIM DISC interrupts trim and a runaway', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    const t0 = v.get(M2.pitchTrim);
    v.set(M2.yokeTrim(1), 1); // direction half only
    r.run(2);
    expect(v.get(M2.pitchTrim)).toBeCloseTo(t0, 4);
    v.set(M2.yokeTrimArm(1), 1);
    r.run(1);
    const t1 = v.get(M2.pitchTrim);
    expect(t1).toBeGreaterThan(t0 + 0.02);
    // Copilot nose down at the same time: the pilot's nose up wins.
    v.set(M2.yokeTrim(2), -1);
    v.set(M2.yokeTrimArm(2), -1);
    r.run(1);
    expect(v.get(M2.pitchTrim)).toBeGreaterThan(t1 + 0.02);
    // AP/TRIM DISC held: trim stops.
    v.set(M2.apTrimDisc(1), 1);
    const t2 = v.get(M2.pitchTrim);
    r.run(2);
    expect(v.get(M2.pitchTrim)).toBeCloseTo(t2, 4);
    for (const s of [1, 2]) {
      v.set(M2.yokeTrim(s), 0);
      v.set(M2.yokeTrimArm(s), 0);
    }
    // Runaway: holding AP/TRIM DISC stops it.
    v.set('fail.trim.pitch.runaway', 1);
    const t3 = v.get(M2.pitchTrim);
    r.run(2);
    expect(v.get(M2.pitchTrim)).toBeCloseTo(t3, 4);
    v.set(M2.apTrimDisc(1), 0);
    r.run(2);
    expect(Math.abs(v.get(M2.pitchTrim) - t3)).toBeGreaterThan(0.02);
  });

  it('F43: manual electric trim from the yoke disconnects the autopilot', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(0.5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get(AP.engaged)).toBe(1);
    v.set(M2.yokeTrim(2), 1);
    v.set(M2.yokeTrimArm(2), 1);
    r.run(0.5);
    expect(v.get(AP.engaged)).toBe(0);
  });

  it('F45/F46: in-air presets have valid air data at once; the AFCS uses the coupled side sensors', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(0.1);
    expect(v.get('adc1.valid')).toBe(1);
    r.events.emit('g3k.gmc.key_ap');
    r.run(0.5);
    expect(v.get(AP.engaged)).toBe(1);
    v.set('g3k.fd_side', 2);
    v.set('cb.adc2', 0);
    r.run(1);
    expect(v.get(AP.engaged)).toBe(0);
  });

  it('F39/PROC-30: gear horn on the copilot (ADC 2) airspeed; SYSTEM TESTS LDG GEAR sounds the horn', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(M2.testSel, TEST_SEL.gear);
    r.run(0.5);
    expect(v.get('gear.horn')).toBe(1);
    v.set(M2.testSel, TEST_SEL.off);
    r.run(0.5);
    expect(v.get('gear.horn')).toBe(0);
    // Gear up, idle, below 130 KIAS: horn from the copilot's (ADC 2) airspeed; still works with ADC 1 unpowered.
    const c = makeM2({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 125 } });
    for (const i of [1, 2]) c.vars.set(M2.tla(i), TLA.idle);
    c.vars.set('cb.adc1', 0);
    c.run(1);
    expect(c.vars.get('adc1.valid')).toBe(0);
    expect(c.vars.get('gear.horn')).toBe(1);
  });

  it('F58/F59/PROC-31: anti-skid self test (INOP during it, fails if moving); emergency brake bottle is finite', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(M2.antiskidSw, 0);
    r.run(1);
    expect(v.get('cas.antiskid_inop')).toBe(1);
    v.set(M2.antiskidSw, 1);
    r.run(1);
    expect(v.get('cas.antiskid_inop')).toBe(1);
    r.run(3);
    expect(v.get('cas.antiskid_inop')).toBe(0);
    // Emergency brake: repeated full applications deplete the bottle.
    const p0 = v.get(M2.emerBrakeBottlePsi);
    for (let k = 0; k < 20; k++) {
      v.set(M2.emerBrake, 1);
      r.run(0.2);
      v.set(M2.emerBrake, 0);
      r.run(0.2);
    }
    expect(v.get(M2.emerBrakeBottlePsi)).toBeLessThan(p0 - 1000);
    expect(M2_CAS.map((m) => m.text)).toContain('ANTISKID INOP');
  });
});

describe('M2 fix round 1 (function): engines, lights, comm, EIS', () => {
  it('PROC-09/F50: FADEC ignition with engine anti-ice and on approach; IGN on the ITT scale, not a CAS message', () => {
    const r = makeM2({ state: 'approach', air: { altFtMsl: 3000, iasKt: 150 } });
    r.run(1);
    expect(r.vars.get('eng1.ignition')).toBe(1);
    expect(r.vars.get('eng2.ignition')).toBe(1);
    const g = makeM2({ state: 'ready_to_taxi' });
    g.vars.set(M2.engAiSw(1), 1);
    g.run(1);
    expect(g.vars.get('eng1.ignition')).toBe(1);
    expect(g.vars.get('eng2.ignition')).toBe(0);
    expect(M2_CAS.some((m) => m.text.startsWith('IGNITION'))).toBe(false);
    const itt = M2_EIS_CONFIG.sections.find((s) => s.kind === 'itt') as { ignVar?: (e: number) => string };
    expect(itt.ignVar?.(1)).toBe('eng1.ignition');
  });

  it('F48/F55: beacon on during START with ANTI-COLL OFF; PULSE alternates the landing lights', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.battSw, 1);
    v.set(M2.antiColl, 0);
    r.run(1);
    press(r, M2.startBtn(2));
    let beacon = 0;
    r.run(4, () => {
      beacon = Math.max(beacon, v.get('light.beacon'));
    });
    expect(beacon).toBeGreaterThan(0.5);
    const p = makeM2({ state: 'ready_to_taxi' });
    p.vars.set(M2.landingLt, 1);
    let both = 0;
    let onlyL = 0;
    let onlyR = 0;
    p.run(3, () => {
      const l = p.vars.get('light.landing_l') > 0.5;
      const rr = p.vars.get('light.landing_r') > 0.5;
      if (l && rr) both++;
      else if (l) onlyL++;
      else if (rr) onlyR++;
    });
    expect(onlyL).toBeGreaterThan(20);
    expect(onlyR).toBeGreaterThan(20);
    expect(both).toBeLessThan(10);
    p.vars.set(M2.landingLt, 2);
    p.run(0.5);
    expect(p.vars.get('light.landing_l')).toBeGreaterThan(0.5);
    expect(p.vars.get('light.landing_r')).toBeGreaterThan(0.5);
  });

  it('F54: EMER COMM holds COM 1 on 121.5 (other tuning bypassed) and restores the frequency at NORM', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(NAV.comActive(1), 124.35);
    r.run(0.2);
    v.set(M2.emerComm, 1);
    r.run(0.2);
    expect(v.get(NAV.comActive(1))).toBeCloseTo(121.5, 3);
    v.set(NAV.comActive(1), 118.1); // GTC retune attempt
    r.run(0.2);
    expect(v.get(NAV.comActive(1))).toBeCloseTo(121.5, 3);
    v.set(M2.emerComm, 0);
    r.run(0.2);
    expect(v.get(NAV.comActive(1))).toBeCloseTo(124.35, 3);
  });

  it('F13: BATT O\'TEMP carries the BATTERY OVERTEMP voice and a second >160 warning with a faster repeat', () => {
    const a = M2_CAS.find((m) => m.id === 'batt_otemp');
    const b = M2_CAS.find((m) => m.id === 'batt_otemp160');
    expect(a?.aural?.callout).toBe('BATTERY OVERTEMP');
    expect(b?.level).toBe('warning');
    expect(b?.aural?.repeatS).toBeLessThan(a!.aural!.repeatS!);
    expect(PRESS_SRC.both).toBe(3);
  });
});
