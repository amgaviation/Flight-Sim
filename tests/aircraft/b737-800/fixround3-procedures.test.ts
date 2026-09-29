/**
 * Fix round 1 (LENS procedures) verification: gaps G25 / B738-P01..P14.
 *
 * Sources: Boeing 737 Normal Checklist (aviationhunt.com public copy; Nov-2017
 * NC card) and the 737 QRH D6-27370-804 (public training copy). Each test
 * would fail without the corresponding fix.
 */
import { describe, expect, it } from 'vitest';
import { B738_CHECKLISTS } from '../../../src/aircraft/b737-800/checklists';
import { B738, SPEEDBRAKE } from '../../../src/aircraft/b737-800/vars';
import { B737_VARS } from '../../../src/avionics/boeing-737/vars';
import type { Checklist } from '../../../src/aircraft/types';
import { loadNav, makeB738, type Rig } from './helpers';

function list(title: string): Checklist {
  const c = B738_CHECKLISTS.find((x) => x.title === title);
  expect(c, `checklist ${title}`).toBeTruthy();
  return c!;
}
function item(title: string, challenge: string) {
  const i = list(title).items.find((x) => x.challenge.startsWith(challenge));
  expect(i, `${title}: ${challenge}`).toBeTruthy();
  return i!;
}
const passes = (r: Rig, title: string, challenge: string): boolean => item(title, challenge).check!(r.vars);

describe('B738-P01/G25: PREFLIGHT checklist', () => {
  it('exists as the first phase of the normal sequence with live checks', () => {
    expect(B738_CHECKLISTS[0].title).toBe('PREFLIGHT');
    const titles = B738_CHECKLISTS.map((c) => c.title);
    // Full Boeing NC sequence present, in order.
    for (const [a, b] of [['PREFLIGHT', 'BEFORE START'], ['BEFORE START', 'BEFORE TAXI'], ['BEFORE TAXI', 'BEFORE TAKEOFF'], ['BEFORE TAKEOFF', 'AFTER TAKEOFF'], ['AFTER TAKEOFF', 'DESCENT'], ['DESCENT', 'APPROACH'], ['APPROACH', 'LANDING'], ['LANDING', 'SHUTDOWN'], ['SHUTDOWN', 'SECURE']]) {
      expect(titles.indexOf(a)).toBeGreaterThanOrEqual(0);
      expect(titles.indexOf(a)).toBeLessThan(titles.indexOf(b) < 0 ? 999 : titles.indexOf(b));
    }
  });

  it('checks are live against the cockpit vars', () => {
    const r = makeB738({ state: 'cold_dark' });
    r.run(2);
    const v = r.vars;
    // Secured aircraft: parking brake set, start levers cutoff, mode selector AUTO — those preflight items pass.
    expect(passes(r, 'PREFLIGHT', 'Parking brake')).toBe(true);
    expect(passes(r, 'PREFLIGHT', 'Engine start levers')).toBe(true);
    expect(passes(r, 'PREFLIGHT', 'Pressurization mode selector')).toBe(true);
    expect(passes(r, 'PREFLIGHT', 'Navigation transfer and display switches')).toBe(true);
    // Window heat is OFF cold and dark: the item reads not-done until switched ON.
    expect(passes(r, 'PREFLIGHT', 'Window heat')).toBe(false);
    for (const w of ['l_side', 'l_fwd', 'r_fwd', 'r_side']) v.set(B738.windowHeat(w as never), 1);
    expect(passes(r, 'PREFLIGHT', 'Window heat')).toBe(true);
    // Display source selector out of AUTO fails the transfer-switch item.
    v.set(B737_VARS.displaysSource, 1);
    expect(passes(r, 'PREFLIGHT', 'Navigation transfer and display switches')).toBe(false);
  });

  it('oxygen and flight instruments pass in a powered, aligned aircraft', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    r.run(3);
    expect(passes(r, 'PREFLIGHT', 'Oxygen')).toBe(true);
    expect(passes(r, 'PREFLIGHT', 'Flight instruments')).toBe(true);
  });
});

