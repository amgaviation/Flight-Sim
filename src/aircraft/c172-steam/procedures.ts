/**
 * Cessna 172S steam (NAV II): procedure monitor. Latches the results of checklist items that are
 * an action sequence rather than a switch position, so the checklist auto-checks (c172s-common
 * checklistsSteam.ts, c172-steam checklists.ts) tick only when the check was actually performed:
 *
 *  - Preflight Cabin 14 "Annunciator Panel Switch - PLACE AND HOLD IN TST POSITION and ensure all
 *    annunciators illuminate" (POH 172SPHUS Sec 4): TST held with all six lamps (OIL PRESS, L LOW
 *    FUEL R, L VAC R, VOLTS) each seen lit during a hold of at least 1 s (they flash while TST is held).
 *  - Preflight Cabin 11 "Avionics Cooling Fan - CHECK AUDIBLY FOR OPERATION": the fan was heard
 *    (SteamCabinExtras fan gain > 0).
 *  - Before Takeoff 10a "Magnetos - CHECK (RPM drop should not exceed 150 RPM on either magneto or
 *    50 RPM differential between magnetos)": the drop on R and on L measured against BOTH at about
 *    1800 RPM.
 *  - Supplement 15 Sec 4 A.3 KAP 140 preflight manual electric trim test: LH half alone (no
 *    movement), RH half alone (no movement, red PT), both halves DN / UP (the trim moves), both held
 *    with A/P DISC/TRIM INT pressed (the trim stops); and A.6 "FLIGHT CONTROLS - MOVE ... to verify
 *    that the autopilot can be overpowered".
 *  - Fire extinguisher discharge (`ext_discharging`) for the shared fire model (c172s-common
 *    systems/fire.ts): the squeeze lever held while the bottle still has pressure.
 *
 * The run-up latches (magnetos) clear at liftoff; the trim / KAP test latches clear when the
 * airplane has been secured (MASTER OFF, engine stopped for 5 s). Nothing here allocates.
 */
import type { Subsystem } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { FailureDef } from '../../systems/failures';
import { ENG, FDM, INPUT } from '../../core/vars';
import { ANN, C172, MAG } from '../c172s-common/vars';
import { KAP, ST } from './vars';

/** Procedure-monitor output vars (0/1 latches unless noted). */
export const STEAM_PROC = {
  annTestOk: 'ac.c172s.proc.ann_test_ok',
  avnFanHeard: 'ac.c172s.proc.avn_fan_heard',
  /** Magneto drops (RPM, -1 = not measured) and the POH limits met. */
  magDropR: 'ac.c172s.proc.mag_drop_r',
  magDropL: 'ac.c172s.proc.mag_drop_l',
  magCheckOk: 'ac.c172s.proc.mag_check_ok',
  /** KAP 140 preflight A.3 a/b, c/d, e, f, interrupt; A.6 overpower. */
  metLhOk: 'ac.c172s.proc.met_lh_ok',
  metRhOk: 'ac.c172s.proc.met_rh_ok',
  metDnOk: 'ac.c172s.proc.met_dn_ok',
  metUpOk: 'ac.c172s.proc.met_up_ok',
  metIntOk: 'ac.c172s.proc.met_int_ok',
  apOverpowered: 'ac.c172s.proc.ap_overpowered',
  /** Portable extinguisher discharging into the cabin (fire model input). */
  extDischarging: 'ac.c172s.ext_discharging',
} as const;

/** POH 172SPHUS Sec 4 Before Takeoff 10a limits; reference band around the 1800 RPM run-up. */
export const STEAM_MAG_CHECK = { maxDropRpm: 150, maxDiffRpm: 50, refLoRpm: 1650, refHiRpm: 1950, settleS: 2 } as const;
/** Supplement 15 A.3: "hold in both positions for 5 seconds"; a half alone moves nothing. */
const MET_HOLD_S = 5;
/** Trim travel (units) that counts as "trim wheel moves". */
const TRIM_MOVED = 0.02;
/** Yoke deflection that counts as overpowering the servo (EST: a deliberate push / pull / turn). */
const OVERPOWER_INPUT = 0.3;
const LAMPS = ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'] as const;
const LAMP_VARS: readonly string[] = LAMPS.map((l) => ANN.lamp(l));

