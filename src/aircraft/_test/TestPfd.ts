/**
 * Basic PFD for the development test jet, assembled from the avionics-common
 * glass primitives with the Garmin presets (1024 x 768 logical, G1000-like
 * layout): attitude, speed tape, altitude tape with baro box, VSI, HSI with
 * the VOR1/LOC1 needle, an engine strip (N1/ITT/fuel flow) and a status line
 * (gear, flaps, trim, parking brake, FADEC mode).
 *
 * Reads sensor vars only (adc1, ahrs1, nav1), plus system vars for the
 * engine strip and status line, never FDM truth.
 */
import { ADC, AP, ENG, NAV, SURF } from '../../core/vars';
import type { SimVars } from '../../core/SimVars';
import {
  ADI_GARMIN,
  ALT_TAPE_GARMIN,
  AltitudeAlerter,
  ALT_ALERT_GARMIN,
  AltitudeTape,
  AttitudeIndicator,
  CanvasDisplay,
  GARMIN_PALETTE,
  GARMIN_TYPEFACE,
  HSI_GARMIN,
  Hsi,
  SPEED_TAPE_GARMIN,
  SpeedTape,
  VSI_GARMIN_4000,
  VerticalSpeedIndicator,
  fmtFixed,
  fmtInt,
  type Ctx2D,
} from '../../avionics/common';
import type { AudioApi } from '../../core/SimContext';
import { TEST_JET } from '../../physics/testAircraft';
import { DEMO_VARS } from '../../cockpit/demo/DemoPanel';

const W = 1024;
const H = 768;

export class TestPfd extends CanvasDisplay {
  private readonly adi = new AttitudeIndicator({ rect: { x: 0, y: 0, w: W, h: 560 }, cx: 512, cy: 280, style: ADI_GARMIN });
  private readonly spd = new SpeedTape({ x: 150, y: 90, w: 110, h: 380, style: SPEED_TAPE_GARMIN });
  private readonly alt = new AltitudeTape({ x: 740, y: 90, w: 120, h: 380, style: ALT_TAPE_GARMIN });
  private readonly vsi = new VerticalSpeedIndicator({ x: 866, y: 110, w: 56, h: 340, style: VSI_GARMIN_4000 });
  private readonly hsi = new Hsi({ cx: 512, cy: 660, radius: 150, style: HSI_GARMIN, gs: { dx: 190 } });
  private readonly alerter = new AltitudeAlerter(ALT_ALERT_GARMIN);
  private readonly audio: AudioApi | null;

  constructor(vars: SimVars, audio: AudioApi | null) {
    super({ id: 'pfd1', width: W, height: H, vars, refreshHz: 30, bootTimeS: 2 });
    this.audio = audio;
    // Attitude and tapes move continuously in flight: redraw every refresh.
    this.animating = true;
    this.spd.state.maxKt = TEST_JET.limits.vmo_kt;
  }

  protected override update(dt: number): void {
    const v = this.vars!;
    const adcOk = v.get(ADC.valid(1)) >= 0.5;
    const ahrsOk = v.get(ADC.ahrsValid(1)) >= 0.5;
    const a = this.adi.state;
    a.valid = ahrsOk;
    a.pitch = v.get(ADC.pitch(1));
    a.bank = v.get(ADC.bank(1));
    a.slip = v.get(ADC.slip(1));
    a.heading = v.get(ADC.heading(1));
    a.radioAltValid = v.get('ra1.valid') >= 0.5;
    a.radioAltFt = v.get('ra1.alt_ft');
    const s = this.spd.state;
    s.valid = adcOk;
    s.ias = v.get(ADC.ias(1));
    s.mach = v.get(ADC.mach(1));
    const t = this.alt.state;
    t.valid = adcOk;
    t.altFt = v.get(ADC.baroAlt(1));
    t.vsFpm = v.get(ADC.vs(1));
    t.baroInHg = v.get(ADC.baroSetting(1), 29.92);
    t.baroStd = v.get(ADC.baroStd(1)) !== 0;
    t.selectedFt = v.has(AP.selAltitude) ? v.get(AP.selAltitude) : NaN;
    if (Number.isFinite(t.selectedFt)) {
      this.alerter.update(t.altFt, t.selectedFt, dt);
      t.alertPhase = this.alerter.phase;
      t.alertVisible = this.alerter.visible;
      if (this.alerter.consumeAural()) this.audio?.play('alt_alert');
    }
    this.vsi.state.valid = adcOk;
    this.vsi.state.vsFpm = v.get(ADC.vs(1));
    const h = this.hsi.state;
    h.valid = ahrsOk;
    h.heading = v.get(ADC.heading(1));
    h.turnRateDps = v.get(ADC.turnRate(1));
    h.selectedHeading = v.get(DEMO_VARS.hdg);
    h.courseVisible = true;
    const isLoc = v.get(NAV.isLoc(1)) !== 0;
    h.course = isLoc ? v.get(NAV.locCourse(1)) : v.get(DEMO_VARS.crs);
    h.courseColor = GARMIN_PALETTE.green;
    h.cdiValid = v.get(NAV.received(1)) !== 0;
    h.cdi = v.get(NAV.cdi(1));
    h.toFrom = v.get(NAV.toFrom(1));
    h.sourceLabel = isLoc ? 'LOC1' : 'VOR1';
    h.gsVisible = isLoc;
    h.gsValid = v.get(NAV.gsValid(1)) !== 0;
    h.gsDev = v.get(NAV.gsDev(1));
    this.adi.update(dt);
    this.spd.update(dt);
    this.alt.update(dt);
    this.vsi.update(dt);
    this.hsi.update(dt);
  }

