/**
 * Citation M2 procedures probe, part 2 (read-only audit): app-default cruise
 * preset, boost pump / CAS during a battery start, takeoff-config warning with
 * ground flaps, electric trim runaway vs AP/TRIM DISC, GEN OFF / OIL PRESS with
 * an engine shut down in flight, emergency restart. Logs only ("PROC2").
 */
import { describe, expect, it } from 'vitest';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import { M2_META } from '../../../../src/aircraft/citation-m2/meta';
import { M2_CHECKLISTS } from '../../../../src/aircraft/citation-m2/checklists';
import { cruiseIas } from '../../../../src/ui/startPosition';
import { makeM2, press, type Rig } from '../helpers';

const log = (s: string) => {
  // eslint-disable-next-line no-console
  console.log(`PROC2 ${s}`);
};
const cas = (r: Rig) =>
  r.sys.cas.list
    .filter((m) => m.active)
    .map((m) => `${m.level[0].toUpperCase()}:${m.text}`)
    .join(' | ');
function audit(r: Rig, title: string): string {
  const cl = M2_CHECKLISTS.find((c) => c.title === title)!;
  return cl.items.map((it) => `${it.challenge}=${it.check ? (it.check(r.vars) ? 'OK' : 'NO') : '-'}`).join('; ');
}

