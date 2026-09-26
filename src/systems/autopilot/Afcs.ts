/**
 * Generic automatic flight control system: flight director + autopilot
 * mode logic, control laws and servo drive, configurable to behave like a
 * Garmin GFC 700 (G1000/G3000/G5000), Bendix/King KAP 140, Boeing 737NG
 * AFDS (MCP, CMD A/B, CWS, autoland), Honeywell Primus Epic (PlaneView /
 * Symmetry) or Collins Pro Line Fusion. `presets.ts` assembles those.
 *
 * Structure (every 60 Hz update):
 *   1. sensors (ahrs/adc/ra/gps vars — never FDM truth), validity, power;
 *   2. hardware buttons (input.ap_disc, input.toga rising edges), pilot
 *      override / trim-switch disconnect, CWS;
 *   3. automatic transitions: lateral capture (LNAV/VOR/LOC/BC), ALTS arm ->
 *      capture -> ALT, VNAV path/altitude, G/S and G/P capture, TO/GA speed
 *      phases, Boeing performance reversion, 737 autoland (dual channel,
 *      FLARE arm at 1500 ft, FLARE at 50 ft RA);
 *   4. outer loops -> flight-director commands (bank, pitch), limited in
 *      magnitude and rate;
 *   5. inner loops -> servo commands `ap.servo_pitch/roll/yaw` (added to the
 *      pilot's input by MechanicalFlightControls / FlyByWire), AP pitch trim
 *      requests and mistrim detection;
 *   6. annunciations (FMA strings, button lights, status) and the
 *      autothrottle request `ap.at_req`.
 *
 * Control-law summary (gains in `AfcsGains`, EST defaults tuned on the test
 * plant; aircraft tune them):
 *   bank:  HDG/TRK bank = clamp(k·Δψ, ±limit); ROL holds the bank at
 *          engagement (wings level below `rollHoldMinDeg`); LNAV bank =
 *          fms.lnav_bank_cmd_deg; VOR/LOC: desired track = course +
 *          clamp(xtk/(V·τ), ±max intercept) (cross-track from angular
 *          deviation × DME distance), flown on GPS track (drift-free) or
 *          heading; capture when inside the turn lead or the CDI capture
 *          threshold; VOR over-station: deviation ignored in the cone.
 *   pitch: path modes command a vertical speed; VS -> flight-path angle γ;
 *          pitch = γc + α̂ + kp·(γc−γ) + ki∫(γc−γ) with α̂ = filtered (θ−γ).
 *          ALT: vs = k·Δh; ALTS/ALTV capture: vs = Δh/τ (asymptotic, starts
 *          at |Δh| = |vs|·τ); FLC: γc = γ + V̇/g + k·(IAS − target);
 *          GS/GP: vs = −GS·tan(path) + k·(angular deviation × distance);
 *          VPATH: vs = fms.vs_req_fpm − k·fms.vnav_dev_ft; FLARE:
 *          vs = −(RA/τ + 120 fpm).
 *   servos: pitch = Kp·(θc−θ) + Ki∫ − Kq·q, roll = Kp·(φc−φ) − Kp_rate·p,
 *          gains ×(Vref/IAS)², authority and slew limited.
 *
 * See docs/modules/systems-control.md for the full var/event list.
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { FailureDef } from '../failures/FailureManager';
import { ADC, AP, FMS, GPS, INPUT, NAV } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { SENSOR_VARS } from '../sensors/vars';
import { Pid, RateFilter, clampAbs, deadband, headingError, listen, norm360, payloadBool, payloadNumber, type BlockEnv } from './lib';
import { AFCS_VARS, AtRequest } from './vars';
import {
  AFCS_BUTTONS,
  ARM,
  LATERAL_MODES,
  VERTICAL_MODES,
  type AfcsButton,
  type AfcsConfig,
  type AfcsGains,
  type AfcsLimits,
  type AfcsStyle,
  type LateralMode,
  type VerticalMode,
} from './types';

export const DEFAULT_GAINS: AfcsGains = {
  pitchKp: 0.05,
  pitchKi: 0.02,
  pitchKq: 0.03,
  rollKp: 0.03,
  rollKi: 0.002,
  rollKp_rate: 0.02,
  gainRefKt: 200,
  hdgGain: 1.5,
  pathKp: 1.2,
  pathKi: 0.15,
  alphaTauS: 2,
  altGain: 3,
  altHoldMaxVs: 1000,
  altCaptureTauS: 10,
  flcKp: 0.35,
  flcAccel: 1,
  vorTauS: 40,
  locTauS: 18,
  lnavTauS: 20,
  gsGain: 4,
  gsMaxCorrFpm: 800,
  vpathGain: 3,
  cwsPitchRate: 4,
  cwsRollRate: 10,
};

export const DEFAULT_LIMITS: AfcsLimits = {
  maxBankDeg: 25,
  lowBankDeg: 15,
  maxPitchUpDeg: 20,
  maxPitchDownDeg: -15,
  maxRollRateDps: 5,
  maxPitchRateDps: 3,
  maxVsFpm: 6000,
  rollCommand: 'bank',
  stdRateFraction: 0.9,
};

const DEG = Math.PI / 180;
const KT_TO_FPS = 1.6878099;
const G_FPS2 = 32.174049;
const NAV_LATERAL: ReadonlySet<LateralMode> = new Set<LateralMode>(['LNAV', 'VOR', 'LOC', 'BC']);
const PATH_VERTICAL: ReadonlySet<VerticalMode> = new Set<VerticalMode>(['ALT', 'ALTS', 'ALTV', 'VS', 'FPA', 'VPATH', 'VALT', 'GS', 'GP', 'LVL', 'FLARE']);
const ALTS_ARMABLE: ReadonlySet<VerticalMode> = new Set<VerticalMode>(['PIT', 'VS', 'FPA', 'FLC', 'VFLC', 'TO', 'GA', 'CWS', 'VPATH']);

/** Default override behaviour per style. */
const OVERRIDE_DEFAULT: Record<AfcsStyle, 'disconnect' | 'cws' | 'none'> = {
  garmin: 'none',
  kap140: 'none',
  boeing: 'cws',
  honeywell: 'disconnect',
  collins: 'disconnect',
};

export class Afcs implements Subsystem {
  readonly name: string;
  readonly cfg: AfcsConfig;
  readonly gains: AfcsGains;
  readonly limits: AfcsLimits;

  // ---------------------------------------------------------------- public state
  engaged = false;
  /** Channels driving the surfaces (0, 1 or 2: 737 dual-channel approach). */
  channels = 0;
  cmdA = false;
  cmdB = false;
  cwsA = false;
  cwsB = false;
  lat: LateralMode = 'NONE';
  latArmed: LateralMode = 'NONE';
  vert: VerticalMode = 'NONE';
  /** ARM bit flags. */
  vertArmed = 0;
  /** Approach mode (APR/APP) selected. */
  approach = false;
  halfBank = false;
  /** Garmin CWS button held. */
  cwsHeld = false;
  discWarn = false;
  /** Flight-director commands (deg); NaN = no command. */
  pitchCmd = NaN;
  bankCmd = NaN;
  // references
  pitchRef = 0;
  bankRef = 0;
  altRef = 0;
  fpaRef = 0;
  trackRef = 0;

  // ---------------------------------------------------------------- wiring
  private readonly vars: SimVars;
  private readonly style: AfcsStyle;
  private readonly prefix: string;
  private readonly offs: (() => void)[] = [];
  private readonly b: {
    power: () => boolean;
    servoA: () => boolean;
    servoB: () => boolean;
    valid: () => boolean;
    raValid: () => boolean;
    trackValid: () => boolean;
    ground: () => boolean;
    inhibit: () => boolean;
    autoDisc: () => boolean;
  };
  private readonly s: Record<'pitch' | 'bank' | 'heading' | 'p' | 'q' | 'ias' | 'mach' | 'tas' | 'alt' | 'vs' | 'iasRate' | 'ra' | 'gs' | 'track' | 'flaps', string>;
  private readonly latAllowed: ReadonlySet<LateralMode>;
  private readonly vertAllowed: ReadonlySet<VerticalMode>;

  // ---------------------------------------------------------------- sensor snapshot
  private theta = 0;
  private phi = 0;
  private hdg = 0;
  private pRate = 0;
  private qRate = 0;
  private ias = 0;
  private mach = 0;
  private tas = 0;
  private alt = 0;
  private vs = 0;
  private iasRate = 0;
  private ra = 99999;
  private raOk = false;
  private gs = 0;
  private trk = 0;
  private trkOk = false;
  private flaps = 0;
  private onGround = true;

  // ---------------------------------------------------------------- internal state
  private readonly pathPi: Pid;
  private alphaHat = 0;
  private alphaInit = false;
  private readonly pitchServo: Pid;
  private readonly rollServo: Pid;
  private servoP = 0;
  private servoR = 0;
  private servoY = 0;
  private pitchOut = 0;
  private bankOut = 0;
  private lastSelAlt = NaN;
  private capVs = 0;
  private captureSel = NaN;
  private flcDir = 0;
  private navRx = 1;
  private readonly cdiRate = new RateFilter(1.0);
  private overStationT = 0;
  private prevToFrom = 0;
  private hdgTurnDir = 0;
  private overT = 0;
  private prevApDisc = false;
  private prevToga = false;
  private discT = 0;
  private trimOnT = 0;
  private mistrimT = 0;
  private trimCmd = 0;
  private toSpeedPhase = false;
  private gaSpeedPhase = false;
  private flareActive = false;
  private autoland = '';
  private noAutolandT = 0;
  private cwsHdgHold = NaN;
  private cwsRollActive = false;
  private cwsPitchActive = false;
  private prevNavValidT = 0;
  private annKey = -1;
  private kapAltArm = true;
  private xtkIntegral = 0;
  private readonly fAfcs = failVar('afcs');
  private readonly fServoP = failVar('afcs.servo_pitch');
  private readonly fServoR = failVar('afcs.servo_roll');

