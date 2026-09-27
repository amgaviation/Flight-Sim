/**
 * 737NG Autopilot / Flight Director System (AFDS) and autothrottle glue:
 * the Mode Control Panel (MCP) knobs, switches and windows, the flight mode
 * annunciations (FMA), the A/P, A/T and FMC disengage / alert lights, and
 * the 737-specific AFDS behaviour layered on the generic `systems/autopilot`
 * Afcs (preset AFCS_B737_AFDS) and `systems/fadec` Autothrottle ('boeing').
 *
 * One subsystem runs, in order: MCP input handling and pre-processing of
 * the FMC targets, the Afcs, VNAV post-processing, the autothrottle, then
 * the annunciations. 737 behaviour added here (SmartCockpit "Boeing 737
 * Systems Review - Automatic Flight" = [AFS]; b737.org.uk AFDS / FMA pages):
 *
 *  - LNAV and VNAV armed on the ground (FMA white): LNAV engages at 50 ft RA
 *    (within 3 nm of the active leg), VNAV at 400 ft RA [AFS];
 *  - TO/GA roll mode: the roll FMA shows TO/GA after a TO/GA push until
 *    another roll mode is selected or CMD engages (HDG SEL) [AFS];
 *  - VNAV target speed during take-off: V2 + 20 kt until the acceleration
 *    height (TAKEOFF REF), then limited to the flap placard speed - 5 kt
 *    (FCOM 11.31 "VNAV climb"; placards [LIM]);
 *  - VNAV ALT: in VNAV, capturing an MCP altitude below the cruise altitude
 *    levels off in "VNAV ALT" (A/T FMC SPD) instead of leaving VNAV;
 *  - speed intervention (SPD INTV) opens the IAS/MACH window in VNAV and
 *    makes the MCP speed the VNAV target (A/T MCP SPD);
 *  - ALT INTV: in cruise sets the FMC cruise altitude to the MCP altitude;
 *    in climb / descent deletes the next altitude constraint between the
 *    aircraft and the MCP altitude (no EXEC needed) and resumes VNAV;
 *  - DES NOW (FMC DES page): starts a ~1,000 fpm VNAV descent before T/D
 *    until the path is intercepted;
 *  - automatic IAS / Mach changeover of the MCP speed at FL260 [AFS];
 *  - MCP windows (IAS/MACH blank in VNAV, V/S blank unless V/S engaged),
 *    button lights, F/D master (MA) lights, bank angle selector 10-30 deg;
 *  - FMA strings for the PFD (A/T, roll, pitch, armed modes, AFDS status
 *    FD / CMD / CWS / SINGLE CH / LAND 3 / LAND 2 / NO AUTOLAND; CWS P, CWS R,
 *    SINGLE CH and NO AUTOLAND amber);
 *  - disengage lights: A/P flashing red after a disconnect (reset by the
 *    disconnect switch or by pushing the light), A/T flashing red after a
 *    disconnect and flashing amber when the speed is not held (A/T
 *    SPD warn), FMC amber with an alerting FMC message; TEST 1 all amber,
 *    TEST 2 A/P and A/T red [AFS §8].
 *
 * The DISENGAGE bar (`ac.mcp.disengage_bar`) disconnects the A/P and
 * inhibits engagement (Afcs engage inhibit / auto disconnect bindings).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { Subsystem } from '../../../aircraft/types';
import { ADC, AP, FMS, NAV } from '../../../core/vars';
import type { FailureDef } from '../../../systems/failures/FailureManager';
import { compileCondition, type Binding } from '../../../systems/util/binding';
import { Afcs } from '../../../systems/autopilot/Afcs';
import { AFCS_B737_AFDS } from '../../../systems/autopilot/presets';
import { AFCS_VARS } from '../../../systems/autopilot/vars';
import { ARM, type AfcsConfig, type VerticalMode } from '../../../systems/autopilot/types';
import { payloadNumber } from '../../../systems/autopilot/lib';
import { Autothrottle, type AutothrottleConfig } from '../../../systems/fadec/Autothrottle';
import type { Fms } from '../../../nav/fms/Fms';
import type { ResolvedB737Config } from '../config';
import type { B737Fmc } from '../fmc/Fmc';
import { B737_EVENTS, B737_VARS, MCP_BUTTONS, type McpButton, type Side } from '../vars';
import { B738_FLAPS, B738_SPEEDS, flapManeuverSpeed } from '../data/b738';

export interface AfdsEnv {
  vars: SimVars;
  events: EventBus;
  cfg: ResolvedB737Config;
  fms: Fms | null;
  fmc: B737Fmc | null;
}

/** MCP bank angle selector positions (deg). */
export const BANK_POSITIONS = [10, 15, 20, 25, 30] as const;
/** Automatic IAS/Mach changeover altitude (ft) [AFS: "approximately FL260"]. */
const CHANGEOVER_FT = 26000;
/** Flash period of the disengage lights (s, EST ~2 Hz). */
const FLASH_S = 0.5;

