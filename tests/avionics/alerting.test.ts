import { describe, expect, it } from 'vitest';
import {
  ALT_ALERT_BOEING,
  ALT_ALERT_GARMIN,
  AltitudeAlerter,
  ExceedanceMonitor,
  MINIMUMS_BOEING,
  MINIMUMS_GARMIN,
  MinimumsAlerter,
} from '../../src/avionics/common/alerting';

describe('AltitudeAlerter (Garmin G1000 rules)', () => {
  it('cues approaching (1000 ft), near (200 ft), capture and deviation', () => {
    const a = new AltitudeAlerter(ALT_ALERT_GARMIN);
    a.update(3000, 5000, 0.1); // selected altitude set: initialises silently
    expect(a.phase).toBe('idle');
    expect(a.consumeAural()).toBe(false);
    a.update(3900, 5000, 0.1);
    expect(a.phase).toBe('idle');
    a.update(4050, 5000, 0.1);
    expect(a.phase).toBe('approaching');
    expect(a.flashing).toBe(true);
    expect(a.consumeAural()).toBe(true);
    expect(a.consumeAural()).toBe(false);
    // Flashes for 5 s.
    for (let i = 0; i < 60; i++) a.update(4100, 5000, 0.1);
    expect(a.flashing).toBe(false);
    a.update(4850, 5000, 0.1);
    expect(a.phase).toBe('near');
    a.update(4980, 5000, 0.1);
    expect(a.phase).toBe('captured');
    a.update(5150, 5000, 0.1);
    expect(a.phase).toBe('captured');
    a.update(5250, 5000, 0.1);
    expect(a.phase).toBe('deviation');
    expect(a.consumeAural()).toBe(true);
    a.update(5100, 5000, 0.1);
    expect(a.phase).toBe('captured');
  });

  it('resets when the selected altitude changes', () => {
    const a = new AltitudeAlerter(ALT_ALERT_GARMIN);
    a.update(5000, 5000, 0.1);
    expect(a.phase).toBe('captured');
    a.update(5000, 8000, 0.1);
    expect(a.phase).toBe('idle');
    a.update(7200, 8000, 0.1);
    expect(a.phase).toBe('approaching');
  });

  it('Boeing deviation flashes until back inside the band', () => {
    const a = new AltitudeAlerter(ALT_ALERT_BOEING);
    a.update(10000, 10000, 0.1);
    a.update(10400, 10000, 0.1);
    expect(a.phase).toBe('deviation');
    for (let i = 0; i < 1000; i++) a.update(10400, 10000, 0.1);
    expect(a.flashing).toBe(true);
    a.update(10100, 10000, 0.1);
    expect(a.flashing).toBe(false);
  });
});

describe('MinimumsAlerter', () => {
  it('Garmin: appears within 2500 ft, white within 100, yellow at minimums, disabled 50 ft above after climbing', () => {
    const m = new MinimumsAlerter(MINIMUMS_GARMIN);
    m.update(1000, 500, true, 0.1);
    expect(m.phase).toBe('inhibited');
    m.update(4000, 500, false, 0.1);
    expect(m.phase).toBe('hidden');
    m.update(2900, 500, false, 0.1);
    expect(m.phase).toBe('armed');
    expect(m.shown).toBe(true);
    m.update(590, 500, false, 0.1);
    expect(m.phase).toBe('near');
    m.update(499, 500, false, 0.1);
    expect(m.phase).toBe('reached');
    expect(m.consumeAural()).toBe(true);
    m.update(520, 500, false, 0.1);
    expect(m.phase).toBe('reached');
    m.update(560, 500, false, 0.1);
    expect(m.phase).not.toBe('reached');
  });

  it('Garmin: alerting inhibited until 150 ft above the setting', () => {
    const m = new MinimumsAlerter(MINIMUMS_GARMIN);
    m.update(600, 500, false, 0.1); // never been 150 ft above
    m.update(450, 500, false, 0.1);
    expect(m.phase).not.toBe('reached');
    expect(m.consumeAural()).toBe(false);
  });

  it('Boeing: flashes 3 s at minimums, cleared by RST', () => {
    const m = new MinimumsAlerter(MINIMUMS_BOEING);
    m.update(1000, 200, false, 0.1);
    m.update(190, 200, false, 0.1);
    expect(m.phase).toBe('reached');
    expect(m.flashing).toBe(true);
    for (let i = 0; i < 31; i++) m.update(150, 200, false, 0.1);
    expect(m.flashing).toBe(false);
    expect(m.phase).toBe('reached');
    m.reset();
    expect(m.phase).toBe('armed');
  });
});

describe('ExceedanceMonitor', () => {
  it('classifies caution / warning with hysteresis and flashes on entry', () => {
    const e = new ExceedanceMonitor({ cautionHigh: 90, warnHigh: 115, warnLow: 20, hysteresis: 2, flashS: 5 });
    expect(e.update(60, 0.1)).toBe(0);
    expect(e.update(95, 0.1)).toBe(1);
    expect(e.flashing).toBe(true);
    expect(e.update(120, 0.1)).toBe(2);
    expect(e.peak).toBe(120);
    // Inside the hysteresis band: stays at warning.
    expect(e.update(114, 0.1)).toBe(2);
    expect(e.update(112, 0.1)).toBe(1);
    expect(e.update(10, 0.1)).toBe(2);
    e.acknowledge();
    expect(e.flashing).toBe(false);
  });
});
