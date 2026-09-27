/**
 * SimVar and EventBus names owned by the Garmin G1000 NXi suite
 * (`src/avionics/garmin-g1000`). Everything the suite publishes lives in the
 * `g1k.` namespace; standard vars it reads or writes on behalf of the pilot
 * (radio frequencies, transponder, AFCS selected values, minimums, baro) use
 * the names from `core/vars.ts` so every other system sees them.
 *
 * Numeric codes are listed next to each var; string vars say so.
 * docs/modules/avionics-garmin-g1000.md has the full reference.
 *
 * Source for every control / mode name: Garmin G1000 NXi Pilot's Guide for
 * the Cessna NAV III, 190-02177-02 Rev. A (Dec 2019, GDU 20.83) — cited as
 * "PG" — and the Cockpit Reference Guide 190-02824-00 Rev. A (2021, system
 * software 4013.00) — cited as "CRG".
 */
export { vn } from '../garmin-g3000/vars';

/** The two GDUs of the Cessna NAV III NXi: GDU 1054B (with Garmin AFCS) or GDU 1050 (PG §1.1). */
export type GduId = 'pfd' | 'mfd';
export const GDU_IDS: readonly GduId[] = ['pfd', 'mfd'];

/**
 * Line-replaceable units whose power / failure the suite models (PG §1.1
 * "Line Replaceable Units"): the two displays, the two GIA 63W integrated
 * avionics units (#1 NAV1/COM1/GPS1 + flight director, #2 NAV2/COM2/GPS2),
 * the GEA 71B engine/airframe unit, the GSU 75 ADAHRS (air data + attitude),
 * the GMU 44 magnetometer, the GTX 345R transponder, the GMA 1360 audio
 * panel, the GFC 700 servos, and the optional KN 63 DME / KR 87 ADF.
 */
export type G1kUnit = 'pfd' | 'mfd' | 'gia1' | 'gia2' | 'com1' | 'com2' | 'gea' | 'adahrs' | 'gmu' | 'xpdr' | 'gma' | 'servos' | 'dme' | 'adf';
/** `com1` / `com2`: the COM transceiver sections of the GIAs, on their own breakers (POH NAV III: COMM 1 on ESS, COMM 2 on AVN 2). */
export const G1K_UNITS: readonly G1kUnit[] = ['pfd', 'mfd', 'gia1', 'gia2', 'com1', 'com2', 'gea', 'adahrs', 'gmu', 'xpdr', 'gma', 'servos', 'dme', 'adf'];

/** CDI / navigation source (CDI softkey cycles GPS -> NAV1 -> NAV2 -> GPS, PG §2.1). Same codes as `ap.nav_source`. */
export const CDI_SOURCE = { gps: 0, nav1: 1, nav2: 2 } as const;
/** Bearing pointer sources (PFD Opt > Bearing 1/2 cycles NAV1 -> NAV2 -> GPS -> ADF -> Off, PG §2.1). */
export const BRG_SOURCE = { off: 0, nav1: 1, nav2: 2, gps: 3, adf: 4 } as const;
/** PFD map layout (Map/HSI > Layout, PG Table 1-3): off, inset map, HSI map, inset traffic, HSI traffic. */
export const PFD_MAP = { off: 0, inset: 1, hsi: 2, insetTraffic: 3, hsiTraffic: 4 } as const;
/** Wind option (PFD Opt > Wind, PG §2.2): 0 off, 1 head/cross components, 2 arrow + speed, 3 arrow + direction/speed. */
export const WIND_OPTION = { off: 0, option1: 1, option2: 2, option3: 3 } as const;
/** Minimums (Tmr/Ref window MINS field, PG §2.4): OFF / BARO / TEMP COMP. */
export const MINS_MODE = { off: 0, baro: 1, tempComp: 2 } as const;
/** DME tuning mode (DME Tuning window, PG §4.3). */
export const DME_MODE = { nav1: 0, nav2: 1, hold: 2 } as const;
/** EIS display (Engine softkey tree, PG Table 3-1): 0 Engine (default strip), 1 Lean, 2 System. */
export const EIS_PAGE = { engine: 0, lean: 1, system: 2 } as const;
/** Map orientation (MFD Map Settings > Orientation, PG §5.2). */
export const MAP_ORIENT = { northUp: 0, trackUp: 1, headingUp: 2 } as const;
/** Map terrain overlay (TER softkey: Off / Topo / REL, PG Table 1-4). */
export const MAP_TER = { off: 0, topo: 1, rel: 2 } as const;
/** Airways overlay (AWY softkey: Off / On / LO / HI). */
export const MAP_AWY = { off: 0, on: 1, lo: 2, hi: 3 } as const;

