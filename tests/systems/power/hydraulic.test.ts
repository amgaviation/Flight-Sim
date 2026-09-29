import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { HydraulicSystem } from '../../../src/systems/hydraulic/HydraulicSystem';
import type { HydraulicConfig } from '../../../src/systems/hydraulic/types';

const DT = 1 / 60;
const GPM = 3.785411784; // L/min per US gpm
function run(h: HydraulicSystem, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.();
    h.update(DT);
  }
}

/** 737NG-like A/B systems: 3000 psi (smartcockpit/b737 notes), EDP ≈ 4x ACMP flow, brake accumulator on B (1000 psi precharge). */
function b737(vars: SimVars): HydraulicSystem {
  const cfg: HydraulicConfig = {
    systems: [
      { id: 'a', nominalPsi: 3000, reservoirL: 20 },
      { id: 'b', nominalPsi: 3000, reservoirL: 30 },
      { id: 'brake_acc', nominalPsi: 3000, reservoirL: 1, accumulator: { prechargePsi: 1000, volumeL: 2 }, internalLeakLpm: 0.002 },
    ],
    pumps: [
      { id: 'edp_a', system: 'a', kind: 'edp', maxFlowLpm: 22 * GPM, drive: 'eng1.n2_pct / 100', on: 'ac.edp_a' },
      { id: 'acmp_a', system: 'a', kind: 'electric', maxFlowLpm: 5.7 * GPM, drive: 'elec.acmp_a_powered', on: 'ac.acmp_a', electric: { supply: 'ac' } },
      { id: 'edp_b', system: 'b', kind: 'edp', maxFlowLpm: 22 * GPM, drive: 'eng2.n2_pct / 100', on: 'ac.edp_b' },
    ],
    transfers: [
      { id: 'ptu', kind: 'ptu', from: 'a', to: 'b', maxFlowLpm: 10 * GPM, active: 'ac.ptu_cmd' },
      { id: 'brake_chg', kind: 'check', from: 'b', to: 'brake_acc', maxFlowLpm: 10 },
    ],
    consumers: [
      { id: 'gear', system: 'a', demandLpm: 'ac.gear_moving * 60' },
      { id: 'brakes', system: 'brake_acc', demandLpm: 'ac.braking * 6' },
    ],
  };
  vars.set('ac.edp_a', 1);
  vars.set('ac.edp_b', 1);
  return new HydraulicSystem(vars, cfg);
}

describe('HydraulicSystem', () => {
  it('no pressure without a turning/powered pump; ACMP and EDP pressurise to the compensator setting', () => {
    const vars = new SimVars();
    const h = b737(vars);
    run(h, 2);
    expect(vars.get('hyd.a_psi')).toBe(0);
    expect(vars.get('hyd.edp_a_lowpress')).toBe(1);
    expect(vars.get('hyd.a_lowpress')).toBe(1);
    vars.set('ac.acmp_a', 1);
    vars.set('elec.acmp_a_powered', 1);
    run(h, 3);
    expect(vars.get('hyd.a_psi')).toBeGreaterThan(2850);
    expect(vars.get('hyd.a_psi')).toBeLessThan(3010);
    expect(vars.get('hyd.acmp_a_lowpress')).toBe(0);
    expect(vars.get('hyd.acmp_a_va')).toBeGreaterThan(200); // idle draw
    // Engine start: EDP comes up with N2.
    vars.set('eng2.n2_pct', 60);
    run(h, 3);
    expect(vars.get('hyd.b_psi')).toBeGreaterThan(2850);
  });

  it('pressure droops under a demand larger than the pumps can supply (single ACMP + gear)', () => {
    const vars = new SimVars();
    const h = b737(vars);
    vars.set('ac.acmp_a', 1);
    vars.set('elec.acmp_a_powered', 1);
    run(h, 3);
    vars.set('ac.gear_moving', 1); // 60 L/min vs 21.6 L/min ACMP
    run(h, 2);
    expect(vars.get('hyd.a_psi')).toBeLessThan(1600);
    expect(vars.get('hyd.gear_rate')).toBeLessThan(1);
    // Motor load follows hydraulic power P·Q: pump at max flow but low pressure.
    expect(vars.get('hyd.acmp_a_va')).toBeGreaterThan(1500);
    // With the EDP at high N2 the gear gets its full flow at near-nominal pressure.
    vars.set('eng1.n2_pct', 90);
    run(h, 2);
    expect(vars.get('hyd.a_psi')).toBeGreaterThan(2700);
    expect(vars.get('hyd.gear_rate')).toBe(1);
    vars.set('ac.gear_moving', 0);
    run(h, 1);
    expect(vars.get('hyd.a_psi')).toBeGreaterThan(2900);
  });

  it('PTU pressurises B from A when B is lost', () => {
    const vars = new SimVars();
    const h = b737(vars);
    vars.set('eng1.n2_pct', 80);
    run(h, 3);
    expect(vars.get('hyd.b_psi')).toBe(0);
    vars.set('ac.ptu_cmd', 1);
    run(h, 3);
    expect(vars.get('hyd.ptu_active')).toBe(1);
    expect(vars.get('hyd.b_psi')).toBeGreaterThan(2000);
    expect(vars.get('hyd.a_psi')).toBeGreaterThan(2700);
  });

  it('brake accumulator charges through its check valve, holds pressure, and is depleted by braking', () => {
    const vars = new SimVars();
    const h = b737(vars);
    vars.set('eng2.n2_pct', 60);
    run(h, 20);
    const charged = vars.get('hyd.brake_acc_psi');
    expect(charged).toBeGreaterThan(2700);
    vars.set('eng2.n2_pct', 0); // engines off
    run(h, 30);
    expect(vars.get('hyd.b_psi')).toBeLessThan(300); // bleeds down through internal leakage
    expect(vars.get('hyd.brake_acc_psi')).toBeGreaterThan(2500); // parking brake stays charged
    vars.set('ac.braking', 1);
    run(h, 10);
    const after = vars.get('hyd.brake_acc_psi');
    expect(after).toBeLessThan(2000);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it('a leak drains the reservoir and eventually the pressure', () => {
    const vars = new SimVars();
    const h = b737(vars);
    vars.set('eng1.n2_pct', 80);
    run(h, 3);
    const q0 = vars.get('hyd.a_qty');
    vars.set('fail.hyd.a.leak', 1);
    run(h, 120);
    expect(vars.get('hyd.a_qty')).toBeLessThan(q0 - 0.3);
    run(h, 300);
    expect(vars.get('hyd.a_lowqty')).toBe(1);
    expect(vars.get('hyd.a_psi')).toBeLessThan(500);
  });
});
