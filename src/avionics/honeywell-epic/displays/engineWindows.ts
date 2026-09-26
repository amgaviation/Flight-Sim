/**
 * Engine windows (1/6 format).
 *
 * Primary engine window (G650ER cockpit photograph, DU #2 column): EPR,
 * TGT and LP (N1) round dials for the left and right engine with a digital
 * box at each dial's upper right; the thrust rating (e.g. TO/GA) under the
 * EPR label; HP (N2) and FF digital-only ("The G650 presents the left and
 * right engine high pressure rotor speed (N2 or HP) in digital-only format
 * to conserve primary display space" — code450 "Powerplant").
 * "ALT" above the LP label when the FADEC is in the alternate (LP) control
 * mode (code450 checklist: "verify no ALT text displayed above LP line").
 * Secondary engine window (same photograph): Oil Press, Oil Temp, LP / HP
 * EVM (vibration), Hyd Press (Left, Aux, PTU, Right), Fuel Tank Temp, Fuel
 * Qty (L, R, total).
 * Compacted primary format when no secondary window is displayed (G550 OM
 * 2A-31-00): the dials shrink and oil pressure / temperature are added.
 * Colours: normal white/green, caution amber, warning red (G550 OM range
 * markings). Fuel in lb.
 */
import { DIAL_BOEING, DialGauge, type DialStyle } from '../../common/draw/EngineIndications';
import { ExceedanceMonitor } from '../../common/alerting';
import { fmtFixed, fmtInt } from '../../common/format';
import type { Ctx2D } from '../../common/draw/context';
import { EPIC_PALETTE, EPIC_FONT, C, rect, text, textBold, levelColor } from '../style';
import { Win } from '../vars';
import type { EpicEngineVars } from '../config';
import { EpicWindow, type EpicServices } from './window';

const LB = 2.20462;
const HYD_LABELS = ['Left', 'Aux', 'PTU', 'Right'] as const;
const HYD_KEYS = ['hyd.l.psi', 'hyd.aux.psi', 'hyd.ptu.psi', 'hyd.r.psi'] as const;

/** Gulfstream-style dial: 215 deg arc, shaded sector, digital box upper right (EST geometry from the photographs). */
export const DIAL_EPIC: DialStyle = {
  ...DIAL_BOEING,
  palette: EPIC_PALETTE,
  typeface: EPIC_FONT,
  startDeg: -125,
  endDeg: 90,
  box: { dx: 0.62, dy: -0.78, w: 1.05, h: 0.42, size: 17 },
  labelSize: 12,
  scaleColor: '#ffffff',
};

/** Engine var names resolved once per window (no string building per frame). */
export interface EngineVarNames {
  n1: string[];
  n2: string[];
  tgt: string[];
  ff: string[];
  oilPress: string[];
  oilTemp: string[];
  vibLp: string[];
  vibHp: string[];
  running: string[];
  epr: string[];
  target: string[];
  altMode: string[];
  starter: string[];
  ignition: string[];
}

export function resolveEngineNames(ev: EpicEngineVars, count: number): EngineVarNames {
  const f = (fn: (i: number) => string): string[] => {
    const a: string[] = [];
    for (let i = 1; i <= Math.max(2, count); i++) a.push(fn(i));
    return a;
  };
  return {
    n1: f(ev.n1),
    n2: f(ev.n2),
    tgt: f(ev.tgt),
    ff: f(ev.ff),
    oilPress: f(ev.oilPress),
    oilTemp: f(ev.oilTemp),
    vibLp: f(ev.vibLp),
    vibHp: f(ev.vibHp),
    running: f(ev.running),
    epr: f(ev.epr),
    target: f(ev.target),
    altMode: f(ev.altMode),
    starter: f(ev.starter),
    ignition: f(ev.ignition),
  };
}

