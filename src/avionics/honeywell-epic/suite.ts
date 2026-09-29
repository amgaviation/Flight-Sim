/**
 * `createEpicSuite(host, config)`: instantiates the Honeywell Primus Epic
 * flight deck for a Gulfstream aircraft module.
 *
 *   const fms = new Fms(ctx, { style: 'boeing', engineCount: 2 });   // MOD / ACTIVATE semantics
 *   const epic = createEpicSuite({ ...ctx, fms }, {
 *     variant: 'planeview2', airframe: G650_AIRFRAME, engines: BR725_ENGINES,
 *     power: { du: ['elec.l_ess_dc_powered', ...] }, checklists,
 *   });
 *   systems.push(fms, epic.system);              // after the electrical system
 *   casManager.addSink(epic.cas.model);
 *   // map epic.du[i], epic.standby[i], epic.mcduDisplays[i] / epic.tsc[i],
 *   // epic.ohpts[i], epic.gpWindows[i] onto cockpit meshes
 *   // (cockpit.ts helpers build the hardware around them).
 *   epic.applyState(state);                      // from AircraftInstance.applyState
 *
 * What the suite runs every systems step (`epic.system.update`):
 * display power bindings -> DISPLAY_VARS, window manager reversion, CCD
 * cursors, guidance panel, display controllers, CAS scroll state,
 * checklist autosensing, MCDU pages, secondary-engine exceedance monitor
 * (full-MAP reversion), destination direct distance (approach preview),
 * transponder IDENT timer (18 s, EST from the FAA AIM "IDENT ... about 18
 * seconds") and the chronometers.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import { GPS, NAV } from '../../core/vars';
import { distanceNm } from '../../core/geo';
import type { NavDatabase } from '../../nav/types';
import type { WorldQuery } from '../../world/types';
import type { Fms } from '../../nav/fms/Fms';
import type { CockpitDisplay } from '../../cockpit/types';
import type { DisplayCanvas } from '../common/CanvasDisplay';
import { DISPLAY_VARS } from '../../cockpit/types';
import type { InitialState, Subsystem } from '../../aircraft/types';
import { compileBinding, type Binding, type Evaluator } from '../../systems/util/binding';
import { ExceedanceMonitor } from '../common/alerting';
import { resolveConfig, type EpicResolvedConfig, type EpicSuiteConfig } from './config';
import { EPIC_EVENTS, EPIC_VARS } from './vars';
import { WindowManager } from './logic/windows';
import { CursorControl } from './logic/cursor';
import { GuidancePanelLogic } from './logic/guidance';
import { DisplayControllerLogic } from './logic/controller';
import { GulfstreamCas } from './logic/cas';
import { ChecklistLogic } from './logic/checklist';
import { SystemReadouts } from './logic/bindings';
import { TouchScreenLogic } from './logic/touch';
import { buildOverheadPages, initOverheadVars, overheadPanels, type OverheadPanelDef } from './logic/overhead';
import { EPIC_CDU_PAGES, EPIC_KEY_PAGES, FmsShared, Mcdu } from './fms';
import type { EpicServices } from './displays/window';
import { DU_H, DU_W, EpicDisplayUnit } from './displays/du';
import { McduDisplay } from './displays/mcduDisplay';
import { SfdDisplay, SmcDisplay } from './displays/standby';
import { GP_WINDOW_KINDS, GpWindowDisplay } from './displays/gpDisplay';
import { TouchDisplay } from './displays/touchDisplay';
import { buildTscPages, TSC_H, TSC_PORTRAIT_H, TSC_PORTRAIT_W, TSC_TITLE_H, TSC_W } from './touch/tscPages';
import { resolveEngineNames } from './displays/engineWindows';

/** What the suite needs from the aircraft (a SimContext satisfies it; add the aircraft's FMS). */
export interface EpicSuiteHost {
  vars: SimVars;
  events: EventBus;
  nav?: NavDatabase | null;
  world?: WorldQuery | null;
  /** Aircraft FMS (nav/fms Fms). 'boeing' edit style gives the Honeywell MOD / ACTIVATE behaviour. */
  fms?: Fms | null;
  /**
   * Canvas kind for the displays (default: DOM canvas when a document
   * exists), or a factory returning a canvas per display (tests / headless).
   */
  canvas?: 'dom' | 'offscreen' | (() => DisplayCanvas);
}

