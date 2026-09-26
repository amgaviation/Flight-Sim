/**
 * Vacuum-driven attitude indicator (artificial horizon).
 *
 * Cessna 172S POH Rev 4 §7 "Attitude Indicator": vacuum air-driven gyro;
 * bank shown by a pointer at the top relative to a bank scale with index
 * marks at 10, 20, 30, 60 and 90 deg either side; pitch and roll shown by a
 * miniature airplane over a symbolic horizon (blue sky / ground) divided by
 * a white horizon bar with pitch reference lines; a knob at the bottom
 * adjusts the miniature airplane.
 *
 * Construction (parallax): a large horizon card translates with pitch
 * inside a roll ring; card and ring rotate together with bank; the fixed
 * bank pointer and the miniature airplane sit in front. `bankScale: 'dial'`
 * (default) paints the bank marks on the rolling ring with a fixed pointer
 * at the top; 'case' paints them on a fixed mask with the pointer on the
 * rolling card ("sky pointer").
 *
 * Gyro physics: models/gyro.ts AttitudeGyro (spin-up from suction, erection
 * to the apparent vertical with turn/acceleration errors, drift, tumbling
 * beyond 65 deg pitch / 105 deg bank, sag to a rest attitude when the rotor
 * stops). Inputs: attitude and specific force are physical inputs
 * (PHYSICAL_INPUTS, see vars.ts), suction from `suctionVar`.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { AnalogGauge, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_WHITE, type FaceCanvas } from '../face';
import { AttitudeGyro, vacuumRotorDrive, type AttitudeGyroOptions } from '../models/gyro';
import { ANALOG_VARS, PHYSICAL_INPUTS } from '../vars';

export interface AnalogAttitudeOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  suctionVar?: string;
  /** Adjust-knob var (-1..1 miniature airplane offset). */
  symbolVar?: string;
  bankScale?: 'dial' | 'case';
  gyro?: AttitudeGyroOptions;
  /** Pitch sensitivity: dial radii per degree. EST 0.021 (10 deg = 0.21 R). */
  pitchScale?: number;
  /** Card travel limit (deg). EST 25. */
  maxPitchDeg?: number;
  /** Input overrides (defaults: PHYSICAL_INPUTS). */
  pitchVar?: string;
  bankVar?: string;
  nxVar?: string;
  nyVar?: string;
  nzVar?: string;
}

const SKY = '#2f6fb8';
const GROUND = '#3b2a1c';
const SYMBOL = '#f28c1c';
const WINDOW_R = 0.74;

export class AnalogAttitudeIndicator extends AnalogGauge {
  readonly gyro: AttitudeGyro;
  private readonly rollGroup = new THREE.Group();
  /** Horizon card texture: the card is larger than the window; pitch scrolls the texture (UV offset). */
  private readonly cardTex: THREE.CanvasTexture<ReturnType<AnalogGauge['face']>['canvas']>;
  private readonly cardRepeat: number;
  private readonly symbol = new THREE.Group();
  private readonly o: AnalogAttitudeOptions;
  private readonly pitchScale: number;
  private readonly maxPitch: number;
  private readonly cardR: number;

  constructor(o: AnalogAttitudeOptions) {
    super({ name: 'Attitude indicator', ...o });
    this.o = o;
    this.pitchScale = o.pitchScale ?? 0.021;
    this.maxPitch = o.maxPitchDeg ?? 25;
    this.gyro = new AttitudeGyro(o.gyro);
    const R = this.dialR;
    this.cardR = (WINDOW_R + this.maxPitch * this.pitchScale + 0.05) * R;
    this.object.add(this.rollGroup);
    this.rollGroup.position.z = 0;
    // Horizon card: a disc filling the window whose texture shows a larger card; pitch
    // slides the texture (so the card never shows outside the window), bank rolls the disc.
    const cf = this.face(1024);
    this.paintCard(cf);
    const cardMesh = this.addDial(cf, 0, WINDOW_R * R * 1.005, this.rollGroup);
    const mat = cardMesh.material as THREE.MeshStandardMaterial;
    this.cardTex = mat.map as THREE.CanvasTexture<ReturnType<AnalogGauge['face']>['canvas']>;
    this.cardRepeat = (WINDOW_R * R * 1.005) / this.cardR;
    this.cardTex.repeat.set(this.cardRepeat, this.cardRepeat);
    this.cardTex.offset.set(0.5 - this.cardRepeat / 2, 0.5 - this.cardRepeat / 2);
    // Roll ring in front of the card.
    const rf = this.face();
    this.paintRing(rf, (o.bankScale ?? 'dial') === 'dial');
    this.addDial(rf, 0.0008, R, this.rollGroup, true);
    if ((o.bankScale ?? 'dial') === 'case') {
      // Fixed mask ring with the scale; sky pointer on the rolling ring.
      const mf = this.face();
      this.paintMask(mf);
      this.addDial(mf, 0.0016, R, this.object, true);
      this.addTriangle(this.rollGroup, 0.0012, 0.69, true);
    } else {
      this.addTriangle(this.object, 0.0016, 0.97, false);
    }
    this.buildSymbol();
    this.addKnob({
      name: 'ADJ',
      x: 0,
      y: -this.size * 0.42,
      onTurn: (steps) => {
        const v = this.vars.get(this.symbolVar, 0) + steps * 0.05;
        this.vars.set(this.symbolVar, clamp(v, -1, 1));
      },
    });
  }