export class EngineWindow extends EpicWindow {
  readonly kind = Win.Engine;
  private readonly nv: EngineVarNames;
  private readonly epr: DialGauge[] = [];
  private readonly tgt: DialGauge[] = [];
  private readonly lp: DialGauge[] = [];
  private readonly hpMon: ExceedanceMonitor[] = [];
  private readonly oilP: ExceedanceMonitor[] = [];
  private readonly oilT: ExceedanceMonitor[] = [];
  private compact = false;

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    this.nv = resolveEngineNames(svc.cfg.engines.vars, svc.cfg.engines.count);
    const sc = svc.cfg.scales;
    for (let i = 0; i < 2; i++) {
      this.epr.push(new DialGauge({ x: 0, y: 0, radius: 30, scale: sc.epr, style: DIAL_EPIC }));
      this.tgt.push(new DialGauge({ x: 0, y: 0, radius: 30, scale: sc.tgt, style: DIAL_EPIC }));
      this.lp.push(new DialGauge({ x: 0, y: 0, radius: 30, scale: sc.lp, style: DIAL_EPIC }));
      this.hpMon.push(new ExceedanceMonitor(sc.hp.limits));
      this.oilP.push(new ExceedanceMonitor(sc.oilPress.limits));
      this.oilT.push(new ExceedanceMonitor(sc.oilTemp.limits));
    }
    this.animating = true;
  }

  protected override onLayout(): void {
    this.place();
  }

  private place(): void {
    const { x, w } = this;
    const rows = this.compact ? 4.6 : 4.1;
    const r = Math.min(w * 0.16, (this.h / rows) * 0.42);
    const cxL = x + w * 0.27;
    const cxR = x + w * 0.73;
    const y0 = this.y + r * 1.45;
    const dy = r * 2.35;
    for (let i = 0; i < 2; i++) {
      const cx = i === 0 ? cxL : cxR;
      this.epr[i].x = cx;
      this.epr[i].y = y0;
      this.tgt[i].x = cx;
      this.tgt[i].y = y0 + dy;
      this.lp[i].x = cx;
      this.lp[i].y = y0 + 2 * dy;
      this.epr[i].radius = this.tgt[i].radius = this.lp[i].radius = r;
    }
  }

  override update(dt: number): void {
    const v = this.vars;
    const e = this.svc.cfg.engines;
    const ev = e.vars;
    const compact = v.get('epic.eng.compact') !== 0;
    if (compact !== this.compact) {
      this.compact = compact;
      this.place();
    }
    for (let i = 0; i < 2; i++) {
      const n = i + 1;
      const n1 = v.get(this.nv.n1[i]);
      const eprVal = v.has(this.nv.epr[i]) ? v.get(this.nv.epr[i]) : e.eprFromN1(n1);
      const alt = v.get(this.nv.altMode[i]) !== 0;
      const d = this.epr[i].state;
      d.valid = !alt && v.get(this.nv.n2[i]) > 1;
      d.value = eprVal;
      const tgtN1 = v.get(this.nv.target[i]);
      d.targetValue = e.targetIsN1 ? (tgtN1 > 0 ? e.eprFromN1(tgtN1) : NaN) : tgtN1 > 0 ? tgtN1 : NaN;
      this.tgt[i].state.value = v.get(this.nv.tgt[i]);
      this.lp[i].state.value = n1;
      this.lp[i].state.targetValue = alt && e.targetIsN1 && tgtN1 > 0 ? tgtN1 : NaN;
      this.epr[i].update(dt);
      this.tgt[i].update(dt);
      this.lp[i].update(dt);
      this.hpMon[i].update(v.get(this.nv.n2[i]), dt);
      this.oilP[i].update(v.get(this.nv.n2[i]) > 5 ? v.get(this.nv.oilPress[i]) : 100, dt);
      this.oilT[i].update(v.get(this.nv.oilTemp[i]), dt);
    }
  }

  draw(ctx: Ctx2D): void {
    const v = this.vars;
    const ev = this.svc.cfg.engines.vars;
    this.frame(ctx, C.winBg);
    const cx = this.x + this.w / 2;
    const r = this.epr[0].radius;
    for (let i = 0; i < 2; i++) {
      this.epr[i].draw(ctx);
      this.tgt[i].draw(ctx);
      this.lp[i].draw(ctx);
    }
    text(ctx, 'EPR', cx, this.epr[0].y - r * 0.55, 15, C.white, 'center', 'middle');
    const rating = v.getString(ev.rating);
    if (rating) text(ctx, rating, cx, this.epr[0].y - r * 0.05, 15, C.cyan, 'center', 'middle');
    text(ctx, 'TGT', cx, this.tgt[0].y - r * 0.55, 15, C.white, 'center', 'middle');
    const alt = v.get(this.nv.altMode[0]) !== 0 || v.get(this.nv.altMode[1]) !== 0;
    if (alt) text(ctx, 'ALT', cx, this.lp[0].y - r * 1.0, 15, C.cyan, 'center', 'middle');
    text(ctx, 'LP', cx, this.lp[0].y - r * 0.55, 15, C.white, 'center', 'middle');
    // Digital rows: HP, FF (+ oil in the compacted format).
    let y = this.lp[0].y + r * 1.15;
    const rowH = Math.min(30, (this.y + this.h - y) / (this.compact ? 4 : 2));
    this.digitalRow(ctx, y, 'HP', this.nv.n2, 1, this.hpMon);
    y += rowH;
    this.digitalRow(ctx, y, 'FF', this.nv.ff, 0, null);
    if (this.compact) {
      y += rowH;
      this.digitalRow(ctx, y, 'OIL P', this.nv.oilPress, 0, this.oilP);
      y += rowH;
      this.digitalRow(ctx, y, 'OIL T', this.nv.oilTemp, 0, this.oilT);
    }
  }

  private digitalRow(ctx: Ctx2D, y: number, label: string, names: readonly string[], dec: 0 | 1, mon: ExceedanceMonitor[] | null): void {
    const v = this.vars;
    const bw = this.w * 0.26;
    const bh = 22;
    const cx = this.x + this.w / 2;
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? this.x + this.w * 0.27 - bw / 2 : this.x + this.w * 0.73 - bw / 2;
      const val = v.get(names[i]);
      const col = mon ? levelColor(mon[i].level, C.white) : C.white;
      rect(ctx, x, y, bw, bh, C.black, '#8a9098', 1);
      textBold(ctx, dec === 1 ? fmtFixed(val, 1) : fmtInt(val), x + bw - 5, y + bh / 2 + 1, 17, col, 'right', 'middle');
    }
    text(ctx, label, cx, y + bh / 2 + 1, 14, C.white, 'center', 'middle');
  }
}

