/**
 * SYSTEMS window: the Global synoptic pages (STATUS, AC / DC ELECTRICAL,
 * FUEL, HYDRAULIC, FLIGHT CONTROLS, BLEED, ANTI-ICE, AIR COND / PRESS and
 * DOORS) with a page tab bar that the CCP cursor selects.
 *
 * Content and colour logic follow the Bombardier Global Express training
 * manuals (the Global Vision synoptics keep the Global Express system
 * pages; FSB BD-700-1A10 Rev 7 appendix 6 lists "Synoptic pages" among the
 * Global Vision differences only for their new window placement):
 *  - GX Electrical, "EICAS philosophy / electrical system logic": buses
 *    POWERED, MAN OFF or SHED, FAILED, INVALID; generators OPERATING, NOT
 *    OPERATING, FAILED, INVALID; AC page GEN 1-4 / APU GEN V, KVA, HZ; AC BUS
 *    1-4, AC ESS, RAT GEN, EXT AC; DC page TRU 1 / 2, ESS TRU 1 / 2 V and A,
 *    DC BUS 1 / 2, DC ESS, BATT BUS, DC EMER, AV BATT and APU BATT with V, A,
 *    temperature and the CHARGER message.
 *  - GX Hydraulics, hydraulic synoptic: pressure readout green 1800-3200
 *    psi, amber <= 1800, white > 3200; flow lines green > 1800 psi, amber low;
 *    fluid quantity in 2 % steps; temperature amber >= 96 C; system
 *    distribution table white (pressure > 1800 psi) or amber (inoperative);
 *    INBD BRAKES psi green 1800-3200, OUTBD BRAKES NORM (green > 1400 psi) /
 *    LO PRESS (amber); RAT pump drawn only when the RAT is deployed.
 *  - GX Fuel, fuel synoptic: wing, AUX (centre) and aft tanks with
 *    quantities, wing tank temperatures, TOTAL FUEL, FUEL USED, LO PRESS
 *    legends, pump symbols "P", crossfeed / feed shutoff valves.
 *  - GX Flight Controls: ailerons, elevators, rudder, four multifunction
 *    spoilers and the ground spoilers per side, FLAP angle, SLAT IN / OUT
 *    (green at commanded position, white in transit, amber failed).
 *  - GX Landing Gear: brake temperature index 00-05 green, 06-16 white,
 *    17-39 red (STATUS page). GX APU: APU RPM and EGT on the STATUS page.
 *  - GX Airplane General: doors on the STATUS page (passenger, emergency
 *    exit, baggage, service doors).
 * Geometry, the valve / pump symbol drawings and the flow-line topology are
 * EST (drawn from the training-manual figures, not to scale).
 */
import type { SimVars } from '../../../core/SimVars';
import type { Ctx2D } from '../../common/draw/context';
import type { FusionResolvedConfig } from '../config';
import type { ShownWindow } from '../logic/layout';
import type { FusionCas } from '../logic/cas';
import type { SynopticReadouts } from '../logic/readouts';
import { FUSION_VARS, SYS_PAGE_COUNT, SYS_PAGE_TABS, SYS_PAGE_TITLES, SysPage } from '../vars';
import { C, fstr, istr, rect, seg, txt } from './style';
import type { HotSpots, MenuItem, WindowRenderer } from './window';

/** Design space of a page (scaled to the window). */
const PW = 500;
const PH = 560;
const TAB_H = 26;
const KG_TO_LB = 2.20462;

const TAB_IDS: readonly string[] = SYS_PAGE_TABS.map((_, i) => `tab:${i}`);
const DASH = '---';

/** Colour of a boolean state: true -> on colour, false -> off colour, null (invalid) -> amber. */
function stateColor(s: boolean | null, on: string = C.green, off: string = C.white): string {
  return s === null ? C.amber : s ? on : off;
}

// -------------------------------------------------------------------- symbols

/** Bus bar box: powered green, MAN OFF / SHED white with legend, unpowered / failed amber (EST shades). */
function busBox(ctx: Ctx2D, x: number, y: number, w: number, h: number, label: string, powered: boolean | null, legend = ''): void {
  const col = powered === null ? C.amber : powered ? C.green : legend ? C.white : C.amber;
  rect(ctx, x, y, w, h, C.bg, col, 2);
  txt(ctx, label, x + w / 2, y + h / 2 + 1, 14, col, 'center');
  if (legend) txt(ctx, legend, x + w / 2, y + h + 11, 12, C.white, 'center');
}

/** Source box (generator, TRU, battery): operating green, off white, failed amber. */
function sourceBox(ctx: Ctx2D, x: number, y: number, w: number, h: number, label: string, on: boolean | null, failed: boolean | null): void {
  const col = failed ? C.amber : stateColor(on);
  rect(ctx, x, y, w, h, C.bg, col, 2);
  txt(ctx, label, x + w / 2, y + h / 2 + 1, 14, col, 'center');
}

/** Numeric readout with unit; NaN draws amber dashes (invalid data). */
function readout(ctx: Ctx2D, x: number, y: number, v: number, decimals: number, unit: string, color: string = C.green, size = 14): void {
  if (Number.isFinite(v)) txt(ctx, decimals > 0 ? fstr(v, decimals) : istr(v), x, y, size, color, 'right');
  else txt(ctx, DASH, x, y, size, C.amber, 'right');
  if (unit) txt(ctx, unit, x + 4, y, 11, C.cyan, 'left');
}

/** Flow line (polyline in design units). */
function flow(ctx: Ctx2D, color: string, x0: number, y0: number, x1: number, y1: number, x2 = NaN, y2 = NaN, x3 = NaN, y3 = NaN): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  if (Number.isFinite(x2)) ctx.lineTo(x2, y2);
  if (Number.isFinite(x3)) ctx.lineTo(x3, y3);
  ctx.stroke();
}

/**
 * Valve symbol: circle with a bar in line with the flow (open, green) or
 * across it (closed, white); invalid amber with an X (GX valve logic: OPEN,
 * CLOSED, TRANSIT, INVALID, FAILED; shades EST).
 */
function valve(ctx: Ctx2D, x: number, y: number, open: boolean | null, horizontalFlow: boolean, failed = false): void {
  const col = open === null || failed ? C.amber : open ? C.green : C.white;
  ctx.fillStyle = C.bg;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (open === null) {
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x - 6, y + 6);
  } else if (open === horizontalFlow) {
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
  } else {
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
  }
  ctx.stroke();
}

/** Pump symbol: circle with its label; on green, off white, low pressure / failed amber. */
function pump(ctx: Ctx2D, x: number, y: number, label: string, on: boolean | null, lowPress: boolean | null, r = 13): void {
  const col = on === null ? C.amber : on && lowPress ? C.amber : on ? C.green : C.white;
  ctx.fillStyle = C.bg;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  txt(ctx, label, x, y + 1, r > 11 ? 12 : 11, col, 'center');
}

// -------------------------------------------------------------------- window

export interface SynopticsOptions {
  vars: SimVars;
  cfg: FusionResolvedConfig;
  readouts: SynopticReadouts;
  cas: FusionCas;
}

