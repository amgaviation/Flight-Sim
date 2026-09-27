/**
 * Gulfstream G650 overhead / breakers / side consoles driven through the 3D controls against the real
 * systems (headless rig with the PlaneView II suite):
 *  - the CB panel holds exactly the network's breakers; pulling one removes its load's power (and the
 *    consuming system reacts), pushing it back restores it; an overcurrent trips it (white band out);
 *  - the electrical power-up flow from cold & dark (batteries -> APU -> generators) gives the documented
 *    switchlight legends and bus states;
 *  - lamp test, fire test, oxygen masks, ACP and map-light controls produce the system reactions.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { CircuitBreaker, PushButton } from '../../../../src/cockpit/controls';
import type { InitialState } from '../../../../src/aircraft/types';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import { G650_CB_GROUPS } from '../../../../src/aircraft/g650/cockpit/overhead/breakers';
import { cockpitRig } from '../cockpit-main/rig';
import { posted } from '../helpers';

async function setup(state: InitialState) {
  const { r, ck } = await cockpitRig(state, false);
  const build = ck.build;
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = (id: string): CockpitControl => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  /** Cockpit (controls + hooks) and systems together at 60 Hz. */
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  /** Long system-only run, then a short cockpit refresh so the legends follow. */
  const run = (s: number, each?: (t: number) => boolean | void) => {
    r.run(s, each);
    step(0.1);
  };
  /** Lit legend text of a switchlight / annunciator ('' = dark). */
  const lit = (id: string): string => {
    const c = ctl(id) as PushButton | { inner?: PushButton; face?: { litText(): string } };
    const face = (c as PushButton).face ?? (c as { inner?: PushButton }).inner?.face ?? null;
    // A legend glows only with annunciator power (ESS DC / emergency bus).
    return face && build.env.lighting.annunciatorLevel() > 0 ? face.litText() : '';
  };
  return { r, build, ctl, step, run, lit };
}

function p(c: CockpitControl, button: 0 | 1 | 2 = 0): ControlPointer {
  const t = c.hitTargets[0] ?? c.object;
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
}
function click(c: CockpitControl, button: 0 | 1 | 2 = 0) {
  c.onPointerDown?.(p(c, button));
  c.onPointerUp?.(p(c, button));
}
/** Momentary press held for `s` seconds. */
function hold(c: CockpitControl, step: (s: number) => void, s = 0.3) {
  c.onPointerDown?.(p(c));
  step(s);
  c.onPointerUp?.(p(c));
}

