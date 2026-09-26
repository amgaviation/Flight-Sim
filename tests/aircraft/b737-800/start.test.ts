/**
 * (a) Cold & dark -> normal start procedure (FCOM NP.21 / SP.7 "Electrical
 * power up", "APU start", "Engine start"), writing only the vars the cockpit
 * controls write: battery, APU on the battery, APU generators, fuel and
 * hydraulic pumps, APU bleed, ground start of engine 2 then engine 1
 * (ENGINE START GRD, start lever IDLE at 25 % N2, switch release at 56 %),
 * generators on line, APU off. Engines stabilize at the CFM56-7B ground-idle
 * values, generators are on the buses and every start-related annunciator
 * is extinguished.
 */
import { describe, expect, it } from 'vitest';
import { ENG } from '../../../src/core/vars';
import { B738, APU_SW, ENG_START, FUEL_PUMPS, HYD_PUMP_SWITCHES } from '../../../src/aircraft/b737-800/vars';
import { makeB738, press, type Rig } from './helpers';

function startEngine(r: Rig, i: 1 | 2): { maxEgt: number; leverAtN2: number; releaseN2: number; t: number } {
  const v = r.vars;
  v.set(B738.engStart(i), ENG_START.grd);
  let leverAtN2 = NaN;
  let releaseN2 = NaN;
  let maxEgt = 0;
  let t = 0;
  r.run(120, () => {
    t += 1 / 60;
    const n2 = v.get(ENG.n2(i));
    // Start lever to IDLE at 25 % N2 (B737ORG: "Min 25 % N2 ... to introduce fuel").
    if (Number.isNaN(leverAtN2) && n2 >= 25) {
      v.set(B738.startLever(i), 1);
      leverAtN2 = n2;
    }
    if (Number.isNaN(releaseN2) && v.get(B738.engStart(i)) !== ENG_START.grd) releaseN2 = n2;
    maxEgt = Math.max(maxEgt, v.get(ENG.itt(i)));
    return v.get(ENG.running(i)) === 1 && n2 > 58;
  });
  r.run(20);
  return { maxEgt, leverAtN2, releaseN2, t };
}

