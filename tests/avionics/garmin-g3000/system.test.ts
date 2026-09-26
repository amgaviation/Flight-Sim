import { beforeAll, describe, expect, it } from 'vitest';
import { ADC, AP, NAV } from '../../../src/core/vars';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { Afcs, AFCS_GFC700_G3000 } from '../../../src/systems/autopilot';
import { G3K, G3K_EVENTS, GTC_MODE, MINS_MODE, NAV_SOURCE, PANE_CONTENT } from '../../../src/avionics/garmin-g3000/vars';
import { G3000System } from '../../../src/avionics/garmin-g3000/state/System';
import { SoftkeyController, pfdMenus, SOFTKEY_REVERT_S } from '../../../src/avionics/garmin-g3000/gdu/softkeys';
import { g3000Controls } from '../../../src/avionics/garmin-g3000/controls';
import { resolveConfig } from '../../../src/avionics/garmin-g3000/config';
import { G5000_LONGITUDE_LAYOUT } from '../../../src/avionics/garmin-g3000/presets';
import { addSystem, loadDb, makeRig } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadDb();
}, 90000);

describe('power, boot and reversionary modes', () => {
  it('units boot after power-up and follow their power binding', () => {
    const rig = makeRig(db, { power: { pfd1: 'elec.avn1', mfd: 'elec.avn1', pfd2: 'elec.avn2' }, bootS: { gdu: 10, gtc: 5 } });
    const { vars, suite } = rig;
    const sys = suite.system;
    rig.place(40.85, -74.06, 10, 190, 0);
    rig.step(1);
    expect(vars.get('display.pfd1.power')).toBe(0);
    vars.set('elec.avn1', 1);
    rig.step(2);
    expect(sys.unitBooting('pfd1')).toBe(true);
    expect(vars.get(G3K.unitBooting('pfd1'))).toBe(1);
    rig.step(9);
    expect(sys.unitUp('pfd1')).toBe(true);
    expect(sys.unitUp('pfd2')).toBe(false);
    // The MFD database page needs acknowledging after each power-up.
    expect(vars.get(G3K.mfdSplashAck)).toBe(0);
  });

  it('reversion is manual by default (PG §1.4)', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    rig.place(40.85, -74.06, 5000, 190);
    sys.forceBooted();
    rig.vars.set('fail.g3k.pfd1', 1);
    rig.step(0.2);
    expect(sys.isReversionary('mfd')).toBe(false);
    rig.vars.set(G3K.reversionSwitch('mfd'), 1);
    rig.step(0.2);
    expect(sys.isReversionary('mfd')).toBe(true);
    expect(rig.vars.get(G3K.pfdSplit(2))).toBe(1);
  });

  it('PFD1 failure with autoReversion: MFD reversionary and PFD2 split; manual switches', () => {
    const rig = makeRig(db, { autoReversion: true });
    const { vars, suite } = rig;
    const sys = suite.system;
    rig.place(40.85, -74.06, 5000, 190);
    sys.forceBooted();
    rig.step(0.2);
    expect(sys.isReversionary('mfd')).toBe(false);
    vars.set('fail.g3k.pfd1', 1);
    rig.step(0.2);
    expect(sys.isReversionary('mfd')).toBe(true);
    expect(vars.get(G3K.pfdSplit(2))).toBe(1);
    expect(sys.paneVisible('mfd1')).toBe(false);
    expect(sys.paneVisible('pfd2')).toBe(true);
    vars.set('fail.g3k.pfd1', 0);
    rig.step(20);
    expect(sys.isReversionary('mfd')).toBe(false);
    vars.set(G3K.reversionSwitch('pfd1'), 1);
    rig.step(0.2);
    expect(sys.isReversionary('pfd1')).toBe(true);
    expect(sys.paneVisible('pfd1')).toBe(false);
  });
});

describe('panes and GTC control modes', () => {
  it('pane contents, MFD half / full, GTC pane cycling and exclusive MFD control of shared panes', () => {
    const rig = makeRig(db, { ...G5000_LONGITUDE_LAYOUT, aircraftId: 'lon' });
    const sys = rig.suite.system;
    sys.forceBooted();
    rig.step(0.1);
    expect(sys.paneContent('mfd2')).toBe(PANE_CONTENT.flightPlan);
    sys.setPaneContent('mfd1', PANE_CONTENT.synoptics, 0);
    expect(sys.setMfdHalf(false)).toBe(false); // synoptics are half-size only
    sys.setPaneContent('mfd1', PANE_CONTENT.navMap);
    expect(sys.setMfdHalf(false)).toBe(true);
    expect(sys.paneVisible('mfd2')).toBe(false);
    sys.setMfdHalf(true);
    const gtc2 = sys.cfg.gtcs.find((g) => g.id === 'gtc2')!;
    expect(sys.gtcPane(gtc2)).toBe('mfd1');
    sys.setPfdSplit(1, true);
    sys.cycleGtcPane(gtc2, 1);
    expect(sys.gtcPane(gtc2)).toBe('pfd1');
    expect(sys.paneOwner('pfd1')?.id).toBe('gtc2');
    // Setting a split PFD back to full moves the GTC to its next visible pane.
    sys.setPfdSplit(1, false);
    expect(sys.gtcPane(gtc2)).toBe('mfd1');
  });

  it('only one GTC controls shared panes in MFD mode', () => {
    const rig = makeRig(db, { gtcs: [
      { id: 'gtc1', model: 'GTC580', side: 1, modes: ['MFD', 'PFD', 'NAVCOM'], panes: ['mfd1', 'mfd2'] },
      { id: 'gtc2', model: 'GTC580', side: 2, modes: ['NAVCOM', 'MFD', 'PFD'], panes: ['mfd1', 'mfd2'] },
    ] });
    const sys = rig.suite.system;
    const [g1, g2] = sys.cfg.gtcs;
    expect(rig.vars.get(G3K.gtcMode('gtc1'))).toBe(GTC_MODE.mfd);
    sys.setGtcMode(g2, 'MFD');
    expect(rig.vars.get(G3K.gtcMode('gtc2'))).toBe(GTC_MODE.mfd);
    expect(rig.vars.get(G3K.gtcMode('gtc1'))).toBe(GTC_MODE.navcom);
    void g1;
  });
});

