/**
 * Cessna 172S G1000 NXi: procedure / checklist fixes (audit round 1, lens "procedures", gaps PROC-01..20).
 * Each test fails without its fix. Source: POH 172SPHBUS-02 (Cessna 172S NAV III GFC 700 AFCS, Rev 2,
 * 18 Nov 2010) Sections 3 and 4.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { makeG1k, type G1kRig } from './helpers';
import { C172, ANN, FUEL_SEL, MAG, STBY_BATT, DOOR } from '../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../src/aircraft/c172-g1000/vars';
import { C172G_CHECKLISTS } from '../../../src/aircraft/c172-g1000/checklists';
import { C172G_PROC } from '../../../src/aircraft/c172-g1000/systems/procedures';
import { C172_TIRE_FAIL } from '../../../src/aircraft/c172s-common/systems/tires';
import { G1K, G1K_EVENTS } from '../../../src/avionics/garmin-g1000/vars';
import { ENG, FDM, GEAR, INPUT } from '../../../src/core/vars';
import { createC172Exterior } from '../../../src/aircraft/c172s-common/exterior';

const CRUISE = { altFtMsl: 5000, iasKt: 100 } as const;
const list = (title: string) => {
  const l = C172G_CHECKLISTS.find((c) => c.title.startsWith(title));
  if (!l) throw new Error(`no checklist ${title}`);
  return l;
};
/** Item whose challenge contains `text` (the n-th match). */
const item = (title: string, text: string, n = 0) => {
  const it = list(title).items.filter((i) => i.challenge.includes(text))[n];
  if (!it) throw new Error(`no item ${text} in ${title}`);
  return it;
};
const ok = (r: G1kRig, title: string, text: string, n = 0) => {
  const it = item(title, text, n);
  if (!it.check) throw new Error(`item ${text} has no check`);
  return it.check(r.vars);
};

describe('PROC-01 presets start with valid air data', () => {
  for (const s of ['ready_to_taxi', 'takeoff', 'cruise', 'approach'] as const) {
    it(`${s}: no red X and the AP engages at once`, () => {
      const r = makeG1k(s === 'cruise' || s === 'approach' ? { state: s, air: CRUISE } : { state: s });
      r.run(0.1);
      expect(r.vars.get('adc1.valid')).toBe(1);
      expect(ok(r, 'Before Takeoff', 'Flight Instruments (PFD)')).toBe(true);
      r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
      r.run(0.3);
      expect(r.vars.get('ap.engaged')).toBe(1);
    });
  }
  it('cold & dark still runs the ADC power-up self test', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.vars.set(C172.stbyBatt, STBY_BATT.arm);
    r.run(0.5);
    expect(r.vars.get('adc1.valid')).toBe(0);
  });
});

describe('PROC-02 re-based on 172SPHBUS-02', () => {
  it('magneto drop 175 RPM, STBY BATT TEST 10 s, After Landing STROBE OFF', () => {
    expect(item('Before Takeoff', 'MAGNETOS').response).toContain('175 RPM');
    expect(item('Starting Engine (With Battery)', 'TEST').response).toContain('10 seconds');
    const r = makeG1k({ state: 'takeoff' });
    r.run(0.1);
    expect(ok(r, 'After Landing', 'STROBE')).toBe(false);
    r.vars.set(C172.strobe, 0);
    expect(ok(r, 'After Landing', 'STROBE')).toBe(true);
  });
});

describe('PROC-03 Starting Engine (With External Power)', () => {
  it('ground power gives ~28 V on the main bus; internal power check passes after start', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    const T = 'Starting Engine (With External Power)';
    expect(list(T).items.length).toBeGreaterThanOrEqual(29);
    expect(ok(r, T, 'External Power')).toBe(false);
    r.vars.set(C172G.gpuRequest, 1);
    r.run(0.5);
    expect(ok(r, T, 'External Power')).toBe(true);
    r.vars.set(C172.masterBat, 1);
    r.vars.set(C172.masterAlt, 1);
    r.run(2);
    expect(ok(r, T, 'M BUS VOLTS')).toBe(true);

    // 27. Internal Power - CHECK (engine running, ground power disconnected).
    const e = makeG1k({ state: 'ready_to_taxi' });
    e.run(2);
    e.vars.set(C172.masterAlt, 0);
    e.vars.set(C172.land, 1);
    e.vars.set(C172.throttle, 0);
    e.run(2);
    expect(ok(e, T, 'MASTER Switch (ALT)')).toBe(true);
    e.vars.set(C172.masterAlt, 1);
    e.vars.set(C172.throttle, 0.1);
    e.run(15);
    expect(ok(e, T, 'M BATT Ammeter')).toBe(true);
    expect(ok(e, T, 'LOW VOLTS', 1)).toBe(true);
  });
});

