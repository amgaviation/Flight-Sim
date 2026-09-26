import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, FDM } from '../../../src/core/vars';
import { FT_TO_M, KT_TO_MS, MS_TO_KT } from '../../../src/core/units';
import { isaPressure, isaTemperature, machFromCas, tasFromCas } from '../../../src/physics/atmosphere';
import {
  AirDataComputer,
  Ahrs,
  indicatedAltitudeFt,
  Irs,
  IrsState,
  IRS_ALIGN_TIME_737,
  RadioAltimeter,
  SENSOR_VARS,
  STD_BARO_INHG,
  VacuumSystem,
} from '../../../src/systems/sensors';

const DT = 1 / 60;

/** Writes an ISA air-data truth state (static pressure, CAS, TAT) into the FDM vars. */
function setAir(vars: SimVars, altFt: number, casKt: number): void {
  const H = altFt * FT_TO_M;
  const p = isaPressure(H);
  const T = isaTemperature(H);
  const m = machFromCas(casKt * KT_TO_MS, p);
  vars.set(FDM.staticPressPa, p);
  vars.set(FDM.cas, casKt);
  vars.set(FDM.tat, T * (1 + 0.2 * m * m) - 273.15);
  vars.set(FDM.altMsl, altFt);
}

function runFor(seconds: number, each: (t: number) => void, dt = DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) each(i * dt);
}

