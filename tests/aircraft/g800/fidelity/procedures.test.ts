/** Read-only procedures/checklist probes (auditor). Logs behaviour; no hard assertions. */
import { describe, it } from 'vitest';
import { makeRig, casTexts, type Rig } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
import { G800_CHECKLISTS } from '../../../../src/aircraft/g800/checklists';
import type { InitialState } from '../../../../src/aircraft/types';

const log = (...a: unknown[]) => console.log('[PROC]', ...a);

function evalLists(r: Rig, titles?: string[]): string[] {
  const out: string[] = [];
  for (const l of G800_CHECKLISTS) {
    if (titles && !titles.includes(l.title)) continue;
    const res = l.items.map((it) => (it.check ? (it.check(r.vars) ? 'Y' : 'n') : '-'));
    const fails = l.items.filter((it) => it.check && !it.check(r.vars)).map((it) => it.challenge);
    out.push(`${l.title}: ${res.join('')} FAIL=[${fails.join(' | ')}]`);
  }
  return out;
}

describe('G800 procedures probes', () => {
  for (const s of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
    it(`state ${s}: checklist autosense`, { timeout: 60000 }, () => {
      const r = makeRig(s, s === 'cruise' ? { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } } : s === 'approach' ? { weightLb: 70000, air: { altFtMsl: 2500, iasKt: 170 } } : {});
      r.run(3);
      for (const l of evalLists(r)) log(s, l);
      const v = r.vars;
      log(s, 'CAS', JSON.stringify(casTexts(r)));
      log(s, 'trim.pitch_units', v.get('trim.pitch_units'), 'surf.pitch_trim', v.get('surf.pitch_trim'), 'fadec.rating', v.getString('fadec.rating'), 'apu.avail', v.get('apu.avail'), 'bleedApu', v.get(V.bleedApu), 'xpdr', v.get('xpdr.mode'));
      log(s, 'warn/caut count', v.get('cas.warning_count'), v.get('cas.caution_count'), 'press.mode', v.get(V.pressMode), 'ldgElev', v.get(V.pressLdgElev));
    });
  }

  it.each([[1,0],[0,0],[0,1]])('cold & dark -> follow G800_CHECKLISTS literally (fire test %i, runFirst %i)', { timeout: 180000 }, (doFireTest: number, runFirst: number) => {
    const r = makeRig('cold_dark', { avionics: runFirst === 1 });
    const v = r.vars;
    r.run(2);
    // Before Starting Engines, in listed order
    v.set(V.parkBrake, 1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(3);
    v.set('ac.door.main', 0);
    v.set(V.apuMaster, 1);
    r.run(12);
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(80, () => v.get('apu.avail') !== 0 && v.get('elec.apu_gen_online') !== 0);
    v.set(V.emerPwr, 1);
    if (doFireTest) v.set(V.fireTest, 1);
    r.run(1);
    log('fireTest='+doFireTest+' fire test CAS', JSON.stringify(casTexts(r, 'warning')), 'unlocks', v.get('ac.g800.fire_l_unlock'), v.get('ac.g800.fire_apu_unlock'));
    v.set(V.fireTest, 0);
    r.run(1);
    const tIrs = r.run(900, () => v.get('ahrs1.valid') !== 0 && v.get('ahrs2.valid') !== 0 && v.get('ahrs3.valid') !== 0);
    log('IRS align time', tIrs, 'apu', v.get('apu.avail'));
    v.set(V.bleedApu, 1);
    v.set(V.ltBeacon, 1);
    r.run(3);
    for (const l of evalLists(r, ['Before Starting Engines'])) log('after BSE', l);
    log('bleeds at start: L', v.get(V.bleedL), 'R', v.get(V.bleedR), 'packs', v.get(V.packL), v.get(V.packR));
    // Engine start
    v.set(V.startMaster, 1);
    r.run(3);
    log('bleed psi', v.get('pneu.l_man_psi').toFixed(1), v.get('pneu.r_man_psi').toFixed(1));
    for (const [i, run, start] of [
      [2, V.runR, V.startR],
      [1, V.runL, V.startL],
    ] as const) {
      if (runFirst) v.set(run, 1);
      v.set(start, 1);
      r.run(0.5);
      v.set(start, 0);
      r.run(6);
      log(`eng${i} after START press 6 s (fuel control still OFF): n2`, v.get(`eng${i}.n2_pct`).toFixed(1), 'n1', v.get(`eng${i}.n1_pct`).toFixed(1), 'status', v.getString(`fadec.eng${i}.start_status`));
      v.set(run, 1);
      let peak = 0;
      let ignOffN2 = NaN;
      let prevIgn = 0;
      r.run(60, () => {
        peak = Math.max(peak, v.get(`eng${i}.itt_c`));
        const ign = v.get(`eng${i}.starter`);
        if (prevIgn && !ign && isNaN(ignOffN2)) ignOffN2 = v.get(`eng${i}.n2_pct`);
        prevIgn = ign;
        return v.getString(`fadec.eng${i}.start_status`) === 'RUN';
      });
      r.run(10);
      log(`eng${i} started: peak TGT`, peak.toFixed(0), 'starter cut N2', ignOffN2.toFixed(1), 'oil', v.get(`eng${i}.oil_press_psi`).toFixed(0), 'hyd L/R', v.get('hyd.left_psi').toFixed(0), v.get('hyd.right_psi').toFixed(0), 'ptu', v.get(V.ptuOn), 'CAS', JSON.stringify(casTexts(r)));
    }
    v.set(V.startMaster, 0);
    r.run(3);
    for (const l of evalLists(r, ['Engine Start'])) log('after ES', l);
    // Before Taxi
    v.set(V.bleedL, 1);
    v.set(V.bleedR, 1);
    v.set(V.packL, 1);
    v.set(V.packR, 1);
    v.set(V.flapLever, 2);
    v.set(V.gndSplrArm, 1);
    v.set(V.ltTaxi, 1);
    r.run(20);
    for (const l of evalLists(r, ['Before Taxi'])) log('after BT', l);
    log('APU bleed still ON after Before Taxi?', v.get(V.bleedApu), 'apu running', v.get('apu.avail'));
    // Before Takeoff
    v.set(V.autobrake, -1);
    v.set(V.ltStrobe, 1);
    v.set(V.ltLandingL, 1);
    v.set(V.ltLandingR, 1);
    v.set(V.parkBrake, 0);
    r.run(3);
    for (const l of evalLists(r, ['Before Takeoff'])) log('after BTO', l);
    log('CAS before TO', JSON.stringify(casTexts(r)));
  });

  it('engine start variants (real G800: FUEL CONTROL RUN then ENGINE START, no start master)', { timeout: 180000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    // stop R engine, then re-start with APU
    v.set(V.runR, 0);
    r.run(40);
    log('R eng stopped: running', v.get('eng2.running'), 'n2', v.get('eng2.n2_pct').toFixed(1));
    // attempt 1: RUN + START without START MASTER (cross-bleed from L engine)
    v.set(V.runR, 1);
    v.set(V.startR, 1);
    r.run(0.5);
    v.set(V.startR, 0);
    r.run(20);
    log('no START MASTER: n2', v.get('eng2.n2_pct').toFixed(1), 'status', v.getString('fadec.eng2.start_status'), 'startReq', v.get(V.startReq(2)));
    // attempt 2: with START MASTER, bleeds ON (engine bleeds left ON during start)
    v.set(V.startMaster, 1);
    v.set(V.startR, 1);
    r.run(0.5);
    v.set(V.startR, 0);
    let peak = 0;
    const t = r.run(80, () => {
      peak = Math.max(peak, v.get('eng2.itt_c'));
      return v.getString('fadec.eng2.start_status') === 'RUN';
    });
    log('START MASTER + RUN first + START, bleeds ON: t', t.toFixed(1), 'peak', peak.toFixed(0), 'L bleed sw', v.get(V.bleedL), 'duct psi', v.get('pneu.r_man_psi').toFixed(1));
    v.set(V.startMaster, 0);
    r.run(2);
    // TGT before start limit (120 C real): does anything block a hot restart?
    v.set(V.runR, 0);
    r.run(5);
    log('5 s after STOP: TGT', v.get('eng2.itt_c').toFixed(0));
    v.set(V.startMaster, 1);
    v.set(V.runR, 1);
    v.set(V.startR, 1);
    r.run(0.5);
    v.set(V.startR, 0);
    r.run(5);
    log('restart with residual TGT: status', v.getString('fadec.eng2.start_status'), 'CAS', JSON.stringify(casTexts(r)));
  });

  it('shutdown checklist literal order from ready_to_taxi', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    v.set(V.parkBrake, 1);
    v.set(V.runL, 0);
    v.set(V.runR, 0);
    r.run(40);
    log('engines off, APU off: L main AC', v.get('elec.l_main_ac_powered'), 'ess dc v', v.get('elec.l_ess_dc_v').toFixed(1), 'CAS', JSON.stringify(casTexts(r)));
    v.set(V.ltBeacon, 0);
    v.set(V.ltStrobe, 0);
    v.set(V.apuMaster, 0);
    v.set(V.emerPwr, 0);
    v.set(V.battL, 0);
    v.set(V.battR, 0);
    r.run(5);
    for (const l of evalLists(r, ['Shutdown'])) log('after SD', l);
    log('left ON after Shutdown list: bleeds', v.get(V.bleedL), v.get(V.bleedR), 'packs', v.get(V.packL), v.get(V.packR), 'boost', v.get(V.boostL), 'nav', v.get(V.ltNav), 'oxy crew', v.get(V.oxyCrew), 'nws', v.get(V.nwsSw), 'wshld', v.get(V.wshldL), 'gndsplr', v.get(V.gndSplrArm), 'flaps', v.get(V.flapLever), 'cabin master', v.get(V.cabinMaster));
    log('ess dc after batt off', v.get('elec.l_ess_dc_powered'), 'ebatt', v.get(V.ebattOn));
  });

  it('APU stop via START/STOP vs MASTER; auto items at APU MASTER ON', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    r.run(1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    r.run(2);
    v.set(V.apuMaster, 1);
    r.run(2);
    log('APU MASTER ON: nav lights', v.get('light.nav_on'), v.get(V.ltNav), 'L boost', v.get('fuel.boost_l_on'), v.get('fuel.l_boost_on'));
    v.set(V.apuStart, 1);
    r.run(0.5);
    v.set(V.apuStart, 0);
    r.run(80, () => v.get('apu.avail') !== 0);
    log('apu avail', v.get('apu.avail'), 'apuStart var', v.get(V.apuStart));
    v.set(V.apuMaster, 0);
    r.run(1);
    log('MASTER OFF 1 s: n', v.get('apu.n_pct'), 'avail', v.get('apu.avail'));
  });
});
