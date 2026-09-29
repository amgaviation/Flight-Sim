import { describe, it } from 'vitest';
import { makeG1k } from '../helpers';
import { G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';
import { AP } from '../../../../src/core/vars';
import { appendFileSync, mkdirSync } from 'node:fs';
mkdirSync('/tmp/ref/c172g-verify', { recursive: true });
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/c172g-verify/v3.log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
describe('verify3', () => {
  it('modes on ground AP engage', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(2);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(0.5);
    log('vert', r.vars.getString(AP.verticalActive), 'lat', r.vars.getString(AP.lateralActive), 'fd', r.vars.get('ap.fd_on'), 'eng', r.vars.get(AP.engaged));
  });
});
