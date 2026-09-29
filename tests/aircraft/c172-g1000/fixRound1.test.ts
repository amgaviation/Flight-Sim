/**
 * Cessna 172S G1000 NXi: function fixes (audit round 1, gaps F1-F20). Each test fails without its fix.
 * Sources: POH = Cessna 172S NAV III GFC 700 AFCS POH 172SPHBUS-00; CRG = G1000 Cockpit Reference Guide
 * 190-00384-12 (GFC 700); PG = G1000 NXi Pilot's Guide 190-02177-02.
 */
import { describe, expect, it } from 'vitest';
import { makeG1k, cas, hold, type G1kRig } from './helpers';
import { C172, C172_FAIL, DOOR, ELT_SW, STBY_BATT } from '../../../src/aircraft/c172s-common/vars';
import { C172G, C172G_FAIL, ELT_ROCKER, MET } from '../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS, CDI_SOURCE } from '../../../src/avionics/garmin-g1000/vars';
import { eisElecLevel } from '../../../src/avionics/garmin-g1000/gdu/Eis';
import { C172S_EIS } from '../../../src/avionics/garmin-g1000/presets';
import { NAV } from '../../../src/core/vars';

const CRUISE = { altFtMsl: 6000, iasKt: 105 } as const;
const msgs = (r: G1kRig) => r.sys.suite.system.alerts.messages.list.filter((m) => m.active).map((m) => m.text);
const engageAp = (r: G1kRig) => {
  r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
  r.run(0.5);
  expect(r.vars.get('ap.engaged')).toBe(1);
};
/** Private Afcs internals (mode forcing for guidance-loss tests). */
const afcsAny = (r: G1kRig) => r.sys.afcs as unknown as { setLat(m: string): void; lat: string; latArmed: string };

describe('F1/F20 standby battery controller (POH 7-51, Fig 7-7)', () => {
  it('MASTER OFF in flight with STBY BATT ARM: PFD and AHRS stay up without a reboot', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    expect(r.vars.get(C172.stbyBatt)).toBe(STBY_BATT.arm);
    r.vars.set(C172.masterAlt, 0);
    r.vars.set(C172.masterBat, 0);
    let minPfd = 1;
    let minAhrs = 1;
    r.run(20, () => {
      minPfd = Math.min(minPfd, r.vars.get(G1K.unitUp('pfd')));
      minAhrs = Math.min(minAhrs, r.vars.get('ahrs1.valid'));
    });
    expect(minPfd).toBe(1);
    expect(minAhrs).toBe(1);
    expect(r.vars.get('elec.ess_v')).toBeGreaterThan(22);
    expect(r.vars.get('elec.stby_batt_amps')).toBeLessThan(-1);
  });

  it('main bus sense comes through the WARN breaker: pulling WARN releases the controller', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    expect(r.vars.get('ac.c172.stby_release')).toBe(0);
    r.vars.set('cb.warn', 0);
    r.run(0.5);
    expect(r.vars.get('ac.c172.stby_release')).toBe(1);
  });
});

describe('F2 A/P TRIM DISC interrupts ESP only while held (CRG §6.1, PG §8.11)', () => {
  it('press and release: the ESP interrupt ends', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    const esp = (r.sys.suite.system as unknown as { esp: { interrupt: boolean } }).esp;
    r.vars.set(C172G.apDisc, 1);
    r.events.emit('ap.disc');
    r.run(0.3);
    expect(esp.interrupt).toBe(true);
    r.vars.set(C172G.apDisc, 0);
    r.run(0.3);
    expect(esp.interrupt).toBe(false);
  });
});

describe('F3 disconnect alerting (CRG §6.4)', () => {
  it('automatic disconnect: red AP and the aural latch until MET ARM acknowledges', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    engageAp(r);
    r.vars.set('cb.autopilot', 0);
    r.run(10);
    expect(r.vars.get('ap.engaged')).toBe(0);
    expect(r.vars.get('ap.disc_auto')).toBe(1);
    expect(r.vars.get('ap.disc_warn')).toBe(1);
    expect(r.vars.get('alert.ap_disc_aural')).toBe(1);
    // MET ARM half alone (acknowledge).
    r.vars.set(C172G.metHalf, 1);
    hold(r, C172G.met, MET.noseUp, 0.2, MET.off);
    r.vars.set(C172G.metHalf, 0);
    r.run(0.2);
    expect(r.vars.get('ap.disc_warn')).toBe(0);
    expect(r.vars.get('alert.ap_disc_aural')).toBe(0);
  });

  it('manual disconnect: 3 s aural, 5 s flashing', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    engageAp(r);
    r.events.emit('ap.disc');
    r.run(2.5);
    expect(r.vars.get('alert.ap_disc_aural')).toBe(1);
    r.run(1);
    expect(r.vars.get('alert.ap_disc_aural')).toBe(0);
    expect(r.vars.get('ap.disc_warn')).toBe(1);
    r.run(2);
    expect(r.vars.get('ap.disc_warn')).toBe(0);
  });
});

