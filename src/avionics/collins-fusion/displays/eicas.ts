/**
 * EICAS window (Global Vision): engine indications for the two
 * BR700-710A2-20 engines, the crew alerting message list, fuel quantity,
 * landing gear, slat / flap, spoilers and trims.
 *
 * Content follows the Global Express primary EICAS page (training manual
 * "Airplane General", figure GX_01_023: "Engine Instruments, Caution and
 * Warning Annunciator, Fuel Quantity, Flap/Slat and Spoiler Status, Landing
 * Gear Status, Flight Control Trims"; rating / N1 target "T/O N1", "SYNC",
 * EPR "CRZ EPR", N2, FF (PPH), OIL TEMP, OIL PRESS, IGN / START flags,
 * gear "DN DN DN", flap "30", slat "OUT", trims "NU / ND", "NL / NR",
 * "LWD / RWD"), which FSB BD-700-1A10 Rev 7 says the Vision EICAS keeps
 * with "Some engine and system indications differ slightly in
 * presentation" and "Primary EICAS changes in N1/EPR presentation".
 *
 * Limits: EASA TCDS E.018 (config.ts BR710A2_20_ENGINES): N1 red 102.1 %,
 * ITT amber 860 C (MCT) / red 900 C (take-off; 700 C while starting on the
 * ground), N2 amber 98.9 % / red 99.6 %, oil temperature red 160 C, oil
 * pressure amber / red against the TCDS N2-dependent curves. Stabilizer
 * green band 4.5-11 units (GX_10_022). Geometry and dial sweep are EST.
 */
import type { SimVars } from '../../../core/SimVars';
import { ExceedanceMonitor } from '../../common/alerting';
import { blinkOn } from '../../common/dynamics';
import type { Ctx2D } from '../../common/draw/context';
import type { ShownWindow } from '../logic/layout';
import { oilPressLimit, type FusionResolvedConfig, type FusionScale } from '../config';
import { CAS_COLORS, type FusionCas } from '../logic/cas';
import { C, DEG, fstr, istr, pstr, rect, seg, txt } from './style';
import type { HotSpots, WindowRenderer } from './window';

const KG_TO_LB = 2.20462;
const START = 135 * DEG;
const SWEEP = 225 * DEG;

interface EngMon {
  n1: ExceedanceMonitor;
  itt: ExceedanceMonitor;
  ittStart: ExceedanceMonitor;
  n2: ExceedanceMonitor;
  oilT: ExceedanceMonitor;
}

export class EicasWindow implements WindowRenderer {
  readonly animated = true;
  private readonly mon: EngMon[] = [];
  private time = 0;
  private readonly tankVars: string[];
  private readonly fuelTitle: string;
  private readonly names: {
    n1: string[];
    n2: string[];
    itt: string[];
    ff: string[];
    oilP: string[];
    oilT: string[];
    run: string[];
    ign: string[];
    epr: string[];
    n1Mode: string[];
    start: string[];
    revU: string[];
    revD: string[];
    n1t: string[];
  };

  constructor(
    private readonly vars: SimVars,
    private readonly cfg: FusionResolvedConfig,
    private readonly cas: FusionCas,
  ) {
    const sc = cfg.scales;
    const ev = cfg.engines.vars;
    const idx = [1, 2];
    this.names = {
      n1: idx.map(ev.n1),
      n2: idx.map(ev.n2),
      itt: idx.map(ev.itt),
      ff: idx.map(ev.ff),
      oilP: idx.map(ev.oilPress),
      oilT: idx.map(ev.oilTemp),
      run: idx.map(ev.running),
      ign: idx.map(ev.ignition),
      epr: idx.map(ev.epr),
      n1Mode: idx.map(ev.n1Mode),
      start: idx.map(ev.startState),
      revU: idx.map(ev.revUnlocked),
      revD: idx.map(ev.revDeployed),
      n1t: idx.map(ev.n1Target),
    };
    this.tankVars = cfg.airframe.tanks.map((t) => `fuel.tank${t.index}_kg`);
    this.fuelTitle = `FUEL QTY (${cfg.fuelUnit === 'kg' ? 'KG' : 'LB'})`;
    for (let i = 0; i < 2; i++) {
      this.mon.push({
        n1: new ExceedanceMonitor(sc.n1.limits),
        itt: new ExceedanceMonitor(sc.itt.limits),
        ittStart: new ExceedanceMonitor(sc.ittStart.limits),
        n2: new ExceedanceMonitor(sc.n2.limits),
        oilT: new ExceedanceMonitor(sc.oilTemp.limits),
      });
    }
  }

