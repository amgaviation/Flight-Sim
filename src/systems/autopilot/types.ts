/**
 * AFCS configuration types, mode catalogue and button names.
 */
import type { Binding } from '../util/binding';

/** Lateral (roll) modes. 'NONE' = no lateral mode (Boeing: no roll command bar). */
export const LATERAL_MODES = ['NONE', 'ROL', 'LVL', 'HDG', 'TRK', 'LNAV', 'VOR', 'LOC', 'BC', 'TO', 'GA', 'CWS', 'ROLLOUT'] as const;
export type LateralMode = (typeof LATERAL_MODES)[number];

/**
 * Vertical (pitch) modes. ALTS = capture of the selected altitude (ALT ACQ,
 * ASEL, ALTS CAP), ALTV = capture of the VNAV target altitude, VPATH = VNAV
 * path, VFLC = VNAV speed (climb/descent on speed), VALT = VNAV altitude hold.
 */
export const VERTICAL_MODES = ['NONE', 'PIT', 'LVL', 'ALT', 'ALTS', 'ALTV', 'VS', 'FPA', 'FLC', 'VPATH', 'VFLC', 'VALT', 'GS', 'GP', 'TO', 'GA', 'FLARE', 'CWS'] as const;
export type VerticalMode = (typeof VERTICAL_MODES)[number];

/** Armed vertical modes (bit flags). */
export const ARM = {
  ALTS: 1,
  ALTV: 2,
  GS: 4,
  GP: 8,
  VPATH: 16,
  FLARE: 32,
  /** Boeing V/S armed (ALT HOLD with a new MCP altitude). */
  VS: 64,
} as const;
export type ArmFlag = keyof typeof ARM;

/**
 * Buttons / controls the AFCS understands. Each is also an event
 * `${eventPrefix}${name.toLowerCase()}` (e.g. 'ap.hdg', 'ap.cmd_a').
 * UP/DN take an optional payload (steps, default 1); CWS takes a pressed
 * boolean (`{ pressed }`); others are momentary.
 */
export const AFCS_BUTTONS = [
  'AP', 'FD', 'FD1', 'FD2', 'YD', 'HDG', 'NAV', 'APR', 'BC', 'ALT', 'VS', 'FLC', 'VNAV', 'LNAV', 'VORLOC', 'APP',
  'LVLCHG', 'LVL', 'TOGA', 'DISC', 'DISC_RESET', 'CWS', 'UP', 'DN', 'HALF_BANK', 'CMD_A', 'CMD_B', 'CWS_A', 'CWS_B',
  'ARM', 'HDG_SYNC', 'CRS_SYNC', 'SPD_MACH', 'ROL', 'PIT', 'FPA',
  // Appended (G800 fix round 1 F02): selected-track lateral mode (Honeywell Symmetry HDG/TRK key).
  'TRK',
] as const;
export type AfcsButton = (typeof AFCS_BUTTONS)[number];

export type AfcsStyle = 'garmin' | 'kap140' | 'boeing' | 'honeywell' | 'collins';

export interface AfcsLabels {
  lateral: Partial<Record<LateralMode, string>>;
  vertical: Partial<Record<VerticalMode, string>>;
  /** Armed lateral labels (default = the lateral label). */
  armedLateral?: Partial<Record<LateralMode, string>>;
  armedVertical?: Partial<Record<ArmFlag, string>>;
  /** Label of a VOR approach (Garmin 'VAPP'). */
  vorApproach?: string;
  /** Labels used for nav modes while the approach mode (APR) is selected (KAP 140: 'APR'). */
  approachLateral?: Partial<Record<LateralMode, string>>;
  approachArmedLateral?: Partial<Record<LateralMode, string>>;
  /** Label of the LOC mode when the NAV source label differs per receiver ('LOC1', 'LOC2' on Primus). `#` is replaced by the receiver number. */
  navSuffix?: boolean;
}

export interface AfcsGains {
  /** Inner loops (normalized surface per deg / per deg/s) at `gainRefKt`. */
  pitchKp: number;
  pitchKi: number;
  pitchKq: number;
  rollKp: number;
  rollKi: number;
  rollKp_rate: number;
  /** Reference IAS for inner-loop gain scheduling (kt); gains scale (ref/IAS)². */
  gainRefKt: number;
  /** Heading/track loop: deg of bank per deg of error. */
  hdgGain: number;
  /** Path loop: deg pitch per deg of flight-path error, integral (1/s), AoA estimate filter (s). */
  pathKp: number;
  pathKi: number;
  alphaTauS: number;
  /** Altitude hold: fpm per ft, VS limit (fpm). */
  altGain: number;
  altHoldMaxVs: number;
  /** Altitude capture time constant (s): capture starts at |err| = |VS|·tau/60. */
  altCaptureTauS: number;
  /** FLC: deg of flight-path change per kt of speed error; acceleration feed factor (1 = full energy). */
  flcKp: number;
  flcAccel: number;
  /** Course tracking time constants (s): intercept = xtk / (V·tau). */
  vorTauS: number;
  locTauS: number;
  lnavTauS: number;
  /** Glideslope / glidepath: fpm per ft of vertical deviation; correction limit (fpm). */
  gsGain: number;
  gsMaxCorrFpm: number;
  /** VNAV path: fpm per ft of path deviation. */
  vpathGain: number;
  /** CWS rates at full input (deg/s). */
  cwsPitchRate: number;
  cwsRollRate: number;
}

