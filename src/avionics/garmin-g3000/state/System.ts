/**
 * `G3000System`: the avionics "computer" behind every G3000 / G5000 display.
 * One instance per aircraft, run as a `Subsystem` (60 Hz) after the radios,
 * FMS and AFCS. It owns the state that the PFDs, the MFD and the GTCs share:
 *
 *  - unit power, boot and reversionary modes (PG 190-02046-01 §1.2, §1.4);
 *  - PFD settings per side (nav source, bearing pointers, wind, AOA, baro
 *    units, inset map, sensors) and the pane layout (PFD split, MFD half /
 *    full, pane contents, GTC pane selection; PG §1.3);
 *  - radios, audio panel and transponder state (PG §4);
 *  - references: minimums, timer, V-speeds, N1 bug, TOLD, weight & fuel,
 *    electronic checklists, system messages;
 *  - the AFCS glue: CDI source -> `ap.nav_source`, the ILS rule that arms
 *    LOC/GS on APR with FMS selected and switches the CDI to LOC (PG §2.1
 *    "Course Deviation Indicator"), course / heading / altitude / baro / speed
 *    knob handling for the GMC 710 and the baro knobs.
 *
 * State that other modules or the cockpit may need is published as SimVars
 * (`g3k.*`, see vars.ts); displays read the same vars plus this object.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { AudioApi } from '../../../core/SimContext';
import type { Subsystem } from '../../../aircraft/types';
import type { NavDatabase } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { Procedure } from '../../../nav/types';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { wrap360 } from '../../../core/math';
import { compileBinding, type Evaluator } from '../../../systems/util/binding';
import { CasModel } from '../../common/draw/CasWindow';
import type { MapOrientation } from '../../common/draw/MovingMap';
import type { G3000Resolved, ResolvedGtc } from '../config';
import {
  AOA_MODE,
  BRG_SOURCE,
  G3K,
  G3K_EVENTS,
  GTC_MODE,
  MINS_MODE,
  NAV_SOURCE,
  PANE_CONTENT,
  PANE_IDS,
  PFD_MAP,
  WIND_OPTION,
  vn,
  type GduId,
  type GtcModeName,
  type PaneContent,
  type PaneId,
} from '../vars';
import { FplEditor, LOC_APPROACH_TYPES } from './FplEditor';
import { ChecklistModel, GenericTimer, MessageList, MinimumsModel, ToldModel, VSpeedBank, WeightFuel } from './models';
import { IDENT_S, stepAdf, stepCom, stepNav, VFR_CODE } from './radios';

/** Subset of `TcasThreat` (systems/warning/Tcas) used by the maps. */
export interface TrafficThreatLike {
  relBrgDeg: number;
  rangeNm: number;
  relAltFt: number;
  vsSign: number;
  level: number;
}

/** Navigation map settings (PG §5.2 "Using Map Displays"). */
export interface MapSettings {
  orientation: MapOrientation;
  /** 0 All, 1 DCLTR 1, 2 DCLTR 2, 3 Least (PG §1.3 "Detail"). */
  detail: 0 | 1 | 2 | 3;
  terrain: 'off' | 'topo' | 'relative';
  traffic: boolean;
  airports: boolean;
  navaids: boolean;
  fixes: boolean;
  trackVector: boolean;
  rangeRings: boolean;
  weather: boolean;
}

export type MapKey = PaneId | 'inset1' | 'inset2';

export interface PointerState {
  active: boolean;
  dx: number;
  dy: number;
}

/** Default map ranges (nm) at power-up (EST: Garmin default 10 nm nav map, 15 nm PFD inset per the PG figures). */
const DEFAULT_PANE_RANGE = 10;
const DEFAULT_INSET_RANGE = 15;

/** Garmin map range set (PG §5.2 "Map Range": 28 ranges, 250 ft to 1000 nm). */
export const G3K_MAP_RANGES: readonly number[] = [
  250 / 6076.12, 500 / 6076.12, 750 / 6076.12, 1000 / 6076.12, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 750, 1000,
];

/** Comparator thresholds (EST, from the G1000 comparator table: ALT 200 ft, IAS 10 kt, HDG 6°, PIT 5°, ROL 6°). */
const CMP = { alt: 200, ias: 10, hdg: 6, pit: 5, rol: 6 };

/** PFD sides (shared constant: no per-frame array literals). */
const SIDES: readonly (1 | 2)[] = [1, 2];

interface Unit {
  id: string;
  power: Evaluator;
  bootS: number;
  left: number;
  powered: boolean;
  up: boolean;
  failVar: string;
  displayPowerVar: string;
  poweredVar: string;
  bootingVar: string;
}

export interface SystemEnv {
  vars: SimVars;
  events?: EventBus;
  audio?: AudioApi;
  nav: NavDatabase;
  world?: WorldQuery;
}

export class G3000System implements Subsystem {
  readonly name = 'g3000';
  readonly cfg: G3000Resolved;
  readonly vars: SimVars;
  readonly events: EventBus | null;
  readonly audio: AudioApi | null;
  readonly nav: NavDatabase;
  readonly world: WorldQuery | null;
  readonly fms: Fms | null;
  readonly fpl: FplEditor | null;
  readonly cas: CasModel;
  readonly timer: GenericTimer;
  readonly vspeeds: VSpeedBank;
  readonly mins: MinimumsModel;
  readonly told: ToldModel;
  readonly wf: WeightFuel;
  readonly checklists: ChecklistModel;
  readonly messages = new MessageList();
  readonly maps: Record<MapKey, MapSettings>;
  readonly pointers: Record<PaneId, PointerState>;
  /** PFD inset map pointers (GCU 275 RANGE push / joystick, state/Gcu.ts); inactive unless an aircraft has a GCU. */
  readonly insetPointers: Record<1 | 2, PointerState> = { 1: { active: false, dx: 0, dy: 0 }, 2: { active: false, dx: 0, dy: 0 } };
  /** Seconds since the heading / course was last changed (HSI readouts show for 3 s, PG §2.1). */
  hdgChangedS = 99;
  crsChangedS: [number, number, number] = [99, 99, 99];
  /** Weather radar settings (state only; there is no radar model: SCOPE). */
  readonly radar = { on: false, mode: 'STBY' as 'STBY' | 'WX' | 'GND', tiltDeg: 0, gain: 0, bearingDeg: 0 };
  /** AFCS nav source override (receiver index) while an ILS approach is armed from the FMS (0 = none). */
  afcsNavOverride = 0;
  /** Monotonic time (s) for blink phases and inactivity timers. */
  time = 0;
  /** Bumped whenever GTC-visible state changes that is not in a var (pages redraw). */
  revision = 0;
  /** GTC-driven selections shown on MFD panes (nearest list kind, waypoint info airport, procedure preview). */
  readonly ui = {
    nearestKind: 'airport' as 'airport' | 'vor' | 'ndb' | 'int',
    wptInfoIdent: '',
    procPreview: null as null | { airport: string; kind: 'departure' | 'arrival' | 'approach'; ident: string; transition?: string },
    /** Selected synoptic page index for the GTC systems screen. */
    synoptic: 0,
  };
  /** CAS rows visible in the last drawn CAS window (GTC CAS scroll buttons use it). */
  casRows = 8;
  /** Traffic threats for the maps (systems/warning Tcas `threats`), null = no traffic system data. */
  trafficSource: { threats: readonly TrafficThreatLike[] } | null = null;

