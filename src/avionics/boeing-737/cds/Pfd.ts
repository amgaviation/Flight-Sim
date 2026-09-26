/**
 * 737NG Primary Flight Display format (FCOM 10.10 "PFD"; layout measured on
 * the b737.org.uk NG PFD photograph and flight deck photos, scaled to the
 * 800 x 800 DU; positions EST where the photos are ambiguous).
 *
 *   top      FMA: A/T | roll | pitch columns (engaged green, armed white,
 *            10 s white change box), AFDS status (CMD / FD / SINGLE CH /
 *            LAND 3 ...) above the attitude display.
 *   left     speed tape: 4.3 px/kt, rolling-digit readout, selected speed
 *            (magenta readout + cursor), speed trend (green, 10 s), Vmo
 *            and stick-shaker barber poles, amber maneuver margin bars,
 *            V1 / VR / REF / flap maneuver bugs, NO VSPD, Mach or GS below.
 *   centre   attitude: sky/ground rounded window, pitch ladder (2.5 deg),
 *            bank scale 10/20/30/45/60 with pointer and slip trapezoid,
 *            airplane symbol, FD bars (magenta), FPV, PLI (amber), rising
 *            runway, localizer / glideslope deviation, marker beacon,
 *            radio altitude, minimums, approach/ILS reference, alerts.
 *   right    altitude tape: 0.66 px/ft, 20-ft rolling drum, selected
 *            altitude (magenta), altitude alert box, baro / STD /
 *            preselect, minimums pointer, landing altitude bar, metric
 *            readouts; vertical speed indicator with pointer and readout,
 *            selected V/S bug, TCAS RA bands.
 *   bottom   heading arc (compass rose segment), selected heading bug and
 *            readout "xxx H", MAG / TRU.
 *
 * Reads only sensor / system vars of the displayed side (air data / IRS
 * index from the IRS transfer switch, VHF NAV receiver from the NAV
 * transfer switch, EFIS panel from the CONTROL PANEL switch).
 */
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { fmtInt } from '../../common/format';
import { MinimumsAlerter, MINIMUMS_BOEING } from '../../common/alerting';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { AFCS_VARS } from '../../../systems/autopilot/vars';
import type { Ctx2D } from '../../common/draw/context';
import { B737_VARS, type Side } from '../vars';
import { B738_FLAP_MANEUVER, B738_SPEEDS, maneuverBand } from '../data/b738';
import { maxManeuverMach, pressureAtAltPa } from '../data/perf';
import { CDS, LW, blink, cdsFont, haloText, line, text } from './style';
import type { CdsEnv, CdsFormatRenderer } from './types';
import { HPA_PER_INHG } from './EfisPanels';

// ------------------------------------------------------------------ layout (logical px, 800 x 800)
const CX = 373;
const CY = 421;
const ADI_L = 192;
const ADI_R = 554;
const ADI_T = 238;
const ADI_B = 604;
const ADI_RAD = 34;
const PX_PER_DEG = 7.8;
const BANK_R = 164;

const SPD_L = 44;
const SPD_R = 130;
const TAPE_T = 150;
const TAPE_B = 692;
const PX_PER_KT = 4.3;

const ALT_L = 610;
const ALT_R = 712;
const PX_PER_FT = 0.66;

const VSI_L = 718;
const VSI_R = 792;
const VSI_HALF = 206;

const HDG_CY = 920;
const HDG_R = 236;

const FMA_T = 16;
const FMA_B = 100;
const FMA_X = [146, 302, 458, 614];

const DEG = Math.PI / 180;
const MODE_BOX_S = 10;

/** Non-linear VSI scale: |fpm| -> fraction of the half height (0-1-2-6 x 1000 fpm, FCOM figure). */
function vsiFrac(fpm: number): number {
  const a = Math.min(6000, Math.abs(fpm));
  let f: number;
  if (a <= 1000) f = (a / 1000) * 0.48;
  else if (a <= 2000) f = 0.48 + ((a - 1000) / 1000) * 0.24;
  else f = 0.72 + ((a - 2000) / 4000) * 0.28;
  return Math.sign(fpm) * f;
}

interface ModeBox {
  text: string;
  t: number;
}

export class Pfd implements CdsFormatRenderer {
  private readonly env: CdsEnv;
  private side: Side = 1;
  private t = 0;
  // sensor snapshot
  private attValid = false;
  private hdgValid = false;
  private adcValid = false;
  private pitch = 0;
  private bank = 0;
  private slip = 0;
  private hdg = 0;
  private trk = 0;
  private ias = 0;
  private mach = 0;
  private alt = 0;
  private vs = 0;
  private tas = 0;
  private gs = 0;
  private aoa = 0;
  private aoaNorm = 0;
  private iasTrend = 0;
  private raValid = false;
  private ra = 0;
  private onGround = true;
  private flaps = 0;
  // speed trend (filtered)
  private trendKt = 0;
  // FMA change boxes
  private readonly boxes: ModeBox[] = [
    { text: '', t: 99 },
    { text: '', t: 99 },
    { text: '', t: 99 },
  ];
  private readonly mins = new MinimumsAlerter(MINIMUMS_BOEING);
  private minsResetSeen = 0;
  // altitude alert
  private altAlertSel = NaN;
  private altCaptured = false;
  private altAlert = 0; // 0 none, 1 acquisition, 2 deviation
  private altDevT = 0;
  private prevAlt = NaN;

  constructor(env: CdsEnv) {
    this.env = env;
  }

  reset(): void {
    this.trendKt = 0;
    for (const b of this.boxes) b.t = 99;
  }

  // ================================================================ update

