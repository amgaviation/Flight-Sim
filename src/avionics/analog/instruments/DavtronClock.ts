/**
 * Davtron M803 clock / OAT / voltmeter (172S POH Rev 4 Supplement 9) as a
 * 3D instrument with working buttons and LCD windows.
 *
 * Layout (POH Supplement 9 Figure 1): upper LCD window (OAT / volts) with
 * the upper button, lower LCD window (time) with the UT/LT/FT/ET
 * annunciators, SELECT (lower left) and CONTROL (lower right) buttons.
 * All button logic lives in models/davtron.ts. Mouse: left click presses
 * (held while the mouse button is held — hold SELECT 3 s for the display
 * test, hold CONTROL 3 s in FT to reset flight time); middle click or
 * Shift+click on SELECT/CONTROL = both buttons together (set mode).
 * The LCD backlight follows the instrument lighting ("controlled by the
 * PANEL LT rheostat"); without airplane power the display is blank and the
 * buttons are disabled.
 *
 * Inputs: `powerVar` (clock supply V, default ac.elec.clock_v), `voltsVar`
 * (voltmeter source, default ac.elec.bus_v), `oatVar` (default adc1.tat_c),
 * `utcVar` (sets the clock at first update, default env.time_utc_h),
 * optional `flightTimeVar` (flight time runs while >= 0.5; default: while powered).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../cockpit/types';
import { COCKPIT_SOUNDS } from '../../../cockpit/types';
import { AnalogGauge, type AnalogGaugeOptions, type DynamicPlane } from '../AnalogGauge';
import { INSTRUMENT_SIZE } from '../geometry';
import { DavtronM803, type DavtronMode } from '../models/davtron';
import { ANALOG_VARS } from '../vars';

export interface DavtronClockOptions extends Omit<AnalogGaugeOptions, 'knobCorners' | 'bezel'> {
  powerVar?: string;
  voltsVar?: string;
  oatVar?: string;
  utcVar?: string;
  flightTimeVar?: string;
  /** Local time offset (h) preset. */
  localOffsetH?: number;
}

type ButtonId = 'upper' | 'select' | 'control';

const LCD_BG = '#9fae96';
const LCD_BG_OFF = '#6f7a69';
const LCD_INK = '#1c2118';
const MODES: readonly DavtronMode[] = ['UT', 'LT', 'FT', 'ET'];
const BUTTON_IDS: readonly ButtonId[] = ['upper', 'select', 'control'];
/** LCD content is re-evaluated at 10 Hz (LCD segment response is slower than that anyway). */
const LCD_PERIOD_S = 0.1;

export class DavtronClock extends AnalogGauge {
  readonly model = new DavtronM803();
  private readonly o: DavtronClockOptions;
  private readonly upperLcd: DynamicPlane;
  private readonly lowerLcd: DynamicPlane;
  private readonly buttons = new Map<THREE.Object3D, ButtonId>();
  private readonly buttonMeshes: Record<ButtonId, THREE.Mesh>;
  private pressed: ButtonId | null = null;
  private lastKey = '';
  private synced = false;
  private lcdTimer = 0;

