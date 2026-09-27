/**
 * Drawing of the FMS-knob windows and pages (PFD lower-right windows, MFD
 * page bodies) and the pop-up menus (PG 190-02177-02 §1.4 "Menus", §2 PFD
 * windows, §5 Flight Management). The cursor is shown as black text on a
 * cyan box; pending selections flash (PG §1.2 "FMS Knob").
 */
import { NAV } from '../../../core/vars';
import { box, line, type Ctx2D, type Rect } from '../../common/draw/context';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { fmtCom, fmtDeg, fmtDist, fmtHms, fmtNav, join2 } from '../../garmin-g3000/format';
import type { Field, Form, NumberField, SelectField, TextField } from '../state/forms';
import type { PopupMenu } from '../state/forms';
import {
  AlertsPage,
  DirectToPage,
  DmePage,
  FplPage,
  NearestAirportsPage,
  ProcLoadingPage,
  ProcPage,
  TmrRefPage,
  brgDist,
  type Page,
} from '../state/pages';
import type { G1000System } from '../state/System';
import { G1K, vn } from '../vars';
import { G1K_PALETTE, TF, winBox } from './style';

const P = G1K_PALETTE;

/** Text shown for a field (pending edit or current value). */
export function fieldValue(form: Form, f: Field): string {
  switch (f.kind) {
    case 'select': {
      const opts = (f as SelectField).options();
      return opts[form.displayIndex(f as SelectField)] ?? '';
    }
    case 'number':
      return String(form.displayNumber(f as NumberField));
    case 'text':
      return form.editing && form.field === f ? form.enteredText : (f as TextField).get();
    case 'action':
      return f.label();
    case 'list':
      return '';
  }
}

/** Draws a field value; the cursor field gets the cyan box (text entry: the edited character highlighted). */
export function drawField(ctx: Ctx2D, form: Form, id: string, text: string, x: number, y: number, size: number, color: string, align: 'left' | 'right' | 'center', time: number): void {
  const cur = form.isCursor(id);
  if (!cur) {
    TF.draw(ctx, text, x, y, size, color, align, 'middle');
    return;
  }
  const f = form.field;
  if (form.editing && f?.kind === 'text') {
    // Identifier entry: typed characters white on black, the edit position inverse; completion grey.
    const typed = form.text.padEnd(form.textPos + 1, ' ');
    const comp = form.completion.startsWith(form.text.trimEnd()) ? form.completion : '';
    const shown = comp.length > typed.trimEnd().length ? comp : typed;
    const w = TF.width(ctx, 'W', size);
    const x0 = align === 'left' ? x : align === 'right' ? x - shown.length * w : x - (shown.length * w) / 2;
    box(ctx, x0 - 3, y - size * 0.65, shown.length * w + 6, size * 1.3, '#000000', P.cyan, 1);
    for (let i = 0; i < shown.length; i++) {
      const ch = shown[i];
      const cx = x0 + i * w + w / 2;
      if (i === form.textPos) {
        box(ctx, x0 + i * w, y - size * 0.6, w, size * 1.2, P.cyan, '');
        TF.draw(ctx, ch, cx, y + 1, size, '#000000', 'center', 'middle');
      } else TF.draw(ctx, ch, cx, y + 1, size, i < typed.trimEnd().length ? P.white : P.grey, 'center', 'middle');
    }
    return;
  }
  // Pending (unconfirmed) choices flash (PG: "flashing cursor").
  const on = !form.editing || blinkOn(time, 2);
  const w = TF.width(ctx, text || ' ', size);
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  if (on) box(ctx, x0 - 3, y - size * 0.62, w + 6, size * 1.24, P.cyan, '');
  TF.draw(ctx, text, x, y + 1, size, on ? '#000000' : P.cyan, align, 'middle');
}

function fieldById(form: Form, id: string): Field | undefined {
  return form.fields.find((f) => f.id === id);
}

function val(form: Form, id: string): string {
  const f = fieldById(form, id);
  return f ? fieldValue(form, f) : '';
}

/** Keeps the highlighted row visible; returns the first row to draw. */
function scrollTo(form: Form, rows: number, visible: number): number {
  if (form.row < form.scroll) form.scroll = form.row;
  if (form.row >= form.scroll + visible) form.scroll = form.row - visible + 1;
  form.scroll = Math.max(0, Math.min(Math.max(0, rows - visible), form.scroll));
  return form.scroll;
}

