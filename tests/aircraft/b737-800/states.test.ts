/**
 * State presets (docs/modules/qa.md §6): every preset brings the systems to a
 * consistent state; parked with the parking brake at idle in gusty wind and
 * turbulence the aircraft neither drifts nor bounces; the in-air presets are
 * trimmed and hold altitude / speed / wings level (CMD A engages a few
 * seconds after the state load).
 */
import { describe, expect, it } from 'vitest';
import { AP, ENG, FDM } from '../../../src/core/vars';
import { horizDist } from '../../physics/helpers';
import { B738 } from '../../../src/aircraft/b737-800/vars';
import { makeB738 } from './helpers';

describe('state presets', () => {
  it('cold & dark: no power, engines stopped, parking brake set', () => {
    const r = makeB738({ state: 'cold_dark' });
    const v = r.vars;
    r.run(2);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get('elec.hot_batt_powered')).toBe(1); // hot battery bus is always live
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(v.get('elec.dc1_powered')).toBe(0);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
  });

  it('ready to taxi: engines at idle, generators on line, no caution, parked in 230/10G16 wind with turbulence', () => {
    const r = makeB738({ state: 'ready_to_taxi', wind: { dir: 230, kt: 10 } });
    const v = r.vars;
    v.set('env.wind_gust_kt', 16);
    v.set('env.turbulence', 0.3);
    r.run(6);
    for (const i of [1, 2] as const) {
      expect(v.get(ENG.running(i))).toBe(1);
      expect(v.get(B738.xfrSrc(i))).toBe(1);
    }
    expect(v.get('hyd.a_psi')).toBeGreaterThan(2800);
    expect(v.get('hyd.b_psi')).toBeGreaterThan(2800);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(5, 0);
    expect(v.get('brakes.autobrake_mode') !== undefined).toBe(true);
    const p0 = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
    const hdg0 = v.get(FDM.headingTrue);
    let altMin = 1e9;
    let altMax = -1e9;
    let maxGs = 0;
    r.run(20, () => {
      altMin = Math.min(altMin, v.get(FDM.altMsl));
      altMax = Math.max(altMax, v.get(FDM.altMsl));
      maxGs = Math.max(maxGs, v.get(FDM.gs));
    });
    expect(horizDist(p0, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) })).toBeLessThan(0.3);
    expect(maxGs).toBeLessThan(0.2);
    expect(Math.abs(v.get(FDM.headingTrue) - hdg0)).toBeLessThan(0.2);
    expect((altMax - altMin) * 0.3048).toBeLessThan(0.1);
    // Recall clean after start (YAW DAMPER needs the IRS aligned: the preset aligns it).
    const active = [...v.keys()].filter((k) => k.startsWith('cas.') && !k.includes('count') && !k.includes('phase') && !k.includes('inhibit') && !k.startsWith('cas.unacked') && v.get(k) !== 0);
    expect(active).toEqual([]);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    // Every var finite, except the shared blocks' documented 'none' NaNs (Autothrottle N1 target, TCAS RA band limits).
    const nonFinite = [...v.keys()].filter((k) => !Number.isFinite(v.get(k)) && k !== 'at.n1_target' && !k.startsWith('tcas.ra_vs_'));
    expect(nonFinite).toEqual([]);
  });

  for (const s of [
    { state: 'cruise' as const, air: { altFtMsl: 35000, iasKt: 265, headingTrue: 90 } },
    { state: 'approach' as const, air: { altFtMsl: 3000, iasKt: 160, headingTrue: 280 } },
  ]) {
    it(`${s.state}: trimmed, CMD A engaged, holds altitude / speed / wings level`, () => {
      const r = makeB738({ state: s.state, air: s.air });
      const v = r.vars;
      const alt0 = v.get(FDM.altMsl);
      const ias0 = v.get(FDM.ias);
      let maxAlt = 0;
      let maxIas = 0;
      let maxBank = 0;
      r.run(30, () => {
        maxAlt = Math.max(maxAlt, Math.abs(v.get(FDM.altMsl) - alt0));
        maxIas = Math.max(maxIas, Math.abs(v.get(FDM.ias) - ias0));
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
      });
      expect(v.get(AP.engaged)).toBe(1);
      expect(v.getString(AP.verticalActive)).toBe('ALT HOLD');
      expect(maxAlt).toBeLessThan(300);
      expect(maxIas).toBeLessThan(10);
      expect(maxBank).toBeLessThan(5);
      expect(v.get(B738.xfrSrc(1))).toBe(1);
      expect(v.get('gear.down_locked')).toBe(s.state === 'approach' ? 1 : 0);
      expect(v.get(FDM.crashed)).toBe(0);
    });
  }

  it('night launch: presets light the panels from the launch time although ambient light still reads day', () => {
    // The app sets env.time_utc_h / day_of_year before applyState; env.ambient_light (1 in the rig, as at app
    // start) is only computed on the world's first frame. 06:00Z = 02:00 EDT at KTEB in July: night.
    const night = makeB738({
      state: 'ready_to_taxi',
      beforeState: (ctx) => {
        ctx.vars.set('env.time_utc_h', 6);
        ctx.vars.set('env.day_of_year', 190);
      },
    });
    expect(night.vars.get('env.ambient_light')).toBe(1);
    expect(night.vars.get(B738.ovhdPanelLt)).toBeCloseTo(0.7, 5);
    expect(night.vars.get(B738.cbPanelLt)).toBeCloseTo(0.4, 5);
    expect(night.vars.get(B738.backgroundLt)).toBeGreaterThan(0);
    expect(night.vars.get(B738.domeLt)).toBe(0); // dome off for taxi at night
    // 17:00Z = 13:00 EDT: day values.
    const day = makeB738({
      state: 'ready_to_taxi',
      beforeState: (ctx) => {
        ctx.vars.set('env.time_utc_h', 17);
        ctx.vars.set('env.day_of_year', 190);
      },
    });
    expect(day.vars.get(B738.ovhdPanelLt)).toBeCloseTo(0.3, 5);
    expect(day.vars.get(B738.cbPanelLt)).toBe(0);
  });
});