describe('F4 / F14 GFC 700 navigation source (POH 7-20 / 7-71 WARNING, CRG §6.3)', () => {
  it('a manual CDI change reverts an active or armed NAV mode to ROL', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    engageAp(r);
    r.sys.suite.system.setCdiSource(CDI_SOURCE.nav1);
    r.run(0.2);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'nav'));
    r.run(0.2);
    expect(r.vars.getString('ap.lat_armed')).toContain('VOR');
    r.sys.suite.system.cycleCdi();
    r.run(0.2);
    expect(r.vars.getString('ap.lat_armed')).not.toContain('VOR');
    // Active VOR, then CDI -> GPS.
    r.vars.set(NAV.received(1), 1);
    afcsAny(r).setLat('VOR');
    r.run(0.1);
    r.sys.suite.system.cycleCdi();
    r.run(0.1);
    expect(r.vars.getString('ap.lat_active')).toBe('ROL');
  });

  it('loss of the nav signal: flashing yellow mode, wings level, ROL after 10 s', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    engageAp(r);
    r.sys.suite.system.setCdiSource(CDI_SOURCE.nav1);
    afcsAny(r).setLat('VOR');
    r.vars.set(NAV.received(1), 0);
    r.run(1);
    expect(r.vars.get('ap.lat_fail')).toBe(1);
    r.run(6);
    expect(r.vars.getString('ap.lat_active')).toBe('VOR');
    expect(Math.abs(r.vars.get('ap.fd_bank_deg'))).toBeLessThan(2);
    r.run(4);
    expect(r.vars.getString('ap.lat_active')).toBe('ROL');
    expect(r.vars.get('ap.lat_fail')).toBe(0);
  });
});

describe('F5 LOW VOLTS aural inhibited on the ground (CRG §13.2)', () => {
  it('LOW VOLTS shows on the ground without the warning chime; in the air the chime sounds', () => {
    const g = makeG1k({ state: 'ready_to_taxi' });
    g.run(2);
    g.vars.set(`fail.${C172_FAIL.altBelt}`, 1);
    g.vars.set(C172.land, 1);
    g.vars.set(C172.taxi, 1);
    g.vars.set(C172.pitotHeat, 1);
    g.run(20);
    expect(cas(g)).toContain('LOW VOLTS');
    expect(g.vars.get(G1K.warnChime)).toBe(0);
    const a = makeG1k({ state: 'cruise', air: CRUISE });
    a.run(2);
    a.vars.set(`fail.${C172_FAIL.altBelt}`, 1);
    a.vars.set(C172.land, 1);
    a.vars.set(C172.pitotHeat, 1);
    a.run(30);
    expect(cas(a)).toContain('LOW VOLTS');
    expect(a.vars.get(G1K.warnChime)).toBe(1);
  });
});

describe('F7 EIS electrical colours (POH 7-53 / 7-54)', () => {
  it('bus volts red above 32.0 V and below 24.5 V; M BATT amber only below -1.5 A', () => {
    const el = C172S_EIS.elec;
    expect(eisElecLevel(el, 'bus', 28.4)).toBe(0);
    expect(eisElecLevel(el, 'bus', 32.3)).toBe(2);
    expect(eisElecLevel(el, 'bus', 24.0)).toBe(2);
    expect(eisElecLevel(el, 'mbatt', -1.0)).toBe(0);
    expect(eisElecLevel(el, 'mbatt', -2.0)).toBe(1);
    expect(eisElecLevel(el, 'sbatt', -0.5)).toBe(1);
  });
});

