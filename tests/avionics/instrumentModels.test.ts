import { describe, expect, it } from 'vitest';
import { AttitudeGyro, DirectionalGyro, EARTH_RATE_DEG_H, TurnGyro, vacuumRotorDrive } from '../../src/avionics/analog/models/gyro';
import { InclinometerBall } from '../../src/avionics/analog/models/inclinometer';
import { CompassModel } from '../../src/avionics/analog/models/compass';
import { altimeterPointers, indicatedAltitudeFt, kollsmanDrumAngle, pressureAltitudeFt, pressureAtAltitudeInHg } from '../../src/avionics/analog/models/altimeter';
import { alignedFactor, densityRatio, oatMarkDeg, paMarkDeg, ringRotationDeg, tasFactor } from '../../src/avionics/analog/models/tasRing';
import { TwinGauge } from '../../src/avionics/analog/instruments/TwinGauge';

const dt = 1 / 60;
const R = Math.PI / 180;
/** Specific force (g) in body axes for unaccelerated flight at pitch/bank (deg): f = -g rotated into the body. */
function steady(pitch: number, bank: number): [number, number, number] {
  return [Math.sin(pitch * R), -Math.sin(bank * R) * Math.cos(pitch * R), Math.cos(bank * R) * Math.cos(pitch * R)];
}

describe('vacuum attitude gyro', () => {
  it('spins up from rest and erects to the true attitude within a few minutes', () => {
    const g = new AttitudeGyro({ seed: 3 });
    g.setStopped(2, 0);
    expect(Math.abs(g.bank)).toBeGreaterThan(10); // horizon lies tilted with the rotor stopped
    const drive = vacuumRotorDrive(5.0);
    const [nx, ny, nz] = steady(2, 0);
    for (let t = 0; t < 8 * 60; t += dt) g.update(2, 0, nx, ny, nz, drive, dt);
    expect(g.rotor.speed).toBeGreaterThan(0.99);
    expect(Math.abs(g.pitch - 2)).toBeLessThan(1.5);
    expect(Math.abs(g.bank)).toBeLessThan(1.5);
    expect(g.erecting).toBe(false);
  });

  it('follows attitude changes while rigid', () => {
    const g = new AttitudeGyro({ seed: 3 });
    g.setSpunUp(0, 0);
    const drive = vacuumRotorDrive(5.0);
    const [nx, ny, nz] = steady(10, 20);
    for (let t = 0; t < 2; t += dt) g.update(10, 20, nx, ny, nz, drive, dt);
    expect(g.pitch).toBeCloseTo(10, 0);
    expect(g.bank).toBeCloseTo(20, 0);
  });

  it('shows only a few degrees of bank error after a 360-degree standard-rate turn', () => {
    const g = new AttitudeGyro({ seed: 5 });
    g.setSpunUp(0, 20);
    const drive = vacuumRotorDrive(5.0);
    // Coordinated 20 deg bank turn for 2 min: apparent vertical along the body z axis.
    const nz = 1 / Math.cos((20 * Math.PI) / 180);
    for (let t = 0; t < 120; t += dt) g.update(0, 20, 0, 0, nz, drive, dt);
    const err = g.bank - 20;
    expect(err).toBeLessThan(0); // erection toward the apparent vertical shows LESS bank
    expect(Math.abs(err)).toBeGreaterThan(1);
    expect(Math.abs(err)).toBeLessThan(6);
  });

  it('tumbles beyond its gimbal limits and recovers slowly', () => {
    const g = new AttitudeGyro({ seed: 9 });
    g.setSpunUp(0, 0);
    const drive = vacuumRotorDrive(5.0);
    for (let t = 0; t < 1; t += dt) g.update(0, 120, 0, 0, 1, drive, dt);
    expect(g.tumbled).toBe(true);
    for (let t = 0; t < 30; t += dt) g.update(0, 0, 0, 0, 1, drive, dt);
    expect(Math.abs(g.bank) + Math.abs(g.pitch)).toBeGreaterThan(5); // still wrong after 30 s
    for (let t = 0; t < 12 * 60; t += dt) g.update(0, 0, 0, 0, 1, drive, dt);
    expect(Math.abs(g.bank)).toBeLessThan(2);
    expect(Math.abs(g.pitch)).toBeLessThan(2);
  });

  it('stops following the aircraft after vacuum loss', () => {
    const g = new AttitudeGyro({ seed: 1 });
    g.setSpunUp(0, 0);
    for (let t = 0; t < 15 * 60; t += 0.05) g.update(0, 0, 0, 0, 1, 0, 0.05);
    expect(g.rotor.speed).toBeLessThan(0.02);
    const before = g.bank;
    for (let t = 0; t < 2; t += dt) g.update(0, 30, 0, 0, 1, 0, dt);
    expect(Math.abs(g.bank - before)).toBeLessThan(3); // a 30 deg bank is not shown
  });
});

