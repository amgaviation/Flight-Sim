/**
 * Citation Longitude function fix round 2 (LENS function audit, gaps LON4-*).
 *
 *  - LON4-01: a deliberate 4.5 deg/s rotation at VR lifts off no later than V2 + 5
 *    (FPG p.4 VR-V2 spreads ~10-13 kt; BCA flight VR 113, V2 125, liftoff shortly after VR).
 *  - LON4-03: the PITCH/ROLL DISCONNECT reconnect detents re-join an axis only when the
 *    halves are aligned (patent US7229047; EST threshold).
 *  - LON4-04: A/T RETARD annunciates green at 50 ft AGL (OG 17 Landing "Check Green RETARD at 50 feet AGL";
 *    OG 7-5 describes the levers still reducing to idle below 40 ft).
 *  - LON4-05: the galley load is shed whenever no generator or GPU is on line, in the air too
 *    (OG 5-2: batteries carry flight-critical + mission loads only).
 *  - LON4-07: the approach speed bug reduces to VREF + a pilot-set additive at 2 nm (BCA 2021).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD } from './helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { takeoffSpeeds } from '../../../src/aircraft/citation-longitude/performance';
import { FDM, INPUT } from '../../../src/core/vars';

describe('Takeoff rotation (LON4-01)', () => {
  it('4.5 deg/s rotation at VR lifts off between VR and V2 + 5 (FPG p.4)', { timeout: 240_000 }, () => {
    const r = makeRig('takeoff', { weightLb: 39500, avionics: false });
    const v = r.vars;
    const { vr, v2 } = takeoffSpeeds(39500, '2');
    r.run(3);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(15, 0); // flaps 2 (takeoff state)
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: vr, courseTrueDeg: FIELD.courseTrue, pitchDeg: 10, rotateRateDegS: 4.5 });
    r.run(120, () => !isNaN(r.pilot.log.liftoffIasKt));
    const liftoff = r.pilot.log.liftoffIasKt;
    // eslint-disable-next-line no-console
    console.log(`LON4-01: VR ${vr} V2 ${v2}, rotate ${r.pilot.log.rotateIasKt.toFixed(0)} liftoff ${liftoff.toFixed(0)} KIAS, max pitch ${r.pilot.log.maxPitchDeg.toFixed(1)} deg`);
    expect(liftoff).toBeGreaterThanOrEqual(vr);
    expect(liftoff).toBeLessThanOrEqual(v2 + 5);
    expect(v.get('fdm.crashed')).toBe(0);
  });
});

describe('A/T RETARD altitude (LON4-04)', () => {
  it('RETARD engages descending through 50 ft AGL with landing flaps (OG 17)', { timeout: 120_000 }, () => {
    const r = makeRig('approach', { weightLb: 31000, avionics: false, air: { altFtMsl: FIELD.elevFt + 1500, iasKt: 130 } });
    const v = r.vars;
    r.run(2);
    if (v.get('ap.engaged')) r.events.emit('ap.disc');
    v.set(V.flapLever, 3);
    r.run(12); // flaps travel to FULL
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(30);
    if (!v.get('ap.at_engaged')) r.events.emit('at.engage');
    r.run(0.5);
    expect(v.get('ap.at_engaged')).toBe(1);
    v.set('ap.sel_spd_kt', 115);
    let raAtRetard = NaN;
    r.run(180, () => {
      // Hold a steady descent by hand (nose slightly down); the A/T holds the selected speed.
      v.set(INPUT.pitch, -0.06);
      if (isNaN(raAtRetard) && v.getString('ap.at_mode') === 'RETARD' && v.get(FDM.vs) < -100) raAtRetard = v.get('ra1.alt_ft');
      return !isNaN(raAtRetard) || v.get('gear.air_ground') === 1;
    });
    expect(isNaN(raAtRetard)).toBe(false);
    // Green RETARD at 50 ft (OG 17 Landing), not only below 40 ft: first seen inside 43..52 ft RA.
    expect(raAtRetard).toBeLessThanOrEqual(52);
    expect(raAtRetard).toBeGreaterThan(43);
  });
});

describe('Galley load shedding (LON4-05)', () => {
  it('galley powered with a generator on line, shed on batteries alone in flight (OG 5-2)', { timeout: 120_000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    expect(v.get('elec.gen_l_online')).toBe(1);
    expect(v.get('elec.galley_powered')).toBe(1);
    // Both generators off: airborne on batteries, the galley is shed.
    v.set(V.genL, 0);
    v.set(V.genR, 0);
    r.run(2);
    expect(v.get('elec.gen_l_online')).toBe(0);
    expect(v.get('elec.gen_r_online')).toBe(0);
    expect(v.get('elec.main_r_powered')).toBe(1); // the bus is alive on batteries
    expect(v.get('elec.galley_powered')).toBe(0); // ...but the galley is shed
    v.set(V.genL, 1);
    v.set(V.genR, 1);
    r.run(2);
    expect(v.get('elec.galley_powered')).toBe(1);
  });
});

describe('Approach speed schedule (LON4-07)', () => {
  it('FMS speed mode targets VREF + additive inside 2 nm of the destination (BCA 2021)', { timeout: 120_000 }, () => {
    const r = makeRig('approach', { weightLb: 31000, avionics: false, air: { altFtMsl: FIELD.elevFt + 2000, iasKt: 150 } });
    const v = r.vars;
    r.run(1);
    // No G5000 suite in this rig: drive the interface vars directly (speed knob FMS, VREF bug, LNAV distance).
    v.set('g3k.spd_fms', 1);
    v.set('g3k.vspd.VREF.kt', 112);
    v.set('g3k.vspd.VREF.on', 1);
    v.set('fms.lnav_valid', 1);
    v.set('fms.dist_to_dest_nm', 5);
    v.set('ap.sel_spd_kt', 150);
    r.run(0.5);
    expect(v.get(V.apprSpdActive)).toBe(0);
    expect(v.get('ap.sel_spd_kt')).toBe(150); // outside 2 nm: untouched
    v.set('fms.dist_to_dest_nm', 1.8);
    r.run(0.5);
    expect(v.get(V.apprSpdActive)).toBe(1);
    expect(v.get('ap.sel_spd_kt')).toBe(117); // VREF 112 + default additive 5
    // GTC-set additive (Pre-Flight page APPR SPD ADD).
    v.set(V.apprSpdAddKt, 10);
    r.run(0.5);
    expect(v.get('ap.sel_spd_kt')).toBe(122);
    // MAN speed: the schedule stands down.
    v.set('g3k.spd_fms', 0);
    r.run(0.5);
    expect(v.get(V.apprSpdActive)).toBe(0);
  });
});

describe('PITCH/ROLL DISCONNECT reconnect alignment (LON4-03)', () => {
  it('a reconnect selection re-joins only once the halves are aligned (patent US7229047)', { timeout: 120_000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    if (v.get('ap.engaged')) r.events.emit('ap.disc');
    r.run(0.5);
    // Jam the roll run away from neutral.
    v.set(INPUT.roll, 0.5);
    r.run(1);
    r.sys.failures.trigger('fcs.roll.jam');
    r.run(0.2);
    const jammedAt = v.get('surf.aileron');
    expect(Math.abs(jammedAt)).toBeGreaterThan(0.15);
    // Split, wheel back to neutral: the free half trails to zero, half the jammed deflection remains.
    v.set(V.pitchRollDisc, 1);
    v.set(INPUT.roll, 0);
    r.run(1.5);
    expect(v.get('surf.aileron')).toBeCloseTo(0.5 * jammedAt, 2);
    // Handle pushed back in while the wheels are misaligned: the axis STAYS split.
    v.set(V.pitchRollDisc, 0);
    r.run(1);
    expect(v.get('surf.aileron')).toBeCloseTo(0.5 * jammedAt, 2);
    // Match the wheel to the jammed half (closed loop on the geared column command, since the pilot gearing
    // varies with IAS): the coupling re-engages and the surface is the full (frozen) channel again.
    let cmd = 0;
    r.run(3, () => {
      cmd += 0.2 * (jammedAt - v.get('fcs.roll_column'));
      v.set(INPUT.roll, Math.max(-1, Math.min(1, cmd)));
      return Math.abs(v.get('surf.aileron') - jammedAt) < 0.005;
    });
    v.set(INPUT.roll, 0);
    r.run(1);
    expect(v.get('surf.aileron')).toBeCloseTo(jammedAt, 2);
  });
});