// ================================================================ pop-ups

export function drawPopup(ctx: Ctx2D, pop: PopupMenu, r: Rect): void {
  if (!pop.open) return;
  const rowH = 20;
  const n = Math.min(pop.items.length, 12);
  const h = 30 + n * rowH + 8;
  const y0 = r.y + Math.max(0, (r.h - h) / 2);
  winBox(ctx, r.x, y0, r.w, h, '#000000');
  TF.draw(ctx, pop.title, r.x + r.w / 2, y0 + 14, 14, P.white, 'center', 'middle');
  line(ctx, r.x + 4, y0 + 26, r.x + r.w - 4, y0 + 26, P.grey, 1);
  const first = Math.max(0, Math.min(pop.items.length - n, pop.index - n + 1));
  for (let i = 0; i < n; i++) {
    const it = pop.items[first + i];
    if (!it) continue;
    const y = y0 + 38 + i * rowH;
    const sel = first + i === pop.index;
    if (sel) box(ctx, r.x + 6, y - 9, r.w - 12, 18, P.cyan, '');
    TF.draw(ctx, it.label, r.x + 12, y + 1, 14, sel ? '#000000' : it.enabled ? P.white : P.grey, 'left', 'middle');
  }
}

// ================================================================ windows / pages

/** Draws a page's content in `r` (PFD window or MFD page body). */
export function drawPage(ctx: Ctx2D, sys: G1000System, page: Page, r: Rect, time: number, framed: boolean): void {
  if (framed) {
    winBox(ctx, r.x, r.y, r.w, r.h);
    TF.draw(ctx, page.title(), r.x + r.w / 2, r.y + 12, 14, P.white, 'center', 'middle');
    line(ctx, r.x + 4, r.y + 23, r.x + r.w - 4, r.y + 23, P.grey, 1);
  }
  const body: Rect = framed ? { x: r.x + 6, y: r.y + 28, w: r.w - 12, h: r.h - 32 } : r;
  if (page instanceof TmrRefPage) drawTmrRef(ctx, sys, page, body, time);
  else if (page instanceof NearestAirportsPage) drawNearest(ctx, page, body, time);
  else if (page instanceof AlertsPage) drawAlerts(ctx, sys, page, body);
  else if (page instanceof FplPage) drawFpl(ctx, page, body, time);
  else if (page instanceof DirectToPage) drawDto(ctx, sys, page, body, time);
  else if (page instanceof ProcLoadingPage) drawProcLoad(ctx, page, body, time);
  else if (page instanceof ProcPage) drawProc(ctx, page, body);
  else if (page instanceof DmePage) drawDme(ctx, sys, page, body, time);
}

function drawTmrRef(ctx: Ctx2D, sys: G1000System, p: TmrRefPage, r: Rect, time: number): void {
  const f = p.form;
  const t = sys.refs.timer;
  let y = r.y + 10;
  TF.draw(ctx, 'TIMER', r.x, y, 13, P.white, 'left', 'middle');
  drawField(ctx, f, 'timer', fmtHms(t.seconds, true), r.x + 130, y, 15, P.cyan, 'right', time);
  drawField(ctx, f, 'dir', val(f, 'dir'), r.x + 172, y, 14, P.cyan, 'center', time);
  drawField(ctx, f, 'start', t.prompt, r.x + r.w, y, 14, P.cyan, 'right', time);
  y += 22;
  for (const d of sys.refs.vspeeds.defs) {
    const mod = sys.refs.vspeeds.modified(d.id);
    TF.draw(ctx, d.name.toUpperCase(), r.x, y, 13, P.white, 'left', 'middle');
    drawField(ctx, f, `v_${d.id}`, join2(val(f, `v_${d.id}`), mod ? 'KT*' : 'KT'), r.x + 150, y, 14, P.cyan, 'right', time);
    drawField(ctx, f, `on_${d.id}`, val(f, `on_${d.id}`), r.x + r.w, y, 14, P.cyan, 'right', time);
    y += 19;
  }
  y += 4;
  const m = sys.refs.mins;
  TF.draw(ctx, 'MINS', r.x, y, 13, P.white, 'left', 'middle');
  drawField(ctx, f, 'mins', val(f, 'mins'), r.x + 130, y, 14, P.cyan, 'right', time);
  if (m.mode > 0) drawField(ctx, f, 'minsft', join2(val(f, 'minsft'), 'FT'), r.x + r.w, y, 14, P.cyan, 'right', time);
  if (m.mode === 2) {
    y += 19;
    TF.draw(ctx, 'TEMP', r.x, y, 13, P.white, 'left', 'middle');
    drawField(ctx, f, 'temp', join2(val(f, 'temp'), '°C'), r.x + r.w, y, 14, P.cyan, 'right', time);
  }
}

