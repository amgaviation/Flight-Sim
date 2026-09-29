import { describe, expect, it } from 'vitest';
import { KnobLogic } from '../../src/cockpit/controls/logic/KnobLogic';
import { LeverLogic } from '../../src/cockpit/controls/logic/LeverLogic';

describe('KnobLogic (detented)', () => {
  const positions = [
    { value: 0, label: 'OFF' },
    { value: 1, label: 'R' },
    { value: 2, label: 'L' },
    { value: 3, label: 'BOTH' },
    { value: 4, label: 'START', spring: 3 },
  ];

  it('steps through detents and stops at the ends', () => {
    const k = new KnobLogic({ positions });
    expect(k.label).toBe('OFF');
    const r = k.turn(-1, 0);
    expect(r.blocked).toBe('limit');
    expect(k.turn(3, 1).clicks).toBe(3);
    expect(k.label).toBe('BOTH');
    expect(k.value).toBe(3);
  });

  it('springs back from a spring position on release, or after the hold time', () => {
    const k = new KnobLogic({ positions, initial: 3, momentaryHoldS: 0.3 });
    k.turn(1, 0, { hold: true });
    expect(k.label).toBe('START');
    expect(k.tick(1)).toBe(false); // held
    expect(k.release()).toBe(true);
    expect(k.label).toBe('BOTH');
    k.turn(1, 5);
    expect(k.label).toBe('START');
    expect(k.tick(0.2)).toBe(false);
    expect(k.tick(0.2)).toBe(true);
    expect(k.label).toBe('BOTH');
  });

  it('wraps continuous-rotation selectors', () => {
    const k = new KnobLogic({ positions: [{ value: 0 }, { value: 1 }, { value: 2 }], wrap: true, initial: 2 });
    const r = k.turn(1, 0);
    expect(r.clicks).toBe(1);
    expect(k.index).toBe(0);
    k.turn(-1, 1);
    expect(k.index).toBe(2);
  });

  it('gated detents: deliberate clicks pass; fast spins stop; a pause lets the next notch pass', () => {
    const k = new KnobLogic({
      positions: [{ value: 0, label: 'LEFT' }, { value: 1, label: 'BOTH' }, { value: 2, label: 'RIGHT' }, { value: 3, label: 'OFF', gated: true }],
      initial: 1,
      gatePauseS: 0.35,
    });
    // Fast wheel spin from BOTH: RIGHT then blocked at the OFF gate within the same motion.
    expect(k.turn(1, 10.0).clicks).toBe(1);
    const blocked = k.turn(1, 10.05);
    expect(blocked.blocked).toBe('gate');
    expect(k.label).toBe('RIGHT');
    // A pause >= 0.35 s: the next notch passes.
    expect(k.turn(1, 10.5).clicks).toBe(1);
    expect(k.label).toBe('OFF');
    // Leaving the gate quickly is blocked, a deliberate click passes.
    expect(k.turn(-1, 10.55).blocked).toBe('gate');
    expect(k.turn(-1, 10.56, { deliberate: true }).clicks).toBe(1);
    expect(k.label).toBe('RIGHT');
    // Multi-click turns only cross a gate on their first click.
    k.setIndex(1);
    const multi = k.turn(3, 20, { deliberate: true });
    expect(multi.clicks).toBe(1);
    expect(multi.blocked).toBe('gate');
  });

  it('syncs to external values', () => {
    const k = new KnobLogic({ positions });
    expect(k.sync(2)).toBe(true);
    expect(k.label).toBe('L');
    expect(k.sync(2)).toBe(false);
  });
});

describe('KnobLogic (continuous)', () => {
  it('clamps or wraps and quantizes to the step grid', () => {
    const baro = new KnobLogic({ min: 28, max: 31, step: 0.01, initial: 29.92 });
    for (let i = 0; i < 7; i++) baro.turn(1, i); // slow (1 s apart)
    expect(baro.value).toBe(29.99);
    baro.turn(1, 100);
    expect(baro.value).toBe(30);
    const hdg = new KnobLogic({ min: 0, max: 360, step: 1, wrap: true, initial: 359 });
    hdg.turn(1, 0);
    expect(hdg.value).toBe(0);
    hdg.turn(-2, 5);
    expect(hdg.value).toBe(358);
    const lim = new KnobLogic({ min: 0, max: 1, step: 0.1, initial: 0.95 });
    const r = lim.turn(2, 0);
    expect(lim.value).toBe(1);
    expect(r.blocked).toBe('limit');
  });

  it('accelerates when turned fast', () => {
    const k = new KnobLogic({ min: 0, max: 360, step: 1, wrap: true, initial: 0, accel: { fastStep: 10, slow: 6, fast: 14 } });
    // Slow clicks: 1 deg each.
    k.turn(1, 0);
    k.turn(1, 1);
    expect(k.value).toBe(2);
    // A burst of clicks 20 ms apart (50 clicks/s) ramps to the fast step.
    let t = 2;
    for (let i = 0; i < 6; i++) k.turn(1, (t += 0.02));
    expect(k.currentStep()).toBe(10);
    const before = k.value;
    k.turn(1, (t += 0.02));
    expect(k.value).toBe((before + 10) % 360);
    // After a pause the rate resets.
    k.turn(1, t + 1);
    expect(k.currentStep()).toBe(1);
  });
});