const VNAV_MODES: ReadonlySet<VerticalMode> = new Set<VerticalMode>(['VFLC', 'VPATH', 'VALT', 'ALTV']);

function orBinding(a: string, b: Binding | undefined): Binding {
  if (b === undefined) return a;
  if (typeof b === 'number') return b !== 0 ? 1 : a;
  return `(${a}) || (${b})`;
}

export class B737Afds implements Subsystem {
  readonly name = 'b737_afds';
  readonly afcs: Afcs | null;
  readonly at: Autothrottle | null;
  /** LNAV / VNAV armed on the ground (engage at 50 / 400 ft RA). */
  lnavGroundArmed = false;
  vnavGroundArmed = false;
  /** VNAV levelled at the MCP altitude (VNAV ALT). */
  vnavAlt = false;
  /** Speed intervention in VNAV. */
  spdIntv = false;
  /** Roll FMA shows TO/GA (after a TO/GA push, until another roll mode). */
  toRoll = false;

  private readonly vars: SimVars;
  private readonly events: EventBus;
  private readonly cfg: ResolvedB737Config;
  private readonly fms: Fms | null;
  private readonly fmc: B737Fmc | null;
  private readonly offs: (() => void)[] = [];
  private readonly mcpPower: () => boolean;
  private readonly onGround: () => boolean;
  private prevVert: VerticalMode = 'NONE';
  private prevLat = 'NONE';
  private prevEngaged = false;
  private vnavCapture = false;
  private master: 0 | 1 | 2 = 0;
  private prevFd = [false, false];
  private prevAlt = NaN;
  private flashT = 0;
  private desNowActive = false;

  constructor(env: AfdsEnv) {
    const v = env.vars;
    this.vars = v;
    this.events = env.events;
    this.cfg = env.cfg;
    this.fms = env.fms;
    this.fmc = env.fmc;
    const a = env.cfg.afds;
    this.mcpPower = compileCondition(v, env.cfg.power.mcp, true);
    this.onGround = compileCondition(v, env.cfg.vars.onGround, true);
    // MCP power-up values (EST: 100 kt, heading 360, altitude 0).
    if (!v.has(AP.selSpeed)) v.set(AP.selSpeed, 100);
    if (!v.has(AFCS_VARS.bankSelect)) v.set(AFCS_VARS.bankSelect, 25);
    if (a.create === false) {
      this.afcs = null;
      this.at = null;
    } else {
      const bar = `${B737_VARS.mcpDisengageBar} != 0`;
      const hydA = env.cfg.vars.hydAPsi;
      const hydB = env.cfg.vars.hydBPsi;
      const afcsCfg: AfcsConfig = {
        ...AFCS_B737_AFDS,
        power: a.power,
        // Servo power: A/P A on hydraulic system A, A/P B on system B (FCOM 4.20); missing vars = powered.
        servoPower: a.servoPower ?? [`${hydA} ?? 3000 > 1000`, `${hydB} ?? 3000 > 1000`],
        gains: a.gains,
        disconnect: {
          ...AFCS_B737_AFDS.disconnect,
          engageInhibit: orBinding(bar, a.engageInhibit),
          auto: orBinding(bar, a.autoDisconnect),
        },
        autoland: { ...AFCS_B737_AFDS.autoland, rollout: env.cfg.autoland === 'fail-operational' },
        sensors: {
          ra: `ra${env.cfg.vars.raIndex[0]}.alt_ft`,
          raValid: `ra${env.cfg.vars.raIndex[0]}.valid`,
          flaps: env.cfg.vars.flapsDeg,
          onGround: env.cfg.vars.onGround,
        },
        ...a.afcs,
      };
      this.afcs = new Afcs({ vars: v, events: env.events }, afcsCfg);
      const atCfg: AutothrottleConfig = {
        engines: [1, 2],
        style: 'boeing',
        leverVar: a.leverVar,
        power: a.atPower,
        vmoKt: B738_SPEEDS.vmoKt,
        mmo: B738_SPEEDS.mmo,
        ...a.autothrottle,
      };
      this.at = new Autothrottle({ vars: v, events: env.events }, atCfg);
    }
    const ev = env.events;
    const on = (name: string, fn: (p: unknown) => void): void => {
      this.offs.push(ev.on(name, fn));
    };
    for (const b of MCP_BUTTONS) on(B737_EVENTS.mcpButton(b), () => this.button(b));
    const clicks = (p: unknown): number => payloadNumber(p, 1);
    on(B737_EVENTS.mcpSpdInc, (p) => this.speedKnob(clicks(p)));
    on(B737_EVENTS.mcpSpdDec, (p) => this.speedKnob(-clicks(p)));
    on(B737_EVENTS.mcpHdgInc, (p) => this.headingKnob(clicks(p)));
    on(B737_EVENTS.mcpHdgDec, (p) => this.headingKnob(-clicks(p)));
    on(B737_EVENTS.mcpAltInc, (p) => this.altitudeKnob(clicks(p)));
    on(B737_EVENTS.mcpAltDec, (p) => this.altitudeKnob(-clicks(p)));
    // V/S wheel: UP = nose down (FCOM MCP: wheel "DN" increases the rate of climb).
    on(B737_EVENTS.mcpVsUp, (p) => this.vsWheel(-clicks(p)));
    on(B737_EVENTS.mcpVsDn, (p) => this.vsWheel(clicks(p)));
    for (const s of [1, 2] as Side[]) {
      on(B737_EVENTS.mcpCrsInc(s), (p) => this.courseKnob(s, clicks(p)));
      on(B737_EVENTS.mcpCrsDec(s), (p) => this.courseKnob(s, -clicks(p)));
    }
    on(B737_EVENTS.mcpBankInc, (p) => this.bankKnob(clicks(p)));
    on(B737_EVENTS.mcpBankDec, (p) => this.bankKnob(-clicks(p)));
    on(B737_EVENTS.mcpSpdIntv, () => this.speedIntervention());
    on(B737_EVENTS.mcpAltIntv, () => this.altitudeIntervention());
    on(B737_EVENTS.apLightPush, () => this.events.emit('ap.disc_reset'));
    on(B737_EVENTS.atLightPush, () => this.events.emit('at.disc_reset'));
    on(B737_EVENTS.fmcLightPush, () => this.fmc?.acknowledgeAlert());
  }