export interface AfcsLimits {
  maxBankDeg: number;
  /** Half/low bank limit (deg). */
  lowBankDeg: number;
  maxPitchUpDeg: number;
  maxPitchDownDeg: number;
  maxRollRateDps: number;
  maxPitchRateDps: number;
  maxVsFpm: number;
  /** 'rate' = roll modes command a turn rate (KAP 140, no attitude gyro): bank limited to `stdRateFraction` of standard rate. */
  rollCommand: 'bank' | 'rate';
  stdRateFraction: number;
}

export interface ServoLimits {
  /** Max |command| (normalized surface). */
  authority: number;
  /** Slew rate (normalized per second). */
  rate: number;
}

export interface AfcsSensors {
  pitch: string;
  bank: string;
  heading: string;
  p: string;
  q: string;
  ias: string;
  mach: string;
  tas: string;
  alt: string;
  vs: string;
  ias_rate: string;
  ra: string;
  raValid: Binding;
  gs: string;
  track: string;
  trackValid: Binding;
  /** Attitude + air data valid (AFCS operable). */
  valid: Binding;
  flaps: string;
  onGround: Binding;
  /**
   * (Appended for the c172-steam KAP 140.) Course datum var (deg, same frame as `heading`) used by the
   * VOR/LOC/BC laws instead of the receiver's OBS / localizer course: the KAP 140 takes the course from the
   * DG heading bug (POH 172SPHUS Supplement 15 Fig 2 item 15). BC flies the datum + 180. Default: unset (OBS).
   */
  courseDatum?: string;
}

