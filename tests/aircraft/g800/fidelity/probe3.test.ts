/** Read-only fidelity probes, audit round 2 (auditor). Logs behaviour; assertions are loose. */
import { describe, it } from 'vitest';
import { makeRig, casTexts } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';

const log = (...a: unknown[]) => console.log('[PROBE3]', ...a);

describe('G800 fidelity probes round 2', () => {
  it('AP engagement on the ground (real: not engageable below 200 ft AGL)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    r.events.emit('epic.gp.ap');
    r.run(1);
    log('on ground after AP key: ap.engaged =', v.get('ap.engaged'), 'agl 0');
  });

  it('uncommanded reverser deploy in flight: CAS?', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('rev.eng1.uncmd');
    r.run(5);
    log('rev1 uncmd: unlocked =', v.get('fadec.eng1.rev_unlocked'), 'deployed =', v.get('fadec.eng1.rev_deployed'), 'pos =', v.get('eng1.reverser_pos'));
    log('CAS warnings:', casTexts(r, 'warning'), 'cautions:', casTexts(r, 'caution'));
  });

  it('A/T with an engine in ALT (LP) control: engage attempt', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } });
    const v = r.vars;
    r.run(2);
    v.set(V.engAlt(1), 1);
    r.run(1);
    r.events.emit('at.engage');
    r.run(1);
    log('engAlt1=1: ap.athr =', v.get('ap.athr'), 'CAS cautions:', casTexts(r, 'caution'));
  });

  it('stuck mic: PTT held 40 s', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.ptt(1), 1);
    r.run(34);
    log('at 34 s: keyed =', v.get(V.micKeyed(1)), 'stuck =', v.get(V.stuckMic));
    r.run(3);
    log('at 37 s: keyed =', v.get(V.micKeyed(1)), 'stuck =', v.get(V.stuckMic), 'advisories:', casTexts(r, 'advisory'));
  });

  it('PA MIC select: keying writes what?', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.micSel(1), 6);
    v.set(V.ptt(1), 1);
    r.run(1);
    log('PA keyed: mic_keyed1 =', v.get(V.micKeyed(1)), 'com1_tx =', v.get(V.comTx(1)), 'pa load powered =', v.get('elec.pa_powered'));
  });
});
