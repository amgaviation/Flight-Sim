/**
 * 737NG Flight Management Computer core (Smiths Aerospace / GE Aviation
 * FMC, U10.x software): the data behind the CDU pages, the modification /
 * EXEC logic, the performance functions and the outputs to the displays,
 * autothrottle and AFDS.
 *
 * Lateral / vertical guidance and the flight plan model come from
 * `nav/fms/Fms` in Boeing editing style: the first edit creates a MOD plan
 * that the active plan keeps flying until EXEC (`plans.exec()`) or ERASE.
 * This class adds what is specific to the 737 FMC:
 *
 *  - performance data (PERF INIT, PERF LIMITS, TAKEOFF REF, APPROACH REF)
 *    and the EST performance model of `data/perf.ts` (QRH-style V-speeds,
 *    ECON speeds from the cost index, optimum / maximum altitude);
 *  - performance modifications (cost index, cruise altitude, speed modes)
 *    that wait for EXEC like route modifications ("MOD" page titles, EXEC
 *    key light: FCOM 11.31 "Modifications");
 *  - the route ACTIVATE -> EXEC sequence of the pre-flight;
 *  - N1 limit selection (FCOM 11.32 "N1 LIMIT page"): take-off rating
 *    TO / TO-1 / TO-2 with an assumed temperature, climb rating CLB /
 *    CLB-1 / CLB-2 selected with it, automatic change to the climb rating
 *    at the thrust reduction height, derated climb washed out between
 *    10,000 and 15,000 ft (b737.org.uk FMC page: "reduced climb thrust is
 *    gradually phased out to max climb thrust by 15,000 ft"), CRZ at the
 *    top of climb, GA once the flaps are extended again in flight, manual
 *    selection in flight (GA / CON / CLB / CRZ). The result is sent to the
 *    aircraft ThrustRatingComputer with the `fadec.rating` event, so the
 *    aircraft's TRC must not run its own `auto` selection;
 *  - FMC messages (alerting: CDU MSG light + FMC alert light; advisory:
 *    MSG light) with the auto-clear logic of FCOM 11.60;
 *  - FIX INFO, hold data, DES NOW, the PLN-mode centre waypoint, the
 *    predicted T/C and T/D positions for the ND.
 *
 * SCOPE: one FMC (no dual FMC), one route (RTE 2 not provided), no RTA,
 * no lateral offset, no ENG OUT pages, no step climb, no wind forecasts
 * (winds are only used for display), no ACARS / uplinks.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { Subsystem } from '../../../aircraft/types';
import { ADC, ENV, FMS, GPS } from '../../../core/vars';
import { distanceNm, intermediatePoint } from '../../../core/geo';
import type { Fms } from '../../../nav/fms/Fms';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import type { PlanLeg } from '../../../nav/flightplan/types';
import { computePlanGeometry } from '../../../nav/flightplan/geometry';
import type { AirportProcedures, NavDatabase } from '../../../nav/types';
import type { FailureDef } from '../../../systems/failures/FailureManager';
import { compileCondition } from '../../../systems/util/binding';
import { failVar } from '../../../systems/util/ids';
import { ratingVar } from '../../../systems/fadec/ThrustRatingComputer';
import type { ResolvedB737Config } from '../config';
import type { FmcDisplayData, NdFixInfo } from '../cds/types';
import { abeamPoint } from './fixInfo';
import { B737_VARS, NdMode, type Side } from '../vars';
import { B738_SPEEDS, B738_WEIGHTS } from '../data/b738';
import { estimateN1Limit, isaTempC, type N1Rating } from '../data/cfm56';
import {
  DEFAULT_GW_KG,
  crossoverAltFt,
  econSpeeds,
  lrcMach,
  maxAngleClimbKt,
  maxRateClimbKt,
  maximumAltitudeFt,
  optimumAltitudeFt,
  takeoffSpeeds,
  takeoffTrimUnits,
  vref,
} from '../data/perf';

export type ClimbMode = 'ECON' | 'MAX RATE' | 'MAX ANGLE' | 'SEL';
export type CruiseMode = 'ECON' | 'LRC' | 'SEL';
export type DescentMode = 'ECON' | 'SEL';
export type TakeoffRating = 'TO' | 'TO-1' | 'TO-2';
export type ClimbRating = 'CLB' | 'CLB-1' | 'CLB-2';

/** A speed entry: IAS (kt) and/or Mach (NaN = not part of the entry). */
export interface SpeedPair {
  kt: number;
  mach: number;
}

/** Performance values that change only through EXEC once the route is active. */
export interface PerfModData {
  costIndex: number;
  crzAltFt: number;
  clbMode: ClimbMode;
  clbSel: SpeedPair;
  crzMode: CruiseMode;
  crzSel: SpeedPair;
  desMode: DescentMode;
  desSel: SpeedPair;
  /** Speed restriction (CLB / DES pages): kt at or below `altFt`; NaN kt = deleted. */
  clbRest: { kt: number; altFt: number };
  desRest: { kt: number; altFt: number };
}

/** FMC scratchpad / annunciator message. */
export interface FmcMessage {
  text: string;
  /** Alerting (MSG light + FMC alert light) or advisory (MSG light). */
  alert: boolean;
}

/** FIX INFO page data (one per FIX page). */
export interface FixInfo extends NdFixInfo {
  radials: number[];
  distancesNm: number[];
  abeam: boolean;
}

/** Speed-limit table of PERF LIMITS (min / max per phase; kt and Mach). */
export interface PerfLimits {
  clb: { minKt: number; minMach: number; maxKt: number; maxMach: number };
  crz: { minKt: number; minMach: number; maxKt: number; maxMach: number };
  des: { minKt: number; minMach: number; maxKt: number; maxMach: number };
}

export interface FmcEnv {
  vars: SimVars;
  events: EventBus;
  cfg: ResolvedB737Config;
  fms: Fms;
}

const DEFAULT_REST = { kt: 250, altFt: 10000 };
/** EST cost index used for predictions while none is entered (VNAV speeds must exist). */
const DEFAULT_CI = 30;
/** Default RNP (nm) by phase: oceanic 12.0, enroute 2.0, terminal 1.0, approach 0.5 (FCOM 11.40 RNP defaults as commonly quoted; EST). */
const RNP_DEFAULTS = { oceanic: 12, enroute: 2, terminal: 1, approach: 0.5 };
/** EST average climb gradient for the T/C prediction (ft per nm: ~2,000 fpm at ~380 kt GS). */
const CLIMB_FT_PER_NM = 320;

