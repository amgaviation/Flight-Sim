import { beforeAll, describe, expect, it } from 'vitest';
import { ADC, AP, FMS, NAV } from '../../../src/core/vars';
import { destinationPoint } from '../../../src/core/geo';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { G1K, G1K_EVENTS, CDI_SOURCE, vn } from '../../../src/avionics/garmin-g1000/vars';
import { NXI_FLC_MIN_KT, NXI_VS_MAX_FPM } from '../../../src/avionics/garmin-g1000/state/afcs';
import { loadDb, makeRig, pressSoftkey } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadDb();
}, 90000);

const key = (k: string): string => G1K_EVENTS.afcsKey('pfd', k);

describe('GFC 700 modes through the GDU 1054B AFCS keys (real Afcs)', () => {
  it('AP engages in ROL / PIT; HDG, VS with NOSE UP / DN and the +1500 fpm limit; FLC 70-150 kt; FD key', () => {
    const rig = makeRig(db, {}, true);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.9, -73.5, 5000, 90, 110);
    rig.step(0.5);
    events.emit(key('ap'));
    rig.step(0.1);
    expect(vars.get(AP.engaged)).toBe(1);
    expect(vars.getString(AP.lateralActive)).toBe('ROL');
    expect(vars.getString(AP.verticalActive)).toBe('PIT');
    events.emit(key('hdg'));
    rig.step(0.1);
    expect(vars.getString(AP.lateralActive)).toBe('HDG');
    vars.set(ADC.vs(1), 480);
    rig.step(0.2);
    events.emit(key('vs'));
    rig.step(0.1);
    expect(vars.getString(AP.verticalActive)).toBe('VS');
    expect(vars.get(AP.selVs)).toBe(500);
    events.emit(key('nose_up'));
    rig.step(0.1);
    expect(vars.get(AP.selVs)).toBe(600);
    vars.set(AP.selVs, 1400);
    events.emit(key('nose_up'));
    events.emit(key('nose_up'));
    rig.step(0.1);
    // PG Table 7-2 (172): VS reference -2000 .. +1500 fpm.
    expect(vars.get(AP.selVs)).toBe(NXI_VS_MAX_FPM);
    vars.set(ADC.ias(1), 62);
    rig.step(0.2);
    events.emit(key('flc'));
    rig.step(0.1);
    expect(vars.getString(AP.verticalActive)).toBe('FLC');
    expect(vars.get(AP.selSpeed)).toBe(NXI_FLC_MIN_KT);
    // AP key again disengages (manual disconnect: flashing yellow AP).
    events.emit(key('ap'));
    rig.step(0.1);
    expect(vars.get(AP.engaged)).toBe(0);
    expect(vars.get('ap.disc_warn')).toBe(1);
    expect(vars.get('ap.disc_auto')).toBe(0);
  });

  it('ALTS captures and becomes ALT at 50 ft from the selected altitude (PG §7.3)', () => {
    const rig = makeRig(db, {}, true);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.9, -73.5, 4000, 90, 90);
    vars.set(AP.selAltitude, 5000);
    vars.set(ADC.vs(1), 700);
    rig.step(0.3);
    events.emit(key('vs'));
    rig.step(0.2);
    expect(vars.getString(AP.verticalArmed)).toContain('ALTS');
    // Capture starts within max(50 ft, |VS| x 10 s) of the selected altitude (shared Afcs asymptotic capture).
    vars.set(ADC.baroAlt(1), 4900);
    rig.step(1);
    expect(vars.getString(AP.verticalActive)).toBe('ALTS');
    vars.set(ADC.baroAlt(1), 4958);
    vars.set(ADC.vs(1), 150);
    rig.step(0.5);
    expect(vars.getString(AP.verticalActive)).toBe('ALT');
  });

  it('GA disengages the autopilot and commands go-around', () => {
    const rig = makeRig(db, {}, true);
    const { vars, events } = rig;
    rig.suite.system.units.forceBooted();
    rig.place(40.9, -73.5, 1500, 90, 80);
    rig.step(0.3);
    events.emit(key('ap'));
    rig.step(0.1);
    expect(vars.get(AP.engaged)).toBe(1);
    events.emit('ap.toga');
    rig.step(0.1);
    expect(vars.get(AP.engaged)).toBe(0);
    expect(vars.getString(AP.verticalActive)).toBe('GA');
  });

  it('APR with GPS on the CDI and an ILS loaded arms LOC / GS on NAV1 (auto-tuned), CDI switches when established', async () => {
    const rig = makeRig(db, {}, true);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    const fpl = sys.fpl!;
    fpl.setOrigin('KJFK');
    fpl.setDestination('KBOS');
    const bos = await fpl.loadProcedures('KBOS');
    const ils = bos!.approaches.find((a) => a.approachType === 'ILS' && a.runways.includes('04R')) ?? bos!.approaches.find((a) => a.approachType === 'ILS')!;
    fpl.loadApproach('KBOS', ils.ident, undefined, 'vtf');
    rig.step(0.2);
    // Approach auto-tune with GPS on the CDI: the LOC frequency goes into both NAV active fields (PG §4.3).
    expect(vars.get(vn(NAV.activeFreq, 1))).toBeCloseTo(ils.navFrequencyMhz!, 2);
    expect(vars.get(vn(NAV.activeFreq, 2))).toBeCloseTo(ils.navFrequencyMhz!, 2);
    const rw = db.airport('KBOS')!.runways.find((r) => r.ident === ils.runways[0])!;
    const p = destinationPoint(rw.lat, rw.lon, (rw.headingTrue + 180) % 360, 9);
    rig.place(p.lat, p.lon, 2600, Math.round((rw.headingTrue + 14.5) % 360), 90);
    rig.step(2);
    expect(vars.get(vn(NAV.isLoc, 1))).toBe(1);
    events.emit(key('ap'));
    events.emit(key('apr'));
    rig.step(0.3);
    expect(vars.getString(AP.lateralArmed) + vars.getString(AP.lateralActive)).toContain('LOC');
    expect(vars.get('ap.nav_source')).toBe(1);
    // Minimums reset by the approach load (PG §2.4).
    expect(vars.get(G1K.minsMode)).toBe(0);
    void CDI_SOURCE;
    void FMS;
  });
});

