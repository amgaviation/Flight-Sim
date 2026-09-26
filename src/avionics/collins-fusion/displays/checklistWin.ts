/**
 * CHECKLIST window: the electronic checklist (ECL) of logic/checklist.ts.
 *
 * FSB BD-700-1A10 Rev 7 appendix 6: "Electronic Checklist (ECL) linked to
 * selected CAS messages"; checklist / synoptic selection by the MKP CHK/SYS
 * key. Interaction (EST, Pro Line Fusion cursor model): the CCP cursor
 * selects an item (ENTER checks it off), the DATA knob moves the current
 * item, INDEX shows the list of checklists (normal and non-normal groups),
 * RESET clears the open checklist. Checked items are green with a tick,
 * closed-loop items are ticked automatically, the current item is framed
 * cyan, and CHECKLIST COMPLETE is shown in green (EST colours, Collins
 * convention: cyan = selectable / selected).
 */
import type { Ctx2D } from '../../common/draw/context';
import type { ShownWindow } from '../logic/layout';
import { isNonNormal, type ChecklistLogic } from '../logic/checklist';
import { C, rect, seg, txt } from './style';
import type { HotSpots, WindowRenderer } from './window';

const MAX_IDS = 96;
const ITEM_IDS: string[] = [];
const LIST_IDS: string[] = [];
for (let i = 0; i < MAX_IDS; i++) {
  ITEM_IDS.push(`ecl:item:${i}`);
  LIST_IDS.push(`ecl:list:${i}`);
}

export class ChecklistWindow implements WindowRenderer {
  readonly animated = false;
  /** Per side: index (list of checklists) shown instead of the open checklist. */
  readonly indexMode: [boolean, boolean] = [false, false];
  private readonly scroll: [number, number] = [0, 0];

  constructor(private readonly ecl: ChecklistLogic) {}

  update(): void {}

