/**
 * Function fix round 1 (audit lens "function"): each test fails without its fix.
 * Gap ids in the test names (F.., G800-F.., P..).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, casTexts, type Rig } from './helpers';
import { G800_VARS as V, MIC } from '../../../src/aircraft/g800/vars';
import { G800_CHECKLISTS } from '../../../src/aircraft/g800/checklists';
import { G800_FMS_SPEEDS } from '../../../src/aircraft/g800/createSystems';
import { EDM } from '../../../src/aircraft/g800/systems/logic';
import type { TouchScreenLogic } from '../../../src/avionics/honeywell-epic/logic/touch';

const tsc = (r: Rig, i: number): TouchScreenLogic => r.sys.suite!.tscLogic[i];
const hold = (r: Rig, v: string, s: number) => {
  r.vars.set(v, 1);
  r.run(s);
  r.vars.set(v, 0);
};

describe('G800 function fix round 1: audio (F01, G800-F08, G800-F09)', () => {
  it('TSC AUDIO app selects the MIC per side, keys that transmitter on PTT, and the HOME tile shows the MIC', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 }, avionics: true });
    const v = r.vars;
    r.run(1);
    const t3 = tsc(r, 2); // pedestal right = copilot
    expect(t3.show('AUDIO')).toBe(true);
    expect(t3.tapId('au.mic.3')).toBe(true);
    expect(v.get(V.micSel(2))).toBe(MIC.VHF3);
    expect(v.get(V.micSel(1))).toBe(MIC.VHF1);
    v.set(V.ptt(2), 1);
    r.run(0.5);
    expect(v.get(V.micKeyed(2))).toBe(3);
    expect(v.get(V.comTx(3))).toBe(1);
    // VHF 3 has its own power: pulling its breaker stops the transmission.
    v.set('cb.com3', 0);
    r.run(0.5);
    expect(v.get(V.micKeyed(2))).toBe(0);
    v.set('cb.com3', 1);
    v.set(V.ptt(2), 0);
    // HF 1 on the pilot side: keyed only with HF 1 powered.
    const t1 = tsc(r, 0);
    t1.show('AUDIO');
    t1.tapId('au.mic.4');
    v.set(V.ptt(1), 1);
    r.run(0.3);
    expect(v.get(V.micKeyed(1))).toBe(4);
    expect(v.get('ac.g800.hf1_tx')).toBe(1);
    v.set('cb.hf1', 0);
    r.run(0.3);
    expect(v.get(V.micKeyed(1))).toBe(0);
    v.set(V.ptt(1), 0);
    // Receivers: VHF 2 on the pilot side, volume up.
    expect(v.get(V.rxLevel(1, 1))).toBe(0);
    t1.tapId('au.rx.1');
    t1.tapId('au.rx.1.inc');
    r.run(0.1);
    expect(v.get(V.rxOn(1, 1))).toBe(1);
    expect(v.get(V.rxLevel(1, 1))).toBeCloseTo(0.8, 5);
    // HOME tile shows the selected MIC.
    t1.show('HOME');
    const tile = t1.current.widgets.find((w) => w.id === 'home.AUDIO')!;
    expect(typeof tile.sub === 'function' ? tile.sub() : tile.sub).toBe('MIC HF 1');
  });
});

describe('G800 function fix round 1: flight controls (G800-F01..F03)', () => {
  it('FCC loss gives BACKUP (BFCU) with its CAS; no FCC and no BFCU power: no surface control', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(1);
    v.set('cb.fcc', 0);
    r.run(2);
    expect(v.get(V.fcsBackup)).toBe(1);
    expect(v.get('fbw.mode_code')).toBe(2);
    expect(casTexts(r, 'warning')).toContain('Flight Control Backup Mode');
    expect(casTexts(r, 'warning')).not.toContain('FCC Direct Mode');
    expect(casTexts(r, 'caution')).toContain('FCC Fail');
    v.set('cb.bfcu', 0);
    r.run(1);
    expect(casTexts(r, 'warning')).toContain('Flight Control Fail');
    const e0 = v.get('surf.elevator');
    v.set('input.pitch', 0.8);
    r.run(0.5);
    expect(Math.abs(v.get('surf.elevator') - e0)).toBeLessThan(0.01);
    v.set('input.pitch', 0);
  });

  it('BFCU loss alone: caution, NORMAL law kept', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    r.run(1);
    r.vars.set('cb.bfcu', 0);
    r.run(2);
    expect(r.vars.get('fbw.mode_code')).toBe(0);
    expect(casTexts(r, 'caution')).toContain('BFCU Fail');
  });
});

describe('G800 function fix round 1: steering, gear (G800-F07, G800-F22)', () => {
  it('the tiller always steers (no NWS switch); PEDAL STEER gates the pedals; pedal channel failure posts its CAS', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.nwsSw, 0); // retired var: no effect
    v.set(V.tiller, 1);
    r.run(3);
    expect(v.get('steer.engaged')).toBe(1);
    expect(v.get('steer.cmd_deg')).toBeGreaterThan(60);
    v.set(V.tiller, 0);
    r.sys.failures.trigger('steer.pedal');
    v.set('input.yaw', 1);
    r.run(2);
    expect(v.get('steer.cmd_deg')).toBeCloseTo(0, 1);
    expect(casTexts(r, 'caution')).toContain('Pedal Steering Fail');
  });

  it('LOCK RELEASE holds 5 s after the press; a stuck lock solenoid after takeoff needs it to raise the gear', { timeout: 60000 }, () => {
    const r = makeRig('approach', { weightLb: 70000, air: { altFtMsl: 3000, iasKt: 160 } });
    const v = r.vars;
    r.run(1);
    expect(v.get('gear.down_locked')).toBe(1);
    r.sys.failures.trigger('gear.lock_solenoid');
    v.set(V.gearHandle, 0);
    r.run(0.5);
    expect(v.get(V.gearHandle)).toBe(1); // held by the solenoid
    expect(v.get(V.gearHandleLocked)).toBe(1);
    hold(r, V.gearLockRel, 0.2);
    r.run(1); // released button: the override still holds (EST 5 s)
    expect(v.get(V.gearLockRelEff)).toBe(1);
    v.set(V.gearHandle, 0);
    r.run(2);
    expect(v.get(V.gearHandle)).toBe(0);
    r.run(12);
    expect(v.get('gear.up_locked')).toBe(1);
  });
});

describe('G800 function fix round 1: engines, APU, fuel (G800-F12, F19, F33, P06, P28)', () => {
  it('CRANK MASTER: one START press latches dry motoring; a second press stops it', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set('ac.g800.gpu_avail', 1);
    v.set(V.gpu, 1);
    r.run(2);
    // Ground cart air for the starter: APU bleed.
    v.set(V.apuMaster, 1);
    r.run(12);
    hold(r, V.apuStart, 0.3);
    r.run(60, () => v.get('apu.avail') === 1);
    v.set(V.bleedApu, 1);
    r.run(3);
    v.set(V.crankMaster, 1);
    hold(r, V.startR, 0.2); // a mouse click
    r.run(15);
    expect(v.get(V.crankReq(2))).toBe(1);
    expect(v.get('eng2.n2_pct')).toBeGreaterThan(15);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('fadec.eng2.fuel_cmd')).toBe(0);
    hold(r, V.startR, 0.2);
    r.run(0.5);
    expect(v.get(V.crankReq(2))).toBe(0);
    expect(v.get('fadec.eng2.starter_cmd')).toBe(0);
  });

  it('APU START pressed before the inlet door is open is kept and executed', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(1);
    v.set(V.apuMaster, 1);
    r.run(1);
    expect(v.get(V.ltNav)).toBe(1); // DCN: APU MASTER ON selects the NAV lights (P28)
    hold(r, V.apuStart, 0.2);
    r.run(90, () => v.get('apu.avail') === 1);
    expect(v.get('apu.avail')).toBe(1);
  });

  it('hot restart: the FADEC motors until TGT < 120 degC, then starts; rotor bow: 50 s dry crank', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    v.set(V.runR, 0);
    r.run(4);
    expect(v.get('eng2.running')).toBe(0);
    expect(v.get('eng2.itt_c')).toBeGreaterThan(200);
    v.set(V.runR, 1);
    hold(r, V.engStartBtn, 0.2);
    r.run(1);
    expect(v.get(V.startProtect(2))).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('R Engine Start Protect');
    expect(v.get('fadec.eng2.fuel_cmd')).toBe(0);
    r.run(120, () => v.get(V.startProtect(2)) === 0);
    expect(v.get('eng2.itt_c')).toBeLessThanOrEqual(121);
    r.run(60, () => v.get('eng2.running') === 1);
    expect(v.get('eng2.running')).toBe(1);
    // Rotor bow: shut down 30 min ago.
    v.set(V.runR, 0);
    r.run(40);
    (r.sys.logic as unknown as { offS: number[] }).offS[1] = 30 * 60;
    v.set(V.runR, 1);
    hold(r, V.engStartBtn, 0.2);
    const t = r.run(120, () => v.get(V.startProtect(2)) === 0);
    expect(t).toBeGreaterThan(48);
    r.run(60, () => v.get('eng2.running') === 1);
    expect(v.get('eng2.running')).toBe(1);
  });

  it('suction feed at FL350 cannot hold cruise flow: Fuel Pressure Low and Eng Fail; at FL150 it feeds', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.run(1);
    v.set(V.boostL, 0);
    v.set(V.altPumpL, 0);
    r.run(6);
    expect(casTexts(r, 'caution')).toContain('L Fuel Pressure Low');
    expect(v.get('eng1.running')).toBe(0);
    expect(casTexts(r, 'caution')).toContain('L Eng Fail');
    const r2 = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 15000, iasKt: 260 } });
    r2.run(1);
    r2.vars.set(V.boostL, 0);
    r2.vars.set(V.altPumpL, 0);
    r2.run(10);
    expect(r2.vars.get('eng1.running')).toBe(1);
    expect(r2.vars.get('fuel.eng1_suction')).toBe(1);
  });

  it('Fuel Imbalance: 1,000 lb on the ground, 2,000 lb in flight', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.sys.fuel.setTankKg('left', v.get('fuel.tank1_kg') + 1500 * 0.4536);
    r.run(12);
    expect(casTexts(r, 'caution')).not.toContain('Fuel Imbalance');
    r.sys.fuel.setTankKg('left', v.get('fuel.tank1_kg') + 2200 * 0.4536);
    r.run(12);
    expect(casTexts(r, 'caution')).toContain('Fuel Imbalance');
  });
});

describe('G800 function fix round 1: hydraulics, fire, electrical (G800-F21, F23, F26, F34, P13, P14, P29)', () => {
  it('dual EDP failure: Hydraulic Pressure Low within 8 s and AUX (ARM) starts', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.run(1);
    r.sys.failures.trigger('hyd.edp_l');
    r.sys.failures.trigger('hyd.edp_r');
    r.run(8);
    expect(v.get('hyd.right_psi')).toBeLessThan(1500);
    expect(casTexts(r, 'caution')).toContain('R Hydraulic Pressure Low');
    expect(v.get(V.auxPumpOn)).toBe(1);
  });

  it('fire handles: outboard = DISCH 1 (right bottle) on both sides; directive line and core fire', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(1);
    r.sys.failures.trigger('fire.eng2');
    r.run(3);
    expect(casTexts(r, 'warning')).toContain('R Engine Fire');
    v.set(V.tla(2), 0.3);
    r.run(0.5);
    expect(casTexts(r, 'warning')).toContain('> Reduce R Throttle To Idle');
    v.set(V.tla(2), 0);
    r.run(0.5);
    expect(casTexts(r, 'warning')).not.toContain('> Reduce R Throttle To Idle');
    expect(v.get('ac.g800.fire_r_unlock')).toBe(1);
    v.set(V.fireHandleR, 1);
    v.set(V.fireRotR, 1); // R handle rotated right = outboard
    r.run(3);
    v.set(V.fireRotR, 0);
    expect(v.get('fire.bottle_r_discharged')).toBe(1);
    expect(v.get('fire.bottle_l_discharged')).toBe(0);
    r.sys.failures.trigger('fire.core1');
    r.run(3);
    expect(casTexts(r, 'warning')).toContain('L Engine Core Fire');
  });

  it('APU GEN OFF legend only with the APU available; emergency lights stay off with the ESS buses healthy; EMER PWR ON', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 30000, iasKt: 280 } });
    const v = r.vars;
    r.run(1);
    expect(v.get(V.apuGenOffLt)).toBe(0);
    v.set(V.ltEmer, 1);
    r.sys.failures.trigger('elec.idg1');
    r.sys.failures.trigger('elec.idg2');
    r.run(5);
    expect(v.get('elec.l_main_dc_powered')).toBe(0);
    expect(v.get('elec.l_ess_dc_powered')).toBe(1);
    expect(v.get('ac.g800.emer_lts_on')).toBe(0);
    v.set(V.emerPwr, 2);
    r.run(1);
    expect(v.get(V.ebattOn)).toBe(1);
  });
});

describe('G800 function fix round 1: warnings, AFCS, TAWS (G800-F06/P30, F10, F13, F18, F31)', () => {
  it('Emergency Descent Mode: Cabin Pressure Low with the AP on above FL250', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(1);
    const hdg0 = v.get('ahrs1.hdg_mag_deg');
    expect(v.get('ap.engaged')).toBe(1);
    r.sys.failures.trigger('press.decompression');
    r.run(40, () => v.get(V.edmActive) === 1);
    r.run(0.5);
    expect(v.get(V.edmActive)).toBe(1);
    expect(v.get('ap.sel_alt_ft')).toBe(EDM.altFt);
    expect(v.get('ap.sel_spd_kt')).toBe(EDM.speedKt);
    expect(v.get('epic.gp.spd_man')).toBe(1);
    expect(v.getString('ap.lat_active')).toBe('HDG');
    expect(['FLC', 'FLCH']).toContain(v.getString('ap.vert_active'));
    expect(v.get('ap.at_engaged')).toBe(1);
    const d = (((v.get('ap.sel_hdg_deg') - hdg0) % 360) + 540) % 360 - 180;
    expect(d).toBeCloseTo(-90, 0);
    expect(casTexts(r, 'advisory')).toContain('Emergency Descent Mode');
    r.run(20);
    expect(v.get('ap.vs_fpm') < 0 || v.get('adc1.vs_fpm') < -1000).toBe(true);
    // Pilot override: AP disconnect ends EDM.
    r.events.emit('ap.disc');
    r.run(0.5);
    expect(v.get(V.edmActive)).toBe(0);
  });

  it('TAWS inhibits from the TSC TAWS app reach the EGPWS; TOCW posts "Takeoff Config" and checks the rudder trim', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { avionics: true });
    const v = r.vars;
    r.run(1);
    const t = tsc(r, 1);
    t.show('TAWS');
    t.tapId('taws.terr');
    t.tapId('taws.terr'); // guarded: confirmation tap
    r.run(0.5);
    expect(v.get(V.tawsTerrInh)).toBe(1);
    expect(casTexts(r, 'advisory')).toContain('Terrain Inhibit');
    r.sys.yawTrim.setPosition(0.6);
    r.run(0.5);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(1);
    expect(v.get('alert.takeoff_config')).toBe(1);
    expect(v.get('tocw.rudder_trim')).toBe(1);
    expect(casTexts(r, 'warning')).toContain('Takeoff Config');
  });

  it('A/T speed protection follows the VMO schedule (300 KCAS below 8,000 ft)', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 70000, air: { altFtMsl: 5000, iasKt: 250 } });
    r.run(1);
    expect(r.vars.get(V.vmoKt)).toBe(300);
    const r2 = makeRig('cruise', { weightLb: 70000, air: { altFtMsl: 20000, iasKt: 280 } });
    r2.run(1);
    expect(r2.vars.get(V.vmoKt)).toBe(340);
  });
});

describe('G800 function fix round 1: avionics / ECL (F04, F05/F16, F14, P15)', () => {
  it('PERF INIT defaults are the G800 FMS schedule; the PFD flap placard is enabled', { timeout: 60000 }, () => {
    const r = makeRig('approach', { weightLb: 70000, air: { altFtMsl: 3000, iasKt: 160 }, avionics: true });
    const pf = r.sys.suite!.fmsShared.perf;
    expect(pf.climbKt).toBe(G800_FMS_SPEEDS.climbKt);
    expect(pf.climbMach).toBe(G800_FMS_SPEEDS.climbMach);
    expect(pf.descentKt).toBe(G800_FMS_SPEEDS.descentKt);
    // The PFD placard marker (showPlacardLimit) is checked in the screenshots: headless tests have no OffscreenCanvas.
    expect(r.sys.suite!.cfg.airframe.showPlacardLimit).toBe(true);
  });

  it('ECL: abnormal / emergency checklists linked to their CAS texts; Cruise TRS CRZ; start TGT item', () => {
    const titles = G800_CHECKLISTS.map((c) => c.title);
    for (const t of ['L Engine Fire', 'R Engine Fire', 'APU Fire', 'Cabin Pressure Low', 'L Generator Off', 'Dual Generator Failure', 'L Hydraulic Pressure Low', 'FCC Alternate Mode', 'Fuel Imbalance', 'L Eng Fail', 'Aft Baggage Smoke', 'Emergency Evacuation', 'Cruise']) {
      expect(titles).toContain(t);
    }
    const fire = G800_CHECKLISTS.find((c) => c.title === 'L Engine Fire')!;
    expect(fire.phase).toBe('Emergency');
    expect(fire.items.some((i) => i.response.includes('DISCH 1'))).toBe(true);
    const evac = G800_CHECKLISTS.find((c) => c.title === 'Emergency Evacuation')!;
    expect(evac.items.map((i) => i.challenge)).toContain('FCS BATTERIES');
    expect(G800_CHECKLISTS.find((c) => c.title === 'Engine Start')!.items[0].challenge).toBe('TGT');
  });

  it('OHPTS TEST page: FIRE TEST and LAMP TEST (touch functions)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    r.run(1);
    const oh = r.sys.suite!.ohptsLogic[0];
    expect(oh.show('ELEC')).toBe(true);
    expect(oh.tapId('tab.TEST')).toBe(true);
    expect(oh.current.id).toBe('TEST');
    const w = oh.current.widgets.find((x) => x.id === 'test.fire')!;
    oh.down(w.x + 5, w.y + 5);
    r.run(0.5);
    expect(r.vars.get('fire.test')).toBe(1);
    expect(r.vars.get('ac.g800.fire_l_unlock')).toBe(0);
    oh.up(w.x + 5, w.y + 5);
    const l = oh.current.widgets.find((x) => x.id === 'test.lamp')!;
    oh.down(l.x + 5, l.y + 5);
    r.run(0.1);
    expect(r.vars.get('alert.annun_test')).toBe(1);
    oh.up(l.x + 5, l.y + 5);
    r.run(0.1);
    expect(r.vars.get('alert.annun_test')).toBe(0);
  });
});
