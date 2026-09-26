/**
 * 737NG engine displays (FCOM 7.10 "Engine Indications"; layouts measured
 * on the b737.org.uk upper DU, lower DU and compact format photographs).
 *
 * Primary (upper DU): TAT, thrust mode (TO / R-TO / TO 1 / CLB / CRZ / G/A /
 *   CON, assumed temperature), N1 dials (0-110 %, red line 104 %, green
 *   reference bug and readout, white command sector, REV), EGT dials (red
 *   line 950 °C, amber 925 °C, start limit 725 °C while starting), crew
 *   alert boxes (START VALVE OPEN, OIL FILTER BYPASS, LOW OIL PRESSURE) and
 *   fuel quantity (tanks 1, 2, CTR; LOW, IMBAL, CONFIG).
 * Secondary (lower DU, MFD ENG): N2 dials, fuel flow / fuel used, oil
 *   pressure and temperature vertical scales, oil quantity, vibration.
 * Compact (one DU for both): the primary format with the secondary data as
 *   digital columns.
 *
 * Arc geometry (measured on the photographs): N1 from 0 at 60° to 100 % at
 * 300° (clockwise from 12 o'clock); EGT / N2 from 0 at 90° clockwise with
 * the red line near 315°.
 */
import { ENG } from '../../../core/vars';
import { fmtInt } from '../../common/format';
import type { Ctx2D } from '../../common/draw/context';
import { compileBinding, compileCondition, type Evaluator } from '../../../systems/util/binding';
import { B737_VARS, type Side } from '../vars';
import { CFM56_EGT, CFM56_N1, CFM56_N2, CFM56_OIL_PRESS, CFM56_OIL_QTY, CFM56_OIL_TEMP, CFM56_VIB } from '../data/cfm56';
import { B738_FUEL } from '../data/b738';
import { CDS, LW, blink, line, text, textWidth } from './style';
import type { CdsEnv, CdsFormatRenderer } from './types';

const DEG = Math.PI / 180;
const LB_PER_KG = 2.2046226;

/** Screen angle (rad, canvas: 0 = +x, clockwise) for a dial angle measured clockwise from 12 o'clock (deg). */
function ang(dialDeg: number): number {
  return (dialDeg - 90) * DEG;
}

/** Shared engine data snapshot and drawing helpers. */
class EngineData {
  readonly n1 = [0, 0];
  readonly n2 = [0, 0];
  readonly egt = [0, 0];
  readonly ff = [0, 0];
  readonly oilP = [0, 0];
  readonly oilT = [0, 0];
  readonly oilQ = [0, 0];
  readonly vib = [0, 0];
  readonly rev = [0, 0];
  readonly running = [false, false];
  readonly starting = [false, false];
  readonly eec = [true, true];
  readonly startValve = [false, false];
  readonly filterBypass = [false, false];
  readonly n1Ref = [NaN, NaN];
  readonly n1Cmd = [NaN, NaN];
  refReadout = false;
  tat = 0;
  mode = '';
  assumed = NaN;
  fuelL = 0;
  fuelR = 0;
  fuelC = 0;
  centerPumpsOff = false;
  onGround = true;
  private readonly vars: CdsEnv['vars'];
  private readonly cfg: CdsEnv['cfg'];
  private readonly oilQtyEval: Evaluator[];
  private readonly vibEval: Evaluator[];
  private readonly runEval: (() => boolean)[];
  private readonly valveEval: (() => boolean)[];
  private readonly bypassEval: (() => boolean)[];
  private readonly eecEval: (() => boolean)[];
  private readonly ctrOff: () => boolean;

