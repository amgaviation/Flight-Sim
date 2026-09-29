/**
 * Procedures-lens fixes (round 1) of the steam 172S: the POH 172SPHUS Section 3 / 4 checklists
 * transcribed item by item (c172s-common/checklistsSteam.ts), the supplement lists and their
 * phase order (c172-steam/checklists.ts), the procedure monitor latches (c172-steam/procedures.ts),
 * the fire model wiring, the presets and the idle alternator output. Each test fails without its fix.
 */
import { describe, expect, it } from 'vitest';
import { ADC, ENG, NAV } from '../../../../src/core/vars';
import type { Checklist } from '../../../../src/aircraft/types';
import { ANN_SW, C172, C172_FAIL, DOOR, ELT_SW, FUEL_SEL, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { C172_STEAM_CHECKLISTS } from '../../../../src/aircraft/c172-steam/checklists';
import { STEAM_PROC } from '../../../../src/aircraft/c172-steam/procedures';
import { KAP, KT, ST } from '../../../../src/aircraft/c172-steam/vars';
import { KT_MODE } from '../../../../src/aircraft/c172-steam/avionics/kt76c';
import { makeSteamRig, type SteamRig } from '../rig';

const L = C172_STEAM_CHECKLISTS;
function list(title: string): Checklist {
  const l = L.find((c) => c.title === title);
  if (!l) throw new Error(`no checklist ${title}`);
  return l;
}
/** The item whose challenge (POH number stripped) starts with `ch`; `nth` for repeated items. */
function item(title: string, ch: string, nth = 0) {
  const its = list(title).items.filter((i) => i.challenge.trim().replace(/^(\d+|[a-z])\.\s*/, '').startsWith(ch));
  const it = its[nth];
  if (!it) throw new Error(`no item ${ch} in ${title}`);
  return it;
}
const check = (r: SteamRig, title: string, ch: string, nth = 0): boolean => {
  const it = item(title, ch, nth);
  if (!it.check) throw new Error(`item ${ch} in ${title} has no check`);
  return it.check(r.vars);
};
/** Numbered POH items ("1." .. "n.") of a list. */
const numbered = (title: string): number => list(title).items.filter((i) => /^\d+\./.test(i.challenge.trim())).length;

function setRpm(r: SteamRig, target: number): number {
  const v = r.vars;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = 0.5 * (lo + hi);
    v.set(C172.throttle, mid);
    r.run(2.5);
    if (v.get(ENG.rpm(1)) < target) lo = mid;
    else hi = mid;
  }
  v.set(C172.throttle, 0.5 * (lo + hi));
  r.run(5);
  return v.get(ENG.rpm(1));
}