  constructor(env: BlockEnv, cfg: AfcsConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.style = cfg.style;
    this.name = cfg.name ?? `afcs_${cfg.style}`;
    this.prefix = cfg.eventPrefix ?? 'ap.';
    this.gains = { ...DEFAULT_GAINS, ...cfg.gains };
    this.limits = { ...DEFAULT_LIMITS, ...cfg.limits };
    const sn = cfg.sensors ?? {};
    this.s = {
      pitch: sn.pitch ?? ADC.pitch(1),
      bank: sn.bank ?? ADC.bank(1),
      heading: sn.heading ?? ADC.heading(1),
      p: sn.p ?? SENSOR_VARS.p(1),
      q: sn.q ?? SENSOR_VARS.q(1),
      ias: sn.ias ?? ADC.ias(1),
      mach: sn.mach ?? ADC.mach(1),
      tas: sn.tas ?? ADC.tas(1),
      alt: sn.alt ?? ADC.baroAlt(1),
      vs: sn.vs ?? ADC.vs(1),
      iasRate: sn.ias_rate ?? SENSOR_VARS.iasRate(1),
      ra: sn.ra ?? SENSOR_VARS.raAlt(1),
      gs: sn.gs ?? GPS.gs,
      track: sn.track ?? GPS.trackMag,
      flaps: sn.flaps ?? 'surf.flaps_deg',
    };
    const sp = cfg.servoPower;
    const spA: Binding | undefined = Array.isArray(sp) ? sp[0] : sp;
    const spB: Binding | undefined = Array.isArray(sp) ? sp[1] : sp;
    this.b = {
      power: compileCondition(v, cfg.power, true),
      servoA: compileCondition(v, spA, true),
      servoB: compileCondition(v, spB, true),
      valid: compileCondition(v, sn.valid ?? `${ADC.ahrsValid(1)} && ${ADC.valid(1)}`, true),
      raValid: compileCondition(v, sn.raValid ?? SENSOR_VARS.raValid(1), false),
      trackValid: compileCondition(v, sn.trackValid ?? GPS.valid, false),
      ground: compileCondition(v, sn.onGround ?? 'gear.air_ground', false),
      inhibit: compileCondition(v, cfg.disconnect?.engageInhibit, false),
      autoDisc: compileCondition(v, cfg.disconnect?.auto, false),
    };
    this.latAllowed = new Set(cfg.lateralModes ?? LATERAL_MODES);
    this.vertAllowed = new Set(cfg.verticalModes ?? VERTICAL_MODES);
    const g = this.gains;
    this.pathPi = new Pid({ kp: g.pathKp, ki: g.pathKi, iLimit: 8 / Math.max(1e-6, g.pathKi) });
    this.pitchServo = new Pid({ kp: g.pitchKp, ki: g.pitchKi, iLimit: 1 });
    this.rollServo = new Pid({ kp: g.rollKp, ki: g.rollKi, iLimit: 1 });
    const f = cfg.nav?.defaultReceiver ?? 1;
    this.navRx = f;
    // Initialise the selected-value vars the cockpit knobs normally write.
    const init = (n: string, x: number): void => {
      if (!v.has(n)) v.set(n, x);
    };
    init(AP.selHeading, 0);
    init(AP.selAltitude, 0);
    init(AP.selVs, 0);
    init(AP.selSpeed, 0);
    init(AP.selMach, 0);
    init(AP.speedIsMach, 0);
    init(AP.fdOn(1), 0);
    init(AP.fdOn(2), 0);
    init(AP.yd, 0);
    init(AFCS_VARS.navSource, 0);
    init(AFCS_VARS.bankSelect, this.limits.maxBankDeg);
    for (const btn of AFCS_BUTTONS) {
      listen(env.events, this.offs, `${this.prefix}${btn.toLowerCase()}`, (p) => this.press(btn, p));
    }
  }