  constructor(env: CdsEnv) {
    const v = env.vars;
    const d = env.cfg.vars;
    this.vars = v;
    this.cfg = env.cfg;
    this.oilQtyEval = [compileBinding(v, d.oilQty(1), 18), compileBinding(v, d.oilQty(2), 18)];
    this.vibEval = [compileBinding(v, d.vibration(1), 0), compileBinding(v, d.vibration(2), 0)];
    this.runEval = [compileCondition(v, d.engineRunning(1), false), compileCondition(v, d.engineRunning(2), false)];
    this.valveEval = [compileCondition(v, d.startValveOpen(1), false), compileCondition(v, d.startValveOpen(2), false)];
    this.bypassEval = [compileCondition(v, d.oilFilterBypass(1), false), compileCondition(v, d.oilFilterBypass(2), false)];
    this.eecEval = [compileCondition(v, d.eecPowered(1), true), compileCondition(v, d.eecPowered(2), true)];
    this.ctrOff = compileCondition(v, d.centerPumpsOff, false);
  }

  read(): void {
    const v = this.vars;
    const d = this.cfg.vars;
    const n1Sel = v.get(B737_VARS.n1SetSel);
    const limit = v.get('fadec.n1_limit_pct', NaN);
    const atMode = v.getString('ap.at_mode');
    for (let i = 0; i < 2; i++) {
      const e = i + 1;
      this.n1[i] = v.get(ENG.n1(e));
      this.n2[i] = v.get(ENG.n2(e));
      this.egt[i] = v.get(ENG.itt(e));
      this.ff[i] = v.get(ENG.fuelFlowPph(e)) / LB_PER_KG; // kg/h
      this.oilP[i] = v.get(ENG.oilPressPsi(e));
      this.oilT[i] = v.get(ENG.oilTempC(e));
      this.oilQ[i] = this.oilQtyEval[i]();
      this.vib[i] = this.vibEval[i]();
      this.rev[i] = v.get(ENG.reverserPos(e));
      this.running[i] = this.runEval[i]();
      this.startValve[i] = this.valveEval[i]();
      this.starting[i] = !this.running[i] && (this.startValve[i] || v.get(ENG.starter(e)) !== 0);
      this.filterBypass[i] = this.bypassEval[i]();
      this.eec[i] = this.eecEval[i]();
      // Reference N1: manual (N1 SET) or the FMC thrust limit (AUTO).
      const manual = n1Sel === 1 || n1Sel === e + 1;
      this.n1Ref[i] = manual ? v.get(B737_VARS.n1SetManual(e as 1 | 2), NaN) : limit;
      // A/T command sector: target while the A/T drives the levers.
      const tgt = v.get('at.n1_target', NaN);
      this.n1Cmd[i] = v.get('at.servo_active') !== 0 && Number.isFinite(tgt) ? tgt : NaN;
    }
    this.refReadout = n1Sel !== 0 || (atMode !== 'N1' && atMode !== 'THR HLD');
    this.tat = v.get(`adc${v.get(B737_VARS.airDataFor(1), 1)}.tat_c`);
    this.mode = v.getString('fadec.rating');
    const at = v.get('fadec.assumed_temp_c', -99);
    this.assumed = v.get('fadec.flex_active') !== 0 || (at > -90 && this.mode.startsWith('TO')) ? at : NaN;
    this.fuelL = v.get(d.fuelLeftKg);
    this.fuelR = v.get(d.fuelRightKg);
    this.fuelC = v.get(d.fuelCenterKg);
    this.centerPumpsOff = this.ctrOff();
    this.onGround = v.get(d.onGround) !== 0;
  }

  /** FCOM thrust mode display text (N1 limit mode). */
  thrustModeText(): string {
    const m = this.mode;
    const reduced = Number.isFinite(this.assumed);
    switch (m) {
      case 'TO':
        return reduced ? 'R-TO' : 'TO';
      case 'TO-1':
        return reduced ? 'R-TO 1' : 'TO 1';
      case 'TO-2':
        return reduced ? 'R-TO 2' : 'TO 2';
      case 'CLB-1':
        return 'CLB 1';
      case 'CLB-2':
        return 'CLB 2';
      case 'GA':
        return 'G/A';
      case '':
        return '';
      default:
        return m;
    }
  }
}