const gdu = (g: string, k: string): string => `g1k.${g}.${k}`;

/** Suite SimVars (`g1k.*`). */
export const G1K = {
  // ---------------------------------------------------------------- units / power / boot
  /** 1 once the suite logic ran (tests / debug). */
  alive: 'g1k.alive',
  /** 1 while the unit has power and is not failed: `g1k.<unit>.powered`. */
  unitPowered: (u: string) => `g1k.${u}.powered`,
  /** 1 while the unit is powered but still booting / self-testing. */
  unitBooting: (u: string) => `g1k.${u}.booting`,
  /** 1 once the unit is up (powered, booted, not failed). */
  unitUp: (u: string) => `g1k.${u}.up`,
  /** MFD power-on (database) page acknowledged with ENT (PG §1.3 "System Power-on"). */
  mfdSplashAck: 'g1k.mfd.splash_ack',
  /** Reversionary mode per GDU (1 = shows PFD + EIS). */
  reversionary: (g: GduId) => `g1k.${g}.reversionary`,
  /** DISPLAY BACKUP latch (GMA red button, PG §1.3 "Reversionary Mode"): 1 = manual reversion selected. */
  displayBackup: 'g1k.display_backup',
  /** Display backlight: 0 = Auto (photocell / dimmer bus), 1 = Manual (PFD Setup Menu, PG §1.5). */
  brtManual: (g: GduId) => gdu(g, 'brt_manual'),
  /** Manual backlight intensity 0..100 %. */
  brtPct: (g: GduId) => gdu(g, 'brt_pct'),
  keyBrtManual: (g: GduId) => gdu(g, 'key_brt_manual'),
  keyBrtPct: (g: GduId) => gdu(g, 'key_brt_pct'),
  /** Bezel key backlight 0..1 (for the cockpit key-lighting material). */
  keyLight: (g: GduId) => gdu(g, 'key_light'),

  // ---------------------------------------------------------------- PFD settings
  cdiSource: 'g1k.pfd.cdi_src',
  brg1Source: 'g1k.pfd.brg1_src',
  brg2Source: 'g1k.pfd.brg2_src',
  pfdMap: 'g1k.pfd.map',
  pfdMapRange: 'g1k.pfd.map_range_nm',
  pfdMapDetail: 'g1k.pfd.map_detail',
  pfdMapTraffic: 'g1k.pfd.map_traffic',
  pfdMapTer: 'g1k.pfd.map_ter',
  windOption: 'g1k.pfd.wind',
  dmeWindow: 'g1k.pfd.dme_win',
  baroHpa: 'g1k.pfd.baro_hpa',
  metersOverlay: 'g1k.pfd.meters',
  /** OBS mode on the GPS CDI (1 = on) and the OBS course (deg). */
  obs: 'g1k.pfd.obs',
  obsCourse: 'g1k.pfd.obs_crs',
  /** Synthetic vision (PFD Opt > SVT > Terrain) and its sub-options. SCOPE: terrain depiction simplified. */
  svt: 'g1k.pfd.svt',
  svtPathways: 'g1k.pfd.svt_pathways',
  svtHdgLabels: 'g1k.pfd.svt_hdg_lbl',
  svtAptSigns: 'g1k.pfd.svt_apt_signs',
  /** Softkey level index (debug / tests) per GDU. */
  softkeyMenu: (g: GduId) => gdu(g, 'sk_menu'),
  /** PFD window in the lower right corner: 0 none, 1 Tmr/Ref, 2 Nearest, 3 Alerts, 4 Flight Plan, 5 Direct-To, 6 Procedures, 7 DME tuning. */
  pfdWindow: 'g1k.pfd.window',

  // ---------------------------------------------------------------- references (Tmr/Ref window)
  minsMode: 'g1k.mins.mode',
  minsFt: 'g1k.mins.ft',
  minsTempC: 'g1k.mins.temp_c',
  timerS: 'g1k.timer.s',
  timerRunning: 'g1k.timer.running',
  /** 1 counting up, -1 counting down. */
  timerDir: 'g1k.timer.dir',
  timerPreset: 'g1k.timer.preset_s',
  /** V-speed reference bugs: `g1k.vspd.<id>.kt` / `.on` / `.mod` (1 = changed from default, shown with '*'). */
  vspeedKt: (id: string) => `g1k.vspd.${id}.kt`,
  vspeedOn: (id: string) => `g1k.vspd.${id}.on`,
  vspeedMod: (id: string) => `g1k.vspd.${id}.mod`,
  /** Flight ID (string var). */
  flightId: 'g1k.xpdr.flight_id',

  // ---------------------------------------------------------------- radios (tuning boxes on both GDUs)
  /** NAV tuning box on NAV1 (1) or NAV2 (2) — NAV knob push toggles (PG §1.2). */
  navTuneBox: 'g1k.nav.tune',
  /** COM tuning box on COM1 (1) or COM2 (2) — COM knob push toggles. */
  comTuneBox: 'g1k.com.tune',
  /** NAV / COM receiver volume 0..100 % and ident / automatic squelch. */
  navVolume: (r: number) => `g1k.nav${r}.vol`,
  navIdent: (r: number) => `g1k.nav${r}.id_on`,
  comVolume: (r: number) => `g1k.com${r}.vol`,
  /** Automatic squelch: 1 = on (normal), 0 = disabled (continuous static; PG §4.2). */
  comSquelch: (r: number) => `g1k.com${r}.squelch`,
  /** Seconds the NAV / COM volume readout remains shown after a change (PG: 2 s). */
  navVolShowS: 'g1k.nav.vol_show_s',
  comVolShowS: 'g1k.com.vol_show_s',
  /** COM channel spacing: 0 = 25 kHz, 1 = 8.33 kHz (Aux - System Setup 1, PG §4.2). */
  comSpacing833: 'g1k.com_833',
  /** COM transmitting (1) / receiving (1) indications (TX / RX). */
  comTx: (r: number) => `g1k.com${r}.tx`,
  comRx: (r: number) => `g1k.com${r}.rx`,
  /** Radio valid (its GIA up and linked to a working display). */
  navValid: (r: number) => `g1k.nav${r}.valid`,
  comValid: (r: number) => `g1k.com${r}.valid`,
  dmeMode: 'g1k.dme.mode',
  /** ADF standby/active (KR 87) mode: 0 ANT, 1 ADF, 2 BFO. */
  adfMode: 'g1k.adf.mode',

  // ---------------------------------------------------------------- transponder (GTX 345R)
  /** Code entry in progress (1) and digits entered so far (0..4). */
  xpdrEntry: 'g1k.xpdr.entry',
  xpdrEntryDigits: 'g1k.xpdr.entry_n',
  /** Code being entered (as a 4-digit number, unentered digits shown as '_'). */
  xpdrEntryCode: 'g1k.xpdr.entry_code',
  xpdrIdentS: 'g1k.xpdr.ident_s',
  /** Reply indication 'R' timer (s). */
  xpdrReplyS: 'g1k.xpdr.reply_s',
  /** Previous code restored by pressing VFR again. */
  xpdrPrevCode: 'g1k.xpdr.prev_code',

  // ---------------------------------------------------------------- audio panel (GMA 1360)
  /** Transmit selection: 1 COM1, 2 COM2, 0 none (PA). */
  gmaMic: 'g1k.gma.mic',
  /** Split-COM mode (COM1 MIC + COM2 MIC together, PG §4.5). */
  gmaSplitCom: 'g1k.gma.split_com',
  /** Receiver audio selections: com1, com2, aux, dme, nav1, adf, nav2, tel, mus1, mus2 (0 off, 1 on / white, 2 blue = Bluetooth). */
  gmaSel: (k: string) => `g1k.gma.${k}`,
  /** Intercom keys: pilot_ics, coplt_ics, pass_ics (1 on). */
  gmaIcs: (k: string) => `g1k.gma.${k}`,
  gmaSpeaker: 'g1k.gma.spkr',
  gmaPa: 'g1k.gma.pa',
  /** Marker beacon audio: 0 deselected, 1 on, 2 muted until the next marker (PG §4.3 "Marker Beacon Receiver"). */
  gmaMkr: 'g1k.gma.mkr',
  gmaManSq: 'g1k.gma.man_sq',
  /** Clearance recorder playing (1). */
  gmaPlay: 'g1k.gma.play',
  /** Volume/squelch cursor source index (-1 = none; the cursor defaults to PILOT ICS) and VOL (0) / SQ (1). */
  gmaCursor: 'g1k.gma.cursor',
  gmaVolSq: 'g1k.gma.vol_sq',
  /** Per-source volume 0..1: `g1k.gma.vol.<source>`. */
  gmaVolume: (k: string) => `g1k.gma.vol.${k}`,
  gmaSquelch: 'g1k.gma.icsSquelch',
  /** Blue-Select mode active (1) and the distribution source (tel / mus1 / mus2). */
  gmaBlueSelect: 'g1k.gma.blue_select',
  /** Bluetooth: 0 off, 1 discoverable (flashing), 2 paired. */
  gmaBluetooth: 'g1k.gma.bt',
  /** Key annunciator light 0/1 for the cockpit: `g1k.gma.lt_<key>` (2 = blue). */
  gmaLight: (k: string) => `g1k.gma.lt_${k}`,
  /** GMA self test after power-up: all key lights on for ~2 s (PG §4.5 "Power-Application"). */
  gmaSelfTest: 'g1k.gma.self_test',

  // ---------------------------------------------------------------- alerting
  /** Unread system messages (Alerts softkey flashes 'Message'). */
  msgUnread: 'g1k.msg.unread',
  msgCount: 'g1k.msg.count',
  /** Alerts softkey state: 0 'Alerts', 1 flashing 'Message', 2 'Advisory', 3 'Caution', 4 'Warning'. */
  alertsKey: 'g1k.alerts.key',
  /** Repeating warning chime (1 while an unacknowledged warning exists) / single caution chime trigger. */
  warnChime: 'g1k.alert.warn_chime',
  /** AFCS status annunciation above the airspeed tape (string var: '', 'AIL→', '←AIL', '↓ELE', '↑ELE', 'PTRM', 'ROLL', 'PTCH', 'AFCS', 'PFT'). */
  afcsStatus: 'g1k.afcs.status',
  /** AFCS status annunciation colour: 0 yellow (mistrim), 1 red (failure), 2 white (preflight test). */
  afcsStatusLevel: 'g1k.afcs.status_lvl',
  /** GFC 700 preflight test seconds remaining (PFT annunciation at servo power-up). */
  afcsPftS: 'g1k.afcs.pft_s',
  /** MAXSPD / MINSPD annunciations above the airspeed tape (AFCS overspeed / underspeed, PG §7.5). */
  maxSpd: 'g1k.afcs.maxspd',
  minSpd: 'g1k.afcs.minspd',

  // ---------------------------------------------------------------- ESP / USP (Garmin ESP option, PG §8.11)
  espEnabled: 'g1k.esp.enabled',
  espEngaged: 'g1k.esp.engaged',
  /** Servo increments for MechanicalFlightControls `addVars` (normalized surface, + nose up / right roll). */
  espServoPitch: 'g1k.esp.servo_pitch',
  espServoRoll: 'g1k.esp.servo_roll',
  /** Roll limit indicator angle (45 before engagement, 30 while engaged). */
  espRollLimit: 'g1k.esp.roll_limit',
  uspActive: 'g1k.usp.active',

  // ---------------------------------------------------------------- AFCS glue
  /** VNV enabled (Cncl VNV softkey toggles; PG §5.7). */
  vnvEnabled: 'g1k.vnv.enabled',

  // ---------------------------------------------------------------- EIS
  eisPage: 'g1k.eis.page',
  /** Selected cylinder (1..n) on the Lean page, 0 = automatic (hottest). */
  eisCylSel: 'g1k.eis.cyl_sel',
  eisLeanAssist: 'g1k.eis.assist',
  /** Fuel totalizer (gal): remaining (pilot set), used (integrated fuel flow). */
  fuelRemGal: 'g1k.fuel.rem_gal',
  fuelUsedGal: 'g1k.fuel.used_gal',
  /** GAL REM as kg (6.0 lb/US gal avgas) for the FMS fuel predictions (Fms `fuelVar`). */
  fuelRemKg: 'g1k.fuel.rem_kg',
  /** Engine hours shown on the EIS (hobbs-style, counts while oil pressure > 20 psi, POH 7-? "hour meter"). */
  engineHours: 'g1k.eng.hours',

  // ---------------------------------------------------------------- MFD
  /** MFD page group index and page index within the group (see state/mfd.ts PAGE_GROUPS). */
  mfdGroup: 'g1k.mfd.group',
  mfdPage: 'g1k.mfd.page',
  /** MFD navigation map range (nm) and settings. */
  mfdMapRange: 'g1k.mfd.map_range_nm',
  mfdMapOrient: 'g1k.mfd.map_orient',
  mfdMapDetail: 'g1k.mfd.map_detail',
  mfdMapTraffic: 'g1k.mfd.map_traffic',
  mfdMapTer: 'g1k.mfd.map_ter',
  mfdMapAwy: 'g1k.mfd.map_awy',
  /** Traffic system mode for the Traffic Map page (TAS/ADS-B): 0 standby, 1 operating, 2 test. */
  trafficMode: 'g1k.traffic.mode',
  /** Trip data. */
  flightTimeS: 'g1k.trip.flight_s',
  tripOdoNm: 'g1k.trip.odo_nm',
  odometerNm: 'g1k.trip.total_nm',
  maxGsKt: 'g1k.trip.max_gs',
  departureTimeH: 'g1k.trip.dep_time_h',
  /** Nav angle: 0 magnetic, 1 true (Aux - System Setup 1 > Display Units). */
  navAngleTrue: 'g1k.nav_angle_true',
  /** GPS CDI selection: 0 Auto, 1 = 2.0 nm, 2 = 1.0 nm, 3 = 0.3 nm (System Setup 1, PG §2.1). */
  gpsCdi: 'g1k.gps_cdi',
  /** Time format: 0 UTC, 1 local 12 h, 2 local 24 h; local offset (h). */
  timeFormat: 'g1k.time_format',
  timeOffsetH: 'g1k.time_offset_h',
  /** Arrival alert on/off and distance (nm). */
  arrivalAlert: 'g1k.arrival_alert',
  arrivalAlertNm: 'g1k.arrival_alert_nm',
  /** Selected GPS receiver on the GPS Status page (1/2). */
  gpsStatusRx: 'g1k.gps_status_rx',
} as const;