describe('F8 fire procedures (POH Sec 3)', () => {
  it('engine fire in flight goes out once the fuel is cut; smoke enters through CABIN HT', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172.cabinHeat, 1);
    r.vars.set(`fail.${C172_FAIL.fireEngine}`, 1);
    r.run(30);
    expect(r.vars.get(C172.fireEngine)).toBeGreaterThan(0.5);
    expect(r.vars.get(C172.cabinSmoke)).toBeGreaterThan(0.05);
    // Checklist: mixture IDLE CUTOFF, FUEL SHUTOFF OFF, FUEL PUMP OFF.
    r.vars.set(C172.mixture, 0);
    r.vars.set(C172.fuelShutoff, 0);
    r.vars.set(C172.fuelPump, 0);
    r.run(240);
    expect(r.vars.get(C172.fireEngine)).toBe(0);
  });

  it('electrical fire: burns while energised, dies with STBY BATT and MASTER OFF', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(`fail.${C172_FAIL.fireElectrical}`, 1);
    r.run(60);
    expect(r.vars.get(C172.fireElectrical)).toBeGreaterThan(0.5);
    // MASTER OFF alone: the standby battery keeps the ESS bus (and the fire) alive.
    r.vars.set(C172.masterAlt, 0);
    r.vars.set(C172.masterBat, 0);
    r.run(30);
    expect(r.vars.get(C172.fireElectrical)).toBeGreaterThan(0.3);
    r.vars.set(C172.stbyBatt, STBY_BATT.off);
    r.run(120);
    expect(r.vars.get(C172.fireElectrical)).toBe(0);
  });

  it('cabin fire: only the extinguisher (ring pin pulled) puts it out', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172.cabinAir, 1);
    r.vars.set(`fail.${C172_FAIL.fireCabin}`, 1);
    r.run(60);
    expect(r.vars.get(C172.fireCabin)).toBeGreaterThan(0.5);
    hold(r, C172G.extTrigger, 1, 3, 0);
    expect(r.vars.get(C172.fireCabin)).toBeGreaterThan(0.5);
    r.vars.set(C172.cabinAir, 0);
    r.vars.set(C172G.extPin, 1);
    hold(r, C172G.extTrigger, 1, 8, 0);
    r.run(5);
    expect(r.vars.get(C172.fireCabin)).toBe(0);
  });

  it('wing fire goes out when its lights and pitot heat are switched off', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172.nav, 1);
    r.vars.set(C172.pitotHeat, 1);
    r.vars.set(`fail.${C172_FAIL.fireWing}`, 1);
    r.run(30);
    expect(r.vars.get(C172.fireWing)).toBeGreaterThan(0.5);
    for (const s of [C172.land, C172.taxi, C172.nav, C172.strobe, C172.pitotHeat]) r.vars.set(s, 0);
    r.run(120);
    expect(r.vars.get(C172.fireWing)).toBe(0);
  });
});

describe('F10 MET split switch (CRG §6.1)', () => {
  it('trims only with both halves; one half alone > 3 s gives PTRM until released', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    const t0 = r.vars.get(C172.trimPosition);
    r.vars.set(C172G.metHalf, 2); // DN/UP half only
    hold(r, C172G.met, MET.noseUp, 1, MET.off);
    expect(Math.abs(r.vars.get(C172.trimPosition) - t0)).toBeLessThan(1e-3);
    r.vars.set(C172G.metHalf, 1); // ARM half alone for 4 s
    r.vars.set(C172G.met, MET.noseUp);
    r.run(4);
    expect(r.vars.get(C172G.metFault)).toBe(1);
    expect(r.vars.getString(G1K.afcsStatus)).toBe('PTRM');
    r.vars.set(C172G.met, MET.off);
    r.vars.set(C172G.metHalf, 0);
    r.run(0.5);
    expect(r.vars.get(C172G.metFault)).toBe(0);
    hold(r, C172G.met, MET.noseUp, 1, MET.off);
    expect(r.vars.get(C172.trimPosition)).toBeGreaterThan(t0 + 0.04);
  });

  it('MET ARM half disengages the autopilot', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    engageAp(r);
    r.vars.set(C172G.metHalf, 1);
    hold(r, C172G.met, MET.noseDn, 0.2, MET.off);
    expect(r.vars.get('ap.engaged')).toBe(0);
  });
});

