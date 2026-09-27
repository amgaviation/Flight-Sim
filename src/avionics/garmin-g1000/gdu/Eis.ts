/**
 * EIS strip of the Cessna 172S NXi (PG 190-02177-02 §3 "Engine Indication
 * System", Figures 3-2 / 3-3 / 3-8 / 3-10; POH 172SPHAUS-03 §7 "Engine
 * Instruments") on the left of the MFD (and of the reversionary display):
 *
 *  - ENGINE page (default): RPM arc gauge with digital value, FFLOW GPH, OIL
 *    PRES PSI, OIL TEMP °F, EGT °F (pointer carries the hottest cylinder
 *    number), VAC, FUEL QTY GAL (L / R pointers), ENG HRS, ELECTRICAL (M BUS
 *    E volts, M BATT S amps).
 *  - LEAN page: RPM, FFLOW, per-cylinder EGT / CHT columns (hottest / the
 *    CYL SLCT cylinder in cyan), EGT / CHT values, Assist: ΔPEAK.
 *  - SYSTEM page: RPM, OIL PRES / OIL TEMP digital, FUEL CALC (FFLOW GPH,
 *    GAL USED, GAL REM), ELECTRICAL, ENG HRS.
 *  - RPM ≥ 2780: pointer, value and label red and flashing; any warning
 *    exceedance returns the EIS to the ENGINE page (PG §3).
 *  - Red X over the strip when the engine / airframe unit (GEA 71B) is down.
 */
import { compileBinding, type Evaluator } from '../../../systems/util/binding';
import { interp1, table1 } from '../../../core/math';
import { box, line, type Ctx2D } from '../../common/draw/context';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { DialGauge, DIAL_GARMIN, LinearGauge, BAR_GARMIN, formatValue, type LinearStyle } from '../../common/draw/EngineIndications';
import type { G1000System } from '../state/System';
import { EIS_PAGE, G1K } from '../vars';
import { EIS_W, G1K_COLORS, G1K_PALETTE, TF } from './style';

const P = G1K_PALETTE;
const BAR: LinearStyle = { ...BAR_GARMIN, palette: P, typeface: TF, thickness: 7, pointerSize: 7, labelSize: 13, readout: 'none' };

/** Pressure altitude var for the RPM green-arc top schedule (ADC 1). */
const PALT = 'adc1.press_alt_ft';

export class EisRenderer {
  private readonly rpm: DialGauge;
  private readonly ff: LinearGauge;
  private readonly oilP: LinearGauge;
  private readonly oilT: LinearGauge;
  private readonly egt: LinearGauge;
  private readonly vac: LinearGauge | null;
  private readonly fuel: LinearGauge;
  private readonly ev: {
    rpm: Evaluator;
    ff: Evaluator;
    oilP: Evaluator;
    oilT: Evaluator;
    egt: Evaluator[];
    cht: Evaluator[];
    vac: Evaluator | null;
    fuelL: Evaluator;
    fuelR: Evaluator;
    mBus: Evaluator;
    eBus: Evaluator;
    mBatt: Evaluator;
    sBatt: Evaluator;
  };
  private readonly greenTop: ReturnType<typeof table1> | null;
  private time = 0;
  private egtVals: number[];
  private chtVals: number[];
  private peakEgt: number[];
  private hottest = 0;
  private lowFuelL = 0;
  private lowFuelR = 0;