describe('PFD settings and knobs', () => {
  it('nav source and bearing pointer cycles', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    expect(sys.navSource(1)).toBe(NAV_SOURCE.fms);
    sys.cycleNavSource(1);
    expect(sys.navSource(1)).toBe(NAV_SOURCE.nav1);
    sys.cycleNavSource(1);
    sys.cycleNavSource(1);
    expect(sys.navSource(1)).toBe(NAV_SOURCE.fms);
    sys.cycleBearing(1, 1);
    expect(rig.vars.get(G3K.brg1Source(1))).toBe(1);
  });

  it('baro knob (synced), STD with preselect', () => {
    const rig = makeRig(db);
    const { vars, events } = rig;
    vars.set(ADC.baroSetting(1), 29.92);
    vars.set(ADC.baroSetting(2), 29.92);
    events.emit(G3K_EVENTS.baroTurn(1), 5);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.97, 4);
    expect(vars.get(ADC.baroSetting(2))).toBeCloseTo(29.97, 4);
    events.emit(G3K_EVENTS.baroPush(1));
    expect(vars.get(ADC.baroStd(1))).toBe(1);
    expect(vars.get(ADC.baroStd(2))).toBe(1);
    events.emit(`${G3K_EVENTS.baroTurn(2)}_dec`, 2);
    expect(vars.get(G3K.baroPreselect(2))).toBeCloseTo(29.95, 4);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.97, 4);
    events.emit(G3K_EVENTS.baroPush(1));
    expect(vars.get(ADC.baroStd(1))).toBe(0);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.95, 4);
  });

  it('heading, altitude, course and minimums knobs', () => {
    const rig = makeRig(db);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    vars.set(AP.selHeading, 358);
    events.emit(`${G3K_EVENTS.hdgTurn}_inc`, 5);
    expect(vars.get(AP.selHeading)).toBe(3);
    vars.set(AP.selAltitude, 10000);
    events.emit(G3K_EVENTS.altTurnInner, 3);
    expect(vars.get(AP.selAltitude)).toBe(10300);
    events.emit(G3K_EVENTS.altTurnOuter, -2);
    expect(vars.get(AP.selAltitude)).toBe(8000);
    vars.set('fms.approach_active', 1);
    events.emit(G3K_EVENTS.altTurnInner, 1);
    expect(vars.get(AP.selAltitude)).toBe(8010);
    // CRS on a VOR source changes the receiver OBS and the side's selected course.
    sys.setNavSource(1, NAV_SOURCE.nav1);
    vars.set(NAV.obs(1), 90);
    events.emit(G3K_EVENTS.crsTurn(1), 10);
    expect(vars.get(NAV.obs(1))).toBe(100);
    expect(vars.get(AP.selCourse(1))).toBe(100);
    // Minimums knob: first click selects BARO, push cycles to RA and off.
    events.emit(G3K_EVENTS.minsTurn(1), 3);
    expect(sys.mins.mode).toBe(MINS_MODE.baro);
    expect(sys.mins.valueFt).toBe(230);
    events.emit(G3K_EVENTS.minsPush(1));
    expect(sys.mins.mode).toBe(MINS_MODE.radio);
    events.emit(G3K_EVENTS.minsPush(1));
    expect(sys.mins.mode).toBe(MINS_MODE.off);
  });

  it('transponder IDENT lasts 18 s; COM swap', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.forceBooted();
    sys.setXpdrMode(3);
    sys.ident();
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(1);
    rig.step(17.5);
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(1);
    rig.step(1);
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(0);
    rig.vars.set(NAV.comActive(1), 118.1);
    rig.vars.set(NAV.comStandby(1), 121.5);
    sys.swapCom(1);
    expect(rig.vars.get(NAV.comActive(1))).toBe(121.5);
  });
});

