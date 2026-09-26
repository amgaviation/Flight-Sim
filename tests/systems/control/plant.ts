/**
 * Minimal aircraft plant for control-law tests (NOT the real FDM).
 *
 * Longitudinal: pitch attitude driven by the elevator (second order, pitch
 * damping, AoA stiffness), flight path following pitch minus the trim AoA
 * with a lag, speed from thrust minus drag minus gravity along the path.
 * Lateral: roll rate from the aileron (first order), coordinated turn.
 * Position on a flat-earth plane (x east, y north, nm) — a localizer and a
 * glideslope on the x axis can be enabled for LOC/GS tests.
 *
 * It writes exactly the sensor vars the AFCS/AT/FBW read (ahrs1.*, adc1.*,
 * gps.*, ra1.*, nav1/2.*, gear.air_ground) and reads the surface or servo
 * commands.
 */
import { SimVars } from '../../../src/core/SimVars';
import { ADC, GPS, NAV, SURF, ENG } from '../../../src/core/vars';
import { SENSOR_VARS } from '../../../src/systems/sensors/vars';

const DEG = Math.PI / 180;
const G_KTS = 19.0626; // g in kt/s per radian of flight path

export interface PlantOptions {
  tasKt?: number;
  altFt?: number;
  hdgDeg?: number;
  x?: number;
  y?: number;
  /** Elevator input source: 'servo' (ap.servo_pitch + input.pitch) or 'surface' (surf.elevator). */
  controls?: 'servo' | 'surface';
  /** Fixed N1 (%). */
  n1?: number;
  /**
   * Thrust source when `n1` is not given: 'hold' (default: an ideal speed
   * holder keeps the initial speed), 'cmd' (eng1.n1_cmd_pct), 'lever'
   * (N1 = 20 + 80·ac.tla1).
   */
  thrust?: 'hold' | 'cmd' | 'lever';
  groundElevFt?: number;
}

export class TestPlant {
  readonly vars: SimVars;
  // state
  theta = 2;
  q = 0;
  gamma = 0;
  phi = 0;
  p = 0;
  psi = 0;
  tas = 200;
  alt = 5000;
  x = -20;
  y = 0;
  n1 = 60;
  nz = 1;
  /** Trim AoA (deg): level flight needs theta = gamma + alpha0. */
  alpha0 = 2;
  // parameters
  kElev = 20; // deg/s² per unit elevator
  cq = 2;
  kAlpha = 2;
  tauGamma = 1.5;
  kAil = 40; // deg/s² per unit aileron
  cp = 2;
  thrustK = 0.1; // kt/s per % N1 above the level-flight N1
  opts: PlantOptions;
  loc: { course: number; antennaX: number; gsAngle: number } | null = null;
  groundElev = 0;
  private prevIas = NaN;
  /** Speed kept by the 'hold' thrust source (kt). */
  holdKt: number;

  constructor(vars: SimVars, opts: PlantOptions = {}) {
    this.vars = vars;
    this.opts = opts;
    this.tas = opts.tasKt ?? 200;
    this.holdKt = this.tas;
    this.alt = opts.altFt ?? 5000;
    this.psi = opts.hdgDeg ?? 0;
    this.x = opts.x ?? -20;
    this.y = opts.y ?? 0;
    this.groundElev = opts.groundElevFt ?? 0;
    this.theta = this.alpha0;
    if (opts.n1 !== undefined) this.n1 = opts.n1;
    else this.n1 = this.levelN1();
    vars.set(ADC.valid(1), 1);
    vars.set(ADC.ahrsValid(1), 1);
    vars.set(SENSOR_VARS.attValid(1), 1);
    vars.set(GPS.valid, 1);
    vars.set('gear.air_ground', 0);
    this.publish(1 / 60);
  }

  /** N1 for level unaccelerated flight at the current speed. */
  levelN1(): number {
    return 55 + (this.tas - 200) * 0.2;
  }

  enableIls(course = 90, antennaX = 1, gsAngle = 3): void {
    this.loc = { course, antennaX, gsAngle };
  }