  constructor(private readonly sys: G1000System) {
    const e = sys.cfg.eis;
    const v = sys.vars;
    this.rpm = new DialGauge({ x: EIS_W / 2, y: 112, radius: 46, scale: { ...e.rpm.scale, bands: e.rpm.scale.bands.slice() }, style: { ...DIAL_GARMIN, palette: P, typeface: TF, box: null, arcWidth: 6 } });
    const bar = (y: number, sc: typeof e.fuelFlow.scale): LinearGauge => new LinearGauge({ x: 14, y, length: EIS_W - 28, scale: sc, style: BAR });
    this.ff = bar(0, e.fuelFlow.scale);
    this.oilP = bar(0, e.oilPress.scale);
    this.oilT = bar(0, e.oilTemp.scale);
    this.egt = bar(0, { min: e.egt.min, max: e.egt.max, bands: [], redlines: [], amberlines: [], ticks: [], labels: [], limits: {}, decimals: 0, readoutStep: 10, unit: '°F' });
    this.vac = e.vacuum ? bar(0, e.vacuum.scale) : null;
    this.fuel = new LinearGauge({ x: 14, y: 0, length: EIS_W - 28, scale: e.fuelQty.scale, style: { ...BAR, pointerSize: 8 }, pointerLabels: ['L', 'R'] });
    this.ev = {
      rpm: compileBinding(v, e.rpm.value, 0),
      ff: compileBinding(v, e.fuelFlow.value, 0),
      oilP: compileBinding(v, e.oilPress.value, 0),
      oilT: compileBinding(v, e.oilTemp.value, 0),
      egt: e.egt.cylinders.map((b) => compileBinding(v, b, 0)),
      cht: e.cht.cylinders.map((b) => compileBinding(v, b, 0)),
      vac: e.vacuum ? compileBinding(v, e.vacuum.value, 0) : null,
      fuelL: compileBinding(v, e.fuelQty.left, 0),
      fuelR: compileBinding(v, e.fuelQty.right, 0),
      mBus: compileBinding(v, e.elec.mainBusV, 0),
      eBus: compileBinding(v, e.elec.essBusV, 0),
      mBatt: compileBinding(v, e.elec.mainBattA, 0),
      sBatt: compileBinding(v, e.elec.stbyBattA, 0),
    };
    this.greenTop = e.rpm.greenTop ? table1(e.rpm.greenTop.altFt, e.rpm.greenTop.rpm) : null;
    this.egtVals = e.egt.cylinders.map(() => 0);
    this.chtVals = e.cht.cylinders.map(() => 0);
    this.peakEgt = e.egt.cylinders.map(() => 0);
  }

  update(dt: number): void {
    this.time += dt;
    const sys = this.sys;
    const v = sys.vars;
    const e = sys.cfg.eis;
    const ok = sys.units.up('gea');
    const ev = this.ev;
    const rpm = ev.rpm();
    const rs = this.rpm.state;
    rs.valid = ok;
    rs.value = rpm;
    // RPM green arc top by pressure altitude (POH 7-30), red from 2700.
    if (this.greenTop) {
      const top = interp1(this.greenTop, v.get(PALT, v.get('adc1.alt_ft')));
      const b = this.rpm.scale.bands as { from: number; to: number; color: string }[];
      if (b.length > 0) b[0].to = top;
    }
    this.rpm.update(dt);
    this.set(this.ff, ok, ev.ff(), dt);
    this.set(this.oilP, ok, ev.oilP(), dt);
    this.set(this.oilT, ok, ev.oilT(), dt);
    let hot = 0;
    for (let i = 0; i < ev.egt.length; i++) {
      this.egtVals[i] = ev.egt[i]();
      if (this.egtVals[i] > this.egtVals[hot]) hot = i;
      // Lean assist: peak EGT memory per cylinder.
      if (v.get(G1K.eisLeanAssist) >= 0.5) this.peakEgt[i] = Math.max(this.peakEgt[i], this.egtVals[i]);
      else this.peakEgt[i] = 0;
    }
    for (let i = 0; i < ev.cht.length; i++) this.chtVals[i] = ev.cht[i]();
    this.hottest = hot;
    this.set(this.egt, ok, this.egtVals[hot], dt);
    if (this.vac && ev.vac) this.set(this.vac, ok, ev.vac(), dt);
    const fl = ev.fuelL();
    const fr = ev.fuelR();
    // Float travel limit: the indicator stops at ~24 gal (POH 7-38).
    const lim = e.fuelQty.indicatorMaxGal;
    const fs = this.fuel.state;
    fs.valid = ok;
    fs.value = Number.isFinite(fl) ? Math.min(fl, lim) : NaN;
    fs.value2 = Number.isFinite(fr) ? Math.min(fr, lim) : NaN;
    this.lowFuelL = fl < e.fuelQty.lowGal ? this.lowFuelL + dt : 0;
    this.lowFuelR = fr < e.fuelQty.lowGal ? this.lowFuelR + dt : 0;
    this.fuel.update(dt);
    // A warning exceedance returns the display to the ENGINE page (PG §3).
    const warn = rpm >= e.rpm.redAt || this.oilP.exceed.level === 2 || this.oilT.exceed.level === 2;
    if (warn && v.get(G1K.eisPage) !== EIS_PAGE.engine) v.set(G1K.eisPage, EIS_PAGE.engine);
  }

