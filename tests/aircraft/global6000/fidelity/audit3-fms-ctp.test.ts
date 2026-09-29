/**
 * Global 6000 audit round 3, avionics fixes:
 *  - G3-14: duplicate-ident SELECT WPT page in the Fusion FMS (entering JST
 *    must not silently resolve to the airport KJST via its FAA LID - the
 *    Collins FMS presents a duplicate-ident select list).
 *  - G3-11: TUNE VHF / NORM / DSPL reversion inhibits CTP radio tuning
 *    (GX PTG 16) instead of being state-only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GPS, NAV } from '../../../../src/core/vars';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { Fms } from '../../../../src/nav/fms/Fms';
import { FUSION_EVENTS } from '../../../../src/avionics/collins-fusion/vars';
import type { Waypoint } from '../../../../src/nav/types';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { makeSuite, type TestSuite } from '../../../avionics/collins-fusion/helpers';
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';

vi.setConfig({ testTimeout: 120000 });

const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => {
  await db.load();
}, 60_000);

function setup() {
  const vars = new SimVars();
  const events = new EventBus();
  vars.set(GPS.valid, 1);
  vars.set(GPS.lat, 40.85);
  vars.set(GPS.lon, -74.06);
  vars.set(GPS.gs, 0);
  vars.set(GPS.magVar, -13);
  vars.set('gear.air_ground', 1);
  const fms = new Fms({ vars, events, nav: db }, { style: 'boeing', engineCount: 2 });
  const t = makeSuite({ tuneReversionVar: V.tuneSrc }, fms, db, vars, events);
  t.suite.applyState('ready_to_taxi');
  return { ...t, fms };
}

function type(t: TestSuite, s: string): void {
  for (const ch of s) t.events.emit(FUSION_EVENTS.mkpKey(1), ch);
}

describe('G3-14: Fusion FMS duplicate-ident SELECT WPT page', () => {
  it('JST offers the airport, the VOR and the NDB; the VOR is selectable over the airport LID', () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    t.events.emit(FUSION_EVENTS.mkpKey(1), 'FPLN');
    type(t, 'KTEB');
    w.lsk('L1'); // origin
    // Enter JST as the first enroute waypoint (page 1 R3 = the append line on an empty plan).
    type(t, 'JST');
    w.lsk('R3');
    expect(w.pageId).toBe('SEL');
    expect(w.screen.title).toBe('SELECT WPT');
    const st = w.state.sel as { wpts: Waypoint[] };
    const kinds = st.wpts.map((x) => x.kind);
    expect(kinds).toContain('airport');
    expect(kinds).toContain('vor');
    const vorIdx = st.wpts.findIndex((x) => x.kind === 'vor');
    expect(vorIdx).toBeGreaterThanOrEqual(0);
    expect(vorIdx).toBeLessThan(5); // on the first SELECT page
    w.lsk(`L${vorIdx + 1}` as never);
    expect(w.pageId).toBe('FPLN');
    // The MOD plan holds the JST VOR, not the airport KJST.
    const plan = w.host.plan;
    const leg = plan?.legs.find((l) => l.fix?.ident === 'JST');
    expect(leg).toBeTruthy();
    expect(leg?.fix?.kind).toBe('vor');
    expect(plan?.legs.some((l) => l.fix?.ident === 'KJST')).toBe(false);
  });

  it('a unique ident inserts directly without the SELECT page', () => {
    const t = setup();
    const w = t.suite.fmsWin[0];
    t.events.emit(FUSION_EVENTS.mkpKey(1), 'FPLN');
    type(t, 'KTEB');
    w.lsk('L1');
    type(t, 'WAVEY'); // enroute fix, single match
    w.lsk('R3');
    expect(w.pageId).toBe('FPLN');
    expect(w.host.plan?.legs.some((l) => l.fix?.ident === 'WAVEY')).toBe(true);
  });
});

describe('G3-11: TUNE reversion inhibits CTP radio tuning (GX PTG 16)', () => {
  it('VHF / DSPL stops the CTP tuning the NAV standby; NORM restores it', () => {
    const t = setup();
    const v = t.vars;
    t.events.emit(FUSION_EVENTS.ctpKey(1), 'NAV'); // select the NAV line
    const f0 = v.get(NAV.standbyFreq(1));
    // NORM: the TUNE knob steps the standby.
    v.set(V.tuneSrc, 0);
    t.events.emit(FUSION_EVENTS.ctp(1, 'tune_in_inc'), 1);
    const f1 = v.get(NAV.standbyFreq(1));
    expect(f1).not.toBe(f0);
    // VHF reversion: CTP tuning inhibited.
    v.set(V.tuneSrc, 1);
    t.events.emit(FUSION_EVENTS.ctp(1, 'tune_in_inc'), 1);
    expect(v.get(NAV.standbyFreq(1))).toBe(f1);
    // Transfer (TUNE push) inhibited too.
    const act = v.get(NAV.activeFreq(1));
    t.events.emit(FUSION_EVENTS.ctp(1, 'tune_push'));
    expect(v.get(NAV.activeFreq(1))).toBe(act);
    // DSPL: also inhibited.
    v.set(V.tuneSrc, 2);
    t.events.emit(FUSION_EVENTS.ctp(1, 'tune_in_inc'), 1);
    expect(v.get(NAV.standbyFreq(1))).toBe(f1);
    // Back to NORM.
    v.set(V.tuneSrc, 0);
    t.events.emit(FUSION_EVENTS.ctp(1, 'tune_in_inc'), 1);
    expect(v.get(NAV.standbyFreq(1))).not.toBe(f1);
  });
});
