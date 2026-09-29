import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { INPUT } from '../../src/core/vars';
import { COCKPIT_VARS } from '../../src/cockpit/types';
import { createStorage, MemoryBackend } from '../../src/platform/storage';
import {
  ACTIONS,
  CalibrationRecorder,
  calibrateBipolar,
  calibrateUnipolar,
  CommandRouter,
  curveBipolar,
  decodeHat,
  DEFAULT_KEY_BINDINGS,
  deadzoneBipolar,
  defaultProfile,
  INPUT_EVENTS,
  InputManager,
  processBipolar,
  processUnipolar,
  rampKeyAxis,
  sanitizeProfile,
  THROTTLE_SLEW_PER_S,
} from '../../src/input';

describe('axis math', () => {
  it('calibrates bipolar axes around an off-centre rest position', () => {
    const cal = { min: -0.9, center: 0.1, max: 0.95 };
    expect(calibrateBipolar(0.1, cal)).toBeCloseTo(0, 9);
    expect(calibrateBipolar(0.95, cal)).toBeCloseTo(1, 9);
    expect(calibrateBipolar(-0.9, cal)).toBeCloseTo(-1, 9);
    expect(calibrateBipolar(-0.4, cal)).toBeCloseTo(-0.5, 9);
    expect(calibrateBipolar(2, cal)).toBe(1);
    // Reversed hardware (min > max) flips the sign.
    expect(calibrateBipolar(0.9, { min: 1, center: 0, max: -1 })).toBeCloseTo(-0.9, 9);
  });

  it('calibrates unipolar axes and applies invert, deadzone and curve', () => {
    const cal = { min: -1, center: 0, max: 1 };
    expect(calibrateUnipolar(0, cal)).toBeCloseTo(0.5, 9);
    expect(processUnipolar(-1, cal, { invert: true, deadzone: 0, curve: 0, sensitivity: 1 })).toBeCloseTo(1, 9);
    expect(processUnipolar(-0.98, cal, { invert: false, deadzone: 0.04, curve: 0, sensitivity: 1 })).toBe(0);
    expect(deadzoneBipolar(0.03, 0.05)).toBe(0);
    expect(deadzoneBipolar(1, 0.05)).toBeCloseTo(1, 9);
    expect(deadzoneBipolar(-0.525, 0.05)).toBeCloseTo(-0.5, 9);
    expect(curveBipolar(0.5, 1)).toBeCloseTo(0.125, 9);
    expect(processBipolar(1, cal, { invert: true, deadzone: 0, curve: 0, sensitivity: 0.5 })).toBeCloseTo(-0.5, 9);
  });

  it('ramps keyboard axes and springs them back', () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = rampKeyAxis(v, 1, 1 / 60, 2, 3);
    expect(v).toBeCloseTo(1, 9);
    for (let i = 0; i < 10; i++) v = rampKeyAxis(v, 0, 1 / 60, 2, 3);
    expect(v).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 60; i++) v = rampKeyAxis(v, 0, 1 / 60, 2, 3);
    expect(v).toBe(0);
  });

  it('records calibration sweeps and decodes POV hats', () => {
    const r = new CalibrationRecorder();
    for (const x of [0, -0.8, 0.9, 0.05]) r.add(x);
    expect(r.result()).toEqual({ min: -0.8, center: 0.05, max: 0.9 });
    expect(decodeHat(-1)).toEqual({ x: 0, y: 1 });
    expect(decodeHat(-1 + 4 / 7)).toEqual({ x: 1, y: 0 });
    expect(decodeHat(-1 + 8 / 7)).toEqual({ x: 0, y: -1 });
    expect(decodeHat(3.2857)).toBeNull();
  });
});

describe('key bindings', () => {
  it('bind only known actions and have no duplicate chords', () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    const seen = new Set<string>();
    for (const b of DEFAULT_KEY_BINDINGS) {
      expect(ids.has(b.action)).toBe(true);
      const k = `${b.ctrl ? 'C' : ''}${b.shift ? 'S' : ''}${b.alt ? 'A' : ''}${b.code}`;
      expect(seen.has(k), `duplicate chord ${k}`).toBe(false);
      seen.add(k);
    }
  });
});

