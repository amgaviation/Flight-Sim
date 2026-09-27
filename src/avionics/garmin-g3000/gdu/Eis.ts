/**
 * Engine Indication System strip (MFD left side, always visible; condensed
 * on a reversionary display). Layout follows the G5000 Citation EICAS figure
 * (CRG 190-02538-02 "EICAS Display (Normal)": N1% arc gauges with digital
 * boxes, ITT arc gauges, N2% / OIL PSI / OIL °C / FUEL PPH digital rows,
 * RAT / SAT / ΔISA, FUEL QTY total and per tank with fuel temperature, then
 * the CAS list with CAS UP / DN softkeys) and the Longitude Operators Guide
 * §7 (N1 thrust-mode label, V and T bugs, T/R UNLOCK / T/R DEPLOY, START,
 * start PSI, ITT digits removed once running; APU RPM / EGT; battery V/A).
 * The G3000 (M2) adds trim, flaps / speedbrake and cabin sections (PG
 * 190-02046-01 §3.1). Which sections appear, and all their scales, come from
 * the aircraft's `EisConfig`.
 *
 * Colours: normal digits green, pointer white; caution amber, warning red
 * (flashing inverse on exceedance, ExceedanceMonitor); invalid data = red X
 * (PG §3.1 "EIS information is presented using gauges ...").
 */
import type { SimVars } from '../../../core/SimVars';
import { DEG2RAD, clamp } from '../../../core/math';
import { KG_TO_LB } from '../../../core/units';
import { ExceedanceMonitor } from '../../common/alerting';
import { fmtFixed, fmtInt } from '../../common/format';
import { blinkOn } from '../../common/dynamics';
import { CasWindow, type CasModel, type CasStyle } from '../../common/draw/CasWindow';
import { box, line, triangle, type Ctx2D } from '../../common/draw/context';
import type { GaugeScale } from '../../common/draw/EngineIndications';
import { formatValue } from '../../common/draw/EngineIndications';
import type {
  EisCabinSection,
  EisConfig,
  EisDigitalRow,
  EisDigitalSection,
  EisElecSection,
  EisFlapsSection,
  EisFuelSection,
  EisIttSection,
  EisN1Section,
  EisSection,
  EisTrimSection,
  EisApuSection,
  EisOatSection,
} from '../config';
import { G3K_COLORS, G3K_PALETTE, TF } from './style';
import { fmtSigned } from '../format';

const P = G3K_PALETTE;

