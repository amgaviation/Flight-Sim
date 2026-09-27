/**
 * Circuit breakers on the side consoles are bound to the electrical network:
 * every panel breaker is a real network breaker, pulling one removes power
 * from its load, pushing it restores it, and an over-current (short) trips it
 * (the control pops out, the load goes dark) until the fault clears and the
 * breaker is reset.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { CircuitBreaker } from '../../../../src/cockpit/controls';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { MAX_PANEL_BREAKER_A } from '../../../../src/aircraft/citation-longitude/cockpit/side/breakers';
import { makeRig } from '../helpers';

function setup() {
  const r = makeRig('ready_to_taxi', { avionics: false });
  const { build } = buildLongitudeCockpit(r.ctx, r.sys, null, { headless: true });
  build.root.updateMatrixWorld(true);
  const byId = new Map<string, CockpitControl>(build.controls.map((c) => [c.id, c]));
  const tick = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      r.run(1 / 60);
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
    }
  };
  const cb = (name: string) => byId.get(`lon.cb.${name}`) as CircuitBreaker;
  const click = (c: CockpitControl) => {
    const t = c.hitTargets[0] ?? c.object;
    const p = { button: 0 as const, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
    c.onPointerDown?.(p);
    c.onPointerUp?.(p);
  };
  return { r, build, byId, tick, cb, click };
}

describe('Citation Longitude circuit breakers', () => {
  it('every network breaker up to 50 A is on a side-console panel, bound to cb.<name>', () => {
    const { r, byId } = setup();
    const net = r.sys.elec.breakerNames();
    const panel = net.filter((b) => b.ratingA <= MAX_PANEL_BREAKER_A);
    expect(panel.length).toBeGreaterThan(50);
    for (const b of panel) {
      const c = byId.get(`lon.cb.${b.name}`);
      expect(c, b.name).toBeInstanceOf(CircuitBreaker);
      expect(c!.tooltip()).toContain(`${Number.isInteger(b.ratingA) ? b.ratingA : b.ratingA.toFixed(1)}A`);
    }
    // Feeders above 50 A are J-box current limiters, not cockpit breakers.
    for (const b of net.filter((x) => x.ratingA > MAX_PANEL_BREAKER_A)) expect(byId.has(`lon.cb.${b.name}`)).toBe(false);
  });

  it('pulling a breaker removes power from its load; pushing it restores it', { timeout: 60_000 }, () => {
    const { r, tick, cb, click } = setup();
    tick(1);
    const cases: [string, string][] = [
      ['pfd1', 'elec.pfd1_powered'],
      ['mfd', 'elec.mfd_powered'],
      ['ahrs2', 'elec.ahrs2_powered'],
      ['stby_inst', 'elec.stby_inst_powered'],
      ['ext_lt_taxi', 'elec.ext_lt_taxi_powered'],
    ];
    for (const [name, pw] of cases) {
      expect(r.vars.get(pw), `${name} before`).toBe(1);
      click(cb(name));
      tick(0.5);
      expect(r.vars.get(`cb.${name}`)).toBe(0);
      expect(r.vars.get(pw), `${name} pulled`).toBe(0);
      click(cb(name));
      tick(0.5);
      expect(r.vars.get(pw), `${name} reset`).toBe(1);
    }
    // Downstream effects: taxi light dark with its breaker out; AHRS 2 invalid; standby ADC loses power.
    expect(r.vars.get('light.taxi')).toBeGreaterThan(0);
    click(cb('ext_lt_taxi'));
    click(cb('ahrs2'));
    tick(1);
    expect(r.vars.get('light.taxi')).toBe(0);
    expect(r.vars.get('ahrs2.valid')).toBe(0);
    // Dome light (hot battery bus) follows its breaker.
    r.vars.set('ac.lon.lt.dome', 1);
    tick(0.5);
    expect(r.vars.get('ac.light.dome')).toBeGreaterThan(0.9);
    click(cb('dome_lt'));
    tick(0.5);
    expect(r.vars.get('ac.light.dome')).toBe(0);
  });

  it('a short trips the breaker: the control pops, the load loses power, reset works once the fault clears', { timeout: 60_000 }, () => {
    const { r, tick, cb, click } = setup();
    r.vars.set('ac.lon.lt.ldg_l', 1);
    tick(1);
    expect(r.vars.get('light.landing_l')).toBeGreaterThan(0.9);
    r.vars.set('fail.elec.ldg_lt_l.short', 1);
    tick(3);
    expect(r.vars.get('cb.ldg_lt_l')).toBe(0);
    expect(r.vars.get('cb.ldg_lt_l_tripped')).toBe(1);
    expect(cb('ldg_lt_l').logic.state).toBe('tripped');
    expect(cb('ldg_lt_l').tooltip()).toContain('TRIPPED');
    expect(r.vars.get('elec.ldg_lt_l_powered')).toBe(0);
    expect(r.vars.get('light.landing_l')).toBe(0);
    // Pushed back in with the fault still present: trips again.
    click(cb('ldg_lt_l'));
    tick(3);
    expect(r.vars.get('cb.ldg_lt_l_tripped')).toBe(1);
    // Fault cleared, reset: power back.
    r.vars.set('fail.elec.ldg_lt_l.short', 0);
    click(cb('ldg_lt_l'));
    tick(1);
    expect(r.vars.get('cb.ldg_lt_l')).toBe(1);
    expect(r.vars.get('elec.ldg_lt_l_powered')).toBe(1);
    expect(r.vars.get('light.landing_l')).toBeGreaterThan(0.9);
  });
});

