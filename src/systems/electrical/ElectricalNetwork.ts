/**
 * Data-driven aircraft electrical network, solved every systems update.
 *
 * Topology: buses (DC or AC) joined by links (contactors/relays with optional
 * coils and feeder breakers, or steering diodes). Sources attach to buses:
 * batteries, DC generators (starter-generators, alternators), AC generators
 * (IDG/VFG/APU/RAT/ADG), external power (DC or AC GPU), TRUs (AC -> DC) and
 * static inverters (DC -> AC). Loads and electric starters draw from buses
 * through circuit breakers.
 *
 * Solution each update (dt = 1/60 s):
 *  1. Commands: bindings (switches, automatic logic), breakers, failures,
 *     relay coils (energised from the previous solution's coil-bus voltage,
 *     with pick-up/drop-out hysteresis — a flat battery makes relays chatter).
 *  2. AC: buses joined by closed links form islands. An island with online
 *     sources is at nominal voltage with a small load droop (collapsing when
 *     overloaded past the sources' short-time rating); its load is shared by
 *     the sources in proportion to their rating. SCOPE: AC sources are not
 *     synchronised or paralleled; aircraft bus-tie logic must keep one source
 *     per island (as the real BTB/GCB interlocks do).
 *  3. DC: islands are solved for the voltage V at which the source currents
 *     (Thevenin EMF + resistance with current limits; generators cannot sink
 *     current; batteries charge with a tapering acceptance) balance the load
 *     currents. f(V) = Σ I_src(V) − Σ I_load(V) is monotone decreasing, so all
 *     islands are bisected together (32 iterations, allocation-free). Diodes
 *     are ideal: a conducting diode merges its buses; after each solve a
 *     diode whose bridge current reverses opens, and an open diode whose anode
 *     island is at a higher voltage than its cathode island closes (max 4
 *     passes).
 *  4. Battery state of charge (Peukert discharge, coulombic charge
 *     efficiency, temperature-dependent capacity and resistance), battery
 *     temperature, thermal breaker heating/tripping, generator over-voltage
 *     and overload trips.
 *
 * Output vars (prefix default 'elec.'):
 *   bus:        <id>_v, <id>_powered, <id>_amps (sum of loads on the bus; AC: VA/V), <id>_hz (AC)
 *   battery:    <id>_v, <id>_amps (+ = charging, − = discharging: ammeter sign), <id>_soc (0..1),
 *               <id>_temp_c, <id>_overtemp
 *   dc gen:     <id>_v, <id>_amps, <id>_load_pct, <id>_online, <id>_avail, <id>_tripped,
 *               and with a starter: <id>_starter (engaged), <id>_starter_amps
 *   starter:    <id>_engaged, <id>_amps, <id>_contactor
 *   ac gen:     <id>_v, <id>_hz, <id>_kva, <id>_load_pct, <id>_online, <id>_avail, <id>_tripped,
 *               <id>_disconnected, <id>_drive_lowpress (IDG/CSD low oil pressure: disconnected, not turning or failed)
 *   external:   <id>_avail, <id>_online, <id>_amps (DC) or <id>_kva (AC)
 *   tru:        <id>_v, <id>_amps, <id>_online, <id>_fail
 *   inverter:   <id>_online, <id>_va, <id>_dc_amps
 *   link:       <id>_closed, <id>_amps (bridge links only; 0 otherwise)
 *   load:       <id>_powered, <id>_v, <id>_amps (AC: VA/V)
 *   breakers:   cb.<name> (written 0 on trip), cb.<name>_tripped
 *
 * Failures read (register them with `failures()`): fail.elec.<bus>.fault,
 * fail.elec.<battery> (open cell), fail.elec.<battery>.thermal (thermal
 * runaway), fail.elec.<gen> (generator), fail.elec.<dcgen>.regulator
 * (runaway over-voltage), fail.elec.<acgen>.drive (IDG low oil pressure ->
 * generator lost until disconnected & reconnected), fail.elec.<tru>,
 * fail.elec.<inverter>, fail.elec.<link>.open / .closed (contactor stuck),
 * fail.elec.<load>.short (overcurrent -> breaker trip), fail.elec.<starter>
 * (starter/relay failed open).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import type { Table1D } from '../../physics/types';
import { interp1 } from '../../core/math';
import { compileBinding, compileCondition, type Evaluator } from '../util/binding';
import { IdRegistry, failVar } from '../util/ids';
import { StarterDriver } from '../util/starter';
import type { FailureDef } from '../failures/FailureManager';
import { CAPACITY_TEMP_COEFF, DEFAULT_CELLS, DEFAULT_OCV, DEFAULT_PEUKERT, RESISTANCE_TEMP_COEFF } from './presets';
import type {
  AcGeneratorDef,
  BatteryChemistry,
  BatteryDef,
  BusDef,
  CircuitBreakerDef,
  CoilDef,
  DcGeneratorDef,
  ElectricalConfig,
  ExternalPowerDef,
  InverterDef,
  LinkDef,
  LoadDef,
  LoadModel,
  StarterDef,
  StarterMotorDef,
  TruDef,
} from './types';

// ------------------------------------------------------------------ constants

/** Bisection iterations: 60 V / 2^26 ≈ 0.9 µV resolution (0.1 mA through a 10 mΩ battery). */
const BISECT_ITERS = 26;
/** Upper voltage bound for DC islands. */
const V_MAX_DC = 60;
/** Max diode re-solve passes per update. */
const MAX_DIODE_PASSES = 4;
/**
 * Thermal breaker trip model (EST, shaped like MIL-PRF-5809 / Klixon 7274
 * curves: no trip at ≤ 110 % rating, ~7 s at 200 %, ~0.8 s at 500 %,
 * ~0.2 s at 1000 %): dh/dt = ((I/Ir)² − 1.1²)/τ above 110 %, trip at h ≥ 1;
 * below 110 % the element cools with τ = 30 s.
 */
const CB_NO_TRIP_RATIO = 1.1;
const CB_HEAT_TAU_S = 20;
const CB_COOL_TAU_S = 30;
/** Multiple of the rating (or nominal draw) drawn by a shorted load. */
const SHORT_CIRCUIT_MULT = 10;
/** EST: runaway regulator drives the field to ~34.5 V before over-voltage protection trips it. */
const REGULATOR_RUNAWAY_V = 34.5;
/** AC droop at 100 % rated load (EST, 2 %). */
const AC_DROOP_AT_RATED = 0.02;
/** AC sources hold voltage up to this multiple of rating (short-time overload), then collapse (EST). */
const AC_COLLAPSE_RATIO = 2.0;
/** Coulombic charge efficiency by chemistry (EST). */
const CHARGE_EFFICIENCY: Record<BatteryChemistry, number> = { 'lead-acid': 0.9, nicd: 0.83, 'li-ion': 0.98 };
/** Rate ratio (I / C1) above which the Peukert penalty stops growing (EST, see postDc). */
const PEUKERT_MAX_RATE = 3;
/** Below this SOC the battery's internal resistance rises exponentially to x1000 at SOC 0 (EST). */
const EXHAUSTION_SOC = 0.02;
const EXHAUSTION_LN_FACTOR = Math.log(1000);
/** Thermal-runaway extra heat (W) while fail.elec.<battery>.thermal is active (EST). */
const THERMAL_RUNAWAY_W = 400;

// ------------------------------------------------------------------ helpers

class Breaker {
  heat = 0;
  current = 0;
  readonly varIn: string;
  readonly varTrip: string;
  constructor(
    readonly name: string,
    readonly ratingA: number,
  ) {
    this.varIn = `cb.${name}`;
    this.varTrip = `cb.${name}_tripped`;
  }
}

class Coil {
  energized = false;
  timer = 0;
  constructor(
    readonly bus: number,
    readonly pickupV: number,
    readonly dropoutV: number,
    readonly delayS: number,
  ) {}

