/**
 * `createFusionSuite(host, config)`: instantiates the Collins Pro Line
 * Fusion avionics of the Bombardier Global Vision Flight Deck (Global 5000 /
 * 6000) for an aircraft module.
 *
 *   const fms = new Fms(ctx, { style: 'boeing', engineCount: 2 });   // MOD / EXEC (Collins FMS)
 *   const fusion = createFusionSuite({ ...ctx, fms }, {
 *     airframe: GLOBAL6000_AIRFRAME, engines: BR710A2_20_ENGINES,
 *     power: { afd: ['elec.dc_ess_powered', ...], ... }, checklists,
 *   });
 *   systems.push(fms, fusion.system);             // after the electrical system
 *   casManager.addSink(fusion.cas.model);
 *   // map fusion.afd[0..3], fusion.ctp[0..1], fusion.iesi onto cockpit meshes
 *   // (cockpit.ts helpers build the FCP, CTPs, CCPs, MKPs, RSPs around them).
 *   fusion.applyState(state);                     // from AircraftInstance.applyState
 *
 * Every systems step (`fusion.system.update`): power bindings ->
 * DISPLAY_VARS, RSP source selection, layout reversion (on change only),
 * CCP cursors, FCP (FMS speed, nav source sync, EDM), FMS host and windows,
 * checklist sensing, engine exceedance output, transponder IDENT timer (18 s,
 * FAA AIM 4-1-20 "IDENT ... about 18 seconds"), chronometers and, at 1 Hz,
 * the SVS runway list (origin / destination).
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import { ADC, GPS, NAV } from '../../core/vars';
import type { NavDatabase } from '../../nav/types';
import type { WorldQuery } from '../../world/types';
import type { Fms } from '../../nav/fms/Fms';
import type { CockpitDisplay } from '../../cockpit/types';
import { DISPLAY_VARS } from '../../cockpit/types';
import type { InitialState, Subsystem } from '../../aircraft/types';
import type { DisplayCanvas } from '../common/CanvasDisplay';
import { compileBinding, type Binding, type Evaluator } from '../../systems/util/binding';
import { resolveConfig, type FusionResolvedConfig, type FusionSuiteConfig } from './config';
import { FUSION_EVENTS, FUSION_VARS, NavSrc, SysPage, Win, type Slot } from './vars';
import { LayoutManager } from './logic/layout';
import { CursorLogic } from './logic/cursor';
import { FcpLogic, type ApproachInfo } from './logic/fcp';
import { CtpLogic } from './logic/ctp';
import { SourceSelector } from './logic/sources';
import { FusionCas } from './logic/cas';
import { ChecklistLogic } from './logic/checklist';
import { SynopticReadouts } from './logic/readouts';
import { MkpLogic } from './logic/mkp';
import { FmsHost } from './fms/host';
import { FmsWindowModel } from './fms/window';
import { PfdRenderer } from './displays/pfd';
import { EicasWindow } from './displays/eicas';
import { MapWindow } from './displays/map';
import { FmsTextWindow } from './displays/fmsText';
import { SynopticsWindow } from './displays/synoptics';
import { ChecklistWindow } from './displays/checklistWin';
import { VsdWindow } from './displays/vsd';
import { ChartWindow, EvsWindow } from './displays/chartEvs';
import { AdaptiveFlightDisplay, BlankWindow, PfdWindow, type FusionWindowSet } from './displays/afd';
import { CtpDisplay } from './displays/ctpDisplay';
import { IesiDisplay } from './displays/iesi';
import type { FusionServices } from './displays/window';

/** What the suite needs from the aircraft (a SimContext satisfies it; add the aircraft's FMS). */
export interface FusionSuiteHost {
  vars: SimVars;
  events: EventBus;
  nav?: NavDatabase | null;
  world?: WorldQuery | null;
  /** Aircraft FMS (nav/fms Fms), 'boeing' edit style (MOD + EXEC, as the Collins FMS). */
  fms?: Fms | null;
  /** Canvas kind for the displays, or a factory returning a canvas per display (tests / headless). */
  canvas?: 'dom' | 'offscreen' | (() => DisplayCanvas);
}

const IDENT_S = 18;
const LOC_TYPES = new Set(['ILS', 'LOC', 'LOC_BC', 'LDA', 'SDF', 'IGS']);

