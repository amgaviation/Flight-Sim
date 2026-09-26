/**
 * GTC touchscreen controller as a cockpit `CanvasDisplay` with `onPointer`.
 *
 *  - GTC 570 (vertical, 480 x 640 logical): CNS bar (Audio & Radios, COM1 /
 *    COM2 active + standby, transponder), control-mode tabs when the unit
 *    offers several modes, screen title tab, page, button bar (Back, Home,
 *    MSG, Full / Half / Split, page buttons) and the label bar with the
 *    functions of the three knobs below the screen (Longitude OG 4-9 / 4-10).
 *  - GTC 580 (horizontal, 1280 x 768 logical at 0.8): title tab, page,
 *    button bar on the right, label bar at the right edge next to the dual
 *    upper knob, the three mode softkeys (selected mode boxed with a green
 *    arrow) and the lower knob (PG 190-02046-01 §1.3 Figure 1-12).
 *
 * Touch: a button highlights blue while touched and acts when the finger is
 * released inside it (PG §1.3 "Touchscreen Controller"). The knobs, joystick
 * and mode softkeys are EventBus events handled by `GtcController`.
 */
import { CanvasDisplay, createDisplayCanvas, type DisplayCanvas } from '../../common/CanvasDisplay';
import { blinkOn } from '../../common/dynamics';
import { box, line, type Ctx2D, type Rect } from '../../common/draw/context';
import type { ResolvedGtc } from '../config';
import type { G3000System } from '../state/System';
import { NAV } from '../../../core/vars';
import { fmtCom, fmtSquawk } from '../format';
import { G3K, type GtcModeName } from '../vars';
import { G3K_PALETTE, TF, TF_LIGHT } from '../gdu/style';
import { GtcController } from './GtcController';
import type { BarButton } from './GtcPage';
import { Button, GTC_COLORS, drawTitleTab, splitLines, type Widget } from './ui';
import { homeFactory, messagesFactory } from './pages/home';
import { comKeypad, AudioRadiosPage, XpdrPage, xpdrModeLabel } from './pages/radios';

const P = G3K_PALETTE;

export interface GtcDisplayOptions {
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  pixelRatio?: number;
  refreshHz?: number;
  id?: string;
  brightnessVar?: string | null;
}

const MODE_LABEL: Record<GtcModeName, string> = { PFD: 'PFD', MFD: 'MFD', NAVCOM: 'NAV/COM' };

interface Layout {
  W: number;
  H: number;
  horizontal: boolean;
  cns: Rect | null;
  tabs: Rect | null;
  titleY: number;
  content: Rect;
  bar: Rect;
  labels: Rect;
}

export class GtcDisplay extends CanvasDisplay {
  readonly gtc: GtcController;
  readonly sys: G3000System;
  readonly g: ResolvedGtc;
  private readonly L: Layout;
  private readonly chrome: Widget[] = [];
  private readonly barSlots: Button[] = [];
  private pressed: Widget | null = null;
  private pressedInside = false;
  private lastRev = -1;
  private mode: 'off' | 'boot' | 'startup' | 'run' = 'off';

  constructor(sys: G3000System, g: ResolvedGtc, opts: GtcDisplayOptions = {}) {
    const horizontal = g.orientation === 'horizontal';
    const W = horizontal ? 1280 : 480;
    const H = horizontal ? 768 : 640;
    super({
      id: opts.id ?? g.id,
      width: W,
      height: H,
      pixelRatio: opts.pixelRatio ?? g.pixelRatio,
      refreshHz: opts.refreshHz ?? 20,
      vars: sys.vars,
      powerVar: `display.${g.id}.power`,
      brightnessVar: opts.brightnessVar,
      canvas: opts.canvas,
      background: GTC_COLORS.bg,
    });
    this.sys = sys;
    this.g = g;
    this.gtc = new GtcController(sys, g, homeFactory);
    this.gtc.messagesPage = messagesFactory;
    this.L = this.computeLayout(W, H, horizontal);
    this.buildChrome();
  }

