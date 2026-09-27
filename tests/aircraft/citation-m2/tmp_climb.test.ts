import { it } from 'vitest';
import { AP, FDM } from '../../../src/core/vars';
import { M2, TLA } from '../../../src/aircraft/citation-m2/vars';
import { CLIMB_MTOW } from '../../../src/aircraft/citation-m2/data';
import { makeM2 } from './helpers';
it('measure climb', () => {
  const r = makeM2({ state: 'cruise', fuelLb: 3236, payloadLb: 445, air: { altFtMsl: 1500, iasKt: 200 } });
  const v = r.vars;
  r.run(3.5);
  v.set(M2.tla(1), TLA.clb); v.set(M2.tla(2), TLA.clb);
  v.set(AP.selAltitude, 41000);
  r.sys.afcs.press('AP'); r.sys.afcs.press('FLC'); v.set('ap.sel_spd_kt', 240);
  const f0 = v.get('fuel.total_kg'); let mach = false; let t = 0; let dist = 0;
  const out: string[] = [];
  const marks = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000]; let mi = 0;
  r.run(2400, () => {
    t += 1 / 60; dist += v.get('adc1.tas_kt') / 3600 / 60;
    if (!mach && v.get('adc1.mach') >= 0.64) { r.sys.afcs.press('SPD_MACH'); v.set('ap.sel_mach', 0.64); mach = true; }
    if (mi < marks.length && v.get(FDM.altMsl) >= marks[mi] - 100) {
      out.push(`${marks[mi]} ft t=${(t/60).toFixed(1)} min fuel=${((f0 - v.get('fuel.total_kg'))/0.4536).toFixed(0)} lb dist=${dist.toFixed(0)} nm ff=${(v.get('eng1.ff_pph')+v.get('eng2.ff_pph')).toFixed(0)} n1=${v.get('eng1.n1_pct').toFixed(1)} vs=${v.get(FDM.vs).toFixed(0)} ias=${v.get(FDM.ias).toFixed(0)} M=${v.get(FDM.mach).toFixed(2)} thr=${(v.get('eng1.thrust_lbf')||0).toFixed(0)}`);
      mi++;
    }
    return v.get(FDM.altMsl) > 40950;
  });
  console.log(out.join('\n'), '\nFPG', JSON.stringify(CLIMB_MTOW));
}, 300000);
