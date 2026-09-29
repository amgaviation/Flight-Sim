/** Read-only fidelity probes (auditor). Logs behaviour; assertions are loose. */
import { describe, it } from 'vitest';
import { makeRig, casTexts } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';

const log = (...a: unknown[]) => console.log('[PROBE]', ...a);

describe('G800 fidelity probes', () => {
  it('ADC1 single failure in cruise -> FBW law, AFCS', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 270 } });
    const v = r.vars;
    r.run(3);
    v.set('ap.engaged', v.get('ap.engaged'));
    r.events.emit('epic.gp.ap');
    r.run(2);
    log('before: fbw', v.get('fbw.mode_code'), 'ap', v.get('ap.engaged'));
    r.sys.failures.trigger('adc1');
    r.run(3);
    log('adc1 fail: fbw', v.get('fbw.mode_code'), 'ap', v.get('ap.engaged'), casTexts(r));
    r.sys.failures.clear?.('adc1');
    r.run(5);
    log('adc1 restored (no reset): fbw', v.get('fbw.mode_code'), casTexts(r, 'caution'));
    r.sys.failures.trigger('irs1');
    r.run(3);
    log('irs1 fail: fbw', v.get('fbw.mode_code'), 'ahrs1.att_valid', v.get('ahrs1.att_valid'));
  });

  it('crank master ON with engine running: RUN -> STOP', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    v.set(V.crankMaster, 1);
    v.set(V.runL, 0);
    r.run(20);
    log('crank on, runL=STOP: eng1.running', v.get('eng1.running'), 'n2', v.get('eng1.n2_pct').toFixed(1), 'fuel_cmd', v.get('fadec.eng1.fuel_cmd'));
  });

  it('NWS switch OFF: tiller steering?', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.nwsSw, 0);
    v.set(V.tiller, 1);
    r.run(3);
    log('nws off, tiller full: steer deg', v.get('steer.angle_deg'), v.get('steer.engaged'), casTexts(r, 'advisory'));
    v.set(V.nwsSw, 1);
    r.run(3);
    log('nws on, tiller full: steer deg', v.get('steer.angle_deg'), v.get('steer.engaged'));
  });

  it('fire handle pulled on running engine: gen, engine', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    log('fire test: unlock', (v.set(V.fireTest, 1), r.run(0.5), v.get('ac.g800.fire_l_unlock')), casTexts(r, 'warning'));
    v.set(V.fireTest, 0);
    r.run(1);
    v.set(V.fireHandleL, 1);
    r.run(15);
    log('handle L pulled: eng1.running', v.get('eng1.running'), 'idg1', v.get('elec.idg1_online'), 'bleed', v.get('pneu.bleed_l_valve_open'), casTexts(r));
  });

  it('APU START without APU MASTER; fire APU on ground auto-extinguish', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1); v.set(V.battR, 1);
    r.run(2);
    v.set(V.apuStart, 1); r.run(0.3); v.set(V.apuStart, 0);
    r.run(5);
    log('start w/o master: apu.state', v.get('apu.state'));
    v.set(V.apuMaster, 1); r.run(1); v.set(V.apuStart, 1); r.run(0.3); v.set(V.apuStart, 0);
    r.run(70);
    log('apu avail', v.get('apu.avail'), 'essV', v.get('elec.l_ess_dc_v').toFixed(1), casTexts(r));
    r.sys.failures.trigger('fire.apu');
    r.run(10);
    log('apu fire: apu.state', v.get('apu.state'), 'bottle_l', v.get('fire.bottle_l_discharged'), casTexts(r, 'warning'));
  });

  it('Gear horn, TOCW, CAS count at takeoff state; parking brake with thrust', { timeout: 60000 }, () => {
    const r = makeRig('takeoff');
    const v = r.vars;
    r.run(2);
    log('takeoff state CAS', casTexts(r));
    v.set(V.parkBrake, 1);
    v.set(V.tla(1), 1); v.set(V.tla(2), 1);
    r.run(2);
    log('park+TO thrust: tocw', v.get('alert.takeoff_config'), casTexts(r));
  });

  it('Emer lights ARM on total loss, EMER PWR latch', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('elec.idg1'); r.sys.failures.trigger('elec.idg2');
    r.run(30);
    log('dual gen: emer lts', v.get('ac.g800.emer_lts_on'), 'ebatt', v.get(V.ebattOn), 'lessV', v.get('elec.l_ess_dc_v').toFixed(1), 'du2', v.get('elec.du2_powered'), 'du3', v.get('elec.du3_powered'), 'fms', v.get('elec.fms_powered'), 'afcs', v.get('elec.afcs_powered'), casTexts(r));
  });

  it('A/T overspeed protection below 8000 ft uses 340?', { timeout: 60000 }, () => {
    const r = makeRig('approach', { weightLb: 70000, air: { altFtMsl: 5000, iasKt: 200 } });
    const v = r.vars;
    r.run(2);
    log('approach state: vmo var', v.get('alert.vmo_kt'), v.get('ap.vmo_kt'), 'rating', v.getString('fadec.rating'), casTexts(r));
  });

  it('Probe heat on ground w/o engines; pack with APU bleed in flight; iso auto', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    log('cruise: cabin alt', v.get('press.cabin_alt_ft').toFixed(0), 'diff', v.get('press.diff_psi')?.toFixed?.(2), 'iso', v.get('pneu.iso_open'), casTexts(r));
    v.set(V.packL, 0); v.set(V.packR, 0);
    r.run(120);
    log('both packs off 2 min: cabin alt', v.get('press.cabin_alt_ft').toFixed(0), casTexts(r));
  });
});
