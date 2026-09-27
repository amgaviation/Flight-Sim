/**
 * Windows and pages driven by the FMS knob, ENT, CLR and MENU (PG
 * 190-02177-02 §1.4 "Menus", §2 PFD windows, §5 Flight Management, §8
 * Additional Features). Each page owns a `Form` (cursor model, forms.ts) and
 * its own data; the GDU renderers draw them. The same classes serve the PFD
 * windows (Direct-to, Flight Plan, Procedures, Nearest Airports, Timer /
 * References, Alerts, DME) and the MFD pages.
 *
 * Everything here is UI-independent and allocation happens only on key
 * presses and slow refreshes (lists rebuilt at most every 2-5 s), never in
 * the 60 Hz update.
 */
import { distanceNm, initialBearing } from '../../../core/geo';
import { wrap360 } from '../../../core/math';
import type { Airport, Navaid, Procedure, Waypoint } from '../../../nav/types';
import { legIdent, type FplRow } from '../../garmin-g3000/state/FplEditor';
import { fmtCom, fmtNav } from '../../garmin-g3000/format';
import type { G1000System } from './System';
import { Form, type Field } from './forms';
import { G1K, MINS_MODE } from '../vars';

export interface MenuItem {
  label: string;
  enabled?: boolean;
  run: () => void;
}

/** Screen that shows a page: the PFD (windows) or the MFD (pages). */
export type Screen = 'pfd' | 'mfd';

export abstract class Page {
  readonly form = new Form();
  abstract readonly id: string;
  /** Softkey root level for this page on the MFD ('' = keep the current). */
  softkeys = 'nav';
  constructor(protected readonly sys: G1000System) {}
  abstract title(): string;
  /** Page / window became visible. */
  show(): void {}
  /** Page / window hidden (the cursor is removed). */
  hide(): void {
    this.form.deactivate();
  }
  /** MENU key options ('No Options' when empty, PG §1.4). */
  menu(): MenuItem[] {
    return [];
  }
  ent(): boolean {
    return this.form.ent();
  }
  clr(): boolean {
    return this.form.clr();
  }
  /** Identifier under the cursor (the Direct-to window preselects it, PG §5.4). */
  cursorIdent(): string {
    return '';
  }
  /** Slow update (1 Hz-ish refreshes); `dt` since the last call. */
  update(_dt: number): void {}
}

// ================================================================ helpers

export interface Pos {
  lat: number;
  lon: number;
  valid: boolean;
}

export function brgDist(p: Pos, lat: number, lon: number, magVar: number): { brg: number; dist: number } {
  if (!p.valid) return { brg: NaN, dist: NaN };
  return { brg: wrap360(initialBearing(p.lat, p.lon, lat, lon) - magVar), dist: distanceNm(p.lat, p.lon, lat, lon) };
}

/** First database match of an identifier prefix (auto-completion). Airports first, then navaids / fixes. */
export function completeIdent(sys: G1000System, prefix: string): string {
  const p = prefix.trim().toUpperCase();
  if (!p) return '';
  const db = sys.nav;
  if (db.airport(p)) return p;
  const exact = sys.resolve(p);
  if (exact.length) return exact[0].ident;
  const apts = db.searchAirports(p, 1);
  if (apts.length && apts[0].icao.startsWith(p)) return apts[0].icao;
  return '';
}

/** Longest runway (ft) of an airport. */
export function longestRunwayFt(a: Airport): number {
  let m = 0;
  for (const r of a.runways) if (r.lengthFt > m) m = r.lengthFt;
  return m;
}

/** Best COM frequency of an airport for the nearest list: TWR, then CTAF/UNICOM, then any. */
export function primaryCom(a: Airport): { type: string; mhz: number } | null {
  const f = a.frequencies;
  const pick = (re: RegExp): { type: string; mhz: number } | null => {
    const x = f.find((q) => re.test(q.type) && q.mhz >= 118 && q.mhz < 137);
    return x ? { type: x.type, mhz: x.mhz } : null;
  };
  return pick(/TWR|TOWER/i) ?? pick(/CTAF|UNIC|UNICOM|AFIS/i) ?? pick(/.*/);
}

/** Best approach available at an airport for the nearest list (ILS > RNAV > VOR > VFR). */
export function approachClass(a: Airport): string {
  if (a.runways.some((r) => r.ils && r.ils.gsAngleDeg !== undefined)) return 'ILS';
  if (a.runways.some((r) => r.ils)) return 'LOC';
  return a.type === 'large_airport' || a.type === 'medium_airport' ? 'RNAV' : 'VFR';
}

/** Loads a tuned frequency into the right standby: VHF NAV (108-117.95) or COM (118-136.99). */
export function loadStandby(sys: G1000System, mhz: number): string {
  if (mhz >= 108 && mhz < 118) {
    sys.radios.setNavStandby(sys.radios.navBox, mhz);
    return `NAV${sys.radios.navBox} ${fmtNav(mhz)}`;
  }
  if (mhz >= 118 && mhz < 137) {
    sys.radios.setComStandby(sys.radios.comBox, mhz);
    return `COM${sys.radios.comBox} ${fmtCom(mhz)}`;
  }
  return '';
}

// ================================================================ Direct-to

/**
 * Direct-to window (PG §5.4 "Direct-to Navigation"): the D→ key opens it with
 * the active (or cursor-selected) waypoint; the small / large FMS knobs enter
 * another identifier (auto-completed), ENT confirms and moves the cursor to
 * 'Activate?', ENT again flies direct. Optional course (CRS) field: a course
 * to the waypoint instead of from present position. MENU offers 'Cancel
 * Direct-To NAV' while a direct-to is active.
 */