  private readonly units: Unit[] = [];
  private readonly unitById = new Map<string, Unit>();
  private readonly offs: (() => void)[] = [];
  private readonly revSw: Record<GduId, string>;
  private msgTimer = 0;
  private lastAppr: Procedure | null = null;
  private lastPlanVersion = -1;
  private locCourseSetFor: [string, string, string] = ['', '', ''];
  private readonly prevPowered = new Map<string, boolean>();

  constructor(env: SystemEnv, cfg: G3000Resolved, fms: Fms | null, casModel?: CasModel) {
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
    this.cas = casModel ?? new CasModel();
    this.timer = new GenericTimer(env.vars);
    this.vspeeds = new VSpeedBank(env.vars, cfg.vspeeds);
    this.mins = new MinimumsModel(env.vars);
    this.told = new ToldModel(env.vars, cfg.performance);
    this.wf = new WeightFuel(env.vars, cfg.weights, cfg.fuelTotalVar);
    this.checklists = new ChecklistModel(cfg.checklists);
    const mk = (range: boolean): MapSettings => ({
      orientation: 'heading-up',
      detail: 0,
      terrain: cfg.taws === 'B' || cfg.taws === 'A' ? 'relative' : 'off',
      traffic: range,
      airports: true,
      navaids: true,
      fixes: true,
      trackVector: false,
      rangeRings: true,
      weather: false,
    });
    this.maps = { pfd1: mk(true), mfd1: mk(true), mfd2: mk(true), pfd2: mk(true), inset1: mk(true), inset2: mk(true) };
    this.pointers = { pfd1: { active: false, dx: 0, dy: 0 }, mfd1: { active: false, dx: 0, dy: 0 }, mfd2: { active: false, dx: 0, dy: 0 }, pfd2: { active: false, dx: 0, dy: 0 } };
    this.revSw = { pfd1: G3K.reversionSwitch('pfd1'), pfd2: G3K.reversionSwitch('pfd2'), mfd: G3K.reversionSwitch('mfd') };

    // Units: GDUs and GTCs with power bindings and boot timers.
    const addUnit = (id: string, bootS: number): void => {
      const u: Unit = { id, power: compileBinding(env.vars, cfg.power[id as GduId], 1), bootS, left: 0, powered: false, up: false, failVar: `fail.g3k.${id}`, displayPowerVar: `display.${id}.power`, poweredVar: vn(G3K.unitPowered, id), bootingVar: vn(G3K.unitBooting, id) };
      this.units.push(u);
      this.unitById.set(id, u);
    };
    addUnit('pfd1', cfg.bootS.gdu);
    addUnit('mfd', cfg.bootS.gdu);
    if (cfg.pfdCount === 2) addUnit('pfd2', cfg.bootS.gdu);
    for (const g of cfg.gtcs) addUnit(g.id, cfg.bootS.gtc);

    this.initVars();
    this.listenEvents();
  }

  // ================================================================ init

  private initVars(): void {
    const v = this.vars;
    const init = (name: string, value: number): void => {
      if (!v.has(name)) v.set(name, value);
    };
    v.set(G3K.variant, this.cfg.variant === 'g5000' ? 1 : 0);
    init(G3K.mfdHalf, 1);
    init(G3K.fdCoupledSide, 1);
    init(G3K.baroSync, 1);
    init(G3K.comSpacing833, 0);
    init(G3K.xpdrActive, 1);
    init(G3K.speedFms, 0);
    init(G3K.minsMode, MINS_MODE.off);
    init(G3K.minsFt, 200);
    init(G3K.minsTempC, 15);
    init(G3K.n1Target, NaN);
    init(G3K.speaker, 1);
    init(G3K.mfdSplashAck, 0);
    for (const p of PANE_IDS) {
      init(vn(G3K.paneContent, p), this.cfg.defaultPanes[p]);
      init(vn(G3K.paneSynoptic, p), 0);
      init(vn(G3K.paneRange, p), DEFAULT_PANE_RANGE);
    }
    for (const s of [1, 2]) {
      init(vn(G3K.pfdSplit, s), 0);
      init(vn(G3K.navSource, s), NAV_SOURCE.fms);
      init(vn(G3K.brg1Source, s), BRG_SOURCE.off);
      init(vn(G3K.brg2Source, s), BRG_SOURCE.off);
      init(vn(G3K.pfdMap, s), PFD_MAP.off);
      init(vn(G3K.pfdMapRange, s), DEFAULT_INSET_RANGE);
      init(vn(G3K.pfdTrafficInset, s), 0);
      init(vn(G3K.windOption, s), WIND_OPTION.arrowSpeed);
      init(vn(G3K.aoaMode, s), AOA_MODE.auto);
      init(vn(G3K.baroHpa, s), 0);
      init(vn(G3K.metersOverlay, s), 0);
      init(vn(G3K.adcSel, s), Math.min(s, this.cfg.sensors.adc));
      init(vn(G3K.ahrsSel, s), Math.min(s, this.cfg.sensors.ahrs));
      init(vn(G3K.obs, s), 0);
      init(vn(G3K.obsCourse, s), 0);
      init(vn(G3K.dmeWindow, s), 0);
      init(vn(G3K.fdFormat, s), 0);
      init(vn(G3K.svt, s), 0);
      init(vn(G3K.baroPreselect, s), 29.92);
      init(vn(AP.selCourse, s), 0);
      init(vn(G3K.micSelect, s), s);
      init(G3K.comMonitor(s, 1), 0);
      init(G3K.comMonitor(s, 2), 0);
      init(vn(G3K.markerAudio, s), 1);
      init(G3K.comVolume(s, 1), 0.8);
      init(G3K.comVolume(s, 2), 0.8);
    }
    for (const g of this.cfg.gtcs) {
      init(G3K.gtcMode(g.id), GTC_MODE[g.modes[0].toLowerCase() as 'pfd' | 'mfd' | 'navcom']);
      const firstPane = g.panes.find((p) => p.startsWith('mfd')) ?? g.panes[0];
      init(G3K.gtcPane(g.id), PANE_IDS.indexOf(firstPane) + 1);
    }
    // Radios: power-up frequencies (EST: Garmin restores the last frequencies; these are neutral defaults).
    init(vn(NAV.comActive, 1), 118.1);
    init(vn(NAV.comStandby, 1), 121.5);
    init(vn(NAV.comActive, 2), 121.9);
    init(vn(NAV.comStandby, 2), 118.0);
    for (let r = 1; r <= this.cfg.radios.nav; r++) {
      init(vn(NAV.activeFreq, r), 110.0);
      init(vn(NAV.standbyFreq, r), 113.0);
      init(vn(NAV.obs, r), 0);
    }
    if (this.cfg.radios.adf) {
      init(vn(NAV.adfActive, 1), 350);
      init(vn(NAV.adfStandby, 1), 400);
    }
    init(NAV.xpdrCode, VFR_CODE);
    init(NAV.xpdrMode, 1);
    init(AP.selHeading, 360);
    init(AP.selAltitude, 10000);
    init(AP.selSpeed, 200);
    init(AP.selMach, 0.6);
    if (!v.getString(G3K.flightId)) v.setString(G3K.flightId, '');
    this.mins.publish();
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
    // Rotary encoders: signed clicks on `<name>`, or positive clicks on `<name>_inc` / `<name>_dec`
    // (the cockpit RotaryKnob encoder convention).
    const turn = (name: string, fn: (n: number) => void): void => {
      on(name, (p) => fn(clicks(p)));
      on(`${name}_inc`, (p) => fn(Math.abs(clicks(p))));
      on(`${name}_dec`, (p) => fn(-Math.abs(clicks(p))));
    };
    // GMC 710 knobs are dead while the controller is unpowered (`g3k.gmc.powered`, written by Gmc710).
    const gmc = (): boolean => this.vars.get(G3K.gmcPowered, 1) >= 0.5;
    for (const s of SIDES) {
      turn(G3K_EVENTS.baroTurn(s), (n) => this.baroTurn(s, n));
      on(G3K_EVENTS.baroPush(s), () => this.baroPush(s));
      turn(G3K_EVENTS.rangeTurn(s), (n) => this.pfdRangeStep(s, n));
      turn(G3K_EVENTS.minsTurn(s), (n) => this.minsTurn(n));
      on(G3K_EVENTS.minsPush(s), () => this.minsPush());
      turn(G3K_EVENTS.crsTurn(s), (n) => gmc() && this.crsTurn(s, n));
      on(G3K_EVENTS.crsPush(s), () => gmc() && this.crsPush(s));
    }
    turn(G3K_EVENTS.hdgTurn, (n) => gmc() && this.hdgTurn(n));
    on(G3K_EVENTS.hdgPush, () => gmc() && this.hdgPush());
    turn(G3K_EVENTS.altTurnOuter, (n) => gmc() && this.altTurn(n, true));
    turn(G3K_EVENTS.altTurnInner, (n) => gmc() && this.altTurn(n, false));
    on(G3K_EVENTS.altPush, () => gmc() && this.altPush());
    turn(G3K_EVENTS.spdTurn, (n) => gmc() && this.spdTurn(n));
    on(G3K_EVENTS.spdPush, () => gmc() && this.spdPush());
    on(G3K_EVENTS.xfr, () => gmc() && this.xfr());
    turn(G3K_EVENTS.noseWheel, (n) => gmc() && this.emitAfcs(n >= 0 ? 'up' : 'dn', { steps: Math.abs(n) }));
    on(G3K_EVENTS.casAck, () => {
      this.cas.acknowledge('warning');
      this.cas.acknowledge('caution');
    });
    // Master warning / caution acknowledges also reach the suite's CAS model.
    on('cas.ack_warning', () => this.cas.acknowledge('warning'));
    on('cas.ack_caution', () => this.cas.acknowledge('caution'));
    on('cas.ack', () => this.cas.acknowledgeAll());
  }