describe('PROC-04 ditching / flat tire checklists and tyre failures', () => {
  it('the three POH lists exist with their items', () => {
    expect(list('EMERGENCY — Ditching').items).toHaveLength(13);
    expect(list('ABNORMAL LANDING — Landing With a Flat Main Tire').items).toHaveLength(4);
    expect(list('ABNORMAL LANDING — Landing With a Flat Nose Tire').items).toHaveLength(4);
  });
  it('ditching: MAYDAY on 121.5 with 7700 and ELT ON are checked', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(0.5);
    expect(ok(r, 'EMERGENCY — Ditching', 'Radio')).toBe(false);
    r.vars.set('com1.active_mhz', 121.5);
    r.vars.set('xpdr.code', 7700);
    expect(ok(r, 'EMERGENCY — Ditching', 'Radio')).toBe(true);
    expect(ok(r, 'EMERGENCY — Ditching', 'ELT')).toBe(false);
    r.vars.set(C172G.eltRocker, 1);
    expect(ok(r, 'EMERGENCY — Ditching', 'ELT')).toBe(true);
  });
  it('a flat left main tyre lowers the left wing and pulls the taxiing airplane left', () => {
    const taxi = (fail: boolean) => {
      const r = makeG1k({ state: 'ready_to_taxi' });
      r.vars.set(C172.parkingBrake, 0);
      if (fail) r.sys.core.failures.trigger(C172_TIRE_FAIL.left);
      r.run(6);
      const bank = r.vars.get(FDM.bank);
      const h0 = r.vars.get(FDM.headingTrue);
      r.vars.set(C172.throttle, 0.25);
      r.run(12);
      let dh = r.vars.get(FDM.headingTrue) - h0;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      return { bank, dh, flat: r.vars.get(GEAR.tireFlat(1)) };
    };
    const good = taxi(false);
    const flat = taxi(true);
    expect(flat.flat).toBeGreaterThan(0.95);
    expect(flat.bank).toBeLessThan(good.bank - 0.5); // left wing down
    expect(flat.dh).toBeLessThan(good.dh - 5); // swings left
  });
});

describe('PROC-05 / PROC-06 electrical malfunction lists', () => {
  it('LOW VOLTS below 1000 RPM is its own list; the higher-RPM list sheds load item by item', () => {
    const low = list('EMERGENCY — LOW VOLTS Annunciator Comes On Below 1000 RPM');
    expect(low.items[0].check).toBeDefined();
    const high = list('EMERGENCY — LOW VOLTS Annunciator Comes On or Does Not Go Off at Higher RPM');
    expect(high.items.some((i) => i.challenge === 'IF LOW VOLTS ANNUNCIATOR REMAINS ON')).toBe(true);
    for (const t of ['7. MASTER Switch (ALT Only)', 'a. AVIONICS', 'b. PITOT', 'c. BEACON', 'd. LAND', 'e. TAXI', 'f. NAV', 'g. STROBE', 'h. CABIN PWR', 'j. COM1 MIC', 'k. AVIONICS']) {
      expect(high.items.find((i) => i.challenge.startsWith(t))?.check, t).toBeDefined();
    }
    const hv = list('EMERGENCY — HIGH VOLTS');
    expect(hv.items.filter((i) => /^[a-k]\. /.test(i.challenge))).toHaveLength(11);
  });
  it('COM1 MIC and NAV1 - SELECT reads the GMA 1360 selection', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(0.5);
    const T = 'EMERGENCY — HIGH VOLTS';
    r.vars.set(G1K.gmaMic, 2);
    expect(ok(r, T, 'j. COM1 MIC')).toBe(false);
    r.vars.set(G1K.gmaMic, 1);
    r.vars.set(G1K.gmaSel('nav1'), 1);
    expect(ok(r, T, 'j. COM1 MIC')).toBe(true);
  });
});

