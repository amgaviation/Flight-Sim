import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, AP, GEAR, INPUT, SURF } from '../../../src/core/vars';
import { MechanicalFlightControls } from '../../../src/systems/flightcontrols/MechanicalFlightControls';
import { TrimAxis } from '../../../src/systems/flightcontrols/TrimAxis';
import { Flaps } from '../../../src/systems/flightcontrols/Flaps';
import { Spoilers } from '../../../src/systems/flightcontrols/Spoilers';
import { NosewheelSteering } from '../../../src/systems/flightcontrols/NosewheelSteering';
import { YawDamper } from '../../../src/systems/flightcontrols/YawDamper';
import { FlyByWire } from '../../../src/systems/flightcontrols/FlyByWire';
import { SENSOR_VARS } from '../../../src/systems/sensors/vars';
import { TestPlant } from './plant';

const DT = 1 / 60;
const loop = (n: number, f: () => void): void => {
  for (let i = 0; i < n; i++) f();
};

describe('MechanicalFlightControls', () => {
  it('sums pilot input and AP servo; manual reversion drops the servo and reduces authority', () => {
    const vars = new SimVars();
    vars.set('hyd.a_psi', 3000);
    vars.set('hyd.b_psi', 3000);
    const fc = new MechanicalFlightControls({ vars }, {
      pitch: { actuators: ['hyd.a_psi / 3000', 'hyd.b_psi / 3000'], manualReversion: { authority: 0.4 } },
      yaw: { actuators: ['hyd.b_psi / 3000'], manualReversion: null },
    });
    vars.set(INPUT.pitch, 0.3);
    vars.set('ap.servo_pitch', 0.2);
    const pilot = (0.3 - 0.01) / 0.99; // default 0.01 deadband, rescaled
    loop(60, () => fc.update(DT));
    expect(vars.get(SURF.elevator)).toBeCloseTo(pilot + 0.2, 5);
    vars.set('hyd.a_psi', 0);
    loop(60, () => fc.update(DT));
    expect(vars.get(SURF.elevator)).toBeCloseTo(pilot + 0.2, 5); // one system is enough
    vars.set('hyd.b_psi', 0);
    loop(60, () => fc.update(DT));
    expect(vars.get('fcs.pitch_manual')).toBe(1);
    expect(vars.get(SURF.elevator)).toBeCloseTo(pilot * 0.4, 5);
    // Rudder without power is frozen
    vars.set(INPUT.yaw, 1);
    loop(60, () => fc.update(DT));
    expect(vars.get(SURF.rudder)).toBe(0);
  });

  it('Boeing force sensing: the pilot input is not added while the AFCS consumes it', () => {
    const vars = new SimVars();
    const fc = new MechanicalFlightControls({ vars });
    vars.set(INPUT.roll, 0.5);
    vars.set('ap.force_roll', 1);
    vars.set('ap.servo_roll', 0.1);
    loop(60, () => fc.update(DT));
    expect(vars.get(SURF.aileron)).toBeCloseTo(0.1, 5);
  });

  it('rudder limiter vs IAS and rate limit', () => {
    const vars = new SimVars();
    const fc = new MechanicalFlightControls({ vars }, { yaw: { authority: { x: [150, 300], y: [1, 0.3] }, rateLimit: 1 } });
    vars.set(ADC.ias(1), 300);
    vars.set(INPUT.yaw, 1);
    fc.update(0.1);
    expect(vars.get(SURF.rudder)).toBeCloseTo(0.1, 5);
    loop(60, () => fc.update(DT));
    expect(vars.get(SURF.rudder)).toBeCloseTo(0.3, 5);
  });
});

