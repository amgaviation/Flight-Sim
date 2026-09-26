/**
 * Pneumatic (bleed air) system: engine/APU/ground-cart bleed sources with
 * pressure-regulating shutoff valves, ducts joined by isolation/crossbleed
 * valves, consumers (wing/nacelle anti-ice, packs, air-turbine starters),
 * air-conditioning packs and cabin zone temperature control, leak/overheat
 * failures.
 *
 * Each update:
 *  1. PRSOVs and isolation valves move toward their commands (a bleed
 *     overheat failure trips the PRSOV closed until its reset edge).
 *  2. Ducts joined by open valves form groups. Each open source offers
 *     min(port pressure, regulated pressure) and a flow capacity that falls
 *     with low port pressure (HP-port switching at low engine power).
 *  3. Group pressure = best source pressure, drooping 15 % at full capacity
 *     and falling in proportion to the capacity/demand ratio when overloaded
 *     (EST first-order duct model); duct pressure lags with τ = ductLagS.
 *  4. Consumers get flow in proportion to duct pressure / their full-function
 *     pressure; the served flow is shared among the group's sources in
 *     proportion to capacity, and each engine's share is published as
 *     `eng{i}.bleed_extract` (0..1) for the engine model.
 *  5. Air-turbine starters: start valve open (command && valve power && not
 *     failed) drives `eng{i}.starter` with strength duct psi / nominalPsi
 *     through the shared starter PWM (util/starter.ts), and draws air.
 *  6. Packs deliver conditioned air (kg/s) to zones; each zone's controller
 *     commands the supply temperature needed to reach its selected
 *     temperature in ~2 min (pack outlet = coldest zone demand, trim air
 *     warms the others), and the zone temperature integrates supply,
 *     internal heat load and skin heat loss.
 *
 * Outputs (prefix default 'pneu.'):
 *   duct:     <duct>_psi, <duct>_leak
 *   source:   <src>_psi (port), <src>_valve_open, <src>_valve_pos, <src>_trip, <src>_flow_kgs, <src>_hp
 *   valve:    <valve>_pos, <valve>_open, <valve>_transit
 *   consumer: <id>_ok (0..1 delivered fraction; 1 = fully supplied), <id>_flow_kgs
 *   pack:     <pack>_on, <pack>_flow_kgs, <pack>_outlet_c, <pack>_trip; pack_flow_kgs (sum, for pressurization)
 *   zone:     <zone>_temp_c, <zone>_supply_c
 *   starter:  <id>_valve_open (START VALVE OPEN), <id>_strength (0..1)
 *   engines:  eng{i}.bleed_extract
 *
 * Failures: pneu.<src>.overheat (bleed trip), pneu.<duct>.leak,
 * pneu.<valve>.stuck, pneu.<pack>.overheat (pack trip), pneu.<starter>
 * (start valve fails closed), pneu.<starter>.open (start valve fails open).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { ENG, FDM } from '../../core/vars';
import { compileBinding, compileCondition, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { Actuator } from '../util/filters';
import { EdgeDetector } from '../util/timers';
import { StarterDriver } from '../util/starter';
import type { FailureDef } from '../failures/FailureManager';
import type { AirStarterDef, BleedSourceDef, PackDef, PneuConsumerDef, PneuValveDef, PneumaticConfig, ZoneDef } from './types';

const CP_AIR = 1005; // J/(kg K)
/** Duct droop at full source capacity (EST). */
const DROOP_AT_CAPACITY = 0.15;
/** Zone controller: supply temperature computed to close the error with this time constant (s) (EST). */
const ZONE_CTRL_TAU_S = 120;
/** Pack outlet temperature lag (s) (EST). */
const PACK_TEMP_TAU_S = 15;