describe('PROC-07 approach preset: Before Landing complete', () => {
  it('LAND and TAXI lights on by day', () => {
    const r = makeG1k({ state: 'approach', air: { altFtMsl: 2000, iasKt: 80 } });
    r.run(0.2);
    expect(r.vars.get(C172.taxi)).toBe(1);
    expect(ok(r, 'Before Landing', 'LAND and TAXI')).toBe(true);
  });
});

describe('PROC-08 autopilot preflight test (Before Takeoff 13-15)', () => {
  it('ticks only after engage, overpower in pitch and roll, and A/P TRIM DISC with the alert', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(1);
    const T = 'Before Takeoff';
    expect(ok(r, T, 'A/P TRIM DISC')).toBe(false);
    expect(ok(r, T, 'Autopilot')).toBe(false);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(0.5);
    expect(r.vars.get('ap.engaged')).toBe(1);
    expect(ok(r, T, 'Autopilot')).toBe(true);
    r.vars.set(INPUT.pitch, 0.6);
    r.run(0.5);
    r.vars.set(INPUT.pitch, 0);
    expect(ok(r, T, 'Flight Controls', 1)).toBe(false); // roll not yet
    r.vars.set(INPUT.roll, -0.6);
    r.run(0.5);
    r.vars.set(INPUT.roll, 0);
    expect(r.vars.get('ap.engaged')).toBe(1);
    expect(ok(r, T, 'Flight Controls', 1)).toBe(true);
    r.events.emit('ap.disc');
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(0);
    expect(ok(r, T, 'A/P TRIM DISC')).toBe(true);
  });
  it('disengaging with the AP key instead does not count', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(1);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(0.5);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(0);
    expect(r.vars.get(C172G_PROC.apDiscTest)).toBe(0);
  });
});

describe('PROC-09 Before Takeoff annunciators: the whole PFD annunciation window', () => {
  it('LOW FUEL L fails the check (the old four-annunciator check passed)', () => {
    const r = makeG1k({ state: 'takeoff' });
    r.run(1);
    expect(ok(r, 'Before Takeoff', 'Annunciators')).toBe(true);
    r.sys.core.failures.trigger('c172.fuel_xmtr_l');
    r.run(2);
    expect(r.vars.get(ANN.lowFuelL)).toBe(1);
    expect(ok(r, 'Before Takeoff', 'Annunciators')).toBe(false);
  });
});

describe('PROC-10 PFD ON means the GDU is up', () => {
  it('preflight item 10 waits for the PFD to come up', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(0.5);
    r.vars.set(C172.masterBat, 1);
    r.vars.set(C172.masterAlt, 1);
    r.run(2);
    expect(r.vars.get('elec.pfd_powered')).toBe(1);
    expect(ok(r, 'Preflight Inspection — 1 Cabin', 'Primary Flight Display')).toBe(false);
    r.run(60, () => r.vars.get(G1K.unitUp('pfd')) > 0.5);
    expect(ok(r, 'Preflight Inspection — 1 Cabin', 'Primary Flight Display')).toBe(true);
  });
});

describe('PROC-11 start checks: oil pressure green band, charge positive', () => {
  it('30 psi is not the green band; zero amps is not a charge', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(2);
    const T = 'Starting Engine (With Battery)';
    r.vars.set(ENG.oilPressPsi(1), 55); // just after a start (probe: 54.7 psi, cold oil)
    expect(ok(r, T, 'Oil Pressure')).toBe(true);
    r.vars.set(ENG.oilPressPsi(1), 30);
    expect(ok(r, T, 'Oil Pressure')).toBe(false);
    r.vars.set(C172.sBattA, 0);
    expect(ok(r, T, 'AMPS')).toBe(false);
  });
});

