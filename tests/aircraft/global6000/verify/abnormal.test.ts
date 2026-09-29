/**
 * Global 6000 check-ride abnormal / non-routine items (adversarial review):
 *  - V1 cut at MTOW (failures menu `eng1.flameout`): continued take-off, the crew
 *    on rudder / aileron / pitch, gear up with a positive rate; L ENG FLAMEOUT,
 *    no bus or hydraulic loss (ACMP 1B AUTO), the TO rating held through the
 *    second segment (thrust reduction at 1,500 ft), OEI second-segment gradient
 *    against 14 CFR 25.121(b) (>= 2.4 % for a twin);
 *  - engine failure in cruise with the AP engaged: the ACPC / DCPC transfer
 *    break must not reboot the air data or drop the autopilot (avionics
 *    power-interrupt ride-through, systems/electrical.ts PowerHoldup);
 *  - go-around from an approach on TOGA: GA / GA, A/T GA, AP stays engaged,
 *    GA rating held after the gear comes up;
 *  - EMER DEPRESS at FL410: CABIN ALT warning, passenger masks, the cabin held
 *    at the outflow-valve limiter (EST 14,500 ft).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, FIELD, posted } from '../helpers';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, vSpeeds } from '../../../../src/aircraft/global6000/data';

const SL = { ...FIELD, elevFt: 0 };
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

describe('Global 6000 abnormal check-ride items', () => {
  it('V1 cut at MTOW: continued take-off, L ENG FLAMEOUT, TO rating held, OEI second segment >= 2.4 %', () => {
    const w = G6K_LIMITS.mtowLb;
    const r = makeRig('takeoff', { weightLb: w, field: SL });
    const v = r.vars;
    const s = vSpeeds(w);
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    r.pilot.startTakeoff({ vrKt: s.vr, courseTrueDeg: SL.courseTrue, pitchDeg: 11, gearUp: false });
    let failed = false;
    let air = false;
    let pI = 0;
    let thTgt = 0;
    let dist = 0;
    let d400 = NaN;
    let d1000 = NaN;
    let busOffS = 0;
    let minHyd1 = 9999;
    let ratingOk = true;
    let maxBank = 0;
    let maxHdgDev = 0;
    r.run(180, () => {
      const ias = v.get('fdm.ias_kt');
      if (!failed && ias >= s.v1) {
        failed = true;
        r.sys.failures.trigger('eng1.flameout');
      }
      if (!air && r.pilot.phase === 'climb') {
        air = true;
        r.pilot.stop();
        thTgt = v.get('fdm.pitch_deg');
        pI = v.get('input.pitch');
      }
      if (failed) {
        for (const n of [1, 2, 3, 4]) if (!v.get(`elec.ac_bus${n}_powered`)) busOffS += 1 / 60 / 4;
        minHyd1 = Math.min(minHyd1, v.get('hyd.sys1_psi'));
      }
      if (!air) return false;
      const agl = v.get('fdm.alt_agl_ft');
      if (agl < 1400 && v.getString('fadec.rating') !== 'TO') ratingOk = false;
      if (agl > 35 && v.get('fdm.vs_fpm') > 100 && v.get(V.gearHandle) === 1) v.set(V.gearHandle, 0);
      // Crew: rudder to zero sideslip, ~3 deg bank into the live engine on the runway heading, attitude for V2 + 3.
      const beta = v.get('fdm.beta_deg');
      v.set('input.yaw', clamp1(0.15 * beta + 0.05 * v.get('fdm.r_dps')));
      const hdgErr = wrap180(v.get('fdm.hdg_true_deg') - SL.courseTrue);
      maxHdgDev = Math.max(maxHdgDev, Math.abs(hdgErr));
      maxBank = Math.max(maxBank, Math.abs(v.get('fdm.bank_deg')));
      const bankCmd = Math.max(-3, Math.min(8, 3 - 0.5 * hdgErr));
      v.set('input.roll', clamp1(0.06 * (bankCmd - v.get('fdm.bank_deg')) - 0.03 * v.get('fdm.p_dps')));
      thTgt = Math.max(2, Math.min(16, thTgt + (0.12 * (ias - (s.v2 + 3))) / 60));
      const e = thTgt - v.get('fdm.pitch_deg');
      pI = Math.max(-0.8, Math.min(0.8, pI + (0.3 * e) / 60));
      v.set('input.pitch', clamp1(0.25 * e + pI - 0.14 * v.get('fdm.q_dps')));
      dist += (v.get('fdm.gs_kt') * 1.68781) / 60;
      if (isNaN(d400) && agl >= 400) d400 = dist;
      if (isNaN(d1000) && agl >= 1000) d1000 = dist;
      return !isNaN(d1000);
    });
    const grad = (100 * 600) / (d1000 - d400);
    // eslint-disable-next-line no-console
    console.log(`V1 cut: OEI 400-1000 ft gradient ${grad.toFixed(2)} %, max bank ${maxBank.toFixed(1)}, heading dev ${maxHdgDev.toFixed(1)}, min hyd 1 ${minHyd1.toFixed(0)} psi`);
    expect(v.get('fdm.crashed')).toBe(0);
    expect(posted(r)).toContain('caution:L ENG FLAMEOUT');
    expect(v.get('eng1.running')).toBe(0);
    // AC BUS 1 / 2 transfer to VFG 3 / 4 (break-power transfer: a frame or two, within the avionics hold-up).
    for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);
    expect(busOffS).toBeLessThan(0.1);
    expect(minHyd1).toBeGreaterThan(2400); // ACMP 1B AUTO takes over from EDP 1A
    expect(ratingOk).toBe(true);
    expect(v.get('gear.up_locked')).toBe(1);
    expect(grad).toBeGreaterThan(2.4); // 14 CFR 25.121(b)
    expect(grad).toBeLessThan(8); // EST sanity: a twin at MTOW on one engine
    expect(maxBank).toBeLessThan(10);
    expect(maxHdgDev).toBeLessThan(10);
  });

  it('engine failure in cruise with the AP engaged: no air-data reboot, AP and AFDs stay on through the bus transfer', () => {
    const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 35000, iasKt: 260 }, avionics: true });
    const v = r.vars;
    r.run(5);
    expect(v.get('ap.engaged')).toBe(1);
    r.sys.failures.trigger('eng1.flameout');
    let apMin = 1;
    let adcMin = 1;
    let afdMin = 1;
    r.run(30, () => {
      apMin = Math.min(apMin, v.get('ap.engaged'));
      adcMin = Math.min(adcMin, v.get('adc1.valid'), v.get('adc2.valid'));
      for (const d of ['afd1', 'afd2', 'afd3', 'afd4']) afdMin = Math.min(afdMin, v.get(`display.fusion.${d}.power`));
    });
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('elec.gen1_online') + v.get('elec.gen2_online')).toBe(0);
    expect(apMin).toBe(1);
    expect(adcMin).toBe(1);
    expect(afdMin).toBe(1);
    expect(posted(r)).toContain('caution:L ENG FLAMEOUT');
  });

  it('go-around on TOGA: GA / GA, A/T GA, AP engaged, GA rating held after gear up, positive climb', () => {
    const r = makeRig('approach', { weightLb: 75000, air: { altFtMsl: 1500, iasKt: 130 }, avionics: true });
    const v = r.vars;
    r.events.emit('fusion.fcp.ap');
    r.events.emit('fusion.fcp.at');
    r.run(5);
    v.set('input.toga', 1); // TO/GA button on the thrust levers
    r.run(0.3);
    v.set('input.toga', 0);
    expect(v.getString('ap.lat_active')).toBe('GA');
    expect(v.getString('ap.vert_active')).toBe('GA');
    expect(v.getString('ap.at_mode')).toBe('GA');
    let gearUp = false;
    let minAlt = Infinity;
    const alt0 = v.get('fdm.alt_msl_ft');
    r.run(30, (t) => {
      minAlt = Math.min(minAlt, v.get('fdm.alt_msl_ft'));
      if (t > 3 && v.get(V.flapLever) === 4) v.set(V.flapLever, 3); // flaps 16
      if (!gearUp && t > 4 && v.get('fdm.vs_fpm') > 500) {
        gearUp = true;
        v.set(V.gearHandle, 0);
      }
    });
    expect(gearUp).toBe(true);
    expect(v.get('gear.up_locked')).toBe(1);
    expect(v.get('ap.engaged')).toBe(1);
    expect(v.getString('fadec.rating')).toBe('GA');
    expect(v.get('eng1.n1_pct')).toBeGreaterThan(90);
    expect(v.get('fdm.vs_fpm')).toBeGreaterThan(1000);
    expect(alt0 - minAlt).toBeLessThan(150); // height loss in the go-around
    expect(v.get('fdm.ias_kt')).toBeLessThan(G6K_LIMITS.vfe16Kt);
  });

  it('EMER DEPRESS at FL410: CABIN ALT warning, passenger masks, cabin held at the limiter', () => {
    const r = makeRig('cruise', { weightLb: 80000, air: { altFtMsl: 41000, iasKt: 250 }, avionics: true });
    const v = r.vars;
    r.run(5);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(6000);
    v.set(V.emerDepressGuard, 1);
    v.set(V.emerDepress, 1);
    let peak = 0;
    r.run(120, () => {
      peak = Math.max(peak, v.get('press.cabin_alt_ft'));
    });
    expect(posted(r)).toContain('warning:CABIN ALT');
    expect(posted(r)).toContain('caution:EMER DEPRESS'); // GX PTG 13-64: amber caution
    expect(v.get('press.pax_masks')).toBe(1);
    expect(v.get('oxy.pax_on')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(peak).toBeLessThan(G6K_LIMITS.cabinLimiterFt + 2000);
    expect(Math.abs(v.get('press.cabin_alt_ft') - G6K_LIMITS.cabinLimiterFt)).toBeLessThan(1000);
  });
});