  update(v: number, dt: number): boolean {
    if (this.energized) {
      if (v < this.dropoutV) {
        this.energized = false;
        this.timer = 0;
      }
    } else if (v >= this.pickupV) {
      this.timer += dt;
      if (this.timer >= this.delayS) this.energized = true;
    } else {
      this.timer = 0;
    }
    return this.energized;
  }
}

interface Outs {
  [k: string]: string;
}

function outs(prefix: string, id: string, suffixes: readonly string[]): Outs {
  const o: Outs = {};
  for (const s of suffixes) o[s] = `${prefix}${id}_${s}`;
  return o;
}

class Bus {
  v = 0;
  hz = 0;
  /** Sum of load current (DC A) or VA (AC) on this bus this update. */
  load = 0;
  faulted = false;
  readonly o: Outs;
  readonly fail: string;
  constructor(
    readonly idx: number,
    readonly id: string,
    readonly ac: boolean,
    readonly nominalV: number,
    readonly poweredV: number,
    prefix: string,
  ) {
    this.o = outs(prefix, id, ac ? ['v', 'powered', 'amps', 'hz'] : ['v', 'powered', 'amps']);
    this.fail = failVar(`elec.${id}.fault`);
  }
}

class Link {
  closedCmd = false;
  /** Contactor closed (or diode allowed to conduct). */
  closed = false;
  /** Diode currently conducting (merged). */
  conducting = false;
  amps = 0;
  readonly o: Outs;
  readonly failOpen: string;
  readonly failClosed: string;
  constructor(
    readonly idx: number,
    readonly id: string,
    readonly a: number,
    readonly b: number,
    readonly ac: boolean,
    readonly diode: boolean,
    readonly cmd: () => boolean,
    readonly coil: Coil | null,
    readonly cb: Breaker | null,
    prefix: string,
  ) {
    this.o = outs(prefix, id, ['closed', 'amps']);
    this.failOpen = failVar(`elec.${id}.open`);
    this.failClosed = failVar(`elec.${id}.closed`);
  }
}

class Load {
  active = false;
  demand = 0;
  current = 0;
  powered = false;
  readonly o: Outs;
  readonly failShort: string;
  constructor(
    readonly idx: number,
    readonly id: string,
    readonly bus: number,
    readonly ac: boolean,
    readonly amount: Evaluator,
    readonly model: LoadModel,
    readonly enabled: () => boolean,
    readonly shed: () => boolean,
    readonly cb: Breaker | null,
    readonly minV: number,
    readonly coil: Coil | null,
    prefix: string,
  ) {
    this.o = outs(prefix, id, ['powered', 'v', 'amps']);
    this.failShort = failVar(`elec.${id}.short`);
  }
}

class Battery {
  soc: number;
  tempC = 20;
  ambient = 20;
  /** Open-circuit EMF, discharge resistance, charge threshold EMF, charge resistance, charge current cap. */
  E = 0;
  R = 0.01;
  Ec = 0;
  Rc = 0.03;
  IcMax = 0;
  open = false;
  /** Current at the solved voltage, + = discharging. */
  current = 0;
  readonly o: Outs;
  readonly failOpen: string;
  readonly failThermal: string;
  readonly cells: number;
  readonly ocv: Table1D;
  readonly fullChargeV: number;
  readonly taper: number;
  readonly chargeRFactor: number;
  readonly maxChargeC: number;
  readonly peukert: number;
  readonly chemistry: BatteryChemistry;
  constructor(
    readonly idx: number,
    readonly def: BatteryDef,
    readonly bus: number,
    readonly ambientEv: Evaluator,
    prefix: string,
    initialSoc: number,
  ) {
    const chem = def.chemistry ?? 'lead-acid';
    this.chemistry = chem;
    this.cells = def.cells ?? DEFAULT_CELLS[chem];
    this.ocv = def.ocvPerCell ?? DEFAULT_OCV[chem];
    this.fullChargeV = def.fullChargeV ?? 28.5 * (this.cells * interp1(this.ocv, 1)) / (DEFAULT_CELLS[chem] * interp1(DEFAULT_OCV[chem], 1));
    this.taper = def.chargeTaper ?? 5;
    this.chargeRFactor = def.chargeResistanceFactor ?? 3;
    this.maxChargeC = def.maxChargeC ?? 2;
    this.peukert = def.peukert ?? DEFAULT_PEUKERT[chem];
    this.soc = initialSoc;
    this.o = outs(prefix, def.id, ['v', 'amps', 'soc', 'temp_c', 'overtemp']);
    this.failOpen = failVar(`elec.${def.id}`);
    this.failThermal = failVar(`elec.${def.id}.thermal`);
  }

  /** Capacity (Ah) at the current temperature. */
  capacity(): number {
    const k = CAPACITY_TEMP_COEFF[this.chemistry];
    const f = 1 - k * Math.max(0, 25 - this.tempC);
    return this.def.capacityAh * (f < 0.4 ? 0.4 : f);
  }

  prepare(): void {
    const soc = this.soc < 0 ? 0 : this.soc > 1 ? 1 : this.soc;
    this.E = this.cells * interp1(this.ocv, soc);
    // Resistance: cold battery (Concorde Ipp ratio), a rise over the last 20 % of charge and
    // exhaustion of the active material over the last 2 % (x1000 at SOC 0), so a flat battery
    // keeps its open-circuit voltage but collapses under any load (EST shape).
    const cold = 1 + RESISTANCE_TEMP_COEFF * Math.max(0, 25 - this.tempC);
    const empty = soc < 0.2 ? 1 + 3 * ((0.2 - soc) / 0.2) ** 2 : 1;
    const exhausted = soc < EXHAUSTION_SOC ? Math.exp(EXHAUSTION_LN_FACTOR * (1 - soc / EXHAUSTION_SOC)) : 1;
    this.R = this.def.internalResistanceOhm * cold * empty * exhausted;
    // Charge acceptance: the charging EMF rises toward fullChargeV as SOC -> 1 (taper exponent).
    const Efull = this.cells * interp1(this.ocv, 1);
    const eta = Math.max(0, this.fullChargeV - Efull) * soc ** this.taper;
    this.Ec = this.E + eta;
    this.Rc = this.R * this.chargeRFactor;
    this.IcMax = this.maxChargeC * this.def.capacityAh;
  }

  /** Current (A, + = discharge) at terminal voltage v. Monotone non-increasing in v. */
  currentAt(v: number): number {
    if (this.open) return 0;
    if (v <= this.E) return (this.E - v) / this.R;
    if (v <= this.Ec) return 0;
    const ic = (v - this.Ec) / this.Rc;
    return -(ic < this.IcMax ? ic : this.IcMax);
  }
}

class Starter {
  engaged = false;
  cmdOn = false;
  current = 0;
  motorV = 0;
  readonly driver: StarterDriver | null;
  readonly o: Outs;
  readonly fail: string;
  constructor(
    readonly id: string,
    readonly bus: number,
    readonly cmd: () => boolean,
    readonly speed: Evaluator,
    readonly noLoadSpeed: number,
    readonly R: number,
    readonly Ilim: number,
    readonly nominalV: number,
    readonly coil: Coil | null,
    readonly cb: Breaker | null,
    driver: StarterDriver | null,
    prefix: string,
    outId: string,
  ) {
    this.driver = driver;
    this.o = outs(prefix, outId, ['engaged', 'amps', 'contactor']);
    this.fail = failVar(`elec.${id}`);
  }

  backEmf(): number {
    const s = this.speed();
    return s > 0 ? (this.nominalV * s) / this.noLoadSpeed : 0;
  }

  currentAt(v: number, eb: number): number {
    const i = (v - eb) / this.R;
    return i <= 0 ? 0 : i > this.Ilim ? this.Ilim : i;
  }
}

