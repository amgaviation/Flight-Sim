/**
 * Gulfstream G800 main cockpit: every control is functional.
 *
 * Builds the real systems (with the Symmetry suite on fake canvases) and the
 * main cockpit, records every SimVar the systems read while they run in
 * several states, then actuates each control through its pointer handlers
 * (click, right click, ctrl-click, wheel, drag; guards open on the first
 * gesture) and checks that the control either changed a var that a system
 * reads or emitted an event that has a listener. Indicator lamps must show
 * vars the systems write. The coverage report must list no unbound control.
 *
 * Vars read by the app's input module rather than a Subsystem (the 3D
 * sidestick / pedal drag vars `cockpit.*`, docs/modules/cockpit.md §2.2)
 * count as consumed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { applyG800State } from '../../../../src/aircraft/g800/states';
import type { Rig } from '../helpers';
import { cockpitRig } from './rig';
import { EPIC_VARS } from '../../../../src/avionics/honeywell-epic/vars';

/** Records every var name read through vars.get / has while `fn` runs. */
function recordReads(vars: SimVars, fn: () => void): Set<string> {
  const reads = new Set<string>();
  const v = vars as unknown as { get: SimVars['get']; has: SimVars['has'] };
  const get = v.get.bind(vars);
  const has = v.has.bind(vars);
  v.get = (n: string, f?: number) => {
    reads.add(n);
    return get(n, f);
  };
  v.has = (n: string) => {
    reads.add(n);
    return has(n);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).get;
    delete (vars as unknown as Record<string, unknown>).has;
  }
  return reads;
}

function systemReads(r: Rig): Set<string> {
  const all = new Set<string>();
  const run = (s: number) => {
    for (const n of recordReads(r.vars, () => r.run(s))) all.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff', 'approach', 'ready_to_taxi'] as const) {
    applyG800State(r.ctx, r.sys, st);
    run(1);
  }
  return all;
}

function hasListener(events: EventBus, name: string): boolean {
  const h = (events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.get(name);
  return !!h && h.size > 0;
}

function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t, ...mods };
}

/** Records the vars whose value `fn` changes (including momentary changes undone before it returns). */
function recordWrites(vars: SimVars, fn: () => void): Set<string> {
  const written = new Set<string>();
  const v = vars as unknown as { set: SimVars['set']; get: SimVars['get'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    if (!Object.is(vars.get(n, NaN), x)) written.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
  return written;
}

/** Candidate gestures, tried in order until one produces a consumed effect. */
function gestures(c: CockpitControl): ((adv: (s: number) => void) => void)[] {
  const out: ((adv: (s: number) => void) => void)[] = [];
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (const t of targets) {
    for (const button of [0, 2, 1] as const) {
      out.push((adv) => {
        c.onPointerDown?.(pointer(t, button));
        adv(0.12);
        c.onPointerUp?.(pointer(t, button));
        adv(0.4);
      });
    }
    out.push((adv) => {
      c.onPointerDown?.(pointer(t, 0, { ctrl: true }));
      c.onPointerUp?.(pointer(t, 0, { ctrl: true }));
      adv(0.3);
    });
    for (const w of [1, -1, 3]) {
      out.push((adv) => {
        c.onWheel?.(w, pointer(t));
        adv(0.4);
      });
      out.push((adv) => {
        c.onWheel?.(w, pointer(t, 0, { shift: true }));
        adv(0.4);
      });
    }
    for (const [dx, dy] of [
      [0, -120],
      [0, 120],
      [120, 0],
      [-120, 0],
    ]) {
      out.push((adv) => {
        const p = pointer(t);
        c.onPointerDown?.(p);
        for (let i = 0; i < 6; i++) {
          c.onDrag?.(dx / 6, dy / 6, p);
          adv(1 / 30);
        }
        adv(0.4);
        c.onPointerUp?.(p);
        adv(0.4);
      });
    }
  }
  return out;
}

describe('G800 cockpit: control coverage', () => {
  it('every main-cockpit control changes a var a system reads or emits a handled event', { timeout: 300_000 }, async () => {
    const { r, ck } = await cockpitRig('ready_to_taxi');
    const build = ck.build;
    const reads = systemReads(r);
    // Operating conditions some controls need to act (they are interlocked or ignored otherwise, as in the aircraft).
    const PRECONDITION: Record<string, () => void> = {
      'g800.kp.gear': () => r.vars.set('gear.handle_lock', 0), // down-lock solenoid released (airborne)
      'g800.fire.l': () => r.vars.set('ac.g800.fire_l_unlock', 1), // fire warning releases the handle lock
      'g800.fire.r': () => r.vars.set('ac.g800.fire_r_unlock', 1),
      'g800.ped.rev1': () => r.vars.set('ac.g800.tla1', 0), // reverse levers only from IDLE
      'g800.ped.rev2': () => r.vars.set('ac.g800.tla2', 0),
    };
    const emitted: string[] = [];
    const off = r.events.onAny((n) => emitted.push(n));
    const report: { id: string; bound: boolean; via: string }[] = [];
    const advance = (c: CockpitControl) => (s: number) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) {
        c.update?.(1 / 60);
        build.update?.(1 / 60);
      }
    };
    // Indicators (no actuation): their lamp vars must be written by the systems.
    const INDICATORS: Record<string, string[]> = {
      'g800.kp.gear_lt_nose': ['gear.green0'],
      'g800.kp.gear_lt_left': ['gear.green1'],
      'g800.kp.gear_lt_right': ['gear.green2'],
      'g800.ped.fire_lt_l': ['fire.eng1_warn'],
      'g800.ped.fire_lt_r': ['fire.eng2_warn'],
      'g800.gs.cpl_l': [EPIC_VARS.coupleSide],
      'g800.gs.cpl_r': [EPIC_VARS.coupleSide],
    };
    for (const c of build.controls) {
      if (c instanceof AnnunciatorLight) {
        const lamps = INDICATORS[c.id] ?? [];
        const missing = lamps.filter((n) => !r.vars.has(n));
        report.push({ id: c.id, bound: lamps.length > 0 && missing.length === 0, via: `indicator ${lamps.join(', ')}` });
        continue;
      }
      let via = '';
      for (const g of gestures(c)) {
        PRECONDITION[c.id]?.();
        emitted.length = 0;
        // Only the control and the cockpit hooks run during the gesture: every changed var is the control's doing.
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.g800.ck.'));
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n) || n.startsWith('cockpit.'));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`G800 main cockpit: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(30)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThanOrEqual(80);
    expect(unbound).toEqual([]);
  });
});
