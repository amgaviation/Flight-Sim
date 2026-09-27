/**
 * Cessna 172S Skyhawk SP (steam gauges, Bendix/King NAV II avionics) SimVar names that are
 * specific to this variant. The airframe/engine/electrical cockpit vars shared with the G1000
 * variant are in `../c172s-common/vars.ts` (C172.*).
 *
 * Avionics fit (POH 172SPHUS Rev 5 Section 9 log of supplements, NAV II package of the
 * 2001-2004 Skyhawk SP, serials 172S8704 and on):
 *  - KMA 28 audio selector panel / intercom / marker receiver (Supplement 20)
 *  - KLN 94 IFR GPS with the NAV/GPS switch-annunciator (Supplement 19, Fig 2 serials 172S8704+)
 *  - KX 155A NAV/COM #1 with KI 209A (VOR/LOC/GS, GPS interface) and #2 with KI 208 (Supplement 1)
 *  - KR 87 ADF with KI 227 indicator (Supplement 6)
 *  - KT 76C transponder with blind encoder (Supplement 2)
 *  - KAP 140 two-axis autopilot with altitude preselect (Supplement 15, Fig 3)
 *
 * Convention: momentary buttons are 0/1 vars (1 while held), latched buttons 0/1, knobs that
 * are encoders emit events (`EV.*`) with a click count payload (+ clockwise).
 */

/** KX 155A NAV/COM unit `n` (1 or 2). */
export const KX = (n: 1 | 2) =>
  ({
    /** COMM volume knob 0 = OFF (detent) .. 1 (Supplement 1 item 13: rotate clockwise from OFF). */
    comVol: `ac.kx155.${n}.com_vol`,
    /** COMM volume knob pulled out: squelch disabled / TEST (item 13). */
    comPull: `ac.kx155.${n}.com_pull`,
    /** COMM frequency transfer button (momentary; held 2 s = active entry / direct tune). */
    comXfr: `ac.kx155.${n}.com_xfr`,
    /** COMM inner knob pulled (25 kHz steps; pushed 50 kHz). */
    comInnerPull: `ac.kx155.${n}.com_inner_pull`,
    /** CHAN button (momentary; held 2 s = channel program mode). */
    chan: `ac.kx155.${n}.chan`,
    /** NAV volume 0..1 (item 8). */
    navVol: `ac.kx155.${n}.nav_vol`,
    /** NAV volume knob pulled: IDENT (item 8). */
    navIdent: `ac.kx155.${n}.nav_ident`,
    /** NAV frequency transfer button (momentary; held 2 s = active entry; timer reset in TIMER mode). */
    navXfr: `ac.kx155.${n}.nav_xfr`,
    /** NAV MODE button (momentary, item 7). */
    navMode: `ac.kx155.${n}.nav_mode`,
    /** NAV inner knob pulled: OBS set in the CDI format (item 7). */
    navInnerPull: `ac.kx155.${n}.nav_inner_pull`,
    // ---- outputs (written by Kx155aLogic)
    /** 1 while the unit is powered and switched on. */
    on: `ac.kx155.${n}.on`,
    /** NAV display format: 0 ACT/STBY, 1 ACT/CDI, 2 ACT/BRG, 3 ACT/RAD, 4 TIMER. */
    navFormat: `ac.kx155.${n}.nav_format`,
    /** Internal OBS of the unit's CDI format (independent of the external CDI, item 7). */
    intObs: `ac.kx155.${n}.int_obs_deg`,
    /** 1 = transmitting (the 'T' annunciation, mic keyed on this COM). */
    tx: `ac.kx155.${n}.tx`,
    /** COM direct-tune (active entry) mode 0/1; NAV active entry 0/1. */
    comDirect: `ac.kx155.${n}.com_direct`,
    navDirect: `ac.kx155.${n}.nav_direct`,
    /** Channel mode: 0 off, 1 channel select, 2 channel program; selected channel index. */
    chanMode: `ac.kx155.${n}.chan_mode`,
    chanIndex: `ac.kx155.${n}.chan_index`,
    /** Elapsed / countdown timer (s) and state 0 count up, 1 set (flashing), 2 count down. */
    timerS: `ac.kx155.${n}.timer_s`,
    timerState: `ac.kx155.${n}.timer_state`,
    /** COMM inner knob step shown (50 / 25 kHz) and NAV internal-OBS set mode (PULL OBS in the CDI format). */
    comStep: `ac.kx155.${n}.com_step_khz`,
    /** NAV receiver audio level (volume knob x power; ident filter state in navIdent). */
    navAudio: `ac.kx155.${n}.nav_audio`,
    navObsSet: `ac.kx155.${n}.nav_obs_set`,
  }) as const;

