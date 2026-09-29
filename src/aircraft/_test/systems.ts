/**
 * Systems of the development test jet (`_test-jet`): a generic light twin
 * turbofan (physics TEST_JET) whose cockpit is the cockpit module's demo
 * panel. It exists to prove the whole pipeline (input -> systems -> FDM ->
 * world/cockpit/avionics/audio) with the real systems library; numbers are
 * EST like the TEST_JET FDM they drive (CJ4 / Phenom 300 class).
 *
 * Demo-panel controls and what they drive:
 *   BATT toggle (ac.demo.batt)            battery contactor
 *   GEN korry (ac.demo.gen)               both starter-generators on line
 *   ENG START (ac.demo.start)             START (2) starts eng 1, then eng 2; DISENG (0) aborts
 *   FUEL PUMP (ac.demo.fuel_pump)         boost pumps OFF / NORM (auto) / ON
 *   FUEL selector (ac.demo.fuel_sel)      LEFT / BOTH / RIGHT crossfeed, OFF = firewall shutoff
 *   FUEL CUTOFF lever (ac.demo.cutoff)    run levers (both engines)
 *   THRUST L/R (ac.demo.tla1/2)           FADEC detents IDLE/CRU/CLB/TO, reverse below IDLE gate
 *   FLAPS (ac.demo.flap_handle)           0 / 7 / 15 / 35 deg
 *   SPEEDBRAKE (ac.demo.speedbrake)       DN / ARM (ground spoilers) / UP
 *   LANDING GEAR (ac.demo.gear_handle)    DN = 0, UP = 1 (inverted into ac.test.gear_dn)
 *   PARKING BRAKE (ac.demo.park_brake)    mechanical parking brake
 *   PITCH TRIM wheel + yoke rocker        TrimAxis (wheel var = trim position)
 *   NAV / BEACON / STROBE / WING switches exterior lights
 *   PITOT HT breaker (ac.demo.cb_pitot)   pitot heat load
 */
import { ENG, NAV, GPS } from '../../core/vars';
import type { SimContext } from '../../core/SimContext';
import type { Subsystem } from '../types';
import { FailureManager } from '../../systems/failures';
import { ElectricalNetwork, BATTERY_RG380E44 } from '../../systems/electrical';
import { FuelSystem } from '../../systems/fuel';
import { AirDataComputer, Ahrs } from '../../systems/sensors';
import { LandingGear, Brakes } from '../../systems/gear';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController } from '../../systems/fadec';
import { MechanicalFlightControls, TrimAxis, Flaps, Spoilers, NosewheelSteering } from '../../systems/flightcontrols';
import { StallWarning, Overspeed } from '../../systems/warning';
import { LightingSystem, FLASH_PATTERNS } from '../../systems/lighting';
import { compileBinding, type Binding } from '../../systems/util';
import { DEMO_VARS } from '../../cockpit/demo/DemoPanel';
import { TEST_JET } from '../../physics/testAircraft';

/** Aircraft-specific derived vars. */
export const TEST_VARS = {
  gearDown: 'ac.test.gear_dn',
  tla: (i: number) => `ac.test.tla${i}`,
  avnPowered: 'elec.avn_powered',
  mainPowered: 'elec.main_powered',
  eng1Fire: 'ac.test.eng1_fire',
} as const;

/** Tiny expression-driven logic block: writes `out = binding` in order every update. */
export class LogicBlock implements Subsystem {
  readonly name: string;
  private readonly outs: string[];
  private readonly evals: (() => number)[];
  constructor(
    private readonly ctx: Pick<SimContext, 'vars'>,
    name: string,
    rules: { out: string; value: Binding }[],
  ) {
    this.name = name;
    this.outs = rules.map((r) => r.out);
    this.evals = rules.map((r) => compileBinding(ctx.vars, r.value));
  }
  update(): void {
    const v = this.ctx.vars;
    for (let i = 0; i < this.outs.length; i++) v.set(this.outs[i], this.evals[i]());
  }
}

/** TO/CLB/CRZ/GA N1 ratings: EST for the test jet (flat-rated to ISA+15 at sea level, falling with altitude). */
function rating(sl: number, fl200: number, fl400: number): { x: number[]; y: number[]; z: number[][] } {
  const temps = [-40, 0, 15, 30, 50];
  const alts = [0, 20000, 41000];
  const row = (base: number) => temps.map((t) => (t <= 30 ? base : base - (t - 30) * 0.25));
  return { x: alts, y: temps, z: [row(sl), row(fl200), row(fl400)] };
}

