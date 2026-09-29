/**
 * Global 6000 main cockpit: every control is functional.
 *
 * Builds the real systems (with the Collins Fusion suite on fake canvases)
 * and the cockpit, records every SimVar the systems read while they run in
 * several states, then actuates each control through its pointer handlers
 * (click, right / middle click, wheel, drag, guard open + actuate) and checks
 * that the control either changed a var that a system reads or emitted an
 * event that has a listener. The coverage report must list no unbound
 * control.
 *
 * Vars read by the app's input module rather than a Subsystem (the 3D yoke /
 * pedal drag vars `cockpit.*`, docs/modules/cockpit.md §2.2) count as consumed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { makeRig, type Rig } from '../helpers';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { applyG6kState } from '../../../../src/aircraft/global6000/states';

/** Records every var name read through vars.get / has / getBool while `fn` runs. */
export function recordReads(vars: SimVars, fn: () => void): Set<string> {
  const reads = new Set<string>();
  const v = vars as unknown as Record<string, (...a: unknown[]) => unknown>;
  const orig = { get: v.get.bind(vars), has: v.has.bind(vars), getBool: v.getBool?.bind(vars) };
  v.get = (n: unknown, f?: unknown) => {
    reads.add(n as string);
    return orig.get(n, f);
  };
  v.has = (n: unknown) => {
    reads.add(n as string);
    return orig.has(n);
  };
  if (orig.getBool)
    v.getBool = (n: unknown) => {
      reads.add(n as string);
      return orig.getBool!(n);
    };
  try {
    fn();
  } finally {
    const o = vars as unknown as Record<string, unknown>;
    delete o.get;
    delete o.has;
    delete o.getBool;
  }
  return reads;
}

function systemReads(r: Rig): Set<string> {
  const all = new Set<string>();
  const run = (s: number) => {
    for (const n of recordReads(r.vars, () => r.run(s))) all.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff', 'ready_to_taxi'] as const) {
    applyG6kState(r.ctx, r.sys, st);
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
  const v = vars as unknown as { set: SimVars['set'] };
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

describe('Global 6000 cockpit: control coverage', () => {
  it('every main-cockpit control changes a var a system reads or emits a handled event', { timeout: 300_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const { build } = buildG6kCockpit(r.ctx, r.sys, { mainOnly: true, canvas: fakeCanvas() });
    build.root.updateMatrixWorld(true);
    const reads = systemReads(r);
    // Operating conditions some controls need to act (they are inhibited or ignored otherwise, as in the aircraft).
    const PRECONDITION: Record<string, () => void> = {
      'g6k.mp.gear': () => r.vars.set('gear.handle_lock', 0), // handle solenoid released (airborne)
      // Reverse levers lift only with their thrust lever at IDLE (the thrust-lever gestures before leave it advanced).
      'g6k.ped.rev1': () => r.vars.set('ac.tla1', 0),
      'g6k.ped.rev2': () => r.vars.set('ac.tla2', 0),
    };
    // ACP transmitter select keys: select another transmitter first so the key press changes the selection.
    for (const s of [1, 2] as const)
      ['vhf1', 'vhf2', 'vhf3', 'hf1', 'hf2', 'sat', 'pa'].forEach((ch, k) => {
        PRECONDITION[`g6k.ped.acp${s}.mic_${ch}`] = () => r.vars.set(V.acpMic(s), k === 0 ? 1 : 0);
      });
    // The Vision GEAR AND BRAKES panel has no gear position lights (photo N835GL): no indicator on the main cockpit.
    const INDICATORS: Record<string, string[]> = {};
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
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.g6k.ck.'));
        // One systems step afterwards captures state-dependent reads.
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
    console.log(`Global 6000 main cockpit: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(30)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThan(100);
    expect(unbound).toEqual([]);
    build.dispose?.();
  });
});
