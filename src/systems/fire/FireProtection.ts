/**
 * Fire detection and extinguishing: engine/APU/cargo zones with single or
 * dual detection loops, fire handles, extinguisher bottles with squibs that
 * can discharge into several zones, test switches.
 *
 * Detection: each loop alarms while its zone has a fire or overheat and the
 * loop is serviceable. Dual loops (737NG: loops A and B per engine, OVHT DET
 * switch A / NORMAL / B) use AND logic in NORMAL; a faulted loop is
 * automatically deselected so the other works alone; the zone FAULT output
 * comes on when every selected loop is faulted. (737NG fire protection:
 * "If one loop fails with the OVHT DET switch in NORMAL, that loop is
 * automatically deselected and the remaining loop functions as a single
 * loop detector"; the APU has a single loop.)
 *
 * Fire: `fail.fire.<zone>` starts a fire (fire as a failure effect);
 * `fail.fire.<zone>.overheat` gives an overheat only. A fire burns until
 * extinguished: every bottle discharged into the zone (handle pulled = squibs
 * armed, discharge command, bottle pressure) raises the agent concentration,
 * and each discharge has `extinguishChance` (fuel cut) or
 * `extinguishChanceFuelOn` (fuel still flowing) of putting it out (seeded,
 * deterministic). An extinguished fire stays out until its failure is cleared
 * and set again.
 *
 * Bottles: pressure `chargePsi` (737NG engine bottles: 800 psi nitrogen-
 * pressurised Halon at 70 °F) scaled with the bottle temperature (EST
 * +0.25 %/°C), discharging to zero over `dischargeS`; DISCHARGED output
 * below 50 % of the charge.
 *
 * Outputs (prefix default 'fire.'):
 *   zone:   <zone>_warn (fire warning: handle light, bell), <zone>_ovht, <zone>_fault,
 *           <zone>_active (actual fire), <zone>_armed (handle pulled), <zone>_agent (0..),
 *           <zone>_loopa_fault, <zone>_loopb_fault
 *   bottle: <bottle>_psi, <bottle>_discharged, <bottle>_squib (squib test lamp)
 *   global: bell (any fire warning or test), test
 * Failures: fire.<zone> (fire), fire.<zone>.overheat, fire.<zone>.loopa,
 * fire.<zone>.loopb, fire.<bottle>.leak (bottle loses pressure).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { Prng } from '../../core/math';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { EdgeDetector } from '../util/timers';
import type { FailureDef } from '../failures/FailureManager';

export interface FireZoneDef {
  id: string;
  /** Number of detection loops (default 2). */
  loops?: 1 | 2;
  /** Loop selection: 0 NORMAL (both), 1 loop A only, 2 loop B only. Default 0. */
  loopSelect?: Binding;
  /** Fire handle pulled / fire push-button pushed: arms the squibs. */
  handle: Binding;
  /** Discharge commands (handle rotated L/R, DISCH buttons): bottle id + command. */
  discharge?: { bottle: string; command: Binding }[];
  /** Fuel to the zone cut (default = handle pulled; e.g. 'fire.eng1_armed || !ac.start_lever1'). */
  fuelCut?: Binding;
  /** Automatic discharge (e.g. APU fire on the ground): bottle, condition and delay (s). */
  autoDischarge?: { bottle: string; condition: Binding; delayS: number };
  /** Detection power (default always). */
  power?: Binding;
  /** Probability that one bottle extinguishes the fire with the fuel cut (default 0.9) / fuel still flowing (default 0.3). EST. */
  extinguishChance?: number;
  extinguishChanceFuelOn?: number;
  /**
   * Per-zone test override (additive): when given, this zone follows these test conditions instead of the
   * system-wide `FireConfig.test` (e.g. the 737 cargo smoke detectors have their own TEST switch and are not
   * part of the engine OVHT/FIRE test).
   */
  test?: { fire?: Binding; fault?: Binding };
}

export interface FireBottleDef {
  id: string;
  /** Charge pressure at 21 °C (psi). */
  chargePsi: number;
  /** Discharge duration (s). Default 1.5 (EST). */
  dischargeS?: number;
  /** Bottle temperature (°C) for the pressure indication. Default 21. */
  tempC?: Binding;
}

export interface FireConfig {
  prefix?: string;
  zones: FireZoneDef[];
  bottles: FireBottleDef[];
  /** FIRE/OVHT test (all zones warn, bell) and FAULT/INOP test (fault lights, squib lamps). */
  test?: { fire?: Binding; fault?: Binding };
  /** Seed for the extinguishing dice (default 7). */
  seed?: number;
}

class Bottle {
  /** Remaining charge fraction 0..1. */
  charge = 1;
  discharging = false;
  readonly temp: Evaluator;
  readonly o: Record<'psi' | 'discharged' | 'squib', string>;
  readonly failLeak: string;
  constructor(
    readonly def: FireBottleDef,
    vars: SimVars,
    prefix: string,
  ) {
    this.temp = compileBinding(vars, def.tempC, 21);
    this.o = { psi: `${prefix}${def.id}_psi`, discharged: `${prefix}${def.id}_discharged`, squib: `${prefix}${def.id}_squib` };
    this.failLeak = failVar(`fire.${def.id}.leak`);
    if (vars.has(this.o.psi)) this.charge = Math.max(0, Math.min(1, vars.get(this.o.psi) / def.chargePsi));
  }
}

