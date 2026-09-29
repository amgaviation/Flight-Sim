/**
 * Wet magnetic compass (whiskey compass) with realistic errors, as a 3D
 * cockpit object: black housing, window with lubber line, a drum card seen
 * edge-on that swings and tilts in its liquid, internal light, and the
 * compass correction ("FOR / STEER") card below.
 *
 * Card physics: models/compass.ts (pendulous card aligning with the Earth
 * field in its own tilted plane -> northerly turning error, acceleration
 * error ANDS, card oscillation; deviation card; extra deviation input for
 * electrical loads — 172S POH §3: "with the alternator side of the master
 * switch off, compass deviations of as much as 25 deg may occur").
 * Magnetic dip from the WMM2025 model (core/wmm.ts) at the aircraft
 * position, refreshed every 5 s.
 *
 * Drum orientation: the pilot sees the side of the card nearest to him;
 * the card is fixed in space, so its labels run the "wrong" way (E appears
 * to the LEFT of N when heading north) exactly like the real instrument.
 *
 * Inputs are physical (PHYSICAL_INPUTS: magnetic heading, attitude,
 * specific force, position — see vars.ts); `extraDeviationVar` (default
 * ac.compass.extra_dev_deg) is written by the aircraft.
 */
import * as THREE from 'three';
import type { CockpitControl } from '../../../cockpit/types';
import type { SimVars } from '../../../core/SimVars';
import { DEG2RAD, wrap360 } from '../../../core/math';
import { decimalYear, magneticInclination } from '../../../core/wmm';
import { createDisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { FONT_STACKS } from '../../common/fonts';
import { rectBezelGeometry, roundedRectShape } from '../geometry';
import { CompassModel, type CompassOptions } from '../models/compass';
import { ANALOG_VARS, PHYSICAL_INPUTS } from '../vars';

export interface MagneticCompassOptions {
  id: string;
  vars: SimVars;
  compass?: CompassOptions;
  lightVar?: string;
  extraDeviationVar?: string;
  /** Housing width (m). EST 0.075 (typical panel/windshield-mount compass). */
  width?: number;
  /** Show the correction card below the housing. Default true. */
  correctionCard?: boolean;
  /** Decimal year for the WMM (default: now). */
  year?: number;
  /**
   * Material for the housing body and front plate (default: the built-in near-black plastic).
   * Appended: lets an aircraft use its cockpit-lit plastic (not disposed by the compass).
   */
  housingMaterial?: THREE.Material;
}

export class MagneticCompass implements CockpitControl {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  readonly model: CompassModel;
  private readonly vars: SimVars;
  private readonly o: MagneticCompassOptions;
  private readonly drum: THREE.Mesh;
  private readonly gimbal = new THREE.Group();
  private readonly lit: THREE.MeshStandardMaterial[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly year: number;
  private dip = 60;
  private dipTimer = 0;
  private light = -1;

  constructor(o: MagneticCompassOptions) {
    this.id = o.id;
    this.vars = o.vars;
    this.o = o;
    this.model = new CompassModel(o.compass);
    this.year = o.year ?? decimalYear(new Date());
    const W = o.width ?? 0.075;
    const H = W * 0.78;
    const D = W * 0.8;
    // Housing body: a shell with the window opening; a dark back wall closes the bowl.
    const winW = W * 0.62;
    const winH = H * 0.42;
    const bodyShape = roundedRectShape(W, H, W * 0.12);
    const opening = new THREE.Path();
    opening.moveTo(-winW / 2, H * 0.06 - winH / 2);
    opening.lineTo(winW / 2, H * 0.06 - winH / 2);
    opening.lineTo(winW / 2, H * 0.06 + winH / 2);
    opening.lineTo(-winW / 2, H * 0.06 + winH / 2);
    opening.closePath();
    bodyShape.holes.push(opening);
    const housingMat = o.housingMaterial ?? this.track(new THREE.MeshStandardMaterial({ color: '#131314', roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }));
    const body = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(bodyShape, { depth: D, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 3 })), housingMat);
    body.position.z = -D;
    this.object.add(body);
    const back = new THREE.Mesh(this.track(new THREE.PlaneGeometry(W * 0.9, H * 0.9)), this.track(new THREE.MeshStandardMaterial({ color: '#070707', roughness: 1 })));
    back.position.z = -D * 0.9;
    this.object.add(back);
    // Front plate with the window.
    const plate = new THREE.Mesh(this.track(rectBezelGeometry(W * 0.98, H * 0.98, winW, winH, H * 0.06, 0.0035, 0.002)), o.housingMaterial ?? this.track(new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.45, metalness: 0.15 })));
    this.object.add(plate);
    // Card drum inside a gimbal (tilts with the card).
    const r = W * 0.3;
    const canvas = this.paintCard();
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const cardMat = this.track(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffe2b0', emissiveIntensity: 0, roughness: 0.7 }));
    this.lit.push(cardMat);
    this.drum = new THREE.Mesh(this.track(new THREE.CylinderGeometry(r, r, winH * 1.05, 96, 1, true)), cardMat);
    this.gimbal.add(this.drum);
    this.gimbal.position.set(0, H * 0.06, -r - 0.002);
    this.object.add(this.gimbal);
    // Liquid tint and glass.
    const glass = new THREE.Mesh(this.track(new THREE.PlaneGeometry(winW, winH)), this.track(new THREE.MeshPhysicalMaterial({ color: '#b8b09a', transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1, depthWrite: false })));
    glass.position.set(0, H * 0.06, 0.0008);
    glass.renderOrder = 10;
    this.object.add(glass);
    // Lubber line (vertical wire just behind the glass).
    const lubMat = this.track(new THREE.MeshStandardMaterial({ color: '#f07a1a', emissive: '#f07a1a', emissiveIntensity: 0, roughness: 0.5 }));
    this.lit.push(lubMat);
    const lubber = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.0009, winH * 0.95, 0.0006)), lubMat);
    lubber.position.set(0, H * 0.06, -0.0015);
    this.object.add(lubber);
    if (o.correctionCard ?? true) this.addCorrectionCard(W, H);
  }

  /** Current card reading at the lubber line (deg). */
  get reading(): number {
    return this.model.reading;
  }

  tooltip(): string {
    return `Magnetic compass: ${Math.round(wrap360(this.model.reading))}°`;
  }

  update(dt: number): void {
    const v = this.vars;
    const P = PHYSICAL_INPUTS;
    this.dipTimer -= dt;
    if (this.dipTimer <= 0) {
      this.dipTimer = 5;
      const lat = v.get(P.lat);
      const lon = v.get(P.lon);
      const altM = v.get(P.altMsl) * 0.3048;
      const i = magneticInclination(lat, lon, altM, this.year);
      if (Number.isFinite(i)) this.dip = i;
    }
    this.model.update(
      v.get(P.headingMag),
      v.get(P.pitch),
      v.get(P.bank),
      v.get(P.nx),
      v.get(P.ny),
      v.get(P.nz, 1),
      this.dip,
      v.get(this.o.extraDeviationVar ?? ANALOG_VARS.compassExtraDeviation),
      dt,
    );
    this.drum.rotation.y = this.model.reading * DEG2RAD;
    // Card tilt relative to the case (rendered on the gimbal).
    // +tiltPitch = forward edge of the card up (rotation about +x raises the far side);
    // +tiltRoll = right edge up (rotation about +z, which points at the pilot).
    this.gimbal.rotation.x = this.model.tiltPitchDeg * DEG2RAD;
    this.gimbal.rotation.z = this.model.tiltRollDeg * DEG2RAD;
    const l = Math.max(0, Math.min(1, v.get(this.o.lightVar ?? ANALOG_VARS.instrumentLight, 0)));
    if (l !== this.light) {
      this.light = l;
      for (const m of this.lit) m.emissiveIntensity = l * 0.8;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.object.removeFromParent();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /**
   * Card strip: headings DEcrease to the right along the texture (u), so that
   * with the drum fixed in space the pilot sees E to the left of N.
   */
  private paintCard(): HTMLCanvasElement | OffscreenCanvas {
    const Wc = 2048;
    const Hc = 160;
    const canvas = createDisplayCanvas(Wc, Hc);
    const c = canvas.getContext('2d') as Ctx2D;
    c.fillStyle = '#16171a';
    c.fillRect(0, 0, Wc, Hc);
    const xOf = (hdg: number): number => ((((-hdg / 360) % 1) + 1) % 1) * Wc;
    c.strokeStyle = '#f1f1ea';
    c.fillStyle = '#f1f1ea';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Everything is drawn three times (x - W, x, x + W) so marks at the seam wrap around.
    for (let h = 0; h < 360; h += 5) {
      const len = h % 10 === 0 ? Hc * 0.3 : Hc * 0.18;
      c.lineWidth = h % 10 === 0 ? 4 : 2.5;
      for (let k = -1; k <= 1; k++) {
        const x = xOf(h) + k * Wc;
        c.beginPath();
        c.moveTo(x, Hc * 0.05);
        c.lineTo(x, Hc * 0.05 + len);
        c.stroke();
      }
    }
    c.font = `bold ${Math.round(Hc * 0.42)}px ${FONT_STACKS.gauge}`;
    for (let h = 0; h < 360; h += 30) {
      const lbl = h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : String(h / 10);
      for (let k = -1; k <= 1; k++) c.fillText(lbl, xOf(h) + k * Wc, Hc * 0.7);
    }
    return canvas;
  }

  private addCorrectionCard(W: number, H: number): void {
    const Wc = 512;
    const Hc = 160;
    const canvas = createDisplayCanvas(Wc, Hc);
    const c = canvas.getContext('2d') as Ctx2D;
    c.fillStyle = '#f3f1e8';
    c.fillRect(0, 0, Wc, Hc);
    c.fillStyle = '#111111';
    c.font = `bold 20px ${FONT_STACKS.gauge}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const cols = 6;
    const cw = (Wc - 70) / cols;
    const rowY = [Hc * 0.18, Hc * 0.38, Hc * 0.64, Hc * 0.84];
    c.fillText('FOR', 32, rowY[0]);
    c.fillText('STEER', 32, rowY[1]);
    c.fillText('FOR', 32, rowY[2]);
    c.fillText('STEER', 32, rowY[3]);
    for (let i = 0; i < 12; i++) {
      const hdg = i * 30;
      const lbl = hdg === 0 ? 'N' : hdg === 90 ? 'E' : hdg === 180 ? 'S' : hdg === 270 ? 'W' : String(hdg);
      const steer = Math.round(wrap360(hdg + this.model.deviationAt(hdg)));
      const col = i % cols;
      const row = i < cols ? 0 : 2;
      const x = 70 + cw * (col + 0.5);
      c.fillText(lbl, x, rowY[row]);
      c.fillText(String(steer === 0 ? 360 : steer), x, rowY[row + 1]);
    }
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    const card = new THREE.Mesh(this.track(new THREE.PlaneGeometry(W * 0.9, W * 0.9 * (Hc / Wc))), mat);
    card.position.set(0, -H / 2 - (W * 0.9 * (Hc / Wc)) / 2 - 0.003, 0.001);
    this.object.add(card);
  }
}
