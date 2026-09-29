/**
 * Mechanical (cable-driven) recording tachometer with hour meter.
 *
 * 172S POH Rev 4: §7 "The engine driven mechanical tachometer ... is
 * calibrated in increments of 100 RPM ... An hour meter in the lower
 * section of the dial records elapsed engine time in hours and tenths";
 * Figure 2-3 markings: green arc 2100-2500 RPM at sea level, to 2600 at
 * 5,000 ft and 2700 at 10,000 ft; red line 2700 RPM. The altitude-dependent
 * upper green limits are painted as progressively narrower green segments
 * (EST depiction).
 *
 * The hour meter integrates engine time proportional to RPM (a recording
 * tach registers one hour per hour at its reference speed; EST reference
 * 2400 RPM) and writes the total to `hoursVar` so the aircraft can persist
 * it. Needle: mechanical, no electrical dependency; engine roughness adds a
 * small flicker (EST).
 */
import { ENG } from '../../../core/vars';
import { MARK_GREEN } from '../face';
import { ANALOG_VARS } from '../vars';
import type { AnalogGaugeOptions, DynamicPlane } from '../AnalogGauge';
import { RoundGauge, type RoundScale } from './RoundGauge';

export interface TachometerOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  engine?: number;
  rpmVar?: string;
  hoursVar?: string;
  /** RPM at which the recorder counts one hour per hour. EST 2400. */
  referenceRpm?: number;
  /** Starting tach time if `hoursVar` is unset. */
  initialHours?: number;
  scale?: RoundScale;
}

export const C172S_TACH_SCALE: RoundScale = {
  min: 0,
  max: 3500,
  startDeg: -140,
  endDeg: 140,
  majorStep: 500,
  minorStep: 100,
  labelStep: 500,
  labelDivisor: 100,
  bands: [
    { from: 2100, to: 2500, color: MARK_GREEN, inner: 0.78, outer: 0.88 },
    { from: 2500, to: 2600, color: MARK_GREEN, inner: 0.81, outer: 0.88 },
    { from: 2600, to: 2700, color: MARK_GREEN, inner: 0.84, outer: 0.88 },
  ],
  redlines: [2700],
  captions: ['RPM', 'X100'],
  restValue: 0,
};

export class Tachometer extends RoundGauge {
  private readonly hoursVar: string;
  private readonly refRpm: number;
  private readonly rpmVar: string;
  private readonly roughVar: string;
  private readonly meter: DynamicPlane;
  private shownTenth = -1;
  private flickerT = 0;

  constructor(o: TachometerOptions) {
    const e = o.engine ?? 1;
    const rpmVar = o.rpmVar ?? ENG.rpm(e);
    super({
      name: 'Tachometer',
      unit: 'RPM',
      ...o,
      scale: o.scale ?? C172S_TACH_SCALE,
      inputVar: rpmVar,
      windows: true,
      dynamics: { omega: 10, zeta: 0.65 },
      paint: (f) => {
        f.window(0, -0.52, 0.62, 0.17); // hour meter window
        f.text('HOURS', 0, -0.72, 0.07);
      },
    });
    this.rpmVar = rpmVar;
    this.roughVar = ENG.roughness(e);
    this.hoursVar = o.hoursVar ?? ANALOG_VARS.tachHours;
    this.refRpm = o.referenceRpm ?? 2400;
    if (!this.vars.has(this.hoursVar)) this.vars.set(this.hoursVar, o.initialHours ?? 0);
    const R = this.dialR;
    this.meter = this.addDynamicPlane(256, 64, R * 0.7, R * 0.175, 0, -0.52 * R, -0.002);
  }

  /** Accumulated tach time (h). */
  get hours(): number {
    return this.vars.get(this.hoursVar);
  }

  protected override readInput(): number {
    const rpm = Math.max(0, this.vars.get(this.rpmVar));
    // Roughness flicker (EST +/-15 rpm at full roughness).
    return rpm + Math.sin(this.flickerT * 37) * 15 * this.vars.get(this.roughVar);
  }

  protected override updateGauge(dt: number): void {
    this.flickerT += dt;
    const rpm = Math.max(0, this.vars.get(this.rpmVar));
    if (rpm > 0 && dt > 0) this.vars.set(this.hoursVar, this.vars.get(this.hoursVar) + ((dt / 3600) * rpm) / this.refRpm);
    super.updateGauge(dt);
    const h = this.vars.get(this.hoursVar);
    const tenths = Math.floor(h * 10 * 20) / 20; // redraw every 0.05 of a tenth (rolling last drum)
    if (tenths !== this.shownTenth) {
      this.shownTenth = tenths;
      this.drawMeter(h);
    }
  }

  private drawMeter(h: number): void {
    const { ctx, canvas } = this.meter;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, W, H);
    const digits = 5;
    const cw = W / (digits + 1);
    ctx.font = `bold ${Math.round(H * 0.72)}px "DejaVu Sans Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const whole = Math.floor(h);
    for (let i = 0; i < digits; i++) {
      const d = Math.floor(whole / 10 ** (digits - 1 - i)) % 10;
      ctx.fillStyle = '#e8e8e2';
      ctx.fillText(String(d), cw * (i + 0.5), H / 2);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(cw * (i + 1) - 1, 0, 2, H);
    }
    // Tenths drum (white on red, rolling).
    const t = (h * 10) % 10;
    const d0 = Math.floor(t);
    const frac = t - d0;
    const x = cw * (digits + 0.5);
    ctx.fillStyle = '#b01e14';
    ctx.fillRect(cw * digits, 0, cw, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(d0), x, H / 2 - frac * H * 0.9);
    ctx.fillText(String((d0 + 1) % 10), x, H / 2 + (1 - frac) * H * 0.9);
    this.meter.commit();
  }

  override tooltip(): string {
    return `Tachometer: ${Math.round(this.value / 10) * 10} RPM · ${this.hours.toFixed(1)} h`;
  }
}