  /** Current traffic threats, or null when no traffic system is connected. */
  trafficThreats(): readonly TrafficThreatLike[] | null {
    return this.trafficSource ? this.trafficSource.threats : null;
  }

  // ================================================================ units / reversion

  /** True when the unit is powered, not failed and finished booting. */
  unitUp(id: string): boolean {
    return this.unitById.get(id)?.up ?? false;
  }

  unitPowered(id: string): boolean {
    return this.unitById.get(id)?.powered ?? false;
  }

  unitBooting(id: string): boolean {
    const u = this.unitById.get(id);
    return !!u && u.powered && !u.up;
  }

  private updateUnits(dt: number): void {
    const v = this.vars;
    for (const u of this.units) {
      const p = u.power() >= 0.5 && v.get(u.failVar) < 0.5;
      if (p && !u.powered) u.left = u.bootS;
      u.powered = p;
      if (p && u.left > 0) u.left -= dt;
      u.up = p && u.left <= 0;
      v.set(u.displayPowerVar, p ? 1 : 0);
      v.set(u.poweredVar, p ? 1 : 0);
      v.set(u.bootingVar, p && !u.up ? 1 : 0);
      // Power cycle resets: the MFD splash returns and minimums reset (PG §2.4).
      const was = this.prevPowered.get(u.id) ?? false;
      if (u.id === 'mfd' && p && !was) v.set(G3K.mfdSplashAck, 0);
      if (u.id === 'pfd1' && p && !was && this.prevPowered.size > 0) this.mins.reset();
      this.prevPowered.set(u.id, p);
    }
  }

  /** Skips boot timers (state presets / tests). */
  forceBooted(): void {
    for (const u of this.units) {
      u.left = 0;
      u.powered = u.power() >= 0.5;
      u.up = u.powered;
      this.prevPowered.set(u.id, u.powered);
    }
    this.vars.set(G3K.mfdSplashAck, 1);
  }

  private updateReversion(): void {
    const v = this.vars;
    const pfd1 = this.unitUp('pfd1');
    const mfd = this.unitUp('mfd');
    const pfd2 = this.cfg.pfdCount === 2 && this.unitUp('pfd2');
    // PG §1.4 "Reversionary Display Operation": PFD1 failure -> MFD reversionary, PFD2 split;
    // MFD failure -> PFD1 reversionary, PFD2 split; PFD2 failure -> no change. "The system does not
    // automatically switch to reversionary mode": the crew uses the reversion switches, unless the
    // installation enables `autoReversion`.
    const auto = this.cfg.autoReversion;
    const revMfd = (v.get(this.revSw.mfd) >= 0.5 || (auto && !pfd1)) && mfd;
    const revPfd1 = (v.get(this.revSw.pfd1) >= 0.5 || (auto && !mfd)) && pfd1;
    const revPfd2 = v.get(this.revSw.pfd2) >= 0.5 && pfd2 && !pfd1;
    const prevMfd = v.get(G3K.reversionary('mfd'));
    const prevPfd1 = v.get(G3K.reversionary('pfd1'));
    v.set(G3K.reversionary('mfd'), revMfd ? 1 : 0);
    v.set(G3K.reversionary('pfd1'), revPfd1 ? 1 : 0);
    v.set(G3K.reversionary('pfd2'), revPfd2 ? 1 : 0);
    if (((revMfd && !prevMfd) || (revPfd1 && !prevPfd1)) && pfd2) v.set(vn(G3K.pfdSplit, 2), 1);
  }

  isReversionary(id: GduId): boolean {
    return this.vars.get(vn(G3K.reversionary, id)) >= 0.5;
  }

  // ================================================================ panes

  paneContent(p: PaneId): PaneContent {
    return this.vars.get(vn(G3K.paneContent, p)) as PaneContent;
  }

