/**
 * Boeing 737-800 overhead, side consoles and circuit breaker panels driven
 * through the 3D controls (real pointer / wheel handlers) against the real
 * systems (headless rig):
 *  - P6 / P18 hold exactly the network's breakers; pulling one removes power
 *    from its load and the consuming system reacts; an overcurrent trips it;
 *  - electrical power-up from cold & dark: battery -> ground power -> APU ->
 *    engine generator, with the FCOM annunciator states at each step;
 *  - lamp test, window heat test, oxygen masks, ISDU keyboard, door handle.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { AnnunciatorLight, CircuitBreaker, GuardedSwitch, RotaryKnob, TBarHandle, type KeyPad } from '../../../../src/cockpit/controls';
import type { InitialState } from '../../../../src/aircraft/types';
import { buildB738Cockpit } from '../../../../src/aircraft/b737-800/cockpit';
import { B738_P18, B738_P6 } from '../../../../src/aircraft/b737-800/cockpit/side/breakers';
import { B738, ENG_START } from '../../../../src/aircraft/b737-800/vars';
import { makeB738 } from '../helpers';

function setup(state: InitialState) {
  const r = makeB738({ state });
  const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true });
  build.root.updateMatrixWorld(true);
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = <T extends CockpitControl = CockpitControl>(id: string): T => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
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
  /** Long system-only run, then a short cockpit refresh so the lenses follow. */
  const run = (s: number, each?: () => boolean | void) => {
    r.run(s, each);
    step(0.1);
  };
  /** Lit legend text of an annunciator ('' = dark). */
  const lit = (id: string): string => ctl<AnnunciatorLight>(id).face.litText();
  return { r, v: r.vars, build, ctl, step, run, lit };
}

function P(t: THREE.Object3D, button: 0 | 1 | 2 = 0): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
}
function click(c: CockpitControl, target = 0, button: 0 | 1 | 2 = 0) {
  const t = c.hitTargets[target] ?? c.object;
  c.onPointerDown?.(P(t, button));
  c.onPointerUp?.(P(t, button));
}
/** Wheel on a (guarded) switch: +1 = one position up. */
function wheel(c: CockpitControl, d: number) {
  const t = c instanceof GuardedSwitch ? c.inner.hitTargets[0] : c.hitTargets[0];
  c.onWheel?.(d, P(t));
}
/** Opens the guard of a guarded switch (first hit target = the cover). */
function openGuard(c: GuardedSwitch) {
  if (!c.guard.open) click(c, 0);
}

