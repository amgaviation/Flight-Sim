/**
 * Citation Longitude flight performance against the Textron Flight Planning
 * Guide (FPG-JET-700-1019): takeoff distances, stall speeds, climb, cruise
 * TAS / fuel flow, Vmo/Mmo overspeed warning. Headless FDM + full systems.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD, LB, type Rig } from './helpers';
import { horizDist } from '../../physics/helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { takeoffSpeeds } from '../../../src/aircraft/citation-longitude/performance';
import { CRUISE_POINTS, STALL_KCAS, TOFL_SL_ISA_F2_FT, TAKEOFF_SPEEDS, interpTable, CLIMB_TIME_MIN } from '../../../src/aircraft/citation-longitude/data';
import { CITATION_LONGITUDE_FDM } from '../../../src/aircraft/citation-longitude/fdm';

const SL = { ...FIELD, elevFt: 0 };
const pos = (r: Rig) => ({ lat: r.vars.get('fdm.lat_deg'), lon: r.vars.get('fdm.lon_deg') });

/** Total fuel flow (lb/h). */
const ffTotal = (r: Rig) => r.vars.get('eng1.ff_pph') + r.vars.get('eng2.ff_pph');

describe('Citation Longitude takeoff (FPG p.4-5, SL ISA, flaps 2, dry)', () => {
  for (const w of [39500, 34500]) {
    it(`rotates at VR, lifts off and meets the field length at ${w} lb`, { timeout: 120000 }, () => {
      const r = makeRig('takeoff', { weightLb: w, avionics: false, field: SL });
      const v = r.vars;
      const s = takeoffSpeeds(w, '2');
      const start = pos(r);
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 10 });
      let d35 = NaN;
      r.run(60, () => {
        if (isNaN(d35) && v.get('fdm.alt_agl_ft') > 35 + 7) d35 = horizDist(start, pos(r)) / 0.3048;
        return !isNaN(d35) && v.get('fdm.alt_agl_ft') > 1000;
      });
      const L = r.pilot.log;
      expect(v.get('fdm.crashed')).toBe(0);
      expect(L.rotateIasKt).toBeGreaterThanOrEqual(s.vr - 0.5);
      expect(L.rotateIasKt).toBeLessThan(s.vr + 3);
      expect(L.liftoffIasKt).toBeGreaterThan(s.vr);
      expect(L.liftoffIasKt).toBeLessThan(s.v2 + 8);
      expect(L.maxPitchDeg).toBeLessThan(12.4); // tail-strike attitude ~12.5 deg (fdm.ts)
      // FPG field length = max(accelerate-stop, accelerate-go OEI, 1.15 x all-engine distance to 35 ft).
      // The all-engine 35 ft distance x 1.15 must fit inside the published field length, within the typical
      // 70-95 % share of a balanced field (EST for super-midsize jets).
      const tofl = interpTable(TAKEOFF_SPEEDS.weightsLb, TOFL_SL_ISA_F2_FT, w);
      expect(1.15 * d35).toBeLessThan(tofl * 0.97);
      expect(1.15 * d35).toBeGreaterThan(tofl * 0.7);
    });
  }

  it('accelerate-stop from V1 at MTOW is within 15 % of the published balanced field length', { timeout: 120000 }, () => {
    const w = 39500;
    const r = makeRig('takeoff', { weightLb: w, avionics: false, field: SL });
    const v = r.vars;
    const s = takeoffSpeeds(w, '2');
    const start = pos(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: 250, courseTrueDeg: SL.courseTrue, pitchDeg: 10 });
    let tV1 = -1;
    let maxGs = 0;
    r.run(120, (t) => {
      maxGs = Math.max(maxGs, v.get('surf.ground_spoilers'));
      if (tV1 < 0 && v.get('fdm.ias_kt') >= s.v1) tV1 = t;
      // 14 CFR 25.109: 1 s recognition + 2 s allowance, then idle, max braking; ground spoilers deploy (RTO).
      if (tV1 >= 0 && t - tV1 > 3) {
        v.set(V.tla(1), 0);
        v.set(V.tla(2), 0);
        v.set('input.brake_left', 1);
        v.set('input.brake_right', 1);
      }
      return tV1 >= 0 && t - tV1 > 5 && v.get('fdm.gs_kt') < 0.5;
    });
    const asd = horizDist(start, pos(r)) / 0.3048;
    expect(maxGs).toBeGreaterThan(0.9); // automatic RTO deployment (OG 2-5)
    expect(v.get('surf.ground_spoilers')).toBeLessThan(0.1); // stowed again below 30 kt (OG 15-5)
    expect(asd).toBeGreaterThan(4810 * 0.85);
    expect(asd).toBeLessThan(4810 * 1.15);
  });
});

