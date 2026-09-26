/**
 * (b) Take-off at a typical weight (65 t, flaps 5, sea level ISA, calm):
 * full-rated 26K thrust (thrust levers forward), the scripted pilot rotates
 * at VR ~3 deg/s. Rotation at VR, lift-off speed and distance within +/-15 %
 * of the reference (data.ts PERF_REF: VR 140 KIAS, lift-off ~1,200 m, EST from
 * the published take-off field length and the QRH-like V-speed table),
 * no tail strike (11 deg), positive climb, gear up. Also: the take-off
 * configuration warning with the flaps up and the stabilizer outside the
 * green band.
 */
import { describe, expect, it } from 'vitest';
import { FDM } from '../../../src/core/vars';
import { horizDist } from '../../physics/helpers';
import { B738 } from '../../../src/aircraft/b737-800/vars';
import { PERF_REF } from '../../../src/aircraft/b737-800/data';
import { TAIL_STRIKE_DEG } from '../../../src/aircraft/b737-800/fdm';
import { makeB738, FIELD } from './helpers';

describe('(b) take-off performance', () => {
  it('65 t flaps 5: rotates at VR, lifts off within the reference distance, climbs', () => {
    const r = makeB738({ state: 'takeoff', grossKg: PERF_REF.toWeightKg, fuelKg: [3500, 3500, 2000] });
    const v = r.vars;
    r.run(2);
    expect(Math.abs(v.get(FDM.mass) - PERF_REF.toWeightKg)).toBeLessThan(300);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(5, 0);
    expect(v.get('trim.pitch_to_ok')).toBe(1);
    const start = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
    r.events.emit('input.throttle_full');
    r.run(0.1);
    r.pilot.startTakeoff({ vrKt: PERF_REF.toVrKt, courseTrueDeg: FIELD.courseTrue, pitchDeg: 14, rotateRateDegS: 2.5 });
    let maxPitchOnGround = 0;
    let liftoffDist = NaN;
    r.run(90, () => {
      if (v.get('gear.air_ground') !== 0) maxPitchOnGround = Math.max(maxPitchOnGround, v.get(FDM.pitch));
      if (Number.isNaN(liftoffDist) && v.get(FDM.onGround) === 0 && v.get(FDM.altAgl) > 12) liftoffDist = horizDist(start, { lat: v.get(FDM.lat), lon: v.get(FDM.lon) });
      return v.get(FDM.altAgl) > 1500;
    });
    const log = r.pilot.log;
    console.log(`rotate ${log.rotateIasKt.toFixed(1)} liftoff ${log.liftoffIasKt.toFixed(1)} kt dist ${log.liftoffDistM.toFixed(0)} m t ${log.liftoffTimeS.toFixed(1)} s maxPitch ${log.maxPitchDeg.toFixed(1)} ground ${maxPitchOnGround.toFixed(1)} dev ${log.maxGroundDeviationM.toFixed(1)} n1 ${v.get('eng1.n1_pct').toFixed(1)}`);
    expect(log.rotateIasKt).toBeGreaterThanOrEqual(PERF_REF.toVrKt - 1);
    expect(log.rotateIasKt).toBeLessThan(PERF_REF.toVrKt + 5);
    expect(log.liftoffIasKt).toBeGreaterThan(PERF_REF.toVrKt);
    expect(log.liftoffIasKt).toBeLessThan(PERF_REF.toVrKt + 20);
    expect(log.liftoffDistM).toBeGreaterThan(PERF_REF.toLiftoffDistM * 0.85);
    expect(log.liftoffDistM).toBeLessThan(PERF_REF.toLiftoffDistM * 1.15);
    expect(maxPitchOnGround).toBeLessThan(TAIL_STRIKE_DEG);
    expect(log.maxGroundDeviationM).toBeLessThan(5);
    expect(v.get(FDM.altAgl)).toBeGreaterThan(1000);
    expect(v.get(FDM.crashed)).toBe(0);
    expect(log.gearUpCommanded).toBe(true);
    expect(v.get('gear.up_locked')).toBe(1);
  });

  it('take-off configuration warning: flaps up / stab out of the green band', () => {
    const r = makeB738({ state: 'takeoff' });
    const v = r.vars;
    r.run(1);
    v.set(B738.flapLever, 0);
    r.run(15);
    v.set(B738.tla(1), 0.8);
    v.set(B738.tla(2), 0.8);
    v.set(B738.parkBrake, 1);
    r.run(1);
    expect(v.get('alert.takeoff_config')).toBe(1);
    expect(v.get(B738.lt.takeoffConfig)).toBe(1);
    v.set(B738.flapLever, 3);
    r.run(15);
    v.set(B738.parkBrake, 0);
    r.run(1);
    expect(v.get('alert.takeoff_config')).toBe(0);
    r.sys.stab.setPosition(11);
    r.run(0.5);
    expect(v.get('alert.takeoff_config')).toBe(1);
  });
});