describe('TrimAxis (737NG stabilizer)', () => {
  function stab() {
    const vars = new SimVars();
    const events = new EventBus();
    vars.set('elec.dc_bus_powered', 1);
    vars.set('ac.stab_main_elec', 1);
    vars.set('ac.stab_ap', 1);
    const t = new TrimAxis({ vars, events }, {
      axis: 'pitch',
      range: [0, 17],
      initial: 5,
      electric: {
        power: 'elec.dc_bus_powered',
        enable: 'ac.stab_main_elec',
        rate: 0.4 / 3,
        rateFlapsExtended: 0.4,
        limits: [3.95, 14.5],
        limitsFlapsExtended: [0.05, 14.5],
        columnCutout: { threshold: 0.3 },
      },
      autopilot: { enable: 'ac.stab_ap', rate: 0.2, limits: [0.05, 14.5] },
      takeoffBand: [3, 8.5],
    });
    return { vars, events, t };
  }

  it('electric trim rate depends on flaps; stops at the flaps-up limit', () => {
    const { vars, t } = stab();
    vars.set(INPUT.pitchTrimRate, -1);
    loop(60 * 3, () => t.update(DT));
    expect(t.position).toBeCloseTo(4.6, 2); // 3 s at 0.133 u/s from 5
    loop(60 * 10, () => t.update(DT));
    expect(t.position).toBeCloseTo(3.95, 5);
    vars.set(SURF.flapsDeg, 5);
    loop(60, () => t.update(DT));
    expect(t.position).toBeCloseTo(3.55, 2);
    expect(vars.get('trim.pitch_motion')).toBe(-1);
    expect(vars.get('trim.pitch_in_motion')).toBe(1);
    expect(vars.get(SURF.pitchTrim)).toBeCloseTo(-1 + (2 * 3.55) / 17, 2);
  });

  it('column cutout, main elec cutout switch, AP trim, runaway and manual wheel', () => {
    const { vars, events, t } = stab();
    vars.set(INPUT.pitchTrimRate, 1);
    vars.set(INPUT.pitch, -0.5); // column forward, trimming nose up -> cut out
    loop(60, () => t.update(DT));
    expect(t.position).toBe(5);
    vars.set(INPUT.pitch, 0);
    vars.set('ac.stab_main_elec', 0);
    loop(60, () => t.update(DT));
    expect(t.position).toBe(5);
    vars.set(INPUT.pitchTrimRate, 0);
    vars.set('ap.trim_cmd', 1);
    loop(60, () => t.update(DT));
    expect(t.position).toBeCloseTo(5.2, 5);
    vars.set('ap.trim_cmd', 0);
    vars.set('ac.stab_main_elec', 1);
    vars.set('fail.trim.pitch.runaway', 1);
    loop(60, () => t.update(DT));
    expect(t.position).toBeLessThan(5.2);
    vars.set('ac.stab_main_elec', 0); // cutout stops the runaway
    const p = t.position;
    loop(60, () => t.update(DT));
    expect(t.position).toBe(p);
    events.emit('trim.pitch_manual', { delta: 1 });
    t.update(DT);
    expect(t.position).toBeCloseTo(p + 1, 5);
    vars.set('trim.pitch_units', 7); // the cockpit trim wheel wrote the var
    t.update(DT);
    expect(t.position).toBe(7);
    expect(vars.get('trim.pitch_to_ok')).toBe(1);
  });
});

describe('Flaps', () => {
  function flaps() {
    const vars = new SimVars();
    vars.set('hyd.b_psi', 3000);
    const f = new Flaps({ vars }, {
      detents: [
        { lever: 0, flapDeg: 0, label: 'UP' },
        { lever: 1, flapDeg: 1, label: '1', vfe: 250 },
        { lever: 2, flapDeg: 5, label: '5', vfe: 250 },
        { lever: 3, flapDeg: 15, label: '15', vfe: 200 },
        { lever: 4, flapDeg: 30, label: '30', vfe: 175 },
        { lever: 5, flapDeg: 40, label: '40', vfe: 162 },
      ],
      normal: { power: 'hyd.b_psi / 3000', rateDegPerS: 2 },
      alternate: { active: 'ac.alt_flaps_arm', switchVar: 'ac.alt_flaps_sw', rateDegPerS: 0.25 },
      loadRelief: [
        { fromDeg: 40, toDeg: 30, retractKt: 163, reextendKt: 158 },
        { fromDeg: 30, toDeg: 25, retractKt: 176, reextendKt: 171 },
      ],
      slats: { schedule: { x: [0, 1, 10], y: [0, 0.5, 1] }, travelS: 4 },
    });
    return { vars, f };
  }

  it('moves to the detent at the hydraulic rate; slats follow the schedule', () => {
    const { vars, f } = flaps();
    vars.set('ac.flap_lever', 3);
    loop(60 * 4, () => f.update(DT));
    expect(vars.get(SURF.flapsDeg)).toBeCloseTo(8, 5);
    expect(vars.get('flaps.transit')).toBe(1);
    loop(60 * 4, () => f.update(DT));
    expect(vars.get(SURF.flapsDeg)).toBe(15);
    expect(vars.get(SURF.slats)).toBe(1);
  });

  it('flap load relief 40 -> 30 above 163 kt, re-extends below 158 kt', () => {
    const { vars, f } = flaps();
    f.setPosition(40);
    vars.set('ac.flap_lever', 5);
    vars.set(ADC.ias(1), 165);
    loop(60 * 8, () => f.update(DT));
    expect(vars.get(SURF.flapsDeg)).toBe(30);
    expect(vars.get('flaps.load_relief')).toBe(1);
    vars.set(ADC.ias(1), 160);
    loop(60, () => f.update(DT));
    expect(vars.get('flaps.cmd_deg')).toBe(30); // hysteresis
    vars.set(ADC.ias(1), 155);
    loop(60 * 6, () => f.update(DT));
    expect(vars.get(SURF.flapsDeg)).toBe(40);
  });

  it('asymmetry protection stops the drive; alternate flaps still move them', () => {
    const { vars, f } = flaps();
    vars.set('fail.flaps.left.jam', 1);
    vars.set('ac.flap_lever', 3);
    loop(60 * 8, () => f.update(DT));
    expect(vars.get('flaps.asym')).toBe(1);
    expect(vars.get('flaps.right_deg')).toBeLessThan(6);
    vars.set('fail.flaps.left.jam', 0);
    vars.set('ac.alt_flaps_arm', 1);
    vars.set('ac.alt_flaps_sw', 1);
    const r0 = vars.get('flaps.right_deg');
    loop(60 * 4, () => f.update(DT));
    expect(vars.get('flaps.right_deg')).toBeCloseTo(r0 + 1, 5);
  });
});

