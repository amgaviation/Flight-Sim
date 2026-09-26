/**
 * GDU 1400W display unit (PFD1, MFD, PFD2) as a cockpit `CanvasDisplay`
 * (1280 x 800 logical, drawn at 0.8 -> 1024 x 640 texture by default).
 *
 * Formats (G3000 PG 190-02046-01 §1.2 - §1.4, figures measured from the TBM
 * 930 CRG screens):
 *  - power-up: Garmin splash while the unit boots (`G3000System` boot timer);
 *    the MFD then shows the database / system page until the crew presses the
 *    rightmost softkey or "Continue" on a GTC (PG §1.2);
 *  - PFD full / split: split puts the PFD in the outboard 780 px and a display
 *    pane in the inboard 500 px (PG §1.3 "PFD Mode");
 *  - MFD: EIS strip (280 px, COM header on the G3000), navigation data bar
 *    across the top of the panes (8 fields), one full or two half panes;
 *  - reversionary: EIS strip on the left and the PFD centred on the display
 *    (PG Figures 1-23 / 1-24; TBM CRG Figure 3-2), PFD softkeys;
 *  - 12 softkey labels along the bottom edge (PFD / reversionary); the MFD
 *    only shows labels for the keys in use (CAS scroll, Continue).
 *
 * Softkeys are pressed with the EventBus events `g3k.<gdu>.sk1..sk12`
 * (G3K_EVENTS.softkey) emitted by the cockpit bezel buttons. As a
 * convenience, a click on a label in the softkey strip presses it too.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import { blinkOn } from '../../common/dynamics';
import { fmtInt } from '../../common/format';
import { box, line, type Ctx2D } from '../../common/draw/context';
import { FMS, GPS, NAV } from '../../../core/vars';
import { M_TO_FT } from '../../../core/units';
import type { G3000System } from '../state/System';
import { G3K, G3K_EVENTS, vn, type GduId } from '../vars';
import { fmtClockH, fmtCom, fmtDeg, fmtDist, fmtHms } from '../format';
import { EisRenderer } from './Eis';
import { PfdRenderer } from './Pfd';
import { PaneView } from './panes/PaneView';
import { SoftkeyController, pfdMenus, mfdMenus, type SoftkeyDef } from './softkeys';
import { EIS_W, G3K_COLORS, G3K_PALETTE, GDU_H, GDU_W, MFD_DATABAR_H, PANE_W, SOFTKEY_H, TF, TF_LIGHT } from './style';

const P = G3K_PALETTE;

/** PFD width in split mode (GDU width minus one pane). */
const PFD_SPLIT_W = GDU_W - PANE_W;
/** COM frequency header above the EIS strip (G3000; TBM CRG Figure 3-1). */
const COM_HEADER_H = 56;
/** Attitude centre of the reversionary PFD (TBM CRG Figure 3-2: display centre). */
const REV_CX = 640;
/** MSA recomputation period (s). */
const MSA_PERIOD_S = 5;

export interface GduDisplayOptions {
  /** Canvas kind or an existing canvas. */
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** Texture pixels per logical pixel (default config gduPixelRatio, 0.8). */
  pixelRatio?: number;
  /** Refresh rate (Hz, default 30). */
  refreshHz?: number;
  /** Display id for the cockpit (default = the GDU id); the power var stays `display.<gdu>.power`. */
  id?: string;
  /** Brightness var (default `display.<id>.brt`). */
  brightnessVar?: string | null;
}

type Mode = 'off' | 'boot' | 'splash' | 'pfd' | 'split' | 'rev' | 'mfd';

/** Softkey label split into two lines (cached per label). */
const WRAP = new Map<string, [string, string]>();
function wrapLabel(ctx: Ctx2D, s: string, maxW: number, size: number): [string, string] {
  let w = WRAP.get(s);
  if (w) return w;
  if (TF.width(ctx, s, size) <= maxW || s.indexOf(' ') < 0) w = [s, ''];
  else {
    // Split at the space closest to the middle.
    let best = -1;
    for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - s.length / 2) < Math.abs(best - s.length / 2))) best = i;
    w = [s.slice(0, best), s.slice(best + 1)];
  }
  if (WRAP.size > 512) WRAP.clear();
  WRAP.set(s, w);
  return w;
}

