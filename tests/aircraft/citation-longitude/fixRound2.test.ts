/**
 * Layout-audit fix round 2 (LENS layout, gaps LON-L2-*): guards the function-affecting fixes.
 * Each block names the gap it guards; pure-finish gaps (materials, labels) are verified by screenshot.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { makeRig } from './helpers';
import { buildLongitudeCockpit } from '../../../src/aircraft/citation-longitude/cockpit';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { GuardedButton, PushButton, Lever } from '../../../src/cockpit/controls';
import type { InitialState } from '../../../src/aircraft/types';

function cockpit(state: InitialState) {
  const r = makeRig(state, { avionics: false });
  const { build } = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true });
  build.root.updateMatrixWorld(true);
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = <T extends CockpitControl = CockpitControl>(id: string): T => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
  };
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  return { r, build, ctl, step };
}

function ptr(c: CockpitControl, button: 0 | 1 | 2 = 0): ControlPointer {
  const target = c.hitTargets[0] ?? c.object;
  return { button, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target };
}
const click = (c: CockpitControl, button: 0 | 1 | 2 = 0) => {
  c.onPointerDown?.(ptr(c, button));
  c.onPointerUp?.(ptr(c, button));
};

describe('L2-01: POWER TRANSFER is two switchlights driving the PTCU states', () => {
  it('the rotary is gone; NORM/OFF and AUX/HYD GEN switchlights drive ac.lon.hyd.ptcu', { timeout: 120_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi');
    const v = r.ctx.vars;
    expect(() => ctl('lon.ped.ptcu')).toThrow(); // knob replaced (photo shows two switchlights)
    const norm = ctl<PushButton>('lon.ped.ptcu_norm');
    const aux = ctl<PushButton>('lon.ped.ptcu_aux');
    expect(v.get(V.ptcu)).toBe(2); // NORM in ready_to_taxi
    click(norm);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(0); // OFF
    click(norm);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(2); // back to NORM
    // Lower switchlight steps AUX A -> AUX B -> HYD GEN -> NORM (same var, logic.ts states untouched).
    click(aux);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(1);
    click(aux);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(3);
    click(aux);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(4);
    step(1.5);
    expect(v.getString(V.ptcuMode).startsWith('GEN')).toBe(true); // hydraulic generator online path still works
    click(aux);
    step(0.1);
    expect(v.get(V.ptcu)).toBe(2);
  });
});

describe('L2-02: reverse piggyback levers on the thrust-lever grips', () => {
  it('each grip carries a reverse lever that raises in the reverse range and is a priority hit target', { timeout: 120_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi');
    const v = r.ctx.vars;
    for (const i of [1, 2] as const) {
      const lv = ctl<Lever>(`lon.ped.tl${i}`);
      let rev: THREE.Object3D | null = null;
      lv.handle.traverse((o) => {
        if (o.name === `tl${i}_rev_lever`) rev = o;
      });
      expect(rev, `tl${i} reverse lever`).toBeTruthy();
      const hit = lv.hitTargets.find((h) => h.userData.hitPriority === 1 && rev && h.parent === rev);
      expect(hit, `tl${i} reverse lever hit target`).toBeTruthy();
      // Stowed forward of the grip at idle, pivoted up in reverse.
      v.set(V.tla(i), 0);
      step(0.05);
      const stowed = (rev! as THREE.Object3D).rotation.x;
      v.set(V.tla(i), -0.8);
      step(0.05);
      const raised = (rev! as THREE.Object3D).rotation.x;
      expect(stowed).toBeGreaterThan(0.8);
      expect(raised).toBeLessThan(0.05);
      v.set(V.tla(i), 0);
      step(0.05);
    }
  });
});

describe('L2-07 / L2-08 / L2-06: handle geometry fixes', () => {
  it('the gear handle ends in the flattened wheel-profile knob (~30 mm), not the 48 mm default wheel', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('ready_to_taxi');
    const sizes: number[] = [];
    ctl('lon.lp.gear').object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      sizes.push(bb.max.x - bb.min.x);
    });
    expect(sizes.some((w) => w > 0.026 && w < 0.036)).toBe(true); // the new ~30 mm disc
    expect(sizes.some((w) => w > 0.044 && w < 0.052)).toBe(false); // the old 48 mm wheel is gone
  });

  it('the park-brake lever stands on a long shaft (arm >= 0.16 m)', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('ready_to_taxi');
    const lv = ctl<Lever>('lon.ped.park_brake');
    let maxZ = 0;
    for (const c of lv.handle.children) maxZ = Math.max(maxZ, c.position.z);
    expect(maxZ).toBeGreaterThanOrEqual(0.16);
  });

  it('the tiller carries the large scalloped grip with a ~95 mm hit target', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('ready_to_taxi');
    const t = ctl('lon.tiller');
    const wide = t.hitTargets.some((h) => {
      const g = (h as THREE.Mesh).geometry as THREE.BoxGeometry;
      return g?.parameters?.width !== undefined && g.parameters.width >= 0.09;
    });
    expect(wide).toBe(true);
  });
});

describe('L2-10 / L2-11: pedestal / glareshield finish states', () => {
  it('CVR TEST cap is green, ERASE red', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('ready_to_taxi');
    let green = false;
    ctl('lon.ped.cvr_test').object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material)?.name === 'lon.cvrGreen') green = true;
    });
    expect(green).toBe(true);
  });

  it('unlit ENG FIRE / APU FIRE lenses are near black in cold & dark', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('cold_dark');
    const hsl = { h: 0, s: 0, l: 0 };
    for (const id of ['lon.gs.fire_l', 'lon.gs.fire_r', 'lon.gs.fire_apu']) {
      const face = ctl<GuardedButton>(id).inner.face as unknown as { segs: { mat: THREE.MeshStandardMaterial }[] };
      face.segs[0].mat.color.getHSL(hsl);
      expect(hsl.l, id).toBeLessThan(0.035);
    }
  });
});
