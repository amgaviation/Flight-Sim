/**
 * Citation M2 behavioural fidelity probe (function / systems audit, read-only).
 *
 * Drives cockpit vars headlessly and LOGS what the systems do, so the audit can
 * compare it against the real-aircraft descriptions (CJ-family AFM 525AFM-06,
 * CAE "CJ3 to CJ/CJ1/CJ2 System Differences", Textron M2 S&D). Nothing here
 * asserts real-aircraft behaviour (that would fail on the known gaps); each case
 * only asserts that the rig ran. Output: console lines prefixed "PROBE".
 */
import { describe, expect, it } from 'vitest';
import { M2, TLA, TEST_SEL } from '../../../../src/aircraft/citation-m2/vars';
import { makeM2, press, type Rig } from '../helpers';

const LBKG = 2.20462;
const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  // eslint-disable-next-line no-console
  console.log(`PROBE ${s}`);
};
const cas = (r: Rig) =>
  r.sys.cas.list
    .filter((m) => m.active)
    .map((m) => `${m.level[0].toUpperCase()}:${m.text}`)
    .join(' | ');

describe('M2 function probe', () => {
  it('fuel transfer direction / interlocks', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    const v = r.vars;
    r.run(3);
    const l0 = v.get('fuel.tank0_kg') * LBKG;
    const r0 = v.get('fuel.tank1_kg') * LBKG;
    v.set(M2.fuelXfer, 1); // selector "R TANK"
    r.run(60);
    const l1 = v.get('fuel.tank0_kg') * LBKG;
    const r1 = v.get('fuel.tank1_kg') * LBKG;
    log(`xfer R TANK 60 s: L ${l0.toFixed(0)}->${l1.toFixed(0)}  R ${r0.toFixed(0)}->${r1.toFixed(0)}  boostL ${v.get('fuel.boost_l_on')} boostR ${v.get('fuel.boost_r_on')}  CAS: ${cas(r)}`);
    // Both boost pumps ON with transfer selected (real: no transfer when the receiving tank pump runs).
    v.set(M2.boostSw(1), 1);
    v.set(M2.boostSw(2), 1);
    const l2 = v.get('fuel.tank0_kg') * LBKG;
    const r2 = v.get('fuel.tank1_kg') * LBKG;
    r.run(60);
    log(`xfer R TANK + both boost ON 60 s: L ${l2.toFixed(0)}->${(v.get('fuel.tank0_kg') * LBKG).toFixed(0)} R ${r2.toFixed(0)}->${(v.get('fuel.tank1_kg') * LBKG).toFixed(0)}`);
    v.set(M2.fuelXfer, 0);
    v.set(M2.boostSw(1), 0);
    v.set(M2.boostSw(2), 0);
    // Boost pump behaviour with an engine shut down (throttle CUTOFF), NORM.
    v.set(M2.tla(1), TLA.cutoff);
    r.run(40);
    log(`L eng cutoff 40 s: n2 ${v.get('eng1.n2_pct').toFixed(1)} boostL ${v.get('fuel.boost_l_on')} ejL_lowpress ${v.get('fuel.ejector_l_lowpress')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('ground flaps + high thrust, speed brake / config warnings', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    const v = r.vars;
    r.run(2);
    v.set(M2.flapHandle, 3);
    r.run(25);
    log(`GND flaps idle: flaps ${v.get('surf.flaps_deg').toFixed(1)} sb ${v.get('surf.speedbrake').toFixed(2)} CAS: ${cas(r)}`);
    v.set(M2.tla(1), TLA.to);
    v.set(M2.tla(2), TLA.to);
    r.run(15);
    log(`GND flaps TO thrust: n2 ${v.get('eng1.n2_pct').toFixed(1)} sb ${v.get('surf.speedbrake').toFixed(2)} tocw ${v.get('tocw.active') ?? '-'} warn ${v.get('alert.master_warning')} caut ${v.get('alert.master_caution')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('battery switch EMER / OFF bus power', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2000 });
    const v = r.vars;
    v.set(M2.battSw, -1);
    v.set(M2.avionicsSw, 1);
    r.run(3);
    const ids = ['emer', 'batt_bus', 'l_main', 'r_main', 'l_xfeed', 'r_xfeed', 'avn1', 'avn2', 'pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2', 'gia1', 'gia2', 'adc1', 'adc2', 'ahrs1', 'ahrs2', 'gmc', 'ap_servos', 'audio1', 'audio2', 'xpdr', 'dme', 'pitot_l', 'pitot_r', 'flood_lts', 'gear_ctl', 'flap_ctl', 'esi', 'inverter', 'hyd_brake_pump', 'press_ctl'];
    log(`BATT EMER (engines off): ${ids.map((i) => `${i}=${v.get(`elec.${i}_powered`)}`).join(' ')}`);
    log(`BATT EMER CAS: ${cas(r)}`);
    // Ground running, BATTERY OFF with both generators on.
    const g = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    g.run(2);
    g.vars.set(M2.battSw, 0);
    g.run(3);
    log(`BATT OFF gens on: emer=${g.vars.get('elec.emer_powered')} avn1=${g.vars.get('elec.avn1_powered')} batt_amps=${g.vars.get('elec.batt_amps').toFixed(1)} CAS: ${cas(g)}`);
    g.vars.set(M2.battSw, -1);
    g.run(3);
    log(`BATT EMER gens on: l_main=${g.vars.get('elec.l_main_powered')} r_xfeed=${g.vars.get('elec.r_xfeed_powered')} batt_amps=${g.vars.get('elec.batt_amps').toFixed(1)} CAS: ${cas(g)}`);
    expect(true).toBe(true);
  });

  it('dual generator failure in cruise, then BATT EMER; AP availability', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 25000, iasKt: 240 } });
    const v = r.vars;
    r.run(3);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    log(`AP engaged before: ${v.get('ap.engaged')}`);
    r.events.emit('fail.trigger', 'elec.sg1');
    r.events.emit('fail.trigger', 'elec.sg2');
    r.run(12);
    log(`dual gen fail: warn ${v.get('alert.master_warning')} caut ${v.get('alert.master_caution')} ap ${v.get('ap.engaged')} CAS: ${cas(r)}`);
    v.set(M2.battSw, -1);
    r.run(5);
    log(`dual gen + EMER: ap ${v.get('ap.engaged')} ap_servos ${v.get('elec.ap_servos_powered')} gmc ${v.get('elec.gmc_powered')} pfd1 ${v.get('elec.pfd1_powered')} press_ctl ${v.get('elec.press_ctl_powered')} pitot_r ${v.get('elec.pitot_r_powered')} flood ${v.get('elec.flood_lts_powered')} batt_amps ${v.get('elec.batt_amps').toFixed(1)} CAS: ${cas(r)}`);
    r.events.emit('g3k.gmc.key_ap');
    r.run(2);
    log(`AP re-engage attempt on EMER: ${v.get('ap.engaged')}`);
    expect(true).toBe(true);
  });

  it('ENG FIRE push / reset and generator', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    const v = r.vars;
    r.run(2);
    v.set(M2.engFireBtn(2), 1);
    r.run(3);
    log(`ENG FIRE R pushed: sg2_online ${v.get('elec.sg2_online')} fw_r_open ${v.get('fuel.fw_r_open')} bottle lights ${v.get(M2.bottleLight(1))}/${v.get(M2.bottleLight(2))} CAS: ${cas(r)}`);
    v.set(M2.engFireBtn(2), 0);
    r.run(3);
    log(`ENG FIRE R reset (no GEN RESET): sg2_online ${v.get('elec.sg2_online')} fw_r_open ${v.get('fuel.fw_r_open')}`);
    expect(true).toBe(true);
  });

  it('cabin dump / loss of pressurization / pax masks / emer press', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 35000, iasKt: 230 } });
    const v = r.vars;
    r.run(5);
    log(`FL350 cabin ${v.get('press.cabin_alt_ft').toFixed(0)} dp ${v.get('press.diff_psi').toFixed(2)} ldg ${v.get('press.ldg_elev_ft')} to_field ${v.get(M2.takeoffFieldElevFt)}`);
    v.set(M2.cabinDump, 1);
    let alertAt = -1;
    let masksAt = -1;
    let emerAt = -1;
    r.run(240, () => {
      const c = v.get('press.cabin_alt_ft');
      if (alertAt < 0 && v.get('press.cabin_alt_warn')) alertAt = c;
      if (masksAt < 0 && v.get('press.pax_masks')) masksAt = c;
      if (emerAt < 0 && v.get('pneu.emer_on')) emerAt = c;
    });
    log(`DUMP 240 s: cabin ${v.get('press.cabin_alt_ft').toFixed(0)} (warn at ${alertAt.toFixed(0)}, masks at ${masksAt.toFixed(0)}, emer pack at ${emerAt}) dp ${v.get('press.diff_psi').toFixed(2)} oxy_pax ${v.get('oxy.pax_on')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('pressurization source OFF climb: auto emergency pressurization?', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 35000, iasKt: 230 } });
    const v = r.vars;
    r.run(3);
    v.set(M2.pressSource, 0);
    let t = 0;
    r.run(600, () => {
      t += 1 / 60;
      if (v.get('press.cabin_alt_ft') > 16000) return true;
    });
    log(`PRESS SOURCE OFF: after ${t.toFixed(0)} s cabin ${v.get('press.cabin_alt_ft').toFixed(0)} rate ${v.get('press.cabin_rate_fpm').toFixed(0)} packflow ${v.get('pneu.pack_flow_kgs').toFixed(3)} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('electric trim vs AP and AP/TRIM DISC', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(2);
    r.events.emit('g3k.gmc.key_ap');
    r.run(1);
    const t0 = v.get(M2.pitchTrim);
    v.set(M2.yokeTrim(1), 1);
    r.run(1);
    log(`yoke trim with AP engaged: ap ${v.get('ap.engaged')} trim ${t0.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)}`);
    // AP/TRIM DISC pressed while trimming: does electric trim stop?
    r.events.emit('ap.disc');
    const t1 = v.get(M2.pitchTrim);
    r.run(1);
    log(`AP/TRIM DISC while trimming (switch held): trim ${t1.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)} ap ${v.get('ap.engaged')}`);
    // Pilot vs copilot opposite inputs.
    v.set(M2.yokeTrim(1), 1);
    v.set(M2.yokeTrim(2), -1);
    const t2 = v.get(M2.pitchTrim);
    r.run(1);
    log(`pilot NU + copilot ND: trim ${t2.toFixed(3)}->${v.get(M2.pitchTrim).toFixed(3)} (pilot priority expects increase)`);
    v.set(M2.yokeTrim(1), 0);
    v.set(M2.yokeTrim(2), 0);
    expect(true).toBe(true);
  });

  it('start: beacon, starter, boost, advisories', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2000 });
    const v = r.vars;
    v.set(M2.battSw, 1);
    v.set(M2.avionicsSw, 1);
    v.set(M2.genSw(1), 1);
    v.set(M2.genSw(2), 1);
    v.set(M2.controlLock, 0);
    r.run(2);
    press(r, M2.startBtn(2), 0.3);
    r.run(3);
    log(`START R pressed, anti-coll OFF: light.beacon ${v.get('light.beacon')} start_lt ${v.get(M2.startLight(2))} n2 ${v.get('eng2.n2_pct').toFixed(1)} boostR ${v.get('fuel.boost_r_on')} ign ${v.get('eng2.ignition')} CAS: ${cas(r)}`);
    // Press START while the throttle is still at CUTOFF for 70 s (no light-off): what happens?
    r.run(70);
    log(`START R, throttle CUTOFF 73 s: state ${v.get('fadec.eng2.start_state')} n2 ${v.get('eng2.n2_pct').toFixed(1)} abort ${v.get('fadec.eng2.abort')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('system test positions', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    const v = r.vars;
    r.run(2);
    for (const [name, pos] of Object.entries(TEST_SEL)) {
      v.set(M2.testSel, pos);
      r.run(3);
      log(
        `TEST ${name}: fire_lt ${v.get(M2.engFireLight(1))}/${v.get(M2.engFireLight(2))} fire_warn ${v.get('fire.eng1_warn')} mw ${v.get('alert.master_warning')} mc ${v.get('alert.master_caution')} shaker ${v.get('alert.stick_shaker')} ovsp ${v.get('alert.overspeed')} horn ${v.get('gear.horn')} green ${v.get('gear.green0')} red ${v.get('gear.red0')} taws ${v.get('taws.test') ?? '-'} lamp ${v.get('ac.m2.ckpt_lamp_test')} CAS: ${cas(r)}`,
      );
    }
    v.set(M2.testSel, 0);
    expect(true).toBe(true);
  });

  it('gear cycle hydraulics advisory, ESI after shutdown, anti-ice on ground', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 8000, iasKt: 170 } });
    const v = r.vars;
    r.run(2);
    v.set(M2.gearHandle, 1);
    let sawPress = 0;
    r.run(8, () => {
      if (v.get('cas.hyd_press_on')) sawPress = 1;
    });
    log(`gear down cycle: hyd main max? now ${v.get('hyd.main_psi').toFixed(0)} HYD PRESS ON seen ${sawPress} CAS: ${cas(r)}`);
    // ESI after a shutdown.
    const g = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    g.run(2);
    g.vars.set(M2.tla(1), TLA.cutoff);
    g.vars.set(M2.tla(2), TLA.cutoff);
    g.vars.set(M2.avionicsSw, 0);
    g.run(40);
    g.vars.set(M2.battSw, 0);
    g.run(60);
    log(`after BATT OFF 60 s: esi_powered ${g.vars.get(M2.esiPowered)} esi_on_batt ${g.vars.get('ac.m2.esi_on_batt')} emer ${g.vars.get('elec.emer_powered')} hot_batt ${g.vars.get('elec.hot_batt_powered')}`);
    // Anti-ice on the ground at idle.
    const a = makeM2({ state: 'ready_to_taxi', fuelLb: 2000 });
    a.run(2);
    a.vars.set(M2.engAiSw(1), 1);
    a.vars.set(M2.engAiSw(2), 1);
    a.vars.set(M2.wingAiSw, 1);
    a.vars.set(M2.wsBleedSw(1), 2);
    a.run(90);
    log(`ground idle anti-ice ON 90 s: eai1 ${a.vars.get('pneu.eai1_ok').toFixed(2)} wai ${a.vars.get('pneu.wai_ok').toFixed(2)} bleed ${a.vars.get('pneu.bleed_psi').toFixed(1)} CAS: ${cas(a)}`);
    expect(true).toBe(true);
  });

  it('pressurization on the ground and in-air preset fields', () => {
    const g = makeM2({ state: 'ready_to_taxi', fuelLb: 2000, field: { lat: 39.8, lon: -104.7, elevFt: 5430, courseTrue: 350 } });
    g.run(20);
    log(`KDEN-like ramp 5430 ft: dp ${g.vars.get('press.diff_psi').toFixed(3)} cabin ${g.vars.get('press.cabin_alt_ft').toFixed(0)} to_field ${g.vars.get(M2.takeoffFieldElevFt).toFixed(0)} ldg ${g.vars.get('press.ldg_elev_ft')}`);
    const c = makeM2({ state: 'cruise', fuelLb: 2000, air: { altFtMsl: 30000, iasKt: 250 }, field: { lat: 39.8, lon: -104.7, elevFt: 5430, courseTrue: 350 } });
    c.run(5);
    log(`cruise preset near 5430 ft field: to_field ${c.vars.get(M2.takeoffFieldElevFt)} ldg ${c.vars.get('press.ldg_elev_ft')} cabin ${c.vars.get('press.cabin_alt_ft').toFixed(0)}`);
    const ap = makeM2({ state: 'approach', fuelLb: 1500, air: { altFtMsl: 8500, iasKt: 170 }, field: { lat: 39.8, lon: -104.7, elevFt: 5430, courseTrue: 350 } });
    ap.run(5);
    log(`approach preset over 5430 ft field: to_field ${ap.vars.get(M2.takeoffFieldElevFt)} ldg ${ap.vars.get('press.ldg_elev_ft')} cabin ${ap.vars.get('press.cabin_alt_ft').toFixed(0)} dp ${ap.vars.get('press.diff_psi').toFixed(2)}`);
    expect(true).toBe(true);
  });

  it('CAS during takeoff roll (inhibits) and misc', () => {
    const r = makeM2({ state: 'takeoff', fuelLb: 2000 });
    const v = r.vars;
    r.run(1);
    v.set(M2.tla(1), TLA.to);
    v.set(M2.tla(2), TLA.to);
    let posted = '';
    r.run(15, () => {
      if (v.get('adc1.ias_kt') > 85 && !posted) {
        r.events.emit('fail.trigger', 'elec.sg1');
        posted = 'x';
      }
      if (v.get('adc1.ias_kt') > 100) return true;
    });
    r.run(1.5);
    log(`gen fail at 85 kt on takeoff roll: ias ${v.get('adc1.ias_kt').toFixed(0)} to_inhibit ${v.get('cas.to_inhibit')} caution ${v.get('alert.master_caution')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });
});