function cloneMod(m: PerfModData): PerfModData {
  return {
    ...m,
    clbSel: { ...m.clbSel },
    crzSel: { ...m.crzSel },
    desSel: { ...m.desSel },
    clbRest: { ...m.clbRest },
    desRest: { ...m.desRest },
  };
}

export class B737Fmc implements Subsystem, FmcDisplayData {
  readonly name = 'b737_fmc';
  readonly vars: SimVars;
  readonly events: EventBus;
  readonly cfg: ResolvedB737Config;
  readonly fms: Fms;
  readonly db: NavDatabase;

  // ------------------------------------------------------------ perf init
  zfwKg = NaN;
  reservesKg = NaN;
  /** PLAN fuel (entered before the fuel quantity is loaded), kg. */
  planFuelKg = NaN;
  crzCgPct = NaN;
  crzWind = { dir: NaN, kt: NaN };
  tcOatC = NaN;
  transAltFt = 18000;
  transLvlFt = 18000;
  flightNumber = '';
  coRoute = '';
  refAirport = '';
  limits: PerfLimits = {
    clb: { minKt: 100, minMach: 0.4, maxKt: B738_SPEEDS.vmoKt, maxMach: B738_SPEEDS.mmo },
    crz: { minKt: 100, minMach: 0.4, maxKt: B738_SPEEDS.vmoKt, maxMach: B738_SPEEDS.mmo },
    des: { minKt: 100, minMach: 0.4, maxKt: B738_SPEEDS.vmoKt, maxMach: B738_SPEEDS.mmo },
  };
  /** Executed performance data and the pending modification (null = none). */
  perf: PerfModData = {
    costIndex: NaN,
    crzAltFt: NaN,
    clbMode: 'ECON',
    clbSel: { kt: NaN, mach: NaN },
    crzMode: 'ECON',
    crzSel: { kt: NaN, mach: NaN },
    desMode: 'ECON',
    desSel: { kt: NaN, mach: NaN },
    clbRest: { ...DEFAULT_REST },
    desRest: { ...DEFAULT_REST },
  };
  perfMod: PerfModData | null = null;

  // ------------------------------------------------------------ take-off / approach
  toFlaps = NaN;
  toCgPct = NaN;
  /** Selected V-speeds (NaN = not selected). */
  v1Sel = NaN;
  vrSel = NaN;
  v2Sel = NaN;
  toRating: TakeoffRating = 'TO';
  clbRating: ClimbRating = 'CLB';
  /** Assumed temperature (°C) for reduced take-off thrust, NaN = none. */
  selTempC = NaN;
  rwWind = { dir: NaN, kt: NaN };
  rwSlopePct = NaN;
  rwWet = false;
  thrRedFt = 1500;
  accelHtFt = 3000;
  eoAccelHtFt = 1000;
  /** Selected approach flaps / VREF (NaN = none). */
  vrefFlaps = NaN;
  vrefSel = NaN;
  /** Manual N1 limit in flight (N1 LIMIT page), null = AUTO. */
  n1Manual: N1Rating | null = null;
  /** DES NOW selected (cleared at T/D or when the descent starts). */
  desNow = false;
  /** Hold: exit armed by EXEC. */
  exitHoldPending = false;
  exitHoldArmed = false;
  /** EFC time per hold leg id (UTC hours). */
  readonly efc = new Map<number, number>();
  /** FIX INFO pages. */
  readonly fixInfo: (FixInfo | null)[] = [null, null];
  /** PLN mode centre (plan leg index) set by STEP on the LEGS page; -1 = active waypoint. */
  planCenterIndex = -1;
  /** RNP entered on RNP PROGRESS (NaN = default). */
  rnpManual = NaN;
  /** Route ACTIVATE pressed (pre-flight; EXEC then makes the route active). */
  activatePending = false;
  /** Nav data identifier shown on IDENT. */
  navDataName = '';
  /** Gross weight entered on APPROACH REF (kg, NaN = current GW). */
  apprGwKg = NaN;
  /** DES FORECAST wind entries (stored and displayed only; SCOPE: not used by the VNAV path). */
  readonly desForecast: { altFt: number; dir: number; kt: number }[] = [
    { altFt: NaN, dir: NaN, kt: NaN },
    { altFt: NaN, dir: NaN, kt: NaN },
    { altFt: NaN, dir: NaN, kt: NaN },
  ];
  /** WPT/ALT target of the DES page (V/B computation); null = next constraint. */
  desWptAlt: { ident: string; altFt: number } | null = null;
  /** Last sequenced waypoint (PROGRESS FROM line). */
  lastPassed: { ident: string; altFt: number; utcH: number; fuelKg: number } | null = null;
  /** Current wind (deg magnetic FROM, kt) and head / cross components (+ = headwind / from the right). */
  readonly wind = { dirMag: NaN, kt: NaN, headKt: NaN, crossKt: NaN };

  // ------------------------------------------------------------ computed
  grossWeightKg = NaN;
  fuelKg = 0;
  qrh: { v1: number; vr: number; v2: number } | null = null;
  toTrim = NaN;
  econ = econSpeeds(DEFAULT_CI, DEFAULT_GW_KG, 35000);
  climbKt = 280;
  climbMach = 0.78;
  cruiseKt = 280;
  cruiseMach = 0.78;
  descentKt = 280;
  descentMach = 0.78;
  optAltFt = 35000;
  maxAltFt = 37000;
  /** N1 rating currently commanded (sent to the TRC). */
  activeRating: N1Rating = 'TO';
  /** Predicted positions for the ND. */
  readonly toc = { lat: NaN, lon: NaN };
  readonly tod = { lat: NaN, lon: NaN };
  tocDistNm = NaN;
  /** Incremented on data changes (CDU redraw hint). */
  version = 0;
  /** Alerting / advisory messages, oldest first. */
  readonly messages: FmcMessage[] = [];
  powered = true;
  /** The FMC alert light was reset by pushing it. */
  alertAcked = false;