/** Symmetry TSC positions (index 0..3). SCOPE: the fifth (jump-seat side) TSC is not modelled. */
export const TSC_POSITIONS = ['outboard-left', 'pedestal-left', 'pedestal-right', 'outboard-right'] as const;
/** Symmetry overhead touch screens and the panel each shows first (EST). */
export const OHPTS_DEFAULT_PAGES = ['ELEC', 'FUEL', 'ECS'] as const;
const IDENT_S = 18;

export class EpicSuite {
  readonly cfg: EpicResolvedConfig;
  readonly vars: SimVars;
  readonly events: EventBus;
  readonly windows: WindowManager;
  readonly cursor: CursorControl;
  readonly gp: GuidancePanelLogic;
  readonly dc: DisplayControllerLogic;
  readonly cas: GulfstreamCas;
  readonly checklist: ChecklistLogic;
  readonly readouts: SystemReadouts;
  readonly fmsShared: FmsShared;
  /** PlaneView II: the three pedestal MCDUs. Symmetry: the FMS app of each TSC. */
  readonly mcdus: Mcdu[] = [];
  readonly du: EpicDisplayUnit[] = [];
  /** PlaneView II SMCs or Symmetry SFDs, [pilot, copilot]. */
  readonly standby: (SmcDisplay | SfdDisplay)[] = [];
  /** PlaneView II MCDU screens. */
  readonly mcduDisplays: McduDisplay[] = [];
  /** Symmetry TSCs (TSC_POSITIONS order) and overhead touch screens. */
  readonly tsc: TouchDisplay[] = [];
  readonly ohpts: TouchDisplay[] = [];
  readonly tscLogic: TouchScreenLogic[] = [];
  readonly ohptsLogic: TouchScreenLogic[] = [];
  readonly overheadPanels: OverheadPanelDef[];
  /** Guidance panel windows (speed, heading, vs/fpa, altitude). */
  readonly gpWindows: GpWindowDisplay[] = [];
  /** The subsystem to add to `AircraftInstance.systems` (after the electrical system). */
  readonly system: Subsystem;
  private readonly power: { id: string; eval: Evaluator }[] = [];
  private readonly offs: (() => void)[] = [];
  private readonly fms: Fms | null;
  private readonly eng: { oilP: ExceedanceMonitor[]; oilT: ExceedanceMonitor[]; vib: ExceedanceMonitor[] };
  private readonly engNames: ReturnType<typeof resolveEngineNames>;
  private readonly msgLt: string[] = [];
  private identT = 0;
  private slow = 0;

