/**
 * VOR/LOC course deviation indicator with optional glideslope (Bendix/King
 * KI 208 / KI 209A style), OBS knob and flags.
 *
 * 172S POH Rev 4 Supplement 1 (KX 155A with KI 208 or KI 209A), Figure 1
 * items 14-19: VOR/localizer (CDI) needle, glideslope flag, TO-FROM-NAV
 * flag, azimuth card, OBS knob, glideslope needle; the glideslope receiver
 * and needle exist with the KI 209A only.
 *
 * Mechanics: the azimuth (OBS) card rotates with the OBS setting under a
 * top lubber index; the CDI needle hangs from a pivot above the dial and
 * swings left/right; the GS needle hinges on the left edge; the TO/FROM/NAV
 * flag is a three-position vane behind a dial window (white TO/FROM arrows,
 * red-striped NAV); the GS flag drops into view when the glideslope is
 * invalid. Deviation scale: 5 dots each side = full scale (EST dot count
 * from KI 208/209A photographs; VOR full scale 10 deg, localizer ~2.5 deg,
 * glideslope ~0.7 deg, handled by the receiver's normalised outputs).
 * Inputs (nav module): nav{r}.cdi, .to_from, .received, .powered, .gs_valid,
 * .gs_dev; the OBS knob writes nav{r}.obs_deg (1 deg/detent, Shift 10 deg).
 */
import * as THREE from 'three';
import { clamp, wrap360 } from '../../../core/math';
import { NAV } from '../../../core/vars';
import { NeedleDynamics } from '../../common/dynamics';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, MARK_RED, type FaceCanvas } from '../face';

export interface CourseIndicatorOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  /** Nav receiver index (1-based). */
  receiver?: number;
  /** KI 209A: glideslope needle and GS flag. */
  glideslope?: boolean;
}

const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
/** Dot spacing (dial radii) and dots per side. */
const DOT = 0.1;
const DOTS = 5;
/** Needle pivots (dial radii): outside the dial window, hidden behind the square flange (half-width 1.16 R). */
const PIVOT = 1.1;
/** Flag window centre (dial radii): right = TO/FROM/NAV, left = GS. */
const WIN_X = 0.3;
const WIN_Y = 0.22;

export class CourseIndicator extends AnalogGauge {
  private readonly r: number;
  private readonly gs: boolean;
  private readonly card: ReturnType<AnalogGauge['addDial']>;
  private readonly cdiPivot: ReturnType<AnalogGauge['addNeedle']>;
  private readonly gsPivot: ReturnType<AnalogGauge['addNeedle']> | null = null;
  private readonly flag: THREE.Mesh;
  private readonly gsFlag: THREE.Mesh | null = null;
  private readonly cdiDyn = new NeedleDynamics({ omega: 6, zeta: 0.8 });
  private readonly gsDyn = new NeedleDynamics({ omega: 6, zeta: 0.8 });
  private flagPos = 0;
  private gsFlagPos = 1;
  private readonly maxDeg: number;
  private readonly names: { cdi: string; toFrom: string; received: string; powered: string; gsValid: string; gsDev: string; obs: string };