  // ------------------------------------------------------------ private
  private readonly power: () => boolean;
  private readonly onGround: () => boolean;
  private readonly procCache = new Map<string, AirportProcedures | null | 'loading'>();
  private readonly condState = new Map<string, boolean>();
  private readonly offs: (() => void)[] = [];
  private readonly failV = failVar('b737.fmc');
  private modPlanRef: FlightPlan | null = null;
  private modVersion = -1;
  private sentRating = '';
  private sentAssumed = NaN;
  private wasGround = true;
  private climbStarted = false;
  private flapsBeenUp = false;
  private lastPhase = '';
  private lastPlanRef: FlightPlan | null = null;
  private lastActiveId = -1;

  constructor(env: FmcEnv) {
    this.vars = env.vars;
    this.events = env.events;
    this.cfg = env.cfg;
    this.fms = env.fms;
    this.db = env.fms.db;
    this.power = compileCondition(env.vars, env.cfg.power.fmc, true);
    this.onGround = compileCondition(env.vars, env.cfg.vars.onGround, true);
    this.navDataName = env.cfg.navDataName;
  }

  failures(): FailureDef[] {
    return [{ id: 'b737.fmc', name: 'FMC', category: 'avionics', description: 'FMC failed: CDU FAIL lights, LNAV / VNAV / FMC speed unavailable, V-speeds lost.' }];
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  reset(): void {
    this.sentRating = '';
    this.sentAssumed = NaN;
    this.wasGround = this.onGround();
    this.climbStarted = !this.wasGround;
    this.flapsBeenUp = !this.wasGround;
  }

  // =================================================================== plan access

  get plans(): Fms['plans'] {
    return this.fms.plans;
  }

  /** The plan shown on the route pages (MOD when pending, else active). */
  get plan(): FlightPlan {
    return this.fms.plans.displayed;
  }

  /** True once a route has been activated (EXEC after ACTIVATE). */
  get hasActiveRoute(): boolean {
    const a = this.fms.plans.active;
    return a.legs.length > 0 || a.origin !== null || a.destination !== null;
  }

  /** True while a route modification is shown as MOD (the route is active or ACTIVATE was pressed). */
  get routeModPending(): boolean {
    return this.fms.plans.pending && this.hasActiveRoute;
  }

  /** EXEC key light. */
  get execLight(): boolean {
    if (!this.powered) return false;
    return this.perfMod !== null || this.exitHoldPending || (this.fms.plans.pending && (this.hasActiveRoute || this.activatePending));
  }

  /** Title prefix for route pages: 'ACT ', 'MOD ' or '' (inactive route). */
  routeTitlePrefix(): string {
    if (!this.hasActiveRoute) return '';
    return this.fms.plans.pending ? 'MOD ' : 'ACT ';
  }

  /** Title prefix for performance pages. */
  perfTitlePrefix(): string {
    if (this.perfMod) return 'MOD ';
    return this.hasActiveRoute ? 'ACT ' : '';
  }

  /** Applies a route edit (creates the MOD plan) and refreshes the MOD geometry. */
  editPlan<T>(fn: (p: FlightPlan) => T): T {
    const r = this.fms.plans.apply(fn);
    this.modVersion = -1;
    this.version++;
    return r;
  }

  /** Performance data shown on the pages (MOD values when pending). */
  get pd(): PerfModData {
    return this.perfMod ?? this.perf;
  }

  /**
   * Edits performance data: immediately while no route is active (pre-flight),
   * otherwise as a modification awaiting EXEC.
   */
  editPerf(fn: (p: PerfModData) => void): void {
    if (!this.hasActiveRoute) {
      fn(this.perf);
    } else {
      if (!this.perfMod) this.perfMod = cloneMod(this.perf);
      fn(this.perfMod);
    }
    this.version++;
  }

  /** EXEC key. */
  exec(): boolean {
    if (!this.execLight) return false;
    const plans = this.fms.plans;
    if (plans.pending && (this.hasActiveRoute || this.activatePending)) {
      const explicit = plans.modified?.explicitActive ?? false;
      plans.exec();
      this.activatePending = false;
      // On the ground the route starts at its first leg again (e.g. after a SID / runway change);
      // LNAV activates the first flyable leg.
      if (this.ground && !explicit) plans.active.activeLegIndex = -1;
    }
    if (this.perfMod) {
      this.perf = this.perfMod;
      this.perfMod = null;
    }
    if (this.exitHoldPending) {
      this.exitHoldPending = false;
      this.exitHoldArmed = true;
      this.fms.exitHold();
    }
    this.syncCruiseAlt();
    this.version++;
    return true;
  }

  /** ERASE prompt: discards the route and performance modifications. */
  erase(): void {
    if (this.hasActiveRoute) this.fms.plans.erase();
    this.perfMod = null;
    this.exitHoldPending = false;
    this.version++;
  }

  /** ACTIVATE prompt on the RTE page. */
  activateRoute(): boolean {
    const p = this.fms.plans.displayed;
    if (!p.origin || !p.destination) return false;
    if (!this.fms.plans.pending) this.fms.plans.edit();
    this.activatePending = true;
    this.version++;
    return true;
  }

  /** Procedures of an airport (async load; 'loading' until available). */
  procedures(icao: string): AirportProcedures | null | 'loading' {
    const c = this.procCache.get(icao);
    if (c !== undefined) return c;
    if (!this.db.loadProcedures) {
      this.procCache.set(icao, null);
      return null;
    }
    this.procCache.set(icao, 'loading');
    this.db.loadProcedures(icao).then(
      (p) => {
        this.procCache.set(icao, p ?? null);
        this.version++;
      },
      () => {
        this.procCache.set(icao, null);
        this.version++;
      },
    );
    return 'loading';
  }

  // =================================================================== messages

  /** Posts an FMC message (both CDUs). Duplicates are ignored. */
  post(text: string, alert = true): void {
    if (this.messages.some((m) => m.text === text)) return;
    this.messages.push({ text, alert });
    if (alert) this.alertAcked = false;
    this.version++;
  }

  /** FMC alert light pushed (P/RST): the light goes out until the next alerting message. */
  acknowledgeAlert(): void {
    this.alertAcked = true;
  }

  removeMessage(text: string): void {
    const i = this.messages.findIndex((m) => m.text === text);
    if (i >= 0) {
      this.messages.splice(i, 1);
      this.version++;
    }
  }

  /** CLR on a CDU clears the oldest FMC message on both CDUs. */
  clearTopMessage(): boolean {
    if (this.messages.length === 0) return false;
    this.messages.shift();
    this.version++;
    return true;
  }

  /** Condition-driven message: posted on the rising edge, removed when the condition clears. */
  private cond(text: string, alert: boolean, active: boolean): void {
    const was = this.condState.get(text) ?? false;
    if (active && !was) this.post(text, alert);
    else if (!active && was) this.removeMessage(text);
    this.condState.set(text, active);
  }

  // =================================================================== sensor helpers

  get ground(): boolean {
    return this.onGround();
  }

  /** Pressure altitude (ft): ADC 1 uncorrected when STD, else the indicated altitude (close enough for performance). */
  get altFt(): number {
    return this.vars.get(ADC.baroAlt(this.cfg.adiru[0]));
  }

  /** Outside air (static) temperature (°C). */
  get oatC(): number {
    const v = this.vars;
    const a = this.cfg.adiru[0];
    if (v.has(ADC.sat(a))) return v.get(ADC.sat(a));
    if (v.has(ADC.tat(a))) return v.get(ADC.tat(a));
    return v.get(ENV.oatSeaLevelC, 15) - 0.0019812 * this.altFt;
  }

  get utcH(): number {
    const v = this.vars;
    return v.has(GPS.utcH) && v.getBool(GPS.valid) ? v.get(GPS.utcH) : v.get(ENV.timeUtcHours);
  }

  /** Gross weight used for performance (entered/computed, else the EST default). */
  get perfWeightKg(): number {
    return Number.isFinite(this.grossWeightKg) ? this.grossWeightKg : DEFAULT_GW_KG;
  }

  /** Cost index used for the speeds (entered, else EST default). */
  get effectiveCi(): number {
    const ci = this.pd.costIndex;
    return Number.isFinite(ci) ? ci : DEFAULT_CI;
  }

  /** Cruise altitude (ft) of the MOD / active data (NaN = none). */
  get crzAltFt(): number {
    return this.pd.crzAltFt;
  }

  /** N1 limit (%) of a rating from the aircraft TRC, else the EST model. */
  n1Limit(r: N1Rating, altFt = this.altFt, oatC = this.oatC): number {
    const id = this.cfg.n1RatingIds[r];
    const v = this.vars;
    const isTo = r === 'TO' || r === 'TO-1' || r === 'TO-2';
    const assumed = isTo && Number.isFinite(this.selTempC) ? this.selTempC : -99;
    // The TRC publishes every rating at the current conditions (with the assumed temperature applied to the active TO rating only).
    if (v.has(ratingVar(id)) && (!isTo || assumed === -99 || id === this.sentRating)) return v.get(ratingVar(id));
    return estimateN1Limit(r, altFt, oatC, assumed);
  }

  /**
   * TRIP altitude (PERF INIT): the highest altitude that still leaves a
   * short cruise segment on the route. EST: climb at ~320 ft/nm, descent at
   * ~300 ft/nm (3 deg), 50 nm of cruise; capped at the optimum altitude and
   * rounded down to 1,000 ft.
   */
  get tripAltFt(): number {
    const p = this.fms.plans.displayed;
    const i = p.lastNonMissedIndex;
    const d = i >= 0 ? p.legs[i].geom.cumDistNm : NaN;
    if (!(d > 0)) return NaN;
    const alt = Math.max(0, d - 50) / (1 / CLIMB_FT_PER_NM + 1 / 300);
    return Math.floor(Math.min(this.optAltFt, alt) / 1000) * 1000;
  }

  /** Landing elevation (ft) of the destination runway / airport; NaN = unknown. */
  get landingElevFt(): number {
    const p = this.fms.plans.active;
    const d = p.destination;
    if (!d) return NaN;
    if (p.arrivalRunway) {
      const rw = d.runways.find((r) => r.ident.replace(/^0(?=\d)/, '') === p.arrivalRunway!.replace(/^0(?=\d)/, '') || r.ident === p.arrivalRunway);
      if (rw && Number.isFinite(rw.elevationFt)) return rw.elevationFt;
    }
    return d.elevationFt;
  }

  get originElevFt(): number {
    const p = this.fms.plans.active;
    const o = p.origin ?? this.fms.plans.displayed.origin;
    if (!o) return NaN;
    const rwId = p.departureRunway;
    if (rwId) {
      const rw = o.runways.find((r) => r.ident === rwId);
      if (rw && Number.isFinite(rw.elevationFt)) return rw.elevationFt;
    }
    return o.elevationFt;
  }

  // =================================================================== FmcDisplayData

  get fixes(): readonly NdFixInfo[] {
    const out: NdFixInfo[] = [];
    for (const f of this.fixInfo) {
      if (!f) continue;
      if (!f.abeam) {
        out.push(f);
        continue;
      }
      // The abeam point is drawn as one more radial.
      const ab = abeamPoint(this.fms.plans.active, f.lat, f.lon, f.magVar, this.fms.alongNm, this.perf.crzAltFt);
      out.push(ab ? { ...f, radials: [...f.radials, ab.radialMag] } : f);
    }
    return out;
  }
  get v1(): number {
    return this.v1Sel;
  }
  get vr(): number {
    return this.vrSel;
  }
  get v2(): number {
    return this.v2Sel;
  }
  get vref(): number {
    return this.vrefSel;
  }
  get vSpeedsSet(): boolean {
    return Number.isFinite(this.v1Sel) && Number.isFinite(this.vrSel) && Number.isFinite(this.v2Sel);
  }
  get approachCourseTrue(): number {
    const p = this.fms.plans.active;
    const ap = p.approachProcedure;
    if (ap && Number.isFinite(ap.navCourseTrue)) return ap.navCourseTrue!;
    const d = p.destination;
    if (d && p.arrivalRunway) {
      const rw = d.runways.find((r) => r.ident === p.arrivalRunway);
      if (rw) return rw.headingTrue;
    }
    return NaN;
  }

  // =================================================================== take-off data

  /** Deletes the selected take-off speeds after a change of take-off data (FCOM: TAKEOFF SPEEDS DELETED). */
  invalidateVspeeds(): void {
    if (!this.ground) return;
    if (Number.isFinite(this.v1Sel) || Number.isFinite(this.vrSel) || Number.isFinite(this.v2Sel)) {
      this.v1Sel = NaN;
      this.vrSel = NaN;
      this.v2Sel = NaN;
      this.post('TAKEOFF SPEEDS DELETED', true);
    }
    this.version++;
  }

  setTakeoffRating(r: TakeoffRating): void {
    if (r !== this.toRating) {
      this.toRating = r;
      // Selecting a take-off derate selects the matching reduced climb (FCOM 11.32; EST pairing).
      this.clbRating = r === 'TO-1' ? 'CLB-1' : r === 'TO-2' ? 'CLB-2' : 'CLB';
      this.invalidateVspeeds();
    }
  }

  /** Selected-temperature entry (°C); NaN deletes. Returns false when invalid. */
  setSelTemp(c: number): boolean {
    if (Number.isFinite(c)) {
      // Must be above the OAT and within the engine's assumed-temperature range (EST upper limit +70 °C).
      if (c <= this.oatC || c > 70) return false;
    }
    this.selTempC = c;
    this.invalidateVspeeds();
    return true;
  }

  // =================================================================== fix info

  setFix(i: number, ident: string): boolean {
    const lat = this.vars.get(GPS.lat);
    const lon = this.vars.get(GPS.lon);
    const all = this.db.resolve(ident, lat, lon);
    const w = all.find((x) => x.ident === ident) ?? all[0];
    if (!w) return false;
    const ap = this.db.airport(ident);
    const mv = w.navaid?.magVar ?? ap?.magVar ?? this.vars.get(GPS.magVar);
    this.fixInfo[i] = { ident: w.ident, lat: w.lat, lon: w.lon, magVar: mv, radials: [NaN, NaN, NaN], distancesNm: [NaN, NaN, NaN], abeam: false };
    this.version++;
    return true;
  }

  // =================================================================== update

  update(dt: number): void {
    const v = this.vars;
    this.powered = this.power() && v.get(this.failV) === 0;
    v.set(B737_VARS.fmcFailed, this.powered ? 0 : 1);
    for (const s of [1, 2] as Side[]) v.set(B737_VARS.cduFailLight(s), this.powered ? 0 : 1);
    if (!this.powered) {
      v.set(B737_VARS.fmcExecLight, 0);
      v.set(B737_VARS.cduMsgLight(1), 0);
      v.set(B737_VARS.cduMsgLight(2), 0);
      v.set(B737_VARS.fmcAlertLight, (v.get(B737_VARS.discLightTest) !== 0 || v.get(B737_VARS.discLightTest2, 0) !== 0) ? 2 : 0);
      return;
    }
    const ground = this.ground;
    this.syncCruiseAlt();
    this.updateModGeometry();
    this.updateWeights();
    this.updateSpeeds();
    this.updateRating(ground);
    this.updateTocTod();
    this.updateMessages(ground, dt);
    this.updateWind();
    this.updatePassed();
    // Plan changes clear a stale PLN centre.
    const plan = this.fms.plans.displayed;
    if (plan !== this.lastPlanRef) {
      this.lastPlanRef = plan;
      if (this.planCenterIndex >= plan.legs.length) this.planCenterIndex = -1;
    }
    if (!ground && this.wasGround) {
      // Lift-off: take-off data is kept for the flight; DES NOW / hold exit states reset.
      this.desNow = false;
    }
    if (ground && !this.wasGround) {
      // Landing: clear flight-phase states (FCOM: flight complete clears perf data after 30 s on the ground; simplified).
      this.desNow = false;
      this.exitHoldArmed = false;
      this.n1Manual = null;
    }
    this.wasGround = ground;
    this.writeVars();
  }

  /** Keeps the plans' cruise altitude equal to the executed / MOD cruise altitude. */
  private syncCruiseAlt(): void {
    const plans = this.fms.plans;
    // A loaded route (route string speed/level group) provides the initial cruise altitude.
    if (!Number.isFinite(this.perf.crzAltFt)) {
      const c = plans.displayed.cruiseAltFt;
      if (c > 0) {
        this.perf.crzAltFt = c;
        if (this.perfMod) this.perfMod.crzAltFt = c;
      }
    }
    const act = this.perf.crzAltFt;
    if (Number.isFinite(act) && plans.active.cruiseAltFt !== act) {
      plans.active.cruiseAltFt = act;
      plans.active.touch();
    }
    const m = plans.modified;
    const mc = this.pd.crzAltFt;
    if (m && Number.isFinite(mc) && m.cruiseAltFt !== mc) {
      m.cruiseAltFt = mc;
      m.touch();
    }
  }

  /** Geometry of the MOD plan (the Fms only builds the active plan). */
  private updateModGeometry(): void {
    const m = this.fms.plans.modified;
    if (!m) {
      this.modPlanRef = null;
      return;
    }
    if (m === this.modPlanRef && m.version === this.modVersion) return;
    const v = this.vars;
    const gs = v.get(GPS.gs);
    computePlanGeometry(m, {
      groundSpeedKt: gs > 80 ? gs : 250,
      startAltFt: this.altFt,
      cruiseAltFt: m.cruiseAltFt,
    });
    this.modPlanRef = m;
    this.modVersion = m.version;
  }

  private updateWeights(): void {
    const v = this.vars;
    const c = this.cfg.vars;
    let fuel = v.get(c.fuelTotalKg, NaN);
    if (!Number.isFinite(fuel)) fuel = v.get(c.fuelLeftKg) + v.get(c.fuelRightKg) + v.get(c.fuelCenterKg);
    this.fuelKg = fuel;
    this.grossWeightKg = Number.isFinite(this.zfwKg) ? this.zfwKg + fuel : NaN;
    const w = this.perfWeightKg;
    // QRH take-off speeds (EST model) for the selected flaps at the origin conditions.
    const alt = this.ground ? this.altFt : Number.isFinite(this.originElevFt) ? this.originElevFt : 0;
    this.qrh = Number.isFinite(this.grossWeightKg) && Number.isFinite(this.toFlaps) ? takeoffSpeeds(w, this.toFlaps, alt, this.oatC) : null;
    this.toTrim = Number.isFinite(this.toCgPct) && Number.isFinite(this.toFlaps) ? takeoffTrimUnits(this.toCgPct, this.toFlaps, w) : NaN;
    this.optAltFt = optimumAltitudeFt(w);
    this.maxAltFt = maximumAltitudeFt(w);
  }

  private updateSpeeds(): void {
    const w = this.perfWeightKg;
    const pd = this.perf; // guidance uses the executed data
    const crz = Number.isFinite(pd.crzAltFt) ? pd.crzAltFt : 35000;
    const ci = Number.isFinite(pd.costIndex) ? pd.costIndex : DEFAULT_CI;
    const e = econSpeeds(ci, w, crz);
    this.econ = e;
    const L = this.limits;
    const clampKt = (kt: number, l: PerfLimits['clb']): number => Math.max(l.minKt, Math.min(l.maxKt, kt));
    const clampM = (m: number, l: PerfLimits['clb']): number => Math.max(l.minMach, Math.min(l.maxMach, m));
    // Climb
    let cKt = e.climbKt;
    let cM = e.climbMach;
    if (pd.clbMode === 'MAX RATE') {
      cKt = maxRateClimbKt(w);
      cM = 0.76;
    } else if (pd.clbMode === 'MAX ANGLE') {
      cKt = maxAngleClimbKt(w);
      cM = 0.7;
    } else if (pd.clbMode === 'SEL') {
      if (Number.isFinite(pd.clbSel.kt)) cKt = pd.clbSel.kt;
      if (Number.isFinite(pd.clbSel.mach)) cM = pd.clbSel.mach;
    }
    this.climbKt = clampKt(cKt, L.clb);
    this.climbMach = clampM(cM, L.clb);
    // Cruise
    let rKt = e.cruiseKt;
    let rM = e.cruiseMach;
    if (pd.crzMode === 'LRC') rM = lrcMach(w, crz);
    else if (pd.crzMode === 'SEL') {
      if (Number.isFinite(pd.crzSel.kt)) rKt = pd.crzSel.kt;
      if (Number.isFinite(pd.crzSel.mach)) rM = pd.crzSel.mach;
    }
    this.cruiseKt = clampKt(rKt, L.crz);
    this.cruiseMach = clampM(rM, L.crz);
    // Descent
    let dKt = e.descentKt;
    let dM = e.descentMach;
    if (pd.desMode === 'SEL') {
      if (Number.isFinite(pd.desSel.kt)) dKt = pd.desSel.kt;
      if (Number.isFinite(pd.desSel.mach)) dM = pd.desSel.mach;
    }
    this.descentKt = clampKt(dKt, L.des);
    this.descentMach = clampM(dM, L.des);
    // Approach: VREF + 5 kt (Boeing minimum wind additive; FCOM NP "Approach speed") with the selected VREF, else VREF 30 at the current weight.
    const vr = Number.isFinite(this.vrefSel) ? this.vrefSel : vref(w, 30);
    const phase = this.fms.vnav.phase;
    const xover =
      phase === 'CLB' ? crossoverAltFt(this.climbKt, this.climbMach) : phase === 'DES' ? crossoverAltFt(this.descentKt, this.descentMach) : crossoverAltFt(this.cruiseKt, this.cruiseMach);
    this.fms.setSpeeds({
      climbKt: this.climbKt,
      climbMach: this.climbMach,
      cruiseKt: this.cruiseKt,
      cruiseMach: this.cruiseMach,
      descentKt: this.descentKt,
      descentMach: this.descentMach,
      approachKt: Number.isFinite(vr) ? vr + 5 : 150,
      machTransitionFt: xover,
    });
  }

  /** Thrust reduction / climb / cruise / go-around N1 rating selection (see the file header). */
  private updateRating(ground: boolean): void {
    const v = this.vars;
    const flaps = v.get(this.cfg.vars.flapsDeg);
    let r: N1Rating;
    if (ground) {
      this.climbStarted = false;
      this.flapsBeenUp = false;
      r = this.toRating;
    } else {
      const elev = this.originElevFt;
      const agl = Number.isFinite(elev) ? this.altFt - elev : v.get('ra1.alt_ft', this.altFt);
      if (!this.climbStarted && agl >= this.thrRedFt) this.climbStarted = true;
      if (flaps < 0.5 && this.climbStarted) this.flapsBeenUp = true;
      if (this.n1Manual) r = this.n1Manual;
      else if (!this.climbStarted) r = this.toRating;
      else if (this.flapsBeenUp && flaps >= 0.5) r = 'GA';
      else {
        const phase = this.fms.vnav.phase;
        const crz = this.perf.crzAltFt;
        const atCruise = Number.isFinite(crz) && this.altFt >= crz - 500;
        if (phase === 'DES' || phase === 'APR' || (phase === 'CRZ' && this.hasActiveRoute) || atCruise) r = 'CRZ';
        else r = this.washedClimb();
      }
    }
    this.activeRating = r;
    const id = this.cfg.n1RatingIds[r];
    if (id !== this.sentRating) {
      this.sentRating = id;
      this.events.emit('fadec.rating', id);
    }
    const isTo = r === 'TO' || r === 'TO-1' || r === 'TO-2';
    const assumed = isTo && Number.isFinite(this.selTempC) ? this.selTempC : -99;
    if (assumed !== this.sentAssumed) {
      this.sentAssumed = assumed;
      this.events.emit('fadec.assumed_temp', assumed);
    }
  }

  /** Derated climb washed out linearly between 10,000 and 15,000 ft (nearest rating step). */
  private washedClimb(): N1Rating {
    const alt = this.altFt;
    const pts = this.clbRating === 'CLB-2' ? 20 : this.clbRating === 'CLB-1' ? 10 : 0;
    const frac = alt <= 10000 ? 1 : alt >= 15000 ? 0 : (15000 - alt) / 5000;
    const red = pts * frac;
    if (red > 15) return 'CLB-2';
    if (red > 5) return 'CLB-1';
    return 'CLB';
  }

  /** Point at an along-plan distance (nm) on the active plan geometry. */
  private pointAt(plan: FlightPlan, d: number, out: { lat: number; lon: number }): boolean {
    for (const l of plan.legs) {
      const g = l.geom;
      if (!g.valid || l.type === 'DISCO' || l.segment === 'missed') continue;
      const start = g.cumDistNm - g.lengthNm;
      if (d <= g.cumDistNm && g.lengthNm > 0) {
        const f = Math.max(0, Math.min(1, (d - start) / g.lengthNm));
        if (Number.isFinite(g.startLat) && Number.isFinite(g.endLat)) {
          intermediatePoint(g.startLat, g.startLon, g.endLat, g.endLon, f, out);
          return true;
        }
      }
    }
    return false;
  }

  private updateTocTod(): void {
    const plan = this.fms.plans.active;
    const prof = this.fms.vnav.profile;
    this.tod.lat = NaN;
    this.tod.lon = NaN;
    this.toc.lat = NaN;
    this.toc.lon = NaN;
    this.tocDistNm = NaN;
    if (plan.legs.length === 0) return;
    const along = this.fms.alongNm;
    if (prof.valid && Number.isFinite(prof.todDistNm) && prof.todDistNm > along) this.pointAt(plan, prof.todDistNm, this.tod);
    const crz = this.perf.crzAltFt;
    const phase = this.fms.vnav.phase;
    if (Number.isFinite(crz) && (this.ground || phase === 'CLB')) {
      const alt = this.ground ? (Number.isFinite(this.originElevFt) ? this.originElevFt : this.altFt) : this.altFt;
      const d = along + Math.max(0, crz - alt) / CLIMB_FT_PER_NM;
      if (!(prof.valid && d >= prof.todDistNm) && this.pointAt(plan, d, this.toc)) this.tocDistNm = d - along;
    }
  }

  private updateMessages(ground: boolean, _dt: number): void {
    const v = this.vars;
    // ENTER IRS POSITION: an IRS is aligning and has no present position (Irs: irs{s}.state 1 = aligning).
    let needPos = false;
    for (const s of this.cfg.adiru) if (v.get(`irs${s}.state`) === 1 && v.get(`irs${s}.pos_entered`) === 0 && v.has(`irs${s}.pos_entered`)) needPos = true;
    this.cond('ENTER IRS POSITION', true, needPos);
    // IRS NAV ONLY: GPS updating lost in flight (FCOM 11.60).
    this.cond('IRS NAV ONLY', true, !ground && this.hasActiveRoute && !v.getBool(GPS.valid) && v.has(GPS.valid));
    // UNABLE CRZ ALT: cruise altitude above the maximum altitude.
    const crz = this.perf.crzAltFt;
    this.cond('UNABLE CRZ ALT', true, Number.isFinite(crz) && crz > this.maxAltFt && !ground);
    // RESET MCP ALT: approaching T/D (within 5 nm, EST) with the MCP altitude not below the cruise altitude.
    const phase = this.fms.vnav.phase;
    const tod = v.get(FMS.todDistNm);
    const mcpAlt = v.get('ap.sel_alt_ft');
    this.cond('RESET MCP ALT', true, phase === 'CRZ' && !ground && tod > 0 && tod < 5 && mcpAlt >= this.altFt - 100);
    // DISCONTINUITY: LNAV reached a route discontinuity.
    const plan = this.fms.plans.active;
    const act = plan.activeLeg;
    const next = plan.legs[plan.activeLegIndex + 1];
    const disco = !ground && ((act?.type === 'DISCO') || (next?.type === 'DISCO' && v.get(FMS.distToWptNm) < 1 && v.get(FMS.suspended) !== 0));
    this.cond('DISCONTINUITY', true, disco);
    // END OF ROUTE: past the last waypoint.
    const eor = !ground && plan.legs.length > 0 && plan.activeLegIndex >= plan.legs.length - 1 && v.get(FMS.toFrom) < 0;
    this.cond('END OF ROUTE', true, eor);
    // APPRCH VREF NOT SELECTED: descending within 50 nm of the destination without a VREF (EST distance).
    const destD = v.get(FMS.distToDestNm);
    this.cond('APPRCH VREF NOT SELECTED', true, !ground && (phase === 'DES' || phase === 'APR') && destD > 0 && destD < 50 && !Number.isFinite(this.vrefSel));
    // USING RSV FUEL: predicted fuel at destination below the reserves.
    const fdest = v.get(FMS.fuelDestKg);
    this.cond('USING RSV FUEL', true, !ground && Number.isFinite(this.reservesKg) && fdest > 0 && fdest < this.reservesKg);
    // DRAG REQUIRED (advisory): on the descent path more than 150 ft high and 10 kt fast (EST thresholds).
    const ias = v.get(ADC.ias(this.cfg.adiru[0]));
    const tgt = v.get(FMS.vnavTargetSpeedKt);
    this.cond('DRAG REQUIRED', false, phase === 'DES' && v.get(FMS.vnavValid) !== 0 && v.get(FMS.vnavDevFt) > 150 && tgt > 0 && ias > tgt + 10);
    // DES NOW is cancelled once the aircraft is past T/D.
    if (this.desNow && (phase === 'DES' || phase === 'APR')) this.desNow = false;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.version++;
    }
    // The exit-armed state ends once the hold is no longer the active leg.
    if (this.exitHoldArmed && v.get(FMS.inHold) === 0) this.exitHoldArmed = false;
  }

