/**
 * Small state models behind GTC pages: generic timer, V-speed bank,
 * minimums (incl. temperature compensation), TOLD (takeoff / landing data),
 * weight & fuel, electronic checklists and system messages.
 * Pure TypeScript (no canvas), unit tested in tests/avionics/garmin-g3000.
 */
import type { SimVars } from '../../../core/SimVars';
import type { Checklist } from '../../../aircraft/types';
import { KG_TO_LB } from '../../../core/units';
import type { LandingInput, LandingResult, PerformanceProvider, TakeoffInput, TakeoffResult, VSpeedDef, WeightsConfig } from '../config';
import { G3K, MINS_MODE } from '../vars';

// ------------------------------------------------------------------ timer

/**
 * PFD generic timer (PG 190-02046-01 §1.7 "Timer"): counts up or down from a
 * preset; counting down past zero continues counting up (Garmin behaviour,
 * "timer reaches zero ... begins counting up"). Values live in SimVars so the
 * PFD TMR field and both GTCs agree.
 */
export class GenericTimer {
  constructor(private readonly vars: SimVars) {
    if (!vars.has(G3K.timerDir)) vars.set(G3K.timerDir, 1);
  }
  get seconds(): number {
    return this.vars.get(G3K.timerS);
  }
  get running(): boolean {
    return this.vars.get(G3K.timerRunning) !== 0;
  }
  get countingDown(): boolean {
    return this.vars.get(G3K.timerDir) < 0;
  }
  start(): void {
    this.vars.set(G3K.timerRunning, 1);
  }
  stop(): void {
    this.vars.set(G3K.timerRunning, 0);
  }
  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }
  /** Resets to the preset (down) or zero (up) and stops. */
  reset(): void {
    this.stop();
    this.vars.set(G3K.timerS, this.countingDown ? this.vars.get(G3K.timerPreset) : 0);
  }
  setDirection(down: boolean): void {
    this.vars.set(G3K.timerDir, down ? -1 : 1);
    if (!this.running) this.vars.set(G3K.timerS, down ? this.vars.get(G3K.timerPreset) : 0);
  }
  setPreset(seconds: number): void {
    const s = Math.max(0, Math.min(23 * 3600 + 59 * 60 + 59, Math.round(seconds)));
    this.vars.set(G3K.timerPreset, s);
    if (!this.running && this.countingDown) this.vars.set(G3K.timerS, s);
  }
  update(dt: number): void {
    if (!this.running) return;
    let s = this.seconds;
    if (this.countingDown) {
      s -= dt;
      if (s <= 0) {
        // Count-down expired: continue counting up from zero.
        s = -s;
        this.vars.set(G3K.timerDir, 1);
      }
    } else s += dt;
    this.vars.set(G3K.timerS, s);
  }
}

// ------------------------------------------------------------------ V-speeds

export type VSpeedSource = 'default' | 'pilot' | 'told';

/**
 * V-speed reference bugs (PG §2.1 "Airspeed Indicator": values can be changed
 * and flags turned on/off on the Speed Bugs screen; all values reset and flags
 * off at power-up; "Restore All Defaults"). Values and flags are published as
 * `g3k.vspd.<id>.kt` / `.on` / `.src` (0 default, 1 pilot, 2 TOLD).
 */
