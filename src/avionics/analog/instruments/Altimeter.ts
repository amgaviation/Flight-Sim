/**
 * Three-pointer sensitive altimeter with Kollsman window (inHg at 3
 * o'clock, mb at 9 o'clock on the same rotating drum) and baro-set knob.
 *
 * Cessna 172S POH Rev 4 §7 "Altimeter": barometric type; a knob near the
 * lower left adjusts the barometric scale to the current altimeter setting.
 * Pointers: 100 ft (long), 1,000 ft (short, wide), 10,000 ft (thin with a
 * triangular tip) — FAA-H-8083-25B PHAK ch.8 "Principle of Operation".
 *
 * Altitude source:
 *  - 'adc' (default): shows `altVar` (adc1.alt_ft); the knob writes
 *    `baroVar` (adc1.baro_inhg) which the aircraft's air-data model uses —
 *    the steam altimeter IS the 172's pneumatic "ADC".
 *  - 'pressure': an independent (standby) altimeter computing indicated
 *    altitude from `pressureAltVar` and its own Kollsman setting in `baroVar`
 *    (models/altimeter.ts, ISA relation).
 * SCOPE: no crosshatched low-altitude flag, no mechanical hysteresis.
 */
import { clamp } from '../../../core/math';
import { NeedleDynamics } from '../../common/dynamics';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, type FaceCanvas } from '../face';
import { HPA_PER_INHG, KOLLSMAN_MAX_INHG, KOLLSMAN_MIN_INHG, altimeterPointers, indicatedAltitudeFt, kollsmanDrumAngle, type AltimeterPointers } from '../models/altimeter';
import { ANALOG_VARS } from '../vars';

export interface AltimeterOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  source?: 'adc' | 'pressure';
  altVar?: string;
  pressureAltVar?: string;
  baroVar?: string;
  /** Drum degrees per inHg. EST 55 (keeps the inHg and mb scales apart). */
  degPerInHg?: number;
}

export class Altimeter extends AnalogGauge {
  altitude = 0;
  private readonly o: AltimeterOptions;
  private readonly baroVar: string;
  private readonly d: number;
  private readonly drum: ReturnType<AnalogGauge['addDial']>;
  private readonly p100: ReturnType<AnalogGauge['addNeedle']>;
  private readonly p1000: ReturnType<AnalogGauge['addNeedle']>;
  private readonly p10000: ReturnType<AnalogGauge['addNeedle']>;
  private readonly dyn = new NeedleDynamics({ omega: 6, zeta: 0.85 });
  private readonly ptr: AltimeterPointers = { hundreds: 0, thousands: 0, tenThousands: 0 };
  private dynInit = false;

