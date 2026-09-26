import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { ENG, FDM, FUEL } from '../../../src/core/vars';
import { FuelSystem } from '../../../src/systems/fuel/FuelSystem';
import type { FuelSystemConfig } from '../../../src/systems/fuel/types';

const DT = 1 / 60;
function run(s: FuelSystem, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) s.update(DT);
}

/** 737NG-style: two wing mains with two AC pumps each, centre tank with two higher-pressure pumps, crossfeed, spar valves. */
function b737(vars: SimVars): FuelSystem {
  const cfg: FuelSystemConfig = {
    tanks: [
      { id: 'main1', index: 0, capacityKg: 3900, unusableKg: 20, lowLevelKg: 450 },
      { id: 'ctr', index: 1, capacityKg: 13000, unusableKg: 30 },
      { id: 'main2', index: 2, capacityKg: 3900, unusableKg: 20, lowLevelKg: 450 },
    ],
    nodes: ['man1', 'man2', 'eng1_in', 'eng2_in'],
    pumps: [
      { id: 'fwd1', kind: 'electric', from: 'main1', to: 'man1', pressurePsi: 23, maxFlowPph: 12000, on: 'ac.fwd1' },
      { id: 'aft1', kind: 'electric', from: 'main1', to: 'man1', pressurePsi: 23, maxFlowPph: 12000, on: 'ac.aft1' },
      { id: 'ctr_l', kind: 'electric', from: 'ctr', to: 'man1', pressurePsi: 33, maxFlowPph: 12000, on: 'ac.ctr_l' },
      { id: 'ctr_r', kind: 'electric', from: 'ctr', to: 'man2', pressurePsi: 33, maxFlowPph: 12000, on: 'ac.ctr_r' },
      { id: 'fwd2', kind: 'electric', from: 'main2', to: 'man2', pressurePsi: 23, maxFlowPph: 12000, on: 'ac.fwd2' },
      { id: 'aft2', kind: 'electric', from: 'main2', to: 'man2', pressurePsi: 23, maxFlowPph: 12000, on: 'ac.aft2' },
    ],
    valves: [
      { id: 'xfeed', a: 'man1', b: 'man2', open: 'ac.xfeed', travelS: 2 },
      { id: 'spar1', a: 'man1', b: 'eng1_in', open: 'ac.lever1', travelS: 1 },
      { id: 'spar2', a: 'man2', b: 'eng2_in', open: 'ac.lever2', travelS: 1 },
    ],
    consumers: [
      { id: 'eng1', node: 'eng1_in', flowPph: ENG.fuelFlowPph(1), engine: 1, run: 'ac.lever1', minPressPsi: 5, suction: { tank: 'main1', ceilingFt: 25000, running: 'eng1.n2_pct > 20' } },
      { id: 'eng2', node: 'eng2_in', flowPph: ENG.fuelFlowPph(2), engine: 2, run: 'ac.lever2', minPressPsi: 5, suction: { tank: 'main2', ceilingFt: 25000, running: 'eng2.n2_pct > 20' } },
    ],
    balance: { left: 'main1', right: 'main2', alertKg: 453 },
  };
  for (const k of ['fwd1', 'aft1', 'fwd2', 'aft2', 'ctr_l', 'ctr_r', 'lever1', 'lever2']) vars.set(`ac.${k}`, 1);
  vars.set(ENG.fuelFlowPph(1), 2400);
  vars.set(ENG.fuelFlowPph(2), 2400);
  vars.set(ENG.n2(1), 90);
  vars.set(ENG.n2(2), 90);
  return new FuelSystem(vars, cfg);
}

