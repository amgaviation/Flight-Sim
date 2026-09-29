/**
 * Citation Longitude main cockpit driven through its 3D controls against the
 * real systems (headless rig): the controls produce the documented system
 * reactions, not just var changes.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { makeRig, type Rig } from '../helpers';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';
import { GuardedButton } from '../../../../src/cockpit/controls';
import type { InitialState } from '../../../../src/aircraft/types';

function setup(state: InitialState) {
  const r = makeRig(state);
  const { build } = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true, mainOnly: true });
  build.root.updateMatrixWorld(true);
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

function click(c: CockpitControl, button: 0 | 1 | 2 = 0, target?: THREE.Object3D) {
  c.onPointerDown?.(p(c, button, target));
  c.onPointerUp?.(p(c, button, target));
}

const volts = (r: Rig) => r.vars.get('elec.emer_l_v', r.vars.get('elec.emer_l_powered'));

describe('Citation Longitude cockpit: controls drive the systems', () => {
  it('BATT L / BATT R pushbuttons power the emergency buses from cold and dark', { timeout: 60_000 }, () => {
    const { r, ctl, step } = setup('cold_dark');
    step(0.5);
    expect(r.vars.get('elec.emer_l_powered')).toBe(0);
    click(ctl('lon.lp.batt_l'));
    click(ctl('lon.lp.batt_r'));
    step(1);
    expect(r.vars.get(V.battL)).toBe(1);
    expect(r.vars.get(V.battR)).toBe(1);
    expect(r.vars.get('elec.emer_l_powered')).toBe(1);
    expect(r.vars.get('elec.emer_r_powered')).toBe(1);
    expect(volts(r)).toBeGreaterThan(0);
  });

  it('control-wheel trim switch moves the stabilizer; AP/TRIM DISC held interrupts it', { timeout: 60_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    const trim = ctl('lon.fc.trim_l');
    const u0 = r.vars.get('trim.pitch_units');
    // Hold the upper half (NOSE DN, positions bottom -> top: NOSE UP, OFF, NOSE DN).
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(1.5);
    const u1 = r.vars.get('trim.pitch_units');
    trim.onPointerUp?.(p(trim));
    step(0.5);
    expect(r.vars.get(V.yokeTrimL)).toBe(0);
    expect(Math.abs(u1 - u0)).toBeGreaterThan(0.1);
    // Hold AP/TRIM DISC: electric trim is interrupted.
    const disc = ctl('lon.fc.ap_disc_l');
    disc.onPointerDown?.(p(disc));
    step(0.1);
    expect(r.vars.get(V.discHeld)).toBe(1);
    const u2 = r.vars.get('trim.pitch_units');
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(1);
    trim.onPointerUp?.(p(trim));
    disc.onPointerUp?.(p(disc));
    step(0.2);
    expect(r.vars.get('trim.pitch_units')).toBeCloseTo(u2, 3);
    expect(r.vars.get(V.discHeld)).toBe(0);
  });

  it('tiller steers the nosewheel; the gear handle is locked down on the ground', { timeout: 60_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    const tiller = ctl('lon.tiller');
    for (let i = 0; i < 6; i++) tiller.onWheel?.(1, p(tiller));
    step(3);
    const t = r.vars.get(V.tiller3d);
    expect(Math.abs(t)).toBeGreaterThan(0.2);
    // Nosewheel follows the tiller (same sign), up to +-81 deg.
    expect(Math.sign(r.vars.get('gear.steer_deg'))).toBe(Math.sign(t));
    expect(Math.abs(r.vars.get('gear.steer_deg'))).toBeGreaterThan(10);
    const gear = ctl('lon.lp.gear');
    click(gear);
    step(0.5);
    expect(r.vars.get(V.gearHandle)).toBe(1); // still DN: down-lock solenoid
  });

  it('thrust levers, ENG FIRE switchlight and BOTTLE button reach the systems', { timeout: 60_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    const tl = ctl('lon.ped.tl1');
    for (let i = 0; i < 10; i++) tl.onWheel?.(1, p(tl));
    step(2);
    expect(r.vars.get(V.tla(1))).toBeGreaterThan(0.15);
    expect(r.vars.get('eng1.n1_cmd_pct')).toBeGreaterThan(r.vars.get('eng2.n1_cmd_pct') + 2);
    // ENG FIRE: first click opens the guard, second pushes the switchlight -> firewall shutoff, bottles armed.
    const fire = ctl('lon.gs.fire_l') as GuardedButton;
    click(fire); // opens the guard
    click(fire, 0, fire.inner.hitTargets[0]); // pushes the switchlight
    step(0.5);
    expect(r.vars.get(V.fireEngL)).toBe(1);
    expect(r.vars.get('fire.eng1_armed')).toBe(1);
    expect(r.vars.get('ac.lon.ck.bottle1_armed')).toBe(1);
    // A real click holds the momentary button ~0.1-0.2 s.
    const bottle = ctl('lon.gs.bottle1');
    bottle.onPointerDown?.(p(bottle));
    step(0.15);
    bottle.onPointerUp?.(p(bottle));
    step(3);
    expect(r.vars.get('fire.bottle1_discharged')).toBe(1);
  });
});
