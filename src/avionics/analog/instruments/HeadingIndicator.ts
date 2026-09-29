/**
 * Vacuum directional gyro (heading indicator) with heading bug.
 *
 * Cessna 172S POH Rev 4 §7 "Directional Indicator": vacuum air-driven gyro
 * displaying heading on a compass card against a fixed airplane image and
 * index; it precesses slightly over time, so the card is set to the
 * magnetic compass before takeoff and as required in flight; the knob on
 * the lower LEFT adjusts the card, the knob on the lower RIGHT moves the
 * heading bug.
 *
 * Gyro physics: models/gyro.ts DirectionalGyro (spin-up from suction,
 * friction precession and uncompensated earth-rate drift, card follows the
 * case when the rotor is slow, tumbling beyond the gimbal limits). The
 * adjust knob also clears a tumble (caging). Outputs: `headingOutVar`
 * (displayed heading, for autopilot heading-bug error) and the bug in
 * `bugVar` (default ap.sel_hdg_deg).
 * Knobs: left ADJ 1 deg/detent (Shift 0.25 deg); right HDG bug 1 deg/detent
 * (Shift 10 deg).
 */
import * as THREE from 'three';
import { wrap180, wrap360 } from '../../../core/math';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, type FaceCanvas } from '../face';
import { DirectionalGyro, vacuumRotorDrive, type DirectionalGyroOptions } from '../models/gyro';
import { ANALOG_VARS, PHYSICAL_INPUTS } from '../vars';

export interface HeadingIndicatorOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  suctionVar?: string;
  bugVar?: string;
  headingOutVar?: string;
  gyro?: DirectionalGyroOptions;
  headingVar?: string;
  pitchVar?: string;
  bankVar?: string;
  latVar?: string;
  /** Show the heading bug and its knob (172S with autopilot). Default true. */
  bug?: boolean;
}

const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
const ORANGE = '#f28c1c';

export class HeadingIndicator extends AnalogGauge {
  readonly gyro: DirectionalGyro;
  private readonly o: HeadingIndicatorOptions;
  private readonly card: ReturnType<AnalogGauge['addDial']>;
  private readonly bugPivot: THREE.Group | null = null;
  private readonly bugVar: string;
  private readonly outVar: string;

