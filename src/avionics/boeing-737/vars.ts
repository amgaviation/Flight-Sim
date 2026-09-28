/**
 * SimVar and EventBus names of the Boeing 737NG avionics suite (Common
 * Display System, EFIS control panels, display select panels, MCP, AFDS
 * glue, FMC / CDUs).
 *
 * Naming: aircraft-specific state uses the `ac.` prefix (CLAUDE.md). The
 * suite writes the standard `ap.*`, `fms.*`, `nav{r}.*`, `adc{s}.baro_*`,
 * `ap.mins{s}_*` vars that the shared systems read, and keeps everything
 * else here. Side 1 = Captain, side 2 = First Officer.
 *
 * Cockpit wiring (see docs/modules/avionics-boeing-737.md §7): switches and
 * selectors write the *input* vars below (the suite follows external writes
 * every update, so state presets can set them directly); momentary buttons
 * and knob encoders emit the *events* (payload of a knob event = click
 * count, the cockpit `RotaryKnob` encoder convention).
 */
import { DISPLAY_VARS } from '../../cockpit/types';

export type Side = 1 | 2;

/** The six display units (FCOM 10.10 "Display Units"): outboard/inboard per pilot, upper and lower centre. */
export type DuId = 'capt_out' | 'capt_in' | 'upper' | 'lower' | 'fo_in' | 'fo_out';
export const DU_IDS: readonly DuId[] = ['capt_out', 'capt_in', 'upper', 'lower', 'fo_in', 'fo_out'];

/** Cockpit display id of a DU (`CockpitDisplay.id`, also the `display.<id>.power` / `.brt` var names). */
export function duDisplayId(du: DuId): string {
  return `b737_du_${du}`;
}

/** Formats a DU can show. */
export enum DuFormat {
  Blank = 0,
  Pfd = 1,
  Nd = 2,
  /** Primary engine display (N1, EGT, fuel quantity, alerts): normally the upper centre DU. */
  EngPrimary = 3,
  /** Secondary engine display (N2, FF, oil, vibration): MFD ENG on the lower DU. */
  EngSecondary = 4,
  /** Systems display (hydraulics, flight control surface positions): MFD SYS. */
  Sys = 5,
  /** Compact engine display (primary + secondary in one format) when only one centre DU can show engines. */
  EngCompact = 6,
}

/** EFIS control panel ND mode selector (FCOM 10.10 "EFIS Control Panel"). */
export enum NdMode {
  App = 0,
  Vor = 1,
  Map = 2,
  Pln = 3,
}

/** ND range selector detents (nm): 5 to 640 (FCOM "Range selector"). */
export const ND_RANGES_NM = [5, 10, 20, 40, 80, 160, 320, 640] as const;

/** MAIN PANEL DUs selector (display select panel), clockwise from the outboard end. */
export enum MainPanelDuSel {
  OutbdPfd = 0,
  Norm = 1,
  InbdEngPri = 2,
  InbdPfd = 3,
  InbdMfd = 4,
}

/** LOWER DU selector. */
export enum LowerDuSel {
  EngPri = 0,
  Norm = 1,
  Nd = 2,
}

/** MFD format selected with the ENG / SYS switches. */
export enum MfdFormat {
  None = 0,
  Eng = 1,
  Sys = 2,
}

/** Map option switches on the EFIS control panel (bottom row). */
export const EFIS_MAP_BUTTONS = ['wxr', 'sta', 'wpt', 'arpt', 'data', 'pos', 'terr'] as const;
export type EfisMapButton = (typeof EFIS_MAP_BUTTONS)[number];

