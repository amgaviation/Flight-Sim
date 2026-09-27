/**
 * Key overhead / electrical flows through the cockpit controls, checking the
 * annunciator lenses (lit legend AND annunciator power) and CAS:
 *   cold & dark (nothing lit, lamp test dark, dome light on the hot battery bus)
 *   -> BATT L/R (emergency buses, lenses powered, lamp test lights every lens and the masters)
 *   -> EXT PWR (AVAIL -> ON, automatic bus tie CLOSED)
 *   -> APU start, APU GEN on, EXT PWR off (tie stays closed: single primary source)
 *   -> both engines, generators on line (tie OPEN, generator CAS clear)
 * plus EMER LTS ARM logic, PASS SAFETY signs, FIRE WARN TEST, PASS OXY and the crew masks.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { AnnunciatorLight, PushButton } from '../../../../src/cockpit/controls';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';
import { makeRig } from '../helpers';

function setup(state: 'cold_dark' | 'ready_to_taxi') {
  const r = makeRig(state, { avionics: false });
  const { build } = buildLongitudeCockpit(r.ctx, r.sys, null, { headless: true });
  build.root.updateMatrixWorld(true);
  const byId = new Map<string, CockpitControl>(build.controls.map((c) => [c.id, c]));
  const get = <T extends CockpitControl>(id: string) => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
  };
  const tick = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      r.run(1 / 60);
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
    }
  };
  const ptr = (c: CockpitControl, button: 0 | 1 | 2 = 0, target = 0) => {
    const t = c.hitTargets[target] ?? c.object;
    return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
  };
  /** Left click on hit target `target` (guarded controls: 0 = cover, 1 = the switch under it). */
  const click = (id: string, target = 0) => {
    const c = get(id);
    c.onPointerDown?.(ptr(c, 0, target));
    tick(0.15);
    c.onPointerUp?.(ptr(c, 0, target));
    tick(0.15);
  };
  const hold = (id: string) => {
    const c = get(id);
    c.onPointerDown?.(ptr(c));
    tick(0.3);
    return () => {
      c.onPointerUp?.(ptr(c));
      tick(0.2);
    };
  };
  const env = build.env;
  /** Lit text of a lens that is actually glowing (legend lit and annunciators powered). */
  const shows = (id: string) => {
    const c = get<PushButton | AnnunciatorLight>(id);
    return env.lighting.annunciatorLevel() > 0 ? (c.face?.litText() ?? '') : '';
  };
  /** Emissive level of the first segment of a lens (after the lamp lag). */
  const glow = (id: string) => {
    const f = get<PushButton | AnnunciatorLight>(id).face as unknown as { segs: { mat: { emissiveIntensity: number } }[] };
    return f.segs[0].mat.emissiveIntensity;
  };
  const cas = () => r.sys.cas.list.filter((e) => e.active).map((e) => e.text);
  return { r, build, get, tick, click, hold, shows, glow, cas };
}

