/**
 * Shared FMS state behind both FMS windows: the aircraft's nav `Fms`
 * (Boeing edit style: MOD + EXEC, as the Collins FMS), the nav database,
 * performance initialisation, V-speeds (TOLD), procedure cache and the FMS
 * message queue. FSB BD-700-1A10 Rev 7: "Triple FMS installation with full
 * time synchronization" (SCOPE: one FMS instance serves all three).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { FMS, FUEL } from '../../../core/vars';
import type { Fms } from '../../../nav/fms/Fms';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import type { AirportProcedures, NavDatabase } from '../../../nav/types';
import { FUSION_VARS } from '../vars';
import type { FusionResolvedConfig } from '../config';

const KG_TO_LB = 2.20462;

export interface PerfData {
  /** Basic operating weight (lb). EST default: Bombardier Global 6000 specification BOW 51,200 lb. */
  bowLb: number;
  /** Passengers + cargo (lb). */
  payloadLb: number;
  reservesLb: number;
  transAltFt: number;
  climbKt: number;
  climbMach: number;
  cruiseKt: number;
  cruiseMach: number;
  descentKt: number;
  descentMach: number;
  /** Descent path angle (deg). */
  vpaDeg: number;
  confirmed: boolean;
}

export class FmsHost {
  readonly perf: PerfData;
  /** FMS message queue (newest last). */
  readonly messages: string[] = [];
  /** HF radios (kHz); no core var exists for HF. */
  readonly hf = [8891, 5598];
  private readonly procs = new Map<string, AirportProcedures | null | 'loading'>();
  private msgTimer = 0;
  private readonly flags = new Set<string>();

  constructor(
    readonly vars: SimVars,
    readonly events: EventBus,
    readonly fms: Fms | null,
    readonly db: NavDatabase | null,
    readonly cfg: FusionResolvedConfig,
  ) {
    this.perf = {
      bowLb: 51200, // EST: Bombardier Global 6000 specification sheet basic operating weight
      payloadLb: 0,
      reservesLb: 4000, // EST: typical NBAA IFR reserve entry for the type
      transAltFt: cfg.transitionAltFt,
      climbKt: 250,
      climbMach: 0.8,
      cruiseKt: 300,
      cruiseMach: 0.85, // Global 6000 "long range cruise M 0.85" (Bombardier specification)
      descentKt: 280,
      descentMach: 0.8,
      vpaDeg: 3,
      confirmed: false,
    };
  }

  /** Plan shown on the pages: the MOD plan while pending, else the active one. */
  get plan(): FlightPlan | null {
    return this.fms ? this.fms.plans.displayed : null;
  }

  get modPending(): boolean {
    return this.vars.getBool(FMS.modPending);
  }

  exec(): void {
    if (this.modPending) this.events.emit(this.cfg.events.fmsExec);
  }

  erase(): void {
    if (this.modPending) this.events.emit(this.cfg.events.fmsErase);
  }

  /** Airport procedures, loading them on first use (undefined while loading, null when none). */
  procedures(icao: string): AirportProcedures | null | undefined {
    const k = icao.toUpperCase();
    const c = this.procs.get(k);
    if (c === 'loading') return undefined;
    if (c !== undefined) return c;
    const load = this.db?.loadProcedures?.bind(this.db);
    if (!load) {
      this.procs.set(k, null);
      return null;
    }
    this.procs.set(k, 'loading');
    load(k)
      .then((p) => this.procs.set(k, p ?? null))
      .catch(() => this.procs.set(k, null));
    return undefined;
  }

  /** Total fuel (lb) from the fuel system. */
  fuelLb(): number {
    return this.vars.get(FUEL.totalKg) * KG_TO_LB;
  }

  zfwLb(): number {
    return this.perf.bowLb + this.perf.payloadLb;
  }

  gwLb(): number {
    return this.zfwLb() + this.fuelLb();
  }

  pushMessage(text: string): void {
    if (this.messages.includes(text)) return;
    this.messages.push(text);
  }

  clearMessage(): string | undefined {
    return this.messages.shift();
  }

  /** Applies the PERF / VNAV speed schedule to the nav FMS. */
  applySpeeds(): void {
    const p = this.perf;
    this.fms?.setSpeeds({ climbKt: p.climbKt, climbMach: p.climbMach, cruiseKt: p.cruiseKt, cruiseMach: p.cruiseMach, descentKt: p.descentKt, descentMach: p.descentMach });
    const plan = this.fms?.plans.active;
    if (plan) plan.descentFpaDeg = p.vpaDeg;
  }

  /** 1 Hz: FMS advisory messages (EST texts, Collins FMS message style). */
  update(dt: number): void {
    // EXEC annunciator follows the MOD state every step; messages are evaluated at 1 Hz.
    this.vars.set(FUSION_VARS.execLight, this.modPending ? 1 : 0);
    this.msgTimer -= dt;
    if (this.msgTimer > 0) return;
    this.msgTimer = 1;
    const v = this.vars;
    const fuelDest = v.get(FMS.fuelDestKg) * KG_TO_LB;
    const dest = v.getString(FMS.destIdent);
    this.flag('INSUFFICIENT FUEL', dest !== '' && v.has(FMS.fuelDestKg) && fuelDest < this.perf.reservesLb && fuelDest > 0);
    this.flag('CHECK POS INIT', false);
    v.set(FUSION_VARS.msgLight(1), this.messages.length > 0 ? 1 : 0);
    v.set(FUSION_VARS.msgLight(2), this.messages.length > 0 ? 1 : 0);
  }

  private flag(text: string, on: boolean): void {
    if (on && !this.flags.has(text)) {
      this.flags.add(text);
      this.pushMessage(text);
    } else if (!on && this.flags.has(text)) {
      this.flags.delete(text);
      const i = this.messages.indexOf(text);
      if (i >= 0) this.messages.splice(i, 1);
    }
  }

  /** V-speed (kt) or 0. */
  vspd(id: 'v1' | 'vr' | 'v2' | 'vt' | 'vref' | 'vapp'): number {
    return this.vars.get(FUSION_VARS.vspd(id));
  }

  setVspd(id: 'v1' | 'vr' | 'v2' | 'vt' | 'vref' | 'vapp', kt: number): void {
    this.vars.set(FUSION_VARS.vspd(id), kt);
  }
}
