/**
 * Fix round 1 (LENS layout) regression tests:
 *  - L01: the four Symmetry TSCs use PORTRAIT page layouts (480 x 800) and every widget of every page
 *    (shared apps + the G800 FLT CTL / ECB / AUDIO / TAWS apps) fits inside the portrait screen below
 *    the title bar; the OHPTS stay landscape.
 *  - L02: dual HUD - the copilot HUD computer (side 2) powers its own combiner and luminance vars.
 *  - L05: the EGPWS terrain layer blanks terrain within 400 ft of the runway elevation, and on the
 *    ground it blanks against the aircraft's own elevation even before an airport is known
 *    (Honeywell MK VI/VIII EGPWS Pilot Guide 060-4314-000 Rev C p.31-32).
 *  - L23: FMS distance-to-destination excludes missed-approach legs until the missed approach is
 *    active (standard FMS behaviour).
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
import { TSC_PORTRAIT_H, TSC_PORTRAIT_W, TSC_TITLE_H, TSC_H, TSC_W } from '../../../../src/avionics/honeywell-epic/touch/tscPages';
import { labelOf } from '../../../../src/avionics/honeywell-epic/logic/touch';
import { terrainBand } from '../../../../src/avionics/common/draw/TerrainRaster';
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';
import { FMS } from '../../../../src/core/vars';
import { GPS } from '../../../../src/core/vars';
import { destinationPoint, distanceNm } from '../../../../src/core/geo';
import { Fms } from '../../../../src/nav/fms/Fms';
import { FlightPlan, makeLeg } from '../../../../src/nav/flightplan/FlightPlan';
import type { NavDatabase, Waypoint } from '../../../../src/nav/types';

describe('G800 fix round 1 (layout lens)', () => {
  it('L01: TSC pages are portrait 480x800 and every widget fits below the title bar', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const suite = r.sys.suite!;
    expect(suite.tscLogic.length).toBe(4);
    for (const logic of suite.tscLogic) {
      // The G800-specific apps must be installed on every TSC.
      for (const id of ['FLTCTL', 'ECB', 'AUDIO', 'TAWS']) expect(logic.has(id)).toBe(true);
      for (const page of logic.pages) {
        for (const w of page.widgets) {
          const where = `TSC page ${page.id} widget ${w.id} (${labelOf(w)}) at ${w.x},${w.y} ${w.w}x${w.h}`;
          expect(w.x, where).toBeGreaterThanOrEqual(0);
          expect(w.y, where).toBeGreaterThanOrEqual(TSC_TITLE_H);
          expect(w.x + w.w, where).toBeLessThanOrEqual(TSC_PORTRAIT_W);
          expect(w.y + w.h, where).toBeLessThanOrEqual(TSC_PORTRAIT_H);
        }
      }
    }
    // OHPTS pages remain landscape 800x480.
    for (const logic of suite.ohptsLogic) {
      for (const page of logic.pages) {
        for (const w of page.widgets) {
          expect(w.x + w.w, `OHPTS page ${page.id} widget ${w.id}`).toBeLessThanOrEqual(TSC_W);
          expect(w.y + w.h, `OHPTS page ${page.id} widget ${w.id}`).toBeLessThanOrEqual(TSC_H);
        }
      }
    }
    // Portrait pages still work: HOME tile tap navigates.
    const logic = suite.tscLogic[0];
    logic.show('HOME', false);
    expect(logic.tapId('home.TAWS')).toBe(true);
    expect(logic.current.id).toBe('TAWS');
  });

  it('L02: copilot HUD computer drives its own vars (dual HUD)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // Pilot HUD deployed by default; copilot combiner stowed -> off.
    expect(v.get(V.hudOnS(2))).toBe(0);
    v.set(V.hudStowS(2), 1);
    v.set(V.hudBrtS(2), 0.8);
    r.run(1);
    expect(v.get('elec.hud_r_powered')).toBe(1);
    expect(v.get(V.hudOnS(2))).toBe(1);
    expect(v.get(V.hudLumS(2))).toBeGreaterThan(0.1);
    // Stowing the copilot combiner turns only side 2 off.
    v.set(V.hudStowS(2), 0);
    r.run(1);
    expect(v.get(V.hudOnS(2))).toBe(0);
    expect(v.get(V.hudOnS(1))).toBe(1);
  });

  it('L05: EGPWS terrain blanks within 400 ft of the runway elevation (and of own elevation on the ground)', () => {
    // Runway elevation known: within +/-400 ft of it -> black.
    expect(terrainBand('egpws', 290, false, { elevFt: 300, runwayElevFt: 10 }).band).toBe(0);
    // Above the 400 ft band -> low-density yellow (the guide's terrain picture).
    expect(terrainBand('egpws', 490, false, { elevFt: 500, runwayElevFt: 10 }).band).toBe(1);
    // On the ground with NO airport known: own altitude stands in as the runway elevation.
    expect(terrainBand('egpws', 290, false, { elevFt: 300, onGround: true }).band).toBe(0);
    expect(terrainBand('egpws', -100, false, { elevFt: 20, onGround: true }).band).toBe(0);
    // The same cells in the air (no runway known) keep the normal EGPWS bands.
    expect(terrainBand('egpws', 290, false, { elevFt: 300 }).band).toBe(1);
  });

  it('L23: distance to destination excludes missed-approach legs', () => {
    const vars = new SimVars();
    const events = new EventBus();
    const noDb = { ready: true, airportsNear: () => [{}], resolve: () => [] } as unknown as NavDatabase;
    const fms = new Fms({ vars, events, nav: noDb }, { style: 'boeing', bankLimitDeg: 25 });
    const w = (ident: string, p: { lat: number; lon: number }): Waypoint => ({ ident, lat: p.lat, lon: p.lon, kind: 'fix' });
    const A = { lat: 32, lon: -81 };
    const B = destinationPoint(A.lat, A.lon, 90, 20);
    const RW = destinationPoint(B.lat, B.lon, 90, 10); // destination (runway) fix
    const M1 = destinationPoint(RW.lat, RW.lon, 90, 8); // missed-approach fix 8 nm past the runway
    const plan = new FlightPlan(fms.plans.style);
    plan.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('RW10', RW) }),
      makeLeg({ type: 'TF', segment: 'missed', fix: w('M1', M1), missedStart: true }),
    ];
    plan.normalize();
    fms.plans.replace(plan);
    if (fms.plans.pending) fms.plans.exec();
    // Aircraft at A flying east.
    vars.set(GPS.valid, 1);
    vars.set(GPS.lat, A.lat);
    vars.set(GPS.lon, A.lon);
    vars.set(GPS.gs, 200);
    vars.set(GPS.trackTrue, 90);
    for (let i = 0; i < 30; i++) fms.update(0.1);
    const toDest = vars.get(FMS.distToDestNm);
    const direct = distanceNm(A.lat, A.lon, RW.lat, RW.lon); // ~30 nm along-path (straight route)
    expect(toDest).toBeGreaterThan(direct - 3);
    // Must NOT include the 8 nm missed leg.
    expect(toDest).toBeLessThan(direct + 4);
  });
});
