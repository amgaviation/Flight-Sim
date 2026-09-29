/**
 * Citation M2 performance against the Textron Flight Planning Guide (FPG,
 * 525-0800 and on) and TCDS limits:
 *  (b) takeoff at MTOW, flaps 15, sea level ISA: VR 105 KIAS, all-engine and
 *      one-engine-inoperative distances vs the 3,210 ft balanced field length;
 *  (c) climb to FL410 (24 min at MTOW) and high-speed cruise at FL330 / FL410
 *      (KTAS and fuel flow within 8 %);
 *  (d) stall speeds clean / flaps 15 / flaps 35 within 5 % (KCAS);
 *  (e) Vmo / Mmo overspeed warning.
 */
import { describe, expect, it } from 'vitest';
import { AP, FDM } from '../../../src/core/vars';
import { M2, TLA } from '../../../src/aircraft/citation-m2/vars';
import { HIGH_SPEED_CRUISE, STALL_KCAS, TOFL_SL_15C, CLIMB_MTOW, lookup } from '../../../src/aircraft/citation-m2/data';
import { casFromTas, isaPressure, isaTemperature } from '../../../src/physics/atmosphere';
import { horizDist } from '../../physics/helpers';
import { FIELD, LB, makeM2 } from './helpers';

const M_TO_FT = 3.28084;
const EMPTY_PLUS_PILOT_LB = 6790 - 30.64 + 200; // FDM empty (typically equipped, less unusable fuel) + pilot

function takeoff(oei: boolean) {
  // MTOW 10,700 lb: full fuel 3,296 lb + 445 lb payload.
  const r = makeM2({ state: 'takeoff', fuelLb: 3296, payloadLb: 10700 - EMPTY_PLUS_PILOT_LB - 3296 });
  const v = r.vars;
  r.run(2);
  const p0 = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
  v.set(M2.tla(1), TLA.to);
  v.set(M2.tla(2), TLA.to);
  r.pilot.startTakeoff({ vrKt: 105, courseTrueDeg: FIELD.courseTrue });
  let d35 = NaN;
  let v35 = NaN;
  r.run(60, () => {
    if (oei && v.get('adc1.ias_kt') >= 100) v.set(M2.tla(2), TLA.cutoff); // engine failure at V1 = 100 KIAS (FPG)
    if (Number.isNaN(d35) && v.get(FDM.radioAlt) > 35) {
      d35 = horizDist(p0, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) }) * M_TO_FT;
      v35 = v.get('adc1.ias_kt');
      return true;
    }
  });
  return { r, d35, v35, mass: v.get(FDM.mass) / LB };
}

describe('(b) takeoff at MTOW, flaps 15, sea level ISA', () => {
  it('all engines: rotation at VR, 115 % of the distance to 35 ft within the 3,210 ft BFL (+/-15 %)', () => {
    const { r, d35, v35, mass } = takeoff(false);
    const L = r.pilot.log;
    expect(Math.abs(mass - 10700)).toBeLessThan(30);
    expect(L.rotateIasKt).toBeGreaterThanOrEqual(105);
    expect(L.rotateIasKt).toBeLessThan(107);
    expect(L.liftoffIasKt).toBeGreaterThan(105);
    expect(L.liftoffIasKt).toBeLessThan(125);
    expect(L.maxPitchDeg).toBeLessThan(13); // tail cone contact ~13 deg (EST)
    expect(L.maxGroundDeviationM).toBeLessThan(5);
    const bfl = lookup(TOFL_SL_15C.weightsLb, TOFL_SL_15C.ft, 10700);
    expect(bfl).toBe(3210);
    // Part 25 takeoff distance: max(1.15 x all-engine distance to 35 ft, OEI accelerate-go, accelerate-stop) = BFL.
    expect(1.15 * d35).toBeGreaterThan(0.85 * bfl);
    expect(1.15 * d35).toBeLessThan(1.15 * bfl);
    expect(v35).toBeGreaterThan(111); // above V2 with both engines
  });

  it('engine failure at V1: accelerate-go to 35 ft ~ BFL (+/-15 %) at about V2 (111 KIAS)', () => {
    const { d35, v35 } = takeoff(true);
    expect(d35).toBeGreaterThan(0.85 * 3210);
    expect(d35).toBeLessThan(1.15 * 3210);
    expect(v35).toBeGreaterThan(105);
    expect(v35).toBeLessThan(118);
  });
});

