import { it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { Brakes } from '../../../src/systems/gear/Brakes';
import { AUTOBRAKE_737NG } from '../../../src/systems/gear/presets';
it('dbg', () => {
  const vars = new SimVars();
  vars.set('gear.air_ground', 1);
  vars.set('hyd.b_psi', 3000);
  vars.set('hyd.a_psi', 3000);
  const b = new Brakes({ vars }, {
    sources: [{ id: 'normal', pressurePsi: 'hyd.b_psi' }, { id: 'alternate', pressurePsi: 'hyd.a_psi' }],
    maxPsi: 3000,
    accumulator: { chargeFrom: 'hyd.b_psi', prechargePsi: 1000, maxPsi: 3000 },
    parking: { var: 'ac.parking_brake', kind: 'hydraulic' },
    antiskid: { enabled: 'ac.antiskid_sw ?? 1' },
    autobrake: { levels: AUTOBRAKE_737NG, thrustIdle: 'ac.tla1 < 0.05', speedbrakeDown: 'ac.speedbrake_lever < 0.05' },
    temperature: { heatCapacityJPerK: 60000 },
  });
  vars.set('gear.air_ground', 0);
  vars.set('ac.autobrake_sel', 2);
  vars.set('ac.tla1', 0);
  b.update(1/60);
  console.log('armed', vars.get('brakes.autobrake_armed'), b.abArmed, vars.getString('brakes.autobrake_mode'), vars.get('brakes.ab_disarm'), vars.get('gear.brake_left'));
});