describe('directional gyro', () => {
  it('drifts at friction bias plus uncompensated earth rate', () => {
    const g = new DirectionalGyro({ seed: 4, driftMinDegH: 5, driftMaxDegH: 5 });
    g.setSpunUp(90);
    const lat = 45;
    for (let t = 0; t < 3600; t += 0.5) g.update(90, 0, 0, lat, 1, 0.5);
    const expected = g.biasDegH + EARTH_RATE_DEG_H * Math.sin((lat * Math.PI) / 180);
    expect(g.err).toBeCloseTo(expected, 0);
    expect(Math.abs(g.err)).toBeLessThan(20); // PHAK: errors up to ~15 deg/h
  });

  it('adjust knob resets the card', () => {
    const g = new DirectionalGyro({ seed: 2 });
    g.setSpunUp(180, 12);
    g.adjust(-12);
    expect(g.err).toBeCloseTo(0, 9);
    expect(g.heading).toBeCloseTo(180, 9);
  });

  it('card turns with the case when the rotor is stopped', () => {
    const g = new DirectionalGyro({ seed: 2 });
    g.setStopped(100);
    const h0 = g.heading;
    for (let t = 0; t < 10; t += dt) g.update(100 + t * 3, 0, 0, 40, 0, dt);
    expect(Math.abs(((g.heading - h0 + 540) % 360) - 180)).toBeLessThan(1);
  });
});

describe('turn coordinator', () => {
  it('places the wing on the standard-rate mark in a coordinated standard-rate turn', () => {
    const tc = new TurnGyro({ standardMarkDeg: 17, calibrationBankDeg: 15 });
    tc.setSpunUp();
    const bank = (15 * Math.PI) / 180;
    // Coordinated 3 deg/s turn: p = 0, r = omega cos(bank).
    for (let t = 0; t < 3; t += dt) tc.update(0, 3 * Math.cos(bank), 28, dt);
    expect(tc.symbolDeg).toBeCloseTo(17, 1);
    expect(tc.flag).toBe(false);
  });

  it('responds to roll rate (canted gimbal) before any yaw develops', () => {
    const tc = new TurnGyro();
    tc.setSpunUp();
    expect(tc.target(10, 0, 1)).toBeGreaterThan(0);
    expect(tc.target(-10, 0, 1)).toBeLessThan(0);
  });

  it('shows the OFF flag and winds down without power', () => {
    const tc = new TurnGyro({ minVolts: 18 });
    tc.setSpunUp();
    tc.update(0, 3, 12, dt);
    expect(tc.flag).toBe(true);
    for (let t = 0; t < 600; t += 0.1) tc.update(0, 3, 0, 0.1);
    expect(tc.rotor.speed).toBeLessThan(0.01);
    expect(Math.abs(tc.symbolDeg)).toBeLessThan(0.5);
  });
});

describe('inclinometer ball', () => {
  it('centres in a coordinated turn and deflects opposite to the side force', () => {
    const b = new InclinometerBall();
    for (let t = 0; t < 2; t += dt) b.update(0, 1.15, dt);
    expect(Math.abs(b.angleDeg)).toBeLessThan(0.01);
    // Side force to the left (ny < 0) pushes the ball to the right.
    for (let t = 0; t < 3; t += dt) b.update(-0.1, 1, dt);
    expect(b.angleDeg).toBeCloseTo(InclinometerBall.equilibriumDeg(-0.1, 1), 1);
    expect(b.angleDeg).toBeGreaterThan(5);
  });

  it('stops at the end of the tube', () => {
    const b = new InclinometerBall({ limitDeg: 16 });
    for (let t = 0; t < 3; t += dt) b.update(1, 1, dt);
    expect(b.angleDeg).toBeCloseTo(-16, 6);
    expect(b.normalized).toBeCloseTo(-1, 6);
  });

  it('settles within about a second (fluid damping)', () => {
    const b = new InclinometerBall();
    let t = 0;
    for (; t < 3; t += dt) {
      b.update(-0.05, 1, dt);
      if (Math.abs(b.angleDeg - InclinometerBall.equilibriumDeg(-0.05, 1)) < 0.1) break;
    }
    expect(t).toBeLessThan(1.2);
  });
});

