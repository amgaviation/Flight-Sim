/**
 * SimVar and EventBus names owned by the Garmin G3000 / G5000 suite
 * (`src/avionics/garmin-g3000`). Everything the suite publishes lives in the
 * `g3k.` namespace; standard vars it reads or writes on behalf of the pilot
 * (radio frequencies, transponder, AFCS selected values, minimums, baro) use
 * the names from `core/vars.ts` so every other system sees them.
 *
 * Numeric codes are listed next to each var. String vars say so.
 * docs/modules/avionics-garmin-g3000.md has the full reference.
 */

/** Display unit ids used by the suite (also the `display.<id>.*` var ids). */
export type GduId = 'pfd1' | 'pfd2' | 'mfd';
export type GtcId = 'gtc1' | 'gtc2' | 'gtc3' | 'gtc4';
export type PfdSide = 1 | 2;

/** Pane identifiers: the PFD split panes and the MFD half/full panes. */
export type PaneId = 'pfd1' | 'mfd1' | 'mfd2' | 'pfd2';
export const PANE_IDS: readonly PaneId[] = ['pfd1', 'mfd1', 'mfd2', 'pfd2'];

/** Pane content codes (`g3k.pane.<id>.content`). */
export const PANE_CONTENT = {
  navMap: 0,
  traffic: 1,
  weather: 2,
  taws: 3,
  flightPlan: 4,
  procedure: 5,
  waypointInfo: 6,
  nearest: 7,
  checklist: 8,
  synoptics: 9,
  charts: 10,
  tripPlanning: 11,
  gpsStatus: 12,
  weightFuel: 13,
  told: 14,
} as const;
export type PaneContent = (typeof PANE_CONTENT)[keyof typeof PANE_CONTENT];
export const PANE_CONTENT_NAMES: Record<PaneContent, string> = {
  0: 'Navigation Map',
  1: 'Traffic Map',
  2: 'Weather Radar',
  3: 'TAWS',
  4: 'Active Flight Plan',
  5: 'Procedure Preview',
  6: 'Waypoint Info',
  7: 'Nearest',
  8: 'Checklist',
  9: 'Systems',
  10: 'Charts',
  11: 'Trip Planning',
  12: 'GPS Status',
  13: 'Weight and Fuel',
  14: 'Performance',
};

/** Navigation source codes (CDI / `Active NAV`): same codes as `ap.nav_source`. */
export const NAV_SOURCE = { fms: 0, nav1: 1, nav2: 2 } as const;
/** Bearing pointer source codes. */
export const BRG_SOURCE = { off: 0, nav1: 1, nav2: 2, fms: 3, adf: 4 } as const;
/** PFD inset map codes (PFD Map Settings > Map Layout). */
export const PFD_MAP = { off: 0, inset: 1, hsiMap: 2 } as const;
/** Wind display options (G3000 PG 190-02046-01 §2.3 "Wind Data"). */
export const WIND_OPTION = { off: 0, arrowSpeed: 1, arrowDirSpeed: 2, headXwind: 3 } as const;
/** AOA indicator mode. */
export const AOA_MODE = { auto: 0, on: 1, off: 2 } as const;
/** Minimums source (PG §2.4 "MDA/DH Alerting"). */
export const MINS_MODE = { off: 0, baro: 1, tempComp: 2, radio: 3 } as const;
/** GTC control modes. */
export const GTC_MODE = { pfd: 0, mfd: 1, navcom: 2 } as const;
export type GtcModeName = 'PFD' | 'MFD' | 'NAVCOM';

const pfd = (s: number, k: string): string => `g3k.pfd${s}.${k}`;

