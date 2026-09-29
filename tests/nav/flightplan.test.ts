import { describe, it, expect, beforeAll } from 'vitest';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { parseRoute, parseLatLon, parseSpeedLevel } from '../../src/nav/flightplan/RouteParser';
import { FlightPlan, makeLeg } from '../../src/nav/flightplan/FlightPlan';
import { FlightPlanManager } from '../../src/nav/flightplan/FlightPlanManager';
import { expandAirway } from '../../src/nav/flightplan/airways';
import { computePlanGeometry, turnRadiusNm } from '../../src/nav/flightplan/geometry';
import { SYNTHETIC_GPA_DEG, SYNTHETIC_TCH_FT } from '../../src/nav/flightplan/synthetic';
import { SimVars } from '../../src/core/SimVars';
import { FMS } from '../../src/core/vars';
import { distanceNm, destinationPoint } from '../../src/core/geo';
import type { Waypoint } from '../../src/nav/types';

const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => {
  await db.load();
}, 60000);

const idents = (p: FlightPlan) => p.legs.map((l) => (l.type === 'DISCO' ? '---' : l.fix?.ident ?? `(${l.type})`));

describe('ident resolution', () => {
  it('resolves airports, navaids and fixes nearest first', () => {
    const r = db.resolve('SBY', 40, -74);
    expect(r[0].kind).toBe('vor');
    expect(r[0].navaid?.freq).toBeGreaterThan(108);
    const kteb = db.resolve('KTEB', 0, 0);
    expect(kteb[0].kind).toBe('airport');
    const merit = db.resolve('MERIT', 41, -73);
    expect(merit[0].kind).toBe('fix');
    // Duplicate idents sort by distance from the reference point.
    const many = db.resolve('LGA', 40.78, -73.87);
    expect(distanceNm(40.78, -73.87, many[0].lat, many[0].lon)).toBeLessThan(5);
    expect(db.resolve('ZZZZZ9', 0, 0)).toEqual([]);
  });
});

describe('route parsing', () => {
  it('parses a SID with runway, airway expansion and destination', async () => {
    const r = await parseRoute(db, 'KTEB/24 WENTZ1 RUUDY WHITE J209 SBY KMIA', 'garmin');
    expect(r.errors).toEqual([]);
    const p = r.plan;
    expect(p.origin?.icao).toBe('KTEB');
    expect(p.departureRunway).toBe('24');
    expect(p.sid?.ident).toBe('WENTZ1');
    expect(p.sid?.runwayTransition).toBe('24');
    expect(p.destination?.icao).toBe('KMIA');
    const ids = idents(p);
    // Origin runway, SID legs (heading to altitude, fixes, vectors), discontinuity, enroute via J209.
    expect(ids[0]).toBe('RW24');
    expect(ids).toContain('WENTZ1'.slice(0, 5));
    const iWhite = ids.indexOf('WHITE');
    expect(ids.slice(iWhite, iWhite + 4)).toEqual(['WHITE', 'CYN', 'VILLS', 'SBY']);
    const cyn = p.legs[iWhite + 1];
    expect(cyn.airway).toBe('J209');
    expect(cyn.segment).toBe('enroute');
    expect(ids[ids.length - 1]).toBe('KMIA');
    // The SID ends with vectors (FM): a discontinuity must follow it.
    const fm = p.legs.findIndex((l) => l.type === 'FM');
    expect(p.legs[fm + 1].type).toBe('DISCO');
  });

  it('parses dotted STAR transitions, speed/level groups and coordinates', async () => {
    const r = await parseRoute(db, 'KTEB N0450F350 WHITE J209 SBY DCT 3500N07500W ACORI.FROGZ5 KMIA', 'garmin');
    expect(r.errors).toEqual([]);
    expect(r.plan.cruiseAltFt).toBe(35000);
    expect(r.plan.cruiseSpeedKt).toBe(450);
    expect(r.plan.star?.ident).toBe('FROGZ5');
    expect(r.plan.star?.enrouteTransition).toBe('ACORI');
    const arr = r.plan.legsIn('arrival');
    expect(arr.length).toBeGreaterThan(2);
    // 'DCT ACORI.FROGZ5': the route reaches the transition fix, which merges with the STAR's first leg (no discontinuity).
    const iFirst = r.plan.legs.indexOf(arr[0]);
    expect(r.plan.legs[iFirst - 1].fix?.ident).toBe('ACORI');
    expect(r.plan.legs.some((l) => l.type === 'DISCO' && l.segment !== 'enroute')).toBe(false);
    const ll = r.plan.legs.find((l) => l.fix?.kind === 'latlon')!;
    expect(ll.fix!.lat).toBeCloseTo(35, 6);
    expect(ll.fix!.lon).toBeCloseTo(-75, 6);
  });

  it('reports unknown tokens and bad airways', async () => {
    const r = await parseRoute(db, 'KTEB QQQQQ9 WHITE J209 KMIA KMIA', 'garmin');
    expect(r.errors.some((e) => e.includes('QQQQQ9'))).toBe(true);
    expect(() => expandAirway(db, 'J209', { ident: 'WHITE', lat: 39.66, lon: -74.3, kind: 'fix' }, 'NOTONIT')).toThrow();
  });

  it('token helpers', () => {
    expect(parseLatLon('4030N07350W')).toEqual({ lat: 40.5, lon: -(73 + 50 / 60) });
    expect(parseLatLon('N40W073')).toEqual({ lat: 40, lon: -73 });
    expect(parseLatLon('WAVEY')).toBeNull();
    expect(parseSpeedLevel('N0450F350')).toEqual({ speedKt: 450, altFt: 35000 });
    expect(parseSpeedLevel('M078F390')).toEqual({ mach: 0.78, altFt: 39000 });
    expect(parseSpeedLevel('A045')).toEqual({ altFt: 4500 });
    expect(parseSpeedLevel('M170')).toBeNull(); // an airway name, not a Mach group
    expect(parseSpeedLevel('J209')).toBeNull();
  });
});

