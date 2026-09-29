/**
 * Fix round 1 (function lens): each test fails without its fix. Sources are cited in the systems code.
 */
import { describe, expect, it } from 'vitest';
import { ADC, ENG } from '../../../src/core/vars';
import { B738, XPDR_SEL, SPEEDBRAKE } from '../../../src/aircraft/b737-800/vars';
import { B737_VARS } from '../../../src/avionics/boeing-737/vars';
import { makeB738, press } from './helpers';

const air = { altFtMsl: 12000, iasKt: 260, headingTrue: 90 };

describe('737-800 fix round 1: engines', () => {
  it('F01/F02: EEC hard ALTN raises N1 at the same lever; soft ALTN on air data loss (ON + ALTN lit), hard at idle', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(6);
    const n1Norm = v.get(ENG.n1Cmd(1));
    const tla = v.get(B738.fadecTla(1));
    expect(v.get(B738.lt.eecOn(1))).toBe(1);
    expect(v.get(B738.lt.eecAltn(1))).toBe(0);
    v.set(B738.eec(1), 0); // ALTN selected
    r.run(1);
    expect(v.get(B738.eecMode(1))).toBe(2);
    expect(v.get(ENG.n1Cmd(1))).toBeGreaterThan(n1Norm + 1.5 * tla);
    expect(v.get(B738.lt.eecAltn(1))).toBe(1);
    expect(v.get(B738.lt.eecOn(1))).toBe(0);
    v.set(B738.eec(1), 1);
    r.run(1);
    expect(v.get(B738.eecMode(1))).toBe(0);
    // Soft ALTN: both ADIRU air data lost with the switch ON.
    v.set('fail.adc1', 1);
    v.set('fail.adc2', 1);
    r.run(2);
    expect(v.get(B738.eecMode(1))).toBe(1);
    expect(v.get(B738.lt.eecOn(1))).toBe(1);
    expect(v.get(B738.lt.eecAltn(1))).toBe(1);
    // Lever to idle in soft ALTN -> hard ALTN.
    v.set('ac.at_arm', 0);
    v.set(B738.tla(1), 0);
    r.run(1);
    expect(v.get(B738.eecMode(1))).toBe(2);
  });

  it('F03: approach idle with engine anti-ice (not with the gear down)', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 250, headingTrue: 90 } });
    const v = r.vars;
    r.run(3);
    expect(v.get('fadec.eng1.idle_mode')).toBe(1);
    v.set(B738.engAi(1), 1);
    r.run(0.5);
    expect(v.get('fadec.eng1.idle_mode')).toBe(2);
    v.set(B738.engAi(1), 0);
    v.set(B738.gearLever, 1);
    r.run(12);
    expect(v.get('gear.down_locked')).toBe(1);
    expect(v.get('fadec.eng1.idle_mode')).toBe(1);
  });

  it('F15: reverser 1 on system A (standby at half rate), reverser 2 on B', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    v.set('fail.hyd.edp_a', 1);
    v.set('fail.hyd.emdp_a', 1);
    r.run(20, () => v.get('hyd.a_psi') < 500);
    r.run(1);
    for (const i of [1, 2] as const) {
      v.set(B738.tla(i), 0);
      v.set(B738.revLever(i), 0.5);
    }
    r.run(1.2);
    // Standby pressure is not normally available (no STBY RUD / ALTN FLAPS): reverser 1 stays stowed.
    expect(v.get(ENG.reverserPos(1))).toBeLessThan(0.05);
    expect(v.get(ENG.reverserPos(2))).toBeGreaterThan(0.4);
  });

  it('F30: ENGINE START FLT fires both igniters regardless of IGNITION select', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    v.set(B738.ignSel, -1); // IGN L
    v.set(B738.engStart(1), 2); // CONT: selected igniter only
    r.run(0.3);
    expect(v.get('eng1.igniters_l')).toBe(1);
    expect(v.get('eng1.igniters_r')).toBe(0);
    v.set(B738.engStart(1), 3); // FLT: both
    r.run(0.3);
    expect(v.get('eng1.igniters_l')).toBe(1);
    expect(v.get('eng1.igniters_r')).toBe(1);
  });

  it('PROC-02: engine flameout / severe damage / surge / oil loss failures', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(4);
    v.set('fail.eng1.flameout', 1);
    r.run(20);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get(ENG.n2(1))).toBeLessThan(40);
    expect(v.get('elec.idg1_online')).toBe(0);
    // Relight after the failure clears: FLT ignition, windmill / starter assisted (QRH 7.1 in-flight start).
    v.set('fail.eng1.flameout', 0);
    v.set(B738.engStart(1), 3);
    v.set(B738.startLever(1), 0);
    r.run(1);
    v.set(B738.startLever(1), 1);
    r.run(90, () => v.get(ENG.running(1)) === 1);
    expect(v.get(ENG.running(1))).toBe(1);
    // Severe damage: seized core, high vibration.
    v.set('fail.eng2.severe_damage', 1);
    r.run(15);
    expect(v.get(ENG.running(2))).toBe(0);
    expect(v.get(ENG.n1(2))).toBeLessThan(3);
    expect(v.get(ENG.vibN1(2))).toBeGreaterThan(4);
    // Surge on engine 1: N1 and EGT fluctuate, EGT up.
    const egt0 = v.get(ENG.itt(1));
    v.set('fail.eng1.surge', 1);
    let lo = 1e9;
    let hi = -1e9;
    r.run(8, () => {
      const n = v.get(ENG.n1(1));
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    });
    expect(hi - lo).toBeGreaterThan(1.5);
    expect(v.get(ENG.itt(1))).toBeGreaterThan(egt0 + 20);
    v.set('fail.eng1.surge', 0);
    // Oil pump failure: oil pressure below the 13 psi red line.
    v.set('fail.eng1.oil_pump', 1);
    r.run(3);
    expect(v.get(ENG.oilPressPsi(1))).toBeLessThan(13);
  });
});