describe('737-800 circuit breaker panels (P18 / P6)', () => {
  it('hold exactly one breaker per network breaker, bound to cb.<name>', { timeout: 120_000 }, () => {
    const { r, build } = setup('ready_to_taxi');
    const net = r.sys.elec.breakerNames().map((b) => b.name).sort();
    const table = [...B738_P18, ...B738_P6].flatMap((g) => g.items.map((i) => i[0])).sort();
    expect(table).toEqual(net);
    const cbs = build.controls.filter((c) => c instanceof CircuitBreaker).map((c) => c.id.replace('b738.cb.', '')).sort();
    expect(cbs).toEqual(net);
    build.dispose?.();
  });

  it('pulling a breaker removes power from its load and the system reacts; pushing restores it', { timeout: 120_000 }, () => {
    const { v, ctl, step, lit, build } = setup('ready_to_taxi');
    step(2);
    // PROBE HEAT A breaker: Capt pitot / L elev pitot / L alpha vane lights come on (probes unheated).
    expect(v.get('elec.probe_heat_a_powered')).toBe(1);
    expect(lit('b738.ovhd.probe.capt_pitot')).toBe('');
    click(ctl('b738.cb.probe_heat_a'));
    step(1);
    expect(v.get('cb.probe_heat_a')).toBe(0);
    expect(v.get('elec.probe_heat_a_powered')).toBe(0);
    expect(lit('b738.ovhd.probe.capt_pitot')).toBe('CAPT PITOT');
    expect(lit('b738.ovhd.probe.l_alpha')).toBe('L ALPHA VANE');
    expect(lit('b738.ovhd.probe.fo_pitot')).toBe('');
    click(ctl('b738.cb.probe_heat_a'));
    step(1);
    expect(v.get('elec.probe_heat_a_powered')).toBe(1);
    expect(lit('b738.ovhd.probe.capt_pitot')).toBe('');
    // L FWD fuel boost pump: pump stops, LOW PRESSURE light.
    click(ctl('b738.cb.fuel_l_fwd'));
    step(3);
    expect(v.get('elec.fuel_l_fwd_powered')).toBe(0);
    expect(lit('b738.ovhd.fuel.lp_l_fwd')).toBe('LOW PRESSURE');
    expect(lit('b738.ovhd.fuel.lp_l_aft')).toBe('');
    click(ctl('b738.cb.fuel_l_fwd'));
    step(3);
    expect(lit('b738.ovhd.fuel.lp_l_fwd')).toBe('');
    // Captain outboard DU (PFD) breaker: the display unit loses power.
    click(ctl('b738.cb.du_capt_out'));
    step(0.5);
    expect(v.get('elec.du_capt_out_powered')).toBe(0);
    expect(v.get('elec.du_fo_out_powered')).toBe(1);
    // Window heat L FWD: the ON light goes out.
    expect(lit('b738.ovhd.winheat.on_l_fwd')).toBe('ON');
    click(ctl('b738.cb.win_heat_l_fwd'));
    step(0.5);
    expect(lit('b738.ovhd.winheat.on_l_fwd')).toBe('');
    build.dispose?.();
  });

  it('an overcurrent trips the breaker (white band); it resets by pushing it in once the fault is gone', { timeout: 120_000 }, () => {
    const { v, ctl, step, build } = setup('ready_to_taxi');
    const cb = ctl<CircuitBreaker>('b738.cb.probe_heat_b');
    v.set('fail.elec.probe_heat_b.short', 1);
    step(3);
    expect(v.get('cb.probe_heat_b')).toBe(0);
    expect(v.get('cb.probe_heat_b_tripped')).toBe(1);
    expect(cb.logic.state).toBe('tripped');
    expect(v.get('elec.probe_heat_b_powered')).toBe(0);
    v.set('fail.elec.probe_heat_b.short', 0);
    step(20);
    click(cb);
    step(1);
    expect(v.get('cb.probe_heat_b')).toBe(1);
    expect(v.get('cb.probe_heat_b_tripped')).toBe(0);
    expect(v.get('elec.probe_heat_b_powered')).toBe(1);
    build.dispose?.();
  });
});

