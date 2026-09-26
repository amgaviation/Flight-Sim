import { beforeAll, describe, expect, it } from 'vitest';
import { AP, NAV } from '../../../src/core/vars';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { GtcController } from '../../../src/avionics/garmin-g3000/gtc/GtcController';
import { homeFactory, messagesFactory } from '../../../src/avionics/garmin-g3000/gtc/pages/home';
import { FlightPlanPage } from '../../../src/avionics/garmin-g3000/gtc/pages/fpl';
import { ProcSelectPage, DirectToPage } from '../../../src/avionics/garmin-g3000/gtc/pages/proc';
import type { ListView } from '../../../src/avionics/garmin-g3000/gtc/ui';
import { G3K, PANE_CONTENT } from '../../../src/avionics/garmin-g3000/vars';
import { bar, keys, labels, loadDb, makeRig, tap, GTC_RECT, type Rig } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadDb();
}, 90000);

function setup(): { rig: Rig; gtc: GtcController } {
  const rig = makeRig(db);
  rig.place(40.85, -74.06, 3000, 190, 160);
  rig.suite.system.forceBooted();
  rig.step(0.2);
  const gtc = new GtcController(rig.suite.system, rig.suite.cfg.gtcs[0], homeFactory);
  gtc.messagesPage = messagesFactory;
  return { rig, gtc };
}

describe('GTC NAV/COM', () => {
  it('COM standby keypad, XFER, MIC / MON', () => {
    const { rig, gtc } = setup();
    gtc.setMode('NAVCOM');
    expect(gtc.page.title).toBe('NAV/COM Home');
    tap(gtc, 'STBY'); // COM1 standby
    expect(gtc.page.title).toBe('COM1 Standby');
    keys(gtc, '12345');
    bar(gtc, 'Enter');
    expect(rig.vars.get(NAV.comStandby(1))).toBeCloseTo(123.45, 4);
    expect(gtc.page.title).toBe('NAV/COM Home');
    tap(gtc, 'STBY');
    keys(gtc, '1');
    bar(gtc, 'Enter'); // invalid: stays open
    expect(gtc.page.title).toBe('COM1 Standby');
    expect(gtc.toast).toBe('Invalid entry');
    tap(gtc, 'XFER');
    expect(rig.vars.get(NAV.comActive(1))).toBeCloseTo(123.45, 4);
    gtc.back();
    tap(gtc, 'COM2 MIC');
    expect(rig.vars.get(G3K.micSelect(1))).toBe(2);
  });

  it('transponder code, VFR, modes and IDENT', () => {
    const { rig, gtc } = setup();
    gtc.setMode('NAVCOM');
    tap(gtc, 'XPDR');
    keys(gtc, '7700');
    bar(gtc, 'Enter');
    expect(rig.vars.get(NAV.xpdrCode)).toBe(7700);
    keys(gtc, '78'); // 8 is not an octal digit
    expect((gtc.page as unknown as { buf: string }).buf).toBe('7');
    tap(gtc, 'VFR');
    expect(rig.vars.get(NAV.xpdrCode)).toBe(1200);
    tap(gtc, 'STBY');
    expect(rig.vars.get(NAV.xpdrMode)).toBe(1);
    tap(gtc, 'ALT');
    tap(gtc, 'IDENT');
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(1);
  });

  it('dual knob tunes the selected COM; push toggles the radio, hold swaps', () => {
    const { rig, gtc } = setup();
    gtc.setMode('NAVCOM');
    rig.vars.set(NAV.comStandby(1), 118.0);
    gtc.knob('upperInner', 2);
    expect(rig.vars.get(NAV.comStandby(1))).toBeCloseTo(118.05, 4);
    gtc.knob('upperOuter', 1);
    expect(rig.vars.get(NAV.comStandby(1))).toBeCloseTo(119.05, 4);
    gtc.knob('upperPush', 1);
    expect(gtc.comSel).toBe(2);
    rig.vars.set(NAV.comStandby(2), 121.5);
    gtc.knob('upperHold', 1);
    expect(rig.vars.get(NAV.comActive(2))).toBeCloseTo(121.5, 4);
  });
});