  failures(): FailureDef[] {
    return [...(this.afcs?.failures() ?? []), ...(this.at?.failures() ?? [])];
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
    this.afcs?.dispose();
    this.at?.dispose();
  }

  reset(): void {
    this.afcs?.reset();
    this.at?.reset();
    this.lnavGroundArmed = false;
    this.vnavGroundArmed = false;
    this.vnavAlt = false;
    this.vnavCapture = false;
    this.spdIntv = false;
    this.prevAlt = NaN;
  }

  // =================================================================== MCP inputs

  private get vnavEngaged(): boolean {
    const a = this.afcs;
    return !!a && (VNAV_MODES.has(a.vert) || this.vnavAlt);
  }

  private fdOn(): boolean {
    return this.vars.get(AP.fdOn(1)) !== 0 || this.vars.get(AP.fdOn(2)) !== 0;
  }

  private button(b: McpButton): void {
    if (!this.mcpPower()) return;
    const ev = this.events;
    switch (b) {
      case 'n1':
        ev.emit('at.n1');
        return;
      case 'speed':
        ev.emit('at.spd');
        return;
      case 'co':
        ev.emit('ap.spd_mach');
        return;
      case 'lvlchg':
        this.leaveVnav();
        ev.emit('ap.lvlchg');
        return;
      case 'vnav':
        this.pressVnav();
        return;
      case 'hdgsel':
        this.toRoll = false;
        ev.emit('ap.hdg');
        return;
      case 'lnav':
        this.pressLnav();
        return;
      case 'vorloc':
        ev.emit('ap.vorloc');
        return;
      case 'app':
        ev.emit('ap.app');
        return;
      case 'althld':
        this.leaveVnav();
        ev.emit('ap.alt');
        return;
      case 'vs':
        this.leaveVnav();
        ev.emit('ap.vs');
        return;
      case 'cmd_a':
        ev.emit('ap.cmd_a');
        return;
      case 'cmd_b':
        ev.emit('ap.cmd_b');
        return;
      case 'cws_a':
        ev.emit('ap.cws_a');
        return;
      case 'cws_b':
        ev.emit('ap.cws_b');
        return;
    }
  }

  private leaveVnav(): void {
    this.vnavAlt = false;
    this.vnavCapture = false;
    this.spdIntv = false;
  }

  private pressLnav(): void {
    const a = this.afcs;
    if (a && this.onGround()) {
      // Armed on the ground with a F/D on (engages at 50 ft RA).
      if (!this.fdOn() && !a.engaged) return;
      if (!this.lnavGroundArmed && this.vars.get(FMS.lnavValid) === 0 && !(this.fmc?.hasActiveRoute ?? false)) return;
      this.lnavGroundArmed = !this.lnavGroundArmed;
      if (a.latArmed === 'LNAV') a.latArmed = 'NONE';
      return;
    }
    this.lnavGroundArmed = false;
    this.events.emit('ap.lnav');
  }

