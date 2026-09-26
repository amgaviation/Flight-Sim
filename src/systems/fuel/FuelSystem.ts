/**
 * Data-driven fuel system: tanks, pumps, valves, manifolds, engine/APU feed,
 * crossfeed, transfer, gauging and fuel temperature.
 *
 * Topology: tanks feed nodes (manifolds) through pumps (electric boost,
 * ejector/motive-flow, gravity head); nodes join through valves (crossfeed,
 * firewall/spar shutoff, selector positions); in-line pumps (engine-driven,
 * auxiliary) lift fuel from one node to another; consumers (engines, APU)
 * draw from a node.
 *
 * Each update:
 *  1. Valves move toward their commands (motorised, rate-limited; they only
 *     move while powered; `fail.fuel.<valve>.stuck` freezes them). A valve
 *     joins its nodes while at least half open.
 *  2. Nodes joined by open valves form groups. Pumps are evaluated in
 *     upstream-to-downstream order (stages computed at construction): a
 *     pump runs if commanded, not failed and its source has fuel (tank above
 *     unusable, or a wet upstream group). Group pressure = the highest
 *     running pump outlet pressure feeding it (check valves in every pump
 *     outlet let the highest-pressure pumps supply first — this is how 737
 *     centre-tank pumps are used before the wing tanks).
 *  3. Consumers: feed is adequate when the group is wet and at least
 *     `minPressPsi`, or through suction feed. `eng{i}.fuel_on` = run command
 *     && adequate feed. Demand (e.g. `eng1.ff_pph`) is allocated from
 *     downstream to upstream: within a group, pumps are loaded in tiers of
 *     outlet pressure (within 1 psi = same tier, shared in proportion to
 *     their max flow); in-line pumps pass their flow on to their source
 *     group; tank pumps burn fuel from their tank. With crossfeed open and one
 *     side's pumps off, both engines therefore burn from the other side.
 *  4. Transfers (pumped or gravity/crossflow), leaks, gauging, low-level and
 *     imbalance flags, bulk fuel temperature.
 *
 * The FuelSystem is the ONLY writer of `eng{i}.fuel_on` for engines listed
 * as consumers: FADEC/start logic passes its fuel command through the
 * consumer's `run` binding.
 *
 * Output vars (prefix default 'fuel.'):
 *   fuel.tank{index}_kg (true mass, read by the FDM), fuel.total_kg,
 *   <tank>_ind_kg (gauged), <tank>_low, <tank>_temp_c, <tank>_usable_kg,
 *   <pump>_on, <pump>_lowpress, <pump>_psi, <pump>_flow_pph, <pump>_amps,
 *   <valve>_pos, <valve>_open, <valve>_transit,
 *   <node>_psi,
 *   <consumer>_on (feed adequate), <consumer>_psi, <consumer>_lowpress, <consumer>_flow_pph,
 *   <consumer>_suction (1 while suction feeding),
 *   <transfer>_active, <transfer>_flow_pph,
 *   imbalance_kg, imbalance, used_kg (burned since construction/reset)
 *
 * Failures: fuel.<pump> (pump inoperative), fuel.<valve>.stuck,
 * fuel.<tank>.leak.
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { ENG, FDM, FUEL } from '../../core/vars';
import { KG_TO_LB, LB_TO_KG } from '../../core/units';
import { compileBinding, compileCondition, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { Actuator } from '../util/filters';
import { Hysteresis } from '../util/timers';
import type { FailureDef } from '../failures/FailureManager';
import type { FuelConsumerDef, FuelPumpDef, FuelSystemConfig, FuelTankDef, FuelTransferDef, FuelValveDef } from './types';

const PPH_TO_KGPS = LB_TO_KG / 3600;
const KGPS_TO_PPH = 3600 * KG_TO_LB;
/** Pumps within this many psi share a pressure tier. */
const TIER_PSI = 1;
/** EST: centrifugal boost pump outlet pressure falls ~30 % from shutoff head to max flow. */
const PUMP_DROOP = 0.3;