  private computeLayout(W: number, H: number, horizontal: boolean): Layout {
    const g = this.g;
    if (horizontal) {
      const barW = 150;
      const labW = 130;
      const cns = g.cnsBar ? { x: 0, y: 0, w: W - barW - labW, h: 64 } : null;
      const top = cns ? 64 : 0;
      return {
        W,
        H,
        horizontal,
        cns,
        tabs: null,
        titleY: top,
        content: { x: 10, y: top + 46, w: W - barW - labW - 20, h: H - top - 52 },
        bar: { x: W - barW - labW, y: 0, w: barW, h: H },
        labels: { x: W - labW, y: 0, w: labW, h: H },
      };
    }
    const cns = g.cnsBar ? { x: 0, y: 0, w: W, h: 58 } : null;
    let top = cns ? 58 : 0;
    const tabs = g.modes.length > 1 ? { x: 0, y: top, w: W, h: 40 } : null;
    if (tabs) top += 40;
    const labelsH = 40;
    const barH = 66;
    return {
      W,
      H,
      horizontal,
      cns,
      tabs,
      titleY: top,
      content: { x: 4, y: top + 36, w: W - 8, h: H - top - 36 - barH - labelsH - 4 },
      bar: { x: 0, y: H - barH - labelsH, w: W, h: barH },
      labels: { x: 0, y: H - labelsH, w: W, h: labelsH },
    };
  }

  // ------------------------------------------------------------ chrome (CNS bar, tabs, button bar)

  private buildChrome(): void {
    const L = this.L;
    const gtc = this.gtc;
    const sys = this.sys;
    const v = sys.vars;
    const w833 = () => v.get(G3K.comSpacing833) >= 0.5;
    const micVar = G3K.micSelect(this.g.side);
    if (L.cns) {
      const c = L.cns;
      const aw = c.w * 0.16;
      const cw = c.w * 0.3;
      const xw = c.w - aw - 2 * cw;
      this.chrome.push(new Button(c.x + 2, c.y + 2, aw - 4, c.h - 4, { label: 'Audio', icon: 'audio', size: 13, onPress: () => this.gotoNavCom(() => new AudioRadiosPage(gtc)) }));
      for (const r of [1, 2] as const) {
        const x = c.x + aw + (r - 1) * cw;
        this.chrome.push(
          new Button(x + 2, c.y + 2, cw - 4, c.h - 4, {
            label: () => fmtCom(sys.comActive(r), w833()),
            value: () => fmtCom(sys.comStandby(r), w833()),
            valueColor: P.white,
            size: 19,
            selected: () => v.get(micVar) === r,
            onPress: () => this.gotoNavCom(() => comKeypad(gtc, r)),
          }),
        );
      }
      this.chrome.push(
        new Button(c.x + aw + 2 * cw + 2, c.y + 2, xw - 4, c.h - 4, {
          label: () => fmtSquawk(v.get(NAV.xpdrCode)),
          value: () => xpdrModeLabel(sys),
          valueColor: () => (v.get(NAV.xpdrMode) >= 2 ? '#00e000' : P.white),
          size: 19,
          onPress: () => this.gotoNavCom(() => new XpdrPage(gtc)),
        }),
      );
    }
    if (L.tabs) {
      const t = L.tabs;
      const n = this.g.modes.length;
      const tw = t.w / n;
      this.g.modes.forEach((m, i) => {
        this.chrome.push(new Button(t.x + i * tw + 3, t.y + 3, tw - 6, t.h - 6, { label: MODE_LABEL[m], size: 16, selected: () => gtc.mode === m, onPress: () => gtc.setMode(m) }));
      });
    }
    // Button bar slots: Back, Home, MSG, pane size, two page buttons.
    const b = L.bar;
    const slots = 6;
    const mk = (i: number): Button => {
      const horizontal = L.horizontal;
      const sw = horizontal ? b.w - 12 : (b.w - 8) / slots - 6;
      const sh = horizontal ? (b.h - 16) / slots - 8 : b.h - 10;
      const x = horizontal ? b.x + 6 : b.x + 4 + i * ((b.w - 8) / slots) + 3;
      const y = horizontal ? b.y + 8 + i * ((b.h - 16) / slots) + 4 : b.y + 5;
      const btn = new Button(x, y, sw, sh, { label: '', size: horizontal ? 18 : 14 });
      this.barSlots.push(btn);
      this.chrome.push(btn);
      return btn;
    };
    const back = mk(0);
    Object.assign(back.o, { label: () => (gtc.page.dialog ? 'Cancel' : 'Back'), icon: 'back', onPress: () => gtc.back() });
    const home = mk(1);
    Object.assign(home.o, { label: 'Home', icon: 'home', onPress: () => gtc.homePage() });
    const msg = mk(2);
    Object.assign(msg.o, {
      label: 'MSG',
      icon: 'msg',
      onPress: () => gtc.showMessages(),
      selected: () => v.get(G3K.msgUnread) >= 0.5 && blinkOn(sys.time, 1),
    });
    msg.visible = () => sys.messages.list.length > 0;
    const pane = mk(3);
    Object.assign(pane.o, { label: () => this.paneButtonLabel(), icon: 'full', onPress: () => this.paneButtonPress() });
    pane.visible = () => this.paneButtonLabel() !== '';
    for (let k = 0; k < 2; k++) {
      const s = mk(4 + k);
      const bb = (): BarButton | undefined => gtc.page.barButtons()?.[k];
      Object.assign(s.o, {
        label: () => {
          const x = bb();
          return x ? (typeof x.label === 'function' ? x.label() : x.label) : '';
        },
        icon: () => bb()?.icon,
        onPress: () => bb()?.press(),
        disabled: () => bb()?.disabled?.() ?? false,
      });
      s.visible = () => !!bb();
    }
  }

