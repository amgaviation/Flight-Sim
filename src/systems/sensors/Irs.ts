/**
 * Inertial reference system (737NG ADIRU IR part, G650/Global IRUs).
 *
 * Mode selector (default var `ac.irs{s}_mode`): 0 OFF, 1 ALIGN, 2 NAV, 3 ATT.
 *
 *   OFF  -> ALIGN/NAV: power-up self test (ON DC lamp for `dcTestS`), then
 *        alignment. The aircraft must stay stationary (ground speed below
 *        `motionLimitKt`), otherwise the alignment restarts and the ALIGN
 *        light flashes. Alignment time depends on latitude: 5 min at the
 *        equator to 10 min at 70 deg (737NG FCOM "IRS alignment", as quoted
 *        by SmartCockpit 737NG Navigation); 17 min near 78 deg (EST
 *        extrapolation). A present position must be entered (event
 *        `irs.pos_entry` / `irs{s}.pos_entry`, or automatically from a valid
 *        GPS with `gpsAutoPosition`) before the IRS goes to NAV; without it
 *        the ALIGN light flashes when the alignment time has elapsed.
 *   NAV  -> ALIGN on the ground: fast realign (`fastRealignS`, 30 s) that
 *        zeroes the drift and accepts a new position.
 *   ATT  : reversionary attitude after `attAlignS` of straight and level
 *        flight (30 s, same source); no navigation; heading invalid until a
 *        heading is entered (`irs{s}.hdg_entry` event, payload deg magnetic),
 *        then it drifts at `attHdgDriftDegPerHr`.
 *   Power: `power` (normal AC). When it fails and `dcBackup` is available the
 *        IRS keeps running on DC (ON DC lamp). DC FAIL lamp while the DC
 *        backup is unavailable. Losing both = unpowered (alignment lost).
 *   Drift: in NAV the inertial position error grows at `driftNmPerHr`
 *        (RNP-grade IRS spec ~2 nm/h: FAA AC 20-138D App. 2 / DO-236 INS
 *        performance classes; EST). With `gpsUpdating` true and a valid GPS
 *        (hybrid IRS/GPS, e.g. G650 / Global) the error decays with 60 s tau.
 *
 * Attitude/heading/rates are published through `AttitudePublisher` to the
 * same `ahrs{outputIndex}.*` vars an AHRS would use, so displays do not care.
 * Navigation: irs{s}.lat_deg/lon_deg/gs_kt/trk_true_deg/pos_err_nm/nav_valid.
 * Lamps/state: irs{s}.state, align_light, on_dc, dc_fail, fault, pos_entered.
 * Failures: irs{s} (fault: FAULT lamp, everything invalid).
 */
import type { Subsystem } from '../../aircraft/types';
import type { Table1D } from '../../physics/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { FDM, GPS } from '../../core/vars';
import { interp1 } from '../../core/math';
import { offsetNorthEast } from '../../core/geo';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { listen, norm360, payloadNumber, type BlockEnv } from '../autopilot/lib';
import { AttitudePublisher } from './Ahrs';
import { SENSOR_VARS } from './vars';

/** 737NG alignment time vs |latitude| (s). See file header. */
export const IRS_ALIGN_TIME_737: Table1D = { x: [0, 70, 78.25], y: [300, 600, 1020] };

export enum IrsState {
  Off = 0,
  Aligning = 1,
  Nav = 2,
  Att = 3,
  Fault = 4,
}

