/**
 * Global 6000 layout-lens fix round 3: regression tests for the functional
 * side of the layout fixes (gaps G6K-L3-01, -04, -05, -17). Pure geometry /
 * finish fixes (drum grips, yoke shape, tan shade, overhead paint) are
 * verified by screenshots, not here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { Win } from '../../../../src/avionics/collins-fusion/vars';
import { makeRig } from '../helpers';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';

describe('Global 6000 fix round 3 (layout lens)', () => {
  it('G6K-L3-04: AFD 3 defaults to the FMS window beside a map, not two FMS text windows', () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const suite = r.sys.suite!;
    expect(suite.layout.selected(3, 'L')).toBe(Win.Fms);
    expect(suite.layout.selected(3, 'R')).toBe(Win.Map);
  });

  it('G6K-L3-05 / -01: GND LIFT DUMPING sits on the quadrant forward strip; MKP key caps are black', () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const ck = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
    const gld = ck.build.controls.find((c) => c.id === 'g6k.ped.gld');
    expect(gld).toBeTruthy();
    // The switch was moved from the EST aft plate onto the photographed quadrant strip (photo e_ped_mid).
    let p: THREE.Object3D | null = gld!.object;
    const chain: string[] = [];
    while (p) {
      if (p.name) chain.push(p.name);
      p = p.parent;
    }
    expect(chain.join('|')).toContain('quadrant');
    expect(chain.join('|')).not.toContain('aft_controls');
    // MKP key caps: black with white legends (photo c_ped). The KeyPad builds each key cap from the
    // 'plasticBlack' material (visionHardware.ts keyMaterial).
    const mkp = ck.build.controls.find((c) => c.id === 'fusion.mkp1.keys');
    expect(mkp).toBeTruthy();
    const black = ck.context.env.materials.get('plasticBlack');
    let blackCaps = 0;
    mkp!.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === black) blackCaps++;
    });
    expect(blackCaps).toBeGreaterThan(50); // one cap per key
    ck.build.dispose?.();
  });

  it('G6K-L3-17: index.html ships an inline favicon (no /favicon.ico 404 in headless runs)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="icon"');
  });
});
