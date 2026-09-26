/**
 * Symmetry touch-screen controller (TSC) applications.
 *
 * The G500/G600/G700/G800 flight deck has touch screen controllers instead
 * of the PlaneView display controllers, MCDUs and radio tuning panels
 * (G600 specification sheet: "5 Touch Screen Controllers"; BJT G500 pilot
 * report: TSCs "provide access to the FMS, radios, checklists, synoptics
 * and display control"). Apps modelled here (EST page layouts, 800 x 480
 * logical px below a 48 px title bar):
 *  - HOME: application tiles.
 *  - RADIOS: COM 1-3, NAV 1-2, ADF, HF 1-2 active / standby with swap and
 *    a numeric keypad (same vars as the PlaneView MCDU RADIO pages).
 *  - FMS: the Honeywell FMS CDU hosted on the touch screen (an `Mcdu`
 *    instance: soft line-select keys, function keys, keyboard).
 *  - CHECKLIST: the electronic checklist (ChecklistLogic).
 *  - DISPLAY: the display-controller pages (DisplayControllerLogic) as
 *    touch buttons, plus the SET knob as - / +.
 *  - SYNOPTIC: selects synoptics / windows on the side's MFD.
 *  - GUIDANCE: touch guidance / tuning of the flight guidance targets and
 *    modes (duplicates the GP-700 functions through GuidancePanelLogic).
 *  - WEATHER: radar mode, tilt and gain; XPDR/TCAS: code, mode, IDENT;
 *    UTILITY: chronometer and display brightness.
 * Every widget writes the same SimVars / events as the corresponding
 * PlaneView hardware.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AP, NAV } from '../../../core/vars';
import { DISPLAY_VARS } from '../../../cockpit/types';
import { fmtFixed, fmtInt } from '../../common/format';
import { C, textBold } from '../style';
import { EPIC_EVENTS, EPIC_VARS, SYNOPTIC_WINDOWS, WIN_NAMES, Win, MapOverlay } from '../vars';
import { cell, type TouchPage, type TouchScreenLogic, type TouchWidget } from '../logic/touch';
import type { DisplayControllerLogic, DcLine } from '../logic/controller';
import { DC_MENU } from '../logic/controller';
import { GP_LIGHTS, type GpControl, type GuidancePanelLogic } from '../logic/guidance';
import type { ChecklistLogic } from '../logic/checklist';
import type { WindowManager } from '../logic/windows';
import type { Mcdu } from '../fms/mcdu';
import { parseAdfFreq, parseComFreq, parseHfFreq, parseNavFreq, parseSquawk } from '../fms/cdu';
import { drawCduScreen } from '../displays/mcduDisplay';
import type { EpicResolvedConfig } from '../config';

export const TSC_W = 800;
export const TSC_H = 480;
export const TSC_TITLE_H = 48;
const TOP = TSC_TITLE_H + 8;

export interface TscServices {
  vars: SimVars;
  events: EventBus;
  cfg: EpicResolvedConfig;
  dc: DisplayControllerLogic;
  gp: GuidancePanelLogic;
  checklist: ChecklistLogic;
  windows: WindowManager;
  /** FMS app instance of this TSC (null = no FMS app). */
  mcdu: Mcdu | null;
  /** Side of the TSC (display control / synoptics / chronometer). */
  side: 1 | 2;
  /** Display ids whose brightness the UTILITY page adjusts. */
  brightnessIds: readonly string[];
}

