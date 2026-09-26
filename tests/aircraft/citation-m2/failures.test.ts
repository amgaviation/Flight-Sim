/**
 * (g) Key failures produce the right CAS messages and system behaviour:
 * generator failure (load shed), hydraulic loss (gear by emergency
 * extension), engine fire (ENG FIRE push button, bottle discharge).
 */
import { describe, expect, it } from 'vitest';
import { ENG, GEAR } from '../../../src/core/vars';
import { M2 } from '../../../src/aircraft/citation-m2/vars';
import { makeM2, press } from './helpers';

describe('(g) failures and CAS', () => {
  it('left generator failure: GEN OFF L caution, right generator carries the load, cabin loads shed in flight', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 25000, iasKt: 240 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.air_cond_powered')).toBe(1);
    expect(v.get('cas.gen_off_l')).toBe(0);
    r.events.emit('fail.trigger', 'elec.sg1');
    r.run(3);
    expect(v.get('elec.sg1_online')).toBe(0);
    expect(v.get('cas.gen_off_l')).toBe(1);
    expect(v.get('alert.master_caution')).toBe(1);
    expect(v.get('elec.l_main_v')).toBeGreaterThan(27); // parallel bus fed by the right generator
    expect(v.get('elec.sg2_amps')).toBeGreaterThan(40);
    expect(v.get('elec.air_cond_powered')).toBe(0); // vapor-cycle A/C shed (S&D15 §9.4)
    expect(v.get('elec.avn1_powered')).toBe(1);
    expect(v.get('elec.avn2_powered')).toBe(1);
    // Master caution acknowledged by the MASTER CAUTION switch.
    r.events.emit('cas.ack_caution');
    r.run(0.5);
    expect(v.get('alert.master_caution')).toBe(0);
    // GEN RESET (spring-loaded) does not bring back a failed generator; after the failure clears it does.
    r.events.emit('fail.clear', 'elec.sg1');
    v.set(M2.genSw(1), -1);
    r.run(0.5);
    v.set(M2.genSw(1), 1);
    r.run(3);
    expect(v.get('elec.sg1_online')).toBe(1);
    expect(v.get('cas.gen_off_l')).toBe(0);
  });

  it('loss of both engine-driven hydraulic pumps: HYD FLOW LOW / HYD PRESS LOW, gear extended by emergency release and blow-down', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 1500, air: { altFtMsl: 8000, iasKt: 170 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('gear.up_locked')).toBe(1);
    r.events.emit('fail.trigger', 'hyd.edp1');
    r.events.emit('fail.trigger', 'hyd.edp2');
    r.run(1);
    v.set(M2.gearHandle, 1); // DN: the selector valve calls for pressure that never comes
    r.run(12);
    expect(v.get('hyd.main_psi')).toBeLessThan(300);
    expect(v.get('cas.hyd_flow_low_l')).toBe(1);
    expect(v.get('cas.hyd_flow_low_r')).toBe(1);
    expect(v.get('cas.hyd_press_low')).toBe(1);
    expect(v.get('gear.down_locked')).toBe(0);
    expect(v.get(GEAR.pos(1))).toBeLessThan(0.98);
    // Emergency gear: release T-handle + blow-down (S&D15 §7).
    v.set(M2.gearEmerRelease, 1);
    v.set(M2.gearBlowdown, 1);
    r.run(8);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(v.get('gear.blowdown_used')).toBe(1);
    // Brakes are on the independent electric hydraulic system (S&D15 §7): still pressurized.
    expect(v.get('hyd.brk_psi')).toBeGreaterThan(1200);
  });

  it('left engine fire: ENG FIRE L warning; ENG FIRE push button shuts off fuel, bleed, hydraulics and generator; bottle extinguishes', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(5);
    r.events.emit('fail.trigger', 'fire.eng1');
    r.run(2);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('cas.eng_fire_l')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(v.get(M2.engFireLight(1))).toBe(1);
    expect(v.get(M2.bottleLight(1))).toBe(0);
    // Throttle to CUTOFF and push ENG FIRE L (memory items, CJ family).
    v.set(M2.tla(1), -0.1);
    v.set(M2.engFireBtn(1), 1);
    r.run(3);
    expect(v.get('fuel.fw_l_open')).toBe(0);
    expect(v.get('pneu.b1_valve_open')).toBe(0);
    expect(v.get(M2.bottleLight(1))).toBe(1);
    expect(v.get(M2.bottleLight(2))).toBe(1);
    r.run(10);
    expect(v.get(ENG.fuelOn(1))).toBe(0);
    expect(v.get('elec.sg1_online')).toBe(0);
    press(r, M2.bottleBtn(1));
    r.run(5);
    expect(v.get('fire.b1_discharged')).toBe(1);
    if (v.get('fire.eng1_warn')) {
      press(r, M2.bottleBtn(2));
      r.run(5);
    }
    expect(v.get('fire.eng1_warn')).toBe(0);
    expect(v.get('cas.eng_fire_l')).toBe(0);
    // The right engine keeps running and powering the aircraft.
    expect(v.get(ENG.running(2))).toBe(1);
    expect(v.get('elec.sg2_online')).toBe(1);
  });

  it('cabin altitude warning after a decompression, passenger masks drop', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 35000, iasKt: 230 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(7000);
    r.events.emit('fail.trigger', 'press.decompression');
    r.run(30);
    expect(v.get('cas.cabin_alt')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(v.get('press.pax_masks')).toBe(1);
    expect(v.get('oxy.pax_on')).toBe(1);
  });
});
