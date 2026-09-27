/**
 * Cessna 172S steam cockpit: every control is functional (CLAUDE.md "Everything in a cockpit works").
 *
 * Builds the real c172-steam systems and the cockpit (instruments and displays on canvas stubs),
 * records every SimVar the systems read while they run in several states, then actuates each
 * control through its pointer handlers (click, right click, ctrl-click, wheel, drag) and checks
 * that it either changed a var some system reads or emitted an event with a listener. Lamps and
 * annunciators must show vars the systems write. Instruments are self-contained sensors (POH
 * Sec 7; src/avionics/analog): their knobs must change the instrument (tooltip) or a consumed var.
 * The 3D yoke / pedal drag vars `cockpit.*` are read by the input module and count as consumed.
 * Push-to-reset circuit breakers (not pullable) are tripped first and must reset with a click.
 * Mechanical cabin fittings whose whole function is their own position (sun visors, the rotatable
 * flood-light eyeballs; cockpit/cabinControls.ts CabinFitting) must change that position.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import type { EventBus } from '../../../src/core/EventBus';
import type { SimVars } from '../../../src/core/SimVars';
import { AnnunciatorLight, CircuitBreaker } from '../../../src/cockpit/controls';
import { AnalogGauge, MagneticCompass } from '../../../src/avionics/analog';
import { applyC172SteamState } from '../../../src/aircraft/c172-steam/states';
import type { SteamRig } from './rig';
import { steamCockpitRig } from './cockpitRig';
import { CabinFitting } from '../../../src/aircraft/c172-steam/cockpit/cabinControls';

function recordReads(vars: SimVars, fn: () => void): Set<string> {
  const reads = new Set<string>();
  const v = vars as unknown as { get: SimVars['get']; has: SimVars['has']; getString: SimVars['getString'] };
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

/** Records every var name set while `fn` runs (changed or not). */
function recordSets(vars: SimVars, fn: () => void): Set<string> {
  const names = new Set<string>();
  const v = vars as unknown as { set: SimVars['set'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    names.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
  return names;
}

function systemIo(r: SteamRig): { reads: Set<string>; writes: Set<string> } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const run = (s: number) => {
    const w = recordSets(r.vars, () => {
      for (const n of recordReads(r.vars, () => r.run(s))) reads.add(n);
    });
    for (const n of w) writes.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff', 'approach', 'ready_to_taxi'] as const) {
    applyC172SteamState(r.ctx, r.sys, st);
    run(1);
  }
  return { reads, writes };
}

function hasListener(events: EventBus, name: string): boolean {
  const h = (events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.get(name);
  return !!h && h.size > 0;
}

function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t, ...mods };
}

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
    // Held press (2.5 s): long-press functions (KX 155A transfer / CHAN, KAP 140 BARO, KR 87 SET/RST).
    out.push((adv) => {
      c.onPointerDown?.(pointer(t, 0));
      adv(2.5);
      c.onPointerUp?.(pointer(t, 0));
      adv(0.4);
    });
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

describe('c172-steam cockpit: control coverage', () => {
  it('every control changes a var a system reads or emits a handled event; every lamp shows system state', { timeout: 600_000 }, async () => {
    const { r, ck } = await steamCockpitRig('ready_to_taxi');
    const build = ck.build;
    const { reads, writes } = systemIo(r);
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
        const segs = (c.face as unknown as { segs: { def: { var?: string } }[] }).segs.map((s) => s.def.var).filter((x): x is string => !!x);
        const missing = segs.filter((n) => !writes.has(n));
        report.push({ id: c.id, bound: segs.length > 0 && missing.length === 0, via: `lamp ${segs.join(', ')}${missing.length ? ` (not written: ${missing.join(', ')})` : ''}` });
        continue;
      }
      if (c instanceof MagneticCompass || (c instanceof AnalogGauge && c.hitTargets.length === 0)) {
        report.push({ id: c.id, bound: true, via: 'instrument (sensor display, no controls)' });
        continue;
      }
      let via = '';
      for (const g of gestures(c)) {
        applyC172SteamState(r.ctx, r.sys, 'ready_to_taxi');
        // Push-to-reset breakers (POH Sec 7) cannot be pulled: their function is resetting after a trip.
        if (c instanceof CircuitBreaker && !c.logic.pullable) {
          const name = c.id.replace('c172s.cb.', '');
          r.vars.set(`cb.${name}`, 0);
          r.vars.set(`cb.${name}_tripped`, 1);
          advance(c)(0.1);
        }
        emitted.length = 0;
        const tip0 = c instanceof AnalogGauge ? c.tooltip() : '';
        const phys0 = c instanceof CabinFitting ? c.physicalState() : '';
        const changed = [...recordWrites(r.vars, () => g(advance(c)))];
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n) || n.startsWith('cockpit.'));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        else if (c instanceof AnalogGauge && c.tooltip() !== tip0) via = 'instrument state';
        else if (c instanceof CabinFitting && c.physicalState() !== phys0) via = `fitting ${c.physicalState()}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => `${x.id} ${x.via}`);
    console.log(`c172-steam cockpit: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(34)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThanOrEqual(170);
    expect(unbound).toEqual([]);
  });
});
