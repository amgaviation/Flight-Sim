/**
 * SimVar and event names owned by the Honeywell Primus Epic suite
 * (Gulfstream PlaneView II / Symmetry). Everything the suite keeps as
 * cockpit state lives under `epic.` so that displays, cockpit hardware,
 * tests and the aircraft all see the same values (CLAUDE.md: state crosses
 * module boundaries only through SimVars / EventBus).
 *
 * Side numbering: 1 = pilot (left), 2 = copilot (right).
 * Display units: 1 = pilot outboard (PFD), 2 = pilot inboard (MFD),
 * 3 = copilot inboard (MFD), 4 = copilot outboard (PFD) — Gulfstream G550
 * Operating Manual 2A-31-00 "Electronic Display System": "Units #1 and #2
 * are positioned on the pilot side, while #3 and #4 are on the copilot side".
 */

/**
 * Window content codes. A display unit (DU) is split into one "2/3" window
 * plus a column of two "1/6" windows, or shows one "full" window
 * (G550 OM 2A-31: "full window, 2/3 window or 1/6 window").
 */
export enum Win {
  Blank = 0,
  // 2/3 (and full) window formats
  Pfd = 1,
  Map = 2,
  // 1/6 window formats
  Engine = 10,
  Engine2 = 11,
  Cas = 12,
  Checklist = 13,
  WptList = 14,
  // Synoptics (1/6 and 2/3 formats; see displays/synoptics)
  SynSummary = 20,
  SynAcPower = 21,
  SynDcPower = 22,
  SynHydraulics = 23,
  SynFuel = 24,
  SynEcs = 25,
  SynDoors = 26,
  SynFlightControls = 27,
  SynIce = 28,
  SynBrakes = 29,
  SynApuBleed = 30,
  SynEngineStart = 31,
}

/** Human-readable window names (menus, tooltips, window-select lists). */
export const WIN_NAMES: Readonly<Record<number, string>> = {
  [Win.Blank]: 'Blank',
  [Win.Pfd]: 'PFD',
  [Win.Map]: 'Map',
  [Win.Engine]: 'Engine',
  [Win.Engine2]: 'Secondary Engine',
  [Win.Cas]: 'CAS',
  [Win.Checklist]: 'Checklist',
  [Win.WptList]: 'Waypoint List',
  [Win.SynSummary]: 'Summary',
  [Win.SynAcPower]: 'AC Power',
  [Win.SynDcPower]: 'DC Power',
  [Win.SynHydraulics]: 'Hydraulics',
  [Win.SynFuel]: 'Fuel',
  [Win.SynEcs]: 'ECS / Pressurization',
  [Win.SynDoors]: 'Doors',
  [Win.SynFlightControls]: 'Flight Controls',
  [Win.SynIce]: 'Ice Protection',
  [Win.SynBrakes]: 'Brakes',
  [Win.SynApuBleed]: 'APU / Bleed',
  [Win.SynEngineStart]: 'Engine Start',
};

/** Synoptic window codes, in menu order. */
export const SYNOPTIC_WINDOWS: readonly Win[] = [
  Win.SynSummary,
  Win.SynAcPower,
  Win.SynDcPower,
  Win.SynHydraulics,
  Win.SynFuel,
  Win.SynEcs,
  Win.SynDoors,
  Win.SynFlightControls,
  Win.SynIce,
  Win.SynBrakes,
  Win.SynApuBleed,
  Win.SynEngineStart,
];

export function isSynoptic(w: number): boolean {
  return w >= Win.SynSummary && w <= Win.SynEngineStart;
}

/** Contents allowed in the 2/3 window (G550 OM 2A-31: PFD, MAP or synoptic displays). */
export function allowedInMain(w: number): boolean {
  return w === Win.Blank || w === Win.Pfd || w === Win.Map || w === Win.Checklist || isSynoptic(w);
}

/** Contents allowed in a 1/6 window (G550 OM 2A-31 "1/6 window format"). */
export function allowedInSixth(w: number): boolean {
  return w === Win.Blank || w === Win.Engine || w === Win.Engine2 || w === Win.Cas || w === Win.Checklist || w === Win.WptList || isSynoptic(w);
}

/** DU layout: split (2/3 + two 1/6) or a single full window. */
export enum DuFormat {
  Split = 0,
  Full = 1,
}