class Zone {
  fire = false;
  extinguished = false;
  agent = 0;
  autoTimer = 0;
  readonly handle: () => boolean;
  readonly select: Evaluator;
  readonly fuelCut: () => boolean;
  readonly power: () => boolean;
  readonly discharge: { bottle: number; cmd: () => boolean; edge: EdgeDetector }[];
  readonly auto: { bottle: number; cond: () => boolean; delayS: number; fired: boolean } | null;
  readonly o: Record<'warn' | 'ovht' | 'fault' | 'active' | 'armed' | 'agent' | 'loopa_fault' | 'loopb_fault', string>;
  readonly fFire: string;
  readonly fOvht: string;
  readonly fLoopA: string;
  readonly fLoopB: string;
  /** Per-zone test override (null = system-wide test). */
  readonly testFire: (() => boolean) | null;
  readonly testFault: (() => boolean) | null;
  constructor(
    readonly def: FireZoneDef,
    vars: SimVars,
    prefix: string,
    bottleIndex: (id: string) => number,
  ) {
    this.handle = compileCondition(vars, def.handle, false);
    this.select = compileBinding(vars, def.loopSelect, 0);
    this.fuelCut = def.fuelCut !== undefined ? compileCondition(vars, def.fuelCut, false) : this.handle;
    this.power = compileCondition(vars, def.power, true);
    this.discharge = (def.discharge ?? []).map((d) => ({ bottle: bottleIndex(d.bottle), cmd: compileCondition(vars, d.command, false), edge: new EdgeDetector() }));
    this.auto = def.autoDischarge
      ? { bottle: bottleIndex(def.autoDischarge.bottle), cond: compileCondition(vars, def.autoDischarge.condition, false), delayS: def.autoDischarge.delayS, fired: false }
      : null;
    const p = `${prefix}${def.id}_`;
    this.o = {
      warn: `${p}warn`,
      ovht: `${p}ovht`,
      fault: `${p}fault`,
      active: `${p}active`,
      armed: `${p}armed`,
      agent: `${p}agent`,
      loopa_fault: `${p}loopa_fault`,
      loopb_fault: `${p}loopb_fault`,
    };
    this.fFire = failVar(`fire.${def.id}`);
    this.fOvht = failVar(`fire.${def.id}.overheat`);
    this.fLoopA = failVar(`fire.${def.id}.loopa`);
    this.fLoopB = failVar(`fire.${def.id}.loopb`);
    this.testFire = def.test ? compileCondition(vars, def.test.fire, false) : null;
    this.testFault = def.test ? compileCondition(vars, def.test.fault, false) : null;
  }
}

export class FireProtection implements Subsystem {
  readonly name = 'fire';
  readonly prefix: string;
  private readonly zones: Zone[] = [];
  private readonly bottles: Bottle[] = [];
  private readonly rng: Prng;
  private readonly testFire: () => boolean;
  private readonly testFault: () => boolean;
  private readonly vBell: string;
  private readonly vTest: string;