class Tank {
  mass: number;
  ind: number;
  tempC: number;
  readonly unusable: number;
  readonly leakKgps: number;
  readonly low: Hysteresis | null;
  readonly massVar: string;
  readonly gaugePower: () => boolean;
  readonly gaugeLag: number;
  readonly o: Record<'ind_kg' | 'low' | 'temp_c' | 'usable_kg', string>;
  readonly failLeak: string;
  constructor(
    readonly def: FuelTankDef,
    readonly idx: number,
    vars: SimVars,
    prefix: string,
    tempC: number,
  ) {
    this.massVar = FUEL.tankKg(def.index);
    this.mass = vars.has(this.massVar) ? vars.get(this.massVar) : (def.initialKg ?? def.capacityKg);
    this.mass = Math.min(def.capacityKg, Math.max(0, this.mass));
    this.ind = this.mass;
    this.unusable = def.unusableKg ?? 0;
    this.leakKgps = (def.leakPph ?? Math.max(600, 0.1 * def.capacityKg * KG_TO_LB)) * PPH_TO_KGPS;
    const lowKg = def.lowLevelKg;
    this.low = lowKg !== undefined ? new Hysteresis(lowKg, lowKg * 1.05 + 1, true) : null;
    this.gaugePower = compileCondition(vars, def.gauge?.power, true);
    this.gaugeLag = def.gauge?.lagS ?? 2;
    this.o = {
      ind_kg: `${prefix}${def.id}_ind_kg`,
      low: `${prefix}${def.id}_low`,
      temp_c: `${prefix}${def.id}_temp_c`,
      usable_kg: `${prefix}${def.id}_usable_kg`,
    };
    this.failLeak = failVar(`fuel.${def.id}.leak`);
    this.tempC = vars.has(this.o.temp_c) ? vars.get(this.o.temp_c) : tempC;
  }

  usable(): number {
    const u = this.mass - this.unusable;
    return u > 0 ? u : 0;
  }
}

class Pump {
  active = false;
  commanded = false;
  flowKgps = 0;
  psi = 0;
  stage = 0;
  /** Source: tank index (>= 0) or -1 when the source is a node. */
  srcTank = -1;
  srcNode = -1;
  readonly dst: number;
  readonly maxKgps: number;
  readonly o: Record<'on' | 'lowpress' | 'psi' | 'flow_pph' | 'amps', string>;
  readonly fail: string;
  constructor(
    readonly def: FuelPumpDef,
    readonly on: () => boolean,
    dst: number,
    prefix: string,
  ) {
    this.dst = dst;
    this.maxKgps = def.maxFlowPph * PPH_TO_KGPS;
    this.o = {
      on: `${prefix}${def.id}_on`,
      lowpress: `${prefix}${def.id}_lowpress`,
      psi: `${prefix}${def.id}_psi`,
      flow_pph: `${prefix}${def.id}_flow_pph`,
      amps: `${prefix}${def.id}_amps`,
    };
    this.fail = failVar(`fuel.${def.id}`);
  }
}

class Valve {
  readonly act: Actuator;
  readonly o: Record<'pos' | 'open' | 'transit', string>;
  readonly fail: string;
  constructor(
    readonly def: FuelValveDef,
    readonly a: number,
    readonly b: number,
    readonly cmd: () => boolean,
    readonly power: () => boolean,
    prefix: string,
    vars: SimVars,
  ) {
    this.o = { pos: `${prefix}${def.id}_pos`, open: `${prefix}${def.id}_open`, transit: `${prefix}${def.id}_transit` };
    const init = vars.has(this.o.pos) ? vars.get(this.o.pos) : (def.initial ?? (cmd() ? 1 : 0));
    this.act = new Actuator(def.travelS ?? 1, init);
    this.fail = failVar(`fuel.${def.id}.stuck`);
  }
}

