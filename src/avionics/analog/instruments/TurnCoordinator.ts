/**
 * Electric turn coordinator with inclinometer.
 *
 * FAA-H-8083-25B PHAK ch.8 "Turn Coordinator": gimbal canted 30 deg so it
 * responds to roll rate as well as yaw rate; the miniature aircraft shows
 * rate of turn (wing on the L/R index = standard rate, 2 min for 360 deg);
 * "NO PITCH INFORMATION"; electric instruments have a power-failure flag.
 * 172S POH §3 "Emergency Operation in Clouds": standard-rate turn "holding
 * the turn coordinator symbolic airplane wing opposite the lower left index
 * mark"; the turn coordinator is electric (it works after a vacuum failure).
 *
 * Construction: fixed dial with L/R marks, rotating airplane symbol in
 * front, OFF flag sliding into a dial window when power is lost (spring
 * loaded, held out of view by the supply), curved glass tube with a black
 * ball and two reference wires in front.
 * Physics: models/gyro.ts TurnGyro (rotor spin-up/down, canted sensing,
 * damped gimbal) and models/inclinometer.ts InclinometerBall (from fdm.ny /
 * fdm.nz — physical inputs, see vars.ts).
 */
import * as THREE from 'three';
import { AnalogGauge, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, MARK_RED, type FaceCanvas } from '../face';
import { TurnGyro, type TurnGyroOptions } from '../models/gyro';
import { InclinometerBall, type InclinometerOptions } from '../models/inclinometer';
import { ANALOG_VARS, PHYSICAL_INPUTS } from '../vars';

export interface TurnCoordinatorOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  voltsVar?: string;
  gyro?: TurnGyroOptions;
  ball?: InclinometerOptions;
  pVar?: string;
  rVar?: string;
  nyVar?: string;
  nzVar?: string;
}

export class TurnCoordinator extends AnalogGauge {
  readonly gyro: TurnGyro;
  readonly ball: InclinometerBall;
  private readonly o: TurnCoordinatorOptions;
  private readonly airplane = new THREE.Group();
  private readonly ballMesh: THREE.Mesh;
  private readonly flag: THREE.Mesh;
  private readonly tubeCenterY: number;
  private flagPos = 1;
  private readonly markDeg: number;

