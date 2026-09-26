import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { AP, ENG, FDM, SURF, ADC } from '../../src/core/vars';
import { TEST_JET } from '../../src/physics/testAircraft';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { AirDataComputer, Ahrs } from '../../src/systems/sensors';
import { MechanicalFlightControls } from '../../src/systems/flightcontrols';
import { Afcs } from '../../src/systems/autopilot/Afcs';
import { AFCS_GFC700_G3000 } from '../../src/systems/autopilot/presets';
import { makeFdm } from '../physics/helpers';

describe('probe', () => {
  it('AFCS on the real FDM', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    const events = new EventBus();
    for (const i of [1, 2]) vars.set(ENG.fuelOn(i), 1);
    fdm.reposition({ lat: 47.45, lon: -122.31, altFtMsl: 10000, headingTrue: 0, iasKt: 250 });
    const trim = fdm.computeTrim({ iasKt: 250 });
    vars.set(SURF.pitchTrim, trim.pitchTrim);
    const tf = fdm.engines[0] as Turbofan;
    const n1 = tf.n1ForThrust(trim.thrustN / 2, fdm.engineEnv);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), n1);
    fdm.setEnginesRunning(true);
    const env = { vars, events };
    const adc = new AirDataComputer(env, { index: 1 });
    const ahrs = new Ahrs(env, { index: 1, startAligned: true });
    const fcs = new MechanicalFlightControls(env, {});
    const afcs = new Afcs(env, { ...AFCS_GFC700_G3000, yawDamper: undefined });
    const sys = [adc, ahrs, afcs, fcs];
    let step = 0;
    const run = (s: number, each?: (t: number) => void) => {
      const n = Math.round(s * 120);
      for (let i = 0; i < n; i++) {
        if (step++ % 2 === 0) for (const b of sys) b.update(1 / 60);
        fdm.step(1 / 120);
        each?.(i / 120);
      }
    };
    run(2);
    const alt0 = vars.get(ADC.baroAlt(1));
    vars.set(AP.selHeading, vars.get(FDM.headingMag));
    vars.set(AP.selAltitude, alt0);
    afcs.press('AP');
    afcs.press('HDG');
    afcs.press('ALT');
    let maxDev = 0;
    run(60, () => (maxDev = Math.max(maxDev, Math.abs(vars.get(ADC.baroAlt(1)) - alt0))));
    console.log('ALT hold max dev', maxDev, 'bank', vars.get(FDM.bank), 'pitch', vars.get(FDM.pitch));
    // Heading change right 90
    const h0 = vars.get(FDM.headingMag);
    vars.set(AP.selHeading, (h0 + 90) % 360);
    let maxBank = 0;
    let maxAltDev = 0;
    run(90, () => {
      maxBank = Math.max(maxBank, vars.get(FDM.bank));
      maxAltDev = Math.max(maxAltDev, Math.abs(vars.get(ADC.baroAlt(1)) - alt0));
    });
    console.log('HDG', h0, '->', vars.get(FDM.headingMag), 'maxBank', maxBank, 'maxAltDev', maxAltDev, 'bank now', vars.get(FDM.bank));
    // VS climb to +2000 with ALTS capture
    vars.set(AP.selAltitude, alt0 + 2000);
    vars.set(AP.selVs, 1500);
    afcs.press('VS');
    vars.set(AP.selVs, 1500);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), n1 + 8);
    let maxAlt = 0;
    run(150, () => (maxAlt = Math.max(maxAlt, vars.get(ADC.baroAlt(1)))));
    console.log('VS climb: alt', vars.get(ADC.baroAlt(1)), 'target', alt0 + 2000, 'maxAlt', maxAlt, 'mode', afcs.vert, 'vs', vars.get(FDM.vs), 'ias', vars.get(FDM.ias));
    expect(fdm.crashed).toBe(false);
  });
});
