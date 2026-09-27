import { it } from 'vitest';
import { FDM, ENG, SURF, GEAR } from '../../../src/core/vars';
import { TEST_PISTON } from '../../../src/physics/testPiston';
import { makeFdm, pistonEngineOn, run, SEA_TAC } from '../../physics/helpers';

it('probe: test piston hands-off takeoff', () => {
  const { fdm, vars } = makeFdm(TEST_PISTON);
  fdm.setStationMass(1, 90);
  fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, onGround: true, headingTrue: 0 });
  pistonEngineOn(vars, fdm, 1);
  vars.set(SURF.flapsDeg, 0);
  let t = 0; let airborne = -1;
  let pI = 0;
  const log: string[] = [];
  run(fdm, 90, () => {
    t += 1 / 120;
    const ias = vars.get(FDM.ias);
    let el = 0;
    if (ias > 55) {
      const target = 8;
      const e = target - fdm.pitchDeg;
      pI += e / 120;
      el = Math.max(-1, Math.min(1, 0.08 * e + 0.02 * pI - 0.03 * vars.get(FDM.q)));
    }
    vars.set(SURF.elevator, el);
    // steer on ground only with pedals to keep heading
    if (vars.get(FDM.onGround) > 0) {
      const hdgErr = ((fdm.headingTrueDeg + 540) % 360) - 180;
      const r = Math.max(-1, Math.min(1, -0.1 * hdgErr - 0.2 * vars.get(FDM.r)));
      vars.set(SURF.rudder, r); vars.set(GEAR.steerDeg, r * 10);
    } else { vars.set(SURF.rudder, 0); vars.set(GEAR.steerDeg, 0); if (airborne < 0) airborne = t; }
    if (Math.round(t * 120) % 240 === 0) log.push(`${t.toFixed(0)}s ias ${ias.toFixed(1)} alt ${vars.get(FDM.altAgl).toFixed(0)} pitch ${fdm.pitchDeg.toFixed(1)} bank ${fdm.bankDeg.toFixed(1)} hdg ${fdm.headingTrueDeg.toFixed(1)} beta ${vars.get(FDM.beta).toFixed(2)} rpm ${vars.get(ENG.rpm(1)).toFixed(0)} vs ${vars.get(FDM.vs).toFixed(0)} gnd ${vars.get(FDM.onGround)}`);
  });
  console.log(`airborne at ${airborne.toFixed(1)}\n` + log.join('\n'));
});