describe('737-800 cold & dark start', () => {
  it('APU start on the battery, engine starts with APU bleed, generators on line', () => {
    const r = makeB738({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(v.get('elec.xfr1_powered')).toBe(0);

    // ---- Electrical power up (battery only).
    v.set(B738.batSw, 1);
    v.set(B738.stbyPwrSw, 1);
    r.run(2);
    expect(v.get('elec.batt_bus_powered')).toBe(1);
    expect(v.get('elec.hot_batt_v')).toBeGreaterThan(23);
    // On the battery with no AC: standby buses on the battery (AUTO), transfer buses off.
    expect(v.get('elec.dc_stby_powered')).toBe(1);
    expect(v.get('elec.ac_stby_powered')).toBe(1);
    expect(v.get(B738.lt.xfrBusOff(1))).toBe(1);

    // ---- IRS mode selectors to NAV (alignment ~7 min at this latitude), present position entered on the CDU.
    v.set('ac.irs1_mode', 2);
    v.set('ac.irs2_mode', 2);

    // ---- APU start (APU switch START, spring back to ON).
    v.set(B738.fuelPump('l_aft'), 0); // no AC yet: the APU is suction-fed from tank 1
    v.set(B738.apuSw, APU_SW.start);
    r.run(0.5);
    v.set(B738.apuSw, APU_SW.on);
    let apuT = 0;
    let minBattV = 99;
    r.run(150, () => {
      apuT += 1 / 60;
      minBattV = Math.min(minBattV, v.get('elec.batt_bus_v'));
      return v.get('apu.avail') === 1;
    });
    expect(v.get('apu.avail')).toBe(1);
    expect(apuT).toBeGreaterThan(30);
    expect(apuT).toBeLessThan(120); // LIM: APU start cycle up to 120 s
    expect(minBattV).toBeGreaterThan(14);
    r.run(3);
    // ---- APU generators on both transfer buses.
    press(r, B738.apuGenSw(1));
    press(r, B738.apuGenSw(2));
    r.run(1);
    expect(v.get(B738.xfrSrc(1))).toBe(2);
    expect(v.get(B738.xfrSrc(2))).toBe(2);
    expect(v.get('elec.xfr1_powered')).toBe(1);
    expect(v.get('elec.xfr2_powered')).toBe(1);
    expect(v.get('elec.dc1_v')).toBeGreaterThan(26);
    expect(v.get(B738.lt.apuGenOffBus)).toBe(0);
    expect(v.get(B738.lt.genOffBus(1))).toBe(0);
    // Present position entered on the CDU POS INIT page (both IRSs powered now).
    r.events.emit('irs.pos_entry');

    // ---- Before start: pumps, IRS, bleed configuration.
    for (const p of FUEL_PUMPS) if (!p.startsWith('c_')) v.set(B738.fuelPump(p), 1);
    for (const p of HYD_PUMP_SWITCHES) v.set(B738.hydPump(p), 1);
    v.set(B738.apuBleed, 1);
    v.set(B738.pack(1), 0);
    v.set(B738.pack(2), 0);
    v.set(B738.isoValve, 1);
    v.set(B738.antiColl, 1);
    v.set(B738.emerExitLt, 1);
    r.run(8);
    // Electric hydraulic pumps pressurize A and B; duct pressure from the APU on both sides (isolation valve open: packs off).
    expect(v.get('hyd.a_psi')).toBeGreaterThan(2500);
    expect(v.get('hyd.b_psi')).toBeGreaterThan(2500);
    expect(v.get('pneu.iso_open')).toBe(1);
    expect(v.get('pneu.r_duct_psi')).toBeGreaterThan(30);

    // ---- Engine 2, then engine 1 (FCOM: start engine 2 first).
    const e2 = startEngine(r, 2);
    const e1 = startEngine(r, 1);
    for (const [i, e] of [[1, e1], [2, e2]] as const) {
      expect(e.leverAtN2, `lever ${i}`).toBeGreaterThanOrEqual(25);
      // GRD solenoid releases at the 56 % starter cut-out (B737ORG).
      expect(e.releaseN2, `release ${i}`).toBeGreaterThan(55);
      expect(e.releaseN2).toBeLessThan(60);
      expect(e.maxEgt, `EGT ${i}`).toBeGreaterThan(450);
      expect(e.maxEgt).toBeLessThan(725); // LIM start limit
      expect(e.t).toBeLessThan(90);
      expect(v.get(B738.engStart(i))).toBe(ENG_START.off);
    }

    // ---- After start: generators, APU bleed off, packs AUTO, APU off, ENGINE START CONT.
    press(r, B738.genSw(1));
    press(r, B738.genSw(2));
    v.set(B738.apuBleed, 0);
    v.set(B738.pack(1), 1);
    v.set(B738.pack(2), 1);
    v.set(B738.apuSw, APU_SW.off);
    v.set(B738.probeHeat('a'), 1);
    v.set(B738.probeHeat('b'), 1);
    for (const i of [1, 2] as const) v.set(B738.engStart(i), ENG_START.cont);
    r.run(30);
    // IRS alignment complete, then YAW DAMPER ON (the SMYD needs aligned ADIRU data and system B).
    r.run(600, () => v.get('irs1.state') === 2 && v.get('irs2.state') === 2);
    expect(v.get('irs1.state')).toBe(2);
    v.set(B738.ydSw, 1);
    r.run(2);
    expect(v.get(B738.ydSw)).toBe(1);

    for (const i of [1, 2] as const) {
      expect(v.get(ENG.running(i))).toBe(1);
      // CFM56-7B ground idle (EST line values): N1 ~20-22 %, N2 ~58-61 %, EGT ~400-500 degC, FF ~0.25-0.32 t/h.
      expect(v.get(ENG.n1(i))).toBeGreaterThan(19);
      expect(v.get(ENG.n1(i))).toBeLessThan(23);
      expect(v.get(ENG.n2(i))).toBeGreaterThan(57);
      expect(v.get(ENG.n2(i))).toBeLessThan(62);
      expect(v.get(ENG.itt(i))).toBeGreaterThan(380);
      expect(v.get(ENG.itt(i))).toBeLessThan(560);
      expect(v.get(ENG.fuelFlowPph(i))).toBeGreaterThan(500);
      expect(v.get(ENG.fuelFlowPph(i))).toBeLessThan(750);
      expect(v.get(ENG.oilPressPsi(i))).toBeGreaterThan(26);
      expect(v.get(B738.xfrSrc(i))).toBe(1);
      expect(v.get(`elec.idg${i}_online`)).toBe(1);
      expect(v.get(`elec.xfr${i}_hz`)).toBeCloseTo(400, 0);
    }
    // Buses regulated: AC 115 V, DC ~28 V, battery charging.
    expect(v.get('elec.xfr1_v')).toBeGreaterThan(110);
    expect(v.get('elec.dc1_v')).toBeGreaterThan(26);
    expect(v.get('elec.dc2_v')).toBeGreaterThan(26);
    // Start-related and electrical / hydraulic / fuel annunciators clear, no master caution.
    for (const id of ['xfr_bus_off1', 'xfr_bus_off2', 'source_off1', 'source_off2', 'drive1', 'drive2', 'hyd_lp_eng1', 'hyd_lp_eng2', 'hyd_lp_elec1', 'hyd_lp_elec2', 'fuel_lp_l_aft', 'fuel_lp_r_aft', 'stby_pwr_off', 'bat_discharge', 'tr_unit']) {
      expect(v.get(`cas.${id}`), id).toBe(0);
    }
    for (const i of [1, 2] as const) expect(v.get(B738.lt.engStartValve(i))).toBe(0);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    expect(v.get('cas.warning_count')).toBe(0);
    // The fuel system burns fuel from the tanks.
    const f0 = v.get('fuel.total_kg');
    r.run(60);
    expect(v.get('fuel.total_kg')).toBeLessThan(f0 - 5);
  });
});