class Consumer {
  demandKgps = 0;
  supplied = false;
  suctionFeeding = false;
  psi = 0;
  readonly run: () => boolean;
  readonly flow: Evaluator;
  readonly suctionTank: number;
  readonly suctionRunning: () => boolean;
  readonly suctionCeiling: number;
  readonly fuelOnVar: string | null;
  readonly o: Record<'on' | 'psi' | 'lowpress' | 'flow_pph' | 'suction', string>;
  constructor(
    readonly def: FuelConsumerDef,
    readonly node: number,
    vars: SimVars,
    prefix: string,
    suctionTank: number,
  ) {
    this.run = compileCondition(vars, def.run, true);
    this.flow = compileBinding(vars, def.flowPph, 0);
    this.suctionTank = suctionTank;
    const eng = def.engine;
    this.suctionRunning = compileCondition(vars, def.suction?.running ?? (eng !== undefined ? `${ENG.n2(eng)} > 20` : false), false);
    this.suctionCeiling = def.suction?.ceilingFt ?? 25000;
    this.fuelOnVar = eng !== undefined ? ENG.fuelOn(eng) : null;
    this.o = {
      on: `${prefix}${def.id}_on`,
      psi: `${prefix}${def.id}_psi`,
      lowpress: `${prefix}${def.id}_lowpress`,
      flow_pph: `${prefix}${def.id}_flow_pph`,
      suction: `${prefix}${def.id}_suction`,
    };
  }
}

class Transfer {
  flowKgps = 0;
  readonly o: Record<'active' | 'flow_pph', string>;
  constructor(
    readonly def: FuelTransferDef,
    readonly from: number,
    readonly to: number,
    readonly active: () => boolean,
    prefix: string,
  ) {
    this.o = { active: `${prefix}${def.id}_active`, flow_pph: `${prefix}${def.id}_flow_pph` };
  }
}

export interface FuelSystemOptions {
  name?: string;
}

export class FuelSystem implements Subsystem {
  readonly name: string;
  readonly prefix: string;
  private readonly tanks: Tank[] = [];
  private readonly tankIndex = new Map<string, number>();
  private readonly nodeIndex = new Map<string, number>();
  private readonly nodeNames: string[] = [];
  private readonly nodePsiVars: string[] = [];
  private readonly pumps: Pump[] = [];
  /** Pumps sorted by stage (ascending) and by pressure (descending) for tier allocation. */
  private readonly pumpsByStage: Pump[];
  private readonly pumpsByPressure: Pump[];
  private readonly valves: Valve[] = [];
  private readonly consumers: Consumer[] = [];
  private readonly transfers: Transfer[] = [];
  private readonly parent: Int32Array;
  private readonly groupWet: Uint8Array;
  private readonly groupPsi: Float64Array;
  private readonly groupDemand: Float64Array;
  private readonly groupDone: Uint8Array;
  private readonly altitude: Evaluator;
  private readonly skinTemp: Evaluator;
  private readonly tauFull: number;
  private readonly hasTemp: boolean;
  private readonly balance: { l: number; r: number; alertKg: number } | null;
  private readonly ids = new IdRegistry('FuelSystem');
  private usedKg = 0;