function drawNearest(ctx: Ctx2D, p: NearestAirportsPage, r: Rect, time: number): void {
  const f = p.form;
  const list = p.list;
  if (!list.length) {
    TF.draw(ctx, 'NONE WITHIN 200NM', r.x + r.w / 2, r.y + 30, 14, P.white, 'center', 'middle');
    return;
  }
  const rowH = 36;
  const vis = Math.max(1, Math.floor(r.h / rowH));
  const first = Math.floor(scrollTo(f, list.length * 2, vis * 2) / 2);
  for (let i = 0; i < vis; i++) {
    const a = list[first + i];
    if (!a) break;
    const y = r.y + 8 + i * rowH;
    const k = (first + i) * 2;
    const identCur = f.active && f.row === k;
    const freqCur = f.active && f.row === k + 1;
    const on = blinkOn(time, 2) || true;
    if (identCur && on) box(ctx, r.x - 2, y - 8, 52, 16, P.cyan, '');
    TF.draw(ctx, a.apt.icao, r.x, y, 14, identCur ? '#000000' : P.cyan, 'left', 'middle');
    TF.draw(ctx, fmtDeg(a.brg), r.x + 96, y, 14, P.white, 'right', 'middle');
    TF.draw(ctx, join2(fmtDist(a.dist), 'NM'), r.x + 170, y, 14, P.white, 'right', 'middle');
    TF.draw(ctx, a.appr, r.x + r.w, y, 13, P.white, 'right', 'middle');
    const y2 = y + 16;
    if (a.com) {
      const txt = fmtCom(a.com.mhz, a.com.mhz * 40 !== Math.round(a.com.mhz * 40));
      TF.draw(ctx, a.com.type.slice(0, 4), r.x + 60, y2, 12, P.white, 'left', 'middle');
      if (freqCur) box(ctx, r.x + 96, y2 - 8, 64, 16, P.cyan, '');
      TF.draw(ctx, txt, r.x + 158, y2, 14, freqCur ? '#000000' : P.cyan, 'right', 'middle');
    }
    TF.draw(ctx, join2(fmtInt(a.rwyFt), 'FT'), r.x + r.w, y2, 12, P.white, 'right', 'middle');
  }
}

function drawAlerts(ctx: Ctx2D, sys: G1000System, p: AlertsPage, r: Rect): void {
  const list = sys.alerts.messages.list;
  if (!list.length) {
    TF.draw(ctx, 'NO ALERTS', r.x + r.w / 2, r.y + 30, 14, P.white, 'center', 'middle');
    return;
  }
  const rowH = 30;
  const vis = Math.max(1, Math.floor(r.h / rowH));
  const first = scrollTo(p.form, list.length, vis);
  for (let i = 0; i < vis; i++) {
    const m = list[first + i];
    if (!m) break;
    const y = r.y + 8 + i * rowH;
    const parts = m.text.split(' – ');
    TF.draw(ctx, parts[0], r.x, y, 14, m.active ? P.yellow : P.grey, 'left', 'middle');
    if (parts[1]) TF.draw(ctx, parts[1].slice(0, 44), r.x + 8, y + 14, 11, m.active ? P.white : P.grey, 'left', 'middle');
  }
}

