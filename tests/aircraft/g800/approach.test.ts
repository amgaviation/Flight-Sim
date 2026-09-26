/**
 * (f) Coupled ILS approach with the Primus Epic AFCS through the fly-by-wire
 * and the autothrottle, from the app's `approach` start placement (10 nm final
 * on the glideslope) at Savannah (KSAV ILS 10, Gulfstream's home field). Real
 * navigation database, radios, FMS and the headless Symmetry suite. The G800
 * is not certified for autoland (TCDS §12.1: CAT I): the crew disconnects the
 * autopilot at the 80 ft AGL minimum disengage height for ILS approaches (GVI
 * limitation) and the test checks the stabilised state there.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { planStart } from '../../../src/ui/startPosition';
import { G800_META } from '../../../src/aircraft/g800/meta';
import { G800_VARS as V } from '../../../src/aircraft/g800/vars';
import { G800_LIMITS, vref } from '../../../src/aircraft/g800/data';

describe('G800 coupled ILS (Epic AFCS + FBW + A/T)', () => {
  it('captures LOC/GS from the approach state, tracks within 1 dot, disconnects at 80 ft AGL', { timeout: 600000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const apt = db.airport('KSAV')!;
    expect(apt).toBeTruthy();
    const p = planStart(apt, { kind: 'runway', runway: '10' }, 'approach', G800_META);
    expect(p.ils).toBeTruthy();
    const w = 75000;
    const r = makeRig('approach', {
      weightLb: w,
      nav: db,
      avionics: true,
      field: { lat: p.lat, lon: p.lon, elevFt: apt.elevationFt, courseTrue: p.headingTrue },
      air: { altFtMsl: p.altFtMsl!, iasKt: p.iasKt! },
    });
    const v = r.vars;
    // App (docs/modules/app.md 2.4): tune NAV1/NAV2 to the ILS after applyState, reset radios.
    const magVar = v.get('fdm.mag_var_deg');
    for (const n of [1, 2]) {
      v.set(`nav${n}.active_mhz`, p.ils!.freqMhz);
      v.set(`nav${n}.obs_deg`, (p.ils!.courseTrue - magVar + 360) % 360);
    }
    r.sys.radios!.reset();
    r.run(3);
    expect(v.get('nav1.received')).toBe(1);
    expect(v.get('nav1.is_loc')).toBe(1);

    // Crew (GP-700 / TSC): NAV SRC = NAV1 (LOC), AP on, HDG on the runway course, A/T on, APR.
    v.set('epic.s1.nav_src', 1); // TSC DISPLAY / PFD NAV SRC = NAV1 (the GP couples ap.nav_source to it)
    v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
    r.events.emit('epic.gp.ap');
    r.run(0.5);
    r.events.emit('epic.gp.hdg_btn');
    r.run(0.5);
    r.events.emit('epic.gp.at');
    v.set('ap.sel_spd_kt', 150);
    r.events.emit('epic.gp.apr');
    r.run(1);
    expect(v.get('ap.engaged')).toBe(1);
    expect(v.get('ap.at_engaged')).toBe(1);
    expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');

    let locCap = false;
    let gsCap = false;
    let maxLoc = 0;
    let maxGs = 0;
    let discAt = NaN;
    let vsAtDisc = NaN;
    let iasAtDisc = NaN;
    const vapp = vref(w) + 5;
    r.run(420, () => {
      const lat = v.getString('ap.lat_active');
      const vert = v.getString('ap.vert_active');
      const ra = v.get('ra1.alt_ft');
      if (lat.startsWith('LOC')) locCap = true;
      if (vert === 'GS') {
        if (!gsCap) {
          // Before landing: gear down, flaps 39, speed to VAPP.
          v.set(V.gearHandle, 1);
          v.set(V.flapLever, 3);
          v.set('ap.sel_spd_kt', vapp);
        }
        gsCap = true;
      }
      if (gsCap && ra > 200) {
        maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
        maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
      }
      if (gsCap && ra < G800_LIMITS.apMinDisengageIlsFt && isNaN(discAt)) {
        discAt = ra;
        vsAtDisc = v.get('fdm.vs_fpm');
        iasAtDisc = v.get('adc1.ias_kt');
        v.set('input.ap_disc', 1);
      }
      return !isNaN(discAt) && ra < 60;
    });
    v.set('input.ap_disc', 0);
    expect(locCap).toBe(true);
    expect(gsCap).toBe(true);
    expect(maxLoc).toBeLessThan(0.5); // 1 dot = half scale (two-dot display)
    expect(maxGs).toBeLessThan(0.5);
    expect(v.get('ap.engaged')).toBe(0);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(38);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(Math.abs(iasAtDisc - vapp)).toBeLessThan(8);
    expect(vsAtDisc).toBeLessThan(-450);
    expect(vsAtDisc).toBeGreaterThan(-950);
    expect(casTexts(r, 'warning')).toEqual([]);
  });
});
