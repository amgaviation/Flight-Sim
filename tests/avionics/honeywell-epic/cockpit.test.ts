import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CockpitBuilder } from '../../../src/cockpit/CockpitBuilder';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { KeyPad } from '../../../src/cockpit/controls';
import { AP } from '../../../src/core/vars';
import { addCasScrollSwitch, addCcd, addDisplaySwitching, addDisplayUnits, addGuidancePanel, addMcdu, addSmc, CcdTouchPad, addTsc, addOhpts, addSfd } from '../../../src/avionics/honeywell-epic/cockpit';
import { EPIC_VARS } from '../../../src/avionics/honeywell-epic/vars';
import { makeSuite, recordEvents, run } from './helpers';

function ptr(c: CockpitControl, target = c.hitTargets[0]): ControlPointer {
  c.object.updateWorldMatrix(true, true);
  return { button: 0, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target };
}

function click(c: CockpitControl): void {
  const p = ptr(c);
  c.onPointerDown?.(p);
  c.onPointerUp?.(p);
}

function builder(t: ReturnType<typeof makeSuite>) {
  const b = new CockpitBuilder({ vars: t.vars, events: t.events }, { palette: 'gulfstream', eyePosition_m: [0, -0.36, -1.05] });
  const main = b.panel({ name: 'main', center_m: [0.8, 0, -0.75], facing: 'aft', width: 1.4, height: 0.4 });
  return { b, main };
}

describe('Epic cockpit hardware', () => {
  it('builds the PlaneView II deck: DUs, GP, SMCs, MCDUs, CCD, switches', () => {
    const t = makeSuite('planeview2');
    const { b, main } = builder(t);
    expect(addDisplayUnits(main, t.suite, [[-0.5, 0], [-0.17, 0], [0.17, 0], [0.5, 0]]).length).toBe(4);
    addGuidancePanel(b, main, 0, 0.16, t.suite);
    expect(addSmc(b, main, -0.55, 0.16, t.suite, 1)).not.toBeNull();
    expect(addSmc(b, main, 0.55, 0.16, t.suite, 2)).not.toBeNull();
    expect(addMcdu(b, main, -0.4, -0.3, t.suite, 1)).not.toBeNull();
    addCcd(b, main, 0.4, -0.3, t.suite, 1);
    addCasScrollSwitch(b, main, 0.6, -0.3);
    addDisplaySwitching(b, main, -0.6, -0.3);
    // Symmetry-only hardware is not created on PlaneView II.
    expect(addTsc(main, 0, 0, t.suite, 1)).toBeNull();
    expect(addSfd(main, 0, 0, t.suite, 1)).toBeNull();
    expect(addOhpts(main, 0, 0, t.suite, 1)).toBeNull();
    const build = b.build();
    expect(build.displays.length).toBe(4 + 4 + 2 + 1);
    const ids = new Set(build.controls.map((c) => c.id));
    for (const id of ['epic.gp.ap', 'epic.gp.hdg', 'epic.gp.alt', 'epic.gp.pfdcmd', 'epic.smc1.set', 'epic.ccd1.pad', 'epic.ccd1.enter', 'epic.mcdu1.keys']) expect(ids.has(id), id).toBe(true);
  });

  it('guidance panel keys and knobs drive the guidance logic', () => {
    const t = makeSuite('planeview2');
    const { b, main } = builder(t);
    addGuidancePanel(b, main, 0, 0, t.suite);
    const build = b.build();
    const log = recordEvents(t.events);
    const byId = (id: string) => build.controls.find((c) => c.id === id)!;
    click(byId('epic.gp.ap'));
    expect(log.some((e) => e.name === 'ap.ap')).toBe(true);
    t.vars.set(AP.selHeading, 100);
    byId('epic.gp.hdg').onWheel?.(3, ptr(byId('epic.gp.hdg')));
    expect(t.vars.get(AP.selHeading)).toBe(103);
    click(byId('epic.gp.pfdcmd'));
    expect(t.vars.get(EPIC_VARS.coupleSide)).toBe(2);
  });

  it('SMC line select / function keys and MCDU keys reach the suite', () => {
    const t = makeSuite('planeview2');
    const { b, main } = builder(t);
    addSmc(b, main, 0, 0, t.suite, 1);
    addMcdu(b, main, 0.4, 0, t.suite, 2);
    const build = b.build();
    const kp = (id: string) => build.controls.find((c) => c.id === id) as KeyPad;
    kp('epic.smc1.fn').logic.press('PFD');
    expect(t.suite.dc.currentPage(1)).toBe('PFD');
    const fpv = t.vars.get(EPIC_VARS.fpv(1));
    kp('epic.smc1.lsk1').logic.press('1');
    expect(t.vars.get(EPIC_VARS.fpv(1))).toBe(fpv ? 0 : 1);
    kp('epic.smc1.stby').logic.press('STBY');
    expect(t.vars.get(EPIC_VARS.smcStandby(1))).toBe(1);
    kp('epic.mcdu2.fn').logic.press('RADIO');
    run(t, 0.1);
    expect(t.suite.mcdus[1].page.id).toBe('RADIO');
    kp('epic.mcdu2.keys').logic.press('1');
    kp('epic.mcdu2.keys').logic.press('2');
    expect(t.suite.mcdus[1].scratch).toBe('12');
    kp('epic.mcdu2.lskL').logic.press('L1');
    run(t, 0.1);
    expect(t.suite.mcdus[1].msg).toBe('INVALID ENTRY');
  });

  it('CCD touch pad and keys move the cursor and act on the DU under it', () => {
    const t = makeSuite('planeview2');
    const { b, main } = builder(t);
    addCcd(b, main, 0, 0, t.suite, 1);
    const build = b.build();
    const pad = build.controls.find((c) => c.id === 'epic.ccd1.pad') as CcdTouchPad;
    pad.onDrag(5, 0);
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(2);
    const x0 = t.vars.get(EPIC_VARS.ccdX(1));
    pad.onDrag(10, 0);
    expect(t.vars.get(EPIC_VARS.ccdX(1))).toBeGreaterThan(x0);
    (build.controls.find((c) => c.id === 'epic.ccd1.du') as KeyPad).logic.press('0');
    expect(t.vars.get(EPIC_VARS.ccdDu(1))).toBe(1);
  });

  it('CAS scroll switch and display switching toggles', () => {
    const t = makeSuite('planeview2');
    const { b, main } = builder(t);
    const log = recordEvents(t.events);
    const sw = addCasScrollSwitch(b, main, 0, 0);
    const ds = addDisplaySwitching(b, main, 0.2, 0);
    b.build();
    // Up position (index 2) springs back and emits the scroll-up event.
    sw.onWheel?.(1, ptr(sw));
    expect(log.some((e) => e.name === 'epic.cas.scroll_up')).toBe(true);
    click(ds[0]);
    expect(t.vars.get(EPIC_VARS.mfdSwitch(1))).toBe(1);
  });

  it('builds the Symmetry deck: TSCs, OHPTS, SFDs', () => {
    const t = makeSuite('symmetry');
    const { b, main } = builder(t);
    for (let n = 1; n <= 4; n++) expect(addTsc(main, -0.5 + n * 0.2, -0.3, t.suite, n)).not.toBeNull();
    for (let n = 1; n <= 3; n++) expect(addOhpts(main, -0.5 + n * 0.25, 0.3, t.suite, n)).not.toBeNull();
    expect(addSfd(main, -0.5, 0, t.suite, 1)).not.toBeNull();
    expect(addSmc(b, main, 0, 0, t.suite, 1)).toBeNull();
    expect(b.build().displays.length).toBe(8);
  });
});