describe('Citation Longitude stall speeds (FPG p.26, 1-g KCAS, idle)', () => {
  const cases = [
    { w: 33500, flaps: 0, lever: 0, pub: STALL_KCAS.up[7] },
    { w: 33500, flaps: 35, lever: 3, pub: STALL_KCAS.full[7] },
    { w: 27500, flaps: 0, lever: 0, pub: STALL_KCAS.up[4] },
    { w: 27500, flaps: 35, lever: 3, pub: STALL_KCAS.full[4] },
  ];
  for (const c of cases) {
    it(`${c.w} lb flaps ${c.flaps}: ${c.pub} KCAS within 5 %`, { timeout: 120000 }, () => {
      const r = makeRig('approach', { weightLb: c.w, avionics: false, air: { altFtMsl: 8000, iasKt: 160 } });
      const v = r.vars;
      v.set(V.flapLever, c.lever);
      r.sys.flaps.setPosition(c.flaps);
      v.set(V.gearHandle, 1);
      r.sys.gear.setDown(true);
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      // Slow down at ~1 kt/s holding altitude with elevator (AoA sweep), wings level; the stall = minimum CAS
      // before the alpha exceeds the stall AoA (fdm.aoa_norm >= 1) or the aircraft can no longer hold 1 g.
      let minCas = 999;
      let pitchI = 0;
      const alt0 = v.get('fdm.alt_msl_ft');
      r.run(150, () => {
        const cas = v.get('fdm.cas_kt');
        const vs = v.get('fdm.vs_fpm');
        const altErr = v.get('fdm.alt_msl_ft') - alt0;
        pitchI += -altErr * 0.00002 - vs * 0.000004;
        const cmd = Math.max(-1, Math.min(1, pitchI - vs * 0.0004 - altErr * 0.001 - v.get('fdm.q_dps') * 0.05));
        v.set('input.pitch', cmd);
        v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
        if (v.get('fdm.aoa_norm') < 1 && v.get('fdm.nz_g') > 0.95) minCas = Math.min(minCas, cas);
        return v.get('fdm.aoa_norm') >= 1.0 || v.get('input.pitch') >= 0.999;
      });
      expect(Math.abs(minCas - c.pub) / c.pub).toBeLessThan(0.05);
      expect(v.get('alert.stick_shaker')).toBe(1); // shaker before the stall (OG 4-6, BCA)
    });
  }
});