  showIndex(side: 1 | 2, on: boolean): void {
    this.indexMode[side - 1] = on;
    this.scroll[side - 1] = 0;
  }

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    const side = w.owner;
    const ecl = this.ecl;
    // Header buttons.
    const bh = 26;
    rect(ctx, r.x + 6, r.y + 6, 80, bh, C.panel, C.line, 1);
    txt(ctx, 'INDEX', r.x + 46, r.y + 6 + bh / 2 + 1, 13, this.indexMode[side - 1] ? C.cyan : C.white, 'center');
    hs.add('ecl:index', r.x + 6, r.y + 6, 80, bh);
    if (!ecl.lists.length) {
      txt(ctx, 'NO CHECKLISTS LOADED', r.x + r.w / 2, r.y + r.h / 2, 16, C.white, 'center');
      return;
    }
    if (this.indexMode[side - 1] || !ecl.current) {
      this.drawIndex(ctx, w, hs);
      return;
    }
    const cl = ecl.current;
    rect(ctx, r.x + r.w - 86, r.y + 6, 80, bh, C.panel, C.line, 1);
    txt(ctx, 'RESET', r.x + r.w - 46, r.y + 6 + bh / 2 + 1, 13, C.white, 'center');
    hs.add('ecl:reset', r.x + r.w - 86, r.y + 6, 80, bh);
    txt(ctx, cl.title.toUpperCase(), r.x + r.w / 2, r.y + 20, 16, isNonNormal(cl) ? C.amber : C.white, 'center');
    txt(ctx, cl.phase.toUpperCase(), r.x + r.w / 2, r.y + 42, 12, C.grey, 'center');
    seg(ctx, r.x, r.y + 54, r.x + r.w, r.y + 54, C.line, 1);
    // Items.
    const rowH = r.h > 400 ? 30 : 24;
    const top = r.y + 60;
    const bottom = r.y + r.h - 44;
    const rows = Math.max(1, Math.floor((bottom - top) / rowH));
    const n = cl.items.length;
    let sc = this.scroll[side - 1];
    if (ecl.cursor < sc) sc = ecl.cursor;
    if (ecl.cursor >= sc + rows) sc = ecl.cursor - rows + 1;
    sc = Math.max(0, Math.min(Math.max(0, n - rows), sc));
    this.scroll[side - 1] = sc;
    const checked = ecl.checked[ecl.list];
    const sensed = ecl.sensed[ecl.list];
    const size = rowH > 26 ? 15 : 13;
    for (let k = sc; k < Math.min(n, sc + rows); k++) {
      const y = top + (k - sc) * rowH;
      const it = cl.items[k];
      const done = checked[k];
      const col = done ? C.green : C.white;
      if (k === ecl.cursor) rect(ctx, r.x + 4, y + 1, r.w - 8, rowH - 2, '', C.cyan, 2);
      // Check box (closed-loop items sensed automatically have no box, EST).
      const bx = r.x + 12;
      const by = y + rowH / 2;
      if (!it.check) rect(ctx, bx, by - 7, 14, 14, '', done ? C.green : C.white, 1.5);
      if (done) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by);
        ctx.lineTo(bx + 6, by + 5);
        ctx.lineTo(bx + 13, by - 6);
        ctx.stroke();
      }
      txt(ctx, it.challenge, r.x + 34, by + 1, size, col, 'left');
      txt(ctx, it.response, r.x + r.w - 12, by + 1, size, sensed[k] ? C.green : col, 'right');
      hs.add(ITEM_IDS[k % MAX_IDS], r.x, y, r.w, rowH);
    }
    if (sc > 0) txt(ctx, '▲', r.x + r.w - 14, top - 2, 11, C.white, 'center');
    if (sc + rows < n) txt(ctx, '▼', r.x + r.w - 14, bottom + 4, 11, C.white, 'center');
    // Footer.
    seg(ctx, r.x, r.y + r.h - 40, r.x + r.w, r.y + r.h - 40, C.line, 1);
    if (ecl.isComplete()) txt(ctx, 'CHECKLIST COMPLETE', r.x + 12, r.y + r.h - 20, 15, C.green, 'left');
    rect(ctx, r.x + r.w - 86, r.y + r.h - 34, 80, 26, C.panel, C.line, 1);
    txt(ctx, 'NEXT', r.x + r.w - 46, r.y + r.h - 20, 13, C.white, 'center');
    hs.add('ecl:next', r.x + r.w - 86, r.y + r.h - 34, 80, 26);
  }

  private drawIndex(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    const ecl = this.ecl;
    txt(ctx, 'CHECKLIST INDEX', r.x + r.w / 2, r.y + 20, 16, C.white, 'center');
    seg(ctx, r.x, r.y + 40, r.x + r.w, r.y + 40, C.line, 1);
    const rowH = r.h > 400 ? 28 : 22;
    let y = r.y + 48;
    const bottom = r.y + r.h - 8;
    // Normal group, then non-normal.
    for (let pass = 0; pass < 2 && y < bottom; pass++) {
      txt(ctx, pass === 0 ? 'NORMAL' : 'NON-NORMAL', r.x + 10, y + rowH / 2, 12, C.grey, 'left');
      y += rowH;
      for (let i = 0; i < ecl.lists.length && y < bottom; i++) {
        const l = ecl.lists[i];
        if (isNonNormal(l) !== (pass === 1)) continue;
        const done = ecl.isComplete(i);
        if (i === ecl.list) rect(ctx, r.x + 4, y + 1, r.w - 8, rowH - 2, '', C.cyan, 1.5);
        txt(ctx, l.title.toUpperCase(), r.x + 24, y + rowH / 2 + 1, rowH > 24 ? 15 : 13, done ? C.green : pass === 1 ? C.amber : C.white, 'left');
        if (done) txt(ctx, 'COMPLETE', r.x + r.w - 12, y + rowH / 2 + 1, 12, C.green, 'right');
        hs.add(LIST_IDS[i % MAX_IDS], r.x, y, r.w, rowH);
        y += rowH;
      }
    }
  }

  enter(side: 1 | 2, _w: ShownWindow, id: string): void {
    const ecl = this.ecl;
    if (id === 'ecl:index') {
      this.showIndex(side, !this.indexMode[side - 1]);
    } else if (id === 'ecl:reset') {
      ecl.reset();
    } else if (id === 'ecl:next') {
      ecl.nextList(1);
    } else if (id.startsWith('ecl:list:')) {
      ecl.select(Number(id.slice(9)));
      this.showIndex(side, false);
    } else if (id.startsWith('ecl:item:')) {
      const k = Number(id.slice(9));
      // Cursor on the item + ENTER checks it off (or unchecks a checked one).
      if (k !== ecl.cursor) ecl.move(k - ecl.cursor);
      ecl.toggle();
    }
  }

  data(side: 1 | 2, _w: ShownWindow, _id: string, steps: number): void {
    if (this.indexMode[side - 1]) {
      this.ecl.nextList(steps > 0 ? 1 : -1);
      return;
    }
    this.ecl.move(steps > 0 ? 1 : -1);
  }
}