  private gotoNavCom(make: () => import('./GtcPage').GtcPage): void {
    const gtc = this.gtc;
    if (gtc.g.modes.includes('NAVCOM') && gtc.mode !== 'NAVCOM') gtc.setMode('NAVCOM');
    gtc.push(make());
  }

  /** Full / Half (MFD pane) or Split / Full (PFD) button label ('' = hidden). */
  private paneButtonLabel(): string {
    const sys = this.sys;
    const gtc = this.gtc;
    const v = sys.vars;
    if (gtc.mode === 'MFD') {
      const p = sys.gtcPane(gtc.g);
      if (!p) return '';
      if (p.startsWith('mfd')) return v.get(G3K.mfdHalf) >= 0.5 ? 'Full' : 'Half';
      return 'Full';
    }
    if (gtc.mode === 'PFD') return v.get(G3K.pfdSplit(gtc.g.side)) >= 0.5 ? 'Full' : 'Split';
    return '';
  }

  private paneButtonPress(): void {
    const sys = this.sys;
    const gtc = this.gtc;
    const v = sys.vars;
    if (gtc.mode === 'MFD') {
      const p = sys.gtcPane(gtc.g);
      if (!p) return;
      if (p.startsWith('mfd')) {
        if (!sys.setMfdHalf(v.get(G3K.mfdHalf) < 0.5)) gtc.flash('Pane is half size only');
      } else sys.setPfdSplit(p === 'pfd1' ? 1 : 2, false);
    } else if (gtc.mode === 'PFD') sys.setPfdSplit(gtc.g.side, v.get(G3K.pfdSplit(gtc.g.side)) < 0.5);
  }

  // ------------------------------------------------------------ frame

  protected override update(dt: number): void {
    const sys = this.sys;
    const id = this.g.id;
    if (!sys.unitUp(id)) {
      this.mode = sys.unitBooting(id) ? 'boot' : 'off';
      this.animating = this.mode === 'boot';
      return;
    }
    const startup = this.g.modes.includes('MFD') && sys.unitUp('mfd') && sys.vars.get(G3K.mfdSplashAck) < 0.5;
    this.mode = startup ? 'startup' : 'run';
    this.gtc.update(dt);
    // Redraw at the display rate: the pages show live values (frequencies, timers, lists).
    this.animating = true;
    if (this.gtc.revision !== this.lastRev) {
      this.lastRev = this.gtc.revision;
      this.invalidate();
    }
  }

