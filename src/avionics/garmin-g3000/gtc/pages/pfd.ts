/**
 * PFD control screens (G3000 PG 190-02046-01 §2 "Flight Instruments", PFD
 * Home buttons; Longitude OG 4-9 "PFD Garmin Touch Controller"):
 * Speed Bugs (V-speed values and flags, N1 target on the G5000), Timers,
 * Minimums (BARO / TEMP COMP / RA), Sensors (ADC / AHRS), PFD Settings and
 * PFD Map Settings.
 */
import type { Rect } from '../../../common/draw/context';
import { box } from '../../../common/draw/context';
import { fmtFixed, fmtInt } from '../../../common/format';
import { fmtHms, join2 } from '../../format';
import { G3K_PALETTE, TF } from '../../gdu/style';
import { AOA_MODE, G3K, MINS_MODE, PFD_MAP, WIND_OPTION, vn } from '../../vars';
import type { GtcController } from '../GtcController';
import { GtcPage, type BarButton } from '../GtcPage';
import { GTC_COLORS, type ButtonOptions } from '../ui';
import { NumericKeypadPage } from './keypads';

const P = G3K_PALETTE;

export class SpeedBugsPage extends GtcPage {
  readonly title = 'Speed Bugs';
  private first = 0;
  private readonly bar: BarButton[] = [
    { label: 'Up', icon: 'up', press: () => this.scroll(-1) },
    { label: 'Down', icon: 'down', press: () => this.scroll(1) },
  ];
  private scroll(n: number): void {
    this.first = Math.max(0, Math.min(Math.max(0, this.sys.vspeeds.defs.length - 4), this.first + n));
    this.invalidate();
    this.gtc.revision++;
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const vb = this.sys.vspeeds;
    const defs = vb.defs;
    const g5k = this.sys.cfg.variant === 'g5000';
    const rowH = Math.min(78, (r.h - 90) / 5);
    const rows = Math.max(1, Math.floor((r.h - 90) / rowH));
    const w = r.w - 20;
    for (let k = 0; k < rows && this.first + k < defs.length; k++) {
      const d = defs[this.first + k];
      const y = r.y + 6 + k * rowH;
      this.text(r.x + 20, y + rowH / 2, d.id, 22, P.white);
      this.button(r.x + w * 0.3, y + 4, w * 0.36, rowH - 8, {
        label: () => {
          const kt = vb.value(d.id);
          return Number.isFinite(kt) ? join2(fmtInt(kt), 'KT') : '___KT';
        },
        size: 22,
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: join2(d.id, ' Speed'),
              maxDigits: 3,
              unit: 'KT',
              onEnter: (b) => {
                const kt = Number(b);
                if (!(kt >= 40 && kt <= 400)) return false;
                vb.set(d.id, kt, 'pilot');
                return true;
              },
            }),
          ),
      });
      this.button(r.x + w * 0.7, y + 4, w * 0.3, rowH - 8, {
        label: () => (vb.on(d.id) ? 'On' : 'Off'),
        annun: () => vb.on(d.id),
        disabled: () => !Number.isFinite(vb.value(d.id)),
        onPress: () => vb.toggle(d.id),
      });
    }
    if (!defs.length) this.text(r.x + r.w / 2, r.y + 60, 'No V-speeds configured', 18, P.white, 'center');
    const b = { x: r.x, y: r.y + r.h - 84, w: r.w, h: 84 };
    const cells: ButtonOptions[] = [
      { label: 'Takeoff On', annun: () => defs.some((d) => d.group === 'takeoff' && vb.on(d.id)), onPress: () => vb.setGroup('takeoff', !defs.some((d) => d.group === 'takeoff' && vb.on(d.id))) },
      { label: 'Landing On', annun: () => defs.some((d) => d.group === 'landing' && vb.on(d.id)), onPress: () => vb.setGroup('landing', !defs.some((d) => d.group === 'landing' && vb.on(d.id))) },
      { label: 'Restore Defaults', onPress: () => vb.restoreDefaults() },
    ];
    if (g5k)
      cells.push({
        label: 'N1 Target',
        value: () => {
          const n = this.sys.vars.get(G3K.n1Target);
          return Number.isFinite(n) ? join2(fmtFixed(n, 1), '%') : 'Off';
        },
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'N1 Target',
              maxDigits: 3,
              decimal: true,
              unit: '%',
              onEnter: (bf) => {
                if (!bf) {
                  this.sys.setVar(G3K.n1Target, NaN);
                  return true;
                }
                const n = Number(bf);
                if (!(n >= 20 && n <= 110)) return false;
                this.sys.setVar(G3K.n1Target, n);
                return true;
              },
            }),
          ),
      });
    this.grid(b, cells.length, 1, cells, 6);
  }
  override barButtons(): readonly BarButton[] | null {
    return this.sys.vspeeds.defs.length > 4 ? this.bar : null;
  }
}

