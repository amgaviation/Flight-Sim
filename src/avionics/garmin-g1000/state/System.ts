/**
 * `G1000System`: the "integrated avionics" behind both GDUs of the Cessna
 * NAV III G1000 NXi. One instance per aircraft, run as a `Subsystem`
 * (60 Hz) after the radios and the FMS and before the Afcs (it writes
 * `ap.nav_source`). It owns everything the two displays share:
 *
 *  - LRU power / boot / failure (units.ts) and reversionary mode: automatic
 *    on a display failure, manual with the GMA DISPLAY BACKUP button (PG
 *    190-02177-02 §1.3 "Reversionary Mode"); the NAV / COM of the IAU wired
 *    to a failed display are flagged invalid on the remaining one;
 *  - the bezel controls of both GDU 1054B (identical bezels, PG Figure 1-2):
 *    NAV / COM / HDG / ALT / CRS-BARO / RANGE / FMS knobs, D→ MENU FPL PROC
 *    CLR ENT keys, 12 softkeys each, GFC 700 keys;
 *  - PFD windows (Timer/References, Nearest Airports, Alerts, Flight Plan,
 *    Direct-to, Procedures, DME) and the MFD page groups (mfd.ts);
 *  - radios (radios.ts), GTX 345R (xpdr.ts), GMA 1360 (audio.ts);
 *  - references (V-speeds, timer, minimums), fuel totalizer, CAS and system
 *    messages (alerts.ts), checklists;
 *  - AFCS glue: CDI source -> `ap.nav_source`, the ILS rule on APR with GPS
 *    selected and the automatic GPS -> LOC CDI switch (PG §2.1 "Course
 *    Deviation Indicator"), approach auto-tuning (§4.3), VNV cancel, AFCS
 *    status annunciations, ESP / USP (esp.ts).
 *
 * State other modules need is published as SimVars (`g1k.*`, vars.ts).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { AudioApi } from '../../../core/SimContext';
import type { Subsystem } from '../../../aircraft/types';
import type { Airport, NavDatabase, Procedure, Waypoint } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { wrap360 } from '../../../core/math';
import { compileBinding, compileCondition, type Evaluator } from '../../../systems/util/binding';
import { ChecklistModel } from '../../garmin-g3000/state/models';
import { FplEditor, LOC_APPROACH_TYPES } from '../../garmin-g3000/state/FplEditor';
import { fmtCom, fmtNav } from '../../garmin-g3000/format';
import type { CasModel } from '../../common/draw/CasWindow';
import { AltitudeAlerter, ALT_ALERT_GARMIN, MinimumsAlerter, MINIMUMS_GARMIN, type AltitudeAlertPhase } from '../../common/alerting';
import type { G1000Resolved } from '../config';
import { BRG_SOURCE, CDI_SOURCE, DME_MODE, G1K, G1K_EVENTS, GDU_IDS, MAP_TER, PFD_MAP, WIND_OPTION, vn, type GduId, type G1kUnit } from '../vars';
import { AfcsMonitor, AFCS_KEYS } from './afcs';
import { AlertSystem } from './alerts';
import { AudioPanel, GMA_KEYS } from './audio';
import { Esp } from './esp';
import { PopupMenu } from './forms';
import { FuelTotalizer } from './fuel';
import { MfdState } from './mfd';
import { buildMfdMenus, buildPfdMenus } from './menus';
import {
  AlertsPage,
  DirectToPage,
  DmePage,
  FplPage,
  NearestAirportsPage,
  ProcLoadingPage,
  ProcPage,
  TmrRefPage,
  loadStandby,
  type Page,
  type ProcKind,
  type Screen,
  type Pos,
} from './pages';
import { RadioPanel } from './radios';
import { GenericTimer, Minimums, VSpeedBank } from './references';
import { SoftkeyController } from './softkeys';
import { UnitManager } from './units';
import { Transponder } from './xpdr';

/** PFD window ids (lower right corner) and their `g1k.pfd.window` codes. */
export const PFD_WINDOWS = { tmrref: 1, nearest: 2, alerts: 3, fpl: 4, dto: 5, proc: 6, dme: 7, procload: 8 } as const;
export type PfdWindowId = keyof typeof PFD_WINDOWS;

/** Garmin map ranges (nm), PG §5.2 "Map Range": 250 ft .. 1000 nm (28 ranges). */
export const G1K_MAP_RANGES: readonly number[] = [
  250 / 6076.12, 500 / 6076.12, 750 / 6076.12, 1000 / 6076.12, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 750, 1000,
];

/** Seconds the selected heading / course readout stays shown after a change (PG §2.1: 3 s). */
const READOUT_S = 3;
/** Stuck microphone: transmitter stops after 35 s (PG §4.6 "Stuck Microphone"). */
const STUCK_MIC_S = 35;
/** Wx / datalink products the PFD / MFD map softkeys toggle (state only; SCOPE: no datalink weather source). */
export const WX_KEYS = ['wx_lgnd', 'nexrad', 'metar', 'lightning', 'stormscope'] as const;

const IAS1 = ADC.ias(1);
const HDG1 = ADC.heading(1);
const ALT1 = ADC.baroAlt(1);
const BARO1 = ADC.baroSetting(1);
const STD1 = ADC.baroStd(1);

export interface SystemEnv {
  vars: SimVars;
  events?: EventBus;
  audio?: AudioApi;
  nav: NavDatabase;
  world?: WorldQuery;
}

export class G1000System implements Subsystem {
  readonly name = 'g1000';
  readonly cfg: G1000Resolved;
  readonly vars: SimVars;
  readonly events: EventBus | null;
  readonly audio: AudioApi | null;
  readonly nav: NavDatabase;
  readonly world: WorldQuery | null;
  readonly fms: Fms | null;
  readonly fpl: FplEditor | null;
  readonly units: UnitManager;
  readonly radios: RadioPanel;
  readonly xpdr: Transponder;
  readonly gma: AudioPanel;
  readonly refs: { vspeeds: VSpeedBank; timer: GenericTimer; mins: Minimums };
  readonly alerts: AlertSystem;
  readonly fuel: FuelTotalizer;
  readonly afcsMon: AfcsMonitor;
  readonly esp: Esp | null;
  readonly checklists: ChecklistModel;
  readonly mfd: MfdState;
  /** PFD windows (lower right corner of the PFD / reversionary display). */
  readonly pfdPages: Record<PfdWindowId, Page>;
  /** Softkeys shown in PFD format (per GDU, the MFD GDU uses its own in reversionary mode) and MFD format. */
  readonly pfdKeys: Record<GduId, SoftkeyController>;
  readonly mfdKeys: SoftkeyController;
  /** Pop-up menus / confirmations per screen (MENU key, 'Remove waypoint?', frequency lists). */
  readonly popups: Record<Screen, PopupMenu> = { pfd: new PopupMenu(), mfd: new PopupMenu() };
  /** Traffic threats (systems/warning Tcas-like) for the maps, null = none. */
  trafficSource: { threats: readonly { relBrgDeg: number; rangeNm: number; relAltFt: number; vsSign: number; level: number }[] } | null = null;
  /** Seconds since the selected heading / course changed (HSI readouts). */
  hdgChangedS = 99;
  crsChangedS = 99;
  /** Map pointer (joystick pan) on the MFD navigation map. */
  readonly pointer = { active: false, dx: 0, dy: 0 };
  /** Monotonic time (s). */
  time = 0;
  /** Bumped on UI state changes that are not in vars (renderers redraw). */
  revision = 0;
  /** AFCS nav source override (receiver) while an ILS approach is armed with GPS on the CDI. */
  afcsNavOverride = 0;
  /**
   * Altitude alerting (PG §2.1 "Altitude Alerting": within 1000 ft of the selected altitude the box
   * flashes black-on-cyan 5 s; within 200 ft it turns cyan-on-black, flashes 5 s and a tone sounds;
   * a deviation of more than 200 ft after capture flashes yellow with a tone).
   */
  readonly altAlert = new AltitudeAlerter(ALT_ALERT_GARMIN);
  /** Minimums alerting (PG §2.4: within 2500 ft cyan, 100 ft white, at minimums amber + "Minimums, minimums"). */
  readonly minsAlert = new MinimumsAlerter(MINIMUMS_GARMIN);
  private lastAltPhase: AltitudeAlertPhase = 'idle';

