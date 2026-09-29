import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ALERT, GEAR, GPS, INPUT } from '../../../src/core/vars';
import { LandingGear, type LandingGearConfig } from '../../../src/systems/gear/LandingGear';
import { Brakes, KTS_TO_FPS2, type BrakeConfig } from '../../../src/systems/gear/Brakes';
import { AUTOBRAKE_737NG, gearHornRules } from '../../../src/systems/gear/presets';

const DT = 1 / 60;

function gear(extra: Partial<LandingGearConfig> = {}) {
  const vars = new SimVars();
  const events = new EventBus();
  vars.set('hyd.sys_psi', 3000);
  for (const i of [0, 1, 2]) vars.set(GEAR.weightOnWheels(i), 0);
  const cfg: LandingGearConfig = {
    legs: [
      { index: 0, name: 'nose', extendS: 7, retractS: 8 },
      { index: 1, name: 'left', extendS: 7, retractS: 8 },
      { index: 2, name: 'right', extendS: 7, retractS: 8 },
    ],
    actuation: { power: 'clamp01(hyd.sys_psi / 3000)' },
    doors: { openS: 1.5, closeS: 1.5 },
    squat: { legs: [1, 2], airToGroundS: 0.1, groundToAirS: 0.5 },
    horn: {
      rules: gearHornRules({ throttleRetarded: 'ac.tla1 < 0.05', lowAltitude: 'ra1.alt_ft < 800', approachFlapsDeg: 15, landingFlapsDeg: 25 }),
    },
    ...extra,
  };
  const g = new LandingGear({ vars, events }, cfg);
  const run = (s: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(s / DT); i++) {
      each?.();
      g.update(DT);
    }
  };
  return { vars, events, g, run };
}

describe('LandingGear', () => {
  it('retracts in doors + travel time, shows red in transit and up & locked without lights; extends to three greens', () => {
    const { vars, run } = gear();
    vars.set('ra1.alt_ft', 1500);
    vars.set('ac.tla1', 0.8);
    run(1);
    expect(vars.get('gear.air_ground')).toBe(0);
    expect(vars.get('gear.green0')).toBe(1);
    vars.set('ac.gear_handle', 0);
    run(1);
    expect(vars.get(GEAR.pos(1))).toBe(1); // doors still opening
    expect(vars.get('gear.red1')).toBe(1);
    run(5);
    expect(vars.get(GEAR.pos(1))).toBeGreaterThan(0.1);
    expect(vars.get(GEAR.pos(1))).toBeLessThan(0.9);
    expect(vars.get('gear.transit')).toBe(1);
    run(5);
    expect(vars.get('gear.up_locked')).toBe(1);
    expect(vars.get('gear.red1')).toBe(0);
    expect(vars.get('gear.green1')).toBe(0);
    vars.set('ac.gear_handle', 1);
    run(12);
    expect(vars.get('gear.down_locked')).toBe(1);
    expect(vars.get('gear.green0') + vars.get('gear.green1') + vars.get('gear.green2')).toBe(3);
  });

  it('handle lock holds DN on the ground; squat switches are debounced', () => {
    const { vars, g, run } = gear();
    for (const i of [0, 1, 2]) vars.set(GEAR.weightOnWheels(i), 1);
    run(0.05);
    expect(g.onGround).toBe(false); // debounce not elapsed
    run(0.2);
    expect(g.onGround).toBe(true);
    expect(vars.get('gear.handle_lock')).toBe(1);
    vars.set('ac.gear_handle', 0);
    run(0.1);
    expect(vars.get('ac.gear_handle')).toBe(1);
    expect(vars.get('gear.down_locked')).toBe(1);
    for (const i of [0, 1, 2]) vars.set(GEAR.weightOnWheels(i), 0);
    run(0.3);
    expect(g.onGround).toBe(true);
    run(0.3);
    expect(g.onGround).toBe(false);
  });

  it('horn: thrust idle below 800 ft is silenceable; landing flaps is not', () => {
    const { vars, events, run } = gear({ initialDown: false });
    vars.set('ac.gear_handle', 0);
    vars.set('ac.tla1', 0);
    vars.set('ra1.alt_ft', 600);
    run(0.1);
    expect(vars.get('gear.horn')).toBe(1);
    expect(vars.get(ALERT.gearWarning)).toBe(1);
    expect(vars.get('gear.red0')).toBe(1); // unsafe: not down with the horn condition
    events.emit('gear.horn_silence');
    run(0.1);
    expect(vars.get('gear.horn')).toBe(0);
    vars.set('surf.flaps_deg', 30);
    run(0.1);
    expect(vars.get('gear.horn')).toBe(1);
    events.emit('gear.horn_silence');
    run(0.1);
    expect(vars.get('gear.horn')).toBe(1);
    // Gear down removes it
    vars.set('surf.flaps_deg', 0);
    vars.set('ac.gear_handle', 1);
    run(12);
    expect(vars.get('gear.horn')).toBe(0);
  });

  it('hydraulic loss: unlocked legs fall under gravity; free-fall alternate extension from the uplocks', () => {
    const { vars, run } = gear({ initialDown: false, alternate: { kind: 'freefall', trigger: 'ac.gear_alt_ext' } });
    vars.set('ac.gear_handle', 0);
    vars.set('ra1.alt_ft', 5000);
    vars.set('hyd.sys_psi', 0);
    vars.set('ac.gear_handle', 1);
    run(15);
    expect(vars.get('gear.up_locked')).toBe(1); // stays in the uplocks without pressure
    vars.set('ac.gear_alt_ext', 1);
    run(12);
    expect(vars.get('gear.down_locked')).toBe(1);
  });

  it('blowdown is one-shot: the gear cannot be retracted afterwards', () => {
    const { vars, run } = gear({ alternate: { kind: 'blowdown', trigger: 'ac.blowdown', blowdownS: 3 } });
    vars.set('ac.blowdown', 1);
    run(0.1);
    vars.set('ac.blowdown', 0);
    vars.set('ac.gear_handle', 0);
    run(15);
    expect(vars.get('gear.blowdown_used')).toBe(1);
    expect(vars.get('gear.down_locked')).toBe(1);
  });

  it('a jammed leg produces a gear disagree', () => {
    const { vars, run } = gear();
    vars.set('fail.gear.leg2.jam', 1);
    vars.set('ac.gear_handle', 0);
    run(30);
    expect(vars.get('gear.disagree')).toBe(1);
    expect(vars.get('gear.red2')).toBe(1);
    expect(vars.get(GEAR.pos(2))).toBe(1);
  });
});