/** Returns the page list; `logic()` gives access to the navigation (set by the caller after construction). */
export function buildTscPages(s: TscServices, logic: () => TouchScreenLogic): TouchPage[] {
  const v = s.vars;
  const pages: TouchPage[] = [];
  const show = (id: string) => () => void logic().show(id);

  // ------------------------------------------------------------ HOME
  const apps: readonly [string, string][] = [
    ['RADIOS', 'Radios'],
    ['FMS', 'FMS'],
    ['CHECKLIST', 'Checklist'],
    ['DISPLAY', 'Display Control'],
    ['SYNOPTIC', 'Synoptics'],
    ['GUIDANCE', 'Guidance'],
    ['WEATHER', 'Weather Radar'],
    ['XPDR', 'XPDR / TCAS'],
    ['UTILITY', 'Utility'],
  ];
  pages.push({
    id: 'HOME',
    title: s.side === 1 ? 'Pilot TSC' : 'Copilot TSC',
    widgets: apps.map(([id, label], i) => ({ id: `home.${id}`, kind: 'tile', ...cell(20, TOP + 6, TSC_W - 40, TSC_H - TOP - 20, 3, 3, i % 3, Math.floor(i / 3), 16), label, tap: show(id), size: 20, disabled: id === 'FMS' && !s.mcdu ? () => true : undefined }) as TouchWidget),
  });

  // ------------------------------------------------------------ keypad (shared entry page)
  const kp = { title: '', entry: '', parse: (_t: string): number => NaN, target: '', back: 'RADIOS', allowed: '0123456789.' };
  const openKeypad = (title: string, parse: (t: string) => number, target: string, back: string, allowed = '0123456789.'): void => {
    kp.title = title;
    kp.entry = '';
    kp.parse = parse;
    kp.target = target;
    kp.back = back;
    kp.allowed = allowed;
    logic().show('KEYPAD');
  };
  const kpKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'CLR'];
  const kpWidgets: TouchWidget[] = kpKeys.map((k, i) => ({
    id: `kp.${k}`,
    kind: 'key',
    ...cell(250, TOP + 90, 300, 300, 3, 4, i % 3, Math.floor(i / 3), 8),
    label: k,
    size: 22,
    disabled: k !== 'CLR' ? () => !kp.allowed.includes(k) : undefined,
    tap: () => {
      if (k === 'CLR') kp.entry = kp.entry.slice(0, -1);
      else if (kp.entry.length < 8) kp.entry += k;
    },
  }));
  kpWidgets.push(
    { id: 'kp.enter', kind: 'button', x: 570, y: TOP + 90, w: 180, h: 70, label: 'ENTER', size: 20, tap: () => {
      const f = kp.parse(kp.entry);
      if (Number.isFinite(f)) {
        v.set(kp.target, f);
        logic().show(kp.back, false);
      } else kp.entry = '';
    } },
    { id: 'kp.cancel', kind: 'button', x: 570, y: TOP + 170, w: 180, h: 70, label: 'CANCEL', size: 20, tap: () => void logic().show(kp.back, false) },
  );
  pages.push({
    id: 'KEYPAD',
    title: 'Enter',
    widgets: kpWidgets,
    draw: (ctx) => {
      textBold(ctx, kp.title, TSC_W / 2, TOP + 20, 20, C.white, 'center', 'middle');
      ctx.fillStyle = C.black;
      ctx.fillRect(250, TOP + 38, 300, 44);
      textBold(ctx, kp.entry || '_', 540, TOP + 61, 28, C.cyan, 'right', 'middle');
    },
  });

  // ------------------------------------------------------------ RADIOS
  interface RadioDef {
    label: string;
    active: string;
    standby: string | null;
    dec: 0 | 1 | 2 | 3;
    parse: (t: string) => number;
  }
  const radios: RadioDef[] = [];
  for (let r = 1; r <= Math.min(3, s.cfg.sensors.comCount); r++) radios.push({ label: `COM ${r}`, active: NAV.comActive(r), standby: NAV.comStandby(r), dec: 3, parse: parseComFreq });
  for (let r = 1; r <= Math.min(2, s.cfg.sensors.navCount); r++) radios.push({ label: `NAV ${r}`, active: NAV.activeFreq(r), standby: NAV.standbyFreq(r), dec: 2, parse: parseNavFreq });
  for (let r = 1; r <= Math.min(2, s.cfg.sensors.adfCount); r++) radios.push({ label: `ADF ${r}`, active: NAV.adfActive(r), standby: NAV.adfStandby(r), dec: 1, parse: parseAdfFreq });
  radios.push({ label: 'HF 1', active: EPIC_VARS.hfFreq(1), standby: null, dec: 0, parse: parseHfFreq }, { label: 'HF 2', active: EPIC_VARS.hfFreq(2), standby: null, dec: 0, parse: parseHfFreq });
  const radioWidgets: TouchWidget[] = [];
  const rows = Math.ceil(radios.length / 2);
  radios.forEach((rd, i) => {
    const c = cell(10, TOP, TSC_W - 20, TSC_H - TOP - 10, 2, rows, Math.floor(i / rows), i % rows, 10);
    const fmt = (n: string): string => {
      const x = v.get(n);
      return x > 0 ? fmtFixed(x, rd.dec) : '---';
    };
    radioWidgets.push({ id: `rad.${i}.lbl`, kind: 'label', x: c.x + 4, y: c.y, w: 70, h: c.h, label: rd.label, size: 16 });
    radioWidgets.push({ id: `rad.${i}.act`, kind: 'value', x: c.x + 76, y: c.y, w: (c.w - 76) * 0.4, h: c.h, label: 'ACTIVE', sub: () => fmt(rd.active), color: () => C.green, size: 15, tap: rd.standby ? undefined : () => openKeypad(`${rd.label} frequency (kHz)`, rd.parse, rd.active, 'RADIOS') });
    if (rd.standby) {
      const sb = rd.standby;
      radioWidgets.push({ id: `rad.${i}.swap`, kind: 'button', x: c.x + 76 + (c.w - 76) * 0.4 + 6, y: c.y + c.h * 0.2, w: 46, h: c.h * 0.6, label: '<>', size: 16, tap: () => {
        const a = v.get(rd.active);
        v.set(rd.active, v.get(sb));
        v.set(sb, a);
      } });
      radioWidgets.push({ id: `rad.${i}.stby`, kind: 'button', x: c.x + 76 + (c.w - 76) * 0.4 + 58, y: c.y, w: c.w - 76 - (c.w - 76) * 0.4 - 58, h: c.h, label: 'STANDBY', sub: () => fmt(sb), size: 14, tap: () => openKeypad(`${rd.label} standby`, rd.parse, sb, 'RADIOS') });
    }
  });
  pages.push({ id: 'RADIOS', title: 'Radios', widgets: radioWidgets });

  // ------------------------------------------------------------ FMS (hosted MCDU)
  if (s.mcdu) {
    const m = s.mcdu;
    const scr = { x: 108, y: TOP + 2, w: 364, h: 300 };
    const rh = scr.h / 14;
    const fw: TouchWidget[] = [];
    for (let k = 1; k <= 6; k++) {
      const y = scr.y + rh * (2 * k + 0.55) - 17;
      fw.push({ id: `fms.L${k}`, kind: 'key', x: 20, y, w: 78, h: 34, label: '-', size: 18, tap: () => m.key(`L${k}`) });
      fw.push({ id: `fms.R${k}`, kind: 'key', x: 482, y, w: 78, h: 34, label: '-', size: 18, tap: () => m.key(`R${k}`) });
    }
    const fkeys = ['FPL', 'NAV', 'PERF', 'PROG', 'DIR', 'RADIO', 'MSG', 'MENU', 'PREV', 'NEXT'];
    fkeys.forEach((k, i) => fw.push({ id: `fms.${k}`, kind: 'key', ...cell(20, 364, 540, 104, 5, 2, i % 5, Math.floor(i / 5), 6), label: k, size: 15, tap: () => m.key(k) }));
    const kb = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./'.split('').concat(['+/-', 'SP', 'DEL', 'CLR']);
    kb.forEach((k, i) => fw.push({ id: `fms.k${i}`, kind: 'key', ...cell(572, TOP + 2, 220, TSC_H - TOP - 10, 6, 7, i % 6, Math.floor(i / 6), 4), label: k, size: k.length > 2 ? 11 : 15, tap: () => m.key(k) }));
    pages.push({
      id: 'FMS',
      title: 'FMS',
      widgets: fw,
      draw: (ctx) => {
        ctx.fillStyle = C.black;
        ctx.fillRect(scr.x - 4, scr.y - 2, scr.w + 8, scr.h + 6);
        drawCduScreen(ctx, m.screen, scr.x, scr.y, scr.w, scr.h);
      },
    });
  }

  // ------------------------------------------------------------ CHECKLIST
  const ecl = s.checklist;
  const cst = { first: 0 };
  const ITEM_ROWS = 7;
  const itemW: TouchWidget[] = [];
  for (let r = 0; r < ITEM_ROWS; r++) {
    const idx = (): number => cst.first + r;
    itemW.push({
      id: `ecl.${r}`,
      kind: 'toggle',
      x: 14,
      y: TOP + 40 + r * 50,
      w: 610,
      h: 44,
      label: () => {
        const l = ecl.current;
        if (l < 0) return ecl.lists[idx()]?.title ?? '';
        return ecl.lists[l].items[idx()]?.challenge ?? '';
      },
      sub: () => {
        const l = ecl.current;
        if (l < 0) return ecl.lists[idx()]?.phase ?? '';
        return ecl.lists[l].items[idx()]?.response ?? '';
      },
      on: () => ecl.current >= 0 && idx() < ecl.lists[ecl.current].items.length && ecl.itemDone(ecl.current, idx()),
      disabled: () => (ecl.current < 0 ? idx() >= ecl.lists.length : idx() >= ecl.lists[ecl.current].items.length),
      tap: () => {
        if (ecl.current < 0) ecl.select(idx());
        else ecl.toggle(idx());
      },
      size: 15,
    });
  }
  const eclBtn = (id: string, label: string, i: number, tap: () => void, on?: () => boolean): TouchWidget => ({ id, kind: 'button', x: 640, y: TOP + 40 + i * 52, w: 146, h: 46, label, tap, on, size: 15 });
  itemW.push(
    eclBtn('ecl.up', 'Scroll Up', 0, () => (cst.first = Math.max(0, cst.first - ITEM_ROWS + 1))),
    eclBtn('ecl.dn', 'Scroll Down', 1, () => (cst.first += ITEM_ROWS - 1)),
    eclBtn('ecl.next', 'Next List', 2, () => {
      ecl.next();
      cst.first = 0;
    }),
    eclBtn('ecl.prev', 'Prev List', 3, () => {
      ecl.prev();
      cst.first = 0;
    }),
    eclBtn('ecl.index', 'Index', 4, () => {
      ecl.select(-1);
      cst.first = 0;
    }),
    eclBtn('ecl.undo', 'Undo Items', 5, () => ecl.undo()),
    eclBtn('ecl.show', 'Show Items', 6, () => (ecl.showRemainingOnly = !ecl.showRemainingOnly), () => ecl.showRemainingOnly),
  );
  pages.push({
    id: 'CHECKLIST',
    title: 'Checklist',
    widgets: itemW,
    draw: (ctx) => {
      const l = ecl.current;
      textBold(ctx, l < 0 ? 'Checklist Index' : ecl.lists[l].title, 20, TOP + 16, 18, l >= 0 && ecl.isComplete(l) ? C.green : C.white, 'left', 'middle');
    },
  });

  // ------------------------------------------------------------ DISPLAY CONTROL
  const dcState: { lines: readonly DcLine[] } = { lines: [] };
  const dcW: TouchWidget[] = DC_MENU.map((p, i) => ({ id: `dc.tab.${p}`, kind: 'tab', ...cell(10, TOP, TSC_W - 20, 44, 10, 1, i, 0, 4), label: p === 'SYS' ? '1/6-2/3' : p, size: 13, on: () => s.dc.currentPage(s.side) === p, tap: () => s.dc.page(s.side, p) }) as TouchWidget);
  for (let k = 1; k <= 10; k++) {
    const left = k <= 5;
    const row = (k - 1) % 5;
    dcW.push({
      id: `dc.lsk${k}`,
      kind: 'button',
      x: left ? 20 : 410,
      y: TOP + 54 + row * 60,
      w: 370,
      h: 52,
      label: () => dcState.lines[k - 1]?.label || dcState.lines[k - 1]?.value || '',
      sub: () => (dcState.lines[k - 1]?.label ? dcState.lines[k - 1]?.value ?? '' : ''),
      on: () => !!dcState.lines[k - 1]?.selected,
      disabled: () => !dcState.lines[k - 1] || (!dcState.lines[k - 1].label && !dcState.lines[k - 1].value),
      tap: () => s.dc.lsk(s.side, k),
      size: 16,
    });
  }
  dcW.push(
    { id: 'dc.set-', kind: 'key', x: 250, y: TSC_H - 54, w: 140, h: 46, label: 'SET  -', size: 18, tap: () => s.dc.set(s.side, -1) },
    { id: 'dc.set+', kind: 'key', x: 410, y: TSC_H - 54, w: 140, h: 46, label: 'SET  +', size: 18, tap: () => s.dc.set(s.side, 1) },
  );
  pages.push({
    id: 'DISPLAY',
    title: 'Display Control',
    widgets: dcW,
    enter: () => {
      if (s.dc.currentPage(s.side) === 'MENU') s.dc.page(s.side, 'PFD');
    },
    draw: () => {
      dcState.lines = s.dc.render(s.side);
    },
  });

  // ------------------------------------------------------------ SYNOPTICS
  const syn = { slot: 'main' as 'main' | 'upper' | 'lower' };
  const mfd = s.side === 1 ? 2 : 3;
  const synW: TouchWidget[] = (['main', 'upper', 'lower'] as const).map((sl, i) => ({ id: `syn.slot.${sl}`, kind: 'tab', ...cell(10, TOP, 480, 44, 3, 1, i, 0, 6), label: sl === 'main' ? 'MFD 2/3' : sl === 'upper' ? 'Upper 1/6' : 'Lower 1/6', on: () => syn.slot === sl, tap: () => (syn.slot = sl), size: 15 }) as TouchWidget);
  const synList: Win[] = [...SYNOPTIC_WINDOWS, Win.Map, Win.Engine, Win.Engine2, Win.Cas, Win.Checklist, Win.WptList];
  synList.forEach((w, i) => {
    synW.push({
      id: `syn.${w}`,
      kind: 'button',
      ...cell(10, TOP + 56, TSC_W - 20, TSC_H - TOP - 66, 4, 5, i % 4, Math.floor(i / 4), 8),
      label: WIN_NAMES[w] ?? '',
      size: 15,
      on: () => {
        const sel = s.windows.selection(mfd);
        return (syn.slot === 'main' ? sel.main : syn.slot === 'upper' ? sel.upper : sel.lower) === w;
      },
      disabled: () => (syn.slot === 'main' ? w === Win.Engine || w === Win.Engine2 || w === Win.Cas || w === Win.WptList : w === Win.Map),
      tap: () => void s.windows.select(mfd, syn.slot, w),
    });
  });
  pages.push({ id: 'SYNOPTIC', title: s.side === 1 ? 'Synoptics - DU 2' : 'Synoptics - DU 3', widgets: synW });

  // ------------------------------------------------------------ GUIDANCE
  const gp = s.gp;
  const lit = (c: GpControl) => () => {
    const n = GP_LIGHTS[c];
    return !!n && v.get(n) !== 0;
  };
  const gw: TouchWidget[] = [];
  const target = (i: number, label: string, value: () => string, dec: () => void, inc: () => void, extra?: TouchWidget): void => {
    const y = TOP + 4 + i * 74;
    gw.push({ id: `g.${label}.v`, kind: 'value', x: 20, y, w: 200, h: 66, label, sub: value, color: () => C.cyan, size: 16 });
    gw.push({ id: `g.${label}.-`, kind: 'key', x: 230, y, w: 80, h: 66, label: '-', size: 26, tap: dec });
    gw.push({ id: `g.${label}.+`, kind: 'key', x: 320, y, w: 80, h: 66, label: '+', size: 26, tap: inc });
    if (extra) gw.push({ ...extra, x: 410, y, w: 90, h: 66 });
  };
  target(0, 'SPEED', () => `${gp.windows.speedLegend} ${gp.windows.speed}`, () => gp.turn('spd', -1), () => gp.turn('spd', 1), { id: 'g.spd.push', kind: 'button', x: 0, y: 0, w: 0, h: 0, label: 'IAS/M', size: 14, tap: () => gp.press('spd_push') });
  target(1, 'HEADING', () => gp.windows.heading, () => gp.turn('hdg', -1), () => gp.turn('hdg', 1), { id: 'g.hdg.push', kind: 'button', x: 0, y: 0, w: 0, h: 0, label: 'SYNC', size: 14, tap: () => gp.press('hdg_push') });
  const alt = { coarse: true };
  target(2, 'ALTITUDE', () => gp.windows.altitude, () => gp.turn(alt.coarse ? 'alt' : 'alt_fine', -1), () => gp.turn(alt.coarse ? 'alt' : 'alt_fine', 1), { id: 'g.alt.k', kind: 'toggle', x: 0, y: 0, w: 0, h: 0, label: () => (alt.coarse ? 'x1000' : 'x100'), on: () => alt.coarse, size: 14, tap: () => (alt.coarse = !alt.coarse) });
  target(3, 'VS / FPA', () => `${gp.windows.vsLegend} ${gp.windows.vsfpa}`, () => gp.turn('vs', -1), () => gp.turn('vs', 1));
  const crsVar = AP.selCourse(s.side);
  target(4, 'COURSE', () => fmtInt(v.get(crsVar)), () => gp.turn(s.side === 1 ? 'crs1' : 'crs2', -1), () => gp.turn(s.side === 1 ? 'crs1' : 'crs2', 1), { id: 'g.crs.push', kind: 'button', x: 0, y: 0, w: 0, h: 0, label: 'DCT', size: 14, tap: () => gp.press(s.side === 1 ? 'crs1_push' : 'crs2_push') });
  const modes: readonly [GpControl, string][] = [
    ['hdg_btn', 'HDG'],
    ['nav', 'NAV'],
    ['apr', 'APR'],
    ['bc', 'BC'],
    ['flch', 'FLCH'],
    ['vs_btn', 'VS'],
    ['fpa', 'FPA'],
    ['vnav', 'VNAV'],
    ['alt_btn', 'ALT'],
    ['lowbank', 'LO BANK'],
    ['ap', 'AP'],
    ['yd', 'YD'],
    ['at', 'A/T'],
    ['man', 'MAN'],
    [s.side === 1 ? 'fd1' : 'fd2', 'FD'],
    ['pfdcmd', 'PFD CMD'],
  ];
  modes.forEach(([id, label], i) => gw.push({ id: `g.m.${id}`, kind: 'toggle', ...cell(514, TOP + 4, TSC_W - 524, TSC_H - TOP - 14, 2, 8, i % 2, Math.floor(i / 2), 6), label, on: lit(id), tap: () => gp.press(id), size: 15 }));
  pages.push({ id: 'GUIDANCE', title: 'Guidance', widgets: gw });

  // ------------------------------------------------------------ WEATHER
  const wxModes = ['OFF', 'STBY', 'WX', 'GMAP'];
  const wx: TouchWidget[] = wxModes.map((m, i) => ({ id: `wx.${m}`, kind: 'toggle', ...cell(20, TOP + 10, 560, 70, 4, 1, i, 0, 10), label: m, on: () => v.get(EPIC_VARS.radarMode) === i, tap: () => v.set(EPIC_VARS.radarMode, i), size: 18 }) as TouchWidget);
  wx.push(
    { id: 'wx.tilt', kind: 'value', x: 20, y: TOP + 110, w: 200, h: 70, label: 'TILT', sub: () => `${fmtFixed(v.get(EPIC_VARS.radarTilt), 1)}°`, size: 16 },
    { id: 'wx.tilt-', kind: 'key', x: 230, y: TOP + 110, w: 80, h: 70, label: 'DN', size: 18, tap: () => v.set(EPIC_VARS.radarTilt, Math.max(-15, Math.round((v.get(EPIC_VARS.radarTilt) - 0.5) * 10) / 10)) },
    { id: 'wx.tilt+', kind: 'key', x: 320, y: TOP + 110, w: 80, h: 70, label: 'UP', size: 18, tap: () => v.set(EPIC_VARS.radarTilt, Math.min(15, Math.round((v.get(EPIC_VARS.radarTilt) + 0.5) * 10) / 10)) },
    { id: 'wx.gain', kind: 'value', x: 20, y: TOP + 200, w: 200, h: 70, label: 'GAIN', sub: () => (v.get(EPIC_VARS.radarGain) === 0 ? 'CAL' : fmtInt(v.get(EPIC_VARS.radarGain))), size: 16 },
    { id: 'wx.gain-', kind: 'key', x: 230, y: TOP + 200, w: 80, h: 70, label: '-', size: 22, tap: () => v.set(EPIC_VARS.radarGain, Math.max(-5, v.get(EPIC_VARS.radarGain) - 1)) },
    { id: 'wx.gain+', kind: 'key', x: 320, y: TOP + 200, w: 80, h: 70, label: '+', size: 22, tap: () => v.set(EPIC_VARS.radarGain, Math.min(5, v.get(EPIC_VARS.radarGain) + 1)) },
    { id: 'wx.cal', kind: 'button', x: 410, y: TOP + 200, w: 90, h: 70, label: 'CAL', size: 16, tap: () => v.set(EPIC_VARS.radarGain, 0) },
    { id: 'wx.map', kind: 'toggle', x: 20, y: TOP + 300, w: 380, h: 70, label: 'Weather on MFD map', on: () => v.get(EPIC_VARS.mapOverlay(s.side)) === MapOverlay.Weather, tap: () => v.set(EPIC_VARS.mapOverlay(s.side), v.get(EPIC_VARS.mapOverlay(s.side)) === MapOverlay.Weather ? MapOverlay.Off : MapOverlay.Weather), size: 16 },
  );
  pages.push({ id: 'WEATHER', title: 'Weather Radar', widgets: wx });

  // ------------------------------------------------------------ XPDR / TCAS
  const xModes: readonly [number, string][] = [
    [1, 'STBY'],
    [3, 'ALT'],
    [4, 'TA ONLY'],
    [5, 'TA/RA'],
  ];
  const xp: TouchWidget[] = xModes.map(([val, label], i) => ({ id: `xp.m${val}`, kind: 'toggle', ...cell(20, TOP + 110, 560, 64, 4, 1, i, 0, 10), label, on: () => v.get(NAV.xpdrMode) === val, tap: () => v.set(NAV.xpdrMode, val), size: 16 }) as TouchWidget);
  xp.push(
    { id: 'xp.code', kind: 'button', x: 20, y: TOP + 10, w: 260, h: 84, label: 'CODE', sub: () => fmtInt(v.get(NAV.xpdrCode)).padStart(4, '0'), size: 18, tap: () => openKeypad('Transponder code', parseSquawk, NAV.xpdrCode, 'XPDR', '01234567') },
    { id: 'xp.ident', kind: 'button', x: 300, y: TOP + 10, w: 160, h: 84, label: 'IDENT', on: () => v.get(NAV.xpdrIdent) !== 0, size: 18, tap: () => v.set(NAV.xpdrIdent, 1) },
    { id: 'xp.unit', kind: 'button', x: 480, y: TOP + 10, w: 150, h: 84, label: () => (v.get(EPIC_VARS.xpdrUnit, 1) === 2 ? 'ATC 2' : 'ATC 1'), size: 18, tap: () => v.set(EPIC_VARS.xpdrUnit, v.get(EPIC_VARS.xpdrUnit, 1) === 2 ? 1 : 2) },
    { id: 'xp.status', kind: 'value', x: 20, y: TOP + 200, w: 300, h: 70, label: 'TCAS', sub: () => v.getString('tcas.status') || '---', size: 16 },
    { id: 'xp.test', kind: 'button', x: 340, y: TOP + 200, w: 160, h: 70, label: 'TCAS TEST', size: 16, tap: () => s.events.emit('tcas.test') },
  );
  pages.push({ id: 'XPDR', title: 'XPDR / TCAS', widgets: xp });

  // ------------------------------------------------------------ UTILITY
  const ut: TouchWidget[] = [
    { id: 'ut.chrono', kind: 'value', x: 20, y: TOP + 10, w: 260, h: 90, label: 'CHRONOMETER', sub: () => fmtChrono(v.get(EPIC_VARS.chronoS(s.side))), size: 18 },
    { id: 'ut.ss', kind: 'button', x: 300, y: TOP + 10, w: 150, h: 90, label: () => (v.get(EPIC_VARS.chronoRun(s.side)) !== 0 ? 'STOP' : 'START'), size: 18, tap: () => s.events.emit(EPIC_EVENTS.chrono(s.side), 'startstop') },
    { id: 'ut.rst', kind: 'button', x: 470, y: TOP + 10, w: 150, h: 90, label: 'RESET', size: 18, tap: () => s.events.emit(EPIC_EVENTS.chrono(s.side), 'reset') },
  ];
  s.brightnessIds.forEach((id, i) => {
    const n = DISPLAY_VARS.brightness(id);
    const y = TOP + 130 + i * 70;
    ut.push(
      { id: `ut.b${i}`, kind: 'value', x: 20, y, w: 260, h: 60, label: `${(id.split('.').pop() ?? id).toUpperCase().replace(/^DU/, 'DU ')} BRIGHTNESS`, sub: () => `${fmtInt(v.get(n, 1) * 100)} %`, size: 14 },
      { id: `ut.b${i}-`, kind: 'key', x: 300, y, w: 80, h: 60, label: '-', size: 22, tap: () => v.set(n, Math.max(0.1, Math.round((v.get(n, 1) - 0.1) * 10) / 10)) },
      { id: `ut.b${i}+`, kind: 'key', x: 390, y, w: 80, h: 60, label: '+', size: 22, tap: () => v.set(n, Math.min(1, Math.round((v.get(n, 1) + 0.1) * 10) / 10)) },
    );
  });
  pages.push({ id: 'UTILITY', title: 'Utility', widgets: ut });

  return pages;
}

function fmtChrono(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '00:00';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}