  private readonly offs: (() => void)[] = [];
  private readonly airborne: () => boolean;
  private readonly stallWarning: () => boolean;
  private readonly aglEval: Evaluator | null;
  private lastAppr: Procedure | null = null;
  private lastPlanVersion = -1;
  private locCourseSetFor = '';
  private msgTimer = 0;
  private slowTimer = 0;
  private pttHeldS = 0;
  private pttDown = false;
  private wasPfdPowered = false;
  private wasMfdPowered = false;
  private prevDisplayBackup = 0;
  private cwsHeld = false;
  private discHeld = false;
  private lastWptAlert = 0;
  private arrivalShown = false;
  private posCache: Pos = { lat: 0, lon: 0, valid: false };

  constructor(env: SystemEnv, cfg: G1000Resolved, fms: Fms | null, casModel?: CasModel) {
    this.cfg = cfg;
    this.vars = env.vars;
    this.events = env.events ?? null;
    this.audio = env.audio ?? null;
    this.nav = env.nav;
    this.world = env.world ?? null;
    this.fms = fms;
    this.fpl = fms ? new FplEditor(fms, env.nav, env.vars) : null;
    if (this.fpl) {
      this.fpl.onApproachLoaded = (proc) => this.approachLoaded(proc);
      this.fpl.onChange = () => this.revision++;
    }
    const v = env.vars;
    this.units = new UnitManager(v, cfg);
    this.radios = new RadioPanel(v, cfg.radios.nav);
    this.xpdr = new Transponder(v);
    this.gma = new AudioPanel(v, this.audio);
    this.refs = { vspeeds: new VSpeedBank(v, cfg.vspeeds), timer: new GenericTimer(v), mins: new Minimums(v) };
    this.alerts = new AlertSystem(v, this.audio, cfg.cas, casModel);
    this.fuel = new FuelTotalizer(v, cfg.eis);
    this.afcsMon = new AfcsMonitor(v, this.events, this.audio, cfg.speedTape.vneKt);
    this.esp = cfg.esp ? new Esp(v, this.events, this.audio, cfg.esp) : null;
    this.checklists = new ChecklistModel(cfg.checklists);
    // ESP: "above 200 feet AGL (GPS altitude)" / "in flight: GS > 30 kt or TAS > 50 kt" (PG §8.11).
    this.airborne = compileCondition(v, cfg.airborne, false);
    this.stallWarning = compileCondition(v, cfg.stallWarning, false);
    this.aglEval = cfg.aglFt !== undefined ? compileBinding(v, cfg.aglFt, NaN) : null;
    this.initVars();
    this.mfd = new MfdState(this);
    this.pfdPages = {
      tmrref: new TmrRefPage(this),
      nearest: new NearestAirportsPage(this, 'pfd'),
      alerts: new AlertsPage(this),
      fpl: new FplPage(this, false),
      dto: new DirectToPage(this),
      proc: new ProcPage(this),
      dme: new DmePage(this),
      procload: new ProcLoadingPage(this),
    };
    this.pfdKeys = { pfd: new SoftkeyController(buildPfdMenus(this, 'pfd')), mfd: new SoftkeyController(buildPfdMenus(this, 'mfd')) };
    this.mfdKeys = new SoftkeyController(buildMfdMenus(this), 'nav');
    this.listenEvents();
  }

  // ================================================================ init

  private initVars(): void {
    const v = this.vars;
    const init = (n: string, x: number): void => {
      if (!v.has(n)) v.set(n, x);
    };
    v.set(G1K.alive, 1);
    init(G1K.mfdSplashAck, 0);
    init(G1K.displayBackup, 0);
    init(G1K.cdiSource, CDI_SOURCE.gps);
    init(G1K.brg1Source, BRG_SOURCE.off);
    init(G1K.brg2Source, BRG_SOURCE.off);
    // PFD inset map off at power-up (EST; the PG figures show the inset map turned on by the pilot).
    init(G1K.pfdMap, PFD_MAP.off);
    init(G1K.pfdMapRange, 5);
    init(G1K.pfdMapDetail, 0);
    init(G1K.pfdMapTraffic, 0);
    init(G1K.pfdMapTer, MAP_TER.off);
    init(G1K.windOption, WIND_OPTION.option2);
    init(G1K.dmeWindow, 0);
    init(G1K.baroHpa, 0);
    init(G1K.metersOverlay, 0);
    init(G1K.obs, 0);
    init(G1K.obsCourse, 360);
    init(G1K.svt, this.cfg.terrain === 'SVT' ? 1 : 0);
    init(G1K.svtPathways, 0);
    init(G1K.svtHdgLabels, 1);
    init(G1K.svtAptSigns, 1);
    init(G1K.pfdWindow, 0);
    init(G1K.minsMode, 0);
    init(G1K.minsFt, 200);
    init(G1K.minsTempC, 15);
    init(G1K.vnvEnabled, 1);
    init(G1K.eisPage, 0);
    init(G1K.eisCylSel, 0);
    init(G1K.eisLeanAssist, 0);
    init(G1K.mfdMapRange, 10);
    init(G1K.mfdMapOrient, 2);
    init(G1K.mfdMapDetail, 0);
    init(G1K.mfdMapTraffic, 0);
    init(G1K.mfdMapTer, MAP_TER.off);
    init(G1K.mfdMapAwy, 0);
    init(G1K.trafficMode, 1);
    init(G1K.navAngleTrue, 0);
    init(G1K.gpsCdi, 0);
    init(G1K.timeFormat, 0);
    init(G1K.timeOffsetH, 0);
    init(G1K.arrivalAlert, 1);
    init(G1K.arrivalAlertNm, 1);
    init(G1K.gpsStatusRx, 1);
    init(G1K.dmeMode, DME_MODE.nav1);
    for (const g of GDU_IDS) {
      init(G1K.reversionary(g), 0);
      init(G1K.brtManual(g), 0);
      init(G1K.brtPct(g), 100);
      init(G1K.keyBrtManual(g), 0);
      init(G1K.keyBrtPct(g), 100);
    }
    for (const k of WX_KEYS) {
      init(`g1k.pfd.${k}`, 0);
      init(`g1k.mfd.${k}`, 0);
    }
    init(AP.selHeading, 360);
    init(AP.selAltitude, 0);
    init(vn(AP.selCourse, 1), 360);
    if (!v.getString(G1K.flightId)) v.setString(G1K.flightId, '');
    this.refs.mins.publish();
  }

