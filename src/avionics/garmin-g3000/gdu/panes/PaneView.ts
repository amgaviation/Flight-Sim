/**
 * Display pane container (MFD half / full panes and the PFD split pane).
 *
 * The pane shows whatever `g3k.pane.<id>.content` selects (PANE_CONTENT) and
 * outlines itself when a GTC in MFD mode controls it: G3000 PG 190-02046-01
 * §1.3 "Controlling Display Panes" — the selected pane is outlined in cyan
 * and a small tab on the pane edge points to the controlling GTC (left tab =
 * pilot-side GTC, right tab = copilot-side GTC). Views are created lazily the
 * first time a content is selected and kept afterwards (no allocation while
 * flying).
 */
import type { Ctx2D, Rect } from '../../../common/draw/context';
import { box } from '../../../common/draw/context';
import type { G3000System } from '../../state/System';
import { G3K, PANE_CONTENT, PANE_CONTENT_NAMES, vn, type PaneContent, type PaneId } from '../../vars';
import { G3K_COLORS, G3K_PALETTE, TF, dataBox } from '../style';
import { MapPane } from './MapPane';
import {
  ChartsPane,
  ChecklistPane,
  FplPane,
  GpsStatusPane,
  NearestPane,
  SynopticsPane,
  ToldPane,
  TripPane,
  WaypointInfoPane,
  WeightFuelPane,
  type PaneContentView,
} from './TextPanes';

const P = G3K_PALETTE;

/** Border width of the GTC selection outline and title band height (TBM CRG Figure 3-1: ~16 px). */
const SEL_W = 3;
const TITLE_H = 17;
/** Upper-case pane titles. */
const TITLES: Record<number, string> = {};
for (const [k, n] of Object.entries(PANE_CONTENT_NAMES)) TITLES[Number(k)] = n.toUpperCase();

export class PaneView {
  readonly map: MapPane;
  private rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly inner: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly textRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly views = new Map<PaneContent, PaneContentView>();
  private content: PaneContent = PANE_CONTENT.navMap;

  constructor(
    readonly sys: G3000System,
    readonly id: PaneId,
  ) {
    this.map = new MapPane(sys, id, id, this.inner);
  }

  setRect(r: Rect): void {
    if (r.x === this.rect.x && r.y === this.rect.y && r.w === this.rect.w && r.h === this.rect.h) return;
    this.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    const i = this.inner;
    i.x = r.x + SEL_W;
    i.y = r.y + TITLE_H;
    i.w = r.w - 2 * SEL_W;
    i.h = r.h - TITLE_H - SEL_W;
    this.map.setRect({ x: i.x, y: i.y, w: i.w, h: i.h });
  }

  get current(): PaneContent {
    return this.content;
  }

  private isMap(c: PaneContent): boolean {
    return c === PANE_CONTENT.navMap || c === PANE_CONTENT.traffic || c === PANE_CONTENT.weather || c === PANE_CONTENT.taws || c === PANE_CONTENT.procedure;
  }

  private view(c: PaneContent): PaneContentView | null {
    let v = this.views.get(c);
    if (v) return v;
    const s = this.sys;
    switch (c) {
      case PANE_CONTENT.flightPlan:
        v = new FplPane(s);
        break;
      case PANE_CONTENT.waypointInfo:
        v = new WaypointInfoPane(s);
        break;
      case PANE_CONTENT.nearest:
        v = new NearestPane(s);
        break;
      case PANE_CONTENT.checklist:
        v = new ChecklistPane(s);
        break;
      case PANE_CONTENT.synoptics:
        v = new SynopticsPane(s, vn(G3K.paneSynoptic, this.id));
        break;
      case PANE_CONTENT.charts:
        v = new ChartsPane();
        break;
      case PANE_CONTENT.tripPlanning:
        v = new TripPane(s);
        break;
      case PANE_CONTENT.gpsStatus:
        v = new GpsStatusPane(s);
        break;
      case PANE_CONTENT.weightFuel:
        v = new WeightFuelPane(s);
        break;
      case PANE_CONTENT.told:
        v = new ToldPane(s);
        break;
      default:
        return null;
    }
    this.views.set(c, v);
    return v;
  }

