/**
 * Citation M2 circuit breakers: every panel breaker's load power flag
 * (`elec.<load>_powered`) is read by some system, so pulling a breaker always
 * changes aircraft behaviour, and the consumers added for the LRUs the shared
 * models take no power input for behave as specified:
 *   - GMA 36 x2 (GMAn FAIL, marker receiver in either GMA), GTX (XPDR1 FAIL, no
 *     reply), GWX 70 (radar forced to standby, GWX FAIL);
 *   - avionics cooling fans -> GDU temperature -> PFD1 / MFD1 / PFD2 COOLING,
 *     display dimmed (reduced power usage);
 *   - cabin fan (evaporator blower) -> vapor-cycle A/C cooling;
 *   - passenger signs -> cabin sign lamps and chime.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../../src/cockpit/controls';
import { NAV } from '../../../../src/core/vars';
import { M2 } from '../../../../src/aircraft/citation-m2/vars';
import { M2_SIDE_VARS } from '../../../../src/aircraft/citation-m2/cockpit/side/services';
import { GDU_THERMAL, M2_AVN_HEALTH_VARS } from '../../../../src/aircraft/citation-m2/systems/avionicsHealth';
import { allLoadsOn, click, makeCockpitRig, recordReads, type CockpitRig } from './harness';

/** Feeders (bus links) are checked through their bus in breakers.test.ts. */
const FEEDERS = new Set(['avn1', 'avn2', 'l_xfeed', 'aux_batt', 'dispatch']);

function ready(): CockpitRig {
  const r = makeCockpitRig({ state: 'ready_to_taxi' });
  allLoadsOn(r.vars);
  r.step(1);
  return r;
}

const msgActive = (r: CockpitRig, id: string): boolean => r.sys.suite.system.messages.list.some((m) => m.id === id && m.active);

