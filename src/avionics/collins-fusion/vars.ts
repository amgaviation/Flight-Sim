/**
 * SimVar and EventBus names of the Collins Pro Line Fusion suite as fitted
 * to the Bombardier Global Vision Flight Deck (Global 5000 / 6000).
 *
 * Suite state lives under the `fusion.` prefix (aircraft-independent avionics
 * state, like `epic.` / `g3k.` for the other families). Standard vars from
 * core/vars.ts (`ap.*`, `nav*`, `com*`, `adc*`, ...) are written where the
 * real controls write them (FCP -> `ap.sel_*`, CTP -> radio frequencies,
 * baro -> `adc{n}.baro_inhg`), so the systems library consumes them.
 *
 * Display units (Collins course syllabus 523-0817473, equipment list: four
 * AFD-6520 15.1-inch Adaptive Flight Displays; FAA FSB report BD-700-1A10
 * Rev 7, appendix 6: "Four (4) Adaptive Flight Displays (AFD)/Display Units
 * (DU) installed"; Collins: "arranged in a T-shape"):
 *
 *        AFD 1 (pilot PFD)   AFD 2 (upper centre)   AFD 4 (copilot PFD)
 *                            AFD 3 (lower centre)
 */

/** Window (multifunction window, MFW) contents. Codes are stored in vars. */
export const Win = {
  Blank: 0,
  Pfd: 1,
  Eicas: 2,
  Map: 3,
  Fms: 4,
  Sys: 5,
  Chkl: 6,
  Vsd: 7,
  Chart: 8,
  Evs: 9,
} as const;
export type Win = (typeof Win)[keyof typeof Win];

export const WIN_NAMES: Record<Win, string> = {
  0: 'BLANK',
  1: 'PFD',
  2: 'EICAS',
  3: 'MAP',
  4: 'FMS',
  5: 'SYSTEMS',
  6: 'CHECKLIST',
  7: 'VSD',
  8: 'CHARTS',
  9: 'EVS',
};

/**
 * Window slots of one AFD. A display is either one full window (`F`) or split
 * into a left (`L`) and right (`R`) half; each half may be split again into an
 * upper and lower quarter (`LU`/`LL`, `RU`/`RL`).
 */
export type Slot = 'F' | 'L' | 'R' | 'LU' | 'LL' | 'RU' | 'RL';
export const SLOTS: readonly Slot[] = ['F', 'L', 'R', 'LU', 'LL', 'RU', 'RL'];

/** Synoptic (SYSTEMS window) pages, in CHK/SYS key cycle order. */
export const SysPage = {
  Status: 0,
  AcElec: 1,
  DcElec: 2,
  Fuel: 3,
  Hyd: 4,
  FltCtrl: 5,
  Bleed: 6,
  AntiIce: 7,
  Ecs: 8,
  Doors: 9,
} as const;
export type SysPage = (typeof SysPage)[keyof typeof SysPage];
/** Page titles (Global Express EICAS control panel keys STAT / HYD / AC ELEC / BLEED / AIR COND / DC ELEC / FUEL / FLT CTRL, plus ANTI-ICE and DOORS). */
export const SYS_PAGE_TITLES: readonly string[] = ['STATUS', 'AC ELECTRICAL', 'DC ELECTRICAL', 'FUEL', 'HYDRAULIC', 'FLIGHT CONTROLS', 'BLEED', 'ANTI-ICE', 'AIR COND / PRESS', 'DOORS'];
export const SYS_PAGE_TABS: readonly string[] = ['STAT', 'AC', 'DC', 'FUEL', 'HYD', 'F/CTL', 'BLEED', 'A/ICE', 'ECS', 'DOORS'];
export const SYS_PAGE_COUNT = SYS_PAGE_TITLES.length;

/** PFD navigation source (CTP NAV SRC). Same numbering as `ap.nav_source`. */
export const NavSrc = { Fms: 0, Nav1: 1, Nav2: 2 } as const;
/** Bearing pointer source (CTP BRG 1 / BRG 2): off, VOR (on-side receiver of the pointer), ADF, FMS. */
export const BrgSrc = { Off: 0, Vor: 1, Adf: 2, Fms: 3 } as const;