/** Garmin arc gauge (EST geometry from the G5000 EICAS figure: 225° sweep, thick green arc, tapered needle). */
class ArcGauge {
  readonly exceed: ExceedanceMonitor;
  value = 0;
  valid = true;
  /** Bugs: limit (white/green/magenta per mode) and command. NaN = hidden. */
  limit = NaN;
  limitColor: string = P.white;
  command = NaN;
  commandColor: string = P.cyan;
  showDigits = true;
  constructor(readonly scale: GaugeScale, readonly startDeg = -135, readonly endDeg = 90) {
    this.exceed = new ExceedanceMonitor(scale.limits);
  }
  update(dt: number): void {
    if (this.valid) this.exceed.update(this.value, dt);
  }
  ang(v: number): number {
    const s = this.scale;
    const f = (clamp(v, s.min, s.max) - s.min) / (s.max - s.min);
    return (this.startDeg + (this.endDeg - this.startDeg) * f) * DEG2RAD;
  }
  draw(ctx: Ctx2D, x: number, y: number, r: number, time: number): void {
    const s = this.scale;
    const a0 = this.ang(s.min) - Math.PI / 2;
    const a1 = this.ang(s.max) - Math.PI / 2;
    // Background arc (white start tick like the EICAS figure).
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.strokeStyle = '#3c4146';
    ctx.lineWidth = 7;
    ctx.stroke();
    for (const b of s.bands) {
      ctx.beginPath();
      ctx.arc(x, y, r, this.ang(b.from) - Math.PI / 2, this.ang(b.to) - Math.PI / 2);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 7;
      ctx.stroke();
    }
    const tick = (v: number, color: string, w: number, inner: number, outer: number): void => {
      const a = this.ang(v);
      line(ctx, x + (r - inner) * Math.sin(a), y - (r - inner) * Math.cos(a), x + (r + outer) * Math.sin(a), y - (r + outer) * Math.cos(a), color, w);
    };
    tick(s.min, P.white, 3, 5, 5);
    for (const v of s.amberlines) tick(v, P.amber, 4, 6, 7);
    for (const v of s.redlines) tick(v, P.red, 4, 6, 8);
    // Bugs outside the arc.
    const bug = (v: number, color: string): void => {
      if (!Number.isFinite(v)) return;
      const a = this.ang(v);
      const sx = Math.sin(a);
      const cx = Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(x + (r + 4) * sx, y - (r + 4) * cx);
      ctx.lineTo(x + (r + 13) * sx - 5 * cx, y - (r + 13) * cx - 5 * sx);
      ctx.lineTo(x + (r + 13) * sx + 5 * cx, y - (r + 13) * cx + 5 * sx);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    bug(this.limit, this.limitColor);
    bug(this.command, this.commandColor);
    const lvl = this.valid ? this.exceed.level : 0;
    const col = lvl === 2 ? P.red : lvl === 1 ? P.amber : P.white;
    if (this.valid) {
      // Tapered needle.
      const a = this.ang(this.value);
      const sx = Math.sin(a);
      const cx = Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(x + (r + 2) * sx, y - (r + 2) * cx);
      ctx.lineTo(x + r * 0.25 * sx + 6 * cx, y - r * 0.25 * cx + 6 * sx);
      ctx.lineTo(x + r * 0.25 * sx - 6 * cx, y - r * 0.25 * cx - 6 * sx);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    }
    // Digital box below the centre.
    if (!this.showDigits) return;
    const bw = r * 1.55;
    const bh = r * 0.48;
    const bx = x - bw / 2 + r * 0.12;
    const by = y + r * 0.32;
    const inverse = lvl > 0 && this.exceed.flashing && blinkOn(time, 2);
    const digitCol = lvl === 2 ? P.red : lvl === 1 ? P.amber : P.green;
    box(ctx, bx, by, bw, bh, inverse ? digitCol : '#000000', lvl > 0 ? digitCol : P.white, 1.5);
    if (!this.valid) {
      redX(ctx, bx, by, bw, bh);
      return;
    }
    TF.draw(ctx, formatValue(this.value, s), bx + bw - 6, by + bh / 2 + 1, bh * 0.82, inverse ? '#000000' : digitCol, 'right', 'middle');
  }
}

function redX(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.strokeStyle = P.red;
  ctx.lineWidth = 2;
  ctx.stroke();
}

const CAS_G3K: CasStyle = {
  palette: P,
  typeface: TF,
  fontSize: 19,
  lineHeight: 23,
  background: '',
  border: '',
  inverseFlash: true,
  align: 'left',
};

/** Readout colouring for a digital row value. */
function rowColor(v: number, l: EisDigitalRow['limits']): string {
  if (!l || !Number.isFinite(v)) return P.green;
  if ((l.warnLow !== undefined && v <= l.warnLow) || (l.warnHigh !== undefined && v >= l.warnHigh)) return P.red;
  if ((l.cautionLow !== undefined && v <= l.cautionLow) || (l.cautionHigh !== undefined && v >= l.cautionHigh)) return P.amber;
  return P.green;
}

interface SectionState {
  sec: EisSection;
  gauges: ArcGauge[];
}

const ENG = (e: number) => ({
  n1: `eng${e}.n1_pct`,
  itt: `eng${e}.itt_c`,
  running: `eng${e}.running`,
  start: `fadec.eng${e}.start_state`,
  detent: `fadec.eng${e}.detent`,
  target: `fadec.eng${e}.n1_target`,
  rev: `fadec.eng${e}.rev_deployed`,
  revUnlk: `fadec.eng${e}.rev_unlocked`,
});

export class EisRenderer {
  private readonly secs: SectionState[];
  private readonly revSecs: SectionState[];
  private readonly cas: CasWindow;
  private time = 0;
  private readonly engines: number;
  private readonly engVars = [ENG(1), ENG(2)];
  private readonly lists: readonly SectionState[][];

  constructor(private readonly vars: SimVars, readonly cfg: EisConfig, casModel: CasModel) {
    this.engines = cfg.engines;
    const mk = (sec: EisSection): SectionState => {
      const gauges: ArcGauge[] = [];
      if (sec.kind === 'n1' || sec.kind === 'itt') for (let e = 0; e < cfg.engines; e++) gauges.push(new ArcGauge(sec.scale));
      return { sec, gauges };
    };
    this.secs = cfg.sections.map(mk);
    const rev = cfg.reversionary ?? cfg.sections.filter((s) => s.kind === 'n1' || s.kind === 'itt' || s.kind === 'digital' || s.kind === 'fuel' || s.kind === 'cas' || s.kind === 'oat');
    this.revSecs = rev.map(mk);
    this.lists = [this.secs, this.revSecs];
    this.cas = new CasWindow({ x: 0, y: 0, w: 100, h: 100, model: casModel, style: CAS_G3K });
  }

  get animating(): boolean {
    return this.cas.animating;
  }

  /** CAS rows visible in the last drawn layout (for the CAS UP / DN softkeys). */
  get casRows(): number {
    return this.cas.visibleRows;
  }