export class SteamProcedureMonitor implements Subsystem {
  readonly name = 'c172s-procedures';
  private annS = 0;
  private annSeen = 0;
  private securedS = 0;
  private prevOnGround = true;
  private magRef = 0;
  private magRefS = 0;
  private magPos = 0;
  private magPosS = 0;
  private magMin = 0;
  private dropR = -1;
  private dropL = -1;
  private lhS = 0;
  private lhTrim0 = 0;
  private rhS = 0;
  private rhTrim0 = 0;
  private bothDir = 0;
  private bothTrim0 = 0;
  private intS = 0;
  private intTrim0 = 0;

  constructor(private readonly vars: SimContext['vars']) {
    this.reset();
  }

  failures(): FailureDef[] {
    return [];
  }

  reset(): void {
    const v = this.vars;
    this.prevOnGround = v.get(FDM.onGround, 1) > 0.5;
    this.magPos = Math.round(v.get(C172.magneto));
    this.magPosS = this.magRefS = this.annS = this.securedS = 0;
    this.lhS = this.rhS = this.intS = 0;
    this.bothDir = 0;
    this.dropR = this.dropL = -1;
    for (const k of [STEAM_PROC.annTestOk, STEAM_PROC.avnFanHeard, STEAM_PROC.metLhOk, STEAM_PROC.metRhOk, STEAM_PROC.metDnOk, STEAM_PROC.metUpOk, STEAM_PROC.metIntOk, STEAM_PROC.apOverpowered]) {
      if (!v.has(k)) v.set(k, 0);
    }
    v.set(STEAM_PROC.extDischarging, 0);
    this.publishMag();
  }

  /** Initial states: the preflight items and the KAP 140 preflight test are complete (states.ts). */
  markPreflightDone(): void {
    const v = this.vars;
    for (const k of [STEAM_PROC.annTestOk, STEAM_PROC.avnFanHeard, STEAM_PROC.metLhOk, STEAM_PROC.metRhOk, STEAM_PROC.metDnOk, STEAM_PROC.metUpOk, STEAM_PROC.metIntOk, STEAM_PROC.apOverpowered]) v.set(k, 1);
  }

  /** Clears every latch (cold & dark). */
  clearAll(): void {
    const v = this.vars;
    for (const k of [STEAM_PROC.annTestOk, STEAM_PROC.avnFanHeard, STEAM_PROC.metLhOk, STEAM_PROC.metRhOk, STEAM_PROC.metDnOk, STEAM_PROC.metUpOk, STEAM_PROC.metIntOk, STEAM_PROC.apOverpowered]) v.set(k, 0);
    this.dropR = this.dropL = -1;
    this.publishMag();
  }

  /** The takeoff preset: "Before takeoff" complete, magnetos checked (EST typical IO-360 drops within the POH limits). */
  markRunUpDone(): void {
    this.dropR = 60;
    this.dropL = 75;
    this.publishMag();
  }

