import { it } from 'vitest';
import { ENG, FDM, GEAR, SURF, ENV, INPUT } from '../../src/core/vars';
import { TEST_JET } from '../../src/physics/testAircraft';
import { TEST_PISTON } from '../../src/physics/testPiston';
import { makeFdm, run, horizDist, jetEnginesOn, pistonEngineOn } from '../physics/helpers';

it('landing roll & taxi probes', () => {
  {
    const { fdm, vars } = makeFdm(TEST_JET, undefined, 0.3);
    fdm.reposition({ lat: 47.45, lon: -122.31, onGround: true, headingTrue: 0 });
    jetEnginesOn(vars, fdm, 0);
    // put it at 120 kt on the runway
    fdm.vNed.set(120 * 0.5144, 0, 0);
    vars.set(SURF.groundSpoilers, 1);
    vars.set(GEAR.brakeLeft, 1); vars.set(GEAR.brakeRight, 1);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    let t = 0;
    run(fdm, 60, (tt) => { if (vars.get(FDM.gs) < 1 && t === 0) t = tt; });
    console.log('jet 120 kt max braking + spoilers: stop dist m', horizDist(p0, fdm).toFixed(0), 'time', t.toFixed(1), 'hdg', vars.get(FDM.headingTrue).toFixed(1), 'crashed', fdm.crashed);
  }
  {
    const { fdm, vars } = makeFdm(TEST_JET, undefined, 0.3);
    vars.set(ENV.surfaceWindDir, 90); vars.set(ENV.surfaceWindKt, 25);
    fdm.reposition({ lat: 47.45, lon: -122.31, onGround: true, headingTrue: 0 });
    jetEnginesOn(vars, fdm, 0);
    fdm.vNed.set(100 * 0.5144, 0, 0);
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    run(fdm, 10);
    console.log('jet 100 kt, 25 kt direct crosswind from the right, no inputs, 10 s: hdg', vars.get(FDM.headingTrue).toFixed(1), '(weathervane should turn right into wind)', 'track', vars.get(FDM.trackTrue).toFixed(1), 'bank', vars.get(FDM.bank).toFixed(2));
  }
  {
    const { fdm, vars } = makeFdm(TEST_PISTON);
    fdm.reposition({ lat: 47.45, lon: -122.31, onGround: true, headingTrue: 0 });
    pistonEngineOn(vars, fdm, 0.35);
    vars.set(GEAR.steerDeg, 15);
    run(fdm, 30);
    console.log('172 taxi, steer +15 (right), 30 s: hdg', vars.get(FDM.headingTrue).toFixed(1), 'gs', vars.get(FDM.gs).toFixed(1), 'rpm', vars.get(ENG.rpm(1)).toFixed(0));
  }
  {
    const { fdm, vars } = makeFdm(TEST_PISTON);
    fdm.reposition({ lat: 47.45, lon: -122.31, onGround: true, headingTrue: 0 });
    pistonEngineOn(vars, fdm, 1);
    let lift = 0;
    const p0 = { lat: fdm.lat, lon: fdm.lon };
    run(fdm, 60, (t) => {
      if (vars.get(FDM.ias) > 55) vars.set(SURF.elevator, 0.35); 
      if (lift === 0 && vars.get(FDM.onGround) === 0) lift = t;
    });
    console.log('172 full power takeoff: liftoff t', lift.toFixed(1), 'hdg', vars.get(FDM.headingTrue).toFixed(1), 'alt agl', vars.get(FDM.altAgl).toFixed(0), 'ias', vars.get(FDM.ias).toFixed(0), 'vs', vars.get(FDM.vs).toFixed(0), 'bank', vars.get(FDM.bank).toFixed(1), 'crashed', fdm.crashed, vars.getString(FDM.crashReason));
  }
});
