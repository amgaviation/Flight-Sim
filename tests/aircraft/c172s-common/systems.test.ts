/**
 * Cessna 172S shared systems through the cockpit control vars (POH Sec 3 / 7):
 *  - fuel is burned from the tank(s) the selector feeds (LEFT / BOTH / RIGHT), the FUEL SHUTOFF
 *    valve starves the engine and a windmilling restart works once fuel is back;
 *  - L / R LOW FUEL annunciate below ~5 gal after the 60 s delay;
 *  - ALT half of the MASTER off: the battery carries the loads and discharges at its Ah rate,
 *    VOLTS (steam) / LOW VOLTS (G1000) annunciate;
 *  - G1000 with alternator and main battery exhausted: the standby battery takes over the
 *    Essential bus below 20 V on the main bus (PFD stays on, MFD goes dark, STBY BATT);
 *  - alternator regulator runaway: the ACU trips the alternator and pops ALT FLD / ALT FIELD,
 *    the POH reset does not hold with the failure present and works after it clears;
 *  - vacuum pump failure annunciation, alternate static source and pitot heat loads.
 */
import { describe, expect, it } from 'vitest';
import { ENG, FDM, FUEL } from '../../../src/core/vars';
import { ANN, C172, C172_FAIL, FUEL_SEL } from '../../../src/aircraft/c172s-common/vars';
import { ELEC_DATA, KG_PER_GAL } from '../../../src/aircraft/c172s-common/data';
import { make172 } from './helpers';

describe('Cessna 172S fuel system', () => {
  it('burns from the selected tank: LEFT, RIGHT, then BOTH', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(2);
    const burn = (sel: number, seconds: number) => {
      v.set(C172.fuelSelector, sel);
      const l0 = v.get(FUEL.tankKg(0));
      const r0 = v.get(FUEL.tankKg(1));
      let ffKg = 0;
      r.run(seconds, () => void (ffKg += (v.get('eng1.ff_pph') * 0.45359237) / 3600 / 60));
      return { dl: l0 - v.get(FUEL.tankKg(0)), dr: r0 - v.get(FUEL.tankKg(1)), ffKg };
    };
    const left = burn(FUEL_SEL.left, 120);
    expect(v.get(ENG.running(1))).toBe(1);
    expect(left.ffKg).toBeGreaterThan(0.5); // ~8 gph for 2 min: ~1.6 lb
    expect(left.dl).toBeCloseTo(left.ffKg, 1);
    expect(Math.abs(left.dr)).toBeLessThan(0.01);
    const right = burn(FUEL_SEL.right, 120);
    expect(right.dr).toBeCloseTo(right.ffKg, 1);
    expect(Math.abs(right.dl)).toBeLessThan(0.01);
    const both = burn(FUEL_SEL.both, 120);
    expect(both.dl + both.dr).toBeCloseTo(both.ffKg, 1);
    expect(both.dl / (both.dl + both.dr)).toBeGreaterThan(0.4);
    expect(both.dl / (both.dl + both.dr)).toBeLessThan(0.6);
    // Cruise fuel flow vs POH Fig 5-8 (6000 ft, ~2400 rpm: 8.2 GPH at recommended lean) within 15 %.
    const gph = both.ffKg / KG_PER_GAL / (120 / 3600);
    expect(gph).toBeGreaterThan(6.5);
    expect(gph).toBeLessThan(10);
  });

  it('FUEL SHUTOFF pulled stops the engine; pushed in, it restarts windmilling (POH Sec 3)', () => {
    const r = make172({ variant: 'g1000', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(2);
    v.set(C172.fuelShutoff, 0);
    const tStop = r.run(60, () => v.get(ENG.running(1)) < 0.5);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(tStop).toBeLessThan(30);
    // Best glide 68 KIAS keeps the propeller windmilling; fuel ON, aux pump ON, mixture RICH.
    r.run(5);
    expect(v.get(ENG.rpm(1))).toBeGreaterThan(300);
    v.set(C172.fuelShutoff, 1);
    v.set(C172.fuelPump, 1);
    v.set(C172.mixture, 1);
    r.run(20, () => v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 1500);
    expect(v.get(ENG.running(1))).toBe(1);
    v.set(C172.fuelPump, 0);
    r.run(5);
    expect(v.get(ENG.running(1))).toBe(1);
  });

  it('engine-driven fuel pump failure: the engine quits, FUEL PUMP ON restores it (POH Sec 3)', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(2);
    r.core.failures.trigger(C172_FAIL.edpFuelPump);
    r.run(30, () => v.get(ENG.running(1)) < 0.5);
    expect(v.get(ENG.running(1))).toBe(0);
    v.set(C172.fuelPump, 1);
    r.run(20, () => v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 2000);
    expect(v.get(ENG.running(1))).toBe(1);
    expect(v.get('elec.fuel_pump_powered')).toBe(1);
  });

  for (const variant of ['steam', 'g1000'] as const) {
    it(`${variant}: LOW FUEL L below ~5 gal after the 60 s delay`, () => {
      const r = make172({ variant, state: 'ready_to_taxi', fuelGalPerTank: 20 });
      const v = r.vars;
      r.run(2);
      expect(v.get(ANN.lowFuelL)).toBe(0);
      r.core.fuel.setTankKg('left', 4.5 * KG_PER_GAL);
      r.run(30);
      expect(v.get(ANN.lowFuelL)).toBe(0);
      r.run(35);
      expect(v.get(ANN.lowFuelL)).toBe(1);
      expect(v.get(ANN.lowFuelR)).toBe(0);
      if (variant === 'steam') {
        // Annunciator panel lamp: flashes for ~10 s when it first comes on, then steady.
        let lo = 1;
        let hi = 0;
        r.run(3, () => {
          const x = v.get(ANN.lamp('low_fuel_l'));
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        });
        expect(hi).toBeGreaterThan(0.9);
        r.run(12);
        expect(v.get(ANN.lamp('low_fuel_l'))).toBeGreaterThan(0.9);
        expect(lo).toBeLessThan(0.1);
      }
    });
  }
});

