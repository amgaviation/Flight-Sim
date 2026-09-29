/**
 * Cessna 172S performance against the POH Section 5 charts (172SPHUS Rev 5 / 172SPHAUS-03
 * Figures 5-3 to 5-8; identical airframe and engine in both variants), flown through the
 * shared core with the hand-flying test pilot:
 *  - short-field takeoff at 2550 lb, SL, 15 C, flaps 10: ground roll 960 ft, total over a
 *    50 ft obstacle 1630 ft (Fig 5-5, interpolated) within 15 %;
 *  - maximum rate of climb at 2550 lb, flaps up, full throttle, 74 KIAS (Fig 5-6) within 12 %,
 *    and time / fuel to climb from SL to 6000 ft (Fig 5-7) within 20 % / 30 %;
 *  - cruise at recommended lean (Fig 5-8): KTAS within 5 kt, %BHP within 6 points, GPH within 15 %;
 *  - power-off stall speeds at 2550 lb, most forward CG (Fig 5-3) within 3 KCAS, and the ASI
 *    reading at the stall within 4 KIAS.
 * Long test (AMG_LONG_TESTS=1): ~20 min of simulated flight.
 */
import { describe, expect, it } from 'vitest';
import { ENG, FDM, INPUT } from '../../../src/core/vars';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { CLIMB_STD_2550, CRUISE_STD, KG_PER_GAL, LIMITS, MAX_ROC_2550, PERF_SPEC, STALL_KCAS, TAKEOFF_2550 } from '../../../src/aircraft/c172s-common/data';
import { C172S_FDM } from '../../../src/aircraft/c172s-common/fdm';
import { bestPowerMixture, recommendedLeanMixture } from '../../../src/aircraft/c172s-common/states';
import { isaTemperature } from '../../../src/physics/atmosphere';
import { horizDist } from '../../physics/helpers';
import { make172, HandPilot, LB, GAL_KG } from './helpers';

const M_TO_FT = 3.28084;

/** Bilinear lookup in a POH grid (rows: altitude, columns: temperature). */
function grid(xs: readonly number[], ys: readonly number[], z: readonly (readonly number[])[], x: number, y: number): number {
  const seg = (a: readonly number[], v: number) => {
    let i = 0;
    while (i < a.length - 2 && v > a[i + 1]) i++;
    return { i, f: (v - a[i]) / (a[i + 1] - a[i]) };
  };
  const r = seg(xs, x);
  const c = seg(ys, y);
  const at = (i: number, j: number) => z[i][j];
  const top = at(r.i, c.i) + (at(r.i, c.i + 1) - at(r.i, c.i)) * c.f;
  const bot = at(r.i + 1, c.i) + (at(r.i + 1, c.i + 1) - at(r.i + 1, c.i)) * c.f;
  return top + (bot - top) * r.f;
}