  constructor(
    private readonly vars: SimVars,
    cfg: FuelSystemConfig,
    opts: FuelSystemOptions = {},
  ) {
    this.name = opts.name ?? 'fuel';
    const P = (this.prefix = cfg.prefix ?? 'fuel.');
    this.hasTemp = cfg.temperature !== undefined;
    this.skinTemp = compileBinding(vars, cfg.temperature?.skin ?? FDM.tat, 15);
    this.tauFull = cfg.temperature?.tauFullS ?? 3 * 3600; // EST: bulk wing-tank fuel follows skin temperature over hours
    this.altitude = compileBinding(vars, cfg.altitude ?? FDM.pressAlt, 0);
    const t0 = cfg.temperature?.initialC ?? 15;

    const usedIdx = new Set<number>();
    for (const t of cfg.tanks) {
      this.ids.add(t.id, 'tank');
      if (usedIdx.has(t.index)) throw new Error(`FuelSystem: tank index ${t.index} used twice`);
      usedIdx.add(t.index);
      if (!(t.capacityKg > 0)) throw new Error(`FuelSystem: tank '${t.id}' needs capacityKg > 0`);
      this.tankIndex.set(t.id, this.tanks.length);
      this.tanks.push(new Tank(t, this.tanks.length, vars, P, t0));
    }
    for (const n of cfg.nodes) {
      this.ids.add(n, 'node');
      this.nodeIndex.set(n, this.nodeNames.length);
      this.nodeNames.push(n);
      this.nodePsiVars.push(`${P}${n}_psi`);
    }
    const nn = this.nodeNames.length;
    this.parent = new Int32Array(nn);
    this.groupWet = new Uint8Array(nn);
    this.groupPsi = new Float64Array(nn);
    this.groupDemand = new Float64Array(nn);
    this.groupDone = new Uint8Array(nn);

    for (const d of cfg.pumps) {
      this.ids.add(d.id, 'pump');
      const dst = this.node(d.to, `pump '${d.id}'`);
      const p = new Pump(d, compileCondition(vars, d.on, true), dst, P);
      const ti = this.tankIndex.get(d.from);
      if (ti !== undefined) p.srcTank = ti;
      else p.srcNode = this.node(d.from, `pump '${d.id}' source`);
      this.pumps.push(p);
    }
    for (const d of cfg.valves ?? []) {
      this.ids.add(d.id, 'valve');
      this.valves.push(
        new Valve(d, this.node(d.a, `valve '${d.id}'`), this.node(d.b, `valve '${d.id}'`), compileCondition(vars, d.open, false), compileCondition(vars, d.power, true), P, vars),
      );
    }
    for (const d of cfg.consumers) {
      this.ids.add(d.id, 'consumer');
      let st = -1;
      if (d.suction) {
        const i = this.tankIndex.get(d.suction.tank);
        if (i === undefined) throw new Error(`FuelSystem: consumer '${d.id}' suction tank '${d.suction.tank}' unknown`);
        st = i;
      }
      this.consumers.push(new Consumer(d, this.node(d.node, `consumer '${d.id}'`), vars, P, st));
    }
    for (const d of cfg.transfers ?? []) {
      this.ids.add(d.id, 'transfer');
      const f = this.tankIndex.get(d.from);
      const t = this.tankIndex.get(d.to);
      if (f === undefined || t === undefined) throw new Error(`FuelSystem: transfer '${d.id}' references unknown tank`);
      this.transfers.push(new Transfer(d, f, t, compileCondition(vars, d.active, false), P));
    }
    if (cfg.balance) {
      const l = this.tankIndex.get(cfg.balance.left);
      const r = this.tankIndex.get(cfg.balance.right);
      if (l === undefined || r === undefined) throw new Error('FuelSystem: balance references unknown tank');
      this.balance = { l, r, alertKg: cfg.balance.alertKg };
    } else this.balance = null;

    this.computeStages();
    this.pumpsByStage = [...this.pumps].sort((a, b) => a.stage - b.stage);
    this.pumpsByPressure = [...this.pumps].sort((a, b) => b.def.pressurePsi - a.def.pressurePsi);
    this.writeTanks();
  }

  private node(id: string, what: string): number {
    const i = this.nodeIndex.get(id);
    if (i === undefined) throw new Error(`FuelSystem: ${what} references unknown node '${id}'`);
    return i;
  }