/** Draws one engine round dial with sector fill, needle, red line, digital box. */
function drawDial(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  r: number,
  value: number,
  valid: boolean,
  a0: number,
  degPerUnit: number,
  maxDeg: number,
  red: number,
  amber: number,
  digits: string,
  digitColor: string,
  box: { x: number; y: number; w: number; h: number },
): void {
  const v = Math.max(0, value);
  const aVal = Math.min(maxDeg, a0 + v * degPerUnit);
  // Swept sector (grey) from zero to the value.
  if (valid && v > 0) {
    ctx.fillStyle = CDS.dialFill;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, ang(a0), ang(aVal));
    ctx.closePath();
    ctx.fill();
  }
  // Scale arc (white) from zero to the red line.
  const aRed = a0 + red * degPerUnit;
  ctx.strokeStyle = CDS.white;
  ctx.lineWidth = LW.normal + 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, ang(a0), ang(Math.min(aRed, maxDeg)));
  ctx.stroke();
  // Amber and red radials.
  if (Number.isFinite(amber)) {
    const aa = ang(a0 + amber * degPerUnit);
    line(ctx, cx + Math.cos(aa) * (r - 4), cy + Math.sin(aa) * (r - 4), cx + Math.cos(aa) * (r + 12), cy + Math.sin(aa) * (r + 12), CDS.amber, 4);
  }
  const ar = ang(aRed);
  line(ctx, cx + Math.cos(ar) * (r - 2), cy + Math.sin(ar) * (r - 2), cx + Math.cos(ar) * (r + 16), cy + Math.sin(ar) * (r + 16), CDS.red, 5);
  // Needle.
  if (valid) {
    const an = ang(aVal);
    line(ctx, cx, cy, cx + Math.cos(an) * r, cy + Math.sin(an) * r, CDS.white, 4);
  }
  // Digital box.
  ctx.fillStyle = CDS.black;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = digitColor === CDS.white ? CDS.white : digitColor;
  ctx.lineWidth = LW.normal;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (valid && digits) text(ctx, digits, box.x + box.w - 7, box.y + box.h / 2 + 1, box.h * 0.82, digitColor, 'right');
}

function exceedColor(value: number, amber: number, red: number): string {
  if (value >= red) return CDS.red;
  if (Number.isFinite(amber) && value >= amber) return CDS.amber;
  return CDS.white;
}

function fmt1(x: number): string {
  const r = Math.round(x * 10);
  const i = Math.trunc(r / 10);
  const f = Math.abs(r % 10);
  return (r < 0 && i === 0 ? '-' : '') + fmtInt(i) + '.' + fmtInt(f);
}

function fmt2(x: number): string {
  const r = Math.round(x * 100);
  const i = Math.floor(r / 100);
  const f = r % 100;
  return fmtInt(i) + '.' + (f < 10 ? '0' : '') + fmtInt(f);
}

// ------------------------------------------------------------------ primary

/** N1 dial: 0 % at 60°, 2.4° per % (100 % at 300°). */
const N1_A0 = 60;
const N1_K = 2.4;
/** EGT / N2 dials: 0 at 90°, 1000 °C / 110 % mapped to ~240°. */
const EGT_A0 = 90;
const EGT_K = 0.24;
const N2_A0 = 90;
const N2_K = 2.15;

export class EngPrimary implements CdsFormatRenderer {
  protected readonly env: CdsEnv;
  protected readonly d: EngineData;
  protected t = 0;
  private startLimitShown = [false, false];

  constructor(env: CdsEnv) {
    this.env = env;
    this.d = new EngineData(env);
  }

  update(dt: number, _side: Side): void {
    this.t += dt;
    this.d.read();
    for (let i = 0; i < 2; i++) this.startLimitShown[i] = this.d.starting[i] || (!this.d.running[i] && this.d.n2[i] > 5);
  }

  draw(ctx: Ctx2D): void {
    this.drawTopRow(ctx);
    this.drawN1(ctx);
    this.drawEgt(ctx);
    this.drawAlerts(ctx);
    this.drawFuel(ctx);
  }

