/**
 * Global 6000 function-lens audit round 3: behaviour probes. Each test PINS
 * THE CURRENT BUILD'S BEHAVIOUR so the suite stays green; where that behaviour
 * deviates from the real aircraft the comment names the deviation and its
 * source (the gap is reported in the audit result, not fixed here).
 */
import { describe, expect, it } from 'vitest';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, oilPressCaution } from '../../../../src/aircraft/global6000/data';
import { G6K_CAS } from '../../../../src/aircraft/global6000/systems/cas';
import { makeRig, posted } from '../helpers';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } };

describe('Global 6000 audit round 3 probes', () => {
  it('GAP: APU starts and runs at FL410 (GXAPU: start envelope 37,000 ft, operating envelope 45,000 ft)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    expect(v.get('adc1.press_alt_ft')).toBeGreaterThan(39000);
    // APU rotary RUN, then START (spring-loaded back to RUN).
    v.set(V.apuSw, 1);
    r.run(12); // inlet door + prestart BIT
    v.set(V.apuSw, 2);
    r.run(3);
    v.set(V.apuSw, 1);
    const t = r.run(120, () => v.get('apu.avail') !== 0);
    // CURRENT BUILD: the APU start succeeds far above the 37,000 ft start envelope
    // (data.ts apuStartCeilingFt / apuOperatingCeilingFt exist but nothing consumes them;
    // the shared Apu block only takes bleedCeilingFt).
    expect(v.get('apu.avail')).toBe(1);
    expect(t).toBeLessThan(120);
  });

  it('windmill relight after eng1.flameout is cleared: documents the current behaviour', () => {
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
    // Record whichever way the shared start controller behaves so a change is caught.
    // Real aircraft: the FADEC provides auto-relight (windmill or starter-assisted); the
    // TCDS 850 C air-start ITT limit applies. The dossier section 17 lists the in-flight
    // start envelope as not modelled.
    const relit = v.get('eng1.running') !== 0;
    expect(n2Windmill).toBeGreaterThan(5); // windmilling core at 250 KIAS
    expect(relit).toBe(true); // pinned: the shared controller auto-relights once the failure clears
    expect(t).toBeLessThan(90);
  });

  it('GAP: L ENG OIL LO PRESS uses the fixed 35 psi limit; the E018 N2 schedule (45 psid at 90 % N2) is defined but unused', () => {
    // data.ts exports oilPressCaution(n2) implementing E018 (35 psid to 72.3 % N2 rising to
    // 45 psid at 90 %), but cas.ts compares against the constant oilPressCautionPsi.
    expect(oilPressCaution(90)).toBeCloseTo(45, 1);
    expect(oilPressCaution(60)).toBeCloseTo(35, 1);
    expect(G6K_LIMITS.oilPressCautionPsi).toBe(35);
    // At cruise N2 (> 90 %), an oil pressure of 40 psid should post the caution per E018;
    // with the fixed threshold it does not (static finding; no failure hook forces a
    // partial oil-pressure value, so this is asserted at the definition level).
  });

  it('GAP: APU OVERTEMP triggers only above the 1,020 C start limit; the 714 C running limit is defined but unused', () => {
    // cas.ts apu_overtemp: when apu.egt_c > apuEgtStartMaxC (1,020 C). GXAPU gives a far
    // lower continuous running EGT limit (G6K_LIMITS.apuEgtRunMaxC = 714 C, unused).
    expect(G6K_LIMITS.apuEgtRunMaxC).toBe(714);
    const overtemp = G6K_CAS.find((m) => m.id === 'apu_overtemp');
    expect(overtemp?.when).toContain(String(G6K_LIMITS.apuEgtStartMaxC)); // fixed 1,020 C threshold
    expect(overtemp?.when).not.toContain('714');
  });
});
