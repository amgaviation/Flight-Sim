import { describe, expect, it } from 'vitest';
import {
  bugOffscale,
  clampBugY,
  deviationPegged,
  deviationPx,
  dialAngle,
  drumPosition,
  firstMultipleAtOrAbove,
  lastMultipleAtOrBelow,
  localToScreen,
  piecewise,
  piecewiseInverse,
  piecewiseSigned,
  pitchLineOffsetPx,
  polarX,
  polarY,
  projectLocalNm,
  roseAngle,
  standardRateBankDeg,
  tapeValueAtY,
  tapeY,
  trendValue,
  unprojectLocalNm,
} from '../../src/avionics/common/math';
import { quantizeRadioAlt } from '../../src/avionics/common/draw/AttitudeIndicator';
import { fmtBaro, fmtClock, fmtFixed, fmtHeading, fmtInt, fmtMach, fmtPad } from '../../src/avionics/common/format';

const DEG = Math.PI / 180;

describe('tape scaling', () => {
  it('places larger values higher and inverts exactly', () => {
    const cy = 300;
    const k = 6.2;
    expect(tapeY(120, 120, cy, k)).toBe(cy);
    expect(tapeY(130, 120, cy, k)).toBeCloseTo(cy - 62, 9);
    expect(tapeY(110, 120, cy, k)).toBeCloseTo(cy + 62, 9);
    for (const y of [0, 123.4, 300, 580]) expect(tapeY(tapeValueAtY(y, 97, cy, k), 97, cy, k)).toBeCloseTo(y, 9);
  });

  it('finds the first and last tick multiples', () => {
    expect(firstMultipleAtOrAbove(101, 5)).toBe(105);
    expect(firstMultipleAtOrAbove(100, 5)).toBe(100);
    expect(firstMultipleAtOrAbove(-7, 5)).toBe(-5);
    expect(lastMultipleAtOrBelow(4583, 20)).toBe(4580);
    expect(lastMultipleAtOrBelow(-7, 5)).toBe(-10);
  });

  it('parks off-scale bugs at the tape edge (G1000 selected altitude)', () => {
    expect(clampBugY(50, 100, 400)).toBe(100);
    expect(clampBugY(500, 100, 400)).toBe(400);
    expect(clampBugY(250, 100, 400)).toBe(250);
    expect(bugOffscale(50, 100, 400)).toBe(-1);
    expect(bugOffscale(500, 100, 400)).toBe(1);
    expect(bugOffscale(250, 100, 400)).toBe(0);
  });

  it('computes trend vector targets', () => {
    // G1000: 6 s airspeed trend; 2 kt/s acceleration -> +12 kt.
    expect(trendValue(100, 2, 6)).toBe(112);
    // 737: 10 s trend.
    expect(trendValue(250, -1.5, 10)).toBe(235);
  });
});

describe('rolling drum digits', () => {
  it('ones drum rolls continuously', () => {
    expect(drumPosition(108.4, 1, 1)).toBeCloseTo(108.4, 9);
  });

  it('tens drum only rolls while the ones pass 9 -> 10', () => {
    expect(drumPosition(105, 10, 1)).toBe(10);
    expect(drumPosition(108.9, 10, 1)).toBe(10);
    expect(drumPosition(109.5, 10, 1)).toBeCloseTo(10.5, 9);
    expect(drumPosition(110, 10, 1)).toBe(11);
  });

  it('altitude 20-ft drum and hundreds carry', () => {
    // 20 s drum: position in 20 ft steps (5 symbols 00 20 40 60 80).
    expect(drumPosition(4583, 20, 20)).toBeCloseTo(229.15, 9);
    expect(Math.floor(drumPosition(4583, 20, 20)) % 5).toBe(4); // "80"
    // Hundreds roll while the 20s go 80 -> 100.
    expect(drumPosition(4570, 100, 20)).toBe(45);
    expect(drumPosition(4590, 100, 20)).toBeCloseTo(45.5, 9);
    expect(drumPosition(4600, 100, 20)).toBe(46);
    // Thousands roll during the last 20 ft before the next thousand.
    expect(drumPosition(4990, 1000, 20)).toBeCloseTo(4.5, 9);
    expect(drumPosition(4979, 1000, 20)).toBe(4);
  });

  it('never goes negative', () => {
    expect(drumPosition(-50, 10, 1)).toBe(0);
  });
});