describe('Spoilers', () => {
  function sp() {
    const vars = new SimVars();
    vars.set('ra1.alt_ft', 500);
    const s = new Spoilers({ vars }, {
      armedValue: 0.08,
      flightDetent: 0.7,
      roll: { deadband: 0.1, gain: 1.2 },
      auto: { thrustIdle: 'ac.tla1 < 0.05 && ac.tla2 < 0.05', rto: { speedKt: 60 } },
      extLight: { flapsAboveDeg: 10, raBelowFt: 800 },
    });
    return { vars, s };
  }

  it('armed: deploy at touchdown wheel spin-up with thrust idle, lever to UP; retract on thrust advance', () => {
    const { vars, s } = sp();
    vars.set('ac.speedbrake_lever', 0.08);
    vars.set('ac.tla1', 0);
    vars.set('ac.tla2', 0);
    loop(10, () => s.update(DT));
    expect(vars.get('spoilers.armed_light')).toBe(1);
    expect(vars.get(SURF.groundSpoilers)).toBe(0);
    vars.set('ra1.alt_ft', 2);
    vars.set(GEAR.wheelSpeedKt(1), 120);
    vars.set('gear.air_ground', 1);
    loop(120, () => s.update(DT));
    expect(vars.get('spoilers.deployed')).toBe(1);
    expect(vars.get('ac.speedbrake_lever')).toBe(1);
    expect(vars.get(SURF.groundSpoilers)).toBe(1);
    expect(vars.get(SURF.spoilerLeft)).toBe(1);
    vars.set('ac.tla1', 0.3);
    loop(120, () => s.update(DT));
    expect(vars.get('spoilers.deployed')).toBe(0);
    expect(vars.get('ac.speedbrake_lever')).toBe(0);
    expect(vars.get(SURF.groundSpoilers)).toBe(0);
  });

  it('RTO deploys without arming; roll spoilers rise on the down-going wing; flight detent limit in the air', () => {
    const { vars, s } = sp();
    vars.set('gear.air_ground', 1);
    vars.set('ac.tla1', 0);
    vars.set('ac.tla2', 0);
    vars.set(GEAR.wheelSpeedKt(1), 100);
    loop(120, () => s.update(DT));
    expect(vars.get(SURF.groundSpoilers)).toBe(1);
    const a = sp();
    a.vars.set(SURF.aileron, 0.6);
    loop(120, () => a.s.update(DT));
    expect(a.vars.get(SURF.spoilerRight)).toBeCloseTo(0.6, 5);
    expect(a.vars.get(SURF.spoilerLeft)).toBe(0);
    a.vars.set(SURF.aileron, 0);
    a.vars.set('ac.speedbrake_lever', 0.7);
    a.vars.set(SURF.flapsDeg, 15);
    loop(120, () => a.s.update(DT));
    expect(a.vars.get(SURF.spoilerLeft)).toBe(1);
    expect(a.vars.get('spoilers.ext_light')).toBe(1);
    expect(a.vars.get(SURF.groundSpoilers)).toBe(0);
  });
});

