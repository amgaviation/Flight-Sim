/**
 * (g) Failures produce the right CAS messages and system reactions
 * (GXEL electrical, GXHY hydraulics, GXFP fire protection; data.ts sources).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted } from './helpers';
import { G6K_VARS as V } from '../../../src/aircraft/global6000/vars';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 35000, iasKt: 260 } };

describe('Global 6000 failures -> CAS', () => {
  it('GEN 1 failure: "GEN 1 FAIL", AC BUS 1 transfers to another VFG with no bus loss', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.acb1_src')).toBe(1);
    r.sys.failures.trigger('elec.gen1');
    r.run(5);
    expect(v.get('elec.gen1_online')).toBe(0);
    expect(posted(r)).toContain('advisory:GEN 1 FAIL');
    // GXEL: AC BUS 1 is picked up automatically (priority GEN 4, 3, 2).
    expect(v.get('elec.ac_bus1_powered')).toBe(1);
    expect(v.get('elec.acb1_src')).not.toBe(1);
    expect(posted(r)).not.toContain('caution:AC BUS 1 FAIL');
    expect(v.get('elec.dc_ess_v')).toBeGreaterThan(26);
    expect(v.get('alert.master_warning')).toBe(0);
  });

  it('loss of all four VFGs: the RAT deploys and powers AC ESS; "EMER PWR ONLY" and "RAT GEN ON"', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(5);
    for (const n of [1, 2, 3, 4]) r.sys.failures.trigger(`elec.gen${n}`);
    r.run(15);
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(0);
    expect(v.get(V.ratDeployed)).toBe(1);
    expect(v.get('elec.rat_gen_online')).toBe(1);
    expect(v.get('elec.ac_ess_powered')).toBe(1);
    expect(v.get('elec.dc_ess_powered')).toBe(1);
    const cas = posted(r);
    expect(cas).toContain('caution:EMER PWR ONLY');
    expect(cas).toContain('advisory:RAT GEN ON');
    for (const n of [1, 2, 3, 4]) expect(cas).toContain(`advisory:GEN ${n} FAIL`);
    // The RAT hydraulic pump keeps system 3 (flight controls) pressurized.
    expect(v.get('hyd.sys3_psi')).toBeGreaterThan(2000);
    expect(v.get('alert.master_caution')).toBe(1);
  });

  it('HYD 1 EDP failure: ACMP 1B (AUTO) takes over; a system 1 leak then posts "HYD 1 LO PRESS" / "HYD 1 LO QTY"', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(5);
    expect(v.get('hyd.pump1b_on')).toBe(0); // AUTO: standby until the EDP fails (flaps up in cruise)
    r.sys.failures.trigger('hyd.pump1a');
    r.run(10);
    expect(v.get(V.acmpCmd('1b'))).toBe(1);
    expect(v.get('hyd.sys1_psi')).toBeGreaterThan(2500);
    expect(posted(r)).not.toContain('caution:HYD 1 LO PRESS');
    r.sys.failures.trigger('hyd.sys1.leak');
    r.run(240, () => v.get('hyd.sys1_psi') < 500 && v.get('hyd.sys1_lowqty') === 1);
    r.run(5);
    expect(v.get('hyd.sys1_psi')).toBeLessThan(1800);
    const cas = posted(r);
    expect(cas).toContain('caution:HYD 1 LO PRESS');
    expect(cas).toContain('caution:HYD 1 LO QTY');
    expect(v.get('hyd.sys2_psi')).toBeGreaterThan(2800);
    expect(v.get('hyd.sys3_psi')).toBeGreaterThan(2800);
  });

  it('L ENG FIRE: red warning + master warning; fire handle closes fuel / bleed / hydraulics; bottle 1 then bottle 2', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('fire.eng1');
    r.run(3);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(posted(r)).toContain('warning:L ENG FIRE');
    expect(v.get('alert.master_warning')).toBe(1);
    r.events.emit('cas.ack_warning');
    r.run(0.5);
    expect(v.get('alert.master_warning')).toBe(0);
    // Memory items (GX PTG 9-13 / checklists.ts): L thrust lever IDLE, L ENG RUN OFF, L fire handle PULL (unlocked by
    // the DAU on the fire warning), then turn it left and hold >= 1 s: bottle 1.
    expect(v.get(V.fireUnlock('l'))).toBe(1);
    v.set(V.tla(1), 0);
    v.set(V.engRun(1), 0);
    v.set(V.fireHandle('l'), 1);
    r.run(2);
    expect(v.get(V.sovOpen(1))).toBe(0);
    expect(posted(r)).toContain('status:L ENG SOVS CLSD'); // GX PTG 9-28 (replaces HYD SOV CLSD / ENG BLEED OFF)
    expect(posted(r)).not.toContain('status:L ENG BLEED OFF');
    expect(v.get('elec.gen1_online')).toBe(0); // the handle trips the VFGs
    v.set(V.fireRot('l'), -1);
    r.run(0.5);
    expect(v.get('fire.bottle1_discharged')).toBe(0); // not yet held 1 s
    r.run(1);
    v.set(V.fireRot('l'), 0);
    r.run(30);
    expect(v.get('fire.bottle1_discharged')).toBe(1);
    expect(posted(r)).toContain('caution:FIRE BTL1 LO PRESS');
    if (v.get('fire.eng1_warn')) {
      v.set(V.fireRot('l'), 1); // clockwise: bottle 2
      r.run(1.5);
      v.set(V.fireRot('l'), 0);
      r.run(10);
      expect(v.get('fire.bottle2_discharged')).toBe(1);
    }
    r.run(60);
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('eng1.ff_pph')).toBe(0);
    expect(v.get('eng2.running')).toBe(1);
    // A commanded shutdown (RUN switch OFF) is not a flameout.
    expect(posted(r)).not.toContain('caution:L ENG FLAMEOUT');
    // System 1 loses its EDP (SOV closed); ACMP 1B (AUTO) keeps it pressurized from AC power.
    expect(v.get('hyd.sys1_psi')).toBeGreaterThan(2500);
    // Generators 1 and 2 drop off; the right-engine VFGs carry all four AC buses.
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);
  });

  it('APU fire on the ground: "APU FIRE", automatic APU shutdown after 5 s (GX PTG 9-20)', () => {
    const r = makeRig('ready_to_taxi', { weightLb: 80000 });
    const v = r.vars;
    v.set(V.apuSw, 1);
    r.run(11);
    v.set(V.apuSw, 2);
    r.run(1.5);
    v.set(V.apuSw, 1);
    r.run(90, () => v.get('apu.avail') === 1);
    expect(v.get('apu.avail')).toBe(1);
    r.sys.failures.trigger('fire.apu');
    r.run(3);
    expect(posted(r)).toContain('warning:APU FIRE');
    r.run(15);
    expect(v.get('apu.running')).toBe(0);
  });
});