export class GduDisplay extends CanvasDisplay {
  readonly gdu: GduId;
  readonly sys: G3000System;
  /** PFD side shown by this unit (the MFD shows side 1 in reversionary mode). */
  readonly side: 1 | 2;
  private pfd: PfdRenderer | null = null;
  private eis: EisRenderer | null = null;
  private readonly panes: PaneView[] = [];
  private readonly skPfd: SoftkeyController;
  private readonly skMfd: SoftkeyController | null;
  private readonly offs: (() => void)[] = [];
  private mode: Mode = 'off';
  private readonly casOnPfd: boolean;
  private readonly comHeader: boolean;
  private msaTimer = 0;
  private msaFt = NaN;

  constructor(sys: G3000System, gdu: GduId, opts: GduDisplayOptions = {}) {
    super({
      id: opts.id ?? gdu,
      width: GDU_W,
      height: GDU_H,
      pixelRatio: opts.pixelRatio ?? sys.cfg.gduPixelRatio,
      refreshHz: opts.refreshHz ?? 30,
      vars: sys.vars,
      powerVar: `display.${gdu}.power`,
      brightnessVar: opts.brightnessVar,
      canvas: opts.canvas,
    });
    this.gdu = gdu;
    this.sys = sys;
    this.side = gdu === 'pfd2' ? 2 : 1;
    this.casOnPfd = sys.cfg.casLocation === 'pfd';
    this.comHeader = sys.cfg.variant === 'g3000';
    if (gdu === 'pfd1' || gdu === 'mfd') this.panes.push(new PaneView(sys, gdu === 'pfd1' ? 'pfd1' : 'mfd1'));
    if (gdu === 'mfd') this.panes.push(new PaneView(sys, 'mfd2'));
    if (gdu === 'pfd2') this.panes.push(new PaneView(sys, 'pfd2'));
    this.skPfd = new SoftkeyController(
      pfdMenus(sys, this.side, {
        casScroll: (rows) => this.scrollCas(rows),
        casOnThisDisplay: () => this.casOnPfd || this.mode === 'rev',
      }),
    );
    this.skMfd =
      gdu === 'mfd'
        ? new SoftkeyController(mfdMenus(sys, { casScroll: (rows) => this.scrollCas(rows), casOnMfd: !this.casOnPfd, casScrollable: () => sys.cas.list.length > (this.eis?.casRows ?? 99) }))
        : null;
    const ev = sys.events;
    if (ev) for (let i = 1; i <= 12; i++) this.offs.push(ev.on(G3K_EVENTS.softkey(gdu, i), () => this.pressSoftkey(i - 1)));
  }

  /** Current format (for tests and the preview harness). */
  get format(): Mode {
    return this.mode;
  }

  /** Active softkey controller. */
  get softkeys(): SoftkeyController {
    return this.gdu === 'mfd' && this.mode !== 'rev' && this.skMfd ? this.skMfd : this.skPfd;
  }

  /** Presses softkey `i` (0..11), same as the bezel key event. */
  pressSoftkey(i: number): void {
    if (!this.sys.unitUp(this.gdu)) return;
    this.softkeys.press(i);
    this.sys.revision++;
    this.invalidate();
  }

  /** The pane views of this unit (MFD: mfd1, mfd2; PFD: its split pane). */
  paneViews(): readonly PaneView[] {
    return this.panes;
  }

  pfdRenderer(): PfdRenderer | null {
    return this.pfd;
  }

  private ensurePfd(): PfdRenderer {
    if (!this.pfd) this.pfd = new PfdRenderer(this.sys, this.side, { casOnPfd: this.casOnPfd });
    return this.pfd;
  }

  private ensureEis(): EisRenderer {
    if (!this.eis) this.eis = new EisRenderer(this.sys.vars, this.sys.cfg.eis, this.sys.cas);
    return this.eis;
  }

  private scrollCas(rows: number): void {
    if (this.casOnPfd && this.pfd && this.mode !== 'mfd') this.pfd.scrollCas(rows);
    else this.eis?.scrollCas(rows);
  }

