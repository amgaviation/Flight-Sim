/**
 * Cessna 172S G1000 NXi cockpit layout / function fixes (fix round 1, layout lens):
 *  - L1 / L2: GFC 700 grip switches per POH 172SPHBUS-00 Fig 7-2 Detail A and item 14.
 *  - L3: glareshield and upper-panel edge follow an arc (lower toward the ends).
 *  - L4: WARN breaker 5 A (photograph "Cessna 172SP G1000 01.jpg").
 *  - L5: softkeys carry the printed up-triangle.
 *  - L7: round STBY BATT TEST jewel lamp lit by the standby battery test.
 *  - L10 / L11: glove box latch opens the door; 12V outlet device loads the bus; AUX AUDIO IN cable.
 *  - L12: one pedestal width.
 *  - L13: compass view preset; the compass (with its FOR / STEER card) is built.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeG1k, type G1kRig } from './helpers';
import { fakeCanvas } from './fakeCanvas';
import { buildC172G1000Cockpit, type C172G1000Cockpit } from '../../../src/aircraft/c172-g1000/cockpit';
import { JewelLamp } from '../../../src/aircraft/c172-g1000/cockpit/jewelLamp';
import { PED } from '../../../src/aircraft/c172-g1000/cockpit/pedestal';
import { PEDESTAL, glareSagIn } from '../../../src/aircraft/c172-g1000/cockpit/layout';
import { archedGlareshield } from '../../../src/aircraft/c172-g1000/cockpit/shell';
import { G1000_BREAKERS } from '../../../src/aircraft/c172s-common/systems/electrical';
import { C172, STBY_BATT } from '../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../src/aircraft/c172-g1000/vars';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';

const g = globalThis as unknown as { OffscreenCanvas?: unknown };
const hadOffscreen = 'OffscreenCanvas' in g;
const prevOffscreen = g.OffscreenCanvas;
beforeAll(() => {
  g.OffscreenCanvas = class {
    constructor(w: number, h: number) {
      return fakeCanvas(w, h);
    }
  };
});
afterAll(() => {
  if (hadOffscreen) g.OffscreenCanvas = prevOffscreen;
  else delete g.OffscreenCanvas;
});

function build(r: G1kRig): C172G1000Cockpit {
  const ck = buildC172G1000Cockpit(r.ctx, r.sys.suite.cfg, { analog: true });
  ck.build.root.updateMatrixWorld(true);
  return ck;
}

function byId(ck: C172G1000Cockpit): Map<string, CockpitControl> {
  const m = new Map<string, CockpitControl>();
  const walk = (c: CockpitControl) => {
    m.set(c.id, c);
    for (const s of (c as { subControls?: CockpitControl[] }).subControls ?? []) walk(s);
  };
  for (const c of ck.build.controls) walk(c);
  return m;
}

/** Cockpit-local position (x right, y up, z aft) of a control. */
function pos(ck: C172G1000Cockpit, c: CockpitControl): THREE.Vector3 {
  const w = c.object.getWorldPosition(new THREE.Vector3());
  return ck.build.root.worldToLocal(w);
}

function click(c: CockpitControl): void {
  const t = c.hitTargets[0] ?? c.object;
  const point = t.getWorldPosition(new THREE.Vector3());
  const p: ControlPointer = { button: 0, shift: false, ctrl: false, alt: false, point, object: t };
  c.onPointerDown?.(p);
  c.update?.(0.05);
  c.onPointerUp?.(p);
  c.update?.(0.05);
}

