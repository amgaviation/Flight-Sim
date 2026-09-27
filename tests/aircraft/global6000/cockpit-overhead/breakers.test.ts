/**
 * Global 6000 circuit protection from the cockpit: the CCBP thermal breakers
 * and the EMS CDU SSPC pages act on the real electrical network breakers
 * (`cb.<load>`), so pulling one removes power from its load, the network
 * trips them on over-current, and the EMS shows / resets them as the FCOM
 * (CSP 700-5000-6 07-10-9 .. 12) describes.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBreaker, KeyPad } from '../../../../src/cockpit/controls';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { CB_TABLE, CCBP_ENTRIES } from '../../../../src/aircraft/global6000/cockpit/side/cbTable';
import { setupFull } from './harness';

describe('Global 6000 circuit breakers', () => {
  it('the CB directory covers exactly the network breakers', { timeout: 120_000 }, () => {
    const { r, build } = setupFull('ready_to_taxi');
    const net = r.sys.elec.breakerNames().map((b) => b.name).sort();
    const table = CB_TABLE.map((e) => e.id).sort();
    expect(table).toEqual(net);
    // Every CCBP (thermal, cockpit) breaker is a physical control bound to its network breaker.
    for (const e of CCBP_ENTRIES) {
      const c = build.controls.find((x) => x.id === `g6k.cb.${e.id}`);
      expect(c, e.id).toBeInstanceOf(CircuitBreaker);
    }
    build.dispose?.();
  });

  it('pulling a CCBP breaker removes power from its load; pushing it restores it', { timeout: 120_000 }, () => {
    const { r, step, click } = setupFull('ready_to_taxi');
    r.vars.set(V.wshldL, 1);
    step(2);
    expect(r.vars.get('elec.wshld_l_powered')).toBe(1);
    click('g6k.cb.wshld_l');
    step(1);
    expect(r.vars.get('cb.wshld_l')).toBe(0);
    expect(r.vars.get('elec.wshld_l_powered')).toBe(0);
    step(6);
    expect(r.sys.cas.isActive('wshld_heat_fail')).toBe(true);
    click('g6k.cb.wshld_l');
    step(1);
    expect(r.vars.get('cb.wshld_l')).toBe(1);
    expect(r.vars.get('elec.wshld_l_powered')).toBe(1);

    // IESI (STBY ADI, DC EMER): the standby instrument's ADC / AHRS lose power.
    click('g6k.cb.iesi');
    step(1);
    expect(r.vars.get('elec.iesi_powered')).toBe(0);
    click('g6k.cb.iesi');
    step(1);
    expect(r.vars.get('elec.iesi_powered')).toBe(1);
  });

  it('EMS CDU: SYSTEM page pulls and resets an SSPC; thermal breakers cannot be changed from the CDU', { timeout: 120_000 }, () => {
    const { r, step, ctl } = setupFull('ready_to_taxi');
    step(1);
    const fn = ctl('g6k.side.ems1_fn') as KeyPad;
    const lsk = ctl('g6k.side.ems1_l') as KeyPad;
    const act = ctl('g6k.side.ems1_r') as KeyPad;
    expect(r.vars.get('elec.aux_pump_l_powered')).toBe(1);
    // SYS page 1: left column AFCS .. DOORS, right column ELEC .. FUEL (row 6 right = FUEL).
    fn.press('SYS');
    step(0.1);
    act.press('R6');
    step(0.1);
    // CB - FUEL list: find the L AUX PUMP row (the list is in table order: L AUX PUMP first on DC ESS).
    lsk.press('L1');
    act.press('R1');
    step(1);
    expect(r.vars.get('cb.aux_pump_l')).toBe(0);
    expect(r.vars.get('elec.aux_pump_l_powered')).toBe(0);
    act.press('R1');
    step(1);
    expect(r.vars.get('cb.aux_pump_l')).toBe(1);
    expect(r.vars.get('elec.aux_pump_l_powered')).toBe(1);

    // SYS page 2, left row 1 = HYD: HYD PUMP 1B is an ACPC thermal breaker -> the activation key cannot pull it.
    fn.press('SYS');
    fn.press('NEXT');
    step(0.1);
    lsk.press('L1');
    step(0.1);
    act.press('R1');
    step(0.5);
    expect(r.vars.get('cb.acmp1b')).toBe(1);
  });

  it('an over-current trips the breaker, the EMS CDUs show the STATUS page, and a reset restores the load', { timeout: 120_000 }, () => {
    const { r, step, click, build } = setupFull('ready_to_taxi');
    step(1);
    // DC BUS 1 radar SSPC: short circuit (10x rating) -> trip.
    r.vars.set('fail.elec.radar.short', 1);
    step(12);
    expect(r.vars.get('cb.radar_tripped')).toBe(1);
    expect(r.vars.get('elec.radar_powered')).toBe(0);
    const ems = (r.vars as unknown as { get: (n: string) => number }).get('ac.g6k.ck.ems1_on');
    expect(ems).toBe(1);
    // Reset from the EMS STATUS page (most recent trip highlighted, activation key resets) after the fault clears.
    r.vars.set('fail.elec.radar.short', 0);
    const act = build.controls.find((c) => c.id === 'g6k.side.ems1_r') as KeyPad;
    act.press('R1');
    step(1);
    expect(r.vars.get('cb.radar')).toBe(1);
    expect(r.vars.get('elec.radar_powered')).toBe(1);

    // A CCBP thermal breaker trips (pops out) and is reset by pushing it in.
    r.vars.set('fail.elec.probe_heat.short', 1);
    step(12);
    expect(r.vars.get('cb.probe_heat_tripped')).toBe(1);
    r.vars.set('fail.elec.probe_heat.short', 0);
    click('g6k.cb.probe_heat');
    step(1);
    expect(r.vars.get('cb.probe_heat')).toBe(1);
    expect(r.vars.get('cb.probe_heat_tripped')).toBe(0);
  });
});
