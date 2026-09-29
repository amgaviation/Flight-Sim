/**
 * MFD page navigation (PG 190-02177-02 §1.4 "MFD Page Groups"): pages are
 * grouped MAP, WPT, AUX, FPL, NRST. With no cursor on the page, the large
 * FMS knob changes the page group and the small knob the page within the
 * group; the 'page group window' in the lower right corner shows the group
 * tabs and page titles (current in cyan) and times out (EST 3 s: "Page Group
 * Window seconds until timeout" is configurable on Aux - System Setup 2,
 * default not published). Pressing FPL shows 'FPL - Active Flight Plan'
 * (again: back to the previous page); PROC shows the Procedures window; D→
 * the Direct-to window; the Checklist softkey the checklist page; holding CLR
 * for 2 s returns to 'Map - Navigation Map' (DFLT MAP).
 */
import type { G1000System } from './System';
import {
  AirportInfoPage,
  ChecklistPage,
  DirectToPage,
  FplPage,
  GpsStatusPage,
  NavaidInfoPage,
  NavMapPage,
  NearestAirportsPage,
  NearestNavaidPage,
  ProcLoadingPage,
  ProcPage,
  SystemSetupPage,
  SystemStatusPage,
  TerrainPage,
  TrafficMapPage,
  TripPlanningPage,
  UtilityPage,
  type Page,
} from './pages';
import { G1K } from '../vars';

export interface PageGroup {
  id: 'MAP' | 'WPT' | 'AUX' | 'FPL' | 'NRST';
  pages: Page[];
}

/** EST page group window timeout (s). */
export const PAGE_GROUP_WINDOW_S = 3;
/** CLR held this long shows the Navigation Map (PG §1.2: "Press and hold CLR ... DFLT MAP"). */
export const CLR_HOLD_S = 2;

export type MfdOverlay = 'none' | 'dto' | 'proc' | 'procload' | 'checklist';

export class MfdState {
  readonly groups: PageGroup[];
  readonly navMap: NavMapPage;
  readonly fpl: FplPage;
  readonly dto: DirectToPage;
  readonly proc: ProcPage;
  readonly procLoad: ProcLoadingPage;
  readonly checklist: ChecklistPage;
  readonly setup: SystemSetupPage;
  readonly airportInfo: AirportInfoPage;
  group = 0;
  /** Page index per group (each group remembers its page). */
  readonly pageIdx: number[];
  /** Page group window time left (s). */
  groupWindowS = 0;
  overlay: MfdOverlay = 'none';
  /** Page shown before FPL was pressed (FPL again returns to it). */
  private beforeFpl: { group: number; page: number } | null = null;
  private clrHeldS = -1;

  constructor(private readonly sys: G1000System) {
    this.navMap = new NavMapPage(sys);
    this.fpl = new FplPage(sys, true);
    this.dto = new DirectToPage(sys);
    this.proc = new ProcPage(sys);
    this.proc.screen = 'mfd';
    this.procLoad = new ProcLoadingPage(sys);
    this.checklist = new ChecklistPage(sys);
    this.setup = new SystemSetupPage(sys);
    this.airportInfo = new AirportInfoPage(sys);
    this.groups = [
      { id: 'MAP', pages: [this.navMap, new TrafficMapPage(sys), new TerrainPage(sys)] },
      { id: 'WPT', pages: [this.airportInfo, new NavaidInfoPage(sys, 'int'), new NavaidInfoPage(sys, 'vor'), new NavaidInfoPage(sys, 'ndb')] },
      { id: 'AUX', pages: [new TripPlanningPage(sys), new UtilityPage(sys), new GpsStatusPage(sys), this.setup, new SystemStatusPage(sys)] },
      { id: 'FPL', pages: [this.fpl] },
      { id: 'NRST', pages: [new NearestAirportsPage(sys, 'mfd'), new NearestNavaidPage(sys, 'int'), new NearestNavaidPage(sys, 'vor'), new NearestNavaidPage(sys, 'ndb')] },
    ];
    this.pageIdx = this.groups.map(() => 0);
  }

  /** The page in the page group structure (under any overlay). */
  get basePage(): Page {
    return this.groups[this.group].pages[this.pageIdx[this.group]];
  }

  /** The page receiving the knobs / softkeys. */
  get page(): Page {
    switch (this.overlay) {
      case 'dto':
        return this.dto;
      case 'proc':
        return this.proc;
      case 'procload':
        return this.procLoad;
      case 'checklist':
        return this.checklist;
      default:
        return this.basePage;
    }
  }

  private publish(): void {
    this.sys.vars.set(G1K.mfdGroup, this.group);
    this.sys.vars.set(G1K.mfdPage, this.pageIdx[this.group]);
    this.sys.mfdPageChanged();
  }

  select(group: number, page: number): void {
    const cur = this.basePage;
    const g = Math.max(0, Math.min(this.groups.length - 1, group));
    const p = Math.max(0, Math.min(this.groups[g].pages.length - 1, page));
    this.group = g;
    this.pageIdx[g] = p;
    const next = this.basePage;
    if (next !== cur) {
      cur.hide();
      next.show();
    }
    this.publish();
  }

  /** Selects a page by id (e.g. 'map_nav'). */
  selectById(id: string): void {
    for (let g = 0; g < this.groups.length; g++) {
      const p = this.groups[g].pages.findIndex((x) => x.id === id);
      if (p >= 0) {
        this.closeOverlay();
        this.select(g, p);
        return;
      }
    }
  }

  /** Large FMS knob without a cursor: page group; small knob: page (the page group window opens). */
  groupTurn(clicks: number): void {
    const n = this.groups.length;
    this.select((((this.group + clicks) % n) + n) % n, this.pageIdx[(((this.group + clicks) % n) + n) % n]);
    this.groupWindowS = PAGE_GROUP_WINDOW_S;
  }

  pageTurn(clicks: number): void {
    const pages = this.groups[this.group].pages;
    const n = pages.length;
    this.select(this.group, (((this.pageIdx[this.group] + clicks) % n) + n) % n);
    this.groupWindowS = PAGE_GROUP_WINDOW_S;
  }

  // ---------------------------------------------------------------- overlays

  openOverlay(o: MfdOverlay): void {
    if (this.overlay !== 'none') this.page.hide();
    this.overlay = o;
    if (o !== 'none') this.page.show();
    this.sys.mfdPageChanged();
  }

  closeOverlay(): void {
    if (this.overlay === 'none') return;
    this.page.hide();
    this.overlay = 'none';
    this.sys.mfdPageChanged();
  }

  /** FPL key: Active Flight Plan page; pressed again returns to the previous page. */
  fplKey(): void {
    this.closeOverlay();
    const fplGroup = this.groups.findIndex((g) => g.id === 'FPL');
    if (this.group === fplGroup && this.beforeFpl) {
      const b = this.beforeFpl;
      this.beforeFpl = null;
      this.select(b.group, b.page);
      return;
    }
    this.beforeFpl = { group: this.group, page: this.pageIdx[this.group] };
    this.select(fplGroup, 0);
  }

  /** CLR pressed (hold detection) / released. */
  clrDown(): void {
    this.clrHeldS = 0;
  }
  clrUp(): void {
    this.clrHeldS = -1;
  }

  update(dt: number): void {
    if (this.groupWindowS > 0) this.groupWindowS = Math.max(0, this.groupWindowS - dt);
    if (this.clrHeldS >= 0) {
      this.clrHeldS += dt;
      if (this.clrHeldS >= CLR_HOLD_S) {
        this.clrHeldS = -1;
        this.selectById('map_nav');
      }
    }
  }
}
