/**
 * Coupled ILS approach with the G5000 AFCS and autothrottle, from the app's
 * `approach` start placement (10 nm final on the glideslope) at Wichita (KICT
 * ILS 1R; BCA flew the Longitude there). Real navigation database, headless
 * G5000 suite (radios, FMS, GMC 710), full systems. The Longitude is not
 * autoland capable: the AP is disconnected at the 160 ft AGL approach minimum
 * (OG 1-7).
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from './helpers';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { planStart } from '../../../src/ui/startPosition';
import { LONGITUDE_META } from '../../../src/aircraft/citation-longitude/meta';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { vref } from '../../../src/aircraft/citation-longitude/performance';

describe('Citation Longitude coupled ILS (G5000 AFCS + A/T)', () => {
  it('captures LOC/GS from the approach state, tracks within 1 dot, disconnects at 160 ft AGL', { timeout: 600000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const apt = db.airport('KICT')!;
    expect(apt).toBeTruthy();
    const p = planStart(apt, { kind: 'runway', runway: '1R' }, 'approach', LONGITUDE_META);
    expect(p.ils).toBeTruthy();
    const w = 30000;
    const r = makeRig('approach', {
      weightLb: w,
      nav: db,
      field: { lat: p.lat, lon: p.lon, elevFt: apt.elevationFt, courseTrue: p.headingTrue },
      air: { altFtMsl: p.altFtMsl!, iasKt: p.iasKt! },
    });
    const v = r.vars;
    // App (docs/modules/app.md 2.4): tune NAV1 to the ILS after applyState, reset radios/FMS.
    const magVar = v.get('fdm.mag_var_deg');
    v.set('nav1.active_mhz', p.ils!.freqMhz);
    v.set('nav1.obs_deg', (p.ils!.courseTrue - magVar + 360) % 360);
    v.set('nav2.active_mhz', p.ils!.freqMhz);
    v.set('nav2.obs_deg', (p.ils!.courseTrue - magVar + 360) % 360);
    r.sys.suite!.radios?.reset?.();
    r.run(3);
    expect(v.get('nav1.received')).toBe(1);
    expect(v.get('nav1.is_loc')).toBe(1);

    // Crew: AP ON (GMC 710 AP key), HDG on the runway course, A/T SPD 140 kt, APR key.
    v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
    r.events.emit('g3k.gmc.key_ap');
    r.run(0.5);
    r.events.emit('g3k.gmc.key_hdg');
    r.events.emit('g3k.gmc.key_alt');
    r.run(0.5);
    r.sys.at.pressEngage();
    v.set('ap.sel_spd_kt', 140);
    r.events.emit('g3k.gmc.key_apr');
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
          // Before landing (OG 17-8): gear down, flaps FULL, speed to VAPP.
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
      if (gsCap && ra < 160 && isNaN(discAt)) {
        discAt = ra;
        vsAtDisc = v.get('fdm.vs_fpm');
        iasAtDisc = v.get('adc1.ias_kt');
        v.set('input.ap_disc', 1);
      }
      return !isNaN(discAt) && ra < 120;
    });
    v.set('input.ap_disc', 0);
    expect(locCap).toBe(true);
    expect(gsCap).toBe(true);
    expect(maxLoc).toBeLessThan(0.5); // 1 dot = half scale (Garmin CDI +/-2 dots)
    expect(maxGs).toBeLessThan(0.5);
    expect(v.get('ap.engaged')).toBe(0);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(34);
    expect(v.get('gear.down_locked')).toBe(1);
    // Speed held by the A/T near VAPP; stable descent on the 3 deg path.
    expect(Math.abs(iasAtDisc - vapp)).toBeLessThan(8);
    expect(vsAtDisc).toBeLessThan(-450);
    expect(vsAtDisc).toBeGreaterThan(-900);
    const warnings = r.sys.cas.list.filter((e) => e.active && e.level === 'warning').map((e) => e.text);
    expect(warnings).toEqual([]);
  });
});