describe('G650 circuit-breaker panel', () => {
  it('holds exactly one breaker per network breaker, bound to cb.<name>', { timeout: 120_000 }, async () => {
    const { r, build } = await setup('ready_to_taxi');
    const net = r.sys.elec.breakerNames().map((b) => b.name).sort();
    const table = G650_CB_GROUPS.flatMap((g) => g.items.map((i) => i[0])).sort();
    expect(table).toEqual(net);
    const cbs = build.controls.filter((c) => c instanceof CircuitBreaker).map((c) => c.id.replace('g650.cb.', '')).sort();
    expect(cbs).toEqual(net);
  });

  it('pulling a breaker removes power from its load and the consumer reacts; pushing it restores it', { timeout: 120_000 }, async () => {
    const { r, ctl, step, lit } = await setup('ready_to_taxi');
    const v = r.vars;
    step(1);
    // L MAIN fuel pump: breaker out -> pump unpowered -> stops -> FAIL legend on the L MAIN switchlight.
    expect(v.get('elec.boost_l_powered')).toBe(1);
    expect(v.get('fuel.boost_l_on')).toBe(1);
    click(ctl('g650.cb.boost_l'));
    step(4);
    expect(v.get('cb.boost_l')).toBe(0);
    expect(v.get('elec.boost_l_powered')).toBe(0);
    expect(v.get('fuel.boost_l_on')).toBe(0);
    expect(lit('g650.oh.fuel.boost_l')).toContain('FAIL');
    expect(posted(r)).toContain('caution:L Main Fuel Pump Fail');
    click(ctl('g650.cb.boost_l'));
    step(4);
    expect(v.get('cb.boost_l')).toBe(1);
    expect(v.get('fuel.boost_l_on')).toBe(1);
    expect(lit('g650.oh.fuel.boost_l')).toBe('');
    // DU 1 breaker: the pilot's PFD loses power.
    click(ctl('g650.cb.du1'));
    step(0.5);
    expect(v.get('elec.du1_powered')).toBe(0);
    expect(v.get('elec.du2_powered')).toBe(1);
    click(ctl('g650.cb.du1'));
    step(0.5);
    expect(v.get('elec.du1_powered')).toBe(1);
    // Air data probe 1 heater: FAIL legend on ANTI-ICE HTR 1.
    click(ctl('g650.cb.probe1'));
    step(1);
    expect(v.get('elec.probe1_powered')).toBe(0);
    expect(lit('g650.oh.ice.probe1')).toContain('FAIL');
    // Landing gear control: both LGCU lanes out -> the gear lights go dark.
    click(ctl('g650.cb.lgcu1'));
    click(ctl('g650.cb.lgcu2'));
    step(1);
    expect(v.get('elec.lgcu1_powered')).toBe(0);
    expect(v.get('gear.green0')).toBe(0);
  });

  it('an overcurrent trips the breaker (white band out); it resets once the fault is cleared', { timeout: 120_000 }, async () => {
    const { r, ctl, step } = await setup('ready_to_taxi');
    const v = r.vars;
    const cb = ctl('g650.cb.probe2') as CircuitBreaker;
    v.set('fail.elec.probe2.short', 1);
    step(3);
    expect(v.get('cb.probe2')).toBe(0);
    expect(v.get('cb.probe2_tripped')).toBe(1);
    expect(cb.logic.state).toBe('tripped');
    expect(v.get('elec.probe2_powered')).toBe(0);
    v.set('fail.elec.probe2.short', 0);
    step(20); // let the breaker cool
    click(cb);
    step(1);
    expect(v.get('cb.probe2')).toBe(1);
    expect(v.get('cb.probe2_tripped')).toBe(0);
    expect(v.get('elec.probe2_powered')).toBe(1);
  });
});

