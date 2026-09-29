/**
 * KAP 140 (POH 172SPHUS Supplement 15) behaviour on the c172-steam systems: power-up self test,
 * engagement in ROL / VS, heading / altitude preselect / UP-DN, manual electric trim split
 * switch, A/P DISC / TRIM INT, disconnect tone, turn coordinator loss (red R), baro setting.
 */
import { describe, expect, it } from 'vitest';
import { AP, FDM, ADC } from '../../../src/core/vars';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { EV, KAP, KMA, ST } from '../../../src/aircraft/c172-steam/vars';
import { KAP_TIMING } from '../../../src/aircraft/c172-steam/avionics/kap140';
import { makeSteamRig, press, type SteamRig } from './rig';

const cruise = (): SteamRig => makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
const wrap180 = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;

describe('KAP 140 autopilot (Supplement 15)', () => {
  it('runs the preflight self test on power application and keeps the red P ~30 s', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(C172.masterBat, 1);
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    // Audio panel ON (OFF/EMG would silence the disconnect tone test, Supplement 15 limitation 4).
    v.set(KMA.power, 1);
    let sawPft = 0;
    let sawDisplayTest = false;
    let pitchTrimLamp = false;
    r.run(10, () => {
      const p = v.get(KAP.pft);
      if (p > 0 && p < 99) sawPft = Math.max(sawPft, p);
      if (p === 99) sawDisplayTest = true;
      if (v.get(KAP.pitchTrimLamp) > 0.5) pitchTrimLamp = true;
    });
    expect(sawPft).toBe(KAP_TIMING.pftSteps);
    expect(sawDisplayTest).toBe(true);
    expect(pitchTrimLamp).toBe(true);
    expect(r.log.toneOn).toContain('ap_disconnect');
    // Red P during the ~30 s after the test: the AP cannot be engaged.
    expect(v.get(KAP.pLamp)).toBe(1);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(0);
    r.run(KAP_TIMING.pLampAfterPowerS + 1);
    expect(v.get(KAP.pLamp)).toBe(0);
    // Baro flashes until checked (Supplement 15 Sec 4 A.4).
    expect(v.get(KAP.baroFlash)).toBe(1);
    press(r, KAP.baro);
    expect(v.get(KAP.baroFlash)).toBe(0);
  });

  it('engages in ROL and VS, holds the vertical speed reference and the wings level', () => {
    const r = cruise();
    const v = r.vars;
    expect(v.get('ac.kap140.ready')).toBe(1);
    r.run(2);
    r.events.emit(EV.kap('ap'));
    r.run(0.1);
    expect(v.get(AP.engaged)).toBe(1);
    expect(r.sys.afcs.lat).toBe('ROL');
    expect(r.sys.afcs.vert).toBe('VS');
    const alt0 = v.get(FDM.altMsl);
    r.run(60);
    expect(Math.abs(v.get(FDM.altMsl) - alt0)).toBeLessThan(150);
    expect(Math.abs(v.get(FDM.bank))).toBeLessThan(5);
  });

  it('flies the heading bug in HDG and captures a preselected altitude with ALT', () => {
    const r = cruise();
    const v = r.vars;
    r.run(2);
    r.events.emit(EV.kap('ap'));
    r.run(0.1);
    const hdg0 = v.get(ST.dgHeading);
    v.set(AP.selHeading, (hdg0 + 60) % 360);
    r.events.emit(EV.kap('hdg'));
    r.run(0.1);
    expect(r.sys.afcs.lat).toBe('HDG');
    // Preselect 6500 ft with the inner knob (5 x 100 ft): ARM is automatic when engaged.
    r.events.emit(`${EV.kapAltInner}.inc`, 5);
    r.run(0.1);
    expect(v.get(AP.selAltitude)).toBe(6500);
    expect(v.get(KAP.armSel)).toBe(1);
    // UP x 5 = +500 fpm.
    for (let i = 0; i < 5; i++) press(r, KAP.up, 0.1);
    expect(v.get(AP.selVs)).toBe(500);
    expect(v.get(KAP.field)).toBe(1);
    r.run(150);
    expect(Math.abs(wrap180(v.get(ST.dgHeading) - (hdg0 + 60)))).toBeLessThan(5);
    expect(r.sys.afcs.vert === 'ALT' || r.sys.afcs.vert === 'ALTS').toBe(true);
    expect(Math.abs(v.get(ADC.baroAlt(1)) - 6500)).toBeLessThan(80);
  });

  it('manual electric trim needs both halves of the split switch; it disconnects the AP', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    const t0 = v.get(C172.trimPosition);
    v.set(ST.metLeft, 1);
    r.run(2);
    expect(v.get(C172.trimPosition)).toBeCloseTo(t0, 4);
    v.set(ST.metRight, 1);
    r.run(2);
    expect(v.get(C172.trimPosition)).toBeGreaterThan(t0 + 0.1);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 0);
    r.run(0.5);
    // One half alone for 5 s: trim monitor -> red PT.
    v.set(ST.metRight, -1);
    r.run(KAP_TIMING.metMonitorS + 0.5);
    expect(v.get(KAP.pt)).toBe(2);
    v.set(ST.metRight, 0);
    r.run(0.5);
    // With the AP engaged, the trim switch disengages it.
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(1);
    v.set(ST.metLeft, -1);
    v.set(ST.metRight, -1);
    r.run(0.3);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 0);
    expect(v.get(AP.engaged)).toBe(0);
  });

  it('A/P DISC disengages with the AP flash and a ~2 s tone; TURN COORD loss lights R', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(1);
    r.log.toneOn.length = 0;
    press(r, ST.apDisc, 0.2);
    expect(v.get(AP.engaged)).toBe(0);
    expect(v.get(KAP.apFlash)).toBe(1);
    expect(r.log.toneOn).toContain('ap_disconnect');
    r.run(2.5);
    expect(r.log.tones.get('ap_disconnect')).toBe(false);
    // Re-engage, then pull the TURN COORD breaker: R lamp, AP disengages, cannot re-engage.
    r.run(5);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(1);
    v.set('cb.turn_coord', 0);
    r.run(0.5);
    expect(v.get(KAP.rLamp)).toBe(1);
    expect(v.get(AP.engaged)).toBe(0);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(0);
  });

  it('pulling the AUTO PILOT breaker removes the autopilot and the manual electric trim', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    v.set('cb.autopilot', 0);
    r.run(0.5);
    expect(v.get(KAP.on)).toBe(0);
    const t0 = v.get(C172.trimPosition);
    v.set(ST.metLeft, 1);
    v.set(ST.metRight, 1);
    r.run(2);
    expect(v.get(C172.trimPosition)).toBeCloseTo(t0, 4);
  });
});