/** KMA 28 audio selector panel (Supplement 20 Figure 1). */
export const KMA = {
  /** Volume/power knob pushed ON (1) / OFF-EMG (0) (item 11). */
  power: 'ac.kma28.power',
  /** Intercom volume (outer ring of item 11), 0..1. */
  icsVol: 'ac.kma28.ics_vol',
  /** Microphone selector (item 4): 0 COM 3, 1 COM 2, 2 COM 1, 3 COM 1/2, 4 COM 2/1, 5 TEL. */
  mic: 'ac.kma28.mic',
  /** Marker sensitivity & test/mute (item 2): 1 HI, 0 LO, -1 T/M (momentary). */
  mkrSens: 'ac.kma28.mkr_sens',
  /** Intercom mode ISO / ALL / CREW (item 10): 1 ISO (up), 0 ALL, -1 CREW (down). */
  icsMode: 'ac.kma28.ics_mode',
  /** Latched receiver audio buttons (item 3) and ICS / SPR (items 7, 8). */
  sel: (id: KmaButton) => `ac.kma28.sel_${id}`,
  // ---- outputs
  /** Green annunciator of a receiver button (0/1, incl. the transmit blink of COM 1/2). */
  led: (id: KmaButton) => `ac.kma28.led_${id}`,
  /** Marker lamps O / M / I (0..1, incl. lamp test and photocell dimming). */
  lampOuter: 'ac.kma28.lamp_o',
  lampMiddle: 'ac.kma28.lamp_m',
  lampInner: 'ac.kma28.lamp_i',
  /** Transmit indicator (item 6). */
  txLamp: 'ac.kma28.tx',
  /** 1 = the unit is on (not in OFF/EMG); 0 = emergency mode (pilot mic/headset on COM 1 only). */
  on: 'ac.kma28.on',
  /** Transmitter keyed: 0 none, 1 COM 1, 2 COM 2. */
  txCom: 'ac.kma28.tx_com',
  /** "Swap" indicator (item 5). Supplement 20: "The swap function is not available on this installation" (always dark). */
  swapLamp: 'ac.kma28.swap',
  /** AUX (entertainment) audio level to the headsets: AUX selected, unit on, a device in the AUX AUDIO IN jack. */
  auxLevel: 'ac.kma28.aux_level',
} as const;
export const KMA_BUTTONS = ['com1', 'com2', 'nav1', 'nav2', 'mkr', 'adf', 'dme', 'aux', 'spr', 'ics'] as const;
export type KmaButton = (typeof KMA_BUTTONS)[number];
export const KMA_MIC = { com3: 0, com2: 1, com1: 2, com12: 3, com21: 4, tel: 5 } as const;