  private get symbolVar(): string {
    return this.o.symbolVar ?? ANALOG_VARS.aiSymbolOffset;
  }

  /** State presets: erected gyro at rated speed (in flight / engines running). */
  setSpunUp(): void {
    this.gyro.setSpunUp(this.vars.get(this.o.pitchVar ?? PHYSICAL_INPUTS.pitch), this.vars.get(this.o.bankVar ?? PHYSICAL_INPUTS.bank));
  }

  /** State presets: cold gyro at rest (cold & dark). */
  setStopped(): void {
    this.gyro.setStopped(this.vars.get(this.o.pitchVar ?? PHYSICAL_INPUTS.pitch), this.vars.get(this.o.bankVar ?? PHYSICAL_INPUTS.bank));
  }

  protected updateGauge(dt: number): void {
    const o = this.o;
    const v = this.vars;
    const suction = v.get(o.suctionVar ?? ANALOG_VARS.suction, 0);
    this.gyro.update(
      v.get(o.pitchVar ?? PHYSICAL_INPUTS.pitch),
      v.get(o.bankVar ?? PHYSICAL_INPUTS.bank),
      v.get(o.nxVar ?? PHYSICAL_INPUTS.nx),
      v.get(o.nyVar ?? PHYSICAL_INPUTS.ny),
      v.get(o.nzVar ?? PHYSICAL_INPUTS.nz, 1),
      vacuumRotorDrive(suction),
      dt,
    );
    AnalogGauge.setAngle(this.rollGroup, -this.gyro.bank);
    // Nose up: the card moves down, i.e. the window samples higher on the card (larger v).
    const p = clamp(this.gyro.pitch, -this.maxPitch, this.maxPitch);
    const d = p * this.pitchScale * this.dialR;
    this.cardTex.offset.y = 0.5 - this.cardRepeat / 2 + d / (2 * this.cardR);
    this.symbol.position.y = v.get(this.symbolVar, 0) * 0.1 * this.dialR;
  }

  tooltip(): string {
    const g = this.gyro;
    return `Attitude: pitch ${g.pitch.toFixed(0)}°, bank ${g.bank.toFixed(0)}°${g.rotor.speed < 0.9 ? ' (gyro slow)' : ''}`;
  }

  // ---------------------------------------------------------------- painting

  private paintCard(f: FaceCanvas): void {
    const scale = this.cardR / this.dialR; // card radius in dial radii
    const c = f.ctx;
    const deg = (d: number): number => (-d * this.pitchScale) / scale; // normalised card y of a pitch line
    c.fillStyle = SKY;
    c.fillRect(0, 0, f.size, f.r);
    c.fillStyle = GROUND;
    c.fillRect(0, f.r, f.size, f.r);
    // Horizon bar.
    const hw = 0.9 / scale;
    c.fillStyle = DIAL_WHITE;
    c.fillRect(f.X(-hw), f.Y(0.012 / scale), 2 * hw * f.r, (0.024 / scale) * f.r);
    // Pitch lines (5 deg short, 10 deg long), numbers at 10/20.
    for (const p of [5, 10, 15, 20]) {
      for (const sgn of [1, -1]) {
        const y = -deg(sgn * p);
        const half = (p % 10 === 0 ? 0.26 : 0.13) / scale;
        c.fillRect(f.X(-half), f.Y(y) - 1.5, 2 * half * f.r, 3);
        if (p % 10 === 0) {
          f.text(String(p), -half - 0.07 / scale, y, 0.06 / scale, DIAL_WHITE);
          f.text(String(p), half + 0.07 / scale, y, 0.06 / scale, DIAL_WHITE);
        }
      }
    }
    // Perspective lines on the ground half (30/60 deg from vertical).
    c.strokeStyle = DIAL_WHITE;
    c.lineWidth = 3;
    c.beginPath();
    for (const a of [-60, -30, 0, 30, 60]) {
      const r = (Math.PI * a) / 180;
      c.moveTo(f.X(0), f.Y(-0.02 / scale));
      c.lineTo(f.X(Math.sin(r) * 1), f.Y(-Math.cos(r) * 1));
    }
    c.stroke();
    // Cover the centre of the perspective lines above the pitch ladder area.
    c.fillStyle = GROUND;
    c.fillRect(f.X(-0.3 / scale), f.Y(-0.03 / scale), (0.6 / scale) * f.r, (0.42 / scale) * f.r);
    for (const p of [5, 10, 15, 20]) {
      const y = -deg(-p);
      const half = (p % 10 === 0 ? 0.26 : 0.13) / scale;
      c.fillStyle = DIAL_WHITE;
      c.fillRect(f.X(-half), f.Y(y) - 1.5, 2 * half * f.r, 3);
    }
  }

