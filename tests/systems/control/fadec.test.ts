import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { AP, ENG } from '../../../src/core/vars';
import { table2 } from '../../../src/core/math';
import { ThrustRatingComputer, ratingVar } from '../../../src/systems/fadec/ThrustRatingComputer';
import { ThrustLeverFadec } from '../../../src/systems/fadec/ThrustLeverFadec';
import { EngineStartController, StartState } from '../../../src/systems/fadec/EngineStartController';
import { Autothrottle, AtMode } from '../../../src/systems/fadec/Autothrottle';
import { AFCS_VARS, AtRequest } from '../../../src/systems/autopilot/vars';
import { TestPlant } from './plant';

const DT = 1 / 60;

/** Illustrative N1 tables (x: pressure altitude ft, y: OAT °C). */
const TO = table2([0, 5000, 10000], [-20, 15, 30, 50], [
  [92, 95, 97.5, 94],
  [94, 97, 99, 96],
  [95, 98, 100, 97],
]);
const CLB = table2([0, 20000, 40000], [-60, 0, 40], [
  [88, 90, 92],
  [90, 92, 94],
  [91, 93, 95],
]);
const CRZ = table2([0, 40000], [-60, 40], [
  [80, 84],
  [84, 88],
]);

function ratings(vars: SimVars, events?: EventBus): ThrustRatingComputer {
  return new ThrustRatingComputer({ vars, events }, { ratings: { TO, CLB, CRZ }, altVar: 'adc1.press_alt_ft', tempVar: 'adc1.sat_c' });
}

describe('ThrustRatingComputer', () => {
  it('interpolates N1 limits in pressure altitude and temperature', () => {
    const vars = new SimVars();
    const rc = ratings(vars);
    vars.set('adc1.press_alt_ft', 2500);
    vars.set('adc1.sat_c', 15);
    rc.update(DT);
    expect(vars.get(ratingVar('TO'))).toBeCloseTo(96, 5);
    expect(vars.get('fadec.n1_limit_pct')).toBeCloseTo(96, 5);
    expect(vars.getString('fadec.rating')).toBe('TO');
    rc.select('CLB');
    rc.update(DT);
    expect(vars.get('fadec.n1_limit_pct')).toBeCloseTo(vars.get(ratingVar('CLB')), 9);
  });

  it('applies an assumed temperature to takeoff ratings, limited to maxFlexN1Drop', () => {
    const vars = new SimVars();
    const events = new EventBus();
    const rc = ratings(vars, events);
    vars.set('adc1.press_alt_ft', 0);
    vars.set('adc1.sat_c', 15);
    events.emit('fadec.assumed_temp', 50);
    rc.update(DT);
    expect(vars.get(ratingVar('TO'))).toBeCloseTo(94, 5); // table at 50 °C, above 95−6
    expect(vars.get('fadec.flex_active')).toBe(1);
    events.emit('fadec.assumed_temp', 80);
    rc.update(DT);
    expect(vars.get(ratingVar('TO'))).toBeCloseTo(94, 5);
    expect(rc.n1For('TO', 0, 15, 50)).toBeCloseTo(94, 5);
  });
});

