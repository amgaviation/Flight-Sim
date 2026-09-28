/**
 * Citation M2 procedures / checklists probe (read-only audit, PROCEDURES lens).
 *
 * Executes the normal checklists of src/aircraft/citation-m2/checklists.ts
 * headlessly against the systems, item by item, the way a pilot would with the
 * cockpit controls, and LOGS each auto-check and the real-response indications
 * (CAS, lights, bus power, engine values). Also audits the initial-state
 * presets against every checklist. Nothing here asserts real-aircraft
 * behaviour; the audit compares the log with the CJ-family AFM (525AFM-06)
 * and operator M2 flows. Output: console lines prefixed "PROC".
 */
import { describe, expect, it } from 'vitest';
import { M2, TLA, TEST_SEL } from '../../../../src/aircraft/citation-m2/vars';
import { M2_CHECKLISTS } from '../../../../src/aircraft/citation-m2/checklists';
import { makeM2, press, type Rig } from '../helpers';
import type { InitialState } from '../../../../src/aircraft/types';

const log = (s: string) => {
  // eslint-disable-next-line no-console
  console.log(`PROC ${s}`);
};
const cas = (r: Rig) =>
  r.sys.cas.list
    .filter((m) => m.active)
    .map((m) => `${m.level[0].toUpperCase()}:${m.text}`)
    .join(' | ');

function audit(r: Rig, title: string): string {
  const cl = M2_CHECKLISTS.find((c) => c.title === title);
  if (!cl) return `(no list ${title} after fix round 1)`;
  return cl.items
    .map((it) => {
      if (!it.check) return `${it.challenge}=-`;
      let ok = false;
      try {
        ok = it.check(r.vars);
      } catch {
        ok = false;
      }
      return `${it.challenge}=${ok ? 'OK' : 'NO'}`;
    })
    .join('; ');
}

function item(r: Rig, title: string, challenge: string): string {
  const it = M2_CHECKLISTS.find((c) => c.title === title)?.items.find((i) => i.challenge === challenge);
  if (!it) return 'missing';
  if (!it.check) return 'no-check';
  return it.check(r.vars) ? 'OK' : 'NO';
}

const SW = [
  M2.battSw, M2.genSw(1), M2.genSw(2), M2.dispatchSw, M2.tla(1), M2.tla(2), M2.ignSw(1), M2.boostSw(1), M2.pitotStaticSw, M2.engAiSw(1), M2.wingAiSw,
  M2.tailDeiceSw, M2.wsBleedSw(1), M2.pressSource, M2.airCondSw, M2.cabinFan, M2.paxOxy, M2.gearHandle, M2.antiskidSw, M2.parkBrake, M2.controlLock,
  M2.flapHandle, M2.speedbrake, M2.pitchTrim, M2.navLt, M2.antiColl, M2.landingLt, M2.taxiLt, M2.logoLt, M2.paxSafety, M2.cabinLt, M2.landingElevFt,
  'ap.yd_engaged', 'ap.engaged', 'ap.fd1_on', 'xpdr.mode', 'adc1.baro_inhg', 'adc1.baro_std', M2.panelLt,
];
const sw = (r: Rig) => SW.map((k) => `${k.replace('ac.m2.', '')}=${Number(r.vars.get(k)).toFixed(2).replace(/\.00$/, '')}`).join(' ');

