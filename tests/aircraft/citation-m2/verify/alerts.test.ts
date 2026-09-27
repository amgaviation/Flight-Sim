/**
 * Citation M2 check-airman spot checks of the alerting and protection logic
 * the full-flight test does not exercise: landing-gear warning horn (S&D15
 * §7), takeoff configuration warning, speed-brake auto-retract at high thrust
 * (S&D15 §9.1), ground-flap / speed-brake interlock, the lighting preset's
 * night detection from the clock (states.ts).
 */
import { describe, expect, it } from 'vitest';
import { FDM } from '../../../../src/core/vars';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import { isNightForPreset, setM2Switches } from '../../../../src/aircraft/citation-m2/states';
import { SimVars } from '../../../../src/core/SimVars';
import { makeM2, press } from '../helpers';

describe('Citation M2 warnings and interlocks', () => {
  it('gear horn: gear up, < 130 KIAS, throttle idle -> horn (silenceable); flaps 35 with gear up -> horn not silenceable', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 1500, air: { altFtMsl: 6000, iasKt: 150 } });
    const v = r.vars;
    r.run(4);
    expect(v.get('gear.up_locked')).toBe(1);
    expect(v.get('gear.horn')).toBe(0);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.idle);
    r.run(40, () => v.get('adc1.ias_kt') < 125);
    r.run(3);
    expect(v.get('adc1.ias_kt')).toBeLessThan(130);
    expect(v.get('gear.horn')).toBe(1);
    press(r, M2.gearHornSilence);
    r.run(1);
    expect(v.get('gear.horn')).toBe(0);
    // Landing flaps with the gear still up: horn again, and the silence button does not stop it.
    v.set(M2.flapHandle, 2);
    r.run(12);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(17);
    expect(v.get('gear.horn')).toBe(1);
    press(r, M2.gearHornSilence);
    r.run(1);
    expect(v.get('gear.horn')).toBe(1);
    // Gear down: horn stops, three green.
    v.set(M2.gearHandle, 1);
    r.run(8);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(v.get('gear.horn')).toBe(0);
    for (const i of [0, 1, 2]) expect(v.get(`gear.green${i}`)).toBe(1);
  });

  it('takeoff configuration warning: flaps 35, speed brakes out or parking brake set with the throttles at TO', () => {
    for (const bad of ['flaps', 'speedbrake', 'park'] as const) {
      const r = makeM2({ state: 'takeoff' });
      const v = r.vars;
      r.run(2);
      if (bad === 'flaps') v.set(M2.flapHandle, 2);
      if (bad === 'speedbrake') v.set(M2.speedbrake, 1);
      if (bad === 'park') v.set(M2.parkBrake, 1);
      r.run(12);
      expect(v.get('alert.takeoff_config'), bad).toBe(0); // armed only with the levers advanced
      v.set('input.brake_left', 1);
      v.set('input.brake_right', 1);
      for (const i of [1, 2]) v.set(M2.tla(i), TLA.to);
      r.run(1.5);
      expect(v.get('alert.takeoff_config'), bad).toBe(1);
      expect(v.get(`tocw.${bad}`), bad).toBe(1);
    }
    // Normal configuration: no warning.
    const r = makeM2({ state: 'takeoff' });
    r.run(2);
    for (const i of [1, 2]) r.vars.set(M2.tla(i), TLA.to);
    r.vars.set('input.brake_left', 1);
    r.vars.set('input.brake_right', 1);
    r.run(2);
    expect(r.vars.get('alert.takeoff_config')).toBe(0);
  });

  it('speed brakes: extend in flight, auto-retract with a throttle at high thrust (~85 % N2), extend again when reduced', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 15000, iasKt: 230 } });
    const v = r.vars;
    r.run(3);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.idle);
    v.set(M2.speedbrake, 1);
    r.run(8);
    expect(v.get('surf.speedbrake')).toBeGreaterThan(0.95);
    v.set(M2.tla(1), TLA.to);
    r.run(10);
    expect(v.get('eng1.n2_pct')).toBeGreaterThan(85);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.05);
    v.set(M2.tla(1), TLA.idle);
    r.run(10);
    expect(v.get('surf.speedbrake')).toBeGreaterThan(0.95); // handle still EXTEND
    v.set(M2.speedbrake, 0);
    r.run(5);
    expect(v.get('surf.speedbrake')).toBeLessThan(0.05);
  });

  it('ground flaps (60): speed brakes deploy on the ground only; GROUND FLAPS caution in flight', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    v.set(M2.flapHandle, 3);
    r.run(20);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(55);
    expect(v.get('surf.speedbrake')).toBeGreaterThan(0.95);
    const a = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 3000, iasKt: 140 } });
    a.run(3);
    a.vars.set(M2.flapHandle, 3);
    a.run(4);
    expect(a.vars.get('surf.speedbrake')).toBeLessThan(0.05);
    expect(a.vars.get('cas.gnd_flaps')).toBe(1);
  });

  it('lighting preset night detection follows the clock (sun elevation), else the ambient light', () => {
    const v = new SimVars();
    v.set(FDM.lat, 40.85);
    v.set(FDM.lon, -74.06);
    v.set('env.day_of_year', 270);
    v.set('env.time_utc_h', 17); // 13:00 EDT
    expect(isNightForPreset(v)).toBe(false);
    v.set('env.time_utc_h', 3); // 23:00 EDT
    expect(isNightForPreset(v)).toBe(true);
    setM2Switches({ vars: v }, 'ready_to_taxi');
    expect(v.get(M2.panelLt)).toBeGreaterThan(0);
    const w = new SimVars();
    w.set('env.ambient_light', 0.1);
    expect(isNightForPreset(w)).toBe(true);
  });
});