describe('flight plan editing', () => {
  it('approach selection replaces the destination leg and splits the missed approach', async () => {
    const r = await parseRoute(db, 'KTEB WHITE J209 SBY KMIA', 'garmin');
    const p = r.plan;
    const procs = (await db.loadProcedures!('KMIA'))!;
    const appr = procs.approaches.find((a) => a.ident === 'R09')!;
    p.setApproach(appr, appr.transitions[0]?.name);
    expect(p.arrivalRunway).toBe('09');
    expect(p.legs.some((l) => l.segment === 'destination')).toBe(false);
    expect(p.fafIndex).toBeGreaterThan(0);
    expect(p.legs[p.fafIndex].faf).toBe(true);
    expect(p.mapIndex).toBeGreaterThan(p.fafIndex);
    expect(p.legs[p.mapIndex].fix?.ident).toBe('RW09');
    expect(p.firstMissedIndex).toBe(p.mapIndex + 1);
    // Removing the approach restores the destination leg.
    p.setApproach(null);
    expect(p.legs[p.legs.length - 1].segment).toBe('destination');
  });

  it('Boeing insert creates a discontinuity; Garmin connects directly', () => {
    const w = (ident: string, lat: number, lon: number): Waypoint => ({ ident, lat, lon, kind: 'fix' });
    for (const style of ['boeing', 'garmin'] as const) {
      const p = new FlightPlan(style);
      p.legs = [makeLeg({ type: 'IF', segment: 'enroute', fix: w('AAA', 40, -74) }), makeLeg({ type: 'TF', segment: 'enroute', fix: w('BBB', 40, -73) })];
      p.normalize();
      p.insertWaypoint(1, w('XXX', 40.5, -73.5));
      const ids = idents(p);
      if (style === 'boeing') expect(ids).toEqual(['AAA', 'XXX', '---', 'BBB']);
      else expect(ids).toEqual(['AAA', 'XXX', 'BBB']);
      // Deleting the discontinuity (Boeing) reconnects the route.
      if (style === 'boeing') {
        p.deleteLeg(2);
        expect(idents(p)).toEqual(['AAA', 'XXX', 'BBB']);
      }
      // Boeing: entering a downstream waypoint closes the route up to it.
      if (style === 'boeing') {
        p.insertWaypoint(1, w('BBB', 40, -73));
        expect(idents(p)).toEqual(['AAA', 'BBB']);
      }
    }
  });

  it('repeated fixes at segment junctions merge and keep the later constraint', () => {
    const w = (ident: string, lat: number, lon: number): Waypoint => ({ ident, lat, lon, kind: 'fix' });
    const p = new FlightPlan('garmin');
    p.legs = [
      makeLeg({ type: 'TF', segment: 'arrival', fix: w('VINGS', 40.7, -74.27) }),
      makeLeg({ type: 'IF', segment: 'approach', fix: w('VINGS', 40.7, -74.27), altitude: { kind: 'at', lowerFt: 2000, upperFt: 2000 } }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('TORBY', 40.8, -74.13) }),
    ];
    p.normalize();
    expect(idents(p)).toEqual(['VINGS', 'TORBY']);
    expect(p.legs[0].altitude?.lowerFt).toBe(2000);
  });

  it('holds and direct-to', () => {
    const w = (ident: string, lat: number, lon: number): Waypoint => ({ ident, lat, lon, kind: 'fix' });
    const p = new FlightPlan('garmin');
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('AAA', 40, -74) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('BBB', 40, -73) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('CCC', 41, -73) }),
    ];
    p.normalize();
    computePlanGeometry(p, { groundSpeedKt: 200, startAltFt: 5000 });
    const hold = p.insertHold(1, { turnDirection: 'L', legTimeMin: 1 })!;
    expect(hold.type).toBe('HM');
    expect(idents(p)).toEqual(['AAA', 'BBB', 'BBB', 'CCC']);
    // Inbound course defaults to the course arriving at the fix (~090 true, minus variation).
    expect(hold.course! + hold.magVar).toBeGreaterThan(85);
    expect(hold.course! + hold.magVar).toBeLessThan(95);
    const leg = p.directTo(3, 40.2, -73.5)!;
    expect(leg.type).toBe('DF');
    expect(p.activeLegIndex).toBe(3);
    expect(leg.dfStartLat).toBe(40.2);
    // Off-plan direct-to: inserted before the active leg, followed by a discontinuity.
    p.directTo(w('ZZZ', 40.5, -73.2), 40.3, -73.4);
    expect(p.activeLeg?.fix?.ident).toBe('ZZZ');
    expect(p.legs[p.activeLegIndex + 1].type).toBe('DISCO');
  });
});

