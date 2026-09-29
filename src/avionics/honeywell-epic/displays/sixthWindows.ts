/**
 * 1/6 (and 2/3) text windows: CAS, electronic checklist, waypoint list and
 * the blank window.
 *
 * CAS window (G650ER cockpit photograph, DU #1 lower 1/6; G550 OM 2A-31-00
 * "CAS Display Scroll Switches"): black window, messages in mixed case,
 * red / amber / blue / white, newest first within each level, warnings
 * pinned to the top; new unacknowledged warnings and cautions flash
 * (inverse video, EST); a status bar with an arrow and the number of
 * messages hidden above / below the window. Below the list, the trim /
 * flap strip (same photograph: pitch trim scale with the takeoff band,
 * aileron and rudder trim scales, flap position scale 0 / 10 / 20 / 39).
 *
 * Checklist window (G650ER photograph): checklist title, items with
 * check boxes, dotted leaders and responses, and the menu buttons
 * "Show Items", "Chklst Funct", "Active Abnormal", "Undo Items".
 *
 * Waypoint list: the active flight plan with course, leg distance,
 * cumulative distance, ETE and altitude constraint (EST layout).
 */
import { AP, FMS, GPS } from '../../../core/vars';
import { blinkOn } from '../../common/dynamics';
import { fmtInt } from '../../common/format';
import type { CasMessage } from '../../common/draw/CasWindow';
import type { Ctx2D } from '../../common/draw/context';
import { C, casColor, menuButton, rect, seg, text, textBold } from '../style';
import { EPIC_VARS, Win } from '../vars';
import { EpicWindow, type EpicServices } from './window';
import type { Hotspot } from '../logic/cursor';

// ---------------------------------------------------------------- CAS

const CAS_ROW_H = 22;
/** Height of the trim / flap strip at the bottom of the CAS window. */
const TRIM_STRIP_H = 92;