  /** Stage = longest chain of in-line pumps upstream (static graph with every valve open). */
  private computeStages(): void {
    const nn = this.nodeNames.length;
    const p = new Int32Array(nn);
    for (let i = 0; i < nn; i++) p[i] = i;
    for (const v of this.valves) unionP(p, v.a, v.b);
    for (let pass = 0; pass <= this.pumps.length + 1; pass++) {
      let changed = false;
      for (const pu of this.pumps) {
        if (pu.srcNode < 0) continue;
        const src = findP(p, pu.srcNode);
        let s = 0;
        for (const q of this.pumps) if (q !== pu && findP(p, q.dst) === src) s = Math.max(s, q.stage + 1);
        if (s !== pu.stage) {
          pu.stage = s;
          changed = true;
        }
      }
      if (!changed) return;
    }
    throw new Error('FuelSystem: in-line pumps form a loop');
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const nn = this.nodeNames.length;

    // ---- 1. valves
    for (const v of this.valves) {
      v.act.stuck = vars.get(v.fail) !== 0;
      if (v.power()) v.act.update(v.cmd() ? 1 : 0, dt);
      else v.act.inTransit = false;
    }

    // ---- 2. groups, pumps, pressures
    const parent = this.parent;
    for (let i = 0; i < nn; i++) parent[i] = i;
    for (const v of this.valves) if (v.act.position >= 0.5) unionP(parent, v.a, v.b);
    this.groupWet.fill(0);
    this.groupPsi.fill(0);
    this.groupDemand.fill(0);
    this.groupDone.fill(0);
    for (const p of this.pumpsByStage) {
      p.commanded = p.on();
      let srcOk: boolean;
      if (p.srcTank >= 0) srcOk = this.tanks[p.srcTank].usable() > 1e-6;
      else srcOk = this.groupWet[findP(parent, p.srcNode)] !== 0;
      p.active = p.commanded && srcOk && vars.get(p.fail) === 0;
      p.flowKgps = 0;
      if (p.active) {
        const g = findP(parent, p.dst);
        this.groupWet[g] = 1;
        if (p.def.pressurePsi > this.groupPsi[g]) this.groupPsi[g] = p.def.pressurePsi;
      }
    }

    // ---- 3. consumers: feed adequacy and demand
    const alt = this.altitude();
    for (const c of this.consumers) {
      const g = findP(parent, c.node);
      const psi = this.groupWet[g] ? this.groupPsi[g] : 0;
      const pressOk = this.groupWet[g] !== 0 && psi >= (c.def.minPressPsi ?? 0.05);
      let suction = false;
      if (!pressOk && c.suctionTank >= 0 && alt < c.suctionCeiling && c.suctionRunning() && this.tanks[c.suctionTank].usable() > 1e-6) {
        // Suction lift needs a path from the tank into this group (through a stopped pump's bypass).
        for (const p of this.pumps) {
          if (p.srcTank === c.suctionTank && findP(parent, p.dst) === g) {
            suction = true;
            break;
          }
        }
      }
      const run = c.run();
      c.supplied = run && (pressOk || suction);
      c.suctionFeeding = c.supplied && !pressOk && suction;
      c.psi = psi;
      const demand = Math.max(0, c.flow()) * PPH_TO_KGPS;
      c.demandKgps = c.supplied ? demand : 0;
      if (c.demandKgps > 0) {
        if (c.suctionFeeding) this.draw(c.suctionTank, c.demandKgps * dt);
        else this.groupDemand[g] += c.demandKgps;
      }
    }

    // ---- 4. allocate demand downstream -> upstream
    const byStage = this.pumpsByStage;
    for (let k = byStage.length - 1; k >= 0; k--) {
      const p = byStage[k];
      const g = findP(parent, p.dst);
      if (this.groupDone[g]) continue;
      this.groupDone[g] = 1;
      this.allocate(g, dt);
    }

    // Pump pressures (droop with load) for indication.
    for (const p of this.pumps) {
      p.psi = p.active ? p.def.pressurePsi * (1 - (PUMP_DROOP * p.flowKgps) / Math.max(p.maxKgps, 1e-9)) : 0;
    }

    // ---- 5. transfers and leaks
    for (const t of this.transfers) this.runTransfer(t, dt);
    for (const t of this.tanks) {
      if (vars.get(t.failLeak) !== 0 && t.mass > 0) {
        const m = Math.min(t.mass, t.leakKgps * dt);
        t.mass -= m;
      }
    }

    // ---- 6. temperature, gauging, outputs
    const skin = this.skinTemp();
    for (const t of this.tanks) {
      if (this.hasTemp) {
        const tau = this.tauFull * Math.max(0.05, t.mass / t.def.capacityKg);
        t.tempC += (skin - t.tempC) * (1 - Math.exp(-dt / tau));
      }
      const target = t.gaugePower() ? t.mass : 0;
      t.ind += (target - t.ind) * (t.gaugeLag > 0 ? 1 - Math.exp(-dt / t.gaugeLag) : 1);
    }
    this.writeTanks();
    for (let i = 0; i < nn; i++) {
      const g = findP(parent, i);
      vars.set(this.nodePsiVars[i], this.groupWet[g] ? this.groupPsiEff(g) : 0);
    }
    for (const p of this.pumps) {
      vars.set(p.o.on, p.active ? 1 : 0);
      vars.set(p.o.lowpress, (p.commanded || p.def.lowPressWhenOff === true) && p.psi < (p.def.lowPressPsi ?? 0.5 * p.def.pressurePsi) ? 1 : 0);
      vars.set(p.o.psi, p.psi);
      vars.set(p.o.flow_pph, p.flowKgps * KGPS_TO_PPH);
      const ra = p.def.ratedAmps;
      if (ra !== undefined) vars.set(p.o.amps, p.commanded && vars.get(p.fail) === 0 ? ra * (0.6 + 0.4 * Math.min(1, p.flowKgps / Math.max(p.maxKgps, 1e-9))) : 0);
    }
    for (const v of this.valves) {
      vars.set(v.o.pos, v.act.position);
      vars.set(v.o.open, v.act.position >= 0.95 ? 1 : 0);
      vars.set(v.o.transit, v.act.inTransit ? 1 : 0);
    }
    for (const c of this.consumers) {
      const g = findP(parent, c.node);
      c.psi = this.groupWet[g] ? this.groupPsiEff(g) : 0;
      vars.set(c.o.on, c.supplied ? 1 : 0);
      vars.set(c.o.psi, c.psi);
      vars.set(c.o.lowpress, c.psi < (c.def.minPressPsi ?? 0.05) ? 1 : 0);
      vars.set(c.o.flow_pph, c.demandKgps * KGPS_TO_PPH);
      vars.set(c.o.suction, c.suctionFeeding ? 1 : 0);
      if (c.fuelOnVar) vars.set(c.fuelOnVar, c.supplied ? 1 : 0);
    }
    for (const t of this.transfers) {
      vars.set(t.o.active, t.flowKgps !== 0 ? 1 : 0);
      vars.set(t.o.flow_pph, t.flowKgps * KGPS_TO_PPH);
    }
    if (this.balance) {
      const d = this.tanks[this.balance.l].mass - this.tanks[this.balance.r].mass;
      vars.set(`${this.prefix}imbalance_kg`, d);
      vars.set(`${this.prefix}imbalance`, Math.abs(d) >= this.balance.alertKg ? 1 : 0);
    }
    vars.set(`${this.prefix}used_kg`, this.usedKg);
  }