class Source {
  /** Engine slot (bleed extract), -1 if not an engine port. */
  slot = -1;
  tripped = false;
  portPsi = 0;
  supplyPsi = 0;
  cap = 0;
  flow = 0;
  hpOpen = false;
  readonly act: Actuator;
  readonly resetEdge = new EdgeDetector();
  readonly o: Record<'psi' | 'valve_open' | 'valve_pos' | 'trip' | 'flow_kgs' | 'hp', string>;
  readonly failHot: string;
  readonly extractVar: string | null;
  constructor(
    readonly def: BleedSourceDef,
    readonly duct: number,
    readonly pressure: Evaluator,
    readonly valve: () => boolean,
    readonly reset: () => boolean,
    prefix: string,
  ) {
    this.act = new Actuator(def.travelS ?? 1.5, valve() ? 1 : 0);
    const p = `${prefix}${def.id}_`;
    this.o = { psi: `${p}psi`, valve_open: `${p}valve_open`, valve_pos: `${p}valve_pos`, trip: `${p}trip`, flow_kgs: `${p}flow_kgs`, hp: `${p}hp` };
    this.failHot = failVar(`pneu.${def.id}.overheat`);
    this.extractVar = def.engine !== undefined ? ENG.bleedExtract(def.engine) : null;
  }
}

class Valve {
  readonly act: Actuator;
  readonly o: Record<'pos' | 'open' | 'transit', string>;
  readonly fail: string;
  constructor(
    readonly def: PneuValveDef,
    readonly a: number,
    readonly b: number,
    readonly cmd: () => boolean,
    readonly power: () => boolean,
    prefix: string,
  ) {
    this.act = new Actuator(def.travelS ?? 3, cmd() ? 1 : 0);
    this.o = { pos: `${prefix}${def.id}_pos`, open: `${prefix}${def.id}_open`, transit: `${prefix}${def.id}_transit` };
    this.fail = failVar(`pneu.${def.id}.stuck`);
  }
}

class Consumer {
  demand = 0;
  ok = 0;
  flow = 0;
  readonly o: Record<'ok' | 'flow_kgs', string>;
  constructor(
    readonly def: PneuConsumerDef,
    readonly duct: number,
    /** Engine slot (index into the extract arrays) when drawing directly from an engine. */
    readonly engine: number,
    readonly demandEv: Evaluator,
    readonly enginePsi: Evaluator | null,
    readonly minPsi: number,
    prefix: string,
  ) {
    this.o = { ok: `${prefix}${def.id}_ok`, flow_kgs: `${prefix}${def.id}_flow_kgs` };
  }
}

class Pack {
  on = false;
  tripped = false;
  flow = 0;
  demand = 0;
  outletC: number;
  cmdC = 20;
  zones = 0;
  /** Zones this pack supplies. */
  readonly zoneIdx: number[] = [];
  readonly resetEdge = new EdgeDetector();
  readonly o: Record<'on' | 'flow_kgs' | 'outlet_c' | 'trip', string>;
  readonly failHot: string;
  constructor(
    readonly def: PackDef,
    readonly duct: number,
    readonly onEv: () => boolean,
    readonly flowEv: Evaluator,
    readonly reset: () => boolean,
    prefix: string,
  ) {
    const p = `${prefix}${def.id}_`;
    this.o = { on: `${p}on`, flow_kgs: `${p}flow_kgs`, outlet_c: `${p}outlet_c`, trip: `${p}trip` };
    this.failHot = failVar(`pneu.${def.id}.overheat`);
    this.outletC = 20;
  }
}

class Zone {
  tempC: number;
  supplyC: number;
  cmdC = 20;
  readonly packs: number[];
  readonly heatCap: number;
  readonly ua: number;
  readonly o: Record<'temp_c' | 'supply_c', string>;
  constructor(
    readonly def: ZoneDef,
    packs: number[],
    readonly target: Evaluator,
    readonly heatLoad: Evaluator,
    readonly skin: Evaluator,
    prefix: string,
    vars: SimVars,
  ) {
    this.packs = packs;
    const vol = def.volumeM3 ?? 30;
    this.heatCap = (def.heatCapacityKJK ?? 25 * vol) * 1000;
    this.ua = def.skinUAWK ?? 3 * vol;
    this.o = { temp_c: `${prefix}${def.id}_temp_c`, supply_c: `${prefix}${def.id}_supply_c` };
    this.tempC = vars.has(this.o.temp_c) ? vars.get(this.o.temp_c) : (def.initialC ?? 20);
    this.supplyC = this.tempC;
  }
}

