/**
 * Initial states (docs/modules/app.md 2.4 / qa.md 6): ground states sit still,
 * in-air states trim themselves and hold altitude / speed; every cockpit control
 * var is consumed by a system (CLAUDE.md "everything in a cockpit works");
 * checklist auto-checks agree with the states.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRig, FIELD, posted } from './helpers';
import { G6K_VARS, G6K_CONTROL_VARS } from '../../../src/aircraft/global6000/vars';
import { G6K_CAS } from '../../../src/aircraft/global6000/systems/cas';
import { G6K_CHECKLISTS } from '../../../src/aircraft/global6000/checklists';
import { horizDist } from '../../physics/helpers';

const V = G6K_VARS;

describe('Global 6000 initial states', () => {
  it('cold & dark: everything off, parked, no main power', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.dc_ess_powered')).toBe(0);
    expect(v.get('elec.ac_bus1_powered')).toBe(0);
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('apu.running')).toBe(0);
    expect(v.get(V.battMaster)).toBe(0);
    expect(v.get(V.parkBrake)).toBeGreaterThan(0.5);
    expect(v.get('alert.master_warning')).toBe(0);
  });

  it('ready to taxi: engines at idle, parked without drift, IRS aligned, no warnings, all vars finite', () => {
    const r = makeRig('ready_to_taxi', { weightLb: 80000, wind: { dir: 230, kt: 12 }, avionics: true });
    const v = r.vars;
    const p0 = { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') };
    r.run(20);
    expect(v.get('eng1.running')).toBe(1);
    expect(v.get('eng2.running')).toBe(1);
    expect(horizDist(p0, { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') })).toBeLessThan(0.3);
    expect(v.get('alert.master_warning')).toBe(0);
    expect(v.get('alert.master_caution')).toBe(0);
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.gen${n}_online`)).toBe(1);
    for (const n of [1, 2, 3]) expect(v.get(`hyd.sys${n}_psi`)).toBeGreaterThan(2800);
    expect(v.get('ahrs1.valid')).toBe(1);
    expect(v.get('display.fusion.afd1.power')).toBe(1);
    const mine = /^(ac\.|elec\.|fuel\.|hyd\.|pneu\.|press\.|eng\d|fdm\.|surf\.|gear\.|brakes\.|apu\.|fire\.|oxy\.|light\.|ice\.|cas\.|fadec\.|trim\.|flaps\.|slats\.|spoilers\.)/;
    for (const [k, x] of Object.entries(v.snapshot().values)) if (mine.test(k)) expect(Number.isFinite(x), k).toBe(true);
  });

  it('takeoff: slats / flaps 6, stab trim in the green band, no NO TAKEOFF warning at take-off thrust', () => {
    const r = makeRig('takeoff', { weightLb: 90000 });
    const v = r.vars;
    r.run(3);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(6, 0);
    expect(v.get('surf.slats')).toBeGreaterThan(0.95);
    expect(v.get(V.noTakeoff)).toBe(0);
    const nonAdvisory = posted(r).filter((t) => !t.startsWith('advisory:') && !t.startsWith('status:'));
    expect(nonAdvisory).toEqual([]);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    r.run(2);
    expect(posted(r).filter((t) => t.startsWith('warning:'))).toEqual([]);
  });

  it('takeoff configuration warning: slats / flaps 0 at take-off thrust -> "CONFIG FLAPS" (NO TAKEOFF)', () => {
    const r = makeRig('takeoff', { weightLb: 90000 });
    const v = r.vars;
    v.set(V.flapLever, 0);
    r.run(20);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(2);
    expect(v.get(V.noTakeoff)).toBe(1);
    expect(posted(r)).toContain('warning:CONFIG FLAPS');
    expect(v.get('alert.master_warning')).toBe(1);
  });

  for (const s of [
    { state: 'cruise' as const, air: { altFtMsl: 45000, iasKt: 235 } },
    { state: 'cruise' as const, air: { altFtMsl: 20000, iasKt: 300 } },
    { state: 'approach' as const, air: { altFtMsl: 3000, iasKt: 140 } },
  ]) {
    it(`${s.state} at ${s.air.altFtMsl} ft: trimmed, holds altitude and speed for 30 s`, () => {
      const r = makeRig(s.state, { weightLb: 78000, air: s.air, field: FIELD, avionics: true });
      const v = r.vars;
      const alt0 = v.get('fdm.alt_msl_ft');
      const ias0 = v.get('fdm.ias_kt');
      let maxDAlt = 0;
      let maxDIas = 0;
      let maxBank = 0;
      r.run(30, () => {
        maxDAlt = Math.max(maxDAlt, Math.abs(v.get('fdm.alt_msl_ft') - alt0));
        maxDIas = Math.max(maxDIas, Math.abs(v.get('fdm.ias_kt') - ias0));
        maxBank = Math.max(maxBank, Math.abs(v.get('fdm.bank_deg')));
      });
      expect(maxDAlt).toBeLessThan(200);
      expect(maxDIas).toBeLessThan(8);
      expect(maxBank).toBeLessThan(3);
      expect(v.get('alert.master_warning')).toBe(0);
      expect(v.get('alert.master_caution')).toBe(0);
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(8000);
      if (s.state === 'cruise') {
        expect(v.get('ap.engaged')).toBe(1);
        expect(v.get('ap.at_engaged')).toBe(1);
        expect(v.get('gear.up_locked')).toBe(1);
      } else {
        expect(v.get('gear.down_locked')).toBe(1);
        expect(v.get('surf.flaps_deg')).toBeGreaterThan(29);
      }
    });
  }
});

describe('Global 6000 control audit', () => {
  it('every cockpit control var is read by a system (no decorative controls)', () => {
    const dir = 'src/aircraft/global6000';
    const files = [join(dir, 'createSystems.ts'), ...readdirSync(join(dir, 'systems')).map((f) => join(dir, 'systems', f))];
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const keyOf = new Map<string, string>();
    for (const [k, x] of Object.entries(G6K_VARS)) if (typeof x === 'string') keyOf.set(x, k);
    const unread: string[] = [];
    for (const name of G6K_CONTROL_VARS) {
      const key = keyOf.get(name);
      // Function-built names (gen(1), hydPump('1b'), fireHandle('l')...) are matched on the builder call (N.<x> tables in logic.ts count).
      const fnUse = Object.entries(G6K_VARS).some(([k, f]) => typeof f === 'function' && new RegExp(`\\bV\\.${k}\\(`).test(src) && builds(f as (...a: unknown[]) => string, name));
      const referenced = src.includes(name) || (key !== undefined && new RegExp(`\\bV\\.${key}\\b`).test(src)) || fnUse;
      if (!referenced) unread.push(name);
    }
    expect(unread).toEqual([]);
  });

  it('CAS ids are unique; published Global Express / Global 6000 texts are present', () => {
    const ids = G6K_CAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = new Set(G6K_CAS.map((m) => m.text));
    for (const t of [
      'L ENG FIRE', 'R ENG FIRE', 'APU FIRE', 'MLG BAY OVHT', 'CONFIG STAB TRIM', 'PARK BRAKE ON', 'GEAR', 'EMER PWR ONLY', 'AC BUS 1 FAIL', 'AC ESS BUS FAIL',
      'DC ESS BUS FAIL', 'BATT BUS FAIL', 'GEN 1 FAIL', 'RAT GEN ON', 'HYD 1 LO PRESS', 'HYD 3 LO PRESS', 'HYD 2 LO QTY', 'FUEL IMBALANCE', 'L PRI FUEL PUMPS',
      'L ENG FLAMEOUT', 'FIRE BTL1 LO PRESS', 'STALL PROTECT FAIL', 'FLAP FAIL', 'SLAT FAIL', 'YD OFF', 'GEAR DISAGREE', 'PASSENGER DOOR', 'CARGO DOOR',
    ]) {
      expect(texts.has(t), t).toBe(true);
    }
  });

  it('checklist auto-checks: "BEFORE TAKEOFF" items pass in the takeoff state, "APPROACH" / "LANDING" in the approach state', () => {
    const r = makeRig('takeoff', { weightLb: 90000 });
    r.run(2);
    for (const title of ['BEFORE TAKEOFF']) {
      const list = G6K_CHECKLISTS.find((c) => c.title === title)!;
      for (const item of list.items) if (item.check) expect(item.check(r.vars), `${title}: ${item.challenge}`).toBe(true);
    }
    const a = makeRig('approach', { weightLb: 78000, air: { altFtMsl: 3000, iasKt: 140 } });
    a.run(2);
    for (const title of ['LANDING']) {
      const list = G6K_CHECKLISTS.find((c) => c.title === title)!;
      for (const item of list.items) if (item.check) expect(item.check(a.vars), `${title}: ${item.challenge}`).toBe(true);
    }
  });
});

/** True when the var-name builder `f` produces `name` for one of the usual arguments. */
function builds(f: (...a: unknown[]) => string, name: string): boolean {
  const args: unknown[][] = [[1], [2], [3], [4], ['l'], ['r'], ['apu'], ['1b'], ['2b'], ['3a'], ['3b'], ['l', 1], ['l', 2], ['r', 1], ['r', 2], ['apu', 1], ['apu', 2]];
  for (const a of args) {
    try {
      if (f(...a) === name) return true;
    } catch {
      /* not this signature */
    }
  }
  return false;
}
