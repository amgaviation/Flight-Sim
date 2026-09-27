/**
 * Citation M2 cockpit layout probe (fidelity audit, read-only): prints the
 * body-frame positions / sizes of the cockpit parts that the layout audit
 * compares against the S&D15 Figure III / S&D21 Figure 3 photographs. No
 * behaviour is asserted beyond "the cockpit builds"; the numbers are logged.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeM2 } from '../helpers';
import { buildM2Cockpit } from '../../../../src/aircraft/citation-m2/cockpit';
import { M2_FUSELAGE, WS_BASE_X, WS_TOP_X } from '../../../../src/aircraft/citation-m2/exterior';
import { GLARE, GLARE_PANEL, MAIN, TILT, EYE } from '../../../../src/aircraft/citation-m2/cockpit/layout';

/** Three.js cockpit-local (x right, y up, z aft) -> body (x fwd, y right, z down). */
function body(v: THREE.Vector3): [number, number, number] {
  return [-v.z, v.x, -v.y].map((n) => Math.round(n * 1000) / 1000) as [number, number, number];
}

describe('M2 layout probe', () => {
  it('reports positions', () => {
    const rig = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(rig.ctx);
    const root = ck.build.root as THREE.Object3D;
    root.updateMatrixWorld(true);
    const out: string[] = [];
    // Interior half-width at the glareshield brow and at the panel top (lining inset 0.045 m, shell.ts).
    for (const [x, z] of [
      [GLARE.browX, GLARE.browZ],
      [MAIN.center[0], MAIN.center[2] - MAIN.height / 2],
      [TILT.topX, TILT.topZ],
    ]) {
      out.push(`interior half-width at x ${x} z ${z}: ${M2_FUSELAGE.halfWidth(x, z, 0.045).toFixed(3)} m (glareshield half ${GLARE.width / 2}, main panel half ${MAIN.width / 2}, glare panel half ${GLARE_PANEL.width / 2})`);
    }
    out.push(`windshield base x ${WS_BASE_X} top x ${WS_TOP_X}; eye ${EYE.join(', ')}`);
    const want = ['m2.gmc', 'm2.esi', 'm2.dcu1', 'm2.dcu2', 'm2.tilt.l', 'm2.tilt.r', 'm2.gear', 'm2.gtc1', 'm2.gtc2', 'm2.elec', 'm2.knee.l', 'm2.cb_left', 'm2.cb_right', 'm2.quadrant', 'm2.ped_aft', 'm2.glare', 'm2.main'];
    root.traverse((o) => {
      const n = o.name.replace(/^panel:/, '');
      if (o.name.startsWith('panel:') && want.includes(n)) {
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        const box = new THREE.Box3().setFromObject(o);
        const s = new THREE.Vector3();
        box.getSize(s);
        out.push(`${n.padEnd(12)} centre body ${body(p).join(', ')}  bbox (x right/y up/z aft) ${s.toArray().map((v) => v.toFixed(3)).join(' x ')}`);
      }
      if (o.name === 'compass' || o.name === 'm2.eye_ref' || o.name === 'ice_detect_light' || o.name.startsWith('m2.compass')) {
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        out.push(`${o.name.padEnd(12)} body ${body(p).join(', ')}`);
      }
    });
    const ctl = ck.build.controls.map((c) => c.id);
    const count = (pre: string) => ctl.filter((id) => id.startsWith(pre)).length;
    out.push(`controls: total ${ctl.length}`);
    for (const id of ['m2.gmc.key.FD', 'm2.gmc.hdg', 'm2.gmc.crs1', 'm2.gmc.alt', 'm2.gmc.nose', 'm2.gmc.crs2', 'm2.engfire1', 'm2.bottle1', 'm2.rev.pfd1', 'm2.display_dim', 'm2.mw1', 'm2.mc1', 'm2.mw2', 'm2.mc2', 'm2.test_sel', 'm2.ign1', 'm2.rud_trim', 'm2.ail_trim', 'm2.park_brake', 'm2.gear_emer']) {
      const c = ck.build.controls.find((k) => k.id === id);
      if (!c) continue;
      const p = new THREE.Vector3();
      c.object.getWorldPosition(p);
      out.push(`${id.padEnd(16)} body ${body(p).join(', ')}`);
    }
    out.push(`tilt L ${count('m2.press') + count('m2.cabin_dump') + count('m2.pitot') + count('m2.eng_ai') + count('m2.wing_ai') + count('m2.tail') + count('m2.ws_') + count('m2.boost') + count('m2.fuel_xfer') + count('m2.temp') + count('m2.air_cond')} controls`);
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    expect(ctl.length).toBeGreaterThan(0);
  });
});