describe('round displays', () => {
  it('compass rose angles are relative to the up reference and wrapped', () => {
    expect(roseAngle(90, 45)).toBeCloseTo(45 * DEG, 12);
    expect(roseAngle(10, 350)).toBeCloseTo(20 * DEG, 12);
    expect(roseAngle(350, 10)).toBeCloseTo(-20 * DEG, 12);
    expect(roseAngle(225, 45)).toBeCloseTo(-180 * DEG, 12);
  });

  it('polar helpers measure clockwise from 12 o clock with y down', () => {
    expect(polarX(100, 50, 0)).toBeCloseTo(100, 12);
    expect(polarY(100, 50, 0)).toBeCloseTo(50, 12);
    expect(polarX(100, 50, Math.PI / 2)).toBeCloseTo(150, 12);
    expect(polarY(100, 50, Math.PI / 2)).toBeCloseTo(100, 12);
  });

  it('dial angles are linear and clamp to the stops', () => {
    expect(dialAngle(2350, 0, 3500, -140, 140)).toBeCloseTo(-140 + (2350 / 3500) * 280, 9);
    expect(dialAngle(4000, 0, 3500, -140, 140)).toBe(140);
    expect(dialAngle(4000, 0, 3500, -140, 140, false)).toBeGreaterThan(140);
  });

  it('piecewise scales (non-linear VSI / ASI dials)', () => {
    const xs = [0, 1000, 2000, 6000];
    const ys = [0, 0.47, 0.72, 1];
    expect(piecewise(xs, ys, 500)).toBeCloseTo(0.235, 9);
    expect(piecewise(xs, ys, 9000)).toBe(1);
    expect(piecewiseSigned(xs, ys, -1000)).toBeCloseTo(-0.47, 9);
    expect(piecewiseInverse(xs, ys, 0.72)).toBeCloseTo(2000, 9);
  });
});

describe('deviation and attitude scaling', () => {
  it('maps normalised deviation to dots and pegs with overshoot', () => {
    // 2-dot Garmin scale, 36 px per dot: full scale (1.0) = 72 px.
    expect(deviationPx(1, 2, 36)).toBeCloseTo(72, 9);
    expect(deviationPx(-0.5, 2, 36)).toBeCloseTo(-36, 9);
    expect(deviationPx(3, 2, 36)).toBeCloseTo(72, 9);
    expect(deviationPx(3, 2, 36, 0.5)).toBeCloseTo(90, 9);
    expect(deviationPegged(1)).toBe(true);
    expect(deviationPegged(0.99)).toBe(false);
  });

  it('pitch ladder lines move down when the nose rises', () => {
    expect(pitchLineOffsetPx(10, 0, 7)).toBe(-70);
    expect(pitchLineOffsetPx(0, 5, 7)).toBe(35);
  });

  it('standard-rate bank angle follows tan(phi) = V omega / g', () => {
    // 100 KTAS: atan(51.44 m/s * 0.05236 rad/s / 9.80665) = 15.36 deg (the "TAS/10 + 7" rule of thumb gives 17).
    expect(standardRateBankDeg(100)).toBeCloseTo(15.36, 2);
    expect(standardRateBankDeg(200)).toBeCloseTo(28.78, 2);
  });

  it('radio altitude resolution follows G1000 Table 2-4', () => {
    expect(quantizeRadioAlt(123)).toBe(125);
    expect(quantizeRadioAlt(1234)).toBe(1230);
    expect(quantizeRadioAlt(2234)).toBe(2250);
  });
});

describe('map projection', () => {
  it('round-trips lat/lon through the local projection', () => {
    const out = { x: 0, y: 0 };
    const ll = { lat: 0, lon: 0 };
    const cos = Math.cos(47.3 * DEG);
    projectLocalNm(47.5, -122.0, 47.3, -122.3, cos, out);
    expect(out.y).toBeCloseTo(12, 9);
    expect(out.x).toBeCloseTo(0.3 * 60 * cos, 9);
    unprojectLocalNm(out.x, out.y, 47.3, -122.3, cos, ll);
    expect(ll.lat).toBeCloseTo(47.5, 9);
    expect(ll.lon).toBeCloseTo(-122.0, 9);
  });

  it('wraps across the antimeridian', () => {
    const out = { x: 0, y: 0 };
    projectLocalNm(0, -179.9, 0, 179.9, 1, out);
    expect(out.x).toBeCloseTo(12, 6);
  });

  it('track-up puts a point on the track straight ahead', () => {
    const s = { x: 0, y: 0 };
    const up = 90 * DEG; // track east
    localToScreen(10, 0, Math.sin(up), Math.cos(up), 400, 300, 20, s);
    expect(s.x).toBeCloseTo(400, 9);
    expect(s.y).toBeCloseTo(100, 9);
    // North is to the left when flying east.
    localToScreen(0, 10, Math.sin(up), Math.cos(up), 400, 300, 20, s);
    expect(s.x).toBeCloseTo(200, 9);
    expect(s.y).toBeCloseTo(300, 9);
  });
});

describe('formatting', () => {
  it('formats with aviation conventions and caches', () => {
    expect(fmtHeading(0)).toBe('360');
    expect(fmtHeading(5.4)).toBe('005');
    expect(fmtHeading(-1)).toBe('359');
    expect(fmtMach(0.7824)).toBe('.782');
    expect(fmtBaro(29.92, 'inhg')).toBe('29.92');
    expect(fmtBaro(29.92, 'hpa')).toBe('1013');
    expect(fmtClock(125)).toBe('02:05');
    expect(fmtClock(3725, true)).toBe('1:02');
    expect(fmtPad(7, 3)).toBe('007');
    expect(fmtPad(-7, 3)).toBe('-007');
    expect(fmtFixed(3.14159, 2)).toBe('3.14');
    expect(fmtInt(1234.6)).toBe('1235');
    expect(fmtInt(1234.6)).toBe(fmtInt(1235)); // cache hit returns the same string
    expect(fmtInt(NaN)).toBe('---');
  });
});
