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
import { LONGITUDE_FUSELAGE } from '../../../src/aircraft/citation-longitude/exterior';
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

  // L2-11 residual: the near-black lens rendered pale salmon anyway, because the shared guardClear cover
  // (opacity 0.15, whitish) hazed it under daylight ambient. The fire guards now carry a per-guard clearer
  // cover (opacity 0.05) so the unlit lens stays deep opaque red (OEG p.12 / a21_004).
  it('fire switchlight clear guards carry almost no haze (cover opacity <= 0.06)', { timeout: 120_000 }, () => {
    const { ctl } = cockpit('cold_dark');
    for (const id of ['lon.gs.fire_l', 'lon.gs.fire_r', 'lon.gs.fire_apu']) {
      let cover: THREE.Material | null = null;
      ctl<GuardedButton>(id).object.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.Material | undefined;
        if (m.isMesh && mat?.name === 'cockpit.guardClear' && mat.transparent) cover = mat;
      });
      expect(cover, `${id} clear cover`).toBeTruthy();
      expect((cover! as THREE.Material).opacity, id).toBeLessThanOrEqual(0.06);
    }
  });
});

describe('L2-03 residual: no shell trim intrudes into the glazing (the "faceted cheek" wedge)', () => {
  /** |theta| (rad from the top of the section) of a shell-loft vertex, from the un-inset section radii (small error, wide margins below). */
  const thetaOf = (v: THREE.Vector3): { x: number; th: number } => {
    const bx = -v.z;
    const by = v.x;
    const bz = -v.y;
    const s = LONGITUDE_FUSELAGE.at(bx);
    return { x: bx, th: Math.abs(Math.atan2(by / Math.max(0.01, s.ry), (s.cz - bz) / Math.max(0.01, s.rz))) };
  };
  /** Unmerged build so the shell's named structure meshes are inspectable. */
  const shellRoot = (): THREE.Object3D => {
    const r = makeRig('cold_dark', { avionics: false });
    const { build } = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true, mergeStatic: false });
    return build.root;
  };
  const verts = (root: THREE.Object3D, name: string): { x: number; th: number }[] => {
    let g: THREE.BufferGeometry | null = null;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name === name) g = (o as THREE.Mesh).geometry;
    });
    expect(g, name).toBeTruthy();
    const p = (g! as THREE.BufferGeometry).getAttribute('position');
    const out: { x: number; th: number }[] = [];
    for (let i = 0; i < p.count; i++) out.push(thetaOf(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i))));
    return out;
  };

  it('the CB-panel wall band stays below the side-window sill', { timeout: 120_000 }, () => {
    // Round 2 lofted cb_wall_* over theta 1.02..1.3 at inset 0.033 (outside the sidewall): its only visible part
    // poked through the windshield / forward-window glazing corner as a big faceted black wedge in the pilot
    // view (the audit blamed the cheek loft). The band must stay at or below the sill (1.3).
    const root = shellRoot();
    for (const name of ['cb_wall_l', 'cb_wall_r']) for (const v of verts(root, name)) expect(v.th, `${name} at x ${v.x.toFixed(2)}`).toBeGreaterThan(1.27);
  });

  it('the panel-cheek upper edge tapers aft below the sill instead of a straight angular cut', { timeout: 120_000 }, () => {
    const root = shellRoot();
    for (const name of ['panel_cheek_l', 'panel_cheek_r']) {
      const vs = verts(root, name);
      const aftTop = Math.min(...vs.filter((v) => v.x < 8.32).map((v) => v.th));
      const fwdTop = Math.min(...vs.filter((v) => v.x > 8.6).map((v) => v.th));
      // Forward the wrap still meets the A-pillar base (~1.215); aft its free edge rolls down below the sill.
      expect(fwdTop, `${name} fwd`).toBeLessThan(1.28);
      expect(aftTop, `${name} aft`).toBeGreaterThan(1.4);
    }
  });
});