  private listenEvents(): void {
    const ev = this.events;
    if (!ev) return;
    const on = (name: string, fn: (p: unknown) => void): void => {
      this.offs.push(ev.on(name, fn));
    };
    const clicks = (p: unknown): number => {
      if (typeof p === 'number') return p;
      if (p && typeof p === 'object') {
        const o = p as { delta?: number; steps?: number; value?: number };
        return o.delta ?? o.steps ?? o.value ?? 1;
      }
      return 1;
    };
    // Encoders: signed clicks on `<name>`, or positive clicks on `<name>_inc` / `<name>_dec`.
    const turn = (name: string, fn: (n: number) => void): void => {
      on(name, (p) => fn(clicks(p)));
      on(`${name}_inc`, (p) => fn(Math.abs(clicks(p))));
      on(`${name}_dec`, (p) => fn(-Math.abs(clicks(p))));
    };
    for (const g of GDU_IDS) {
      const up = (): boolean => this.units.up(g);
      for (let i = 1; i <= 12; i++) on(G1K_EVENTS.softkey(g, i), () => up() && this.pressSoftkey(g, i - 1));
      turn(G1K_EVENTS.navVol(g), (n) => up() && this.radios.navVolume(n));
      on(G1K_EVENTS.navVolPush(g), () => up() && this.radios.navIdentToggle());
      on(G1K_EVENTS.navXfer(g), () => up() && this.navRadioOk(this.radios.navBox) && this.radios.navSwap());
      turn(G1K_EVENTS.navOuter(g), (n) => up() && this.navRadioOk(this.radios.navBox) && this.radios.navTune(n, 'outer'));
      turn(G1K_EVENTS.navInner(g), (n) => up() && this.navRadioOk(this.radios.navBox) && this.radios.navTune(n, 'inner'));
      on(G1K_EVENTS.navPush(g), () => up() && this.radios.navToggleBox());
      turn(G1K_EVENTS.hdg(g), (n) => up() && this.hdgTurn(n));
      on(G1K_EVENTS.hdgPush(g), () => up() && this.hdgSync());
      turn(G1K_EVENTS.altOuter(g), (n) => up() && this.altTurn(n, true));
      turn(G1K_EVENTS.altInner(g), (n) => up() && this.altTurn(n, false));
      turn(G1K_EVENTS.comVol(g), (n) => up() && this.radios.comVolume(n));
      on(G1K_EVENTS.comVolPush(g), () => up() && this.radios.comSquelchToggle());
      on(G1K_EVENTS.comXfer(g), () => up() && this.comRadioOk(this.radios.comBox) && this.radios.comXferDown());
      on(G1K_EVENTS.comXferUp(g), () => this.radios.comXferUp());
      turn(G1K_EVENTS.comOuter(g), (n) => up() && this.comRadioOk(this.radios.comBox) && this.radios.comTune(n, 'outer'));
      turn(G1K_EVENTS.comInner(g), (n) => up() && this.comRadioOk(this.radios.comBox) && this.radios.comTune(n, 'inner'));
      on(G1K_EVENTS.comPush(g), () => up() && this.radios.comToggleBox());
      turn(G1K_EVENTS.baro(g), (n) => up() && this.baroTurn(n));
      turn(G1K_EVENTS.crs(g), (n) => up() && this.crsTurn(n));
      on(G1K_EVENTS.crsPush(g), () => up() && this.crsCenter());
      turn(G1K_EVENTS.range(g), (n) => up() && this.rangeTurn(g, n));
      on(G1K_EVENTS.rangePush(g), () => up() && this.rangePush(g));
      on(G1K_EVENTS.joystick(g), (p) => up() && this.joystick(g, p));
      on(G1K_EVENTS.keyDirect(g), () => up() && this.keyDirect(g));
      on(G1K_EVENTS.keyMenu(g), () => up() && this.keyMenu(g));
      on(G1K_EVENTS.keyFpl(g), () => up() && this.keyFpl(g));
      on(G1K_EVENTS.keyProc(g), () => up() && this.keyProc(g));
      on(G1K_EVENTS.keyClr(g), () => up() && this.keyClr(g));
      on(G1K_EVENTS.keyClrUp(g), () => this.mfd.clrUp());
      on(G1K_EVENTS.keyEnt(g), () => up() && this.keyEnt(g));
      turn(G1K_EVENTS.fmsOuter(g), (n) => up() && this.fmsTurn(g, n, true));
      turn(G1K_EVENTS.fmsInner(g), (n) => up() && this.fmsTurn(g, n, false));
      on(G1K_EVENTS.fmsPush(g), () => up() && this.fmsPush(g));
      if (this.cfg.afcs && this.cfg.bezel[g] === 'GDU1054B') {
        for (const k of AFCS_KEYS) on(G1K_EVENTS.afcsKey(g, k.key), () => up() && this.afcsKey(k.key));
      }
    }
    // GMA 1360.
    for (const k of GMA_KEYS) {
      on(G1K_EVENTS.gmaKey(k), () => this.gma.press(k));
      on(G1K_EVENTS.gmaKeyUp(k), () => this.gma.release(k));
    }
    turn(G1K_EVENTS.gmaVol, (n) => this.gma.vol(n));
    turn(G1K_EVENTS.gmaCrsr, (n) => this.gma.crsr(n));
    on(G1K_EVENTS.gmaVolPush, () => this.gma.volPush());
    on(G1K_EVENTS.gmaVolPushUp, () => this.gma.volPushUp());
    // DISPLAY BACKUP works with the GMA failed as well (hard-wired discrete to the GDUs).
    on(G1K_EVENTS.displayBackup, () => this.toggleDisplayBackup());
    on(G1K_EVENTS.ptt, (p) => this.ptt(p));
    on(G1K_EVENTS.casAck, () => this.alerts.acknowledgeAll());
    on('cas.ack', () => this.alerts.acknowledgeAll());
    on('cas.ack_warning', () => this.alerts.cas.acknowledge('warning'));
    on('cas.ack_caution', () => this.alerts.cas.acknowledge('caution'));
    // Yoke CWS / AP DISC held interrupt ESP (PG §8.11).
    on('ap.cws', (p) => {
      this.cwsHeld = pressedOf(p, !this.cwsHeld);
      this.esp?.setInterrupt(this.cwsHeld || this.discHeld);
    });
    on('ap.disc', () => {
      this.discHeld = true;
      this.esp?.setInterrupt(true);
    });
    on(G1K_EVENTS.apDiscHold, (p) => {
      this.discHeld = pressedOf(p, false);
      this.esp?.setInterrupt(this.cwsHeld || this.discHeld);
    });
  }

  // ================================================================ lookups used by pages

  pos(): Pos {
    const v = this.vars;
    const p = this.posCache;
    p.valid = v.get(GPS.valid) >= 0.5;
    p.lat = v.get(GPS.lat);
    p.lon = v.get(GPS.lon);
    return p;
  }

  magVar(): number {
    return this.vars.get(GPS.magVar);
  }

  /** Database candidates for an identifier, nearest first. */
  resolve(ident: string): Waypoint[] {
    const id = ident.trim().toUpperCase();
    if (!id) return [];
    const p = this.pos();
    return this.nav.resolve(id, Number.isFinite(p.lat) ? p.lat : 0, Number.isFinite(p.lon) ? p.lon : 0);
  }

  // ================================================================ formats / screens

  isReversionary(g: GduId): boolean {
    return this.vars.get(vn(G1K.reversionary, g)) >= 0.5;
  }

  /** Format a GDU shows: 'pfd' (PFD or reversionary) or 'mfd'. */
  formatOf(g: GduId): Screen {
    return g === 'pfd' || this.isReversionary(g) ? 'pfd' : 'mfd';
  }

  /** Softkeys shown on a GDU. */
  softkeysOf(g: GduId): SoftkeyController {
    return this.formatOf(g) === 'pfd' ? this.pfdKeys[g] : this.mfdKeys;
  }

  pressSoftkey(g: GduId, i: number): void {
    if (g === 'mfd' && this.vars.get(G1K.mfdSplashAck) < 0.5 && !this.isReversionary(g)) return;
    this.softkeysOf(g).press(i);
    this.revision++;
  }

  /** Current PFD window page (or null). */
  get pfdWindow(): Page | null {
    const code = this.vars.get(G1K.pfdWindow);
    for (const k in PFD_WINDOWS) if (PFD_WINDOWS[k as PfdWindowId] === code) return this.pfdPages[k as PfdWindowId];
    return null;
  }

  get pfdWindowId(): PfdWindowId | null {
    const code = this.vars.get(G1K.pfdWindow);
    for (const k in PFD_WINDOWS) if (PFD_WINDOWS[k as PfdWindowId] === code) return k as PfdWindowId;
    return null;
  }

  openPfdWindow(id: PfdWindowId): void {
    const cur = this.pfdWindow;
    const next = this.pfdPages[id];
    if (cur && cur !== next) cur.hide();
    this.vars.set(G1K.pfdWindow, PFD_WINDOWS[id]);
    if (cur !== next) next.show();
    this.revision++;
  }

