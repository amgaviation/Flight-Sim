/**
 * G650 flight performance against the published numbers (data.ts sources):
 *  (b) takeoff: rotation / lift-off speeds and the MTOW balanced field length
 *      5,858 ft (GAC); AIN 67,084 lb VR 107 / V2 124;
 *  (c) climb to FL430 in ~15 min (AIN) and cruise at FL450 ISA-7 M0.91 with
 *      TAS / fuel flow within 8 % of the AIN pilot report;
 *  (d) 1-g stall speeds clean and flaps 39 within 5 % of the CLMAX-derived
 *      speeds (VSR f20 = V2 / 1.13, VSR f39 = VREF / 1.23; EST, data.ts);
 *  (e) Vmo / Mmo overspeed warning (LIM: 300 / 340 KCAS, M0.925).
 * Headless FDM + full systems (no displays).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD, LB, posted, type Rig } from './helpers';
import { horizDist } from '../../physics/helpers';
import { G650_VARS as V } from '../../../src/aircraft/g650/vars';
import { CLMAX, CLIMB_POINT, CRUISE_POINT, G650_LIMITS, TOFL_MTOW_SL_ISA_FT, takeoffSpeeds, vsKcas } from '../../../src/aircraft/g650/data';
import { G650_FDM } from '../../../src/aircraft/g650/fdm';

const SL = { ...FIELD, elevFt: 0 };
const pos = (r: Rig) => ({ lat: r.vars.get('fdm.lat_deg'), lon: r.vars.get('fdm.lon_deg') });
const ffTotal = (r: Rig) => r.vars.get('eng1.ff_pph') + r.vars.get('eng2.ff_pph');

describe('G650 takeoff (flaps 20, SL ISA, dry)', () => {
  it('MTOW: rotates at VR, lifts off before V2 + 8, 1.15 x all-engine distance to 35 ft inside the 5,858 ft BFL', () => {
    const w = G650_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    const s = takeoffSpeeds(w);
    const start = pos(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 11 });
    let d35 = NaN;
    r.run(80, () => {
      if (isNaN(d35) && v.get('fdm.alt_agl_ft') > 35 + 8) d35 = horizDist(start, pos(r)) / 0.3048;
      return !isNaN(d35) && v.get('fdm.alt_agl_ft') > 800;
    });
    const L = r.pilot.log;
    expect(v.get('fdm.crashed')).toBe(0);
    expect(L.rotateIasKt).toBeGreaterThanOrEqual(s.vr - 0.5);
    expect(L.rotateIasKt).toBeLessThan(s.vr + 3);
    expect(L.liftoffIasKt).toBeGreaterThan(s.vr);
    expect(L.liftoffIasKt).toBeLessThan(s.v2 + 8);
    expect(L.maxPitchDeg).toBeLessThan(13); // tail strike ~13 deg on the main wheels (fdm.ts)
    // The balanced field length is the largest of accelerate-stop, one-engine-inoperative go and 1.15 x the
    // all-engine distance to 35 ft (14 CFR 25.113). With T/W 0.34 the all-engine term is not the limiting one:
    // EST 75-100 % of the BFL (the accelerate-stop test below checks the BFL itself within +/-15 %).
    expect(1.15 * d35).toBeLessThan(TOFL_MTOW_SL_ISA_FT);
    expect(1.15 * d35).toBeGreaterThan(0.75 * TOFL_MTOW_SL_ISA_FT);
    expect(v.get('ap.at_engaged')).toBe(0);
  });

  it('67,084 lb (AIN): VR 107 / V2 124 flown without tail strike, climbing at V2 + 10', () => {
    const w = CLIMB_POINT.weightLb;
    const s = takeoffSpeeds(w);
    expect(s.vr).toBeCloseTo(107, -0.5); // AIN VR 107
    expect(Math.abs(s.v2 - 124)).toBeLessThanOrEqual(2); // AIN V2 124
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 12 });
    r.run(60, () => v.get('fdm.alt_agl_ft') > 1500);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(r.pilot.log.liftoffIasKt).toBeLessThan(s.v2 + 5);
    expect(v.get('gear.up_locked')).toBe(1);
  });

  it('accelerate-stop from V1 at MTOW within 15 % of the balanced field length (ground spoilers + max braking)', () => {
    const w = G650_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    const s = takeoffSpeeds(w);
    const start = pos(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: 300, courseTrueDeg: SL.courseTrue, pitchDeg: 10 });
    let tV1 = -1;
    let maxGs = 0;
    r.run(120, (t) => {
      maxGs = Math.max(maxGs, v.get('surf.ground_spoilers'));
      if (tV1 < 0 && v.get('fdm.ias_kt') >= s.v1) tV1 = t;
      // 14 CFR 25.109: 1 s recognition + 2 s allowance, then idle and maximum braking (no reverse credit).
      if (tV1 >= 0 && t - tV1 > 3) {
        v.set(V.tla(1), 0);
        v.set(V.tla(2), 0);
        v.set('input.brake_left', 1);
        v.set('input.brake_right', 1);
      }
      return tV1 >= 0 && t - tV1 > 5 && v.get('fdm.gs_kt') < 0.5;
    });
    const asd = horizDist(start, pos(r)) / 0.3048;
    expect(maxGs).toBeGreaterThan(0.9); // GND SPOILER ARMED: levers idle, wheel speed > 47 kt (LUC)
    expect(Math.abs(asd - TOFL_MTOW_SL_ISA_FT) / TOFL_MTOW_SL_ISA_FT).toBeLessThan(0.15);
  });
});

/**
 * Altitude hold for the stall entries: altitude -> vertical-speed -> pitch-attitude cascade (PI + pitch-rate
 * damping on the yoke, ScriptedPilot attitude gains). Returns the yoke command for the current frame.
 */