export class TimersPage extends GtcPage {
  readonly title = 'Timers';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const t = this.sys.timer;
    const v = this.sys.vars;
    this.custom(r.x + 10, r.y + 6, r.w - 20, 90, (ctx, rr) => {
      box(ctx, rr.x, rr.y, rr.w, rr.h, '#000000', GTC_COLORS.buttonEdge, 1.5, 4);
      TF.draw(ctx, fmtHms(t.seconds, true), rr.x + rr.w / 2, rr.y + rr.h / 2, 44, t.running ? P.white : P.cyan, 'center', 'middle');
    });
    const cells: ButtonOptions[] = [
      { label: () => (t.countingDown ? 'Down' : 'Up'), value: 'Direction', onPress: () => t.setDirection(!t.countingDown) },
      {
        label: 'Preset',
        value: () => fmtHms(v.get(G3K.timerPreset), true),
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'Timer Preset',
              maxDigits: 6,
              format: (b) => {
                const d = b.padStart(6, '_');
                return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`;
              },
              onEnter: (b) => {
                const d = b.padStart(6, '0');
                const s = Number(d.slice(0, 2)) * 3600 + Number(d.slice(2, 4)) * 60 + Number(d.slice(4, 6));
                if (!Number.isFinite(s)) return false;
                t.setPreset(s);
                t.setDirection(true);
                return true;
              },
            }),
          ),
      },
      { label: () => (t.running ? 'Stop' : 'Start'), annun: () => t.running, onPress: () => t.toggle() },
      { label: 'Reset', onPress: () => t.reset() },
    ];
    this.grid({ x: r.x, y: r.y + 104, w: r.w, h: Math.min(260, r.h - 110) }, 2, 2, cells, 10);
  }
}

export class MinimumsPage extends GtcPage {
  readonly title = 'Minimums';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const m = this.sys.mins;
    const src = (mode: number, label: string): ButtonOptions => ({ label, selected: () => m.mode === mode, annun: () => m.mode === mode, onPress: () => m.set(mode) });
    const cells: ButtonOptions[] = [src(MINS_MODE.off, 'Off'), src(MINS_MODE.baro, 'Baro'), src(MINS_MODE.tempComp, 'Temp Comp')];
    if (this.sys.cfg.sensors.radioAltimeter) cells.push(src(MINS_MODE.radio, 'Radio Alt'));
    this.grid({ x: r.x, y: r.y, w: r.w, h: 110 }, cells.length, 1, cells, 8);
    this.grid({ x: r.x, y: r.y + 120, w: r.w, h: 130 }, 2, 1, [
      {
        label: 'Minimums',
        value: () => join2(fmtInt(m.valueFt), 'FT'),
        size: 20,
        disabled: () => m.mode === MINS_MODE.off,
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'Minimums',
              maxDigits: 5,
              unit: 'FT',
              onEnter: (b) => {
                const ft = Number(b);
                if (!b || !(ft >= 0 && ft <= 16000)) return false;
                m.set(m.mode, ft);
                return true;
              },
            }),
          ),
      },
      {
        label: 'Temperature',
        value: () => join2(fmtInt(this.sys.vars.get(G3K.minsTempC, 15)), '°C'),
        disabled: () => m.mode !== MINS_MODE.tempComp,
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'Destination Temperature',
              maxDigits: 2,
              sign: true,
              unit: '°C',
              onEnter: (b) => {
                const c = Number(b);
                if (!b || !Number.isFinite(c)) return false;
                m.setTemp(c);
                return true;
              },
            }),
          ),
      },
    ], 8);
    this.custom(r.x, r.y + 260, r.w, 60, (ctx) => {
      const eff = m.effectiveFt();
      if (m.mode === MINS_MODE.tempComp && Number.isFinite(eff)) TF.draw(ctx, join2('Corrected: ', join2(fmtInt(eff), ' FT')), r.x + r.w / 2, r.y + 290, 19, P.cyan, 'center', 'middle');
    });
  }
}

export class SensorsPage extends GtcPage {
  readonly title = 'Sensors';
  protected build(r: Rect): void {
    const sys = this.sys;
    const s = this.gtc.g.side;
    const cells: ButtonOptions[] = [];
    for (let i = 1; i <= sys.cfg.sensors.adc; i++) cells.push({ label: join2('ADC', fmtInt(i)), selected: () => sys.vars.get(vn(G3K.adcSel, s), s) === i, annun: () => sys.vars.get(vn(G3K.adcSel, s), s) === i, onPress: () => sys.setSensor(s, 'adc', i) });
    for (let i = 1; i <= sys.cfg.sensors.ahrs; i++) cells.push({ label: join2('AHRS', fmtInt(i)), selected: () => sys.vars.get(vn(G3K.ahrsSel, s), s) === i, annun: () => sys.vars.get(vn(G3K.ahrsSel, s), s) === i, onPress: () => sys.setSensor(s, 'ahrs', i) });
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 240) }, Math.max(sys.cfg.sensors.adc, sys.cfg.sensors.ahrs), 2, cells, 10);
  }
}

const WIND_LBL = ['Off', 'Option 1', 'Option 2', 'Option 3'];
const AOA_LBL = ['Auto', 'On', 'Off'];

export class PfdSettingsPage extends GtcPage {
  readonly title = 'PFD Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const s = this.gtc.g.side;
    const g5k = sys.cfg.variant === 'g5000';
    const toggle = (label: string, name: string): ButtonOptions => ({ label, value: () => (v.get(name) >= 0.5 ? 'On' : 'Off'), annun: () => v.get(name) >= 0.5, onPress: () => sys.toggleVar(name) });
    const cells: ButtonOptions[] = [
      { label: 'Wind', value: () => WIND_LBL[v.get(vn(G3K.windOption, s)) | 0] ?? 'Off', onPress: () => sys.cycleVar(vn(G3K.windOption, s), [WIND_OPTION.off, WIND_OPTION.arrowSpeed, WIND_OPTION.arrowDirSpeed, WIND_OPTION.headXwind]) },
      { label: 'AOA', value: () => AOA_LBL[v.get(vn(G3K.aoaMode, s)) | 0] ?? 'Auto', onPress: () => sys.cycleVar(vn(G3K.aoaMode, s), [AOA_MODE.auto, AOA_MODE.on, AOA_MODE.off]) },
      { label: 'Baro Units', value: () => (v.get(vn(G3K.baroHpa, s)) >= 0.5 ? 'HPA' : 'IN'), onPress: () => sys.toggleVar(vn(G3K.baroHpa, s)) },
      toggle('Altitude Meters', vn(G3K.metersOverlay, s)),
      toggle('DME Window', vn(G3K.dmeWindow, s)),
      toggle('SVT', vn(G3K.svt, s)),
      toggle('Horizon Heading', vn(G3K.horizonHeading, s)),
      g5k ? { label: 'FD Format', value: () => (v.get(vn(G3K.fdFormat, s)) >= 0.5 ? 'Cross Ptr' : 'Single Cue'), onPress: () => sys.toggleVar(vn(G3K.fdFormat, s)) } : toggle('Baro Sync', G3K.baroSync),
      { label: 'Nav Angle', value: () => (v.get(G3K.navAngleTrue) >= 0.5 ? 'True' : 'Magnetic'), onPress: () => sys.toggleVar(G3K.navAngleTrue) },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 3 : 2, horizontal ? 3 : 5, cells, 8);
  }
}

const LAYOUT_LBL = ['Off', 'Inset', 'HSI Map'];
const ORIENT_LBL: Record<string, string> = { 'heading-up': 'Heading Up', 'track-up': 'Track Up', 'north-up': 'North Up' };
const TERRAIN_LBL: Record<string, string> = { off: 'Off', topo: 'Absolute', relative: 'Relative' };
const DETAIL_LBL = ['All', 'DCLTR 1', 'DCLTR 2', 'Least'];

/** Map settings shared by the PFD map and the MFD panes. */
export function mapSettingCells(gtc: GtcController, key: 'inset1' | 'inset2' | 'pfd1' | 'mfd1' | 'mfd2' | 'pfd2'): ButtonOptions[] {
  const sys = gtc.sys;
  const set = sys.maps[key];
  const bump = (): void => {
    sys.revision++;
  };
  const tog = (label: string, k: 'traffic' | 'airports' | 'navaids' | 'fixes' | 'trackVector' | 'rangeRings' | 'weather'): ButtonOptions => ({
    label,
    annun: () => set[k],
    onPress: () => {
      set[k] = !set[k];
      bump();
    },
  });
  return [
    {
      label: 'Orientation',
      value: () => ORIENT_LBL[set.orientation],
      onPress: () => {
        set.orientation = set.orientation === 'heading-up' ? 'track-up' : set.orientation === 'track-up' ? 'north-up' : 'heading-up';
        bump();
      },
    },
    {
      label: 'Terrain',
      value: () => TERRAIN_LBL[set.terrain],
      onPress: () => {
        set.terrain = set.terrain === 'off' ? 'relative' : set.terrain === 'relative' ? 'topo' : 'off';
        bump();
      },
    },
    {
      label: 'Detail',
      value: () => DETAIL_LBL[set.detail],
      onPress: () => {
        set.detail = ((set.detail + 1) % 4) as 0 | 1 | 2 | 3;
        bump();
      },
    },
    tog('Traffic', 'traffic'),
    tog('Airports', 'airports'),
    tog('VOR / NDB', 'navaids'),
    tog('Intersections', 'fixes'),
    tog('Range Rings', 'rangeRings'),
    tog('Track Vector', 'trackVector'),
  ];
}

export class PfdMapSettingsPage extends GtcPage {
  readonly title = 'PFD Map Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const s = this.gtc.g.side;
    const cells: ButtonOptions[] = [
      { label: 'Map Layout', value: () => LAYOUT_LBL[v.get(vn(G3K.pfdMap, s)) | 0] ?? 'Off', onPress: () => sys.cycleVar(vn(G3K.pfdMap, s), [PFD_MAP.off, PFD_MAP.inset, PFD_MAP.hsiMap]) },
      { label: 'Range -', onPress: () => sys.pfdRangeStep(s, -1) },
      { label: 'Range +', onPress: () => sys.pfdRangeStep(s, 1) },
      ...mapSettingCells(this.gtc, s === 1 ? 'inset1' : 'inset2'),
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 4 : 3, horizontal ? 3 : 4, cells, 8);
  }
}
