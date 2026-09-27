import { it } from 'vitest';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { makeRig, posted } from '../helpers';
it('MAN UP limiter probe', () => {
  const r = makeRig('cruise', { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } });
  const v = r.vars;
  r.run(10);
  v.set(V.pressAutoMan, 2);
  v.set(V.pressManAlt, 1);
  for (let i = 0; i < 6; i++) { r.run(5); console.log('[probe] MAN UP t', i * 5, 'cab', v.get('press.cabin_alt_ft').toFixed(0), 'ofv', v.get('press.outflow_pos').toFixed(3), 'rate', v.get('press.cabin_rate_fpm').toFixed(0)); }
  console.log('[probe] CAS', posted(r).filter((x) => /CABIN|PASS|MAN/.test(x)), 'masks', v.get('press.pax_masks'));
});