  constructor(o: TurnCoordinatorOptions) {
    super({ name: 'Turn coordinator', ...o });
    this.o = o;
    this.gyro = new TurnGyro(o.gyro);
    this.ball = new InclinometerBall(o.ball);
    this.markDeg = o.gyro?.standardMarkDeg ?? 17;
    const R = this.dialR;
    // OFF flag behind the dial window (slides left/right).
    const ff = this.face(128);
    ff.background(MARK_RED, true);
    const c = ff.ctx;
    c.fillStyle = '#ffffff';
    for (let i = -4; i < 8; i++) c.fillRect(i * 22, 0, 8, ff.size);
    ff.text('OFF', 0, 0, 0.5, DIAL_BLACK);
    this.flag = this.addPlane(ff, 0.22 * R, 0.16 * R, 0.62 * R, 0.52 * R, -0.0015);
    const f = this.face();
    this.paintDial(f);
    this.addDial(f, 0, R, this.object, true);
    this.buildAirplane();
    // Inclinometer: curved tube (partial torus) below the centre. Only the ball
    // angle comes from the physics; the drawn arc radius is chosen to fit the case.
    const visibleR = R * 1.5;
    this.tubeCenterY = -0.52 * R + visibleR;
    const tubeGeo = this.track(new THREE.TorusGeometry(visibleR, R * 0.07, 12, 48, (34 * Math.PI) / 180));
    const tubeMat = this.track(new THREE.MeshPhysicalMaterial({ color: '#dfe6e0', roughness: 0.08, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }));
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.rotation.z = -Math.PI / 2 - (17 * Math.PI) / 180;
    tube.position.set(0, this.tubeCenterY, this.depth * 0.62);
    tube.renderOrder = 5;
    this.object.add(tube);
    const ballMat = this.track(new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.25, metalness: 0.3 }));
    this.ballMesh = new THREE.Mesh(this.track(new THREE.SphereGeometry(R * 0.06, 20, 14)), ballMat);
    this.ballMesh.position.set(0, this.tubeCenterY - visibleR, this.depth * 0.62);
    this.object.add(this.ballMesh);
    // Reference wires either side of the centred ball.
    const wireMat = this.track(new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.6 }));
    for (const s of [-1, 1]) {
      const wire = new THREE.Mesh(this.track(new THREE.BoxGeometry(R * 0.012, R * 0.2, R * 0.012)), wireMat);
      wire.position.set(s * R * 0.075, this.tubeCenterY - visibleR, this.depth * 0.7);
      this.object.add(wire);
    }
    this.ball.reset();
  }

  setSpunUp(): void {
    this.gyro.setSpunUp();
  }

  protected updateGauge(dt: number): void {
    const o = this.o;
    const v = this.vars;
    this.gyro.update(v.get(o.pVar ?? PHYSICAL_INPUTS.p), v.get(o.rVar ?? PHYSICAL_INPUTS.r), v.get(o.voltsVar ?? ANALOG_VARS.turnCoordVolts, 28), dt);
    // Symbol: + = right wing down (clockwise).
    AnalogGauge.setAngle(this.airplane, this.gyro.symbolDeg);
    const deg = this.ball.update(v.get(o.nyVar ?? PHYSICAL_INPUTS.ny), v.get(o.nzVar ?? PHYSICAL_INPUTS.nz, 1), dt);
    const a = (deg * Math.PI) / 180;
    const vr = this.dialR * 1.5;
    this.ballMesh.position.x = Math.sin(a) * vr;
    this.ballMesh.position.y = this.tubeCenterY - Math.cos(a) * vr;
    // OFF flag slides into the window in ~0.3 s when power is lost.
    const target = this.gyro.flag ? 0 : 1;
    this.flagPos += (target - this.flagPos) * (1 - Math.exp(-dt / 0.08));
    this.flag.position.x = (0.62 + this.flagPos * 0.3) * this.dialR;
  }

  tooltip(): string {
    const rate = (this.gyro.symbolDeg / this.markDeg) * 3;
    return `Turn coordinator: ${rate >= 0 ? 'R' : 'L'} ${Math.abs(rate).toFixed(1)}°/s · ball ${this.ball.angleDeg.toFixed(1)}°${this.gyro.flag ? ' · OFF' : ''}`;
  }

  private paintDial(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    const m = this.markDeg;
    // Level marks (wings level) and standard-rate L/R marks at 9-ish/3-ish o'clock.
    for (const a of [90, 270]) f.tick(a, 0.72, 0.9, 0.035);
    f.tick(90 + m, 0.72, 0.9, 0.035);
    f.tick(270 - m, 0.72, 0.9, 0.035);
    f.label('L', 270 - m, 0.62, 0.14);
    f.label('R', 90 + m, 0.62, 0.14);
    f.text('TURN COORDINATOR', 0, 0.62, 0.075);
    f.text('2 MIN', 0, -0.3, 0.09);
    f.text('D.C.', -0.42, -0.3, 0.065);
    f.text('ELEC.', 0.42, -0.3, 0.065);
    f.text('NO PITCH', 0, -0.8, 0.06);
    f.text('INFORMATION', 0, -0.88, 0.06);
    // Window for the OFF flag.
    f.window(0.62, 0.52, 0.2, 0.14);
  }

  private buildAirplane(): void {
    const R = this.dialR;
    const s = new THREE.Shape();
    // Top-view airplane: fuselage dot + straight wings + small tail.
    s.moveTo(-0.72 * R, -0.02 * R);
    s.lineTo(-0.08 * R, -0.03 * R);
    s.lineTo(-0.06 * R, -0.18 * R);
    s.lineTo(-0.18 * R, -0.21 * R);
    s.lineTo(-0.18 * R, -0.25 * R);
    s.lineTo(0.18 * R, -0.25 * R);
    s.lineTo(0.18 * R, -0.21 * R);
    s.lineTo(0.06 * R, -0.18 * R);
    s.lineTo(0.08 * R, -0.03 * R);
    s.lineTo(0.72 * R, -0.02 * R);
    s.lineTo(0.72 * R, 0.03 * R);
    s.lineTo(0.08 * R, 0.04 * R);
    s.absarc(0, 0.04 * R, 0.08 * R, 0, Math.PI, false);
    s.lineTo(-0.72 * R, 0.03 * R);
    s.closePath();
    const mesh = new THREE.Mesh(this.track(new THREE.ExtrudeGeometry(s, { depth: 0.0008, bevelEnabled: false })), this.mats.needle);
    this.airplane.add(mesh);
    this.airplane.position.z = this.depth * 0.45;
    this.object.add(this.airplane);
  }
}
