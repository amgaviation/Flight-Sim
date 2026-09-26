/**
 * (a) Cold & dark to engines running, driving only the vars the cockpit
 * controls write, in the G650 "Before Starting Engines" / "Starting Engines"
 * order (checklists.ts): MAIN BATTERIES, FLT CTRL BATTERIES, EMERGENCY POWER
 * ARM, APU MASTER + START, APU bleed, START MASTER, R ENG start + FUEL CONTROL
 * RUN, L ENG, START MASTER OFF, bleeds ON, APU OFF.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, press, posted, type Rig } from './helpers';
import { G650_VARS as V } from '../../../src/aircraft/g650/vars';
import { G650_LIMITS } from '../../../src/aircraft/g650/data';

function startApu(r: Rig): number {
  const v = r.vars;
  v.set(V.apuMaster, 1);
  r.run(14); // LUC: READY within 10-16 s
  press(r, V.apuStart, 0.5);
  let availT = NaN;
  r.run(90, (t) => {
    if (isNaN(availT) && v.get('apu.avail')) availT = t;
    return !isNaN(availT) && t > availT + 3;
  });
  return availT;
}

describe('G650 cold & dark start (LUC powerplant / apu)', () => {
  it('starts the APU and both engines: idle N1/N2/TGT/FF, IDGs on line, start CAS clear', { timeout: 300000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    const v = r.vars;
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
    expect(v.get('eng1.running')).toBe(0);

    // Before Starting Engines: batteries, FCS batteries, emergency power ARM.
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.ebhaBatt, 1);
    v.set(V.upsBatt, 1);
    v.set(V.emerPwr, 1);
    v.set(V.doorMain, 0);
    for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
    r.run(3);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(24.5); // 28 V NiCd (LUC)
    expect(v.get('elec.emer_dc_powered')).toBe(1);
    expect(v.get('elec.fcc_ups_powered')).toBe(1);
    expect(v.get('elec.l_main_ac_powered')).toBe(0);

    // APU: MASTER, READY, START; the starter runs from the left battery (LUC apu, 22 V minimum).
    let minBatt = 99;
    const avail = startApu(r);
    r.run(1, () => void (minBatt = Math.min(minBatt, v.get('elec.l_batt_bus_v'))));
    expect(avail).toBeLessThan(60);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    expect(v.get('elec.l_main_ac_powered')).toBe(1); // APU GEN -> tie bus -> both main AC buses (bus ties AUTO)
    expect(v.get('elec.r_main_ac_powered')).toBe(1);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(27);
    // APU bleed after 60 s (LUC), isolation valve AUTO.
    v.set(V.bleedApu, 1);
    r.run(65);
    expect(v.get(V.apuBleedReady)).toBe(1);
    expect(v.get('pneu.l_duct_psi')).toBeGreaterThanOrEqual(G650_LIMITS.minStartBleedPsi - 2);

    // Starting Engines: START MASTER ON (isolation valve opens, packs off), right engine first.
    v.set(V.startMaster, 1);
    r.run(4);
    expect(v.get('pneu.iso_open')).toBe(1);
    expect(v.get('pneu.pack_r_on')).toBe(0);
    for (const side of [2, 1] as const) {
      const btn = side === 1 ? V.startL : V.startR;
      const fuelCtl = side === 1 ? V.fuelCtlL : V.fuelCtlR;
      expect(v.get(`pneu.${side === 1 ? 'l' : 'r'}_duct_psi`)).toBeGreaterThan(30);
      press(r, btn);
      r.run(3);
      v.set(fuelCtl, 1); // FUEL CONTROL RUN once the engine is motoring
      let peakTgt = 0;
      let lightOff = NaN;
      let idleT = NaN;
      r.run(90, (t) => {
        peakTgt = Math.max(peakTgt, v.get(`eng${side}.itt_c`));
        if (isNaN(lightOff) && v.get(`eng${side}.ff_pph`) > 50) lightOff = t;
        if (isNaN(idleT) && v.get(`eng${side}.running`)) idleT = t;
        return !isNaN(idleT) && t > idleT + 10;
      });
      expect(v.get(`fadec.eng${side}.abort`)).toBe(0);
      expect(idleT).toBeLessThan(60); // EST: auto start ~40 s from the switch
      expect(peakTgt).toBeLessThan(G650_LIMITS.tgtStartGroundC); // LIM: 700 degC ground start
      expect(peakTgt).toBeGreaterThan(450);
      expect(lightOff).toBeLessThan(15);
    }
    v.set(V.startMaster, 0);
    v.set(V.bleedL, 1);
    v.set(V.bleedR, 1);
    v.set(V.bleedApu, 0);
    v.set(V.apuMaster, 0);
    r.run(90);

    // Stabilized ground idle (EST idle figures, fdm.ts), IDGs on line, hydraulics 3,000 psi.
    for (const i of [1, 2]) {
      expect(v.get(`eng${i}.running`)).toBe(1);
      expect(v.get(`eng${i}.n1_pct`)).toBeGreaterThan(22);
      expect(v.get(`eng${i}.n1_pct`)).toBeLessThan(26);
      expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(60);
      expect(v.get(`eng${i}.n2_pct`)).toBeLessThan(64);
      expect(v.get(`eng${i}.itt_c`)).toBeGreaterThan(400);
      expect(v.get(`eng${i}.itt_c`)).toBeLessThan(520);
      expect(v.get(`eng${i}.ff_pph`)).toBeGreaterThan(420);
      expect(v.get(`eng${i}.ff_pph`)).toBeLessThan(560);
      expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(G650_LIMITS.oilPressCautionPsi);
    }
    expect(v.get('elec.idg1_online')).toBe(1);
    expect(v.get('elec.idg2_online')).toBe(1);
    expect(v.get('elec.l_btb_closed')).toBe(0); // each main AC bus on its own IDG
    expect(v.get('elec.l_main_ac_v')).toBeGreaterThan(110);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(27);
    expect(v.get('hyd.left_psi')).toBeGreaterThan(2800);
    expect(v.get('hyd.right_psi')).toBeGreaterThan(2800);
    expect(v.get('apu.running')).toBe(0);
    expect(v.get('elec.batt_l_amps')).toBeGreaterThanOrEqual(0); // charging
    const cas = posted(r);
    for (const t of [
      'caution:L Generator Fail', 'caution:R Generator Fail', 'caution:L-R Generator Fail', 'caution:L-R AC Power Fail', 'caution:L Hyd System Fail',
      'caution:R Hyd System Fail', 'caution:L-R Hyd System Fail', 'caution:L-R Autostart Abort', 'caution:L Autostart Abort', 'caution:R Autostart Abort',
      'warning:L Engine Fail', 'warning:R Engine Fail', 'caution:APU Power Fail', 'caution:L-R Oil Pressure Low',
    ]) {
      expect(cas).not.toContain(t);
    }
    expect(v.get('alert.master_warning')).toBe(0);
    // Epic displays powered from the DC buses.
    expect(v.get('display.epic.du1.power')).toBe(1);
    expect(v.get('display.epic.du3.power')).toBe(1);
    expect(v.get('display.epic.mcdu1.power')).toBe(1);
  });

  it('CRANK MASTER + ENG switch dry-motors without fuel (LUC)', { timeout: 180000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
    r.run(2);
    startApu(r);
    v.set(V.bleedApu, 1);
    r.run(65);
    v.set(V.crankMaster, 1);
    press(r, V.startR);
    let maxN2 = 0;
    r.run(30, () => void (maxN2 = Math.max(maxN2, v.get('eng2.n2_pct'))));
    press(r, V.startR); // push off
    r.run(2);
    expect(maxN2).toBeGreaterThan(15);
    expect(v.get('eng2.ff_pph')).toBe(0);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('fadec.eng2.starter_cmd')).toBe(0);
  });
});