  protected override draw(ctx: Ctx2D): void {
    const L = this.L;
    if (this.mode === 'off') return;
    if (this.mode === 'boot') {
      TF_LIGHT.draw(ctx, 'GARMIN', L.W / 2, L.H / 2 - 20, L.horizontal ? 70 : 46, '#ffffff', 'center', 'middle');
      TF.draw(ctx, this.g.model === 'GTC580' ? 'GTC 580' : 'GTC 570', L.W / 2, L.H / 2 + 30, 20, '#8a9096', 'center', 'middle');
      return;
    }
    this.drawBackground(ctx);
    if (this.mode === 'startup') {
      this.drawStartup(ctx);
      return;
    }
    const gtc = this.gtc;
    const page = gtc.page;
    const c = L.content;
    page.ensureBuilt(c);
    // Title tab.
    const title = typeof page.title === 'function' ? page.title() : page.title;
    drawTitleTab(ctx, L.horizontal ? c.x + c.w / 2 : L.W / 2, L.titleY, gtc.toast || title, L.horizontal ? 24 : 18);
    // Page widgets.
    for (const w of page.widgets) if (w.visible()) w.draw(ctx, this.pressed === w && this.pressedInside);
    page.drawOverlay(ctx, c);
    // Chrome.
    if (L.cns) box(ctx, L.cns.x, L.cns.y, L.cns.w, L.cns.h, GTC_COLORS.bar, '');
    if (L.tabs) box(ctx, L.tabs.x, L.tabs.y, L.tabs.w, L.tabs.h, GTC_COLORS.bar, '');
    box(ctx, L.bar.x, L.bar.y, L.bar.w, L.bar.h, GTC_COLORS.bar, '');
    line(ctx, L.bar.x, L.bar.y, L.horizontal ? L.bar.x : L.bar.x + L.bar.w, L.horizontal ? L.bar.y + L.bar.h : L.bar.y, GTC_COLORS.barEdge, 2);
    for (const w of this.chrome) if (w.visible()) w.draw(ctx, this.pressed === w && this.pressedInside);
    this.drawLabelBar(ctx);
  }

  private pattern: CanvasPattern | null | undefined;

  private drawBackground(ctx: Ctx2D): void {
    // Dotted texture (EST from the GTC figures): a 12 px tile with two dots, created once.
    if (this.pattern === undefined) {
      this.pattern = null;
      try {
        const tile = createDisplayCanvas(12, 12);
        const tc = tile.getContext('2d') as Ctx2D | null;
        if (tc) {
          tc.fillStyle = GTC_COLORS.bg;
          tc.fillRect(0, 0, 12, 12);
          tc.fillStyle = GTC_COLORS.bgDot;
          tc.fillRect(0, 0, 3, 3);
          tc.fillRect(6, 6, 3, 3);
          this.pattern = ctx.createPattern(tile as CanvasImageSource, 'repeat');
        }
      } catch {
        this.pattern = null;
      }
    }
    if (this.pattern) {
      ctx.fillStyle = this.pattern;
      ctx.fillRect(0, 0, this.L.W, this.L.H);
    }
  }

  private drawStartup(ctx: Ctx2D): void {
    const L = this.L;
    TF_LIGHT.draw(ctx, 'GARMIN', L.W / 2, L.H * 0.25, L.horizontal ? 60 : 40, '#ffffff', 'center', 'middle');
    TF.draw(ctx, this.sys.cfg.aircraftName, L.W / 2, L.H * 0.36, 22, P.cyan, 'center', 'middle');
    TF.draw(ctx, 'Database verification complete', L.W / 2, L.H * 0.45, 18, P.white, 'center', 'middle');
    const bw = L.horizontal ? 300 : 220;
    const bh = 90;
    const bx = L.W / 2 - bw / 2;
    const by = L.H * 0.6;
    this.startupBtn.x = bx;
    this.startupBtn.y = by;
    this.startupBtn.w = bw;
    this.startupBtn.h = bh;
    this.startupBtn.draw(ctx, this.pressed === this.startupBtn && this.pressedInside);
  }

  private readonly startupBtn = new Button(0, 0, 1, 1, { label: 'Continue', size: 24, onPress: () => this.sys.setVar(G3K.mfdSplashAck, 1) });