/** Ground-roll plant for brake tests: deceleration from brakes (and optional reverse), wheel dynamics with slip. */
class RollPlant {
  v: number;
  wheelL: number;
  wheelR: number;
  constructor(private readonly vars: SimVars, kt: number, public mu = 0.6) {
    this.v = kt;
    this.wheelL = kt;
    this.wheelR = kt;
  }
  step(dt: number, maxBrakeDecelFps2 = 16): void {
    const bL = this.vars.get(GEAR.brakeLeft);
    const bR = this.vars.get(GEAR.brakeRight);
    const decelFps2 = ((bL + bR) / 2) * maxBrakeDecelFps2 + 0.5;
    this.v = Math.max(0, this.v - (decelFps2 / KTS_TO_FPS2) * dt);
    // Wheels lock when the demanded brake exceeds the friction limit (mu).
    const lock = (b: number): boolean => b > this.mu;
    this.wheelL = lock(bL) ? Math.max(0, this.wheelL - 200 * dt) : Math.min(this.v, this.wheelL + 300 * dt);
    this.wheelR = lock(bR) ? Math.max(0, this.wheelR - 200 * dt) : Math.min(this.v, this.wheelR + 300 * dt);
    this.vars.set(GPS.gs, this.v);
    this.vars.set(GEAR.wheelSpeedKt(1), this.wheelL);
    this.vars.set(GEAR.wheelSpeedKt(2), this.wheelR);
  }
}

function brakes(extra: Partial<BrakeConfig> = {}) {
  const vars = new SimVars();
  vars.set('gear.air_ground', 1);
  vars.set('hyd.b_psi', 3000);
  vars.set('hyd.a_psi', 3000);
  const cfg: BrakeConfig = {
    sources: [
      { id: 'normal', pressurePsi: 'hyd.b_psi' },
      { id: 'alternate', pressurePsi: 'hyd.a_psi' },
    ],
    maxPsi: 3000,
    accumulator: { chargeFrom: 'hyd.b_psi', prechargePsi: 1000, maxPsi: 3000 },
    parking: { var: 'ac.parking_brake', kind: 'hydraulic' },
    antiskid: { enabled: 'ac.antiskid_sw ?? 1' },
    autobrake: { levels: AUTOBRAKE_737NG, thrustIdle: 'ac.tla1 < 0.05', speedbrakeDown: 'ac.speedbrake_lever < 0.05' },
    temperature: { heatCapacityJPerK: 60000 },
    ...extra,
  };
  const b = new Brakes({ vars }, cfg);
  return { vars, b };
}

