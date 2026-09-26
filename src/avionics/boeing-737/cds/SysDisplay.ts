/**
 * 737NG systems display (MFD SYS, lower DU): hydraulic system A / B
 * quantity (%, RF below the refill level on the ground) and pressure
 * (psi), and the flight control surface position indicator (ailerons,
 * elevators, rudder; flight spoilers shown as bars).
 *
 * Content per the FCOM 13.10 / 9.10 descriptions ("hydraulic quantity is
 * displayed on the lower DU when SYS is pushed"; "surface position
 * indicator: ailerons, elevators and rudder"). No public photograph of the
 * NG SYS format was available, so the layout is EST (FCOM-style columns).
 */
import { SURF } from '../../../core/vars';
import { fmtInt } from '../../common/format';
import type { Ctx2D } from '../../common/draw/context';
import { B738_HYDRAULICS } from '../data/b738';
import type { Side } from '../vars';
import { CDS, LW, line, text } from './style';
import type { CdsEnv, CdsFormatRenderer } from './types';

export class SysDisplay implements CdsFormatRenderer {
  private readonly env: CdsEnv;
  private qa = 0;
  private qb = 0;
  private pa = 0;
  private pb = 0;
  private ail = 0;
  private elev = 0;
  private rud = 0;
  private splL = 0;
  private splR = 0;
  private ground = true;

  constructor(env: CdsEnv) {
    this.env = env;
  }

  update(_dt: number, _side: Side): void {
    const v = this.env.vars;
    const c = this.env.cfg.vars;
    this.qa = v.get(c.hydAQty, 1);
    this.qb = v.get(c.hydBQty, 1);
    this.pa = v.get(c.hydAPsi);
    this.pb = v.get(c.hydBPsi);
    this.ail = v.get(SURF.aileron);
    this.elev = v.get(SURF.elevator);
    this.rud = v.get(SURF.rudder);
    this.splL = v.get(SURF.spoilerLeft);
    this.splR = v.get(SURF.spoilerRight);
    this.ground = v.get(c.onGround) !== 0;
  }

  draw(ctx: Ctx2D): void {
    // ---- hydraulics
    text(ctx, 'HYDRAULIC', 400, 40, 24, CDS.cyan, 'center');
    const cols = [
      { x: 300, label: 'A', q: this.qa, p: this.pa },
      { x: 500, label: 'B', q: this.qb, p: this.pb },
    ];
    text(ctx, 'QTY %', 400, 110, 20, CDS.cyan, 'center');
    text(ctx, 'PRESS', 400, 180, 20, CDS.cyan, 'center');
    for (const c of cols) {
      text(ctx, c.label, c.x, 72, 26, CDS.white, 'center');
      const qp = Math.round(Math.max(0, Math.min(1.06, c.q)) * 100);
      const rf = c.q < B738_HYDRAULICS.refillFraction && this.ground;
      this.box(ctx, c.x - 45, 92, 90, 38, fmtInt(qp), rf ? CDS.amber : CDS.white);
      if (rf) text(ctx, 'RF', c.x + 56, 111, 20, CDS.amber, 'left');
      const low = c.p < 1300;
      const pp = Math.round(c.p / 10) * 10;
      this.box(ctx, c.x - 55, 162, 110, 38, fmtInt(Math.max(0, pp)), c.p > B738_HYDRAULICS.reliefPsi ? CDS.amber : low ? CDS.amber : CDS.white);
    }
    line(ctx, 80, 240, 720, 240, CDS.darkGrey, 2);

    // ---- flight control surface positions
    text(ctx, 'FLIGHT CONTROL SURFACES', 400, 272, 22, CDS.cyan, 'center');
    // Ailerons (left / right, vertical: TE up = +). surf.aileron + = roll right: left aileron down, right aileron up.
    this.vScale(ctx, 130, 330, 560, -this.ail, 'AIL', 'L');
    this.vScale(ctx, 670, 330, 560, this.ail, 'AIL', 'R');
    // Elevators (both move together; + = TE up for nose up).
    this.vScale(ctx, 330, 330, 560, this.elev, 'ELEV', 'L');
    this.vScale(ctx, 470, 330, 560, this.elev, 'ELEV', 'R');
    // Flight spoilers (bars above the ailerons).
    this.bar(ctx, 205, 330, 560, this.splL, 'SPLR');
    this.bar(ctx, 595, 330, 560, this.splR, 'SPLR');
    // Rudder (horizontal).
    const y = 690;
    line(ctx, 250, y, 550, y, CDS.white, LW.normal);
    for (const f of [-1, -0.5, 0, 0.5, 1]) line(ctx, 400 + f * 150, y - 10, 400 + f * 150, y + 10, CDS.white, LW.normal);
    const rx = 400 + Math.max(-1, Math.min(1, this.rud)) * 150;
    ctx.fillStyle = CDS.white;
    ctx.beginPath();
    ctx.moveTo(rx, y - 6);
    ctx.lineTo(rx - 10, y - 26);
    ctx.lineTo(rx + 10, y - 26);
    ctx.closePath();
    ctx.fill();
    text(ctx, 'RUD', 400, y + 36, 20, CDS.cyan, 'center');
  }

  private box(ctx: Ctx2D, x: number, y: number, w: number, h: number, s: string, col: string): void {
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.strokeRect(x, y, w, h);
    text(ctx, s, x + w - 8, y + h / 2 + 1, h * 0.78, col, 'right');
  }

  private vScale(ctx: Ctx2D, x: number, yTop: number, yBot: number, val: number, lbl: string, side: string): void {
    const mid = (yTop + yBot) / 2;
    line(ctx, x, yTop, x, yBot, CDS.white, LW.normal);
    for (const f of [-1, -0.5, 0, 0.5, 1]) line(ctx, x - (f === 0 ? 14 : 8), mid - f * (yBot - yTop) / 2, x, mid - f * (yBot - yTop) / 2, CDS.white, LW.normal);
    const y = mid - Math.max(-1, Math.min(1, val)) * (yBot - yTop) / 2;
    ctx.fillStyle = CDS.white;
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 24, y - 10);
    ctx.lineTo(x + 24, y + 10);
    ctx.closePath();
    ctx.fill();
    text(ctx, lbl, x, yBot + 28, 19, CDS.cyan, 'center');
    text(ctx, side, x, yBot + 50, 19, CDS.cyan, 'center');
  }

  private bar(ctx: Ctx2D, x: number, yTop: number, yBot: number, val: number, lbl: string): void {
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.strokeRect(x - 10, yTop, 20, yBot - yTop);
    const h = Math.max(0, Math.min(1, val)) * (yBot - yTop);
    ctx.fillStyle = CDS.white;
    ctx.fillRect(x - 8, yBot - h, 16, h);
    text(ctx, lbl, x, yBot + 28, 17, CDS.cyan, 'center');
  }
}
