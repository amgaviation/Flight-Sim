/**
 * GDU bezel softkeys (12 keys below each GDU; G3000 PG 190-02046-01 §1.3
 * "PFD Softkeys", Table "Level 1 .. Level 4"). Three kinds: on/off keys with a
 * green / grey annunciator, option keys whose label shows the choice, and
 * keys that open a sub-level with a Back key. Sub-levels revert to the top
 * level after 45 s of inactivity. Subdued keys are unavailable.
 */
import { ADC } from '../../../core/vars';
import type { G3000System } from '../state/System';
import { AOA_MODE, BRG_SOURCE, G3K, NAV_SOURCE, PFD_MAP, WIND_OPTION, vn } from '../vars';

export interface SoftkeyDef {
  label: string | (() => string);
  /** Small second line (option value) in cyan. */
  status?: () => string;
  /** Annunciator: true green, false grey, undefined none. */
  annun?: () => boolean | undefined;
  disabled?: () => boolean;
  press?: () => void;
  /** Opens a sub-menu. */
  menu?: string;
  /** Back key. */
  back?: boolean;
}

export type SoftkeyMenu = (SoftkeyDef | null)[];

/** Inactivity revert (PG §1.3: "these softkeys revert to the previous level after 45 seconds of inactivity"). */
export const SOFTKEY_REVERT_S = 45;

export class SoftkeyController {
  private stack: string[] = ['top'];
  private idle = 0;
  /** Seconds each key stays highlighted after a press. */
  readonly flash = new Float32Array(12);

  constructor(readonly menus: Record<string, SoftkeyMenu>) {}

  get level(): string {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length - 1;
  }

  keys(): SoftkeyMenu {
    return this.menus[this.level] ?? this.menus.top;
  }

  press(i: number): void {
    const k = this.keys()[i];
    this.idle = 0;
    if (i >= 0 && i < 12) this.flash[i] = 0.15;
    if (!k || k.disabled?.()) return;
    if (k.back) {
      if (this.stack.length > 1) this.stack.pop();
      return;
    }
    if (k.menu && this.menus[k.menu]) {
      this.stack.push(k.menu);
      return;
    }
    k.press?.();
  }

  reset(): void {
    this.stack = ['top'];
  }

  update(dt: number): void {
    for (let i = 0; i < 12; i++) if (this.flash[i] > 0) this.flash[i] -= dt;
    if (this.stack.length > 1) {
      this.idle += dt;
      if (this.idle >= SOFTKEY_REVERT_S) this.reset();
    } else this.idle = 0;
  }
}

const back: SoftkeyDef = { label: 'Back', back: true };

function fill(keys: (SoftkeyDef | null)[]): SoftkeyMenu {
  const out: SoftkeyMenu = [];
  for (let i = 0; i < 12; i++) out.push(keys[i] ?? null);
  return out;
}

const NAV_NAMES = ['FMS', 'NAV1', 'NAV2'];
const BRG_NAMES = ['OFF', 'NAV1', 'NAV2', 'FMS', 'ADF'];
const WIND_NAMES = ['Off', 'Opt 1', 'Opt 2', 'Opt 3'];
const AOA_NAMES = ['Auto', 'On', 'Off'];
const DETAIL_NAMES = ['All', 'DCLTR 1', 'DCLTR 2', 'Least'];

/**
 * PFD softkey tree for one side. `casOnThisDisplay` adds CAS UP / DN keys
 * (G5000 PFD with CAS, CRG 190-02538-02 "CAS UP/CAS Dn Softkeys").
 */