describe('FlightPlanManager', () => {
  const w = (ident: string, lat: number, lon: number): Waypoint => ({ ident, lat, lon, kind: 'fix' });
  const build = (m: FlightPlanManager) => {
    const p = new FlightPlan(m.style);
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('AAA', 40, -74) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('BBB', 40, -73) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('CCC', 41, -73) }),
    ];
    p.normalize();
    p.activeLegIndex = 1;
    return p;
  };

  it('Boeing: MOD copy, EXEC keeps the active leg, ERASE discards', () => {
    const vars = new SimVars();
    const m = new FlightPlanManager('boeing', { vars });
    m.replace(build(m));
    expect(m.pending).toBe(true);
    expect(vars.get(FMS.modPending)).toBe(1);
    m.exec();
    expect(m.pending).toBe(false);
    const activeId = m.active.activeLeg!.id;
    // Modify: insert a waypoint before CCC; the active plan is untouched until EXEC.
    m.apply((p) => p.insertWaypoint(2, w('XXX', 40.5, -73)));
    expect(m.pending).toBe(true);
    expect(idents(m.active)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(idents(m.displayed)).toEqual(['AAA', 'BBB', 'XXX', '---', 'CCC']);
    // The active plan sequences meanwhile.
    m.active.activeLegIndex = 2;
    const nowActive = m.active.activeLeg!.id;
    expect(nowActive).not.toBe(activeId);
    m.exec();
    expect(m.active.activeLeg!.id).toBe(nowActive);
    m.apply((p) => p.deleteLeg(0));
    m.erase();
    expect(m.pending).toBe(false);
    expect(idents(m.active)[0]).toBe('AAA');
  });

  it('Garmin: edits apply immediately', () => {
    const m = new FlightPlanManager('garmin');
    m.replace(build(m));
    expect(m.pending).toBe(false);
    m.apply((p) => p.insertWaypoint(2, w('XXX', 40.5, -73)));
    expect(idents(m.active)).toEqual(['AAA', 'BBB', 'XXX', 'CCC']);
  });
});

