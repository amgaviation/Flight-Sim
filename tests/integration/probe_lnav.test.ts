import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { AP, ENG, FDM, SURF, ADC, FMS, GPS } from '../../src/core/vars';
import { destinationPoint, distanceNm } from '../../src/core/geo';
import { TEST_JET } from '../../src/physics/testAircraft';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { AirDataComputer, Ahrs } from '../../src/systems/sensors';
import { MechanicalFlightControls } from '../../src/systems/flightcontrols';
import { Afcs } from '../../src/systems/autopilot/Afcs';
import { AFCS_GFC700_G3000 } from '../../src/systems/autopilot/presets';
import { GpsReceiver } from '../../src/nav/radios/GpsReceiver';
import { Fms } from '../../src/nav/fms/Fms';
import { FlightPlan, makeLeg } from '../../src/nav/flightplan/FlightPlan';
import type { NavDatabase, Waypoint } from '../../src/nav/types';
import { makeFdm } from '../physics/helpers';

const w = (ident: string, p: { lat: number; lon: number }): Waypoint => ({ ident, lat: p.lat, lon: p.lon, kind: 'fix' });
const noDb = { ready: true, airportsNear: () => [{}], resolve: () => [] } as unknown as NavDatabase;

describe('probe', () => {
  it('LNAV on the real FDM', () => {
    const { fdm, vars } = makeFdm(TEST_JET);
    const events = new EventBus();
    for (const i of [1, 2]) vars.set(ENG.fuelOn(i), 1);
    const A = { lat: 47.45, lon: -122.31 };
    fdm.reposition({ lat: A.lat, lon: A.lon, altFtMsl: 10000, headingTrue: 0, iasKt: 250 });
    const trim = fdm.computeTrim({ iasKt: 250 });
    vars.set(SURF.pitchTrim, trim.pitchTrim);
    const n1 = (fdm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fdm.engineEnv);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), n1);
    fdm.setEnginesRunning(true);
    const env = { vars, events };
    vars.set(GPS.powered, 1);
    const gps = new GpsReceiver(vars);
    gps.forceAcquired();
    const fms = new Fms({ vars, events, nav: noDb }, { style: 'garmin', bankLimitDeg: 25 });
    const B = destinationPoint(A.lat, A.lon, 60, 15);
    const C = destinationPoint(B.lat, B.lon, 150, 20);
    const p = new FlightPlan('garmin');
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', C) }),
    ];
    p.normalize();
    fms.plans.replace(p);
    if (fms.plans.pending) fms.plans.exec();
    const adc = new AirDataComputer(env, { index: 1 });
    const ahrs = new Ahrs(env, { index: 1, startAligned: true });
    const fcs = new MechanicalFlightControls(env, {});
    const afcs = new Afcs(env, { ...AFCS_GFC700_G3000, yawDamper: undefined });
    const sys = [adc, ahrs, afcs, fcs];
    let step = 0;
    const run = (s: number, each?: (t: number) => void) => {
      const n = Math.round(s * 120);
      for (let i = 0; i < n; i++) {
        if (step % 2 === 0) for (const b of sys) b.update(1 / 60);
        fdm.step(1 / 120);
        if (step % 6 === 0) {
          gps.update(0.05);
          fms.update(0.05);
        }
        step++;
        each?.(i / 120);
      }
    };
    run(2);
    vars.set(AP.selAltitude, vars.get(ADC.baroAlt(1)));
    afcs.press('AP');
    afcs.press('ALT');
    afcs.press('NAV');
    let maxXtk = 0;
    let legs: number[] = [];
    run(600, (t) => {
      const l = vars.get(FMS.activeLegIndex);
      if (legs[legs.length - 1] !== l) legs.push(l);
      if (t > 150) maxXtk = Math.max(maxXtk, Math.abs(vars.get(FMS.xtkNm)));
      if (Math.abs(t % 20) < 1 / 240) console.log(t.toFixed(0), 'leg', vars.get(FMS.activeLegIndex), 'xtk', vars.get(FMS.xtkNm).toFixed(2), 'trk', vars.get(FDM.trackTrue).toFixed(0), 'dtk', vars.get(FMS.desiredTrackTrue).toFixed(0), 'bankcmd', vars.get(FMS.lnavBankCmd).toFixed(1), 'bank', vars.get(FDM.bank).toFixed(1), 'dB', distanceNm(vars.get(FDM.lat), vars.get(FDM.lon), B.lat, B.lon).toFixed(1), 'gs', vars.get(FDM.gs).toFixed(0), 'lat', afcs.lat);
    });
    console.log('lat mode', afcs.lat, 'legs', legs, 'maxXtk after capture', maxXtk.toFixed(3), 'dist to C', distanceNm(vars.get(FDM.lat), vars.get(FDM.lon), C.lat, C.lon).toFixed(2), 'trk', vars.get(FDM.trackTrue).toFixed(1));
    expect(fdm.crashed).toBe(false);
  });
});
