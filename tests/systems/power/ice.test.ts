import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { ENG, ENV, FDM, ICE } from '../../../src/core/vars';
import { IceProtection } from '../../../src/systems/ice/IceProtection';

const DT = 1 / 60;
function run(s: IceProtection, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) s.update(DT);
}

function setup(vars: SimVars): IceProtection {
  vars.set(ENV.icing, 0.66); // moderate
  vars.set(ENV.cloudBaseFt, 3000);
  vars.set(ENV.cloudCover, 1);
  vars.set(FDM.altMsl, 6000);
  vars.set(FDM.sat, -8);
  vars.set(FDM.tat, -5);
  vars.set(FDM.tas, 150);
  return new IceProtection(vars, {
    cloudThicknessFt: 5000,
    surfaces: [
      { id: 'airframe', output: ICE.airframe, ratePerMin: 0.1, protection: { kind: 'thermal', active: 'ac.wai * pneu.wai_ok' } },
      { id: 'tail', output: 'ice.tail', ratePerMin: 0.1, protection: { kind: 'boots', active: 'ac.boots', bootCycleS: 60 } },
      { id: 'inlet1', output: ICE.inlet(1), ratePerMin: 0.15, engine: 1, protection: { kind: 'thermal', active: 'ac.eai1' } },
      { id: 'pitot1', output: ICE.pitot(1), ratePerMin: 0.5, speedExp: 0.5, protection: { kind: 'electric', active: 'ac.pitot_heat * elec.pitot1_powered' } },
      { id: 'ws1', output: ICE.windshield(1), ratePerMin: 0.2, protection: { kind: 'electric', active: 'ac.ws_heat', capacity: 0.5 } },
    ],
    detector: { power: 'elec.ice_det_powered' },
  });
}

describe('IceProtection', () => {
  it('unprotected surfaces accrete in cloud at icing temperatures, proportional to intensity', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    run(ice, 300);
    // 0.1/min x 0.66 x temp factor 1 x 5 min = 0.33
    expect(vars.get(ICE.airframe)).toBeCloseTo(0.33, 2);
    expect(vars.get('ice.visible_moisture')).toBe(1);
    expect(vars.get('ice.potential')).toBeCloseTo(0.66, 3);
    expect(vars.get(ICE.pitot(1))).toBeGreaterThan(0.9);
    expect(vars.get('ice.airframe_rate')).toBeCloseTo(0.066, 3);
  });

  it('no accretion above the tops, in glaciated cloud (−45 °C) or with TAT above freezing', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    vars.set(FDM.altMsl, 9000); // above tops (3000 + 5000)
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBe(0);
    vars.set(FDM.altMsl, 6000);
    vars.set(FDM.sat, -45);
    vars.set(FDM.tat, -40);
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBe(0);
    vars.set(FDM.sat, -3);
    vars.set(FDM.tat, 2); // kinetic heating
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBe(0);
  });

  it('freezing rain below cloud ices the aircraft', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    vars.set(FDM.altMsl, 2000); // below the base
    vars.set(ENV.precip, 0.8);
    vars.set(FDM.sat, -2);
    vars.set(FDM.tat, -1);
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBeGreaterThan(0.05);
  });

  it('thermal anti-ice prevents accretion and sheds existing ice; melting above freezing', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    run(ice, 180);
    const iced = vars.get(ICE.airframe);
    expect(iced).toBeGreaterThan(0.15);
    vars.set('ac.wai', 1);
    vars.set('pneu.wai_ok', 1);
    run(ice, 60);
    expect(vars.get(ICE.airframe)).toBeLessThan(iced - 0.3 * iced);
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBe(0);
    expect(vars.get('ice.airframe_protected')).toBe(1);
    // Anti-ice selected but no bleed pressure: accretes again.
    vars.set('pneu.wai_ok', 0);
    run(ice, 60);
    expect(vars.get(ICE.airframe)).toBeGreaterThan(0.05);
    // Descend into warm air: melts.
    vars.set(FDM.tat, 6);
    vars.set(FDM.sat, 4);
    run(ice, 120);
    expect(vars.get(ICE.airframe)).toBe(0);
  });

  it('boots remove most of the ice on each inflation cycle', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    run(ice, 240);
    const before = vars.get('ice.tail');
    expect(before).toBeGreaterThan(0.2);
    vars.set('ac.boots', 1);
    run(ice, 61);
    expect(vars.get('ice.tail')).toBeLessThan(before * 0.3);
  });

  it('pitot heat keeps the probe clear; a heater failure lets it block. Engine anti-ice sets eng.anti_ice', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    vars.set('ac.pitot_heat', 1);
    vars.set('elec.pitot1_powered', 1);
    vars.set('ac.eai1', 1);
    run(ice, 120);
    expect(vars.get(ICE.pitot(1))).toBe(0);
    expect(vars.get(ICE.inlet(1))).toBe(0);
    expect(vars.get(ENG.antiIce(1))).toBe(1);
    vars.set('fail.ice.pitot1.heat', 1);
    run(ice, 120);
    expect(vars.get(ICE.pitot(1))).toBeGreaterThan(0.5);
    expect(ice.failures().some((f) => f.id === 'ice.pitot1.heat')).toBe(true);
  });

  it('limited-capacity heat is overwhelmed by severe icing (runback)', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    vars.set('ac.ws_heat', 1);
    vars.set(ENV.icing, 0.3);
    run(ice, 120);
    expect(vars.get(ICE.windshield(1))).toBe(0);
    vars.set(ENV.icing, 1);
    run(ice, 300);
    expect(vars.get(ICE.windshield(1))).toBeGreaterThan(0.05);
  });

  it('ice detector: on while icing, held 60 s after leaving, off when unpowered or failed', () => {
    const vars = new SimVars();
    const ice = setup(vars);
    vars.set('elec.ice_det_powered', 1);
    run(ice, 5);
    expect(vars.get('ice.detected')).toBe(1);
    vars.set(FDM.altMsl, 9000);
    run(ice, 30);
    expect(vars.get('ice.detected')).toBe(1);
    run(ice, 35);
    expect(vars.get('ice.detected')).toBe(0);
    vars.set(FDM.altMsl, 6000);
    vars.set('fail.ice.detector', 1);
    run(ice, 5);
    expect(vars.get('ice.detected')).toBe(0);
    expect(vars.get('ice.detector_fail')).toBe(1);
  });
});
