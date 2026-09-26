import { it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { B738_FDM } from '../../../src/aircraft/b737-800/fdm';
import { FlatWorld } from '../../physics/helpers';
it('dbg4', () => {
  const nz = Number(process.env.NZ ?? 3.36);
  const cfgs = { ...B738_FDM, gear: B738_FDM.gear.map((g) => g.name === 'Nose' && !g.isStructure ? { ...g, position_m: [g.position_m[0], 0, nz] as [number, number, number] } : g) };
  const out: string[] = [];
  for (const fuel of [[500, 500, 0], [2000, 2000, 0], [3900, 3900, 0], [3900, 3900, 6000], [3900, 3900, 13000]]) for (const pl of [0, 0.5, 1, 1.4]) {
    const vars = new SimVars();
    fuel.forEach((kg, i) => vars.set(FUEL.tankKg(i), kg));
    const fdm = new FlightModel(cfgs, vars, new FlatWorld(3), { seed: 7, magneticYear: 2026.7 });
    B738_FDM.mass.stations.forEach((s, i) => fdm.setStationMass(i, s.defaultMass_kg * pl));
    fdm.reposition({ lat: 40.85, lon: -74.06, onGround: true, headingTrue: 6 });
    for (let i = 0; i < 240; i++) fdm.step(1 / 120);
    out.push(`fuel ${fuel.join('/')} pl ${pl} m ${fdm.mass.toFixed(0)} cg ${vars.get('fdm.cg_pct_mac').toFixed(1)} pitch ${vars.get('fdm.pitch_deg').toFixed(2)} ra ${vars.get('fdm.radio_alt_ft').toFixed(2)} crash ${vars.get('fdm.crashed')} c0 ${vars.get('gear.compression0').toFixed(2)} c1 ${vars.get('gear.compression1').toFixed(2)}`);
  }
  console.log(out.join('\n'));
});