export interface TestJetSystems {
  list: Subsystem[];
  logic: LogicBlock;
  failures: FailureManager;
  elec: ElectricalNetwork;
  fuel: FuelSystem;
  adc: AirDataComputer;
  ahrs: Ahrs;
  gear: LandingGear;
  brakes: Brakes;
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  fcs: MechanicalFlightControls;
  trim: TrimAxis;
  flaps: Flaps;
  spoilers: Spoilers;
  steering: NosewheelSteering;
  lights: LightingSystem;
}

export const FLAP_DETENTS = [
  { lever: 0, flapDeg: 0, label: 'UP', vfe: 305 },
  { lever: 1, flapDeg: 7, label: '1', vfe: 200 }, // EST placards
  { lever: 2, flapDeg: 15, label: '15', vfe: 200 },
  { lever: 3, flapDeg: 35, label: '35', vfe: 165 },
];

export function createTestJetSystems(ctx: SimContext): TestJetSystems {
  const env = ctx;
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 7 });

  // Derived cockpit logic: gear handle sense, reverse-range scaling, avionics/display power.
  const logic = new LogicBlock(ctx, 'test_logic', [
    { out: TEST_VARS.gearDown, value: `${DEMO_VARS.gear} == 0` },
    // Demo levers reach -0.3 at full reverse; the FADEC's integral reverse range is -1..0.
    { out: TEST_VARS.tla(1), value: `${DEMO_VARS.tla1} >= 0 ? ${DEMO_VARS.tla1} : ${DEMO_VARS.tla1} / 0.3` },
    { out: TEST_VARS.tla(2), value: `${DEMO_VARS.tla2} >= 0 ? ${DEMO_VARS.tla2} : ${DEMO_VARS.tla2} / 0.3` },
    { out: 'display.pfd1.power', value: TEST_VARS.avnPowered },
    { out: 'display.pfd1.brt', value: `0.35 + 0.65 * max(${DEMO_VARS.panelLt}, env.ambient_light)` },
    { out: NAV.powered(1), value: TEST_VARS.avnPowered },
    { out: NAV.powered(2), value: TEST_VARS.avnPowered },
    { out: NAV.adfPowered(1), value: TEST_VARS.avnPowered },
    { out: NAV.markerPowered, value: TEST_VARS.avnPowered },
    { out: GPS.powered, value: TEST_VARS.avnPowered },
  ]);

  // Electrical: 24 V lead-acid battery (Citation-class RG380E44), two 300 A starter-generators (EST for the class),
  // main bus + avionics bus behind an avionics relay.
  const elec = new ElectricalNetwork(ctx.vars, {
    buses: [{ id: 'batt_bus' }, { id: 'main' }, { id: 'avn' }],
    batteries: [{ id: 'batt', bus: 'batt_bus', ...BATTERY_RG380E44, ambientC: 'fdm.sat_c' }],
    dcGenerators: [1, 2].map((i) => ({
      id: `sg${i}`,
      bus: 'main',
      kind: 'starter-generator' as const,
      regulatedV: 28.5,
      ratedA: 300,
      drive: ENG.n2(i),
      minDrive: 50,
      switch: DEMO_VARS.gen,
      starter: {
        command: `fadec.eng${i}.starter_cmd`,
        bus: 'batt_bus',
        speed: ENG.n2(i),
        noLoadSpeed: 35, // EST ~1.25 x starterMaxN2 (28 %)
        resistanceOhm: 0.02, // EST, systems-power doc
        nominalV: 24,
        engineStarterVar: ENG.starter(i),
        // Start relay: pull-in 15 V max (MIL-PRF-6106/26, 28 V class relay); hold down to 7 V (EST, between
        // the spec's 1.5 V drop-out floor and pull-in). The normal ~16 V dip under the ~800 A locked-rotor
        // current of a battery start keeps it closed; a flat battery makes it chatter or drop out.
        contactor: { pickupV: 15, dropoutV: 7 },
      },
    })),
    links: [
      { id: 'batt_contactor', a: 'batt_bus', b: 'main', closed: DEMO_VARS.batt, coil: { pickupV: 14, dropoutV: 10 } },
      { id: 'avn_relay', a: 'main', b: 'avn', closed: `${DEMO_VARS.batt} && cb.avn ?? 1`, cb: { name: 'avn', ratingA: 25 } },
    ],
    loads: [
      { id: 'avionics', bus: 'avn', amps: 18 },
      { id: 'pitot_heat', bus: 'main', amps: 12, model: 'resistive', enabled: `${DEMO_VARS.cbPitot} ?? 1`, cb: { name: 'pitot', ratingA: 15 } },
      { id: 'nav_lts', bus: 'main', amps: 3, model: 'resistive', enabled: DEMO_VARS.navLt },
      { id: 'beacon', bus: 'main', amps: 2, enabled: 'ac.demo.beacon' },
      { id: 'strobes', bus: 'main', amps: 5, enabled: 'ac.demo.strobe' },
      { id: 'boost_pumps', bus: 'main', amps: 'fuel.boost_l_amps + fuel.boost_r_amps' },
      { id: 'panel_lts', bus: 'main', amps: `4 * ${DEMO_VARS.panelLt}`, model: 'resistive' },
      { id: 'gear_motor', bus: 'main', amps: '40 * gear.moving' },
      { id: 'flap_motor', bus: 'main', amps: '20 * flaps.moving' },
    ],
  });

  // Fuel: two wing tanks (TEST_JET capacities), ejector pumps (engine motive flow) and electric boost pumps.
  const cap = TEST_JET.mass.tanks;
  const fuel = new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'left', index: 0, capacityKg: cap[0].capacity_kg, unusableKg: cap[0].unusable_kg, initialKg: cap[0].capacity_kg * 0.7, lowLevelKg: 90 },
      { id: 'right', index: 1, capacityKg: cap[1].capacity_kg, unusableKg: cap[1].unusable_kg, initialKg: cap[1].capacity_kg * 0.7, lowLevelKg: 90 },
    ],
    nodes: ['l_man', 'r_man', 'l_feed', 'r_feed'],
    pumps: [
      { id: 'ejector_l', kind: 'ejector', from: 'left', to: 'l_man', pressurePsi: 25, maxFlowPph: 1500, on: 'eng1.n2_pct > 45' },
      { id: 'ejector_r', kind: 'ejector', from: 'right', to: 'r_man', pressurePsi: 25, maxFlowPph: 1500, on: 'eng2.n2_pct > 45' },
      {
        id: 'boost_l',
        kind: 'electric',
        from: 'left',
        to: 'l_man',
        pressurePsi: 22,
        maxFlowPph: 1200,
        on: `elec.main_powered && (${DEMO_VARS.fuelPump} == 2 || (${DEMO_VARS.fuelPump} == 1 && (fuel.ejector_l_lowpress || fadec.eng1.start_state > 0 && fadec.eng1.start_state < 4)))`,
        ratedAmps: 6,
      },
      {
        id: 'boost_r',
        kind: 'electric',
        from: 'right',
        to: 'r_man',
        pressurePsi: 22,
        maxFlowPph: 1200,
        on: `elec.main_powered && (${DEMO_VARS.fuelPump} == 2 || (${DEMO_VARS.fuelPump} == 1 && (fuel.ejector_r_lowpress || fadec.eng2.start_state > 0 && fadec.eng2.start_state < 4)))`,
        ratedAmps: 6,
      },
    ],
    valves: [
      // Selector: LEFT(0) both engines from the left tank; RIGHT(2) from the right; BOTH(1) normal; OFF(3) firewall shutoff.
      { id: 'fw_l', a: 'l_man', b: 'l_feed', open: `${DEMO_VARS.fuelSel} == 1 || ${DEMO_VARS.fuelSel} == 0`, travelS: 1 },
      { id: 'fw_r', a: 'r_man', b: 'r_feed', open: `${DEMO_VARS.fuelSel} == 1 || ${DEMO_VARS.fuelSel} == 2`, travelS: 1 },
      { id: 'xfeed', a: 'l_feed', b: 'r_feed', open: `${DEMO_VARS.fuelSel} == 0 || ${DEMO_VARS.fuelSel} == 2`, travelS: 2 },
    ],
    consumers: [
      // Fire handle pulled = engine 1 fuel shutoff.
      { id: 'eng1', node: 'l_feed', flowPph: ENG.fuelFlowPph(1), engine: 1, run: `fadec.eng1.fuel_cmd && !${DEMO_VARS.fire}`, suction: { tank: 'left' } },
      { id: 'eng2', node: 'r_feed', flowPph: ENG.fuelFlowPph(2), engine: 2, run: 'fadec.eng2.fuel_cmd', suction: { tank: 'right' } },
    ],
    balance: { left: 'left', right: 'right', alertKg: 90 },
  });

  const adc = new AirDataComputer(env, { index: 1, power: TEST_VARS.avnPowered });
  const ahrs = new Ahrs(env, { index: 1, power: TEST_VARS.avnPowered });

  const gear = new LandingGear(env, {
    legs: [
      { index: 0, name: 'Nose', extendS: 6, retractS: 5 }, // EST bizjet gear cycle times
      { index: 1, name: 'Left main', extendS: 7, retractS: 6 },
      { index: 2, name: 'Right main', extendS: 7, retractS: 6 },
    ],
    handleVar: TEST_VARS.gearDown,
    actuation: { power: TEST_VARS.mainPowered },
    groundRetractInhibit: true,
    horn: { rules: [{ when: `${DEMO_VARS.tla1} < 0.2 && ${DEMO_VARS.tla2} < 0.2 && adc1.ias_kt < 150 && adc1.ias_kt > 60`, silenceable: true }] },
    lights: { power: TEST_VARS.mainPowered },
  });

  const ratings = new ThrustRatingComputer(env, {
    ratings: { TO: rating(98, 97, 95), CLB: rating(94, 95, 94), CRZ: rating(90, 92, 92), GA: rating(98, 97, 95) },
    auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA' },
  });
  const fadec = new ThrustLeverFadec(
    env,
    {
      engines: [1, 2],
      leverVar: (e) => TEST_VARS.tla(e),
      law: {
        kind: 'detent',
        detents: [
          { lever: 0.7, rating: 'CRZ', label: 'CRU' },
          { lever: 0.85, rating: 'CLB', label: 'CLB' },
          { lever: 1, rating: 'TO', label: 'TO' },
        ],
      },
      idle: { ground: 24, flight: { x: [0, 20000, 41000], y: [26, 30, 38] } }, // EST flight idle schedule
      reverse: { maxN1: 70, deployS: 1.5, stowS: 2, power: TEST_VARS.mainPowered },
      power: () => TEST_VARS.mainPowered,
    },
    ratings,
  );
  const starts = [1, 2].map(
    (i) =>
      new EngineStartController(env, {
        engine: i,
        startSwitch: i === 1 ? `${DEMO_VARS.start} == 2 && !eng1.running` : `${DEMO_VARS.start} == 2 && eng1.running && !eng2.running`,
        stopSwitch: `${DEMO_VARS.start} == 0`,
        runLever: `${DEMO_VARS.cutoff} >= 0.5`,
        fuelOnN2Pct: 12, // TEST_JET light-off N2 10 %
        starterCutoutN2Pct: 45, // EST
        idleN2Pct: 58,
        hotStartIttC: 800, // TEST_JET ittMax
        // DC at the starter bus above the start relay's drop-out voltage. Not 'elec.batt_bus_powered' (18 V
        // bus threshold): the normal cranking dip made that flag chatter at 60 Hz and the engine never started.
        starterAvailable: 'elec.batt_bus_v >= 7',
        ignitionPower: TEST_VARS.mainPowered,
      }),
  );

  const fcs = new MechanicalFlightControls(env, {});
  const trim = new TrimAxis(env, {
    axis: 'pitch',
    range: [-1, 1],
    positionVar: DEMO_VARS.trim,
    electric: { power: TEST_VARS.mainPowered, switchVars: ['input.pitch_trim_rate', DEMO_VARS.yokeTrim], rate: 0.12 },
    takeoffBand: [-0.2, 0.3],
  });
  const flaps = new Flaps(env, { leverVar: DEMO_VARS.flaps, detents: FLAP_DETENTS, normal: { power: TEST_VARS.mainPowered, rateDegPerS: 2.5 } });
  const spoilers = new Spoilers(env, {
    leverVar: DEMO_VARS.spdbrk,
    armedValue: 0.1,
    flightDetent: 1,
    auto: { thrustIdle: `${DEMO_VARS.tla1} <= 0.02 && ${DEMO_VARS.tla2} <= 0.02`, raVar: 'fdm.radio_alt_ft', rto: { speedKt: 60 } },
  });
  const steering = new NosewheelSteering(env, {
    tiller: { maxDeg: 60 },
    pedals: { maxDeg: 12, fade: { x: [0, 30, 80], y: [1, 0.6, 0.2] } },
    power: TEST_VARS.mainPowered,
  });
  const brakes = new Brakes(env, {
    sources: [{ id: 'power_brake', pressurePsi: `${TEST_VARS.mainPowered} ? 3000 : 0` }],
    maxPsi: 3000,
    accumulator: { chargeFrom: `${TEST_VARS.mainPowered} ? 3000 : 0`, prechargePsi: 1000, maxPsi: 3000 },
    parking: { var: DEMO_VARS.park, kind: 'mechanical' },
    antiskid: { enabled: TEST_VARS.mainPowered },
  });
  // Stick shaker from the ADC AoA vane against the FDM's stall AoA schedule (TEST_JET alphaStall_deg vs flaps).
  const stall = new StallWarning(env, { kind: 'aoa', alphaStall: TEST_JET.aero.alphaStall_deg, shakerNorm: 0.85, power: TEST_VARS.mainPowered });
  const overspeed = new Overspeed(env, { vmoKt: TEST_JET.limits.vmo_kt, mmo: TEST_JET.limits.mmo, power: TEST_VARS.mainPowered });
  const lights = new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: DEMO_VARS.navLt, power: 'elec.nav_lts_powered', tech: 'led' },
      { name: 'beacon', on: 'ac.demo.beacon', power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'strobe', on: 'ac.demo.strobe', power: 'elec.strobes_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'xenon' },
      { name: 'landing', on: 'ac.demo.wing_lt', power: TEST_VARS.mainPowered, tech: 'led' },
    ],
  });

  const fire = new FireLogic(ctx, failures);
  failures.register({ id: 'fire.eng1', name: 'Engine 1 fire', category: 'Fire', description: 'Fire detected in the left engine nacelle' });
  const list: Subsystem[] = [failures, fire, logic, elec, fuel, adc, ahrs, gear, ratings, fadec, ...starts, stall, fcs, trim, flaps, spoilers, steering, brakes, overspeed, lights];
  for (const s of [elec, fuel, gear, fcs, trim, flaps, spoilers, steering, brakes, adc, ahrs, fadec, ...starts, stall, overspeed, lights]) {
    const f = (s as { failures?: () => ReturnType<FailureManager['list']> }).failures;
    if (typeof f === 'function') failures.register(f.call(s));
  }
  return { list, logic, failures, elec, fuel, adc, ahrs, gear, brakes, ratings, fadec, starts, fcs, trim, flaps, spoilers, steering, lights };
}