  /** Engine exceedance (either engine, warning level) for the suite's reversion rule. */
  get exceedance(): boolean {
    for (const m of this.mon) if (m.n1.level >= 2 || m.itt.level >= 2 || m.n2.level >= 2 || m.oilT.level >= 2) return true;
    return false;
  }

  private starting(i: number): boolean {
    const st = this.vars.get(this.names.start[i]);
    return st >= 1 && st <= 3;
  }

  /** Window update from the AFD: nothing (the suite steps the monitors every systems step). */
  update(): void {}

  /** Systems-rate step: exceedance monitors and the flash timer (independent of what is displayed). */
  step(dt: number): void {
    this.time += dt;
    const v = this.vars;
    const n = this.names;
    for (let i = 0; i < 2; i++) {
      const m = this.mon[i];
      m.n1.update(v.get(n.n1[i]), dt);
      const itt = v.get(n.itt[i]);
      if (this.starting(i) && v.getBool('gear.air_ground')) m.ittStart.update(itt, dt);
      else m.ittStart.update(0, dt);
      m.itt.update(itt, dt);
      m.n2.update(v.get(n.n2[i]), dt);
      m.oilT.update(v.get(n.oilT[i]), dt);
    }
  }

  draw(ctx: Ctx2D, w: ShownWindow, _hs: HotSpots): void {
    const r = w.rect;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    rect(ctx, 0, 0, r.w, r.h, C.bg);
    const sx = r.w / 512;
    const sy = r.h / 640;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    this.drawEngines(ctx);
    this.drawCas(ctx);
    this.drawConfig(ctx);
    ctx.restore();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }

  // ------------------------------------------------------------ engines