export class Engine2Window extends EpicWindow {
  readonly kind = Win.Engine2;
  private readonly nv: EngineVarNames;
  private readonly oilP: ExceedanceMonitor[] = [];
  private readonly oilT: ExceedanceMonitor[] = [];
  private readonly vib: ExceedanceMonitor[] = [];

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    this.nv = resolveEngineNames(svc.cfg.engines.vars, svc.cfg.engines.count);
    const sc = svc.cfg.scales;
    for (let i = 0; i < 2; i++) {
      this.oilP.push(new ExceedanceMonitor(sc.oilPress.limits));
      this.oilT.push(new ExceedanceMonitor(sc.oilTemp.limits));
      this.vib.push(new ExceedanceMonitor(sc.vib.limits));
    }
    this.animating = true;
  }

  override update(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < 2; i++) {
      this.oilP[i].update(v.get(this.nv.n2[i]) > 5 ? v.get(this.nv.oilPress[i]) : 100, dt);
      this.oilT[i].update(v.get(this.nv.oilTemp[i]), dt);
      this.vib[i].update(Math.max(v.get(this.nv.vibLp[i]), v.get(this.nv.vibHp[i])), dt);
    }
  }

  // Row cursor and column geometry of the current draw (no closures per frame).
  private ry = 0;
  private lx = 0;
  private rx = 0;
  private bw = 0;
  private rowH = 0;

  private box(ctx: Ctx2D, x: number, val: string, col: string): void {
    const bh = 22;
    rect(ctx, x - this.bw / 2, this.ry, this.bw, bh, C.black, '#8a9098', 1);
    textBold(ctx, val, x + this.bw / 2 - 5, this.ry + bh / 2 + 1, 16, col, 'right', 'middle');
  }

  private pair(ctx: Ctx2D, label: string, a: string, b: string, ca: string, cb: string): void {
    this.box(ctx, this.lx, a, ca);
    this.box(ctx, this.rx, b, cb);
    text(ctx, label, this.x + this.w / 2, this.ry + 12, 14, C.white, 'center', 'middle');
    this.ry += this.rowH;
  }

  draw(ctx: Ctx2D): void {
    const v = this.vars;
    const ev = this.svc.cfg.engines.vars;
    const ro = this.svc.readouts;
    this.frame(ctx, C.winBg);
    const cx = this.x + this.w / 2;
    this.lx = this.x + this.w * 0.2;
    this.rx = this.x + this.w * 0.8;
    this.bw = this.w * 0.24;
    const bh = 22;
    this.rowH = Math.min(34, this.h / 11);
    this.ry = this.y + 8;
    this.pair(ctx, 'Oil Press', fmtInt(v.get(this.nv.oilPress[0])), fmtInt(v.get(this.nv.oilPress[1])), levelColor(this.oilP[0].level, C.white), levelColor(this.oilP[1].level, C.white));
    this.pair(ctx, 'Oil Temp', fmtInt(v.get(this.nv.oilTemp[0])), fmtInt(v.get(this.nv.oilTemp[1])), levelColor(this.oilT[0].level, C.white), levelColor(this.oilT[1].level, C.white));
    this.sep(ctx, this.ry - 6);
    this.pair(ctx, 'LP EVM', fmtFixed(v.get(this.nv.vibLp[0]), 2), fmtFixed(v.get(this.nv.vibLp[1]), 2), levelColor(this.vib[0].level, C.white), levelColor(this.vib[1].level, C.white));
    this.pair(ctx, 'HP EVM', fmtFixed(v.get(this.nv.vibHp[0]), 2), fmtFixed(v.get(this.nv.vibHp[1]), 2), levelColor(this.vib[0].level, C.white), levelColor(this.vib[1].level, C.white));
    this.sep(ctx, this.ry - 6);
    // Hydraulic pressures: Left, Aux, PTU, Right.
    let y = this.ry;
    text(ctx, 'Hyd Press', cx, y + 6, 14, C.white, 'center', 'middle');
    y += 16;
    const cw = this.w / 4;
    for (let k = 0; k < 4; k++) {
      const x = this.x + cw * (k + 0.5);
      text(ctx, HYD_LABELS[k], x, y + 6, 13, C.white, 'center', 'middle');
      const p = ro.get(HYD_KEYS[k]);
      const col = Number.isFinite(p) && p < 1500 && (k === 0 || k === 3) && v.get(this.nv.running[k === 0 ? 0 : 1]) !== 0 ? C.amber : C.white;
      rect(ctx, x - cw * 0.42, y + 14, cw * 0.84, bh, C.black, '#8a9098', 1);
      textBold(ctx, Number.isFinite(p) ? fmtInt(Math.round(p / 10) * 10) : '---', x + cw * 0.42 - 4, y + 14 + bh / 2 + 1, 15, col, 'right', 'middle');
    }
    y += 14 + bh + 10;
    this.sep(ctx, y - 5);
    this.ry = y;
    const tl = ro.get('fuel.l.temp');
    const tr = ro.get('fuel.r.temp');
    // Fuel temperature amber below -37 C (EST: typical Jet A freeze-point margin display).
    this.pair(ctx, 'Fuel Tank Temp', Number.isFinite(tl) ? fmtInt(tl) : '--', Number.isFinite(tr) ? fmtInt(tr) : '--', tl < -37 ? C.amber : C.white, tr < -37 ? C.amber : C.white);
    this.sep(ctx, this.ry - 6);
    text(ctx, 'Fuel Qty', cx, this.ry + 6, 14, C.white, 'center', 'middle');
    this.ry += 14;
    const ql = ro.get('fuel.l.kg') * LB;
    const qr = ro.get('fuel.r.kg') * LB;
    const qt = ro.get('fuel.total.kg') * LB;
    this.box(ctx, this.lx, Number.isFinite(ql) ? fmtInt(Math.round(ql / 10) * 10) : '-----', ro.on('fuel.l.low') ? C.amber : C.white);
    this.box(ctx, this.rx, Number.isFinite(qr) ? fmtInt(Math.round(qr / 10) * 10) : '-----', ro.on('fuel.r.low') ? C.amber : C.white);
    this.ry += bh + 6;
    this.box(ctx, cx, Number.isFinite(qt) ? fmtInt(Math.round(qt / 10) * 10) : '-----', C.white);
  }

  private sep(ctx: Ctx2D, y: number): void {
    ctx.fillStyle = C.winLine;
    ctx.fillRect(this.x + 4, y, this.w - 8, 1);
  }
}
