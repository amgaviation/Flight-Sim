/**
 * Configuration of a G1000 NXi installation (Cessna NAV III). The aircraft
 * module builds one `G1000Config`, usually by spreading the preset from
 * `presets.ts` and adding its power bindings and var names:
 *
 *   const suite = new G1000Suite(ctx, {
 *     ...C172S_NXI,                       // includes C172S_NXI_POWER (elec.<load>_powered bindings)
 *     checklists: C172S_G1000_CHECKLISTS,
 *   });
 *
 * Every field except `aircraftId` has a default (tests and the preview
 * instantiate the suite with very little). `resolveConfig` fills them once.
 */
import type { Binding } from '../../systems/util/binding';
import type { GaugeScale } from '../common/draw/EngineIndications';
import type { SpeedRange } from '../common/draw/SpeedTape';
import type { CasLevel, CasModel } from '../common/draw/CasWindow';
import type { Checklist } from '../../aircraft/types';
import type { Fms, FmsOptions } from '../../nav/fms/Fms';
import type { Radios, RadiosOptions } from '../../nav/Radios';
import type { G1kUnit } from './vars';

/** Display bezel: GDU 1054B carries the GFC 700 keys and the HDG / ALT knobs; GDU 1050 does not (PG §1.1). */
export type GduModel = 'GDU1054B' | 'GDU1050';

// ------------------------------------------------------------------ EIS

export interface EisBarDef {
  /** Value binding (var name or expression) in the displayed unit. */
  value: Binding;
  scale: GaugeScale;
}

export interface G1kEisConfig {
  /** Tachometer: circular scale 0..3000 RPM (POH 7-30). */
  rpm: EisBarDef & {
    /** Top of the green arc vs pressure altitude (POH 7-30: 2500 SL-5000 ft, 2600 5000-10000 ft, 2700 above). */
    greenTop?: { altFt: number[]; rpm: number[] };
    /** RPM at which pointer/value/label turn red and flash (POH 7-30: 2780). */
    redAt: number;
  };
  fuelFlow: EisBarDef;
  oilPress: EisBarDef;
  oilTemp: EisBarDef;
  /** EGT per cylinder (deg F). The ENGINE strip shows the hottest (pointer carries its number, POH 7-33). */
  egt: { cylinders: Binding[]; min: number; max: number };
  /** CHT per cylinder (deg F), Lean page (POH 7-33: 100..500 F, red line 500). */
  cht: { cylinders: Binding[]; min: number; max: number; redline: number };
  /** Standby vacuum (inHg) or null when not installed (PG 190-02177-02 Figure 3-3 shows VAC on the 172S). */
  vacuum: EisBarDef | null;
  /** Fuel quantity per tank in gallons (L, R) and the indicator scale. */
  fuelQty: {
    left: Binding;
    right: Binding;
    scale: GaugeScale;
    /** Float travel limit: the indicator stops here ("approximately 24 gallons", POH 7-38). */
    indicatorMaxGal: number;
    /** LOW FUEL L/R below this many gallons for `lowDelayS` (POH 7-38: 5 gal, 60 s). */
    lowGal: number;
    lowDelayS: number;
  };
  /** Engine hours readout (ENG HRS). Default: the suite's own meter (counts while oil pressure > 20 psi). */
  engineHours?: Binding;
  /** Bus voltage / battery current readouts ("M BUS E", "M BATT S", POH 7-50). */
  elec: {
    mainBusV: Binding;
    essBusV: Binding;
    mainBattA: Binding;
    stbyBattA: Binding;
    lowVolts: number;
    /** Bus volts red above this (POH 7-53: 32.0 V). Default 32. */
    highVolts?: number;
    /** M BATT amps amber below this (POH 7-54: white when greater than -1.5 A). Default -1.5. */
    mainBattAmberA?: number;
  };
  /** Fuel totalizer: default GAL REM after RST Fuel and the GAL REM preset keys (PG Table 3-1: 35 / 53 GAL). */
  totalizer: { defaultGal: number; presetsGal: number[]; fuelFlowGph: Binding };
}

// ------------------------------------------------------------------ misc

export interface VSpeedDef {
  /** Id used in vars ('GLIDE', 'VR', 'VX', 'VY'). */
  id: string;
  /** Bug letter on the tape ('G', 'R', 'X', 'Y', PG Table 2-1). */
  label: string;
  /** Name in the References window. */
  name: string;
  defaultKt: number;
}

export interface CasDef {
  id: string;
  text: string;
  level: CasLevel;
  /** Condition binding (true = active). */
  when: Binding;
  /** Seconds the condition must persist before the message shows (LOW FUEL: 60 s). */
  delayS?: number;
  /**
   * The aural tone is inhibited while this is true (the message still shows and flashes); e.g. LOW VOLTS
   * "Aural tone is inhibited while the aircraft is on the ground" (CRG 190-00384-12 §13.2).
   */
  auralInhibit?: Binding;
}