interface SvsRunway {
  lat: number;
  lon: number;
  headingTrue: number;
  lengthFt: number;
  widthFt: number;
  elevFt: number;
}

export class FusionSuite {
  readonly cfg: FusionResolvedConfig;
  readonly vars: SimVars;
  readonly events: EventBus;
  readonly layout: LayoutManager;
  readonly cursor: CursorLogic;
  readonly fcp: FcpLogic;
  readonly ctpLogic: CtpLogic;
  readonly sources: SourceSelector;
  readonly cas: FusionCas;
  readonly checklist: ChecklistLogic;
  readonly readouts: SynopticReadouts;
  readonly fmsHost: FmsHost;
  readonly fmsWin: [FmsWindowModel, FmsWindowModel];
  readonly mkp: MkpLogic;
  readonly pfd: [PfdRenderer, PfdRenderer];
  readonly windows: FusionWindowSet;
  readonly eicas: EicasWindow;
  readonly synoptics: SynopticsWindow;
  readonly checklistWin: ChecklistWindow;
  readonly services: FusionServices;
  /** AFD 1-4 (pilot PFD, upper centre, lower centre, copilot PFD). */
  readonly afd: AdaptiveFlightDisplay[] = [];
  /** CTP displays [pilot, copilot]. */
  readonly ctp: CtpDisplay[] = [];
  readonly iesi: IesiDisplay;
  /** Subsystem to add to `AircraftInstance.systems` (after the electrical system). */
  readonly system: Subsystem;
  private readonly fms: Fms | null;
  private readonly power: { id: string; eval: Evaluator }[] = [];
  private readonly afdPower: Evaluator[] = [];
  private readonly afdFail: string[];
  private readonly sidePower: { ctp: Evaluator[]; ccp: Evaluator[]; mkp: Evaluator[]; fcp: Evaluator };
  private readonly offs: (() => void)[] = [];
  private readonly svsRunways: SvsRunway[] = [];
  private identT = 0;
  private slow = 0;