class Starter {
  open = false;
  strength = 0;
  demand = 0;
  readonly driver: StarterDriver;
  readonly o: Record<'valve_open' | 'strength', string>;
  readonly fail: string;
  readonly failOpen: string;
  constructor(
    readonly def: AirStarterDef,
    readonly duct: number,
    readonly cmd: () => boolean,
    readonly power: () => boolean,
    vars: SimVars,
    prefix: string,
  ) {
    this.driver = new StarterDriver(vars, { engineStarterVar: def.engineStarterVar ?? ENG.starter(def.engine), kind: 'turbine', starterTau: def.engineStarterTau });
    this.o = { valve_open: `${prefix}${def.id}_valve_open`, strength: `${prefix}${def.id}_strength` };
    this.fail = failVar(`pneu.${def.id}`);
    this.failOpen = failVar(`pneu.${def.id}.open`);
  }
}

export interface PneumaticSystemOptions {
  name?: string;
}

export class PneumaticSystem implements Subsystem {
  readonly name: string;
  readonly prefix: string;
  private readonly ductIndex = new Map<string, number>();
  private readonly ductNames: string[] = [];
  private readonly ductPsi: Float64Array;
  private readonly ductVars: { psi: string; leak: string; fail: string }[] = [];
  private readonly sources: Source[] = [];
  private readonly valves: Valve[] = [];
  private readonly consumers: Consumer[] = [];
  private readonly packs: Pack[] = [];
  private readonly zones: Zone[] = [];
  private readonly starters: Starter[] = [];
  private readonly parent: Int32Array;
  private readonly gP: Float64Array;
  private readonly gCap: Float64Array;
  private readonly gDemand: Float64Array;
  private readonly gServed: Float64Array;
  private readonly gTarget: Float64Array;
  /** Engine numbers with a bleed extract output, and per-slot flow sums / capacities. */
  private readonly engineList: number[] = [];
  private readonly engineSlot = new Map<number, number>();
  private engineExtract = new Float64Array(0);
  private engineMax = new Float64Array(0);
  private engineVars: string[] = [];
  private readonly ductLag: number;
  private readonly leakKgs: number;
  private readonly vPackTotal: string;
  private readonly ids = new IdRegistry('PneumaticSystem');

