/**
 * Generic auxiliary power unit (gas-turbine APU with electric starter,
 * air-inlet door, load-compressor bleed and generator), parameterised for
 * the 737NG (GTCP131-9B), Gulfstream / Global (RE220) and Citation Longitude
 * (HGT750-class) installations.
 *
 * States: 0 OFF, 1 DOOR (inlet door opening), 2 STARTING, 3 RUNNING,
 *         4 COOLDOWN (unloaded run before shutdown), 5 SPOOLDOWN.
 *
 * Start: with the master switch ON the inlet door opens (`doorTimeS`). A
 * START edge (or `autoStart` once the door is open) engages the starter:
 * N spools toward `starterMaxPct`·r with r = starter voltage / nominal
 * (a weak battery cranks slowly and hot). At `lightOffPct` with fuel the APU
 * lights; combustion accelerates it (with starter assist) to 100 % and the
 * starter cuts out at `starterCutoutPct`. If the starter drops out below
 * `selfSustainPct` the start hangs. Bleed and generator become available
 * `availDelayS` after 95 % N. Start EGT peaks near `egtStartPeakC`, hotter
 * with a weak starter (`hotStartFactor`).
 *
 * Automatic shutdown (fault latched until the master is cycled OFF): fire,
 * overspeed (> 107 %, failure `apu.overspeed`), low oil pressure (failure
 * `apu.oil`), EGT above `egtLimitC` for 1 s, start timeout, loss of fuel,
 * failure `apu.fault`. `apu.start` failure: no light-off (failed start).
 *
 * Stop: master OFF or STOP edge. If bleed air was used within the last
 * `cooldownS` the APU first runs unloaded for `cooldownS` (737NG: 60 s
 * cooldown when bleed air has been used), then fuel is cut and N spools down;
 * the door closes when N < 10 %.
 *
 * Outputs (prefix default 'apu.'): n_pct, egt_c, state, running, avail,
 * bleed_psi (available pressure for the pneumatic source), gen_drive (N % for
 * the AC generator's `drive`), door_pos, door_open, starting, starter (0/1),
 * starter_amps (bind an ElectricalNetwork load's `amps` to it), ign, fault,
 * low_oil, overspeed, fire_shutdown, cooldown, ff_pph (bind a fuel consumer),
 * oil_press_psi, fuel_cmd.
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { FDM } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { EdgeDetector } from '../util/timers';
import type { FailureDef } from '../failures/FailureManager';

export interface ApuConfig {
  prefix?: string;
  /** APU master switch (ON = door opens, fuel valve armed). */
  master: Binding;
  /** START command (rising edge). Ignored when `autoStart`. */
  start?: Binding;
  /** STOP command (rising edge). Master OFF also stops. */
  stop?: Binding;
  /** Start automatically once the door is open (single-switch installations). Default false. */
  autoStart?: boolean;
  /** Voltage at the starter (e.g. the APU battery bus voltage). */
  starterVolts: Binding;
  /** Nominal starter voltage (default 24). */
  starterNominalV?: number;
  /** Starter current at 0 % N and nominal voltage (A). Default 400 (EST). */
  starterPeakA?: number;
  /** Fuel available at the APU (e.g. the fuel consumer's 'fuel.apu_on'). Default true. */
  fuelAvailable?: Binding;
  /** Fire detected (auto shutdown), e.g. 'fire.apu_warn'. */
  fire?: Binding;
  /** Bleed demand 0..1 (e.g. 'pneu.apu_bleed_flow_kgs / 1.4'); used for EGT, fuel flow and the cooldown rule. */
  bleedLoad?: Binding;
  /** Generator load 0..1 (e.g. 'elec.apu_gen_load_pct / 100'). */
  genLoad?: Binding;
  /** Available load-compressor bleed pressure at 100 % N (psi). Default 48 (EST). */
  maxBleedPsi?: number;
  /** Bleed available only below this pressure altitude (ft). Default none. */
  bleedCeilingFt?: number;
  /** Timings (s). */
  doorTimeS?: number;
  /** Nominal start time to 95 % N (s). Default 45 (EST; 737NG start cycle up to 120 s max). */
  startTimeS?: number;
  startTimeoutS?: number;
  availDelayS?: number;
  cooldownS?: number;
  /** Speeds (% N). */
  starterMaxPct?: number;
  lightOffPct?: number;
  starterCutoutPct?: number;
  selfSustainPct?: number;
  /** Temperatures (°C). */
  egtStartPeakC?: number;
  egtIdleC?: number;
  egtBleedC?: number;
  egtGenC?: number;
  egtLimitC?: number;
  /** Extra start EGT at r = 0 relative to a nominal start (fraction). Default 0.5. */
  hotStartFactor?: number;
  /** Fuel flow (pph): no load / full load. Defaults 180 / 330 (EST, 131-9B class). */
  ffIdlePph?: number;
  ffFullPph?: number;
  /** Aircraft pressure altitude (ft), default 'fdm.press_alt_ft'. Ambient temperature for EGT at rest, default 'fdm.sat_c'. */
  altitudeFt?: Binding;
  ambientC?: Binding;
}