export const FUSION_VARS = {
  // --------------------------------------------------------- display units
  /** 1 = full window format, 0 = split into halves. */
  afdFull: (n: number) => `fusion.afd${n}.full`,
  /** Content code (Win) of slot `slot` of AFD `n`. */
  afdWin: (n: number, slot: Slot) => `fusion.afd${n}.win_${slot.toLowerCase()}`,
  /** 1 = the half ('L' / 'R') is split into upper / lower quarters. */
  afdHalfSplit: (n: number, half: 'L' | 'R') => `fusion.afd${n}.split_${half.toLowerCase()}`,
  /** Output: 1 when AFD `n` is powered, not failed and not switched off. */
  afdOperating: (n: number) => `fusion.afd${n}.op`,
  /** Output: 1 while the display shows a reversionary (composite) format. */
  afdReversion: (n: number) => `fusion.afd${n}.rev`,
  /** Failure injection for AFD `n` (FailureManager id `fusion.afd{n}`). */
  afdFail: (n: number) => `fail.fusion.afd${n}`,
  /** Output: AFD number that shows side `s`'s PFD (0 = none). */
  pfdOn: (s: number) => `fusion.s${s}.pfd_afd`,
  /** Output: AFD number that shows the EICAS window (0 = none). */
  eicasOn: 'fusion.eicas_afd',
  /** Selected SYSTEMS (synoptic) page per side (SysPage). */
  sysPage: (s: number) => `fusion.s${s}.sys_page`,

  // --------------------------------------------------------- PFD settings (CTP)
  navSource: (s: number) => `fusion.s${s}.nav_src`,
  brg: (s: number, n: 1 | 2) => `fusion.s${s}.brg${n}`,
  svs: (s: number) => `fusion.s${s}.svs`,
  /** HSI format on the PFD: 0 = ARC (partial compass), 1 = ROSE (360). */
  hsiRose: (s: number) => `fusion.s${s}.hsi_rose`,
  baroHpa: (s: number) => `fusion.s${s}.baro_hpa`,
  /** Baro preselect armed while STD is selected (value in inHg; 0 = none). */
  baroPreset: (s: number) => `fusion.s${s}.baro_pre`,
  /** 1 = flight path vector caged (drift removed). Yoke FPV CAGE button (FSB: "FPV Cage button on yoke"). */
  fpvCaged: (s: number) => `fusion.s${s}.fpv_caged`,
  /** Metric altitude readouts on the PFD (FSB: "Preselect altitudes appear in feet and meters"). */
  metric: (s: number) => `fusion.s${s}.metric`,
  /** Resolved air data / attitude sensor index used by side `s` (after RSP reversion). */
  adcSrc: (s: number) => `fusion.s${s}.adc_src`,
  ahrsSrc: (s: number) => `fusion.s${s}.ahrs_src`,
  raSrc: (s: number) => `fusion.s${s}.ra_src`,

  // --------------------------------------------------------- CTP
  ctpPage: (s: number) => `fusion.ctp${s}.page`,
  ctpSel: (s: number) => `fusion.ctp${s}.sel`,
  /** Standby HSI shown on the CTP display (FSB: "Standby HSI on CTP"). */
  ctpHsi: (s: number) => `fusion.ctp${s}.hsi`,

  // --------------------------------------------------------- RSP (reversion switch panel)
  /** 0 = NORM (on-side ADC), 1 = cross-side ADC, 2 = standby ADC 3. */
  rspAdc: (s: number) => `fusion.rsp${s}.adc`,
  /** 0 = NORM (on-side IRS), 1 = IRS 3. */
  rspAtt: (s: number) => `fusion.rsp${s}.att`,
  /** 0 = NORM, 1 = REV (PFD + EICAS composite on the on-side outboard AFD). */
  rspDspl: (s: number) => `fusion.rsp${s}.dspl`,
  /** Active flight guidance channel 1 / 2 (FSB: "AFCS 1-2 switch relocated to reversion switch panel"). */
  rspAfcs: 'fusion.rsp.afcs',

  // --------------------------------------------------------- FCP
  /** Coupled (flight director / autopilot reference) side 1 / 2. */
  coupleSide: 'fusion.fcp.cpl',
  /** Speed target source: 0 = MAN (FCP knob), 1 = FMS. */
  spdFms: 'fusion.fcp.spd_fms',
  /** ALT knob fine (100 ft) mode (FSB: "Altitude knob PUSH FINE function"). */
  altFine: 'fusion.fcp.alt_fine',
  /** Emergency Descent Mode active (FSB: "Emergency Descent Mode (EDM) button on FCP"). */
  edm: 'fusion.fcp.edm',
  fcpBrt: 'fusion.fcp.brt',

  // --------------------------------------------------------- cursor (CCP)
  cursorDu: (s: number) => `fusion.ccp${s}.du`,
  cursorX: (s: number) => `fusion.ccp${s}.x`,
  cursorY: (s: number) => `fusion.ccp${s}.y`,
  cursorVisible: (s: number) => `fusion.ccp${s}.vis`,

  // --------------------------------------------------------- FMS / MKP
  execLight: 'fusion.mkp.exec',
  msgLight: (s: number) => `fusion.mkp${s}.msg`,
  /** V-speeds from the FMS TOLD pages (kt; 0 = not set). */
  vspd: (id: 'v1' | 'vr' | 'v2' | 'vt' | 'vref' | 'vapp') => `fusion.vspd.${id}`,

  // --------------------------------------------------------- CAS / ECL
  casScroll: 'fusion.cas.scroll',
  casHiddenBelow: 'fusion.cas.hidden_below',
  eclList: 'fusion.ecl.list',
  eclCursor: 'fusion.ecl.cursor',
  eclComplete: 'fusion.ecl.complete',

  // --------------------------------------------------------- misc
  /** 1 skips the AFD power-up test (in-air / running initial states). */
  bootSkip: 'fusion.boot_skip',
  /** Output: engine N1 exceedance (either engine) for the EICAS reversion rule. */
  engExceed: 'fusion.eng.exceed',
  /** IESI baro setting (inHg) and STD. */
  iesiBaro: 'fusion.iesi.baro_inhg',
  iesiStd: 'fusion.iesi.std',
  /** Chronometer seconds / running per side. */
  chronoS: (s: number) => `fusion.s${s}.chrono_s`,
  chronoRun: (s: number) => `fusion.s${s}.chrono_run`,
} as const;