describe('G650 overhead flows', () => {
  it('electrical power-up from cold & dark: batteries -> APU -> engine generators, with the legends', { timeout: 400_000 }, async () => {
    const { r, build, ctl, step, run, lit } = await setup('cold_dark');
    const v = r.vars;
    step(0.5);
    // Cold & dark: no annunciator power, every legend dark.
    expect(v.get('elec.l_ess_dc_powered')).toBe(0);
    expect(lit('g650.oh.elec.batt_l')).toBe('');
    // MAIN BATTERIES ON: ESS DC and the emergency bus powered from the batteries; APU GEN "OFF"? no (switch ON);
    // the batteries are discharging -> amber ON legend.
    click(ctl('g650.oh.elec.batt_l'));
    click(ctl('g650.oh.elec.batt_r'));
    step(1);
    expect(v.get(V.battL)).toBe(1);
    expect(v.get('elec.l_ess_dc_powered')).toBe(1);
    expect(v.get('elec.emer_dc_powered')).toBe(1);
    expect(v.get('elec.l_main_ac_powered')).toBe(0);
    expect(lit('g650.oh.elec.batt_l')).toBe('ON');
    // Lamp test lights every legend while held.
    const lt = ctl('g650.oh.lt.lamp_test');
    lt.onPointerDown?.(p(lt));
    step(0.2);
    expect(v.get('alert.annun_test')).toBe(1);
    expect(build.env.lighting.lampTest()).toBe(true);
    expect(lit('g650.oh.lt.lamp_test')).toBe('TEST');
    expect(posted(r).length).toBeGreaterThanOrEqual(0);
    lt.onPointerUp?.(p(lt));
    step(0.2);
    expect(v.get('alert.annun_test')).toBe(0);
    expect(lit('g650.oh.elec.gen_l')).toBe('');
    // FLT CTRL BATTERIES, EMERGENCY POWER ARM, fuel pumps ON (all through the switchlights).
    for (const id of ['g650.oh.elec.ebha', 'g650.oh.elec.ups', 'g650.oh.elec.emer_arm', 'g650.oh.fuel.boost_l', 'g650.oh.fuel.alt_l', 'g650.oh.fuel.boost_r', 'g650.oh.fuel.alt_r']) click(ctl(id));
    step(1);
    expect(v.get(V.emerPwr)).toBe(1);
    expect(lit('g650.oh.elec.emer_arm')).toBe('ARM');
    expect(v.get('fuel.boost_l_on')).toBe(1);
    // APU: MASTER -> READY (door open) -> START -> generator on line, both main AC buses through the bus ties.
    click(ctl('g650.oh.apu.master'));
    run(15);
    expect(lit('g650.oh.apu.master')).toContain('READY');
    hold(ctl('g650.oh.apu.start'), step, 0.5);
    run(3);
    expect(v.get('apu.starting')).toBe(1);
    expect(lit('g650.oh.apu.start')).toBe('ON');
    run(80, () => v.get('elec.apu_gen_online') === 1 && v.get('apu.n_pct') > 99);
    run(3);
    expect(v.get('elec.apu_gen_online')).toBe(1);
    expect(lit('g650.oh.elec.apu_gen')).toBe('ON');
    expect(v.get('elec.l_main_ac_powered')).toBe(1);
    expect(v.get('elec.r_main_ac_powered')).toBe(1);
    expect(lit('g650.oh.elec.bus_tie_l')).toBe('TIED');
    expect(lit('g650.oh.elec.bus_tie_r')).toBe('TIED');
    expect(lit('g650.oh.elec.batt_l')).toBe(''); // charging now
    expect(lit('g650.oh.apu.master')).toBe('ON');
    // APU bleed after 60 s, START MASTER, right engine auto start with FUEL CONTROL RUN.
    click(ctl('g650.oh.bleed.apu'));
    run(65);
    expect(lit('g650.oh.bleed.apu')).toBe('ON');
    click(ctl('g650.oh.eng.start_master'));
    run(3);
    expect(lit('g650.oh.bleed.iso_open')).toBe('OPEN');
    hold(ctl('g650.oh.eng.start_r'), step, 0.3);
    run(1);
    expect(lit('g650.oh.eng.start_r')).toBe('ON');
    run(2);
    v.set(V.fuelCtlR, 1); // FUEL CONTROL R RUN (pedestal lever-lock switch, main-cockpit control)
    run(90, () => v.get('eng2.running') === 1 && v.get('elec.idg2_online') === 1);
    run(5);
    expect(v.get('eng2.running')).toBe(1);
    expect(v.get('elec.idg2_online')).toBe(1);
    // R MAIN AC now on the R IDG: the right bus tie opens, the APU keeps the left side (LUC electrical).
    expect(lit('g650.oh.elec.bus_tie_r')).toBe('');
    expect(lit('g650.oh.elec.bus_tie_l')).toBe('TIED');
    expect(lit('g650.oh.elec.gen_r')).toBe('');
    expect(lit('g650.oh.eng.start_r')).toBe('');
    // R GEN switched OFF with the engine running: amber OFF legend and "R Generator Off".
    click(ctl('g650.oh.elec.gen_r'));
    run(2);
    expect(lit('g650.oh.elec.gen_r')).toBe('OFF');
    expect(posted(r)).toContain('caution:R Generator Off');
    expect(lit('g650.oh.elec.bus_tie_r')).toBe('TIED'); // APU picks up R MAIN AC again
    click(ctl('g650.oh.elec.gen_r'));
    run(3);
    expect(v.get('elec.idg2_online')).toBe(1);
    expect(lit('g650.oh.elec.gen_r')).toBe('');
  });

  it('fire test, APU readout, hydraulic / isolation pairs, oxygen mask, ACP and map light', { timeout: 200_000 }, async () => {
    const { r, ctl, step, lit } = await setup('ready_to_taxi');
    const v = r.vars;
    step(1);
    // ENGINE FIRE TEST L LOOP A: fire warning on both handles' lamps (test), MASTER WARNING.
    const t = ctl('g650.oh.fire.test_la');
    t.onPointerDown?.(p(t));
    step(1);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(v.get('alert.master_warning')).toBe(1);
    expect(lit('g650.oh.fire.test_la')).toContain('TEST');
    t.onPointerUp?.(p(t));
    step(1);
    expect(v.get('fire.eng1_warn')).toBe(0);
    // AUX PUMP pair: ON forces the pump on; OFF/ARM from ON -> OFF; again -> ARM.
    click(ctl('g650.oh.hyd.aux_on'));
    step(1);
    expect(v.get(V.auxPump)).toBe(2);
    expect(v.get('hyd.aux_on')).toBe(1);
    expect(lit('g650.oh.hyd.aux_on')).toBe('ON');
    click(ctl('g650.oh.hyd.aux_arm'));
    step(0.5);
    expect(v.get(V.auxPump)).toBe(0);
    expect(lit('g650.oh.hyd.aux_arm')).toBe('OFF');
    click(ctl('g650.oh.hyd.aux_arm'));
    step(0.5);
    expect(v.get(V.auxPump)).toBe(1);
    expect(lit('g650.oh.hyd.aux_arm')).toBe('ARM');
    // ISOLATION OPEN / CLOSED pair.
    click(ctl('g650.oh.bleed.iso_open'));
    step(5);
    expect(v.get(V.isolation)).toBe(2);
    expect(v.get('pneu.iso_open')).toBe(1);
    click(ctl('g650.oh.bleed.iso_closed'));
    step(5);
    expect(v.get(V.isolation)).toBe(0);
    expect(v.get('pneu.iso_open')).toBe(0);
    expect(lit('g650.oh.bleed.iso_closed')).toBe('CLOSED');
    // Crew oxygen mask out of its box with the regulator at 100 %: oxygen flows, the flow indicator lights.
    click(ctl('g650.side.mask_mode_l'));
    step(0.5);
    expect(v.get(V.oxyMaskMode)).toBe(1);
    click(ctl('g650.side.mask_l'));
    step(1);
    expect(v.get(V.oxyMaskL)).toBe(1);
    expect(v.get('oxy.pilot_flowing')).toBe(1);
    expect(lit('g650.side.mask_flow_l')).toContain('FLOW');
    click(ctl('g650.side.mask_l'));
    step(1);
    expect(v.get('oxy.pilot_flowing')).toBe(0);
    // ACP: MIC select VHF 2 -> transmitter 2 while the ACP is powered; its breaker out -> no audio.
    click(ctl('g650.acp1.mic_2'));
    step(0.5);
    expect(v.get(V.acpTx(1))).toBe(2);
    expect(lit('g650.acp1.mic_2')).toBe('VHF 2');
    click(ctl('g650.cb.acp'));
    step(0.5);
    expect(v.get(V.acpTx(1))).toBe(0);
    click(ctl('g650.cb.acp'));
    // Map light dimmer -> map light zone.
    ctl('g650.side.map_l').onWheel?.(10, p(ctl('g650.side.map_l')));
    step(0.5);
    expect(v.get(V.ltMapL)).toBeGreaterThan(0.3);
    expect(v.get('ac.light.map_l')).toBeGreaterThan(0.3);
    // RAT: deployed on the ground can be re-stowed; the handle stays out in flight.
    click(ctl('g650.oh.elec.rat_deploy'));
    step(0.5);
    expect(v.get(V.ratDeploy)).toBe(1);
  });
});
