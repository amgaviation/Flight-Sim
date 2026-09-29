import { describe, it } from 'vitest';
import { makeG1k, cas, type G1kRig } from '../helpers';
import type { SimContext } from '../../../../src/core/SimContext';
import { G1K, G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';
import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/c172g-verify/v2.log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const g = (r: G1kRig, n: string) => r.vars.get(n);
describe('verify2', () => {
  it('USP on ground during AP preflight test', () => {
    const calls: string[] = [];
    const audio = { play: () => undefined, loop: () => ({ setGain: () => undefined, setRate: () => undefined, stop: () => undefined }), callout: (n: string) => void calls.push(n), tone: () => undefined } as unknown as SimContext['audio'];
    const r = makeG1k({ state: 'ready_to_taxi', audio });
    r.run(2);
    log('before', cas(r), 'ias', g(r, 'adc1.ias_kt'));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(0.2);
    const p0 = g(r, 'ap.pitch_ref_deg');
    r.run(6);
    log('after 6s', 'eng', g(r, 'ap.engaged'), 'usp', g(r, G1K.uspActive), 'minspd', g(r, G1K.minSpd), 'cas', cas(r), 'callouts', calls, 'vert', r.vars.getString('ap.vertical_active'), 'pitchref', p0, '->', g(r, 'ap.pitch_ref_deg'), 'elev', g(r, 'surf.elevator').toFixed(3));
  });
});
