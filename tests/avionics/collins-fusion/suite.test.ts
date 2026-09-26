import { describe, expect, it } from 'vitest';
import { DISPLAY_VARS } from '../../../src/cockpit/types';
import { ADC, NAV } from '../../../src/core/vars';
import { FUSION_EVENTS, FUSION_VARS, SYS_PAGE_COUNT, SysPage, Win } from '../../../src/avionics/collins-fusion/vars';
import { MKP_KEYS } from '../../../src/avionics/collins-fusion/logic/mkp';
import { drawStats, makeSuite, render, run } from './helpers';

describe('Fusion suite composition', () => {
  it('creates 4 AFDs, 2 CTP displays and the IESI; power bindings drive the display power vars', () => {
    const t = makeSuite({ power: { afd: ['bus.a', 1, 1, 1], ctp: [1, 'bus.b'], iesi: 'bus.c' } });
    expect(t.suite.displays).toHaveLength(7);
    expect(t.suite.displays.map((d) => d.id)).toEqual(['fusion.afd1', 'fusion.afd2', 'fusion.afd3', 'fusion.afd4', 'fusion.ctp1', 'fusion.ctp2', 'fusion.iesi']);
    run(t, 0.1);
    expect(t.vars.get(DISPLAY_VARS.power('fusion.afd1'))).toBe(0);
    expect(t.vars.get(DISPLAY_VARS.power('fusion.ctp2'))).toBe(0);
    // AFD 1 unpowered -> PFD 1 reverts to the upper centre display.
    expect(t.vars.get(FUSION_VARS.pfdOn(1))).toBe(2);
    t.vars.set('bus.a', 1);
    run(t, 0.1);
    expect(t.vars.get(DISPLAY_VARS.power('fusion.afd1'))).toBe(1);
    expect(t.vars.get(FUSION_VARS.pfdOn(1))).toBe(1);
  });

  it('AFD failure injection (fail.fusion.afdN) reverts the layout', () => {
    const t = makeSuite();
    run(t, 0.1);
    t.vars.set(FUSION_VARS.afdFail(2), 1);
    run(t, 0.1);
    expect(t.vars.get(FUSION_VARS.afdOperating(2))).toBe(0);
    expect(t.vars.get(FUSION_VARS.eicasOn)).toBe(3);
  });

  it('power-up self test in cold & dark, skipped in running states', () => {
    const t = makeSuite();
    t.suite.applyState('cold_dark');
    render(t);
    expect(t.suite.afd[0].selfTest).toBe(true);
    for (let i = 0; i < 20 * 30; i++) t.suite.afd[0].render(1 / 30);
    expect(t.suite.afd[0].selfTest).toBe(false);
    const u = makeSuite();
    u.suite.applyState('cruise');
    render(u);
    expect(u.suite.afd[0].selfTest).toBe(false);
  });

  it('draws every window content in every slot size without errors', () => {
    const t = makeSuite();
    t.suite.applyState('cruise');
    run(t, 0.2);
    const lay = t.suite.layout;
    const contents = [Win.Map, Win.Fms, Win.Sys, Win.Chkl, Win.Vsd, Win.Chart, Win.Evs];
    const before = drawStats.fillText;
    for (const w of contents) {
      lay.select(3, 'R', w);
      render(t);
      if (w !== Win.Fms && w !== Win.Sys) {
        lay.setHalfSplit(3, 'R', true);
        lay.select(3, 'RU', w);
        render(t);
        lay.setHalfSplit(3, 'R', false);
      }
    }
    for (let p = 0; p < SYS_PAGE_COUNT; p++) {
      t.vars.set(FUSION_VARS.sysPage(1), p);
      t.vars.set(FUSION_VARS.sysPage(2), p);
      render(t);
    }
    lay.setFull(1, true);
    lay.setFull(2, false);
    lay.select(2, 'F', Win.Map);
    render(t);
    expect(drawStats.fillText).toBeGreaterThan(before + 500);
  });

  it('SYSTEMS window: page tabs by cursor ENTER, DATA knob steps pages', () => {
    const t = makeSuite();
    t.suite.applyState('cruise');
    run(t, 0.1);
    render(t);
    const afd2 = t.suite.afd[1];
    const i = afd2.hotspots.indexOf('tab:3');
    expect(i).toBeGreaterThanOrEqual(0);
    t.suite.cursor.place(2, 2, afd2.hotspots.x[i] + 4, afd2.hotspots.y[i] + 4);
    t.events.emit(FUSION_EVENTS.ccpEnter(2));
    expect(t.vars.get(FUSION_VARS.sysPage(2))).toBe(SysPage.Fuel);
    t.events.emit(FUSION_EVENTS.ccpData(2), 1);
    expect(t.vars.get(FUSION_VARS.sysPage(2))).toBe(SysPage.Hyd);
  });

  it('window menu (CCP MENU): select a content, split into quarters', () => {
    const t = makeSuite();
    t.suite.applyState('cruise');
    run(t, 0.1);
    render(t);
    t.suite.cursor.place(2, 3, 700, 300);
    t.events.emit(FUSION_EVENTS.ccpMenu(2));
    const afd3 = t.suite.afd[2];
    expect(afd3.menuOpen).toBe(true);
    const labels = afd3.menuLabels();
    expect(labels).toContain('MAP');
    expect(labels).toContain('SPLIT UPPER / LOWER');
    render(t);
    // Click the MAP entry.
    const k = labels.indexOf('MAP');
    const hi = afd3.hotspots.indexOf(`menu:${k}`);
    t.suite.cursor.place(2, 3, afd3.hotspots.x[hi] + 5, afd3.hotspots.y[hi] + 5);
    t.events.emit(FUSION_EVENTS.ccpEnter(2));
    expect(afd3.menuOpen).toBe(false);
    expect(t.suite.layout.selected(3, 'R')).toBe(Win.Map);
    // BACK closes an open menu.
    t.events.emit(FUSION_EVENTS.ccpMenu(2));
    expect(afd3.menuOpen).toBe(true);
    t.events.emit(FUSION_EVENTS.ccpBack(2));
    expect(afd3.menuOpen).toBe(false);
    // The EICAS window takes no cursor (AIN 2012).
    t.suite.cursor.place(1, 2, 100, 100);
    expect(t.suite.cursor.cursors[0].visible).toBe(false);
  });

  it('MKP: CHK/SYS toggles SYSTEMS / CHECKLIST, CAS-linked checklist, CAS scroll, display memories', () => {
    const t = makeSuite({
      checklists: [
        { title: 'Before Taxi', phase: 'Normal', items: [{ challenge: 'A', response: 'B' }] },
        { title: 'HYD 1 LO PRESS', phase: 'Abnormal', items: [{ challenge: 'PUMP 1B', response: 'ON' }] },
      ],
      casChecklists: { hyd1: 'HYD 1 LO PRESS' },
    });
    t.suite.applyState('cruise');
    run(t, 0.1);
    const key = (k: string, s: 1 | 2 = 2) => t.events.emit(FUSION_EVENTS.mkpKey(s), k);
    expect(MKP_KEYS).toContain('CHKSYS');
    // Copilot owns AFD 2 R (SYSTEMS): CHK/SYS swaps it to the checklist and back.
    key('CHKSYS');
    expect(t.suite.layout.selected(2, 'R')).toBe(Win.Chkl);
    key('CHKSYS');
    expect(t.suite.layout.selected(2, 'R')).toBe(Win.Sys);
    // A linked CAS message opens its checklist.
    t.suite.cas.model.set('hyd1', 'HYD SYS 1 LO PRESS', 'caution', true);
    key('CHKSYS');
    expect(t.suite.checklist.current?.title).toBe('HYD 1 LO PRESS');
    expect(t.suite.layout.selected(2, 'R')).toBe(Win.Chkl);
    // CAS scroll.
    t.suite.cas.rows = 1;
    t.suite.cas.model.set('x', 'X', 'advisory', true);
    key('CAS_DN');
    expect(t.vars.get(FUSION_VARS.casScroll)).toBe(1);
    // Memories: STO 4, change, MEM 4.
    key('STO');
    key('4');
    t.suite.layout.select(3, 'R', Win.Vsd);
    key('MEM');
    key('4');
    expect(t.suite.layout.selected(3, 'R')).toBe(Win.Fms);
  });

  it('transponder IDENT times out after 18 s; chronometer; FPV cage; IESI baro', () => {
    const t = makeSuite();
    run(t, 0.1);
    t.vars.set(NAV.xpdrIdent, 1);
    run(t, 17.5);
    expect(t.vars.get(NAV.xpdrIdent)).toBe(1);
    run(t, 1);
    expect(t.vars.get(NAV.xpdrIdent)).toBe(0);
    t.events.emit(FUSION_EVENTS.chrono(1));
    run(t, 2);
    expect(t.vars.get(FUSION_VARS.chronoS(1))).toBeCloseTo(2, 1);
    t.events.emit(FUSION_EVENTS.chrono(1), 'reset');
    expect(t.vars.get(FUSION_VARS.chronoS(1))).toBe(0);
    t.events.emit(FUSION_EVENTS.fpvCage(1));
    expect(t.vars.get(FUSION_VARS.fpvCaged(1))).toBe(1);
    t.events.emit(FUSION_EVENTS.iesi('baro_dec'), 3);
    expect(t.vars.get(ADC.baroSetting(t.suite.cfg.sensors.standbyAdc))).toBeCloseTo(29.89, 6);
    t.events.emit(FUSION_EVENTS.iesi('baro_push'));
    expect(t.vars.get(ADC.baroStd(t.suite.cfg.sensors.standbyAdc))).toBe(1);
  });

  it('engine exceedance output and EICAS rendering with CAS messages', () => {
    const t = makeSuite();
    t.suite.applyState('cruise');
    t.vars.set('eng1.n1_pct', 104);
    run(t, 0.5);
    expect(t.vars.get(FUSION_VARS.engExceed)).toBe(1);
    t.suite.cas.model.set('w', 'ENG 1 FIRE', 'warning', true);
    render(t);
  });

  it('dispose releases the displays', () => {
    const t = makeSuite();
    t.suite.system.dispose?.();
    expect(t.suite.afd[0].width).toBeGreaterThan(0);
  });
});