describe('geometry', () => {
  it('fly-by turn anticipation R*tan(dpsi/2)', () => {
    const w = (ident: string, lat: number, lon: number): Waypoint => ({ ident, lat, lon, kind: 'fix' });
    const p = new FlightPlan('garmin');
    const b = destinationPoint(0, 0, 90, 20);
    const c = destinationPoint(b.lat, b.lon, 0, 20);
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', 0, 0) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', b.lat, b.lon) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', c.lat, c.lon) }),
    ];
    p.normalize();
    const total = computePlanGeometry(p, { groundSpeedKt: 240, startAltFt: 5000, bankLimitDeg: 25 });
    expect(total).toBeCloseTo(40, 3);
    const g = p.legs[1].geom;
    expect(g.turnValid).toBe(true);
    expect(g.turnAngleDeg).toBeCloseTo(-90, 1);
    const r = turnRadiusNm(240, 25);
    expect(g.turnRadiusNm).toBeCloseTo(r, 6);
    expect(g.turnAnticipationNm).toBeCloseTo(r * Math.tan(Math.PI / 4), 6);
    expect(p.legs[2].geom.cumDistNm).toBeCloseTo(40, 3);
  });
});

describe('synthetic approaches', () => {
  it('every runway end at a non-CIFP airport gets RNAV (and ILS where equipped)', async () => {
    const procs = (await db.loadProcedures!('EGLL'))!;
    const a = db.airport('EGLL')!;
    const ends = a.runways.map((r) => r.ident);
    for (const e of ends) {
      expect(procs.approaches.some((p) => p.ident === `R${e}`)).toBe(true);
      expect(procs.approaches.some((p) => p.ident === `I${e}`)).toBe(true);
    }
    const r = procs.approaches.find((p) => p.ident === 'R27L')!;
    expect(r.synthetic).toBe(true);
    expect(r.glidepathDeg).toBe(SYNTHETIC_GPA_DEG);
    const rw = db.runway('EGLL', '27L')!;
    const faf = r.finalLegs[1];
    expect(faf.faf).toBe(true);
    const fafAlt = faf.altitude!.lowerFt!;
    expect(fafAlt).toBeGreaterThanOrEqual(rw.elevationFt + 1500);
    expect(fafAlt).toBeLessThan(rw.elevationFt + 1600);
    // FAF where a 3 deg path with a 50 ft TCH reaches the FAF altitude.
    const expected = (fafAlt - rw.elevationFt - SYNTHETIC_TCH_FT) / (Math.tan((3 * Math.PI) / 180) * 6076.12);
    expect(distanceNm(rw.thresholdLat!, rw.thresholdLon!, faf.fix!.lat, faf.fix!.lon)).toBeCloseTo(expected, 2);
    expect(r.missedLegs.map((l) => l.type)).toEqual(['CA', 'DF', 'HM']);
    const ils = procs.approaches.find((p) => p.ident === 'I27L')!;
    expect(ils.navFrequencyMhz).toBeCloseTo(rw.ils!.freqMhz, 3);
    expect(ils.approachType).toBe('ILS');
  });

  it('US airports keep their published approaches and fill uncovered runways', async () => {
    const procs = (await db.loadProcedures!('KTEB'))!;
    expect(procs.cycle).toBe('2609');
    expect(procs.approaches.some((p) => p.ident === 'I06-Z' && !p.synthetic)).toBe(true);
    // KTEB 01/19 and 06/24: every end is served by something.
    const a = db.airport('KTEB')!;
    for (const rw of a.runways) {
      const id = rw.ident.padStart(2, '0');
      expect(procs.approaches.some((p) => p.runways.includes(id))).toBe(true);
    }
  });
});
