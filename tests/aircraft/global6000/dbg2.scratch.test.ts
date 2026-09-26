import { it } from 'vitest';
import { makeRig, FIELD } from './helpers';
import { G6K_VARS as V } from '../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, vSpeeds } from '../../../src/aircraft/global6000/data';
it('dbg hyd', { timeout: 200000 }, () => {
  const w = G6K_LIMITS.mtowLb;
  const r = makeRig('takeoff', { weightLb: w, field: { ...FIELD, elevFt: 0 } });
  const v = r.vars;
  const s = vSpeeds(w);
  v.set(V.tla(1), 1); v.set(V.tla(2), 1);
  r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: FIELD.courseTrue, pitchDeg: 11 });
  let k = 0;
  const log = (t: number) => process.stdout.write('\n' + `t ${t.toFixed(1)} agl ${v.get('fdm.alt_agl_ft').toFixed(0)} p3 ${v.get('hyd.sys3_psi').toFixed(0)} q3 ${v.get('hyd.sys3_qty').toFixed(2)} cmd3a ${v.get(V.acmpCmd('3a'))} cmd3b ${v.get(V.acmpCmd('3b'))} on3a ${v.get('hyd.pump3a_on')} pw3a ${v.get('elec.acmp3a_powered')} pw3b ${v.get('elec.acmp3b_powered')} acb4 ${v.get('elec.ac_bus4_powered')} acb1 ${v.get('elec.ac_bus1_powered')} f3a ${v.get('hyd.pump3a_flow_lpm').toFixed(1)} f3b ${v.get('hyd.pump3b_flow_lpm')?.toFixed(1)} gear ${v.get('gear.handle')} ${v.get('gear.pos')} rat ${v.get(V.ratDeployed)}`);
  r.run(90, (t) => { if (k++ % 120 === 0) log(t); return v.get('fdm.alt_agl_ft') > 1500; });
  r.pilot.stop(); v.set(V.flapLever, 0); v.set(V.gearHandle, 0);
  r.run(30, (t) => { if (k++ % 60 === 0) log(t); });
});