  constructor(
    private readonly vars: SimVars,
    cfg: PneumaticConfig,
    opts: PneumaticSystemOptions = {},
  ) {
    this.name = opts.name ?? 'pneumatic';
    const P = (this.prefix = cfg.prefix ?? 'pneu.');
    this.ductLag = cfg.ductLagS ?? 0.5;
    this.leakKgs = cfg.leakKgs ?? 0.4;
    this.vPackTotal = `${P}pack_flow_kgs`;
    for (const d of cfg.ducts) {
      this.ids.add(d, 'duct');
      this.ductIndex.set(d, this.ductNames.length);
      this.ductNames.push(d);
      this.ductVars.push({ psi: `${P}${d}_psi`, leak: `${P}${d}_leak`, fail: failVar(`pneu.${d}.leak`) });
    }
    const nd = this.ductNames.length;
    this.ductPsi = new Float64Array(nd);
    this.parent = new Int32Array(nd);
    this.gP = new Float64Array(nd);
    this.gCap = new Float64Array(nd);
    this.gDemand = new Float64Array(nd);
    this.gServed = new Float64Array(nd);
    this.gTarget = new Float64Array(nd);
    for (let i = 0; i < nd; i++) if (vars.has(this.ductVars[i].psi)) this.ductPsi[i] = vars.get(this.ductVars[i].psi);

    for (const d of cfg.sources) {
      this.ids.add(d.id, 'source');
      if (!(d.maxFlowKgs > 0)) throw new Error(`PneumaticSystem: source '${d.id}' needs maxFlowKgs > 0`);
      const s = new Source(d, this.duct(d.duct, `source '${d.id}'`), compileBinding(vars, d.pressure), compileCondition(vars, d.valve, true), compileCondition(vars, d.reset, false), P);
      this.sources.push(s);
      if (d.engine !== undefined) s.slot = this.addEngine(d.engine, d.maxFlowKgs);
    }
    for (const d of cfg.valves ?? []) {
      this.ids.add(d.id, 'valve');
      this.valves.push(new Valve(d, this.duct(d.a, `valve '${d.id}'`), this.duct(d.b, `valve '${d.id}'`), compileCondition(vars, d.open, false), compileCondition(vars, d.power, true), P));
    }
    for (const d of cfg.consumers ?? []) {
      this.ids.add(d.id, 'consumer');
      let duct = -1;
      let eng = 0;
      let ep: Evaluator | null = null;
      if (d.engine !== undefined) {
        ep = compileBinding(vars, d.enginePressure ?? ENG.bleedPressPsi(d.engine));
        eng = this.addEngine(d.engine, 0);
      } else if (d.duct !== undefined) duct = this.duct(d.duct, `consumer '${d.id}'`);
      else throw new Error(`PneumaticSystem: consumer '${d.id}' needs a duct or an engine`);
      this.consumers.push(new Consumer(d, duct, eng, compileBinding(vars, d.demandKgs), ep, d.minPsi ?? 20, P));
    }
    for (const d of cfg.packs ?? []) {
      this.ids.add(d.id, 'pack');
      this.packs.push(new Pack(d, this.duct(d.duct, `pack '${d.id}'`), compileCondition(vars, d.on, false), compileBinding(vars, d.flowKgs), compileCondition(vars, d.reset, false), P));
    }
    for (const d of cfg.zones ?? []) {
      this.ids.add(d.id, 'zone');
      const pk = d.packs.map((id) => {
        const i = this.packs.findIndex((p) => p.def.id === id);
        if (i < 0) throw new Error(`PneumaticSystem: zone '${d.id}' references unknown pack '${id}'`);
        this.packs[i].zones++;
        this.packs[i].zoneIdx.push(this.zones.length);
        return i;
      });
      this.zones.push(new Zone(d, pk, compileBinding(vars, d.target, 22), compileBinding(vars, d.heatLoadW ?? 1500), compileBinding(vars, d.skin ?? FDM.tat, 15), P, vars));
    }
    for (const d of cfg.starters ?? []) {
      this.ids.add(d.id, 'starter');
      if (!(d.nominalPsi > 0)) throw new Error(`PneumaticSystem: starter '${d.id}' needs nominalPsi > 0`);
      this.starters.push(new Starter(d, this.duct(d.duct, `starter '${d.id}'`), compileCondition(vars, d.command, false), compileCondition(vars, d.valvePower, true), vars, P));
    }
  }

  private duct(id: string, what: string): number {
    const i = this.ductIndex.get(id);
    if (i === undefined) throw new Error(`PneumaticSystem: ${what} references unknown duct '${id}'`);
    return i;
  }