describe('737-800 fix round 1: warnings and annunciators', () => {
  it('F04: one main pump LOW PRESSURE is recall-only; two in one tank give MASTER CAUTION', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(4);
    v.set(B738.fuelPump('l_fwd'), 0);
    r.run(3);
    expect(v.get(B738.lt.fuelLowPress('l_fwd'))).toBe(1);
    expect(v.get(B738.lt.group('fuel'))).toBe(0);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    // RECALL shows the stored single fault.
    v.set(B738.recall(1), 1);
    r.run(0.3);
    v.set(B738.recall(1), 0);
    r.run(0.3);
    expect(v.get(B738.lt.group('fuel'))).toBe(1);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
    press(r, B738.masterCaution(1));
    r.run(0.3);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    // Second pump in the same tank: master caution.
    v.set(B738.fuelPump('l_aft'), 0);
    r.run(3);
    expect(v.get(B738.lt.group('fuel'))).toBe(1);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
  });

  it('F16: SPEED BRAKE ARMED triggers the take-off configuration warning', () => {
    const r = makeB738({ state: 'takeoff' });
    const v = r.vars;
    r.run(2);
    v.set(B738.parkBrake, 0);
    v.set(B738.speedbrake, SPEEDBRAKE.armed);
    v.set(B738.tla(1), 0.7);
    v.set(B738.tla(2), 0.7);
    r.run(0.5);
    expect(v.get('alert.takeoff_config')).toBe(1);
    v.set(B738.speedbrake, SPEEDBRAKE.down);
    r.run(0.5);
    expect(v.get('alert.takeoff_config')).toBe(0);
  });

  it('F18: STBY RUD ON and PASS OXY ON give MASTER CAUTION (FLT CONT / OVERHEAD)', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(4);
    v.set(B738.fltCtl('a'), -1);
    r.run(2);
    expect(v.get(B738.lt.stbyRudOn)).toBe(1);
    expect(v.get('cas.stby_rud_on')).toBe(1);
    expect(v.get(B738.lt.group('flt_cont'))).toBe(1);
    press(r, B738.masterCaution(1));
    v.set(B738.passOxy, 1);
    r.run(3);
    expect(v.get(B738.lt.passOxyOn)).toBe(1);
    expect(v.get(B738.lt.group('overhead'))).toBe(1);
  });

  it('F07/F08/F29: OVHT/FIRE test excludes cargo; cargo TEST: FIRE lights, bell, squib and DISCH lights; bell re-arms', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    v.set(B738.fireTest, 1);
    r.run(0.5);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('fire.cargo_fwd_warn')).toBe(0);
    expect(v.get(B738.lt.cargoFire('fwd'))).toBe(0);
    // Bell cutout during the engine test.
    press(r, B738.bellCutout);
    expect(v.get(B738.lt.fireWarn)).toBe(0);
    v.set(B738.fireTest, 0);
    r.run(0.5);
    // Cargo TEST: a new test re-arms the bell / FIRE WARN.
    v.set(B738.cargoTest, 1);
    r.run(0.5);
    expect(v.get('fire.cargo_fwd_warn')).toBe(1);
    expect(v.get(B738.lt.cargoFire('aft'))).toBe(1);
    expect(v.get(B738.lt.fireWarn)).toBe(1);
    expect(v.get(B738.lt.cargoSquib('fwd'))).toBe(1);
    expect(v.get(B738.lt.cargoDischarged)).toBe(1);
    expect(v.get(B738.lt.cargoDetFault)).toBe(0);
    expect(v.get('fire.eng1_warn')).toBe(0);
    v.set(B738.cargoTest, 0);
    r.run(0.5);
    // DETECTOR FAULT: a failed detector loop with NORM selected (both loops failed).
    v.set('fail.fire.cargo_fwd.loopa', 1);
    v.set('fail.fire.cargo_fwd.loopb', 1);
    r.run(0.5);
    expect(v.get(B738.lt.cargoDetFault)).toBe(1);
  });

  it('F17: altitude alert 900 / 300 ft', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(4);
    const alt = v.get(ADC.baroAlt(1));
    v.set('ap.sel_alt_ft', Math.round((alt + 850) / 10) * 10);
    r.run(0.3);
    expect(v.get('alt.alert')).toBe(1); // white box from 900 ft (750 ft before the fix)
  });

  it('F10: TCAS ABOVE band +9,900 ft and the TCAS self test', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    v.set(B738.tcasRange, 1);
    r.run(0.2);
    expect(v.get('tcas.band_above_ft')).toBe(9900);
    v.set(B738.xpdrModeSel, XPDR_SEL.taRa);
    r.run(1);
    v.set(B738.xpdrModeSel, XPDR_SEL.test);
    r.run(0.5);
    v.set(B738.xpdrModeSel, XPDR_SEL.taRa);
    r.run(1);
    expect(v.get('tcas.test')).toBe(1);
    expect(v.getString('tcas.status')).toBe('TCAS TEST');
    expect(r.sys.tcasDisplay.threats.length).toBe(4);
    r.run(8);
    expect(v.get('tcas.test')).toBe(0);
    expect(v.get('tcas.test_result')).toBe(1);
  });
});

