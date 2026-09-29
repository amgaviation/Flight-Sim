/**
 * Citation M2 flight deck: control coverage audit (CLAUDE.md "Everything in
 * a cockpit works"). Every control of the main cockpit build is actuated
 * through its own pointer / wheel handlers (the same code paths the mouse
 * uses); each must change at least one var that a system (or a cockpit
 * display / the input module) reads, or emit an event that something
 * handles. The coverage report lists every control with what it drove; the
 * list of unbound controls must be empty.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as fs from 'node:fs';
import { makeM2, type Rig } from '../helpers';
import { buildM2Cockpit, type M2Cockpit } from '../../../../src/aircraft/citation-m2/cockpit';
import { COCKPIT_DISPLAY_VARS } from '../../../../src/aircraft/citation-m2/cockpit/displays';
import { g3000Controls } from '../../../../src/avionics/garmin-g3000/controls';
import { COCKPIT_VARS, type CockpitControl, type ControlPointer } from '../../../../src/cockpit/types';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { M2, TLA } from '../../../../src/aircraft/citation-m2/vars';
import type { InitialState } from '../../../../src/aircraft/types';

interface Rec {
  writes: Set<string>;
  events: Set<string>;
}

function pointer(c: CockpitControl, obj: THREE.Object3D, button: 0 | 1 | 2, ctrl = false): ControlPointer {
  const point = new THREE.Vector3();
  obj.getWorldPosition(point);
  return { button, shift: false, ctrl, alt: false, point, object: obj };
}

/** Optional hook run on every animation tick (e.g. the cockpit-hardware subsystems at 60 Hz). */
let onTick: (() => void) | null = null;

function tick(c: CockpitControl, n = 8): void {
  for (let i = 0; i < n; i++) {
    c.update?.(0.05);
    onTick?.();
  }
}

/** Drives a control through every generic gesture: clicks (left / right / middle) on each hit target, wheel both ways, a drag. */
function exercise(c: CockpitControl, cycles = 3): void {
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (let k = 0; k < cycles; k++) {
    for (const t of targets) {
      for (const b of [0, 2, 1] as const) {
        const p = pointer(c, t, b);
        c.onPointerDown?.(p);
        tick(c, 3);
        c.onPointerUp?.(p);
        tick(c);
      }
      const p = pointer(c, t, 0);
      c.onWheel?.(1, p);
      tick(c);
      c.onWheel?.(-1, p);
      tick(c);
      c.onWheel?.(-1, p);
      tick(c);
      // Drag gesture (levers, wheels, yoke, pedals, joystick).
      c.onPointerDown?.(p);
      c.onDrag?.(35, -60, p);
      tick(c, 2);
      c.onDrag?.(-20, 90, p);
      tick(c, 2);
      c.onPointerUp?.(p);
      tick(c);
    }
  }
}

/** Vars read (and written) by the systems while they run 1 s in a state; `setup` may change switch positions first. */
function recordReads(state: InitialState, cockpitRig?: { rig: Rig; ck: M2Cockpit }, setup?: (r: Rig) => void, writes?: Set<string>): Set<string> {
  const read = new Set<string>();
  const r = cockpitRig?.rig ?? makeM2({ state, ...(state === 'cruise' ? { air: { altFtMsl: 30000, iasKt: 250, headingTrue: 90 } } : {}) });
  const ck = cockpitRig?.ck ?? buildM2Cockpit(r.ctx);
  setup?.(r);
  const get = r.vars.get.bind(r.vars);
  const set = r.vars.set.bind(r.vars);
  r.vars.get = (name: string, fallback?: number) => {
    read.add(name);
    return get(name, fallback);
  };
  r.vars.set = (name: string, value: number) => {
    writes?.add(name);
    set(name, value);
  };
  for (let i = 0; i < 60; i++) {
    r.run(1 / 60);
    for (const s of ck.systems) s.update(1 / 60);
  }
  r.vars.get = get;
  r.vars.set = set;
  return read;
}

