/**
 * Procedures-lens audit probes, pass 2 (2026-09-27). Observation only; skipped unless AMG_PROCEDURE_PROBES=1.
 * Writes JSON to AMG_PROBE_OUT2. Sources: OG 17 (normal procedures), OG 7-5 (A/T HOLD), DGAC C700 card.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRig, type Rig } from '../helpers';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';
import { FDM, INPUT } from '../../../../src/core/vars';

const RUN = !!process.env.AMG_PROCEDURE_PROBES;
const out: Record<string, unknown> = {};
const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level[0]}:${e.text}`);
afterAll(() => {
  if (RUN && process.env.AMG_PROBE_OUT2) writeFileSync(process.env.AMG_PROBE_OUT2, JSON.stringify(out, null, 1));
});

describe.skipIf(!RUN)('Longitude procedures audit pass 2', () => {
  it('FADEC failure, OEI APR / thrust-mode string, fire switch in flight', { timeout: 200000 }, () => {
    const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 10000, iasKt: 220 } });
    const v = r.vars;
    r.run(2);
    r.events.emit('at.disc');
    r.run(0.5);
    v.set(V.tla(1), 0.7);
    v.set(V.tla(2), 0.7);
    r.run(5);
    const pre = { n1_1: v.get('eng1.n1_pct'), n1_2: v.get('eng2.n1_pct'), at: v.get('ap.at_engaged') };
    r.sys.failures.trigger('fadec.eng1');
    r.run(10);
    const after = { n1_1: v.get('eng1.n1_pct'), n1_2: v.get('eng2.n1_pct'), run1: v.get('eng1.running'), cas: posted(r) };
    v.set(V.tla(1), 0.2);
    r.run(5);
    out.fadecFail = { pre, after, afterLever: { n1_1: v.get('eng1.n1_pct'), cas: posted(r) } };
    // Thrust mode strings with lever in each detent in flight
    const r2 = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 3000, iasKt: 180 } });
    const v2 = r2.vars;
    r2.run(2);
    r2.events.emit('at.disc');
    const modes: Record<string, string> = {};
    for (const t of [0.3, 0.6, 0.8, 0.9, 1.0]) {
      v2.set(V.tla(1), t);
      v2.set(V.tla(2), t);
      r2.run(2);
      modes[String(t)] = `${v2.getString('fadec.rating')}/${v2.getString('fadec.eng1.detent')}/${v2.get('fadec.n1_limit_pct').toFixed(1)}`;
    }
    v2.set(V.runL, 0);
    r2.run(5);
    const oei = { rating: v2.getString('fadec.rating'), det2: v2.getString('fadec.eng2.detent'), n1_2: v2.get('eng2.n1_pct'), cas: posted(r2) };
    out.thrustModes = { modes, oei };
  });

  it('wheel brake failure + EMER/PARK BRAKE (DGAC)', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 0.25);
    v.set(V.tla(2), 0.25);
    r.run(30, () => v.get(FDM.gs) > 15);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    r.sys.failures.trigger('brakes.left');
    r.run(1);
    const psiA = { l: v.get('brakes.psi_left'), r: v.get('brakes.psi_right') };
    v.set(V.parkBrake, 1);
    r.run(2);
    const psiB = { l: v.get('brakes.psi_left'), r: v.get('brakes.psi_right'), gs: v.get(FDM.gs) };
    out.wheelBrake = { psiA, psiB, cas: posted(r) };
  });

  it('SPD knob / TOLD in takeoff state; A/T manual advance; nav lights after BATT; APU in states', { timeout: 200000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    const g = r.sys.suite!.system as unknown as { told: { inputs: { takeoff: Record<string, unknown> } } };
    out.takeoffState = {
      spdFms: v.get('g3k.spd_fms'),
      toldTo: v.get('g3k.told.to_valid'),
      toldInputs: g.told.inputs.takeoff,
      fd: [v.get('ap.fd1_on'), v.get('ap.fd2_on')],
      lat: v.getString('ap.lat_active'),
      vert: v.getString('ap.vert_active'),
      apu: [v.get(V.apuKnob), v.get('apu.avail')],
      xpdr: v.get('xpdr1.mode'),
      seat: v.get(V.ltSeatBelt),
      beacon: v.get(V.ltBeaconMode),
    };
    // Manual throttle advance with A/T engaged (no TO/GA)
    r.events.emit('at.engage');
    r.run(0.5);
    const atMode0 = v.getString('ap.at_mode');
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(3);
    out.atManual = { atMode0, atModeAtTO: v.getString('ap.at_mode') };
    const c = makeRig('cold_dark', { avionics: true, weightLb: 34000 });
    c.vars.set(V.battL, 1);
    c.vars.set(V.battR, 1);
    c.run(30);
    out.coldPowerUp = { navSw: c.vars.get(V.ltNav), stby: c.vars.get('elec.stby_inst_powered'), cas: posted(c), gpu: c.vars.get(V.extPwrAvail) };
    const cd = makeRig('cold_dark', { avionics: true, weightLb: 34000 });
    cd.run(2);
    out.coldDark = { stbyInst: cd.vars.get('elec.stby_inst_powered'), stbySw: cd.vars.get(V.stbyPwr), emer: cd.vars.get(V.ltEmer), park: cd.vars.get(V.parkBrake), gear: cd.vars.get(V.gearHandle), flaps: cd.vars.get(V.flapLever), extAvail: cd.vars.get(V.extPwrAvail) };
    // Speedbrake handle in flight with flaps FULL, and in approach state
    const a = makeRig('approach', { avionics: true, weightLb: 30000, air: { altFtMsl: 3000, iasKt: 150 } });
    a.run(2);
    out.approachState = { ap: a.vars.get('ap.engaged'), at: a.vars.get('ap.at_engaged'), lat: a.vars.getString('ap.lat_active'), vert: a.vars.getString('ap.vert_active'), selSpd: a.vars.get('ap.sel_spd_kt'), mins: a.vars.get('g3k.mins.ft'), ldgValid: a.vars.get('g3k.told.ldg_valid'), vref: a.vars.get('g3k.vspd.VREF.kt'), gear: a.vars.get(V.gearHandle), flaps: a.vars.get(V.flapLever), ldgLt: a.vars.get(V.ltLdgL), rating: a.vars.getString('fadec.rating'), apu: a.vars.get(V.apuKnob) };
    v.set(INPUT.pitch, 0);
    expect(true).toBe(true);
  });
});