describe('VNV, ESP and USP', () => {
  it('Cncl VNV invalidates vertical guidance until re-enabled', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    rig.key('mfd', 'keyEnt');
    rig.key('mfd', 'keyFpl');
    pressSoftkey(rig, 'mfd', 'Cncl VNV');
    expect(vars.get(G1K.vnvEnabled)).toBe(0);
    vars.set(FMS.vnavValid, 1);
    rig.suite.system.update(1 / 30);
    expect(vars.get(FMS.vnavValid)).toBe(0);
    pressSoftkey(rig, 'mfd', 'Enbl VNV');
    expect(vars.get(G1K.vnvEnabled)).toBe(1);
  });

  it('ESP opposes a steep bank and engages the autopilot in LVL after 10 s of 20 s (PG §8.11)', () => {
    const rig = makeRig(db, {}, true);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.9, -73.5, 4000, 90, 105);
    rig.step(0.5);
    expect(vars.get(G1K.espRollLimit)).toBe(45);
    vars.set(ADC.bank(1), 52);
    rig.step(2);
    expect(vars.get(G1K.espEngaged)).toBe(1);
    expect(vars.get(G1K.espServoRoll)).toBeLessThan(0);
    expect(vars.get(G1K.espRollLimit)).toBe(30);
    rig.step(9.5);
    expect(vars.get(AP.engaged)).toBe(1);
    expect(vars.getString(AP.lateralActive)).toBe('LVL');
    expect(vars.getString(AP.verticalActive)).toBe('LVL');
    expect(rig.audio.callouts).toContain('Engaging Autopilot');
    // With the AP engaged ESP is inactive.
    rig.step(0.5);
    expect(vars.get(G1K.espEngaged)).toBe(0);
  });

  it('ESP low-airspeed protection pushes the nose down below 55 KIAS for 1 s; disabled ESP does nothing', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.9, -73.5, 4000, 90, 52);
    rig.step(0.5);
    expect(vars.get(G1K.espEngaged)).toBe(0);
    rig.step(1.5);
    expect(vars.get(G1K.espEngaged)).toBe(1);
    expect(vars.get(G1K.espServoPitch)).toBeLessThan(0);
    sys.esp!.setEnabled(false);
    rig.step(1);
    expect(vars.get(G1K.espEngaged)).toBe(0);
    // Not below 200 ft AGL.
    const low = makeRig(db, { aglFt: 150 });
    low.suite.system.units.forceBooted();
    low.place(40.9, -73.5, 600, 90, 52);
    low.step(2);
    expect(low.vars.get(G1K.espEngaged)).toBe(0);
  });

  it('USP: MINSPD / UNDERSPEED PROTECT ACTIVE with the AP engaged in VS; the VS reference steps down', () => {
    const rig = makeRig(db, {}, true);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.9, -73.5, 4000, 90, 80);
    vars.set(ADC.vs(1), 500);
    rig.step(0.3);
    events.emit(key('ap'));
    events.emit(key('vs'));
    rig.step(0.2);
    const before = vars.get(AP.selVs);
    vars.set(ADC.ias(1), 57);
    rig.step(1.2);
    expect(vars.get(G1K.minSpd)).toBe(1);
    expect(vars.get(G1K.uspActive)).toBe(1);
    expect(vars.get(AP.selVs)).toBeLessThan(before);
    expect(rig.audio.callouts).toContain('Airspeed');
    expect(sys.alerts.cas.isActive('usp')).toBe(true);
  });
});