class DcGen {
  online = false;
  avail = false;
  tripped = false;
  ovTimer = 0;
  E = 28.5;
  Ilim = 0;
  current = 0;
  drive = 0;
  private prevSwitch = true;
  private prevReset = false;
  readonly o: Outs;
  readonly fail: string;
  readonly failReg: string;
  constructor(
    readonly idx: number,
    readonly def: DcGeneratorDef,
    readonly bus: number,
    readonly driveEv: Evaluator,
    readonly sw: () => boolean,
    readonly resetEv: () => boolean,
    readonly fieldBus: number,
    readonly starter: Starter | null,
    prefix: string,
  ) {
    this.o = outs(prefix, def.id, ['v', 'amps', 'load_pct', 'online', 'avail', 'tripped', 'starter', 'starter_amps']);
    this.fail = failVar(`elec.${def.id}`);
    this.failReg = failVar(`elec.${def.id}.regulator`);
  }

  /** Switch-cycle and reset-edge handling for the trip latch. */
  handleReset(): void {
    const sw = this.sw();
    const rs = this.resetEv();
    if ((sw && !this.prevSwitch) || (rs && !this.prevReset)) {
      this.tripped = false;
      this.ovTimer = 0;
    }
    this.prevSwitch = sw;
    this.prevReset = rs;
  }

  currentAt(v: number): number {
    if (!this.online) return 0;
    const i = (this.E - v) / (this.def.outputResistanceOhm ?? 0.0015);
    return i <= 0 ? 0 : i > this.Ilim ? this.Ilim : i;
  }
}

class AcGen {
  online = false;
  avail = false;
  tripped = false;
  disconnected = false;
  overloadTimer = 0;
  hz = 0;
  va = 0;
  v = 0;
  private prevDisc = false;
  private prevReset = false;
  private prevSwitch = true;
  readonly ratedVa: number;
  readonly o: Outs;
  readonly fail: string;
  readonly failDrive: string;
  constructor(
    readonly idx: number,
    readonly def: AcGeneratorDef,
    readonly bus: number,
    readonly driveEv: Evaluator,
    readonly sw: () => boolean,
    readonly disc: () => boolean,
    readonly resetEv: () => boolean,
    prefix: string,
  ) {
    this.ratedVa = def.ratedKva * 1000;
    this.o = outs(prefix, def.id, ['v', 'hz', 'kva', 'load_pct', 'online', 'avail', 'tripped', 'disconnected', 'drive_lowpress']);
    this.fail = failVar(`elec.${def.id}`);
    this.failDrive = failVar(`elec.${def.id}.drive`);
  }

  handleEdges(): void {
    const d = this.disc();
    if (d && !this.prevDisc) this.disconnected = true;
    this.prevDisc = d;
    const r = this.resetEv();
    const s = this.sw();
    if ((r && !this.prevReset) || (s && !this.prevSwitch)) {
      this.tripped = false;
      this.overloadTimer = 0;
    }
    this.prevReset = r;
    this.prevSwitch = s;
  }
}

class External {
  online = false;
  avail = false;
  current = 0;
  va = 0;
  readonly o: Outs;
  constructor(
    readonly idx: number,
    readonly def: ExternalPowerDef,
    readonly bus: number,
    readonly ac: boolean,
    readonly availEv: () => boolean,
    readonly sw: () => boolean,
    prefix: string,
  ) {
    this.o = outs(prefix, def.id, ac ? ['avail', 'online', 'kva'] : ['avail', 'online', 'amps']);
  }

  currentAt(v: number): number {
    if (!this.online) return 0;
    const i = ((this.def.voltage ?? 28) - v) / (this.def.resistanceOhm ?? 0.004);
    const lim = this.def.currentLimitA ?? 1500;
    return i <= 0 ? 0 : i > lim ? lim : i;
  }
}

class Tru {
  online = false;
  enabledNow = false;
  current = 0;
  /** AC-side load (VA) from the last DC solution. */
  acVa = 0;
  readonly noLoadV: number;
  readonly R: number;
  readonly Ilim: number;
  readonly o: Outs;
  readonly fail: string;
  constructor(
    readonly idx: number,
    readonly def: TruDef,
    readonly acBus: number,
    readonly dcBus: number,
    readonly enabled: () => boolean,
    prefix: string,
  ) {
    this.noLoadV = def.noLoadV ?? 28.5;
    const full = def.fullLoadV ?? 27.0;
    this.R = Math.max(1e-4, (this.noLoadV - full) / def.ratedA);
    this.Ilim = def.currentLimitA ?? def.ratedA * 1.3;
    this.o = outs(prefix, def.id, ['v', 'amps', 'online', 'fail']);
    this.fail = failVar(`elec.${def.id}`);
  }

  currentAt(v: number): number {
    if (!this.online) return 0;
    const i = (this.noLoadV - v) / this.R;
    return i <= 0 ? 0 : i > this.Ilim ? this.Ilim : i;
  }
}

class Inverter {
  online = false;
  va = 0;
  dcAmps = 0;
  readonly o: Outs;
  readonly fail: string;
  constructor(
    readonly idx: number,
    readonly def: InverterDef,
    readonly dcBus: number,
    readonly acBus: number,
    readonly enabled: () => boolean,
    prefix: string,
  ) {
    this.o = outs(prefix, def.id, ['online', 'va', 'dc_amps']);
    this.fail = failVar(`elec.${def.id}`);
  }
}

// ------------------------------------------------------------------ network

export interface ElectricalNetworkOptions {
  /** Subsystem name (default 'electrical'). */
  name?: string;
}

export class ElectricalNetwork implements Subsystem {
  readonly name: string;
  readonly prefix: string;

  private readonly buses: Bus[] = [];
  private readonly busIndex = new Map<string, number>();
  private readonly links: Link[] = [];
  private readonly loads: Load[] = [];
  private readonly batteries: Battery[] = [];
  private readonly dcGens: DcGen[] = [];
  private readonly acGens: AcGen[] = [];
  private readonly externals: External[] = [];
  private readonly trus: Tru[] = [];
  private readonly inverters: Inverter[] = [];
  private readonly starters: Starter[] = [];
  private readonly breakers = new Map<string, Breaker>();
  private readonly breakerList: Breaker[] = [];
  private readonly ids = new IdRegistry('ElectricalNetwork');

  // Solver scratch (allocated once).
  private readonly parent: Int32Array;
  private readonly parent2: Int32Array;
  private readonly island: Int32Array;
  private readonly rootToIsland: Int32Array;
  private islandCount = 0;
  private readonly lo: Float64Array;
  private readonly hi: Float64Array;
  private readonly mid: Float64Array;
  private readonly net: Float64Array;
  private readonly islandV: Float64Array;
  private readonly acCap: Float64Array;
  private readonly acLoad: Float64Array;
  private readonly acHz: Float64Array;
  /** Fraction of the demanded AC load actually delivered per island root (< 1 when overloaded). */
  private readonly acFrac: Float64Array;
  private readonly starterEb: Float64Array;

