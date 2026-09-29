/**
 * PITCH/ROLL DISCONNECT handle and MASTER DISCONNECT (AP/TRIM DISC) functions from the
 * DGAC-published Longitude abnormal checklist card:
 *   JAMMED PITCH OR ROLL CONTROL SYSTEM - PITCH/ROLL DISCONNECT handle pull until latched,
 *   operative control wheel - identify, recover airplane attitude.
 *   NOSEWHEEL STEERING MALFUNCTION - MASTER DISCONNECT button push and hold.
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from './helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { INPUT } from '../../../src/core/vars';

describe('Citation Longitude pitch/roll disconnect', () => {
  it('a jammed aileron is frozen until the handle splits the wheels; the free half then gives half authority', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    r.events.emit('ap.engage');
    r.run(1);
    // Jam the roll run with the ailerons near neutral.
    r.sys.failures.trigger('fcs.roll.jam');
    r.run(0.5);
    const jammedAt = v.get('surf.aileron');
    r.events.emit('ap.disc');
    v.set(INPUT.roll, 0.6);
    r.run(1);
    expect(Math.abs(v.get('surf.aileron') - jammedAt)).toBeLessThan(0.01); // wheel cannot move the surfaces
    // Pull the handle: the pilot's half follows the wheel, the jammed half stays.
    v.set(V.pitchRollDisc, 1);
    r.run(1);
    const wheel = v.get('fcs.roll_column'); // wheel command (geared with IAS, createSystems PILOT_GEARING)
    expect(wheel).toBeGreaterThan(0.2);
    expect(v.get('surf.aileron')).toBeCloseTo(0.5 * wheel + 0.5 * jammedAt, 2);
    expect(v.get('fdm.p_dps') > 1 || Math.abs(v.get('fdm.bank_deg')) > 2).toBe(true); // the aircraft rolls again
    v.set(INPUT.roll, 0);
    r.run(1);
    expect(v.get('surf.aileron')).toBeCloseTo(0.5 * jammedAt, 2);
    // The AP cannot be engaged while the columns are split.
    r.events.emit('ap.engage');
    r.run(1);
    expect(v.get('ap.engaged')).toBe(0);
  });

  it('pulling the handle disconnects an engaged autopilot; with no jam the pilot keeps half the elevator', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    expect(v.get('ap.engaged')).toBe(1); // the cruise state starts on the AP
    // Stowed: the surface is the column command.
    expect(Math.abs(v.get('surf.elevator') - v.get('fcs.pitch_column'))).toBeLessThan(0.02);
    v.set(V.pitchRollDisc, 1);
    r.run(0.5);
    expect(v.get('ap.engaged')).toBe(0);
    // No jam: the unattended half trails at neutral, so the pilot has half the elevator.
    v.set(INPUT.pitch, 0.3);
    r.run(1);
    const col = v.get('fcs.pitch_column');
    expect(col).toBeGreaterThan(0.05);
    expect(Math.abs(v.get('surf.elevator') - 0.5 * col)).toBeLessThan(0.01);
    v.set(INPUT.pitch, 0);
    // Handle pushed back in: connected again.
    v.set(V.pitchRollDisc, 0);
    r.run(1);
    expect(Math.abs(v.get('surf.elevator') - v.get('fcs.pitch_column'))).toBeLessThan(0.02);
  });
});

describe('Citation Longitude MASTER DISCONNECT', () => {
  it('holding the AP/TRIM DISC button disengages nosewheel steering', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { weightLb: 32000, avionics: false });
    const v = r.vars;
    r.run(3);
    v.set(V.tiller3d, 0.5);
    r.run(3);
    const steered = v.get('steer.cmd_deg');
    expect(Math.abs(steered)).toBeGreaterThan(10);
    v.set(V.yokeDiscL, 1);
    r.run(0.5);
    expect(v.get('steer.engaged')).toBe(0);
    v.set(V.yokeDiscL, 0);
    v.set(V.tiller3d, 0);
  });
});