/** Suite SimVars (`g3k.*`). */
export const G3K = {
  // ---------------------------------------------------------------- system
  /** 1 once the suite logic ran at least once (debug / tests). */
  alive: 'g3k.alive',
  /** Variant flag: 0 = G3000, 1 = G5000. */
  variant: 'g3k.variant',
  /** 1 while the named GDU/GTC is powered (mirrors display.<id>.power after power logic). */
  unitPowered: (id: string) => `g3k.${id}.powered`,
  /** 1 while the unit is in its boot/self-test sequence. */
  unitBooting: (id: string) => `g3k.${id}.booting`,
  /** MFD database splash acknowledged (PG §1.2: "Press rightmost softkey to continue"). */
  mfdSplashAck: 'g3k.mfd.splash_ack',

  // ---------------------------------------------------------------- display configuration
  /** PFD split mode: 0 FULL, 1 SPLIT (PG §1.3 "PFD Mode"). */
  pfdSplit: (s: number) => pfd(s, 'split'),
  /** MFD pane mode: 0 FULL (one pane), 1 HALF (two panes). */
  mfdHalf: 'g3k.mfd.half',
  /** Pane content code (PANE_CONTENT) per pane id. */
  paneContent: (p: PaneId) => `g3k.pane.${p}.content`,
  /** Synoptic page index shown in a pane when content = synoptics. */
  paneSynoptic: (p: PaneId) => `g3k.pane.${p}.synoptic`,
  /** Map range (nm) per pane (navigation map / traffic / weather). */
  paneRange: (p: PaneId) => `g3k.pane.${p}.range_nm`,
  /** Pane selected by a GTC for control (0 none, 1..4 = PANE_IDS index + 1). */
  gtcPane: (g: string) => `g3k.${g}.pane`,
  /** GTC control mode (GTC_MODE). */
  gtcMode: (g: string) => `g3k.${g}.mode`,

  // ---------------------------------------------------------------- reversion
  /** Manual DISPLAY REVERSION switch per GDU (cockpit switch writes it; 1 = reversionary). */
  reversionSwitch: (id: GduId) => `g3k.rev_sw.${id}`,
  /** Resolved reversionary state per GDU (1 = this GDU shows the reversionary PFD+EIS format). */
  reversionary: (id: GduId) => `g3k.${id}.reversionary`,

  // ---------------------------------------------------------------- PFD settings (per side)
  navSource: (s: number) => pfd(s, 'nav_src'),
  brg1Source: (s: number) => pfd(s, 'brg1_src'),
  brg2Source: (s: number) => pfd(s, 'brg2_src'),
  pfdMap: (s: number) => pfd(s, 'map'),
  pfdMapRange: (s: number) => pfd(s, 'map_range_nm'),
  pfdTrafficInset: (s: number) => pfd(s, 'traffic_inset'),
  windOption: (s: number) => pfd(s, 'wind'),
  aoaMode: (s: number) => pfd(s, 'aoa_mode'),
  baroHpa: (s: number) => pfd(s, 'baro_hpa'),
  metersOverlay: (s: number) => pfd(s, 'meters'),
  /** Selected ADC / AHRS index (1 or 2) for this PFD (PG §1.3 "Sensors"). */
  adcSel: (s: number) => pfd(s, 'adc'),
  ahrsSel: (s: number) => pfd(s, 'ahrs'),
  /** OBS mode on the FMS CDI (1 = on). */
  obs: (s: number) => pfd(s, 'obs'),
  /** OBS course (deg magnetic) used while OBS is on. */
  obsCourse: (s: number) => pfd(s, 'obs_crs'),
  /** DME information window shown (1 = on). */
  dmeWindow: (s: number) => pfd(s, 'dme_win'),
  /** Softkey level index (debug). */
  softkeyLevel: (s: number) => pfd(s, 'sk_level'),
  /** Baro preselect (inHg) while STD is selected (G5000 "Altimeter Setting Preview"). */
  baroPreselect: (s: number) => pfd(s, 'baro_presel'),
  /** Flight director format: 0 single cue, 1 cross pointer (G5000 option). */
  fdFormat: (s: number) => pfd(s, 'fd_format'),
  /** SVT enabled (terrain rendering is SCOPE-limited, see doc); pathways; horizon heading; airport signs. */
  svt: (s: number) => pfd(s, 'svt'),
  horizonHeading: (s: number) => pfd(s, 'hzn_hdg'),

  // ---------------------------------------------------------------- shared references
  /** Baro sync (Avionics Settings > Sync Altimeter Baro Pressure). */
  baroSync: 'g3k.baro_sync',
  /** Minimums mode (MINS_MODE) and value (ft); temp-comp destination temperature (deg C). */
  minsMode: 'g3k.mins.mode',
  minsFt: 'g3k.mins.ft',
  minsTempC: 'g3k.mins.temp_c',
  /** Generic timer: seconds, running flag, direction (1 up, -1 down), preset (s). */
  timerS: 'g3k.timer.s',
  timerRunning: 'g3k.timer.running',
  timerDir: 'g3k.timer.dir',
  timerPreset: 'g3k.timer.preset_s',
  /** Flight timer (s) and trip data. */
  flightTimeS: 'g3k.trip.flight_s',
  tripOdoNm: 'g3k.trip.odo_nm',
  tripFuelUsedKg: 'g3k.trip.fuel_used_kg',
  /** V-speed bug value (kt, NaN unset) and on flag: `g3k.vspd.<id>.kt` / `.on` / `.src` (0 default, 1 pilot, 2 TOLD). */
  vspeedKt: (id: string) => `g3k.vspd.${id}.kt`,
  vspeedOn: (id: string) => `g3k.vspd.${id}.on`,
  vspeedSrc: (id: string) => `g3k.vspd.${id}.src`,
  /** N1 reference (target) bug from the Speed Bugs page (percent, NaN off; G5000 PG "Setting the target N1% value"). */
  n1Target: 'g3k.n1_target',
  /** Coupled flight director side (1 pilot, 2 copilot; XFR key). */
  fdCoupledSide: 'g3k.fd_side',
  /** AFCS selected speed source (Longitude SPD knob push): 0 MAN, 1 FMS. */
  speedFms: 'g3k.spd_fms',
  /** Altitude units overlay / nav angle: 0 magnetic, 1 true. */
  navAngleTrue: 'g3k.nav_angle_true',
  /** COM channel spacing: 0 = 25 kHz, 1 = 8.33 kHz. */
  comSpacing833: 'g3k.com_833',
  /** Active transponder (1/2) and IDENT seconds remaining. */
  xpdrActive: 'g3k.xpdr.active',
  xpdrIdentS: 'g3k.xpdr.ident_s',
  /** Flight ID string var. */
  flightId: 'g3k.xpdr.flight_id',

  // ---------------------------------------------------------------- audio panel (GMA 36 / GMA 36B)
  micSelect: (side: number) => `g3k.audio${side}.mic`,
  comMonitor: (side: number, r: number) => `g3k.audio${side}.com${r}_mon`,
  navAudio: (side: number, r: number) => `g3k.audio${side}.nav${r}`,
  adfAudio: (side: number) => `g3k.audio${side}.adf`,
  dmeAudio: (side: number) => `g3k.audio${side}.dme`,
  markerAudio: (side: number) => `g3k.audio${side}.mkr`,
  speaker: 'g3k.audio.speaker',
  comVolume: (side: number, r: number) => `g3k.audio${side}.com${r}_vol`,
  intercomMode: 'g3k.audio.icm_mode',
  squelch: (r: number) => `g3k.com${r}.squelch`,

  // ---------------------------------------------------------------- annunciations
  /** 1 while system messages are unread (MSG flashes). */
  msgUnread: 'g3k.msg.unread',
  msgCount: 'g3k.msg.count',
  /** Comparator: bitmask 1 ALT, 2 IAS, 4 HDG, 8 PIT, 16 ROL (miscompare). */
  miscompare: 'g3k.miscomp',
  /** CAS scroll offset (rows). */
  casScroll: 'g3k.cas.scroll',

  // ---------------------------------------------------------------- performance
  /** TOLD computed / crew-entered values (for other systems and tests). */
  toldTakeoffValid: 'g3k.told.to_valid',
  toldLandingValid: 'g3k.told.ldg_valid',
  /** Weight & Fuel (lb): basic operating weight, payload, zero fuel weight, gross weight, fuel reserves. */
  wfBowLb: 'g3k.wf.bow_lb',
  wfPayloadLb: 'g3k.wf.payload_lb',
  wfZfwLb: 'g3k.wf.zfw_lb',
  wfGwLb: 'g3k.wf.gw_lb',
  wfReserveLb: 'g3k.wf.reserve_lb',
  wfLandingLb: 'g3k.wf.landing_lb',
  /** Initialization accepted (GTC Initialization screen). */
  initAccepted: 'g3k.init.accepted',

  // ---------------------------------------------------------------- hazard settings (GTC)
  /**
   * TAWS inhibit switches set on the GTC TAWS Settings screen: bind the
   * aircraft's systems/warning Taws `inhibits` to these vars
   * (`inhibits: { terrain: 'g3k.taws.inhibit_terr', gpws: 'g3k.taws.inhibit_gpws', flapOverride: 'g3k.taws.flap_ovrd' }`).
   */
  tawsInhibitTerrain: 'g3k.taws.inhibit_terr',
  tawsInhibitGpws: 'g3k.taws.inhibit_gpws',
  tawsFlapOverride: 'g3k.taws.flap_ovrd',
  /** Traffic altitude range: 0 NORMAL, 1 ABOVE, 2 BELOW, 3 UNRESTRICTED (PG §6.9). */
  trafficAltRange: 'g3k.traffic.alt_range',

  // ---------------------------------------------------------------- GMC 710
  /** Key annunciator light per GMC key (1 = lit): `g3k.gmc.lt_<key>`; XFR arrows `lt_xfr_l` / `lt_xfr_r`. */
  gmcLight: (key: string) => `g3k.gmc.lt_${key.toLowerCase()}`,
  /** 1 while the GMC 710 is powered. */
  gmcPowered: 'g3k.gmc.powered',

  // ---------------------------------------------------------------- GCU 275 PFD controller (optional, state/Gcu.ts)
  /** PFD window opened from the GCU 275 keys: GCU_WINDOW code (0 none). */
  gcuWindow: (s: number) => pfd(s, 'gcu_win'),
  /** Window cursor: plan leg index (FPL / DTO) or item index (PROC); -1 none. */
  gcuCursor: (s: number) => pfd(s, 'gcu_cur'),
  /** 1 while the GCU FMS knob drives COM / NAV tuning (COM/NAV key) instead of the FMS windows. */
  gcuComNav: (s: number) => pfd(s, 'gcu_comnav'),
  /** 1 while the PFD inset map pointer (pan) is active (GCU RANGE knob push / joystick). */
  insetPan: (s: number) => pfd(s, 'inset_pan'),
  /** 1 while this side's crew member keys the microphone (push-to-talk; COM field shows TX). */
  comTx: (side: number) => `g3k.audio${side}.tx`,
} as const;