  constructor(
    private readonly vars: SimVars,
    cfg: FireConfig,
  ) {
    const P = (this.prefix = cfg.prefix ?? 'fire.');
    const ids = new IdRegistry('FireProtection');
    for (const b of cfg.bottles) {
      ids.add(b.id, 'bottle');
      this.bottles.push(new Bottle(b, vars, P));
    }
    const bi = (id: string): number => {
      const i = this.bottles.findIndex((b) => b.def.id === id);
      if (i < 0) throw new Error(`FireProtection: unknown bottle '${id}'`);
      return i;
    };
    for (const z of cfg.zones) {
      ids.add(z.id, 'zone');
      this.zones.push(new Zone(z, vars, P, bi));
    }
    this.rng = new Prng(cfg.seed ?? 7);
    this.testFire = compileCondition(vars, cfg.test?.fire, false);
    this.testFault = compileCondition(vars, cfg.test?.fault, false);
    this.vBell = `${P}bell`;
    this.vTest = `${P}test`;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const tFire = this.testFire();
    const tFault = this.testFault();
    let bell = tFire;

    // ---- bottles: discharge progress and leaks
    for (const b of this.bottles) {
      if (b.discharging) {
        b.charge -= dt / (b.def.dischargeS ?? 1.5);
        if (b.charge <= 0) {
          b.charge = 0;
          b.discharging = false;
        }
      }
      if (vars.get(b.failLeak) !== 0 && b.charge > 0) b.charge = Math.max(0, b.charge - dt / 600); // EST: slow leak over 10 min
    }

    for (const z of this.zones) {
      const d = z.def;
      // ---- fire state
      const failFire = vars.get(z.fFire) !== 0;
      if (!failFire) {
        z.fire = false;
        z.extinguished = false;
      } else if (!z.extinguished) z.fire = true;
      const armed = z.handle();

      // ---- discharges
      for (const dc of z.discharge) {
        if (dc.edge.rising(dc.cmd()) && armed) this.fireBottle(dc.bottle, z);
      }
      if (z.auto) {
        if (z.auto.cond() && !z.auto.fired) {
          z.autoTimer += dt;
          if (z.autoTimer >= z.auto.delayS) {
            z.auto.fired = true;
            this.fireBottle(z.auto.bottle, z);
          }
        } else if (!z.auto.cond()) {
          z.autoTimer = 0;
          z.auto.fired = false;
        }
      }
      z.agent -= z.agent * (1 - Math.exp(-dt / 20)); // EST: agent concentration decays over ~20 s

      // ---- detection loops
      const powered = z.power();
      const heat = (z.fire || vars.get(z.fOvht) !== 0) && powered;
      const aFault = vars.get(z.fLoopA) !== 0;
      const bFault = (d.loops ?? 2) === 2 ? vars.get(z.fLoopB) !== 0 : true;
      const dual = (d.loops ?? 2) === 2;
      const sel = Math.round(z.select());
      const aAlarm = heat && !aFault;
      const bAlarm = heat && dual && !bFault;
      let detect: boolean;
      let fault: boolean;
      if (!dual || sel === 1) {
        detect = aAlarm;
        fault = aFault;
      } else if (sel === 2) {
        detect = bAlarm;
        fault = bFault;
      } else {
        // NORMAL: AND logic, a faulted loop is deselected.
        if (aFault && bFault) detect = false;
        else if (aFault) detect = bAlarm;
        else if (bFault) detect = aAlarm;
        else detect = aAlarm && bAlarm;
        fault = aFault && bFault;
      }
      const zFire = z.testFire ? z.testFire() : tFire;
      const zFault = z.testFault ? z.testFault() : tFault;
      const fireWarn = (detect && z.fire) || zFire;
      const ovht = (detect && !z.fire) || zFire;
      if (fireWarn) bell = true;
      vars.set(z.o.warn, fireWarn ? 1 : 0);
      vars.set(z.o.ovht, ovht ? 1 : 0);
      vars.set(z.o.fault, (fault && powered) || zFault ? 1 : 0);
      vars.set(z.o.active, z.fire ? 1 : 0);
      vars.set(z.o.armed, armed ? 1 : 0);
      vars.set(z.o.agent, z.agent);
      vars.set(z.o.loopa_fault, aFault ? 1 : 0);
      vars.set(z.o.loopb_fault, dual && vars.get(z.fLoopB) !== 0 ? 1 : 0);
    }

    for (const b of this.bottles) {
      const psi = b.def.chargePsi * b.charge * (1 + 0.0025 * (b.temp() - 21));
      vars.set(b.o.psi, Math.max(0, psi));
      vars.set(b.o.discharged, b.charge < 0.5 ? 1 : 0);
      vars.set(b.o.squib, tFault && b.charge > 0 ? 1 : 0);
    }
    vars.set(this.vBell, bell ? 1 : 0);
    vars.set(this.vTest, tFire || tFault ? 1 : 0);
  }

  private fireBottle(bi: number, z: Zone): void {
    const b = this.bottles[bi];
    if (b.charge <= 0.05 || b.discharging) return;
    b.discharging = true;
    z.agent += b.charge;
    if (z.fire) {
      const p = z.fuelCut() ? (z.def.extinguishChance ?? 0.9) : (z.def.extinguishChanceFuelOn ?? 0.3);
      if (this.rng.next() < p) {
        z.extinguished = true;
        z.fire = false;
      }
    }
  }

  /** Recharges every bottle (maintenance). */
  rechargeBottles(): void {
    for (const b of this.bottles) {
      b.charge = 1;
      b.discharging = false;
    }
  }

  isFire(zoneId: string): boolean {
    return this.zones.find((z) => z.def.id === zoneId)?.fire ?? false;
  }

  reset(): void {
    for (const b of this.bottles) {
      if (this.vars.has(b.o.psi)) b.charge = Math.max(0, Math.min(1, this.vars.get(b.o.psi) / b.def.chargePsi));
      b.discharging = false;
    }
    for (const z of this.zones) {
      z.agent = 0;
      z.autoTimer = 0;
    }
  }

  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    const c = 'fire';
    for (const z of this.zones) {
      f.push({ id: `fire.${z.def.id}`, name: `${z.def.id} fire`, category: c, description: 'Fire in the zone until extinguished.' });
      f.push({ id: `fire.${z.def.id}.overheat`, name: `${z.def.id} overheat`, category: c, description: 'Overheat detection only.' });
      f.push({ id: `fire.${z.def.id}.loopa`, name: `${z.def.id} detection loop A fault`, category: c });
      if ((z.def.loops ?? 2) === 2) f.push({ id: `fire.${z.def.id}.loopb`, name: `${z.def.id} detection loop B fault`, category: c });
    }
    for (const b of this.bottles) f.push({ id: `fire.${b.def.id}.leak`, name: `${b.def.id} bottle leak`, category: c, description: 'Bottle pressure lost: DISCHARGED indication.' });
    return f;
  }

  dispose(): void {
    /* nothing */
  }
}
