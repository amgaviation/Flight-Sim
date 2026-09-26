import { beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { AP, ENG, FDM, SURF, ADC, NAV, GPS, GEAR } from '../../src/core/vars';
import { destinationPoint } from '../../src/core/geo';
import { TEST_JET } from '../../src/physics/testAircraft';
import { Turbofan } from '../../src/physics/engines/Turbofan';
import { AirDataComputer, Ahrs, RadioAltimeter } from '../../src/systems/sensors';
import { MechanicalFlightControls } from '../../src/systems/flightcontrols';
import { Afcs } from '../../src/systems/autopilot/Afcs';
import { AFCS_GFC700_G3000 } from '../../src/systems/autopilot/presets';
import { AFCS_VARS } from '../../src/systems/autopilot/vars';
import { Radios } from '../../src/nav/Radios';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { makeFdm, FlatWorld } from '../physics/helpers';

describe('probe', () => {
  const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
  beforeAll(async () => {
    await db.load();
  }, 60000);

  it.each([['KSFO', '28R'], ['KJFK', '04R'], ['KDEN', '16R'], ['EGLL', '27L']])('ILS %s %s', (icao, rwy) => {
    const r = db.runway(icao, rwy)!;
    const ils = r.ils!;
    const { fdm, vars } = makeFdm(TEST_JET, new FlatWorld((ils.gsElevFt ?? 0) * 0.3048));
    const events = new EventBus();
    for (const i of [1, 2]) vars.set(ENG.fuelOn(i), 1);
    vars.set(SURF.flapsDeg, 15);
    for (const g of [0, 1, 2]) vars.set(GEAR.pos(g), 1);
    const start = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180 + 8, 14);
    const fe = ils.gsElevFt ?? 0;
    fdm.reposition({ lat: start.lat, lon: start.lon, altFtMsl: fe + 2500, headingTrue: ils.courseTrue + 30, iasKt: 160 });
    const trim = fdm.computeTrim({ iasKt: 160 });
    vars.set(SURF.pitchTrim, trim.pitchTrim);
    const tf = fdm.engines[0] as Turbofan;
    const n1 = tf.n1ForThrust(trim.thrustN / 2, fdm.engineEnv);
    for (const i of [1, 2]) vars.set(ENG.n1Cmd(i), n1);
    fdm.setEnginesRunning(true);
    const env = { vars, events };
    const radios = new Radios({ vars, nav: db }, { navCount: 1, adfCount: 0 });
    vars.set(NAV.powered(1), 1);
    vars.set(GPS.powered, 1);
    radios.gps?.forceAcquired();
    vars.set(NAV.activeFreq(1), ils.freqMhz);
    const adc = new AirDataComputer(env, { index: 1 });
    const ahrs = new Ahrs(env, { index: 1, startAligned: true });
    const fcs = new MechanicalFlightControls(env, {});
    const afcs = new Afcs(env, { ...AFCS_GFC700_G3000, yawDamper: undefined });
    const sys = [adc, ahrs, afcs, fcs];
    let step = 0;
    let speedN1 = n1;
    const run = (s: number, each?: (t: number) => void) => {
      const n = Math.round(s * 120);
      for (let i = 0; i < n; i++) {
        if (step % 2 === 0) {
          for (const b of sys) b.update(1 / 60);
          // crude speed hold at 140 KIAS
          speedN1 += (140 - vars.get(ADC.ias(1))) * 0.02 / 60 * 10;
          speedN1 = Math.max(30, Math.min(95, speedN1));
          for (const k of [1, 2]) vars.set(ENG.n1Cmd(k), speedN1);
        }
        fdm.step(1 / 120);
        if (step % 6 === 0) radios.update(0.05);
        step++;
        each?.(i / 120);
      }
    };
    run(3);
    vars.set(AP.selAltitude, Math.round(vars.get(ADC.baroAlt(1))));
    vars.set(AP.selHeading, Math.round(vars.get(FDM.headingMag)));
    afcs.press('AP');
    afcs.press('HDG');
    afcs.press('ALT');
    vars.set(AFCS_VARS.navSource, 1);
    afcs.press('APR');
    let locT = -1, gsT = -1;
    let maxCdiAfter = 0, maxGsAfter = 0;
    let t0 = 0;
    run(400, (t) => {
      if (locT < 0 && afcs.lat === 'LOC') locT = t;
      if (gsT < 0 && afcs.vert === 'GS') gsT = t;
      const agl = vars.get(FDM.altAgl);
      if (gsT >= 0 && t > gsT + 30 && agl > 200) {
        maxCdiAfter = Math.max(maxCdiAfter, Math.abs(vars.get(NAV.cdi(1))));
        maxGsAfter = Math.max(maxGsAfter, Math.abs(vars.get(NAV.gsDev(1))));
      }
      if (agl < 200 && t0 === 0) t0 = t;
      if (Math.abs(t % 10) < 1 / 240 && icao === 'KJFK') console.log(icao, t.toFixed(0), 'rx', vars.get(NAV.received(1)), 'isLoc', vars.get(NAV.isLoc(1)), 'cdi', vars.get(NAV.cdi(1)).toFixed(2), 'dev', vars.get(NAV.devDeg(1)).toFixed(2), 'dist', vars.get(NAV.distNm(1)).toFixed(1), 'armed', afcs.latArmed, afcs.approach, 'hdg', vars.get(FDM.headingMag).toFixed(0), 'gs', vars.get(NAV.gsValid(1)), vars.get(NAV.gsDev(1)).toFixed(2), 'agl', agl.toFixed(0), 'ias', vars.get(FDM.ias).toFixed(0), 'mode', afcs.lat, afcs.vert);
    });
    console.log(icao, rwy, 'LOC at', locT.toFixed(0), 'GS at', gsT.toFixed(0), 'maxCdi', maxCdiAfter.toFixed(3), 'maxGs', maxGsAfter.toFixed(3), '200ft at', t0.toFixed(0), 'mode', afcs.lat, afcs.vert, 'crashed', fdm.crashed, vars.getString(FDM.crashReason));
    expect(fdm.crashed).toBe(false);
  });
});