describe('AirDataComputer', () => {
  function adc(extra: Partial<ConstructorParameters<typeof AirDataComputer>[1]> = {}) {
    const vars = new SimVars();
    vars.set('bus.avionics', 1);
    const a = new AirDataComputer({ vars }, { index: 1, power: 'bus.avionics', ...extra });
    return { vars, a };
  }

  it('recovers IAS, Mach, TAS, SAT and altitude from ISA truth; valid after the self test', () => {
    const { vars, a } = adc();
    setAir(vars, 5000, 120);
    a.reset();
    a.update(DT);
    expect(vars.get(ADC.valid(1))).toBe(0); // self test running
    runFor(10, () => a.update(DT));
    expect(vars.get(ADC.valid(1))).toBe(1);
    expect(vars.get(ADC.ias(1))).toBeCloseTo(120, 1);
    expect(vars.get(ADC.baroAlt(1))).toBeCloseTo(5000, 0);
    expect(vars.get(SENSOR_VARS.pressAlt(1))).toBeCloseTo(5000, 0);
    const p = isaPressure(5000 * FT_TO_M);
    const T = isaTemperature(5000 * FT_TO_M);
    expect(vars.get(ADC.mach(1))).toBeCloseTo(machFromCas(120 * KT_TO_MS, p), 4);
    expect(vars.get(ADC.tas(1))).toBeCloseTo(tasFromCas(120 * KT_TO_MS, p, T) * MS_TO_KT, 0);
    expect(vars.get(ADC.sat(1))).toBeCloseTo(T - 273.15, 1);
    expect(Math.abs(vars.get(ADC.vs(1)))).toBeLessThan(1);
  });

  it('altimeter setting shifts the indication by the pressure altitude of the setting', () => {
    const { vars, a } = adc();
    setAir(vars, 5000, 120);
    a.reset();
    vars.set(ADC.baroSetting(1), 30.42);
    runFor(5, () => a.update(DT));
    const expected = indicatedAltitudeFt(isaPressure(5000 * FT_TO_M), 30.42);
    expect(vars.get(ADC.baroAlt(1))).toBeCloseTo(expected, 0);
    // Rule of thumb ~1000 ft per inHg near sea level: +0.5 inHg ~ +470 ft.
    expect(vars.get(ADC.baroAlt(1)) - 5000).toBeGreaterThan(430);
    expect(vars.get(ADC.baroAlt(1)) - 5000).toBeLessThan(520);
    vars.set(ADC.baroStd(1), 1);
    runFor(1, () => a.update(DT));
    expect(vars.get(ADC.baroAlt(1))).toBeCloseTo(5000, 0);
    expect(STD_BARO_INHG).toBeCloseTo(29.921, 3);
  });

  it('vertical speed follows a 1000 fpm climb', () => {
    const { vars, a } = adc();
    let alt = 3000;
    setAir(vars, alt, 100);
    a.reset();
    runFor(20, () => {
      alt += (1000 / 60) * DT;
      setAir(vars, alt, 100);
      a.update(DT);
    });
    expect(vars.get(ADC.vs(1))).toBeGreaterThan(970);
    expect(vars.get(ADC.vs(1))).toBeLessThan(1030);
    expect(vars.get(ADC.baroAlt(1))).toBeGreaterThan(alt - 30);
  });

  it('blocked static port: altimeter frozen, VSI zero, ASI under-reads in a climb', () => {
    const { vars, a } = adc();
    let alt = 3000;
    setAir(vars, alt, 100);
    a.reset();
    runFor(5, () => a.update(DT));
    vars.set('fail.adc1.static', 1);
    runFor(1, () => a.update(DT));
    const frozen = vars.get(ADC.baroAlt(1));
    runFor(60, () => {
      alt += (1000 / 60) * DT;
      setAir(vars, alt, 100);
      a.update(DT);
    });
    expect(vars.get(ADC.baroAlt(1))).toBeCloseTo(frozen, 3);
    expect(Math.abs(vars.get(ADC.vs(1)))).toBeLessThan(1);
    expect(vars.get(ADC.ias(1))).toBeLessThan(97);
    expect(vars.get(SENSOR_VARS.staticBlocked(1))).toBe(1);
  });

  it('blocked pitot: with the drain blocked the ASI acts as an altimeter, with the drain open it falls to zero', () => {
    const { vars, a } = adc();
    let alt = 3000;
    setAir(vars, alt, 100);
    a.reset();
    runFor(5, () => a.update(DT));
    vars.set('fail.adc1.pitot', 1);
    runFor(60, () => {
      alt += (1000 / 60) * DT;
      setAir(vars, alt, 100);
      a.update(DT);
    });
    expect(vars.get(ADC.ias(1))).toBeGreaterThan(110);
    expect(vars.get(SENSOR_VARS.pitotBlocked(1))).toBe(1);

    const b = adc({ pitotDrainOpen: true });
    setAir(b.vars, 3000, 100);
    b.a.reset();
    runFor(5, () => b.a.update(DT));
    b.vars.set('fail.adc1.pitot', 1);
    runFor(30, () => b.a.update(DT));
    expect(b.vars.get(ADC.ias(1))).toBeLessThan(5);
  });

  it('alternate static bypasses a blocked port and adds its own (cabin) error', () => {
    const vars = new SimVars();
    vars.set('ac.alt_static', 0);
    const a = new AirDataComputer({ vars }, {
      index: 1,
      alternateStatic: { active: 'ac.alt_static', errorPa: -60 },
    });
    let alt = 3000;
    setAir(vars, alt, 100);
    a.reset();
    runFor(2, () => a.update(DT));
    vars.set('fail.adc1.static', 1);
    runFor(10, () => {
      alt += (1000 / 60) * DT;
      setAir(vars, alt, 100);
      a.update(DT);
    });
    const stuck = vars.get(ADC.baroAlt(1));
    expect(alt - stuck).toBeGreaterThan(150);
    vars.set('ac.alt_static', 1);
    runFor(3, () => a.update(DT));
    expect(vars.get(SENSOR_VARS.altStatic(1))).toBe(1);
    // Lower (cabin) static pressure: altimeter and ASI read high.
    expect(vars.get(ADC.baroAlt(1))).toBeGreaterThan(alt + 10);
    expect(vars.get(ADC.baroAlt(1))).toBeLessThan(alt + 40);
    expect(vars.get(ADC.ias(1))).toBeGreaterThan(100.5);
    // Pneumatic source (no power binding): always valid.
    expect(vars.get(ADC.valid(1))).toBe(1);
  });

  it('digital ADC: unpowered freezes the outputs and flags them; AoA vane jam freezes AoA', () => {
    const { vars, a } = adc();
    setAir(vars, 2000, 110);
    vars.set(FDM.aoa, 4);
    a.reset();
    runFor(5, () => a.update(DT));
    expect(vars.get(SENSOR_VARS.aoa(1))).toBeCloseTo(4, 2);
    vars.set('fail.adc1.aoa', 1);
    vars.set(FDM.aoa, 9);
    runFor(2, () => a.update(DT));
    expect(vars.get(SENSOR_VARS.aoa(1))).toBeCloseTo(4, 2);
    vars.set('bus.avionics', 0);
    setAir(vars, 2500, 130);
    runFor(2, () => a.update(DT));
    expect(vars.get(ADC.valid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.powered(1))).toBe(0);
    expect(vars.get(ADC.ias(1))).toBeCloseTo(110, 0);
    vars.set('bus.avionics', 1);
    a.update(DT);
    expect(vars.get(ADC.valid(1))).toBe(0); // self test again
    runFor(4, () => a.update(DT));
    expect(vars.get(ADC.valid(1))).toBe(1);
    expect(vars.get(ADC.ias(1))).toBeCloseTo(130, 0);
  });
});