export function pfdMenus(sys: G3000System, side: number, hooks: { casScroll(rows: number): void; casOnThisDisplay: () => boolean }): Record<string, SoftkeyMenu> {
  const v = sys.vars;
  const map = sys.maps[side === 1 ? 'inset1' : 'inset2'];
  const inAir = () => v.get('gear.air_ground', 1) < 0.5;
  const split = () => v.get(vn(G3K.pfdSplit, side)) >= 0.5;
  const top = fill([
    { label: 'Map Range -', press: () => sys.pfdRangeStep(side, -1), disabled: () => v.get(vn(G3K.pfdMap, side)) === PFD_MAP.off || split() },
    { label: 'Map Range +', press: () => sys.pfdRangeStep(side, 1), disabled: () => v.get(vn(G3K.pfdMap, side)) === PFD_MAP.off || split() },
    { label: 'PFD Map Settings', menu: 'mapSettings', disabled: split },
    { label: 'Traffic Inset', annun: () => v.get(vn(G3K.pfdTrafficInset, side)) >= 0.5, press: () => sys.toggleVar(vn(G3K.pfdTrafficInset, side)), disabled: split },
    { label: 'PFD Settings', menu: 'pfdSettings' },
    {
      label: () => (v.get('fms.suspended') >= 0.5 && sys.navSource(side) === NAV_SOURCE.fms ? 'SUSP' : 'OBS'),
      annun: () => v.get(vn(G3K.obs, side)) >= 0.5 || (v.get('fms.suspended') >= 0.5 && sys.navSource(side) === NAV_SOURCE.fms),
      press: () => sys.toggleObs(side),
      disabled: () => sys.navSource(side) !== NAV_SOURCE.fms || v.get('fms.active_leg', -1) < 0,
    },
    { label: 'Active NAV', status: () => NAV_NAMES[sys.navSource(side)] ?? 'FMS', press: () => sys.cycleNavSource(side) },
    { label: 'Sensors', menu: 'sensors' },
    { label: 'WX Radar Controls', menu: 'wx' },
    null,
    { label: 'CAS Up', press: () => hooks.casScroll(-1), disabled: () => !hooks.casOnThisDisplay() },
    { label: 'CAS Dn', press: () => hooks.casScroll(1), disabled: () => !hooks.casOnThisDisplay() },
  ]);
  const mapSettings = fill([
    { label: 'Map Layout', menu: 'mapLayout' },
    { label: 'Detail', status: () => DETAIL_NAMES[map.detail], press: () => ((map.detail = ((map.detail + 1) % 4) as 0 | 1 | 2 | 3), sys.revision++) },
    { label: 'Weather Legend', annun: () => false, disabled: () => true },
    { label: 'Traffic', annun: () => map.traffic, press: () => ((map.traffic = !map.traffic), sys.revision++) },
    { label: 'Storm-scope', annun: () => false, disabled: () => true },
    {
      label: 'Terrain',
      status: () => (map.terrain === 'off' ? 'Off' : map.terrain === 'topo' ? 'Absolute' : 'Relative'),
      press: () => ((map.terrain = map.terrain === 'off' ? 'topo' : map.terrain === 'topo' ? 'relative' : 'off'), sys.revision++),
    },
    { label: 'Datalink Settings', disabled: () => true },
    { label: 'WX Overlay', status: () => (map.weather ? 'WX Radar' : 'Off'), press: () => ((map.weather = !map.weather), sys.revision++) },
    null,
    null,
    null,
    back,
  ]);
  const mapLayout = fill([
    { label: 'Map Off', annun: () => v.get(vn(G3K.pfdMap, side)) === PFD_MAP.off, press: () => sys.setVar(vn(G3K.pfdMap, side), PFD_MAP.off) },
    { label: 'Inset Map', annun: () => v.get(vn(G3K.pfdMap, side)) === PFD_MAP.inset, press: () => sys.setVar(vn(G3K.pfdMap, side), PFD_MAP.inset) },
    { label: 'HSI Map', annun: () => v.get(vn(G3K.pfdMap, side)) === PFD_MAP.hsiMap, press: () => sys.setVar(vn(G3K.pfdMap, side), PFD_MAP.hsiMap) },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    back,
  ]);
  const pfdSettings = fill([
    { label: 'Attitude Overlays', menu: 'svt' },
    { label: 'PFD Mode', status: () => (split() ? 'SPLIT' : 'FULL'), press: () => sys.setPfdSplit(side, !split()) },
    { label: 'Bearing 1', status: () => BRG_NAMES[v.get(vn(G3K.brg1Source, side))] ?? 'OFF', press: () => sys.cycleBearing(side, 1) },
    { label: 'Bearing 2', status: () => BRG_NAMES[v.get(vn(G3K.brg2Source, side))] ?? 'OFF', press: () => sys.cycleBearing(side, 2) },
    { label: 'Other PFD Settings', menu: 'other' },
    null,
    null,
    null,
    null,
    null,
    null,
    back,
  ]);
  const svt = fill([
    { label: 'Pathways', annun: () => false, disabled: () => v.get(vn(G3K.svt, side)) < 0.5 },
    { label: 'Synthetic Terrain', annun: () => v.get(vn(G3K.svt, side)) >= 0.5, press: () => sys.toggleVar(vn(G3K.svt, side)) },
    { label: 'Horizon Heading', annun: () => v.get(vn(G3K.horizonHeading, side)) >= 0.5, press: () => sys.toggleVar(vn(G3K.horizonHeading, side)) },
    { label: 'Airport Signs', annun: () => false, disabled: () => v.get(vn(G3K.svt, side)) < 0.5 },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    back,
  ]);
  const other = fill([
    { label: 'Wind', menu: 'wind' },
    {
      label: 'AOA',
      status: () => AOA_NAMES[v.get(vn(G3K.aoaMode, side))] ?? 'Auto',
      press: () => sys.cycleVar(vn(G3K.aoaMode, side), [AOA_MODE.auto, AOA_MODE.on, AOA_MODE.off]),
    },
    { label: 'Altitude Units', menu: 'altUnits' },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { label: 'COM1 121.5', press: () => sys.com121(1) },
    back,
  ]);
  const windKey = (opt: number, label: string): SoftkeyDef => ({ label, annun: () => v.get(vn(G3K.windOption, side)) === opt, press: () => sys.setVar(vn(G3K.windOption, side), opt) });
  const wind = fill([
    windKey(WIND_OPTION.arrowSpeed, 'Option 1'),
    windKey(WIND_OPTION.arrowDirSpeed, 'Option 2'),
    windKey(WIND_OPTION.headXwind, 'Option 3'),
    windKey(WIND_OPTION.off, 'Off'),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    back,
  ]);
  const altUnits = fill([
    { label: 'Meters', annun: () => v.get(vn(G3K.metersOverlay, side)) >= 0.5, press: () => sys.toggleVar(vn(G3K.metersOverlay, side)) },
    { label: 'IN', annun: () => v.get(vn(G3K.baroHpa, side)) < 0.5, press: () => sys.setVar(vn(G3K.baroHpa, side), 0) },
    { label: 'HPA', annun: () => v.get(vn(G3K.baroHpa, side)) >= 0.5, press: () => sys.setVar(vn(G3K.baroHpa, side), 1) },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    back,
  ]);
  const sensors = fill([{ label: 'ADC Settings', menu: 'adc' }, { label: 'AHRS Settings', menu: 'ahrs' }, null, null, null, null, null, null, null, null, null, back]);
  const sensorKey = (kind: 'adc' | 'ahrs', i: number): SoftkeyDef => ({
    label: `${kind.toUpperCase()} ${i}`,
    annun: () => v.get(kind === 'adc' ? vn(G3K.adcSel, side) : vn(G3K.ahrsSel, side)) === i,
    press: () => sys.setSensor(side, kind, i),
    disabled: () => i > (kind === 'adc' ? sys.cfg.sensors.adc : sys.cfg.sensors.ahrs),
  });
  const adc = fill([sensorKey('adc', 1), sensorKey('adc', 2), null, null, null, null, null, null, null, null, null, back]);
  const ahrs = fill([sensorKey('ahrs', 1), sensorKey('ahrs', 2), null, null, null, null, null, null, null, null, null, back]);
  const r = sys.radar;
  const wx = fill([
    { label: 'Radar On', annun: () => r.on, press: () => ((r.on = !r.on), (r.mode = 'STBY'), sys.revision++) },
    { label: 'Mode', status: () => (r.mode === 'STBY' ? 'Standby' : r.mode === 'WX' ? 'Weather' : 'Ground'), press: () => ((r.mode = r.mode === 'STBY' ? 'WX' : r.mode === 'WX' ? 'GND' : 'STBY'), sys.revision++), disabled: () => !r.on || !inAir() },
    { label: 'Bearing Left', press: () => (r.bearingDeg = Math.max(-60, r.bearingDeg - 1)), disabled: () => !r.on },
    { label: 'Bearing Right', press: () => (r.bearingDeg = Math.min(60, r.bearingDeg + 1)), disabled: () => !r.on },
    { label: 'Tilt Down', press: () => (r.tiltDeg = Math.max(-15, r.tiltDeg - 0.25)), disabled: () => !r.on },
    { label: 'Tilt Up', press: () => (r.tiltDeg = Math.min(15, r.tiltDeg + 0.25)), disabled: () => !r.on },
    { label: 'Gain -', press: () => (r.gain = Math.max(-8, r.gain - 0.5)), disabled: () => !r.on },
    { label: 'Gain +', press: () => (r.gain = Math.min(8, r.gain + 0.5)), disabled: () => !r.on },
    null,
    null,
    null,
    back,
  ]);
  void ADC;
  void BRG_SOURCE;
  return { top, mapSettings, mapLayout, pfdSettings, svt, other, wind, altUnits, sensors, adc, ahrs, wx };
}

/** MFD softkeys: CAS scroll under the EIS (G5000 CRG EICAS figure) and the splash acknowledgement (PG §1.2). */
export function mfdMenus(sys: G3000System, hooks: { casScroll(rows: number): void; casOnMfd: boolean; casScrollable?: () => boolean }): Record<string, SoftkeyMenu> {
  const splash = () => sys.vars.get(G3K.mfdSplashAck) < 0.5;
  // PG §3.3: the CAS scrolling softkeys appear once more messages exist than the window shows.
  const can = hooks.casScrollable ?? (() => true);
  const top = fill([
    hooks.casOnMfd ? { label: () => (can() ? 'CAS Up' : ''), press: () => hooks.casScroll(-1), disabled: () => splash() || !can() } : null,
    hooks.casOnMfd ? { label: () => (can() ? 'CAS Dn' : ''), press: () => hooks.casScroll(1), disabled: () => splash() || !can() } : null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { label: () => (splash() ? 'Continue' : ''), press: () => sys.setVar(G3K.mfdSplashAck, 1), disabled: () => !splash() },
  ]);
  return { top };
}
