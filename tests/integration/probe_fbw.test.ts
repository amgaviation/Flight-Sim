import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { AP, ENG, FDM, SURF, ADC, INPUT } from '../../src/core/vars';
import { TEST_JET } from '../../src/physics/testAircraft';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { AirDataComputer, Ahrs } from '../../src/systems/sensors';
import { FlyByWire } from '../../src/systems/flightcontrols';
import { Afcs } from '../../src/systems/autopilot/Afcs';
import { AFCS_PRIMUS_EPIC } from '../../src/systems/autopilot/presets';
import { makeFdm } from '../physics/helpers';

describe('probe', () => {
  it('FBW on the real FDM', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    const events = new EventBus();
    for (const i of [1, 2]) vars.set(ENG.fuelOn(i), 1);
    fdm.reposition({ lat: 47.45, lon: -122.31, altFtMsl: 15000, headingTrue: 0, iasKt: 250 });
    const trim = fdm.computeTrim({ iasKt: 250 });
    vars.set(SURF.pitchTrim, trim.pitchTrim);
    const n1 = (fdm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fdm.engineEnv);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), n1);
    fdm.setEnginesRunning(true);
    const env = { vars, events };
    vars.set('fcc.powered', 1);
    const adc = new AirDataComputer(env, { index: 1 });
    const ahrs = new Ahrs(env, { index: 1, startAligned: true });
    const f = new FlyByWire(env, { power: 'fcc.powered', pitch: { alphaMax: { x: [0, 35], y: [12, 16] }, vmoKt: 340, mmo: 0.85 }, roll: { maxRateDps: 15, bankHoldDeg: 33, maxBankDeg: 67 } });
    const afcs = new Afcs(env, { ...AFCS_PRIMUS_EPIC });
    const sys = [adc, ahrs, afcs, f];
    let step = 0;
    const run = (s: number, each?: (t: number) => void) => {
      const n = Math.round(s * 120);
      for (let i = 0; i < n; i++) {
        if (step % 2 === 0) for (const b of sys) b.update(1 / 60);
        fdm.step(1 / 120);
        step++;
        each?.(i / 120);
      }
    };
    run(1);
    f.reset();
    const alt0 = vars.get(ADC.baroAlt(1));
    let maxDev = 0;
    run(60, () => (maxDev = Math.max(maxDev, Math.abs(vars.get(ADC.baroAlt(1)) - alt0))));
    console.log('hands off 60s: alt dev', maxDev.toFixed(1), 'pitch', vars.get(FDM.pitch).toFixed(2), 'bank', vars.get(FDM.bank).toFixed(2), 'elev', vars.get(SURF.elevator).toFixed(3), 'stab', vars.get(SURF.pitchTrim).toFixed(3));
    // pull 0.5 for 3 s
    let maxNz = 0;
    vars.set(INPUT.pitch, 0.5);
    run(3, () => (maxNz = Math.max(maxNz, vars.get(FDM.nz))));
    vars.set(INPUT.pitch, 0);
    run(5);
    console.log('pull 0.5: max nz', maxNz.toFixed(2), 'pitch after release', vars.get(FDM.pitch).toFixed(1), 'q', vars.get(FDM.q).toFixed(2));
    // roll right full for 2 s, release
    vars.set(INPUT.roll, 1);
    run(2);
    const p = vars.get(FDM.p);
    vars.set(INPUT.roll, 0);
    run(10);
    console.log('roll: rate at 2s', p.toFixed(1), 'bank held', vars.get(FDM.bank).toFixed(1), 'alt change', (vars.get(ADC.baroAlt(1)) - alt0).toFixed(0));
    // level and engage AP ALT HDG
    vars.set(INPUT.roll, -1); run(1.5); vars.set(INPUT.roll, 0); run(8);
    vars.set(AP.selHeading, Math.round(vars.get(FDM.headingMag)) + 60);
    vars.set(AP.selAltitude, Math.round(vars.get(ADC.baroAlt(1))));
    afcs.press('AP'); afcs.press('HDG'); afcs.press('ALT');
    const a1 = vars.get(ADC.baroAlt(1));
    let maxD = 0, maxB = 0;
    run(60, () => { maxD = Math.max(maxD, Math.abs(vars.get(ADC.baroAlt(1)) - a1)); maxB = Math.max(maxB, Math.abs(vars.get(FDM.bank))); });
    console.log('AP on FBW: alt dev', maxD.toFixed(0), 'max bank', maxB.toFixed(1), 'hdg err', (vars.get(AP.selHeading) - vars.get(FDM.headingMag)).toFixed(1), 'mode', afcs.lat, afcs.vert, f.mode);
    expect(fdm.crashed).toBe(false);
  });
});