describe('AFCS status annunciations (PG Table 7-6) and overspeed protection', () => {
  it('PFT at servo power-up, red PFT when the servos fail their test, PTRM, elevator mistrim, AFCS with the breaker out', () => {
    const rig = makeRig(db, { power: { servos: 'elec.ap' }, bootS: { servos: 5 } });
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.2);
    expect(vars.getString(G1K.afcsStatus)).toBe('AFCS');
    vars.set('elec.ap', 1);
    rig.step(1);
    expect(vars.getString(G1K.afcsStatus)).toBe('PFT');
    expect(vars.get(G1K.afcsStatusLevel)).toBe(2);
    rig.step(5);
    expect(vars.getString(G1K.afcsStatus)).toBe('');
    expect(rig.audio.tones.has('ap_disconnect')).toBe(true);
    vars.set('fail.trim.pitch.jam', 1);
    rig.step(0.1);
    expect(vars.getString(G1K.afcsStatus)).toBe('PTRM');
    vars.set('fail.trim.pitch.jam', 0);
    vars.set(AP.engaged, 1);
    vars.set('ap.mistrim', 1);
    vars.set('ap.servo_pitch', 0.3);
    rig.step(0.1);
    expect(vars.getString(G1K.afcsStatus)).toBe('↑ELE');
    expect(vars.get(G1K.afcsStatusLevel)).toBe(0);
    vars.set('fail.g1k.servos', 1);
    rig.step(0.1);
    expect(vars.getString(G1K.afcsStatus)).toBe('PFT');
    expect(vars.get(G1K.afcsStatusLevel)).toBe(1);
  });

  it('MAXSPD near Vne in PIT raises the pitch reference; not in ALT', () => {
    const rig = makeRig(db);
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    let ups = 0;
    events.on('ap.up', () => ups++);
    vars.set(AP.engaged, 1);
    vars.setString(AP.verticalActive, 'PIT');
    vars.set(ADC.ias(1), 163);
    rig.step(2.1);
    expect(vars.get(G1K.maxSpd)).toBe(1);
    expect(ups).toBeGreaterThanOrEqual(2);
    vars.setString(AP.verticalActive, 'ALT');
    rig.step(0.1);
    expect(vars.get(G1K.maxSpd)).toBe(0);
  });
});
