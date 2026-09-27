/**
 * Global 6000 overhead / side-panel flows driven only through the 3D controls
 * (headless rig, real systems): electrical power-up battery -> EXT AC -> APU
 * GEN -> engine VFGs with the overhead switchlight legends, fire test /
 * handle / bottle discharge, IAC aural mute, pressurization LDG ELEV slew,
 * panel back-lighting and lamp test.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { KeyPad, PushButton } from '../../../../src/cockpit/controls';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { AUDIO } from '../helpers';
import { pointer, setupFull } from './harness';

/** Lit legend text of a switchlight. */
function lit(c: CockpitControl): string {
  return (c as PushButton).face?.litText() ?? '';
}

/** Brightest legend emissive intensity of a control (lamp level). */
function glow(c: CockpitControl): number {
  let m = 0;
  c.object.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat && !Array.isArray(mat) && mat.emissiveIntensity !== undefined && mat.emissiveMap) m = Math.max(m, mat.emissiveIntensity);
  });
  return m;
}

/** Presses and holds a control for `s` seconds (momentary switches, spring-loaded knob positions). */
function hold(k: ReturnType<typeof setupFull>, id: string, s: number, local?: THREE.Vector3) {
  const c = k.ctl(id);
  const t = c.hitTargets[0] ?? c.object;
  const p = pointer(t, 0);
  if (local) p.point = t.localToWorld(local.clone());
  c.onPointerDown?.(p);
  k.step(s);
  c.onPointerUp?.(p);
  k.step(0.3);
}

