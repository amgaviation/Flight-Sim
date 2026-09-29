/**
 * `createB737Suite(host, config)`: the complete Boeing 737NG avionics suite
 * for an aircraft module: Common Display System (six DUs, two DEUs, EFIS
 * control panels, display select / transfer switches), FMC with two CDUs,
 * Mode Control Panel + AFDS + autothrottle, and (unless the aircraft passes
 * its own) the VHF NAV / ADF / marker / GPS receivers and the nav `Fms`.
 *
 *   const b737 = createB737Suite(ctx, {
 *     power: { du: { capt_out: 'elec.ac_stby_powered', ... }, fmc: 'elec.ac_xfr1_powered', ... },
 *     afds: { gains: {...}, leverVar: (e) => `ac.tla${e}` },
 *   });
 *   systems.push(elec, sensors, ...b737.systems, fdmActuators);   // after electrical / sensors
 *   failures.register(b737.failures());
 *   // cockpit: b737.du[i], b737.cduDisplays[i], b737.mcpWindows[i] (cockpit.ts helpers place them
 *   // together with the MCP, EFIS panels, CDU keyboards and display select panels).
 *   b737.applyState(state);                                        // from AircraftInstance.applyState
 *
 * Update order inside `systems` (each is a `Subsystem`):
 *   radios (if created) -> fms (if created) -> 'b737_cds' (power bindings,
 *   EFIS panels, CDS routing, FMC, CDUs) -> 'b737_afds' (MCP, Afcs,
 *   autothrottle, FMA). The FMC runs before the AFDS so the VNAV / LNAV
 *   targets the AFDS consumes are from the same step.
 */
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import type { AudioApi } from '../../core/SimContext';
import { GPS, NAV } from '../../core/vars';
import type { NavDatabase } from '../../nav/types';
import type { WorldQuery } from '../../world/types';
import { Radios } from '../../nav/Radios';
import { Fms } from '../../nav/fms/Fms';
import type { CockpitDisplay } from '../../cockpit/types';
import { DISPLAY_VARS } from '../../cockpit/types';
import type { InitialState, Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../../systems/failures/FailureManager';
import { compileCondition } from '../../systems/util/binding';
import { resolveB737Config, type B737Config, type ResolvedB737Config } from './config';
import { B737_VARS, DU_IDS, NdMode, cduDisplayId, type Side } from './vars';
import { EfisPanels } from './cds/EfisPanels';
import { CdsLogic } from './cds/CdsLogic';
import { DisplayUnit } from './cds/DisplayUnit';
import type { CdsEnv } from './cds/types';
import { B737Fmc } from './fmc/Fmc';
import { Cdu } from './fmc/Cdu';
import { CduDisplay } from './fmc/CduDisplay';
import { B737Afds } from './afds/Afds';
import { MCP_WINDOW_KINDS, McpWindowDisplay, mcpWindowId } from './mcp/McpWindow';
import { B738_SPEEDS } from './data/b738';

/** What the suite needs from the aircraft (a SimContext satisfies it). */
export interface B737SuiteHost {
  vars: SimVars;
  events: EventBus;
  nav?: NavDatabase | null;
  world?: Pick<WorldQuery, 'elevationAt'> | null;
  audio?: AudioApi | null;
  /** Canvas kind for every display, or a factory (tests / headless). Default: DOM canvas when a document exists. */
  canvas?: 'dom' | 'offscreen' | (() => HTMLCanvasElement | OffscreenCanvas);
  /** Skip creating displays entirely (logic-only tests). */
  noDisplays?: boolean;
}

export class B737Suite {
  readonly cfg: ResolvedB737Config;
  readonly vars: SimVars;
  readonly events: EventBus;
  readonly radios: Radios | null;
  readonly fms: Fms | null;
  readonly efis: EfisPanels;
  readonly cds: CdsLogic;
  readonly fmc: B737Fmc | null;
  /** CDU 1 (left) and CDU 2 (right); empty without an FMS. */
  readonly cdus: Cdu[] = [];
  readonly afds: B737Afds;
  /** The six display units in DU_IDS order: capt_out, capt_in, upper, lower, fo_in, fo_out. */
  readonly du: DisplayUnit[] = [];
  readonly cduDisplays: CduDisplay[] = [];
  /** MCP windows in MCP_WINDOW_KINDS order (CRS L, IAS/MACH, HDG, ALT, V/S, CRS R). */
  readonly mcpWindows: McpWindowDisplay[] = [];
  /** Subsystems to add to `AircraftInstance.systems`, in this order. */
  readonly systems: Subsystem[] = [];
  private readonly ownRadios: boolean;
  private readonly ownFms: boolean;
  private readonly radioPower: { name: string; ok: () => boolean }[] = [];
  private readonly cduPower: [() => boolean, () => boolean];
  private readonly mcpPower: () => boolean;

  constructor(host: B737SuiteHost, config: B737Config = {}) {
    const cfg = resolveB737Config(config);
    this.cfg = cfg;
    const v = host.vars;
    const events = host.events;
    this.vars = v;
    this.events = events;
    const nav = host.nav ?? null;
    const p = cfg.power;

    // ------------------------------------------------------------ receivers and FMS
    this.ownRadios = !cfg.radios && !!nav;
    this.radios = cfg.radios ?? (nav ? new Radios({ vars: v, nav }, cfg.radiosOptions) : null);
    this.ownFms = !cfg.fms && !!nav;
    this.fms =
      cfg.fms ??
      (nav
        ? new Fms(
            { vars: v, events, nav },
            {
              style: 'boeing',
              engineCount: 2,
              adcIndex: cfg.adiru[0],
              // Initial VNAV schedule (replaced by the FMC's ECON / selected speeds once PERF INIT is done).
              // 250 kt below 10,000 ft (14 CFR 91.117); 280 / .78 climb, .78 cruise, .78 / 280 descent are the
              // commonly quoted 737-800 ECON-like values (EST), approach 150 kt (EST, flaps 30 VREF + ~5 at mid weights).
              // speedLimitDecelFt: the FMC builds a deceleration segment so the 250 kt / 10,000 ft transition is
              // met (FCOM 11.31 DES page speed transition, EST 2,000 ft of deceleration); approachDecelNm: the
              // approach deceleration segment toward VREF-based approach speed before the FAF (EST 12 nm).
              speeds: { climbKt: 280, cruiseKt: 280, cruiseMach: 0.78, descentKt: 280, descentMach: 0.78, approachKt: 150, speedLimitDecelFt: 2000, approachDecelNm: 12 },
              ...cfg.fmsOptions,
            },
          )
        : null);
    const rp = (name: string, b: typeof p.nav1): void => {
      this.radioPower.push({ name, ok: compileCondition(v, b, true) });
    };
    const navCount = cfg.radiosOptions.navCount ?? 2;
    const adfCount = cfg.radiosOptions.adfCount ?? 1;
    if (navCount >= 1) rp(NAV.powered(1), p.nav1);
    if (navCount >= 2) rp(NAV.powered(2), p.nav2);
    if (adfCount >= 1) rp(NAV.adfPowered(1), p.adf1);
    if (adfCount >= 2) rp(NAV.adfPowered(2), p.adf2);
    rp(GPS.powered, p.gps);
    rp(NAV.markerPowered, p.marker);

    // ------------------------------------------------------------ logic
    const efisOk = [compileCondition(v, p.efis1, true), compileCondition(v, p.efis2, true)];
    this.efis = new EfisPanels({ vars: v, events }, cfg.adiru, (s) => efisOk[s - 1]());
    this.cds = new CdsLogic({ vars: v, events }, cfg);
    this.fmc = this.fms ? new B737Fmc({ vars: v, events, cfg, fms: this.fms }) : null;
    this.cduPower = [compileCondition(v, p.cdu1, true), compileCondition(v, p.cdu2, true)];
    this.mcpPower = compileCondition(v, p.mcp, true);
    if (this.fmc) {
      for (const s of [1, 2] as Side[]) {
        const c = new Cdu(this.fmc, s, events);
        const ok = this.cduPower[s - 1];
        c.powerCheck = ok;
        this.cdus.push(c);
      }
    }
    this.afds = new B737Afds({ vars: v, events, cfg, fms: this.fms, fmc: this.fmc });

    // ------------------------------------------------------------ displays
    if (!host.noDisplays) {
      const hc = host.canvas;
      const canvasOf = (): 'dom' | 'offscreen' | HTMLCanvasElement | OffscreenCanvas | undefined => (typeof hc === 'function' ? hc() : hc);
      const env: CdsEnv = {
        vars: v,
        cfg,
        efis: this.efis,
        fms: this.fms,
        fmc: this.fmc,
        nav,
        world: host.world ?? null,
        audio: host.audio ?? null,
        traffic: cfg.trafficSource,
        weather: cfg.weatherOverlay,
      };
      for (const d of DU_IDS) this.du.push(new DisplayUnit(env, d, { canvas: canvasOf() }));
      for (const c of this.cdus) this.cduDisplays.push(new CduDisplay(c, { canvas: canvasOf(), driveCdu: false }));
      for (const k of MCP_WINDOW_KINDS) this.mcpWindows.push(new McpWindowDisplay(k, { vars: v, canvas: canvasOf() }));
    }
    for (const s of [1, 2] as Side[]) if (!v.has(B737_VARS.cduBrt(s))) v.set(B737_VARS.cduBrt(s), 1);

    // ------------------------------------------------------------ subsystems
    if (this.radios && this.ownRadios) this.systems.push(this.radios);
    if (this.fms && this.ownFms) this.systems.push(this.fms);
    const self = this;
    this.systems.push(
      {
        name: 'b737_cds',
        update(dt: number) {
          self.updateCore(dt);
        },
        reset() {
          self.cds.reset();
          self.fmc?.reset();
        },
      },
      this.afds,
    );
  }

  /** Power bindings, EFIS panels, CDS routing, FMC and CDUs (one systems step). */
  private updateCore(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < this.radioPower.length; i++) v.set(this.radioPower[i].name, this.radioPower[i].ok() ? 1 : 0);
    for (const s of [1, 2] as Side[]) v.set(DISPLAY_VARS.power(cduDisplayId(s)), this.cduPower[s - 1]() ? 1 : 0);
    const mcpOn = this.mcpPower() ? 1 : 0;
    for (let i = 0; i < MCP_WINDOW_KINDS.length; i++) v.set(DISPLAY_VARS.power(mcpWindowId(MCP_WINDOW_KINDS[i])), mcpOn);
    this.efis.update(dt);
    this.cds.update(dt);
    if (this.fmc) this.fmc.update(dt);
    for (let i = 0; i < this.cdus.length; i++) this.cdus[i].update(dt);
  }

  /** Every display of the suite (for the cockpit display manager). */
  get displays(): CockpitDisplay[] {
    return [...this.du, ...this.cduDisplays, ...this.mcpWindows];
  }

  /** Failure definitions of every part (register with the aircraft's FailureManager). */
  failures(): FailureDef[] {
    return [...this.cds.failures(), ...(this.fmc?.failures() ?? []), ...this.afds.failures()];
  }

  /**
   * Initial-state preset:
   *  - every state: A/P and A/T disengaged, FMA cleared, EFIS panels in MAP 10 nm (ground) / 40 nm
   *    (airborne) with the MINS / BARO in the standard pre-flight position, MFD formats cleared;
   *  - 'cold_dark': F/Ds off, MCP at its power-up values (the CDS shows the secondary engine
   *    display on the first power-up, FCOM 7.10);
   *  - 'ready_to_taxi' / 'takeoff': F/Ds on, A/T armed ('takeoff' also sets the MCP speed to V2 when
   *    the FMC has one);
   *  - 'cruise' / 'approach': F/Ds on; the aircraft module engages CMD / modes itself after trimming.
   */
  applyState(state: InitialState): void {
    const v = this.vars;
    this.cds.applyState(state);
    this.afds.reset();
    const air = state === 'cruise' || state === 'approach';
    for (const s of [1, 2] as Side[]) {
      v.set(B737_VARS.efisMode(s), NdMode.Map);
      v.set(B737_VARS.efisCtr(s), 0);
      v.set(B737_VARS.efisRange(s), air ? 3 : 1);
      v.set(B737_VARS.efisTfc(s), state === 'cold_dark' ? 0 : 1);
      v.set(`ap.fd${s}_on`, state === 'cold_dark' ? 0 : 1);
    }
    v.set(B737_VARS.mcpDisengageBar, 0);
    v.set('ac.at_arm', state === 'ready_to_taxi' || state === 'takeoff' || air ? 1 : 0);
    if (state === 'cold_dark') {
      v.set('ap.sel_spd_kt', 100);
      v.set('ap.sel_hdg_deg', 0);
      v.set('ap.sel_alt_ft', 0);
      v.set('ap.spd_is_mach', 0);
    }
    if (state === 'takeoff' && this.fmc && Number.isFinite(this.fmc.v2Sel)) v.set('ap.sel_spd_kt', this.fmc.v2Sel);
    // Keep the MCP speed inside the airframe limits whatever the state preset wrote.
    v.set('ap.sel_spd_kt', Math.max(100, Math.min(B738_SPEEDS.vmoKt, v.get('ap.sel_spd_kt'))));
    this.cds.reset();
  }

  dispose(): void {
    this.afds.dispose();
    this.efis.dispose();
    this.cds.dispose();
    this.fmc?.dispose();
    for (const c of this.cdus) c.dispose();
    for (const d of this.displays) d.dispose?.();
    if (this.ownFms) this.fms?.dispose?.();
  }
}

/** Builds the suite (see the file header for the integration steps). */
export function createB737Suite(host: B737SuiteHost, config: B737Config = {}): B737Suite {
  return new B737Suite(host, config);
}