  update(dt: number): void {
    const c = this.sys.paneContent(this.id);
    this.content = c;
    if (this.isMap(c)) {
      this.map.mode = c === PANE_CONTENT.traffic ? 'traffic' : c === PANE_CONTENT.weather ? 'weather' : c === PANE_CONTENT.taws ? 'taws' : 'nav';
      this.map.update(dt);
    } else this.view(c)?.update(dt);
  }

  draw(ctx: Ctx2D): void {
    const r = this.rect;
    const c = this.content;
    const owner = this.sys.paneOwner(this.id);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    box(ctx, r.x, r.y, r.w, r.h, G3K_COLORS.paneBg, '');
    if (this.isMap(c)) {
      this.map.draw(ctx);
      if (c === PANE_CONTENT.procedure) this.drawProcBanner(ctx);
    } else {
      const v = this.view(c);
      const t = this.textRect;
      t.x = r.x + 4;
      t.y = r.y + TITLE_H + 2;
      t.w = r.w - 8;
      t.h = r.h - TITLE_H - 6;
      if (v) v.draw(ctx, t);
    }
    ctx.restore();
    // Frame, title tab and GTC selection outline (TBM CRG Figure 3-1: cyan frame with the pane title on a cyan tab).
    const sel = !!owner;
    const col = sel ? P.cyan : G3K_COLORS.softkeySep;
    ctx.strokeStyle = col;
    ctx.lineWidth = sel ? SEL_W : 2;
    ctx.strokeRect(r.x + ctx.lineWidth / 2, r.y + ctx.lineWidth / 2, r.w - ctx.lineWidth, r.h - ctx.lineWidth);
    const title = this.title(c);
    const tw = TF.width(ctx, title, 15) + 16;
    if (sel) box(ctx, r.x, r.y, r.w, TITLE_H, P.cyan, '');
    box(ctx, r.x + r.w / 2 - tw / 2, r.y + 1, tw, TITLE_H - 2, sel ? '#e8f8fc' : '#1a1d21', '', 1, 2);
    TF.draw(ctx, title, r.x + r.w / 2, r.y + TITLE_H / 2 + 1, 15, sel ? '#000000' : P.white, 'center', 'middle');
    if (owner) {
      // Small tab toward the controlling GTC (left = pilot side, right = copilot side). EST.
      const tx = owner.side === 1 ? r.x + 6 : r.x + r.w - 6 - 30;
      TF.draw(ctx, owner.side === 1 ? '◄' : '►', tx + 15, r.y + TITLE_H / 2 + 1, 12, '#000000', 'center', 'middle');
    }
  }

  private title(c: PaneContent): string {
    if (c === PANE_CONTENT.synoptics) {
      const v = this.views.get(c) as SynopticsPane | undefined;
      const t = v?.title();
      if (t) return t;
    }
    return TITLES[c] ?? '';
  }

  /** Procedure preview label (PG §5.4 "Previewing a procedure": the map shows the selected procedure). */
  private drawProcBanner(ctx: Ctx2D): void {
    const p = this.sys.ui.procPreview;
    const r = this.inner;
    dataBox(ctx, r.x + r.w / 2 - 150, r.y + 4, 300, 44, 'rgba(0,0,0,0.8)');
    TF.draw(ctx, 'PROCEDURE PREVIEW', r.x + r.w / 2, r.y + 16, 13, P.white, 'center', 'middle');
    const text = p ? p.ident : 'NO PROCEDURE SELECTED';
    TF.draw(ctx, text, r.x + r.w / 2, r.y + 36, 16, p ? P.cyan : P.white, 'center', 'middle');
  }

  movePointer(dx: number, dy: number): void {
    if (this.isMap(this.content)) this.map.movePointer(dx, dy);
  }
}