  update(dt: number): void {
    this.time += dt;
    const v = this.vars;
    for (const list of this.lists) {
      for (const s of list) {
        const sec = s.sec;
        if (sec.kind === 'n1') {
          for (let e = 0; e < s.gauges.length; e++) {
            const g = s.gauges[e];
            const ev = this.engVars[e];
            g.value = v.get(sec.var ? sec.var(e + 1) : ev.n1);
            g.valid = true;
            const lim = v.get(sec.limitVar ?? 'fadec.n1_limit_pct', NaN);
            g.limit = lim > 0 ? lim : NaN;
            const at = v.get(sec.atVar ?? 'ap.at_engaged') >= 0.5;
            const cmdName = sec.commandVar ? sec.commandVar(e + 1) : ev.target;
            const cmd = cmdName ? v.get(cmdName, NaN) : NaN;
            g.command = cmd > 1 ? cmd : NaN;
            // Longitude OG 7-6: bugs cyan when pilot selected, green when matching the FADEC mode, magenta under A/T.
            g.commandColor = at ? P.magenta : Math.abs(cmd - lim) < 0.3 ? P.green : P.cyan;
            g.limitColor = at ? P.magenta : Math.abs(cmd - lim) < 0.3 ? P.green : P.white;
            g.update(dt);
          }
        } else if (sec.kind === 'itt') {
          for (let e = 0; e < s.gauges.length; e++) {
            const g = s.gauges[e];
            const ev = this.engVars[e];
            g.value = v.get(sec.var ? sec.var(e + 1) : ev.itt);
            const st = v.get(sec.startingVar ? sec.startingVar(e + 1) : ev.start);
            const starting = st >= 1 && st <= 3;
            const running = v.get(ev.running) >= 0.5;
            g.showDigits = !sec.digitsOnlyWhenNotRunning || !running || starting;
            g.update(dt);
          }
        }
      }
    }
    this.cas.update(dt);
  }

  /** Scrolls the CAS list (CAS UP / DN softkeys / GTC Scroll CAS). */
  scrollCas(rows: number): void {
    this.cas.model.scrollBy(rows, this.cas.visibleRows);
  }