  togglePfdWindow(id: PfdWindowId): void {
    if (this.pfdWindowId === id) this.closeWindow(id);
    else this.openPfdWindow(id);
  }

  /** Closes a window / MFD overlay by id on whichever screen shows it. */
  closeWindow(id: PfdWindowId | 'procload'): void {
    if (this.pfdWindowId === id) {
      this.pfdWindow?.hide();
      this.vars.set(G1K.pfdWindow, 0);
    }
    if (this.mfd.overlay === id) this.mfd.closeOverlay();
    this.revision++;
  }

  /** Page receiving the knobs on a screen. */
  pageOf(s: Screen): Page | null {
    return s === 'pfd' ? this.pfdWindow : this.mfd.page;
  }

  /** Popup with the options of a page or a confirmation. */
  confirm(s: Screen, text: string, run: () => void): void {
    this.popups[s].show(text, [{ label: 'OK', run }, { label: 'Cancel', run: () => undefined }]);
  }

  showAirportFrequencies(s: Screen, a: Airport): void {
    const items = a.frequencies.map((f) => ({ label: `${f.type} ${f.mhz < 118 ? fmtNav(f.mhz) : fmtCom(f.mhz)}`, run: () => loadStandby(this, f.mhz) }));
    if (!items.length) items.push({ label: 'No frequencies', run: () => '' });
    this.popups[s].show(`${a.icao} ${a.name}`, items);
  }

  openProcLoading(s: Screen, kind: ProcKind, airport?: string): void {
    if (s === 'pfd') {
      (this.pfdPages.procload as ProcLoadingPage).open(kind, airport);
      this.openPfdWindow('procload');
    } else {
      this.mfd.procLoad.open(kind, airport);
      this.mfd.openOverlay('procload');
    }
  }

  mfdPageChanged(): void {
    this.mfdKeys.setRoot(this.mfd.page.softkeys || 'nav');
    this.revision++;
  }

  // ================================================================ bezel keys

  private keyDirect(g: GduId): void {
    const s = this.formatOf(g);
    // Preselect: the cursor-selected identifier on the page, else the active waypoint (PG §5.4).
    const page = this.pageOf(s);
    const cur = page?.cursorIdent() ?? '';
    const active = this.vars.getString(FMS.nextWptIdent);
    const ident = cur || active;
    if (s === 'pfd') {
      if (this.pfdWindowId === 'dto') return this.closeWindow('dto');
      (this.pfdPages.dto as DirectToPage).open(ident);
      this.openPfdWindow('dto');
    } else {
      if (this.mfd.overlay === 'dto') return this.mfd.closeOverlay();
      this.mfd.dto.open(ident);
      this.mfd.openOverlay('dto');
    }
  }

  private keyMenu(g: GduId): void {
    const s = this.formatOf(g);
    const pop = this.popups[s];
    if (pop.open) {
      pop.close();
      return;
    }
    const page = this.pageOf(s);
    const items = page ? page.menu() : s === 'pfd' ? this.pfdSetupMenu() : [];
    // PG §1.4: menus display 'No Options' when there are none.
    pop.show(s === 'pfd' && !page ? 'PFD Setup Menu' : 'Page Menu', items.length ? items : [{ label: 'No Options', enabled: false, run: () => undefined }]);
  }

  /** PFD MENU with no window: display / key backlighting (PG §1.5 "Display Backlighting"). */
  private pfdSetupMenu(): { label: string; run: () => void }[] {
    const v = this.vars;
    const out: { label: string; run: () => void }[] = [];
    for (const g of GDU_IDS) {
      const man = v.get(G1K.brtManual(g)) >= 0.5;
      out.push({ label: `${g.toUpperCase()} Display: ${man ? 'Manual' : 'Auto'}`, run: () => v.set(G1K.brtManual(g), man ? 0 : 1) });
      if (man) {
        out.push({ label: `${g.toUpperCase()} Display +10%`, run: () => v.set(G1K.brtPct(g), Math.min(100, v.get(G1K.brtPct(g)) + 10)) });
        out.push({ label: `${g.toUpperCase()} Display -10%`, run: () => v.set(G1K.brtPct(g), Math.max(10, v.get(G1K.brtPct(g)) - 10)) });
      }
    }
    const kman = v.get(G1K.keyBrtManual('pfd')) >= 0.5;
    out.push({
      label: `Key: ${kman ? 'Manual' : 'Auto'}`,
      run: () => {
        for (const g of GDU_IDS) v.set(G1K.keyBrtManual(g), kman ? 0 : 1);
      },
    });
    return out;
  }

  private keyFpl(g: GduId): void {
    if (this.formatOf(g) === 'pfd') this.togglePfdWindow('fpl');
    else this.mfd.fplKey();
  }

  private keyProc(g: GduId): void {
    const s = this.formatOf(g);
    if (s === 'pfd') {
      (this.pfdPages.proc as ProcPage).screen = 'pfd';
      this.togglePfdWindow('proc');
    } else if (this.mfd.overlay === 'proc' || this.mfd.overlay === 'procload') this.mfd.closeOverlay();
    else this.mfd.openOverlay('proc');
  }

  private keyClr(g: GduId): void {
    const s = this.formatOf(g);
    const pop = this.popups[s];
    if (pop.open) {
      pop.close();
      return;
    }
    if (s === 'pfd' && this.xpdr.entering) {
      this.xpdr.cancelEntry();
      return;
    }
    if (s === 'mfd') this.mfd.clrDown();
    const page = this.pageOf(s);
    if (!page) return;
    if (page.clr()) return;
    // Nothing to clear: CLR removes the window / overlay (PG §1.2).
    if (s === 'pfd') {
      const id = this.pfdWindowId;
      if (id) this.closeWindow(id);
    } else if (this.mfd.overlay !== 'none') this.mfd.closeOverlay();
  }

  private keyEnt(g: GduId): void {
    const s = this.formatOf(g);
    if (s === 'mfd' && this.vars.get(G1K.mfdSplashAck) < 0.5) {
      // MFD power-on page: "Pressing the ENT Key acknowledges this information and displays the 'Map - Navigation Map' Page".
      this.vars.set(G1K.mfdSplashAck, 1);
      this.mfd.selectById('map_nav');
      return;
    }
    const pop = this.popups[s];
    if (pop.open) {
      pop.ent();
      return;
    }
    if (s === 'pfd' && this.xpdr.entering && this.xpdr.fmsEntry) {
      this.xpdr.fmsEnter();
      return;
    }
    this.pageOf(s)?.ent();
  }

  private fmsTurn(g: GduId, n: number, outer: boolean): void {
    const s = this.formatOf(g);
    const pop = this.popups[s];
    if (pop.open) {
      pop.move(n);
      return;
    }
    if (s === 'pfd') {
      // Transponder code entry with the FMS knob (Code softkey level, PG §4.4).
      if (this.pfdKeys[g].level === 'code' || (this.xpdr.entering && this.xpdr.fmsEntry)) {
        if (outer) this.xpdr.fmsOuter(n);
        else this.xpdr.fmsInner(n);
        return;
      }
      const page = this.pfdWindow;
      if (!page) {
        // With no window open, turning the small FMS knob on the PFD opens the flight plan window (EST).
        if (!outer) this.openPfdWindow('fpl');
        return;
      }
      this.formTurn(page, n, outer);
      return;
    }
    if (this.vars.get(G1K.mfdSplashAck) < 0.5) return;
    const page = this.mfd.page;
    const f = page instanceof FplPage ? page.activeForm : page.form;
    if (!f.active && this.mfd.overlay === 'none') {
      if (outer) this.mfd.groupTurn(n);
      else this.mfd.pageTurn(n);
      return;
    }
    // Overlays without a cursor: the knob activates the cursor on the overlay.
    if (!f.active) f.activate();
    this.formTurn(page, n, outer);
  }

