/**
 * Citation Longitude main cockpit: every control is functional.
 *
 * Builds the real systems (with the headless G5000 suite) and the cockpit,
 * records every SimVar the systems read while they run in several states,
 * then actuates each control through its pointer handlers (click, right
 * click, wheel, drag, guard open + actuate) and checks that the control
 * either changed a var that a system reads or emitted an event that has a
 * listener. The coverage report must list no unbound control.
 *
 * Vars read by the app's input module rather than a Subsystem (the 3D
 * yoke / pedal drag vars `cockpit.*`, docs/modules/cockpit.md §2.2) count as
 * consumed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { makeRig, type Rig } from '../helpers';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { LON_VARS } from '../../../../src/aircraft/citation-longitude/vars';
import { GduDisplay, GtcDisplay } from '../../../../src/avionics/garmin-g3000';
import { fakeCanvas } from './fakeCanvas';
import { applyLongitudeState } from '../../../../src/aircraft/citation-longitude/states';

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
  for (const st of ['cold_dark', 'takeoff', 'ready_to_taxi'] as const) {
    applyLongitudeState(r.ctx, r.sys, st);
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

interface Outcome {
  vars: string[];
  events: string[];
}

/** Records the vars whose value `fn` changes (including momentary changes that are undone before it returns). */
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
function gestures(c: CockpitControl): ((dt: (s: number) => void) => void)[] {
  const out: ((dt: (s: number) => void) => void)[] = [];
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

describe('Citation Longitude cockpit: control coverage', () => {
  it('every main-cockpit control changes a var a system reads or emits a handled event', { timeout: 240_000 }, () => {
    const r = makeRig('ready_to_taxi');
    const { build } = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true, mainOnly: true });
    build.root.updateMatrixWorld(true);
    const reads = systemReads(r);
    // The G5000 display units own the softkey / GTC knob subscriptions: create them on do-nothing canvases.
    const suite = r.sys.suite!;
    const g = globalThis as unknown as { OffscreenCanvas?: unknown };
    const hadOffscreen = 'OffscreenCanvas' in g;
    const prevOffscreen = g.OffscreenCanvas;
    // Map layers create their own scratch canvases.
    g.OffscreenCanvas = class {
      constructor(w: number, h: number) {
        return fakeCanvas(w, h);
      }
    };
    const units = [
      ...(['pfd1', 'mfd', 'pfd2'] as const).map((g) => new GduDisplay(suite.system, g, { canvas: fakeCanvas(1024, 640) })),
      ...suite.cfg.gtcs.map((g) => new GtcDisplay(suite.system, g, { canvas: fakeCanvas(480, 640) })),
    ];
    // Operating conditions some controls need to act (they are inhibited or ignored otherwise, as in the aircraft).
    const PRECONDITION: Record<string, () => void> = {
      'lon.lp.gear': () => r.vars.set('gear.handle_lock', 0), // down-lock solenoid released (airborne)
      'lon.lp.ext_pwr': () => r.vars.set(LON_VARS.extPwrAvail, 1), // ground power cart connected
      'lon.ped.cabin_alt': () => r.vars.set(LON_VARS.pressMode, 1), // PRESS MODE MANUAL
      // CONTROL LOCK can only be engaged with both thrust levers at idle (gust-lock interlock).
      'lon.ped.control_lock': () => {
        r.vars.set(LON_VARS.tla(1), 0);
        r.vars.set(LON_VARS.tla(2), 0);
      },
    };
    // Also count reads made while the systems react to each actuation (state-dependent branches).
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
      'lon.lp.stby_led': [LON_VARS.stbyBattLed],
      'lon.g5k.gmc.cpl_l': ['g3k.gmc.lt_xfr_l'],
      'lon.g5k.gmc.cpl_r': ['g3k.gmc.lt_xfr_r'],
      'lon.g5k.gmc.spd_lt': ['g3k.gmc.lt_at'],
      'lon.ped.cvr_status': [LON_VARS.cvrTestOk],
    };
    for (const c of build.controls) {
      if (c instanceof AnnunciatorLight) {
        const lamps = INDICATORS[c.id] ?? [];
        const missing = lamps.filter((n) => !r.vars.has(n));
        report.push({ id: c.id, bound: lamps.length > 0 && missing.length === 0, via: `indicator ${lamps.join(', ')}` });
        continue;
      }
      let via = '';
      PRECONDITION[c.id]?.();
      for (const g of gestures(c)) {
        PRECONDITION[c.id]?.();
        emitted.length = 0;
        // Only the control and the cockpit hooks run during the gesture: every changed var is the control's doing.
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.lon.ck.'));
        // One systems step afterwards captures state-dependent reads (e.g. a branch taken because of the new value).
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n) || n.startsWith('cockpit.'));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
        // Guarded controls: the first gesture only opens the guard; the next gestures actuate the switch.
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    for (const u of units) u.dispose();
    if (hadOffscreen) g.OffscreenCanvas = prevOffscreen;
    else delete g.OffscreenCanvas;
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    // Coverage report (visible with --reporter=verbose).
    console.log(`Longitude main cockpit: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(28)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThan(150);
    expect(unbound).toEqual([]);
  });
});