export interface EspConfig {
  /** Roll: engage above 45 deg, force between 30 and 75 deg, disengage below 30 deg (PG §8.11). */
  rollEngageDeg: number;
  rollDisengageDeg: number;
  rollMaxDeg: number;
  /** Pitch (C-172, PG Table 8-5/8-6): engage +16 / -16, max force +20 / -20, disengage +14 / -14 deg. */
  pitchUpEngageDeg: number;
  pitchUpMaxDeg: number;
  pitchUpDisengageDeg: number;
  pitchDnEngageDeg: number;
  pitchDnMaxDeg: number;
  pitchDnDisengageDeg: number;
  /** Maximum engagement limits (pitch ±50, bank ±75 deg). */
  pitchLimitDeg: number;
  /** High airspeed protection above Vne (kt) and low airspeed protection below (C-172: 55 KIAS for 1 s). */
  vneKt: number;
  lowSpeedKt: number;
  lowSpeedDelayS: number;
  /** Maximum servo increment (normalized surface) at full force (EST). */
  maxPitchServo: number;
  maxRollServo: number;
  /** Autopilot Level mode after `lvlAfterS` of ESP engagement within `lvlWindowS` (PG: 10 s of 20 s). */
  lvlAfterS: number;
  lvlWindowS: number;
  /** Minimum height AGL (GPS altitude - terrain), ft (PG: 200 ft). */
  minAglFt: number;
  /** Underspeed protection (USP, AFCS engaged): MINSPD alert and activation speeds (PG Tables 7-7/7-8, C-172). */
  usp: { minspdKt: number; activateKt: number };
}

export interface G1000Config {
  aircraftId: string;
  /** Name on the MFD power-on page ('Cessna 172S'). */
  aircraftName?: string;
  /** System software label on the power-on page. */
  softwareVersion?: string;
  /** Bezel model per display (default GDU 1054B on both with the Garmin AFCS). */
  bezel?: Partial<Record<'pfd' | 'mfd', GduModel>>;
  /** Garmin GFC 700 AFCS installed (AFCS keys, status box). Default true. */
  afcs?: boolean;
  /** Garmin ESP / USP option (false = not installed). */
  esp?: boolean | Partial<EspConfig>;
  /** Unit power bindings (default: always powered). */
  power?: Partial<Record<G1kUnit, Binding>>;
  /** Boot / self-test seconds (EST). */
  bootS?: Partial<Record<'gdu' | 'gia' | 'adahrs' | 'xpdr' | 'gma' | 'servos', number>>;
  /**
   * Unit power hold-up (s): a supply interruption shorter than this does not reboot a unit (internal hold-up
   * capacitance riding through a bus transfer). Default 0.
   */
  powerHoldUpS?: number;
  eis?: G1kEisConfig;
  vspeeds?: VSpeedDef[];
  /** Airspeed tape colour ranges and Vne (barber pole above). */
  speedTape?: { ranges: SpeedRange[]; vneKt: number };
  cas?: CasDef[];
  casModel?: CasModel;
  checklists?: Checklist[];
  radios?: { nav?: number; adf?: boolean; dme?: boolean };
  /** Traffic system for maps / PFD traffic ('TAS' GTS 800, 'ADSB' GTX 345R, 'TIS', 'none'). */
  traffic?: 'TAS' | 'ADSB' | 'TIS' | 'none';
  trafficSource?: { threats: readonly { relBrgDeg: number; rangeNm: number; relAltFt: number; vsSign: number; level: number }[] };
  /** Terrain alerting ('TAWS-B' option or 'SVT' Terrain-SVT). */
  terrain?: 'TAWS-B' | 'SVT';
  fms?: Fms;
  radiosInstance?: Radios;
  fmsOptions?: FmsOptions;
  radiosOptions?: RadiosOptions;
  /** Flaps angle var (flap position is not shown on the 172 PFD; read for the ESP configuration check). */
  flapsVar?: string;
  /** Canvas backing-store scale (CanvasDisplay pixel ratio). */
  pixelRatio?: number;
  /** Switch to reversionary mode automatically on a display failure (PG 190-02177-02 §1.3: yes). */
  autoReversion?: boolean;
  /**
   * Height above terrain (ft) for the ESP 200 ft AGL gate and LOW ALT checks. The G1000 derives it from
   * GPS altitude and its terrain database. Default (undefined): `gps.alt_ft` minus
   * `ctx.world.elevationAt(gps position)`, the same derivation as systems/warning/Taws (class B).
   */
  aglFt?: Binding;
  /**
   * In flight (transponder ground/air mode, flight timer, ESP gate). The 172 has no squat switch; default
   * is the ESP inference of PG §8.11: "GPS ground speed is over 30 knots, or True Airspeed is over 50 Knots".
   */
  airborne?: Binding;
  /** Stall warning active (USP activation in altitude-critical AP modes, PG §7.5). Default 'alert.stall_horn'. */
  stallWarning?: Binding;
}

