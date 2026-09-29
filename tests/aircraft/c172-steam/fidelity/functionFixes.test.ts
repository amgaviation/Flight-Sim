/**
 * Function-lens fixes (round 1) of the steam 172S: each test fails without its fix.
 * Sources are cited in the implementation files (POH 172SPHUS Rev 5 and Supplements 1, 2, 4, 6, 15, 19, 20, 22).
 */
import { describe, expect, it } from 'vitest';
import { AP, NAV } from '../../../../src/core/vars';
import { C172, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { ENC, EV, KAP, KLN, KMA, KT, KX, ST } from '../../../../src/aircraft/c172-steam/vars';
import { CDI1_RECEIVER } from '../../../../src/aircraft/c172-steam/systems';
import { morseKeyDown } from '../../../../src/aircraft/c172-steam/avionics/receiverAudio';
import { ANALOG_VARS } from '../../../../src/avionics/analog/vars';
import { AFCS_VARS } from '../../../../src/systems/autopilot/vars';
import { SENSOR_VARS } from '../../../../src/systems/sensors/vars';
import { KT_MODE } from '../../../../src/aircraft/c172-steam/avionics/kt76c';
import { KAP_SENSOR_INDEX } from '../../../../src/aircraft/c172-steam/createSystems';
import { makeSteamRig, press, type SteamRig } from '../rig';

const cruise = (): SteamRig => makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
const wrap180 = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;

/** Removes nav/Radios so a test can write the receiver outputs itself. */
function withoutRadios(r: SteamRig): void {
  const i = r.sys.list.indexOf(r.sys.radios);
  if (i >= 0) r.sys.list.splice(i, 1);
}

/** Synthetic localizer on NAV 1, aircraft on the centre line (deviation 0). */
function onLocalizer(r: SteamRig, courseDeg: number): void {
  const v = r.vars;
  v.set(NAV.powered(1), 1);
  v.set(NAV.received(1), 1);
  v.set(NAV.isLoc(1), 1);
  v.set(NAV.cdi(1), 0);
  v.set(NAV.devDeg(1), 0);
  v.set(NAV.distNm(1), 8);
  v.set(NAV.locCourse(1), courseDeg);
  v.set(NAV.obs(1), courseDeg);
  v.set(NAV.obs(CDI1_RECEIVER), courseDeg);
}

describe('c172-steam function fixes', () => {
  it('F01: KAP 140 flies the heading bug as the course datum in NAV/APR (a mis-set bug gives a track error)', () => {
    const fly = (bugOffset: number): number => {
      const r = cruise();
      withoutRadios(r);
      const v = r.vars;
      r.run(2);
      const crs = Math.round(v.get(ST.dgHeading));
      onLocalizer(r, crs);
      v.set(AP.selHeading, (crs + bugOffset + 360) % 360);
      r.events.emit(EV.kap('ap'));
      r.run(0.2);
      r.events.emit(EV.kap('nav'));
      r.run(40, () => void onLocalizer(r, crs));
      expect(r.sys.afcs.lat).toBe('LOC');
      return wrap180(v.get(ST.dgHeading) - crs);
    };
    expect(Math.abs(fly(0))).toBeLessThan(4);
    // Bug 30 deg off the course: the KAP 140 heads toward the bug although the CDI is centred.
    expect(fly(30)).toBeGreaterThan(15);
  });

  it('F02: the fuel gauge reads the transmitter output (failed transmitter below 0)', async () => {
    const { steamCockpitRig } = await import('../cockpitRig');
    const { r, ck } = await steamCockpitRig('cruise', { air: { altFtMsl: 6000, iasKt: 105 } });
    r.vars.set('fail.c172.fuel_xmtr_l', 1);
    r.run(1);
    const g = ck.build.controls.find((c) => c.id === 'c172s.fuel_qty') as unknown as { update(dt: number): void; leftValue: { value: number }; rightValue: { value: number } };
    g.update(1 / 60);
    expect(g.leftValue.value).toBeLessThan(-1);
    expect(g.rightValue.value).toBeGreaterThan(10);
  });

  it('F03/F21/F25/F27: fog film follows the windshield fog; flap gates at 10/20; push-to-reset breakers; 12 V outlet', async () => {
    const { steamCockpitRig } = await import('../cockpitRig');
    const THREE = await import('three');
    const { r, ck } = await steamCockpitRig('ready_to_taxi');
    const v = r.vars;
    const find = (id: string) => ck.build.controls.find((c) => c.id === id)!;
    // Windshield fog film (consumer of ac.c172.ws_fog).
    const fog = ck.build.root.getObjectByName('windshield_fog')!;
    v.set(C172.windshieldFog, 0.6);
    ck.build.update?.(1 / 60);
    expect(fog.visible).toBe(true);
    // Flap lever: one continuous drag from UP stops at the 10 deg gate.
    const flaps = find('c172s.flaps');
    const p = { button: 0 as const, shift: false, ctrl: false, alt: false, point: new THREE.Vector3(), object: flaps.object };
    const reached: number[] = [];
    for (const dy of [20, -20]) {
      v.set(C172.flapLever, 0);
      flaps.update?.(1 / 60);
      flaps.onPointerDown?.(p);
      let max = 0;
      for (let i = 0; i < 40; i++) {
        flaps.onDrag?.(0, dy, p);
        flaps.update?.(1 / 60);
        max = Math.max(max, v.get(C172.flapLever));
      }
      flaps.onPointerUp?.(p);
      reached.push(max);
    }
    expect(Math.max(...reached)).toBe(1); // stopped at the 10 deg gate (without gates the drag reaches 30 deg)
    // Push-to-reset breaker cannot be pulled; the AUTO PILOT pull-off breaker can.
    const flapCb = find('c172s.cb.flap');
    flapCb.onPointerDown?.(p);
    flapCb.onPointerUp?.(p);
    expect(v.get('cb.flap')).toBe(1);
    const apCb = find('c172s.cb.autopilot');
    apCb.onPointerDown?.(p);
    apCb.onPointerUp?.(p);
    expect(v.get('cb.autopilot')).toBe(0);
    // CABIN PWR 12V outlet: plugging a device in enables the 12 V load.
    const outlet = find('c172s.cabin_pwr_12v');
    outlet.onPointerDown?.(p);
    outlet.onPointerUp?.(p);
    expect(v.get(C172.cabinPwr12v)).toBe(1);
  });

  it('F05: MET locked out until the preflight self test has passed', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(C172.masterBat, 1);
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    r.run(1);
    expect(v.get(KAP.pft)).toBeGreaterThan(0);
    v.set(ST.metLeft, 1);
    v.set(ST.metRight, 1);
    r.run(0.5);
    expect(v.get(KAP.metCmd)).toBe(0);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 0);
    r.run(12);
    v.set(ST.metLeft, 1);
    v.set(ST.metRight, 1);
    r.run(0.2);
    expect(v.get(KAP.metCmd)).toBe(1);
  });

  it('F06/F18: one blind encoder feeds the KT 76C and the KAP 140; no Mode C without encoder data', () => {
    const r = cruise();
    const v = r.vars;
    v.set(KT.mode, KT_MODE.alt);
    r.run(1);
    expect(v.get(ENC.valid)).toBe(1);
    expect(v.get(KAP.encoderValid)).toBe(1);
    expect(v.get(NAV.xpdrMode)).toBe(3);
    v.set('fail.c172s.encoder', 1);
    r.run(0.5);
    expect(v.get(KAP.encoderValid)).toBe(0);
    expect(v.get(KT.altHft)).toBe(-9999);
    expect(v.get(NAV.xpdrMode)).toBe(2);
    v.set('fail.c172s.encoder', 0);
    r.run(0.5);
    // XPNDR breaker pulled: the encoder loses power, so the KAP 140 alerter / preselect are inoperative.
    v.set('cb.xpndr', 0);
    r.run(0.5);
    expect(v.get(ENC.valid)).toBe(0);
    expect(v.get(KAP.encoderValid)).toBe(0);
    v.set('cb.xpndr', 1);
    r.run(5);
    expect(v.get(ENC.valid)).toBe(0); // warming up again
  });

  it('F07: RADIO LT lighting only with the annunciator switch in DIM', () => {
    const r = cruise();
    const v = r.vars;
    v.set(C172.dimRadio, 0.8);
    v.set(C172.annSwitch, 1); // BRT
    r.run(0.5);
    expect(v.get('ac.light.radio')).toBe(0);
    v.set(C172.annSwitch, 0); // DIM
    r.run(0.5);
    expect(v.get('ac.light.radio')).toBeGreaterThan(0.5);
  });

  it('F08: the parking brake traps the pedal pressure present when it is set', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(C172.parkingBrake, 0);
    r.run(0.5);
    v.set(C172.parkingBrake, 1); // pedals free
    r.run(0.5);
    expect(v.get('brakes.psi_left')).toBeLessThan(1);
    v.set(C172.parkingBrake, 0);
    r.run(0.2);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    r.run(0.2);
    v.set(C172.parkingBrake, 1); // set with the pedals held, then released
    r.run(0.2);
    v.set('input.brake_left', 0);
    v.set('input.brake_right', 0);
    r.run(1);
    expect(v.get('brakes.psi_left')).toBeGreaterThan(900);
    expect(v.get('brakes.psi_right')).toBeGreaterThan(900);
  });

  it('F09: the avionics cooling fan is audible with AVIONICS BUS 1 on', () => {
    const r = cruise();
    const v = r.vars;
    r.run(0.5);
    expect(v.get(ST.avnFanGain)).toBeGreaterThan(0.03);
    v.set(C172.avionicsBus1, 0);
    r.run(0.5);
    expect(v.get(ST.avnFanGain)).toBe(0);
  });

  it('F10: the #1 CDI OBS sets the KLN 94 OBS course only with GPS selected', () => {
    const r = cruise();
    const v = r.vars;
    v.set(ST.cdiSource, 0);
    v.set(KLN.obs, 100);
    v.set(NAV.obs(CDI1_RECEIVER), 250);
    r.run(0.3);
    expect(v.get(NAV.obs(1))).toBe(250);
    expect(v.get(KLN.obs)).toBe(100);
    v.set(ST.cdiSource, 1);
    r.run(0.3);
    expect(v.get(KLN.obs)).toBe(250);
  });

  it('F13: the AP engages only when pressed and held ~0.25 s; a press disengages', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    press(r, KAP.apBtn, 0.1);
    expect(v.get(AP.engaged)).toBe(0);
    press(r, KAP.apBtn, 0.4);
    expect(v.get(AP.engaged)).toBe(1);
    press(r, KAP.apBtn, 0.5); // disengage; still held past 0.25 s must not re-engage
    expect(v.get(AP.engaged)).toBe(0);
  });

  it('F14/F26: a pitch trim fault sounds alert tones (WARN breaker powers the horn)', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    v.set('fail.c172s.kap140.trim', 1);
    let tone = false;
    r.run(1, () => void (tone ||= v.get('ac.kap140.tone') > 0.5));
    expect(v.get(KAP.pitchTrimLamp)).toBeGreaterThan(0.5);
    expect(tone).toBe(true);
    expect(r.log.toneOn).toContain('ap_disconnect');
    v.set('cb.warn', 0);
    tone = false;
    r.run(6, () => void (tone ||= v.get('ac.kap140.tone') > 0.5));
    expect(tone).toBe(false);
  });

  it('F15: the trim monitor flags the RH half alone, not the LH half alone', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    v.set(ST.metLeft, 1);
    r.run(6);
    expect(v.get(KAP.pt)).not.toBe(2);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 1);
    r.run(6);
    expect(v.get(KAP.pt)).toBe(2);
  });

  it('F16: a flashing GS needs two ALT presses in rapid succession (ends in VS)', () => {
    const r = cruise();
    r.run(1);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    r.sys.kap.flashGs = true;
    r.events.emit(EV.kap('alt'));
    r.run(1.5);
    expect(r.sys.kap.flashGs).toBe(true);
    r.events.emit(EV.kap('alt')); // back to VS, not in rapid succession: still flashing
    r.run(1.5);
    expect(r.sys.kap.flashGs).toBe(true);
    expect(r.sys.afcs.vert).toBe('VS');
    r.events.emit(EV.kap('alt'));
    r.run(0.2);
    r.events.emit(EV.kap('alt'));
    r.run(0.2);
    expect(r.sys.kap.flashGs).toBe(false);
    expect(r.sys.afcs.vert).toBe('VS');
  });

  it('F17: abnormal vertical accelerations light the red P and disengage; it goes out after ~1 min', () => {
    const r = cruise();
    const v = r.vars;
    r.run(1);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(v.get(AP.engaged)).toBe(1);
    const s = r.sys.kapSensors;
    const orig = s.update.bind(s);
    let bump = true;
    s.update = (dt: number) => {
      orig(dt);
      if (bump) v.set(SENSOR_VARS.nz(KAP_SENSOR_INDEX), 1.9);
    };
    r.run(1);
    bump = false;
    expect(v.get(KAP.pLamp)).toBe(1);
    expect(v.get(AP.engaged)).toBe(0);
    r.run(62);
    expect(v.get(KAP.pLamp)).toBe(0);
  });

  it('F19: the ignition key can be withdrawn only in OFF', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    expect(v.get(C172.magneto)).toBe(MAG.both);
    v.set(C172.keyIn, 0);
    r.run(0.5);
    expect(v.get(C172.keyIn)).toBe(1);
    expect(v.get(C172.magneto)).toBe(MAG.both);
    v.set(C172.magneto, MAG.off);
    r.run(0.1);
    v.set(C172.keyIn, 0);
    r.run(0.2);
    expect(v.get(C172.keyIn)).toBe(0);
  });

  it('F20: compass deviation with the alternator side of the master switch OFF', () => {
    const r = cruise();
    const v = r.vars;
    r.run(0.5);
    expect(v.get(ANALOG_VARS.compassExtraDeviation)).toBe(0);
    v.set(C172.masterAlt, 0);
    r.run(2);
    expect(Math.abs(v.get(ANALOG_VARS.compassExtraDeviation))).toBeGreaterThan(3);
  });

  it('F22: NAV ident Morse is keyed through the KMA 28 with PULL IDENT', () => {
    expect(morseKeyDown('.-', 0.05)).toBe(true); // dot
    expect(morseKeyDown('.-', 0.2)).toBe(false); // element gap
    expect(morseKeyDown('.-', 0.4)).toBe(true); // dash
    expect(morseKeyDown('.-', 2)).toBe(false); // after the ident
    const r = cruise();
    withoutRadios(r);
    const v = r.vars;
    onLocalizer(r, 0);
    v.setString(NAV.morse(1), '.. -.-. -');
    v.set(KX(1).navVol, 0.8);
    v.set(KMA.sel('nav1'), 1);
    const heard = (): number => {
      let m = 0;
      r.run(3, () => void (m = Math.max(m, v.get('ac.c172s.ident_nav1'))));
      return m;
    };
    v.set(KX(1).navIdent, 0);
    expect(heard()).toBe(0); // ident filtered (knob pushed)
    v.set(KX(1).navIdent, 1);
    expect(heard()).toBeGreaterThan(0.1);
    v.set(KMA.sel('nav1'), 0);
    expect(heard()).toBe(0);
  });

  it('F23: the GPU can be connected on the ground with the engine stopped', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(ST.gpuRequest, 1);
    r.run(0.5);
    expect(v.get(C172.extPower)).toBe(1);
    v.set(ST.gpuRequest, 0);
    r.run(0.5);
    expect(v.get(C172.extPower)).toBe(0);
  });

  it('F28: in KLN 94 OBS mode the KAP 140 couples to the #1 CDI deviation, not roll steering', () => {
    const r = cruise();
    const v = r.vars;
    v.set(ST.cdiSource, 1);
    r.run(0.3);
    expect(v.get(AFCS_VARS.navSource)).toBe(0);
    r.events.emit(EV.klnKey('obs'));
    r.run(0.3);
    expect(v.get(KLN.obsMode)).toBe(1);
    expect(v.get(AFCS_VARS.navSource)).toBe(CDI1_RECEIVER);
  });
});
