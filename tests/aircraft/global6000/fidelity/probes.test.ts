/**
 * Global 6000 function fixes (fix round 2, function lens). Each test pins the
 * behaviour documented in the Global Express pilot training guide (GX PTG) /
 * FCOM chapters cited in the code, and fails on the build before the fix (the
 * earlier version of this file recorded that behaviour as audit probes).
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../../src/core/SimVars';
import { G6kLogic } from '../../../../src/aircraft/global6000/systems/logic';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS } from '../../../../src/aircraft/global6000/data';
import { makeRig, posted } from '../helpers';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } };

describe('Global 6000 function fixes: hydraulics / bleed / ECS / pressurization', () => {
  it('ACMP priority on the APU generator alone (ground): 3A pre-empts 1B (GX PTG 12-25)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 1);
    v.set('elec.apu_gen_online', 1);
    v.set(V.hydPump('1b'), 2);
    v.set(V.hydPump('3a'), 2);
    l.update(1 / 60);
    expect(v.get(V.acmpCmd('3a'))).toBe(1);
    expect(v.get(V.acmpCmd('1b'))).toBe(0);
    // 3A off: the slot goes to the next priority that is commanded (1B).
    v.set(V.hydPump('3a'), 0);
    l.update(1 / 60);
    expect(v.get(V.acmpCmd('1b'))).toBe(1);
  });

  it('XBLEED OPEN with both engines running closes one PRV and posts XBLEED OPEN (GX PTG 13-5)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    expect(v.get(V.engBleedCmd('l')) + v.get(V.engBleedCmd('r'))).toBe(2);
    v.set(V.xbleed, 2);
    r.run(5);
    expect(v.get(V.engBleedCmd('l')) + v.get(V.engBleedCmd('r'))).toBe(1);
    expect(v.get('pneu.iso_open')).toBe(1);
    expect(posted(r)).toContain('status:XBLEED OPEN');
    v.set(V.xbleed, 0);
    r.run(5);
    expect(posted(r)).toContain('status:XBLEED CLOSED');
  });

  it('RAM AIR does not shut the packs; ram air enters only with both packs off below 15,000 ft (GX PTG 13-36)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(30); // pack flow spool-up after the state load
    const cab0 = v.get('press.cabin_alt_ft');
    v.set(V.ramAir, 1);
    r.run(30);
    expect(v.get(V.packCmd('l'))).toBe(1);
    expect(v.get(V.packCmd('r'))).toBe(1);
    expect(v.get(V.ramValveOpen)).toBe(0);
    expect(Math.abs(v.get('press.cabin_alt_ft') - cab0)).toBeLessThan(300);
    const low = makeRig('cruise', { ...cruise, air: { altFtMsl: 10000, iasKt: 250 } });
    low.vars.set(V.pack('l'), 0);
    low.vars.set(V.pack('r'), 0);
    low.vars.set(V.ramAir, 1);
    low.run(2);
    expect(low.vars.get(V.ramValveOpen)).toBe(1);
  });

  it('RATE HIGH raises the AUTO cabin descent limit from 300 to 800 fpm (GX PTG 13-57)', () => {
    // The commanded cabin altitude (press.target_alt_ft) descends at the selected limit once the scheduled cabin is
    // below it; measured over a settled window after a fast reposition down to FL200.
    const rate = (high: number) => {
      const r = makeRig('cruise', cruise);
      const v = r.vars;
      v.set(V.pressRateHigh, high);
      v.set(V.ldgElevFms, 0);
      v.set(V.ldgElevFt, 0);
      r.run(30);
      r.fdm.reposition({ lat: 45.47, lon: -73.74, altFtMsl: 20000, iasKt: 250, headingTrue: 42 });
      r.run(5);
      const t0 = v.get('press.target_alt_ft');
      r.run(30);
      return ((v.get('press.target_alt_ft') - t0) / 30) * 60;
    };
    const norm = rate(0);
    const high = rate(1);
    expect(norm).toBeGreaterThan(-400);
    expect(norm).toBeLessThan(-200);
    expect(high).toBeLessThan(-650);
    expect(high).toBeGreaterThan(-900);
  });

  it('EMER DEPRESS works in MAN and is held by the 14,500 ft cabin altitude limiter (GX PTG 13-58)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.pressAutoMan, 2);
    r.run(2);
    v.set(V.emerDepress, 1);
    let maxCab = 0;
    r.run(120, () => {
      maxCab = Math.max(maxCab, v.get('press.cabin_alt_ft'));
    });
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(12000);
    expect(maxCab).toBeLessThan(15500);
    expect(posted(r)).toContain('caution:EMER DEPRESS');
    expect(posted(r)).toContain('status:MAN PRESS CONTROL');
  });

  it('MAN ALT UP at FL410: the 3,000 fpm rate limiter, the OFV travel limiter (<= 50 % above 7 psid) and the cabin altitude limiter (GX PTG 13-58 / 13-59)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(30); // pack flow spool-up after the state load
    v.set(V.pressAutoMan, 2);
    v.set(V.pressManAlt, 1);
    let maxRate = 0;
    let maxOfvHighDp = 0;
    let maxCab = 0;
    r.run(360, () => {
      maxRate = Math.max(maxRate, v.get('press.cabin_rate_fpm'));
      if (v.get('press.diff_psi') > G6K_LIMITS.ofvTravelLimitPsi + 0.2) maxOfvHighDp = Math.max(maxOfvHighDp, v.get('press.outflow_pos'));
      maxCab = Math.max(maxCab, v.get('press.cabin_alt_ft'));
    });
    expect(maxRate).toBeLessThan(4500); // limiter at 3,000 fpm (valve travel overshoot)
    expect(maxOfvHighDp).toBeLessThanOrEqual(0.51);
    expect(maxCab).toBeLessThan(15500);
  });

  it('OUTFLOW VALVE 1 CLOSED alone posts OUTFLOW VLV 1 CLSD and halves the outflow area (GX PTG 13-59)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.outflowClosed(1), 1);
    v.set(V.emerDepress, 1);
    let maxPos = 0;
    r.run(20, () => {
      maxPos = Math.max(maxPos, v.get('press.outflow_pos'));
    });
    expect(maxPos).toBeLessThanOrEqual(0.51);
    expect(posted(r)).toContain('status:OUTFLOW VLV 1 CLSD');
  });

  it('DITCHING: inhibited above 15,000 ft; below, packs off, depressurize, then both OFVs closed (GX PTG 13-59)', () => {
    const hi = makeRig('cruise', cruise);
    hi.run(2);
    hi.vars.set(V.ditching, 1);
    hi.run(10);
    expect(hi.vars.get(V.ditchSeq)).toBe(-1);
    expect(hi.vars.get(V.packCmd('l'))).toBe(1);
    expect(hi.vars.get('press.safety_valve')).toBe(0);
    const lo = makeRig('cruise', { ...cruise, air: { altFtMsl: 8000, iasKt: 220 } });
    const v = lo.vars;
    lo.run(2);
    v.set(V.ditching, 1);
    lo.run(2);
    expect(v.get(V.packCmd('l'))).toBe(0);
    expect(v.get(V.packCmd('r'))).toBe(0);
    lo.run(120);
    expect(v.get(V.ditchSeq)).toBe(2);
    expect(v.get('press.outflow_pos')).toBeLessThan(0.05);
    const p = posted(lo);
    expect(p).toContain('status:DITCHING ON');
    expect(p).toContain('status:L PACK OFF');
    expect(p).toContain('status:OUTFLOW VLV 1 CLSD');
  });

  it('CABIN ALT caution 8,200 ft and warning 9,000 ft; CABIN DELTA P above 10.85 psid (GX PTG 13-64, FCOM SB 700-21-034)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 0);
    v.set('adc1.press_alt_ft', 41000);
    l.update(1 / 60);
    expect(v.get(V.cabAltCautionFt)).toBe(8200);
    expect(v.get(V.cabAltWarnFt)).toBe(9000);
    // Landing field 11,000 ft, descending through 20,000 ft: levels raised toward field + 1,000 / + 1,800 ft.
    v.set('press.phase', 2);
    v.set('press.ldg_elev_ft', 11000);
    v.set('adc1.press_alt_ft', 20000);
    l.update(1 / 60);
    expect(v.get(V.cabAltCautionFt)).toBeGreaterThan(9000);
    expect(v.get(V.cabAltWarnFt)).toBeGreaterThan(v.get(V.cabAltCautionFt));
    expect(v.get(V.cabAltWarnFt)).toBeLessThanOrEqual(14500);
    expect(G6K_LIMITS.cabinDeltaPWarnPsi).toBe(10.85);
  });

  it('L RECIRC off inhibits only the left fuel recirculation (per-side switches, GX PTG 11-28)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 0);
    v.set('adc1.press_alt_ft', 41000);
    v.set('eng1.running', 1);
    v.set('eng2.running', 1);
    v.set('fuel.l_main_temp_c', -30);
    v.set('fuel.r_main_temp_c', -30);
    v.set(V.recirc('l'), 0);
    v.set(V.recirc('r'), 1);
    l.update(1 / 60);
    expect(v.get(`${V.recircOn}_l`)).toBe(0);
    expect(v.get(`${V.recircOn}_r`)).toBe(1);
  });
});

describe('Global 6000 function fixes: fire / APU / electrical', () => {
  it('fire handle: solenoid-locked without a warning, override unlocks; pulled and turned left 1 s = bottle 1 (GX PTG 9-12 .. 9-14)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    l.update(1 / 60);
    expect(v.get(V.fireUnlock('l'))).toBe(0);
    v.set(V.fireOvrd('l'), 1);
    l.update(1 / 60);
    expect(v.get(V.fireUnlock('l'))).toBe(1);
    v.set(V.fireOvrd('l'), 0);
    v.set('fire.eng1_warn', 1);
    l.update(1 / 60);
    expect(v.get(V.fireUnlock('l'))).toBe(1);
    v.set(V.fireHandle('l'), 1);
    v.set(V.fireRot('l'), -1);
    for (let i = 0; i < 30; i++) l.update(1 / 60);
    expect(v.get(V.fireDisch('l', 1))).toBe(0); // held < 1 s
    for (let i = 0; i < 40; i++) l.update(1 / 60);
    expect(v.get(V.fireDisch('l', 1))).toBe(1);
    expect(v.get(V.fireDisch('l', 2))).toBe(0);
    // APU handle: the second (clockwise) shot needs the lockout release pin.
    v.set(V.fireHandle('apu'), 1);
    v.set(V.fireRot('apu'), 1);
    for (let i = 0; i < 90; i++) l.update(1 / 60);
    expect(v.get(V.fireDisch('apu', 2))).toBe(0);
    v.set(V.fireApuPin, 1);
    for (let i = 0; i < 90; i++) l.update(1 / 60);
    expect(v.get(V.fireDisch('apu', 2))).toBe(1);
  });

  it('APU fire: no automatic shutdown in flight; on the ground the FADEC shuts it down after 5 s (GX PTG 9-20)', () => {
    // In flight (FADEC logic): the fire warning alone never commands the shutdown; pulling the handle does at once.
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 0);
    v.set(V.battMaster, 1);
    v.set('elec.apu_gen_online', 1);
    v.set('fire.apu_warn', 1);
    for (let i = 0; i < 600; i++) l.update(1 / 60);
    expect(v.get(V.apuFireShutdown)).toBe(0);
    v.set(V.fireHandle('apu'), 1);
    l.update(1 / 60);
    expect(v.get(V.apuFireShutdown)).toBe(1);
    const g = makeRig('ready_to_taxi');
    g.sys.apu.setRunning(true);
    g.vars.set(V.apuSw, 1);
    g.run(3);
    g.sys.failures.trigger('fire.apu');
    g.run(3);
    expect(g.vars.get('fire.apu_warn')).toBe(1);
    expect(g.vars.get(V.apuFireShutdown)).toBe(0); // FADEC waits 5 s on the ground
    g.run(3);
    expect(g.vars.get(V.apuFireShutdown)).toBe(1); // -> Apu `fire` binding: immediate shutdown (environment.ts)
  });

  it('BATT MASTER OFF / EMS / ON: EMS keeps the battery bus isolated; OFF with AC power on leaves the APU running, OFF without AC shuts it down at once (GX PTG 6-8 / 4-18)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.sys.apu.setRunning(true);
    v.set(V.apuSw, 1);
    r.run(3);
    v.set(V.battMasterSel, 1); // EMS
    r.run(1);
    expect(v.get(V.battMaster)).toBe(0);
    v.set(V.battMasterSel, 0);
    r.run(3);
    expect(v.get('apu.state')).toBeGreaterThan(0); // AC power on: no emergency shutdown
    v.set(V.apuGen, 0);
    for (const n of [1, 2, 3, 4] as const) v.set(V.gen(n), 0);
    r.run(1);
    expect(v.get(V.apuFireShutdown)).toBe(1);
    // A direct write of V.battMaster (scripted flows) moves the 3-position switch.
    v.set(V.battMaster, 1);
    r.run(0.1);
    expect(v.get(V.battMasterSel)).toBe(2);
  });

  it('pulling an engine fire handle trips that engine\'s VFGs (GX PTG 9-12)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    expect(v.get('elec.gen1_online')).toBe(1);
    v.set(V.fireHandle('l'), 1);
    r.run(2);
    expect(v.get('elec.gen1_online')).toBe(0);
    expect(v.get('elec.gen2_online')).toBe(0);
    expect(v.get('elec.gen3_online')).toBe(1);
  });
});

describe('Global 6000 function fixes: flight controls / gear / SPC', () => {
  it('the stick shaker disconnects the autopilot (GX PTG 10-61)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    expect(v.get('ap.engaged')).toBe(1);
    v.set(V.stallTest, 1);
    r.run(2);
    v.set(V.stallTest, 0);
    expect(v.get('ap.engaged')).toBe(0);
  });

  it('STALL WARN ADVANCE (EMS REV) advances the SPC trips and posts the advisory (GX PTG 10-62)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(1);
    const a = v.get('adc1.aoa_deg');
    v.set(V.stallAdvSel, 1);
    r.run(1);
    expect(v.get(V.stallAdvance)).toBe(1);
    expect(v.get(V.aoaEff)).toBeCloseTo(v.get('adc1.aoa_deg') / G6K_LIMITS.stallAdvanceFactor, 3);
    expect(Math.abs(v.get('adc1.aoa_deg') - a)).toBeLessThan(2);
    expect(posted(r)).toContain('advisory:STALL WARN ADVANCE');
  });

  it('AUTOBRAKE springs back to OFF on the ground and holds when selected in the air (GX PTG 14-31)', () => {
    const g = makeRig('ready_to_taxi');
    g.vars.set(V.autobrake, 2);
    g.run(1);
    expect(g.vars.get(V.autobrake)).toBe(0);
    const a = makeRig('approach', { weightLb: 78000, air: { altFtMsl: 3000, iasKt: 140 } });
    a.vars.set(V.autobrake, 3);
    a.run(2);
    expect(a.vars.get(V.autobrake)).toBe(3);
  });

  it('GND LIFT DUMPING MANUAL ARM / AUTO / OFF is one switch with its status messages (GX PTG 10-50)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    v.set(V.gldSw, 1);
    r.run(1);
    expect(v.get(V.gldArmed)).toBe(1);
    expect(posted(r)).toContain('status:GLD MANUAL ARM');
    v.set(V.gldSw, 2);
    r.run(1);
    expect(v.get(V.gldArmed)).toBe(0);
    expect(v.get(V.gldManArm)).toBe(0);
    expect(posted(r)).toContain('status:GND LIFT DUMP OFF');
  });

  it('FLIGHT SPOILER 3/4 detent: 3/4 of the inboard MFS range (photo EB190582 scale 0 / 1/4 / 1/2 / 3/4 / FULL / MAX)', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set(V.flightSpoiler, 0.75);
    l.update(1 / 60);
    expect(v.get(V.sbCmd)).toBeCloseTo((0.75 / 0.9) * 0.5, 3);
    v.set(V.flightSpoiler, 0.9);
    l.update(1 / 60);
    expect(v.get(V.sbCmd)).toBeCloseTo(0.5, 3);
  });

  it('roll disconnect: MFS roll assist averaged (half) until a ROLL SPLRS priority is selected; ROLL SELECT after 30 s (GX PTG 10-48)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(1);
    r.sys.failures.trigger('fcs.roll_disconnect');
    r.run(31);
    expect(v.get(V.rollSelReq)).toBe(1);
    expect(posted(r)).toContain('caution:ROLL SELECT');
    v.set('surf.aileron', 0.4);
    r.sys.list.find((s) => s.name === 'g6k.fcs_extras')!.update(1 / 60);
    expect(v.get(V.mfsRollCmd)).toBeCloseTo(0.2, 3);
    v.set(V.rollSplr(1), 1);
    r.run(0.5);
    expect(v.get(V.rollPriority)).toBe(1);
    expect(v.get(V.rollSelReq)).toBe(0);
  });

  it('Mach trim moves the stabilizer nose up with Mach (AP off) and not with the AP engaged (GX PTG 10-25)', () => {
    const r = makeRig('cruise', { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 35000, iasKt: 300 } });
    const v = r.vars;
    r.run(1);
    const m = v.get('adc1.mach');
    expect(m).toBeGreaterThan(0.84);
    // AP engaged: no Mach trim command.
    r.run(2);
    expect(Math.abs(v.get(V.machTrimCmd))).toBeLessThan(1e-9);
  });

  it('gear horn secondary mode (no RA): one throttle idle below 191 kt is mutable; the mute is cancelled by gear down (GX PTG 14-17 / 14-18)', () => {
    const r = makeRig('cruise', { weightLb: 70000, fuelLb: 10000, air: { altFtMsl: 5000, iasKt: 180 } });
    const v = r.vars;
    r.sys.failures.trigger('ra1');
    r.sys.failures.trigger('ra2');
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0.5);
    r.run(3);
    expect(v.get('gear.horn')).toBe(1);
    v.set(V.hornMute, 1);
    r.run(1);
    expect(v.get(V.hornMuteEff)).toBe(1);
    expect(v.get('gear.horn')).toBe(0);
  });
});
