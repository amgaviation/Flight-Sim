import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CockpitBuilder } from '../../../src/cockpit/CockpitBuilder';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { KeyPad } from '../../../src/cockpit/controls';
import { AP, NAV } from '../../../src/core/vars';
import { addAfds, addCcp, addCtp, addFcp, addIesi, addMkp, addRsp, CcpTrackball } from '../../../src/avionics/collins-fusion/cockpit';
import { FUSION_VARS } from '../../../src/avionics/collins-fusion/vars';
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
  const b = new CockpitBuilder({ vars: t.vars, events: t.events }, { palette: 'bombardier', eyePosition_m: [0, -0.36, -1.05] });
  const main = b.panel({ name: 'main', center_m: [0.8, 0, -0.75], facing: 'aft', width: 1.6, height: 0.6 });
  return { b, main };
}

describe('Global Vision cockpit hardware', () => {
  it('builds AFDs, FCP, CTPs, IESI, CCPs, MKPs and RSPs', () => {
    const t = makeSuite();
    const { b, main } = builder(t);
    expect(addAfds(main, t.suite, [[-0.55, 0], [-0.2, 0], [-0.2, -0.22], [0.15, 0]])).toHaveLength(4);
    addFcp(b, main, 0, 0.2, t.suite);
    expect(addCtp(b, main, -0.5, 0.2, t.suite, 1)).not.toBeNull();
    expect(addCtp(b, main, 0.5, 0.2, t.suite, 2)).not.toBeNull();
    addIesi(b, main, 0.4, 0, t.suite);
    addCcp(b, main, -0.4, -0.25, t.suite, 1);
    addMkp(b, main, 0.3, -0.25, t.suite, 1);
    addRsp(b, main, -0.7, -0.2, t.suite, 1);
    const build = b.build();
    expect(build.displays.length).toBe(4 + 2 + 1);
    const ids = new Set(build.controls.map((c) => c.id));
    for (const id of ['fusion.fcp.ap', 'fusion.fcp.hdg', 'fusion.fcp.alt', 'fusion.fcp.cpl', 'fusion.fcp.pitch', 'fusion.ctp1.tune', 'fusion.ctp1.fn', 'fusion.ccp1.ball', 'fusion.ccp1.enter', 'fusion.mkp1.keys', 'fusion.rsp1.adc', 'fusion.iesi.baro']) expect(ids.has(id), id).toBe(true);
  });

  it('FCP keys and knobs, CTP keys, MKP keys and the CCP trackball reach the suite', () => {
    const t = makeSuite();
    t.suite.applyState('cruise');
    const { b, main } = builder(t);
    addFcp(b, main, 0, 0, t.suite);
    addCtp(b, main, -0.5, 0.2, t.suite, 1);
    addCcp(b, main, 0.4, -0.2, t.suite, 1);
    addMkp(b, main, -0.4, -0.2, t.suite, 1);
    addRsp(b, main, 0.6, 0.2, t.suite, 2);
    const build = b.build();
    const byId = (id: string) => build.controls.find((c) => c.id === id)!;
    const log = recordEvents(t.events);
    click(byId('fusion.fcp.ap'));
    expect(log.some((e) => e.name === 'ap.ap')).toBe(true);
    t.vars.set(AP.selHeading, 100);
    byId('fusion.fcp.hdg').onWheel?.(3, ptr(byId('fusion.fcp.hdg')));
    expect(t.vars.get(AP.selHeading)).toBe(103);
    click(byId('fusion.fcp.cpl'));
    expect(t.vars.get(FUSION_VARS.coupleSide)).toBe(2);
    (byId('fusion.ctp1.fn') as KeyPad).logic.press('IDENT');
    expect(t.vars.get(NAV.xpdrIdent)).toBe(1);
    (byId('fusion.mkp1.keys') as KeyPad).logic.press('K');
    expect(t.suite.fmsWin[0].scratch).toBe('K');
    const ball = byId('fusion.ccp1.ball') as CcpTrackball;
    t.suite.cursor.place(1, 3, 100, 100);
    ball.onDrag(10, 0);
    expect(t.suite.cursor.cursors[0].x).toBeGreaterThan(100);
    const rsp = byId('fusion.rsp2.dspl');
    click(rsp);
    run(t, 0.1);
    expect(t.vars.get(FUSION_VARS.rspDspl(2))).toBe(1);
    expect(t.vars.get(FUSION_VARS.eicasOn)).toBe(4);
  });
});