/** String vars. */
export const FUSION_STRINGS = {
  /** FMS page id shown in side `s`'s FMS window. */
  fmsPage: (s: number) => `fusion.s${s}.fms_page`,
  fmsScratch: (s: number) => `fusion.s${s}.fms_scratch`,
  /** Hot spot id under side `s`'s cursor ('' = none). */
  cursorHover: (s: number) => `fusion.ccp${s}.hover`,
} as const;

export const FUSION_EVENTS = {
  /** FCP button `id` (FCP_BUTTONS) or knob event `<knob>_inc` / `<knob>_dec` (payload = clicks). */
  fcp: (id: string) => `fusion.fcp.${id}`,
  /** CCP: trackball motion {dx, dy} (px of pointer drag). */
  ccpMove: (s: number) => `fusion.ccp${s}.move`,
  ccpEnter: (s: number) => `fusion.ccp${s}.enter`,
  ccpMenu: (s: number) => `fusion.ccp${s}.menu`,
  ccpBack: (s: number) => `fusion.ccp${s}.back`,
  /** CCP DATA knob: payload {steps, inner} or a number of steps. */
  ccpData: (s: number) => `fusion.ccp${s}.data`,
  ccpDataInc: (s: number, inner = false) => `fusion.ccp${s}.data${inner ? '_in' : ''}_inc`,
  ccpDataDec: (s: number, inner = false) => `fusion.ccp${s}.data${inner ? '_in' : ''}_dec`,
  /** CCP display select key: payload 'PFD' | 'UPR' | 'LWR' (jumps the cursor). */
  ccpDisplay: (s: number) => `fusion.ccp${s}.dsp`,
  /** MKP key id (MKP_KEYS) of side `s`. */
  mkpKey: (s: number) => `fusion.mkp${s}.key`,
  /** CTP line select key 1..6 (1-3 left, 4-6 right). */
  ctpLsk: (s: number) => `fusion.ctp${s}.lsk`,
  /** CTP function key id (CTP_KEYS). */
  ctpKey: (s: number) => `fusion.ctp${s}.key`,
  /** CTP knobs: `tune_out` / `tune_in` / `baro` / `mins` + `_inc` / `_dec`; `tune_push` / `baro_push` / `mins_push`. */
  ctp: (s: number, id: string) => `fusion.ctp${s}.${id}`,
  /** Yoke FPV CAGE button (toggle). */
  fpvCage: (s: number) => `fusion.s${s}.fpv_cage`,
  /** IESI baro knob: `baro_inc` / `baro_dec` / `baro_push`. */
  iesi: (id: string) => `fusion.iesi.${id}`,
  /** Chronometer: payload 'startstop' | 'reset'. */
  chrono: (s: number) => `fusion.s${s}.chrono`,
} as const;
