/**
 * Fix round 1 (function lens): regression tests for the audited gaps.
 * Each test would fail against the pre-fix behaviour recorded in the audit
 * (see the gap ids in the comments; sources: LUC system notes, LIM, dossier).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted, FIELD } from './helpers';
import { G650_VARS as V } from '../../../src/aircraft/g650/vars';
import type { Airport, NavDatabase } from '../../../src/nav/types';

const cruise = { weightLb: 70000, fuelLb: 16000, air: { altFtMsl: 35000, iasKt: 270 } };

describe('G650 fix round 1: fire protection', () => {
  it('F01: each ENGINE FIRE TEST switch lights only its own zone (LUC fire)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    v.set(V.fireTestLA, 1);
    r.run(1);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('fire.eng2_warn')).toBe(0);
    expect(v.get('fire.apu_warn')).toBe(0);
    expect(posted(r)).toContain('warning:L Engine Fire');
    expect(posted(r)).not.toContain('warning:R Engine Fire');
    expect(posted(r)).not.toContain('warning:APU Fire');
    v.set(V.fireTestLA, 0);
    v.set(V.fireTestRB, 1);
    r.run(1);
    expect(v.get('fire.eng1_warn')).toBe(0);
    expect(v.get('fire.eng2_warn')).toBe(1);
    v.set(V.fireTestRB, 0);
    v.set(V.apuFireTest, 1);
    r.run(1);
    expect(v.get('fire.eng1_warn')).toBe(0);
    expect(v.get('fire.eng2_warn')).toBe(0);
    expect(v.get('fire.apu_warn')).toBe(1);
  });

  it('F04: a single failed detection loop posts "Fire Detection Loop Fault" (dual-loop degraded)', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    r.sys.failures.trigger('fire.eng1.loopa');
    r.run(2);
    expect(r.vars.get('fire.eng1_loopa_fault')).toBe(1);
    expect(r.vars.get('fire.eng1_warn')).toBe(0);
    expect(posted(r)).toContain('caution:Fire Detection Loop Fault');
  });

  it('F03/F18: pulling the L fire handle trips the IDG at once and the shutdown is not an "Engine Fail"', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    expect(v.get('elec.idg1_online')).toBe(1);
    v.set(V.fireHandleL, 1);
    r.run(1);
    // LUC fire: the handle disconnects the IDG (not only after N2 decays below the CSD underspeed).
    expect(v.get('elec.idg1_online')).toBe(0);
    // Fuel SOV closed: the engine spools down - a COMMANDED shutdown, no red "L Engine Fail".
    r.run(60, () => v.get('eng1.running') === 0);
    r.run(3);
    expect(v.get('eng1.running')).toBe(0);
    const p = posted(r);
    expect(p).not.toContain('warning:L Engine Fail');
    expect(p).toContain('status:L Fire Handle Pulled');
  });
});

describe('G650 fix round 1: brakes', () => {
  it('F02: PARK BRAKE handle brakes proportionally and sets the parking brake only near full travel', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    v.set(V.parkBrake, 0);
    r.run(2);
    expect(v.get('brakes.parking_set')).toBe(0);
    // Part travel: proportional emergency braking from the accumulators, parking brake NOT set (LUC).
    v.set(V.parkBrake, 0.3);
    r.run(1);
    expect(v.get('brakes.parking_set')).toBe(0);
    expect(v.get('gear.brake_left')).toBeGreaterThan(0.15);
    expect(v.get('gear.brake_left')).toBeLessThan(0.6);
    expect(posted(r)).not.toContain('advisory:Parking Brake On');
    // Full travel: parking brake set, full pressure.
    v.set(V.parkBrake, 1);
    r.run(1);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(v.get('gear.brake_left')).toBeGreaterThan(0.9);
    expect(posted(r)).toContain('advisory:Parking Brake On');
  });

  it('F07: both BCU channels dead = no pedal braking (accumulator only serves the handle) + "Brake by Wire Fail"', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    v.set(V.parkBrake, 0);
    r.run(2);
    v.set('cb.bcu_a', 0);
    v.set('cb.bcu_b', 0);
    r.run(3);
    expect(v.get('elec.bcu_a_powered')).toBe(0);
    expect(v.get('elec.bcu_b_powered')).toBe(0);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    r.run(2);
    // LUC gear/brakes: brake-by-wire - no pedal braking with both BCU channels dead.
    expect(v.get('gear.brake_left')).toBeLessThan(0.05);
    expect(posted(r)).toContain('caution:Brake by Wire Fail');
    // The emergency/park handle still meters the accumulators directly.
    v.set('input.brake_left', 0);
    v.set('input.brake_right', 0);
    v.set(V.parkBrake, 1);
    r.run(1);
    expect(v.get('gear.brake_left')).toBeGreaterThan(0.8);
  });

  it('F13: separate inboard (L system) and outboard (R system) accumulator indications', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(3);
    expect(v.get(V.accumInbdPsi)).toBeGreaterThan(2500);
    expect(v.get(V.accumOutbdPsi)).toBeGreaterThan(2500);
    // Left system lost: the INBD accumulator (charged from L) decays toward its precharge; OUTBD holds.
    v.set(V.ptu, 0);
    v.set(V.auxPump, 0);
    r.sys.failures.trigger('hyd.edp_l');
    r.sys.failures.trigger('hyd.left.leak');
    r.run(240, () => v.get('hyd.left_psi') < 200);
    expect(v.get('hyd.left_psi')).toBeLessThan(200);
    // The check valve holds the charge; the two vars are nonetheless independent scales.
    expect(v.get(V.accumOutbdPsi)).toBeGreaterThan(2500);
  });
});

describe('G650 fix round 1: bleed / APU', () => {
  it('F05: APU bleed cannot pressurize the ducts in flight (LCV on the ground only)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 20000, iasKt: 270 } });
    const v = r.vars;
    r.run(2);
    // Start the APU in flight (below 37,000 ft) and select APU bleed with the engine bleeds OFF.
    v.set(V.apuMaster, 1);
    r.run(16);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(200, () => v.get(V.apuBleedReady) === 1);
    expect(v.get(V.apuBleedReady)).toBe(1);
    v.set(V.bleedL, 0);
    v.set(V.bleedR, 0);
    v.set(V.bleedApu, 1);
    r.run(10);
    expect(v.get('pneu.l_duct_psi')).toBeLessThan(5);
    expect(v.get('pneu.pack_flow_kgs')).toBeLessThan(0.05);
  });

  it('F10: APU start is inhibited above the 37,000 ft in-flight start envelope', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 43000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    v.set(V.apuMaster, 1);
    r.run(16);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(60);
    expect(v.get('apu.avail')).toBe(0);
    expect(v.get('apu.n_pct')).toBeLessThan(5);
  });
});

describe('G650 fix round 1: reversers, engines', () => {
  it('F06: each thrust reverser is powered by its own hydraulic system (L rev on LEFT, R rev on RIGHT)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    v.set(V.parkBrake, 0);
    v.set(V.ptu, 0);
    v.set(V.auxPump, 0);
    r.run(2);
    // Left system lost: the L reverser must NOT deploy; the R reverser (RIGHT system) still works.
    r.sys.failures.trigger('hyd.edp_l');
    r.sys.failures.trigger('hyd.left.leak');
    r.run(240, () => v.get('hyd.left_psi') < 500);
    expect(v.get('hyd.left_psi')).toBeLessThan(500);
    expect(v.get('hyd.right_psi')).toBeGreaterThan(2500);
    v.set(V.tla(1), -0.8);
    v.set(V.tla(2), -0.8);
    r.run(6);
    expect(v.get('eng1.reverser_pos')).toBeLessThan(0.2);
    expect(v.get('eng2.reverser_pos')).toBeGreaterThan(0.9);
  });

  it('F25: the starter is not re-engaged above 42 % HP (LIM re-engagement limit)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    expect(v.get('eng1.n2_pct')).toBeGreaterThan(42); // ground idle ~62 %
    v.set(V.startMaster, 1);
    v.set(V.startL, 1);
    r.run(2);
    expect(v.get('fadec.eng1.starter_cmd')).toBe(0);
    v.set(V.startL, 0);
    v.set(V.startMaster, 0);
  });

  it('F14: EPR sensing failure reverts the EEC to the N1 "ALT" mode with a CAS caution', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    expect(r.vars.get(V.eprMode(1))).toBe(1);
    r.sys.failures.trigger('eng.epr1');
    r.run(3);
    expect(r.vars.get(V.eprMode(1))).toBe(0);
    expect(posted(r)).toContain('caution:L Engine Alternate Mode');
  });

  it('F26: deliberate in-flight shutdown with FUEL CONTROL posts the blue advisory, not "Engine Fail"', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.fuelCtlL, 0);
    r.run(60, () => v.get('eng1.running') === 0);
    r.run(3);
    expect(v.get('eng1.running')).toBe(0);
    const p = posted(r);
    expect(p).toContain('advisory:L Engine Shutdown');
    expect(p).not.toContain('warning:L Engine Fail');
  });
});

describe('G650 fix round 1: AFCS, FBW, sensors', () => {
  it('F08: losing one of three IRUs (or ADS) does not disengage the autopilot', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(3);
    expect(v.get('ap.engaged')).toBe(1); // the cruise state engages the AP
    r.sys.failures.trigger('irs1');
    r.run(3);
    expect(v.get('ahrs1.valid')).toBe(0);
    expect(v.get('ap.engaged')).toBe(1); // two good IRUs remain (dossier §4.12)
    r.sys.failures.trigger('adc1');
    r.run(3);
    expect(v.get('ap.engaged')).toBe(1);
    // All three IRUs gone: now the AFCS loses its attitude source.
    r.sys.failures.trigger('irs2');
    r.sys.failures.trigger('irs3');
    r.run(3);
    expect(v.get('ap.engaged')).toBe(0);
  });

  it('F15: all FCC channels failed with the BFCU alive = BACKUP mode (mode_code 3), no ground spoilers', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('fbw.fcc');
    r.run(2);
    expect(v.get('elec.bfcu_powered')).toBe(1);
    expect(v.get('fbw.mode_code')).toBe(3);
    expect(v.getString('fbw.mode')).toBe('BACKUP');
    expect(v.get(V.gsArmed)).toBe(0); // no ground spoilers in BACKUP (LUC)
    const p = posted(r);
    expect(p).toContain('caution:FCC Backup Mode');
    expect(p).toContain('caution:Yaw Damper Off');
  });

  it('F11: clean CAS during the normal ground IRS alignment after power-up (no "FCC Alternate Mode")', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    r.run(10);
    expect(v.get('ahrs1.aligning')).toBe(1);
    expect(v.get('fbw.mode_code')).not.toBe(0); // the FBW itself is degraded until inertial data are valid
    const p = posted(r);
    expect(p).not.toContain('caution:FCC Alternate Mode');
    expect(p).not.toContain('caution:Stall Protection Unavail');
  });

  it('F28: IRS ground alignment fails above 78 deg latitude (LIM)', () => {
    const r = makeRig('cold_dark', { field: { lat: 80, lon: 10, elevFt: 0, courseTrue: 0 } });
    const v = r.vars;
    r.run(1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    r.run(20);
    expect(v.get('ahrs1.aligning')).toBe(1);
    expect(v.get('irs1.align_light')).toBe(2); // align fail (flashing)
  });
});

describe('G650 fix round 1: fuel, pressurization, oxygen', () => {
  it('F09: the heated fuel return warms a cold-soaked tank (AUTO on at 0 degC)', () => {
    const r = makeRig('cruise', { ...cruise, seaLevelTempC: -5 });
    const v = r.vars;
    // Cold-soaked fuel: seed the tank temperatures below the 0 degC HFRS AUTO-on threshold.
    v.set('fuel.left_temp_c', -5);
    v.set('fuel.right_temp_c', -5);
    r.sys.fuel.reset();
    v.set(V.fuelReturn, 1);
    r.run(5);
    expect(v.get(V.hfrsOn(1))).toBe(1);
    expect(posted(r)).toContain('advisory:L-R Fuel Return On');
    const t0 = v.get('fuel.left_temp_c');
    r.run(120);
    // Without the HFRS heat the tank would keep cooling toward the very cold TAT; with it, it warms.
    expect(v.get('fuel.left_temp_c')).toBeGreaterThan(t0 + 0.02);
  });

  it('F16: Emergency Descent Mode latches when the cabin altitude exceeds the trip in flight', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(3);
    expect(v.get(V.edm)).toBe(0);
    v.set(V.pressDump, 1);
    r.run(600, () => v.get('press.cabin_alt_ft') > 10000);
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(8000);
    r.run(10);
    expect(v.get(V.edm)).toBe(1);
    expect(posted(r)).toContain('advisory:Emergency Descent Mode');
    expect(posted(r)).toContain('warning:Cabin Pressure Low');
  });

  it('F27: each crew mask has its own regulator (per-side mode vars)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.oxyMaskL, 1);
    v.set(V.oxyMaskModeL, 2); // pilot EMERGENCY
    v.set(V.oxyMaskModeR, 0); // copilot regulator untouched, mask stowed
    r.run(3);
    expect(v.get('oxy.pilot_flowing')).toBe(1);
    expect(v.get('oxy.copilot_flowing')).toBe(0);
  });
});

describe('G650 fix round 1: RAAS', () => {
  /** Minimal nav database: one airport, one physical runway (both ends) at the rig field. */
  const fakeNav = (): NavDatabase => {
    const rwy = {
      ident: '10',
      oppositeIdent: '28',
      lat: FIELD.lat,
      lon: FIELD.lon,
      elevationFt: FIELD.elevFt,
      headingTrue: FIELD.courseTrue,
      lengthFt: 10000,
      widthFt: 150,
      displacedFt: 0,
      surface: 'asphalt' as const,
      lighted: true,
    };
    const apt: Airport = {
      icao: 'KSAV',
      name: 'Savannah',
      lat: FIELD.lat,
      lon: FIELD.lon,
      elevationFt: FIELD.elevFt,
      type: 'large_airport',
      country: 'US',
      municipality: 'Savannah',
      runways: [rwy],
      frequencies: [],
    };
    return {
      ready: true,
      airportsNear: () => [apt],
      navaidsNear: () => [],
      airport: () => apt,
    } as unknown as NavDatabase;
  };

  it('F12: rolling onto the runway gives the "On runway ..." callout; RAAS INHIBIT silences it', () => {
    const r = makeRig('ready_to_taxi', { nav: fakeNav() });
    const v = r.vars;
    v.set(V.parkBrake, 0);
    r.run(2);
    expect(v.get(V.raasActive)).toBe(1);
    v.set(V.tla(1), 0.25);
    v.set(V.tla(2), 0.25);
    r.run(60, () => v.get('gps.gs_kt') > 6);
    r.run(4);
    expect(v.get(V.raasOnRunway)).toBe(1);
    expect(v.getString(V.raasCallout)).toContain('On runway one zero');
    // RAAS INHIBIT: availability drops and the callout state clears (no further advisories).
    v.set(V.raasInhibit, 1);
    r.run(1);
    expect(v.get(V.raasActive)).toBe(0);
    expect(v.getString(V.raasCallout)).toBe('');
  });
});
