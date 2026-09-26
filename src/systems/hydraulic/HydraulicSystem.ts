/**
 * Hydraulic power systems: pressure-compensated pumps (engine-driven,
 * electric, RAT, hand), accumulators, reservoirs, PTUs/check-valve charging
 * lines and consumers whose flow demand droops the pressure.
 *
 * Per system, every update solves the pressure P' at the end of the step by
 * implicit Euler on the fluid volume stored under pressure:
 *
 *   [V(P') − V(P)] / dt = S(P') − D(P') − L(P') − R(P')
 *
 *   V(P)  = c·P + V0·(1 − Pp/P)⁺         line compliance + accumulator (isothermal gas)
 *   S(P)  = Σ pumps Qmax·drive·clamp((Pset − P)/band, 0, 1)    pressure-compensated pumps
 *           + PTU / check-valve inflow (same form, set point from the source side)
 *   D(P)  = Σ consumers d·min(1, P/Pfull)                      actuators slow down at low pressure
 *   L(P)  = internal leakage ∝ P (+ external leak failure ∝ √P)
 *   R(P)  = relief valve flow above the relief setting
 *
 * The residual is monotone in P', so it is bisected (allocation-free). An
 * accumulator therefore holds pressure for a while after its pumps stop and
 * supplies bursts of demand (brakes), and a single small electric pump
 * sags under a big demand (gear retraction) exactly as crews see.
 *
 * PTU/check lines use the source system's pressure from the previous update
 * and add their input flow (power balance / efficiency) to the source's
 * demand one update later (60 Hz: invisible).
 *
 * Fluid: reservoir quantity = (total fluid − fluid stored under pressure −
 * leaked) / capacity. Pumps cavitate (no flow) below 2 % quantity.
 *
 * Outputs (prefix default 'hyd.'):
 *   system: <id>_psi, <id>_qty (0..1), <id>_qty_pct, <id>_lowpress, <id>_lowqty
 *   pump:   <id>_on (running & delivering capability), <id>_lowpress, <id>_flow_lpm,
 *           <id>_amps / <id>_va (electric), <id>_overheat
 *   xfer:   <id>_active, <id>_flow_lpm
 *   cons.:  <id>_rate (0..1 fraction of demanded flow received)
 *
 * Failures: hyd.<pump> (pump inoperative), hyd.<pump>.overheat,
 * hyd.<system>.leak, hyd.<xfer> (PTU inoperative).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { compileBinding, compileCondition, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import type { FailureDef } from '../failures/FailureManager';
import type { HydConsumerDef, HydPumpDef, HydSystemDef, HydTransferDef, HydraulicConfig } from './types';

const PSI_TO_PA = 6894.757293168;
const BISECT_ITERS = 40;
/** Pumps cavitate below this reservoir fraction. */
const CAVITATION_QTY = 0.02;

class HSystem {
  psi = 0;
  /** Fluid outside the pressurised volume at P = 0 plus stored volume: total inventory (L). */
  total: number;
  leaked = 0;
  /** Extra demand from PTU/check lines drawing from this system (L/min), last update. */
  xferDemandLpm = 0;
  readonly c: number;
  readonly accV0: number;
  readonly accPre: number;
  readonly relief: number;
  readonly leakK: number;
  readonly o: Record<'psi' | 'qty' | 'qty_pct' | 'lowpress' | 'lowqty', string>;
  readonly failLeak: string;
  constructor(
    readonly def: HydSystemDef,
    readonly idx: number,
    prefix: string,
  ) {
    this.c = (def.complianceLPerKpsi ?? 0.05) / 1000;
    this.accV0 = def.accumulator?.volumeL ?? 0;
    this.accPre = def.accumulator?.prechargePsi ?? 0;
    this.relief = def.reliefPsi ?? def.nominalPsi * 1.12;
    this.leakK = (def.internalLeakLpm ?? 0.8) / def.nominalPsi;
    this.total = def.reservoirL * (def.initialQty ?? 1);
    this.o = {
      psi: `${prefix}${def.id}_psi`,
      qty: `${prefix}${def.id}_qty`,
      qty_pct: `${prefix}${def.id}_qty_pct`,
      lowpress: `${prefix}${def.id}_lowpress`,
      lowqty: `${prefix}${def.id}_lowqty`,
    };
    this.failLeak = failVar(`hyd.${def.id}.leak`);
  }