  /** Panes currently shown on some display. */
  paneVisible(p: PaneId): boolean {
    const v = this.vars;
    if (p === 'mfd1') return this.unitUp('mfd') && !this.isReversionary('mfd');
    if (p === 'mfd2') return this.unitUp('mfd') && !this.isReversionary('mfd') && v.get(G3K.mfdHalf) >= 0.5;
    const s = p === 'pfd1' ? 1 : 2;
    const gdu: GduId = s === 1 ? 'pfd1' : 'pfd2';
    // A reversionary GDU shows PFD + condensed EIS only; the pane moves to the other PFD in split mode (PG §1.4).
    return this.unitUp(gdu) && v.get(vn(G3K.pfdSplit, s)) >= 0.5 && !this.isReversionary(gdu);
  }

  /** Synoptics and a few other panes are half-size only (Longitude OG 4-8). */
  static fullCapable(c: PaneContent): boolean {
    return c !== PANE_CONTENT.synoptics && c !== PANE_CONTENT.checklist && c !== PANE_CONTENT.weightFuel && c !== PANE_CONTENT.told;
  }

  setPaneContent(p: PaneId, c: PaneContent, synoptic?: number): void {
    this.vars.set(vn(G3K.paneContent, p), c);
    if (synoptic !== undefined) this.vars.set(vn(G3K.paneSynoptic, p), synoptic);
    if (p === 'mfd1' && this.vars.get(G3K.mfdHalf) < 0.5 && !G3000System.fullCapable(c)) this.vars.set(G3K.mfdHalf, 1);
    this.revision++;
  }

  setMfdHalf(half: boolean): boolean {
    if (!half && !G3000System.fullCapable(this.paneContent('mfd1'))) return false;
    this.vars.set(G3K.mfdHalf, half ? 1 : 0);
    this.revision++;
    return true;
  }

  setPfdSplit(side: number, split: boolean): void {
    this.vars.set(vn(G3K.pfdSplit, side), split ? 1 : 0);
    this.revision++;
  }

  /** Pane selected by a GTC (null when none selectable). */
  gtcPane(g: ResolvedGtc): PaneId | null {
    const i = this.vars.get(G3K.gtcPane(g.id)) | 0;
    const p = PANE_IDS[i - 1];
    if (p && this.paneVisible(p) && g.panes.includes(p)) return p;
    const alt = g.panes.find((q) => this.paneVisible(q));
    if (alt) this.vars.set(G3K.gtcPane(g.id), PANE_IDS.indexOf(alt) + 1);
    return alt ?? null;
  }

  /** Steps the GTC pane selection through its visible panes (upper knob in MFD mode). */
  cycleGtcPane(g: ResolvedGtc, dir: number): void {
    const vis = g.panes.filter((p) => this.paneVisible(p));
    if (!vis.length) return;
    const cur = this.gtcPane(g);
    const i = cur ? vis.indexOf(cur) : -1;
    const n = (((i + (dir >= 0 ? 1 : -1)) % vis.length) + vis.length) % vis.length;
    this.vars.set(G3K.gtcPane(g.id), PANE_IDS.indexOf(vis[n]) + 1);
    this.revision++;
  }

  /** GTC whose MFD mode currently controls pane `p` (for the cyan / purple selection border). */
  paneOwner(p: PaneId): ResolvedGtc | null {
    for (const g of this.cfg.gtcs) {
      if (!this.unitUp(g.id)) continue;
      if (this.vars.get(G3K.gtcMode(g.id)) !== GTC_MODE.mfd) continue;
      if (this.gtcPane(g) === p) return g;
    }
    return null;
  }

  setGtcMode(g: ResolvedGtc, mode: GtcModeName): void {
    if (!g.modes.includes(mode)) return;
    const code = GTC_MODE[mode.toLowerCase() as 'pfd' | 'mfd' | 'navcom'];
    // Only one GTC may control MFD panes at a time (PG §1.3 "Controlling Display Panes"):
    // the other reverts to NAV/COM (or its first mode).
    if (code === GTC_MODE.mfd) {
      for (const o of this.cfg.gtcs) {
        if (o.id === g.id || this.vars.get(G3K.gtcMode(o.id)) !== GTC_MODE.mfd) continue;
        const shared = o.panes.some((p) => g.panes.includes(p));
        if (!shared) continue;
        const fallback = o.modes.includes('NAVCOM') ? 'NAVCOM' : o.modes.find((m) => m !== 'MFD');
        if (fallback) this.vars.set(G3K.gtcMode(o.id), GTC_MODE[fallback.toLowerCase() as 'pfd' | 'mfd' | 'navcom']);
      }
    }
    this.vars.set(G3K.gtcMode(g.id), code);
    this.revision++;
  }

  paneRange(p: PaneId): number {
    return this.vars.get(vn(G3K.paneRange, p), DEFAULT_PANE_RANGE);
  }

  /** Steps a range var through the Garmin range set. */
  stepRange(varName: string, dir: number, fallback: number): number {
    const cur = this.vars.get(varName, fallback);
    let i = G3K_MAP_RANGES.findIndex((r) => r >= cur - 1e-6);
    if (i < 0) i = G3K_MAP_RANGES.length - 1;
    i = Math.max(0, Math.min(G3K_MAP_RANGES.length - 1, i + (dir > 0 ? 1 : dir < 0 ? -1 : 0)));
    const r = G3K_MAP_RANGES[i];
    this.vars.set(varName, r);
    return r;
  }

  paneRangeStep(p: PaneId, dir: number): void {
    this.stepRange(vn(G3K.paneRange, p), dir, DEFAULT_PANE_RANGE);
  }

  pfdRangeStep(side: number, dir: number): void {
    this.stepRange(vn(G3K.pfdMapRange, side), dir, DEFAULT_INSET_RANGE);
  }

  // ================================================================ PFD settings

  navSource(side: number): number {
    return this.vars.get(vn(G3K.navSource, side));
  }

  setNavSource(side: number, src: number): void {
    const v = this.vars;
    if (src > this.cfg.radios.nav) src = NAV_SOURCE.fms;
    v.set(vn(G3K.navSource, side), src);
    if (src !== NAV_SOURCE.fms) v.set(vn(G3K.obs, side), 0);
    // Manual source change cancels the FMS->LOC AFCS override (PG §7.3: source switched manually -> ROL).
    this.afcsNavOverride = 0;
    this.revision++;
  }

  /** "Nav Source" / "Active NAV": FMS -> NAV1 -> NAV2 -> FMS (PG §2.1). */
  cycleNavSource(side: number): void {
    const n = this.cfg.radios.nav;
    const cur = this.navSource(side);
    this.setNavSource(side, cur >= n ? NAV_SOURCE.fms : cur + 1);
  }

