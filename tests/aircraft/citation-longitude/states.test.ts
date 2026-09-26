/**
 * Initial states (docs/modules/app.md 2.4 / qa.md 6): ground states sit still,
 * in-air states are trimmed and hold altitude / speed hands-off; every cockpit
 * control var is consumed by a system (CLAUDE.md "everything in a cockpit works").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRig, FIELD } from './helpers';
import { LON_VARS, LON_CONTROL_VARS } from '../../../src/aircraft/citation-longitude/vars';
import { LONGITUDE_CAS } from '../../../src/aircraft/citation-longitude/systems/cas';
import { horizDist } from '../../physics/helpers';

describe('Citation Longitude initial states', () => {
  it('ready to taxi: engines at idle, parked without drift, no warnings', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { weightLb: 34000, wind: { dir: 230, kt: 10 } });
    const v = r.vars;
    const p0 = { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') };
    r.run(20);
    expect(v.get('eng1.running')).toBe(1);
    expect(v.get('eng2.running')).toBe(1);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(horizDist(p0, { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') })).toBeLessThan(0.3);
    expect(v.get('alert.master_warning')).toBe(0);
    expect(v.get('elec.gen_l_online')).toBe(1);
    expect(v.get('ahrs1.valid')).toBe(1);
    // Every var of the aircraft systems and the FDM is finite (avionics/AFCS/TCAS modules use NaN as 'no value').
    const mine = /^(ac\.lon\.|elec\.|fuel\.|hyd\.|pneu\.|press\.|eng\d|fdm\.|surf\.|gear\.|brakes\.|apu\.|fire\.|oxy\.|light\.|ice\.|cas\.|fadec\.|trim\.|flaps\.|spoilers\.)/;
    for (const [k, x] of Object.entries(v.snapshot().values)) if (mine.test(k)) expect(Number.isFinite(x), k).toBe(true);
  });

  it('takeoff: before-takeoff checks complete (no NO TAKEOFF), flaps 2, trims in band', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { weightLb: 36000 });
    const v = r.vars;
    r.run(3);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(15, 0);
    expect(v.get('trim.pitch_to_ok')).toBe(1);
    expect(v.get(LON_VARS.noTakeoff)).toBe(0);
    expect(v.get('brakes.parking_set')).toBe(0);
    const posted = r.sys.cas.list.filter((e) => e.active && e.level !== 'advisory').map((e) => e.text);
    expect(posted).toEqual([]);
  });

  for (const s of [
    { state: 'cruise' as const, air: { altFtMsl: 41000, iasKt: 240 } },
    { state: 'approach' as const, air: { altFtMsl: 4500, iasKt: 140 } },
  ]) {
    it(`${s.state}: trimmed in the air, holds altitude and speed for 20 s`, { timeout: 120000 }, () => {
      const r = makeRig(s.state, { weightLb: 33000, air: s.air, field: { ...FIELD, elevFt: 1333 } });
      const v = r.vars;
      const alt0 = v.get('fdm.alt_msl_ft');
      const ias0 = v.get('fdm.ias_kt');
      let maxDAlt = 0;
      let maxDIas = 0;
      let maxBank = 0;
      r.run(20, () => {
        maxDAlt = Math.max(maxDAlt, Math.abs(v.get('fdm.alt_msl_ft') - alt0));
        maxDIas = Math.max(maxDIas, Math.abs(v.get('fdm.ias_kt') - ias0));
        maxBank = Math.max(maxBank, Math.abs(v.get('fdm.bank_deg')));
      });
      expect(maxDAlt).toBeLessThan(300);
      expect(maxDIas).toBeLessThan(10);
      expect(maxBank).toBeLessThan(5);
      expect(v.get('alert.master_warning')).toBe(0);
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(8000);
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

describe('Citation Longitude control audit', () => {
  it('every cockpit control var is read by a system (no decorative controls)', () => {
    const dir = 'src/aircraft/citation-longitude';
    const files = [join(dir, 'createSystems.ts'), ...readdirSync(join(dir, 'systems')).map((f) => join(dir, 'systems', f))];
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const keyOf = new Map<string, string>();
    for (const [k, x] of Object.entries(LON_VARS)) if (typeof x === 'string') keyOf.set(x, k);
    const unread: string[] = [];
    for (const name of LON_CONTROL_VARS) {
      const key = keyOf.get(name);
      const referenced = src.includes(name) || (key !== undefined && new RegExp(`\\bV\\.${key}\\b`).test(src)) || /^ac\.tla\d$/.test(name);
      if (!referenced) unread.push(name);
    }
    expect(unread).toEqual([]);
  });

  it('CAS message ids are unique and every OG message text is present', () => {
    const ids = LONGITUDE_CAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = new Set(LONGITUDE_CAS.map((m) => m.text));
    // OG Section 3 (red / amber / white lists).
    for (const t of [
      "BATTERY O'TEMP L", 'BRAKE FAIL', 'CABIN ALTITUDE', 'CABIN DELTA P', 'ENG EXCEEDANCE L', 'ENGINE FAIL R', 'GENS OFF', "HYD O'TEMP A", 'LANDING GEAR', 'NO TAKEOFF', 'P/S BUTTON ON',
      'A/I ENG OFF L', 'A/I WING OFF R', 'APU BLEED OFF', 'APU ON', 'BATT DISCHARGE L', 'BATTERY AMPS R', 'BATTERY LOW TAKEOFF', 'BATTERY OFF L', 'BATTERY VOLTS R', 'BLEED ISOLATE NORM', 'BLEED ISOLATE XFLOW',
      'BRAKE TEMP L', 'BUS TIE CLOSED', 'ELEC EMER L', 'EMER BUS OFF R', 'ENG BLEED OFF L', 'FUEL IMBALANCE', 'FUEL INLET COLD L', 'FUEL LEVEL LOW R', 'FUEL TANK COLD L', 'FUEL TEMP MISCOMPARE',
      'FUEL TRANSFER FAIL', 'FUEL TRANSFER ON', 'GEAR DISAGREE N', 'GEN LOAD APU', 'GEN OFF R', 'GND SPOILER FAIL', 'GRD SPOILER ACCUM', 'HEAT EXCHG ONLY', 'HYD GEN ON', 'HYD PRESS LOW B', 'HYD SHUTOFF A',
      'MAIN BUS OFF L', 'MISSION BUS OFF R', 'PARK BRAKE LOW PRESS', 'PARK BRAKE ON', 'PRESS MODE MANUAL', 'PRESS SOURCE OFF L', 'PTCU NOT NORM', 'RUDDER FAIL A-B', 'RUDDER STANDBY OFF', 'SPEEDBRAKE AUTO STOW',
      'SPEEDBRAKES', 'YAW DAMPER FAIL A/B', 'A/I ENG ON L', 'A/I WING ON', 'A/I WING XFLOW OPEN', 'ACM ONLY', 'ENG DRY MTR PROC L', 'ENGINE SHUTDOWN R', 'FUEL BOOST PUMP ON L', 'FUEL GRV XFLOW ON',
      'HYD AUX PUMP ON A', 'HYD FW SHUTOFF B', 'ICE PROTECT ALL ON', 'PITOT STATIC ON', 'PTCU OFF', 'STAB DE-ICE ON', 'ICING',
    ]) {
      expect(texts.has(t), t).toBe(true);
    }
  });
});