export interface IrsConfig {
  /** IRS index `s` (irs{s}.*). */
  index: number;
  /** Index of the `ahrs{n}.*` attitude outputs (default = index). */
  outputIndex?: number;
  /** Mode selector var (default `ac.irs{s}_mode`): 0 OFF, 1 ALIGN, 2 NAV, 3 ATT. */
  modeVar?: string;
  /** Normal power (AC bus). Default true. */
  power?: Binding;
  /** DC backup available (battery / hot battery bus). Default false (no backup). */
  dcBackup?: Binding;
  alignTime?: Table1D;
  fastRealignS?: number;
  attAlignS?: number;
  /** ON DC lamp duration during the power-up self test (s). Default 5 (EST). */
  dcTestS?: number;
  motionLimitKt?: number;
  /** Require a position entry before NAV (default true; Honeywell/Collins hybrid IRUs take GPS: set gpsAutoPosition). */
  requirePosition?: boolean;
  gpsAutoPosition?: boolean;
  /** Hybrid GPS updating in NAV (default false = pure inertial, 737NG). */
  gpsUpdating?: boolean;
  driftNmPerHr?: number;
  attHdgDriftDegPerHr?: number;
  /** Start in NAV (states other than cold & dark). Default false. */
  startAligned?: boolean;
}

export class Irs implements Subsystem {
  readonly name: string;
  readonly index: number;
  readonly out: AttitudePublisher;
  state: IrsState = IrsState.Off;
  /** Seconds left in the current alignment. */
  alignRemaining = 0;
  posEntered = false;
  private readonly vars: SimVars;
  private readonly modeVar: string;
  private readonly power: () => boolean;
  private readonly dc: () => boolean;
  private readonly alignTable: Table1D;
  private readonly fastRealignS: number;
  private readonly attAlignS: number;
  private readonly dcTestS: number;
  private readonly motionKt: number;
  private readonly requirePos: boolean;
  private readonly gpsAuto: boolean;
  private readonly gpsUpd: boolean;
  private readonly driftRate: number;
  private readonly attHdgDrift: number;
  private dcTest = 0;
  private motionFault = 0;
  private attTimer = 0;
  private attHdgEntered = false;
  private attHdgOffset = 0;
  // position error (nm north/east)
  private errN = 0;
  private errE = 0;
  private driftDirRad: number;
  private readonly pos = { lat: 0, lon: 0 };
  private readonly offs: (() => void)[] = [];
  private readonly f: string;
  private readonly n: Record<'state' | 'align' | 'onDc' | 'dcFail' | 'fault' | 'navValid' | 'lat' | 'lon' | 'gs' | 'trk' | 'posErr' | 'posEntered' | 'aligning' | 'alignS', string>;

  constructor(env: BlockEnv, cfg: IrsConfig) {
    const s = cfg.index;
    this.index = s;
    this.name = `irs${s}`;
    this.vars = env.vars;
    this.modeVar = cfg.modeVar ?? SENSOR_VARS.irsModeSel(s);
    this.power = compileCondition(env.vars, cfg.power, true);
    this.dc = compileCondition(env.vars, cfg.dcBackup, false);
    this.alignTable = cfg.alignTime ?? IRS_ALIGN_TIME_737;
    this.fastRealignS = cfg.fastRealignS ?? 30;
    this.attAlignS = cfg.attAlignS ?? 30;
    this.dcTestS = cfg.dcTestS ?? 5;
    this.motionKt = cfg.motionLimitKt ?? 1.5;
    this.requirePos = cfg.requirePosition ?? true;
    this.gpsAuto = cfg.gpsAutoPosition ?? false;
    this.gpsUpd = cfg.gpsUpdating ?? false;
    this.driftRate = cfg.driftNmPerHr ?? 2;
    this.attHdgDrift = cfg.attHdgDriftDegPerHr ?? 15; // EST: free (unslaved) gyro heading drift
    this.driftDirRad = ((s * 137.5) % 360) * (Math.PI / 180); // deterministic, differs per unit
    this.out = new AttitudePublisher(env.vars, cfg.outputIndex ?? s, 0.03);
    this.f = failVar(`irs${s}`);
    this.n = {
      state: SENSOR_VARS.irsState(s), align: SENSOR_VARS.irsAlignLight(s), onDc: SENSOR_VARS.irsOnDc(s),
      dcFail: SENSOR_VARS.irsDcFail(s), fault: SENSOR_VARS.irsFault(s), navValid: SENSOR_VARS.irsNavValid(s),
      lat: SENSOR_VARS.irsLat(s), lon: SENSOR_VARS.irsLon(s), gs: SENSOR_VARS.irsGs(s), trk: SENSOR_VARS.irsTrackTrue(s),
      posErr: SENSOR_VARS.irsPosErr(s), posEntered: SENSOR_VARS.irsPosEntered(s),
      aligning: SENSOR_VARS.aligning(cfg.outputIndex ?? s), alignS: SENSOR_VARS.alignRemaining(cfg.outputIndex ?? s),
    };
    const entry = (): void => this.enterPosition();
    listen(env.events, this.offs, 'irs.pos_entry', entry);
    listen(env.events, this.offs, `irs${s}.pos_entry`, entry);
    listen(env.events, this.offs, `irs${s}.hdg_entry`, (p) => this.enterHeading(payloadNumber(p, NaN)));
    if (cfg.startAligned) this.forceAligned();
  }

