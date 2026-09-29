import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { CursorLogic, CURSOR_IDLE_S, CCP_GAIN, type CursorRouter } from '../../../src/avionics/collins-fusion/logic/cursor';
import { FUSION_EVENTS, FUSION_STRINGS, FUSION_VARS } from '../../../src/avionics/collins-fusion/vars';

function setup(eicas: { du: number; x: number; y: number; w: number; h: number } | null = { du: 2, x: 0, y: 0, w: 512, h: 640 }) {
  const vars = new SimVars();
  const events = new EventBus();
  const log: string[] = [];
  const op = [true, true, true, true];
  const router: CursorRouter = {
    hitTest: (_s, du, x, y) => (du === 3 && x > 600 && x < 700 && y > 100 && y < 150 ? 'spot' : ''),
    enter: (s, du, _x, _y, id) => log.push(`enter:${s}:${du}:${id}`),
    menu: (s, du) => log.push(`menu:${s}:${du}`),
    back: (s, du) => log.push(`back:${s}:${du}`),
    data: (s, du, _x, _y, id, steps, inner) => log.push(`data:${s}:${du}:${id}:${steps}:${inner}`),
    windowKey: (du, x) => `${du}:${x < 512 ? 'L' : 'R'}`,
    excluded: (du) => (eicas && eicas.du === du ? { x: eicas.x, y: eicas.y, w: eicas.w, h: eicas.h } : null),
    operating: (du) => op[du - 1],
  };
  const cur = new CursorLogic(vars, events);
  cur.router = router;
  return { vars, events, cur, log, op };
}

describe('CCP cursor', () => {
  it('moves across the T-shaped desktop: AFD 1 -> AFD 2 jumps over the EICAS window', () => {
    const { cur, vars } = setup();
    cur.place(1, 1, 1000, 300);
    expect(vars.get(FUSION_VARS.cursorVisible(1))).toBe(1);
    // Moving right would enter AFD 2's EICAS (left half): the cursor jumps to its right side.
    cur.move(1, 40, 0);
    const c = cur.cursors[0];
    expect(c.du).toBe(2);
    expect(c.x).toBeGreaterThanOrEqual(512);
    // Down from AFD 2 into AFD 3 (lower centre).
    cur.move(1, 0, 400);
    expect(c.du).toBe(3);
  });

  it('each pilot reaches only his side (pilot AFD 1-3, copilot AFD 2-4)', () => {
    const { cur } = setup(null);
    cur.place(1, 2, 1000, 300);
    cur.move(1, 100, 0); // AFD 4 is not reachable by the pilot
    expect(cur.cursors[0].du).toBe(2);
    expect(cur.cursors[0].x).toBe(1023);
    cur.place(2, 4, 10, 300);
    cur.move(2, -100, 0);
    expect(cur.cursors[1].du).toBe(2);
    cur.place(2, 1, 100, 100); // not placeable
    expect(cur.cursors[1].du).toBe(2);
  });

  it('trackball events use the CCP gain; ENTER / MENU / BACK / DATA route to the display', () => {
    const { cur, events, log, vars } = setup(null);
    cur.place(1, 3, 600, 120);
    events.emit(FUSION_EVENTS.ccpMove(1), { dx: 10, dy: 0 });
    expect(cur.cursors[0].x).toBeCloseTo(600 + 10 * CCP_GAIN, 6);
    expect(vars.getString(FUSION_STRINGS.cursorHover(1))).toBe('spot');
    events.emit(FUSION_EVENTS.ccpEnter(1));
    events.emit(FUSION_EVENTS.ccpMenu(1));
    events.emit(FUSION_EVENTS.ccpBack(1));
    events.emit(FUSION_EVENTS.ccpDataInc(1, true), 2);
    events.emit(FUSION_EVENTS.ccpData(1), -1);
    expect(log).toEqual(['enter:1:3:spot', 'menu:1:3', 'back:1:3', 'data:1:3:spot:2:true', 'data:1:3:spot:-1:false']);
  });

  it('the cursor hides after 30 s without motion and when its display fails', () => {
    const { cur, op } = setup(null);
    cur.place(1, 3, 100, 100);
    cur.update(CURSOR_IDLE_S - 1);
    expect(cur.cursors[0].visible).toBe(true);
    cur.update(2);
    expect(cur.cursors[0].visible).toBe(false);
    cur.place(1, 3, 100, 100);
    op[2] = false;
    cur.update(0.1);
    expect(cur.cursors[0].visible).toBe(false);
  });

  it('bump rule: entering the other pilot\'s window removes his cursor (AIN 2012)', () => {
    const { cur } = setup(null);
    cur.place(2, 3, 100, 100);
    expect(cur.cursors[1].visible).toBe(true);
    cur.place(1, 3, 200, 300); // same window (AFD 3 left)
    expect(cur.cursors[1].visible).toBe(false);
    expect(cur.cursors[0].visible).toBe(true);
  });

  it('display select keys jump to the PFD, upper or lower display', () => {
    const { cur, events } = setup();
    events.emit(FUSION_EVENTS.ccpDisplay(1), 'LWR');
    expect(cur.cursors[0].du).toBe(3);
    events.emit(FUSION_EVENTS.ccpDisplay(1), 'UPR');
    expect(cur.cursors[0].du).toBe(2);
    expect(cur.cursors[0].x).toBeGreaterThanOrEqual(512); // not inside the EICAS half
    events.emit(FUSION_EVENTS.ccpDisplay(2), 'PFD');
    expect(cur.cursors[1].du).toBe(4);
  });
});