  update(dt: number, side: Side): void {
    const v = this.env.vars;
    this.side = side;
    this.t += dt;
    const a = v.get(B737_VARS.airDataFor(side), side);
    const av = SENSOR_VARS.attValid(a);
    const hv = SENSOR_VARS.hdgValid(a);
    this.attValid = (v.has(av) ? v.get(av) : v.get(ADC.ahrsValid(a), 1)) !== 0;
    this.hdgValid = (v.has(hv) ? v.get(hv) : v.get(ADC.ahrsValid(a), 1)) !== 0;
    this.adcValid = v.get(ADC.valid(a)) !== 0;
    this.pitch = v.get(ADC.pitch(a));
    this.bank = v.get(ADC.bank(a));
    this.slip = v.get(ADC.slip(a));
    this.hdg = v.get(ADC.heading(a));
    this.ias = v.get(ADC.ias(a));
    this.mach = v.get(ADC.mach(a));
    this.alt = v.get(ADC.baroAlt(a));
    this.vs = v.get(ADC.vs(a));
    this.tas = v.get(ADC.tas(a));
    this.aoa = v.get(SENSOR_VARS.aoa(a));
    this.aoaNorm = v.get(this.env.cfg.vars.aoaNorm, NaN);
    this.gs = v.get(GPS.gs);
    this.trk = v.getBool(GPS.valid) && this.gs > 30 ? v.get(GPS.trackMag) : this.hdg;
    const ri = this.env.cfg.vars.raIndex[side - 1];
    this.raValid = v.get(SENSOR_VARS.raValid(ri)) !== 0;
    this.ra = v.get(SENSOR_VARS.raAlt(ri));
    this.onGround = v.get(this.env.cfg.vars.onGround) !== 0;
    this.flaps = v.get(this.env.cfg.vars.flapsDeg);
    // 10 s speed trend (FCOM: "speed trend vector ... predicts airspeed in 10 seconds")
    const rate = v.has(SENSOR_VARS.iasRate(a)) ? v.get(SENSOR_VARS.iasRate(a)) : 0;
    const target = this.ias > 45 ? rate * 10 : 0;
    this.trendKt += (target - this.trendKt) * Math.min(1, dt * 2);
    this.iasTrend = this.trendKt;

    // FMA change boxes (10 s; FCOM "a green box is drawn around a mode for 10 s after it engages"; box is white on the NG)
    const cols = [v.getString(B737_VARS.fmaAt), v.getString(B737_VARS.fmaRoll), v.getString(B737_VARS.fmaPitch)];
    for (let i = 0; i < 3; i++) {
      const b = this.boxes[i];
      if (cols[i] !== b.text) {
        b.text = cols[i];
        b.t = cols[i] ? 0 : 99;
      } else b.t += dt;
    }

    // Minimums (RADIO -> radio altitude, BARO -> baro altitude).
    const p = v.get(B737_VARS.efisSourceFor(side), side) as Side;
    const radio = v.get(B737_VARS.efisMinsRef(p)) === 0;
    const minsFt = v.get(radio ? B737_VARS.efisMinsRadioFt(p) : B737_VARS.efisMinsBaroFt(p), -1);
    const rst = this.env.efis.minsReset[p - 1];
    if (rst !== this.minsResetSeen) {
      this.minsResetSeen = rst;
      this.mins.reset();
    }
    const h = radio ? (this.raValid ? this.ra : 99999) : this.alt;
    this.mins.update(h, minsFt, this.onGround, dt);
    if (this.mins.consumeAural()) this.env.audio?.callout('MINIMUMS', 5);

    // Selected altitude alerting (SmartCockpit 737 AFS §8, 737NG: white box within 750 ft, removed within 200 ft,
    // amber flashing current-altitude box on a > 200 ft deviation; inhibited with flaps >= 25 or G/S captured).
    const sel = v.get(AP.selAltitude);
    const inhibit = this.flaps >= 24.5 || v.getString(B737_VARS.fmaPitch) === 'G/S';
    const d = Math.abs(sel - this.alt);
    if (sel !== this.altAlertSel) {
      this.altAlertSel = sel;
      this.altCaptured = d <= 200;
      this.altAlert = 0;
    }
    if (inhibit) this.altAlert = 0;
    else if (d <= 200) {
      this.altCaptured = true;
      this.altAlert = 0;
    } else if (this.altCaptured) {
      if (this.altAlert !== 2) {
        this.altAlert = 2;
        this.altDevT = 0;
      }
      this.altDevT += dt;
    } else this.altAlert = d <= 750 ? 1 : 0;
    this.prevAlt = this.alt;
    v.set(B737_VARS.altAlertState(side), this.altAlert);
  }

  // ================================================================ draw

  draw(ctx: Ctx2D): void {
    this.drawAttitude(ctx);
    this.drawSpeedTape(ctx);
    this.drawAltitudeTape(ctx);
    this.drawVsi(ctx);
    this.drawHeading(ctx);
    this.drawFma(ctx);
    this.drawApproach(ctx);
    this.drawMisc(ctx);
  }

  // ---------------------------------------------------------------- attitude
  private adiPath(ctx: Ctx2D): void {
    const l = ADI_L;
    const r = ADI_R;
    const t = ADI_T;
    const b = ADI_B;
    const rr = ADI_RAD;
    ctx.beginPath();
    ctx.moveTo(l + rr, t);
    ctx.lineTo(r - rr, t);
    ctx.quadraticCurveTo(r, t, r, t + rr);
    ctx.lineTo(r, b - rr);
    ctx.quadraticCurveTo(r, b, r - rr, b);
    ctx.lineTo(l + rr, b);
    ctx.quadraticCurveTo(l, b, l, b - rr);
    ctx.lineTo(l, t + rr);
    ctx.quadraticCurveTo(l, t, l + rr, t);
    ctx.closePath();
  }