describe('ThrustLeverFadec', () => {
  function build(law: 'detent' | 'linear') {
    const vars = new SimVars();
    const rc = ratings(vars);
    vars.set('adc1.press_alt_ft', 0);
    vars.set('adc1.sat_c', 15);
    vars.set('gear.air_ground', 1);
    const f = new ThrustLeverFadec(
      { vars },
      {
        engines: [1, 2],
        law:
          law === 'detent'
            ? { kind: 'detent', detents: [{ lever: 0.6, rating: 'CRZ', label: 'CRU' }, { lever: 0.8, rating: 'CLB', label: 'CLB' }, { lever: 1, rating: 'TO', label: 'TO' }] }
            : { kind: 'linear', maxRating: 'TO' },
        idle: { ground: 22, flight: 30, approach: 35, approachWhen: 'surf.flaps_deg >= 15' },
        reverse: { maxN1: 80, deployS: 2, stowS: 2 },
      },
      rc,
    );
    const step = (s: number): void => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        rc.update(DT);
        f.update(DT);
      }
    };
    return { vars, f, step };
  }

  it('detents select the rating and label; between detents N1 is interpolated', () => {
    const { vars, step } = build('detent');
    vars.set('ac.tla1', 1);
    vars.set('ac.tla2', 0.8);
    step(0.1);
    expect(vars.get(ENG.n1Cmd(1))).toBeCloseTo(95, 5);
    expect(vars.getString('fadec.eng1.detent')).toBe('TO');
    expect(vars.getString('fadec.eng2.detent')).toBe('CLB');
    vars.set('ac.tla1', 0.3);
    step(0.1);
    // halfway from ground idle (22) to CRU
    const cru = vars.get(ratingVar('CRZ'));
    expect(vars.get(ENG.n1Cmd(1))).toBeCloseTo(22 + (cru - 22) * 0.5, 5);
  });

  it('idle schedules: ground, flight and approach idle', () => {
    const { vars, step } = build('linear');
    vars.set('ac.tla1', 0);
    step(0.1);
    expect(vars.get(ENG.n1Cmd(1))).toBe(22);
    vars.set('gear.air_ground', 0);
    step(0.1);
    expect(vars.get(ENG.n1Cmd(1))).toBe(30);
    vars.set('surf.flaps_deg', 30);
    step(0.1);
    expect(vars.get(ENG.n1Cmd(1))).toBe(35);
    expect(vars.get('fadec.eng1.idle_mode')).toBe(2);
  });

  it('reverser: interlocked in the air; on the ground N1 stays at idle until 90 % deployed', () => {
    const { vars, step } = build('detent');
    vars.set('gear.air_ground', 0);
    vars.set('ac.tla1', -1);
    step(3);
    expect(vars.get(ENG.reverserPos(1))).toBe(0);
    vars.set('gear.air_ground', 1);
    step(0.5);
    expect(vars.get('fadec.eng1.rev_unlocked')).toBe(1);
    expect(vars.get(ENG.n1Cmd(1))).toBe(22);
    step(2);
    expect(vars.get('fadec.eng1.rev_deployed')).toBe(1);
    expect(vars.get(ENG.n1Cmd(1))).toBeCloseTo(80, 5);
  });
});

/** Tiny turbofan start model: starter spins N2 to 25 %, light-off with fuel+ignition above 10 %, accelerate to 60 % idle. */
class MiniEngine {
  n2 = 0;
  itt = 20;
  lit = false;
  constructor(private readonly vars: SimVars, public mode: 'normal' | 'hot' | 'hung' | 'nolight' = 'normal') {}
  step(dt: number): void {
    const v = this.vars;
    const starter = v.get('fadec.eng1.starter_cmd') !== 0;
    const ign = v.get(ENG.ignition(1)) !== 0;
    const fuel = v.get('fadec.eng1.fuel_cmd') !== 0;
    if (!this.lit && fuel && ign && this.n2 >= 10 && this.mode !== 'nolight') this.lit = true;
    if (this.lit && !fuel) this.lit = false;
    if (this.lit) {
      const top = this.mode === 'hung' ? 35 : 60;
      if (this.n2 < top) this.n2 = Math.min(top, this.n2 + 1.5 * dt);
      const ittTarget = this.mode === 'hot' ? 1100 : this.n2 < 55 ? 650 : 480;
      this.itt += (ittTarget - this.itt) * (1 - Math.exp(-dt / (this.mode === 'hot' ? 4 : 3)));
    } else {
      const target = starter ? 25 : 0;
      this.n2 += (target - this.n2) * (1 - Math.exp(-dt / 4));
      this.itt += (20 - this.itt) * (1 - Math.exp(-dt / 10));
    }
    v.set(ENG.n2(1), this.n2);
    v.set(ENG.itt(1), this.itt);
    v.set(ENG.running(1), this.lit && this.n2 >= 58.8 ? 1 : 0);
  }
}