  private pressVnav(): void {
    const a = this.afcs;
    if (a && this.onGround()) {
      if (!this.fdOn() && !a.engaged) return;
      if (!this.vnavGroundArmed && !(this.fmc?.hasActiveRoute ?? true)) return;
      this.vnavGroundArmed = !this.vnavGroundArmed;
      return;
    }
    this.vnavGroundArmed = false;
    if (a && this.vnavAlt) {
      // VNAV ALT: pushing VNAV again resumes the climb / descent (the Afcs is in ALT HOLD).
      this.vnavAlt = false;
      this.vnavCapture = false;
      a.press('VNAV');
      return;
    }
    if (this.vnavEngaged) this.spdIntv = false;
    this.events.emit('ap.vnav');
  }

  private speedKnob(clicks: number): void {
    if (!this.mcpPower()) return;
    const v = this.vars;
    // The window is blank in VNAV without intervention: the knob has no effect.
    if (this.vnavEngaged && !this.spdIntv) return;
    if (v.get(AP.speedIsMach) !== 0) {
      const m = Math.round((v.get(AP.selMach) + clicks * 0.01) * 100) / 100;
      v.set(AP.selMach, Math.max(0.6, Math.min(0.89, m)));
    } else {
      v.set(AP.selSpeed, Math.max(100, Math.min(399, Math.round(v.get(AP.selSpeed)) + clicks)));
    }
  }

  private headingKnob(clicks: number): void {
    if (!this.mcpPower()) return;
    const v = this.vars;
    const h = (((Math.round(v.get(AP.selHeading)) + clicks) % 360) + 360) % 360;
    v.set(AP.selHeading, h);
  }

  private altitudeKnob(clicks: number): void {
    if (!this.mcpPower()) return;
    const v = this.vars;
    // 100 ft per click (FCOM MCP altitude selector), 0-50,000 ft.
    const a = Math.round(v.get(AP.selAltitude) / 100) * 100 + clicks * 100;
    v.set(AP.selAltitude, Math.max(0, Math.min(50000, a)));
  }

  private vsWheel(clicks: number): void {
    if (!this.mcpPower()) return;
    const v = this.vars;
    const a = this.afcs;
    // A wheel movement in ALT HOLD with V/S armed (new MCP altitude) engages V/S [AFS].
    if (a && a.vert !== 'VS') {
      if ((a.vertArmed & ARM.VS) !== 0) {
        this.leaveVnav();
        a.press('VS');
      }
      return;
    }
    let vs = v.get(AP.selVs);
    for (let i = 0; i < Math.abs(clicks); i++) {
      // 50 fpm steps below 1,000 fpm, 100 fpm above (FCOM MCP V/S thumbwheel).
      const step = Math.abs(vs) < 1000 || (Math.abs(vs) === 1000 && Math.sign(clicks) !== Math.sign(vs)) ? 50 : 100;
      vs += Math.sign(clicks) * step;
    }
    v.set(AP.selVs, Math.max(-7900, Math.min(6000, vs)));
  }

  private courseKnob(s: Side, clicks: number): void {
    if (!this.mcpPower()) return;
    const v = this.vars;
    const c = (((Math.round(v.get(AP.selCourse(s))) + clicks) % 360) + 360) % 360;
    v.set(AP.selCourse(s), c);
    // CRS L drives VHF NAV 1, CRS R VHF NAV 2.
    v.set(NAV.obs(s), c);
  }

  private bankKnob(clicks: number): void {
    const v = this.vars;
    const cur = v.get(AFCS_VARS.bankSelect, 25);
    let i = BANK_POSITIONS.findIndex((b) => b >= cur - 0.5);
    if (i < 0) i = BANK_POSITIONS.length - 1;
    i = Math.max(0, Math.min(BANK_POSITIONS.length - 1, i + clicks));
    v.set(AFCS_VARS.bankSelect, BANK_POSITIONS[i]);
  }

  private speedIntervention(): void {
    if (!this.mcpPower() || !this.vnavEngaged) return;
    const v = this.vars;
    this.spdIntv = !this.spdIntv;
    if (this.spdIntv) {
      // The window opens with the current FMC target.
      const m = v.get(FMS.vnavTargetMach);
      if (m > 0) {
        v.set(AP.selMach, Math.round(m * 100) / 100);
        v.set(AP.speedIsMach, 1);
      } else {
        v.set(AP.selSpeed, Math.round(v.get(FMS.vnavTargetSpeedKt)));
        v.set(AP.speedIsMach, 0);
      }
    }
  }

