/**
 * LAYOUT fidelity probe (read-only audit helper, no assertions on the aircraft): builds the full G650 cockpit
 * headless and prints the body-frame positions (x fwd, y right, z down, metres) of the controls and displays
 * that the layout audit compares against G650 / G650ER photographs. Run with:
 *   npx vitest run tests/aircraft/g650/fidelity/layout-probe.test.ts
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { cockpitRig } from '../cockpit-main/rig';

function body(o: THREE.Object3D): [number, number, number] {
  const w = new THREE.Vector3();
  o.getWorldPosition(w);
  // cockpit-local -> body: local.x = body.y, local.y = -body.z, local.z = -body.x (src/cockpit/frame.ts)
  return [+(-w.z).toFixed(3), +w.x.toFixed(3), +(-w.y).toFixed(3)];
}

describe('G650 layout probe', () => {
  it('prints positions of audited items', async () => {
    const { ck } = await cockpitRig('ready_to_taxi', false);
    const root = ck.build.root;
    root.updateMatrixWorld(true);
    const out: string[] = [];
    // Displays (named 'display:<id>').
    root.traverse((o) => {
      if (o.name.startsWith('display:')) out.push(`${o.name.padEnd(34)} ${JSON.stringify(body(o))}`);
    });
    const ids = [
      'g650.gs.mw_l',
      'g650.gs.mc_l',
      'g650.gs.du_brt_l',
      'g650.lc.fire_l',
      'g650.lc.autobrake',
      'g650.lc.irs1',
      'g650.lc.gear',
      'g650.lc.gear_lt_n',
      'g650.lc.nws',
      'epic.cas.scroll',
      'g650.lc.gear_emer',
      'g650.ped.park_brake',
      'g650.ped.rat',
      'g650.ped.fuel_ctl1',
      'g650.fc.tiller',
      'g650.oh.lt.master',
      'g650.oh.ice.wing_l',
      'g650.oh.oxy.pax',
      'g650.oh.lt.nav',
      'epic.mfdsw1',
    ];
    const controls = (ck.build as unknown as { controls?: { id: string; object: THREE.Object3D }[] }).controls ?? [];
    const byId = new Map(controls.map((c) => [c.id, c]));
    for (const id of ids) {
      const c = byId.get(id);
      out.push(`${id.padEnd(34)} ${c ? JSON.stringify(body(c.object)) : 'MISSING'}`);
    }
    // Gear lamp legend text (empty legend = nothing drawn in the lens emissive map).
    const lamp = byId.get('g650.lc.gear_lt_n') as unknown as AnnunciatorLight | undefined;
    out.push(`gear lamp class ${lamp?.constructor.name ?? 'none'}`);
    out.push(`controls total ${controls.length}`);
    console.log(out.join('\n'));
    expect(controls.length).toBeGreaterThan(0);
  }, 120_000);
});