describe('B738-P03: BEFORE TAKEOFF matches the Boeing card', () => {
  it('has exactly the two Boeing items', () => {
    const c = list('BEFORE TAKEOFF');
    expect(c.items.map((i) => i.challenge)).toEqual(['Flaps', 'Stabilizer trim']);
  });
});

describe('B738-P04: CDU preflight completed in the ground presets', () => {
  it('takeoff preset: v-speeds, N1 limit inputs and MCP speed = V2', async () => {
    const r = makeB738({ state: 'takeoff', nav: await loadNav() });
    r.run(3);
    const v = r.vars;
    expect(v.get('ac.fmc.v1_kt')).toBeGreaterThan(100);
    expect(v.get('ac.fmc.v2_kt')).toBeGreaterThan(v.get('ac.fmc.v1_kt') - 1);
    expect(v.get('ac.fmc.perf_valid')).toBe(1);
    expect(v.get('ap.sel_spd_kt')).toBe(v.get('ac.fmc.v2_kt'));
    // BEFORE START auto-checks that read the CDU preflight now pass.
    expect(passes(r, 'BEFORE START', 'MCP')).toBe(true);
    expect(passes(r, 'BEFORE START', 'Takeoff speeds')).toBe(true);
    expect(passes(r, 'BEFORE START', 'CDU preflight')).toBe(true);
  });

  it('ready_to_taxi preset: MCP speed window shows V2', async () => {
    const r = makeB738({ state: 'ready_to_taxi', nav: await loadNav() });
    r.run(3);
    expect(r.vars.get('ap.sel_spd_kt')).toBeGreaterThan(100);
    expect(r.vars.get('ap.sel_spd_kt')).toBe(r.vars.get('ac.fmc.v2_kt'));
  });
});

describe('B738-P05: landing data in the approach preset', () => {
  it('VREF 30 selected and EFIS minimums set', async () => {
    const r = makeB738({ state: 'approach', air: { altFtMsl: 3000, iasKt: 180 }, nav: await loadNav() });
    r.run(3);
    const v = r.vars;
    expect(v.get('ac.fmc.vref_kt')).toBeGreaterThan(120);
    expect(v.get('ac.fmc.vref_flaps')).toBe(30);
    for (const s of [1, 2] as const) {
      expect(v.get(B737_VARS.efisMinsRef(s))).toBe(1);
      expect(v.get(B737_VARS.efisMinsBaroFt(s))).toBeGreaterThan(0);
    }
    expect(passes(r, 'DESCENT', 'Landing data')).toBe(true);
  });

  it('cruise preset leaves VREF unselected (crews set it in the descent)', async () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 35000, iasKt: 270 }, nav: await loadNav() });
    r.run(3);
    expect(r.vars.get('ac.fmc.vref_kt') > 0).toBe(false);
  });
});

describe('B738-P06: OFF SCHED DESCENT extinguished by FLT ALT reset (QRH 2.7)', () => {
  it('resetting FLT ALT to the actual altitude clears the latch', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 32000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    v.set(B738.fltAltFt, 35000); // planned cruise above the actual level
    r.run(2);
    r.fdm.reposition({ lat: v.get('fdm.lat_deg') || 40.85, lon: v.get('fdm.lon_deg') || -74.06, altFtMsl: 25000, iasKt: 280, headingTrue: 6 });
    r.run(10);
    expect(v.get('ac.b738.off_sched_descent')).toBe(1);
    expect(passes(r, 'OFF SCHED DESCENT', 'Not landing at airport of departure')).toBe(false);
    // QRH step: FLT ALT indicator ... Reset to actual airplane altitude.
    v.set(B738.fltAltFt, 25000);
    r.run(3);
    expect(v.get('ac.b738.off_sched_descent')).toBe(0);
    expect(v.get(B738.lt.offSchedDescent)).toBe(0);
    expect(passes(r, 'OFF SCHED DESCENT', 'Not landing at airport of departure')).toBe(true);
  });
});

