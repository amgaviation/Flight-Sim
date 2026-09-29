/**
 * (f) Coupled ILS approach with the GFC 700 from the 'approach' state: AP
 * engaged with the GMC 710 keys, HDG intercept, APR arms LOC / GS (the G3000
 * APR rule switches the AFCS source to the localizer), the aircraft captures
 * and tracks within one dot, and the AP is disconnected at the 200 ft
 * decision altitude (the M2 has no autoland). Thrust is flown by the test
 * "pilot" (no autothrottle on the M2).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AP, FDM, NAV } from '../../../src/core/vars';
import { destinationPoint } from '../../../src/core/geo';
import { magneticDeclination } from '../../../src/core/wmm';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { M2 } from '../../../src/aircraft/citation-m2/vars';
import { VREF, lookup } from '../../../src/aircraft/citation-m2/data';
import { LB, loadNav, makeM2 } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadNav();
}, 90000);

describe('(f) coupled ILS approach (KSFO ILS 28R)', () => {
  it('captures LOC and GS, stays within 1 dot to 200 ft DA, AP disconnect at minimums', () => {
    const rw = db.runway('KSFO', '28R')!;
    const ils = rw.ils!;
    const crs = ils.courseTrue;
    // 13 nm out, 1.5 nm left of the centre line, 3,000 ft MSL (below the glideslope), 30 deg intercept.
    const p0 = destinationPoint(rw.lat, rw.lon, crs + 180, 13);
    const p = destinationPoint(p0.lat, p0.lon, crs - 90, 1.5);
    const r = makeM2({
      state: 'approach',
      nav: db,
      fuelLb: 1200,
      field: { lat: rw.lat, lon: rw.lon, elevFt: rw.elevationFt, courseTrue: crs },
      air: { altFtMsl: 3000, iasKt: 150, headingTrue: crs + 30, lat: p.lat, lon: p.lon },
      beforeState: (ctx) => {
        // The app tunes NAV1 to the approach ILS; the G3000 tunes every receiver for a loaded LOC approach.
        for (const n of [1, 2]) {
          ctx.vars.set(NAV.activeFreq(n), ils.freqMhz);
          ctx.vars.set(NAV.obs(n), Math.round(crs - magneticDeclination(rw.lat, rw.lon, 0, 2026.7)));
        }
      },
    });
    const v = r.vars;
    r.run(4); // ADC self test
    expect(v.get('nav1.received')).toBe(1);
    expect(v.get('nav1.is_loc')).toBe(1);
    v.set(AP.selAltitude, 3000);
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    // GMC 710 keys: AP, HDG, ALT, APR.
    for (const key of ['ap', 'hdg', 'alt', 'apr']) {
      r.events.emit(`g3k.gmc.key_${key}`);
      r.run(0.2);
    }
    expect(v.get(AP.engaged)).toBe(1);
    expect(v.get('ap.yd_engaged')).toBe(1);
    expect(v.getString(AP.lateralArmed)).toContain('LOC');
    expect(v.getString(AP.verticalArmed)).toContain('GS');

    const vref = lookup(VREF.weightsLb, VREF.kt, v.get(FDM.mass) / LB);
    let target = 140;
    let integ = 0;
    let locCapturedAt = NaN;
    let gsCaptured = false;
    let maxLoc = 0;
    let maxGs = 0;
    let t = 0;
    let daReached = false;
    r.run(500, () => {
      t += 1 / 60;
      // Thrust: the pilot's speed control (no autothrottle).
      const ias = v.get('adc1.ias_kt');
      const err = target - ias;
      integ = Math.max(-0.3, Math.min(0.3, integ + (err * 0.002) / 60));
      const tla = Math.max(0, Math.min(0.9, 0.35 + 0.02 * err + integ));
      v.set(M2.tla(1), tla);
      v.set(M2.tla(2), tla);
      const lat = v.getString(AP.lateralActive);
      const vert = v.getString(AP.verticalActive);
      if (Number.isNaN(locCapturedAt) && lat.startsWith('LOC')) locCapturedAt = t;
      if (!gsCaptured && vert === 'GS') {
        gsCaptured = true;
        v.set(M2.flapHandle, 2); // landing flaps at GS capture, VREF + 5 (FPG VREF table)
        target = vref + 5;
      }
      // One dot = half of full scale (2-dot G3000 ILS scales).
      if (!Number.isNaN(locCapturedAt) && t > locCapturedAt + 40) maxLoc = Math.max(maxLoc, Math.abs(v.get(NAV.cdi(1))) * 2);
      const agl = v.get(FDM.altMsl) - rw.elevationFt;
      if (gsCaptured && agl < 2000) maxGs = Math.max(maxGs, Math.abs(v.get(NAV.gsDev(1))) * 2);
      if (gsCaptured && agl < 200) {
        daReached = true;
        return true;
      }
    });
    expect(locCapturedAt).toBeLessThan(200);
    expect(gsCaptured).toBe(true);
    expect(daReached).toBe(true);
    expect(maxLoc).toBeLessThan(1);
    expect(maxGs).toBeLessThan(1);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(34);
    expect(Math.abs(v.get('adc1.ias_kt') - (vref + 5))).toBeLessThan(8);
    // Minimums: AP/TRIM DISC on the yoke (GFC 700 is not an autoland system).
    v.set('input.ap_disc', 1);
    r.run(0.3);
    v.set('input.ap_disc', 0);
    r.run(1);
    expect(v.get(AP.engaged)).toBe(0);
    expect(v.get('ap.disc_warn')).toBe(1);
    expect(v.get('cas.warning_count')).toBe(0);
  }, 120000);
});
