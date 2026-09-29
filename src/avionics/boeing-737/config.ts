/**
 * Configuration of the 737NG avionics suite. Every field is optional;
 * `resolveB737Config()` fills the defaults (a 737-800W with CFM56-7B26
 * engines, fail-operational autoland option, kg units, colour LCD CDUs).
 *
 * Power: bindings (see systems-power.md §1.1 expression language) evaluated
 * every update. Missing bindings = always powered, so a partial aircraft
 * still shows its displays. Typical 737NG wiring (FCOM 6.20, EST where the
 * public manuals are vague): Captain's DUs and the upper DU from the AC /
 * DC standby buses, F/O's DUs and the lower DU from DC bus 2 / AC XFR 2,
 * DEU 1 from the standby bus, DEU 2 from XFR bus 2.
 */
import type { Binding } from '../../systems/util/binding';
import type { AfcsConfig, AfcsGains } from '../../systems/autopilot';
import type { AutothrottleConfig } from '../../systems/fadec/Autothrottle';
import type { RadiosOptions } from '../../nav/Radios';
import type { FmsOptions, Fms } from '../../nav/fms/Fms';
import type { Radios } from '../../nav/Radios';
import type { Ctx2D } from '../common/draw/context';
import type { DuId, Side } from './vars';
import { B738_ENGINE_RATING, B738_MODEL } from './data/b738';

/** Traffic source: a TCAS system's reused threat list (systems/warning Tcas). */
export interface B737TrafficSource {
  threats: readonly { relBrgDeg: number; rangeNm: number; relAltFt: number; vsSign: number; level: number }[];
}

/** Weather radar overlay hook drawn under the ND symbology (no radar model in the sim: SCOPE). */
export type NdWeatherOverlay = (ctx: Ctx2D, geo: { cx: number; cy: number; pxPerNm: number; upDeg: number; rangeNm: number; side: Side }) => void;

export interface B737PowerConfig {
  /** DU power per display unit. */
  du?: Partial<Record<DuId, Binding>>;
  /** Display electronics units. */
  deu1?: Binding;
  deu2?: Binding;
  /** FMC computer, CDUs, MCP, EFIS control panels. */
  fmc?: Binding;
  cdu1?: Binding;
  cdu2?: Binding;
  mcp?: Binding;
  efis1?: Binding;
  efis2?: Binding;
  /** Radio receivers (written into nav{r}.powered, adf{r}.powered, gps.powered, nav.marker_powered). */
  nav1?: Binding;
  nav2?: Binding;
  adf1?: Binding;
  adf2?: Binding;
  gps?: Binding;
  marker?: Binding;
}

/** Engine and system var names read by the engine / systems displays. */
export interface B737DisplayVars {
  /** Fuel tank quantities (kg). Default: tank 1 = fuel.tank0_kg, tank 2 = fuel.tank1_kg, centre = fuel.tank2_kg. */
  fuelLeftKg: string;
  fuelRightKg: string;
  fuelCenterKg: string;
  fuelTotalKg: string;
  /** Binding: 1 while both centre tank pumps are off (FUEL CONFIG alert logic). Default 0. */
  centerPumpsOff: Binding;
  /** Engine running binding per engine (for CONFIG / ENG FAIL). Default eng{i}.running. */
  engineRunning: (e: 1 | 2) => Binding;
  /** Start valve open per engine (START VALVE OPEN alert). Default eng{i}.starter. */
  startValveOpen: (e: 1 | 2) => Binding;
  /** Oil filter bypass per engine. Default 0. */
  oilFilterBypass: (e: 1 | 2) => Binding;
  /** Oil quantity (US qt or % per `oilQtyUnit`). Default: `ac.eng{i}.oil_qty ?? 18` (EST typical level; SCOPE: no oil model). */
  oilQty: (e: 1 | 2) => Binding;
  /** Engine vibration (units 0-5). Default eng{i}.vib_n1. */
  vibration: (e: 1 | 2) => Binding;
  /** Engine fuel control (start lever) at IDLE (for the ENG FAIL alert). Default fadec.eng{i}.fuel_cmd ?? 1. */
  startLeverIdle: (e: 1 | 2) => Binding;
  /** EEC powered (engine indications other than N1/N2/EGT blank without it). Default 1. */
  eecPowered: (e: 1 | 2) => Binding;
  /** Hydraulic system A/B pressure (psi) and reservoir quantity (0..1). */
  hydAPsi: string;
  hydBPsi: string;
  hydAQty: string;
  hydBQty: string;
  /** Flap position (deg), gear down-and-locked, air/ground (1 = ground). */
  flapsDeg: string;
  gearDown: string;
  onGround: string;
  /** Normalized angle of attack (1 = stall, from systems/warning StallWarning) and the stick-shaker threshold. */
  aoaNorm: string;
  shakerNorm: number;
  /** Vmo / Mmo barber pole speed (kt) written by systems/warning Overspeed; default: computed from the limits. */
  vmoVar: string;
  /** Radio altimeter indices for the captain / F/O sides. */
  raIndex: [number, number];
  /** TCAS resolution-advisory bands for the VSI (systems/warning Tcas). */
  tcasRaMin: string;
  tcasRaMax: string;
  tcasRa: string;
  tcasTa: string;
  tcasStatus: string;
  /** EGPWS alerts shown on the PFD / ND. */
  tawsWarning: string;
  tawsCaution: string;
  tawsAlert: string;
  windshear: string;
  /** TAWS / TCAS / WXR test flags. */
  tawsInop: string;
  /**
   * Optional weather radar annunciation vars (additive): string var with the mode line shown under 'WXR' on the ND
   * (e.g. 'WX+T', 'MAP', 'TEST', or 'WXR FAIL' / 'WXR OFF' in amber when it starts with 'WXR'), and the numeric
   * antenna tilt (deg). When absent the ND shows 'WXR' and '+0' as before.
   */
  wxrModeText?: string;
  wxrTiltDeg?: string;
}