describe('c172-steam procedures: POH checklist content', () => {
  it('P01/P05: the seven missing Section 3 lists with the POH item counts', () => {
    expect(numbered('EMERGENCY — Precautionary Landing With Engine Power')).toBe(13);
    expect(numbered('EMERGENCY — Ditching')).toBe(13);
    expect(numbered('EMERGENCY — Fires During Start On Ground')).toBe(14);
    expect(numbered('EMERGENCY — Cabin Fire')).toBe(5);
    expect(numbered('EMERGENCY — Wing Fire')).toBe(4);
    expect(numbered('ABNORMAL LANDING — Landing With a Flat Main Tire')).toBe(4);
    expect(numbered('ABNORMAL LANDING — Landing With a Flat Nose Tire')).toBe(4);
  });

  it('P06/P07: Short Field Landing; the six separate POH lists with their phases', () => {
    expect(numbered('Short Field Landing')).toBe(7);
    const phases: [string, string, number][] = [
      ['Enroute Climb', 'climb', 3],
      ['Cruise', 'cruise', 3],
      ['Descent', 'descent', 6],
      ['Before Landing', 'approach', 6],
      ['After Landing', 'after landing', 1],
      ['Securing Airplane', 'shutdown', 8],
    ];
    for (const [t, p, n] of phases) {
      expect(list(t).phase).toBe(p);
      expect(numbered(t)).toBe(n);
    }
    expect(item('Before Landing', 'Fuel Selector Valve').response).toBe('BOTH');
    for (const t of ['Enroute Climb / Cruise', 'Descent / Before Landing', 'After Landing / Securing Airplane']) expect(L.some((c) => c.title === t)).toBe(false);
  });

  it('P08: lists run in flight-phase order with the supplements next to their POH phase', () => {
    const idx = (t: string): number => L.findIndex((c) => c.title === t);
    const firstEmergency = L.findIndex((c) => c.phase === 'emergency');
    expect(L.slice(firstEmergency).every((c) => c.phase === 'emergency')).toBe(true);
    expect(idx('Securing Airplane')).toBe(firstEmergency - 1);
    expect(idx('KLN 94 GPS Turn-On and Self Test')).toBeGreaterThan(idx('Starting Engine (With External Power)'));
    expect(idx('KLN 94 GPS Turn-On and Self Test')).toBeLessThan(idx('Before Takeoff'));
    expect(idx('KAP 140 Preflight (Perform Prior to Each Flight)')).toBe(idx('Before Takeoff') - 1);
    expect(idx('KAP 140 After Takeoff / Engagement')).toBeGreaterThan(idx('Enroute Climb'));
    expect(idx('KAP 140 After Takeoff / Engagement')).toBeLessThan(idx('Cruise'));
  });

  it('P19/P20/P21/P22: notes, full icing / electrical fire lists, walk-around sections, split items', () => {
    const start = list('Starting Engine (With Battery)');
    expect(start.items.some((i) => i.challenge.startsWith('NOTE: If engine is warm, omit priming procedure of steps 6, 7 and 8'))).toBe(true);
    expect(start.items.some((i) => i.challenge.startsWith('NOTE: If engine floods'))).toBe(true);
    expect(numbered('EMERGENCY — Inadvertent Icing Encounter')).toBe(11);
    expect(numbered('EMERGENCY — Electrical Fire In Flight')).toBe(11);
    expect(item('EMERGENCY — Electrical Fire In Flight', 'Radio Switches').response).toBe('OFF');
    const ext = list('Preflight Inspection — Exterior (2 - 8)').items.filter((i) => i.response === '').map((i) => i.challenge);
    expect(ext.filter((h) => /^\d /.test(h))).toEqual(['2 EMPENNAGE', '3 RIGHT WING Trailing Edge', '4 RIGHT WING', '5 NOSE', '6 LEFT WING', '7 LEFT WING Leading Edge', '8 LEFT WING Trailing Edge']);
    expect(item('Preflight Inspection — Exterior (2 - 8)', 'Antennas')).toBeTruthy();
    expect(item('Before Takeoff', 'Passenger Seat Backs').response).toBe('MOST UPRIGHT POSITION');
    expect(item('Before Takeoff', 'Throttle', 1).response).toBe('CHECK IDLE');
    expect(item('Before Takeoff', 'Throttle', 2).response).toBe('1000 RPM or LESS');
    expect(item('Normal Takeoff', 'Wing Flaps', 1).response).toBe('RETRACT');
    expect(item('Preflight Inspection — 1 Cabin', 'Autopilot Static Source Opening')).toBeTruthy();
  });
});