  constructor(host: FusionSuiteHost, config: FusionSuiteConfig) {
    const cfg = resolveConfig(config);
    this.cfg = cfg;
    const vars = host.vars;
    const events = host.events;
    this.vars = vars;
    this.events = events;
    this.fms = host.fms ?? null;
    const p = cfg.idPrefix;
    const hc = host.canvas;
    const canvasOf = (): 'dom' | 'offscreen' | DisplayCanvas | undefined => (typeof hc === 'function' ? hc() : hc);
    const pr = cfg.pixelRatio;
    const pw = cfg.power;
    const ev1 = (b: Binding | undefined): Evaluator => compileBinding(vars, b, 1);

    // ---------------------------------------------------------- power / logic
    for (let n = 0; n < 4; n++) this.afdPower.push(ev1(pw.afd?.[n]));
    this.afdFail = [1, 2, 3, 4].map((n) => FUSION_VARS.afdFail(n));
    this.sidePower = {
      ctp: [ev1(pw.ctp?.[0]), ev1(pw.ctp?.[1])],
      ccp: [ev1(pw.ccp?.[0]), ev1(pw.ccp?.[1])],
      mkp: [ev1(pw.mkp?.[0]), ev1(pw.mkp?.[1])],
      fcp: ev1(pw.fcp),
    };
    this.sources = new SourceSelector(vars, cfg.sensors);
    this.layout = new LayoutManager(vars, (n) => this.afdOperating(n));
    this.readouts = new SynopticReadouts(vars, cfg.synopticBindings);
    this.cas = new FusionCas(vars, events);
    this.checklist = new ChecklistLogic(vars, cfg.checklists);
    this.cursor = new CursorLogic(vars, events, { powered: (s) => this.sidePower.ccp[s - 1]() >= 0.5 });
    this.fcp = new FcpLogic(vars, events, {
      sensors: cfg.sensors,
      events: cfg.events,
      airframe: cfg.airframe,
      powered: () => this.sidePower.fcp() >= 0.5,
      approachInfo: () => this.approachInfo(),
    });
    this.ctpLogic = new CtpLogic(vars, events, { sensors: cfg.sensors, powered: (s) => this.sidePower.ctp[s - 1]() >= 0.5 });
    this.fmsHost = new FmsHost(vars, events, this.fms, host.nav ?? null, cfg);
    this.fmsWin = [
      new FmsWindowModel(1, this.fmsHost, vars, () => this.sidePower.mkp[0]() >= 0.5),
      new FmsWindowModel(2, this.fmsHost, vars, () => this.sidePower.mkp[1]() >= 0.5),
    ];
    this.mkp = new MkpLogic({
      layout: this.layout,
      cas: this.cas,
      checklist: this.checklist,
      fmsWin: this.fmsWin,
      casChecklists: cfg.casChecklists,
      showWindow: (s, w) => this.showWindow(s, w),
      sideShows: (s, w) => this.sideShows(s, w),
      powered: (s) => this.sidePower.mkp[s - 1]() >= 0.5,
    });

    // ---------------------------------------------------------- windows
    const world = host.world ?? null;
    const nav = host.nav ?? null;
    const pfdSvc = { vars, cfg, world, svsRunways: () => this.svsRunways };
    this.pfd = [new PfdRenderer(1, pfdSvc), new PfdRenderer(2, pfdSvc)];
    this.eicas = new EicasWindow(vars, cfg, this.cas);
    this.synoptics = new SynopticsWindow({ vars, cfg, readouts: this.readouts, cas: this.cas });
    this.checklistWin = new ChecklistWindow(this.checklist);
    const mapOpts = { vars, nav, world, fms: this.fms };
    this.windows = {
      pfd: new PfdWindow(this.pfd),
      eicas: this.eicas,
      map: [new MapWindow(mapOpts), new MapWindow(mapOpts)],
      fms: new FmsTextWindow(this.fmsWin),
      sys: this.synoptics,
      chkl: this.checklistWin,
      vsd: [new VsdWindow({ vars, world, fms: this.fms }), new VsdWindow({ vars, world, fms: this.fms })],
      chart: [new ChartWindow({ vars, nav, fms: this.fms }), new ChartWindow({ vars, nav, fms: this.fms })],
      evs: [new EvsWindow({ vars, world }), new EvsWindow({ vars, world })],
      blank: new BlankWindow(),
    };
    this.services = {
      vars,
      events,
      cfg,
      layout: this.layout,
      cas: this.cas,
      checklist: this.checklist,
      readouts: this.readouts,
      fmsHost: this.fmsHost,
      fmsWin: this.fmsWin,
      pfd: this.pfd,
      nav,
      world,
      fms: this.fms,
      showWindow: (s, w) => this.showWindow(s, w),
    };

    // ---------------------------------------------------------- displays
    for (let n = 1; n <= 4; n++) {
      const id = `${p}.afd${n}`;
      this.afd.push(new AdaptiveFlightDisplay({ n: n as 1 | 2 | 3 | 4, id, vars, layout: this.layout, windows: this.windows, cursor: this.cursor, pixelRatio: pr, bootS: cfg.afdBootS, canvas: canvasOf() }));
      this.addPower(id, pw.afd?.[n - 1]);
    }
    this.cursor.router = {
      hitTest: (_s, du, x, y) => this.afd[du - 1]?.hitTest(x, y) ?? '',
      enter: (s, du, x, y, id) => this.afd[du - 1]?.enter(s, x, y, id),
      menu: (s, du, x, y) => this.afd[du - 1]?.menu(s, x, y),
      back: (s, du, x, y) => this.afd[du - 1]?.back(s, x, y),
      data: (s, du, x, y, id, steps, inner) => this.afd[du - 1]?.data(s, x, y, id, steps, inner),
      windowKey: (du, x, y) => this.afd[du - 1]?.windowKey(x, y) ?? '',
      excluded: (du) => this.afd[du - 1]?.eicasRect() ?? null,
      operating: (du) => this.afdOperating(du),
    };
    for (const s of [1, 2] as const) {
      const id = `${p}.ctp${s}`;
      this.ctp.push(new CtpDisplay({ id, side: s, vars, sensors: cfg.sensors, pixelRatio: pr, canvas: canvasOf() }));
      this.addPower(id, pw.ctp?.[s - 1]);
    }
    const iesiId = `${p}.iesi`;
    this.iesi = new IesiDisplay({ id: iesiId, vars, sensors: cfg.sensors, pixelRatio: pr, canvas: canvasOf() });
    this.addPower(iesiId, pw.iesi);

    // ---------------------------------------------------------- events
    for (const s of [1, 2] as const) {
      this.offs.push(
        events.on(FUSION_EVENTS.mkpKey(s), (pl) => this.mkp.key(s, String(pl ?? ''))),
        events.on(FUSION_EVENTS.fpvCage(s), () => vars.set(FUSION_VARS.fpvCaged(s), vars.getBool(FUSION_VARS.fpvCaged(s)) ? 0 : 1)),
        events.on(FUSION_EVENTS.chrono(s), (pl) => {
          if (String(pl ?? 'startstop') === 'reset') {
            vars.set(FUSION_VARS.chronoS(s), 0);
            vars.set(FUSION_VARS.chronoRun(s), 0);
          } else vars.set(FUSION_VARS.chronoRun(s), vars.getBool(FUSION_VARS.chronoRun(s)) ? 0 : 1);
        }),
      );
      if (!vars.has(FUSION_VARS.sysPage(s))) vars.set(FUSION_VARS.sysPage(s), SysPage.Status);
    }
    const sa = cfg.sensors.standbyAdc;
    this.offs.push(
      events.on(FUSION_EVENTS.iesi('baro_inc'), (pl) => this.iesiBaro(Math.max(1, Number(pl ?? 1) || 1))),
      events.on(FUSION_EVENTS.iesi('baro_dec'), (pl) => this.iesiBaro(-Math.max(1, Number(pl ?? 1) || 1))),
      events.on(FUSION_EVENTS.iesi('baro_push'), () => vars.set(ADC.baroStd(sa), vars.getBool(ADC.baroStd(sa)) ? 0 : 1)),
    );
    if (!vars.has(ADC.baroSetting(sa))) vars.set(ADC.baroSetting(sa), 29.92);

    const self = this;
    this.system = {
      name: 'fusion.suite',
      update(dt: number) {
        self.update(dt);
      },
      reset() {
        self.layout.update();
      },
      dispose() {
        self.dispose();
      },
    };
  }

