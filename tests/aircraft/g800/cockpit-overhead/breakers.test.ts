/**
 * G800 circuit breakers: the CB panels carry exactly the network's breakers, pulling a breaker in
 * the 3D cockpit removes power from its load (and whatever that load feeds), an overcurrent trip
 * pops it, and a reset while the fault persists trips it again.
 */
import { describe, expect, it } from 'vitest';
import type { CircuitBreaker } from '../../../../src/cockpit/controls';
import { CB_PANEL_LEFT, CB_PANEL_RIGHT } from '../../../../src/aircraft/g800/cockpit/side/breakers';
import { makeRig } from '../helpers';
import { click, fullCockpit } from './util';

describe('G800 CB panels', () => {
  it('the panels list every breaker of the electrical network exactly once', () => {
    const r = makeRig('ready_to_taxi');
    const net = r.sys.elec.breakerNames().map((b) => b.name).sort();
    const panel = [...CB_PANEL_LEFT, ...CB_PANEL_RIGHT].flatMap((g) => g.items.map(([n]) => n)).sort();
    expect(panel).toEqual(net);
  });

  it('pulling DU 1 / L BOOST / FCC breakers removes power from those loads; pushing restores it', { timeout: 180_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('ready_to_taxi');
    step(1);
    for (const [cbId, powered, extra] of [
      ['du1', 'elec.du1_powered', 'display.epic.du1.power'],
      ['boost_l', 'elec.boost_l_powered', null],
      ['ohpts2', 'elec.ohpts2_powered', 'display.epic.ohpts2.power'],
      ['ext_nav', 'elec.ext_nav_powered', 'light.nav'],
    ] as const) {
      expect(r.vars.get(powered), powered).toBe(1);
      if (extra) expect(r.vars.get(extra), extra).toBeGreaterThan(0);
      const cb = ctl(`g800.cb.${cbId}`);
      click(cb); // pull
      step(0.5);
      expect(r.vars.get(`cb.${cbId}`)).toBe(0);
      expect(r.vars.get(powered), `${powered} after pull`).toBe(0);
      if (extra) expect(r.vars.get(extra), `${extra} after pull`).toBe(0);
      expect(cb.tooltip()).toMatch(/OUT|PULLED/i);
      click(cb); // push back in
      step(0.5);
      expect(r.vars.get(`cb.${cbId}`)).toBe(1);
      expect(r.vars.get(powered), `${powered} after push`).toBe(1);
    }
    // Pulling the FCC and BFCU breakers removes FBW computer power (the FCCs are UPS-backed, SCQ).
    click(ctl('g800.cb.fcc'));
    click(ctl('g800.cb.bfcu'));
    step(0.5);
    expect(r.vars.get('fcc.power_ok')).toBe(0);
    click(ctl('g800.cb.fcc'));
    click(ctl('g800.cb.bfcu'));
    step(0.5);
    expect(r.vars.get('fcc.power_ok')).toBe(1);
  });

  it('a short circuit trips the breaker (white band out), a reset under the fault trips it again', { timeout: 180_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('ready_to_taxi');
    step(0.5);
    const cb = ctl<CircuitBreaker>('g800.cb.radar');
    r.vars.set('fail.elec.radar.short', 1);
    step(3);
    expect(r.vars.get('cb.radar')).toBe(0);
    expect(r.vars.get('cb.radar_tripped')).toBe(1);
    expect(r.vars.get('elec.radar_powered')).toBe(0);
    expect(cb.logic.state).toBe('tripped');
    click(cb); // reset: trips again while the fault persists
    step(3);
    expect(r.vars.get('cb.radar')).toBe(0);
    r.vars.set('fail.elec.radar.short', 0);
    click(cb);
    step(1);
    expect(r.vars.get('cb.radar')).toBe(1);
    expect(r.vars.get('cb.radar_tripped')).toBe(0);
    expect(r.vars.get('elec.radar_powered')).toBe(1);
  });
});
