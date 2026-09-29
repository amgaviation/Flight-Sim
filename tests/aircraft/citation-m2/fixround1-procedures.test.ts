/**
 * Citation M2 fix round 1, PROCEDURES lens (M2-L42/L43, F27/F49/F61/F62/F63, PROC-01/06/07/08/17..25/32..34).
 * Each case fails without its fix:
 *  - cruise preset in the CRU detent below the N1 red line, altimeters STD above the transition altitude;
 *  - approach transition with a hold-in-lieu keeps the leg into the IAF (shared FlightPlan);
 *  - AFM phase structure, emergency / abnormal lists, CAS -> checklist links;
 *  - procedure latches (system tests, CVR / mask test, electrical, trim and AP disconnect checks, breakers) tick the
 *    cockpit-preparation / before-taxi / electrical-check items;
 *  - before landing requires the yaw damper off; emergency lists tick from the real controls.
 */
import { describe, expect, it } from 'vitest';
import { ENG } from '../../../src/core/vars';
import { M2, TEST_SEL, TLA, PRESS_SRC } from '../../../src/aircraft/citation-m2/vars';
import { M2_CHECKLISTS, M2_NORMAL, M2_EMERGENCY, M2_ABNORMAL, M2_CAS_CHECKLIST } from '../../../src/aircraft/citation-m2/checklists';
import { M2_CAS } from '../../../src/aircraft/citation-m2/systems/cas';
import { M2_SIDE_VARS } from '../../../src/aircraft/citation-m2/cockpit/side/services';
import { cruiseIas } from '../../../src/ui/startPosition';
import { parseRoute } from '../../../src/nav/flightplan/RouteParser';
import { computePlanGeometry } from '../../../src/nav/flightplan/geometry';
import { loadNav, makeM2, press, type Rig } from './helpers';

const list = (title: string) => {
  const c = M2_CHECKLISTS.find((x) => x.title === title);
  if (!c) throw new Error(`no checklist ${title}`);
  return c;
};
const item = (title: string, challenge: string, response?: string) => {
  const it = list(title).items.find((i) => i.challenge === challenge && (response === undefined || i.response.startsWith(response)));
  if (!it) throw new Error(`no item ${title} / ${challenge} / ${response}`);
  return it;
};
const ok = (r: Rig, title: string, challenge: string, response?: string) => item(title, challenge, response).check!(r.vars);

describe('Citation M2 fix round 1 (procedures): initial states', () => {
  it('cruise preset: throttles in the CRU detent, N1 below the red line, FPG cruise speed held (PROC-06)', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 37000, iasKt: cruiseIas(396, 37000) } });
    const v = r.vars;
    for (const i of [1, 2]) expect(Math.abs(v.get(M2.tla(i)) - TLA.cru)).toBeLessThan(0.03);
    r.run(20);
    for (const i of [1, 2]) expect(v.get(ENG.n1(i))).toBeLessThan(101);
    expect(Math.abs(v.get('fdm.tas_kt') - 396)).toBeLessThan(8);
    expect(ok(r, 'Cruise', 'Throttles')).toBe(true);
  });

  it('altimeters: STD x3 above the transition altitude in cruise, QNH in the approach preset (PROC-07)', () => {
    const c = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 37000, iasKt: 220 } });
    c.run(1);
    for (const i of [1, 2, 3]) expect(c.vars.get(`adc${i}.baro_std`)).toBe(1);
    expect(ok(c, 'After takeoff / climb', 'Altimeters (18,000 ft)')).toBe(true);
    expect(ok(c, 'Descent', 'Altimeters (18,000 ft)')).toBe(false);
    const a = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 3000, iasKt: 140 } });
    a.run(1);
    for (const i of [1, 2, 3]) expect(a.vars.get(`adc${i}.baro_std`)).toBe(0);
    expect(ok(a, 'Descent', 'Altimeters (18,000 ft)')).toBe(true);
  });

  it('in-air presets schedule the pressurization from a real field elevation, not 0 ft (PROC-08)', async () => {
    const db = await loadNav();
    const apt = db.airport('KDEN')!;
    const r = makeM2({ state: 'approach', nav: db, air: { altFtMsl: apt.elevationFt + 3000, iasKt: 150, lat: apt.lat - 0.1, lon: apt.lon } });
    r.run(2);
    expect(Math.abs(r.vars.get('press.ldg_elev_ft') - apt.elevationFt)).toBeLessThan(200);
    expect(Math.abs(r.vars.get(M2.takeoffFieldElevFt) - apt.elevationFt)).toBeLessThan(200);
  });
});

