import { it } from 'vitest';
import { rig } from './helpers';
import { writeFileSync } from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-Smart-House/bac8bdb5-ed02-5dee-82cb-3c8efba4f51c/scratchpad/cdu2.txt';

it('explore2', async () => {
  const r = await rig({ companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } });
  let out = '';
  const dump = (t: string) => {
    out += `-- ${t}: page=${r.cdu.pageId} holdAt=${String(r.cdu.state.get('holdAt'))} scratch='${r.cdu.scratch}' err='${r.cdu.entryError}' legs=` + r.fmc.plan.legs.map((l) => `${l.type}:${l.fix?.ident ?? ''}`).join(' ') + '\n';
  };
  r.press('RTE');
  r.enter('TEBBOS', 'L2');
  await new Promise((res) => setTimeout(res, 100));
  r.step(0.2);
  dump('co route');
  out += r.screen().join('\n') + '\n';
  r.press('R6', 'EXEC');
  r.step(0.5);
  dump('exec');
  r.press('HOLD');
  dump('hold key');
  r.type('HFD');
  dump('typed');
  r.press('L6');
  dump('L6');
  out += r.screen().join('\n') + '\n';
  writeFileSync(OUT, out);
}, 60000);