  constructor(
    private readonly vars: SimVars,
    cfg: ElectricalConfig,
    opts: ElectricalNetworkOptions = {},
  ) {
    this.name = opts.name ?? 'electrical';
    this.prefix = cfg.prefix ?? 'elec.';
    const P = this.prefix;

    // ---- buses
    for (const b of cfg.buses) {
      this.ids.add(b.id, 'bus');
      const ac = (b.type ?? 'dc') === 'ac';
      const nominal = b.nominalV ?? (ac ? 115 : 28);
      const bus = new Bus(this.buses.length, b.id, ac, nominal, b.poweredV ?? (ac ? 100 : 18), P);
      this.busIndex.set(b.id, bus.idx);
      this.buses.push(bus);
    }
    const nb = this.buses.length;
    if (nb === 0) throw new Error('ElectricalNetwork: at least one bus is required');
    this.parent = new Int32Array(nb);
    this.parent2 = new Int32Array(nb);
    this.island = new Int32Array(nb);
    this.rootToIsland = new Int32Array(nb);
    this.lo = new Float64Array(nb);
    this.hi = new Float64Array(nb);
    this.mid = new Float64Array(nb);
    this.net = new Float64Array(nb);
    this.islandV = new Float64Array(nb);
    this.acCap = new Float64Array(nb);
    this.acLoad = new Float64Array(nb);
    this.acHz = new Float64Array(nb);
    this.acFrac = new Float64Array(nb).fill(1);

    // ---- batteries
    for (const d of cfg.batteries ?? []) {
      this.ids.add(d.id, 'battery');
      const bus = this.busOf(d.bus, 'dc', `battery '${d.id}'`);
      if (!(d.capacityAh > 0) || !(d.internalResistanceOhm > 0)) throw new Error(`ElectricalNetwork: battery '${d.id}' needs capacityAh > 0 and internalResistanceOhm > 0`);
      const socVar = `${P}${d.id}_soc`;
      const soc0 = vars.has(socVar) ? vars.get(socVar) : (d.initialSoc ?? 1);
      const bat = new Battery(this.batteries.length, d, bus, compileBinding(vars, d.ambientC, 20), P, clamp01(soc0));
      bat.tempC = vars.has(bat.o.temp_c) ? vars.get(bat.o.temp_c) : bat.ambientEv();
      this.batteries.push(bat);
    }

    // ---- starters (standalone)
    for (const d of cfg.starters ?? []) {
      this.ids.add(d.id, 'starter');
      this.starters.push(this.makeStarter(d.id, d, this.busOf(d.bus, 'dc', `starter '${d.id}'`), d.id));
    }

    // ---- DC generators
    for (const d of cfg.dcGenerators ?? []) {
      this.ids.add(d.id, 'dc generator');
      const bus = this.busOf(d.bus, 'dc', `dc generator '${d.id}'`);
      let starter: Starter | null = null;
      if (d.starter) {
        const sb = d.starter.bus !== undefined ? this.busOf(d.starter.bus, 'dc', `starter of '${d.id}'`) : bus;
        starter = this.makeStarter(`${d.id}.starter`, d.starter, sb, `${d.id}_starter`);
        this.starters.push(starter);
      }
      const field = d.field ? this.busOf(d.field.bus, 'dc', `field of '${d.id}'`) : -1;
      this.dcGens.push(
        new DcGen(
          this.dcGens.length,
          d,
          bus,
          compileBinding(vars, d.drive),
          compileCondition(vars, d.switch, true),
          compileCondition(vars, d.reset, false),
          field,
          starter,
          P,
        ),
      );
    }

    // ---- AC generators
    for (const d of cfg.acGenerators ?? []) {
      this.ids.add(d.id, 'ac generator');
      const bus = this.busOf(d.bus, 'ac', `ac generator '${d.id}'`);
      this.acGens.push(
        new AcGen(
          this.acGens.length,
          d,
          bus,
          compileBinding(vars, d.drive),
          compileCondition(vars, d.switch, true),
          compileCondition(vars, d.disconnect, false),
          compileCondition(vars, d.reset, false),
          P,
        ),
      );
      const g = this.acGens[this.acGens.length - 1];
      if (vars.get(g.o.disconnected) !== 0) g.disconnected = true;
    }

    // ---- external power
    for (const d of cfg.externals ?? []) {
      this.ids.add(d.id, 'external power');
      const ac = d.type === 'ac';
      const bus = this.busOf(d.bus, d.type, `external power '${d.id}'`);
      this.externals.push(new External(this.externals.length, d, bus, ac, compileCondition(vars, d.available, false), compileCondition(vars, d.switch, true), P));
    }

    // ---- TRUs
    for (const d of cfg.trus ?? []) {
      this.ids.add(d.id, 'tru');
      this.trus.push(
        new Tru(this.trus.length, d, this.busOf(d.acBus, 'ac', `tru '${d.id}'`), this.busOf(d.dcBus, 'dc', `tru '${d.id}'`), compileCondition(vars, d.enabled, true), P),
      );
    }

    // ---- inverters
    for (const d of cfg.inverters ?? []) {
      this.ids.add(d.id, 'inverter');
      this.inverters.push(
        new Inverter(
          this.inverters.length,
          d,
          this.busOf(d.dcBus, 'dc', `inverter '${d.id}'`),
          this.busOf(d.acBus, 'ac', `inverter '${d.id}'`),
          compileCondition(vars, d.enabled, true),
          P,
        ),
      );
    }

    // ---- links
    for (const d of cfg.links ?? []) {
      this.ids.add(d.id, 'link');
      const a = this.busOf(d.a, undefined, `link '${d.id}'`);
      const b = this.busOf(d.b, undefined, `link '${d.id}'`);
      if (this.buses[a].ac !== this.buses[b].ac) throw new Error(`ElectricalNetwork: link '${d.id}' joins an AC and a DC bus`);
      const diode = d.kind === 'diode';
      if (diode && this.buses[a].ac) throw new Error(`ElectricalNetwork: diode link '${d.id}' must join DC buses`);
      this.links.push(
        new Link(
          this.links.length,
          d.id,
          a,
          b,
          this.buses[a].ac,
          diode,
          compileCondition(vars, d.closed, true),
          d.coil ? this.makeCoil(d.coil, a) : null,
          d.cb ? this.breaker(d.cb) : null,
          P,
        ),
      );
    }

    // ---- loads
    for (const d of cfg.loads ?? []) {
      this.ids.add(d.id, 'load');
      const bus = this.busOf(d.bus, undefined, `load '${d.id}'`);
      const ac = this.buses[bus].ac;
      if (ac && d.amps !== undefined && d.va === undefined) throw new Error(`ElectricalNetwork: load '${d.id}' is on AC bus '${d.bus}': give 'va', not 'amps'`);
      if (!ac && d.va !== undefined && d.amps === undefined) throw new Error(`ElectricalNetwork: load '${d.id}' is on DC bus '${d.bus}': give 'amps', not 'va'`);
      this.loads.push(
        new Load(
          this.loads.length,
          d.id,
          bus,
          ac,
          compileBinding(vars, ac ? d.va : d.amps, 0),
          d.model ?? 'constant-current',
          compileCondition(vars, d.enabled, true),
          compileCondition(vars, d.shed, false),
          d.cb ? this.breaker(d.cb) : null,
          d.minV ?? this.buses[bus].poweredV,
          d.contactor ? this.makeCoil(d.contactor, bus) : null,
          P,
        ),
      );
    }
    this.starterEb = new Float64Array(this.starters.length);
  }

  // ------------------------------------------------------------ construction helpers

  private busOf(id: string, type: 'dc' | 'ac' | undefined, what: string): number {
    const i = this.busIndex.get(id);
    if (i === undefined) throw new Error(`ElectricalNetwork: ${what} references unknown bus '${id}'`);
    if (type !== undefined && this.buses[i].ac !== (type === 'ac')) throw new Error(`ElectricalNetwork: ${what} needs a ${type.toUpperCase()} bus, '${id}' is not`);
    return i;
  }

  private makeCoil(c: CoilDef, defaultBus: number): Coil {
    if (!(c.dropoutV < c.pickupV)) throw new Error('ElectricalNetwork: coil dropoutV must be < pickupV');
    const bus = c.bus !== undefined ? this.busOf(c.bus, 'dc', 'coil') : defaultBus;
    return new Coil(bus, c.pickupV, c.dropoutV, c.pickupDelayS ?? 0.02);
  }

  private breaker(d: CircuitBreakerDef): Breaker {
    let b = this.breakers.get(d.name);
    if (!b) {
      if (!(d.ratingA > 0)) throw new Error(`ElectricalNetwork: breaker '${d.name}' needs ratingA > 0`);
      b = new Breaker(d.name, d.ratingA);
      this.breakers.set(d.name, b);
      this.breakerList.push(b);
      // Breakers start pushed in unless the cockpit/state already set them.
      if (!this.vars.has(b.varIn)) this.vars.set(b.varIn, 1);
      if (!this.vars.has(b.varTrip)) this.vars.set(b.varTrip, 0);
    }
    return b;
  }