describe('F11 avionics cooling fans (POH 7-73, Fig 7-7 sheet 2)', () => {
  it('fans need both AVIONICS buses; each follows its breaker; they are electrical loads', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    for (const f of [C172G.fwdFan, C172G.pfdFan, C172G.mfdFan, C172G.aftFan]) expect(r.vars.get(f)).toBe(1);
    expect(r.vars.get('elec.fan_deck_amps')).toBeGreaterThan(0.1);
    r.vars.set(C172.avionicsBus2, 0);
    r.run(0.5);
    expect(r.vars.get(C172G.fwdFan)).toBe(0);
    r.vars.set(C172.avionicsBus2, 1);
    r.vars.set('cb.pfd_avn1', 0);
    r.run(0.5);
    expect(r.vars.get(C172G.fwdFan)).toBe(0);
    expect(r.vars.get(C172G.pfdFan)).toBe(0);
    expect(r.vars.get(C172G.mfdFan)).toBe(1);
    r.vars.set('cb.nav2', 0);
    r.run(0.5);
    expect(r.vars.get(C172G.aftFan)).toBe(0);
  });
});

describe('F12 cabin door in flight (POH 7-27, Sec 3)', () => {
  it('an unlatched door trails ~3 in open with drag and cannot be pulled shut at cruise speed; the handle springs to CLOSE', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    const shut = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    shut.run(2);
    r.vars.set(C172G.doorHandleLeft, DOOR.open);
    r.run(1);
    expect(r.vars.get(C172G.doorHandleLeft)).toBe(DOOR.closed);
    expect(r.vars.get(C172.doorLeft)).toBe(DOOR.open);
    expect(r.vars.get(C172.doorLeftPos)).toBeGreaterThan(0.05);
    expect(r.vars.get(C172.doorLeftPos)).toBeLessThan(0.15);
    r.run(150);
    shut.run(151);
    expect(shut.vars.get('fdm.ias_kt') - r.vars.get('fdm.ias_kt')).toBeGreaterThan(1.5);
    hold(r, C172G.doorPullLeft, 1, 0.2, 0);
    r.run(0.2);
    expect(r.vars.get(C172.doorLeft)).toBe(DOOR.open);
  });
});

describe('F13 ELT (NXi Supplement 1)', () => {
  it('light flashes, aural on, sweep heard on COM1 tuned to 121.5', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172G.eltRocker, ELT_ROCKER.on);
    const seen = new Set<number>();
    r.run(2, () => void seen.add(r.vars.get(C172G.eltLight)));
    expect(r.vars.get(C172.elt)).toBe(ELT_SW.on);
    expect(seen.has(0) && seen.has(1)).toBe(true);
    expect(r.vars.get(C172G.eltAural)).toBe(1);
    expect(r.vars.get(C172G.eltComAudio)).toBe(0);
    r.vars.set(NAV.comActive(1), 121.5);
    r.run(0.5);
    expect(r.vars.get(C172G.eltComAudio)).toBe(1);
  });
});

describe('F15 standby battery charge after start (POH 7-54)', () => {
  it('S BATT shows a (small) charge in ready to taxi', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(5);
    expect(r.vars.get(C172.sBattA)).toBeGreaterThan(0.05);
    expect(r.vars.get(C172.sBattA)).toBeLessThan(1);
  });
});

describe('F17 CO detector messages (POH 7-80)', () => {
  it('CO DET FAIL inhibits CO LVL HIGH; CO DET SRVC is a message', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(`fail.${C172_FAIL.coDetSrvc}`, 1);
    r.run(1);
    expect(msgs(r).some((t) => t.startsWith('CO DET SRVC'))).toBe(true);
    r.vars.set(`fail.${C172_FAIL.coDetFail}`, 1);
    r.vars.set(C172.cabinHeat, 1);
    r.vars.set(`fail.${C172_FAIL.mufflerLeak}`, 1);
    r.run(60);
    expect(r.vars.get('ac.c172.co_ppm')).toBeGreaterThan(50);
    expect(msgs(r).some((t) => t.startsWith('CO DET FAIL'))).toBe(true);
    expect(cas(r)).not.toContain('CO LVL HIGH');
  });
});

describe('F19 external power (POH 7-58)', () => {
  it('GPU connects only on the ground with the engine stopped', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    r.vars.set(C172G.gpuRequest, 1);
    r.run(0.2);
    expect(r.vars.get(C172.extPower)).toBe(1);
    r.vars.set(C172.masterBat, 1);
    r.run(1);
    expect(r.vars.get('elec.gpu_online')).toBe(1);
    const a = makeG1k({ state: 'cruise', air: CRUISE });
    a.run(1);
    a.vars.set(C172G.gpuRequest, 1);
    a.run(0.2);
    expect(a.vars.get(C172.extPower)).toBe(0);
  });
});
