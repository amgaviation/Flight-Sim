/**
 * GDU 1054B display unit (PFD or MFD) as a cockpit `CanvasDisplay`
 * (1024 x 768 logical, drawn at 0.9 -> 922 x 691 texture by default).
 *
 * Formats (PG 190-02177-02 §1.3 "System Power-on", "Normal Operation",
 * "Reversionary Mode"):
 *  - off: black (no power / failed);
 *  - boot: Garmin splash while the unit runs its power-on self test;
 *  - MFD power-on page: system software, airframe, databases and "Garmin
 *    ESP" line; ENT acknowledges and shows 'Map - Navigation Map';
 *  - PFD (normal), MFD (EIS + pages), reversionary (PFD + EIS) — both
 *    displays in reversionary mode with DISPLAY BACKUP;
 *  - 12 softkey labels along the bottom edge (annunciator bar green / grey,
 *    subdued when disabled, Alerts key flashing / inverse).
 *
 * Backlight: automatic (photocell / dimmer bus: `display.<id>.brt` or the
 * cockpit dimming system) or manual from the PFD Setup Menu
 * (`g1k.<gdu>.brt_manual` / `brt_pct`, PG §1.5 "Display Backlighting").
 *
 * Softkeys are pressed with the EventBus events `g1k.<gdu>.sk1..sk12`
 * (G1K_EVENTS.softkey) emitted by the bezel buttons; clicking a label on the
 * screen presses it too (convenience).
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import { blinkOn } from '../../common/dynamics';
import { box, line, type Ctx2D } from '../../common/draw/context';
import type { G1000System } from '../state/System';
import { G1K, type GduId } from '../vars';
import { MfdRenderer } from './Mfd';
import { PfdRenderer } from './Pfd';
import { G1K_COLORS, G1K_PALETTE, GDU_H, GDU_W, SOFTKEY_H, SOFTKEY_Y, TF } from './style';

const P = G1K_PALETTE;
const KEY_W = GDU_W / 12;

export interface GduDisplayOptions {
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** Texture pixels per logical pixel (default config pixelRatio, 0.9). */
  pixelRatio?: number;
  /** Refresh rate (Hz, default 30: CLAUDE.md glass <= 30 Hz). */
  refreshHz?: number;
  /** Display id for the cockpit (default the GDU id); the power var stays `display.<gdu>.power`. */
  id?: string;
  /** Automatic-mode brightness var (default `display.<id>.brt`). */
  brightnessVar?: string | null;
}

export type GduFormat = 'off' | 'boot' | 'splash' | 'pfd' | 'rev' | 'mfd';

export class GduDisplay extends CanvasDisplay {
  readonly gdu: GduId;
  readonly sys: G1000System;
  private pfd: PfdRenderer | null = null;
  private mfd: MfdRenderer | null = null;
  private mode: GduFormat = 'off';
  private t = 0;

  constructor(sys: G1000System, gdu: GduId, opts: GduDisplayOptions = {}) {
    super({
      id: opts.id ?? gdu,
      width: GDU_W,
      height: GDU_H,
      pixelRatio: opts.pixelRatio ?? sys.cfg.pixelRatio,
      refreshHz: opts.refreshHz ?? 30,
      vars: sys.vars,
      powerVar: `display.${gdu}.power`,
      brightnessVar: opts.brightnessVar,
      canvas: opts.canvas,
    });
    this.gdu = gdu;
    this.sys = sys;
  }

  /** Current format (tests / preview). */
  get format(): GduFormat {
    return this.mode;
  }

  /** Manual backlight from the PFD Setup Menu overrides the automatic source. */
  override get brightness(): number {
    const v = this.sys.vars;
    if (v.get(G1K.brtManual(this.gdu)) >= 0.5) return Math.max(0.05, Math.min(1, v.get(G1K.brtPct(this.gdu)) / 100));
    return super.brightness;
  }

  pfdRenderer(): PfdRenderer {
    if (!this.pfd) this.pfd = new PfdRenderer(this.sys);
    return this.pfd;
  }

  mfdRenderer(): MfdRenderer {
    if (!this.mfd) this.mfd = new MfdRenderer(this.sys);
    return this.mfd;
  }

  protected override update(dt: number): void {
    const sys = this.sys;
    const g = this.gdu;
    this.t += dt;
    this.animating = true;
    if (!sys.units.up(g)) {
      this.mode = sys.units.booting(g) ? 'boot' : 'off';
      return;
    }
    const rev = sys.isReversionary(g);
    if (g === 'mfd' && !rev && sys.vars.get(G1K.mfdSplashAck) < 0.5) {
      this.mode = 'splash';
      return;
    }
    if (g === 'pfd' || rev) {
      this.mode = rev ? 'rev' : 'pfd';
      const p = this.pfdRenderer();
      p.layout(rev);
      p.update(dt);
    } else {
      this.mode = 'mfd';
      this.mfdRenderer().update(dt);
    }
  }

  protected override draw(ctx: Ctx2D): void {
    switch (this.mode) {
      case 'off':
        return;
      case 'boot':
        this.drawSplash(ctx);
        return;
      case 'splash':
        this.drawPowerOnPage(ctx);
        this.drawSoftkeys(ctx);
        return;
      case 'pfd':
      case 'rev':
        this.pfdRenderer().draw(ctx, SOFTKEY_Y);
        this.drawSoftkeys(ctx);
        return;
      case 'mfd':
        this.mfdRenderer().draw(ctx);
        this.drawSoftkeys(ctx);
        return;
    }
  }