export const B737_VARS = {
  // ------------------------------------------------------------------ EFIS control panel (inputs + state)
  /** MINS reference selector (outer ring): 0 RADIO, 1 BARO. */
  efisMinsRef: (s: Side) => `ac.efis${s}.mins_ref`,
  /** Selected radio / baro minimums (ft); -1 = not set (blank on the PFD). */
  efisMinsRadioFt: (s: Side) => `ac.efis${s}.mins_radio_ft`,
  efisMinsBaroFt: (s: Side) => `ac.efis${s}.mins_baro_ft`,
  /** BARO units selector (outer ring): 0 IN (inHg), 1 HPA. */
  efisBaroHpa: (s: Side) => `ac.efis${s}.baro_hpa`,
  /** Baro preselect (inHg) shown under STD while the standard setting is in use. */
  efisBaroPresel: (s: Side) => `ac.efis${s}.baro_presel_inhg`,
  /** FPV / MTRS push switches (state 0/1). */
  efisFpv: (s: Side) => `ac.efis${s}.fpv`,
  efisMtrs: (s: Side) => `ac.efis${s}.mtrs`,
  /** ND mode selector (NdMode) and CTR state (0 expanded, 1 centred). */
  efisMode: (s: Side) => `ac.efis${s}.nd_mode`,
  efisCtr: (s: Side) => `ac.efis${s}.ctr`,
  /** Range selector detent index 0..7 (ND_RANGES_NM). */
  efisRange: (s: Side) => `ac.efis${s}.range`,
  /** TFC (traffic) state toggled by the range-selector push (0/1). */
  efisTfc: (s: Side) => `ac.efis${s}.tfc`,
  /** VOR/ADF switches: -1 ADF, 0 OFF, 1 VOR (n = pointer 1 / 2). */
  efisVorAdf: (s: Side, n: 1 | 2) => `ac.efis${s}.vor_adf${n}`,
  /** Map option switch states (0/1): wxr, sta, wpt, arpt, data, pos, terr. */
  efisMapButton: (s: Side, b: EfisMapButton) => `ac.efis${s}.${b}`,
  /** Resolved range (nm) of the ND on side s (output). */
  ndRangeNm: (s: Side) => `ac.efis${s}.range_nm`,

  // ------------------------------------------------------------------ display select / MFD / transfer switches (inputs)
  /** MAIN PANEL DUs selector (MainPanelDuSel). */
  mainPanelDus: (s: Side) => `ac.cds.main_panel_dus${s}`,
  /** LOWER DU selector (LowerDuSel). */
  lowerDu: (s: Side) => `ac.cds.lower_du${s}`,
  /** MFD format state (MfdFormat), toggled by the ENG / SYS switches (events). */
  mfdFormat: 'ac.cds.mfd_format',
  /** DISPLAYS SOURCE selector: -1 ALL ON 1, 0 AUTO, 1 ALL ON 2 (instrument transfer panel). */
  displaysSource: 'ac.cds.source_sel',
  /** DISPLAYS CONTROL PANEL selector: -1 BOTH ON 1, 0 NORMAL, 1 BOTH ON 2. */
  controlPanelSel: 'ac.cds.ctl_panel_sel',
  /** VHF NAV transfer switch: -1 BOTH ON 1, 0 NORMAL, 1 BOTH ON 2. */
  vhfNavSel: 'ac.cds.vhf_nav_sel',
  /** IRS transfer switch: -1 BOTH ON L, 0 NORMAL, 1 BOTH ON R. */
  irsSel: 'ac.cds.irs_sel',
  /** FMC transfer switch (dual-FMC option): -1 BOTH ON L, 0 NORMAL, 1 BOTH ON R. */
  fmcSel: 'ac.cds.fmc_sel',

  // ------------------------------------------------------------------ CDS outputs
  /** Format shown by a DU (DuFormat). */
  duFormat: (du: DuId) => `ac.cds.${du}.format`,
  /** Data side of the PFD / ND shown by a DU (1 / 2), 0 = n/a. */
  duSide: (du: DuId) => `ac.cds.${du}.side`,
  /** 1 while a DU is failed or unpowered (the CDS moves formats away from it). */
  duFailed: (du: DuId) => `ac.cds.${du}.failed`,
  /** DEU n operating (1/0). */
  deuOk: (n: 1 | 2) => `ac.cds.deu${n}_ok`,
  /** DEU driving the DUs of side s / centre (1 or 2), 0 = none. */
  deuFor: (du: DuId) => `ac.cds.${du}.deu`,
  /** 'DSPLY SOURCE' annunciation (1 = shown on both PFDs; source number in ac.cds.dsply_source_n). */
  dsplySource: 'ac.cds.dsply_source',
  dsplySourceN: 'ac.cds.dsply_source_n',
  /** 'CDS FAULT' annunciation (ground, DEU fault). */
  cdsFault: 'ac.cds.fault',
  /** 'DISPLAYS CONTROL PANEL' annunciation / failed EFIS panel side (0 none). */
  ctlPanelFail: 'ac.cds.ctl_panel_fail',
  /** Effective EFIS control panel for side s (1 / 2) after the CONTROL PANEL switch. */
  efisSourceFor: (s: Side) => `ac.cds.efis_src${s}`,
  /** Effective air data / IRS (adc/ahrs index) and VHF NAV receiver for side s. */
  airDataFor: (s: Side) => `ac.cds.adc_src${s}`,
  navRxFor: (s: Side) => `ac.cds.nav_src${s}`,
  /** Engine display exceedance / auto pop-up of the secondary engine format (1 while forced). */
  engSecondaryAuto: 'ac.cds.eng2_auto',

  // ------------------------------------------------------------------ centre panel: N1 SET, SPD REF, FUEL FLOW
  /** N1 SET outer knob: 0 AUTO, 1 BOTH, 2 ENG 1, 3 ENG 2. */
  n1SetSel: 'ac.n1set.sel',
  /** Manually set N1 reference (%) per engine (inner knob). */
  n1SetManual: (e: 1 | 2) => `ac.n1set.eng${e}_pct`,
  /** SPD REF outer knob: 0 AUTO, 1 V1, 2 VR, 3 WT, 4 VREF, 5 B (white bug), 6 SET. */
  spdRefSel: 'ac.spdref.sel',
  /** Manual reference speeds set with SPD REF (kt; 0 = not set) and gross weight (kg). */
  spdRefV1: 'ac.spdref.v1_kt',
  spdRefVr: 'ac.spdref.vr_kt',
  spdRefVref: 'ac.spdref.vref_kt',
  spdRefBug: 'ac.spdref.bug_kt',
  spdRefWtKg: 'ac.spdref.wt_kg',
  /** FUEL FLOW switch: -1 RESET (momentary), 0 RATE, 1 USED. */
  ffSwitch: 'ac.ff_switch',
  /** Fuel used per engine since the last reset (kg). */
  fuelUsedKg: (e: 1 | 2) => `ac.eng${e}.fuel_used_kg`,

  // ------------------------------------------------------------------ MCP (outputs; inputs are events + standard ap.* vars)
  /** DISENGAGE bar: 1 = pulled down (A/P disengaged and engagement inhibited). */
  mcpDisengageBar: 'ac.mcp.disengage_bar',
  /** MCP window text (string vars) for the cockpit's MCP displays. */
  mcpWinCrs: (s: Side) => `ac.mcp.win_crs${s}`,
  mcpWinSpd: 'ac.mcp.win_spd',
  mcpWinHdg: 'ac.mcp.win_hdg',
  mcpWinAlt: 'ac.mcp.win_alt',
  mcpWinVs: 'ac.mcp.win_vs',
  /** IAS/MACH window limit symbol: 0 none, 1 overspeed ('8' flashing), -1 underspeed ('A' flashing). */
  mcpSpdLimit: 'ac.mcp.spd_limit',
  /** MCP button lights (0/1): n1, speed, lvlchg, vnav, hdgsel, lnav, vorloc, app, althld, vs, cmd_a, cmd_b, cws_a, cws_b, at_arm. */
  mcpLight: (name: string) => `ac.mcp.lt_${name}`,
  /** Flight director master (MA) lights per side (0/1). */
  mcpMaLight: (s: Side) => `ac.mcp.ma${s}`,
  /** Speed intervention active (VNAV with the MCP speed window opened). */
  mcpSpdIntv: 'ac.mcp.spd_intv',
  /** Airspeed cursor shown on the PFD speed tape (kt IAS) and its Mach value (0 = IAS target). */
  mcpSpdCursorKt: 'ac.mcp.spd_cursor_kt',
  mcpSpdCursorMach: 'ac.mcp.spd_cursor_mach',
  /** 1 while the MCP IAS/MACH window is blank (VNAV FMC SPD, TO/GA). */
  mcpSpdBlank: 'ac.mcp.spd_blank',
  /** 1 while the MCP V/S window is blank (V/S not engaged). */
  mcpVsBlank: 'ac.mcp.vs_blank',
  /** Selected-altitude alert state on the PFD: 0 none, 1 acquisition (white box), 2 deviation (amber flash). */
  altAlertState: (s: Side) => `ac.pfd${s}.alt_alert`,

  // ------------------------------------------------------------------ AFDS annunciations (outputs)
  /** FMA text per column (string vars): A/T mode, roll engaged/armed, pitch engaged/armed, AFDS status. */
  fmaAt: 'ac.fma.at',
  fmaRoll: 'ac.fma.roll',
  fmaRollArmed: 'ac.fma.roll_armed',
  fmaPitch: 'ac.fma.pitch',
  fmaPitchArmed: 'ac.fma.pitch_armed',
  fmaStatus: 'ac.fma.status',
  /** FMA colour codes: 0 green, 1 amber (CWS P/R, SINGLE CH, NO AUTOLAND). */
  fmaRollAmber: 'ac.fma.roll_amber',
  fmaPitchAmber: 'ac.fma.pitch_amber',
  fmaStatusAmber: 'ac.fma.status_amber',
  /** Autopilot / autothrottle / FMC disconnect light states (0 off, 1 red, 2 amber; already flash-phased). */
  apDiscLight: 'ac.afds.ap_light',
  atDiscLight: 'ac.afds.at_light',
  fmcAlertLight: 'ac.afds.fmc_light',
  /** Disengage light TEST switch: -1 position 1 (amber), 0 off, 1 position 2 (red). */
  discLightTest: 'ac.afds.light_test',
  /** F/O disengage light TEST switch (same convention; the AFDS / FMC combine it with `discLightTest`). */
  discLightTest2: 'ac.afds.light_test2',
  /** STAB OUT OF TRIM light (A/P engaged, mistrim). */
  stabOutOfTrim: 'ac.afds.stab_out_of_trim',

  // ------------------------------------------------------------------ FMC outputs
  fmcV1: 'ac.fmc.v1_kt',
  fmcVr: 'ac.fmc.vr_kt',
  fmcV2: 'ac.fmc.v2_kt',
  fmcVref: 'ac.fmc.vref_kt',
  fmcVrefFlaps: 'ac.fmc.vref_flaps',
  fmcToFlaps: 'ac.fmc.to_flaps',
  fmcGwKg: 'ac.fmc.gw_kg',
  fmcZfwKg: 'ac.fmc.zfw_kg',
  fmcCostIndex: 'ac.fmc.ci',
  fmcTransAltFt: 'ac.fmc.trans_alt_ft',
  fmcTransLvlFt: 'ac.fmc.trans_lvl_ft',
  /** Destination / landing runway elevation (ft) for the PFD landing altitude bar; NaN-safe: -9999 = unknown. */
  fmcLandingElevFt: 'ac.fmc.ldg_elev_ft',
  /** EXEC key light: MOD plan or MOD performance data pending. */
  fmcExecLight: 'ac.fmc.exec_light',
  /** CDU MSG light per CDU (1 = left, 2 = right). */
  cduMsgLight: (s: Side) => `ac.cdu${s}.msg_light`,
  /** CDU OFST light (lateral offset active; SCOPE: offsets not implemented, always 0). */
  cduOfstLight: (s: Side) => `ac.cdu${s}.ofst_light`,
  /** CDU brightness (0..1, BRT knob). */
  cduBrt: (s: Side) => `ac.cdu${s}.brt`,
  /** Actual / required navigation performance (nm). */
  fmcAnpNm: 'ac.fmc.anp_nm',
  fmcRnpNm: 'ac.fmc.rnp_nm',
  /** FMC position source annunciation for the ND ('FMC L' etc.) is derived; this is the IRS/GPS mix code. */
  fmcPosSource: 'ac.fmc.pos_src',
  /** PLN mode map centre: plan leg index (LEGS page STEP). */
  fmcPlanCtrLeg: 'ac.fmc.plan_ctr_leg',
  /** Selected climb / cruise / descent mode names (strings: 'ECON', 'MAX RATE', 'LRC', ...). */
  fmcClbMode: 'ac.fmc.clb_mode',
  fmcCrzMode: 'ac.fmc.crz_mode',
  fmcDesMode: 'ac.fmc.des_mode',
  /** 1 while the FMC is failed / unpowered. */
  fmcFailed: 'ac.fmc.failed',
  /** DES NOW selected on the DES page (the AFDS starts a VNAV descent before T/D). */
  fmcDesNow: 'ac.fmc.des_now',
  /** Take-off thrust reduction / acceleration heights (ft AGL above the origin) from TAKEOFF REF 2/2. */
  fmcThrRedFt: 'ac.fmc.thr_red_ft',
  fmcAccelHtFt: 'ac.fmc.accel_ht_ft',
  /** Origin / destination elevation (ft) used by the AFDS for AGL heights. */
  fmcOriginElevFt: 'ac.fmc.origin_elev_ft',
  /** Selected take-off / climb N1 ratings (strings) and the active one ('TO', 'CLB-1', ...). */
  fmcN1Rating: 'ac.fmc.n1_rating',
  /** 1 while the FMC performance data needed by VNAV is complete (GW, cost index, cruise altitude). */
  fmcPerfValid: 'ac.fmc.perf_valid',
  /** CDU FAIL annunciator per CDU. */
  cduFailLight: (s: Side) => `ac.cdu${s}.fail_light`,
} as const;

