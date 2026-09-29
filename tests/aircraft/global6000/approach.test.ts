/**
 * (f) Coupled ILS approach with the Pro Line Fusion AFCS (FCP-5120 buttons)
 * and autothrottle, from the app's `approach` start placement (10 nm final on
 * the glideslope) at Montreal-Trudeau (CYUL, Bombardier's Global completion
 * centre) and Teterboro (KTEB). Real navigation database, Fusion suite on fake
 * canvases, full systems. The Global 6000 has no autoland (GXAF): the
 * autopilot is disconnected at the 200 ft decision height.
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from './helpers';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { planStart } from '../../../src/ui/startPosition';
import { G6K_META } from '../../../src/aircraft/global6000/meta';
import { G6K_VARS as V } from '../../../src/aircraft/global6000/vars';
import { vSpeeds } from '../../../src/aircraft/global6000/data';
import { FUSION_VARS, NavSrc } from '../../../src/avionics/collins-fusion/vars';

describe('Global 6000 coupled ILS (Pro Line Fusion AFCS + A/T)', () => {
  for (const [icao, rwy] of [['CYUL', '06L'], ['KTEB', '6']] as const) {
    it(`${icao} ILS ${rwy}: captures LOC/GS, tracks within 1 dot, slats/flaps 30 + gear down, disconnects at 200 ft`, { timeout: 600000 }, async () => {
      const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
      await db.load();
      const apt = db.airport(icao)!;
      expect(apt).toBeTruthy();
      const p = planStart(apt, { kind: 'runway', runway: rwy }, 'approach', G6K_META);
      expect(p.ils).toBeTruthy();
      const w = 75000;
      const r = makeRig('approach', {
        weightLb: w,
        fuelLb: 12000,
        avionics: true,
        nav: db,
        field: { lat: p.lat, lon: p.lon, elevFt: apt.elevationFt, courseTrue: p.headingTrue },
        air: { altFtMsl: p.altFtMsl!, iasKt: p.iasKt! },
      });
      const v = r.vars;
      // App (docs/modules/app.md 2.4): tune NAV1/2 to the ILS after applyState.
      const magVar = v.get('fdm.mag_var_deg');
      const crs = (p.ils!.courseTrue - magVar + 360) % 360;
      for (const n of [1, 2]) {
        v.set(`nav${n}.active_mhz`, p.ils!.freqMhz);
        v.set(`nav${n}.obs_deg`, crs);
      }
      r.run(3);
      expect(v.get('nav1.received')).toBe(1);
      expect(v.get('nav1.is_loc')).toBe(1);

      // Crew: PFD NAV SRC -> LOC1 (CTP), FCP AP, HDG, A/T, APPR.
      v.set(FUSION_VARS.navSource(1), NavSrc.Nav1);
      v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
      const vapp = Math.round(vSpeeds(w).vref + 5);
      r.events.emit('fusion.fcp.ap');
      r.run(0.5);
      r.events.emit('fusion.fcp.hdg');
      r.run(0.5);
      r.events.emit('fusion.fcp.at');
      v.set('ap.sel_spd_kt', vapp);
      r.run(0.5);
      r.events.emit('fusion.fcp.appr');
      r.run(1);
      expect(v.get('ap.engaged')).toBe(1);
      expect(v.get('ap.at_engaged')).toBe(1);
      expect(v.get('ap.nav_source')).toBe(1); // APPR couples the AFCS to the localizer receiver
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');

      let locCap = false;
      let gsCap = false;
      let maxLoc = 0;
      let maxGs = 0;
      let discAt = NaN;
      let vsAtDisc = NaN;
      let iasAtDisc = NaN;
      r.run(480, () => {
        const lat = v.getString('ap.lat_active');
        const vert = v.getString('ap.vert_active');
        const ra = v.get('ra1.alt_ft');
        if (lat.startsWith('LOC')) locCap = true;
        if (vert === 'GS') gsCap = true;
        if (gsCap && ra > 300 && ra < 2000) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        if (gsCap && ra < 200 && isNaN(discAt)) {
          discAt = ra;
          vsAtDisc = v.get('fdm.vs_fpm');
          iasAtDisc = v.get('adc1.ias_kt');
          v.set('input.ap_disc', 1);
        }
        return !isNaN(discAt) && ra < 150;
      });
      v.set('input.ap_disc', 0);
      // eslint-disable-next-line no-console
      console.log(`${icao} ILS ${rwy}: max LOC ${maxLoc.toFixed(3)} / GS ${maxGs.toFixed(3)} (full scale 1), IAS ${iasAtDisc.toFixed(1)} (VAPP ${vapp}), VS ${vsAtDisc.toFixed(0)} fpm at ${discAt.toFixed(0)} ft RA`);
      expect(locCap).toBe(true);
      expect(gsCap).toBe(true);
      expect(maxLoc).toBeLessThan(0.5); // 1 dot = half scale (+/- 2 dots)
      expect(maxGs).toBeLessThan(0.5);
      expect(v.get('ap.engaged')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(29);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(v.get(V.flapLever)).toBe(4);
      expect(Math.abs(iasAtDisc - vapp)).toBeLessThan(8);
      expect(vsAtDisc).toBeLessThan(-400);
      expect(vsAtDisc).toBeGreaterThan(-1000); // 3 deg path at ~125 kt GS = -660 fpm
      const warnings = r.sys.cas.list.filter((e) => e.active && e.level === 'warning').map((e) => e.text);
      expect(warnings).toEqual([]);
    });
  }
});