/** KT 76C transponder (Supplement 2 Figure 1). */
export const KT = {
  /** Mode selector: 0 OFF, 1 SBY, 2 TST, 3 ON, 4 ALT (item 5). */
  mode: 'ac.kt76c.mode',
  /** IDT button (momentary, item 1). */
  idt: 'ac.kt76c.idt',
  // ---- outputs
  /** Code being entered / displayed (octal digits as a decimal number, e.g. 1200). */
  display: 'ac.kt76c.display_code',
  /** Digits entered so far during code entry (0 = none pending, 1..3 partial). */
  entry: 'ac.kt76c.entry_digits',
  /** Reply lamp 'R' (0/1). */
  reply: 'ac.kt76c.reply',
  /** Pressure altitude shown (hundreds of feet), NaN-free: -9999 = dashes. */
  altHft: 'ac.kt76c.alt_hft',
  /** Programmed VFR code. */
  vfrCode: 'ac.kt76c.vfr_code',
  /** 1 while the unit is powered and not OFF. */
  on: 'ac.kt76c.on',
} as const;

/** Blind altitude encoder shared by the KT 76C and the KAP 140 (avionics/encoder.ts). */
export const ENC = {
  /** 1 = powered, warmed up, not failed. */
  valid: 'ac.c172s.encoder_valid',
  /** Pressure altitude (ft, 29.92) reported by the encoder (0 when invalid). */
  altFt: 'ac.c172s.encoder_alt_ft',
  /** Gillham (Mode C) altitude in hundreds of feet, -9999 when invalid. */
  gillhamHft: 'ac.c172s.encoder_hft',
} as const;

/** KR 87 ADF (Supplement 6 Figure 1). */
export const KR = {
  /** ON/OFF/VOL knob, 0 = OFF (item 7). */
  vol: 'ac.kr87.vol',
  /** ADF button latched in = ADF mode, out = ANT (item 12). */
  adf: 'ac.kr87.adf_btn',
  /** BFO button latched (item 11). */
  bfo: 'ac.kr87.bfo_btn',
  /** FRQ, FLT/ET, SET/RST momentary buttons (items 10, 9, 8). */
  frq: 'ac.kr87.frq',
  fltEt: 'ac.kr87.flt_et',
  setRst: 'ac.kr87.set_rst',
  /** Inner frequency knob pulled out = 1 kHz steps (item 6). */
  innerPull: 'ac.kr87.inner_pull',
  // ---- outputs
  on: 'ac.kr87.on',
  /** Right window: 0 FRQ (standby), 1 FLT, 2 ET. */
  window: 'ac.kr87.window',
  fltS: 'ac.kr87.flt_s',
  etS: 'ac.kr87.et_s',
  /** ET state: 0 count up, 1 set (flashing), 2 count down. */
  etState: 'ac.kr87.et_state',
} as const;

/** KAP 140 two-axis autopilot with altitude preselect (Supplement 15 Figures 2 and 3). */
export const KAP = {
  /** UP / DN buttons (momentary; single press = step, held = rate). */
  up: 'ac.kap140.up',
  dn: 'ac.kap140.dn',
  /** BARO button (momentary; held 2 s toggles IN HG / HPA). */
  baro: 'ac.kap140.baro',
  // ---- outputs
  /** 1 while the computer is powered (AUTO PILOT breaker, avionics bus 2). */
  on: 'ac.kap140.on',
  /** Preflight test step: 0 done, 1..n running ('PFT n'), 99 = all-segment display test. */
  pft: 'ac.kap140.pft',
  /** Red P (pitch axis unavailable) / R (roll axis unavailable) annunciations. */
  pLamp: 'ac.kap140.p_lamp',
  rLamp: 'ac.kap140.r_lamp',
  /** PT (pitch trim) annunciation: 0 off, 1 up arrow, -1 down arrow, 2 solid (trim fault); flashing flag. */
  pt: 'ac.kap140.pt',
  ptFlash: 'ac.kap140.pt_flash',
  /** Right display field: 0 selected altitude (FT), 1 VS (FPM), 2 BARO. */
  field: 'ac.kap140.field',
  /** Autopilot baro setting (inHg) and display units (0 IN HG, 1 HPA). */
  baroInHg: 'ac.kap140.baro_inhg',
  baroHpa: 'ac.kap140.baro_hpa_units',
  /** Baro setting flashing (needs the pilot to check / set it: Supplement 15 Sec 4 A.4). */
  baroFlash: 'ac.kap140.baro_flash',
  /** Altitude arming selected (ARM button) and annunciated. */
  armSel: 'ac.kap140.arm_sel',
  armAnn: 'ac.kap140.arm_ann',
  /** ALERT annunciation lamp state. */
  alert: 'ac.kap140.alert',
  /** HDG annunciation flashing (5 s course-datum reminder, or failed heading). */
  hdgFlash: 'ac.kap140.hdg_flash',
  /** AP annunciation flashing after a disconnect. */
  apFlash: 'ac.kap140.ap_flash',
  /** Red PITCH TRIM annunciation on the airplane annunciator panel (0..1 lamp level). */
  pitchTrimLamp: 'ac.c172.lamp.pitch_trim',
  /** Manual electric trim command after the split-switch logic (-1 nose down .. +1 nose up). */
  metCmd: 'ac.kap140.met_cmd',
  /** 1 = the KAP 140 is on and the shared blind encoder (ENC) data is valid (the alerter display dashes otherwise). */
  encoderValid: 'ac.kap140.encoder_valid',
  /** AP button (momentary var; Supplement 15 Fig 2 item 2: pressed and held ~0.25 s engages, a press disengages). */
  apBtn: 'ac.kap140.ap_btn',
} as const;

