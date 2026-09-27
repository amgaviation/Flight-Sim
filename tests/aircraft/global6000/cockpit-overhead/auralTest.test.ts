/**
 * AURAL WARNING TEST 1 / 2 from the EMS CDU TEST CONTROL page (FCOM CSP 700-5000-6
 * 03-10-16 / -17): sequence order, per-IAC mute, IAC breaker, terminate on re-selection.
 */
import { describe, expect, it } from 'vitest';
import { KeyPad } from '../../../../src/cockpit/controls';
import { AUDIO } from '../helpers';
import { setupFull } from './harness';
import { AURAL_TEST_S, AURAL_TEST_VAR } from '../../../../src/aircraft/global6000/cockpit/side/auralTest';

describe('Global 6000 EMS AURAL WARNING TEST', () => {
  it('plays the IAC tone / voice sequence, honours the IAC mute and breaker, terminates on re-selection', { timeout: 180_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click, ctl } = k;
    const v = r.vars;
    const said: string[] = [];
    const played: string[] = [];
    const tones: string[] = [];
    const o = { callout: AUDIO.callout, play: AUDIO.play, tone: AUDIO.tone };
    AUDIO.callout = (t: string) => void said.push(t);
    AUDIO.play = (id: string) => void played.push(id);
    AUDIO.tone = (id: string, on: boolean) => void (on && tones.push(id));
    try {
      step(1);
      const fn = ctl('g6k.side.ems1_fn') as KeyPad;
      const act = ctl('g6k.side.ems1_r') as KeyPad;
      fn.press('TEST');
      step(0.1);
      act.press('R3'); // AURAL WARNING TEST 1
      step(0.1);
      expect(v.get(AURAL_TEST_VAR(1))).toBe(1);
      expect(said[0]).toBe('AURAL WARNING TEST 1');
      step(AURAL_TEST_S + 1);
      expect(v.get(AURAL_TEST_VAR(1))).toBe(0);
      // FCOM order: STALL, overspeed, triple chime, NO TAKEOFF, ... MINIMUMS, SELCAL.
      const idx = (t: string) => said.indexOf(t);
      expect(idx('STALL')).toBeGreaterThan(0);
      expect(idx('NO TAKEOFF')).toBeGreaterThan(idx('STALL'));
      expect(idx('LEFT ENGINE FIRE')).toBeGreaterThan(idx('NO TAKEOFF'));
      expect(idx('NORMAL BRAKE FAIL')).toBeGreaterThan(idx('GEAR BAY OVERHEAT'));
      expect(idx('SELCAL, SELCAL')).toBe(said.length - 1);
      expect(tones).toEqual(['stick_shaker', 'overspeed', 'ap_disconnect']);
      expect(played).toContain('chime.triple');
      expect(played.filter((x) => x === 'alt_alert').length).toBe(3); // C-chord + double C-chord

      // IAC 2 muted on the overhead: AURAL WARNING TEST 2 runs but is silent; IAC 1 still tests.
      said.length = 0;
      click('g6k.ovhd.iac2_mute');
      step(0.3);
      act.press('R4');
      step(5);
      expect(v.get(AURAL_TEST_VAR(2))).toBe(1);
      expect(said).toEqual([]);
      act.press('R4'); // re-selection terminates (03-10-16 NOTE)
      step(0.2);
      expect(v.get(AURAL_TEST_VAR(2))).toBe(0);
      click('g6k.ovhd.iac2_mute');

      // IAC 1 breaker pulled (EMS SSPC): no generator, silent test.
      v.set('cb.iac1', 0);
      step(0.5);
      expect(v.get('elec.iac1_powered')).toBe(0);
      said.length = 0;
      act.press('R3');
      step(4);
      expect(said).toEqual([]);
      v.set('cb.iac1', 1);
    } finally {
      Object.assign(AUDIO, o);
      k.build.dispose?.();
    }
  });
});
