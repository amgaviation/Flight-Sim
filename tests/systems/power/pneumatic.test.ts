import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { ENG, FDM } from '../../../src/core/vars';
import { PneumaticSystem } from '../../../src/systems/pneumatic/PneumaticSystem';
import type { PneumaticConfig } from '../../../src/systems/pneumatic/types';

const DT = 1 / 60;
function run(s: PneumaticSystem, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.();
    s.update(DT);
  }
}

function twinJet(vars: SimVars): PneumaticSystem {
  const cfg: PneumaticConfig = {
    ducts: ['left', 'right', 'apu'],
    sources: [
      { id: 'bleed1', duct: 'left', pressure: ENG.bleedPressPsi(1), valve: 'ac.bleed1', maxFlowKgs: 1.2, engine: 1, reset: 'ac.trip_reset', hp: { belowPsi: 25, ratio: 1.8 } },
      { id: 'bleed2', duct: 'right', pressure: ENG.bleedPressPsi(2), valve: 'ac.bleed2', maxFlowKgs: 1.2, engine: 2, reset: 'ac.trip_reset', hp: { belowPsi: 25, ratio: 1.8 } },
      { id: 'apu_bleed', duct: 'apu', pressure: 'apu.bleed_psi', valve: 'ac.apu_bleed', maxFlowKgs: 1.4, regulatedPsi: 40 },
    ],
    valves: [
      { id: 'isol', a: 'left', b: 'right', open: 'ac.isol', travelS: 3 },
      { id: 'apu_check', a: 'apu', b: 'left', open: 'true', travelS: 0 },
    ],
    consumers: [
      { id: 'wai', duct: 'left', demandKgs: 'ac.wai * 0.3', minPsi: 20 },
      { id: 'cowl1', engine: 1, demandKgs: 'ac.eai1 * 0.08', minPsi: 10 },
    ],
    packs: [
      { id: 'pack_l', duct: 'left', on: 'ac.pack_l > 0', flowKgs: 'ac.pack_l == 2 ? 0.8 : 0.55' },
      { id: 'pack_r', duct: 'right', on: 'ac.pack_r > 0', flowKgs: 'ac.pack_r == 2 ? 0.8 : 0.55' },
    ],
    zones: [
      { id: 'flt_deck', packs: ['pack_l'], target: 'ac.fd_temp', volumeM3: 10, heatLoadW: 800 },
      { id: 'cabin', packs: ['pack_l', 'pack_r'], target: 'ac.cab_temp', volumeM3: 120, heatLoadW: 'ac.pax * 100 + 2000' },
    ],
    starters: [
      { id: 'sv1', engine: 1, duct: 'left', command: 'ac.start1', nominalPsi: 30, demandKgs: 1.0 },
      { id: 'sv2', engine: 2, duct: 'right', command: 'ac.start2', nominalPsi: 30, demandKgs: 1.0 },
    ],
  };
  return new PneumaticSystem(vars, cfg);
}

