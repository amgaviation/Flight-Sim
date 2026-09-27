/**
 * Global 6000 main cockpit driven through its 3D controls against the real
 * systems (headless rig with the Fusion suite on fake canvases): the controls
 * produce the documented system reactions, not just var changes.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { KeyPad } from '../../../../src/cockpit/controls';
import { makeRig } from '../helpers';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { CK } from '../../../../src/aircraft/global6000/cockpit/context';
import type { InitialState } from '../../../../src/aircraft/types';

function setup(state: InitialState, o: Parameters<typeof makeRig>[1] = {}) {
  const r = makeRig(state, { avionics: true, ...o });
  const { build } = buildG6kCockpit(r.ctx, r.sys, { mainOnly: true, canvas: fakeCanvas() });
  build.root.updateMatrixWorld(true);
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = (id: string): CockpitControl => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  /** Advances the cockpit (controls + hooks) and the systems / FDM together. */
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

describe('Global 6000 cockpit: controls drive the systems', () => {
  it('EMS CDU: AC BUS 1 MAN OFF isolates the bus; TEST page FIRE TEST held runs the fire test', { timeout: 120_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(1);
    expect(r.vars.get('elec.ac_bus1_powered')).toBe(1);
    const left = ctl('g6k.ems.lsk_l') as KeyPad;
    left.press('L1');
    step(0.2);
    left.logic.release('L1');
    step(1);
    expect(r.vars.get(V.acBusIsol(1))).toBe(1);
    expect(r.vars.get('elec.ac_bus1_powered')).toBe(0);
    left.press('L1');
    left.logic.release('L1');
    step(1);
    expect(r.vars.get('elec.ac_bus1_powered')).toBe(1);
    (ctl('g6k.ems.pages') as KeyPad).press('TEST');
    step(0.1);
    expect(r.vars.get(CK.emsPage)).toBe(1);
    left.logic.press('L1'); // held
    step(1);
    expect(r.vars.get(V.fireTest)).toBe(1);
    expect(r.vars.get('fire.eng1_warn') + r.vars.get('fire.test')).toBeGreaterThan(0);
    left.logic.release('L1');
    step(0.2);
    expect(r.vars.get(V.fireTest)).toBe(0);
  });

  it('control-wheel pitch trim moves the stabilizer; AP/SP DISC held interrupts it', { timeout: 120_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    const trim = ctl('g6k.fc.trim1');
    const u0 = r.vars.get('trim.pitch_units');
    // Hold the upper half (NOSE DN; positions bottom -> top: NOSE UP, OFF, NOSE DN).
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(1.5);
    const u1 = r.vars.get('trim.pitch_units');
    trim.onPointerUp?.(p(trim));
    step(0.5);
    expect(r.vars.get(V.yokeTrim(1))).toBe(0);
    expect(u1).toBeLessThan(u0 - 0.3);
    const disc = ctl('g6k.fc.ap_disc1');
    disc.onPointerDown?.(p(disc));
    step(0.1);
    expect(r.vars.get(V.discHeld)).toBe(1);
    expect(r.vars.get(V.pusherEnabled)).toBe(0);
    const u2 = r.vars.get('trim.pitch_units');
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(1);
    trim.onPointerUp?.(p(trim));
    disc.onPointerUp?.(p(disc));
    step(0.2);
    expect(r.vars.get('trim.pitch_units')).toBeCloseTo(u2, 3);
    expect(r.vars.get(V.discHeld)).toBe(0);
  });

  it('NOSE STEER handwheel steers the nosewheel; the gear handle is locked down on the ground', { timeout: 120_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    const tiller = ctl('g6k.tiller');
    for (let i = 0; i < 8; i++) tiller.onWheel?.(1, p(tiller));
    step(3);
    const t = r.vars.get(V.tiller3d);
    expect(Math.abs(t)).toBeGreaterThan(0.3);
    expect(Math.sign(r.vars.get('gear.steer_deg'))).toBe(Math.sign(t));
    expect(Math.abs(r.vars.get('gear.steer_deg'))).toBeGreaterThan(15);
    click(ctl('g6k.mp.gear'));
    step(0.5);
    expect(r.vars.get(V.gearHandle)).toBe(1); // still DN: handle solenoid (LGECU)
  });

  it('thrust lever, reverse lever interlock, SLAT/FLAP lever and ENG RUN reach the systems', { timeout: 120_000 }, () => {
    const { r, ctl, step } = setup('ready_to_taxi');
    step(0.5);
    // Reverse lever lifts only at IDLE on the ground; while raised, the thrust lever cannot advance.
    const rev = ctl('g6k.ped.rev1');
    for (let i = 0; i < 5; i++) rev.onWheel?.(1, p(rev));
    step(3);
    expect(r.vars.get(V.revLever(1))).toBeGreaterThan(0.3);
    expect(r.vars.get('eng1.reverser_pos')).toBeGreaterThan(0.5);
    const tl = ctl('g6k.ped.tl1');
    for (let i = 0; i < 10; i++) tl.onWheel?.(1, p(tl));
    step(0.5);
    expect(r.vars.get(V.tla(1))).toBeLessThan(0.01);
    for (let i = 0; i < 8; i++) rev.onWheel?.(-1, p(rev));
    step(3);
    expect(r.vars.get(V.revLever(1))).toBeLessThan(0.01);
    for (let i = 0; i < 10; i++) tl.onWheel?.(1, p(tl));
    step(3);
    expect(r.vars.get(V.tla(1))).toBeGreaterThan(0.15);
    expect(r.vars.get('eng1.n1_cmd_pct')).toBeGreaterThan(r.vars.get('eng2.n1_cmd_pct') + 2);
    for (let i = 0; i < 12; i++) tl.onWheel?.(-1, p(tl));
    // SLAT/FLAP 6 -> 16 (click = next detent toward max).
    const flaps = ctl('g6k.ped.flaps');
    expect(r.vars.get(V.flapLever)).toBe(2);
    click(flaps);
    step(12);
    expect(r.vars.get(V.flapLever)).toBe(3);
    expect(r.vars.get('surf.flaps_deg')).toBeGreaterThan(15.5);
    // ENG RUN L to OFF (lift-lock toggle): the FADEC shuts the left engine down.
    click(ctl('g6k.ped.run1'), 2);
    step(8);
    expect(r.vars.get(V.engRun(1))).toBe(0);
    expect(r.vars.get('eng1.running')).toBe(0);
  });

  it('MASTER WARNING acknowledges the CAS; LAMP TEST lights the annunciators; FCP AP engages the autopilot in flight', { timeout: 120_000 }, () => {
    const { r, ctl, step } = setup('cruise', { weightLb: 78000, air: { altFtMsl: 35000, iasKt: 260 } });
    step(1);
    r.sys.failures.trigger('fire.eng1');
    step(2);
    expect(r.vars.get('alert.master_warning')).toBe(1);
    const mw = ctl('g6k.gs.mw_l');
    mw.onPointerDown?.(p(mw));
    step(0.15);
    mw.onPointerUp?.(p(mw));
    step(0.5);
    expect(r.vars.get('alert.master_warning')).toBe(0);
    const lt = ctl('g6k.ped.lamp_test');
    lt.onPointerDown?.(p(lt));
    step(0.2);
    expect(r.vars.get('alert.annun_test')).toBe(1);
    lt.onPointerUp?.(p(lt));
    step(0.2);
    expect(r.vars.get('alert.annun_test')).toBe(0);
    // AP was engaged by the cruise state: FCP AP disengages, pressing again re-engages.
    expect(r.vars.get('ap.engaged')).toBe(1);
    click(ctl('fusion.fcp.ap'));
    step(0.5);
    expect(r.vars.get('ap.engaged')).toBe(0);
    click(ctl('fusion.fcp.ap'));
    step(0.5);
    expect(r.vars.get('ap.engaged')).toBe(1);
  });
});