  private set(g: LinearGauge, ok: boolean, value: number, dt: number): void {
    g.state.valid = ok && Number.isFinite(value);
    g.state.value = value;
    g.state.value2 = NaN;
    g.update(dt);
  }

  /** Draws the strip at (x0, y0) down to y1. */
  draw(ctx: Ctx2D, x0: number, y0: number, y1: number): void {
    ctx.save();
    ctx.translate(x0, 0);
    box(ctx, 0, y0, EIS_W, y1 - y0, G1K_COLORS.eisBg, '');
    line(ctx, EIS_W, y0, EIS_W, y1, G1K_COLORS.eisLine, 1.5);
    const page = this.sys.vars.get(G1K.eisPage);
    this.drawRpm(ctx, y0);
    if (page === EIS_PAGE.lean) this.drawLean(ctx, y0);
    else if (page === EIS_PAGE.system) this.drawSystem(ctx, y0);
    else this.drawEngine(ctx, y0);
    if (!this.sys.units.up('gea')) {
      line(ctx, 8, y0 + 8, EIS_W - 8, y1 - 8, P.red, 3);
      line(ctx, 8, y1 - 8, EIS_W - 8, y0 + 8, P.red, 3);
    }
    ctx.restore();
  }

  private drawRpm(ctx: Ctx2D, y0: number): void {
    const e = this.sys.cfg.eis;
    const g = this.rpm;
    g.y = y0 + 58;
    const rpm = g.state.value;
    const red = rpm >= e.rpm.redAt;
    const vis = !red || blinkOn(this.time, 2);
    if (vis) g.draw(ctx);
    const txt = g.state.valid ? fmtInt(Math.round(rpm / 10) * 10) : '----';
    TF.draw(ctx, txt, EIS_W / 2, g.y + 30, 22, red ? P.red : P.white, 'center', 'middle');
    TF.draw(ctx, 'RPM', EIS_W / 2, g.y + 50, 13, red ? P.red : P.white, 'center', 'middle');
  }

  /** Labelled bar: caption left, value right above the bar. */
  private barRow(ctx: Ctx2D, g: LinearGauge, y: number, label: string, unit: string): void {
    g.y = y;
    g.draw(ctx);
    const lvl = g.state.valid ? g.exceed.level : 0;
    const color = lvl === 2 ? P.red : lvl === 1 ? P.yellow : P.white;
    TF.draw(ctx, label, 12, y - 15, 12, P.white, 'left', 'middle');
    TF.draw(ctx, unit, 12 + TF.width(ctx, label, 12) + 4, y - 15, 10, P.white, 'left', 'middle');
    const inverse = lvl > 0 && g.exceed.flashing && g.exceed.visible;
    const val = g.state.valid ? formatValue(g.state.value, g.scale) : '---';
    if (inverse) {
      const w = TF.width(ctx, val, 15);
      box(ctx, EIS_W - 12 - w - 2, y - 24, w + 4, 18, color, '');
    }
    TF.draw(ctx, val, EIS_W - 12, y - 15, 15, inverse ? P.black : color, 'right', 'middle');
  }

  private drawEngine(ctx: Ctx2D, y0: number): void {
    let y = y0 + 170;
    this.barRow(ctx, this.ff, y, 'FFLOW', 'GPH');
    y += 46;
    this.barRow(ctx, this.oilP, y, 'OIL PRES', 'PSI');
    y += 46;
    this.barRow(ctx, this.oilT, y, 'OIL TEMP', '°F');
    y += 46;
    this.barRow(ctx, this.egt, y, 'EGT', '°F');
    // The EGT pointer carries the number of the hottest cylinder (POH 7-33).
    if (this.egt.state.valid) TF.draw(ctx, String(this.hottest + 1), this.egt.pos(this.egt.state.value), y + 14, 10, P.white, 'center', 'middle');
    y += 46;
    if (this.vac) {
      this.barRow(ctx, this.vac, y, 'VAC', 'IN');
      y += 46;
    }
    this.drawFuel(ctx, y + 4);
    y += 70;
    this.drawHours(ctx, y);
    y += 26;
    this.drawElec(ctx, y);
  }