  private formTurn(page: Page, n: number, outer: boolean): void {
    const f = page instanceof FplPage ? page.activeForm : page.form;
    if (!f.active) f.activate();
    if (outer) f.outer(n);
    else f.inner(n);
    this.revision++;
  }

  private fmsPush(g: GduId): void {
    const s = this.formatOf(g);
    const pop = this.popups[s];
    if (pop.open) {
      pop.close();
      return;
    }
    const page = this.pageOf(s);
    if (!page) return;
    const f = page instanceof FplPage ? page.activeForm : page.form;
    f.push();
    this.revision++;
  }

  // ================================================================ knobs

  private afcsKey(key: string): void {
    const def = AFCS_KEYS.find((k) => k.key === key);
    if (!def) return;
    if (key === 'apr') this.prepareApproach();
    if (key === 'vnv' && this.vars.get(G1K.vnvEnabled) < 0.5) {
      // VNV key with VNV cancelled: re-enables vertical navigation first (EST: the key would otherwise do nothing).
      this.vars.set(G1K.vnvEnabled, 1);
    }
    this.events?.emit(`ap.${def.event}`, def.payload);
  }

  hdgTurn(clicks: number): void {
    const v = this.vars;
    let h = Math.round(v.get(AP.selHeading)) + clicks;
    h = ((((h - 1) % 360) + 360) % 360) + 1;
    v.set(AP.selHeading, h);
    this.hdgChangedS = 0;
  }

  /** HDG knob push: synchronizes the heading bug to the current heading (PG §2.1). */
  hdgSync(): void {
    const hdg = this.vars.get(HDG1);
    this.vars.set(AP.selHeading, Math.round(wrap360(hdg)) || 360);
    this.hdgChangedS = 0;
  }

  /**
   * ALT knob: large 1000 ft, small 100 ft (PG §2.1 "Altimeter": "the large
   * knob in 1000-foot increments and the small knob in 100-foot
   * increments"); when turning through the baro minimums the selection stops
   * on it ("MDA/DH ... is also available for the Selected Altitude").
   */
  altTurn(clicks: number, outer: boolean): void {
    const v = this.vars;
    const step = outer ? 1000 : 100;
    const cur = v.get(AP.selAltitude);
    let next = Math.round((cur + clicks * step) / 100) * 100;
    if (outer) next = Math.round((cur + clicks * step) / step) * step;
    const mins = this.refs.mins.effectiveFt();
    if (Number.isFinite(mins) && Math.abs(cur - mins) > 1 && (cur - mins) * (next - mins) < 0) next = Math.round(mins);
    // PG Table 7-2 selected altitude range (EST: -1000..+50,000 ft, the Garmin selector range).
    v.set(AP.selAltitude, Math.max(-1000, Math.min(50000, next)));
  }

  /** Baro (large CRS/BARO knob): 0.01 inHg or 1 hPa per click; leaves STD. */
  baroTurn(clicks: number): void {
    const v = this.vars;
    const hpa = v.get(G1K.baroHpa) >= 0.5;
    if (v.get(STD1) >= 0.5) {
      v.set(STD1, 0);
      return;
    }
    const step = hpa ? 1 / 33.8639 : 0.01;
    const b = Math.min(31.0, Math.max(27.5, v.get(BARO1, 29.92) + clicks * step));
    v.set(BARO1, hpa ? Math.round(b * 33.8639) / 33.8639 : Math.round(b * 100) / 100);
  }

  /** STD Baro softkey (PG Table 1-3: "Sets barometric pressure to 29.92 in Hg (1013 hPa if metric units are selected)"). */
  stdBaro(): void {
    const v = this.vars;
    v.set(BARO1, 29.92);
    v.set(STD1, 1);
  }

  /** Course (small CRS/BARO knob): VOR / LOC course of the CDI receiver, or the OBS course with GPS OBS on. */
  crsTurn(clicks: number): void {
    const v = this.vars;
    const src = this.cdiSource;
    const bump = (name: string): void => {
      let c = Math.round(v.get(name)) + clicks;
      c = ((((c - 1) % 360) + 360) % 360) + 1;
      v.set(name, c);
    };
    if (src === CDI_SOURCE.gps) {
      if (v.get(G1K.obs) < 0.5) return;
      bump(G1K.obsCourse);
      this.applyObs();
      v.set(vn(AP.selCourse, 1), v.get(G1K.obsCourse));
    } else {
      bump(vn(NAV.obs, src));
      v.set(vn(AP.selCourse, 1), v.get(vn(NAV.obs, src)));
    }
    this.crsChangedS = 0;
  }

  /** CRS knob push: centers the CDI (course = bearing to the station / active waypoint, or the LOC course). */
  crsCenter(): void {
    const v = this.vars;
    const src = this.cdiSource;
    if (src === CDI_SOURCE.gps) {
      if (v.get(G1K.obs) < 0.5) return;
      const b = v.get(FMS.bearingToWptMag);
      if (Number.isFinite(b)) v.set(G1K.obsCourse, Math.round(wrap360(b)) || 360);
      this.applyObs();
    } else if (v.get(vn(NAV.isLoc, src)) >= 0.5) {
      const c = v.get(vn(NAV.locCourse, src));
      if (Number.isFinite(c) && c > 0) v.set(vn(NAV.obs, src), Math.round(wrap360(c)) || 360);
    } else if (v.get(vn(NAV.bearingValid, src)) >= 0.5) {
      v.set(vn(NAV.obs, src), Math.round(wrap360(v.get(vn(NAV.bearing, src)))) || 360);
    }
    this.crsChangedS = 0;
  }

  /** RANGE knob: PFD inset / HSI map range, or the MFD map range (+ = zoom out). */
  rangeTurn(g: GduId, clicks: number): void {
    const name = this.formatOf(g) === 'pfd' ? G1K.pfdMapRange : G1K.mfdMapRange;
    this.stepRange(name, clicks);
  }

  stepRange(name: string, dir: number): number {
    const cur = this.vars.get(name, 10);
    let i = G1K_MAP_RANGES.findIndex((r) => r >= cur - 1e-6);
    if (i < 0) i = G1K_MAP_RANGES.length - 1;
    i = Math.max(0, Math.min(G1K_MAP_RANGES.length - 1, i + (dir > 0 ? 1 : dir < 0 ? -1 : 0)));
    this.vars.set(name, G1K_MAP_RANGES[i]);
    return G1K_MAP_RANGES[i];
  }

  /** Joystick push (MFD): map pointer on / off (PG §5.2 "Map Panning"). SCOPE: PFD inset map has no pointer here. */
  private rangePush(g: GduId): void {
    if (this.formatOf(g) !== 'mfd') return;
    const p = this.pointer;
    p.active = !p.active;
    p.dx = 0;
    p.dy = 0;
    this.revision++;
  }

  private joystick(g: GduId, payload: unknown): void {
    if (this.formatOf(g) !== 'mfd' || !this.pointer.active || !payload || typeof payload !== 'object') return;
    const o = payload as { x?: number; y?: number };
    // EST: 12 px per joystick event step at full deflection.
    this.pointer.dx += (o.x ?? 0) * 12;
    this.pointer.dy += (o.y ?? 0) * 12;
    this.revision++;
  }

  // ================================================================ CDI / bearings / OBS

  get cdiSource(): number {
    const s = this.vars.get(G1K.cdiSource);
    return s > this.cfg.radios.nav ? CDI_SOURCE.gps : s;
  }

  setCdiSource(src: number): void {
    const v = this.vars;
    if (src > this.cfg.radios.nav) src = CDI_SOURCE.gps;
    v.set(G1K.cdiSource, src);
    if (src !== CDI_SOURCE.gps) v.set(G1K.obs, 0);
    // The NAV tuning box follows the CDI (PG §4.3: "the CDI key ... moves the NAV tuning box").
    if (src !== CDI_SOURCE.gps) this.radios.setNavBox(src);
    this.afcsNavOverride = 0;
    this.revision++;
  }

