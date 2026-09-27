/**
 * `G1000Suite`: one-stop assembly of the Garmin G1000 NXi flight deck of the
 * Cessna 172S (Cessna NAV III) for the aircraft module.
 *
 *   const suite = new G1000Suite(ctx, { ...C172S_NXI, power: C172S_NXI_POWER, checklists });
 *   systems.push(...suite.systems);          // before the Afcs (it reads ap.nav_source)
 *   systems.push(new Afcs(ctx, { ...AFCS_GFC700_NXI, ...suite.afcsWiring(), sensors, gains }));
 *   displays: suite.displayList()            // ids 'pfd', 'mfd' -> cockpit screen meshes
 *   controls: g1000Controls(...)             // bezel / GMA 1360 control specs (controls.ts)
 *   flight controls: add G1K.espServoPitch / espServoRoll to the pitch / roll `addVars` (ESP)
 *   applyState(s) { ...; suite.applyState(s) }
 *
 * The suite owns (creates when not supplied) the Radios (GIA 63W NAV / GPS
 * receivers, GMA marker receiver) and the Fms, listed in `systems` so the app
 * does not add its own; their power follows the LRU units (NAV1 / GPS1 on GIA
 * 1, NAV2 / GPS2 on GIA 2, marker receiver in the GMA 1360).
 */
import type { Subsystem } from '../../aircraft/types';
import type { CockpitDisplay } from '../../cockpit/types';
import type { SimContext } from '../../core/SimContext';
import { GPS, NAV } from '../../core/vars';
import { Fms } from '../../nav/fms/Fms';
import { Radios } from '../../nav/Radios';
import type { CasModel } from '../common/draw/CasWindow';
import { resolveConfig, type G1000Config, type G1000Resolved } from './config';
import { G1000System } from './state/System';
import { GduDisplay, type GduDisplayOptions } from './gdu/GduDisplay';
import { G1K } from './vars';

export type SuiteContext = Pick<SimContext, 'vars' | 'nav'> & Partial<Pick<SimContext, 'events' | 'world' | 'audio'>>;

export interface SuiteOptions {
  /** Canvas kind for both displays (default: DOM canvas when a document exists). */
  canvas?: GduDisplayOptions['canvas'];
  /** Skip creating displays (headless tests of the logic). */
  noDisplays?: boolean;
}

/** Writes the receiver power inputs from the LRU state (NAV1/GPS1 in GIA 1, NAV2/GPS2 in GIA 2, marker in the GMA). */
class RadioPower implements Subsystem {
  readonly name = 'g1000.radio_power';
  private readonly gia1 = G1K.unitPowered('gia1');
  private readonly gia2 = G1K.unitPowered('gia2');
  private readonly gma = G1K.unitPowered('gma');
  private readonly adf = G1K.unitPowered('adf');
  private readonly nav1 = NAV.powered(1);
  private readonly nav2 = NAV.powered(2);
  private readonly adf1 = NAV.adfPowered(1);
  constructor(
    private readonly vars: SuiteContext['vars'],
    private readonly cfg: G1000Resolved,
  ) {}
  update(): void {
    const v = this.vars;
    const g1 = v.get(this.gia1) >= 0.5;
    const g2 = v.get(this.gia2) >= 0.5;
    v.set(this.nav1, g1 ? 1 : 0);
    if (this.cfg.radios.nav >= 2) v.set(this.nav2, g2 ? 1 : 0);
    // Either GPS receiver provides the navigation solution (PG §1.3 "GPS Receiver Operation").
    v.set(GPS.powered, g1 || g2 ? 1 : 0);
    v.set(NAV.markerPowered, v.get(this.gma) >= 0.5 ? 1 : 0);
    if (this.cfg.radios.adf) v.set(this.adf1, v.get(this.adf) >= 0.5 ? 1 : 0);
  }
}

export class G1000Suite {
  readonly cfg: G1000Resolved;
  readonly system: G1000System;
  readonly fms: Fms;
  readonly radios: Radios | null;
  readonly pfd: GduDisplay | null;
  readonly mfd: GduDisplay | null;
  /** Subsystems in update order (radio power, radios, FMS, the G1000 system). */
  readonly systems: Subsystem[];

  constructor(ctx: SuiteContext, config: G1000Config, opts: SuiteOptions = {}) {
    const cfg = resolveConfig(config);
    this.cfg = cfg;
    const systems: Subsystem[] = [];
    if (config.radiosInstance) this.radios = config.radiosInstance;
    else {
      systems.push(new RadioPower(ctx.vars, cfg));
      this.radios = new Radios(ctx, { navCount: cfg.radios.nav, adfCount: cfg.radios.adf ? 1 : 0, ...config.radiosOptions });
      systems.push(this.radios);
    }
    if (config.fms) this.fms = config.fms;
    else {
      // Fuel predictions use the totalizer GAL REM (as kg, `g1k.fuel.rem_kg`); LNAV bank limit 22° (PG Table 7-3).
      this.fms = new Fms(ctx, { style: 'garmin', engineCount: 1, fuelVar: G1K.fuelRemKg, bankLimitDeg: 22, ...config.fmsOptions });
      systems.push(this.fms);
    }
    this.system = new G1000System({ vars: ctx.vars, events: ctx.events, audio: ctx.audio, nav: ctx.nav, world: ctx.world }, cfg, this.fms, config.casModel);
    if (config.trafficSource) this.system.trafficSource = config.trafficSource;
    systems.push(this.system);
    this.systems = systems;
    if (opts.noDisplays) {
      this.pfd = this.mfd = null;
      return;
    }
    const dopts: GduDisplayOptions = { canvas: opts.canvas };
    this.pfd = new GduDisplay(this.system, 'pfd', dopts);
    this.mfd = new GduDisplay(this.system, 'mfd', dopts);
  }

  /** CAS model shown by the suite (optionally add it as a sink of an aircraft CasManager). */
  get casModel(): CasModel {
    return this.system.alerts.cas;
  }

  /** Both displays for the cockpit DisplayManager: ids 'pfd', 'mfd'. */
  displayList(): CockpitDisplay[] {
    const out: CockpitDisplay[] = [];
    if (this.pfd) out.push(this.pfd);
    if (this.mfd) out.push(this.mfd);
    return out;
  }

  /**
   * Afcs power bindings: the GFC 700 computes in GIA 1 and drives the GSA 81
   * servos (AUTOPILOT breaker); `servoPower` also needs the preflight test done.
   */
  afcsWiring(): { power: string; servoPower: string } {
    return { power: G1K.unitUp('gia1'), servoPower: G1K.unitUp('servos') };
  }

  applyState(state: 'cold_dark' | 'ready_to_taxi' | 'takeoff' | 'cruise' | 'approach'): void {
    this.system.applyState(state);
  }

  dispose(): void {
    this.system.dispose();
    for (const d of this.displayList()) d.dispose?.();
  }
}