describe('Citation Longitude overhead flows', () => {
  it('electrical power-up: battery -> GPU -> APU -> engine generators, annunciators and CAS follow', { timeout: 300_000 }, () => {
    const { r, tick, click, hold, shows, glow, cas } = setup('cold_dark');
    const v = r.vars;
    tick(1);
    // Cold & dark: no annunciator power, the lamp test lights nothing, the CAS is dark.
    expect(v.get('elec.emer_l_powered')).toBe(0);
    expect(shows('lon.lp.batt_l')).toBe('');
    let release = hold('lon.oh.annun_test');
    expect(v.get(V.lampTest)).toBe(1);
    expect(glow('lon.lp.batt_l')).toBe(0);
    expect(v.get('alert.master_warning')).toBe(0);
    release();
    // Dome light works on the hot battery bus with the batteries off.
    click('lon.oh.dome');
    tick(0.5);
    expect(v.get('ac.light.dome')).toBeGreaterThan(0.9);
    click('lon.oh.dome');

    // BATT L / R ON (OG 17-2): emergency buses powered, the BATT OFF legends go out, lenses powered.
    click('lon.lp.batt_l');
    click('lon.lp.batt_r');
    click('lon.lp.stby_pwr');
    tick(3);
    expect(v.get('elec.emer_l_powered')).toBe(1);
    expect(v.get('elec.emer_r_powered')).toBe(1);
    expect(shows('lon.lp.batt_l')).toBe('');
    expect(shows('lon.lp.bus_tie')).toMatch(/OPEN|CLOSED/);
    // Lamp test: every lens and the MASTER WARNING / CAUTION light while held.
    release = hold('lon.oh.annun_test');
    tick(0.3);
    for (const id of ['lon.lp.batt_l', 'lon.oh.ldg_l', 'lon.oh.pass_oxy_on', 'lon.sc.oxy_flow_l', 'lon.oh.annun_test']) expect(glow(id), id).toBeGreaterThan(0.2);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(v.get('alert.master_caution')).toBe(1);
    release();
    tick(0.5);
    expect(v.get(V.lampTest)).toBe(0);
    expect(glow('lon.oh.ldg_l')).toBeLessThan(0.05);
    expect(v.get('alert.master_warning')).toBe(0);

    // Ground power: AVAIL, then ON; single primary source -> automatic bus tie closed.
    v.set(V.extPwrAvail, 1);
    tick(0.5);
    expect(shows('lon.lp.ext_pwr')).toContain('AVAIL');
    click('lon.lp.ext_pwr');
    tick(2);
    expect(v.get('elec.gpu_online')).toBe(1);
    expect(shows('lon.lp.ext_pwr')).toContain('ON');
    expect(v.get('elec.bus_tie_closed')).toBe(1);
    expect(shows('lon.lp.bus_tie')).toContain('CLOSED');
    expect(v.get('elec.mission_r_powered')).toBe(1);
    expect(v.get('elec.batt_l_amps')).toBeGreaterThanOrEqual(0); // batteries charging or 0 (OG 17-2)

    // APU: ON, self test, START (springs to ON); APU GEN on line; ground power off.
    v.set(V.apuKnob, 1);
    tick(12);
    v.set(V.apuKnob, 2);
    tick(0.5);
    v.set(V.apuKnob, 1);
    tick(70);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    click('lon.lp.ext_pwr');
    v.set(V.extPwrAvail, 0);
    tick(2);
    expect(v.get('elec.gpu_online')).toBe(0);
    expect(shows('lon.lp.ext_pwr')).toBe('');
    expect(v.get('elec.bus_tie_closed')).toBe(1);
    expect(v.get('elec.mission_r_powered')).toBe(1);
    tick(90); // APU bleed (OG 8-2: 90 s)

    // Engines (right first, OG 7-6): generators on line, tie opens, generator CAS clear.
    for (const [run, start] of [
      [V.runR, V.startR],
      [V.runL, V.startL],
    ] as const) {
      v.set(run, 1);
      tick(1);
      v.set(start, 1);
      tick(0.3);
      v.set(start, 0);
      tick(45);
    }
    tick(5);
    expect(v.get('elec.gen_l_online')).toBe(1);
    expect(v.get('elec.gen_r_online')).toBe(1);
    expect(v.get('elec.bus_tie_closed')).toBe(0);
    expect(shows('lon.lp.bus_tie')).toContain('OPEN');
    const posted = cas();
    for (const t of ['GEN OFF L', 'GEN OFF R', 'GENS OFF', 'BUS TIE CLOSED', 'ELEC EMER L', 'ELEC EMER R', 'BATTERY OFF L', 'BATTERY OFF R']) expect(posted, t).not.toContain(t);
    // APU generator switched off with the engine generators on line: no GEN OFF APU caution (OG CAS condition).
    click('lon.lp.gen_apu'); // toggles toward OFF
    tick(2);
    expect(cas()).not.toContain('GEN OFF APU');
  });

  it('EMER LTS ARM, PASS SAFETY, FIRE WARN TEST, PASS OXY and the crew masks', { timeout: 120_000 }, () => {
    const { r, get, tick, click, hold, shows } = setup('ready_to_taxi');
    const v = r.vars;
    tick(1);
    // EMER LTS: ARM (state default) = off while the emergency buses are powered.
    expect(v.get(V.ltEmer)).toBe(1);
    expect(v.get('light.emer')).toBe(0);
    // ON: lit regardless of power.
    v.set(V.ltEmer, 2);
    tick(0.5);
    expect(v.get('light.emer')).toBeGreaterThan(0.9);
    // EMER LTS is lever-locked out of OFF: right-click steps down ON -> ARM -> OFF.
    const emer = get('lon.oh.emer_lts');
    const p = { button: 2 as const, shift: false, ctrl: false, alt: false, point: new THREE.Vector3(), object: emer.hitTargets[0] };
    emer.onPointerDown?.(p);
    emer.onPointerUp?.(p);
    tick(0.5);
    expect(v.get(V.ltEmer)).toBe(1);
    expect(v.get('light.emer')).toBe(0);
    // ARM + total loss of the emergency buses (every source and both batteries off): the emergency lights come on.
    const saved = [V.battL, V.battR, V.genL, V.genR, V.genApu, V.extPwr].map((k) => [k, v.get(k)] as const);
    for (const [k] of saved) v.set(k, 0);
    tick(1);
    expect(v.get('elec.emer_l_powered')).toBe(0);
    expect(v.get('elec.emer_r_powered')).toBe(0);
    expect(v.get('light.emer')).toBeGreaterThan(0.9);
    for (const [k, x] of saved) v.set(k, x);
    tick(2);
    expect(v.get('light.emer')).toBe(0);

    // PASS SAFETY: SEAT BELT then PASS SAFETY (both cabin signs).
    v.set(V.ltSeatBelt, 0);
    tick(0.2);
    const ps = get('lon.oh.pass_safety');
    ps.onWheel?.(1, { button: 0, shift: false, ctrl: false, alt: false, point: new THREE.Vector3(), object: ps.hitTargets[0] }); // one step up
    tick(0.5);
    expect(v.get(V.ltSeatBelt)).toBe(1);
    expect(v.get('ac.light.no_smoking')).toBe(0);
    ps.onWheel?.(1, { button: 0, shift: false, ctrl: false, alt: false, point: new THREE.Vector3(), object: ps.hitTargets[0] });
    tick(0.5);
    expect(v.get('ac.light.no_smoking')).toBeGreaterThan(0.9);
    expect(v.get(V.ltSeatBelt)).toBeGreaterThanOrEqual(1);
    expect(v.get('ac.light.seatbelt')).toBeGreaterThan(0.9);

    // FIRE WARN TEST: fire warnings, MASTER WARNING and the ENG FIRE switchlights while held.
    const release = hold('lon.oh.fire_test');
    tick(1);
    expect(v.get('fire.test')).toBe(1);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(shows('lon.oh.fire_test')).toContain('FIRE TEST');
    release();
    tick(1);
    expect(v.get('fire.eng1_warn')).toBe(0);

    // PASS OXY: guarded; first click opens the guard, the next deploys the masks; closing the guard returns it to NORM.
    click('lon.oh.pass_oxy', 1); // switch blocked while the guard is closed
    expect(v.get(V.oxyPax)).toBe(0);
    click('lon.oh.pass_oxy'); // open the guard
    click('lon.oh.pass_oxy', 1); // MAN DEPLOY
    tick(2);
    expect(v.get(V.oxyPax)).toBe(1);
    expect(v.get('oxy.pax_on')).toBe(1);
    expect(shows('lon.oh.pass_oxy_on')).toContain('PASS OXY ON');
    click('lon.oh.pass_oxy'); // closing the guard returns the switch to NORM
    expect(v.get(V.oxyPax)).toBe(0);

    // Crew masks: stowed = no flow; PRESS TO TEST = flow blinker; donned = flow, 100 % on the regulator.
    expect(v.get('oxy.pilot_flowing')).toBe(0);
    const rel = hold('lon.sc.oxy_test_l');
    tick(0.3);
    expect(v.get('oxy.pilot_flowing')).toBe(1);
    expect(shows('lon.sc.oxy_flow_l')).toContain('FLOW');
    rel();
    tick(0.5);
    expect(v.get('oxy.pilot_flowing')).toBe(0);
    click('lon.sc.mask_r');
    click('lon.sc.oxy_mode_r'); // NORM -> 100 %
    tick(1);
    expect(v.get(V.oxyMaskR)).toBe(1);
    expect(v.get(V.oxyModeR)).toBe(1);
    expect(v.get(V.oxyMode)).toBe(0); // pilot regulator independent
    expect(v.get('oxy.copilot_flowing')).toBe(1);
    const psi0 = v.get('oxy.main_psi');
    tick(30);
    expect(v.get('oxy.main_psi')).toBeLessThan(psi0);
  });
});