  constructor(o: CourseIndicatorOptions) {
    super({ name: o.glideslope ? 'VOR/LOC/GS indicator' : 'VOR/LOC indicator', ...o, knobCorners: ['bl'] });
    this.r = o.receiver ?? 1;
    this.gs = o.glideslope ?? false;
    const r = this.r;
    this.names = { cdi: NAV.cdi(r), toFrom: NAV.toFrom(r), received: NAV.received(r), powered: NAV.powered(r), gsValid: NAV.gsValid(r), gsDev: NAV.gsDev(r), obs: NAV.obs(r) };
    const R = this.dialR;
    // Full-scale deflection: 5 dots at the dial centre, seen from the pivot.
    this.maxDeg = (Math.atan((DOTS * DOT) / PIVOT) * 180) / Math.PI;
    // TO/FROM/NAV vane behind the dial (three stacked cells: TO, FROM, NAV).
    const vf = this.face(256);
    this.paintVane(vf);
    // Vanes sit between the dial (z 0.0006) and the azimuth card (z -0.002), inside the card ring.
    this.flag = this.addPlane(vf, 0.18 * R, 0.45 * R, WIN_X * R, WIN_Y * R, -0.0008, this.object, true);
    if (this.gs) {
      const gf = this.face(128);
      gf.background(MARK_RED, true);
      const c = gf.ctx;
      c.fillStyle = '#ffffff';
      for (let i = -4; i < 8; i++) c.fillRect(i * 22, 0, 8, gf.size);
      gf.text('GS', 0, 0, 0.55, DIAL_BLACK);
      this.gsFlag = this.addPlane(gf, 0.18 * R, 0.13 * R, -WIN_X * R, WIN_Y * R, -0.0008);
    }
    // Azimuth card (rotates with OBS).
    const cf = this.face();
    this.paintCard(cf);
    this.card = this.addDial(cf, -0.002);
    // Fixed face: dots, centre circle, lubber indices, windows; open ring for the card.
    const f = this.face();
    this.paintFace(f);
    this.addDial(f, 0.0006, R, this.object, true);
    this.cdiPivot = this.addNeedle({ length: PIVOT + 0.72, tail: 0, width: 0.03, tipWidth: 0.03, style: 'bar' }, { y: PIVOT * R, z: this.depth * 0.45, hubRadius: 0 });
    this.cdiPivot.rotation.z = Math.PI; // hangs down
    if (this.gs) {
      this.gsPivot = this.addNeedle({ length: PIVOT + 0.72, tail: 0, width: 0.03, tipWidth: 0.03, style: 'bar' }, { x: -PIVOT * R, z: this.depth * 0.38, hubRadius: 0 });
      AnalogGauge.setAngle(this.gsPivot, 90);
    }
    const kp = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'OBS',
      x: kp.x,
      y: kp.y,
      onTurn: (steps, coarse) => this.vars.set(this.names.obs, wrap360(Math.round(this.vars.get(this.names.obs)) + steps * (coarse ? 10 : 1))),
    });
  }

  protected updateGauge(dt: number): void {
    const v = this.vars;
    const n = this.names;
    const powered = v.get(n.powered, 1) >= 0.5;
    const received = powered && v.get(n.received) >= 0.5;
    const cdi = received ? clamp(v.get(n.cdi), -1.1, 1.1) : 0;
    // The needle hangs from a pivot above the dial (dial angle 180 = down); swinging the
    // lower end right (fly right) is a smaller dial angle.
    const a = this.cdiDyn.update(cdi * this.maxDeg, dt);
    AnalogGauge.setAngle(this.cdiPivot, 180 - a);
    if (this.gsPivot) {
      const gsOk = received && v.get(n.gsValid) >= 0.5;
      const dev = gsOk ? clamp(v.get(n.gsDev), -1.1, 1.1) : 0;
      // Pivot on the left, needle pointing right (90); + dev (fly up) raises the right end = counter-clockwise.
      const g = this.gsDyn.update(dev * this.maxDeg, dt);
      AnalogGauge.setAngle(this.gsPivot, 90 - g);
      this.gsFlagPos += ((gsOk ? 1 : 0) - this.gsFlagPos) * (1 - Math.exp(-dt / 0.08));
      if (this.gsFlag) this.gsFlag.position.y = (WIN_Y + this.gsFlagPos * 0.16) * this.dialR;
    }
    // Vane: 0 = TO, 1 = FROM, 2 = NAV flag.
    const tf = v.get(n.toFrom);
    const target = !received || tf === 0 ? 2 : tf > 0 ? 0 : 1;
    this.flagPos += (target - this.flagPos) * (1 - Math.exp(-dt / 0.06));
    this.flag.position.y = (WIN_Y + (this.flagPos - 1) * 0.15) * this.dialR;
    AnalogGauge.setAngle(this.card, -v.get(n.obs));
  }

  tooltip(): string {
    const v = this.vars;
    const n = this.names;
    const tf = v.get(n.toFrom);
    const flag = v.get(n.received) < 0.5 ? 'NAV flag' : tf > 0 ? 'TO' : tf < 0 ? 'FROM' : 'NAV flag';
    return `NAV${this.r}: OBS ${Math.round(wrap360(v.get(n.obs)))}° · ${flag} · CDI ${(v.get(n.cdi) * DOTS).toFixed(1)} dots`;
  }

  private paintCard(f: FaceCanvas): void {
    f.background('#1a1a1a');
    for (let d = 0; d < 360; d += 5) f.tick(d, d % 10 === 0 ? 0.8 : 0.85, 0.92, d % 10 === 0 ? 0.018 : 0.01);
    for (let d = 0; d < 360; d += 30) f.label(CARDINAL[d] ?? String(d / 10), d, 0.7, 0.12, DIAL_WHITE, true);
  }

  private paintFace(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    f.circleWindow(0, 0, 1.01);
    // Inner fixed disc (inside the card ring).
    f.dot(0, 0, 0.62, DIAL_BLACK);
    for (let i = 1; i <= DOTS; i++) {
      f.dot(i * DOT, 0, 0.022, '', DIAL_WHITE, 0.012);
      f.dot(-i * DOT, 0, 0.022, '', DIAL_WHITE, 0.012);
      if (this.gs) {
        f.dot(0, i * DOT, 0.022, '', DIAL_WHITE, 0.012);
        f.dot(0, -i * DOT, 0.022, '', DIAL_WHITE, 0.012);
      }
    }
    f.dot(0, 0, 0.07, '', DIAL_WHITE, 0.012);
    // Lubber indices (top: selected course, bottom: reciprocal).
    f.poly([0, 0.64, -0.05, 0.74, 0.05, 0.74], DIAL_WHITE);
    f.poly([0, -0.64, -0.04, -0.72, 0.04, -0.72], '', DIAL_WHITE, 0.012);
    // Windows: TO/FROM/NAV vane (right) and GS flag (left).
    f.window(WIN_X, WIN_Y, 0.16, 0.12);
    if (this.gs) f.window(-WIN_X, WIN_Y, 0.16, 0.12);
  }

  /** Vane cells top to bottom: TO arrow, FROM arrow, NAV flag. */
  private paintVane(f: FaceCanvas): void {
    const c = f.ctx;
    const S = f.size;
    c.fillStyle = '#111111';
    c.fillRect(0, 0, S, S);
    // Cell height = S/3 (vane plane is 0.18R x 0.45R, each cell 0.15R).
    const cell = S / 3;
    c.fillStyle = DIAL_WHITE;
    // TO: arrow up (top cell).
    c.beginPath();
    c.moveTo(S / 2, cell * 0.2);
    c.lineTo(S * 0.2, cell * 0.8);
    c.lineTo(S * 0.8, cell * 0.8);
    c.closePath();
    c.fill();
    // FROM: arrow down (middle cell).
    c.beginPath();
    c.moveTo(S / 2, cell * 1.8);
    c.lineTo(S * 0.2, cell * 1.2);
    c.lineTo(S * 0.8, cell * 1.2);
    c.closePath();
    c.fill();
    // NAV flag: red with white stripes (bottom cell).
    c.fillStyle = MARK_RED;
    c.fillRect(0, cell * 2, S, cell);
    c.fillStyle = '#ffffff';
    for (let x = -S; x < S * 2; x += S / 5) {
      c.beginPath();
      c.moveTo(x, cell * 3);
      c.lineTo(x + S / 12, cell * 3);
      c.lineTo(x + S / 12 + cell, cell * 2);
      c.lineTo(x + cell, cell * 2);
      c.closePath();
      c.fill();
    }
  }
}
