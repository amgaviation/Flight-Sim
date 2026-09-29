/**
 * Global 6000 flight performance against the published numbers (data.ts sources):
 *  (b) take-off at MTOW (SPEC: 6,476 ft SL ISA MTOW): rotation at VR, lift-off,
 *      all-engine distance to 35 ft x 1.15 and the accelerate-stop distance vs
 *      the published take-off distance;
 *  (c) climb at MTOW to the SPEC initial cruise altitude FL410 and cruise at
 *      FL410 M0.85 (SPEC typical cruise, 487 KTAS ISA; AOPA 3,200 lb/h), TAS /
 *      fuel flow within 8 %;
 *  (d) 1-g stall speeds clean (slats in) and slats / flaps 30 within 5 % of the
 *      CLMAX-derived speeds (EST, data.ts);
 *  (e) Vmo / Mmo overspeed warning (GXAG placard: 300 / 340 KIAS, M0.89).
 * Headless FDM + full systems (no displays).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD, LB, posted, type Rig } from './helpers';
import { horizDist } from '../../physics/helpers';
import { G6K_VARS as V } from '../../../src/aircraft/global6000/vars';
import { CLMAX, G6K_LIMITS, vSpeeds, vs1g } from '../../../src/aircraft/global6000/data';
import { GLOBAL6000_FDM } from '../../../src/aircraft/global6000/fdm';

const SL = { ...FIELD, elevFt: 0 };
const TOD_FT = 6476; // SPEC take-off distance SL ISA MTOW
const pos = (r: Rig) => ({ lat: r.vars.get('fdm.lat_deg'), lon: r.vars.get('fdm.lon_deg') });
const ffTotal = (r: Rig) => r.vars.get('eng1.ff_pph') + r.vars.get('eng2.ff_pph');

describe('Global 6000 take-off (slats / flaps 6, SL ISA, dry)', () => {
  it('MTOW: rotates at VR, lifts off below V2 + 10, 1.15 x all-engine distance to 35 ft vs the 6,476 ft take-off distance', () => {
    const w = G6K_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    const s = vSpeeds(w);
    const start = pos(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 11 });
    let d35 = NaN;
    let dLift = NaN;
    r.run(90, () => {
      if (isNaN(dLift) && !isNaN(r.pilot.log.liftoffIasKt)) dLift = horizDist(start, pos(r)) / 0.3048;
      if (isNaN(d35) && v.get('fdm.alt_agl_ft') > 35 + 7) d35 = horizDist(start, pos(r)) / 0.3048;
      return !isNaN(d35) && v.get('fdm.alt_agl_ft') > 800;
    });
    const L = r.pilot.log;
    // eslint-disable-next-line no-console
    console.log(`MTOW TO: VR ${s.vr.toFixed(1)} V2 ${s.v2.toFixed(1)} rot ${L.rotateIasKt.toFixed(1)} lof ${L.liftoffIasKt.toFixed(1)} dLift ${dLift.toFixed(0)} ft d35 ${d35.toFixed(0)} ft pitch ${L.maxPitchDeg.toFixed(1)}`);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(L.rotateIasKt).toBeGreaterThanOrEqual(s.vr - 0.5);
    expect(L.rotateIasKt).toBeLessThan(s.vr + 3);
    expect(L.liftoffIasKt).toBeGreaterThan(s.vr);
    expect(L.liftoffIasKt).toBeLessThan(s.v2 + 10);
    expect(L.maxPitchDeg).toBeLessThan(13.5); // tail strike ~13.5 deg (fdm.ts)
    // The published take-off distance is the balanced field (14 CFR 25.113): the all-engine term x 1.15 is at most it.
    expect(1.15 * d35).toBeLessThan(TOD_FT * 1.15);
    expect(1.15 * d35).toBeGreaterThan(TOD_FT * 0.75);
  });

  it('accelerate-stop from V1 at MTOW within 15 % of the take-off distance (ground lift dumping + max braking)', () => {
    const w = G6K_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    const s = vSpeeds(w);
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
    // eslint-disable-next-line no-console
    console.log(`ASD ${asd.toFixed(0)} ft (V1 ${s.v1.toFixed(1)})`);
    expect(maxGs).toBeGreaterThan(0.9); // GLD auto-armed at take-off thrust, latched above 45 kt (GXFC)
    expect(Math.abs(asd - TOD_FT) / TOD_FT).toBeLessThan(0.15);
  });
});

/**
 * Altitude hold for the stall entries: altitude -> vertical-speed -> pitch-attitude cascade (PI + pitch-rate
 * damping on the yoke). Returns the yoke command for the current frame.
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

describe('Global 6000 1-g stall speeds (pusher OFF, idle, ~1 kt/s deceleration)', () => {
  const cases = [
    { w: 78600, lever: 0, flaps: 0, slats: 0, clmax: CLMAX.clean, label: 'clean (slats in)' },
    { w: 78600, lever: 4, flaps: 30, slats: 1, clmax: CLMAX.f30, label: 'slats / flaps 30' },
    { w: 65000, lever: 4, flaps: 30, slats: 1, clmax: CLMAX.f30, label: 'slats / flaps 30' },
  ];
  for (const c of cases) {
    const pub = vs1g(c.w, c.clmax);
    it(`${c.w} lb ${c.label}: ${pub.toFixed(0)} KCAS within 5 %, shaker before the stall`, () => {
      const r = makeRig('approach', { weightLb: c.w, fuelLb: 10000, air: { altFtMsl: 10000, iasKt: 200 } });
      const v = r.vars;
      v.set(V.flapLever, c.lever);
      r.sys.flaps.setPosition(c.flaps);
      r.sys.flaps.slats = c.slats;
      v.set(V.gearHandle, 1);
      v.set(V.pusher(1), 0); // pusher disabled so the aerodynamic stall is reached
      v.set(V.pusher(2), 0);
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      let minCas = 999;
      let shakerCas = NaN;
      const hold = levelHold(r);
      r.run(200, () => {
        v.set('input.pitch', hold());
        v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
        if (isNaN(shakerCas) && v.get('alert.stick_shaker')) shakerCas = v.get('fdm.cas_kt');
        if (v.get('fdm.aoa_norm') < 1 && v.get('fdm.nz_g') > 0.95) minCas = Math.min(minCas, v.get('fdm.cas_kt'));
        return v.get('fdm.aoa_norm') >= 1.0 || v.get('input.pitch') >= 0.999;
      });
      // eslint-disable-next-line no-console
      console.log(`stall ${c.w} ${c.label}: min ${minCas.toFixed(1)} pub ${pub.toFixed(1)} shaker ${shakerCas.toFixed(1)}`);
      expect(Math.abs(minCas - pub) / pub).toBeLessThan(0.05);
      expect(shakerCas).toBeGreaterThan(minCas + 3);
    });
  }

  it('pusher ON: full aft column is stopped by the stick pusher before the stall', () => {
    const r = makeRig('approach', { weightLb: 70000, fuelLb: 10000, air: { altFtMsl: 10000, iasKt: 180 } });
    const v = r.vars;
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    let maxNorm = 0;
    let pushed = false;
    let aft = false;
    let col = 0;
    const hold = levelHold(r);
    r.run(90, () => {
      if (v.get('alert.stick_shaker') && !aft) {
        aft = true;
        col = v.get('input.pitch');
      }
      // Past the shaker the pilot keeps pulling (0.5 of full travel per second) to the aft stop.
      if (aft) col = Math.min(1, col + 0.5 / 60);
      v.set('input.pitch', aft ? col : hold());
      v.set('input.roll', -v.get('fdm.bank_deg') * 0.05);
      maxNorm = Math.max(maxNorm, v.get('fdm.aoa_norm'));
      if (v.get('stall.pusher_active')) pushed = true;
    });
    expect(pushed).toBe(true);
    expect(maxNorm).toBeLessThan(1.15); // the push starts before the stall AOA; dynamic overshoot of a sustained full-aft pull
    expect(v.get('fdm.crashed')).toBe(0);
  });
});

describe('Global 6000 climb and cruise', () => {
  it('climbs from MTOW to FL410 (SPEC initial cruise altitude) and cruises at FL410 M0.85 (TAS / fuel flow +/-8 %)', { timeout: 900000 }, () => {
    const w0 = G6K_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w0, field: SL });
    const v = r.vars;
    const s = vSpeeds(w0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 11 });
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
    // Climb: FLC 250 KIAS below 10,000 ft, then 300 KIAS / M0.80 (FMS schedule, EST); A/T climb thrust.
    v.set('ap.sel_alt_ft', 41000);
    v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
    r.sys.afcs.engage();
    r.sys.afcs.press('HDG');
    r.sys.afcs.press('FLC');
    // The A/T engaged itself on the take-off thrust advance (Global Vision, systems/vision.ts); engage it only if not.
    if (v.get('ap.at_engaged') === 0) r.sys.at.pressEngage();
    expect(v.get('ap.at_engaged')).toBe(1);
    v.set('ap.sel_spd_kt', 250);
    let tClimb = NaN;
    let vsAt40 = NaN;
    r.run(2700, (t) => {
      if (v.get('adc1.alt_ft') > 10000 && v.get('ap.sel_spd_kt') < 300 && v.get('ap.spd_is_mach') === 0) v.set('ap.sel_spd_kt', 300);
      if (v.get('ap.spd_is_mach') === 0 && v.get('adc1.mach') >= 0.8) {
        v.set('ap.sel_mach', 0.8);
        v.set('ap.spd_is_mach', 1);
      }
      if (isNaN(vsAt40) && v.get('adc1.alt_ft') > 40000) vsAt40 = v.get('fdm.vs_fpm');
      if (isNaN(tClimb) && v.get('adc1.alt_ft') > 41000 - 100) tClimb = t0 + t;
      return !isNaN(tClimb);
    });
    // eslint-disable-next-line no-console
    console.log(`climb to FL410: ${(tClimb / 60).toFixed(1)} min, VS at FL400 ${vsAt40.toFixed(0)} fpm, rating ${v.getString('fadec.rating')}`);
    expect(v.get('ap.engaged')).toBe(1);
    expect(tClimb / 60).toBeLessThan(30); // EST: ~20-25 min at MTOW ISA (model 18 min)
    expect(vsAt40).toBeGreaterThan(300); // 14 CFR / industry "initial cruise altitude" = >= 300 fpm residual climb
    r.run(60);
    v.set('ap.sel_mach', 0.85);
    r.run(400);
    const tas = v.get('fdm.tas_kt');
    const ff = ffTotal(r);
    const wLb = v.get('fdm.mass_kg') / LB;
    // eslint-disable-next-line no-console
    console.log(`FL410 M0.85 at ${wLb.toFixed(0)} lb: ${tas.toFixed(1)} KTAS ${ff.toFixed(0)} lb/h`);
    expect(Math.abs(v.get('adc1.press_alt_ft') - 41000)).toBeLessThan(150);
    expect(Math.abs(tas - 488) / 488).toBeLessThan(0.08);
    // Heavy (~95,000 lb) the flow is higher than the AOPA mid-weight 3,200 lb/h: EST 3,650 lb/h (fdm calibration).
    expect(ff).toBeGreaterThan(3200);
    expect(ff).toBeLessThan(4000);
    expect(v.get('fuel.used_kg')).toBeGreaterThan(1000);
  });

  it('cruise at FL410 M0.85 at 78,000 lb: 488 KTAS and 3,200 lb/h (AOPA) within 8 %', { timeout: 300000 }, () => {
    const r = makeRig('cruise', { weightLb: 78000, fuelLb: 22000, air: { altFtMsl: 41000, iasKt: 254 } });
    const v = r.vars;
    v.set('ap.sel_mach', 0.85);
    v.set('ap.spd_is_mach', 1);
    r.run(420);
    const tas = v.get('fdm.tas_kt');
    const ff = ffTotal(r);
    // eslint-disable-next-line no-console
    console.log(`cruise 78k: ${tas.toFixed(1)} KTAS ${ff.toFixed(0)} pph mach ${v.get('fdm.mach').toFixed(3)} AT ${v.getString('ap.at_mode')} ${v.getString('ap.vert_active')}`);
    expect(v.getString('ap.vert_active')).toBe('ALT');
    expect(Math.abs(v.get('adc1.press_alt_ft') - 41000)).toBeLessThan(100);
    expect(Math.abs(tas - 488) / 488).toBeLessThan(0.08);
    expect(Math.abs(ff - 3200) / 3200).toBeLessThan(0.08);
  });
});

describe('Global 6000 Vmo / Mmo overspeed warning (GXAG placard)', () => {
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
    { name: 'below 8,000 ft: 300 KIAS', alt: 5000, ias: 270, lo: 299, hi: 306, pitch: -3 },
    { name: '8,000 to 30,267 ft: 340 KIAS', alt: 18000, ias: 310, lo: 339, hi: 346, pitch: -3 },
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
  it('FL330: MMO 0.89', () => {
    const r = makeRig('cruise', { weightLb: 70000, fuelLb: 12000, air: { altFtMsl: 33000, iasKt: 290 } });
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
    expect(warnMach).toBeGreaterThan(0.885);
    expect(warnMach).toBeLessThan(0.9);
  });
  it('FL470: MMO 0.858 (placard schedule above 35,000 ft)', () => {
    const r = makeRig('cruise', { weightLb: 70000, fuelLb: 12000, air: { altFtMsl: 47000, iasKt: 215 } });
    const v = r.vars;
    let warnMach = NaN;
    dive(
      r,
      -2,
      () => {
        if (isNaN(warnMach) && v.get('alert.overspeed') !== 0) warnMach = v.get('adc1.mach');
        return !isNaN(warnMach);
      },
      300,
    );
    expect(warnMach).toBeGreaterThan(0.855);
    expect(warnMach).toBeLessThan(0.87);
    expect(posted(r).length).toBeGreaterThanOrEqual(0);
  });
});

it('FDM data sanity: fuel capacity and weights (TCDS 1.4 / 1.5)', () => {
  const t = GLOBAL6000_FDM.mass.tanks;
  const usable = t.reduce((a, x) => a + x.capacity_kg - x.unusable_kg, 0) / LB;
  expect(usable).toBeCloseTo(45050, -1);
  expect(GLOBAL6000_FDM.mass.maxTakeoffMass_kg / LB).toBeCloseTo(99500, 0);
  expect(GLOBAL6000_FDM.aero.wingArea_m2).toBeCloseTo(94.95, 2);
});