  private drawFuel(ctx: Ctx2D, y: number): void {
    const e = this.sys.cfg.eis;
    const g = this.fuel;
    g.y = y + 10;
    TF.draw(ctx, 'FUEL QTY', 12, y - 12, 12, P.white, 'left', 'middle');
    TF.draw(ctx, 'GAL', 70, y - 12, 10, P.white, 'left', 'middle');
    g.draw(ctx);
    const s = g.state;
    // Sensor failure: red X over the pointer area (top = left tank, bottom = right tank).
    if (!Number.isFinite(s.value)) this.smallX(ctx, 14, y - 6, 30, 12);
    if (!Number.isFinite(s.value2)) this.smallX(ctx, 14, y + 16, 30, 12);
    // LOW FUEL: amber pointer after the delay; flashing red at empty (POH 7-38).
    const lowL = this.lowFuelL >= e.fuelQty.lowDelayS;
    const lowR = this.lowFuelR >= e.fuelQty.lowDelayS;
    const flash = blinkOn(this.time, 2);
    if (lowL && Number.isFinite(s.value)) this.fuelMark(ctx, g.pos(s.value), y + 10 - 9, s.value <= 0.5 ? (flash ? P.red : '') : P.amber);
    if (lowR && Number.isFinite(s.value2)) this.fuelMark(ctx, g.pos(s.value2), y + 10 + 9, s.value2 <= 0.5 ? (flash ? P.red : '') : P.amber);
  }

  private fuelMark(ctx: Ctx2D, x: number, y: number, color: string): void {
    if (!color) return;
    box(ctx, x - 5, y - 5, 10, 10, color, '');
  }

  private smallX(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    line(ctx, x, y, x + w, y + h, P.red, 2);
    line(ctx, x, y + h, x + w, y, P.red, 2);
  }

  private drawHours(ctx: Ctx2D, y: number): void {
    TF.draw(ctx, 'ENG HRS', 12, y, 12, P.white, 'left', 'middle');
    TF.draw(ctx, fmtFixed(this.sys.fuel.engineHours(), 1), EIS_W - 12, y, 14, P.white, 'right', 'middle');
  }

  /** ELECTRICAL: M BUS E (volts) and M BATT S (amps) rows (POH 7-50). */
  private drawElec(ctx: Ctx2D, y: number): void {
    const ev = this.ev;
    const lowV = this.sys.cfg.eis.elec.lowVolts;
    TF.draw(ctx, 'ELECTRICAL', EIS_W / 2, y, 12, P.white, 'center', 'middle');
    const mb = ev.mBus();
    const eb = ev.eBus();
    const ma = ev.mBatt();
    const sa = ev.sBatt();
    // Volts red at or below the LOW VOLTS threshold; negative (discharging) battery current amber (EST colours per POH 7-51).
    TF.draw(ctx, fmtFixed(mb, 1), 12, y + 20, 15, mb <= lowV ? P.red : P.white, 'left', 'middle');
    TF.draw(ctx, 'M BUS E', EIS_W / 2, y + 20, 11, P.white, 'center', 'middle');
    TF.draw(ctx, fmtFixed(eb, 1), EIS_W - 12, y + 20, 15, eb <= lowV ? P.red : P.white, 'right', 'middle');
    TF.draw(ctx, fmtFixed(ma, 1), 12, y + 40, 15, ma < 0 ? P.amber : P.white, 'left', 'middle');
    TF.draw(ctx, 'M BATT S', EIS_W / 2, y + 40, 11, P.white, 'center', 'middle');
    TF.draw(ctx, fmtFixed(sa, 1), EIS_W - 12, y + 40, 15, sa < -0.05 ? P.amber : P.white, 'right', 'middle');
  }