/** KLN 94 GPS (Supplement 19; Pilot's Guide 006-18207-0000 Figure 3-1). */
export const KLN = {
  /** On/Off/Brightness knob: pushed in = ON (item 1); brightness 0.1..1. */
  power: 'ac.kln94.power',
  brt: 'ac.kln94.brt',
  /** Right inner knob pulled out = SCAN (item 3). */
  scan: 'ac.kln94.scan',
  // ---- outputs
  on: 'ac.kln94.on',
  /** Message prompt: 0 none, 1 flashing (new), 2 steady. */
  msg: 'ac.kln94.msg',
  /** Waypoint alert annunciation (0/1, flashing handled by the display). */
  wpt: 'ac.kln94.wpt',
  /** 0 LEG, 1 OBS mode. */
  obsMode: 'ac.kln94.obs_mode',
  /** Approach mode: 0 en route, 1 APR ARM, 2 APR ACTV. */
  apr: 'ac.kln94.apr',
  /** Navigation ready (acquired, self test approved). */
  navReady: 'ac.kln94.nav_ready',
  /**
   * OBS-mode course (deg magnetic). Supplement 19 Fig 2 item 4: analog from the #1 CDI OBS while the NAV/GPS
   * switch is in GPS (written by the NAV/GPS mux); in NAV it is set digitally with the KLN 94 knobs.
   */
  obs: 'ac.kln94.obs_deg',
  /** 1 = the OBS course comes from the #1 CDI OBS (NAV/GPS switch in GPS); 0 = digital entry on the KLN 94. */
  obsAnalog: 'ac.kln94.obs_analog',
  /** CDI output to the NAV/GPS mux: deflection (-1..1, + = fly right), TO/FROM (1 TO, -1 FROM, 0 flag), validity. */
  cdi: 'ac.kln94.cdi',
  toFrom: 'ac.kln94.to_from',
  cdiValid: 'ac.kln94.cdi_valid',
} as const;