/** EventBus command names the suite listens to (the cockpit bezel controls emit these). */
export const G1K_EVENTS = {
  // ---------------------------------------------------------------- GDU 1054B bezel (both displays, PG Figure 1-2)
  /** Softkeys 1..12 left to right. */
  softkey: (g: GduId, i: number) => `g1k.${g}.sk${i}`,
  /** Encoders take signed clicks (number or {delta}) on the name, or positive clicks on `<name>_inc` / `<name>_dec`. */
  navVol: (g: GduId) => `g1k.${g}.nav_vol`,
  navVolPush: (g: GduId) => `g1k.${g}.nav_vol_push`, // Morse ident audio ON/OFF
  navXfer: (g: GduId) => `g1k.${g}.nav_xfer`,
  navOuter: (g: GduId) => `g1k.${g}.nav_outer`, // MHz
  navInner: (g: GduId) => `g1k.${g}.nav_inner`, // kHz
  navPush: (g: GduId) => `g1k.${g}.nav_push`, // tuning box NAV1 <-> NAV2
  hdg: (g: GduId) => `g1k.${g}.hdg`,
  hdgPush: (g: GduId) => `g1k.${g}.hdg_push`, // HDG SYNC
  altOuter: (g: GduId) => `g1k.${g}.alt_outer`, // 1000 ft
  altInner: (g: GduId) => `g1k.${g}.alt_inner`, // 100 ft
  comVol: (g: GduId) => `g1k.${g}.com_vol`,
  comVolPush: (g: GduId) => `g1k.${g}.com_vol_push`, // automatic squelch ON/OFF
  /** COM frequency transfer: press swaps; held for 2 s tunes 121.500 (EMERG). Wire the release to `com_xfer_up`. */
  comXfer: (g: GduId) => `g1k.${g}.com_xfer`,
  comXferUp: (g: GduId) => `g1k.${g}.com_xfer_up`,
  comOuter: (g: GduId) => `g1k.${g}.com_outer`,
  comInner: (g: GduId) => `g1k.${g}.com_inner`,
  comPush: (g: GduId) => `g1k.${g}.com_push`, // tuning box COM1 <-> COM2
  baro: (g: GduId) => `g1k.${g}.baro`, // large knob
  crs: (g: GduId) => `g1k.${g}.crs`, // small knob
  crsPush: (g: GduId) => `g1k.${g}.crs_push`, // CRS CTR
  range: (g: GduId) => `g1k.${g}.range`, // joystick rotation: + = zoom out
  rangePush: (g: GduId) => `g1k.${g}.range_push`, // PAN (map pointer)
  /** Joystick deflection payload { x: -1..1, y: -1..1 } (pans the map pointer). */
  joystick: (g: GduId) => `g1k.${g}.joystick`,
  keyDirect: (g: GduId) => `g1k.${g}.key_dto`,
  keyMenu: (g: GduId) => `g1k.${g}.key_menu`,
  keyFpl: (g: GduId) => `g1k.${g}.key_fpl`,
  keyProc: (g: GduId) => `g1k.${g}.key_proc`,
  /** CLR: press clears / cancels; held 2 s on the MFD shows the Navigation Map (DFLT MAP). Wire the release to `key_clr_up`. */
  keyClr: (g: GduId) => `g1k.${g}.key_clr`,
  keyClrUp: (g: GduId) => `g1k.${g}.key_clr_up`,
  keyEnt: (g: GduId) => `g1k.${g}.key_ent`,
  fmsOuter: (g: GduId) => `g1k.${g}.fms_outer`,
  fmsInner: (g: GduId) => `g1k.${g}.fms_inner`,
  fmsPush: (g: GduId) => `g1k.${g}.fms_push`, // PUSH CRSR
  /** GFC 700 keys on the GDU 1054B bezel: `g1k.<gdu>.key_ap` ... (AFCS_KEYS in afcs.ts). */
  afcsKey: (g: GduId, key: string) => `g1k.${g}.key_${key.toLowerCase()}`,

  // ---------------------------------------------------------------- GMA 1360 audio panel (PG Figure 4-2)
  gmaKey: (key: string) => `g1k.gma.key_${key}`,
  /** Keys with a hold function send `<key>_up` on release (SPKR/PA hold 2 s = PA, PILOT ICS hold = BT recording). */
  gmaKeyUp: (key: string) => `g1k.gma.key_${key}_up`,
  gmaVol: 'g1k.gma.vol', // small knob (VOL/SQ)
  gmaVolPush: 'g1k.gma.vol_push', // push: cancel cursor / Blue-Select; hold 2 s: Bluetooth pairing
  gmaVolPushUp: 'g1k.gma.vol_push_up',
  gmaCrsr: 'g1k.gma.crsr', // large knob (CRSR)
  displayBackup: 'g1k.gma.display_backup',

  // ---------------------------------------------------------------- misc
  /** Pilot's PTT (payload { pressed }) for TX indications and PA / clearance-recorder stop. */
  ptt: 'g1k.ptt',
  /** CAS acknowledge (also 'cas.ack', 'cas.ack_warning', 'cas.ack_caution'). */
  casAck: 'g1k.cas.ack',
  /** Yoke AP DISC switch held / released (payload { pressed }): holding it interrupts ESP (PG §8.11). Emit 'ap.disc' on the press too. */
  apDiscHold: 'g1k.ap_disc_hold',
} as const;