  private addPower(id: string, b: Binding | undefined): void {
    if (b === undefined) return;
    this.power.push({ id: DISPLAY_VARS.power(id), eval: compileBinding(this.vars, b, 1) });
  }

  /** AFD n powered and not failed (booting counts as operating: no reversion flicker at power-up). */
  afdOperating(n: number): boolean {
    return this.afdPower[n - 1]() >= 0.5 && this.vars.get(this.afdFail[n - 1]) < 0.5;
  }

  private iesiBaro(clicks: number): void {
    const v = this.vars;
    const n = ADC.baroSetting(this.cfg.sensors.standbyAdc);
    v.set(n, Math.min(31.0, Math.max(28.1, Math.round((v.get(n, 29.92) + clicks * 0.01) * 100) / 100)));
    v.set(FUSION_VARS.iesiBaro, v.get(n));
  }

  /** LOC-type approach of the active flight plan (APPR nav-to-nav transfer), null when none. */
  approachInfo(): ApproachInfo | null {
    const plan = this.fms?.plans.active;
    const ap = plan?.approachProcedure;
    if (!ap || !ap.navFrequencyMhz || !ap.approachType || !LOC_TYPES.has(ap.approachType)) return null;
    const mv = this.vars.get(GPS.magVar);
    const crs = (((ap.navCourseTrue ?? 0) - mv) % 360 + 360) % 360;
    return { freqMhz: ap.navFrequencyMhz, courseMag: Math.round(crs) || 360, ident: ap.navIdent ?? '' };
  }

  /** Window of `side` showing `win` (AFD number and slot), or null. */
  sideShows(side: 1 | 2, win: Win): { n: number; slot: Slot } | null {
    for (let n = 1; n <= 4; n++) {
      for (const w of this.layout.shown[n - 1].windows) if (w.win === win && w.owner === side) return { n, slot: w.slot };
    }
    return null;
  }

  /**
   * Brings `win` up for `side` when no window of that side shows it: the
   * side's half of the lower centre AFD, else its half of the upper centre
   * AFD, else the inboard half of its PFD display (EST rule).
   */
  showWindow(side: 1 | 2, win: Win): void {
    if (this.sideShows(side, win)) return;
    const half: 'L' | 'R' = side === 1 ? 'L' : 'R';
    const tries: [number, Slot][] = [
      [3, half],
      [2, half === 'L' ? 'R' : 'L'],
      [2, half],
      [side === 1 ? 1 : 4, side === 1 ? 'R' : 'L'],
    ];
    for (const [n, slot] of tries) {
      if (!this.layout.shown[n - 1].operating) continue;
      if (this.layout.selected(n, slot) === Win.Eicas || this.layout.selected(n, slot) === Win.Pfd) continue;
      const sel = this.layout.sel[n - 1];
      if (sel.full && n !== 1 && n !== 4) continue;
      if (this.layout.select(n, slot, win)) return;
    }
  }