export interface AfcsConfig {
  style: AfcsStyle;
  name?: string;
  /** Event prefix. Default 'ap.'. */
  eventPrefix?: string;
  power?: Binding;
  /** Servo power (737: A/B hydraulics per channel: [chA, chB]). Default always. */
  servoPower?: Binding | [Binding, Binding];
  sensors?: Partial<AfcsSensors>;
  /** Modes this AFCS offers (others are ignored). Default: all. */
  lateralModes?: LateralMode[];
  verticalModes?: VerticalMode[];
  defaults: {
    /** Modes selected when the AP engages with no FD modes. */
    apLateral: LateralMode;
    apVertical: VerticalMode;
    /** Modes selected when the FD is turned on (Garmin FD key). Default same as AP. 'NONE' for Boeing. */
    fdLateral?: LateralMode;
    fdVertical?: VerticalMode;
  };
  labels: AfcsLabels;
  gains?: Partial<AfcsGains>;
  limits?: Partial<AfcsLimits>;
  servos?: { pitch?: Partial<ServoLimits>; roll?: Partial<ServoLimits>; yaw?: Partial<ServoLimits> };
  nav?: {
    /** CDI/nav source var: 0 FMS/GPS, 1 NAV1, 2 NAV2. Default ap.nav_source. */
    sourceVar?: string;
    /** Receiver used by the AP when the source is FMS (for APR on an ILS). Default 1. */
    defaultReceiver?: number;
    vorCaptureCdi?: number;
    locCaptureCdi?: number;
    lnavCaptureNm?: number;
    maxInterceptVorDeg?: number;
    maxInterceptLocDeg?: number;
    /** Glideslope capture threshold (normalized full scale). Default 0.2 (737: 2/5 dot). */
    gsCaptureDev?: number;
    /**
     * Armed LNAV/VOR/LOC/BC may capture while on the ground. Default true (unchanged behaviour). False: the FD
     * keeps TO on the takeoff roll and the armed mode captures once airborne (Longitude, added by its verify pass).
     */
    groundCapture?: boolean;
  };
  vnav?: boolean;
  /**
   * Garmin style: the VNAV key in the FMS climb phase (selected altitude above) engages VNAV flight level change
   * (VFLC, FMS climb speed) instead of only arming the descent path (G5000: the VNAV key "can automatically arm
   * PATH, FLC and ALTV", CRG 190-02538-02 p.154; system message ARM VNAV CLIMB). Default false.
   */
  vnavClimb?: boolean;
  /**
   * ALTV never goes beyond the selected altitude: its target is the VNAV target bounded by `ap.sel_alt_ft`.
   * Default false (unchanged). Without it, sequencing the constrained waypoint during the capture hands ALTV the
   * next, lower target, and ALTV keeps descending through every constraint and the selected altitude to the
   * runway threshold (found by the Longitude full-flight verification).
   */
  altvBoundBySel?: boolean;
  /**
   * VNAV modes (VFLC) fly the selected speed (`ap.sel_spd_kt` / `ap.sel_mach`) instead of the FMS target, for
   * installations where the speed selector itself follows the FMS speed in FMS mode and overrides it in MAN
   * (G5000 Longitude SPD knob FMS / MAN, OG 7-4). Default false.
   */
  vnavSpeedFromSelected?: boolean;
  to?: {
    lateral: 'LVL' | 'HDG' | 'TRK';
    /** Pitch on the ground before `rotateKt` (737: -10°). Default = pitchDeg. */
    groundPitchDeg?: number;
    rotateKt?: number;
    pitchDeg: number;
    /** After lift-off, once climbing > `minClimbFpm`, hold selected speed + `addKt` (737: V2+20). */
    speedAfterLiftoff?: { addKt: number; minClimbFpm: number };
  };
  ga?: {
    lateral: 'LVL' | 'TRK' | 'HDG';
    pitchDeg: number;
    /** GA disconnects the AP (G1000 172, 737 single channel). */
    disconnectsAp: boolean;
    speedAfterClimbFpm?: number;
  };
  disconnect?: {
    /** Pilot input magnitude that counts as an override (normalized). Default 0.35. */
    overrideInput?: number;
    overrideTimeS?: number;
    overrideAction?: 'disconnect' | 'cws' | 'none';
    /** Pilot trim switch disconnects the AP. */
    trimDisconnects?: boolean;
    /**
     * (Appended by the citation-m2 aircraft.) Extra pilot trim-switch vars (-1..1) that count for `trimDisconnects`
     * besides input.pitch_trim_rate (cockpit yoke switches). Default none.
     */
    trimInputs?: string[];
    /** Engagement prevented while true (737 stab trim AP cutout at CUTOUT, force on the column). */
    engageInhibit?: Binding;
    /** Additional automatic disconnect condition (stall warning, AHRS miscompare...). */
    auto?: Binding;
    /** Attitude limits beyond which the AP disconnects (deg). */
    maxBankDeg?: number;
    maxPitchDeg?: number;
  };
  /** Disconnect warning duration (s); undefined = until acknowledged (DISC / DISC_RESET). */
  discWarningS?: number;
  /**
   * Automatic (abnormal) disconnects keep the warning until acknowledged (DISC / DISC_RESET) even when
   * `discWarningS` is set; the timeout then applies to manual disconnects only (GFC 700 CRG 190-00384-12 §6.4:
   * automatic disengagement flashes red AP with the aural "until acknowledged"). Default false.
   */
  autoDiscLatches?: boolean;
  /**
   * Loss of the navigation signal in LNAV/VOR/LOC/BC: seconds before the default lateral mode (default 5), and
   * whether the FD rolls wings level meanwhile (default false: keeps the last command). While the signal is lost
   * `ap.lat_fail` = 1 (GFC 700 CRG §6.3: flashing yellow mode, wings level, default mode after 10 s).
   */
  navLossRevertS?: number;
  navLossWingsLevel?: boolean;
  cws?: 'boeing' | 'garmin' | 'none';
  yawDamper?: { withAp?: boolean; requiredForAp?: boolean };
  /** Allow the bank selector var ap.bank_sel_deg (737 MCP). */
  bankSelector?: boolean;
  /** ALTS arms automatically in PIT/VS/FLC/TO/GA/CWS. Default true. */
  altsAutoArm?: boolean;
  /** |error| (ft) at which ALTS capture becomes ALT hold. Default 20. */
  altCaptureToHoldFt?: number;
  /** New selected altitude during ALTS capture: revert to 'PIT' (Garmin) or 'VS' (Boeing). */
  selAltChangeInCapture?: 'PIT' | 'VS';
  /** 737 autoland. */
  autoland?: {
    flareFt?: number;
    armBelowFt?: number;
    secondChannelBeforeFt?: number;
    flareArmDeadlineFt?: number;
    rollout?: boolean;
    flareTauS?: number;
    touchdownVsFpm?: number;
    /**
     * Once FLARE is active the glideslope is no longer required for LAND 3 (the flare and rollout do not
     * use it; it goes invalid on the ground), so the status holds through the rollout. Default false.
     */
    holdStatusInFlare?: boolean;
    /**
     * Additive: when the autopilot is disconnected on the ground after an autoland, the ROLLOUT / FLARE modes are
     * cleared (F/D bars retract, FMA blank) until TO/GA or a new mode selection (737NG FCOM 4.20: the F/D gives
     * no rollout guidance). Default false.
     */
    clearOnGroundDisconnect?: boolean;
  };
  /** FD comes on with the AP. Default true. */
  fdAutoOn?: boolean;
  steps?: { pitchDeg?: number; vsFpm?: number; flcKt?: number; altFt?: number };
  /** Pitch/roll engagement: Garmin ROL holds bank above this (deg), else wings level. Default 6. */
  rollHoldMinDeg?: number;
  /** Heading hold (Boeing CWS R) when released with |bank| < this. Default 6. */
  cwsWingsLevelDeg?: number;
}
