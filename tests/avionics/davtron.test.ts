import { describe, expect, it } from 'vitest';
import { DavtronM803 } from '../../src/avionics/analog/models/davtron';

function powered(): DavtronM803 {
  const d = new DavtronM803();
  d.setUtcHours(14.5);
  d.update(0.01, true, 28.2, 7);
  return d;
}

function tick(d: DavtronM803, seconds: number, step = 0.1): void {
  for (let t = 0; t < seconds - 1e-9; t += step) d.update(step, true, 28.2, 7);
}

describe('Davtron M803 (172S POH Supplement 9)', () => {
  it('upper window: volts at power-up, then F, then C', () => {
    const d = powered();
    expect(d.upperText()).toBe('28.2E');
    d.pressUpper();
    expect(d.upperText()).toBe('45F');
    d.pressUpper();
    expect(d.upperText()).toBe('7C');
    d.pressUpper();
    expect(d.upperText()).toBe('28.2E');
  });

  it('SELECT sequences UT -> LT -> FT -> ET -> UT', () => {
    const d = powered();
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
      seq.push(d.mode);
      d.pressSelect();
      d.releaseSelect();
    }
    expect(seq).toEqual(['UT', 'LT', 'FT', 'ET', 'UT']);
    expect(d.lowerText()).toBe('14:30');
  });

  it('holding SELECT 3 s runs the display test (88:88, all annunciators)', () => {
    const d = powered();
    d.pressSelect(); // also advances to LT
    tick(d, 3.1);
    expect(d.testing).toBe(true);
    expect(d.lowerText()).toBe('88:88');
    expect(d.annunciatorLit('ET')).toBe(true);
    d.releaseSelect();
    expect(d.testing).toBe(false);
  });

  it('sets universal time digit by digit', () => {
    const d = powered();
    d.pressBoth(); // SELECT + CONTROL together
    expect(d.flashingDigit).toBe(0);
    expect(d.lowerText()).toBe('14:30');
    d.pressControl(); // tens of hours 1 -> 2
    d.releaseControl();
    d.pressSelect();
    d.releaseSelect(); // -> hours digit (4 is clamped to 3 when tens = 2)
    expect(d.lowerText()).toBe('23:30');
    d.pressControl(); // 3 -> 0 (limit 3 when tens is 2)
    d.releaseControl();
    d.pressSelect();
    d.releaseSelect();
    d.pressSelect();
    d.releaseSelect();
    d.pressSelect();
    d.releaseSelect(); // exit set mode
    expect(d.flashingDigit).toBe(-1);
    expect(d.lowerText()).toBe('20:30');
  });

  it('local time sets hours only; minutes follow UT', () => {
    const d = powered();
    d.pressSelect();
    d.releaseSelect(); // LT
    d.pressBoth();
    // 14 -> 08: tens 1 -> 2 (hours clamp 4 -> 3) -> 0, then hours 3 -> 8.
    d.pressControl();
    d.releaseControl();
    d.pressControl();
    d.releaseControl();
    d.pressSelect();
    d.releaseSelect();
    for (let i = 0; i < 5; i++) {
      d.pressControl();
      d.releaseControl();
    }
    d.pressSelect();
    d.releaseSelect(); // exit after the hours digit
    expect(d.localOffsetH).toBe(-6);
    expect(d.lowerText()).toBe('08:30');
  });

  it('flight time counts while powered and resets after CONTROL held 3 s', () => {
    const d = powered();
    tick(d, 125);
    d.pressSelect();
    d.releaseSelect();
    d.pressSelect();
    d.releaseSelect(); // FT
    expect(d.lowerText()).toBe('00:02');
    d.pressControl();
    tick(d, 3.2);
    expect(d.lowerText()).toBe('99:59');
    d.releaseControl();
    expect(d.flightTimeS).toBe(0);
  });

  it('ET counts up on CONTROL and resets on the next CONTROL', () => {
    const d = powered();
    for (let i = 0; i < 3; i++) {
      d.pressSelect();
      d.releaseSelect();
    }
    expect(d.mode).toBe('ET');
    d.pressControl();
    d.releaseControl();
    tick(d, 65);
    expect(d.lowerText()).toBe('01:05');
    d.pressControl();
    d.releaseControl();
    expect(d.etS).toBe(0);
    expect(d.etRunning).toBe(false);
  });

  it('ET count-down alarms at zero and then counts up', () => {
    const d = powered();
    for (let i = 0; i < 3; i++) {
      d.pressSelect();
      d.releaseSelect();
    }
    d.pressBoth(); // set MM:SS = 00:10
    d.pressSelect();
    d.releaseSelect();
    d.pressSelect();
    d.releaseSelect(); // at the tens-of-seconds digit
    d.pressControl();
    d.releaseControl(); // 1
    d.pressSelect();
    d.releaseSelect(); // units of seconds
    d.pressSelect();
    d.releaseSelect(); // exit
    expect(d.lowerText()).toBe('00:10');
    d.pressControl();
    d.releaseControl(); // start
    tick(d, 10.5);
    expect(d.flashing).toBe(true);
    expect(d.lowerText()).toBe('00:00');
    tick(d, 2);
    expect(d.lowerText()).toBe('00:02');
    d.pressSelect(); // resets the alarm, does not change mode
    d.releaseSelect();
    expect(d.flashing).toBe(false);
    expect(d.mode).toBe('ET');
  });

  it('buttons are disabled and the display blank without power', () => {
    const d = powered();
    d.update(0.1, false, 0, 7);
    d.pressSelect();
    d.pressUpper();
    expect(d.mode).toBe('UT');
    expect(d.upperText()).toBe('');
    expect(d.lowerText()).toBe('');
    // The clock keeps time on its internal battery.
    for (let t = 0; t < 60; t += 1) d.update(1, false, 0, 7);
    d.update(0.01, true, 28, 7);
    expect(d.lowerText()).toBe('14:31');
  });
});
