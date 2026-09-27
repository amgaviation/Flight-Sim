/**
 * Boeing 737-800 main cockpit (everything except the overhead / side
 * consoles): every control is functional.
 *
 * Builds the real systems (headless 737NG suite with the navigation database,
 * so the FMC / CDUs exist) and the cockpit, records every SimVar the systems
 * read while they run in several states, then actuates each control through
 * its pointer handlers (click, right / middle click, wheel, drag, guard open
 * + actuate) and checks that the control either changed a var that a system
 * reads or emitted an event that has a listener. Annunciators must show vars
 * the systems write. The coverage report must list no unbound control.
 *
 * Consumers outside the Subsystem list also count, as documented:
 *  - `cockpit.*` (yoke / pedal drag, read by the app's input module,
 *    docs/modules/cockpit.md §2.2);
 *  - `display.*` (DU / ISFD brightness, read by the DisplayManager).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { EventBus } from '../../../../src/core/EventBus';
import type { SimVars } from '../../../../src/core/SimVars';
import { AnnunciatorLight, type LegendSegment } from '../../../../src/cockpit/controls';
import { buildB738Cockpit } from '../../../../src/aircraft/b737-800/cockpit';
import { CK } from '../../../../src/aircraft/b737-800/cockpit/context';
import { applyB738State } from '../../../../src/aircraft/b737-800/states';
import { B738 } from '../../../../src/aircraft/b737-800/vars';
import { FIELD, loadNav, makeB738, type Rig } from '../helpers';
import fs from 'node:fs';

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

function systemReads(r: Rig): Set<string> {
  const all = new Set<string>();
  const run = (s: number) => {
    for (const n of recordReads(r.vars, () => r.run(s))) all.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff'] as const) {
    applyB738State(r.ctx, r.sys, st);
    run(1);
  }
  // Airborne branches (gear up, flaps up): cruise preset at FL100, then back on the ground.
  r.fdm.reposition({ lat: FIELD.lat, lon: FIELD.lon, altFtMsl: 10000, iasKt: 250, headingTrue: FIELD.courseTrue });
  applyB738State(r.ctx, r.sys, 'cruise');
  run(2);
  r.fdm.reposition({ lat: FIELD.lat, lon: FIELD.lon, onGround: true, headingTrue: FIELD.courseTrue });
  applyB738State(r.ctx, r.sys, 'ready_to_taxi');
  run(1);
  return all;
}

function hasListener(events: EventBus, name: string): boolean {
  const h = (events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.get(name);
  return !!h && h.size > 0;
}

function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t, ...mods };
}

type Gesture = (adv: (s: number) => void) => void;
function gestures(c: CockpitControl): Gesture[] {
  const out: Gesture[] = [];
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

/**
 * Vars read by the suite's display formats (not Subsystems), checked against the format source:
 * the EFIS VOR / ADF switches select the ND bearing pointers (cds/Nd.ts).
 */
const DISPLAY_READS: { re: RegExp; file: string; token: string }[] = [{ re: /^ac\.efis\d\.vor_adf\d$/, file: 'src/avionics/boeing-737/cds/Nd.ts', token: 'efisVorAdf' }];
const displayRead = (n: string) => DISPLAY_READS.some((d) => d.re.test(n) && fs.readFileSync(d.file, 'utf8').includes(d.token));

/** Suite-owned lenses with no system behind them by design (docs/modules/avionics-boeing-737.md §10). */
const SCOPE_LENSES = new Set(['b737.cdu1.call', 'b737.cdu2.call']);