describe('EngineStartController', () => {
  function build(mode: MiniEngine['mode'], manual = false) {
    const vars = new SimVars();
    vars.set('gear.air_ground', 1);
    const eng = new MiniEngine(vars, mode);
    eng.step(0);
    const sc = new EngineStartController(
      { vars },
      {
        engine: 1,
        startSwitch: 'ac.start1',
        startKind: manual ? 'held' : 'momentary',
        releaseSwitch: manual ? { var: 'ac.start1', offValue: 0 } : undefined,
        runLever: 'ac.run1',
        manual: manual,
        fuelOnN2Pct: 20,
        starterCutoutN2Pct: 45,
        idleN2Pct: 60,
        hotStartIttC: 850,
      },
    );
    const run = (s: number, each?: () => void): void => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        each?.();
        sc.update(DT);
        eng.step(DT);
      }
    };
    return { vars, sc, eng, run };
  }

  it('auto start: motoring, fuel at 20 % N2 with the lever at RUN, starter cut-out at 45 %, running', () => {
    const { vars, sc, run } = build('normal');
    vars.set('ac.run1', 1);
    vars.set('ac.start1', 1);
    run(0.1);
    vars.set('ac.start1', 0);
    expect(sc.state).toBe(StartState.Motoring);
    expect(vars.get('fadec.eng1.fuel_cmd')).toBe(0);
    let fuelAtN2 = NaN;
    let cutAtN2 = NaN;
    run(60, () => {
      if (Number.isNaN(fuelAtN2) && vars.get('fadec.eng1.fuel_cmd') === 1) fuelAtN2 = vars.get(ENG.n2(1));
      if (!Number.isNaN(fuelAtN2) && Number.isNaN(cutAtN2) && vars.get('fadec.eng1.starter_cmd') === 0) cutAtN2 = vars.get(ENG.n2(1));
    });
    expect(fuelAtN2).toBeGreaterThanOrEqual(20);
    expect(fuelAtN2).toBeLessThan(21);
    expect(cutAtN2).toBeGreaterThanOrEqual(45);
    expect(sc.state).toBe(StartState.Running);
    expect(vars.get(ENG.ignition(1))).toBe(0);
    expect(vars.getString('fadec.eng1.start_status')).toBe('RUN');
  });

  it('hot start: ITT exceedance (predicted) aborts, cuts fuel and dry-motors to cool', () => {
    const { vars, sc, run } = build('hot');
    vars.set('ac.run1', 1);
    vars.set('ac.start1', 1);
    run(0.1);
    vars.set('ac.start1', 0);
    let maxItt = 0;
    run(40, () => (maxItt = Math.max(maxItt, vars.get(ENG.itt(1)))));
    expect(sc.state).toBe(StartState.Abort);
    expect(vars.getString('fadec.eng1.abort_reason')).toBe('HOT');
    expect(vars.get('fadec.eng1.fuel_cmd')).toBe(0);
    expect(maxItt).toBeLessThan(900);
    expect(vars.get('fadec.eng1.abort')).toBe(1);
  });

  it('hung start and no light-off abort', () => {
    const h = build('hung');
    h.vars.set('ac.run1', 1);
    h.vars.set('ac.start1', 1);
    h.run(0.1);
    h.vars.set('ac.start1', 0);
    h.run(80);
    expect(h.vars.getString('fadec.eng1.abort_reason')).toBe('HUNG');
    const n = build('nolight');
    n.vars.set('ac.run1', 1);
    n.vars.set('ac.start1', 1);
    n.run(0.1);
    n.vars.set('ac.start1', 0);
    n.run(40);
    expect(n.vars.getString('fadec.eng1.abort_reason')).toBe('NO LIGHT');
  });

  it('manual (737 style): GRD switch held, crew opens fuel, switch released at cut-out', () => {
    const { vars, sc, run } = build('normal', true);
    vars.set('ac.run1', 0);
    vars.set('ac.start1', 1);
    run(8);
    expect(vars.get('fadec.eng1.starter_cmd')).toBe(1);
    expect(vars.get('fadec.eng1.fuel_cmd')).toBe(0);
    vars.set('ac.run1', 1); // start lever to IDLE at max motoring
    run(60);
    expect(vars.get('ac.start1')).toBe(0);
    expect(vars.get('fadec.eng1.starter_cmd')).toBe(0);
    expect(sc.state).toBe(StartState.Running);
  });
});