describe('Nosewheel steering and yaw damper', () => {
  it('tiller authority, pedal fade with speed, centering when unpowered or airborne', () => {
    const vars = new SimVars();
    vars.set(GEAR.weightOnWheels(0), 1);
    vars.set('hyd.a_psi', 3000);
    const s = new NosewheelSteering({ vars }, {
      tiller: { maxDeg: 78 },
      pedals: { maxDeg: 7, fade: { x: [20, 60], y: [1, 0.5] } },
      power: 'hyd.a_psi > 1000',
    });
    vars.set(INPUT.tiller, 0.5);
    loop(120, () => s.update(DT));
    expect(vars.get(GEAR.steerDeg)).toBeCloseTo(39, 5);
    vars.set(INPUT.tiller, 0);
    vars.set(INPUT.yaw, 1);
    vars.set('gps.gs_kt', 60);
    loop(120, () => s.update(DT));
    expect(vars.get(GEAR.steerDeg)).toBeCloseTo(3.5, 5);
    vars.set('hyd.a_psi', 0);
    loop(120, () => s.update(DT));
    expect(vars.get(GEAR.steerDeg)).toBe(0);
    expect(vars.get('steer.powered')).toBe(0);
  });

  it('yaw damper opposes yaw rate and disengages without power', () => {
    const vars = new SimVars();
    vars.set(SENSOR_VARS.attValid(1), 1);
    vars.set(AP.yd, 1);
    vars.set('elec.powered', 1);
    const yd = new YawDamper({ vars }, { gain: 0.05, power: 'elec.powered' });
    yd.update(DT);
    vars.set(SENSOR_VARS.r(1), 4);
    yd.update(DT);
    expect(vars.get('fcs.yd_cmd')).toBeLessThan(-0.1);
    vars.set('elec.powered', 0);
    yd.update(DT);
    expect(vars.get(AP.yd)).toBe(0);
    expect(vars.get('yd.off_light')).toBe(1);
    expect(vars.get('fcs.yd_cmd')).toBe(0);
  });
});

describe('FlyByWire (G650 style)', () => {
  function fbw(tasKt = 250) {
    const vars = new SimVars();
    const plant = new TestPlant(vars, { tasKt, controls: 'surface' });
    vars.set('fcc.powered', 1);
    const f = new FlyByWire({ vars }, {
      power: 'fcc.powered',
      pitch: { alphaMax: { x: [0, 39], y: [12, 16] }, vmoKt: 340, mmo: 0.925 },
      roll: { maxRateDps: 15, bankHoldDeg: 33, maxBankDeg: 67 },
    });
    f.reset();
    const run = (s: number, each?: () => void): void =>
      plant.run(s, () => {
        each?.();
        f.update(DT);
      });
    return { vars, plant, f, run };
  }

  it('roll-rate command; released yoke holds bank below 33° and returns to 33° above', () => {
    const { vars, plant, run } = fbw();
    vars.set(INPUT.roll, 1);
    run(1.2);
    expect(plant.p).toBeGreaterThan(10);
    vars.set(INPUT.roll, 0);
    run(8);
    const held = plant.phi;
    expect(held).toBeGreaterThan(10);
    expect(held).toBeLessThan(33);
    run(8);
    expect(Math.abs(plant.phi - held)).toBeLessThan(1.5);
    vars.set(INPUT.roll, 1);
    run(3);
    expect(plant.phi).toBeGreaterThan(40);
    vars.set(INPUT.roll, 0);
    let prot = 0;
    run(15, () => (prot = Math.max(prot, vars.get('fbw.bank_protect'))));
    expect(Math.abs(plant.phi - 33)).toBeLessThan(2);
    expect(prot).toBe(1);
  });

  it('pitch: neutral yoke holds the flight path; auto-trim takes the elevator back toward neutral', () => {
    const { vars, plant, run } = fbw();
    vars.set(INPUT.pitch, 0.3);
    run(3);
    vars.set(INPUT.pitch, 0);
    run(5);
    const g = plant.gamma;
    run(20);
    expect(Math.abs(plant.gamma - g)).toBeLessThan(0.5);
    expect(Math.abs(vars.get('fbw.nz_cmd') - 1)).toBeLessThan(0.1);
    expect(vars.getString('fbw.mode')).toBe('NORMAL');
  });

  it('AoA protection limits the angle of attack with full aft yoke', () => {
    const { vars, plant, run } = fbw(150);
    // Low speed: give the plant the elevator authority a real stabilizer +
    // elevator has at 150 kt (the default plant gain is tuned for cruise).
    plant.kElev = 60;
    vars.set(INPUT.pitch, 1);
    let maxAlpha = 0;
    let lim = 0;
    run(20, () => {
      maxAlpha = Math.max(maxAlpha, plant.theta - plant.gamma);
      lim = Math.max(lim, vars.get('fbw.aoa_limit'));
    });
    expect(lim).toBe(1);
    expect(maxAlpha).toBeLessThan(12.5);
    expect(maxAlpha).toBeGreaterThan(10);
  });

  it('FCC failure reverts to DIRECT: yoke to elevator', () => {
    const { vars, run } = fbw();
    vars.set('fail.fbw.fcc', 1);
    vars.set(INPUT.pitch, 0.4);
    run(1);
    expect(vars.getString('fbw.mode')).toBe('DIRECT');
    expect(vars.get(SURF.elevator)).toBeCloseTo(0.4, 5);
  });
});
