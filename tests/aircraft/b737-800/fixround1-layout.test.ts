/**
 * Fix round 1 (layout lens): functional coverage of the controls and behaviours added or moved by the layout
 * audit (gaps B738-L01/L02/L04/L06). Each test fails without its fix.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { buildB738Cockpit } from '../../../src/aircraft/b737-800/cockpit';
import { wxrEffectiveTiltDeg } from '../../../src/aircraft/b737-800/systems/surveillance';
import { B738 } from '../../../src/aircraft/b737-800/vars';
import { makeB738 } from './helpers';

const P = (t: THREE.Object3D, button: 0 | 1 | 2 = 0): ControlPointer => ({ button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t });

describe('737-800 fix round 1 (layout): aft pedestal radio / radar controls', () => {
  it('B738-L04: VHF COMM TEST held drives the RTP self-test state (only while the panel is powered)', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(1);
    expect(v.get('com1.powered')).toBe(1);
    v.set(B738.comTest(1), 1);
    r.run(0.3);
    expect(v.get('ac.b738.rtp1_test_active')).toBe(1);
    expect(v.get('ac.b738.rtp2_test_active')).toBe(0);
    v.set(B738.comTest(1), 0);
    r.run(0.3);
    expect(v.get('ac.b738.rtp1_test_active')).toBe(0);
    // Panel switched OFF: TEST does nothing.
    v.set(B738.rtpPower(1), 0);
    v.set(B738.comTest(1), 1);
    r.run(0.3);
    expect(v.get('ac.b738.rtp1_test_active')).toBe(0);
  });

  it('B738-L04: WXR STAB off lets the effective tilt follow pitch and bank; IDNT publishes wxr.idnt', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 12000, iasKt: 260, headingTrue: 90 } });
    const v = r.vars;
    r.run(2);
    expect(v.get('wxr.stab')).toBe(1);
    v.set(B738.wxrTilt, 2);
    v.set('ahrs1.pitch_deg', 6);
    v.set('ahrs1.bank_deg', 0);
    expect(wxrEffectiveTiltDeg(v)).toBeCloseTo(2, 5); // stabilized: selected tilt holds
    v.set(B738.wxrStab, 0);
    r.run(0.3);
    expect(v.get('wxr.stab')).toBe(0);
    // The systems overwrite the AHRS attitude each step: set it after the run, then read the helper directly.
    v.set('ahrs1.pitch_deg', 6);
    v.set('ahrs1.bank_deg', 0);
    expect(wxrEffectiveTiltDeg(v)).toBeCloseTo(8, 5); // unstabilized: beam follows the airframe pitch
    v.set(B738.wxrIdnt, 1);
    r.run(0.3);
    expect(v.get('wxr.idnt')).toBe(1);
    v.set(B738.wxrIdnt, 0);
    v.set(B738.wxrStab, 1);
    r.run(0.3);
    expect(v.get('wxr.idnt')).toBe(0);
  });

  it('B738-L04/L06: the cockpit carries the RTP TEST / WXR IDNT / WXR STAB buttons and the gear-handle override trigger', () => {
    const r = makeB738({ state: 'ready_to_taxi' });
    const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true, mainOnly: true });
    build.root.updateMatrixWorld(true);
    const get = (id: string): CockpitControl => {
      const c = build.controls.find((x) => x.id === id);
      if (!c) throw new Error(`no control ${id}`);
      return c;
    };
    for (const id of ['b738.aft.rtp1_test', 'b738.aft.rtp2_test', 'b738.aft.wxr_idnt', 'b738.aft.wxr_stab']) expect(get(id)).toBeTruthy();
    // Pressing the RTP 1 TEST button writes the comTest var.
    const t1 = get('b738.aft.rtp1_test');
    t1.onPointerDown?.(P(t1.hitTargets[0]));
    expect(r.vars.get(B738.comTest(1))).toBe(1);
    t1.onPointerUp?.(P(t1.hitTargets[0]));
    expect(r.vars.get(B738.comTest(1))).toBe(0);
    // B738-L06: the lock-override trigger is mounted on the gear lever handle (rides the handle group), not the panel.
    const gear = get('b738.mip.gear') as CockpitControl & { handle?: THREE.Group };
    const ovrd = get('b738.mip.gear_ovrd');
    let onHandle = false;
    ovrd.object.traverseAncestors((a) => {
      if (gear.handle && a === gear.handle) onHandle = true;
    });
    expect(onHandle).toBe(true);
    build.dispose?.();
  });
});