export class DirectToPage extends Page {
  readonly id = 'dto';
  ident = '';
  courseDeg = 0;
  /** Resolved waypoint of `ident` (null = not found). */
  target: Waypoint | null = null;
  airport: Airport | null = null;
  navaid: Navaid | null = null;
  constructor(sys: G1000System) {
    super(sys);
    const fields: Field[] = [
      {
        id: 'ident',
        kind: 'text',
        maxLen: 6,
        get: () => this.ident,
        commit: (t) => this.setIdent(t),
        complete: (p) => completeIdent(sys, p),
      },
      {
        id: 'crs',
        kind: 'number',
        get: () => this.courseDeg,
        set: (v) => (this.courseDeg = v),
        step: 1,
        bigStep: 10,
        min: 0,
        max: 360,
        wrap: true,
      },
      { id: 'activate', kind: 'action', label: () => 'Activate?', run: () => this.activate(), enabled: () => !!this.target },
    ];
    this.form.setFields(fields);
  }
  title(): string {
    return 'Direct To';
  }
  /** Opens with a preselected identifier (active waypoint or cursor selection). */
  open(ident: string): void {
    this.courseDeg = 0;
    this.setIdent(ident);
    this.form.activate(this.target ? 'activate' : 'ident');
  }
  setIdent(t: string): boolean {
    const id = t.trim().toUpperCase();
    this.ident = id;
    this.target = null;
    this.airport = null;
    this.navaid = null;
    if (!id) return false;
    const c = this.sys.resolve(id);
    if (!c.length) return false;
    this.target = c[0];
    this.airport = this.sys.nav.airport(id) ?? null;
    this.navaid = c[0].navaid ?? null;
    // The course field defaults to the bearing to the waypoint (PG: "CRS ... defaults to the direct course").
    const p = this.sys.pos();
    if (p.valid) this.courseDeg = Math.round(brgDist(p, c[0].lat, c[0].lon, this.sys.magVar()).brg) || 360;
    return true;
  }
  activate(): void {
    const fpl = this.sys.fpl;
    const t = this.target;
    if (!fpl || !t) return;
    const plan = fpl.plan;
    // A waypoint already in the flight plan: direct to that leg (keeps the plan sequence).
    let idx = -1;
    for (let i = plan.legs.length - 1; i >= 0; i--) {
      if (plan.legs[i].fix?.ident === t.ident && plan.legs[i].segment !== 'missed') {
        idx = i;
        break;
      }
    }
    const p = this.sys.pos();
    const direct = p.valid ? Math.round(brgDist(p, t.lat, t.lon, this.sys.magVar()).brg) || 360 : 0;
    const course = this.courseDeg > 0 && Math.abs(((this.courseDeg - direct + 540) % 360) - 180) > 0.5 ? this.courseDeg : undefined;
    const ok = idx >= 0 ? fpl.directTo(idx, course) : fpl.directTo(t, course);
    if (ok) this.sys.closeWindow('dto');
  }
  override menu(): MenuItem[] {
    const leg = this.sys.fpl?.plan.activeLeg;
    return [{ label: 'Cancel Direct-To NAV', enabled: !!leg && leg.type === 'DF', run: () => this.sys.cancelDirectTo() }];
  }
  /** Bearing / distance to the selected waypoint (window data). */
  brgDist(): { brg: number; dist: number } {
    const t = this.target;
    return t ? brgDist(this.sys.pos(), t.lat, t.lon, this.sys.magVar()) : { brg: NaN, dist: NaN };
  }
}

// ================================================================ Procedures window

/**
 * PROC key: 'Procedures' window (PG §5.8 "Procedures"): Activate
 * Vector-to-Final, Activate Approach, Activate Missed Approach, Select
 * Approach, Select Arrival, Select Departure. The loaded procedures are
 * listed under the options.
 */
export class ProcPage extends Page {
  readonly id = 'proc';
  readonly items: { label: string; enabled: () => boolean; run: () => void }[];
  constructor(sys: G1000System) {
    super(sys);
    const apprLoaded = (): boolean => !!sys.fpl?.plan.approachProcedure;
    const apprActive = (): boolean => sys.vars.get('fms.approach_active') >= 0.5;
    this.items = [
      { label: 'Activate Vector-to-Final', enabled: () => apprLoaded(), run: () => sys.fpl?.activateVtf() },
      { label: 'Activate Approach', enabled: () => apprLoaded(), run: () => sys.fpl?.activateApproach() },
      { label: 'Activate Missed Approach', enabled: () => apprLoaded() && apprActive(), run: () => sys.fpl?.activateMissedApproach() },
      { label: 'Select Approach', enabled: () => true, run: () => sys.openProcLoading(this.screen, 'approach') },
      { label: 'Select Arrival', enabled: () => true, run: () => sys.openProcLoading(this.screen, 'arrival') },
      { label: 'Select Departure', enabled: () => true, run: () => sys.openProcLoading(this.screen, 'departure') },
    ];
    this.form.setFields([
      {
        id: 'list',
        kind: 'list',
        count: () => this.items.length,
        selectable: (r) => this.items[r].enabled(),
        onEnter: (r) => {
          const it = this.items[r];
          if (!it.enabled()) return;
          const opensPage = r >= 3;
          if (!opensPage) sys.closeWindow('proc');
          it.run();
        },
      },
    ]);
  }
  /** Screen that opened the window (PFD or MFD) for the follow-up page. */
  screen: Screen = 'pfd';
  title(): string {
    return 'Procedures';
  }
  override show(): void {
    this.form.activate('list');
    // Default highlight: 'Activate Approach' when an approach is loaded, else 'Select Approach' (PG Figure 5-66).
    this.form.row = this.items[1].enabled() ? 1 : 3;
  }
  /** Loaded procedure summaries (under the list). */
  loaded(): { departure: string; arrival: string; approach: string } {
    const p = this.sys.fpl?.plan;
    return {
      departure: p?.sid ? `${p.origin?.icao ?? ''}-${p.sid.ident}` : '',
      arrival: p?.star ? `${p.destination?.icao ?? ''}-${p.star.ident}` : '',
      approach: p?.approachProcedure ? `${p.destination?.icao ?? ''}-${p.approachProcedure.name}` : '',
    };
  }
}

// ================================================================ Procedure loading

export type ProcKind = 'approach' | 'arrival' | 'departure';

/**
 * Approach / Arrival / Departure loading (PG §5.8, Figure 5-69: MFD 'Proc -
 * Approach Loading' page; PFD 'Approach' window): airport, procedure,
 * transition (approach: including 'Vectors' = VTF), runway (arrival /
 * departure), approach minimums (MINS: Off / BARO / TEMP COMP and value,
 * which set the PFD minimums), then 'LOAD?' or 'ACTIVATE?'.
 */
