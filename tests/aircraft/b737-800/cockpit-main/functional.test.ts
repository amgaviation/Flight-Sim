/**
 * Boeing 737-800 main cockpit: behaviour of the controls through their real
 * pointer handlers against the real systems (interlocks, radio tuning,
 * annunciators, wheel switches, tiller).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { buildB738Cockpit } from '../../../../src/aircraft/b737-800/cockpit';
import { CK } from '../../../../src/aircraft/b737-800/cockpit/context';
import { EYE_CAPT } from '../../../../src/aircraft/b737-800/fdm';
import { B738 } from '../../../../src/aircraft/b737-800/vars';
import { makeB738, type Rig } from '../helpers';

const P = (t: THREE.Object3D, button: 0 | 1 | 2 = 0): ControlPointer => ({ button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t });

function setup(state: 'ready_to_taxi' | 'cold_dark' = 'ready_to_taxi') {
  const r = makeB738({ state });
  const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true, mainOnly: true });
  build.root.updateMatrixWorld(true);
  const get = (id: string): CockpitControl => {
    const c = build.controls.find((x) => x.id === id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  const tick = (c: CockpitControl, s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      c.update?.(1 / 60);
      build.update?.(1 / 60);
    }
  };
  const click = (c: CockpitControl, button: 0 | 1 | 2 = 0, hold = 0.12) => {
    const t = c.hitTargets[0];
    c.onPointerDown?.(P(t, button));
    tick(c, hold);
    c.onPointerUp?.(P(t, button));
    tick(c, 0.4);
  };
  return { r, build, get, tick, click };
}

describe('Boeing 737-800 main cockpit: functions', () => {
  it('has the design eye from the dossier and the preset views', () => {
    const { build } = setup();
    expect(build.eyePosition_m).toEqual([...EYE_CAPT]);
    expect(build.views!.map((v) => v.name)).toEqual(expect.arrayContaining(['First Officer', 'MCP / glareshield', 'FMS / CDU', 'Throttle quadrant', 'Overhead']));
    build.dispose?.();
  });

  it('gear lever: UP is blocked by the lock solenoid on the ground, allowed with LOCK OVERRIDE', () => {
    const { r, get, tick } = setup();
    const lever = get('b738.mip.gear') as CockpitControl & { onWheel(d: number): void };
    const up = () => {
      lever.onWheel(1);
      tick(lever, 0.5);
    };
    r.run(0.5);
    expect(r.vars.get('gear.handle_lock')).toBe(1);
    up(); // DN -> OFF
    up(); // OFF -> UP (blocked)
    expect(r.vars.get(B738.gearLever)).toBe(0.5);
    // Hold the override trigger, then the lever goes UP.
    const ovrd = get('b738.mip.gear_ovrd');
    ovrd.onPointerDown?.(P(ovrd.hitTargets[0]));
    tick(ovrd, 0.1);
    r.run(0.1);
    up();
    ovrd.onPointerUp?.(P(ovrd.hitTargets[0]));
    expect(r.vars.get(B738.gearLever)).toBe(0);
  });

  it('reverse thrust lever: locked with the thrust lever advanced, held at reverse idle until the sleeves deploy', () => {
    const { r, get, tick } = setup();
    const rev = get('b738.ped.rev1') as CockpitControl & { onWheel(d: number): void };
    r.vars.set(B738.tla(1), 0.3);
    tick(rev, 0.1);
    for (let i = 0; i < 10; i++) rev.onWheel(1);
    tick(rev, 0.3);
    expect(r.vars.get(B738.revLever(1))).toBe(0);
    r.vars.set(B738.tla(1), 0);
    r.vars.set('eng1.reverser_pos', 0);
    tick(rev, 0.1);
    for (let i = 0; i < 20; i++) {
      rev.onWheel(1);
      tick(rev, 0.05);
    }
    expect(r.vars.get(B738.revLever(1))).toBeLessThanOrEqual(0.141);
    expect(r.vars.get(B738.revLever(1))).toBeGreaterThan(0.05);
    r.vars.set('eng1.reverser_pos', 1);
    for (let i = 0; i < 30; i++) {
      rev.onWheel(1);
      tick(rev, 0.05);
    }
    expect(r.vars.get(B738.revLever(1))).toBeGreaterThan(0.5);
  });

  it('engine fire handle: locked without a fire warning; the override releases it; rotation discharges a bottle', () => {
    const { r, get, click, tick } = setup();
    const h = get('b738.aft.fire_1');
    click(h, 0);
    expect(r.vars.get(B738.fireHandle(1))).toBe(0);
    r.vars.set(CK.fireOverride(1), 1);
    click(h, 0);
    r.vars.set(CK.fireOverride(1), 0);
    expect(r.vars.get(B738.fireHandle(1))).toBe(1);
    // Pulled handle: hold the left half = rotate to the L bottle.
    const t = h.hitTargets[0];
    h.onPointerDown?.({ ...P(t, 0), point: t.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.02, 0, 0)) });
    tick(h, 0.3);
    const rot = r.vars.get(B738.fireRot(1));
    h.onPointerUp?.(P(t, 0));
    tick(h, 0.3);
    expect(Math.abs(rot)).toBe(1);
    expect(r.vars.get(B738.fireRot(1))).toBe(0);
  });

  it('NAV 1 panel: kHz knob wraps within the MHz, TFR swaps active and standby', () => {
    const { r, get } = setup();
    r.vars.set('nav1.stby_mhz', 110.9);
    r.vars.set('nav1.active_mhz', 108.1);
    const k = get('b738.aft.nav1_freq') as CockpitControl & { turnBy(clicks: number, inner?: boolean): void };
    k.turnBy(2, true);
    expect(r.vars.get('nav1.stby_mhz')).toBeCloseTo(110.0, 3);
    k.turnBy(-3, false);
    expect(r.vars.get('nav1.stby_mhz')).toBeCloseTo(117.0, 3);
    const tfr = get('b738.aft.nav1_tfr');
    tfr.onPointerDown?.(P(tfr.hitTargets[0]));
    r.run(0.1);
    tfr.onPointerUp?.(P(tfr.hitTargets[0]));
    r.run(0.1);
    expect(r.vars.get('nav1.active_mhz')).toBeCloseTo(117.0, 3);
    expect(r.vars.get('nav1.stby_mhz')).toBeCloseTo(108.1, 3);
  });

  it('ATC code knobs step octal digits', () => {
    const { r, get } = setup();
    r.vars.set('xpdr.code', 2777);
    const k = get('b738.aft.xpdr_code_r') as CockpitControl & { turnBy(clicks: number, inner?: boolean): void };
    k.turnBy(1, true);
    expect(r.vars.get('xpdr.code')).toBe(2770);
    k.turnBy(-1, false);
    expect(r.vars.get('xpdr.code')).toBe(2760);
  });

  it('LIGHTS TEST lights the annunciators; MASTER CAUTION push extinguishes the six-pack', () => {
    const { r, get, click } = setup();
    const lt = get('b738.mip1.lights');
    click(lt, 0); // BRT -> TEST (upper half)
    r.run(0.2);
    expect(r.vars.get(B738.lightsTest)).toBe(1);
    expect(r.vars.get(B738.lt.masterCaution)).toBe(1);
    expect(r.vars.get(B738.lt.takeoffConfig)).toBe(1);
    expect(r.vars.get(CK.lampTest)).toBe(1);
    click(lt, 2); // back to BRT
    r.run(0.2);
    // A caution: hydraulic ELEC 2 pump off -> HYD group + MASTER CAUTION, cleared by the push.
    r.vars.set(B738.hydPump('elec2'), 0);
    r.run(1);
    expect(r.vars.get(B738.lt.group('hyd'))).toBe(1);
    const mc = get('b738.gs.master_caution1');
    mc.onPointerDown?.(P(mc.hitTargets[0]));
    r.run(0.2);
    mc.onPointerUp?.(P(mc.hitTargets[0]));
    r.run(0.2);
    expect(r.vars.get(B738.lt.group('hyd'))).toBe(0);
    expect(r.vars.get(B738.lt.masterCaution)).toBe(0);
  });

  it('control wheel trim switch trims the stabilizer; the A/P disengage switch disconnects the autopilot', () => {
    const { r, get, tick } = setup();
    r.run(0.5);
    const u0 = r.vars.get('trim.pitch_units');
    const sw = get('b738.fc.trim1') as CockpitControl & { onWheel(d: number): void };
    // Hold NOSE UP (bottom position) for 2 s.
    const t = sw.hitTargets[0];
    const low = t.getWorldPosition(new THREE.Vector3());
    sw.onPointerDown?.({ ...P(t, 2), point: low });
    for (let i = 0; i < 120; i++) {
      tick(sw, 1 / 60);
      r.run(1 / 60);
    }
    sw.onPointerUp?.(P(t, 2));
    r.run(0.3);
    expect(Math.abs(r.vars.get('trim.pitch_units') - u0)).toBeGreaterThan(0.2);
    let disc = 0;
    r.events.on('ap.disc', () => disc++);
    const d = get('b738.fc.ap_disc1');
    d.onPointerDown?.(P(d.hitTargets[0]));
    d.onPointerUp?.(P(d.hitTargets[0]));
    expect(disc).toBe(1);
  });

  it('tiller handle steers the nose wheel through the logic merge', () => {
    const { r, get } = setup();
    const t = get('b738.fc.tiller') as CockpitControl & { turnBy(clicks: number, inner?: boolean): void };
    t.turnBy(10);
    r.run(3);
    expect(r.vars.get(B738.tiller3d)).toBeCloseTo(0.5, 3);
    expect(r.vars.get(B738.tillerCmd)).toBeCloseTo(0.5, 3);
    expect(r.vars.get('gear.steer_deg')).toBeGreaterThan(30);
  });
});

export type { Rig };
