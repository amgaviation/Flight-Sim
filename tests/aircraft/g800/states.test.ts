/**
 * Initial states (docs/modules/app.md 2.4, qa.md 6): every preset loads into a
 * consistent, finite state; ground states stay parked; in-air states hold
 * altitude, speed and wings level hands-off; the ready states have no
 * warnings/cautions; takeoff is configured (no takeoff-configuration warning at
 * takeoff thrust).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { G800_VARS as V } from '../../../src/aircraft/g800/vars';

function allFinite(vars: import('../../../src/core/SimVars').SimVars): string[] {
  const bad: string[] = [];
  // NaN is the documented "no value" sentinel of these shared-block outputs (no A/T N1 target, no TCAS RA band).
  const sentinel = new Set(['at.n1_target', 'tcas.ra_vs_min_fpm', 'tcas.ra_vs_max_fpm']);
  for (const [k, x] of Object.entries(vars.snapshot().values)) if (!Number.isFinite(x) && !sentinel.has(k)) bad.push(k);
  return bad;
}

describe('G800 initial states', () => {
  it('cold & dark: everything off, parked', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(10);
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(v.get('fdm.gs_kt')).toBeLessThan(0.1);
    expect(allFinite(v)).toEqual([]);
  });

  it('ready to taxi: engines at idle, generators on line, no warnings or cautions, parked in wind', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { wind: { dir: 230, kt: 15 } });
    const v = r.vars;
    const lat0 = v.get('fdm.lat_deg');
    const lon0 = v.get('fdm.lon_deg');
    r.run(20);
    expect(v.get('eng1.running')).toBe(1);
    expect(v.get('eng2.running')).toBe(1);
    expect(v.get('elec.idg1_online')).toBe(1);
    expect(v.get('elec.idg2_online')).toBe(1);
    expect(v.get('fbw.mode_code')).toBe(0);
    expect(casTexts(r, 'warning')).toEqual([]);
    expect(casTexts(r, 'caution')).toEqual([]);
    const dLat = (v.get('fdm.lat_deg') - lat0) * 111000;
    const dLon = (v.get('fdm.lon_deg') - lon0) * 111000 * Math.cos((lat0 * Math.PI) / 180);
    expect(Math.hypot(dLat, dLon)).toBeLessThan(0.3);
    expect(allFinite(v)).toEqual([]);
  });

  it('takeoff: configured (no takeoff configuration warning at takeoff thrust)', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { weightLb: 95000 });
    const v = r.vars;
    r.run(2);
    expect(v.get('brakes.autobrake_armed')).toBe(1); // RTO armed
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(3);
    expect(v.get('alert.takeoff_config')).toBe(0);
    expect(v.getString('fadec.rating')).toBe('TO');
    // Parking brake set at takeoff thrust -> warning.
    v.set(V.parkBrake, 1);
    r.run(1);
    expect(v.get('alert.takeoff_config')).toBe(1);
  });

  for (const [state, alt, ias] of [
    ['cruise', 41000, 254],
    ['approach', 3000, 150],
  ] as const) {
    it(`${state}: trimmed, holds altitude / speed / wings level for 30 s hands-off`, { timeout: 60000 }, () => {
      const r = makeRig(state, { weightLb: 85000, air: { altFtMsl: alt, iasKt: ias } });
      const v = r.vars;
      const a0 = v.get('fdm.alt_msl_ft');
      const s0 = v.get('fdm.ias_kt');
      let maxDA = 0;
      let maxDS = 0;
      let maxBank = 0;
      r.run(30, () => {
        maxDA = Math.max(maxDA, Math.abs(v.get('fdm.alt_msl_ft') - a0));
        maxDS = Math.max(maxDS, Math.abs(v.get('fdm.ias_kt') - s0));
        maxBank = Math.max(maxBank, Math.abs(v.get('fdm.bank_deg')));
      });
      expect(maxDA).toBeLessThan(300);
      expect(maxDS).toBeLessThan(10);
      expect(maxBank).toBeLessThan(5);
      expect(v.get('fbw.mode_code')).toBe(0);
      expect(v.get('ahrs1.valid')).toBe(1);
      expect(casTexts(r, 'warning')).toEqual([]);
      expect(casTexts(r, 'caution')).toEqual([]);
      expect(allFinite(v)).toEqual([]);
    });
  }
});
