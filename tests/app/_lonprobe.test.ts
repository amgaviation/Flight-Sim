import { it } from 'vitest';
import { makeRig } from '../aircraft/citation-longitude/helpers';
it('lon stby', () => {
  const r: any = makeRig('cold_dark');
  const v = r.vars;
  const dump = () => [...v.keys()].filter((k: string) => /stby|batt|elec\.bus/.test(k) && v.get(k) !== 0).map((k: string) => `${k}=${v.get(k)}`).join(' ');
  console.log('t0', dump());
  (r.run ?? r.step)(5);
  console.log('t5', dump());
});
