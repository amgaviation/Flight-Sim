import { describe, expect, it } from 'vitest';
import { DISPLAY_VARS } from '../../../src/cockpit/types';
import { NAV } from '../../../src/core/vars';
import { DuFormat, EPIC_EVENTS, EPIC_STRINGS, EPIC_VARS, SYNOPTIC_WINDOWS, Win, HsiMode } from '../../../src/avionics/honeywell-epic/vars';
import { EpicDisplayUnit } from '../../../src/avionics/honeywell-epic/displays/du';
import { drawStats, makeSuite, recordEvents, run } from './helpers';

describe('createEpicSuite', () => {
  it('builds the PlaneView II hardware set', () => {
    const { suite } = makeSuite('planeview2');
    expect(suite.du.length).toBe(4);
    expect(suite.standby.map((d) => d.id)).toEqual(['epic.smc1', 'epic.smc2']);
    expect(suite.mcduDisplays.length).toBe(3);
    expect(suite.tsc.length).toBe(0);
    expect(suite.gpWindows.length).toBe(4);
  });

  it('builds the Symmetry hardware set (touch controllers, overhead touch screens, SFDs)', () => {
    const { suite } = makeSuite('symmetry');
    expect(suite.standby.map((d) => d.id)).toEqual(['epic.sfd1', 'epic.sfd2']);
    expect(suite.tsc.length).toBe(4);
    expect(suite.ohpts.length).toBe(3);
    expect(suite.mcdus.length).toBe(4); // FMS app per TSC
    expect(suite.mcduDisplays.length).toBe(0);
  });

  it('writes display power from the configured bindings', () => {
    const t = makeSuite('planeview2', { power: { du: ['bus.a', 'bus.a', 'bus.b', 'bus.b'], standby: ['bus.a', 1] } });
    t.vars.set('bus.a', 1);
    run(t, 0.1);
    expect(t.vars.get(DISPLAY_VARS.power('epic.du1'))).toBe(1);
    expect(t.vars.get(DISPLAY_VARS.power('epic.du3'))).toBe(0);
    expect(t.vars.get(EPIC_VARS.duOperating(3))).toBe(0);
    expect(t.vars.get(DISPLAY_VARS.power('epic.smc2'))).toBe(1);
  });

  it('monitors secondary engine exceedances for the full MAP reversion', () => {
    const t = makeSuite();
    t.suite.windows.select(2, 'full', Win.Map);
    t.vars.set('eng1.n2_pct', 80);
    t.vars.set('eng1.oil_press_psi', 20); // below the 25 psid minimum
    t.vars.set('eng2.n2_pct', 80);
    t.vars.set('eng2.oil_press_psi', 60);
    run(t, 1);
    expect(t.vars.get(EPIC_VARS.engExceed2)).toBe(1);
    expect(t.vars.get(EPIC_VARS.duFormat(2))).toBe(DuFormat.Split);
  });

  it('resets the transponder IDENT after 18 s and runs the chronometers', () => {
    const t = makeSuite();
    t.vars.set(NAV.xpdrIdent, 1);
    run(t, 10);
    expect(t.vars.get(NAV.xpdrIdent)).toBe(1);
    run(t, 9);
    expect(t.vars.get(NAV.xpdrIdent)).toBe(0);
    t.events.emit(EPIC_EVENTS.chrono(1), 'startstop');
    run(t, 5);
    expect(t.vars.get(EPIC_VARS.chronoS(1))).toBeGreaterThan(4.9);
    t.events.emit(EPIC_EVENTS.chrono(1), 'reset');
    expect(t.vars.get(EPIC_VARS.chronoS(1))).toBe(0);
  });

  it('applyState sets the boot behaviour and the default layout', () => {
    const t = makeSuite();
    t.suite.windows.select(2, 'main', Win.SynFuel);
    t.suite.applyState('cruise');
    expect(t.vars.get(EPIC_VARS.bootSkip)).toBe(1);
    expect(t.vars.get(EPIC_VARS.duMain(2))).toBe(Win.Map);
    t.suite.applyState('cold_dark');
    expect(t.vars.get(EPIC_VARS.bootSkip)).toBe(0);
  });
});