  /** Bearing pointer source cycle OFF -> NAV1 -> NAV2 -> FMS -> ADF (PG §1.3 PFD Home). */
  cycleBearing(side: number, which: 1 | 2): void {
    const name = which === 1 ? vn(G3K.brg1Source, side) : vn(G3K.brg2Source, side);
    const order: number[] = [BRG_SOURCE.off, BRG_SOURCE.nav1];
    if (this.cfg.radios.nav >= 2) order.push(BRG_SOURCE.nav2);
    order.push(BRG_SOURCE.fms);
    if (this.cfg.radios.adf) order.push(BRG_SOURCE.adf);
    const cur = order.indexOf(this.vars.get(name));
    this.vars.set(name, order[(cur + 1) % order.length]);
    this.revision++;
  }

  cycleVar(name: string, values: readonly number[]): void {
    const cur = values.indexOf(this.vars.get(name));
    this.vars.set(name, values[(cur + 1) % values.length]);
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

  /** OBS on the FMS CDI: flies the selected course to the active waypoint (course-to-fix direct-to). SCOPE: no FROM-side OBS. */
  toggleObs(side: number): void {
    const v = this.vars;
    if (this.navSource(side) !== NAV_SOURCE.fms) return;
    const on = v.get(vn(G3K.obs, side)) < 0.5;
    // Suspended (at the MAP): the OBS key reads SUSP and un-suspends by activating the missed approach leg.
    if (v.get(FMS.suspended) >= 0.5 && !on) {
      this.fpl?.activateMissedApproach();
      return;
    }
    v.set(vn(G3K.obs, side), on ? 1 : 0);
    if (on) {
      const brg = v.get(FMS.dtkMag);
      v.set(vn(G3K.obsCourse, side), Math.round(Number.isFinite(brg) ? brg : 0) || 360);
      this.applyObs(side);
    } else if (this.fms) {
      // Resume sequencing: direct to the same waypoint without a course.
      const i = this.fms.plans.active.activeLegIndex;
      if (i >= 0) this.fms.directTo(i);
    }
    this.revision++;
  }

  private applyObs(side: number): void {
    if (!this.fms) return;
    const i = this.fms.plans.active.activeLegIndex;
    if (i >= 0) this.fms.directTo(i, this.vars.get(vn(G3K.obsCourse, side)));
  }

  setSensor(side: number, kind: 'adc' | 'ahrs', index: number): void {
    const n = kind === 'adc' ? this.cfg.sensors.adc : this.cfg.sensors.ahrs;
    if (index < 1 || index > n) return;
    this.vars.set(kind === 'adc' ? vn(G3K.adcSel, side) : vn(G3K.ahrsSel, side), index);
    this.revision++;
  }

  // ================================================================ knobs (GMC 710, baro, display controller)

  private emitAfcs(button: string, payload?: unknown): void {
    this.events?.emit(`${this.cfg.afcs.eventPrefix}${button}`, payload);
  }

  hdgTurn(clicks: number): void {
    const v = this.vars;
    let h = Math.round(v.get(AP.selHeading)) + clicks;
    h = ((h - 1) % 360 + 360) % 360 + 1;
    v.set(AP.selHeading, h);
    this.hdgChangedS = 0;
  }

  /** HDG knob push: synchronize the bug to the current heading on the coupled side (PG §2.1). */
  hdgPush(): void {
    const side = this.coupledSide();
    const hdg = this.vars.get(ADC.heading(this.vars.get(vn(G3K.ahrsSel, side), side)));
    this.vars.set(AP.selHeading, Math.round(wrap360(hdg)) || 360);
    this.hdgChangedS = 0;
  }

  /** CRS knob: adjusts the selected course of that side's CDI source (VOR/LOC, or FMS in OBS). */
  crsTurn(side: number, clicks: number): void {
    const v = this.vars;
    const src = this.navSource(side);
    const bump = (name: string): void => {
      let c = Math.round(v.get(name)) + clicks;
      c = ((c - 1) % 360 + 360) % 360 + 1;
      v.set(name, c);
    };
    if (src === NAV_SOURCE.fms) {
      if (v.get(vn(G3K.obs, side)) < 0.5) return;
      bump(vn(G3K.obsCourse, side));
      this.applyObs(side);
      v.set(vn(AP.selCourse, side), v.get(vn(G3K.obsCourse, side)));
    } else {
      bump(vn(NAV.obs, src));
      v.set(vn(AP.selCourse, side), v.get(vn(NAV.obs, src)));
    }
    this.crsChangedS[side] = 0;
  }

  /** CRS push: re-centers the CDI (course = bearing to the active waypoint / station, or the localizer course). */
  crsPush(side: number): void {
    const v = this.vars;
    const src = this.navSource(side);
    if (src === NAV_SOURCE.fms) {
      if (v.get(vn(G3K.obs, side)) < 0.5) return;
      const b = v.get(FMS.bearingToWptMag);
      if (Number.isFinite(b)) v.set(vn(G3K.obsCourse, side), Math.round(wrap360(b)) || 360);
      this.applyObs(side);
    } else if (v.get(vn(NAV.isLoc, src)) >= 0.5) {
      const c = v.get(vn(NAV.locCourse, src));
      if (Number.isFinite(c) && c > 0) v.set(vn(NAV.obs, src), Math.round(wrap360(c)) || 360);
    } else if (v.get(vn(NAV.bearingValid, src)) >= 0.5) {
      v.set(vn(NAV.obs, src), Math.round(wrap360(v.get(vn(NAV.bearing, src)))) || 360);
    }
    v.set(vn(AP.selCourse, side), src === NAV_SOURCE.fms ? v.get(vn(G3K.obsCourse, side)) : v.get(vn(NAV.obs, src)));
    this.crsChangedS[side] = 0;
  }

  /**
   * ALT SEL knob: large (outer) 1000 ft, small (inner) 100 ft; 10 ft with an
   * approach active (PG §2.1 "Altimeter"). Turning through the baro minimums
   * stops on it once (the MDA/DH "is also available for the Selected Altitude").
   */
  altTurn(clicks: number, outer: boolean): void {
    const v = this.vars;
    const approach = v.get(FMS.approachActive) >= 0.5;
    const step = outer ? 1000 : approach ? 10 : 100;
    const cur = v.get(AP.selAltitude);
    let next = outer ? Math.round((cur + clicks * step) / step) * step : cur + clicks * step;
    if (!outer && !approach) next = Math.round(next / 100) * 100;
    const mins = this.mins.mode === MINS_MODE.baro || this.mins.mode === MINS_MODE.tempComp ? this.mins.effectiveFt() : NaN;
    if (Number.isFinite(mins) && Math.abs(cur - mins) > 1 && (cur - mins) * (next - mins) < 0) next = Math.round(mins);
    next = Math.max(-1000, Math.min(this.cfg.afcs.maxSelAltFt, next));
    v.set(AP.selAltitude, next);
  }

  /** ALT knob push: synchronize to the current altitude (nearest 10 ft). */
  altPush(): void {
    const side = this.coupledSide();
    const alt = this.vars.get(ADC.baroAlt(this.vars.get(vn(G3K.adcSel, side), side)));
    this.vars.set(AP.selAltitude, Math.round(alt / 10) * 10);
  }

  /** Speed knob (Longitude): selected IAS (1 kt) or Mach (0.01) in MAN; ignored while FMS speed is selected. */
  spdTurn(clicks: number): void {
    const v = this.vars;
    if (v.get(G3K.speedFms) >= 0.5) return;
    if (v.get(AP.speedIsMach) >= 0.5) v.set(AP.selMach, Math.max(0.2, Math.min(0.95, Math.round((v.get(AP.selMach) + clicks * 0.01) * 100) / 100)));
    else v.set(AP.selSpeed, Math.max(80, Math.min(400, Math.round(v.get(AP.selSpeed)) + clicks)));
  }

  /** Speed knob push: FMS <-> MAN speed (Longitude OG 7-4). */
  spdPush(): void {
    this.toggleVar(G3K.speedFms);
  }

  /** XFR key: transfers the coupled flight director; modes revert to default (PG §7.2 "Switching Flight Directors"). */
  xfr(): void {
    const v = this.vars;
    v.set(G3K.fdCoupledSide, this.coupledSide() === 1 ? 2 : 1);
    if (v.get(AP.engaged) >= 0.5 || v.get(vn(AP.fdOn, 1)) >= 0.5 || v.get(vn(AP.fdOn, 2)) >= 0.5) {
      this.emitAfcs('rol');
      this.emitAfcs('pit');
    }
  }

  coupledSide(): number {
    return this.vars.get(G3K.fdCoupledSide) >= 1.5 && this.cfg.pfdCount === 2 ? 2 : 1;
  }

  /**
   * APR key pre-processing (GMC 710): with FMS selected on the coupled side and a
   * localizer approach loaded, the AFCS must arm LOC/GS rather than FMS/GP
   * (G5000 CRG "Selecting Glideslope Mode": FMS source + ILS loaded + LOC tuned +
   * APPR). The AFCS source is overridden to the on-side receiver; the CDI keeps
   * showing FMS until the automatic switch conditions are met.
   */
  prepareApproach(): void {
    const side = this.coupledSide();
    if (this.navSource(side) !== NAV_SOURCE.fms || !this.fpl) return;
    if (this.vars.get('ap.btn_apr') >= 0.5) return; // pressing APR again cancels: no override needed
    if (!this.fpl.approachIsLoc()) return;
    const rx = Math.min(side, this.cfg.radios.nav);
    if (this.vars.get(vn(NAV.isLoc, rx)) < 0.5) return;
    this.afcsNavOverride = rx;
    this.vars.set('ap.nav_source', rx);
  }

  // ================================================================ baro / minimums

  /** Baro knob: 0.01 inHg or 1 hPa per click; while STD the preselect changes (G5000 "Altimeter Setting Preview"). */
  baroTurn(side: number, clicks: number): void {
    const v = this.vars;
    const hpa = v.get(vn(G3K.baroHpa, side)) >= 0.5;
    const step = hpa ? 1 / 33.8639 : 0.01;
    const sides = v.get(G3K.baroSync) >= 0.5 ? [1, 2] : [side];
    const adc = v.get(vn(G3K.adcSel, side), side);
    const std = v.get(vn(ADC.baroStd, adc)) >= 0.5;
    for (const s of sides) {
      const a = v.get(vn(G3K.adcSel, s), s);
      if (std) {
        const p = Math.min(32.5, Math.max(26, v.get(vn(G3K.baroPreselect, s), 29.92) + clicks * step));
        v.set(vn(G3K.baroPreselect, s), hpa ? Math.round(p * 33.8639) / 33.8639 : Math.round(p * 100) / 100);
      } else {
        const b = Math.min(32.5, Math.max(26, v.get(vn(ADC.baroSetting, a), 29.92) + clicks * step));
        v.set(vn(ADC.baroSetting, a), hpa ? Math.round(b * 33.8639) / 33.8639 : Math.round(b * 100) / 100);
      }
    }
  }

  /** Baro knob push: STD <-> preselect / previous setting (PG §2.1 "Selecting standard barometric pressure"). */
  baroPush(side: number): void {
    const v = this.vars;
    const sides = v.get(G3K.baroSync) >= 0.5 ? [1, 2] : [side];
    const adc0 = v.get(vn(G3K.adcSel, side), side);
    const toStd = v.get(vn(ADC.baroStd, adc0)) < 0.5;
    for (const s of sides) {
      const a = v.get(vn(G3K.adcSel, s), s);
      if (toStd) {
        v.set(vn(G3K.baroPreselect, s), v.get(vn(ADC.baroSetting, a), 29.92));
        v.set(vn(ADC.baroStd, a), 1);
      } else {
        v.set(vn(ADC.baroSetting, a), v.get(vn(G3K.baroPreselect, s), 29.92));
        v.set(vn(ADC.baroStd, a), 0);
      }
    }
    // Keep both ADCs consistent when a side uses the cross-side ADC.
    for (let a = 1; a <= this.cfg.sensors.adc; a++) if (sides.length === 2) v.set(vn(ADC.baroStd, a), toStd ? 1 : 0);
  }

  minsTurn(clicks: number): void {
    if (this.mins.mode === MINS_MODE.off) this.mins.set(MINS_MODE.baro);
    this.mins.set(this.mins.mode, this.mins.valueFt + clicks * 10);
  }

  /** Minimums knob push cycles OFF -> BARO -> RA (with a radio altimeter) -> OFF. */
  minsPush(): void {
    const m = this.mins.mode;
    const next = m === MINS_MODE.off ? MINS_MODE.baro : m === MINS_MODE.baro && this.cfg.sensors.radioAltimeter ? MINS_MODE.radio : MINS_MODE.off;
    this.mins.set(next);
  }

  // ================================================================ radios

  comActive(r: number): number {
    return this.vars.get(vn(NAV.comActive, r));
  }
  comStandby(r: number): number {
    return this.vars.get(vn(NAV.comStandby, r));
  }
  swapCom(r: number): void {
    const v = this.vars;
    const a = v.get(vn(NAV.comActive, r));
    v.set(vn(NAV.comActive, r), v.get(vn(NAV.comStandby, r)));
    v.set(vn(NAV.comStandby, r), a);
  }
  stepComStandby(r: number, clicks: number, knob: 'outer' | 'inner'): void {
    this.vars.set(vn(NAV.comStandby, r), stepCom(this.comStandby(r), clicks, knob, this.vars.get(G3K.comSpacing833) >= 0.5));
  }
  setComStandby(r: number, mhz: number): void {
    if (Number.isFinite(mhz)) this.vars.set(vn(NAV.comStandby, r), mhz);
  }
  /** Emergency: 121.5 MHz into the active COM (press and hold the COM transfer, PG §4.2). */
  com121(r: number): void {
    this.vars.set(vn(NAV.comStandby, r), this.comActive(r));
    this.vars.set(vn(NAV.comActive, r), 121.5);
  }
  swapNav(r: number): void {
    const v = this.vars;
    const a = v.get(vn(NAV.activeFreq, r));
    v.set(vn(NAV.activeFreq, r), v.get(vn(NAV.standbyFreq, r)));
    v.set(vn(NAV.standbyFreq, r), a);
  }
  stepNavStandby(r: number, clicks: number, knob: 'outer' | 'inner'): void {
    this.vars.set(vn(NAV.standbyFreq, r), stepNav(this.vars.get(vn(NAV.standbyFreq, r)), clicks, knob));
  }
  setNavStandby(r: number, mhz: number): void {
    if (Number.isFinite(mhz)) this.vars.set(vn(NAV.standbyFreq, r), mhz);
  }
  swapAdf(): void {
    const v = this.vars;
    const a = v.get(vn(NAV.adfActive, 1));
    v.set(vn(NAV.adfActive, 1), v.get(vn(NAV.adfStandby, 1)));
    v.set(vn(NAV.adfStandby, 1), a);
  }
  stepAdfStandby(clicks: number, knob: 'outer' | 'inner'): void {
    this.vars.set(vn(NAV.adfStandby, 1), stepAdf(this.vars.get(vn(NAV.adfStandby, 1)), clicks, knob));
  }
  setAdfStandby(khz: number): void {
    if (Number.isFinite(khz)) this.vars.set(vn(NAV.adfStandby, 1), khz);
  }
  setSquawk(code: number): void {
    if (Number.isFinite(code)) this.vars.set(NAV.xpdrCode, code);
  }
  /** Transponder modes (xpdr.mode codes, radios.ts XPDR_MODE_LABELS). */
  setXpdrMode(mode: number): void {
    this.vars.set(NAV.xpdrMode, mode);
  }
  ident(): void {
    if (this.vars.get(NAV.xpdrMode) < 2) return; // no reply in STBY
    this.vars.set(G3K.xpdrIdentS, IDENT_S);
    this.vars.set(NAV.xpdrIdent, 1);
  }
  setMic(side: number, r: number): void {
    this.vars.set(vn(G3K.micSelect, side), r);
    // Selecting a COM for transmit also selects it for receive (GMA 36 behaviour).
    this.vars.set(G3K.comMonitor(side, r), 0);
  }

  // ================================================================ approach auto-tune / CDI switching

  private approachLoaded(proc: Procedure): void {
    const v = this.vars;
    this.mins.reset(); // minimums reset when another approach is activated/loaded (PG §2.4)
    if (proc.navFrequencyMhz && LOC_APPROACH_TYPES.has(proc.approachType ?? '')) {
      const magVar = v.get(GPS.magVar, this.fms?.plans.active.destination?.magVar ?? 0);
      const course = proc.navCourseTrue !== undefined ? Math.round(wrap360(proc.navCourseTrue - magVar)) || 360 : NaN;
      for (let r = 1; r <= this.cfg.radios.nav; r++) {
        if (Math.abs(v.get(vn(NAV.activeFreq, r)) - proc.navFrequencyMhz) > 0.001) {
          v.set(vn(NAV.standbyFreq, r), v.get(vn(NAV.activeFreq, r)));
          v.set(vn(NAV.activeFreq, r), proc.navFrequencyMhz);
        }
        if (Number.isFinite(course)) v.set(vn(NAV.obs, r), course);
      }
    }
    const dest = this.fms?.plans.active.destination;
    if (dest) this.mins.destElevFt = dest.elevationFt;
    this.revision++;
  }

  private updateNavSourceLogic(dt: number): void {
    const v = this.vars;
    const plan = this.fms?.plans.active;
    // Detect approach changes made outside the editor (route strings, other code).
    if (plan && plan.version !== this.lastPlanVersion) {
      this.lastPlanVersion = plan.version;
      if (plan.approachProcedure && plan.approachProcedure !== this.lastAppr) this.approachLoaded(plan.approachProcedure);
      this.lastAppr = plan.approachProcedure;
      if (plan.destination) this.mins.destElevFt = plan.destination.elevationFt;
    }
    const locApproach = !!this.fpl?.approachIsLoc();
    const latActive = v.getString(AP.lateralActive);
    const latArmed = v.getString(AP.lateralArmed);
    const locEngaged = latActive.startsWith('LOC') || latActive.startsWith('BC');
    const locArmed = latArmed.startsWith('LOC');
    for (const s of SIDES) {
      if (s === 2 && this.cfg.pfdCount < 2) break;
      const rx = Math.min(s, this.cfg.radios.nav);
      // Auto-switch FMS -> LOC (PG §2.1 conditions): LOC approach loaded, FAF active < 15 nm,
      // LOC tuned and received, GPS CDI within 1.2 x full scale, and LOC armed/captured.
      if (this.navSource(s) === NAV_SOURCE.fms && locApproach && plan) {
        const fafActive = plan.activeLegIndex >= 0 && plan.activeLegIndex === plan.fafIndex;
        const near = v.get(FMS.distToWptNm) < 15;
        const loc = v.get(vn(NAV.isLoc, rx)) >= 0.5 && v.get(vn(NAV.received, rx)) >= 0.5;
        const cdiOk = Math.abs(v.get(FMS.cdi)) < 1.2;
        if (loc && ((fafActive && near && cdiOk && (locArmed || locEngaged)) || locEngaged)) {
          v.set(vn(G3K.navSource, s), rx);
          v.set(vn(G3K.obs, s), 0);
          this.revision++;
        }
      }
      // With a localizer received on the selected source, the course follows the localizer course once.
      const src = this.navSource(s);
      if (src !== NAV_SOURCE.fms && v.get(vn(NAV.isLoc, src)) >= 0.5 && v.get(vn(NAV.received, src)) >= 0.5) {
        const ident = v.getString(vn(NAV.ident, src));
        if (this.locCourseSetFor[s] !== ident) {
          const c = v.get(vn(NAV.locCourse, src));
          if (Number.isFinite(c) && c > 0) v.set(vn(NAV.obs, src), Math.round(wrap360(c)) || 360);
          this.locCourseSetFor[s] = ident;
        }
      } else if (src !== NAV_SOURCE.fms) this.locCourseSetFor[s] = '';
    }
    // AFCS source: the coupled side's CDI source, or the override while an ILS approach is armed from FMS.
    const side = this.coupledSide();
    if (this.afcsNavOverride) {
      const stillApproach = v.get('ap.btn_apr') >= 0.5 || locArmed || locEngaged;
      if (!stillApproach || !locApproach || this.navSource(side) !== NAV_SOURCE.fms) this.afcsNavOverride = 0;
    }
    v.set('ap.nav_source', this.afcsNavOverride || this.navSource(side));
    // Selected course mirror per side (AP.selCourse).
    for (const s of SIDES) {
      const src = this.navSource(s);
      if (src !== NAV_SOURCE.fms) v.set(vn(AP.selCourse, s), v.get(vn(NAV.obs, src)));
    }
    // OBS is cancelled when the source leaves FMS or there is no active leg.
    this.hdgChangedS += dt;
    this.crsChangedS[1] += dt;
    this.crsChangedS[2] += dt;
  }

  // ================================================================ update

  update(dt: number): void {
    const v = this.vars;
    this.time += dt;
    v.set(G3K.alive, 1);
    this.updateUnits(dt);
    this.updateReversion();
    this.updateNavSourceLogic(dt);
    this.timer.update(dt);
    // Transponder IDENT (DO-181E: 18 s).
    const idS = v.get(G3K.xpdrIdentS);
    if (idS > 0) {
      const left = Math.max(0, idS - dt);
      v.set(G3K.xpdrIdentS, left);
      if (left <= 0) v.set(NAV.xpdrIdent, 0);
    }
    // Flight timer and trip data (airborne only).
    const airborne = v.get('gear.air_ground', 1) < 0.5;
    if (airborne) {
      v.set(G3K.flightTimeS, v.get(G3K.flightTimeS) + dt);
      if (v.get(GPS.valid) >= 0.5) v.set(G3K.tripOdoNm, v.get(G3K.tripOdoNm) + (v.get(GPS.gs) * dt) / 3600);
    }
    // FMS speed on the Longitude speed knob: the selected speed follows the FMS target (magenta).
    if (this.cfg.afcs.speedKnob && v.get(G3K.speedFms) >= 0.5) {
      const kt = v.get(FMS.vnavTargetSpeedKt);
      const m = v.get(FMS.vnavTargetMach);
      if (m > 0) {
        v.set(AP.speedIsMach, 1);
        v.set(AP.selMach, m);
      } else if (kt > 0) {
        v.set(AP.speedIsMach, 0);
        v.set(AP.selSpeed, kt);
      }
    }
    // Minimums republish (temperature compensation depends on the destination).
    this.mins.publish();
    this.wf.publish();
    // Comparators and messages at 2 Hz.
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) {
      this.msgTimer = 0.5;
      this.updateComparators();
      this.updateMessages();
    }
  }