describe('M2 procedures probe', () => {
  it('initial-state presets vs every checklist', () => {
    const cases: [InitialState, { altFtMsl: number; iasKt: number } | undefined][] = [
      ['cold_dark', undefined],
      ['ready_to_taxi', undefined],
      ['takeoff', undefined],
      ['cruise', { altFtMsl: 35000, iasKt: 240 }],
      ['approach', { altFtMsl: 3000, iasKt: 140 }],
    ];
    for (const [s, air] of cases) {
      const r = makeM2({ state: s, fuelLb: 2400, air });
      r.run(3);
      log(`PRESET ${s}: ${sw(r)}`);
      log(`PRESET ${s} CAS: ${cas(r)} | esi=${r.vars.get(M2.esiPowered)} ldg_elev=${r.vars.get('press.ldg_elev_ft').toFixed(0)} to_elev=${r.vars.get(M2.takeoffFieldElevFt).toFixed(0)} flaps=${r.vars.get('surf.flaps_deg').toFixed(1)} tla1=${r.vars.get(M2.tla(1)).toFixed(3)}`);
      for (const c of M2_CHECKLISTS) log(`PRESET ${s} [${c.title}] ${audit(r, c.title)}`);
    }
    expect(true).toBe(true);
  });

  it('cold & dark -> cockpit preparation -> before start -> start -> after start', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2400 });
    const v = r.vars;
    r.run(2);
    log(`CD [Cockpit preparation] before any action: ${audit(r, 'Cockpit preparation')}`);
    // Cockpit preparation.
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    r.run(3);
    log(`CP battery BATT: batt_v=${v.get('elec.batt_v').toFixed(2)} batt_bus_v=${v.get('elec.batt_bus_v').toFixed(2)} emer=${v.get('elec.emer_powered')} esi=${v.get(M2.esiPowered)} pfd1=${v.get('elec.pfd1_powered')} CAS: ${cas(r)}`);
    // Battery EMER check (CJ-family AFM cockpit inspection item 12; M2 flows BATTERY SWITCH EMER / ON).
    v.set(M2.battSw, -1);
    r.run(3);
    const ids = ['emer', 'avn1', 'avn2', 'pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2', 'gia1', 'gia2', 'adc1', 'adc2', 'ahrs1', 'ahrs2', 'gmc', 'audio1', 'audio2', 'xpdr1', 'flood_lts', 'gear_ctl', 'esi', 'pitot_r', 'panel_lts', 'stby_lts'];
    log(`CP BATT EMER + AVIONICS ON: ${ids.map((i) => `${i}=${v.get(`elec.${i}_powered`)}`).join(' ')} CAS: ${cas(r)}`);
    v.set(M2.battSw, 1);
    r.run(2);
    // System tests.
    for (const [name, pos] of Object.entries(TEST_SEL)) {
      if (pos === 0) continue;
      v.set(M2.testSel, pos);
      r.run(2.5);
      log(`CP TEST ${name}: fireLt=${v.get(M2.engFireLight(1))}/${v.get(M2.engFireLight(2))} bottleLt=${v.get(M2.bottleLight(1))}/${v.get(M2.bottleLight(2))} MW=${v.get('alert.master_warning')} MC=${v.get('alert.master_caution')} shaker=${v.get('alert.stick_shaker')} clacker=${v.get('alert.overspeed') ?? '-'} horn=${v.get('gear.horn')} green=${v.get('gear.green0')} red=${v.get('gear.red0')} taws=${v.get('taws.test_active') ?? '-'} startLt=${v.get(M2.startLight(1))} lampTest=${v.get('cas.lamp_test') ?? '-'} CAS: ${cas(r)}`);
    }
    v.set(M2.testSel, 0);
    r.run(1);
    log(`CP [Cockpit preparation] after flow: ${audit(r, 'Cockpit preparation')}`);
    log(`CP fuel L/R lb ${(v.get('fuel.tank0_kg') * 2.2046).toFixed(0)}/${(v.get('fuel.tank1_kg') * 2.2046).toFixed(0)} oxy ${v.get('oxy.main_psi').toFixed(0)} psi`);

    // Before starting engines.
    for (const i of [1, 2]) v.set(M2.genSw(i), 1);
    v.set(M2.antiColl, 1);
    v.set(M2.paxSafety, 2);
    r.run(2);
    log(`BS [Before starting engines]: ${audit(r, 'Before starting engines')} beaconLight=${v.get('light.beacon') ?? '-'}`);

    // Start R.
    press(r, M2.startBtn(2), 0.3);
    let n2At8 = -1;
    let t = 0;
    r.run(20, () => {
      t += 1 / 60;
      if (n2At8 < 0 && v.get('eng2.n2_pct') >= 8) n2At8 = t;
      return n2At8 >= 0;
    });
    log(`ST R START pressed: startLt=${v.get(M2.startLight(2))} state=${v.get('fadec.eng2.start_state')} n2 reached 8% at ${n2At8.toFixed(1)} s boostR=${v.get('fuel.boost_r_on')} ign=${v.get('eng2.ignition')} CAS: ${cas(r)} [Starting engines] ${audit(r, 'Starting engines')}`);
    v.set(M2.tla(2), TLA.idle);
    let ittRise = -1;
    const itt0 = v.get('eng2.itt_c');
    let peak = 0;
    let idleAt = -1;
    t = 0;
    let genAt = -1;
    r.run(60, () => {
      t += 1 / 60;
      const itt = v.get('eng2.itt_c');
      peak = Math.max(peak, itt);
      if (ittRise < 0 && itt > itt0 + 50) ittRise = t;
      if (genAt < 0 && v.get('elec.sg2_online')) genAt = t;
      if (idleAt < 0 && v.get('fadec.eng2.start_state') === 4) idleAt = t;
    });
    log(`ST R idle: ITT rise (+50 C) ${ittRise.toFixed(1)} s after IDLE, peak ${peak.toFixed(0)} C, run state at ${idleAt.toFixed(1)} s, gen online ${genAt.toFixed(1)} s; n1 ${v.get('eng2.n1_pct').toFixed(1)} n2 ${v.get('eng2.n2_pct').toFixed(1)} itt ${v.get('eng2.itt_c').toFixed(0)} oil ${v.get('eng2.oil_press_psi').toFixed(0)} startLt=${v.get(M2.startLight(2))} CAS: ${cas(r)}`);
    // Start L.
    press(r, M2.startBtn(1), 0.3);
    r.run(20, () => v.get('eng1.n2_pct') >= 8);
    v.set(M2.tla(1), TLA.idle);
    r.run(60);
    log(`ST L idle: n2 ${v.get('eng1.n2_pct').toFixed(1)} oil ${v.get('eng1.oil_press_psi').toFixed(0)} gens ${v.get('elec.sg1_online')}/${v.get('elec.sg2_online')} CAS: ${cas(r)} [Starting engines] ${audit(r, 'Starting engines')}`);

    // After-start electrical check (CJ-family AFM Starting Engines step 10 / M2 flows ELECTRICAL CHECK).
    const amps = () => `L ${v.get('elec.sg1_amps').toFixed(0)} A R ${v.get('elec.sg2_amps').toFixed(0)} A bus ${v.get('elec.batt_bus_v').toFixed(2)} V batt ${v.get('elec.batt_amps').toFixed(0)} A`;
    log(`EC both gens: ${amps()}`);
    v.set(M2.genSw(1), 0);
    r.run(3);
    log(`EC L GEN OFF: ${amps()} CAS: ${cas(r)}`);
    v.set(M2.genSw(2), 0);
    r.run(3);
    log(`EC both GEN OFF: ${amps()} CAS: ${cas(r)}`);
    v.set(M2.genSw(1), 1);
    r.run(3);
    v.set(M2.genSw(2), 1);
    r.run(3);
    log(`EC both GEN back: ${amps()} CAS: ${cas(r)}`);
    v.set(M2.battSw, 0);
    r.run(3);
    log(`EC BATTERY OFF with gens: ${amps()} pfd1=${v.get('elec.pfd1_powered')} mfd=${v.get('elec.mfd_powered')} emer=${v.get('elec.emer_powered')} CAS: ${cas(r)}`);
    v.set(M2.battSw, 1);
    r.run(5);
    log(`EC BATTERY BATT: ${amps()} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('before taxi / taxi / before takeoff checks from ready_to_taxi', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2400 });
    const v = r.vars;
    r.run(3);
    log(`BT preset [Before taxi] ${audit(r, 'Before taxi')}`);
    // Ground flaps check (CJ-family AFM Before Taxi 7a-d).
    v.set(M2.flapHandle, 3);
    r.run(20);
    log(`GF flaps GND idle: flaps ${v.get('surf.flaps_deg').toFixed(1)} sb ${v.get('surf.speedbrake').toFixed(2)} CAS: ${cas(r)}`);
    v.set(M2.parkBrake, 1);
    v.set(M2.tla(1), 0.9);
    v.set(M2.tla(2), 0.9);
    r.run(15);
    log(`GF flaps GND + throttles 0.9: n2 ${v.get('eng1.n2_pct').toFixed(1)} sb ${v.get('surf.speedbrake').toFixed(2)} MW ${v.get('alert.master_warning')} MC ${v.get('alert.master_caution')} tocw ${v.get('alert.takeoff_config')} tocwText ${v.getString('tocw.text')} CAS: ${cas(r)}`);
    v.set(M2.tla(1), 0);
    v.set(M2.tla(2), 0);
    r.run(10);
    log(`GF throttles idle again: sb ${v.get('surf.speedbrake').toFixed(2)} CAS: ${cas(r)}`);
    v.set(M2.flapHandle, 1);
    r.run(20);
    log(`GF flaps 15: flaps ${v.get('surf.flaps_deg').toFixed(1)} sb ${v.get('surf.speedbrake').toFixed(2)} CAS: ${cas(r)}`);
    // Electric trim check: trim NU, press AP/TRIM DISC (held) -> real: trim stops.
    const t0 = v.get(M2.pitchTrim);
    v.set(M2.yokeTrim(1), 1);
    r.run(1);
    const t1 = v.get(M2.pitchTrim);
    r.events.emit('ap.disc');
    r.run(1);
    const t2 = v.get(M2.pitchTrim);
    v.set(M2.yokeTrim(1), 0);
    log(`TRIM electric NU 1 s ${t0.toFixed(3)}->${t1.toFixed(3)}, then AP/TRIM DISC pressed, still moving? ${t1.toFixed(3)}->${t2.toFixed(3)}; to_ok ${v.get('trim.pitch_to_ok')}`);
    // AP disconnect test on the ground.
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const apOn = v.get('ap.engaged');
    r.events.emit('ap.disc');
    r.run(0.5);
    log(`APDISC ground: AP engaged after key ${apOn}, after disc ${v.get('ap.engaged')} MW ${v.get('alert.master_warning')} CAS: ${cas(r)}`);
    // Pressurization: landing field elevation entry (GTC) on the ground.
    log(`PRESS ground: ldg_elev ${v.get('press.ldg_elev_ft').toFixed(0)} src ${v.get(M2.pressSource)} cabin ${v.get('press.cabin_alt_ft').toFixed(0)} dp ${v.get('press.diff_psi').toFixed(3)}`);
    // Anti-skid switched on while stationary: self-test? (CJ AFM note)
    v.set(M2.antiskidSw, 0);
    r.run(1);
    log(`ANTISKID OFF: CAS ${cas(r)}`);
    v.set(M2.antiskidSw, 1);
    r.run(3);
    log(`ANTISKID ON: CAS ${cas(r)}`);
    // Before takeoff flow.
    v.set(M2.pitotStaticSw, 1);
    v.set(M2.landingLt, 2);
    v.set(M2.antiColl, 2);
    v.set(M2.parkBrake, 0);
    r.run(3);
    log(`BTO [Before takeoff] ${audit(r, 'Before takeoff')} CAS: ${cas(r)}`);
    // Ice protection check on the ground: ENG + WING anti-ice at ~70-75 % N2.
    v.set(M2.parkBrake, 1);
    v.set(M2.tla(1), 0.55);
    v.set(M2.tla(2), 0.55);
    r.run(8);
    v.set(M2.engAiSw(1), 1);
    v.set(M2.engAiSw(2), 1);
    v.set(M2.engAiSw(1), 2);
    v.set(M2.engAiSw(2), 2);
    v.set(M2.tailDeiceSw, 1);
    let seen = '';
    r.run(70, () => {
      const c = cas(r);
      if (c.includes('A/I') || c.includes('DEICE') || c.includes('ANTI')) seen = c;
    });
    log(`ICE check n2 ${v.get('eng1.n2_pct').toFixed(1)}: CAS seen during 70 s: ${seen || '(none)'} now: ${cas(r)} ign ${v.get('eng1.ignition')}/${v.get('eng2.ignition')} ice.tail_boots ${v.get('ice.tail_boots')}`);
    expect(true).toBe(true);
  });

  it('approach / before landing / after landing / shutdown', () => {
    const r = makeM2({ state: 'approach', fuelLb: 2400, air: { altFtMsl: 3000, iasKt: 140 } });
    const v = r.vars;
    r.run(3);
    log(`APP preset [Descent / approach] ${audit(r, 'Descent / approach')} [Before landing] ${audit(r, 'Before landing')} ign ${v.get('eng1.ignition')}/${v.get('eng2.ignition')} CAS: ${cas(r)}`);
    // Cruise preset items.
    const c = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 35000, iasKt: 240 } });
    c.run(3);
    log(`CRZ preset [Cruise] ${audit(c, 'Cruise')} [Takeoff / climb] ${audit(c, 'Takeoff / climb')} tla ${c.vars.get(M2.tla(1)).toFixed(3)} (CRU ${TLA.cru}) baro_std ${c.vars.get('adc1.baro_std')} ldg ${c.vars.get('press.ldg_elev_ft').toFixed(0)}`);
    // After landing / shutdown from ready_to_taxi.
    const g = makeM2({ state: 'ready_to_taxi', fuelLb: 2400 });
    const w = g.vars;
    g.run(3);
    w.set(M2.pitotStaticSw, 0);
    w.set(M2.landingLt, 0);
    w.set(M2.antiColl, 1);
    g.run(1);
    log(`AL [After landing] ${audit(g, 'After landing')}`);
    // Shutdown in the checklist order.
    w.set(M2.parkBrake, 1);
    g.run(1);
    log(`SD avionics OFF: pfd1 ${w.get('elec.pfd1_powered')} mfd ${w.get('elec.mfd_powered')} esi ${w.get(M2.esiPowered)} gtc1 ${w.get('elec.gtc1_powered')}`);
    w.set(M2.tla(1), TLA.cutoff);
    w.set(M2.tla(2), TLA.cutoff);
    g.run(40);
    log(`SD throttles CUTOFF 40 s: n2 ${w.get('eng1.n2_pct').toFixed(1)}/${w.get('eng2.n2_pct').toFixed(1)} boost ${w.get('fuel.boost_l_on')}/${w.get('fuel.boost_r_on')} CAS: ${cas(g)}`);
    w.set(M2.navLt, 0);
    w.set(M2.antiColl, 0);
    w.set(M2.taxiLt, 0);
    w.set(M2.paxSafety, 0);
    w.set(M2.battSw, 0);
    w.set(M2.controlLock, 1);
    g.run(5);
    log(`SD complete [Shutdown] ${audit(g, 'Shutdown')} emer ${w.get('elec.emer_powered')} batt_bus ${w.get('elec.batt_bus_powered')} esi ${w.get(M2.esiPowered)} esi_on_batt ${w.get('ac.m2.esi_on_batt')} cabin_lt ${w.get(M2.cabinLt)} air_cond ${w.get(M2.airCondSw)} gens ${w.get(M2.genSw(1))}/${w.get(M2.genSw(2))} CAS: ${cas(g)}`);
    g.run(600);
    log(`SD +10 min: esi ${w.get(M2.esiPowered)} esi_on_batt ${w.get('ac.m2.esi_on_batt')}`);
    expect(true).toBe(true);
  });

  it('engine fire (CJ-family AFM order) and single-generator in flight', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(3);
    r.events.emit('fail.trigger', 'fire.eng2');
    r.run(3);
    log(`FIRE R: warn CAS: ${cas(r)} fireLt ${v.get(M2.engFireLight(2))} bottleLt ${v.get(M2.bottleLight(1))}/${v.get(M2.bottleLight(2))}`);
    v.set(M2.tla(2), TLA.idle); // step 1 throttle IDLE
    r.run(2);
    v.set(M2.engFireBtn(2), 1); // step 2 ENG FIRE push
    r.run(2);
    log(`FIRE R pushed: bottleLt ${v.get(M2.bottleLight(1))}/${v.get(M2.bottleLight(2))} gen2 ${v.get('elec.sg2_online')} fwR ${v.get('fuel.fw_r_open') ?? '-'} n2 ${v.get('eng2.n2_pct').toFixed(1)} CAS: ${cas(r)}`);
    press(r, M2.bottleBtn(1), 0.3); // step 3 BOTTLE ARMED push
    r.run(5);
    log(`FIRE R bottle 1: b1 ${v.get('fire.b1_discharged')} warn ${v.get('fire.eng2_warn')} bottleLt ${v.get(M2.bottleLight(1))}/${v.get(M2.bottleLight(2))} CAS: ${cas(r)}`);
    v.set(M2.tla(2), TLA.cutoff); // step 5 throttle OFF
    r.run(20);
    log(`FIRE R throttle OFF: n2 ${v.get('eng2.n2_pct').toFixed(1)} boostR ${v.get('fuel.boost_r_on')} air_cond load ${v.get('elec.air_cond_powered')} cabin_lts ${v.get('elec.cabin_lts_powered')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });
});