describe('magnetic compass', () => {
  const dip = 65; // northern mid-latitudes

  it('reads the magnetic heading in level unaccelerated flight', () => {
    const c = new CompassModel({ deviation: [] });
    for (const h of [0, 45, 90, 180, 270, 333]) expect(c.equilibriumReading(h, 0, 0, 0, 0, 1, dip)).toBeCloseTo(h % 360, 6);
  });

  it('northerly turning error: turning right from north first shows a turn to the left', () => {
    const c = new CompassModel({ deviation: [] });
    const nz = 1 / Math.cos((20 * Math.PI) / 180);
    const r = c.equilibriumReading(0, 0, 20, 0, 0, nz, dip);
    expect(r).toBeGreaterThan(300);
    // Through south the compass leads (shows more than the heading).
    const s = c.equilibriumReading(180, 0, 20, 0, 0, nz, dip);
    expect(s).toBeGreaterThan(185);
    // East/west headings in a bank show little error.
    expect(Math.abs(c.equilibriumReading(90, 0, 20, 0, 0, nz, dip) - 90)).toBeLessThan(5);
  });

  it('acceleration error: accelerate north, decelerate south (ANDS) on an east heading', () => {
    const c = new CompassModel({ deviation: [] });
    expect(c.equilibriumReading(90, 0, 0, 0.2, 0, 1, dip)).toBeLessThan(80);
    expect(c.equilibriumReading(90, 0, 0, -0.2, 0, 1, dip)).toBeGreaterThan(100);
    // No acceleration error on north/south headings.
    expect(c.equilibriumReading(0, 0, 0, 0.2, 0, 1, dip)).toBeCloseTo(0, 6);
  });

  it('errors reverse in the southern hemisphere', () => {
    const c = new CompassModel({ deviation: [] });
    const nz = 1 / Math.cos((20 * Math.PI) / 180);
    const r = c.equilibriumReading(0, 0, 20, 0, 0, nz, -dip);
    expect(r).toBeGreaterThan(5);
    expect(r).toBeLessThan(90);
  });

  it('interpolates the deviation card and swings to the new reading', () => {
    const c = new CompassModel({ deviation: [0, 2, 3, 2, 0, -1, -2, -3, -2, 0, 1, 1] });
    expect(c.deviationAt(30)).toBe(2);
    expect(c.deviationAt(45)).toBeCloseTo(2.5, 9);
    expect(c.deviationAt(345)).toBeCloseTo(0.5, 9);
    c.reset(0);
    let overshoot = 0;
    for (let t = 0; t < 20; t += dt) {
      c.update(90, 0, 0, 0, 0, 1, dip, 0, dt);
      overshoot = Math.max(overshoot, c.reading < 180 ? c.reading : 0);
    }
    // Magnetic 090 with +2 deg deviation on the card reads 092.
    expect(c.reading).toBeCloseTo(92, 0);
    expect(overshoot).toBeGreaterThan(94); // liquid damping lets the card swing past
  });
});

describe('altimeter math', () => {
  it('uses the ISA pressure-altitude relation', () => {
    expect(pressureAltitudeFt(29.92126)).toBeCloseTo(0, 6);
    // ISA 10,000 ft = 696.8 hPa = 20.577 inHg (ICAO Doc 7488).
    expect(pressureAtAltitudeInHg(10000)).toBeCloseTo(20.577, 2);
    expect(pressureAltitudeFt(pressureAtAltitudeInHg(18000))).toBeCloseTo(18000, 6);
  });

  it('a higher Kollsman setting reads higher (about 1000 ft per inHg near sea level)', () => {
    const d = indicatedAltitudeFt(0, 30.92) - indicatedAltitudeFt(0, 29.92);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1000);
    expect(indicatedAltitudeFt(5000, 29.92126)).toBeCloseTo(5000, 6);
  });

  it('three-pointer angles', () => {
    const p = altimeterPointers(12345, { hundreds: 0, thousands: 0, tenThousands: 0 });
    expect(p.hundreds % 360).toBeCloseTo(124.2, 6);
    expect(p.thousands % 360).toBeCloseTo(84.42, 6);
    expect(p.tenThousands).toBeCloseTo(44.442, 6);
    expect(kollsmanDrumAngle(29.92126, 55)).toBeCloseTo(0, 9);
    expect(kollsmanDrumAngle(30.92126, 55)).toBeCloseTo(55, 9);
  });
});

describe('TAS ring slide rule', () => {
  it('computes the ISA density ratio and TAS factor', () => {
    expect(densityRatio(0, 15)).toBeCloseTo(1, 6);
    // ISA 10,000 ft (-4.8 C): sigma 0.7385, TAS/IAS 1.164.
    expect(densityRatio(10000, -4.81)).toBeCloseTo(0.7385, 3);
    expect(tasFactor(10000, -4.81)).toBeCloseTo(1.1637, 3);
  });

  it('aligning PA over OAT sets exactly the TAS factor (design identity)', () => {
    const S = 225;
    for (const [pa, oat] of [
      [0, 15],
      [6000, 0],
      [10000, -10],
      [12000, 20],
    ]) {
      expect(alignedFactor(pa, oat, S)).toBeCloseTo(tasFactor(pa, oat), 9);
    }
    // The ring rotates so the PA mark sits over the OAT mark.
    const k = tasFactor(8000, 5);
    expect(ringRotationDeg(k, S) + paMarkDeg(8000, S)).toBeCloseTo(oatMarkDeg(5, S), 9);
  });
});

describe('twin gauge geometry', () => {
  it('left needles sweep upward from min to max, right needles mirror', () => {
    const side = { min: 0, max: 26 };
    const lMin = TwinGauge.sideAngle(side, -1, 0);
    const lMax = TwinGauge.sideAngle(side, -1, 26);
    expect(lMin).toBeGreaterThan(90);
    expect(lMax).toBeLessThan(90);
    const rMin = TwinGauge.sideAngle(side, 1, 0);
    const rMax = TwinGauge.sideAngle(side, 1, 26);
    expect(rMin).toBeLessThan(270);
    expect(rMax).toBeGreaterThan(270);
    expect(lMin - 90).toBeCloseTo(270 - rMin, 9);
  });
});
