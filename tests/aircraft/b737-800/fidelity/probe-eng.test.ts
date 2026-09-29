import { describe, it } from 'vitest';
import { B738 } from '../../../../src/aircraft/b737-800/vars';
import { makeB738 } from '../helpers';
const log = (...a: unknown[]) => console.log('[PROBE]', ...a);
function manual(r: ReturnType<typeof makeB738>) {
  r.run(12);
  r.vars.set('ac.at_arm', 0);
  r.events.emit('at.disc');
  r.run(1);
}
describe('eng probes', () => {
  it('EEC ALTN', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 12000, iasKt: 260, headingTrue: 90 } });
    const v = r.vars;
    manual(r);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0.6);
    r.run(30);
    const a1 = v.get('eng1.n1_pct'), a2 = v.get('eng2.n1_pct');
    v.set(B738.eec(1), 0);
    r.run(20);
    log('EEC ON n1', a1.toFixed(2), a2.toFixed(2), 'EEC1 ALTN n1', v.get('eng1.n1_pct').toFixed(2), v.get('eng2.n1_pct').toFixed(2), 'at_arm', v.get('ac.at_arm'));
  });
  it('approach idle with EAI', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 250, headingTrue: 90 } });
    const v = r.vars;
    manual(r);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0);
    r.run(40);
    const n1 = v.get('eng1.n1_pct');
    v.set(B738.engAi(1), 1); v.set(B738.engAi(2), 1);
    r.run(30);
    const n1b = v.get('eng1.n1_pct');
    v.set(B738.engAi(1), 0); v.set(B738.engAi(2), 0);
    v.set(B738.gearLever, 1);
    r.run(30);
    log('idle N1 clean', n1.toFixed(1), 'EAI on', n1b.toFixed(1), 'gear down EAI off', v.get('eng1.n1_pct').toFixed(1), 'at', v.get('ac.at_arm'));
  });
  it('autobrake RTO select self-test', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(15);
    v.set(B738.autobrake, 0); r.run(3);
    const before = v.get(B738.lt.autoBrakeDisarm);
    v.set(B738.autobrake, -1);
    let lit = 0;
    r.run(4, () => { if (v.get(B738.lt.autoBrakeDisarm)) lit++; });
    log('RTO select: disarm lit frames', lit, 'before', before, 'park', v.get(B738.parkBrake));
  });
  it('wing anti-ice on ground, bleed/pack interplay and ISO', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(3);
    v.set(B738.wingAi, 1);
    r.run(3);
    log('WAI ground: valve cmd', v.get(B738.wingAiValveCmd), 'valve light', v.get(B738.lt.wingAiValve(1)));
    v.set(B738.pack(1), 0);
    r.run(4);
    log('pack L off: iso open', v.get('pneu.iso_open'));
  });
  it('yaw damper B low pressure', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 12000, iasKt: 260, headingTrue: 90 } });
    const v = r.vars;
    r.run(4);
    v.set(B738.hydPump('eng2'), 0); v.set(B738.hydPump('elec1'), 0);
    r.run(20);
    log('B lost: b psi', v.get('hyd.b_psi').toFixed(0), 'yd sw', v.get(B738.ydSw), 'ptu', v.get(B738.ptuCmd), 'stby rud', v.get(B738.stbyRudder));
  });
});