describe('Citation M2 main flight deck controls', () => {
  it('every control drives a var a system reads or an event something handles (coverage report)', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    const build = ck.build;
    build.root.updateMatrixWorld(true);
    const handled = (rig.events as unknown as { handlers: Map<string, Set<unknown>> }).handlers;
    const cfg = rig.sys.suite.cfg;
    const g3kEvents = new Set<string>();
    for (const c of g3000Controls(cfg)) for (const e of [c.press, c.hold, c.incEvent, c.decEvent, c.innerIncEvent, c.innerDecEvent, c.joystick]) if (e) g3kEvents.add(e);
    const inputSrc = fs.readFileSync('src/input/InputManager.ts', 'utf8');
    const inputVars = new Set(Object.values(COCKPIT_VARS).filter((v) => inputSrc.includes('COCKPIT_VARS') && inputSrc.includes(Object.entries(COCKPIT_VARS).find(([, x]) => x === v)![0])));

    // Actuate every control, recording var writes (changed values) and events per control.
    const recs = new Map<string, Rec>();
    let cur: Rec | null = null;
    const set = rig.vars.set.bind(rig.vars);
    rig.vars.set = (name: string, value: number) => {
      if (cur && rig.vars.get(name, NaN) !== value) cur.writes.add(name);
      set(name, value);
    };
    const offAny = rig.events.onAny((name) => cur?.events.add(name));
    for (const c of build.controls) {
      cur = { writes: new Set(), events: new Set() };
      recs.set(c.id, cur);
      exercise(c);
      // Let the cockpit-hardware logic (GTC knob push / hold, ESI buttons) see the momentary states.
      for (const s of ck.systems) s.update(1 / 60);
    }
    cur = null;
    offAny();
    rig.vars.set = set;

    // Everything the systems read: after the actuation (switch states changed), and in three phase presets.
    const sysWrites = new Set<string>();
    const read = recordReads('ready_to_taxi', { rig, ck }, undefined, sysWrites);
    for (const st of ['cold_dark', 'ready_to_taxi', 'cruise'] as const) for (const n of recordReads(st, undefined, undefined, sysWrites)) read.add(n);
    // Manual pressurization and manual temperature modes (the spring-loaded MANUAL switches act only there).
    const manual = (r: Rig) => {
      r.vars.set(M2.pressMode, 2);
      r.vars.set(M2.tempMode, 1);
    };
    for (const n of recordReads('cruise', undefined, manual, sysWrites)) read.add(n);
    for (const n of COCKPIT_DISPLAY_VARS) read.add(n);
    for (const n of inputVars) read.add(n);

    const report: string[] = [];
    const unbound: string[] = [];
    for (const c of build.controls) {
      if (c instanceof AnnunciatorLight) {
        // Indicators: every lamp must follow a var that a system writes.
        const segs = (c as unknown as { o: { segments: { var?: string }[] } }).o.segments;
        const lampVars = segs.map((sg) => sg.var).filter((x): x is string => !!x);
        const ok = lampVars.length > 0 && lampVars.every((x) => sysWrites.has(x));
        report.push(`${c.id.padEnd(28)} indicator: ${lampVars.join(', ')}${ok ? '' : ' (NOT WRITTEN BY A SYSTEM)'}`);
        if (!ok) unbound.push(`${c.id} (indicator var not written by any system)`);
        continue;
      }
      const r = recs.get(c.id)!;
      const vars = [...r.writes].filter((w) => read.has(w));
      const evs = [...r.events].filter((e) => (handled.get(e)?.size ?? 0) > 0 || g3kEvents.has(e));
      report.push(`${c.id.padEnd(28)} vars: ${vars.join(', ') || '-'} | events: ${evs.join(', ') || '-'}`);
      if (vars.length === 0 && evs.length === 0) unbound.push(`${c.id} (wrote ${[...r.writes].join(',') || 'nothing'}; emitted ${[...r.events].join(',') || 'nothing'})`);
    }
    fs.mkdirSync('tests/output', { recursive: true });
    fs.writeFileSync('tests/output/citation-m2-cockpit-coverage.txt', `${build.controls.length} controls, ${unbound.length} unbound\n${report.join('\n')}\n`);
    expect(build.controls.length).toBeGreaterThan(120);
    expect(unbound).toEqual([]);
  });

  it('binds every main-deck inventory var (docs/aircraft/citation-m2.md §9) to a cockpit control', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    rig.run(0.5); // ESI-1000 powered
    const written = new Set<string>();
    const set = rig.vars.set.bind(rig.vars);
    rig.vars.set = (name: string, value: number) => {
      if (rig.vars.get(name, NaN) !== value) written.add(name);
      set(name, value);
    };
    ck.build.root.updateMatrixWorld(true);
    onTick = () => {
      for (const s of ck.systems) s.update(1 / 60);
    };
    rig.vars.set('gear.handle_lock', 0); // in flight: the down-lock solenoid releases the handle
    for (const c of ck.build.controls) exercise(c, 2);
    onTick = null;
    rig.vars.set = set;
    // Inventory vars owned by the main deck (overhead / sidewall items: crew masks, CB panels; ground-menu items: doors, GPU).
    // Hardware inventory (dossier §9). Functions the G3000 runs (ignition, system tests, pressurization mode / manual,
    // A/C, cabin fan, temp select, defog, pax oxygen, pass safety, cabin lights, fuel transfer) are GTC controls:
    // checked by the next test against the synoptic page definitions.
    const inventory = [
      M2.battSw, M2.genSw(1), M2.genSw(2), M2.dispatchSw, M2.stbyDispSw,
      M2.startBtn(1), M2.startBtn(2), M2.startDiseng, M2.tla(1), M2.tla(2),
      M2.boostSw(1), M2.boostSw(2),
      M2.engFireBtn(1), M2.engFireBtn(2), M2.bottleBtn(1), M2.bottleBtn(2),
      M2.pitotStaticSw, M2.engAiSw(1), M2.engAiSw(2), M2.tailDeiceSw, M2.wsBleedSw(1), M2.wsBleedSw(2), M2.wsAlcoholSw,
      M2.pressSource, M2.cabinDump, M2.tempMode, M2.tempManual,
      M2.gearHandle, M2.gearHornSilence, M2.gearEmerRelease, M2.gearBlowdown, M2.antiskidSw,
      M2.parkBrake, M2.emerBrake, M2.controlLock, M2.rainDoor(1), M2.rainDoor(2),
      M2.flapHandle, M2.speedbrake, M2.pitchTrim, M2.aileronTrim, M2.rudderTrim, M2.yokeTrim(1), M2.yokeTrim(2), M2.yokeTrimArm(1), M2.yokeTrimArm(2), M2.apTrimDisc(1), M2.apTrimDisc(2),
      M2.navLt, M2.antiColl, M2.landingLt, M2.taxiLt, M2.logoLt, M2.wingInspLt, M2.panelLt, M2.floodLt,
      M2.displayDim, M2.gtcDim, M2.emerComm, M2.eventMarker, M2.cvrTest, M2.eltSw, M2.emerLtsSw,
      'g3k.rev_sw.pfd1', 'g3k.rev_sw.pfd2', 'adc3.baro_inhg', 'adc3.baro_std',
    ];
    const missing = inventory.filter((v) => !written.has(v));
    expect(missing).toEqual([]);
  });

  it('G3000-run functions are GTC Aircraft Systems controls, not hardware (M2-L17/L18/L19/L26, F26, F57)', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    const gtcVars = new Set(rig.sys.suite.cfg.synoptics.flatMap((p) => (p.controls ?? []).map((c) => c.var)).filter((x): x is string => !!x));
    const gtcEvents = new Set(rig.sys.suite.cfg.synoptics.flatMap((p) => (p.controls ?? []).map((c) => c.event)).filter((x): x is string => !!x));
    for (const v of [M2.ignSw(1), M2.ignSw(2), M2.testSel, M2.pressMode, M2.airCondSw, M2.cabinFan, M2.tempSel, M2.airDistrib, M2.paxOxy, M2.paxSafety, M2.cabinLt, M2.fuelXfer]) {
      expect(gtcVars.has(v), v).toBe(true);
    }
    expect(gtcEvents.has('ac.m2.press_man_up') && gtcEvents.has('ac.m2.press_man_dn')).toBe(true);
    // No hardware control writes them any more.
    const ids = ck.build.controls.map((c) => c.id);
    for (const gone of ['m2.test_sel', 'm2.ign1', 'm2.ign2', 'm2.air_cond', 'm2.temp_sel', 'm2.cabin_fan', 'm2.air_distrib', 'm2.pax_oxy', 'm2.pax_safety', 'm2.cabin_lt', 'm2.press_mode', 'm2.press_manual', 'm2.fuel_xfer', 'm2.rev.mfd', 'm2.pedestal_lt', 'm2.gear.unlocked', 'm2.knee.l']) {
      expect(ids.includes(gone), gone).toBe(false);
    }
    // GTC manual cabin altitude: one press drives the outflow valve for ~1 s.
    rig.events.emit('ac.m2.press_man_up');
    rig.run(0.5);
    expect(rig.vars.get(M2.pressManual)).toBe(1);
    rig.run(1);
    expect(rig.vars.get(M2.pressManual)).toBe(0);
    // SYSTEM TESTS selection returns to OFF by itself.
    rig.vars.set(M2.testSel, 2);
    rig.run(3);
    expect(rig.vars.get('ac.m2.bottle1_lt')).toBe(1);
    rig.run(9);
    expect(rig.vars.get(M2.testSel)).toBe(0);
  });

  it('throttles: CUTOFF only through the IDLE gate, detents IDLE/CRU/CLB/TO, locked by the control lock', () => {
    const rig = makeM2({ state: 'cold_dark' });
    const ck = buildM2Cockpit(rig.ctx);
    const tl = ck.build.controls.find((c) => c.id === 'm2.tla1')!;
    ck.build.root.updateMatrixWorld(true);
    rig.vars.set(M2.controlLock, 0);
    rig.vars.set(M2.tla(1), TLA.cutoff);
    tick(tl);
    const p = pointer(tl, tl.hitTargets[0], 0);
    // Left clicks step detent by detent toward TO.
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      tl.onPointerDown!(p);
      tl.onPointerUp!(p);
      tick(tl);
      seen.push(Math.round(rig.vars.get(M2.tla(1)) * 100) / 100);
    }
    expect(seen).toEqual([TLA.idle, TLA.cru, TLA.clb, TLA.to]);
    // Control lock engaged: the lever is held at IDLE / CUTOFF.
    rig.vars.set(M2.controlLock, 1);
    tick(tl);
    expect(rig.vars.get(M2.tla(1))).toBeLessThanOrEqual(TLA.idle + 1e-9);
  });

  it('gear handle cannot be raised with weight on wheels; lamp test lights the annunciators', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    ck.build.root.updateMatrixWorld(true);
    rig.run(0.5);
    const gh = ck.build.controls.find((c) => c.id === 'm2.gear.handle')!;
    exercise(gh, 1);
    expect(rig.vars.get(M2.gearHandle)).toBe(1);
    // SYSTEM TEST -> ANNU: the cockpit lamp-test var follows (emergency bus powered).
    rig.vars.set(M2.testSel, 2);
    ck.build.update?.(0.05);
    expect(rig.vars.get('ac.m2.ckpt_lamp_test')).toBe(1);
  });

  it('ESI-1000 buttons and GTC knob push / hold act through the cockpit hardware logic', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    rig.run(1);
    const b0 = rig.vars.get('adc3.baro_inhg', 29.92);
    // '+' key (4th bezel key) steps the standby baro setting; 'S' toggles STD; 'M' opens / steps the menu.
    const press = (i: number) => {
      rig.vars.set(`ac.m2.esi_b${i}`, 1);
      for (const s of ck.systems) s.update(1 / 60);
      rig.vars.set(`ac.m2.esi_b${i}`, 0);
      for (const s of ck.systems) s.update(1 / 60);
    };
    press(4);
    expect(rig.vars.get('adc3.baro_inhg')).toBeCloseTo(b0 + 0.01, 5);
    press(2);
    expect(rig.vars.get('adc3.baro_std')).toBe(1);
    press(2);
    expect(rig.vars.get('adc3.baro_std')).toBe(0);
    press(1); // menu: BRIGHTNESS
    expect(rig.vars.get('ac.m2.esi_menu')).toBe(1);
    press(4);
    expect(rig.vars.get('ac.m2.esi_brt_ofs')).toBeCloseTo(0.05, 5);
    expect(rig.vars.get('adc3.baro_inhg')).toBeCloseTo(b0 + 0.01, 5); // +/- act on the menu item, not the baro
    press(1); // BARO UNIT
    press(4);
    expect(rig.vars.get('ac.m2.esi_hpa')).toBe(1);
    press(2); // S exits the menu
    expect(rig.vars.get('ac.m2.esi_menu')).toBe(0);
    const seen: string[] = [];
    rig.events.on('g3k.gtc1.upper_push', () => seen.push('push'));
    rig.events.on('g3k.gtc1.upper_hold', () => seen.push('hold'));
    rig.vars.set('ac.m2.gtc1_upper_push', 1);
    for (let i = 0; i < 6; i++) for (const s of ck.systems) s.update(1 / 60);
    rig.vars.set('ac.m2.gtc1_upper_push', 0);
    for (const s of ck.systems) s.update(1 / 60);
    rig.vars.set('ac.m2.gtc1_upper_push', 1);
    for (let i = 0; i < 60; i++) for (const s of ck.systems) s.update(1 / 60);
    rig.vars.set('ac.m2.gtc1_upper_push', 0);
    for (const s of ck.systems) s.update(1 / 60);
    expect(seen).toEqual(['push', 'hold']);
  });
});