describe('737-800 fix round 1: flight controls, gear, lights', () => {
  it('F05: standby yaw damper with FLT CONTROL B at STBY RUD', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(3);
    expect(v.get(B738.ydSw)).toBe(1);
    v.set(B738.fltCtl('b'), -1);
    r.run(4);
    expect(v.get('hyd.stby_psi')).toBeGreaterThan(1000);
    expect(v.get(B738.ydSw)).toBe(1);
    expect(v.get('yd.active')).toBe(1);
  });

  it('F14: speed brake lever DOWN: reverse thrust levers up on landing deploy the spoilers; RTO needs a take-off advance', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    // Idle ground roll above 60 kt without a take-off advance: no RTO deployment.
    v.set('gear.wheel_speed1_kt', 80);
    v.set('gear.wheel_speed2_kt', 80);
    r.sys.spoilers.update(1 / 60);
    expect(v.get('spoilers.deployed')).toBe(0);
    // Reverse levers up with the lever DOWN.
    v.set(B738.revLever(1), 0.3);
    v.set(B738.revLever(2), 0.3);
    r.sys.spoilers.update(1 / 60);
    expect(v.get('spoilers.deployed')).toBe(1);
    expect(v.get(B738.speedbrake)).toBe(1);
  });

  it('F19/PROC-21/PROC-22: no DISARM after the state load; RTO selection on the ground flashes DISARM 1-2 s', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    let lit = 0;
    r.run(10, () => {
      if (v.get(B738.lt.autoBrakeDisarm) !== 0) lit++;
    });
    expect(lit).toBe(0);
    v.set(B738.autobrake, 0);
    r.run(1);
    v.set(B738.autobrake, -1);
    let on = 0;
    r.run(3, () => {
      if (v.get(B738.lt.autoBrakeDisarm) !== 0) on++;
    });
    expect(on / 60).toBeGreaterThan(1);
    expect(on / 60).toBeLessThan(2.1);
    expect(v.get('brakes.autobrake_armed')).toBe(1);
  });

  it('F20: ALTERNATE FLAPS DOWN drives the LE devices to FULL EXTEND on standby hydraulics', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 8000, iasKt: 200, headingTrue: 90 } });
    const v = r.vars;
    r.run(2);
    v.set('fail.hyd.edp_b', 1);
    v.set('fail.hyd.emdp_b', 1);
    r.run(30, () => v.get('hyd.b_psi') < 500);
    v.set(B738.altFlapsArm, 1);
    v.set(B738.altFlapsSw, 1);
    r.run(1);
    v.set(B738.altFlapsSw, 0);
    r.run(12);
    expect(v.get('slats.pos')).toBeGreaterThan(0.95);
  });

  it('F31: gear transfer unit stops once the mains are up', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    v.set(B738.gearLever, 0);
    v.set('eng1.n2_pct', 30); // not used for the up-locked check: the physics overwrites it; the mains are up
    r.run(0.2);
    expect(v.get(B738.gearXferUnit)).toBe(0);
  });

  it('F06: EMERGENCY EXIT LIGHTS ARMED illuminate on DC bus 1 loss', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    v.set(B738.emerExitLt, 1);
    r.run(0.5);
    expect(v.get(B738.emerLtsOn)).toBe(0);
    v.set('fail.elec.dc1.fault', 1);
    r.run(1);
    expect(v.get(B738.emerLtsOn)).toBe(1);
    v.set('fail.elec.dc1.fault', 0);
    v.set(B738.emerExitLt, 2);
    r.run(1);
    expect(v.get(B738.emerLtsOn)).toBe(1);
  });

  it('F11: wipers sweep only with AC power; rain removal follows', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(1);
    v.set(B738.wiper(1), 3);
    let maxSweep = 0;
    r.run(1, () => {
      maxSweep = Math.max(maxSweep, v.get(B738.wiperSweep(1)));
    });
    expect(maxSweep).toBeGreaterThan(0.9);
    expect(v.get('ac.b738.wiper_rain_removal1')).toBe(1);
    v.set('cb.wiper_l', 0);
    r.run(0.5);
    expect(v.get('ac.b738.wiper_rain_removal1')).toBe(0);
  });
});