  constructor(o: HeadingIndicatorOptions) {
    const bug = o.bug ?? true;
    super({ name: 'Heading indicator', ...o, knobCorners: bug ? ['bl', 'br'] : ['bl'] });
    this.o = o;
    this.gyro = new DirectionalGyro(o.gyro);
    this.bugVar = o.bugVar ?? ANALOG_VARS.headingBug;
    this.outVar = o.headingOutVar ?? ANALOG_VARS.dgHeadingOut;
    const R = this.dialR;
    const cf = this.face();
    this.paintCard(cf);
    this.card = this.addDial(cf, 0);
    // Fixed mask: outer ring with 45-deg index marks and the lubber triangle; centre open.
    const mf = this.face();
    this.paintMask(mf);
    this.addDial(mf, 0.0012, R, this.object, true);
    this.buildAirplane();
    if (bug) {
      this.bugPivot = new THREE.Group();
      const s = new THREE.Shape();
      // Notched bug on the card rim, inside the mask window (0.86 R).
      s.moveTo(-0.07 * R, 0.855 * R);
      s.lineTo(-0.07 * R, 0.75 * R);
      s.lineTo(0.07 * R, 0.75 * R);
      s.lineTo(0.07 * R, 0.855 * R);
      s.lineTo(0.025 * R, 0.855 * R);
      s.lineTo(0, 0.8 * R);
      s.lineTo(-0.025 * R, 0.855 * R);
      s.closePath();
      const mat = this.track(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.5, emissive: ORANGE, emissiveIntensity: 0 }));
      this.litMaterials.push(mat);
      this.bugPivot.add(new THREE.Mesh(this.track(new THREE.ShapeGeometry(s)), mat));
      this.bugPivot.position.z = 0.0006;
      this.object.add(this.bugPivot);
      const kp = cornerKnobPosition(this.size, 'br');
      this.addKnob({
        name: 'HDG',
        x: kp.x,
        y: kp.y,
        onTurn: (steps, coarse) => this.vars.set(this.bugVar, wrap360(Math.round(this.vars.get(this.bugVar) + steps * (coarse ? 10 : 1)))),
      });
    }
    const ka = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'ADJ',
      x: ka.x,
      y: ka.y,
      onTurn: (steps, fine) => this.gyro.adjust(steps * (fine ? 0.25 : 1)),
    });
  }

  /** Displayed heading (deg). */
  get heading(): number {
    return this.gyro.heading;
  }

  /** Sets the card to `heading` with the gyro at speed (state presets). */
  setSpunUp(errorDeg = 0): void {
    this.gyro.setSpunUp(this.vars.get(this.o.headingVar ?? PHYSICAL_INPUTS.headingMag), errorDeg);
  }

  setStopped(): void {
    this.gyro.setStopped(this.vars.get(this.o.headingVar ?? PHYSICAL_INPUTS.headingMag));
  }

  protected updateGauge(dt: number): void {
    const o = this.o;
    const v = this.vars;
    this.gyro.update(
      v.get(o.headingVar ?? PHYSICAL_INPUTS.headingMag),
      v.get(o.pitchVar ?? PHYSICAL_INPUTS.pitch),
      v.get(o.bankVar ?? PHYSICAL_INPUTS.bank),
      v.get(o.latVar ?? PHYSICAL_INPUTS.lat),
      vacuumRotorDrive(v.get(o.suctionVar ?? ANALOG_VARS.suction, 0)),
      dt,
    );
    const h = this.gyro.heading;
    AnalogGauge.setAngle(this.card, -h);
    if (this.bugPivot) AnalogGauge.setAngle(this.bugPivot, wrap180(v.get(this.bugVar) - h));
    v.set(this.outVar, h);
  }

  tooltip(): string {
    const bug = this.bugPivot ? ` · bug ${Math.round(wrap360(this.vars.get(this.bugVar)))}°` : '';
    return `Heading indicator: ${Math.round(wrap360(this.gyro.heading))}°${bug}`;
  }

  private paintCard(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    for (let d = 0; d < 360; d += 5) f.tick(d, d % 10 === 0 ? 0.7 : 0.76, 0.84, d % 10 === 0 ? 0.02 : 0.012);
    for (let d = 0; d < 360; d += 30) {
      const txt = CARDINAL[d] ?? String(d / 10);
      f.label(txt, d, 0.58, d % 90 === 0 ? 0.17 : 0.14, DIAL_WHITE, true);
    }
  }

  private paintMask(f: FaceCanvas): void {
    f.background('#141414');
    f.circleWindow(0, 0, 0.86);
    for (let a = 45; a < 360; a += 45) f.tick(a, 0.87, 0.97, 0.02);
    f.poly([0, 0.87, -0.06, 0.98, 0.06, 0.98], DIAL_WHITE);
  }

  private buildAirplane(): void {
    const R = this.dialR;
    const s = new THREE.Shape();
    s.moveTo(0, 0.42 * R);
    s.lineTo(0.035 * R, 0.3 * R);
    s.lineTo(0.035 * R, 0.1 * R);
    s.lineTo(0.3 * R, -0.02 * R);
    s.lineTo(0.3 * R, -0.07 * R);
    s.lineTo(0.035 * R, -0.02 * R);
    s.lineTo(0.03 * R, -0.24 * R);
    s.lineTo(0.12 * R, -0.3 * R);
    s.lineTo(0.12 * R, -0.34 * R);
    s.lineTo(0, -0.31 * R);
    s.lineTo(-0.12 * R, -0.34 * R);
    s.lineTo(-0.12 * R, -0.3 * R);
    s.lineTo(-0.03 * R, -0.24 * R);
    s.lineTo(-0.035 * R, -0.02 * R);
    s.lineTo(-0.3 * R, -0.07 * R);
    s.lineTo(-0.3 * R, -0.02 * R);
    s.lineTo(-0.035 * R, 0.1 * R);
    s.lineTo(-0.035 * R, 0.3 * R);
    s.closePath();
    const mat = this.track(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.5, emissive: ORANGE, emissiveIntensity: 0 }));
    this.litMaterials.push(mat);
    const m = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(s, { depth: 0.0008, bevelEnabled: false })), mat);
    m.position.z = this.depth * 0.4;
    this.object.add(m);
  }
}
