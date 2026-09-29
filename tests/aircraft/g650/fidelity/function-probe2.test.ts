/**
 * FUNCTION fidelity probe, round 2 (read-only audit helper). Prints what the G650 model does for behaviours
 * the LUC G650 system notes (code450.com/g650) describe, so the audit can compare. No assertion encodes the
 * real aircraft.
 *   npx vitest run tests/aircraft/g650/fidelity/function-probe2.test.ts --silent=false
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted, type Rig } from '../helpers';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';

const cruise = { weightLb: 70000, fuelLb: 16000, air: { altFtMsl: 35000, iasKt: 270 } };
const out: string[] = [];
const log = (s: string) => out.push(s);
const g = (r: Rig, n: string) => r.vars.get(n);
const cas = (r: Rig, f?: string) => posted(r).filter((m) => !f || m.toLowerCase().includes(f.toLowerCase())).join('|');

describe('G650 function probe 2', () => {
  it('single fire loop fault / APU fire auto shutdown', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.sys.failures.trigger('fire.eng1.loopa');
    r.run(2);
    log(`[L loop A failed] eng1_fault=${g(r, 'fire.eng1_fault')} loopa_fault=${g(r, 'fire.eng1_loopa_fault')} CAS=${cas(r, 'fire')}`);
    r.sys.failures.clear('fire.eng1.loopa');
    r.vars.set('fail.fire.eng1.loopa', 0);
    // APU running? start it
    r.vars.set(V.apuMaster, 1);
    r.run(14);
    r.vars.set(V.apuStart, 1);
    r.run(0.5);
    r.vars.set(V.apuStart, 0);
    r.run(60, () => g(r, 'apu.avail') === 1);
    r.vars.set(V.apuGen, 1);
    r.run(4);
    const genBefore = g(r, 'elec.apu_gen_online');
    r.sys.failures.trigger('fire.apu');
    r.run(3);
    log(`[APU fire] avail=${g(r, 'apu.avail')} state=${g(r, 'apu.state')} n=${g(r, 'apu.n_pct').toFixed(0)} gen ${genBefore}->${g(r, 'elec.apu_gen_online')} fire_shutdown=${g(r, 'apu.fire_shutdown')} bell=${g(r, 'fire.bell')} CAS=${cas(r, 'fire')}`);
    expect(true).toBe(true);
  });

  it('APU MASTER vs STOP; start with R battery OFF; APU start at FL400', () => {
    const r = makeRig('cold_dark');
    r.run(1);
    r.vars.set(V.battL, 1);
    r.vars.set(V.battR, 0);
    r.vars.set(V.apuMaster, 1);
    r.run(14);
    r.vars.set(V.apuStart, 1);
    r.run(0.5);
    r.vars.set(V.apuStart, 0);
    r.run(60, () => g(r, 'apu.avail') === 1);
    log(`[APU start, R BATT OFF] avail=${g(r, 'apu.avail')} state=${g(r, 'apu.state')}`);
    const f = makeRig('cruise', { ...cruise, air: { altFtMsl: 43000, iasKt: 250 } });
    f.run(2);
    f.vars.set(V.apuMaster, 1);
    f.run(14);
    f.vars.set(V.apuStart, 1);
    f.run(0.5);
    f.vars.set(V.apuStart, 0);
    f.run(70, () => g(f, 'apu.avail') === 1);
    log(`[APU start FL430] avail=${g(f, 'apu.avail')} state=${g(f, 'apu.state')} fault=${g(f, 'apu.fault')}`);
    expect(true).toBe(true);
  });

  it('CAS levels: generator fail, RAT, probe heat OFF, GEN OFF', () => {
    const r = makeRig('ready_to_taxi');
    r.run(3);
    for (const n of [1, 2, 3, 4] as const) r.vars.set(V.probe(n), 0);
    r.run(10);
    log(`[probe heaters OFF, ground, engines running] fbw=${g(r, 'fbw.mode_code')} CAS=${cas(r)}`);
    for (const n of [1, 2, 3, 4] as const) r.vars.set(V.probe(n), 1);
    r.run(2);
    r.vars.set(V.emerPwr, 1);
    r.sys.failures.trigger('elec.idg1');
    r.run(3);
    log(`[IDG1 fail on ground] ebatt=${g(r, V.ebattOn)} CAS=${cas(r)}`);
    expect(true).toBe(true);
  });

  it('toe brakes with BCU A+B pulled; park brake handle 30 %; autobrake RTO', () => {
    const r = makeRig('ready_to_taxi');
    r.run(3);
    r.vars.set(V.parkBrake, 0.3);
    r.run(1);
    log(`[PARK handle 0.3] parking_set=${g(r, 'brakes.parking_set')} brake_l=${g(r, 'gear.brake_left').toFixed(2)} CAS=${cas(r, 'brake')}`);
    r.vars.set(V.parkBrake, 0);
    r.run(1);
    log(`[park released] accum=${g(r, 'brakes.accum_psi').toFixed(0)}`);
    expect(true).toBe(true);
  });

  it('gear horn at 400 ft RA idle flaps 20; spoilers panels with R hyd lost', () => {
    const r = makeRig('cruise', { weightLb: 65000, fuelLb: 8000, air: { altFtMsl: 450, iasKt: 160 } });
    r.run(1);
    r.vars.set(V.flapLever, 2);
    r.vars.set(V.tla(1), 0);
    r.vars.set(V.tla(2), 0);
    r.vars.set(V.gearHandle, 0);
    r.run(3);
    log(`[400 ft RA, gear up, idle, flaps ${g(r, 'surf.flaps_deg').toFixed(0)}] ra=${g(r, 'ra1.alt_ft').toFixed(0)} horn=${g(r, 'gear.horn')} caws=${cas(r, 'gear')}`);
    expect(true).toBe(true);
  });

  it('FCC ALTERNATE: RESET; AP engage; yoke trim; DIRECT CAS', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    r.sys.failures.trigger('fbw.adc_data');
    r.run(2);
    log(`[ADC data fail] mode=${g(r, 'fbw.mode_code')} CAS=${cas(r)}`);
    r.sys.failures.clear('fbw.adc_data');
    r.vars.set('fail.fbw.adc_data', 0);
    r.vars.set(V.fltCtrlReset, 1);
    r.run(0.3);
    r.vars.set(V.fltCtrlReset, 0);
    r.run(2);
    log(`[after FLT CTRL RESET] mode=${g(r, 'fbw.mode_code')} CAS=${cas(r, 'fcc')}`);
    expect(true).toBe(true);
  });

  it('bleed: APU bleed on ground feeds which duct; START MASTER packs', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.vars.set(V.bleedL, 0);
    r.vars.set(V.bleedR, 0);
    r.vars.set(V.apuMaster, 1);
    r.run(14);
    r.vars.set(V.apuStart, 1);
    r.run(0.5);
    r.vars.set(V.apuStart, 0);
    r.run(60, () => g(r, 'apu.avail') === 1);
    r.run(65);
    r.vars.set(V.bleedApu, 1);
    r.vars.set(V.isolation, 0);
    r.run(10);
    log(`[APU bleed, ISOLATION CLOSED] l_duct=${g(r, 'pneu.l_duct_psi').toFixed(1)} r_duct=${g(r, 'pneu.r_duct_psi').toFixed(1)}`);
    expect(true).toBe(true);
  });

  it('engine fail in flight: E-BATT with ARM, AUX pump auto, CAS', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    r.vars.set(V.emerPwr, 1);
    r.vars.set(V.fuelCtlL, 0);
    r.run(20);
    log(`[L FUEL CONTROL OFF in flight] ebatt=${g(r, V.ebattOn)} CAS=${cas(r)}`);
    r.vars.set(V.fuelCtlL, 1);
    const r2 = makeRig('cruise', cruise);
    r2.run(3);
    r2.sys.failures.trigger('eng1.flameout');
    r2.run(20);
    log(`[L flameout] eng1.running=${g(r2, 'eng1.running')} engFail=${g(r2, V.engFail(1))} CAS=${cas(r2)}`);
    expect(true).toBe(true);
  });

  it('prints', () => {
    // eslint-disable-next-line no-console
    console.log(`\n=== G650 FUNCTION PROBE 2 ===\n${out.join('\n')}\n`);
    expect(out.length).toBeGreaterThan(0);
  });
});