/** GCU 275 PFD windows (G3K.gcuWindow). */
export const GCU_WINDOW = { none: 0, fpl: 1, proc: 2, dto: 3 } as const;
/** GCU 275 keys (G3K_EVENTS.gcuKey). */
export type GcuKeyName = 'CLR' | 'ENT' | 'DTO' | 'FPL' | 'PROC' | 'COMNAV';

/** EventBus command names the suite listens to (hardware controls in the cockpit emit these). */
export const G3K_EVENTS = {
  // PFD / MFD bezel softkeys: payload ignored. `i` is 1..12 left to right.
  softkey: (gdu: GduId, i: number) => `g3k.${gdu}.sk${i}`,
  // GTC hardware (GTC 570: map knob (joystick), center knob, dual right knob; GTC 580: dual upper, lower knob, 3 mode softkeys).
  gtcUpperOuter: (g: string) => `g3k.${g}.upper_outer`, // payload: +n / -n clicks (number or { delta })
  gtcUpperInner: (g: string) => `g3k.${g}.upper_inner`,
  gtcUpperPush: (g: string) => `g3k.${g}.upper_push`,
  /** Push and hold of the dual concentric knob (COM active/standby swap in the COM tuning context). */
  gtcUpperHold: (g: string) => `g3k.${g}.upper_hold`,
  gtcLower: (g: string) => `g3k.${g}.lower`, // GTC 580 lower knob / GTC 570 map knob rotation (range)
  gtcLowerPush: (g: string) => `g3k.${g}.lower_push`,
  gtcCenter: (g: string) => `g3k.${g}.center`, // GTC 570 center knob (volume / checklist item)
  gtcCenterPush: (g: string) => `g3k.${g}.center_push`,
  /** Map knob joystick deflection: payload { x: -1..1, y: -1..1 } (pan while the map pointer is active). */
  gtcJoystick: (g: string) => `g3k.${g}.joystick`,
  /** GTC 580 bezel mode softkeys (PFD / MFD / NAV COM). */
  gtcModeKey: (g: string, mode: GtcModeName) => `g3k.${g}.mode_${mode.toLowerCase()}`,
  // Baro knobs (one per PFD; on the GMC 710 ends or the display controller).
  baroTurn: (s: number) => `g3k.baro${s}.turn`, // payload: clicks
  baroPush: (s: number) => `g3k.baro${s}.push`, // STD toggle
  // Display controller / PFD map range (GCU/DCU): range knob and minimums knob.
  rangeTurn: (s: number) => `g3k.range${s}.turn`,
  minsTurn: (s: number) => `g3k.mins${s}.turn`,
  minsPush: (s: number) => `g3k.mins${s}.push`,
  // GMC 710 knobs (keys map directly to the Afcs `ap.*` events; see gmc/Gmc710.ts).
  hdgTurn: 'g3k.gmc.hdg', // clicks (1 deg each)
  hdgPush: 'g3k.gmc.hdg_push',
  crsTurn: (s: number) => `g3k.gmc.crs${s}`,
  crsPush: (s: number) => `g3k.gmc.crs${s}_push`,
  altTurnOuter: 'g3k.gmc.alt_outer', // 1000 ft per click
  altTurnInner: 'g3k.gmc.alt_inner', // 100 ft per click (10 ft on approach per PG §2.1)
  altPush: 'g3k.gmc.alt_push',
  spdTurn: 'g3k.gmc.spd', // Longitude speed knob (kt or Mach 0.01)
  spdPush: 'g3k.gmc.spd_push', // FMS/MAN toggle
  xfr: 'g3k.gmc.xfr',
  noseWheel: 'g3k.gmc.nose', // NOSE UP/DN wheel clicks (+ = nose up)
  /** Master caution / warning acknowledge also acknowledges the suite's CAS model (optional). */
  casAck: 'g3k.cas.ack',
  /** GMC 710 keys (payload ignored): `g3k.gmc.key_hdg`, `key_nav`, `key_apr`, ... (see gmc/Gmc710.ts GMC_KEYS). */
  gmcKey: (key: string) => `g3k.gmc.key_${key.toLowerCase()}`,
  // GCU 275 PFD controller (optional hardware, handled by state/Gcu.ts when an aircraft creates a GcuController).
  /** GCU keys: `g3k.gcu<s>.key_clr`, `key_ent`, `key_dto`, `key_fpl`, `key_proc`, `key_comnav`. */
  gcuKey: (s: number, key: GcuKeyName) => `g3k.gcu${s}.key_${key.toLowerCase()}`,
  /** GCU dual FMS knob (clicks, `_inc` / `_dec` convention) and its push. */
  gcuFmsOuter: (s: number) => `g3k.gcu${s}.fms_outer`,
  gcuFmsInner: (s: number) => `g3k.gcu${s}.fms_inner`,
  gcuFmsPush: (s: number) => `g3k.gcu${s}.fms_push`,
  /** GCU RANGE knob push (inset map pointer on / off); the turn is `rangeTurn(s)`. */
  rangePush: (s: number) => `g3k.range${s}.push`,
  /** GCU RANGE knob joystick: payload { x, y } in -1..1 (pans the inset map pointer). */
  gcuJoystick: (s: number) => `g3k.gcu${s}.joystick`,
} as const;

