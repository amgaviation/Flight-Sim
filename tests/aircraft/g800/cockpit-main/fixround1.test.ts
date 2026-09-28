/**
 * G800 fix round 1 (layout audit): the hardware added / moved to match the G500 / G600 / G700 / G800 flight deck drives
 * the systems. Each case fails without its fix:
 *  - DOORS OPEN / SAFETY move (or lock) the main door (L06);
 *  - ENGINE CONTROL L ENG selects FADEC alternate control (blue CAS, A/T unavailable) and ENGINE START runs the
 *    AutoStart with the FUEL CONTROL at RUN (L07);
 *  - HUD combiner / HUD control panel feed the HUD computer (L12);
 *  - PITCH TRIM split switch trims only with both halves (L28);
 *  - PEDAL STEER removes only the pedal steering authority (L34);
 *  - APU FIRE EXT under its guard fires the left bottle (L02 / P12);
 *  - EMERGENCY POWER ON forces the E-batts on; autobrake / ground spoilers / ECB on the TSC (P27, L32, L11);
 *  - MASTER WARN acknowledges warnings and cautions; SFD MENU opens the SFD baro menu (L15 / L16).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { GuardedButton } from '../../../../src/cockpit/controls';
import type { InitialState } from '../../../../src/aircraft/types';
import { G800_VARS as V, AUTOBRAKE } from '../../../../src/aircraft/g800/vars';
import { casTexts } from '../helpers';
import { cockpitRig } from './rig';
import { EPIC_VARS } from '../../../../src/avionics/honeywell-epic/vars';

async function setup(state: InitialState, mainOnly = false) {
  const { r, ck } = await cockpitRig(state, mainOnly);
  const build = ck.build;
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = <T extends CockpitControl = CockpitControl>(id: string): T => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
  };
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  return { r, build, ctl, step };
}

function p(c: CockpitControl, button: 0 | 1 | 2 = 0, target = c.hitTargets[0] ?? c.object): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target };
}
function click(c: CockpitControl, button: 0 | 1 | 2 = 0) {
  c.onPointerDown?.(p(c, button));
  c.onPointerUp?.(p(c, button));
}
/** Lifts the guard (if closed) and clicks the switchlight under it. */
function guardedClick(g: GuardedButton) {
  if (!g.guard.open) g.toggleGuard();
  click(g.inner);
}
function hold(c: CockpitControl, target?: THREE.Object3D) {
  c.onPointerDown?.(p(c, 0, target));
  return () => c.onPointerUp?.(p(c, 0, target));
}

