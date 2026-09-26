import { it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { FUEL, SURF, GEAR } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import type { Turbofan } from '../../../src/physics/engines/Turbofan';
import { B738_FDM } from '../../../src/aircraft/b737-800/fdm';
import { FlatWorld } from '../../physics/helpers';

function mk(fuelKg: number, payloadScale = 1) {
  const vars = new SimVars();
  const main = Math.min(3915, fuelKg / 2);
  vars.set(FUEL.tankKg(0), main);
  vars.set(FUEL.tankKg(1), main);
  vars.set(FUEL.tankKg(2), Math.max(0, fuelKg - 2 * main));
  const fdm = new FlightModel(B738_FDM, vars, new FlatWorld(0), { seed: 1, magneticYear: 2026.7 });
  B738_FDM.mass.stations.forEach((s, i) => fdm.setStationMass(i, s.defaultMass_kg * payloadScale));
  return { vars, fdm };
}

it('probe', () => {
  const lines: string[] = [];
  for (const [fuel, scale] of [[9600, 1], [4000, 0.6], [15000, 1]] as const) {
    const { vars, fdm } = mk(fuel, scale);
    fdm.reposition({ lat: 47, lon: -122, altFtMsl: 35000, headingTrue: 0, iasKt: 270 });
    fdm.step(1 / 120);
    lines.push(`mass ${fdm.mass.toFixed(0)} cg ${vars.get('fdm.cg_pct_mac').toFixed(1)}%`);
  }
  // cruise
  {
    const { vars, fdm } = mk(9600, 1);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), 0);
    fdm.reposition({ lat: 47, lon: -122, altFtMsl: 35000, headingTrue: 0, iasKt: 250 });
    // find IAS for M0.78
    for (const ias of [240, 250, 260, 263, 270, 280]) {
      const t = fdm.computeTrim({ iasKt: ias });
      const tas = t.tas_ms / 0.514444;
      const e = fdm.engines[0] as Turbofan;
      const n1 = e.n1ForThrust(t.thrustN / 2, fdm.engineEnv);
      lines.push(`FL350 ias ${ias} tas ${tas.toFixed(0)} M ${(t.tas_ms / 296.5).toFixed(3)} a ${t.alphaDeg.toFixed(2)} trim ${t.pitchTrim.toFixed(3)} (units ${(8.5 + 8.5 * t.pitchTrim).toFixed(2)}) T ${(t.thrustN / 1000).toFixed(1)}kN n1 ${n1.toFixed(1)} conv ${t.converged}`);
    }
  }
  // stalls: 60 t
  for (const fl of [0, 1, 5, 15, 25, 30, 40]) {
    const { vars, fdm } = mk(9600, 1);
    // tune mass to 60 t
    const extra = 60000 - fdm.mass;
    fdm.setStationMass(1, 4200 + extra);
    vars.set(SURF.flapsDeg, fl);
    vars.set(SURF.slats, fl >= 10 ? 1 : fl > 0 ? 0.5 : 0);
    for (const i of [0, 1, 2]) vars.set(GEAR.pos(i), fl >= 15 ? 1 : 0);
    fdm.reposition({ lat: 47, lon: -122, altFtMsl: 5000, headingTrue: 0, iasKt: 200 });
    let vs = NaN;
    let trimAt = '';
    for (let ias = 220; ias > 80; ias -= 0.5) {
      const t = fdm.computeTrim({ iasKt: ias });
      const st = fdm.aero.effectiveStallAlpha(fl, vars.get(SURF.slats), 0);
      if (!t.converged || t.alphaDeg > st) {
        vs = ias;
        break;
      }
      if (Math.abs(ias - 1.3 * 130) < 0.3 || ias === 150) trimAt += ` @${ias}:${(8.5 + 8.5 * t.pitchTrim).toFixed(2)}u a${t.alphaDeg.toFixed(1)}`;
    }
    lines.push(`flaps ${fl} mass ${fdm.mass.toFixed(0)} cg ${vars.get('fdm.cg_pct_mac').toFixed(1)} Vs ~${vs}${trimAt}`);
  }
  console.log(lines.join('\n'));
});
