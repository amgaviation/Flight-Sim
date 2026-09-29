/**
 * (f) Coupled ILS approach with the Primus Epic AFCS (guidance panel buttons)
 * and autothrottle, from the app's `approach` start placement (10 nm final on
 * the glideslope) at Savannah (KSAV, Gulfstream's home field) and Teterboro (KTEB). Real navigation
 * database, Epic suite on fake canvases, full systems. The G650 has no autoland:
 * the autopilot is disconnected at the 200 ft decision height (LIM minimum
 * disengage height on an ILS: 80 ft AGL).
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from './helpers';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { planStart } from '../../../src/ui/startPosition';
import { G650_META } from '../../../src/aircraft/g650/meta';
import { G650_VARS as V } from '../../../src/aircraft/g650/vars';
import { vref } from '../../../src/aircraft/g650/data';
import { EPIC_VARS } from '../../../src/avionics/honeywell-epic/vars';

describe('G650 coupled ILS (Primus Epic AFCS + A/T)', () => {
  for (const [icao, rwy] of [['KSAV', '10'], ['KTEB', '6']] as const) {
    it(`${icao} ILS ${rwy}: captures LOC/GS, tracks within 1 dot, gear/flaps 39 on the glideslope, disconnects at 200 ft`, { timeout: 600000 }, async () => {
      const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
      await db.load();
      const apt = db.airport(icao)!;
      const p = planStart(apt, { kind: 'runway', runway: rwy }, 'approach', G650_META);
      expect(p.ils).toBeTruthy();
      const w = 70000;
      const r = makeRig('approach', {
        weightLb: w,
        fuelLb: 10000,
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

      // Crew: PFD NAV SRC -> LOC1 (display controller), AP, HDG, A/T SPD, APR on the guidance panel.
      v.set(EPIC_VARS.navSrc(1), 1);
      v.set('ap.sel_hdg_deg', Math.round(v.get('fdm.hdg_mag_deg')));
      r.events.emit('epic.gp.ap');
      r.run(0.5);
      r.events.emit('epic.gp.hdg_btn');
      r.run(0.5);
      r.events.emit('epic.gp.at');
      v.set('ap.sel_spd_kt', 150);
      r.run(0.5);
      r.events.emit('epic.gp.apr');
      r.run(1);
      expect(v.get('ap.engaged')).toBe(1);
      expect(v.get('ap.at_engaged')).toBe(1);
      expect(v.get('ap.nav_source')).toBe(1);
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
            // Before Landing: gear down, flaps 39, speed to VREF + 5 (checklists.ts).
            v.set(V.gearHandle, 1);
            v.set(V.flapLever, 3);
            v.set('ap.sel_spd_kt', vapp);
          }
          gsCap = true;
        }
        if (gsCap && ra > 300) {
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
      console.log(`ILS ${rwy}: max LOC ${maxLoc.toFixed(3)} / GS ${maxGs.toFixed(3)} dots-fraction, IAS ${iasAtDisc.toFixed(1)} (VAPP ${vapp}), VS ${vsAtDisc.toFixed(0)} fpm at ${discAt.toFixed(0)} ft RA`);
      expect(locCap).toBe(true);
      expect(gsCap).toBe(true);
      expect(maxLoc).toBeLessThan(0.5); // 1 dot = half scale (+/- 2 dots)
      expect(maxGs).toBeLessThan(0.5);
      expect(v.get('ap.engaged')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(38);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(Math.abs(iasAtDisc - vapp)).toBeLessThan(8);
      expect(vsAtDisc).toBeLessThan(-450);
      expect(vsAtDisc).toBeGreaterThan(-1100); // 3 deg path at ~135 kt = -720 fpm, plus the path corrections
      const warnings = r.sys.cas.list.filter((e) => e.active && e.level === 'warning').map((e) => e.text);
      expect(warnings).toEqual([]);
    });
  }
});
