/**
 * G800 overhead flows through the 3D hardware against the real systems:
 *  battery power-up -> GPU -> APU and APU generator -> engine starts -> engine generators,
 * with the switchlight legends following the system state at every step, plus the lamp test,
 * the side-console oxygen mask / tiller and the cockpit lighting controls.
 */
import { describe, expect, it } from 'vitest';
import type { GuardedButton, PushButton } from '../../../../src/cockpit/controls';
import { ENG } from '../../../../src/core/vars';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
import { click, fullCockpit, ptr } from './util';

/** Visible lamp state of legend segment `i` of a switchlight (0 = top, 1 = bottom): lamp emission after power, dimming and lamp test. */
function lit(b: { face: PushButton['face'] }, i: number): boolean {
  const segs = (b.face as unknown as { segs: { level: number }[] }).segs;
  return segs[i].level > 0.3;
}

describe('G800 overhead flows', () => {
  it('electrical power-up: batteries -> GPU -> APU -> engine starts -> generators, with correct legends', { timeout: 600_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('cold_dark');
    step(1);
    const k = (id: string) => ctl<PushButton>(`g800.oh.${id}`);
    // Cold and dark: no annunciator power, every legend dark.
    expect(r.vars.get('elec.l_ess_dc_powered')).toBe(0);
    for (const id of ['gen_l', 'gen_r', 'batt_l', 'apu_gen']) expect(lit(k(id), 0), id).toBe(false);

    // ---- batteries ON: ESS DC powered; MAIN BATT ON (discharging) amber lit, GEN OFF (not on line) amber lit.
    click(k('batt_l'));
    click(k('batt_r'));
    step(2);
    expect(r.vars.get(V.battL)).toBe(1);
    expect(r.vars.get('elec.l_ess_dc_powered')).toBe(1);
    expect(r.vars.get('elec.r_ess_dc_powered')).toBe(1);
    expect(r.vars.get('elec.l_main_ac_powered')).toBe(0);
    expect(lit(k('batt_l'), 0)).toBe(true);
    expect(lit(k('gen_l'), 1)).toBe(true);
    expect(lit(k('gen_r'), 1)).toBe(true);
    expect(lit(k('gpu'), 0)).toBe(false);

    // ---- GPU connected: AVAIL; pressed: ON, both MAIN AC buses powered from the cart.
    r.vars.set(V.gpuAvail, 1);
    step(0.5);
    expect(lit(k('gpu'), 0)).toBe(true);
    click(k('gpu'));
    step(1);
    expect(r.vars.get('elec.gpu_online')).toBe(1);
    expect(r.vars.get('elec.l_main_ac_powered')).toBe(1);
    expect(r.vars.get('elec.r_main_ac_powered')).toBe(1);
    expect(r.vars.get('ac.g800.l_ac_src')).toBe(3);
    expect(lit(k('gpu'), 0)).toBe(false);
    expect(lit(k('gpu'), 1)).toBe(true);

    // ---- APU MASTER + START (momentary hold): APU AVAIL, APU GEN takes the buses (priority APU > GPU).
    click(k('apu_master'));
    step(11); // APU inlet door opens (10 s) before START is accepted
    expect(r.vars.get('apu.door_open')).toBe(1);
    const st = k('apu_start');
    st.onPointerDown?.(ptr(st));
    step(0.6);
    expect(r.vars.get(V.apuStart)).toBe(1);
    st.onPointerUp?.(ptr(st));
    step(0.2);
    expect(r.vars.get(V.apuStart)).toBe(0);
    let t = 0;
    while (r.vars.get('apu.avail') === 0 && t < 120) {
      step(1);
      t++;
    }
    expect(r.vars.get('apu.avail')).toBe(1);
    step(2);
    expect(lit(k('apu_master'), 1)).toBe(true); // AVAIL
    expect(r.vars.get('elec.apu_gen_online')).toBe(1);
    expect(lit(k('apu_gen'), 0)).toBe(true); // ON (green)
    expect(lit(k('apu_gen'), 1)).toBe(false);
    expect(lit(k('batt_l'), 0)).toBe(false); // batteries charging again
    expect(r.vars.get('ac.g800.l_ac_src')).toBe(2);
    click(k('gpu')); // GPU off
    step(0.5);
    expect(r.vars.get('elec.gpu_online')).toBe(0);
    expect(r.vars.get('elec.l_main_ac_powered')).toBe(1);

    // ---- engine starts (G700/G800 AutoStart): APU BLEED, R FUEL CONTROL RUN + ENGINE START, then L.
    click(k('bleed_apu'));
    step(3);
    expect(lit(k('bleed_apu'), 1)).toBe(true); // valve OPEN
    const es = k('eng_start');
    for (const i of [2, 1] as const) {
      const run = i === 1 ? V.runL : V.runR;
      r.vars.set(run, 1); // FUEL CONTROL RUN (pedestal rotary, main cockpit)
      es.onPointerDown?.(ptr(es));
      step(0.5);
      es.onPointerUp?.(ptr(es));
      step(4);
      expect(r.vars.get('ac.g800.ck.autostart'), `engine ${i} AutoStart in progress (ENGINE START ON lamp)`).toBe(1);
      expect(r.vars.get(i === 1 ? 'pneu.ats_l_valve_open' : 'pneu.ats_r_valve_open'), `engine ${i} start valve open`).toBe(1);
      t = 0;
      while (r.vars.get(ENG.running(i)) === 0 && t < 90) {
        step(1);
        t++;
      }
      expect(r.vars.get(ENG.running(i)), `engine ${i} running`).toBe(1);
      step(5);
      expect(r.vars.get('ac.g800.ck.autostart'), 'ON lamp out after cut-out').toBe(0);
    }
    step(3);
    // Generators on line: GEN OFF legends out, each MAIN AC bus on its own IDG.
    expect(r.vars.get('elec.idg1_online')).toBe(1);
    expect(r.vars.get('elec.idg2_online')).toBe(1);
    expect(lit(k('gen_l'), 1)).toBe(false);
    expect(lit(k('gen_r'), 1)).toBe(false);
    expect(r.vars.get('ac.g800.l_ac_src')).toBe(1);
    expect(r.vars.get('ac.g800.r_ac_src')).toBe(1);
    // L GEN switched OFF: amber OFF, the AC tie closes (BUS TIE AUTO) and the APU takes the left bus.
    click(k('gen_l'));
    step(1);
    expect(lit(k('gen_l'), 1)).toBe(true);
    expect(r.vars.get('ac.g800.l_ac_src')).toBe(2);
  });

  it('lamp test lights every legend; EMERGENCY POWER OFF / ON under their guards; FIRE TEST unlocks the handles', { timeout: 180_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('ready_to_taxi');
    step(1);
    const bleedL = ctl<GuardedButton>('g800.oh.bleed_l').inner;
    expect(lit(bleedL, 0)).toBe(false); // bleed ON: OFF legend dark
    // Lamp test is a touch function on the Symmetry flight deck (alert.annun_test).
    r.vars.set('alert.annun_test', 1);
    step(0.2);
    expect(lit(bleedL, 0)).toBe(true);
    expect(lit(bleedL, 1)).toBe(true);
    r.vars.set('alert.annun_test', 0);
    step(0.2);
    expect(lit(bleedL, 0)).toBe(false);
    // FIRE TEST (OHPTS touch function, same var): fire warnings test and the fire handles unlock while held.
    r.vars.set(V.fireTest, 1);
    step(1);
    expect(r.vars.get('fire.test')).toBe(1);
    expect(r.vars.get('ac.g800.fire_l_unlock')).toBe(1);
    r.vars.set(V.fireTest, 0);
    step(1);
    expect(r.vars.get('ac.g800.fire_l_unlock')).toBe(0);
    // EMERGENCY POWER ON forces the E-batts on (FWD / AFT lamps); OFF disconnects them.
    const on = ctl<GuardedButton>('g800.oh.emer_on');
    if (!on.guard.open) on.toggleGuard();
    click(on.inner);
    step(0.5);
    expect(r.vars.get(V.emerPwr)).toBe(2);
    expect(r.vars.get(V.ebattOn)).toBe(1);
    expect(lit(on.inner, 0)).toBe(true);
    const arm = ctl<GuardedButton>('g800.oh.emer_arm');
    if (!arm.guard.open) arm.toggleGuard();
    click(arm.inner);
    step(0.5);
    // Guarded OFF: the switchlight does nothing under the closed cover; lift the cover, then OFF.
    const ep = ctl<GuardedButton>('g800.oh.emer_off');
    expect(r.vars.get(V.emerPwr)).toBe(1);
    const cap0 = ep.inner.hitTargets[0];
    ep.onPointerDown(ptr(ep, 0, {}, cap0)); // cap under the closed cover: no effect
    ep.onPointerUp(ptr(ep, 0, {}, cap0));
    step(0.2);
    expect(r.vars.get(V.emerPwr)).toBe(1);
    if (!ep.guard.open) ep.toggleGuard(); // lift the cover
    const cap = ep.inner.hitTargets[0]; // the switchlight cap (not the cover)
    ep.onPointerDown(ptr(ep, 0, {}, cap));
    ep.onPointerUp(ptr(ep, 0, {}, cap));
    step(0.2);
    expect(r.vars.get(V.emerPwr)).toBe(0);
  });

  it('crew oxygen mask, regulator, tiller and cockpit lights drive their systems', { timeout: 180_000 }, async () => {
    const { r, ctl, step } = await fullCockpit('ready_to_taxi');
    step(1);
    // Mask out of the box in NORM (diluter demand: no oxygen needed at a ground-level cabin), then EMERGENCY
    // (positive pressure): O2 flows from the crew bottle and the FLOW indicator lights.
    click(ctl('g800.side.mask1'));
    step(1);
    expect(r.vars.get(V.oxyMask(1))).toBe(1);
    expect(lit(ctl('g800.side.oxy_flow1') as unknown as { face: PushButton['face'] }, 0)).toBe(false);
    click(ctl('g800.side.oxy_mode1')); // NORM -> 100 %
    click(ctl('g800.side.oxy_mode1')); // -> EMER
    step(1);
    expect(r.vars.get(V.oxyMode(1))).toBe(2);
    expect(r.vars.get('oxy.pilot_flow_lpm')).toBeGreaterThan(0);
    expect(lit(ctl('g800.side.oxy_flow1') as unknown as { face: PushButton['face'] }, 0)).toBe(true);
    click(ctl('g800.side.mask1'));
    step(1);
    expect(r.vars.get('oxy.pilot_flow_lpm')).toBe(0);
    // Tiller: drag right steers the nosewheel right, release re-centres it.
    const til = ctl('g800.side.tiller');
    const p = ptr(til);
    til.onPointerDown?.(p);
    for (let i = 0; i < 10; i++) til.onDrag?.(12, 0, p);
    step(1.5);
    expect(r.vars.get(V.tiller)).toBeGreaterThan(0.5);
    expect(r.vars.get('steer.cmd_deg')).toBeGreaterThan(20);
    til.onPointerUp?.(p);
    step(1.5);
    expect(Math.abs(r.vars.get(V.tiller))).toBeLessThan(0.02);
    // COCKPIT LIGHTS dimmer (forward strip) to max: panel backlighting.
    const pd = ctl('g800.oh.ckpt_lts');
    for (let i = 0; i < 30; i++) pd.onWheel?.(1, ptr(pd));
    step(0.5);
    expect(r.vars.get(V.ltPanel)).toBeGreaterThan(0.95);
    expect(r.vars.get('ac.light.panel')).toBeGreaterThan(0.9);
  });
});
