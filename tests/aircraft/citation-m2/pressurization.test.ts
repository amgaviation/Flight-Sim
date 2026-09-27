/**
 * Citation M2 pressurization on the ground and the landing-field-elevation fallback
 * (dossier §6.4): the cabin must stay unpressurised on the ramp (ground solenoid holds
 * the safety valve open, EST CJ family) from the first frame of a preset, and with no
 * GTC entry and no FMS destination the controller uses the takeoff field, never the
 * "not entered" sentinel.
 */
import { describe, expect, it } from 'vitest';
import { M2 } from '../../../src/aircraft/citation-m2/vars';
import { makeM2 } from './helpers';

describe('Citation M2 pressurization on the ground', () => {
  for (const state of ['cold_dark', 'ready_to_taxi'] as const) {
    it(`${state}: cabin at field elevation from the first frame, < 0.06 psi with the packs flowing`, () => {
      const r = makeM2({ state });
      const v = r.vars;
      let maxDiff = 0;
      r.run(30, () => void (maxDiff = Math.max(maxDiff, Math.abs(v.get('press.diff_psi')))));
      expect(maxDiff).toBeLessThan(0.06);
      expect(Math.abs(v.get('press.cabin_alt_ft') - v.get('fdm.alt_msl_ft'))).toBeLessThan(120);
      expect(Math.abs(v.get('press.cabin_rate_fpm'))).toBeLessThan(50);
      expect(v.get('press.safety_valve')).toBe(1); // held open on the ground
    });
  }

  it('landing elevation: no entry, no destination -> takeoff field; GTC entry wins', () => {
    const r = makeM2({ state: 'ready_to_taxi', field: { lat: 39.8617, lon: -104.6731, elevFt: 5434, courseTrue: 180 } });
    const v = r.vars;
    r.run(2);
    expect(v.get(M2.landingElevFt)).toBeLessThan(-1000); // not entered
    expect(Math.abs(v.get('press.ldg_elev_ft') - 5434)).toBeLessThan(30);
    v.set(M2.landingElevFt, 1200);
    r.run(1);
    expect(v.get('press.ldg_elev_ft')).toBe(1200);
  });
});
