/**
 * Read-only fidelity probes (auditor): print observed behaviour for comparison with FCOM descriptions.
 * Assertions are minimal; the log lines are the output.
 */
import { describe, it } from 'vitest';
import { B738, SPEEDBRAKE } from '../../../../src/aircraft/b737-800/vars';
import { makeB738, press } from '../helpers';

const air = { altFtMsl: 12000, iasKt: 260, headingTrue: 90 };
const log = (...a: unknown[]) => console.log('[PROBE]', ...a);

describe('fidelity probes', () => {
  it('fire test OVHT/FIRE and FAULT/INOP', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(3);
    v.set(B738.fireTest, 1);
    r.run(2);
    const names = ['fire.eng1_warn', 'fire.eng2_warn', 'fire.apu_warn', 'fire.wheel_well_warn', 'fire.cargo_fwd_warn', B738.lt.fireWarn, B738.lt.wheelWell, B738.lt.engOvht(1), B738.lt.engOvht(2), B738.lt.group('ovht_det'), B738.lt.masterCaution, B738.lt.fireHandleApuLt, B738.lt.fireHandleLt(1)];
    log('OVHT/FIRE test', names.map((n) => `${n}=${v.get(n)}`).join(' '));
    v.set(B738.fireTest, 0);
    r.run(1);
    v.set(B738.fireTest, -1);
    r.run(2);
    log('FAULT/INOP test', [B738.lt.fireFault, B738.lt.apuDetInop, B738.lt.group('ovht_det'), B738.lt.masterCaution].map((n) => `${n}=${v.get(n)}`).join(' '));
    v.set(B738.fireTest, 0);
    r.run(1);
    v.set(B738.cargoTest, 1);
    r.run(2);
    log('cargo test', [B738.lt.cargoFire('fwd'), B738.lt.fireWarn, 'alert.master_warning'].map((n) => `${n}=${v.get(n)}`).join(' '));
  });

  it('EEC ALTN effect on N1 at fixed lever', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    v.set('ac.at_arm', 0);
    r.run(3);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0.6);
    r.run(20);
    const n1a = v.get('eng1.n1_pct');
    v.set(B738.eec(1), 0);
    r.run(20);
    log('EEC1 ON N1', n1a.toFixed(2), 'EEC1 ALTN N1', v.get('eng1.n1_pct').toFixed(2), 'eng2', v.get('eng2.n1_pct').toFixed(2), 'light altn', v.get(B738.lt.eecAltn(1)), 'eng six', v.get(B738.lt.group('eng')));
  });

  it('single main fuel pump low pressure -> master caution?', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(5);
    v.set(B738.fuelPump('l_fwd'), 0);
    r.run(3);
    log('one main pump off: lp light', v.get(B738.lt.fuelLowPress('l_fwd')), 'FUEL six', v.get(B738.lt.group('fuel')), 'MC', v.get(B738.lt.masterCaution));
  });

  it('yaw damper with FLT CONTROL B STBY RUD, and emergency exit lights on DC bus 1 loss', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(5);
    log('YD engaged', v.get(B738.ydSw), v.get('yd.active'));
    v.set(B738.fltCtl('b'), -1);
    r.run(2);
    v.set(B738.ydSw, 1);
    r.run(2);
    log('B STBY RUD: YD sw', v.get(B738.ydSw), 'yd.active', v.get('yd.active'), 'stby rud', v.get(B738.stbyRudder), 'stby psi', v.get('hyd.stby_psi').toFixed(0));
    v.set(B738.fltCtl('b'), 1);
    r.run(1);
    v.set('cb.emer_lts', 1);
    v.set('fail.elec.dc1.fault', 1);
    r.run(2);
    log('DC1 fault: dc1 powered', v.get('elec.dc1_powered'), 'emer_lts powered', v.get('elec.emer_lts_powered'), 'emer amps', v.get('elec.emer_lts_amps'));
  });

  it('clock ET: RESET springs back to?', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(3);
    log('ET initial var', v.get(B738.clockEt(1)), 'etS', v.get(B738.lt.clockEtS(1)).toFixed(1));
  });

  it('speedbrake auto deploy on reverse levers (not armed)', () => {
    const r = makeB738({ state: 'approach', air: { altFtMsl: 30, iasKt: 140, headingTrue: 6 } });
    const v = r.vars;
    v.set(B738.speedbrake, SPEEDBRAKE.down);
    r.run(0.5);
    log('air/ground', v.get('gear.air_ground'));
    r.run(20, () => v.get('gear.air_ground') !== 0);
    v.set('ap.engaged', 0);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0);
    r.run(2);
    for (const e of [1, 2] as const) v.set(B738.revLever(e), 0.14);
    r.run(3);
    log('after rev levers: speedbrake lever', v.get(B738.speedbrake).toFixed(2), 'spoilers', v.get('surf.spoilers')?.toFixed?.(2), 'ground spoilers', v.get('spoilers.ground_deployed'), 'wheel kt', v.get('gear.wheel_speed1_kt').toFixed(0));
  });

  it('approach idle with engine anti-ice (flaps up, gear up, flight idle)', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 10000, iasKt: 250, headingTrue: 90 } });
    const v = r.vars;
    v.set('ac.at_arm', 0);
    r.run(2);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0);
    r.run(25);
    const n1 = v.get('eng1.n1_pct');
    v.set(B738.engAi(1), 1);
    v.set(B738.engAi(2), 1);
    r.run(25);
    log('idle N1 no EAI', n1.toFixed(1), 'with EAI', v.get('eng1.n1_pct').toFixed(1));
  });

  it('GEN OFF BUS with engine stopped on GPU; APU battery start ELEC; transfer bus', () => {
    const r = makeB738({ state: 'cold_dark' });
    const v = r.vars;
    v.set(B738.batSw, 1);
    r.run(3);
    const L = B738.lt;
    log('battery only', ['genOffBus1', v.get(L.genOffBus(1))], ['xfrBusOff1', v.get(L.xfrBusOff(1))], ['sourceOff1', v.get(L.sourceOff(1))], ['stbyPwrOff', v.get(L.stbyPwrOff)], ['drive1', v.get(L.drive(1))], ['ac_stby', v.get('elec.ac_stby_powered')], ['dc_stby', v.get('elec.dc_stby_powered')]);
  });

  it('TCAS ABOVE/BELOW, wxr power, adf tone consumers', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(2);
    log('tcas band', v.get('tcas.band_above_ft'), 'wxr.active', v.get('wxr.active'), 'wxr power sw', v.get(B738.wxrPower));
  });

  it('autobrake RTO self test and disarm light; takeoff config with speedbrake armed', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(3);
    v.set(B738.autobrake, 0);
    r.run(1);
    v.set(B738.autobrake, -1);
    let seen = 0;
    r.run(4, () => { if (v.get(B738.lt.autoBrakeDisarm)) seen++; });
    log('RTO select: disarm light frames lit', seen, 'now', v.get(B738.lt.autoBrakeDisarm));
    v.set(B738.parkBrake, 0);
    v.set(B738.speedbrake, SPEEDBRAKE.armed);
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0.7);
    r.run(1);
    log('TOCW speedbrake ARMED', v.get('alert.takeoff_config'), v.get(B738.lt.takeoffConfig));
    for (const e of [1, 2] as const) v.set(B738.tla(e), 0);
  });

  it('APU fire: auto shutdown; APU handle pulled effects', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(3);
    log('apu running', v.get('apu.running'), 'apu bleed open', v.get('pneu.apu_valve_open'));
    v.set('fail.fire.apu', 1);
    r.run(3);
    log('apu fire warn', v.get('fire.apu_warn'), 'apu running', v.get('apu.running'), 'apu n', v.get('apu.n_pct').toFixed(0));
  });
});