  private addEngine(i: number, maxFlow: number): number {
    let slot = this.engineSlot.get(i);
    if (slot === undefined) {
      slot = this.engineList.length;
      this.engineSlot.set(i, slot);
      this.engineList.push(i);
      const mx = new Float64Array(this.engineList.length);
      mx.set(this.engineMax);
      this.engineMax = mx;
      this.engineExtract = new Float64Array(this.engineList.length);
      this.engineVars = this.engineList.map((e) => ENG.bleedExtract(e));
    }
    this.engineMax[slot] += maxFlow;
    return slot;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const nd = this.ductNames.length;
    const parent = this.parent;

    // ---- 1. valves and PRSOVs
    for (const v of this.valves) {
      v.act.stuck = vars.get(v.fail) !== 0;
      if (v.power()) v.act.update(v.cmd() ? 1 : 0, dt);
      else v.act.inTransit = false;
    }
    for (const s of this.sources) {
      if (vars.get(s.failHot) !== 0) s.tripped = true;
      if (s.resetEdge.rising(s.reset()) && vars.get(s.failHot) === 0) s.tripped = false;
      s.act.update(s.valve() && !s.tripped ? 1 : 0, dt);
    }

    // ---- 2. groups and source offers
    for (let i = 0; i < nd; i++) parent[i] = i;
    for (const v of this.valves) if (v.act.position >= 0.5) union(parent, v.a, v.b);
    this.gP.fill(0);
    this.gCap.fill(0);
    this.gDemand.fill(0);
    this.gServed.fill(0);
    for (const s of this.sources) {
      let port = Math.max(0, s.pressure());
      const hp = s.def.hp;
      s.hpOpen = hp !== undefined && port > 0 && port < hp.belowPsi;
      if (s.hpOpen && hp) port *= hp.ratio;
      s.portPsi = port;
      const reg = s.def.regulatedPsi ?? 45;
      const pos = s.act.position;
      s.supplyPsi = Math.min(port, reg) * pos;
      s.cap = s.def.maxFlowKgs * Math.min(1, port / reg) * pos;
      s.flow = 0;
      if (s.cap > 0) {
        const g = find(parent, s.duct);
        if (s.supplyPsi > this.gP[g]) this.gP[g] = s.supplyPsi;
        this.gCap[g] += s.cap;
      }
    }

    // ---- 3. demand (preliminary pressure = lagged duct pressure)
    for (const c of this.consumers) {
      const d = c.demandEv();
      c.demand = d > 0 ? d : 0;
      if (c.duct >= 0) this.gDemand[find(parent, c.duct)] += c.demand;
    }
    for (const p of this.packs) {
      if (vars.get(p.failHot) !== 0) p.tripped = true;
      if (p.resetEdge.rising(p.reset()) && vars.get(p.failHot) === 0) p.tripped = false;
      p.on = p.onEv() && !p.tripped;
      p.demand = p.on ? Math.max(0, p.flowEv()) : 0;
      this.gDemand[find(parent, p.duct)] += p.demand;
    }
    for (const st of this.starters) {
      const failedClosed = vars.get(st.fail) !== 0;
      const failedOpen = vars.get(st.failOpen) !== 0;
      st.open = failedOpen || (st.cmd() && st.power() && !failedClosed);
      const psi = this.ductPsi[st.duct];
      st.strength = st.open ? Math.min(1, psi / st.def.nominalPsi) : 0;
      st.demand = st.open ? (st.def.demandKgs ?? 1.0) * Math.max(0.2, st.strength) : 0;
      this.gDemand[find(parent, st.duct)] += st.demand;
    }
    for (let i = 0; i < nd; i++) {
      if (vars.get(this.ductVars[i].fail) !== 0) this.gDemand[find(parent, i)] += this.leakKgs;
    }

    // ---- 4. group pressure, duct lag
    for (let i = 0; i < nd; i++) {
      const g = find(parent, i);
      if (g !== i) continue;
      const cap = this.gCap[g];
      const dem = this.gDemand[g];
      let p = 0;
      if (cap > 0) {
        const load = dem / cap;
        p = this.gP[g] * (load <= 1 ? 1 - DROOP_AT_CAPACITY * load : (1 - DROOP_AT_CAPACITY) / load);
      }
      this.gTarget[g] = p;
    }
    const a = this.ductLag > 0 ? 1 - Math.exp(-dt / this.ductLag) : 1;
    for (let i = 0; i < nd; i++) this.ductPsi[i] += (this.gTarget[find(parent, i)] - this.ductPsi[i]) * a;

    // ---- 5. deliveries
    this.engineExtract.fill(0);
    for (const c of this.consumers) {
      if (c.duct >= 0) {
        const psi = this.ductPsi[c.duct];
        c.ok = Math.min(1, psi / c.minPsi);
        c.flow = c.demand * c.ok;
        this.gServed[find(parent, c.duct)] += c.flow;
      } else {
        const psi = c.enginePsi ? c.enginePsi() : 0;
        c.ok = Math.min(1, Math.max(0, psi) / c.minPsi);
        c.flow = c.demand * c.ok;
        this.engineExtract[c.engine] += c.flow;
      }
    }
    for (const p of this.packs) {
      const psi = this.ductPsi[p.duct];
      p.flow = p.demand * Math.min(1, psi / (p.def.minPsi ?? 18));
      this.gServed[find(parent, p.duct)] += p.flow;
    }
    for (const st of this.starters) {
      this.gServed[find(parent, st.duct)] += st.demand * Math.min(1, this.ductPsi[st.duct] / st.def.nominalPsi);
      st.driver.update(st.open, st.strength);
    }
    for (let i = 0; i < nd; i++) if (vars.get(this.ductVars[i].fail) !== 0) this.gServed[find(parent, i)] += this.leakKgs * Math.min(1, this.ductPsi[i] / 20);
    for (const s of this.sources) {
      if (s.cap <= 0) continue;
      const g = find(parent, s.duct);
      s.flow = this.gCap[g] > 0 ? (this.gServed[g] * s.cap) / this.gCap[g] : 0;
      if (s.slot >= 0) this.engineExtract[s.slot] += s.flow;
    }

    // ---- 6. packs and zones
    this.updateZones(dt);

    this.publish();
  }

