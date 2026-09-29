import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { FireProtection } from '../../../src/systems/fire/FireProtection';
import { OxygenSystem } from '../../../src/systems/oxygen/OxygenSystem';
import { FLASH_PATTERNS, LightingSystem } from '../../../src/systems/lighting/LightingSystem';

const DT = 1 / 60;
function run(s: { update(dt: number): void }, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    each?.();
    s.update(DT);
  }
}

/** 737NG-style: two engine bottles (800 psi) either of which can go to either engine, APU bottle. */
function b737Fire(vars: SimVars, chance = 1): FireProtection {
  return new FireProtection(vars, {
    bottles: [
      { id: 'bottle_l', chargePsi: 800 },
      { id: 'bottle_r', chargePsi: 800 },
      { id: 'bottle_apu', chargePsi: 800 },
    ],
    zones: [
      {
        id: 'eng1',
        loops: 2,
        loopSelect: 'ac.ovht_det1',
        handle: 'ac.fire_handle1',
        discharge: [
          { bottle: 'bottle_l', command: 'ac.fire_handle1_rot == -1' },
          { bottle: 'bottle_r', command: 'ac.fire_handle1_rot == 1' },
        ],
        extinguishChance: chance,
      },
      {
        id: 'apu',
        loops: 1,
        handle: 'ac.apu_fire_handle',
        discharge: [{ bottle: 'bottle_apu', command: 'ac.apu_fire_rot != 0' }],
        autoDischarge: { bottle: 'bottle_apu', condition: 'fire.apu_warn && fdm.on_ground && ac.auto_disch_enabled', delayS: 15 },
        fuelCut: '!apu.fuel_cmd', // the APU's automatic fire shutdown closes its fuel valve
        extinguishChance: chance,
      },
    ],
    test: { fire: 'ac.fire_test', fault: 'ac.fault_test' },
  });
}

describe('FireProtection', () => {
  it('engine fire: warning and bell, handle arms, rotating discharges a bottle that extinguishes the fire', () => {
    const vars = new SimVars();
    const f = b737Fire(vars);
    run(f, 1);
    expect(vars.get('fire.bottle_l_psi')).toBeCloseTo(800, 0);
    vars.set('fail.fire.eng1', 1);
    run(f, 0.5);
    expect(vars.get('fire.eng1_warn')).toBe(1);
    expect(vars.get('fire.bell')).toBe(1);
    // Rotating without pulling the handle does nothing (squibs not armed).
    vars.set('ac.fire_handle1_rot', -1);
    run(f, 1);
    expect(vars.get('fire.bottle_l_psi')).toBeGreaterThan(790);
    vars.set('ac.fire_handle1_rot', 0);
    vars.set('ac.fire_handle1', 1);
    run(f, 0.2);
    expect(vars.get('fire.eng1_armed')).toBe(1);
    vars.set('ac.fire_handle1_rot', -1);
    run(f, 3);
    expect(vars.get('fire.bottle_l_psi')).toBe(0);
    expect(vars.get('fire.bottle_l_discharged')).toBe(1);
    expect(vars.get('fire.bottle_r_discharged')).toBe(0);
    expect(vars.get('fire.eng1_active')).toBe(0);
    expect(vars.get('fire.eng1_warn')).toBe(0);
    // Stays out while the failure var remains set.
    run(f, 5);
    expect(vars.get('fire.eng1_active')).toBe(0);
  });

  it('a fire that survives the first bottle needs the second one', () => {
    const vars = new SimVars();
    const f = b737Fire(vars, 0);
    vars.set('fail.fire.eng1', 1);
    vars.set('ac.fire_handle1', 1);
    run(f, 0.5);
    vars.set('ac.fire_handle1_rot', -1);
    run(f, 3);
    expect(vars.get('fire.eng1_active')).toBe(1);
    vars.set('ac.fire_handle1_rot', 1);
    run(f, 3);
    expect(vars.get('fire.bottle_r_discharged')).toBe(1);
    expect(vars.get('fire.eng1_warn')).toBe(1); // chance 0: still burning
  });

  it('dual-loop logic: a faulted loop is deselected; both faulted -> FAULT and no detection', () => {
    const vars = new SimVars();
    const f = b737Fire(vars);
    vars.set('fail.fire.eng1.loopa', 1);
    vars.set('fail.fire.eng1.overheat', 1);
    run(f, 0.5);
    expect(vars.get('fire.eng1_ovht')).toBe(1);
    expect(vars.get('fire.eng1_fault')).toBe(0);
    vars.set('fail.fire.eng1.loopb', 1);
    run(f, 0.5);
    expect(vars.get('fire.eng1_ovht')).toBe(0);
    expect(vars.get('fire.eng1_fault')).toBe(1);
    // Select loop A only with loop A healthy.
    vars.set('fail.fire.eng1.loopa', 0);
    vars.set('ac.ovht_det1', 1);
    run(f, 0.5);
    expect(vars.get('fire.eng1_ovht')).toBe(1);
  });

  it('APU fire on the ground auto-discharges after the delay; test switches light everything', () => {
    const vars = new SimVars();
    const f = b737Fire(vars);
    vars.set('fdm.on_ground', 1);
    vars.set('ac.auto_disch_enabled', 1);
    vars.set('fail.fire.apu', 1);
    run(f, 10);
    expect(vars.get('fire.bottle_apu_discharged')).toBe(0);
    run(f, 7);
    expect(vars.get('fire.bottle_apu_discharged')).toBe(1);
    expect(vars.get('fire.apu_active')).toBe(0);
    vars.set('fail.fire.apu', 0);
    vars.set('ac.fire_test', 1);
    run(f, 0.2);
    expect(vars.get('fire.eng1_warn')).toBe(1);
    expect(vars.get('fire.apu_warn')).toBe(1);
    expect(vars.get('fire.bell')).toBe(1);
    vars.set('ac.fire_test', 0);
    vars.set('ac.fault_test', 1);
    run(f, 0.2);
    expect(vars.get('fire.eng1_fault')).toBe(1);
    expect(vars.get('fire.bottle_l_squib')).toBe(1);
    expect(vars.get('fire.bottle_apu_squib')).toBe(0); // discharged
  });
});

