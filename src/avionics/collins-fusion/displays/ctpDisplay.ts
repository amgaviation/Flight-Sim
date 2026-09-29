/**
 * Control Tuning Panel (CTP-6000) display, one per pilot on the glareshield
 * (FSB BD-700-1A10 Rev 7 appendix 6: "Comm radios controlled at two (2)
 * Control Tuning Panels (CTP) on glareshield"; "CTP is the primary panel for
 * PFD selection"; "Standby HSI on CTP").
 *
 * Pages (logic/ctp.ts): RADIO (COM / NAV / ADF on the left line keys, ATC /
 * COM 3 / DME on the right), PFD (NAV SRC, BRG 1 / 2, SVS, HSI format, baro
 * unit, with the baro and minimums settings) and the standby HSI. Display
 * size 480 x 240 logical px and the page layouts are EST (no public CTP
 * drawing); line key rows at y = 48, 120, 192 match the hardware keys in
 * cockpit.ts. Colours (EST, Collins convention): active frequencies green,
 * standby / preset cyan, the selected line framed cyan.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { Hsi, HSI_COLLINS } from '../../common/draw/Hsi';
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, NAV } from '../../../core/vars';
import type { FusionSensors } from '../config';
import { CtpPage, RADIO_LINES, XPDR_MODE_NAMES } from '../logic/ctp';
import { BrgSrc, FUSION_VARS, NavSrc } from '../vars';
import { C, fstr, hstr, istr, rect, seg, txt } from './style';

export const CTP_W = 480;
export const CTP_H = 240;
/** Centre y of the three line select rows. */
export const CTP_ROWS: readonly number[] = [48, 120, 192];

const NAVSRC_NAMES = ['FMS', 'VOR 1', 'VOR 2'];
const NAVSRC_LOC = ['FMS', 'LOC 1', 'LOC 2'];
const BRG_NAMES = ['OFF', 'VOR', 'ADF', 'FMS'];
const SQUAWK: string[] = [];
for (let i = 0; i <= 7777; i++) SQUAWK.push(i.toString().padStart(4, '0'));

export interface CtpDisplayOptions {
  id: string;
  side: 1 | 2;
  vars: SimVars;
  sensors: FusionSensors;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** (Appended by global6000.) TUNE reversion var (0 NORM / 1 VHF / 2 DSPL): non-NORM is annunciated on the RADIO page. */
  tuneReversionVar?: string;
}

export class CtpDisplay extends CanvasDisplay {
  readonly side: 1 | 2;
  private readonly v: SimVars;
  private readonly sn: FusionSensors;
  private readonly tuneRevVar?: string;
  private readonly hsi = new Hsi({ cx: 240, cy: 136, radius: 86, style: { ...HSI_COLLINS, labelSize: 13 }, mode: 'rose', wind: null });

  constructor(o: CtpDisplayOptions) {
    super({ id: o.id, width: CTP_W, height: CTP_H, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 15 });
    this.side = o.side;
    this.v = o.vars;
    this.sn = o.sensors;
    this.tuneRevVar = o.tuneReversionVar;
    this.animating = true;
  }

  protected override update(dt: number): void {
    if (this.v.get(FUSION_VARS.ctpPage(this.side)) === CtpPage.Hsi) this.updateHsi(dt);
  }

  protected override draw(ctx: Ctx2D): void {
    const p = this.v.get(FUSION_VARS.ctpPage(this.side));
    if (p === CtpPage.Pfd) this.drawPfd(ctx);
    else if (p === CtpPage.Hsi) this.drawHsi(ctx);
    else this.drawRadio(ctx);
  }

  // ------------------------------------------------------------ RADIO