describe('GMC 710 and the ILS rule', () => {
  it('GMC keys drive the AFCS and its lights; knobs are dead without GMC power', () => {
    const rig = makeRig(db, { gmcPower: 'elec.gmc' });
    const afcs = new Afcs({ vars: rig.vars, events: rig.events }, AFCS_GFC700_G3000);
    addSystem(rig, afcs);
    rig.place(40.9, -74.0, 5000, 90, 200);
    rig.vars.set('elec.gmc', 1);
    rig.step(0.5);
    rig.events.emit(G3K_EVENTS.gmcKey('HDG'));
    rig.step(0.2);
    expect(rig.vars.getString(AP.lateralActive)).toBe('HDG');
    expect(rig.vars.get(G3K.gmcLight('HDG'))).toBe(1);
    expect(rig.vars.get(G3K.gmcLight('xfr_l'))).toBe(1);
    rig.vars.set('elec.gmc', 0);
    rig.step(0.2);
    expect(rig.vars.get(G3K.gmcLight('HDG'))).toBe(0);
    rig.vars.set(AP.selHeading, 90);
    rig.events.emit(G3K_EVENTS.hdgTurn, 10);
    expect(rig.vars.get(AP.selHeading)).toBe(90);
  });

  it('APR with FMS selected and an ILS loaded arms LOC / GS on the receiver, CDI stays FMS until capture', async () => {
    const rig = makeRig(db);
    const afcs = new Afcs({ vars: rig.vars, events: rig.events }, AFCS_GFC700_G3000);
    addSystem(rig, afcs);
    const sys = rig.suite.system;
    sys.forceBooted();
    const fpl = sys.fpl!;
    fpl.setOrigin('KJFK');
    fpl.setDestination('KBOS');
    const bos = await fpl.loadProcedures('KBOS');
    const ils = bos!.approaches.find((a) => a.approachType === 'ILS' && a.runways.includes('04R')) ?? bos!.approaches.find((a) => a.approachType === 'ILS')!;
    fpl.loadApproach('KBOS', ils.ident, undefined, 'vtf');
    // 10 nm out on the extended centreline, established.
    const rw = db.airport('KBOS')!.runways.find((r) => r.ident === ils.runways[0])!;
    const { destinationPoint } = await import('../../../src/core/geo');
    const p = destinationPoint(rw.lat, rw.lon, rw.headingTrue + 180, 10);
    rig.place(p.lat, p.lon, 3000, Math.round(rw.headingTrue + 14), 160);
    rig.step(2);
    expect(sys.navSource(1)).toBe(NAV_SOURCE.fms);
    expect(rig.vars.get(NAV.isLoc(1))).toBe(1);
    rig.events.emit('ap.fd');
    rig.events.emit(G3K_EVENTS.gmcKey('APR'));
    rig.step(0.5);
    expect(rig.vars.get('ap.nav_source')).toBe(1);
    const lat = rig.vars.getString(AP.lateralActive) + '/' + rig.vars.getString(AP.lateralArmed);
    expect(lat).toMatch(/LOC/);
    expect(rig.vars.getString(AP.verticalArmed) + rig.vars.getString(AP.verticalActive)).toMatch(/GS/);
  });
});

describe('softkeys', () => {
  it('sub-levels, Back, 45 s inactivity revert and the Active NAV key', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.forceBooted();
    const sk = new SoftkeyController(pfdMenus(sys, 1, { casScroll: () => undefined, casOnThisDisplay: () => false }));
    const idx = (label: string): number => sk.keys().findIndex((k) => k && (typeof k.label === 'function' ? k.label() : k.label) === label);
    const nav = idx('Active NAV');
    expect(nav).toBeGreaterThanOrEqual(0);
    sk.press(nav);
    expect(sys.navSource(1)).toBe(NAV_SOURCE.nav1);
    sk.press(idx('PFD Settings'));
    expect(sk.depth).toBe(1);
    sk.press(idx('Back'));
    expect(sk.depth).toBe(0);
    sk.press(idx('PFD Settings'));
    sk.update(SOFTKEY_REVERT_S + 0.1);
    expect(sk.depth).toBe(0);
  });
});

describe('controls descriptors', () => {
  it('lists every GMC key, knob, softkey and GTC control with events', () => {
    const cfg = resolveConfig({ ...G5000_LONGITUDE_LAYOUT, aircraftId: 'lon' });
    const all = g3000Controls(cfg);
    expect(all.find((c) => c.id === 'gmc.key.apr')?.press).toBe('g3k.gmc.key_apr');
    expect(all.find((c) => c.id === 'gmc.key.at')).toBeTruthy();
    expect(all.find((c) => c.id === 'gmc.alt')?.innerIncEvent).toBe('g3k.gmc.alt_inner_inc');
    expect(all.filter((c) => c.unit === 'pfd1' && c.kind === 'button').length).toBe(12);
    expect(all.find((c) => c.id === 'gtc4.upper')?.hold).toBe('g3k.gtc4.upper_hold');
    expect(all.find((c) => c.id === 'rev.mfd')?.var).toBe('g3k.rev_sw.mfd');
    void G3000System;
  });
});
