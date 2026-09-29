/**
 * Fix round 2 (G650-L11 / L06 / N01): MCDU / keypad key legends are backlit at
 * night through the 'panel' zone even after the build instanced them; the CB
 * plates carry the extended load list with no large blank fields; the HUD
 * combiner is stowed by default.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { cockpitRig } from '../cockpit-main/rig';
import type { G650Cockpit } from '../../../../src/aircraft/g650/cockpit';
import type { Rig } from '../helpers';

let r: Rig;
let ck: G650Cockpit;

beforeAll(async () => {
  ({ r, ck } = await cockpitRig('ready_to_taxi', false));
}, 300_000);

describe('G650 fix round 2', () => {
  it('L11: instanced key legends (MCDU keyboards) follow the panel backlight zone', () => {
    const lighting = ck.build.env.lighting;
    // The build replaced the per-key legend meshes by instanced label batches.
    // Zoned label batches only: the CB rating legends are painted (zone null, material key '|-|') on purpose.
    const batches: THREE.InstancedMesh[] = [];
    ck.build.root.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.startsWith('moving-inst:cockpit.label') && o.name.includes('|panel|')) batches.push(o as THREE.InstancedMesh);
    });
    expect(batches.length).toBeGreaterThan(0);
    // The MCDU / SMC key legend colour (KeyPad default #f2f2ee) is among them.
    expect(batches.some((b) => b.name.includes('f2f2ee'))).toBe(true);
    // Every legend batch material is registered on a backlight zone...
    for (const b of batches) {
      const z = lighting.zoneOf(b.material as THREE.Material);
      expect(z, b.name).not.toBeNull();
      expect(z!.zone).toBe('panel');
      // Key legends (KeyPad colour f2f2ee) at the raised gain so they read at night (cockpit/index.ts).
      if (b.name.includes('f2f2ee')) expect(z!.gain, b.name).toBe(2);
    }
    // ...and lights up with the PANEL dimmer (MASTER CONTROL night range: backlighting on).
    r.vars.set('ac.light.panel', 0);
    lighting.update(0.1);
    const m0 = batches.map((b) => (b.material as THREE.MeshStandardMaterial).emissiveIntensity);
    expect(Math.max(...m0)).toBe(0);
    r.vars.set('ac.light.panel', 0.6);
    r.vars.set('env.ambient_light', 0.1); // night: no daylight wash-out
    lighting.update(0.1);
    for (const b of batches) expect((b.material as THREE.MeshStandardMaterial).emissiveIntensity, b.name).toBeGreaterThan(1);
  });

  it('L06: every CB of the extended load list is built and the plates have no blank lower field', () => {
    const cbs = ck.build.controls.filter((c) => c.id.startsWith('g650.cb.'));
    // Round 2 extends the modelled network by 31 loads (HUD, CVR/FDR, clocks, trim actuators, EECs,
    // fuel quantity, HF/DME/SATCOM/printer/CMC, GCUs, CPC 2, temp control, equipment cooling, wing
    // anti-ice valves, cabin / vestibule lights): 129 breakers in all.
    expect(cbs.length).toBe(129);
    // New breakers cut their loads: cb.hud kills the HUD supply.
    r.run(2);
    expect(r.vars.get('elec.hud_powered')).toBe(1);
    r.vars.set('cb.hud', 0);
    r.run(1);
    expect(r.vars.get('elec.hud_powered')).toBe(0);
    r.vars.set('cb.hud', 1);
    // VEST LTS breaker feeds the vestibule lights.
    r.run(1);
    expect(r.vars.get('ac.light.vestibule')).toBe(1);
    r.vars.set('cb.vest_lts', 0);
    r.run(1);
    expect(r.vars.get('ac.light.vestibule')).toBe(0);
    r.vars.set('cb.vest_lts', 1);
  });

  it('N01: HUD combiner stowed on the ramp (epic.hud.on = 0), pivot rotated toward the headliner', () => {
    expect(r.vars.get('epic.hud.on')).toBe(0);
    // Drive the display-side update so the deploy state settles.
    for (let i = 0; i < 120; i++) ck.build.update?.(1 / 30);
    const pivot = ck.build.root.getObjectByName('hud_pivot')!;
    expect(pivot).toBeTruthy();
    expect(pivot.rotation.x).toBeGreaterThan((70 * Math.PI) / 180);
  });
});
