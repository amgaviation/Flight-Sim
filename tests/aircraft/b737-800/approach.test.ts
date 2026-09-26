/**
 * (f) Coupled ILS approach and autoland (KSFO ILS 28R) from the 'approach'
 * state: CMD A engaged by the state preset (HDG SEL / ALT HOLD, A/T MCP SPD),
 * HDG intercept, APP arms VOR/LOC and G/S, CMD B arms the second channel;
 * LOC and G/S capture, landing flaps 30 and VREF30 + 5 on the MCP, dual
 * channel below 1,500 ft RA (LAND 3), FLARE at 50 ft, A/T RETARD, touchdown
 * with ROLLOUT on the localizer (fail-operational option), autobrake 2
 * deceleration, A/P disconnect on the ground. Deviation stays within 1 dot
 * (737 ILS scales: 2 dots full scale).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AP, FDM, NAV } from '../../../src/core/vars';
import { destinationPoint } from '../../../src/core/geo';
import { magneticDeclination } from '../../../src/core/wmm';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { B738, SPEEDBRAKE } from '../../../src/aircraft/b737-800/vars';
import { FLAP_LEVER } from '../../../src/aircraft/b737-800/data';
import { vref } from '../../../src/avionics/boeing-737/data/perf';
import { loadNav, makeB738 } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadNav();
}, 120000);

describe('(f) coupled ILS approach and autoland', () => {
  it('captures LOC / G/S, tracks within 1 dot, LAND 3, flare, touchdown, rollout, stops', () => {
    const rw = db.runway('KSFO', '28R')!;
    const ils = rw.ils!;
    const crs = ils.courseTrue;
    // 14 nm out, 1.5 nm left of the centre line, 3,000 ft MSL (below the glideslope), 30 deg intercept.
    const p0 = destinationPoint(rw.lat, rw.lon, crs + 180, 14);
    const p = destinationPoint(p0.lat, p0.lon, crs - 90, 1.5);
    const r = makeB738({
      state: 'approach',
      nav: db,
      grossKg: 60000,
      fuelKg: [2500, 2500, 0],
      field: { lat: rw.lat, lon: rw.lon, elevFt: rw.elevationFt, courseTrue: crs },
      air: { altFtMsl: 3000, iasKt: 170, headingTrue: crs + 30, lat: p.lat, lon: p.lon },
      beforeState: (ctx) => {
        for (const n of [1, 2]) {
          ctx.vars.set(NAV.activeFreq(n), ils.freqMhz);
          ctx.vars.set(NAV.obs(n), Math.round(crs - magneticDeclination(rw.lat, rw.lon, 0, 2026.7)));
        }
      },
    });
    const v = r.vars;
    r.run(6);
    expect(v.get(AP.engaged)).toBe(1);
    expect(v.get('nav1.is_loc')).toBe(1);
    expect(v.get('nav2.is_loc')).toBe(1);
    const vr = vref(v.get(FDM.mass), 30);
    v.set(AP.selAltitude, 3000);
    v.set(AP.selSpeed, 170);
    v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)));
    r.events.emit('ac.mcp.app');
    r.run(0.5);
    r.events.emit('ac.mcp.cmd_b');
    r.run(0.5);
    expect(v.getString(AP.lateralArmed)).toContain('VOR/LOC');
    expect(v.getString(AP.verticalArmed)).toContain('G/S');

    let t = 0;
    let locT = NaN;
    let gsCap = false;
    let maxLoc = 0;
    let maxGs = 0;
    let land3 = false;
    let flare = false;
    let retard = false;
    let tdVs = NaN;
    let tdDist = NaN;
    let rollout = false;
    const thr = { lat: rw.lat, lon: rw.lon };
    r.run(900, () => {
      t += 1 / 60;
      const lat = v.getString(AP.lateralActive);
      const vert = v.getString(AP.verticalActive);
      if (Number.isNaN(locT) && lat === 'VOR/LOC') locT = t;
      if (!gsCap && vert === 'G/S') {
        gsCap = true;
        // Landing configuration at G/S capture: flaps 30, VREF30 + 5 (FCOM NP.21 "Landing procedure - ILS").
        v.set(B738.flapLever, FLAP_LEVER.f30);
        v.set(AP.selSpeed, Math.round(vr + 5));
      }
      const ra = v.get('ra1.alt_ft');
      if (!Number.isNaN(locT) && t > locT + 60 && v.get('gear.air_ground') === 0) maxLoc = Math.max(maxLoc, Math.abs(v.get(NAV.cdi(1))) * 2);
      if (gsCap && ra < 1500 && ra > 100) maxGs = Math.max(maxGs, Math.abs(v.get(NAV.gsDev(1))) * 2);
      if (v.getString('ap.autoland') === 'LAND 3') land3 = true;
      if (v.getString(AP.verticalActive) === 'FLARE') flare = true;
      if (v.getString(AP.athrMode) === 'RETARD') retard = true;
      if (lat === 'ROLLOUT' || v.getString('ac.fma.roll') === 'ROLLOUT') rollout = true;
      if (Number.isNaN(tdVs) && v.get('gear.air_ground') === 1) {
        tdVs = v.get(FDM.vs);
        const dN = (v.get(FDM.lat) - thr.lat) * 60 * 1852;
        const dE = (v.get(FDM.lon) - thr.lon) * 60 * 1852 * Math.cos((thr.lat * Math.PI) / 180);
        tdDist = Math.hypot(dN, dE);
      }
      if (!Number.isNaN(tdVs)) {
        // After touchdown: reverse thrust to 80 kt, then idle reverse / stow (FCOM landing roll procedure).
        const gs = v.get(FDM.gs);
        v.set(B738.revLever(1), gs > 80 ? 1 : gs > 60 ? 0.3 : 0);
        v.set(B738.revLever(2), gs > 80 ? 1 : gs > 60 ? 0.3 : 0);
        if (gs < 30) return true;
      }
    });
    console.log(`LOC ${locT.toFixed(0)} s, maxLoc ${maxLoc.toFixed(2)} dot, maxGs ${maxGs.toFixed(2)} dot, LAND3 ${land3}, flare ${flare}, retard ${retard}, rollout ${rollout}, TD V/S ${tdVs.toFixed(0)} fpm at ${tdDist.toFixed(0)} m from the threshold, spoilers ${v.get('surf.ground_spoilers').toFixed(2)}, autobrake ${v.getString('brakes.autobrake_mode')}`);
    expect(locT).toBeLessThan(300);
    expect(gsCap).toBe(true);
    expect(maxLoc).toBeLessThan(1);
    expect(maxGs).toBeLessThan(1);
    expect(land3).toBe(true);
    expect(flare).toBe(true);
    expect(retard).toBe(true);
    expect(rollout).toBe(true);
    expect(tdVs).toBeGreaterThan(-600);
    expect(tdDist).toBeLessThan(1200);
    expect(v.get(FDM.gs)).toBeLessThan(35);
    expect(v.get(FDM.crashed)).toBe(0);
    expect(v.get(B738.speedbrake)).toBeGreaterThan(0.9); // auto speedbrake deployed, lever back-driven UP
    // A/P disconnect after landing (control wheel switch).
    v.set('input.ap_disc', 1);
    r.run(0.3);
    v.set('input.ap_disc', 0);
    r.run(1);
    expect(v.get(AP.engaged)).toBe(0);
    void SPEEDBRAKE;
  });
});
