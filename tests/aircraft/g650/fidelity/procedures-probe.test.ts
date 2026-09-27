/**
 * PROCEDURES fidelity probe (read-only audit helper): executes the G650 normal checklists (checklists.ts)
 * headlessly through the cockpit control vars, in the order the lists give, and prints what each item's
 * auto-check and the systems do. It also samples every checklist's auto-checks in each initial state and runs
 * the abnormal lists against injected failures. Nothing here asserts aircraft behaviour (the audit reads the
 * log), except that the rig runs. Run with:
 *   npx vitest run tests/aircraft/g650/fidelity/procedures-probe.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { G650_CHECKLISTS } from '../../../../src/aircraft/g650/checklists';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import type { InitialState } from '../../../../src/aircraft/types';
import { makeRig, posted, press, type Rig } from '../helpers';

const OUT: string[] = [];
const log = (s: string) => OUT.push(s);

function evalList(r: Rig, title: string): string {
  const l = G650_CHECKLISTS.find((c) => c.title === title)!;
  return l.items
    .map((it, i) => {
      if (!it.check) return `${i + 1}.${it.challenge}=manual`;
      let ok = false;
      try {
        ok = it.check(r.vars);
      } catch {
        ok = false;
      }
      return `${i + 1}.${it.challenge}=${ok ? 'OK' : 'NOT MET'}`;
    })
    .join(' | ');
}

function cas(r: Rig): string {
  return posted(r).join(', ');
}

const KEYS: [string, string][] = [
  ['battL', V.battL], ['ebha', V.ebhaBatt], ['ups', V.upsBatt], ['emerPwr', V.emerPwr], ['ltEmer', V.ltEmer],
  ['boostL', V.boostL], ['altL', V.altL], ['aux', V.auxPump], ['ptu', V.ptu], ['bleedL', V.bleedL], ['bleedApu', V.bleedApu],
  ['iso', V.isolation], ['packL', V.packL], ['wingL', V.wingL], ['cowlL', V.cowlL], ['probe1', V.probe(1)], ['wshldL', V.wshldL],
  ['cabinWdo', V.cabinWdo], ['evsWdo', V.evsWdo], ['crewOxy', V.crewOxy], ['paxOxy', V.paxOxy], ['pressMode', V.pressMode],
  ['fltLdg', V.fltLdg], ['park', V.parkBrake], ['fuelCtlL', V.fuelCtlL], ['nav', V.ltNav], ['beacon', V.ltBeacon],
  ['strobe', V.ltStrobe], ['ldgL', V.ltLdgL], ['taxi', V.ltTaxi], ['seatBelt', V.seatBelt], ['noSmoke', V.noSmoke],
  ['gndSpl', V.gndSpoiler], ['flapLever', V.flapLever], ['autobrake', V.autobrake], ['nws', V.nwsPower], ['irs1', V.irsMode(1)],
  ['cabinMaster', V.cabinMaster], ['galley', V.galleyMaster], ['apuMaster', V.apuMaster], ['contIgn', V.contIgn], ['doorMain', V.doorMain],
];
const switches = (r: Rig) => KEYS.map(([k, n]) => `${k}=${r.vars.get(n)}`).join(' ');

describe('G650 procedures probe', () => {
  it('samples every checklist in every initial state', () => {
    const states: InitialState[] = ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'];
    for (const s of states) {
      const r = makeRig(s, s === 'cruise' ? { air: { altFtMsl: 41000, iasKt: 250 } } : s === 'approach' ? { air: { altFtMsl: 2500, iasKt: 160 } } : {});
      r.run(2);
      log(`=== STATE ${s}: ${switches(r)}`);
      log(`  CAS: ${cas(r)}`);
      for (const c of G650_CHECKLISTS.filter((x) => x.phase === 'Normal')) log(`  [${c.title}] ${evalList(r, c.title)}`);
    }
    expect(OUT.length).toBeGreaterThan(0);
  });

  it('executes the normal checklists in list order from cold & dark', () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(1);
    log('=== FLOW cold & dark -> Before Starting Engines in checklist order');
    v.set(V.doorMain, 0);
    // 1 MAIN BATTERIES
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(3);
    log(`  batt ON: L batt bus ${v.get('elec.l_batt_bus_v').toFixed(1)} V, L ESS ${v.get('elec.l_ess_dc_v').toFixed(1)} V | CAS ${cas(r)}`);
    // 2 FLT CTRL BATTERIES
    v.set(V.ebhaBatt, 1);
    v.set(V.upsBatt, 1);
    r.run(2);
    const spost = [...v.keys()].filter((n) => /spost|pbit/i.test(n));
    log(`  FLT CTRL BATT ON: SPOST/PBIT vars: ${spost.join(',') || 'none'} | fcsBatt ${v.get(V.fcsBatt)} | CAS ${cas(r)}`);
    // 3 EMERGENCY POWER ARM, 4 EMER LTS ARM
    v.set(V.emerPwr, 1);
    v.set(V.ltEmer, 1);
    r.run(2);
    log(`  EMER PWR ARM: ebattOn ${v.get(V.ebattOn)} | CAS ${cas(r)}`);
    // 5 IRS ON
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    r.run(2);
    // 6 APU (fuel pumps still OFF: they are item 10 of our list)
    v.set(V.apuMaster, 1);
    r.run(14);
    log(`  APU MASTER ON (boost pumps OFF): apu.state ${v.get('apu.state')} ready ${v.get('apu.ready')} fuel.apu_on ${v.get('fuel.apu_on')} l_man psi ${v.get('fuel.l_man_psi')}`);
    press(r, V.apuStart, 0.5);
    let apuOnline = NaN;
    r.run(90, (t) => {
      if (isNaN(apuOnline) && v.get('elec.apu_gen_online') === 1) apuOnline = t;
      return !isNaN(apuOnline);
    });
    log(`  APU START with boost pumps OFF: gen online at ${apuOnline} s, apu.n ${v.get('apu.n_pct').toFixed(0)} %, apu.state ${v.get('apu.state')}, apu.avail ${v.get('apu.avail')} | CAS ${cas(r)}`);
    if (isNaN(apuOnline)) {
      // retry with the pumps on (the real APU start flow: L MAIN boost pump ON first)
      for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
      v.set(V.apuMaster, 0);
      r.run(5);
      v.set(V.apuMaster, 1);
      r.run(14);
      press(r, V.apuStart, 0.5);
      r.run(90, (t) => {
        if (isNaN(apuOnline) && v.get('elec.apu_gen_online') === 1) apuOnline = t;
        return !isNaN(apuOnline);
      });
      log(`  APU retry with boost pumps ON: gen online at ${apuOnline} s`);
    }
    // 7..21 rest of Before Starting Engines
    v.set(V.busTieL, 1);
    v.set(V.busTieR, 1);
    for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
    v.set(V.xflow, 0);
    v.set(V.interTank, 0);
    v.set(V.auxPump, 1);
    v.set(V.ptu, 1);
    v.set(V.bleedL, 0);
    v.set(V.bleedR, 0);
    v.set(V.isolation, 1);
    v.set(V.wshldL, 1);
    v.set(V.wshldR, 1);
    v.set(V.crewOxy, 1);
    v.set(V.paxOxy, 1);
    v.set(V.pressMode, 0);
    v.set(V.parkBrake, 1);
    v.set(V.ltBeacon, 1);
    r.run(2);
    log(`  [Before Starting Engines] ${evalList(r, 'Before Starting Engines')}`);
    log(`  CAS: ${cas(r)}`);
    // Starting Engines
    v.set(V.bleedApu, 1);
    let bleedT = NaN;
    r.run(120, (t) => {
      if (isNaN(bleedT) && v.get('pneu.apu_bleed_valve_open') === 1) bleedT = t;
      return !isNaN(bleedT) && t > bleedT + 2;
    });
    log(`  APU BLEED ON: LCV open after ${bleedT.toFixed(1)} s; l duct ${v.get('pneu.l_duct_psi').toFixed(1)} psi r duct ${v.get('pneu.r_duct_psi').toFixed(1)} psi iso ${v.get('pneu.iso_open')}`);
    v.set(V.startMaster, 1);
    r.run(4);
    log(`  START MASTER ON: iso ${v.get('pneu.iso_open')} l duct ${v.get('pneu.l_duct_psi').toFixed(1)} r duct ${v.get('pneu.r_duct_psi').toFixed(1)} packL cmd ${v.get(V.packLCmd)} packR cmd ${v.get(V.packRCmd)} | residual TGT R ${v.get('eng2.itt_c').toFixed(0)} C`);
    log(`  [Starting Engines] after START MASTER: ${evalList(r, 'Starting Engines')}`);
    for (const [i, fc, st] of [[2, V.fuelCtlR, V.startR], [1, V.fuelCtlL, V.startL]] as const) {
      press(r, st, 0.5);
      r.run(3);
      const n2AtRun = v.get(`eng${i}.n2_pct`);
      v.set(fc, 1);
      let peak = 0;
      const t = r.run(90, () => {
        peak = Math.max(peak, v.get(`eng${i}.itt_c`));
        return v.getString(`fadec.eng${i}.start_status`) === 'RUN';
      });
      log(`  eng${i}: FUEL CONTROL RUN at N2 ${n2AtRun.toFixed(1)} %, RUN after ${t.toFixed(0)} s, peak TGT ${peak.toFixed(0)} C, idle N2 ${v.get(`eng${i}.n2_pct`).toFixed(1)} oil ${v.get(`eng${i}.oil_press_psi`).toFixed(0)} psi / ${v.get(`eng${i}.oil_temp_c`).toFixed(0)} C | hyd L ${v.get('hyd.left_psi').toFixed(0)} R ${v.get('hyd.right_psi').toFixed(0)} ptu ${v.get('hyd.ptu_active')}`);
      log(`   CAS: ${cas(r)}`);
    }
    v.set(V.startMaster, 0);
    r.run(2);
    log(`  [Starting Engines] ${evalList(r, 'Starting Engines')}`);
    // After Starting Engines
    v.set(V.bleedL, 1);
    v.set(V.bleedR, 1);
    v.set(V.bleedApu, 0);
    for (const n of [1, 2, 3, 4] as const) v.set(V.probe(n), 1);
    v.set(V.nwsPower, 1);
    r.run(10);
    log(`  [After Starting Engines] ${evalList(r, 'After Starting Engines')}`);
    log(`  CAS after start (IRS aligning): ${cas(r)} | fbw.mode ${v.get('fbw.mode_code')}`);
    v.set(V.apuMaster, 0);
    r.run(30);
    // Before Taxi (IRS may still be aligning)
    log(`  [Before Taxi] before IRS aligned: ${evalList(r, 'Before Taxi')}`);
    let alignT = NaN;
    r.run(900, (t) => {
      if (v.get('ahrs1.valid') === 1 && v.get('ahrs2.valid') === 1 && v.get('ahrs3.valid') === 1) alignT = t;
      return !isNaN(alignT);
    });
    log(`  IRS aligned after further ${alignT.toFixed(0)} s | CAS ${cas(r)} | fbw.mode ${v.get('fbw.mode_code')}`);
    v.set(V.flapLever, 2);
    v.set(V.gndSpoiler, 1);
    v.set(V.autobrake, -1);
    v.set(V.ltTaxi, 1);
    r.run(25);
    log(`  [Before Taxi] ${evalList(r, 'Before Taxi')}`);
    // Before Takeoff
    v.set(V.parkBrake, 0);
    v.set(V.ltStrobe, 1);
    v.set(V.ltLdgL, 1);
    v.set(V.ltLdgR, 1);
    r.run(2);
    log(`  [Before Takeoff] ${evalList(r, 'Before Takeoff')}`);
    log(`  CAS before takeoff: ${cas(r)}`);
    // Shutdown flow, strictly as our Shutdown checklist lists it (parking brake, FUEL CONTROL OFF, BEACON OFF, IRS OFF,
    // EMERGENCY POWER OFF, MAIN BATTERIES OFF), everything else left where the flow put it.
    v.set(V.parkBrake, 1);
    v.set(V.ltStrobe, 0);
    v.set(V.ltLdgL, 0);
    v.set(V.ltLdgR, 0);
    v.set(V.ltTaxi, 0);
    r.run(3);
    v.set(V.fuelCtlL, 0);
    v.set(V.fuelCtlR, 0);
    r.run(60);
    log(`  engines off (APU off): CAS ${cas(r)}`);
    v.set(V.ltBeacon, 0);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
    v.set(V.emerPwr, 0);
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(10);
    log(`  [Shutdown] ${evalList(r, 'Shutdown')}`);
    const live = [...v.keys()].filter((n) => /^elec\..*_powered$/.test(n) && v.get(n) === 1);
    log(`  after our Shutdown list: still-powered loads: ${live.join(',') || 'none'}`);
    log(`  switches left: ${switches(r)}`);
    log(`  EBHA batt A ${v.get('elec.ebha_batt_amps').toFixed(1)} UPS A ${v.get('elec.ups_batt_amps').toFixed(1)} fcsBatt ${v.get(V.fcsBatt)} fbw.powered? fcc1a ${v.get('elec.fcc1a_powered')}`);
    r.run(60);
    log(`  +60 s: EBHA soc ${v.get('elec.ebha_batt_soc')} UPS soc ${v.get('elec.ups_batt_soc')} CAS ${cas(r)}`);
  });

  it('abnormal / emergency lists against injected failures', () => {
    // ---- L Engine Fire on the ground, engines running
    {
      const r = makeRig('ready_to_taxi');
      const v = r.vars;
      r.run(2);
      r.sys.failures.trigger('fire.eng1');
      r.run(3);
      log(`=== L ENGINE FIRE: CAS ${cas(r)} | master warning ${v.get('alert.master_warning')} | fuelCtl fire light vars: ${[...v.keys()].filter((n) => /fuel_ctl.*(light|fire|lt)/i.test(n)).join(',') || 'none'}`);
      log(`  [L Engine Fire] before actions: ${evalList(r, 'L Engine Fire')}`);
      v.set(V.tla(1), 0);
      v.set(V.fuelCtlL, 0);
      r.run(1);
      v.set(V.fireHandleL, 1);
      r.run(1);
      log(`  handle pulled: idg1 ${v.get('elec.idg1_online')} bleed L valve ${v.get('pneu.bleed_l_valve_open')} hyd L ${v.get('hyd.left_psi').toFixed(0)} | CAS ${cas(r)}`);
      v.set(V.fireDischL, 1);
      r.run(0.5);
      v.set(V.fireDischL, 0);
      r.run(5);
      log(`  shot 1: bottle R disch ${v.get('fire.bottle_r_discharged')} bottle L ${v.get('fire.bottle_l_discharged')} fire warn ${v.get('fire.eng1_warn')} | [L Engine Fire] ${evalList(r, 'L Engine Fire')}`);
      r.sys.failures.clear('fire.eng1');
      r.run(3);
      log(`  fire out: CAS ${cas(r)}`);
    }
    // ---- APU Fire on the ground
    {
      const r = makeRig('ready_to_taxi');
      const v = r.vars;
      v.set(V.apuMaster, 1);
      r.run(14);
      press(r, V.apuStart, 0.5);
      r.run(80, () => v.get('apu.avail') === 1);
      r.sys.failures.trigger('fire.apu');
      r.run(5);
      log(`=== APU FIRE (ground): apu.state ${v.get('apu.state')} n ${v.get('apu.n_pct').toFixed(0)} | CAS ${cas(r)} | auto-extinguish L bottle ${v.get('fire.bottle_l_discharged')}`);
      log(`  [APU Fire] before actions: ${evalList(r, 'APU Fire')}`);
      v.set(V.apuMaster, 0);
      v.set(V.apuFireExtGuard, 1);
      press(r, V.apuFireExt, 0.5);
      r.run(3);
      log(`  after actions: [APU Fire] ${evalList(r, 'APU Fire')} | CAS ${cas(r)}`);
    }
    // ---- L Generator Fail in cruise
    {
      const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
      const v = r.vars;
      r.run(2);
      const ids = r.sys.failures.list().map((f) => f.id);
      log(`=== FAILURE IDS: ${ids.join(',')}`);
      const genFail = ids.find((i) => /idg1|gen.*1|gen_l/i.test(i));
      if (genFail) r.sys.failures.trigger(genFail);
      r.run(5);
      log(`=== L GEN FAIL (${genFail}): CAS ${cas(r)} | [L Generator Fail] ${evalList(r, 'L Generator Fail')}`);
      v.set(V.genL, 0);
      r.run(1);
      v.set(V.genL, 1);
      r.run(3);
      log(`  GEN OFF->ON: idg1 ${v.get('elec.idg1_online')} | CAS ${cas(r)}`);
    }
    // ---- L Hyd System Fail (EDP) in cruise
    {
      const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
      const v = r.vars;
      r.run(2);
      const ids = r.sys.failures.list().map((f) => f.id);
      const edp = ids.find((i) => /edp_l/.test(i));
      const leak = ids.find((i) => /left.*leak|leak.*left/.test(i));
      if (edp) r.sys.failures.trigger(edp);
      r.run(20);
      log(`=== L EDP FAIL (${edp}): L ${v.get('hyd.left_psi').toFixed(0)} psi ptu ${v.get('hyd.ptu_active')} | CAS ${cas(r)} | [L Hyd System Fail] ${evalList(r, 'L Hyd System Fail')}`);
      if (leak) {
        r.sys.failures.trigger(leak);
        r.run(300);
        log(`  + L leak (${leak}) 300 s: L qty ${v.get('hyd.left_qty').toFixed(2)} L ${v.get('hyd.left_psi').toFixed(0)} psi | CAS ${cas(r)}`);
      }
    }
    // ---- Cabin Pressure Low (DUMP selected at FL410)
    {
      const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
      const v = r.vars;
      r.run(2);
      v.set(V.pressDump, 1);
      r.run(120, () => v.get('press.cabin_alt_ft') > 9000);
      r.run(3);
      log(`=== CABIN PRESS LOW: cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ft | CAS ${cas(r)} | [Cabin Pressure Low] ${evalList(r, 'Cabin Pressure Low')}`);
      v.set(V.oxyMaskL, 1);
      v.set(V.oxyMaskR, 1);
      v.set(V.paxOxy, 2);
      r.run(2);
      log(`  masks on at N (mode ${v.get(V.oxyMaskMode)}): [Cabin Pressure Low] ${evalList(r, 'Cabin Pressure Low')}`);
    }
    // ---- NWS POWER OFF / ground spoiler OFF in cruise / FCC during alignment
    {
      const r = makeRig('ready_to_taxi');
      const v = r.vars;
      r.run(2);
      v.set(V.nwsPower, 0);
      r.run(3);
      log(`=== NWS POWER OFF: CAS ${cas(r)}`);
    }
    {
      const r = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
      const v = r.vars;
      r.run(2);
      log(`=== CRUISE state gndSpoiler=${v.get(V.gndSpoiler)} | CAS ${cas(r)}`);
      v.set(V.gndSpoiler, 0);
      r.run(2);
      log(`  GND SPLR OFF in cruise: CAS ${cas(r)}`);
    }
    writeFileSync('/tmp/claude-0/g650-procedures-probe.txt', OUT.join('\n'));
    expect(OUT.length).toBeGreaterThan(0);
  });
  it('targeted probes: FCS batteries, APU/bleed, start, alignment CAS, IRS ON BAT, takeoff config', () => {
    const L: string[] = [];
    // ---- FCS batteries alone (main batteries OFF)
    {
      const r = makeRig('cold_dark');
      const v = r.vars;
      v.set(V.ebhaBatt, 1);
      v.set(V.upsBatt, 1);
      r.run(3);
      const live = [...v.keys()].filter((n) => /^elec\..*_powered$/.test(n) && v.get(n) === 1);
      L.push(`=== EBHA+UPS ON only (main batteries OFF): L ESS DC ${v.get('elec.l_ess_dc_v').toFixed(1)} V powered ${v.get('elec.l_ess_dc_powered')}, du1 ${v.get('elec.du1_powered')}, loads powered ${live.length}: ${live.slice(0, 25).join(',')}`);
      L.push(`  EBHA A ${v.get('elec.ebha_batt_amps').toFixed(1)} UPS A ${v.get('elec.ups_batt_amps').toFixed(1)} | CAS ${cas(r)}`);
    }
    // ---- main batteries + EMERGENCY POWER ON (G450 APU start flow) then ARM
    {
      const r = makeRig('cold_dark');
      const v = r.vars;
      v.set(V.emerPwr, 2);
      r.run(2);
      L.push(`=== EMER PWR ON only: emer_dc ${v.get('elec.emer_dc_powered')} du1 ${v.get('elec.du1_powered')} smc1 ${v.get('elec.smc1_powered')} mcdu1 ${v.get('elec.mcdu1_powered')} | CAS ${cas(r)}`);
      v.set(V.battL, 1);
      v.set(V.battR, 1);
      r.run(2);
      L.push(`  + batteries: L ESS ${v.get('elec.l_ess_dc_v').toFixed(1)} V, L batt A ${v.get('elec.l_batt_amps')?.toFixed?.(1)} | batt legend discharging var? | CAS ${cas(r)}`);
      // APU with pumps ON, APU start dip
      for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
      v.set(V.apuMaster, 1);
      let readyT = NaN;
      r.run(30, (t) => {
        if (isNaN(readyT) && v.get('apu.state') === 1 && v.get('apu.door_open') === 1) readyT = t;
        return !isNaN(readyT);
      });
      press(r, V.apuStart, 0.5);
      let minV = 99;
      let onT = NaN;
      r.run(90, (t) => {
        minV = Math.min(minV, v.get('elec.l_ess_dc_v'));
        if (isNaN(onT) && v.get('elec.apu_gen_online') === 1) onT = t;
        return !isNaN(onT);
      });
      L.push(`  APU (pumps ON): door/READY at ${readyT.toFixed(1)} s, gen on line ${onT.toFixed(1)} s after START, min L ESS ${minV.toFixed(1)} V, ebatt ${v.get(V.ebattOn)} | CAS ${cas(r)}`);
      v.set(V.emerPwr, 1);
      v.set(V.bleedApu, 1);
      let lcvT = NaN;
      r.run(120, (t) => {
        if (isNaN(lcvT) && v.get('pneu.apu_bleed_valve_open') === 1) lcvT = t;
        return !isNaN(lcvT) && t > lcvT + 3;
      });
      L.push(`  APU BLEED: LCV open after ${lcvT.toFixed(0)} s; ducts L ${v.get('pneu.l_duct_psi').toFixed(1)} R ${v.get('pneu.r_duct_psi').toFixed(1)} psi, iso ${v.get('pneu.iso_open')} (iso switch AUTO), packs L ${v.get(V.packLCmd)} R ${v.get(V.packRCmd)}`);
      v.set(V.startMaster, 1);
      r.run(4);
      L.push(`  START MASTER: ducts L ${v.get('pneu.l_duct_psi').toFixed(1)} R ${v.get('pneu.r_duct_psi').toFixed(1)} psi iso ${v.get('pneu.iso_open')} packs L ${v.get(V.packLCmd)} R ${v.get(V.packRCmd)}`);
      // start button without FUEL CONTROL: motoring, then FUEL CONTROL RUN immediately (G650 flow)
      press(r, V.startR, 0.5);
      const trace: string[] = [];
      let k = 0;
      r.run(0.2);
      v.set(V.fuelCtlR, 1);
      const t = r.run(90, () => {
        if (k++ % 120 === 0) trace.push(`N2 ${v.get('eng2.n2_pct').toFixed(0)} TGT ${v.get('eng2.itt_c').toFixed(0)} ign ${v.get('fadec.eng2.ign')} starter ${v.get('fadec.eng2.starter_cmd')} duct ${v.get('pneu.r_duct_psi').toFixed(0)} pkL ${v.get(V.packLCmd)}`);
        return v.getString('fadec.eng2.start_status') === 'RUN';
      });
      L.push(`  R start (FUEL CONTROL RUN right after START): RUN after ${t.toFixed(0)} s, idle N2 ${v.get('eng2.n2_pct').toFixed(1)} N1 ${v.get('eng2.n1_pct').toFixed(1)} TGT ${v.get('eng2.itt_c').toFixed(0)} oil ${v.get('eng2.oil_press_psi').toFixed(0)} psi ${v.get('eng2.oil_temp_c').toFixed(0)} C | R hyd ${v.get('hyd.right_psi').toFixed(0)} L hyd ${v.get('hyd.left_psi').toFixed(0)} PTU ${v.get('hyd.ptu_active')}`);
      L.push(`   trace: ${trace.join(' / ')}`);
      L.push(`   CAS: ${cas(r)} | fbw.mode ${v.get('fbw.mode_code')}`);
      // IRS alignment CAS with an engine running
      for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
      r.run(5);
      L.push(`  IRS ON with R engine running (aligning): CAS ${cas(r)} | fbw.mode ${v.get('fbw.mode_code')}`);
      press(r, V.startL, 0.5);
      r.run(0.2);
      v.set(V.fuelCtlL, 1);
      r.run(60, () => v.getString('fadec.eng1.start_status') === 'RUN');
      v.set(V.startMaster, 0);
      r.run(5);
      L.push(`  both engines, aligning: CAS ${cas(r)}`);
      let alignedT = NaN;
      r.run(900, (tt) => {
        if (v.get('ahrs1.valid') && v.get('ahrs2.valid') && v.get('ahrs3.valid')) alignedT = tt;
        return !isNaN(alignedT);
      });
      r.run(2);
      L.push(`  aligned after ${alignedT.toFixed(0)} s: CAS ${cas(r)} | fbw.mode ${v.get('fbw.mode_code')}`);
      // takeoff config: flaps 0, TO thrust
      v.set(V.flapLever, 0);
      r.run(30);
      v.set(V.parkBrake, 0);
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      r.run(1);
      L.push(`  TO thrust flaps 0: CAS ${cas(r)} | tocw ${[...v.keys()].filter((n) => /tocw|to_config|takeoff_config/i.test(n)).map((n) => n + '=' + v.get(n)).join(',')}`);
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      v.set(V.parkBrake, 1);
      r.run(3);
      // shutdown leaving IRS ON
      v.set(V.fuelCtlL, 0);
      v.set(V.fuelCtlR, 0);
      v.set(V.apuMaster, 0);
      r.run(90);
      v.set(V.ebhaBatt, 0);
      v.set(V.upsBatt, 0);
      v.set(V.battL, 0);
      v.set(V.battR, 0);
      r.run(5);
      L.push(`  batteries + FCS batt OFF, IRS left ON, EMER PWR ARM: irs1 powered ${v.get('elec.irs1_powered')} ebatt ${v.get(V.ebattOn)} emer_dc ${v.get('elec.emer_dc_powered')} | CAS ${cas(r)} | ON BAT var ${[...v.keys()].filter((n) => /on_bat/i.test(n)).map((n) => n + '=' + v.get(n)).join(',')}`);
      v.set(V.emerPwr, 0);
      r.run(3);
      L.push(`  + EMER PWR OFF: irs1 powered ${v.get('elec.irs1_powered')} emer_dc ${v.get('elec.emer_dc_powered')} l_ess ${v.get('elec.l_ess_dc_powered')}`);
    }
    writeFileSync('/tmp/claude-0/g650-procedures-probe2.txt', L.join('\n'));
    expect(L.length).toBeGreaterThan(0);
  });
  it('targeted probes 2: FCS battery back-feed after shutdown, PTU check on R start', () => {
    const L: string[] = [];
    {
      const r = makeRig('ready_to_taxi');
      const v = r.vars;
      r.run(2);
      L.push(`=== relays before: ${[...v.keys()].filter((n) => /elec\.(ebha|ups)_(l|r|rly)/.test(n)).map((n) => n + '=' + v.get(n)).join(',')}`);
      v.set(V.fuelCtlL, 0);
      v.set(V.fuelCtlR, 0);
      r.run(60);
      for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
      v.set(V.emerPwr, 0);
      v.set(V.battL, 0);
      v.set(V.battR, 0);
      r.run(5);
      L.push(`  engines off, IRS/EMER/MAIN BATT OFF, FLT CTRL BATT ON: l_ess ${v.get('elec.l_ess_dc_v').toFixed(1)} V (${v.get('elec.l_ess_dc_powered')}) r_ess ${v.get('elec.r_ess_dc_powered')} du1 ${v.get('elec.du1_powered')} mcdu1 ${v.get('elec.mcdu1_powered')} EBHA A ${v.get('elec.ebha_batt_amps').toFixed(1)} UPS A ${v.get('elec.ups_batt_amps').toFixed(1)}`);
      L.push(`  relays: ${[...v.keys()].filter((n) => /elec\.(ebha|ups)_(l|r|rly)/.test(n)).map((n) => n + '=' + v.get(n)).join(',')}`);
      L.push(`  CAS ${cas(r)}`);
      v.set(V.ebhaBatt, 0);
      v.set(V.upsBatt, 0);
      r.run(3);
      L.push(`  + FLT CTRL BATT OFF: l_ess ${v.get('elec.l_ess_dc_powered')} du1 ${v.get('elec.du1_powered')} fcc1a ${v.get('elec.fcc1a_powered')}`);
    }
    {
      // PTU test on the R engine start (G450 AFM: right engine first to test the PTU)
      const r = makeRig('cold_dark');
      const v = r.vars;
      for (const k of [V.battL, V.battR, V.ebhaBatt, V.upsBatt]) v.set(k, 1);
      v.set(V.emerPwr, 1);
      for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
      v.set(V.ptu, 1);
      v.set(V.auxPump, 1);
      v.set(V.apuMaster, 1);
      r.run(14);
      press(r, V.apuStart, 0.5);
      r.run(60, () => v.get('elec.apu_gen_online') === 1);
      v.set(V.bleedApu, 1);
      r.run(65);
      v.set(V.startMaster, 1);
      r.run(3);
      press(r, V.startR, 0.5);
      v.set(V.fuelCtlR, 1);
      r.run(60, () => v.getString('fadec.eng2.start_status') === 'RUN');
      r.run(15);
      L.push(`=== R start with PTU ARM: R ${v.get('hyd.right_psi').toFixed(0)} L ${v.get('hyd.left_psi').toFixed(0)} psi PTU active ${v.get('hyd.ptu_active')} aux ${v.get('hyd.aux_on')} | CAS ${cas(r)}`);
      // brake / aux latch check (G450 AOM: pilot's brakes depress -> AUX latches on), engines off case
      const r2 = makeRig('cold_dark');
      const w = r2.vars;
      for (const k of [V.battL, V.battR]) w.set(k, 1);
      w.set(V.auxPump, 1);
      r2.run(2);
      w.set('input.brake_left', 0.5);
      w.set('input.brake_right', 0.5);
      r2.run(5);
      L.push(`=== AUX PUMP ARM + pedals, engines off: aux on ${w.get('hyd.aux_on')} L ${w.get('hyd.left_psi').toFixed(0)} psi accum ${w.get('brakes.accum_psi').toFixed(0)} | CAS ${cas(r2)}`);
    }
    writeFileSync('/tmp/claude-0/g650-procedures-probe3.txt', L.join('\n'));
    expect(L.length).toBeGreaterThan(0);
  });
  it('targeted probes 3: fire tests per switch, RAT / dual gen, flap override, relight', () => {
    const L: string[] = [];
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    for (const [name, sw] of [['L LOOP A', V.fireTestLA], ['R LOOP B', V.fireTestRB], ['APU TEST', V.apuFireTest], ['FAULT TEST', V.fireFaultTest]] as const) {
      v.set(sw, 1);
      r.run(1.5);
      L.push(`=== ${name} held: eng1_warn ${v.get('fire.eng1_warn')} eng2_warn ${v.get('fire.eng2_warn')} apu_warn ${v.get('fire.apu_warn')} | CAS ${cas(r)}`);
      v.set(sw, 0);
      r.run(2);
    }
    // dual generator failure in cruise: what the crew gets
    const c = makeRig('cruise', { air: { altFtMsl: 41000, iasKt: 250 } });
    const w = c.vars;
    c.run(2);
    c.sys.failures.trigger('elec.idg1');
    c.sys.failures.trigger('elec.idg2');
    c.run(5);
    L.push(`=== DUAL GEN FAIL FL410: CAS ${cas(c)} | l_main_ac ${w.get('elec.l_main_ac_powered')} emer_ac ${w.get('elec.emer_ac_powered')} ess dc L ${w.get('elec.l_ess_dc_v').toFixed(1)} V`);
    w.set(V.ratDeploy, 1);
    c.run(35);
    L.push(`  RAT deployed (RAT GEN ${w.get(V.ratGen)}): rat online ${w.get('elec.rat_online')} emer_ac ${w.get('elec.emer_ac_powered')} ess dc L ${w.get('elec.l_ess_dc_v').toFixed(1)} V | CAS ${cas(c)}`);
    // Flaps failed + FLAP ORIDE
    const f = makeRig('approach', { air: { altFtMsl: 2500, iasKt: 160 } });
    const x = f.vars;
    f.run(2);
    x.set(V.flapOride, 1);
    f.run(2);
    L.push(`=== FLAP ORIDE ON: CAS ${cas(f)}`);
    x.set(V.terrInhibit, 1);
    x.set(V.raasInhibit, 1);
    f.run(2);
    L.push(`=== TERRAIN + RAAS INHIBIT ON: CAS ${cas(f)}`);
    writeFileSync('/tmp/claude-0/g650-procedures-probe4.txt', L.join('\n'));
    expect(L.length).toBeGreaterThan(0);
  });
});