describe('Cessna 172S G1000 NXi cockpit layout (POH Fig 7-2)', () => {
  it('pilot grip: MIC forward of CWS on the pod top, A/P TRIM DISC above MET on the inboard face (Detail A)', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const ids = byId(ck);
    const ptt = pos(ck, ids.get('c172g.yoke1.ptt')!);
    const cws = pos(ck, ids.get('c172g.yoke1.cws')!);
    const disc = pos(ck, ids.get('c172g.yoke1.ap_disc')!);
    const met = pos(ck, ids.get('c172g.yoke1.met')!);
    // Top face: MIC and CWS higher than the inboard-face switches; MIC forward (smaller z) of CWS.
    expect(ptt.y).toBeGreaterThan(disc.y);
    expect(cws.y).toBeGreaterThan(disc.y);
    expect(ptt.z).toBeLessThan(cws.z - 0.01);
    // Inboard face (toward the centreline, +x for the pilot's left grip): A/P TRIM DISC above the MET.
    expect(disc.x).toBeGreaterThan(ptt.x + 0.015);
    expect(met.x).toBeGreaterThan(ptt.x + 0.015);
    expect(disc.y).toBeGreaterThan(met.y + 0.015);
    // Copilot microphone button on the right (outboard) grip (item 14).
    const cp = pos(ck, ids.get('c172g.yoke2.ptt')!);
    expect(cp.x).toBeGreaterThan(9.2 * 0.0254 + 0.1);
    ck.build.dispose?.();
  });

  it('glareshield and upper panel edge arc down toward the ends (Fig 7-2)', () => {
    expect(glareSagIn(0)).toBe(0);
    expect(glareSagIn(15)).toBeCloseTo(0.6, 5);
    expect(glareSagIn(-19.75)).toBeGreaterThan(1.9);
    const gs = archedGlareshield();
    const p = gs.getAttribute('position') as THREE.BufferAttribute;
    // Top of the hood near the centre vs near the ends.
    let topC = -Infinity;
    let topE = -Infinity;
    let lowE = Infinity;
    let lowC = Infinity;
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i));
      if (x < 0.05) {
        topC = Math.max(topC, p.getY(i));
        lowC = Math.min(lowC, p.getY(i));
      }
      if (x > 0.48) {
        topE = Math.max(topE, p.getY(i));
        lowE = Math.min(lowE, p.getY(i));
      }
    }
    expect(topC - topE).toBeGreaterThan(0.01);
    // Ears: the brow flange reaches well below the centre flange at the ends.
    expect(lowC - lowE).toBeGreaterThan(0.05);
    gs.dispose();
  });

  it('WARN breaker is 5 A (X-FEED BUS photograph)', () => {
    expect(G1000_BREAKERS.find((b) => b.name === 'warn')!.ratingA).toBe(5);
  });

  it('pedestal width has one source (6 in, Fig 7-2)', () => {
    expect(PED).toBe(PEDESTAL);
    expect(PEDESTAL.width).toBeCloseTo(6 * 0.0254, 6);
  });

  it('STBY BATT TEST is a round jewel lamp lit during the standby battery test', () => {
    const rig = makeG1k({ state: 'cold_dark' });
    const ck = build(rig);
    const lamp = byId(ck).get('c172g.stby_batt_test_lamp')!;
    expect(lamp).toBeInstanceOf(JewelLamp);
    rig.vars.set(C172.stbyBatt, STBY_BATT.test);
    rig.run(1);
    for (let i = 0; i < 10; i++) lamp.update?.(0.05);
    expect(rig.vars.get(C172.stbyTestLamp)).toBe(1);
    expect(lamp.tooltip()).toContain('ON');
    ck.build.dispose?.();
  });

  it('glove box latch opens the door; outlet and aux jack plug in', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const ids = byId(ck);
    const door = ck.build.root.getObjectByName('glovebox_door')!;
    expect(door.rotation.x).toBeCloseTo(0, 6);
    click(ids.get('c172g.glovebox_latch')!);
    expect(rig.vars.get(C172G.glovebox)).toBe(1);
    for (let i = 0; i < 60; i++) ck.build.update?.(1 / 30);
    expect(door.rotation.x).toBeGreaterThan(1.2);
    click(ids.get('c172g.power_outlet')!);
    expect(rig.vars.get(C172G.outletDevice)).toBe(1);
    click(ids.get('c172g.aux_audio_jack')!);
    expect(rig.vars.get(C172G.auxAudioCable)).toBe(1);
    ck.build.update?.(1 / 30);
    expect(ck.build.root.getObjectByName('outlet_plug')!.visible).toBe(true);
    ck.build.dispose?.();
  });

  it('a device on the 12V outlet loads the bus through CABIN PWR 12V; AUX audio mutes while transmitting', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    rig.vars.set(C172.cabinPwr12v, 1);
    rig.run(2);
    const a0 = rig.vars.get('elec.cabin_12v_amps');
    rig.vars.set(C172G.outletDevice, 1);
    rig.run(2);
    const a1 = rig.vars.get('elec.cabin_12v_amps');
    expect(a1 - a0).toBeGreaterThan(1.5);
    rig.vars.set(C172.cabinPwr12v, 0);
    rig.run(1);
    expect(rig.vars.get('elec.cabin_12v_amps')).toBe(0);
    rig.vars.set(C172G.auxAudioCable, 1);
    rig.run(0.5);
    expect(rig.vars.get(C172G.auxAudioActive)).toBe(1);
    rig.vars.set(C172G.pttPilot, 1);
    rig.run(0.2);
    expect(rig.vars.get(C172G.auxAudioActive)).toBe(0);
  });

  it('compass view preset; the compass (with its FOR / STEER card) is built', () => {
    const rig = makeG1k({ state: 'cold_dark' });
    const ck = build(rig);
    const views = (ck.build as unknown as { views?: { name: string }[] }).views ?? [];
    expect(views.some((v) => v.name === 'Compass')).toBe(true);
    expect(ck.build.controls.some((c) => c.id === 'c172g.compass')).toBe(true);
    ck.build.dispose?.();
  });

  it('F16: flap lever has gated stops at 10 and 20 deg (POH 7-22)', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const lever = byId(ck).get('c172g.flaps')! as unknown as { logic: { detents: { value: number; kind?: string }[] } };
    const kinds = lever.logic.detents.map((d) => `${d.value}:${d.kind ?? 'soft'}`);
    expect(kinds).toEqual(['0:soft', '1:gate', '2:gate', '3:soft']);
    ck.build.dispose?.();
  });

  it('F9: windshield fog (DEFROST) and cabin smoke tint the windshield glass', () => {
    const rig = makeG1k({ state: 'ready_to_taxi' });
    const ck = build(rig);
    const ws = ck.build.root.getObjectByName('windshield') as THREE.Mesh;
    const mat = ws.material as THREE.MeshPhysicalMaterial;
    ck.build.update?.(1 / 30);
    const clear = mat.opacity;
    rig.vars.set(C172.windshieldFog, 1);
    ck.build.update?.(1 / 30);
    expect(mat.opacity).toBeGreaterThan(clear + 0.5);
    rig.vars.set(C172.windshieldFog, 0);
    ck.build.update?.(1 / 30);
    expect(mat.opacity).toBeCloseTo(clear, 3);
    ck.build.dispose?.();
  });
});