  protected drawTopRow(ctx: Ctx2D): void {
    const d = this.d;
    text(ctx, 'TAT', 30, 26, 20, CDS.cyan, 'left');
    const tat = Math.round(d.tat);
    const ts = (tat >= 0 ? '+' : '') + fmtInt(tat);
    text(ctx, ts, 74, 26, 28, CDS.white, 'left');
    text(ctx, 'c', 76 + textWidth(ctx, ts, 28), 28, 20, CDS.white, 'left');
    const m = d.thrustModeText();
    if (m) text(ctx, m, 214, 26, 28, CDS.green, 'center');
    if (Number.isFinite(d.assumed)) text(ctx, '+' + fmtInt(Math.round(d.assumed)) + 'c', 300, 26, 26, CDS.green, 'left');
  }

  protected drawN1(ctx: Ctx2D): void {
    const d = this.d;
    const xs = [113, 312];
    const cy = 150;
    const r = 70;
    for (let i = 0; i < 2; i++) {
      const cx = xs[i];
      const n1 = d.n1[i];
      const col = exceedColor(n1, NaN, CFM56_N1.red);
      drawDial(ctx, cx, cy, r, n1, true, N1_A0, N1_K, 330, CFM56_N1.red, NaN, fmt1(n1), col, { x: cx - 4, y: cy - r - 8, w: 104, h: 42 });
      // Numbers 0..10 (x10 %) inside the arc.
      for (let k = 0; k <= 10; k += 2) {
        const a = ang(N1_A0 + k * 10 * N1_K);
        text(ctx, fmtInt(k), cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22), 19, CDS.white, 'center');
      }
      // Tick marks every 10 %.
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      for (let k = 0; k <= 100; k += 10) {
        const a = ang(N1_A0 + k * N1_K);
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
      }
      ctx.stroke();
      // Command sector (white arc between actual and A/T commanded N1).
      const cmd = d.n1Cmd[i];
      if (Number.isFinite(cmd) && Math.abs(cmd - n1) > 1) {
        ctx.strokeStyle = CDS.white;
        ctx.lineWidth = 6;
        ctx.beginPath();
        const a1 = ang(N1_A0 + Math.min(n1, cmd) * N1_K);
        const a2 = ang(N1_A0 + Math.max(n1, cmd) * N1_K);
        ctx.arc(cx, cy, r + 5, a1, a2);
        ctx.stroke();
      }
      // Reference N1 bug (green) outside the arc and readout above the box.
      const ref = d.n1Ref[i];
      if (Number.isFinite(ref) && ref > 0) {
        const a = ang(N1_A0 + ref * N1_K);
        const bx = cx + Math.cos(a) * (r + 8);
        const by = cy + Math.sin(a) * (r + 8);
        ctx.strokeStyle = CDS.green;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * 16 + Math.cos(a + Math.PI / 2) * 9, by + Math.sin(a) * 16 + Math.sin(a + Math.PI / 2) * 9);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + Math.cos(a) * 16 - Math.cos(a + Math.PI / 2) * 9, by + Math.sin(a) * 16 - Math.sin(a + Math.PI / 2) * 9);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a) * 22, by + Math.sin(a) * 22);
        ctx.stroke();
        if (d.refReadout) text(ctx, fmt1(ref), cx + 96, cy - r - 30, 24, CDS.green, 'right');
      }
      // Reverser: REV amber in transit, green deployed.
      const rv = d.rev[i];
      if (rv > 0.02) text(ctx, 'REV', cx + 48, cy - r - 30, 24, rv >= 0.9 ? CDS.green : CDS.amber, 'center');
    }
    text(ctx, 'N', 213, 205, 22, CDS.cyan, 'center');
    text(ctx, '1', 222, 212, 14, CDS.cyan, 'left');
  }

  protected drawEgt(ctx: Ctx2D): void {
    const d = this.d;
    const xs = [113, 312];
    const cy = 300;
    const r = 72;
    for (let i = 0; i < 2; i++) {
      const cx = xs[i];
      const egt = d.egt[i];
      const valid = d.eec[i] && (d.running[i] || d.starting[i] || egt > 60);
      const red = this.startLimitShown[i] ? CFM56_EGT.startRed : CFM56_EGT.red;
      const col = exceedColor(egt, this.startLimitShown[i] ? NaN : CFM56_EGT.amber, red);
      drawDial(ctx, cx, cy, r, egt, valid, EGT_A0, EGT_K, 350, red, this.startLimitShown[i] ? NaN : CFM56_EGT.amber, fmtInt(Math.round(egt)), col, { x: cx - 18, y: cy - r - 4, w: 80, h: 40 });
    }
    text(ctx, 'EGT', 216, 352, 22, CDS.cyan, 'center');
  }

  protected drawAlerts(ctx: Ctx2D): void {
    const d = this.d;
    const xs = [474, 632];
    const w = 146;
    const h = 46;
    for (let i = 0; i < 2; i++) {
      const x = xs[i];
      const rows = [
        d.startValve[i] ? 'START VALVE|OPEN' : '',
        d.filterBypass[i] ? 'OIL FILTER|BYPASS' : '',
        d.oilP[i] <= CFM56_OIL_PRESS.red ? 'LOW OIL|PRESSURE' : '',
      ];
      for (let k = 0; k < 3; k++) {
        const y = 40 + k * h;
        const s = rows[k];
        // The alert boxes are only drawn while the condition exists (FCOM 7.10 "Engine Display Alerts").
        if (s) {
          ctx.fillStyle = CDS.amber;
          ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
          const bar = s.indexOf('|');
          text(ctx, s.slice(0, bar), x + w / 2, y + 15, 17, CDS.black, 'center');
          text(ctx, s.slice(bar + 1), x + w / 2, y + 33, 17, CDS.black, 'center');
        }
      }
    }
  }

  protected drawFuel(ctx: Ctx2D): void {
    const d = this.d;
    const lb = this.env.cfg.weightUnit === 'lb';
    const k = lb ? LB_PER_KG : 1;
    const main = B738_FUEL.mainTankKg;
    const ctr = B738_FUEL.centerTankKg;
    this.fuelGauge(ctx, 648, 640, 60, d.fuelC, ctr, k, false, '');
    this.fuelGauge(ctx, 576, 738, 66, d.fuelL, main, k, d.fuelL < B738_FUEL.lowKg, '1');
    this.fuelGauge(ctx, 720, 738, 66, d.fuelR, main, k, d.fuelR < B738_FUEL.lowKg, '2');
    text(ctx, 'CTR', 648, 612, 20, CDS.cyan, 'center');
    text(ctx, 'FUEL', 545, 622, 18, CDS.cyan, 'center');
    text(ctx, lb ? 'LBS' : 'KG', 545, 642, 18, CDS.cyan, 'center');
    // Alerts: IMBAL (in flight, > 453 kg difference), CONFIG (centre fuel with both centre pumps off, engine running).
    if (!d.onGround && Math.abs(d.fuelL - d.fuelR) > B738_FUEL.imbalanceKg) {
      const lowSide = d.fuelL < d.fuelR ? 576 : 720;
      text(ctx, 'IMBAL', lowSide, 790, 18, CDS.amber, 'center');
    }
    if (d.fuelC > B738_FUEL.configCenterKg && d.centerPumpsOff && (d.running[0] || d.running[1])) text(ctx, 'CONFIG', 648, 588, 18, CDS.amber, 'center');
  }

  private fuelGauge(ctx: Ctx2D, cx: number, cy: number, r: number, kg: number, capKg: number, k: number, low: boolean, label: string): void {
    // Arc from 225° (empty, lower left) clockwise to 45°... measured: quantity arc on the left, ticks right (photo).
    const a0 = 200;
    const span = 250;
    const frac = Math.max(0, Math.min(1, kg / capKg));
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let t = 0; t <= 10; t++) {
      const a = ang(a0 + (span * t) / 10);
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
    }
    ctx.stroke();
    if (frac > 0.002) {
      ctx.strokeStyle = low ? CDS.amber : CDS.white;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3, ang(a0), ang(a0 + span * frac));
      ctx.stroke();
    }
    const q = Math.round((kg * k) / 10) * 10;
    text(ctx, fmtInt(Math.max(0, q)), cx + 4, cy + 12, 28, low ? CDS.amber : CDS.white, 'center');
    if (label) text(ctx, label, cx - 4, cy - 22, 16, CDS.white, 'center');
    if (low && label) text(ctx, 'LOW', cx, cy + 44, 18, CDS.amber, 'center');
  }
}

