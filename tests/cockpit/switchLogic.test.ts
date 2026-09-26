import { describe, expect, it } from 'vitest';
import { SwitchLogic } from '../../src/cockpit/controls/logic/SwitchLogic';
import { GuardLogic } from '../../src/cockpit/controls/logic/GuardLogic';
import { ButtonLogic } from '../../src/cockpit/controls/logic/ButtonLogic';

describe('SwitchLogic', () => {
  it('moves between positions and reports values', () => {
    const s = new SwitchLogic({ positions: 3, values: [-1, 0, 1], initial: 1 });
    expect(s.value).toBe(0);
    expect(s.step(1).moved).toBe(true);
    expect(s.value).toBe(1);
    const r = s.step(1);
    expect(r.moved).toBe(false);
    expect(r.blocked).toBe('limit');
    s.step(-1);
    s.step(-1);
    expect(s.value).toBe(-1);
  });

  it('flips 2-position switches and bounces 3-position toggles at the end stop', () => {
    const two = new SwitchLogic({ positions: 2 });
    two.toggle();
    expect(two.index).toBe(1);
    two.toggle();
    expect(two.index).toBe(0);
    const three = new SwitchLogic({ positions: 3, initial: 2 });
    const r = three.toggle(false, 1);
    expect(r.moved).toBe(true);
    expect(three.index).toBe(1);
  });

  it('holds a momentary position while held and springs back on release', () => {
    const s = new SwitchLogic({ positions: 3, initial: 1, springs: { 2: 1, 0: 1 } });
    s.step(1, true);
    expect(s.index).toBe(2);
    // Held: tick does not return it.
    expect(s.tick(1)).toBeNull();
    expect(s.index).toBe(2);
    const back = s.release();
    expect(back?.moved).toBe(true);
    expect(s.index).toBe(1);
  });

  it('returns a momentary position reached without a hold after momentaryHoldS', () => {
    const s = new SwitchLogic({ positions: 2, springs: { 1: 0 }, momentaryHoldS: 0.25 });
    s.step(1, false);
    expect(s.index).toBe(1);
    expect(s.tick(0.1)).toBeNull();
    expect(s.index).toBe(1);
    const r = s.tick(0.2);
    expect(r?.moved).toBe(true);
    expect(s.index).toBe(0);
  });

  it('requires a pull to move into or out of lever-locked positions', () => {
    const s = new SwitchLogic({ positions: 3, initial: 1, locked: [0] });
    // 1 -> 2 is free (neither locked).
    expect(s.step(1).moved).toBe(true);
    s.step(-1);
    // 1 -> 0 needs a pull.
    const r = s.step(-1);
    expect(r.moved).toBe(false);
    expect(r.blocked).toBe('locked');
    expect(s.needsPull(0)).toBe(true);
    s.pull();
    expect(s.step(-1).moved).toBe(true);
    s.unpull();
    // Leaving the locked position also needs a pull.
    expect(s.step(1).blocked).toBe('locked');
    s.pull();
    expect(s.step(1).moved).toBe(true);
  });

  it('locks every position with locked: true', () => {
    const s = new SwitchLogic({ positions: 2, locked: true });
    expect(s.step(1).blocked).toBe('locked');
    s.pull();
    expect(s.step(1).moved).toBe(true);
  });

  it('honours the inhibit interlock', () => {
    let wow = true;
    const s = new SwitchLogic({ positions: 2 });
    s.inhibit = (to) => !(to === 1 && wow);
    expect(s.step(1).blocked).toBe('inhibited');
    wow = false;
    expect(s.step(1).moved).toBe(true);
  });

  it('follows external values (nearest position)', () => {
    const s = new SwitchLogic({ positions: 3, values: [0, 5, 10] });
    expect(s.sync(10)).toBe(true);
    expect(s.index).toBe(2);
    expect(s.sync(6)).toBe(true);
    expect(s.index).toBe(1);
    expect(s.sync(5)).toBe(false);
  });

  it('rejects bad configuration', () => {
    expect(() => new SwitchLogic({ positions: 1 })).toThrow();
    expect(() => new SwitchLogic({ positions: 2, values: [0] })).toThrow();
  });
});

describe('GuardLogic', () => {
  it('opens on first action and only then allows operation', () => {
    const sw = new SwitchLogic({ positions: 2 });
    const g = new GuardLogic(sw, { guardedPosition: 0 });
    expect(g.canOperate()).toBe(false);
    expect(g.toggle()).toBe('opened');
    expect(g.canOperate()).toBe(true);
  });

  it("'returns': closing pushes the switch back to the guarded position", () => {
    const sw = new SwitchLogic({ positions: 2 });
    const g = new GuardLogic(sw, { guardedPosition: 0, close: 'returns' });
    g.openGuard();
    sw.step(1);
    expect(sw.index).toBe(1);
    const r = g.closeGuard();
    expect(r.closed).toBe(true);
    expect(r.moved?.moved).toBe(true);
    expect(sw.index).toBe(0);
    expect(g.open).toBe(false);
  });

  it("'returns' also works through lever locks (the cover forces the handle)", () => {
    const sw = new SwitchLogic({ positions: 2, locked: true, initial: 1 });
    const g = new GuardLogic(sw, { guardedPosition: 0, close: 'returns', open: true });
    expect(g.closeGuard().closed).toBe(true);
    expect(sw.index).toBe(0);
  });

  it("'blocks': cannot close unless the switch is in the guarded position", () => {
    const sw = new SwitchLogic({ positions: 2 });
    const g = new GuardLogic(sw, { guardedPosition: 0, close: 'blocks' });
    g.openGuard();
    sw.step(1);
    expect(g.toggle()).toBe('blocked');
    expect(g.open).toBe(true);
    sw.step(-1);
    expect(g.toggle()).toBe('closed');
  });

  it("'free': closes and leaves the switch alone", () => {
    const sw = new SwitchLogic({ positions: 2 });
    const g = new GuardLogic(sw, { close: 'free', open: true });
    sw.step(1);
    expect(g.closeGuard()).toEqual({ closed: true, moved: null });
    expect(sw.index).toBe(1);
  });

  it('defaults to free for guarded buttons', () => {
    const g = new GuardLogic(null);
    expect(g.closeMode).toBe('free');
  });
});

describe('ButtonLogic', () => {
  it('momentary: 1 while pressed', () => {
    const b = new ButtonLogic();
    expect(b.value).toBe(0);
    expect(b.press()).toBe(true);
    expect(b.value).toBe(1);
    expect(b.press()).toBe(false);
    expect(b.release()).toBe(true);
    expect(b.value).toBe(0);
  });

  it('toggle: alternate action latches on press', () => {
    const b = new ButtonLogic({ mode: 'toggle' });
    b.press();
    expect(b.value).toBe(1);
    expect(b.release()).toBe(false);
    expect(b.value).toBe(1);
    b.press();
    b.release();
    expect(b.value).toBe(0);
  });

  it('cycle: steps through values and syncs to external values', () => {
    const b = new ButtonLogic({ mode: 'cycle', values: [0, 1, 2] });
    for (const expected of [1, 2, 0]) {
      b.press();
      b.release();
      expect(b.value).toBe(expected);
    }
    expect(b.sync(2)).toBe(true);
    expect(b.value).toBe(2);
  });
});
