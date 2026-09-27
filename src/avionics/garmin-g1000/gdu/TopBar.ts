/**
 * Top bar shared by the PFD and MFD formats (PG 190-02177-02 Figure 2-1 /
 * Figure 1-12, §4.2 "COM Tuning Boxes", §4.3 "NAV Tuning Boxes"):
 *
 *  - NAV box (upper left): NAV1 / NAV2, standby left, active right (active
 *    frequencies are toward the centre of the display), cyan tuning box on
 *    the standby of the boxed radio, transfer arrow, the CDI radio's active
 *    frequency green, station ident; volume % replaces the standby field for
 *    2 s; red X when the radio is invalid (IAU / display link lost).
 *  - COM box (upper right): active left (green = MIC selected on the audio
 *    panel, white = none / PA), standby right with the cyan tuning box; COM1
 *    / COM2 labels at the right edge; TX / RX indications; automatic
 *    squelch off shown as 'SQ'.
 *  - PFD: navigation status box (active leg, DIS, DTK / TOD alerts) and the
 *    AFCS status box below it: armed lateral (white), active lateral (green)
 *    | AP | active vertical (green) with its reference, armed vertical
 *    (white); modes flash for 10 s after a change (PG §7.2).
 *  - MFD: navigation data bar with four selectable fields (default GS, DTK,
 *    TRK, ETE) and the page title in cyan below it.
 */
import { AP, FMS, GPS, NAV } from '../../../core/vars';
import { wrap360 } from '../../../core/math';
import { box, line, type Ctx2D } from '../../common/draw/context';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { fmtCom, fmtDeg, fmtDist, fmtHms, join2 } from '../../garmin-g3000/format';
import type { G1000System } from '../state/System';
import { CDI_SOURCE, G1K, vn } from '../vars';
import { COM_BOX_X, G1K_COLORS, G1K_PALETTE, GDU_W, NAV_BOX_W, TF, TOPBAR_H } from './style';

const P = G1K_PALETTE;
const MODE_FLASH_S = 10;

/** Frequency with 2 decimals (NAV) or COM with 2/3 decimals depending on the channel spacing. */
function fmtNavFreq(mhz: number): string {
  return fmtCom(mhz, false);
}

export class TopBar {
  private lastLat = '';
  private lastVert = '';
  private latFlash = 0;
  private vertFlash = 0;
  private lastAp = 0;
  private apFlash = 0;
  private time = 0;

  constructor(private readonly sys: G1000System) {}

  update(dt: number): void {
    this.time += dt;
    const v = this.sys.vars;
    const lat = v.getString(AP.lateralActive);
    const vert = v.getString(AP.verticalActive);
    if (lat !== this.lastLat) {
      if (this.lastLat !== '' && lat !== '') this.latFlash = MODE_FLASH_S;
      this.lastLat = lat;
    }
    if (vert !== this.lastVert) {
      if (this.lastVert !== '' && vert !== '') this.vertFlash = MODE_FLASH_S;
      this.lastVert = vert;
    }
    const ap = v.get(AP.engaged);
    if (ap >= 0.5 && this.lastAp < 0.5) this.apFlash = 0;
    this.lastAp = ap;
    this.latFlash = Math.max(0, this.latFlash - dt);
    this.vertFlash = Math.max(0, this.vertFlash - dt);
    this.apFlash += dt;
  }

  /** Background of the whole bar. */
  drawBackground(ctx: Ctx2D): void {
    box(ctx, 0, 0, GDU_W, TOPBAR_H, G1K_COLORS.barBg, '');
    line(ctx, 0, TOPBAR_H, GDU_W, TOPBAR_H, G1K_COLORS.boxBorder, 1.5);
  }

  // ================================================================ NAV box