  private updateComparators(): void {
    const v = this.vars;
    let mask = 0;
    if (this.cfg.sensors.adc >= 2 && v.get(vn(ADC.valid, 1)) >= 0.5 && v.get(vn(ADC.valid, 2)) >= 0.5) {
      if (Math.abs(v.get(vn(ADC.baroAlt, 1)) - v.get(vn(ADC.baroAlt, 2))) > CMP.alt) mask |= 1;
      if (Math.abs(v.get(vn(ADC.ias, 1)) - v.get(vn(ADC.ias, 2))) > CMP.ias && Math.max(v.get(vn(ADC.ias, 1)), v.get(vn(ADC.ias, 2))) > 35) mask |= 2;
    }
    if (this.cfg.sensors.ahrs >= 2 && v.get(vn(ADC.ahrsValid, 1)) >= 0.5 && v.get(vn(ADC.ahrsValid, 2)) >= 0.5) {
      const dh = Math.abs(((v.get(vn(ADC.heading, 1)) - v.get(vn(ADC.heading, 2)) + 540) % 360) - 180);
      if (dh > CMP.hdg) mask |= 4;
      if (Math.abs(v.get(vn(ADC.pitch, 1)) - v.get(vn(ADC.pitch, 2))) > CMP.pit) mask |= 8;
      if (Math.abs(v.get(vn(ADC.bank, 1)) - v.get(vn(ADC.bank, 2))) > CMP.rol) mask |= 16;
    }
    v.set(G3K.miscompare, mask);
  }

