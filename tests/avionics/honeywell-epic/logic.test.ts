import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { CursorControl, type CursorRouter } from '../../../src/avionics/honeywell-epic/logic/cursor';
import { GulfstreamCas } from '../../../src/avionics/honeywell-epic/logic/cas';
import { ChecklistLogic } from '../../../src/avionics/honeywell-epic/logic/checklist';
import { TouchScreenLogic, type TouchPage } from '../../../src/avionics/honeywell-epic/logic/touch';
import { SystemReadouts } from '../../../src/avionics/honeywell-epic/logic/bindings';
import { EPIC_EVENTS, EPIC_STRINGS, EPIC_VARS } from '../../../src/avionics/honeywell-epic/vars';
import type { Checklist } from '../../../src/aircraft/types';
import type { CasMessage } from '../../../src/avionics/common/draw/CasWindow';

describe('CCD cursor', () => {
  function setup() {
    const vars = new SimVars();
    const events = new EventBus();
    const calls: string[] = [];
    const router: CursorRouter = {
      hitTest: (_s, du, x, y) => (du === 2 && x < 100 && y < 50 ? 'btn' : ''),
      enter: (s, du, _x, _y, id) => void calls.push(`enter ${s} ${du} ${id}`),
      menu: (s, du) => void calls.push(`menu ${s} ${du}`),
      data: (s, du, _x, _y, id, steps, inner) => void calls.push(`data ${s} ${du} ${id} ${steps} ${inner}`),
    };
    let powered = true;
    const cc = new CursorControl(vars, events, { duWidth: 1024, duHeight: 788, gain: 1, parkS: 20, powered: () => powered });
    cc.router = router;
    return { vars, events, cc, calls, setPowered: (p: boolean) => (powered = p) };
  }

  it('appears on the side default DU at first touch and crosses DU edges within the side DUs', () => {
    const t = setup();
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(0);
    t.events.emit(EPIC_EVENTS.ccdMove(1), { dx: 1, dy: 0 });
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(2);
    t.events.emit(EPIC_EVENTS.ccdMove(1), { dx: 600, dy: 0 });
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(3);
    t.events.emit(EPIC_EVENTS.ccdMove(1), { dx: 2000, dy: 0 });
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(3); // pilot cannot reach DU4
    expect(t.vars.get(EPIC_VARS.ccdX(1))).toBe(1024);
    // Copilot DU select keys: 0 -> DU2, 2 -> DU4.
    t.events.emit(EPIC_EVENTS.ccdDu(2), 2);
    expect(t.vars.get(EPIC_VARS.ccdDu(2))).toBe(4);
    t.events.emit(EPIC_EVENTS.ccdDu(2), 0);
    expect(t.vars.get(EPIC_VARS.ccdDu(2))).toBe(2);
  });

  it('routes ENTER / MENU / DATA with the hot spot under the cursor and publishes the hover id', () => {
    const t = setup();
    t.cc.place(1, 2, 50, 20);
    t.cc.update(0.1);
    expect(t.vars.getString(EPIC_STRINGS.ccdHover(1))).toBe('btn');
    t.events.emit(EPIC_EVENTS.ccdEnter(1));
    t.events.emit(EPIC_EVENTS.ccdMenu(1));
    t.events.emit(EPIC_EVENTS.ccdDataDec(1, true), 2);
    expect(t.calls).toEqual(['enter 1 2 btn', 'menu 1 2', 'data 1 2 btn -2 true']);
    // The pilot cannot place a cursor on DU4.
    expect(t.cc.place(1, 4, 10, 10)).toBe(false);
  });

  it('parks after 20 s of inactivity and when unpowered', () => {
    const t = setup();
    t.cc.jump(1, 1);
    t.cc.update(21);
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(0);
    t.cc.jump(1, 1);
    t.setPowered(false);
    t.cc.update(0.1);
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(0);
    t.events.emit(EPIC_EVENTS.ccdEnter(1));
    expect(t.calls.length).toBe(0);
  });
});