// ------------------------------------------------------------------ secondary

export class EngSecondary implements CdsFormatRenderer {
  protected readonly env: CdsEnv;
  protected readonly d: EngineData;
  private t = 0;

  constructor(env: CdsEnv) {
    this.env = env;
    this.d = new EngineData(env);
  }

  update(dt: number, _side: Side): void {
    this.t += dt;
    this.d.read();
  }

  draw(ctx: Ctx2D): void {
    const d = this.d;
    const v = this.env.vars;
    const xs = [310, 490];
    // N2 dials.
    for (let i = 0; i < 2; i++) {
      const cx = xs[i] - 20;
      const valid = d.eec[i] || d.n2[i] > 1;
      drawDial(ctx, cx, 112, 64, d.n2[i], valid, N2_A0, N2_K, 350, CFM56_N2.red, NaN, fmt1(d.n2[i]), exceedColor(d.n2[i], NaN, CFM56_N2.red), { x: cx - 8, y: 40, w: 96, h: 40 });
    }
    text(ctx, 'N', 400, 200, 20, CDS.cyan, 'center');
    text(ctx, '2', 408, 206, 13, CDS.cyan, 'left');
    // Fuel flow (x1000 kg/h) or fuel used (FUEL FLOW switch USED).
    const used = v.get(B737_VARS.ffSwitch) > 0;
    for (let i = 0; i < 2; i++) {
      const val = used ? v.get(B737_VARS.fuelUsedKg((i + 1) as 1 | 2)) / 1000 : d.ff[i] / 1000;
      const x = i === 0 ? 250 : 470;
      this.box(ctx, x, 242, 84, 38, d.eec[i] ? fmt2(Math.max(0, val) * (this.env.cfg.weightUnit === 'lb' ? LB_PER_KG : 1)) : '', CDS.white);
    }
    text(ctx, used ? 'FU' : 'FF', 400, 261, 20, CDS.cyan, 'center');
    // Oil pressure (vertical scales, red line 13 psi at the bottom, amber band).
    this.vertical(ctx, 0, 330, 440, d.oilP, CFM56_OIL_PRESS.min, CFM56_OIL_PRESS.max, CFM56_OIL_PRESS.red, CFM56_OIL_PRESS.amberHigh, 'low', 'OIL', 'PRESS');
    // Oil temperature (amber band from 140 °C, red line 155 °C at the top).
    this.vertical(ctx, 1, 480, 590, d.oilT, CFM56_OIL_TEMP.min, 170, CFM56_OIL_TEMP.red, CFM56_OIL_TEMP.amber, 'high', 'OIL', 'TEMP');
    // Oil quantity.
    for (let i = 0; i < 2; i++) {
      const q = d.oilQ[i];
      const low = this.env.cfg.oilQtyUnit === 'qt' ? q < CFM56_OIL_QTY.lowQt : q < 20;
      this.box(ctx, i === 0 ? 268 : 486, 626, 46, 36, fmtInt(Math.round(q)), low ? CDS.amber : CDS.white);
      if (low && d.onGround) text(ctx, 'RF', i === 0 ? 256 : 540, 644, 18, CDS.amber, i === 0 ? 'right' : 'left');
    }
    text(ctx, 'OIL QTY', 400, 644, 20, CDS.cyan, 'center');
    // Vibration.
    this.vertical(ctx, 2, 690, 770, d.vib, 0, CFM56_VIB.max, NaN, CFM56_VIB.amber, 'vib', '', 'VIB');
  }

