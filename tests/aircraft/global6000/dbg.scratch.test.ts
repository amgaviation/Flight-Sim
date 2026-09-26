import { it } from 'vitest';
import { makeRig } from './helpers';
it('ids', () => {
  const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 35000, iasKt: 260 } });
  process.stdout.write('\nIDS ' + r.sys.failures.list().map((d) => d.id).join(' ') + '\n');
});