export class SynopticsWindow implements WindowRenderer {
  readonly animated = false;
  private readonly ro: SynopticReadouts;

  constructor(private readonly o: SynopticsOptions) {
    this.ro = o.readouts;
  }

  page(side: 1 | 2): SysPage {
    const p = Math.round(this.o.vars.get(FUSION_VARS.sysPage(side), 0));
    return (p >= 0 && p < SYS_PAGE_COUNT ? p : 0) as SysPage;
  }

  setPage(side: 1 | 2, p: number): void {
    const n = ((Math.round(p) % SYS_PAGE_COUNT) + SYS_PAGE_COUNT) % SYS_PAGE_COUNT;
    this.o.vars.set(FUSION_VARS.sysPage(side), n);
  }

  update(): void {}

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    const page = this.page(w.owner);
    // Tab bar (cursor selectable page keys).
    const n = SYS_PAGE_COUNT;
    const tw = r.w / n;
    rect(ctx, r.x, r.y, r.w, TAB_H, C.panel);
    for (let i = 0; i < n; i++) {
      const x = r.x + i * tw;
      const sel = i === page;
      if (sel) rect(ctx, x + 1, r.y + 1, tw - 2, TAB_H - 2, C.menuBg, C.cyan, 1.5);
      txt(ctx, SYS_PAGE_TABS[i], x + tw / 2, r.y + TAB_H / 2 + 1, tw < 50 ? 10 : 12, sel ? C.cyan : C.grey, 'center');
      hs.add(TAB_IDS[i], x, r.y, tw, TAB_H);
    }
    seg(ctx, r.x, r.y + TAB_H, r.x + r.w, r.y + TAB_H, C.line, 1);
    // Page in design units.
    const avH = r.h - TAB_H;
    const s = Math.min(r.w / PW, avH / PH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y + TAB_H, r.w, avH);
    ctx.clip();
    ctx.translate(r.x + (r.w - PW * s) / 2, r.y + TAB_H + (avH - PH * s) / 2);
    ctx.scale(s, s);
    txt(ctx, SYS_PAGE_TITLES[page], PW / 2, 18, 17, C.white, 'center');
    switch (page) {
      case SysPage.Status:
        this.drawStatus(ctx);
        break;
      case SysPage.AcElec:
        this.drawAc(ctx);
        break;
      case SysPage.DcElec:
        this.drawDc(ctx);
        break;
      case SysPage.Fuel:
        this.drawFuel(ctx);
        break;
      case SysPage.Hyd:
        this.drawHyd(ctx);
        break;
      case SysPage.FltCtrl:
        this.drawFltCtrl(ctx);
        break;
      case SysPage.Bleed:
        this.drawBleed(ctx);
        break;
      case SysPage.AntiIce:
        this.drawAntiIce(ctx);
        break;
      case SysPage.Ecs:
        this.drawEcs(ctx);
        break;
      case SysPage.Doors:
        this.drawDoors(ctx);
        break;
    }
    ctx.restore();
  }

  enter(side: 1 | 2, _w: ShownWindow, id: string): void {
    if (id.startsWith('tab:')) this.setPage(side, Number(id.slice(4)));
  }

  data(side: 1 | 2, _w: ShownWindow, _id: string, steps: number): void {
    this.setPage(side, this.page(side) + (steps > 0 ? 1 : -1));
  }

  menuItems(w: ShownWindow): MenuItem[] {
    const p = this.page(w.owner);
    return SYS_PAGE_TITLES.map((t, i) => ({ id: TAB_IDS[i], label: t, on: i === p }));
  }

  menuSelect(side: 1 | 2, w: ShownWindow, id: string): void {
    this.enter(side, w, id);
  }

  // ------------------------------------------------------------------ AC ELECTRICAL

  private static readonly GEN_KEYS = [1, 2, 3, 4].map((n) => ({
    v: `gen${n}.v`,
    kva: `gen${n}.kva`,
    hz: `gen${n}.hz`,
    on: `gen${n}.online`,
    fail: `gen${n}.fail`,
    off: `gen${n}.off`,
    label: `GEN ${n}`,
    bus: `acbus${n}.powered`,
    shed: `acbus${n}.shed`,
    manoff: `acbus${n}.manoff`,
    busLabel: `AC BUS ${n}`,
  }));

  private drawAc(ctx: Ctx2D): void {
    const ro = this.ro;
    // Source columns: GEN 1, GEN 2, APU, GEN 3, GEN 4.
    const colX = [50, 145, 250, 355, 450];
    const gy = 64;
    const busY = 330;
    const tieY = 272;
    const apuOn = ro.b('apugen.online');
    const extOn = ro.b('extac.online');
    // Readout labels.
    txt(ctx, 'V', 8, gy + 60, 12, C.cyan, 'left');
    txt(ctx, 'KVA', 8, gy + 82, 12, C.cyan, 'left');
    txt(ctx, 'HZ', 8, gy + 104, 12, C.cyan, 'left');
    for (let i = 0; i < 5; i++) {
      const x = colX[i];
      if (i === 2) {
        sourceBox(ctx, x - 38, gy, 76, 32, 'APU GEN', apuOn, false);
        readout(ctx, x + 18, gy + 60, ro.v('apugen.v'), 0, '');
        readout(ctx, x + 18, gy + 82, ro.v('apugen.kva'), 0, '');
        readout(ctx, x + 18, gy + 104, ro.v('apugen.hz'), 0, '');
        continue;
      }
      const g = SynopticsWindow.GEN_KEYS[i < 2 ? i : i - 1];
      const on = ro.b(g.on);
      const fail = ro.b(g.fail);
      sourceBox(ctx, x - 36, gy, 72, 32, g.label, on, fail);
      readout(ctx, x + 18, gy + 60, ro.v(g.v), 0, '');
      readout(ctx, x + 18, gy + 82, ro.v(g.kva), 0, '');
      readout(ctx, x + 18, gy + 104, ro.v(g.hz), 0, '');
      if (fail) txt(ctx, 'FAIL', x, gy + 128, 12, C.amber, 'center');
      else if (ro.b(g.off)) txt(ctx, 'OFF', x, gy + 128, 12, C.white, 'center');
      // Generator -> own bus.
      if (on) flow(ctx, C.green, x, gy + 138, x, busY);
    }
    // APU / external power tie line feeding the buses whose generator is off line.
    if (apuOn || extOn) {
      if (apuOn) flow(ctx, C.green, colX[2], gy + 116, colX[2], tieY);
      let x0 = colX[2];
      let x1 = colX[2];
      for (let i = 0; i < 4; i++) {
        const g = SynopticsWindow.GEN_KEYS[i];
        if (ro.b(g.on) || !ro.b(g.bus)) continue;
        const x = colX[i < 2 ? i : i + 1];
        flow(ctx, C.green, x, tieY, x, busY);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
      if (x1 > x0) flow(ctx, C.green, x0, tieY, x1, tieY);
    }
    // Buses: AC BUS 1, AC BUS 2, AC ESS, AC BUS 3, AC BUS 4.
    for (let i = 0; i < 5; i++) {
      const x = colX[i];
      if (i === 2) {
        busBox(ctx, x - 40, busY + 50, 80, 28, 'AC ESS', ro.b('acess.powered'));
        continue;
      }
      const g = SynopticsWindow.GEN_KEYS[i < 2 ? i : i - 1];
      const manoff = ro.b(g.manoff) === true;
      const shed = ro.b(g.shed) === true;
      busBox(ctx, x - 44, busY, 88, 28, g.busLabel, ro.b(g.bus), manoff ? 'MAN OFF' : shed ? 'SHED' : '');
    }
    // AC ESS feed (normal from AC BUS 1 side, RAT in emergency; EST topology).
    const essOn = ro.b('acess.powered');
    const ratOn = ro.b('rat.online');
    if (essOn && !ratOn && ro.b('acbus1.powered')) flow(ctx, C.green, colX[0], busY + 28, colX[0], busY + 64, colX[2] - 40, busY + 64);
    // RAT GEN and EXT AC.
    const ratDeployed = ro.b('rat.deployed');
    if (ratDeployed || ratOn) {
      sourceBox(ctx, colX[2] - 40, busY + 130, 80, 30, 'RAT GEN', ratOn, false);
      readout(ctx, colX[2] + 20, busY + 176, ro.v('rat.v'), 0, 'V');
      if (ratOn) flow(ctx, C.green, colX[2], busY + 130, colX[2], busY + 78);
    }
    const extAvail = ro.b('extac.avail');
    if (extAvail || extOn) {
      rect(ctx, 20, 470, 96, 30, C.bg, extOn ? C.green : C.white, 2);
      txt(ctx, 'EXT AC', 68, 485, 14, extOn ? C.green : C.white, 'center');
      txt(ctx, extOn ? 'ON' : 'AVAIL', 68, 514, 12, extOn ? C.green : C.cyan, 'center');
      if (extOn) flow(ctx, C.green, 116, 485, colX[2] - 60, 485, colX[2] - 60, tieY, colX[2], tieY);
    }
  }

  // ------------------------------------------------------------------ DC ELECTRICAL

  private static readonly TRU = [
    { key: 'tru1', label: 'TRU 1', x: 60 },
    { key: 'ess_tru1', label: 'ESS TRU 1', x: 185 },
    { key: 'ess_tru2', label: 'ESS TRU 2', x: 315 },
    { key: 'tru2', label: 'TRU 2', x: 440 },
  ].map((t) => ({ ...t, v: `${t.key}.v`, a: `${t.key}.a`, on: `${t.key}.online` }));

  private drawDc(ctx: Ctx2D): void {
    const ro = this.ro;
    const ty = 60;
    // Feeders from the AC side (labels only, as the GX page).
    txt(ctx, 'AC BUS 1', 60, 50, 11, C.grey, 'center');
    txt(ctx, 'AC ESS', 250, 50, 11, C.grey, 'center');
    txt(ctx, 'AC BUS 2', 440, 50, 11, C.grey, 'center');
    for (const t of SynopticsWindow.TRU) {
      const on = ro.b(t.on);
      sourceBox(ctx, t.x - 50, ty + 10, 100, 30, t.label, on, on === false && ro.v(t.v) < 1);
      readout(ctx, t.x + 10, ty + 58, ro.v(t.v), 0, 'V');
      readout(ctx, t.x + 10, ty + 78, ro.v(t.a), 0, 'A');
    }
    // Buses.
    const by = 220;
    for (const b of SynopticsWindow.DC_BUSES) {
      busBox(ctx, b.x - b.w / 2, by, b.w, 28, b.label, ro.b(b.powered), b.shed && ro.b(b.shed) ? 'SHED' : '');
    }
    // TRU -> bus flow lines.
    if (ro.b('tru1.online')) flow(ctx, C.green, 60, ty + 90, 60, by);
    if (ro.b('tru2.online')) flow(ctx, C.green, 440, ty + 90, 440, by);
    if (ro.b('ess_tru1.online') || ro.b('ess_tru2.online')) flow(ctx, C.green, 185, ty + 90, 185, ty + 120, 315, ty + 120, 315, ty + 90);
    if (ro.b('dc_ess.powered') && (ro.b('ess_tru1.online') || ro.b('ess_tru2.online'))) flow(ctx, C.green, 250, ty + 120, 250, by);
    // Batteries and the emergency buses.
    const bbY = 330;
    busBox(ctx, 190, bbY, 120, 28, 'BATT BUS', ro.b('batt_bus.powered'));
    busBox(ctx, 190, bbY + 70, 120, 28, 'DC EMER', ro.b('dc_emer.powered'));
    if (ro.b('batt_bus.powered') && ro.b('dc_ess.powered')) flow(ctx, C.green, 250, by + 28, 250, bbY);
    this.battery(ctx, 20, 440, 'AV BATT', 'av_batt');
    this.battery(ctx, 330, 440, 'APU BATT', 'apu_batt');
    if (ro.b('dc_emer.powered')) flow(ctx, C.green, 100, 440, 100, bbY + 84, 190, bbY + 84);
    const ext = ro.b('extdc.online');
    if (ext || ro.b('extdc.avail')) txt(ctx, ext ? 'EXT DC ON' : 'EXT DC AVAIL', 250, 530, 13, ext ? C.green : C.cyan, 'center');
  }

  private static readonly DC_BUSES = [
    { powered: 'dc_bus1.powered', shed: 'dc_bus1.shed', label: 'DC BUS 1', x: 60, w: 104 },
    { powered: 'dc_ess.powered', shed: '', label: 'DC ESS', x: 250, w: 110 },
    { powered: 'dc_bus2.powered', shed: 'dc_bus2.shed', label: 'DC BUS 2', x: 440, w: 104 },
  ] as const;

  private static readonly BATT_KEYS: Record<string, { v: string; a: string; t: string; chg: string }> = {
    av_batt: { v: 'av_batt.v', a: 'av_batt.a', t: 'av_batt.temp', chg: 'av_batt.chgr_fail' },
    apu_batt: { v: 'apu_batt.v', a: 'apu_batt.a', t: 'apu_batt.temp', chg: 'apu_batt.chgr_fail' },
  };

  private battery(ctx: Ctx2D, x: number, y: number, label: string, key: string): void {
    const ro = this.ro;
    const k = SynopticsWindow.BATT_KEYS[key];
    const v = ro.v(k.v);
    const ok = Number.isFinite(v) ? v > 22 : null; // EST: 24 V nominal lead-acid / NiCad, low below 22 V
    rect(ctx, x, y, 150, 34, C.bg, stateColor(ok, C.green, C.amber), 2);
    txt(ctx, label, x + 75, y + 17, 14, stateColor(ok, C.green, C.amber), 'center');
    readout(ctx, x + 40, y + 54, v, 0, 'V');
    readout(ctx, x + 105, y + 54, ro.v(k.a), 0, 'A');
    const t = ro.v(k.t);
    readout(ctx, x + 40, y + 76, t, 0, '°C', t > 60 ? C.amber : C.green); // EST battery over-temperature threshold
    if (ro.b(k.chg)) txt(ctx, 'CHARGER', x + 105, y + 76, 12, C.amber, 'center');
  }

  // ------------------------------------------------------------------ FUEL

  private fuelQty(lb: number): number {
    return this.o.cfg.fuelUnit === 'kg' ? lb / KG_TO_LB : lb;
  }

  private drawFuel(ctx: Ctx2D): void {
    const ro = this.ro;
    const unit = this.o.cfg.fuelUnit === 'kg' ? 'KG' : 'LBS';
    // Planform (EST outline): fuselage, wings, tail.
    ctx.strokeStyle = C.dimGrey;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(230, 60);
    ctx.lineTo(270, 60);
    ctx.lineTo(270, 520);
    ctx.lineTo(230, 520);
    ctx.closePath();
    ctx.moveTo(230, 190);
    ctx.lineTo(20, 330);
    ctx.lineTo(20, 360);
    ctx.lineTo(230, 280);
    ctx.moveTo(270, 190);
    ctx.lineTo(480, 330);
    ctx.lineTo(480, 360);
    ctx.lineTo(270, 280);
    ctx.stroke();
    // Tanks and quantities.
    this.tank(ctx, 60, 250, 'L WING', ro.v('fuel.l.lb'), 15045, ro.v('fuel.l.temp'), unit);
    this.tank(ctx, 330, 250, 'R WING', ro.v('fuel.r.lb'), 15045, ro.v('fuel.r.temp'), unit);
    this.tank(ctx, 195, 120, 'AUX', ro.v('fuel.c.lb'), 12683, NaN, unit);
    this.tank(ctx, 195, 430, 'AFT', ro.v('fuel.aft.lb'), 2275, NaN, unit);
    // Pumps (primary AC pumps and DC aux pumps in each wing, transfer pumps in AUX / AFT).
    const pumps = SynopticsWindow.FUEL_PUMPS;
    for (const p of pumps) pump(ctx, p.x, p.y, 'P', ro.b(p.on), ro.b(p.lp), 11);
    // Crossfeed and engine feed SOVs.
    valve(ctx, 250, 330, ro.b('fuel.xfeed.open'), true);
    txt(ctx, 'XFEED', 250, 352, 11, C.grey, 'center');
    const e1 = ro.b('fuel.eng1.on');
    const e2 = ro.b('fuel.eng2.on');
    flow(ctx, e1 ? C.green : C.dimGrey, 150, 360, 150, 395);
    flow(ctx, e2 ? C.green : C.dimGrey, 350, 360, 350, 395);
    valve(ctx, 150, 405, ro.b('fuel.sov1.open'), false);
    valve(ctx, 350, 405, ro.b('fuel.sov2.open'), false);
    txt(ctx, 'L ENG', 150, 432, 12, e1 ? C.green : C.white, 'center');
    txt(ctx, 'R ENG', 350, 432, 12, e2 ? C.green : C.white, 'center');
    if (ro.b('fuel.xfeed.open')) flow(ctx, C.green, 160, 330, 240, 330);
    if (ro.b('fuel.xfeed.open')) flow(ctx, C.green, 260, 330, 340, 330);
    // APU feed.
    const apu = ro.b('fuel.apu.on');
    txt(ctx, 'APU', 250, 540, 12, apu ? C.green : C.white, 'center');
    // Totals.
    txt(ctx, 'TOTAL FUEL', 20, 64, 12, C.white, 'left');
    readout(ctx, 110, 84, this.fuelQty(ro.v('fuel.total.lb')), 0, unit);
    txt(ctx, 'FUEL USED', 340, 64, 12, C.white, 'left');
    readout(ctx, 430, 84, this.fuelQty(ro.v('fuel.used.lb')), 0, unit);
    const ft1 = ro.v('fuel.eng1.temp');
    const ft2 = ro.v('fuel.eng2.temp');
    if (Number.isFinite(ft1)) readout(ctx, 150, 460, ft1, 0, '°C', C.green, 12);
    if (Number.isFinite(ft2)) readout(ctx, 350, 460, ft2, 0, '°C', C.green, 12);
  }

  private static readonly FUEL_PUMPS = [
    { x: 105, y: 330, on: 'fuel.pri_l1.on', lp: 'fuel.pri_l1.lowpress' },
    { x: 135, y: 330, on: 'fuel.pri_l2.on', lp: 'fuel.pri_l2.lowpress' },
    { x: 75, y: 330, on: 'fuel.aux_l.on', lp: 'fuel.aux_l.lowpress' },
    { x: 365, y: 330, on: 'fuel.pri_r1.on', lp: 'fuel.pri_r1.lowpress' },
    { x: 395, y: 330, on: 'fuel.pri_r2.on', lp: 'fuel.pri_r2.lowpress' },
    { x: 425, y: 330, on: 'fuel.aux_r.on', lp: 'fuel.aux_r.lowpress' },
    { x: 232, y: 190, on: 'fuel.ctr_xfer1.on', lp: 'fuel.ctr_xfer1.lowpress' },
    { x: 268, y: 190, on: 'fuel.ctr_xfer2.on', lp: 'fuel.ctr_xfer2.lowpress' },
    { x: 232, y: 500, on: 'fuel.aft_xfer1.on', lp: 'fuel.aft_xfer1.lowpress' },
    { x: 268, y: 500, on: 'fuel.aft_xfer2.on', lp: 'fuel.aft_xfer2.lowpress' },
  ];

  private tank(ctx: Ctx2D, x: number, y: number, label: string, lb: number, capLb: number, tempC: number, unit: string): void {
    const w = 110;
    const h = 56;
    rect(ctx, x, y, w, h, C.bg, C.white, 1.5);
    // Fill bar (EST cue).
    if (Number.isFinite(lb) && capLb > 0) {
      const f = Math.max(0, Math.min(1, lb / capLb));
      rect(ctx, x + 3, y + h - 3 - (h - 6) * f, 5, (h - 6) * f, C.green);
    }
    const hasT = Number.isFinite(tempC);
    txt(ctx, label, hasT ? x + 12 : x + w / 2, y + 13, 12, C.white, hasT ? 'left' : 'center');
    readout(ctx, x + w - 34, y + 36, this.fuelQty(lb), 0, '', C.green, 16);
    txt(ctx, unit, x + w - 30, y + 36, 10, C.cyan, 'left');
    if (hasT) readout(ctx, x + w - 24, y + 13, tempC, 0, '°C', tempC <= -37 ? C.amber : C.green, 12); // Jet A freeze -40 C, EST 3 C margin
  }

  // ------------------------------------------------------------------ HYDRAULIC

  private static readonly HYD = [
    { n: 1, x: 90, a: '1a', b: '1b', pa: 'pump1a', pb: 'pump1b', label: 'SYS 1', dist: ['RUD', 'L ELEV', 'L AIL', 'FLT SPLRS', 'GND SPLRS', 'L REVERSER'] },
    { n: 3, x: 250, a: '3a', b: '3b', pa: 'pump3a', pb: 'pump3b', label: 'SYS 3', dist: ['RUD', 'L ELEV R', 'L AIL R', 'GND SPLRS', 'GEAR', 'NOSE STEER', 'INBD BRAKES'] },
    { n: 2, x: 410, a: '2a', b: '2b', pa: 'pump2a', pb: 'pump2b', label: 'SYS 2', dist: ['RUD', 'R ELEV', 'R AIL', 'FLT SPLRS', 'GEAR', 'R REVERSER'] },
  ].map((s) => ({
    ...s,
    psi: `hyd${s.n}.psi`,
    qty: `hyd${s.n}.qty`,
    temp: `hyd${s.n}.temp`,
    aOn: `${s.pa}.on`,
    aLp: `${s.pa}.lowpress`,
    bOn: `${s.pb}.on`,
    bLp: `${s.pb}.lowpress`,
    aLbl: s.a.toUpperCase(),
    bLbl: s.b.toUpperCase(),
  }));

  private drawHyd(ctx: Ctx2D): void {
    const ro = this.ro;
    for (const s of SynopticsWindow.HYD) {
      const x = s.x;
      const psi = ro.v(s.psi);
      const ok = Number.isFinite(psi) ? psi > 1800 : null;
      const lineCol = ok === null ? C.amber : ok ? C.green : C.amber;
      // Reservoir with quantity.
      const qty = ro.v(s.qty);
      rect(ctx, x - 30, 50, 60, 70, C.bg, C.white, 1.5);
      if (Number.isFinite(qty)) {
        const f = Math.max(0, Math.min(1, qty / 100));
        rect(ctx, x - 27, 117 - 64 * f, 54, 64 * f, 'rgba(0,200,80,0.35)');
      }
      readout(ctx, x + 8, 86, Number.isFinite(qty) ? Math.round(qty / 2) * 2 : NaN, 0, '%');
      const t = ro.v(s.temp);
      readout(ctx, x + 8, 140, t, 0, '°C', t >= 96 ? C.amber : C.green);
      flow(ctx, Number.isFinite(qty) && qty > 0 ? C.green : C.amber, x, 150, x, 175);
      // Pumps A and B.
      flow(ctx, lineCol, x - 30, 175, x + 30, 175);
      flow(ctx, lineCol, x - 30, 175, x - 30, 200);
      flow(ctx, lineCol, x + 30, 175, x + 30, 200);
      pump(ctx, x - 30, 214, s.aLbl, ro.b(s.aOn), ro.b(s.aLp));
      pump(ctx, x + 30, 214, s.bLbl, ro.b(s.bOn), ro.b(s.bLp));
      flow(ctx, lineCol, x - 30, 228, x - 30, 250, x + 30, 250, x + 30, 228);
      flow(ctx, lineCol, x, 250, x, 272);
      // Pressure readout: white > 3200, green 1800-3200, amber <= 1800 (GX).
      const pcol = !Number.isFinite(psi) ? C.amber : psi > 3200 ? C.white : psi > 1800 ? C.green : C.amber;
      readout(ctx, x + 14, 286, Number.isFinite(psi) ? Math.round(psi / 50) * 50 : NaN, 0, 'PSI', pcol, 16);
      txt(ctx, s.label, x, 36, 14, C.white, 'center');
      // Distribution table.
      rect(ctx, x - 62, 306, 124, 18 * s.dist.length + 8, C.bg, C.line, 1);
      for (let i = 0; i < s.dist.length; i++) txt(ctx, s.dist[i], x, 318 + i * 18, 12, ok ? C.white : C.amber, 'center');
    }
    // Engine-driven pump (1A / 2A) supply shutoff valves, on the suction line above the pump.
    valve(ctx, 60, 189, ro.b('hydsov1.open'), false);
    valve(ctx, 380, 189, ro.b('hydsov2.open'), false);
    // RAT pump on system 3 (only when deployed).
    if (ro.b('rat.deployed')) {
      pump(ctx, 300, 250, 'RAT', ro.b('pumprat.on'), false, 15);
    }
    // Brakes.
    const ib = ro.v('brk.ib.psi');
    txt(ctx, 'INBD BRAKES', 250, 460, 12, C.white, 'center');
    readout(ctx, 250, 480, Number.isFinite(ib) ? Math.round(ib / 50) * 50 : NaN, 0, 'PSI', !Number.isFinite(ib) ? C.amber : ib > 3200 ? C.white : ib > 1800 ? C.green : C.amber);
    const ob = ro.v('brk.ob.psi');
    txt(ctx, 'OUTBD BRAKES', 410, 460, 12, C.white, 'center');
    if (Number.isFinite(ob)) txt(ctx, ob > 1400 ? 'NORM' : 'LO PRESS', 410, 480, 14, ob > 1400 ? C.green : C.amber, 'center');
    else txt(ctx, DASH, 410, 480, 14, C.amber, 'center');
  }

  // ------------------------------------------------------------------ FLIGHT CONTROLS

  private drawFltCtrl(ctx: Ctx2D): void {
    const ro = this.ro;
    const v = this.o.vars;
    const af = this.o.cfg.airframe;
    // Planform (EST).
    ctx.strokeStyle = C.dimGrey;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(235, 50);
    ctx.lineTo(265, 50);
    ctx.lineTo(265, 490);
    ctx.lineTo(235, 490);
    ctx.closePath();
    ctx.moveTo(235, 150);
    ctx.lineTo(30, 250);
    ctx.lineTo(30, 280);
    ctx.lineTo(235, 240);
    ctx.moveTo(265, 150);
    ctx.lineTo(470, 250);
    ctx.lineTo(470, 280);
    ctx.lineTo(265, 240);
    ctx.moveTo(235, 430);
    ctx.lineTo(160, 475);
    ctx.lineTo(160, 490);
    ctx.lineTo(235, 480);
    ctx.moveTo(265, 430);
    ctx.lineTo(340, 475);
    ctx.lineTo(340, 490);
    ctx.lineTo(265, 480);
    ctx.stroke();
    // Spoilers: four multifunction panels + ground spoiler per side.
    const spL = ro.v('fc.spl.l');
    const spR = ro.v('fc.spl.r');
    const gnd = ro.v('fc.gnd');
    for (let i = 0; i < 4; i++) {
      this.panel(ctx, 190 - i * 32, 262 - i * 2, 26, spL);
      this.panel(ctx, 284 + i * 32, 262 - i * 2, 26, spR);
    }
    this.panel(ctx, 206, 244, 22, gnd, true);
    this.panel(ctx, 272, 244, 22, gnd, true);
    txt(ctx, 'SPLRS', 110, 300, 11, C.grey, 'center');
    txt(ctx, 'SPLRS', 390, 300, 11, C.grey, 'center');
    // Ailerons, elevators, rudder: scales with a position pointer.
    this.surfaceScale(ctx, 50, 310, 'AIL', ro.v('fc.ail.l'));
    this.surfaceScale(ctx, 450, 310, 'AIL', ro.v('fc.ail.r'));
    this.surfaceScale(ctx, 100, 420, 'ELEV', ro.v('fc.elev.l'));
    this.surfaceScale(ctx, 400, 420, 'ELEV', ro.v('fc.elev.r'));
    // Rudder: horizontal scale below the tail.
    const rud = ro.v('fc.rud');
    txt(ctx, 'RUDDER', 250, 512, 12, C.white, 'center');
    seg(ctx, 200, 540, 300, 540, C.white, 2);
    seg(ctx, 250, 534, 250, 546, C.white, 2);
    if (Number.isFinite(rud)) this.pointer(ctx, 250 + Math.max(-1, Math.min(1, rud)) * 50, 540, false);
    // Flaps / slats.
    const flap = v.get(af.vars.flapsDeg, NaN);
    const slat = v.get(af.vars.slats, NaN);
    const lever = v.get(af.vars.flapLever, NaN);
    let cmdFlap = NaN;
    let cmdSlat = NaN;
    if (Number.isFinite(lever)) {
      let best = af.flaps[0];
      for (const d of af.flaps) if (Math.abs(d.lever - lever) < Math.abs(best.lever - lever)) best = d;
      cmdFlap = best.flapDeg;
      cmdSlat = best.slats ? 1 : 0;
    }
    txt(ctx, 'FLAP', 60, 80, 13, C.white, 'left');
    const flapCol = !Number.isFinite(flap) ? C.amber : Number.isFinite(cmdFlap) && Math.abs(flap - cmdFlap) > 0.5 ? C.white : C.green;
    readout(ctx, 140, 100, flap, 0, '', flapCol, 18);
    txt(ctx, 'SLAT', 360, 80, 13, C.white, 'left');
    const slatOut = Number.isFinite(slat) ? slat > 0.98 : null;
    const slatIn = Number.isFinite(slat) ? slat < 0.02 : null;
    const slatTransit = slatOut === false && slatIn === false;
    const slatAgree = !Number.isFinite(cmdSlat) || (slatOut === true && cmdSlat === 1) || (slatIn === true && cmdSlat === 0);
    const slatCol = slatOut === null ? C.amber : slatTransit || !slatAgree ? C.white : C.green;
    txt(ctx, slatOut === null ? DASH : slatOut ? 'OUT' : slatIn ? 'IN' : 'TRANSIT', 420, 100, 16, slatCol, 'center');
    // Rudder travel limiter state (EST display).
    if (ro.b('fc.rtl') === false) txt(ctx, 'RUD LIMIT FAULT', 250, 130, 12, C.amber, 'center');
  }

  /** Spoiler panel: filled green when raised (> 5 %), outline otherwise. */
  private panel(ctx: Ctx2D, x: number, y: number, w: number, v: number, ground = false): void {
    const up = Number.isFinite(v) ? v > 0.05 : null;
    const col = up === null ? C.amber : up ? C.green : C.white;
    if (up) rect(ctx, x, y - 10, w, 10, col);
    else rect(ctx, x, y - 6, w, 6, C.bg, col, 1.5);
    if (ground) seg(ctx, x, y + 2, x + w, y + 2, C.dimGrey, 1);
  }

  /** Vertical position scale (-1 top .. +1 bottom = trailing edge down) with a pointer. */
  private surfaceScale(ctx: Ctx2D, x: number, y: number, label: string, v: number): void {
    const L = 80;
    txt(ctx, label, x, y - 10, 12, C.white, 'center');
    seg(ctx, x, y, x, y + L, C.white, 2);
    seg(ctx, x - 6, y + L / 2, x + 6, y + L / 2, C.white, 2);
    seg(ctx, x - 4, y, x + 4, y, C.white, 1.5);
    seg(ctx, x - 4, y + L, x + 4, y + L, C.white, 1.5);
    if (Number.isFinite(v)) this.pointer(ctx, x, y + L / 2 + Math.max(-1, Math.min(1, v)) * (L / 2), true);
    else txt(ctx, DASH, x, y + L / 2, 12, C.amber, 'center');
  }

  private pointer(ctx: Ctx2D, x: number, y: number, vertical: boolean): void {
    ctx.fillStyle = C.green;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + 16, y - 6);
      ctx.lineTo(x + 16, y + 6);
    } else {
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x - 6, y - 15);
      ctx.lineTo(x + 6, y - 15);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ------------------------------------------------------------------ BLEED

  private drawBleed(ctx: Ctx2D): void {
    const ro = this.ro;
    const lPsi = ro.v('bleed.l.psi');
    const rPsi = ro.v('bleed.r.psi');
    const aPsi = ro.v('bleed.apu.psi');
    const lOpen = ro.b('bleed.l.open');
    const rOpen = ro.b('bleed.r.open');
    const aOpen = ro.b('bleed.apu.open');
    const iso = ro.b('bleed.iso.open');
    // Engines.
    this.engBox(ctx, 40, 400, 'L ENG');
    this.engBox(ctx, 380, 400, 'R ENG');
    txt(ctx, 'APU', 190, 500, 14, ro.b('apu.running') ? C.green : C.white, 'center');
    // Source lines and valves. Topology (EST): APU bleed joins the left manifold; the
    // isolation valve in the centre separates the left and right manifolds.
    const manY = 250;
    const lFlow = lOpen === true && lPsi > 5;
    const rFlow = rOpen === true && rPsi > 5;
    const aFlow = aOpen === true && aPsi > 5;
    flow(ctx, lFlow ? C.green : C.dimGrey, 80, 400, 80, manY);
    flow(ctx, rFlow ? C.green : C.dimGrey, 420, 400, 420, manY);
    flow(ctx, aFlow ? C.green : C.dimGrey, 190, 485, 190, manY);
    valve(ctx, 80, 330, lOpen, false, ro.b('bleed.l.trip') === true);
    valve(ctx, 420, 330, rOpen, false, ro.b('bleed.r.trip') === true);
    valve(ctx, 190, 420, aOpen, false);
    readout(ctx, 120, 365, lPsi, 0, 'PSI');
    readout(ctx, 460, 365, rPsi, 0, 'PSI');
    readout(ctx, 230, 455, aPsi, 0, 'PSI');
    const lMan = lFlow || aFlow || (iso === true && rFlow);
    const rMan = rFlow || (iso === true && (lFlow || aFlow));
    flow(ctx, lMan ? C.green : C.dimGrey, 80, manY, 240, manY);
    flow(ctx, rMan ? C.green : C.dimGrey, 260, manY, 420, manY);
    valve(ctx, 250, manY, iso, true);
    txt(ctx, 'ISOL', 250, manY + 24, 11, C.grey, 'center');
    // Consumers: packs, wing anti-ice (one feed per side), start valves.
    this.pack(ctx, 60, 120, 'L PACK', ro.b('pack.l.on'), ro.v('pack.l.out'), lMan);
    this.pack(ctx, 340, 120, 'R PACK', ro.b('pack.r.on'), ro.v('pack.r.out'), rMan);
    flow(ctx, lMan && ro.b('pack.l.on') ? C.green : C.dimGrey, 110, manY, 110, 170);
    flow(ctx, rMan && ro.b('pack.r.on') ? C.green : C.dimGrey, 390, manY, 390, 170);
    const wai = ro.b('ice.wing.l.sw');
    txt(ctx, 'WING A/ICE', 250, 150, 12, wai ? C.green : C.white, 'center');
    flow(ctx, wai && lMan ? C.green : C.dimGrey, 200, manY, 200, 190, 235, 165);
    flow(ctx, wai && rMan ? C.green : C.dimGrey, 300, manY, 300, 190, 265, 165);
    if (ro.b('start.1.valve')) txt(ctx, 'START', 80, 385, 12, C.green, 'center');
    if (ro.b('start.2.valve')) txt(ctx, 'START', 420, 385, 12, C.green, 'center');
    if (ro.b('bleed.l.trip')) txt(ctx, 'TRIP', 40, 330, 12, C.amber, 'center');
    if (ro.b('bleed.r.trip')) txt(ctx, 'TRIP', 460, 330, 12, C.amber, 'center');
  }

  private engBox(ctx: Ctx2D, x: number, y: number, label: string): void {
    rect(ctx, x, y, 80, 40, C.bg, C.white, 1.5);
    txt(ctx, label, x + 40, y + 20, 13, C.white, 'center');
  }

  private pack(ctx: Ctx2D, x: number, y: number, label: string, on: boolean | null, outC: number, supplied: boolean): void {
    const col = on === null ? C.amber : on && supplied ? C.green : on ? C.amber : C.white;
    rect(ctx, x, y, 100, 50, C.bg, col, 2);
    txt(ctx, label, x + 50, y + 16, 13, col, 'center');
    readout(ctx, x + 64, y + 36, outC, 0, '°C', C.green, 12);
  }

  // ------------------------------------------------------------------ ANTI-ICE

  private drawAntiIce(ctx: Ctx2D): void {
    const ro = this.ro;
    // Planform.
    ctx.strokeStyle = C.dimGrey;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(235, 60);
    ctx.lineTo(265, 60);
    ctx.lineTo(265, 480);
    ctx.lineTo(235, 480);
    ctx.closePath();
    ctx.stroke();
    // Wing leading edges (protected green, heating on but not protected amber, off white).
    this.leadingEdge(ctx, 235, 180, 40, 290, ro.b('ice.wing.l'), ro.b('ice.wing.l.sw'));
    this.leadingEdge(ctx, 265, 180, 460, 290, ro.b('ice.wing.r'), ro.b('ice.wing.l.sw'));
    txt(ctx, 'WING', 120, 280, 13, C.white, 'center');
    txt(ctx, 'WING', 380, 280, 13, C.white, 'center');
    // Cowls (engine nacelles on the aft fuselage).
    this.cowl(ctx, 175, 380, 'L COWL', ro.b('ice.cowl.l'), ro.b('ice.cowl.l.sw'));
    this.cowl(ctx, 325, 380, 'R COWL', ro.b('ice.cowl.r'), ro.b('ice.cowl.r.sw'));
    // Windshields and probes.
    const wl = ro.b('ice.ws.l');
    const wr = ro.b('ice.ws.r');
    txt(ctx, 'WSHLD', 250, 40, 12, C.white, 'center');
    seg(ctx, 238, 64, 249, 58, stateColor(wl), 4);
    seg(ctx, 251, 58, 262, 64, stateColor(wr), 4);
    txt(ctx, 'PROBES', 250, 110, 12, stateColor(ro.b('ice.probes')), 'center');
    // Ice detection.
    const det = ro.b('ice.detected');
    if (det) {
      rect(ctx, 170, 510, 160, 30, C.bg, C.amber, 2);
      txt(ctx, 'ICE', 250, 525, 16, C.amber, 'center');
    }
  }

  private leadingEdge(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, protectedOk: boolean | null, sw: boolean | null): void {
    const col = protectedOk ? C.green : sw ? C.amber : protectedOk === null && sw === null ? C.amber : C.white;
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  private cowl(ctx: Ctx2D, x: number, y: number, label: string, on: boolean | null, sw: boolean | null): void {
    const col = on ? C.green : sw ? C.amber : on === null && sw === null ? C.amber : C.white;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 18, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
    txt(ctx, label, x, y + 46, 12, col, 'center');
  }

  // ------------------------------------------------------------------ AIR COND / PRESS

  private static readonly ZONE_KEYS = [1, 2, 3].map((z) => ({ t: `zone${z}.temp`, tg: `zone${z}.target` }));

  private drawEcs(ctx: Ctx2D): void {
    const ro = this.ro;
    const zones = this.o.cfg.airframe.ecsZones;
    // Zone temperatures (actual green, selected cyan).
    txt(ctx, 'TEMP °C', 20, 60, 12, C.cyan, 'left');
    for (let i = 0; i < Math.min(3, zones.length); i++) {
      const x = 90 + i * 150;
      rect(ctx, x - 65, 80, 130, 80, C.bg, C.white, 1.5);
      txt(ctx, zones[i], x, 96, 12, C.white, 'center');
      const k = SynopticsWindow.ZONE_KEYS[i];
      readout(ctx, x + 10, 122, ro.v(k.t), 0, '', C.green, 18);
      readout(ctx, x + 10, 146, ro.v(k.tg), 0, '', C.cyan, 13);
    }
    // Packs.
    this.pack(ctx, 40, 200, 'L PACK', ro.b('pack.l.on'), ro.v('pack.l.out'), true);
    this.pack(ctx, 360, 200, 'R PACK', ro.b('pack.r.on'), ro.v('pack.r.out'), true);
    // Pressurisation block.
    const y0 = 300;
    const alt = ro.v('cabin.alt');
    const rate = ro.v('cabin.rate');
    const dp = ro.v('cabin.dp');
    const ldg = ro.v('cabin.ldg');
    rect(ctx, 40, y0, 420, 190, C.bg, C.line, 1);
    txt(ctx, 'CAB ALT', 60, y0 + 30, 13, C.white, 'left');
    // Cabin altitude: amber above 8,500 ft, red above 10,000 ft (EST per 14 CFR 25.841 and CAS CABIN ALT thresholds).
    readout(ctx, 300, y0 + 30, Number.isFinite(alt) ? Math.round(alt / 50) * 50 : NaN, 0, 'FT', alt > 10000 ? C.red : alt > 8500 ? C.amber : C.green, 16);
    txt(ctx, 'RATE', 60, y0 + 64, 13, C.white, 'left');
    readout(ctx, 300, y0 + 64, Number.isFinite(rate) ? Math.round(rate / 10) * 10 : NaN, 0, 'FPM', Math.abs(rate) > 2000 ? C.amber : C.green, 16);
    txt(ctx, 'ΔP', 60, y0 + 98, 13, C.white, 'left');
    // Global 6000 maximum differential 10.33 psi (EST from published 4,500 ft cabin at 45,000 ft).
    readout(ctx, 300, y0 + 98, dp, 1, 'PSI', dp > 10.4 || dp < -0.5 ? C.amber : C.green, 16);
    txt(ctx, 'LDG ELEV', 60, y0 + 132, 13, C.white, 'left');
    readout(ctx, 300, y0 + 132, ldg, 0, 'FT', C.cyan, 16);
    // Outflow valve position (0 closed .. 1 open).
    const ofv = ro.v('cabin.outflow');
    txt(ctx, 'OUTFLOW', 60, y0 + 166, 13, C.white, 'left');
    rect(ctx, 200, y0 + 158, 150, 14, C.bg, C.white, 1);
    if (Number.isFinite(ofv)) rect(ctx, 202, y0 + 160, 146 * Math.max(0, Math.min(1, ofv)), 10, C.green);
    if (ro.b('cabin.auto_fail')) txt(ctx, 'AUTO FAIL', 250, y0 + 210, 14, C.amber, 'center');
  }

  // ------------------------------------------------------------------ DOORS

  private static doorKeyCache = new Map<string, string>();
  private static doorKey(id: string): string {
    let k = SynopticsWindow.doorKeyCache.get(id);
    if (!k) {
      k = `door.${id}`;
      SynopticsWindow.doorKeyCache.set(id, k);
    }
    return k;
  }

  /** Door symbol positions on the fuselage outline (EST, Global cabin layout). */
  private static readonly DOOR_POS: Record<string, [number, number, 'L' | 'R']> = {
    pax: [110, 0, 'L'],
    emer: [250, 0, 'R'],
    bag: [390, 0, 'L'],
    aft_eqpt: [440, 0, 'R'],
    svc_large: [330, 0, 'R'],
    svc_small: [180, 0, 'R'],
  };

  private drawDoors(ctx: Ctx2D): void {
    const ro = this.ro;
    // Fuselage (side-by-side top view, nose left).
    const cy = 170;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, cy);
    ctx.quadraticCurveTo(50, cy - 40, 100, cy - 40);
    ctx.lineTo(420, cy - 40);
    ctx.lineTo(480, cy - 12);
    ctx.lineTo(480, cy + 12);
    ctx.lineTo(420, cy + 40);
    ctx.lineTo(100, cy + 40);
    ctx.quadraticCurveTo(50, cy + 40, 40, cy);
    ctx.stroke();
    txt(ctx, 'FWD', 30, cy - 56, 11, C.grey, 'left');
    const doors = this.o.cfg.airframe.doors;
    let y = 270;
    for (const d of doors) {
      const open = ro.b(SynopticsWindow.doorKey(d.id));
      const col = open === null ? C.amber : open ? C.amber : C.green;
      const pos = SynopticsWindow.DOOR_POS[d.id];
      if (pos) {
        const [dx, , side] = pos;
        const dy = side === 'L' ? cy - 40 : cy + 40;
        rect(ctx, dx - 12, dy - 5, 24, 10, open ? C.amber : C.bg, col, 2);
      }
      txt(ctx, d.label, 60, y, 14, C.white, 'left');
      txt(ctx, open === null ? DASH : open ? 'OPEN' : 'CLOSED', 400, y, 14, col, 'right');
      y += 34;
    }
  }

  // ------------------------------------------------------------------ STATUS

  private static readonly BRAKES: readonly [string, string][] = [
    ['brk.temp.lo', 'L OB'],
    ['brk.temp.li', 'L IB'],
    ['brk.temp.ri', 'R IB'],
    ['brk.temp.ro', 'R OB'],
  ];

  private drawStatus(ctx: Ctx2D): void {
    const ro = this.ro;
    // Brake temperature index (GX: 00-05 green, 06-16 white, 17-39 red).
    txt(ctx, 'BRAKE TEMP', 20, 54, 13, C.white, 'left');
    for (let i = 0; i < 4; i++) {
      const [key, label] = SynopticsWindow.BRAKES[i];
      const x = 40 + i * 60 + (i >= 2 ? 30 : 0);
      const c = ro.v(key);
      // EST: index = brake temperature / 25 C (00-39 scale; fuse plugs near index 28).
      const idx = Number.isFinite(c) ? Math.max(0, Math.min(39, Math.round(c / 25))) : NaN;
      const col = !Number.isFinite(idx) ? C.amber : idx >= 17 ? C.red : idx >= 6 ? C.white : C.green;
      rect(ctx, x, 70, 48, 30, C.bg, col, 1.5);
      txt(ctx, Number.isFinite(idx) ? twoDigit(idx) : '--', x + 24, 86, 16, col, 'center');
      txt(ctx, label, x + 24, 114, 11, C.grey, 'center');
    }
    // APU (shown while running / spooling, GX APU chapter).
    const rpm = ro.v('apu.rpm');
    const egt = ro.v('apu.egt');
    const apuShown = ro.b('apu.running') === true || rpm > 5;
    txt(ctx, 'APU', 330, 54, 13, C.white, 'left');
    if (apuShown) {
      txt(ctx, 'RPM', 330, 80, 12, C.cyan, 'left');
      // APU limits (EST: 107 % RPM, 800 C EGT as for the RE220 GX; red above).
      readout(ctx, 440, 80, rpm, 0, '%', rpm > 107 ? C.red : C.green);
      txt(ctx, 'EGT', 330, 104, 12, C.cyan, 'left');
      readout(ctx, 440, 104, egt, 0, '°C', egt > 800 ? C.red : C.green);
    } else txt(ctx, 'OFF', 360, 80, 12, C.white, 'left');
    // Oxygen and engine oil.
    txt(ctx, 'CREW OXY', 20, 150, 13, C.white, 'left');
    const oxy = ro.v('oxy.psi');
    readout(ctx, 200, 150, oxy, 0, 'PSI', oxy < 1000 ? C.amber : C.green); // EST dispatch minimum ~1000 psi
    txt(ctx, 'OIL QTY', 260, 150, 13, C.white, 'left');
    readout(ctx, 380, 150, ro.v('eng1.oilqty'), 1, '', C.green);
    readout(ctx, 460, 150, ro.v('eng2.oilqty'), 1, 'QT', C.green);
    // Door summary.
    txt(ctx, 'DOORS', 20, 190, 13, C.white, 'left');
    let open = 0;
    let invalid = 0;
    for (const d of this.o.cfg.airframe.doors) {
      const b = ro.b(SynopticsWindow.doorKey(d.id));
      if (b === null) invalid++;
      else if (b) open++;
    }
    txt(ctx, open > 0 ? 'OPEN' : invalid > 0 ? DASH : 'CLOSED', 200, 190, 13, open > 0 || invalid > 0 ? C.amber : C.green, 'right');
    // Status messages (white) from the CAS list.
    seg(ctx, 20, 210, 480, 210, C.line, 1);
    txt(ctx, 'STATUS MESSAGES', 20, 226, 12, C.grey, 'left');
    let y = 250;
    for (const m of this.o.cas.model.list) {
      if (m.level !== 'status') continue;
      txt(ctx, m.text, 20, y, 14, C.white, 'left');
      y += 20;
      if (y > 540) break;
    }
  }
}

const TWO = new Array<string>(40).fill('').map((_, i) => (i < 10 ? `0${i}` : String(i)));
function twoDigit(n: number): string {
  return TWO[Math.max(0, Math.min(39, Math.round(n)))];
}
