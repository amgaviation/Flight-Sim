/**
 * (g) Key failures produce the right CAS messages and system reactions.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts } from './helpers';
import { G800_VARS as V } from '../../../src/aircraft/g800/vars';

describe('G800 failures -> CAS', () => {
  it('IDG failure: "L Generator Off", AC tie closes, L MAIN AC stays powered from the right IDG', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 254 } });
    const v = r.vars;
    r.run(5);
    expect(casTexts(r, 'caution')).toEqual([]);
    r.sys.failures.trigger('elec.idg1');
    r.run(6);
    expect(casTexts(r, 'caution')).toContain('L Generator Off');
    expect(v.get('alert.master_caution')).toBe(1);
    expect(v.get('elec.ac_tie_closed')).toBe(1);
    expect(v.get('elec.l_main_ac_powered')).toBe(1);
    expect(v.get('elec.l_main_dc_v')).toBeGreaterThan(26);
    // Galley is shed in flight with a single generator (GVI load shed, EST rule).
    expect(v.get('elec.galley_powered')).toBe(0);
    r.events.emit('cas.ack');
    r.run(0.2);
    expect(v.get('alert.master_caution')).toBe(0);
  });

  it('dual IDG failure with the APU off: RAT deployment powers the essential buses', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('elec.idg1');
    r.sys.failures.trigger('elec.idg2');
    r.run(12);
    expect(v.get('elec.l_main_ac_powered')).toBe(0);
    expect(casTexts(r, 'caution')).toContain('R Generator Off');
    expect(casTexts(r, 'caution')).toContain('L Main AC Bus Fail');
    expect(casTexts(r, 'caution')).toContain('L Main Batt Discharge'); // SCQ: batteries carry the essential buses
    expect(v.get('eng1.running')).toBe(1); // boost pumps on the essential buses keep the engines fed
    v.set(V.ratDeploy, 1); // RAT manual deployment
    r.run(5);
    expect(v.get('elec.rat_online')).toBe(1);
    expect(v.get('elec.emer_ac_powered')).toBe(1);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(25);
    expect(v.get('elec.r_ess_dc_v')).toBeGreaterThan(25);
    expect(v.get('display.epic.du1.power')).toBe(0); // no suite in this rig; the DU1 load is the ESS bus check below
    expect(v.get('elec.du1_powered')).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('RAT Deployed');
  });

  it('left hydraulic loss: "L Hydraulic Pressure Low"; the PTU (ARM) restores left pressure from the right system', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 20000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('hyd.edp_l');
    r.sys.failures.trigger('hyd.left.leak');
    // PTU in ARM runs automatically once the left system drops below 1,800 psi.
    let minPsi = 3000;
    let ptu = false;
    r.run(60, () => {
      minPsi = Math.min(minPsi, v.get('hyd.left_psi'));
      ptu = ptu || v.get('hyd.ptu_active') !== 0;
    });
    expect(minPsi).toBeLessThan(1800);
    expect(ptu).toBe(true);
    // Now lose the right system too: "R Hydraulic Pressure Low"; the PTU has no source, so the AUX pump (ARM)
    // takes over the left system ("Aux Hydraulic On").
    r.sys.failures.trigger('hyd.right.leak');
    r.sys.failures.trigger('hyd.edp_r');
    r.run(20);
    expect(casTexts(r, 'caution')).toContain('R Hydraulic Pressure Low');
    expect(casTexts(r, 'advisory')).toContain('Aux Hydraulic On');
    expect(v.get('hyd.left_psi')).toBeGreaterThan(1500);
    // With the AUX pump failed too, the left system also goes low.
    r.sys.failures.trigger('hyd.aux');
    r.run(30);
    expect(casTexts(r, 'caution')).toContain('L Hydraulic Pressure Low');
    // FBW surfaces still move on the EBHAs (electric backup).
    expect(v.get('fbw.mode_code')).toBe(0);
  });

  it('engine fire: "L Engine Fire" warning; handle pull shuts fuel/bleed/hydraulics; SHOT 1 discharges the right bottle', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 20000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('fire.eng1');
    r.run(2);
    expect(casTexts(r, 'warning')).toContain('L Engine Fire');
    expect(v.get('alert.master_warning')).toBe(1);
    expect(v.get('ac.g800.fire_l_unlock')).toBe(1);
    // Crew: L power lever idle, L RUN/STOP to STOP, pull the L fire handle, rotate to SHOT 1.
    v.set(V.tla(1), 0);
    v.set(V.runL, 0);
    v.set(V.fireHandleL, 1);
    r.run(1);
    expect(v.get('eng1.fuel_on')).toBe(0);
    expect(v.get('pneu.bleed_l_valve_open')).toBe(0);
    v.set(V.fireRotL, -1);
    r.run(0.5);
    v.set(V.fireRotL, 0);
    r.run(5);
    expect(v.get('fire.bottle_r_discharged')).toBe(1);
    expect(casTexts(r, 'caution')).toContain('R Fire Bottle Discharge');
    // Engine spools down; the NORMAL-law yaw channel (and ELDAC at low speed) counters the asymmetric thrust.
    r.run(20);
    expect(v.get('eng1.running')).toBe(0);
    expect(Math.abs(v.get('fdm.bank_deg'))).toBeLessThan(5);
    expect(Math.abs(v.get('fdm.beta_deg'))).toBeLessThan(3);
  });

  it('ADC 1 failure: FCC reverts to ALTERNATE (latched until FLT CTRL RESET), stall protection unavailable', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('adc1');
    r.run(2);
    expect(v.get('fbw.mode_code')).toBe(1);
    expect(casTexts(r, 'caution')).toContain('FCC Alternate Mode');
    expect(casTexts(r, 'caution')).toContain('Stall Protection Unavail');
    r.sys.failures.clear('adc1');
    r.run(5);
    expect(v.get('fbw.mode_code')).toBe(1); // latched
    v.set(V.fltCtrlReset, 1);
    r.run(0.3);
    v.set(V.fltCtrlReset, 0);
    r.run(1);
    expect(v.get('fbw.mode_code')).toBe(0);
  });

  it('decompression: "Cabin Pressure Low" warning above 8,000 ft cabin; passenger masks deploy at 14,000 ft', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 254 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('press.decompression');
    r.run(30);
    expect(casTexts(r, 'warning')).toContain('Cabin Pressure Low');
    expect(v.get('press.pax_masks')).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('Passenger Oxygen On');
  });
});