// ------------------------------------------------------------------ allocation-free var names

const NUM_NAMES = new Map<unknown, string[]>();
const STR_NAMES = new Map<unknown, Map<string, string>>();

/**
 * Memoized var-name builder: `vn(ADC.valid, 2)` returns the same string as
 * `ADC.valid(2)` without allocating after the first call. Used on the 60 Hz
 * system path and in the 30 Hz display code (CLAUDE.md: no steady-state
 * allocation). `fn` must be a stable function (the builders in `core/vars.ts`
 * and `G3K`).
 */
export function vn(fn: (i: number) => string, i: number): string;
export function vn<K extends string>(fn: (k: K) => string, k: K): string;
export function vn(fn: (k: never) => string, k: number | string): string {
  const f = fn as unknown as (k: number | string) => string;
  if (typeof k === 'number') {
    let arr = NUM_NAMES.get(fn);
    if (!arr) NUM_NAMES.set(fn, (arr = []));
    const i = k | 0;
    if (i >= 0 && i < 64 && i === k) return (arr[i] ??= f(k));
    return f(k);
  }
  let m = STR_NAMES.get(fn);
  if (!m) STR_NAMES.set(fn, (m = new Map()));
  let s = m.get(k);
  if (s === undefined) m.set(k, (s = f(k)));
  return s;
}
