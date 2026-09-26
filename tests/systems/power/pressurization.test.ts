import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { FDM } from '../../../src/core/vars';
import { Pressurization, cabinAltitudeForDiff, pressureAtAltitudeFt } from '../../../src/systems/pressurization/Pressurization';
import { PRESS_737NG, PRESS_G650 } from '../../../src/systems/pressurization/presets';

const DT = 1 / 60;

function setAlt(vars: SimVars, ft: number, onGround: boolean): void {
  vars.set(FDM.pressAlt, ft);
  vars.set(FDM.staticPressPa, pressureAtAltitudeFt(ft));
  vars.set(FDM.onGround, onGround ? 1 : 0);
}

function make737(vars: SimVars, extra: Record<string, unknown> = {}): Pressurization {
  return new Pressurization(vars, {
    cabinVolumeM3: 180, // EST 737-800 pressurised volume
    maxDiffPsi: PRESS_737NG.maxDiffPsi,
    reliefPsi: PRESS_737NG.reliefPsi,
    schedule: PRESS_737NG.schedule,
    maxCabinClimbFpm: PRESS_737NG.maxCabinClimbFpm,
    maxCabinDescentFpm: PRESS_737NG.maxCabinDescentFpm,
    inflowKgs: 'pneu.pack_flow_kgs',
    flightAltitude: 'ac.flt_alt',
    landingElevation: 'ac.land_alt',
    groundPrepress: { active: 'ac.takeoff_thrust', psi: 0.1 },
    mode: 'ac.press_mode',
    manualCommand: 'ac.press_manual',
    ...extra,
  });
}

interface Stats {
  maxClimbRate: number;
  maxDescRate: number;
  maxDiff: number;
}

/** Flies a vertical profile; returns observed cabin rate and differential extremes. */
function fly(p: Pressurization, vars: SimVars, from: number, to: number, fpm: number, stats: Stats): void {
  const dir = Math.sign(to - from);
  let h = from;
  while (dir > 0 ? h < to : h > to) {
    h += (dir * fpm * DT) / 60;
    if (dir > 0 ? h > to : h < to) h = to;
    setAlt(vars, h, false);
    p.update(DT);
    const r = vars.get('press.cabin_rate_fpm');
    stats.maxClimbRate = Math.max(stats.maxClimbRate, r);
    stats.maxDescRate = Math.min(stats.maxDescRate, r);
    stats.maxDiff = Math.max(stats.maxDiff, vars.get('press.diff_psi'));
  }
}

function hold(p: Pressurization, vars: SimVars, ft: number, seconds: number, onGround = false): void {
  setAlt(vars, ft, onGround);
  for (let i = 0; i < Math.round(seconds / DT); i++) p.update(DT);
}