  /** Every display of the suite (for the cockpit display manager). */
  get displays(): CockpitDisplay[] {
    return [...this.afd, ...this.ctp, this.iesi];
  }

  update(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < this.power.length; i++) v.set(this.power[i].id, this.power[i].eval() >= 0.5 ? 1 : 0);
    this.sources.update();
    this.layout.tick();
    this.cursor.update(dt);
    this.fcp.update(dt);
    this.fmsHost.update(dt);
    this.fmsWin[0].update(dt);
    this.fmsWin[1].update(dt);
    this.checklist.update(dt);
    this.eicas.step(dt);
    v.set(FUSION_VARS.engExceed, this.eicas.exceedance ? 1 : 0);
    // Transponder IDENT (18 s).
    if (v.get(NAV.xpdrIdent) !== 0) {
      this.identT += dt;
      if (this.identT >= IDENT_S) {
        v.set(NAV.xpdrIdent, 0);
        this.identT = 0;
      }
    } else this.identT = 0;
    for (let s = 0; s < 2; s++) if (v.get(CHRONO_RUN[s]) !== 0) v.set(CHRONO_S[s], v.get(CHRONO_S[s]) + dt);
    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 1;
      this.refreshSvsRunways();
    }
  }

  /** Origin / destination runways for the SVS (1 Hz, reuses the objects). */
  private refreshSvsRunways(): void {
    const out = this.svsRunways;
    let k = 0;
    const plan = this.fms?.plans.active;
    for (const ap of [plan?.origin, plan?.destination]) {
      if (!ap) continue;
      for (const r of ap.runways) {
        if (k >= 16) break;
        let o = out[k];
        if (!o) {
          o = { lat: 0, lon: 0, headingTrue: 0, lengthFt: 0, widthFt: 0, elevFt: 0 };
          out.push(o);
        }
        o.lat = r.lat;
        o.lon = r.lon;
        o.headingTrue = r.headingTrue;
        o.lengthFt = r.lengthFt;
        o.widthFt = r.widthFt;
        o.elevFt = r.elevationFt;
        k++;
      }
    }
    out.length = k;
  }

  /**
   * Initial-state preset. 'cold_dark': AFDs run their power-up test when
   * powered. Other states: no test delay (systems already running).
   */
  applyState(state: InitialState): void {
    const v = this.vars;
    v.set(FUSION_VARS.bootSkip, state === 'cold_dark' ? 0 : 1);
    this.layout.reset();
    for (const s of [1, 2] as const) {
      v.set(FUSION_VARS.sysPage(s), SysPage.Status);
      v.set(FUSION_VARS.chronoS(s), 0);
      v.set(FUSION_VARS.chronoRun(s), 0);
      v.set(FUSION_VARS.navSource(s), NavSrc.Fms);
      v.set(FUSION_VARS.fpvCaged(s), 0);
      v.set(FUSION_VARS.rspAdc(s), 0);
      v.set(FUSION_VARS.rspAtt(s), 0);
      v.set(FUSION_VARS.rspDspl(s), 0);
      this.fmsWin[s - 1].show('IDX');
      this.checklistWin.showIndex(s, false);
      this.mkp.pending[s - 1] = '';
    }
    v.set(FUSION_VARS.coupleSide, 1);
    v.set(FUSION_VARS.edm, 0);
    this.checklist.resetAll();
    this.checklist.select(this.checklist.lists.length ? 0 : -1);
    this.sources.update();
    this.layout.update();
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
    this.cursor.dispose();
    this.fcp.dispose();
    this.ctpLogic.dispose();
    this.cas.dispose();
    for (const d of this.displays) d.dispose?.();
  }
}

const CHRONO_RUN = [FUSION_VARS.chronoRun(1), FUSION_VARS.chronoRun(2)];
const CHRONO_S = [FUSION_VARS.chronoS(1), FUSION_VARS.chronoS(2)];

/** Builds the suite (see the file header for the integration steps). */
export function createFusionSuite(host: FusionSuiteHost, config: FusionSuiteConfig): FusionSuite {
  return new FusionSuite(host, config);
}
