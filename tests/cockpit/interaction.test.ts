import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { createCockpitEnv } from '../../src/cockpit/env';
import { CockpitInteraction } from '../../src/cockpit/Interaction';
import { RotaryKnob, ToggleSwitch } from '../../src/cockpit/controls';
import type { CockpitDisplay } from '../../src/cockpit/types';

/** Minimal element: EventTarget + the few DOM methods the manager uses. */
class FakeEl extends EventTarget {
  style: Record<string, string> = {};
  private readonly cap = new Set<number>();
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
  }
  setPointerCapture(id: number) {
    this.cap.add(id);
  }
  hasPointerCapture(id: number) {
    return this.cap.has(id);
  }
  releasePointerCapture(id: number) {
    this.cap.delete(id);
  }
}

function fire(el: EventTarget, type: string, init: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, movementX: 0, movementY: 0, ...init });
  el.dispatchEvent(e);
  return e;
}

function setup() {
  const vars = new SimVars();
  const events = new EventBus();
  const env = createCockpitEnv({ vars, events });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.01, 100);
  camera.position.set(0, 0, 0.3);
  scene.add(camera);
  const el = new FakeEl();
  const looks: [number, number][] = [];
  let zoom = 0;
  const ia = new CockpitInteraction({
    domElement: el as unknown as HTMLElement,
    camera,
    tooltips: false,
    onLook: (dx, dy) => looks.push([dx, dy]),
    onEmptyWheel: (n) => (zoom += n),
  });
  return { vars, env, scene, camera, el, ia, looks, zoom: () => zoom };
}

describe('CockpitInteraction', () => {
  it('clicks and wheels on a control at the cursor', () => {
    const { vars, env, scene, el, ia } = setup();
    const sw = new ToggleSwitch(env, { id: 'batt', var: 'ac.batt' });
    scene.add(sw.object);
    scene.updateMatrixWorld(true);
    ia.register(sw);
    const pick = ia.pick(400, 300);
    expect(pick?.kind).toBe('control');
    const down = fire(el, 'pointerdown', { clientX: 400, clientY: 300 });
    expect(down.defaultPrevented).toBe(true);
    expect(ia.busy).toBe(true);
    fire(el, 'pointerup', { clientX: 400, clientY: 300 });
    expect(ia.busy).toBe(false);
    expect(vars.get('ac.batt')).toBe(1);
    // Wheel down (deltaY > 0) = one notch down.
    fire(el, 'wheel', { clientX: 400, clientY: 300, deltaY: 100, deltaX: 0, deltaMode: 0 });
    expect(vars.get('ac.batt')).toBe(0);
    // Line-mode wheel (Firefox): 3 lines = one notch.
    fire(el, 'wheel', { clientX: 400, clientY: 300, deltaY: -3, deltaX: 0, deltaMode: 1 });
    expect(vars.get('ac.batt')).toBe(1);
  });

  it('Shift+wheel reported as horizontal scroll still turns the inner knob', () => {
    const { vars, env, scene, el, ia } = setup();
    const k = new RotaryKnob(env, { id: 'k', outer: { var: 'ac.o', min: 0, max: 10, step: 1 }, inner: { var: 'ac.i', min: 0, max: 10, step: 1 } });
    scene.add(k.object);
    scene.updateMatrixWorld(true);
    ia.register(k);
    fire(el, 'wheel', { clientX: 400, clientY: 300, deltaY: 0, deltaX: -100, deltaMode: 0, shiftKey: true });
    expect(vars.get('ac.i')).toBe(1);
    expect(vars.get('ac.o')).toBe(0);
  });

  it('drags on empty space become free look; wheel on empty space zooms', () => {
    const { el, ia, looks, zoom } = setup();
    fire(el, 'pointerdown', { clientX: 50, clientY: 50, button: 2 });
    fire(el, 'pointermove', { clientX: 60, clientY: 45 });
    fire(el, 'pointerup', { clientX: 60, clientY: 45, button: 2 });
    expect(looks).toEqual([[10, -5]]);
    const cm = fire(el, 'contextmenu', {});
    expect(cm.defaultPrevented).toBe(true);
    fire(el, 'wheel', { clientX: 50, clientY: 50, deltaY: -100, deltaX: 0, deltaMode: 0 });
    expect(zoom()).toBe(1);
    expect(ia.busy).toBe(false);
  });

  it('forwards touches on displays in canvas pixels', () => {
    const { scene, el, ia } = setup();
    const got: [number, number, string][] = [];
    const disp: CockpitDisplay = {
      id: 'gtc',
      canvas: {} as HTMLCanvasElement,
      width: 400,
      height: 300,
      refreshHz: 10,
      render: () => false,
      onPointer: (x, y, kind) => void got.push([x, y, kind]),
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    scene.updateMatrixWorld(true);
    ia.registerDisplay(disp, mesh);
    fire(el, 'pointerdown', { clientX: 400, clientY: 300 });
    fire(el, 'pointerup', { clientX: 400, clientY: 300 });
    expect(got[0][2]).toBe('down');
    expect(got[0][0]).toBeCloseTo(200, 0);
    expect(got[0][1]).toBeCloseTo(150, 0);
    expect(got[1][2]).toBe('up');
  });

  it('occluders block controls behind them; hover highlights moving parts', () => {
    const { env, scene, el, ia } = setup();
    const sw = new ToggleSwitch(env, { id: 's', var: 'ac.s' });
    scene.add(sw.object);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    wall.position.z = 0.1;
    scene.add(wall);
    scene.updateMatrixWorld(true);
    ia.register(sw);
    ia.setOccluders([wall]);
    expect(ia.pick(400, 300)).toBeNull();
    ia.setOccluders([]);
    expect(ia.pick(400, 300)?.kind).toBe('control');
    fire(el, 'pointermove', { clientX: 400, clientY: 300, pointerId: 2 });
    expect(ia.hoveredControl).toBe(sw);
    let overlays = 0;
    sw.object.traverse((o) => {
      if (o.userData.overlay) overlays++;
    });
    expect(overlays).toBeGreaterThan(0);
    expect(el.style.cursor).toBe('ns-resize');
  });

  it('ignores disabled controls', () => {
    const { vars, env, scene, ia } = setup();
    const sw = new ToggleSwitch(env, { id: 's', var: 'ac.s', enabledVar: 'ac.enabled' });
    scene.add(sw.object);
    scene.updateMatrixWorld(true);
    ia.register(sw);
    vars.set('ac.enabled', 0);
    expect(ia.pick(400, 300)).toBeNull();
    vars.set('ac.enabled', 1);
    expect(ia.pick(400, 300)?.kind).toBe('control');
    ia.dispose();
  });
});
