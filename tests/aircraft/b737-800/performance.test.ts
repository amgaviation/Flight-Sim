/**
 * 737-800 performance against the reference figures (data.ts PERF_REF; see
 * docs/aircraft/b737-800.md §5 for the sources and which values are EST):
 *  (c) climb with LVL CHG / A/T N1 from 10,000 ft to FL350 at 280 KIAS / M0.78,
 *      then cruise at M0.78 (65 t, ISA): TAS and fuel flow within 8 %;
 *  (d) 1-g stall speeds clean / flaps 15 / 30 / 40 within 5 % (KCAS, 60 t),
 *      and the stick shaker ahead of the stall in a 1 kt/s deceleration;
 *  (e) Vmo / Mmo overspeed warning (clacker) at 340 KIAS / M0.82.
 */
import { describe, expect, it } from 'vitest';
import { AP, FDM, ENG } from '../../../src/core/vars';
import { PERF_REF } from '../../../src/aircraft/b737-800/data';
import { B738 } from '../../../src/aircraft/b737-800/vars';
import { makeB738 } from './helpers';

const PPH_TO_KGH = 0.45359237;

describe('(c) climb and cruise', () => {
  it('LVL CHG climb 10,000 ft -> FL350 with A/T N1, levels off in ALT HOLD', () => {
    const r = makeB738({ state: 'cruise', grossKg: 67000, fuelKg: [3900, 3900, 2000], air: { altFtMsl: 10000, iasKt: 280, headingTrue: 90 } });
    const v = r.vars;
    r.run(6);
    expect(v.get(AP.engaged)).toBe(1);
    v.set(AP.selAltitude, 35000);
    v.set(AP.speedIsMach, 0);
    v.set(AP.selSpeed, 280);
    r.events.emit('ac.mcp.lvlchg');
    r.run(1);
    expect(v.getString(AP.verticalActive)).toBe('MCP SPD');
    expect(v.getString(AP.athrMode)).toBe('N1');
    let t = 0;
    let maxN1 = 0;
    let minVs = 1e9;
    r.run(1800, () => {
      t += 1 / 60;
      maxN1 = Math.max(maxN1, v.get(ENG.n1(1)));
      if (v.get(FDM.altMsl) > 12000 && v.get(FDM.altMsl) < 34000) minVs = Math.min(minVs, v.get(FDM.vs));
      return v.get(FDM.altMsl) > 34950 && v.getString(AP.verticalActive) === 'ALT HOLD';
    });
    console.log(`climb 10k->FL350: ${(t / 60).toFixed(1)} min, max N1 ${maxN1.toFixed(1)}, min V/S ${minVs.toFixed(0)} fpm, mass ${v.get(FDM.mass).toFixed(0)}`);
    // EST reference: a 737-800 climbs from 10,000 ft to FL350 at 280 / M0.78 in ~13-18 min at 65-67 t (line experience).
    expect(t / 60).toBeGreaterThan(10);
    expect(t / 60).toBeLessThan(22);
    expect(maxN1).toBeLessThan(101);
    expect(minVs).toBeGreaterThan(600);
    expect(v.getString(AP.verticalActive)).toBe('ALT HOLD');
  });

  it('cruise FL350 M0.78 at 65 t: TAS and fuel flow within 8 % of the reference', () => {
    const r = makeB738({ state: 'cruise', grossKg: PERF_REF.crzWeightKg, fuelKg: [3900, 3900, 1500], air: { altFtMsl: PERF_REF.crzAltFt, iasKt: 265, headingTrue: 90 } });
    const v = r.vars;
    r.run(6);
    expect(v.get(AP.engaged)).toBe(1);
    v.set(AP.speedIsMach, 1);
    v.set(AP.selMach, PERF_REF.crzMach);
    r.run(150);
    let tas = 0;
    let ff = 0;
    let n = 0;
    let altDev = 0;
    r.run(60, () => {
      tas += v.get(FDM.tas);
      ff += (v.get(ENG.fuelFlowPph(1)) + v.get(ENG.fuelFlowPph(2))) * PPH_TO_KGH;
      altDev = Math.max(altDev, Math.abs(v.get('adc1.alt_ft') - PERF_REF.crzAltFt));
      n++;
    });
    tas /= n;
    ff /= n;
    console.log(`cruise: M ${v.get(FDM.mach).toFixed(3)} TAS ${tas.toFixed(0)} kt FF ${ff.toFixed(0)} kg/h N1 ${v.get(ENG.n1(1)).toFixed(1)} mass ${v.get(FDM.mass).toFixed(0)}`);
    expect(Math.abs(tas / PERF_REF.crzKtas - 1)).toBeLessThan(0.08);
    expect(Math.abs(ff / PERF_REF.crzFfKgH - 1)).toBeLessThan(0.08);
    expect(altDev).toBeLessThan(150);
  });
});