  /** Garmin splash with the self-test progress (EST appearance). */
  private drawSplash(ctx: Ctx2D): void {
    box(ctx, 0, 0, GDU_W, GDU_H, '#000000', '');
    TF.draw(ctx, 'GARMIN', GDU_W / 2, GDU_H / 2 - 20, 64, P.white, 'center', 'middle');
    TF.draw(ctx, 'G1000 NXi', GDU_W / 2, GDU_H / 2 + 36, 24, P.cyan, 'center', 'middle');
    const pr = this.sys.units.bootProgress(this.gdu);
    box(ctx, GDU_W / 2 - 150, GDU_H / 2 + 80, 300, 8, '', P.grey, 1);
    box(ctx, GDU_W / 2 - 150, GDU_H / 2 + 80, 300 * pr, 8, P.white, '');
  }

  /** MFD power-on page (PG §1.3 "System Power-on", Figure 8-53 with the ESP line). */
  private drawPowerOnPage(ctx: Ctx2D): void {
    const sys = this.sys;
    box(ctx, 0, 0, GDU_W, SOFTKEY_Y, '#000000', '');
    TF.draw(ctx, 'GARMIN', GDU_W / 2, 90, 52, P.white, 'center', 'middle');
    TF.draw(ctx, 'G1000 NXi', GDU_W / 2, 140, 22, P.cyan, 'center', 'middle');
    let y = 200;
    const row = (a: string, b: string, color: string = P.white): void => {
      TF.draw(ctx, a, 200, y, 16, P.white, 'left', 'middle');
      TF.draw(ctx, b, 824, y, 16, color, 'right', 'middle');
      y += 26;
    };
    row('SYSTEM', sys.cfg.softwareVersion);
    row('AIRFRAME', sys.cfg.aircraftName);
    y += 10;
    TF.draw(ctx, 'DATABASES', 200, y, 16, P.cyan, 'left', 'middle');
    y += 28;
    row('Navigation', sys.nav.ready ? 'OurAirports / FAA CIFP' : 'LOADING', sys.nav.ready ? P.green : P.amber);
    row('Terrain', sys.world ? 'AWS Terrain Tiles' : 'NOT AVAILABLE', sys.world ? P.green : P.amber);
    row('Obstacle', 'NOT INSTALLED', P.grey);
    row('SafeTaxi', 'NOT INSTALLED', P.grey);
    y += 10;
    if (sys.esp) {
      TF.draw(ctx, 'Electronic Stability and Protection System', GDU_W / 2, y, 16, P.white, 'center', 'middle');
      y += 22;
      TF.draw(ctx, 'Garmin ESP', GDU_W / 2, y, 16, P.white, 'center', 'middle');
      y += 30;
    }
    if (blinkOn(this.t, 1)) TF.draw(ctx, 'Press the ENT key to continue', GDU_W / 2, 660, 18, P.white, 'center', 'middle');
  }

  private drawSoftkeys(ctx: Ctx2D): void {
    const sk = this.sys.softkeysOf(this.gdu);
    const keys = sk.keys();
    box(ctx, 0, SOFTKEY_Y, GDU_W, SOFTKEY_H, G1K_COLORS.softkeyBg, '');
    line(ctx, 0, SOFTKEY_Y, GDU_W, SOFTKEY_Y, G1K_COLORS.softkeySep, 1);
    const flashOn = blinkOn(this.t, 2);
    for (let i = 0; i < 12; i++) {
      const x = i * KEY_W;
      if (i > 0) line(ctx, x, SOFTKEY_Y + 3, x, GDU_H - 3, G1K_COLORS.softkeySep, 1);
      const k = keys[i];
      if (!k) continue;
      const label = sk.label(i);
      if (!label) continue;
      const disabled = k.disabled?.() ?? false;
      const pressed = sk.flash[i] > 0;
      const inverse = pressed || (k.inverse?.() ?? false);
      const flashing = k.flashing?.() ?? false;
      const col = k.color?.() ?? '';
      if (flashing && flashOn) {
        box(ctx, x + 3, SOFTKEY_Y + 3, KEY_W - 6, SOFTKEY_H - 6, col || P.white, '');
        TF.draw(ctx, label, x + KEY_W / 2, SOFTKEY_Y + 13, 13, P.black, 'center', 'middle');
      } else if (inverse) {
        box(ctx, x + 3, SOFTKEY_Y + 3, KEY_W - 6, SOFTKEY_H - 6, P.softKeyActive, '');
        TF.draw(ctx, label, x + KEY_W / 2, SOFTKEY_Y + 13, 13, P.black, 'center', 'middle');
      } else TF.draw(ctx, label, x + KEY_W / 2, SOFTKEY_Y + 13, 13, disabled ? P.softKeyDisabled : col || P.white, 'center', 'middle');
      const an = k.annun?.();
      if (an !== undefined) box(ctx, x + KEY_W / 2 - 14, GDU_H - 6, 28, 3, an ? P.green : P.grey, '');
    }
  }

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel'): void {
    if (kind !== 'down' || y < SOFTKEY_Y) return;
    const i = Math.floor(x / KEY_W);
    if (i >= 0 && i < 12 && this.sys.units.up(this.gdu)) this.sys.pressSoftkey(this.gdu, i);
  }
}