  private box(ctx: Ctx2D, x: number, y: number, w: number, h: number, s: string, col: string): void {
    ctx.fillStyle = CDS.black;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.strokeRect(x, y, w, h);
    if (s) text(ctx, s, x + w - 5, y + h / 2 + 1, h * 0.8, col, 'right');
  }

  /** Vertical scale pair with inward pointers and outboard digital boxes. */
  private vertical(ctx: Ctx2D, kind: number, yTop: number, yBot: number, vals: number[], min: number, max: number, red: number, amber: number, sense: 'low' | 'high' | 'vib', l1: string, l2: string): void {
    const d = this.d;
    const xs = [352, 448];
    for (let i = 0; i < 2; i++) {
      const x = xs[i];
      const dir = i === 0 ? -1 : 1;
      line(ctx, x, yTop, x, yBot, CDS.white, LW.normal + 0.5);
      const yFor = (val: number): number => yBot - ((Math.max(min, Math.min(max, val)) - min) / (max - min)) * (yBot - yTop);
      if (Number.isFinite(red)) {
        const yr = yFor(red);
        line(ctx, x - 12, yr, x + 12, yr, CDS.red, 5);
      }
      if (Number.isFinite(amber)) {
        const ya = yFor(amber);
        if (sense === 'low') line(ctx, x, yFor(red), x, ya, CDS.amber, 6);
        else if (sense === 'high') line(ctx, x, yFor(red), x, ya, CDS.amber, 6);
        else line(ctx, x - 8, ya, x + 8, ya, CDS.amber, 4);
      }
      const val = vals[i];
      const valid = d.eec[i];
      let col: string = CDS.white;
      if (sense === 'low' && Number.isFinite(red)) col = val <= red ? CDS.red : val <= amber ? CDS.amber : CDS.white;
      else if (sense === 'high') col = val >= red ? CDS.red : val >= amber ? CDS.amber : CDS.white;
      else col = val >= amber ? CDS.amber : CDS.white;
      if (valid) {
        const y = yFor(val);
        // Pointer: triangle on the inboard side pointing at the scale.
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x - dir * 4, y);
        ctx.lineTo(x - dir * 22, y - 9);
        ctx.lineTo(x - dir * 22, y + 9);
        ctx.closePath();
        ctx.fill();
      }
      const bx = i === 0 ? x - 88 : x + 16;
      const s = valid ? (kind === 2 ? fmt1(val) : fmtInt(Math.round(val))) : '';
      this.box(ctx, bx, (yTop + yBot) / 2 - 18, 72, 36, s, col);
    }
    if (l1) {
      text(ctx, l1, 400, (yTop + yBot) / 2 - 12, 19, CDS.cyan, 'center');
      text(ctx, l2, 400, (yTop + yBot) / 2 + 10, 19, CDS.cyan, 'center');
    } else text(ctx, l2, 400, (yTop + yBot) / 2, 19, CDS.cyan, 'center');
    void blink;
  }
}