describe('Ahrs', () => {
  it('aligns attitude then heading after power-up; magnetometer failure flags heading only', () => {
    const vars = new SimVars();
    vars.set('bus.ess', 0);
    vars.set(FDM.pitch, 2);
    vars.set(FDM.bank, -1);
    vars.set(FDM.headingTrue, 100);
    vars.set(FDM.magVar, 10);
    const ah = new Ahrs({ vars }, { index: 1, power: 'bus.ess' });
    ah.update(DT);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    vars.set('bus.ess', 1);
    runFor(30, () => ah.update(DT));
    expect(vars.get(SENSOR_VARS.aligning(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.alignRemaining(1))).toBeGreaterThan(10);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    runFor(20, () => ah.update(DT));
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.hdgValid(1))).toBe(0);
    expect(vars.get(ADC.pitch(1))).toBeCloseTo(2, 3);
    expect(vars.get(ADC.bank(1))).toBeCloseTo(-1, 3);
    runFor(15, () => ah.update(DT));
    expect(vars.get(SENSOR_VARS.hdgValid(1))).toBe(1);
    expect(vars.get(ADC.ahrsValid(1))).toBe(1);
    expect(vars.get(ADC.headingTrue(1))).toBeCloseTo(100, 3);
    expect(vars.get(ADC.heading(1))).toBeCloseTo(90, 3);
    vars.set('fail.ahrs1.hdg', 1);
    ah.update(DT);
    expect(vars.get(SENSOR_VARS.hdgValid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
    expect(vars.get(ADC.ahrsValid(1))).toBe(0);
  });

  it('publishes body rates and the slip ball; drift failure tilts the attitude without a flag', () => {
    const vars = new SimVars();
    const ah = new Ahrs({ vars }, { index: 1, startAligned: true });
    vars.set(FDM.q, 3);
    vars.set(FDM.nz, 1.2);
    vars.set(FDM.ny, -0.1);
    ah.update(DT);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.q(1))).toBe(3);
    expect(vars.get(SENSOR_VARS.nz(1))).toBe(1.2);
    expect(vars.get(ADC.slip(1))).toBeCloseTo(0.5, 5);
    vars.set('fail.ahrs1.drift', 1);
    runFor(60, () => ah.update(DT));
    expect(vars.get(ADC.bank(1))).toBeCloseTo(2, 1);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
  });
});