/** Pilot PFD HSI presentation. */
export enum HsiMode {
  Rose = 0,
  Arc = 1,
  /** Arc with the map (terrain / weather / route) underlay. */
  Map = 2,
}

/** Navigation source for the PFD HSI and the flight guidance (NAV SRC). */
export enum NavSrc {
  Fms = 0,
  Nav1 = 1,
  Nav2 = 2,
  Nav3 = 3,
}

/** Bearing pointer sources. */
export enum BrgSrc {
  Off = 0,
  Nav1 = 1,
  Nav2 = 2,
  Adf1 = 3,
  Adf2 = 4,
  Fms = 5,
}

/** Map orientation (INAV "Up" menu). */
export enum MapUp {
  Heading = 0,
  Track = 1,
  North = 2,
}

/** Terrain / weather layer on the maps. */
export enum MapOverlay {
  Off = 0,
  Terrain = 1,
  Weather = 2,
}

const du = (n: number, k: string): string => `epic.du${n}.${k}`;
const side = (s: number, k: string): string => `epic.s${s}.${k}`;

/** Every numeric var the suite owns. */
export const EPIC_VARS = {
  // ------------------------------------------------------------ display units
  /** DU format (DuFormat). */
  duFormat: (n: number) => du(n, 'format'),
  /** Content of the 2/3 (or full) window (Win). */
  duMain: (n: number) => du(n, 'main'),
  /** Content of the upper / lower 1/6 window (Win). */
  duUpper: (n: number) => du(n, 'upper'),
  duLower: (n: number) => du(n, 'lower'),
  /** Output: 1 while the DU shows a picture (powered, not failed, switch NORM). */
  duOperating: (n: number) => du(n, 'operating'),
  /** Output: content actually displayed after reversion (what the pilot sees). */
  duShownMain: (n: number) => du(n, 'shown_main'),
  duShownUpper: (n: number) => du(n, 'shown_upper'),
  duShownLower: (n: number) => du(n, 'shown_lower'),
  /**
   * DISPLAY SYSTEM CONTROL switch per DU (G550 OM 2A-31 "Display Switching /
   * Display Control Panel (Overhead Panel)": NORM / OFF). 1 = NORM (default), 0 = OFF.
   */
  duSwitch: (n: number) => du(n, 'sw'),
  /**
   * MFD DISPLAY SWITCHING (overhead): left switch selects DU #2 between its
   * normal display and the PFD, right switch DU #3 (G550 OM 2A-31). Values:
   * 0 = NORM, 1 = PFD. Side 1 -> DU2, side 2 -> DU3.
   */
  mfdSwitch: (s: number) => side(s, 'mfd_sw'),

  // ------------------------------------------------------------ per side (PFD / DC / SMC state)
  /** HSI presentation (HsiMode). */
  hsiMode: (s: number) => side(s, 'hsi_mode'),
  /** Navigation source (NavSrc). Mirrors the AFCS `ap.nav_source` on the coupled side. */
  navSrc: (s: number) => side(s, 'nav_src'),
  /** FMS number used as the FMS source on this side (1..3); cosmetic ("FMS1"). */
  fmsNum: (s: number) => side(s, 'fms_num'),
  /** Bearing pointers 1 and 2 (BrgSrc). */
  brg1: (s: number) => side(s, 'brg1'),
  brg2: (s: number) => side(s, 'brg2'),
  /** Flight path symbol (FPV) on the PFD, 0/1. */
  fpv: (s: number) => side(s, 'fpv'),
  /** SmartView synthetic vision on the PFD, 0/1. */
  svs: (s: number) => side(s, 'svs'),
  /** Enhanced vision (EVS) picture on the PFD instead of SmartView, 0/1 (HUD page). */
  evs: (s: number) => side(s, 'evs'),
  /** Air data / attitude source on this side (1..3, reversion via SENSOR page). */
  adcSel: (s: number) => side(s, 'adc_sel'),
  ahrsSel: (s: number) => side(s, 'ahrs_sel'),
  /** Barometric unit 0 = inHg, 1 = hPa. */
  baroHpa: (s: number) => side(s, 'baro_hpa'),
  /** Minimums: value (ft) and source 1 = RA, 0 = BARO (also written to ap.mins{s}_ft / _is_ra). */
  minsFt: (s: number) => side(s, 'mins_ft'),
  minsRa: (s: number) => side(s, 'mins_ra'),
  /** Map (INAV) on this side's MFD: range (nm), orientation (MapUp), overlay (MapOverlay), centred 0/1, VSD 0/1. */
  mapRange: (s: number) => side(s, 'map_range_nm'),
  mapUp: (s: number) => side(s, 'map_up'),
  mapOverlay: (s: number) => side(s, 'map_overlay'),
  mapCentered: (s: number) => side(s, 'map_ctr'),
  mapVsd: (s: number) => side(s, 'map_vsd'),
  mapShowAirports: (s: number) => side(s, 'map_apt'),
  mapShowNavaids: (s: number) => side(s, 'map_vor'),
  mapShowFixes: (s: number) => side(s, 'map_fix'),
  mapShowTraffic: (s: number) => side(s, 'map_tfc'),
  /** PFD HSI map range (nm). */
  pfdRange: (s: number) => side(s, 'pfd_range_nm'),
  /** Radio altimeter / TCAS / EGPWS / stall / AP disconnect test in progress from the DC TEST page (0/1). */
  testRa: (s: number) => side(s, 'test_ra'),
  /** Display controller / SMC page (DcPage) and state. */
  dcPage: (s: number) => side(s, 'dc_page'),
  /** 1 while the SMC (PlaneView II) shows the standby flight instrument, 0 = display controller page. */
  smcStandby: (s: number) => side(s, 'smc_stby'),

  // ------------------------------------------------------------ flight reference (V speeds) — FLT REF page
  vspeed: (name: string) => `epic.vspd.${name}`, // v1, vr, v2, vref, vapp, vfs (kt; 0 = not set)
  vspeedsShown: 'epic.vspd.shown',

  // ------------------------------------------------------------ CCD
  /** DU number (1..4) the cursor of side s is on; 0 = parked (hidden). */
  ccdDu: (s: number) => side(s, 'ccd_du'),
  /** Cursor position in DU logical pixels. */
  ccdX: (s: number) => side(s, 'ccd_x'),
  ccdY: (s: number) => side(s, 'ccd_y'),
  /** Id of the hot spot under the cursor ('' none) is a string var: see EPIC_STRINGS.ccdHover. */

  // ------------------------------------------------------------ guidance panel
  /** PFD CMD coupling: 1 = pilot (left arrow), 2 = copilot (right arrow). */
  coupleSide: 'epic.gp.couple',
  /** Speed target source: 1 = MAN (guidance panel speed), 0 = FMS speed. */
  speedMan: 'epic.gp.spd_man',
  /** VS/FPA reference shown in the VS/FPA window (FPA deg, mirrors the AFCS reference in FPA mode). */
  fpaRef: 'epic.gp.fpa_deg',
  /** 1 while the side's NAV receiver previews / auto-tunes the FMS approach (cyan ghost needles). */
  preview: (s: number) => side(s, 'preview'),
  /** Direct (great-circle) distance to the destination airport (nm), written by the suite. */
  destDirectNm: 'epic.fms.dest_direct_nm',
  /** Low bank selected (lamp). */
  lowBank: 'epic.gp.low_bank',
  /** Guidance panel window brightness 0..1 (panel dimmer). */
  gpBrt: 'epic.gp.brt',

  // ------------------------------------------------------------ CAS
  /** Hidden messages above / below the CAS window (scroll status bar). */
  casHiddenAbove: 'epic.cas.hidden_above',
  casHiddenBelow: 'epic.cas.hidden_below',

  // ------------------------------------------------------------ checklist (ECL)
  /** Index of the checklist shown (into the configured list), -1 = index page. */
  eclList: 'epic.ecl.list',
  eclCursor: 'epic.ecl.cursor',
  /** Output: 1 while the displayed checklist is complete. */
  eclComplete: 'epic.ecl.complete',

  // ------------------------------------------------------------ MCDU
  /** 1 while an FMS modification is pending (MOD flight plan). */
  mcduMod: 'epic.mcdu.mod',
  /** MCDU n MSG annunciator: FMS messages present and the MCDU is not showing the MSG page. */
  mcduMsgLight: (n: number) => `epic.mcdu${n}.msg_lt`,

  // ------------------------------------------------------------ Symmetry touch screens
  /** Page index shown on touch screen `id` (tsc1..4, ohpts1..3, sfd1..2). */
  touchPage: (id: string) => `epic.touch.${id}.page`,

  // ------------------------------------------------------------ misc
  /** 1 = displays skip their power-up boot sequence (set by applyState for non-cold states). */
  bootSkip: 'epic.boot_skip',
  /** Output: 1 while any secondary engine parameter is in a caution / warning range (full MAP reversion). */
  engExceed2: 'epic.eng.exceed2',
  /** Output: 1 while the primary engine window shows the compacted format. */
  engCompact: 'epic.eng.compact',
  /** Chronometer seconds per side (clock on the glareshield / TSC utility). */
  chronoS: (s: number) => side(s, 'chrono_s'),
  chronoRun: (s: number) => side(s, 'chrono_run'),
  /** HF radios (not modelled by nav/Radios): frequency kHz. */
  hfFreq: (r: number) => `epic.hf${r}.khz`,
  /** COM/NAV3 mode 0 = voice, 1 = data. */
  com3Data: 'epic.com3.data',
  /** Transponder in use 1/2 (ATC1/ATC2). */
  xpdrUnit: 'epic.xpdr.unit',
  /** Weather radar: mode 0 OFF, 1 STBY, 2 WX, 3 GMAP; tilt deg; gain (0 = CAL). */
  radarMode: 'epic.radar.mode',
  radarTilt: 'epic.radar.tilt_deg',
  radarGain: 'epic.radar.gain',
} as const;