describe('Pressurization controller', () => {
  it('helpers: 8,000 ft cabin at FL410 is 8.32 psid; G650 4,850 ft at 51,000 ft is 10.69 psid', () => {
    expect(cabinAltitudeForDiff(41000, 8.35)).toBeCloseTo(7970, -2);
    expect(cabinAltitudeForDiff(51000, 10.7)).toBeCloseTo(4830, -2);
  });

  it('737 profile: ground, climb, cruise at FL410, descent and landing stay on schedule and within rate limits', () => {
    const vars = new SimVars();
    vars.set('pneu.pack_flow_kgs', 1.4);
    vars.set('ac.flt_alt', 41000);
    vars.set('ac.land_alt', 0);
    setAlt(vars, 0, true);
    const p = make737(vars);
    hold(p, vars, 0, 30, true);
    expect(vars.get('press.outflow_pos')).toBeGreaterThan(0.9);
    // Packs blowing through the open valve leave a few hundredths of a psi (limit 0.125 psi for takeoff/landing).
    expect(Math.abs(vars.get('press.diff_psi'))).toBeLessThan(0.05);
    // Takeoff thrust: pre-pressurise ~0.1 psi.
    vars.set('ac.takeoff_thrust', 1);
    hold(p, vars, 0, 60, true);
    expect(vars.get('press.diff_psi')).toBeCloseTo(0.1, 1);
    vars.set('ac.takeoff_thrust', 0);
    const st: Stats = { maxClimbRate: 0, maxDescRate: 0, maxDiff: 0 };
    fly(p, vars, 0, 41000, 2500, st);
    hold(p, vars, 41000, 900);
    expect(vars.get('press.cabin_alt_ft')).toBeGreaterThan(7700);
    expect(vars.get('press.cabin_alt_ft')).toBeLessThan(8150);
    expect(vars.get('press.diff_psi')).toBeGreaterThan(8.1);
    expect(st.maxClimbRate).toBeLessThan(560);
    expect(st.maxDiff).toBeLessThan(PRESS_737NG.maxDiffPsi + 0.15);
    expect(vars.get('press.safety_valve')).toBe(0);
    expect(vars.get('press.outflow_pos')).toBeGreaterThan(0.02);
    expect(vars.get('press.outflow_pos')).toBeLessThan(0.9);
    // Descent to a sea-level field.
    fly(p, vars, 41000, 0, 1500, st);
    expect(st.maxDescRate).toBeGreaterThan(-420);
    expect(vars.get('press.cabin_alt_ft')).toBeLessThan(200);
    // Touchdown: depressurise.
    hold(p, vars, 0, 120, true);
    expect(Math.abs(vars.get('press.diff_psi'))).toBeLessThan(0.05);
    expect(vars.get('press.outflow_pos')).toBeGreaterThan(0.9);
    expect(vars.get('press.cabin_alt_warn')).toBe(0);
    expect(vars.get('press.pax_masks')).toBe(0);
  });

  it('landing at a high field: the cabin is brought to the selected landing altitude', () => {
    const vars = new SimVars();
    vars.set('pneu.pack_flow_kgs', 1.4);
    vars.set('ac.flt_alt', 37000);
    vars.set('ac.land_alt', 5400); // e.g. Denver area
    setAlt(vars, 0, true);
    const p = make737(vars);
    hold(p, vars, 0, 10, true);
    const st: Stats = { maxClimbRate: 0, maxDescRate: 0, maxDiff: 0 };
    fly(p, vars, 0, 37000, 2500, st);
    hold(p, vars, 37000, 300);
    fly(p, vars, 37000, 5400, 1500, st);
    const c = vars.get('press.cabin_alt_ft');
    expect(c).toBeGreaterThan(4900);
    expect(c).toBeLessThan(5400);
  });

  it('pack loss at cruise: the cabin climbs, CABIN ALTITUDE warning at 10,000 ft and masks at 14,000 ft', () => {
    const vars = new SimVars();
    vars.set('pneu.pack_flow_kgs', 1.4);
    vars.set('ac.flt_alt', 41000);
    setAlt(vars, 41000, false);
    const p = make737(vars);
    p.settle();
    hold(p, vars, 41000, 120);
    expect(vars.get('press.cabin_alt_ft')).toBeCloseTo(8000, -2);
    vars.set('pneu.pack_flow_kgs', 0);
    let warnT = -1;
    let maskT = -1;
    for (let i = 0; i < 60 * 900 && maskT < 0; i++) {
      p.update(DT);
      if (warnT < 0 && vars.get('press.cabin_alt_warn') === 1) warnT = i * DT;
      if (maskT < 0 && vars.get('press.pax_masks') === 1) maskT = i * DT;
    }
    expect(warnT).toBeGreaterThan(10);
    expect(maskT).toBeGreaterThan(warnT);
    expect(vars.get('press.outflow_pos')).toBeLessThan(0.02); // controller closed the valve trying to hold
  });

  it('rapid decompression: cabin reaches aircraft altitude within seconds', () => {
    const vars = new SimVars();
    vars.set('pneu.pack_flow_kgs', 0.7);
    setAlt(vars, 45000, false);
    const p = new Pressurization(vars, {
      cabinVolumeM3: 60,
      maxDiffPsi: PRESS_G650.maxDiffPsi,
      reliefPsi: PRESS_G650.reliefPsi,
      schedule: PRESS_G650.schedule,
      inflowKgs: 'pneu.pack_flow_kgs',
    });
    p.settle();
    hold(p, vars, 45000, 60);
    expect(vars.get('press.cabin_alt_ft')).toBeLessThan(4600);
    vars.set('fail.press.decompression', 1);
    hold(p, vars, 45000, 10);
    expect(vars.get('press.cabin_alt_ft')).toBeGreaterThan(40000);
    expect(vars.get('press.pax_masks')).toBe(1);
    expect(vars.get('press.cabin_alt_warn')).toBe(1);
  });

  it('manual mode drives the outflow valve; AUTO failure transfers to ALTN; excess pressure opens the safety valve', () => {
    const vars = new SimVars();
    vars.set('pneu.pack_flow_kgs', 1.4);
    vars.set('ac.flt_alt', 35000);
    setAlt(vars, 35000, false);
    const p = make737(vars);
    p.settle();
    hold(p, vars, 35000, 60);
    vars.set('fail.press.auto', 1);
    hold(p, vars, 35000, 5);
    expect(vars.get('press.mode')).toBe(1);
    expect(vars.get('press.auto_fail')).toBe(1);
    vars.set('fail.press.altn', 1);
    vars.set('ac.press_mode', 2);
    vars.set('ac.press_manual', -1); // close
    hold(p, vars, 35000, 40);
    expect(vars.get('press.outflow_pos')).toBe(0);
    expect(vars.get('press.safety_valve')).toBe(1);
    expect(vars.get('press.diff_psi')).toBeGreaterThan(PRESS_737NG.reliefPsi - 0.05);
    expect(vars.get('press.diff_psi')).toBeLessThan(PRESS_737NG.reliefPsi + 0.2);
    vars.set('ac.press_manual', 1); // open
    hold(p, vars, 35000, 25);
    expect(vars.get('press.outflow_pos')).toBe(1);
    expect(vars.get('press.cabin_rate_fpm')).toBeGreaterThan(1000);
  });

  it('landing elevation from the FMS destination', () => {
    const vars = new SimVars();
    setAlt(vars, 0, true);
    const p = new Pressurization(vars, {
      cabinVolumeM3: 20,
      maxDiffPsi: 8.5,
      schedule: { x: [0, 41000], y: [0, 7580] },
      inflowKgs: 0.3,
      destinationElevation: (id) => (id === 'KASE' ? 7838 : undefined),
    });
    vars.setString('fms.dest', 'KASE');
    p.update(DT);
    expect(vars.get('press.ldg_elev_ft')).toBe(7838);
    expect(p.landingElevation()).toBe(7838);
    p.dispose();
  });
});
