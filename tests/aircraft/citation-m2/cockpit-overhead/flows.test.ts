/**
 * Citation M2 key flows through the overhead / sidewall equipment and the
 * electrical power-up sequence, checked against the annunciator (CAS) and
 * indication states:
 *   - battery -> GPU -> engine generators (the M2 has no APU): bus voltages,
 *     GPU ON advisory, GEN OFF cautions while the engines run with the
 *     generators off, BATT DISCHARGE, EMER BUS ON BATT;
 *   - crew oxygen: mask donned; regulator N adds no oxygen at a sea-level cabin,
 *     100 % flows (flow indicator, bottle pressure drops), EMER adds flow; PRESS TO TEST;
 *   - 110 V outlet: the plug switches the inverter on (load current, outlet
 *     LED), not available with the BATTERY switch in EMER;
 *   - emergency lighting battery pack: lit by a 5 g inertia load.
 */
import { describe, expect, it } from 'vitest';
import { ENG, FDM } from '../../../../src/core/vars';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import { M2_SIDE_VARS } from '../../../../src/aircraft/citation-m2/cockpit/side/services';
import { click, makeCockpitRig, pointer, type CockpitRig } from './harness';

function startEngine(r: CockpitRig, i: 1 | 2): void {
  const v = r.vars;
  v.set(M2.startBtn(i), 1);
  r.step(0.3);
  v.set(M2.startBtn(i), 0);
  for (let t = 0; t < 90 && !(v.get(ENG.running(i)) === 1 && v.get(ENG.n2(i)) > 51); t += 0.5) {
    if (v.get(ENG.n2(i)) > 9 && v.get(M2.tla(i)) < 0) v.set(M2.tla(i), TLA.idle);
    r.step(0.5);
  }
}

describe('Citation M2 electrical power-up flow (battery -> GPU -> generators)', () => {
  it('produces the correct bus and CAS states at each step', () => {
    const r = makeCockpitRig({ state: 'cold_dark' });
    const v = r.vars;
    r.step(1);
    // Cold & dark: everything off except the hot battery bus.
    expect(v.get('elec.hot_batt_powered')).toBe(1);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(v.get('elec.emer_powered')).toBe(0);

    // 1) BATTERY BATT: battery bus, emergency bus and crossfeeds on the NiCd (~24-25 V); avionics off until AVIONICS ON.
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    r.step(2);
    expect(v.get('elec.batt_bus_powered')).toBe(1);
    expect(v.get('elec.emer_powered')).toBe(1);
    expect(v.get('elec.batt_bus_v')).toBeGreaterThan(23);
    expect(v.get('elec.batt_bus_v')).toBeLessThan(27);
    expect(v.get('elec.avn1_powered')).toBe(0);
    v.set(M2.avionicsSw, 1);
    r.step(12);
    expect(v.get('elec.avn1_powered')).toBe(1);
    expect(v.get('elec.avn2_powered')).toBe(1);
    // On the battery with the avionics up: discharging, BATT DISCHARGE caution after its delay.
    expect(v.get('elec.batt_amps')).toBeLessThan(-15);
    expect(v.get('cas.batt_disch')).toBe(1);
    expect(v.get('cas.gpu')).toBe(0);

    // 2) GPU connected (ground-services menu): 28 V on the battery bus, GPU ON advisory, battery charging, BATT DISCHARGE clears.
    v.set(M2.gpuConnected, 1);
    r.step(12);
    expect(v.get('elec.gpu_online')).toBe(1);
    expect(v.get('cas.gpu')).toBe(1);
    expect(v.get('elec.batt_bus_v')).toBeGreaterThan(27);
    expect(v.get('elec.batt_amps')).toBeGreaterThanOrEqual(0); // charging (0 when already full)
    expect(v.get('cas.batt_disch')).toBe(0);

    // 3) Engines started on the GPU with the generator switches OFF: GEN OFF L / R cautions.
    v.set(M2.genSw(1), 0);
    v.set(M2.genSw(2), 0);
    startEngine(r, 2);
    startEngine(r, 1);
    r.step(3);
    expect(v.get(ENG.running(1))).toBe(1);
    expect(v.get(ENG.running(2))).toBe(1);
    expect(v.get('cas.gen_off_l')).toBe(1);
    expect(v.get('cas.gen_off_r')).toBe(1);

    // 4) Generators ON, GPU disconnected: both generators on line at 28.5 V, cautions and GPU advisory clear.
    v.set(M2.genSw(1), 1);
    v.set(M2.genSw(2), 1);
    v.set(M2.gpuConnected, 0);
    r.step(5);
    expect(v.get('elec.sg1_online')).toBe(1);
    expect(v.get('elec.sg2_online')).toBe(1);
    expect(v.get('elec.l_main_v')).toBeGreaterThan(27.5);
    expect(v.get('elec.r_main_v')).toBeGreaterThan(27.5);
    expect(v.get('cas.gen_off_l')).toBe(0);
    expect(v.get('cas.gen_off_r')).toBe(0);
    expect(v.get('cas.gpu')).toBe(0);
    expect(v.get('cas.batt_disch')).toBe(0);

    // 5) Generator RESET (spring) after a trip-free cycle keeps it on line; GEN OFF L while switched OFF.
    v.set(M2.genSw(1), 0);
    r.step(2);
    expect(v.get('cas.gen_off_l')).toBe(1);
    v.set(M2.genSw(1), -1);
    r.step(0.3);
    v.set(M2.genSw(1), 1);
    r.step(2);
    expect(v.get('cas.gen_off_l')).toBe(0);
  }, 120000);

  it('BATTERY EMER feeds only the emergency bus and raises EMER BUS ON BATT', () => {
    const r = makeCockpitRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.battSw, -1);
    v.set(M2.avionicsSw, 1);
    r.step(2);
    expect(v.get('elec.emer_powered')).toBe(1);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(v.get('elec.l_main_powered')).toBe(0);
    expect(v.get('elec.avn1_powered')).toBe(1); // PFD 1 / GTC 1 side from the emergency bus
    expect(v.get('elec.avn2_powered')).toBe(0);
    expect(v.get('cas.emer_bus')).toBe(1);
    // 110 V outlet: the inverter is on the R XFEED bus, dead in EMER (CAE: "will not function with the battery switch in EMER").
    click(r.control('m2.side.ac_outlet'));
    r.step(0.5);
    expect(v.get(M2_SIDE_VARS.outletV)).toBe(0);
  });
});