  private makeStarter(failId: string, d: StarterDef, bus: number, outId: string): Starter {
    if (!(d.noLoadSpeed > 0) || !(d.resistanceOhm > 0)) throw new Error(`ElectricalNetwork: starter '${failId}' needs noLoadSpeed > 0 and resistanceOhm > 0`);
    const driver = d.engineStarterVar
      ? new StarterDriver(this.vars, { engineStarterVar: d.engineStarterVar, kind: d.engineKind ?? 'turbine', starterTau: d.engineStarterTau })
      : null;
    return new Starter(
      failId,
      bus,
      compileCondition(this.vars, d.command, false),
      compileBinding(this.vars, d.speed),
      d.noLoadSpeed,
      d.resistanceOhm,
      d.currentLimitA ?? Infinity,
      d.nominalV ?? 24,
      d.contactor ? this.makeCoil(d.contactor, bus) : null,
      d.cb ? this.breaker(d.cb) : null,
      driver,
      this.prefix,
      outId,
    );
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;

    // ---- 1. commands, failures, availability
    for (const b of this.buses) b.faulted = vars.get(b.fail) !== 0;

    for (const l of this.links) {
      const cmd = l.cmd();
      const coilOk = l.coil ? l.coil.update(cmd ? this.buses[l.coil.bus].v : 0, dt) : true;
      const cbIn = l.cb ? vars.get(l.cb.varIn, 1) !== 0 : true;
      let closed = cmd && coilOk && cbIn;
      if (vars.get(l.failOpen) !== 0) closed = false;
      if (vars.get(l.failClosed) !== 0) closed = true;
      if (this.buses[l.a].faulted || this.buses[l.b].faulted) closed = false;
      l.closedCmd = cmd;
      l.closed = closed;
      if (!closed) l.conducting = false;
    }

    for (const ld of this.loads) {
      const en = ld.enabled() && !ld.shed();
      const coilOk = ld.coil ? ld.coil.update(en ? this.buses[ld.coil.bus].v : 0, dt) : true;
      const cbIn = ld.cb ? vars.get(ld.cb.varIn, 1) !== 0 : true;
      ld.active = en && coilOk && cbIn && !this.buses[ld.bus].faulted;
      let dem = ld.amount();
      if (vars.get(ld.failShort) !== 0 && ld.active) dem = Math.max(dem, ld.cb ? ld.cb.ratingA : dem) * SHORT_CIRCUIT_MULT;
      ld.demand = dem > 0 ? dem : 0;
    }

    for (let k = 0; k < this.starters.length; k++) {
      const s = this.starters[k];
      s.cmdOn = s.cmd();
      const coilOk = s.coil ? s.coil.update(s.cmdOn ? this.buses[s.coil.bus].v : 0, dt) : true;
      const cbIn = s.cb ? vars.get(s.cb.varIn, 1) !== 0 : true;
      s.engaged = s.cmdOn && coilOk && cbIn && vars.get(s.fail) === 0 && !this.buses[s.bus].faulted;
      this.starterEb[k] = s.backEmf();
    }

    for (const b of this.batteries) {
      b.ambient = b.ambientEv();
      b.open = vars.get(b.failOpen) !== 0 || this.buses[b.bus].faulted;
      b.prepare();
    }

    for (const g of this.dcGens) {
      g.handleReset();
      const d = g.def;
      g.drive = g.driveEv();
      g.avail = g.drive >= d.minDrive && vars.get(g.fail) === 0;
      const fieldOk = g.fieldBus < 0 || this.buses[g.fieldBus].v >= (d.field?.minV ?? 0);
      const starting = g.starter !== null && g.starter.engaged;
      g.online = g.sw() && g.avail && !g.tripped && fieldOk && !starting && !this.buses[g.bus].faulted;
      g.E = vars.get(g.failReg) !== 0 ? REGULATOR_RUNAWAY_V : d.regulatedV;
      if (d.maxAmpsVsDrive) g.Ilim = Math.max(0, interp1(d.maxAmpsVsDrive, g.drive));
      else g.Ilim = d.currentLimitA ?? (d.kind === 'alternator' ? d.ratedA : 1.5 * d.ratedA);
    }

    for (const g of this.acGens) {
      g.handleEdges();
      const d = g.def;
      const drive = g.driveEv();
      const driveFail = vars.get(g.failDrive) !== 0;
      const spd = drive >= d.minDrive && (d.maxDrive === undefined || drive <= d.maxDrive);
      if (d.maxDrive !== undefined && drive > d.maxDrive) g.tripped = true; // overspeed protection
      g.avail = spd && !g.disconnected && !driveFail && vars.get(g.fail) === 0;
      g.online = g.avail && g.sw() && !g.tripped && !this.buses[g.bus].faulted;
      const f = d.frequency ?? 400;
      g.hz = g.avail ? (typeof f === 'number' ? f : interp1(f, drive)) : 0;
      vars.set(g.o.drive_lowpress, g.disconnected || driveFail || drive < d.minDrive * 0.9 ? 1 : 0);
    }

    for (const x of this.externals) {
      x.avail = x.availEv();
      x.online = x.avail && x.sw() && !this.buses[x.bus].faulted;
    }

    for (const t of this.trus) t.enabledNow = t.enabled() && vars.get(t.fail) === 0 && !this.buses[t.dcBus].faulted;

    for (const inv of this.inverters) {
      inv.online =
        inv.enabled() &&
        vars.get(inv.fail) === 0 &&
        this.buses[inv.dcBus].v >= (inv.def.minDcV ?? 20) &&
        !this.buses[inv.dcBus].faulted &&
        !this.buses[inv.acBus].faulted;
    }

    // ---- 2. AC solve
    this.solveAc(dt);

    // ---- 3. DC solve
    for (const t of this.trus) t.online = t.enabledNow && this.buses[t.acBus].v >= (t.def.minAcV ?? 100);
    for (const inv of this.inverters) {
      const vdc = Math.max(this.buses[inv.dcBus].v, inv.def.minDcV ?? 20);
      inv.dcAmps = inv.online ? inv.va / ((inv.def.efficiency ?? 0.85) * vdc) : 0;
    }
    this.solveDc();

    // ---- 4. post-solve: currents, integration, protection
    this.postDc(dt);
    this.updateBreakers(dt);
    this.publish();
  }

  // ------------------------------------------------------------ AC