describe('Gulfstream CAS', () => {
  function setup() {
    const vars = new SimVars();
    const events = new EventBus();
    const cas = new GulfstreamCas(vars, events);
    const m = cas.model;
    m.define('w1', 'Aft Baggage Smoke', 'warning');
    m.define('c1', 'Yaw Damper Off', 'caution');
    m.define('c2', 'Steer by Wire Fail', 'caution');
    m.define('a1', 'Main Door', 'advisory');
    m.define('a2', 'Check CMC', 'advisory');
    m.define('a3', 'Parking Brake On', 'advisory');
    return { vars, events, cas };
  }

  it('pins warnings, scrolls only acknowledged cautions and advisories, counts hidden messages', () => {
    const t = setup();
    for (const id of ['w1', 'c1', 'c2', 'a1', 'a2', 'a3']) t.cas.model.setActive(id, true);
    // Only acknowledged cautions / advisories scroll; the warning never moves.
    t.cas.model.acknowledge('caution');
    t.cas.update(0);
    t.events.emit(EPIC_EVENTS.casScrollUp);
    t.events.emit(EPIC_EVENTS.casScrollUp);
    const rows: CasMessage[] = [];
    const n = t.cas.visible(rows, 3);
    expect(n).toBe(3);
    const vis = rows.slice(0, n).map((m) => m.id);
    expect(vis[0]).toBe('w1'); // warning stays on top
    expect(vis).not.toContain('c2');
    const h = t.cas.hidden(3);
    expect(h.above).toBe(2);
    t.cas.update(0);
    expect(t.vars.get(EPIC_VARS.casHiddenAbove)).toBe(2);
  });

  it('a new caution recalls the scrolled messages', () => {
    const t = setup();
    for (const id of ['c1', 'a1', 'a2']) t.cas.model.setActive(id, true);
    t.cas.model.acknowledgeAll();
    t.cas.update(0);
    t.events.emit(EPIC_EVENTS.casScroll, 1);
    expect(t.cas.hidden(5).above).toBe(1);
    t.cas.model.setActive('c2', true);
    t.cas.update(0);
    expect(t.cas.hidden(5).above).toBe(0);
  });
});

describe('Electronic checklist', () => {
  const lists: Checklist[] = [
    {
      title: 'Before Start',
      phase: 'Normal',
      items: [
        { challenge: 'Parking Brake', response: 'SET', check: (v) => v.get('brakes.parking_set') !== 0 },
        { challenge: 'Batteries', response: 'ON' },
        { challenge: 'Beacon', response: 'ON' },
      ],
    },
    { title: 'Engine Fire', phase: 'Emergency', items: [{ challenge: 'Fuel Control', response: 'OFF' }] },
  ];

  it('checks items, advances the cursor, undoes, auto-senses and completes', () => {
    const vars = new SimVars();
    const ecl = new ChecklistLogic(vars, lists);
    expect(ecl.current).toBe(0);
    ecl.toggle(1);
    expect(ecl.cursor).toBe(0);
    ecl.toggle(0);
    expect(ecl.cursor).toBe(2);
    ecl.undo();
    expect(ecl.checked[0][0]).toBe(false);
    vars.set('brakes.parking_set', 1);
    ecl.update(0.3);
    expect(ecl.itemDone(0, 0)).toBe(true);
    ecl.toggle(2);
    ecl.update(0.3);
    expect(ecl.isComplete()).toBe(true);
    expect(vars.get(EPIC_VARS.eclComplete)).toBe(1);
    expect(ecl.firstAbnormal()).toBe(1);
    ecl.select(-1);
    vars.set(EPIC_VARS.eclCursor, 1);
    ecl.toggle();
    expect(ecl.current).toBe(1);
  });
});

describe('Touch screen logic', () => {
  function page(onTap: () => void, guarded = false): TouchPage[] {
    return [
      { id: 'A', title: 'A', widgets: [{ id: 'b', kind: 'button', x: 10, y: 10, w: 50, h: 30, tap: onTap, guarded }] },
      { id: 'B', title: 'B', widgets: [] },
    ];
  }

  it('acts on finger lift over the same control; sliding off cancels', () => {
    let n = 0;
    const t = new TouchScreenLogic(page(() => n++));
    t.down(20, 20);
    expect(n).toBe(0);
    t.up(20, 20);
    expect(n).toBe(1);
    t.down(20, 20);
    t.up(200, 200);
    expect(n).toBe(1);
  });

  it('guarded functions need a confirmation tap within 4 s', () => {
    let n = 0;
    const t = new TouchScreenLogic(page(() => n++, true));
    t.tap(20, 20);
    expect(n).toBe(0);
    expect(t.armed?.id).toBe('b');
    t.tap(20, 20);
    expect(n).toBe(1);
    t.tap(20, 20);
    t.update(5);
    t.tap(20, 20);
    expect(n).toBe(1);
  });

  it('navigates pages with history and ignores input when unpowered', () => {
    let on = true;
    let n = 0;
    const t = new TouchScreenLogic(page(() => n++), () => on);
    t.show('B');
    expect(t.current.id).toBe('B');
    t.back();
    expect(t.current.id).toBe('A');
    on = false;
    t.tap(20, 20);
    expect(n).toBe(0);
  });
});

describe('System readouts', () => {
  it('reads bindings, string bindings and NaN for unbound keys', () => {
    const vars = new SimVars();
    const r = new SystemReadouts(vars, { 'my.key': 'x.a + 1', 'str.key': 'str:x.s' });
    vars.set('x.a', 2);
    vars.setString('x.s', 'RUN');
    expect(r.get('my.key')).toBe(3);
    expect(r.str('str.key')).toBe('RUN');
    expect(Number.isNaN(r.get('nope'))).toBe(true);
    vars.set('hyd.left_psi', 3000);
    expect(r.get('hyd.l.psi')).toBe(3000);
    expect(r.on('hyd.l.psi')).toBe(true);
  });
});
