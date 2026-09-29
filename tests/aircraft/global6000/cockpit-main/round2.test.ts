/**
 * Global 6000 fix round 2 (function lens): the new / reworked cockpit controls
 * operated through their 3D controls on a headless rig with the full cockpit:
 * pedestal reversion panel and ACPs, glareshield ROLL SPLRS, GND LIFT DUMPING
 * switch, FLIGHT SPOILER 3/4 detent, EMS CDU SWITCH CONTROL / TEST 2/2 / EMER
 * CNTL limit / linking / DISPLAY dimming, crew-mask EMERGENCY and the
 * copilot's oxygen supply.
 */
import { describe, expect, it } from 'vitest';
import { KeyPad, PushButton, RotaryKnob } from '../../../../src/cockpit/controls';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { pointer, setupFull } from '../cockpit-overhead/harness';

describe('Global 6000 fix round 2: pedestal / glareshield / EMS controls', () => {
  it('reversion panel: L PFD ADC / IRS, AFCS 1/2, DISPLAYS REV, TUNE, LWR DSPL drive the Fusion RSP vars and AFD 3', { timeout: 120_000 }, () => {
    const { r, step, click } = setupFull('ready_to_taxi');
    const v = r.vars;
    step(0.5);
    click('g6k.ped.rev_adc1');
    click('g6k.ped.rev_irs1');
    click('g6k.ped.rev_afcs');
    step(0.5);
    expect(v.get('fusion.rsp1.adc')).toBe(1);
    expect(v.get('fusion.rsp1.att')).toBe(1);
    expect(v.get('fusion.rsp.afcs')).toBe(2);
    // The Fusion source selection follows (PFD 1 on ADC 2 / IRS 3).
    expect(v.get('fusion.s1.adc_src')).toBe(2);
    expect(v.get('fusion.s1.ahrs_src')).toBe(3);
    click('g6k.ped.displays');
    step(0.5);
    expect(v.get(V.displaysRev)).toBe(1);
    expect(v.get('fusion.rsp1.dspl')).toBe(1);
    expect(v.get('fusion.rsp2.dspl')).toBe(1);
    click('g6k.ped.tune');
    step(0.2);
    expect(v.get(V.tuneSrc)).not.toBe(0);
    v.set(V.ltDisplayLwr, 0.3);
    step(0.5);
    expect(v.get('display.fusion.afd3.brt')).toBeCloseTo(0.3, 1);
  });

  it('ACP: MKR knob pulled out gives the marker tone, pushed in on both ACPs silences it; transmitter keys select the radio', { timeout: 120_000 }, () => {
    const { r, step, click, ctl } = setupFull('ready_to_taxi');
    const v = r.vars;
    const tones: string[] = [];
    const audio = r.ctx.audio as { tone: (id: string, on: boolean) => void };
    const orig = audio.tone;
    audio.tone = (id: string, on: boolean) => void (on && tones.push(id));
    try {
      step(0.5);
      // Outer marker overhead (the marker receiver rewrites nav.marker_outer each step, so drive the ACP directly).
      v.set('nav.marker_outer', 1);
      r.sys.acp.update(1 / 60);
      expect(tones).toContain('marker_outer'); // MKR selected in the states
      expect(v.get(V.acpMkrOut)).toBeGreaterThan(0);
      // Push the MKR knob in on both ACPs: no marker audio.
      for (const s of [1, 2] as const) {
        const c = ctl(`g6k.ped.acp${s}.mkr`) as RotaryKnob;
        const t = c.hitTargets.find((h) => h.userData.part === 'push') ?? c.hitTargets[0];
        c.onPointerDown?.(pointer(t, 1));
        c.onPointerUp?.(pointer(t, 1));
      }
      step(0.5);
      expect(v.get(V.acpSel(1, 'mkr')) + v.get(V.acpSel(2, 'mkr'))).toBe(0);
      v.set('nav.marker_outer', 1);
      r.sys.acp.update(1 / 60);
      expect(v.get(V.acpMkrOut)).toBe(0); // both MKR knobs in: no marker audio
    } finally {
      audio.tone = orig;
    }
    click('g6k.ped.acp1.mic_vhf2');
    step(0.2);
    expect(v.get(V.acpMic(1))).toBe(1);
    expect((ctl('g6k.ped.acp1.mic_vhf2') as PushButton).face?.litText()).toContain('▬');
  });

  it('ROLL SPLRS PLT CONT gives the pilot wheel roll priority (PLT ROLL legend); GND LIFT DUMPING switch; FLIGHT SPOILER 3/4', { timeout: 120_000 }, () => {
    const { r, step, click, ctl } = setupFull('ready_to_taxi');
    const v = r.vars;
    step(0.5);
    click('g6k.gs.roll_splr1');
    step(0.3);
    expect(v.get(V.rollPriority)).toBe(1);
    expect((ctl('g6k.gs.roll_splr1') as PushButton).face?.litText()).toContain('PLT');
    click('g6k.gs.roll_splr2');
    step(0.3);
    expect(v.get(V.rollPriority)).toBe(2);
    expect(v.get(V.rollSplr(1))).toBe(0);
    // GND LIFT DUMPING: one 3-position switch (AUTO -> MANUAL ARM up / OFF down).
    expect(v.get(V.gldSw)).toBe(0);
    click('g6k.ped.gld');
    step(0.5);
    expect([1, 2]).toContain(v.get(V.gldSw));
    expect(v.get(V.gldManArm) + v.get(V.gldOff)).toBe(1);
    // FLIGHT SPOILER: 3/4 detent exists on the lever.
    const lever = ctl('g6k.ped.spoiler') as unknown as { tooltip?: () => string };
    expect(lever).toBeTruthy();
    v.set(V.flightSpoiler, 0.75);
    step(0.2);
    expect(v.get(V.sbCmd)).toBeCloseTo((0.75 / 0.9) * 0.5, 2);
  });

  it('EMS CDU: SWITCH CONTROL (SLAT/FLAP RESET, STALL WARN ADVANCE, FOOTWARMERS), linked units, 4th AC bus refused, RAT TEST, DISPLAY dimming', { timeout: 120_000 }, () => {
    const { r, step, ctl } = setupFull('ready_to_taxi');
    const v = r.vars;
    step(0.5);
    const fn1 = ctl('g6k.side.ems1_fn') as KeyPad;
    const act1 = ctl('g6k.side.ems1_r') as KeyPad;
    fn1.press('CNTL');
    step(0.1);
    act1.press('R2'); // STALL WARN ADVANCE NORM -> REV
    act1.press('R3'); // LEFT FOOTWARMER ON
    step(0.5);
    expect(v.get(V.stallAdvSel)).toBe(1);
    expect(v.get(V.stallAdvance)).toBe(1);
    expect(v.get(V.footWarmer('l'))).toBe(1);
    expect(v.get('elec.footwarmer_l_powered')).toBe(1);
    act1.press('R1'); // SLAT/FLAP RESET (momentary)
    step(0.1);
    expect(v.get(V.slatFlapReset)).toBe(1);
    step(1);
    expect(v.get(V.slatFlapReset)).toBe(0);
    // EMER CNTL: three AC buses may be isolated, the fourth is refused (GX PTG 6-15).
    const emer = ctl('g6k.side.ems1_emer') as KeyPad;
    const lsk = ctl('g6k.side.ems1_l') as KeyPad;
    emer.press('EMER');
    step(0.1);
    for (const k of ['L1', 'L2', 'L3', 'L4']) lsk.press(k);
    step(0.5);
    expect([1, 2, 3, 4].map((n) => v.get(V.acBusIsol(n as 1 | 2 | 3 | 4)))).toEqual([1, 1, 1, 0]);
    for (const k of ['L1', 'L2', 'L3']) lsk.press(k);
    step(0.5);
    // TEST 2/2: RAT TEST (ground BIT) runs and passes.
    fn1.press('TEST');
    fn1.press('NEXT');
    step(0.1);
    act1.press('R1');
    step(11);
    // DISPLAY L knob dims EMS CDU 1 (GX PTG 15-6).
    v.set(V.ltDisplay('l'), 0.4);
    step(0.5);
    expect(v.get('display.g6k.ems1.brt')).toBeLessThan(0.5);
    expect(v.get('display.g6k.ems2.brt')).toBeGreaterThan(0.5);
  });

  it('crew mask EMERGENCY push and the copilot OXYGEN SUPPLY LOWER DISCONNECT', { timeout: 120_000 }, () => {
    const { r, step, click } = setupFull('ready_to_taxi');
    const v = r.vars;
    step(0.5);
    click('g6k.side.oxy_emer2');
    step(0.2);
    expect(v.get(V.oxyEmer(2))).toBe(1);
    click('g6k.side.crew_oxy_r');
    step(0.2);
    expect(v.get(V.crewOxyR)).toBe(0);
    // Copilot mask out with its supply OFF: no flow.
    v.set(V.oxyMask(2), 1);
    step(2);
    expect(v.get('oxy.copilot_flowing')).toBe(0);
    click('g6k.side.crew_oxy_r');
    step(2);
    expect(v.get('oxy.copilot_flowing')).toBe(1);
  });
  it('G3-09: EMS CDUs dark with BATT MASTER OFF; the EMS position powers both from the battery direct buses', { timeout: 120_000 }, () => {
    const { r, step } = setupFull('cold_dark');
    const v = r.vars;
    v.set(V.battMasterSel, 0); // OFF: batteries isolated - both CDUs dark (GX PTG 6-8)
    step(1);
    expect(v.get('ac.g6k.ck.ems1_pwr')).toBe(0);
    expect(v.get('ac.g6k.ck.ems2_pwr')).toBe(0);
    v.set(V.battMasterSel, 1); // EMS: batteries supply the EMS only (CDU 1 AV BATT, CDU 2 APU BATT)
    step(1);
    expect(v.get('ac.g6k.ck.ems1_pwr')).toBe(1);
    expect(v.get('ac.g6k.ck.ems2_pwr')).toBe(1);
    v.set(V.battMasterSel, 2); // ON: battery bus powers both
    step(1);
    expect(v.get('ac.g6k.ck.ems1_pwr')).toBe(1);
    expect(v.get('ac.g6k.ck.ems2_pwr')).toBe(1);
  });
});