describe('DU composition and CCD interaction', () => {
  function renderAll(t: ReturnType<typeof makeSuite>): void {
    for (const d of t.suite.displays) {
      d.render(0.05);
      d.render(0.05);
    }
  }

  it('boots (unless skipped) and draws every window format without throwing', () => {
    const t = makeSuite('planeview2', { duBootS: 2 });
    run(t, 0.1);
    renderAll(t);
    const du = t.suite.du[0] as EpicDisplayUnit;
    expect(du.shown[0]).toBeNull(); // still booting
    for (let i = 0; i < 50; i++) du.render(0.05);
    expect(du.shown[0]?.kind).toBe(Win.Pfd);
    t.vars.set(EPIC_VARS.bootSkip, 1);
    const kinds: Win[] = [Win.Map, Win.Checklist, ...SYNOPTIC_WINDOWS];
    for (const k of kinds) {
      t.suite.windows.select(2, 'main', k);
      t.suite.windows.select(2, 'upper', k === Win.Map ? Win.WptList : k);
      t.suite.windows.select(3, 'lower', k === Win.Map ? Win.Cas : k);
      run(t, 0.05);
      const before = drawStats.fillText;
      renderAll(t);
      expect(drawStats.fillText, `window ${k}`).toBeGreaterThan(before);
    }
    // PFD HSI formats and full-window PFD.
    for (const m of [HsiMode.Rose, HsiMode.Arc, HsiMode.Map]) {
      t.vars.set(EPIC_VARS.hsiMode(1), m);
      renderAll(t);
    }
    // Weather radar (WX / GMAP) and EVS paths.
    t.vars.set('env.precip', 0.7);
    t.vars.set(EPIC_VARS.radarMode, 2);
    t.vars.set(EPIC_VARS.mapOverlay(1), 2);
    t.vars.set(EPIC_VARS.evs(1), 1);
    t.suite.windows.select(2, 'main', Win.Map);
    run(t, 1.1);
    renderAll(t);
    t.vars.set(EPIC_VARS.radarMode, 3);
    run(t, 0.1);
    renderAll(t);
    t.suite.windows.select(1, 'full', Win.Pfd);
    run(t, 0.05);
    renderAll(t);
    expect(t.suite.du[0].shown[0]?.format).toBe('full');
  });

  it('CCD MENU opens the window menu and ENTER selects a new format for the window', () => {
    const t = makeSuite('planeview2', { duBootS: 0 });
    run(t, 0.1);
    renderAll(t);
    const du2 = t.suite.du[1];
    // Upper 1/6 window of DU2 (column on the right, x > 683).
    t.suite.cursor.place(1, 2, 800, 100);
    t.events.emit(EPIC_EVENTS.ccdMenu(1));
    // Find the 'Fuel' item: walk the menu rows under the cursor.
    let picked = false;
    for (let y = 0; y < 788 && !picked; y += 4) {
      for (let x = 600; x < 1024 && !picked; x += 20) {
        const id = du2.hitTest(x, y);
        if (id.startsWith('du.menu') && id !== 'du.menu.full') {
          t.suite.cursor.place(1, 2, x, y);
          t.suite.cursor.update(0);
          const idx = Number(id.slice(7));
          // Items of an upper 1/6 window: Engine, Engine2, CAS, Checklist, WptList, synoptics...
          if (idx === 5 + SYNOPTIC_WINDOWS.indexOf(Win.SynFuel)) {
            t.events.emit(EPIC_EVENTS.ccdEnter(1));
            picked = true;
          }
        }
      }
    }
    expect(picked).toBe(true);
    expect(t.suite.windows.selection(2).upper).toBe(Win.SynFuel);
  });

  it('map window menu buttons act on the side map settings through the cursor', () => {
    const t = makeSuite('planeview2', { duBootS: 0 });
    run(t, 0.1);
    renderAll(t);
    const range = t.vars.get(EPIC_VARS.mapRange(1));
    // '+' range button of the map menu bar (DU2 main window starts at x = 0).
    let found = false;
    for (let x = 0; x < 683 && !found; x += 2) {
      t.suite.cursor.place(1, 2, x, 18);
      t.suite.cursor.update(0);
      if (t.vars.getString(EPIC_STRINGS.ccdHover(1)) === 'map.rng+') {
        t.events.emit(EPIC_EVENTS.ccdEnter(1));
        found = true;
      }
    }
    expect(found).toBe(true);
    expect(t.vars.get(EPIC_VARS.mapRange(1))).toBeGreaterThan(range);
    // DATA knob over the map changes the range too.
    t.suite.cursor.place(1, 2, 300, 300);
    t.events.emit(EPIC_EVENTS.ccdDataDec(1), 1);
    expect(t.vars.get(EPIC_VARS.mapRange(1))).toBe(range);
  });

  it('selecting a CAS message with the CCD opens its checklist on the side MFD', () => {
    const t = makeSuite('planeview2', {
      duBootS: 0,
      checklists: [
        { title: 'Before Start', phase: 'Normal', items: [{ challenge: 'Brakes', response: 'SET' }] },
        { title: 'Yaw Damper Off', phase: 'Abnormal', items: [{ challenge: 'YD', response: 'ENGAGE' }] },
      ],
    });
    t.suite.cas.model.define('yd', 'Yaw Damper Off', 'caution');
    t.suite.cas.model.setActive('yd', true);
    run(t, 0.1);
    renderAll(t);
    // DU1 lower 1/6 (column on the left): the CAS window, first row.
    t.suite.cursor.place(1, 1, 100, 394 + 6 + 11);
    t.suite.cursor.update(0);
    expect(t.vars.getString(EPIC_STRINGS.ccdHover(1))).toBe('cas.row0');
    t.events.emit(EPIC_EVENTS.ccdEnter(1));
    expect(t.vars.get(EPIC_VARS.eclList)).toBe(1);
    expect(t.suite.windows.selection(2).main).toBe(Win.Checklist);
  });

  it('Symmetry touch screens draw every page and route touches', () => {
    const t = makeSuite('symmetry', { duBootS: 0 });
    t.vars.set(EPIC_VARS.bootSkip, 1);
    run(t, 0.1);
    const log = recordEvents(t.events);
    for (let i = 0; i < t.suite.tscLogic.length; i++) {
      const l = t.suite.tscLogic[i];
      for (const p of l.pages) {
        l.show(p.id);
        const before = drawStats.fillText;
        t.suite.tsc[i].render(0.05);
        t.suite.tsc[i].render(0.05);
        expect(drawStats.fillText, `${t.suite.tsc[i].id} ${p.id}`).toBeGreaterThan(before);
      }
    }
    for (let i = 0; i < t.suite.ohptsLogic.length; i++) {
      for (const p of t.suite.ohptsLogic[i].pages) {
        t.suite.ohptsLogic[i].show(p.id);
        t.suite.ohpts[i].render(0.05);
      }
    }
    // Guidance page: the AP key goes through the guidance-panel logic.
    const tsc = t.suite.tscLogic[0];
    tsc.show('GUIDANCE');
    expect(tsc.tapId('g.m.ap')).toBe(true);
    expect(log.some((e) => e.name === 'ap.ap')).toBe(true);
    // Radios page: swap COM1.
    tsc.show('RADIOS');
    t.vars.set(NAV.comActive(1), 121.5);
    t.vars.set(NAV.comStandby(1), 118.3);
    tsc.tapId('rad.0.swap');
    expect(t.vars.get(NAV.comActive(1))).toBeCloseTo(118.3, 3);
    // Keypad entry into COM1 standby.
    tsc.tapId('rad.0.stby');
    expect(tsc.current.id).toBe('KEYPAD');
    for (const k of ['1', '2', '4', '.', '3', '5']) tsc.tapId(`kp.${k}`);
    tsc.tapId('kp.enter');
    expect(t.vars.get(NAV.comStandby(1))).toBeCloseTo(124.35, 3);
    expect(tsc.current.id).toBe('RADIOS');
    // Display control page drives the display controller logic of the side.
    tsc.show('DISPLAY');
    t.suite.tsc[0].render(0.05);
    tsc.tapId('dc.tab.PFD');
    const fpv = t.vars.get(EPIC_VARS.fpv(1));
    t.suite.tsc[0].render(0.05);
    tsc.tapId('dc.lsk1');
    expect(t.vars.get(EPIC_VARS.fpv(1))).toBe(fpv ? 0 : 1);
    // SFD touch: baro keys.
    const sfd = t.suite.standby[0];
    t.vars.set('adc3.baro_inhg', 29.92);
    sfd.onPointer?.(400, 20, 'down');
    sfd.onPointer?.(400, 20, 'up');
    sfd.onPointer?.(150, 390, 'down');
    sfd.onPointer?.(150, 390, 'up');
    expect(t.vars.get('adc3.baro_inhg')).toBeCloseTo(29.93, 3);
  });
});
