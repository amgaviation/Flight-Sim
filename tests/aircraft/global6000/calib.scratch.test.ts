import { it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { GLOBAL6000_FDM } from '../../../src/aircraft/global6000/fdm';
import { FlatWorld } from '../../physics/helpers';
import type { Turbofan } from '../../../src/physics/engines/Turbofan';
const LB = 0.45359237;
function mk(fuelLb: number) {
  const v = new SimVars();
  const w = new FlatWorld(0, 'asphalt', 0, 45);
  const t = GLOBAL6000_FDM.mass.tanks;
  const per = [0.35, 0.3, 0.35, 0];
  t.forEach((tk, i) => v.set(`fuel.tank${i}_kg`, Math.min(tk.capacity_kg, fuelLb * LB * per[i] + tk.unusable_kg)));
  const f = new FlightModel(GLOBAL6000_FDM, v, w, { seed: 1 });
  return { v, f };
}
it('calib', () => {
  for (const [fuel, alt, mach, flaps, gear] of [[20000, 41000, 0.85, 0, 0], [25000, 41000, 0.85, 0, 0], [45000, 41000, 0.85, 0, 0], [20000, 45000, 0.85, 0, 0], [20000, 3000, 0.22, 30, 1], [10000,10000,0.45,0,0]] as const) {
    const { v, f } = mk(fuel);
    v.set('surf.flaps_deg', flaps); v.set('surf.slats', flaps > 0 ? 1 : 0);
    for (const i of [0, 1, 2]) v.set(`gear.pos${i}`, gear);
    f.reposition({ lat: 45, lon: 0, altFtMsl: alt, headingTrue: 0, iasKt: 200 });
    f.step(1/120);
    // set IAS from mach
    const a = 295.07; // approx
    const tr0 = f.computeTrim({ iasKt: 250 });
    const casForMach = (m: number) => { let lo=50, hi=450; for (let k=0;k<40;k++){ const mid=(lo+hi)/2; f.reposition({ lat:45, lon:0, altFtMsl: alt, headingTrue:0, iasKt: mid}); f.step(1/120); if (v.get('fdm.mach')<m) lo=mid; else hi=mid;} return lo; };
    const ias = mach < 0.3 ? 140 : casForMach(mach);
    f.reposition({ lat: 45, lon: 0, altFtMsl: alt, headingTrue: 0, iasKt: ias });
    f.step(1/120);
    const tr = f.computeTrim({ iasKt: ias });
    const n1 = (f.engines[0] as Turbofan).n1ForThrust(tr.thrustN / 2, f.engineEnv);
    v.set('eng1.n1_cmd_pct', n1); v.set('eng2.n1_cmd_pct', n1); v.set('eng1.fuel_on',1); v.set('eng2.fuel_on',1);
    f.setEnginesRunning(true);
    for (let k = 0; k < 10; k++) f.step(1/120);
    console.log(`W=${(f.mass/LB).toFixed(0)} alt=${alt} ias=${ias.toFixed(1)} M=${v.get('fdm.mach').toFixed(3)} tas=${v.get('fdm.tas_kt').toFixed(1)} a=${tr.alphaDeg.toFixed(2)} trim=${tr.pitchTrim.toFixed(3)} T=${(tr.thrustN/4.448).toFixed(0)}lbf n1=${n1.toFixed(1)} ff=${(v.get('eng1.ff_pph')+v.get('eng2.ff_pph')).toFixed(0)} conv=${tr.converged} maxT=${((f.engines[0] as Turbofan).grossThrust(101, f.engineEnv)/4.448*2).toFixed(0)}`);
  }
});