  private drawRadio(ctx: Ctx2D): void {
    const v = this.v;
    const s = this.side;
    const sel = RADIO_LINES[Math.max(0, Math.min(5, v.get(FUSION_VARS.ctpSel(s))))];
    const nav = this.sn.nav[s - 1];
    const adf = this.sn.adf[s - 1];
    // Left column.
    this.freqLine(ctx, 0, s === 1 ? 'COM 1' : 'COM 2', v.get(NAV.comActive(s)), v.get(NAV.comStandby(s)), 3, sel === 'COM', 'left');
    this.freqLine(ctx, 1, s === 1 ? 'NAV 1' : 'NAV 2', v.get(NAV.activeFreq(nav)), v.get(NAV.standbyFreq(nav)), 2, sel === 'NAV', 'left');
    if (v.getBool(NAV.dmeHold(nav))) txt(ctx, 'H', 226, CTP_ROWS[1] - 10, 14, C.amber, 'center');
    this.freqLine(ctx, 2, s === 1 ? 'ADF 1' : 'ADF 2', v.get(NAV.adfActive(adf)), v.get(NAV.adfStandby(adf)), 0, sel === 'ADF', 'left');
    // Right column: ATC, COM 3, DME.
    const y0 = CTP_ROWS[0];
    txt(ctx, 'ATC', 468, y0 - 24, 12, C.grey, 'right');
    const code = Math.max(0, Math.min(7777, Math.round(v.get(NAV.xpdrCode))));
    if (sel === 'ATC') rect(ctx, 356, y0 - 14, 116, 30, '', C.cyan, 2);
    txt(ctx, SQUAWK[code], 466, y0 + 1, 22, C.green, 'right');
    const mode = Math.round(v.get(NAV.xpdrMode));
    txt(ctx, XPDR_MODE_NAMES[mode] ?? '', 350, y0 + 1, 13, mode <= 1 ? C.white : C.green, 'right');
    if (v.getBool(NAV.xpdrIdent)) txt(ctx, 'IDENT', 466, y0 + 26, 12, C.green, 'right');
    this.freqLine(ctx, 1, 'COM 3', v.get(NAV.comActive(3)), v.get(NAV.comStandby(3)), 3, sel === 'COM3', 'right');
    const y2 = CTP_ROWS[2];
    txt(ctx, 'DME', 468, y2 - 24, 12, C.grey, 'right');
    txt(ctx, v.getBool(NAV.dmeHold(nav)) ? 'HOLD' : 'NORM', 466, y2 + 1, 18, v.getBool(NAV.dmeHold(nav)) ? C.amber : C.white, 'right');
    seg(ctx, 240, 8, 240, CTP_H - 8, C.line, 1);
    // TUNE reversion (GX PTG 16): the pedestal selector has moved tuning to the standby VHF / display path - the CTP
    // annunciates the selected source (amber) and its radio tuning is inhibited (logic/ctp.ts).
    if (this.tuneRevVar !== undefined) {
      const rev = Math.round(v.get(this.tuneRevVar));
      if (rev >= 1) txt(ctx, rev >= 2 ? 'TUNE DSPL' : 'TUNE VHF', 240, 14, 14, C.amber, 'center');
    }
  }

  /** Frequency line: label, active (green, large) and standby (cyan). */
  private freqLine(ctx: Ctx2D, row: number, label: string, act: number, stby: number, dec: number, selected: boolean, col: 'left' | 'right'): void {
    const y = CTP_ROWS[row];
    const left = col === 'left';
    const x0 = left ? 12 : 252;
    txt(ctx, label, left ? x0 : 468, y - 24, 12, C.grey, left ? 'left' : 'right');
    txt(ctx, Number.isFinite(act) ? (dec > 0 ? fstr(act, dec) : istr(act)) : '---', x0, y + 1, 22, C.green, 'left');
    const sx = x0 + 112;
    if (selected) rect(ctx, sx - 4, y - 14, 106, 30, '', C.cyan, 2);
    txt(ctx, Number.isFinite(stby) ? (dec > 0 ? fstr(stby, dec) : istr(stby)) : '---', sx, y + 1, 18, C.cyan, 'left');
  }

  // ------------------------------------------------------------ PFD