  /** Wind from TAS / true heading vs GPS ground speed / track (the IRS wind of the real system). */
  private updateWind(): void {
    const v = this.vars;
    const a = this.cfg.adiru[0];
    const tas = v.get(ADC.tas(a));
    const gs = v.get(GPS.gs);
    const w = this.wind;
    if (tas < 100 || !v.getBool(GPS.valid)) {
      w.dirMag = NaN;
      w.kt = NaN;
      w.headKt = NaN;
      w.crossKt = NaN;
      return;
    }
    const D = Math.PI / 180;
    const hdg = v.get(ADC.headingTrue(a), v.get(ADC.heading(a)) + v.get(GPS.magVar));
    const trk = v.get(GPS.trackTrue);
    const wx = Math.sin(trk * D) * gs - Math.sin(hdg * D) * tas;
    const wy = Math.cos(trk * D) * gs - Math.cos(hdg * D) * tas;
    const ws = Math.hypot(wx, wy);
    const fromTrue = ((Math.atan2(-wx, -wy) / D) % 360 + 360) % 360;
    w.kt = ws;
    w.dirMag = ((fromTrue - v.get(GPS.magVar)) % 360 + 360) % 360;
    // Components relative to the heading: wind FROM direction vs heading.
    const rel = (fromTrue - hdg) * D;
    w.headKt = ws * Math.cos(rel);
    w.crossKt = ws * Math.sin(rel);
  }

