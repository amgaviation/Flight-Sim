/**
 * Cessna 172S steam cockpit layout / fittings checks (layout audit fix round 1). Each case fails
 * against the pre-fix cockpit:
 *  - windshield defroster knobs exist and drive C172.defrostLeft/Right; the Inadvertent Icing item
 *    "Cabin Heat FULL OUT; defroster outlets OPEN" checks the defrosters (POH Sec 3 / Sec 7);
 *  - radio stack order KMA 28, KLN 94, KX 155A x2, KT 76C, KAP 140, KR 87 (VH-SPQ, N146TC);
 *  - elevator trim wheel large, ribbed and on the left of the pedestal (POH Fig 7-2 item 35);
 *  - control wheels ~11.5 in across the pods, the pilot's wheel clear of the radio stack;
 *  - annunciator panel legends unreadable (black lens) while unlit;
 *  - AUX AUDIO IN jack feeds the KMA 28 AUX input; the KMA 28 Swap indicator exists (dark);
 *  - no separate KLN 94 MSG / WPT / APR lamp strip (Supplement 19 Fig 2, serials 172S8704+);
 *  - parking brake a wide bar at X -12.6 in (POH Fig 7-2 item 43);
 *  - padded glareshield wider than the panel with its brow ~2 in aft of the panel face;
 *  - fuel selector on the sloped pedestal foot; sun visors and rotatable flood lights work;
 *  - propeller: faint blur disc and no solid blades from the cockpit at speed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { AnnunciatorLight } from '../../../src/cockpit/controls';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { ENG } from '../../../src/core/vars';
import { KMA, ST } from '../../../src/aircraft/c172-steam/vars';
import { UNITS } from '../../../src/aircraft/c172-steam/cockpit/stack';
import { WHEEL_SPAN_M } from '../../../src/aircraft/c172-steam/cockpit/yoke';
import { IN, PANEL, POS, YOKE } from '../../../src/aircraft/c172-steam/cockpit/layout';
import { C172_STEAM_CHECKLISTS } from '../../../src/aircraft/c172-steam/checklists';
import { createC172Exterior } from '../../../src/aircraft/c172s-common/exterior';
import { sta } from '../../../src/aircraft/c172s-common/fdm';
import { CabinFitting } from '../../../src/aircraft/c172-steam/cockpit/cabinControls';
import { steamCockpitRig } from './cockpitRig';

function ptr(c: CockpitControl, button: 0 | 1 | 2 = 0): ControlPointer {
  const t = c.hitTargets[0] ?? c.object;
  return { button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t };
}
function click(c: CockpitControl, button: 0 | 2 = 0): void {
  c.onPointerDown?.(ptr(c, button));
  c.onPointerUp?.(ptr(c, button));
  c.update?.(0.5);
}
/** Cockpit-local position of a control / object (x right, y up, z aft). */
function pos(o: THREE.Object3D): THREE.Vector3 {
  return o.getWorldPosition(new THREE.Vector3());
}