  // ================================================================ update

  protected override update(dt: number): void {
    const sys = this.sys;
    const id = this.gdu;
    this.animating = true;
    if (!sys.unitUp(id)) {
      this.mode = sys.unitBooting(id) ? 'boot' : 'off';
      this.animating = this.mode === 'boot';
      this.skPfd.reset();
      return;
    }
    const v = sys.vars;
    if (id === 'mfd' && v.get(G3K.mfdSplashAck) < 0.5) {
      this.mode = 'splash';
      return;
    }
    const rev = sys.isReversionary(id);
    if (id === 'mfd' && !rev) {
      this.mode = 'mfd';
      this.skMfd?.update(dt);
      this.ensureEis().update(dt);
      const top = MFD_DATABAR_H;
      const h = GDU_H - top;
      const half = v.get(G3K.mfdHalf) >= 0.5;
      this.panes[0].setRect(half ? { x: EIS_W, y: top, w: PANE_W, h } : { x: EIS_W, y: top, w: GDU_W - EIS_W, h });
      this.panes[0].update(dt);
      if (half) {
        this.panes[1].setRect({ x: EIS_W + PANE_W, y: top, w: PANE_W, h });
        this.panes[1].update(dt);
      }
      this.updateMsa(dt);
      return;
    }
    this.skPfd.update(dt);
    const pfd = this.ensurePfd();
    if (rev) {
      this.mode = 'rev';
      pfd.layout(EIS_W, GDU_W - EIS_W, false, REV_CX);
      this.ensureEis().update(dt);
    } else if (v.get(vn(G3K.pfdSplit, this.side)) >= 0.5) {
      this.mode = 'split';
      const h = GDU_H - SOFTKEY_H;
      if (this.side === 1) {
        pfd.layout(0, PFD_SPLIT_W, true);
        this.panes[0].setRect({ x: PFD_SPLIT_W, y: 0, w: PANE_W, h });
      } else {
        pfd.layout(PANE_W, PFD_SPLIT_W, true);
        this.panes[0].setRect({ x: 0, y: 0, w: PANE_W, h });
      }
      this.panes[0].update(dt);
    } else {
      this.mode = 'pfd';
      pfd.layout(0, GDU_W, false);
    }
    pfd.update(dt);
  }