describe('Citation M2 sidewall / overhead services', () => {
  it('crew oxygen: mask donned flows oxygen (flow indicator, bottle pressure drops); PRESS TO TEST; stowing stops the flow', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.step(1);
    expect(v.get('oxy.crew1_flowing')).toBe(0);
    const p0 = v.get('oxy.main_psi');
    click(r.control('m2.ovhd.mask1'));
    expect(v.get(M2.maskOn(1))).toBe(1);
    // N (diluter demand) at a sea-level cabin: the regulator adds no oxygen (OxygenSystem DILUTER_O2_FRACTION 0 at SL).
    r.step(2);
    expect(v.get('oxy.crew1_flowing')).toBe(0);
    // 100 %: oxygen flows, the flow indicator lights and the bottle pressure drops.
    click(r.control('m2.ovhd.mask1_mode')); // one detent clockwise: N -> 100%
    expect(v.get(M2.maskMode(1))).toBe(1);
    r.step(30);
    expect(v.get('oxy.crew1_flowing')).toBe(1);
    expect(v.get('oxy.main_psi')).toBeLessThan(p0);
    const flow100 = v.get('oxy.crew1_flow_lpm');
    // EMER (positive pressure) adds flow.
    click(r.control('m2.ovhd.mask1_mode'));
    expect(v.get(M2.maskMode(1))).toBe(2);
    r.step(1);
    expect(v.get('oxy.crew1_flow_lpm')).toBeGreaterThan(flow100);
    click(r.control('m2.ovhd.mask1'));
    r.step(1);
    expect(v.get(M2.maskOn(1))).toBe(0);
    expect(v.get('oxy.crew1_flowing')).toBe(0);
    // PRESS TO TEST (momentary) on the copilot's stowage: flow while held.
    const t = r.control('m2.ovhd.mask2_test');
    const p = pointer(t.hitTargets[0]);
    t.onPointerDown?.(p);
    r.step(0.5);
    expect(v.get('ac.m2.mask2_test')).toBe(1);
    expect(v.get('oxy.crew2_flowing')).toBe(1);
    t.onPointerUp?.(p);
    r.step(0.5);
    expect(v.get('oxy.crew2_flowing')).toBe(0);
  });

  it('110 V outlet: plugging in turns the inverter on (load current and the outlet LED)', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.step(1);
    expect(v.get('elec.inverter_powered')).toBe(0);
    expect(v.get(M2_SIDE_VARS.outletV)).toBe(0);
    click(r.control('m2.side.ac_outlet'));
    r.step(0.5);
    expect(v.get('elec.inverter_powered')).toBe(1);
    expect(v.get('elec.inverter_amps')).toBeGreaterThan(1);
    expect(v.get(M2_SIDE_VARS.outletV)).toBeGreaterThan(100);
    // INVERTER breaker out: no outlet power.
    click(r.control('m2.cb.inverter'));
    r.step(0.5);
    expect(v.get(M2_SIDE_VARS.outletV)).toBe(0);
  });

  it('emergency lighting battery pack: lit by a 5 g inertia load, runs down in ~10 min', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.step(1);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(0);
    // Inject a crash-type deceleration for one services update.
    const svc = r.ck.systems.find((s) => s.name === 'm2.cabin_services')!;
    v.set(FDM.nx, -6);
    svc.update(1 / 60);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(1);
    v.set(FDM.nx, 0);
    for (let i = 0; i < 60 * 590; i++) svc.update(1 / 60);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(1);
    for (let i = 0; i < 60 * 20; i++) svc.update(1 / 60);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(0);
  });

  it('magnetic compass card follows the magnetic heading (lag, then settles)', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    r.step(8);
    const card = r.ck.build.root.getObjectByName('m2.compass_card')!;
    const deg = ((card.rotation.y * 180) / Math.PI + 360) % 360;
    const hdg = r.vars.get(FDM.headingMag);
    const d = ((deg - hdg + 540) % 360) - 180;
    expect(Math.abs(d)).toBeLessThan(1.5);
  });
});