/** Cockpit / wiring vars of this variant. */
export const ST = {
  /** NAV/GPS switch-annunciator (Supplement 19 Fig 2 item 4): momentary push. */
  navGpsBtn: 'ac.c172s.navgps_btn',
  /** Ground service: GPU plugged into the external power receptacle (left cowl, POH Sec 7); writes C172.extPower. */
  gpuRequest: 'ac.c172s.gpu_request',
  /** CO symptom level 0..1 (EST, systems.ts SteamCabinExtras): dims the pilot's view. */
  coImpair: 'ac.c172s.co_impair',
  /** Avionics cooling fan / cabin air noise loop gains (outputs, for tests). */
  avnFanGain: 'ac.c172s.avn_fan_gain',
  cabinAirNoise: 'ac.c172s.cabin_air_noise',
  /** Source shown on the #1 CDI (KI 209A) and coupled by the KAP 140: 0 NAV (NAV 1), 1 GPS. */
  cdiSource: 'ac.c172s.cdi_src',
  /** Split manual electric trim switch halves on the pilot's control wheel (Supplement 15 item 13): -1 DN (forward) / 0 / +1 UP (aft). */
  metLeft: 'ac.c172s.met_lh',
  metRight: 'ac.c172s.met_rh',
  /** A/P DISC / TRIM INT switch (pilot wheel, left horn; momentary). */
  apDisc: 'ac.c172s.ap_disc',
  /** Push-to-talk: pilot wheel, copilot wheel, hand microphone (momentary). */
  pttPilot: 'ac.c172s.ptt_pilot',
  pttCopilot: 'ac.c172s.ptt_copilot',
  pttHandMic: 'ac.c172s.ptt_mic',
  /** Annunciator panel brightness (1 DAY, 0 NIGHT) for the cockpit lamp material dimming. */
  annBright: 'ac.c172s.ann_bright',
  /** Annunciator lamp test active (TST held with WARN power). */
  annTest: 'ac.c172s.ann_test',
  /** DG gyro outputs (the vacuum directional gyro is the KAP 140 heading datum). */
  dgHeading: 'ac.dg.hdg_deg',
  /** Glove box door (cosmetic storage; SCOPE). */
  gloveBox: 'ac.c172s.glove_box',
  /** Sun visors (0 stowed .. 1 down), left / right: set by the visor controls (cockpit/cabinControls.ts). */
  visorLeft: 'ac.c172s.visor_l',
  visorRight: 'ac.c172s.visor_r',
  // SCOPE: the front seats' fore/aft and vertical adjustment (POH Sec 7 "Seats") is not modelled:
  // it would move the pilot's eye point, which the app camera takes once at load (the former
  // seat_l / seat_r vars had no control or consumer and were removed).
  /** AUX AUDIO IN jack on the pedestal: 1 = a portable audio device is plugged in (KMA 28 AUX source). */
  auxJack: 'ac.c172s.aux_audio_jack',
  /** Radio (avionics) light level shared by the Bendix/King displays (RADIO LT rheostat x bus). */
  radioLight: 'ac.light.radio',
} as const;

/** Events emitted by the cockpit (encoders and one-shot buttons) and handled by the avionics logic. */
export const EV = {
  kxComMhz: (n: 1 | 2) => `kx155.${n}.com_mhz`,
  kxComKhz: (n: 1 | 2) => `kx155.${n}.com_khz`,
  kxNavMhz: (n: 1 | 2) => `kx155.${n}.nav_mhz`,
  kxNavKhz: (n: 1 | 2) => `kx155.${n}.nav_khz`,
  ktKey: (d: number) => `kt76c.key_${d}`,
  ktClr: 'kt76c.clr',
  ktVfr: 'kt76c.vfr',
  krOuter: 'kr87.khz_outer',
  krInner: 'kr87.khz_inner',
  kap: (btn: 'ap' | 'hdg' | 'nav' | 'apr' | 'rev' | 'alt' | 'arm') => `kap140.${btn}`,
  kapAltOuter: 'kap140.alt_outer',
  kapAltInner: 'kap140.alt_inner',
  klnKey: (k: KlnKey) => `kln94.${k}`,
  klnOuter: 'kln94.outer',
  klnInner: 'kln94.inner',
  navGps: 'c172s.navgps',
} as const;
export const KLN_KEYS = ['msg', 'obs', 'alt', 'nrst', 'dto', 'clr', 'ent', 'crsr', 'proc', 'rng_up', 'rng_dn', 'mnu'] as const;
export type KlnKey = (typeof KLN_KEYS)[number];
