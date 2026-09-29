/**
 * FUNCTION fidelity probe, round 3 (read-only audit helper; prints only).
 *   npx vitest run tests/aircraft/g650/fidelity/function-probe3.test.ts --silent=false
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted, type Rig } from '../helpers';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';

const cruise = { weightLb: 70000, fuelLb: 16000, air: { altFtMsl: 35000, iasKt: 270 } };
const out: string[] = [];
const log = (s: string) => out.push(s);
const g = (r: Rig, n: string) => r.vars.get(n);
const cas = (r: Rig) => posted(r).join('|');

describe('G650 function probe 3', () => {
  it('failure list (engine / fire / brakes ids)', () => {
    const r = makeRig('cruise', cruise);
    log(`[failures] ${r.sys.failures.list().map((f) => f.id).filter((id) => /eng|fire|brake|hyd|irs|adc|ahrs|fbw|steer|flap|gear/.test(id)).join(', ')}`);
    expect(true).toBe(true);
  });

  it('L FUEL CONTROL OFF in flight: engine, CAS, hydraulics, EBATT (EMER PWR ARM)', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    r.vars.set(V.emerPwr, 1);
    r.vars.set(V.fuelCtlL, 0);
    r.run(30);
    log(`[L FUEL CTL OFF +30s] running=${g(r, 'eng1.running')} n2=${g(r, 'eng1.n2_pct').toFixed(0)} idg1=${g(r, 'elec.idg1_online')} lpsi=${g(r, 'hyd.left_psi').toFixed(0)} ptu=${g(r, 'hyd.ptu_active')} ebatt=${g(r, V.ebattOn)} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('RAT only: modes, AP, A/T, EBATT with ARM', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    r.run(3);
    r.vars.set(V.emerPwr, 1);
    r.vars.set(V.apuGen, 0);
    r.sys.failures.trigger('elec.idg1');
    r.sys.failures.trigger('elec.idg2');
    r.run(3);
    log(`[dual IDG loss, before RAT] ebatt=${g(r, V.ebattOn)} l_ess_v=${g(r, 'elec.l_ess_dc_v').toFixed(1)} du=${[1, 2, 3, 4].map((n) => g(r, `elec.du${n}_powered`)).join(',')} CAS=${cas(r)}`);
    r.vars.set(V.ratDeploy, 1);
    r.run(40);
    log(`[RAT on line] adc1-3=${g(r, 'elec.adc1_powered')},${g(r, 'elec.adc2_powered')},${g(r, 'elec.adc3_powered')} ap_power=${g(r, 'elec.afcs1_powered')} fbw=${g(r, 'fbw.mode_code')} wshld_l=${g(r, 'elec.wshld_l_powered')} probe1..4=${[1, 2, 3, 4].map((n) => g(r, `elec.probe${n}_powered`)).join(',')} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('reversers in flight / on ground single engine; A/T disc aural', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    r.vars.set(V.tla(1), -0.5);
    r.run(3);
    log(`[reverse selected in flight] rev1=${g(r, 'eng1.reverser_pos').toFixed(2)} n1=${g(r, 'eng1.n1_pct').toFixed(0)}`);
    expect(true).toBe(true);
  });

  it('speed brake with flaps 39 in flight; gear down speed brake', () => {
    const r = makeRig('cruise', { weightLb: 65000, fuelLb: 8000, air: { altFtMsl: 3000, iasKt: 170 } });
    r.run(1);
    r.vars.set(V.gearHandle, 1);
    r.run(10);
    r.vars.set(V.speedbrake, 1);
    r.run(3);
    log(`[gear down + speed brake] sb_ext=${g(r, 'spoilers.sb_ext').toFixed(2)} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('takeoff config: flaps 0, TO thrust on ground', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.vars.set(V.parkBrake, 0);
    r.vars.set(V.flapLever, 0);
    r.run(25);
    r.vars.set(V.tla(1), 1);
    r.vars.set(V.tla(2), 1);
    r.run(2);
    log(`[TO thrust flaps 0] tocw=${g(r, 'alert.to_config')} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('IRS OFF in flight; ADC fail single', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    r.vars.set(V.irsMode(1), 0);
    r.run(3);
    log(`[IRS 1 OFF in flight] ahrs1.valid=${g(r, 'ahrs1.valid')} fbw=${g(r, 'fbw.mode_code')} ap=${g(r, 'ap.engaged')} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('battery switch OFF on ground with APU gen (CAS)', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.vars.set(V.battL, 0);
    r.run(2);
    log(`[L BATT OFF, engines running] CAS=${cas(r)}`);
    r.vars.set(V.battL, 1);
    r.vars.set(V.ebhaBatt, 0);
    r.run(2);
    log(`[EBHA OFF] CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('prints', () => {
    // eslint-disable-next-line no-console
    console.log(`\n=== G650 FUNCTION PROBE 3 ===\n${out.join('\n')}\n`);
    expect(out.length).toBeGreaterThan(0);
  });
});
