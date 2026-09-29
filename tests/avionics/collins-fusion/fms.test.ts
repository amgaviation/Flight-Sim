import { beforeAll, describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, AP, GPS, NAV } from '../../../src/core/vars';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { Fms } from '../../../src/nav/fms/Fms';
import { FMS_PAGES, parseAltConstraint, parseAltitude, parseComFreq, parseSpeedAlt, parseSquawk, parseWeightLb } from '../../../src/avionics/collins-fusion/fms';
import { FUSION_EVENTS, FUSION_VARS, NavSrc, Win } from '../../../src/avionics/collins-fusion/vars';
import { makeSuite, recordEvents, render, run, type TestSuite } from './helpers';

const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => {
  await db.load();
}, 60_000);

function setup(lat = 40.85, lon = -74.06) {
  const vars = new SimVars();
  const events = new EventBus();
  vars.set(GPS.valid, 1);
  vars.set(GPS.lat, lat);
  vars.set(GPS.lon, lon);
  vars.set(GPS.gs, 0);
  vars.set(GPS.magVar, -13);
  vars.set('gear.air_ground', 1); // on the ground (DEP/ARR key opens DEPARTURE)
  const fms = new Fms({ vars, events, nav: db }, { style: 'boeing', engineCount: 2 });
  const t = makeSuite({}, fms, db, vars, events);
  t.suite.applyState('ready_to_taxi'); // no AFD self test
  const step = (s = 0.2) => {
    fms.update(s);
    t.suite.system.update(s);
  };
  return { ...t, fms, step };
}

/** Types on side's MKP. */
function type(t: TestSuite, s: string, side: 1 | 2 = 1): void {
  for (const ch of s) t.events.emit(FUSION_EVENTS.mkpKey(side), ch === ' ' ? 'SP' : ch === '.' ? 'DOT' : ch === '/' ? 'SLASH' : ch);
}
const key = (t: TestSuite, k: string, side: 1 | 2 = 1) => t.events.emit(FUSION_EVENTS.mkpKey(side), k);

describe('FMS scratchpad parsing', () => {
  it('altitudes, constraints, frequencies, codes, weights', () => {
    expect(parseAltitude('FL410')).toBe(41000);
    expect(parseAltitude('350')).toBe(35000);
    expect(parseAltConstraint('5000A7000B')).toEqual({ kind: 'between', lowerFt: 5000, upperFt: 7000 });
    expect(parseAltConstraint('FL240B')).toEqual({ kind: 'atOrBelow', upperFt: 24000 });
    expect(parseSpeedAlt('250/12000A')).toEqual({ speed: { kind: 'atOrBelow', kt: 250 }, alt: { kind: 'atOrAbove', lowerFt: 12000 } });
    expect(parseSpeedAlt('/')).toBeNull();
    expect(parseComFreq('12345')).toBeCloseTo(123.45, 3);
    expect(parseComFreq('137.1')).toBeNaN();
    expect(parseSquawk('7780')).toBeNaN();
    expect(parseWeightLb('58.2')).toBe(58200);
  });

  it('every page renders on an empty plan', () => {
    const t = setup();
    for (const id of Object.keys(FMS_PAGES)) {
      t.suite.fmsWin[0].show(id as never);
      expect(t.suite.fmsWin[0].screen.title.length, id).toBeGreaterThan(0);
    }
  });
});

