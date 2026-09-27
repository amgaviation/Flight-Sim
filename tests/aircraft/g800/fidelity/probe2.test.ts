import { describe, it } from 'vitest';
import { makeRig, casTexts } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
const log = (...a: unknown[]) => console.log('[PROBE]', ...a);
describe('probe2', () => {
  it('steering', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi'); const v = r.vars; r.run(1);
    v.set(V.tiller, 1); r.run(3);
    log('nws on tiller 1: cmd', v.get('steer.cmd_deg'), 'eng', v.get('steer.engaged'));
    v.set(V.nwsSw, 0); r.run(3);
    log('nws off tiller 1: cmd', v.get('steer.cmd_deg'), 'eng', v.get('steer.engaged'));
    v.set(V.tiller, 0); v.set(V.nwsSw, 1); v.set('input.yaw', 1); r.run(3);
    log('pedal full: cmd', v.get('steer.cmd_deg'));
  });
  it('ADC2/ADC3 failures and AP on side 2', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } }); const v = r.vars; r.run(2);
    r.events.emit('epic.gp.ap'); r.run(1);
    r.sys.failures.trigger('adc2'); r.sys.failures.trigger('adc3'); r.run(3);
    log('adc2+3 fail: fbw', v.get('fbw.mode_code'), 'ap', v.get('ap.engaged'), casTexts(r));
    r.sys.failures.trigger('irs2'); r.sys.failures.trigger('irs3'); r.run(3);
    log('irs2+3 fail: fbw', v.get('fbw.mode_code'), casTexts(r));
  });
  it('pressurization schedule', { timeout: 60000 }, () => {
    for (const alt of [41000, 45000, 51000]) {
      const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: alt, iasKt: 230 } }); const v = r.vars; r.run(60);
      log('alt', alt, 'cabin', v.get('press.cabin_alt_ft').toFixed(0), 'diff', v.get('press.diff_psi').toFixed(2));
    }
  });
  it('fcc power loss / UPS', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } }); const v = r.vars; r.run(2);
    v.set('cb.fcc', 0); r.run(2);
    log('fcc cb pulled: fbw', v.get('fbw.mode_code'), 'power_ok', v.get('fcc.power_ok'), casTexts(r));
    v.set('cb.bfcu', 0); r.run(2);
    log('fcc+bfcu pulled: fbw', v.get('fbw.mode_code'), 'fault', v.get(V.fccFault), casTexts(r));
  });
  it('hyd both lost', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } }); const v = r.vars; r.run(2);
    r.sys.failures.trigger('hyd.edp_l'); r.sys.failures.trigger('hyd.edp_r'); r.run(20);
    log('dual EDP: L', v.get('hyd.left_psi').toFixed(0), 'R', v.get('hyd.right_psi').toFixed(0), 'aux', v.get('hyd.aux_on'), casTexts(r));
  });
  it('fuel xflow & imbalance, boost off', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } }); const v = r.vars; r.run(2);
    v.set(V.boostL, 0); v.set(V.altPumpL, 0); r.run(5);
    log('L boost+alt off FL350: eng1', v.get('eng1.running'), casTexts(r));
  });
  it('ground spoilers / TO thrust with spoiler not armed', { timeout: 60000 }, () => {
    const r = makeRig('takeoff'); const v = r.vars; r.run(1);
    v.set(V.gndSplrArm, 0); v.set(V.tla(1), 1); v.set(V.tla(2), 1); r.run(1);
    log('no gnd splr arm, TO thrust tocw', v.get('alert.takeoff_config'), casTexts(r));
    v.set(V.tla(1), 0.9); v.set(V.tla(2), 0.9); v.set(V.gndSplrArm, 1); v.set('ac.g800.yaw_trim', 1); r.run(10); v.set('ac.g800.yaw_trim', 0);
    log('rudder trim', v.get('trim.yaw_units').toFixed(2), 'tocw', v.get('alert.takeoff_config'));
  });
});
