/**
 * Handling qualities of the cable elevator / ailerons (OG 15-2/15-3) with the
 * pilot gearing of createSystems.ts (PILOT_GEARING, EST blow-down model).
 *
 * Before the check-ride pass, 30 % column at 250 KIAS gave 3.7 g and fired the
 * stick pusher, and full wheel rolled at 191 deg/s (pb/2V 0.22). Targets (EST,
 * transport-category business jet): 30 % column ~2 g at 250-320 KIAS; full
 * wheel 30-60 deg/s from approach to cruise speeds; low-speed pitch authority
 * unchanged (full column still reaches the stall warning at 150 KIAS).
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from '../helpers';
import { INPUT } from '../../../../src/core/vars';

function response(ias: number, axis: 'pitch' | 'roll', input: number): { maxNz: number; maxP: number; shaker: boolean; pusher: boolean } {
  const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 15000, iasKt: ias } });
  const v = r.vars;
  r.run(2);
  r.events.emit('ap.disc');
  r.run(1);
  let maxNz = 0;
  let maxP = 0;
  let shaker = false;
  let pusher = false;
  v.set(axis === 'pitch' ? INPUT.pitch : INPUT.roll, input);
  r.run(axis === 'roll' ? 3 : 2, () => {
    maxNz = Math.max(maxNz, v.get('fdm.nz_g'));
    maxP = Math.max(maxP, Math.abs(v.get('fdm.p_dps')));
    shaker ||= v.get('alert.stick_shaker') !== 0;
    pusher ||= v.get('stall.pusher_cmd') < 0;
    if (pusher) return true;
  });
  return { maxNz, maxP, shaker, pusher };
}

describe('Citation Longitude handling (pilot gearing)', () => {
  it('30 % column gives ~2 g at 250 and 320 KIAS, no pusher', { timeout: 120_000 }, () => {
    for (const ias of [250, 320]) {
      const x = response(ias, 'pitch', 0.3);
      expect(x.pusher, `${ias} kt`).toBe(false);
      expect(x.maxNz, `${ias} kt`).toBeGreaterThan(1.6);
      expect(x.maxNz, `${ias} kt`).toBeLessThan(2.6);
    }
  });

  it('full column still reaches the stall warning at 150 KIAS (low-speed authority unchanged)', { timeout: 120_000 }, () => {
    const x = response(150, 'pitch', 1);
    expect(x.shaker).toBe(true);
  });

  it('full wheel rolls at 30-60 deg/s from 150 to 320 KIAS', { timeout: 120_000 }, () => {
    for (const ias of [150, 250, 320]) {
      const x = response(ias, 'roll', 1);
      expect(x.maxP, `${ias} kt`).toBeGreaterThan(25);
      expect(x.maxP, `${ias} kt`).toBeLessThan(60);
    }
  });
});
