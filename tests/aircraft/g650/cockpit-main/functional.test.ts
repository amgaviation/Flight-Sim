/**
 * Gulfstream G650 main cockpit driven through its 3D controls against the
 * real systems (headless rig with the PlaneView II suite): the controls
 * produce the documented system reactions, not just var changes.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { DISPLAY_VARS } from '../../../../src/cockpit/types';
import type { InitialState } from '../../../../src/aircraft/types';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import { CK } from '../../../../src/aircraft/g650/cockpit/context';
import { HUD_DISPLAY_ID } from '../../../../src/aircraft/g650/cockpit/hud';
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

describe('G650 cockpit: controls drive the systems', () => {
  it('thrust levers: a click to CRZ spools the engine up, back to IDLE spools it down', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    const n0 = r.vars.get('eng1.n1_pct');
    click(ctl('g650.ped.tl1'));
    step(0.5);
    expect(r.vars.get(V.tla(1))).toBeGreaterThan(0.5);
    step(8);
    const n1 = r.vars.get('eng1.n1_pct');
    expect(n1).toBeGreaterThan(n0 + 15);
    click(ctl('g650.ped.tl1'), 2);
    step(8);
    expect(r.vars.get(V.tla(1))).toBeLessThan(0.05);
    expect(r.vars.get('eng1.n1_pct')).toBeLessThan(n1 - 10);
  });

  it('FUEL CONTROL L to OFF shuts the left engine down; MASTER WARNING acknowledges the warning', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    expect(r.vars.get('eng1.running')).toBe(1);
    const fc = ctl('g650.ped.fuel_ctl1');
    click(fc, 2); // right click = one position down (RUN -> OFF, lever-lock pull is automatic)
    step(1);
    expect(r.vars.get(V.fuelCtlL)).toBe(0);
    step(20);
    expect(r.vars.get('eng1.running')).toBe(0);
    expect(r.vars.get('eng2.running')).toBe(1);
    if (r.vars.get('alert.master_warning') !== 0) {
      click(ctl('g650.gs.mw_l'));
      step(0.5);
      expect(r.vars.get('alert.master_warning')).toBe(0);
    }
  });

  it('flap handle: one click aft selects DOWN (39 deg) and the flaps run', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    expect(r.vars.get(V.flapLever)).toBe(2);
    click(ctl('g650.ped.flaps'));
    step(0.5);
    expect(r.vars.get(V.flapLever)).toBe(3);
    step(15);
    expect(r.vars.get('surf.flaps_deg')).toBeGreaterThan(35);
  });

  it('yoke pitch-trim switch moves the stabilizer on the ground; AP/TRIM DISC held interrupts it', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    const trim = ctl('g650.fc.trim_l');
    const t0 = r.vars.get('surf.pitch_trim');
    // Hold the upper half: NOSE DN (positions bottom -> top: NOSE UP, OFF, NOSE DN).
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(1.5);
    const t1 = r.vars.get('surf.pitch_trim');
    trim.onPointerUp?.(p(trim));
    step(0.5);
    expect(r.vars.get(V.yokeTrimL)).toBe(0);
    expect(Math.abs(t1 - t0)).toBeGreaterThan(0.02);
    const disc = ctl('g650.fc.ap_disc_l');
    disc.onPointerDown?.(p(disc));
    trim.onPointerDown?.(p(trim, 0, trim.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(0.2);
    const t2 = r.vars.get('surf.pitch_trim');
    step(1);
    expect(r.vars.get(V.discHeld)).toBe(1);
    expect(Math.abs(r.vars.get('surf.pitch_trim') - t2)).toBeLessThan(1e-6);
    trim.onPointerUp?.(p(trim));
    disc.onPointerUp?.(p(disc));
  });

  it('yoke MIC / INT rocker keys the ACP-selected transmitter or the intercom', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    r.vars.set(V.acpMic(1), 2); // VHF 2 selected on the pilot's ACP
    step(1);
    expect(r.vars.get(V.acpKeyed(1))).toBe(0);
    const ptt = ctl('g650.fc.ptt_l');
    // Positions bottom -> top: MIC, OFF, INT.
    ptt.onPointerDown?.(p(ptt, 0, ptt.hitTargets[0], new THREE.Vector3(0, -0.006, 0.005)));
    step(0.5);
    expect(r.vars.get(V.acpPtt(1))).toBe(1);
    expect(r.vars.get(V.acpKeyed(1))).toBe(2);
    ptt.onPointerUp?.(p(ptt));
    step(0.5);
    expect(r.vars.get(V.acpKeyed(1))).toBe(0);
    ptt.onPointerDown?.(p(ptt, 0, ptt.hitTargets[0], new THREE.Vector3(0, 0.006, 0.005)));
    step(0.5);
    expect(r.vars.get(V.acpKeyed(1))).toBe(-1);
    ptt.onPointerUp?.(p(ptt));
    step(0.5);
    expect(r.vars.get(V.acpPtt(1))).toBe(0);
  });

  it('tiller handle steers the nosewheel (NWS POWER on) and self-centres when released', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    const t = ctl('g650.fc.tiller');
    expect(t).toBeTruthy();
    // Hold the handle deflected (a drag rewrites the var each frame, which holds off the centring spring).
    for (let i = 0; i < 60 * 3; i++) {
      r.vars.set(V.tiller3d, 0.6);
      step(1 / 60);
    }
    expect(r.vars.get(V.tiller3d)).toBeGreaterThan(0.3);
    expect(r.vars.get(V.tillerCmd)).toBeGreaterThan(0.3);
    expect(r.vars.get('gear.steer_deg')).toBeGreaterThan(15);
    // Released: the steer-by-wire tiller self-centres (LUC landing gear; spring ~2/s in cockpitInputs.ts).
    step(2);
    expect(Math.abs(r.vars.get(V.tiller3d))).toBeLessThan(0.05);
  });

  it('landing gear handle: UP is blocked by the down-lock solenoid on the ground', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    click(ctl('g650.lc.gear'));
    step(1);
    expect(r.vars.get(V.gearHandle)).toBe(1);
    expect(r.vars.get('gear.down_locked')).toBe(1);
  });

  it('parking brake handle released and autobrake selector reach the brake system', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    expect(r.vars.get('brakes.parking_set')).toBe(1);
    click(ctl('g650.ped.park_brake'), 2);
    step(2);
    expect(r.vars.get(V.parkBrake)).toBeLessThan(0.05);
    expect(r.vars.get('brakes.parking_set')).toBe(0);
    const ab = ctl('g650.lc.autobrake'); // lower centre panel (G650ER photograph)
    ab.onWheel?.(-1, p(ab)); // OFF -> RTO
    ab.onWheel?.(-1, p(ab));
    step(0.5);
    expect(r.vars.get(V.autobrake)).toBe(-1);
  });

  it('guidance panel HDG knob and AP button work through the Epic hardware', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    const h0 = r.vars.get('ap.sel_hdg_deg');
    const k = ctl('epic.gp.hdg');
    for (let i = 0; i < 5; i++) k.onWheel?.(1, p(k));
    step(0.5);
    expect(r.vars.get('ap.sel_hdg_deg')).not.toBe(h0);
  });

  it('HUD: stowed and dark by default on the ramp, deploys and powers with the SMC HUD page on', { timeout: 120_000 }, async () => {
    // Fix round 2, G650-N01: the HGS combiner is manually stowed against the headliner when not in use
    // (Rockwell Collins HGS installs) - a parked aircraft starts with it stowed and the symbology off.
    const { r, step } = await setup('ready_to_taxi');
    step(2);
    expect(r.vars.get('epic.hud.on')).toBe(0);
    expect(r.vars.get(DISPLAY_VARS.power(HUD_DISPLAY_ID))).toBe(0);
    expect(r.vars.get(CK.hudDeploy)).toBeLessThan(0.01);
    r.vars.set('epic.hud.on', 1);
    step(2);
    expect(r.vars.get(DISPLAY_VARS.power(HUD_DISPLAY_ID))).toBe(1);
    expect(r.vars.get(CK.hudDeploy)).toBeGreaterThan(0.99);
    // Pulling the HUD breaker (FLT INSTRUMENTS section) blanks the symbology even with the page ON.
    r.vars.set('epic.hud.on', 1);
    step(2);
    r.vars.set('cb.hud', 0);
    step(2);
    expect(r.vars.get('elec.hud_powered')).toBe(0);
    expect(r.vars.get(DISPLAY_VARS.power(HUD_DISPLAY_ID))).toBe(0);
    r.vars.set('cb.hud', 1);
    r.vars.set('epic.hud.on', 0);
    step(2);
    expect(r.vars.get(DISPLAY_VARS.power(HUD_DISPLAY_ID))).toBe(0);
    expect(r.vars.get(CK.hudDeploy)).toBeLessThan(0.01);
  });

  it('DU brightness knob dims the display unit through the lighting system', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    const k = ctl('g650.gs.du_brt_l');
    // Wheel over each part of the concentric knob (outer = DU 1 PFD, inner = DU 2 MFD).
    for (const t of k.hitTargets) for (let i = 0; i < 12; i++) k.onWheel?.(-1, p(k, 0, t));
    step(1);
    const dimmed = [1, 2].filter((n) => r.vars.get(V.duBrt(n as 1 | 2)) < 0.5 && r.vars.get(`display.epic.du${n}.brt`) < 0.5);
    expect(dimmed.length).toBeGreaterThan(0);
  });

  it('IRS MODE SELECT switchlights turn the IRUs off / on (alignment restarts)', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    expect(r.vars.get('ahrs2.valid')).toBe(1);
    click(ctl('g650.lc.irs2'));
    step(1);
    expect(r.vars.get(V.irsMode(2))).toBe(0);
    expect(r.vars.get('ahrs2.valid')).toBe(0);
    click(ctl('g650.lc.irs2'));
    step(1);
    expect(r.vars.get(V.irsMode(2))).toBe(2);
    expect(r.vars.get('ahrs2.valid')).toBe(0); // aligning again
  });

  it('engine fire handle on the lower centre panel shuts off the engine; cockpit call chimes until RESET', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    step(1);
    expect(r.vars.get('eng1.running')).toBe(1);
    click(ctl('g650.lc.fire_l'));
    step(20);
    expect(r.vars.get(V.fireHandleL)).toBe(1);
    expect(r.vars.get('eng1.running')).toBe(0);
    // Momentary buttons: held for a few frames (as with a mouse press), then released.
    const hold = (c: CockpitControl) => {
      c.onPointerDown?.(p(c));
      step(0.2);
      c.onPointerUp?.(p(c));
      step(0.3);
    };
    hold(ctl('g650.ped.call_crew'));
    expect(r.vars.get(V.cabinCall)).toBe(1);
    hold(ctl('g650.ped.call_reset'));
    expect(r.vars.get(V.cabinCall)).toBe(0);
  });
});
