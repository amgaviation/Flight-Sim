/**
 * Global 6000 procedures-lens fix round (P01 .. P14) regression tests: these
 * assert the FIXED behaviour and would fail on the pre-fix build.
 *  - P01: TAXI checklist (brake / flight-control / instrument checks) passes
 *    from the ready_to_taxi preset and senses a hydraulics loss.
 *  - P02: CLIMB / CRUISE checklists exist with altimeter-STD and fuel checks.
 *  - P03: L/R ENG FLAMEOUT checklist is CAS-linked; the air-start envelope in
 *    systems/engines.ts denies the starter above the EST 21,000 ft ceiling
 *    and allows a starter-assisted relight below it.
 *  - P04: FUEL IMBALANCE / GEAR DISAGREE (manual extension) checklists work
 *    against the systems; the new CAS ids map to existing checklists.
 *  - P09: CABIN ALT pax-oxygen threshold matches the 14,500 ft mask deploy.
 */
import { describe, expect, it } from 'vitest';
import { G6K_CAS_CHECKLISTS, G6K_CHECKLISTS } from '../../../../src/aircraft/global6000/checklists';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, LB } from '../../../../src/aircraft/global6000/data';
import { makeRig, posted } from '../helpers';

const list = (title: string) => G6K_CHECKLISTS.find((c) => c.title === title)!;
const failing = (r: ReturnType<typeof makeRig>, title: string) =>
  list(title).items.filter((i) => i.check && !i.check(r.vars)).map((i) => i.challenge);

