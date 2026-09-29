/**
 * Fix round 3 (LENS procedures, gaps LON-P3-01..19): autothrottle taxi guard,
 * cockpit-preparation AP ground check, OG 17 checklist completeness, preset
 * APU/SPD-FMS/TOLD/LDG ELEV state, and the takeoff liftoff speed. Each test
 * fails without its fix (except the LON-P3-02 regression, which documents that
 * the cold-power-up AP engagement works once the CONTROL LOCK is released).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD } from './helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { LONGITUDE_CHECKLISTS } from '../../../src/aircraft/citation-longitude/checklists';
import { takeoffSpeeds, vref } from '../../../src/aircraft/citation-longitude/performance';
import { FDM } from '../../../src/core/vars';

const list = (title: string) => {
  const l = LONGITUDE_CHECKLISTS.find((c) => c.title === title);
  expect(l, `checklist "${title}"`).toBeTruthy();
  return l!;
};
const challenges = (title: string) => list(title).items.map((i) => i.challenge);

describe('LON-P3-01: autothrottle is not engageable during taxi (OG Section 1 limitation)', () => {
  it('at.engage during taxi goes to HOLD (servo off): levers untouched, no spool-up', { timeout: 200000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(3);
    v.set(V.parkBrake, 0);
    const tla0 = v.get(V.tla(1));
    r.events.emit('at.engage');
    r.run(4);
    // OG 7-5: HOLD on the ground (servo off); before the fix this engaged SPD (sel 200 kt) and drove the
    // levers (probe: TLA 0.48, N1 47 % and rising after 4 s).
    expect(v.getString('ap.at_mode')).toBe('HOLD');
    expect(v.get('at.servo_active')).toBe(0);
    expect(v.get(V.tla(1))).toBeCloseTo(tla0, 5);
    expect(v.get('eng1.n1_pct')).toBeLessThan(30); // still at ground idle
  });

  it('TO/GA on the runway engages the A/T into TO (with or without a prior AT-button press)', { timeout: 200000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    r.events.emit('ap.toga'); // TO/GA alone engages the A/T on the ground (AW&ST 2019 pilot report)
    r.run(1);
    expect(v.get('ap.at_engaged')).toBe(1);
    expect(v.getString('ap.at_mode')).toBe('TO');
    // and the servo now drives the levers toward the takeoff rating
    r.run(5);
    expect(v.get(V.tla(1))).toBeGreaterThan(0.3);
  });
});

describe('LON-P3-02: OG 17-3 item 13 AP engage/disengage ground check after a cold power-up', () => {
  it('engages once the CONTROL LOCK (Cockpit Inspection item 1) is released', { timeout: 300000 }, () => {
    const r = makeRig('cold_dark', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.extPwrAvail, 1);
    r.run(1);
    v.set(V.extPwr, 1);
    r.run(90, () => v.get('ahrs1.valid') === 1 && v.get('adc1.valid') === 1);
    r.run(5);
    v.set(V.controlLock, 0); // Cockpit Inspection item 1: CONTROL LOCK - UNLOCK
    r.run(0.5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get('ap.engaged')).toBe(1);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    expect(v.get('ap.engaged')).toBe(0);
  });
});

describe('checklist completeness (OG 17)', () => {
  it('LON-P3-03: Cockpit Preparation has EIS/CAS, ATIS/Clearance and Autopilot (First Flight of Day)', () => {
    const c = challenges('Cockpit Preparation');
    expect(c[1]).toBe('EIS / CAS');
    expect(c).toContain('ATIS / Clearance');
    expect(c[c.length - 1]).toBe('Autopilot (First Flight of Day)');
    // ATIS/Clearance sits after Engine dry motor (OG item 6)
    expect(c.indexOf('ATIS / Clearance')).toBe(c.indexOf('Engine dry motor') + 1);
  });

  it('LON-P3-04: Before Takeoff has the CLEARED FOR TAKEOFF group with Flight Controls - Free', () => {
    const c = challenges('Before Takeoff');
    const div = c.findIndex((x) => x.includes('CLEARED FOR TAKEOFF'));
    expect(div).toBeGreaterThan(0);
    expect(c[div + 1]).toBe('Flight controls');
    expect(c[div + 2]).toContain('ICE PROTECTION');
    expect(c[div + 3]).toContain('Exterior lights');
    expect(c[div + 4]).toContain('EIS / CAS');
    // the Flight Controls check is the control lock released
    const item = list('Before Takeoff').items[div + 1];
    expect(item.check!({ get: (n: string) => (n === V.controlLock ? 0 : 0) } as never)).toBe(true);
    expect(item.check!({ get: (n: string) => (n === V.controlLock ? 1 : 0) } as never)).toBe(false);
  });

  it('LON-P3-05: Quick Turn checklist per OG 17-10', () => {
    const c = challenges('Quick Turn');
    expect(c[0]).toBe('Throttles');
    expect(c[1]).toContain('EMER/PARK BRAKE');
    expect(c[2]).toContain('ENGINE ICE PROTECTION');
    expect(c[3]).toContain('RUN/STOP');
    expect(list('Quick Turn').phase).toBe('Ground');
  });

  it('LON-P3-06: Starting Engines (Using Cross-Bleed) per OG 17-12', { timeout: 200000 }, () => {
    const l = list('Starting Engines (Using Cross-Bleed)');
    expect(l.items[0].response).toContain('25 % N1');
    const psiItem = l.items.find((i) => i.challenge === 'START pressure')!;
    // the >= 32 psi check reads pneu.start_psi
    expect(psiItem.check!({ get: (n: string) => (n === V.startPsi ? 40.3 : 0) } as never)).toBe(true);
    expect(psiItem.check!({ get: (n: string) => (n === V.startPsi ? 26.8 : 0) } as never)).toBe(false);
  });

  it('LON-P3-07: a left-first engine start passes the Starting Engines auto-checks', { timeout: 400000 }, () => {
    const r = makeRig('cold_dark', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(2);
    v.set(V.apuKnob, 1);
    r.run(12); // APU inlet door opens in ~10 s before a start is accepted
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    r.run(120, () => v.get('apu.avail') === 1 && v.get(V.startPsi) >= 32);
    const l = list('Starting Engines (Using APU)');
    expect(l.items[1].challenge).toContain('either engine');
    // start LEFT first (valid per OG 17-4 "either engine")
    v.set(V.runL, 1);
    r.run(1);
    v.set(V.startL, 1);
    r.run(0.3);
    v.set(V.startL, 0);
    r.run(90, () => v.get('eng1.running') === 1);
    expect(v.get('eng1.running')).toBe(1);
    expect(l.items[1].check!(v)).toBe(true); // RUN/STOP (either engine)
    expect(l.items[4].check!(v)).toBe(true); // engine instruments: first engine runs
    expect(l.items[5].check!(v)).toBe(false); // opposite engine still to go
    v.set(V.runR, 1);
    r.run(1);
    v.set(V.startR, 1);
    r.run(0.3);
    v.set(V.startR, 0);
    r.run(90, () => v.get('eng2.running') === 1);
    expect(l.items[5].check!(v)).toBe(true);
  });

  it('LON-P3-14/-15/-16/-17/-18: minor wording and structure deltas', () => {
    // 17-11 item 4: release at 19 % N2 (not the 7-6 narrative's 20 %)
    expect(list('Engine Dry Motor').items[3].response).toContain('19 % N2');
    // 17-2 item 6 sub-steps a-e
    const ci = challenges('Cockpit Inspection');
    expect(ci).toContain('a. EXT PWR button (if AVAIL illuminated)');
    expect(ci).toContain('c. (and/or) APU knob');
    // rolling takeoff variant
    expect(list('Takeoff (Rolling)').items[1].challenge).toContain('within 500 ft');
    expect(list('Takeoff (Static)').items[0].response).toBe('TO');
    // go-around ends with Throttles - As required (OG 17-8 item 9)
    const ga = list('Go-Around').items;
    expect(ga[ga.length - 1].challenge).toBe('Throttles');
    // RVSM crosscheck interval; EST tags on the Before Taxi operator items
    expect(list('Cruise').items[2].response).toContain('1 hour intervals');
    const bt = challenges('Before Taxi');
    expect(bt).toContain('AUTO GROUND SPOILERS button (EST)');
    expect(bt).toContain('POWER RESERVE (EST)');
  });

  it('LON-P3-08: engine fire / failure / dual generator / hydraulic / smoke checklists exist', () => {
    const fire = list('ENGINE FIRE L or R');
    expect(fire.phase).toBe('Emergency');
    expect(fire.items[0].challenge).toContain('ENG FIRE switchlight');
    expect(fire.items[1].challenge).toContain('BOTTLE 1');
    expect(fire.items[3].challenge).toContain('RUN/STOP');
    const fail = list('ENGINE FAILURE / SHUTDOWN IN FLIGHT');
    expect(fail.items.map((i) => i.challenge).join()).toContain('AIR START');
    expect(list('DUAL GENERATOR FAILURE').items.map((i) => i.response).join()).toContain('HYD GEN');
    list('HYD SYSTEM A or B FAILURE');
    const smoke = list('SMOKE / FUMES');
    expect(smoke.items[0].challenge).toBe('Oxygen masks');
  });

  it('LON-P3-08: the engine-fire flow satisfies the checklist checks and clears ENGINE FAIL with RUN/STOP', { timeout: 300000 }, () => {
    const r = makeRig('cruise', { avionics: false, weightLb: 34000, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('fire.eng1');
    r.run(3);
    const fire = list('ENGINE FIRE L or R');
    v.set(V.fireEngL, 1); // ENG FIRE switchlight - push
    r.run(2);
    expect(fire.items[0].check!(v)).toBe(true);
    v.set(V.bottle1, 1);
    r.run(0.3);
    v.set(V.bottle1, 0);
    r.run(10);
    // fuel cut by the fire switch with RUN still selected: the red ENGINE FAIL posts until RUN/STOP goes to STOP
    const failPosted = r.sys.cas.list.some((e) => e.active && e.text.includes('ENGINE FAIL'));
    expect(failPosted).toBe(true);
    v.set(V.runL, 0);
    r.run(3);
    expect(fire.items[3].check!(v)).toBe(true);
    expect(r.sys.cas.list.some((e) => e.active && e.text.includes('ENGINE FAIL'))).toBe(false);
  });
});

describe('initial-state presets (OG 17 flow)', () => {
  it('LON-P3-09: APU runs in ready_to_taxi and takeoff, off in cruise/approach', { timeout: 300000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
    r.run(2);
    expect(r.vars.get('apu.avail')).toBe(1);
    // the aircraft's own Cockpit Preparation "APU knob - ON/START" auto-check passes in its preset
    const item = list('Cockpit Preparation').items.find((i) => i.challenge === 'APU knob')!;
    expect(item.check!(r.vars)).toBe(true);
    const t = makeRig('takeoff', { avionics: false, weightLb: 34000 });
    t.run(2);
    expect(t.vars.get('apu.avail')).toBe(1);
    const c = makeRig('cruise', { avionics: false, weightLb: 34000, air: { altFtMsl: 40000, iasKt: 240 } });
    c.run(2);
    expect(c.vars.get('apu.avail')).toBe(0);
  });

  it('LON-P3-10: takeoff and cruise presets select SPD knob FMS', { timeout: 200000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    r.run(1);
    expect(r.vars.get('g3k.spd_fms')).toBe(1);
  });

  it('LON-P3-11: preset TOLD computed for the actual weight (not the 125/130/138 defaults)', { timeout: 300000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(1);
    expect(v.get('g3k.told.to_valid')).toBe(1);
    const exp = takeoffSpeeds(34000, '2');
    expect(Math.abs(v.get('g3k.vspd.VR.kt') - exp.vr)).toBeLessThanOrEqual(2);
    expect(Math.abs(v.get('g3k.vspd.V1.kt') - exp.v1)).toBeLessThanOrEqual(2);
    expect(Math.abs(v.get('g3k.vspd.V2.kt') - exp.v2)).toBeLessThanOrEqual(2);
    expect(v.get('g3k.vspd.VR.kt')).toBeLessThan(125); // clearly off the static defaults
    expect(v.get('g3k.vspd.VR.on')).toBe(1);
  });

  it('LON-P3-11/-19: approach preset computes landing TOLD and sets LDG ELEV to the field', { timeout: 300000 }, () => {
    const r = makeRig('approach', { avionics: true, weightLb: 30000, air: { altFtMsl: FIELD.elevFt + 1800, iasKt: 140 } });
    const v = r.vars;
    r.run(1);
    expect(v.get('g3k.told.ldg_valid')).toBe(1);
    expect(Math.abs(v.get('g3k.vspd.VREF.kt') - vref(30000))).toBeLessThanOrEqual(2);
    expect(v.get('g3k.vspd.VREF.kt')).toBeLessThan(120); // FPG ~108 at 30,000 lb, not the 122 default
    // LDG ELEV selector points at the reposition field, not the FMS default -9999
    expect(Math.abs(v.get(V.pressLdgElevFt) - FIELD.elevFt)).toBeLessThan(30);
  });

  it('LON-P3-19: ground presets set the LDG ELEV selector to the field elevation', { timeout: 200000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
    expect(Math.abs(r.vars.get(V.pressLdgElevFt) - FIELD.elevFt)).toBeLessThan(30);
  });
});

describe('LON-P3-12: liftoff speed with the OG rotation technique', () => {
  it('a 4.5 deg/s rotation at VR (BCA technique) lifts off below V2', { timeout: 400000 }, () => {
    const r = makeRig('takeoff', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    const s = takeoffSpeeds(34000, '2'); // VR 114, V2 128 (FPG p.4 interpolation)
    r.run(1);
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: FIELD.courseTrue, lat: FIELD.lat, lon: FIELD.lon, pitchDeg: 10, rotateRateDegS: 4.5, gearUp: false });
    let lift = NaN;
    r.run(90, () => {
      if (isNaN(lift) && v.get('gear.air_ground') === 0) {
        lift = v.get(FDM.ias);
        return true;
      }
    });
    expect(lift).toBeGreaterThan(s.vr);
    expect(lift).toBeLessThan(s.v2); // was above V2 (VR+15 at 3 deg/s) before the ground-effect retune
  });
});