function levelHold(r: Rig): () => number {
  const v = r.vars;
  const alt0 = v.get('fdm.alt_msl_ft');
  let thT = v.get('fdm.pitch_deg');
  let pI = 0;
  return () => {
    const vs = v.get('fdm.vs_fpm');
    const vsCmd = Math.max(-400, Math.min(400, -(v.get('fdm.alt_msl_ft') - alt0) * 3));
    thT += Math.max(-1, Math.min(1, (vsCmd - vs) * 0.004)) / 60;
    const e = thT - v.get('fdm.pitch_deg');
    pI = Math.max(-0.8, Math.min(0.8, pI + (0.3 * e) / 60));
    return Math.max(-1, Math.min(1, 0.25 * e + pI - 0.14 * v.get('fdm.q_dps')));
  };
}

describe('G650 1-g stall speeds (DIRECT law, idle, ~1 kt/s deceleration)', () => {
  const cases = [
    { w: 70000, flaps: 0, lever: 0, clmax: CLMAX.f0 },
    { w: 70000, flaps: 39, lever: 3, clmax: CLMAX.f39 },
    { w: 83500, flaps: 39, lever: 3, clmax: CLMAX.f39 },
  ];
  for (const c of cases) {
    const pub = vsKcas(c.w, c.clmax);
    it(`${c.w} lb flaps ${c.flaps}: ${pub.toFixed(0)} KCAS within 5 %`, () => {
      const r = makeRig('approach', { weightLb: c.w, fuelLb: 8000, air: { altFtMsl: 10000, iasKt: 180 } });
      const v = r.vars;
      v.set(V.flapLever, c.lever);
      r.sys.flaps.setPosition(c.flaps);
      r.sys.failures.trigger('fbw.fcc'); // FCCs failed: DIRECT law (no AOA limiter), elevator follows the yoke
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      let minCas = 999;
      const hold = levelHold(r);
      r.run(180, () => {
        v.set('input.pitch', hold());
        v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
        if (v.get('fdm.aoa_norm') < 1 && v.get('fdm.nz_g') > 0.95) minCas = Math.min(minCas, v.get('fdm.cas_kt'));
        return v.get('fdm.aoa_norm') >= 1.0 || v.get('input.pitch') >= 0.999;
      });
      expect(Math.abs(minCas - pub) / pub).toBeLessThan(0.05);
      expect(v.get('alert.stick_shaker')).toBe(1); // shaker at 0.94 normalized AOA (LUC)
    });
  }

  it('NORMAL law: decelerating level, then full aft yoke: the AOA limiter keeps the aircraft out of the stall', () => {
    const r = makeRig('approach', { weightLb: 70000, fuelLb: 8000, air: { altFtMsl: 10000, iasKt: 180 } });
    const v = r.vars;
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    let maxNorm = 0;
    let limiting = false;
    let full = false;
    let casAtLimit = NaN;
    const hold = levelHold(r);
    r.run(90, () => {
      if (v.get('fbw.aoa_limit') || v.get('alert.stick_shaker')) full = true;
      v.set('input.pitch', full ? 1 : hold());
      v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
      maxNorm = Math.max(maxNorm, v.get('stall.aoa_norm'));
      if (v.get('fbw.aoa_limit') && !limiting) casAtLimit = v.get('fdm.cas_kt');
      if (v.get('fbw.aoa_limit')) limiting = true;
    });
    // Flaps 20, 70,000 lb: the limiter engages above the 1-g stall speed.
    expect(casAtLimit).toBeGreaterThan(vsKcas(70000, CLMAX.f20));
    expect(limiting).toBe(true);
    expect(maxNorm).toBeLessThan(1.0);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(posted(r)).toContain('advisory:AOA Limiting');
  });
});

