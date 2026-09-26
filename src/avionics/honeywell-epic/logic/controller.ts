/**
 * Display controller logic: the G650 "standby multifunction controller"
 * (SMC: display controller + standby instrument on the glareshield) and the
 * Symmetry TSC "Display Control" app share these pages.
 *
 * Pages (G550 OM 2A-31-00 "Display Controllers (DCs)": "PFD, MAP, 1/6 SYS /
 * 2/3 SYS, SENSOR, FLT REF, TRS, NAV, TEST, CHKLST"; G650 SPU selections
 * "PFD, MAP, SENSOR, FLT REF, TEST, CHKLIST - SYSTEM, 1/6 - 2/3, TRS, NAV,
 * HUD"; "Function pushbuttons generate menu items ... selected via line
 * select keys (LSK). A second push of the LSK will remove the item from
 * view on the DU." TEST page items from the G650ER glareshield photograph:
 * HUD, RAD ALT, STALL, TCAS, EGPWS, TONE, AP DISC; code450 checklist
 * "Display Controllers ... check RAD ALT, TONE, EGPWS, TCAS pages"; stall
 * test "pilot's column shaker activating first for 3 seconds and the
 * copilot's column shaker activating for 3 seconds after a short delay").
 *
 * The line content of each page is EST (no public page drawings); every
 * item changes real suite / aircraft state.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AP, NAV } from '../../../core/vars';
import { fmtFixed, fmtInt } from '../../common/format';
import { EPIC_EVENTS, EPIC_VARS, HsiMode, MapOverlay, MapUp, NavSrc, BrgSrc, SYNOPTIC_WINDOWS, WIN_NAMES, Win } from '../vars';
import type { EpicEventMap, EpicSensors } from '../config';
import type { WindowManager } from './windows';

export type DcPageId = 'MENU' | 'PFD' | 'MAP' | 'SENSOR' | 'FLT REF' | 'TEST' | 'CHKLST' | 'SYS' | 'SYS2' | 'TRS' | 'NAV' | 'HUD';

/** Top-level menu order (LSK 1-5 left, 6-10 right). */
export const DC_MENU: readonly DcPageId[] = ['PFD', 'MAP', 'SENSOR', 'FLT REF', 'TEST', 'CHKLST', 'SYS', 'TRS', 'NAV', 'HUD'];
const MENU_LABELS: Record<string, string> = { PFD: 'PFD', MAP: 'MAP', SENSOR: 'SENSOR', 'FLT REF': 'FLT REF', TEST: 'TEST', CHKLST: 'CHKLST', SYS: '1/6-2/3', TRS: 'TRS', NAV: 'NAV', HUD: 'HUD' };

/** One rendered line select key row. */
export interface DcLine {
  label: string;
  value: string;
  /** Value colour role. */
  color: 'white' | 'cyan' | 'green' | 'magenta' | 'amber';
  /** Item is selected for the SET knob (cyan box). */
  selected: boolean;
  /** '>' sub-page arrow. */
  arrow: boolean;
}

/** Test pulses (s): TCAS test ~8 s, RA 5 s, stall 7 s (two 3 s shaker phases), tone 3 s, AP DISC 2 s, HUD 5 s (EST). */
const TEST_S: Record<string, number> = { hud: 5, ra: 5, stall: 7, tcas: 8, tone: 3, apdisc: 2 };

/** Thrust ratings offered on the TRS page (ids of the aircraft's ThrustRatingComputer). */
export const TRS_RATINGS: readonly string[] = ['TO', 'GA', 'CLB', 'CRZ', 'MCT'];

/** V-speed names on the FLT REF page. */
export const VSPEEDS: readonly string[] = ['v1', 'vr', 'v2', 'vfs', 'vref', 'vapp'];

export interface DisplayControllerOptions {
  sensors: EpicSensors;
  events: EpicEventMap;
  windows: WindowManager;
  /** Number of checklists (CHKLST page NEXT / PREV). */
  checklistCount: () => number;
  /** Controller power per side. */
  powered?: (side: 1 | 2) => boolean;
  /** Seconds without a key press before the SMC returns to the standby instrument (EST 30 s). */
  returnToStandbyS?: number;
}