// ------------------------------------------------------------------ compact

export class EngCompact extends EngPrimary {
  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const d = this.d;
    const v = this.env.vars;
    const used = v.get(B737_VARS.ffSwitch) > 0;
    const rows: [string, (i: number) => string, (i: number) => boolean][] = [
      ['N2', (i) => fmt1(d.n2[i]), () => true],
      [used ? 'FU' : 'FF', (i) => fmt2((used ? v.get(B737_VARS.fuelUsedKg((i + 1) as 1 | 2)) : d.ff[i]) / 1000), (i) => d.eec[i] && (d.running[i] || d.ff[i] > 1)],
      ['OIL PRESS', (i) => fmtInt(Math.round(d.oilP[i])), (i) => d.eec[i] && (d.running[i] || d.oilP[i] > 1)],
      ['OIL TEMP', (i) => fmtInt(Math.round(d.oilT[i])), (i) => d.eec[i] && (d.running[i] || d.oilP[i] > 1)],
      ['OIL QTY', (i) => fmtInt(Math.round(d.oilQ[i])), () => true],
      ['VIB', (i) => fmt1(d.vib[i]), () => true],
    ];
    let y = 420;
    for (const [label, val, ok] of rows) {
      text(ctx, label, 226, y, 20, CDS.cyan, 'center');
      if (ok(0)) text(ctx, val(0), 140, y, 24, CDS.white, 'right');
      if (ok(1)) text(ctx, val(1), 384, y, 24, CDS.white, 'right');
      y += 32;
    }
  }
}