describe('GTC MFD', () => {
  it('Home puts pages on the controlled pane and opens their settings on the second touch', () => {
    const { rig, gtc } = setup();
    const sys = rig.suite.system;
    expect(gtc.mode).toBe('MFD');
    const pane = sys.gtcPane(gtc.g)!;
    tap(gtc, 'Traffic');
    expect(sys.paneContent(pane)).toBe(PANE_CONTENT.traffic);
    tap(gtc, 'Traffic');
    expect(gtc.page.title).toBe('Traffic Settings');
    gtc.homePage();
    tap(gtc, 'Map');
    expect(sys.paneContent(pane)).toBe(PANE_CONTENT.navMap);
    // Knobs: range and pane selection.
    const r0 = sys.paneRange(pane);
    gtc.knob('lower', 1);
    expect(sys.paneRange(pane)).toBeGreaterThan(r0);
    gtc.knob('lowerPush', 1);
    expect(sys.pointers[pane].active).toBe(true);
    gtc.joystick(1, 0);
    expect(sys.pointers[pane].dx).toBeGreaterThan(0);
  });

  it('flight plan: add origin, enroute waypoint via the keypad, destination, waypoint options', () => {
    const { rig, gtc } = setup();
    const fpl = rig.suite.system.fpl!;
    tap(gtc, 'Flight Plan');
    const page = gtc.page as FlightPlanPage;
    page.update(0);
    page.ensureBuilt(GTC_RECT);
    const list = page.widgets.find((w) => (w as ListView).o?.rowH !== undefined) as ListView;
    const rows = (): { text: string; sub: string }[] => (page as unknown as { rows: { text: string; sub: string }[] }).rows;
    const tapRow = (text: string): void => {
      page.update(0);
      const i = rows().findIndex((r) => r.text === text);
      if (i < 0) throw new Error(`row ${text} not in ${rows().map((r) => r.text).join(',')}`);
      list.o.onRow!(i, GTC_RECT.x + 20);
    };
    tapRow('Add Origin');
    keys(gtc, 'KTEB');
    bar(gtc, 'Enter');
    expect(fpl.plan.origin?.icao).toBe('KTEB');
    tapRow('Add Destination');
    keys(gtc, 'KBOS');
    bar(gtc, 'Enter');
    expect(fpl.plan.destination?.icao).toBe('KBOS');
    tapRow('Add Enroute Waypoint');
    keys(gtc, 'MERIT');
    bar(gtc, 'Enter');
    expect(fpl.plan.legs.some((l) => l.fix?.ident === 'MERIT')).toBe(true);
    // Waypoint options: altitude constraint via the keypad.
    tapRow('MERIT');
    expect(labels(gtc)).toContain('Insert Before');
    tap(gtc, 'Altitude Constraint');
    tap(gtc, 'AT or ABOVE');
    keys(gtc, '11000');
    bar(gtc, 'Enter');
    const merit = fpl.plan.legs.find((l) => l.fix?.ident === 'MERIT')!;
    expect(merit.altitude?.kind).toBe('atOrAbove');
    expect(merit.altitude?.lowerFt).toBe(11000);
    // Remove it again.
    tapRow('MERIT');
    tap(gtc, 'Remove');
    expect(fpl.plan.legs.some((l) => l.fix?.ident === 'MERIT')).toBe(false);
  });

  it('PROC: load and activate an approach; Direct-To a flight plan waypoint', async () => {
    const { rig, gtc } = setup();
    const sys = rig.suite.system;
    const fpl = sys.fpl!;
    fpl.setOrigin('KTEB');
    fpl.setDestination('KBOS');
    const bos = await fpl.loadProcedures('KBOS');
    tap(gtc, 'PROC');
    tap(gtc, 'Approach');
    const ps = gtc.page as ProcSelectPage;
    expect(ps).toBeInstanceOf(ProcSelectPage);
    const pane = sys.gtcPane(gtc.g)!;
    expect(sys.paneContent(pane)).toBe(PANE_CONTENT.procedure);
    tap(gtc, 'Approach'); // procedure list
    const ils = bos!.approaches.find((a) => a.approachType === 'ILS')!;
    const lp = gtc.page as unknown as { items: () => { label: string; sub?: string }[]; onSelect: (i: number, it: unknown) => void };
    const i = lp.items().findIndex((x) => x.sub === ils.ident);
    lp.onSelect(i, lp.items()[i]);
    expect(ps.proc).toBe(ils.ident);
    tap(gtc, 'Activate Vectors to Final');
    expect(fpl.plan.approachProcedure?.ident).toBe(ils.ident);
    // The preview pane content is restored when the selection page closes.
    expect(sys.paneContent(pane)).not.toBe(PANE_CONTENT.procedure);
    // Direct-To the destination from the flight plan list.
    gtc.homePage();
    tap(gtc, 'Direct To');
    const dto = gtc.page as DirectToPage;
    const k = fpl.plan.legs.findIndex((l) => l.segment === 'approach' && !!l.fix && l.fix.kind !== 'airport');
    dto.legIndex = k;
    dto.target = fpl.plan.legs[k].fix!;
    bar(gtc, 'Activate');
    expect(fpl.plan.activeLegIndex).toBeGreaterThanOrEqual(0);
    expect(fpl.plan.legs[fpl.plan.activeLegIndex].type).toBe('DF');
  });
});

describe('GTC PFD', () => {
  it('speed bugs, minimums, nav source and Split / Full via the button bar logic', () => {
    const { rig, gtc } = setup();
    const sys = rig.suite.system;
    gtc.setMode('PFD');
    expect(gtc.page.title).toBe('PFD Home');
    tap(gtc, 'Nav Source');
    expect(sys.navSource(1)).toBe(1);
    tap(gtc, 'Speed Bugs');
    tap(gtc, 'Takeoff On');
    expect(sys.vspeeds.on('V1')).toBe(true);
    tap(gtc, '100KT'); // V1 value
    keys(gtc, '98');
    bar(gtc, 'Enter');
    expect(sys.vspeeds.value('V1')).toBe(98);
    gtc.homePage();
    tap(gtc, 'Minimums');
    tap(gtc, 'Baro');
    tap(gtc, 'Minimums');
    keys(gtc, '480');
    bar(gtc, 'Enter');
    expect(rig.vars.get(AP.minimums(1))).toBe(480);
    gtc.homePage();
    tap(gtc, 'Timers');
    tap(gtc, 'Start');
    rig.step(2);
    expect(sys.timer.seconds).toBeGreaterThan(1.5);
    gtc.back();
    // MSG button opens the messages and marks them read.
    sys.messages.set('x', 'TEST - message', true);
    gtc.showMessages();
    expect(gtc.page.title).toBe('Messages');
    expect(sys.messages.unread).toBe(0);
  });
});