  /** Fluid volume held under pressure P (L). */
  stored(p: number): number {
    let v = this.c * p;
    if (this.accV0 > 0 && p > this.accPre) v += this.accV0 * (1 - this.accPre / p);
    return v;
  }

  qty(): number {
    const q = (this.total - this.leaked - this.stored(this.psi)) / this.def.reservoirL;
    return q < 0 ? 0 : q;
  }
}

class Pump {
  /** Effective max flow this update (L/min) and whether the pump is turning & commanded. */
  qmax = 0;
  running = false;
  flowLpm = 0;
  readonly set: number;
  readonly band: number;
  readonly o: Record<'on' | 'lowpress' | 'flow_lpm' | 'amps' | 'va' | 'overheat', string>;
  readonly fail: string;
  readonly failHot: string;
  constructor(
    readonly def: HydPumpDef,
    readonly sys: number,
    readonly drive: Evaluator,
    readonly on: () => boolean,
    nominal: number,
    prefix: string,
  ) {
    this.set = def.ratedPsi ?? nominal;
    this.band = def.bandPsi ?? 150;
    const p = `${prefix}${def.id}_`;
    this.o = { on: `${p}on`, lowpress: `${p}lowpress`, flow_lpm: `${p}flow_lpm`, amps: `${p}amps`, va: `${p}va`, overheat: `${p}overheat` };
    this.fail = failVar(`hyd.${def.id}`);
    this.failHot = failVar(`hyd.${def.id}.overheat`);
  }

  flowAt(p: number): number {
    if (this.qmax <= 0) return 0;
    const f = (this.set - p) / this.band;
    return this.qmax * (f <= 0 ? 0 : f >= 1 ? 1 : f);
  }
}

class Xfer {
  /** Direction this update: +1 from->to, −1 to->from, 0 idle. */
  dir = 0;
  setPsi = 0;
  qmax = 0;
  flowLpm = 0;
  readonly o: Record<'active' | 'flow_lpm', string>;
  readonly fail: string;
  constructor(
    readonly def: HydTransferDef,
    readonly from: number,
    readonly to: number,
    readonly active: () => boolean,
    prefix: string,
  ) {
    this.o = { active: `${prefix}${def.id}_active`, flow_lpm: `${prefix}${def.id}_flow_lpm` };
    this.fail = failVar(`hyd.${def.id}`);
  }

  flowAt(p: number): number {
    if (this.qmax <= 0) return 0;
    const f = (this.setPsi - p) / 150;
    return this.qmax * (f <= 0 ? 0 : f >= 1 ? 1 : f);
  }
}

class Consumer {
  rate = 0;
  demand = 0;
  readonly o: string;
  constructor(
    readonly def: HydConsumerDef,
    readonly sys: number,
    readonly demandEv: Evaluator,
    readonly fullPsi: number,
    prefix: string,
  ) {
    this.o = `${prefix}${def.id}_rate`;
  }
}

export interface HydraulicSystemOptions {
  name?: string;
}

export class HydraulicSystem implements Subsystem {
  readonly name: string;
  readonly prefix: string;
  private readonly systems: HSystem[] = [];
  private readonly sysIndex = new Map<string, number>();
  private readonly pumps: Pump[] = [];
  private readonly xfers: Xfer[] = [];
  private readonly consumers: Consumer[] = [];
  private readonly ids = new IdRegistry('HydraulicSystem');
  /** Per-system inflow from transfer units this update (scratch, indexed by system). */
  private readonly xferIn: Xfer[][];