export class CasWindowEpic extends EpicWindow {
  readonly kind = Win.Cas;
  private readonly rows: CasMessage[] = [];
  private t = 0;
  private shownCount = 0;
  private firstRowIsBar = false;

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    for (let i = 0; i < 40; i++) this.rows.push(null as unknown as CasMessage);
    this.animating = true;
  }

  /** Rows of messages that fit above the trim strip. */
  get visibleRows(): number {
    return Math.max(1, Math.floor((this.h - TRIM_STRIP_H - 26) / CAS_ROW_H));
  }

  protected override onLayout(): void {
    this.spot('cas.list', this.x, this.y, this.w, this.h - TRIM_STRIP_H);
    // One hot spot per row: selecting a message opens its checklist (selectable CAS messages).
    const rows = Math.min(CAS_ROW_IDS.length, this.visibleRows + 1);
    for (let i = 0; i < rows; i++) this.spot(CAS_ROW_IDS[i], this.x + 2, this.y + 6 + i * CAS_ROW_H, this.w - 4, CAS_ROW_H);
  }

  override enter(side: 1 | 2, id: string): void {
    const r = CAS_ROW_IDS.indexOf(id);
    if (r < 0) return;
    const i = r - (this.firstRowIsBar ? 1 : 0);
    if (i < 0 || i >= this.shownCount) return;
    const msg = this.rows[i];
    const ecl = this.svc.checklist;
    const l = ecl.findForCas(msg.text);
    if (l < 0) return;
    ecl.select(l);
    this.svc.windows.checklistCalledUp();
    // EST: the checklist opens in the 2/3 window of the side's MFD.
    this.svc.windows.select(side === 1 ? 2 : 3, 'main', Win.Checklist);
  }

  override update(dt: number): void {
    this.t += dt;
    this.svc.cas.visibleRows = Math.min(this.svc.cas.visibleRows, this.visibleRows);
  }

  /** CCD DATA knob over the CAS list scrolls it like the scroll switch. */
  override data(_side: 1 | 2, _id: string, steps: number): void {
    this.svc.cas.scroll(steps > 0 ? -1 : 1);
  }

  draw(ctx: Ctx2D): void {
    this.frame(ctx, C.black);
    const cas = this.svc.cas;
    const rows = this.visibleRows;
    const n = cas.visible(this.rows, rows);
    const flash = blinkOn(this.t, 1);
    const x0 = this.x + 10;
    let y = this.y + 6;
    const hid = cas.hidden(rows);
    this.shownCount = n;
    this.firstRowIsBar = hid.above > 0;
    if (hid.above > 0) {
      this.statusBar(ctx, y, hid.above, true);
      y += CAS_ROW_H;
    }
    for (let i = 0; i < n; i++) {
      const m = this.rows[i];
      const col = casColor(m.level);
      if (this.hover === CAS_ROW_IDS[i + (this.firstRowIsBar ? 1 : 0)]) rect(ctx, x0 - 6, y, this.w - 12, CAS_ROW_H - 1, C.hiFill, C.white, 1.5);
      if (!m.acknowledged && flash) {
        rect(ctx, x0 - 4, y, this.w - 16, CAS_ROW_H - 2, col, '');
        textBold(ctx, m.text, x0, y + CAS_ROW_H / 2, 17, C.black, 'left', 'middle');
      } else textBold(ctx, m.text, x0, y + CAS_ROW_H / 2, 17, col, 'left', 'middle');
      y += CAS_ROW_H;
    }
    if (hid.below > 0) this.statusBar(ctx, this.y + this.h - TRIM_STRIP_H - CAS_ROW_H - 2, hid.below, false);
    this.trimStrip(ctx, this.y + this.h - TRIM_STRIP_H);
  }

  private statusBar(ctx: Ctx2D, y: number, count: number, up: boolean): void {
    rect(ctx, this.x + 4, y, this.w - 8, CAS_ROW_H - 2, C.winBgLight, '');
    const cx = this.x + this.w / 2;
    ctx.fillStyle = C.white;
    ctx.beginPath();
    const ay = y + CAS_ROW_H / 2 - 1;
    if (up) {
      ctx.moveTo(cx - 60, ay + 5);
      ctx.lineTo(cx - 52, ay - 5);
      ctx.lineTo(cx - 44, ay + 5);
    } else {
      ctx.moveTo(cx - 60, ay - 5);
      ctx.lineTo(cx - 52, ay + 5);
      ctx.lineTo(cx - 44, ay - 5);
    }
    ctx.fill();
    text(ctx, fmtInt(count), cx - 30, ay, 15, C.white, 'left', 'middle');
    text(ctx, 'More', cx - 8, ay, 15, C.white, 'left', 'middle');
  }

  /** Pitch / aileron / rudder trim and flap position strip. */
  private trimStrip(ctx: Ctx2D, y0: number): void {
    const v = this.vars;
    const af = this.svc.cfg.airframe;
    seg(ctx, this.x + 4, y0, this.x + this.w - 4, y0, C.winLine, 1);
    // ---- pitch trim: vertical scale, NU at the top.
    const pt = af.pitchTrim;
    const px = this.x + 34;
    const top = y0 + 18;
    const bot = y0 + TRIM_STRIP_H - 12;
    const k = (bot - top) / (pt.max - pt.min);
    rect(ctx, px - 3, top, 6, bot - top, C.black, C.white, 1);
    rect(ctx, px - 3, bot - (pt.greenHi - pt.min) * k, 6, (pt.greenHi - pt.greenLo) * k, C.green, '');
    text(ctx, 'NU', px - 16, top + 2, 12, C.white, 'center', 'middle');
    text(ctx, 'ND', px - 16, bot - 2, 12, C.white, 'center', 'middle');
    text(ctx, 'Pitch', px, y0 + 8, 12, C.white, 'center', 'middle');
    const pv = v.get(pt.var);
    const py = bot - (Math.max(pt.min, Math.min(pt.max, pv)) - pt.min) * k;
    const onGround = v.get('gear.air_ground') !== 0;
    const inBand = pv >= pt.greenLo && pv <= pt.greenHi;
    this.pointer(ctx, px + 5, py, 'left', onGround && !inBand ? C.amber : C.white);
    // ---- aileron / rudder trim: horizontal scales.
    const hx = this.x + 72;
    const hw = this.w * 0.42;
    this.hScale(ctx, hx, y0 + 30, hw, 'LWD', 'RWD', 'Aileron', v.get(af.aileronTrimVar));
    this.hScale(ctx, hx, y0 + 70, hw, 'NL', 'NR', 'Rudder', v.get(af.rudderTrimVar));
    // ---- flaps: vertical scale with the detents.
    const fx = this.x + this.w - 56;
    const det = af.flapDetents;
    const fmax = det[det.length - 1] || 1;
    seg(ctx, fx, top, fx, bot, C.white, 2);
    for (let i = 0; i < det.length; i++) {
      const yy = top + (det[i] / fmax) * (bot - top);
      seg(ctx, fx - 6, yy, fx, yy, C.white, 2);
      text(ctx, DETENT_LABELS[det[i]] ?? String(det[i]), fx - 10, yy, 12, C.white, 'right', 'middle');
    }
    text(ctx, 'Flaps', fx + 6, y0 + 8, 12, C.white, 'center', 'middle');
    const fd = v.get('surf.flaps_deg');
    this.pointer(ctx, fx + 3, top + (Math.max(0, Math.min(fmax, fd)) / fmax) * (bot - top), 'left', C.white);
    textBold(ctx, fmtInt(Math.round(fd)), fx + 34, bot - 8, 15, C.white, 'right', 'middle');
  }

  private hScale(ctx: Ctx2D, x: number, y: number, w: number, l: string, r: string, title: string, val: number): void {
    seg(ctx, x, y, x + w, y, C.white, 2);
    seg(ctx, x + w / 2, y - 5, x + w / 2, y + 5, C.white, 2);
    text(ctx, l, x, y + 13, 11, C.white, 'left', 'middle');
    text(ctx, r, x + w, y + 13, 11, C.white, 'right', 'middle');
    text(ctx, title, x + w / 2, y - 13, 12, C.white, 'center', 'middle');
    const px = x + w / 2 + Math.max(-1, Math.min(1, Number.isFinite(val) ? val : 0)) * (w / 2);
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(px, y - 1);
    ctx.lineTo(px - 6, y - 10);
    ctx.lineTo(px + 6, y - 10);
    ctx.closePath();
    ctx.fill();
  }

  private pointer(ctx: Ctx2D, x: number, y: number, dir: 'left', color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (dir === 'left') {
      ctx.moveTo(x, y);
      ctx.lineTo(x + 11, y - 6);
      ctx.lineTo(x + 11, y + 6);
    }
    ctx.closePath();
    ctx.fill();
  }
}