/** APU state codes (published as `apu.state`). */
export const ApuState = {
  Off: 0,
  Door: 1,
  Starting: 2,
  Running: 3,
  Cooldown: 4,
  Spooldown: 5,
} as const;
export type ApuState = (typeof ApuState)[keyof typeof ApuState];

export class Apu implements Subsystem {
  readonly name = 'apu';
  readonly prefix: string;
  state: ApuState = ApuState.Off;
  n = 0;
  egt: number;
  door = 0;
  fault = false;
  private lit = false;
  private starter = false;
  private startTimer = 0;
  private availTimer = 0;
  private cooldownTimer = 0;
  private bleedUsedTimer = Infinity;
  private overTempTimer = 0;
  private startPeakTarget = 0;
  private lowOil = false;
  private overspeed = false;
  private fireShutdown = false;
  private starterAmps = 0;
  private readonly startEdge = new EdgeDetector();
  private readonly stopEdge = new EdgeDetector();

  private readonly master: () => boolean;
  private readonly startCmd: () => boolean;
  private readonly stopCmd: () => boolean;
  private readonly volts: Evaluator;
  private readonly fuelOk: () => boolean;
  private readonly fire: () => boolean;
  private readonly bleedLoad: Evaluator;
  private readonly genLoad: Evaluator;
  private readonly alt: Evaluator;
  private readonly ambient: Evaluator;
  private readonly p: Required<
    Pick<
      ApuConfig,
      | 'starterNominalV' | 'starterPeakA' | 'maxBleedPsi' | 'doorTimeS' | 'startTimeS' | 'startTimeoutS' | 'availDelayS' | 'cooldownS'
      | 'starterMaxPct' | 'lightOffPct' | 'starterCutoutPct' | 'selfSustainPct' | 'egtStartPeakC' | 'egtIdleC' | 'egtBleedC' | 'egtGenC'
      | 'egtLimitC' | 'hotStartFactor' | 'ffIdlePph' | 'ffFullPph'
    >
  >;
  private readonly accel: number;
  private readonly o: Record<string, string>;
  private readonly f: Record<'start' | 'overspeed' | 'oil' | 'fault', string>;