describe('c172-steam cockpit layout', async () => {
  const { r, ck } = await steamCockpitRig('ready_to_taxi');
  const build = ck.build;
  const byId = (id: string): CockpitControl => {
    const c = build.controls.find((x) => x.id === id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };

  it('windshield defroster knobs open the outlets; the icing checklist item needs them open', () => {
    const icing = C172_STEAM_CHECKLISTS.find((l) => l.title.includes('Inadvertent Icing'))!;
    const item = icing.items.find((i) => i.challenge === 'Cabin Heat')!;
    r.vars.set(C172.cabinHeat, 1);
    r.vars.set(C172.defrostLeft, 0);
    r.vars.set(C172.defrostRight, 0);
    expect(item.check!(r.vars)).toBe(false);
    for (const s of ['left', 'right']) click(byId(`c172s.defrost_${s}`));
    expect(r.vars.get(C172.defrostLeft)).toBeCloseTo(1);
    expect(r.vars.get(C172.defrostRight)).toBeCloseTo(1);
    expect(item.check!(r.vars)).toBe(true);
    // At the windshield base on the glareshield top, left and right of the centreline.
    const l = pos(byId('c172s.defrost_left').object);
    const rt = pos(byId('c172s.defrost_right').object);
    expect(l.x).toBeLessThan(-0.2);
    expect(rt.x).toBeGreaterThan(0.2);
  });

  it('radio stack order top to bottom: KMA 28, KLN 94, KX 155A, KX 155A, KT 76C, KAP 140, KR 87', () => {
    const order = ['kma28', 'kln94', 'kx1', 'kx2', 'kt76c', 'kap140', 'kr87'] as const;
    for (let i = 1; i < order.length; i++) {
      const a = UNITS[order[i - 1]];
      const b = UNITS[order[i]];
      expect(b.z).toBeGreaterThanOrEqual(a.z + a.h);
    }
    const kr = UNITS.kr87;
    expect(kr.z + kr.h).toBeLessThanOrEqual(POS.stack.Z1);
    // The transponder's IDT key sits above the KAP 140 AP key, the KR 87 ADF key below both.
    const y = (id: string): number => pos(byId(id).object).y;
    expect(y('c172s.kt76c.idt')).toBeGreaterThan(y('c172s.kap140.ap'));
    expect(y('c172s.kap140.ap')).toBeGreaterThan(y('c172s.kr87.adf'));
  });

  it('elevator trim wheel: large ribbed wheel on the left of the pedestal face', () => {
    const w = byId('c172s.trim_wheel');
    const box = new THREE.Box3().setFromObject(w.object);
    const size = box.getSize(new THREE.Vector3());
    // ~6 in of exposed rim (vertical/along the face) and grip nubs.
    expect(Math.max(size.y, size.z)).toBeGreaterThan(0.14);
    let nubs = false;
    w.object.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g && (o as THREE.Mesh).isMesh && !o.userData.hitBox && g.getAttribute('position').count > 500) nubs = true;
    });
    expect(nubs).toBe(true);
    // Left third of the 6 in pedestal (centreline x = 0).
    expect(pos(w.object).x).toBeLessThan(-0.02);
  });

  it('control wheels ~11.5 in across the pods; the pilot wheel clears the radio stack', () => {
    expect(WHEEL_SPAN_M).toBeGreaterThan(11 * IN);
    expect(WHEEL_SPAN_M).toBeLessThan(12.2 * IN);
    const pilotRight = -YOKE.y + WHEEL_SPAN_M / 2;
    expect(pilotRight).toBeLessThan(POS.stack.X0 * IN);
    // Gap between the pilot's right and the copilot's left pod: stack width plus ~1-2 in.
    const gap = 2 * YOKE.y - WHEEL_SPAN_M;
    expect(gap / IN).toBeGreaterThan(6.9);
  });

  it('annunciator panel: black unlit lenses, legends only when lit', () => {
    const cells = build.controls.filter((c) => c.id.startsWith('c172s.ann.')) as AnnunciatorLight[];
    expect(cells.length).toBe(5);
    for (const c of cells) {
      c.object.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.userData?.cockpitLens) expect(Math.max(m.color.r, m.color.g, m.color.b)).toBeLessThan(0.03);
      });
    }
  });

  it('AUX AUDIO IN jack feeds the KMA 28 AUX input; the Swap indicator is fitted and dark', () => {
    const jack = byId('c172s.aux_audio_jack');
    r.vars.set(KMA.sel('aux'), 1);
    r.vars.set(ST.auxJack, 0);
    r.run(0.2);
    expect(r.vars.get(KMA.auxLevel)).toBe(0);
    click(jack);
    expect(r.vars.get(ST.auxJack)).toBe(1);
    r.run(0.2);
    expect(r.vars.get(KMA.auxLevel)).toBeGreaterThan(0);
    const swap = byId('c172s.kma28.swap') as AnnunciatorLight;
    expect(swap.face.count).toBe(1);
    r.run(0.2);
    expect(r.vars.get(KMA.swapLamp)).toBe(0);
    click(jack);
  });

  it('no separate KLN 94 MSG / WPT / APR lamp strip (Supplement 19 Fig 2)', () => {
    expect(build.controls.filter((c) => c.id.startsWith('c172s.kln_ann.'))).toEqual([]);
    expect(build.controls.some((c) => c.id === 'c172s.navgps')).toBe(true);
  });

  it('parking brake: wide bar handle at X -12.6 in under the lower panel', () => {
    const pb = byId('c172s.parking_brake');
    const box = new THREE.Box3().setFromObject(pb.object);
    expect(box.max.x - box.min.x).toBeGreaterThan(4.5 * IN);
    expect(pos(pb.object).x / IN).toBeCloseTo(-12.6, 0);
  });

  it('padded glareshield: panel-wide brow about 2 in aft of the panel face', () => {
    let g: THREE.Object3D | undefined;
    build.root.traverse((o) => {
      if (o.name === 'glareshield') g = o;
    });
    // Static structure may have been merged: fall back to the build's structure bounds.
    if (g) {
      const box = new THREE.Box3().setFromObject(g);
      expect(box.max.x - box.min.x).toBeGreaterThan(PANEL.widthIn * IN - 0.005);
      const faceZ = -sta(PANEL.fs);
      expect(box.max.z - faceZ).toBeGreaterThan(1.8 * IN);
    }
  });

  it('fuel selector on the sloped pedestal foot (handle tilted up and aft)', () => {
    const fs = byId('c172s.fuel_selector');
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(fs.object.getWorldQuaternion(new THREE.Quaternion()));
    // Normal points up and aft: neither vertical (floor plate) nor horizontal (pedestal face).
    expect(n.y).toBeGreaterThan(0.5);
    expect(n.z).toBeGreaterThan(0.4);
  });

  it('sun visors swing down and up; the front floods aim', () => {
    const v = byId('c172s.visor_left') as unknown as CabinFitting;
    expect(v).toBeInstanceOf(CabinFitting);
    click(v as unknown as CockpitControl);
    expect(r.vars.get(ST.visorLeft)).toBe(1);
    click(v as unknown as CockpitControl, 2);
    expect(r.vars.get(ST.visorLeft)).toBe(0);
    const f = byId('c172s.flood_aim_left') as unknown as CabinFitting;
    const s0 = f.physicalState();
    (f as unknown as CockpitControl).onDrag?.(40, 20, ptr(f as unknown as CockpitControl));
    (f as unknown as CockpitControl).update?.(0.1);
    expect(f.physicalState()).not.toBe(s0);
  });

  it('propeller from the cockpit: faint blur disc, no solid blades at speed', () => {
    const ext = createC172Exterior(r.vars);
    ext.root.updateMatrixWorld(true);
    let disc: THREE.Mesh | undefined;
    let blade: THREE.Object3D | undefined;
    ext.root.traverse((o) => {
      if (o.name === 'prop_disc') disc = o as THREE.Mesh;
      if (o.name === 'blade0') blade = o;
    });
    expect(disc && blade).toBeTruthy();
    const cam = new THREE.PerspectiveCamera();
    const discAt = disc!.getWorldPosition(new THREE.Vector3());
    const render = (dist: number): number => {
      cam.position.copy(discAt).add(new THREE.Vector3(0, 0.3, dist));
      cam.updateMatrixWorld(true);
      disc!.onBeforeRender(undefined as never, undefined as never, cam, undefined as never, disc!.material as THREE.Material, undefined as never);
      ext.update(1 / 60);
      return (disc!.material as THREE.Material).opacity;
    };
    r.vars.set(ENG.rpm(1), 2400);
    const far = render(15);
    render(15);
    expect(blade!.visible).toBe(false); // full blur from outside too
    r.vars.set(ENG.rpm(1), 1000);
    const near = render(2);
    render(2);
    expect(near).toBeLessThan(0.1);
    expect(blade!.visible).toBe(false);
    r.vars.set(ENG.rpm(1), 2400);
    expect(far).toBeGreaterThan(0.3);
    ext.dispose();
  });
});