export interface G1000Resolved {
  aircraftId: string;
  aircraftName: string;
  softwareVersion: string;
  bezel: Record<'pfd' | 'mfd', GduModel>;
  afcs: boolean;
  esp: EspConfig | null;
  power: Partial<Record<G1kUnit, Binding>>;
  bootS: Record<'gdu' | 'gia' | 'adahrs' | 'xpdr' | 'gma' | 'servos', number>;
  powerHoldUpS: number;
  eis: G1kEisConfig;
  vspeeds: VSpeedDef[];
  speedTape: { ranges: SpeedRange[]; vneKt: number };
  cas: CasDef[];
  checklists: Checklist[];
  radios: { nav: number; adf: boolean; dme: boolean };
  traffic: 'TAS' | 'ADSB' | 'TIS' | 'none';
  terrain: 'TAWS-B' | 'SVT';
  flapsVar: string;
  pixelRatio: number;
  autoReversion: boolean;
  aglFt: Binding | undefined;
  airborne: Binding;
  stallWarning: Binding;
}

// ------------------------------------------------------------------ defaults

const GREEN = '#00c000';
const RED = '#ff0000';
const YELLOW = '#ffd200';
const WHITE = '#ffffff';

/** Neutral single-engine piston EIS used when an aircraft gives none (placeholder; the 172S values live in presets.ts). */
export const PLACEHOLDER_EIS: G1kEisConfig = {
  rpm: {
    value: 'eng1.rpm',
    scale: { min: 0, max: 3000, bands: [{ from: 2100, to: 2700, color: GREEN }, { from: 2700, to: 3000, color: RED }], redlines: [2700], amberlines: [], ticks: [0, 3000], labels: ['0', '3000'], limits: { warnHigh: 2780 }, decimals: 0, readoutStep: 10, unit: 'RPM' },
    redAt: 2780,
  },
  fuelFlow: { value: 'eng1.ff_gph', scale: { min: 0, max: 20, bands: [{ from: 0, to: 12, color: GREEN }], redlines: [], amberlines: [], ticks: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20], labels: [], limits: {}, decimals: 1, readoutStep: 0, unit: 'GPH' } },
  oilPress: { value: 'eng1.oil_press_psi', scale: { min: 0, max: 120, bands: [{ from: 0, to: 20, color: RED }, { from: 50, to: 90, color: GREEN }, { from: 115, to: 120, color: RED }], redlines: [], amberlines: [], ticks: [], labels: [], limits: { warnLow: 20, warnHigh: 115 }, decimals: 0, readoutStep: 1, unit: 'PSI' } },
  oilTemp: { value: 'eng1.oil_temp_f', scale: { min: 75, max: 250, bands: [{ from: 100, to: 245, color: GREEN }, { from: 245, to: 250, color: RED }], redlines: [], amberlines: [], ticks: [], labels: [], limits: { warnHigh: 245 }, decimals: 0, readoutStep: 1, unit: '°F' } },
  egt: { cylinders: ['eng1.egt_f', 'eng1.egt_f', 'eng1.egt_f', 'eng1.egt_f'], min: 1250, max: 1650 },
  cht: { cylinders: ['eng1.cht_f', 'eng1.cht_f', 'eng1.cht_f', 'eng1.cht_f'], min: 100, max: 500, redline: 500 },
  vacuum: { value: 'ac.vac.suction_inhg', scale: { min: 3, max: 7, bands: [{ from: 4.5, to: 5.5, color: GREEN }], redlines: [], amberlines: [], ticks: [], labels: [], limits: {}, decimals: 1, readoutStep: 0, unit: 'IN' } },
  fuelQty: {
    left: 'fuel.tank0_kg / 2.7216',
    right: 'fuel.tank1_kg / 2.7216',
    scale: { min: 0, max: 30, bands: [{ from: 0, to: 1.5, color: RED }, { from: 1.5, to: 5, color: YELLOW }, { from: 5, to: 24, color: GREEN }, { from: 24, to: 30, color: WHITE }], redlines: [0], amberlines: [], ticks: [0, 10, 20, 30], labels: ['0', '10', '20', 'F'], limits: { cautionLow: 5 }, decimals: 1, readoutStep: 0, unit: 'GAL' },
    indicatorMaxGal: 24,
    lowGal: 5,
    lowDelayS: 60,
  },
  elec: { mainBusV: 'elec.main_v', essBusV: 'elec.ess_v', mainBattA: 'elec.batt_amps', stbyBattA: 'elec.stby_batt_amps', lowVolts: 24.5 },
  totalizer: { defaultGal: 53, presetsGal: [35, 53], fuelFlowGph: 'eng1.ff_gph' },
};