  private updateZones(dt: number): void {
    // Zone controllers compute the supply temperature they want.
    for (const z of this.zones) {
      let m = 0;
      for (const pi of z.packs) {
        const p = this.packs[pi];
        m += p.flow / Math.max(1, p.zones);
      }
      const T = z.tempC;
      const target = z.target();
      const q = z.heatLoad();
      const skin = z.skin();
      if (m > 1e-4) {
        // Supply temperature that moves T toward target with τ = ZONE_CTRL_TAU_S.
        z.cmdC = T + (z.heatCap * ((target - T) / ZONE_CTRL_TAU_S) - q + z.ua * (T - skin)) / (m * CP_AIR);
      } else z.cmdC = T;
    }
    // Pack outlet: coldest demand among its zones (trim air heats the others).
    for (const p of this.packs) {
      const lo = p.def.minOutletC ?? 2;
      const hi = p.def.maxOutletC ?? 70;
      let cmd = hi;
      for (const zi of p.zoneIdx) cmd = Math.min(cmd, this.zones[zi].cmdC);
      if (p.zoneIdx.length === 0) cmd = 15;
      p.cmdC = cmd < lo ? lo : cmd > hi ? hi : cmd;
      const target = p.flow > 0 ? p.cmdC : this.ductPsi[p.duct] > 1 ? 60 : p.outletC;
      p.outletC += (target - p.outletC) * (1 - Math.exp(-dt / PACK_TEMP_TAU_S));
    }
    for (const z of this.zones) {
      let m = 0;
      let mt = 0;
      for (const pi of z.packs) {
        const p = this.packs[pi];
        const share = p.flow / Math.max(1, p.zones);
        m += share;
        // Trim air raises the zone's supply above the pack outlet when this zone wants it warmer.
        const hi = p.def.maxOutletC ?? 70;
        const sup = Math.max(p.outletC, Math.min(z.cmdC, hi));
        mt += share * sup;
      }
      z.supplyC = m > 1e-6 ? mt / m : z.tempC;
      const dT = (m * CP_AIR * (z.supplyC - z.tempC) + z.heatLoad() + z.ua * (z.skin() - z.tempC)) / z.heatCap;
      z.tempC += dT * dt;
    }
  }