export interface B737AfdsConfig {
  /** Build the Afcs + Autothrottle inside the suite (default true). */
  create?: boolean;
  /** FCC power (both channels). Default true. */
  power?: Binding;
  /** Servo (hydraulic) power per channel A/B. Default ['hyd.a_psi > 1000', 'hyd.b_psi > 1000'] when those vars exist. */
  servoPower?: [Binding, Binding];
  /** Additional engage inhibit, e.g. 'ac.stab_trim_ap_cutout == 1' (stab trim AUTOPILOT cutout at CUTOUT). */
  engageInhibit?: Binding;
  /** Additional automatic disconnect condition (e.g. IRS fault). */
  autoDisconnect?: Binding;
  /** Autothrottle power / engines / lever vars. */
  atPower?: Binding;
  leverVar?: (e: number) => string;
  /** Gains for the Afcs (EST defaults tuned for the 737-800 in the aircraft module). */
  gains?: Partial<AfcsGains>;
  /** Raw overrides merged into the Afcs / Autothrottle configs. */
  afcs?: Partial<AfcsConfig>;
  autothrottle?: Partial<AutothrottleConfig>;
}

export interface B737Config {
  aircraftId?: string;
  /** IDENT page model / engine rating. */
  model?: string;
  engineRating?: string;
  /** Weight / fuel units on the FMC and fuel displays. */
  weightUnit?: 'kg' | 'lb';
  /** Autoland: 'fail-operational' (LAND 3 / LAND 2 / ROLLOUT; b737.org.uk "Cat IIIB") or 'fail-passive' (FLARE only). */
  autoland?: 'fail-passive' | 'fail-operational';
  /** CDU keyboard: 'menu' (U10 MENU key) or 'dir-intc' (DIR INTC key). */
  cduKeys?: 'menu' | 'dir-intc';
  /** CDU screen: colour LCD or the original green monochrome CRT. */
  cduScreen?: 'color' | 'green';
  /** Oil quantity unit on the secondary engine display. */
  oilQtyUnit?: 'qt' | 'pct';
  /** Optional angle-of-attack gauge on the PFD (customer option). */
  pfdAoaGauge?: boolean;
  /**
   * PFD flight director presentation: 'split-axis' crossbars (default) or the 'single-cue'
   * customer option (integrated V-bar command cue; FCOM 10.10 "Flight Director Display").
   */
  fdDisplay?: 'split-axis' | 'single-cue';
  power?: B737PowerConfig;
  vars?: Partial<B737DisplayVars>;
  /** Use existing radios / FMS instead of creating them. */
  radios?: Radios;
  fms?: Fms;
  radiosOptions?: RadiosOptions;
  fmsOptions?: FmsOptions;
  /** Air data / IRS indices of the left / right ADIRU (default [1, 2]). */
  adiru?: [number, number];
  afds?: B737AfdsConfig;
  /** Company routes for the RTE page CO ROUTE entry: name -> route string. */
  companyRoutes?: Record<string, string>;
  trafficSource?: B737TrafficSource | null;
  weatherOverlay?: NdWeatherOverlay | null;
  /** Nav database identifier on the IDENT page (e.g. 'AMG2609'). Default derived from the database cycle. */
  navDataName?: string;
  /** OP PROGRAM part number / software on IDENT (default 549849-014 (U10.8A); EST typical). */
  opProgram?: string;
  /** Map of FMC N1 ratings to the aircraft ThrustRatingComputer ids (default identical ids). */
  n1RatingIds?: Partial<Record<'TO' | 'TO-1' | 'TO-2' | 'CLB' | 'CLB-1' | 'CLB-2' | 'CRZ' | 'CON' | 'GA', string>>;
  /** Display unit texture scale (logical 800 x 800; default 1). */
  duPixelRatio?: number;
}