  /** Full-height strip (MFD). */
  drawStrip(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    box(ctx, x, y, w, h, G3K_COLORS.eisBg, '');
    line(ctx, x + w - 1, y, x + w - 1, y + h, G3K_COLORS.eisLine, 2);
    let cy = y;
    const secs = this.secs;
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i];
      if (s.sec.kind === 'cas') {
        this.drawCas(ctx, x, cy, w, y + h - cy);
        cy = y + h;
        continue;
      }
      // Trim followed by flaps: side by side (TBM CRG Figure 3-1 "TRIMS | FLAPS").
      const nxt = secs[i + 1];
      if (s.sec.kind === 'trim' && nxt && nxt.sec.kind === 'flaps') {
        const tw = w * 0.62;
        const hh = this.drawTrim(ctx, s.sec, x, cy, tw);
        line(ctx, x + tw, cy, x + tw, cy + hh - 2, G3K_COLORS.eisLine, 1.5);
        this.drawFlapsVertical(ctx, nxt.sec, x + tw, cy, w - tw, hh - 2);
        line(ctx, x, cy + hh - 2, x + w, cy + hh - 2, G3K_COLORS.eisLine, 1.5);
        cy += hh;
        i++;
        continue;
      }
      // OAT followed by fuel: drawn side by side (G5000 EICAS figure).
      if (s.sec.kind === 'oat' && nxt && nxt.sec.kind === 'fuel') {
        const hh = 140;
        this.drawOat(ctx, s.sec, x, cy, w * 0.42, hh);
        line(ctx, x + w * 0.42, cy, x + w * 0.42, cy + hh, G3K_COLORS.eisLine, 1.5);
        this.drawFuel(ctx, nxt.sec, x + w * 0.42, cy, w * 0.58, hh);
        cy += hh;
        line(ctx, x, cy, x + w, cy, G3K_COLORS.eisLine, 1.5);
        i++;
        continue;
      }
      cy += this.drawSection(ctx, s, x, cy, w);
    }
  }

  /** Condensed EIS for a reversionary display: engines on the left half, the rest on the right. */
  drawCompact(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    box(ctx, x, y, w, h, G3K_COLORS.eisBg, '');
    const colW = w / 2;
    let ly = y;
    let ry = y;
    for (const s of this.revSecs) {
      const k = s.sec.kind;
      if (k === 'n1' || k === 'itt') ly += this.drawSection(ctx, s, x, ly, colW, 0.72);
      else if (k === 'cas') continue;
      else if (k === 'oat') ry += this.drawOat(ctx, s.sec, x + colW, ry, colW * 0.45, 80);
      else ry += this.drawSection(ctx, s, x + colW, ry, colW, 0.8);
    }
    const casTop = Math.max(ly, ry) + 4;
    if (this.revSecs.some((s) => s.sec.kind === 'cas')) this.drawCas(ctx, x, casTop, w, y + h - casTop);
    line(ctx, x, y + h - 1, x + w, y + h - 1, G3K_COLORS.eisLine, 2);
  }

  private drawSection(ctx: Ctx2D, s: SectionState, x: number, y: number, w: number, scale = 1): number {
    const sec = s.sec;
    switch (sec.kind) {
      case 'n1':
        return this.drawDials(ctx, s, sec, 'N1%', x, y, w, scale);
      case 'itt':
        return this.drawDials(ctx, s, sec, 'ITT°C', x, y, w, scale);
      case 'digital':
        return this.drawDigital(ctx, sec, x, y, w, scale);
      case 'oat':
        return this.drawOat(ctx, sec, x, y, w, 110);
      case 'fuel':
        return this.drawFuel(ctx, sec, x, y, w, (sec.tempVar ? 114 : 92) * scale);
      case 'trim':
        return this.drawTrim(ctx, sec, x, y, w);
      case 'flaps':
        return this.drawFlaps(ctx, sec, x, y, w);
      case 'cabin':
        return this.drawCabin(ctx, sec, x, y, w);
      case 'elec':
        return this.drawElec(ctx, sec, x, y, w);
      case 'apu':
        return this.drawApu(ctx, sec, x, y, w);
      case 'custom':
        sec.draw(ctx, x, y, w, sec.height, this.vars);
        return sec.height;
      default:
        return 0;
    }
  }

  // ---------------------------------------------------------------- sections

  private drawDials(ctx: Ctx2D, s: SectionState, sec: EisN1Section | EisIttSection, title: string, x: number, y: number, w: number, scale: number): number {
    const v = this.vars;
    const h = 124 * scale;
    const r = Math.min(w / 4 - 14, 42 * scale);
    const cy = y + 26 * scale + r;
    TF.draw(ctx, title, x + w / 2, y + 14 * scale, 19 * scale, P.white, 'center', 'middle');
    const n = s.gauges.length;
    for (let e = 0; e < n; e++) {
      const cx = n === 1 ? x + w / 2 : x + w * (e === 0 ? 0.27 : 0.73);
      const g = s.gauges[e];
      g.draw(ctx, cx, cy, r, this.time);
      const ev = this.engVars[e];
      if (sec.kind === 'n1') {
        // FADEC thrust mode label (TO / CLB / CRU / APR / T/R) above each gauge.
        const detent = v.getString(sec.detentVar ? sec.detentVar(e + 1) : ev.detent);
        const rev = v.get(sec.reverserVar ? sec.reverserVar(e + 1) : ev.rev) >= 0.5;
        const unlk = v.get(sec.reverserUnlockedVar ? sec.reverserUnlockedVar(e + 1) : ev.revUnlk) >= 0.5;
        if (rev || unlk) {
          const txt = rev ? 'T/R DEPLOY' : 'T/R UNLOCK';
          const tw = TF.width(ctx, txt, 13 * scale) + 6;
          box(ctx, cx - tw / 2, cy - r - 22 * scale, tw, 16 * scale, rev ? P.green : P.amber, '');
          TF.draw(ctx, txt, cx, cy - r - 14 * scale, 13 * scale, '#000000', 'center', 'middle');
        } else if (detent && detent !== 'IDLE') TF.draw(ctx, detent, cx + r * 0.1, cy - r * 0.2, 16 * scale, sec.modeColorByAt && v.get(sec.atVar ?? 'ap.at_engaged') >= 0.5 ? P.magenta : P.green, 'center', 'middle');
      } else {
        const st = v.get(sec.startingVar ? sec.startingVar(e + 1) : ev.start);
        if (st >= 1 && st <= 3) TF.draw(ctx, 'START', cx + (e === 0 ? -r - 2 : r + 2), cy + r * 0.2, 13 * scale, P.green, e === 0 ? 'right' : 'left', 'middle');
        if (sec.ignVar && v.get(sec.ignVar(e + 1)) >= 0.5) TF.draw(ctx, 'IGN', cx, cy - r - 6 * scale, 12 * scale, P.green, 'center', 'middle');
        if (sec.fireVar && v.get(sec.fireVar(e + 1)) >= 0.5) {
          box(ctx, cx - 22, cy - 12, 44, 22, P.red, '');
          TF.draw(ctx, 'FIRE', cx, cy, 16, P.white, 'center', 'middle');
        }
      }
    }
    if (sec.kind === 'n1' && sec.syncVar && v.get(sec.syncVar) >= 0.5) TF.draw(ctx, 'SYNC', x + w / 2, cy + r * 0.55, 15 * scale, P.green, 'center', 'middle');
    if (sec.kind === 'itt' && sec.startPsiVar && (v.get(this.engVars[0].running) < 0.5 || (n > 1 && v.get(this.engVars[1].running) < 0.5))) {
      TF.draw(ctx, 'START', x + w / 2, cy - 8, 12 * scale, P.white, 'center', 'middle');
      TF.draw(ctx, 'PSI', x + w / 2, cy + 6, 12 * scale, P.white, 'center', 'middle');
      TF.draw(ctx, fmtInt(v.get(sec.startPsiVar)), x + w / 2, cy + 24, 16 * scale, P.green, 'center', 'middle');
    }
    return h;
  }

  private drawDigital(ctx: Ctx2D, sec: EisDigitalSection, x: number, y: number, w: number, scale: number): number {
    const v = this.vars;
    const rowH = 27 * scale;
    let yy = y + rowH / 2 + 2;
    for (const r of sec.rows) {
      TF.draw(ctx, r.label, x + w / 2, yy, 17 * scale, P.white, 'center', 'middle');
      const n = r.vars.length;
      for (let e = 0; e < n; e++) {
        const raw = v.get(r.vars[e], NaN) * (r.factor ?? 1);
        const val = r.step ? Math.round(raw / r.step) * r.step : raw;
        const col = rowColor(val, r.limits);
        const txt = !Number.isFinite(val) ? '---' : r.decimals === 0 ? fmtInt(val) : fmtFixed(val, r.decimals);
        const vx = n === 1 ? x + w * 0.8 : e === 0 ? x + w * 0.3 : x + w * 0.97;
        TF.draw(ctx, txt, vx, yy, 22 * scale, col, 'right', 'middle');
        if (r.flagVars && r.flagVars[e] && v.get(r.flagVars[e]) >= 0.5) TF.draw(ctx, r.flagText ?? 'IGN', e === 0 ? x + 4 : x + w - 4 - 0, yy - 12 * scale, 11 * scale, P.green, e === 0 ? 'left' : 'right', 'middle');
      }
      if (r.unitLeft) TF.draw(ctx, r.unitLeft, x + 6, yy, 15 * scale, P.white, 'left', 'middle');
      yy += rowH;
    }
    const h = sec.rows.length * rowH + 6;
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  private drawOat(ctx: Ctx2D, sec: EisOatSection, x: number, y: number, w: number, h: number): number {
    const v = this.vars;
    const sat = v.get('adc1.sat_c', NaN);
    const tat = v.get('adc1.tat_c', NaN);
    const alt = v.get('adc1.press_alt_ft', 0);
    const isa = sat - (15 - 0.0019812 * alt);
    const rows: [string, number][] = sec.showRat === false ? [['SAT°C', sat], ['ΔISA°C', isa]] : [['RAT°C', tat], ['SAT°C', sat], ['ΔISA°C', isa]];
    const rh = h / rows.length;
    for (let i = 0; i < rows.length; i++) {
      const yy = y + rh * (i + 0.5);
      TF.draw(ctx, rows[i][0], x + 8, yy, 16, P.white, 'left', 'middle');
      const val = rows[i][1];
      const txt = !Number.isFinite(val) ? '--' : i === rows.length - 1 ? fmtSigned(val) : fmtInt(val);
      TF.draw(ctx, txt, x + w - 8, yy, 22, P.white, 'right', 'middle');
    }
    return h;
  }

  private drawFuel(ctx: Ctx2D, sec: EisFuelSection, x: number, y: number, w: number, h: number): number {
    const v = this.vars;
    const k = sec.unit === 'lb' ? KG_TO_LB : 1;
    const l = v.get(sec.tanks[0]) * k;
    const r = v.get(sec.tanks[1]) * k;
    const tot = l + r;
    const cx = x + w / 2;
    TF.draw(ctx, 'FUEL QTY', cx, y + 12, 16, P.white, 'center', 'middle');
    TF.draw(ctx, 'TOT', x + 8, y + 34, 14, P.white, 'left', 'middle');
    TF.draw(ctx, sec.unit === 'lb' ? 'LBS' : 'KG', x + w - 6, y + 34, 13, P.white, 'right', 'middle');
    const imb = sec.imbalance !== undefined && Math.abs(l - r) > sec.imbalance;
    const bw = w * 0.42;
    box(ctx, cx - bw / 2, y + 23, bw, 23, '#000000', P.white, 1.5);
    TF.draw(ctx, fmtInt(Math.round(tot / 10) * 10), cx + bw / 2 - 5, y + 35, 20, P.green, 'right', 'middle');
    // Tree lines to the tanks.
    ctx.beginPath();
    ctx.moveTo(cx, y + 46);
    ctx.lineTo(cx, y + 53);
    ctx.moveTo(x + w * 0.22, y + 60);
    ctx.lineTo(x + w * 0.22, y + 53);
    ctx.lineTo(x + w * 0.78, y + 53);
    ctx.lineTo(x + w * 0.78, y + 60);
    ctx.strokeStyle = P.white;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const tank = (val: number, tx: number): void => {
      const low = sec.lowLevel !== undefined && val <= sec.lowLevel;
      const col = low || imb ? P.amber : P.green;
      const tw = w * 0.42;
      box(ctx, tx - tw / 2, y + 60, tw, 23, low ? P.amber : '#000000', col, 1.5);
      TF.draw(ctx, fmtInt(Math.round(val / 10) * 10), tx + tw / 2 - 5, y + 72, 20, low ? '#000000' : col, 'right', 'middle');
    };
    tank(l, x + w * 0.22);
    tank(r, x + w * 0.78);
    if (sec.tempVar) {
      TF.draw(ctx, fmtInt(v.get(sec.tempVar)), x + w * 0.22, y + 100, 19, P.white, 'center', 'middle');
      TF.draw(ctx, 'FUEL°C', cx, y + 100, 14, P.white, 'center', 'middle');
      TF.draw(ctx, fmtInt(v.get(sec.tempVar)), x + w * 0.78, y + 100, 19, P.white, 'center', 'middle');
    }
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h;
  }

  private drawTrim(ctx: Ctx2D, sec: EisTrimSection, x: number, y: number, w: number): number {
    const v = this.vars;
    const h = 108;
    TF.draw(ctx, 'TRIM', x + 12, y + 14, 16, P.white, 'left', 'middle');
    // Roll trim (horizontal, L/R) and yaw (horizontal, NL/NR) on the left; pitch (vertical, ND/NU) on the right.
    const hbar = (label: string, l: string, r: string, val: number, min: number, max: number, yy: number): void => {
      const bx = x + 24;
      const bw = w * 0.46;
      TF.draw(ctx, l, bx - 6, yy, 13, P.white, 'right', 'middle');
      TF.draw(ctx, r, bx + bw + 6, yy, 13, P.white, 'left', 'middle');
      line(ctx, bx, yy, bx + bw, yy, P.white, 1.5);
      line(ctx, bx + bw / 2, yy - 5, bx + bw / 2, yy + 5, P.white, 1.5);
      const f = clamp((val - min) / (max - min), 0, 1);
      triangle(ctx, bx + bw * f - 6, yy - 12, bx + bw * f + 6, yy - 12, bx + bw * f, yy - 2, P.white);
      TF.draw(ctx, label, bx + bw / 2, yy + 13, 12, P.white, 'center', 'middle');
    };
    if (sec.roll) hbar('AIL', 'L', 'R', v.get(sec.roll.var), sec.roll.min, sec.roll.max, y + 44);
    if (sec.yaw) hbar('RUD', 'L', 'R', v.get(sec.yaw.var), sec.yaw.min, sec.yaw.max, y + 84);
    if (sec.pitch) {
      const px = x + w - 30;
      const top = y + 18;
      const bh = h - 30;
      box(ctx, px - 3, top, 6, bh, '#303438', '');
      const band = sec.pitch.takeoffBand;
      if (band) {
        const f0 = (band[0] - sec.pitch.min) / (sec.pitch.max - sec.pitch.min);
        const f1 = (band[1] - sec.pitch.min) / (sec.pitch.max - sec.pitch.min);
        box(ctx, px - 3, top + bh * (1 - f1), 6, bh * (f1 - f0), P.green, '');
      }
      const f = clamp((v.get(sec.pitch.var) - sec.pitch.min) / (sec.pitch.max - sec.pitch.min), 0, 1);
      const py = top + bh * (1 - f);
      triangle(ctx, px + 6, py, px + 18, py - 6, px + 18, py + 6, P.white);
      TF.draw(ctx, 'NU', px - 8, top + 6, 12, P.white, 'right', 'middle');
      TF.draw(ctx, 'ND', px - 8, top + bh - 6, 12, P.white, 'right', 'middle');
      TF.draw(ctx, sec.pitch.label ?? 'ELEV', px + 2, top + bh + 10, 12, P.white, 'center', 'middle');
    }
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  /** Selected flap angle (deg) from the optional flap-lever var, NaN when not configured. */
  private selectedFlapDeg(sec: EisFlapsSection): number {
    if (!sec.selectedVar || !sec.selectedDeg) return NaN;
    const i = Math.round(this.vars.get(sec.selectedVar));
    return i >= 0 && i < sec.selectedDeg.length ? sec.selectedDeg[i] : NaN;
  }

  private drawFlaps(ctx: Ctx2D, sec: EisFlapsSection, x: number, y: number, w: number): number {
    const v = this.vars;
    const h = 84;
    const deg = v.get(sec.var);
    TF.draw(ctx, 'FLAPS', x + 12, y + 16, 16, P.white, 'left', 'middle');
    // Arc-less linear scale with detent ticks (G3000 flap indicator, PG §3.1 "Trim and Flap Indicators").
    const sx = x + 24;
    const sw = w - 70;
    const sy = y + 40;
    line(ctx, sx, sy, sx + sw, sy, P.white, 2);
    for (const d of sec.detents) {
      const dx = sx + (d.deg / sec.maxDeg) * sw;
      line(ctx, dx, sy - 6, dx, sy + 6, P.white, 2);
      TF.draw(ctx, d.label, dx, sy + 18, 13, P.white, 'center', 'middle');
    }
    const px = sx + clamp(deg / sec.maxDeg, 0, 1) * sw;
    const sel = this.selectedFlapDeg(sec);
    if (Number.isFinite(sel)) {
      const bx = sx + clamp(sel / sec.maxDeg, 0, 1) * sw;
      triangle(ctx, bx - 6, sy + 4, bx + 6, sy + 4, bx, sy + 1, P.cyan);
      line(ctx, bx, sy - 6, bx, sy + 6, P.cyan, 3);
    }
    triangle(ctx, px - 7, sy - 18, px + 7, sy - 18, px, sy - 3, P.white);
    TF.draw(ctx, fmtInt(deg), x + w - 8, sy, 20, P.green, 'right', 'middle');
    if (sec.speedbrakeVar) {
      const sb = v.get(sec.speedbrakeVar);
      if (sb > 0.05) {
        const txt = sec.speedbrakeLabel ?? 'SPD BRK';
        const tw = TF.width(ctx, txt, 15) + 10;
        box(ctx, x + w - tw - 8, y + 6, tw, 20, P.amber, '');
        TF.draw(ctx, txt, x + w - 8 - tw / 2, y + 17, 15, '#000000', 'center', 'middle');
      }
    }
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  /** Vertical flap scale for the narrow column beside the trims (UP at the top, detent labels right). */
  private drawFlapsVertical(ctx: Ctx2D, sec: EisFlapsSection, x: number, y: number, w: number, h: number): void {
    const v = this.vars;
    const deg = v.get(sec.var);
    TF.draw(ctx, 'FLAPS', x + w / 2, y + 14, 15, P.white, 'center', 'middle');
    const sx = x + 22;
    const top = y + 32;
    const bh = h - 44;
    line(ctx, sx, top, sx, top + bh, P.white, 2);
    for (const d of sec.detents) {
      const dy = top + (d.deg / sec.maxDeg) * bh;
      line(ctx, sx - 5, dy, sx + 5, dy, P.white, 2);
      TF.draw(ctx, d.label, sx + 12, dy, 12, P.white, 'left', 'middle');
    }
    const py = top + clamp(deg / sec.maxDeg, 0, 1) * bh;
    const sel = this.selectedFlapDeg(sec);
    if (Number.isFinite(sel)) line(ctx, sx - 6, top + clamp(sel / sec.maxDeg, 0, 1) * bh, sx + 6, top + clamp(sel / sec.maxDeg, 0, 1) * bh, P.cyan, 3);
    triangle(ctx, sx - 16, py - 6, sx - 16, py + 6, sx - 4, py, P.white);
    TF.draw(ctx, fmtInt(deg), x + w - 6, y + h - 10, 17, P.green, 'right', 'middle');
    if (sec.speedbrakeVar && v.get(sec.speedbrakeVar) > 0.05) {
      const txt = sec.speedbrakeLabel ?? 'SPD BRK';
      const tw = Math.min(w - 6, TF.width(ctx, txt, 12) + 8);
      box(ctx, x + w / 2 - tw / 2, y + 22, tw, 16, P.amber, '');
      TF.draw(ctx, txt, x + w / 2, y + 30, 12, '#000000', 'center', 'middle');
    }
  }

  private drawCabin(ctx: Ctx2D, sec: EisCabinSection, x: number, y: number, w: number): number {
    const v = this.vars;
    const rows: [string, string, number, 0 | 1, string][] = [];
    if (sec.altVar !== '') rows.push(['CAB ALT', sec.altVar ?? 'press.cabin_alt_ft', 0, 0, 'FT']);
    if (sec.rateVar !== '') rows.push(['RATE', sec.rateVar ?? 'press.cabin_rate_fpm', 0, 0, 'FPM']);
    if (sec.diffVar !== '') rows.push(['ΔP', sec.diffVar ?? 'press.diff_psi', 0, 1, 'PSI']);
    if (sec.ldgElevVar) rows.push(['LFE', sec.ldgElevVar, 0, 0, 'FT']);
    if (sec.oxygenVar) rows.push(['OXY', sec.oxygenVar, 0, 0, 'PSI']);
    const rh = 24;
    for (let i = 0; i < rows.length; i++) {
      const yy = y + 14 + i * rh;
      const [label, name, , dec, unit] = rows[i];
      const val = v.get(name);
      let col: string = P.green;
      if (label === 'CAB ALT' && sec.altWarnFt !== undefined && val >= sec.altWarnFt) col = P.red;
      if (label === 'ΔP' && sec.diffMaxPsi !== undefined && val >= sec.diffMaxPsi) col = P.red;
      TF.draw(ctx, label, x + 10, yy, 15, P.white, 'left', 'middle');
      const txt = dec === 1 ? fmtFixed(val, 1) : label === 'RATE' ? fmtInt(Math.round(val / 50) * 50) : fmtInt(Math.round(val / 10) * 10);
      TF.draw(ctx, txt, x + w - 44, yy, 19, col, 'right', 'middle');
      TF.draw(ctx, unit, x + w - 40, yy + 2, 12, P.white, 'left', 'middle');
    }
    const h = rows.length * rh + 6;
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  private drawElec(ctx: Ctx2D, sec: EisElecSection, x: number, y: number, w: number): number {
    const v = this.vars;
    const rh = 24;
    for (let i = 0; i < sec.rows.length; i++) {
      const r = sec.rows[i];
      const yy = y + 14 + i * rh;
      TF.draw(ctx, r.label, x + w / 2, yy, 15, P.white, 'center', 'middle');
      for (let e = 0; e < r.vars.length; e++) {
        const val = v.get(r.vars[e]);
        const col = rowColor(val, r.limits);
        const txt = r.decimals === 1 ? fmtFixed(val, 1) : fmtInt(val);
        const vx = r.vars.length === 1 ? x + w * 0.8 : e === 0 ? x + w * 0.28 : x + w * 0.95;
        if (col !== P.green) {
          const tw = TF.width(ctx, txt, 19) + 6;
          box(ctx, vx - tw + 3, yy - 11, tw, 22, col, '');
          TF.draw(ctx, txt, vx, yy, 19, '#000000', 'right', 'middle');
        } else TF.draw(ctx, txt, vx, yy, 19, col, 'right', 'middle');
      }
    }
    const h = sec.rows.length * rh + 6;
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  private drawApu(ctx: Ctx2D, sec: EisApuSection, x: number, y: number, w: number): number {
    const v = this.vars;
    const h = 52;
    TF.draw(ctx, 'APU', x + 10, y + 26, 16, P.white, 'left', 'middle');
    if (v.get(sec.runningVar) < 0.5 && v.get(sec.rpmVar) < 5) {
      TF.draw(ctx, 'APU OFF', x + w * 0.62, y + 26, 18, P.white, 'center', 'middle');
    } else {
      TF.draw(ctx, 'RPM%', x + w * 0.42, y + 14, 13, P.white, 'center', 'middle');
      TF.draw(ctx, fmtInt(v.get(sec.rpmVar)), x + w * 0.42, y + 34, 20, P.green, 'center', 'middle');
      TF.draw(ctx, 'EGT°C', x + w * 0.78, y + 14, 13, P.white, 'center', 'middle');
      TF.draw(ctx, fmtInt(v.get(sec.egtVar)), x + w * 0.78, y + 34, 20, P.green, 'center', 'middle');
    }
    line(ctx, x, y + h, x + w, y + h, G3K_COLORS.eisLine, 1.5);
    return h + 2;
  }

  private drawCas(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    const foot = 26;
    this.cas.x = x;
    this.cas.y = y + 2;
    this.cas.w = w;
    this.cas.h = Math.max(24, h - foot - 2);
    this.cas.draw(ctx);
    // Footer: "CAS  n↑  m↓" hidden message counts (G5000 CRG "Crew Alerting System").
    const list = this.cas.model.list;
    const rows = this.cas.visibleRows;
    let pinned = 0;
    while (pinned < list.length && list[pinned].level === 'warning' && pinned < rows) pinned++;
    const rest = list.length - pinned;
    const free = rows - pinned;
    const scroll = Math.max(0, Math.min(this.cas.model.scroll, rest - free));
    const above = scroll;
    const below = Math.max(0, rest - scroll - free);
    const fy = y + h - foot / 2;
    line(ctx, x + 6, y + h - foot, x + w - 6, y + h - foot, G3K_COLORS.eisLine, 1);
    TF.draw(ctx, 'CAS', x + w * 0.4, fy, 16, P.white, 'center', 'middle');
    TF.draw(ctx, fmtInt(above), x + w * 0.58, fy, 15, above ? P.white : P.grey, 'right', 'middle');
    TF.draw(ctx, '↑', x + w * 0.59, fy, 15, above ? P.white : P.grey, 'left', 'middle');
    TF.draw(ctx, fmtInt(below), x + w * 0.73, fy, 15, below ? P.white : P.grey, 'right', 'middle');
    TF.draw(ctx, '↓', x + w * 0.74, fy, 15, below ? P.white : P.grey, 'left', 'middle');
  }
}
