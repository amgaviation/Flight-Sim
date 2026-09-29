/**
 * Read-only procedures probe (auditor): evaluates every normal checklist item against each preset.
 */
import { describe, it } from 'vitest';
import { B738_CHECKLISTS } from '../../../../src/aircraft/b737-800/checklists';
import { makeB738 } from '../helpers';
import type { InitialState } from '../../../../src/aircraft/types';

import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/b737/probe.log', a.map(String).join(' ') + '\n');
const air: Record<string, { altFtMsl: number; iasKt: number } | undefined> = { cruise: { altFtMsl: 35000, iasKt: 270 }, approach: { altFtMsl: 3000, iasKt: 160 } };

describe('checklist probe', () => {
  for (const s of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
    it(s, () => {
      const r = makeB738({ state: s, air: air[s] });
      r.run(8);
      const out: string[] = [];
      for (const c of B738_CHECKLISTS) {
        const res = c.items.map((it) => `${it.challenge}:${it.check ? (it.check(r.vars) ? 'Y' : 'n') : '-'}`);
        out.push(`${c.title} [${res.join(' | ')}]`);
      }
      log(s, '\n  ' + out.join('\n  '));
      const names = ['ac.b738.lt.master_caution', 'ac.fmc.v1_kt', 'ac.fmc.perf_valid', 'ac.fmc.vref_kt', 'ap.sel_spd_kt', 'trim.pitch_units', 'trim.pitch_to_ok', 'ac.b738.xfr1_src', 'ac.b738.pack1', 'ac.b738.bleed1', 'ac.b738.door_flt_deck', 'adc1.baro_std', 'adc2.baro_std', 'adc1.baro_inhg', 'adc2.baro_inhg', 'xpdr.mode', 'ac.b738.xpdr_mode_sel', 'ac.b738.lt.le_flaps_ext', 'surf.flaps_deg', 'ac.at_arm', 'ap.fd1', 'fd.on'];
      log(s, names.map((n) => `${n}=${r.vars.has(n) ? r.vars.get(n) : 'NA'}`).join(' '));
      const six: string[] = [];
      for (const k of r.vars.keys?.() ?? []) if (String(k).startsWith('ac.b738.lt.') && r.vars.get(k) !== 0) six.push(String(k));
      log(s, 'lit lights:', six.join(' '));
    });
  }
});
