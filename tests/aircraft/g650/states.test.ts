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
import { G650_VARS, G650_CONTROL_VARS } from '../../../src/aircraft/g650/vars';
import { G650_CAS } from '../../../src/aircraft/g650/systems/cas';
import { G650_CHECKLISTS } from '../../../src/aircraft/g650/checklists';
import { horizDist } from '../../physics/helpers';

describe('G650 initial states', () => {
  it('cold & dark: everything off, parked, no power', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
    expect(v.get('elec.emer_dc_powered')).toBe(0);
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(0);
  });

  it('ready to taxi: engines at idle, parked without drift, IRS aligned, no warnings, all vars finite', () => {
    const r = makeRig('ready_to_taxi', { weightLb: 75000, wind: { dir: 230, kt: 12 }, avionics: true });
    const v = r.vars;
    const p0 = { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') };
    r.run(20);
    expect(v.get('eng1.running')).toBe(1);
    expect(v.get('eng2.running')).toBe(1);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(horizDist(p0, { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') })).toBeLessThan(0.3);
    expect(v.get('alert.master_warning')).toBe(0);
    expect(v.get('elec.idg1_online')).toBe(1);
    expect(v.get('ahrs1.valid')).toBe(1);
    expect(v.get('fbw.mode_code')).toBe(0);
    expect(v.get('display.epic.du1.power')).toBe(1);
    const mine = /^(ac\.g650\.|elec\.|fuel\.|hyd\.|pneu\.|press\.|eng\d|fdm\.|surf\.|gear\.|brakes\.|apu\.|fire\.|oxy\.|light\.|ice\.|cas\.|fadec\.|trim\.|flaps\.|spoilers\.|fbw\.)/;
    for (const [k, x] of Object.entries(v.snapshot().values)) if (mine.test(k)) expect(Number.isFinite(x), k).toBe(true);
  });

  it('takeoff: flaps 20, trim in the green band, no takeoff-configuration warning at takeoff thrust', () => {
    const r = makeRig('takeoff', { weightLb: 80000 });
    const v = r.vars;
    r.run(3);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(20, 0);
    expect(v.get(G650_VARS.noTakeoff)).toBe(0);
    expect(v.get('brakes.parking_set')).toBe(0);
    const nonAdvisory = posted(r).filter((t) => !t.startsWith('advisory:') && !t.startsWith('status:'));
    expect(nonAdvisory).toEqual([]);
    v.set(G650_VARS.tla(1), 1);
    v.set(G650_VARS.tla(2), 1);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    r.run(2);
    expect(v.get('alert.takeoff_config')).toBe(0);
    expect(posted(r)).not.toContain('warning:Takeoff Configuration');
  });

  it('takeoff configuration warning: flaps UP at takeoff thrust', () => {
    const r = makeRig('takeoff', { weightLb: 80000 });
    const v = r.vars;
    v.set(G650_VARS.flapLever, 0);
    r.run(15);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    v.set(G650_VARS.tla(1), 1);
    v.set(G650_VARS.tla(2), 1);
    r.run(2);
    expect(v.get('alert.takeoff_config')).toBe(1);
    expect(posted(r)).toContain('warning:Takeoff Configuration');
  });

  for (const s of [
    { state: 'cruise' as const, air: { altFtMsl: 45000, iasKt: 250 } },
    { state: 'cruise' as const, air: { altFtMsl: 20000, iasKt: 300 } },
    { state: 'approach' as const, air: { altFtMsl: 3000, iasKt: 150 } },
  ]) {
    it(`${s.state} at ${s.air.altFtMsl} ft: trimmed, holds altitude and speed for 30 s`, () => {
      const r = makeRig(s.state, { weightLb: 72000, air: s.air, field: FIELD, avionics: true });
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
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(6000);
      expect(v.get('fbw.mode_code')).toBe(0);
      if (s.state === 'cruise') {
        expect(v.get('ap.engaged')).toBe(1);
        expect(v.get('ap.at_engaged')).toBe(1);
        expect(v.get('gear.up_locked')).toBe(1);
      } else {
        expect(v.get('gear.down_locked')).toBe(1);
      }
    });
  }
});

describe('G650 control audit', () => {
  it('every cockpit control var is read by a system (no decorative controls)', () => {
    const dir = 'src/aircraft/g650';
    const files = [join(dir, 'createSystems.ts'), ...readdirSync(join(dir, 'systems')).map((f) => join(dir, 'systems', f))];
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const keyOf = new Map<string, string>();
    for (const [k, x] of Object.entries(G650_VARS)) if (typeof x === 'string') keyOf.set(x, k);
    const unread: string[] = [];
    for (const name of G650_CONTROL_VARS) {
      const key = keyOf.get(name);
      // Function-built names (zoneTemp(1), probe(2), duBrt(3), tla(1)...) are matched on the builder call.
      const fnUse = [...Object.entries(G650_VARS)].some(([k, f]) => typeof f === 'function' && [1, 2, 3, 4, 'crew', 'reset', 'privacy', 'aft_privacy', 'stall', 'gpws', 'antiskid', 'ice_det'].some((i) => (f as (i: number | string) => string)(i) === name) && new RegExp(`\\bV\\.${k}\\(`).test(src));
      const referenced = src.includes(name) || (key !== undefined && new RegExp(`\\bV\\.${key}\\b`).test(src)) || fnUse || /^ac\.tla\d$/.test(name);
      if (!referenced) unread.push(name);
    }
    expect(unread).toEqual([]);
  });

  it('CAS ids are unique; published Gulfstream texts are present', () => {
    const ids = G650_CAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = new Set(G650_CAS.map((m) => m.text));
    for (const t of [
      'L Engine Fire', 'R Engine Fire', 'APU Fire', 'Cabin Pressure Low', 'Aircraft Configuration', 'L-R AC Power Fail', 'APU Power Fail', 'RAT Generator On',
      'L Generator Fail', 'L Generator Off', 'Fwd Emer Battery On', 'Aft Emer Battery On', 'L Hyd System Fail', 'L-R Hyd System Fail', 'L Hydraulic Quantity Low',
      'Aux Hyd Pump On', 'PTU Hyd On', 'PTU Hydraulic Fail', 'L-R Fuel Level Low', 'Fuel Imbalance', 'Fuel Crossflow Valve Open', 'Fuel Inter Tank Valve Open',
      'R Alt Fuel Pump Fail', 'L Oil Pressure Low', 'L-R Autostart Abort', 'L Bleed Pressure Low', 'Isolation Valve Open', 'Ram Air Selected On',
      'Cabin Differential - 10.80', 'Cabin Differential - 11.00', 'Cabin Pressure Manual', 'CPCS Fail - Select Manual', 'L-R Ice Detected', 'L Wing Temperature Low',
      'L-R Wing Anti-Ice ON', 'L-R Cowl Anti-Ice ON', 'FCC Alternate Mode', 'FCC Direct Mode', 'AOA Limiting', 'Stall Protection Active', 'Stall Protection Unavail',
      'Yaw Damper Off', 'Speed Brake Auto Retract', 'Flaps Failed', 'Steer by Wire Fail', 'Pedal Steering Off', 'Brake by Wire Fail', 'Brake Overheat',
      'Parking Brake On', 'Autobrake - RTO', 'Ground Spoiler Unarm', 'IRS 1-2-3 Aligning', 'Main Door', 'External Baggage Door', 'R Fire Bottle Discharge',
      'L Fire Bottle Discharge', 'Fire Detection Loop Fault', 'Passenger Oxygen On', 'Elevator Trim Up Limit', 'High Speed Protect Active',
    ]) {
      expect(texts.has(t), t).toBe(true);
    }
  });

  it('checklist auto-checks: "Before Takeoff" items pass in the takeoff state', () => {
    const r = makeRig('takeoff', { weightLb: 80000 });
    r.run(2);
    const list = G650_CHECKLISTS.find((c) => c.title === 'Before Takeoff')!;
    for (const item of list.items) if (item.check) expect(item.check(r.vars), item.challenge).toBe(true);
    const bt = G650_CHECKLISTS.find((c) => c.title === 'Before Taxi')!;
    for (const item of bt.items) if (item.check) expect(item.check(r.vars), item.challenge).toBe(true);
  });
});
