/**
 * Cessna 172S G1000 NXi / GFC 700: state presets, circuit-breaker load shedding, GFC 700 yoke
 * switches (MET, A/P TRIM DISC), ELT remote switch, ignition key, display cooling advisories and the
 * standby attitude GYRO flag, on the full systems list (headless G1000 suite).
 */
import { describe, expect, it } from 'vitest';
import { makeG1k, cas, hold } from './helpers';
import { C172, ELT_SW } from '../../../src/aircraft/c172s-common/vars';
import { C172G, C172G_FAIL, ELT_ROCKER, MET } from '../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS } from '../../../src/avionics/garmin-g1000/vars';

const CRUISE = { altFtMsl: 6000, iasKt: 105 } as const;
const up = (r: ReturnType<typeof makeG1k>, u: string) => r.vars.get(G1K.unitUp(u));

describe('C172S G1000 NXi states', () => {
  it('cold & dark: engine stopped, displays off, key out, control lock in', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(3);
    expect(r.vars.get('eng1.rpm')).toBe(0);
    expect(r.vars.get(G1K.unitPowered('pfd'))).toBe(0);
    expect(r.vars.get(C172.keyIn)).toBe(0);
    expect(r.vars.get(C172.controlLock)).toBe(1);
  });

  it('ready to taxi: engine idling, G1000 up, AHRS aligned, main bus charging, no cautions', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(5);
    expect(r.vars.get('eng1.rpm')).toBeGreaterThan(800);
    expect(up(r, 'pfd')).toBe(1);
    expect(up(r, 'mfd')).toBe(1);
    expect(up(r, 'servos')).toBe(1);
    expect(r.vars.get('ahrs1.valid')).toBe(1);
    expect(r.vars.get(C172.mBusV)).toBeGreaterThan(27.5);
    expect(cas(r).filter((t) => !t.includes('COOLING'))).toEqual([]);
  });

  it('cruise and approach presets fly level at their speeds', () => {
    const c = makeG1k({ state: 'cruise', air: CRUISE });
    c.run(10);
    expect(c.vars.get('adc1.ias_kt')).toBeGreaterThan(90);
    expect(Math.abs(c.vars.get('fdm.alt_msl_ft') - 6000)).toBeLessThan(250);
    const a = makeG1k({ state: 'approach', air: { altFtMsl: 2000, iasKt: 80 } });
    a.run(10);
    expect(a.vars.get('adc1.ias_kt')).toBeGreaterThan(65);
    expect(a.vars.get('ap.engaged')).toBe(0);
  });
});

describe('C172S G1000 NXi circuit breakers remove their loads (POH Fig 7-7)', () => {
  it('MFD breaker: MFD unpowered; AUTOPILOT breaker: servos down, AP will not engage', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    expect(r.vars.get(G1K.unitPowered('mfd'))).toBe(1);
    r.vars.set('cb.mfd', 0);
    r.run(1);
    expect(r.vars.get('elec.mfd_powered')).toBe(0);
    expect(r.vars.get(G1K.unitPowered('mfd'))).toBe(0);
    r.vars.set('cb.autopilot', 0);
    r.run(1);
    expect(up(r, 'servos')).toBe(0);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(0);
    // Reset: the servos run their preflight test again, then the AP engages.
    r.vars.set('cb.autopilot', 1);
    r.run(15);
    expect(up(r, 'servos')).toBe(1);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(1);
  });

  it('PFD is dual-fed (ESS BUS and AVN BUS 1): one breaker keeps it on, both remove it', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set('cb.pfd_ess', 0);
    r.run(1);
    expect(r.vars.get(G1K.unitPowered('pfd'))).toBe(1);
    r.vars.set('cb.pfd_avn1', 0);
    r.run(1);
    expect(r.vars.get(G1K.unitPowered('pfd'))).toBe(0);
  });

  it('both ADC/AHRS breakers: attitude invalid (POH Sec 3 "Red X")', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set('cb.adc_ahrs_ess', 0);
    r.vars.set('cb.adc_ahrs_avn1', 0);
    r.run(2);
    expect(r.vars.get('elec.adc_ahrs_powered')).toBe(0);
    expect(r.vars.get('ahrs1.valid')).toBe(0);
  });
});