describe('737-800 overhead flows', () => {
  it('electrical power-up from cold & dark: battery -> ground power -> APU -> engine generator', { timeout: 600_000 }, () => {
    const { r, v, ctl, step, run, lit, build } = setup('cold_dark');
    step(0.5);
    expect(v.get('elec.batt_bus_powered')).toBe(0);
    expect(lit('b738.ovhd.elec.xfr_bus_off1')).toBe('');
    // ---- BAT ON (guard open, switch up, guard closed): battery bus, standby buses on the battery.
    const bat = ctl<GuardedSwitch>('b738.ovhd.elec.bat');
    openGuard(bat);
    wheel(bat, 1);
    click(bat, 0); // close the guard (holds ON)
    step(2);
    expect(v.get(B738.batSw)).toBe(1);
    expect(bat.guard.open).toBe(false);
    expect(v.get('elec.batt_bus_powered')).toBe(1);
    expect(v.get('elec.dc_stby_powered')).toBe(1);
    expect(v.get('elec.ac_stby_powered')).toBe(1);
    expect(lit('b738.ovhd.elec.xfr_bus_off1')).toBe('TRANSFER BUS OFF');
    expect(lit('b738.ovhd.elec.xfr_bus_off2')).toBe('TRANSFER BUS OFF');
    expect(lit('b738.ovhd.elec.source_off1')).toBe('SOURCE OFF');
    expect(lit('b738.ovhd.elec.stby_pwr_off')).toBe('');
    // ---- Ground power connected: GRD POWER AVAILABLE (blue); GRD PWR ON -> both transfer buses.
    v.set(B738.gpuConnected, 1);
    step(1);
    expect(lit('b738.ovhd.elec.grd_pwr_avail')).toBe('GRD POWER AVAILABLE');
    const grd = ctl('b738.ovhd.elec.grd_pwr');
    wheel(grd, 1);
    step(1);
    expect(v.get(B738.grdPwrSw)).toBe(0); // spring-loaded back to neutral
    expect(v.get(B738.xfrSrc(1))).toBe(3);
    expect(v.get('elec.xfr1_powered')).toBe(1);
    expect(v.get('elec.xfr2_powered')).toBe(1);
    expect(lit('b738.ovhd.elec.xfr_bus_off1')).toBe('');
    expect(lit('b738.ovhd.elec.source_off2')).toBe('');
    // ---- Fuel pump L AFT on, APU START (spring back to ON): APU runs, APU GEN OFF BUS (blue).
    click(ctl('b738.ovhd.fuel.pump_l_aft'));
    step(0.5);
    expect(v.get(B738.fuelPump('l_aft'))).toBe(1);
    const apu = ctl<RotaryKnob>('b738.ovhd.apu.sw');
    apu.turnBy(1); // OFF -> ON
    step(0.5);
    apu.turnBy(1); // ON -> START (spring)
    step(1);
    expect(v.get(B738.apuSw)).toBe(1);
    expect(v.get('ac.b738.apu_start_req')).toBe(1);
    run(150, () => v.get('apu.avail') === 1);
    run(3);
    expect(v.get('apu.avail')).toBe(1);
    expect(lit('b738.ovhd.elec.apu_gen_off_bus')).toBe('APU GEN OFF BUS');
    expect(lit('b738.ovhd.apu.low_oil')).toBe('');
    // ---- APU GEN 1 and 2 ON: the APU replaces ground power on both buses.
    wheel(ctl('b738.ovhd.elec.apu_gen1'), 1);
    step(0.5);
    wheel(ctl('b738.ovhd.elec.apu_gen2'), 1);
    step(1);
    expect(v.get(B738.xfrSrc(1))).toBe(2);
    expect(v.get(B738.xfrSrc(2))).toBe(2);
    expect(lit('b738.ovhd.elec.apu_gen_off_bus')).toBe('');
    expect(lit('b738.ovhd.elec.source_off1')).toBe('');
    // ---- Pumps, APU bleed, packs OFF; engine 2 start (ENGINE START 2 GRD, start lever at 25 % N2).
    for (const p of ['pump_l_fwd', 'pump_r_fwd', 'pump_r_aft']) click(ctl(`b738.ovhd.fuel.${p}`));
    for (const p of ['elec1', 'elec2']) click(ctl(`b738.ovhd.hyd.${p}`));
    click(ctl('b738.ovhd.bleed.apu_bleed'));
    wheel(ctl('b738.ovhd.bleed.pack_sw1'), -1);
    wheel(ctl('b738.ovhd.bleed.pack_sw2'), -1);
    step(8);
    expect(v.get(B738.pack(1))).toBe(0);
    expect(v.get('pneu.r_duct_psi')).toBeGreaterThan(30);
    expect(lit('b738.ovhd.hyd.lp_elec1')).toBe('');
    // Engine 2 GEN OFF BUS is dark while the engine is stopped (no IDG output).
    expect(lit('b738.ovhd.elec.gen_off_bus2')).toBe('');
    const start2 = ctl<RotaryKnob>('b738.ovhd.start.sw2');
    start2.turnBy(-1); // OFF -> GRD
    step(1);
    expect(v.get(B738.engStart(2))).toBe(ENG_START.grd);
    expect(lit('b738.ovhd.start.valve2')).toBe('START VALVE OPEN');
    run(90, () => {
      if (v.get('eng2.n2_pct') >= 25) v.set(B738.startLever(2), 1);
      return v.get('eng2.running') === 1 && v.get('eng2.n2_pct') > 58;
    });
    run(10);
    expect(v.get('eng2.running')).toBe(1);
    // The GRD solenoid released at starter cut-out: the knob follows back to OFF.
    expect(v.get(B738.engStart(2))).toBe(ENG_START.off);
    expect(start2.outer.logic.value).toBe(ENG_START.off);
    expect(lit('b738.ovhd.start.valve2')).toBe('');
    // IDG 2 available but not on the bus: GEN OFF BUS 2 (blue).
    expect(lit('b738.ovhd.elec.gen_off_bus2')).toBe('GEN OFF BUS');
    // ---- GEN 2 ON: transfer bus 2 on its own generator.
    wheel(ctl('b738.ovhd.elec.gen2'), 1);
    step(1);
    expect(v.get(B738.xfrSrc(2))).toBe(1);
    expect(lit('b738.ovhd.elec.gen_off_bus2')).toBe('');
    expect(v.get('elec.xfr2_powered')).toBe(1);
    void r;
    build.dispose?.();
  });

  it('lamp test lights every overhead lens; window heat test; oxygen masks; ISDU entry; door handle', { timeout: 120_000 }, () => {
    const { r, v, build, ctl, step, lit } = setup('ready_to_taxi');
    step(1);
    // LIGHTS TEST: the systems light the fault lights, the cockpit lamp test lights every lens.
    v.set(B738.lightsTest, 1);
    step(0.3);
    expect(build.env.lighting.lampTest()).toBe(true);
    expect(lit('b738.ovhd.fuel.filter_bypass1')).toBe('FILTER BYPASS');
    expect(lit('b738.ovhd.elec.drive1')).toBe('DRIVE');
    v.set(B738.lightsTest, 0);
    step(0.3);
    expect(lit('b738.ovhd.fuel.filter_bypass1')).toBe('');
    // WINDOW HEAT TEST OVHT: OVERHEAT lights on the heated windows.
    const wht = ctl('b738.ovhd.winheat.test');
    wht.onWheel?.(-1, P(wht.hitTargets[0]));
    step(0.1);
    expect(v.get(B738.windowHeatTest)).toBe(-1);
    expect(lit('b738.ovhd.winheat.ovht_l_fwd')).toBe('OVERHEAT');
    step(0.6);
    expect(v.get(B738.windowHeatTest)).toBe(0);
    // Captain oxygen mask: RESET/TEST -> flow indicator; pulling the mask -> OXY ON and crew oxygen used.
    const psi0 = v.get('oxy.crew_psi');
    const test = ctl('b738.side1.oxy.test');
    test.onPointerDown?.(P(test.hitTargets[0]));
    step(0.3);
    expect(v.get('oxy.capt_flowing')).toBe(1);
    expect(lit('b738.side1.oxy.flow')).toBe('+');
    test.onPointerUp?.(P(test.hitTargets[0]));
    step(0.3);
    expect(v.get('oxy.capt_flowing')).toBe(0);
    click(ctl<TBarHandle>('b738.side1.oxy.mask'));
    step(0.5);
    expect(v.get(B738.oxyMask(1))).toBe(1);
    expect(lit('b738.side1.oxy.oxy_on')).toBe('OXY ON');
    expect(v.get('oxy.capt_flowing')).toBe(1);
    step(30);
    expect(v.get('oxy.crew_psi')).toBeLessThan(psi0);
    // N (diluter) at a sea-level cabin: almost no oxygen; 100 % flows the full minute volume.
    const f100 = v.get('oxy.capt_flow_lpm');
    click(ctl('b738.side1.oxy.n100'));
    step(0.5);
    expect(v.get(B738.oxyDiluter(1))).toBe(1);
    expect(v.get('oxy.capt_flow_lpm')).toBeLessThan(f100 * 0.5);
    click(ctl('b738.side1.oxy.mask'), 0, 2); // stow
    step(0.5);
    expect(v.get(B738.oxyMask(1))).toBe(0);
    // ISDU keyboard: digits echo in the window; ENT sends the present position entry to the IRSs.
    const entries: string[] = [];
    const off = r.events.on('irs.pos_entry', () => entries.push('pos'));
    const keys = ctl<KeyPad>('b738.aovhd.irs.keys');
    keys.press('2');
    keys.press('4');
    expect(v.get('ac.b738.ck.isdu_entry_n')).toBe(2);
    keys.press('ENT');
    expect(entries).toEqual(['pos']);
    expect(v.get('ac.b738.ck.isdu_entry_n')).toBe(0);
    off();
    // Flight deck door handle: opens the door -> FLT DECK door light on the aft overhead.
    click(ctl('b738.door.handle'));
    r.run(2);
    step(0.2);
    expect(v.get(B738.door('flt_deck'))).toBe(1);
    expect(lit('b738.aovhd.door.flt_deck')).toBe('FLT DECK');
    build.dispose?.();
  });

  it('aft overhead: LANDING GEAR greens, ELT, observer ACP 3 receivers and push-to-talk', { timeout: 120_000 }, () => {
    const { v, ctl, step, lit, build } = setup('ready_to_taxi');
    step(1);
    // Gear down and locked on the ground: the aft overhead greens follow the gear sensing.
    for (const leg of [0, 1, 2]) expect(lit(`b738.aovhd.gear.green${leg}`)).toMatch(/GEAR$/);
    // ELT: ARM (guarded) -> dark; ON -> transmitting light.
    expect(lit('b738.aovhd.elt.lt')).toBe('');
    const elt = ctl<GuardedSwitch>('b738.aovhd.elt.sw');
    openGuard(elt);
    wheel(elt, 1);
    step(0.5);
    expect(v.get(B738.eltSw)).toBe(1);
    expect(v.get('ac.b738.elt_transmitting')).toBe(1);
    expect(lit('b738.aovhd.elt.lt')).toBe('ELT');
    wheel(elt, -1);
    click(elt, 0); // close the guard at ARM
    step(0.5);
    expect(v.get(B738.eltSw)).toBe(0);
    expect(lit('b738.aovhd.elt.lt')).toBe('');
    // ACP 3: VHF 2 receiver on (push) and volume (wheel) -> mixer level; MIC VHF 2 + R/T keys COM 2.
    const rx = ctl<RotaryKnob>('b738.aovhd.acp3.rx_vhf2');
    v.set(B738.acpRxOn(3, 'vhf2'), 0);
    step(0.1);
    rx.onWheel?.(4, P(rx.hitTargets[0]));
    step(0.2);
    expect(v.get('ac.b738.acp3.lvl_vhf2')).toBe(0);
    click(rx, 0, 1); // middle click = push
    step(0.2);
    expect(v.get(B738.acpRxOn(3, 'vhf2'))).toBe(1);
    expect(v.get('ac.b738.acp3.lvl_vhf2')).toBeGreaterThan(0);
    click(ctl('b738.aovhd.acp3.mic1'));
    step(0.2);
    expect(v.get(B738.acpMic(3))).toBe(1);
    const ptt = ctl('b738.aovhd.acp3.ptt');
    ptt.onPointerDown?.(P(ptt.hitTargets[0]));
    wheel(ptt, 1);
    step(0.1);
    expect(v.get('ac.b738.acp3.keyed_tx')).toBe(2);
    build.dispose?.();
  });

  it('blue valve lights: dim in the commanded position, bright in transit (FCOM 12.10)', () => {
    const { v, ctl } = setup('ready_to_taxi');
    const a = ctl<AnnunciatorLight>('b738.ovhd.fuel.xfeed_open');
    const lens = a.face.group.children.find((c) => c.name.startsWith('legend:')) as THREE.Mesh;
    const level = (x: number) => {
      v.set(B738.lt.xfeedValveOpen, x); // lens only (no system step): the logic would rewrite the var
      for (let i = 0; i < 120; i++) a.update(1 / 60);
      return (lens.material as THREE.MeshStandardMaterial).emissiveIntensity;
    };
    const bright = level(2);
    const dim = level(1);
    const off = level(0);
    expect(bright).toBeGreaterThan(0.2);
    expect(dim / bright).toBeGreaterThan(0.3);
    expect(dim / bright).toBeLessThan(0.5);
    expect(off).toBeLessThan(0.01);
  });
});