describe('Cessna 172S electrical system', () => {
  it('steam: ALT off in cruise, the battery carries the loads at its Ah rate and VOLTS comes on', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.alt_online')).toBe(1);
    expect(v.get(ANN.lamp('volts'))).toBe(0);
    v.set(C172.masterAlt, 0);
    const soc0 = r.core.elec.batterySoc('batt');
    let ah = 0;
    r.run(300, () => void (ah += -v.get('elec.batt_amps') / 3600 / 60));
    expect(v.get('elec.alt_online')).toBe(0);
    expect(v.get('elec.batt_amps')).toBeLessThan(-5); // discharging: avionics, lights, gauges
    expect(v.get('elec.bus1_v')).toBeLessThan(ELEC_DATA.lowVolts);
    expect(v.get(ANN.lamp('volts'))).toBeGreaterThan(0.9);
    const dSoc = soc0 - r.core.elec.batterySoc('batt');
    // 12.75 Ah battery (POH): SOC drop = Ah drawn / capacity (Peukert allows a little more).
    expect(dSoc).toBeGreaterThan((0.9 * ah) / ELEC_DATA.mainBatteryAh);
    expect(dSoc).toBeLessThan((1.3 * ah) / ELEC_DATA.mainBatteryAh);
    // Ammeter (analog compatibility var) shows the discharge.
    expect(v.get(C172.analogBattAmps)).toBeLessThan(-5);
    // POH: ALT back ON restores charging.
    v.set(C172.masterAlt, 1);
    r.run(5);
    expect(v.get('elec.alt_online')).toBe(1);
    expect(v.get('elec.batt_amps')).toBeGreaterThan(0);
    expect(v.get(ANN.lamp('volts'))).toBe(0);
  });

  it('G1000: alternator and main battery exhausted, the standby battery keeps the ESS bus (PFD) alive', () => {
    const r = make172({ variant: 'g1000', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(5);
    expect(v.get(ANN.lowVolts)).toBe(0);
    r.core.failures.trigger(C172_FAIL.altBelt);
    r.core.elec.setBatterySoc('batt', 0.04);
    r.run(20);
    expect(v.get('elec.alt_online')).toBe(0);
    expect(v.get(ANN.lowVolts)).toBe(1);
    expect(v.get(C172.mBattA)).toBeLessThan(0);
    // Run until the main bus falls below the 20 V takeover point.
    r.run(1500, () => v.get('ac.c172.stby_release') > 0.5);
    expect(v.get('ac.c172.stby_release')).toBe(1);
    r.run(15);
    expect(v.get('elec.pfd_powered')).toBe(1);
    expect(v.get('elec.adc_ahrs_powered')).toBe(1);
    expect(v.get(C172.eBusV)).toBeGreaterThan(22);
    expect(v.get(C172.sBattA)).toBeLessThan(-0.5);
    expect(v.get(ANN.stbyBatt)).toBe(1);
    // POH NAV III Sec 3: MASTER OFF to shed the main bus; the ESS bus stays on the standby battery.
    v.set(C172.masterAlt, 0);
    v.set(C172.masterBat, 0);
    r.run(5);
    expect(v.get('elec.pfd_powered')).toBe(1);
    expect(v.get('elec.mfd_powered')).toBe(0);
    expect(v.get(C172.mBusV)).toBeLessThan(1.5);
  });

  for (const variant of ['steam', 'g1000'] as const) {
    it(`${variant}: regulator runaway trips the ACU and ALT FLD breaker; POH reset works once cleared`, () => {
      const r = make172({ variant, state: 'ready_to_taxi' });
      const v = r.vars;
      const altCb = variant === 'g1000' ? 'cb.alt_field' : 'cb.alt_fld';
      v.set(C172.throttle, 0.3);
      r.run(5);
      expect(v.get('elec.alt_online')).toBe(1);
      r.core.failures.trigger('elec.alt.regulator');
      r.run(3);
      expect(v.get('elec.alt_online')).toBe(0);
      expect(v.get(altCb)).toBe(0);
      if (variant === 'g1000') {
        r.run(2);
        expect(v.get(ANN.lowVolts)).toBe(1);
      }
      // Reset: ALT master OFF, breaker in, ALT ON: still failed -> trips again.
      v.set(C172.masterAlt, 0);
      v.set(altCb, 1);
      r.run(1);
      v.set(C172.masterAlt, 1);
      r.run(3);
      expect(v.get('elec.alt_online')).toBe(0);
      r.core.failures.clear('elec.alt.regulator');
      v.set(C172.masterAlt, 0);
      v.set(altCb, 1);
      r.run(1);
      v.set(C172.masterAlt, 1);
      r.run(3);
      expect(v.get('elec.alt_online')).toBe(1);
      expect(v.get(altCb)).toBe(1);
    });
  }
});

describe('Cessna 172S vacuum and pitot-static', () => {
  it('steam: one vacuum pump fails -> L VAC annunciates, suction stays in the green on the other', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(3);
    expect(v.get(ANN.vacL)).toBe(0);
    r.core.failures.trigger('vac.pump1');
    r.run(5);
    expect(v.get(ANN.vacL)).toBe(1);
    expect(v.get(ANN.vacR)).toBe(0);
    expect(v.get('ac.vac.suction_inhg')).toBeGreaterThan(4.5);
    r.core.failures.trigger('vac.pump2');
    r.run(5);
    expect(v.get(ANN.vacR)).toBe(1);
    expect(v.get('ac.vac.suction_inhg')).toBeLessThan(3);
  });

  it('G1000: single vacuum pump failure -> LOW VACUUM', () => {
    const r = make172({ variant: 'g1000', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(3);
    expect(v.get(ANN.lowVacuum)).toBe(0);
    r.core.failures.trigger('vac.pump1');
    r.run(5);
    expect(v.get(ANN.lowVacuum)).toBe(1);
  });

  it('alternate static source ON: ASI and altimeter read high (POH Fig 5-1 sheet 2, vents closed)', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 4000, iasKt: 100 } });
    const v = r.vars;
    r.run(3);
    const ias0 = v.get('adc1.ias_kt');
    const alt0 = v.get('adc1.alt_ft');
    const truth0 = v.get(FDM.altMsl);
    v.set(C172.altStatic, 1);
    r.run(3);
    const dIas = v.get('adc1.ias_kt') - ias0;
    const dAlt = v.get('adc1.alt_ft') - alt0 - (v.get(FDM.altMsl) - truth0);
    expect(dIas).toBeGreaterThan(0.5);
    expect(dIas).toBeLessThan(5);
    expect(dAlt).toBeGreaterThan(5);
    expect(dAlt).toBeLessThan(80);
    v.set(C172.altStatic, 0);
    r.run(3);
    expect(Math.abs(v.get('adc1.ias_kt') - ias0)).toBeLessThan(0.5);
  });

  it('pitot heat draws its current from the bus and warms the probe', () => {
    const r = make172({ variant: 'steam', state: 'ready_to_taxi', oatSeaLevelC: 0 });
    const v = r.vars;
    v.set(C172.throttle, 0.3);
    r.run(5);
    const a0 = v.get('elec.alt_amps');
    v.set(C172.pitotHeat, 1);
    r.run(30);
    expect(v.get('elec.pitot_heat_powered')).toBe(1);
    expect(v.get('elec.alt_amps') - a0).toBeGreaterThan(2);
    expect(v.get('elec.alt_amps') - a0).toBeLessThan(15);
  });
});