class FakeTarget {
  private readonly l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, fn: (e: unknown) => void): void {
    this.l.set(t, [...(this.l.get(t) ?? []), fn]);
  }
  removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.l.set(t, (this.l.get(t) ?? []).filter((f) => f !== fn));
  }
  key(type: 'keydown' | 'keyup', code: string, mods: { ctrl?: boolean; shift?: boolean } = {}): { prevented: boolean } {
    const r = { prevented: false };
    const e = {
      code,
      ctrlKey: !!mods.ctrl,
      metaKey: false,
      shiftKey: !!mods.shift,
      altKey: false,
      repeat: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => (r.prevented = true),
      stopPropagation: () => undefined,
    };
    for (const fn of this.l.get(type) ?? []) fn(e);
    return r;
  }
}

function makeInput(pads: () => readonly (Gamepad | null)[] = () => []) {
  const vars = new SimVars();
  const events = new EventBus();
  const target = new FakeTarget();
  const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), parentElement: null } as unknown as HTMLElement;
  const im = new InputManager({
    vars,
    events,
    viewElement: el,
    storage: createStorage('input', new MemoryBackend()),
    keyTarget: target as unknown as Window,
    getGamepads: pads,
  });
  return { vars, events, target, im };
}

describe('InputManager', () => {
  it('ramps keyboard pitch and emits press events', () => {
    const { vars, events, target, im } = makeInput();
    const got: string[] = [];
    events.onAny((n) => got.push(n));
    expect(target.key('keydown', 'ArrowDown').prevented).toBe(true);
    for (let i = 0; i < 60; i++) im.poll(1 / 60);
    expect(vars.get(INPUT.pitch)).toBeCloseTo(1, 6); // ArrowDown = pull = nose up
    target.key('keyup', 'ArrowDown');
    for (let i = 0; i < 60; i++) im.poll(1 / 60);
    expect(vars.get(INPUT.pitch)).toBe(0);
    target.key('keydown', 'KeyG');
    target.key('keyup', 'KeyG');
    expect(got).toContain(INPUT_EVENTS.gearToggle);
    // Ctrl+. is the parking brake, plain '.' holds the brakes.
    target.key('keydown', 'Period', { ctrl: true });
    expect(got).toContain(INPUT_EVENTS.parkingBrakeToggle);
    target.key('keyup', 'Period');
    target.key('keydown', 'Period');
    im.poll(1 / 60);
    expect(vars.get(INPUT.brakeLeft)).toBe(1);
    target.key('keyup', 'Period');
    im.poll(1 / 60);
    expect(vars.get(INPUT.brakeLeft)).toBe(0);
  });

  it('gives the dragged 3D yoke priority and merges toe brakes', () => {
    const { vars, target, im } = makeInput();
    target.key('keydown', 'ArrowLeft');
    for (let i = 0; i < 60; i++) im.poll(1 / 60);
    expect(vars.get(INPUT.roll)).toBeCloseTo(-1, 6);
    vars.set(COCKPIT_VARS.yokeActive, 1);
    vars.set(COCKPIT_VARS.yokeRoll, 0.3);
    vars.set(COCKPIT_VARS.toeBrakeRight, 0.7);
    im.poll(1 / 60);
    expect(vars.get(INPUT.roll)).toBeCloseTo(0.3, 9);
    expect(vars.get(INPUT.brakeRight)).toBeCloseTo(0.7, 9);
  });

  it('ignores flight keys while disabled but still opens the menu', () => {
    const { events, target, im } = makeInput();
    const got: string[] = [];
    events.onAny((n) => got.push(n));
    im.enabled = false;
    expect(target.key('keydown', 'KeyG').prevented).toBe(false);
    target.key('keydown', 'Escape');
    expect(got).toEqual(['ui.menu']);
  });

  it('reads hardware axes and buttons from a joystick profile', () => {
    const pad = {
      id: 'Generic Joystick (Vendor: 1234 Product: 5678)',
      index: 0,
      mapping: '',
      connected: true,
      axes: [0.5, -1, 1, 0],
      buttons: Array.from({ length: 8 }, (_, i) => ({ pressed: i === 6, value: i === 6 ? 1 : 0, touched: false })),
    } as unknown as Gamepad;
    const { vars, events, im } = makeInput(() => [pad]);
    const got: string[] = [];
    events.onAny((n) => got.push(n));
    im.poll(1 / 60);
    const prof = defaultProfile(pad);
    expect(prof.axes[0].target).toBe('roll');
    // Default joystick curve 0.2 softens the centre: 0.5 raw (after the 3 % deadzone) reads about 0.41.
    expect(vars.get(INPUT.roll)).toBeCloseTo(0.41, 2);
    expect(vars.get(INPUT.pitch)).toBeCloseTo(-1, 6); // stick fully forward = nose down
    // Axis 2 is an inverted throttle on a 4-axis stick: +1 raw = idle.
    expect(vars.get(INPUT.throttle(1))).toBeCloseTo(0, 6);
    expect(vars.get(INPUT.throttleBound)).toBe(1);
    expect(got).toContain(INPUT_EVENTS.gearToggle); // button 6 = gear
  });

  it('sanitizes stored profiles', () => {
    const info = { id: 'X', mapping: 'standard', axes: [0, 0, 0, 0], buttons: [] };
    expect(sanitizeProfile({ version: 1, axes: { 0: { target: 'bogus' }, 1: { target: 'yaw', cal: { min: -1, center: 0, max: 1 } } }, buttons: { 3: 'gear.toggle' } }, info)).toMatchObject({
      axes: { 1: { target: 'yaw' } },
      buttons: { 3: 'gear.toggle' },
    });
    expect(sanitizeProfile('garbage', info).axes[0].target).toBe('roll');
  });
});

