/**
 * Dynamic instancing of moving control parts (src/cockpit/instancing.ts): key caps and legends, breaker
 * caps and ratings, push-button caps, engraved text and lenses are drawn as shared InstancedMesh batches
 * after CockpitBuilder.build(); the original meshes stay as invisible proxies. Checks the draw-call
 * saving, that a pressed key / pulled breaker moves exactly its own instances, lens emissive mirroring,
 * visibility and hover handling, parts that must not be instanced, and disposal.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { CockpitBuilder } from '../../src/cockpit/CockpitBuilder';
import { CircuitBreaker, GuardedButton, KeyPad, PushButton, Yoke } from '../../src/cockpit/controls';
import { ControlInstances } from '../../src/cockpit/instancing';
import type { CockpitControl, ControlPointer } from '../../src/cockpit/types';

function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

function batches(root: THREE.Object3D): THREE.InstancedMesh[] {
  return root.children.filter((c) => c.userData.cockpitMovingInstances) as THREE.InstancedMesh[];
}

/** World-space translation of instance i of a batch. */
function instPos(im: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  im.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

function ptr(c: CockpitControl, target: THREE.Object3D): ControlPointer {
  c.object.updateWorldMatrix(true, true);
  return { button: 0, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target };
}

const ROWS = [
  [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
  [{ id: 'E' }, { id: 'F' }, { id: 'G' }, { id: 'H' }],
  [{ id: 'EXEC', lightVar: 'fms.mod', w: 2 }, { id: 'CLR' }],
];

function rig(instanceMoving = true) {
  const vars = new SimVars();
  const events = new EventBus();
  const b = new CockpitBuilder({ vars, events }, { palette: 'citation', eyePosition_m: [0, 0, 0], instanceMoving });
  const p = b.panel({ name: 'p', center_m: [1, 0, 0], width: 0.4, height: 0.3 });
  const kp = p.add(new KeyPad(b.env, { id: 'kp', rows: ROWS, eventPrefix: 'k.' }), -0.15, 0.1);
  const cbs = [0, 1, 2, 3, 4, 5].map((i) => p.add(new CircuitBreaker(b.env, { id: `cb${i}`, var: `cb.x${i}`, trippedVar: `cb.x${i}_tripped`, rating: 5 }), 0.05 + i * 0.02, 0.1));
  const btns = [0, 1, 2].map((i) =>
    p.add(new PushButton(b.env, { id: `pb${i}`, var: `pb.${i}`, mode: 'toggle', segments: [{ text: 'ON', color: 'green', whenOn: true }, { text: 'FAULT', color: 'amber', var: `pb.f${i}` }] }), 0.05 + i * 0.03, -0.05),
  );
  const guarded = p.add(new GuardedButton(b.env, { id: 'gb', var: 'gb', segments: [{ text: 'DISCH', color: 'amber', var: 'gb.l' }] }), -0.1, -0.1);
  const yoke = b.place(new Yoke(b.env, { id: 'yoke', style: 'boeing', switches: [{ anchor: 'leftOutboard', kind: 'button', options: { id: 'apdisc', var: 'input.ap_disc' } }] }), { center_m: [0.6, -0.4, 0.2] });
  const build = b.build();
  build.root.updateMatrixWorld(true);
  return { vars, events, b, build, kp, cbs, btns, guarded, yoke };
}

describe('dynamic instancing of moving control parts', () => {
  it('draws the keypad, breakers and buttons in far fewer calls with the same parts', () => {
    const plain = rig(false);
    const inst = rig(true);
    const n0 = drawCalls(plain.build.root);
    const n1 = drawCalls(inst.build.root);
    const st = inst.build.movingStats!;
    expect(st.parts).toBeGreaterThan(40);
    // Every instanced part was one call; the batches replace them.
    expect(n1).toBe(n0 - st.parts + st.batches);
    expect(n1).toBeLessThan(n0 / 2);
    // Each batch instances exactly the proxies that disappeared (no part drawn twice).
    let proxies = 0;
    inst.build.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.visible && ControlInstances.of(o) === null && !o.userData.hitBox && o.name !== 'cbWhiteBand') proxies++;
    });
    expect(proxies).toBeGreaterThanOrEqual(st.parts);
    expect(batches(inst.build.root).reduce((a, m) => a + m.count, 0)).toBe(st.parts);
  });

  it('a pressed key moves only its own cap and legend instances; release returns them', () => {
    const { kp, build } = rig();
    const caps = batches(build.root).find((m) => m.name.startsWith('moving-inst:cockpit.plasticGrey') && m.count >= 8)!;
    expect(caps).toBeTruthy();
    const before = Array.from({ length: caps.count }, (_, i) => instPos(caps, i));
    const hitB = kp.hitTargets[1];
    kp.onPointerDown?.(ptr(kp, hitB));
    for (let i = 0; i < 20; i++) kp.update(1 / 60);
    const after = Array.from({ length: caps.count }, (_, i) => instPos(caps, i));
    const moved = after.map((p, i) => p.distanceTo(before[i])).filter((d) => d > 1e-4);
    expect(moved.length).toBe(1);
    expect(moved[0]).toBeCloseTo(0.0014, 4); // key travel
    kp.onPointerUp?.(ptr(kp, hitB));
    for (let i = 0; i < 60; i++) kp.update(1 / 60);
    for (let i = 0; i < caps.count; i++) expect(instPos(caps, i).distanceTo(before[i])).toBeLessThan(1e-5);
  });

  it('breaker: pulled cap instance pops out 4.2 mm and the band is drawn only while out', () => {
    const { cbs, vars, build } = rig();
    const cb = cbs[2];
    const band = cb.object.getObjectByName('cbWhiteBand')!;
    expect(band.visible).toBe(false);
    const n0 = drawCalls(build.root);
    const caps = batches(build.root).find((m) => m.count === 6)!;
    const before = Array.from({ length: 6 }, (_, i) => instPos(caps, i));
    vars.set('cb.x2', 0);
    vars.set('cb.x2_tripped', 1);
    for (let i = 0; i < 60; i++) for (const c of cbs) c.update(1 / 60);
    expect(band.visible).toBe(true);
    expect(drawCalls(build.root)).toBe(n0 + 1);
    const d = Array.from({ length: 6 }, (_, i) => instPos(caps, i).distanceTo(before[i]));
    expect(d.filter((x) => x > 1e-4).length).toBe(1);
    expect(Math.max(...d)).toBeCloseTo(0.0042, 4);
  });

  it('lens instances mirror the segment lamp intensity', () => {
    const { btns, vars, build } = rig();
    const lens = batches(build.root).find((m) => m.name === 'moving-inst:cockpit.lens#inst')!;
    const em = lens.geometry.getAttribute('instEmissive') as THREE.InstancedBufferAttribute;
    const lit = () => {
      let n = 0;
      for (let i = 0; i < em.count; i++) if (em.getX(i) + em.getY(i) + em.getZ(i) > 0.1) n++;
      return n;
    };
    expect(lit()).toBe(0);
    vars.set('pb.f1', 1);
    for (let i = 0; i < 30; i++) for (const b of btns) b.update(1 / 60);
    expect(lit()).toBe(1);
    // FAULT is amber: red + green channels, no blue.
    let k = -1;
    for (let i = 0; i < em.count; i++) if (em.getX(i) > 0.1) k = i;
    expect(em.getY(k)).toBeGreaterThan(0.3 * em.getX(k)); // #ffb000 in linear RGB: G ~ 0.43 R
    expect(em.getZ(k)).toBeLessThan(0.05);
  });

  it('hides instances with their control, and draws the originals while hovered', () => {
    const { kp, build } = rig();
    const ci = ControlInstances.of(kp.object)!;
    expect(ci.count).toBeGreaterThan(10);
    const caps = batches(build.root).find((m) => m.name.startsWith('moving-inst:cockpit.plasticGrey') && m.count >= 8)!;
    const scale = (i: number) => {
      const m = new THREE.Matrix4();
      caps.getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixScale(m).length();
    };
    kp.object.visible = false;
    kp.update(1 / 60);
    for (let i = 0; i < caps.count; i++) expect(scale(i)).toBe(0);
    kp.object.visible = true;
    kp.update(1 / 60);
    expect(scale(0)).toBeGreaterThan(0.5);
    // Hover: originals drawn (for the rim highlight), instances hidden.
    kp.onHover?.(true);
    kp.update(1 / 60);
    expect(ci.showingProxies).toBe(true);
    let shown = 0;
    kp.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.hitBox && o.visible) shown++;
    });
    expect(shown).toBeGreaterThan(10);
    expect(scale(0)).toBe(0);
    kp.onHover?.(false);
    kp.update(1 / 60);
    expect(ci.showingProxies).toBe(false);
    expect(scale(0)).toBeGreaterThan(0.5);
  });

  it('does not instance yoke-mounted buttons (dynamic) or buttons nested in a guard', () => {
    const { yoke, guarded } = rig();
    expect(ControlInstances.of(yoke.subControls[0].object)).toBeNull();
    expect(ControlInstances.of(guarded.inner.object)).toBeNull();
    let visibleMeshes = 0;
    guarded.inner.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.hitBox && o.visible) visibleMeshes++;
    });
    expect(visibleMeshes).toBeGreaterThan(1);
  });

  it('dispose removes the batches', () => {
    const { build } = rig();
    expect(batches(build.root).length).toBeGreaterThan(0);
    const root = build.root;
    build.dispose?.();
    expect(batches(root).length).toBe(0);
  });
});
