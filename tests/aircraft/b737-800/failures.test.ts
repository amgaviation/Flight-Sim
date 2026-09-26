/**
 * (g) Key failures produce the right annunciations (FCOM 15.20 master caution
 * system; FCOM 6 / 8 / 13 non-normal indications):
 *  - IDG 1 failure in flight: GEN 1 drops off, BUS TRANSFER AUTO powers XFR BUS 1
 *    from IDG 2 (SOURCE OFF 1, no TRANSFER BUS OFF), ELEC six-pack + MASTER CAUTION;
 *    MASTER CAUTION push cancels the master / group lights, RECALL brings them back;
 *  - loss of hydraulic system A (both pumps): ENG 1 / ELEC 2 LOW PRESSURE, FLT CONTROL A
 *    LOW PRESSURE, HYD and FLT CONT six-packs; the flight controls keep flying on B;
 *  - engine 1 fire: master FIRE WARN, fire bell, engine 1 fire handle light; the fire
 *    handle cuts fuel / bleed / generator, the bottle discharge puts the fire out;
 *  - STANDBY POWER with all AC lost: standby buses on the battery.
 */
import { describe, expect, it } from 'vitest';
import { AP, ENG } from '../../../src/core/vars';
import { B738 } from '../../../src/aircraft/b737-800/vars';
import { makeB738 } from './helpers';

const air = { altFtMsl: 12000, iasKt: 260, headingTrue: 90 };