  private solveAc(dt: number): void {
    const buses = this.buses;
    const nb = buses.length;
    const parent = this.parent;
    for (let i = 0; i < nb; i++) parent[i] = i;
    for (const l of this.links) if (l.ac && l.closed) union(parent, l.a, l.b);
    const cap = this.acCap;
    const load = this.acLoad;
    const hz = this.acHz;
    cap.fill(0);
    load.fill(0);
    hz.fill(0);
    this.acFrac.fill(1);
    // Sources (priority = declaration order for frequency).
    for (const g of this.acGens) {
      if (!g.online) continue;
      const r = find(parent, g.bus);
      if (cap[r] === 0) hz[r] = g.hz;
      cap[r] += g.ratedVa;
    }
    for (const x of this.externals) {
      if (!x.ac || !x.online) continue;
      const r = find(parent, x.bus);
      if (cap[r] === 0) hz[r] = x.def.frequency ?? 400;
      cap[r] += (x.def.ratedKva ?? 90) * 1000;
    }
    for (const inv of this.inverters) {
      if (!inv.online) continue;
      const r = find(parent, inv.acBus);
      if (cap[r] === 0) hz[r] = inv.def.frequency ?? 400;
      cap[r] += inv.def.ratedVa;
    }
    // Loads.
    for (const ld of this.loads) if (ld.ac && ld.active) load[find(parent, ld.bus)] += ld.demand;
    for (const t of this.trus) if (t.enabledNow) load[find(parent, t.acBus)] += t.acVa;
    // Overloaded islands deliver at most AC_COLLAPSE_RATIO x their rating (voltage collapse):
    // scale the delivered load so sources (and an inverter's DC draw) stay bounded.
    for (let i = 0; i < nb; i++) {
      if (!buses[i].ac || find(parent, i) !== i || cap[i] <= 0) continue;
      const ratio = load[i] / cap[i];
      if (ratio > AC_COLLAPSE_RATIO) load[i] = cap[i] * AC_COLLAPSE_RATIO;
      this.acFrac[i] = ratio > AC_COLLAPSE_RATIO ? AC_COLLAPSE_RATIO / ratio : 1;
    }
    // Voltage per island root.
    for (let i = 0; i < nb; i++) {
      const b = buses[i];
      if (!b.ac) continue;
      const r = find(parent, i);
      if (cap[r] <= 0 || b.faulted) {
        b.v = 0;
        b.hz = 0;
        continue;
      }
      const ratio = load[r] / cap[r] / this.acFrac[r];
      const v = ratio <= AC_COLLAPSE_RATIO ? b.nominalV * (1 - AC_DROOP_AT_RATED * ratio) : (b.nominalV * (1 - AC_DROOP_AT_RATED * AC_COLLAPSE_RATIO) * AC_COLLAPSE_RATIO) / ratio;
      b.v = v;
      b.hz = hz[r];
    }
    // Source shares and overload protection.
    for (const g of this.acGens) {
      if (!g.online) {
        g.va = 0;
        g.v = 0;
        g.overloadTimer = 0;
        continue;
      }
      const r = find(parent, g.bus);
      g.va = (load[r] * g.ratedVa) / cap[r];
      g.v = buses[g.bus].v;
      const pct = (g.va / g.ratedVa) * 100;
      if (pct > (g.def.overloadTripPct ?? 150)) {
        g.overloadTimer += dt;
        if (g.overloadTimer >= (g.def.overloadTripS ?? 5)) g.tripped = true;
      } else g.overloadTimer = 0;
    }
    for (const x of this.externals) {
      if (!x.ac) continue;
      x.va = x.online ? (load[find(parent, x.bus)] * (x.def.ratedKva ?? 90) * 1000) / cap[find(parent, x.bus)] : 0;
    }
    for (const inv of this.inverters) {
      if (!inv.online) {
        inv.va = 0;
        continue;
      }
      const r = find(parent, inv.acBus);
      inv.va = (load[r] * inv.def.ratedVa) / cap[r];
    }
    // AC loads and bus load sums.
    for (const b of buses) if (b.ac) b.load = 0;
    for (const ld of this.loads) {
      if (!ld.ac) continue;
      const bv = buses[ld.bus].v;
      ld.powered = ld.active && bv >= ld.minV;
      ld.current = ld.powered ? ld.demand * this.acFrac[find(parent, ld.bus)] : 0;
      buses[ld.bus].load += ld.current;
    }
    for (const l of this.links) if (l.ac) l.amps = 0;
  }

  // ------------------------------------------------------------ DC

  private buildDcIslands(): void {
    const buses = this.buses;
    const nb = buses.length;
    const parent = this.parent;
    for (let i = 0; i < nb; i++) parent[i] = i;
    for (const l of this.links) {
      if (l.ac || !l.closed) continue;
      if (l.diode && !l.conducting) continue;
      union(parent, l.a, l.b);
    }
    const r2i = this.rootToIsland;
    r2i.fill(-1);
    let n = 0;
    for (let i = 0; i < nb; i++) {
      if (buses[i].ac) {
        this.island[i] = -1;
        continue;
      }
      const r = find(parent, i);
      if (r2i[r] < 0) r2i[r] = n++;
      this.island[i] = r2i[r];
    }
    this.islandCount = n;
  }

  /** Net current into each island at voltages `v` (per island), optionally restricted to buses whose `parent2` root is `onlyRoot`. */
  private netCurrent(v: Float64Array, out: Float64Array, onlyRoot: number): void {
    const isl = this.island;
    const p2 = this.parent2;
    const n = this.islandCount;
    for (let i = 0; i < n; i++) out[i] = 0;
    // `use(bus)`: inlined as (onlyRoot < 0 || find(p2, bus) === onlyRoot) to avoid a per-call closure.
    for (const b of this.batteries) {
      if (b.open || (onlyRoot >= 0 && find(p2, b.bus) !== onlyRoot)) continue;
      const k = isl[b.bus];
      out[k] += b.currentAt(v[k]);
    }
    for (const g of this.dcGens) {
      if (!g.online || (onlyRoot >= 0 && find(p2, g.bus) !== onlyRoot)) continue;
      const k = isl[g.bus];
      out[k] += g.currentAt(v[k]);
    }
    for (const x of this.externals) {
      if (x.ac || !x.online || (onlyRoot >= 0 && find(p2, x.bus) !== onlyRoot)) continue;
      const k = isl[x.bus];
      out[k] += x.currentAt(v[k]);
    }
    for (const t of this.trus) {
      if (!t.online || (onlyRoot >= 0 && find(p2, t.dcBus) !== onlyRoot)) continue;
      const k = isl[t.dcBus];
      out[k] += t.currentAt(v[k]);
    }
    for (const ld of this.loads) {
      if (ld.ac || !ld.active || (onlyRoot >= 0 && find(p2, ld.bus) !== onlyRoot)) continue;
      const k = isl[ld.bus];
      out[k] -= loadCurrent(ld, v[k], this.buses[ld.bus].nominalV);
    }
    for (let s = 0; s < this.starters.length; s++) {
      const st = this.starters[s];
      if (!st.engaged || (onlyRoot >= 0 && find(p2, st.bus) !== onlyRoot)) continue;
      const k = isl[st.bus];
      out[k] -= st.currentAt(v[k], this.starterEb[s]);
    }
    for (const inv of this.inverters) {
      if (!inv.online || (onlyRoot >= 0 && find(p2, inv.dcBus) !== onlyRoot)) continue;
      out[isl[inv.dcBus]] -= inv.dcAmps;
    }
  }

  private bisect(): void {
    const n = this.islandCount;
    const lo = this.lo;
    const hi = this.hi;
    const mid = this.mid;
    const net = this.net;
    for (let i = 0; i < n; i++) {
      lo[i] = 0;
      hi[i] = V_MAX_DC;
    }
    for (let it = 0; it < BISECT_ITERS; it++) {
      for (let i = 0; i < n; i++) mid[i] = 0.5 * (lo[i] + hi[i]);
      this.netCurrent(mid, net, -1);
      for (let i = 0; i < n; i++) {
        if (net[i] > 0) lo[i] = mid[i];
        else hi[i] = mid[i];
      }
    }
    for (let i = 0; i < n; i++) this.islandV[i] = 0.5 * (lo[i] + hi[i]);
  }

  /**
   * Current flowing a -> b through a closed link that is a bridge of its
   * island (removing it splits the island). NaN when it is not a bridge.
   */
  private bridgeCurrent(link: Link): number {
    const nb = this.buses.length;
    const p2 = this.parent2;
    for (let i = 0; i < nb; i++) p2[i] = i;
    for (const l of this.links) {
      if (l === link || l.ac || !l.closed) continue;
      if (l.diode && !l.conducting) continue;
      union(p2, l.a, l.b);
    }
    const ra = find(p2, link.a);
    const rb = find(p2, link.b);
    if (ra === rb) return NaN;
    // Net injection of the b side at the island voltage: what it needs comes through the link.
    this.netCurrent(this.islandV, this.net, rb);
    return -this.net[this.island[link.b]];
  }

  private solveDc(): void {
    const buses = this.buses;
    let pass = 0;
    for (;;) {
      this.buildDcIslands();
      this.bisect();
      if (pass >= MAX_DIODE_PASSES) break;
      let changed = false;
      for (const l of this.links) {
        if (l.ac || !l.diode || !l.closed) continue;
        if (l.conducting) {
          const i = this.bridgeCurrent(l);
          if (i < -0.01) {
            l.conducting = false;
            changed = true;
          }
        } else {
          const va = this.islandV[this.island[l.a]];
          const vb = this.islandV[this.island[l.b]];
          if (va > vb + 0.01) {
            l.conducting = true;
            changed = true;
          }
        }
      }
      if (!changed) break;
      pass++;
    }
    for (let i = 0; i < buses.length; i++) {
      const b = buses[i];
      if (b.ac) continue;
      const v = b.faulted ? 0 : this.islandV[this.island[i]];
      // Numerical floor: an island without sources bisects to ~1e-8 V.
      b.v = v < 1e-3 ? 0 : v;
    }
  }