export class ProcLoadingPage extends Page {
  readonly id = 'procload';
  kind: ProcKind = 'approach';
  airport = '';
  procIndex = 0;
  transIndex = 0;
  rwyIndex = 0;
  minsMode = 0;
  minsFt = 0;
  message = '';
  override softkeys = 'procload';
  constructor(sys: G1000System) {
    super(sys);
    this.form.setFields([
      { id: 'apt', kind: 'text', maxLen: 4, get: () => this.airport, commit: (t) => this.setAirport(t), complete: (p) => this.completeAirport(p) },
      {
        id: 'proc',
        kind: 'select',
        options: () => this.procNames(),
        get: () => this.procIndex,
        set: (i) => {
          this.procIndex = i;
          this.transIndex = 0;
          this.rwyIndex = 0;
        },
        enabled: () => this.procs().length > 0,
      },
      { id: 'trans', kind: 'select', options: () => this.transNames(), get: () => this.transIndex, set: (i) => (this.transIndex = i), enabled: () => this.transNames().length > 0 },
      { id: 'rwy', kind: 'select', options: () => this.rwyNames(), get: () => this.rwyIndex, set: (i) => (this.rwyIndex = i), enabled: () => this.kind !== 'approach' && this.rwyNames().length > 0 },
      { id: 'mins', kind: 'select', options: () => ['OFF', 'BARO', 'TEMP COMP'], get: () => this.minsMode, set: (i) => (this.minsMode = i), enabled: () => this.kind === 'approach' },
      { id: 'minsft', kind: 'number', get: () => this.minsFt, set: (v) => (this.minsFt = v), step: 10, bigStep: 100, min: 0, max: 16000, enabled: () => this.kind === 'approach' && this.minsMode > 0 },
      { id: 'load', kind: 'action', label: () => 'LOAD?', run: () => this.load('load'), enabled: () => !!this.selected() },
      { id: 'activate', kind: 'action', label: () => 'ACTIVATE?', run: () => this.load('activate'), enabled: () => this.kind === 'approach' && !!this.selected() },
    ]);
  }
  title(): string {
    return this.kind === 'approach' ? 'Proc - Approach Loading' : this.kind === 'arrival' ? 'Proc - Arrival Loading' : 'Proc - Departure Loading';
  }
  open(kind: ProcKind, airport?: string): void {
    this.kind = kind;
    const p = this.sys.fpl?.plan;
    const def = kind === 'departure' ? p?.origin?.icao : p?.destination?.icao;
    this.setAirport(airport ?? def ?? this.nearestAirportIdent());
    this.procIndex = 0;
    this.transIndex = 0;
    this.rwyIndex = 0;
    this.minsMode = this.sys.refs.mins.mode;
    this.minsFt = this.sys.refs.mins.valueFt;
    this.message = '';
    this.form.activate(this.airport ? 'proc' : 'apt');
  }
  private nearestAirportIdent(): string {
    const p = this.sys.pos();
    if (!p.valid) return '';
    const a = this.sys.nav.airportsNear(p.lat, p.lon, 50, 1);
    return a[0]?.icao ?? '';
  }
  private completeAirport(prefix: string): string {
    const p = prefix.trim().toUpperCase();
    if (this.sys.nav.airport(p)) return p;
    const a = this.sys.nav.searchAirports(p, 1);
    return a.length && a[0].icao.startsWith(p) ? a[0].icao : '';
  }
  setAirport(t: string): boolean {
    const id = t.trim().toUpperCase();
    if (id && !this.sys.nav.airport(id)) return false;
    this.airport = id;
    this.procIndex = 0;
    this.transIndex = 0;
    this.rwyIndex = 0;
    if (id) this.sys.fpl?.procedures(id); // start loading
    return true;
  }
  /** Procedures of the kind at the airport ([] while loading). */
  procs(): Procedure[] {
    if (!this.airport || !this.sys.fpl) return [];
    const ap = this.sys.fpl.procedures(this.airport);
    if (!ap) return [];
    return this.kind === 'approach' ? ap.approaches : this.kind === 'arrival' ? ap.stars : ap.sids;
  }
  loading(): boolean {
    return !!this.airport && !!this.sys.fpl && !this.sys.fpl.procedures(this.airport);
  }
  procNames(): string[] {
    return this.procs().map((p) => p.name);
  }
  selected(): Procedure | null {
    return this.procs()[this.procIndex] ?? null;
  }
  transNames(): string[] {
    const p = this.selected();
    if (!p) return [];
    const t = p.transitions.map((x) => x.name);
    // Approaches: 'Vectors' flies vectors to final (PG §5.8 "Vectors-to-Final").
    if (this.kind === 'approach') return ['Vectors', ...t];
    return t;
  }
  rwyNames(): string[] {
    const p = this.selected();
    if (!p) return [];
    const r = p.runwayTransitions.map((x) => x.name).filter((n) => n !== 'ALL');
    return r;
  }
  load(mode: 'load' | 'activate'): void {
    const fpl = this.sys.fpl;
    const p = this.selected();
    if (!fpl || !p) return;
    const tn = this.transNames()[this.transIndex];
    let ok = false;
    if (this.kind === 'approach') {
      const vtf = tn === 'Vectors';
      ok = fpl.loadApproach(this.airport, p.ident, vtf ? undefined : tn, mode === 'activate' ? (vtf ? 'vtf' : 'activate') : 'load');
      if (ok) {
        // Approach minimums entered on the loading page set the PFD minimums (PG §5.8, §2.4).
        const m = this.sys.refs.mins;
        m.setMode(this.minsMode === 2 ? MINS_MODE.tempComp : this.minsMode === 1 ? MINS_MODE.baro : MINS_MODE.off);
        if (this.minsMode > 0) m.setValue(this.minsFt);
      }
    } else if (this.kind === 'arrival') {
      if (fpl.plan.destination?.icao !== this.airport) fpl.setDestination(this.airport);
      ok = fpl.loadArrival(p.ident, tn, this.rwyNames()[this.rwyIndex]);
    } else {
      if (fpl.plan.origin?.icao !== this.airport) fpl.setOrigin(this.airport);
      ok = fpl.loadDeparture(p.ident, this.rwyNames()[this.rwyIndex], tn);
    }
    this.message = ok ? '' : fpl.lastError;
    if (ok) this.sys.closeWindow('procload');
  }
}

// ================================================================ Flight plan

/** Flight plan row with leg data (DTK / DIS / cumulative / altitude). */
export interface FplRowData extends FplRow {
  dtk: number;
  dis: number;
  cum: number;
  alt: string;
}

/**
 * Active flight plan (PG §5.6: PFD 'Flight Plan' window and MFD 'FPL -
 * Active Flight Plan' page). The large knob moves the cursor over the
 * waypoints (headers are skipped); turning the small knob on a waypoint
 * opens identifier entry that inserts before it (on the empty last row it
 * appends); CLR on a waypoint asks 'Remove <ident>?'; ENT on a waypoint shows
 * nothing. MENU: Activate Leg, Delete Flight Plan, Remove Departure /
 * Arrival / Approach, Store Flight Plan (SCOPE: catalog not modelled).
 */