  /** Minimum safe altitude for the data bar: highest terrain within ~10 nm + 1000 ft (2000 ft above 5000 ft), rounded up to 100 ft. EST. */
  private updateMsa(dt: number): void {
    this.msaTimer -= dt;
    if (this.msaTimer > 0) return;
    this.msaTimer = MSA_PERIOD_S;
    const w = this.sys.world;
    const v = this.sys.vars;
    if (!w || v.get(GPS.valid) < 0.5) {
      this.msaFt = NaN;
      return;
    }
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const dLat = 10 / 60;
    const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    let maxM = -1e9;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) maxM = Math.max(maxM, w.elevationAt(lat + (i / 3) * dLat, lon + (j / 3) * dLon));
    const ft = maxM * M_TO_FT;
    this.msaFt = Number.isFinite(ft) ? Math.ceil((ft + (ft > 5000 ? 2000 : 1000)) / 100) * 100 : NaN;
  }

  // ================================================================ draw

  protected override draw(ctx: Ctx2D): void {
    switch (this.mode) {
      case 'off':
        return;
      case 'boot':
        this.drawBootScreen(ctx);
        return;
      case 'splash':
        this.drawSplash(ctx);
        this.drawSoftkeys(ctx, this.skMfd ?? this.skPfd, true);
        return;
      case 'mfd':
        this.drawEisStrip(ctx, GDU_H);
        if (!this.casOnPfd) this.sys.casRows = this.eis!.casRows;
        this.drawNavDataBar(ctx);
        this.panes[0].draw(ctx);
        if (this.sys.vars.get(G3K.mfdHalf) >= 0.5) this.panes[1].draw(ctx);
        this.drawSoftkeys(ctx, this.skMfd!, true);
        return;
      case 'rev':
        this.pfd!.draw(ctx);
        this.drawEisStrip(ctx, GDU_H - SOFTKEY_H);
        this.sys.casRows = this.casOnPfd ? this.pfd!.casRows : this.eis!.casRows;
        this.drawSoftkeys(ctx, this.skPfd, false);
        return;
      case 'split':
        this.pfd!.draw(ctx);
        this.panes[0].draw(ctx);
        this.drawSoftkeys(ctx, this.skPfd, false);
        return;
      case 'pfd':
        this.pfd!.draw(ctx);
        if (this.casOnPfd && this.side === 1) this.sys.casRows = this.pfd!.casRows;
        this.drawSoftkeys(ctx, this.skPfd, false);
        return;
    }
  }

  /** Power-up screen: Garmin logo, then the unit name and software (PG §1.2 "System Power-up"). */
  private drawBootScreen(ctx: Ctx2D): void {
    const cx = GDU_W / 2;
    const cy = GDU_H / 2 - 30;
    // Garmin delta logo.
    ctx.beginPath();
    ctx.moveTo(cx - 170, cy - 58);
    ctx.lineTo(cx - 130, cy - 58);
    ctx.lineTo(cx - 150, cy - 24);
    ctx.closePath();
    ctx.fillStyle = '#1d6fd6';
    ctx.fill();
    TF_LIGHT.draw(ctx, 'GARMIN', cx + 10, cy - 40, 64, '#ffffff', 'center', 'middle');
    const g5k = this.sys.cfg.variant === 'g5000';
    TF.draw(ctx, g5k ? 'G5000' : 'G3000', cx, cy + 40, 26, '#c8ccd0', 'center', 'middle');
    const name = this.gdu === 'mfd' ? 'MFD' : this.gdu === 'pfd1' ? 'PFD1' : 'PFD2';
    TF.draw(ctx, name, cx, cy + 80, 20, '#8a9096', 'center', 'middle');
    if (blinkOn(this.timeS, 1)) TF.draw(ctx, 'INITIALIZING', cx, GDU_H - 90, 16, '#8a9096', 'center', 'middle');
    TF.draw(ctx, this.sys.cfg.softwareVersion, cx, GDU_H - 60, 15, '#6b7177', 'center', 'middle');
  }

  /** MFD power-up database page (PG §1.2 Figure 1-3). */
  private drawSplash(ctx: Ctx2D): void {
    const cfg = this.sys.cfg;
    const x = 200;
    let y = 90;
    TF_LIGHT.draw(ctx, 'GARMIN', GDU_W / 2, y, 44, '#ffffff', 'center', 'middle');
    y += 52;
    TF.draw(ctx, cfg.aircraftName, GDU_W / 2, y, 26, P.cyan, 'center', 'middle');
    y += 34;
    TF.draw(ctx, cfg.softwareVersion, GDU_W / 2, y, 18, P.white, 'center', 'middle');
    y += 50;
    box(ctx, x - 20, y - 20, GDU_W - 2 * x + 40, 330, 'rgba(26,29,33,0.9)', G3K_COLORS.boxBorder, 1.5, 4);
    TF.draw(ctx, 'DATABASE', x, y, 16, P.white, 'left', 'middle');
    TF.draw(ctx, 'CYCLE', x + 420, y, 16, P.white, 'left', 'middle');
    TF.draw(ctx, 'STATUS', x + 640, y, 16, P.white, 'left', 'middle');
    line(ctx, x, y + 14, GDU_W - x, y + 14, G3K_COLORS.boxBorder, 1);
    const meta = (this.sys.nav as { meta?: { sources?: { name?: string; cycle?: string; date?: string }[] } | null }).meta;
    const cifp = meta?.sources?.find((s) => (s.name ?? '').includes('CIFP'));
    const rows: [string, string, string][] = [
      ['NAVIGATION (FAA CIFP)', cifp?.cycle ?? 'N/A', cifp ? 'Current' : 'Not available'],
      ['NAVAIDS (FlightGear)', meta?.sources?.find((s) => (s.name ?? '').includes('FlightGear'))?.cycle ?? 'N/A', 'Current'],
      ['AIRPORTS (OurAirports)', meta?.sources?.find((s) => (s.name ?? '').includes('OurAirports'))?.date ?? 'N/A', 'Current'],
      ['TERRAIN', this.sys.world ? 'Loaded' : 'N/A', this.sys.world ? 'Current' : 'Not available'],
      ['OBSTACLE', 'N/A', 'Not available'],
      ['CHARTS', 'N/A', 'Not available'],
    ];
    y += 40;
    for (const r of rows) {
      TF.draw(ctx, r[0], x, y, 17, P.white, 'left', 'middle');
      TF.draw(ctx, r[1], x + 420, y, 17, P.cyan, 'left', 'middle');
      TF.draw(ctx, r[2], x + 640, y, 17, r[2] === 'Current' ? P.green : P.amber, 'left', 'middle');
      y += 40;
    }
    TF.draw(ctx, 'Press the rightmost softkey or Continue on the GTC', GDU_W / 2, GDU_H - 100, 18, P.white, 'center', 'middle');
  }

  /** EIS strip (MFD / reversionary) with the COM header on the G3000 (TBM CRG Figure 3-1). */
  private drawEisStrip(ctx: Ctx2D, bottom: number): void {
    const eis = this.ensureEis();
    let y = 0;
    if (this.comHeader) {
      this.drawComHeader(ctx);
      y = COM_HEADER_H;
    }
    eis.drawStrip(ctx, 0, y, EIS_W, bottom - y);
  }

  private drawComHeader(ctx: Ctx2D): void {
    const v = this.sys.vars;
    const w833 = v.get(G3K.comSpacing833) >= 0.5;
    const h = COM_HEADER_H;
    box(ctx, 0, 0, EIS_W, h, G3K_COLORS.eisBg, '');
    const mic = v.get(vn(G3K.micSelect, this.side), this.side);
    const half = EIS_W / 2;
    for (let r = 1; r <= Math.min(2, this.sys.cfg.radios.com); r++) {
      const x = (r - 1) * half;
      const tx = mic === r;
      TF.draw(ctx, r === 1 ? 'COM1' : 'COM2', x + 6, 17, 17, P.white, 'left', 'middle');
      TF.draw(ctx, fmtCom(v.get(vn(NAV.comActive, r)), w833), x + half - 6, 17, 21, tx ? P.green : P.white, 'right', 'middle');
      TF.draw(ctx, 'STBY', x + 6, 42, 16, P.white, 'left', 'middle');
      TF.draw(ctx, fmtCom(v.get(vn(NAV.comStandby, r)), w833), x + half - 6, 42, 18, P.white, 'right', 'middle');
    }
    line(ctx, half, 0, half, h, G3K_COLORS.eisLine, 1.5);
    line(ctx, 0, h - 1, EIS_W, h - 1, G3K_COLORS.eisLine, 2);
  }

  /** MFD navigation data bar: GS, DTK, TRK, ETE, BRG, DIS, MSA, ETA (TBM CRG Figure 3-1; values magenta). */
  private drawNavDataBar(ctx: Ctx2D): void {
    const v = this.sys.vars;
    const x0 = EIS_W;
    const w = GDU_W - x0;
    const h = MFD_DATABAR_H;
    box(ctx, x0, 0, w, h, '#000000', '');
    const gpsOk = v.get(GPS.valid) >= 0.5;
    const wptOk = gpsOk && !!v.getString(FMS.nextWptIdent);
    const field = this.dataField;
    field(ctx, 0, 'GS', gpsOk ? fmtInt(v.get(GPS.gs)) : '___', 'KT');
    field(ctx, 1, 'DTK', wptOk ? fmtDeg(v.get(FMS.dtkMag)) : '___°', '');
    field(ctx, 2, 'TRK', gpsOk && v.get(GPS.gs) > 3 ? fmtDeg(v.get(GPS.trackMag)) : '___°', '');
    const ete = v.get(FMS.eteToWptS);
    field(ctx, 3, 'ETE', wptOk && Number.isFinite(ete) && ete > 0 ? fmtHms(ete) : '__:__', '');
    field(ctx, 4, 'BRG', wptOk ? fmtDeg(v.get(FMS.bearingToWptMag)) : '___°', '');
    field(ctx, 5, 'DIS', wptOk ? fmtDist(v.get(FMS.distToWptNm)) : '__._', 'NM');
    field(ctx, 6, 'MSA', Number.isFinite(this.msaFt) ? fmtInt(this.msaFt) : '____', 'FT');
    const utc = v.get(GPS.utcH, NaN);
    field(ctx, 7, 'ETA', wptOk && Number.isFinite(ete) && ete > 0 && Number.isFinite(utc) ? fmtClockH((utc + ete / 3600) % 24) : '__:__', 'UTC');
  }

  private readonly dataField = (ctx: Ctx2D, i: number, label: string, value: string, unit: string): void => {
    const fw = (GDU_W - EIS_W) / 8;
    const y = MFD_DATABAR_H / 2 + 1;
    const fx = EIS_W + i * fw + 6;
    TF.draw(ctx, label, fx, y, 17, P.white, 'left', 'middle');
    const lw = TF.width(ctx, label, 17) + 8;
    TF.draw(ctx, value, fx + lw, y, 22, P.magenta, 'left', 'middle');
    if (unit) TF.draw(ctx, unit, fx + lw + TF.width(ctx, value, 22) + 1, y + 3, 14, P.magenta, 'left', 'middle');
  };

  /**
   * Softkey label strip. `sparse`: only keys with a label are drawn (MFD),
   * as tabs on the bottom edge.
   */
  private drawSoftkeys(ctx: Ctx2D, sk: SoftkeyController, sparse: boolean): void {
    const keys = sk.keys();
    const kw = GDU_W / 12;
    const y = GDU_H - SOFTKEY_H;
    if (!sparse) {
      box(ctx, 0, y, GDU_W, SOFTKEY_H, '#2a2d31', '');
      line(ctx, 0, y, GDU_W, y, '#4a4f55', 1.5);
    }
    for (let i = 0; i < 12; i++) {
      const k = keys[i];
      const label = k ? this.labelOf(k) : '';
      if (sparse && !label) continue;
      const x = i * kw;
      if (sparse) box(ctx, x + 2, y + 4, kw - 4, SOFTKEY_H - 4, '#2a2d31', '#4a4f55', 1, 3);
      else if (i > 0) line(ctx, x, y + 2, x, GDU_H, '#16181b', 3);
      if (!k || !label) continue;
      const flash = sk.flash[i] > 0;
      const disabled = k.disabled?.() ?? false;
      if (flash && !disabled) box(ctx, x + 3, y + 3, kw - 6, SOFTKEY_H - 6, '#d8dadc', '', 1, 3);
      const col = disabled ? '#5c6166' : flash ? '#000000' : P.white;
      const status = k.status?.() ?? '';
      const size = 19;
      const cx = x + kw / 2;
      if (status) {
        TF.draw(ctx, label, cx, y + 16, size, col, 'center', 'middle');
        TF.draw(ctx, status, cx, y + 37, 18, disabled ? '#5c6166' : flash ? '#000000' : P.cyan, 'center', 'middle');
      } else {
        const [l1, l2] = wrapLabel(ctx, label, kw - 8, size);
        if (l2) {
          TF.draw(ctx, l1, cx, y + 15, size, col, 'center', 'middle');
          TF.draw(ctx, l2, cx, y + 36, size, col, 'center', 'middle');
        } else TF.draw(ctx, l1, cx, y + 25, size, col, 'center', 'middle');
      }
      const ann = k.annun?.();
      if (ann !== undefined && !disabled) line(ctx, cx - 30, GDU_H - 5, cx + 30, GDU_H - 5, ann ? P.green : '#6b7177', 4);
    }
  }

  private labelOf(k: SoftkeyDef): string {
    return typeof k.label === 'function' ? k.label() : k.label;
  }

  // ================================================================ pointer

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', _delta: number): void {
    if (kind !== 'down') return;
    if (y >= GDU_H - SOFTKEY_H) this.pressSoftkey(Math.max(0, Math.min(11, Math.floor(x / (GDU_W / 12)))));
  }

  override dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
    super.dispose();
  }
}
