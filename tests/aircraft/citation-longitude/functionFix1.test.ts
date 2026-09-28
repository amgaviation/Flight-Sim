/**
 * Function-audit fix round 1 (LON-F-* / LON-PROC-*): each test fails without its fix. Sources: OG = Working Title
 * Longitude Operators Guide, DGAC = DGAC Chile C700 card (2021), BCA = Business & Commercial Aviation 2021.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, type Rig } from './helpers';
import { SimVars } from '../../../src/core/SimVars';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { LONGITUDE_EIS_SIM, STAB_TO_BAND, STAB_RANGE } from '../../../src/aircraft/citation-longitude/createSystems';
import { LongitudePostLogic } from '../../../src/aircraft/citation-longitude/systems/logic';
import { fieldCheck } from '../../../src/aircraft/citation-longitude/performance';
import { FlightPhase } from '../../../src/systems/warning/FlightPhase';

const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level[0]}:${e.text}`);

describe('EIS (LON-F-04 / LON-PROC-07, LON-F-10 / LON-PROC-08)', () => {
  it('SPOILERS indication follows the speedbrake panels in flight', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 260 } });
    const flaps = LONGITUDE_EIS_SIM.sections.find((s) => s.kind === 'flaps');
    expect(flaps && flaps.kind === 'flaps' ? flaps.speedbrakeVar : '').toBe(V.spoilerInd);
    r.run(1);
    r.vars.set(V.tla(1), 0);
    r.vars.set(V.tla(2), 0);
    r.vars.set(V.speedbrake, 1);
    r.run(3);
    expect(r.vars.get(V.spoilerInd)).toBeGreaterThan(0.9);
    r.vars.set(V.speedbrake, 0);
    r.run(3);
    expect(r.vars.get(V.spoilerInd)).toBeLessThan(0.05);
  });

  it('stab-trim green band is the NO TAKEOFF band in degrees (nose up at the top)', () => {
    const trim = LONGITUDE_EIS_SIM.sections.find((s) => s.kind === 'trim');
    const p = trim && trim.kind === 'trim' ? trim.pitch : undefined;
    expect(p?.var).toBe('trim.pitch_units');
    expect([p?.min, p?.max]).toEqual([STAB_RANGE[1], STAB_RANGE[0]]);
    expect([...(p?.takeoffBand ?? [])].sort((a, b) => a - b)).toEqual([...STAB_TO_BAND]);
    // f = (value - min) / (max - min): -7 deg (in band, nose up) is drawn above -2 deg.
    const f = (x: number) => (x - p!.min) / (p!.max - p!.min);
    expect(f(-7)).toBeGreaterThan(f(-2));
  });
});

describe('Electrical (LON-F-05, LON-F-08, LON-F-29)', () => {
  it('BUS TIE in the air toggles an automatically closed tie open (OG 5-5/5-6)', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 30000, iasKt: 260 } });
    const v = r.vars;
    r.run(1);
    expect(v.get('elec.bus_tie_closed')).toBe(0);
    v.set(V.genL, 0); // L GEN off: one-sided -> automatic tie
    r.run(2);
    expect(v.get('elec.bus_tie_closed')).toBe(1);
    v.set(V.busTieBtn, v.get(V.busTieBtn) ? 0 : 1); // press
    r.run(2);
    expect(v.get('elec.bus_tie_closed')).toBe(0);
    v.set(V.busTieBtn, v.get(V.busTieBtn) ? 0 : 1); // press again: closed
    r.run(2);
    expect(v.get('elec.bus_tie_closed')).toBe(1);
  });

  it('STBY PWR amber LED only when the standby battery is not being charged (OG 5-5)', { timeout: 60_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.vars.set(V.stbyPwr, 1);
    r.run(3);
    expect(r.vars.get(V.stbyBattLed)).toBe(0); // generators online: charging
    const c = makeRig('cold_dark', { avionics: false });
    c.vars.set(V.battL, 1);
    c.vars.set(V.battR, 1);
    c.vars.set(V.stbyPwr, 1);
    c.run(3);
    expect(c.vars.get(V.stbyBattLed)).toBe(1); // batteries only: not charging
  });

  it('GEN LOAD uses the ground rating (400 A) for the engine generators on the ground (OG 5-3)', () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.run(1);
    r.vars.set('elec.gen_l_amps', 350);
    r.sys.logic.update(1 / 60);
    expect(r.vars.get(V.genLoadPct('l'))).toBeCloseTo(87.5, 1);
  });
});

describe('Hydraulics PTCU HYD GEN source (LON-F-06)', () => {
  it('HYD GEN sources System B by default; away 1..30 s and back toggles to A; a later selection is B again', { timeout: 60_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    r.run(6); // NORM for a while after power-up: must not pre-arm a toggle
    v.set(V.ptcu, 4);
    r.run(1);
    expect(v.getString(V.ptcuMode)).toBe('GEN B');
    v.set(V.ptcu, 2);
    r.run(2);
    v.set(V.ptcu, 4);
    r.run(1);
    expect(v.getString(V.ptcuMode)).toBe('GEN A');
    v.set(V.ptcu, 2);
    r.run(40);
    v.set(V.ptcu, 4);
    r.run(1);
    expect(v.getString(V.ptcuMode)).toBe('GEN B');
  });
});

describe('Lighting (LON-F-07 / LON-PROC-11)', () => {
  it('NAV lights come on and the beacon goes to NORM when the G5000 powers up (OG 16-3)', { timeout: 60_000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    r.run(1);
    expect(v.get(V.ltNav)).toBe(0);
    v.set(V.ltBeaconMode, 0);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(3);
    expect(v.get('elec.pfd1_powered')).toBe(1);
    expect(v.get(V.ltNav)).toBe(1);
    expect(v.get(V.ltBeaconMode)).toBe(1);
    // The GTC toggle still works afterwards.
    v.set(V.ltNav, 0);
    r.run(1);
    expect(v.get(V.ltNav)).toBe(0);
  });
});

describe('Autothrottle (LON-F-09, LON-F-16 / LON-PROC-21) and EDM (LON-F-15 / LON-PROC-04)', () => {
  it('A/T engaged, throttles advanced to takeoff by hand: HOLD on the ground, levers not retarded (OG 7-5)', { timeout: 120_000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: true });
    const v = r.vars;
    r.run(1);
    r.events.emit('at.engage');
    r.run(0.5);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    let minTla = 1;
    let mode = '';
    r.run(40, () => {
      minTla = Math.min(minTla, v.get(V.tla(1)));
      if (v.get('adc1.ias_kt') > 40 && !mode) mode = v.getString('ap.at_mode');
      return v.get('adc1.ias_kt') > 80;
    });
    expect(mode).toBe('HOLD');
    expect(minTla).toBeGreaterThan(0.95);
  });

  it('MIN SPD: slowing toward the shaker with the throttles at idle engages the A/T and advances them; speedbrake stows (OG 7-5, BCA)', { timeout: 120_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: true, air: { altFtMsl: 15000, iasKt: 200 } });
    const v = r.vars;
    r.run(1);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set(V.speedbrake, 1);
    let seen = false;
    let maxTla = 0;
    r.run(120, () => {
      // Hold the nose up to bleed off speed (stick back, level-ish).
      v.set('input.pitch', v.get('fdm.pitch_deg') < 8 ? 0.3 : 0);
      if (v.get(V.atProt) === 1) seen = true;
      if (seen) maxTla = Math.max(maxTla, v.get(V.tla(1)));
      return seen && maxTla > 0.5;
    });
    expect(seen).toBe(true);
    expect(v.get('ap.at_engaged')).toBe(1);
    expect(maxTla).toBeGreaterThan(0.5);
    expect(v.get(V.sbAutoStow)).toBe(1);
  });

  it('EDM: cabin above 14,700 ft with the AP engaged above FL300 turns 90 deg left and descends to 15,000 ft in FLC (BCA)', { timeout: 180_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: true, air: { altFtMsl: 41000, iasKt: 230 } });
    const v = r.vars;
    r.run(2);
    r.events.emit('g3k.gmc.key_ap');
    r.run(2);
    expect(v.get('ap.engaged')).toBe(1);
    const hdg0 = v.get('ahrs1.hdg_mag_deg');
    v.set(V.pressDump, 1);
    const t = r.run(150, () => v.get(V.edmActive) === 1);
    expect(t).toBeLessThan(150);
    expect(v.getString('ap.lat_active')).toBe('HDG');
    expect(v.getString('ap.vert_active')).toBe('FLC');
    expect(v.get('ap.sel_alt_ft')).toBe(15000);
    const d = (((hdg0 - 90 - v.get('ap.sel_hdg_deg')) % 360) + 540) % 360 - 180;
    expect(Math.abs(d)).toBeLessThan(1.5);
    expect(posted(r)).toContain('a:EMERGENCY DESCENT');
    r.run(30);
    expect(v.get('adc1.vs_fpm')).toBeLessThan(-1500);
    // Pilot takeover: AP off ends EDM.
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get(V.edmActive)).toBe(0);
  });
});

describe('Brakes (LON-F-03, LON-F-14)', () => {
  it('EMER/PARK BRAKE stops the airplane after a BRAKE FAIL (normal path failed; DGAC card)', { timeout: 120_000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: false });
    const v = r.vars;
    v.set(V.tla(1), 0.6);
    v.set(V.tla(2), 0.6);
    r.run(60, () => v.get('adc1.ias_kt') > 55);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set('fail.brakes.left', 1);
    v.set('fail.brakes.right', 1);
    r.run(1);
    expect(posted(r).some((m) => m.endsWith('BRAKE FAIL'))).toBe(true);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    r.run(0.5);
    expect(v.get('brakes.psi_left')).toBe(0); // normal path gone
    v.set(V.parkBrake, 0.6);
    const t = r.run(40, () => v.get('fdm.gs_kt') < 1);
    expect(t).toBeLessThan(40);
  });

  it('the handle meters the emergency pressure; PARK latches only at full travel (OG 14-3)', { timeout: 60_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    const psiAt = (h: number) => {
      v.set(V.parkBrake, h);
      r.run(0.5);
      return v.get('brakes.psi_left');
    };
    const p15 = psiAt(0.15);
    expect(v.get('brakes.parking_set')).toBe(0);
    const p50 = psiAt(0.5);
    const p100 = psiAt(1);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(p15).toBeLessThan(p50);
    expect(p50).toBeLessThan(p100);
    expect(p15).toBeCloseTo(0.15 * 3000, -2);
  });
});

describe('Pitch trim (LON-F-13 / LON-PROC-19, LON-PROC-31)', () => {
  it('MASTER DISCONNECT held stops a primary runaway; SECONDARY TRIM retrims and stops it for good', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(1);
    v.set('fail.trim.pitch.runaway', 1);
    const s0 = v.get('trim.pitch_units');
    r.run(1);
    expect(Math.abs(v.get('trim.pitch_units') - s0)).toBeGreaterThan(0.05); // running away
    expect(posted(r)).toContain('c:PITCH TRIM FAIL');
    v.set(V.yokeDiscL, 1);
    const s1 = v.get('trim.pitch_units');
    r.run(2);
    expect(v.get('trim.pitch_units')).toBeCloseTo(s1, 3); // interrupted while held
    v.set(V.stabSecArm, 1);
    v.set(V.stabSecSw, 1); // secondary NOSE UP while DISC is still held
    r.run(2);
    const s2 = v.get('trim.pitch_units');
    expect(s2).toBeLessThan(s1 - 0.1); // nose up = more negative incidence
    v.set(V.stabSecSw, 0);
    v.set(V.yokeDiscL, 0);
    r.run(2);
    expect(v.get('trim.pitch_units')).toBeCloseTo(s2, 3); // primary disengaged: runaway gone
  });

  it('stab trim breakers: pulling STAB TRIM PRI 1 removes channel 1', { timeout: 60_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    r.run(1);
    v.set('cb.stab_trim_pri1', 0);
    const s0 = v.get('trim.pitch_units');
    v.set(V.yokeTrimL, 1);
    r.run(1);
    expect(v.get('trim.pitch_units')).toBeCloseTo(s0, 3);
    v.set(V.stabChan, 2);
    r.run(1);
    expect(v.get('trim.pitch_units')).toBeLessThan(s0 - 0.05);
    v.set(V.yokeTrimL, 0);
  });

  it('PITCH/ROLL DISC CAS with the handle pulled (EST)', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    r.vars.set(V.pitchRollDisc, 1);
    r.run(2);
    expect(posted(r)).toContain('c:PITCH/ROLL DISC');
  });
});

describe('Air conditioning (LON-F-12, LON-F-23, LON-F-34)', () => {
  it('HEAT EXCHG ONLY cannot cool below the RAT; an ACM fault switches to heat-exchanger mode with the amber message', { timeout: 120_000 }, () => {
    const hot = (mode: number) => {
      const r = makeRig('ready_to_taxi', { avionics: false, seaLevelTempC: 38 });
      r.vars.set(V.ecsMode, mode);
      r.vars.set(V.cabinSetC, 16);
      r.run(60);
      return { outlet: r.vars.get('pneu.pack_outlet_c'), tat: r.vars.get('fdm.tat_c') };
    };
    const norm = hot(0);
    const hx = hot(2);
    expect(norm.outlet).toBeLessThan(norm.tat - 5);
    expect(hx.outlet).toBeGreaterThan(hx.tat - 1);
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    r.run(1);
    r.vars.set('fail.ecs.acm', 1);
    r.run(2);
    expect(r.vars.get(V.ecsAutoHx)).toBe(1);
    expect(posted(r)).toContain('c:HEAT EXCHG ONLY');
  });

  it('APU-only bleed gives 60 % of the ACS flow in FLOW NORM, 100 % in HIGH (OG 10-4)', { timeout: 60_000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set('pneu.eng1_valve_open', 0);
    v.set('pneu.eng2_valve_open', 0);
    v.set('pneu.apu_valve_open', 1);
    v.set(V.flow, 0);
    r.sys.logic.update(1 / 60);
    expect(v.get(V.ecsPackFlowKgs)).toBeCloseTo(0.6 * 0.55, 3);
    v.set(V.flow, 1);
    r.sys.logic.update(1 / 60);
    expect(v.get(V.ecsPackFlowKgs)).toBeCloseTo(0.55, 3);
  });
});

describe('APU, engines, FADEC (LON-F-18, LON-F-30 / LON-PROC-29, LON-PROC-10, LON-PROC-18, LON-F-28, LON-F-33)', () => {
  it('APU start above FL310 is inhibited (OG 8-2)', { timeout: 120_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 41000, iasKt: 230 } });
    r.vars.set(V.apuKnob, 2);
    r.run(60);
    expect(r.vars.get('apu.avail')).toBe(0);
  });

  it('start with no starter air aborts after 10 s with ENG START ABORT (OG 7-5)', { timeout: 60_000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.controlLock, 0);
    r.run(2);
    v.set(V.runL, 1);
    v.set(V.startL, 1);
    r.run(0.3);
    v.set(V.startL, 0);
    r.run(12);
    expect(v.get('fadec.eng1.abort')).toBe(1);
    expect(v.getString('fadec.eng1.abort_reason')).toBe('NO ROTATION');
    expect(posted(r)).toContain('a:ENG START ABORT L');
  });

  it('FADEC fault posts ENG CONTROL FAULT (EST text)', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    r.vars.set('fail.fadec.eng1', 1);
    r.run(2);
    expect(posted(r)).toContain('c:ENG CONTROL FAULT L');
  });

  it('cross-bleed start: running engine at idle gives < 32 psi under the starter; IDLE + 25 % N1 gives >= 32 psi (OG 17-11/17-12)', { timeout: 180_000 }, () => {
    const duct = (lever: number) => {
      const r = makeRig('ready_to_taxi', { avionics: false });
      const v = r.vars;
      v.set(V.apuKnob, 0);
      v.set(V.runL, 0);
      r.run(40); // left engine spun down
      v.set(V.tla(2), lever);
      r.run(15);
      v.set(V.runL, 1);
      v.set(V.startL, 1);
      r.run(0.3);
      v.set(V.startL, 0);
      let psi = 0;
      r.run(3, () => void (psi = v.get('pneu.l_man_psi')));
      return { psi, n1: v.get('eng2.n1_pct') };
    };
    const idle = duct(0);
    expect(idle.psi).toBeLessThan(32);
    const adv = duct(0.3);
    expect(adv.n1).toBeGreaterThan(idle.n1 + 20);
    expect(adv.psi).toBeGreaterThanOrEqual(32);
  });

  it('ENG EXCEEDANCE stays latched after the parameter recovers (OG 3-5)', () => {
    const v = new SimVars();
    const post = new LongitudePostLogic(v);
    post.reset();
    v.set('eng1.running', 1);
    v.set('eng1.itt_c', 990);
    for (let i = 0; i < 90; i++) post.update(1 / 60);
    expect(v.get(V.engExceed(1))).toBe(1);
    v.set('eng1.itt_c', 700);
    for (let i = 0; i < 60; i++) post.update(1 / 60);
    expect(v.get(V.engExceed(1))).toBe(1);
    post.reset();
    post.update(1 / 60);
    expect(v.get(V.engExceed(1))).toBe(0);
  });

  it('wing anti-ice valves open 4 s after WING is selected, and the idle rises (OG 12-3)', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(1);
    v.set(V.aiWing, 1);
    r.run(2);
    expect(v.get(V.waiValvesOpen)).toBe(0);
    expect(v.get('fadec.eng1.idle_mode')).toBe(2);
    r.run(3);
    expect(v.get(V.waiValvesOpen)).toBe(1);
  });
});

describe('CAS logic (LON-F-24, LON-F-25, LON-F-26, LON-F-27)', () => {
  it('GEN OFF APU with the engine generators online (OG 3-8)', { timeout: 60_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.vars.set(V.apuKnob, 1);
    r.vars.set(V.apuKnob, 2);
    r.run(60);
    r.vars.set(V.apuKnob, 1);
    r.vars.set(V.genApu, 0);
    r.run(3);
    expect(r.vars.get('apu.avail')).toBe(1);
    expect(posted(r)).toContain('c:GEN OFF APU');
  });

  it('P/S BUTTON ON: red replaces amber after 2 min, never both', { timeout: 200_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.vars.set(V.pitotStatic, 1);
    r.run(10);
    expect(posted(r)).toContain('c:P/S BUTTON ON');
    r.run(125);
    expect(posted(r)).toContain('w:P/S BUTTON ON');
    expect(posted(r)).not.toContain('c:P/S BUTTON ON');
  });

  it('TOPI (OG 3-3): latched from 85 kt, kept below 85 kt on a rejected takeoff until 50 kt; cancelled by the throttles leaving T/O', () => {
    const v = new SimVars();
    const ph = new FlightPhase({ vars: v } as never, {
      takeoffInhibit: { fromKt: 85, toFt: 400, maxAfterLiftoffS: 30, latch: { brakeFail: 'bf', brakeFailKt: 30, cancelBelowKt: 50, cancelBelowKtBrakeFail: 30, maxActiveS: 90, cancelWhen: '!to' } },
      landingInhibit: { belowFt: 400, untilKt: 50, latch: { cancelAboveFt: 500, maxGroundS: 30, maxActiveS: 90 } },
    });
    v.set('gear.air_ground', 1);
    v.set('to', 1);
    const at = (kt: number) => {
      v.set('adc1.ias_kt', kt);
      ph.update(0.1);
      return ph.takeoffInhibit;
    };
    expect(at(80)).toBe(false);
    expect(at(86)).toBe(true);
    expect(at(80)).toBe(true); // RTO: still inhibited below 85 kt
    expect(at(60)).toBe(true);
    expect(at(45)).toBe(false);
    expect(at(86)).toBe(true);
    v.set('to', 0);
    expect(at(90)).toBe(false);
    // Brake failure above 30 kt sets TOPI.
    v.set('to', 1);
    at(20);
    v.set('bf', 1);
    expect(at(35)).toBe(true);
  });

  it('TOLD flags a field above the takeoff / landing altitude limit', () => {
    expect(fieldCheck(15000, 5000, 9000)).toBe('FIELD ELEV > LIMIT');
    expect(fieldCheck(1000, 5000, 9000)).toBe('RWY OK');
  });
});

describe('Audio / oxygen (LON-F-17 / LON-PROC-20)', () => {
  it('MIC SEL MASK with the mask on makes the mask mic live; MIC/INPH outboard makes the intercom hot', { timeout: 60_000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    v.set(V.oxyMaskL, 1);
    r.run(0.5);
    expect(v.get(V.maskMicLiveL)).toBe(0);
    expect(v.get(V.intercomHotL)).toBe(0);
    v.set(V.micSelL, 1);
    v.set(V.micInphL, 1);
    r.run(0.5);
    expect(v.get(V.maskMicLiveL)).toBe(1);
    expect(v.get(V.intercomHotL)).toBe(1);
  });
});
