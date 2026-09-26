import { it } from 'vitest';
import { makeB738 } from './helpers';
it('dbg5', () => {
  const r = makeB738({ state: 'cruise', grossKg: 65000, air: { altFtMsl: 35000, iasKt: 263, headingTrue: 90 } });
  const v = r.vars;
  const p = () => console.log(['adc1.valid','ahrs1.valid','ahrs1.att_valid','elec.fcc_a_powered','elec.fcc_b_powered','ac.b738.stab_cutout_ap','ac.mcp.disengage_bar','hyd.a_psi','input.pitch','input.roll','ap.engaged','fail.afcs','elec.dc1_powered','irs1.state','elec.irs1_ac_powered','elec.ac_stby_powered','elec.xfr1_powered'].map((n)=>`${n}=${v.get(n)}`).join(' '));
  p();
  r.run(1); p();
  r.events.emit('ac.mcp.cmd_a'); r.run(0.1); p();
});
