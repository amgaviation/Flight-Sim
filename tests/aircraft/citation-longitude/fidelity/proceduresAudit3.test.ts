/**
 * Procedures-lens audit probes, pass 3 (2026-09-29). Observation only; skipped unless AMG_PROCEDURE_PROBES=1.
 * Writes JSON to AMG_PROBE_OUT3. Sources: OG 17 (normal procedures), OG 8 (APU), DGAC C700 card.
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
  if (RUN && process.env.AMG_PROBE_OUT3) writeFileSync(process.env.AMG_PROBE_OUT3, JSON.stringify(out, null, 1));
});

describe.skipIf(!RUN)('Longitude procedures audit pass 3', () => {
  it('APU bleed / start pressure timeline after APU start (OG 8, 17-11)', { timeout: 600000 }, () => {
    const r = makeRig('cold_dark', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(5);
    v.set(V.apuKnob, 1);
    r.run(12);
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    let availT = NaN;
    const trace: string[] = [];
    // RUN must be selected for start_psi to be shown? sample raw manifold too.
    r.run(240, (t) => {
      if (isNaN(availT) && v.get('apu.avail')) availT = t;
      if (Math.round(t * 60) % 600 === 0)
        trace.push(`${t.toFixed(0)}s avail ${v.get('apu.avail')} n ${v.get('apu.n_pct').toFixed(0)} startPsi ${v.get(V.startPsi).toFixed(1)} lMan ${v.get('pneu.l_man_psi').toFixed(1)} apuBleedReady ${v.get(V.apuBleedReady)}`);
    });
    out.apuBleedTimeline = { availS: availT, trace, apuBleed: v.get(V.bleedApu) };
    // now a start with pressure established
    v.set(V.runR, 1);
    r.run(1);
    const psi = v.get(V.startPsi);
    v.set(V.startR, 1);
    r.run(0.3);
    v.set(V.startR, 0);
    let startedT = NaN;
    r.run(60, (t) => {
      if (isNaN(startedT) && v.get('eng2.running')) startedT = t;
      return v.get('eng2.running') === 1;
    });
    out.apuStartAfterWait = { psiAtRun: psi, startedS: startedT, abort: v.get('fadec.eng2.abort'), cas: posted(r) };
    // ENG START ABORT clearing: shut down, abort a start with no air (APU off), then check message life
    v.set(V.apuKnob, 0);
    v.set(V.runR, 0);
    r.run(45);
    v.set(V.runR, 1);
    r.run(1);
    v.set(V.startR, 1);
    r.run(0.3);
    v.set(V.startR, 0);
    r.run(15);
    const abortCas = posted(r).filter((m) => m.includes('ABORT'));
    v.set(V.runR, 0);
    r.run(30);
    out.abortClear = { afterFail: abortCas, afterRunStop30s: posted(r).filter((m) => m.includes('ABORT')) };
  });

  it('AP ground engage (OG 17-3 item 13) and A/T taxi guard (OG 1 limitation)', { timeout: 300000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(3);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const ap = { engaged: v.get('ap.engaged'), fdOn: v.get('ap.fd1_on'), inhibitVars: { prDisc: v.get(V.pitchRollDisc), ctlLock: v.get(V.controlLock) } };
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    out.apGround = { ...ap, secondPress: v.get('ap.engaged') };
    // A/T on the ground without TO/GA: should not be armable / must not drive the levers (OG: not armed during taxi)
    v.set(V.parkBrake, 0);
    r.events.emit('at.engage');
    r.run(4);
    out.atTaxi = { engaged: v.get('ap.at_engaged'), mode: v.getString('ap.at_mode'), tla: v.get(V.tla(1)), n1: v.get('eng1.n1_pct') };
  });

  it('secondary trim with SECONDARY TRIM armed while MASTER DISCONNECT held (DGAC runaway recovery)', { timeout: 200000 }, () => {
    const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(3);
    r.sys.failures.trigger('trim.pitch.runaway');
    r.run(2);
    v.set(V.yokeDiscL, 1); // MASTER DISCONNECT push and hold
    r.run(0.5);
    const a = v.get('trim.pitch_units');
    v.set(V.stabSecArm, 1); // SECONDARY TRIM switchlight - ENGAGED
    r.run(2);
    const b = v.get('trim.pitch_units'); // runaway should be gone (primary disengaged)
    v.set(V.stabSecSw, 1); // rocker NOSE UP while disc still held
    r.run(3);
    const c = v.get('trim.pitch_units');
    v.set(V.stabSecSw, 0);
    v.set(V.yokeDiscL, 0);
    r.run(3);
    const d = v.get('trim.pitch_units');
    out.secondaryTrimArmed = { discHeld: a, afterArm2s: b, rockerWhileHeld3s: c, released3s: d, cas: posted(r) };
  });

  it('speedbrake ground check with engines running; NO TAKEOFF for out-of-band trim', { timeout: 200000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false, weightLb: 34000 });
    const v = r.vars;
    r.run(3);
    v.set(V.speedbrake, 1);
    r.run(3);
    const ext = { handle: v.get(V.speedbrake), sbExt: v.get('spoilers.sb_ext'), spL: v.get('surf.spoiler_left'), cas: posted(r).filter((m) => m.includes('SPOIL') || m.includes('SPEED')) };
    v.set(V.speedbrake, 0);
    r.run(3);
    const ret = { sbExt: v.get('spoilers.sb_ext') };
    // trim outside the takeoff band + TO thrust -> NO TAKEOFF red
    r.sys.stab.setPosition(-0.2);
    r.run(1);
    const toOk = v.get('trim.pitch_to_ok');
    v.set(V.parkBrake, 0);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(2);
    out.sbAndTrim = { ext, ret, trimToOkAtMinus02: toOk, casAtTo: posted(r).filter((m) => m.includes('TAKEOFF')) };
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
  });

  it('AP ground engage from the cold cockpit (OG 17-3 item 13) - FD off vs FD on', { timeout: 300000 }, () => {
    const r = makeRig('cold_dark', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.extPwrAvail, 1);
    r.run(1);
    v.set(V.extPwr, 1);
    r.run(90, () => v.get('ahrs1.valid') === 1 && v.get('adc1.valid') === 1);
    r.run(5);
    const sensors = { ahrs: v.get('ahrs1.valid'), adc: v.get('adc1.valid'), afcsPow: v.get('elec.afcs_powered'), fd: v.get('ap.fd1_on') };
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const fdOff = { engaged: v.get('ap.engaged'), fdAfter: v.get('ap.fd1_on'), lat: v.getString('ap.lat_active'), vert: v.getString('ap.vert_active') };
    r.events.emit('g3k.gmc.key_fd');
    r.run(0.5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const fdOn = { engaged: v.get('ap.engaged'), fd: v.get('ap.fd1_on'), lat: v.getString('ap.lat_active'), vert: v.getString('ap.vert_active') };
    out.apColdEngage = { sensors, fdOff, fdOn };
  });

  it('engine loss at TO thrust via RUN/STOP: APR active?', { timeout: 200000 }, () => {
    const r = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 3000, iasKt: 170 } });
    const v = r.vars;
    r.run(2);
    r.events.emit('at.disc');
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(6);
    v.set(V.runL, 0);
    r.run(10);
    out.aprRunStop = { aprActive: v.get(V.aprActive), n1_2: v.get('eng2.n1_pct'), n1Limit: v.get('fadec.n1_limit_pct'), rating: v.getString('fadec.rating'), cas: posted(r).slice(0, 5) };
  });

  it('takeoff preset APR arm / SPD knob / xpdr; engine-loss APR at TO thrust', { timeout: 300000 }, () => {
    const r = makeRig('takeoff', { avionics: true, weightLb: 34000 });
    const v = r.vars;
    r.run(2);
    out.takeoffPreset = { aprAuto: v.get(V.aprAuto), spdFms: v.get('g3k.spd_fms'), xpdr: v.get('xpdr1.mode'), apuKnob: v.get(V.apuKnob), toldValid: v.get('g3k.told.to_valid'), vr: v.get('g3k.vspd.VR.kt') };
    // engine loss at TO thrust in the air: APR active on the good engine?
    const r2 = makeRig('cruise', { avionics: true, weightLb: 34000, air: { altFtMsl: 3000, iasKt: 170 } });
    const v2 = r2.vars;
    r2.run(2);
    r2.events.emit('at.disc');
    v2.set(V.tla(1), 1);
    v2.set(V.tla(2), 1);
    r2.run(6);
    r2.sys.failures.trigger('fadec.eng1');
    r2.run(10);
    out.aprOnEngineLoss = { aprActive: v2.get(V.aprActive), n1_2: v2.get('eng2.n1_pct'), aprAuto: v2.get(V.aprAuto), cas: posted(r2).slice(0, 6) };
  });
});
