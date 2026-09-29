import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import type { AudioApi } from '../../src/core/SimContext';
import { ALERT } from '../../src/core/vars';
import { createCockpitEnv, type CockpitEnv } from '../../src/cockpit/env';
import type { CockpitControl, ControlPointer } from '../../src/cockpit/types';
import { COCKPIT_SOUNDS, COCKPIT_VARS } from '../../src/cockpit/types';
import {
  CircuitBreaker,
  GearHandle,
  GuardedSwitch,
  KeyPad,
  Lever,
  PushButton,
  PushPullKnob,
  RockerSwitch,
  RotaryKnob,
  SelectorKnob,
  TBarHandle,
  ToggleSwitch,
  TrimWheel,
  Yoke,
} from '../../src/cockpit/controls';
import { buildDemoCockpit } from '../../src/cockpit/demo/DemoPanel';
import { CockpitRuntime } from '../../src/cockpit/CockpitRuntime';

function makeEnv(): { env: CockpitEnv; vars: SimVars; events: EventBus; sounds: string[] } {
  const vars = new SimVars();
  const events = new EventBus();
  const sounds: string[] = [];
  const audio: AudioApi = {
    play: (id) => void sounds.push(id),
    loop: () => ({ setGain() {}, setRate() {}, stop() {} }),
    callout() {},
    tone() {},
  };
  const env = createCockpitEnv({ vars, events, audio }, { palette: 'boeing' });
  return { env, vars, events, sounds };
}

/** A pointer on a control's hit target at a local offset (control frame). */
function ptr(c: CockpitControl, button: 0 | 1 | 2 = 0, local = new THREE.Vector3(0, 0, 0.01), target = c.hitTargets[0], mods: Partial<ControlPointer> = {}): ControlPointer {
  c.object.updateWorldMatrix(true, true);
  return { button, shift: false, ctrl: false, alt: false, point: c.object.localToWorld(local.clone()), object: target, ...mods };
}

function click(c: CockpitControl, button: 0 | 1 | 2 = 0, local?: THREE.Vector3, target?: THREE.Object3D, mods?: Partial<ControlPointer>) {
  const p = ptr(c, button, local, target, mods);
  c.onPointerDown?.(p);
  c.onPointerUp?.(p);
}

function run(c: CockpitControl, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) c.update?.(dt);
}

describe('ToggleSwitch', () => {
  it('toggles, writes its var, plays the sound and initializes an unset var', () => {
    const { env, vars, sounds } = makeEnv();
    const s = new ToggleSwitch(env, { id: 'batt', var: 'ac.batt', label: 'BATT' });
    expect(vars.has('ac.batt')).toBe(true);
    expect(s.tooltip()).toBe('BATT: OFF');
    click(s);
    expect(vars.get('ac.batt')).toBe(1);
    expect(sounds).toContain(COCKPIT_SOUNDS.toggle);
    expect(s.tooltip()).toBe('BATT: ON');
    click(s, 2);
    expect(vars.get('ac.batt')).toBe(0);
  });

  it('3-position: clicks move toward the clicked half; momentary position springs back on release', () => {
    const { env, vars, events } = makeEnv();
    const started: unknown[] = [];
    events.on('eng.start', () => started.push(1));
    const s = new ToggleSwitch(env, { id: 'start', var: 'ac.start', positions: ['DISENG', 'OFF', 'START'], initial: 1, springs: { 2: 1 }, events: { 2: 'eng.start' } });
    const up = ptr(s, 0, new THREE.Vector3(0, 0.008, 0.01));
    s.onPointerDown?.(up);
    expect(vars.get('ac.start')).toBe(2);
    expect(started.length).toBe(1);
    run(s, 1); // held: stays
    expect(vars.get('ac.start')).toBe(2);
    s.onPointerUp?.(up);
    expect(vars.get('ac.start')).toBe(1);
    click(s, 0, new THREE.Vector3(0, -0.008, 0.01));
    expect(vars.get('ac.start')).toBe(0);
  });

  it('lever-lock: the move happens after the pull animation', () => {
    const { env, vars } = makeEnv();
    const s = new ToggleSwitch(env, { id: 'll', var: 'ac.ll', leverLock: true });
    click(s);
    expect(vars.get('ac.ll')).toBe(0); // pulling
    run(s, 0.2);
    expect(vars.get('ac.ll')).toBe(1);
    expect(s.logic.pulled).toBe(false);
  });

  it('follows external var writes (solenoid release)', () => {
    const { env, vars } = makeEnv();
    const s = new ToggleSwitch(env, { id: 'x', var: 'ac.x', positions: ['OFF', 'GRD'] });
    click(s);
    vars.set('ac.x', 0);
    s.update?.(1 / 60);
    expect(s.index).toBe(0);
  });
});