  private altitudeIntervention(): void {
    if (!this.mcpPower() || !this.fms) return;
    const a = this.afcs;
    const v = this.vars;
    const sel = v.get(AP.selAltitude);
    const alt = v.get(ADC.baroAlt(this.cfg.adiru[0]));
    const fmc = this.fmc;
    const phase = this.fms.vnav.phase;
    if (phase === 'CRZ' && fmc) {
      // New cruise altitude (no EXEC required: FCOM 11.31 "ALT INTV").
      if (Math.abs(sel - fmc.perf.crzAltFt) > 100) {
        fmc.perf.crzAltFt = sel;
        if (fmc.perfMod) fmc.perfMod.crzAltFt = sel;
        fmc.version++;
      }
    } else {
      // Delete the next constraint between the aircraft and the MCP altitude.
      const plan = this.fms.plans.active;
      const climb = sel > alt;
      for (let i = Math.max(0, plan.activeLegIndex); i < plan.legs.length; i++) {
        const l = plan.legs[i];
        const c = l.altitude;
        if (!c || l.type === 'DISCO' || l.type === 'CA' || l.type === 'VA' || l.type === 'FA') continue;
        const lim = climb ? c.upperFt ?? c.lowerFt : c.lowerFt ?? c.upperFt;
        if (lim === undefined) continue;
        if (climb ? lim < sel && lim > alt - 100 : lim > sel && lim < alt + 100) {
          l.altitude = undefined;
          plan.touch();
          break;
        }
      }
    }
    if (a && this.vnavAlt) {
      this.vnavAlt = false;
      this.vnavCapture = false;
      a.press('VNAV');
    }
  }

  // =================================================================== update

  update(dt: number): void {
    const v = this.vars;
    const a = this.afcs;
    const ground = this.onGround();
    this.flashT = (this.flashT + dt) % (2 * FLASH_S);
    this.preProcess(ground);
    if (a) a.update(dt);
    this.midProcess();
    if (this.at) this.at.update(dt);
    this.annunciate(ground);
    if (a) {
      this.prevVert = a.vert;
      this.prevLat = a.lat;
      this.prevEngaged = a.engaged;
    }
    this.prevAlt = v.get(ADC.baroAlt(this.cfg.adiru[0]));
  }

  /** Before the Afcs: ground-armed modes, TO roll, VNAV target speed shaping, speed intervention, DES NOW. */
  private preProcess(ground: boolean): void {
    const v = this.vars;
    const a = this.afcs;
    const ra = v.get(`ra${this.cfg.vars.raIndex[0]}.alt_ft`, 99999);
    const raOk = v.get(`ra${this.cfg.vars.raIndex[0]}.valid`, 1) !== 0;
    const agl = raOk ? ra : 99999;
    if (a) {
      if (this.lnavGroundArmed && !ground && agl >= 50) {
        this.lnavGroundArmed = false;
        if (a.lat !== 'LNAV') a.latArmed = 'LNAV';
      }
      if (this.vnavGroundArmed && !ground && agl >= 400) {
        this.vnavGroundArmed = false;
        a.press('VNAV');
      }
      if (!this.fdOn() && !a.engaged) {
        this.lnavGroundArmed = false;
        this.vnavGroundArmed = false;
      }
      if (!VNAV_MODES.has(a.vert) && !this.vnavAlt) this.spdIntv = false;
    }
    // Automatic IAS/Mach changeover of the MCP speed at FL260 (not in VNAV: the FMC target governs).
    const alt = v.get(ADC.baroAlt(this.cfg.adiru[0]));
    if (Number.isFinite(this.prevAlt) && !this.vnavEngaged) {
      const isMach = v.get(AP.speedIsMach) !== 0;
      if (!isMach && this.prevAlt < CHANGEOVER_FT && alt >= CHANGEOVER_FT) this.events.emit('ap.spd_mach');
      else if (isMach && this.prevAlt > CHANGEOVER_FT && alt <= CHANGEOVER_FT) this.events.emit('ap.spd_mach');
    }
    if (!this.fms) return;
    // FMC failed / unpowered: no LNAV / VNAV guidance for the AFDS (the nav FMS keeps computing).
    if (this.fmc && !this.fmc.powered) {
      v.set(FMS.lnavValid, 0);
      v.set(FMS.vnavValid, 0);
      v.setString(FMS.vnavPhase, '');
      return;
    }
    // VNAV target speed: take-off V2+20 below the acceleration height, flap placard - 5 kt, speed intervention.
    let kt = v.get(FMS.vnavTargetSpeedKt);
    let mach = v.get(FMS.vnavTargetMach);
    const fmc = this.fmc;
    if (!ground && fmc) {
      const elev = fmc.originElevFt;
      const aglOrigin = Number.isFinite(elev) ? alt - elev : agl;
      const climbing = this.fms.vnav.phase === 'CLB';
      if (climbing && aglOrigin < fmc.accelHtFt && Number.isFinite(fmc.v2Sel) && v.get(this.cfg.vars.flapsDeg) >= 0.5) {
        kt = fmc.v2Sel + 20;
        mach = 0;
      }
      const placard = flapPlacardKt(v.get(this.cfg.vars.flapsDeg));
      if (kt > placard - 5) {
        kt = placard - 5;
        mach = 0;
      }
    }
    if (this.spdIntv) {
      if (v.get(AP.speedIsMach) !== 0) mach = v.get(AP.selMach);
      else {
        kt = v.get(AP.selSpeed);
        mach = 0;
      }
    }
    v.set(FMS.vnavTargetSpeedKt, kt);
    v.set(FMS.vnavTargetMach, mach);
    // DES NOW: a ~1,000 fpm VNAV descent before T/D until the path is intercepted.
    this.desNowActive = false;
    if (fmc?.desNow && this.fms.vnav.phase === 'CRZ' && a && (a.vert === 'VALT' || a.vert === 'VPATH') && v.get(AP.selAltitude) < alt - 100) {
      this.desNowActive = true;
      v.setString(FMS.vnavPhase, 'DES');
      v.set(FMS.vnavValid, 1);
      v.set(FMS.vnavDevFt, 0);
      v.set(FMS.vsRequiredFpm, -1000);
    }
  }