const DETENT_LABELS: Record<number, string> = { 0: '0', 10: '10', 20: '20', 39: '39' };
const CAS_ROW_IDS: string[] = [];
for (let i = 0; i < 24; i++) CAS_ROW_IDS.push(`cas.row${i}`);

// ---------------------------------------------------------------- checklist

const ITEM_IDS: string[] = [];
for (let i = 0; i < 80; i++) ITEM_IDS.push(`ecl.item${i}`);
const ECL_BUTTONS = ['ecl.show', 'ecl.funct', 'ecl.abn', 'ecl.undo'] as const;
const ECL_BUTTON_LABELS = ['Show Items', 'Chklst Funct', 'Active Abnormal', 'Undo Items'] as const;
const FUNCT_IDS = ['ecl.f.index', 'ecl.f.next', 'ecl.f.prev', 'ecl.f.reset', 'ecl.f.resetall', 'ecl.f.close'] as const;
const FUNCT_LABELS = ['Index', 'Next Checklist', 'Previous Checklist', 'Reset Checklist', 'Reset All', 'Close'] as const;

export class ChecklistWindow extends EpicWindow {
  readonly kind = Win.Checklist;
  private first = 0;
  private functOpen = false;
  private rowH = 24;
  private listTop = 0;
  private listRows = 0;
  private readonly visIdx: number[] = [];
  private readonly buttons: Hotspot[] = [];

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    this.animating = true;
  }

  protected override onLayout(): void {
    this.hotspots.length = 0;
    this.buttons.length = 0;
    const bh = 30;
    const main = this.format !== 'sixth';
    const btnY = this.y + this.h - (main ? bh + 6 : 2 * bh + 10);
    if (main) {
      const bw = (this.w - 10 * 5) / 4;
      for (let i = 0; i < 4; i++) this.buttons.push(this.spot(ECL_BUTTONS[i], this.x + 10 + i * (bw + 10), btnY, bw, bh));
    } else {
      const bw = (this.w - 30) / 2;
      for (let i = 0; i < 4; i++) this.buttons.push(this.spot(ECL_BUTTONS[i], this.x + 10 + (i % 2) * (bw + 10), btnY + Math.floor(i / 2) * (bh + 4), bw, bh));
    }
    this.listTop = this.y + 34;
    this.rowH = main ? 28 : 24;
    this.listRows = Math.max(1, Math.floor((btnY - 6 - this.listTop) / this.rowH));
    for (let r = 0; r < this.listRows && r < ITEM_IDS.length; r++) this.spot(ITEM_IDS[r], this.x + 4, this.listTop + r * this.rowH, this.w - 8, this.rowH);
    // Function menu (drawn over the list while open).
    for (let i = 0; i < FUNCT_IDS.length; i++) this.spot(FUNCT_IDS[i], this.x + 20, this.listTop + 4 + i * 32, this.w - 40, 28);
  }

  /** Visible item indices (all items or remaining items only). */
  private buildVisible(): number {
    const ecl = this.svc.checklist;
    const l = ecl.current;
    this.visIdx.length = 0;
    if (l < 0) {
      for (let i = 0; i < ecl.lists.length; i++) this.visIdx.push(i);
      return l;
    }
    const n = ecl.lists[l].items.length;
    for (let i = 0; i < n; i++) if (!ecl.showRemainingOnly || !ecl.itemDone(l, i)) this.visIdx.push(i);
    return l;
  }

  override update(_dt: number): void {
    this.buildVisible();
    // Keep the cursor item in view.
    const cur = this.svc.checklist.cursor;
    const k = this.visIdx.indexOf(cur);
    if (k >= 0) {
      if (k < this.first) this.first = k;
      else if (k >= this.first + this.listRows) this.first = k - this.listRows + 1;
    }
    this.first = Math.max(0, Math.min(this.first, Math.max(0, this.visIdx.length - this.listRows)));
  }

  override enter(_side: 1 | 2, id: string): void {
    const ecl = this.svc.checklist;
    if (this.functOpen) {
      const f = FUNCT_IDS.indexOf(id as (typeof FUNCT_IDS)[number]);
      if (f === 0) ecl.select(-1);
      else if (f === 1) ecl.next();
      else if (f === 2) ecl.prev();
      else if (f === 3) this.resetCurrent();
      else if (f === 4) ecl.resetAll();
      if (f >= 0) this.functOpen = false;
      return;
    }
    switch (id) {
      case 'ecl.show':
        ecl.showRemainingOnly = !ecl.showRemainingOnly;
        return;
      case 'ecl.funct':
        this.functOpen = true;
        return;
      case 'ecl.abn': {
        const a = ecl.firstAbnormal();
        if (a >= 0) ecl.select(a);
        return;
      }
      case 'ecl.undo':
        ecl.undo();
        return;
      default:
        break;
    }
    const r = ITEM_IDS.indexOf(id);
    if (r >= 0) {
      const k = this.first + r;
      if (k >= this.visIdx.length) return;
      const item = this.visIdx[k];
      if (ecl.current < 0) ecl.select(item);
      else ecl.toggle(item);
    }
  }

  override data(_side: 1 | 2, _id: string, steps: number): void {
    const ecl = this.svc.checklist;
    const k = this.visIdx.indexOf(ecl.cursor);
    const nk = Math.max(0, Math.min(this.visIdx.length - 1, (k < 0 ? 0 : k) + Math.sign(steps)));
    if (this.visIdx.length) this.vars.set(EPIC_VARS.eclCursor, this.visIdx[nk]);
  }

  private resetCurrent(): void {
    const ecl = this.svc.checklist;
    const l = ecl.current;
    if (l < 0) return;
    ecl.checked[l].fill(false);
    ecl.select(l);
  }

  draw(ctx: Ctx2D): void {
    const ecl = this.svc.checklist;
    this.frame(ctx, C.winBg);
    const l = ecl.current;
    const title = l < 0 ? 'Checklist Index' : ecl.lists[l].title;
    textBold(ctx, title, this.x + this.w / 2, this.y + 16, 17, C.white, 'center', 'middle');
    seg(ctx, this.x + 6, this.y + 30, this.x + this.w - 6, this.y + 30, C.winLine, 1);
    const cur = ecl.cursor;
    const sz = this.format === 'sixth' ? 14 : 16;
    if (!ecl.lists.length) text(ctx, 'No checklists loaded', this.x + this.w / 2, this.listTop + 30, sz, C.white, 'center', 'middle');
    for (let r = 0; r < this.listRows; r++) {
      const k = this.first + r;
      if (k >= this.visIdx.length) break;
      const i = this.visIdx[k];
      const y = this.listTop + r * this.rowH;
      const hi = this.hover === ITEM_IDS[r];
      if (i === cur) rect(ctx, this.x + 4, y + 1, this.w - 8, this.rowH - 2, hi ? C.hiFill : '', C.cyan, 2);
      else if (hi) rect(ctx, this.x + 4, y + 1, this.w - 8, this.rowH - 2, C.hiFill, C.white, 2);
      const cy = y + this.rowH / 2;
      if (l < 0) {
        const c = ecl.lists[i];
        text(ctx, c.title, this.x + 14, cy, sz, ecl.isComplete(i) ? C.green : C.white, 'left', 'middle');
        text(ctx, c.phase, this.x + this.w - 12, cy, sz - 2, C.cyan, 'right', 'middle');
        continue;
      }
      const it = ecl.lists[l].items[i];
      const done = ecl.itemDone(l, i);
      const sensed = ecl.sensed[l][i];
      // Check box.
      const bx = this.x + 10;
      const bs = this.rowH - 10;
      rect(ctx, bx, cy - bs / 2, bs, bs, sensed ? C.green : C.black, done ? C.green : C.white, 1);
      if (done && !sensed) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(bx + 3, cy);
        ctx.lineTo(bx + bs * 0.42, cy + bs * 0.32);
        ctx.lineTo(bx + bs - 2, cy - bs * 0.38);
        ctx.stroke();
      }
      const col = done ? C.green : C.white;
      const tx = bx + bs + 8;
      text(ctx, it.challenge, tx, cy, sz, col, 'left', 'middle');
      text(ctx, it.response, this.x + this.w - 10, cy, sz, col, 'right', 'middle');
      // Dotted leader between challenge and response (EST: fixed dot pitch).
      const cw = ctx.measureText(it.challenge).width;
      const rw = ctx.measureText(it.response).width;
      const d0 = tx + cw + 6;
      const d1 = this.x + this.w - 16 - rw;
      ctx.fillStyle = col;
      for (let dx = d0; dx < d1; dx += 6) ctx.fillRect(dx, cy + 4, 2, 2);
    }
    if (l >= 0 && ecl.isComplete(l)) textBold(ctx, 'Checklist Complete', this.x + this.w / 2, this.listTop + this.listRows * this.rowH - 6, sz, C.green, 'center', 'middle');
    for (let i = 0; i < this.buttons.length; i++) {
      const s = this.buttons[i];
      menuButton(ctx, s.x, s.y, s.w, s.h, ECL_BUTTON_LABELS[i], this.hover === s.id, (i === 0 && ecl.showRemainingOnly) || (i === 1 && this.functOpen), false, this.format === 'sixth' ? 13 : 15);
    }
    if (this.functOpen) {
      rect(ctx, this.x + 12, this.listTop - 4, this.w - 24, FUNCT_IDS.length * 32 + 12, C.menuFill, C.white, 1);
      for (let i = 0; i < FUNCT_IDS.length; i++) {
        const y = this.listTop + 4 + i * 32;
        const hi = this.hover === FUNCT_IDS[i];
        rect(ctx, this.x + 20, y, this.w - 40, 28, hi ? C.hiFill : C.winBgLight, hi ? C.white : C.winLine, hi ? 2 : 1);
        text(ctx, FUNCT_LABELS[i], this.x + this.w / 2, y + 15, 15, C.white, 'center', 'middle');
      }
    }
  }
}

