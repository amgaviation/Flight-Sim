/**
 * Function fix round 1, second pass (audit lens "function", gaps F01..F14):
 * each test fails without its fix.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { G800_VARS as V, MIC } from '../../../src/aircraft/g800/vars';

const wrap180 = (d: number) => ((d % 360) + 540) % 360 - 180;

describe('G800 function fix round 1: reverser unlock CAS (F01)', () => {
  it('uncommanded deploy in flight posts the red L Reverser Unlock with the levers stowed', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.run(1);
    expect(casTexts(r, 'warning')).not.toContain('L Reverser Unlock');
    r.sys.failures.trigger('rev.eng1.uncmd');
    r.run(3);
    expect(v.get('eng1.reverser_pos')).toBeGreaterThan(0.05);
    expect(casTexts(r, 'warning')).toContain('L Reverser Unlock');
    expect(casTexts(r, 'warning')).not.toContain('R Reverser Unlock');
  });

  it('on the ground the unlock is an amber caution after the transit delay; commanded reverse posts nothing', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    // Commanded idle reverse: no message (the reverse lever is out of the stowed gate).
    v.set(V.rev(2), 1);
    r.run(4);
    expect(casTexts(r, 'warning')).not.toContain('R Reverser Unlock');
    expect(casTexts(r, 'caution')).not.toContain('R Reverser Unlock');
    v.set(V.rev(2), 0);
    r.run(8); // stow transit + caution delay without a fault: still nothing
    expect(casTexts(r, 'caution')).not.toContain('R Reverser Unlock');
    r.sys.failures.trigger('rev.eng2.uncmd');
    r.run(8);
    expect(casTexts(r, 'caution')).toContain('R Reverser Unlock');
    expect(casTexts(r, 'warning')).not.toContain('R Reverser Unlock');
  });
});

describe('G800 function fix round 1: GP HDG/TRK key (F02)', () => {
  it('the key cycles HDG -> TRK -> off; TRK holds the selected ground track through a crosswind', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 20000, iasKt: 280 }, avionics: true, wind: { dir: 4, kt: 40 } });
    const v = r.vars;
    r.run(2);
    expect(v.get('ap.engaged')).toBe(1);
    // Press until HDG is the active lateral mode, then once more for TRK.
    for (let i = 0; i < 3 && v.getString('ap.lat_active') !== 'HDG'; i++) {
      r.events.emit('epic.gp.hdg_btn');
      r.run(0.2);
    }
    expect(v.getString('ap.lat_active')).toBe('HDG');
    expect(v.get('ap.btn_hdg')).toBe(1);
    r.events.emit('epic.gp.hdg_btn');
    r.run(0.2);
    expect(v.getString('ap.lat_active')).toBe('TRK'); // PFD FMA annunciates TRK
    expect(v.get('ap.btn_hdg')).toBe(1); // key light stays on in TRK
    // Selected value is now a ground track: with a 40 kt crosswind the AFCS holds the TRACK on the
    // window value while the heading crabs into the wind.
    const bug = Math.round(v.get('gps.track_mag_deg'));
    v.set('ap.sel_hdg_deg', bug === 0 ? 360 : bug);
    r.run(60);
    const track = v.get('gps.track_mag_deg');
    const hdg = v.get('ahrs1.hdg_mag_deg');
    expect(Math.abs(wrap180(track - v.get('ap.sel_hdg_deg')))).toBeLessThan(4);
    expect(Math.abs(wrap180(hdg - track))).toBeGreaterThan(1); // crab angle: HDG mode could not do this
    // Third press deselects (back to the basic ROLL mode).
    r.events.emit('epic.gp.hdg_btn');
    r.run(0.2);
    expect(v.getString('ap.lat_active')).toBe('ROLL');
  });
});

describe('G800 function fix round 1: audio PA keying (F07)', () => {
  it('MIC sel PA keys ac.g800.pa_tx while powered', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.run(1);
    v.set(V.micSel(1), MIC.PA);
    v.set(V.ptt(1), 1);
    r.run(0.5);
    expect(v.get(V.micKeyed(1))).toBe(MIC.PA);
    expect(v.get(V.paTx)).toBe(1);
    // Pulling the PA breaker stops it.
    v.set('cb.pa', 0);
    r.run(0.5);
    expect(v.get(V.micKeyed(1))).toBe(0);
    expect(v.get(V.paTx)).toBe(0);
    v.set('cb.pa', 1);
    v.set(V.ptt(1), 0);
    r.run(0.5);
    expect(v.get(V.paTx)).toBe(0);
  });
});

describe('G800 function fix round 1: split emergency-battery pairs (F08)', () => {
  it('a single low ESS bus latches only its own pair and its own advisory', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.emerPwr, 1); // ARM
    r.run(2); // both ESS DC buses healthy (> 22 V): the ARM condition is armed
    expect(v.get(V.ebattFwdOn)).toBe(0);
    expect(v.get(V.ebattAftOn)).toBe(0);
    // Lose only the L ESS DC feed (L BATT off, nothing else powers it cold & dark).
    v.set(V.battL, 0);
    r.run(2);
    expect(v.get(V.ebattFwdOn)).toBe(1);
    expect(v.get(V.ebattAftOn)).toBe(0);
    expect(v.get(V.ebattOn)).toBe(1);
    // The FWD pair alone re-powers the L ESS DC bus.
    expect(v.get('elec.l_ess_dc_powered')).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('Fwd Emer Battery On');
    expect(casTexts(r, 'advisory')).not.toContain('Aft Emer Battery On');
    // EMER PWR ON forces both pairs on.
    v.set(V.emerPwr, 2);
    r.run(1);
    expect(v.get(V.ebattAftOn)).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('Aft Emer Battery On');
  });
});

describe('G800 function fix round 1: per-probe heat monitoring (F09)', () => {
  it('a failed standby pitot heater posts Std Pitot Heat Fail, not the L/R texts', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    r.run(1);
    expect(r.vars.get(V.probeHeatOn)).toBe(1);
    r.sys.failures.trigger('ice.pitot3.heat');
    r.run(4);
    expect(casTexts(r, 'caution')).toContain('Std Pitot Heat Fail');
    expect(casTexts(r, 'caution')).not.toContain('L Pitot Heat Fail');
    expect(casTexts(r, 'caution')).not.toContain('R Pitot Heat Fail');
    r.sys.failures.trigger('ice.static2.heat');
    r.run(4);
    expect(casTexts(r, 'caution')).toContain('R Static Heat Fail');
    expect(casTexts(r, 'caution')).not.toContain('L Static Heat Fail');
  });
});

describe('G800 function fix round 1: stabilizer failure (F13)', () => {
  it('fbw.stab freezes the stabilizer against the trim switches and posts Stabilizer Failed', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('fbw.stab');
    r.run(2);
    expect(casTexts(r, 'caution')).toContain('Stabilizer Failed');
    const stab0 = v.get('surf.pitch_trim');
    v.set(V.ssTrim(1), 1); // grip trim switch held nose up
    r.run(3);
    v.set(V.ssTrim(1), 0);
    expect(Math.abs(v.get('surf.pitch_trim') - stab0)).toBeLessThan(1e-6);
    // The aircraft is still controllable: the C* law holds pitch with elevator (AP still on).
    expect(v.get('ap.engaged')).toBe(1);
  });
});

describe('G800 function fix round 1: vars hygiene (F14)', () => {
  it('ac.g800.fcs_src reports valid ADCs * 10 + valid IRSs', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    r.run(2);
    expect(r.vars.get(V.fcsSrc)).toBe(33);
    r.sys.failures.trigger('adc1');
    r.run(6);
    expect(r.vars.get(V.fcsSrc)).toBe(23);
  });
});