describe('(d) stall speeds (1 g, KCAS, 60 t)', () => {
  const cases: [number, number, number][] = [
    // [flap lever index, flap deg, reference VS1G KCAS at 60 t]
    [0, 0, PERF_REF.vsCleanKt],
    [5, 15, 126],
    [7, 30, PERF_REF.vs30Kt],
    [8, 40, PERF_REF.vs40Kt],
  ];
  for (const [lever, deg, ref] of cases) {
    it(`flaps ${deg}: within 5 % of ${ref} KCAS`, () => {
      const r = makeB738({ state: 'cruise', grossKg: PERF_REF.stallWeightKg, fuelKg: [3000, 3000, 0], air: { altFtMsl: 5000, iasKt: 200 } });
      const v = r.vars;
      v.set(B738.flapLever, lever);
      r.sys.flaps.setPosition(deg);
      r.sys.flaps.update(1 / 60);
      v.set('surf.flaps_deg', deg);
      v.set('surf.slats', deg >= 10 ? 1 : deg > 0 ? 0.5 : 0);
      for (const i of [0, 1, 2]) v.set(`gear.pos${i}`, deg >= 15 ? 1 : 0);
      const fm = r.fdm;
      expect(Math.abs(fm.mass - PERF_REF.stallWeightKg)).toBeLessThan(200);
      const stallAlpha = fm.aero.effectiveStallAlpha(deg, v.get('surf.slats'), 0);
      let vs = NaN;
      for (let kt = 220; kt > 80; kt -= 0.25) {
        const t = fm.computeTrim({ iasKt: kt });
        if (!t.converged || t.alphaDeg > stallAlpha - 0.05) {
          vs = kt + 0.25;
          break;
        }
      }
      console.log(`flaps ${deg}: VS1G ${vs} KCAS (ref ${ref})`);
      expect(Math.abs(vs / ref - 1)).toBeLessThan(0.05);
    });
  }

  it('stick shaker ahead of the stall in a 1 kt/s deceleration (flaps 15)', () => {
    const r = makeB738({ state: 'approach', grossKg: PERF_REF.stallWeightKg, fuelKg: [3000, 3000, 0], air: { altFtMsl: 6000, iasKt: 170 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('alert.stick_shaker')).toBe(0);
    // A/P and A/T off (control wheel disconnect, A/T disconnect switch), thrust idle; the pilot holds altitude.
    v.set('input.ap_disc', 1);
    r.events.emit('at.disc');
    r.run(0.3);
    v.set('input.ap_disc', 0);
    v.set(B738.tla(1), 0);
    v.set(B738.tla(2), 0);
    const alt0 = v.get(FDM.altMsl);
    let shakerKt = NaN;
    let integ = 0;
    r.run(80, () => {
      const err = alt0 - v.get(FDM.altMsl);
      // Pitch-rate command toward level flight, integrated into the column position (a smooth pilot).
      const q = v.get('fdm.q_dps');
      const qDes = Math.max(-1, Math.min(1, 0.004 * err - 0.003 * v.get(FDM.vs)));
      integ = Math.max(-1, Math.min(1, integ + (qDes - q) * 0.0015));
      const cmd = Math.max(-1, Math.min(1, integ + 0.03 * (qDes - q)));
      v.set('input.pitch', cmd);
      if (Number.isNaN(shakerKt) && v.get('alert.stick_shaker') === 1) {
        shakerKt = v.get(FDM.cas);
        return true;
      }
    });
    v.set('input.pitch', 0);
    console.log(`flaps 15 stick shaker at ${shakerKt.toFixed(1)} KCAS`);
    expect(v.get(AP.engaged)).toBe(0);
    // Shaker margin ~5-12 % above the 1-g stall speed (VS 126 KCAS at 60 t).
    expect(shakerKt).toBeGreaterThan(126 * 1.03);
    expect(shakerKt).toBeLessThan(126 * 1.15);
  });
});

describe('(e) overspeed warning', () => {
  it('Vmo 340 KIAS at 20,000 ft', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 320, headingTrue: 90 } });
    const v = r.vars;
    r.run(6);
    expect(v.get('alert.overspeed')).toBe(0);
    v.set('ap.sel_spd_kt', 340);
    v.set(B738.tla(1), 1);
    v.set(B738.tla(2), 1);
    r.events.emit('at.disc');
    let hit = NaN;
    r.run(120, () => {
      if (v.get('alert.overspeed') === 1) {
        hit = v.get('adc1.ias_kt');
        return true;
      }
    });
    expect(hit).toBeGreaterThan(339);
    expect(hit).toBeLessThan(345);
    expect(v.get('overspeed.vmo_kt')).toBeCloseTo(340, 0);
  });

  it('Mmo 0.82 at FL370', () => {
    const r = makeB738({ state: 'cruise', grossKg: 60000, air: { altFtMsl: 37000, iasKt: 250, headingTrue: 90 } });
    const v = r.vars;
    r.run(6);
    expect(v.get('alert.overspeed')).toBe(0);
    r.events.emit('at.disc');
    v.set(B738.tla(1), 1);
    v.set(B738.tla(2), 1);
    let hit = NaN;
    r.run(240, () => {
      if (v.get('alert.overspeed') === 1) {
        hit = v.get('adc1.mach');
        return true;
      }
    });
    expect(hit).toBeGreaterThan(0.815);
    expect(hit).toBeLessThan(0.83);
  });
});
