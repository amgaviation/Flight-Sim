/**
 * Cold & dark to engines running, driving only the vars the cockpit controls
 * write, in the OG 17-2..17-4 / 17-11 order: batteries, standby power, APU ON,
 * APU START, (APU bleed after 90 s), right engine RUN + START, left engine RUN +
 * START, APU OFF.
 */
import { describe, expect, it } from 'vitest';
import { makeRig, type Rig } from './helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { LON_LIMITS } from '../../../src/aircraft/citation-longitude/data';

function press(r: Rig, name: string): void {
  r.vars.set(name, 1);
  r.run(0.3);
  r.vars.set(name, 0);
}

describe('Citation Longitude cold & dark start (OG 17)', () => {
  it('starts the APU and both engines, generators on line, start CAS clear', { timeout: 300000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    const v = r.vars;
    expect(v.get('elec.emer_l_powered')).toBe(0);
    expect(v.get('eng1.running')).toBe(0);

    // Cockpit inspection: STBY PWR, BATT L/R ON.
    v.set(V.stbyPwr, 1);
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.ltEmer, 1);
    r.run(3);
    const battV = v.get('elec.emer_l_v');
    expect(battV).toBeGreaterThan(24.5); // Li-ion 26.4 V nominal (OG 5-2)
    expect(v.get('elec.mission_l_powered')).toBe(1);
    expect(v.get('elec.stby_powered')).toBe(1);

    // APU: ON, ~10-15 s self test, START (spring back to ON).
    v.set(V.apuKnob, 1);
    r.run(12);
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    let minBus = 99;
    let apuAvailT = NaN;
    r.run(90, (t) => {
      minBus = Math.min(minBus, v.get('elec.emer_l_v'));
      if (isNaN(apuAvailT) && v.get('apu.avail')) apuAvailT = t;
      return false;
    });
    expect(apuAvailT).toBeLessThan(60); // BCA: "the entire process takes less than a minute"
    expect(minBus).toBeGreaterThan(16); // APU start dip on two Li-ion batteries (bus tied during the start, OG 5-6)
    expect(v.get('elec.apu_gen_online')).toBe(1);
    expect(v.get('elec.bus_tie_closed')).toBe(1); // single primary source on the left side -> automatic tie
    r.run(60); // APU bleed after 90 s (OG 8-2)
    expect(v.get(V.apuBleedReady)).toBe(1);
    expect(v.get(V.startPsi)).toBeGreaterThanOrEqual(LON_LIMITS.minStartPsi); // OG 1-3: >= 32 psi

    // Right engine first (OG 7-6), then left.
    for (const side of [2, 1] as const) {
      const run = side === 1 ? V.runL : V.runR;
      const start = side === 1 ? V.startL : V.startR;
      v.set(run, 1);
      r.run(1);
      expect(v.get(V.startPsi)).toBeGreaterThanOrEqual(LON_LIMITS.minStartPsi);
      press(r, start);
      let peakItt = 0;
      let lightOff = NaN;
      let idleT = NaN;
      r.run(60, (t) => {
        peakItt = Math.max(peakItt, v.get(`eng${side}.itt_c`));
        if (isNaN(lightOff) && v.get(`eng${side}.ff_pph`) > 50) lightOff = t;
        if (isNaN(idleT) && v.get(`eng${side}.running`)) idleT = t;
        return !isNaN(idleT) && t > idleT + 10;
      });
      expect(v.get(`fadec.eng${side}.abort`)).toBe(0);
      expect(idleT).toBeLessThan(35); // BCA: each start "less than 30 s"
      expect(peakItt).toBeLessThan(LON_LIMITS.ittStartC); // OG 1-3 start limit 650 degC
      expect(peakItt).toBeGreaterThan(450);
      expect(lightOff).toBeLessThan(12);
    }
    v.set(V.apuKnob, 0);
    r.run(90);

    // Stabilized idle (EST idle figures in fdm.ts), generators on line and regulated, hydraulics 3,000 psi.
    for (const i of [1, 2]) {
      expect(v.get(`eng${i}.running`)).toBe(1);
      expect(v.get(`eng${i}.n1_pct`)).toBeGreaterThan(20);
      expect(v.get(`eng${i}.n1_pct`)).toBeLessThan(25);
      expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(53);
      expect(v.get(`eng${i}.n2_pct`)).toBeLessThan(58);
      expect(v.get(`eng${i}.itt_c`)).toBeGreaterThan(420);
      expect(v.get(`eng${i}.itt_c`)).toBeLessThan(560);
      expect(v.get(`eng${i}.ff_pph`)).toBeGreaterThan(200);
      expect(v.get(`eng${i}.ff_pph`)).toBeLessThan(320);
      expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(25);
    }
    expect(v.get('elec.gen_l_online')).toBe(1);
    expect(v.get('elec.gen_r_online')).toBe(1);
    expect(v.get('elec.mission_l_v')).toBeGreaterThan(27.5);
    expect(v.get('elec.mission_r_v')).toBeGreaterThan(27.5);
    expect(v.get('elec.bus_tie_closed')).toBe(0); // both sides have their own generator -> tie opens
    expect(v.get('hyd.a_psi')).toBeGreaterThan(2800);
    expect(v.get('hyd.b_psi')).toBeGreaterThan(2800);
    expect(v.get('apu.running')).toBe(0);
    // Start-related CAS messages clear.
    const posted = r.sys.cas.list.filter((e) => e.active).map((e) => e.text);
    for (const t of ['GEN OFF L', 'GEN OFF R', 'GENS OFF', 'HYD PRESS LOW A', 'HYD PRESS LOW B', 'ENGINE FAIL L', 'ENGINE FAIL R', 'BATTERY VOLTS L', 'BATTERY VOLTS R', 'BUS TIE CLOSED', 'FUEL BOOST PUMP ON L', 'FUEL BOOST PUMP ON R', 'ENG EXCEEDANCE L', 'ENG EXCEEDANCE R', 'PTCU NOT NORM']) {
      expect(posted).not.toContain(t);
    }
    expect(v.get('alert.master_warning')).toBe(0);
    // Batteries charging from the generators (OG 5-7: positive = charging).
    expect(v.get('elec.batt_l_amps')).toBeGreaterThanOrEqual(0);
    // Displays up on the G5000.
    expect(v.get('display.pfd1.power')).toBe(1);
    expect(v.get('display.mfd.power')).toBe(1);
  });

  it('dry motoring: START held with RUN/STOP at STOP motors without fuel (OG 7-5)', { timeout: 120000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    const v = r.vars;
    v.set(V.battL, 1);
    v.set(V.battR, 1);
    v.set(V.apuKnob, 1);
    r.run(12);
    v.set(V.apuKnob, 2);
    r.run(0.5);
    v.set(V.apuKnob, 1);
    r.run(140);
    v.set(V.startR, 1);
    let maxN2 = 0;
    r.run(15, () => {
      maxN2 = Math.max(maxN2, v.get('eng2.n2_pct'));
    });
    v.set(V.startR, 0);
    expect(maxN2).toBeGreaterThan(15);
    expect(v.get('eng2.ff_pph')).toBe(0);
    expect(v.get('eng2.running')).toBe(0);
  });
});