  private updateMessages(): void {
    const v = this.vars;
    const m = this.messages;
    const gpsPowered = v.get(GPS.powered, 1) >= 0.5;
    m.set('gps', 'GPS NAV LOST - Loss of GPS navigation. Insufficient satellites.', gpsPowered && v.get(GPS.valid) < 0.5 && v.get(GPS.acquireS) <= 0);
    m.set('gpsacq', 'GPS ACQUIRING - Acquiring satellites.', gpsPowered && v.get(GPS.valid) < 0.5 && v.get(GPS.acquireS) > 0);
    const tod = v.get(FMS.todEteS);
    m.set('tod', 'TOD within 1 minute', v.get(FMS.vnavValid) >= 0.5 && tod > 0 && tod <= 60);
    m.set('taws', 'TAWS UNAVAILABLE - TAWS is not available.', v.get('taws.inop') >= 0.5);
    if (this.cfg.pfdCount === 2) {
      const b1 = v.get(ADC.baroSetting(v.get(vn(G3K.adcSel, 1), 1)));
      const b2 = v.get(ADC.baroSetting(v.get(vn(G3K.adcSel, 2), 2)));
      const std = v.get(vn(ADC.baroStd, 1)) >= 0.5 && v.get(vn(ADC.baroStd, 2)) >= 0.5;
      m.set('baro', 'BARO DISAGREE - Barometric settings on the PFDs differ.', !std && Math.abs(b1 - b2) > 0.02);
    }
    const mis = v.get(G3K.miscompare);
    m.set('cmp', 'SENSOR MISCOMPARE - Check the comparator window on the PFD.', mis > 0);
    m.set('xpdrstby', 'XPDR IN STANDBY - Transponder is in standby.', v.get('gear.air_ground', 1) < 0.5 && v.get(NAV.xpdrMode) === 1);
    v.set(G3K.msgUnread, m.unread > 0 ? 1 : 0);
    v.set(G3K.msgCount, m.list.length);
  }