describe('Global 6000 fix round 4 (procedures lens)', () => {
  it('P01/P02/P13/P14: TAXI, CLIMB, CRUISE, SECURING and EXTERIOR INSPECTION checklists exist in phase order', () => {
    const titles = G6K_CHECKLISTS.map((c) => c.title);
    for (const t of ['EXTERIOR INSPECTION', 'TAXI', 'CLIMB', 'CRUISE', 'SECURING']) expect(titles).toContain(t);
    expect(titles.indexOf('TAXI')).toBeGreaterThan(titles.indexOf('AFTER START'));
    expect(titles.indexOf('TAXI')).toBeLessThan(titles.indexOf('BEFORE TAKEOFF'));
    expect(titles.indexOf('CLIMB')).toBeGreaterThan(titles.indexOf('AFTER TAKEOFF'));
    expect(titles.indexOf('CRUISE')).toBeGreaterThan(titles.indexOf('CLIMB'));
    expect(titles.indexOf('CRUISE')).toBeLessThan(titles.indexOf('DESCENT'));
    expect(titles.indexOf('SECURING')).toBeGreaterThan(titles.indexOf('SHUTDOWN'));
  });

  it('P01: TAXI checklist auto-checks pass in ready_to_taxi and sense a flight-control hydraulics loss', () => {
    const r = makeRig('ready_to_taxi');
    r.run(3);
    expect(failing(r, 'TAXI')).toEqual([]);
    // Free-and-correct senses the surfaces following the wheel.
    r.vars.set('input.roll', 0.8);
    r.run(1.5);
    expect(failing(r, 'TAXI')).toEqual([]);
    r.vars.set('input.roll', 0);
    // All three hydraulic systems down: the flight-control check fails.
    for (const n of ['sys1', 'sys2', 'sys3']) r.sys.hyd.setPressure(n, 0);
    r.run(0.5);
    expect(failing(r, 'TAXI')).toContain('Flight controls');
  });

  it('P02: CLIMB / CRUISE checks pass at FL410 STD and flag a QNH altimeter or a fuel imbalance', () => {
    const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
    r.run(2);
    expect(failing(r, 'CLIMB')).toEqual([]);
    expect(failing(r, 'CRUISE')).toEqual([]);
    r.vars.set('adc1.baro_std', 0); // altimeter back to QNH at FL410: STD check fails
    expect(failing(r, 'CLIMB')).toContain('Altimeters');
    r.vars.set('adc1.baro_std', 1);
    r.vars.set('fuel.tank2_kg', r.vars.get('fuel.tank0_kg') - 500 * LB); // 500 lb imbalance
    expect(failing(r, 'CRUISE')).toContain('Fuel balance');
  });

  it('P03/P04: every CAS-linked checklist id resolves to a checklist', () => {
    const titles = new Set(G6K_CHECKLISTS.map((c) => c.title));
    for (const [id, title] of Object.entries(G6K_CAS_CHECKLISTS)) {
      expect(titles.has(title), `${id} -> ${title}`).toBe(true);
    }
    for (const id of ['l_eng_flameout', 'fuel_imbalance', 'ac_bus1_fail', 'dc_bus1_fail', 'gear_disagree', 'flap_fail', 'slat_fail']) {
      expect(G6K_CAS_CHECKLISTS[id], id).toBeTruthy();
    }
  });

  it('P03: air-start envelope - no starter assist at FL410 (windmill only), starter-assisted relight below 21,000 ft', { timeout: 300_000 }, () => {
    const r = makeRig('cruise', { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('eng1.flameout');
    r.run(15);
    expect(v.get('eng1.running')).toBe(0);
    expect(posted(r)).toContain('caution:L ENG FLAMEOUT');
    // The flameout checklist: A/T off (it would drive the lever back up), thrust lever idle.
    r.events.emit('at.disc');
    r.run(0.5);
    v.set(V.tla(1), 0);
    r.run(1);
    // Crew restart attempt at FL410: ENG RUN cycled OFF -> ON. The failure still blocks combustion; the point of
    // this phase is the starter gate: above the EST 21,000 ft air-start ceiling the ATS must not engage.
    v.set(V.engRun(1), 0);
    r.run(3);
    v.set(V.engRun(1), 1);
    let starterAtAlt = 0;
    r.run(10, () => {
      starterAtAlt = Math.max(starterAtAlt, v.get('fadec.eng1.starter_cmd'));
    });
    expect(starterAtAlt).toBe(0);
    // Descend into the envelope, clear the failure and cycle ENG RUN again: starter-assisted relight.
    r.sys.failures.clear('eng1.flameout');
    r.fdm.reposition({ lat: 45.4706, lon: -73.7408, altFtMsl: 15000, iasKt: 250, headingTrue: 42 });
    r.run(3);
    v.set(V.engRun(1), 0);
    r.run(3);
    v.set(V.engRun(1), 1);
    let starterLow = 0;
    const t = r.run(120, () => {
      starterLow = Math.max(starterLow, v.get('fadec.eng1.starter_cmd'));
      return v.get('eng1.running') === 1;
    });
    expect(v.get('eng1.running')).toBe(1);
    expect(t).toBeLessThan(120);
    expect(v.get(`eng1.itt_c`)).toBeLessThan(G6K_LIMITS.ittStartAirC); // TCDS 3.2 air-start ITT limit respected
    // Below the ceiling the ATS may assist (it engages unless the windmill N2 is already past the cut-out).
    console.log('[r4] starter at FL410:', starterAtAlt, 'at 15,000 ft:', starterLow, 'relight in', t.toFixed(0), 's');
    r.run(2);
    expect(failing(r, 'L ENG FLAMEOUT')).toEqual([]);
  });

  it('P04: FUEL IMBALANCE checklist auto-checks track the wing transfer toward the light wing', () => {
    const r = makeRig('cruise', { air: { altFtMsl: 30000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    // Build a 1,500 lb imbalance (left heavy) - FUEL IMBALANCE posts above 1,100 lb in flight (GXFU).
    r.sys.fuel.setTankKg('r_main', r.sys.fuel.tankKg('l_main') - 1500 * LB);
    r.run(12);
    expect(posted(r)).toContain('caution:FUEL IMBALANCE');
    // Wrong direction fails the check; toward the light (right) wing passes.
    v.set(V.wingXfer, 3); // R -> L: wrong
    expect(failing(r, 'FUEL IMBALANCE')).toContain('WING XFER');
    v.set(V.wingXfer, 2); // L -> R: toward the light wing
    expect(failing(r, 'FUEL IMBALANCE')).toEqual([]);
    v.set(V.wingXfer, 1);
  });

  it('P04: GEAR DISAGREE checklist - manual release extends the gear with the normal actuation failed', { timeout: 300_000 }, () => {
    const r = makeRig('cruise', { air: { altFtMsl: 8000, iasKt: 180 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('gear.actuation');
    v.set(V.gearHandle, 1);
    r.run(G6K_LIMITS.gearDisagreeS + 8);
    expect(posted(r)).toContain('caution:GEAR DISAGREE');
    expect(v.get('gear.down_locked')).toBe(0);
    expect(failing(r, 'GEAR DISAGREE')).toContain('Manual release handle');
    v.set(V.gearManRelease, 1);
    const t = r.run(60, () => v.get('gear.down_locked') === 1);
    expect(v.get('gear.down_locked')).toBe(1);
    console.log('[r4] free-fall extension in', t.toFixed(0), 's');
    expect(failing(r, 'GEAR DISAGREE')).toEqual([]);
  });

  it('P09: pax-oxygen thresholds agree - checklist check and mask deploy both at 14,500 ft (GX PTG 8-4)', () => {
    const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    const cabin = list('CABIN ALT');
    const pax = cabin.items.find((i) => i.challenge === 'PASSENGER OXYGEN')!;
    v.set('press.cabin_alt_ft', 14200); // between the old 14,000 ft check and the sourced 14,500 ft deploy
    expect(pax.check!(v)).toBe(true); // below the deploy altitude: no override required yet
    v.set('press.cabin_alt_ft', 14600);
    expect(pax.check!(v)).toBe(false); // above it, with masks not yet out: override required
    v.set(V.paxOxy, 2);
    expect(pax.check!(v)).toBe(true);
  });
});