interface SideDc {
  page: DcPageId;
  sel: number; // selected LSK for the SET knob (0 none)
  sysTarget: 0 | 1 | 2; // 2/3, upper, lower
  idle: number;
}

export class DisplayControllerLogic {
  readonly name = 'epic.dc';
  readonly tests: Record<string, number> = { hud: 0, ra: 0, stall: 0, tcas: 0, tone: 0, apdisc: 0 };
  private readonly vars: SimVars;
  private readonly events: EventBus;
  private readonly o: DisplayControllerOptions;
  private readonly offs: (() => void)[] = [];
  private readonly st: [SideDc, SideDc] = [
    { page: 'MENU', sel: 0, sysTarget: 0, idle: 0 },
    { page: 'MENU', sel: 0, sysTarget: 0, idle: 0 },
  ];
  private readonly lines: [DcLine[], DcLine[]] = [makeLines(), makeLines()];

  constructor(vars: SimVars, events: EventBus, opts: DisplayControllerOptions) {
    this.vars = vars;
    this.events = events;
    this.o = opts;
    const init = (n: string, x: number): void => {
      if (!vars.has(n)) vars.set(n, x);
    };
    for (const s of [1, 2] as const) {
      const sen = opts.sensors.sides[s - 1];
      init(EPIC_VARS.hsiMode(s), HsiMode.Arc);
      init(EPIC_VARS.brg1(s), BrgSrc.Nav1);
      init(EPIC_VARS.brg2(s), BrgSrc.Off);
      init(EPIC_VARS.fpv(s), 1);
      init(EPIC_VARS.svs(s), 1);
      init(EPIC_VARS.evs(s), 0);
      init(EPIC_VARS.adcSel(s), sen.adc);
      init(EPIC_VARS.ahrsSel(s), sen.ahrs);
      init(EPIC_VARS.baroHpa(s), 0);
      init(EPIC_VARS.minsRa(s), 1);
      init(EPIC_VARS.minsFt(s), 200);
      init(EPIC_VARS.mapRange(s), 10);
      init(EPIC_VARS.mapUp(s), MapUp.Heading);
      init(EPIC_VARS.mapOverlay(s), MapOverlay.Terrain);
      init(EPIC_VARS.mapCentered(s), 0);
      init(EPIC_VARS.mapVsd(s), 1);
      init(EPIC_VARS.mapShowAirports(s), 1);
      init(EPIC_VARS.mapShowNavaids(s), 1);
      init(EPIC_VARS.mapShowFixes(s), 0);
      init(EPIC_VARS.mapShowTraffic(s), 1);
      init(EPIC_VARS.pfdRange(s), 10);
      init(EPIC_VARS.smcStandby(s), 1);
      this.offs.push(
        events.on(EPIC_EVENTS.dcLsk(s), (p) => this.lsk(s, Number(p ?? 0))),
        events.on(EPIC_EVENTS.dcPage(s), (p) => this.page(s, String(p ?? 'MENU') as DcPageId | 'STBY')),
        events.on(EPIC_EVENTS.dcSet(s), (p) => this.set(s, Number(p ?? 0))),
        events.on(EPIC_EVENTS.dcSetInc(s), (p) => this.set(s, Math.max(1, Number(p ?? 1)))),
        events.on(EPIC_EVENTS.dcSetDec(s), (p) => this.set(s, -Math.max(1, Number(p ?? 1)))),
      );
    }
    init(EPIC_VARS.vspeedsShown, 1);
    for (const n of VSPEEDS) init(EPIC_VARS.vspeed(n), 0);
    init('epic.hud.on', 1);
    init('epic.hud.dcltr', 0);
    init('epic.hud.brt', 0.8);
    this.writeMins(1);
    this.writeMins(2);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  currentPage(side: 1 | 2): DcPageId {
    return this.st[side - 1].page;
  }

  private powered(side: 1 | 2): boolean {
    return this.o.powered?.(side) ?? true;
  }

  /** Function key / page selection ('STBY' returns the SMC to the standby instrument). */
  page(side: 1 | 2, id: DcPageId | 'STBY'): void {
    if (!this.powered(side)) return;
    const s = this.st[side - 1];
    s.idle = 0;
    s.sel = 0;
    if (id === 'STBY') {
      this.vars.set(EPIC_VARS.smcStandby(side), 1);
      s.page = 'MENU';
    } else {
      this.vars.set(EPIC_VARS.smcStandby(side), 0);
      s.page = id;
    }
    this.vars.set(EPIC_VARS.dcPage(side), DC_PAGE_CODES.indexOf(s.page));
  }

  /** SET knob (range / value): adjusts the selected item, else the side's map range. */
  set(side: 1 | 2, steps: number): void {
    if (!this.powered(side) || steps === 0) return;
    const s = this.st[side - 1];
    s.idle = 0;
    const v = this.vars;
    const key = s.sel ? `${s.page}:${s.sel}` : '';
    switch (key) {
      case 'PFD:7': {
        const ra = v.get(EPIC_VARS.minsRa(side)) !== 0;
        v.set(EPIC_VARS.minsFt(side), clamp(v.get(EPIC_VARS.minsFt(side)) + steps * 10, 0, ra ? 2500 : 20000));
        this.writeMins(side);
        return;
      }
      case 'MAP:1':
        this.stepRange(EPIC_VARS.mapRange(side), steps);
        return;
      case 'NAV:6': {
        const r = this.navRx(side);
        v.set(NAV.activeFreq(r), clamp(Math.round((v.get(NAV.activeFreq(r), 108) + 0.05 * steps) * 100) / 100, 108, 117.95));
        return;
      }
      case 'NAV:7': {
        const r = this.navRx(side);
        v.set(NAV.obs(r), wrap360(Math.round(v.get(NAV.obs(r)) + steps)));
        v.set(AP.selCourse(side), v.get(NAV.obs(r)));
        return;
      }
      case 'HUD:3':
        v.set('epic.hud.brt', clamp(v.get('epic.hud.brt') + 0.05 * steps, 0, 1));
        return;
      default:
        if (s.page === 'FLT REF' && s.sel > 0) {
          const name = FLT_REF_ITEMS[s.sel];
          if (name) {
            const n = EPIC_VARS.vspeed(name);
            const cur = v.get(n);
            v.set(n, clamp((cur > 0 ? cur : 120) + steps, 0, 250));
          }
          return;
        }
        // Nothing selected: range of the PFD HSI map (side's PFD).
        this.stepRange(EPIC_VARS.pfdRange(side), steps);
    }
  }

  private stepRange(name: string, steps: number): void {
    const cur = this.vars.get(name, 10);
    let i = RANGES.indexOf(cur);
    if (i < 0) i = RANGES.findIndex((r) => r >= cur);
    i = Math.max(0, Math.min(RANGES.length - 1, i + Math.sign(steps)));
    this.vars.set(name, RANGES[i]);
  }

  private navRx(side: 1 | 2): number {
    const src = this.vars.get(EPIC_VARS.navSrc(side));
    return src >= NavSrc.Nav1 ? src : this.o.sensors.sides[side - 1].nav;
  }

  private writeMins(side: 1 | 2): void {
    const v = this.vars;
    v.set(AP.minimums(side), v.get(EPIC_VARS.minsFt(side)));
    v.set(AP.minimumsIsRadio(side), v.get(EPIC_VARS.minsRa(side)));
  }

  /** Line select key 1..10 (1-5 left top to bottom, 6-10 right). */
  lsk(side: 1 | 2, k: number): void {
    if (!this.powered(side) || k < 1 || k > 10) return;
    const s = this.st[side - 1];
    s.idle = 0;
    const v = this.vars;
    if (v.get(EPIC_VARS.smcStandby(side)) !== 0) {
      // Any LSK on the standby instrument brings up the controller menu.
      this.page(side, 'MENU');
      return;
    }
    const cycle = (name: string, n: number, first = 0): void => {
      const x = v.get(name) - first;
      v.set(name, first + ((x + 1) % n));
    };
    const toggle = (name: string): void => {
      v.set(name, v.get(name) !== 0 ? 0 : 1);
    };
    const selectItem = (): void => {
      s.sel = s.sel === k ? 0 : k;
    };
    switch (s.page) {
      case 'MENU':
        this.page(side, DC_MENU[k - 1]);
        return;
      case 'PFD':
        if (k === 1) toggle(EPIC_VARS.fpv(side));
        else if (k === 2) toggle(EPIC_VARS.svs(side));
        else if (k === 3) cycle(EPIC_VARS.hsiMode(side), 3);
        else if (k === 4) v.set(EPIC_VARS.brg1(side), nextBrg(v.get(EPIC_VARS.brg1(side)), 1, this.o.sensors));
        else if (k === 5) v.set(EPIC_VARS.brg2(side), nextBrg(v.get(EPIC_VARS.brg2(side)), 2, this.o.sensors));
        else if (k === 6) {
          toggle(EPIC_VARS.minsRa(side));
          this.writeMins(side);
        } else if (k === 7) selectItem();
        else if (k === 8) toggle(EPIC_VARS.baroHpa(side));
        else if (k === 9) this.cycleNavSrc(side);
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'MAP':
        if (k === 1) selectItem();
        else if (k === 2) cycle(EPIC_VARS.mapUp(side), 3);
        else if (k === 3) v.set(EPIC_VARS.mapOverlay(side), v.get(EPIC_VARS.mapOverlay(side)) === MapOverlay.Terrain ? MapOverlay.Off : MapOverlay.Terrain);
        else if (k === 4) v.set(EPIC_VARS.mapOverlay(side), v.get(EPIC_VARS.mapOverlay(side)) === MapOverlay.Weather ? MapOverlay.Off : MapOverlay.Weather);
        else if (k === 5) toggle(EPIC_VARS.mapShowTraffic(side));
        else if (k === 6) toggle(EPIC_VARS.mapCentered(side));
        else if (k === 7) toggle(EPIC_VARS.mapVsd(side));
        else if (k === 8) toggle(EPIC_VARS.mapShowAirports(side));
        else if (k === 9) toggle(EPIC_VARS.mapShowNavaids(side));
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'SENSOR':
        if (k === 1) cycle(EPIC_VARS.adcSel(side), this.o.sensors.adcCount, 1);
        else if (k === 2) cycle(EPIC_VARS.ahrsSel(side), this.o.sensors.ahrsCount, 1);
        else if (k === 3) cycle(EPIC_VARS.fmsNum(side), 3, 1);
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'FLT REF':
        if (k === 5) toggle(EPIC_VARS.vspeedsShown);
        else if (k === 10) this.page(side, 'MENU');
        else if (FLT_REF_ITEMS[k]) selectItem();
        return;
      case 'TEST':
        if (k === 1) this.startTest('hud');
        else if (k === 2) this.startTest('ra', side);
        else if (k === 3) this.startTest('stall');
        else if (k === 4) {
          this.startTest('tcas');
          this.events.emit('tcas.test');
        } else if (k === 6) this.events.emit(this.o.events.tawsTest);
        else if (k === 7) this.startTest('tone');
        else if (k === 8) this.startTest('apdisc');
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'CHKLST': {
        const mfd = side === 1 ? 2 : 3;
        const n = Math.max(1, this.o.checklistCount());
        if (k === 1) this.o.windows.select(mfd, 'lower', Win.Checklist);
        else if (k === 2) this.o.windows.select(mfd, 'main', Win.Checklist);
        else if (k === 3) v.set(EPIC_VARS.eclList, (v.get(EPIC_VARS.eclList) + 1) % n);
        else if (k === 4) v.set(EPIC_VARS.eclList, (v.get(EPIC_VARS.eclList) - 1 + n) % n);
        else if (k === 5) v.set(EPIC_VARS.eclList, -1);
        else if (k === 10) this.page(side, 'MENU');
        return;
      }
      case 'SYS':
      case 'SYS2': {
        if (k === 1) {
          s.sysTarget = ((s.sysTarget + 1) % 3) as 0 | 1 | 2;
          return;
        }
        if (k === 10) {
          this.page(side, s.page === 'SYS' ? 'SYS2' : 'MENU');
          return;
        }
        const list = s.page === 'SYS' ? SYS_PAGE1 : SYS_PAGE2;
        const w = list[k - 2];
        if (w === undefined) return;
        const mfd = side === 1 ? 2 : 3;
        this.o.windows.select(mfd, s.sysTarget === 0 ? 'main' : s.sysTarget === 1 ? 'upper' : 'lower', w);
        return;
      }
      case 'TRS':
        if (k >= 1 && k <= TRS_RATINGS.length) this.events.emit(this.o.events.thrustRating, TRS_RATINGS[k - 1]);
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'NAV':
        if (k === 1) this.cycleNavSrc(side);
        else if (k === 2) cycle(EPIC_VARS.fmsNum(side), 3, 1);
        else if (k === 3) {
          const r = this.navRx(side);
          toggle(NAV.dmeHold(r));
        } else if (k === 6 || k === 7) selectItem();
        else if (k === 10) this.page(side, 'MENU');
        return;
      case 'HUD':
        if (k === 1) toggle('epic.hud.on');
        else if (k === 2) cycle('epic.hud.dcltr', 3);
        else if (k === 3) selectItem();
        else if (k === 4) toggle(EPIC_VARS.evs(side));
        else if (k === 10) this.page(side, 'MENU');
        return;
    }
  }

  /** NAV SRC cycle: FMS -> NAV1 -> NAV2 (-> NAV3) -> FMS. */
  cycleNavSrc(side: 1 | 2): void {
    const v = this.vars;
    const n = this.o.sensors.navCount;
    const cur = v.get(EPIC_VARS.navSrc(side));
    v.set(EPIC_VARS.navSrc(side), (cur + 1) % (n + 1));
  }

  private startTest(name: string, side?: 1 | 2): void {
    this.tests[name] = TEST_S[name] ?? 3;
    if (side && name === 'ra') this.vars.set(EPIC_VARS.testRa(side), 1);
  }

  update(dt: number): void {
    const v = this.vars;
    for (const name of TEST_NAMES) {
      const t = this.tests[name];
      if (t > 0) this.tests[name] = Math.max(0, t - dt);
    }
    // Stall test: pilot shaker 0..3 s, copilot 4..7 s (FAA-described G650 SMC test).
    const st = this.tests.stall;
    const el = TEST_S.stall - st;
    v.set('epic.test.stall', st > 0 ? 1 : 0);
    v.set('epic.test.stall1', st > 0 && el < 3 ? 1 : 0);
    v.set('epic.test.stall2', st > 0 && el >= 4 && el < 7 ? 1 : 0);
    v.set('epic.test.hud', this.tests.hud > 0 ? 1 : 0);
    v.set('epic.test.tcas', this.tests.tcas > 0 ? 1 : 0);
    v.set('epic.test.tone', this.tests.tone > 0 ? 1 : 0);
    v.set('epic.test.apdisc', this.tests.apdisc > 0 ? 1 : 0);
    if (this.tests.ra <= 0) {
      v.set(EPIC_VARS.testRa(1), 0);
      v.set(EPIC_VARS.testRa(2), 0);
    }
    const back = this.o.returnToStandbyS ?? 30;
    for (const side of SIDES) {
      const s = this.st[side - 1];
      if (v.get(EPIC_VARS.smcStandby(side)) === 0) {
        s.idle += dt;
        if (s.idle > back) this.page(side, 'STBY');
      }
    }
  }

  private renderSide: 1 | 2 = 1;

  private put(k: number, label: string, value: string, color: DcLine['color'] = 'cyan', arrow = false): void {
    const l = this.lines[this.renderSide - 1][k - 1];
    l.label = label;
    l.value = value;
    l.color = color;
    l.selected = this.st[this.renderSide - 1].sel === k;
    l.arrow = arrow;
  }

  private onOff(name: string): string {
    return this.vars.get(name) !== 0 ? 'ON' : 'OFF';
  }

  /** Fills and returns the 10 LSK lines of the side's current page (no allocation for constant texts). */
  render(side: 1 | 2): readonly DcLine[] {
    const out = this.lines[side - 1];
    const s = this.st[side - 1];
    const v = this.vars;
    for (const l of out) {
      l.label = '';
      l.value = '';
      l.color = 'cyan';
      l.selected = false;
      l.arrow = false;
    }
    this.renderSide = side;
    switch (s.page) {
      case 'MENU':
        for (let k = 1; k <= 10; k++) this.put(k, '', MENU_LABELS[DC_MENU[k - 1]], 'white', true);
        break;
      case 'PFD':
        this.put(1, 'FPV', this.onOff(EPIC_VARS.fpv(side)));
        this.put(2, 'SVS', this.onOff(EPIC_VARS.svs(side)));
        this.put(3, 'HSI', HSI_NAMES[v.get(EPIC_VARS.hsiMode(side))] ?? 'ARC');
        this.put(4, 'BRG 1', BRG_NAMES[v.get(EPIC_VARS.brg1(side))] ?? 'OFF');
        this.put(5, 'BRG 2', BRG_NAMES[v.get(EPIC_VARS.brg2(side))] ?? 'OFF');
        this.put(6, 'MINS', v.get(EPIC_VARS.minsRa(side)) !== 0 ? 'RA' : 'BARO');
        this.put(7, 'MINS SET', fmtInt(v.get(EPIC_VARS.minsFt(side))));
        this.put(8, 'BARO', v.get(EPIC_VARS.baroHpa(side)) !== 0 ? 'HPA' : 'IN');
        this.put(9, 'NAV SRC', NAV_NAMES[v.get(EPIC_VARS.navSrc(side))] ?? 'FMS', 'green');
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'MAP':
        this.put(1, 'RANGE', fmtInt(v.get(EPIC_VARS.mapRange(side))));
        this.put(2, 'ORIENT', UP_NAMES[v.get(EPIC_VARS.mapUp(side))] ?? 'HDG');
        this.put(3, 'TERRAIN', v.get(EPIC_VARS.mapOverlay(side)) === MapOverlay.Terrain ? 'ON' : 'OFF');
        this.put(4, 'WX', v.get(EPIC_VARS.mapOverlay(side)) === MapOverlay.Weather ? 'ON' : 'OFF');
        this.put(5, 'TCAS', this.onOff(EPIC_VARS.mapShowTraffic(side)));
        this.put(6, 'CENTER', this.onOff(EPIC_VARS.mapCentered(side)));
        this.put(7, 'VSD', this.onOff(EPIC_VARS.mapVsd(side)));
        this.put(8, 'AIRPORTS', this.onOff(EPIC_VARS.mapShowAirports(side)));
        this.put(9, 'NAVAIDS', this.onOff(EPIC_VARS.mapShowNavaids(side)));
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'SENSOR':
        this.put(1, 'ADC', NUM_NAMES[v.get(EPIC_VARS.adcSel(side))] ?? '1', 'green');
        this.put(2, 'IRS', NUM_NAMES[v.get(EPIC_VARS.ahrsSel(side))] ?? '1', 'green');
        this.put(3, 'FMS', NUM_NAMES[v.get(EPIC_VARS.fmsNum(side))] ?? '1', 'green');
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'FLT REF':
        for (let k = 1; k <= 9; k++) {
          const n = FLT_REF_ITEMS[k];
          if (!n) continue;
          const x = v.get(EPIC_VARS.vspeed(n));
          this.put(k, FLT_REF_LABELS[n], x > 0 ? fmtInt(x) : '---');
        }
        this.put(5, 'SHOW', this.onOff(EPIC_VARS.vspeedsShown));
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'TEST':
        this.put(1, '', 'HUD', this.tests.hud > 0 ? 'green' : 'white');
        this.put(2, '', 'RAD ALT', this.tests.ra > 0 ? 'green' : 'white');
        this.put(3, '', 'STALL', this.tests.stall > 0 ? 'green' : 'white');
        this.put(4, '', 'TCAS', this.tests.tcas > 0 ? 'green' : 'white');
        this.put(6, '', 'EGPWS', v.get('taws.test') !== 0 ? 'green' : 'white');
        this.put(7, '', 'TONE', this.tests.tone > 0 ? 'green' : 'white', true);
        this.put(8, '', 'AP DISC', this.tests.apdisc > 0 ? 'green' : 'white');
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'CHKLST':
        this.put(1, '', 'CHKLST 1/6', 'white');
        this.put(2, '', 'CHKLST 2/3', 'white');
        this.put(3, '', 'NEXT LIST', 'white');
        this.put(4, '', 'PREV LIST', 'white');
        this.put(5, '', 'INDEX', 'white');
        this.put(10, '', 'RETURN', 'white');
        break;
      case 'SYS':
      case 'SYS2': {
        this.put(1, 'WINDOW', s.sysTarget === 0 ? '2/3' : s.sysTarget === 1 ? 'UPPER 1/6' : 'LOWER 1/6', 'green');
        const list = s.page === 'SYS' ? SYS_PAGE1 : SYS_PAGE2;
        for (let i = 0; i < list.length && i < 8; i++) this.put(i + 2, '', SHORT_NAMES[list[i]] ?? WIN_NAMES[list[i]], 'white');
        this.put(10, '', s.page === 'SYS' ? 'MORE' : 'RETURN', 'white', s.page === 'SYS');
        break;
      }
      case 'TRS': {
        const cur = v.getString('fadec.rating');
        for (let i = 0; i < TRS_RATINGS.length; i++) this.put(i + 1, '', TRS_RATINGS[i], TRS_RATINGS[i] === cur ? 'green' : 'white');
        this.put(10, '', 'RETURN', 'white');
        break;
      }
      case 'NAV': {
        const r = this.navRx(side);
        this.put(1, 'NAV SRC', NAV_NAMES[v.get(EPIC_VARS.navSrc(side))] ?? 'FMS', 'green');
        this.put(2, 'FMS', NUM_NAMES[v.get(EPIC_VARS.fmsNum(side))] ?? '1', 'green');
        this.put(3, 'DME HOLD', this.onOff(NAV.dmeHold(r)));
        this.put(6, 'NAV FREQ', fmtFixed(v.get(NAV.activeFreq(r), 108), 2), 'green');
        this.put(7, 'CRS', fmtInt(v.get(NAV.obs(r))));
        this.put(10, '', 'RETURN', 'white');
        break;
      }
      case 'HUD':
        this.put(1, 'HUD', this.onOff('epic.hud.on'));
        this.put(2, 'DCLTR', NUM_NAMES[v.get('epic.hud.dcltr')] ?? '0');
        this.put(3, 'BRT', fmtInt(v.get('epic.hud.brt') * 100));
        this.put(4, 'EVS PFD', this.onOff(EPIC_VARS.evs(side)));
        this.put(10, '', 'RETURN', 'white');
        break;
    }
    return out;
  }

  /** Page title for the SMC / TSC header. */
  title(side: 1 | 2): string {
    const p = this.st[side - 1].page;
    return p === 'MENU' ? 'DISPLAY CONTROL' : p === 'SYS' || p === 'SYS2' ? 'SYSTEMS 1/6-2/3' : p;
  }
}

function makeLines(): DcLine[] {
  const a: DcLine[] = [];
  for (let i = 0; i < 10; i++) a.push({ label: '', value: '', color: 'cyan', selected: false, arrow: false });
  return a;
}

function nextBrg(cur: number, pointer: 1 | 2, sen: EpicSensors): number {
  // Pointer 1: OFF -> NAV1 -> ADF1 -> FMS -> OFF; pointer 2: OFF -> NAV2 -> ADF2 -> FMS -> OFF.
  const order = pointer === 1 ? BRG1_ORDER : BRG2_ORDER;
  let i = order.indexOf(cur);
  for (let n = 0; n < order.length; n++) {
    i = (i + 1) % order.length;
    const b = order[i];
    if ((b === BrgSrc.Adf1 && sen.adfCount < 1) || (b === BrgSrc.Adf2 && sen.adfCount < 2) || (b === BrgSrc.Nav2 && sen.navCount < 2)) continue;
    return b;
  }
  return BrgSrc.Off;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function wrap360(d: number): number {
  const r = d % 360;
  return r <= 0 ? r + 360 : r;
}

const SIDES = [1, 2] as const;
const TEST_NAMES = ['hud', 'ra', 'stall', 'tcas', 'tone', 'apdisc'] as const;
/** Map ranges (nm): EST Primus Epic set (common/draw MAP_HONEYWELL). */
export const RANGES: readonly number[] = [1, 2, 5, 10, 25, 50, 100, 200, 300, 500, 1000];
const DC_PAGE_CODES: readonly DcPageId[] = ['MENU', 'PFD', 'MAP', 'SENSOR', 'FLT REF', 'TEST', 'CHKLST', 'SYS', 'SYS2', 'TRS', 'NAV', 'HUD'];
const BRG1_ORDER: readonly number[] = [BrgSrc.Off, BrgSrc.Nav1, BrgSrc.Adf1, BrgSrc.Fms];
const BRG2_ORDER: readonly number[] = [BrgSrc.Off, BrgSrc.Nav2, BrgSrc.Adf2, BrgSrc.Fms];
const HSI_NAMES: Record<number, string> = { [HsiMode.Rose]: 'ROSE', [HsiMode.Arc]: 'ARC', [HsiMode.Map]: 'MAP' };
const BRG_NAMES: Record<number, string> = { [BrgSrc.Off]: 'OFF', [BrgSrc.Nav1]: 'VOR1', [BrgSrc.Nav2]: 'VOR2', [BrgSrc.Adf1]: 'ADF1', [BrgSrc.Adf2]: 'ADF2', [BrgSrc.Fms]: 'FMS' };
const NAV_NAMES: Record<number, string> = { [NavSrc.Fms]: 'FMS', [NavSrc.Nav1]: 'NAV1', [NavSrc.Nav2]: 'NAV2', [NavSrc.Nav3]: 'NAV3' };
const UP_NAMES: Record<number, string> = { [MapUp.Heading]: 'HDG UP', [MapUp.Track]: 'TRK UP', [MapUp.North]: 'NORTH UP' };
const NUM_NAMES: Record<number, string> = { 0: '0', 1: '1', 2: '2', 3: '3' };
/** FLT REF page: LSK -> V-speed name (5 = SHOW, 10 = RETURN). */
const FLT_REF_ITEMS: Record<number, string> = { 1: 'v1', 2: 'vr', 3: 'v2', 4: 'vfs', 6: 'vref', 7: 'vapp' };
const FLT_REF_LABELS: Record<string, string> = { v1: 'V1', vr: 'VR', v2: 'V2', vfs: 'VFS', vref: 'VREF', vapp: 'VAPP' };
const SYS_PAGE1: readonly Win[] = SYNOPTIC_WINDOWS.slice(0, 8);
const SYS_PAGE2: readonly Win[] = [...SYNOPTIC_WINDOWS.slice(8), Win.Engine, Win.Engine2, Win.Cas, Win.WptList];
const SHORT_NAMES: Partial<Record<number, string>> = {
  [Win.SynSummary]: 'SUMMARY',
  [Win.SynAcPower]: 'AC PWR',
  [Win.SynDcPower]: 'DC PWR',
  [Win.SynHydraulics]: 'HYD',
  [Win.SynFuel]: 'FUEL',
  [Win.SynEcs]: 'ECS/PRESS',
  [Win.SynDoors]: 'DOORS',
  [Win.SynFlightControls]: 'FLT CTRL',
  [Win.SynIce]: 'ICE',
  [Win.SynBrakes]: 'BRAKES',
  [Win.SynApuBleed]: 'APU/BLEED',
  [Win.SynEngineStart]: 'ENG START',
  [Win.Engine]: 'ENGINE',
  [Win.Engine2]: 'ENG 2ND',
  [Win.Cas]: 'CAS',
  [Win.WptList]: 'WPT LIST',
};