  // ================================================================ state presets

  /**
   * Avionics part of an aircraft state preset: cold & dark clears the suite
   * (splash shown at power-up), every other state skips the boot and splash,
   * sets sensible references and aligns the course with the ILS.
   */
  applyState(state: 'cold_dark' | 'ready_to_taxi' | 'takeoff' | 'cruise' | 'approach'): void {
    const v = this.vars;
    if (state === 'cold_dark') {
      v.set(G3K.mfdSplashAck, 0);
      this.mins.reset();
      this.timer.reset();
      v.set(G3K.flightTimeS, 0);
      return;
    }
    this.forceBooted();
    for (const s of [1, 2]) v.set(vn(G3K.navSource, s), NAV_SOURCE.fms);
    if (state === 'takeoff' || state === 'ready_to_taxi') {
      v.set(G3K.flightTimeS, 0);
      this.vspeeds.setGroup('takeoff', true);
    }
    if (state === 'approach') {
      this.vspeeds.setGroup('landing', true);
      // The app tunes NAV1 to the ILS; show it on the CDI when it is a localizer.
      for (const s of [1, 2]) {
        const rx = Math.min(s, this.cfg.radios.nav);
        if (v.get(vn(NAV.activeFreq, 1)) > 0 && this.cfg.radios.nav >= rx) {
          if (rx === 2) v.set(vn(NAV.activeFreq, 2), v.get(vn(NAV.activeFreq, 1)));
          if (rx === 2) v.set(vn(NAV.obs, 2), v.get(vn(NAV.obs, 1)));
          v.set(vn(G3K.navSource, s), rx);
        }
      }
    }
    v.set(NAV.xpdrMode, this.cfg.traffic === 'TCAS2' ? 5 : 3);
    this.revision++;
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