describe('Cessna 172S performance vs POH Section 5 (2550 lb, standard day)', () => {
  it('short-field takeoff, flaps 10, SL 15 C: ground roll and distance over 50 ft (Fig 5-5)', () => {
    const r = make172({ variant: 'steam', state: 'takeoff', grossLb: 2550 });
    const v = r.vars;
    const hp = new HandPilot(r);
    expect(Math.abs(v.get(FDM.mass) / LB - 2550)).toBeLessThan(5);
    // Brakes APPLY, throttle FULL, mixture RICH, then release.
    v.set(INPUT.brakeLeft, 1);
    v.set(INPUT.brakeRight, 1);
    v.set(C172.throttle, 1);
    v.set(C172.mixture, 1);
    r.run(4);
    const staticRpm = v.get(ENG.rpm(1));
    v.set(INPUT.brakeLeft, 0);
    v.set(INPUT.brakeRight, 0);
    const p0 = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
    let roll = NaN;
    let d50 = NaN;
    let liftIas = NaN;
    let v50 = NaN;
    let air = false;
    r.run(60, () => {
      const kias = v.get('adc1.ias_kt');
      if (!air) {
        hp.steer(0);
        hp.bank(0);
        // "Elevator control - SLIGHTLY TAIL LOW": raise the nose as the airplane approaches lift-off.
        if (v.get(FDM.cas) >= 50) hp.pitch(8);
        else v.set(INPUT.pitch, 0);
        if (v.get(FDM.onGround) < 0.5) {
          air = true;
          roll = horizDist(p0, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) }) * M_TO_FT;
          liftIas = kias;
          hp.setYaw(v.get(INPUT.yaw));
        }
      } else {
        // "Climb speed - 56 KIAS (until all obstacles are cleared)": pitch for the speed, firmly.
        hp.pitch(Math.max(4, Math.min(14, 10 + 1.0 * (kias - TAKEOFF_2550.speed50ftKias))));
        hp.bank(0);
        hp.ball();
        if (v.get(FDM.radioAlt) >= 50) {
          d50 = horizDist(p0, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) }) * M_TO_FT;
          v50 = kias;
          return true;
        }
      }
    });
    const pohRoll = grid(TAKEOFF_2550.pressAltFt, TAKEOFF_2550.tempC, TAKEOFF_2550.groundRollFt, 0, 15);
    const poh50 = grid(TAKEOFF_2550.pressAltFt, TAKEOFF_2550.tempC, TAKEOFF_2550.total50ftFt, 0, 15);
    expect(pohRoll).toBeCloseTo(PERF_SPEC.takeoffGroundRollFt, -1);
    console.log(`takeoff: static ${staticRpm.toFixed(0)} rpm, roll ${roll.toFixed(0)} ft (POH ${pohRoll}), lift-off ${liftIas.toFixed(1)} KIAS, 50 ft at ${d50.toFixed(0)} ft (POH ${poh50}) ${v50.toFixed(1)} KIAS`);
    // TCDS 3A12 / POH: full-throttle static rpm 2300-2400.
    expect(staticRpm).toBeGreaterThanOrEqual(LIMITS.staticRpm[0]);
    expect(staticRpm).toBeLessThanOrEqual(LIMITS.staticRpm[1]);
    expect(roll).toBeGreaterThan(0.85 * pohRoll);
    expect(roll).toBeLessThan(1.15 * pohRoll);
    expect(d50).toBeGreaterThan(0.85 * poh50);
    expect(d50).toBeLessThan(1.15 * poh50);
    expect(liftIas).toBeGreaterThan(TAKEOFF_2550.liftoffKias - 6);
    expect(liftIas).toBeLessThan(TAKEOFF_2550.liftoffKias + 6);
  });

  it('maximum rate of climb 74 KIAS and time / fuel to 6000 ft (Figs 5-6, 5-7)', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2550, air: { altFtMsl: 100, iasKt: 75 } });
    const v = r.vars;
    const hp = new HandPilot(r);
    v.set(C172.flapLever, 0);
    v.set(C172.throttle, 1);
    v.set(C172.mixture, 1);
    const fuel0 = v.get('fuel.total_kg');
    let t1000 = NaN;
    let alt1000 = NaN;
    let roc1000 = NaN;
    let tTop = NaN;
    let fuelTop = NaN;
    const t0 = r.t();
    r.run(1100, (t) => {
      const alt = v.get(FDM.pressAlt);
      const kias = alt < 1000 ? 74 : alt < 7000 ? 73 : 72; // POH Fig 5-7 climb speeds
      hp.speed(kias);
      hp.bank(0);
      hp.ball();
      hp.trim();
      // POH Fig 5-7 note: mixture leaned for maximum rpm above 3000 ft.
      const sigma = v.get(FDM.densityKgM3) / 1.225;
      v.set(C172.mixture, alt > 3000 ? bestPowerMixture(sigma) : 1);
      if (Number.isNaN(t1000) && alt >= 700) {
        t1000 = t;
        alt1000 = alt;
      }
      if (Number.isNaN(roc1000) && alt >= 1300) roc1000 = ((alt - alt1000) / (t - t1000)) * 60;
      if (alt >= 6000) {
        tTop = (t - t0) / 60;
        fuelTop = (fuel0 - v.get('fuel.total_kg')) / GAL_KG;
        return true;
      }
    });
    const pohRoc = grid(MAX_ROC_2550.pressAltFt, MAX_ROC_2550.tempC, MAX_ROC_2550.rocFpm, 1000, isaTemperature(1000 * 0.3048) - 273.15);
    // Fig 5-7 from SL (the climb starts at ~100 ft, negligible).
    const pohT = CLIMB_STD_2550.timeMin[6];
    const pohFuel = CLIMB_STD_2550.fuelGal[6];
    console.log(`climb: ${roc1000.toFixed(0)} fpm at 1000 ft (POH ${pohRoc.toFixed(0)}), SL-6000 ${tTop.toFixed(1)} min (POH ${pohT}) ${fuelTop.toFixed(2)} gal (POH ${pohFuel})`);
    expect(roc1000).toBeGreaterThan(0.88 * pohRoc);
    expect(roc1000).toBeLessThan(1.12 * pohRoc);
    expect(tTop).toBeGreaterThan(0.8 * pohT);
    expect(tTop).toBeLessThan(1.2 * pohT);
    expect(fuelTop).toBeGreaterThan(0.7 * pohFuel);
    expect(fuelTop).toBeLessThan(1.3 * pohFuel);
  });

  const cruisePoints = CRUISE_STD.filter(([alt, rpm]) => (alt === 2000 && rpm === 2500) || (alt === 6000 && rpm === 2400) || (alt === 8000 && rpm === 2600) || (alt === 10000 && rpm === 2500));
  for (const [altFt, rpm, pct, ktas, gph] of cruisePoints) {
    it(`cruise ${altFt} ft ${rpm} rpm recommended lean: ${pct} % BHP, ${ktas} KTAS, ${gph} GPH (Fig 5-8)`, () => {
      const sigma0 = Math.pow(1 - 6.8756e-6 * altFt, 4.2559);
      const r = make172({ variant: 'g1000', state: 'cruise', grossLb: 2550, air: { altFtMsl: altFt, iasKt: ktas * Math.sqrt(sigma0) } });
      const v = r.vars;
      const hp = new HandPilot(r);
      let thr = v.get(C172.throttle);
      let n = 0;
      let sT = 0;
      let sP = 0;
      let sF = 0;
      let sR = 0;
      r.run(210, (t) => {
        hp.altitude(altFt);
        hp.bank(0);
        hp.ball();
        hp.trim();
        const sigma = v.get(FDM.densityKgM3) / 1.225;
        v.set(C172.mixture, recommendedLeanMixture(sigma));
        thr = Math.max(0, Math.min(1, thr + 0.00002 * (rpm - v.get(ENG.rpm(1)))));
        v.set(C172.throttle, thr);
        if (t > 180) {
          n++;
          sT += v.get(FDM.tas);
          sP += v.get(ENG.powerHp(1));
          sF += v.get('eng1.ff_pph') * LB / KG_PER_GAL;
          sR += v.get(ENG.rpm(1));
        }
      });
      const kt = sT / n;
      const bhp = (100 * sP) / n / 180; // IO-360-L2A 180 BHP (TCDS E-286 / POH Sec 1)
      const ff = sF / n;
      console.log(`cruise ${altFt}/${rpm}: ${kt.toFixed(1)} KTAS (POH ${ktas}), ${bhp.toFixed(1)} % (POH ${pct}), ${ff.toFixed(2)} GPH (POH ${gph}), rpm ${(sR / n).toFixed(0)}, alt ${v.get(FDM.altMsl).toFixed(0)}`);
      expect(Math.abs(sR / n - rpm)).toBeLessThan(25);
      expect(Math.abs(kt - ktas)).toBeLessThan(5);
      expect(Math.abs(bhp - pct)).toBeLessThan(6);
      expect(ff).toBeGreaterThan(0.85 * gph);
      expect(ff).toBeLessThan(1.15 * gph);
    });
  }

  const stalls: [number, number, number, number][] = [
    // [flap lever, flaps deg, POH KCAS, POH KIAS]  (Fig 5-3, 2550 lb, most forward CG, power off)
    [0, 0, STALL_KCAS.flapsUp, 48],
    [1, 10, STALL_KCAS.flaps10, 43],
    [3, 30, STALL_KCAS.flaps30, 40],
  ];
  for (const [lever, deg, pohKcas, pohKias] of stalls) {
    it(`power-off stall, flaps ${deg}: ${pohKcas} KCAS / ${pohKias} KIAS (Fig 5-3)`, () => {
      const r = make172({ variant: 'steam', state: 'approach', grossLb: 2550, air: { altFtMsl: 5000, iasKt: 70 } });
      const v = r.vars;
      // Most forward CG at 2550 lb: 41.0 in aft of datum (POH Fig 6-8 envelope). Front seats (sta
      // ~37) and rear seat (sta ~73) shared to put the CG there.
      const cgIn = () => 25.9 + (v.get(FDM.cgPctMac) / 100) * 58.8; // LEMAC sta 25.9, MAC 58.8 in (fdm.ts)
      const pay = 2550 * LB - C172S_FDM.mass.emptyMass_kg - v.get('fuel.total_kg');
      let rear = 0;
      for (let i = 0; i < 6; i++) {
        r.fdm.setStationMass(0, (pay - rear) / 2);
        r.fdm.setStationMass(1, (pay - rear) / 2);
        r.fdm.setStationMass(2, rear);
        r.run(0.05);
        rear = Math.max(0, rear + (((41.0 - cgIn()) * 2550) / 36) * LB);
      }
      v.set(C172.flapLever, lever);
      v.set(C172.throttle, 0);
      const hp = new HandPilot(r);
      r.run(15, () => {
        hp.speed(70, FDM.cas);
        hp.bank(0);
      });
      const cg = cgIn();
      let brkCas = NaN;
      let brkIas = NaN;
      const t0 = r.t();
      r.run(60, (t) => {
        hp.speed(Math.max(30, 70 - (t - t0)), FDM.cas); // ~1 kt/s entry (POH Fig 5-3 note)
        hp.bank(0);
        if (v.get(FDM.aoaNorm) >= 1) {
          brkCas = v.get(FDM.cas);
          brkIas = v.get('adc1.ias_kt');
          return true;
        }
      });
      console.log(`stall flaps ${deg}: ${brkCas.toFixed(1)} KCAS (POH ${pohKcas}), ASI ${brkIas.toFixed(1)} (POH ${pohKias}), CG ${cg.toFixed(1)} in, ${(v.get(FDM.mass) / LB).toFixed(0)} lb`);
      expect(Math.abs(v.get(FDM.mass) / LB - 2550)).toBeLessThan(10);
      expect(Math.abs(cg - 41.0)).toBeLessThan(0.5);
      expect(Math.abs(brkCas - pohKcas)).toBeLessThanOrEqual(3);
      expect(Math.abs(brkIas - pohKias)).toBeLessThanOrEqual(4);
    });
  }
});