  /** CDI softkey: GPS -> NAV1 -> NAV2 -> GPS (PG Table 1-3). */
  cycleCdi(): void {
    const cur = this.cdiSource;
    this.setCdiSource(cur >= this.cfg.radios.nav ? CDI_SOURCE.gps : cur + 1);
  }

  /** Bearing 1 / 2 softkeys: NAV1 -> NAV2 -> GPS -> ADF -> Off (PG Table 1-3). */
  cycleBearing(which: 1 | 2): void {
    const name = which === 1 ? G1K.brg1Source : G1K.brg2Source;
    const order: number[] = [BRG_SOURCE.nav1];
    if (this.cfg.radios.nav >= 2) order.push(BRG_SOURCE.nav2);
    order.push(BRG_SOURCE.gps);
    if (this.cfg.radios.adf) order.push(BRG_SOURCE.adf);
    order.push(BRG_SOURCE.off);
    const cur = order.indexOf(this.vars.get(name));
    this.vars.set(name, order[(cur + 1) % order.length]);
    this.revision++;
  }

  /** OBS softkey: OBS mode on the GPS CDI (only with an active leg); SUSP when sequencing is suspended. */
  toggleObs(): void {
    const v = this.vars;
    if (this.cdiSource !== CDI_SOURCE.gps) return;
    if (v.get(FMS.suspended) >= 0.5 && v.get(G1K.obs) < 0.5) {
      // SUSP: un-suspends automatic sequencing (at the MAP: activates the missed approach).
      this.fpl?.activateMissedApproach();
      return;
    }
    const on = v.get(G1K.obs) < 0.5;
    if (on && v.get(FMS.activeLegIndex, -1) < 0) return;
    v.set(G1K.obs, on ? 1 : 0);
    if (on) {
      const brg = v.get(FMS.dtkMag);
      v.set(G1K.obsCourse, Math.round(Number.isFinite(brg) ? brg : 0) || 360);
      this.applyObs();
    } else if (this.fms) {
      const i = this.fms.plans.active.activeLegIndex;
      if (i >= 0) this.fms.directTo(i);
    }
    this.revision++;
  }

  private applyObs(): void {
    if (!this.fms) return;
    const i = this.fms.plans.active.activeLegIndex;
    if (i >= 0) this.fms.directTo(i, this.vars.get(G1K.obsCourse));
  }

  /** PFD map layouts (Map/HSI > Layout softkeys). */
  setPfdMap(mode: number): void {
    this.vars.set(G1K.pfdMap, mode);
    this.revision++;
  }

  toggleVar(name: string): void {
    this.vars.set(name, this.vars.get(name) >= 0.5 ? 0 : 1);
    this.revision++;
  }

  setVar(name: string, value: number): void {
    this.vars.set(name, value);
    this.revision++;
  }

  cycleVar(name: string, n: number): void {
    this.vars.set(name, ((this.vars.get(name) | 0) + 1) % n);
    this.revision++;
  }

  /** 'Cancel Direct-To NAV' (MENU in the Direct-to window). SCOPE: re-activates the leg to the same waypoint (TF course from the previous waypoint). */
  cancelDirectTo(): void {
    const fpl = this.fpl;
    if (!fpl) return;
    const i = fpl.plan.activeLegIndex;
    if (i >= 0) fpl.activateLeg(i);
    this.closeWindow('dto');
  }

  /** DME tuning window: NAV1 / NAV2 / HOLD (HOLD keeps the DME on the frequency tuned when selected). */
  setDmeMode(i: number): void {
    const v = this.vars;
    const prev = v.get(G1K.dmeMode);
    const r = prev === DME_MODE.nav2 ? 2 : 1;
    v.set(G1K.dmeMode, i);
    for (let k = 1; k <= this.cfg.radios.nav; k++) v.set(vn(NAV.dmeHold, k), i === DME_MODE.hold && k === r ? 1 : 0);
  }

  /** Receiver whose DME is shown (DME window / DME info). */
  dmeReceiver(): number {
    const m = this.vars.get(G1K.dmeMode);
    if (m === DME_MODE.nav2) return 2;
    if (m === DME_MODE.hold) return this.vars.get(vn(NAV.dmeHold, 2)) >= 0.5 ? 2 : 1;
    return 1;
  }

  // ================================================================ radios / validity

  /** NAV receiver usable from the displays (its IAU up and linked to a working display, PG §1.3). */
  navRadioOk(r: number): boolean {
    return this.vars.get(vn(G1K.navValid, r)) >= 0.5;
  }

  comRadioOk(r: number): boolean {
    return this.vars.get(vn(G1K.comValid, r)) >= 0.5;
  }

  /** Transponder mode softkeys. */
  setXpdrMode(m: 1 | 2 | 3): void {
    if (!this.units.up('xpdr')) return;
    this.xpdr.setMode(m);
  }

  ident(): void {
    if (!this.units.up('xpdr')) return;
    this.xpdr.ident();
  }

  private ptt(p: unknown): void {
    const down = pressedOf(p, true);
    this.pttDown = down;
    this.pttHeldS = 0;
    this.gma.ptt(down);
  }

  toggleDisplayBackup(): void {
    this.toggleVar(G1K.displayBackup);
  }

  // ================================================================ approach / nav source

  /**
   * APR key pre-processing: with GPS on the CDI and an ILS / LOC approach in
   * the flight plan, the AFCS arms LOC / GS on NAV1 while the CDI still shows
   * GPS until the automatic switch conditions are met (PG §7.4 "Approach
   * Mode": "if the CDI is set to GPS and a LOC-based approach is loaded,
   * pressing APR arms LOC ... the CDI automatically switches").
   */
  prepareApproach(): void {
    if (this.cdiSource !== CDI_SOURCE.gps || !this.fpl) return;
    if (this.vars.get('ap.btn_apr') >= 0.5) return;
    if (!this.fpl.approachIsLoc()) return;
    if (this.vars.get(vn(NAV.isLoc, 1)) < 0.5) return;
    this.afcsNavOverride = 1;
    this.vars.set('ap.nav_source', 1);
  }

  private approachLoaded(proc: Procedure): void {
    const v = this.vars;
    this.refs.mins.reset(); // "minimums ... reset when another approach is loaded" (PG §2.4)
    if (proc.navFrequencyMhz && LOC_APPROACH_TYPES.has(proc.approachType ?? '')) {
      // PG §4.3 "Auto-tuning NAV frequencies on approach activation".
      this.radios.autoTuneApproach(proc.navFrequencyMhz, this.cdiSource);
      const magVar = v.get(GPS.magVar, this.fms?.plans.active.destination?.magVar ?? 0);
      const course = proc.navCourseTrue !== undefined ? Math.round(wrap360(proc.navCourseTrue - magVar)) || 360 : NaN;
      if (Number.isFinite(course)) for (let r = 1; r <= this.cfg.radios.nav; r++) v.set(vn(NAV.obs, r), course);
    }
    const dest = this.fms?.plans.active.destination;
    if (dest) this.refs.mins.destElevFt = dest.elevationFt;
    this.revision++;
  }