  private postDc(dt: number): void {
    const buses = this.buses;
    for (const b of buses) if (!b.ac) b.load = 0;
    for (const ld of this.loads) {
      if (ld.ac) continue;
      const bv = buses[ld.bus].v;
      ld.current = ld.active ? loadCurrent(ld, bv, buses[ld.bus].nominalV) : 0;
      ld.powered = ld.active && bv >= ld.minV;
      buses[ld.bus].load += ld.current;
    }
    for (let s = 0; s < this.starters.length; s++) {
      const st = this.starters[s];
      const bv = buses[st.bus].v;
      st.current = st.engaged ? st.currentAt(bv, this.starterEb[s]) : 0;
      // Motor terminal voltage (behind a current limiter the motor sees less than the bus).
      st.motorV = st.engaged ? Math.min(bv, this.starterEb[s] + st.current * st.R) : 0;
      if (st.driver) st.driver.update(st.engaged, st.motorV / st.nominalV);
    }
    for (const g of this.dcGens) {
      g.current = g.currentAt(buses[g.bus].v);
      // Over-voltage protection (GCU / ACU).
      const ovV = g.def.ovTripV ?? 32;
      if (g.online && buses[g.bus].v > ovV) {
        g.ovTimer += dt;
        if (g.ovTimer >= (g.def.ovTripDelayS ?? 0.2)) g.tripped = true;
      } else g.ovTimer = 0;
    }
    for (const x of this.externals) if (!x.ac) x.current = x.currentAt(buses[x.bus].v);
    for (const t of this.trus) {
      const v = buses[t.dcBus].v;
      t.current = t.currentAt(v);
      t.acVa = (v * t.current) / ((t.def.efficiency ?? 0.9) * (t.def.powerFactor ?? 0.95));
    }
    // Link currents (bridges only) for feeder breakers / diagnostics.
    for (const l of this.links) {
      if (l.ac) continue;
      if (l.closed && (!l.diode || l.conducting) && (l.cb !== null || l.diode)) {
        const i = this.bridgeCurrent(l);
        l.amps = Number.isNaN(i) ? 0 : i;
      } else l.amps = 0;
    }
    // Batteries: current, SOC, temperature.
    for (const b of this.batteries) {
      const v = buses[b.bus].v;
      b.current = b.open ? 0 : b.currentAt(v);
      const cap = b.capacity();
      const I = b.current;
      if (I > 0) {
        // Peukert: rate-dependent capacity. The rate ratio is capped at 3C: engine-start pulses
        // (10-20C for seconds) mostly recover afterwards, so full Peukert would overstate them.
        const i1 = b.def.capacityAh; // one-hour-rate current
        const rate = I / i1;
        const eff = I * Math.pow(rate < 1e-3 ? 1e-3 : rate > PEUKERT_MAX_RATE ? PEUKERT_MAX_RATE : rate, b.peukert - 1);
        b.soc -= (eff * dt) / (3600 * cap);
      } else if (I < 0) {
        b.soc += (-I * CHARGE_EFFICIENCY[b.chemistry] * dt) / (3600 * cap);
      }
      b.soc = clamp01(b.soc);
      const heat = I * I * (I >= 0 ? b.R : b.Rc) + (this.vars.get(b.failThermal) !== 0 ? THERMAL_RUNAWAY_W : 0);
      const th = b.def.thermal;
      if (th) {
        b.tempC += ((heat - th.coolingWK * (b.tempC - b.ambient)) / th.heatCapacityJK) * dt;
      } else {
        // EST: lumped 13 kg battery, c ≈ 900 J/kg/K, 2 W/K to the compartment.
        b.tempC += ((heat - 2 * (b.tempC - b.ambient)) / 12000) * dt;
      }
    }
  }

  private updateBreakers(dt: number): void {
    const vars = this.vars;
    for (const cb of this.breakerList) cb.current = 0;
    for (const ld of this.loads) {
      if (!ld.cb || !ld.active) continue;
      ld.cb.current += ld.ac ? (this.buses[ld.bus].v > 1 ? ld.current / this.buses[ld.bus].v : 0) : ld.current;
    }
    for (const st of this.starters) if (st.cb && st.engaged) st.cb.current += st.current;
    for (const l of this.links) if (l.cb && l.closed) l.cb.current += Math.abs(l.amps);
    for (const cb of this.breakerList) {
      const r = cb.current / cb.ratingA;
      if (r > CB_NO_TRIP_RATIO) cb.heat += ((r * r - CB_NO_TRIP_RATIO * CB_NO_TRIP_RATIO) / CB_HEAT_TAU_S) * dt;
      else cb.heat -= (cb.heat / CB_COOL_TAU_S) * dt;
      if (cb.heat < 0) cb.heat = 0;
      if (cb.heat >= 1) {
        cb.heat = 0.5; // still warm when reset
        vars.set(cb.varIn, 0);
        vars.set(cb.varTrip, 1);
      } else if (vars.get(cb.varIn, 1) !== 0 && vars.get(cb.varTrip) !== 0) {
        vars.set(cb.varTrip, 0); // pushed back in
      }
    }
  }

  private publish(): void {
    const vars = this.vars;
    for (const b of this.buses) {
      vars.set(b.o.v, b.v);
      vars.set(b.o.powered, b.v >= b.poweredV ? 1 : 0);
      vars.set(b.o.amps, b.ac ? (b.v > 1 ? b.load / b.v : 0) : b.load);
      if (b.ac) vars.set(b.o.hz, b.hz);
    }
    for (const b of this.batteries) {
      vars.set(b.o.v, b.open ? b.E : this.buses[b.bus].v);
      vars.set(b.o.amps, -b.current);
      vars.set(b.o.soc, b.soc);
      vars.set(b.o.temp_c, b.tempC);
      vars.set(b.o.overtemp, b.tempC >= (b.def.thermal?.overTempC ?? 63) ? 1 : 0);
    }
    for (const g of this.dcGens) {
      vars.set(g.o.v, g.online ? this.buses[g.bus].v : g.avail ? g.E : 0);
      vars.set(g.o.amps, g.current);
      vars.set(g.o.load_pct, (g.current / g.def.ratedA) * 100);
      vars.set(g.o.online, g.online ? 1 : 0);
      vars.set(g.o.avail, g.avail ? 1 : 0);
      vars.set(g.o.tripped, g.tripped ? 1 : 0);
      if (g.starter) {
        vars.set(g.o.starter, g.starter.engaged ? 1 : 0);
        vars.set(g.o.starter_amps, g.starter.current);
      }
    }
    for (const s of this.starters) {
      vars.set(s.o.engaged, s.engaged ? 1 : 0);
      vars.set(s.o.amps, s.current);
      vars.set(s.o.contactor, s.coil ? (s.coil.energized ? 1 : 0) : s.engaged ? 1 : 0);
    }
    for (const g of this.acGens) {
      vars.set(g.o.v, g.online ? g.v : g.avail ? g.def.nominalV ?? 115 : 0);
      vars.set(g.o.hz, g.hz);
      vars.set(g.o.kva, g.va / 1000);
      vars.set(g.o.load_pct, (g.va / g.ratedVa) * 100);
      vars.set(g.o.online, g.online ? 1 : 0);
      vars.set(g.o.avail, g.avail ? 1 : 0);
      vars.set(g.o.tripped, g.tripped ? 1 : 0);
      vars.set(g.o.disconnected, g.disconnected ? 1 : 0);
    }
    for (const x of this.externals) {
      vars.set(x.o.avail, x.avail ? 1 : 0);
      vars.set(x.o.online, x.online ? 1 : 0);
      if (x.ac) vars.set(x.o.kva, x.va / 1000);
      else vars.set(x.o.amps, x.current);
    }
    for (const t of this.trus) {
      vars.set(t.o.v, t.online ? this.buses[t.dcBus].v : 0);
      vars.set(t.o.amps, t.current);
      vars.set(t.o.online, t.online ? 1 : 0);
      vars.set(t.o.fail, vars.get(t.fail) !== 0 ? 1 : 0);
    }
    for (const inv of this.inverters) {
      vars.set(inv.o.online, inv.online ? 1 : 0);
      vars.set(inv.o.va, inv.va);
      vars.set(inv.o.dc_amps, inv.dcAmps);
    }
    for (const l of this.links) {
      vars.set(l.o.closed, l.closed && (!l.diode || l.conducting) ? 1 : 0);
      vars.set(l.o.amps, l.amps);
    }
    for (const ld of this.loads) {
      const bv = this.buses[ld.bus].v;
      vars.set(ld.o.powered, ld.powered ? 1 : 0);
      vars.set(ld.o.v, ld.active ? bv : 0);
      vars.set(ld.o.amps, ld.ac ? (bv > 1 ? ld.current / bv : 0) : ld.current);
    }
  }