describe('OxygenSystem', () => {
  it('crew diluter-demand consumption rises with cabin altitude and with 100 % mode', () => {
    const vars = new SimVars();
    // 737-class crew cylinder: 115 cu ft ≈ 3,256 L at 1,850 psi (EST standard crew cylinder).
    const o = new OxygenSystem(vars, {
      bottles: [{ id: 'crew', capacityL: 3256, fullPsi: 1850 }],
      crew: [
        { id: 'capt', bottle: 'crew', inUse: 'ac.capt_mask', mode: 'ac.capt_mode' },
        { id: 'fo', bottle: 'crew', inUse: 'ac.fo_mask', mode: 'ac.fo_mode' },
      ],
      pax: { kind: 'chemical', deploy: 'press.pax_masks', durationS: 720 },
    });
    vars.set('press.cabin_alt_ft', 8000);
    vars.set('ac.capt_mask', 1);
    run(o, 60);
    const lowAlt = vars.get('oxy.capt_flow_lpm');
    expect(lowAlt).toBeGreaterThan(0.3);
    expect(lowAlt).toBeLessThan(2);
    vars.set('ac.capt_mode', 1);
    run(o, 1);
    const pure = vars.get('oxy.capt_flow_lpm');
    expect(pure).toBeGreaterThan(lowAlt * 4);
    vars.set('press.cabin_alt_ft', 35000);
    vars.set('ac.capt_mode', 0);
    vars.set('ac.fo_mask', 1);
    run(o, 1800);
    // Two crew at 35,000 ft cabin (100 % O2 via diluter) for 30 min: ~2 x 3.3 L/min x 30.
    const psi = vars.get('oxy.crew_psi');
    expect(psi).toBeLessThan(1850 - 50);
    expect(psi).toBeGreaterThan(1850 - 400);
    expect(vars.get('oxy.fo_flowing')).toBe(1);
  });

  it('chemical passenger oxygen flows for its generator time once deployed', () => {
    const vars = new SimVars();
    const o = new OxygenSystem(vars, { bottles: [], pax: { kind: 'chemical', deploy: 'press.pax_masks', durationS: 720 } });
    run(o, 5);
    expect(vars.get('oxy.pax_on')).toBe(0);
    vars.set('press.pax_masks', 1);
    run(o, 600);
    expect(vars.get('oxy.pax_on')).toBe(1);
    expect(vars.get('oxy.pax_remaining_s')).toBeCloseTo(120, 0);
    run(o, 130);
    expect(vars.get('oxy.pax_on')).toBe(0);
    expect(vars.get('oxy.pax_deployed')).toBe(1);
  });
});