/** GFC 700 ESP defaults for the C-172 (PG 190-02177-02 §8.11 Tables 8-5 / 8-6, §7.5 Tables 7-7 / 7-8). */
export const ESP_C172: EspConfig = {
  rollEngageDeg: 45,
  rollDisengageDeg: 30,
  rollMaxDeg: 75,
  pitchUpEngageDeg: 16,
  pitchUpMaxDeg: 20,
  pitchUpDisengageDeg: 14,
  pitchDnEngageDeg: -16,
  pitchDnMaxDeg: -20,
  pitchDnDisengageDeg: -14,
  pitchLimitDeg: 50,
  vneKt: 163, // POH §2 red line 163 KIAS
  lowSpeedKt: 55, // PG §8.11 "Low Airspeed Protection (Model 172): below 55 KIAS ... for 1 second"
  lowSpeedDelayS: 1,
  // EST: GSA 81 servo slip-clutch torque lets the pilot overpower ESP; ~12 % pitch / ~15 % roll surface
  // travel reproduces "resistance to control movement" without taking control away.
  maxPitchServo: 0.12,
  maxRollServo: 0.15,
  lvlAfterS: 10,
  lvlWindowS: 20,
  minAglFt: 200,
  // PG Tables 7-7 / 7-8 (C-172): MINSPD alert 60 KIAS; USP activation 60 KIAS (non-altitude-critical modes).
  usp: { minspdKt: 60, activateKt: 60 },
};

export const DEFAULT_VSPEEDS: VSpeedDef[] = [];

/** Fills every default. Pure: safe to call in tests. */
export function resolveConfig(c: G1000Config): G1000Resolved {
  const espCfg = c.esp === undefined || c.esp === false ? null : c.esp === true ? { ...ESP_C172 } : { ...ESP_C172, ...c.esp };
  return {
    aircraftId: c.aircraftId,
    aircraftName: c.aircraftName ?? c.aircraftId,
    // EST: NXi system software numbers on the Cessna NAV III (PG 190-02177-02 covers GDU 20.83; CRG 190-02824 covers system 4013.00).
    softwareVersion: c.softwareVersion ?? 'System 4013.00',
    bezel: { pfd: c.bezel?.pfd ?? 'GDU1054B', mfd: c.bezel?.mfd ?? 'GDU1054B' },
    afcs: c.afcs ?? true,
    esp: espCfg,
    power: c.power ?? {},
    bootS: {
      // EST: NXi GDUs show the Garmin splash then the flight displays in ~15 s (no published figure; the
      // PG only says all annunciations clear "typically within one minute of power-up").
      gdu: c.bootS?.gdu ?? 15,
      gia: c.bootS?.gia ?? 10,
      // EST: GSU 75 ADAHRS alignment "Remain Stationary" ~30 s on the ground.
      adahrs: c.bootS?.adahrs ?? 30,
      xpdr: c.bootS?.xpdr ?? 5,
      gma: c.bootS?.gma ?? 2, // PG §4.5: all annunciators lit ~2 s during the self test
      // EST: GFC 700 preflight test (PFT) after servo power-up takes a few seconds.
      servos: c.bootS?.servos ?? 5,
    },
    powerHoldUpS: c.powerHoldUpS ?? 0,
    eis: c.eis ?? PLACEHOLDER_EIS,
    vspeeds: c.vspeeds ?? DEFAULT_VSPEEDS,
    speedTape: c.speedTape ?? { ranges: [], vneKt: 400 },
    cas: c.cas ?? [],
    checklists: c.checklists ?? [],
    radios: { nav: c.radios?.nav ?? 2, adf: c.radios?.adf ?? false, dme: c.radios?.dme ?? false },
    traffic: c.traffic ?? 'none',
    terrain: c.terrain ?? 'SVT',
    flapsVar: c.flapsVar ?? 'surf.flaps_deg',
    pixelRatio: c.pixelRatio ?? 0.9,
    autoReversion: c.autoReversion ?? true,
    aglFt: c.aglFt,
    airborne: c.airborne ?? '(gps.valid ?? 0) * gps.gs_kt > 30 || (adc1.valid ?? 0) * adc1.tas_kt > 50',
    stallWarning: c.stallWarning ?? 'alert.stall_horn ?? 0',
  };
}