  drawNav(ctx: Ctx2D): void {
    const sys = this.sys;
    const v = sys.vars;
    const box1 = sys.radios.navBox;
    const cdi = sys.cdiSource;
    const n = Math.min(2, sys.cfg.radios.nav);
    for (let r = 1; r <= n; r++) {
      const y = r === 1 ? 15 : 40;
      TF.draw(ctx, r === 1 ? 'NAV1' : 'NAV2', 6, y, 15, P.white, 'left', 'middle');
      if (!sys.navRadioOk(r)) {
        this.redX(ctx, 50, y - 11, 190, 22);
        continue;
      }
      const boxed = r === box1;
      const stby = v.get(vn(NAV.standbyFreq, r));
      const act = v.get(vn(NAV.activeFreq, r));
      const volShow = boxed && v.get(G1K.navVolShowS) > 0;
      if (volShow) TF.draw(ctx, join2(fmtInt(v.get(vn(G1K.navVolume, r))), '%'), 104, y, 18, P.cyan, 'right', 'middle');
      else {
        if (boxed) box(ctx, 50, y - 11, 58, 22, '', P.cyan, 1.5, 2);
        TF.draw(ctx, fmtNavFreq(stby), 104, y, 18, boxed ? P.white : P.grey, 'right', 'middle');
      }
      if (boxed) TF.draw(ctx, '↔', 124, y, 16, P.cyan, 'center', 'middle');
      TF.draw(ctx, fmtNavFreq(act), 196, y, 18, cdi === r ? P.green : P.white, 'right', 'middle');
      const ident = v.get(vn(NAV.received, r)) >= 0.5 ? v.getString(vn(NAV.ident, r)) : '';
      // The ident audio key (NAV VOL push) is shown as 'ID' when Morse identifier audio is on.
      TF.draw(ctx, ident || (v.get(vn(G1K.navIdent, r)) >= 0.5 ? 'ID' : ''), 246, y, 13, P.white, 'right', 'middle');
    }
    line(ctx, NAV_BOX_W, 0, NAV_BOX_W, TOPBAR_H, G1K_COLORS.boxBorder, 1);
  }

  // ================================================================ COM box

  drawCom(ctx: Ctx2D): void {
    const sys = this.sys;
    const v = sys.vars;
    const boxed = sys.radios.comBox;
    const mic = sys.gma.mic;
    const split = v.get(G1K.gmaSplitCom) >= 0.5;
    const three = v.get(G1K.comSpacing833) >= 0.5;
    line(ctx, COM_BOX_X, 0, COM_BOX_X, TOPBAR_H, G1K_COLORS.boxBorder, 1);
    for (let r = 1; r <= 2; r++) {
      const y = r === 1 ? 15 : 40;
      TF.draw(ctx, r === 1 ? 'COM1' : 'COM2', GDU_W - 6, y, 15, P.white, 'right', 'middle');
      if (!sys.comRadioOk(r)) {
        this.redX(ctx, COM_BOX_X + 20, y - 11, 190, 22);
        continue;
      }
      const act = v.get(vn(NAV.comActive, r));
      const stby = v.get(vn(NAV.comStandby, r));
      const tx = v.get(vn(G1K.comTx, r)) >= 0.5;
      if (tx) TF.draw(ctx, 'TX', COM_BOX_X + 4, y, 12, P.green, 'left', 'middle');
      // Active green when the COM is selected for transmit on the audio panel (PG §4.2).
      const sel = mic === r || (split && r <= 2);
      TF.draw(ctx, fmtCom(act, three), COM_BOX_X + 92, y, 18, sel ? P.green : P.white, 'right', 'middle');
      const isBoxed = r === boxed;
      if (isBoxed) TF.draw(ctx, '↔', COM_BOX_X + 110, y, 16, P.cyan, 'center', 'middle');
      if (isBoxed && v.get(G1K.comVolShowS) > 0) TF.draw(ctx, join2(fmtInt(v.get(vn(G1K.comVolume, r))), '%'), COM_BOX_X + 194, y, 18, P.cyan, 'right', 'middle');
      else {
        if (isBoxed) box(ctx, COM_BOX_X + 124, y - 11, 74, 22, '', P.cyan, 1.5, 2);
        TF.draw(ctx, fmtCom(stby, three), COM_BOX_X + 194, y, 18, isBoxed ? P.white : P.grey, 'right', 'middle');
      }
      // Automatic squelch disabled: 'SQ' indication (PG Figure 4-3 item 5).
      if (v.get(vn(G1K.comSquelch, r)) < 0.5) TF.draw(ctx, 'SQ', COM_BOX_X + 205, y + 1, 11, P.white, 'left', 'middle');
    }
  }

  private redX(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    line(ctx, x, y, x + w, y + h, P.red, 2.5);
    line(ctx, x, y + h, x + w, y, P.red, 2.5);
  }

  // ================================================================ PFD status boxes

