/**
 * FUNCTION fidelity probe (read-only audit helper for the G650 function / systems lens). Each case drives the
 * real G650 systems headless and PRINTS what the model does, so the audit can compare it with the published
 * behaviour (LUC system notes, LIM). No assertion here encodes the real aircraft; they only guard the probe.
 *   npx vitest run tests/aircraft/g650/fidelity/function-probe.test.ts
 */
import { describe, expect, it } from 'vitest';
import { makeRig, posted, type Rig } from '../helpers';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';

const cruise = { weightLb: 70000, fuelLb: 16000, air: { altFtMsl: 35000, iasKt: 270 } };
const out: string[] = [];
const log = (s: string) => out.push(s);
const g = (r: Rig, n: string) => r.vars.get(n);

describe('G650 function probe', () => {
  it('fire test: one LOOP test switch lights which zones?', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.vars.set(V.fireTestLA, 1);
    r.run(1);
    log(`[fire test L LOOP A] eng1_warn=${g(r, 'fire.eng1_warn')} eng2_warn=${g(r, 'fire.eng2_warn')} apu_warn=${g(r, 'fire.apu_warn')} CAS=${posted(r).filter((m) => m.startsWith('warning')).join('|')}`);
    r.vars.set(V.fireTestLA, 0);
    r.vars.set(V.apuFireTest, 1);
    r.run(1);
    log(`[APU TEST] eng1_warn=${g(r, 'fire.eng1_warn')} eng2_warn=${g(r, 'fire.eng2_warn')} apu_warn=${g(r, 'fire.apu_warn')}`);
    r.vars.set(V.apuFireTest, 0);
    r.run(1);
    expect(true).toBe(true);
  });

  it('fire handle pull in flight: IDG, E-BATT, fuel, hydraulics, bleed', () => {
    const r = makeRig('cruise', cruise);
    r.run(5);
    r.vars.set(V.fireHandleL, 1);
    r.run(0.5);
    const idgAt05 = g(r, 'elec.idg1_online');
    r.run(4);
    log(`[L fire handle pulled] idg1_online@0.5s=${idgAt05} @4.5s=${g(r, 'elec.idg1_online')} ebattOn=${g(r, V.ebattOn)} l_btb=${g(r, 'elec.l_btb_closed')} eng1.running=${g(r, 'eng1.running')} fuel.eng1_on=${g(r, 'fuel.eng1_on')} bleed_l_open=${g(r, 'pneu.bleed_l_valve_open')} CAS=${posted(r).join('|')}`);
    r.run(30);
    log(`[L fire handle +34s] eng1.running=${g(r, 'eng1.running')} n2=${g(r, 'eng1.n2_pct').toFixed(1)} idg1_online=${g(r, 'elec.idg1_online')} hyd.left=${g(r, 'hyd.left_psi').toFixed(0)} ptu=${g(r, 'hyd.ptu_active')}`);
    expect(true).toBe(true);
  });

  it('IDG failure with EMERGENCY POWER ARM: do the E-BATTs come on (break power transfer)?', () => {
    const r = makeRig('cruise', cruise);
    r.run(5);
    r.sys.failures.trigger('elec.idg1');
    r.run(3);
    log(`[IDG1 fail, EMER ARM] ebattOn=${g(r, V.ebattOn)} CAS=${posted(r).join('|')}`);
    log(`[IDG1 fail] single source AUX DC powered=${g(r, 'elec.aux_dc_powered')} aux_tru_online=${g(r, 'elec.aux_tru_online')} cabin_dc=${g(r, 'elec.cabin_dc_powered')}`);
    // GEN switch OFF: CAS level.
    r.vars.set(V.genR, 0);
    r.run(2);
    log(`[R GEN OFF] CAS=${posted(r).filter((m) => m.includes('Generator')).join('|')}`);
    expect(true).toBe(true);
  });

  it('AC/DC RESET vs GEN switch cycle: which one resets a tripped IDG?', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    // Overvoltage-style trip: fail then clear (tripped latch).
    r.sys.failures.trigger('elec.idg1');
    r.run(2);
    r.sys.failures.clear('elec.idg1');
    r.vars.set('fail.elec.idg1', 0);
    r.run(2);
    log(`[IDG1 after failure cleared] online=${g(r, 'elec.idg1_online')} tripped=${g(r, 'elec.idg1_tripped')}`);
    r.vars.set(V.elecReset, 1);
    r.run(0.3);
    r.vars.set(V.elecReset, 0);
    r.run(2);
    log(`[after AC/DC RESET] idg1 online=${g(r, 'elec.idg1_online')} tripped=${g(r, 'elec.idg1_tripped')}`);
    expect(true).toBe(true);
  });

  it('RAT only: air data, displays, autothrottle, CAS colour', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    r.run(5);
    r.sys.failures.trigger('elec.idg1');
    r.sys.failures.trigger('elec.idg2');
    r.run(2);
    r.vars.set(V.ratDeploy, 1);
    r.run(40);
    const rat = posted(r).filter((m) => m.includes('RAT'));
    log(`[RAT] rat_online=${g(r, 'elec.rat_online')} adc1=${g(r, 'elec.adc1_powered')} adc2=${g(r, 'elec.adc2_powered')} adc3=${g(r, 'elec.adc3_powered')} du1..4=${[1, 2, 3, 4].map((n) => g(r, `elec.du${n}_powered`)).join(',')} afcs1=${g(r, 'elec.afcs1_powered')} afcs2=${g(r, 'elec.afcs2_powered')} gp=${g(r, 'elec.gp_powered')} fbw=${g(r, 'fbw.mode_code')} ${rat.join('|')}`);
    r.sys.at.pressEngage();
    r.run(1);
    log(`[RAT] A/T engage attempt: at_engaged=${g(r, 'ap.at_engaged')} ap engage available: power=${g(r, 'elec.afcs1_powered')}`);
    expect(true).toBe(true);
  });

  it('APU bleed in flight: does it feed the packs (pressurization)?', () => {
    const r = makeRig('cruise', { ...cruise, air: { altFtMsl: 25000, iasKt: 280 } });
    r.run(3);
    r.vars.set(V.apuMaster, 1);
    r.run(14);
    r.vars.set(V.apuStart, 1);
    r.run(0.5);
    r.vars.set(V.apuStart, 0);
    r.run(80, () => g(r, 'apu.avail') === 1);
    r.run(65);
    r.vars.set(V.bleedApu, 1);
    r.vars.set(V.bleedL, 0);
    r.vars.set(V.bleedR, 0);
    r.run(20);
    log(`[APU bleed in flight, eng bleeds OFF] apu.avail=${g(r, 'apu.avail')} apu.bleed_psi=${g(r, 'apu.bleed_psi').toFixed(1)} l_duct=${g(r, 'pneu.l_duct_psi').toFixed(1)} r_duct=${g(r, 'pneu.r_duct_psi').toFixed(1)} iso_open=${g(r, 'pneu.iso_open')} pack_l_on=${g(r, 'pneu.pack_l_on')} pack_r_on=${g(r, 'pneu.pack_r_on')} pack_flow=${g(r, 'pneu.pack_flow_kgs').toFixed(3)}`);
    // APU MASTER OFF: immediate shutdown or cooldown?
    r.vars.set(V.apuMaster, 0);
    r.run(2);
    log(`[APU MASTER OFF after bleed use] apu.state=${g(r, 'apu.state')} n=${g(r, 'apu.n_pct').toFixed(0)} cooldown=${g(r, 'apu.cooldown')}`);
    expect(true).toBe(true);
  });

  it('ISOLATION CLOSED position exists and blocks the cross-start bleed', () => {
    const r = makeRig('ready_to_taxi');
    r.run(2);
    r.vars.set(V.isolation, 0);
    r.vars.set(V.startMaster, 1);
    r.run(5);
    log(`[ISOLATION CLOSED + START MASTER] iso_cmd=${g(r, V.isoCmd)} iso_open=${g(r, 'pneu.iso_open')}`);
    expect(true).toBe(true);
  });

  it('air data probe heaters OFF in flight: FCC mode', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    for (const n of [1, 2, 3, 4] as const) r.vars.set(V.probe(n), 0);
    r.run(20);
    log(`[probe heaters OFF, no icing] fbw.mode_code=${g(r, 'fbw.mode_code')} CAS=${posted(r).join('|')}`);
    expect(true).toBe(true);
  });

  it('BACKUP PITCH in NORMAL law; yoke trim in ALTERNATE', () => {
    const r = makeRig('cruise', cruise);
    r.run(3);
    const s0 = g(r, 'surf.pitch_trim');
    r.vars.set(V.backupPitch, 1);
    r.run(3);
    r.vars.set(V.backupPitch, 0);
    const s1 = g(r, 'surf.pitch_trim');
    log(`[BACKUP PITCH NOSE UP 3 s in NORMAL law] stab ${s0.toFixed(4)} -> ${s1.toFixed(4)} (mode ${g(r, 'fbw.mode_code')})`);
    r.sys.failures.trigger('fbw.adc_data');
    r.run(2);
    const a0 = g(r, 'surf.pitch_trim');
    r.vars.set(V.yokeTrimL, 1);
    r.run(3);
    r.vars.set(V.yokeTrimL, 0);
    r.run(0.1);
    log(`[yoke trim NOSE UP 3 s in mode ${g(r, 'fbw.mode_code')}] stab ${a0.toFixed(4)} -> ${g(r, 'surf.pitch_trim').toFixed(4)}; stall shaker threshold is fixed at 0.94 (createSystems)`);
    expect(true).toBe(true);
  });

  it('brakes: parking handle proportional? BCU unpowered pedals? one hydraulic system lost?', () => {
    const r = makeRig('ready_to_taxi');
    r.run(3);
    r.vars.set(V.parkBrake, 0.1);
    r.run(1);
    log(`[PARK BRAKE handle 10 %] parking_set=${g(r, 'brakes.parking_set')} brake_left=${g(r, 'gear.brake_left').toFixed(2)}`);
    r.vars.set(V.parkBrake, 0);
    r.run(1);
    // BCUs unpowered: pull both breakers.
    r.vars.set('cb.bcu_a', 0);
    r.vars.set('cb.bcu_b', 0);
    r.run(1);
    r.vars.set('input.brake_left', 1);
    r.vars.set('input.brake_right', 1);
    r.run(1);
    log(`[BCU A+B unpowered, toe brakes full] bcu_a=${g(r, 'elec.bcu_a_powered')} bcu_b=${g(r, 'elec.bcu_b_powered')} brake_left=${g(r, 'gear.brake_left').toFixed(2)} src=${g(r, 'brakes.source')} accum=${g(r, 'brakes.accum_psi').toFixed(0)} CAS=${posted(r).filter((m) => m.includes('Brake')).join('|')}`);
    r.vars.set('input.brake_left', 0);
    r.vars.set('input.brake_right', 0);
    r.vars.set('cb.bcu_a', 1);
    r.vars.set('cb.bcu_b', 1);
    r.run(1);
    // Left hydraulic system lost (EDP fail, PTU/AUX off): braking pressure per side.
    r.vars.set(V.ptu, 0);
    r.vars.set(V.auxPump, 0);
    r.sys.failures.trigger('hyd.edp_l');
    r.run(20);
    r.vars.set('input.brake_left', 1);
    r.vars.set('input.brake_right', 1);
    r.run(1);
    log(`[L hyd lost] left_psi=${g(r, 'hyd.left_psi').toFixed(0)} right_psi=${g(r, 'hyd.right_psi').toFixed(0)} brake_left=${g(r, 'gear.brake_left').toFixed(2)} brake_right=${g(r, 'gear.brake_right').toFixed(2)} src=${g(r, 'brakes.source')} nws=${g(r, 'steer.engaged')}`);
    r.vars.set('input.brake_left', 0);
    r.vars.set('input.brake_right', 0);
    expect(true).toBe(true);
  });

  it('crossflow valve CAS: time to amber', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    r.vars.set(V.xflow, 1);
    let tAmber = -1;
    r.run(700, (t) => {
      if (tAmber < 0 && posted(r).includes('caution:Fuel Crossflow Valve Open')) tAmber = t;
      return tAmber >= 0;
    });
    log(`[X-FLOW open] amber after ${tAmber.toFixed(0)} s`);
    expect(true).toBe(true);
  });

  it('crew oxygen supply switch OFF: crew mask flow', () => {
    const r = makeRig('cruise', cruise);
    r.run(2);
    r.vars.set(V.crewOxy, 0);
    r.vars.set(V.oxyMaskL, 1);
    r.vars.set(V.oxyMaskMode, 1);
    r.run(3);
    log(`[crew O2 supply OFF, mask on 100 %] pilot_flowing=${g(r, 'oxy.pilot_flowing')} crew_psi=${g(r, 'oxy.crew_psi').toFixed(0)} pax_psi=${g(r, 'oxy.pax_psi').toFixed(0)}`);
    expect(true).toBe(true);
  });

  it('FCC mode on the ground during IRS alignment (cold & dark power-up)', () => {
    const r = makeRig('cold_dark');
    r.run(1);
    r.vars.set(V.battL, 1);
    r.vars.set(V.battR, 1);
    r.vars.set(V.ebhaBatt, 1);
    r.vars.set(V.upsBatt, 1);
    for (const n of [1, 2, 3] as const) r.vars.set(V.irsMode(n), 2);
    r.run(30);
    log(`[power-up, IRS aligning] fbw.mode_code=${g(r, 'fbw.mode_code')} aligning=${g(r, 'ahrs1.aligning')} CAS=${posted(r).join('|')}`);
    expect(true).toBe(true);
  });

  it('reversers with the left hydraulic system lost', () => {
    const r = makeRig('ready_to_taxi');
    r.run(3);
    r.vars.set(V.ptu, 0);
    r.vars.set(V.auxPump, 0);
    r.sys.failures.trigger('hyd.edp_l');
    r.run(20);
    r.vars.set(V.parkBrake, 1);
    r.vars.set(V.tla(1), -0.3);
    r.vars.set(V.tla(2), -0.3);
    r.run(5);
    log(`[L hyd lost, reverse selected] left_psi=${g(r, 'hyd.left_psi').toFixed(0)} rev1_pos=${g(r, 'eng1.reverser_pos').toFixed(2)} rev2_pos=${g(r, 'eng2.reverser_pos').toFixed(2)}`);
    expect(true).toBe(true);
  });

  it('prints', () => {
    // eslint-disable-next-line no-console
    console.log(`\n=== G650 FUNCTION PROBE ===\n${out.join('\n')}\n`);
    expect(out.length).toBeGreaterThan(0);
  });
});