export class VSpeedBank {
  readonly defs: readonly VSpeedDef[];
  constructor(private readonly vars: SimVars, defs: readonly VSpeedDef[]) {
    this.defs = defs;
    this.restoreDefaults();
  }
  value(id: string): number {
    return this.vars.get(G3K.vspeedKt(id), NaN);
  }
  on(id: string): boolean {
    return this.vars.get(G3K.vspeedOn(id)) !== 0;
  }
  source(id: string): VSpeedSource {
    const s = this.vars.get(G3K.vspeedSrc(id));
    return s === 1 ? 'pilot' : s === 2 ? 'told' : 'default';
  }
  set(id: string, kt: number, src: VSpeedSource = 'pilot'): void {
    this.vars.set(G3K.vspeedKt(id), kt);
    this.vars.set(G3K.vspeedSrc(id), src === 'pilot' ? 1 : src === 'told' ? 2 : 0);
  }
  /** A bug can be enabled only when it has a value. */
  setOn(id: string, on: boolean): boolean {
    if (on && !Number.isFinite(this.value(id))) return false;
    this.vars.set(G3K.vspeedOn(id), on ? 1 : 0);
    return true;
  }
  toggle(id: string): boolean {
    return this.setOn(id, !this.on(id));
  }
  setGroup(group: VSpeedDef['group'] | 'all', on: boolean): void {
    for (const d of this.defs) if (group === 'all' || d.group === group) this.setOn(d.id, on);
  }
  restoreDefaults(): void {
    for (const d of this.defs) {
      this.vars.set(G3K.vspeedKt(d.id), d.defaultKt ?? NaN);
      this.vars.set(G3K.vspeedOn(d.id), 0);
      this.vars.set(G3K.vspeedSrc(d.id), 0);
    }
  }
  /** Applies TOLD results (values from the performance computation, bugs on). */
  applyTold(values: Record<string, number>): void {
    for (const d of this.defs) {
      const v = values[d.id];
      if (v === undefined || !Number.isFinite(v)) continue;
      this.set(d.id, v, 'told');
      this.setOn(d.id, true);
    }
  }
}

// ------------------------------------------------------------------ minimums

/**
 * Temperature-compensated minimums: ICAO PANS-OPS (Doc 8168 Vol I Part III
 * §1.4) approximation of the cold-temperature altimeter error,
 *   dH = H x (ISA_ad - t_ad) / (273 + t_ad),
 * with H the height above the aerodrome and ISA_ad the ISA temperature at the
 * aerodrome elevation (15 - 1.98 C / 1000 ft). EST: the G3000 uses the full
 * PANS-OPS formula; the approximation differs by < 2 % below 5,000 ft AGL.
 * Only corrects for colder than ISA (no correction when warmer).
 */
export function tempCompCorrectionFt(minsFt: number, aerodromeElevFt: number, tempC: number): number {
  const h = Math.max(0, minsFt - aerodromeElevFt);
  const isa = 15 - 0.0019812 * aerodromeElevFt;
  const dev = isa - tempC;
  if (dev <= 0) return 0;
  return (h * dev) / (273.15 + tempC);
}

/**
 * Minimums (PG §2.4 "MDA/DH Alerting"): Off / Baro / Temp Comp / Radio Alt,
 * 0..16,000 ft, synchronized on both PFDs, reset to Off at power cycle and
 * when another approach is activated. Published to `ap.mins{1,2}_ft` /
 * `ap.mins{1,2}_is_ra` for the TAWS MinimumsMonitor and the PFDs.
 */
export class MinimumsModel {
  destElevFt = 0;
  constructor(private readonly vars: SimVars) {}
  get mode(): number {
    return this.vars.get(G3K.minsMode);
  }
  get valueFt(): number {
    return this.vars.get(G3K.minsFt);
  }
  set(mode: number, ft?: number): void {
    this.vars.set(G3K.minsMode, mode);
    if (ft !== undefined) this.vars.set(G3K.minsFt, Math.max(0, Math.min(16000, Math.round(ft))));
    this.publish();
  }
  setTemp(c: number): void {
    this.vars.set(G3K.minsTempC, Math.max(-60, Math.min(60, Math.round(c))));
    this.publish();
  }
  reset(): void {
    this.vars.set(G3K.minsMode, MINS_MODE.off);
    this.publish();
  }
  /** Effective alerting altitude (ft) or NaN when off. */
  effectiveFt(): number {
    const m = this.mode;
    const v = this.valueFt;
    if (m === MINS_MODE.off) return NaN;
    if (m === MINS_MODE.tempComp) return v + tempCompCorrectionFt(v, this.destElevFt, this.vars.get(G3K.minsTempC, 15));
    return v;
  }
  publish(): void {
    const ft = this.effectiveFt();
    const ra = this.mode === MINS_MODE.radio ? 1 : 0;
    for (const s of [1, 2]) {
      this.vars.set(`ap.mins${s}_ft`, Number.isFinite(ft) ? ft : NaN);
      this.vars.set(`ap.mins${s}_is_ra`, ra);
    }
  }
}

// ------------------------------------------------------------------ TOLD

export interface ToldInputs {
  takeoff: TakeoffInput;
  landing: LandingInput;
}

