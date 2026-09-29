import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { AP, NAV } from '../../../src/core/vars';
import { DisplayControllerLogic, DC_MENU, TRS_RATINGS } from '../../../src/avionics/honeywell-epic/logic/controller';
import { WindowManager } from '../../../src/avionics/honeywell-epic/logic/windows';
import { DEFAULT_EVENTS, DEFAULT_SENSORS } from '../../../src/avionics/honeywell-epic/config';
import { BrgSrc, EPIC_EVENTS, EPIC_VARS, HsiMode, MapOverlay, NavSrc, Win } from '../../../src/avionics/honeywell-epic/vars';
import { recordEvents } from './helpers';

function setup() {
  const vars = new SimVars();
  const events = new EventBus();
  const windows = new WindowManager(vars, { duIds: ['d1', 'd2', 'd3', 'd4'] });
  const dc = new DisplayControllerLogic(vars, events, { sensors: DEFAULT_SENSORS, events: DEFAULT_EVENTS, windows, checklistCount: () => 3 });
  const log = recordEvents(events);
  return { vars, events, windows, dc, log };
}

describe('Display controller (SMC / TSC display control)', () => {
  it('starts on the standby instrument; any LSK opens the menu; function keys select pages', () => {
    const t = setup();
    expect(t.vars.get(EPIC_VARS.smcStandby(1))).toBe(1);
    t.events.emit(EPIC_EVENTS.dcLsk(1), 3);
    expect(t.vars.get(EPIC_VARS.smcStandby(1))).toBe(0);
    expect(t.dc.currentPage(1)).toBe('MENU');
    const lines = t.dc.render(1);
    expect(lines.map((l) => l.value)).toEqual(['PFD', 'MAP', 'SENSOR', 'FLT REF', 'TEST', 'CHKLST', '1/6-2/3', 'TRS', 'NAV', 'HUD']);
    for (let k = 1; k <= DC_MENU.length; k++) {
      t.dc.page(1, 'MENU');
      t.dc.lsk(1, k);
      expect(t.dc.currentPage(1)).toBe(DC_MENU[k - 1]);
    }
    t.events.emit(EPIC_EVENTS.dcPage(2), 'MAP');
    expect(t.dc.currentPage(2)).toBe('MAP');
  });

  it('PFD page: FPV, SVS, HSI format, bearing pointers, minimums, NAV SRC', () => {
    const t = setup();
    t.dc.page(1, 'PFD');
    const fpv = t.vars.get(EPIC_VARS.fpv(1));
    t.dc.lsk(1, 1);
    expect(t.vars.get(EPIC_VARS.fpv(1))).toBe(fpv ? 0 : 1);
    t.dc.lsk(1, 3);
    expect(t.vars.get(EPIC_VARS.hsiMode(1))).toBe(HsiMode.Map);
    t.dc.lsk(1, 3);
    expect(t.vars.get(EPIC_VARS.hsiMode(1))).toBe(HsiMode.Rose);
    t.dc.lsk(1, 4);
    expect(t.vars.get(EPIC_VARS.brg1(1))).toBe(BrgSrc.Adf1);
    // Minimums: select, SET +3 -> +30 ft, written to the AFCS minimums too.
    t.dc.lsk(1, 7);
    t.dc.set(1, 3);
    expect(t.vars.get(EPIC_VARS.minsFt(1))).toBe(230);
    expect(t.vars.get(AP.minimums(1))).toBe(230);
    t.dc.lsk(1, 6);
    expect(t.vars.get(AP.minimumsIsRadio(1))).toBe(0);
    t.dc.lsk(1, 9);
    expect(t.vars.get(EPIC_VARS.navSrc(1))).toBe(NavSrc.Nav1);
    t.dc.lsk(1, 9);
    t.dc.lsk(1, 9);
    expect(t.vars.get(EPIC_VARS.navSrc(1))).toBe(NavSrc.Fms);
  });

  it('MAP page toggles layers and the SET knob steps the range', () => {
    const t = setup();
    t.dc.page(2, 'MAP');
    t.dc.lsk(2, 4);
    expect(t.vars.get(EPIC_VARS.mapOverlay(2))).toBe(MapOverlay.Weather);
    t.dc.lsk(2, 1);
    t.dc.set(2, 1);
    expect(t.vars.get(EPIC_VARS.mapRange(2))).toBe(25);
    t.events.emit(EPIC_EVENTS.dcSetDec(2), 1);
    expect(t.vars.get(EPIC_VARS.mapRange(2))).toBe(10);
  });

  it('1/6-2/3 page puts synoptics on the side MFD', () => {
    const t = setup();
    t.dc.page(1, 'SYS');
    t.dc.lsk(1, 5); // 4th synoptic in the first list (Hydraulics) into the 2/3 window
    expect(t.windows.selection(2).main).toBe(Win.SynHydraulics);
    t.dc.lsk(1, 1); // target -> upper 1/6
    t.dc.lsk(1, 6); // Fuel
    expect(t.windows.selection(2).upper).toBe(Win.SynFuel);
    t.dc.page(2, 'SYS');
    t.dc.lsk(2, 1);
    t.dc.lsk(2, 1); // lower 1/6
    t.dc.lsk(2, 2); // Summary
    expect(t.windows.selection(3).lower).toBe(Win.SynSummary);
  });

  it('TRS emits the thrust rating; TEST starts the tests; NAV tunes the receiver', () => {
    const t = setup();
    t.dc.page(1, 'TRS');
    t.dc.lsk(1, 3);
    expect(t.log.some((e) => e.name === 'fadec.rating' && e.payload === TRS_RATINGS[2])).toBe(true);
    t.dc.page(1, 'TEST');
    t.dc.lsk(1, 2);
    t.dc.update(0.1);
    expect(t.vars.get(EPIC_VARS.testRa(1))).toBe(1);
    t.dc.lsk(1, 6);
    expect(t.log.some((e) => e.name === 'taws.test')).toBe(true);
    t.dc.lsk(1, 3);
    t.dc.update(1);
    expect(t.vars.get('epic.test.stall1')).toBe(1);
    t.dc.update(4);
    expect(t.vars.get('epic.test.stall2')).toBe(1);
    t.dc.page(1, 'NAV');
    t.vars.set(NAV.activeFreq(1), 110.3);
    t.dc.lsk(1, 6);
    t.dc.set(1, 2);
    expect(t.vars.get(NAV.activeFreq(1))).toBeCloseTo(110.4, 3);
  });

  it('returns to the standby instrument after 30 s without input', () => {
    const t = setup();
    t.dc.page(1, 'PFD');
    t.dc.update(20);
    expect(t.vars.get(EPIC_VARS.smcStandby(1))).toBe(0);
    t.dc.update(11);
    expect(t.vars.get(EPIC_VARS.smcStandby(1))).toBe(1);
  });

  it('CHKLST page selects lists and places the checklist window', () => {
    const t = setup();
    t.dc.page(1, 'CHKLST');
    t.dc.lsk(1, 3);
    expect(t.vars.get(EPIC_VARS.eclList)).toBe(1);
    t.dc.lsk(1, 2);
    expect(t.windows.selection(2).main).toBe(Win.Checklist);
    t.dc.lsk(1, 5);
    expect(t.vars.get(EPIC_VARS.eclList)).toBe(-1);
  });
});