/** Writes the demo panel's own indicator vars from the real systems (called after the demo panel's hook). */
export function driveDemoIndicators(ctx: Pick<SimContext, 'vars'>): void {
  const v = ctx.vars;
  const main = v.get('elec.main_v');
  v.set(DEMO_VARS.busV, main);
  // GEN korry: FAIL (amber) when the switch is on but a generator is off line with its engine running.
  const genFail = v.get(DEMO_VARS.gen) !== 0 && ((v.get(ENG.running(1)) !== 0 && v.get('elec.sg1_online') === 0) || (v.get(ENG.running(2)) !== 0 && v.get('elec.sg2_online') === 0));
  v.set(DEMO_VARS.genFail, genFail ? 1 : 0);
  v.set(DEMO_VARS.gearTransit, v.get('gear.red0') || v.get('gear.red1') || v.get('gear.red2') ? 1 : 0);
  v.set('display.demo.power', v.get(TEST_VARS.avnPowered));
  // Engine 1 fire (failure 'fire.eng1', see FireLogic) lights the handle and FIRE annunciator.
  v.set(DEMO_VARS.fireWarn, v.get(TEST_VARS.eng1Fire));
}

/**
 * Engine 1 fire logic for the demo fire handle: the `fire.eng1` failure sets
 * the warning (handle unlocks); pulling the handle shuts off engine 1 fuel
 * (FuelSystem run binding); rotating the pulled handle discharges the bottle,
 * which extinguishes the fire after 2 s (EST) and is then empty.
 */
export class FireLogic implements Subsystem {
  readonly name = 'test_fire';
  private dischargeT = -1;
  bottleUsed = false;
  constructor(
    private readonly ctx: Pick<SimContext, 'vars'>,
    private readonly failures: FailureManager,
  ) {}
  update(dt: number): void {
    const v = this.ctx.vars;
    const fire = v.get('fail.fire.eng1') !== 0;
    v.set(TEST_VARS.eng1Fire, fire ? 1 : 0);
    if (!this.bottleUsed && v.get(DEMO_VARS.fire) !== 0 && v.get(DEMO_VARS.fireRot) !== 0) {
      this.bottleUsed = true;
      this.dischargeT = 0;
    }
    if (this.dischargeT >= 0) {
      this.dischargeT += dt;
      if (this.dischargeT >= 2) {
        this.dischargeT = -1;
        if (fire) this.failures.clear('fire.eng1');
      }
    }
    v.set('ac.test.bottle_empty', this.bottleUsed ? 1 : 0);
  }
  reset(): void {
    this.dischargeT = -1;
    this.bottleUsed = this.ctx.vars.get('ac.test.bottle_empty') !== 0;
  }
}