  private publish(): void {
    const vars = this.vars;
    for (let i = 0; i < this.ductNames.length; i++) {
      vars.set(this.ductVars[i].psi, this.ductPsi[i]);
      vars.set(this.ductVars[i].leak, vars.get(this.ductVars[i].fail) !== 0 && this.ductPsi[i] > 5 ? 1 : 0);
    }
    for (const s of this.sources) {
      vars.set(s.o.psi, s.portPsi);
      vars.set(s.o.valve_open, s.act.position >= 0.95 ? 1 : 0);
      vars.set(s.o.valve_pos, s.act.position);
      vars.set(s.o.trip, s.tripped ? 1 : 0);
      vars.set(s.o.flow_kgs, s.flow);
      vars.set(s.o.hp, s.hpOpen ? 1 : 0);
    }
    for (const v of this.valves) {
      vars.set(v.o.pos, v.act.position);
      vars.set(v.o.open, v.act.position >= 0.95 ? 1 : 0);
      vars.set(v.o.transit, v.act.inTransit ? 1 : 0);
    }
    for (const c of this.consumers) {
      vars.set(c.o.ok, c.ok);
      vars.set(c.o.flow_kgs, c.flow);
    }
    let packTotal = 0;
    for (const p of this.packs) {
      vars.set(p.o.on, p.on && p.flow > 0 ? 1 : 0);
      vars.set(p.o.flow_kgs, p.flow);
      vars.set(p.o.outlet_c, p.outletC);
      vars.set(p.o.trip, p.tripped ? 1 : 0);
      packTotal += p.flow;
    }
    vars.set(this.vPackTotal, packTotal);
    for (const z of this.zones) {
      vars.set(z.o.temp_c, z.tempC);
      vars.set(z.o.supply_c, z.supplyC);
    }
    for (const st of this.starters) {
      vars.set(st.o.valve_open, st.open ? 1 : 0);
      vars.set(st.o.strength, st.strength);
    }
    for (let k = 0; k < this.engineList.length; k++) {
      const max = this.engineMax[k];
      // Engine-direct consumers without a PRSOV source: normalise by 1 kg/s (EST) so the extract stays meaningful.
      vars.set(this.engineVars[k], Math.min(1, this.engineExtract[k] / (max > 0 ? max : 1)));
    }
  }

  // ------------------------------------------------------------ public API

  ductPressure(id: string): number {
    const i = this.ductIndex.get(id);
    return i === undefined ? 0 : this.ductPsi[i];
  }

  /** Snaps valves to their commands and zones to a temperature (applyState presets). */
  snap(zoneTempC?: number): void {
    for (const v of this.valves) v.act.reset(v.cmd() ? 1 : 0);
    for (const s of this.sources) s.act.reset(s.valve() && !s.tripped ? 1 : 0);
    if (zoneTempC !== undefined) for (const z of this.zones) z.tempC = z.supplyC = zoneTempC;
  }

  reset(): void {
    const vars = this.vars;
    for (let i = 0; i < this.ductNames.length; i++) if (vars.has(this.ductVars[i].psi)) this.ductPsi[i] = vars.get(this.ductVars[i].psi);
    for (const z of this.zones) if (vars.has(z.o.temp_c)) z.tempC = vars.get(z.o.temp_c);
    for (const v of this.valves) if (vars.has(v.o.pos)) v.act.reset(vars.get(v.o.pos));
    for (const s of this.sources) s.tripped = vars.get(s.o.trip) !== 0;
    for (const st of this.starters) st.driver.reset();
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    const c = 'pneumatic';
    for (const s of this.sources) f.push({ id: `pneu.${s.def.id}.overheat`, name: `${s.def.id} bleed overheat`, category: c, description: 'Bleed trips off (PRSOV closes) until TRIP RESET after the fault clears.' });
    for (const d of this.ductNames) f.push({ id: `pneu.${d}.leak`, name: `${d} duct leak`, category: c, description: 'Duct leak: pressure loss and leak detection.' });
    for (const v of this.valves) f.push({ id: `pneu.${v.def.id}.stuck`, name: `${v.def.id} valve stuck`, category: c });
    for (const p of this.packs) f.push({ id: `pneu.${p.def.id}.overheat`, name: `${p.def.id} pack overheat`, category: c, description: 'Pack trips off until reset.' });
    for (const st of this.starters) {
      f.push({ id: `pneu.${st.def.id}`, name: `${st.def.id} start valve fails closed`, category: c });
      f.push({ id: `pneu.${st.def.id}.open`, name: `${st.def.id} start valve fails open`, category: c, description: 'START VALVE OPEN: starter stays engaged.' });
    }
    return f;
  }

  dispose(): void {
    /* nothing */
  }
}

function find(p: Int32Array, i: number): number {
  while (p[i] !== i) {
    p[i] = p[p[i]];
    i = p[i];
  }
  return i;
}

function union(p: Int32Array, a: number, b: number): void {
  const ra = find(p, a);
  const rb = find(p, b);
  if (ra !== rb) p[rb] = ra;
}
