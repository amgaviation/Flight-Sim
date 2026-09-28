/**
 * Global Vision layout fixes (fix round 1) driven through the 3D controls
 * against the real systems: AUX PRESS pressurizes on trim air with both packs
 * off; PACK CONTROL LO / HIGH scales the pack flow; MAN TEMP HOT / COLD slews
 * the pack outlet in MAN; CABIN OUTLETS / CABIN POWER load the AC buses;
 * landing-light PULSE alternates L / R at 45 / min; TAXI/RECOG WINGTIP; EMER
 * DC PWR on the overhead; RAT GEN and AUX PRESS guards; WINDSHIELD HEAT
 * rotaries; engine MODE toggles; standby compass; HUD knob / combiner; the
 * main-panel layout (no gear position lights, one MASTER WARNING/CAUTION per
 * side, EMS CDUs in the wings, AFD 3 on the pedestal face, TAWS panel).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { PACK_FLOW, PULSE_PERIOD_S } from '../../../../src/aircraft/global6000/systems/vision';
import { AFD_POS, mainPoint, PED_FACE } from '../../../../src/aircraft/global6000/cockpit/layout';
import { pointer, setupFull } from './harness';
import { makeRig } from '../helpers';

/** Holds a control with the pointer on the upper (+y) or lower half of its hit box. */
function holdHalf(k: ReturnType<typeof setupFull>, id: string, up: boolean, s: number) {
  const c = k.ctl(id);
  const t = c.hitTargets[0] ?? c.object;
  const p = pointer(t, 0);
  p.point = t.localToWorld(new THREE.Vector3(0, up ? 0.008 : -0.008, 0.01));
  c.onPointerDown?.(p);
  k.step(s);
  c.onPointerUp?.(p);
  k.step(0.3);
}

/** Clicks the switch under a (open) guard: the last hit target of a guarded control. */
function press(k: ReturnType<typeof setupFull>, id: string) {
  const c = k.ctl(id);
  const t = c.hitTargets[c.hitTargets.length - 1];
  c.onPointerDown?.(pointer(t, 0));
  c.onPointerUp?.(pointer(t, 0));
}

