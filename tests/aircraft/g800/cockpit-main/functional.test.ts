/**
 * G800 main cockpit driven through its 3D controls against the real systems
 * (headless rig with the Symmetry suite): the controls produce the documented
 * system reactions and honour their interlocks, not just var changes.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { InitialState } from '../../../../src/aircraft/types';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
import { cockpitRig } from './rig';

async function setup(state: InitialState) {
  const { r, ck } = await cockpitRig(state);
  const build = ck.build;
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = (id: string): CockpitControl => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  /** Advances the cockpit (controls + hooks) and the systems/FDM together. */
  const step = (s: number) => {
    const n = Math.round(s * 60);
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  return { r, build, ctl, step };
}

function p(c: CockpitControl, button: 0 | 1 | 2 = 0, target = c.hitTargets[0], local?: THREE.Vector3): ControlPointer {
  const point = local ? target.localToWorld(local.clone()) : target.getWorldPosition(new THREE.Vector3());
  return { button, shift: false, ctrl: false, alt: false, point, object: target };
}

function click(c: CockpitControl, button: 0 | 1 | 2 = 0) {
  c.onPointerDown?.(p(c, button));
  c.onPointerUp?.(p(c, button));
}

describe('G800 cockpit: controls drive the systems', () => {
  it('gear handle is held DOWN by the ground lock; DN LOCK RELEASE overrides it', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    expect(r.vars.get('gear.handle_lock')).toBe(1);
    const gear = ctl('g800.kp.gear');
    click(gear); // try UP
    step(0.5);
    expect(r.vars.get(V.gearHandle)).toBe(1); // still DN
    // Hold DN LOCK RELEASE, then move the handle.
    const rel = ctl('g800.kp.dn_lock_rel');
    rel.onPointerDown?.(p(rel));
    step(0.3);
    expect(r.vars.get('gear.handle_lock')).toBe(0);
    click(gear);
    step(0.3);
    rel.onPointerUp?.(p(rel));
    expect(r.vars.get(V.gearHandle)).toBe(0);
  });

  it('power levers, reverse interlock and flap handle', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.3);
    // Reverse lever raises only with the power lever at IDLE.
    const rev = ctl('g800.ped.rev1');
    click(rev); // next detent up
    step(0.3);
    expect(r.vars.get(V.rev(1))).toBeGreaterThan(0.2);
    click(rev, 2);
    click(rev, 2);
    step(0.3);
    expect(r.vars.get(V.rev(1))).toBeLessThan(0.02);
    const pl = ctl('g800.ped.pl1');
    click(pl); // one detent toward MAX
    step(0.3);
    expect(r.vars.get(V.tla(1))).toBeGreaterThan(0.5);
    click(rev);
    step(0.3);
    expect(r.vars.get(V.rev(1))).toBeLessThan(0.02); // locked out above IDLE
    // Flap handle steps UP -> 10 -> 20 -> 39 and the flaps follow.
    const flaps = ctl('g800.ped.flaps');
    const f0 = r.vars.get(V.flapLever);
    click(flaps);
    step(0.3);
    expect(r.vars.get(V.flapLever)).toBe(f0 + 1);
    step(12);
    expect(r.vars.get('surf.flaps_deg')).toBeGreaterThan(30);
  });

  it('sidestick AP DISC disconnects the autopilot; the stick is back-driven by the AP', { timeout: 180_000 }, async () => {
    const { r, build, ctl, step } = await setup('cruise');
    step(1);
    expect(r.vars.get('ap.engaged')).toBe(1);
    // Back-drive: while the AP flies, the pilot stick shows the servo command.
    r.vars.set('ap.servo_roll', 0.5);
    const stick = ctl('g800.fc.stick_l') as CockpitControl & { stick: THREE.Group };
    for (let i = 0; i < 30; i++) stick.update?.(1 / 60);
    expect(Math.abs(stick.stick.rotation.z)).toBeGreaterThan(0.05);
    const disc = ctl('g800.fc.ap_disc_l');
    disc.onPointerDown?.(p(disc));
    step(0.2);
    expect(r.vars.get(V.ssDisc(1))).toBe(1);
    disc.onPointerUp?.(p(disc));
    step(0.2);
    expect(r.vars.get('ap.engaged')).toBe(0);
    expect(r.vars.get(V.ssDisc(1))).toBe(0);
    void build;
  });

  it('fire handle is locked until a fire warning; pulled + rotated it fires a bottle', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.3);
    const h = ctl('g800.fire.l');
    click(h);
    step(0.2);
    expect(r.vars.get(V.fireHandleL)).toBe(0); // locked
    r.sys.failures.trigger('fire.eng1');
    step(3);
    expect(r.vars.get('fire.eng1_warn')).toBe(1);
    click(h); // pull
    step(0.3);
    expect(r.vars.get(V.fireHandleL)).toBe(1);
    // Hold rotated to the left half: SHOT 1 (right bottle).
    const t = h.hitTargets[0];
    h.onPointerDown?.(p(h, 0, t, new THREE.Vector3(-0.02, 0, 0)));
    step(0.5);
    expect(r.vars.get(V.fireRotL)).toBe(-1);
    h.onPointerUp?.(p(h, 0, t));
    step(1);
    expect(r.vars.get(V.fireRotL)).toBe(0);
    expect(r.vars.get('fire.bottle_r_discharged')).toBe(1);
  });

  it('MASTER WARNING / CAUTION acknowledge the CAS', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    r.vars.set(V.genL, 0); // "L Generator Off" caution
    step(4);
    expect(r.vars.get('alert.master_caution')).toBe(1);
    click(ctl('g800.gs.mwarn_r')); // MASTER WARN: press = ack warning, release = ack caution
    step(0.3);
    expect(r.vars.get('alert.master_caution')).toBe(0);
  });
});
