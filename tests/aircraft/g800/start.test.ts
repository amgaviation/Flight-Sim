/**
 * (a) Cold & dark -> normal start procedure, driving only the vars the cockpit
 * controls write (overhead touch keys, pedestal RUN/STOP switches): batteries,
 * APU master/start (battery start, GVI), EMER PWR ARM, APU bleed, START MASTER,
 * R then L START with RUN (checklists.ts "Engine Start"), START MASTER OFF,
 * engine bleeds and packs ON, APU off. Checks idle N1/N2/TGT/fuel flow,
 * generators on line, regulated buses, and that every start-related CAS
 * message has cleared.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { G800_VARS as V } from '../../../src/aircraft/g800/vars';
import { G800_LIMITS } from '../../../src/aircraft/g800/data';

describe('G800 cold & dark start', () => {
  it('starts the APU on battery, both engines with the FADEC auto start, and clears the start CAS', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(2);
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
    expect(v.get('eng1.running')).toBe(0);

    // Before starting engines: batteries ON (>= 20 V, GVI), APU start on the aircraft batteries.
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(3);
    expect(v.get('elec.batt_l_v')).toBeGreaterThan(G800_LIMITS.battMinPreflightV);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(24);
    v.set('ac.door.main', 0);
    v.set(V.apuMaster, 1);
    r.run(12); // inlet door
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    let minEss = 99;
    let peakEgt = 0;
    const tApu = r.run(90, () => {
      minEss = Math.min(minEss, v.get('elec.l_ess_dc_v'));
      peakEgt = Math.max(peakEgt, v.get('apu.egt_c'));
      return v.get('elec.apu_gen_online') === 1;
    });
    expect(tApu).toBeLessThan(80);
    expect(minEss).toBeLessThan(24); // battery dip while cranking (DC starter)
    expect(minEss).toBeGreaterThan(14);
    expect(peakEgt).toBeLessThan(G800_LIMITS.apuEgtStartC);
    r.run(3);
    expect(v.get('elec.l_main_ac_powered')).toBe(1);
    expect(v.get('elec.r_main_ac_powered')).toBe(1);
    expect(v.get('elec.l_main_dc_v')).toBeGreaterThan(26);

    v.set(V.emerPwr, 1);
    v.set(V.bleedApu, 1);
    v.set(V.ltBeacon, 1);
    v.set(V.startMaster, 1);
    r.run(3);
    expect(v.get('pneu.l_man_psi')).toBeGreaterThan(28); // C450: bleed air 28 psi minimum for start
    expect(v.get('pneu.iso_open')).toBe(1); // SCQ: START MASTER opens the isolation valve ...
    expect(v.get('pneu.pack_l_on')).toBe(0); // ... and shuts off the packs

    for (const [i, run, start] of [
      [2, V.runR, V.startR],
      [1, V.runL, V.startL],
    ] as const) {
      v.set(run, 1);
      v.set(start, 1);
      r.run(0.5);
      v.set(start, 0);
      let peakItt = 0;
      let lightOff = NaN;
      const t = r.run(90, (tt) => {
        peakItt = Math.max(peakItt, v.get(`eng${i}.itt_c`));
        if (isNaN(lightOff) && v.get(`eng${i}.ff_pph`) > 50) lightOff = tt;
        return v.getString(`fadec.eng${i}.start_status`) === 'RUN';
      });
      expect(t).toBeLessThan(60);
      expect(lightOff).toBeLessThan(12);
      expect(peakItt).toBeLessThan(G800_LIMITS.tgtStartGroundC); // E135: 800 degC ground start limit
      expect(v.get(`eng${i}.starter`)).toBe(0); // starter cut-out at 42 % HP
      expect(v.get(`fadec.eng${i}.abort`)).toBe(0);
    }

    // After start: START MASTER OFF, engine bleeds and packs ON, APU bleed OFF, APU OFF.
    v.set(V.startMaster, 0);
    v.set(V.bleedL, 1);
    v.set(V.bleedR, 1);
    v.set(V.packL, 1);
    v.set(V.packR, 1);
    v.set(V.bleedApu, 0);
    v.set(V.apuMaster, 0);
    v.set(V.gndSplrArm, 1);
    r.run(30);
    for (const i of [1, 2]) {
      // EST idle (fdm.ts): N1 ~22 %, N2 ~60 %, TGT ~480 degC, ~420-450 pph.
      expect(v.get(`eng${i}.n1_pct`)).toBeGreaterThan(20);
      expect(v.get(`eng${i}.n1_pct`)).toBeLessThan(25);
      expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(57);
      expect(v.get(`eng${i}.n2_pct`)).toBeLessThan(63);
      expect(v.get(`eng${i}.itt_c`)).toBeGreaterThan(420);
      expect(v.get(`eng${i}.itt_c`)).toBeLessThan(560);
      expect(v.get(`eng${i}.ff_pph`)).toBeGreaterThan(350);
      expect(v.get(`eng${i}.ff_pph`)).toBeLessThan(550);
      expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(G800_LIMITS.oilPressIdleMinPsi);
    }
    expect(v.get('elec.idg1_online')).toBe(1);
    expect(v.get('elec.idg2_online')).toBe(1);
    expect(v.get('elec.gcb1_closed')).toBe(1);
    expect(v.get('elec.gcb2_closed')).toBe(1);
    expect(v.get('elec.l_main_ac_v')).toBeGreaterThan(110);
    expect(v.get('elec.l_main_dc_v')).toBeGreaterThan(26);
    expect(v.get('elec.l_main_dc_v')).toBeLessThan(29.5);
    expect(v.get('hyd.left_psi')).toBeGreaterThan(2800);
    expect(v.get('hyd.right_psi')).toBeGreaterThan(2800);
    expect(v.get('pneu.pack_l_on')).toBe(1);
    // Start-related CAS messages cleared.
    const posted = casTexts(r);
    for (const t of ['Generator Off', 'Autostart Abort', 'Oil Pressure Low', 'Hydraulic Pressure Low', 'Fuel Pressure Low', 'Main Fuel Pump Fail', 'Batt Discharge', 'AC Bus Fail', 'Bleed Pressure Low', 'APU Fault']) {
      expect(posted.filter((p) => p.includes(t))).toEqual([]);
    }
    expect(casTexts(r, 'warning')).toEqual([]);
    // Fuel is burnt from the wing tanks (the FDM does not burn fuel).
    const f0 = v.get('fuel.total_kg');
    r.run(60);
    expect(f0 - v.get('fuel.total_kg')).toBeGreaterThan(5); // 2 x ~440 pph = 14.7 lb/min = 6.7 kg/min
  });
});