describe('Brakes', () => {
  it('anti-skid releases a skidding side and keeps the wheels turning', () => {
    const { vars, b } = brakes();
    const p = new RollPlant(vars, 120, 0.5);
    vars.set(INPUT.brakeLeft, 1);
    vars.set(INPUT.brakeRight, 1);
    let released = false;
    let minWheelRatio = 1;
    for (let i = 0; i < 60 * 10; i++) {
      b.update(DT);
      p.step(DT);
      if (vars.get('brakes.antiskid_left') === 1) released = true;
      if (p.v > 20) minWheelRatio = Math.min(minWheelRatio, p.wheelL / p.v);
    }
    expect(released).toBe(true);
    expect(minWheelRatio).toBeGreaterThan(0.3);
    // Friction-limited stop: at least ~70 % of the maximum (mu 0.5 -> 8.5 ft/s²) deceleration.
    expect(p.v).toBeLessThan(85);
  });

  it('without anti-skid the wheels lock', () => {
    const { vars, b } = brakes();
    vars.set('ac.antiskid_sw', 0);
    const p = new RollPlant(vars, 120, 0.5);
    vars.set(INPUT.brakeLeft, 1);
    vars.set(INPUT.brakeRight, 1);
    for (let i = 0; i < 60 * 3; i++) {
      b.update(DT);
      p.step(DT);
    }
    expect(p.wheelL).toBe(0);
    expect(vars.get('brakes.antiskid_inop')).toBe(1);
  });

  it('autobrake 2 / 3 / MAX hold their target decelerations (5 / 7.2 / 14 ft/s²)', () => {
    for (const [sel, target] of [
      [2, 5],
      [3, 7.2],
      [4, 14],
    ] as const) {
      const { vars, b } = brakes();
      vars.set('gear.air_ground', 0);
      vars.set('ac.autobrake_sel', sel);
      vars.set('ac.tla1', 0);
      b.update(DT);
      expect(vars.get('brakes.autobrake_armed')).toBe(1);
      const p = new RollPlant(vars, 140, 1.0);
      vars.set('gear.air_ground', 1);
      const decels: number[] = [];
      for (let i = 0; i < 60 * 12; i++) {
        b.update(DT);
        const v0 = p.v;
        p.step(DT, 20);
        if (i > 60 * 4 && p.v > 85) decels.push(((v0 - p.v) / DT) * KTS_TO_FPS2);
      }
      expect(vars.get('brakes.autobrake_active')).toBe(1);
      const mean = decels.reduce((a, x) => a + x, 0) / decels.length;
      expect(Math.abs(mean - target)).toBeLessThan(0.6);
    }
  });

  it('pedal braking and thrust advance disarm the autobrake (AUTO BRAKE DISARM light)', () => {
    const { vars, b } = brakes();
    vars.set('gear.air_ground', 0);
    vars.set('ac.autobrake_sel', 2);
    vars.set('ac.tla1', 0);
    b.update(DT);
    vars.set('gear.air_ground', 1);
    const p = new RollPlant(vars, 130, 1);
    for (let i = 0; i < 120; i++) {
      b.update(DT);
      p.step(DT);
    }
    expect(vars.get('brakes.autobrake_active')).toBe(1);
    vars.set(INPUT.brakeLeft, 0.5);
    b.update(DT);
    expect(vars.get('brakes.autobrake_active')).toBe(0);
    expect(vars.get('brakes.ab_disarm')).toBe(1);
  });

  it('RTO: armed on the ground, maximum pressure when thrust is retarded above 90 kt', () => {
    const { vars, b } = brakes();
    vars.set('ac.autobrake_sel', -1);
    vars.set('ac.tla1', 0.9);
    const p = new RollPlant(vars, 60, 1);
    b.update(DT);
    expect(vars.get('brakes.autobrake_armed')).toBe(1);
    p.v = 60;
    p.step(DT);
    vars.set('ac.tla1', 0);
    b.update(DT);
    expect(vars.get(GEAR.brakeLeft)).toBe(0); // below 90 kt: no RTO braking
    vars.set('ac.tla1', 0.9);
    p.v = 100;
    p.wheelL = p.wheelR = 100;
    p.step(DT);
    b.update(DT);
    vars.set('ac.tla1', 0);
    b.update(DT);
    expect(vars.get('brakes.autobrake_active')).toBe(1);
    expect(vars.get(GEAR.brakeLeft)).toBeCloseTo(1, 5);
  });

  it('parking brake holds from the accumulator with both hydraulic systems off', () => {
    const { vars, b } = brakes();
    b.update(DT);
    vars.set('hyd.b_psi', 0);
    vars.set('hyd.a_psi', 0);
    vars.set('ac.parking_brake', 1);
    b.update(DT);
    expect(vars.get('brakes.source')).toBe(-1);
    expect(vars.get(GEAR.brakeLeft)).toBeGreaterThan(0.9);
    expect(vars.get('brakes.parking_set')).toBe(1);
  });
});
