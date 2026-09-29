/**
 * Global 6000 function-lens audit round 3: behaviour probes. Round-3 fix
 * pass: these tests now assert the FIXED behaviour (they would fail on the
 * pre-fix build) and act as the regression guard for the audit gaps
 * G3-01 .. G3-12 (see the audit result / dossier section 19).
 */
import { describe, expect, it } from 'vitest';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, oilPressCaution } from '../../../../src/aircraft/global6000/data';
import { G6K_CAS } from '../../../../src/aircraft/global6000/systems/cas';
import { APU_FUEL_SOV_OPEN } from '../../../../src/aircraft/global6000/systems/logic';
import { makeRig, posted } from '../helpers';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } };

describe('Global 6000 audit round 3 probes', () => {
  it('G3-02: APU start refused at FL410 (37,000 ft start envelope); starts at FL350; auto-shutdown above 45,000 ft', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    expect(v.get('adc1.press_alt_ft')).toBeGreaterThan(39000);
    // APU rotary RUN, then START (spring-loaded back to RUN): refused above the 37,000 ft start envelope (GXAPU).
    v.set(V.apuSw, 1);
    r.run(12); // inlet door + prestart BIT
    v.set(V.apuSw, 2);
    r.run(3);
    v.set(V.apuSw, 1);
    r.run(30);
    expect(v.get('apu.avail')).toBe(0);
    expect(v.get('apu.n_pct')).toBeLessThan(5);
    // Descend into the envelope: the start is accepted.
    r.fdm.reposition({ lat: 45.4706, lon: -73.7408, altFtMsl: 35000, iasKt: 260, headingTrue: 42 });
    r.run(3);
    v.set(V.apuSw, 2);
    r.run(3);
    v.set(V.apuSw, 1);
    const t = r.run(120, () => v.get('apu.avail') !== 0);
    expect(v.get('apu.avail')).toBe(1);
    expect(t).toBeLessThan(120);
    // Climb above the 45,000 ft operating envelope: automatic shutdown (GXAPU).
    r.fdm.reposition({ lat: 45.4706, lon: -73.7408, altFtMsl: 46500, iasKt: 250, headingTrue: 42 });
    r.run(15);
    expect(v.get('apu.avail')).toBe(0);
    expect(v.get('apu.running')).toBe(0);
  });

  it('G3-19 (fixed earlier): windmill relight after eng1.flameout is cleared', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('eng1.flameout');
    r.run(20);
    expect(v.get('eng1.running')).toBe(0);
    expect(posted(r)).toContain('caution:L ENG FLAMEOUT');
    const n2Windmill = v.get('eng1.n2_pct');
    r.sys.failures.clear('eng1.flameout');
    const t = r.run(90, () => v.get('eng1.running') !== 0);
    // BR710 FADEC auto-relight (windmilling core, auto ignition); TCDS 850 C air-start ITT limit (G3-06:
    // hotStartIttAirC in engines.ts).
    expect(n2Windmill).toBeGreaterThan(5); // windmilling core at 250 KIAS
    expect(v.get('eng1.running')).toBe(1);
    expect(t).toBeLessThan(90);
  });

  it('G3-01: HYD 1 LO PRESS posts with the left engine flamed out and both system 1 pumps failed', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    // Compound failure: left engine out (eng1.running = 0), EDP 1A seized, ACMP 1B failed - the old CAS gate
    // (`eng1.running`) suppressed the caution exactly here (GXHY: both pumps of the system below 1,800 psi).
    r.sys.failures.trigger('eng1.flameout');
    r.sys.failures.trigger('hyd.pump1a');
    r.sys.failures.trigger('hyd.pump1b');
    r.run(60, () => v.get('hyd.sys1_psi') < 1500);
    r.run(10);
    expect(v.get('hyd.sys1_psi')).toBeLessThan(G6K_LIMITS.hydLowPsi);
    expect(v.get('eng1.running')).toBe(0);
    expect(posted(r)).toContain('caution:HYD 1 LO PRESS');
  });

  it('G3-03: L ENG OIL LO PRESS uses the E018 N2 schedule (45 psid at 90 % N2)', () => {
    expect(oilPressCaution(90)).toBeCloseTo(45, 1);
    expect(oilPressCaution(60)).toBeCloseTo(35, 1);
    expect(G6K_LIMITS.oilPressCautionPsi).toBe(35);
    // cas.ts now embeds the schedule in the `when` expression (no failure hook forces a partial oil pressure, so the
    // wiring is asserted at the definition level: the N2 breakpoint and the 45 psid upper value are present).
    const oilLo = G6K_CAS.find((m) => m.id === 'l_eng_oil_lo');
    expect(oilLo?.when).toContain('72.3');
    expect(oilLo?.when).toContain('min(45');
    expect(oilLo?.when).toContain('eng1.n2_pct');
  });

  it('G3-04: APU OVERTEMP uses the 714 C continuous limit once on speed (1,020 C during the start)', () => {
    expect(G6K_LIMITS.apuEgtRunMaxC).toBe(714);
    const overtemp = G6K_CAS.find((m) => m.id === 'apu_overtemp');
    expect(overtemp?.when).toContain(String(G6K_LIMITS.apuEgtStartMaxC));
    expect(overtemp?.when).toContain(String(G6K_LIMITS.apuEgtRunMaxC));
    expect(overtemp?.when).toContain('apu.avail');
  });

  it('G3-05: max reverse is ramped toward idle reverse after 30 s (TCDS: N1 70 % for 30 seconds)', () => {
    const r = makeRig('takeoff', { weightLb: 85000 });
    const v = r.vars;
    r.run(2);
    expect(v.get('eng1.running')).toBe(1);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    r.run(1);
    v.set(V.revLever(1), 1);
    r.run(5);
    expect(v.get(`${V.revLever(1)}_eff`)).toBeGreaterThan(0.9); // full reverse commanded
    r.run(30);
    expect(v.get(`${V.revLever(1)}_eff`)).toBeLessThanOrEqual(0.2); // ramped to idle reverse after 30 s
    // Stowing and re-selecting resets the limit.
    v.set(V.revLever(1), 0);
    r.run(3);
    v.set(V.revLever(1), 1);
    r.run(3);
    expect(v.get(`${V.revLever(1)}_eff`)).toBeGreaterThan(0.9);
  });

  it('G3-07: hyd.sys1_hitemp failure drives the fluid past 96 C and posts HYD 1 HI TEMP', () => {
    const r = makeRig('takeoff', { weightLb: 85000 });
    const v = r.vars;
    r.run(2);
    expect(v.get('hyd.sys1_psi')).toBeGreaterThan(1800);
    r.sys.failures.trigger('hyd.sys1_hitemp');
    r.run(240, () => v.get('hyd.sys1_temp_c') > G6K_LIMITS.hydHiTempC + 2);
    expect(v.get('hyd.sys1_temp_c')).toBeGreaterThan(G6K_LIMITS.hydHiTempC);
    r.run(2);
    expect(posted(r)).toContain('caution:HYD 1 HI TEMP');
  });

  it('G3-10: the APU fuel SOV holds its position unpowered; APU FUEL SOV posts on a command/position mismatch', () => {
    const r = makeRig('ready_to_taxi', { weightLb: 80000 });
    const v = r.vars;
    r.run(2);
    // Start the APU.
    v.set(V.apuSw, 1);
    r.run(12);
    v.set(V.apuSw, 2);
    r.run(3);
    v.set(V.apuSw, 1);
    r.run(120, () => v.get('apu.avail') !== 0);
    expect(v.get('apu.avail')).toBe(1);
    expect(v.get(APU_FUEL_SOV_OPEN)).toBe(1);
    // Pull the APU FIRE SOV breaker (DC EMER): the motor-driven valve holds its position - the APU keeps running.
    v.set('cb.apu_fire_sov', 0);
    r.run(10);
    expect(v.get('elec.apu_fire_sov_powered')).toBe(0);
    expect(v.get(APU_FUEL_SOV_OPEN)).toBe(1);
    expect(v.get('apu.running')).toBe(1);
    // APU fire handle with the valve unpowered: the valve cannot move to its commanded (closed) position ->
    // APU FUEL SOV caution (command/position mismatch).
    v.set(V.fireHandle('apu'), 1);
    r.run(6);
    expect(v.get(APU_FUEL_SOV_OPEN)).toBe(1);
    expect(posted(r)).toContain('caution:APU FUEL SOV');
  });

  it('G3-12: EMER DEPRESS cabin climb stays in a plausible band and the 14,500 ft limiter catches it', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(5);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(7000);
    v.set(V.emerDepress, 1);
    // Max 30 s windowed (sustained) cabin climb: the instantaneous rate spikes briefly when the OFV travel limiter
    // releases below 7 psid, so the sustained rate is what the EST valve area is tuned for.
    let maxRate = 0;
    let prevCab = v.get('press.cabin_alt_ft');
    let nextSample = 30;
    r.run(300, (t) => {
      if (t >= nextSample) {
        const cab = v.get('press.cabin_alt_ft');
        maxRate = Math.max(maxRate, ((cab - prevCab) / 30) * 60);
        prevCab = cab;
        nextSample += 30;
      }
      return v.get('press.cabin_alt_ft') > 14000;
    });
    // EST OFV area (environment.ts): dump transient in a plausible few-thousand-fpm band, not the ~80,000 fpm of
    // an unconstrained valve; the dual cabin altitude limiters close the OFVs at 14,500 +/- 500 ft (GX PTG 13-58).
    expect(maxRate).toBeGreaterThan(2000);
    expect(maxRate).toBeLessThan(10000);
    r.run(60);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(15200);
  });

  it('G3-13: AP engagement in the TO vertical mode keeps TO (FSB appendix 6) instead of reverting to PITCH', () => {
    const r = makeRig('takeoff', { weightLb: 80000, avionics: true });
    const v = r.vars;
    r.run(2);
    // TO/GA on the ground arms the FD TO modes.
    v.set('input.toga', 1);
    r.run(0.3);
    v.set('input.toga', 0);
    expect(v.getString('ap.vert_active')).toBe('TO');
    // Take-off roll and rotation.
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.run(90, () => v.get('fdm.ias_kt') > 140);
    v.set('input.pitch', 0.5);
    r.run(60, () => v.get('fdm.alt_agl_ft') > 800);
    expect(v.get('fdm.alt_agl_ft')).toBeGreaterThan(700);
    v.set('input.pitch', 0);
    v.set(V.gearHandle, 0);
    r.run(1);
    expect(v.getString('ap.vert_active')).toBe('TO');
    r.events.emit('fusion.fcp.ap');
    r.run(2);
    expect(v.get('ap.engaged')).toBe(1);
    expect(v.getString('ap.vert_active')).toBe('TO'); // held until another vertical mode is selected
    r.events.emit('fusion.fcp.vs');
    r.run(1);
    expect(v.getString('ap.vert_active')).toBe('VS');
  });
});
