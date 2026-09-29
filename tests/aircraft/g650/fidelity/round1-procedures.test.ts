/**
 * Fix round 1 (procedures lens): regression tests for the audited gaps
 * (gap ids P01..P22 in the comments; sources: code450 G650 checklists, LUC
 * system notes, LIM, dossier). Each test fails against the pre-fix behaviour
 * recorded in the audit probes.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted, press } from '../helpers';
import { G650_CHECKLISTS } from '../../../../src/aircraft/g650/checklists';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';

const list = (title: string) => {
  const l = G650_CHECKLISTS.find((c) => c.title === title);
  expect(l, `checklist "${title}"`).toBeDefined();
  return l!;
};
const item = (title: string, challenge: string) => {
  const l = list(title);
  const i = l.items.find((x) => x.challenge.includes(challenge));
  expect(i, `"${title}" item "${challenge}"`).toBeDefined();
  return i!;
};
/** Fake vars for direct item-check evaluation. */
const fake = (map: Record<string, number>) => ({ get: (n: string, d = 0) => map[n] ?? d });

describe('G650 fix round 1 (procedures): checklist structure', () => {
  it('P01: fuel boost pumps come BEFORE the APU item, and a discrete APU Start list exists (code450)', () => {
    const bse = list('Before Starting Engines');
    const pumps = bse.items.findIndex((x) => x.challenge.startsWith('FUEL pumps'));
    const apu = bse.items.findIndex((x) => x.challenge === 'APU');
    expect(pumps).toBeGreaterThanOrEqual(0);
    expect(apu).toBeGreaterThan(pumps);
    // APU Start Checklist: "L MAIN Boost Pump - ON" immediately before "APU Master Switch - ON".
    const a = list('APU Start');
    const boost = a.items.findIndex((x) => x.challenge.includes('L MAIN Boost Pump'));
    const master = a.items.findIndex((x) => x.challenge.includes('APU MASTER'));
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(master).toBe(boost + 1);
  });

  it('P02/P04: Shutdown covers the published item set and Securing / phase lists exist', () => {
    const s = list('Shutdown');
    expect(s.items.length).toBeGreaterThanOrEqual(18);
    for (const c of ['Transponder', 'PWR XFR Unit', 'AUX PUMP', 'SEAT BELT', 'OXYGEN', 'NWS POWER', 'CABIN / GALLEY', 'BLEED AIR', 'FUEL pumps', 'FLT CTRL BATTERIES', 'MAIN BATTERIES']) {
      expect(s.items.some((x) => x.challenge.includes(c)), c).toBe(true);
    }
    for (const t of ['Cockpit Preparation', 'Taxi', 'Line Up', 'Cruise', 'Securing']) list(t);
    // Taxi: brakes / flight-controls / reverser checks (P04).
    for (const c of ['Brakes', 'Flight controls', 'Thrust reversers']) expect(list('Taxi').items.some((x) => x.challenge.includes(c)), c).toBe(true);
  });

  it('P06/P08: fire-test and cockpit-set-up items in Before Starting Engines', () => {
    for (const c of ['FAULT TEST', 'L ENG Fire Test', 'R ENG Fire Test', 'Gear handle', 'fire handles', 'Power levers', 'Speed brake', 'Aileron / rudder trim', 'SEAT BELT / NO SMOKE', 'NWS POWER', 'Altimeters', 'V-speeds', 'Takeoff briefing']) {
      expect(list('Before Starting Engines').items.some((x) => x.challenge.includes(c)), c).toBe(true);
    }
    item('APU Start', 'APU Fire Test');
  });

  it('P09/P15/P10: PTU check on the R-first start; engine-fire pacing; CAS-selectable abnormal lists', () => {
    const se = list('Starting Engines');
    const rEng = se.items.findIndex((x) => x.challenge === 'R engine');
    const ptu = se.items.findIndex((x) => x.challenge.includes('PTU'));
    expect(ptu).toBe(rEng + 1); // code450: PTU Pressure - CHECK 3000 (+300/-400) PSI after the R start
    for (const c of ['Affected engine', 'If the warning persists after 10 s']) {
      expect(list('L Engine Fire').items.some((x) => x.challenge.includes(c)), c).toBe(true);
    }
    for (const t of ['L Autostart Abort', 'R Autostart Abort', 'L Engine Fail', 'R Engine Fail', 'L-R Generator Fail', 'FCC Alternate Mode', 'FCC Direct Mode', 'Emergency Descent', 'Fuel Level Low', 'Fuel Imbalance']) list(t);
  });

  it('P16/P17/P18/P19/P21: item thresholds and phase items', () => {
    // P16: bleed-for-start check at the LIM 40 psi minimum, not 35.
    const bleed = item('Starting Engines', 'Bleed pressure');
    expect(bleed.check!(fake({ 'pneu.l_duct_psi': 37, 'pneu.r_duct_psi': 37 }) as never)).toBe(false);
    expect(bleed.check!(fake({ 'pneu.l_duct_psi': 41 }) as never)).toBe(true);
    // P17: the IRS-aligned check requires all three IRUs.
    const irs = item('Taxi', 'IRS');
    expect(irs.check!(fake({ 'ahrs1.valid': 1, 'ahrs2.valid': 1, 'ahrs3.valid': 0 }) as never)).toBe(false);
    expect(irs.check!(fake({ 'ahrs1.valid': 1, 'ahrs2.valid': 1, 'ahrs3.valid': 1 }) as never)).toBe(true);
    // P18: climb / descent altimeter and seat-belt items.
    item('After Takeoff / Climb', 'Altimeters');
    item('Descent / Approach', 'Altimeters');
    item('Descent / Approach', 'Seat belts');
    // P19: after-landing transponder / anti-ice items.
    item('After Landing', 'Transponder');
    item('After Landing', 'Anti-ice');
    // P21: the APU restart in the generator-fail lists carries the FL370 limit and its check is gated.
    const gen = item('L Generator Fail', 'APU');
    expect(gen.challenge).toContain('FL370');
    expect(gen.check!(fake({ 'elec.apu_gen_online': 0, 'adc1.press_alt_ft': 41000 }) as never)).toBe(true); // above the envelope: not expected
    expect(gen.check!(fake({ 'elec.apu_gen_online': 0, 'adc1.press_alt_ft': 30000 }) as never)).toBe(false);
    expect(gen.check!(fake({ 'elec.apu_gen_online': 1, 'adc1.press_alt_ft': 30000 }) as never)).toBe(true);
  });

  it('P07: the Cabin Pressure Low mask item requires 100 % / EMERGENCY, not N', () => {
    const m = item('Cabin Pressure Low', 'Crew oxygen masks');
    const base = { [V.oxyMaskL]: 1, [V.oxyMaskR]: 1, [V.oxyMaskModeL]: 0, [V.oxyMaskModeR]: 0 };
    expect(m.check!(fake(base) as never)).toBe(false); // masks on but regulators at N (the audited pass-through)
    expect(m.check!(fake({ ...base, [V.oxyMaskModeL]: 1, [V.oxyMaskModeR]: 1 }) as never)).toBe(true);
  });
});