  /** Effective group pressure after pump droop (max over feeding pumps). */
  private groupPsiEff(g: number): number {
    let best = 0;
    for (const p of this.pumps) if (p.active && findP(this.parent, p.dst) === g && p.psi > best) best = p.psi;
    return best;
  }

  /** Distributes the group's demand over its running feed pumps in pressure tiers. */
  private allocate(g: number, dt: number): void {
    let remaining = this.groupDemand[g];
    if (remaining <= 0) return;
    const list = this.pumpsByPressure;
    const parent = this.parent;
    let i = 0;
    while (remaining > 1e-12 && i < list.length) {
      // Find the next tier: first active pump feeding g, and all within TIER_PSI of it.
      while (i < list.length && !(list[i].active && findP(parent, list[i].dst) === g)) i++;
      if (i >= list.length) break;
      const top = list[i].def.pressurePsi;
      let cap = 0;
      let j = i;
      for (; j < list.length && list[j].def.pressurePsi >= top - TIER_PSI; j++) {
        const p = list[j];
        if (p.active && findP(parent, p.dst) === g) cap += this.pumpCapacity(p, dt);
      }
      if (cap <= 0) {
        i = j;
        continue;
      }
      const take = remaining < cap ? remaining : cap;
      for (let k = i; k < j; k++) {
        const p = list[k];
        if (!(p.active && findP(parent, p.dst) === g)) continue;
        const share = (take * this.pumpCapacity(p, dt)) / cap;
        p.flowKgps += share;
        if (p.srcTank >= 0) this.draw(p.srcTank, share * dt);
        else this.groupDemand[findP(parent, p.srcNode)] += share;
      }
      remaining -= take;
      i = j;
    }
  }

  /** Flow a pump can deliver this update (kg/s), limited by its rating and its tank's usable fuel. */
  private pumpCapacity(p: Pump, dt: number): number {
    if (p.srcTank >= 0) {
      const avail = this.tanks[p.srcTank].usable() / dt;
      return p.maxKgps < avail ? p.maxKgps : avail;
    }
    return p.maxKgps;
  }

  private draw(tank: number, kg: number): void {
    const t = this.tanks[tank];
    const m = Math.min(kg, t.mass);
    t.mass -= m;
    this.usedKg += m;
  }