/** EventBus commands of the suite (payload in brackets). */
export const B737_EVENTS = {
  // EFIS control panel (side s)
  /** MINS knob [clicks, > 0], and its push (RST). */
  efisMinsInc: (s: Side) => `ac.efis${s}.mins_inc`,
  efisMinsDec: (s: Side) => `ac.efis${s}.mins_dec`,
  efisMinsRst: (s: Side) => `ac.efis${s}.mins_rst`,
  /** BARO knob [clicks] and its push (STD). */
  efisBaroInc: (s: Side) => `ac.efis${s}.baro_inc`,
  efisBaroDec: (s: Side) => `ac.efis${s}.baro_dec`,
  efisBaroStd: (s: Side) => `ac.efis${s}.baro_std`,
  /** Mode selector push (CTR) and range selector push (TFC). */
  efisCtr: (s: Side) => `ac.efis${s}.ctr_push`,
  efisTfc: (s: Side) => `ac.efis${s}.tfc_push`,
  /** FPV / MTRS / map option buttons (momentary; the suite toggles the state vars). */
  efisFpv: (s: Side) => `ac.efis${s}.fpv_push`,
  efisMtrs: (s: Side) => `ac.efis${s}.mtrs_push`,
  efisMapButton: (s: Side, b: EfisMapButton) => `ac.efis${s}.${b}_push`,
  // MFD
  mfdEng: 'ac.mfd.eng',
  mfdSys: 'ac.mfd.sys',
  /** C/R (cancel / recall; fail-operational aircraft). */
  mfdCr: 'ac.mfd.cr',
  // centre panel knobs
  n1SetInc: 'ac.n1set.inc',
  n1SetDec: 'ac.n1set.dec',
  spdRefInc: 'ac.spdref.inc',
  spdRefDec: 'ac.spdref.dec',
  // MCP knobs [clicks]
  mcpCrsInc: (s: Side) => `ac.mcp.crs${s}_inc`,
  mcpCrsDec: (s: Side) => `ac.mcp.crs${s}_dec`,
  mcpSpdInc: 'ac.mcp.spd_inc',
  mcpSpdDec: 'ac.mcp.spd_dec',
  mcpHdgInc: 'ac.mcp.hdg_inc',
  mcpHdgDec: 'ac.mcp.hdg_dec',
  mcpAltInc: 'ac.mcp.alt_inc',
  mcpAltDec: 'ac.mcp.alt_dec',
  /** V/S thumbwheel: UP = nose down (more negative), per the MCP wheel markings [clicks]. */
  mcpVsDn: 'ac.mcp.vs_dn',
  mcpVsUp: 'ac.mcp.vs_up',
  mcpSpdIntv: 'ac.mcp.spd_intv',
  mcpAltIntv: 'ac.mcp.alt_intv',
  /** Bank angle selector [clicks]: 10 / 15 / 20 / 25 / 30 deg (writes ap.bank_sel_deg). */
  mcpBankInc: 'ac.mcp.bank_inc',
  mcpBankDec: 'ac.mcp.bank_dec',
  /** MCP buttons (momentary). */
  mcpButton: (name: McpButton) => `ac.mcp.${name}`,
  // AFDS lights
  apLightPush: 'ac.afds.ap_light_push',
  atLightPush: 'ac.afds.at_light_push',
  fmcLightPush: 'ac.afds.fmc_light_push',
  // CDU key: `ac.cdu<s>.key` with payload = key id (CduKey), or `ac.cdu<s>.<key>` (KeyPad eventPrefix)
  cduKey: (s: Side) => `ac.cdu${s}.key`,
  cduKeyPrefix: (s: Side) => `ac.cdu${s}.`,
  cduBrtInc: (s: Side) => `ac.cdu${s}.brt_inc`,
  cduBrtDec: (s: Side) => `ac.cdu${s}.brt_dec`,
} as const;

export const MCP_BUTTONS = ['n1', 'speed', 'co', 'lvlchg', 'vnav', 'hdgsel', 'lnav', 'vorloc', 'app', 'althld', 'vs', 'cmd_a', 'cmd_b', 'cws_a', 'cws_b'] as const;
export type McpButton = (typeof MCP_BUTTONS)[number];

/** Convenience: power / brightness var of a DU display. */
export const DU_DISPLAY_VARS = {
  power: (du: DuId) => DISPLAY_VARS.power(duDisplayId(du)),
  brightness: (du: DuId) => DISPLAY_VARS.brightness(duDisplayId(du)),
};

/** Cockpit display ids of the CDU screens (1 = left, 2 = right). */
export function cduDisplayId(s: Side): string {
  return s === 1 ? 'b737_cdu_l' : 'b737_cdu_r';
}
