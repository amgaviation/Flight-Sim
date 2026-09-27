/** FUNCTION fidelity probe 4 (read-only audit helper; prints only). */
import { describe, expect, it } from 'vitest';
import { makeRig, posted } from '../helpers';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';

describe('G650 function probe 4', () => {
  it('gear horn', () => {
    const r = makeRig('cruise', { weightLb: 65000, fuelLb: 8000, air: { altFtMsl: 450, iasKt: 160 } });
    r.run(1);
    const g = (n: string) => r.vars.get(n);
    const s0 = `pos0=${g('gear.pos0')} handle=${g(V.gearHandle)} ra=${g('ra1.alt_ft').toFixed(0)} valid=${g('ra1.valid')} idle=${g(V.idleBoth)}`;
    r.vars.set(V.tla(1), 0);
    r.vars.set(V.tla(2), 0);
    r.vars.set(V.gearHandle, 0); r.sys.at.disengage(false);
    r.run(0.2);
    const s1 = `idle=${g(V.idleBoth)} tla=${g(V.tla(1))} flaps=${g('surf.flaps_deg').toFixed(1)} horn=${g('gear.horn')} pos0=${g('gear.pos0').toFixed(2)}`;
    r.run(10);
    // eslint-disable-next-line no-console
    console.log(`[horn] ${s0} || ${s1} || +10s horn=${g('gear.horn')} pos0=${g('gear.pos0').toFixed(2)} ra=${g('ra1.alt_ft').toFixed(0)} idle=${g(V.idleBoth)} tla=${g(V.tla(1)).toFixed(2)} rav=${g('ra1.valid')} rapow=${g('elec.ra_powered')} at=${g('ap.at_engaged')} CAS=${posted(r).join('|')}`);
    expect(true).toBe(true);
  });
});
