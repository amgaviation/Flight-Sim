import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { CITATION_M2_FDM } from '../../../src/aircraft/citation-m2/fdm';
import { FlightModel } from '../../../src/physics/FlightModel';
import type { Turbofan } from '../../../src/physics/engines/Turbofan';
import { SimVars } from '../../../src/core/SimVars';
import { FlatWorld } from '../../physics/helpers';
import { casFromTas } from '../../../src/physics/atmosphere';
import { isaPressure, isaTemperature } from '../../../src/physics/atmosphere';

const LB = 0.45359237;
function mk(weightLb: number, flaps: number, gear: number) {
  const vars = new SimVars();
  const cfg = CITATION_M2_FDM;
  const fuel = weightLb * LB - cfg.mass.emptyMass_kg - 200 * LB;
  const f2 = Math.min(fuel, 1400); vars.set('fuel.tank0_kg', f2 / 2); vars.set('fuel.tank1_kg', f2 / 2);
  vars.set('surf.flaps_deg', flaps);
  for (const i of [0, 1, 2]) vars.set(`gear.pos${i}`, gear);
  const fdm = new FlightModel(cfg, vars, new FlatWorld(0), { seed: 1, magneticYear: 2026.7 });
  fdm.setStationMass(3, Math.max(0, fuel - 1400));
  return { vars, fdm };
}
it('calib', () => {
  const out: string[] = [];
  for (const [w, f, v0] of [[10700, 0, 98], [10700, 15, 92], [10700, 35, 86], [9900, 0, 95], [7500, 35, 73]] as const) {
    const { vars, fdm } = mk(w, f, 1);
    fdm.reposition({ lat: 40, lon: -74, altFtMsl: 5000, headingTrue: 0, iasKt: 150 });
    let vs = NaN;
    for (let v = 130; v >= 60; v -= 0.5) {
      const t = fdm.computeTrim({ iasKt: v });
      const st = fdm.aero.effectiveStallAlpha(f, 0, 0);
      if (!t.converged || t.alphaDeg > st - 0.05) { vs = v + 0.5; break; }
    }
    out.push(`stall w=${w} f=${f}: ${vs} (pub ${v0}) mass=${vars.get('fdm.mass_kg')}`);
  }
  // cruise
  for (const [alt, ktas, pph, w] of [[33000, 403, 997, 9500], [41000, 385, 678, 9500], [35000, 401, 920, 9500], [25000, 377, 1122, 9500]] as const) {
    const { vars, fdm } = mk(w, 0, 0);
    const H = alt * 0.3048; const p = isaPressure(H), T = isaTemperature(H);
    const cas = casFromTas(ktas * 0.514444, p, T) / 0.514444;
    fdm.reposition({ lat: 40, lon: -74, altFtMsl: alt, headingTrue: 0, iasKt: cas });
    const t = fdm.computeTrim({ iasKt: cas });
    const e = fdm.engines[0] as Turbofan;
    fdm.step(1/120);
    const n1 = e.n1ForThrust(t.thrustN / 2, fdm.engineEnv);
    vars.set('eng1.n1_cmd_pct', n1); vars.set('eng2.n1_cmd_pct', n1); vars.set('eng1.fuel_on',1); vars.set('eng2.fuel_on',1);
    fdm.setEnginesRunning(true);
    for (let i=0;i<240;i++) fdm.step(1/120);
    out.push(`cruise FL${alt/100} ${ktas}kt: cas ${cas.toFixed(1)} T/eng ${(t.thrustN/2/4.448).toFixed(0)} lbf n1 ${n1.toFixed(1)} ff ${(2*vars.get('eng1.ff_pph')).toFixed(0)} (pub ${pph}) trim ${t.pitchTrim.toFixed(2)} alpha ${t.alphaDeg.toFixed(1)} mach ${vars.get('fdm.mach').toFixed(3)}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Smart-House/bac8bdb5-ed02-5dee-82cb-3c8efba4f51c/scratchpad/calib.txt', out.join('\n'));
});