  constructor(
    private readonly vars: SimVars,
    private readonly cfg: ApuConfig,
  ) {
    const P = (this.prefix = cfg.prefix ?? 'apu.');
    this.master = compileCondition(vars, cfg.master, false);
    this.startCmd = compileCondition(vars, cfg.start, false);
    this.stopCmd = compileCondition(vars, cfg.stop, false);
    this.volts = compileBinding(vars, cfg.starterVolts, 0);
    this.fuelOk = compileCondition(vars, cfg.fuelAvailable, true);
    this.fire = compileCondition(vars, cfg.fire, false);
    this.bleedLoad = compileBinding(vars, cfg.bleedLoad, 0);
    this.genLoad = compileBinding(vars, cfg.genLoad, 0);
    this.alt = compileBinding(vars, cfg.altitudeFt ?? FDM.pressAlt, 0);
    this.ambient = compileBinding(vars, cfg.ambientC ?? FDM.sat, 15);
    const startTimeS = cfg.startTimeS ?? 45;
    this.p = {
      starterNominalV: cfg.starterNominalV ?? 24,
      starterPeakA: cfg.starterPeakA ?? 400,
      maxBleedPsi: cfg.maxBleedPsi ?? 48,
      doorTimeS: cfg.doorTimeS ?? 12,
      startTimeS,
      startTimeoutS: cfg.startTimeoutS ?? Math.max(90, 2.5 * startTimeS),
      availDelayS: cfg.availDelayS ?? 2,
      cooldownS: cfg.cooldownS ?? 60,
      starterMaxPct: cfg.starterMaxPct ?? 30,
      lightOffPct: cfg.lightOffPct ?? 10,
      starterCutoutPct: cfg.starterCutoutPct ?? 55,
      selfSustainPct: cfg.selfSustainPct ?? 40,
      egtStartPeakC: cfg.egtStartPeakC ?? 780,
      egtIdleC: cfg.egtIdleC ?? 380,
      egtBleedC: cfg.egtBleedC ?? 200,
      egtGenC: cfg.egtGenC ?? 60,
      egtLimitC: cfg.egtLimitC ?? 1000,
      hotStartFactor: cfg.hotStartFactor ?? 0.5,
      ffIdlePph: cfg.ffIdlePph ?? 180,
      ffFullPph: cfg.ffFullPph ?? 330,
    };
    // Combustion acceleration (%/s) such that a nominal start reaches 95 % in ~startTimeS
    // (pre-light-off cranking takes ~20 % of the start; the g(n) taper averages ~0.75).
    this.accel = 95 / (0.8 * startTimeS * 0.75);
    const names = [
      'n_pct', 'egt_c', 'state', 'running', 'avail', 'bleed_psi', 'gen_drive', 'door_pos', 'door_open', 'starting', 'starter',
      'starter_amps', 'ign', 'fault', 'low_oil', 'overspeed', 'fire_shutdown', 'cooldown', 'ff_pph', 'oil_press_psi', 'fuel_cmd',
    ];
    this.o = {};
    for (const n of names) this.o[n] = `${P}${n}`;
    this.f = { start: failVar('apu.start'), overspeed: failVar('apu.overspeed'), oil: failVar('apu.oil'), fault: failVar('apu.fault') };
    this.egt = this.ambient();
    // Resume a running APU after a state load.
    if (vars.get(this.o.state) === ApuState.Running) this.setRunning(true);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const p = this.p;
    const master = this.master();
    const startEdge = this.startEdge.rising(this.startCmd());
    const stopEdge = this.stopEdge.rising(this.stopCmd());
    const fuel = this.fuelOk();
    const amb = this.ambient();
    const bleedLoad = clamp01(this.bleedLoad());
    const genLoad = clamp01(this.genLoad());

    // ---- fault reset: master OFF clears latched faults once the APU has stopped
    if (!master && this.state === ApuState.Off) {
      this.fault = false;
      this.fireShutdown = false;
      this.overspeed = false;
      this.lowOil = false;
    }

    // ---- automatic shutdown conditions
    const running = this.state === ApuState.Running || this.state === ApuState.Cooldown;
    if (this.state === ApuState.Starting || running) {
      let trip = false;
      if (this.fire()) {
        this.fireShutdown = true;
        trip = true;
      }
      if (vars.get(this.f.overspeed) !== 0 && this.n > 90) {
        this.overspeed = true;
        trip = true;
      }
      if (vars.get(this.f.oil) !== 0 && this.n > 60) {
        this.lowOil = true;
        trip = true;
      }
      if (vars.get(this.f.fault) !== 0) trip = true;
      if (this.lit && !fuel) trip = true; // flameout
      if (this.egt > p.egtLimitC) {
        this.overTempTimer += dt;
        if (this.overTempTimer > 1) trip = true;
      } else this.overTempTimer = 0;
      if (this.state === ApuState.Starting && this.startTimer > p.startTimeoutS) trip = true;
      if (trip) {
        this.fault = true;
        this.shutdown();
      }
    }

    // ---- state transitions
    switch (this.state) {
      case ApuState.Off:
        if (master && !this.fault) this.state = ApuState.Door;
        break;
      case ApuState.Door:
        if (!master) this.state = ApuState.Off;
        else if (this.door >= 1 && (startEdge || this.cfg.autoStart)) {
          this.state = ApuState.Starting;
          this.startTimer = 0;
          this.starter = true;
          this.lit = false;
        }
        break;
      case ApuState.Starting:
        if (!master || stopEdge) this.shutdown();
        break;
      case ApuState.Running:
        if (!master || stopEdge) {
          if (this.bleedUsedTimer < p.cooldownS) {
            this.state = ApuState.Cooldown;
            this.cooldownTimer = 0;
          } else this.shutdown();
        }
        break;
      case ApuState.Cooldown:
        this.cooldownTimer += dt;
        if (this.cooldownTimer >= p.cooldownS) this.shutdown();
        else if (master && startEdge) this.state = ApuState.Running; // restart request cancels the cooldown
        break;
      case ApuState.Spooldown:
        if (this.n < 1) this.state = ApuState.Off;
        break;
    }

    // ---- inlet door
    const doorOpen = master || this.n > 10 || this.state === ApuState.Cooldown;
    this.door = clamp01(this.door + (doorOpen ? 1 : -1) * (dt / p.doorTimeS));

    // ---- starter
    const v = Math.max(0, this.volts());
    const r = clamp01(v / p.starterNominalV);
    if (this.state === ApuState.Starting && this.starter && this.n >= p.starterCutoutPct) this.starter = false;
    if (this.state !== ApuState.Starting) this.starter = false;
    // DC motor: current falls with speed (back-EMF), scales with voltage.
    this.starterAmps = this.starter ? p.starterPeakA * clamp01(v / p.starterNominalV - this.n / (p.starterCutoutPct * 1.6)) : 0;

    // ---- rotor speed
    if (this.state === ApuState.Starting) {
      this.startTimer += dt;
      if (!this.lit) {
        const tgt = p.starterMaxPct * r;
        // Starter-only cranking: first-order toward the starter's speed (τ 6 s, EST: light-off ~3 s after START).
        this.n += ((tgt - this.n) / 6) * dt * (this.starter ? 1 : 0) - (this.starter ? 0 : (this.n / 8) * dt);
        if (this.n >= p.lightOffPct && fuel && vars.get(this.f.start) === 0) {
          this.lit = true;
          // Weak starter -> slow acceleration -> hot start.
          this.startPeakTarget = p.egtStartPeakC * (1 + p.hotStartFactor * (1 - r));
        }
      } else {
        const g = clamp(1.2 - this.n / 110, 0.1, 1);
        const assist = this.starter ? 0.6 + 0.4 * r : this.n >= p.selfSustainPct ? 1 : 0.1;
        this.n = Math.min(100, this.n + this.accel * g * assist * dt);
        if (this.n >= 95) {
          this.state = ApuState.Running;
          this.availTimer = 0;
        }
      }
    } else if (this.state === ApuState.Running || this.state === ApuState.Cooldown) {
      const governed = this.overspeed || vars.get(this.f.overspeed) !== 0 ? 108 : 100;
      this.n += (governed - this.n) * (1 - Math.exp(-dt / 1.5));
    } else {
      this.n -= this.n * (1 - Math.exp(-dt / 6));
      if (this.n < 0.05) this.n = 0;
    }

    // ---- availability and loads
    if (this.state === ApuState.Running) this.availTimer += dt;
    const avail = this.state === ApuState.Running && this.n >= 95 && this.availTimer >= p.availDelayS;
    const bleedAllowed = avail && (this.cfg.bleedCeilingFt === undefined || this.alt() <= this.cfg.bleedCeilingFt);
    if (avail && bleedLoad > 0.02) this.bleedUsedTimer = 0;
    else this.bleedUsedTimer += dt;

    // ---- EGT
    let egtTarget: number;
    if (this.lit && this.state === ApuState.Starting) {
      // Start transient: peak around 30-60 % N, settling toward idle.
      const shape = this.n < 45 ? this.n / 45 : 1 - ((this.n - 45) / 55) * 0.45;
      egtTarget = amb + (this.startPeakTarget - amb) * clamp01(shape);
    } else if (this.state === ApuState.Running) {
      egtTarget = p.egtIdleC + p.egtBleedC * bleedLoad + p.egtGenC * genLoad;
    } else if (this.state === ApuState.Cooldown) {
      egtTarget = p.egtIdleC - 30;
    } else egtTarget = amb;
    const tau = egtTarget > this.egt ? 2.5 : this.state === ApuState.Off || this.state === ApuState.Spooldown ? 40 : 5;
    this.egt += (egtTarget - this.egt) * (1 - Math.exp(-dt / tau));

    // ---- fuel flow
    const burning = this.lit && (this.state === ApuState.Starting || this.state === ApuState.Running || this.state === ApuState.Cooldown);
    const loadFrac = this.state === ApuState.Running ? clamp01(0.7 * bleedLoad + 0.3 * genLoad) : 0;
    const ff = burning ? (this.state === ApuState.Starting ? p.ffIdlePph * (0.4 + 0.6 * this.n / 100) : p.ffIdlePph + (p.ffFullPph - p.ffIdlePph) * loadFrac) : 0;

    // ---- outputs
    const o = this.o;
    vars.set(o.n_pct, this.n);
    vars.set(o.egt_c, this.egt);
    vars.set(o.state, this.state);
    vars.set(o.running, this.state === ApuState.Running || this.state === ApuState.Cooldown ? 1 : 0);
    vars.set(o.avail, avail ? 1 : 0);
    vars.set(o.bleed_psi, bleedAllowed && this.state === ApuState.Running ? p.maxBleedPsi * (this.n / 100) ** 2 : 0);
    vars.set(o.gen_drive, avail ? this.n : 0);
    vars.set(o.door_pos, this.door);
    vars.set(o.door_open, this.door >= 1 ? 1 : 0);
    vars.set(o.starting, this.state === ApuState.Starting ? 1 : 0);
    vars.set(o.starter, this.starter ? 1 : 0);
    vars.set(o.starter_amps, this.starterAmps);
    vars.set(o.ign, this.state === ApuState.Starting && this.n < p.starterCutoutPct ? 1 : 0);
    vars.set(o.fault, this.fault ? 1 : 0);
    vars.set(o.low_oil, this.lowOil ? 1 : 0);
    vars.set(o.overspeed, this.overspeed ? 1 : 0);
    vars.set(o.fire_shutdown, this.fireShutdown ? 1 : 0);
    vars.set(o.cooldown, this.state === ApuState.Cooldown ? 1 : 0);
    vars.set(o.ff_pph, ff);
    vars.set(o.oil_press_psi, this.lowOil ? 0 : 60 * clamp01(this.n / 95)); // EST: ~60 psi at governed speed
    vars.set(o.fuel_cmd, burning ? 1 : 0);
  }

