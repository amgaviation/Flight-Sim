import { it } from 'vitest';
import { ENG, FDM, SURF, INPUT } from '../../../src/core/vars';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { make172, HandPilot } from './helpers';

for (const mode of ['ball'] as const) it('dbg takeoff ' + mode, () => {
  const r = make172({ variant: 'steam', state: 'takeoff', grossLb: 2400 });
  const v = r.vars;
  const hp = new HandPilot(r);
  r.run(1);
  v.set(C172.throttle, 1);
  let air = false; let tAir = 0; const out: string[] = [];
  r.run(90, (t) => {
    const ias = v.get('adc1.ias_kt');
    if (!air) {
      hp.steer(0); hp.bank(0);
      if (ias >= 55) hp.pitch(9); else v.set(INPUT.pitch, 0);
      if (v.get(FDM.onGround) < 0.5 && v.get(FDM.radioAlt) > 20) { air = true; tAir = t; hp.setYaw(v.get(INPUT.yaw)); }
    } else {
      hp.speed(75);
      if (mode === 'ball') { hp.bank(0); hp.ball(); hp.trim(); }
      else if (mode === 'fixedrud') { hp.bank(0); v.set(INPUT.yaw, 0.012); }
      else { v.set(INPUT.roll, 0); v.set(INPUT.yaw, 0); }
    }
    if (air && Math.round(t * 60) % 60 === 0) out.push(`${(t - tAir).toFixed(0)} ias ${ias.toFixed(1)} ra ${v.get(FDM.radioAlt).toFixed(0)} pitch ${v.get(FDM.pitch).toFixed(1)} vs ${v.get(FDM.vs).toFixed(0)} hdg ${v.get(FDM.headingTrue).toFixed(1)} bank ${v.get(FDM.bank).toFixed(1)} beta ${v.get(FDM.beta).toFixed(2)} p ${v.get(FDM.p).toFixed(2)} r ${v.get(FDM.r).toFixed(2)} ail ${v.get(SURF.aileron).toFixed(3)} rud ${v.get(SURF.rudder).toFixed(3)} trim ${v.get('trim.pitch_units').toFixed(3)} el ${v.get(SURF.elevator).toFixed(3)}`);
  });
  console.log(mode + '\n' + out.filter((_, i) => i % 2 === 0).join('\n'));
});
