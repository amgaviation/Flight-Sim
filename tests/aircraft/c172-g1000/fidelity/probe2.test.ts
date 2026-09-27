import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { makeG1k, cas } from '../helpers';
import { C172 } from '../../../../src/aircraft/c172s-common/vars';
import { G1K, G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/c172g-audit/probe.log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
describe('probe2', () => {
  it('Q1 MASTER OFF transient on ESS', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(4);
    r.vars.set(C172.masterAlt, 0);
    r.vars.set(C172.masterBat, 0);
    const s: string[] = [];
    for (let i = 0; i < 20; i++) {
      r.run(0.05);
      s.push(`${r.vars.get('elec.ess_v').toFixed(1)}/${r.vars.get('elec.pfd_powered')}/${r.vars.get(G1K.unitUp('pfd'))}`);
    }
    log('Q1 ess/pfdpow/pfdup 50ms steps', s.join(' '));
    r.run(20);
    log('Q1 after 20 s pfd up', r.vars.get(G1K.unitUp('pfd')), 'rev', r.vars.get(G1K.reversionary('pfd')), 'ahrs valid', r.vars.get('ahrs1.valid'), 'cas', cas(r));
  });
  it('Q2 alternator failure: LOW VOLTS and main battery discharge; STBY stays off', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(4);
    r.vars.set('fail.c172.alt_belt', 1);
    r.run(30);
    log('Q2 mbus', r.vars.get(C172.mBusV).toFixed(2), 'ebus', r.vars.get(C172.eBusV).toFixed(2), 'mbatt', r.vars.get(C172.mBattA).toFixed(1), 'sbatt', r.vars.get(C172.sBattA).toFixed(2), 'cas', cas(r));
    let t = 0;
    r.run(7200, (tt) => { t = tt; return r.vars.get('ac.c172.ann.stby_batt') > 0.5; });
    log('Q2 STBY BATT caution after', (t / 60).toFixed(1), 'min; mbus', r.vars.get(C172.mBusV).toFixed(1), 'ebus', r.vars.get(C172.eBusV).toFixed(1));
  });
  it('Q3 MET ARM half alone / flap breaker check', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(4);
    log('Q3 ready_to_taxi stby batt', r.vars.get(C172.stbyBatt), 'sbatt A', r.vars.get(C172.sBattA).toFixed(2), 'mbatt', r.vars.get(C172.mBattA).toFixed(1), 'ebus', r.vars.get(C172.eBusV).toFixed(2), 'mbus', r.vars.get(C172.mBusV).toFixed(2));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'fd'));
    r.run(1);
    log('Q3 FD on ground modes', r.vars.getString('ap.lat_active'), r.vars.getString('ap.vert_active'));
    r.events.emit('ap.toga');
    r.run(1);
    log('Q3 GA on ground modes', r.vars.getString('ap.lat_active'), r.vars.getString('ap.vert_active'), 'pitch ref', r.vars.get('ap.fd_pitch_deg').toFixed(1));
  });
});