/**
 * Takeoff and landing data (G5000 PERF > Takeoff Data / Landing Data; G5000
 * CRG 190-02538-02 "TOLD"): inputs auto-filled from the flight plan runway
 * and current conditions, computation by the aircraft's performance provider,
 * results sent to the PFD speed bugs and the N1 reference bug.
 */
export class ToldModel {
  readonly inputs: ToldInputs;
  takeoffResult: TakeoffResult | null = null;
  landingResult: LandingResult | null = null;
  takeoffConfirmed = false;
  landingConfirmed = false;
  constructor(private readonly vars: SimVars, readonly provider: PerformanceProvider | null) {
    const blank = { airport: '', runway: '', runwayLengthFt: 0, runwayElevFt: 0, runwayHeadingMag: 0, windDirMag: 0, windKt: 0, oatC: 15, qnhInHg: 29.92, weightLb: 0, antiIce: false, wet: false };
    this.inputs = {
      takeoff: { ...blank, flaps: provider?.takeoffFlaps[0] ?? '', slope: 0 },
      landing: { ...blank, flaps: provider?.landingFlaps[provider.landingFlaps.length - 1] ?? '' },
    };
  }
  computeTakeoff(): TakeoffResult | null {
    this.takeoffConfirmed = false;
    this.takeoffResult = this.provider ? this.provider.takeoff(this.inputs.takeoff) : null;
    this.vars.set(G3K.toldTakeoffValid, this.takeoffResult ? 1 : 0);
    return this.takeoffResult;
  }
  computeLanding(): LandingResult | null {
    this.landingConfirmed = false;
    this.landingResult = this.provider ? this.provider.landing(this.inputs.landing) : null;
    this.vars.set(G3K.toldLandingValid, this.landingResult ? 1 : 0);
    return this.landingResult;
  }
  /** Headwind (+) / crosswind (+ from the right) components for display. */
  static components(runwayHdg: number, windDir: number, windKt: number): { head: number; cross: number } {
    const a = ((windDir - runwayHdg) * Math.PI) / 180;
    return { head: windKt * Math.cos(a), cross: windKt * Math.sin(a) };
  }
}

// ------------------------------------------------------------------ weight & fuel

/**
 * Weight and Fuel (PG §5.10 "Weight and Fuel Planning"): basic operating
 * weight, crew & stores, passengers x standard weight, cargo -> zero fuel
 * weight; fuel on board from the fuel sensors -> gross weight; reserves and
 * the FMS fuel at destination -> estimated landing weight. Cautions (amber)
 * when a weight exceeds its limit (§5.10 "Weight Caution and Warning").
 */
export class WeightFuel {
  bowLb: number;
  crewStoresLb = 0;
  pax = 0;
  paxLb: number;
  cargoLb = 0;
  reserveLb = 0;
  constructor(private readonly vars: SimVars, readonly limits: WeightsConfig, private readonly fuelTotalVar: string) {
    this.bowLb = limits.basicOperatingLb;
    this.paxLb = limits.paxLb ?? 200;
  }
  get payloadLb(): number {
    return this.crewStoresLb + this.pax * this.paxLb + this.cargoLb;
  }
  get zfwLb(): number {
    return this.bowLb + this.payloadLb;
  }
  get fuelLb(): number {
    return this.vars.get(this.fuelTotalVar) * KG_TO_LB;
  }
  get grossLb(): number {
    return this.zfwLb + this.fuelLb;
  }
  /** Fuel at destination from the FMS prediction (lb), NaN when unknown. */
  get destFuelLb(): number {
    const kg = this.vars.get('fms.fuel_dest_kg', NaN);
    return Number.isFinite(kg) && kg > 0 ? kg * KG_TO_LB : NaN;
  }
  get landingLb(): number {
    const f = this.destFuelLb;
    return Number.isFinite(f) ? this.zfwLb + f : NaN;
  }
  /** 0 ok, 1 caution (exceeds limit) per weight. */
  over(which: 'zfw' | 'gross' | 'landing' | 'ramp'): boolean {
    const l = this.limits;
    if (which === 'zfw') return l.maxZeroFuelLb > 0 && this.zfwLb > l.maxZeroFuelLb;
    if (which === 'gross') return l.maxTakeoffLb > 0 && this.grossLb > l.maxTakeoffLb;
    if (which === 'ramp') return l.maxRampLb > 0 && this.grossLb > l.maxRampLb;
    const lw = this.landingLb;
    return l.maxLandingLb > 0 && Number.isFinite(lw) && lw > l.maxLandingLb;
  }
  publish(): void {
    const v = this.vars;
    v.set(G3K.wfBowLb, this.bowLb);
    v.set(G3K.wfPayloadLb, this.payloadLb);
    v.set(G3K.wfZfwLb, this.zfwLb);
    v.set(G3K.wfGwLb, this.grossLb);
    v.set(G3K.wfReserveLb, this.reserveLb);
    v.set(G3K.wfLandingLb, this.landingLb);
  }
}