  private updateNavSource(): void {
    const v = this.vars;
    const plan = this.fms?.plans.active;
    if (plan && plan.version !== this.lastPlanVersion) {
      this.lastPlanVersion = plan.version;
      if (plan.approachProcedure && plan.approachProcedure !== this.lastAppr) this.approachLoaded(plan.approachProcedure);
      this.lastAppr = plan.approachProcedure;
      if (plan.destination) this.refs.mins.destElevFt = plan.destination.elevationFt;
    }
    const locApproach = !!this.fpl?.approachIsLoc();
    const latActive = v.getString(AP.lateralActive);
    const latArmed = v.getString(AP.lateralArmed);
    const locEngaged = latActive.startsWith('LOC') || latActive.startsWith('BC');
    const locArmed = latArmed.startsWith('LOC');
    // Automatic GPS -> LOC switch (PG §2.1): LOC approach loaded, FAF active within 15 nm, LOC tuned and
    // received, GPS CDI within 1.2 x full scale; the CDI then shows NAV1.
    if (this.cdiSource === CDI_SOURCE.gps && locApproach && plan) {
      const fafActive = plan.activeLegIndex >= 0 && plan.activeLegIndex === plan.fafIndex;
      const near = v.get(FMS.distToWptNm) < 15;
      const loc = v.get(vn(NAV.isLoc, 1)) >= 0.5 && v.get(vn(NAV.received, 1)) >= 0.5;
      const cdiOk = Math.abs(v.get(FMS.cdi)) < 1.2;
      if (loc && ((fafActive && near && cdiOk) || locEngaged)) {
        v.set(G1K.cdiSource, CDI_SOURCE.nav1);
        v.set(G1K.obs, 0);
        this.radios.setNavBox(1);
        this.revision++;
      }
    }
    // Localizer received on the CDI receiver: the course follows the localizer course once (PG §2.1).
    const src = this.cdiSource;
    if (src !== CDI_SOURCE.gps && v.get(vn(NAV.isLoc, src)) >= 0.5 && v.get(vn(NAV.received, src)) >= 0.5) {
      const ident = v.getString(vn(NAV.ident, src));
      if (this.locCourseSetFor !== ident) {
        const c = v.get(vn(NAV.locCourse, src));
        if (Number.isFinite(c) && c > 0) v.set(vn(NAV.obs, src), Math.round(wrap360(c)) || 360);
        this.locCourseSetFor = ident;
      }
    } else if (src !== CDI_SOURCE.gps) this.locCourseSetFor = '';
    if (this.afcsNavOverride) {
      const still = v.get('ap.btn_apr') >= 0.5 || locArmed || locEngaged;
      if (!still || !locApproach || this.cdiSource !== CDI_SOURCE.gps) this.afcsNavOverride = 0;
    }
    v.set('ap.nav_source', this.afcsNavOverride || this.cdiSource);
    if (src !== CDI_SOURCE.gps) v.set(vn(AP.selCourse, 1), v.get(vn(NAV.obs, src)));
    else if (v.get(G1K.obs) >= 0.5) v.set(vn(AP.selCourse, 1), v.get(G1K.obsCourse));
    // OBS is cancelled when there is no active leg.
    if (v.get(G1K.obs) >= 0.5 && v.get(FMS.activeLegIndex, -1) < 0) v.set(G1K.obs, 0);
  }

  // ================================================================ update