  /** After the Afcs, before the A/T: VNAV ALT, TO roll bookkeeping, FMC SPD for the A/T. */
  private midProcess(): void {
    const a = this.afcs;
    if (!a) return;
    const v = this.vars;
    // VNAV capture of the MCP altitude -> VNAV ALT.
    if (a.vert === 'ALTS' && VNAV_MODES.has(this.prevVert) && this.prevVert !== 'ALTV') this.vnavCapture = true;
    if (a.vert === 'ALT' && this.vnavCapture) {
      // FCOM 4.20: levelling at the FMC cruise altitude (MCP altitude = CRZ ALT) is VNAV PTH, not VNAV ALT
      // (VNAV ALT is only for an MCP altitude that conflicts with the VNAV profile). The Afcs's VNAV press
      // in the CRZ phase holds the current altitude in VALT (= VNAV PTH).
      const pc = this.fmc?.perf.crzAltFt;
      const crz = pc !== undefined && Number.isFinite(pc) ? pc : v.get(FMS.cruiseAltFt);
      if (crz > 0 && Math.abs(v.get(AP.selAltitude) - crz) < 100 && v.getString(FMS.vnavPhase) === 'CRZ') {
        this.vnavCapture = false;
        a.press('VNAV');
      } else this.vnavAlt = true;
    }
    if (a.vert !== 'ALTS' && a.vert !== 'ALT') {
      this.vnavCapture = false;
      this.vnavAlt = false;
    }
    if (this.vnavAlt || this.vnavCapture) v.set(AFCS_VARS.atSpeedFms, 1);
    if (this.spdIntv) v.set(AFCS_VARS.atSpeedFms, 0);
    // TO/GA roll annunciation.
    if ((a.vert === 'TO' || a.vert === 'GA') && this.prevVert !== a.vert) this.toRoll = true;
    if (a.lat !== this.prevLat && this.prevLat !== 'NONE' && a.lat !== 'HDG') this.toRoll = false;
    if (a.lat !== 'HDG' && a.lat !== 'TRK' && a.lat !== 'GA' && a.lat !== 'TO') this.toRoll = false;
    if (a.engaged && !this.prevEngaged) this.toRoll = false;
  }

  // =================================================================== annunciations