  constructor(
    private readonly vars: SimVars,
    cfg: HydraulicConfig,
    opts: HydraulicSystemOptions = {},
  ) {
    this.name = opts.name ?? 'hydraulic';
    const P = (this.prefix = cfg.prefix ?? 'hyd.');
    for (const d of cfg.systems) {
      this.ids.add(d.id, 'system');
      if (!(d.nominalPsi > 0) || !(d.reservoirL > 0)) throw new Error(`HydraulicSystem: system '${d.id}' needs nominalPsi > 0 and reservoirL > 0`);
      const s = new HSystem(d, this.systems.length, P);
      this.sysIndex.set(d.id, s.idx);
      this.systems.push(s);
      if (vars.has(s.o.psi)) s.psi = vars.get(s.o.psi);
      // Fluid already pushed into the accumulator/lines stays in the inventory.
      s.total += s.stored(s.psi);
    }
    for (const d of cfg.pumps) {
      this.ids.add(d.id, 'pump');
      const si = this.sys(d.system, `pump '${d.id}'`);
      this.pumps.push(new Pump(d, si, compileBinding(vars, d.drive), compileCondition(vars, d.on, true), this.systems[si].def.nominalPsi, P));
    }
    for (const d of cfg.transfers ?? []) {
      this.ids.add(d.id, 'transfer');
      this.xfers.push(new Xfer(d, this.sys(d.from, `transfer '${d.id}'`), this.sys(d.to, `transfer '${d.id}'`), compileCondition(vars, d.active, true), P));
    }
    for (const d of cfg.consumers ?? []) {
      this.ids.add(d.id, 'consumer');
      const si = this.sys(d.system, `consumer '${d.id}'`);
      this.consumers.push(new Consumer(d, si, compileBinding(vars, d.demandLpm), d.fullPsi ?? 0.5 * this.systems[si].def.nominalPsi, P));
    }
    this.xferIn = this.systems.map(() => []);
  }

  private sys(id: string, what: string): number {
    const i = this.sysIndex.get(id);
    if (i === undefined) throw new Error(`HydraulicSystem: ${what} references unknown system '${id}'`);
    return i;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const systems = this.systems;

    // ---- pump availability
    for (const p of this.pumps) {
      const s = systems[p.sys];
      const d = p.drive();
      const drive = d <= 0 ? 0 : d >= 1.2 ? 1.2 : d;
      p.running = p.on() && drive > 0 && vars.get(p.fail) === 0;
      p.qmax = p.running && s.qty() > CAVITATION_QTY ? p.def.maxFlowLpm * drive : 0;
    }

    // ---- transfer units (set points from the previous update's pressures)
    for (const l of this.xferIn) l.length = 0;
    for (const x of this.xfers) {
      x.dir = 0;
      x.qmax = 0;
      if (!x.active() || vars.get(x.fail) !== 0) continue;
      const a = systems[x.from];
      const b = systems[x.to];
      const eff = x.def.kind === 'check' ? 1 : (x.def.efficiency ?? 0.8);
      if (x.def.kind === 'check') {
        if (a.psi > b.psi) x.dir = 1;
      } else if (x.def.bidirectional) {
        const trig = x.def.triggerDeltaPsi ?? 500;
        if (a.psi - b.psi > trig) x.dir = 1;
        else if (b.psi - a.psi > trig) x.dir = -1;
      } else if (a.psi > 0.2 * a.def.nominalPsi) x.dir = 1;
      if (x.dir === 0) continue;
      const src = x.dir > 0 ? a : b;
      const dst = x.dir > 0 ? b : a;
      // A PTU's pump side can reach roughly its motor-side pressure (equal displacement), capped at the destination's nominal.
      x.setPsi = Math.min(dst.def.nominalPsi, x.def.kind === 'check' ? src.psi : src.psi * Math.sqrt(eff));
      x.qmax = src.qty() > CAVITATION_QTY ? x.def.maxFlowLpm : 0;
      this.xferIn[dst.idx].push(x);
    }

    // ---- consumers' demand
    for (const c of this.consumers) {
      const d = c.demandEv();
      c.demand = d > 0 ? d : 0;
    }

    // ---- solve each system
    for (const s of systems) this.solve(s, dt);

    // ---- flows at the solved pressures; transfer input flows become next update's source demand
    for (const s of systems) s.xferDemandLpm = 0;
    for (const p of this.pumps) p.flowLpm = p.flowAt(systems[p.sys].psi);
    for (const x of this.xfers) {
      if (x.dir === 0) {
        x.flowLpm = 0;
        continue;
      }
      const src = systems[x.dir > 0 ? x.from : x.to];
      const dst = systems[x.dir > 0 ? x.to : x.from];
      x.flowLpm = x.flowAt(dst.psi);
      const eff = x.def.kind === 'check' ? 1 : (x.def.efficiency ?? 0.8);
      // Power balance: Q_in·P_src·eff = Q_out·P_dst (check valve: Q_in = Q_out).
      const qin = x.def.kind === 'check' ? x.flowLpm : (x.flowLpm * dst.psi) / Math.max(1, src.psi * eff);
      src.xferDemandLpm += qin;
      // Fluid moves between reservoirs only for check lines (a PTU keeps the fluids separate).
      if (x.def.kind === 'check') {
        const v = (x.flowLpm / 60) * dt;
        src.total -= v;
        dst.total += v;
      }
    }
    for (const c of this.consumers) {
      const s = systems[c.sys];
      c.rate = Math.min(1, s.psi / c.fullPsi);
    }

    this.publish();
  }

