/**
 * Check-airman pass regressions: TRS manual selection in flight, PFD flap placards, sidestick PTT keying.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
import { G800_LIMITS } from '../../../../src/aircraft/g800/data';
import { STUCK_MIC_S } from '../../../../src/aircraft/g800/systems/audio';

describe('G800 check-airman regressions', () => {
  it('TRS: CRZ / MCT selected on the TSC in flight stay selected; TO -> CLB is automatic after takeoff', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 254 } });
    const v = r.vars;
    r.run(1);
    // Procedures fix round 1 P05: the cruise preset now loads with CRZ already selected (the Cruise
    // checklist's completed state); manual selections still stick until the next automatic transition.
    expect(v.getString('fadec.rating')).toBe('CRZ');
    r.events.emit('fadec.rating', 'CRZ');
    r.run(5);
    expect(v.getString('fadec.rating')).toBe('CRZ');
    expect(v.get('fadec.n1_limit_pct')).toBeCloseTo(v.get('fadec.n1_crz_pct'), 3);
    r.events.emit('fadec.rating', 'MCT');
    r.run(2);
    expect(v.getString('fadec.rating')).toBe('MCT');
    // A crew selection of TO in the air is re-sequenced to CLB.
    r.events.emit('fadec.rating', 'TO');
    r.run(1);
    expect(v.getString('fadec.rating')).toBe('CLB');
  });

  it('PFD flap placards come from the G800 limits (flaps 39 190 KCAS, FSB)', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    const af = r.sys.suite!.cfg.airframe;
    expect(af.flapPlacardKt[3]).toBe(G800_LIMITS.vfe39Kt);
    expect(G800_LIMITS.vfe39Kt).toBe(190);
  });

  it('sidestick PTT keys the MIC-selected transmitter on ESS DC power; stuck mic times out', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    expect(v.get(V.micSel(1))).toBe(1);
    v.set(V.ptt(1), 1);
    r.run(0.5);
    expect(v.get(V.micKeyed(1))).toBe(1);
    expect(v.get(V.comTx(1))).toBe(1);
    v.set(V.ptt(1), 0);
    v.set(V.micSel(2), 2);
    v.set(V.ptt(2), 1);
    r.run(0.5);
    expect(v.get(V.comTx(1))).toBe(0);
    expect(v.get(V.comTx(2))).toBe(1);
    r.run(STUCK_MIC_S + 1);
    expect(v.get(V.comTx(2))).toBe(0);
    expect(casTexts(r, 'advisory')).toContain('Stuck Mic');
    v.set(V.ptt(2), 0);
    r.run(1);
    expect(casTexts(r, 'advisory')).not.toContain('Stuck Mic');
    // Radio 1 breaker pulled: the pilot's PTT does nothing.
    v.set('cb.radio1', 0);
    r.run(0.5);
    v.set(V.ptt(1), 1);
    r.run(0.5);
    expect(v.get(V.micKeyed(1))).toBe(0);
  });
});