  /** Records the waypoint just sequenced (PROGRESS page FROM line). */
  private updatePassed(): void {
    const plan = this.fms.plans.active;
    const leg = plan.activeLeg;
    const id = leg ? leg.id : -1;
    if (id === this.lastActiveId) return;
    const prev = plan.legs[plan.activeLegIndex - 1];
    if (this.lastActiveId !== -1 && prev?.fix && !this.ground) {
      this.lastPassed = { ident: prev.fix.ident, altFt: this.altFt, utcH: this.utcH, fuelKg: this.fuelKg };
    }
    this.lastActiveId = id;
  }

  private writeVars(): void {
    const v = this.vars;
    const n = (x: number, dflt = 0): number => (Number.isFinite(x) ? x : dflt);
    v.set(B737_VARS.fmcV1, n(this.v1Sel));
    v.set(B737_VARS.fmcVr, n(this.vrSel));
    v.set(B737_VARS.fmcV2, n(this.v2Sel));
    v.set(B737_VARS.fmcVref, n(this.vrefSel));
    v.set(B737_VARS.fmcVrefFlaps, n(this.vrefFlaps));
    v.set(B737_VARS.fmcToFlaps, n(this.toFlaps, -1));
    v.set(B737_VARS.fmcGwKg, n(this.grossWeightKg));
    v.set(B737_VARS.fmcZfwKg, n(this.zfwKg));
    v.set(B737_VARS.fmcCostIndex, n(this.perf.costIndex, -1));
    v.set(B737_VARS.fmcTransAltFt, this.transAltFt);
    v.set(B737_VARS.fmcTransLvlFt, this.transLvlFt);
    v.set(B737_VARS.fmcLandingElevFt, n(this.landingElevFt, -9999));
    v.set(B737_VARS.fmcOriginElevFt, n(this.originElevFt, -9999));
    v.set(B737_VARS.fmcExecLight, this.execLight ? 1 : 0);
    const gpsOk = v.getBool(GPS.valid);
    const anp = gpsOk ? Math.max(0.01, v.get(GPS.epuNm, 0.05)) : Math.max(0.1, v.get(`irs${this.cfg.adiru[0]}.pos_err_nm`, 1));
    v.set(B737_VARS.fmcAnpNm, anp);
    v.set(B737_VARS.fmcRnpNm, this.rnp());
    v.set(B737_VARS.fmcPosSource, gpsOk ? 1 : 0);
    v.set(B737_VARS.fmcPlanCtrLeg, this.planCenterIndex);
    v.setString(B737_VARS.fmcClbMode, this.perf.clbMode);
    v.setString(B737_VARS.fmcCrzMode, this.perf.crzMode);
    v.setString(B737_VARS.fmcDesMode, this.perf.desMode);
    v.set(B737_VARS.fmcDesNow, this.desNow ? 1 : 0);
    v.set(B737_VARS.fmcThrRedFt, this.thrRedFt);
    v.set(B737_VARS.fmcAccelHtFt, this.accelHtFt);
    v.setString(B737_VARS.fmcN1Rating, this.activeRating);
    v.set(B737_VARS.fmcPerfValid, Number.isFinite(this.grossWeightKg) && Number.isFinite(this.perf.costIndex) && Number.isFinite(this.perf.crzAltFt) ? 1 : 0);
    const any = this.messages.length > 0;
    const alert = this.messages.some((m) => m.alert);
    v.set(B737_VARS.cduMsgLight(1), any ? 1 : 0);
    v.set(B737_VARS.cduMsgLight(2), any ? 1 : 0);
    // FMC alert light (amber) on the autoflight status annunciator; the TEST switch lights it too.
    v.set(B737_VARS.fmcAlertLight, (alert && !this.alertAcked) || (v.get(B737_VARS.discLightTest) !== 0 || v.get(B737_VARS.discLightTest2, 0) !== 0) ? 2 : 0);
  }