  step(dt: number): void {
    const v = this.vars;
    let elev: number;
    let ail: number;
    if (this.opts.controls === 'surface') {
      // Stabilizer/trim tab adds to the elevator effectiveness (0.5 per unit of normalized trim).
      elev = v.get(SURF.elevator) + 0.5 * v.get(SURF.pitchTrim);
      ail = v.get(SURF.aileron);
    } else {
      elev = v.get('ap.servo_pitch') + v.get('input.pitch');
      ail = v.get('ap.servo_roll') + v.get('input.roll');
    }
    const qScale = (this.tas / 200) ** 2;
    // Longitudinal
    const alpha = this.theta - this.gamma;
    const qDot = this.kElev * qScale * elev - this.cq * this.q - this.kAlpha * (alpha - this.alpha0);
    this.q += qDot * dt;
    this.theta += this.q * dt;
    const gDot = (this.theta - this.gamma - this.alpha0) / this.tauGamma;
    this.gamma += gDot * dt;
    this.nz = Math.cos(this.gamma * DEG) / Math.max(0.2, Math.cos(this.phi * DEG)) + ((this.tas * 1.6878) * (gDot * DEG)) / 32.174;
    // Thrust / speed
    if (this.opts.n1 === undefined) {
      const mode = this.opts.thrust ?? 'hold';
      if (mode === 'hold') {
        this.n1 = this.levelN1() + (this.holdKt - this.tas) * 2 + (G_KTS * Math.sin(this.gamma * DEG)) / this.thrustK;
      } else {
        const cmd = mode === 'cmd' ? v.get(ENG.n1Cmd(1)) : 20 + 80 * v.get('ac.tla1');
        this.n1 += (cmd - this.n1) * (1 - Math.exp(-dt / 1.5));
      }
    }
    const vDot = this.thrustK * (this.n1 - this.levelN1()) - G_KTS * Math.sin(this.gamma * DEG);
    this.tas = Math.max(40, this.tas + vDot * dt);
    // Lateral
    const pDot = this.kAil * qScale * ail - this.cp * this.p;
    this.p += pDot * dt;
    this.phi += this.p * dt;
    const turnRate = ((1091 * Math.tan(this.phi * DEG)) / this.tas); // deg/s (V in kt)
    this.psi = (((this.psi + turnRate * dt) % 360) + 360) % 360;
    // Position
    const gs = this.tas * Math.cos(this.gamma * DEG);
    this.x += (gs * Math.sin(this.psi * DEG) * dt) / 3600;
    this.y += (gs * Math.cos(this.psi * DEG) * dt) / 3600;
    this.alt += this.tas * 1.6878 * Math.sin(this.gamma * DEG) * dt;
    this.publish(dt);
  }

  run(seconds: number, each: (t: number) => void, dt = 1 / 60): void {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      each(i * dt);
      this.step(dt);
    }
  }

  private publish(dt: number): void {
    const v = this.vars;
    const vs = this.tas * 101.2686 * Math.sin(this.gamma * DEG);
    const ias = this.tas; // no density effect in the plant
    v.set(ADC.pitch(1), this.theta);
    v.set(ADC.bank(1), this.phi);
    v.set(ADC.heading(1), this.psi);
    v.set(SENSOR_VARS.p(1), this.p);
    v.set(SENSOR_VARS.q(1), this.q);
    v.set(SENSOR_VARS.r(1), ((1091 * Math.tan(this.phi * DEG)) / this.tas) * Math.cos(this.phi * DEG));
    v.set(SENSOR_VARS.nz(1), this.nz);
    v.set(SENSOR_VARS.ny(1), 0);
    v.set(SENSOR_VARS.aoa(1), this.theta - this.gamma);
    v.set(ADC.ias(1), ias);
    v.set(ADC.tas(1), this.tas);
    v.set(ADC.mach(1), this.tas / 661.47);
    v.set(ADC.baroAlt(1), this.alt);
    v.set(SENSOR_VARS.pressAlt(1), this.alt);
    v.set(ADC.vs(1), vs);
    const rate = Number.isNaN(this.prevIas) ? 0 : (ias - this.prevIas) / dt;
    this.prevIas = ias;
    v.set(SENSOR_VARS.iasRate(1), rate);
    v.set(GPS.gs, this.tas * Math.cos(this.gamma * DEG));
    v.set(GPS.trackMag, this.psi);
    v.set(GPS.trackTrue, this.psi);
    const ra = this.alt - this.groundElev;
    v.set(SENSOR_VARS.raAlt(1), Math.min(ra, 2500));
    v.set(SENSOR_VARS.raValid(1), ra <= 2500 ? 1 : 0);
    v.set(SENSOR_VARS.raAlt(2), Math.min(ra, 2500));
    v.set(SENSOR_VARS.raValid(2), ra <= 2500 ? 1 : 0);
    v.set('gear.air_ground', ra <= 0.5 ? 1 : 0);
    v.set(ENG.n1(1), this.n1);
    v.set(ENG.n1(2), this.n1);
    if (this.loc) this.publishIls();
  }

  private publishIls(): void {
    const v = this.vars;
    const L = this.loc!;
    // Course is the +x direction for course 090 (the geometry assumes 090).
    const dx = L.antennaX - this.x;
    const devDeg = (Math.atan2(this.y, dx) / DEG); // aircraft north of the 090 course = left = fly right (+)
    const dist = Math.hypot(dx, this.y);
    const gsDist = Math.hypot(this.x, this.y) * 6076;
    const elevAngle = Math.atan2(this.alt - this.groundElev, gsDist) / DEG;
    const gsDevDeg = L.gsAngle - elevAngle;
    for (const r of [1, 2]) {
      v.set(NAV.received(r), 1);
      v.set(NAV.isLoc(r), 1);
      v.set(NAV.locCourse(r), L.course);
      v.set(NAV.obs(r), L.course);
      v.set(NAV.devDeg(r), devDeg);
      v.set(NAV.cdi(r), Math.max(-1, Math.min(1, devDeg / 2.5)));
      v.set(NAV.distNm(r), dist);
      v.set(NAV.gsValid(r), this.x < 0 ? 1 : 0);
      v.set(NAV.gsDevDeg(r), gsDevDeg);
      v.set(NAV.gsDev(r), Math.max(-1, Math.min(1, gsDevDeg / (0.24 * L.gsAngle))));
      v.set(NAV.toFrom(r), 1);
    }
  }
}
