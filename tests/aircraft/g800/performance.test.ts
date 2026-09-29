/**
 * (b) takeoff, (c) climb and cruise, (d) stall speeds, (e) VMO/MMO overspeed.
 * Published anchors and derived estimates in src/aircraft/g800/data.ts
 * (G800_PERF, G800_LIMITS) with their sources.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD, casTexts, LB } from './helpers';
import { horizDist } from '../../physics/helpers';
import { SimVars } from '../../../src/core/SimVars';
import { FUEL, GEAR, SURF } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { G800_FDM } from '../../../src/aircraft/g800/fdm';
import { G800_LIMITS, G800_PERF, takeoffSpeeds } from '../../../src/aircraft/g800/data';
import { G800_VARS as V } from '../../../src/aircraft/g800/vars';
import { FlatWorld } from '../../physics/helpers';

const FT = 0.3048;

function takeoff(weightLb: number, wind?: { dir: number; kt: number }) {
  const r = makeRig('takeoff', { weightLb, wind });
  const v = r.vars;
  const sp = takeoffSpeeds(weightLb);
  r.run(2);
  const start = { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') };
  r.events.emit('input.throttle_full');
  r.pilot.startTakeoff({ vrKt: sp.vr, courseTrueDeg: FIELD.courseTrue, pitchDeg: 12 });
  let d35 = NaN;
  let dLo = NaN;
  let maxAgl = 0;
  r.run(60, () => {
    const here = { lat: v.get('fdm.lat_deg'), lon: v.get('fdm.lon_deg') };
    if (isNaN(dLo) && v.get('fdm.on_ground') === 0) dLo = horizDist(start, here);
    if (isNaN(d35) && v.get('fdm.radio_alt_ft') > 35) d35 = horizDist(start, here);
    maxAgl = Math.max(maxAgl, v.get('fdm.radio_alt_ft'));
  });
  return { r, v, sp, d35, dLo, maxAgl, log: r.pilot.log };
}

describe('G800 takeoff (b)', () => {
  it('MTOW SL ISA: rotates at VR, lifts off and reaches 35 ft within the AEO distance estimate', { timeout: 120000 }, () => {
    const t = takeoff(G800_LIMITS.mtowLb);
    expect(t.log.rotateIasKt).toBeGreaterThanOrEqual(t.sp.vr - 1);
    expect(t.log.rotateIasKt).toBeLessThan(t.sp.vr + 5);
    expect(t.log.liftoffIasKt).toBeGreaterThan(t.sp.vr);
    expect(t.log.liftoffIasKt).toBeLessThan(t.sp.vr + 20);
    // GAC 5,812 ft TOFL -> EST AEO distance to 35 ft 4,530 ft, +/-15 %.
    const d35ft = t.d35 / FT;
    expect(d35ft).toBeGreaterThan(G800_PERF.aeoTakeoffTo35FtFt * 0.85);
    expect(d35ft).toBeLessThan(G800_PERF.aeoTakeoffTo35FtFt * 1.15);
    expect(t.log.maxPitchDeg).toBeLessThan(15); // tail strike ~12.4 deg on the ground; pitch rises after lift-off
    expect(t.log.maxGroundDeviationM).toBeLessThan(5);
    expect(t.maxAgl).toBeGreaterThan(1000);
    expect(t.v.get('gear.up_locked')).toBe(1);
    expect(t.v.get('fdm.crashed')).toBe(0);
    expect(casTexts(t.r, 'warning')).toEqual([]);
  });

  it('typical weight with a 10 kt direct crosswind stays on the centre line', { timeout: 120000 }, () => {
    const t = takeoff(85000, { dir: (FIELD.courseTrue + 90) % 360, kt: 10 });
    expect(t.log.maxGroundDeviationM).toBeLessThan(5);
    expect(t.maxAgl).toBeGreaterThan(1000);
    expect(t.v.get('fdm.crashed')).toBe(0);
  });
});

describe('G800 climb and cruise (c)', () => {
  it('climbs to FL410 with FLCH + A/T, then cruises at M0.85 with TAS and fuel flow near the range-derived figures', { timeout: 300000 }, () => {
    const w = 100000;
    const r = makeRig('cruise', { weightLb: w, air: { altFtMsl: 5000, iasKt: 250 } });
    const v = r.vars;
    // Crew: selected altitude FL410, FLCH at 280 KIAS, A/T on (THR climb).
    v.set('ap.sel_alt_ft', 41000);
    v.set('ap.sel_spd_kt', 280);
    v.set('ap.spd_is_mach', 0);
    r.events.emit('ap.flc');
    r.run(1);
    expect(v.getString('ap.vert_active')).toBe('FLCH');
    let machSet = false;
    const tClimb = r.run(3600, () => {
      if (!machSet && v.get('adc1.press_alt_ft') > 30000) {
        v.set('ap.sel_mach', 0.8);
        v.set('ap.spd_is_mach', 1);
        machSet = true;
      }
      return v.get('adc1.press_alt_ft') > 40950;
    });
    expect(tClimb).toBeLessThan(35 * 60); // EST: GAC "direct climb to 41,000 ft"; ~25 min at 100,000 lb
    expect(v.get('fdm.crashed')).toBe(0);
    // Cruise M0.85 (GAC long-range cruise), ALT hold, A/T MACH.
    v.set('ap.sel_mach', G800_PERF.lrcMach);
    r.run(300);
    expect(v.getString('ap.vert_active')).toBe('ALT');
    expect(Math.abs(v.get('adc1.press_alt_ft') - 41000)).toBeLessThan(150);
    const m = v.get('fdm.mass_kg') / LB;
    let ff = 0;
    let tas = 0;
    const n = 3600;
    r.run(60, () => {
      ff += (v.get('eng1.ff_pph') + v.get('eng2.ff_pph')) / n;
      tas += v.get('fdm.tas_kt') / n;
    });
    // M0.85 ISA FL410 = 488 KTAS; fuel flow within 8 % of the Breguet-derived LRC figure (EST, data.ts).
    expect(Math.abs(tas - 488) / 488).toBeLessThan(0.02);
    const target = m * G800_PERF.lrcFfPerLbHr;
    expect(Math.abs(ff - target) / target).toBeLessThan(0.08);
    // Pressurization on schedule (GAC 2,840 ft at FL410; PRESS_G800 2,916 ft).
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(2500);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(3300);
    expect(casTexts(r, 'warning')).toEqual([]);
  });

  it('high-speed cruise M0.90 fuel flow within 8 % of the range-derived figure', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 270 } });
    const v = r.vars;
    v.set('ap.sel_mach', G800_PERF.hscMach);
    v.set('ap.spd_is_mach', 1);
    r.run(240);
    const m = v.get('fdm.mass_kg') / LB;
    let ff = 0;
    r.run(60, () => {
      ff += (v.get('eng1.ff_pph') + v.get('eng2.ff_pph')) / 3600;
    });
    expect(Math.abs(v.get('fdm.mach') - 0.9)).toBeLessThan(0.01);
    const target = m * G800_PERF.hscFfPerLbHr;
    expect(Math.abs(ff - target) / target).toBeLessThan(0.08);
  });
});

describe('G800 stall speeds (d)', () => {
  /** 1-g stall speed (KCAS) from the trim solution: lowest IAS whose trimmed AoA stays below the stall AoA. */
  function vs1g(weightLb: number, flapsDeg: number, gearDown: boolean): number {
    const vars = new SimVars();
    const zfwKg = G800_FDM.mass.emptyMass_kg + 400 * LB;
    const fuelKg = Math.min(22000, weightLb * LB - zfwKg);
    G800_FDM.mass.tanks.forEach((_, i) => vars.set(FUEL.tankKg(i), fuelKg / 2));
    vars.set(SURF.flapsDeg, flapsDeg);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), gearDown ? 1 : 0);
    const fdm = new FlightModel(G800_FDM, vars, new FlatWorld(0), { seed: 1, magneticYear: 2026.7 });
    let payload = Math.max(0, weightLb * LB - zfwKg - fuelKg);
    for (const st of [3, 4, 2, 5, 6]) {
      const m = Math.min(G800_FDM.mass.stations[st].maxMass_kg, payload);
      fdm.setStationMass(st, m);
      payload -= m;
    }
    const aStall = G800_FDM.aero.alphaStall_deg.y[G800_FDM.aero.alphaStall_deg.x.indexOf(flapsDeg)];
    for (let ias = 200; ias > 80; ias -= 0.5) {
      fdm.reposition({ lat: 40, lon: -100, altFtMsl: 5000, headingTrue: 0, iasKt: ias });
      const t = fdm.computeTrim({ iasKt: ias });
      if (!t.converged || t.alphaDeg > aStall) return ias + 0.5;
    }
    return NaN;
  }
  it('clean and landing-configuration 1-g stall speeds within 5 % of the design values', () => {
    const cases: [number, number, boolean, number][] = [
      [G800_LIMITS.mlwLb, 0, false, G800_PERF.vs1gMlwClean],
      [G800_LIMITS.mlwLb, 39, true, G800_PERF.vs1gMlwF39],
      [G800_LIMITS.mtowLb, 20, false, G800_PERF.vs1gMtowF20],
    ];
    for (const [w, f, g, ref] of cases) {
      const vs = vs1g(w, f, g);
      expect(Math.abs(vs - ref) / ref).toBeLessThan(0.05);
    }
    // Vref (1.23 Vs1g) at MLW stays above VMCL (FSB 106 KCAS).
    expect(1.23 * vs1g(G800_LIMITS.mlwLb, 39, true)).toBeGreaterThan(G800_LIMITS.vmclKt);
  });

  it('NORMAL law: full aft stick at idle triggers the shaker and AOA limiting, not a stall', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 83500, air: { altFtMsl: 10000, iasKt: 200 } });
    const v = r.vars;
    r.sys.afcs.disengage(false);
    r.sys.at.disengage(false);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    let shaker = false;
    let aoaLim = false;
    let minIas = 999;
    let maxNorm = 0;
    r.run(90, () => {
      v.set('input.pitch', 1);
      shaker = shaker || v.get('alert.stick_shaker') !== 0;
      aoaLim = aoaLim || v.get('fbw.aoa_limit') !== 0;
      minIas = Math.min(minIas, v.get('fdm.ias_kt'));
      maxNorm = Math.max(maxNorm, v.get('fdm.aoa_norm'));
    });
    v.set('input.pitch', 0);
    expect(shaker).toBe(true);
    expect(aoaLim).toBe(true);
    expect(maxNorm).toBeLessThan(0.97); // AoA held below the stall AoA (limit 0.9 alpha_stall, EST)
    // Below the 1-g stall speed the protection trades load factor (nz < 1, mushing descent) instead of stalling.
    expect(minIas).toBeGreaterThan(G800_PERF.vs1gMlwClean * 0.65);
    expect(v.get('fdm.crashed')).toBe(0);
  });
});