describe('GFC 700 yoke switches (POH Fig 7-2 Detail A, Sec 3 "Autopilot or electric trim failure")', () => {
  // The GDC 74 air data computer runs its 3 s power-up self test after a state change (the AP needs valid air data).
  it('MET trims at the electric rate and disconnects an engaged autopilot', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(1);
    const t0 = r.vars.get(C172.trimPosition);
    hold(r, C172G.met, MET.noseUp, 1, MET.off);
    expect(r.vars.get('ap.engaged')).toBe(0);
    const dt = r.vars.get(C172.trimPosition) - t0;
    // PG: MET moves the trim at the GSA 81 manual rate (data.ts TRIM_RATES.electric = 0.08 units/s).
    expect(dt).toBeGreaterThan(0.04);
    expect(dt).toBeLessThan(0.12);
  });

  it('A/P TRIM DISC held interrupts all electric trim; pressing it disconnects the AP', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(1);
    r.vars.set(C172G.apDisc, 1);
    r.events.emit('ap.disc');
    r.run(0.2);
    expect(r.vars.get('ap.engaged')).toBe(0);
    const t0 = r.vars.get(C172.trimPosition);
    hold(r, C172G.met, MET.noseDn, 1, MET.off);
    expect(Math.abs(r.vars.get(C172.trimPosition) - t0)).toBeLessThan(1e-3);
    r.vars.set(C172G.apDisc, 0);
    hold(r, C172G.met, MET.noseDn, 1, MET.off);
    expect(r.vars.get(C172.trimPosition)).toBeLessThan(t0 - 0.03);
  });

  it('AUTOPILOT breaker pulled: no electric trim, the manual wheel still works', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set('cb.autopilot', 0);
    r.run(0.5);
    const t0 = r.vars.get(C172.trimPosition);
    hold(r, C172G.met, MET.noseUp, 1, MET.off);
    expect(Math.abs(r.vars.get(C172.trimPosition) - t0)).toBeLessThan(1e-3);
  });
});

describe('C172S G1000 NXi variant hardware', () => {
  it('ELT remote switch: ON transmits, ON -> ARM resets (TEST/RESET)', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(1);
    r.vars.set(C172G.eltRocker, ELT_ROCKER.on);
    r.run(0.5);
    expect(r.vars.get(C172.elt)).toBe(ELT_SW.on);
    r.vars.set(C172G.eltRocker, ELT_ROCKER.arm);
    r.run(0.3);
    expect(r.vars.get(C172.elt)).toBe(ELT_SW.reset);
    r.run(2);
    expect(r.vars.get(C172.elt)).toBe(ELT_SW.arm);
  });

  it('forward avionics fan failure: PFD1 / MFD1 COOLING advisories after a few minutes', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    expect(cas(r).some((t) => t.includes('COOLING'))).toBe(false);
    r.vars.set(`fail.${C172G_FAIL.fwdFan}`, 1);
    r.vars.set(`fail.${C172G_FAIL.aftFan}`, 1);
    r.run(600);
    expect(r.vars.get(C172G.fwdFan)).toBe(0);
    expect(cas(r)).toContain('PFD1 COOLING');
  });

  it('standby attitude GYRO flag appears with low vacuum (engine stopped)', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(2);
    expect(r.vars.get(C172G.gyroFlag)).toBeLessThan(0.05);
    r.vars.set(C172.mixture, 0);
    r.run(40);
    expect(r.vars.get('eng1.rpm')).toBeLessThan(100);
    expect(r.vars.get(C172G.gyroFlag)).toBeGreaterThan(0.9);
  });

  it('extinguisher: squeezing empties the bottle in ~8 s (POH Sec 7)', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(0.5);
    expect(r.vars.get(C172G.extPsi)).toBeCloseTo(125, 0);
    hold(r, C172G.extTrigger, 1, 4, 0);
    expect(r.vars.get(C172G.extPsi)).toBeGreaterThan(40);
    hold(r, C172G.extTrigger, 1, 5, 0);
    expect(r.vars.get(C172G.extPsi)).toBe(0);
    expect(r.vars.get(C172.extinguisher)).toBe(1);
  });
});