  constructor(o: DavtronClockOptions) {
    super({ name: 'Clock / OAT', size: INSTRUMENT_SIZE.ATI2, ...o, bezel: 'square', depth: 0.004 });
    this.o = o;
    if (o.localOffsetH !== undefined) this.model.localOffsetH = o.localOffsetH;
    const R = this.dialR;
    // Black face plate.
    const f = this.face(256);
    f.background('#121212', true);
    f.text('DAVTRON', 0, 0.84, 0.1, '#bdbdbd');
    f.text('OAT / VOLTS', 0.0, 0.58, 0.075, '#bdbdbd');
    f.text('SELECT', -0.55, -0.9, 0.075, '#bdbdbd');
    f.text('CONTROL', 0.55, -0.9, 0.075, '#bdbdbd');
    for (let i = 0; i < 4; i++) f.text(MODES[i], -0.54 + i * 0.36, -0.52, 0.085, '#bdbdbd');
    this.addDial(f, 0, R);
    this.upperLcd = this.addDynamicPlane(256, 96, R * 1.1, R * 0.4, -0.12 * R, 0.3 * R, 0.0004, { lit: false });
    this.lowerLcd = this.addDynamicPlane(256, 96, R * 1.5, R * 0.5, 0, -0.2 * R, 0.0004, { lit: false });
    const bmat = this.track(new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.45, metalness: 0.2 }));
    const bgeo = this.track(new THREE.CylinderGeometry(R * 0.13, R * 0.14, 0.003, 20));
    bgeo.rotateX(Math.PI / 2);
    const mk = (id: ButtonId, x: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(bgeo, bmat);
      m.position.set(x, y, 0.0015);
      m.name = `davtron.${id}`;
      this.object.add(m);
      this.hitTargets.push(m);
      this.buttons.set(m, id);
      return m;
    };
    this.buttonMeshes = {
      upper: mk('upper', 0.72 * R, 0.3 * R),
      select: mk('select', -0.55 * R, -0.72 * R),
      control: mk('control', 0.55 * R, -0.72 * R),
    };
    this.drawLcd(true);
  }

  // ---------------------------------------------------------------- pointer

  override onPointerDown(p: ControlPointer): void {
    const id = this.buttonFor(p.object);
    if (!id) return;
    this.pressed = id;
    this.audio?.play(COCKPIT_SOUNDS.buttonPress, { volume: 0.4 });
    const m = this.model;
    if (id === 'upper') m.pressUpper();
    else if (p.button === 1 || p.shift) m.pressBoth();
    else if (id === 'select') m.pressSelect();
    else m.pressControl();
    this.lcdTimer = 0; // immediate feedback
  }

  override onPointerUp(_p: ControlPointer): void {
    if (!this.pressed) return;
    if (this.pressed === 'select') this.model.releaseSelect();
    else if (this.pressed === 'control') this.model.releaseControl();
    this.pressed = null;
  }

  override onCancel(): void {
    this.model.releaseSelect();
    this.model.releaseControl();
    this.pressed = null;
  }

  override onWheel(): void {}

  override cursor(): string {
    return 'pointer';
  }

  // ---------------------------------------------------------------- update

  protected updateGauge(dt: number): void {
    const o = this.o;
    const v = this.vars;
    if (!this.synced) {
      this.model.setUtcHours(v.get(o.utcVar ?? ANALOG_VARS.utcHours, 12));
      this.synced = true;
    }
    const volts = v.get(o.powerVar ?? ANALOG_VARS.clockVolts, 28);
    const powered = volts >= 8; // EST: 8-32 V input range for a 14/28 V clock
    const ftRun = o.flightTimeVar ? v.get(o.flightTimeVar) >= 0.5 : true;
    this.model.update(dt, powered, v.get(o.voltsVar ?? ANALOG_VARS.busVolts, volts), v.get(o.oatVar ?? ANALOG_VARS.oatC, 15), ftRun);
    // Backlight follows the panel lighting when powered.
    const back = powered ? 0.15 + this.light * 0.85 : 0;
    this.upperLcd.material.emissiveIntensity = back * 0.35;
    this.lowerLcd.material.emissiveIntensity = back * 0.35;
    for (let i = 0; i < BUTTON_IDS.length; i++) {
      const id = BUTTON_IDS[i];
      this.buttonMeshes[id].position.z = this.pressed === id ? 0.0008 : 0.0015;
    }
    this.lcdTimer -= dt;
    if (this.lcdTimer <= 0) {
      this.lcdTimer = LCD_PERIOD_S;
      this.drawLcd(false);
    }
  }

  tooltip(): string {
    const m = this.model;
    return `Davtron M803: ${m.upperText() || '—'} · ${m.mode} ${m.lowerText() || '—'}`;
  }

  // ---------------------------------------------------------------- LCD

  private buttonFor(obj: THREE.Object3D): ButtonId | null {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      const id = this.buttons.get(o);
      if (id) return id;
    }
    return null;
  }

  private drawLcd(force: boolean): void {
    const m = this.model;
    const blink = m.blinkPhase;
    const upper = m.upperText();
    const lower = m.lowerText();
    // Annunciator of the running mode flashes (POH: "resume its normal flashing").
    let ann = '';
    for (const md of MODES) ann += m.annunciatorLit(md) && (m.testing || blink || m.setDigit >= 0) ? '1' : '0';
    const hideLower = m.flashing && !blink;
    const key = `${upper}|${lower}|${ann}|${hideLower ? 1 : 0}|${m.setDigit}|${m.setDigit >= 0 && blink ? 1 : 0}|${m.powered ? 1 : 0}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.paintLcd(this.upperLcd, upper, -1, false);
    this.paintLcd(this.lowerLcd, hideLower ? '' : lower, m.setDigit >= 0 && !blink ? m.setDigit : -1, true, ann);
  }

  private paintLcd(p: DynamicPlane, text: string, hideDigit: number, lower: boolean, ann = '0000'): void {
    const { ctx, canvas } = p;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = this.model.powered ? LCD_BG : LCD_BG_OFF;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    if (text) {
      ctx.fillStyle = LCD_INK;
      ctx.font = `bold ${Math.round(H * (lower ? 0.62 : 0.66))}px "DSEG7 Classic", "Digital-7", Consolas, "DejaVu Sans Mono", monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let shown = text;
      if (hideDigit >= 0) {
        // Blank the digit being set during the dark blink phase (HH:MM -> index skipping ':').
        const idx = hideDigit < 2 ? hideDigit : hideDigit + 1;
        shown = text.slice(0, idx) + ' ' + text.slice(idx + 1);
      }
      ctx.fillText(shown, W - 14, lower ? H * 0.42 : H / 2);
    }
    if (lower) {
      // UT LT FT ET annunciator bars under the digits.
      for (let i = 0; i < 4; i++) {
        if (ann[i] !== '1') continue;
        ctx.fillStyle = LCD_INK;
        ctx.fillRect(12 + i * (W - 24) * 0.25 + 10, H * 0.8, (W - 24) * 0.25 - 20, H * 0.1);
      }
    }
    p.commit();
  }
}
