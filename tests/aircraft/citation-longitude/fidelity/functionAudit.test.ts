/**
 * Function & systems audit probes (2026-09, third pass). Observation-only: each probe drives the
 * Longitude systems headlessly and records what the model does for a behaviour described in the
 * public sources (OG = Working Title Longitude Operators Guide, DGAC = DGAC Chile C700 card).
 * Skipped unless AMG_FIDELITY_PROBES=1; results go to AMG_PROBE_OUT (JSON).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRig, type Rig } from '../helpers';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';

const RUN = !!process.env.AMG_FIDELITY_PROBES;
const out: Record<string, unknown> = {};
const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level[0]}:${e.text}`);
const g = (r: Rig, names: string[]) => Object.fromEntries(names.map((n) => [n, Math.round(r.vars.get(n) * 1000) / 1000]));

afterAll(() => {
  if (RUN && process.env.AMG_PROBE_OUT) writeFileSync(process.env.AMG_PROBE_OUT, JSON.stringify(out, null, 1));
});

describe.skipIf(!RUN)('Longitude function audit probes', () => {
  it('EIS spoiler indication source (surf.speedbrake) in flight and on the ground', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 20000, iasKt: 260 } });
    r.run(2);
    r.vars.set(V.tla(1), 0);
    r.vars.set(V.tla(2), 0);
    r.vars.set(V.speedbrake, 1);
    r.run(3);
    out.sbFlight = g(r, [V.sbCmd, 'spoilers.sb_ext', 'surf.speedbrake', 'surf.spoilers', 'surf.spoiler_left']);
    expect(true).toBe(true);
  });

  it('standby battery LED with generators online (OG 5-5: amber only when not charging)', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.run(5);
    out.stbyLedGens = { ...g(r, [V.stbyBattLed, 'elec.mission_l_v', 'elec.stby_batt_v', 'elec.stby_batt_amps', 'elec.stby_batt_soc']) };
  });

  it('TO/GA on the ground without the A/T; A/T engaged then throttles to TO without TO/GA (OG 7-5 HOLD)', { timeout: 120000 }, () => {
    const r = makeRig('takeoff', { weightLb: 34000, avionics: true });
    r.run(1);
    r.events.emit('ap.toga');
    r.run(1);
    const toga = { lat: r.vars.getString('ap.lat_active'), vert: r.vars.getString('ap.vert_active'), at: r.vars.get('ap.at_engaged'), atMode: r.vars.getString('ap.at_mode') };
    const r2 = makeRig('takeoff', { weightLb: 34000, avionics: true });
    r2.run(1);
    r2.events.emit('at.engage');
    r2.run(0.5);
    r2.vars.set(V.tla(1), 1);
    r2.vars.set(V.tla(2), 1);
    let modeAt70 = '';
    let minTla = 1;
    r2.run(40, () => {
      if (r2.vars.get('adc1.ias_kt') > 20) minTla = Math.min(minTla, r2.vars.get(V.tla(1)));
      if (r2.vars.get('adc1.ias_kt') > 70 && !modeAt70) modeAt70 = r2.vars.getString('ap.at_mode');
      return r2.vars.get('adc1.ias_kt') > 90;
    });
    out.atGround = { toga, atEngageThenTo: { modeAt70, minTlaDuringRoll: minTla } };
  });

  it('single-battery power-up bus tie latch (OG 5-6)', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark', { avionics: false });
    r.run(1);
    r.vars.set(V.battL, 1);
    r.run(3);
    const one = r.vars.get('elec.bus_tie_closed');
    r.vars.set(V.battR, 1);
    r.run(3);
    const both = r.vars.get('elec.bus_tie_closed');
    r.vars.set(V.battR, 0);
    r.run(3);
    out.singleBatt = { oneBattTie: one, afterSecondBatt: both, afterSecondOffAgain: r.vars.get('elec.bus_tie_closed'), emerR: r.vars.get('elec.emer_r_powered') };
  });

  it('APU start above FL310 in flight (OG 8-2: max in-flight start FL310)', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 41000, iasKt: 240 } });
    r.run(2);
    r.vars.set(V.apuKnob, 1);
    r.run(12);
    r.vars.set(V.apuKnob, 2);
    r.run(1);
    r.vars.set(V.apuKnob, 1);
    r.run(60);
    out.apuHighStart = { ...g(r, ['apu.avail', 'apu.n_pct', 'apu.state', 'elec.apu_gen_online']), cas: posted(r) };
  });

  it('FIRE WARN TEST indications', { timeout: 60000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    r.run(1);
    r.vars.set(V.fireTest, 1);
    r.run(2);
    out.fireTest = { ...g(r, ['fire.eng1_warn', 'fire.eng2_warn', 'fire.apu_warn', 'fire.test', 'alert.master_warning']), cas: posted(r) };
    r.vars.set(V.fireTest, 0);
  });

  it('pedal braking in the air (OG 14-2: disabled after liftoff); emergency gear freefall without hydraulics', { timeout: 120000 }, () => {
    const r = makeRig('approach', { weightLb: 30000, avionics: false, air: { altFtMsl: 5000, iasKt: 170 } });
    r.run(1);
    r.vars.set('input.brake_left', 1);
    r.vars.set('input.brake_right', 1);
    r.run(1);
    const airBrake = g(r, ['gear.brake_left', 'brakes.psi_left']);
    r.vars.set('input.brake_left', 0);
    r.vars.set('input.brake_right', 0);
    // gear up, then kill both hydraulic systems and use the EMER GEAR handle
    r.vars.set(V.gearHandle, 0);
    r.run(10);
    r.vars.set(V.hydPumpA, 2);
    r.vars.set(V.hydPumpB, 2);
    r.vars.set(V.ptcu, 0);
    r.run(20);
    r.vars.set(V.gearHandle, 1);
    r.run(10);
    const noHyd = g(r, ['gear.down_locked', 'hyd.a_psi', 'hyd.b_psi']);
    r.vars.set(V.gearEmer, 1);
    r.run(15);
    out.brakesGear = { airBrake, noHydHandleDown: noHyd, afterEmer: g(r, ['gear.down_locked', 'gear.green0', 'gear.green1']), cas: posted(r) };
  });

  it('ELEC EMER battery endurance estimate (OG 5-2: > 40 min on the EMER buses)', { timeout: 60000 }, () => {
    const r = makeRig('cruise', { weightLb: 32000, avionics: false, air: { altFtMsl: 30000, iasKt: 260 } });
    r.run(2);
    r.vars.set(V.genL, 0);
    r.vars.set(V.genR, 0);
    r.vars.set(V.elecL, 0);
    r.vars.set(V.elecR, 0);
    r.run(10);
    out.emerEndurance = g(r, ['elec.batt_l_amps', 'elec.batt_r_amps', 'elec.emer_l_powered', 'elec.pfd1_powered', 'elec.mfd_powered', 'elec.pfd2_powered', 'elec.gtc2_powered', 'elec.gtc3_powered', 'elec.tcas_powered', 'elec.afcs_powered']);
  });

  it('NAV lights at G5000 power-up (OG 16-3) and beacon default', { timeout: 60000 }, () => {
    const r = makeRig('cold_dark', { avionics: true });
    r.run(1);
    r.vars.set(V.battL, 1);
    r.vars.set(V.battR, 1);
    r.run(30);
    out.navPowerUp = g(r, [V.ltNav, 'light.nav', V.ltBeaconMode, 'elec.pfd1_powered']);
  });
});
