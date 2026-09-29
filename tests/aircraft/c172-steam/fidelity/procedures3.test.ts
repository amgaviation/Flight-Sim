/** Procedures audit probes, part 3 (read-only auditor): POH ext-power start electrical check and run-up alternator check. */
import { describe, it } from 'vitest';
import { ENG } from '../../../../src/core/vars';
import { ANN, C172 } from '../../../../src/aircraft/c172s-common/vars';
import { makeSteamRig, type SteamRig } from '../rig';

const log = (k: string, x: unknown): void => console.log(`[PROC3] ${k}: ${JSON.stringify(x)}`);
function setRpm(r: SteamRig, target: number): number {
  const v = r.vars;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const mid = 0.5 * (lo + hi); v.set(C172.throttle, mid); r.run(3); if (v.get(ENG.rpm(1)) < target) lo = mid; else hi = mid; }
  v.set(C172.throttle, 0.5 * (lo + hi)); r.run(6);
  return v.get(ENG.rpm(1));
}
describe('c172-steam procedures probes 3', () => {
  it('electrical system check (POH 4-13/14 step 15) and alternator check at 1800', () => {
    const r = makeSteamRig({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(3);
    v.set(C172.avionicsBus1, 0); v.set(C172.avionicsBus2, 0);
    v.set(C172.taxi, 1); v.set(C172.land, 1);
    v.set(C172.throttle, 0); r.run(10);
    log('idle, land+taxi ON: rpm / batt amps / VOLTS', [v.get(ENG.rpm(1)), v.get('elec.batt_amps'), v.get(ANN.lowVolts)]);
    setRpm(r, 1500);
    r.run(5);
    log('1500 rpm: batt amps / VOLTS', [v.get('elec.batt_amps'), v.get(ANN.lowVolts)]);
    v.set(C172.land, 0); v.set(C172.taxi, 0);
    setRpm(r, 1800);
    const a0 = v.get('elec.batt_amps');
    v.set(C172.land, 1); r.run(2);
    log('1800 rpm alternator check: amps before / with landing light', [a0, v.get('elec.batt_amps')]);
    v.set(C172.land, 0);
    // 'VOLTS' at low rpm taxi with load (POH Sec 3 note)
    v.set(C172.avionicsBus1, 1); v.set(C172.avionicsBus2, 1); v.set(C172.taxi, 1); v.set(C172.land, 1); v.set(C172.nav, 1); v.set(C172.strobe, 1); v.set(C172.pitotHeat, 1);
    v.set(C172.throttle, 0); r.run(30);
    log('idle ~600 rpm with all loads 30 s: VOLTS / bus V / amps', [v.get(ANN.lowVolts), v.get('elec.bus1_v'), v.get('elec.batt_amps')]);
  });
});