  protected draw(ctx: Ctx2D): void {
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    this.vsi.draw(ctx);
    this.hsi.draw(ctx);
    this.drawStrips(ctx);
  }

  protected override drawBoot(ctx: Ctx2D, progress: number): void {
    const tf = GARMIN_TYPEFACE;
    tf.draw(ctx, 'AMG TEST PFD', W / 2, H / 2 - 20, 40, '#ffffff', 'center', 'middle');
    ctx.fillStyle = '#1c7fd6';
    ctx.fillRect(W / 2 - 200, H / 2 + 30, 400 * progress, 10);
  }

  /** Engine rows: label, per-engine var names, decimals (precomputed: no allocation while drawing). */
  private readonly engRows = [
    { label: 'N1 %', vars: [ENG.n1(1), ENG.n1(2)], dec: 1 },
    { label: 'N2 %', vars: [ENG.n2(1), ENG.n2(2)], dec: 1 },
    { label: 'ITT C', vars: [ENG.itt(1), ENG.itt(2)], dec: 0 },
    { label: 'FF PPH', vars: [ENG.fuelFlowPph(1), ENG.fuelFlowPph(2)], dec: 0 },
    { label: 'OIL PSI', vars: [ENG.oilPressPsi(1), ENG.oilPressPsi(2)], dec: 0 },
  ];
  private readonly runVars = [ENG.running(1), ENG.running(2)];

  /** Engine and configuration strips along the bottom corners. */
  private drawStrips(ctx: Ctx2D): void {
    const v = this.vars!;
    const tf = GARMIN_TYPEFACE;
    const pal = GARMIN_PALETTE;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 560, 300, 208);
    ctx.fillRect(724, 560, 300, 208);
    tf.draw(ctx, 'ENG 1', 150, 585, 20, pal.cyan, 'center', 'middle');
    tf.draw(ctx, 'ENG 2', 240, 585, 20, pal.cyan, 'center', 'middle');
    let y = 615;
    for (const row of this.engRows) {
      tf.draw(ctx, row.label, 16, y, 19, pal.white, 'left', 'middle');
      for (let i = 0; i < 2; i++) {
        const x = v.get(row.vars[i]);
        const txt = row.dec === 1 ? fmtFixed(x, 1) : fmtInt(x);
        tf.draw(ctx, txt, 150 + 90 * i, y, 21, v.get(this.runVars[i]) !== 0 ? pal.green : pal.white, 'center', 'middle');
      }
      y += 30;
    }
    // Right strip: configuration.
    const down = v.get('gear.down_locked') !== 0;
    const up = v.get('gear.up_locked') !== 0;
    this.line(ctx, 0, 'GEAR', down ? 'DOWN' : up ? 'UP' : 'TRANSIT', down ? pal.green : up ? pal.white : pal.amber);
    this.line(ctx, 1, 'FLAPS', fmtInt(v.get(SURF.flapsDeg)), pal.white);
    this.line(ctx, 2, 'TRIM', fmtFixed(v.get(DEMO_VARS.trim), 2), v.get('trim.pitch_to_ok') ? pal.green : pal.white);
    const ext = v.get(SURF.spoilerLeft) > 0.05;
    this.line(ctx, 3, 'SPDBRK', ext ? 'EXT' : v.get('spoilers.armed') ? 'ARMED' : 'RET', ext ? pal.amber : pal.white);
    const park = v.get('brakes.parking_set') !== 0;
    this.line(ctx, 4, 'PARK BRK', park ? 'SET' : 'OFF', park ? pal.amber : pal.white);
    const low = v.get('fuel.left_low') !== 0 || v.get('fuel.right_low') !== 0;
    this.line(ctx, 5, 'FUEL KG', fmtInt(v.get('fuel.total_kg')), low ? pal.amber : pal.white);
    tf.draw(ctx, v.getString('fadec.eng1.detent') || 'IDLE', 512, 22, 22, pal.green, 'center', 'middle');
  }

  private line(ctx: Ctx2D, row: number, label: string, value: string, color: string): void {
    const y = 585 + row * 30;
    GARMIN_TYPEFACE.draw(ctx, label, 740, y, 19, GARMIN_PALETTE.white, 'left', 'middle');
    GARMIN_TYPEFACE.draw(ctx, value, 1008, y, 21, color, 'right', 'middle');
  }
}
