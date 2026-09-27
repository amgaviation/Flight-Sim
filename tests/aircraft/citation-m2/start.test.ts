/**
 * (a) Cold & dark -> normal start procedure, writing only the vars the
 * cockpit controls write: engines stabilize at idle, generators on line,
 * start-related CAS clear. Also checks the battery-start electrical picture
 * (bus dip, starter current) against the physics of a 300 A starter-generator
 * on a 44 Ah NiCd battery.
 */
import { describe, expect, it } from 'vitest';
import { ENG } from '../../../src/core/vars';
import { M2, TLA } from '../../../src/aircraft/citation-m2/vars';
import { makeM2, press } from './helpers';

describe('Citation M2 cold & dark start', () => {
  it('starts both engines on the battery and brings the generators on line', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    // Cockpit preparation
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    r.run(1);
    expect(v.get('elec.batt_v')).toBeGreaterThan(24);
    v.set(M2.genSw(1), 1);
    v.set(M2.genSw(2), 1);
    v.set(M2.antiColl, 1);
    r.run(2);
    expect(v.get('elec.avn1_powered')).toBe(1);

    // Engine 2 (right) first: START, throttle to IDLE at 8-10 % N2.
    let minBusV = 99;
    let maxStarterA = 0;
    press(r, M2.startBtn(2));
    expect(v.get('fadec.eng2.start_state')).toBeGreaterThan(0);
    let lightOffT = NaN;
    let t = 0;
    let peakItt = 0;
    r.run(80, () => {
      t += 1 / 60;
      minBusV = Math.min(minBusV, v.get('elec.batt_bus_v'));
      maxStarterA = Math.max(maxStarterA, v.get('elec.sg2_starter_amps'));
      peakItt = Math.max(peakItt, v.get(ENG.itt(2)));
      if (v.get(ENG.n2(2)) > 9 && v.get(M2.tla(2)) < 0) v.set(M2.tla(2), TLA.idle);
      if (Number.isNaN(lightOffT) && v.get(ENG.fuelOn(2)) === 1) lightOffT = t;
      return v.get(ENG.running(2)) === 1 && v.get(ENG.n2(2)) > 51;
    });
    expect(v.get(ENG.running(2))).toBe(1);
    expect(lightOffT).toBeLessThan(10);
    expect(peakItt).toBeGreaterThan(550);
    expect(peakItt).toBeLessThan(1000); // TCDS start transient limit
    // Battery start: bus dips to ~16-20 V under the starter current (QA notes), starter current several hundred amps.
    expect(minBusV).toBeLessThan(22);
    expect(minBusV).toBeGreaterThan(12);
    expect(maxStarterA).toBeGreaterThan(300);
    r.run(10);
    expect(v.get('elec.sg2_online')).toBe(1);

    // Engine 1 (left) with the right generator assisting.
    press(r, M2.startBtn(1));
    r.run(80, () => {
      if (v.get(ENG.n2(1)) > 9 && v.get(M2.tla(1)) < 0) v.set(M2.tla(1), TLA.idle);
      return v.get(ENG.running(1)) === 1 && v.get(ENG.n2(1)) > 51;
    });
    r.run(20);
    for (const i of [1, 2]) {
      expect(v.get(ENG.running(i))).toBe(1);
      expect(v.get(ENG.n2(i))).toBeGreaterThan(50);
      expect(v.get(ENG.n2(i))).toBeLessThan(55);
      expect(v.get(ENG.n1(i))).toBeGreaterThan(23);
      expect(v.get(ENG.n1(i))).toBeLessThan(27);
      expect(v.get(ENG.itt(i))).toBeGreaterThan(400);
      expect(v.get(ENG.itt(i))).toBeLessThan(560);
      expect(v.get(ENG.fuelFlowPph(i))).toBeGreaterThan(90);
      expect(v.get(ENG.fuelFlowPph(i))).toBeLessThan(170);
      expect(v.get(ENG.oilPressPsi(i))).toBeGreaterThan(23);
      expect(v.get(`elec.sg${i}_online`)).toBe(1);
      expect(v.get(`fadec.eng${i}.start_state`)).toBe(4);
    }
    // Generators regulate the buses at 28.5 V (S&D15) and recharge the battery.
    expect(v.get('elec.l_main_v')).toBeGreaterThan(27.5);
    expect(v.get('elec.r_main_v')).toBeGreaterThan(27.5);
    expect(v.get('elec.batt_amps')).toBeGreaterThan(0);
    // Start-related CAS clear.
    for (const id of ['start_l', 'start_r', 'gen_off_l', 'gen_off_r', 'oil_press_low_l', 'oil_press_low_r', 'fuel_press_low_l', 'fuel_press_low_r', 'start_fail_l', 'start_fail_r']) {
      expect(v.get(`cas.${id}`), id).toBe(0);
    }
    expect(v.get('cas.warning_count')).toBe(0);
    // Fuel is being burned from the tanks by the fuel system.
    const f0 = v.get('fuel.total_kg');
    r.run(60);
    expect(v.get('fuel.total_kg')).toBeLessThan(f0 - 1.5);
  }, 60000);
});