  constructor(o: AltimeterOptions) {
    super({ name: 'Altimeter', ...o, knobCorners: ['bl'] });
    this.o = o;
    this.baroVar = o.baroVar ?? ANALOG_VARS.baroSetting;
    this.d = o.degPerInHg ?? 55;
    if (!this.vars.has(this.baroVar)) this.vars.set(this.baroVar, 29.92);
    const df = this.face();
    this.paintDrum(df);
    this.drum = this.addDial(df, -0.003);
    const f = this.face();
    this.paintDial(f);
    this.addDial(f, 0, this.dialR, this.object, true);
    const z = this.depth;
    this.p10000 = this.addNeedle({ length: 0.9, tail: 0.1, width: 0.018, tipWidth: 0.03, style: 'thin' }, { z: z * 0.3, hubRadius: 0 });
    this.p1000 = this.addNeedle({ length: 0.55, tail: 0.14, width: 0.13, tipWidth: 0.03, style: 'sword' }, { z: z * 0.42, hubRadius: 0 });
    this.p100 = this.addNeedle({ length: 0.86, tail: 0.2, width: 0.06, tipWidth: 0.018, style: 'pointer' }, { z: z * 0.54 });
    const kp = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'BARO',
      x: kp.x,
      y: kp.y,
      onTurn: (steps, fine) => {
        const k = this.vars.get(this.baroVar, 29.92) + steps * (fine ? 0.002 : 0.01);
        this.vars.set(this.baroVar, clamp(Math.round(k * 1000) / 1000, KOLLSMAN_MIN_INHG, KOLLSMAN_MAX_INHG));
      },
    });
  }

  get kollsmanInHg(): number {
    return this.vars.get(this.baroVar, 29.92);
  }

  protected updateGauge(dt: number): void {
    const o = this.o;
    const k = this.kollsmanInHg;
    const alt = o.source === 'pressure' ? indicatedAltitudeFt(this.vars.get(o.pressureAltVar ?? ANALOG_VARS.pressureAlt), k) : this.vars.get(o.altVar ?? ANALOG_VARS.altitude);
    if (!this.dynInit) {
      this.dyn.reset(alt);
      this.dynInit = true;
    }
    this.altitude = this.dyn.update(alt, dt);
    altimeterPointers(this.altitude, this.ptr);
    AnalogGauge.setAngle(this.p100, this.ptr.hundreds);
    AnalogGauge.setAngle(this.p1000, this.ptr.thousands);
    AnalogGauge.setAngle(this.p10000, this.ptr.tenThousands);
    AnalogGauge.setAngle(this.drum, kollsmanDrumAngle(k, this.d));
  }

  tooltip(): string {
    const k = this.kollsmanInHg;
    return `Altimeter: ${Math.round(this.altitude)} ft · ${k.toFixed(2)} inHg (${Math.round(k * HPA_PER_INHG)} mb)`;
  }

  /** Drum angle (deg on the drum) where the inHg value X is printed so that it shows at 3 o'clock. */
  private inHgAt(x: number): number {
    return 90 - kollsmanDrumAngle(x, this.d);
  }

  private paintDrum(f: FaceCanvas): void {
    f.background('#e9e6dc');
    const c = f.ctx;
    c.save();
    // inHg scale (black on white), ticks each 0.02, labels each 0.1.
    for (let i = Math.round(KOLLSMAN_MIN_INHG * 100); i <= Math.round(KOLLSMAN_MAX_INHG * 100); i += 2) {
      const x = i / 100;
      const a = this.inHgAt(x);
      f.tick(a, 0.72, i % 10 === 0 ? 0.64 : 0.68, 0.008, DIAL_BLACK);
      // Printed so they read upright when they reach the 3 o'clock window.
      if (i % 10 === 0) f.label(x.toFixed(1), a, 0.58, 0.07, DIAL_BLACK, true, -90);
    }
    // mb scale 180 deg away: each 1 mb tick, labels each 10.
    for (let mb = 946; mb <= 1050; mb++) {
      const a = this.inHgAt(mb / HPA_PER_INHG) + 180;
      f.tick(a, 0.72, mb % 10 === 0 ? 0.64 : 0.68, 0.006, DIAL_BLACK);
      if (mb % 10 === 0) f.label(String(mb), a, 0.58, 0.065, DIAL_BLACK, true, 90);
    }
    c.restore();
  }

  private paintDial(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    // 20-ft ticks, 100-ft majors, digits 0-9.
    f.ticks(0, 980, 20, (v) => (v / 1000) * 360, 0.86, 0.95, 0.011);
    f.ticks(0, 900, 100, (v) => (v / 1000) * 360, 0.78, 0.95, 0.024);
    for (let i = 0; i < 10; i++) f.label(String(i), i * 36, 0.66, 0.17);
    f.text('ALT', 0, 0.36, 0.1);
    f.text('100 FEET', 0, -0.36, 0.07);
    // Kollsman windows (3 and 9 o'clock) with a white index line.
    f.sectorWindow(80, 100, 0.47, 0.73);
    f.sectorWindow(260, 280, 0.47, 0.73);
    f.tick(90, 0.46, 0.49, 0.012, DIAL_WHITE);
    f.tick(270, 0.46, 0.49, 0.012, DIAL_WHITE);
    f.text('IN HG', 0.6, -0.24, 0.055);
    f.text('MB', -0.6, -0.24, 0.055);
  }
}
