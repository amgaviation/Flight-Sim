/**
 * Fidelity probes (function & systems audit, 2026-09). Each probe drives the real
 * Longitude systems headlessly and RECORDS what the model does for a behaviour that
 * the public sources describe (OG = Working Title Longitude Operators Guide, BCA =
 * Albright 2021 pilot report, DGAC = DGAC Chile C700 evaluation card). The results
 * go to `AMG_PROBE_OUT` (JSON) so the audit report can cite measured numbers.
 *
 * These are observation probes, not regression tests: they only assert that the
 * rig ran. Skipped unless AMG_FIDELITY_PROBES=1 (they add ~1 min of simulation).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRig, type Rig } from '../helpers';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';

const RUN = !!process.env.AMG_FIDELITY_PROBES;
const out: Record<string, unknown> = {};
const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level}:${e.text}`);

afterAll(() => {
  if (RUN && process.env.AMG_PROBE_OUT) writeFileSync(process.env.AMG_PROBE_OUT, JSON.stringify(out, null, 2));
});

describe.skipIf(!RUN)('Longitude fidelity probes', () => {
  it('cold & dark power-up: standby bus, NAV lights auto-on (OG 16-3, BCA)', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    const v = r.vars;
    r.run(2);
    const cd = { stbyInst: v.get('elec.stby_inst_powered'), stbyBus: v.get('elec.stby_powered'), stbySw: v.get(V.stbyPwr), emerL: v.get('elec.emer_l_powered') };
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(20);
    out.coldDarkPowerUp = { coldDark: cd, afterBatt20s: { ltNav: v.get(V.ltNav), lightNav: v.get('light.nav'), busTie: v.get('elec.bus_tie_closed'), mfd: v.get('elec.mfd_powered'), cas: posted(r) } };
    expect(true).toBe(true);
  });

  it('STBY PWR TEST LED and EXT PWR (OG 5-5)', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.stbyPwr, 2);
    r.run(4);
    const test = { led: v.get(V.stbyBattLed), stbyInst: v.get('elec.stby_inst_powered') };
    v.set(V.stbyPwr, 1);
    r.run(2);
    out.stbyPwr = { test, on: { led: v.get(V.stbyBattLed), charging: v.get('elec.mission_l_v') - v.get('elec.stby_batt_v') } };
  });

  it('bus tie: pilot cannot open an auto-closed tie in flight; ground press parity (OG 5-5/5-6)', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(3);
    const res: Record<string, unknown> = {};
    // Manual close then open, both gens online.
    v.set(V.busTieBtn, 1);
    r.run(2);
    res.manualPress1 = v.get('elec.bus_tie_closed');
    v.set(V.busTieBtn, 0);
    r.run(2);
    res.manualPress2 = v.get('elec.bus_tie_closed');
    // Generator L fails: automation closes; pilot presses to open.
    r.sys.failures.trigger('elec.gen_l');
    r.run(5);
    res.afterGenLFail = v.get('elec.bus_tie_closed');
    v.set(V.busTieBtn, v.get(V.busTieBtn) ? 0 : 1);
    r.run(2);
    res.afterPilotPressToOpen = v.get('elec.bus_tie_closed');
    out.busTie = res;
  });

  it('battery-only / PTCU-only electrical in flight: MAIN and INTERIOR shedding (OG 5-2)', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(3);
    v.set(V.genL, 0);
    v.set(V.genR, 0);
    r.run(5);
    const battOnly = { mainL: v.get('elec.main_l_powered'), mainR: v.get('elec.main_r_powered'), intL: v.get('elec.int_l_powered'), battLA: v.get('elec.batt_l_amps'), battRA: v.get('elec.batt_r_amps'), wshld: v.get(V.wshldHeatOn), cas: posted(r) };
    v.set(V.elecL, 0);
    v.set(V.elecR, 0);
    r.run(5);
    const elecEmer = { battLA: v.get('elec.batt_l_amps'), battRA: v.get('elec.batt_r_amps'), missionL: v.get('elec.mission_l_powered'), emerL: v.get('elec.emer_l_powered') };
    v.set(V.elecL, 1);
    v.set(V.elecR, 1);
    v.set(V.ptcu, 4);
    r.run(10);
    const ptcuGen = { mode: v.getString(V.ptcuMode), online: v.get('elec.ptcu_gen_online'), mainL: v.get('elec.main_l_powered'), mainR: v.get('elec.main_r_powered'), load: v.get('elec.ptcu_gen_load_pct'), cas: posted(r) };
    out.elecDegraded = { battOnly, elecEmer, ptcuGen };
  });

  it('EMER/PARK BRAKE handle partially pulled: proportional or full? (DGAC: apply smoothly)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    v.set(V.parkBrake, 0);
    r.run(2);
    v.set(V.parkBrake, 0.15);
    r.run(1);
    const p15 = { psiL: v.get('brakes.psi_left'), brakeL: v.get('gear.brake_left'), set: v.get('brakes.parking_set') };
    v.set(V.parkBrake, 0.5);
    r.run(1);
    out.parkBrakeProportional = { p15, p50: { psiL: v.get('brakes.psi_left') } };
  });

  it('A/T takeoff: HOLD before brake release with throttles at TO (OG 7-5, 17-6 static takeoff)', { timeout: 120000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: true });
    const v = r.vars;
    v.set(V.parkBrake, 1);
    r.run(2);
    r.events.emit('at.engage');
    r.run(0.5);
    r.events.emit('ap.toga');
    r.run(0.5);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(4);
    out.atTakeoff = { atMode: v.getString('ap.at_mode'), atEngaged: v.get('ap.at_engaged'), ias: v.get('adc1.ias_kt'), cas: posted(r) };
  });

  it('PARK BRAKE ON / NO TAKEOFF with throttles advanced (OG 3-9, 14-3)', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: false });
    const v = r.vars;
    v.set(V.parkBrake, 1);
    r.run(2);
    const idle = posted(r);
    v.set(V.tla(1), 0.5);
    v.set(V.tla(2), 0.5);
    r.run(2);
    const mid = posted(r);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(2);
    out.parkBrakeCas = { idle, mid, to: posted(r) };
  });

  it('HYD GEN default source (OG 5-7 says A first, OG 13-4 says B first)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    v.set(V.ptcu, 4);
    r.run(3);
    out.hydGen = { mode: v.getString(V.ptcuMode) };
  });

  it('secondary stab trim switch sign and power (OG 15-2)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    r.run(1);
    const s0 = v.get('trim.pitch_units');
    v.set(V.stabSecSw, 1); // cockpit label: NOSE UP
    r.run(2);
    const sUp = v.get('trim.pitch_units');
    v.set(V.stabSecSw, 0);
    v.set(V.yokeDiscL, 1); // MASTER DISCONNECT held
    r.run(0.2);
    v.set(V.stabSecSw, -1);
    r.run(2);
    const sDiscHeld = v.get('trim.pitch_units');
    out.secTrim = { start: s0, afterNoseUp2s: sUp, afterNoseDnWithDiscHeld: sDiscHeld };
  });

  it('APU fire: automatic shutdown/extinguish and cockpit indications (BCA, glareshield APU FIRE switchlight)', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.apuKnob, 1);
    r.run(15);
    v.set(V.apuKnob, 2);
    r.run(1);
    v.set(V.apuKnob, 1);
    r.run(60);
    const before = { avail: v.get('apu.avail'), n: v.get('apu.n_pct') };
    r.sys.failures.trigger('fire.apu');
    r.run(15);
    out.apuFire = { before, after: { warn: v.get('fire.apu_warn'), apuState: v.get('apu.state'), n: v.get('apu.n_pct'), bottle: v.get('fire.apu_bottle_discharged'), cas: posted(r) } };
  });

  it('start PSI with RUN selected before START (BCA: RUN configures the bleed; OG 7-5)', { timeout: 180000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.apuKnob, 1);
    r.run(15);
    v.set(V.apuKnob, 2);
    r.run(1);
    v.set(V.apuKnob, 1);
    r.run(130);
    const pre = { startPsi: v.get('pneu.start_psi'), packFlow: v.get('pneu.pack_flow_kgs'), apuBleedReady: v.get(V.apuBleedReady) };
    v.set(V.runR, 1);
    r.run(2);
    const run = { startPsi: v.get('pneu.start_psi'), packFlow: v.get('pneu.pack_flow_kgs') };
    v.set(V.startR, 1);
    r.run(0.3);
    v.set(V.startR, 0);
    r.run(3);
    out.startPsi = { pre, runSelected: run, starting: { startPsi: v.get('pneu.start_psi'), packFlow: v.get('pneu.pack_flow_kgs'), starter: v.get('fadec.eng2.starter_cmd') } };
  });

  it('speedbrake at low speed (BCA: auto-stow when too slow) and A/T protection', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: true, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    // A/T off, throttles idle, speedbrake full: let it decelerate toward the shaker.
    r.events.emit('at.disc');
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set(V.speedbrake, 1);
    let minIas = 999;
    let atEngagedSeen = 0;
    r.run(60, () => {
      minIas = Math.min(minIas, v.get('adc1.ias_kt'));
      if (v.get('ap.at_engaged')) atEngagedSeen = 1;
    });
    out.lowSpeed = { minIas, sbCmd: v.get(V.sbCmd), atAutoEngaged: atEngagedSeen, shaker: v.get('alert.stick_shaker'), cas: posted(r) };
  });

  it('GEN OFF APU with engines running (OG 3-8)', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    v.set(V.apuKnob, 1);
    r.run(15);
    v.set(V.apuKnob, 2);
    r.run(1);
    v.set(V.apuKnob, 1);
    r.run(50);
    v.set(V.genApu, 0);
    r.run(3);
    out.genOffApu = { apuGenAvail: v.get('elec.apu_gen_avail'), cas: posted(r) };
  });

  it('pitch trim out of green band -> NO TAKEOFF, and TO/GA disconnects AP', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: false });
    const v = r.vars;
    r.sys.stab.setPosition(-8.5);
    r.run(1);
    out.noTakeoffTrim = { noTo: v.get(V.noTakeoff), cas: posted(r) };
  });
});

describe.skipIf(!RUN)('Longitude fidelity probes (batch 2)', () => {
  it('primary pitch trim runaway: MASTER DISCONNECT then retrim with the secondary trim (DGAC card)', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    const s0 = v.get('trim.pitch_units');
    r.sys.failures.trigger('trim.pitch.runaway');
    r.run(2);
    const s1 = v.get('trim.pitch_units');
    v.set(V.yokeDiscL, 1); // MASTER DISCONNECT push and hold
    r.run(2);
    const s2 = v.get('trim.pitch_units');
    v.set(V.stabSecSw, 1); // secondary trim NOSE UP while holding
    r.run(2);
    const s3 = v.get('trim.pitch_units');
    v.set(V.stabSecSw, 0);
    v.set(V.yokeDiscL, 0); // release
    r.run(3);
    const s4 = v.get('trim.pitch_units');
    out.trimRunaway = { start: s0, after2sRunaway: s1, holdingDisc2s: s2, secTrimWhileHolding: s3, after3sReleased: s4 };
  });

  it('TO/GA on the ground with A/T off (BCA: TO/GA arms the A/T)', { timeout: 60000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: true });
    const v = r.vars;
    r.run(1);
    r.events.emit('ap.toga');
    r.run(1);
    out.togaGround = { atEngaged: v.get('ap.at_engaged'), atMode: v.getString('ap.at_mode'), fmaLat: v.getString('ap.lat_mode'), fmaVert: v.getString('ap.vert_mode') };
  });

  it('ENG FIRE switchlight pushed on a running engine: CAS set (fuel/hyd/bleed firewall)', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    v.set(V.fireEngL, 1);
    r.run(20);
    out.engFirePush = { running: v.get('eng1.running'), hydA: v.get('hyd.a_psi'), armed1: v.get('fire.eng1_armed'), cas: posted(r) };
  });

  it('HYD GEN first selection after >1 s in NORM picks the other source (logic.ts ptcuAwayT)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    r.run(5); // knob untouched in NORM for 5 s
    v.set(V.ptcu, 4);
    r.run(1);
    const first = v.getString(V.ptcuMode);
    v.set(V.ptcu, 2);
    r.run(40); // away > 30 s
    v.set(V.ptcu, 4);
    r.run(1);
    out.hydGenBug = { firstSelectionAfter5s: first, reselectAfter40s: v.getString(V.ptcuMode) };
  });

  it('TOPI during a rejected takeoff (OG 3-3: stays active until IAS < 50 kt / 90 s)', { timeout: 120000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: false });
    const v = r.vars;
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    let at90 = -1;
    r.run(60, (t) => {
      if (v.get('adc1.ias_kt') >= 95) {
        at90 = t;
        return true;
      }
    });
    const inhAt95 = v.get('cas.to_inhibit');
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set('input.brake_left', 1);
    v.set('input.brake_right', 1);
    let ias80 = -1;
    r.run(20, () => {
      if (v.get('adc1.ias_kt') < 80 && ias80 < 0) {
        ias80 = v.get('cas.to_inhibit');
        return true;
      }
    });
    out.topiRto = { t95: at90, inhibitAt95: inhAt95, inhibitAt80Decel: ias80 };
  });

  it('standby display sources with STBY PWR OFF in flight; ADC3/AHRS3 power', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(2);
    v.set(V.stbyPwr, 0);
    r.run(3);
    out.stbyOff = { stbyInst: v.get('elec.stby_inst_powered'), adc3: v.get('adc3.valid'), ahrs3: v.get('ahrs3.valid'), cas: posted(r) };
  });
});

describe.skipIf(!RUN)('Longitude fidelity probes (batch 3)', () => {
  it('EIS pitch-trim green band vs NO TAKEOFF band (OG 15-2)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    const rows: Record<string, unknown>[] = [];
    for (const deg of [-7.4, -6, -4.5, -2, -1, -0.6]) {
      r.sys.stab.setPosition(deg);
      r.run(0.2);
      rows.push({ deg, surfPitchTrim: v.get('surf.pitch_trim'), toOk: v.get('trim.pitch_to_ok'), eisBandOk: v.get('surf.pitch_trim') >= 0.05 && v.get('surf.pitch_trim') <= 0.4 });
    }
    out.trimBand = rows;
  });
});

describe.skipIf(!RUN)('Longitude fidelity probes (batch 4)', () => {
  it('longitudinal trim vs CG (OG 17-3 chart: -7 deg at 24 % MAC, 0 deg at 40 % MAC)', { timeout: 120000 }, async () => {
    const { stabUnitsFor } = await import('../../../../src/aircraft/citation-longitude/states');
    const rows: Record<string, number>[] = [];
    for (const load of [
      { fwd: 800, aft: 0, bag: 0 },
      { fwd: 0, aft: 0, bag: 1115 },
    ]) {
      const r = makeRig('ready_to_taxi', { avionics: false, fuelLb: 8000 });
      const LBK = 0.45359237;
      r.fdm.setStationMass(2, load.fwd * LBK);
      r.fdm.setStationMass(5, load.bag * LBK);
      r.run(0.5);
      r.fdm.reposition({ lat: 37.65, lon: -97.43, altFtMsl: 5000, iasKt: 180, headingTrue: 15 });
      const t = (r.fdm as unknown as { computeTrim(o: { iasKt: number }): { converged: boolean; pitchTrim: number } }).computeTrim({ iasKt: 180 });
      r.run(0.1);
      rows.push({ cg: r.vars.get('fdm.cg_pct_mac'), pitchTrimNorm: t.pitchTrim, stabDeg: stabUnitsFor(r.sys, Math.max(-1, Math.min(1, t.pitchTrim))), conv: t.converged ? 1 : 0 });
    }
    out.trimVsCg = rows;
  });
});