  private annunciate(ground: boolean): void {
    const v = this.vars;
    const a = this.afcs;
    const powered = this.mcpPower();
    const flashOn = this.flashT < FLASH_S;
    // ---------------------------------------------------------------- FMA
    const atOn = v.get(AP.athr) !== 0;
    v.setString(B737_VARS.fmaAt, atOn ? v.getString(AP.athrMode) : '');
    let roll = '';
    let rollArmed = '';
    let pitch = '';
    let pitchArmed = '';
    let status = v.getString(AFCS_VARS.status);
    let rollAmber = 0;
    let pitchAmber = 0;
    if (a) {
      const modes = a.engaged || this.fdOn();
      if (modes) {
        switch (a.lat) {
          case 'HDG':
            roll = this.toRoll ? 'TO/GA' : 'HDG SEL';
            break;
          case 'LNAV':
            roll = 'LNAV';
            break;
          case 'VOR':
          case 'LOC':
            roll = 'VOR/LOC';
            break;
          case 'TO':
          case 'GA':
          case 'TRK':
            roll = 'TO/GA';
            break;
          case 'CWS':
            roll = 'CWS R';
            rollAmber = 1;
            break;
          case 'ROLLOUT':
            roll = 'ROLLOUT';
            break;
          default:
            roll = '';
        }
        if (a.latArmed === 'LNAV' || this.lnavGroundArmed) rollArmed = 'LNAV';
        else if (a.latArmed === 'VOR' || a.latArmed === 'LOC') rollArmed = 'VOR/LOC';
        else if (this.cfg.autoland === 'fail-operational' && a.channels === 2 && a.approach && a.lat === 'LOC') rollArmed = 'ROLLOUT';
        switch (a.vert) {
          case 'TO':
          case 'GA':
            pitch = 'TO/GA';
            break;
          case 'ALT':
            pitch = this.vnavAlt ? 'VNAV ALT' : 'ALT HOLD';
            break;
          case 'ALTS':
            pitch = 'ALT ACQ';
            break;
          case 'ALTV':
          case 'VPATH':
          case 'VALT':
            pitch = 'VNAV PTH';
            break;
          case 'VFLC':
            pitch = 'VNAV SPD';
            break;
          case 'VS':
            pitch = 'V/S';
            break;
          case 'FLC':
            pitch = 'MCP SPD';
            break;
          case 'GS':
            pitch = 'G/S';
            break;
          case 'FLARE':
            pitch = 'FLARE';
            break;
          case 'CWS':
            pitch = 'CWS P';
            pitchAmber = 1;
            break;
          default:
            pitch = '';
        }
        const parts: string[] = [];
        if (this.vnavGroundArmed) parts.push('VNAV');
        if ((a.vertArmed & ARM.GS) !== 0) parts.push('G/S');
        if ((a.vertArmed & ARM.FLARE) !== 0) parts.push('FLARE');
        if ((a.vertArmed & ARM.VS) !== 0) parts.push('V/S');
        pitchArmed = parts.join(' ');
      }
      if (this.cfg.autoland === 'fail-operational' && a.channels === 2) {
        const al = v.getString(AFCS_VARS.autoland);
        if (al) status = al;
      }
    } else {
      roll = v.getString(AP.lateralActive);
      rollArmed = v.getString(AP.lateralArmed);
      pitch = v.getString(AP.verticalActive);
      pitchArmed = v.getString(AP.verticalArmed);
    }
    v.setString(B737_VARS.fmaRoll, roll);
    v.setString(B737_VARS.fmaRollArmed, rollArmed);
    v.setString(B737_VARS.fmaPitch, pitch);
    v.setString(B737_VARS.fmaPitchArmed, pitchArmed);
    v.setString(B737_VARS.fmaStatus, status);
    v.set(B737_VARS.fmaRollAmber, rollAmber);
    v.set(B737_VARS.fmaPitchAmber, pitchAmber);
    v.set(B737_VARS.fmaStatusAmber, status === 'NO AUTOLAND' || status === 'SINGLE CH' ? 1 : 0);

    // ---------------------------------------------------------------- MCP windows
    const blankSpd = this.vnavEngaged && !this.spdIntv;
    const isMach = v.get(AP.speedIsMach) !== 0;
    const vsActive = a ? a.vert === 'VS' : v.getString(AP.verticalActive) === 'V/S';
    v.set(B737_VARS.mcpSpdBlank, blankSpd ? 1 : 0);
    v.set(B737_VARS.mcpVsBlank, vsActive ? 0 : 1);
    v.set(B737_VARS.mcpSpdIntv, this.spdIntv ? 1 : 0);
    if (powered) {
      const sel = v.get(AP.selSpeed);
      v.setString(B737_VARS.mcpWinSpd, blankSpd ? '' : isMach ? `.${String(Math.round(v.get(AP.selMach) * 100)).padStart(2, '0')}` : String(Math.round(sel)));
      v.setString(B737_VARS.mcpWinHdg, String(Math.round(v.get(AP.selHeading)) % 360).padStart(3, '0'));
      v.setString(B737_VARS.mcpWinAlt, String(Math.round(v.get(AP.selAltitude))));
      const vs = Math.round(v.get(AP.selVs));
      v.setString(B737_VARS.mcpWinVs, vsActive ? (vs > 0 ? `+${vs}` : String(vs)) : '');
      for (const s of [1, 2] as Side[]) v.setString(B737_VARS.mcpWinCrs(s), String(Math.round(v.get(AP.selCourse(s))) % 360).padStart(3, '0'));
    } else {
      for (const n of [B737_VARS.mcpWinSpd, B737_VARS.mcpWinHdg, B737_VARS.mcpWinAlt, B737_VARS.mcpWinVs, B737_VARS.mcpWinCrs(1), B737_VARS.mcpWinCrs(2)]) v.setString(n, '');
    }
    // PFD speed cursor: FMC target in VNAV (magenta), else the MCP speed.
    const ias = v.get(ADC.ias(this.cfg.adiru[0]));
    const machNow = v.get(ADC.mach(this.cfg.adiru[0]));
    let curKt: number;
    let curMach = 0;
    if (blankSpd) {
      curKt = v.get(FMS.vnavTargetSpeedKt);
      const m = v.get(FMS.vnavTargetMach);
      if (m > 0) {
        curMach = m;
        if (machNow > 0.05) curKt = ias * (m / machNow);
      }
    } else if (isMach) {
      curMach = v.get(AP.selMach);
      curKt = machNow > 0.05 ? ias * (curMach / machNow) : v.get(AP.selSpeed);
    } else curKt = v.get(AP.selSpeed);
    v.set(B737_VARS.mcpSpdCursorKt, curKt);
    v.set(B737_VARS.mcpSpdCursorMach, curMach);
    // IAS/MACH window limit symbol: overspeed (flap placard / Vmo) '8', underspeed 'A' (EST threshold 0.85 x flap maneuver speed).
    const flaps = v.get(this.cfg.vars.flapsDeg);
    const gw = this.fmc?.perfWeightKg ?? 65000;
    const minKt = 0.85 * flapManeuverSpeed(Math.round(flaps), gw);
    let lim = 0;
    if (!blankSpd && !ground) {
      if (curKt > Math.min(B738_SPEEDS.vmoKt, flapPlacardKt(flaps))) lim = 1;
      else if (Number.isFinite(minKt) && curKt < minKt) lim = -1;
    }
    v.set(B737_VARS.mcpSpdLimit, lim);

    // ---------------------------------------------------------------- MCP lights
    const L = (n: string, on: boolean): void => v.set(B737_VARS.mcpLight(n), powered && on ? 1 : 0);
    const btn = (n: string): boolean => v.get(AFCS_VARS.button(n)) !== 0;
    L('n1', btn('n1'));
    L('speed', btn('spd'));
    L('lvlchg', btn('lvlchg'));
    L('vnav', btn('vnav') || this.vnavGroundArmed || this.vnavAlt || this.vnavCapture);
    L('hdgsel', btn('hdg'));
    L('lnav', btn('lnav') || this.lnavGroundArmed);
    L('vorloc', btn('vorloc'));
    // APP light until both VOR/LOC and G/S are captured.
    L('app', a ? a.approach && !(a.lat === 'LOC' && (a.vert === 'GS' || a.vert === 'FLARE')) : btn('apr'));
    L('althld', btn('alt') && !this.vnavAlt);
    L('vs', btn('vs'));
    L('cmd_a', btn('cmd_a'));
    L('cmd_b', btn('cmd_b'));
    L('cws_a', btn('cws_a'));
    L('cws_b', btn('cws_b'));
    L('at_arm', v.get('at.armed') !== 0);
    // F/D master: the first F/D switched on; with the A/P in CMD the engaged channel's side (EST).
    const fd = [v.get(AP.fdOn(1)) !== 0, v.get(AP.fdOn(2)) !== 0];
    if (fd[0] && !this.prevFd[0] && !fd[1]) this.master = 1;
    if (fd[1] && !this.prevFd[1] && !fd[0]) this.master = 2;
    if (!fd[0] && !fd[1]) this.master = 0;
    else if (!fd[this.master - 1]) this.master = fd[0] ? 1 : 2;
    this.prevFd = fd;
    let ma = this.master;
    if (a?.engaged) ma = a.cmdB && !a.cmdA ? 2 : 1;
    v.set(B737_VARS.mcpMaLight(1), powered && ma === 1 && (fd[0] || !!a?.engaged) ? 1 : 0);
    v.set(B737_VARS.mcpMaLight(2), powered && ma === 2 && (fd[1] || !!a?.engaged) ? 1 : 0);

    // ---------------------------------------------------------------- disengage lights (0 off, 1 red, 2 amber)
    const test = v.get(B737_VARS.discLightTest);
    let apL = v.get(AFCS_VARS.discWarn) !== 0 && flashOn ? 1 : 0;
    let atL = v.get('at.disc_warn') !== 0 ? (flashOn ? 1 : 0) : v.get('at.spd_warn') !== 0 && flashOn ? 2 : 0;
    if (test < 0) {
      apL = 2;
      atL = 2;
    } else if (test > 0) {
      apL = 1;
      atL = 1;
    }
    v.set(B737_VARS.apDiscLight, apL);
    v.set(B737_VARS.atDiscLight, atL);
    v.set(B737_VARS.stabOutOfTrim, a?.engaged && v.get(AFCS_VARS.mistrim) !== 0 ? 1 : 0);
  }
}

/** Flap placard speed (kt) for a flap deflection: the placard of the next detent at or above it [LIM]. */
export function flapPlacardKt(flapDeg: number): number {
  if (flapDeg < 0.5) return B738_SPEEDS.vmoKt;
  for (const f of B738_FLAPS) if (f.deg >= flapDeg - 0.5 && f.deg > 0) return f.placardKt;
  return B738_FLAPS[B738_FLAPS.length - 1].placardKt;
}