  private drawPfd(ctx: Ctx2D): void {
    const v = this.v;
    const s = this.side;
    const src = Math.round(v.get(FUSION_VARS.navSource(s)));
    const rx = src === NavSrc.Fms ? 0 : this.sn.nav[src - 1];
    const loc = rx > 0 && v.getBool(NAV.isLoc(rx));
    this.item(ctx, 0, 'left', 'NAV SRC', (loc ? NAVSRC_LOC : NAVSRC_NAMES)[src] ?? 'FMS', src === NavSrc.Fms ? C.magenta : src === (s === 1 ? NavSrc.Nav2 : NavSrc.Nav1) ? C.amber : C.green);
    this.item(ctx, 1, 'left', 'BRG 1', BRG_NAMES[Math.round(v.get(FUSION_VARS.brg(s, 1)))] ?? 'OFF', v.get(FUSION_VARS.brg(s, 1)) === BrgSrc.Off ? C.white : C.cyan);
    this.item(ctx, 2, 'left', 'BRG 2', BRG_NAMES[Math.round(v.get(FUSION_VARS.brg(s, 2)))] ?? 'OFF', v.get(FUSION_VARS.brg(s, 2)) === BrgSrc.Off ? C.white : C.cyan);
    this.item(ctx, 0, 'right', 'SVS', v.getBool(FUSION_VARS.svs(s)) ? 'ON' : 'OFF', v.getBool(FUSION_VARS.svs(s)) ? C.green : C.white);
    this.item(ctx, 1, 'right', 'HSI', v.getBool(FUSION_VARS.hsiRose(s)) ? 'ROSE' : 'ARC', C.green);
    this.item(ctx, 2, 'right', 'BARO', v.getBool(FUSION_VARS.baroHpa(s)) ? 'HPA' : 'IN', C.green);
    // Centre: baro setting and minimums.
    const adc = this.sn.adc[s - 1];
    const std = v.getBool(ADC.baroStd(adc));
    const inHg = v.get(ADC.baroSetting(adc), 29.92);
    txt(ctx, 'BARO', 240, 60, 12, C.grey, 'center');
    const hpa = v.getBool(FUSION_VARS.baroHpa(s));
    txt(ctx, std ? 'STD' : hpa ? istr(inHg * 33.8639) : fstr(inHg, 2), 240, 84, 22, C.cyan, 'center');
    const minsRa = v.getBool(AP.minimumsIsRadio(s));
    txt(ctx, minsRa ? 'RA MINS' : 'BARO MINS', 240, 144, 12, C.grey, 'center');
    txt(ctx, istr(v.get(AP.minimums(s))), 240, 168, 22, C.cyan, 'center');
  }

  private item(ctx: Ctx2D, row: number, col: 'left' | 'right', label: string, value: string, color: string): void {
    const y = CTP_ROWS[row];
    const left = col === 'left';
    txt(ctx, label, left ? 12 : 468, y - 14, 12, C.grey, left ? 'left' : 'right');
    txt(ctx, value, left ? 12 : 468, y + 8, 18, color, left ? 'left' : 'right');
  }

  // ------------------------------------------------------------ standby HSI

  private updateHsi(dt: number): void {
    const v = this.v;
    const s = this.side;
    const ahrs = v.get(FUSION_VARS.ahrsSrc(s), this.sn.ahrs[s - 1]);
    const h = this.hsi.state;
    h.valid = v.get(ADC.ahrsValid(ahrs), 1) >= 0.5;
    h.heading = v.get(ADC.heading(ahrs));
    h.selectedHeading = v.get(AP.selHeading, NaN);
    const src = Math.round(v.get(FUSION_VARS.navSource(s)));
    if (src === NavSrc.Fms) {
      h.courseVisible = v.get(FMS.activeLegIndex, -1) >= 0;
      h.course = v.get(FMS.dtkMag);
      h.courseColor = C.magenta;
      h.cdiValid = v.getBool(FMS.lnavValid);
      h.cdi = v.get(FMS.cdi);
      h.toFrom = v.get(FMS.toFrom, 1);
    } else {
      const rx = this.sn.nav[src - 1] ?? 1;
      h.courseVisible = true;
      h.course = v.get(NAV.obs(rx), v.get(AP.selCourse(s)));
      h.courseColor = C.green;
      h.cdiValid = v.getBool(NAV.received(rx));
      h.cdi = v.get(NAV.cdi(rx));
      h.toFrom = v.getBool(NAV.isLoc(rx)) ? 0 : v.get(NAV.toFrom(rx));
    }
    h.courseDouble = src === NavSrc.Nav2;
    h.xtkNm = NaN;
    h.sourceLabel = '';
    h.phaseLabel = '';
    h.bearing1.visible = false;
    h.bearing2.visible = false;
    h.windValid = false;
    this.hsi.update(dt);
  }

  private drawHsi(ctx: Ctx2D): void {
    this.hsi.draw(ctx);
    const v = this.v;
    const src = Math.round(v.get(FUSION_VARS.navSource(this.side)));
    txt(ctx, 'STBY HSI', 12, 20, 12, C.grey, 'left');
    txt(ctx, NAVSRC_NAMES[src] ?? 'FMS', 12, 40, 15, src === NavSrc.Fms ? C.magenta : C.green, 'left');
    txt(ctx, 'CRS', 468, 20, 12, C.grey, 'right');
    txt(ctx, hstr(this.hsi.state.course), 468, 40, 15, this.hsi.state.courseColor, 'right');
  }
}