describe('FMS entry flows (MKP + line select)', () => {
  it('origin / destination entry goes into a MOD plan, EXEC activates it', () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    key(t, 'FPLN');
    expect(w.pageId).toBe('FPLN');
    type(t, 'KTEB');
    expect(w.scratch).toBe('KTEB');
    w.lsk('L1');
    expect(w.scratch).toBe('');
    expect(t.vars.get('fms.mod_pending')).toBe(1);
    t.step();
    expect(t.vars.get(FUSION_VARS.execLight)).toBe(1);
    expect(w.screen.title).toBe('MOD FPLN');
    type(t, 'KBOS');
    w.lsk('R1');
    key(t, 'EXEC');
    t.step();
    expect(t.fms.plans.active.origin?.icao).toBe('KTEB');
    expect(t.fms.plans.active.destination?.icao).toBe('KBOS');
    expect(t.vars.get(FUSION_VARS.execLight)).toBe(0);
    // Unknown airport.
    type(t, 'ZZZZ');
    w.lsk('R1');
    expect(w.scratchText).toBe('NOT IN DATA BASE');
    key(t, 'CLR');
    expect(w.scratchText).toBe('ZZZZ');
    key(t, 'CLRALL');
  });

  it('enroute waypoint entry, LEGS constraint entry, DELETE and CANCEL MOD', () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    void t.fms.loadRoute('KTEB KBOS');
    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      t.fms.plans.exec();
      t.step();
      key(t, 'FPLN');
      type(t, 'MERIT');
      // First free VIA / TO row of page 1 (rows start at line 3).
      w.lsk('R3');
      expect(w.msg).toBe('');
      key(t, 'EXEC');
      t.step();
      const idents = t.fms.plans.active.legs.map((l) => l.fix?.ident);
      expect(idents).toContain('MERIT');
      // LEGS: altitude / speed constraint on MERIT.
      key(t, 'LEGS');
      const legs = t.fms.plans.displayed.legs;
      const from = Math.max(0, t.fms.plans.displayed.activeLegIndex);
      const line = legs.findIndex((l) => l.fix?.ident === 'MERIT') - from + 1;
      expect(line).toBeGreaterThanOrEqual(1);
      type(t, '250/12000A');
      w.lsk(`R${line}` as never);
      const merit = t.fms.plans.displayed.legs.find((l) => l.fix?.ident === 'MERIT')!;
      expect(merit.altitude).toEqual({ kind: 'atOrAbove', lowerFt: 12000 });
      expect(merit.speed?.kt).toBe(250);
      // CANCEL MOD (L6 while a modification is pending) discards it.
      w.lsk('L6');
      expect(t.fms.plans.pending).toBe(false);
      expect(t.fms.plans.active.legs.find((l) => l.fix?.ident === 'MERIT')!.altitude).toBeUndefined();
      // DELETE key on the waypoint line removes it (MOD) and EXEC.
      key(t, 'DEL');
      expect(w.scratch).toBe('DELETE');
      const idx = t.fms.plans.displayed.legs.findIndex((l) => l.fix?.ident === 'MERIT');
      const line2 = idx - Math.max(0, t.fms.plans.displayed.activeLegIndex) + 1;
      if (idx !== t.fms.plans.displayed.activeLegIndex) {
        w.lsk(`L${line2}` as never);
        key(t, 'EXEC');
        expect(t.fms.plans.active.legs.some((l) => l.fix?.ident === 'MERIT')).toBe(false);
      }
    });
  });

  it('direct-to from the DIR page, PERF INIT cruise altitude, TOLD V-speeds, TUNE entries', async () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    await t.fms.loadRoute('KTEB MERIT KBOS');
    t.fms.plans.exec();
    t.step();
    key(t, 'DIR');
    type(t, 'PUT');
    w.lsk('L1');
    expect(w.pageId).toBe('LEGS');
    key(t, 'EXEC');
    t.step();
    expect(t.fms.plans.active.activeLeg?.fix?.ident).toBe('PUT');
    key(t, 'PERF');
    type(t, 'FL410');
    w.lsk('R1');
    key(t, 'EXEC');
    t.step();
    expect(t.fms.plans.active.cruiseAltFt).toBe(41000);
    type(t, 'FL520');
    w.lsk('R1');
    expect(w.scratchText).toBe('INVALID ENTRY'); // above the 51,000 ft ceiling
    key(t, 'CLRALL');
    w.show('TOLD');
    type(t, '128');
    w.lsk('L1');
    type(t, '134');
    w.lsk('L3');
    expect(t.vars.get(FUSION_VARS.vspd('v1'))).toBe(128);
    expect(t.vars.get(FUSION_VARS.vspd('v2'))).toBe(134);
    key(t, 'TUNE');
    type(t, '12345');
    w.lsk('L1');
    expect(t.vars.get(NAV.comStandby(1))).toBeCloseTo(123.45, 3);
    w.lsk('L1'); // empty scratchpad: transfer
    expect(t.vars.get(NAV.comActive(1))).toBeCloseTo(123.45, 3);
    type(t, '4721');
    w.lsk('R3');
    expect(t.vars.get(NAV.xpdrCode)).toBe(4721);
  });

  it('DEPARTURE page selects a runway and a SID (procedures load on demand)', async () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    await t.fms.loadRoute('KTEB KBOS');
    t.fms.plans.exec();
    key(t, 'DEPARR');
    expect(w.pageId).toBe('DEP');
    // Wait for the procedure file.
    for (let i = 0; i < 40 && t.suite.fmsHost.procedures('KTEB') === undefined; i++) await new Promise((r) => setTimeout(r, 25));
    w.render();
    // Runways listed in sorted order; WENTZ1 serves runway 24 only.
    const rws = [...new Set(t.fms.plans.displayed.origin!.runways.map((r) => r.ident))].sort();
    const k = rws.indexOf('24');
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(5);
    w.lsk(`L${k + 1}` as never);
    expect(t.fms.plans.displayed.departureRunway).toBe('24');
    const procs = t.suite.fmsHost.procedures('KTEB');
    if (procs && procs.sids.length) {
      w.lsk('R1');
      expect(t.fms.plans.displayed.sid).toBeTruthy();
    }
    key(t, 'EXEC');
    expect(t.fms.plans.active.departureRunway).toBeTruthy();
  });

  it('LSK by cursor: ENTER on an FMS window line select hot spot', () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    run(t, 0.2);
    render(t);
    // AFD 3 left half is the pilot's FMS window (IDX page): L2 = FLT PLAN.
    const afd3 = t.suite.afd[2];
    const hs = afd3.hotspots;
    const i = hs.indexOf('L2');
    expect(i).toBeGreaterThanOrEqual(0);
    t.suite.cursor.place(1, 3, hs.x[i] + 5, hs.y[i] + 5);
    t.events.emit(FUSION_EVENTS.ccpEnter(1));
    expect(w.pageId).toBe('FPLN');
  });

  it('APPR with an ILS approach in the plan tunes the LOC and couples NAV 1 (not the FMS path)', async () => {
    const t = setup(42.1, -71.2);
    await t.fms.loadRoute('KJFK KBOS');
    const procs = await db.loadProcedures('KBOS');
    const ils = procs?.approaches.find((a) => a.approachType === 'ILS');
    expect(ils).toBeTruthy();
    const p = t.fms.plans.edit();
    p.setApproach(ils!);
    t.fms.plans.commit();
    t.fms.plans.exec();
    const info = t.suite.approachInfo();
    expect(info).not.toBeNull();
    const log = recordEvents(t.events);
    t.events.emit(FUSION_EVENTS.fcp('appr'));
    expect(t.vars.get(NAV.activeFreq(1))).toBeCloseTo(info!.freqMhz, 2);
    expect(t.vars.get(FUSION_VARS.navSource(1))).toBe(NavSrc.Nav1);
    expect(t.vars.get('ap.nav_source')).toBe(1);
    expect(t.vars.get(AP.selCourse(1))).toBe(info!.courseMag);
    expect(log.some((e) => e.name === 'ap.apr')).toBe(true);
  });

  it('FMS function keys bring up the FMS window when the side has none', () => {
    const t = setup();
    t.suite.layout.select(3, 'L', Win.Chkl);
    expect(t.suite.sideShows(1, Win.Fms)).toBeNull();
    key(t, 'LEGS');
    expect(t.suite.sideShows(1, Win.Fms)).not.toBeNull();
    expect(t.suite.fmsWin[0].pageId).toBe('LEGS');
  });

  it('graphical flight planning: cursor on a map waypoint, DIRECT-TO from its menu', async () => {
    const t = setup(41.25, -73.45); // near MERIT, heading north-east
    t.vars.set('gear.air_ground', 0);
    for (const n of [1, 2]) {
      t.vars.set(ADC.heading(n), 60);
      t.vars.set(ADC.headingTrue(n), 47);
    }
    await t.fms.loadRoute('KTEB MERIT PUT KBOS');
    t.fms.plans.exec();
    t.step();
    render(t);
    render(t);
    const afd1 = t.suite.afd[0];
    const hs = afd1.hotspots;
    let spot = -1;
    let ident = '';
    for (let i = 0; i < hs.n; i++) {
      if (!hs.id[i].startsWith('wpt:')) continue;
      const leg = t.fms.plans.displayed.legs[Number(hs.id[i].slice(4))];
      if (leg.fix?.ident === 'MERIT' || leg.fix?.ident === 'PUT') {
        spot = i;
        ident = leg.fix.ident;
        break;
      }
    }
    expect(spot).toBeGreaterThanOrEqual(0);
    t.suite.cursor.place(1, 1, hs.x[spot] + 12, hs.y[spot] + 12);
    t.events.emit(FUSION_EVENTS.ccpEnter(1));
    render(t);
    const d = hs.indexOf('wptm:dir');
    expect(d).toBeGreaterThanOrEqual(0);
    t.suite.cursor.place(1, 1, hs.x[d] + 5, hs.y[d] + 5);
    t.events.emit(FUSION_EVENTS.ccpEnter(1));
    expect(t.fms.plans.pending).toBe(true);
    key(t, 'EXEC');
    expect(t.fms.plans.active.activeLeg?.fix?.ident).toBe(ident);
  });
});
