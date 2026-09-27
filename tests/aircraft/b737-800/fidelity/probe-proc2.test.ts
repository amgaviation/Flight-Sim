import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { B738, SPEEDBRAKE } from '../../../../src/aircraft/b737-800/vars';
import { FLAP_LEVER } from '../../../../src/aircraft/b737-800/data';
import { B738_CHECKLISTS } from '../../../../src/aircraft/b737-800/checklists';
import { makeB738, press } from '../helpers';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/b737/probe2.log', a.map(String).join(' ') + '\n');
const item = (t: string, c: string) => B738_CHECKLISTS.find((x) => x.title === t)!.items.find((i) => i.challenge === c)!;
describe('proc probes', () => {
  it('autobrake disarm light after preset / RTO select', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    const t: string[] = [];
    for (let i = 0; i < 15; i++) { r.run(1); t.push(String(v.get(B738.lt.autoBrakeDisarm))); }
    log('ab_disarm per s after ready_to_taxi', t.join(''));
    v.set(B738.autobrake, 0); r.run(3);
    v.set(B738.autobrake, -1); const s: string[] = [];
    for (let i = 0; i < 8; i++) { r.run(0.5); s.push(String(v.get(B738.lt.autoBrakeDisarm))); }
    log('ab_disarm after RTO select (0.5 s steps)', s.join(''));
  });
  it('landing flaps 15 / altimeters F/O mismatch / recall', () => {
    const r = makeB738({ state: 'approach', air: { altFtMsl: 3000, iasKt: 160 } });
    const v = r.vars;
    r.run(5);
    log('LANDING flaps check at flaps 15 (valid landing flap):', item('LANDING', 'Flaps').check!(v));
    v.set('adc2.baro_std', 1);
    for (const k of ['ac.efis2.baro_std']) r.events.emit(k);
    r.run(1);
    log('APPROACH altimeters with F/O STD:', item('APPROACH', 'Altimeters').check!(v), 'adc2.baro_std', v.get('adc2.baro_std'), 'adc3', v.get('adc3.baro_std'), v.get('adc3.baro_inhg'));
    // fail something -> master caution, press master caution to cancel, check "Recall" passes although fault present
    v.set(B738.fuelPump('l_fwd'), 0);
    r.run(3);
    log('pump off: MC', v.get(B738.lt.masterCaution), 'Recall check', item('DESCENT', 'Recall').check!(v));
    press(r, B738.masterCaution(1));
    r.run(1);
    log('after MC reset with fault still present: Recall check', item('DESCENT', 'Recall').check!(v), 'fuel lowpress', v.get(B738.lt.fuelLowPress('l_fwd')));
    press(r, B738.recall(1), 0.3);
    r.run(0.1);
    log('after recall push: MC', v.get(B738.lt.masterCaution), 'fuel six', v.get(B738.lt.group('fuel')));
    // Speedbrake armed check and TOCW for gear lever off etc.
    log('speedbrake lever', v.get(B738.speedbrake), 'armed lt', v.get(B738.lt.speedbrakeArmed));
    log('ldg gear check', item('LANDING', 'Landing gear').check!(v), 'flap lever', v.get(B738.flapLever));
    v.set(B738.flapLever, FLAP_LEVER.f40 ?? 8); r.run(30);
    log('flaps 40 LANDING flaps check', item('LANDING', 'Flaps').check!(v), v.get('surf.flaps_deg'));
    void SPEEDBRAKE;
  });
  it('takeoff preset MCP / FMC state, before start items', () => {
    const r = makeB738({ state: 'takeoff' });
    const v = r.vars;
    r.run(3);
    log('takeoff preset: sel_spd', v.get('ap.sel_spd_kt'), 'v2', v.get('ac.fmc.v2_kt'), 'fd', v.get('ap.fd1_on'), v.get('ap.fd2_on'), 'fma', v.getString('ac.fma.status'), v.getString('ac.fma.roll'), v.getString('ac.fma.pitch'), 'at', v.get('ac.at_arm'), 'sel_alt', v.get('ap.sel_alt_ft'));
    log('takeoff preset: strobes pos', v.get(B738.positionLt), 'taxi', v.get(B738.taxiLt), 'xpdr', v.get(B738.xpdrModeSel), 'eng start', v.get(B738.engStart(1)), 'turnoff', v.get(B738.turnoff(1)), 'apu', v.get('apu.running'), 'lnav armed?', v.getString('ac.fma.roll_armed'), v.getString('ac.fma.pitch_armed'));
    log('takeoff preset: n1 limit', v.get('ac.fmc.n1_limit_pct'), v.getString('ac.fmc.thrust_mode'));
  });
  it('cold dark switch positions', () => {
    const r = makeB738({ state: 'cold_dark' });
    const v = r.vars;
    r.run(2);
    const n = [B738.pack(1), B738.pack(2), B738.bleed(1), B738.bleed(2), B738.recircFan(1), B738.trimAir, B738.isoValve, B738.ydSw, B738.emerExitLt, B738.stbyPwrSw, B738.busXferSw, B738.hydPump('eng1'), B738.hydPump('elec1'), B738.cabUtilSw, B738.ifeSw, B738.positionLt, 'ac.irs1_mode', B738.wxrPower, B738.probeHeat('a'), B738.windowHeat('l_fwd'), B738.adfMode(1), B738.rtpPower(1), B738.xpdrModeSel, B738.parkBrake, B738.gearLever, B738.flapLever, B738.fdDoorLock, B738.door('flt_deck'), B738.door('fwd_entry')];
    log('cold_dark', n.map((k) => `${k.replace('ac.b738.', '')}=${v.get(k)}`).join(' '));
  });
});
import { INPUT, FDM, AP } from '../../../../src/core/vars';
describe('takeoff preset TOGA', () => {
  it('FD speed after liftoff with preset MCP speed', () => {
    const r = makeB738({ state: 'takeoff' });
    const v = r.vars;
    r.run(3);
    v.set(B738.tla(1), 0.25); v.set(B738.tla(2), 0.25); r.run(3);
    press(r, INPUT.toga); r.run(1);
    log('TOGA: fma', v.getString('ac.fma.at'), v.getString('ac.fma.pitch'), 'sel_spd', v.get('ap.sel_spd_kt'), 'fd pitch', v.get(AP.fdPitch).toFixed(1));
    let maxPitch = 0; let lo = false;
    r.run(70, () => {
      const ias = v.get(FDM.ias);
      if (ias > 145) { v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.09 * (v.get(AP.fdPitch) - v.get(FDM.pitch))))); }
      if (v.get('gear.air_ground') === 0) lo = true;
      if (lo) maxPitch = Math.max(maxPitch, v.get(AP.fdPitch));
      return false;
    });
    log('after 70 s: ias', v.get(FDM.ias).toFixed(0), 'alt agl', v.get(FDM.altAgl).toFixed(0), 'fd pitch max', maxPitch.toFixed(1), 'fma', v.getString('ac.fma.pitch'));
  });
});
