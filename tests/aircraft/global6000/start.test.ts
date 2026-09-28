/**
 * (a) Cold & dark to engines running, driving only the vars the cockpit
 * controls write, in the COCKPIT PREPARATION / BEFORE START / ENGINE START
 * order (checklists.ts): BATT MASTER, APU RUN -> START, APU GEN / APU BLEED,
 * hydraulic pumps, IRS NAV, ENG RUN R + R START, ENG RUN L + L START, APU OFF.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, press, posted, type Rig } from './helpers';
import { G6K_VARS as V } from '../../../src/aircraft/global6000/vars';
import { G6K_LIMITS } from '../../../src/aircraft/global6000/data';

function startApu(r: Rig): number {
  const v = r.vars;
  v.set(V.apuSw, 1); // RUN: inlet door opens, prestart BIT (APU IN BITE)
  r.run(11);
  v.set(V.apuSw, 2); // START (spring-loaded back to RUN)
  r.run(1.5);
  v.set(V.apuSw, 1);
  let availT = NaN;
  r.run(90, (t) => {
    if (isNaN(availT) && v.get('apu.avail')) availT = t;
    return !isNaN(availT) && t > availT + 3;
  });
  return availT;
}

describe('Global 6000 cold & dark start', () => {
  it('starts the APU and both engines: idle N1/N2/ITT/FF, VFGs on line, start CAS clear', { timeout: 300000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    const v = r.vars;
    expect(v.get('elec.dc_ess_powered')).toBe(0);
    expect(v.get('elec.dc_emer_powered')).toBe(1); // hot from the battery direct buses
    expect(v.get('eng1.running')).toBe(0);

    // COCKPIT PREPARATION: BATT MASTER ON, EMER LIGHTS ARM, pass door closed.
    v.set(V.battMaster, 1);
    v.set(V.emerLights, 1);
    v.set(V.door('pax'), 0);
    r.run(3);
    expect(v.get('elec.batt_bus_v')).toBeGreaterThan(23);
    expect(v.get('elec.dc_ess_powered')).toBe(1); // through the emergency tie contactor
    expect(v.get('elec.ac_bus1_powered')).toBe(0);

    // APU start from the APU battery: the battery bus dips while cranking (QA lesson).
    let minBatt = 99;
    const avail = startApu(r);
    r.run(1, () => void (minBatt = Math.min(minBatt, v.get('elec.apu_batt_dir_v'))));
    expect(avail).toBeLessThan(60);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);
    expect(v.get('elec.ac_ess_powered')).toBe(1);
    expect(v.get('elec.dc_ess_v')).toBeGreaterThan(27);
    expect(v.get('elec.dc_bus1_powered')).toBe(1);
    // Hydraulics, IRS, fuel panel, APU bleed AUTO (already), beacon.
    v.set(V.hydPump('1b'), 1);
    v.set(V.hydPump('2b'), 1);
    v.set(V.hydPump('3b'), 1);
    v.set(V.hydPump('3a'), 2);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    v.set(V.ltBeacon, 1);
    v.set(V.apuBleed, 1);
    v.set(V.xbleed, 1);
    r.run(5);
    expect(v.get('hyd.sys3_psi')).toBeGreaterThan(2800); // 3A on the APU generator
    expect(v.get('pneu.l_duct_psi')).toBeGreaterThan(30);

    // ENGINE START: right engine first (EST order); START selector AUTO, ENGINE RUN ON starts the FADEC auto start
    // (GX PTG 17-42).
    expect(v.get(V.engStartSel)).toBe(0);
    for (const side of [2, 1] as const) {
      v.set(V.engRun(side), 1);
      r.run(0.5);
      expect(v.get(`fadec.eng${side}.starter_cmd`)).toBeGreaterThan(0);
      let peakItt = 0;
      let lightOff = NaN;
      let idleT = NaN;
      let minDc = 99;
      r.run(90, (t) => {
        peakItt = Math.max(peakItt, v.get(`eng${side}.itt_c`));
        minDc = Math.min(minDc, v.get('elec.dc_ess_v'));
        if (isNaN(lightOff) && v.get(`eng${side}.ff_pph`) > 50) lightOff = t;
        if (isNaN(idleT) && v.get(`eng${side}.running`)) idleT = t;
        return !isNaN(idleT) && t > idleT + 10;
      });
      expect(v.get(`fadec.eng${side}.abort`)).toBe(0);
      expect(idleT).toBeLessThan(60); // EST: ~40 s from the button
      expect(peakItt).toBeLessThan(G6K_LIMITS.ittStartGroundC); // TCDS 700 C ground start
      expect(peakItt).toBeGreaterThan(450);
      expect(lightOff).toBeLessThan(15);
      expect(minDc).toBeGreaterThan(24); // air start: no DC dip
    }
    v.set(V.apuSw, 0);
    r.run(90);

    // Stabilized ground idle (TCDS idle N2 >= 58 %, EST figures fdm.ts), VFGs on line, hydraulics 3,000 psi.
    for (const i of [1, 2]) {
      expect(v.get(`eng${i}.running`)).toBe(1);
      expect(v.get(`eng${i}.n1_pct`)).toBeGreaterThan(22);
      expect(v.get(`eng${i}.n1_pct`)).toBeLessThan(27);
      expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(G6K_LIMITS.n2IdleMinPct);
      expect(v.get(`eng${i}.n2_pct`)).toBeLessThan(64);
      expect(v.get(`eng${i}.itt_c`)).toBeGreaterThan(400);
      expect(v.get(`eng${i}.itt_c`)).toBeLessThan(560);
      expect(v.get(`eng${i}.ff_pph`)).toBeGreaterThan(420);
      expect(v.get(`eng${i}.ff_pph`)).toBeLessThan(650);
      expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(G6K_LIMITS.oilPressCautionPsi);
    }
    for (const n of [1, 2, 3, 4]) {
      expect(v.get(`elec.gen${n}_online`)).toBe(1);
      expect(v.get(`elec.acb${n}_src`)).toBe(1); // each AC bus on its own VFG
      expect(v.get(`elec.gen${n}_hz`)).toBeGreaterThan(324); // GXEL 324-596 Hz
    }
    expect(v.get('elec.ac_bus1_v')).toBeGreaterThan(110);
    expect(v.get('elec.dc_ess_v')).toBeGreaterThan(27);
    for (const n of [1, 2, 3]) expect(v.get(`hyd.sys${n}_psi`)).toBeGreaterThan(2800);
    expect(v.get('apu.running')).toBe(0);
    expect(v.get('elec.apu_batt_amps')).toBeGreaterThanOrEqual(0); // charging / floating
    const cas = posted(r);
    for (const t of [
      'advisory:GEN 1 FAIL', 'advisory:GEN 2 FAIL', 'advisory:GEN 3 FAIL', 'advisory:GEN 4 FAIL', 'caution:AC BUS 1 FAIL', 'caution:AC BUS 2 FAIL',
      'caution:HYD 1 LO PRESS', 'caution:HYD 2 LO PRESS', 'caution:HYD 3 LO PRESS', 'caution:L ENG START ABORT', 'caution:R ENG START ABORT',
      'caution:L ENG FLAMEOUT', 'caution:R ENG FLAMEOUT', 'warning:L ENG OIL PRESS', 'warning:R ENG OIL PRESS', 'caution:L PRI FUEL PUMPS', 'caution:R PRI FUEL PUMPS',
      'advisory:BATTERY EMER PWR ON', 'caution:DC ESS BUS FAIL',
    ]) {
      expect(cas).not.toContain(t);
    }
    expect(v.get('alert.master_warning')).toBe(0);
    // Fusion displays powered from the DC buses.
    expect(v.get('display.fusion.afd1.power')).toBe(1);
    expect(v.get('display.fusion.afd3.power')).toBe(1);
    expect(v.get('display.fusion.iesi.power')).toBe(1);
  });

  it('CRANK dry-motors without fuel (RUN switch OFF)', { timeout: 180000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battMaster, 1);
    r.run(2);
    startApu(r);
    r.run(5);
    v.set(V.engCrank(2), 1);
    let maxN2 = 0;
    r.run(30, () => void (maxN2 = Math.max(maxN2, v.get('eng2.n2_pct'))));
    v.set(V.engCrank(2), 0);
    r.run(2);
    expect(maxN2).toBeGreaterThan(15);
    expect(v.get('eng2.ff_pph')).toBe(0);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('fadec.eng2.starter_cmd')).toBe(0);
  });
});