describe('(c) climb and cruise', () => {
  it('climbs from 1,500 ft to FL410 at MTOW on the FPG time / fuel / distance (CLB detent, AFCS FLC 220 KIAS / M0.60)', () => {
    // FPG p.21 "cruise climb" from sea level: FL150 5 min / 138 lb / 19 nm ... FL410 24 min / 437 lb / 113 nm.
    // Schedule 220 KIAS / M0.60 (EST, see systems/avionics.ts fmsOptions); the test starts at 1,500 ft / 200 KIAS,
    // which the FPG counts from sea level (~0.5 min, ~15 lb, ~2 nm), so the bands are asymmetric.
    const r = makeM2({ state: 'cruise', fuelLb: 3236, payloadLb: 445, air: { altFtMsl: 1500, iasKt: 200 } });
    const v = r.vars;
    r.run(3.5); // ADC self test
    v.set(M2.tla(1), TLA.clb);
    v.set(M2.tla(2), TLA.clb);
    v.set(AP.selAltitude, 41000);
    r.sys.afcs.press('AP');
    r.sys.afcs.press('FLC');
    v.set('ap.sel_spd_kt', 220);
    let mach = false;
    const at: Record<number, { min: number; lb: number; nm: number }> = {};
    const fuel0 = v.get('fuel.total_kg');
    let t = 0;
    let nm = 0;
    r.run(2400, () => {
      t += 1 / 60;
      nm += v.get('adc1.tas_kt') / 3600 / 60;
      if (!mach && v.get('adc1.mach') >= 0.6) {
        r.sys.afcs.press('SPD_MACH');
        v.set('ap.sel_mach', 0.6);
        mach = true;
      }
      for (const c of CLIMB_MTOW) if (at[c.altFt] === undefined && v.get(FDM.altMsl) >= c.altFt - 100) at[c.altFt] = { min: t / 60, lb: (fuel0 - v.get('fuel.total_kg')) / LB, nm };
      expect(v.get(AP.engaged)).toBe(1);
      return v.get(FDM.altMsl) > 40950;
    });
    for (const c of CLIMB_MTOW) {
      const m = at[c.altFt];
      expect(m, `FL${c.altFt / 100}`).toBeDefined();
      expect(m.min, `FL${c.altFt / 100} min`).toBeLessThan(c.min * 1.1 + 0.5);
      expect(m.min, `FL${c.altFt / 100} min`).toBeGreaterThan(c.min * 0.85 - 0.5);
      expect(m.lb, `FL${c.altFt / 100} lb`).toBeLessThan(c.lb * 1.1);
      expect(m.lb, `FL${c.altFt / 100} lb`).toBeGreaterThan(c.lb * 0.85 - 15);
      expect(m.nm, `FL${c.altFt / 100} nm`).toBeLessThan(c.nm * 1.12);
      expect(m.nm, `FL${c.altFt / 100} nm`).toBeGreaterThan(c.nm * 0.85 - 2);
    }
    // Cabin on schedule: 8,000 ft cabin at FL410 (S&D15 §9.5).
    r.run(120);
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(7000);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(8600);
    expect(v.get('press.diff_psi')).toBeLessThan(8.8);
  }, 120000);

  for (const altFt of [33000, 41000]) {
    it(`high-speed cruise at FL${altFt / 100}, 9,500 lb: KTAS and fuel flow within 8 % of the FPG`, () => {
      const pub = HIGH_SPEED_CRUISE.find((c) => c.altFt === altFt)!.w9500;
      const H = altFt * 0.3048;
      const cas = casFromTas(pub.ktas * 0.514444, isaPressure(H), isaTemperature(H)) / 0.514444;
      const r = makeM2({ state: 'cruise', fuelLb: 9500 - EMPTY_PLUS_PILOT_LB, air: { altFtMsl: altFt, iasKt: cas } });
      const v = r.vars;
      r.run(3.5);
      v.set(M2.tla(1), TLA.cru);
      v.set(M2.tla(2), TLA.cru);
      v.set(AP.selAltitude, altFt);
      r.sys.afcs.press('AP');
      r.sys.afcs.press('ALT');
      r.run(300);
      let tas = 0;
      let ff = 0;
      let n = 0;
      r.run(60, () => {
        tas += v.get('adc1.tas_kt');
        ff += v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
        n++;
      });
      tas /= n;
      ff /= n;
      expect(Math.abs(v.get('adc1.alt_ft') - altFt)).toBeLessThan(100);
      expect(Math.abs(tas / pub.ktas - 1)).toBeLessThan(0.08);
      expect(Math.abs(ff / pub.pph - 1)).toBeLessThan(0.08);
      expect(v.get('adc1.mach')).toBeLessThan(0.715);
    }, 60000);
  }
});

