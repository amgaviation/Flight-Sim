import { it } from 'vitest';
import { FDM } from '../../../src/core/vars';
import { makeB738 } from './helpers';
it('dbg', () => {
  const r = makeB738({ state: 'cruise', grossKg: 65000, air: { altFtMsl: 35000, iasKt: 263, headingTrue: 90 } });
  const v = r.vars;
  const names = ['fdm.alt_msl_ft','fdm.ias_kt','fdm.tas_kt','fdm.mach','fdm.vs_fpm','fdm.pitch_deg','fdm.bank_deg','eng1.n1_pct','eng1.ff_pph','ac.b738.tla1','trim.pitch_units','ap.engaged','ap.at_engaged','fdm.mass_kg'];
  console.log(v.getString('ap.lat_active'), v.getString('ap.vert_active'), v.getString('ap.at_mode'));
  for (let k = 0; k < 8; k++) {
    r.run(15);
    console.log(names.map((n)=>`${n.split('.')[1]}=${v.get(n).toFixed(2)}`).join(' '), v.getString('ap.vert_active'), v.getString('ap.at_mode'));
  }
  void FDM;
});
