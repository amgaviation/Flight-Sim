/**
 * G650 COCKPIT LIGHTS through the 3D controls against the real systems (G650 training material, dossier §13):
 *  - MASTER CONTROL OFF = day: annunciators full bright, integral panel backlighting off;
 *  - night range: annunciators dimmed, backlighting on at the PANEL knob level;
 *  - full clockwise: annunciators full bright; ORIDE: overhead dome and side-console floods (map lights) full;
 *  - the CKPT LTS breaker removes the backlighting; VEST LTS ORIDE turns the vestibule lights off.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { PushButton } from '../../../../src/cockpit/controls';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import { cockpitRig } from '../cockpit-main/rig';

function p(c: CockpitControl): ControlPointer {
  const t = c.hitTargets[0] ?? c.object;
  return { button: 0, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
}

describe('G650 cockpit lighting', () => {
  it('MASTER CONTROL day / night / BRT / ORIDE, CKPT LTS breaker and VEST LTS ORIDE', { timeout: 200_000 }, async () => {
    const { r, ck } = await cockpitRig('ready_to_taxi', false);
    const build = ck.build;
    const v = r.vars;
    const byId = new Map(build.controls.map((c) => [c.id, c]));
    const ctl = (id: string): CockpitControl => {
      const c = byId.get(id);
      if (!c) throw new Error(`no control ${id}`);
      return c;
    };
    const step = (s: number) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) {
        for (const c of build.controls) c.update?.(1 / 60);
        build.update?.(1 / 60);
        build.env.lighting.update(1 / 60);
        r.run(1 / 60);
      }
    };
    const click = (c: CockpitControl) => {
      c.onPointerDown?.(p(c));
      c.onPointerUp?.(p(c));
    };
    const master = ctl('g650.oh.lt.master');
    const turn = (notches: number) => {
      master.onWheel?.(notches, p(master));
      step(0.5);
    };
    const annun = () => build.env.lighting.annunciatorLevel();
    step(1);

    // Day (state default): MASTER OFF -> annunciators full bright, no backlighting although PANEL is up.
    expect(v.get(V.ltMaster)).toBe(0);
    expect(v.get(V.ltPanel)).toBeGreaterThan(0.5);
    expect(annun()).toBe(1);
    expect(v.get('ac.light.panel')).toBe(0);

    // Night setting: annunciators dim, panel backlighting on.
    turn(4);
    expect(v.get(V.ltMaster)).toBeGreaterThan(0.1);
    expect(v.get(V.ltMaster)).toBeLessThan(0.5);
    expect(annun()).toBeCloseTo(0.3, 5);
    expect(v.get('ac.light.panel')).toBeGreaterThan(0.5);
    expect(v.get('ac.light.dome')).toBe(0);

    // Full clockwise (BRT): annunciators full bright again, no override yet.
    while (v.get(V.ltMaster) < 0.99) turn(1);
    expect(v.get(V.ltMaster)).toBeLessThan(1.05);
    expect(annun()).toBe(1);
    expect(v.get('ac.light.dome')).toBe(0);
    expect(v.get('ac.light.map_l')).toBe(0);

    // ORIDE: dome light and the side-console floods (map lights) at full, annunciators full bright.
    turn(3);
    expect(v.get(V.ltMaster)).toBeGreaterThan(1.05);
    expect(v.get('ac.light.dome')).toBe(1);
    expect(v.get('ac.light.map_l')).toBe(1);
    expect(v.get('ac.light.map_r')).toBe(1);
    expect(annun()).toBe(1);
    // The overhead / console lights draw current on the CKPT LTS breaker.
    expect(v.get('elec.panel_lts_amps', v.get('elec.panel_lts_a', 1))).toBeGreaterThan(0);

    // CKPT LTS breaker pulled: backlighting (and floods) lose power; the dome stays on the emergency bus.
    click(ctl('g650.cb.panel_lts'));
    step(0.5);
    expect(v.get('elec.panel_lts_powered')).toBe(0);
    expect(v.get('ac.light.panel')).toBe(0);
    expect(v.get('ac.light.dome')).toBe(1);
    click(ctl('g650.cb.panel_lts'));
    step(0.5);
    expect(v.get('ac.light.panel')).toBeGreaterThan(0.5);

    // Back to OFF: day mode.
    turn(-40);
    expect(v.get(V.ltMaster)).toBe(0);
    expect(v.get('ac.light.panel')).toBe(0);
    expect(v.get('ac.light.dome')).toBe(0);

    // VEST LTS ORIDE: vestibule lights (cabin power) off, blue ON legend.
    expect(v.get('ac.light.vestibule')).toBe(1);
    const vest = ctl('g650.side.vest_oride') as PushButton;
    click(vest);
    step(0.5);
    expect(v.get(V.vestOride)).toBe(1);
    expect(v.get('ac.light.vestibule')).toBe(0);
    expect(vest.face?.litText()).toBe('ON');
    click(vest);
    step(0.5);
    expect(v.get('ac.light.vestibule')).toBe(1);
  });
});