describe('G650 climb and cruise (AIN pilot report)', () => {
  it('climbs to FL430 in ~15 min at 67,084 lb and cruises at FL450 ISA-7 M0.91 (TAS / fuel flow +/-8 %)', { timeout: 600000 }, () => {
    const w0 = CLIMB_POINT.weightLb;
    const r = makeRig('takeoff', { weightLb: w0, field: SL, seaLevelTempC: 15 + CRUISE_POINT.isaDevC });
    const v = r.vars;
    const s = takeoffSpeeds(w0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 12 });
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
    v.set(V.autobrake, 0);
    // Climb: FLCH 250 KIAS below 10,000 ft, then 300 KIAS / M0.85 (EST G650 climb schedule); A/T THR.
    v.set('ap.sel_alt_ft', CLIMB_POINT.altFt);
    v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
    r.sys.afcs.engage();
    r.sys.afcs.press('HDG');
    r.sys.afcs.press('FLC');
    r.sys.at.pressEngage();
    v.set('ap.sel_spd_kt', 250);
    let tClimb = NaN;
    r.run(1500, (t) => {
      if (v.get('adc1.alt_ft') > 10000 && v.get('ap.sel_spd_kt') < 300 && v.get('ap.spd_is_mach') === 0) v.set('ap.sel_spd_kt', 300);
      if (v.get('ap.spd_is_mach') === 0 && v.get('adc1.mach') >= 0.85) {
        v.set('ap.sel_mach', 0.85);
        v.set('ap.spd_is_mach', 1);
      }
      if (isNaN(tClimb) && v.get('adc1.alt_ft') > CLIMB_POINT.altFt - 100) tClimb = t0 + t;
      return !isNaN(tClimb);
    });
    const climbMin = tClimb / 60;
    expect(v.get('ap.engaged')).toBe(1);
    expect(Math.abs(climbMin - CLIMB_POINT.minutes) / CLIMB_POINT.minutes).toBeLessThan(0.2);
    // Step to FL450 and cruise at M0.91.
    r.run(60);
    v.set('ap.sel_alt_ft', CRUISE_POINT.altFt);
    r.sys.afcs.press('FLC');
    v.set('ap.sel_mach', 0.85);
    r.run(400, () => v.get('adc1.alt_ft') > CRUISE_POINT.altFt - 30 && v.getString('ap.vert_active') === 'ALT');
    v.set('ap.sel_mach', CRUISE_POINT.mach);
    v.set('ap.spd_is_mach', 1);
    r.run(300);
    const wLb = v.get('fdm.mass_kg') / LB;
    const tas = v.get('fdm.tas_kt');
    const ff = ffTotal(r);
    const pubTas = 513; // M0.91 at FL450 ISA-7 (a = 290.2 m/s)
    const pubFf = 2 * CRUISE_POINT.pphPerEngine;
    expect(Math.abs(v.get('adc1.press_alt_ft') - CRUISE_POINT.altFt)).toBeLessThan(150); // pressure altitude (ISA-7: true altitude ~1,400 ft lower)
    expect(Math.abs(wLb - CRUISE_POINT.weightLb)).toBeLessThan(2500);
    expect(Math.abs(tas - pubTas) / pubTas).toBeLessThan(0.08);
    expect(Math.abs(ff - pubFf) / pubFf).toBeLessThan(0.08);
    expect(v.get('fuel.used_kg')).toBeGreaterThan(500); // the fuel system burns the tanks
  });
});

