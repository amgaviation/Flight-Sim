/**
 * Function & systems audit probes, round 4 (read-only auditor 2026-09-29).
 * Re-checks the open issues handed to this round:
 *  - cold & dark: is the standby display powered? (issue "Cold & dark shows the standby display powered")
 *  - takeoff state stabilizer: chart value for the loaded CG or the old -4.5 deg?
 *  - FDM longitudinal trim gradient vs the OG 17-3 chart in the takeoff configuration.
 * Observation-only; results print to the console and go to AMG_PROBE_OUT when set.
 * Skipped unless AMG_FIDELITY_PROBES=1.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import { makeRig } from '../helpers';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';
import { takeoffStabDeg, stabUnitsFor } from '../../../../src/aircraft/citation-longitude/states';

const RUN = !!process.env.AMG_FIDELITY_PROBES;
const out: Record<string, unknown> = {};

afterAll(() => {
  if (RUN) {
    console.log('AUDIT4', JSON.stringify(out, null, 1));
    if (process.env.AMG_PROBE_OUT) writeFileSync(process.env.AMG_PROBE_OUT, JSON.stringify(out, null, 1));
  }
});

describe.skipIf(!RUN)('Longitude audit round 4 probes', () => {
  it('cold & dark: standby display power and CAS', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    r.run(3);
    const v = r.vars;
    out.coldDark = {
      stbyPwrSw: v.get(V.stbyPwr),
      stbyInstPowered: v.get('elec.stby_inst_powered'),
      stbyBusV: v.get('elec.stby_v'),
      adc3valid: v.get('adc3.valid'),
      emerL: v.get('elec.emer_l_powered'),
      casCount: r.sys.cas.list.filter((e) => e.active).length,
    };
  });

  it('takeoff state: stabilizer follows the OG 17-3 chart for the loaded CG', { timeout: 120000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: false });
    r.run(0.5);
    const v = r.vars;
    const cg = v.get('fdm.cg_pct_mac');
    out.takeoffStab = { cgPctMac: cg, chartDeg: takeoffStabDeg(cg), setDeg: v.get('trim.pitch_units'), toOk: v.get('trim.pitch_to_ok') };
  });

  it('FDM trim gradient vs CG, takeoff configuration (flaps 2, V2-ish)', { timeout: 240000 }, () => {
    const rows: Record<string, number>[] = [];
    const LBK = 0.45359237;
    for (const load of [
      { fwd: 1000, aft: 0, bag: 0 },
      { fwd: 400, aft: 0, bag: 400 },
      { fwd: 0, aft: 0, bag: 1115 },
    ]) {
      const r = makeRig('takeoff', { avionics: false, fuelLb: 8000 });
      r.fdm.setStationMass(2, load.fwd * LBK);
      r.fdm.setStationMass(5, load.bag * LBK);
      r.run(0.5);
      r.fdm.reposition({ lat: 37.65, lon: -97.43, altFtMsl: 3000, iasKt: 130, headingTrue: 15 });
      r.vars.set(V.flapLever, 2);
      r.sys.flaps.setPosition(15);
      r.run(0.2);
      const t = (r.fdm as unknown as { computeTrim(o: { iasKt: number }): { converged: boolean; pitchTrim: number } }).computeTrim({ iasKt: 130 });
      const cg = r.vars.get('fdm.cg_pct_mac');
      rows.push({
        cg: Math.round(cg * 100) / 100,
        chartDeg: Math.round(takeoffStabDeg(cg) * 100) / 100,
        fdmTrimDeg: Math.round(stabUnitsFor(r.sys, Math.max(-1, Math.min(1, t.pitchTrim))) * 100) / 100,
        conv: t.converged ? 1 : 0,
      });
    }
    out.trimGradientTo = rows;
  });

  it('GEN FAIL L posts when the generator trips with the switch ON', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.run(3);
    r.sys.failures.trigger('elec.gen_l');
    r.run(5);
    out.genFail = {
      genLOnline: r.vars.get('elec.gen_l_online'),
      cas: r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level[0]}:${e.text}`),
      busTie: r.vars.get('elec.bus_tie_closed'),
    };
  });
});