describe('PROC-12 emergency list structure per the POH', () => {
  it('branches, split lists, full icing list', () => {
    const f = list('EMERGENCY — Fire During Start on Ground').items.map((i) => i.challenge);
    expect(f).toContain('IF ENGINE STARTS');
    expect(f).toContain('IF ENGINE FAILS TO START');
    expect(f.some((c) => c.includes('Fire Damage'))).toBe(true);
    for (const t of ['Airspeed Indicator', 'Altitude Indicator', 'Attitude Indicator', 'Horizontal Situation']) expect(() => list(`EMERGENCY — Red X: PFD ${t}`.replace('PFD Horizontal', 'Horizontal'))).not.toThrow();
    expect(list('EMERGENCY — Inadvertent Icing').items.filter((i) => /^\d+\. /.test(i.challenge))).toHaveLength(14);
    const e = list('EMERGENCY — Electrical Fire').items.map((i) => i.challenge);
    expect(e.some((c) => c.startsWith('8. Cabin Vents'))).toBe(true);
    expect(e.some((c) => c.startsWith('9. CABIN HT'))).toBe(true);
    expect(e.some((c) => c.startsWith('IF FIRE HAS BEEN EXTINGUISHED'))).toBe(true);
    const p = list('EMERGENCY — Precautionary').items.map((i) => i.challenge);
    expect(p[0]).toContain('Seat Backs');
    expect(p[1]).toContain('Seats and Seat Belts');
  });
});

describe('PROC-13 fire cues outside the airplane', () => {
  it('engine and wing fires show flames and smoke; nothing is drawn while nothing burns', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    const ext = createC172Exterior(r.vars, { ledLights: true });
    const cue = (n: string) => ext.root.getObjectByName(n) as THREE.Sprite;
    ext.update(1 / 60);
    for (const n of ['fire_cowl', 'smoke_cowl', 'fire_wing', 'smoke_wing']) expect(cue(n).visible).toBe(false);
    r.sys.core.failures.trigger('c172.fire.engine');
    r.sys.core.failures.trigger('c172.fire.wing');
    r.run(5);
    ext.update(1 / 60);
    expect(r.vars.get(C172.fireEngine)).toBeGreaterThan(0.02);
    for (const n of ['fire_cowl', 'smoke_cowl', 'fire_wing', 'smoke_wing']) expect(cue(n).visible).toBe(true);
    ext.dispose();
  });
});

describe('PROC-14 exterior walk-around by station', () => {
  it('stations 2-8 in POH order, baggage door checked', () => {
    const items = list('Preflight Inspection — Exterior').items.map((i) => i.challenge);
    const heads = items.filter((c) => /^\d [A-Z]/.test(c));
    expect(heads).toEqual(['2 EMPENNAGE', '3 RIGHT WING Trailing Edge', '4 RIGHT WING', '5 NOSE', '6 LEFT WING', '7 LEFT WING Leading Edge', '8 LEFT WING Trailing Edge']);
    const r = makeG1k({ state: 'cold_dark' });
    r.run(0.2);
    expect(ok(r, 'Preflight Inspection — Exterior', 'Baggage')).toBe(true);
    r.vars.set(C172.baggageDoor, DOOR.closed);
    expect(ok(r, 'Preflight Inspection — Exterior', 'Baggage')).toBe(false);
  });
});

