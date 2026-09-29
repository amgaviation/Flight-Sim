/**
 * Fix round 2 FMC probes:
 *
 *  G07  Copying the approach first fix into a ROUTE DISCONTINUITY box on the
 *       LEGS page closes the discontinuity (real FMC behaviour, FCOM 11.42
 *       "Remove a route discontinuity") - no DEL workaround needed.
 *  G09  FMC transfer switch: with FMC L failed, BOTH ON R restores the
 *       CDU / FMC data (dual-FMC reversion, FCOM 11).
 */
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { B738, APU_SW } from '../../../../src/aircraft/b737-800/vars';
import { B737_VARS } from '../../../../src/avionics/boeing-737/vars';
import { makeFlightRig, press, cdu, cduEnter, cduScreen, cduSelect, type FlightRig } from '../verify/flightRig';
import { makeB738, loadNav } from '../helpers';

async function makePoweredRig(): Promise<FlightRig> {
  const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
  await db.load();
  const klax = db.airport('KLAX')!;
  const ksfo = db.airport('KSFO')!;
  const rw25r = klax.runways.find((x) => x.ident === '25R')!;
  const r = makeFlightRig({ db, origin: klax, dest: ksfo, start: { lat: rw25r.lat, lon: rw25r.lon, headingTrue: rw25r.headingTrue }, fuelKg: [3500, 3500, 0] });
  const v = r.vars;
  // Quick electrical power-up: battery, GPU connected at the receptacle, GRD PWR ON.
  v.set(B738.batSw, 1);
  v.set(B738.stbyPwrSw, 1);
  v.set(B738.gpuConnected, 1);
  r.run(2);
  press(r, B738.grdPwrSw);
  r.run(2);
  expect(v.get('elec.xfr1_powered')).toBe(1);
  v.set('ac.irs1_mode', 2);
  v.set('ac.irs2_mode', 2);
  v.set(B738.apuSw, APU_SW.on);
  r.run(2);
  return r;
}

describe('737-800 fix round 2 FMC probes', () => {
  it('G07: LEGS-page copy of the approach first fix closes the ROUTE DISCONTINUITY', { timeout: 240_000 }, async () => {
    const r = await makePoweredRig();
    const sys = r.sys;
    // IDENT -> POS INIT -> RTE (same key path as the full-flight ride).
    expect(sys.suite.cdus[0].pageId).toBe('ident');
    // POS INIT is skipped (the probe only edits the route); straight to RTE.
    cdu(r, 'R6'); // POS INIT
    cdu(r, 'R6'); // ROUTE
    expect(sys.suite.cdus[0].pageId).toBe('rte');
    cduEnter(r, 'KLAX', 'L1');
    cduEnter(r, 'KSFO', 'R1');
    cduEnter(r, '25R', 'L3');
    cdu(r, 'NEXT_PAGE');
    cduEnter(r, 'VTU', 'R1');
    cduEnter(r, 'RZS', 'R2');
    cduEnter(r, 'J126', 'L3');
    cduEnter(r, 'SNS', 'R3');
    expect(sys.suite.cdus[0].entryError).toBe('');
    cdu(r, 'R6'); // ACTIVATE
    cdu(r, 'EXEC');
    r.run(0.5);
    cdu(r, 'DEP_ARR', 'R2');
    for (let i = 0; i < 50 && cduScreen(r).join('').includes('LOADING'); i++) {
      await new Promise((res) => setTimeout(res, 50));
      r.run(0.1);
    }
    console.log(cduScreen(r).join('\n'));
    expect(cduSelect(r, 'ILS28R') || cduSelect(r, 'ILS 28R')).toBe(true);
    r.run(0.3);
    cdu(r, 'EXEC');
    r.run(0.5);
    expect(r.sys.suite.fmc!.plans.active.legs.some((l) => l.type === 'DISCO')).toBe(true);
    // LEGS: the box line (ROUTE DISCONTINUITY) and the approach first fix below it. Copy the fix into the box.
    cdu(r, 'LEGS');
    let fixIdent = '';
    let closed = false;
    for (let pg = 0; pg < 4 && !closed; pg++) {
      const lines = cduScreen(r);
      const rowOf = (re: RegExp) => [1, 2, 3, 4, 5].find((row) => re.test(lines[2 * row] ?? ''));
      const boxRow = rowOf(/□|THEN|□/);
      if (boxRow) {
        // The line after the discontinuity is the approach IF.
        const below = lines[2 * (boxRow + 1)] ?? '';
        fixIdent = /^([A-Z0-9]{2,5})/.exec(below.trim())?.[1] ?? '';
        expect(fixIdent).not.toBe('');
        cduEnter(r, fixIdent, `L${boxRow}`); // copy the fix into the box (closes the discontinuity)
        closed = true;
      } else cdu(r, 'NEXT_PAGE');
    }
    expect(closed).toBe(true);
    expect(sys.suite.cdus[0].entryError).toBe('');
    cdu(r, 'EXEC');
    r.run(0.5);
    const legs = r.sys.suite.fmc!.plans.active.legs;
    const idents = legs.map((l) => (l.type === 'DISCO' ? '|' : l.fix?.ident ?? '?'));
    console.log('LEGS after copy:', idents.join(' '));
    // The discontinuity is gone and the copied fix appears exactly once at the junction.
    expect(legs.some((l) => l.type === 'DISCO' && l.segment !== 'missed')).toBe(false);
    expect(idents.filter((x) => x === fixIdent).length).toBe(1);
  });

  it('G09: FMC transfer switch restores the FMC with the opposite computer failed', async () => {
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    const v = r.vars;
    r.run(1);
    expect(v.get(B737_VARS.fmcFailed)).toBe(0);
    // FMC L fails: NORMAL runs on FMC L -> CDU FAIL.
    r.sys.failures.trigger('b738.fmc1');
    r.run(0.5);
    expect(v.get(B737_VARS.fmcFailed)).toBe(1);
    // FMC transfer BOTH ON R: FMC R drives both sides, data restored (FCOM 11).
    v.set(B737_VARS.fmcSel, 1);
    r.run(0.5);
    expect(v.get(B737_VARS.fmcFailed)).toBe(0);
    // FMC R fails too: everything lost again.
    r.sys.failures.trigger('b738.fmc2');
    r.run(0.5);
    expect(v.get(B737_VARS.fmcFailed)).toBe(1);
    // Back to BOTH ON L (FMC L still failed): still failed; repair FMC L -> restored.
    v.set(B737_VARS.fmcSel, -1);
    r.run(0.5);
    expect(v.get(B737_VARS.fmcFailed)).toBe(1);
    r.sys.failures.clear('b738.fmc1');
    r.run(0.5);
    expect(v.get(B737_VARS.fmcFailed)).toBe(0);
  });
});