  update(dt: number): void {
    const v = this.vars;
    const onGround = v.get(FDM.onGround, 1) > 0.5;
    if (this.prevOnGround && !onGround) {
      this.dropR = this.dropL = -1;
    }
    this.prevOnGround = onGround;
    const running = v.get(ENG.running(1)) > 0.5;

    // Secured airplane: preflight latches clear (the next flight's preflight is checked again).
    const secured = !running && v.get(C172.masterBat) < 0.5;
    this.securedS = secured ? this.securedS + dt : 0;
    if (this.securedS > 5 && this.securedS - dt <= 5) {
      for (const k of [STEAM_PROC.annTestOk, STEAM_PROC.avnFanHeard, STEAM_PROC.metLhOk, STEAM_PROC.metRhOk, STEAM_PROC.metDnOk, STEAM_PROC.metUpOk, STEAM_PROC.metIntOk, STEAM_PROC.apOverpowered]) v.set(k, 0);
    }

    // ---------------------------------------------------------------- annunciator TST (Preflight 14)
    // The lamps flash while TST is held (POH 4-8 NOTE), so each lamp only has to have lit during the hold.
    if (v.get(ST.annTest) > 0.5) {
      this.annS += dt;
      for (let i = 0; i < LAMP_VARS.length; i++) if (v.get(LAMP_VARS[i]) > 0.5) this.annSeen |= 1 << i;
      if (this.annS >= 1 && this.annSeen === (1 << LAMP_VARS.length) - 1) v.set(STEAM_PROC.annTestOk, 1);
    } else {
      this.annS = 0;
      this.annSeen = 0;
    }
    // Avionics cooling fan heard (Preflight 11).
    if (v.get(ST.avnFanGain) > 0) v.set(STEAM_PROC.avnFanHeard, 1);

    // ---------------------------------------------------------------- KAP 140 manual electric trim test
    const lh = Math.round(v.get(ST.metLeft));
    const rh = Math.round(v.get(ST.metRight));
    const trim = v.get(C172.trimPosition);
    const disc = v.get(ST.apDisc) > 0.5;
    // a/b: LH half alone, held 5 s: no movement.
    if (lh !== 0 && rh === 0) {
      if (this.lhS === 0) this.lhTrim0 = trim;
      this.lhS += dt;
      if (this.lhS >= MET_HOLD_S && Math.abs(trim - this.lhTrim0) < 0.005) v.set(STEAM_PROC.metLhOk, 1);
    } else this.lhS = 0;
    // c/d: RH half alone, held 5 s: no movement and the red PT on the autopilot display.
    if (rh !== 0 && lh === 0) {
      if (this.rhS === 0) this.rhTrim0 = trim;
      this.rhS += dt;
      if (this.rhS >= MET_HOLD_S && Math.abs(trim - this.rhTrim0) < 0.005 && v.get(KAP.pt) > 0.5) v.set(STEAM_PROC.metRhOk, 1);
    } else this.rhS = 0;
    // e/f: both halves together move the trim (forward = nose DN, aft = nose UP); held with A/P DISC
    // pressed the trim stops.
    const both = lh !== 0 && lh === rh ? lh : 0;
    if (both !== 0 && !disc) {
      if (this.bothDir !== both) {
        this.bothDir = both;
        this.bothTrim0 = trim;
      }
      const moved = trim - this.bothTrim0;
      if (moved <= -TRIM_MOVED) v.set(STEAM_PROC.metDnOk, 1);
      if (moved >= TRIM_MOVED) v.set(STEAM_PROC.metUpOk, 1);
    } else this.bothDir = 0;
    if (both !== 0 && disc) {
      if (this.intS === 0) this.intTrim0 = trim;
      this.intS += dt;
      if (this.intS >= 1 && Math.abs(trim - this.intTrim0) < 0.002 && (v.get(STEAM_PROC.metDnOk) > 0.5 || v.get(STEAM_PROC.metUpOk) > 0.5)) v.set(STEAM_PROC.metIntOk, 1);
    } else this.intS = 0;
    // A.6: autopilot overpowered on the ground.
    if (onGround && v.get('ap.engaged') > 0.5 && (Math.abs(v.get(INPUT.pitch)) > OVERPOWER_INPUT || Math.abs(v.get(INPUT.roll)) > OVERPOWER_INPUT)) v.set(STEAM_PROC.apOverpowered, 1);

    // ---------------------------------------------------------------- magneto check (Before Takeoff 10a)
    const mag = Math.round(v.get(C172.magneto));
    const rpm = v.get(ENG.rpm(1));
    if (mag !== this.magPos) {
      this.magPos = mag;
      this.magPosS = 0;
      this.magMin = rpm;
    } else this.magPosS += dt;
    if (onGround && running) {
      if (mag === MAG.both) {
        if (rpm >= STEAM_MAG_CHECK.refLoRpm && rpm <= STEAM_MAG_CHECK.refHiRpm) {
          this.magRefS += dt;
          if (this.magRefS >= STEAM_MAG_CHECK.settleS) this.magRef = rpm;
        } else this.magRefS = 0;
      } else if ((mag === MAG.right || mag === MAG.left) && this.magRef > 0) {
        if (rpm < this.magMin) this.magMin = rpm;
        if (this.magPosS >= STEAM_MAG_CHECK.settleS) {
          const drop = Math.max(0, this.magRef - this.magMin);
          if (mag === MAG.right) this.dropR = drop;
          else this.dropL = drop;
        }
      }
    }
    this.publishMag();

    // ---------------------------------------------------------------- extinguisher discharge
    v.set(STEAM_PROC.extDischarging, v.get(C172.extinguisher) > 0.5 && v.get('ac.c172s.extinguisher_psi', 150) > 0 ? 1 : 0);
  }

  private publishMag(): void {
    const v = this.vars;
    v.set(STEAM_PROC.magDropR, this.dropR);
    v.set(STEAM_PROC.magDropL, this.dropL);
    const M = STEAM_MAG_CHECK;
    const ok = this.dropR >= 0 && this.dropL >= 0 && this.dropR <= M.maxDropRpm && this.dropL <= M.maxDropRpm && Math.abs(this.dropR - this.dropL) <= M.maxDiffRpm;
    v.set(STEAM_PROC.magCheckOk, ok ? 1 : 0);
  }
}