describe('M2 procedures probe 2', () => {
  it('app-default cruise preset (FL370, 396 KTAS)', () => {
    const ias = cruiseIas(M2_META.typical.cruiseKtas, M2_META.typical.cruiseAltFt);
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: M2_META.typical.cruiseAltFt, iasKt: ias } });
    const v = r.vars;
    r.run(10);
    log(`CRZ ias ${ias.toFixed(0)} tla ${v.get(M2.tla(1)).toFixed(3)} (CRU ${TLA.cru}, CLB ${TLA.clb}) n1 ${v.get('eng1.n1_pct').toFixed(1)} baro_std ${v.get('adc1.baro_std')}/${v.get('adc2.baro_std')}/${v.get('adc3.baro_std')} ldg ${v.get('press.ldg_elev_ft').toFixed(0)} cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ap ${v.get('ap.engaged')} yd ${v.get('ap.yd_engaged')} sel_alt ${v.get('ap.sel_alt_ft')} CAS: ${cas(r)}`);
    log(`CRZ [Cruise] ${audit(r, 'Cruise')} [Takeoff / climb] ${audit(r, 'Takeoff / climb')} [Descent / approach] ${audit(r, 'Descent / approach')}`);
    expect(true).toBe(true);
  });

  it('battery start timeline: boost pump, bus volts, CAS', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2400 });
    const v = r.vars;
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    v.set(M2.avionicsSw, 1);
    v.set(M2.genSw(1), 1);
    v.set(M2.genSw(2), 1);
    v.set(M2.antiColl, 1);
    r.run(3);
    press(r, M2.startBtn(2), 0.3);
    let t = 0.3;
    let tlaSet = false;
    const seen = new Set<string>();
    r.run(40, () => {
      t += 1 / 60;
      for (const m of r.sys.cas.list) if (m.active) seen.add(`${m.level[0].toUpperCase()}:${m.text}`);
      if (!tlaSet && v.get('eng2.n2_pct') >= 9) {
        v.set(M2.tla(2), TLA.idle);
        tlaSet = true;
      }
      const k = Math.round(t * 60);
      if (k % 120 === 0)
        log(`BSTART t=${t.toFixed(1)} n2 ${v.get('eng2.n2_pct').toFixed(1)} itt ${v.get('eng2.itt_c').toFixed(0)} bus ${v.get('elec.batt_bus_v').toFixed(1)} V boostR_on ${v.get('fuel.boost_r_on')} boostR_pw ${v.get('elec.boost_r_powered')} r_main ${v.get('elec.r_main_powered')} avn1 ${v.get('elec.avn1_powered')} pfd1 ${v.get('elec.pfd1_powered')} mfd ${v.get('elec.mfd_powered')} ff ${v.get('eng2.fuel_flow_pph').toFixed(0)} feedpsi ${v.get('fuel.eng2_press_psi') ?? '-'}`);
    });
    log(`BSTART CAS seen during start: ${[...seen].join(' | ')}`);
    expect(true).toBe(true);
  });

  it('takeoff config warning with ground flaps at TO thrust; flaps 35 at TO thrust', () => {
    const r = makeM2({ state: 'ready_to_taxi', fuelLb: 2400 });
    const v = r.vars;
    r.run(2);
    for (const f of [3, 2, 0]) {
      v.set(M2.flapHandle, f);
      r.run(20);
      v.set(M2.tla(1), TLA.to);
      v.set(M2.tla(2), TLA.to);
      r.run(8);
      log(`TOCW flap handle ${f}: flaps ${v.get('surf.flaps_deg').toFixed(0)} sb ${v.get('surf.speedbrake').toFixed(2)} n2 ${v.get('eng1.n2_pct').toFixed(1)} tocw ${v.get('alert.takeoff_config')} text '${v.getString('tocw.text')}' MW ${v.get('alert.master_warning')} CAS: ${cas(r)}`);
      v.set(M2.tla(1), 0);
      v.set(M2.tla(2), 0);
      r.run(8);
    }
    expect(true).toBe(true);
  });

  it('electric pitch trim runaway: AP/TRIM DISC press-and-hold vs CB pull', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(3);
    r.events.emit('fail.trigger', 'trim.pitch.runaway');
    r.run(2);
    const a = v.get(M2.pitchTrim);
    r.events.emit('ap.disc');
    r.run(2);
    const b = v.get(M2.pitchTrim);
    v.set('cb.trim_pitch', 0);
    r.run(2);
    const c = v.get(M2.pitchTrim);
    log(`RUNAWAY trim ${a.toFixed(3)} -> (AP/TRIM DISC) ${b.toFixed(3)} -> (PITCH TRIM CB pulled) ${c.toFixed(3)} -> ${v.get(M2.pitchTrim).toFixed(3)} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('engine shut down in flight: GEN OFF / OIL PRESS / FUEL PRESS indications; emergency restart', () => {
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 20000, iasKt: 240 } });
    const v = r.vars;
    r.run(3);
    v.set(M2.tla(2), TLA.cutoff);
    r.run(40);
    log(`SHUT R in flight: n2 ${v.get('eng2.n2_pct').toFixed(1)} oil ${v.get('eng2.oil_press_psi').toFixed(0)} sg2 ${v.get('elec.sg2_online')} MC ${v.get('alert.master_caution')} MW ${v.get('alert.master_warning')} CAS: ${cas(r)}`);
    v.set(M2.genSw(2), 0);
    r.run(2);
    log(`SHUT R gen switch OFF: CAS: ${cas(r)}`);
    // Airstart (windmill / starter assist): IGNITION ON, BOOST ON, throttle IDLE.
    v.set(M2.ignSw(2), 1);
    v.set(M2.boostSw(2), 1);
    v.set(M2.tla(2), TLA.idle);
    r.run(40);
    log(`RESTART R (ign ON, boost ON, throttle IDLE) 40 s: n2 ${v.get('eng2.n2_pct').toFixed(1)} running ${v.get('eng2.running')} state ${v.get('fadec.eng2.start_state')} CAS: ${cas(r)}`);
    if (v.get('eng2.running') === 0) {
      press(r, M2.startBtn(2), 0.3);
      r.run(40);
      log(`RESTART R starter assist 40 s: n2 ${v.get('eng2.n2_pct').toFixed(1)} running ${v.get('eng2.running')} CAS: ${cas(r)}`);
    }
    expect(true).toBe(true);
  });

  it('CAS with AVIONICS OFF on battery (cockpit prep / shutdown)', () => {
    const r = makeM2({ state: 'cold_dark', fuelLb: 2400 });
    const v = r.vars;
    v.set(M2.battSw, 1);
    r.run(20);
    log(`BATT only 20 s: MC ${v.get('alert.master_caution')} MW ${v.get('alert.master_warning')} pfd1 ${v.get('elec.pfd1_powered')} CAS: ${cas(r)} batt_amps ${v.get('elec.batt_amps').toFixed(1)}`);
    v.set(M2.battSw, 0);
    v.set(M2.gpuConnected, 1);
    v.set(M2.battSw, 1);
    r.run(5);
    log(`GPU + BATT: bus ${v.get('elec.batt_bus_v').toFixed(1)} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });

  it('approach preset: FADEC approach ignition, landing elevation, before-landing flow', () => {
    const r = makeM2({ state: 'approach', fuelLb: 2400, air: { altFtMsl: 3000, iasKt: M2_META.typical.approachKias + 15 } });
    const v = r.vars;
    r.run(3);
    log(`APP ign ${v.get('eng1.ignition')}/${v.get('eng2.ignition')} ldg ${v.get('press.ldg_elev_ft').toFixed(0)} dp ${v.get('press.diff_psi').toFixed(2)} gear ${v.get('gear.down_locked')} flaps ${v.get('surf.flaps_deg').toFixed(0)} ias ${v.get('fdm.ias_kt').toFixed(0)} CAS: ${cas(r)}`);
    v.set(M2.flapHandle, 2);
    r.run(15);
    log(`APP flaps 35: flaps ${v.get('surf.flaps_deg').toFixed(0)} [Before landing] ${audit(r, 'Before landing')} horn ${v.get('gear.horn')} CAS: ${cas(r)}`);
    expect(true).toBe(true);
  });
});