describe('737-800 fix round 1: radios, radar, cabin', () => {
  it('F09/F33: WXR active only with EFIS WXR selected and the radar powered', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(1);
    v.set(B737_VARS.efisMapButton(1, 'wxr'), 0);
    v.set(B737_VARS.efisMapButton(2, 'wxr'), 0);
    r.run(0.3);
    expect(v.get('wxr.active')).toBe(0);
    v.set(B737_VARS.efisMapButton(1, 'wxr'), 1);
    r.run(0.3);
    expect(v.get('wxr.active')).toBe(1);
    expect(v.getString('ac.b738.wxr_mode_text')).toMatch(/^WX/);
    v.set('cb.wxr', 0);
    r.run(0.3);
    expect(v.get('wxr.active')).toBe(0);
    expect(v.getString('ac.b738.wxr_mode_text')).toBe('WXR FAIL');
  });

  it('F12: cabin sign change gives one chime', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(1);
    const n0 = v.get('ac.b738.cabin_chime_count');
    v.set(B738.fastenBelts, v.get('ac.b738.sign_fasten_belts') !== 0 ? 0 : 2);
    r.run(0.3);
    expect(v.get('ac.b738.cabin_chime_count')).toBe(n0 + 1);
  });

  it('F13: marker tones on the MKR level; NAV TEST deflects the pointers; TAT TEST raises TAT on the ground', () => {
    const tones: string[] = [];
    const r = makeB738({ state: 'ready_to_taxi' });
    r.ctx.audio = { ...r.ctx.audio, tone: (id: string, on: boolean) => void (on && tones.push(id)) };
    (r.sys.radioAudio as unknown as { audio: typeof r.ctx.audio }).audio = r.ctx.audio;
    const v = r.vars;
    r.run(1);
    v.set(B738.acpRxOn(1, 'mkr'), 1);
    v.set(B738.acpMkrVol(1), 0.8);
    v.set('nav.marker_outer', 1);
    r.run(0.2);
    expect(tones).toContain('marker_outer');
    v.set(B738.acpMkrVol(1), 0);
    v.set(B738.acpMkrVol(2), 0);
    v.set(B738.acpMkrVol(3), 0);
    // NAV TEST held.
    v.set(B738.navTest(1), 1);
    r.run(0.3);
    expect(v.get('nav1.cdi')).toBeCloseTo(0.5, 5);
    v.set(B738.navTest(1), 0);
    // TAT TEST on the ground.
    const tat0 = v.get('adc1.tat_c');
    v.set(B738.tatTest, 1);
    r.run(20);
    expect(v.get('adc1.tat_c')).toBeGreaterThan(tat0 + 8);
  });

  it('F25: emergency access request lights AUTO UNLK; DENY cancels; LOCK FAIL on lock power loss', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(1);
    v.set(B738.fdDoorLock, 0);
    r.events.emit('b738.door.emer_access');
    r.run(1);
    expect(v.get(B738.lt.autoUnlk)).toBe(1);
    v.set(B738.fdDoorLock, 1);
    r.run(0.5);
    expect(v.get(B738.lt.autoUnlk)).toBe(0);
    v.set(B738.fdDoorLock, 0);
    r.events.emit('b738.door.emer_access');
    r.run(31);
    expect(v.get('ac.b738.door_unlocked')).toBe(1);
    r.run(6);
    expect(v.get('ac.b738.door_unlocked')).toBe(0);
    v.set('cb.fd_door_lock', 0);
    r.run(0.5);
    expect(v.get(B738.lt.lockFail)).toBe(1);
  });

  it('F27: ATC 1 failure: TCAS off with ATC 1, restored with ATC 2', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    v.set(B738.xpdrModeSel, XPDR_SEL.taRa);
    r.run(1.5);
    expect(v.get('xpdr.mode')).toBe(5);
    v.set('fail.b738.xpdr1', 1);
    r.run(1.5);
    expect(v.get('xpdr.mode')).toBe(0);
    v.set(B738.xpdrAtc, 2);
    r.run(1.5);
    expect(v.get('xpdr.mode')).toBe(5);
  });
});

describe('737-800 fix round 1: FMC', () => {
  it('F23: entering the approach IF into the ROUTE DISCONTINUITY closes it (Boeing plan)', async () => {
    const { FlightPlan, makeLeg } = await import('../../../src/nav/flightplan/FlightPlan');
    const w = (ident: string, lat: number, lon: number) => ({ ident, lat, lon, kind: 'fix' as const });
    const p = new FlightPlan('boeing');
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('AAA', 40, -74) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('BBB', 40, -73) }),
      makeLeg({ type: 'IF', segment: 'approach', fix: w('CEPIN', 40, -72.5) }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('FAF', 40, -72.2) }),
    ];
    p.normalize();
    const ids = () => p.legs.map((l) => (l.type === 'DISCO' ? '---' : l.fix?.ident));
    expect(ids()).toEqual(['AAA', 'BBB', '---', 'CEPIN', 'FAF']);
    // LSK: CEPIN typed onto the discontinuity line (index 2).
    p.insertWaypoint(2, w('CEPIN', 40, -72.5));
    expect(ids()).toEqual(['AAA', 'BBB', 'CEPIN', 'FAF']);
  });
});