function drawFpl(ctx: Ctx2D, p: FplPage, r: Rect, time: number): void {
  const f = p.form;
  const rows = p.rows;
  const rowH = p.wide ? 22 : 19;
  const wide = p.wide;
  // Column headers.
  const cDtk = r.x + (wide ? r.w * 0.42 : r.w * 0.55);
  const cDis = r.x + (wide ? r.w * 0.58 : r.w * 0.8);
  const cCum = r.x + r.w * 0.74;
  const cAlt = r.x + r.w;
  TF.draw(ctx, 'DTK', cDtk, r.y + 6, 12, P.white, 'right', 'middle');
  TF.draw(ctx, 'DIS', cDis, r.y + 6, 12, P.white, 'right', 'middle');
  if (wide) {
    TF.draw(ctx, 'CUM', cCum, r.y + 6, 12, P.white, 'right', 'middle');
    TF.draw(ctx, 'ALT', cAlt, r.y + 6, 12, P.white, 'right', 'middle');
  }
  const top = r.y + 22;
  const vis = Math.max(1, Math.floor((r.h - 22) / rowH));
  const total = rows.length + 1;
  const first = scrollTo(f, total, vis);
  for (let i = 0; i < vis; i++) {
    const k = first + i;
    if (k > rows.length) break;
    const y = top + i * rowH + 6;
    const cur = f.active && f.row === k;
    if (p.inserting === k) {
      drawField(ctx, (p as unknown as { activeForm: Form }).activeForm, 'ins', '', r.x + 14, y, 14, P.cyan, 'left', time);
      continue;
    }
    if (k === rows.length) {
      // Empty entry row at the end ("_____").
      if (cur) box(ctx, r.x + 12, y - 8, 60, 16, P.cyan, '');
      TF.draw(ctx, '_____', r.x + 14, y, 14, cur ? '#000000' : P.cyan, 'left', 'middle');
      continue;
    }
    const row = rows[k];
    if (row.kind === 'header') {
      TF.draw(ctx, row.text, r.x + 2, y, 12, P.white, 'left', 'middle');
      continue;
    }
    const color = row.active ? P.magenta : P.white;
    if (row.active) TF.draw(ctx, '▶', r.x + 2, y, 11, P.magenta, 'left', 'middle');
    if (cur) box(ctx, r.x + 12, y - 8, TF.width(ctx, row.text, 14) + 6, 16, P.cyan, '');
    TF.draw(ctx, row.text, r.x + 15, y, 14, cur ? '#000000' : row.kind === 'disco' ? P.grey : color, 'left', 'middle');
    if (Number.isFinite(row.dtk)) TF.draw(ctx, fmtDeg(row.dtk), cDtk, y, 14, color, 'right', 'middle');
    if (Number.isFinite(row.dis)) TF.draw(ctx, fmtFixed(row.dis, 1), cDis, y, 14, color, 'right', 'middle');
    if (wide && Number.isFinite(row.cum)) TF.draw(ctx, fmtInt(row.cum), cCum, y, 14, color, 'right', 'middle');
    if (wide && row.alt) TF.draw(ctx, row.alt, cAlt, y, 13, P.cyan, 'right', 'middle');
  }
  if (p.insertError) TF.draw(ctx, p.insertError, r.x + r.w / 2, r.y + r.h - 8, 12, P.amber, 'center', 'middle');
}

function drawDto(ctx: Ctx2D, sys: G1000System, p: DirectToPage, r: Rect, time: number): void {
  const f = p.form;
  let y = r.y + 10;
  TF.draw(ctx, 'WPT', r.x, y, 12, P.white, 'left', 'middle');
  drawField(ctx, f, 'ident', val(f, 'ident') || '_____', r.x + 40, y, 16, P.cyan, 'left', time);
  y += 22;
  const name = p.airport ? p.airport.name : p.navaid ? p.navaid.name : p.target ? p.target.kind.toUpperCase() : '';
  TF.draw(ctx, name.slice(0, 30), r.x, y, 13, P.white, 'left', 'middle');
  y += 18;
  if (p.airport) TF.draw(ctx, p.airport.municipality.slice(0, 30), r.x, y, 12, P.white, 'left', 'middle');
  y += 22;
  const bd = p.brgDist();
  TF.draw(ctx, 'BRG', r.x, y, 12, P.white, 'left', 'middle');
  TF.draw(ctx, Number.isFinite(bd.brg) ? fmtDeg(bd.brg) : '___°', r.x + 90, y, 14, P.white, 'right', 'middle');
  TF.draw(ctx, 'DIS', r.x + 120, y, 12, P.white, 'left', 'middle');
  TF.draw(ctx, Number.isFinite(bd.dist) ? join2(fmtDist(bd.dist), 'NM') : '__._NM', r.x + r.w, y, 14, P.white, 'right', 'middle');
  y += 22;
  TF.draw(ctx, 'CRS', r.x, y, 12, P.white, 'left', 'middle');
  drawField(ctx, f, 'crs', join2(val(f, 'crs'), '°'), r.x + 90, y, 14, P.cyan, 'right', time);
  y += 30;
  drawField(ctx, f, 'activate', 'Activate?', r.x + r.w / 2, y, 15, P.white, 'center', time);
  void sys;
}