describe('(c2) Vmo-limited high-speed cruise below FL290 (FPG p.22, 9,500 lb)', () => {
  // Below ~FL290 the FPG high-speed cruise is Vmo-limited (e.g. FL150 323 KTAS = 260 KCAS): the pilot trims the
  // levers to hold the published speed; the fuel flow needed must match the FPG within 8 %.
  for (const [altFt, ktas, pph] of [
    [5000, 279, 1163],
    [15000, 323, 1122],
    [25000, 377, 1122],
  ] as const) {
    it(`FL${altFt / 100}: ${ktas} KTAS at ~${pph} lb/h`, () => {
      const H = altFt * 0.3048;
      const cas = casFromTas(ktas * 0.514444, isaPressure(H), isaTemperature(H)) / 0.514444;
      const r = makeM2({ state: 'cruise', fuelLb: 9500 - EMPTY_PLUS_PILOT_LB, air: { altFtMsl: altFt, iasKt: cas } });
      const v = r.vars;
      r.run(3.5);
      v.set(AP.selAltitude, altFt);
      r.sys.afcs.press('AP');
      r.sys.afcs.press('ALT');
      let integ = 0.6;
      const hand = () => {
        const e = cas - v.get('adc1.ias_kt');
        integ += 0.0002 * e;
        const tla = Math.max(TLA.idle, Math.min(TLA.cru, integ + 0.02 * e));
        v.set(M2.tla(1), tla);
        v.set(M2.tla(2), tla);
      };
      r.run(300, hand);
      let ff = 0;
      let n = 0;
      r.run(60, () => {
        hand();
        ff += v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
        n++;
      });
      expect(Math.abs(v.get('adc1.ias_kt') - cas)).toBeLessThan(3);
      expect(Math.abs(ff / n / pph - 1)).toBeLessThan(0.08);
    }, 60000);
  }
});

describe('(d) stall speeds (FPG p.32, KCAS, zero bank)', () => {
  for (const [flaps, pubs] of [
    [0, STALL_KCAS.flaps0],
    [15, STALL_KCAS.flaps15],
    [35, STALL_KCAS.flaps35],
  ] as const) {
    for (const wLb of [10700, 8500]) {
      it(`flaps ${flaps}, ${wLb} lb within 5 %`, () => {
        const fuel = wLb > 10000 ? 3296 : 1100;
        const r = makeM2({ state: 'cruise', fuelLb: fuel, payloadLb: wLb - EMPTY_PLUS_PILOT_LB - fuel, air: { altFtMsl: 5000, iasKt: 160 } });
        const v = r.vars;
        v.set('surf.flaps_deg', flaps);
        for (const i of [0, 1, 2]) v.set(`gear.pos${i}`, 1);
        expect(Math.abs(v.get(FDM.mass) / LB - wLb)).toBeLessThan(30);
        expect(v.get(FDM.cgPctMac)).toBeGreaterThan(16.5); // TCDS CG envelope
        expect(v.get(FDM.cgPctMac)).toBeLessThan(28.5);
        const fm = r.fdm;
        const stall = fm.aero.effectiveStallAlpha(flaps, 0, 0);
        let vs = NaN;
        for (let kt = 140; kt > 50; kt -= 0.25) {
          const t = fm.computeTrim({ iasKt: kt });
          if (!t.converged || t.alphaDeg > stall - 0.05) {
            vs = kt + 0.25;
            break;
          }
        }
        const pub = lookup(STALL_KCAS.weightsLb, pubs, wLb);
        expect(Math.abs(vs / pub - 1)).toBeLessThan(0.05);
      });
    }
  }

  it('stick shaker fires before the stall in a 1 kt/s deceleration (flaps 35)', () => {
    const r = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 6000, iasKt: 130 } });
    const v = r.vars;
    r.run(3.5);
    v.set(M2.flapHandle, 2);
    r.sys.flaps.setPosition(35);
    for (const i of [1, 2]) v.set(M2.tla(i), 0);
    // Pitch attitude hold with the elevator (a pilot slowly pulling back).
    let shakerKt = NaN;
    let target = v.get(FDM.pitch);
    r.run(90, () => {
      target += 0.02;
      const e = target - v.get('ahrs1.pitch_deg');
      v.set('input.pitch', Math.max(-1, Math.min(1, 0.15 * e - 0.05 * v.get('ahrs1.q_dps'))));
      if (Number.isNaN(shakerKt) && v.get('alert.stick_shaker')) shakerKt = v.get('adc1.ias_kt');
      return v.get('fdm.aoa_norm') >= 1;
    });
    expect(shakerKt).toBeGreaterThan(60);
    expect(v.get('alert.stick_shaker')).toBe(1);
  });
});

describe('(e) overspeed warning', () => {
  it('Vmo 263 KIAS below FL305', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 255 } });
    r.run(1);
    expect(r.vars.get('alert.overspeed')).toBe(0);
    expect(r.vars.get('overspeed.vmo_kt')).toBeCloseTo(263, 0);
    const r2 = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 270 } });
    r2.run(1);
    expect(r2.vars.get('alert.overspeed')).toBe(1);
  });
  it('Mmo 0.71 above FL305', () => {
    const H = 37000 * 0.3048;
    const casAt = (m: number) => casFromTas((m * Math.sqrt(1.4 * 287.053 * isaTemperature(H))), isaPressure(H), isaTemperature(H)) / 0.514444;
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 37000, iasKt: casAt(0.69) } });
    r.run(1);
    expect(r.vars.get('alert.overspeed')).toBe(0);
    expect(r.vars.get('overspeed.vmo_kt')).toBeLessThan(263);
    const r2 = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 37000, iasKt: casAt(0.735) } });
    r2.run(1);
    expect(r2.vars.get('alert.overspeed')).toBe(1);
  });
});
