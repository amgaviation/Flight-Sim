/**
 * Gulfstream G650 overhead, circuit-breaker panel and side consoles: every control is functional.
 *
 * Builds the real systems (PlaneView II suite on fake canvases, real navigation database) and the full
 * cockpit (overhead + side consoles), records every SimVar the systems read in several states, then
 * actuates each overhead / breaker / side-console control through its pointer handlers (click, right /
 * middle click, wheel, drag; guarded controls: the first gesture opens the guard) and checks that it
 * changed a var a system reads or emitted an event that has a listener. Indicator lamps must show
 * system-written vars. The coverage report must list no unbound control.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { applyG650State } from '../../../../src/aircraft/g650/states';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import type { Rig } from '../helpers';
import { cockpitRig } from '../cockpit-main/rig';

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
  // In flight (climb phase): the CPC reads FLIGHT / LANDING only while scheduling the climb to the FMS cruise
  // altitude. (This used to be covered by a spurious 0.1 s "airborne" squat blip after every ground placement,
  // fixed in states.ts.)
  const pos = { lat: r.vars.get('fdm.lat_deg'), lon: r.vars.get('fdm.lon_deg'), hdg: r.vars.get('fdm.hdg_true_deg') };
  r.fdm.reposition({ lat: pos.lat, lon: pos.lon, altFtMsl: 8000, iasKt: 250, headingTrue: pos.hdg });
  applyG650State(r.ctx, r.sys, 'cruise');
  run(1);
  r.fdm.reposition({ lat: pos.lat, lon: pos.lon, onGround: true, headingTrue: pos.hdg });
  for (const st of ['cold_dark', 'takeoff', 'ready_to_taxi'] as const) {
    applyG650State(r.ctx, r.sys, st);
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

function gestures(c: CockpitControl): ((adv: (s: number) => void) => void)[] {
  const out: ((adv: (s: number) => void) => void)[] = [];
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (const t of targets.slice(0, 3)) {
    for (const button of [0, 2, 1] as const) {
      out.push((adv) => {
        c.onPointerDown?.(pointer(t, button));
        adv(0.12);
        c.onPointerUp?.(pointer(t, button));
        adv(0.4);
      });
    }
    for (const w of [1, -1, 3]) {
      out.push((adv) => {
        c.onWheel?.(w, pointer(t));
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

/** Ids built by the overhead / side-console builders. */
export const isOverheadOrSide = (id: string): boolean => /^(g650\.(oh|cb|side|acp[12])\.|epic\.ccd[12]\.|epic\.(mfdsw|dusw)\d)/.test(id);

describe('Gulfstream G650 overhead / breakers / side consoles: control coverage', () => {
  it('every overhead, breaker and side-console control changes a var a system reads or emits a handled event', { timeout: 600_000 }, async () => {
    const { r, ck } = await cockpitRig('ready_to_taxi', false);
    const build = ck.build;
    const reads = systemReads(r);
    // Controls whose action depends on the operating condition (as in the aircraft).
    const PRECONDITION: Record<string, () => void> = {
      'g650.acp1.mic_1': () => r.vars.set(V.acpMic(1), 0),
      'g650.acp2.mic_1': () => r.vars.set(V.acpMic(2), 0),
      // The pax supply valve matters while the passenger masks are deployed; the mask regulator while a mask is on.
      'g650.oh.oxy.pass_shutoff': () => r.vars.set(V.paxOxy, 2),
      'g650.side.mask_mode_l': () => (r.vars.set(V.oxyMaskL, 1), r.vars.set(V.crewOxy, 1)),
      'g650.side.mask_mode_r': () => (r.vars.set(V.oxyMaskR, 1), r.vars.set(V.crewOxy, 1)),
    };
    const INDICATORS: Record<string, string[]> = {
      'g650.oh.fire.bottle_l': ['fire.bottle_l_discharged'],
      'g650.oh.fire.bottle_r': ['fire.bottle_r_discharged'],
      'g650.oh.systest.door': [V.doorMain, V.doorBaggage],
      'g650.oh.systest.dump_vlv': [V.gearEmer],
      'g650.side.mask_flow_l': ['oxy.pilot_flowing'],
      'g650.side.mask_flow_r': ['oxy.copilot_flowing'],
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
    const mine = build.controls.filter((c) => isOverheadOrSide(c.id));
    for (const c of mine) {
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
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.g650.ck.') && !n.startsWith('display.'));
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`G650 overhead / side: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(34)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThan(230);
    expect(unbound).toEqual([]);
  });
});
