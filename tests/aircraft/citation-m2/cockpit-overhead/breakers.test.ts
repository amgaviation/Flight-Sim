/**
 * Citation M2 sidewall circuit breakers: pulling each breaker (a click on the
 * cockpit control) removes power from the load it protects, pushing it back
 * restores it; downstream consumers follow (display power, DME, trim, gear
 * control, pitot heat CAS); an over-current trips the breaker, the control
 * pops out, and pushing it in while the fault persists trips it again.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../../src/cockpit/controls';
import { NAV } from '../../../../src/core/vars';
import { allLoadsOn, click, makeCockpitRig, type CockpitRig } from './harness';

/** The power flag that a breaker controls: its load, or the bus / link it feeds. */
function poweredVar(name: string): string {
  const feeders: Record<string, string> = { avn1: 'elec.avn1_powered', avn2: 'elec.avn2_powered' };
  return feeders[name] ?? `elec.${name}_powered`;
}
/** Feeder breakers whose bus stays powered through a parallel path; checked through their link current instead. */
const PARALLEL_FED = new Set(['l_xfeed', 'aux_batt']);

function ready(): CockpitRig {
  const r = makeCockpitRig({ state: 'ready_to_taxi' });
  allLoadsOn(r.vars);
  r.step(1);
  return r;
}

describe('Citation M2 circuit breakers', () => {
  it('pulling each panel breaker removes power from its load; pushing it restores power', () => {
    const r = ready();
    const cbs = r.ck.build.controls.filter((c): c is CircuitBreaker => c instanceof CircuitBreaker);
    expect(cbs.length).toBeGreaterThan(55);
    const failures: string[] = [];
    for (const cb of cbs) {
      const name = (cb as unknown as { o: { var: string } }).o.var.slice(3);
      if (PARALLEL_FED.has(name)) continue;
      const pv = poweredVar(name);
      if (r.vars.get(pv) !== 1) {
        failures.push(`${name}: not powered before the pull`);
        continue;
      }
      click(cb);
      r.step(0.1);
      if (r.vars.get(`cb.${name}`) !== 0) failures.push(`${name}: control did not pull the breaker`);
      if (r.vars.get(pv) !== 0) failures.push(`${name}: ${pv} still 1 with the breaker out`);
      click(cb);
      r.step(0.1);
      if (r.vars.get(pv) !== 1) failures.push(`${name}: ${pv} not restored`);
    }
    expect(failures).toEqual([]);
  });

  it('parallel-fed feeders: L XFEED breaker opens the main-bus feed, AUX BATT stops the aux battery charge', () => {
    const r = ready();
    r.step(5);
    // L XFEED: the bus stays up from the battery bus diode (topology), but the L MAIN feed link carries nothing.
    click(r.control('m2.cb.l_xfeed'));
    r.step(0.5);
    expect(r.vars.get('cb.l_xfeed')).toBe(0);
    expect(r.vars.get('elec.l_xfeed_powered')).toBe(1);
    expect(Math.abs(r.vars.get('elec.l_xfeed_main_amps'))).toBeLessThan(0.01);
    // AUX BATT: no charge current into the auxiliary battery.
    click(r.control('m2.cb.aux_batt'));
    r.step(0.5);
    expect(r.vars.get('elec.aux_batt_amps')).toBeLessThanOrEqual(0.001);
  });

  it('downstream consumers follow the breakers (PFD 1, DME, pitch trim, gear control, pitot heat CAS)', () => {
    const r = ready();
    r.step(3);
    expect(r.vars.get('display.pfd1.power')).toBe(1);
    click(r.control('m2.cb.pfd1'));
    r.step(0.5);
    expect(r.vars.get('display.pfd1.power')).toBe(0);
    click(r.control('m2.cb.pfd1'));

    r.vars.set(NAV.dmeValid(1), 1);
    click(r.control('m2.cb.dme'));
    r.step(0.2);
    expect(r.vars.get(NAV.dmeValid(1))).toBe(0);
    click(r.control('m2.cb.dme'));

    click(r.control('m2.cb.trim_pitch'));
    r.step(0.2);
    expect(r.vars.get('elec.trim_pitch_powered')).toBe(0);
    const t0 = r.vars.get('ac.m2.pitch_trim');
    r.vars.set('ac.m2.yoke_trim1', 1);
    r.step(1);
    r.vars.set('ac.m2.yoke_trim1', 0);
    expect(r.vars.get('ac.m2.pitch_trim')).toBeCloseTo(t0, 6); // electric trim dead with the PITCH TRIM breaker out
    click(r.control('m2.cb.trim_pitch'));

    click(r.control('m2.cb.gear_ctl'));
    r.step(0.3);
    expect(r.vars.get('gear.green0')).toBe(0); // gear lights on the gear control breaker
    click(r.control('m2.cb.gear_ctl'));
    r.step(0.3);
    expect(r.vars.get('gear.green0')).toBe(1);
  });

  it('pitot heat breaker in flight raises P/S HTR OFF L', () => {
    const r = makeCockpitRig({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 250, headingTrue: 90 } });
    r.vars.set('ac.m2.pitot_static_sw', 1);
    r.step(4);
    expect(r.vars.get('cas.ps_cold_l')).toBe(0);
    click(r.control('m2.cb.pitot_l'));
    r.step(4);
    expect(r.vars.get('cas.ps_cold_l')).toBe(1);
    click(r.control('m2.cb.pitot_l'));
    r.step(4);
    expect(r.vars.get('cas.ps_cold_l')).toBe(0);
  });

  it('an over-current trips the breaker: the control pops out; it re-trips while the short persists', () => {
    const r = ready();
    const cb = r.control('m2.cb.landing_l') as CircuitBreaker;
    r.vars.set('fail.elec.landing_l.short', 1);
    let t = 0;
    while (r.vars.get('cb.landing_l') !== 0 && t < 10) {
      r.step(0.1);
      t += 0.1;
    }
    expect(r.vars.get('cb.landing_l')).toBe(0);
    expect(r.vars.get('cb.landing_l_tripped')).toBe(1);
    expect(r.vars.get('elec.landing_l_powered')).toBe(0);
    expect(cb.logic.state).toBe('tripped');
    // Reset with the short still present: trips again.
    click(cb);
    expect(r.vars.get('cb.landing_l')).toBe(1);
    r.step(3);
    expect(r.vars.get('cb.landing_l')).toBe(0);
    // Fault cleared: the breaker stays in.
    r.vars.set('fail.elec.landing_l.short', 0);
    click(cb);
    r.step(3);
    expect(r.vars.get('cb.landing_l')).toBe(1);
    expect(r.vars.get('elec.landing_l_powered')).toBe(1);
  });
});
