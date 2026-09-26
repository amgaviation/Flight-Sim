/**
 * (g) Failures produce the right CAS messages and system reactions (LUC
 * electrical / hydraulics / fire, LIM).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted } from './helpers';
import { G650_VARS as V } from '../../../src/aircraft/g650/vars';

const cruise = { weightLb: 70000, fuelLb: 16000, air: { altFtMsl: 35000, iasKt: 270 } };

describe('G650 failures -> CAS', () => {
  it('L IDG failure: "L Generator Fail", L BUS TIE closes, L MAIN AC powered from the R IDG; then APU GEN takes the tie bus', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.l_btb_closed')).toBe(0);
    r.sys.failures.trigger('elec.idg1');
    r.run(6);
    expect(v.get('elec.idg1_online')).toBe(0);
    expect(posted(r)).toContain('caution:L Generator Fail');
    expect(v.get('alert.master_caution')).toBe(1);
    // LUC: the bus-tie relays let the operative side power the inoperative side.
    expect(v.get('elec.l_btb_closed')).toBe(1);
    expect(v.get('elec.r_btb_closed')).toBe(1);
    expect(v.get('elec.l_main_ac_powered')).toBe(1);
    expect(v.get('elec.l_main_dc_powered')).toBe(1);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(26);
    expect(posted(r)).not.toContain('caution:L AC Power Fail');
    // In flight the galley / cabin 60 Hz loads are shed on a single source (LUC).
    expect(v.get('elec.galley_powered')).toBe(0);
    r.events.emit('cas.ack_caution');
    r.run(1);
    expect(v.get('alert.master_caution')).toBe(0);
    // Crew starts the APU (in-flight start below 37,000 ft): APU GEN on the tie bus, R BUS TIE opens again.
    v.set(V.apuMaster, 1);
    r.run(14);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(70, () => v.get('elec.apu_gen_online') === 1 && v.get('elec.r_btb_closed') === 0);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    expect(v.get('elec.l_btb_closed')).toBe(1);
    expect(v.get('elec.r_btb_closed')).toBe(0);
    // L BUS TIE to ISLN isolates the left main AC bus: "L AC Power Fail".
    v.set(V.busTieL, 0);
    r.run(3);
    expect(v.get('elec.l_main_ac_powered')).toBe(0);
    expect(posted(r)).toContain('caution:L AC Power Fail');
    // The AUX TRU substitutes for the dead L ESS TRU: L ESS DC stays powered (LUC).
    expect(v.get(V.auxSubst)).toBe(1);
    expect(v.get('elec.l_ess_dc_powered')).toBe(1);
  });

  it('dual generator loss: RAT deployed above 180 KCAS powers EMER AC and both ESS DC buses', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('elec.idg1');
    r.sys.failures.trigger('elec.idg2');
    r.run(4);
    expect(posted(r)).toContain('caution:L-R Generator Fail');
    expect(posted(r)).toContain('caution:L-R AC Power Fail');
    expect(v.get('elec.l_main_ac_powered')).toBe(0);
    // Batteries hold the ESS DC buses; the emergency batteries arm when ESS DC falls below 20 V (not yet).
    expect(v.get('elec.l_ess_dc_powered')).toBe(1);
    v.set(V.ratDeploy, 1);
    r.run(5);
    expect(v.get('elec.rat_online')).toBe(1);
    expect(posted(r)).toContain('caution:RAT Generator On');
    expect(v.get('elec.emer_ac_powered')).toBe(1);
    expect(v.get('elec.l_ess_ac_powered')).toBe(1);
    expect(v.get('elec.r_ess_ac_powered')).toBe(1);
    expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(26);
    expect(v.get('elec.l_main_dc_powered')).toBe(0);
    expect(v.get('elec.du1_powered')).toBe(1); // pilot PFD on L ESS DC
    expect(v.get('elec.du2_powered')).toBe(0); // MFDs shed with the MAIN DC buses
  });

  it('L hydraulic system loss: "L Hyd System Fail"; the PTU (ARM) takes over from the right system', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('hyd.edp_l');
    // With the PTU at OFF the left system decays and the caution posts.
    v.set(V.ptu, 0);
    r.run(40); // accumulator + line volume bleed down through the internal leakage
    expect(v.get('hyd.left_psi')).toBeLessThan(1500);
    expect(posted(r)).toContain('caution:L Hyd System Fail');
    expect(v.get('hyd.right_psi')).toBeGreaterThan(2800);
    expect(v.get('fbw.mode_code')).toBe(0); // the flight controls keep the R system and the EBHAs
    // PWR XFR UNIT ARM: automatic when L < 2,400 psi for 7 s (LUC).
    v.set(V.ptu, 1);
    r.run(15);
    expect(v.get('hyd.ptu_active')).toBe(1);
    expect(v.get('hyd.left_psi')).toBeGreaterThan(2400);
    expect(posted(r)).not.toContain('caution:L Hyd System Fail');
    expect(posted(r)).toContain('advisory:PTU Hyd On');
  });

  it('L+R engine-driven pump loss: "L-R Hyd System Fail"; the EBHAs keep the surfaces moving', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('hyd.edp_l');
    r.sys.failures.trigger('hyd.edp_r');
    r.run(60);
    expect(v.get('hyd.left_psi')).toBeLessThan(1500);
    expect(v.get('hyd.right_psi')).toBeLessThan(1500);
    expect(posted(r)).toContain('caution:L-R Hyd System Fail');
    const a0 = v.get('surf.aileron');
    r.sys.afcs.disengage(false);
    v.set('input.roll', 0.5);
    r.run(1);
    v.set('input.roll', 0);
    expect(Math.abs(v.get('surf.aileron') - a0)).toBeGreaterThan(0.05);
  });

  it('L engine fire: "L Engine Fire" warning; fire handle shuts fuel / hydraulics / bleed; shot 1 then shot 2', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('fire.eng1');
    r.run(3);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(posted(r)).toContain('warning:L Engine Fire');
    expect(v.get('alert.master_warning')).toBe(1);
    r.events.emit('cas.ack_warning');
    r.run(0.5);
    expect(v.get('alert.master_warning')).toBe(0);
    // Memory items: L thrust lever IDLE, L FUEL CONTROL OFF, pull the L fire handle, rotate outward (shot 1).
    v.set(V.tla(1), 0);
    v.set(V.fuelCtlL, 0);
    v.set(V.fireHandleL, 1);
    r.run(1);
    expect(v.get('fuel.eng1_on')).toBe(0);
    expect(v.get('pneu.bleed_l_valve_open')).toBe(0);
    expect(v.get('hyd.edp_l_on')).toBe(0);
    expect(posted(r)).toContain('status:L Fire Handle Pulled');
    v.set(V.fireDischL, 1);
    r.run(0.5);
    v.set(V.fireDischL, 0);
    r.run(30);
    if (v.get('fire.eng1_warn')) {
      v.set(V.fireDischL, -1); // shot 2: LEFT bottle
      r.run(0.5);
      v.set(V.fireDischL, 0);
      r.run(10);
    }
    expect(v.get('fire.bottle_r_discharged')).toBe(1);
    expect(posted(r)).toContain('caution:R Fire Bottle Discharge');
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('eng2.running')).toBe(1);
    // FUEL CONTROL OFF: a shutdown, not an "Engine Fail".
    expect(posted(r)).not.toContain('warning:L Engine Fail');
    // The R IDG now carries both main AC buses.
    expect(v.get('elec.l_main_ac_powered')).toBe(1);
  });

  it('R engine flameout (fuel starvation): "R Engine Fail" warning with FUEL CONTROL at RUN', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    r.sys.fuel.setTankKg('right', 0);
    r.run(20);
    expect(v.get('eng2.running')).toBe(0);
    expect(posted(r)).toContain('warning:R Engine Fail');
    expect(posted(r)).toContain('caution:R Fuel Level Low');
    v.set(V.fuelCtlR, 0);
    r.run(3);
    expect(posted(r)).not.toContain('warning:R Engine Fail');
  });

  it('cabin decompression: "Cabin Pressure Low" warning, passenger oxygen deploys (AUTO)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(4000); // 3,290 ft at FL410 (AIN)
    r.sys.failures.trigger('press.decompression');
    r.run(60);
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(15000);
    expect(posted(r)).toContain('warning:Cabin Pressure Low');
    expect(v.get('press.pax_masks')).toBe(1);
    expect(posted(r)).toContain('caution:Passenger Oxygen On');
  });

  it('FCC data loss -> "FCC Alternate Mode" latched; FLT CTRL RESET returns to NORMAL once the data are valid', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(3);
    r.sys.failures.trigger('fbw.adc_data');
    r.run(2);
    expect(v.get('fbw.mode_code')).toBe(1);
    expect(posted(r)).toContain('caution:FCC Alternate Mode');
    expect(posted(r)).toContain('caution:Stall Protection Unavail');
    expect(v.get('ap.engaged')).toBe(0); // no autopilot outside Normal law (LUC)
    r.sys.failures.clear('fbw.adc_data');
    r.run(2);
    expect(v.get('fbw.mode_code')).toBe(1); // still latched
    v.set(V.fltCtrlReset, 1);
    r.run(0.5);
    v.set(V.fltCtrlReset, 0);
    r.run(2);
    expect(v.get('fbw.mode_code')).toBe(0);
    expect(posted(r)).not.toContain('caution:FCC Alternate Mode');
  });
});