// ------------------------------------------------------------------ checklists

/** Electronic checklist state (GTC Checklist screen + MFD checklist pane). */
export class ChecklistModel {
  readonly lists: readonly Checklist[];
  index = 0;
  cursor = 0;
  private readonly checked: boolean[][];
  constructor(lists: readonly Checklist[]) {
    this.lists = lists;
    this.checked = lists.map((l) => l.items.map(() => false));
  }
  get current(): Checklist | null {
    return this.lists[this.index] ?? null;
  }
  isChecked(item: number, list = this.index): boolean {
    return this.checked[list]?.[item] ?? false;
  }
  select(i: number): void {
    if (i >= 0 && i < this.lists.length) {
      this.index = i;
      this.cursor = Math.max(0, this.checked[i].findIndex((c) => !c));
    }
  }
  /** Toggles an item and moves the cursor to the next unchecked item. */
  toggle(item = this.cursor): void {
    const c = this.checked[this.index];
    if (!c || item < 0 || item >= c.length) return;
    c[item] = !c[item];
    if (c[item]) {
      const next = c.findIndex((v, k) => k > item && !v);
      this.cursor = next >= 0 ? next : item;
    } else this.cursor = item;
  }
  move(delta: number): void {
    const n = this.current?.items.length ?? 0;
    this.cursor = Math.max(0, Math.min(n - 1, this.cursor + delta));
  }
  complete(list = this.index): boolean {
    const c = this.checked[list];
    return !!c && c.length > 0 && c.every((v) => v);
  }
  checkedArray(list = this.index): readonly boolean[] {
    return this.checked[list] ?? [];
  }
  resetList(list = this.index): void {
    this.checked[list]?.fill(false);
    if (list === this.index) this.cursor = 0;
  }
  resetAll(): void {
    for (const c of this.checked) c.fill(false);
    this.cursor = 0;
  }
  next(): void {
    if (this.index < this.lists.length - 1) this.select(this.index + 1);
  }
}

// ------------------------------------------------------------------ system messages

export interface SystemMessage {
  id: string;
  text: string;
  active: boolean;
  read: boolean;
  seq: number;
}

/**
 * Avionics system messages (PG §2.4 "System Alerting": the MSG icon on the
 * PFD flashes until the messages are viewed on the GTC; messages whose
 * condition cleared turn grey).
 */
export class MessageList {
  readonly list: SystemMessage[] = [];
  private readonly byId = new Map<string, SystemMessage>();
  private seq = 0;
  set(id: string, text: string, on: boolean): void {
    let m = this.byId.get(id);
    if (!m) {
      if (!on) return;
      m = { id, text, active: false, read: false, seq: 0 };
      this.byId.set(id, m);
      this.list.push(m);
    }
    if (on && !m.active) {
      m.active = true;
      m.read = false;
      m.seq = ++this.seq;
      m.text = text;
      this.list.sort((a, b) => b.seq - a.seq);
    } else if (!on && m.active) m.active = false;
  }
  get unread(): number {
    let n = 0;
    for (const m of this.list) if (m.active && !m.read) n++;
    return n;
  }
  /** Viewing the message list: inactive messages already seen are dropped, the rest are marked read (inactive ones stay grey once). */
  markAllRead(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (!m.active && m.read) {
        this.byId.delete(m.id);
        this.list.splice(i, 1);
      }
    }
    for (const m of this.list) m.read = true;
  }
}