export class FplPage extends Page {
  readonly id = 'fpl';
  rows: FplRowData[] = [];
  private lastVersion = -1;
  /** Waypoint insertion in progress (row index, entered text shown by the renderer). */
  inserting = -1;
  insertError = '';
  override softkeys = 'fpl';
  private readonly insertForm = new Form();
  constructor(sys: G1000System, readonly wide: boolean) {
    super(sys);
    this.form.setFields([
      {
        id: 'legs',
        kind: 'list',
        count: () => this.rows.length + 1, // + the empty entry row at the end
        selectable: (r) => r >= this.rows.length || this.rows[r].kind !== 'header',
        onInner: (r, clicks) => this.beginInsert(r, clicks),
        onClear: (r) => this.askRemove(r),
      },
    ]);
    this.insertForm.setFields([
      {
        id: 'ins',
        kind: 'text',
        maxLen: 6,
        get: () => '',
        commit: (t) => this.commitInsert(t),
        complete: (p) => completeIdent(sys, p),
      },
    ]);
  }
  title(): string {
    return this.wide ? 'FPL - Active Flight Plan' : 'Active Flight Plan';
  }
  /** Form receiving the knobs (the insertion entry while inserting). */
  get activeForm(): Form {
    return this.inserting >= 0 ? this.insertForm : this.form;
  }
  get insertText(): string {
    return this.insertForm.text;
  }
  override show(): void {
    this.refresh(true);
    if (!this.wide) {
      // PFD window: the cursor is on the active leg (PG §5.6 "the cursor ... is not required on the PFD").
      this.form.activate('legs');
      const i = this.rows.findIndex((r) => r.active);
      if (i >= 0) this.form.row = i;
    }
  }
  override update(): void {
    this.refresh(false);
  }
  refresh(force: boolean): void {
    const fpl = this.sys.fpl;
    if (!fpl) {
      this.rows = [];
      return;
    }
    const ver = this.sys.vars.get('fms.plan_version');
    if (!force && ver === this.lastVersion) return;
    this.lastVersion = ver;
    const mv = this.sys.magVar();
    const plan = fpl.plan;
    let cum = 0;
    this.rows = fpl.rows().map((r) => {
      const leg = r.legIndex >= 0 ? plan.legs[r.legIndex] : undefined;
      const g = leg?.geom;
      const dis = g && g.valid ? g.lengthNm : NaN;
      if (Number.isFinite(dis)) cum += dis;
      const alt = leg?.altitude;
      let altTxt = '';
      if (alt && alt.lowerFt !== undefined) altTxt = `${Math.round(alt.lowerFt)}FT`;
      return { ...r, dtk: g && g.valid ? wrap360(g.courseTrue - mv) : NaN, dis, cum: Number.isFinite(dis) ? cum : NaN, alt: altTxt };
    });
  }
  override cursorIdent(): string {
    const r = this.rows[this.form.row];
    return this.form.active && r && r.kind !== 'header' ? r.text : '';
  }
  /** Leg index of the highlighted row (-1 none). */
  cursorLeg(): number {
    const r = this.rows[this.form.row];
    return r ? r.legIndex : -1;
  }
  private beginInsert(row: number, clicks: number): void {
    this.inserting = row;
    this.insertError = '';
    this.insertForm.activate('ins');
    this.insertForm.inner(clicks);
  }
  private commitInsert(t: string): boolean {
    const fpl = this.sys.fpl;
    const id = t.trim().toUpperCase();
    if (!fpl || !id) return false;
    const c = this.sys.resolve(id);
    if (!c.length) {
      this.insertError = 'Waypoint not found';
      return false;
    }
    const wpt = c[0];
    const plan = fpl.plan;
    const row = this.rows[this.inserting];
    const isApt = wpt.kind === 'airport';
    let ok = true;
    if (!row) {
      // Empty last row: origin / destination / enroute.
      if (isApt && !plan.origin && plan.legs.length === 0) ok = fpl.setOrigin(id);
      else if (isApt && !plan.destination) ok = fpl.setDestination(id);
      else fpl.appendEnroute(wpt);
    } else if (row.kind === 'destination' || row.kind === 'origin') {
      if (row.kind === 'origin') ok = !!fpl.insertWaypoint(row.legIndex + 1, wpt);
      else fpl.appendEnroute(wpt);
    } else if (row.legIndex >= 0) ok = !!fpl.insertWaypoint(row.legIndex, wpt);
    else fpl.appendEnroute(wpt);
    this.inserting = -1;
    this.insertForm.deactivate();
    this.refresh(true);
    return ok;
  }
  /** ENT / CLR while inserting go to the insertion entry. */
  override ent(): boolean {
    if (this.inserting >= 0) {
      this.insertForm.ent();
      return true;
    }
    return this.form.ent();
  }
  override clr(): boolean {
    if (this.inserting >= 0) {
      this.inserting = -1;
      this.insertForm.deactivate();
      return true;
    }
    return this.form.clr();
  }
  private askRemove(row: number): void {
    const r = this.rows[row];
    const fpl = this.sys.fpl;
    if (!r || !fpl || r.legIndex < 0) return;
    this.sys.confirm(this.screenOf(), `Remove ${r.text}?`, () => {
      if (r.kind === 'origin') fpl.removeOrigin();
      else if (r.kind === 'destination') fpl.removeDestination();
      else fpl.deleteLeg(r.legIndex);
      this.refresh(true);
    });
  }
  private screenOf(): Screen {
    return this.wide ? 'mfd' : 'pfd';
  }
  /** ACT Leg softkey / MENU 'Activate Leg': confirmation, then the highlighted leg becomes active. */
  activateLeg(): void {
    const i = this.cursorLeg();
    const fpl = this.sys.fpl;
    if (!fpl || i < 0) return;
    this.sys.confirm(this.screenOf(), 'Activate Leg?', () => {
      fpl.activateLeg(i);
      this.refresh(true);
    });
  }
  override menu(): MenuItem[] {
    const fpl = this.sys.fpl;
    const p = fpl?.plan;
    return [
      { label: 'Activate Leg', enabled: this.form.active && this.cursorLeg() >= 0, run: () => this.activateLeg() },
      { label: 'Delete Flight Plan', enabled: !!p && p.legs.length > 0, run: () => this.sys.confirm(this.screenOf(), 'Delete all waypoints in flight plan?', () => fpl?.deletePlan()) },
      { label: 'Remove Departure', enabled: !!p?.sid, run: () => fpl?.removeDeparture() },
      { label: 'Remove Arrival', enabled: !!p?.star, run: () => fpl?.removeArrival() },
      { label: 'Remove Approach', enabled: !!p?.approachProcedure, run: () => fpl?.removeApproach() },
    ];
  }
}

