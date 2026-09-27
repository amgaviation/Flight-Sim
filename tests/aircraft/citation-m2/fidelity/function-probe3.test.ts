/** Citation M2 behavioural fidelity probe, part 3 (read-only audit; logs only). */
import { describe, expect, it } from 'vitest';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import { makeM2, press, type Rig } from '../helpers';

const log = (s: string) => {
  // eslint-disable-next-line no-console
  console.log(`PROBE ${s}`);
};
const cas = (r: Rig) =>
  r.sys.cas.list
    .filter((m) => m.active)
    .map((m) => `${m.level[0].toUpperCase()}:${m.text}`)
    .join(' | ');

describe('M2 function probe 3', () => {
  it('preflight power-up CAS and masters', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2000 });
    const v = r.vars;
    v.set(M2.battSw, 1);
    r.run(5);
    log(`BATT on, AVIONICS OFF: mw ${v.get('alert.master_warning')} mc ${v.get('alert.master_caution')} pfd1 ${v.get('elec.pfd1_powered')} CAS: ${cas(r)}`);
    v.set(M2.avionicsSw, 1);
    r.run(60);
    log(`AVIONICS ON 60 s engines off: mw ${v.get('alert.master_warning')} mc ${v.get('alert.master_caution')} CAS: ${cas(r)}`);
    v.set(M2.controlLock, 0);
    press(r, M2.startBtn(2), 0.3);
    r.run(3);
    v.set(M2.tla(2), TLA.idle);
    r.run(45);
    log(`R engine started: n2 ${v.get('eng2.n2_pct').toFixed(1)} itt ${v.get('eng2.itt_c').toFixed(0)} CAS: ${cas(r)} bus ${v.get('elec.batt_bus_v').toFixed(1)}`);
    press(r, M2.startBtn(1), 0.3);
    let minV = 99;
    let peakA = 0;
    r.run(3, () => {
      minV = Math.min(minV, v.get('elec.batt_bus_v'));
    });
    v.set(M2.tla(1), TLA.idle);
    r.run(45, () => {
      minV = Math.min(minV, v.get('elec.batt_bus_v'));
      peakA = Math.max(peakA, v.get('elec.sg2_amps'));
    });
    log(`L start (gen-assisted by R): min bus ${minV.toFixed(1)} V, R gen peak ${peakA.toFixed(0)} A (300 A rating, 450 A 2 min overload) CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('in-flight airstart uses the operating generator?', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 15000, iasKt: 180 } });
    const v = r.vars;
    r.run(5);
    v.set(M2.tla(1), TLA.cutoff);
    r.run(40);
    log(`L shut down in flight: n2 ${v.get('eng1.n2_pct').toFixed(1)} CAS: ${cas(r)}`);
    v.set(M2.tla(1), TLA.cutoff);
    press(r, M2.startBtn(1), 0.3);
    let peakA = 0;
    let peakBatt = 0;
    r.run(5, () => {
      peakA = Math.max(peakA, v.get('elec.sg2_amps'));
      peakBatt = Math.min(peakBatt, v.get('elec.batt_amps'));
    });
    log(`airstart starter: R gen peak ${peakA.toFixed(0)} A, batt min ${peakBatt.toFixed(0)} A (real: starter-assist airstarts are battery only)`);
    v.set(M2.tla(1), TLA.idle);
    r.run(40);
    log(`airstart result: n2 ${v.get('eng1.n2_pct').toFixed(1)} running ${v.get('eng1.running')}`);
    expect(true).toBe(true);
  });

  it('fire test aural / bottle lights, landing lights pulse', () => {
    const r = makeM2({ state: 'takeoff', fuelLb: 2000 });
    const v = r.vars;
    r.run(2);
    v.set(M2.landingLt, 1);
    const seq: string[] = [];
    r.run(2, () => {
      seq.push(`${v.get('light.landing_l').toFixed(0)}${v.get('light.landing_r').toFixed(0)}${v.get('light.recognition').toFixed(0)}`);
    });
    log(`LDG PULSE (landing_l landing_r recog per frame, uniq): ${[...new Set(seq)].join(',')}`);
    expect(true).toBe(true);
  });
});