describe('c172-steam procedures: live checks', () => {
  it('P14/P10/P16: cold & dark preflight: selector LEFT until set BOTH, breakers, TST, flaps, pitot heat', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    const PC = 'Preflight Inspection — 1 Cabin';
    expect(v.get(C172.fuelSelector)).toBe(FUEL_SEL.left);
    expect(check(r, 'Securing Airplane', 'Fuel Selector Valve')).toBe(true);
    expect(check(r, PC, 'Fuel Selector Valve')).toBe(false);
    v.set(C172.fuelSelector, FUEL_SEL.both);
    expect(check(r, PC, 'Fuel Selector Valve')).toBe(true);
    // Circuit breakers (Before Starting Engine 5 / 10).
    expect(check(r, 'Before Starting Engine', 'Avionics Circuit Breakers')).toBe(true);
    v.set('cb.gps', 0);
    expect(check(r, 'Before Starting Engine', 'Avionics Circuit Breakers')).toBe(false);
    expect(check(r, 'Before Starting Engine', 'Circuit Breakers')).toBe(false);
    v.set('cb.gps', 1);
    // Annunciator TST held with the master ON: all six lamps light, the latch sets.
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(12);
    expect(check(r, PC, 'Annunciator Panel Switch')).toBe(false);
    v.set(C172.annSwitch, ANN_SW.test);
    r.run(2);
    v.set(C172.annSwitch, ANN_SW.day);
    r.run(0.5);
    expect(check(r, PC, 'Annunciator Panel Switch')).toBe(true);
    // Flaps EXTEND, pitot heat ON.
    v.set(C172.flapLever, 3);
    r.run(15);
    expect(check(r, PC, 'Flaps')).toBe(true);
    v.set(C172.pitotHeat, 1);
    r.run(0.5);
    expect(check(r, PC, 'Pitot Heat')).toBe(true);
  });

  it('P02/P03: external power start and the POH electrical system check (ammeter - at idle, + at 1500)', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    const T = 'Starting Engine (With External Power)';
    expect(check(r, T, 'External Power')).toBe(false);
    v.set(ST.gpuRequest, 1);
    r.run(0.5);
    expect(v.get(C172.extPower)).toBe(1);
    expect(check(r, T, 'External Power')).toBe(true);
    // Start on the GPU.
    v.set(C172.controlLock, 0);
    v.set(C172.keyIn, 1);
    v.set(C172.fuelSelector, FUEL_SEL.both);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    v.set(C172.throttle, 0.08);
    v.set(C172.mixture, 1);
    v.set(C172.magneto, MAG.start);
    r.run(10, () => v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 700);
    v.set(C172.magneto, MAG.both);
    r.run(20);
    expect(v.get(ENG.running(1))).toBe(1);
    // 14. External power DISCONNECT.
    v.set(ST.gpuRequest, 0);
    r.run(0.5);
    expect(check(r, T, 'External Power', 1)).toBe(true);
    // 15 a-d: master OFF, taxi + landing ON, idle, master ON: the ammeter shows a discharge.
    v.set(C172.masterBat, 0);
    v.set(C172.masterAlt, 0);
    v.set(C172.taxi, 1);
    v.set(C172.land, 1);
    v.set(C172.throttle, 0);
    r.run(8);
    expect(check(r, T, 'Engine RPM')).toBe(true);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(5);
    expect(v.get('elec.batt_amps')).toBeLessThan(0);
    expect(check(r, T, 'Master Switch', 3)).toBe(true);
    // e/f: ~1500 RPM: charge, VOLTS out.
    setRpm(r, 1500);
    expect(check(r, T, 'Engine RPM', 1)).toBe(true);
    expect(v.get('elec.batt_amps')).toBeGreaterThan(0);
    expect(check(r, T, 'Ammeter and Low Voltage Annunciator')).toBe(true);
  });

  it('P12/P13/P09: presets idle at 1000 RPM or less; approach LAND and TAXI on; transponder ALT for takeoff', () => {
    for (const s of ['ready_to_taxi', 'takeoff'] as const) {
      const r = makeSteamRig({ state: s });
      r.vars.set(C172.parkingBrake, 1);
      r.run(10);
      expect(r.vars.get(ENG.rpm(1))).toBeLessThanOrEqual(1000);
      expect(r.vars.get(ENG.rpm(1))).toBeGreaterThanOrEqual(800);
      expect(check(r, 'Before Takeoff', 'Throttle', 2)).toBe(true);
      expect(check(r, 'Normal Takeoff', 'Transponder')).toBe(s === 'takeoff');
      if (s === 'ready_to_taxi') {
        expect(check(r, 'KT 76C Transponder — Before Takeoff (Supplement 2)', 'Mode Selector Knob')).toBe(true);
        r.vars.set(KT.mode, KT_MODE.alt);
        expect(check(r, 'Normal Takeoff', 'Transponder')).toBe(true);
      }
    }
    const a = makeSteamRig({ state: 'approach', air: { altFtMsl: 2000, iasKt: 70 } });
    a.run(1);
    expect(a.vars.get(C172.taxi)).toBe(1);
    expect(check(a, 'Before Landing', 'Landing/Taxi Lights')).toBe(true);
    a.vars.set(C172.taxi, 0);
    expect(check(a, 'Before Landing', 'Landing/Taxi Lights')).toBe(false);
  });

  it('P15: run-up checks: magneto drops latched, annunciators, trim, instruments, idle', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(C172.mixture, 1);
    r.run(3);
    const T = 'Before Takeoff';
    expect(check(r, T, 'Flight Instruments')).toBe(true);
    v.set(ADC.baroSetting(1), 30.2);
    expect(check(r, T, 'Flight Instruments')).toBe(false);
    v.set(ADC.baroSetting(1), v.get('env.qnh_inhg'));
    expect(check(r, T, 'Elevator Trim')).toBe(true);
    v.set(C172.trimPosition, 0.4);
    expect(check(r, T, 'Elevator Trim')).toBe(false);
    v.set(C172.trimPosition, 0.1);
    setRpm(r, 1800);
    expect(check(r, T, 'Throttle')).toBe(true);
    expect(check(r, T, 'Magnetos')).toBe(false);
    for (const m of [MAG.right, MAG.both, MAG.left, MAG.both]) {
      v.set(C172.magneto, m);
      r.run(4);
    }
    expect(v.get(STEAM_PROC.magDropR)).toBeGreaterThan(0);
    expect(v.get(STEAM_PROC.magDropL)).toBeGreaterThan(0);
    expect(check(r, T, 'Magnetos')).toBe(true);
    expect(check(r, T, 'Annunciator Panel')).toBe(true);
    v.set(C172.fuelSelector, FUEL_SEL.left);
    v.set('fail.c172.vac.left', 1);
    r.run(6);
    // A failed vacuum pump lights L VAC: the "no annunciators" item fails.
    if (v.get('ac.c172.lamp.vac_l') > 0.5) expect(check(r, T, 'Annunciator Panel')).toBe(false);
    v.set(C172.fuelSelector, FUEL_SEL.both);
    v.set(C172.throttle, 0);
    r.run(8);
    expect(check(r, T, 'Throttle', 1)).toBe(true); // CHECK IDLE
    expect(check(r, T, 'Throttle', 2)).toBe(true); // 1000 RPM or LESS
  });

  it('P18/P16: KAP 140 preflight trim test a-f latched; Before Takeoff 19 needs it', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.sys.procedures.clearAll();
    r.run(1);
    const K = 'KAP 140 Preflight (Perform Prior to Each Flight)';
    expect(check(r, 'Before Takeoff', 'Manual Electric Trim')).toBe(false);
    const hold = (lh: number, rh: number, s: number, disc = false): void => {
      v.set(ST.metLeft, lh);
      v.set(ST.metRight, rh);
      v.set(ST.apDisc, disc ? 1 : 0);
      r.run(s);
      v.set(ST.metLeft, 0);
      v.set(ST.metRight, 0);
      v.set(ST.apDisc, 0);
      r.run(0.3);
    };
    hold(1, 0, 5.5);
    expect(check(r, K, 'LH Switch', 1)).toBe(true);
    hold(0, 1, 5.5);
    expect(check(r, K, 'RH Switch', 1)).toBe(true);
    hold(1, 1, 3);
    hold(-1, -1, 3);
    expect(check(r, K, 'LH and RH Switch', 1)).toBe(true);
    expect(check(r, K, 'LH and RH Switch')).toBe(false); // interrupt not yet shown
    v.set(ST.metLeft, 1);
    v.set(ST.metRight, 1);
    v.set(ST.apDisc, 1);
    r.run(2);
    v.set(ST.apDisc, 0);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 0);
    r.run(0.3);
    expect(check(r, K, 'LH and RH Switch')).toBe(true);
    expect(check(r, 'Before Takeoff', 'Manual Electric Trim')).toBe(true);
  });

  it('P17: coupled approach airspeed item needs 90 KIAS', () => {
    const r = makeSteamRig({ state: 'approach', air: { altFtMsl: 2000, iasKt: 85 } });
    r.run(1);
    r.vars.set(ADC.ias(1), 85);
    expect(check(r, 'KAP 140 Approach (APR) and Glideslope Coupling (DG)', 'Airspeed')).toBe(false);
    r.vars.set(ADC.ias(1), 92);
    expect(check(r, 'KAP 140 Approach (APR) and Glideslope Coupling (DG)', 'Airspeed')).toBe(true);
  });

  it('P04: fires can happen in the steam airplane and the POH actions put them out', () => {
    // Engine fire in flight: fuel cut, ends; smoke reaches the cabin through CABIN HT.
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 105 } });
    const v = r.vars;
    r.run(1);
    v.set(C172.cabinHeat, 1);
    v.set(`fail.${C172_FAIL.fireEngine}`, 1);
    r.run(30);
    expect(v.get(C172.fireEngine)).toBeGreaterThan(0.5);
    expect(v.get(C172.cabinSmoke)).toBeGreaterThan(0.05);
    v.set(C172.mixture, 0);
    v.set(C172.fuelShutoff, 0);
    v.set(C172.fuelPump, 0);
    v.set(C172.masterBat, 0);
    v.set(C172.masterAlt, 0);
    v.set(C172.cabinHeat, 0);
    v.set(C172.cabinAir, 0);
    const EF = 'EMERGENCY — Engine Fire In Flight';
    for (const ch of ['Mixture', 'Fuel Shutoff Valve', 'Auxiliary Fuel Pump Switch', 'Master Switch', 'Cabin Heat and Air']) expect(check(r, EF, ch)).toBe(true);
    r.run(240);
    expect(v.get(C172.fireEngine)).toBe(0);

    // Cabin fire: only the portable extinguisher puts it out.
    const c = makeSteamRig({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 105 } });
    c.run(1);
    c.vars.set(C172.cabinAir, 1);
    c.vars.set(`fail.${C172_FAIL.fireCabin}`, 1);
    c.run(40);
    expect(c.vars.get(C172.fireCabin)).toBeGreaterThan(0.5);
    const CF = 'EMERGENCY — Cabin Fire';
    expect(check(c, CF, 'Fire Extinguisher')).toBe(false);
    c.vars.set(C172.masterBat, 0);
    c.vars.set(C172.masterAlt, 0);
    c.vars.set(C172.cabinAir, 0);
    c.vars.set(C172.extinguisher, 1);
    expect(check(c, CF, 'Fire Extinguisher')).toBe(true);
    c.run(12);
    expect(c.vars.get(C172.fireCabin)).toBe(0);
    expect(c.vars.get('ac.c172s.extinguisher_psi')).toBeLessThan(10);
    c.vars.set(C172.ventLeft, 1);
    expect(check(c, CF, 'Vents/Cabin Air/Heat', 1)).toBe(true);

    // Electrical fire dies with the master OFF; wing fire with its lights and pitot heat OFF.
    const e = makeSteamRig({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 105 } });
    e.run(1);
    e.vars.set(`fail.${C172_FAIL.fireElectrical}`, 1);
    e.vars.set(`fail.${C172_FAIL.fireWing}`, 1);
    e.vars.set(C172.nav, 1);
    e.run(30);
    expect(e.vars.get(C172.fireElectrical)).toBeGreaterThan(0.3);
    expect(e.vars.get(C172.fireWing)).toBeGreaterThan(0.3);
    for (const s of [C172.masterBat, C172.masterAlt, C172.land, C172.taxi, C172.nav, C172.strobe, C172.pitotHeat]) e.vars.set(s, 0);
    e.run(150);
    expect(e.vars.get(C172.fireElectrical)).toBe(0);
    expect(e.vars.get(C172.fireWing)).toBe(0);
    expect(check(e, 'EMERGENCY — Wing Fire', 'NOTE')).toBe(true);
  });

  it('P01: fire and flat-tyre failures are registered so the Section 3 lists can be exercised', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const ids = r.sys.core.failures.list().map((d) => d.id);
    for (const id of [C172_FAIL.fireEngine, C172_FAIL.fireStart, C172_FAIL.fireElectrical, C172_FAIL.fireCabin, C172_FAIL.fireWing]) expect(ids).toContain(id);
    expect(ids.filter((i) => i.startsWith('c172.tire')).length).toBe(3);
  });

  it('P05/P09: ditching and supplement emergency auto-checks read the radios, transponder and ELT', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 3000, iasKt: 100 } });
    const v = r.vars;
    r.run(1);
    const D = 'EMERGENCY — Ditching';
    expect(check(r, D, 'Radio')).toBe(false);
    r.sys.kx1.setCom(121500);
    r.sys.kt.setCode(7700);
    r.run(6);
    expect(check(r, D, 'Radio')).toBe(true);
    expect(check(r, 'EMERGENCY — Transponder: Emergency Signal (7700) / Loss of Communications (7600) (Supplement 2)', 'Numeric Keys 0-7')).toBe(true);
    expect(check(r, D, 'ELT')).toBe(false);
    v.set(C172.elt, ELT_SW.on);
    expect(check(r, D, 'ELT')).toBe(true);
    expect(check(r, 'EMERGENCY — ELT: Forced Landing (Supplement 4)', 'Before a forced landing')).toBe(true);
    v.set(C172.doorLeft, DOOR.open);
    expect(check(r, D, 'Cabin Doors')).toBe(true);
    expect(v.get(KAP.on)).toBe(1);
  });
});