  failures(): FailureDef[] {
    return [{ id: `irs${this.index}`, name: `IRS ${this.index}`, category: 'attitude', description: 'IRS fault: FAULT light, attitude/heading/position invalid.' }];
  }

  /** Present position entry (FMS POS INIT / IRS keypad). */
  enterPosition(): void {
    if (this.state === IrsState.Aligning || this.state === IrsState.Nav) {
      this.posEntered = true;
      this.errN = 0;
      this.errE = 0;
    }
  }

  /** ATT-mode magnetic heading entry (deg). */
  enterHeading(hdgMag: number): void {
    if (this.state !== IrsState.Att || !Number.isFinite(hdgMag)) return;
    const trueMag = this.vars.get(FDM.headingMag);
    this.attHdgOffset = hdgMag - trueMag;
    this.attHdgEntered = true;
  }

  /** Puts the IRS straight into NAV with position entered (initial states). */
  forceAligned(): void {
    this.state = IrsState.Nav;
    this.alignRemaining = 0;
    this.posEntered = true;
    this.errN = 0;
    this.errE = 0;
    this.dcTest = 0;
  }

  reset(): void {
    this.out.reset();
    const sel = this.vars.get(this.modeVar);
    if ((sel === 2 || sel === 1) && this.power()) this.forceAligned();
    else this.state = IrsState.Off;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const sel = Math.round(v.get(this.modeVar));
    const ac = this.power();
    const dc = this.dc();
    const failed = v.get(this.f) !== 0;
    const powered = sel !== 0 && (ac || dc);
    const onGround = v.get(FDM.onGround) !== 0;
    const gs = v.get(FDM.gs);

    // ---- state transitions
    if (!powered || sel === 0) {
      this.state = IrsState.Off;
      this.posEntered = false;
      this.attHdgEntered = false;
    } else if (failed) {
      this.state = IrsState.Fault;
    } else if (this.state === IrsState.Off || this.state === IrsState.Fault) {
      if (sel === 3) this.beginAtt();
      else this.beginAlign(false);
      this.dcTest = this.dcTestS;
    } else if (sel === 3 && this.state !== IrsState.Att) {
      this.beginAtt();
    } else if (sel !== 3 && this.state === IrsState.Att) {
      // ATT -> ALIGN/NAV requires a full alignment on the ground.
      this.beginAlign(false);
    } else if (sel === 1 && this.state === IrsState.Nav && onGround && gs < this.motionKt) {
      this.beginAlign(true); // fast realign
    }

    // ---- alignment
    if (this.state === IrsState.Aligning) {
      if (gs > this.motionKt) {
        // Motion during alignment: restart (ALIGN flashes for 10 s).
        this.motionFault = 10;
        this.alignRemaining = this.alignTimeS();
      } else if (this.alignRemaining > 0) {
        this.alignRemaining = Math.max(0, this.alignRemaining - dt);
      }
      if (!this.posEntered && this.gpsAuto && v.get(GPS.valid) !== 0) this.posEntered = true;
      const posOk = this.posEntered || !this.requirePos;
      if (this.alignRemaining <= 0 && posOk && sel === 2) this.state = IrsState.Nav;
    }
    if (this.motionFault > 0) this.motionFault = Math.max(0, this.motionFault - dt);
    if (this.dcTest > 0) this.dcTest = Math.max(0, this.dcTest - dt);

    // ---- ATT mode leveling
    if (this.state === IrsState.Att) {
      const level = Math.abs(v.get(FDM.bank)) < 3 && Math.abs(v.get(FDM.turnRate)) < 0.5;
      this.attTimer = level ? this.attTimer + dt : Math.max(0, this.attTimer - dt);
      if (this.attHdgEntered) this.attHdgOffset += (this.attHdgDrift / 3600) * dt;
    }

    // ---- drift
    if (this.state === IrsState.Nav) {
      const gpsOk = this.gpsUpd && v.get(GPS.valid) !== 0;
      if (gpsOk) {
        const k = 1 - Math.exp(-dt / 60);
        this.errN -= this.errN * k;
        this.errE -= this.errE * k;
      } else if (!onGround || gs > this.motionKt) {
        const step = (this.driftRate / 3600) * dt;
        this.errN += step * Math.cos(this.driftDirRad);
        this.errE += step * Math.sin(this.driftDirRad);
      }
    }

    // ---- outputs
    const attValid = this.state === IrsState.Nav || (this.state === IrsState.Att && this.attTimer >= this.attAlignS);
    const hdgValid = this.state === IrsState.Nav || (this.state === IrsState.Att && this.attHdgEntered && attValid);
    if (this.state === IrsState.Att) this.out.hdgErr = this.attHdgOffset;
    else this.out.hdgErr = 0;
    if (attValid || hdgValid) this.out.publish(dt, attValid, hdgValid);
    else this.out.invalidate();

    const navValid = this.state === IrsState.Nav;
    v.set(this.n.navValid, navValid ? 1 : 0);
    if (navValid) {
      offsetNorthEast(v.get(FDM.lat), v.get(FDM.lon), this.errN * 1852, this.errE * 1852, 0, this.pos);
      v.set(this.n.lat, this.pos.lat);
      v.set(this.n.lon, this.pos.lon);
      v.set(this.n.gs, gs);
      v.set(this.n.trk, norm360(v.get(FDM.trackTrue)));
      v.set(this.n.posErr, Math.hypot(this.errN, this.errE));
    }
    let alignLight = 0;
    if (this.state === IrsState.Aligning) {
      const needPos = this.requirePos && !this.posEntered && this.alignRemaining <= 0;
      alignLight = this.motionFault > 0 || needPos ? 2 : 1;
    } else if (this.state === IrsState.Nav && sel === 1) {
      alignLight = 1;
    }
    v.set(this.n.state, powered && sel !== 0 ? this.state : IrsState.Off);
    v.set(this.n.align, alignLight);
    v.set(this.n.onDc, powered && (this.dcTest > 0 || (!ac && dc)) ? 1 : 0);
    v.set(this.n.dcFail, powered && !dc ? 1 : 0);
    v.set(this.n.fault, powered && failed ? 1 : 0);
    v.set(this.n.posEntered, this.posEntered ? 1 : 0);
    v.set(this.n.aligning, this.state === IrsState.Aligning ? 1 : 0);
    v.set(this.n.alignS, this.state === IrsState.Aligning ? this.alignRemaining : 0);
  }

  private alignTimeS(): number {
    return interp1(this.alignTable, Math.abs(this.vars.get(FDM.lat)));
  }

  private beginAlign(fast: boolean): void {
    this.state = IrsState.Aligning;
    this.alignRemaining = fast ? this.fastRealignS : this.alignTimeS();
    if (!fast) this.posEntered = false;
    this.errN = 0;
    this.errE = 0;
  }

  private beginAtt(): void {
    this.state = IrsState.Att;
    this.attTimer = 0;
    this.attHdgEntered = false;
    this.attHdgOffset = 0;
  }
}