describe('LeverLogic', () => {
  const detents = [
    { value: -0.3, label: 'REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: 0.7, label: 'CRU' },
    { value: 1, label: 'TO' },
  ];

  it('soft detents capture nearby positions', () => {
    const l = new LeverLogic({ min: -0.3, max: 1, detents, softWidth: 0.03, initial: 0.5 });
    l.beginMotion(0);
    expect(l.moveTo(0.72).value).toBe(0.7);
    expect(l.moveTo(0.75).value).toBe(0.75);
    l.endMotion();
    expect(l.label()).toBe('');
  });

  it('a gate stops a drag; a new motion started at the gate after a pause passes it', () => {
    const l = new LeverLogic({ min: -0.3, max: 1, detents, initial: 0.5, gatePauseS: 0.35 });
    l.beginMotion(1.0);
    const m = l.moveTo(-0.3, 1.1);
    expect(m.value).toBe(0);
    expect(m.blockedBy?.label).toBe('IDLE');
    // Keep dragging in the same motion: still blocked.
    expect(l.moveTo(-0.2, 1.5).value).toBe(0);
    l.endMotion();
    // New motion too soon after arriving: blocked.
    l.beginMotion(1.2);
    expect(l.moveTo(-0.2, 1.25).value).toBe(0);
    l.endMotion();
    // New motion after the pause: passes into reverse.
    l.beginMotion(2.0);
    expect(l.moveTo(-0.2, 2.1).value).toBeCloseTo(-0.2, 9);
    l.endMotion();
    // The gate only blocks decreasing motion: going back up is free.
    l.beginMotion(3);
    expect(l.moveTo(0.5, 3.1).value).toBeCloseTo(0.5, 9);
  });

  it('wheel steps move by `step` and snap to detents within reach', () => {
    const l = new LeverLogic({ min: -0.3, max: 1, detents, initial: 0.7, step: 0.05, softWidth: 0.02 });
    expect(l.stepDetent(-1, 0).value).toBeCloseTo(0.65, 9);
    expect(l.stepDetent(1, 1).value).toBe(0.7);
    expect(l.stepDetent(1, 2).value).toBeCloseTo(0.75, 9);
  });

  it('wheel steps go detent to detent and stop at gates; clicks lift over', () => {
    const l = new LeverLogic({ min: -0.3, max: 1, detents, initial: 0.7, step: 1 });
    expect(l.stepDetent(-1, 0).value).toBe(0); // CRU -> IDLE (lands on the gate)
    expect(l.stepDetent(-1, 0.05).value).toBe(0); // fast notch: blocked
    expect(l.stepDetent(-1, 0.6).value).toBeCloseTo(-0.3, 9); // after a pause: passes (next detent REV)
    l.stepDetent(1, 1);
    expect(l.value).toBe(0);
    expect(l.stepDetent(1, 1.01).value).toBe(0.7); // increasing is not gated
    const c = new LeverLogic({ min: -0.3, max: 1, detents, initial: 0, step: 1 });
    c.beginMotion(0);
    c.moveTo(0, 0);
    c.endMotion();
    expect(c.stepDetent(-1, 0.01, true).value).toBeCloseTo(-0.3, 9); // deliberate click
  });

  it('discrete levers rest on detents and do not snap across gates', () => {
    const flaps = new LeverLogic({
      min: 0,
      max: 3,
      discrete: true,
      detents: [{ value: 0, label: 'UP' }, { value: 1, label: '1', kind: 'gate' }, { value: 2, label: '15' }, { value: 3, label: '35' }],
      initial: 0,
    });
    flaps.beginMotion(0);
    flaps.moveTo(0.6, 0.1);
    expect(flaps.output).toBe(1); // nearest reachable detent is the gate itself
    flaps.moveTo(2.4, 0.2); // blocked at gate 1 in this motion
    expect(flaps.value).toBe(1);
    expect(flaps.endMotion()).toBe(1);
    flaps.beginMotion(1);
    flaps.moveTo(2.4, 1.1);
    expect(flaps.endMotion()).toBe(2);
    expect(flaps.label()).toBe('15');
    expect(flaps.stepDetent(1, 5).value).toBe(3);
  });

  it('limits (interlocks) clamp travel and sync follows external writes', () => {
    const rev = new LeverLogic({ min: 0, max: 1, initial: 0 });
    rev.setLimits(0, 0); // forward lever not at idle: reverse lever locked down
    rev.beginMotion(0);
    expect(rev.moveTo(0.8, 0).value).toBe(0);
    rev.endMotion();
    rev.setLimits(0, 1);
    expect(rev.sync(0.4)).toBe(true);
    expect(rev.value).toBe(0.4);
    rev.beginMotion(0);
    expect(rev.sync(0.9)).toBe(false); // ignored while the pilot moves the lever
  });
});