  private shutdown(): void {
    this.state = ApuState.Spooldown;
    this.starter = false;
    this.lit = false;
    this.cooldownTimer = 0;
  }

  /** Puts the APU instantly running (true) or off (false) for state presets. */
  setRunning(on: boolean): void {
    if (on) {
      this.state = ApuState.Running;
      this.n = 100;
      this.door = 1;
      this.lit = true;
      this.availTimer = this.p.availDelayS;
      this.egt = this.p.egtIdleC;
      this.fault = false;
    } else {
      this.state = ApuState.Off;
      this.n = 0;
      this.lit = false;
      this.door = 0;
      this.egt = this.ambient();
    }
    this.starter = false;
  }

  reset(): void {
    const s = this.vars.get(this.o.state);
    this.setRunning(s === ApuState.Running || s === ApuState.Cooldown);
  }

  failures(): FailureDef[] {
    const c = 'apu';
    return [
      { id: 'apu.start', name: 'APU fails to light', category: c, description: 'No light-off: start aborts on timeout (FAULT).' },
      { id: 'apu.overspeed', name: 'APU overspeed', category: c, description: 'Governor failure: automatic shutdown (OVERSPEED).' },
      { id: 'apu.oil', name: 'APU low oil pressure', category: c, description: 'Automatic shutdown (LOW OIL PRESSURE).' },
      { id: 'apu.fault', name: 'APU fault shutdown', category: c, description: 'ECU-commanded shutdown (FAULT).' },
    ];
  }

  dispose(): void {
    /* nothing */
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
