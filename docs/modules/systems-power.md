# Systems (power & services): API reference

Owner: systems-power. Sources: `src/systems/{util,failures,electrical,fuel,hydraulic,pneumatic,pressurization,ice,apu,fire,oxygen,lighting}`.
Tests: `tests/systems/power` (`npx vitest run tests/systems/power`).

These are data-driven building blocks. An aircraft instantiates each one with its own numbers and bindings
and puts the instances in `AircraftInstance.systems`. Every block implements `Subsystem`
(`src/aircraft/types.ts`), which means `name`, `update(dt)`, `reset()` and `dispose()`. Every block also
has `failures(): FailureDef[]`, which lists the failure ids it reads.

You can build an aircraft from this document without reading the source.

---

## 0. Conventions (read first)

| Topic | Convention |
|---|---|
| Update rate | Systems run at 60 Hz (`dt = 1/60`). No block allocates inside `update`. |
| Bindings | Every input (switch, automatic logic, another system's output) is a `Binding`, compiled once when the block is constructed (§1.1). |
| Component ids | `[A-Za-z0-9_]+` and unique within a block. The id becomes part of var names, e.g. `elec.<id>_v`. A duplicate or invalid id throws when the block is constructed. |
| Output vars | `<prefix><id>_<suffix>`. Default prefixes: `elec.`, `fuel.`, `hyd.`, `pneu.`, `press.`, `ice.`, `apu.`, `fire.`, `oxy.`, `light.`. Every block except `LightingSystem` takes a `prefix` option. For a second instance of the same block (e.g. a second FuelSystem), change the prefix. |
| Standard vars written | `fuel.tank{i}_kg`, `fuel.total_kg`, `eng{i}.fuel_on` (FuelSystem); `eng{i}.bleed_extract` (PneumaticSystem); `eng{i}.starter` (the electric/pneumatic starter, only when configured to own it); `eng{i}.anti_ice` (IceProtection); `ice.*` (IceProtection). |
| Failures | State var `fail.<id>` (1 = failed). Blocks read the var directly. `FailureManager` is optional: it only writes the vars and schedules failures. Ids are namespaced by system: `elec.gen1`, `fuel.boost_l`, `hyd.edp_a`, `pneu.bleed1.overheat`, `press.auto`, `ice.pitot1.heat`, `apu.oil`, `fire.eng1`, `oxy.crew.leak`, `light.strobe`. |
| Breakers | `cb.<name>`: 1 = in, 0 = pulled or tripped. A missing var reads as in. `cb.<name>_tripped` is 1 after a thermal trip. These are the same vars the cockpit `CircuitBreaker` control uses (`var` / `trippedVar`). |
| Units | V, A, VA/kVA, Hz, psi (gauge unless noted), kg, pph (lb/h), L/min, kg/s, °C, ft, fpm. |
| New shared names | `src/core/vars.ts` gained `FAIL`, `CB`, `ELEC`, `HYD`, `PRESS` and `LIGHT` name builders (§15). |

### 0.1 Who writes the engine inputs (integration contract with FADEC / start logic)

| Var | Writer | How FADEC / start logic takes part |
|---|---|---|
| `eng{i}.fuel_on` | **FuelSystem**, for every consumer that has `engine: i`. | FADEC writes its fuel command (start lever RUN, light-off fuel) to its own var, for example `fadec1.fuel_cmd`. The aircraft passes that var as the consumer's `run` binding. FADEC must never write `eng{i}.fuel_on` itself. |
| `eng{i}.starter` | Either the **electric starter** (`StarterDef.engineStarterVar`) or the **air-turbine starter** (`PneumaticSystem.starters`), or FADEC directly when no starter block is configured. | With a starter block configured, FADEC writes its start request to a separate var (for example `fadec1.start_req`), which becomes the starter's `command`. The block converts the request into the boolean `eng.starter` through a PWM that scales with the available voltage or duct pressure, so a weak battery or low duct pressure cranks slowly. |
| `eng{i}.bleed_extract` | **PneumaticSystem** | – |
| `eng{i}.anti_ice` | **IceProtection** (a surface with `engine: i`) | – |

### 0.2 Recommended subsystem order

```
FailureManager -> SourceSelector(s) -> ElectricalNetwork -> Apu -> FuelSystem -> HydraulicSystem
 -> PneumaticSystem -> Pressurization -> IceProtection -> FireProtection -> OxygenSystem
 -> (FADEC, flight controls, gear, sensors, autopilot, warning: other module)
 -> LightingSystem
```

Blocks read each other's outputs through vars. A block that reads a value written later in the same step
sees the previous update's value, a 16 ms lag that relays and valves have anyway.

---

## 1. `util` (`src/systems/util`)

`import { ... } from '@/systems/util'` re-exports everything below.

### 1.1 Bindings: `binding.ts`

```ts
type Binding = number | boolean | string | ((vars: SimVars) => number);
type Evaluator = () => number;
compileBinding(vars, binding: Binding | undefined, fallback = 0): Evaluator   // undefined -> constant fallback
compileCondition(vars, binding, fallback = false): () => boolean              // non-zero = true
compileExpression(vars, source: string): Evaluator                            // throws on syntax errors
expressionVars(source): string[]                                              // var names an expression reads
expr.on(name) / expr.off(name) / expr.is(name, v) / expr.powered(voltVar, minV) / expr.withDefault(name, v)
expr.and(...parts) / expr.or(...parts) / expr.not(part) / expr.gt|ge|lt|le(name, v)   // build expression strings
```

The expression language is C-like. Every value is a number and true is 1.

- **Variables.** Any dotted SimVar name (`elec.main_bus_v`) is a variable. A var that has never been written reads as 0. `name ?? 1` reads the var with a default of 1 instead (use this for breakers).
- **Operators**, in precedence order: `?:`, `||`, `&&`, `== !=`, `< <= > >=`, `+ -`, `* / %`, unary `! - +`, parentheses. `&&`, `||`, `!` and the comparisons return 0 or 1. Division by 0 gives 0.
- **Literals:** numbers (`1.5`, `.5`, `1e-3`), `true`, `false`.
- **Functions:** `min(a,b,…)`, `max(a,b,…)`, `abs`, `sign`, `floor`, `ceil`, `round`, `sqrt`, `clamp(x,lo,hi)`, `clamp01(x)`, `step(x, edge)`, `between(x,lo,hi)`, `lerp(a,b,t)`, `remap(x,x0,x1,y0,y1)` (clamped), `bool(x)`, `eq(a,b,tol)`.

Examples:
```ts
'ac.elec.batt_sw'                                       // plain switch
'elec.main_v >= 24.5'                                   // powered test
'ac.gen1_sw == 1 && eng1.n2_pct > 45'                   // automatic logic
'ac.boost_sw == 2 || (ac.boost_sw == 1 && fuel.eng1_lowpress)'
'clamp(ac.panel_knob * elec.dc1_powered, 0, 1)'
'!(elec.gen1_online && elec.gen2_online)'               // bus-tie auto close
```

### 1.2 Timers and logic: `timers.ts`

| Class | API |
|---|---|
| `OnDelay(delayS)` | `update(input, dt): boolean` is true once the input has been true for `delayS`. Also `reset(state?)`, `elapsed`, `output`. |
| `OffDelay(delayS)` | Output stays true for `delayS` after the input drops. |
| `Latch(initial=false, resetDominant=true)` | `update(set, reset)`. |
| `Hysteresis(on, off, low=false, initial=false)` | Schmitt trigger. With `low=true` it is active at or below `on` and cleared at or above `off`, e.g. `new Hysteresis(24.5, 25, true)` for a LOW VOLTS light. |
| `EdgeDetector(initial=false)` | `update(b)` returns +1 on a rising edge, −1 on a falling edge, 0 otherwise. `rising(b)` returns a boolean. |
| `Pulse(durationS)` | Retriggerable monostable. `update(trigger, dt)`. |
| `Stopwatch` | `start/stop/reset/update(dt)`. |
| `Integrator(initial, min, max)` | `update(rate, dt)`. |
| `Flasher(periodS, windows[])` | `update(dt)` returns on/off. `windows` are `[start,end,…]` pairs in seconds. |
| `SigmaDelta` | `update(duty 0..1)` returns 0 or 1, with a running average equal to the duty. |

### 1.3 Filters: `filters.ts`

This file re-exports `FirstOrderLag`, `RateLimiter`, `SecondOrderFilter`, `approach`, `clamp`, `clamp01`, `lerp` and `interp1` from `core/math`. It adds:
- `LagRateLimiter(tau, maxRate, initial)` with `update(input, dt)`.
- `Actuator(travelS, initial)`: a position 0..1 that moves at a constant rate. It has `update(cmd, dt)`, `position`, `inTransit` and `stuck` (freezes the position), plus `reset(p)`.

### 1.4 Starter output: `starter.ts`

The physics engine models treat `eng{i}.starter` as a **boolean**. With the starter engaged, the turbofan's N2
approaches `starterMaxN2_pct` with τ = `starterTau_s` (4 s); with it released, N2 decays with τ = 6 s. The
piston engine gets its full starter torque while the flag is set. `StarterDriver` pulse-width-modulates the
boolean with a sigma-delta modulator so that the starter-only equilibrium is:
- Turbine: equilibrium N2 = r × starterMaxN2.
- Piston: average torque = r × full torque.

`r` is the achievable strength (0..1).

```ts
starterDutyForSpeedRatio(r, starterTau = 4, decayTau = 6): number   // d = rτs / (τd(1−r) + rτs)
new StarterDriver(vars, { engineStarterVar, kind: 'turbine' | 'piston', starterTau? })
  .update(engaged: boolean, strength: number): 0 | 1   // writes engineStarterVar
  .reset(); .duty; .output
TURBINE_STARTER_TAU_S = 4; TURBINE_STARTER_DECAY_TAU_S = 6
```

### 1.5 Ids: `ids.ts`

`checkId(id, what)`, `IdRegistry(block).add(id, kind)`, `failVar(failureId)` returns `'fail.<id>'`.

---

## 2. `FailureManager` (`src/systems/failures`)

```ts
interface FailureDef { id: string; name: string; category: string; description?: string }
type FailureTrigger =
  | { kind: 'time'; afterS: number }
  | { kind: 'altitude'; ft: number; direction?: 'above' | 'below' | 'cross' }   // fdm.alt_msl_ft
  | { kind: 'speed'; kt: number; direction?: 'above' | 'below' | 'cross' }       // fdm.ias_kt
  | { kind: 'window'; minS: number; maxS: number }                              // uniform random time
  | { kind: 'mtbf'; hours: number };                                             // p = dt / MTBF per update

new FailureManager(vars, { events?: EventBus, seed?: number (1), defs?: FailureDef[] })
register(defs | def)        // initialises fail.<id> = 0 when missing
unregister(id); list(); byCategory(): Map<string, FailureDef[]>; get(id)
isActive(id); active(): string[]; trigger(id); clear(id); clearAll()
arm(id, trigger); disarm(id); armed(); armRandom(count, minS, maxS, category?): string[]
update(dt); reset(); dispose(); activeFailures (getter)
```

- **Vars:** `fail.<id>`, `fail.active_count`, `fail.armed_count`.
- **Events handled:** `fail.trigger` (id), `fail.clear` (id), `fail.clear_all`, `fail.arm` ({ id, trigger }), `fail.disarm` (id).
- **Events emitted:** `fail.activated` (id), `fail.cleared` (id).
- **Determinism:** the PRNG is seeded (`core/math Prng`), so the same seed gives the same failure times.
- **Crossing triggers:** `above` and `below` also fire on the first update if the aircraft is already beyond the level when the failure is armed.

Usage:
```ts
const fm = new FailureManager(ctx.vars, { events: ctx.events, seed: 42 });
for (const s of [elec, fuel, hyd, pneu, press, ice, apu, fire, oxy, lights]) fm.register(s.failures());
fm.arm('elec.gen1', { kind: 'altitude', ft: 10000, direction: 'above' });
```

---

## 3. Electrical: `ElectricalNetwork` (`src/systems/electrical`)

```ts
new ElectricalNetwork(vars, cfg: ElectricalConfig, opts?: { name?: string })
```

### 3.1 Config

```ts
interface ElectricalConfig {
  prefix?: string;                // 'elec.'
  buses: BusDef[];
  batteries?: BatteryDef[];
  dcGenerators?: DcGeneratorDef[];
  acGenerators?: AcGeneratorDef[];
  externals?: ExternalPowerDef[];
  trus?: TruDef[];
  inverters?: InverterDef[];
  starters?: StarterMotorDef[];   // standalone starter motors (172)
  links?: LinkDef[];
  loads?: LoadDef[];
}
```

**`BusDef`** `{ id, type?: 'dc'|'ac' ('dc'), nominalV? (28 / 115), poweredV? (DC 18 V: DO-160 §16 emergency minimum; AC 100 V) }`

**`CircuitBreakerDef`** `{ name, ratingA }`. Loads, links and starters may share a breaker by using the same name.
Trip model (EST, shaped like the MIL-PRF-5809 curve): no trip at or below 110 % of rating, about 7 s at 200 %,
0.8 s at 500 % and 0.2 s at 1000 %. A breaker pushed back in while the fault persists trips again.

**`CoilDef`** `{ bus? (default: component's bus / link side a), pickupV, dropoutV, pickupDelayS? (0.02) }`.
The contact closes only while the command is on and the coil voltage is at or above `pickupV`, and it opens
below `dropoutV`. With a flat battery this makes relays chatter, the familiar starter-solenoid "click-click-click".

**`LinkDef`** `{ id, a, b, kind?: 'contactor'|'diode', closed?: Binding (true), coil?, cb? }`.
- Links must join buses of the same type.
- A diode only conducts a → b, and only while `closed` is true. Diodes are ideal: no forward voltage drop.
- Put the source side in `a`, because a coil takes its power from `a` by default.

**`LoadDef`** `{ id, bus, amps?: Binding (DC, A at nominal V), va?: Binding (AC), model?: 'constant-current'|'resistive', enabled?: Binding, shed?: Binding, cb?, minV?, contactor?: CoilDef }`.
- `constant-current` (the default, for avionics and motors) draws its full current down to half its powered threshold, then falls linearly to zero.
- `resistive` (lamps, heaters) draws current proportional to V / nominalV.
- `shed: true` disconnects the load (load shedding).
- An amps or va binding that reads another system's output, such as `'hyd.acmp_a_va'`, `'fuel.boost_l_amps'` or `'apu.starter_amps'`, couples that system's electrical load to the network.

**`BatteryDef`** `{ id, bus, chemistry?: 'lead-acid'|'nicd'|'li-ion', cells?, capacityAh, internalResistanceOhm, initialSoc?, ocvPerCell?, fullChargeV?, chargeTaper? (5), chargeResistanceFactor? (3), maxChargeC? (2), peukert?, ambientC?: Binding (20), thermal?: { heatCapacityJK, coolingWK, overTempC } }`

Battery model:
- **Open-circuit EMF.** EMF = cells × OCV(SOC), with per-chemistry tables in `presets.ts`.
- **Internal resistance** is multiplied by three factors:
  - cold: +1.7 %/°C below 25 °C (from the ratio of Concorde RG24-15 Ipp at 23 °C and −18 °C);
  - low charge: ×(1 + 3x²) as SOC falls from 20 % toward 0;
  - exhaustion: ×1000 at SOC 0, starting at SOC 2 %. A flat battery therefore keeps its open-circuit voltage but collapses under any load.
- **Discharge** current is (E − V)/R.
- **Charging** starts only above E + η(SOC), where η = (fullChargeV − E_full) × SOC^taper. The current is (V − E − η)/(R × factor), capped at maxChargeC × Ah. The result is the familiar ammeter picture: a large charge current after a start that tapers to zero as the battery fills.
- **SOC:**
  - discharge follows Peukert's law, with the rate ratio capped at 3C because engine-start pulses mostly recover afterwards;
  - charging uses a coulombic efficiency (lead-acid 0.9, NiCd 0.83, Li-ion 0.98);
  - capacity falls when cold.
- **Temperature:** heating is I²R. `fail.elec.<id>.thermal` adds 400 W.

**`DcGeneratorDef`** `{ id, bus, kind?: 'starter-generator'|'alternator'|'generator', regulatedV, ratedA, currentLimitA? (1.5 × rated; alternator = rated), outputResistanceOhm? (0.0015), drive: Binding, minDrive, maxAmpsVsDrive?: Table1D, switch?: Binding, reset?: Binding, field?: { bus, minV }, ovTripV? (32), ovTripDelayS? (0.2), starter?: StarterDef }`
- Online when all of these hold: the switch is on, drive ≥ minDrive, the generator has not failed or tripped, the field is powered, and the starter is not engaged.
- A generator cannot sink current, which is how the reverse-current relay behaves.
- Over-voltage protection trips the generator off line, and it stays latched until the switch is cycled off → on or `reset` has a rising edge.
- An alternator with a `field` needs its field bus to be above `minV`, so a dead battery prevents excitation. The 172 POH describes this for a depleted battery: the alternator field loses power.

**`StarterDef`** (also `StarterMotorDef` = `StarterDef & { id, bus }`): `{ command, bus?, speed: Binding (e.g. 'eng1.n2_pct' or 'eng1.rpm'), noLoadSpeed, resistanceOhm, currentLimitA?, nominalV? (24), engineStarterVar?, engineKind? ('turbine'), engineStarterTau?, contactor?: CoilDef, cb? }`
- Motor current is I = clamp((V_bus − V_nominal × speed / noLoadSpeed) / R, 0, limit).
- The motor voltage `Vm = min(V_bus, back-EMF + I·R)` gives the strength r = Vm / nominalV, which drives `engineStarterVar` through `StarterDriver`.
- Typical values:
  - Turbine starter-generator (EST): `resistanceOhm 0.02`, `noLoadSpeed ≈ 1.25 × starterMaxN2_pct`.
  - 172 starter (EST): `resistanceOhm 0.065`, `noLoadSpeed 350` (rpm, as in the physics piston model).

**`AcGeneratorDef`** `{ id, bus, ratedKva, nominalV? (115), frequency?: number | Table1D (400), drive: Binding, minDrive, maxDrive?, switch?, disconnect?: Binding, reset?, overloadTripPct? (150), overloadTripS? (5) }`.
- IDG or CSD: constant 400 Hz.
- VFG: `frequency` as a table of Hz vs N2.
- APU generator: `drive: 'apu.gen_drive'`, `minDrive: 95`.
- RAT or ADG: drive from airspeed, e.g. `'ac.adg_deployed * fdm.ias_kt'` with `minDrive: 130`.
- `disconnect` latches on its rising edge until `reconnectDrive(id)` is called, e.g. for an IDG disconnect.
- Overspeed above `maxDrive` trips the generator.

**`ExternalPowerDef`** `{ id, bus, type, available: Binding, switch?, voltage?, currentLimitA? (1500), resistanceOhm? (0.004), ratedKva? (90), frequency? (400) }`

**`TruDef`** `{ id, acBus, dcBus, ratedA, noLoadV? (28.5), fullLoadV? (27), currentLimitA? (1.3 × rated), efficiency? (0.9), powerFactor? (0.95), enabled?, minAcV? (100) }`. You can also use a TRU as a battery charger.

**`InverterDef`** `{ id, dcBus, acBus, ratedVa, efficiency? (0.85), enabled?, minDcV? (20), outputV?, frequency? }`

### 3.2 Solution (each update)

1. Commands, breakers and failures are evaluated. Relay coils use the previous update's voltage.
2. **AC:**
   - Buses joined by closed links form islands.
   - An island with an online source runs at its nominal voltage, with a 2 % droop at rated load.
   - Above twice its rating the island collapses, and the delivered power is capped.
   - Sources share load in proportion to their rating, with the frequency taken from the first source in declaration order.
   - SCOPE: AC sources are never paralleled or synchronised. The aircraft's tie logic must keep one source per island.
3. **DC:** islands are bisected for the voltage V at which Σ source currents = Σ loads. The residual is monotone, 26 iterations are run, and all islands are solved together. Diode states are re-checked for up to 4 passes.
4. Batteries, breakers, over-voltage and overload trips are updated, then outputs are published.

Measured cost for a 737-scale network (13 buses, 85 loads, 3 TRUs, diodes, breakers): about 55 µs per update, or 0.3 % of a core at 60 Hz.

### 3.3 Outputs (`elec.` prefix)

| Component | Vars |
|---|---|
| bus | `<id>_v`, `<id>_powered`, `<id>_amps` (sum of loads; AC: VA/V), `<id>_hz` (AC) |
| battery | `<id>_v`, `<id>_amps` (**+ = charging, − = discharging**), `<id>_soc` (0..1), `<id>_temp_c`, `<id>_overtemp` |
| DC generator | `<id>_v`, `<id>_amps`, `<id>_load_pct`, `<id>_online`, `<id>_avail`, `<id>_tripped`; with a starter: `<id>_starter`, `<id>_starter_amps` |
| starter | `<id>_engaged`, `<id>_amps`, `<id>_contactor` (relay state, e.g. for a click sound). A starter-generator's starter id is `<genId>_starter`. |
| AC generator | `<id>_v`, `<id>_hz`, `<id>_kva`, `<id>_load_pct`, `<id>_online`, `<id>_avail`, `<id>_tripped`, `<id>_disconnected`, `<id>_drive_lowpress` (IDG DRIVE light) |
| external | `<id>_avail`, `<id>_online`, `<id>_amps` (DC) or `<id>_kva` (AC) |
| TRU | `<id>_v`, `<id>_amps`, `<id>_online`, `<id>_fail` |
| inverter | `<id>_online`, `<id>_va`, `<id>_dc_amps` |
| link | `<id>_closed`, `<id>_amps` (bridge links only) |
| load | `<id>_powered`, `<id>_v`, `<id>_amps` |
| breaker | `cb.<name>` (initialised to 1), `cb.<name>_tripped` |

**Failures:**
- `elec.<bus>.fault`: the bus is isolated.
- `elec.<battery>`: open cell.
- `elec.<battery>.thermal`
- `elec.<gen>`
- `elec.<dcgen>.regulator`: runaway to 34.5 V, then an over-voltage trip.
- `elec.<dcgen>.starter`: the start relay fails open. The same id pattern works for standalone starters: `elec.<starter>`.
- `elec.<acgen>.drive`: IDG low oil pressure.
- `elec.<tru>`, `elec.<inverter>`
- `elec.<link>.open`, `elec.<link>.closed`
- `elec.<load>.short`: 10× rating, which trips the breaker.

### 3.4 API

```ts
update(dt); settle(steps = 30, dt = 1/60)   // settle relays after applyState
reset()                                     // re-read <batt>_soc/_temp_c, gen trips, IDG disconnects; clear breaker heat
failures(): FailureDef[]
busVoltage(id); busPowered(id); busFrequency(id); loadPowered(id)
batterySoc(id); setBatterySoc(id, soc); batteryCurrent(id)   // + = discharging
reconnectDrive(acGenId); resetAllBreakers(); breakerNames(); varName(id, suffix)
```

### 3.5 `SourceSelector` (bus power control logic, `AutoTransfer.ts`)

```ts
new SourceSelector(vars, {
  id, mode: 'priority' | 'manual',
  sources: { name?, available: Binding, select?: Binding, autoCandidate?: boolean (true) }[],
  deselect?: Binding, autoTransfer?: Binding, initial?: number, transferDelayS?: number, prefix?: 'elec.'
})
```

- **Outputs:** `elec.<id>_src`, which is 0 for none or the 1-based index of the selected source, and `elec.<id>_off`.
- **`priority` mode:** selects the first available source, e.g. Gulfstream or Bombardier automatic AC bus priority.
- **`manual` mode:**
  - The rising edge of a source's `select` latches it, which models 737-style momentary GEN, APU and GRD POWER switches. `deselect` models GEN OFF.
  - If the latched source is lost, the bus goes unpowered.
  - With `autoTransfer` true (BUS TRANSFER AUTO), the first available `autoCandidate` takes over instead, and control returns to the latched source when it recovers.
- **Transfer gap:** `transferDelayS` inserts a break-before-make gap.

Contactor bindings then read the selector, e.g. `closed: 'elec.xfr1_sel_src == 1'`. Use `select(i)` in `applyState`.

### 3.6 Presets (`presets.ts`)

- **OCV tables:** `OCV_LEAD_ACID`, `OCV_NICD`, `OCV_LI_ION`.
- **Chemistry defaults:** `DEFAULT_CELLS`, `DEFAULT_OCV`, `DEFAULT_PEUKERT`, `RESISTANCE_TEMP_COEFF`, `CAPACITY_TEMP_COEFF`.
- **Batteries.** Spread one into a def as `{ id, bus, ...PRESET }`:
  - `BATTERY_172S_MAIN`: Concorde RG24-15, 13.6 Ah, 13.5 mΩ.
  - `BATTERY_RG380E44`: 42 Ah, 10.2 mΩ; Citation class.
  - `BATTERY_737NG_NICD`: 20-cell, 48 Ah.
  - `BATTERY_G650_NICD`: 53 Ah.
  - `BATTERY_172S_STANDBY`: 7 Ah (EST).

### 3.7 Recipes for the fleet

**Cessna 172S, steam gauges.** Split ALT/BAT master, one avionics switch, 28 V 60 A alternator, 24 V battery.
The UND C172S guide gives LOW VOLTS below 24.5 V and HIGH VOLTS above 32 V.
```ts
const elec = new ElectricalNetwork(vars, {
  buses: [{ id: 'batt_bus' }, { id: 'main' }, { id: 'avn' }],
  batteries: [{ id: 'batt', bus: 'batt_bus', ...BATTERY_172S_MAIN, ambientC: 'fdm.sat_c' }],
  dcGenerators: [{
    id: 'alt', bus: 'main', kind: 'alternator', regulatedV: 28.5, ratedA: 60,
    drive: 'eng1.rpm', minDrive: 700,
    maxAmpsVsDrive: { x: [700, 1000, 1500, 2000], y: [0, 30, 55, 60] },   // EST pulley ratio
    switch: 'ac.elec.alt_sw', field: { bus: 'main', minV: 8 }, ovTripV: 32,
  }],
  links: [
    { id: 'batt_contactor', a: 'batt_bus', b: 'main', closed: 'ac.elec.bat_sw', coil: { pickupV: 14, dropoutV: 10 } },
    { id: 'avn_relay', a: 'main', b: 'avn', closed: 'ac.elec.avn_sw', cb: { name: 'avn', ratingA: 15 } },
  ],
  starters: [{
    id: 'starter', bus: 'batt_bus', command: 'ac.key == 4', speed: 'eng1.rpm', noLoadSpeed: 350,
    resistanceOhm: 0.065, engineStarterVar: 'eng1.starter', engineKind: 'piston',
    contactor: { bus: 'main', pickupV: 16, dropoutV: 11 },
  }],
  loads: [
    { id: 'fuel_pump', bus: 'main', amps: 'fuel.aux_amps', cb: { name: 'fuel_pump', ratingA: 5 } },
    { id: 'pitot_heat', bus: 'main', amps: 9, model: 'resistive', enabled: 'ac.pitot_sw', cb: { name: 'pitot_heat', ratingA: 10 } },
    { id: 'nav_lts', bus: 'main', amps: 4, model: 'resistive', enabled: 'ac.nav_lt_sw', cb: { name: 'nav_lts', ratingA: 5 } },
    { id: 'radios', bus: 'avn', amps: 6 },
  ],
});
// Analog instrument power: ac.elec.bus_v <- elec.main_v ; ac.elec.batt_amps <- elec.batt_amps (ammeter)
```

**172S G1000 NXi.** Add these to the 172S layout:
- Buses `elec_bus1`, `elec_bus2`, `ess`, `xfeed`, `avn1` and `avn2`.
- Diodes `elec_bus1 → ess` and `elec_bus2 → ess`.
- A standby battery (`BATTERY_172S_STANDBY`) on `stby_hot`, with a link `stby_hot → ess` closed by `'ac.stby_batt_sw >= 1'`. The standby battery charges from ESS when the switch is at ARM.
- Avionics bus relays on the AVIONICS BUS 1 and BUS 2 switches.

The breaker names and ratings are listed in the UND guide, e.g. PFD 5 A, ADC/AHRS 10 A, STDBY BATT 20 A.

**Citation M2.** Two 28 V starter-generators on L and R buses. At maximum operating altitude each starter/generator is rated at 300 A. The battery is on a hot battery bus, the EMER bus is fed through diodes, and the bus-tie closes automatically when one side is lost.
```ts
dcGenerators: [{ id: 'sg1', bus: 'l_main', kind: 'starter-generator', regulatedV: 28.5, ratedA: 300, drive: 'eng1.n2_pct', minDrive: 50,
  switch: 'ac.gen1_sw == 1', reset: 'ac.gen1_sw == 2',
  starter: { command: 'fadec1.start_req', bus: 'batt_bus', speed: 'eng1.n2_pct', noLoadSpeed: 35, resistanceOhm: 0.02,
             nominalV: 24, engineStarterVar: 'eng1.starter' } }, /* sg2 ... */]
links: [{ id: 'bus_tie', a: 'l_main', b: 'r_main', closed: '!(elec.sg1_online && elec.sg2_online)' }, ...]
```
With `BATTERY_RG380E44`, a battery start peaks at about 820 A with the bus at 16 V and uses about 7 % SOC (test).
A 5 %-charged battery cold-soaked to −18 °C gives a hung start (test).

**737-800.**
- **AC generation.** IDG1 and IDG2 at 90 kVA, 115 V, 400 Hz. The APU generator is 90 kVA below 32,000 ft and 66 kVA at 41,000 ft, and external power is 90 kVA (aviationhunt ATA 24 notes). Generators never parallel; model the two transfer buses with a `SourceSelector` in manual mode with `autoTransfer: 'ac.bus_xfr_auto'`.
- **DC.** TRU1 feeds DC1, TRU2 feeds DC2, and TRU3 feeds the battery bus.
- **Standby.** The standby path is battery → static inverter → AC STBY bus, plus battery → DC STBY. The inverter binding is `enabled: '!elec.xfr1_powered || ac.stby_pwr == 2'`.
- **Battery.** `BATTERY_737NG_NICD`.
- **Galley shedding.** Shed the galley loads with `shed: 'elec.xfr1_sel_src != 1 || elec.xfr2_sel_src != 2'` (single-source logic).
- **Drive fault.** The DRIVE light is `elec.idg1_drive_lowpress`.

**G650.** Two 40 kVA IDGs, a 40 kVA APU generator, a 15 kVA RAT, two 28 VDC 53 Ah NiCd batteries, five TRUs, and a 24 V 10.5 Ah lithium battery for the flight-control computers (G650 electrical study guides).
- **AC buses:** use `SourceSelector` in `priority` mode: onside IDG > APU > GPU > cross-side IDG.
- **RAT:** an `AcGenerator` with `drive: 'ac.rat_deployed * fdm.ias_kt'`.

**G800.** Same structure as the G650, with `frequency` as a table if VFGs are modelled.

**Global 6000.** Four VFGs (two per engine, `frequency` from an N2 table), an APU generator, and an ADG that is an `AcGenerator` driven by airspeed. The ADG deploys automatically on loss of all AC in flight: the aircraft logic sets the deploy var. Build the priority AC logic with selectors.

**Citation Longitude.** A DC system: model it with starter-generators or DC generators. The APU is described in §9.

---

## 4. Fuel: `FuelSystem` (`src/systems/fuel`)

```ts
new FuelSystem(vars, cfg: FuelSystemConfig, opts?: { name? })
interface FuelSystemConfig {
  prefix?: 'fuel.';
  tanks: FuelTankDef[]; nodes: string[]; pumps: FuelPumpDef[]; valves?: FuelValveDef[];
  consumers: FuelConsumerDef[]; transfers?: FuelTransferDef[];
  balance?: { left, right, alertKg };
  temperature?: { skin?: Binding ('fdm.tat_c'), tauFullS? (10800), initialC? (15) };
  altitude?: Binding ('fdm.press_alt_ft');   // suction-feed ceilings
}
FuelTankDef     { id, index /* FdmConfig.mass.tanks index */, capacityKg, unusableKg?, initialKg? (full), lowLevelKg?, gauge?: { power?, lagS? (2) }, leakPph? }
FuelPumpDef     { id, kind: 'electric'|'ejector'|'engine'|'gravity', from: tankId | nodeId, to: nodeId, pressurePsi, maxFlowPph,
                  on?: Binding (true), lowPressPsi? (0.5×pressure), lowPressWhenOff? (false), ratedAmps? }
FuelValveDef    { id, a: node, b: node, open: Binding, travelS? (1; 0 = instant selector), power?: Binding, initial? }
FuelConsumerDef { id, node, flowPph: Binding, engine?: number, run?: Binding (1), minPressPsi? (0.05),
                  suction?: { tank, ceilingFt? (25000), running?: Binding ('eng{i}.n2_pct > 20') } }
FuelTransferDef { id, from, to, kind: 'pumped'|'gravity', ratePph, active: Binding, fullRateLevelDiff? (0.2), bidirectional?, stopAtFraction? }
```

### 4.1 Model

- **Topology.**
  - Tanks feed nodes through pumps. A gravity "pump" is the head pressure from a tank.
  - Nodes are joined by valves (crossfeed, firewall or spar valves, selector positions) and belong to the same group while the valve is at least half open.
  - In-line pumps (`from` a node) are engine-driven or auxiliary pumps. They need a wet upstream group.
  - Consumers draw from a node.
- **Group pressure.** A group's pressure is the highest running pump outlet pressure. Pumps have check valves, so the highest-pressure pumps supply first. This is how 737 centre-tank pumps are used before the wing tanks: give the centre pumps a higher `pressurePsi`.
- **Consumer feed.** A consumer's feed is adequate when its group is wet and at or above `minPressPsi`, or through **suction feed**. Suction feed requires all of these: the engine is running, the aircraft is below `ceilingFt`, the suction tank has fuel, and the tank connects into the group through one of its (stopped) pumps.
- **Fuel-on output.** `eng{engine}.fuel_on` = `run` && feed adequate.
- **Demand allocation.** Demand (`flowPph`) is allocated downstream to upstream:
  - Pumps are loaded in 1-psi pressure tiers, shared in proportion to their max flow.
  - In-line pumps pass their flow up to their source group.
  - Tank pumps burn fuel from their own tank.
  - With the crossfeed open and one side's pumps off, both engines burn from the other side.
- **Pump pressure** droops 30 % from shutoff head to maximum flow (EST, centrifugal pump).
- **Transfers.**
  - `pumped`: moves fuel at a constant rate while active and there is fuel and space.
  - `gravity`: flows at `ratePph × Δlevel / fullRateLevelDiff`. With `bidirectional` set it acts as a crossflow valve.
- **Leaks:** `fail.fuel.<tank>.leak`. The default rate is max(600 pph, 10 % of capacity per hour).
- **Gauging:** the indicated quantity lags by `lagS` and reads 0 when the gauge is unpowered.

### 4.2 Outputs

- **Tanks:**
  - `fuel.tank{index}_kg` is the true mass, read by the FDM. It is initialised from the var if set, else from `initialKg`.
  - `fuel.total_kg`.
  - `<tank>_ind_kg`, `<tank>_low`, `<tank>_usable_kg`, and `<tank>_temp_c` when `temperature` is given.
- **Pumps:** `<pump>_on` (running), `<pump>_lowpress`, `<pump>_psi`, `<pump>_flow_pph`, and `<pump>_amps` (when `ratedAmps` is set, for an electrical load).
- **Valves:** `<valve>_pos`, `<valve>_open` (≥ 95 %), `<valve>_transit`. Use the transit output for 737-style bright blue VALVE OPEN lights.
- **Nodes:** `<node>_psi`.
- **Consumers:** `<consumer>_on`, `<consumer>_psi`, `<consumer>_lowpress`, `<consumer>_flow_pph`, `<consumer>_suction`, plus `eng{i}.fuel_on`.
- **Transfers:** `<xfr>_active`, `<xfr>_flow_pph`.
- **System-wide:** `imbalance_kg` (left − right), `imbalance`, `used_kg`.

**Failures:**
- `fuel.<pump>`: every pump except gravity.
- `fuel.<valve>.stuck`
- `fuel.<tank>.leak`

**API:** `setTankKg(id, kg)`, `tankKg(id)`, `totalKg()`, `snapValves()` (for `applyState`), `reset()`, `failures()`.

### 4.3 Recipes

**172S.** POH: 56 gal total, 53 usable. Avgas is 6 lb/gal. Selector positions are LEFT = 0, BOTH = 1, RIGHT = 2.
```ts
const GAL = 6 * 0.45359237;
new FuelSystem(vars, {
  tanks: [{ id: 'left', index: 0, capacityKg: 28 * GAL, unusableKg: 1.5 * GAL, lowLevelKg: 5 * GAL },
          { id: 'right', index: 1, capacityKg: 28 * GAL, unusableKg: 1.5 * GAL, lowLevelKg: 5 * GAL }],
  nodes: ['l_out', 'r_out', 'sel', 'strainer', 'servo'],
  pumps: [
    { id: 'grav_l', kind: 'gravity', from: 'left', to: 'l_out', pressurePsi: 0.5, maxFlowPph: 300 },
    { id: 'grav_r', kind: 'gravity', from: 'right', to: 'r_out', pressurePsi: 0.5, maxFlowPph: 300 },
    { id: 'aux', kind: 'electric', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150,
      on: 'ac.fuel_pump_sw && elec.fuel_pump_powered', ratedAmps: 3 },
    { id: 'edp', kind: 'engine', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150, on: 'eng1.rpm > 50' },
  ],
  valves: [
    { id: 'sel_l', a: 'l_out', b: 'sel', open: 'ac.fuel_sel <= 1', travelS: 0 },
    { id: 'sel_r', a: 'r_out', b: 'sel', open: 'ac.fuel_sel >= 1', travelS: 0 },
    { id: 'shutoff', a: 'sel', b: 'strainer', open: 'ac.fuel_shutoff', travelS: 0 },
  ],
  consumers: [{ id: 'eng', node: 'servo', flowPph: 'eng1.ff_pph', engine: 1, minPressPsi: 1 }],
  balance: { left: 'left', right: 'right', alertKg: 10 * GAL },
});
```
The physics piston model expects `eng.fuel_on` to mean fuel pressure at the servo: selector open && (engine pump turning || aux pump on) && tank not empty. This config produces exactly that. With the aux pump on and the mixture rich, the engine is primed.

**737NG.**
- Tanks: two mains and a centre. Each main has FWD and AFT AC pumps at about 23 psi, with `lowPressWhenOff: true`. The centre has L and R pumps at a higher pressure (about 33 psi, EST) so they feed first.
- Valves: a crossfeed valve (`travelS: 2`) and spar valves on the start levers.
- Consumers: `run: 'ac.start_lever1'`, and `suction: { tank: 'main1' }` for suction feed.
- APU: a consumer with `flowPph: 'apu.ff_pph'` (no `engine`) on the left manifold.

**Jets with ejector pumps (M2, Gulfstream, Global).** Model the motive-flow pumps as `kind: 'ejector'` with `on: 'eng1.n2_pct > 45'`. The electric boost pumps have logic such as `on: 'ac.boost1 == 2 || (ac.boost1 == 1 && (fuel.eng1_lowpress || fadec1.start_req))'`. Crossflow or transfer is a `gravity` transfer with `bidirectional: true`.

---

## 5. Hydraulic: `HydraulicSystem` (`src/systems/hydraulic`)

```ts
new HydraulicSystem(vars, cfg: HydraulicConfig, opts?: { name? })
interface HydraulicConfig { prefix?: 'hyd.'; systems: HydSystemDef[]; pumps: HydPumpDef[]; transfers?: HydTransferDef[]; consumers?: HydConsumerDef[] }
HydSystemDef   { id, nominalPsi, reservoirL, initialQty? (1), accumulator?: { prechargePsi, volumeL }, complianceLPerKpsi? (0.05),
                 internalLeakLpm? (0.8), reliefPsi? (1.12×nominal), lowPressPsi? (0.5×nominal), lowQty? (0.2), leakLpm? (4) }
HydPumpDef     { id, system, kind: 'edp'|'electric'|'rat'|'hand', ratedPsi? (nominal), maxFlowLpm, drive: Binding (0..1.2),
                 on?: Binding, bandPsi? (150), lowPressPsi? (1300×rated/3000), lowPressWhenOff? (true),
                 electric?: { supply: 'dc'|'ac', efficiency? (0.75), nominalV? (28), noLoadW? (250) } }
HydTransferDef { id, kind: 'ptu'|'check', from, to, maxFlowLpm, active?: Binding, efficiency? (0.8), bidirectional?, triggerDeltaPsi? (500) }
HydConsumerDef { id, system, demandLpm: Binding, fullPsi? (0.5×nominal) }
```

### 5.1 Model

- **Pressure solve.** Each update does an implicit solve on the pressurised fluid volume: `[V(P') − V(P)]/dt = pumps(P') + transfers(P') − consumers(P') − leakage(P') − relief(P')`.
  - V is line compliance plus the accumulator fluid (isothermal gas).
  - Pumps are pressure-compensated: flow = Qmax·drive·clamp((Pset − P)/band).
- **Drive.** A variable-displacement pump's capacity scales with its speed. An EDP uses `drive: 'eng1.accessory_drive'` or `'eng1.n2_pct/100'`, so it has about 60 % capacity at idle N2. An electric pump uses `'elec.<load>_powered'`.
- **Consumers** get their full demand down to `fullPsi`, and flow falls in proportion to pressure below it. Actuators slow down, and `<consumer>_rate` tells gear, flaps and brakes how fast they may move.
- **Transfers.**
  - PTU: pressure `to` ≈ `from`·√eff. Input flow from the power balance is added to the source's demand. Unidirectional PTUs run when `active` is true and the source is above 20 % of nominal. Bidirectional PTUs run when |ΔP| > the trigger. For example, the 737 PTU uses A pressure to drive a pump in B; set `active` from the aircraft logic.
  - `check`: a check-valve charging line, e.g. the brake accumulator charged from system B. A check line also moves fluid between the two inventories.
- **Quantity.** Quantity = (inventory − stored − leaked)/reservoir. Pumps cavitate below 2 %.
- **Electric pump load:** `hyd.<pump>_amps` (DC at 28 V) or `hyd.<pump>_va` (AC) = P·Q/efficiency + no-load losses. Bind this to the electrical load's `amps` or `va`.

### 5.2 Outputs and API

- **System:** `<sys>_psi`, `<sys>_qty` (0..1), `<sys>_qty_pct`, `<sys>_lowpress`, `<sys>_lowqty`.
- **Pump:** `<pump>_on` (delivering capability), `<pump>_lowpress`, `<pump>_flow_lpm`, `<pump>_amps` or `<pump>_va`, `<pump>_overheat`.
- **Transfer:** `<xfer>_active`, `<xfer>_flow_lpm`.
- **Consumer:** `<cons>_rate`.

**Failures:**
- `hyd.<pump>`
- `hyd.<pump>.overheat` (electric pumps)
- `hyd.<sys>.leak`
- `hyd.<ptu>`

**API:** `pressure(id)`, `quantity(id)`, `service(id, fraction=1)`, `setPressure(id, psi)` (for `applyState`: engines running → nominal), `reset()`.

**737NG reference.**
- Systems A, B and standby run at 3,000 psi.
- The LOW PRESSURE light threshold is 1,300 psi.
- An EDP delivers about 4× the flow of an ACMP. EST: EDP 22 gpm, ACMP 5.7 gpm.
- The brake accumulator precharge is 1,000 psi.
- The standby system auto-activates when A or B falls below 1,300 psi.

Sources: smartcockpit 737NG hydraulics and the b737 notes. The test shows a single ACMP drooping under gear demand, the PTU, and the brake accumulator holding pressure for the parking brake.

---

## 6. Pneumatic: `PneumaticSystem` (`src/systems/pneumatic`)

```ts
new PneumaticSystem(vars, cfg: PneumaticConfig, opts?: { name? })
interface PneumaticConfig { prefix?: 'pneu.'; ducts: string[]; sources: BleedSourceDef[]; valves?; consumers?; packs?; zones?; starters?; ductLagS? (0.5); leakKgs? (0.4) }
BleedSourceDef  { id, duct, pressure: Binding ('eng1.bleed_press_psi' / 'apu.bleed_psi'), valve?: Binding, regulatedPsi? (45), maxFlowKgs,
                  engine?: number, reset?: Binding, hp?: { belowPsi, ratio }, travelS? (1.5) }
PneuValveDef    { id, a, b, open, travelS? (3), power? }
PneuConsumerDef { id, duct? | engine?, enginePressure?, demandKgs: Binding, minPsi? (20) }     // engine = nacelle AI from its own port
PackDef         { id, duct, on: Binding, flowKgs: Binding, minPsi? (18), reset?, minOutletC? (2), maxOutletC? (70) }
ZoneDef         { id, packs: string[], target: Binding (°C), volumeM3? (30), heatLoadW? (1500), heatCapacityKJK? (25×vol), skinUAWK? (3×vol), skin? ('fdm.tat_c'), initialC? }
AirStarterDef   { id, engine, duct, command, valvePower?, nominalPsi, demandKgs? (1.0), engineStarterVar? ('eng{engine}.starter'), engineStarterTau? }
```

### 6.1 Model

- **Valves and sources.**
  - PRSOVs and isolation valves move at their travel rates.
  - An overheat failure trips the PRSOV closed until the `reset` edge, and only after the fault has cleared.
  - Each open source offers min(port pressure, regulated) and a flow capacity of maxFlow·min(1, port/regulated). The HP port opens when LP pressure is low.
- **Duct pressure.**
  - A duct's group pressure is the best source pressure. It droops 15 % at full capacity and falls as capacity/demand once overloaded.
  - Duct pressure lags with τ = 0.5 s.
- **Consumers and bleed extract.**
  - Consumers receive flow = demand·min(1, psi/minPsi).
  - Served flow is shared among the group's sources in proportion to capacity.
  - `eng{i}.bleed_extract` = the engine's served flow ÷ its `maxFlowKgs`. Engine-direct consumers without a PRSOV source are normalised by 1 kg/s.
- **ATS starters.** The start valve is open when `command && valvePower && !failed`. Strength = duct psi / nominalPsi, which drives `eng{i}.starter` through the PWM. The valve draws air.
  - For the 737, set `nominalPsi` to about 30 (EST: a 30 psi start duct pressure is the usual figure).
- **Packs and zones.**
  - A pack delivers `flowKgs` × min(1, psi/minPsi).
  - Each zone controller asks for the supply temperature that closes its error with τ = 120 s. The pack outlet runs at the coldest demand of its zones, and trim air warms the others.
  - Zone temperature integrates the supply air, the heat load, and heat lost through the skin.

### 6.2 Outputs

- **Duct:** `<duct>_psi`, `<duct>_leak`.
- **Source:** `<src>_psi` (port), `<src>_valve_open`, `<src>_valve_pos`, `<src>_trip`, `<src>_flow_kgs`, `<src>_hp`.
- **Valve:** `<valve>_pos`, `<valve>_open`, `<valve>_transit`.
- **Consumer:** `<cons>_ok` (0..1: bind ice protection to it, e.g. `active: 'ac.wai_sw * pneu.wai_ok'`), `<cons>_flow_kgs`.
- **Pack:** `<pack>_on`, `<pack>_flow_kgs`, `<pack>_outlet_c`, `<pack>_trip`.
- **Pack total:** `pack_flow_kgs`, the inflow to pressurisation.
- **Zone:** `<zone>_temp_c`, `<zone>_supply_c`.
- **Starter:** `<st>_valve_open` (START VALVE OPEN), `<st>_strength`.
- **Engines:** `eng{i}.bleed_extract`.

**Failures:**
- `pneu.<src>.overheat`
- `pneu.<duct>.leak`
- `pneu.<valve>.stuck`
- `pneu.<pack>.overheat`
- `pneu.<starter>`: fails closed.
- `pneu.<starter>.open`: fails open, so the starter stays engaged.

**API:** `ductPressure(id)`, `snap(zoneTempC?)`, `reset()`.

---

## 7. Pressurisation: `Pressurization` (`src/systems/pressurization`)

```ts
new Pressurization(vars, cfg: PressurizationConfig)
interface PressurizationConfig {
  prefix?: 'press.'; cabinVolumeM3; maxDiffPsi; reliefPsi? (maxDiff+0.5); negReliefPsi? (0.5); schedule: Table1D /* cabin ft vs aircraft ft */;
  flightAltitude?: Binding;          // 737 FLT ALT or FMS cruise altitude: proportional climb schedule
  landingElevation?: Binding;        // LDG ALT knob
  landingElevationAuto?: Binding;    // default true when destinationElevation is given
  destinationElevation?: (ident) => number | undefined;   // e.g. (id) => ctx.nav.airport(id)?.elevationFt
  destinationVar?: 'fms.dest';
  maxCabinClimbFpm? (500); maxCabinDescentFpm? (300); landingBiasFt? (−300);
  groundPrepress?: { active: Binding; psi: number };      // 737 ≈ 0.1 psi on the takeoff roll
  inflowKgs: Binding;                // 'pneu.pack_flow_kgs'
  outflowValve?: { maxAreaM2? (3.5e-4×vol), autoTravelS? (5), manualTravelS? (20) };
  leakAreaM2? (1e-5×vol); safetyAreaM2?; decompressionAreaM2? (0.1);
  mode?: Binding /* 0 AUTO, 1 ALTN, 2 MANUAL */; manualCommand?: Binding /* −1 close .. +1 open */; dump?: Binding;
  autoTransferToAltn? (true); cabinAltWarnFt? (10000); masksDeployFt? (14000); masksManual?; masksReset?;
  onGround?; staticPressurePa?; pressureAltitudeFt?; cabinTempC?: Binding (22);
}
```

### 7.1 Physics

- **Cabin model.** The cabin air mass in the cabin volume is sub-stepped 8×. It has three flow paths:
  - inflow from the packs;
  - compressible orifice flow, in both directions, through the outflow valve, the leakage path and any breach;
  - the positive safety valve (opening proportionally over 0.1 psi above `reliefPsi`) and the negative relief valve.
- **Phases.** The controller moves through GROUND → CLIMB → DESCENT. DESCENT begins at peak − 1,500 ft, and a later climb of 1,500 ft returns to CLIMB.
- **Climb target.**
  - With `flightAltitude` set, the target moves from the takeoff cabin to schedule(Hc) in proportion to climb progress.
  - Without it, the target blends to schedule(H) over the first 10,000 ft.
- **Descent target:** proportional, from the top-of-descent cabin to landing elevation + bias.
- **Limits.**
  - The target is never below the altitude that gives `maxDiffPsi`.
  - The commanded cabin altitude is rate-limited.
- **Valve control and modes.**
  - The valve command inverts the orifice equation: feed-forward plus a proportional correction with τ = 3 s.
  - AUTO fail with `autoTransferToAltn` switches to ALTN. If the selected controller has failed, the valve freezes.
  - MANUAL drives the valve at `manualTravelS`. DUMP drives it fully open.

### 7.2 Outputs and API

**Outputs:** `cabin_alt_ft`, `cabin_rate_fpm` (2 s lag), `diff_psi`, `cabin_psi`, `outflow_pos`, `target_alt_ft`, `sched_alt_ft`, `ldg_elev_ft`,
`cabin_alt_warn` (≥ 10,000 ft with 200 ft hysteresis), `pax_masks` (latched at ≥ 14,000 ft or manual), `safety_valve`, `neg_relief`,
`excess_diff`, `mode`, `auto_fail`, `altn_fail`, `phase`, `inflow_kgs`, `outflow_kgs`.

**Failures:**
- `press.auto`
- `press.altn`
- `press.outflow`: jammed valve.
- `press.leak`: door seal, ×10 leakage.
- `press.decompression`

**API:**
- `settle()`: puts the cabin in equilibrium for a preset. On the ground the cabin is at field elevation; in flight it is on schedule. Call it after `fdm.reposition`.
- `reset()`
- `stowMasks()`
- `landingElevation()`
- `dispose()`: removes the `fms.dest` subscription.

**Helpers:** `pressureAtAltitudeFt(ft)`, `altitudeFtAtPressure(pa)`, `cabinAltitudeForDiff(altFt, diffPsi)`, `orificeFlow(area, pUp, pDown, T)`.

### 7.3 Presets (`presets.ts`)

These are `PressurizationPreset` objects: `{ maxDiffPsi, reliefPsi, schedule, maxCabinClimbFpm, maxCabinDescentFpm }`.

| Preset | Anchor (published) | Max diff |
|---|---|---|
| `PRESS_737NG` | 8,000 ft at FL410 (8.32 psid) | 8.35 psi, relief 8.95 psi |
| `PRESS_G650` | 4,850 ft at 51,000 ft | 10.7 psi (derived) |
| `PRESS_G800` | 2,916 ft at 41,000 ft; 4,850 ft at 51,000 ft (EST) | 10.7 psi |
| `PRESS_GLOBAL6000` | 4,500 ft at 45,000 ft; 5,680 ft at 51,000 ft (EST) | 10.33 psi (derived) |
| `PRESS_LONGITUDE` | 5,950 ft at 45,000 ft | 9.66 psi |
| `PRESS_M2` | ~7,580 ft at 41,000 ft (derived) | 8.5 psi (EST) |

Usage: `new Pressurization(vars, { ...PRESS_G650, cabinVolumeM3: 60, inflowKgs: 'pneu.pack_flow_kgs', ... })`.

---

## 8. Ice: `IceProtection` (`src/systems/ice`)

```ts
new IceProtection(vars, cfg: IceConfig)
interface IceConfig {
  prefix?: 'ice.'; surfaces: IceSurfaceDef[];
  detector?: { power?: Binding; threshold? (0.05); holdS? (60) };
  intensity?: Binding ('env.icing'); defaultIntensity? (0, used while env.icing was never written);
  cloudBaseFt?; cloudTopsFt?; cloudThicknessFt? (5000); cloudCover?; precip?; altitudeFt? ('fdm.alt_msl_ft'); satC?; tatC?; tasKt?;
}
interface IceSurfaceDef {
  id; output: string /* ICE.airframe, ICE.inlet(i), ICE.pitot(s), ICE.static(s), ICE.windshield(n), or a custom var */;
  ratePerMin; refTasKt? (150); speedExp? (1); engine?: number; meltRatePerMin? (0.3);
  protection?: { kind: 'thermal'|'electric'|'boots'|'fluid'; active: Binding (0..1); capacity? (1); shedRatePerMin?;
                 bootCycleS? (60); bootRemoval? (0.85); bootMinIce? (0.08); bootInflateS? (6) };
}
```

**Icing potential** = intensity × visible moisture × temperature factor(SAT), set to 0 when TAT is at or above 1 °C.
- **Visible moisture** is the larger of two terms:
  - the in-cloud factor (cloud cover, while between the base and the tops);
  - freezing precipitation (`env.precip` while SAT ≤ +2 °C).
- **Temperature factor** (`ICING_TEMP_FACTOR`): 0 above +2 °C and below −40 °C, peaking at 1 between −5 and −15 °C.

**Accretion** per minute = `ratePerMin × potential × (TAS/ref)^exp`.

**Protection:**
- **Thermal, electric or fluid:**
  - Protection prevents accretion up to `capacity × active`. Icing beyond that forms runback ice.
  - Existing ice melts at `shedRate × active × max(0, 1 − potential/capacity)`.
  - The default shed rates are 0.6, 1.0 and 0.3 per minute respectively.
- **Boots:** every `bootCycleS` an inflation removes 85 % of the ice, provided at least 0.08 has formed. `<id>_boots` is 1 while the boot is inflating.

**Natural loss:** ice melts above 0 °C TAT and sublimates slowly in dry air.

**Outputs:**
- the surface output var;
- `<id>_rate`, `<id>_protected`, `<id>_boots`;
- `visible_moisture`, `potential`, `detected`, `detector_fail`;
- `eng{i}.anti_ice` for surfaces that set `engine`.

**Failures:** `ice.<surface>.heat`, `ice.detector`. **API:** `clearIce()`, `reset()`.

Typical rates (EST):
- Unprotected wing: 0.1/min, so moderate icing (0.66) gives about 0.33 in 5 min.
- Inlet: 0.15/min.
- Pitot: 0.5/min with `speedExp: 0.5`.
- Windshield: 0.2/min.

---

## 9. APU: `Apu` (`src/systems/apu`)

```ts
new Apu(vars, cfg: ApuConfig)
interface ApuConfig {
  prefix?: 'apu.'; master: Binding; start?: Binding (rising edge); stop?: Binding (rising edge); autoStart? (false);
  starterVolts: Binding /* bus voltage at the starter */; starterNominalV? (24); starterPeakA? (400);
  fuelAvailable?: Binding (true) /* e.g. 'fuel.apu_on' */; fire?: Binding /* 'fire.apu_warn' */;
  bleedLoad?: Binding (0..1); genLoad?: Binding (0..1); maxBleedPsi? (48); bleedCeilingFt?;
  doorTimeS? (12); startTimeS? (45); startTimeoutS? (max(90, 2.5×start)); availDelayS? (2); cooldownS? (60);
  starterMaxPct? (30); lightOffPct? (10); starterCutoutPct? (55); selfSustainPct? (40);
  egtStartPeakC? (780); egtIdleC? (380); egtBleedC? (200); egtGenC? (60); egtLimitC? (1000); hotStartFactor? (0.5);
  ffIdlePph? (180); ffFullPph? (330); altitudeFt?; ambientC?;
}
ApuState = { Off: 0, Door: 1, Starting: 2, Running: 3, Cooldown: 4, Spooldown: 5 }
```

**Start sequence:**
1. Master ON opens the inlet door.
2. START engages the starter once the door is open. With `autoStart`, the start begins as soon as the door is open.
3. The starter cranks N toward starterMax·r, where r = volts/nominal.
4. Light-off happens at `lightOffPct` when fuel is available.
5. Combustion accelerates N to 100 %, with starter assist until `starterCutoutPct`.
6. AVAIL comes on at 95 % plus `availDelayS`.

A weak starter makes a slower, hotter start. Too low a voltage never reaches light-off, and the start times out with FAULT.

**Stop:** master OFF or STOP. If bleed air was used within `cooldownS`, the APU runs an unloaded COOLDOWN first. It then spools down, and the door closes below 10 % N.

**Auto shutdowns** latch FAULT until the master is OFF and the APU has stopped:
- fire;
- overspeed (`apu.overspeed`);
- low oil pressure (`apu.oil`);
- EGT above the limit for 1 s;
- start timeout;
- flameout (no fuel);
- `apu.fault`.

`apu.start` means no light-off.

**Outputs:** `n_pct`, `egt_c`, `state`, `running`, `avail`, `bleed_psi`, `gen_drive`, `door_pos`, `door_open`, `starting`, `starter`, `starter_amps`, `ign`, `fault`, `low_oil`, `overspeed`, `fire_shutdown`, `cooldown`, `ff_pph`, `oil_press_psi`, `fuel_cmd`.

**Wiring:**

| From | To |
|---|---|
| `apu.starter_amps` | an electrical load's `amps` on the APU battery bus |
| that bus voltage | `starterVolts` |
| `apu.gen_drive` | the APU `AcGenerator` `drive` (`minDrive: 95`) |
| `apu.bleed_psi` | a `BleedSourceDef` `pressure` |
| `apu.ff_pph` | a fuel consumer `flowPph` |
| the fuel consumer's `fuel.<id>_on` | `fuelAvailable` |

**API:** `setRunning(on)` (for presets), `reset()`, and the public fields `state`, `n`, `egt`, `door`, `fault`.

Test timeline at 24 V: door 12 s, light-off about 2–3 s later, AVAIL about 41 s after START, peak EGT about 720 °C. At 15 V the peak EGT is about 870 °C.

Reference: the 737NG APU start cycle can take up to 120 s. After switch OFF, if bleed air was used, the APU runs a 60 s cooldown.

---

## 10. Fire: `FireProtection` (`src/systems/fire`)

```ts
new FireProtection(vars, cfg: FireConfig)
interface FireConfig { prefix?: 'fire.'; zones: FireZoneDef[]; bottles: FireBottleDef[]; test?: { fire?: Binding; fault?: Binding }; seed? (7) }
FireZoneDef   { id, loops? (2), loopSelect?: Binding (0 NORMAL, 1 A, 2 B), handle: Binding, discharge?: { bottle, command }[],
                fuelCut?: Binding (= handle), autoDischarge?: { bottle, condition, delayS }, power?, extinguishChance? (0.9), extinguishChanceFuelOn? (0.3) }
FireBottleDef { id, chargePsi, dischargeS? (1.5), tempC?: Binding (21) }
```

**Detection:**
- Dual loops use AND logic in NORMAL.
- A faulted loop is deselected automatically.
- FAULT comes on when every selected loop has faulted.

This matches the 737NG notes: dual loops per engine, an OVHT DET switch with A / NORMAL / B, a single loop on the APU, and engine bottles at 800 psi.

**Fire:**
- `fail.fire.<zone>` starts a fire, which burns until it is extinguished. It stays out until the failure var is cleared and set again.
- A discharge needs the handle to be pulled (squibs armed) and a rising edge on its command.
- Each bottle discharged into a burning zone has a seeded chance to put the fire out: `extinguishChance` with the fuel cut, `extinguishChanceFuelOn` otherwise.
- One bottle can serve several zones, e.g. the 737 L and R bottles each serve both engines.

**Outputs:**
- Zone: `<zone>_warn`, `<zone>_ovht`, `<zone>_fault`, `<zone>_active`, `<zone>_armed`, `<zone>_agent`, `<zone>_loopa_fault`, `<zone>_loopb_fault`.
- Bottle: `<bottle>_psi`, `<bottle>_discharged` (< 50 %), `<bottle>_squib` (squib test lamp).
- System: `bell`, `test`.

**Failures:** `fire.<zone>`, `fire.<zone>.overheat`, `fire.<zone>.loopa`, `fire.<zone>.loopb`, `fire.<bottle>.leak`.

**API:** `rechargeBottles()`, `isFire(zone)`, `reset()`.

Engine consequences are the aircraft's responsibility. For example, bind the engine's `run` to `!fire.eng1_armed`, and the APU's `fire` input to `fire.apu_warn`.

---

## 11. Oxygen: `OxygenSystem` (`src/systems/oxygen`)

```ts
new OxygenSystem(vars, cfg: OxygenConfig)
interface OxygenConfig { prefix?: 'oxy.'; bottles: OxygenBottleDef[]; crew?: CrewMaskDef[]; pax?: PaxOxygenDef; cabinAltitudeFt?: Binding ('press.cabin_alt_ft') }
OxygenBottleDef { id, capacityL /* free gas NTPD */, fullPsi, initialPsi?, lowPsi? (25 %), valve?, leakLpm? (30) }
CrewMaskDef     { id, bottle, inUse: Binding, mode?: Binding (0 NORMAL diluter, 1 100 %, 2 EMERGENCY), minuteVolumeL? (15 BTPS), test? }
PaxOxygenDef    { kind: 'chemical'|'gaseous', deploy: Binding ('press.pax_masks'), durationS? (720), bottle?, flowLpm? (40) }
```

**Crew masks:**
- In NORMAL, the diluter O2 fraction follows `DILUTER_O2_FRACTION`: 0 at sea level, rising to 1 at 34,000 ft (EST).
- The gas used is converted from BTPS to NTPD at cabin pressure. EMERGENCY adds 10 L/min.

**Passengers:**
- Chemical generators flow for `durationS` once deployed and cannot be stopped. On the 737 the masks deploy at 14,000 ft cabin altitude, and 12, 15 or 22 min generators are available.
- Gaseous passenger oxygen flows from a bottle.

**Outputs:** `<bottle>_psi`, `<bottle>_low`, `<mask>_flow_lpm`, `<mask>_flowing`, `pax_deployed`, `pax_on`, `pax_remaining_s`.

**Failures:** `oxy.<bottle>.leak`, `oxy.pax`. **API:** `service()`, `bottlePsi(id)`, `reset()`.

For unpressurised aircraft, set `cabinAltitudeFt: 'fdm.press_alt_ft'`.

---

## 12. Lighting: `LightingSystem` (`src/systems/lighting`)

```ts
new LightingSystem(vars, cfg: LightingConfig)
interface LightingConfig { prefix?: 'light.'; exterior?: ExteriorLightDef[]; dimmers?: DimmerDef[] }
ExteriorLightDef { name, on: Binding (0..1 level), power?: Binding, pattern?: FlashPattern, phaseS?, tech?: 'incandescent'|'halogen'|'led'|'xenon' ('led'),
                   retract?: { extend: Binding; travelS: number } }
DimmerDef        { id, knob: Binding, power?, master?, test?, gamma? (1), min? (0), output?: string | string[] ('ac.light.<id>') }
FlashPattern = { kind: 'flash'; periodS; windows: number[] } | { kind: 'rotating'; periodS; sharpness? (6) }
FLASH_PATTERNS.doubleStrobe | singleStrobe | beaconFlash | beaconRotating
patternValue(pattern, phaseS): number
```

**Exterior lights:**
- Level = switch × power × pattern. Incandescent (τ 0.08/0.12 s) and halogen filaments lag; LED and xenon are instant.
- Anticollision presets flash 40–100 times per minute (14 CFR 25.1401(c)).
- A retractable light is dark until it is at least 90 % extended.

**Dimmers:** level = power × master × knob^gamma, never below `min` while the knob is on. Lamp test forces 1. The default output `ac.light.<id>` is what `cockpit/Lighting.ts` zones read.

**Outputs:** `light.<name>` (0..1) and `light.<name>_ext` for the exterior renderer. The recommended names are `nav`, `beacon`, `beacon_lower`, `strobe`, `strobe_tail`, `landing`, `landing_l`, `landing_r`, `landing_nose`, `taxi`, `turnoff_l`, `turnoff_r`, `logo`, `wing` and `recognition`.

**Failures:** `light.<name>`. **API:** `snap()` (retractable lights to their command).

---

## 13. `applyState` example

```ts
applyState(state) {
  const v = ctx.vars;
  const coldDark = state === 'cold_dark';
  v.set('ac.elec.batt_sw', coldDark ? 0 : 1);
  v.set('ac.gen1_sw', coldDark ? 0 : 1);
  fuel.snapValves();
  lights.snap();
  if (!coldDark) { hyd.setPressure('a', 3000); hyd.setPressure('b', 3000); apu.setRunning(false); }
  elec.settle();                 // relays and contactors settle
  press.settle();                // after ctx.fdm.reposition(...)
  pneu.snap(22);
}
```

---

## 14. Known limitations (SCOPE)

- **Electrical.**
  - AC sources are not paralleled or synchronised. Frequency comes from the first source in the island.
  - DC diodes are ideal, with no forward drop.
  - Link currents are only computed for bridge links. A link inside a loop reports 0 A and does not heat its breaker.
  - A bus fault isolates the bus. It does not model fault current.
  - Relay coils draw no current.
  - The `elec.<batt>_v` output is the bus voltage while connected.
- **Starters.** `eng.starter` is a boolean in the physics module, so starter strength is pulse-width modulated (§1.4). This is exact at the starter-only equilibrium and approximate during transients.
- **Fuel.**
  - Pump pressure tiers are static (`pressurePsi`).
  - Partially open valves count as fully open or fully closed.
  - There is no fuel heating from the hydraulic or oil heat exchangers.
  - Tank transfer by vent or crossflow in the 172's BOTH position is not modelled; both tanks feed equally.
- **Hydraulic.**
  - Fluid temperature is not modelled.
  - Consumers are flow sinks and do not model actuator force.
  - PTU and check lines lag by one update.
- **Pneumatic.**
  - Ducts are quasi-static. No duct temperature is computed, so overheat is a failure input.
  - The pack cooling capacity limit is only the outlet temperature clamp.
- **Pressurisation.**
  - Cabin temperature is constant unless bound.
  - The schedules are linear between the published anchor points (EST).
  - ALTN uses the same control law as AUTO.
- **Ice.** Liquid water content and droplet size are folded into `env.icing`. Ice is one number per surface, with no shape or type.
- **APU.** An empirical spool model, not thermodynamic. Bleed pressure is a function of N; the load compressor surge line is not modelled.
- **Fire.** Extinguishing is probabilistic. Nacelle temperature is not modelled.
- **Oxygen.** No mask leakage. Regulator schedules are EST.

---

## 15. Contract additions (append-only)

Appended to `src/core/vars.ts`:

| Const | Members |
|---|---|
| `FAIL` | `state(id)` → `fail.<id>`; `activeCount`; `armedCount` |
| `CB` | `in(name)` → `cb.<name>`; `tripped(name)` → `cb.<name>_tripped` |
| `ELEC` | `volts(id)`, `powered(id)`, `amps(id)`, `hz(id)`, `soc(battery)`, `online(source)`, `loadPct(source)` |
| `HYD` | `psi(sys)`, `qty(sys)`, `lowPress(id)` |
| `PRESS` | `cabinAlt`, `cabinRate`, `diff`, `outflowPos`, `targetAlt`, `landingElev`, `cabinAltWarn`, `paxMasks` |
| `LIGHT` | `level(name)` → `light.<name>`; `extension(name)` → `light.<name>_ext` |