  private runTransfer(t: Transfer, dt: number): void {
    t.flowKgps = 0;
    if (!t.active()) return;
    const a = this.tanks[t.from];
    const b = this.tanks[t.to];
    const rate = t.def.ratePph * PPH_TO_KGPS;
    let flow: number;
    if (t.def.kind === 'pumped') {
      const stop = (t.def.stopAtFraction ?? 1) * b.def.capacityKg;
      flow = b.mass >= stop ? 0 : Math.min(rate, a.usable() / dt, (stop - b.mass) / dt);
    } else {
      const la = a.mass / a.def.capacityKg;
      const lb = b.mass / b.def.capacityKg;
      let f = (la - lb) / (t.def.fullRateLevelDiff ?? 0.2);
      if (f > 1) f = 1;
      else if (f < -1) f = -1;
      if (!t.def.bidirectional && f < 0) f = 0;
      flow = rate * f;
      if (flow > 0) flow = Math.min(flow, a.usable() / dt, (b.def.capacityKg - b.mass) / dt);
      else flow = -Math.min(-flow, b.usable() / dt, (a.def.capacityKg - a.mass) / dt);
    }
    if (flow === 0) return;
    a.mass -= flow * dt;
    b.mass += flow * dt;
    t.flowKgps = flow;
  }

  private writeTanks(): void {
    const vars = this.vars;
    let total = 0;
    for (const t of this.tanks) {
      if (t.mass < 0) t.mass = 0;
      vars.set(t.massVar, t.mass);
      vars.set(t.o.ind_kg, t.ind);
      vars.set(t.o.usable_kg, t.usable());
      if (t.low) vars.set(t.o.low, t.low.update(t.mass) ? 1 : 0);
      if (this.hasTemp) vars.set(t.o.temp_c, t.tempC);
      total += t.mass;
    }
    vars.set(FUEL.totalKg, total);
  }

  // ------------------------------------------------------------ public API

  /** Sets a tank's contents (kg), e.g. from the weight & balance page. The gauge follows immediately. */
  setTankKg(id: string, kg: number): void {
    const i = this.tankIndex.get(id);
    if (i === undefined) throw new Error(`FuelSystem: unknown tank '${id}'`);
    const t = this.tanks[i];
    t.mass = Math.min(t.def.capacityKg, Math.max(0, kg));
    t.ind = t.mass;
    this.writeTanks();
  }

  tankKg(id: string): number {
    const i = this.tankIndex.get(id);
    return i === undefined ? 0 : this.tanks[i].mass;
  }

  /** Total fuel on board (kg). */
  totalKg(): number {
    let s = 0;
    for (const t of this.tanks) s += t.mass;
    return s;
  }

  /** Snaps every valve to its current command (applyState presets). */
  snapValves(): void {
    for (const v of this.valves) v.act.reset(v.cmd() ? 1 : 0);
  }

  /** Re-reads tank masses and valve positions from vars (after a state load). */
  reset(): void {
    const vars = this.vars;
    for (const t of this.tanks) {
      if (vars.has(t.massVar)) t.mass = Math.min(t.def.capacityKg, Math.max(0, vars.get(t.massVar)));
      t.ind = t.mass;
      if (vars.has(t.o.temp_c)) t.tempC = vars.get(t.o.temp_c);
    }
    for (const v of this.valves) if (vars.has(v.o.pos)) v.act.reset(vars.get(v.o.pos));
    this.usedKg = 0;
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    for (const p of this.pumps) {
      if (p.def.kind === 'gravity') continue;
      f.push({ id: `fuel.${p.def.id}`, name: `${p.def.id} fuel pump failure`, category: 'fuel', description: 'Pump inoperative: LOW PRESSURE when selected on.' });
    }
    for (const v of this.valves) f.push({ id: `fuel.${v.def.id}.stuck`, name: `${v.def.id} valve stuck`, category: 'fuel', description: 'Valve frozen in its current position.' });
    for (const t of this.tanks) f.push({ id: `fuel.${t.def.id}.leak`, name: `${t.def.id} tank leak`, category: 'fuel', description: 'Fuel lost overboard: quantity decreases, imbalance develops.' });
    return f;
  }

  dispose(): void {
    /* no subscriptions */
  }
}

function findP(p: Int32Array, i: number): number {
  while (p[i] !== i) {
    p[i] = p[p[i]];
    i = p[i];
  }
  return i;
}

function unionP(p: Int32Array, a: number, b: number): void {
  const ra = findP(p, a);
  const rb = findP(p, b);
  if (ra !== rb) p[rb] = ra;
}