describe('M2 procedures probe 2b', () => {
  it('cruise preset at the CRU detent: speed trend; relight detail', () => {
    const ias = cruiseIas(M2_META.typical.cruiseKtas, M2_META.typical.cruiseAltFt);
    const r = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: M2_META.typical.cruiseAltFt, iasKt: ias } });
    const v = r.vars;
    r.run(2);
    log(`CRU0 mass ${(r.fdm.mass * 2.2046).toFixed(0)} lb tas ${v.get('fdm.tas_kt').toFixed(0)} ias ${v.get('fdm.ias_kt').toFixed(0)} n1 ${v.get('eng1.n1_pct').toFixed(1)} sat ${v.get('fdm.sat_c').toFixed(1)} tla ${v.get(M2.tla(1)).toFixed(3)} rating ${v.getString('fadec.rating') || v.get('fadec.eng1.rating_n1') || '-'}`);
    v.set(M2.tla(1), TLA.cru);
    v.set(M2.tla(2), TLA.cru);
    r.events.emit('g3k.gmc.key_ap');
    r.run(120);
    log(`CRU +120 s at CRU detent (AP ALT hold ${v.get('ap.engaged')}): tas ${v.get('fdm.tas_kt').toFixed(0)} ias ${v.get('fdm.ias_kt').toFixed(0)} alt ${v.get('fdm.alt_msl_ft').toFixed(0)} n1 ${v.get('eng1.n1_pct').toFixed(1)} ff ${v.get('eng1.fuel_flow_pph').toFixed(0)}`);
    // Flameout R and relight with IGNITION ON / throttle IDLE.
    const s = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 20000, iasKt: 240 } });
    const w = s.vars;
    s.run(2);
    s.events.emit('g3k.gmc.key_ap');
    s.run(1);
    w.set(M2.tla(2), TLA.cutoff);
    s.run(30);
    log(`FLAMEOUT R 30 s: n2 ${w.get('eng2.n2_pct').toFixed(1)} ias ${w.get('fdm.ias_kt').toFixed(0)} running ${w.get('eng2.running')} ign ${w.get('eng2.ignition')} state ${w.get('fadec.eng2.start_state')} fuel_cmd ${w.get('fadec.eng2.fuel_cmd')} CAS: ${cas(s)}`);
    w.set(M2.ignSw(2), 1);
    w.set(M2.boostSw(2), 1);
    w.set(M2.tla(2), TLA.idle);
    for (let k = 0; k < 8; k++) {
      s.run(5);
      log(`RELIGHT t=${(k + 1) * 5} n2 ${w.get('eng2.n2_pct').toFixed(1)} itt ${w.get('eng2.itt_c').toFixed(0)} running ${w.get('eng2.running')} state ${w.get('fadec.eng2.start_state')} fuel_cmd ${w.get('fadec.eng2.fuel_cmd')} ias ${w.get('fdm.ias_kt').toFixed(0)} CAS: ${cas(s)}`);
    }
    expect(true).toBe(true);
  });
});

describe('M2 procedures probe 2c', () => {
  it('starter-assist airstart per the CJ-family AFM order', () => {
    const s = makeM2({ state: 'cruise', fuelLb: 2400, air: { altFtMsl: 15000, iasKt: 180 } });
    const w = s.vars;
    s.run(2);
    w.set(M2.tla(2), TLA.cutoff);
    s.run(30);
    log(`ASTART shut: n2 ${w.get('eng2.n2_pct').toFixed(1)} ias ${w.get('fdm.ias_kt').toFixed(0)}`);
    // 1 throttle OFF (already), 2 GEN switch GEN (already), 5 boost NORM, 6 START press, 7 throttle IDLE at 8 % N2 minimum.
    press(s, M2.startBtn(2), 0.3);
    s.run(2);
    log(`ASTART START pressed: state ${w.get('fadec.eng2.start_state')} starter ${w.get('eng2.starter')} n2 ${w.get('eng2.n2_pct').toFixed(1)} startLt ${w.get(M2.startLight(2))} CAS: ${cas(s)}`);
    w.set(M2.tla(2), TLA.idle);
    for (let k = 0; k < 18; k++) {
      s.run(5);
      log(`ASTART t=${(k + 1) * 5} n2 ${w.get('eng2.n2_pct').toFixed(1)} itt ${w.get('eng2.itt_c').toFixed(0)} state ${w.get('fadec.eng2.start_state')} running ${w.get('eng2.running')} gen ${w.get('elec.sg2_online')} starter ${w.get('eng2.starter')} n1 ${w.get('eng2.n1_pct').toFixed(1)} ff ${w.get('eng2.fuel_flow_pph')} CAS: ${cas(s)}`);
    }
    expect(true).toBe(true);
  });
});