describe('FuelSystem: jet feed, crossfeed and consumption', () => {
  it('initialises tanks full and publishes totals', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    expect(vars.get(FUEL.tankKg(0))).toBe(3900);
    expect(vars.get(FUEL.totalKg)).toBe(3900 * 2 + 13000);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(1);
  });

  it('higher-pressure centre pumps feed first; wing tanks stay full', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    run(fs, 600);
    // 2 x 2400 pph for 10 min = 800 lb = 362.9 kg, all from the centre tank.
    expect(vars.get(FUEL.tankKg(1))).toBeCloseTo(13000 - 362.87, 0);
    expect(vars.get(FUEL.tankKg(0))).toBeCloseTo(3900, 3);
    expect(vars.get(FUEL.tankKg(2))).toBeCloseTo(3900, 3);
    expect(vars.get('fuel.used_kg')).toBeCloseTo(362.87, 0);
    expect(vars.get('fuel.ctr_l_flow_pph')).toBeCloseTo(2400, 0);
    expect(vars.get('fuel.fwd1_flow_pph')).toBe(0);
    expect(vars.get('fuel.fwd1_lowpress')).toBe(0); // running, pressurised (blocked by check valve)
  });

  it('each engine burns from its own wing tank with the centre pumps off', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    vars.set('ac.ctr_l', 0);
    vars.set('ac.ctr_r', 0);
    vars.set(ENG.fuelFlowPph(2), 1200);
    run(fs, 600);
    expect(vars.get(FUEL.tankKg(1))).toBe(13000);
    expect(3900 - vars.get(FUEL.tankKg(0))).toBeCloseTo(181.44, 0);
    expect(3900 - vars.get(FUEL.tankKg(2))).toBeCloseTo(90.72, 0);
    expect(vars.get('fuel.imbalance_kg')).toBeCloseTo(-90.72, 0);
    // Both pumps of a tank share the flow.
    expect(vars.get('fuel.fwd1_flow_pph')).toBeCloseTo(1200, 0);
    expect(vars.get('fuel.aft1_flow_pph')).toBeCloseTo(1200, 0);
  });

  it('crossfeed open with tank 2 pumps off: both engines burn from tank 1 (imbalance correction)', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    vars.set('ac.ctr_l', 0);
    vars.set('ac.ctr_r', 0);
    vars.set('ac.xfeed', 1);
    run(fs, 3); // valve travel
    expect(vars.get('fuel.xfeed_open')).toBe(1);
    vars.set('ac.fwd2', 0);
    vars.set('ac.aft2', 0);
    const m2 = vars.get(FUEL.tankKg(2));
    run(fs, 600);
    expect(vars.get(FUEL.tankKg(2))).toBeCloseTo(m2, 6);
    expect(3900 - vars.get(FUEL.tankKg(0))).toBeGreaterThan(362);
    expect(vars.get(ENG.fuelOn(2))).toBe(1);
    expect(vars.get('fuel.fwd2_lowpress')).toBe(0); // switched off: no light logic here (commanded off)
    expect(vars.get('fuel.eng2_psi')).toBeGreaterThan(15);
  });

  it('crossfeed valve shows in-transit while moving', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    fs.update(DT);
    vars.set('ac.xfeed', 1);
    run(fs, 0.5);
    expect(vars.get('fuel.xfeed_transit')).toBe(1);
    expect(vars.get('fuel.xfeed_open')).toBe(0);
    run(fs, 2);
    expect(vars.get('fuel.xfeed_transit')).toBe(0);
    expect(vars.get('fuel.xfeed_open')).toBe(1);
  });

  it('suction feed keeps a running engine alive with all pumps off at low altitude but not at high altitude', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    for (const k of ['fwd1', 'aft1', 'fwd2', 'aft2', 'ctr_l', 'ctr_r']) vars.set(`ac.${k}`, 0);
    vars.set(FDM.pressAlt, 10000);
    run(fs, 60);
    expect(vars.get(ENG.fuelOn(1))).toBe(1);
    expect(vars.get('fuel.eng1_suction')).toBe(1);
    expect(3900 - vars.get(FUEL.tankKg(0))).toBeCloseTo(18.14, 0);
    expect(vars.get('fuel.fwd1_lowpress')).toBe(0); // off
    vars.set(FDM.pressAlt, 35000);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(0);
  });

  it('start lever to CUTOFF closes the spar valve and cuts fuel; an empty tank gives pump LOW PRESSURE', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    fs.update(DT);
    vars.set('ac.lever1', 0);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(0); // run command removed immediately
    run(fs, 2);
    expect(vars.get('fuel.spar1_pos')).toBe(0);
    vars.set('ac.ctr_l', 0);
    vars.set('ac.ctr_r', 0);
    fs.setTankKg('main2', 20); // at unusable level
    fs.update(DT);
    expect(vars.get('fuel.fwd2_lowpress')).toBe(1);
    expect(vars.get('fuel.fwd2_on')).toBe(0);
    vars.set(FDM.pressAlt, 35000);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(2))).toBe(0); // flameout: no feed
  });

  it('pumped transfer and gravity crossflow move fuel between tanks', () => {
    const vars = new SimVars();
    const fs = new FuelSystem(vars, {
      tanks: [
        { id: 'l', index: 0, capacityKg: 5000, initialKg: 4000 },
        { id: 'r', index: 1, capacityKg: 5000, initialKg: 2000 },
        { id: 'aux', index: 2, capacityKg: 1000, initialKg: 1000 },
      ],
      nodes: ['n'],
      pumps: [{ id: 'p', kind: 'electric', from: 'l', to: 'n', pressurePsi: 20, maxFlowPph: 5000 }],
      consumers: [],
      transfers: [
        { id: 'aux_xfr', from: 'aux', to: 'r', kind: 'pumped', ratePph: 3600, active: 'ac.xfr' },
        { id: 'crossflow', from: 'l', to: 'r', kind: 'gravity', ratePph: 6000, active: 'ac.xflow', bidirectional: true },
      ],
    });
    vars.set('ac.xfr', 1);
    run(fs, 60);
    expect(vars.get(FUEL.tankKg(2))).toBeCloseTo(1000 - 27.2155, 1);
    vars.set('ac.xfr', 0);
    vars.set('ac.xflow', 1);
    run(fs, 3600);
    const l = vars.get(FUEL.tankKg(0));
    const r = vars.get(FUEL.tankKg(1));
    expect(Math.abs(l - r)).toBeLessThan(60); // levels equalise
    expect(l + r + vars.get(FUEL.tankKg(2))).toBeCloseTo(7000, 3); // conserved
  });

  it('tank leak failure loses fuel', () => {
    const vars = new SimVars();
    const fs = b737(vars);
    vars.set('fail.fuel.main2.leak', 1);
    run(fs, 60);
    expect(vars.get(FUEL.tankKg(2))).toBeLessThan(3900 - 5);
    expect(fs.failures().some((f) => f.id === 'fuel.main2.leak')).toBe(true);
  });
});