  private drawLean(ctx: Ctx2D, y0: number): void {
    const v = this.sys.vars;
    const e = this.sys.cfg.eis;
    let y = y0 + 170;
    this.barRow(ctx, this.ff, y, 'FFLOW', 'GPH');
    y += 36;
    const n = this.egtVals.length;
    const sel = (v.get(G1K.eisCylSel) | 0) > 0 ? (v.get(G1K.eisCylSel) | 0) - 1 : this.hottest;
    const colW = (EIS_W - 40) / n;
    const top = y;
    const h = 150;
    // EGT columns (upper part) and CHT tick (lower marker), selected / hottest cylinder cyan.
    for (let i = 0; i < n; i++) {
      const x = 20 + i * colW + colW * 0.15;
      const w = colW * 0.7;
      const egt = this.egtVals[i];
      const t = Math.max(0, Math.min(1, (egt - e.egt.min) / (e.egt.max - e.egt.min)));
      box(ctx, x, top + h * (1 - t), w, h * t, i === sel ? P.cyan : P.white, '');
      const cht = this.chtVals[i];
      const ct = Math.max(0, Math.min(1, (cht - e.cht.min) / (e.cht.max - e.cht.min)));
      line(ctx, x - 2, top + h * (1 - ct), x + w + 2, top + h * (1 - ct), cht >= e.cht.redline ? P.red : P.green, 3);
      TF.draw(ctx, String(i + 1), x + w / 2, top + h + 10, 11, i === sel ? P.cyan : P.white, 'center', 'middle');
      if (v.get(G1K.eisLeanAssist) >= 0.5 && this.peakEgt[i] > 0) {
        const pt = Math.max(0, Math.min(1, (this.peakEgt[i] - e.egt.min) / (e.egt.max - e.egt.min)));
        line(ctx, x, top + h * (1 - pt), x + w, top + h * (1 - pt), P.white, 1);
      }
    }
    y = top + h + 34;
    TF.draw(ctx, 'EGT °F', 12, y, 12, P.white, 'left', 'middle');
    TF.draw(ctx, fmtInt(Math.round(this.egtVals[sel] / 5) * 5), EIS_W - 12, y, 15, P.cyan, 'right', 'middle');
    y += 22;
    if (v.get(G1K.eisLeanAssist) >= 0.5) {
      const d = this.egtVals[sel] - this.peakEgt[sel];
      TF.draw(ctx, 'ΔPEAK °F', 12, y, 12, P.white, 'left', 'middle');
      TF.draw(ctx, fmtInt(Math.round(d)), EIS_W - 12, y, 15, P.cyan, 'right', 'middle');
      y += 22;
    }
    TF.draw(ctx, 'CHT °F', 12, y, 12, P.white, 'left', 'middle');
    const cht = this.chtVals[sel] ?? 0;
    TF.draw(ctx, fmtInt(Math.round(cht)), EIS_W - 12, y, 15, cht >= e.cht.redline ? P.red : P.cyan, 'right', 'middle');
  }

  private drawSystem(ctx: Ctx2D, y0: number): void {
    const f = this.sys.fuel;
    let y = y0 + 170;
    const row = (label: string, val: string, color: string = P.white): void => {
      TF.draw(ctx, label, 12, y, 12, P.white, 'left', 'middle');
      TF.draw(ctx, val, EIS_W - 12, y, 15, color, 'right', 'middle');
      y += 24;
    };
    const lvl = (g: LinearGauge): string => (g.exceed.level === 2 ? P.red : g.exceed.level === 1 ? P.yellow : P.white);
    row('OIL PSI', this.oilP.state.valid ? fmtInt(this.oilP.state.value) : '---', lvl(this.oilP));
    row('OIL °F', this.oilT.state.valid ? fmtInt(this.oilT.state.value) : '---', lvl(this.oilT));
    y += 8;
    TF.draw(ctx, 'FUEL CALC', EIS_W / 2, y, 12, P.white, 'center', 'middle');
    y += 22;
    row('FFLOW GPH', this.ff.state.valid ? fmtFixed(this.ff.state.value, 1) : '---');
    row('GAL USED', fmtFixed(f.usedGal, 1));
    row('GAL REM', fmtFixed(f.remainingGal, 1));
    y += 6;
    this.drawElec(ctx, y);
    this.drawHours(ctx, y + 70);
  }
}
