/**
 * `G3000Suite`: one-stop assembly of a Garmin G3000 / G5000 flight deck for
 * an aircraft module (Citation M2: G3000, Citation Longitude: G5000).
 *
 *   const suite = new G3000Suite(ctx, { ...G3000_M2_LAYOUT, aircraftId: 'citation-m2', eis, vspeeds, power, ... });
 *   systems.push(...suite.systems);            // before the Afcs (it reads ap.nav_source)
 *   displays: suite.displayList() -> map onto cockpit screen meshes by id
 *   casManager.addSink(suite.casModel)          // CAS messages (optional)
 *   applyState(s) { ...; suite.applyState(s) }
 *
 * The suite owns (creates when not supplied) the Radios (GIA 63W NAV / GPS
 * receivers) and the Fms, both listed in `systems` so the app does not add
 * its own; their power vars follow `config.radioPower` (default: PFD1 power).
 */
import type { Subsystem } from '../../aircraft/types';
import type { CockpitDisplay } from '../../cockpit/types';
import type { SimContext } from '../../core/SimContext';
import { GPS, NAV } from '../../core/vars';
import { Fms } from '../../nav/fms/Fms';
import { Radios } from '../../nav/Radios';
import { compileBinding, type Evaluator } from '../../systems/util/binding';
import type { CasModel } from '../common/draw/CasWindow';
import { resolveConfig, type G3000Config, type G3000Resolved } from './config';
import { G3000System } from './state/System';
import { GduDisplay, type GduDisplayOptions } from './gdu/GduDisplay';
import { GtcDisplay } from './gtc/GtcDisplay';
import { Gmc710 } from './gmc/Gmc710';
import type { GtcId } from './vars';

export type SuiteContext = Pick<SimContext, 'vars' | 'nav'> & Partial<Pick<SimContext, 'events' | 'world' | 'audio'>>;

export interface SuiteOptions {
  /** Canvas kind for every display (default: DOM canvas when a document exists). */
  canvas?: GduDisplayOptions['canvas'];
  /** Skip creating displays (headless tests of the logic). */
  noDisplays?: boolean;
}

/** Writes the radio receiver power vars from bindings (GIA 63W units on the avionics bus). */
class RadioPower implements Subsystem {
  readonly name = 'g3000.radio_power';
  private readonly items: { name: string; ev: Evaluator }[] = [];
  private readonly vars: SuiteContext['vars'];
  constructor(ctx: SuiteContext, cfg: G3000Resolved) {
    this.vars = ctx.vars;
    const def = cfg.power.pfd1 ?? 1;
    const rp = cfg.radioPower;
    const add = (name: string, b: G3000Resolved['radioPower'][keyof G3000Resolved['radioPower']]): void => {
      this.items.push({ name, ev: compileBinding(ctx.vars, b ?? def, 1) });
    };
    add(NAV.powered(1), rp.nav1);
    if (cfg.radios.nav >= 2) add(NAV.powered(2), rp.nav2 ?? cfg.power.pfd2 ?? cfg.power.mfd);
    add(GPS.powered, rp.gps);
    add(NAV.markerPowered, rp.marker);
    if (cfg.radios.adf) add(NAV.adfPowered(1), rp.adf);
  }
  update(): void {
    const v = this.vars;
    for (let i = 0; i < this.items.length; i++) v.set(this.items[i].name, this.items[i].ev() >= 0.5 ? 1 : 0);
  }
}

export class G3000Suite {
  readonly cfg: G3000Resolved;
  readonly system: G3000System;
  readonly fms: Fms;
  readonly radios: Radios | null;
  readonly gmc: Gmc710;
  readonly pfd1: GduDisplay | null;
  readonly mfd: GduDisplay | null;
  readonly pfd2: GduDisplay | null;
  readonly gtcs: GtcDisplay[];
  /** Subsystems in update order (radio power, radios, FMS, the G3000 system, GMC 710). */
  readonly systems: Subsystem[];

  constructor(ctx: SuiteContext, config: G3000Config, opts: SuiteOptions = {}) {
    const cfg = resolveConfig(config);
    this.cfg = cfg;
    const systems: Subsystem[] = [];
    // Radios (owned unless supplied) with their power logic.
    if (config.radiosInstance) this.radios = config.radiosInstance;
    else {
      systems.push(new RadioPower(ctx, cfg));
      this.radios = new Radios(ctx, { navCount: cfg.radios.nav, adfCount: cfg.radios.adf ? 1 : 0, ...config.radiosOptions });
      systems.push(this.radios);
    }
    if (config.fms) this.fms = config.fms;
    else {
      this.fms = new Fms(ctx, { style: 'garmin', engineCount: config.engineCount ?? cfg.eis.engines, fuelVar: cfg.fuelTotalVar, ...config.fmsOptions });
      systems.push(this.fms);
    }
    this.system = new G3000System({ vars: ctx.vars, events: ctx.events, audio: ctx.audio, nav: ctx.nav, world: ctx.world }, cfg, this.fms, config.casModel);
    if (config.trafficSource) this.system.trafficSource = config.trafficSource;
    systems.push(this.system);
    this.gmc = new Gmc710(this.system);
    systems.push(this.gmc);
    this.systems = systems;
    if (opts.noDisplays) {
      this.pfd1 = this.mfd = this.pfd2 = null;
      this.gtcs = [];
      return;
    }
    const dopts: GduDisplayOptions = { canvas: opts.canvas };
    this.pfd1 = new GduDisplay(this.system, 'pfd1', dopts);
    this.mfd = new GduDisplay(this.system, 'mfd', dopts);
    this.pfd2 = cfg.pfdCount === 2 ? new GduDisplay(this.system, 'pfd2', dopts) : null;
    this.gtcs = cfg.gtcs.map((g) => new GtcDisplay(this.system, g, { canvas: opts.canvas }));
  }

  /** CAS model shown by the suite (add it as a sink of the aircraft's CasManager). */
  get casModel(): CasModel {
    return this.system.cas;
  }

  /** Every display (PFD1, MFD, PFD2, GTCs) for the cockpit DisplayManager; ids = 'pfd1', 'mfd', 'pfd2', 'gtc1'... */
  displayList(): CockpitDisplay[] {
    const out: CockpitDisplay[] = [];
    if (this.pfd1) out.push(this.pfd1);
    if (this.mfd) out.push(this.mfd);
    if (this.pfd2) out.push(this.pfd2);
    for (const g of this.gtcs) out.push(g);
    return out;
  }

  gtc(id: GtcId): GtcDisplay | undefined {
    return this.gtcs.find((g) => g.g.id === id);
  }

  applyState(state: 'cold_dark' | 'ready_to_taxi' | 'takeoff' | 'cruise' | 'approach'): void {
    this.system.applyState(state);
    for (const g of this.gtcs) g.gtc.homePage();
  }

  dispose(): void {
    this.system.dispose();
    this.gmc.dispose();
    for (const d of this.displayList()) d.dispose?.();
  }
}
