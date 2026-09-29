/**
 * Fix round 2 (function lens) probes for the 737-800: each test would fail
 * without its gap's fix.
 *
 *  G03  fuel boost pump diagonal AC split (sjap.nl NG Power Sources)
 *  G04  auxiliary battery + DC meters AUX BAT position (b737.org.uk Electrics)
 *  G05  bleed panel OVHT TEST -> WING-BODY OVERHEAT loop test (FCOM 2.20)
 *  G01  Speed Trim System (FCOM 9.20)
 *  G02  Mach trim above M0.615 (FCOM 9.20)
 *  G09  FMC transfer switch selects the operative FMC (FCOM 11)
 *  G15  centre boost pump automatic shutoff (b737.org.uk Fuel)
 *  G21  brake accumulator depletion (FCOM 14.20: ~6 applications + parking)
 *  G23  automatic bus transfer inhibited in a dual-channel approach (FCOM 6.20)
 *  G24  ALT RPTG OFF -> Mode A reply without altitude, TCAS standby (FCOM 15.20)
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { INPUT, NAV } from '../../../src/core/vars';
import { B738, XPDR_SEL } from '../../../src/aircraft/b737-800/vars';
import { AcSourceLogic } from '../../../src/aircraft/b737-800/systems/electrical';
import { B738FlightControlExtras, machTrimElev, STS } from '../../../src/aircraft/b737-800/systems/flightControlExtras';
import { VERTICAL_MODES } from '../../../src/systems/autopilot';
import type { TrimAxis } from '../../../src/systems/flightcontrols';
import { VnavGuidance } from '../../../src/nav/fms/VnavGuidance';
import type { FlightPlan } from '../../../src/nav/flightplan/FlightPlan';
import { FMS, GPS } from '../../../src/core/vars';
import { makeB738, press, loadNav } from './helpers';

describe('737-800 fix round 2 (function lens)', () => {
  it('G03: transfer bus 1 loss takes L FWD + R AFT + CTR L pumps (diagonal split)', () => {
    const r = makeB738({ state: 'ready_to_taxi', fuelKg: [4000, 4000, 1600] });
    const v = r.vars;
    for (const p of ['l_fwd', 'l_aft', 'r_fwd', 'r_aft', 'c_l', 'c_r'] as const) v.set(B738.fuelPump(p), 1);
    r.run(2);
    expect(v.get('elec.xfr1_powered')).toBe(1);
    for (const p of ['fuel_l_fwd', 'fuel_l_aft', 'fuel_r_fwd', 'fuel_r_aft', 'fuel_c_l', 'fuel_c_r']) expect(v.get(`elec.${p}_powered`), p).toBe(1);
    // GEN 1 dropped with BUS TRANSFER OFF: XFR 1 stays dead (QRH TRANSFER BUS OFF condition).
    v.set(B738.busXferSw, 0);
    press(r, B738.genSw(1), 0.3, -1);
    r.run(2);
    expect(v.get('elec.xfr1_powered')).toBe(0);
    expect(v.get('elec.xfr2_powered')).toBe(1);
    // The diagonal pair on XFR 1 loses power (LOW PRESSURE lights); one pump per main tank keeps running.
    expect(v.get('elec.fuel_l_fwd_powered')).toBe(0);
    expect(v.get('elec.fuel_r_aft_powered')).toBe(0);
    expect(v.get('elec.fuel_c_l_powered')).toBe(0);
    expect(v.get('elec.fuel_l_aft_powered')).toBe(1);
    expect(v.get('elec.fuel_r_fwd_powered')).toBe(1);
    expect(v.get('elec.fuel_c_r_powered')).toBe(1);
    r.run(2);
    expect(v.get(B738.lt.fuelLowPress('l_fwd'))).toBe(1);
    expect(v.get(B738.lt.fuelLowPress('r_aft'))).toBe(1);
    expect(v.get(B738.lt.fuelLowPress('l_aft'))).toBe(0);
    expect(v.get(B738.lt.fuelLowPress('r_fwd'))).toBe(0);
  });

  it('G04: auxiliary battery parallels the main for standby power; DC meters AUX BAT reads it', () => {
    const r = makeB738({ state: 'cold_dark' });
    const v = r.vars;
    v.set(B738.batSw, 1);
    v.set(B738.stbyPwrSw, 1);
    r.run(3);
    expect(v.get('elec.batt_bus_powered')).toBe(1);
    expect(v.get('elec.aux_batt_v')).toBeGreaterThan(20);
    // Both batteries carry the battery-bus loads (aux relay closed): the aux battery is discharging.
    expect(v.get('elec.aux_batt_amps')).toBeLessThan(0);
    // AUX BAT selector position (appended value 7; real rotary order in the cockpit).
    v.set(B738.dcMeterSel, 7);
    r.run(0.2);
    expect(v.get(B738.lt.dcVolts)).toBeGreaterThan(20);
  });

  it('G05: OVHT TEST lights both WING-BODY OVERHEAT lights while held (loop test)', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(1);
    expect(v.get(B738.lt.wingBodyOvht(1))).toBe(0);
    v.set(B738.ovhtTest, 1);
    r.run(0.5);
    expect(v.get(B738.lt.wingBodyOvht(1))).toBe(1);
    expect(v.get(B738.lt.wingBodyOvht(2))).toBe(1);
    // ZONE TEMP is not part of the wing-body loop test (lamp test only, FCOM 2.20).
    expect(v.get(B738.lt.zoneTemp(1))).toBe(0);
    v.set(B738.ovhtTest, 0);
    r.run(0.5);
    expect(v.get(B738.lt.wingBodyOvht(1))).toBe(0);
    expect(v.get(B738.lt.wingBodyOvht(2))).toBe(0);
  });

  it('G01: Speed Trim System trims the stabilizer opposite the speed change in manual flight', () => {
    const v = new SimVars();
    const stab = { position: 5, setPosition(u: number) { this.position = u; } };
    const x = new B738FlightControlExtras(v, stab as unknown as TrimAxis);
    v.set('gear.air_ground', 0); // airborne
    v.set('adc1.ias_kt', 200);
    v.set('adc1.valid', 1);
    v.set('adc1.mach', 0.4);
    v.set('elec.fcc_a_powered', 1);
    v.set('ap.engaged', 0);
    v.set(B738.stabCutoutAp, 1);
    v.set('surf.flaps_deg', 0);
    const step = (s: number) => { for (let i = 0; i < s * 60; i++) x.update(1 / 60); };
    step(STS.afterLiftoffS + 30); // reference settles at 200 kt
    const p0 = stab.position;
    // Speed increases 25 kt above the trimmed speed: STS trims NOSE UP (FCOM 9.20 "opposite the speed change").
    v.set('adc1.ias_kt', 225);
    step(3);
    expect(stab.position).toBeGreaterThan(p0 + 0.05);
    expect(v.get(B738.stsCmd)).not.toBe(0);
    // With the autopilot engaged the STS is inhibited (the AP trims instead).
    const y = new B738FlightControlExtras(v, stab as unknown as TrimAxis);
    v.set('adc1.ias_kt', 200);
    v.set('ap.engaged', 1);
    const p1 = stab.position;
    for (let i = 0; i < 60 * 40; i++) y.update(1 / 60);
    v.set('adc1.ias_kt', 240);
    for (let i = 0; i < 180; i++) y.update(1 / 60);
    expect(stab.position).toBe(p1);
    // SPEED TRIM failure inhibits it too.
    v.set('ap.engaged', 0);
    v.set('fail.b738.speed_trim', 1);
    for (let i = 0; i < 180; i++) y.update(1 / 60);
    expect(stab.position).toBe(p1);
  });

  it('G02: Mach trim biases the elevator nose up above M0.615', () => {
    expect(machTrimElev(0.5)).toBe(0);
    expect(machTrimElev(0.615)).toBe(0);
    expect(machTrimElev(0.7)).toBeGreaterThan(0);
    expect(machTrimElev(0.82)).toBeGreaterThan(machTrimElev(0.7));
    const v = new SimVars();
    const stab = { position: 5, setPosition(u: number) { this.position = u; } };
    const x = new B738FlightControlExtras(v, stab as unknown as TrimAxis);
    v.set('gear.air_ground', 0);
    v.set('adc1.ias_kt', 270);
    v.set('adc1.valid', 1);
    v.set('adc1.mach', 0.78);
    v.set('elec.fcc_a_powered', 1);
    v.set(B738.stabCutoutAp, 1);
    x.update(1 / 60);
    expect(v.get(B738.machTrimElev)).toBeGreaterThan(0);
    // Failed (MACH TRIM FAIL) or both FCCs lost: no bias.
    v.set('fail.b738.mach_trim', 1);
    x.update(1 / 60);
    expect(v.get(B738.machTrimElev)).toBe(0);
    v.set('fail.b738.mach_trim', 0);
    v.set('elec.fcc_a_powered', 0);
    x.update(1 / 60);
    expect(v.get(B738.machTrimElev)).toBe(0);
  });

  it('G15: centre boost pumps latch off when the centre tank empties (LOW PRESSURE stays on)', () => {
    // 25 kg in the centre tank (20 kg unusable): the pumps run dry after ~30 s at idle.
    const r = makeB738({ state: 'ready_to_taxi', fuelKg: [4000, 4000, 25] });
    const v = r.vars;
    v.set(B738.fuelPump('c_l'), 1);
    v.set(B738.fuelPump('c_r'), 1);
    r.run(2);
    expect(v.get('fuel.c_l_on')).toBe(1);
    r.run(120, () => v.get(B738.ctrPumpShutoff('c_l')) === 1);
    expect(v.get(B738.ctrPumpShutoff('c_l'))).toBe(1);
    r.run(1);
    // Pump latched off with the switch still ON; LOW PRESSURE light on.
    expect(v.get('fuel.c_l_on')).toBe(0);
    expect(v.get(B738.fuelPump('c_l'))).toBe(1);
    expect(v.get(B738.lt.fuelLowPress('c_l'))).toBe(1);
    // Cycling the switch OFF resets the latch and the light (centre pumps: light only when ON).
    v.set(B738.fuelPump('c_l'), 0);
    r.run(1);
    expect(v.get(B738.ctrPumpShutoff('c_l'))).toBe(0);
    expect(v.get(B738.lt.fuelLowPress('c_l'))).toBe(0);
  });

  it('G21: brake accumulator supplies ~6 applications with system B lost; parking brake holds', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    // Release the parking brake (it holds accumulator pressure applied, so pedal cycles would not draw fluid).
    v.set(B738.parkBrake, 0);
    // Kill both system B pressure sources (ENG 2 EDP switch, ELEC 1 EMDP switch).
    v.set(B738.hydPump('eng2'), 0);
    v.set(B738.hydPump('elec1'), 0);
    r.run(15);
    expect(v.get('hyd.b_psi')).toBeLessThan(1300);
    // Also remove system A so only the accumulator brakes (alternate source would otherwise hold pressure).
    v.set(B738.hydPump('eng1'), 0);
    v.set(B738.hydPump('elec2'), 0);
    r.run(120, () => v.get('hyd.a_psi') < 900 && v.get('hyd.b_psi') < 900);
    expect(v.get('hyd.a_psi')).toBeLessThan(1000);
    const p0 = v.get('brakes.accum_psi');
    expect(p0).toBeGreaterThan(2500);
    for (let k = 0; k < 7; k++) {
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(1.5);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      r.run(0.7);
    }
    const p1 = v.get('brakes.accum_psi');
    // Depleted toward the 1,000 psi precharge after ~7 full applications.
    expect(p1).toBeLessThan(p0 - 500);
    expect(p1).toBeGreaterThan(900);
    // Parking brake still holds from the accumulator (hot battery valve).
    v.set(B738.parkBrake, 1);
    r.run(1);
    expect(v.get('brakes.parking_set')).toBe(1);
  });

  it('G23: automatic bus transfer is inhibited during a dual-channel approach', () => {
    const mk = (dual: boolean) => {
      const v = new SimVars();
      const acs = new AcSourceLogic({ vars: v });
      v.set('elec.idg1_avail', 1);
      v.set('elec.idg2_avail', 1);
      v.set(B738.busXferSw, 1);
      acs.select('gens');
      acs.update();
      expect(v.get(B738.xfrSrc(1))).toBe(1);
      if (dual) {
        v.set('ap.channels', 2);
        v.set('ap.vert_code', VERTICAL_MODES.indexOf('GS'));
      }
      v.set('elec.idg1_avail', 0);
      acs.update();
      return v.get(B738.xfrSrc(1));
    };
    expect(mk(false)).toBe(4); // normal: transfer to the opposite IDG
    expect(mk(true)).toBe(0); // dual-channel approach: sides isolated, no transfer (FCOM 6.20)
  });

  it('G06/F02: VNAV descent builds the 250/10,000 and approach deceleration segments', async () => {
    // Unit level: VnavGuidance with the 737 schedule (250 kt already 2,000 ft above the limit altitude;
    // approach decel from 12 nm before the end of descent - FCOM 11.31 DES page / Bulfer FMC guide).
    const v = new SimVars();
    const g = new VnavGuidance(v, { speeds: { descentKt: 280, descentMach: 0, approachKt: 150, cruiseKt: 280, climbKt: 280, speedLimitDecelFt: 2000, approachDecelNm: 12, machTransitionFt: 28000 } });
    const leg = { type: 'TF', segment: 'enroute', geom: { cumDistNm: 100, valid: true }, altitude: undefined, speed: undefined };
    const plan = { legs: [leg, leg] } as unknown as FlightPlan;
    g.profile.valid = true;
    g.profile.todDistNm = 10;
    g.profile.eodDistNm = 100;
    g.profile.eodAltFt = 2000;
    g.profile.cruiseAltFt = 35000;
    g.profile.s = [10, 100];
    g.profile.alt = [35000, 2000];
    v.set(GPS.valid, 1);
    v.set(GPS.gs, 300);
    // Mid-descent at 11,500 ft: below 10,000 + 2,000 ft decel band, so the 250 kt limit already applies.
    v.set('adc1.alt_ft', 11500);
    g.alongNm = 50;
    g.update(plan, 0, false, false);
    expect(g.phase).toBe('DES');
    expect(v.get(FMS.vnavTargetSpeedKt)).toBe(250);
    // 5 nm before the end of descent: decelerating toward the approach speed.
    v.set('adc1.alt_ft', 4000);
    g.alongNm = 95;
    g.update(plan, 0, false, false);
    const kt = v.get(FMS.vnavTargetSpeedKt);
    expect(kt).toBeLessThan(200);
    expect(kt).toBeGreaterThanOrEqual(150);
    // The 737 suite carries the schedule (suite.ts).
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    expect(r.sys.suite.fms!.vnav.speeds.speedLimitDecelFt).toBe(2000);
    expect(r.sys.suite.fms!.vnav.speeds.approachDecelNm).toBe(12);
  });

  it('G24: ALT RPTG OFF replies Mode A without altitude; TCAS TA/RA only in the TA positions', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(B738.xpdrModeSel, XPDR_SEL.altOff);
    r.run(0.5);
    // xpdr.mode 2 = on, Mode A (no altitude reporting); TCAS is in standby below mode 4 (Tcas.ts).
    expect(v.get(NAV.xpdrMode)).toBe(2);
    v.set(B738.xpdrModeSel, XPDR_SEL.taRa);
    r.run(0.5);
    expect(v.get(NAV.xpdrMode)).toBe(5);
    v.set(B738.xpdrModeSel, XPDR_SEL.stby);
    r.run(0.5);
    expect(v.get(NAV.xpdrMode)).toBe(1);
  });
});