  /** Current RNP (nm): manual entry, else the phase default. */
  rnp(): number {
    if (Number.isFinite(this.rnpManual)) return this.rnpManual;
    const v = this.vars;
    if (v.get(FMS.approachActive) !== 0) return RNP_DEFAULTS.approach;
    const plan = this.fms.plans.active;
    const seg = plan.activeLeg?.segment;
    if (seg === 'departure' || seg === 'arrival' || seg === 'approach' || seg === 'origin') return RNP_DEFAULTS.terminal;
    const mode = v.getString(FMS.approachMode);
    if (mode === 'OCN') return RNP_DEFAULTS.oceanic;
    return RNP_DEFAULTS.enroute;
  }

  /** True while either ND is in PLN mode (LEGS page STEP prompt). */
  get plnMode(): boolean {
    return this.vars.get(B737_VARS.efisMode(1)) === NdMode.Pln || this.vars.get(B737_VARS.efisMode(2)) === NdMode.Pln;
  }

  /** Distance (nm) from the aircraft to a leg's end along the active route (NaN when behind or not in the active plan). */
  distToLeg(plan: FlightPlan, i: number): number {
    const perf = this.fms.perf;
    if (plan === this.fms.plans.active && i < perf.count && i >= plan.activeLegIndex) return perf.distNm[i];
    const leg = plan.legs[i];
    if (!leg) return NaN;
    return Math.max(0, leg.geom.cumDistNm - this.fms.alongNm);
  }

