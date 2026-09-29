/**
 * Davtron M803 clock / OAT / voltmeter (172S POH Rev 4 Supplement 9) as a
 * 3D instrument with working buttons and LCD windows.
 *
 * Layout (POH Supplement 9 Figure 1; the face of the real unit, Commons
 * "Flight training cockpit 5"): a round face with the red upper button at
 * 12 o'clock between the "O.A.T." and "VOLTS" legends, one backlit
 * two-line LCD (upper line OAT / volts; lower line time with the UT LT /
 * FT ET flags on its left, the running mode underlined), and the SELECT
 * (lower left) and CONTROL (lower right) buttons with "DAVTRON" between.
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
  private readonly lcd: DynamicPlane;
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
    // Black face plate with the printed legends.
    const f = this.face(256);
    f.background('#121212', true);
    f.text('O.A.T.', -0.42, 0.66, 0.1, '#c9c9c9');
    f.text('VOLTS', 0.42, 0.66, 0.1, '#c9c9c9');
    f.text('SELECT', -0.44, -0.6, 0.09, '#c9c9c9');
    f.text('CONTROL', 0.44, -0.6, 0.09, '#c9c9c9');
    f.text('DAVTRON', 0, -0.9, 0.08, '#c9c9c9');
    this.addDial(f, 0, R);
    // One two-line LCD.
    this.lcd = this.addDynamicPlane(256, 144, R * 1.46, R * 0.82, 0, 0.04 * R, 0.0004, { lit: false });
    const bgeo = this.track(new THREE.CylinderGeometry(R * 0.11, R * 0.12, 0.003, 20));
    bgeo.rotateX(Math.PI / 2);
    const red = this.track(new THREE.MeshStandardMaterial({ color: '#b3171a', roughness: 0.35, metalness: 0.05 }));
    const blue = this.track(new THREE.MeshStandardMaterial({ color: '#3f6fb8', roughness: 0.35, metalness: 0.05 }));
    const mk = (id: ButtonId, x: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(bgeo, id === 'upper' ? red : blue);
      m.position.set(x, y, 0.0015);
      m.name = `davtron.${id}`;
      this.object.add(m);
      this.hitTargets.push(m);
      this.buttons.set(m, id);
      return m;
    };
    this.buttonMeshes = {
      upper: mk('upper', 0, 0.8 * R),
      select: mk('select', -0.44 * R, -0.78 * R),
      control: mk('control', 0.44 * R, -0.78 * R),
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
    this.lcd.material.emissiveIntensity = back * 0.35;
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
    this.paintLcd(upper, hideLower ? '' : lower, m.setDigit >= 0 && !blink ? m.setDigit : -1, ann);
  }

  /** Paints the two-line LCD: upper line OAT / volts, lower line the time with the UT LT / FT ET flags. */
  private paintLcd(upper: string, lower: string, hideDigit: number, ann: string): void {
    const p = this.lcd;
    const { ctx, canvas } = p;
    const W = canvas.width;
    const H = canvas.height;
    const split = H * 0.44;
    ctx.fillStyle = this.model.powered ? LCD_BG : LCD_BG_OFF;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    ctx.fillStyle = '#5b6555';
    ctx.fillRect(8, split - 1, W - 16, 2);
    const digits = (h: number): string => `bold ${Math.round(h)}px "DSEG7 Classic", "Digital-7", Consolas, "DejaVu Sans Mono", monospace`;
    ctx.fillStyle = LCD_INK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    if (upper) {
      ctx.font = digits(split * 0.72);
      ctx.fillText(upper, W - 18, split * 0.52);
    }
    if (lower) {
      ctx.font = digits((H - split) * 0.7);
      let shown = lower;
      if (hideDigit >= 0) {
        // Blank the digit being set during the dark blink phase (HH:MM -> index skipping ':').
        const idx = hideDigit < 2 ? hideDigit : hideDigit + 1;
        shown = lower.slice(0, idx) + ' ' + lower.slice(idx + 1);
      }
      ctx.fillText(shown, W - 14, split + (H - split) * 0.52);
    }
    // Mode flags: UT LT (upper row) / FT ET (lower row) left of the time; the running mode underlined.
    if (this.model.powered) {
      ctx.font = `bold ${Math.round((H - split) * 0.22)}px Arial, "DejaVu Sans", sans-serif`;
      ctx.textAlign = 'left';
      for (let i = 0; i < 4; i++) {
        const x = 12 + (i % 2) * 38;
        const y = split + (H - split) * (i < 2 ? 0.3 : 0.7);
        ctx.fillStyle = LCD_INK;
        ctx.fillText(MODES[i], x, y);
        if (ann[i] === '1') ctx.fillRect(x, y + (H - split) * 0.13, 28, 3);
      }
    }
    p.commit();
  }
}