function drawProc(ctx: Ctx2D, p: ProcPage, r: Rect): void {
  const f = p.form;
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    const y = r.y + 10 + i * 19;
    const cur = f.active && f.row === i;
    if (cur) box(ctx, r.x - 2, y - 8, r.w + 4, 17, P.cyan, '');
    TF.draw(ctx, it.label, r.x + 2, y, 13, cur ? '#000000' : it.enabled() ? P.white : P.grey, 'left', 'middle');
  }
  const l = p.loaded();
  let y = r.y + 10 + p.items.length * 19 + 8;
  const row = (k: string, v: string): void => {
    TF.draw(ctx, k, r.x, y, 11, P.white, 'left', 'middle');
    TF.draw(ctx, v || '----', r.x + 70, y, 12, P.cyan, 'left', 'middle');
    y += 15;
  };
  row('DEPARTURE', l.departure);
  row('ARRIVAL', l.arrival);
  row('APPROACH', l.approach);
}

function drawProcLoad(ctx: Ctx2D, p: ProcLoadingPage, r: Rect, time: number): void {
  const f = p.form;
  let y = r.y + 10;
  TF.draw(ctx, 'APT', r.x, y, 12, P.white, 'left', 'middle');
  drawField(ctx, f, 'apt', p.airport || '____', r.x + 60, y, 15, P.cyan, 'left', time);
  y += 22;
  TF.draw(ctx, p.kind === 'approach' ? 'APPROACH' : p.kind === 'arrival' ? 'ARRIVAL' : 'DEPARTURE', r.x, y, 12, P.white, 'left', 'middle');
  y += 17;
  const procTxt = p.loading() ? 'Loading...' : val(f, 'proc') || 'NONE';
  drawField(ctx, f, 'proc', procTxt, r.x + 8, y, 14, P.cyan, 'left', time);
  y += 22;
  TF.draw(ctx, 'TRANS', r.x, y, 12, P.white, 'left', 'middle');
  drawField(ctx, f, 'trans', val(f, 'trans') || '----', r.x + 70, y, 14, P.cyan, 'left', time);
  if (p.kind !== 'approach') {
    y += 20;
    TF.draw(ctx, 'RWY', r.x, y, 12, P.white, 'left', 'middle');
    drawField(ctx, f, 'rwy', val(f, 'rwy') || 'ALL', r.x + 70, y, 14, P.cyan, 'left', time);
  } else {
    y += 20;
    TF.draw(ctx, 'MINS', r.x, y, 12, P.white, 'left', 'middle');
    drawField(ctx, f, 'mins', val(f, 'mins'), r.x + 70, y, 14, P.cyan, 'left', time);
    if (p.minsMode > 0) drawField(ctx, f, 'minsft', join2(val(f, 'minsft'), 'FT'), r.x + r.w, y, 14, P.cyan, 'right', time);
  }
  y += 28;
  drawField(ctx, f, 'load', 'LOAD?', r.x + r.w * 0.28, y, 15, P.white, 'center', time);
  if (p.kind === 'approach') drawField(ctx, f, 'activate', 'ACTIVATE?', r.x + r.w * 0.72, y, 15, P.white, 'center', time);
  if (p.message) TF.draw(ctx, p.message, r.x + r.w / 2, y + 20, 12, P.amber, 'center', 'middle');
}

function drawDme(ctx: Ctx2D, sys: G1000System, p: DmePage, r: Rect, time: number): void {
  const f = p.form;
  TF.draw(ctx, 'DME', r.x, r.y + 12, 13, P.white, 'left', 'middle');
  drawField(ctx, f, 'src', val(f, 'src'), r.x + 60, r.y + 12, 14, P.cyan, 'left', time);
  const rx = sys.dmeReceiver();
  const v = sys.vars;
  const ok = v.get(vn(NAV.dmeValid, rx)) >= 0.5;
  TF.draw(ctx, fmtNav(v.get(vn(NAV.activeFreq, rx))), r.x + r.w, r.y + 12, 14, P.white, 'right', 'middle');
  TF.draw(ctx, ok ? join2(fmtFixed(v.get(vn(NAV.dmeNm, rx)), 1), 'NM') : '---.-NM', r.x + r.w, r.y + 34, 14, P.green, 'right', 'middle');
  void G1K;
}

/** Bearing / distance helper for the MFD pages (re-exported). */
export { brgDist };
