/**
 * Round "jewel" indicator lamp: a small domed coloured lens in a round bezel, as the green STBY BATT TEST
 * lamp of the 172S NAV III (photographs Wikimedia Commons "Cessna 172SP G1000 01.jpg" / "02.jpg": a round
 * green lens in a round bezel to the right of the STBY BATT switch, "TEST" printed beside it).
 *
 * The lens glows while `var` is non-zero (scaled by the cockpit annunciator dim level and lamp test, like
 * the shared AnnunciatorLight); hovering shows ON / OFF. It is an indicator only (no pilot input).
 */
import * as THREE from 'three';
import type { CockpitEnv } from '../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../cockpit/controls';
import { cylinderZ } from '../../../cockpit/geometry/primitives';

export interface JewelLampOptions extends ControlOptions {
  /** Lamp var: lit while non-zero. */
  var: string;
  color: 'green' | 'amber' | 'red' | 'white';
  /** Lens diameter (m). */
  diameter: number;
}

export class JewelLamp extends ControlBase {
  readonly lampVar: string;
  private readonly lens: THREE.MeshStandardMaterial;
  private level = 0;
  private lit = false;

  constructor(env: CockpitEnv, o: JewelLampOptions) {
    super(env, o);
    this.lampVar = o.var;
    const d = o.diameter;
    // Chrome bezel ring standing 2 mm proud of the panel, the domed lens inside it.
    this.mesh(this.geo(`c172g.jewel.bezel.${d}`, () => {
      const s = new THREE.Shape();
      s.absarc(0, 0, d * 0.78, 0, Math.PI * 2, false);
      const h = new THREE.Path();
      h.absarc(0, 0, d * 0.5, 0, Math.PI * 2, true);
      s.holes.push(h);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 24 });
      return g;
    }), 'chrome', this.object, true);
    this.mesh(this.geo(`c172g.jewel.well.${d}`, () => cylinderZ(d * 0.5, d * 0.5, 0, 0.0008, 20)), 'panelDark', this.object, true);
    this.lens = this.own(env.materials.lens(o.color, null, 0.35));
    const dome = this.mesh(this.geo(`c172g.jewel.dome.${d}`, () => {
      const g = new THREE.SphereGeometry(d * 0.5, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      g.rotateX(Math.PI / 2);
      g.scale(1, 1, 0.6);
      return g;
    }), this.lens, this.object);
    dome.position.z = 0.0012;
    this.addHitBox(d * 1.6, d * 1.6, 0.005, 0, 0, 0.002);
  }

  protected stateText(): string {
    return this.lit ? 'ON' : 'OFF';
  }

  override update(dt: number): void {
    const L = this.env.lighting;
    this.lit = this.env.vars.get(this.lampVar) !== 0;
    const target = (L.lampTest() || this.lit ? 1.4 : 0) * L.annunciatorLevel();
    this.level += (target - this.level) * Math.min(1, dt / 0.025);
    this.lens.emissiveIntensity = this.level;
  }
}
