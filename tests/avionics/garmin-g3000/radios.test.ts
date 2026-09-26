import { describe, expect, it } from 'vitest';
import {
  isValidCom,
  isValidNav,
  isValidSquawk,
  parseAdfDigits,
  parseComDigits,
  parseNavDigits,
  parseSquawk,
  stepAdf,
  stepCom,
  stepNav,
} from '../../../src/avionics/garmin-g3000/state/radios';
import { formatFreqBuf } from '../../../src/avionics/garmin-g3000/gtc/pages/radios';
import { fmtCom, fmtNav, fmtSquawk, fmtHms, fmtDeg } from '../../../src/avionics/garmin-g3000/format';

describe('COM tuning', () => {
  it('outer knob steps MHz and wraps 118..136', () => {
    expect(stepCom(118.1, 1, 'outer')).toBeCloseTo(119.1, 6);
    expect(stepCom(136.975, 1, 'outer')).toBeCloseTo(118.975, 6);
    expect(stepCom(118.0, -1, 'outer')).toBeCloseTo(136.0, 6);
  });
  it('inner knob steps 25 kHz channels and wraps within the MHz', () => {
    expect(stepCom(118.0, 1, 'inner')).toBeCloseTo(118.025, 6);
    expect(stepCom(118.975, 1, 'inner')).toBeCloseTo(118.0, 6);
    expect(stepCom(118.0, -1, 'inner')).toBeCloseTo(118.975, 6);
  });
  it('8.33 kHz spacing steps through channel names', () => {
    expect(stepCom(118.0, 1, 'inner', true)).toBeCloseTo(118.005, 6);
    expect(stepCom(118.015, 1, 'inner', true)).toBeCloseTo(118.025, 6);
    expect(isValidCom(118.005, true)).toBe(true);
    expect(isValidCom(118.005, false)).toBe(false);
  });
  it('parses keypad digits (two-digit 25 kHz convention)', () => {
    expect(parseComDigits('12345')).toBeCloseTo(123.45, 6);
    expect(parseComDigits('1182')).toBeCloseTo(118.2, 6);
    expect(parseComDigits('12347')).toBeCloseTo(123.475, 6); // "123.47" is the 123.475 channel
    expect(parseComDigits('118275')).toBeCloseTo(118.275, 6);
    expect(parseComDigits('11')).toBeNaN();
    expect(parseComDigits('13800')).toBeNaN();
  });
});

describe('NAV / ADF / transponder', () => {
  it('NAV knobs and digits', () => {
    expect(stepNav(110.9, 1, 'inner')).toBeCloseTo(110.95, 6);
    expect(stepNav(110.95, 1, 'inner')).toBeCloseTo(110.0, 6);
    expect(stepNav(117.5, 1, 'outer')).toBeCloseTo(108.5, 6);
    expect(parseNavDigits('11090')).toBeCloseTo(110.9, 6);
    expect(parseNavDigits('1109')).toBeCloseTo(110.9, 6);
    expect(parseNavDigits('11803')).toBeNaN();
    expect(isValidNav(117.95)).toBe(true);
  });
  it('ADF', () => {
    expect(stepAdf(350, 1, 'inner')).toBe(350.5);
    expect(stepAdf(1750, 1, 'outer')).toBe(1799.5);
    expect(parseAdfDigits('3505')).toBe(350.5);
    expect(parseAdfDigits('1799')).toBe(1799);
    expect(parseAdfDigits('100')).toBeNaN();
  });
  it('squawk codes are octal', () => {
    expect(isValidSquawk('7700')).toBe(true);
    expect(isValidSquawk('7800')).toBe(false);
    expect(parseSquawk('0452')).toBe(452);
    expect(fmtSquawk(452)).toBe('0452');
  });
});

describe('formatting', () => {
  it('frequencies, keypad buffers, times, headings', () => {
    expect(fmtCom(118.1)).toBe('118.10');
    expect(fmtCom(118.005, true)).toBe('118.005');
    expect(fmtNav(110.9)).toBe('110.90');
    expect(formatFreqBuf('1182', 3, 2)).toBe('118.2_');
    expect(formatFreqBuf('', 3, 3)).toBe('___.___');
    expect(fmtHms(3725, true)).toMatch(/^1:02:05$/);
    expect(fmtDeg(0)).toBe('360°');
    expect(fmtDeg(5)).toBe('005°');
  });
});