describe('G650 fix round 1 (procedures): system behaviour', () => {
  it('P01: a failed no-fuel APU start is recoverable with a MASTER cycle (RE220 retry)', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(2);
    // Boost pumps OFF: the start cranks with no light-off and the ECU faults it at the timeout.
    for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 0);
    v.set(V.apuMaster, 1);
    r.run(15);
    press(r, V.apuStart, 1);
    r.run(120, () => v.get('apu.fault') !== 0);
    expect(v.get('apu.fault')).toBe(1);
    expect(v.get('apu.running')).toBe(0);
    // Retry per the published flow: L MAIN boost pump ON, MASTER cycle (still spooling down), START.
    v.set(V.boostL, 1);
    v.set(V.apuMaster, 0);
    r.run(3);
    v.set(V.apuMaster, 1); // pre-fix: the fault stayed latched (cleared only with the APU fully at rest)
    r.run(40);
    press(r, V.apuStart, 1);
    r.run(90, () => v.get('apu.avail') !== 0);
    expect(v.get('apu.avail')).toBe(1);
  });

  it('P02/P03: the expanded Shutdown leaves nothing discharging, and the FCS batteries never back-feed ESS DC', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // Fly the Shutdown checklist (published order, code450).
    v.set('xpdr.mode', 1);
    v.set(V.ptu, 0);
    v.set(V.auxPump, 0);
    v.set(V.seatBelt, 0);
    v.set(V.noSmoke, 0);
    v.set(V.fuelCtlL, 0);
    v.set(V.fuelCtlR, 0);
    r.run(40);
    v.set(V.crewOxy, 0);
    v.set(V.paxOxy, 0);
    v.set(V.paxShutoff, 0);
    v.set(V.nwsPower, 0);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
    v.set(V.cabinMaster, 0);
    v.set(V.galleyMaster, 0);
    v.set(V.emerPwr, 0);
    for (const k of [V.bleedL, V.bleedR, V.bleedApu, V.apuMaster]) v.set(k, 0);
    for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 0);
    for (const n of [1, 2, 3, 4] as const) v.set(V.probe(n), 0);
    for (const k of [V.ltBeacon, V.ltStrobe, V.ltLdgL, V.ltLdgR, V.ltTaxi]) v.set(k, 0);
    for (const k of [V.wshldL, V.wshldR, V.cabinWdo, V.evsWdo]) v.set(k, 0);
    v.set(V.ebhaBatt, 0);
    v.set(V.upsBatt, 0);
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(5);
    // Every sensed Shutdown item reads complete.
    for (const i of list('Shutdown').items) if (i.check) expect(i.check(v), i.challenge).toBe(true);
    // P02: the FCS batteries are off line, not discharging (-146.8 A / -42.4 A in the audit probe).
    expect(v.get('elec.ebha_batt_amps')).toBeGreaterThan(-1);
    expect(v.get('elec.ups_batt_amps')).toBeGreaterThan(-1);
    // P03: nothing back-feeds the ESS DC buses.
    expect(v.get('elec.l_ess_dc_v')).toBeLessThan(1);
    expect(v.get('elec.r_ess_dc_v')).toBeLessThan(1);
    expect(v.get('elec.du1_powered')).toBe(0);
  });

  it('P03: with only the FLT CTRL BATTERIES on, the EBHA/UPS batteries carry only their own buses (LUC)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    v.set(V.fuelCtlL, 0);
    v.set(V.fuelCtlR, 0);
    r.run(30);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
    v.set(V.emerPwr, 0);
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(5);
    // Pre-fix: L ESS DC read 25.6 V with DU1 and MCDU1 alive and the EBHA battery at -70.8 A.
    expect(v.get('elec.l_ess_dc_v')).toBeLessThan(1);
    expect(v.get('elec.r_ess_dc_v')).toBeLessThan(1);
    expect(v.get('elec.du1_powered')).toBe(0);
    expect(v.get('elec.mcdu1_powered')).toBe(0);
    // The FCS buses themselves stay alive on their batteries (FCC 1A / 2B / BFCU, EBHA MCEs).
    expect(v.get('elec.fcc1a_powered')).toBe(1);
    expect(v.get('elec.bfcu_powered')).toBe(1);
    expect(v.get('elec.ebha_mce_powered')).toBe(1);
    expect(v.get('elec.ebha_batt_amps')).toBeGreaterThan(-25); // MCE standby load only, not the whole ESS system
    expect(v.get('elec.ebha_batt_amps')).toBeLessThan(-0.5); // and it IS discharging into its own bus
  });

  it('P06: the fire tests latch their TESTED auto-checks', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    const bse = list('Before Starting Engines');
    const tests = bse.items.filter((x) => x.response === 'TESTED');
    for (const t of tests) expect(t.check!(v), t.challenge).toBe(false);
    press(r, V.fireFaultTest, 1);
    press(r, V.fireTestLA, 1);
    press(r, V.fireTestRB, 1);
    r.run(1);
    for (const t of tests) expect(t.check!(v), t.challenge).toBe(true);
    const apuT = item('APU Start', 'APU Fire Test');
    expect(apuT.check!(v)).toBe(false);
    press(r, V.apuFireTest, 1);
    r.run(1);
    expect(apuT.check!(v)).toBe(true);
  });

  it('P09: AUX PUMP ARM does not latch on the parking brake alone (pedal press required, LUC)', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.auxPump, 1); // ARM
    r.run(10);
    expect(v.get('brakes.parking_set')).toBe(1);
    expect(v.get('hyd.aux_on')).toBe(0); // pre-fix: the pump ran and held the L system at ~2,888 psi
    // A brake pedal press with low pressure latches it.
    v.set('input.brake_left', 0.5);
    r.run(3);
    expect(v.get('hyd.aux_on')).toBe(1);
  });

  it('P11: no FCC Alternate / Stall Protection cautions on the ground while the IRS is aligning', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // Realign all three IRUs with the engines running on the ground (the power-up alignment case).
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
    r.run(2);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    r.run(10);
    expect(v.get('ahrs1.aligning')).toBe(1);
    expect(v.get('fbw.mode_code')).not.toBe(0); // the FBW is genuinely degraded without inertial data
    const p = posted(r);
    expect(p).not.toContain('caution:FCC Alternate Mode'); // pre-fix: posted for the whole ~6.6 min alignment
    expect(p).not.toContain('caution:Stall Protection Unavail');
  });

  it('P12/P20: SEAT BELT ON in every powered state; oxygen secured in cold & dark', () => {
    const rt = makeRig('ready_to_taxi');
    expect(rt.vars.get(V.seatBelt)).toBe(1);
    expect(rt.vars.get('xpdr.mode')).toBe(1); // STANDBY parked
    const cd = makeRig('cold_dark');
    expect(cd.vars.get(V.paxOxy)).toBe(0); // Shutdown "OXYGEN Systems - OFF" (code450)
    expect(cd.vars.get(V.paxShutoff)).toBe(0);
    expect(cd.vars.get(V.crewOxy)).toBe(0);
  });
});