  /** ETA (UTC hours) at a leg end of the active plan, NaN when unknown. */
  etaLeg(plan: FlightPlan, i: number): number {
    const perf = this.fms.perf;
    if (plan === this.fms.plans.active && i < perf.count && i >= plan.activeLegIndex) return perf.etaUtcH[i];
    const gs = this.vars.get(GPS.gs);
    const d = this.distToLeg(plan, i);
    return gs > 20 && Number.isFinite(d) ? (this.utcH + d / gs) % 24 : NaN;
  }

  /** Predicted fuel (kg) at a leg end of the active plan. */
  fuelLeg(plan: FlightPlan, i: number): number {
    const perf = this.fms.perf;
    if (plan === this.fms.plans.active && i < perf.count && i >= plan.activeLegIndex) return perf.fuelKg[i];
    return NaN;
  }

  /** Straight distance (nm) from the aircraft to a leg fix. */
  directDistNm(leg: PlanLeg): number {
    const f = leg.fix;
    if (!f) return NaN;
    return distanceNm(this.vars.get(GPS.lat), this.vars.get(GPS.lon), f.lat, f.lon);
  }

  /** ISA deviation (°C) at the current altitude. */
  get isaDevC(): number {
    return this.oatC - isaTempC(this.altFt);
  }

  /** Maximum operating weight check helpers for entries. */
  static readonly limits = B738_WEIGHTS;
}