/** Ident of a plan leg for renderers. */
export { legIdent };

// ================================================================ Nearest

export interface NearestAirport {
  apt: Airport;
  brg: number;
  dist: number;
  appr: string;
  rwyFt: number;
  com: { type: string; mhz: number } | null;
}

/**
 * Nearest Airports (PG §5.3 / §2 'Nearest Airports' window on the PFD and
 * 'NRST - Nearest Airports' page): the 25 nearest airports within 200 nm
 * with bearing, distance, best approach and runway length; each airport has
 * an identifier row and a frequency row: ENT on the frequency loads it into
 * the COM standby field; D→ with an airport highlighted preselects it.
 */
export class NearestAirportsPage extends Page {
  readonly id = 'nrst_apt';
  list: NearestAirport[] = [];
  private refreshS = 0;
  override softkeys = 'nrst';
  constructor(sys: G1000System, readonly screen: Screen) {
    super(sys);
    this.form.setFields([
      {
        id: 'list',
        kind: 'list',
        count: () => this.list.length * 2,
        onEnter: (r) => {
          const a = this.list[r >> 1];
          if (!a) return;
          if (r & 1) {
            if (a.com) loadStandby(sys, a.com.mhz);
          } else sys.showAirportFrequencies(this.screen, a.apt);
        },
      },
    ]);
  }
  title(): string {
    return this.screen === 'mfd' ? 'NRST - Nearest Airports' : 'Nearest Airports';
  }
  override show(): void {
    this.refresh();
    if (this.screen === 'pfd') this.form.activate('list');
  }
  override update(dt: number): void {
    this.refreshS -= dt;
    if (this.refreshS <= 0) this.refresh();
  }
  refresh(): void {
    this.refreshS = 5;
    const p = this.sys.pos();
    if (!p.valid) {
      this.list = [];
      return;
    }
    const mv = this.sys.magVar();
    // PG: up to 25 airports within 200 nm (runway length filter: Aux System Setup, EST none).
    // Heliports / seaplane bases / closed fields are not listed (EST: the NXi nearest list shows airports with runways).
    const apts = this.sys.nav.airportsNear(p.lat, p.lon, 200, 400).filter((a) => a.type !== 'heliport' && a.type !== 'closed' && a.type !== 'seaplane_base' && a.runways.length > 0);
    this.list = apts.slice(0, 25).map((a) => {
      const bd = brgDist(p, a.lat, a.lon, mv);
      return { apt: a, brg: bd.brg, dist: bd.dist, appr: approachClass(a), rwyFt: longestRunwayFt(a), com: primaryCom(a) };
    });
  }
  override cursorIdent(): string {
    const a = this.list[this.form.row >> 1];
    return this.form.active && a ? a.apt.icao : '';
  }
}

export interface NearestNavaid {
  ident: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  brg: number;
  dist: number;
  freq: number;
}