/** String vars owned by the suite. */
export const EPIC_STRINGS = {
  /** Id of the hot spot under side s's cursor ('' = none). */
  ccdHover: (s: number) => `epic.s${s}.ccd_hover`,
  /** MCDU scratchpad text per MCDU. */
  mcduScratch: (n: number) => `epic.mcdu${n}.scratch`,
  /** MCDU page title per MCDU. */
  mcduTitle: (n: number) => `epic.mcdu${n}.title`,
} as const;

/** Events the suite listens to (cockpit hardware emits them; tests and aircraft may too). */
export const EPIC_EVENTS = {
  /** CCD of side s: `{ dx, dy }` pixels of touch-pad motion. */
  ccdMove: (s: number) => `epic.ccd${s}.move`,
  /** CCD enter / select (the grip trigger / ENTER key). */
  ccdEnter: (s: number) => `epic.ccd${s}.enter`,
  /** CCD MENU key: opens the window menu under the cursor. */
  ccdMenu: (s: number) => `epic.ccd${s}.menu`,
  /** CCD DU select keys: payload 0/1/2 = the side's left / centre / right DU. */
  ccdDu: (s: number) => `epic.ccd${s}.du`,
  /** CCD data set knob: payload `{ steps, inner }` (+ = clockwise). */
  ccdData: (s: number) => `epic.ccd${s}.data`,
  /** CCD data set knob as encoder events (payload = click count > 0): outer / inner, clockwise / counter-clockwise. */
  ccdDataInc: (s: number, inner = false) => `epic.ccd${s}.data${inner ? '_in' : ''}_inc`,
  ccdDataDec: (s: number, inner = false) => `epic.ccd${s}.data${inner ? '_in' : ''}_dec`,
  /** Display controller / SMC line select key: payload 1..10 (1-5 left top->bottom, 6-10 right). */
  dcLsk: (s: number) => `epic.dc${s}.lsk`,
  /** Display controller page key (function button): payload page id string (see DC_PAGES). */
  dcPage: (s: number) => `epic.dc${s}.page`,
  /** DC / SMC SET knob (range / value): payload steps. */
  dcSet: (s: number) => `epic.dc${s}.set`,
  /** SET knob as encoder events (payload = click count > 0). */
  dcSetInc: (s: number) => `epic.dc${s}.set_inc`,
  dcSetDec: (s: number) => `epic.dc${s}.set_dec`,
  /** CAS scroll switch on the side console: payload +1 (up) / -1 (down). */
  casScroll: 'epic.cas.scroll',
  /** Same without payload (spring-loaded toggle positions): scroll up / down one message. */
  casScrollUp: 'epic.cas.scroll_up',
  casScrollDown: 'epic.cas.scroll_dn',
  /** MCDU n key press: payload key id ('A', '1', 'LSK1L', 'FPL', 'CLR', ...). */
  mcduKey: (n: number) => `epic.mcdu${n}.key`,
  /** Guidance panel control: payload per control (see logic/guidance.ts GP_CONTROLS). */
  gp: (control: string) => `epic.gp.${control}`,
  /** Chronometer start/stop/reset for side s. */
  chrono: (s: number) => `epic.chrono${s}`,
} as const;