describe('(g) failures', () => {
  it('IDG 1 failure: bus transfer, SOURCE OFF, ELEC + MASTER CAUTION, cancel / recall', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(6);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    v.set('fail.elec.idg1', 1);
    r.run(2);
    expect(v.get('elec.idg1_online')).toBe(0);
    expect(v.get(B738.xfrSrc(1))).toBe(4);
    expect(v.get('elec.xfr1_powered')).toBe(1);
    expect(v.get('cas.source_off1')).toBe(1);
    expect(v.get('cas.xfr_bus_off1')).toBe(0);
    expect(v.get(B738.lt.sourceOff(1))).toBe(1);
    expect(v.get(B738.lt.group('elec'))).toBe(1);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
    expect(v.get('alert.master_caution')).toBe(1);
    // Galley / main buses shed on a single generator in flight.
    expect(v.get('elec.galley_fwd_powered')).toBe(0);
    // MASTER CAUTION push: master and six-pack out, SOURCE OFF stays.
    v.set(B738.masterCaution(1), 1);
    r.run(0.2);
    v.set(B738.masterCaution(1), 0);
    r.run(0.2);
    expect(v.get(B738.lt.masterCaution)).toBe(0);
    expect(v.get(B738.lt.group('elec'))).toBe(0);
    expect(v.get(B738.lt.sourceOff(1))).toBe(1);
    // RECALL (six-pack push and release) re-displays the active fault.
    v.set(B738.recall(2), 1);
    r.run(0.3);
    expect(v.get(B738.lt.group('hyd'))).toBe(1); // all group lights while held
    v.set(B738.recall(2), 0);
    r.run(0.3);
    expect(v.get(B738.lt.group('elec'))).toBe(1);
    expect(v.get(B738.lt.group('hyd'))).toBe(0);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
    // APU start in flight and APU GEN 1 restores the bus source (FCOM non-normal "GEN OFF BUS").
    v.set(B738.apuSw, 2);
    r.run(0.5);
    v.set(B738.apuSw, 1);
    r.run(120, () => v.get('apu.avail') === 1);
    expect(v.get('apu.avail')).toBe(1);
    r.run(2); // APU GEN OFF BUS light on
    expect(v.get(B738.lt.apuGenOffBus)).toBe(1);
    v.set(B738.apuGenSw(1), 1);
    r.run(0.3);
    v.set(B738.apuGenSw(1), 0);
    r.run(1);
    expect(v.get(B738.xfrSrc(1))).toBe(2);
    expect(v.get('cas.source_off1')).toBe(0);
  });

  it('hydraulic system A loss: LOW PRESSURE lights, HYD and FLT CONT master caution, A/P B still flies', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(6);
    v.set('fail.hyd.edp_a', 1);
    v.set('fail.hyd.emdp_a', 1);
    r.run(60, () => v.get('hyd.a_psi') < 500);
    r.run(3);
    expect(v.get('hyd.a_psi')).toBeLessThan(1300);
    for (const id of ['hyd_lp_eng1', 'hyd_lp_elec2', 'fltctl_a_lowpress']) expect(v.get(`cas.${id}`), id).toBe(1);
    expect(v.get(B738.lt.hydLowPress('eng1'))).toBe(1);
    expect(v.get(B738.lt.fltCtlLowPress('a'))).toBe(1);
    expect(v.get(B738.lt.group('hyd'))).toBe(1);
    expect(v.get(B738.lt.group('flt_cont'))).toBe(1);
    expect(v.get(B738.lt.masterCaution)).toBe(1);
    // A/P A needs system A: it disengages; CMD B (system B) can be engaged and holds the aircraft.
    r.run(1);
    r.events.emit('ac.mcp.cmd_b');
    r.run(1);
    r.events.emit('ac.mcp.althld');
    r.run(20);
    expect(v.get(AP.engaged)).toBe(1);
    expect(v.get('ap.cmd_b')).toBe(1);
    expect(Math.abs(v.get('adc1.alt_ft') - 12000)).toBeLessThan(400);
  });

  it('engine 1 fire: FIRE WARN, bell, handle light; handle pull + bottle discharge', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(6);
    v.set('fail.fire.eng1', 1);
    r.run(2);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('cas.eng1_fire')).toBe(1);
    expect(v.get(B738.lt.fireWarn)).toBe(1);
    expect(v.get(B738.lt.fireHandleLt(1))).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    // FIRE WARN push silences the bell and extinguishes the master FIRE WARN lights; the handle stays lit.
    v.set(B738.fireWarnPush(1), 1);
    r.run(0.2);
    v.set(B738.fireWarnPush(1), 0);
    r.run(0.2);
    expect(v.get(B738.lt.fireWarn)).toBe(0);
    expect(v.get(B738.lt.fireHandleLt(1))).toBe(1);
    // ENGINE FIRE checklist: A/T disengage, thrust lever idle, start lever CUTOFF, pull and rotate the handle.
    r.events.emit('at.disc');
    v.set(B738.tla(1), 0);
    v.set(B738.startLever(1), 0);
    v.set(B738.fireHandle(1), 1);
    r.run(1);
    expect(v.get('fire.eng1_armed')).toBe(1);
    // Fire handle: fuel valves closed, engine 1 bleed valve closed, GCB 1 open, EDP A supply closed.
    expect(v.get('fuel.engv1_open')).toBe(0);
    expect(v.get('pneu.bleed1_valve_open')).toBe(0);
    expect(v.get(B738.xfrSrc(1))).not.toBe(1);
    v.set(B738.fireRot(1), -1);
    r.run(0.5);
    v.set(B738.fireRot(1), 0);
    r.run(3);
    expect(v.get('fire.l_btl_discharged')).toBe(1);
    expect(v.get(B738.lt.bottleDischarge('l'))).toBe(1);
    // Second bottle after 30 s if the warning persists (FCOM QRH 8.2).
    if (v.get('fire.eng1_warn') === 1) {
      r.run(30);
      v.set(B738.fireRot(1), 1);
      r.run(0.5);
      v.set(B738.fireRot(1), 0);
      r.run(3);
    }
    expect(v.get('fire.eng1_warn')).toBe(0);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get(ENG.running(2))).toBe(1);
  });

  it('loss of both IDGs in flight: standby power from the battery (STANDBY POWER AUTO)', () => {
    const r = makeB738({ state: 'cruise', air });
    const v = r.vars;
    r.run(6);
    v.set('fail.elec.idg1', 1);
    v.set('fail.elec.idg2', 1);
    r.run(3);
    expect(v.get('elec.xfr1_powered')).toBe(0);
    expect(v.get('elec.xfr2_powered')).toBe(0);
    expect(v.get(B738.stbyOnBatt)).toBe(1);
    expect(v.get('elec.ac_stby_powered')).toBe(1);
    expect(v.get('elec.dc_stby_powered')).toBe(1);
    expect(v.get('elec.inv_online')).toBe(1);
    // Captain's displays (AC standby) stay on; the F/O's go dark.
    expect(v.get('elec.du_capt_out_powered')).toBe(1);
    expect(v.get('elec.du_fo_out_powered')).toBe(0);
    expect(v.get('cas.xfr_bus_off1')).toBe(1);
    expect(v.get('cas.xfr_bus_off2')).toBe(1);
    expect(v.get('elec.batt_amps')).toBeLessThan(-5);
  });
});