describe('PneumaticSystem', () => {
  it('APU bleed pressurises the duct and drives an air-turbine start; the isolation valve feeds the other side', () => {
    const vars = new SimVars();
    vars.set('ac.apu_bleed', 1);
    vars.set('apu.bleed_psi', 48);
    const p = twinJet(vars);
    run(p, 3);
    expect(vars.get('pneu.left_psi')).toBeGreaterThan(36);
    expect(vars.get('pneu.right_psi')).toBeLessThan(1);
    vars.set('ac.start1', 1);
    let starterOn = 0;
    const n = 120;
    run(p, 2, () => undefined);
    for (let i = 0; i < n; i++) {
      p.update(DT);
      starterOn += vars.get(ENG.starter(1)) / n;
    }
    expect(vars.get('pneu.sv1_valve_open')).toBe(1);
    expect(vars.get('pneu.sv1_strength')).toBeGreaterThan(0.95);
    expect(starterOn).toBeGreaterThan(0.95);
    // Engine 2 start needs the isolation valve open.
    vars.set('ac.start2', 1);
    run(p, 1);
    expect(vars.get('pneu.sv2_strength')).toBe(0);
    expect(vars.get(ENG.starter(2))).toBe(0);
    vars.set('ac.isol', 1);
    run(p, 5);
    expect(vars.get('pneu.isol_open')).toBe(1);
    expect(vars.get('pneu.right_psi')).toBeGreaterThan(20);
    expect(vars.get('pneu.sv2_strength')).toBeGreaterThan(0.6);
  });

  it('two starts on one APU source droop the duct pressure (weaker starts)', () => {
    const vars = new SimVars();
    vars.set('ac.apu_bleed', 1);
    vars.set('apu.bleed_psi', 48);
    vars.set('ac.isol', 1);
    vars.set('ac.pack_l', 1);
    vars.set('ac.pack_r', 1);
    const p = twinJet(vars);
    run(p, 4);
    const withPacks = vars.get('pneu.left_psi');
    vars.set('ac.pack_l', 0);
    vars.set('ac.pack_r', 0);
    run(p, 4);
    expect(vars.get('pneu.left_psi')).toBeGreaterThan(withPacks);
    vars.set('ac.start1', 1);
    vars.set('ac.start2', 1);
    run(p, 4);
    expect(vars.get('pneu.left_psi')).toBeLessThan(30);
  });

  it('engine bleed feeds packs and wing anti-ice and publishes bleed extract; HP port at idle', () => {
    const vars = new SimVars();
    vars.set('ac.bleed1', 1);
    vars.set('ac.bleed2', 1);
    vars.set('ac.pack_l', 1);
    vars.set('ac.pack_r', 1);
    vars.set(ENG.bleedPressPsi(1), 60);
    vars.set(ENG.bleedPressPsi(2), 60);
    const p = twinJet(vars);
    run(p, 5);
    expect(vars.get('pneu.left_psi')).toBeGreaterThan(35);
    expect(vars.get('pneu.pack_l_flow_kgs')).toBeCloseTo(0.55, 2);
    expect(vars.get('pneu.pack_flow_kgs')).toBeCloseTo(1.1, 2);
    const x0 = vars.get(ENG.bleedExtract(1));
    expect(x0).toBeGreaterThan(0.4);
    vars.set('ac.wai', 1);
    vars.set('ac.eai1', 1);
    run(p, 2);
    expect(vars.get('pneu.wai_ok')).toBe(1);
    expect(vars.get('pneu.cowl1_ok')).toBe(1);
    expect(vars.get(ENG.bleedExtract(1))).toBeGreaterThan(x0 + 0.2);
    // Idle descent: LP port pressure low -> HP valve opens.
    vars.set(ENG.bleedPressPsi(1), 15);
    run(p, 2);
    expect(vars.get('pneu.bleed1_hp')).toBe(1);
    expect(vars.get('pneu.bleed1_psi')).toBeCloseTo(27, 0);
  });

  it('bleed overheat trips the PRSOV until the fault clears and TRIP RESET is pressed', () => {
    const vars = new SimVars();
    vars.set('ac.bleed1', 1);
    vars.set(ENG.bleedPressPsi(1), 60);
    const p = twinJet(vars);
    run(p, 3);
    vars.set('fail.pneu.bleed1.overheat', 1);
    run(p, 5);
    expect(vars.get('pneu.bleed1_trip')).toBe(1);
    expect(vars.get('pneu.bleed1_valve_open')).toBe(0);
    expect(vars.get('pneu.left_psi')).toBeLessThan(2);
    vars.set('ac.trip_reset', 1);
    run(p, 0.2);
    vars.set('ac.trip_reset', 0);
    run(p, 0.1);
    expect(vars.get('pneu.bleed1_trip')).toBe(1); // fault still present
    vars.set('fail.pneu.bleed1.overheat', 0);
    vars.set('ac.trip_reset', 1);
    run(p, 3);
    expect(vars.get('pneu.bleed1_trip')).toBe(0);
    expect(vars.get('pneu.left_psi')).toBeGreaterThan(35);
  });

  it('zone temperature control reaches the selected temperature; with packs off the cabin cools toward the skin', () => {
    const vars = new SimVars();
    vars.set('ac.bleed1', 1);
    vars.set('ac.bleed2', 1);
    vars.set(ENG.bleedPressPsi(1), 60);
    vars.set(ENG.bleedPressPsi(2), 60);
    vars.set('ac.pack_l', 1);
    vars.set('ac.pack_r', 1);
    vars.set('ac.fd_temp', 20);
    vars.set('ac.cab_temp', 24);
    vars.set('ac.pax', 120);
    vars.set(FDM.tat, -30);
    const p = twinJet(vars);
    run(p, 900);
    expect(vars.get('pneu.cabin_temp_c')).toBeCloseTo(24, 0);
    expect(vars.get('pneu.flt_deck_temp_c')).toBeCloseTo(20, 0);
    vars.set('ac.pack_l', 0);
    vars.set('ac.pack_r', 0);
    vars.set('ac.pax', 0);
    run(p, 1800);
    expect(vars.get('pneu.cabin_temp_c')).toBeLessThan(18);
  });

  it('duct leak failure raises the leak flag and bleeds pressure away', () => {
    const vars = new SimVars();
    vars.set('ac.apu_bleed', 1);
    vars.set('apu.bleed_psi', 48);
    const p = twinJet(vars);
    run(p, 3);
    const p0 = vars.get('pneu.left_psi');
    vars.set('fail.pneu.left.leak', 1);
    run(p, 3);
    expect(vars.get('pneu.left_leak')).toBe(1);
    expect(vars.get('pneu.left_psi')).toBeLessThan(p0);
  });
});