describe('Irs (737NG ADIRU)', () => {
  function irs(lat = 45) {
    const vars = new SimVars();
    const events = new EventBus();
    vars.set(FDM.lat, lat);
    vars.set(FDM.lon, -122);
    vars.set(FDM.onGround, 1);
    vars.set(FDM.gs, 0);
    vars.set('bus.ac', 1);
    vars.set('bus.hot_bat', 1);
    const u = new Irs({ vars, events }, { index: 1, power: 'bus.ac', dcBackup: 'bus.hot_bat' });
    return { vars, events, u };
  }

  it('alignment time depends on latitude; NAV requires a present-position entry', () => {
    const { vars, events, u } = irs(45);
    const tAlign = 300 + (45 / 70) * 300;
    vars.set(SENSOR_VARS.irsModeSel(1), 2);
    u.update(1);
    expect(u.state).toBe(IrsState.Aligning);
    expect(u.alignRemaining).toBeCloseTo(tAlign - 1, 0);
    expect(vars.get(SENSOR_VARS.irsOnDc(1))).toBe(1); // power-up DC test
    expect(vars.get(SENSOR_VARS.irsAlignLight(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    runFor(10, () => u.update(1), 1);
    expect(vars.get(SENSOR_VARS.irsOnDc(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.irsDcFail(1))).toBe(0);
    runFor(tAlign, () => u.update(1), 1);
    // Alignment complete but no position: ALIGN flashes.
    expect(u.state).toBe(IrsState.Aligning);
    expect(vars.get(SENSOR_VARS.irsAlignLight(1))).toBe(2);
    events.emit('irs.pos_entry');
    u.update(1);
    expect(u.state).toBe(IrsState.Nav);
    expect(vars.get(SENSOR_VARS.irsNavValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.irsAlignLight(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.irsLat(1))).toBeCloseTo(45, 6);
    expect(IRS_ALIGN_TIME_737.y[1]).toBe(600);
  });

  it('motion during alignment restarts it and flashes ALIGN', () => {
    const { vars, u } = irs(20);
    vars.set(SENSOR_VARS.irsModeSel(1), 2);
    runFor(200, () => u.update(1), 1);
    const left = u.alignRemaining;
    vars.set(FDM.gs, 5);
    u.update(1);
    expect(u.alignRemaining).toBeGreaterThan(left + 150);
    expect(vars.get(SENSOR_VARS.irsAlignLight(1))).toBe(2);
  });

  it('runs on DC when AC is lost; loses the alignment with no power at all', () => {
    const { vars, u } = irs();
    vars.set(SENSOR_VARS.irsModeSel(1), 2);
    u.forceAligned();
    u.update(DT);
    expect(u.state).toBe(IrsState.Nav);
    vars.set('bus.ac', 0);
    u.update(DT);
    expect(u.state).toBe(IrsState.Nav);
    expect(vars.get(SENSOR_VARS.irsOnDc(1))).toBe(1);
    vars.set('bus.hot_bat', 0);
    u.update(DT);
    expect(u.state).toBe(IrsState.Off);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    vars.set('bus.ac', 1);
    u.update(DT);
    expect(u.state).toBe(IrsState.Aligning);
  });

  it('pure-inertial position error grows about 2 nm/h in flight', () => {
    const { vars, u } = irs();
    vars.set(SENSOR_VARS.irsModeSel(1), 2);
    u.forceAligned();
    vars.set(FDM.onGround, 0);
    vars.set(FDM.gs, 450);
    runFor(3600, () => u.update(1), 1);
    expect(vars.get(SENSOR_VARS.irsPosErr(1))).toBeCloseTo(2, 1);
    const dLat = Math.abs(vars.get(SENSOR_VARS.irsLat(1)) - 45) * 60;
    expect(dLat).toBeLessThan(2.1);
  });

  it('ATT mode: attitude after 30 s level, heading only after a manual entry', () => {
    const { vars, events, u } = irs();
    vars.set(FDM.onGround, 0);
    vars.set(FDM.headingMag, 270);
    vars.set(FDM.headingTrue, 285);
    vars.set(FDM.magVar, 15);
    vars.set(SENSOR_VARS.irsModeSel(1), 3);
    runFor(20, () => u.update(DT));
    expect(u.state).toBe(IrsState.Att);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    runFor(15, () => u.update(DT));
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.hdgValid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.irsNavValid(1))).toBe(0);
    events.emit('irs1.hdg_entry', 265);
    u.update(DT);
    expect(vars.get(SENSOR_VARS.hdgValid(1))).toBe(1);
    expect(vars.get(ADC.heading(1))).toBeCloseTo(265, 1);
  });

  it('fault failure lights FAULT and invalidates the outputs', () => {
    const { vars, u } = irs();
    vars.set(SENSOR_VARS.irsModeSel(1), 2);
    u.forceAligned();
    u.update(DT);
    vars.set('fail.irs1', 1);
    u.update(DT);
    expect(vars.get(SENSOR_VARS.irsFault(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.attValid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.irsNavValid(1))).toBe(0);
    u.dispose();
  });
});

describe('RadioAltimeter', () => {
  it('tracks the height, goes NCD above 2500 ft or at steep bank, flags when failed', () => {
    const vars = new SimVars();
    vars.set(FDM.radioAlt, 1500);
    const ra = new RadioAltimeter({ vars }, { index: 1 });
    ra.update(DT);
    expect(vars.get(SENSOR_VARS.raValid(1))).toBe(0); // power-up self test
    runFor(3, () => ra.update(DT));
    expect(vars.get(SENSOR_VARS.raValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.raAlt(1))).toBeCloseTo(1500, 1);
    vars.set(FDM.radioAlt, 3000);
    runFor(2, () => ra.update(DT));
    expect(vars.get(SENSOR_VARS.raNcd(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.raValid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.raAlt(1))).toBe(2500);
    vars.set(FDM.radioAlt, 800);
    vars.set(FDM.bank, 45);
    runFor(2, () => ra.update(DT));
    expect(vars.get(SENSOR_VARS.raNcd(1))).toBe(1);
    vars.set(FDM.bank, 10);
    ra.update(DT);
    expect(vars.get(SENSOR_VARS.raValid(1))).toBe(1);
    expect(vars.get(SENSOR_VARS.raAlt(1))).toBeCloseTo(800, 0);
    vars.set('fail.ra1', 1);
    ra.update(DT);
    expect(vars.get(SENSOR_VARS.raValid(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.raNcd(1))).toBe(0);
  });
});

describe('VacuumSystem (172S)', () => {
  it('regulates suction into the green arc and lights LOW VACUUM below 3.0 inHg', () => {
    const vars = new SimVars();
    vars.set('eng1.vacuum_inhg', 4.9);
    const vac = new VacuumSystem({ vars });
    vac.reset();
    expect(vars.get(SENSOR_VARS.vacSuction)).toBeCloseTo(4.9, 5);
    vars.set('eng1.vacuum_inhg', 6.5);
    runFor(5, () => vac.update(DT));
    expect(vars.get(SENSOR_VARS.vacSuction)).toBeCloseTo(5.3, 2);
    expect(vars.get(SENSOR_VARS.vacLow)).toBe(0);
    expect(vars.get(SENSOR_VARS.vacPumpOk(1))).toBe(1);
    vars.set('fail.vac.pump1', 1);
    runFor(5, () => vac.update(DT));
    expect(vars.get(SENSOR_VARS.vacSuction)).toBeLessThan(0.1);
    expect(vars.get(SENSOR_VARS.vacLow)).toBe(1);
    expect(vars.get(SENSOR_VARS.vacPumpOk(1))).toBe(0);
    vars.set('fail.vac.pump1', 0);
    vars.set('fail.vac.leak', 1);
    runFor(5, () => vac.update(DT));
    expect(vars.get(SENSOR_VARS.vacSuction)).toBeCloseTo(5.3 * 0.4, 2);
    expect(vars.get(SENSOR_VARS.vacLow)).toBe(1);
  });

  it('twin pumps: one failure keeps suction (Citation-style dual source)', () => {
    const vars = new SimVars();
    vars.set('eng1.vacuum_inhg', 5.5);
    vars.set('eng2.vacuum_inhg', 5.5);
    const vac = new VacuumSystem({ vars }, { pumps: [{ suction: 'eng1.vacuum_inhg' }, { suction: 'eng2.vacuum_inhg' }] });
    vac.reset();
    vars.set('fail.vac.pump1', 1);
    runFor(3, () => vac.update(DT));
    expect(vars.get(SENSOR_VARS.vacSuction)).toBeCloseTo(5.3, 2);
    expect(vars.get(SENSOR_VARS.vacPumpOk(1))).toBe(0);
    expect(vars.get(SENSOR_VARS.vacPumpOk(2))).toBe(1);
  });
});

