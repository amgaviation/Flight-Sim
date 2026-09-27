/**
 * Procedures & checklists probes (procedures-lens audit, 2026-09). Each probe executes a
 * Longitude checklist through the cockpit control vars only (the same vars the 3D
 * controls write), and RECORDS each item's auto-check result plus the indications a crew
 * would read (CAS, EIS, FMA). Sources: OG = Working Title "Citation Longitude Model 700
 * Operators Guide" Section 17 (normal procedures), DGAC = DGAC Chile C700 CC-DRA
 * evaluation card (emergency/abnormal procedures), BCA = Albright 2021 pilot report.
 *
 * Observation probes, not regression tests: they only assert that the rig ran.
 * Skipped unless AMG_PROCEDURE_PROBES=1. Results go to AMG_PROBE_OUT (JSON).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRig, type Rig } from '../helpers';
import { LON_VARS as V, LON_CONTROL_VARS } from '../../../../src/aircraft/citation-longitude/vars';
import { LONGITUDE_CHECKLISTS } from '../../../../src/aircraft/citation-longitude/checklists';
import { FDM, INPUT } from '../../../../src/core/vars';
import type { InitialState } from '../../../../src/aircraft/types';
import { stabUnitsFor } from '../../../../src/aircraft/citation-longitude/states';
import { ScriptedPilot } from '../../../../src/input/ScriptedPilot';
import { FIELD } from '../helpers';

const RUN = !!process.env.AMG_PROCEDURE_PROBES;
const out: Record<string, unknown> = {};
const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level[0]}:${e.text}`);

afterAll(() => {
  if (RUN && process.env.AMG_PROBE_OUT) writeFileSync(process.env.AMG_PROBE_OUT, JSON.stringify(out, null, 1));
});

function evalList(r: Rig, title: string): string[] {
  const l = LONGITUDE_CHECKLISTS.find((x) => x.title === title);
  if (!l) return [`<no list ${title}>`];
  return l.items.map((it) => {
    let s = '----';
    if (it.check) {
      try {
        s = it.check(r.vars) ? 'PASS' : 'FAIL';
      } catch {
        s = 'ERR ';
      }
    }
    return `${s} ${it.challenge} = ${it.response}`;
  });
}

function snap(r: Rig, names: string[]): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (const n of names) {
    const x = r.vars.get(n);
    o[n] = Number.isFinite(x) ? Math.round(x * 1000) / 1000 : String(x);
  }
  return o;
}

function strings(r: Rig, names: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const n of names) o[n] = r.vars.getString(n);
  return o;
}

const IND = [
  'elec.emer_l_powered', 'elec.mission_l_powered', 'elec.stby_powered', 'elec.stby_inst_powered', 'elec.batt_l_v', 'elec.batt_l_amps', 'elec.batt_r_amps',
  'elec.gpu_online', 'elec.apu_gen_online', 'elec.gen_l_online', 'elec.gen_r_online', 'elec.bus_tie_closed', 'light.nav', 'light.beacon', 'light.strobe',
  'apu.avail', 'apu.n_pct', 'apu.state', 'eng1.running', 'eng2.running', 'brakes.parking_set', 'brakes.accum_psi', 'hyd.a_psi', 'hyd.b_psi',
  'surf.flaps_deg', 'trim.pitch_units', 'surf.pitch_trim', 'trim.pitch_to_ok', 'trim.roll_to_ok', 'trim.yaw_to_ok', V.noTakeoff, 'ahrs1.valid', 'ahrs2.valid',
  'adc1.baro_inhg', 'adc1.baro_std', 'adc2.baro_std', 'adc1.alt_ft', 'adc2.alt_ft', 'press.ldg_elev_ft', 'press.cabin_alt_ft', 'g3k.spd_fms', 'ap.engaged', 'ap.at_engaged',
  'g3k.vspd.V1.kt', 'g3k.vspd.VR.kt', 'g3k.vspd.V2.kt', 'g3k.vspd.VREF.kt', 'g3k.mins.ft', 'g3k.told.to_valid', 'g3k.told.ldg_valid', 'fdm.cg_pct_mac', 'fdm.mass_kg',
];

describe.skipIf(!RUN)('Longitude procedures probes', () => {
  it('initial states vs the checklists (OG 17)', { timeout: 240000 }, () => {
    const lists: Record<InitialState, string[]> = {
      cold_dark: [],
      ready_to_taxi: ['Cockpit Inspection', 'Cockpit Preparation', 'Before Start', 'Starting Engines (Using APU)', 'Before Taxi', 'Taxi'],
      takeoff: ['Before Taxi', 'Taxi', 'Before Takeoff', 'Takeoff'],
      cruise: ['After Takeoff / Climb', 'Cruise'],
      approach: ['Descent', 'Approach', 'Before Landing'],
    } as Record<InitialState, string[]>;
    const res: Record<string, unknown> = {};
    for (const s of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
      const air = s === 'cruise' ? { altFtMsl: 35000, iasKt: 250 } : s === 'approach' ? { altFtMsl: 4000, iasKt: 160 } : undefined;
      const r = makeRig(s, { avionics: true, weightLb: 34000, air });
      r.run(3);
      const ctl: Record<string, number> = {};
      for (const n of LON_CONTROL_VARS) ctl[n.replace('ac.lon.', '')] = Math.round(r.vars.get(n) * 1000) / 1000;
      res[s] = {
        checks: Object.fromEntries(lists[s].map((t) => [t, evalList(r, t)])),
        ind: snap(r, IND),
        str: strings(r, ['ap.lat_active', 'ap.vert_active', 'ap.at_mode', 'fadec.rating', 'fadec.eng1.detent', 'fadec.eng2.detent']),
        cas: posted(r),
        controls: ctl,
      };
    }
    out.states = res;
    expect(true).toBe(true);
  });

  it('ground flow cold & dark -> before takeoff via cockpit vars (OG 17-2..17-5)', { timeout: 600000 }, () => {
    const r = makeRig('cold_dark', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    const g = r.sys.suite!.system;
    const log: Record<string, unknown> = {};
    r.run(2);
    log.coldDark = { ind: snap(r, IND), cas: posted(r) };
    // ---- Cockpit Inspection
    v.set(V.stbyPwr, 2);
    const ledT: number[] = [];
    r.run(11, (t) => {
      if (v.get(V.stbyBattLed) === 2 && ledT.length === 0) ledT.push(t);
    });
    log.stbyTest = { led: v.get(V.stbyBattLed), firstGreenS: ledT[0] ?? null, stbyInstDuringTest: v.get('elec.stby_inst_powered') };
    v.set(V.stbyPwr, 1);
    v.set(V.ltEmer, 1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(5);
    log.afterBatt = { ind: snap(r, IND), cas: posted(r), ltNavSwitch: v.get(V.ltNav) };
    // External power (GPU connected by the ramp crew), EXT PWR ON (OG 17-2 6a/b)
    v.set(V.extPwrAvail, 1);
    r.run(1);
    v.set(V.extPwr, 1);
    r.run(10);
    log.extPwr = { ind: snap(r, IND), cas: posted(r), inspection: evalList(r, 'Cockpit Inspection') };
    // APU ON, time to green APU digits (OG 17-11: within 10 s), START
    v.set(V.apuKnob, 1);
    let digitsT = NaN;
    r.run(15, (t) => {
      if (isNaN(digitsT) && v.get('apu.state') >= 1 && v.get('apu.door_open')) digitsT = t;
    });
    const beforeStart = { state: v.get('apu.state'), door: v.get('apu.door_open'), n: v.get('apu.n_pct') };
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    let availT = NaN;
    r.run(90, (t) => {
      if (isNaN(availT) && v.get('apu.avail')) availT = t;
      return v.get('apu.avail') === 1 && t > availT + 3;
    });
    log.apu = { doorOpenS: digitsT, beforeStart, availS: availT, ind: snap(r, ['apu.n_pct', 'apu.egt_c', 'apu.avail', 'elec.apu_gen_online', 'elec.gpu_online', 'fuel.boost_r_on', 'elec.bus_tie_closed']), cas: posted(r) };
    // External power disconnected (EXT PWR OFF; GPU removed)
    v.set(V.extPwr, 0);
    r.run(1);
    v.set(V.extPwrAvail, 0);
    r.run(5);
    log.gpuOff = { ind: snap(r, ['elec.batt_l_amps', 'elec.batt_r_amps', 'elec.mission_r_powered', 'elec.bus_tie_closed']), inspection: evalList(r, 'Cockpit Inspection') };
    // ---- Cockpit Preparation: AP engage/disengage on the ground (first flight of the day)
    r.run(60, () => v.get('ahrs1.valid') === 1 && v.get('adc1.valid') === 1);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const apOnGround = v.get('ap.engaged');
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    log.apGroundTest = { engaged: apOnGround, afterSecondPress: v.get('ap.engaged'), discWarn: v.get('ap.disc_warn') };
    // W&F / TOLD
    g.wf.pax = 4;
    g.wf.cargoLb = 200;
    r.run(1);
    const inp = g.told.inputs.takeoff;
    inp.airport = 'KICT';
    inp.runway = '01R';
    inp.runwayLengthFt = 10301;
    inp.runwayElevFt = 1333;
    inp.runwayHeadingMag = 12;
    inp.oatC = Math.round(v.get('adc1.sat_c'));
    inp.weightLb = Math.round(g.wf.grossLb);
    inp.flaps = '2';
    const to = g.told.computeTakeoff();
    if (to) g.vspeeds.applyTold(to.vspeeds);
    r.run(1);
    log.prep = { told: to, cgPctMac: v.get('fdm.cg_pct_mac'), stab: v.get('trim.pitch_units'), prep: evalList(r, 'Cockpit Preparation'), wfGross: g.wf.grossLb, fdmLb: v.get('fdm.mass_kg') / 0.45359237 };
    // ---- Before Start
    const accumBefore = v.get('brakes.accum_psi');
    v.set(V.parkBrake, 1);
    r.run(2);
    log.beforeStart = { accumBefore, list: evalList(r, 'Before Start'), cas: posted(r) };
    // ---- Starting engines (R first), start PSI before / after RUN
    const psiBeforeRun = v.get(V.startPsi);
    v.set(V.runR, 1);
    r.run(1);
    const psiAfterRun = v.get(V.startPsi);
    const beaconRun = v.get('light.beacon') + v.get('light.beacon_lower');
    v.set(V.startR, 1);
    r.run(0.3);
    v.set(V.startR, 0);
    let startSeen = 0;
    let boostSeen = 0;
    let startPsiMin = 99;
    r.run(45, () => {
      if (v.get('fadec.eng2.start_state') >= 1 && v.get('fadec.eng2.start_state') <= 3) startSeen = 1;
      if (v.get('fuel.boost_r_on')) boostSeen = 1;
      if (v.get('fadec.eng2.starter_cmd')) startPsiMin = Math.min(startPsiMin, v.get(V.startPsi));
      return v.get('eng2.running') === 1;
    });
    r.run(5);
    const rStart = { psiBeforeRun, psiAfterRun, beaconOnWithRun: beaconRun, startIndication: startSeen, boostDuringStart: boostSeen, startPsiDuringCrank: startPsiMin, cas: posted(r) };
    v.set(V.runL, 1);
    r.run(1);
    const lPsi = v.get(V.startPsi);
    v.set(V.startL, 1);
    r.run(0.3);
    v.set(V.startL, 0);
    r.run(45, () => v.get('eng1.running') === 1);
    r.run(20);
    log.starts = { rStart, lPsiAfterRun: lPsi, list: evalList(r, 'Starting Engines (Using APU)'), ind: snap(r, IND), cas: posted(r) };
    // ---- Before Taxi: flight controls, speedbrake check on the ground, flaps, instruments
    v.set(INPUT.pitch, 1);
    v.set(INPUT.roll, 1);
    v.set(INPUT.yaw, 1);
    r.run(2);
    const fcFull = snap(r, ['surf.elevator', 'surf.aileron', 'surf.rudder', 'surf.spoiler_left', 'surf.spoiler_right']);
    v.set(INPUT.pitch, 0);
    v.set(INPUT.roll, 0);
    v.set(INPUT.yaw, 0);
    v.set(V.speedbrake, 1);
    r.run(3);
    const sbGround = snap(r, ['surf.speedbrake', 'spoilers.sb_ext', 'surf.spoiler_left', V.sbCmd]);
    v.set(V.speedbrake, 0);
    v.set(V.flapLever, 2);
    r.run(15);
    log.beforeTaxi = {
      fcFull,
      sbGround,
      list: evalList(r, 'Before Taxi'),
      altimeters: { adc1: v.get('adc1.alt_ft'), adc2: v.get('adc2.alt_ft'), adc3: v.get('adc3.alt_ft'), field: 1333, baro1: v.get('adc1.baro_inhg'), baro2: v.get('adc2.baro_inhg') },
      eisFlaps: v.get('surf.flaps_deg'),
    };
    // ---- Taxi: park brake stowed, reversers deploy (reverse idle) / stow
    v.set(V.parkBrake, 0);
    r.run(2);
    v.set(V.tla(1), -0.05);
    v.set(V.tla(2), -0.05);
    let revMax = 0;
    r.run(4, () => {
      revMax = Math.max(revMax, v.get('eng1.reverser_pos'));
    });
    const deployed = snap(r, ['eng1.reverser_pos', 'eng2.reverser_pos', 'fadec.eng1.rev_unlocked', 'fadec.eng2.rev_unlocked', 'eng1.n1_pct', 'fdm.gs_kt']);
    const deployedStr = strings(r, ['fadec.eng1.detent', 'fadec.eng2.detent']);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    r.run(4);
    log.taxi = { deployed, deployedStr, stowed: snap(r, ['eng1.reverser_pos', 'eng2.reverser_pos']), list: evalList(r, 'Taxi'), cas: posted(r) };
    // ---- Before Takeoff: P/S ON 15 s then NORM; P/S ON > 2 min on the ground
    v.set(V.pitotStatic, 1);
    r.run(3);
    const ps3 = posted(r);
    r.run(125);
    const ps128 = posted(r);
    v.set(V.pitotStatic, 0);
    r.run(2);
    log.pitot = { after3s: ps3, after128s: ps128 };
    // Trim per the OG 17-3 chart vs EIS band (sweep)
    const sweep: Record<string, unknown>[] = [];
    for (const deg of [-7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5]) {
      r.sys.stab.setPosition(deg);
      r.run(0.2);
      const n = v.get('surf.pitch_trim');
      sweep.push({ deg, norm: Math.round(n * 1000) / 1000, toOk: v.get('trim.pitch_to_ok'), eisGreen: n >= 0.05 && n <= 0.4 ? 1 : 0 });
    }
    r.sys.stab.setPosition(-4.5);
    r.run(1);
    log.trimSweep = sweep;
    // NO TAKEOFF with park brake + TO thrust (CAS colours)
    v.set(V.parkBrake, 1);
    r.run(1);
    v.set(V.tla(1), 0.5);
    v.set(V.tla(2), 0.5);
    r.run(2);
    const pbMid = posted(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(2);
    const pbTo = posted(r);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    r.run(3);
    log.parkBrakeThrust = { midLever: pbMid, toLever: pbTo };
    v.set(V.parkBrake, 0);
    r.run(2);
    log.beforeTakeoff = { list: evalList(r, 'Before Takeoff'), cas: posted(r) };
    out.groundFlow = log;
    expect(true).toBe(true);
  });

  it('takeoff, after takeoff/climb (OG 17-6)', { timeout: 300000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    const before = { list: evalList(r, 'Before Takeoff'), cas: posted(r), ind: snap(r, IND) };
    // Static takeoff, A/T used: throttles TO manually (OG 17-6), check HOLD / thrust mode
    r.events.emit('at.engage');
    r.run(0.5);
    v.set(INPUT.brakeLeft, 1);
    v.set(INPUT.brakeRight, 1);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(8);
    const atStatic = { at: v.get('ap.at_engaged'), mode: v.getString('ap.at_mode'), detent: v.getString('fadec.eng1.detent'), rating: v.getString('fadec.rating'), n1: v.get('eng1.n1_pct'), cmd: v.get('fadec.eng1.n1_cmd_pct'), tla: v.get(V.tla(1)), cas: posted(r), list: evalList(r, 'Takeoff') };
    v.set(INPUT.brakeLeft, 0);
    v.set(INPUT.brakeRight, 0);
    let holdSeen = '';
    let liftoff = NaN;
    r.run(60, () => {
      const ias = v.get(FDM.ias);
      if (!holdSeen && v.getString('ap.at_mode')) holdSeen = ias > 60 ? v.getString('ap.at_mode') : '';
      v.set(INPUT.pitch, ias > 126 ? 0.45 : 0);
      if (isNaN(liftoff) && v.get('gear.air_ground') === 0) liftoff = ias;
      return v.get(FDM.altAgl) > 60;
    });
    v.set(V.gearHandle, 0);
    r.run(40, () => {
      v.set(INPUT.pitch, v.get(FDM.pitch) < 12 ? 0.25 : v.get(FDM.pitch) > 15 ? -0.1 : 0.05);
      return v.get(FDM.ias) > 160;
    });
    v.set(V.flapLever, 0);
    v.set(V.tla(1), 0.8);
    v.set(V.tla(2), 0.8);
    r.run(30, () => {
      v.set(INPUT.pitch, v.get(FDM.pitch) < 10 ? 0.15 : v.get(FDM.pitch) > 13 ? -0.1 : 0.0);
    });
    v.set(INPUT.pitch, 0);
    out.takeoff = {
      before,
      atStatic,
      atModeAbove60: holdSeen,
      liftoffKias: liftoff,
      afterTakeoff: { list: evalList(r, 'After Takeoff / Climb'), detent: v.getString('fadec.eng1.detent'), rating: v.getString('fadec.rating'), atMode: v.getString('ap.at_mode'), ind: snap(r, ['gear.up_locked', 'surf.flaps_deg', 'press.cabin_alt_ft', FDM.altAgl, FDM.ias]), cas: posted(r) },
    };
    expect(true).toBe(true);
  });

  it('approach, before landing, go-around (OG 17-7/17-8)', { timeout: 300000 }, () => {
    const r = makeRig('approach', { avionics: true, weightLb: 30000, air: { altFtMsl: 4000, iasKt: 160 } });
    const v = r.vars;
    r.run(2);
    const appr = { list: evalList(r, 'Approach'), ind: snap(r, IND), str: strings(r, ['ap.lat_active', 'ap.vert_active', 'ap.at_mode']), cas: posted(r) };
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const apBefore = v.get('ap.engaged');
    v.set(V.flapLever, 3);
    r.run(20);
    const beforeLdg = { list: evalList(r, 'Before Landing'), cas: posted(r) };
    // Go-around: TO/GA (either throttle)
    const tlaBefore = v.get(V.tla(1));
    r.events.emit('ap.toga');
    r.run(0.5);
    const ga = { apAfter: v.get('ap.engaged'), lat: v.getString('ap.lat_active'), vert: v.getString('ap.vert_active'), at: v.getString('ap.at_mode'), atEng: v.get('ap.at_engaged'), rating: v.getString('fadec.rating'), pitchRef: v.get('ap.pitch_ref_deg'), fdPitch: v.get('ap.fd_pitch_deg') };
    r.run(5);
    out.approach = { appr, apBefore, beforeLdg, tlaBefore, ga, after5s: { tla: v.get(V.tla(1)), n1: v.get('eng1.n1_pct'), detent: v.getString('fadec.eng1.detent'), atMode: v.getString('ap.at_mode') }, goAround: evalList(r, 'Go-Around') };
    expect(true).toBe(true);
  });

  it('shutdown and securing, standby / hot-battery loads (OG 17-9)', { timeout: 300000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    const afterLanding = evalList(r, 'After Landing');
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set(V.parkBrake, 1);
    v.set(V.aiEngL, 0);
    v.set(V.aiEngR, 0);
    v.set(V.runL, 0);
    v.set(V.runR, 0);
    r.run(40);
    const casAfterStop = posted(r);
    v.set(V.ltEmer, 0);
    v.set(V.stbyPwr, 0);
    v.set(V.apuKnob, 0);
    for (const k of [V.ltLdgL, V.ltLdgR, V.ltTaxi, V.ltAntiColl, V.ltRecog, V.ltPulse, V.ltWingInsp, V.ltTailFlood]) v.set(k, 0);
    const shutdownBeforeBatt = evalList(r, 'Shutdown');
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(5);
    out.shutdown = {
      afterLanding,
      casAfterStop,
      shutdownBeforeBatt,
      shutdown: evalList(r, 'Shutdown'),
      dark: snap(r, ['elec.emer_l_powered', 'elec.emer_r_powered', 'elec.stby_powered', 'elec.stby_inst_powered', 'light.nav', 'light.beacon', 'display.pfd1.power', 'hyd.a_psi', 'brakes.parking_set', 'brakes.accum_psi']),
      navSwitchLeftOn: v.get(V.ltNav),
      beaconMode: v.get(V.ltBeaconMode),
    };
    expect(true).toBe(true);
  });

  it('cross-bleed start and dry motor (OG 17-11/17-12)', { timeout: 600000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    // Left engine shut down, then restarted from right-engine bleed (APU off).
    v.set(V.runL, 0);
    r.run(60);
    const res: Record<string, unknown> = { casLeftStopped: posted(r), apu: v.get('apu.running') };
    v.set(V.tla(2), 0);
    r.run(5);
    const psiIdle = v.get(V.startPsi);
    // Running engine IDLE + 25 % N1 minimum
    const idleN1 = v.get('eng2.n1_pct');
    let lever = 0;
    for (let i = 0; i < 40; i++) {
      lever += 0.01;
      v.set(V.tla(2), lever);
      r.run(1.5);
      if (v.get('eng2.n1_pct') >= idleN1 + 25) break;
    }
    const psiPlus25 = v.get(V.startPsi);
    v.set(V.runL, 1);
    r.run(1);
    const psiRun = v.get(V.startPsi);
    v.set(V.startL, 1);
    r.run(0.3);
    v.set(V.startL, 0);
    let started = NaN;
    r.run(60, (t) => {
      if (isNaN(started) && v.get('eng1.running')) started = t;
      return v.get('eng1.running') === 1;
    });
    v.set(V.tla(2), 0);
    r.run(5);
    Object.assign(res, { psiIdle, idleN1, leverFor25: lever, n1At: v.get('eng2.n1_pct'), psiPlus25, psiRun, startedS: started, abort: v.get('fadec.eng1.abort'), cas: posted(r), list: evalList(r, 'Starting Engines (Using APU)') });
    // Dry-motor recommendation after a shutdown: stop both, wait 16 min, check the message; dry motor with the APU.
    v.set(V.runL, 0);
    v.set(V.runR, 0);
    v.set(V.parkBrake, 1);
    r.run(16 * 60);
    const dryReq = { l: v.get(V.dryMotorReq(1)), r: v.get(V.dryMotorReq(2)), cas: posted(r) };
    v.set(V.apuKnob, 1);
    r.run(12);
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    r.run(150);
    v.set(V.startR, 1);
    let n2max = 0;
    r.run(16, () => {
      n2max = Math.max(n2max, v.get('eng2.n2_pct'));
    });
    v.set(V.startR, 0);
    r.run(185);
    Object.assign(res, { dryReq, dryMotorN2Max: n2max, afterDryMotor3min: { r: v.get(V.dryMotorReq(2)), l: v.get(V.dryMotorReq(1)) }, dryList: evalList(r, 'Engine Dry Motor'), prep: evalList(r, 'Cockpit Preparation') });
    out.crossBleed = res;
    expect(true).toBe(true);
  });

  it('DGAC abnormal / emergency items and engine fire (DGAC card, OG 3)', { timeout: 600000 }, () => {
    const res: Record<string, unknown> = {};
    // Failure catalogue (what the pause menu can trigger)
    {
      const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
      res.failureIds = r.sys.failures.list().map((f) => f.id);
      // Engine fire on the ground: ENG FIRE L switchlight -> engine shutdown, bottles armed, discharge
      r.run(2);
      r.sys.failures.trigger('fire.eng1');
      r.run(3);
      const warn = { cas: posted(r), warn: r.vars.get('fire.eng1_warn'), mw: r.vars.get('alert.master_warning') };
      r.vars.set(V.fireEngL, 1);
      r.run(1);
      const armed = snap(r, ['fire.eng1_armed', 'fire.bottle1_psi', 'fuel.eng1_on', 'fadec.eng1.fuel_cmd', 'pneu.eng1_valve_open', 'hyd.edp_a_on']);
      r.vars.set(V.bottle1, 1);
      r.run(0.3);
      r.vars.set(V.bottle1, 0);
      r.run(15);
      res.engineFireGround = { warn, armed, after: snap(r, ['fire.eng1_warn', 'fire.eng1_active', 'fire.bottle1_discharged', 'eng1.running', 'eng1.n2_pct']), cas: posted(r) };
    }
    // In flight: generator failure, engine failure (APR?), cabin altitude (EDM?), trim runaway + MASTER DISCONNECT
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 41000, iasKt: 240 } });
      const v = r.vars;
      r.run(3);
      r.sys.failures.trigger('elec.gen_l');
      r.run(5);
      res.genFail = { cas: posted(r), tie: v.get('elec.bus_tie_closed') };
      r.sys.failures.clear('elec.gen_l');
      v.set(V.genL, 2);
      r.run(0.5);
      v.set(V.genL, 1);
      r.run(3);
      res.genReset = { online: v.get('elec.gen_l_online'), cas: posted(r) };
      // Depressurization: dump -> cabin altitude, EDM?
      const hdg0 = v.get(FDM.headingMag);
      v.set(V.pressDumpGuard, 1);
      v.set(V.pressDump, 1);
      let cabWarnT = NaN;
      r.run(90, (t) => {
        if (isNaN(cabWarnT) && posted(r).some((m) => m.includes('CABIN ALTITUDE') && m.startsWith('w'))) cabWarnT = t;
      });
      res.depress = {
        cabWarnS: cabWarnT,
        cabinAlt: v.get('press.cabin_alt_ft'),
        paxMasks: v.get('press.pax_masks'),
        apEngaged: v.get('ap.engaged'),
        hdgChange: v.get(FDM.headingMag) - hdg0,
        vs: v.get(FDM.vs),
        atMode: v.getString('ap.at_mode'),
        vert: v.getString('ap.vert_active'),
        cas: posted(r),
      };
      v.set(V.oxyMaskL, 1);
      v.set(V.oxyMode, 1);
      r.run(2);
      res.crewOxy = snap(r, ['oxy.pilot_flowing', 'oxy.main_psi']);
    }
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 20000, iasKt: 250 } });
      const v = r.vars;
      r.run(3);
      // Engine failure in cruise: thrust mode / APR on the operating engine
      const ids = r.sys.failures.list().map((f) => f.id);
      const engId = ids.find((id) => /eng(ine)?[._]?1|eng\.l\b|left engine/i.test(id) && !/fire|ice|bleed|gen|oil|ejector|rev|start/i.test(id)) ?? '';
      if (engId) r.sys.failures.trigger(engId);
      r.run(10);
      res.engFail = { engId, active: r.sys.failures.active(), cas: posted(r), rating: v.getString('fadec.rating'), detent2: v.getString('fadec.eng2.detent'), n1_2: v.get('eng2.n1_pct'), running1: v.get('eng1.running') };
    }
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 20000, iasKt: 250 } });
      const v = r.vars;
      r.run(3);
      r.events.emit('g3k.gmc.key_ap');
      r.run(0.5);
      const stab0 = v.get('trim.pitch_units');
      r.sys.failures.trigger('trim.pitch.runaway');
      r.run(3);
      const stabRun = v.get('trim.pitch_units');
      v.set(V.yokeDiscL, 1);
      r.run(0.5);
      const stabDisc0 = v.get('trim.pitch_units');
      r.run(3);
      const stabDisc3 = v.get('trim.pitch_units');
      v.set(V.yokeDiscL, 0);
      r.run(2);
      res.trimRunaway = { stab0, stabRun, stabDisc0, stabDisc3, released2s: v.get('trim.pitch_units'), ap: v.get('ap.engaged'), cas: posted(r) };
    }
    // Brake failure on the ground: EMER/PARK brake stops the aircraft
    {
      const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
      const v = r.vars;
      r.run(2);
      v.set(V.parkBrake, 0);
      v.set(V.tla(1), 0.25);
      v.set(V.tla(2), 0.25);
      r.run(20, () => v.get(FDM.gs) > 15);
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      r.sys.failures.trigger('brakes.left');
      r.sys.failures.trigger('brakes.right');
      r.run(1);
      const cas = posted(r);
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(3);
      const gsPedals = v.get(FDM.gs);
      v.set(V.parkBrake, 0.6);
      const t = r.run(40, () => v.get(FDM.gs) < 0.5);
      res.brakeFail = { cas, gsAfterPedals3s: gsPedals, stoppedWithEmerBrakeS: t, gs: v.get(FDM.gs) };
    }
    out.abnormal = res;
    expect(true).toBe(true);
  });
  it('follow-ups: start without bleed, cross-bleed at idle, engine failure / APR, GA with A/T, speedbrake EIS, emergency brake, secondary trim', { timeout: 900000 }, () => {
    const res: Record<string, unknown> = {};
    // F1a: batteries only, no APU, no bleed: RUN R + START R
    {
      const r = makeRig('cold_dark', { avionics: false, weightLb: 34000 });
      const v = r.vars;
      v.set(V.battL, 1);
      v.set(V.battR, 1);
      r.run(20);
      v.set(V.runR, 1);
      r.run(1);
      const psi = v.get(V.startPsi);
      v.set(V.startR, 1);
      r.run(0.3);
      v.set(V.startR, 0);
      let n2 = 0;
      r.run(45, () => {
        n2 = Math.max(n2, v.get('eng2.n2_pct'));
      });
      res.startNoBleed = { psi, n2max: n2, running: v.get('eng2.running'), abort: v.get('fadec.eng2.abort'), rMan: v.get('pneu.r_man_psi'), lMan: v.get('pneu.l_man_psi'), cas: posted(r) };
    }
    // F1b: APU just AVAIL (bleed not yet ready): RUN R + START R
    {
      const r = makeRig('cold_dark', { avionics: false, weightLb: 34000 });
      const v = r.vars;
      v.set(V.battL, 1);
      v.set(V.battR, 1);
      v.set(V.apuKnob, 1);
      r.run(12);
      v.set(V.apuKnob, 2);
      r.run(0.5);
      v.set(V.apuKnob, 1);
      r.run(60, () => v.get('apu.avail') === 1);
      r.run(2);
      v.set(V.runR, 1);
      r.run(1);
      const psi = v.get(V.startPsi);
      const trace: number[] = [];
      v.set(V.startR, 1);
      r.run(0.3);
      v.set(V.startR, 0);
      let t0 = NaN;
      r.run(60, (t) => {
        if (Math.round(t * 60) % 60 === 0) trace.push(Math.round(v.get(V.startPsi)));
        if (isNaN(t0) && v.get('eng2.running')) t0 = t;
        return v.get('eng2.running') === 1;
      });
      res.startBleedNotReady = { psiAtRun: psi, apuBleedReady: v.get(V.apuBleedReady), startedS: t0, psiTrace: trace.slice(0, 30), rMan: v.get('pneu.r_man_psi'), lMan: v.get('pneu.l_man_psi') };
    }
    // F2: cross-bleed with the running engine at IDLE
    {
      const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
      const v = r.vars;
      r.run(2);
      v.set(V.runL, 0);
      r.run(60);
      const before = snap(r, [V.startPsi, 'pneu.l_man_psi', 'pneu.r_man_psi', 'pneu.iso_open', V.isoOpen, 'eng2.n1_pct']);
      v.set(V.runL, 1);
      r.run(1);
      const atRun = snap(r, [V.startPsi, 'pneu.l_man_psi', 'pneu.r_man_psi', 'pneu.iso_open']);
      v.set(V.startL, 1);
      r.run(0.3);
      v.set(V.startL, 0);
      let t0 = NaN;
      let minPsi = 99;
      r.run(60, (t) => {
        if (v.get('fadec.eng1.starter_cmd')) minPsi = Math.min(minPsi, v.get('pneu.l_man_psi'));
        if (isNaN(t0) && v.get('eng1.running')) t0 = t;
        return v.get('eng1.running') === 1;
      });
      res.crossBleedIdle = { before, atRun, startedS: t0, minLManDuringCrank: minPsi, abort: v.get('fadec.eng1.abort') };
    }
    // F3: engine failure in climb (FADEC failure) -> CAS, thrust mode / APR on the good engine
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 10000, iasKt: 220 } });
      const v = r.vars;
      r.run(3);
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      r.run(5);
      const pre = { n1_2: v.get('eng2.n1_pct'), rating: v.getString('fadec.rating'), det: v.getString('fadec.eng2.detent') };
      r.sys.failures.trigger('fadec.eng1');
      r.run(10);
      res.engineFailure = { pre, cas: posted(r), running1: v.get('eng1.running'), n1_1: v.get('eng1.n1_pct'), n1_2: v.get('eng2.n1_pct'), rating: v.getString('fadec.rating'), det2: v.getString('fadec.eng2.detent'), limitTo: v.get('fadec.n1_to_pct'), limitApr: v.get('fadec.n1_apr_pct') };
    }
    // F4: go-around with A/T engaged
    {
      const r = makeRig('approach', { avionics: true, weightLb: 30000, air: { altFtMsl: 3000, iasKt: 140 } });
      const v = r.vars;
      r.run(2);
      r.events.emit('g3k.gmc.key_ap');
      r.events.emit('at.engage');
      r.run(1);
      const pre = { ap: v.get('ap.engaged'), at: v.get('ap.at_engaged'), atMode: v.getString('ap.at_mode'), tla: v.get(V.tla(1)) };
      r.events.emit('ap.toga');
      const tr: string[] = [];
      r.run(8, (t) => {
        if (Math.round(t * 60) % 60 === 0) tr.push(`${t.toFixed(0)}s tla ${v.get(V.tla(1)).toFixed(2)} n1 ${v.get('eng1.n1_pct').toFixed(0)} at ${v.getString('ap.at_mode')} fdP ${v.get('ap.fd_pitch_deg').toFixed(1)} ref ${v.get('ap.pitch_ref_deg').toFixed(1)} pitch ${v.get(FDM.pitch).toFixed(1)} rating ${v.getString('fadec.rating')}`);
      });
      res.goAroundAt = { pre, ap: v.get('ap.engaged'), lat: v.getString('ap.lat_active'), vert: v.getString('ap.vert_active'), trace: tr };
    }
    // F5: speedbrake in flight: EIS var vs panels; flaps FULL limit
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 15000, iasKt: 250 } });
      const v = r.vars;
      r.run(2);
      v.set(V.speedbrake, 1);
      r.run(3);
      res.speedbrakeFlight = snap(r, [V.speedbrake, V.sbCmd, 'spoilers.sb_ext', 'surf.speedbrake', 'surf.spoiler_left', 'surf.spoiler_right', 'surf.spoilers']);
    }
    // F6: emergency / park brake: normal, brake-control power loss, both hydraulics lost
    for (const mode of ['normal', 'brake_ctl', 'hyd_both'] as const) {
      const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
      const v = r.vars;
      r.run(2);
      v.set(V.parkBrake, 0);
      v.set(V.tla(1), 0.25);
      v.set(V.tla(2), 0.25);
      r.run(30, () => v.get(FDM.gs) > 15);
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      if (mode === 'brake_ctl') r.sys.failures.trigger('elec.brake_ctl.short');
      if (mode === 'hyd_both') {
        v.set(V.hydPumpA, 2);
        v.set(V.hydPumpB, 2);
        v.set(V.ptcu, 0);
      }
      r.run(mode === 'hyd_both' ? 8 : 1);
      const cas = posted(r);
      const gs0 = v.get(FDM.gs);
      v.set(V.parkBrake, 0.6);
      const t = r.run(40, () => v.get(FDM.gs) < 0.5);
      res[`emerBrake_${mode}`] = { cas, gs0, stopS: t, gsEnd: v.get(FDM.gs), accum: v.get('brakes.accum_psi'), psiL: v.get('brakes.psi_left'), a: v.get('hyd.a_psi'), b: v.get('hyd.b_psi') };
    }
    // F8: secondary stab trim while MASTER DISCONNECT is held (trim runaway recovery)
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 20000, iasKt: 250 } });
      const v = r.vars;
      r.run(3);
      r.sys.failures.trigger('trim.pitch.runaway');
      r.run(2);
      v.set(V.yokeDiscL, 1);
      r.run(0.5);
      const a = v.get('trim.pitch_units');
      v.set(V.stabSecGuard, 1);
      v.set(V.stabSecSw, 1);
      r.run(3);
      const b = v.get('trim.pitch_units');
      v.set(V.stabSecSw, 0);
      v.set(V.yokeDiscL, 0);
      v.set(V.stabSecSw, 1);
      r.run(3);
      const c = v.get('trim.pitch_units');
      v.set(V.stabSecSw, 0);
      res.secondaryTrim = { heldStart: a, secNoseUpWhileDiscHeld3s: b, secNoseUpDiscReleased3s: c, cas: posted(r) };
    }
    out.followUps = res;
    expect(true).toBe(true);
  });
  it('follow-ups 2: engine loss at TO thrust (APR), A/T HOLD after TO/GA', { timeout: 300000 }, () => {
    const res: Record<string, unknown> = {};
    {
      const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 3000, iasKt: 170 } });
      const v = r.vars;
      r.run(2);
      r.events.emit('at.disc');
      r.events.emit('g3k.gmc.key_ap');
      r.run(0.5);
      if (v.get('ap.engaged')) r.events.emit('g3k.gmc.key_ap');
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      r.run(8);
      const pre = { n1_2: v.get('eng2.n1_pct'), det2: v.getString('fadec.eng2.detent'), rating: v.getString('fadec.rating'), at: v.get('ap.at_engaged') };
      v.set(V.runL, 0); // engine 1 lost (fuel cut by the FADEC RUN/STOP)
      r.run(10);
      const stop = { running1: v.get('eng1.running'), n1_2: v.get('eng2.n1_pct'), det2: v.getString('fadec.eng2.detent'), rating: v.getString('fadec.rating'), cas: posted(r) };
      v.set(V.runL, 1);
      v.set(V.fireEngL, 1); // same loss through the firewall shutoff, RUN still selected
      r.run(10);
      res.engineLoss = { pre, stop, fireSwitch: { running1: v.get('eng1.running'), n1_2: v.get('eng2.n1_pct'), det2: v.getString('fadec.eng2.detent'), rating: v.getString('fadec.rating'), cas: posted(r) } };
    }
    {
      const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
      const v = r.vars;
      r.run(2);
      r.events.emit('g3k.gmc.spd_push');
      r.events.emit('at.engage');
      r.run(0.5);
      r.events.emit('ap.toga');
      r.run(0.5);
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      const tr: string[] = [];
      r.run(10, (t) => {
        if (Math.round(t * 60) % 120 === 0) tr.push(`${t.toFixed(0)}s tla ${v.get(V.tla(1)).toFixed(2)} n1 ${v.get('eng1.n1_pct').toFixed(1)} at ${v.getString('ap.at_mode')} det ${v.getString('fadec.eng1.detent')}`);
      });
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      let hold = '';
      r.run(40, () => {
        if (v.get(FDM.ias) > 70 && !hold) hold = v.getString('ap.at_mode');
        return v.get(FDM.ias) > 100;
      });
      res.atToga = { spdFms: v.get('g3k.spd_fms'), trace: tr, modeAbove70: hold, lat: v.getString('ap.lat_active'), vert: v.getString('ap.vert_active') };
    }
    out.followUps2 = res;
    expect(true).toBe(true);
  });
  it('follow-ups 3: stab trim vs CG (OG 17-3 chart) and liftoff at TOLD VR', { timeout: 300000 }, () => {
    const res: Record<string, unknown> = {};
    const load: Record<string, number[]> = { fwd: [800, 0, 0, 0], mid: [400, 400, 0, 300], aft: [0, 0, 600, 1115] };
    const trims: Record<string, unknown>[] = [];
    for (const [k, st] of Object.entries(load)) {
      const r = makeRig('approach', { avionics: false, fuelLb: k === 'aft' ? 3000 : 9000, air: { altFtMsl: 3000, iasKt: 150 } });
      r.fdm.setStationMass(2, st[0] * 0.45359237);
      r.fdm.setStationMass(3, st[1] * 0.45359237);
      r.fdm.setStationMass(4, st[2] * 0.45359237);
      r.fdm.setStationMass(5, st[3] * 0.45359237);
      r.run(1);
      const t = r.fdm.computeTrim({ iasKt: 150 });
      trims.push({ k, cg: r.vars.get('fdm.cg_pct_mac'), lb: r.vars.get('fdm.mass_kg') / 0.45359237, converged: t.converged, pitchTrim: t.pitchTrim, stabDeg: stabUnitsFor(r.sys, Math.max(-1, Math.min(1, t.pitchTrim))) });
    }
    res.trimVsCg = trims;
    // Liftoff with the pilot rotating at the TOLD VR to 10 deg (OG 17-6), throttles TO, flaps 2.
    {
      const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
      const v = r.vars;
      r.run(2);
      const g = r.sys.suite!.system;
      const inp = g.told.inputs.takeoff;
      inp.airport = 'KICT';
      inp.runway = '01R';
      inp.runwayLengthFt = 10301;
      inp.runwayElevFt = 1333;
      inp.runwayHeadingMag = 12;
      inp.oatC = Math.round(v.get('adc1.sat_c'));
      inp.weightLb = Math.round(v.get('fdm.mass_kg') / 0.45359237);
      inp.flaps = '2';
      const to = g.told.computeTakeoff()!;
      v.set(V.tla(1), 1);
      v.set(V.tla(2), 1);
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(6);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      const pilot = new ScriptedPilot(v, r.events);
      pilot.startTakeoff({ vrKt: to.vspeeds.VR, courseTrueDeg: FIELD.courseTrue, lat: FIELD.lat, lon: FIELD.lon, pitchDeg: 10, gearUp: false });
      r.run(60, () => {
        pilot.update(1 / 60);
        return v.get(FDM.altAgl) > 50;
      });
      res.liftoff = { told: to.vspeeds, rotate: pilot.log.rotateIasKt, liftoff: pilot.log.liftoffIasKt, stab: v.get('trim.pitch_units'), cg: v.get('fdm.cg_pct_mac') };
    }
    out.followUps3 = res;
    expect(true).toBe(true);
  });
  it('follow-ups 4: A/T engaged during taxi (OG 1: A/T not armed during taxi)', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    v.set(V.parkBrake, 0);
    r.events.emit('at.engage');
    const tr: string[] = [];
    r.run(12, (t) => {
      if (Math.round(t * 60) % 120 === 0) tr.push(`${t.toFixed(0)}s at ${v.get('ap.at_engaged')} ${v.getString('ap.at_mode')} tla ${v.get(V.tla(1)).toFixed(2)} n1 ${v.get('eng1.n1_pct').toFixed(0)} gs ${v.get(FDM.gs).toFixed(1)}`);
    });
    out.followUps4 = { trace: tr, selSpd: v.get('ap.sel_spd_kt') };
    expect(true).toBe(true);
  });
});