describe('PROC-15 more auto-checks', () => {
  it('breakers in, electrical equipment off, STBY BATT TEST latched after 10 s', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(0.5);
    expect(ok(r, 'Before Starting Engine', 'Circuit Breakers')).toBe(true);
    r.vars.set('cb.nav_lts', 0);
    expect(ok(r, 'Before Starting Engine', 'Circuit Breakers')).toBe(false);
    r.vars.set('cb.nav_lts', 1);
    expect(ok(r, 'Before Starting Engine', 'Electrical Equipment')).toBe(true);
    r.vars.set(C172.nav, 1);
    expect(ok(r, 'Before Starting Engine', 'Electrical Equipment')).toBe(false);
    r.vars.set(C172.nav, 0);
    const T = 'Starting Engine (With Battery)';
    r.vars.set(C172.stbyBatt, STBY_BATT.test);
    r.run(5);
    r.vars.set(C172.stbyBatt, STBY_BATT.off);
    r.run(0.2);
    expect(ok(r, T, 'TEST')).toBe(false); // released too early
    r.vars.set(C172.stbyBatt, STBY_BATT.test);
    r.run(10.5);
    r.vars.set(C172.stbyBatt, STBY_BATT.arm);
    r.run(0.5);
    expect(ok(r, T, 'TEST')).toBe(true);
  });
  it('magneto check measures both drops against BOTH at 1800 RPM', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(2);
    let t = 0.14;
    for (let i = 0; i < 25; i++) {
      t += (1800 - r.vars.get(ENG.rpm(1))) * 0.0002;
      r.vars.set(C172.throttle, t);
      r.run(1);
    }
    expect(ok(r, 'Before Takeoff', 'Throttle Control')).toBe(true);
    expect(ok(r, 'Before Takeoff', 'MAGNETOS')).toBe(false);
    r.vars.set(C172.magneto, MAG.right);
    r.run(4);
    r.vars.set(C172.magneto, MAG.both);
    r.run(4);
    expect(ok(r, 'Before Takeoff', 'MAGNETOS')).toBe(false); // left not yet checked
    r.vars.set(C172.magneto, MAG.left);
    r.run(4);
    r.vars.set(C172.magneto, MAG.both);
    r.run(1);
    expect(r.vars.get(C172G_PROC.magDropR)).toBeGreaterThan(10);
    expect(r.vars.get(C172G_PROC.magDropL)).toBeGreaterThan(10);
    expect(ok(r, 'Before Takeoff', 'MAGNETOS')).toBe(true);
  });
  it('a dead left magneto fails the magneto check', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(2);
    r.sys.core.failures.trigger('c172.mag_left');
    let t = 0.14;
    for (let i = 0; i < 25; i++) {
      t += (1800 - r.vars.get(ENG.rpm(1))) * 0.0002;
      r.vars.set(C172.throttle, t);
      r.run(1);
    }
    r.vars.set(C172.magneto, MAG.right);
    r.run(4);
    r.vars.set(C172.magneto, MAG.both);
    r.run(4);
    r.vars.set(C172.magneto, MAG.left);
    r.run(4);
    r.vars.set(C172.magneto, MAG.both);
    r.run(1);
    expect(ok(r, 'Before Takeoff', 'MAGNETOS')).toBe(false);
  });
});

describe('PROC-16 / PROC-17 / PROC-18 presets and the taxi list', () => {
  it('cold & dark fuel selector as Securing Airplane left it', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(0.2);
    expect(r.vars.get(C172.fuelSelector)).toBe(FUEL_SEL.left);
    expect(ok(r, 'Securing Airplane', 'FUEL SELECTOR')).toBe(true);
    expect(ok(r, 'Preflight Inspection — 1 Cabin', 'FUEL SELECTOR')).toBe(false);
  });
  it('ready to taxi idles at 800-1000 RPM and satisfies the taxi leaning item', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(10);
    const rpm = r.vars.get(ENG.rpm(1));
    expect(rpm).toBeGreaterThan(800);
    expect(rpm).toBeLessThan(1000);
    expect(list('Taxi').phase).toBe('taxi');
    expect(ok(r, 'Taxi', 'Throttle Control', 1)).toBe(true);
  });
});

describe('PROC-19 POH wording', () => {
  it('verbatim items', () => {
    expect(item('Descent', 'FMS/GPS').response).toBe('REVIEW and BRIEF (OBS/SUSP softkey operation for holding pattern procedure (IFR))');
    expect(item('Before Takeoff', 'Standby Altimeter').check).toBeDefined();
    expect(item('Before Takeoff', 'Autopilot').response).toContain('(if installed)');
    expect(item('Starting Engine (With Battery)', 'Mixture Control', 1).response).toContain('approximately 3 to 5 seconds');
  });
});

describe('PROC-20 emergency airspeeds are checked', () => {
  it('best glide 68 KIAS', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 68 } });
    r.run(0.5);
    expect(ok(r, 'EMERGENCY — Engine Failure During Flight', 'Airspeed')).toBe(true);
    expect(ok(r, 'EMERGENCY — Engine Fire in Flight', 'Airspeed')).toBe(false);
  });
});