describe('Citation M2 fix round 1 (procedures): FMS hold-in-lieu transition (shared nav, M2-L42 / F63)', () => {
  it('KICT PER KOKC, ILS 17R via FILUM: the TF leg into FILUM precedes the HF, counts in the distance, survives removing the hold', async () => {
    const db = await loadNav();
    const p = (await parseRoute(db, 'KICT PER KOKC', 'garmin')).plan;
    const procs = (await db.loadProcedures!('KOKC'))!;
    const appr = procs.approaches.find((x) => x.ident === 'I17R')!;
    p.setApproach(appr, 'FILUM');
    const hf = p.legs.findIndex((l) => l.type === 'HF');
    expect(hf).toBeGreaterThan(0);
    const into = p.legs[hf - 1];
    expect(into.fix?.ident).toBe('FILUM');
    expect(into.type).toBe('TF');
    expect(into.iaf).toBe(true);
    computePlanGeometry(p, { groundSpeedKt: 250 } as Parameters<typeof computePlanGeometry>[1]);
    expect(into.geom.lengthNm).toBeGreaterThan(60); // PER -> FILUM ~71 nm
    p.deleteLeg(hf);
    expect(p.legs.some((l) => l.fix?.ident === 'FILUM' && l.type === 'TF')).toBe(true);
    expect(p.legs.some((l) => l.type === 'HF')).toBe(false);
  });
});