describe('Citation M2 breaker consumers', () => {
  it('every panel breaker load power flag is read by a system (cold & dark, battery, engines running)', () => {
    const reads = new Set<string>();
    const cold = makeCockpitRig({ state: 'cold_dark' });
    cold.vars.set(M2.battSw, 1);
    allLoadsOn(cold.vars);
    recordReads(cold.vars, () => cold.step(2), reads);
    const r = ready();
    recordReads(r.vars, () => r.step(2), reads);
    const names = r.ck.build.controls
      .filter((c): c is CircuitBreaker => c instanceof CircuitBreaker)
      .map((c) => (c as unknown as { o: { var: string } }).o.var.slice(3))
      .filter((n) => !FEEDERS.has(n));
    expect(names.length).toBeGreaterThan(55);
    const unread = names.filter((n) => !reads.has(`elec.${n}_powered`));
    expect(unread).toEqual([]);
  }, 60000);

  it('GMA 36: GMAn FAIL per unit; the marker receivers stay powered while either GMA is', () => {
    const r = ready();
    r.step(1);
    expect(r.vars.get(NAV.markerPowered)).toBe(1);
    click(r.control('m2.cb.audio1'));
    r.step(1);
    expect(msgActive(r, 'm2.gma1')).toBe(true);
    expect(r.vars.get(NAV.markerPowered)).toBe(1);
    click(r.control('m2.cb.audio2'));
    r.step(1);
    expect(msgActive(r, 'm2.gma2')).toBe(true);
    expect(r.vars.get(NAV.markerPowered)).toBe(0);
    click(r.control('m2.cb.audio1'));
    click(r.control('m2.cb.audio2'));
    r.step(1);
    expect(msgActive(r, 'm2.gma1')).toBe(false);
    expect(msgActive(r, 'm2.gma2')).toBe(false);
  });

  it('transponder and radar breakers: XPDR1 FAIL (no reply, no IDENT), GWX FAIL (radar forced to standby)', () => {
    const r = ready();
    r.vars.set(NAV.xpdrMode, 3);
    r.step(1);
    expect(r.vars.get(M2_AVN_HEALTH_VARS.xpdrReply)).toBe(1);
    click(r.control('m2.cb.xpdr1'));
    r.vars.set(NAV.xpdrIdent, 1);
    r.step(0.5);
    expect(r.vars.get(M2_AVN_HEALTH_VARS.xpdrReply)).toBe(0);
    expect(r.vars.get(NAV.xpdrIdent)).toBe(0);
    expect(msgActive(r, 'm2.xpdr1')).toBe(true);
    click(r.control('m2.cb.xpdr1'));
    r.step(0.5);
    expect(msgActive(r, 'm2.xpdr1')).toBe(false);

    const radar = r.sys.suite.system.radar;
    radar.on = true;
    radar.mode = 'WX';
    r.step(0.2);
    expect(radar.on).toBe(true);
    click(r.control('m2.cb.radar'));
    r.step(0.2);
    expect(radar.on).toBe(false);
    expect(radar.mode).toBe('STBY');
    expect(msgActive(r, 'm2.gwx')).toBe(true);
  });

  it('avionics fans breaker: the GDUs overheat (COOLING message, display dims); fans back in: they cool down', () => {
    const r = ready();
    r.step(1);
    const health = r.sys.avnHealth;
    const brt0 = r.vars.get('display.pfd1.brt');
    expect(r.vars.get(M2_AVN_HEALTH_VARS.gduTemp('pfd1'))).toBeLessThan(GDU_THERMAL.hotC);
    click(r.control('m2.cb.cockpit_fans'));
    r.step(0.2);
    expect(r.vars.get('elec.cockpit_fans_powered')).toBe(0);
    // 30 min without the fans (thermal model advanced in 1 min steps; the rest of the aircraft is static).
    for (let i = 0; i < 30; i++) health.update(60);
    r.step(0.5);
    expect(r.vars.get(M2_AVN_HEALTH_VARS.gduTemp('pfd1'))).toBeGreaterThan(GDU_THERMAL.hotC);
    expect(r.vars.get(M2_AVN_HEALTH_VARS.gduHot('pfd1'))).toBe(1);
    expect(msgActive(r, 'm2.cooling.pfd1')).toBe(true);
    expect(msgActive(r, 'm2.cooling.mfd')).toBe(true);
    expect(r.vars.get('display.pfd1.brt')).toBeCloseTo(brt0 * 0.6, 3);
    click(r.control('m2.cb.cockpit_fans'));
    r.step(0.2);
    for (let i = 0; i < 30; i++) health.update(60);
    r.step(0.5);
    expect(r.vars.get(M2_AVN_HEALTH_VARS.gduHot('pfd1'))).toBe(0);
    expect(msgActive(r, 'm2.cooling.pfd1')).toBe(false);
    expect(r.vars.get('display.pfd1.brt')).toBeCloseTo(brt0, 3);
  });

  it('cabin fan breaker: the vapor-cycle A/C cools the cabin less with the evaporator blower off', () => {
    // Hot day, temperature selector full COLD: the cabin temperature is limited by the cooling capacity.
    const run = (pull: boolean): number => {
      const r = makeCockpitRig({ state: 'ready_to_taxi', oatSeaLevelC: 42 });
      allLoadsOn(r.vars);
      r.vars.set(M2.tempSel, 0);
      r.vars.set(M2.airCondSw, 1);
      r.vars.set(M2.cabinFan, 2);
      r.step(1);
      expect(r.vars.get('elec.air_cond_powered')).toBe(1);
      if (pull) click(r.control('m2.cb.cabin_fan'));
      r.step(120);
      return r.vars.get('pneu.cabin_temp_c');
    };
    const withFan = run(false);
    const noFan = run(true);
    expect(noFan).toBeGreaterThan(withFan + 0.2);
  }, 60000);

  it('passenger signs: lamps follow PASS SAFETY and the breaker; the cabin chime sounds on each change', () => {
    const r = ready();
    const played: string[] = [];
    const audio = r.ctx.audio;
    const orig = audio.play;
    audio.play = (id: string) => void played.push(id);
    try {
      r.vars.set(M2.paxSafety, 0);
      r.step(0.2);
      expect(r.vars.get(M2_SIDE_VARS.beltSign)).toBe(0);
      played.length = 0;
      r.vars.set(M2.paxSafety, 1);
      r.step(0.2);
      expect(r.vars.get(M2_SIDE_VARS.beltSign)).toBe(1);
      expect(r.vars.get(M2_SIDE_VARS.noSmokeSign)).toBe(0);
      r.vars.set(M2.paxSafety, 2);
      r.step(0.2);
      expect(r.vars.get(M2_SIDE_VARS.noSmokeSign)).toBe(1);
      expect(played.filter((p) => p === 'chime').length).toBe(2);
      click(r.control('m2.cb.pax_signs'));
      r.step(0.2);
      expect(r.vars.get(M2_SIDE_VARS.beltSign)).toBe(0);
      expect(r.vars.get(M2_SIDE_VARS.noSmokeSign)).toBe(0);
    } finally {
      audio.play = orig;
    }
  });
});