// ---------------------------------------------------------------- waypoint list

/** Cached row texts of the waypoint list (rebuilt at 1 Hz / on plan changes). */
interface WptRow {
  ident: string;
  crs: string;
  dist: string;
  ete: string;
  alt: string;
  active: boolean;
}

export class WptListWindow extends EpicWindow {
  readonly kind = Win.WptList;
  private readonly rowsCache: WptRow[] = [];
  private count = 0;
  private first = 0;
  private refresh = 0;
  private lastVersion = -1;
  private lastActive = -1;

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    for (let i = 0; i < 200; i++) this.rowsCache.push({ ident: '', crs: '', dist: '', ete: '', alt: '', active: false });
    this.spot('wpt.list', 0, 0, 0, 0);
  }

  protected override onLayout(): void {
    this.spot('wpt.list', this.x, this.y, this.w, this.h);
  }

  override data(_side: 1 | 2, _id: string, steps: number): void {
    this.first = Math.max(0, Math.min(Math.max(0, this.count - 3), this.first + Math.sign(steps)));
  }

  override update(dt: number): void {
    const v = this.vars;
    const ver = v.get(FMS.planVersion);
    const act = v.get(FMS.activeLegIndex);
    this.refresh -= dt;
    if (this.refresh > 0 && ver === this.lastVersion && act === this.lastActive) return;
    this.refresh = 1;
    const scrollToActive = act !== this.lastActive;
    this.lastVersion = ver;
    this.lastActive = act;
    this.rebuild(act);
    if (scrollToActive) this.first = Math.max(0, act - 1);
  }

  private rebuild(active: number): void {
    const plan = this.svc.fms?.plans.active ?? null;
    const legs = plan?.legs ?? [];
    const v = this.vars;
    const gs = Math.max(60, v.get(GPS.gs));
    let cum = v.get(FMS.distToWptNm);
    let n = 0;
    for (let i = Math.max(0, active); i < legs.length && n < this.rowsCache.length; i++) {
      const l = legs[i];
      const r = this.rowsCache[n++];
      r.ident = l.fix?.ident ?? (l.type === 'VM' || l.type === 'FM' ? '(VECT)' : l.type === 'CA' || l.type === 'VA' || l.type === 'FA' ? '(ALT)' : '----');
      const g = l.geom;
      const crs = g.valid && Number.isFinite(g.courseTrue) ? Math.round((((g.courseTrue - (l.magVar ?? 0)) % 360) + 360) % 360) : NaN;
      r.crs = Number.isFinite(crs) ? `${(crs === 0 ? 360 : crs).toString().padStart(3, '0')}°` : '';
      if (i > active && g.valid) cum += g.lengthNm;
      r.dist = Number.isFinite(cum) ? (cum < 100 ? cum.toFixed(1) : Math.round(cum).toString()) : '';
      const ete = (cum / gs) * 60;
      r.ete = Number.isFinite(ete) ? `${Math.floor(ete / 60)}+${Math.round(ete % 60).toString().padStart(2, '0')}` : '';
      const a = l.altitude;
      r.alt = a ? `${Math.round(a.lowerFt ?? a.upperFt ?? 0)}${a.kind === 'atOrAbove' ? 'A' : a.kind === 'atOrBelow' ? 'B' : ''}` : '';
      r.active = i === active;
    }
    this.count = n;
  }

  draw(ctx: Ctx2D): void {
    this.frame(ctx, C.winBg);
    textBold(ctx, 'Waypoint List', this.x + 10, this.y + 14, 16, C.white, 'left', 'middle');
    const sixth = this.format === 'sixth';
    const cols: readonly number[] = sixth ? COLS_SIXTH : COLS_MAIN;
    const y0 = this.y + 34;
    const sz = sixth ? 13 : 15;
    for (let c = 0; c < cols.length; c++) text(ctx, COL_TITLES[c], this.x + cols[c] * this.w, y0, sz - 1, C.white, c === 0 ? 'left' : 'right', 'middle');
    seg(ctx, this.x + 6, y0 + 10, this.x + this.w - 6, y0 + 10, C.winLine, 1);
    const rowH = sixth ? 22 : 26;
    const rows = Math.floor((this.h - 54) / rowH);
    if (!this.count) text(ctx, 'No Flight Plan', this.x + this.w / 2, y0 + 40, sz, C.white, 'center', 'middle');
    for (let k = 0; k < rows; k++) {
      const i = this.first + k;
      if (i >= this.count) break;
      const r = this.rowsCache[i];
      const y = y0 + 24 + k * rowH;
      const col = r.active ? C.magenta : C.white;
      text(ctx, r.ident, this.x + cols[0] * this.w, y, sz, col, 'left', 'middle');
      text(ctx, r.crs, this.x + cols[1] * this.w, y, sz, col, 'right', 'middle');
      text(ctx, r.dist, this.x + cols[2] * this.w, y, sz, col, 'right', 'middle');
      text(ctx, r.ete, this.x + cols[3] * this.w, y, sz, col, 'right', 'middle');
      if (!sixth) text(ctx, r.alt, this.x + COLS_MAIN[4] * this.w, y, sz, C.cyan, 'right', 'middle');
    }
    // Selected altitude reminder (bottom line).
    const sel = this.vars.get(AP.selAltitude);
    text(ctx, 'Sel Alt', this.x + 10, this.y + this.h - 12, sz - 1, C.white, 'left', 'middle');
    text(ctx, fmtInt(sel), this.x + 90, this.y + this.h - 12, sz, C.cyan, 'left', 'middle');
  }
}

const COL_TITLES = ['Wpt', 'Crs', 'Dist', 'ETE', 'Alt'] as const;
const COLS_SIXTH = [0.03, 0.47, 0.72, 0.97] as const;
const COLS_MAIN = [0.03, 0.34, 0.55, 0.74, 0.97] as const;

// ---------------------------------------------------------------- blank

export class BlankWindow extends EpicWindow {
  readonly kind = Win.Blank;
  draw(ctx: Ctx2D): void {
    this.frame(ctx, C.winBg);
  }
}