describe('B738-P07: FMA cleared on ground A/P disconnect after autoland', () => {
  it('the 737 AFDS passes clearOnGroundDisconnect to the shared Afcs', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const afcs = r.sys.suite.afds.afcs;
    expect(afcs).toBeTruthy();
    expect(afcs!.cfg.autoland?.clearOnGroundDisconnect).toBe(true);
  });
});

describe('B738-P08: cold & dark packs OFF (SECURE checklist)', () => {
  it('both pack switches OFF and the SECURE item passes', () => {
    const r = makeB738({ state: 'cold_dark' });
    r.run(1);
    expect(r.vars.get(B738.pack(1))).toBe(0);
    expect(r.vars.get(B738.pack(2))).toBe(0);
    expect(passes(r, 'SECURE', 'Packs')).toBe(true);
  });
});

describe('B738-P09..P13: checklist auto-checks', () => {
  it('P09: APPROACH altimeters cross-checks both sides', () => {
    const r = makeB738({ state: 'approach', air: { altFtMsl: 3000, iasKt: 180 } });
    r.run(2);
    expect(passes(r, 'APPROACH', 'Altimeters')).toBe(true);
    r.vars.set('adc2.baro_std', 1); // F/O side left at STD
    expect(passes(r, 'APPROACH', 'Altimeters')).toBe(false);
  });

  it('P10: fuel/pumps check includes the centre pumps with centre fuel aboard', () => {
    const r = makeB738({ state: 'ready_to_taxi', fuelKg: [4000, 4000, 1600] });
    r.run(2);
    expect(passes(r, 'BEFORE START', 'Fuel')).toBe(true);
    r.vars.set(B738.fuelPump('c_l'), 0);
    expect(passes(r, 'BEFORE START', 'Fuel')).toBe(false);
    // With ≤ 453 kg centre fuel the centre pumps stay off and the item still passes (FCOM NP rule).
    const r2 = makeB738({ state: 'ready_to_taxi', fuelKg: [4200, 4200, 0] });
    r2.run(2);
    expect(r2.vars.get(B738.fuelPump('c_l'))).toBe(0);
    expect(passes(r2, 'BEFORE START', 'Fuel')).toBe(true);
  });

  it('P11: SHUTDOWN parking brake response is open with no auto-check', () => {
    const i = item('SHUTDOWN', 'Parking brake');
    expect(i.response).toBe('Released / Set to park');
    expect(i.check).toBeUndefined();
  });

  it('P12: windows-locked check reads the window cranks', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    r.run(1);
    expect(passes(r, 'BEFORE START', 'Windows')).toBe(true);
    r.vars.set(B738.windowCrank(1), 0.6);
    expect(passes(r, 'BEFORE START', 'Windows')).toBe(false);
  });

  it('P13: Recall does not read clean while a caution is latched', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(12); // let the post-load transients (EEC ALTN while the FADEC settles) clear
    expect(passes(r, 'BEFORE TAXI', 'Recall')).toBe(true);
    // Both tank 1 pumps off with the engines running: FUEL TANK 1 PUMPS LOW PRESSURE caution.
    v.set(B738.fuelPump('l_aft'), 0);
    v.set(B738.fuelPump('l_fwd'), 0);
    r.run(5);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
    expect(passes(r, 'BEFORE TAXI', 'Recall')).toBe(false);
    // Cancelling the master caution must not make the recall read checked: the fault is still latched.
    v.set(B738.masterCaution(1), 1);
    r.run(0.2);
    v.set(B738.masterCaution(1), 0);
    r.run(1);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    expect(passes(r, 'BEFORE TAXI', 'Recall')).toBe(false);
    // Restoring the pumps clears the fault and the recall reads checked again.
    v.set(B738.fuelPump('l_aft'), 1);
    v.set(B738.fuelPump('l_fwd'), 1);
    r.run(5);
    expect(passes(r, 'BEFORE TAXI', 'Recall')).toBe(true);
  });
});

