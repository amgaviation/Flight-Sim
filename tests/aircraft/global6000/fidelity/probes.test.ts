/**
 * Fidelity probes (function & systems audit, read-only). Each probe records the
 * behaviour of the current build for a control / system whose real behaviour is
 * documented in the Global Express training manuals (IAMS, electrical,
 * hydraulics, fire, APU, lighting, landing gear chapters). The assertions pin
 * the CURRENT behaviour so the audit is reproducible; the log lines give the
 * numbers quoted in the audit.
 */
import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../../src/core/SimVars';
import { G6kLogic } from '../../../../src/aircraft/global6000/systems/logic';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { makeRig, posted } from '../helpers';

const cruise = { weightLb: 80000, fuelLb: 20000, air: { altFtMsl: 41000, iasKt: 250 } };

describe('Global 6000 fidelity probes', () => {
  it('ACMP priority on the APU generator alone (ground): 1B ON starves 3A', () => {
    const v = new SimVars();
    const l = new G6kLogic(v);
    v.set('gear.air_ground', 1);
    v.set('elec.apu_gen_online', 1);
    v.set(V.hydPump('1b'), 2);
    v.set(V.hydPump('3a'), 2);
    l.update(1 / 60);
    const c1b = v.get(V.acmpCmd('1b'));
    const c3a = v.get(V.acmpCmd('3a'));
    console.log('[probe] APU-only ground: 1B cmd', c1b, '3A cmd', c3a);
    expect(c1b).toBe(1);
    expect(c3a).toBe(0); // real: 3A has priority 1 (GXHY ground operation inhibits)
  });

  it('MAN RATE (NORM / HIGH) has no effect on the cabin rate in AUTO or MAN', () => {
    const rate = (sel: number, mode: number) => {
      const r = makeRig('cruise', cruise);
      const v = r.vars;
      r.run(2);
      v.set(V.pressManRate, sel);
      v.set(V.pressAutoMan, mode);
      if (mode === 2) v.set(V.pressManAlt, 1);
      r.run(20);
      return v.get('press.cabin_rate_fpm');
    };
    const autoNorm = rate(0.5, 0);
    const autoHigh = rate(1, 0);
    const manNorm = rate(0.5, 2);
    const manHigh = rate(1, 2);
    console.log('[probe] cabin rate AUTO NORM/HIGH', autoNorm.toFixed(0), autoHigh.toFixed(0), 'MAN UP NORM/HIGH', manNorm.toFixed(0), manHigh.toFixed(0));
    expect(Math.abs(manNorm - manHigh)).toBeLessThan(Math.max(50, Math.abs(manNorm) * 0.05));
  });

  it('EMER DEPRESS with the pressurization in MAN does nothing', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.pressAutoMan, 2);
    r.run(2);
    const c0 = v.get('press.cabin_alt_ft');
    const base = makeRig('cruise', cruise);
    base.run(2);
    base.vars.set(V.pressAutoMan, 2);
    base.run(32);
    v.set(V.emerDepress, 1);
    r.run(30);
    const c1 = v.get('press.cabin_alt_ft');
    console.log('[probe] EMER DEPRESS in MAN: cabin', c0.toFixed(0), '->', c1.toFixed(0), 'MAN baseline (no EMER DEPRESS)', base.vars.get('press.cabin_alt_ft').toFixed(0), 'ofv', v.get('press.outflow_pos'), base.vars.get('press.outflow_pos'));
    expect(Math.abs(c1 - base.vars.get('press.cabin_alt_ft'))).toBeLessThan(500);
  });

  it('RAM AIR ON shuts both packs off (cabin depressurizes at FL410)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.ramAir, 1);
    r.run(60);
    console.log('[probe] RAM AIR: pack cmd', v.get(V.packCmd('l')), v.get(V.packCmd('r')), 'cabin', v.get('press.cabin_alt_ft').toFixed(0), 'CAS', posted(r).filter((x) => /CABIN|PACK|RAM/.test(x)));
    expect(v.get(V.packCmd('l'))).toBe(0);
  });

  it('DITCHING at FL410 closes the outflow valves with the packs running', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.ditching, 1);
    r.run(120);
    console.log('[probe] DITCHING FL410: diff', v.get('press.diff_psi').toFixed(2), 'pack cmd', v.get(V.packCmd('l')), 'safety', v.get('press.safety_valve'), 'CAS', posted(r).filter((x) => /CABIN|DITCH/.test(x)));
    expect(v.get(V.packCmd('l'))).toBe(1);
  });

  it('XBLEED OPEN leaves both engine PRVs commanded open', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    v.set(V.xbleed, 2);
    r.run(5);
    console.log('[probe] XBLEED OPEN: L/R bleed cmd', v.get(V.engBleedCmd('l')), v.get(V.engBleedCmd('r')), 'iso', v.get('pneu.iso_open'), 'CAS', posted(r).filter((x) => /BLEED/.test(x)));
    expect(v.get(V.engBleedCmd('l')) + v.get(V.engBleedCmd('r'))).toBe(2);
  });

  it('MASTER INTEG OFF / AUTO / ON gates the integral lighting (AUTO: photocell, GX PTG 15-11)', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    v.set(V.ltIntegral('ovhd'), 0.8);
    v.set(V.ltMaster, 0);
    r.run(1);
    const off = v.get('ac.light.panel_ovhd');
    v.set(V.ltMaster, 2);
    r.run(1);
    const on = v.get('ac.light.panel_ovhd');
    v.set(V.ltMaster, 1);
    v.set('env.ambient_light', 1);
    r.run(1);
    const autoDay = v.get('ac.light.panel_ovhd');
    v.set('env.ambient_light', 0.05);
    r.run(1);
    const autoNight = v.get('ac.light.panel_ovhd');
    console.log('[probe] integral OVHD MASTER OFF', off, 'ON', on, 'AUTO day / night', autoDay, autoNight);
    expect(off).toBeLessThan(0.05);
    expect(on).toBeGreaterThan(0.5);
    expect(autoDay).toBeLessThan(0.05);
    expect(autoNight).toBeGreaterThan(0.5);
  });

  it('APU fire in flight shuts the APU down automatically at once', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.sys.apu.setRunning(true);
    v.set(V.apuSw, 1);
    r.run(3);
    const before = v.get('apu.state');
    r.sys.failures.trigger('fire.apu');
    r.run(2);
    console.log('[probe] APU fire airborne: state', before, '->', v.get('apu.state'), 'rpm', v.get('apu.rpm_pct')?.toFixed?.(0), 'CAS', posted(r).filter((x) => /APU/.test(x)));
    expect(v.get('apu.avail')).toBe(0);
  });

  it('four AC buses can be isolated from the EMS EMER CNTL page at once', () => {
    const r = makeRig('cruise', cruise);
    const v = r.vars;
    r.run(2);
    for (const n of [1, 2, 3, 4] as const) v.set(V.acBusIsol(n), 1);
    r.run(20);
    console.log('[probe] 4 AC buses MAN OFF: ac1..4', [1, 2, 3, 4].map((n) => v.get(`elec.ac_bus${n}_powered`)), 'RAT', v.get(V.ratDeployed));
    expect(v.get('elec.ac_bus1_powered')).toBe(0);
  });

  it('stick shaker does not disconnect the autopilot (only the pusher does)', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 10000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    const eng = v.get('ap.engaged');
    // Force the SPC to see the shaker AoA with the stall test (ground-only test is bypassed by writing the var).
    v.set(V.stallTest, 1);
    r.run(2);
    console.log('[probe] shaker', v.get('alert.stick_shaker'), 'AP before/after', eng, v.get('ap.engaged'));
    v.set(V.stallTest, 0);
    expect(v.get('alert.stick_shaker') === 0 || v.get('ap.engaged') === eng).toBe(true);
  });

  it('AUTOBRAKE selected on the ground stays at MED (real: springs back to OFF unless armed in the air)', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    v.set(V.autobrake, 2);
    r.run(3);
    console.log('[probe] autobrake on ground: selector', v.get(V.autobrake), 'armed', v.get('brakes.autobrake_armed'), 'CAS', posted(r).filter((x) => /AUTOBRAKE/.test(x)));
    expect(v.get(V.autobrake)).toBe(2);
  });

  it('BATT MASTER OFF with AC power on leaves the APU running', () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.sys.apu.setRunning(true);
    v.set(V.apuSw, 1);
    r.run(3);
    v.set(V.battMaster, 0);
    r.run(3);
    console.log('[probe] BATT MASTER OFF (AC on): apu.state', v.get('apu.state'), 'batt bus', v.get('elec.batt_bus_powered'));
    expect(v.get('apu.state')).toBeGreaterThan(0);
  });
});