  private drawLabelBar(ctx: Ctx2D): void {
    const L = this.L;
    const lb = L.labels;
    const gtc = this.gtc;
    box(ctx, lb.x, lb.y, lb.w, lb.h, '#000000', '');
    if (L.horizontal) {
      // Upper knob label (top), mode softkeys (middle), lower knob (bottom), aligned with the bezel controls.
      this.labelText(ctx, gtc.knobLabel('upper'), lb.x + lb.w / 2, lb.y + 70, lb.w - 10);
      const modes: GtcModeName[] = ['PFD', 'MFD', 'NAVCOM'];
      for (let i = 0; i < 3; i++) {
        const m = modes[i];
        const y = lb.y + 250 + i * 110;
        if (!this.g.modes.includes(m)) continue;
        const sel = gtc.mode === m;
        if (sel) box(ctx, lb.x + 8, y - 26, lb.w - 16, 52, '', P.white, 1.5, 3);
        TF.draw(ctx, MODE_LABEL[m], lb.x + lb.w / 2 - 6, y, 20, sel ? P.white : '#9aa0a6', 'center', 'middle');
        if (sel) {
          ctx.beginPath();
          ctx.moveTo(lb.x + lb.w - 4, y - 8);
          ctx.lineTo(lb.x + lb.w - 4, y + 8);
          ctx.lineTo(lb.x + lb.w - 14, y);
          ctx.closePath();
          ctx.fillStyle = '#00e000';
          ctx.fill();
        }
      }
      this.labelText(ctx, gtc.knobLabel('lower'), lb.x + lb.w / 2, lb.y + lb.h - 70, lb.w - 10);
    } else {
      const w3 = lb.w / 3;
      this.labelText(ctx, gtc.knobLabel('lower'), lb.x + w3 / 2, lb.y + lb.h / 2, w3 - 6);
      this.labelText(ctx, gtc.knobLabel('center'), lb.x + w3 * 1.5, lb.y + lb.h / 2, w3 - 6);
      this.labelText(ctx, gtc.knobLabel('upper'), lb.x + w3 * 2.5, lb.y + lb.h / 2, w3 - 6);
      line(ctx, lb.x + w3, lb.y + 4, lb.x + w3, lb.y + lb.h - 4, '#3a3f45', 1);
      line(ctx, lb.x + 2 * w3, lb.y + 4, lb.x + 2 * w3, lb.y + lb.h - 4, '#3a3f45', 1);
    }
  }

  private labelText(ctx: Ctx2D, text: string, cx: number, cy: number, maxW: number): void {
    const lines = splitLines(ctx, text, maxW, 13);
    const lh = 15;
    for (let i = 0; i < lines.length; i++) TF.draw(ctx, lines[i], cx, cy - ((lines.length - 1) * lh) / 2 + i * lh, 13, P.cyan, 'center', 'middle');
  }

  // ------------------------------------------------------------ touch

  private hitTest(x: number, y: number): Widget | null {
    if (this.mode === 'startup') return this.startupBtn.hit(x, y) ? this.startupBtn : null;
    if (this.mode !== 'run') return null;
    for (let i = this.chrome.length - 1; i >= 0; i--) {
      const w = this.chrome[i];
      if (w.visible() && w.interactive && w.hit(x, y)) return w;
    }
    const ws = this.gtc.page.widgets;
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i];
      if (w.visible() && w.interactive && w.hit(x, y)) return w;
    }
    return null;
  }

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta: number): void {
    if (kind === 'down') {
      this.pressed = this.hitTest(x, y);
      this.pressedInside = !!this.pressed;
      this.invalidate();
    } else if (kind === 'move') {
      if (this.pressed) {
        const inside = this.pressed.hit(x, y);
        if (inside !== this.pressedInside) {
          this.pressedInside = inside;
          this.invalidate();
        }
      }
    } else if (kind === 'up') {
      const w = this.pressed;
      this.pressed = null;
      if (w && w.hit(x, y)) {
        w.press(x, y);
        this.gtc.revision++;
        this.sys.revision++;
      }
      this.invalidate();
    } else if (kind === 'wheel') {
      const ws = this.gtc.page.widgets;
      for (let i = ws.length - 1; i >= 0; i--) {
        if (ws[i].hit(x, y)) {
          ws[i].scroll(delta > 0 ? 1 : -1);
          break;
        }
      }
      this.invalidate();
    }
  }

  /** Test / automation helper: taps the logical point (down + up). */
  tap(x: number, y: number): void {
    this.onPointerLogical(x, y, 'down', 0);
    this.onPointerLogical(x, y, 'up', 0);
  }

  /** Test helper: taps the first visible button whose label equals `label`. Returns false when none. */
  tapLabel(label: string): boolean {
    const find = (list: readonly Widget[]): Widget | undefined =>
      list.find((w) => w instanceof Button && w.visible() && (typeof w.o.label === 'function' ? w.o.label() : w.o.label) === label);
    this.gtc.page.ensureBuilt(this.L.content);
    const w = find(this.gtc.page.widgets) ?? find(this.chrome);
    if (!w) return false;
    this.tap(w.x + w.w / 2, w.y + w.h / 2);
    return true;
  }

  /** Content rectangle of the page area (tests). */
  get contentRect(): Rect {
    return this.L.content;
  }

  override dispose(): void {
    this.gtc.dispose();
    super.dispose();
  }
}