  drawPfdStatus(ctx: Ctx2D, x0: number, x1: number): void {
    const v = this.sys.vars;
    const cx = (x0 + x1) / 2;
    // --- navigation status (row 1)
    const tod = v.get(FMS.todEteS);
    const vnav = v.get(FMS.vnavValid) >= 0.5;
    const leg = v.get(FMS.activeLegIndex, -1) >= 0;
    if (vnav && tod > 0 && tod <= 60) TF.draw(ctx, 'TOD within 1 minute', cx, 14, 16, P.white, 'center', 'middle');
    else if (leg) {
      const from = v.getString(FMS.fromWptIdent);
      const to = v.getString(FMS.nextWptIdent);
      const dis = v.get(FMS.distToWptNm);
      const dtk = v.get(FMS.dtkMag);
      const legTxt = from ? join2(join2(from, ' → '), to) : join2('→ ', to);
      TF.draw(ctx, legTxt, x0 + 12, 14, 16, P.magenta, 'left', 'middle');
      TF.draw(ctx, 'DIS', x0 + 250, 14, 13, P.white, 'left', 'middle');
      TF.draw(ctx, join2(fmtDist(dis), 'NM'), x0 + 280, 14, 16, P.magenta, 'left', 'middle');
      TF.draw(ctx, 'DTK', x0 + 380, 14, 13, P.white, 'left', 'middle');
      TF.draw(ctx, fmtDeg(this.sys.vars.get(G1K.navAngleTrue) >= 0.5 ? wrap360(dtk + v.get(GPS.magVar)) : dtk), x0 + 412, 14, 16, P.magenta, 'left', 'middle');
    }
    line(ctx, x0, 28, x1, 28, G1K_COLORS.boxBorder, 1);
    if (!this.sys.cfg.afcs) return;
    this.drawAfcs(ctx, x0, x1, 42);
  }

  /** AFCS status box (PG §7.2 "Flight Director Modes", Figure 7-2). */
  drawAfcs(ctx: Ctx2D, x0: number, x1: number, y: number): void {
    const v = this.sys.vars;
    const w = x1 - x0;
    const cx = x0 + w / 2;
    const flashOn = blinkOn(this.time, 2);
    const lat = v.getString(AP.lateralActive);
    const latArmed = v.getString(AP.lateralArmed);
    const vert = v.getString(AP.verticalActive);
    const vertArmed = v.getString(AP.verticalArmed);
    // Separators between the lateral / AP / vertical fields.
    line(ctx, x0 + w * 0.36, 28, x0 + w * 0.36, TOPBAR_H, G1K_COLORS.boxBorder, 1);
    line(ctx, x0 + w * 0.5, 28, x0 + w * 0.5, TOPBAR_H, G1K_COLORS.boxBorder, 1);
    if (latArmed && latArmed !== 'NONE') TF.draw(ctx, latArmed, x0 + w * 0.09, y, 16, P.white, 'center', 'middle');
    if (lat && lat !== 'NONE' && (this.latFlash <= 0 || flashOn)) TF.draw(ctx, lat, x0 + w * 0.26, y, 17, P.green, 'center', 'middle');
    // AP: green 'AP' engaged; CWS replaces it (white); disconnect: flashing yellow (manual) / red-white (automatic).
    const ap = v.get(AP.engaged) >= 0.5;
    const cws = v.get('ap.cws') >= 0.5;
    const disc = v.get('ap.disc_warn') >= 0.5;
    const auto = v.get('ap.disc_auto') >= 0.5;
    if (cws && ap) TF.draw(ctx, 'CWS', cx - w * 0.07, y, 16, P.white, 'center', 'middle');
    else if (ap) TF.draw(ctx, 'AP', cx - w * 0.07, y, 17, P.green, 'center', 'middle');
    else if (disc) {
      const bg = auto ? (flashOn ? P.red : P.white) : P.yellow;
      if (auto || flashOn) {
        box(ctx, cx - w * 0.07 - 18, y - 10, 36, 20, bg, '');
        TF.draw(ctx, 'AP', cx - w * 0.07, y + 1, 16, auto && !flashOn ? P.red : P.black, 'center', 'middle');
      }
    }
    if (vert && vert !== 'NONE' && (this.vertFlash <= 0 || flashOn)) {
      TF.draw(ctx, vert, x0 + w * 0.56, y, 17, P.green, 'center', 'middle');
      const ref = this.vertRef(vert);
      if (ref) TF.draw(ctx, ref, x0 + w * 0.72, y, 15, P.green, 'center', 'middle');
    }
    if (vertArmed && vertArmed !== 'NONE') {
      // VPTH flashes while descent acknowledgement is required (PG §7.3 "Vertical Path Tracking").
      const vp = vertArmed.indexOf('VPTH') >= 0 && v.get(FMS.todEteS) > 0 && v.get(FMS.todEteS) < 60;
      if (!vp || flashOn) TF.draw(ctx, vertArmed, x0 + w * 0.9, y, 15, P.white, 'center', 'middle');
    }
  }