  /** Implicit pressure step for one system (bisection on the monotone residual). */
  private solve(s: HSystem, dt: number): void {
    const p0 = s.psi;
    const v0 = s.stored(p0);
    const leaking = this.vars.get(s.failLeak) !== 0;
    const extLeak = leaking ? (s.def.leakLpm ?? 4) : 0;
    let lo = 0;
    let hi = s.relief * 1.3;
    const dtMin = dt / 60; // L/min * dt(min)
    for (let it = 0; it < BISECT_ITERS; it++) {
      const p = 0.5 * (lo + hi);
      const r = (s.stored(p) - v0) / dtMin - this.netInflow(s, p, extLeak);
      if (r > 0) hi = p;
      else lo = p;
    }
    s.psi = 0.5 * (lo + hi);
    if (s.psi < 1e-3) s.psi = 0;
    if (extLeak > 0 && s.psi > 0) s.leaked += extLeak * Math.sqrt(s.psi / s.def.nominalPsi) * dtMin;
    // A leak also drains the reservoir when the system is unpressurised only through gravity: ignored.
  }

  /** Net inflow (L/min) into system s at pressure p. Monotone decreasing in p. */
  private netInflow(s: HSystem, p: number, extLeak: number): number {
    let q = 0;
    for (const pu of this.pumps) if (pu.sys === s.idx) q += pu.flowAt(p);
    const xin = this.xferIn[s.idx];
    for (let i = 0; i < xin.length; i++) q += xin[i].flowAt(p);
    for (const c of this.consumers) {
      if (c.sys !== s.idx || c.demand <= 0) continue;
      q -= c.demand * (p >= c.fullPsi ? 1 : p / c.fullPsi);
    }
    q -= s.xferDemandLpm * Math.min(1, p / (0.2 * s.def.nominalPsi));
    q -= s.leakK * p;
    if (extLeak > 0) q -= extLeak * Math.sqrt(p / s.def.nominalPsi);
    if (p > s.relief) q -= (p - s.relief) * 2; // relief valve: 2 L/min per psi over the setting (EST, stiff)
    return q;
  }