/** NRST - Nearest VOR / NDB / Intersections (PG §5.3): 25 nearest; ENT on a VOR frequency loads NAV standby. */
export class NearestNavaidPage extends Page {
  readonly id: string;
  list: NearestNavaid[] = [];
  private refreshS = 0;
  override softkeys = 'nrst';
  constructor(sys: G1000System, readonly kind: 'vor' | 'ndb' | 'int') {
    super(sys);
    this.id = `nrst_${kind}`;
    this.form.setFields([
      {
        id: 'list',
        kind: 'list',
        count: () => this.list.length,
        onEnter: (r) => {
          const n = this.list[r];
          if (n && this.kind === 'vor') loadStandby(sys, n.freq);
        },
      },
    ]);
  }
  title(): string {
    return this.kind === 'vor' ? 'NRST - Nearest VOR' : this.kind === 'ndb' ? 'NRST - Nearest NDB' : 'NRST - Nearest Intersections';
  }
  override show(): void {
    this.refresh();
  }
  override update(dt: number): void {
    this.refreshS -= dt;
    if (this.refreshS <= 0) this.refresh();
  }
  refresh(): void {
    this.refreshS = 5;
    const p = this.sys.pos();
    if (!p.valid) {
      this.list = [];
      return;
    }
    const mv = this.sys.magVar();
    const out: NearestNavaid[] = [];
    if (this.kind === 'int') {
      for (const f of this.sys.nav.fixesNear(p.lat, p.lon, 30)) {
        const bd = brgDist(p, f.lat, f.lon, mv);
        out.push({ ident: f.ident, name: '', type: 'INT', lat: f.lat, lon: f.lon, brg: bd.brg, dist: bd.dist, freq: NaN });
      }
    } else {
      const types = this.kind === 'vor' ? (['VOR', 'VORDME', 'VORTAC'] as const) : (['NDB', 'NDBDME'] as const);
      for (const n of this.sys.nav.navaidsNear(p.lat, p.lon, 200, [...types])) {
        const bd = brgDist(p, n.lat, n.lon, mv);
        out.push({ ident: n.ident, name: n.name, type: n.type, lat: n.lat, lon: n.lon, brg: bd.brg, dist: bd.dist, freq: n.freq });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    this.list = out.slice(0, 25);
  }
  override cursorIdent(): string {
    const n = this.list[this.form.row];
    return this.form.active && n ? n.ident : '';
  }
}

// ================================================================ Timer / References

/**
 * 'Timer/References' window (PG §2.2 "Generic Timer", §2.1 V-speed
 * references, §2.4 minimums): timer HH:MM:SS with UP / DN and Start? /
 * Stop? / Reset?; GLIDE, Vr, Vx, Vy values and On/Off; MINS Off / BARO /
 * TEMP COMP with value (and temperature). MENU: All References On / Off,
 * Restore Defaults.
 */
export class TmrRefPage extends Page {
  readonly id = 'tmrref';
  constructor(sys: G1000System) {
    super(sys);
    const r = sys.refs;
    const fields: Field[] = [
      { id: 'timer', kind: 'number', get: () => Math.round(r.timer.seconds), set: (v) => r.timer.setPreset(v), step: 1, bigStep: 60, min: 0, max: 86399, enabled: () => !r.timer.running },
      { id: 'dir', kind: 'select', options: () => ['UP', 'DN'], get: () => (r.timer.countingDown ? 1 : 0), set: (i) => r.timer.setDirection(i === 1) },
      { id: 'start', kind: 'action', label: () => r.timer.prompt, run: () => r.timer.promptAction() },
    ];
    for (const d of r.vspeeds.defs) {
      fields.push({ id: `v_${d.id}`, kind: 'number', get: () => r.vspeeds.value(d.id), set: (v) => r.vspeeds.set(d.id, v), step: 1, min: 20, max: 999 });
      fields.push({ id: `on_${d.id}`, kind: 'select', options: () => ['Off', 'On'], get: () => (r.vspeeds.on(d.id) ? 1 : 0), set: (i) => r.vspeeds.setOn(d.id, i === 1), live: false });
    }
    fields.push({ id: 'mins', kind: 'select', options: () => ['OFF', 'BARO', 'TEMP COMP'], get: () => r.mins.mode, set: (i) => r.mins.setMode(i) });
    fields.push({ id: 'minsft', kind: 'number', get: () => r.mins.valueFt, set: (v) => r.mins.setValue(v), step: 10, bigStep: 100, min: 0, max: 16000, enabled: () => r.mins.mode !== MINS_MODE.off });
    fields.push({ id: 'temp', kind: 'number', get: () => r.mins.tempC, set: (v) => r.mins.setTemp(v), step: 1, min: -59, max: 59, enabled: () => r.mins.mode === MINS_MODE.tempComp });
    this.form.setFields(fields);
  }
  title(): string {
    return 'References';
  }
  override show(): void {
    this.form.activate('timer');
  }
  override menu(): MenuItem[] {
    const v = this.sys.refs.vspeeds;
    return [
      { label: 'All References On', run: () => v.setAll(true) },
      { label: 'All References Off', run: () => v.setAll(false) },
      { label: 'Restore Defaults', run: () => v.restoreDefaults() },
    ];
  }
}

// ================================================================ Alerts window

/** 'Alerts' window (PG §1.3): system messages, newest first; the FMS knob scrolls. */
export class AlertsPage extends Page {
  readonly id = 'alerts';
  constructor(sys: G1000System) {
    super(sys);
    this.form.setFields([{ id: 'list', kind: 'list', count: () => sys.alerts.messages.list.length }]);
  }
  title(): string {
    return 'Alerts';
  }
  override show(): void {
    this.form.activate('list');
    this.sys.alerts.viewed();
  }
}

// ================================================================ DME tuning window

/** 'DME Tuning' window (PG §4.3, optional KN 63): DME source NAV1 / NAV2 / HOLD. */
export class DmePage extends Page {
  readonly id = 'dme';
  constructor(sys: G1000System) {
    super(sys);
    this.form.setFields([
      {
        id: 'src',
        kind: 'select',
        options: () => ['NAV1', 'NAV2', 'HOLD'],
        get: () => sys.vars.get(G1K.dmeMode),
        set: (i) => sys.setDmeMode(i),
      },
    ]);
  }
  title(): string {
    return 'DME Tuning';
  }
  override show(): void {
    this.form.activate('src');
  }
}

// ================================================================ WPT information pages

/**
 * 'WPT - Airport Information' (PG §5.2): identifier entry; Info-1 shows the
 * runways, Info-2 the frequencies (ENT on a frequency loads the standby).
 * DP / STAR / APR softkeys open the procedure loading pages for the airport.
 */
export class AirportInfoPage extends Page {
  readonly id = 'wpt_apt';
  ident = '';
  apt: Airport | null = null;
  view: 'info1' | 'info2' = 'info1';
  override softkeys = 'wpt_apt';
  constructor(sys: G1000System) {
    super(sys);
    this.form.setFields([
      { id: 'ident', kind: 'text', maxLen: 4, get: () => this.ident, commit: (t) => this.setIdent(t), complete: (p) => completeIdent(sys, p) },
      {
        id: 'freqs',
        kind: 'list',
        count: () => (this.view === 'info2' && this.apt ? this.apt.frequencies.length : 0),
        enabled: () => this.view === 'info2' && !!this.apt && this.apt.frequencies.length > 0,
        onEnter: (r) => {
          const f = this.apt?.frequencies[r];
          if (f) loadStandby(sys, f.mhz);
        },
      },
    ]);
  }
  title(): string {
    return 'WPT - Airport Information';
  }
  override show(): void {
    if (!this.ident) {
      // Default: the destination, else the nearest airport.
      const d = this.sys.fpl?.plan.destination?.icao;
      if (d) this.setIdent(d);
      else {
        const p = this.sys.pos();
        const a = p.valid ? this.sys.nav.airportsNear(p.lat, p.lon, 100, 1)[0] : undefined;
        if (a) this.setIdent(a.icao);
      }
    }
  }
  setIdent(t: string): boolean {
    const id = t.trim().toUpperCase();
    const a = this.sys.nav.airport(id);
    if (!a) return false;
    this.ident = a.icao;
    this.apt = a;
    return true;
  }
  override cursorIdent(): string {
    return this.ident;
  }
}

/** 'WPT - Intersection / VOR / NDB Information' (PG §5.2): identifier, position, frequency, nearest airport. */
export class NavaidInfoPage extends Page {
  readonly id: string;
  ident = '';
  wpt: Waypoint | null = null;
  navaid: Navaid | null = null;
  override softkeys = 'wpt';
  constructor(sys: G1000System, readonly kind: 'int' | 'vor' | 'ndb') {
    super(sys);
    this.id = `wpt_${kind}`;
    this.form.setFields([
      { id: 'ident', kind: 'text', maxLen: 5, get: () => this.ident, commit: (t) => this.setIdent(t), complete: (p) => this.complete(p) },
      {
        id: 'freq',
        kind: 'action',
        label: () => (this.navaid ? (this.kind === 'ndb' ? String(this.navaid.freq) : fmtNav(this.navaid.freq)) : '____'),
        enabled: () => this.kind === 'vor' && !!this.navaid,
        run: () => {
          if (this.navaid) loadStandby(sys, this.navaid.freq);
        },
      },
    ]);
  }
  title(): string {
    return this.kind === 'vor' ? 'WPT - VOR Information' : this.kind === 'ndb' ? 'WPT - NDB Information' : 'WPT - Intersection Information';
  }
  private want(w: Waypoint): boolean {
    return this.kind === 'int' ? w.kind === 'fix' : w.kind === this.kind;
  }
  private complete(prefix: string): string {
    const c = this.sys.resolve(prefix.trim().toUpperCase()).filter((w) => this.want(w));
    return c[0]?.ident ?? '';
  }
  setIdent(t: string): boolean {
    const id = t.trim().toUpperCase();
    const c = this.sys.resolve(id).filter((w) => this.want(w));
    if (!c.length) return false;
    this.ident = c[0].ident;
    this.wpt = c[0];
    this.navaid = c[0].navaid ?? null;
    return true;
  }
  override cursorIdent(): string {
    return this.ident;
  }
}

// ================================================================ AUX pages

/** 'AUX - Trip Planning' (PG §5.10): automatic mode from present position to the active waypoint / destination. */
export class TripPlanningPage extends Page {
  readonly id = 'aux_trip';
  override softkeys = 'aux';
  title(): string {
    return 'AUX - Trip Planning';
  }
}

/** 'AUX - Utility' (PG §8): generic timer (shared with the PFD), flight timer, departure time, odometers, max GS. */
export class UtilityPage extends Page {
  readonly id = 'aux_util';
  override softkeys = 'aux';
  constructor(sys: G1000System) {
    super(sys);
    const t = sys.refs.timer;
    this.form.setFields([
      { id: 'timer', kind: 'number', get: () => Math.round(t.seconds), set: (v) => t.setPreset(v), step: 1, bigStep: 60, min: 0, max: 86399, enabled: () => !t.running },
      { id: 'dir', kind: 'select', options: () => ['UP', 'DN'], get: () => (t.countingDown ? 1 : 0), set: (i) => t.setDirection(i === 1) },
      { id: 'start', kind: 'action', label: () => t.prompt, run: () => t.promptAction() },
    ]);
  }
  title(): string {
    return 'AUX - Utility';
  }
  override menu(): MenuItem[] {
    const f = this.sys.fuel;
    return [
      { label: 'Reset Flight Timer', run: () => f.resetTrip('flight') },
      { label: 'Reset Trip ODOM', run: () => f.resetTrip('trip') },
      { label: 'Reset Odometer', run: () => f.resetTrip('odometer') },
      { label: 'Reset Maximum Speed', run: () => f.resetTrip('maxgs') },
      { label: 'Reset All', run: () => f.resetTrip('all') },
    ];
  }
}

/** 'AUX - GPS Status' (PG §1.3 "GPS Receiver Operation"): GPS1 / GPS2 softkeys select the receiver shown. */
export class GpsStatusPage extends Page {
  readonly id = 'aux_gps';
  override softkeys = 'aux_gps';
  title(): string {
    return 'AUX - GPS Status';
  }
}

/** Selectable MFD navigation data bar fields (Aux - System Setup 1, PG §1.5 "MFD Data Bar Fields"). */
export const DATA_BAR_FIELDS = ['BRG', 'DIS', 'DTK', 'END', 'ETA', 'ETE', 'FOB', 'FOD', 'GS', 'TAS', 'TKE', 'TRK', 'VSR', 'XTK'] as const;
/** Default fields: GS, DTK, TRK, ETE (PG §1.5). */
export const DATA_BAR_DEFAULT = ['GS', 'DTK', 'TRK', 'ETE'];

/**
 * 'AUX - System Setup 1 / 2' (PG §1.5). Setup 1: date/time format and
 * offset, display units (nav angle, baro), arrival alert, GPS CDI, MFD data
 * bar fields, COM channel spacing. Setup 2: Stability & Protection (ESP)
 * Enabled / Disabled. MENU: Restore Defaults.
 */
export class SystemSetupPage extends Page {
  readonly id = 'aux_setup';
  setup = 1;
  dataBar: string[] = [...DATA_BAR_DEFAULT];
  override softkeys = 'aux_setup';
  constructor(sys: G1000System) {
    super(sys);
    this.buildFields();
  }
  private buildFields(): void {
    const sys = this.sys;
    const v = sys.vars;
    const sel = (id: string, opts: string[], name: string, enabled?: () => boolean): Field => ({
      id,
      kind: 'select',
      options: () => opts,
      get: () => Math.max(0, Math.min(opts.length - 1, v.get(name) | 0)),
      set: (i) => v.set(name, i),
      enabled,
    });
    if (this.setup === 1) {
      const f: Field[] = [
        sel('time_fmt', ['UTC', 'LOCAL 12hr', 'LOCAL 24hr'], G1K.timeFormat),
        { id: 'time_ofs', kind: 'number', get: () => v.get(G1K.timeOffsetH), set: (x) => v.set(G1K.timeOffsetH, x), step: 0.5, min: -13, max: 14, enabled: () => v.get(G1K.timeFormat) > 0 },
        sel('nav_angle', ['MAGNETIC(°)', 'TRUE(°T)'], G1K.navAngleTrue),
        { id: 'baro', kind: 'select', options: () => ['INCHES(IN)', 'HECTOPASCALS(HPA)'], get: () => (v.get(G1K.baroHpa) >= 0.5 ? 1 : 0), set: (i) => v.set(G1K.baroHpa, i) },
        sel('arr_alert', ['OFF', 'ON'], G1K.arrivalAlert),
        { id: 'arr_nm', kind: 'number', get: () => v.get(G1K.arrivalAlertNm), set: (x) => v.set(G1K.arrivalAlertNm, x), step: 0.1, bigStep: 1, min: 0.1, max: 99.9, enabled: () => v.get(G1K.arrivalAlert) >= 0.5 },
        sel('gps_cdi', ['AUTO', '2.0NM', '1.0NM', '0.30NM'], G1K.gpsCdi),
      ];
      for (let i = 0; i < 4; i++) {
        f.push({
          id: `bar${i}`,
          kind: 'select',
          options: () => DATA_BAR_FIELDS,
          get: () => Math.max(0, DATA_BAR_FIELDS.indexOf(this.dataBar[i] as (typeof DATA_BAR_FIELDS)[number])),
          set: (k) => (this.dataBar[i] = DATA_BAR_FIELDS[k]),
        });
      }
      f.push({ id: 'com_spacing', kind: 'select', options: () => ['25.0 KHZ', '8.33 KHZ'], get: () => (v.get(G1K.comSpacing833) >= 0.5 ? 1 : 0), set: (i) => v.set(G1K.comSpacing833, i) });
      this.form.setFields(f);
    } else {
      this.form.setFields([
        {
          id: 'esp',
          kind: 'select',
          options: () => ['Enabled', 'Disabled'],
          get: () => (sys.esp?.enabled ? 0 : 1),
          set: (i) => sys.esp?.setEnabled(i === 0),
          enabled: () => !!sys.esp,
        },
      ]);
    }
  }
  setSetup(n: 1 | 2): void {
    if (this.setup === n) return;
    this.setup = n;
    this.buildFields();
  }
  title(): string {
    return this.setup === 1 ? 'AUX - System Setup 1' : 'AUX - System Setup 2';
  }
  override menu(): MenuItem[] {
    return [{ label: 'Restore System Defaults', run: () => this.restoreDefaults() }];
  }
  restoreDefaults(): void {
    const v = this.sys.vars;
    v.set(G1K.timeFormat, 0);
    v.set(G1K.timeOffsetH, 0);
    v.set(G1K.navAngleTrue, 0);
    v.set(G1K.baroHpa, 0);
    v.set(G1K.arrivalAlert, 1);
    v.set(G1K.arrivalAlertNm, 1);
    v.set(G1K.gpsCdi, 0);
    v.set(G1K.comSpacing833, 0);
    this.dataBar = [...DATA_BAR_DEFAULT];
  }
}

/** 'AUX - System Status' (PG §1.3 "System Status"): LRU status, airframe, software and databases. */
export class SystemStatusPage extends Page {
  readonly id = 'aux_status';
  override softkeys = 'aux';
  constructor(sys: G1000System) {
    super(sys);
    this.form.setFields([{ id: 'lru', kind: 'list', count: () => this.sys.lruStatus().length }]);
  }
  title(): string {
    return 'AUX - System Status';
  }
}

// ================================================================ MAP pages

export class NavMapPage extends Page {
  readonly id = 'map_nav';
  override softkeys = 'nav';
  title(): string {
    return 'Map - Navigation Map';
  }
  override menu(): MenuItem[] {
    const v = this.sys.vars;
    const o = v.get(G1K.mfdMapOrient);
    return [
      { label: `Orientation: North Up${o === 0 ? ' *' : ''}`, run: () => v.set(G1K.mfdMapOrient, 0) },
      { label: `Orientation: Track Up${o === 1 ? ' *' : ''}`, run: () => v.set(G1K.mfdMapOrient, 1) },
      { label: `Orientation: Heading Up${o === 2 ? ' *' : ''}`, run: () => v.set(G1K.mfdMapOrient, 2) },
    ];
  }
}

export class TrafficMapPage extends Page {
  readonly id = 'map_traffic';
  override softkeys = 'traffic';
  title(): string {
    return 'Map - Traffic Map';
  }
}

export class TerrainPage extends Page {
  readonly id = 'map_terrain';
  override softkeys = 'terrain';
  title(): string {
    return this.sys.cfg.terrain === 'TAWS-B' ? 'Map - TAWS-B' : 'Map - Terrain-SVT';
  }
}

// ================================================================ Checklist

/**
 * Electronic checklists (PG §8 "Electronic Checklists"): 'Group' and
 * 'Checklist' fields, items checked with ENT (the Check softkey), 'Go to
 * Next Checklist?' when finished; '*Checklist Finished*' green / 'Checklist
 * Not Finished' amber; EMER softkey jumps to the emergency group.
 */
export class ChecklistPage extends Page {
  readonly id = 'checklist';
  override softkeys = 'checklist';
  groupIndex = 0;
  constructor(sys: G1000System) {
    super(sys);
    const cl = sys.checklists;
    this.form.setFields([
      {
        id: 'group',
        kind: 'select',
        options: () => this.groups(),
        get: () => this.groupIndex,
        set: (i) => {
          this.groupIndex = i;
          const first = this.listsInGroup()[0];
          if (first !== undefined) cl.select(first);
        },
      },
      {
        id: 'list',
        kind: 'select',
        options: () => this.listsInGroup().map((i) => cl.lists[i].title),
        get: () => Math.max(0, this.listsInGroup().indexOf(cl.index)),
        set: (i) => {
          const idx = this.listsInGroup()[i];
          if (idx !== undefined) cl.select(idx);
        },
      },
      {
        id: 'items',
        kind: 'list',
        count: () => cl.current?.items.length ?? 0,
        onEnter: (r) => {
          cl.toggle(r);
          this.form.row = cl.cursor;
          if (cl.complete()) this.form.activate('next');
        },
      },
      { id: 'next', kind: 'action', label: () => 'Go to Next Checklist?', enabled: () => cl.complete() && cl.index < cl.lists.length - 1, run: () => this.nextList() },
    ]);
  }
  title(): string {
    return 'Checklist';
  }
  override show(): void {
    this.form.activate('items');
    this.form.row = this.sys.checklists.cursor;
  }
  groups(): string[] {
    const out: string[] = [];
    for (const l of this.sys.checklists.lists) if (!out.includes(l.phase)) out.push(l.phase);
    return out;
  }
  listsInGroup(): number[] {
    const g = this.groups()[this.groupIndex];
    const out: number[] = [];
    this.sys.checklists.lists.forEach((l, i) => {
      if (l.phase === g) out.push(i);
    });
    return out;
  }
  private syncGroup(): void {
    const cur = this.sys.checklists.current;
    if (cur) this.groupIndex = Math.max(0, this.groups().indexOf(cur.phase));
  }
  nextList(): void {
    this.sys.checklists.next();
    this.syncGroup();
    this.form.activate('items');
    this.form.row = 0;
  }
  /** Check / Uncheck softkey: toggles the highlighted item. */
  toggleItem(): void {
    const cl = this.sys.checklists;
    if (!this.form.active || this.form.field?.id !== 'items') this.form.activate('items');
    cl.toggle(this.form.row);
    this.form.row = cl.cursor;
  }
  /** EMER softkey: the first checklist of the emergency group. */
  emergency(): void {
    const i = this.groups().findIndex((g) => /emerg/i.test(g));
    if (i < 0) return;
    this.groupIndex = i;
    const first = this.listsInGroup()[0];
    if (first !== undefined) this.sys.checklists.select(first);
    this.form.activate('items');
    this.form.row = 0;
  }
  override menu(): MenuItem[] {
    const cl = this.sys.checklists;
    return [
      { label: 'Check All', run: () => cl.current?.items.forEach((_, i) => !cl.isChecked(i) && cl.toggle(i)) },
      { label: 'Uncheck All', run: () => cl.resetList() },
      { label: 'Reset All Checklists', run: () => cl.resetAll() },
    ];
  }
}
