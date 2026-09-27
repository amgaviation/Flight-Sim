/**
 * Fidelity audit probes (read-only auditor): each test logs what our model does for a
 * behaviour described in POH 172SPHUS Rev 5 / its supplements. They assert nothing about
 * the real behaviour so the suite stays green; the audit report quotes the logged values.
 */
import { describe, it } from 'vitest';
import { AP, ENG } from '../../../../src/core/vars';
import { ANN, C172, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { EV, KAP, KMA, KT, ST } from '../../../../src/aircraft/c172-steam/vars';
import { makeSteamRig, press } from '../rig';

const log = (k: string, x: unknown): void => console.log(`[PROBE] ${k}: ${JSON.stringify(x)}`);

describe('c172-steam fidelity probes', () => {
  it('KAP 140 mode buttons with the AP disengaged / HDG toggle / AP tap', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    const v = r.vars;
    r.run(2);
    r.events.emit(EV.kap('hdg'));
    r.run(0.2);
    log('HDG pressed with AP off -> ap.engaged', v.get(AP.engaged));
    log('HDG pressed with AP off -> afcs.lat', r.sys.afcs.lat);
    r.events.emit(EV.kap('alt'));
    r.run(0.2);
    log('ALT pressed with AP off -> ap.engaged', v.get(AP.engaged));
    if (v.get(AP.engaged) > 0.5) {
      r.events.emit(EV.kap('ap'));
      r.run(0.5);
    }
    r.events.emit(EV.kap('ap')); // single tap
    r.run(0.2);
    log('AP single event (no 0.25 s hold) -> engaged', v.get(AP.engaged));
    r.events.emit(EV.kap('hdg'));
    r.run(0.2);
    log('HDG #1 -> lat', r.sys.afcs.lat);
    r.events.emit(EV.kap('hdg'));
    r.run(0.2);
    log('HDG #2 (toggle) -> lat', r.sys.afcs.lat);
  });

  it('electrical: KMA power bus, ann switch vs radio lighting, parking brake, key removal', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    // Avionics BUS 2 off: audio panel?
    v.set(C172.avionicsBus2, 0);
    r.run(1);
    log('AVN BUS 2 OFF -> kma.on', v.get(KMA.on));
    v.set(C172.avionicsBus2, 1);
    v.set(C172.avionicsBus1, 0);
    r.run(1);
    log('AVN BUS 1 OFF -> kma.on', v.get(KMA.on));
    v.set(C172.avionicsBus1, 1);
    r.run(1);
    // RADIO LT dimmer with the annunciator switch in DAY vs NIGHT
    v.set(C172.dimRadio, 0.8);
    v.set(C172.annSwitch, 1);
    r.run(1);
    log('RADIO LT 0.8, ann switch DAY -> ac.light.radio', v.get('ac.light.radio'));
    v.set(C172.annSwitch, 0);
    r.run(1);
    log('RADIO LT 0.8, ann switch NIGHT -> ac.light.radio', v.get('ac.light.radio'));
    v.set(C172.annSwitch, 1);
    // Parking brake set without pedal pressure
    v.set('input.brake_left', 0);
    v.set('input.brake_right', 0);
    v.set(C172.parkingBrake, 1);
    r.run(1);
    log('parking brake set, pedals free -> brakes.left_psi', [v.get('brakes.psi_left'), v.get('brakes.psi_right'), v.get('brakes.parking_set')]);
    // Key removal with the engine running in BOTH
    log('engine running before key out', v.get(ENG.running(1)));
    log('mags before', v.get(C172.magneto));
    v.set(C172.keyIn, 0);
    r.run(3);
    log('key removed in BOTH -> mags / running', [v.get(C172.magneto), v.get(ENG.running(1))]);
    v.set(C172.keyIn, 1);
    v.set(C172.magneto, MAG.both);
  });

  it('transponder / encoder / KAP alerter power paths', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    const v = r.vars;
    r.run(2);
    log('KT mode / xpdr.mode', [v.get(KT.mode), v.get('xpdr.mode')]);
    v.set('cb.xpndr', 0);
    r.run(2);
    log('XPNDR CB pulled -> KAP encoder valid / alert power', [v.get(KAP.encoderValid), v.get('ac.kap140.ready')]);
    v.set('cb.xpndr', 1);
    r.run(0.5);
    // Transponder re-power: mode C before encoder warm-up?
    log('XPNDR CB reset -> xpdr.mode / KT alt', [v.get('xpdr.mode'), v.get(KT.altHft)]);
  });

  it('annunciators and vacuum: engine off, VOLTS, fuel transmitter failure indication', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(12);
    log('MASTER ON engine off -> lamps oil/volts/vacL/vacR/lowfuelL', [v.get(ANN.lamp('oil_press')), v.get(ANN.lamp('volts')), v.get(ANN.lamp('vac_l')), v.get(ANN.lamp('vac_r')), v.get(ANN.lamp('low_fuel_l'))]);
    log('bus1 V engine off', v.get('elec.bus1_v'));
    v.set('fail.c172.fuel_xmtr_l', 1);
    r.run(1);
    log('fuel xmtr L failed -> fuel.left_ind_kg / fuel.tank0_kg', [v.get('fuel.left_ind_kg'), v.get('fuel.tank0_kg')]);
    // Avionics fan audio / consumers
    v.set(C172.avionicsBus1, 1);
    r.run(1);
    log('AVN BUS 1 ON -> avn_fan powered', v.get('elec.avn_fan_powered'));
    log('audio plays/loops', r.log.plays.slice(-5));
  });

  it('MET split switch: LH alone 5 s shows PT?', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    v.set(ST.metLeft, -1);
    r.run(6);
    log('LH alone 6 s -> KAP.pt', v.get(KAP.pt));
    v.set(ST.metLeft, 0);
    r.run(0.5);
    log('released -> KAP.pt', v.get(KAP.pt));
    press(r, KAP.baro);
  });
});