describe('LightingSystem', () => {
  it('strobes flash at the anticollision rate; lights need power; incandescent lamps lag', () => {
    const vars = new SimVars();
    const l = new LightingSystem(vars, {
      exterior: [
        { name: 'strobe', on: 'ac.strobe_sw', power: 'elec.strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'xenon' },
        { name: 'nav', on: 'ac.nav_sw', power: 'elec.nav_powered', tech: 'incandescent' },
        { name: 'landing_l', on: 'ac.ldg_l', retract: { extend: 'ac.ldg_l > 0', travelS: 4 }, tech: 'halogen' },
        { name: 'beacon', on: 'ac.beacon', pattern: FLASH_PATTERNS.beaconRotating },
      ],
      dimmers: [
        { id: 'panel', knob: 'ac.panel_knob', power: 'elec.dc_powered', gamma: 2 },
        { id: 'annun', knob: 'ac.annun_dim ? 0.35 : 1', power: 'elec.dc_powered', test: 'ac.lamp_test' },
      ],
    });
    vars.set('ac.strobe_sw', 1);
    vars.set('ac.nav_sw', 1);
    run(l, 1);
    expect(vars.get('light.strobe')).toBe(0);
    expect(vars.get('light.nav')).toBe(0);
    vars.set('elec.strobe_powered', 1);
    vars.set('elec.nav_powered', 1);
    let flashes = 0;
    let prev = 0;
    run(l, 60, () => {
      const v = vars.get('light.strobe');
      if (v > 0.5 && prev <= 0.5) flashes++;
      prev = v;
    });
    // 50 double flashes per minute = 100 pulses (14 CFR 25.1401: 40-100 cycles/min).
    expect(flashes).toBeGreaterThanOrEqual(98);
    expect(flashes).toBeLessThanOrEqual(102);
    expect(vars.get('light.nav')).toBeCloseTo(1, 3);
    vars.set('elec.nav_powered', 0);
    l.update(DT);
    expect(vars.get('light.nav')).toBeGreaterThan(0.5); // filament still glowing
    run(l, 1);
    expect(vars.get('light.nav')).toBe(0);
    // Retractable landing light: dark until extended.
    vars.set('ac.ldg_l', 1);
    run(l, 2);
    expect(vars.get('light.landing_l_ext')).toBeCloseTo(0.5, 1);
    expect(vars.get('light.landing_l')).toBe(0);
    run(l, 3);
    expect(vars.get('light.landing_l_ext')).toBe(1);
    expect(vars.get('light.landing_l')).toBeCloseTo(1, 2);
    // Burnt-out lamp.
    vars.set('fail.light.landing_l', 1);
    run(l, 1);
    expect(vars.get('light.landing_l')).toBe(0);
  });

  it('dimmers: power x knob^gamma, lamp test forces full', () => {
    const vars = new SimVars();
    const l = new LightingSystem(vars, {
      dimmers: [
        { id: 'panel', knob: 'ac.panel_knob', power: 'elec.dc_powered', gamma: 2 },
        { id: 'annun', knob: 'ac.annun_dim ? 0.35 : 1', power: 'elec.dc_powered', test: 'ac.lamp_test', output: ['ac.light.annun', 'display.cas.brt'] },
      ],
    });
    vars.set('ac.panel_knob', 0.5);
    l.update(DT);
    expect(vars.get('ac.light.panel')).toBe(0);
    vars.set('elec.dc_powered', 1);
    vars.set('ac.annun_dim', 1);
    l.update(DT);
    expect(vars.get('ac.light.panel')).toBeCloseTo(0.25, 6);
    expect(vars.get('ac.light.annun')).toBeCloseTo(0.35, 6);
    expect(vars.get('display.cas.brt')).toBeCloseTo(0.35, 6);
    vars.set('ac.lamp_test', 1);
    l.update(DT);
    expect(vars.get('ac.light.annun')).toBe(1);
  });
});