describe('CommandRouter', () => {
  function router() {
    const vars = new SimVars();
    const events = new EventBus();
    const r = new CommandRouter(vars, events);
    r.setMap({
      throttles: ['ac.tla1', 'ac.tla2'],
      reverse: { value: -0.3 },
      flaps: { var: 'ac.flap_lever', detents: [0, 1, 2, 3] },
      gear: { var: 'ac.gear_handle', up: 0, down: 1 },
      speedbrake: { var: 'ac.sb', positions: [0, 0.1, 1], armed: 0.1 },
      parkingBrake: { var: 'ac.park', on: 1, off: 0 },
      apToggleEvent: 'ap.ap_push',
    });
    return { vars, events, r };
  }

  it('slews throttles, pulls into reverse at idle and returns via idle', () => {
    const { vars, r } = router();
    r.throttleRate = 1;
    for (let i = 0; i < 30; i++) r.update(1 / 60);
    expect(vars.get('ac.tla1')).toBeCloseTo(0.5 * THROTTLE_SLEW_PER_S, 6);
    r.throttleRate = -1;
    for (let i = 0; i < 600; i++) r.update(1 / 60);
    expect(vars.get('ac.tla2')).toBeCloseTo(-0.3, 6);
    r.throttleRate = 1;
    for (let i = 0; i < 600; i++) r.update(1 / 60);
    expect(vars.get('ac.tla1')).toBeCloseTo(1, 6);
  });

  it('steps flaps, toggles gear (with ground lock), speedbrake, parking brake and forwards AP', () => {
    const { vars, events } = router();
    const got: string[] = [];
    events.onAny((n) => got.push(n));
    vars.set('ac.flap_lever', 1);
    events.emit(INPUT_EVENTS.flapsDown);
    expect(vars.get('ac.flap_lever')).toBe(2);
    events.emit(INPUT_EVENTS.flapsFullUp);
    expect(vars.get('ac.flap_lever')).toBe(0);
    vars.set('ac.gear_handle', 1);
    vars.set('fdm.on_ground', 1);
    events.emit(INPUT_EVENTS.gearToggle);
    expect(vars.get('ac.gear_handle')).toBe(1);
    vars.set('fdm.on_ground', 0);
    events.emit(INPUT_EVENTS.gearToggle);
    expect(vars.get('ac.gear_handle')).toBe(0);
    events.emit(INPUT_EVENTS.spoilersArm);
    expect(vars.get('ac.sb')).toBe(0.1);
    events.emit(INPUT_EVENTS.spoilersToggle);
    expect(vars.get('ac.sb')).toBe(1);
    events.emit(INPUT_EVENTS.spoilersToggle);
    expect(vars.get('ac.sb')).toBe(0);
    events.emit(INPUT_EVENTS.parkingBrakeToggle);
    expect(vars.get('ac.park')).toBe(1);
    events.emit(INPUT_EVENTS.apToggle);
    expect(got).toContain('ap.ap_push');
  });

  it('follows a hardware throttle axis over the forward range', () => {
    const { vars, r } = router();
    r.hwThrottle[0] = 0.25;
    r.hwThrottle[1] = 0.75;
    r.update(1 / 60);
    expect(vars.get('ac.tla1')).toBeCloseTo(0.25, 9);
    expect(vars.get('ac.tla2')).toBeCloseTo(0.75, 9);
  });
});