  failures(): FailureDef[] {
    return [
      { id: 'afcs', name: `${this.name} computer`, category: 'autoflight', description: 'AFCS fault: AP disconnects, FD bars removed.' },
      { id: 'afcs.servo_pitch', name: 'Pitch servo', category: 'autoflight', description: 'Pitch servo inoperative: AP disconnects.' },
      { id: 'afcs.servo_roll', name: 'Roll servo', category: 'autoflight', description: 'Roll servo inoperative: AP disconnects.' },
    ];
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  reset(): void {
    this.readSensors();
    this.servoP = this.servoR = this.servoY = 0;
    this.pitchServo.reset(0);
    this.rollServo.reset(0);
    this.pathPi.reset(0);
    this.alphaInit = false;
    this.pitchOut = this.theta;
    this.bankOut = this.phi;
    this.annKey = -1;
  }

  // ================================================================ buttons

  /** Handles a button press (the same as emitting `${eventPrefix}<button>`). */
  press(btn: AfcsButton, payload?: unknown): void {
    this.handle(btn, payload);
    // Publish right away: MCP lights and FMA follow the button even while the sim is paused.
    this.publish();
  }

  private handle(btn: AfcsButton, payload?: unknown): void {
    const v = this.vars;
    switch (btn) {
      case 'AP':
        if (this.engaged) this.disengage(false);
        else this.engage();
        break;
      case 'CMD_A':
      case 'CMD_B':
        this.pressCmd(btn === 'CMD_A');
        break;
      case 'CWS_A':
      case 'CWS_B':
        this.pressCwsChannel(btn === 'CWS_A');
        break;
      case 'FD':
        this.setFd(!this.fdOn(), true);
        break;
      case 'FD1':
      case 'FD2': {
        const side = btn === 'FD1' ? 1 : 2;
        v.set(AP.fdOn(side), v.get(AP.fdOn(side)) !== 0 ? 0 : 1);
        this.fdChanged();
        break;
      }
      case 'YD': {
        const on = v.get(AP.yd) === 0;
        v.set(AP.yd, on ? 1 : 0);
        if (!on && this.engaged && this.cfg.yawDamper?.requiredForAp) this.disengage(false);
        break;
      }
      case 'HDG':
        this.selectLateral('HDG');
        break;
      case 'ROL':
        this.selectLateral('ROL');
        break;
      case 'NAV':
        this.pressNav(false);
        break;
      case 'LNAV':
        this.pressLnav();
        break;
      case 'VORLOC':
        this.pressNav(false, true);
        break;
      case 'APR':
      case 'APP':
        this.pressApproach();
        break;
      case 'BC':
        this.pressBc();
        break;
      case 'ALT':
        this.pressAlt();
        break;
      case 'VS':
        this.pressVs();
        break;
      case 'FPA':
        if (this.ensureModes() && this.vertAllowed.has('FPA')) {
          if (this.vert === 'FPA') this.setVert(this.defaultVert());
          else {
            this.fpaRef = this.gammaDeg();
            this.setVert('FPA');
          }
        }
        break;
      case 'PIT':
        if (this.ensureModes()) this.setVert('PIT');
        break;
      case 'FLC':
      case 'LVLCHG':
        this.pressFlc();
        break;
      case 'VNAV':
        this.pressVnav();
        break;
      case 'LVL':
        if (!this.engaged) this.engage();
        if (this.engaged || this.fdOn()) {
          this.setLat('LVL');
          this.setVert('LVL');
        }
        break;
      case 'TOGA':
        this.pressToga();
        break;
      case 'DISC':
        if (this.engaged) this.disengage(false);
        else this.discWarn = false;
        break;
      case 'DISC_RESET':
        this.discWarn = false;
        break;
      case 'CWS':
        this.setCwsHeld(payloadBool(payload, !this.cwsHeld));
        break;
      case 'UP':
      case 'DN':
        this.adjust((btn === 'UP' ? 1 : -1) * payloadNumber(payload, 1));
        break;
      case 'HALF_BANK':
        this.halfBank = !this.halfBank;
        break;
      case 'ARM':
        this.kapAltArm = !this.kapAltArm;
        if (!this.kapAltArm) this.vertArmed &= ~ARM.ALTS;
        break;
      case 'HDG_SYNC':
        v.set(AP.selHeading, Math.round(norm360(this.hdg)));
        break;
      case 'CRS_SYNC': {
        const r = this.navReceiver();
        if (v.get(NAV.bearingValid(r)) !== 0) v.set(NAV.obs(r), Math.round(norm360(v.get(NAV.bearing(r)))));
        break;
      }
      case 'SPD_MACH': {
        const isMach = v.get(AP.speedIsMach) !== 0;
        if (!isMach && this.ias > 1 && this.mach > 0.05) v.set(AP.selMach, Math.round((v.get(AP.selSpeed) * (this.mach / this.ias)) * 1000) / 1000);
        if (isMach && this.mach > 0.05) v.set(AP.selSpeed, Math.round(v.get(AP.selMach) * (this.ias / this.mach)));
        v.set(AP.speedIsMach, isMach ? 0 : 1);
        break;
      }
    }
  }

  private fdOn(): boolean {
    return this.vars.get(AP.fdOn(1)) !== 0 || this.vars.get(AP.fdOn(2)) !== 0;
  }

  /** Modes can be selected (AP engaged or a flight director on). */
  private modesAvailable(): boolean {
    return this.engaged || (this.style !== 'kap140' && this.fdOn());
  }

  /** Garmin/Honeywell/Collins: a mode key turns the FD on; Boeing/KAP: modes need FD/AP. */
  private ensureModes(): boolean {
    if (this.modesAvailable()) return true;
    if (!this.b.power() || !this.b.valid()) return false;
    if (this.style === 'garmin' || this.style === 'honeywell' || this.style === 'collins') {
      this.setFd(true, false);
      return true;
    }
    return false;
  }

  private setFd(on: boolean, applyDefaults: boolean): void {
    const v = this.vars;
    if (!on && this.engaged && this.style !== 'boeing') return; // FD cannot be removed with the AP engaged (Garmin)
    v.set(AP.fdOn(1), on ? 1 : 0);
    if (this.style !== 'boeing') v.set(AP.fdOn(2), on ? 1 : 0);
    if (on && applyDefaults) {
      const d = this.cfg.defaults;
      if (this.lat === 'NONE') this.setLat(d.fdLateral ?? d.apLateral);
      if (this.vert === 'NONE') this.setVert(d.fdVertical ?? d.apVertical);
    }
    this.fdChanged();
  }

  private fdChanged(): void {
    if (!this.fdOn() && !this.engaged) this.clearModes();
  }

  private clearModes(): void {
    this.lat = 'NONE';
    this.latArmed = 'NONE';
    this.vert = 'NONE';
    this.vertArmed = 0;
    this.approach = false;
    this.flareActive = false;
    this.toSpeedPhase = false;
    this.gaSpeedPhase = false;
    this.vars.set('ap.ga_full', 0);
  }

  /** Engages the autopilot (AP button). Returns false when prevented. */
  engage(): boolean {
    const v = this.vars;
    if (!this.b.power() || !this.b.valid() || this.b.inhibit() || v.get(this.fAfcs) !== 0) return false;
    if (this.style === 'boeing') {
      if (Math.abs(v.get(INPUT.pitch)) > 0.1 || Math.abs(v.get(INPUT.roll)) > 0.1) return false; // force on the column
      if ((this.vert === 'TO' || this.vert === 'GA') && this.ra <= 400) return false; // TO/GA below 400 ft: F/D only
    }
    if (this.cfg.yawDamper?.withAp || this.cfg.yawDamper?.requiredForAp) v.set(AP.yd, 1);
    this.engaged = true;
    this.channels = 1;
    this.discWarn = false;
    if (this.cfg.fdAutoOn ?? true) {
      v.set(AP.fdOn(1), 1);
      if (this.style !== 'boeing') v.set(AP.fdOn(2), 1);
    }
    const d = this.cfg.defaults;
    if (this.style === 'boeing') {
      if (this.vert === 'TO' || this.vert === 'GA') {
        // CMD after an F/D takeoff/go-around: LVL CHG + HDG SEL, MCP speed V2+20 after takeoff (SmartCockpit 737 AFDS).
        if (this.vert === 'TO') v.set(AP.selSpeed, v.get(AP.selSpeed) + (this.cfg.to?.speedAfterLiftoff?.addKt ?? 20));
        const d0 = v.get(AP.selAltitude) - this.alt;
        this.flcDir = Math.abs(d0) < 50 ? 0 : Math.sign(d0);
        this.setVert('FLC');
        if (this.lat === 'TO' || this.lat === 'GA') this.setLat('HDG');
      }
      if (this.lat === 'NONE') this.setLat('CWS');
      if (this.vert === 'NONE') this.setVert('CWS');
    } else {
      if ((this.vert === 'TO' || this.vert === 'GA') && !this.onGround) {
        // Garmin/Honeywell/Collins: AP engagement from TO/GA reverts to the basic modes.
        this.setVert(d.apVertical);
        if (this.lat === 'TO' || this.lat === 'GA') this.setLat(d.apLateral);
      }
      if (this.lat === 'NONE') this.setLat(d.apLateral);
      if (this.vert === 'NONE') this.setVert(d.apVertical);
    }
    this.pitchServo.reset(0);
    this.rollServo.reset(0);
    this.servoP = this.servoR = 0;
    return true;
  }

  /** Disengages the autopilot; `auto` = automatic (abnormal) disconnect. */
  disengage(auto: boolean): void {
    if (!this.engaged && !this.cmdA && !this.cmdB) return;
    this.engaged = false;
    this.channels = 0;
    this.cmdA = this.cmdB = this.cwsA = this.cwsB = false;
    this.discWarn = true;
    this.discT = 0;
    this.vars.set(AFCS_VARS.discAuto, auto ? 1 : 0);
    this.servoP = this.servoR = this.servoY = 0;
    this.pitchServo.reset(0);
    this.rollServo.reset(0);
    this.flareActive = false;
    // CWS is an autopilot-only mode: the FD shows no bars for it.
    if (this.lat === 'CWS') this.lat = 'NONE';
    if (this.vert === 'CWS') this.vert = 'NONE';
    if (this.vert === 'FLARE') this.vert = 'NONE';
    if (this.style === 'kap140' || !this.fdOn()) this.clearModes();
  }

  private pressCmd(a: boolean): void {
    const on = a ? this.cmdA : this.cmdB;
    const other = a ? this.cmdB : this.cmdA;
    if (on) {
      this.disengage(false);
      return;
    }
    if (other && this.engaged) {
      const al = this.cfg.autoland;
      const bothIls = this.vars.get(NAV.isLoc(1)) !== 0 && this.vars.get(NAV.isLoc(2)) !== 0;
      if (al && this.approach && bothIls && this.ra > (al.secondChannelBeforeFt ?? 800)) {
        // Second channel armed for the dual approach (couples below 1500 ft after LOC+GS capture).
        if (a) this.cmdA = true;
        else this.cmdB = true;
        return;
      }
      // Engaging the other channel in single-channel operation swaps channels.
      if (a) {
        this.cmdB = false;
        this.cmdA = true;
      } else {
        this.cmdA = false;
        this.cmdB = true;
      }
      return;
    }
    if (this.engage()) {
      if (a) this.cmdA = true;
      else this.cmdB = true;
      this.cwsA = this.cwsB = false;
      this.navRx = a ? 1 : 2;
    }
  }

  private pressCwsChannel(a: boolean): void {
    if ((a && this.cwsA) || (!a && this.cwsB)) {
      this.disengage(false);
      return;
    }
    if (!this.engaged && !this.engage()) return;
    this.cmdA = this.cmdB = false;
    this.cwsA = a;
    this.cwsB = !a;
    this.setLat('CWS');
    this.setVert('CWS');
  }

  private selectLateral(m: LateralMode): void {
    if (!this.latAllowed.has(m) || !this.ensureModes()) return;
    if (this.lat === m) {
      this.setLat(this.defaultLat());
      return;
    }
    if (this.style === 'boeing' && m === 'HDG' && this.lat === 'LNAV') this.latArmed = this.latArmed === 'LNAV' ? 'NONE' : this.latArmed;
    this.setLat(m);
    if (this.vert === 'NONE' && this.style !== 'boeing') this.setVert(this.defaultVert());
  }

  private defaultLat(): LateralMode {
    if (this.style === 'boeing') return this.engaged ? 'CWS' : 'NONE';
    return this.cfg.defaults.apLateral;
  }

  private defaultVert(): VerticalMode {
    if (this.style === 'boeing') return this.engaged ? 'CWS' : 'NONE';
    return this.cfg.defaults.apVertical;
  }

  private setLat(m: LateralMode): void {
    if (!this.latAllowed.has(m) && m !== 'NONE') return;
    if (m === 'ROL' || m === 'CWS') {
      const minHold = this.cfg.rollHoldMinDeg ?? 6;
      const lim = this.bankLimit();
      this.bankRef = Math.abs(this.phi) < minHold ? 0 : clampAbs(this.phi, lim);
      this.cwsHdgHold = NaN;
    }
    if (m === 'TRK' || m === 'GA' || m === 'TO') this.trackRef = this.trkOk ? this.trk : this.hdg;
    if (m === 'LOC' || m === 'VOR' || m === 'BC') this.xtkIntegral = 0;
    this.lat = m;
    if (this.latArmed === m) this.latArmed = 'NONE';
  }

  private setVert(m: VerticalMode): void {
    if (!this.vertAllowed.has(m) && m !== 'NONE') return;
    const v = this.vars;
    switch (m) {
      case 'PIT':
      case 'CWS':
        this.pitchRef = clamp(this.theta, this.limits.maxPitchDownDeg, this.limits.maxPitchUpDeg);
        break;
      case 'VS':
        v.set(AP.selVs, clampAbs(Math.round(this.vs / 100) * 100, this.limits.maxVsFpm));
        break;
      case 'ALT':
        break;
      default:
        break;
    }
    if (m !== 'GA') v.set('ap.ga_full', 0);
    if (m !== 'TO') this.toSpeedPhase = false;
    if (m !== 'GA') this.gaSpeedPhase = false;
    if (m === 'GS' || m === 'GP') this.vertArmed &= ~(ARM.ALTS | ARM.ALTV | ARM.VPATH | ARM.GS | ARM.GP);
    if (m === 'FLARE') this.flareActive = true;
    else if (m !== 'NONE') this.flareActive = false;
    this.vert = m;
    // Bumpless path loop: the integrator starts where the FD pitch bar is.
    this.pathPi.reset(0);
  }

  // -------------------------------------------------------------- lateral nav buttons

  private navSource(): number {
    return this.vars.get(this.cfg.nav?.sourceVar ?? AFCS_VARS.navSource);
  }

  private navReceiver(): number {
    const src = this.navSource();
    if (this.style === 'boeing') return this.cmdB && !this.cmdA ? 2 : this.navRx;
    return src >= 1 ? src : this.cfg.nav?.defaultReceiver ?? 1;
  }

  private pressNav(approach: boolean, radioOnly = false): void {
    if (!this.ensureModes()) return;
    const armedNav = NAV_LATERAL.has(this.latArmed);
    const activeNav = NAV_LATERAL.has(this.lat);
    if ((armedNav || activeNav) && !approach && (!this.approach || radioOnly)) {
      if (armedNav) this.latArmed = 'NONE';
      else this.setLat(this.defaultLat());
      if (this.approach) this.cancelApproach();
      return;
    }
    const src = radioOnly ? 1 : this.navSource();
    let target: LateralMode;
    if (src === 0 && !radioOnly) {
      if (this.vars.get(FMS.lnavValid) === 0) return;
      target = 'LNAV';
    } else {
      const r = radioOnly ? this.navReceiver() : src;
      this.navRx = r;
      target = this.vars.get(NAV.isLoc(r)) !== 0 ? 'LOC' : 'VOR';
    }
    if (!this.latAllowed.has(target)) return;
    if (this.lat !== target) this.latArmed = target;
    if (this.lat === 'NONE') this.setLat(this.defaultLat());
    if (this.vert === 'NONE' && this.style !== 'boeing') this.setVert(this.defaultVert());
  }

  private pressLnav(): void {
    if (!this.ensureModes()) return;
    if (this.lat === 'LNAV' || this.latArmed === 'LNAV') {
      if (this.latArmed === 'LNAV') this.latArmed = 'NONE';
      else this.setLat(this.defaultLat());
      return;
    }
    if (this.vars.get(FMS.lnavValid) === 0) return;
    this.latArmed = 'LNAV';
  }

  private pressApproach(): void {
    if (!this.ensureModes()) return;
    if (this.approach) {
      this.cancelApproach();
      return;
    }
    const v = this.vars;
    const src = this.style === 'boeing' ? 1 : this.navSource();
    if (src === 0) {
      if (v.get(FMS.lnavValid) === 0) return;
      this.approach = true;
      if (this.lat !== 'LNAV') this.latArmed = 'LNAV';
      if (this.vertAllowed.has('GP')) this.vertArmed |= ARM.GP;
    } else {
      const r = this.style === 'boeing' ? this.navReceiver() : src;
      this.navRx = r;
      const loc = v.get(NAV.isLoc(r)) !== 0;
      if (this.style === 'boeing' && !loc) return; // APP needs an ILS on the master receiver
      this.approach = true;
      const target: LateralMode = loc ? 'LOC' : 'VOR';
      if (this.lat !== target) this.latArmed = target;
      if (loc && this.vertAllowed.has('GS')) this.vertArmed |= ARM.GS;
    }
    if (this.lat === 'NONE') this.setLat(this.defaultLat());
    if (this.vert === 'NONE' && this.style !== 'boeing') this.setVert(this.defaultVert());
  }

  private cancelApproach(): void {
    this.approach = false;
    if (NAV_LATERAL.has(this.latArmed)) this.latArmed = 'NONE';
    this.vertArmed &= ~(ARM.GS | ARM.GP | ARM.FLARE);
    if (this.vert === 'GS' || this.vert === 'GP') this.setVert(this.defaultVert());
    if (NAV_LATERAL.has(this.lat)) this.setLat(this.defaultLat());
  }

  private pressBc(): void {
    if (!this.ensureModes() || !this.latAllowed.has('BC')) return;
    if (this.lat === 'BC' || this.latArmed === 'BC') {
      if (this.latArmed === 'BC') this.latArmed = 'NONE';
      else this.setLat(this.defaultLat());
      return;
    }
    const r = this.navSource() >= 1 ? this.navSource() : this.navReceiver();
    if (this.vars.get(NAV.isLoc(r)) === 0) return;
    this.navRx = r;
    this.latArmed = 'BC';
    this.vertArmed &= ~ARM.GS;
    if (this.lat === 'NONE') this.setLat(this.defaultLat());
  }

  // -------------------------------------------------------------- vertical buttons

  private pressAlt(): void {
    if (!this.ensureModes() || !this.vertAllowed.has('ALT')) return;
    if (this.vert === 'GS' || this.vert === 'GP' || this.vert === 'FLARE') return; // inhibited after G/S capture
    if (this.vert === 'ALT') {
      if (this.style === 'kap140') this.setVert('VS');
      else if (this.style !== 'boeing') this.setVert(this.defaultVert());
      return;
    }
    this.altRef = this.style === 'garmin' ? Math.round(this.alt / 10) * 10 : this.alt;
    this.setVert('ALT');
    this.vertArmed &= ~(ARM.ALTS | ARM.VS);
  }

  private pressVs(): void {
    if (!this.ensureModes() || !this.vertAllowed.has('VS')) return;
    if (this.vert === 'GS' || this.vert === 'GP' || this.vert === 'FLARE') return;
    if (this.vert === 'VS') {
      this.setVert(this.defaultVert());
      return;
    }
    if (this.style === 'boeing' && this.vert === 'ALT' && Math.abs(this.altRef - this.vars.get(AP.selAltitude)) < 1) return;
    this.setVert('VS');
    this.vertArmed &= ~ARM.VS;
  }

  private pressFlc(): void {
    if (!this.ensureModes() || !this.vertAllowed.has('FLC')) return;
    if (this.vert === 'GS' || this.vert === 'GP' || this.vert === 'FLARE') return;
    if (this.vert === 'FLC') {
      this.setVert(this.defaultVert());
      return;
    }
    this.pressFlcInternal();
  }

  private pressFlcInternal(): void {
    const v = this.vars;
    const keepSpeed = this.style === 'boeing' && v.get(AP.athr) !== 0 && v.get(AP.selSpeed) > 0;
    if (!keepSpeed) {
      if (v.get(AP.speedIsMach) !== 0) v.set(AP.selMach, Math.round(this.mach * 1000) / 1000);
      else v.set(AP.selSpeed, Math.round(this.ias));
    }
    const d = v.get(AP.selAltitude) - this.alt;
    this.flcDir = Math.abs(d) < 50 ? 0 : Math.sign(d);
    this.setVert('FLC');
  }

  private pressVnav(): void {
    if (!this.cfg.vnav || !this.ensureModes()) return;
    const v = this.vars;
    const inVnav = this.vert === 'VPATH' || this.vert === 'VFLC' || this.vert === 'VALT';
    if (inVnav || (this.vertArmed & ARM.VPATH) !== 0) {
      this.vertArmed &= ~(ARM.VPATH | ARM.ALTV);
      if (inVnav) this.setVert(this.defaultVert());
      return;
    }
    const phase = v.getString(FMS.vnavPhase);
    if (this.style === 'boeing') {
      if (phase === '') return;
      if (phase === 'CLB') {
        this.flcDir = 1;
        this.setVert('VFLC');
      } else if (phase === 'CRZ') {
        this.altRef = this.alt;
        this.setVert('VALT');
      } else if (Math.abs(v.get(FMS.vnavDevFt)) < 200 && v.get(FMS.vnavValid) !== 0) this.setVert('VPATH');
      else {
        this.flcDir = -1;
        this.setVert('VFLC');
      }
    } else {
      this.vertArmed |= ARM.VPATH;
    }
  }

  private pressToga(): void {
    const v = this.vars;
    if (!this.b.power()) return;
    if (this.onGround) {
      if (!this.latAllowed.has('TO') && !this.vertAllowed.has('TO')) {
        v.set(AFCS_VARS.atRequest, AtRequest.Takeoff);
        return;
      }
      if (this.style !== 'boeing' && !this.fdOn()) this.setFd(true, false);
      const toLat = this.cfg.to?.lateral ?? 'LVL';
      if (toLat === 'HDG') this.setLat('HDG');
      else this.setLat('TO');
      this.setVert('TO');
      this.vertArmed = 0;
      this.latArmed = 'NONE';
      this.approach = false;
      return;
    }
    if (this.vert === 'GA') {
      v.set('ap.ga_full', 1); // second press: full go-around thrust
      return;
    }
    const dual = this.channels === 2 || this.flareActive || (this.vertArmed & ARM.FLARE) !== 0;
    if (this.style === 'boeing') {
      if (this.engaged && !dual && this.ra < 2000) this.disengage(false);
    } else if (this.cfg.ga?.disconnectsAp && this.engaged) {
      this.disengage(false);
    }
    if (this.style !== 'kap140') {
      v.set(AP.fdOn(1), 1);
      if (this.style !== 'boeing') v.set(AP.fdOn(2), 1);
    }
    const gaLat = this.cfg.ga?.lateral ?? 'LVL';
    if (gaLat === 'HDG') this.setLat('HDG');
    else this.setLat('GA');
    this.setVert('GA');
    this.vertArmed = 0;
    this.latArmed = 'NONE';
    this.approach = false;
    this.flareActive = false;
  }

  private setCwsHeld(pressed: boolean): void {
    if (this.cfg.cws !== 'garmin' && this.style !== 'garmin' && this.style !== 'kap140') return;
    if (pressed === this.cwsHeld) return;
    this.cwsHeld = pressed;
    if (!pressed) {
      // Release: reset hold-type references to the current state, resume path modes (GFC 700 CWS).
      if (this.lat === 'ROL') this.setLat('ROL');
      if (this.vert === 'PIT') this.pitchRef = this.theta;
      else if (this.vert === 'ALT') this.altRef = this.alt;
      else if (this.vert === 'VS') this.vars.set(AP.selVs, Math.round(this.vs / 100) * 100);
      else if (this.vert === 'FLC') this.vars.set(AP.selSpeed, Math.round(this.ias));
      this.pitchServo.reset(0);
      this.rollServo.reset(0);
      this.pathPi.reset(0);
    }
  }

  private adjust(steps: number): void {
    const v = this.vars;
    const st = this.cfg.steps ?? {};
    switch (this.vert) {
      case 'PIT':
        this.pitchRef = clamp(this.pitchRef + steps * (st.pitchDeg ?? 0.5), this.limits.maxPitchDownDeg, this.limits.maxPitchUpDeg);
        break;
      case 'VS':
        v.set(AP.selVs, clampAbs(v.get(AP.selVs) + steps * (st.vsFpm ?? 100), this.limits.maxVsFpm));
        break;
      case 'FPA':
        this.fpaRef = clamp(this.fpaRef + steps * 0.1, -10, 10);
        break;
      case 'FLC':
        // Nose up = slower (GFC 700 NOSE UP wheel in FLC).
        if (v.get(AP.speedIsMach) !== 0) v.set(AP.selMach, Math.max(0.1, v.get(AP.selMach) - steps * 0.01));
        else v.set(AP.selSpeed, Math.max(40, v.get(AP.selSpeed) - steps * (st.flcKt ?? 1)));
        break;
      case 'ALT':
        if (this.style === 'kap140') this.altRef += steps * (st.altFt ?? 20);
        break;
      default:
        break;
    }
  }

  // ================================================================ update

  update(dt: number): void {
    const v = this.vars;
    this.readSensors();
    const powered = this.b.power() && v.get(this.fAfcs) === 0;
    const valid = this.b.valid();

    // ---- power / validity / auto disconnect
    if (!powered || !valid) {
      if (this.engaged) this.disengage(true);
      if (!powered) this.clearModes();
    }
    if (this.engaged) {
      const servoOk = (this.cmdB && !this.cmdA ? this.b.servoB() : this.b.servoA()) && v.get(this.fServoP) === 0 && v.get(this.fServoR) === 0;
      const lim = this.cfg.disconnect;
      const attitude = (lim?.maxBankDeg !== undefined && Math.abs(this.phi) > lim.maxBankDeg) || (lim?.maxPitchDeg !== undefined && Math.abs(this.theta) > lim.maxPitchDeg);
      if (!servoOk || this.b.autoDisc() || attitude) this.disengage(true);
      if (this.cfg.yawDamper?.requiredForAp && v.get(AP.yd) === 0 && this.engaged) this.disengage(true);
    }

    // ---- hardware buttons
    const disc = v.get(INPUT.apDisconnect) !== 0;
    if (disc && !this.prevApDisc) this.press('DISC');
    this.prevApDisc = disc;
    const toga = v.get(INPUT.toga) !== 0;
    if (toga && !this.prevToga) this.press('TOGA');
    this.prevToga = toga;

    // ---- pilot trim switch / override
    if (this.engaged && this.cfg.disconnect?.trimDisconnects && Math.abs(v.get(INPUT.pitchTrimRate)) > 0.1) this.disengage(false);
    this.overrides(dt);

    // ---- automatic transitions
    if (this.lat !== 'NONE' || this.vert !== 'NONE' || this.latArmed !== 'NONE') {
      this.lateralTransitions(dt);
      this.verticalTransitions(dt);
      this.autolandLogic(dt);
    }

    // ---- outer loops
    const bank = this.lateralLaw(dt);
    const pitch = this.verticalLaw(dt);
    const lim = this.limits;
    if (Number.isNaN(bank)) this.bankOut = this.phi;
    else this.bankOut += clampAbs(clampAbs(bank, 45) - this.bankOut, lim.maxRollRateDps * dt);
    if (Number.isNaN(pitch)) this.pitchOut = this.theta;
    else this.pitchOut += clampAbs(clamp(pitch, lim.maxPitchDownDeg, lim.maxPitchUpDeg) - this.pitchOut, lim.maxPitchRateDps * dt);
    this.bankCmd = Number.isNaN(bank) ? NaN : this.bankOut;
    this.pitchCmd = Number.isNaN(pitch) ? NaN : this.pitchOut;

    // ---- inner loops / servos
    this.servos(dt);

    // ---- disconnect warning timer
    if (this.discWarn) {
      this.discT += dt;
      if (this.cfg.discWarningS !== undefined && this.discT >= this.cfg.discWarningS) this.discWarn = false;
    }
    this.publish();
  }

  private readSensors(): void {
    const v = this.vars;
    const s = this.s;
    this.theta = v.get(s.pitch);
    this.phi = v.get(s.bank);
    this.hdg = v.get(s.heading);
    this.pRate = v.get(s.p);
    this.qRate = v.get(s.q);
    this.ias = v.get(s.ias);
    this.mach = v.get(s.mach);
    this.tas = v.get(s.tas);
    this.alt = v.get(s.alt);
    this.vs = v.get(s.vs);
    this.iasRate = v.get(s.iasRate);
    this.raOk = this.b.raValid();
    this.ra = this.raOk ? v.get(s.ra) : 99999;
    this.trkOk = this.b.trackValid() && v.get(s.gs) > 40;
    this.gs = v.get(s.gs);
    this.trk = v.get(s.track);
    this.flaps = v.get(s.flaps);
    this.onGround = this.b.ground();
  }

  private overrides(dt: number): void {
    const v = this.vars;
    if (!this.engaged || this.cwsHeld) {
      this.overT = 0;
      return;
    }
    const d = this.cfg.disconnect ?? {};
    const thr = d.overrideInput ?? 0.35;
    const inP = v.get(INPUT.pitch);
    const inR = v.get(INPUT.roll);
    const overP = Math.abs(inP) > thr;
    const overR = Math.abs(inR) > thr;
    this.overT = overP || overR ? this.overT + dt : 0;
    if (this.overT < (d.overrideTimeS ?? 0.3)) return;
    const action = d.overrideAction ?? OVERRIDE_DEFAULT[this.style];
    if (action === 'disconnect' || (action === 'cws' && this.channels === 2)) {
      this.disengage(true);
    } else if (action === 'cws') {
      if (overP && this.vert !== 'CWS') this.setVert('CWS');
      if (overR && this.lat !== 'CWS') this.setLat('CWS');
      v.set('ap.cws_reversion', 1);
    }
  }

  // ================================================================ transitions

  private lateralTransitions(dt: number): void {
    const v = this.vars;
    const armed = this.latArmed;
    if (armed === 'LNAV') {
      if (v.get(FMS.lnavValid) !== 0) {
        const xtk = Math.abs(v.get(FMS.xtkNm));
        const capNm = this.cfg.nav?.lnavCaptureNm ?? (this.style === 'boeing' ? 3 : 1.0);
        const trkErr = Math.abs(headingError(v.get(FMS.dtkMag), this.trkOk ? this.trk : this.hdg));
        if (xtk < capNm || (trkErr <= 90 && xtk < this.turnLeadNm(trkErr) + 0.2)) this.setLat('LNAV');
      }
    } else if (armed === 'VOR' || armed === 'LOC' || armed === 'BC') {
      if (this.courseCaptured(armed, dt)) {
        this.setLat(armed);
        if (this.style === 'boeing' && this.engaged && this.channels < 1) this.channels = 1;
      }
    }
    // Loss of guidance.
    if (this.lat === 'LNAV' && v.get(FMS.lnavValid) === 0) this.setLat(this.defaultLat());
    if (this.lat === 'VOR' || this.lat === 'LOC' || this.lat === 'BC') {
      const r = this.navRx;
      this.prevNavValidT = v.get(NAV.received(r)) !== 0 ? 0 : this.prevNavValidT + dt;
      if (this.prevNavValidT > 5 && !(this.style === 'boeing' && this.ra > 1500 && this.lat === 'LOC')) this.setLat(this.defaultLat());
    }
    if (this.lat === 'TO' && !this.onGround && this.cfg.to?.lateral === 'TRK' && this.trackRef === 0) this.trackRef = this.trk;
  }

  private verticalTransitions(dt: number): void {
    const v = this.vars;
    const sel = v.get(AP.selAltitude);
    const selChanged = !Number.isNaN(this.lastSelAlt) && sel !== this.lastSelAlt;
    this.lastSelAlt = sel;
    const err = sel - this.alt;
    const g = this.gains;

    // ---- selected-altitude change handling
    if (selChanged) {
      if (this.vert === 'ALTS') {
        if ((this.cfg.selAltChangeInCapture ?? (this.style === 'boeing' ? 'VS' : 'PIT')) === 'VS') this.setVert('VS');
        else this.setVert('PIT');
      } else if (this.vert === 'ALT' && this.style === 'boeing' && Math.abs(this.altRef - this.alt) < 50) {
        this.vertArmed |= ARM.VS; // V/S armed: moving the wheel engages V/S
      }
    }
    if ((this.vertArmed & ARM.VS) !== 0 && this.vert === 'VS') this.vertArmed &= ~ARM.VS;

    // ---- ALTS arming (direction of travel toward the selected altitude)
    const autoArm = this.cfg.altsAutoArm ?? true;
    const kapOk = this.style !== 'kap140' || (this.kapAltArm && this.engaged);
    if (autoArm && kapOk && ALTS_ARMABLE.has(this.vert) && this.vertAllowed.has('ALTS')) {
      let dir = 0;
      if (this.vert === 'VS') dir = Math.sign(v.get(AP.selVs));
      else if (this.vert === 'FLC' || this.vert === 'VFLC') dir = this.flcDir;
      else if (this.vert === 'VPATH') dir = -1;
      else dir = Math.abs(this.vs) > 100 ? Math.sign(this.vs) : 0;
      if (dir !== 0 && Math.sign(err) === dir && Math.abs(err) > 50) this.vertArmed |= ARM.ALTS;
      else if (dir !== 0 && Math.sign(err) !== dir) this.vertArmed &= ~ARM.ALTS;
    } else if (!ALTS_ARMABLE.has(this.vert)) {
      this.vertArmed &= ~ARM.ALTS;
    }

    // ---- ALTS capture (asymptotic) and ALT
    if ((this.vertArmed & ARM.ALTS) !== 0 && this.vert !== 'GS' && this.vert !== 'GP') {
      const capDist = Math.max(50, (Math.abs(this.vs) * g.altCaptureTauS) / 60);
      const toward = Math.sign(err) === Math.sign(this.vs) || Math.abs(err) < 50;
      if (Math.abs(err) <= capDist && toward) {
        this.capVs = this.vs;
        this.captureSel = sel;
        this.vertArmed &= ~ARM.ALTS;
        this.setVert('ALTS');
      }
    }
    const holdFt = this.cfg.altCaptureToHoldFt ?? 20;
    if (this.vert === 'ALTS' && Math.abs(err) < holdFt) {
      this.altRef = sel;
      this.setVert('ALT');
    }

    // ---- FLC reaching the altitude without ALTS (e.g. selected in the band)
    if ((this.vert === 'FLC' || this.vert === 'VFLC') && this.flcDir !== 0 && Math.sign(err) !== this.flcDir && Math.abs(err) < 200) {
      this.altRef = sel;
      this.setVert('ALT');
    }

    // ---- VNAV
    if (this.cfg.vnav) this.vnavTransitions(sel);

    // ---- glideslope / glidepath capture
    const gsCap = this.cfg.nav?.gsCaptureDev ?? 0.2;
    if ((this.vertArmed & ARM.GS) !== 0 && this.lat === 'LOC') {
      const r = this.navRx;
      if (v.get(NAV.gsValid(r)) !== 0) {
        const dev = v.get(NAV.gsDev(r));
        if (Math.abs(dev) <= gsCap) this.setVert('GS');
      }
    }
    if ((this.vertArmed & ARM.GP) !== 0 && this.lat === 'LNAV' && v.get(FMS.gpValid) !== 0 && Math.abs(v.get(FMS.gpDev)) <= gsCap) this.setVert('GP');

    // ---- takeoff / go-around speed phases (Boeing: 15° then V2+20 / maneuvering speed)
    const to = this.cfg.to;
    if (this.vert === 'TO' && !this.onGround && to?.speedAfterLiftoff && !this.toSpeedPhase && this.vs > to.speedAfterLiftoff.minClimbFpm) {
      this.toSpeedPhase = true;
      this.flcDir = 1;
    }
    const ga = this.cfg.ga;
    if (this.vert === 'GA' && ga?.speedAfterClimbFpm !== undefined && !this.gaSpeedPhase && this.vs > ga.speedAfterClimbFpm) {
      this.gaSpeedPhase = true;
      this.flcDir = 1;
    }
    // After lift-off with FD TO and the AP engaged by a Garmin-style AFCS, TO stays until another mode.

    // ---- Boeing performance-limit reversion: V/S and the speed decays > 5 kt below the MCP speed -> LVL CHG
    if (this.style === 'boeing' && this.vert === 'VS' && v.get(AP.selSpeed) > 0 && this.ias < v.get(AP.selSpeed) - 5 && this.iasRate <= 0 && !this.onGround) {
      this.flcDir = Math.sign(err) || 1;
      this.setVert('FLC');
    }
  }

  private vnavTransitions(sel: number): void {
    const v = this.vars;
    const valid = v.get(FMS.vnavValid) !== 0;
    const tgt = v.get(FMS.vnavTargetAltFt);
    // VPATH capture from armed (Garmin: descent path intercept, selected altitude at least 75 ft below).
    if ((this.vertArmed & ARM.VPATH) !== 0 && valid) {
      const dev = v.get(FMS.vnavDevFt);
      if (Math.abs(dev) < 150 && sel < this.alt - 75 && v.getString(FMS.vnavPhase) === 'DES') {
        this.vertArmed &= ~ARM.VPATH;
        this.setVert('VPATH');
      }
    }
    // ALTV arming and capture: the VNAV target altitude above the selected one (descending).
    if (this.vert === 'VPATH' || this.vert === 'VFLC') {
      const dir = this.vert === 'VPATH' ? -1 : this.flcDir;
      const tErr = tgt - this.alt;
      const beforeSel = dir < 0 ? tgt > sel : tgt < sel;
      if (tgt > 0 && beforeSel && Math.sign(tErr) === dir) {
        this.vertArmed |= ARM.ALTV;
        this.vertArmed &= ~ARM.ALTS;
        const capDist = Math.max(50, (Math.abs(this.vs) * this.gains.altCaptureTauS) / 60);
        if (Math.abs(tErr) <= capDist) {
          this.capVs = this.vs;
          this.vertArmed &= ~ARM.ALTV;
          this.setVert('ALTV');
        }
      } else this.vertArmed &= ~ARM.ALTV;
    }
    if (this.vert === 'ALTV' && Math.abs(tgt - this.alt) < (this.cfg.altCaptureToHoldFt ?? 20)) {
      this.altRef = tgt;
      if (this.style === 'boeing') this.setVert('VALT');
      else {
        this.setVert('ALT');
        this.vertArmed |= ARM.VPATH; // continue the descent on the next path segment
      }
    }
    // Boeing VNAV: cruise level-off at the FMS cruise altitude and top of descent.
    if (this.style === 'boeing') {
      const phase = v.getString(FMS.vnavPhase);
      if (this.vert === 'VALT' && phase === 'DES' && valid && sel < this.alt - 100) this.setVert(Math.abs(v.get(FMS.vnavDevFt)) < 300 ? 'VPATH' : 'VFLC');
      if (this.vert === 'VFLC' && this.flcDir < 0 && valid && Math.abs(v.get(FMS.vnavDevFt)) < 100) this.setVert('VPATH');
    }
  }

  private autolandLogic(dt: number): void {
    const al = this.cfg.autoland;
    if (!al || this.style !== 'boeing') {
      this.autoland = '';
      return;
    }
    const v = this.vars;
    const locGs = this.lat === 'LOC' && this.vert === 'GS';
    const both = this.cmdA && this.cmdB;
    if (both && this.approach && locGs && this.ra < (al.armBelowFt ?? 1500)) {
      this.channels = 2;
      if (this.vert === 'GS' && (this.vertArmed & ARM.FLARE) === 0 && !this.flareActive) this.vertArmed |= ARM.FLARE;
    }
    if (this.channels === 2) {
      const navOk = v.get(NAV.received(1)) !== 0 && v.get(NAV.received(2)) !== 0 && v.get(NAV.gsValid(1)) !== 0 && v.get(NAV.gsValid(2)) !== 0;
      const raOk = this.raOk && v.get(SENSOR_VARS.raValid(2), 1) !== 0;
      this.noAutolandT = navOk && raOk ? 0 : this.noAutolandT + dt;
      this.autoland = this.noAutolandT > 2 ? 'NO AUTOLAND' : raOk && navOk ? 'LAND 3' : 'LAND 2';
      // FLARE must be armed by ~350 ft RA or both A/Ps disengage (SmartCockpit 737 AFDS).
      if (this.ra < (al.flareArmDeadlineFt ?? 350) && (this.vertArmed & ARM.FLARE) === 0 && !this.flareActive) this.disengage(true);
    } else this.autoland = '';
    if ((this.vertArmed & ARM.FLARE) !== 0 && this.ra <= (al.flareFt ?? 50)) {
      this.vertArmed &= ~ARM.FLARE;
      this.setVert('FLARE');
    }
    if (this.flareActive && this.onGround && al.rollout && this.lat === 'LOC') this.setLat('ROLLOUT');
  }

  // ================================================================ laws

  private bankLimit(): number {
    const lim = this.limits;
    let b = lim.maxBankDeg;
    if (this.cfg.bankSelector) {
      const s = this.vars.get(AFCS_VARS.bankSelect);
      if (s > 0) b = Math.min(b, s);
    }
    if (this.halfBank) b = Math.min(b, lim.lowBankDeg);
    if (lim.rollCommand === 'rate') {
      const vms = Math.max(30, this.tas) * 0.514444;
      const omega = 3 * DEG * lim.stdRateFraction;
      b = Math.min(b, Math.atan((vms * omega) / 9.80665) / DEG);
    }
    return b;
  }

  /** Turn lead (nm) to roll out on a course `deltaDeg` away at the bank limit. */
  private turnLeadNm(deltaDeg: number): number {
    const vKt = Math.max(60, this.gs > 40 ? this.gs : this.tas);
    const rNm = (vKt * vKt) / (68625 * Math.tan(Math.max(5, this.bankLimit()) * DEG)); // R(ft)=V²/(g·tanφ), 11.26 kt² per ft -> nm
    return rNm * (1 - Math.cos(Math.min(90, deltaDeg) * DEG));
  }

  private trackOrHeading(): number {
    return this.trkOk ? this.trk : this.hdg;
  }

  private headingLaw(target: number, ref: number): number {
    let e = headingError(target, ref);
    if (Math.abs(e) > 170 && this.hdgTurnDir !== 0) e = this.hdgTurnDir * Math.abs(e);
    else this.hdgTurnDir = Math.abs(e) > 5 ? Math.sign(e) : 0;
    return clampAbs(this.gains.hdgGain * e, this.bankLimit());
  }

  private lateralLaw(dt: number): number {
    const v = this.vars;
    switch (this.lat) {
      case 'ROL':
        return this.bankRef;
      case 'LVL':
        return 0;
      case 'HDG':
        return this.headingLaw(v.get(AP.selHeading), this.hdg);
      case 'TRK':
      case 'GA':
        return this.onGround ? 0 : this.headingLaw(this.trackRef, this.trackOrHeading());
      case 'TO':
        if (this.onGround) return 0;
        return (this.cfg.to?.lateral ?? 'LVL') === 'TRK' ? this.headingLaw(this.trackRef, this.trackOrHeading()) : 0;
      case 'LNAV':
        return clampAbs(v.get(FMS.lnavBankCmd), Math.max(this.bankLimit(), 25));
      case 'VOR':
      case 'LOC':
      case 'BC':
        return this.courseLaw(this.lat, dt);
      case 'CWS': {
        const inR = deadband(v.get(INPUT.roll), 0.05);
        const lim = Math.max(30, this.bankLimit());
        if (inR !== 0) {
          // Force = roll-rate command; the reference stays close to the actual bank.
          this.bankRef = clampAbs(clamp(this.bankRef + inR * this.gains.cwsRollRate * dt, this.phi - 5, this.phi + 5), lim);
          this.cwsHdgHold = NaN;
          this.cwsRollActive = true;
          return this.bankRef;
        }
        if (this.cwsRollActive) {
          // Released: hold the attitude reached.
          this.cwsRollActive = false;
          this.bankRef = Math.abs(this.phi) <= (this.cfg.cwsWingsLevelDeg ?? 6) ? 0 : clampAbs(this.phi, lim);
        }
        if (Math.abs(this.bankRef) <= (this.cfg.cwsWingsLevelDeg ?? 6)) {
          // Released near wings level: roll level and hold heading (737 CWS R).
          if (Number.isNaN(this.cwsHdgHold) && Math.abs(this.phi) < 3) this.cwsHdgHold = this.hdg;
          this.bankRef = 0;
          return Number.isNaN(this.cwsHdgHold) ? 0 : clampAbs(this.headingLaw(this.cwsHdgHold, this.hdg), 5);
        }
        return this.bankRef;
      }
      case 'ROLLOUT':
        return 0;
      default:
        return NaN;
    }
  }

  /** Course capture test for an armed VOR/LOC/BC. */
  private courseCaptured(kind: LateralMode, dt: number): boolean {
    const v = this.vars;
    const r = this.navRx;
    if (v.get(NAV.received(r)) === 0) return false;
    const isLoc = v.get(NAV.isLoc(r)) !== 0;
    if ((kind === 'LOC' || kind === 'BC') !== isLoc) return false;
    const cdi = v.get(NAV.cdi(r)) * (kind === 'BC' ? -1 : 1);
    const cap = kind === 'VOR' ? this.cfg.nav?.vorCaptureCdi ?? 0.5 : this.cfg.nav?.locCaptureCdi ?? 0.25;
    if (Math.abs(cdi) <= cap) return true;
    // Turn lead: capture early enough to roll out on the course.
    const course = this.courseFor(kind, r);
    const delta = Math.abs(headingError(course, this.trackOrHeading()));
    const xtk = Math.abs(this.crossTrackNm(kind, r));
    const rate = this.cdiRate.update(cdi, dt);
    const converging = Math.sign(rate) === -Math.sign(cdi);
    return converging && Math.abs(cdi) < 1 && xtk <= this.turnLeadNm(delta) * 1.1;
  }

  private courseFor(kind: LateralMode, r: number): number {
    const v = this.vars;
    let c = v.get(NAV.isLoc(r)) !== 0 && v.has(NAV.locCourse(r)) ? v.get(NAV.locCourse(r)) : v.get(NAV.obs(r));
    if (kind === 'BC') c += 180;
    return norm360(c);
  }

  /** Cross-track (nm, + = aircraft left of course / fly right) from the angular deviation and distance. */
  private crossTrackNm(kind: LateralMode, r: number): number {
    const v = this.vars;
    let dev = v.get(NAV.devDeg(r));
    if (kind === 'BC') dev = -dev;
    let dist = v.get(NAV.distNm(r));
    if (!(dist > 0.05)) dist = kind === 'VOR' ? 10 : 5; // no DME: nominal distance (EST)
    return dist * Math.sin(dev * DEG);
  }

  private courseLaw(kind: LateralMode, dt: number): number {
    const v = this.vars;
    const r = this.navRx;
    const course = this.courseFor(kind, r);
    let xtk = this.crossTrackNm(kind, r);
    // VOR over-station: the deviation is meaningless in the cone of confusion.
    let os = false;
    if (kind === 'VOR') {
      const tf = v.get(NAV.toFrom(r));
      const dist = v.get(NAV.distNm(r));
      const cone = Math.max(0.5, (Math.max(0, this.alt) / 6076) * 1.2);
      if ((dist > 0 && dist < cone) || (tf !== this.prevToFrom && this.prevToFrom !== 0)) this.overStationT = 20;
      this.prevToFrom = tf;
      if (this.overStationT > 0) {
        this.overStationT -= dt;
        os = true;
        xtk = 0;
      }
    }
    v.set(AFCS_VARS.overStation, os ? 1 : 0);
    const g = this.gains;
    const tau = kind === 'VOR' ? g.vorTauS : g.locTauS;
    const vNmps = Math.max(60, this.gs > 40 ? this.gs : this.tas) / 3600;
    const kxDegPerNm = 57.29578 / (vNmps * tau);
    const maxInt = kind === 'VOR' ? this.cfg.nav?.maxInterceptVorDeg ?? 45 : this.cfg.nav?.maxInterceptLocDeg ?? 30;
    // Slow integral trims out a steady offset when flying on heading (no GPS track).
    if (!this.trkOk && !os) this.xtkIntegral = clampAbs(this.xtkIntegral + xtk * dt * 0.02, 1);
    const intercept = clampAbs(kxDegPerNm * (xtk + (this.trkOk ? 0 : this.xtkIntegral)), maxInt);
    return this.headingLaw(norm360(course + intercept), this.trackOrHeading());
  }

  /** Current flight-path angle (deg). */
  private gammaDeg(): number {
    const tasFps = Math.max(40, this.tas) * KT_TO_FPS;
    return Math.asin(clampAbs(this.vs / 60 / tasFps, 0.99)) / DEG;
  }

  /** Vertical-speed command -> pitch command through the flight-path loop. */
  private pathLaw(vsCmd: number, dt: number): number {
    const tasFps = Math.max(40, this.tas) * KT_TO_FPS;
    const gamma = this.gammaDeg();
    const gc = Math.asin(clampAbs(vsCmd / 60 / tasFps, 0.99)) / DEG;
    const a = this.theta - gamma;
    if (!this.alphaInit) {
      this.alphaHat = a;
      this.alphaInit = true;
    }
    this.alphaHat += (a - this.alphaHat) * (1 - Math.exp(-dt / this.gains.alphaTauS));
    return gc + this.alphaHat + this.pathPi.update(gc - gamma, dt);
  }

  /** FLC: flight-path command from the speed error (energy law). */
  private flcLaw(targetKt: number, dir: number, dt: number): number {
    const g = this.gains;
    const gamma = this.gammaDeg();
    const accelDeg = ((this.iasRate * KT_TO_FPS) / G_FPS2) * (180 / Math.PI) * g.flcAccel;
    let gc = gamma + accelDeg + g.flcKp * (this.ias - targetKt);
    // Never move away from the selected altitude (FLC/LVL CHG direction).
    if (dir > 0) gc = Math.max(gc, 0.3);
    else if (dir < 0) gc = Math.min(gc, -0.3);
    const tasFps = Math.max(40, this.tas) * KT_TO_FPS;
    return this.pathLaw(Math.sin(gc * DEG) * tasFps * 60, dt);
  }

  private speedTarget(fms: boolean): number {
    const v = this.vars;
    let tgt: number;
    let mt = 0;
    if (fms) {
      tgt = v.get(FMS.vnavTargetSpeedKt, this.ias);
      mt = v.get(FMS.vnavTargetMach);
    } else {
      tgt = v.get(AP.selSpeed, this.ias);
      if (v.get(AP.speedIsMach) !== 0) mt = v.get(AP.selMach);
    }
    if (mt > 0 && this.mach > 0.05) tgt = this.ias * (mt / this.mach);
    return tgt > 0 ? tgt : this.ias;
  }

  private verticalLaw(dt: number): number {
    const v = this.vars;
    const g = this.gains;
    const lim = this.limits;
    switch (this.vert) {
      case 'PIT':
        return this.pitchRef;
      case 'LVL':
        return this.pathLaw(0, dt);
      case 'VS':
        return this.pathLaw(clampAbs(v.get(AP.selVs), lim.maxVsFpm), dt);
      case 'FPA': {
        const tasFps = Math.max(40, this.tas) * KT_TO_FPS;
        return this.pathLaw(Math.sin(this.fpaRef * DEG) * tasFps * 60, dt);
      }
      case 'ALT':
      case 'VALT':
        return this.pathLaw(clampAbs(g.altGain * (this.altRef - this.alt), g.altHoldMaxVs), dt);
      case 'ALTS':
      case 'ALTV': {
        const tgt = this.vert === 'ALTS' ? v.get(AP.selAltitude) : v.get(FMS.vnavTargetAltFt);
        const err = tgt - this.alt;
        let cmd = (err * 60) / g.altCaptureTauS;
        const cap = Math.max(200, Math.abs(this.capVs));
        cmd = clampAbs(cmd, cap);
        return this.pathLaw(cmd, dt);
      }
      case 'FLC':
        return this.flcLaw(this.speedTarget(false), this.flcDir, dt);
      case 'VFLC':
        return this.flcLaw(this.speedTarget(true), this.flcDir, dt);
      case 'VPATH': {
        const cmd = v.get(FMS.vsRequiredFpm) - g.vpathGain * v.get(FMS.vnavDevFt);
        return this.pathLaw(clamp(cmd, -lim.maxVsFpm, 500), dt);
      }
      case 'GS':
      case 'GP':
        return this.pathLaw(this.glidepathVs(), dt);
      case 'TO': {
        const to = this.cfg.to;
        const p = to?.pitchDeg ?? 10;
        if (this.onGround) return this.ias < (to?.rotateKt ?? 0) ? to?.groundPitchDeg ?? p : p;
        if (this.toSpeedPhase && to?.speedAfterLiftoff) return Math.min(p, this.flcLaw(this.speedTarget(false) + to.speedAfterLiftoff.addKt, 1, dt));
        return p;
      }
      case 'GA': {
        const p = this.cfg.ga?.pitchDeg ?? 10;
        if (this.gaSpeedPhase) return Math.min(p, this.flcLaw(this.speedTarget(false), 1, dt));
        return p;
      }
      case 'FLARE': {
        const al = this.cfg.autoland ?? {};
        if (this.onGround) return Math.max(0, this.pitchOut - 1.5 * dt); // gentle de-rotation
        const vsCmd = -((this.ra * 60) / (al.flareTauS ?? 5) + (al.touchdownVsFpm ?? 120));
        return this.pathLaw(vsCmd, dt);
      }
      case 'CWS': {
        const inP = deadband(v.get(INPUT.pitch), 0.05);
        if (inP !== 0) {
          this.pitchRef = clamp(clamp(this.pitchRef + inP * g.cwsPitchRate * dt, this.theta - 3, this.theta + 3), lim.maxPitchDownDeg, lim.maxPitchUpDeg);
          this.cwsPitchActive = true;
        } else if (this.cwsPitchActive) {
          this.cwsPitchActive = false;
          this.pitchRef = clamp(this.theta, lim.maxPitchDownDeg, lim.maxPitchUpDeg);
        }
        return this.pitchRef;
      }
      default:
        return NaN;
    }
  }

  /** Vertical speed for GS/GP tracking. */
  private glidepathVs(): number {
    const v = this.vars;
    const g = this.gains;
    let angle = 3;
    let devDeg: number;
    let distFt: number;
    if (this.vert === 'GS') {
      const r = this.navRx;
      devDeg = v.get(NAV.gsDevDeg(r));
      const d = v.get(NAV.distNm(r));
      distFt = d > 0.05 ? d * 6076 : NaN;
    } else {
      angle = v.get(FMS.gpAngleDeg) > 0 ? v.get(FMS.gpAngleDeg) : 3;
      devDeg = v.get(FMS.gpDev) * 0.25 * angle;
      distFt = NaN;
    }
    if (!Number.isFinite(distFt)) distFt = Math.max(200, this.raOk ? this.ra : 1000) / Math.tan(angle * DEG);
    const gsKt = this.gs > 40 ? this.gs : this.tas;
    const nominal = -gsKt * 101.2686 * Math.tan(angle * DEG);
    const devFt = devDeg * DEG * distFt;
    return nominal + clampAbs(g.gsGain * devFt, g.gsMaxCorrFpm);
  }

  // ================================================================ servos

  private servos(dt: number): void {
    const v = this.vars;
    const g = this.gains;
    const active = this.engaged && !this.cwsHeld && !Number.isNaN(this.pitchCmd) && !Number.isNaN(this.bankCmd);
    const sp = this.cfg.servos?.pitch ?? {};
    const sr = this.cfg.servos?.roll ?? {};
    if (!active) {
      this.servoP += clampAbs(-this.servoP, (sp.rate ?? 0.5) * dt);
      this.servoR += clampAbs(-this.servoR, (sr.rate ?? 0.5) * dt);
      if (!this.engaged) {
        this.servoP = 0;
        this.servoR = 0;
      }
      this.pitchServo.reset(0);
      this.rollServo.reset(0);
      this.servoY = 0;
      this.trimCmd = 0;
      this.mistrimT = 0;
      return;
    }
    const k = Math.min(4, Math.max(0.25, (g.gainRefKt / Math.max(50, this.ias)) ** 2));
    this.pitchServo.kp = g.pitchKp * k;
    this.pitchServo.ki = g.pitchKi * k;
    this.rollServo.kp = g.rollKp * k;
    this.rollServo.ki = g.rollKi * k;
    const pCmd = this.pitchServo.update(this.pitchCmd - this.theta, dt) - g.pitchKq * k * this.qRate;
    const rCmd = this.rollServo.update(this.bankCmd - this.phi, dt) - g.rollKp_rate * k * this.pRate;
    const pa = sp.authority ?? 0.6;
    const ra = sr.authority ?? 0.6;
    this.servoP += clampAbs(clampAbs(pCmd, pa) - this.servoP, (sp.rate ?? 0.5) * dt);
    this.servoR += clampAbs(clampAbs(rCmd, ra) - this.servoR, (sr.rate ?? 0.5) * dt);
    // Rollout: rudder to the localizer.
    if (this.lat === 'ROLLOUT') {
      const dev = v.get(NAV.devDeg(this.navRx));
      this.servoY = clampAbs(0.15 * dev, this.cfg.servos?.yaw?.authority ?? 0.5);
    } else this.servoY = 0;

    // ---- AP pitch trim: offload a sustained servo offset (trim follow-up)
    const off = this.servoP;
    if (Math.abs(off) > 0.04) this.trimOnT += dt;
    else this.trimOnT = 0;
    if (this.trimCmd === 0 && this.trimOnT > 0.5) this.trimCmd = Math.sign(off);
    else if (this.trimCmd !== 0 && (Math.abs(off) < 0.01 || Math.sign(off) !== this.trimCmd)) this.trimCmd = 0;
    this.mistrimT = Math.abs(off) > 0.25 ? this.mistrimT + dt : 0;
  }

  // ================================================================ outputs

  private atRequest(): AtRequest {
    const sel = this.vars.get(AP.selAltitude);
    switch (this.vert) {
      case 'TO':
        return this.onGround ? AtRequest.Takeoff : AtRequest.None;
      case 'GA':
        return AtRequest.GoAround;
      case 'FLARE':
        return AtRequest.Retard;
      case 'FLC':
      case 'VFLC': {
        const dir = this.flcDir !== 0 ? this.flcDir : Math.sign(sel - this.alt);
        return dir > 0 ? AtRequest.Thrust : AtRequest.Idle;
      }
      case 'NONE':
      case 'CWS':
        return AtRequest.None;
      default:
        return PATH_VERTICAL.has(this.vert) || this.vert === 'PIT' ? AtRequest.Speed : AtRequest.None;
    }
  }

  private publish(): void {
    const v = this.vars;
    const modes = this.modesAvailable();
    const pitchValid = modes && !Number.isNaN(this.pitchCmd) && this.vert !== 'CWS' && !(this.style === 'boeing' && this.vert === 'FLARE');
    const rollValid = modes && !Number.isNaN(this.bankCmd) && this.lat !== 'CWS';
    v.set(AP.engaged, this.engaged ? 1 : 0);
    v.set(AP.fdPitch, pitchValid ? this.pitchCmd : this.theta);
    v.set(AP.fdBank, rollValid ? this.bankCmd : this.phi);
    v.set(AFCS_VARS.fdPitchValid, pitchValid ? 1 : 0);
    v.set(AFCS_VARS.fdRollValid, rollValid ? 1 : 0);
    v.set(AFCS_VARS.servoPitch, this.servoP);
    v.set(AFCS_VARS.servoRoll, this.servoR);
    v.set(AFCS_VARS.servoYaw, this.servoY);
    v.set(AFCS_VARS.trimCmd, this.trimCmd);
    v.set(AFCS_VARS.mistrim, this.mistrimT > (this.style === 'kap140' ? 15 : 10) ? 1 : 0);
    const force = this.style === 'boeing' && this.engaged ? 1 : 0;
    v.set(AFCS_VARS.forcePitch, force);
    v.set(AFCS_VARS.forceRoll, force);
    v.set(AFCS_VARS.discWarn, this.discWarn ? 1 : 0);
    v.set(AFCS_VARS.channels, this.channels);
    v.set(AFCS_VARS.cmdA, this.cmdA ? 1 : 0);
    v.set(AFCS_VARS.cmdB, this.cmdB ? 1 : 0);
    v.set(AFCS_VARS.cwsA, this.cwsA ? 1 : 0);
    v.set(AFCS_VARS.cwsB, this.cwsB ? 1 : 0);
    v.set(AFCS_VARS.cws, this.cwsHeld || this.lat === 'CWS' || this.vert === 'CWS' ? 1 : 0);
    v.set(AFCS_VARS.flareArmed, (this.vertArmed & ARM.FLARE) !== 0 ? 1 : 0);
    v.set(AFCS_VARS.flare, this.flareActive ? 1 : 0);
    v.set(AFCS_VARS.altRef, this.altRef);
    v.set(AFCS_VARS.pitchRef, this.pitchRef);
    v.set(AFCS_VARS.bankRef, this.bankRef);
    v.set(AFCS_VARS.bankLimit, this.bankLimit());
    v.set(AFCS_VARS.halfBank, this.halfBank ? 1 : 0);
    v.set(AFCS_VARS.speedRef, this.vert === 'VFLC' || this.vert === 'VPATH' ? this.speedTarget(true) : this.speedTarget(false));
    v.set(AFCS_VARS.latCode, LATERAL_MODES.indexOf(this.lat));
    v.set(AFCS_VARS.vertCode, VERTICAL_MODES.indexOf(this.vert));
    v.set(AFCS_VARS.atRequest, modes || this.vert === 'TO' ? this.atRequest() : AtRequest.None);
    v.set(AFCS_VARS.atSpeedFms, this.vert === 'VFLC' || this.vert === 'VPATH' || this.vert === 'VALT' ? 1 : 0);
    if (!this.engaged) v.set('ap.cws_reversion', 0);

    // ---- button lights
    const btn = AFCS_VARS.button;
    const navArmedOrActive = NAV_LATERAL.has(this.lat) || NAV_LATERAL.has(this.latArmed);
    v.set(btn('ap'), this.engaged ? 1 : 0);
    v.set(btn('hdg'), this.lat === 'HDG' ? 1 : 0);
    v.set(btn('nav'), navArmedOrActive && !this.approach ? 1 : 0);
    v.set(btn('apr'), this.approach ? 1 : 0);
    v.set(btn('app'), this.approach && this.vert !== 'GS' ? 1 : 0);
    v.set(btn('bc'), this.lat === 'BC' || this.latArmed === 'BC' ? 1 : 0);
    v.set(btn('alt'), this.vert === 'ALT' && !(this.style === 'boeing' && Math.abs(this.altRef - v.get(AP.selAltitude)) < 1) ? 1 : 0);
    v.set(btn('vs'), this.vert === 'VS' ? 1 : 0);
    v.set(btn('flc'), this.vert === 'FLC' ? 1 : 0);
    v.set(btn('lvlchg'), this.vert === 'FLC' ? 1 : 0);
    v.set(btn('vnav'), this.vert === 'VPATH' || this.vert === 'VFLC' || this.vert === 'VALT' || (this.vertArmed & ARM.VPATH) !== 0 ? 1 : 0);
    v.set(btn('lnav'), this.lat === 'LNAV' || this.latArmed === 'LNAV' ? 1 : 0);
    v.set(btn('vorloc'), this.lat === 'VOR' || this.lat === 'LOC' || this.latArmed === 'VOR' || this.latArmed === 'LOC' ? 1 : 0);
    v.set(btn('cmd_a'), this.cmdA ? 1 : 0);
    v.set(btn('cmd_b'), this.cmdB ? 1 : 0);
    v.set(btn('cws_a'), this.cwsA ? 1 : 0);
    v.set(btn('cws_b'), this.cwsB ? 1 : 0);
    v.set(btn('yd'), v.get(AP.yd) !== 0 ? 1 : 0);
    v.set(btn('fd'), this.fdOn() ? 1 : 0);
    v.set(btn('half_bank'), this.halfBank ? 1 : 0);
    v.set(btn('lvl'), this.lat === 'LVL' && this.vert === 'LVL' ? 1 : 0);
    v.set(btn('to'), this.vert === 'TO' ? 1 : 0);
    v.set(btn('ga'), this.vert === 'GA' ? 1 : 0);
    v.set(btn('arm'), (this.vertArmed & ARM.ALTS) !== 0 ? 1 : 0);

    // ---- FMA strings (rebuilt only when something changed: no per-frame allocation)
    const key =
      LATERAL_MODES.indexOf(this.lat) +
      16 * LATERAL_MODES.indexOf(this.latArmed) +
      256 * VERTICAL_MODES.indexOf(this.vert) +
      8192 * this.vertArmed +
      8192 * 128 * ((this.engaged ? 1 : 0) + 2 * this.channels + 8 * (this.navRx & 3) + 32 * (this.approach ? 1 : 0) + 64 * (this.fdOn() ? 1 : 0)) +
      8192 * 128 * 128 * (this.autoland === 'LAND 3' ? 1 : this.autoland === 'LAND 2' ? 2 : this.autoland === 'NO AUTOLAND' ? 3 : 0) +
      8192 * 128 * 128 * 4 * (this.vars.get(AFCS_VARS.navSource) & 3);
    if (key !== this.annKey) {
      this.annKey = key;
      this.annunciate();
    }
  }

  private annunciate(): void {
    const v = this.vars;
    const L = this.cfg.labels;
    const modes = this.modesAvailable();
    const latLabel = (m: LateralMode, armed: boolean): string => {
      if (m === 'NONE') return '';
      if (m === 'VOR' && this.approach && L.vorApproach) return L.vorApproach;
      const apr = this.approach ? (armed ? L.approachArmedLateral : L.approachLateral) : undefined;
      const tbl = armed ? L.armedLateral ?? L.lateral : L.lateral;
      let s = apr?.[m] ?? tbl[m] ?? L.lateral[m] ?? m;
      if (L.navSuffix && (m === 'VOR' || m === 'LOC' || m === 'BC')) s = s + this.navRx;
      return s;
    };
    v.setString(AP.lateralActive, modes ? latLabel(this.lat, false) : '');
    v.setString(AP.lateralArmed, modes ? latLabel(this.latArmed, true) : '');
    v.setString(AP.verticalActive, modes && this.vert !== 'NONE' ? L.vertical[this.vert] ?? this.vert : '');
    const parts: string[] = [];
    const av = L.armedVertical ?? {};
    const order: [number, keyof typeof ARM][] = [
      [ARM.ALTS, 'ALTS'],
      [ARM.ALTV, 'ALTV'],
      [ARM.VPATH, 'VPATH'],
      [ARM.GS, 'GS'],
      [ARM.GP, 'GP'],
      [ARM.FLARE, 'FLARE'],
      [ARM.VS, 'VS'],
    ];
    for (const [bit, name] of order) {
      if ((this.vertArmed & bit) === 0) continue;
      const lbl = av[name] ?? name;
      if (lbl) parts.push(lbl);
    }
    v.setString(AP.verticalArmed, modes ? parts.join(' ') : '');
    let status = '';
    if (this.style === 'boeing') {
      if (this.engaged && (this.cwsA || this.cwsB)) status = 'CWS';
      // SINGLE CH: one A/P in APP mode until the second channel couples (SmartCockpit 737 AFDS status annunciations).
      else if (this.engaged && this.approach && this.channels < 2) status = 'SINGLE CH';
      else if (this.engaged) status = 'CMD';
      else if (this.fdOn()) status = 'FD';
    } else {
      status = this.engaged ? 'AP' : this.fdOn() ? 'FD' : '';
    }
    v.setString(AFCS_VARS.status, status);
    v.setString(AFCS_VARS.autoland, this.autoland);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
