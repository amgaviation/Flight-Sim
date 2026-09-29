/**
 * Placards: static text on a panel (not a control; no interaction).
 *
 * Styles:
 *  - 'engraved': backlit engraved panel text (lighting zone 'panel').
 *  - 'printed': unlit printed text directly on the surface.
 *  - 'plate': text on a small riveted backing plate (limitation placards).
 *  - 'warning': red plate with white text (e.g. 'NO SMOKING', emergency).
 *  - 'caution': yellow plate with black text.
 *  - 'inverse': white/cream plate with black text (data plates, checklists).
 */
import * as THREE from 'three';
import type { CockpitEnv } from '../env';
import type { TextStyle } from '../labels';
import { plateGeometry } from '../geometry/structure';

export type PlacardStyle = 'engraved' | 'printed' | 'plate' | 'warning' | 'caution' | 'inverse';

export interface PlacardOptions {
  text: string;
  /** Capital-letter height (m). Default 0.0028. */
  height?: number;
  style?: PlacardStyle;
  align?: 'center' | 'left' | 'right';
  /** Plate padding (m) for plate styles. Default 0.6 x text height. */
  padding?: number;
  /** Override text colour / plate colour. */
  color?: THREE.ColorRepresentation;
  plateColor?: THREE.ColorRepresentation;
  zone?: string | null;
  font?: string;
  weight?: TextStyle['weight'];
  /** Engraved outline box around the text (engraved/printed styles), line width in em. */
  box?: number;
}

export class Placard extends THREE.Group {
  /** Overall size (m). */
  readonly width: number;
  readonly heightM: number;

  constructor(env: CockpitEnv, o: PlacardOptions) {
    super();
    const style = o.style ?? 'engraved';
    const th = o.height ?? 0.0028;
    const plated = style === 'plate' || style === 'warning' || style === 'caution' || style === 'inverse';
    const textColor =
      o.color ?? (style === 'warning' ? '#f4f4f0' : style === 'caution' || style === 'inverse' ? '#141414' : style === 'plate' ? '#ecece6' : undefined);
    const zone = o.zone !== undefined ? o.zone : style === 'engraved' ? 'panel' : null;
    const label = env.labels.text(o.text, { height: th, color: textColor, zone, align: o.align, font: o.font, weight: o.weight ?? 700, box: o.box });
    this.add(label);
    this.name = `placard:${o.text}`;
    this.userData.cockpitStatic = true;
    this.width = label.userData.width_m;
    this.heightM = label.userData.height_m;
    if (plated) {
      const pad = o.padding ?? th * 0.6;
      const w = label.userData.width_m + pad * 2;
      const h = label.userData.height_m + pad * 2;
      const plateColor = o.plateColor ?? (style === 'warning' ? '#b3140e' : style === 'caution' ? '#e4bd00' : style === 'inverse' ? '#ecebe3' : '#1d1e20');
      const mat = env.materials.custom('paint', plateColor, 0.5);
      const plate = new THREE.Mesh(env.geometry.get(`placard.plate.${w.toFixed(5)}.${h.toFixed(5)}`, () => plateGeometry(w, h, 0.0008, Math.min(w, h) * 0.12)), mat);
      plate.userData.cockpitStatic = true;
      const ox = o.align === 'left' ? w / 2 - pad : o.align === 'right' ? -(w / 2 - pad) : 0;
      plate.position.x = ox;
      this.add(plate);
      label.position.z = 0.00095;
      this.width = w;
      this.heightM = h;
    }
  }
}