  private publish(): void {
    const vars = this.vars;
    for (const s of this.systems) {
      const q = s.qty();
      vars.set(s.o.psi, s.psi);
      vars.set(s.o.qty, q);
      vars.set(s.o.qty_pct, q * 100);
      vars.set(s.o.lowpress, s.psi < (s.def.lowPressPsi ?? 0.5 * s.def.nominalPsi) ? 1 : 0);
      vars.set(s.o.lowqty, q < (s.def.lowQty ?? 0.2) ? 1 : 0);
    }
    for (const p of this.pumps) {
      const s = this.systems[p.sys];
      const lowThr = p.def.lowPressPsi ?? (1300 * p.set) / 3000;
      // Pump outlet pressure: system pressure while the pump delivers capability, else ~0.
      const outlet = p.qmax > 0 ? s.psi : 0;
      const low = outlet < lowThr && (p.def.lowPressWhenOff !== false || p.on());
      vars.set(p.o.on, p.qmax > 0 ? 1 : 0);
      vars.set(p.o.lowpress, low ? 1 : 0);
      vars.set(p.o.flow_lpm, p.flowLpm);
      vars.set(p.o.overheat, vars.get(p.failHot) !== 0 ? 1 : 0);
      const e = p.def.electric;
      if (e) {
        // Hydraulic power (W) = P[Pa] · Q[m³/s]; motor input = hyd / efficiency + no-load losses.
        const w = p.running ? (s.psi * PSI_TO_PA * p.flowLpm) / 60000 / (e.efficiency ?? 0.75) + (e.noLoadW ?? 250) : 0;
        if (e.supply === 'dc') vars.set(p.o.amps, w / (e.nominalV ?? 28));
        else vars.set(p.o.va, w / 0.85);
      }
    }
    for (const x of this.xfers) {
      vars.set(x.o.active, x.flowLpm > 0.05 ? 1 : 0);
      vars.set(x.o.flow_lpm, x.flowLpm);
    }
    for (const c of this.consumers) vars.set(c.o, c.rate);
  }

  // ------------------------------------------------------------ public API

  pressure(systemId: string): number {
    const i = this.sysIndex.get(systemId);
    return i === undefined ? 0 : this.systems[i].psi;
  }

  quantity(systemId: string): number {
    const i = this.sysIndex.get(systemId);
    return i === undefined ? 0 : this.systems[i].qty();
  }

  /** Refills a system's reservoir to `fraction` (servicing). */
  service(systemId: string, fraction = 1): void {
    const i = this.sysIndex.get(systemId);
    if (i === undefined) throw new Error(`HydraulicSystem: unknown system '${systemId}'`);
    const s = this.systems[i];
    s.leaked = 0;
    s.total = s.def.reservoirL * fraction + s.stored(s.psi);
  }

  /** Sets a system's pressure directly (applyState presets: e.g. engines running -> nominal). */
  setPressure(systemId: string, psi: number): void {
    const i = this.sysIndex.get(systemId);
    if (i === undefined) throw new Error(`HydraulicSystem: unknown system '${systemId}'`);
    const s = this.systems[i];
    const inv = s.total - s.stored(s.psi);
    s.psi = Math.max(0, psi);
    s.total = inv + s.stored(s.psi);
    this.vars.set(s.o.psi, s.psi);
  }

  reset(): void {
    for (const s of this.systems) {
      if (this.vars.has(s.o.psi)) this.setPressure(s.def.id, this.vars.get(s.o.psi));
    }
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    for (const p of this.pumps) {
      f.push({ id: `hyd.${p.def.id}`, name: `${p.def.id} hydraulic pump failure`, category: 'hydraulic', description: 'Pump delivers no flow: LOW PRESSURE light.' });
      if (p.def.electric) f.push({ id: `hyd.${p.def.id}.overheat`, name: `${p.def.id} overheat`, category: 'hydraulic', description: 'OVERHEAT indication (pump keeps running until switched off).' });
    }
    for (const s of this.systems) f.push({ id: `hyd.${s.def.id}.leak`, name: `${s.def.id} hydraulic leak`, category: 'hydraulic', description: 'External leak: quantity falls, then pressure is lost.' });
    for (const x of this.xfers) if (x.def.kind === 'ptu') f.push({ id: `hyd.${x.def.id}`, name: `${x.def.id} PTU failure`, category: 'hydraulic' });
    return f;
  }

  dispose(): void {
    /* nothing */
  }
}