describe('Autothrottle', () => {
  it('SPD mode holds the selected speed by moving the levers', () => {
    const vars = new SimVars();
    const plant = new TestPlant(vars, { tasKt: 200, thrust: 'lever' });
    vars.set('ac.tla1', 0.44);
    vars.set('ac.tla2', 0.44);
    vars.set(AP.selSpeed, 230);
    vars.set(AFCS_VARS.atRequest, AtRequest.Speed);
    const at = new Autothrottle({ vars }, { engines: [1, 2], style: 'bizjet' });
    at.pressEngage();
    expect(at.mode).toBe(AtMode.Speed);
    plant.run(120, () => at.update(DT));
    expect(Math.abs(plant.tas - 230)).toBeLessThan(2.5);
    expect(vars.get(AP.athr)).toBe(1);
    expect(vars.getString(AP.athrMode)).toBe('SPD');
  });

  it('Boeing: TO/GA -> N1, THR HLD at 84 kt, ARM at 800 ft; RETARD at flare; disengage 2 s after touchdown', () => {
    const vars = new SimVars();
    vars.set('gear.air_ground', 1);
    vars.set('ac.at_arm', 1);
    vars.set('fadec.n1_limit_pct', 95);
    vars.set('fadec.n1_to_pct', 95);
    const at = new Autothrottle({ vars }, { engines: [1, 2], style: 'boeing' });
    at.update(DT);
    expect(at.mode).toBe(AtMode.Arm);
    vars.set(AFCS_VARS.atRequest, AtRequest.Takeoff);
    at.update(DT);
    expect(at.mode).toBe(AtMode.Takeoff);
    expect(vars.getString(AP.athrMode)).toBe('N1');
    vars.set(ENG.n1(1), 50);
    vars.set(ENG.n1(2), 50);
    for (let i = 0; i < 60; i++) at.update(DT);
    expect(vars.get('ac.tla1')).toBeGreaterThan(0.1); // levers advancing
    vars.set('adc1.ias_kt', 90);
    at.update(DT);
    expect(at.mode).toBe(AtMode.Hold);
    expect(vars.getString(AP.athrMode)).toBe('THR HLD');
    vars.set('gear.air_ground', 0);
    vars.set('ra1.alt_ft', 900);
    at.update(DT);
    expect(at.mode).toBe(AtMode.Arm);
    // Flare: RETARD, then touchdown + 2 s -> off without warning
    vars.set(AFCS_VARS.atRequest, AtRequest.Speed);
    at.update(DT);
    expect(at.mode).toBe(AtMode.Speed);
    vars.set(AFCS_VARS.flare, 1);
    vars.set('ra1.alt_ft', 40);
    for (let i = 0; i < 160; i++) at.update(DT);
    expect(at.mode).toBe(AtMode.Retard);
    vars.set('gear.air_ground', 1);
    for (let i = 0; i < 150; i++) at.update(DT);
    expect(at.mode).toBe(AtMode.Off);
    expect(vars.get('at.disc_warn')).toBe(0);
  });

  it('disconnect button: warning until reset (Boeing), ARM switch released', () => {
    const vars = new SimVars();
    vars.set('ac.at_arm', 1);
    const at = new Autothrottle({ vars }, { engines: [1], style: 'boeing' });
    at.update(DT);
    at.pressDisconnect();
    at.update(DT);
    expect(at.mode).toBe(AtMode.Off);
    expect(vars.get('ac.at_arm')).toBe(0);
    for (let i = 0; i < 600; i++) at.update(DT);
    expect(vars.get('at.disc_warn')).toBe(1);
    at.pressDisconnect();
    at.update(DT);
    expect(vars.get('at.disc_warn')).toBe(0);
  });
});