describe('Global 6000 Global Vision layout: controls drive the systems', () => {
  it('AUX PRESS (guarded): trim air pressurizes the cabin with both packs off; AUX PRESS ON status', { timeout: 300_000 }, () => {
    const k = setupFull('cruise', { weightLb: 80000, air: { altFtMsl: 35000, iasKt: 250 } });
    const { r, step, click } = k;
    const v = r.vars;
    step(2);
    // Both packs off: no pack inflow, the cabin climbs.
    click('g6k.ovhd.pack_l');
    click('g6k.ovhd.pack_r');
    step(20);
    expect(v.get('pneu.pack_flow_kgs')).toBeLessThan(0.01);
    const climbing = v.get('press.cabin_rate_fpm');
    expect(climbing).toBeGreaterThan(200);
    // AUX PRESS behind a clear guard: first click opens the cover, the second pushes the switchlight.
    click('g6k.ovhd.aux_press');
    step(0.3);
    expect(v.get(V.auxPress)).toBe(0);
    expect(v.get(V.auxPressGuard)).toBe(1);
    press(k, 'g6k.ovhd.aux_press');
    step(20);
    expect(v.get(V.auxPress)).toBe(1);
    expect(v.get('pneu.aux_press_flow_kgs')).toBeGreaterThan(0.1);
    expect(v.get('press.cabin_rate_fpm')).toBeLessThan(climbing - 150);
    expect(r.sys.cas.isActive('aux_press_on')).toBe(true);
  });

  it('PACK CONTROL LO / HIGH / MAN and L MAN TEMP HOT / COLD (spring-loaded)', { timeout: 300_000 }, () => {
    const k = setupFull('cruise', { weightLb: 80000, air: { altFtMsl: 35000, iasKt: 250 } });
    const { r, step, ctl } = k;
    const v = r.vars;
    step(3);
    const norm = v.get('pneu.pack_l_flow_kgs');
    expect(norm).toBeGreaterThan(0.2);
    const knob = ctl('g6k.ovhd.pack_ctl');
    knob.onWheel?.(-1, pointer(knob.hitTargets[0]));
    step(3);
    expect(v.get(V.packFlowSel)).toBe(0);
    expect(v.get('pneu.pack_l_flow_kgs')).toBeCloseTo(norm * PACK_FLOW.lo, 2);
    expect(r.sys.cas.isActive('l_pack_low_flow')).toBe(true);
    for (let i = 0; i < 2; i++) knob.onWheel?.(1, pointer(knob.hitTargets[0]));
    step(3);
    expect(v.get(V.packFlowSel)).toBe(2);
    expect(v.get('pneu.pack_l_flow_kgs')).toBeCloseTo(norm * PACK_FLOW.high, 2);
    knob.onWheel?.(1, pointer(knob.hitTargets[0]));
    step(1);
    expect(v.get(V.packFlowSel)).toBe(3);
    expect(v.get(V.packCtlMan)).toBe(1);
    // MAN TEMP HOT held for 3 s raises the manual outlet demand, spring back to centre.
    const t0 = v.get(V.packManTemp('l'));
    holdHalf(k, 'g6k.ovhd.man_temp_l', true, 3);
    expect(v.get(V.packManTempSw('l'))).toBe(0);
    expect(v.get(V.packManTemp('l'))).toBeGreaterThan(t0 + 0.2);
    holdHalf(k, 'g6k.ovhd.man_temp_l', false, 5);
    expect(v.get(V.packManTemp('l'))).toBeLessThan(t0);
  });

  it('CABIN SYSTEMS: CABIN OUTLETS and CABIN POWER switch their AC loads', { timeout: 300_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click } = k;
    const v = r.vars;
    step(2);
    const load = () => v.get('elec.cabin_outlets_amps') + v.get('elec.cabin_ac2_amps');
    const on = load();
    expect(v.get(V.cabinOutlets)).toBe(1);
    click('g6k.ovhd.cabin_outlets');
    click('g6k.ovhd.cabin_power');
    step(2);
    expect(v.get(V.cabinOutlets)).toBe(0);
    expect(v.get(V.cabinPwr)).toBe(0);
    expect(load()).toBeLessThan(on - 1);
  });

  it('LANDING lights PULSE alternate L / R at 45 / min; TAXI/RECOG WINGTIP lights the recognition lights', { timeout: 300_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, ctl } = k;
    const v = r.vars;
    step(1);
    for (const id of ['g6k.ovhd.lt_ldg_l', 'g6k.ovhd.lt_ldg_r']) {
      const c = ctl(id);
      for (let i = 0; i < 2; i++) c.onWheel?.(1, pointer(c.hitTargets[0]));
    }
    step(0.5);
    expect(v.get(V.ltLdgL)).toBe(2);
    let lOnly = 0;
    let rOnly = 0;
    let both = 0;
    for (let i = 0; i < Math.round(PULSE_PERIOD_S * 60 * 2); i++) {
      step(1 / 60);
      const l = v.get('light.landing_l') > 0.5;
      const rr = v.get('light.landing_r') > 0.5;
      if (l && !rr) lOnly++;
      else if (rr && !l) rOnly++;
      else if (l && rr) both++;
    }
    expect(lOnly).toBeGreaterThan(20);
    expect(rOnly).toBeGreaterThan(20);
    expect(both).toBeLessThan(10);
    const taxi = ctl('g6k.ovhd.lt_taxi');
    v.set(V.ltTaxi, 0);
    step(0.3);
    taxi.onWheel?.(1, pointer(taxi.hitTargets[0]));
    step(0.5);
    expect(v.get(V.ltTaxi)).toBe(2); // WINGTIP
    expect(v.get('light.recognition')).toBeGreaterThan(0.5);
    expect(v.get('light.taxi')).toBe(0);
  });

  it('EMER DC PWR (overhead, red guard), RAT GEN clear guard, WINDSHIELD HEAT rotary, MODE N1 toggle', { timeout: 300_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click, ctl } = k;
    const v = r.vars;
    step(1);
    expect(() => ctl('g6k.ped.dc_emer_ovrd')).toThrow();
    click('g6k.ovhd.dc_emer_ovrd');
    step(0.2);
    expect(v.get(V.dcEmerOvrdGuard)).toBe(1);
    press(k, 'g6k.ovhd.dc_emer_ovrd');
    step(0.5);
    expect(v.get(V.dcEmerOvrd)).toBe(1);
    // RAT GEN: the first click opens the guard only.
    click('g6k.ovhd.rat_gen');
    step(0.2);
    expect(v.get(V.ratGen)).toBe(1);
    expect(v.get(V.ratGenGuard)).toBe(1);
    // WINDSHIELD HEAT L rotary to OFF/RESET: heat off.
    const w = ctl('g6k.ovhd.wshld_l');
    w.onWheel?.(-1, pointer(w.hitTargets[0]));
    step(2);
    expect(v.get(V.wshldL)).toBe(0);
    expect(v.get(V.wshldOn('l'))).toBe(0);
    // MODE L to N1 (up): FADEC alternate mode, status message.
    const m = ctl('g6k.ovhd.eng_mode1');
    m.onWheel?.(1, pointer(m.hitTargets[0]));
    step(1);
    expect(v.get(V.engN1Mode(1))).toBe(1);
    expect(r.sys.cas.isActive('l_eng_n1_mode')).toBe(true);
    expect(() => ctl('g6k.ped.n1_mode1')).toThrow();
  });

  it('standby compass: pulled down it shows the magnetic heading; HUD knob and combiner drive the HUD', { timeout: 300_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click, ctl } = k;
    const v = r.vars;
    step(3);
    expect(v.get(V.compassReadable)).toBe(0);
    click('g6k.ovhd.compass');
    step(3);
    expect(v.get(V.compassReadable)).toBe(1);
    const err = Math.abs(((v.get(V.compassHdg) - v.get('fdm.hdg_mag_deg') + 540) % 360) - 180);
    expect(err).toBeLessThan(2.5);
    // HUD: combiner stowed -> blank; deploy with the PUSH latch -> symbology; HUD knob to DIM (min) -> blank.
    expect(v.get(V.hudOn)).toBe(0);
    click('g6k.hud.stow');
    step(1);
    expect(v.get(V.hudStow)).toBe(0);
    expect(v.get(V.hudOn)).toBe(1);
    const hud = ctl('g6k.gs.hud');
    for (let i = 0; i < 20; i++) hud.onWheel?.(-1, pointer(hud.hitTargets[0]));
    step(1);
    expect(v.get(V.hudOn)).toBe(0);
    const mode0 = v.get(V.hudMode);
    hud.onPointerDown?.(pointer(hud.hitTargets[0], 1));
    step(0.1);
    hud.onPointerUp?.(pointer(hud.hitTargets[0], 1));
    step(0.3);
    expect(v.get(V.hudMode)).toBe((mode0 + 1) % 4);
  });

  it('main panel: Vision layout geometry and control set', { timeout: 300_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { ctl, build } = k;
    // No three-green gear position lights; one MASTER WARNING/CAUTION per side; TAWS on the main panel; no pedestal EMS.
    for (const id of ['g6k.mp.gear_lt_l', 'g6k.mp.gear_lt_n', 'g6k.mp.gear_lt_r', 'g6k.gs.mw_l', 'g6k.gs.mc_r', 'g6k.ems.lsk_l', 'g6k.ped.lamp_test', 'g6k.ped.autobrake', 'g6k.ped.terr_off', 'g6k.ovhd.crank1', 'g6k.ovhd.start1', 'fusion.fcp.crs1', 'g6k.fc.chrono1']) expect(() => ctl(id)).toThrow();
    for (const id of ['g6k.gs.mwc_l', 'g6k.gs.mwc_r', 'g6k.mp.terr_off', 'g6k.mp.gs_mute', 'g6k.mp.flap_ovrd', 'g6k.mp.autobrake', 'g6k.side.ems1_emer', 'g6k.side.ems2_brt', 'g6k.ovhd.eng_start', 'g6k.ovhd.aux_press', 'g6k.ovhd.cabin_outlets', 'g6k.ped.event', 'g6k.gs.evs', 'g6k.fc.ptt1', 'fusion.ctp1.navsrc', 'fusion.mkp1.keys']) expect(ctl(id)).toBeTruthy();
    build.root.updateMatrixWorld(true);
    const world = (id: string) => {
      const o = ctl(id).object;
      return o.getWorldPosition(new THREE.Vector3());
    };
    // EMS CDU 1 is outboard of the pilot's PFD (local x = body y < -0.6), not on the sidewall.
    expect(world('g6k.side.ems1_fn').x).toBeLessThan(-0.6);
    expect(world('g6k.side.ems1_fn').x).toBeGreaterThan(-0.95);
    // IESI column and the GEAR AND BRAKES column sit in the upper row between the AFDs.
    const iesi = world('fusion.iesi.baro');
    const top = mainPoint(0, AFD_POS[0][1]);
    expect(Math.abs(iesi.x + 0.215)).toBeLessThan(0.045);
    expect(iesi.y).toBeGreaterThan(-top[2] - 0.08);
    const gear = world('g6k.mp.gear');
    expect(Math.abs(gear.x - 0.215)).toBeLessThan(0.04);
    // AFD 3 is on the pedestal face, well below the upper row.
    // AFD 3 centre (body z, down +) at least 0.25 m below the AFD 2 centre, on the pedestal face.
    const afd3Z = PED_FACE.top[1] + PED_FACE.afdS * Math.cos((PED_FACE.backDeg * Math.PI) / 180);
    expect(afd3Z - mainPoint(0, AFD_POS[1][1])[2]).toBeGreaterThan(0.25);
  });

  it('A/T engages when the thrust levers are advanced for take-off (no A/T key on the Vision FCP)', { timeout: 300_000 }, () => {
    const r = makeRig('takeoff', { avionics: true });
    const v = r.vars;
    r.run(2);
    expect(v.get('ap.at_engaged')).toBe(0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(1);
    expect(v.get('ap.at_engaged')).toBe(1);
  });
});