describe('GuardedSwitch', () => {
  it('first click opens the guard, then operates the switch; closing returns it', () => {
    const { env, vars, sounds } = makeEnv();
    const g = new GuardedSwitch(env, { id: 'stby', var: 'ac.stby', positions: ['AUTO', 'BAT'], guard: { guardedPosition: 0, var: 'ac.stby_guard' } });
    const guardHit = g.hitTargets[0];
    const switchHit = g.hitTargets[1];
    // Clicking the switch area with the guard closed does nothing.
    click(g, 0, undefined, switchHit);
    expect(vars.get('ac.stby')).toBe(0);
    click(g, 0, undefined, guardHit);
    expect(g.guard.open).toBe(true);
    expect(vars.get('ac.stby_guard')).toBe(1);
    expect(sounds).toContain(COCKPIT_SOUNDS.guardOpen);
    click(g, 0, undefined, switchHit);
    expect(vars.get('ac.stby')).toBe(1);
    click(g, 0, undefined, guardHit);
    expect(g.guard.open).toBe(false);
    expect(vars.get('ac.stby')).toBe(0);
    expect(g.tooltip()).toContain('guard CLOSED');
  });
});

describe('PushButton', () => {
  it('momentary var/event, toggle latching and annunciator segments', () => {
    const { env, vars, events } = makeEnv();
    let pushes = 0;
    events.on('ap.hdg_push', () => pushes++);
    const m = new PushButton(env, { id: 'hdg', var: 'ac.hdg_btn', event: 'ap.hdg_push' });
    const p = ptr(m);
    m.onPointerDown?.(p);
    expect(vars.get('ac.hdg_btn')).toBe(1);
    m.onPointerUp?.(p);
    expect(vars.get('ac.hdg_btn')).toBe(0);
    expect(pushes).toBe(1);

    const t = new PushButton(env, {
      id: 'gen',
      var: 'ac.gen',
      mode: 'toggle',
      segments: [
        { text: 'FAIL', color: 'amber', var: 'ac.gen_fail' },
        { text: 'ON', color: 'green', whenOn: true },
      ],
    });
    click(t);
    expect(vars.get('ac.gen')).toBe(1);
    t.update?.(0.1);
    expect(t.face?.isLit(1)).toBe(true);
    expect(t.face?.isLit(0)).toBe(false);
    vars.set('ac.gen_fail', 1);
    t.update?.(0.1);
    expect(t.face?.isLit(0)).toBe(true);
    expect(t.tooltip()).toContain('FAIL');
    // External unlatch.
    vars.set('ac.gen', 0);
    t.update?.(0.1);
    expect(t.value).toBe(0);
  });

  it('lamp test lights every segment', () => {
    const { env, vars } = makeEnv();
    const b = new PushButton(env, { id: 'x', segments: [{ text: 'A', color: 'red', var: 'ac.a' }] });
    vars.set(ALERT.annunTest, 1);
    run(b, 0.3);
    const mat = (b.face!.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBeGreaterThan(1);
    vars.set(ALERT.annunTest, 0);
    run(b, 0.5);
    expect(mat.emissiveIntensity).toBeLessThan(0.01);
  });
});

describe('RotaryKnob / SelectorKnob', () => {
  it('concentric knob: wheel turns outer; Shift or the inner cap turns inner; push writes the push var', () => {
    const { env, vars, events } = makeEnv();
    let inc = 0;
    events.on('fms.inner_inc', (n) => (inc += n as number));
    const k = new RotaryKnob(env, {
      id: 'fms',
      outer: { var: 'ac.crs', min: 0, max: 360, wrap: true, step: 1 },
      inner: { incEvent: 'fms.inner_inc', decEvent: 'fms.inner_dec' },
      push: { var: 'ac.push' },
    });
    const outerHit = k.hitTargets.find((h) => h === k.outer.hit)!;
    const innerHit = k.inner!.hit!;
    k.onWheel?.(1, ptr(k, 0, undefined, outerHit));
    expect(vars.get('ac.crs')).toBe(1);
    k.onWheel?.(-3, ptr(k, 0, undefined, outerHit));
    expect(vars.get('ac.crs')).toBe(358);
    k.onWheel?.(1, ptr(k, 0, undefined, outerHit, { shift: true }));
    k.onWheel?.(1, ptr(k, 0, undefined, innerHit));
    expect(inc).toBe(2);
    const p = ptr(k, 1, undefined, outerHit);
    k.onPointerDown?.(p);
    expect(vars.get('ac.push')).toBe(1);
    k.onPointerUp?.(p);
    expect(vars.get('ac.push')).toBe(0);
  });

  it('selector with spring position and follow of external var', () => {
    const { env, vars } = makeEnv();
    const s = new SelectorKnob(env, {
      id: 'mags',
      var: 'eng1.mags',
      positions: [
        { value: 0, label: 'OFF' },
        { value: 3, label: 'BOTH' },
        { value: 4, label: 'START', spring: 1 },
      ],
    });
    const p = ptr(s);
    s.onPointerDown?.(p);
    s.onPointerUp?.(p);
    expect(vars.get('eng1.mags')).toBe(3);
    s.onPointerDown?.(p);
    expect(vars.get('eng1.mags')).toBe(4);
    s.onPointerUp?.(p);
    expect(vars.get('eng1.mags')).toBe(3);
    vars.set('eng1.mags', 0);
    s.update?.(0.1);
    expect(s.tooltip()).toContain('OFF');
  });
});

describe('Lever', () => {
  it('drags with detents and gates, clicks step, follows hardware axis', () => {
    const { env, vars } = makeEnv();
    const l = new Lever(env, {
      id: 'tl',
      var: 'ac.tla',
      min: -0.3,
      max: 1,
      initial: 0.5,
      detents: [
        { value: -0.3, label: 'REV' },
        { value: 0, label: 'IDLE', kind: 'gate', direction: 'decreasing' },
        { value: 1, label: 'TO' },
      ],
      axis: { var: 'input.throttle1' },
    });
    // Drag down (toward min) past IDLE: stops at the gate.
    const p = ptr(l);
    l.onPointerDown?.(p);
    l.onDrag?.(0, 250, p);
    l.onPointerUp?.(p);
    expect(vars.get('ac.tla')).toBe(0);
    expect(l.tooltip()).toContain('IDLE');
    // Click right = one detent toward min (deliberate lift over the gate).
    click(l, 2);
    expect(vars.get('ac.tla')).toBeCloseTo(-0.3, 9);
    // Hardware axis takes over.
    vars.set('input.throttle_axis_bound', 1);
    vars.set('input.throttle1', 1);
    l.update?.(1 / 60);
    expect(vars.get('ac.tla')).toBe(1);
    expect(l.tooltip()).toContain('hardware axis');
  });
});

describe('Gear handle, breakers, handles, trim, keypad, yoke', () => {
  it('gear handle pulls, moves and respects the ground interlock', () => {
    const { env, vars, sounds } = makeEnv();
    const g = new GearHandle(env, { id: 'gear', var: 'ac.gear', inhibit: (to, _f, v) => !(to === 1 && v.get('gear.wow1') !== 0) });
    vars.set('gear.wow1', 1);
    click(g);
    run(g, 0.5);
    expect(vars.get('ac.gear')).toBe(0);
    expect(sounds).toContain(COCKPIT_SOUNDS.leverGate);
    vars.set('gear.wow1', 0);
    click(g);
    run(g, 0.5);
    expect(vars.get('ac.gear')).toBe(1);
  });

  it('circuit breaker pull/push and system trip', () => {
    const { env, vars, sounds } = makeEnv();
    const cb = new CircuitBreaker(env, { id: 'cb', var: 'ac.cb', trippedVar: 'ac.cb_trip', rating: 5 });
    expect(vars.get('ac.cb')).toBe(1);
    click(cb);
    expect(vars.get('ac.cb')).toBe(0);
    expect(cb.tooltip()).toContain('PULLED');
    click(cb);
    expect(vars.get('ac.cb')).toBe(1);
    vars.set('ac.cb', 0);
    vars.set('ac.cb_trip', 1);
    cb.update?.(0.1);
    expect(cb.tooltip()).toContain('TRIPPED');
    expect(sounds).toContain(COCKPIT_SOUNDS.cbTrip);
    click(cb);
    expect(vars.get('ac.cb_trip')).toBe(0);
  });

  it('T-handle parking brake and fire handle', () => {
    const { env, vars } = makeEnv();
    const park = new TBarHandle(env, { id: 'park', var: 'ac.park', rotate: 'lock', springIn: true });
    click(park);
    expect(vars.get('ac.park')).toBe(1); // pulled and locked
    click(park);
    expect(vars.get('ac.park')).toBe(0);
    const fire = new TBarHandle(env, { id: 'fire', style: 'fire', var: 'ac.fire', rotateVar: 'ac.fire_rot', unlockVar: 'ac.fire_warn', legend: 'ENG 1', lightVar: 'ac.fire_warn' });
    click(fire);
    expect(vars.get('ac.fire')).toBe(0); // locked
    vars.set('ac.fire_warn', 1);
    click(fire);
    expect(vars.get('ac.fire')).toBe(1);
    const left = ptr(fire, 0, new THREE.Vector3(-0.02, 0, 0.03));
    fire.onPointerDown?.(left);
    expect(vars.get('ac.fire_rot')).toBe(-1);
    fire.onPointerUp?.(left);
    expect(vars.get('ac.fire_rot')).toBe(0);
  });

  it('push-pull knob drag and vernier', () => {
    const { env, vars } = makeEnv();
    const k = new PushPullKnob(env, { id: 'mix', var: 'eng1.mixture', style: 'mixture' });
    expect(vars.get('eng1.mixture')).toBe(1); // default fully in = rich
    const p = ptr(k);
    k.onPointerDown?.(p);
    k.onDrag?.(0, 125, p); // pull half out
    k.onPointerUp?.(p);
    expect(vars.get('eng1.mixture')).toBeCloseTo(0.5, 6);
    k.onWheel?.(1, p);
    expect(vars.get('eng1.mixture')).toBeCloseTo(0.51, 6);
  });

  it('trim wheel: manual input writes the var and electric trim spins the wheel', () => {
    const { env, vars } = makeEnv();
    const t = new TrimWheel(env, { id: 'trim', var: 'ac.trim', perRev: 0.25 });
    t.onWheel?.(-24, ptr(t)); // one full revolution toward nose up
    expect(vars.get('ac.trim')).toBeCloseTo(0.25, 9);
    vars.set('ac.trim', -0.5);
    run(t, 0.5);
    expect(t.logic.value).toBe(-0.5);
  });

  it('keypad emits per-key events and accepts keyboard input', () => {
    const { env, events } = makeEnv();
    const got: string[] = [];
    events.onAny((n) => got.push(n));
    const kp = new KeyPad(env, { id: 'cdu', eventPrefix: 'fmc.l.key.', keyboard: true, rows: [[{ id: 'A' }, { id: 'B' }], [{ id: 'EXEC', lightVar: 'fms.mod_pending' }]] });
    const hitB = kp.hitTargets[1];
    click(kp, 0, undefined, hitB);
    expect(got).toEqual(['fmc.l.key.B']);
    expect(kp.onKey?.('a', 'KeyA', true, false)).toBe(true);
    kp.onKey?.('a', 'KeyA', false, false);
    expect(kp.onKey?.('Enter', 'Enter', true, false)).toBe(true);
    expect(got).toEqual(['fmc.l.key.B', 'fmc.l.key.A', 'fmc.l.key.EXEC']);
    expect(kp.onKey?.('q', 'KeyQ', true, false)).toBe(false);
  });

  it('yoke drag writes the cockpit yoke vars; sub-controls ride on the wheel', () => {
    const { env, vars } = makeEnv();
    const y = new Yoke(env, {
      id: 'yoke',
      style: 'boeing',
      switches: [{ anchor: 'leftOutboard', kind: 'button', options: { id: 'apdisc', var: 'input.ap_disc' } }],
    });
    expect(y.subControls.length).toBe(1);
    const p = ptr(y);
    y.onPointerDown?.(p);
    y.onDrag?.(110, -55, p);
    expect(vars.get(COCKPIT_VARS.yokeActive)).toBe(1);
    expect(vars.get(COCKPIT_VARS.yokeRoll)).toBeCloseTo(0.5, 6);
    expect(vars.get(COCKPIT_VARS.yokePitch)).toBeCloseTo(-0.25, 6);
    run(y, 0.5);
    expect(y.wheel.rotation.z).toBeLessThan(0); // rolled right = clockwise from the pilot
    y.onPointerUp?.(p);
    expect(vars.get(COCKPIT_VARS.yokeActive)).toBe(0);
    // AP disconnect on the wheel.
    const b = y.subControls[0];
    b.onPointerDown?.(ptr(b));
    expect(vars.get('input.ap_disc')).toBe(1);
  });

  it('rocker with momentary ends', () => {
    const { env, vars } = makeEnv();
    const r = new RockerSwitch(env, { id: 'trim', var: 'ac.trim_sw', positions: ['DN', 'OFF', 'UP'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 } });
    const top = ptr(r, 0, new THREE.Vector3(0, 0.005, 0.005));
    r.onPointerDown?.(top);
    expect(vars.get('ac.trim_sw')).toBe(1);
    r.onPointerUp?.(top);
    expect(vars.get('ac.trim_sw')).toBe(0);
  });
});

describe('Demo cockpit', () => {
  it('builds, consolidates static meshes and runs frames without errors', () => {
    const vars = new SimVars();
    const events = new EventBus();
    const build = buildDemoCockpit({ vars, events });
    const ids = new Set(build.controls.map((c) => c.id));
    expect(ids.size).toBe(build.controls.length);
    expect(build.controls.length).toBeGreaterThan(35);
    expect(build.displays.length).toBe(2); // touch display + round gauge
    expect(build.mergeStats?.instanced).toBeGreaterThan(0);
    expect(build.mergeStats?.outputMeshes).toBeLessThan(build.mergeStats!.inputMeshes);
    expect(build.lighting?.map((z) => z.id)).toEqual(expect.arrayContaining(['panel', 'flood', 'dome']));
    const rt = new CockpitRuntime({ build, vars });
    vars.set('ac.demo.batt', 1);
    vars.set('ac.light.panel', 1);
    for (let i = 0; i < 180; i++) rt.update(1 / 60);
    expect(vars.get('ac.demo.bus_v')).toBeGreaterThan(20);
    expect(vars.get('display.demo.ready')).toBe(1);
    expect(env0(build).lighting.level('panel')).toBeCloseTo(1, 3);
    // Every control has hit targets and a tooltip.
    for (const c of build.controls) {
      expect(c.hitTargets.length).toBeGreaterThan(0);
      expect(typeof c.tooltip()).toBe('string');
    }
    rt.dispose();
  });
});

function env0(b: ReturnType<typeof buildDemoCockpit>): CockpitEnv {
  return b.env;
}