describe('Citation Longitude climb and cruise (FPG p.16, 19)', () => {
  it('climbs to FL410 near the FPG time and cruises at M0.80 with FPG TAS / fuel flow (+/-8 %)', { timeout: 600000 }, () => {
    const w0 = 36000;
    const r = makeRig('takeoff', { weightLb: w0, avionics: false, field: SL });
    const v = r.vars;
    const s = takeoffSpeeds(w0, '2');
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 10 });
    let t0 = 0;
    r.run(90, (t) => {
      t0 = t;
      return v.get('fdm.alt_agl_ft') > 1500;
    });
    r.pilot.stop();
    v.set('input.pitch', 0);
    v.set('input.roll', 0);
    v.set('input.yaw', 0);
    v.set(V.flapLever, 0);
    v.set(V.gearHandle, 0);
    // FPG max-rate climb schedule: 270 KIAS / M0.76; A/T CLIMB (FLC), AP.
    v.set('ap.sel_alt_ft', 41000);
    v.set('ap.sel_spd_kt', 270);
    v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
    r.sys.afcs.engage();
    r.sys.afcs.press('HDG');
    r.sys.afcs.press('FLC');
    r.sys.at.pressEngage();
    v.set('ap.sel_spd_kt', 270); // FLC syncs to the current speed when selected; then the crew dials 270 KIAS
    let tClimb = NaN;
    r.run(1500, (t) => {
      if (v.get('ap.spd_is_mach') === 0 && v.get('adc1.mach') >= 0.76) {
        v.set('ap.sel_mach', 0.76);
        v.set('ap.spd_is_mach', 1);
      }
      if (isNaN(tClimb) && v.get('adc1.alt_ft') > 40900) tClimb = t0 + t;
      return !isNaN(tClimb);
    });
    const climbMin = tClimb / 60;
    const pub = interpTable(CLIMB_TIME_MIN.weightsLb, CLIMB_TIME_MIN.fl410, w0);
    expect(v.get('ap.engaged')).toBe(1);
    expect(Math.abs(climbMin - pub) / pub).toBeLessThan(0.15); // ~15 min vs 14 min published
    // Cruise M0.80 at FL410.
    v.set('ap.sel_mach', 0.8);
    v.set('ap.spd_is_mach', 1);
    r.run(300);
    const wLb = v.get('fdm.mass_kg') / LB;
    const tas = v.get('fdm.tas_kt');
    const ff = ffTotal(r);
    const p = CRUISE_POINTS[0]; // M0.80 FL410 36,000 lb
    // FPG p.19 M0.80 FL410: 1,807 lb/h at 36,000 lb, 1,751 at 34,000 lb.
    const pubFf = interpTable([34000, 36000], [1751, 1807], wLb);
    expect(Math.abs(v.get('fdm.alt_msl_ft') - 41000)).toBeLessThan(150);
    expect(Math.abs(tas - p.ktas) / p.ktas).toBeLessThan(0.08);
    expect(Math.abs(ff - pubFf) / pubFf).toBeLessThan(0.08);
    // Fuel is being burnt from the tanks (FDM does not burn fuel itself).
    expect(v.get('fuel.used_kg')).toBeGreaterThan(500);
  });
});

describe('Citation Longitude Vmo/Mmo overspeed warning (OG 1-3/1-4)', () => {
  it('warns above Vmo 325 KIAS and above Mmo 0.84, and the barber pole follows the schedule', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 300 } });
    const v = r.vars;
    r.sys.afcs.disengage(false);
    r.sys.at.pressDisconnect();
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    let warnIas = NaN;
    r.run(120, () => {
      v.set('input.pitch', Math.max(-0.3, Math.min(0.3, (-v.get('fdm.pitch_deg') - 2) * 0.05)));
      if (isNaN(warnIas) && v.get('alert.overspeed') !== 0) warnIas = v.get('adc1.ias_kt');
      return !isNaN(warnIas);
    });
    expect(warnIas).toBeGreaterThan(324);
    expect(warnIas).toBeLessThan(330);
    expect(v.get('overspeed.vmo_kt')).toBeCloseTo(325, 0);
    // High altitude: Mmo 0.84 governs.
    const r2 = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 37000, iasKt: 260 } });
    const v2 = r2.vars;
    r2.sys.afcs.disengage(false);
    r2.sys.at.pressDisconnect();
    v2.set(V.tla(1), 1);
    v2.set(V.tla(2), 1);
    let warnMach = NaN;
    r2.run(240, () => {
      v2.set('input.pitch', Math.max(-0.3, Math.min(0.3, (-v2.get('fdm.pitch_deg') - 2.5) * 0.05)));
      if (isNaN(warnMach) && v2.get('alert.overspeed') !== 0) warnMach = v2.get('adc1.mach');
      return !isNaN(warnMach);
    });
    expect(warnMach).toBeGreaterThan(0.835);
    expect(warnMach).toBeLessThan(0.85);
    expect(v2.get('overspeed.vmo_kt')).toBeLessThan(325);
  });
});

it('FDM data sanity: fuel capacity and weights (FPG p.3 / AW)', () => {
  const t = CITATION_LONGITUDE_FDM.mass.tanks;
  const usable = (t[0].capacity_kg - t[0].unusable_kg + t[1].capacity_kg - t[1].unusable_kg) / LB;
  expect(usable).toBeCloseTo(14500, -1);
  expect(CITATION_LONGITUDE_FDM.mass.maxTakeoffMass_kg / LB).toBeCloseTo(39500, 0);
});