  constructor(host: EpicSuiteHost, config: EpicSuiteConfig) {
    const cfg = resolveConfig(config);
    this.cfg = cfg;
    const vars = host.vars;
    const events = host.events;
    this.vars = vars;
    this.events = events;
    this.fms = host.fms ?? null;
    const p = cfg.idPrefix;
    const sym = cfg.variant === 'symmetry';
    const hc = host.canvas;
    const canvasOf = (): 'dom' | 'offscreen' | DisplayCanvas | undefined => (typeof hc === 'function' ? hc() : hc);
    const pr = cfg.pixelRatio ?? 1;
    const pw = cfg.power ?? {};

    // ---------------------------------------------------------- logic
    const duIds = [1, 2, 3, 4].map((n) => `${p}.du${n}`);
    this.windows = new WindowManager(vars, { duIds, engineExceedVar: EPIC_VARS.engExceed2 });
    this.readouts = new SystemReadouts(vars, cfg.synopticBindings);
    this.cas = new GulfstreamCas(vars, events);
    this.checklist = new ChecklistLogic(vars, cfg.checklists ?? []);
    const ccdEval = [compileBinding(vars, pw.ccd?.[0], 1), compileBinding(vars, pw.ccd?.[1], 1)];
    this.cursor = new CursorControl(vars, events, { duWidth: DU_W, duHeight: DU_H, powered: (s) => ccdEval[s - 1]() >= 0.5 });
    const gpEval = compileBinding(vars, pw.gp, 1);
    this.gp = new GuidancePanelLogic(vars, events, { sensors: cfg.sensors, events: cfg.events, powered: () => gpEval() >= 0.5, approachInfo: () => this.approachInfo() });
    const stbyIds = [1, 2].map((s) => `${p}.${sym ? 'sfd' : 'smc'}${s}`);
    const stbyEval = [compileBinding(vars, pw.standby?.[0], 1), compileBinding(vars, pw.standby?.[1], 1)];
    this.dc = new DisplayControllerLogic(vars, events, {
      sensors: cfg.sensors,
      events: cfg.events,
      windows: this.windows,
      checklistCount: () => this.checklist.lists.length,
      powered: (s) => (sym ? true : stbyEval[s - 1]() >= 0.5),
    });
    this.fmsShared = new FmsShared(vars, events, this.fms, host.nav ?? null, cfg);
    this.overheadPanels = overheadPanels(cfg.airframe);
    initOverheadVars(vars, this.overheadPanels, cfg.overheadVars);

    const svc: EpicServices = {
      vars,
      events,
      cfg,
      windows: this.windows,
      cas: this.cas,
      checklist: this.checklist,
      readouts: this.readouts,
      fms: this.fms,
      nav: host.nav ?? null,
      world: host.world ?? null,
    };

    // ---------------------------------------------------------- display units
    for (let n = 1; n <= 4; n++) {
      this.du.push(new EpicDisplayUnit({ id: duIds[n - 1], n, svc, cursor: this.cursor, pixelRatio: pr, bootS: cfg.duBootS, canvas: canvasOf() }));
      this.addPower(duIds[n - 1], pw.du?.[n - 1]);
    }
    this.cursor.router = {
      hitTest: (_s, du, x, y) => this.du[du - 1]?.hitTest(x, y) ?? '',
      enter: (s, du, x, y, id) => this.du[du - 1]?.enter(s, x, y, id),
      menu: (s, du, x, y) => this.du[du - 1]?.menu(s, x, y),
      data: (s, du, x, y, id, steps, inner) => this.du[du - 1]?.data(s, x, y, id, steps, inner),
    };

    // ---------------------------------------------------------- standby displays
    for (const s of [1, 2] as const) {
      const id = stbyIds[s - 1];
      this.standby.push(sym ? new SfdDisplay({ id, side: s, vars, sensors: cfg.sensors, pixelRatio: pr, canvas: canvasOf() }) : new SmcDisplay({ id, side: s, vars, dc: this.dc, windows: this.windows, sensors: cfg.sensors, pixelRatio: pr, canvas: canvasOf() }));
      this.addPower(id, pw.standby?.[s - 1]);
    }

    // ---------------------------------------------------------- MCDUs / TSCs / OHPTS
    if (!sym) {
      for (let n = 1; n <= 3; n++) {
        const id = `${p}.mcdu${n}`;
        const ev = compileBinding(vars, pw.mcdu?.[n - 1], 1);
        const m = new Mcdu(n, this.fmsShared, EPIC_CDU_PAGES, EPIC_KEY_PAGES, () => ev() >= 0.5);
        this.mcdus.push(m);
        this.mcduDisplays.push(new McduDisplay({ id, vars, mcdu: m, pixelRatio: pr, canvas: canvasOf() }));
        this.addPower(id, pw.mcdu?.[n - 1]);
      }
    } else {
      // Portrait TSC units (fix round 1, additive config option): the real Symmetry TSCs are portrait tablets.
      const tp = config.tscPortrait === true;
      for (let n = 1; n <= 4; n++) {
        const id = `${p}.tsc${n}`;
        const side: 1 | 2 = n <= 2 ? 1 : 2;
        const ev = compileBinding(vars, pw.tsc?.[n - 1], 1);
        const m = new Mcdu(n, this.fmsShared, EPIC_CDU_PAGES, EPIC_KEY_PAGES, () => ev() >= 0.5);
        this.mcdus.push(m);
        let logic: TouchScreenLogic | null = null;
        const pages = buildTscPages(
          { vars, events, cfg, dc: this.dc, gp: this.gp, checklist: this.checklist, windows: this.windows, mcdu: m, side, brightnessIds: side === 1 ? [duIds[0], duIds[1]] : [duIds[3], duIds[2]], portrait: tp },
          () => logic!,
        );
        logic = new TouchScreenLogic(pages, () => ev() >= 0.5);
        logic.show(n === 2 || n === 3 ? 'FMS' : 'HOME', false);
        this.tscLogic.push(logic);
        this.tsc.push(new TouchDisplay({ id, width: tp ? TSC_PORTRAIT_W : TSC_W, height: tp ? TSC_PORTRAIT_H : TSC_H, vars, logic, pixelRatio: pr, canvas: canvasOf(), titleH: TSC_TITLE_H, home: 'HOME', bootS: 8 }));
        this.addPower(id, pw.tsc?.[n - 1]);
      }
      for (let n = 1; n <= 3; n++) {
        const id = `${p}.ohpts${n}`;
        const ev = compileBinding(vars, pw.ohpts?.[n - 1], 1);
        let logic: TouchScreenLogic | null = null;
        const pages = buildOverheadPages(vars, this.overheadPanels, this.readouts, TSC_W, TSC_H, (tab) => logic?.show(tab), cfg.overheadVars, cfg.airframe.splitAntiIce);
        logic = new TouchScreenLogic(pages, () => ev() >= 0.5);
        logic.show(OHPTS_DEFAULT_PAGES[n - 1], false);
        this.ohptsLogic.push(logic);
        this.ohpts.push(new TouchDisplay({ id, width: TSC_W, height: TSC_H, vars, logic, pixelRatio: pr, canvas: canvasOf(), bootS: 8 }));
        this.addPower(id, pw.ohpts?.[n - 1]);
      }
    }

    for (let i = 0; i < this.mcdus.length; i++) this.msgLt.push(EPIC_VARS.mcduMsgLight(i + 1));

    // ---------------------------------------------------------- guidance panel windows
    for (const k of GP_WINDOW_KINDS) {
      const id = `${p}.gp.${k}`;
      this.gpWindows.push(new GpWindowDisplay({ id, kind: k, vars, gp: this.gp, symmetry: sym, pixelRatio: pr, canvas: canvasOf() }));
      this.addPower(id, pw.gp);
    }

    // ---------------------------------------------------------- misc state
    const sc = cfg.scales;
    this.eng = { oilP: [], oilT: [], vib: [] };
    for (let i = 0; i < 2; i++) {
      this.eng.oilP.push(new ExceedanceMonitor(sc.oilPress.limits));
      this.eng.oilT.push(new ExceedanceMonitor(sc.oilTemp.limits));
      this.eng.vib.push(new ExceedanceMonitor(sc.vib.limits));
    }
    this.engNames = resolveEngineNames(cfg.engines.vars, cfg.engines.count);
    for (const s of [1, 2] as const) {
      this.offs.push(
        events.on(EPIC_EVENTS.chrono(s), (pl) => {
          const cmd = String(pl ?? 'startstop');
          if (cmd === 'reset') {
            vars.set(EPIC_VARS.chronoS(s), 0);
            vars.set(EPIC_VARS.chronoRun(s), 0);
          } else vars.set(EPIC_VARS.chronoRun(s), vars.get(EPIC_VARS.chronoRun(s)) !== 0 ? 0 : 1);
        }),
      );
    }
    if (!vars.has(EPIC_VARS.coupleSide)) vars.set(EPIC_VARS.coupleSide, 1);
    if (!vars.has(EPIC_VARS.speedMan)) vars.set(EPIC_VARS.speedMan, 1);
    if (!vars.has(EPIC_VARS.gpBrt)) vars.set(EPIC_VARS.gpBrt, 1);
    if (!vars.has(EPIC_VARS.xpdrUnit)) vars.set(EPIC_VARS.xpdrUnit, 1);
    for (const r of [1, 2]) if (!vars.has(EPIC_VARS.hfFreq(r))) vars.set(EPIC_VARS.hfFreq(r), r === 1 ? 8891 : 5598);

    const self = this;
    this.system = {
      name: 'epic.suite',
      update(dt: number) {
        self.update(dt);
      },
      reset() {
        self.windows.update(0);
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

  /** ILS / LOC approach of the active flight plan for the approach preview / APR (null when none). */
  private approachInfo(): { freqMhz: number; courseMag: number } | null {
    const plan = this.fms?.plans.active;
    const ap = plan?.approachProcedure;
    if (!ap || !ap.navFrequencyMhz || !ap.approachType) return null;
    if (!LOC_TYPES.has(ap.approachType)) return null;
    const mv = this.vars.get(GPS.magVar);
    return { freqMhz: ap.navFrequencyMhz, courseMag: (ap.navCourseTrue ?? 0) - mv };
  }

  /** Every display of the suite (for the cockpit display manager). */
  get displays(): CockpitDisplay[] {
    return [...this.du, ...this.standby, ...this.mcduDisplays, ...this.tsc, ...this.ohpts, ...this.gpWindows];
  }

  update(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < this.power.length; i++) v.set(this.power[i].id, this.power[i].eval() >= 0.5 ? 1 : 0);
    // Secondary engine exceedance (independent of what is displayed).
    let exceed = false;
    const nv = this.engNames;
    for (let i = 0; i < 2; i++) {
      const running = v.get(nv.n2[i]) > 5;
      this.eng.oilP[i].update(running ? v.get(nv.oilPress[i]) : 100, dt);
      this.eng.oilT[i].update(v.get(nv.oilTemp[i]), dt);
      this.eng.vib[i].update(Math.max(v.get(nv.vibLp[i]), v.get(nv.vibHp[i])), dt);
      exceed = exceed || this.eng.oilP[i].level > 0 || this.eng.oilT[i].level > 0 || this.eng.vib[i].level > 0;
    }
    v.set(EPIC_VARS.engExceed2, exceed ? 1 : 0);
    this.windows.update(dt);
    this.cursor.update(dt);
    this.gp.update(dt);
    this.dc.update(dt);
    this.cas.update(dt);
    this.checklist.update(dt);
    const msgs = this.fmsShared.messages.length > 0;
    for (let i = 0; i < this.mcdus.length; i++) {
      const m = this.mcdus[i];
      m.update(dt);
      v.set(this.msgLt[i], msgs && m.page.id !== 'MSG' ? 1 : 0);
    }
    // Transponder IDENT (18 s).
    if (v.get(NAV.xpdrIdent) !== 0) {
      this.identT += dt;
      if (this.identT >= IDENT_S) {
        v.set(NAV.xpdrIdent, 0);
        this.identT = 0;
      }
    } else this.identT = 0;
    // Chronometers.
    for (let s = 1; s <= 2; s++) if (v.get(CHRONO_RUN[s - 1]) !== 0) v.set(CHRONO_S[s - 1], v.get(CHRONO_S[s - 1]) + dt);
    // Destination direct distance (approach preview limit), 1 Hz.
    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 1;
      const dest = this.fms?.plans.active.destination;
      const lat = v.get(GPS.lat);
      const lon = v.get(GPS.lon);
      v.set(EPIC_VARS.destDirectNm, dest && Number.isFinite(lat) ? distanceNm(lat, lon, dest.lat, dest.lon) : 1e9);
    }
  }

  /**
   * Initial-state preset. 'cold_dark': displays boot when powered, default
   * window layout, SMCs on the standby instrument. Other states: no boot
   * delay (the systems are already running).
   */
  applyState(state: InitialState): void {
    const v = this.vars;
    v.set(EPIC_VARS.bootSkip, state === 'cold_dark' ? 0 : 1);
    this.windows.initVars(true);
    for (const s of [1, 2] as const) {
      this.dc.page(s, 'STBY');
      v.set(EPIC_VARS.chronoS(s), 0);
      v.set(EPIC_VARS.chronoRun(s), 0);
    }
    v.set(EPIC_VARS.coupleSide, 1);
    this.checklist.resetAll();
    this.checklist.select(this.checklist.lists.length ? 0 : -1);
    for (const l of this.tscLogic) l.show(this.tscLogic.indexOf(l) === 1 || this.tscLogic.indexOf(l) === 2 ? 'FMS' : 'HOME', false);
    this.ohptsLogic.forEach((l, i) => l.show(OHPTS_DEFAULT_PAGES[i], false));
    this.windows.update(0);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
    this.cursor.dispose();
    this.gp.dispose();
    this.dc.dispose();
    this.cas.dispose();
    for (const m of this.mcdus) m.dispose();
    for (const d of this.displays) d.dispose?.();
  }
}

const LOC_TYPES = new Set(['ILS', 'LOC', 'LOC_BC', 'LDA', 'SDF', 'IGS']);
const CHRONO_RUN = [EPIC_VARS.chronoRun(1), EPIC_VARS.chronoRun(2)];
const CHRONO_S = [EPIC_VARS.chronoS(1), EPIC_VARS.chronoS(2)];

/** Builds the suite (see the file header for the integration steps). */
export function createEpicSuite(host: EpicSuiteHost, config: EpicSuiteConfig): EpicSuite {
  return new EpicSuite(host, config);
}