describe('Citation M2 fix round 1 (procedures): checklist structure and wording', () => {
  it('normal lists follow the AFM phases; emergency and abnormal lists exist and are in the G3000 list', () => {
    const titles = M2_NORMAL.map((c) => c.title);
    for (const t of ['Preflight inspection', 'Cockpit preparation', 'Before starting engines', 'Starting engines', 'Electrical check', 'Before taxi', 'Taxi', 'Before takeoff', 'Takeoff', 'After takeoff / climb', 'Cruise', 'Descent', 'Approach', 'Before landing', 'Landing', 'All engines go-around', 'After landing', 'Shutdown', 'Quick turnaround'])
      expect(titles).toContain(t);
    const em = M2_EMERGENCY.map((c) => c.title);
    for (const t of ['ENG FIRE LH or RH', 'ENGINE FAILURE OR FIRE OR MASTER WARNING DURING TAKEOFF', 'EMERGENCY RESTART - TWO ENGINES', 'CABIN ALT', 'EMERGENCY DESCENT', 'ELECTRICAL FIRE OR SMOKE', "BATT O'TEMP", 'GEN OFF L-R', 'ELECTRIC ELEVATOR TRIM RUNAWAY', 'EMERGENCY EVACUATION'])
      expect(em).toContain(t);
    expect(M2_EMERGENCY.every((c) => c.phase === 'Emergency')).toBe(true);
    expect(M2_ABNORMAL.every((c) => c.phase === 'Abnormal')).toBe(true);
    expect(M2_ABNORMAL.map((c) => c.title)).toContain('LANDING GEAR EMERGENCY EXTENSION');
    expect(M2_CHECKLISTS.length).toBe(M2_NORMAL.length + M2_EMERGENCY.length + M2_ABNORMAL.length);
    // CAS -> checklist links point at real CAS messages and real lists.
    const casIds = new Set(M2_CAS.map((m) => m.id));
    for (const [id, title] of Object.entries(M2_CAS_CHECKLIST)) {
      expect(casIds.has(id), id).toBe(true);
      expect(M2_CHECKLISTS.some((c) => c.title === title), title).toBe(true);
    }
  });

  it('wording: throttles OFF, no avionics / ignition switch, air source BOTH, ENG FIRE per the AFM order, battery-only shutdown item', () => {
    const all = M2_CHECKLISTS.flatMap((c) => c.items.map((i) => `${i.challenge} | ${i.response}`));
    expect(all.some((s) => /CUTOFF|Avionics \| ON|Ignition \| NORM|Press source/.test(s))).toBe(false);
    expect(all.some((s) => s.startsWith('Generators / battery'))).toBe(false);
    expect(item('Shutdown', 'Throttles').response).toMatch(/OFF \(after ITT stabilized/);
    const fire = list('ENG FIRE LH or RH').items.map((i) => i.response);
    expect(fire.slice(0, 5)).toEqual(['IDLE', 'LIFT COVER and PUSH', 'PUSH', 'NORM', 'OFF']);
    // Ground flaps belong to Landing; after landing is flaps UP; parking brake released in Taxi.
    expect(list('Landing').items.some((i) => i.response.startsWith('GROUND FLAPS'))).toBe(true);
    expect(list('After landing').items.some((i) => i.challenge === 'Flaps' && i.response.startsWith('0'))).toBe(true);
    expect(list('Taxi').items[0].challenge).toBe('Parking brake');
    expect(list('Before takeoff').items.some((i) => i.challenge === 'Parking brake')).toBe(false);
  });
});

describe('Citation M2 fix round 1 (procedures): live checks', () => {
  it('before landing: autopilot AND yaw damper off; landing lights ON (not PULSE); VREF and zero differential (PROC-21/22/32)', () => {
    const r = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 3000, iasKt: 140 } });
    const v = r.vars;
    r.run(1);
    expect(v.get('ap.yd_engaged')).toBe(1);
    expect(ok(r, 'Before landing', 'Autopilot and yaw damper')).toBe(false);
    v.set('ap.yd_engaged', 0);
    v.set('ap.engaged', 0);
    expect(ok(r, 'Before landing', 'Autopilot and yaw damper')).toBe(true);
    v.set(M2.landingLt, 1);
    expect(ok(r, 'Before landing', 'Landing / recog lights')).toBe(false);
    v.set(M2.landingLt, 2);
    expect(ok(r, 'Before landing', 'Landing / recog lights')).toBe(true);
    v.set('g3k.vspd.VREF.kt', 107);
    v.set('adc1.ias_kt', 140);
    expect(ok(r, 'Before landing', 'Airspeed')).toBe(false);
    v.set('adc1.ias_kt', 110);
    expect(ok(r, 'Before landing', 'Airspeed')).toBe(true);
    // 3,000 ft above the field with the cabin scheduled to the field: ~1.5 psi left, zero only near touchdown.
    expect(v.get('press.diff_psi')).toBeGreaterThan(0.5);
    expect(ok(r, 'Before landing', 'Pressurization')).toBe(false);
  });

  it('takeoff preset: every before-takeoff check passes (3-axis trim, CAS without cautions, lights ON/ALL)', () => {
    const r = makeM2({ state: 'takeoff' });
    r.run(3);
    for (const it of list('Before takeoff').items) if (it.check) expect(it.check(r.vars), it.challenge).toBe(true);
    r.vars.set(M2.rudderTrim, 0.5);
    expect(ok(r, 'Before takeoff', 'Trims')).toBe(false);
  });

  it('cold & dark -> cockpit preparation: system tests, CVR, mask test, breakers latch their items (PROC-18)', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2400 });
    const v = r.vars;
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    r.run(2);
    expect(ok(r, 'Cockpit preparation', 'System tests (GTC)')).toBe(false);
    for (const t of [TEST_SEL.fire, TEST_SEL.annu, TEST_SEL.stall, TEST_SEL.overspeed, TEST_SEL.gear]) {
      v.set(M2.testSel, t);
      r.run(1.5);
    }
    expect(ok(r, 'Cockpit preparation', 'System tests (GTC)')).toBe(false); // TAWS not yet run
    v.set(M2.testSel, TEST_SEL.taws);
    r.run(1.5);
    v.set(M2.testSel, TEST_SEL.off);
    expect(ok(r, 'Cockpit preparation', 'System tests (GTC)')).toBe(true);
    expect(ok(r, 'Cockpit preparation', 'Cockpit voice recorder')).toBe(false);
    press(r, M2.cvrTest, 1);
    expect(ok(r, 'Cockpit preparation', 'Cockpit voice recorder')).toBe(true);
    expect(ok(r, 'Cockpit preparation', 'Crew oxygen mask')).toBe(false);
    press(r, M2_SIDE_VARS.maskTest(1), 1);
    expect(ok(r, 'Cockpit preparation', 'Crew oxygen mask')).toBe(true);
    expect(ok(r, 'Cockpit preparation', 'Circuit breakers')).toBe(true);
    v.set('cb.trim_pitch', 0);
    r.run(0.1);
    expect(ok(r, 'Cockpit preparation', 'Circuit breakers')).toBe(false);
    v.set('cb.trim_pitch', 1);
    r.run(0.1);
    expect(ok(r, 'Cockpit preparation', 'Circuit breakers')).toBe(true);
    expect(ok(r, 'Cockpit preparation', 'Oxygen')).toBe(true);
    expect(ok(r, 'Cockpit preparation', 'Fuel quantity')).toBe(true);
  });

  it('before start / electrical check / before taxi: A/C OFF, generator checks, trim check, AP disconnect test, GA button (PROC-19/20)', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    expect(ok(r, 'Before starting engines', 'Air conditioning')).toBe(false); // preset leaves the A/C on (after start)
    v.set(M2.airCondSw, 0);
    expect(ok(r, 'Before starting engines', 'Air conditioning')).toBe(true);
    expect(ok(r, 'Before starting engines', 'External power')).toBe(true);
    // Electrical check (M2 flows): L GEN OFF, R GEN OFF, L GEN ON, R GEN ON.
    expect(ok(r, 'Electrical check', 'L GEN switch', 'OFF')).toBe(false);
    v.set(M2.genSw(1), 0);
    r.run(2);
    expect(ok(r, 'Electrical check', 'L GEN switch', 'OFF')).toBe(true);
    v.set(M2.genSw(2), 0);
    r.run(2);
    v.set(M2.genSw(1), 1);
    r.run(3);
    expect(ok(r, 'Electrical check', 'L GEN switch', 'GEN')).toBe(true);
    v.set(M2.genSw(2), 1);
    r.run(3);
    expect(ok(r, 'Electrical check', 'R GEN switch', 'GEN')).toBe(true);
    // Trim check: one half alone -> no trim; both halves then AP/TRIM DISC -> trim interrupted.
    expect(ok(r, 'Before taxi', 'Trims', 'CHECK')).toBe(false);
    v.set(M2.yokeTrim(1), 1);
    r.run(0.5);
    v.set(M2.yokeTrimArm(1), 1);
    r.run(0.3);
    v.set(M2.apTrimDisc(1), 1);
    r.run(0.3);
    v.set(M2.apTrimDisc(1), 0);
    v.set(M2.yokeTrim(1), 0);
    v.set(M2.yokeTrimArm(1), 0);
    r.run(0.1);
    expect(ok(r, 'Before taxi', 'Trims', 'CHECK')).toBe(true);
    // AP disconnect test on the ground.
    expect(ok(r, 'Before taxi', 'Autopilot')).toBe(false);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get('ap.engaged')).toBe(1);
    v.set(M2.apTrimDisc(1), 1);
    r.events.emit('ap.disc');
    r.run(0.3);
    v.set(M2.apTrimDisc(1), 0);
    expect(v.get('ap.engaged')).toBe(0);
    expect(ok(r, 'Before taxi', 'Autopilot')).toBe(true);
    // GA button -> FD takeoff mode.
    r.events.emit('ap.toga');
    r.run(0.5);
    expect(ok(r, 'Before taxi', 'GA button')).toBe(true);
    expect(ok(r, 'Before taxi', 'Altimeters (PFD 1, PFD 2, standby)')).toBe(true);
    // Flaps: 0 or 15 accepted for takeoff.
    v.set(M2.flapHandle, 0);
    r.run(15);
    expect(ok(r, 'Before takeoff', 'Flaps')).toBe(true);
  });

  it('shutdown: throttles OFF, A/C and fan OFF, beacon after N2 decays, cabin lights and battery OFF (PROC-25)', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(2);
    v.set(M2.parkBrake, 1);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.cutoff);
    v.set(M2.antiColl, 0);
    r.run(2);
    expect(ok(r, 'Shutdown', 'Beacon')).toBe(false); // N2 still spooling down
    r.run(90);
    expect(ok(r, 'Shutdown', 'Beacon')).toBe(true);
    expect(ok(r, 'Shutdown', 'Air conditioning & defog (cabin fan)')).toBe(false);
    v.set(M2.airCondSw, 0);
    v.set(M2.cabinFan, 0);
    expect(ok(r, 'Shutdown', 'Air conditioning & defog (cabin fan)')).toBe(true);
    expect(ok(r, 'Shutdown', 'Cabin lights')).toBe(false);
    v.set(M2.cabinLt, 0);
    expect(ok(r, 'Shutdown', 'Cabin lights')).toBe(true);
    expect(ok(r, 'Shutdown', 'Battery switch')).toBe(false);
  });

  it('emergency lists tick from the controls: ENG FIRE (IDLE, button, bottle), emergency descent, smoke removal (PROC-01)', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(3);
    r.events.emit('fail.trigger', 'fire.eng1');
    r.run(2);
    const fire = list('ENG FIRE LH or RH').items;
    expect(fire[0].check!(v)).toBe(false);
    v.set(M2.tla(1), TLA.idle);
    r.run(1);
    expect(fire[0].check!(v)).toBe(true);
    v.set(M2.engFireBtn(1), 1);
    r.run(2);
    expect(fire[1].check!(v)).toBe(true);
    expect(fire[2].check!(v)).toBe(false);
    press(r, M2.bottleBtn(1));
    r.run(3);
    expect(fire[2].check!(v)).toBe(true);
    v.set(M2.tla(1), TLA.cutoff);
    expect(fire[4].check!(v)).toBe(true);
    // Emergency descent memory items.
    const ed = list('EMERGENCY DESCENT').items;
    v.set(M2.tla(2), TLA.idle);
    expect(ed[1].check!(v)).toBe(false); // engine 1 at OFF: both throttles must be at IDLE
    v.set(M2.tla(1), TLA.idle);
    v.set(M2.speedbrake, 1);
    expect(ed[1].check!(v) && ed[2].check!(v)).toBe(true);
    // Smoke removal: PASS OXY MANUAL DROP, A/C OFF, CABIN DUMP.
    v.set(M2.paxOxy, 2);
    v.set(M2.airCondSw, 0);
    v.set(M2.cabinDump, 1);
    r.run(2);
    expect(ok(r, 'SMOKE REMOVAL', 'PASS OXY selector')).toBe(true);
    expect(ok(r, 'SMOKE REMOVAL', 'Normal DC power: CABIN DUMP')).toBe(true);
    expect(ok(r, 'SMOKE REMOVAL', 'Passenger oxygen')).toBe(true);
    v.set(M2.pressSource, PRESS_SRC.emer);
    expect(ok(r, 'CABIN ALT', 'If not arrested by 15,000 ft cabin: AIR SOURCE SELECT')).toBe(true);
  });

  it('CAS-linked checklists: an active linked message pre-selects its list on the GTC Checklist screen (PROC-01)', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    r.run(10); // past the anti-skid self test (its ANTISKID INOP caution is itself a linked message)
    const system = r.sys.suite.system;
    const cl = system.checklists;
    expect(cl.current?.title).not.toBe('CABIN ALT');
    expect(system.selectCasLinkedChecklist()).toBe(false); // no linked warning / caution active
    system.cas.set('cabin_alt', 'CABIN ALTITUDE', 'warning', true);
    expect(system.selectCasLinkedChecklist()).toBe(true);
    expect(cl.current?.title).toBe('CABIN ALT');
    // A completed list is not re-selected.
    for (let i = 0; i < cl.current!.items.length; i++) if (!cl.isChecked(i)) cl.toggle(i);
    cl.select(0);
    expect(system.selectCasLinkedChecklist()).toBe(false);
    expect(cl.selectByTitle('EMERGENCY DESCENT')).toBe(true);
    expect(cl.current?.title).toBe('EMERGENCY DESCENT');
  });
});