  private dial(ctx: Ctx2D, cx: number, cy: number, rad: number, value: number, sc: FusionScale, level: number, valid: boolean, decimals: number, target: number, flashVisible: boolean): void {
    const f = (x: number) => START + (Math.max(sc.min, Math.min(sc.max * 1.05, x)) - sc.min) / (sc.max - sc.min) * SWEEP;
    // Scale arc (white), amber band, red line.
    ctx.beginPath();
    ctx.arc(cx, cy, rad, START, START + SWEEP);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (Number.isFinite(sc.amber) && Number.isFinite(sc.red)) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad, f(sc.amber), f(sc.red));
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    if (Number.isFinite(sc.red)) {
      const a = f(sc.red);
      seg(ctx, cx + Math.cos(a) * (rad - 8), cy + Math.sin(a) * (rad - 8), cx + Math.cos(a) * (rad + 9), cy + Math.sin(a) * (rad + 9), C.red, 4);
    }
    // Major ticks (EST: every 10 % of the scale).
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) {
      const a = START + (k / 10) * (SWEEP * (sc.max - sc.min)) / (sc.max - sc.min);
      ctx.moveTo(cx + Math.cos(a) * (rad - 7), cy + Math.sin(a) * (rad - 7));
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.stroke();
    const color = level >= 2 ? C.red : level === 1 ? C.amber : C.white;
    if (valid) {
      // Filled sector from zero to the value (Collins-style shaded arc, EST) and the needle.
      const a = f(value);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rad - 3, START, a);
      ctx.closePath();
      ctx.fillStyle = 'rgba(160,165,172,0.28)';
      ctx.fill();
      seg(ctx, cx, cy, cx + Math.cos(a) * (rad - 2), cy + Math.sin(a) * (rad - 2), color, 3.5);
      // Target / command bug (cyan).
      if (Number.isFinite(target) && target > 0) {
        const t = f(target);
        const bx = cx + Math.cos(t) * (rad + 6);
        const by = cy + Math.sin(t) * (rad + 6);
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fillStyle = C.cyan;
        ctx.fill();
      }
    }
    // Digital readout (inverse video while an exceedance flashes).
    const bw = 64;
    const bh = 26;
    const bx = cx + 2;
    const by = cy + 6;
    const inv = level >= 1 && !flashVisible;
    rect(ctx, bx, by, bw, bh, inv ? color : C.bg, C.white, 1.5);
    txt(ctx, valid ? fstr(value, decimals) : '---', bx + bw - 5, by + bh / 2 + 1, 20, inv ? C.bg : color, 'right');
  }

  private drawEngines(ctx: Ctx2D): void {
    const v = this.vars;
    const n = this.names;
    const sc = this.cfg.scales;
    const X = [82, 238];
    const colMid = 160;
    // Header: thrust rating and N1 target.
    const rating = v.getString(this.cfg.engines.vars.rating);
    const lim = v.get(this.cfg.engines.vars.n1Limit, NaN);
    if (rating) {
      txt(ctx, rating, colMid - 6, 16, 17, C.green, 'right');
      if (Number.isFinite(lim)) txt(ctx, fstr(lim, 1), colMid + 6, 16, 17, C.cyan, 'left');
    }
    // EPR (FADEC primary parameter), EST: derived from N1 when the aircraft does not publish it.
    if (this.cfg.engines.showEpr) {
      for (let i = 0; i < 2; i++) {
        const epr = v.has(n.epr[i]) ? v.get(n.epr[i]) : eprFromN1(v.get(n.n1[i]));
        const n1Mode = v.getBool(n.n1Mode[i]);
        txt(ctx, n1Mode ? 'N1 MODE' : fstr(epr, 2), X[i], 40, n1Mode ? 13 : 18, n1Mode ? C.amber : C.green, 'center');
      }
      txt(ctx, 'EPR', colMid, 40, 13, C.white, 'center');
    }
    // N1 dials.
    for (let i = 0; i < 2; i++) {
      const m = this.mon[i];
      const val = v.get(n.n1[i]);
      this.dial(ctx, X[i] - 14, 104, 54, val, sc.n1, m.n1.level, v.has(n.n1[i]), 1, v.get(n.n1t[i], NaN), m.n1.visible);
      if (v.getBool(n.revD[i])) txt(ctx, 'REV', X[i] - 14, 60, 15, C.green, 'center');
      else if (v.getBool(n.revU[i])) txt(ctx, 'REV', X[i] - 14, 60, 15, C.amber, 'center');
    }
    txt(ctx, 'N1', colMid, 110, 16, C.white, 'center');
    txt(ctx, '%', colMid, 128, 12, C.white, 'center');
    // ITT dials.
    for (let i = 0; i < 2; i++) {
      const m = this.mon[i];
      const start = this.starting(i) && v.getBool('gear.air_ground');
      const scale = start ? sc.ittStart : sc.itt;
      const lvl = Math.max(m.itt.level, m.ittStart.level);
      this.dial(ctx, X[i] - 14, 220, 46, v.get(n.itt[i]), scale, lvl, v.has(n.itt[i]), 0, NaN, m.itt.visible && m.ittStart.visible);
      if (v.getBool(n.ign[i])) txt(ctx, 'IGN', X[i] - 14, 178, 14, C.green, 'center');
      if (this.starting(i)) txt(ctx, 'START', X[i] - 14, 262, 13, C.white, 'center');
    }
    txt(ctx, 'ITT', colMid, 222, 16, C.white, 'center');
    txt(ctx, '°C', colMid, 240, 12, C.white, 'center');
    // Digital rows: N2, FF, OIL TEMP, OIL PRESS.
    const rows = [
      ['N2', '%'],
      ['FF', 'PPH'],
      ['OIL TEMP', '°C'],
      ['OIL PRESS', 'PSI'],
    ];
    const y0 = 294;
    const dy = 26;
    for (let r = 0; r < rows.length; r++) {
      const y = y0 + r * dy;
      txt(ctx, rows[r][0], colMid, y, 14, C.white, 'center');
      for (let i = 0; i < 2; i++) {
        let val = NaN;
        let color: string = C.green;
        let s = '';
        switch (r) {
          case 0: {
            val = v.get(n.n2[i]);
            const lvl = this.mon[i].n2.level;
            color = lvl >= 2 ? C.red : val > this.cfg.engines.limits.n2MctPct ? C.amber : C.green;
            s = fstr(val, 1);
            break;
          }
          case 1:
            val = v.get(n.ff[i]);
            s = istr(Math.round(val / 10) * 10);
            break;
          case 2: {
            val = v.get(n.oilT[i]);
            const lvl = this.mon[i].oilT.level;
            color = lvl >= 2 ? C.red : val < this.cfg.engines.limits.oilTempMinTakeoffC && v.getBool(n.run[i]) ? C.amber : C.green;
            s = istr(val);
            break;
          }
          case 3: {
            val = v.get(n.oilP[i]);
            const n2 = v.get(n.n2[i]);
            const L = this.cfg.engines.limits;
            const running = v.getBool(n.run[i]) && n2 > 50;
            color = running && val < oilPressLimit(L.oilPressWarning, n2) ? C.red : running && val < oilPressLimit(L.oilPressCaution, n2) ? C.amber : C.green;
            s = istr(val);
            break;
          }
        }
        const x = i === 0 ? colMid - 62 : colMid + 62;
        txt(ctx, v.has(r === 0 ? n.n2[i] : r === 1 ? n.ff[i] : r === 2 ? n.oilT[i] : n.oilP[i]) ? s : '---', x, y, 18, color, i === 0 ? 'right' : 'left');
      }
    }
  }

  // ------------------------------------------------------------ CAS

  private drawCas(ctx: Ctx2D): void {
    const x0 = 324;
    const y0 = 8;
    const rowH = 20;
    this.cas.rows = 19;
    seg(ctx, x0 - 8, 6, x0 - 8, 400, C.line, 1.5);
    const list = this.cas.view();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const y = y0 + i * rowH + rowH / 2;
      const col = CAS_COLORS[m.level];
      const flashing = !m.acknowledged && (m.level === 'warning' || m.level === 'caution');
      if (flashing && blinkOn(this.time, 1.6)) {
        rect(ctx, x0 - 2, y - rowH / 2 + 1, 186, rowH - 2, col);
        txt(ctx, m.text, x0, y, 16, C.bg, 'left');
      } else txt(ctx, m.text, x0, y, 16, col, 'left');
    }
    const below = this.cas.hiddenBelowCount;
    if (below > 0) {
      rect(ctx, x0 + 40, 386, 110, 18, C.bg, C.white, 1);
      txt(ctx, pstr('MSGS +', below), x0 + 95, 395, 13, C.white, 'center');
    }
    if (this.cas.hiddenAbove > 0) txt(ctx, '▲', x0 + 170, 12, 12, C.white, 'center');
  }

  // ------------------------------------------------------------ fuel / config / trims

  private drawConfig(ctx: Ctx2D): void {
    const v = this.vars;
    const af = this.cfg.airframe;
    seg(ctx, 6, 410, 506, 410, C.line, 1.5);
    // ---- Fuel quantity.
    const unit = this.cfg.fuelUnit;
    const k = unit === 'kg' ? 1 : KG_TO_LB;
    let total = 0;
    txt(ctx, this.fuelTitle, 12, 426, 13, C.white, 'left');
    const tx = [40, 104, 168, 232];
    af.tanks.forEach((t, i) => {
      const q = v.get(this.tankVars[i]) * k;
      total += q;
      txt(ctx, t.label, tx[i] ?? 40 + i * 64, 448, 12, C.white, 'center');
      const low = q < (unit === 'kg' ? 272 : 600) && (t.label === 'L' || t.label === 'R'); // GX fuel: "low wing fuel condition (600 pounds each wing)"
      txt(ctx, istr(Math.round(q / 10) * 10), tx[i] ?? 40 + i * 64, 468, 16, low ? C.amber : C.green, 'center');
    });
    txt(ctx, 'TOTAL', 290, 448, 12, C.white, 'center');
    txt(ctx, istr(Math.round(total / 10) * 10), 290, 468, 18, C.green, 'center');
    // ---- Gear.
    txt(ctx, 'GEAR', 50, 500, 12, C.white, 'center');
    const gx = [50, 26, 74];
    const gy = [520, 544, 544];
    for (let i = 0; i < 3; i++) {
      const p = v.get(af.vars.gearPos(i), 1);
      const dn = p > 0.99;
      const up = p < 0.01;
      const handle = v.get(af.vars.gearHandleDown, 1) >= 0.5;
      const disagree = (up && handle) || (dn && !handle);
      if (dn) {
        rect(ctx, gx[i] - 18, gy[i] - 10, 36, 20, C.bg, C.green, 1.5);
        txt(ctx, 'DN', gx[i], gy[i] + 1, 14, C.green, 'center');
      } else if (up && !disagree) {
        rect(ctx, gx[i] - 18, gy[i] - 10, 36, 20, C.bg, C.white, 1.5);
        txt(ctx, 'UP', gx[i], gy[i] + 1, 14, C.white, 'center');
      } else {
        rect(ctx, gx[i] - 18, gy[i] - 10, 36, 20, C.bg, C.amber, 1.5);
        ctx.save();
        ctx.beginPath();
        ctx.rect(gx[i] - 17, gy[i] - 9, 34, 18);
        ctx.clip();
        for (let h = -40; h < 40; h += 7) seg(ctx, gx[i] + h, gy[i] + 10, gx[i] + h + 20, gy[i] - 10, C.amber, 1.5);
        ctx.restore();
      }
    }
    // ---- Slat / flap.
    const flapDeg = v.get(af.vars.flapsDeg);
    const slats = v.get(af.vars.slats);
    txt(ctx, 'SLAT', 130, 500, 12, C.white, 'center');
    txt(ctx, slats > 0.95 ? 'OUT' : slats < 0.05 ? 'IN' : '↔', 130, 520, 15, slats > 0.05 && slats < 0.95 ? C.white : C.green, 'center');
    txt(ctx, 'FLAP', 190, 500, 12, C.white, 'center');
    txt(ctx, istr(flapDeg), 190, 520, 18, C.green, 'center');
    // Flap position bar 0-30 deg with detent ticks.
    rect(ctx, 110, 534, 110, 8, C.bg, C.white, 1);
    rect(ctx, 111, 535, Math.max(0, Math.min(108, (flapDeg / 30) * 108)), 6, C.green);
    for (const d of af.flaps) if (d.flapDeg > 0) seg(ctx, 111 + (d.flapDeg / 30) * 108, 542, 111 + (d.flapDeg / 30) * 108, 548, C.white, 1.5);
    // ---- Spoilers.
    const spl = Math.max(v.get(af.vars.spoilerLeft), v.get(af.vars.spoilerRight), v.get('surf.speedbrake'));
    const gnd = v.get(af.vars.groundSpoilers);
    txt(ctx, 'SPLRS', 165, 572, 12, C.white, 'center');
    txt(ctx, gnd > 0.1 ? 'GND' : spl > 0.02 ? 'FLT' : 'RET', 165, 592, 15, gnd > 0.1 || spl > 0.02 ? C.amber : C.green, 'center');
    if (spl > 0.02) txt(ctx, istr(spl * 100), 205, 592, 13, C.white, 'left');
    // ---- Parking brake (EST position).
    if (v.getBool(af.vars.parkingBrake)) txt(ctx, 'PARK BRAKE', 10, 604, 13, C.amber, 'left');
    // ---- Trims.
    txt(ctx, 'TRIMS', 390, 426, 13, C.white, 'center');
    const stab = v.get(af.vars.stabUnits, NaN);
    const [s0, s1] = af.stabUnits;
    const [g0, g1] = af.stabGreenBand;
    const bx = 330;
    const by0 = 440;
    const bh = 150;
    const yOf = (u: number) => by0 + bh - ((u - s0) / (s1 - s0)) * bh;
    seg(ctx, bx, by0, bx, by0 + bh, C.white, 2);
    if (v.getBool('gear.air_ground')) {
      ctx.fillStyle = C.green;
      ctx.fillRect(bx - 4, yOf(g1), 8, yOf(g0) - yOf(g1));
    }
    txt(ctx, 'NU', bx + 10, by0 + 4, 11, C.white, 'left');
    txt(ctx, 'ND', bx + 10, by0 + bh - 4, 11, C.white, 'left');
    if (Number.isFinite(stab)) {
      const y = yOf(Math.max(s0, Math.min(s1, stab)));
      const inBand = stab >= g0 && stab <= g1;
      ctx.beginPath();
      ctx.moveTo(bx - 4, y);
      ctx.lineTo(bx - 16, y - 7);
      ctx.lineTo(bx - 16, y + 7);
      ctx.closePath();
      ctx.fillStyle = v.getBool('gear.air_ground') && !inBand ? C.amber : C.green;
      ctx.fill();
      txt(ctx, fstr(stab, 1), bx + 34, (by0 + by0 + bh) / 2, 17, v.getBool('gear.air_ground') && !inBand ? C.amber : C.green, 'left');
      txt(ctx, 'STAB', bx + 34, (by0 + by0 + bh) / 2 - 22, 12, C.white, 'left');
    }
    // Aileron (LWD / RWD) and rudder (NL / NR) horizontal scales.
    const hs = (label: string, y: number, val: number, lo: string, hi: string) => {
      const x0 = 400;
      const wdt = 96;
      txt(ctx, label, x0 + wdt / 2, y - 14, 12, C.white, 'center');
      seg(ctx, x0, y, x0 + wdt, y, C.white, 2);
      seg(ctx, x0 + wdt / 2, y - 5, x0 + wdt / 2, y + 5, C.white, 1.5);
      txt(ctx, lo, x0 - 2, y + 14, 10, C.white, 'left');
      txt(ctx, hi, x0 + wdt + 2, y + 14, 10, C.white, 'right');
      if (Number.isFinite(val)) {
        const px = x0 + wdt / 2 + Math.max(-1, Math.min(1, val)) * (wdt / 2);
        ctx.beginPath();
        ctx.moveTo(px, y - 2);
        ctx.lineTo(px - 6, y - 11);
        ctx.lineTo(px + 6, y - 11);
        ctx.closePath();
        ctx.fillStyle = C.green;
        ctx.fill();
      }
    };
    hs('AIL', 480, v.get(af.vars.aileronTrim, NaN), 'LWD', 'RWD');
    hs('RUD', 540, v.get(af.vars.rudderTrim, NaN), 'NL', 'NR');
  }
}

/**
 * EST EPR from N1 for the BR710 (no public EPR vs N1 table): 1.00 at 20 %
 * N1 rising to about 1.66 at 100 % (Global Express EICAS sample shows EPR
 * 1.54-1.65 at cruise / climb N1 values).
 */
export function eprFromN1(n1: number): number {
  if (!(n1 > 20)) return 1.0;
  const f = (Math.min(105, n1) - 20) / 80;
  return 1.0 + 0.66 * f * f;
}