describe('G800 fix round 1: new hardware drives the systems', () => {
  it('DOORS OPEN moves the main door on the ground; SAFETY ON locks it out', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    expect(r.vars.get('ac.door.main')).toBe(0);
    const safety = ctl('g800.oh.door_safety');
    click(safety); // SAFETY ON
    step(0.2);
    guardedClick(ctl<GuardedButton>('g800.oh.door_open'));
    step(3);
    expect(r.vars.get(V.doorOpenCmd)).toBe(1);
    expect(r.vars.get('ac.door.main')).toBe(0); // locked out
    click(safety); // SAFETY OFF
    step(12);
    expect(r.vars.get('ac.door.main')).toBeGreaterThan(0.99);
    expect(casTexts(r, 'advisory')).toContain('Main Door');
    guardedClick(ctl<GuardedButton>('g800.oh.door_open')); // close
    step(12);
    expect(r.vars.get('ac.door.main')).toBeLessThan(0.01);
  });

  it('ENGINE CONTROL L ENG selects alternate control: blue CAS and the A/T cannot engage', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    click(ctl('g800.oh.eng_ctl_l'));
    step(1);
    expect(r.vars.get(V.engAlt(1))).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('L Engine ALT Control');
    r.events.emit('epic.gp.at');
    step(0.5);
    expect(r.vars.get('ap.athr')).toBe(0);
    click(ctl('g800.oh.eng_ctl_l'));
    step(1);
    expect(casTexts(r, 'advisory')).not.toContain('L Engine ALT Control');
  });

  it('AutoStart: FUEL CONTROL RUN + ENGINE START starts the engine (no START MASTER)', { timeout: 240_000 }, async () => {
    const { r, ctl, step } = await setup('cold_dark');
    step(0.5);
    // Batteries, APU and APU bleed by vars (overhead flows are covered in cockpit-overhead/flows.test.ts).
    for (const [k, x] of [
      [V.battL, 1],
      [V.battR, 1],
      [V.boostL, 1],
      [V.boostR, 1],
      [V.apuMaster, 1],
    ] as const)
      r.vars.set(k, x);
    step(11);
    r.vars.set(V.apuStart, 1);
    step(0.5);
    r.vars.set(V.apuStart, 0);
    let t = 0;
    while (r.vars.get('apu.avail') === 0 && t++ < 120) step(1);
    r.vars.set(V.bleedApu, 1);
    r.vars.set(V.bleedL, 0);
    r.vars.set(V.bleedR, 0);
    step(5);
    expect(r.vars.get(V.startMaster)).toBe(0);
    // FUEL CONTROL R to RUN (gated rotary: click moves one position), then ENGINE START.
    const run = ctl('g800.ped.run_r');
    click(run);
    step(0.3);
    expect(r.vars.get(V.runR)).toBe(1);
    const es = ctl('g800.oh.eng_start');
    const up = hold(es);
    step(0.3);
    up();
    step(3);
    expect(r.vars.get('fadec.eng2.auto_starter')).toBe(1);
    t = 0;
    while (r.vars.get('eng2.running') === 0 && t++ < 90) step(1);
    expect(r.vars.get('eng2.running')).toBe(1);
    expect(r.vars.get('eng1.running')).toBe(0); // L FUEL CONTROL still OFF
  });

  it('HUD: combiner, HUD BRT / MAN-AUTO / VIDEO BRT and the sidestick rocker feed the HUD computer', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi', true);
    step(0.5);
    expect(r.vars.get(V.hudOn)).toBe(1);
    const lum0 = r.vars.get(V.hudLum);
    expect(lum0).toBeGreaterThan(0);
    click(ctl('g800.hud.auto')); // AUTO -> MAN
    step(0.2);
    expect(r.vars.get(V.hudAuto)).toBe(0);
    const brt = ctl('g800.hud.brt');
    for (let i = 0; i < 20; i++) brt.onWheel?.(-1, p(brt));
    step(0.2);
    expect(r.vars.get(V.hudLum)).toBeLessThan(0.05);
    for (let i = 0; i < 20; i++) brt.onWheel?.(1, p(brt));
    step(0.2);
    expect(r.vars.get(V.hudLum)).toBeGreaterThan(0.5);
    // Video: none until the sidestick HUD rocker selects EVS / SVS.
    r.vars.set(EPIC_VARS.evs(1), 0);
    r.vars.set(EPIC_VARS.svs(1), 0);
    step(0.2);
    expect(r.vars.get(V.hudVideo)).toBe(0);
    r.vars.set(V.hudRocker(1), 1);
    step(0.2);
    r.vars.set(V.hudRocker(1), 0);
    step(0.2);
    expect(r.vars.get(V.hudVideo)).toBeGreaterThan(0);
    // Stow the combiner: HUD off.
    click(ctl('g800.hud.stow'));
    step(0.3);
    expect(r.vars.get(V.hudStow)).toBe(0);
    expect(r.vars.get(V.hudOn)).toBe(0);
    expect(r.vars.get(V.hudLum)).toBe(0);
  });

  it('pedestal PITCH TRIM moves the stabilizer only with both halves', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi', true);
    step(0.5);
    const t0 = r.vars.get('surf.pitch_trim');
    const a = ctl('g800.ped.pitch_trim_a');
    const b = ctl('g800.ped.pitch_trim_b');
    // One half only: no trim (split-switch protection).
    r.vars.set(V.altTrimA, 1);
    step(2);
    r.vars.set(V.altTrimA, 0);
    step(0.2);
    expect(Math.abs(r.vars.get('surf.pitch_trim') - t0)).toBeLessThan(1e-6);
    // Both halves NOSE UP through the 3D rockers (held on their lower = aft half).
    const low = (c: CockpitControl) => {
      const tg = c.hitTargets[0];
      const pt = tg.localToWorld(new THREE.Vector3(0, -0.006, 0));
      return { button: 0 as const, shift: false, ctrl: false, alt: false, point: pt, object: tg };
    };
    a.onPointerDown?.(low(a));
    b.onPointerDown?.(low(b));
    step(0.2);
    expect(r.vars.get(V.altTrimCmd)).toBe(1);
    step(2);
    a.onPointerUp?.(low(a));
    b.onPointerUp?.(low(b));
    step(0.2);
    expect(r.vars.get(V.altTrimCmd)).toBe(0);
    expect(r.vars.get('surf.pitch_trim')).toBeGreaterThan(t0 + 0.02);
  });

  it('PEDAL STEER OFF removes the pedal steering authority only; the tiller still steers', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi', true);
    step(0.5);
    r.vars.set('input.yaw', 1);
    step(1);
    expect(r.vars.get('steer.cmd_deg')).toBeCloseTo(7, 0);
    click(ctl('g800.fc.pedal_steer'));
    step(1);
    expect(r.vars.get(V.pedalSteer)).toBe(0);
    expect(r.vars.get('steer.cmd_deg')).toBeCloseTo(0, 3);
    expect(casTexts(r, 'advisory')).toContain('Pedal Steering Off');
    r.vars.set(V.tiller, 0.5);
    step(1);
    expect(r.vars.get('steer.cmd_deg')).toBeGreaterThan(20);
    expect(r.vars.get(V.nwsSw)).toBe(1);
  });

  it('APU FIRE EXT (guarded) discharges the left bottle into the APU; the guard protects it', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    r.sys.failures.trigger('fire.apu');
    step(3);
    expect(r.vars.get('fire.apu_warn')).toBe(1);
    const ext = ctl<GuardedButton>('g800.oh.apu_fire_ext');
    // Pressed through the closed guard: nothing.
    ext.onPointerDown(p(ext, 0, ext.inner.hitTargets[0]));
    ext.onPointerUp(p(ext, 0, ext.inner.hitTargets[0]));
    step(0.5);
    expect(r.vars.get('fire.bottle_l_discharged')).toBe(0);
    if (!ext.guard.open) ext.toggleGuard();
    const release = hold(ext.inner);
    step(0.5);
    release();
    step(1);
    expect(r.vars.get('fire.bottle_l_discharged')).toBe(1);
    expect(r.vars.get('fire.bottle_r_discharged')).toBe(0);
  });

  it('TSC FLT CTL page selects autobrake / ground spoilers; MASTER WARN acknowledges; SFD MENU opens the baro keys', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi', true);
    step(0.5);
    const logic = r.sys.suite!.tscLogic[0];
    expect(logic.show('FLTCTL')).toBe(true);
    const w = (id: string) => logic.current.widgets.find((x) => x.id === id)!;
    const tap = (id: string) => logic.tap(w(id).x + 2, w(id).y + 2);
    const arm0 = r.vars.get(V.gndSplrArm);
    tap('fc.ab.RTO');
    tap('fc.splr.arm');
    step(0.2);
    expect(r.vars.get(V.autobrake)).toBe(AUTOBRAKE.RTO);
    expect(r.vars.get(V.gndSplrArm)).toBe(arm0 === 1 ? 0 : 1);
    // HOME carries the two G800 applications.
    logic.show('HOME');
    expect(logic.current.widgets.some((x) => x.id === 'home.FLTCTL')).toBe(true);
    expect(logic.current.widgets.some((x) => x.id === 'home.ECB')).toBe(true);
    // MASTER WARN: a caution lights it amber; one press acknowledges.
    r.vars.set(V.genL, 0);
    step(4);
    expect(r.vars.get('alert.master_caution')).toBe(1);
    click(ctl('g800.gs.mwarn_l'));
    step(0.3);
    expect(r.vars.get('alert.master_caution')).toBe(0);
    // SFD MENU toggles the SFD baro menu.
    const sfd = r.sys.suite!.standby[0] as unknown as { baroOpen: boolean };
    expect(sfd.baroOpen).toBe(false);
    click(ctl('g800.gs.sfd_menu1'));
    step(0.1);
    expect(sfd.baroOpen).toBe(true);
  });

  it('EMERGENCY POWER ON forces the emergency batteries on; OFF disconnects them', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(0.5);
    expect(r.vars.get(V.ebattOn)).toBe(0);
    guardedClick(ctl<GuardedButton>('g800.oh.emer_on'));
    step(0.5);
    expect(r.vars.get(V.emerPwr)).toBe(2);
    expect(r.vars.get(V.ebattOn)).toBe(1);
    guardedClick(ctl<GuardedButton>('g800.oh.emer_off'));
    step(0.5);
    expect(r.vars.get(V.ebattOn)).toBe(0);
  });
});