  private drawAttitude(ctx: Ctx2D): void {
    const v = this.env.vars;
    if (!this.attValid) {
      this.flag(ctx, 'ATT', CX, CY);
      this.drawAircraftSymbol(ctx);
      return;
    }
    const pitch = this.pitch;
    const bank = this.bank;
    const cosB = Math.cos(bank * DEG);
    const sinB = Math.sin(bank * DEG);
    ctx.save();
    this.adiPath(ctx);
    ctx.clip();
    // Sky / ground: rotate about the airplane symbol.
    ctx.translate(CX, CY);
    ctx.rotate(-bank * DEG);
    const off = pitch * PX_PER_DEG;
    ctx.fillStyle = CDS.sky;
    ctx.fillRect(-700, -1400 + off, 1400, 1400);
    ctx.fillStyle = CDS.ground;
    ctx.fillRect(-700, off, 1400, 1400);
    line(ctx, -700, off, 700, off, CDS.white, 2.4);
    ctx.restore();

    // Pitch ladder (clipped to the central window).
    ctx.save();
    ctx.beginPath();
    ctx.rect(CX - 130, ADI_T + 44, 260, ADI_B - ADI_T - 88);
    ctx.clip();
    ctx.translate(CX, CY);
    ctx.rotate(-bank * DEG);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    const p0 = Math.ceil((pitch - 22) / 2.5) * 2.5;
    ctx.beginPath();
    for (let p = p0; p <= pitch + 22; p += 2.5) {
      if (Math.abs(p) < 0.01) continue;
      const y = (pitch - p) * PX_PER_DEG;
      const tenth = Math.abs(p % 10) < 0.01;
      const five = Math.abs(p % 5) < 0.01;
      const hw = tenth ? 52 : five ? 26 : 12;
      ctx.moveTo(-hw, y);
      ctx.lineTo(hw, y);
    }
    ctx.stroke();
    for (let p = Math.ceil((pitch - 22) / 10) * 10; p <= pitch + 22; p += 10) {
      if (p === 0) continue;
      const y = (pitch - p) * PX_PER_DEG;
      const s = fmtInt(Math.abs(p));
      text(ctx, s, -58, y, 20, CDS.white, 'right');
      text(ctx, s, 58, y, 20, CDS.white, 'left');
    }
    ctx.restore();

    // PLI (flaps extended or AoA high): amber "eyebrows" at the pitch where the AoA reaches the stick shaker.
    if (Number.isFinite(this.aoaNorm) && this.aoaNorm > 0.05 && (this.flaps > 0.5 || this.aoaNorm > 0.6) && !this.onGround) {
      const alphaStall = this.aoa / this.aoaNorm;
      const pliPitch = pitch + (this.env.cfg.vars.shakerNorm * alphaStall - this.aoa);
      const dy = Math.max(-150, Math.min(150, (pitch - pliPitch) * PX_PER_DEG));
      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate(-bank * DEG);
      ctx.strokeStyle = CDS.amber;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        ctx.moveTo(sgn * 26, dy);
        ctx.lineTo(sgn * 62, dy);
        ctx.moveTo(sgn * 62, dy);
        ctx.lineTo(sgn * 62, dy + 14);
        for (let k = 0; k < 3; k++) {
          ctx.moveTo(sgn * (32 + k * 12), dy);
          ctx.lineTo(sgn * (38 + k * 12), dy - 10);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Bank scale (fixed) and pointer / slip indicator (moves with bank).
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    const ticks = [10, 20, 30, 45, 60];
    for (const tk of ticks) {
      for (const sgn of [-1, 1]) {
        const ang = sgn * tk * DEG;
        const len = tk === 30 || tk === 60 ? 20 : 12;
        const x0 = CX + Math.sin(ang) * BANK_R;
        const y0 = CY - Math.cos(ang) * BANK_R;
        const x1 = CX + Math.sin(ang) * (BANK_R + len);
        const y1 = CY - Math.cos(ang) * (BANK_R + len);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
    }
    ctx.stroke();
    // Zero index: fixed white triangle.
    ctx.fillStyle = CDS.white;
    ctx.beginPath();
    ctx.moveTo(CX, CY - BANK_R - 2);
    ctx.lineTo(CX - 11, CY - BANK_R - 20);
    ctx.lineTo(CX + 11, CY - BANK_R - 20);
    ctx.closePath();
    ctx.stroke();
    // Pointer + slip trapezoid (white; amber above 35 deg bank - FCOM "bank pointer turns amber").
    const ptrCol = Math.abs(bank) > 35 ? CDS.amber : CDS.white;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-bank * DEG);
    ctx.strokeStyle = ptrCol;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(0, -BANK_R + 2);
    ctx.lineTo(-11, -BANK_R + 20);
    ctx.lineTo(11, -BANK_R + 20);
    ctx.closePath();
    ctx.stroke();
    const sx = Math.max(-1, Math.min(1, this.slip)) * 22;
    ctx.beginPath();
    ctx.moveTo(sx - 13, -BANK_R + 24);
    ctx.lineTo(sx + 13, -BANK_R + 24);
    ctx.lineTo(sx + 16, -BANK_R + 31);
    ctx.lineTo(sx - 16, -BANK_R + 31);
    ctx.closePath();
    if (Math.abs(this.slip) >= 0.99) {
      ctx.fillStyle = ptrCol;
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
    void cosB;
    void sinB;

    // Rising runway + deviation scales are drawn in drawApproach; FD / FPV / symbol on top.
    this.drawFlightDirector(ctx);
    this.drawAircraftSymbol(ctx);
    if (v.get(B737_VARS.efisFpv(v.get(B737_VARS.efisSourceFor(this.side), this.side) as Side)) !== 0) this.drawFpv(ctx);
  }

  private drawAircraftSymbol(ctx: Ctx2D): void {
    ctx.fillStyle = CDS.black;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    for (const sgn of [-1, 1]) {
      // L-shaped wing: horizontal bar 116 px outboard .. 44 px, drop tab at the inner end.
      ctx.beginPath();
      ctx.moveTo(CX + sgn * 136, CY - 7);
      ctx.lineTo(CX + sgn * 50, CY - 7);
      ctx.lineTo(CX + sgn * 50, CY + 20);
      ctx.lineTo(CX + sgn * 62, CY + 20);
      ctx.lineTo(CX + sgn * 62, CY + 7);
      ctx.lineTo(CX + sgn * 136, CY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillRect(CX - 7, CY - 7, 14, 14);
    ctx.strokeRect(CX - 7, CY - 7, 14, 14);
  }

  private drawFlightDirector(ctx: Ctx2D): void {
    const v = this.env.vars;
    if (v.get(AP.fdOn(this.side)) === 0) return;
    const pv = v.get(AFCS_VARS.fdPitchValid) !== 0;
    const rv = v.get(AFCS_VARS.fdRollValid) !== 0;
    ctx.strokeStyle = CDS.magenta;
    ctx.lineWidth = 5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    if (pv) {
      const dy = Math.max(-130, Math.min(130, (v.get(AP.fdPitch) - this.pitch) * PX_PER_DEG));
      ctx.moveTo(CX - 128, CY - dy);
      ctx.lineTo(CX + 128, CY - dy);
    }
    if (rv) {
      // EST gain: 4 px per degree of bank error, full deflection at ~32 deg.
      const dx = Math.max(-130, Math.min(130, (v.get(AP.fdBank) - this.bank) * 4));
      ctx.moveTo(CX + dx, CY - 128);
      ctx.lineTo(CX + dx, CY + 128);
    }
    ctx.stroke();
  }

  private drawFpv(ctx: Ctx2D): void {
    const tasFps = Math.max(40, this.tas) * 1.6878;
    const gamma = Math.asin(Math.max(-0.99, Math.min(0.99, this.vs / 60 / tasFps))) / DEG;
    let drift = this.trk - this.hdg;
    drift = ((drift + 540) % 360) - 180;
    const x = CX + Math.max(-150, Math.min(150, drift * PX_PER_DEG));
    const y = CY - Math.max(-160, Math.min(160, (gamma - this.pitch) * PX_PER_DEG));
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 30, y);
    ctx.moveTo(x + 10, y);
    ctx.lineTo(x + 30, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y - 22);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- speed tape
  private yForKt(kt: number): number {
    return CY - (kt - Math.max(30, this.ias)) * PX_PER_KT;
  }

  private drawSpeedTape(ctx: Ctx2D): void {
    const v = this.env.vars;
    const env = this.env;
    ctx.fillStyle = CDS.tape;
    ctx.fillRect(SPD_L, TAPE_T, SPD_R - SPD_L, TAPE_B - TAPE_T);
    if (!this.adcValid) {
      this.flag(ctx, 'SPD', (SPD_L + SPD_R) / 2, CY);
      return;
    }
    const ias = Math.max(30, this.ias);
    ctx.save();
    ctx.beginPath();
    ctx.rect(SPD_L, TAPE_T, SPD_R - SPD_L + 60, TAPE_B - TAPE_T);
    ctx.clip();
    // Ticks every 10 kt, numbers every 20 kt (right-aligned left of the ticks).
    const lo = Math.max(30, Math.floor((ias - 70) / 10) * 10);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    for (let k = lo; k <= ias + 70; k += 10) {
      const y = this.yForKt(k);
      ctx.moveTo(SPD_R - 14, y);
      ctx.lineTo(SPD_R, y);
    }
    ctx.stroke();
    for (let k = Math.ceil(lo / 20) * 20; k <= ias + 70; k += 20) text(ctx, fmtInt(k), SPD_R - 20, this.yForKt(k), 24, CDS.white, 'right');

    // Barber poles: Vmo/Mmo (top) and stick shaker (bottom); amber maneuver margin bars.
    const vmoVar = v.get(env.cfg.vars.vmoVar, NaN);
    const vmo = Number.isFinite(vmoVar) && vmoVar > 50 ? vmoVar : this.vmoFromMach();
    this.barberPole(ctx, this.yForKt(vmo), TAPE_T - 10, true);
    const shaker = this.shakerSpeed();
    if (Number.isFinite(shaker) && !this.onGround) {
      this.barberPole(ctx, this.yForKt(shaker), TAPE_B + 10, false);
      // Minimum maneuver speed: 1.3 g margin to the stick shaker (b737.org.uk SMYD description: Vmnvr).
      const minMan = shaker * Math.sqrt(1.3);
      this.amberBar(ctx, this.yForKt(shaker), this.yForKt(minMan));
    }
    // Maximum maneuver speed: 1.3 g margin to high-speed buffet (FCOM: 0.3 g manoeuvre margin).
    const maxMan = this.maxManeuverKt();
    if (Number.isFinite(maxMan) && maxMan < vmo) this.amberBar(ctx, this.yForKt(maxMan), this.yForKt(vmo));

    // Reference speed bugs.
    this.speedBugs(ctx);

    // Selected speed cursor (magenta notch at the right edge).
    const cur = v.get(B737_VARS.mcpSpdCursorKt, v.get(AP.selSpeed));
    if (cur > 0) {
      const y = Math.max(TAPE_T + 6, Math.min(TAPE_B - 6, this.yForKt(cur)));
      ctx.strokeStyle = CDS.magenta;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.moveTo(SPD_R + 1, y - 13);
      ctx.lineTo(SPD_R + 16, y - 13);
      ctx.lineTo(SPD_R + 16, y + 13);
      ctx.lineTo(SPD_R + 1, y + 13);
      ctx.lineTo(SPD_R + 9, y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // Speed trend vector (green arrow from the pointer, 10 s; shown beyond 2 kt).
    if (Math.abs(this.iasTrend) > 2 && this.ias > 45) {
      const y1 = Math.max(TAPE_T, Math.min(TAPE_B, CY - this.iasTrend * PX_PER_KT));
      const x = SPD_R - 3;
      ctx.strokeStyle = CDS.green;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.moveTo(x, CY);
      ctx.lineTo(x, y1);
      const d = y1 < CY ? 1 : -1;
      ctx.moveTo(x - 7, y1 + d * 10);
      ctx.lineTo(x, y1);
      ctx.lineTo(x + 7, y1 + d * 10);
      ctx.stroke();
    }

    // Readout box with rolling ones digit.
    this.speedReadout(ctx);

    // Selected speed readout (magenta) above the tape; blank while the MCP window is blank without a cursor.
    const mach = v.get(B737_VARS.mcpSpdCursorMach);
    if (cur > 0) {
      const s = mach > 0 ? '.' + fmtInt(Math.round(mach * 1000)).padStart(3, '0') : fmtInt(Math.round(cur));
      text(ctx, s, (SPD_L + SPD_R) / 2 + 6, TAPE_T - 24, 30, CDS.magenta, 'center');
    }
    // Mach (>= .40) or ground speed below the tape (FCOM "Mach/Groundspeed display").
    if (this.mach >= 0.4) text(ctx, '.' + fmtInt(Math.round(this.mach * 1000)).padStart(3, '0'), (SPD_L + SPD_R) / 2, TAPE_B + 28, 28, CDS.white, 'center');
    else {
      text(ctx, 'GS', SPD_L + 2, TAPE_B + 28, 20, CDS.white, 'left');
      text(ctx, fmtInt(Math.round(this.gs)), SPD_R + 6, TAPE_B + 28, 26, CDS.white, 'right');
    }
  }

  private vmoFromMach(): number {
    // Vmo 340 kt / Mmo 0.82 [TCDS]: IAS equivalent of Mmo at the current altitude = IAS * Mmo / M.
    const vmo = B738_SPEEDS.vmoKt;
    if (this.mach > 0.2 && this.ias > 50) return Math.min(vmo, this.ias * (B738_SPEEDS.mmo / this.mach));
    return vmo;
  }

  private shakerSpeed(): number {
    // Speed at which the AoA reaches the shaker threshold at 1 g: V_ss = IAS * sqrt(aoaNorm / shakerNorm) (CL ~ alpha, EST).
    const n = this.aoaNorm;
    if (!Number.isFinite(n) || n < 0.05 || this.ias < 60) return NaN;
    return this.ias * Math.sqrt(n / this.env.cfg.vars.shakerNorm);
  }

  private maxManeuverKt(): number {
    const gw = this.env.fmc?.grossWeightKg ?? NaN;
    if (!Number.isFinite(gw) || this.mach < 0.3 || this.ias < 100) return NaN;
    const pa = this.env.vars.get(SENSOR_VARS.pressAlt(this.env.vars.get(B737_VARS.airDataFor(this.side), this.side)), this.alt);
    const m = maxManeuverMach(gw, pressureAtAltPa(pa));
    if (!Number.isFinite(m)) return NaN;
    return this.ias * (m / this.mach);
  }

  private barberPole(ctx: Ctx2D, yEdge: number, yEnd: number, top: boolean): void {
    const x = SPD_R - 10;
    const w = 10;
    const y0 = top ? Math.max(TAPE_T - 20, Math.min(yEdge, yEnd)) : Math.max(yEdge, TAPE_T - 20);
    const y1 = top ? Math.min(TAPE_B, yEdge) : Math.min(TAPE_B + 20, yEnd);
    if (y1 <= y0) return;
    ctx.fillStyle = CDS.black;
    ctx.fillRect(x, y0, w, y1 - y0);
    ctx.fillStyle = CDS.red;
    const seg = 12;
    const start = top ? yEdge - Math.ceil((yEdge - y0) / (2 * seg)) * 2 * seg : yEdge;
    for (let y = start; y < y1; y += 2 * seg) {
      const a = Math.max(y, y0);
      const b = Math.min(y + seg, y1);
      if (b > a) ctx.fillRect(x, a, w, b - a);
    }
  }

  private amberBar(ctx: Ctx2D, ya: number, yb: number): void {
    const y0 = Math.max(TAPE_T, Math.min(ya, yb));
    const y1 = Math.min(TAPE_B, Math.max(ya, yb));
    if (y1 <= y0) return;
    line(ctx, SPD_R - 5, y0, SPD_R - 5, y1, CDS.amber, 3);
  }

  private speedBugs(ctx: Ctx2D): void {
    const v = this.env.vars;
    const fmc = this.env.fmc;
    const manual = v.get(B737_VARS.spdRefSel) !== 0;
    const pick = (fmcVal: number, manVar: string): number => {
      const m = v.get(manVar);
      if (manual && m > 0) return m;
      return fmcVal;
    };
    const v1 = pick(fmc?.v1 ?? NaN, B737_VARS.spdRefV1);
    const vr = pick(fmc?.vr ?? NaN, B737_VARS.spdRefVr);
    const vref = pick(fmc?.vref ?? NaN, B737_VARS.spdRefVref);
    const bug = v.get(B737_VARS.spdRefBug);
    // Takeoff bugs while on the ground / below 400 ft RA? V1/VR shown until flaps up (EST: while flaps extended & below 20,000 ft).
    const takeoffPhase = this.onGround || (this.flaps > 0.5 && this.raValid && this.ra < 2000 && this.vs > 0);
    if (takeoffPhase) {
      if (Number.isFinite(v1) && v1 > 0) this.bug(ctx, v1, 'V1', CDS.green);
      if (Number.isFinite(vr) && vr > 0) this.bug(ctx, vr, 'VR', CDS.green);
    }
    if (Number.isFinite(vref) && vref > 0 && !this.onGround) {
      this.bug(ctx, vref, 'REF', CDS.green);
    }
    if (bug > 0) this.bug(ctx, bug, '', CDS.white);
    // Flap maneuver speeds (green): current and next positions, flaps extended, below 20,000 ft (FCOM "Flaps Maneuvering Speed Bugs").
    const gw = fmc?.grossWeightKg ?? NaN;
    if (Number.isFinite(gw) && this.alt < 20000) {
      const band = maneuverBand(gw);
      const tbl = B738_FLAP_MANEUVER;
      let cur = 0;
      for (let i = 0; i < tbl.length; i++) if (this.flaps >= tbl[i].deg - 0.5) cur = i;
      const extended = this.flaps > 0.5;
      if (this.flaps >= 29.5) {
        // Landing flaps: go-around flap (15) maneuver speed (EST display rule).
        this.bug(ctx, tbl[4].kt[band], tbl[4].label, CDS.green);
      } else if (extended) {
        // Current and next retraction position (FCOM "flap maneuver speed bugs").
        this.bug(ctx, tbl[cur].kt[band], tbl[cur].label, CDS.green);
        if (cur > 0) this.bug(ctx, tbl[cur - 1].kt[band], tbl[cur - 1].label, CDS.green);
      }
    }
    // NO VSPD: V-speeds not selected (on the ground).
    if (this.onGround && !(fmc?.vSpeedsSet ?? false) && !(manual && v.get(B737_VARS.spdRefV1) > 0)) {
      const x = SPD_R + 24;
      const letters = ['N', 'O', '', 'V', 'S', 'P', 'D'];
      for (let i = 0; i < letters.length; i++) text(ctx, letters[i], x, CY - 118 + i * 24, 22, CDS.amber, 'center');
    }
  }

  private bug(ctx: Ctx2D, kt: number, label: string, color: string): void {
    const y = this.yForKt(kt);
    if (y < TAPE_T - 2 || y > TAPE_B + 2) return;
    line(ctx, SPD_R, y, SPD_R + 12, y, color, LW.normal);
    if (label) text(ctx, label, SPD_R + 15, y, 20, color, 'left');
  }

  private speedReadout(ctx: Ctx2D): void {
    const ias = Math.max(30, this.ias);
    const x0 = SPD_L - 14;
    const x1 = SPD_R - 14;
    const xw = x1 - 34; // rolling ones-digit window (taller)
    const hh = 23;
    const wh = 36;
    ctx.fillStyle = CDS.black;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(x0, CY - hh);
    ctx.lineTo(xw, CY - hh);
    ctx.lineTo(xw, CY - wh);
    ctx.lineTo(x1, CY - wh);
    ctx.lineTo(x1, CY - 10);
    ctx.lineTo(x1 + 11, CY);
    ctx.lineTo(x1, CY + 10);
    ctx.lineTo(x1, CY + wh);
    ctx.lineTo(xw, CY + wh);
    ctx.lineTo(xw, CY + hh);
    ctx.lineTo(x0, CY + hh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const tens = Math.floor(ias / 10);
    const size = 36;
    text(ctx, fmtInt(tens), xw - 2, CY + 1, size, CDS.white, 'right');
    ctx.save();
    ctx.beginPath();
    ctx.rect(xw + 1, CY - wh + 1, x1 - xw - 2, 2 * wh - 2);
    ctx.clip();
    const onesF = ias % 10;
    const base = Math.floor(onesF);
    const sub = onesF - base;
    for (let k = -2; k <= 2; k++) {
      const d = (base + k + 10) % 10;
      text(ctx, fmtInt(d), (xw + x1) / 2, CY + 1 + (sub - k) * 34, size, CDS.white, 'center');
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- altitude tape
  private yForFt(ft: number): number {
    return CY - (ft - this.alt) * PX_PER_FT;
  }

  private drawAltitudeTape(ctx: Ctx2D): void {
    const v = this.env.vars;
    const p = v.get(B737_VARS.efisSourceFor(this.side), this.side) as Side;
    const a = v.get(B737_VARS.airDataFor(this.side), this.side);
    ctx.fillStyle = CDS.tape;
    ctx.fillRect(ALT_L, TAPE_T, ALT_R - ALT_L, TAPE_B - TAPE_T);
    const sel = v.get(AP.selAltitude);
    const metric = v.get(B737_VARS.efisMtrs(p)) !== 0;
    // Selected altitude readout (magenta) with the alert box (white; amber flashing current-altitude box on deviation).
    const selStr = fmtInt(Math.round(sel));
    text(ctx, selStr, (ALT_L + ALT_R) / 2 + 4, TAPE_T - 24, 30, CDS.magenta, 'center');
    if (metric) text(ctx, fmtInt(Math.round(sel * 0.3048)) + 'M', (ALT_L + ALT_R) / 2 + 4, TAPE_T - 58, 22, CDS.magenta, 'center');
    if (this.altAlert === 1) {
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = LW.normal;
      ctx.strokeRect(ALT_L + 2, TAPE_T - 44, ALT_R - ALT_L - 2, 38);
    }
    if (!this.adcValid) {
      this.flag(ctx, 'ALT', (ALT_L + ALT_R) / 2, CY);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(ALT_L - 20, TAPE_T, ALT_R - ALT_L + 20, TAPE_B - TAPE_T);
    ctx.clip();
    // Landing altitude reference bar (amber 0-500 ft, white 500-1000 ft above the landing altitude: EST).
    const le = this.env.fmc?.landingElevFt ?? NaN;
    if (Number.isFinite(le)) {
      const yA = this.yForFt(le);
      const yB = this.yForFt(le + 500);
      const yC = this.yForFt(le + 1000);
      ctx.fillStyle = CDS.amber;
      ctx.fillRect(ALT_L + 1, Math.max(TAPE_T, yB), 7, Math.max(0, Math.min(TAPE_B, yA) - Math.max(TAPE_T, yB)));
      ctx.fillStyle = CDS.white;
      ctx.fillRect(ALT_L + 1, Math.max(TAPE_T, yC), 7, Math.max(0, Math.min(TAPE_B, yB) - Math.max(TAPE_T, yC)));
      // Crosshatch below the landing altitude (ground reference).
      if (yA < TAPE_B) {
        ctx.strokeStyle = CDS.amber;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let y = yA; y < TAPE_B + 30; y += 14) {
          ctx.moveTo(ALT_L, y);
          ctx.lineTo(ALT_R, y + 30);
        }
        ctx.stroke();
      }
    }
    // Ticks every 100 ft, numbers every 200 ft, 1000-ft marks with lines above/below.
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    const lo = Math.floor((this.alt - 450) / 100) * 100;
    for (let f = lo; f <= this.alt + 450; f += 100) {
      const y = this.yForFt(f);
      ctx.moveTo(ALT_L, y);
      ctx.lineTo(ALT_L + 13, y);
    }
    ctx.stroke();
    for (let f = Math.ceil(lo / 200) * 200; f <= this.alt + 450; f += 200) {
      const y = this.yForFt(f);
      const thousands = Math.floor(Math.abs(f) / 1000);
      const hundreds = Math.abs(f) % 1000;
      const neg = f < 0;
      const xr = ALT_R - 8;
      const hs = hundreds === 0 ? '000' : fmtInt(hundreds);
      text(ctx, hs, xr, y + 1, 19, CDS.white, 'right');
      if (thousands > 0 || neg) text(ctx, (neg ? '-' : '') + fmtInt(thousands), xr - 34, y, 26, CDS.white, 'right');
      if (hundreds === 0) {
        line(ctx, ALT_L + 16, y - 16, ALT_R - 4, y - 16, CDS.white, 1.6);
        line(ctx, ALT_L + 16, y + 16, ALT_R - 4, y + 16, CDS.white, 1.6);
      }
    }
    // Minimums pointer (BARO minimums, green triangle on the left edge).
    const radio = v.get(B737_VARS.efisMinsRef(p)) === 0;
    const bm = v.get(B737_VARS.efisMinsBaroFt(p), -1);
    if (!radio && bm > -1000) {
      const y = this.yForFt(bm);
      const col = this.mins.phase === 'reached' ? CDS.amber : CDS.green;
      ctx.strokeStyle = col;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.moveTo(ALT_L - 18, y);
      ctx.lineTo(ALT_L + 14, y);
      ctx.moveTo(ALT_L - 18, y - 10);
      ctx.lineTo(ALT_L - 4, y);
      ctx.lineTo(ALT_L - 18, y + 10);
      ctx.stroke();
    }
    // Selected altitude bug (magenta notch on the left edge).
    {
      const y = Math.max(TAPE_T + 10, Math.min(TAPE_B - 10, this.yForFt(sel)));
      ctx.strokeStyle = CDS.magenta;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.moveTo(ALT_L + 1, y - 22);
      ctx.lineTo(ALT_L + 18, y - 22);
      ctx.lineTo(ALT_L + 18, y + 22);
      ctx.lineTo(ALT_L + 1, y + 22);
      ctx.lineTo(ALT_L + 1, y + 8);
      ctx.lineTo(ALT_L + 9, y);
      ctx.lineTo(ALT_L + 1, y - 8);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    this.altitudeReadout(ctx, metric);

    // Baro setting / STD / preselect (green; preselect white).
    const std = v.get(ADC.baroStd(a)) !== 0;
    const hpa = v.get(B737_VARS.efisBaroHpa(p)) !== 0;
    const x = (ALT_L + ALT_R) / 2;
    if (std) {
      text(ctx, 'STD', x, TAPE_B + 28, 28, CDS.green, 'center');
      const pre = v.get(B737_VARS.efisBaroPresel(p), 29.92);
      const ps = hpa ? fmtInt(Math.round(pre * HPA_PER_INHG)) + ' HPA' : this.fmtInHg(pre) + ' IN';
      text(ctx, ps, x, TAPE_B + 58, 20, CDS.white, 'center');
    } else {
      const b = v.get(ADC.baroSetting(a), 29.92);
      const bs = hpa ? fmtInt(Math.round(b * HPA_PER_INHG)) : this.fmtInHg(b);
      text(ctx, bs, x + 12, TAPE_B + 28, 28, CDS.green, 'right');
      text(ctx, hpa ? 'HPA' : 'IN', x + 18, TAPE_B + 30, 20, CDS.green, 'left');
    }
  }

  private fmtInHg(v: number): string {
    const c = Math.round(v * 100);
    const i = Math.floor(c / 100);
    const f = c % 100;
    return fmtInt(i) + '.' + (f < 10 ? '0' + fmtInt(f) : fmtInt(f));
  }

  private altitudeReadout(ctx: Ctx2D, metric: boolean): void {
    const alt = this.alt;
    const x0 = ALT_L - 8;
    const x1 = ALT_R + 4;
    const xw = x1 - 44; // tens drum window (taller)
    const hh = 23;
    const wh = 38;
    const dev = this.altAlert === 2;
    const boxCol = dev && blink(this.t, 2) ? CDS.amber : CDS.white;
    const bold = this.altAlert === 1 || dev;
    ctx.fillStyle = CDS.black;
    ctx.strokeStyle = boxCol;
    ctx.lineWidth = bold ? LW.thick + 1.2 : LW.normal;
    ctx.beginPath();
    ctx.moveTo(x0, CY);
    ctx.lineTo(x0 + 11, CY - 10);
    ctx.lineTo(x0 + 11, CY - hh);
    ctx.lineTo(xw, CY - hh);
    ctx.lineTo(xw, CY - wh);
    ctx.lineTo(x1, CY - wh);
    ctx.lineTo(x1, CY + wh);
    ctx.lineTo(xw, CY + wh);
    ctx.lineTo(xw, CY + hh);
    ctx.lineTo(x0 + 11, CY + hh);
    ctx.lineTo(x0 + 11, CY + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const a = Math.abs(alt);
    const hundreds = Math.floor(a / 100);
    const tens = a % 100;
    const th = Math.floor(hundreds / 10);
    const hu = hundreds % 10;
    if (alt < 0) text(ctx, 'NEG', x0 + 16, CY - hh + 9, 13, CDS.white, 'left');
    if (th > 0) text(ctx, fmtInt(th), xw - 24, CY + 1, 36, CDS.white, 'right');
    text(ctx, fmtInt(hu), xw - 3, CY + 3, 28, CDS.white, 'right');
    ctx.save();
    ctx.beginPath();
    ctx.rect(xw + 1, CY - wh + 1, x1 - xw - 2, 2 * wh - 2);
    ctx.clip();
    const step = tens / 20;
    const base = Math.floor(step);
    const sub = step - base;
    for (let k = -2; k <= 2; k++) {
      const val = ((base + k) * 20 + 100) % 100;
      text(ctx, val === 0 ? '00' : fmtInt(val), (xw + x1) / 2, CY + 2 + (sub - k) * 26, 24, CDS.white, 'center');
    }
    ctx.restore();
    if (metric) {
      const m = fmtInt(Math.round(alt * 0.3048)) + ' M';
      ctx.fillStyle = CDS.black;
      ctx.fillRect(x0 + 18, CY - wh - 32, x1 - x0 - 18, 28);
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 18, CY - wh - 32, x1 - x0 - 18, 28);
      text(ctx, m, x1 - 6, CY - wh - 18, 22, CDS.white, 'right');
    }
  }

  // ---------------------------------------------------------------- VSI
  private drawVsi(ctx: Ctx2D): void {
    const v = this.env.vars;
    // Background panel (dark grey, narrower at the ends).
    ctx.fillStyle = CDS.tape;
    ctx.beginPath();
    ctx.moveTo(VSI_L, CY - VSI_HALF + 20);
    ctx.lineTo(VSI_L + 26, CY - VSI_HALF);
    ctx.lineTo(VSI_R, CY - VSI_HALF);
    ctx.lineTo(VSI_R, CY + VSI_HALF);
    ctx.lineTo(VSI_L + 26, CY + VSI_HALF);
    ctx.lineTo(VSI_L, CY + VSI_HALF - 20);
    ctx.lineTo(VSI_L, CY + 70);
    ctx.lineTo(VSI_L + 12, CY + 50);
    ctx.lineTo(VSI_L + 12, CY - 50);
    ctx.lineTo(VSI_L, CY - 70);
    ctx.closePath();
    ctx.fill();
    if (!this.adcValid) {
      this.flag(ctx, 'VERT', (VSI_L + VSI_R) / 2, CY);
      return;
    }
    // TCAS RA bands (red: avoid, green: fly-to).
    const cfgv = this.env.cfg.vars;
    if (v.get(cfgv.tcasRa) > 0) {
      const lo = v.get(cfgv.tcasRaMin, -9999);
      const hi = v.get(cfgv.tcasRaMax, 9999);
      const yLo = CY - vsiFrac(Math.max(-6000, lo)) * VSI_HALF;
      const yHi = CY - vsiFrac(Math.min(6000, hi)) * VSI_HALF;
      ctx.fillStyle = CDS.red;
      ctx.fillRect(VSI_L + 14, CY - VSI_HALF, 10, Math.max(0, yHi - (CY - VSI_HALF)));
      ctx.fillRect(VSI_L + 14, yLo, 10, Math.max(0, CY + VSI_HALF - yLo));
      ctx.fillStyle = CDS.green;
      ctx.fillRect(VSI_L + 14, yHi, 10, Math.max(0, yLo - yHi));
    }
    // Scale marks: 500-ft steps to 2000, then 6000; labels 1, 2, 6.
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    const marks = [500, 1000, 1500, 2000, 6000];
    for (const m of marks) {
      for (const sg of [-1, 1]) {
        const y = CY - vsiFrac(sg * m) * VSI_HALF;
        const len = m % 1000 === 0 || m === 6000 ? 14 : 8;
        ctx.moveTo(VSI_L + 16, y);
        ctx.lineTo(VSI_L + 16 + len, y);
      }
    }
    ctx.moveTo(VSI_L + 16, CY);
    ctx.lineTo(VSI_L + 34, CY);
    ctx.stroke();
    for (const [m, s] of [
      [1000, '1'],
      [2000, '2'],
      [6000, '6'],
    ] as const) {
      text(ctx, s, VSI_L + 5, CY - vsiFrac(m) * VSI_HALF, 18, CDS.white, 'center');
      text(ctx, s, VSI_L + 5, CY - vsiFrac(-m) * VSI_HALF, 18, CDS.white, 'center');
    }
    // Selected V/S bug (magenta) when the MCP V/S window is open.
    if (v.get(B737_VARS.mcpVsBlank, 1) === 0) {
      const y = CY - vsiFrac(v.get(AP.selVs)) * VSI_HALF;
      ctx.strokeStyle = CDS.magenta;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(VSI_L + 14, y - 8);
      ctx.lineTo(VSI_L + 30, y - 8);
      ctx.moveTo(VSI_L + 14, y + 8);
      ctx.lineTo(VSI_L + 30, y + 8);
      ctx.stroke();
    }
    // Pointer: from a virtual pivot to the right of the display (FCOM figure) to the scale.
    const yv = CY - vsiFrac(this.vs) * VSI_HALF;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(VSI_L + 16, yv);
    ctx.lineTo(VSI_R + 40, CY);
    ctx.stroke();
    // Digital readout beyond 400 fpm (above when climbing, below when descending).
    if (Math.abs(this.vs) > 400) {
      const s = fmtInt(Math.round(Math.abs(this.vs) / 50) * 50);
      text(ctx, s, (VSI_L + VSI_R) / 2 + 6, this.vs > 0 ? CY - VSI_HALF - 20 : CY + VSI_HALF + 20, 22, CDS.white, 'center');
    }
  }

  // ---------------------------------------------------------------- heading
  private drawHeading(ctx: Ctx2D): void {
    const v = this.env.vars;
    ctx.save();
    ctx.beginPath();
    ctx.rect(150, HDG_CY - HDG_R - 30, 460, 200);
    ctx.clip();
    // Dark rose background.
    ctx.fillStyle = CDS.tape;
    ctx.beginPath();
    ctx.arc(CX, HDG_CY, HDG_R, 0, Math.PI * 2);
    ctx.fill();
    if (!this.hdgValid) {
      ctx.restore();
      this.flag(ctx, 'HDG', CX, HDG_CY - HDG_R + 40);
      return;
    }
    const hdg = this.hdg;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    const h0 = Math.floor((hdg - 60) / 5) * 5;
    for (let h = h0; h <= hdg + 60; h += 5) {
      const ang = (h - hdg) * DEG;
      const len = h % 10 === 0 ? 16 : 9;
      ctx.moveTo(CX + Math.sin(ang) * HDG_R, HDG_CY - Math.cos(ang) * HDG_R);
      ctx.lineTo(CX + Math.sin(ang) * (HDG_R - len), HDG_CY - Math.cos(ang) * (HDG_R - len));
    }
    ctx.stroke();
    for (let h = Math.ceil((hdg - 60) / 10) * 10; h <= hdg + 60; h += 10) {
      const ang = (h - hdg) * DEG;
      const n = (((h % 360) + 360) % 360) / 10;
      const s = fmtInt(n === 0 ? 36 : n);
      ctx.save();
      ctx.translate(CX + Math.sin(ang) * (HDG_R - 32), HDG_CY - Math.cos(ang) * (HDG_R - 32));
      ctx.rotate(ang);
      text(ctx, s, 0, 0, n % 3 === 0 ? 24 : 18, CDS.white, 'center');
      ctx.restore();
    }
    // Selected heading bug (magenta).
    const sel = v.get(AP.selHeading);
    let dh = ((sel - hdg + 540) % 360) - 180;
    dh = Math.max(-60, Math.min(60, dh));
    ctx.save();
    ctx.translate(CX, HDG_CY);
    ctx.rotate(dh * DEG);
    ctx.strokeStyle = CDS.magenta;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(-14, -HDG_R);
    ctx.lineTo(-14, -HDG_R + 10);
    ctx.lineTo(14, -HDG_R + 10);
    ctx.lineTo(14, -HDG_R);
    ctx.lineTo(6, -HDG_R);
    ctx.lineTo(0, -HDG_R + 7);
    ctx.lineTo(-6, -HDG_R);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Track line.
    const dt = ((this.trk - hdg + 540) % 360) - 180;
    ctx.save();
    ctx.translate(CX, HDG_CY);
    ctx.rotate(dt * DEG);
    line(ctx, 0, -HDG_R + 2, 0, -HDG_R + 50, CDS.white, LW.normal);
    ctx.restore();
    ctx.restore();
    // Heading pointer (fixed white triangle).
    ctx.fillStyle = CDS.white;
    ctx.beginPath();
    ctx.moveTo(CX, HDG_CY - HDG_R + 2);
    ctx.lineTo(CX - 10, HDG_CY - HDG_R - 16);
    ctx.lineTo(CX + 10, HDG_CY - HDG_R - 16);
    ctx.closePath();
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.stroke();
    // Selected heading readout and heading reference.
    text(ctx, fmtInt(Math.round(((sel % 360) + 360) % 360 || 360)).padStart(3, '0'), CX - 62, 776, 26, CDS.magenta, 'right');
    text(ctx, 'H', CX - 56, 777, 20, CDS.magenta, 'left');
    text(ctx, 'MAG', CX + 58, 777, 20, CDS.green, 'left');
  }

  // ---------------------------------------------------------------- FMA
  private drawFma(ctx: Ctx2D): void {
    const v = this.env.vars;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(FMA_X[1], FMA_T + 6);
    ctx.lineTo(FMA_X[1], FMA_B - 6);
    ctx.moveTo(FMA_X[2], FMA_T + 6);
    ctx.lineTo(FMA_X[2], FMA_B - 6);
    ctx.stroke();
    const eng = [v.getString(B737_VARS.fmaAt), v.getString(B737_VARS.fmaRoll), v.getString(B737_VARS.fmaPitch)];
    const armed = ['', v.getString(B737_VARS.fmaRollArmed), v.getString(B737_VARS.fmaPitchArmed)];
    const amber = [false, v.get(B737_VARS.fmaRollAmber) !== 0, v.get(B737_VARS.fmaPitchAmber) !== 0];
    for (let i = 0; i < 3; i++) {
      const cx = (FMA_X[i] + FMA_X[i + 1]) / 2;
      const s = eng[i];
      if (s) {
        text(ctx, s, cx, FMA_T + 26, 26, amber[i] ? CDS.amber : CDS.green, 'center');
        if (this.boxes[i].t < MODE_BOX_S) {
          ctx.font = cdsFont(26);
          const w = Math.min(FMA_X[i + 1] - FMA_X[i] - 8, ctx.measureText(s).width + 12);
          ctx.strokeStyle = CDS.white;
          ctx.lineWidth = LW.normal;
          ctx.strokeRect(cx - w / 2, FMA_T + 8, w, 36);
        }
      }
      if (armed[i]) text(ctx, armed[i], cx, FMA_T + 64, 21, CDS.white, 'center');
    }
    // AFDS status above the attitude display (larger; amber for SINGLE CH / NO AUTOLAND).
    const st = v.getString(B737_VARS.fmaStatus);
    if (st) text(ctx, st, CX, ADI_T - 26, 32, v.get(B737_VARS.fmaStatusAmber) !== 0 ? CDS.amber : CDS.green, 'center');
  }

  // ---------------------------------------------------------------- approach / deviations
  private drawApproach(ctx: Ctx2D): void {
    const v = this.env.vars;
    const r = v.get(B737_VARS.navRxFor(this.side), this.side);
    const isLoc = v.get(NAV.isLoc(r)) !== 0;
    const received = v.get(NAV.received(r)) !== 0;
    const appActive = v.get(AFCS_VARS.button('app')) !== 0 || v.getString(B737_VARS.fmaRoll) === 'VOR/LOC' || v.getString(B737_VARS.fmaRollArmed) === 'VOR/LOC';
    // ILS reference (top left of the attitude display): ident / course, DME.
    if (isLoc && v.get(NAV.powered(r), 1) !== 0) {
      const ident = v.getString(NAV.ident(r));
      const crs = v.get(AP.selCourse(this.side), v.get(NAV.obs(r)));
      const freq = v.get(NAV.activeFreq(r));
      const idTxt = ident || (freq > 0 ? freq.toFixed(2) : '');
      text(ctx, idTxt + '/' + fmtInt(Math.round(((crs % 360) + 360) % 360 || 360)).padStart(3, '0') + '°', ADI_L + 8, ADI_T - 62, 20, CDS.white, 'left');
      const dmeOk = v.get(NAV.dmeValid(r)) !== 0;
      text(ctx, dmeOk ? 'DME ' + v.get(NAV.dmeNm(r)).toFixed(1) : 'DME ---', ADI_L + 8, ADI_T - 38, 20, CDS.white, 'left');
    }
    // Approach type annunciation (FMC approach loaded / ILS tuned): EST placement from the NG photos.
    const apType = isLoc ? 'ILS' : v.get(FMS.approachActive) !== 0 ? 'LNAV/VNAV' : '';
    if (apType) text(ctx, apType, ADI_L + 8, ADI_T + 22, 22, CDS.white, 'left');

    // Localizer deviation (below the attitude display) and glideslope (right).
    if (isLoc) {
      const locY = ADI_B + 20;
      const dot = 52;
      const cdi = v.get(NAV.cdi(r));
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      for (const k of [-2, -1, 1, 2]) {
        ctx.moveTo(CX + k * dot + 6, locY);
        ctx.arc(CX + k * dot, locY, 6, 0, Math.PI * 2);
      }
      ctx.stroke();
      line(ctx, CX, locY - 12, CX, locY + 12, CDS.white, LW.normal);
      if (received) {
        // + cdi = fly right = pointer right (path is to the right).
        const x = CX + Math.max(-2.3, Math.min(2.3, cdi * 2)) * dot;
        const alert = appActive && !this.onGround && this.raValid && this.ra < 1000 && Math.abs(cdi) > 0.33;
        this.diamond(ctx, x, locY, 16, 10, alert && blink(this.t, 1.5) ? CDS.amber : CDS.magenta, Math.abs(cdi) >= 1);
      } else text(ctx, 'LOC', CX - 80, locY, 20, CDS.amber, 'center');
      // Glideslope
      const gsX = ADI_R + 22;
      ctx.beginPath();
      for (const k of [-2, -1, 1, 2]) {
        ctx.moveTo(gsX + 6, CY + k * 44);
        ctx.arc(gsX, CY + k * 44, 6, 0, Math.PI * 2);
      }
      ctx.stroke();
      line(ctx, gsX - 12, CY, gsX + 12, CY, CDS.white, LW.normal);
      if (v.get(NAV.gsValid(r)) !== 0) {
        const dev = v.get(NAV.gsDev(r));
        // + dev = glideslope above = pointer up.
        const y = CY - Math.max(-2.3, Math.min(2.3, dev * 2)) * 44;
        this.diamond(ctx, gsX, y, 10, 16, CDS.magenta, Math.abs(dev) >= 1);
      } else text(ctx, 'G/S', gsX, CY - 110, 18, CDS.amber, 'center');

      // Rising runway (below 2,500 ft RA with the localizer received; rises from 200 ft RA - FCOM "Rising Runway").
      if (received && this.raValid && this.ra < 2500) {
        const rise = this.ra < 200 ? (1 - this.ra / 200) * 110 : 0;
        const yTop = CY + 120 - rise;
        const x = CX + Math.max(-2, Math.min(2, cdi * 2)) * 30;
        ctx.strokeStyle = CDS.green;
        ctx.lineWidth = LW.normal;
        ctx.beginPath();
        ctx.moveTo(x - 30, yTop);
        ctx.lineTo(x + 30, yTop);
        ctx.lineTo(x + 40, yTop + 14);
        ctx.lineTo(x - 40, yTop + 14);
        ctx.closePath();
        ctx.moveTo(x, yTop + 14);
        ctx.lineTo(x, ADI_B - 4);
        ctx.stroke();
      }
    } else if (v.get(FMS.gpValid) !== 0 && v.get(FMS.approachActive) !== 0) {
      // FMC approach: vertical path deviation (magenta) - EST NPS-like display.
      const gsX = ADI_R + 22;
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      for (const k of [-2, -1, 1, 2]) {
        ctx.moveTo(gsX + 6, CY + k * 44);
        ctx.arc(gsX, CY + k * 44, 6, 0, Math.PI * 2);
      }
      ctx.stroke();
      const y = CY - Math.max(-2.3, Math.min(2.3, v.get(FMS.gpDev) * 2)) * 44;
      this.diamond(ctx, gsX, y, 10, 16, CDS.magenta, false);
    }

    // Marker beacons (upper right of the attitude display).
    const mk = v.get(NAV.markerInner) !== 0 ? 3 : v.get(NAV.markerMiddle) !== 0 ? 2 : v.get(NAV.markerOuter) !== 0 ? 1 : 0;
    if (mk > 0 && blink(this.t, mk === 1 ? 2 : mk === 2 ? 3 : 6)) {
      const col = mk === 1 ? CDS.cyan : mk === 2 ? CDS.amber : CDS.white;
      const s = mk === 1 ? 'OM' : mk === 2 ? 'MM' : 'IM';
      ctx.strokeStyle = col;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.arc(ADI_R - 36, ADI_T + 34, 22, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, s, ADI_R - 36, ADI_T + 35, 18, col, 'center');
    }

    // Radio altitude (below 2,500 ft; amber below radio minimums).
    if (this.raValid && this.ra < 2500) {
      const p = v.get(B737_VARS.efisSourceFor(this.side), this.side) as Side;
      const rm = v.get(B737_VARS.efisMinsRadioFt(p), -1);
      const radio = v.get(B737_VARS.efisMinsRef(p)) === 0;
      const below = radio && rm >= 0 && this.ra <= rm && !this.onGround;
      const val = this.ra < 100 ? Math.round(this.ra) : this.ra < 500 ? Math.round(this.ra / 10) * 10 : Math.round(this.ra / 20) * 20;
      haloText(ctx, fmtInt(Math.max(0, val)), CX, ADI_B - 24, 28, below ? CDS.amber : CDS.white, 'center');
    }
    // Minimums readout (RADIO / BARO; amber flashing 3 s when reached).
    {
      const p = v.get(B737_VARS.efisSourceFor(this.side), this.side) as Side;
      const radio = v.get(B737_VARS.efisMinsRef(p)) === 0;
      const m = v.get(radio ? B737_VARS.efisMinsRadioFt(p) : B737_VARS.efisMinsBaroFt(p), -1);
      if (radio ? m >= 0 : m > -1000) {
        const reached = this.mins.phase === 'reached';
        const col = reached ? CDS.amber : CDS.green;
        if (!reached || this.mins.visible) {
          text(ctx, radio ? 'RADIO' : 'BARO', ADI_R - 40, ADI_B + 40, 20, col, 'center');
          text(ctx, fmtInt(m), ADI_R - 40, ADI_B + 64, 24, col, 'center');
        }
      }
    }
  }

  private diamond(ctx: Ctx2D, x: number, y: number, hw: number, hh: number, color: string, hollow: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x - hw, y);
    ctx.lineTo(x, y - hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x, y + hh);
    ctx.closePath();
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = LW.normal;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- misc annunciations
  private drawMisc(ctx: Ctx2D): void {
    const v = this.env.vars;
    const cfgv = this.env.cfg.vars;
    // EGPWS / windshear warnings on the attitude display (red), FCOM 15 "PULL UP" / "WINDSHEAR" PFD alerts.
    if (v.get(cfgv.windshear) !== 0) haloText(ctx, 'WINDSHEAR', CX, CY + 96, 30, CDS.red, 'center');
    else if (v.get(cfgv.tawsWarning) !== 0) haloText(ctx, 'PULL UP', CX, CY + 96, 30, CDS.red, 'center');
    // Display source annunciations (FCOM 10.10: DSPLY SOURCE / CDS FAULT).
    if (v.get(B737_VARS.cdsFault) !== 0) text(ctx, 'CDS FAULT', SPD_L, FMA_B + 20, 20, CDS.amber, 'left');
    else if (v.get(B737_VARS.dsplySource) !== 0) {
      const n = v.get(B737_VARS.dsplySourceN);
      text(ctx, n > 0 ? 'DSPLY SOURCE ' + fmtInt(n) : 'DSPLY SOURCE', SPD_L, FMA_B + 20, 20, CDS.amber, 'left');
    }
    // Flight director failure flag.
    if (v.get(AP.fdOn(this.side)) !== 0 && v.get('fail.afcs') !== 0) this.flag(ctx, 'FD', ADI_L + 40, ADI_T + 60);
  }

  private flag(ctx: Ctx2D, s: string, x: number, y: number): void {
    ctx.font = cdsFont(26);
    const w = ctx.measureText(s).width + 14;
    ctx.fillStyle = CDS.black;
    ctx.fillRect(x - w / 2, y - 18, w, 36);
    ctx.strokeStyle = CDS.amber;
    ctx.lineWidth = LW.normal;
    ctx.strokeRect(x - w / 2, y - 18, w, 36);
    text(ctx, s, x, y + 1, 26, CDS.amber, 'center');
  }
}