describe('G800 overspeed (e)', () => {
  it('VMO: overspeed warning above 340 KCAS, FBW high-speed protection pitches up', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 20000, iasKt: 330 } });
    const v = r.vars;
    r.sys.afcs.disengage(false);
    r.sys.at.disengage(false);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    let warnAt = NaN;
    let hs = false;
    let maxIas = 0;
    r.run(120, () => {
      v.set('input.pitch', -0.15);
      const ias = v.get('adc1.ias_kt');
      maxIas = Math.max(maxIas, ias);
      if (isNaN(warnAt) && v.get('alert.overspeed') !== 0) warnAt = ias;
      hs = hs || v.get('fbw.hs_protect') !== 0;
    });
    v.set('input.pitch', 0);
    expect(warnAt).toBeGreaterThan(G800_LIMITS.vmoKt - 1);
    expect(warnAt).toBeLessThan(G800_LIMITS.vmoKt + 4);
    expect(casTexts(r, 'warning')).toContain('Overspeed');
    expect(hs).toBe(true);
    expect(maxIas).toBeLessThan(G800_LIMITS.vmoKt * 1.25); // structural limit in the FDM
    expect(v.get('fdm.crashed')).toBe(0);
  });

  it('MMO: overspeed warning above M0.935 at FL450', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 45000, iasKt: 250 } });
    const v = r.vars;
    r.sys.afcs.disengage(false);
    r.sys.at.disengage(false);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    let warnMach = NaN;
    r.run(180, () => {
      v.set('input.pitch', -0.12);
      if (isNaN(warnMach) && v.get('alert.overspeed') !== 0) warnMach = v.get('adc1.mach');
      return !isNaN(warnMach);
    });
    v.set('input.pitch', 0);
    expect(warnMach).toBeGreaterThan(G800_LIMITS.mmo - 0.003);
    expect(warnMach).toBeLessThan(G800_LIMITS.mmo + 0.01);
  });
});