  private paintRing(f: FaceCanvas, marks: boolean): void {
    const c = f.ctx;
    c.fillStyle = SKY;
    c.fillRect(0, 0, f.size, f.r);
    c.fillStyle = GROUND;
    c.fillRect(0, f.r, f.size, f.r);
    f.circleWindow(0, 0, WINDOW_R);
    if (marks) this.paintBankMarks(f);
  }

  private paintMask(f: FaceCanvas): void {
    f.background('#151515');
    f.circleWindow(0, 0, WINDOW_R);
    this.paintBankMarks(f);
  }

  /** Bank index marks at 10, 20, 30, 60, 90 deg each side (POH §7). */
  private paintBankMarks(f: FaceCanvas): void {
    for (const a of [10, 20]) for (const s of [-1, 1]) f.tick(s * a, 0.84, 0.95, 0.018);
    for (const a of [30, 60, 90]) for (const s of [-1, 1]) f.tick(s * a, 0.78, 0.97, 0.03);
    f.tick(0, 0.8, 0.97, 0.008);
  }

  private addTriangle(parent: THREE.Object3D, z: number, rf: number, pointingUp: boolean): void {
    const R = this.dialR;
    const s = new THREE.Shape();
    const tip = rf * R;
    const h = 0.12 * R;
    const w = 0.06 * R;
    if (pointingUp) {
      s.moveTo(0, tip);
      s.lineTo(-w, tip - h);
      s.lineTo(w, tip - h);
    } else {
      s.moveTo(0, tip - h);
      s.lineTo(-w, tip);
      s.lineTo(w, tip);
    }
    s.closePath();
    const mat = this.track(new THREE.MeshStandardMaterial({ color: SYMBOL, roughness: 0.5, emissive: SYMBOL, emissiveIntensity: 0 }));
    this.litMaterials.push(mat);
    const mesh = new THREE.Mesh(this.track(new THREE.ShapeGeometry(s)), mat);
    mesh.position.z = z;
    parent.add(mesh);
  }

  private buildSymbol(): void {
    const R = this.dialR;
    const mat = this.track(new THREE.MeshStandardMaterial({ color: SYMBOL, roughness: 0.45, emissive: SYMBOL, emissiveIntensity: 0 }));
    this.litMaterials.push(mat);
    const shape = new THREE.Shape();
    const t = 0.035 * R;
    for (const sgn of [-1, 1]) {
      const w = new THREE.Shape();
      w.moveTo(sgn * 0.12 * R, -t / 2);
      w.lineTo(sgn * 0.55 * R, -t / 2);
      w.lineTo(sgn * 0.55 * R, t / 2);
      w.lineTo(sgn * 0.12 * R, t / 2);
      w.closePath();
      const m = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(w, { depth: 0.0008, bevelEnabled: false })), mat);
      this.symbol.add(m);
    }
    shape.absarc(0, 0, 0.04 * R, 0, Math.PI * 2, false);
    const dot = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(shape, { depth: 0.0008, bevelEnabled: false })), mat);
    this.symbol.add(dot);
    // Support post down to the bottom of the dial (EST 172 AI style).
    const post = new THREE.Shape();
    post.moveTo(-0.018 * R, -0.04 * R);
    post.lineTo(0.018 * R, -0.04 * R);
    post.lineTo(0.06 * R, -0.95 * R);
    post.lineTo(-0.06 * R, -0.95 * R);
    post.closePath();
    const pm = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(post, { depth: 0.0006, bevelEnabled: false })), mat);
    pm.position.z = -0.0003;
    this.symbol.add(pm);
    this.symbol.position.z = this.depth * 0.55;
    this.object.add(this.symbol);
  }
}