  // ------------------------------------------------------------ public API

  /** Runs `steps` updates (default 30 = 0.5 s) so relays settle, e.g. after `applyState` changed switches. */
  settle(steps = 30, dt = 1 / 60): void {
    for (let i = 0; i < steps; i++) this.update(dt);
  }

  /** Re-reads battery SOC/temperature and IDG disconnect state from vars, clears trips and breaker heat (after a state load). */
  reset(): void {
    const vars = this.vars;
    for (const b of this.batteries) {
      if (vars.has(b.o.soc)) b.soc = clamp01(vars.get(b.o.soc));
      if (vars.has(b.o.temp_c)) b.tempC = vars.get(b.o.temp_c);
    }
    for (const g of this.dcGens) {
      g.tripped = vars.get(g.o.tripped) !== 0;
      g.ovTimer = 0;
    }
    for (const g of this.acGens) {
      g.disconnected = vars.get(g.o.disconnected) !== 0;
      g.tripped = vars.get(g.o.tripped) !== 0;
      g.overloadTimer = 0;
    }
    for (const cb of this.breakerList) cb.heat = 0;
    for (const s of this.starters) s.driver?.reset();
  }

  /** Failure ids this network reads (register with FailureManager). */
  failures(): FailureDef[] {
    const f: FailureDef[] = [];
    const c = 'electrical';
    for (const b of this.buses) f.push({ id: `elec.${b.id}.fault`, name: `${b.id} bus fault`, category: c, description: 'Bus isolated and unpowered.' });
    for (const b of this.batteries) {
      f.push({ id: `elec.${b.def.id}`, name: `${b.def.id} battery failure`, category: c, description: 'Open cell: battery delivers and accepts no current.' });
      f.push({ id: `elec.${b.def.id}.thermal`, name: `${b.def.id} thermal runaway`, category: c, description: 'Battery overheats (overtemp annunciation).' });
    }
    for (const g of this.dcGens) {
      f.push({ id: `elec.${g.def.id}`, name: `${g.def.id} generator failure`, category: c, description: 'Generator produces no output.' });
      f.push({ id: `elec.${g.def.id}.regulator`, name: `${g.def.id} regulator runaway`, category: c, description: 'Over-voltage until the over-voltage protection trips the generator off line.' });
      if (g.starter) f.push({ id: `elec.${g.def.id}.starter`, name: `${g.def.id} starter failure`, category: c, description: 'Start relay fails open: no starter engagement.' });
    }
    for (const s of this.starters) {
      if (s.id.endsWith('.starter')) continue;
      f.push({ id: `elec.${s.id}`, name: `${s.id} starter failure`, category: c, description: 'Starter/relay fails open.' });
    }
    for (const g of this.acGens) {
      f.push({ id: `elec.${g.def.id}`, name: `${g.def.id} generator failure`, category: c, description: 'Generator produces no output.' });
      f.push({ id: `elec.${g.def.id}.drive`, name: `${g.def.id} drive low oil pressure`, category: c, description: 'IDG/CSD drive fault: DRIVE light, generator lost.' });
    }
    for (const t of this.trus) f.push({ id: `elec.${t.def.id}`, name: `${t.def.id} TRU failure`, category: c });
    for (const inv of this.inverters) f.push({ id: `elec.${inv.def.id}`, name: `${inv.def.id} inverter failure`, category: c });
    for (const l of this.links) {
      f.push({ id: `elec.${l.id}.open`, name: `${l.id} fails open`, category: c });
      f.push({ id: `elec.${l.id}.closed`, name: `${l.id} fails closed`, category: c });
    }
    for (const ld of this.loads) if (ld.cb) f.push({ id: `elec.${ld.id}.short`, name: `${ld.id} short circuit`, category: c, description: `Overcurrent trips breaker ${ld.cb.name}.` });
    return f;
  }

  busVoltage(id: string): number {
    const i = this.busIndex.get(id);
    return i === undefined ? 0 : this.buses[i].v;
  }

  busPowered(id: string): boolean {
    const i = this.busIndex.get(id);
    return i !== undefined && this.buses[i].v >= this.buses[i].poweredV;
  }

  busFrequency(id: string): number {
    const i = this.busIndex.get(id);
    return i === undefined ? 0 : this.buses[i].hz;
  }

  loadPowered(id: string): boolean {
    for (const ld of this.loads) if (ld.id === id) return ld.powered;
    return false;
  }

  batterySoc(id: string): number {
    const b = this.batteries.find((x) => x.def.id === id);
    return b ? b.soc : 0;
  }

  /** Sets a battery's state of charge (0..1), e.g. for a "weak battery" scenario. */
  setBatterySoc(id: string, soc: number): void {
    const b = this.batteries.find((x) => x.def.id === id);
    if (!b) throw new Error(`ElectricalNetwork: unknown battery '${id}'`);
    b.soc = clamp01(soc);
    this.vars.set(b.o.soc, b.soc);
  }

  /** Battery current (A, + = discharging) from the last update. */
  batteryCurrent(id: string): number {
    const b = this.batteries.find((x) => x.def.id === id);
    return b ? b.current : 0;
  }

  /** Reconnects a disconnected IDG/CSD drive (ground maintenance action). */
  reconnectDrive(genId: string): void {
    const g = this.acGens.find((x) => x.def.id === genId);
    if (!g) throw new Error(`ElectricalNetwork: unknown AC generator '${genId}'`);
    g.disconnected = false;
    this.vars.set(g.o.disconnected, 0);
  }

  /** Resets every tripped breaker (pushes them all back in) and clears generator trips. */
  resetAllBreakers(): void {
    for (const cb of this.breakerList) {
      cb.heat = 0;
      this.vars.set(cb.varIn, 1);
      this.vars.set(cb.varTrip, 0);
    }
  }

  /** Breaker names known to the network with their ratings (for CB panel builders). */
  breakerNames(): { name: string; ratingA: number }[] {
    return this.breakerList.map((b) => ({ name: b.name, ratingA: b.ratingA }));
  }

  /** Output var name helper: `<prefix><id>_<suffix>`. */
  varName(id: string, suffix: string): string {
    return `${this.prefix}${id}_${suffix}`;
  }

  dispose(): void {
    /* nothing to release: no subscriptions */
  }
}

// ------------------------------------------------------------------ free helpers

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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

/** DC load current at voltage v (monotone non-decreasing in v). */
function loadCurrent(ld: Load, v: number, nominalV: number): number {
  const d = ld.demand;
  if (d <= 0 || v <= 0) return 0;
  if (ld.model === 'resistive') return (d * v) / nominalV;
  // Constant current down to the knee (half the powered threshold), then linear to zero.
  const knee = Math.max(1, 0.5 * ld.minV);
  return v >= knee ? d : (d * v) / knee;
}