  /** Vertical reference next to the active vertical mode (PG Table 7-2): VS ↑500FPM, ALT 7500FT, FLC 90KT. */
  private vertRef(vert: string): string {
    const v = this.sys.vars;
    switch (vert) {
      case 'VS': {
        const fpm = v.get(AP.selVs);
        return join2(fpm >= 0 ? join2('↑', fmtInt(fpm)) : join2('↓', fmtInt(-fpm)), 'FPM');
      }
      case 'ALT':
        return join2(fmtInt(Math.round(v.get('ap.alt_ref_ft', v.get(AP.selAltitude)) / 10) * 10), 'FT');
      case 'ALTS':
        // "The Selected Altitude is shown as the Altitude Reference beside the 'ALTS' annunciation" (PG §7.3).
        return join2(fmtInt(v.get(AP.selAltitude)), 'FT');
      case 'ALTV':
        return join2(fmtInt(v.get(FMS.vnavTargetAltFt)), 'FT');
      case 'FLC':
        return join2(fmtInt(v.get(AP.selSpeed)), 'KT');
      default:
        // PIT, LVL, VPTH, GS, GP, GA: no reference in the status box (PG Table 7-2).
        return '';
    }
  }

  // ================================================================ MFD data bar

  /** Navigation data bar (four fields) and the page title. */
  drawMfdDataBar(ctx: Ctx2D, fields: readonly string[], title: string): void {
    const x0 = NAV_BOX_W + 8;
    const w = COM_BOX_X - NAV_BOX_W - 16;
    const fw = w / 4;
    for (let i = 0; i < 4; i++) {
      const f = fields[i] ?? '';
      const x = x0 + fw * i + fw / 2;
      TF.draw(ctx, f, x - 6, 20, 13, P.white, 'right', 'middle');
      TF.draw(ctx, this.fieldValue(f), x, 20, 17, P.magenta, 'left', 'middle');
    }
    TF.draw(ctx, title, (NAV_BOX_W + COM_BOX_X) / 2, 44, 16, P.cyan, 'center', 'middle');
  }

  /** MFD data bar field values (PG §1.5 "MFD Data Bar Fields"). */
  fieldValue(f: string): string {
    const v = this.sys.vars;
    const leg = v.get(FMS.activeLegIndex, -1) >= 0;
    const gps = v.get(GPS.valid) >= 0.5;
    const trueRef = v.get(G1K.navAngleTrue) >= 0.5;
    const ang = (mag: number): string => fmtDeg(trueRef ? wrap360(mag + v.get(GPS.magVar)) : mag);
    switch (f) {
      case 'GS':
        return gps ? join2(fmtInt(v.get(GPS.gs)), 'KT') : '___KT';
      case 'TRK':
        return gps && v.get(GPS.gs) > 5 ? ang(v.get(GPS.trackMag)) : '___°';
      case 'DTK':
        return leg ? ang(v.get(FMS.dtkMag)) : '___°';
      case 'BRG':
        return leg ? ang(v.get(FMS.bearingToWptMag)) : '___°';
      case 'DIS':
        return leg ? join2(fmtDist(v.get(FMS.distToWptNm)), 'NM') : '__._NM';
      case 'ETE':
        return leg && v.get(GPS.gs) > 5 ? fmtHms(v.get(FMS.eteToWptS)) : '__:__';
      case 'ETA': {
        const e = v.get(FMS.eteToWptS);
        return leg && Number.isFinite(e) && v.get(GPS.gs) > 5 ? fmtHms(((v.get(GPS.utcH) * 3600 + e) % 86400 + 86400) % 86400, true) : '__:__';
      }
      case 'XTK':
        return leg ? join2(fmtDist(Math.abs(v.get(FMS.xtkNm))), 'NM') : '__._NM';
      case 'TKE': {
        const d = wrap360(v.get(GPS.trackMag) - v.get(FMS.dtkMag) + 180) - 180;
        return leg && gps ? join2(fmtInt(Math.abs(d)), d >= 0 ? '°R' : '°L') : '___°';
      }
      case 'TAS':
        return join2(fmtInt(v.get('adc1.tas_kt')), 'KT');
      case 'VSR':
        return v.get(FMS.vnavValid) >= 0.5 ? join2(fmtInt(v.get(FMS.vsRequiredFpm)), 'FPM') : '____FPM';
      case 'FOB':
        return join2(fmtFixed(v.get(G1K.fuelRemGal), 1), 'GL');
      case 'FOD': {
        const kg = v.get(FMS.fuelDestKg, NaN);
        return Number.isFinite(kg) ? join2(fmtFixed(kg / 2.7216, 1), 'GL') : '__._GL';
      }
      case 'END': {
        const ff = v.get('eng1.ff_gph');
        return ff > 0.5 ? fmtHms((v.get(G1K.fuelRemGal) / ff) * 3600) : '__:__';
      }
      default:
        return '';
    }
  }
}