  update(dt: number): void {
    const v = this.vars;
    this.time += dt;
    v.set(G1K.alive, 1);
    const u = this.units;
    u.update(dt);
    // Power-cycle resets: MFD power-on page, minimums (PG §2.4), ESP enabled (PG §8.11).
    const pfdP = u.powered('pfd');
    const mfdP = u.powered('mfd');
    if (mfdP && !this.wasMfdPowered) v.set(G1K.mfdSplashAck, 0);
    if (pfdP && !this.wasPfdPowered) {
      this.refs.mins.reset();
      this.esp?.powerOn();
    }
    this.wasPfdPowered = pfdP;
    this.wasMfdPowered = mfdP;
    this.updateReversion();
    this.updateValidity();
    const airborne = this.airborne();
    this.radios.update(dt);
    this.xpdr.update(dt, airborne, u.up('xpdr'));
    if (this.xpdr.entryFinished) {
      this.xpdr.entryFinished = false;
      for (const g of GDU_IDS) if (this.pfdKeys[g].level === 'code') this.pfdKeys[g].goTo('xpdr');
    }
    this.gma.update(dt, u.powered('gma'), false);
    if (this.pttDown) {
      this.pttHeldS += dt;
      // Stuck microphone: the COM stops transmitting after 35 s (PG §4.6).
      if (this.pttHeldS >= STUCK_MIC_S) this.gma.ptt(false);
    }
    this.updateNavSource();
    // VNV cancelled (Cncl VNV softkey): vertical guidance invalid until re-enabled (PG §5.7).
    if (v.get(G1K.vnvEnabled) < 0.5) v.set(FMS.vnavValid, 0);
    this.refs.timer.update(dt);
    this.refs.mins.publish();
    this.updateAltitudeAlerts(dt, airborne);
    this.fuel.update(dt, u.up('gea'), airborne);
    // AFCS monitor and ESP.
    this.afcsMon.update(dt, u.up('gia1'), u.supplied('servos'), u.powered('servos'), u.up('servos'), u.bootProgress('servos') < 1 ? (1 - u.bootProgress('servos')) * this.cfg.bootS.servos : 0);
    if (this.esp) {
      const agl = this.aglFt();
      const avail = u.up('gia1') && u.up('adahrs') && u.up('servos');
      this.esp.update(dt, avail, agl, this.stallWarning());
    }
    // CAS: needs the engine/airframe unit and a display.
    this.alerts.update(dt, u.up('gea') && (u.up('pfd') || u.up('mfd')));
    // Softkeys (inactivity revert) and MFD page timers.
    this.pfdKeys.pfd.update(dt);
    this.pfdKeys.mfd.update(dt);
    this.mfdKeys.update(dt);
    this.mfd.update(dt);
    this.hdgChangedS += dt;
    this.crsChangedS += dt;
    // Slow refreshes (lists, messages) at 2 Hz.
    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.5;
      this.slowUpdate(0.5);
    }
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) {
      this.msgTimer = 0.5;
      this.updateMessages(airborne);
    }
    if (this.refs.timer.expired) this.alerts.message('timer', 'TIMER EXPIRD – Timer has expired.', true);
  }

  private updateAltitudeAlerts(dt: number, airborne: boolean): void {
    const v = this.vars;
    if (!this.units.up('pfd') && !this.units.up('mfd')) return;
    if (v.get(vn(ADC.valid, 1), 1) < 0.5) return;
    const alt = v.get(ALT1);
    this.altAlert.update(alt, v.get(AP.selAltitude), dt);
    const ph = this.altAlert.phase;
    if (ph !== this.lastAltPhase) {
      // Tone within 200 ft and on a deviation (PG §2.1); not on the ground.
      if (airborne && (ph === 'near' || ph === 'deviation')) this.audio?.play('alt_alert');
      this.lastAltPhase = ph;
    }
    this.altAlert.consumeAural();
    const mins = this.refs.mins.effectiveFt();
    this.minsAlert.update(alt, Number.isFinite(mins) ? mins : NaN, !airborne, dt);
    if (this.minsAlert.consumeAural()) this.audio?.callout('Minimums, minimums', 6);
  }

  private slowUpdate(dt: number): void {
    const w = this.pfdWindow;
    w?.update(dt);
    this.mfd.page.update(dt);
    if (this.mfd.page !== this.mfd.basePage) this.mfd.basePage.update(dt);
  }

  /** Height above terrain (ft) for ESP: binding, else GPS altitude minus the terrain database (world). */
  aglFt(): number {
    if (this.aglEval) return this.aglEval();
    const v = this.vars;
    if (!this.world || v.get(GPS.valid) < 0.5) return NaN;
    return v.get(GPS.alt) - this.world.elevationAt(v.get(GPS.lat), v.get(GPS.lon)) / 0.3048;
  }

  private updateReversion(): void {
    const v = this.vars;
    const u = this.units;
    const pfd = u.up('pfd');
    const mfd = u.up('mfd');
    const manual = v.get(G1K.displayBackup) >= 0.5;
    // PG §1.3: automatic reversion on a display failure; DISPLAY BACKUP selects it manually (both displays).
    const auto = this.cfg.autoReversion;
    const revPfd = pfd && (manual || (auto && !mfd));
    const revMfd = mfd && (manual || (auto && !pfd));
    v.set(vn(G1K.reversionary, 'pfd'), revPfd ? 1 : 0);
    v.set(vn(G1K.reversionary, 'mfd'), revMfd ? 1 : 0);
    if (manual !== this.prevDisplayBackup >= 0.5) {
      this.prevDisplayBackup = manual ? 1 : 0;
      this.revision++;
    }
  }

  /**
   * NAV / COM validity (PG §1.3): each IAU talks to its display; with a
   * display failed, the NAV / COM of that display's IAU are flagged invalid
   * on the remaining display. COM also needs its breaker (COMM 1 / COMM 2).
   */
  private updateValidity(): void {
    const v = this.vars;
    const u = this.units;
    const link1 = u.up('gia1') && u.up('pfd');
    const link2 = u.up('gia2') && u.up('mfd');
    v.set(vn(G1K.navValid, 1), link1 ? 1 : 0);
    v.set(vn(G1K.navValid, 2), link2 ? 1 : 0);
    v.set(vn(G1K.comValid, 1), link1 && u.up('com1') ? 1 : 0);
    v.set(vn(G1K.comValid, 2), link2 && u.up('com2') ? 1 : 0);
  }

  /** LRU list for 'Aux - System Status' (PG §1.3 "System Status"). */
  lruStatus(): { name: string; ok: boolean }[] {
    const u = this.units;
    const L = (name: string, id: G1kUnit): { name: string; ok: boolean } => ({ name, ok: u.up(id) });
    const out = [
      L('PFD1 (GDU 1054B)', 'pfd'),
      L('MFD1 (GDU 1054B)', 'mfd'),
      L('GIA1 (GIA 63W)', 'gia1'),
      L('GIA2 (GIA 63W)', 'gia2'),
      L('GEA1 (GEA 71B)', 'gea'),
      L('ADAHRS1 (GSU 75)', 'adahrs'),
      L('GMU1 (GMU 44)', 'gmu'),
      L('XPDR1 (GTX 345R)', 'xpdr'),
      L('GMA1 (GMA 1360)', 'gma'),
      L('GFC 700 (GSA 81)', 'servos'),
    ];
    if (this.cfg.radios.dme) out.push(L('DME1 (KN 63)', 'dme'));
    if (this.cfg.radios.adf) out.push(L('ADF1 (KR 87)', 'adf'));
    return out;
  }

  private updateMessages(airborne: boolean): void {
    const v = this.vars;
    const a = this.alerts;
    const u = this.units;
    const gpsPowered = u.up('gia1') || u.up('gia2');
    a.message('gps', 'GPS NAV LOST – Loss of GPS navigation. Insufficient satellites.', gpsPowered && v.get(GPS.valid) < 0.5 && v.get(GPS.acquireS) <= 0 && v.get(FMS.activeLegIndex, -1) >= 0);
    a.message('xpdr', 'XPDR1 FAIL – XPDR1 is inoperative.', u.up('gia1') && u.supplied('xpdr') && !u.up('xpdr') && !u.booting('xpdr'));
    a.message('hdg', 'HDG FAULT – AHRS1 magnetometer fault has occurred.', u.up('adahrs') && u.supplied('gmu') && !u.up('gmu'));
    a.message('com1ptt', 'COM1 PTT – COM1 push-to-talk key is stuck.', this.pttDown && this.pttHeldS >= STUCK_MIC_S && this.gma.mic !== 2);
    a.message('com2ptt', 'COM2 PTT – COM2 push-to-talk key is stuck.', this.pttDown && this.pttHeldS >= STUCK_MIC_S && this.gma.mic === 2);
    // Waypoint arrival (the FMS "WPT" alert) and arrival alert at the destination.
    const wa = v.get(FMS.wptAlert);
    if (wa >= 0.5 && this.lastWptAlert < 0.5) a.message('wpt', `WPT ARRIVAL – Arriving at waypoint -[${v.getString(FMS.nextWptIdent)}]`, true);
    else if (wa < 0.5 && this.lastWptAlert >= 0.5) a.message('wpt', '', false);
    this.lastWptAlert = wa;
    const plan = this.fms?.plans.active;
    // Approach not active within 2 nm of the FAF with the approach loaded (EST distance; PG message APR INACTV).
    const fafNear = !!plan && plan.approachProcedure !== null && plan.activeLegIndex === plan.fafIndex && v.get(FMS.distToWptNm) < 2;
    a.message('aprinactv', 'APR INACTV – Approach is not active.', fafNear && v.get(FMS.approachActive) < 0.5);
    // LOC approach flown with GPS on the CDI near the FAF: select NAV / the approach frequency (PG Appendix A).
    const locAppr = !!this.fpl?.approachIsLoc() && !!plan && plan.activeLegIndex >= plan.fafIndex && plan.fafIndex >= 0;
    const tunedLoc = v.get(vn(NAV.isLoc, 1)) >= 0.5 || v.get(vn(NAV.isLoc, 2)) >= 0.5;
    a.message('slctfreq', 'SLCT FREQ – Select appropriate frequency for approach.', locAppr && !tunedLoc);
    a.message('slctnav', 'SLCT NAV – Select NAV on CDI for approach.', locAppr && tunedLoc && this.cdiSource === CDI_SOURCE.gps && v.get(FMS.distToWptNm) < 2);
    // Arrival alert (Aux - System Setup 1): destination within the set distance.
    const dd = v.get(FMS.distToDestNm, NaN);
    const arr = v.get(G1K.arrivalAlert) >= 0.5 && airborne && Number.isFinite(dd) && dd <= v.get(G1K.arrivalAlertNm) && !!plan?.destination;
    if (arr && !this.arrivalShown) a.message('arrival', `ARRIVAL – Arriving at destination -[${plan?.destination?.icao ?? ''}]`, true);
    if (!arr && this.arrivalShown) a.message('arrival', '', false);
    this.arrivalShown = arr;
  }

  // ================================================================ state presets

  /**
   * Avionics part of an aircraft state preset: cold & dark shows the power-on
   * page and resets references; other states skip the boot and power-on page.
   */
  applyState(state: 'cold_dark' | 'ready_to_taxi' | 'takeoff' | 'cruise' | 'approach'): void {
    const v = this.vars;
    if (state === 'cold_dark') {
      v.set(G1K.mfdSplashAck, 0);
      this.refs.mins.reset();
      this.refs.timer.reset();
      v.set(G1K.flightTimeS, 0);
      v.set(G1K.displayBackup, 0);
      return;
    }
    this.units.forceBooted();
    this.wasPfdPowered = this.units.powered('pfd');
    this.wasMfdPowered = this.units.powered('mfd');
    v.set(G1K.mfdSplashAck, 1);
    v.set(G1K.displayBackup, 0);
    this.mfd.selectById('map_nav');
    if (state === 'takeoff' || state === 'ready_to_taxi') {
      v.set(G1K.flightTimeS, 0);
      this.fuel.resetFuel();
    }
    this.setCdiSource(CDI_SOURCE.gps);
    if (state === 'approach' && v.get(vn(NAV.activeFreq, 1)) >= 108.1 && v.get(vn(NAV.activeFreq, 1)) < 112) this.setCdiSource(CDI_SOURCE.nav1);
    // Transponder ALT for any state other than cold & dark (PG §4.4: ALT for flight).
    v.set(NAV.xpdrMode, 3);
    this.revision++;
  }

  reset(): void {
    this.esp?.reset();
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
    this.alerts.dispose();
    this.afcsMon.dispose();
  }
}

function pressedOf(p: unknown, fallback: boolean): boolean {
  if (typeof p === 'boolean') return p;
  if (typeof p === 'number') return p >= 0.5;
  if (p && typeof p === 'object' && 'pressed' in p) return !!(p as { pressed: unknown }).pressed;
  return fallback;
}

/** IAS readout used by softkey conditions (declutter etc.). */
export const G1K_IAS_VAR = IAS1;
/** Pressure altitude var used for the RPM green-arc schedule. */
export const G1K_ALT_VAR = ALT1;
