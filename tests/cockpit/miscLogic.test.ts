import { describe, expect, it } from 'vitest';
import { CircuitBreakerLogic, KeyPadLogic, PullHandleLogic, TrimWheelLogic } from '../../src/cockpit/controls/logic/MiscLogic';

describe('CircuitBreakerLogic', () => {
  it('pulls, pushes, trips and resets', () => {
    const cb = new CircuitBreakerLogic();
    expect(cb.state).toBe('in');
    expect(cb.toggle()).toBe('pulled');
    expect(cb.state).toBe('out');
    expect(cb.toggle()).toBe('pushed');
    expect(cb.trip()).toBe(true);
    expect(cb.state).toBe('tripped');
    expect(cb.trip()).toBe(false);
    expect(cb.push()).toBe(true);
    expect(cb.state).toBe('in');
    expect(cb.tripped).toBe(false);
  });

  it('push-to-reset breakers cannot be pulled', () => {
    const cb = new CircuitBreakerLogic({ pullable: false });
    expect(cb.toggle()).toBe('none');
    expect(cb.closed).toBe(true);
    cb.trip();
    expect(cb.toggle()).toBe('pushed');
  });

  it('syncs from vars and reports transitions', () => {
    const cb = new CircuitBreakerLogic();
    expect(cb.sync(1, 0)).toBeNull();
    expect(cb.sync(0, 1)).toBe('tripped');
    expect(cb.state).toBe('tripped');
    expect(cb.sync(1, 0)).toBe('reset');
    expect(cb.sync(0, 0)).toBe('opened');
  });
});

describe('KeyPadLogic', () => {
  const rows = [
    [{ id: 'A' }, { id: 'B' }, { id: '1' }, { id: 'CLR' }],
    [{ id: 'SP', w: 2 }, { id: 'spacer', spacer: true }, { id: 'EXEC', keys: ['F5'] }, { id: '+/-' }],
  ];

  it('emits one event per key press and optional release/single events', () => {
    const log: [string, unknown][] = [];
    const k = new KeyPadLogic({ rows, eventPrefix: 'fmc.l.key.', singleEvent: 'fmc.l.key', releaseEvents: true, emit: (n, p) => log.push([n, p]) });
    expect(k.press('A')).toBe(true);
    expect(k.release('A')).toBe(true);
    expect(k.press('nope')).toBe(false);
    expect(log).toEqual([
      ['fmc.l.key.A', 'down'],
      ['fmc.l.key', 'A'],
      ['fmc.l.key.A:up', 'up'],
    ]);
    expect(k.keys().map((x) => x.id)).toEqual(['A', 'B', '1', 'CLR', 'SP', 'EXEC', '+/-']);
  });

  it('maps PC keys to key ids', () => {
    const k = new KeyPadLogic({ rows, emit: () => undefined });
    expect(k.keyFor('a')).toBe('A');
    expect(k.keyFor('1')).toBe('1');
    expect(k.keyFor(' ')).toBe('SP');
    expect(k.keyFor('Backspace')).toBe('CLR');
    expect(k.keyFor('F5')).toBe('EXEC');
    expect(k.keyFor('Enter')).toBe('EXEC');
    expect(k.keyFor('-')).toBe('+/-');
    expect(k.keyFor('z')).toBeNull();
  });

  it('rejects duplicate ids', () => {
    expect(() => new KeyPadLogic({ rows: [[{ id: 'A' }, { id: 'A' }]], emit: () => undefined })).toThrow();
  });
});

describe('PullHandleLogic', () => {
  it('parking brake: pull + rotate to lock; unlocked handle springs back in', () => {
    const h = new PullHandleLogic({ rotate: 'lock', springIn: true });
    h.pull(true);
    expect(h.release()).toBe(true); // not locked -> springs back
    expect(h.pulled).toBe(false);
    h.pull(true);
    expect(h.rotate(1)).toBe(true);
    expect(h.locked).toBe(true);
    expect(h.release()).toBe(false);
    expect(h.pulled).toBe(true);
    expect(h.push()).toBe(true); // unlocks and goes in
    expect(h.rotation).toBe(0);
  });

  it('fire handle: locked until unlocked, rotates while held and springs back', () => {
    let fire = false;
    const h = new PullHandleLogic({ rotate: 'discharge' });
    h.canPull = () => fire;
    expect(h.pull()).toBe('blocked');
    fire = true;
    expect(h.pull()).toBe('pulled');
    expect(h.rotate(-1, true)).toBe(true);
    expect(h.push()).toBe(false); // must be centred first
    expect(h.release()).toBe(true);
    expect(h.rotation).toBe(0);
    expect(h.rotate(1)).toBe(true);
    expect(h.rotation).toBe(1);
  });

  it('cannot rotate before pulling', () => {
    const h = new PullHandleLogic({ rotate: 'discharge' });
    expect(h.rotate(1)).toBe(false);
  });
});

describe('TrimWheelLogic', () => {
  it('turns within limits and maps value to wheel angle', () => {
    const t = new TrimWheelLogic({ min: -1, max: 1, perRev: 0.25 });
    expect(t.turn(2)).toBeCloseTo(0.5, 9);
    expect(t.angleOf(t.value)).toBeCloseTo(((0.5 + 1) / 0.25) * Math.PI * 2, 9);
    expect(t.turn(10)).toBeCloseTo(0.5, 9); // stops at max
    expect(t.value).toBe(1);
    expect(t.sync(5)).toBe(false); // clamped to max, unchanged
    expect(t.sync(-0.5)).toBe(true);
    expect(t.value).toBe(-0.5);
  });

  it('counts spoke passages for clack sounds', () => {
    expect(TrimWheelLogic.spokesPassed(0, Math.PI * 2, 5)).toBe(5);
    expect(TrimWheelLogic.spokesPassed(0.01, 0.02, 5)).toBe(0);
    expect(TrimWheelLogic.spokesPassed(Math.PI * 2, 0, 4)).toBe(4);
  });
});