export type ResolvedB737Config = Required<Omit<B737Config, 'radios' | 'fms' | 'trafficSource' | 'weatherOverlay' | 'vars' | 'afds' | 'power' | 'n1RatingIds'>> & {
  radios: Radios | null;
  fms: Fms | null;
  trafficSource: B737TrafficSource | null;
  weatherOverlay: NdWeatherOverlay | null;
  vars: B737DisplayVars;
  afds: B737AfdsConfig;
  power: B737PowerConfig;
  n1RatingIds: Record<'TO' | 'TO-1' | 'TO-2' | 'CLB' | 'CLB-1' | 'CLB-2' | 'CRZ' | 'CON' | 'GA', string>;
};

export const DEFAULT_DISPLAY_VARS: B737DisplayVars = {
  fuelLeftKg: 'fuel.tank0_kg',
  fuelRightKg: 'fuel.tank1_kg',
  fuelCenterKg: 'fuel.tank2_kg',
  fuelTotalKg: 'fuel.total_kg',
  centerPumpsOff: 0,
  engineRunning: (e) => `eng${e}.running`,
  startValveOpen: (e) => `eng${e}.starter`,
  oilFilterBypass: () => 0,
  oilQty: (e) => `ac.eng${e}.oil_qty ?? 18`,
  vibration: (e) => `eng${e}.vib_n1`,
  startLeverIdle: (e) => `fadec.eng${e}.fuel_cmd ?? 1`,
  eecPowered: () => 1,
  hydAPsi: 'hyd.a_psi',
  hydBPsi: 'hyd.b_psi',
  hydAQty: 'hyd.a_qty',
  hydBQty: 'hyd.b_qty',
  flapsDeg: 'surf.flaps_deg',
  gearDown: 'gear.down_locked',
  onGround: 'gear.air_ground',
  aoaNorm: 'stall.aoa_norm',
  // StallWarning default shaker threshold (systems-control.md §7.6: 0.85, EST).
  shakerNorm: 0.85,
  vmoVar: 'overspeed.vmo_kt',
  raIndex: [1, 2],
  tcasRaMin: 'tcas.ra_vs_min_fpm',
  tcasRaMax: 'tcas.ra_vs_max_fpm',
  tcasRa: 'tcas.ra',
  tcasTa: 'tcas.ta',
  tcasStatus: 'tcas.status',
  tawsWarning: 'alert.taws_warning',
  tawsCaution: 'alert.taws_caution',
  tawsAlert: 'taws.alert',
  windshear: 'alert.windshear',
  tawsInop: 'taws.inop',
};

export function resolveB737Config(cfg: B737Config = {}): ResolvedB737Config {
  const ids = cfg.n1RatingIds ?? {};
  return {
    aircraftId: cfg.aircraftId ?? 'b737-800',
    model: cfg.model ?? B738_MODEL,
    engineRating: cfg.engineRating ?? B738_ENGINE_RATING,
    weightUnit: cfg.weightUnit ?? 'kg',
    autoland: cfg.autoland ?? 'fail-operational',
    cduKeys: cfg.cduKeys ?? 'menu',
    cduScreen: cfg.cduScreen ?? 'color',
    oilQtyUnit: cfg.oilQtyUnit ?? 'qt',
    pfdAoaGauge: cfg.pfdAoaGauge ?? false,
    fdDisplay: cfg.fdDisplay ?? 'split-axis',
    power: cfg.power ?? {},
    vars: { ...DEFAULT_DISPLAY_VARS, ...(cfg.vars ?? {}) },
    radios: cfg.radios ?? null,
    fms: cfg.fms ?? null,
    radiosOptions: cfg.radiosOptions ?? { navCount: 2, adfCount: 2 },
    fmsOptions: cfg.fmsOptions ?? {},
    adiru: cfg.adiru ?? [1, 2],
    afds: cfg.afds ?? {},
    companyRoutes: cfg.companyRoutes ?? {},
    trafficSource: cfg.trafficSource ?? null,
    weatherOverlay: cfg.weatherOverlay ?? null,
    navDataName: cfg.navDataName ?? '',
    opProgram: cfg.opProgram ?? '549849-014',
    n1RatingIds: {
      TO: ids.TO ?? 'TO',
      'TO-1': ids['TO-1'] ?? 'TO-1',
      'TO-2': ids['TO-2'] ?? 'TO-2',
      CLB: ids.CLB ?? 'CLB',
      'CLB-1': ids['CLB-1'] ?? 'CLB-1',
      'CLB-2': ids['CLB-2'] ?? 'CLB-2',
      CRZ: ids.CRZ ?? 'CRZ',
      CON: ids.CON ?? 'CON',
      GA: ids.GA ?? 'GA',
    },
    duPixelRatio: cfg.duPixelRatio ?? 1,
  };
}