describe('c172-steam fidelity probes 2', () => {
  it('REV with a VOR tuned; ACU over-voltage trip and reset; trim runaway vs DISC / CB', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    const v = r.vars;
    r.run(2);
    r.events.emit(EV.kap('ap'));
    r.run(0.3);
    log('NAV1 active / isLoc', [v.get('nav1.active_mhz'), v.get('nav1.is_loc')]);
    r.events.emit(EV.kap('rev'));
    r.run(0.3);
    log('REV pressed with VOR tuned -> lat / armed', [r.sys.afcs.lat, r.sys.afcs.latArmed]);
    r.events.emit(EV.kap('ap'));
    r.run(3);
    // ACU trip
    v.set('fail.elec.alt.regulator', 1);
    r.run(5);
    log('regulator runaway -> cb.alt_fld / alt_online / alt_tripped', [v.get('cb.alt_fld'), v.get('elec.alt_online'), v.get('elec.alt_tripped')]);
    v.set('fail.elec.alt.regulator', 0);
    v.set('cb.alt_fld', 1);
    v.set('cb.alt_fld_tripped', 0);
    r.run(3);
    log('CB reset only (no master cycle) -> alt_online / tripped', [v.get('elec.alt_online'), v.get('elec.alt_tripped')]);
    v.set(C172.masterAlt, 0);
    r.run(0.5);
    v.set(C172.masterAlt, 1);
    r.run(3);
    log('after ALT cycle -> alt_online', v.get('elec.alt_online'));
    // Trim runaway
    const t0 = v.get(C172.trimPosition);
    v.set('fail.trim.pitch.runaway', 1);
    r.run(2);
    const t1 = v.get(C172.trimPosition);
    log('runaway 2 s trim delta / PITCH TRIM lamp / tone', [t1 - t0, v.get(KAP.pitchTrimLamp), v.get('ac.kap140.tone')]);
    v.set(ST.apDisc, 1);
    r.run(2);
    log('DISC held 2 s trim delta', v.get(C172.trimPosition) - t1);
    v.set(ST.apDisc, 0);
    v.set('cb.autopilot', 0);
    const t2 = v.get(C172.trimPosition);
    r.run(2);
    log('AP CB pulled trim delta', v.get(C172.trimPosition) - t2);
  });

  it('flaps with FLAP CB pulled mid travel; stall horn with master off', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 80 } });
    const v = r.vars;
    r.run(1);
    v.set(C172.flapLever, 3);
    r.run(3);
    const f = v.get('surf.flaps_deg');
    v.set('cb.flap', 0);
    r.run(3);
    log('flaps at CB pull / 3 s later', [f, v.get('surf.flaps_deg')]);
  });
});
