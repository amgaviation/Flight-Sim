/**
 * G800 circuit breakers: the two aft-overhead CB panels (mechanical) plus the TSC ECB application
 * (electronic) carry exactly the network's breakers, pulling a breaker in the 3D cockpit removes power
 * from its load (and whatever that load feeds), an overcurrent trip pops it, and a reset while the
 * fault persists trips it again; an ECB opened / reset from the TSC does the same.
 */
import { describe, expect, it } from 'vitest';
import type { CircuitBreaker } from '../../../../src/cockpit/controls';
import { electronicBreakers, mechanicalBreakers, CB_OVHD_LEFT, CB_OVHD_RIGHT, CB_ROWS, CB_COLS, cbCell } from '../../../../src/aircraft/g800/cbTable';
import { makeRig } from '../helpers';
import { click, fullCockpit } from './util';

describe('G800 CB panels', () => {
  it('overhead panels + ECB page list every breaker of the network exactly once; ~45 % electronic (BJT500)', () => {
    const r = makeRig('ready_to_taxi');
    const net = r.sys.elec.breakerNames().map((b) => b.name);
    const mech = mechanicalBreakers();
    const ecb = electronicBreakers(net);
    expect([...mech, ...ecb].sort()).toEqual([...net].sort());
    expect(new Set(mech).size).toBe(mech.length);
    const share = ecb.length / net.length;
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.55);
    // Every group fits its grid rectangle (rows A-G, columns 1-6) and no two breakers share a cell.
    for (const groups of [CB_OVHD_LEFT, CB_OVHD_RIGHT]) {
      const cells = new Set<string>();
      for (const g of groups)
        g.items.forEach((_, i) => {
          const [row, col] = cbCell(g, i);
          expect(row).toBeLessThanOrEqual(g.rows[1]);
          expect(row).toBeLessThan(CB_ROWS.length);
          expect(col).toBeLessThan(CB_COLS);
          const k = `${row},${col}`;
          expect(cells.has(k), `${g.title} ${k}`).toBe(false);
          cells.add(k);
        });
    }
  });

  it('an ECB opened on the TSC ECB page removes power; closing it restores power', { timeout: 120_000 }, async () => {
    const { r, step } = await fullCockpit('ready_to_taxi');
    step(1);
    const logic = r.sys.suite!.tscLogic[0];
    expect(logic.show('ECB')).toBe(true);
    const w = logic.current.widgets.find((x) => x.id === 'ecb.ext_nav')!;
    expect(w).toBeTruthy();
    expect(r.vars.get('elec.ext_nav_powered')).toBe(1);
    logic.tap(w.x + w.w / 2, w.y + w.h / 2);
    step(0.5);
    expect(r.vars.get('cb.ext_nav')).toBe(0);
    expect(r.vars.get('elec.ext_nav_powered')).toBe(0);
    expect(r.vars.get('light.nav')).toBe(0);
    logic.tap(w.x + w.w / 2, w.y + w.h / 2);
    step(0.5);
    expect(r.vars.get('elec.ext_nav_powered')).toBe(1);
  });

  it('pulling DU 1 / L BOOST / FCC breakers removes power from those loads; pushing restores it', { timeout: 180_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('ready_to_taxi');
    step(1);
    for (const [cbId, powered, extra] of [
      ['du1', 'elec.du1_powered', 'display.epic.du1.power'],
      ['boost_l', 'elec.boost_l_powered', null],
      ['ohpts2', 'elec.ohpts2_powered', 'display.epic.ohpts2.power'],
      ['xpdr1', 'elec.xpdr1_powered', null],
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
    const cb = ctl<CircuitBreaker>('g800.cb.tcas');
    r.vars.set('fail.elec.tcas.short', 1);
    step(3);
    expect(r.vars.get('cb.tcas')).toBe(0);
    expect(r.vars.get('cb.tcas_tripped')).toBe(1);
    expect(r.vars.get('elec.tcas_powered')).toBe(0);
    expect(cb.logic.state).toBe('tripped');
    click(cb); // reset: trips again while the fault persists
    step(3);
    expect(r.vars.get('cb.tcas')).toBe(0);
    r.vars.set('fail.elec.tcas.short', 0);
    click(cb);
    step(1);
    expect(r.vars.get('cb.tcas')).toBe(1);
    expect(r.vars.get('cb.tcas_tripped')).toBe(0);
    expect(r.vars.get('elec.tcas_powered')).toBe(1);
  });

  it('the mechanical breakers draw as instanced batches, not one mesh per cap/legend (fix round 1 F11)', { timeout: 180_000 }, async () => {
    const { build } = await fullCockpit('ready_to_taxi');
    const stats = build.movingStats;
    expect(stats).toBeTruthy();
    // Every mechanical breaker's cap and rating legend is an instance (>= 2 parts per CB), replaced by
    // a handful of InstancedMesh draw calls shared with the other instanced controls.
    expect(stats!.parts).toBeGreaterThanOrEqual(mechanicalBreakers().length * 2);
    expect(stats!.batches).toBeLessThan(stats!.parts / 4);
  });
});