describe('G650 Vmo / Mmo overspeed warning (LIM)', () => {
  const dive = (r: Rig, pitch: number, stop: () => boolean, s = 180) => {
    const v = r.vars;
    r.sys.afcs.disengage(false);
    r.sys.at.pressDisconnect();
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(s, () => {
      v.set('input.pitch', Math.max(-0.3, Math.min(0.3, (pitch - v.get('fdm.pitch_deg')) * 0.05)));
      v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
      return stop();
    });
  };
  for (const c of [
    { name: 'below 8,000 ft: 300 KCAS', alt: 5000, ias: 270, lo: 299, hi: 306, pitch: -3 },
    { name: 'above 8,000 ft: 340 KCAS', alt: 18000, ias: 310, lo: 339, hi: 346, pitch: -3 },
  ]) {
    it(c.name, () => {
      const r = makeRig('cruise', { weightLb: 70000, fuelLb: 12000, air: { altFtMsl: c.alt, iasKt: c.ias } });
      const v = r.vars;
      let warnIas = NaN;
      dive(r, c.pitch, () => {
        if (isNaN(warnIas) && v.get('alert.overspeed') !== 0) warnIas = v.get('adc1.ias_kt');
        return !isNaN(warnIas);
      });
      expect(warnIas).toBeGreaterThan(c.lo);
      expect(warnIas).toBeLessThan(c.hi);
    });
  }
  it('above FL350: Mmo 0.925', () => {
    const r = makeRig('cruise', { weightLb: 70000, fuelLb: 12000, air: { altFtMsl: 41000, iasKt: 265 } });
    const v = r.vars;
    let warnMach = NaN;
    dive(
      r,
      -2.5,
      () => {
        if (isNaN(warnMach) && v.get('alert.overspeed') !== 0) warnMach = v.get('adc1.mach');
        return !isNaN(warnMach);
      },
      300,
    );
    expect(warnMach).toBeGreaterThan(0.92);
    expect(warnMach).toBeLessThan(0.94);
    expect(v.get('overspeed.vmo_kt')).toBeLessThan(340);
  });
});

it('FDM data sanity: fuel capacity and weights (TCDS §9 / §13)', () => {
  const t = G650_FDM.mass.tanks;
  const usable = (t[0].capacity_kg - t[0].unusable_kg + t[1].capacity_kg - t[1].unusable_kg) / LB;
  expect(usable).toBeCloseTo(44200, -1);
  expect(G650_FDM.mass.maxTakeoffMass_kg / LB).toBeCloseTo(99600, 0);
  expect(G650_FDM.aero.mac_m).toBeCloseTo(4.756, 3);
});
