/**
 * Control inventory audit (reverse direction of the cockpit coverage tests):
 * every cockpit control var of the dossier §12 inventory (vars.ts
 * G6K_CONTROL_VARS) is written by at least one 3D control of the complete
 * flight deck (main panel, glareshield, pedestal, overhead, side panels,
 * side consoles, CCBP). Each control is actuated with the usual gestures
 * (click, right / middle click, ctrl-click, wheel, drag) and the union of the
 * vars they write is compared with the inventory.
 *
 * Exempt (not a flight-deck control, or reached through a page of the EMS CDU
 * whose key sequences are exercised in cockpit-overhead/flows.test.ts and
 * breakers.test.ts): ground-service carts, doors, the EMS EMER CNTL bus
 * isolation, cabin power and TEST page entries.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import type { SimVars } from '../../../../src/core/SimVars';
import { makeRig } from '../helpers';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { G6K_VARS as V, G6K_CONTROL_VARS } from '../../../../src/aircraft/global6000/vars';

function pointer(t: THREE.Object3D, button: 0 | 1 | 2 = 0, mods: Partial<ControlPointer> = {}): ControlPointer {
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t, ...mods };
}

function recordWrites(vars: SimVars, fn: () => void, into: Set<string>): void {
  const v = vars as unknown as { set: SimVars['set'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    into.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
}

const EXEMPT = new Set<string>([
  V.extAcAvail,
  V.extDcAvail,
  V.cabinPwr,
  ...([1, 2, 3, 4] as const).map((n) => V.acBusIsol(n)),
  ...(['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus'] as const).map((b) => V.dcBusIsol(b)),
  V.fireTest,
  V.ldgElevFt, // FCOM 01-10-41: set through the spring-loaded LDG ELEV UP / DN slew switch (V.ldgElevSlew), logic.ts
  V.stallTest,
  // EMS CDU SWITCH CONTROL page entries (cockpit-overhead/flows.test.ts).
  V.stallAdvSel,
  V.slatFlapReset,
  V.footWarmer('l'),
  V.footWarmer('r'),
  ...(['pax', 'emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small'] as const).map((d) => V.door(d)),
]);

describe('Global 6000 control inventory', () => {
  it('every inventory control var is written by a 3D flight-deck control', { timeout: 300_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const { build } = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
    build.root.updateMatrixWorld(true);
    const written = new Set<string>();
    const adv = (c: CockpitControl, s: number) => {
      for (let i = 0; i < Math.max(1, Math.round(s * 60)); i++) {
        c.update?.(1 / 60);
        build.update?.(1 / 60);
      }
    };
    r.vars.set('gear.handle_lock', 0);
    // Fire handles are solenoid-locked without a fire warning (logic.ts V.fireUnlock): unlocked for the sweep.
    for (const z of ['l', 'apu', 'r'] as const) r.vars.set(V.fireUnlock(z), 1);
    // Two passes: guards (separate controls) opened in the first pass let their switches act in the second.
    for (const c of [...build.controls, ...build.controls]) {
      const targets = c.hitTargets.length ? c.hitTargets : [c.object];
      recordWrites(
        r.vars,
        () => {
          for (const t of targets) {
            for (const button of [0, 2, 1] as const) {
              c.onPointerDown?.(pointer(t, button));
              adv(c, 0.12);
              c.onPointerUp?.(pointer(t, button));
              adv(c, 0.2);
            }
            c.onPointerDown?.(pointer(t, 0, { ctrl: true }));
            c.onPointerUp?.(pointer(t, 0, { ctrl: true }));
            for (const w of [1, -1, 3, -3]) {
              c.onWheel?.(w, pointer(t));
              adv(c, 0.1);
            }
            for (const [dx, dy] of [[0, -120], [0, 120], [120, 0], [-120, 0]]) {
              const p = pointer(t);
              c.onPointerDown?.(p);
              for (let i = 0; i < 6; i++) {
                c.onDrag?.(dx / 6, dy / 6, p);
                adv(c, 1 / 30);
              }
              c.onPointerUp?.(p);
              adv(c, 0.2);
            }
            r.vars.set(V.tla(1), 0);
            r.vars.set(V.tla(2), 0);
          }
          // Guarded controls: open the cover (one target), then operate the switch / button (another target).
          for (const a of targets)
            for (const b of targets) {
              for (const t of [a, b]) {
                c.onPointerDown?.(pointer(t));
                adv(c, 0.12);
                c.onPointerUp?.(pointer(t));
                adv(c, 0.2);
              }
            }
        },
        written,
      );
    }
    const missing = G6K_CONTROL_VARS.filter((n) => !EXEMPT.has(n) && !written.has(n));
    console.log(`inventory: ${G6K_CONTROL_VARS.length} vars, ${build.controls.length} controls, missing: ${missing.join(', ') || 'none'}`);
    expect(missing).toEqual([]);
    build.dispose?.();
  });
});
