/**
 * Citation M2 behavioural fidelity probe, part 2 (read-only audit; logs only, see function-probe.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import { makeM2, type Rig } from '../helpers';

const log = (s: string) => {
  // eslint-disable-next-line no-console
  console.log(`PROBE ${s}`);
};
const cas = (r: Rig) =>
  r.sys.cas.list
    .filter((m) => m.active)
    .map((m) => `${m.level[0].toUpperCase()}:${m.text}`)
    .join(' | ');

describe('M2 function probe 2', () => {
  it('electric trim vs AP engaged, AP/TRIM DISC', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const t0 = v.get(M2.pitchTrim);
    v.set(M2.yokeTrim(1), 1);
    r.run(1);
    log(`yoke trim NU 1 s with AP engaged: ap ${v.get('ap.engaged')} trim ${t0.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)}`);
    v.set(M2.yokeTrim(1), 0);
    r.run(1);
    // AP engaged; AP/TRIM DISC button.
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    log(`AP re-engaged: ${v.get('ap.engaged')} yd ${v.get('ap.yd_engaged')}`);
    r.events.emit('ap.disc');
    r.run(0.5);
    log(`after AP/TRIM DISC: ap ${v.get('ap.engaged')} yd ${v.get('ap.yd_engaged')} disc tone/warn ${v.get('ap.disc_warn')}`);
    // Trim runaway failure: can the pilot stop it (AP/TRIM DISC hold / PITCH TRIM CB)?
    r.events.emit('fail.trigger', 'trim.pitch.runaway');
    const t1 = v.get(M2.pitchTrim);
    r.events.emit('ap.disc');
    r.run(2);
    log(`pitch trim runaway + AP/TRIM DISC press: trim ${t1.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)} CAS: ${cas(r)}`);
    v.set('cb.trim_pitch', 0);
    const t2 = v.get(M2.pitchTrim);
    r.run(2);
    log(`runaway + PITCH TRIM CB pulled: trim ${t2.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)}`);
    expect(true).toBe(true);
  });

  it('TO/GA in flight with AP engaged', () => {
    const r = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 3000, iasKt: 150 } });
    const v = r.vars;
    r.run(5);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const ap0 = v.get('ap.engaged');
    r.events.emit('ap.toga');
    r.run(1);
    log(`TO/GA in flight: ap ${ap0}->${v.get('ap.engaged')} modes ${v.getString('ap.lat_active')}/${v.getString('ap.vert_active')} rating ${v.getString('fadec.rating') || v.get('fadec.rating_code')}`);
    expect(true).toBe(true);
  });

  it('wing anti-ice at flight idle / bleed CB / press controller CB', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(5);
    v.set(M2.wingAiSw, 1);
    v.set(M2.engAiSw(1), 1);
    v.set(M2.engAiSw(2), 1);
    v.set(M2.tla(1), TLA.idle);
    v.set(M2.tla(2), TLA.idle);
    r.run(90);
    log(`FL200 idle, wing/eng A/I ON 90 s: n2 ${v.get('eng1.n2_pct').toFixed(1)} wai_ok ${v.get('pneu.wai_ok').toFixed(2)} eai1 ${v.get('pneu.eai1_ok').toFixed(2)} bleed ${v.get('pneu.bleed_psi').toFixed(1)} CAS: ${cas(r)}`);
    const c = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 30000, iasKt: 240 } });
    c.run(5);
    const flow0 = c.vars.get('pneu.pack_flow_kgs');
    c.vars.set('cb.bleed_ctl_l', 0);
    c.vars.set('cb.bleed_ctl_r', 0);
    c.run(60);
    log(`both BLEED CTL CBs pulled 60 s at FL300: pack flow ${flow0.toFixed(3)}->${c.vars.get('pneu.pack_flow_kgs').toFixed(3)} cabin ${c.vars.get('press.cabin_alt_ft').toFixed(0)} rate ${c.vars.get('press.cabin_rate_fpm').toFixed(0)} CAS: ${cas(c)}`);
    const p = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 30000, iasKt: 240 } });
    p.run(5);
    p.vars.set('cb.press_ctl', 0);
    p.run(60);
    log(`PRESS CONT CB pulled 60 s: cabin ${p.vars.get('press.cabin_alt_ft').toFixed(0)} valve ${p.vars.get('press.outflow_pos').toFixed(2)} CAS: ${cas(p)}`);
    p.vars.set(M2.pressMode, 2);
    p.vars.set(M2.cabinDump, 1);
    p.run(30);
    log(`MANUAL mode + CABIN DUMP 30 s: cabin ${p.vars.get('press.cabin_alt_ft').toFixed(0)} rate ${p.vars.get('press.cabin_rate_fpm').toFixed(0)}`);
    expect(true).toBe(true);
  });

  it('takeoff config: trim out of band, flaps 0 vs 15 detents', () => {
    const r = makeM2({ state: 'takeoff', fuelLb: 2000 });
    const v = r.vars;
    r.run(1);
    v.set(M2.pitchTrim, -0.6);
    v.set(M2.parkBrake, 1);
    v.set(M2.tla(1), TLA.to);
    v.set(M2.tla(2), TLA.to);
    r.run(3);
    log(`TO thrust trim ND: config ${v.get('alert.takeoff_config')} text ${v.getString('tocw.text')} mw ${v.get('alert.master_warning')} mc ${v.get('alert.master_caution')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('gear horn airspeed source, stall AP disconnect, shaker', () => {
    const r = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 5000, iasKt: 150 } });
    const v = r.vars;
    r.run(5);
    v.set(M2.gearHandle, 0);
    r.run(8);
    v.set(M2.tla(1), TLA.idle);
    v.set(M2.tla(2), TLA.idle);
    r.run(20, () => v.get('adc1.ias_kt') < 125);
    log(`gear up, idle, ias ${v.get('adc1.ias_kt').toFixed(0)}: horn ${v.get('gear.horn')} CAS: ${cas(r)}`);
    r.events.emit('gear.horn_silence');
    r.run(1);
    log(`after HORN SILENCE: horn ${v.get('gear.horn')}`);
    v.set(M2.tla(1), 0.9);
    r.run(3);
    v.set(M2.tla(1), TLA.idle);
    r.run(3);
    log(`throttle advanced then idle again: horn ${v.get('gear.horn')} (real CJ: re-arms when throttle advanced)`);
    expect(true).toBe(true);
  });

  it('avionics DISPATCH and OFF loads', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2000 });
    const v = r.vars;
    v.set(M2.battSw, 1);
    v.set(M2.avionicsSw, -1);
    r.run(3);
    const ids = ['avn1', 'avn2', 'pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2', 'gia1', 'gia2', 'adc1', 'ahrs1', 'gmc', 'ap_servos', 'audio1', 'xpdr', 'esi', 'gea'];
    log(`AVIONICS DISPATCH: ${ids.map((i) => `${i}=${v.get(`elec.${i}_powered`)}`).join(' ')} batt_amps ${v.get('elec.batt_amps').toFixed(1)}`);
    v.set(M2.avionicsSw, 0);
    r.run(2);
    log(`AVIONICS OFF (BATT on): ${ids.map((i) => `${i}=${v.get(`elec.${i}_powered`)}`).join(' ')} CAS power ${v.get('elec.gea_powered')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('boost pump low-pressure latch & fuel low level', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 360, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(10);
    log(`180 lb/tank: CAS: ${cas(r)} boostL ${v.get('fuel.boost_l_on')}`);
    r.events.emit('fail.trigger', 'fuel.ejector_l');
    r.run(5);
    log(`ejector L failed: boostL ${v.get('fuel.boost_l_on')} feed psi ${v.get('fuel.eng1_psi').toFixed(1)} CAS: ${cas(r)}`);
    r.events.emit('fail.clear', 'fuel.ejector_l');
    r.run(5);
    log(`ejector L restored: boostL ${v.get('fuel.boost_l_on')} (real CJ: stays on until switch cycled)`);
    expect(true).toBe(true);
  });
});