describe('Boeing 737-800 main cockpit: control coverage', () => {
  it('every control changes a var a system reads or emits a handled event; every lens shows a system var', { timeout: 300_000 }, async () => {
    const nav = await loadNav();
    const r = makeB738({ state: 'ready_to_taxi', nav });
    const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true, mainOnly: true });
    build.root.updateMatrixWorld(true);
    const reads = systemReads(r);
    const v = r.vars;
    // Operating conditions some controls need (interlocks), as in the aircraft.
    const PRE: [RegExp, (id: string) => void][] = [
      [/^b738\.mip\.gear$/, () => v.set('gear.handle_lock', 0)],
      [/^b738\.ped\.rev(\d)$/, (id) => {
        const i = Number(id.slice(-1));
        v.set(B738.tla(i as 1 | 2), 0);
        v.set(`eng${i}.reverser_pos`, 1);
      }],
      [/^b738\.aft\.fire_(1|2|apu)$/, (id) => v.set(CK.fireOverride(id.endsWith('apu') ? 'apu' : (Number(id.slice(-1)) as 1 | 2)), 1)],
      [/^b738\.aft\.acp(\d)_mic(\d)$/, (id) => {
        const m = /acp(\d)_mic(\d)$/.exec(id)!;
        v.set(B738.acpMic(Number(m[1]) as 1 | 2), (Number(m[2]) + 1) % 8);
      }],
    ];
    const pre = (id: string) => {
      for (const [re, f] of PRE) if (re.test(id)) f(id);
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
    // Run the systems once so the lamp vars exist.
    r.run(1);
    const controls = build.controls;
    for (const c of controls) {
      if (c instanceof AnnunciatorLight) {
        const segs = (c as unknown as { o: { segments: LegendSegment[] } }).o.segments;
        const lamps = segs.map((s) => s.var).filter((x): x is string => !!x);
        const missing = lamps.filter((n) => !v.has(n));
        const ok = SCOPE_LENSES.has(c.id) || (lamps.length > 0 && missing.length === 0);
        report.push({ id: c.id, bound: ok, via: `indicator ${lamps.join(', ')}${missing.length ? ` (missing ${missing.join(', ')})` : ''}` });
        continue;
      }
      if (c.hitTargets.length === 0) {
        report.push({ id: c.id, bound: true, via: 'self-contained instrument (no controls)' });
        continue;
      }
      // Fire handle override buttons: a mechanical release; verified by pulling the handle with the override held.
      const ovr = /^b738\.aft\.fire_ovrd_(1|2|apu)$/.exec(c.id);
      if (ovr) {
        const h = ovr[1] === 'apu' ? ('apu' as const) : (Number(ovr[1]) as 1 | 2);
        const handle = controls.find((x) => x.id === `b738.aft.fire_${ovr[1]}`)!;
        const hv = h === 'apu' ? B738.fireHandleApu : B738.fireHandle(h);
        v.set(hv, 0);
        handle.update?.(1 / 60);
        v.set(CK.fireOverride(h), 0);
        c.onPointerDown?.(pointer(c.hitTargets[0]));
        const held = v.get(CK.fireOverride(h)) !== 0;
        handle.onPointerDown?.(pointer(handle.hitTargets[0]));
        advance(handle)(0.3);
        handle.onPointerUp?.(pointer(handle.hitTargets[0]));
        advance(handle)(0.3);
        c.onPointerUp?.(pointer(c.hitTargets[0]));
        const pulled = v.get(hv) !== 0;
        report.push({ id: c.id, bound: held && pulled && reads.has(hv), via: `mechanical: releases ${hv}` });
        v.set(hv, 0);
        continue;
      }
      let via = '';
      for (const g of gestures(c)) {
        pre(c.id);
        emitted.length = 0;
        const changed = [...recordWrites(v, () => g(advance(c)))].filter((n) => !n.startsWith('ac.b738.ck.'));
        const sysReads = recordReads(v, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n) || n.startsWith('cockpit.') || n.startsWith('display.') || displayRead(n));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    build.dispose?.();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`737-800 main cockpit: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(32)} ${x.via}`).join('\n')}`);
    expect(report.length).toBeGreaterThan(250);
    expect(unbound).toEqual([]);
  });
});
