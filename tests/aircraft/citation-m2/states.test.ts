/**
 * Initial-state presets: ground states hold still on the parking brake,
 * in-air states are trimmed (hold altitude / speed / bank hands-off), no
 * warnings in any powered state, and every control var of the inventory is
 * written by applyState.
 */
import { describe, expect, it } from 'vitest';
import { ENG, FDM } from '../../../src/core/vars';
import { M2 } from '../../../src/aircraft/citation-m2/vars';
import { M2_META } from '../../../src/aircraft/citation-m2/meta';
import { M2_CHECKLISTS } from '../../../src/aircraft/citation-m2/checklists';
import { horizDist } from '../../physics/helpers';
import { makeM2 } from './helpers';

describe('Citation M2 initial states', () => {
  it('cold & dark: everything off, engines stopped, no power', () => {
    const r = makeM2({ state: 'cold_dark' });
    r.run(3);
    const v = r.vars;
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(v.get('elec.emer_powered')).toBe(0);
    expect(v.get('display.pfd1.power')).toBe(0);
    expect(v.get(M2.controlLock)).toBe(1);
    expect(v.get('brakes.parking_set')).toBe(1);
  });

  for (const s of ['ready_to_taxi', 'takeoff'] as const) {
    it(`${s}: engines at idle, generators on line, parked still (brake as set), no warnings`, () => {
      const r = makeM2({ state: s, wind: { dir: 230, kt: 10 } });
      const v = r.vars;
      if (s === 'takeoff') v.set(M2.parkBrake, 1);
      r.run(2);
      const p0 = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      r.run(20);
      expect(horizDist(p0, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) })).toBeLessThan(0.3);
      for (const i of [1, 2]) {
        expect(v.get(ENG.running(i))).toBe(1);
        expect(v.get(`elec.sg${i}_online`)).toBe(1);
      }
      expect(v.get('display.pfd1.power')).toBe(1);
      expect(v.get('display.mfd.power')).toBe(1);
      expect(v.get('cas.warning_count')).toBe(0);
      expect(v.get('trim.pitch_to_ok')).toBe(1);
      expect(Math.abs(v.get('surf.flaps_deg') - 15)).toBeLessThan(0.5);
      expect(v.get('ahrs1.valid')).toBe(1);
    });
  }

  for (const [s, alt, ias] of [
    ['cruise', 37000, 230],
    ['approach', 3000, M2_META.typical.approachKias + 15],
  ] as const) {
    it(`${s}: trimmed hands-off for 20 s (altitude +/-300 ft, IAS +/-10 kt, bank < 5 deg)`, () => {
      const r = makeM2({ state: s, fuelLb: 2000, air: { altFtMsl: alt, iasKt: ias } });
      const v = r.vars;
      const alt0 = v.get(FDM.altMsl);
      const ias0 = v.get(FDM.ias);
      let maxDAlt = 0;
      let maxDIas = 0;
      let maxBank = 0;
      r.run(20, () => {
        maxDAlt = Math.max(maxDAlt, Math.abs(v.get(FDM.altMsl) - alt0));
        maxDIas = Math.max(maxDIas, Math.abs(v.get(FDM.ias) - ias0));
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
      });
      expect(maxDAlt).toBeLessThan(300);
      expect(maxDIas).toBeLessThan(10);
      expect(maxBank).toBeLessThan(5);
      expect(v.get('fdm.crashed')).toBe(0);
      expect(v.get('cas.warning_count')).toBe(0);
      expect(v.get('gear.down_locked')).toBe(s === 'approach' ? 1 : 0);
      // Cabin pressurized on schedule, pressurization controller fine.
      expect(v.get('press.cabin_alt_warn')).toBe(0);
    });
  }

  it('every inventory control var is written by applyState', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    r.run(0.1);
    const names: string[] = [];
    for (const [k, val] of Object.entries(M2)) {
      if (typeof val === 'string') names.push(val);
      else if (k === 'doorOpen') for (const d of ['cabin', 'emer_exit', 'nose_bag_l', 'nose_bag_r', 'tail_bag'] as const) names.push((val as (door: string) => string)(d));
      else if (typeof val === 'function') for (const i of [1, 2]) names.push((val as (i: number) => string)(i));
    }
    const skip = new Set([M2.gpuConnected, M2.startLight(1), M2.startLight(2), M2.engFireLight(1), M2.engFireLight(2), M2.bottleLight(1), M2.bottleLight(2)]);
    for (const n of names) if (!skip.has(n)) expect(r.vars.has(n), n).toBe(true);
  });

  it('checklists: the before-takeoff checklist auto-checks complete in the takeoff state', () => {
    const r = makeM2({ state: 'takeoff' });
    r.run(3);
    const bt = M2_CHECKLISTS.find((c) => c.title === 'Before takeoff')!;
    for (const item of bt.items) if (item.check) expect(item.check(r.vars), item.challenge).toBe(true);
  });
});