describe('B738-P14: Boeing card wording', () => {
  it('Speedbrake / Anti collision lights / Passenger signs', () => {
    expect(item('LANDING', 'Speedbrake').response).toBe('ARMED');
    expect(list('BEFORE START').items.some((i) => i.challenge === 'Anti collision lights')).toBe(true);
    expect(item('BEFORE START', 'Passenger signs').response).toBe('ON');
  });
});

describe('B738-P02: QRH non-normal checklists', () => {
  it('the key simulated NNCs are available with the Non-normal phase', () => {
    for (const t of ['ENGINE FIRE or Engine Severe Damage or Separation', 'CABIN ALTITUDE WARNING or Rapid Depressurization', 'OFF SCHED DESCENT', 'DRIVE', 'Loss of Both Engine Driven Generators', 'Loss of System A', 'Loss of System B', 'BLEED TRIP OFF', 'PACK']) {
      expect(list(t).phase).toBe('Non-normal');
    }
  });

  it('Loss of System A checks track the QRH actions while system A is low', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 20000, iasKt: 280 } });
    const v = r.vars;
    r.run(3);
    // No fault: the conditional items read done.
    expect(passes(r, 'Loss of System A', 'System A HYD PUMP switches (both)')).toBe(true);
    // System A down: the actions are outstanding until performed.
    r.sys.hyd.setPressure('a', 0);
    v.set(B738.hydPump('eng1'), 1);
    v.set(B738.hydPump('elec2'), 1);
    expect(passes(r, 'Loss of System A', 'System A HYD PUMP switches (both)')).toBe(false);
    expect(passes(r, 'Loss of System A', 'NOSE WHEEL STEERING switch')).toBe(false);
    v.set(B738.hydPump('eng1'), 0);
    v.set(B738.hydPump('elec2'), 0);
    v.set(B738.fltCtl('a'), -1);
    v.set(B738.nwsSw, 0);
    expect(passes(r, 'Loss of System A', 'System A FLT CONTROL switch')).toBe(true);
    expect(passes(r, 'Loss of System A', 'System A HYD PUMP switches (both)')).toBe(true);
    expect(passes(r, 'Loss of System A', 'NOSE WHEEL STEERING switch')).toBe(true);
  });

  it('engine fire memory items scope to the affected engine', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    v.set('fail.fire.eng1', 1);
    r.run(4);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(passes(r, 'ENGINE FIRE or Engine Severe Damage or Separation', 'Engine start lever (affected engine)')).toBe(false);
    v.set(B738.tla(1), 0);
    v.set(B738.startLever(1), 0);
    v.set(B738.fireHandle(1), 1);
    r.run(1);
    expect(passes(r, 'ENGINE FIRE or Engine Severe Damage or Separation', 'Thrust lever (affected engine)')).toBe(true);
    expect(passes(r, 'ENGINE FIRE or Engine Severe Damage or Separation', 'Engine start lever (affected engine)')).toBe(true);
    expect(passes(r, 'ENGINE FIRE or Engine Severe Damage or Separation', 'Engine fire switch (affected engine)')).toBe(true);
  });
});

describe('speedbrake landing item still verifies the armed detent', () => {
  it('sanity: SPEEDBRAKE.armed constant used by the LANDING check', () => {
    const r = makeB738({ state: 'approach', air: { altFtMsl: 3000, iasKt: 180 } });
    r.run(2);
    expect(Math.abs(r.vars.get(B738.speedbrake) - SPEEDBRAKE.armed)).toBeLessThan(0.03);
  });
});
