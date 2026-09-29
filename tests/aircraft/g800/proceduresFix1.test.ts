/**
 * Fix round 1, procedures lens (gaps G800-PROC-01..14): regression tests that
 * would fail without the fixes.
 *  - P01 fire test ordered before the APU start (and the old order really trips the APU).
 *  - P02 START MASTER bracketed in the Engine Start list; a mis-sequenced ENGINE START
 *    press is held pending and completes once FUEL CONTROL goes to RUN.
 *  - P03 "L/R Reverser Unlock" red CAS in flight + linked abnormal checklist.
 *  - P04/P11 Taxi, After Landing and Securing lists; WARN INHIBIT on Taxi.
 *  - P05/P06 cruise preset TRS CRZ / STD baro / transponder / A/T; xpdr in every preset.
 *  - P07 main-door item + takeoff-config MAIN DOOR check.
 *  - P08 PEDAL STEER item without the retired NWS switch.
 *  - P10 APU unloaded cooldown after the stop command.
 *  - P14 recognition lights off at cruise.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { G800_VARS as V, AUTOBRAKE } from '../../../src/aircraft/g800/vars';
import { G800_CHECKLISTS } from '../../../src/aircraft/g800/checklists';
import type { SimVars } from '../../../src/core/SimVars';

const list = (title: string) => {
  const l = G800_CHECKLISTS.find((c) => c.title === title);
  expect(l, `checklist "${title}"`).toBeTruthy();
  return l!;
};
const itemIdx = (title: string, challenge: string) => list(title).items.findIndex((i) => i.challenge === challenge);
const failing = (title: string, v: SimVars) => list(title).items.filter((i) => i.check && !i.check(v)).map((i) => i.challenge);

describe('G800 procedures fix round 1', () => {
  it('P01: fire detection tested before the APU items, and the listed order keeps the APU alive', { timeout: 240000 }, () => {
    const l = list('Before Starting Engines');
    const fire = itemIdx('Before Starting Engines', 'Fire detection');
    const apu = l.items.findIndex((i) => i.challenge === 'APU');
    expect(fire).toBeGreaterThanOrEqual(0);
    expect(apu).toBeGreaterThan(fire);
    // Execute the list in its own order: batteries, fire test, then the APU start.
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(2);
    v.set(V.fireTest, 1);
    r.run(2);
    expect(casTexts(r, 'warning').some((t) => t.includes('Fire'))).toBe(true); // the test lights the loops
    v.set(V.fireTest, 0);
    r.run(2);
    v.set(V.apuMaster, 1);
    r.run(12);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(90, () => v.get('apu.avail') !== 0);
    expect(v.get('apu.avail')).toBe(1);
    expect(v.get('apu.fault')).toBe(0);
    expect(casTexts(r, 'caution')).not.toContain('APU Fault');
    // Counter-check: the fire test WITH the APU running still trips it (the reason for the order).
    v.set(V.fireTest, 1);
    r.run(2);
    v.set(V.fireTest, 0);
    r.run(2);
    expect(v.get('apu.avail')).toBe(0);
  });

  it('P02: Engine Start list brackets START MASTER around the starts', () => {
    const on = itemIdx('Engine Start', 'START MASTER');
    const items = list('Engine Start').items;
    const off = items.findIndex((i, k) => k > on && i.challenge === 'START MASTER' && i.response === 'OFF');
    const rFuel = itemIdx('Engine Start', 'R FUEL CONTROL');
    const gens = items.findIndex((i) => i.challenge === 'L / R GEN');
    expect(on).toBeGreaterThanOrEqual(0);
    expect(items[on].response).toBe('ON');
    expect(on).toBeLessThan(rFuel);
    expect(off).toBeGreaterThan(rFuel);
    expect(off).toBeLessThan(gens);
  });

  it('P02: a START press before FUEL CONTROL RUN is held pending and completes at RUN', { timeout: 240000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // Stop the right engine, then re-start with the OHPTS keys in the "wrong" order.
    v.set(V.runR, 0);
    r.run(40);
    expect(v.get('eng2.running')).toBe(0);
    v.set(V.startMaster, 1);
    v.set(V.startR, 1);
    r.run(0.5);
    v.set(V.startR, 0);
    r.run(2);
    v.set(V.runR, 1); // RUN selected AFTER the press: the pending request must execute
    const t = r.run(120, () => v.getString('fadec.eng2.start_status') === 'RUN');
    expect(v.getString('fadec.eng2.start_status')).toBe('RUN');
    expect(t).toBeLessThan(120);
    v.set(V.startMaster, 0);
    r.run(30);
    // Same with the forward-strip ENGINE START button (no START MASTER): press, then RUN.
    v.set(V.runL, 0);
    r.run(40);
    expect(v.get('eng1.running')).toBe(0);
    const n2Before = v.get('eng1.n2_pct');
    v.set(V.engStartBtn, 1);
    r.run(0.5);
    v.set(V.engStartBtn, 0);
    r.run(2);
    expect(v.get('eng1.n2_pct')).toBeLessThan(n2Before + 1); // not motoring yet: fuel control still OFF
    v.set(V.runL, 1);
    const t2 = r.run(120, () => v.getString('fadec.eng1.start_status') === 'RUN');
    expect(v.getString('fadec.eng1.start_status')).toBe('RUN');
    expect(t2).toBeLessThan(120);
  });

  it('P03: uncommanded reverser deploy in flight raises the red CAS and a linked checklist exists', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('rev.eng1.uncmd');
    r.run(4);
    expect(v.get('eng1.reverser_pos')).toBeGreaterThan(0.5);
    expect(casTexts(r, 'warning')).toContain('L Reverser Unlock');
    // The abnormal checklist is titled with the CAS text (ChecklistLogic.findForCas matches by title).
    for (const s of ['L', 'R']) {
      const l = list(`${s} Reverser Unlock`);
      expect(l.phase).toBe('Emergency');
      expect(l.items[0].challenge).toBe(`${s} Power Lever`);
    }
  });

  it('P04/P11: Taxi, After Landing and Securing lists; WARN INHIBIT moved to Taxi', () => {
    expect(itemIdx('Taxi', 'WARN INHIBIT')).toBeGreaterThanOrEqual(0);
    expect(list('Before Takeoff').items.some((i) => i.challenge === 'WARN INHIBIT')).toBe(false);
    expect(list('After Takeoff / Climb').items.some((i) => i.challenge === 'WARN INHIBIT')).toBe(true); // OFF item kept
    expect(itemIdx('After Landing', 'Flaps')).toBeGreaterThanOrEqual(0);
    expect(itemIdx('Securing', 'BATTERIES MAIN L / R')).toBe(list('Securing').items.length - 1);
  });

  it('P04: After Landing + Shutdown + Securing leave the cockpit dark and clean', { timeout: 180000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // After Landing items
    v.set(V.flapLever, 0);
    v.set(V.gndSplrArm, 0);
    v.set(V.autobrake, AUTOBRAKE.OFF);
    v.set(V.ltStrobe, 0);
    v.set(V.ltLandingL, 0);
    v.set(V.ltLandingR, 0);
    r.run(25);
    expect(failing('After Landing', v)).toEqual([]);
    // Shutdown
    v.set(V.parkBrake, 1);
    v.set(V.runL, 0);
    v.set(V.runR, 0);
    v.set(V.ltBeacon, 0);
    v.set(V.ltSeatbelt, 0);
    v.set(V.apuMaster, 0);
    r.run(40);
    expect(failing('Shutdown', v)).toEqual([]);
    // Securing
    v.set(V.bleedL, 0);
    v.set(V.bleedR, 0);
    v.set(V.bleedApu, 0);
    v.set(V.packL, 0);
    v.set(V.packR, 0);
    v.set(V.boostL, 0);
    v.set(V.boostR, 0);
    v.set(V.wshldL, 0);
    v.set(V.wshldR, 0);
    v.set(V.cabinWdoHeat, 0);
    v.set(V.oxyCrew, 0);
    v.set(V.cabinMaster, 0);
    v.set(V.galleyMaster, 0);
    v.set(V.ltNav, 0);
    v.set(V.ltTaxi, 0);
    v.set(V.ltEmer, 0);
    v.set(V.emerPwr, 0);
    v.set(V.fcsBattEbha, 0);
    v.set(V.fcsBattUps, 0);
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(5);
    expect(failing('Securing', v)).toEqual([]);
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
  });

  it('P05: cruise preset - TRS CRZ, STD baro, transponder TA/RA, A/T engaged', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { avionics: true, weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    expect(v.getString('fadec.rating')).toBe('CRZ');
    expect(v.get('adc1.baro_std')).toBe(1);
    expect(v.get('xpdr.mode')).toBe(5);
    expect(v.get('xpdr.code')).toBeGreaterThan(0);
    expect(v.get('ap.at_engaged')).toBe(1);
    expect(v.get('ap.engaged')).toBe(1);
    // The Cruise checklist now passes right after loading the preset.
    expect(failing('Cruise', v)).toEqual([]);
  });

  it('P06: transponder per preset and the Before Takeoff item', { timeout: 120000 }, () => {
    const cases: [string, number][] = [
      ['ready_to_taxi', 1],
      ['takeoff', 5],
      ['approach', 5],
    ];
    for (const [s, mode] of cases) {
      const r = makeRig(s as 'takeoff', s === 'approach' ? { weightLb: 70000, air: { altFtMsl: 2500, iasKt: 170 } } : {});
      r.run(1);
      expect(r.vars.get('xpdr.mode'), s).toBe(mode);
      expect(r.vars.get('xpdr.code'), s).toBeGreaterThan(0);
    }
    const bto = list('Before Takeoff');
    const x = bto.items.find((i) => i.challenge === 'Transponder / TCAS')!;
    expect(x).toBeTruthy();
    const r = makeRig('takeoff');
    r.run(1);
    expect(x.check!(r.vars)).toBe(true);
    r.vars.set('xpdr.mode', 1);
    expect(x.check!(r.vars)).toBe(false);
  });

  it('P07: main door item in Before Starting Engines and MAIN DOOR in the takeoff config warning', { timeout: 120000 }, () => {
    const door = list('Before Starting Engines').items.find((i) => i.challenge === 'Main entry door')!;
    expect(door).toBeTruthy();
    const r = makeRig('takeoff');
    const v = r.vars;
    r.run(1);
    expect(door.check!(v)).toBe(true);
    // Open the airstair (ground, powered, SAFETY off), then push the levers up: config warning names the door.
    v.set(V.doorOpenCmd, 1);
    r.run(12);
    expect(v.get('ac.door.main')).toBeGreaterThan(0.9);
    expect(door.check!(v)).toBe(false);
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(2);
    expect(v.get('alert.takeoff_config')).not.toBe(0);
    expect(casTexts(r, 'warning')).toContain('Takeoff Config');
  });

  it('P08: PEDAL STEER item does not require the retired NWS switch', () => {
    const bt = list('Before Taxi');
    expect(bt.items.some((i) => i.challenge.includes('NOSEWHEEL'))).toBe(false);
    const item = bt.items.find((i) => i.challenge === 'PEDAL STEER')!;
    const r = makeRig('ready_to_taxi');
    r.run(1);
    r.vars.set(V.nwsSw, 0); // the var is retired; the checklist must not read it
    r.vars.set(V.pedalSteer, 1);
    expect(item.check!(r.vars)).toBe(true);
  });

  it('P10: APU MASTER OFF runs an unloaded ~60 s cooldown before the fuel cut', { timeout: 240000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(2);
    v.set(V.apuMaster, 1);
    r.run(12);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(90, () => v.get('apu.avail') !== 0);
    expect(v.get('apu.avail')).toBe(1);
    v.set(V.apuMaster, 0);
    r.run(2);
    expect(v.get('apu.avail')).toBe(0); // generator / bleed drop at once
    expect(v.get('apu.cooldown')).toBe(1);
    expect(v.get('apu.n_pct')).toBeGreaterThan(95); // still governed, not spooling down
    r.run(30);
    expect(v.get('apu.n_pct')).toBeGreaterThan(95);
    r.run(40); // past the 60 s cooldown
    expect(v.get('apu.cooldown')).toBe(0);
    expect(v.get('apu.n_pct')).toBeLessThan(90); // spooling down after the fuel cut
  });

  it('P14: recognition lights off at cruise, on for takeoff / approach', { timeout: 120000 }, () => {
    const cr = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } });
    cr.run(1);
    expect(cr.vars.get(V.ltRecog)).toBe(0);
    const to = makeRig('takeoff');
    to.run(1);
    expect(to.vars.get(V.ltRecog)).toBe(1);
  });
});