describe('FuelSystem: Cessna 172S gravity feed', () => {
  // POH: 56 gal total, 53 usable -> 28 gal/tank, 1.5 gal unusable each; avgas 6 lb/gal.
  const GAL = 6 * 0.45359237;
  function c172(vars: SimVars): FuelSystem {
    return new FuelSystem(vars, {
      tanks: [
        { id: 'left', index: 0, capacityKg: 28 * GAL, unusableKg: 1.5 * GAL, lowLevelKg: 5 * GAL },
        { id: 'right', index: 1, capacityKg: 28 * GAL, unusableKg: 1.5 * GAL, lowLevelKg: 5 * GAL },
      ],
      nodes: ['l_out', 'r_out', 'sel', 'strainer', 'servo'],
      pumps: [
        { id: 'grav_l', kind: 'gravity', from: 'left', to: 'l_out', pressurePsi: 0.5, maxFlowPph: 300 },
        { id: 'grav_r', kind: 'gravity', from: 'right', to: 'r_out', pressurePsi: 0.5, maxFlowPph: 300 },
        { id: 'aux', kind: 'electric', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150, on: 'ac.aux_pump' },
        { id: 'edp', kind: 'engine', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150, on: 'eng1.rpm > 50' },
      ],
      valves: [
        { id: 'sel_l', a: 'l_out', b: 'sel', open: 'ac.sel <= 1', travelS: 0 }, // 0 LEFT, 1 BOTH, 2 RIGHT
        { id: 'sel_r', a: 'r_out', b: 'sel', open: 'ac.sel >= 1', travelS: 0 },
        { id: 'shutoff', a: 'sel', b: 'strainer', open: 'ac.shutoff', travelS: 0 },
      ],
      consumers: [{ id: 'eng', node: 'servo', flowPph: ENG.fuelFlowPph(1), engine: 1, minPressPsi: 1 }],
      balance: { left: 'left', right: 'right', alertKg: 10 * GAL },
    });
  }

  it('no fuel pressure at the servo until the aux pump runs or the engine turns', () => {
    const vars = new SimVars();
    vars.set('ac.sel', 1);
    vars.set('ac.shutoff', 1);
    const fs = c172(vars);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(0);
    vars.set('ac.aux_pump', 1); // priming
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(1);
    vars.set('ac.aux_pump', 0);
    vars.set(ENG.rpm(1), 2300);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(1);
    vars.set('ac.shutoff', 0);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(0);
  });

  it('BOTH draws equally; LEFT draws only from the left tank', () => {
    const vars = new SimVars();
    vars.set('ac.sel', 1);
    vars.set('ac.shutoff', 1);
    vars.set(ENG.rpm(1), 2400);
    vars.set(ENG.fuelFlowPph(1), 50.4); // 8.4 gph
    const fs = c172(vars);
    const l0 = vars.get(FUEL.tankKg(0));
    run(fs, 3600);
    const dl = l0 - vars.get(FUEL.tankKg(0));
    const dr = l0 - vars.get(FUEL.tankKg(1));
    expect(dl + dr).toBeCloseTo(50.4 * 0.45359237, 1);
    expect(Math.abs(dl - dr)).toBeLessThan(0.01);
    vars.set('ac.sel', 0);
    const r1 = vars.get(FUEL.tankKg(1));
    run(fs, 1800);
    expect(vars.get(FUEL.tankKg(1))).toBeCloseTo(r1, 6);
    expect(vars.get('fuel.imbalance_kg')).toBeLessThan(-11);
  });

  it('running the selected tank dry starves the engine; switching tanks restores feed', () => {
    const vars = new SimVars();
    vars.set('ac.sel', 0);
    vars.set('ac.shutoff', 1);
    vars.set(ENG.rpm(1), 2400);
    vars.set(ENG.fuelFlowPph(1), 60);
    const fs = c172(vars);
    fs.setTankKg('left', 1.5 * GAL + 0.2);
    run(fs, 30);
    expect(vars.get(ENG.fuelOn(1))).toBe(0);
    expect(vars.get('fuel.left_low')).toBe(1);
    vars.set('ac.sel', 2);
    fs.update(DT);
    expect(vars.get(ENG.fuelOn(1))).toBe(1);
  });
});