describe('Global 6000 overhead flows', () => {
  it('electrical power-up: BATT MASTER -> EXT AC -> APU GEN -> engine VFGs, with the PBA legends', { timeout: 300_000 }, () => {
    const k = setupFull('cold_dark');
    const { r, step, click, ctl } = k;
    const v = r.vars;
    step(1);
    expect(v.get('elec.dc_ess_powered')).toBe(0);

    // BATT MASTER ON: batteries on the BATT BUS and, through the ETC, DC ESS; no AC yet.
    click('g6k.ovhd.batt_master');
    step(2);
    expect(v.get(V.battMaster)).toBe(1);
    expect(v.get('elec.batt_bus_powered')).toBe(1);
    expect(v.get('elec.dc_ess_powered')).toBe(1);
    expect(v.get('elec.ac_bus1_powered')).toBe(0);
    expect(lit(ctl('g6k.ovhd.gen1'))).toBe(''); // dark cockpit: GEN switch normal, no fault

    // Ground power cart connected: EXT AC AVAIL; push -> ON, all AC buses powered.
    v.set(V.extAcAvail, 1);
    step(1);
    expect(lit(ctl('g6k.ovhd.ext_ac'))).toContain('AVAIL');
    click('g6k.ovhd.ext_ac');
    step(2);
    expect(v.get('elec.ext_ac_online')).toBe(1);
    expect(lit(ctl('g6k.ovhd.ext_ac'))).toContain('ON');
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);

    // APU: rotary RUN (door + BIT), then START held (springs back to RUN) -> AVAIL, APU GEN on line.
    click('g6k.ovhd.apu'); // OFF -> RUN
    step(11);
    expect(v.get(V.apuSw)).toBe(1);
    hold(k, 'g6k.ovhd.apu', 1.5); // RUN -> START (spring)
    expect(v.get(V.apuSw)).toBe(1);
    let t = 0;
    while (v.get('apu.avail') === 0 && t < 90) {
      step(1);
      t++;
    }
    expect(v.get('apu.avail')).toBe(1);
    step(3);
    // EXT AC off: the APU generator takes the buses.
    click('g6k.ovhd.ext_ac');
    step(2);
    expect(v.get('elec.ext_ac_online')).toBe(0);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);
    // APU GEN PUSH OFF -> OFF legend, AC lost; push again -> back on line (GCU reset).
    click('g6k.ovhd.apu_gen');
    step(2);
    expect(lit(ctl('g6k.ovhd.apu_gen'))).toContain('OFF');
    expect(v.get('elec.ac_bus1_powered')).toBe(0);
    click('g6k.ovhd.apu_gen');
    step(3);
    expect(lit(ctl('g6k.ovhd.apu_gen'))).toBe('');
    expect(v.get('elec.ac_bus1_powered')).toBe(1);

    // Hydraulic 3A ON (toggle), right engine: ENG RUN R (pedestal) + R START (overhead): IN PROG, then VFGs 3 / 4.
    click('g6k.ovhd.hyd_3a');
    step(0.5);
    expect(v.get(V.hydPump('3a'))).toBe(2);
    click('g6k.ped.run2');
    step(1);
    expect(v.get(V.engRun(2))).toBe(1);
    hold(k, 'g6k.ovhd.start2', 0.3);
    step(3);
    expect(lit(ctl('g6k.ovhd.start2'))).toContain('IN PROG');
    t = 0;
    while (v.get('eng2.running') === 0 && t < 90) {
      step(1);
      t++;
    }
    expect(v.get('eng2.running')).toBe(1);
    step(10);
    expect(v.get('elec.gen3_online')).toBe(1);
    expect(v.get('elec.gen4_online')).toBe(1);
    expect(lit(ctl('g6k.ovhd.start2'))).toBe('');
    // GEN 3 OFF: OFF legend, its bus transfers (AC BUS 3 stays powered by priority).
    click('g6k.ovhd.gen3');
    step(2);
    expect(lit(ctl('g6k.ovhd.gen3'))).toContain('OFF');
    expect(v.get('elec.gen3_online')).toBe(0);
    expect(v.get('elec.ac_bus3_powered')).toBe(1);
    click('g6k.ovhd.gen3');
    step(2);
    expect(v.get('elec.gen3_online')).toBe(1);
    // A GCU trip: FAIL legend.
    v.set('fail.elec.gen4', 1);
    step(2);
    expect(lit(ctl('g6k.ovhd.gen4'))).toContain('FAIL');
    k.build.dispose?.();
  });

  it('fire test from the EMS CDU, fire handle pull and bottle discharge; IAC aural mute', { timeout: 120_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click, ctl } = k;
    const v = r.vars;
    const calls: string[] = [];
    const orig = AUDIO.callout;
    AUDIO.callout = (text: string) => void calls.push(text);
    try {
      step(1);
      const fn = ctl('g6k.side.ems1_fn') as KeyPad;
      const act = ctl('g6k.side.ems1_r') as KeyPad;
      // Both IAC aural channels muted: the fire test warnings stay silent.
      click('g6k.ovhd.iac1_mute');
      click('g6k.ovhd.iac2_mute');
      step(0.5);
      expect(lit(ctl('g6k.ovhd.iac1_mute'))).toContain('MUTED');
      fn.press('TEST');
      step(0.1);
      act.press('R1'); // FIRE TEST (10 s)
      step(3);
      expect(v.get(V.fireTest)).toBe(1);
      expect(v.get('fire.eng1_warn')).toBe(1);
      expect(v.get('alert.master_warning')).toBe(1);
      expect(calls.filter((c) => /FIRE/.test(c))).toEqual([]);
      step(9);
      expect(v.get(V.fireTest)).toBe(0);
      expect(v.get('fire.eng1_warn')).toBe(0);
      // Unmuted: the same test calls out the fires.
      click('g6k.ovhd.iac1_mute');
      click('g6k.ovhd.iac2_mute');
      act.press('R1');
      step(4);
      expect(calls.some((c) => /FIRE/.test(c))).toBe(true);
      act.press('R1'); // re-selecting a running test terminates it (07-20-40)
      step(1);
      expect(v.get(V.fireTest)).toBe(0);
    } finally {
      AUDIO.callout = orig;
    }

    // L ENG fire handle pulled: fuel, hydraulic and bleed SOVs close; DISCH 1 fires bottle 1 (lit on every handle).
    click('g6k.ovhd.fire_l');
    step(2);
    expect(v.get(V.fireHandle('l'))).toBe(1);
    expect(v.get(V.sovOpen(1))).toBe(0);
    expect(r.sys.cas.isActive('l_eng_sov_clsd')).toBe(true);
    hold(k, 'g6k.ovhd.fire_l_disch1', 0.2);
    step(3);
    expect(v.get('fire.bottle1_discharged')).toBe(1);
    expect(lit(ctl('g6k.ovhd.fire_l_disch1'))).toBe('1');
    expect(lit(ctl('g6k.ovhd.fire_r_disch1'))).toBe('1');
    expect(lit(ctl('g6k.ovhd.fire_l_disch2'))).toBe('');
  });

  it('pressurization LDG ELEV slew selects MAN; AUTO/MAN; lamp test and INTEGRAL OVHD back-lighting', { timeout: 120_000 }, () => {
    const k = setupFull('ready_to_taxi');
    const { r, step, click, ctl, build } = k;
    const v = r.vars;
    step(1);
    expect(v.get(V.ldgElevFms)).toBe(1);
    const e0 = v.get(V.ldgElevFt);
    // Hold the LDG ELEV toggle UP (upper half of the hit box) for 2 s.
    hold(k, 'g6k.ovhd.ldg_elev', 2, new THREE.Vector3(0, 0.008, 0.01));
    expect(v.get(V.ldgElevFms)).toBe(0);
    expect(lit(ctl('g6k.ovhd.ldg_elev_fms'))).toBe('MAN');
    expect(v.get(V.ldgElevFt)).toBeGreaterThan(e0 + 500);
    expect(v.get(V.ldgElevSlew)).toBe(0); // spring-loaded back to centre
    click('g6k.ovhd.ldg_elev_fms');
    step(1);
    expect(v.get(V.ldgElevFms)).toBe(1);
    click('g6k.ovhd.press_mode');
    step(1);
    expect(v.get(V.pressAutoMan)).toBe(2);
    expect(lit(ctl('g6k.ovhd.press_mode'))).toBe('MAN');
    expect(v.get('press.mode')).toBe(2);

    // Night: INTEGRAL OVHD knob drives the overhead label zone; LAMP TEST 1 (EMS) lights every overhead legend.
    v.set('env.ambient_light', 0);
    v.set(V.ltIntegral('ovhd'), 0.8);
    step(1);
    expect(v.get('ac.light.panel_ovhd')).toBeGreaterThan(0.5);
    expect(build.env.lighting.level('panel_ovhd')).toBeGreaterThan(0.5);
    const fn = ctl('g6k.side.ems2_fn') as KeyPad;
    const act = ctl('g6k.side.ems2_r') as KeyPad;
    fn.press('TEST');
    step(0.1);
    act.press('R5'); // LAMP TEST 1
    step(0.5);
    expect(v.get('alert.annun_test')).toBe(1);
    expect(build.env.lighting.lampTest()).toBe(true);
    // Every legend of a dark (normal) switchlight glows during the test.
    expect(glow(ctl('g6k.ovhd.gen1'))).toBeGreaterThan(0.3);
    expect(glow(ctl('g6k.ovhd.hyd_sov_l'))).toBeGreaterThan(0.3);
    step(11);
    expect(glow(ctl('g6k.ovhd.gen1'))).toBeLessThan(0.05);
    expect(v.get('alert.annun_test')).toBe(0);
  });
});
