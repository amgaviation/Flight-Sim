/**
 * Global 6000 fix round 2 (function lens), the remaining system fixes: status
 * messages (TRIM AIR / RECIRC FAN / HYD PUMP / STAB CH), the load-bus moves
 * from the EMS breaker lists, the SPC ignition and the MASTER DISC hold, the
 * single NO TAKEOFF voice, PASS SIGNS AUTO and ENG BLEED ON vs AUTO. Each test
 * fails on the build before the fix.
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../../src/core/SimVars';
import { G6kLogic } from '../../../../src/aircraft/global6000/systems/logic';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { AUDIO, makeRig, posted } from '../helpers';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } };

describe('Global 6000 fix round 2: messages, buses, SPC, aurals, lights, bleed', () => {
  it('status messages: TRIM AIR OFF, RECIRC FAN OFF, HYD PUMP 1B OFF / 2B ON, STAB CH 1 OFF (GX PTG 13-34, 12-29, 10-66)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.trimAir, 0);
    v.set(V.recircFan, 0);
    v.set(V.hydPump('1b'), 0);
    v.set(V.hydPump('2b'), 2);
    v.set(V.stabCh(1), 1);
    r.run(3);
    const p = posted(r);
    for (const m of ['status:TRIM AIR OFF', 'status:RECIRC FAN OFF', 'status:HYD PUMP 1B OFF', 'status:HYD PUMP 2B ON', 'status:STAB CH 1 OFF']) expect(p).toContain(m);
  });

  it('EMS breaker-list buses: AC BUS 1 isolated drops STAB TRIM CH 1, SLAT/FLAP PWR 1 and the L recirc fan only (GX PTG 10-71, 13-29)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.acBusIsol(1), 1);
    r.run(2);
    expect(v.get('elec.stab_trim1_powered')).toBe(0);
    expect(v.get('elec.stab_trim2_powered')).toBe(1); // AC ESS
    expect(v.get('elec.slat_flap_pwr1_powered')).toBe(0);
    expect(v.get('elec.slat_flap_pwr2_powered')).toBe(1); // AC ESS
    expect(v.get('elec.recirc_fan_l_powered')).toBe(0);
    expect(v.get('elec.recirc_fan_r_powered')).toBe(1); // AC 4
  });

  it('SPC: continuous ignition near the stall (airborne, SPC powered), none on the ground (GX PTG 10-60 / 10-61)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 0);
    v.set('elec.spc_powered', 1);
    v.set('stall.aoa_norm', 0.5);
    l.update(1 / 60);
    expect(v.get(V.spcIgn)).toBe(0);
    v.set('stall.aoa_norm', 0.8);
    l.update(1 / 60);
    expect(v.get(V.spcIgn)).toBe(1);
    v.set('gear.air_ground', 1);
    l.update(1 / 60);
    expect(v.get(V.spcIgn)).toBe(0);
  });

  it('MASTER DISC held: > 5 s STAB TRIM caution, ~12 s STALL PROTECT FAIL (GX PTG 10-57 / 10-65)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.yokeDisc(1), 1);
    r.run(7);
    expect(posted(r)).toContain('caution:STAB TRIM');
    expect(posted(r)).not.toContain('caution:STALL PROTECT FAIL');
    r.run(6);
    expect(posted(r)).toContain('caution:STALL PROTECT FAIL');
  });

  it('take-off configuration: one NO TAKEOFF voice through the CAS, no separate configuration horn (GX PTG 10-67)', () => {
    const tones: string[] = [];
    const orig = AUDIO.tone;
    AUDIO.tone = (id: string, on: boolean) => void (on && tones.push(id));
    try {
      const r = makeRig('takeoff', { weightLb: 90000 });
      const v = r.vars;
      v.set(V.flapLever, 0);
      r.run(20);
      v.set('input.brake_left', 1);
      v.set('input.brake_right', 1);
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      r.run(3);
      expect(posted(r)).toContain('warning:CONFIG SLAT/FLAP');
      expect(tones).not.toContain('takeoff_config');
    } finally {
      AUDIO.tone = orig;
    }
  });

  it('PASS SIGNS AUTO: SEAT BELTS on with the gear handle down, off with it up (GX PTG 15-35)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    v.set(V.seatBelts, 1);
    v.set(V.noSmoking, 1);
    r.run(2);
    expect(v.get('ac.light.seatbelt')).toBe(0);
    v.set(V.gearHandle, 1);
    r.run(2);
    expect(v.get('ac.light.seatbelt')).toBeGreaterThan(0);
    expect(v.get('ac.light.no_smoking')).toBeGreaterThan(0);
  });

  it('ENG BLEED: AUTO closes the PRV on the starting side, ON keeps it open (GX PTG 13-5 / 13-9)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 1);
    v.set(V.engBleed('l'), 1);
    v.set(V.engBleed('r'), 1);
    v.set('elec.bmc1_powered', 1);
    v.set('eng1.running', 1);
    v.set('fadec.eng1.starter_cmd', 1);
    l.update(1 / 60);
    const autoCmd = v.get(V.engBleedCmd('l'));
    v.set(V.engBleed('l'), 2);
    l.update(1 / 60);
    expect(autoCmd).toBe(0);
    expect(v.get(V.engBleedCmd('l'))).toBe(1);
  });
});
