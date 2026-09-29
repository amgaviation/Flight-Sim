/**
 * Cessna 172S G1000 NXi: procedure monitor. Latches the results of the POH checks that are an
 * action sequence rather than a switch position, so the checklist auto-checks (checklists.ts)
 * tick only when the check was actually performed (POH 172SPHBUS-02 Sec 4):
 *
 *  - Starting Engine 3a "STBY BATT Switch: TEST - (hold for 10 seconds, verify that green TEST
 *    lamp does not go off)": TEST held for 10 s with C172.stbyTestLamp lit throughout.
 *  - Before Takeoff 13-15: "Autopilot - ENGAGE", "Flight Controls - CHECK (verify autopilot can be
 *    overpowered in both pitch and roll axes)", "A/P TRIM DISC Button - PRESS (verify autopilot
 *    disengages and aural alert is heard)": the AP engaged on the ground, the yoke moved against it
 *    in pitch and in roll while engaged, then a disengagement by the A/P TRIM DISC button with the
 *    disconnect alert (ap.disc_warn).
 *  - Before Takeoff 18a "MAGNETOS Switch - CHECK (RPM drop should not exceed 175 RPM on either
 *    magneto or 50 RPM differential between magnetos)": the RPM drop on R and on L measured
 *    against BOTH at about 1800 RPM.
 *  - Before Takeoff 19 "Annunciators - CHECK (verify no annunciators are shown)": the number of
 *    annunciations on the PFD (CAS window entries, the AFCS status annunciation, and the PFD1 /
 *    MFD1 COOLING advisories).
 *
 * The Before Takeoff latches clear at liftoff (each flight's run-up is checked again); the STBY BATT
 * test latch clears once the STBY BATT switch has been OFF with the MASTER OFF for 5 s (airplane
 * secured). Nothing here allocates per update.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import type { CasModel } from '../../../avionics/common/draw/CasWindow';
import { ENG, FDM, INPUT } from '../../../core/vars';
import { G1K } from '../../../avionics/garmin-g1000/vars';
import { C172, MAG, STBY_BATT } from '../../c172s-common/vars';
import { C172G } from '../vars';

/** Procedure-monitor output vars (0/1 latches unless noted). */
export const C172G_PROC = {
  /** STBY BATT TEST held 10 s with the TEST lamp lit throughout. */
  stbyTestOk: 'ac.c172g.proc.stby_test_ok',
  /** Autopilot engaged on the ground (Before Takeoff 13). */
  apGroundEngaged: 'ac.c172g.proc.ap_gnd_engaged',
  /** Autopilot overpowered in pitch and in roll while engaged on the ground (Before Takeoff 14). */
  apOverpowered: 'ac.c172g.proc.ap_overpowered',
  /** Autopilot then disengaged by A/P TRIM DISC with the disconnect alert (Before Takeoff 15). */
  apDiscTest: 'ac.c172g.proc.ap_disc_test',
  /** Magneto check: measured drops (RPM, -1 = not yet measured) and the POH limits met. */
  magDropR: 'ac.c172g.proc.mag_drop_r',
  magDropL: 'ac.c172g.proc.mag_drop_l',
  magCheckOk: 'ac.c172g.proc.mag_check_ok',
  /** Annunciations shown on the PFD (count). */
  annunciations: 'ac.c172g.proc.annunciations',
} as const;

/** POH 172SPHBUS-02 Before Takeoff 18a limits. */
export const MAG_CHECK = { maxDropRpm: 175, maxDiffRpm: 50, refLoRpm: 1650, refHiRpm: 1950, settleS: 2 } as const;
/** POH Starting Engine 3a: TEST held 10 s. */
export const STBY_TEST_S = 10;
/** Yoke deflection that counts as overpowering the servos (EST: the pilot's deliberate push/pull and turn). */
const OVERPOWER_INPUT = 0.3;
/** Seconds after an A/P TRIM DISC press within which a disengagement is attributed to it. */
const DISC_WINDOW_S = 1;

export class C172G1000ProcedureMonitor implements Subsystem {
  readonly name = 'c172-g1000-procedures';
  private testHeldS = 0;
  private securedS = 0;
  private prevEngaged = false;
  private sinceDiscS = 1e9;
  private pitchOver = false;
  private rollOver = false;
  private groundEngaged = false;
  private discPending = -1;
  private prevOnGround = true;
  private magRef = 0;
  private magRefS = 0;
  private magPos = 0;
  private magPosS = 0;
  private magMin = 0;
  private dropR = -1;
  private dropL = -1;
  private readonly off: () => void;

  constructor(
    private readonly ctx: SimContext,
    private readonly cas: () => CasModel,
  ) {
    this.off = ctx.events.on('ap.disc', () => {
      this.sinceDiscS = 0;
    });
    this.reset();
  }

  failures(): FailureDef[] {
    return [];
  }

  reset(): void {
    const v = this.ctx.vars;
    this.testHeldS = 0;
    this.securedS = 0;
    this.prevEngaged = v.get('ap.engaged') > 0.5;
    this.sinceDiscS = 1e9;
    this.discPending = -1;
    this.prevOnGround = v.get(FDM.onGround) > 0.5;
    this.clearRunUp();
    this.magRefS = 0;
    this.magPos = Math.round(v.get(C172.magneto));
    this.magPosS = 0;
    if (!v.has(C172G_PROC.stbyTestOk)) v.set(C172G_PROC.stbyTestOk, 0);
    this.publish();
  }

  /** Clears the Before Takeoff latches (liftoff, or a preset). */
  clearRunUp(): void {
    this.pitchOver = this.rollOver = this.groundEngaged = false;
    this.dropR = this.dropL = -1;
    const v = this.ctx.vars;
    v.set(C172G_PROC.apDiscTest, 0);
  }

  /** Marks the Before Takeoff checks done (the takeoff preset: "Before takeoff" complete). */
  markRunUpDone(): void {
    this.pitchOver = this.rollOver = this.groundEngaged = true;
    this.dropR = 60;
    this.dropL = 70; // EST typical IO-360 drops inside the POH limits
    this.ctx.vars.set(C172G_PROC.apDiscTest, 1);
    this.publish();
  }

  dispose(): void {
    this.off();
  }

  update(dt: number): void {
    const v = this.ctx.vars;
    const onGround = v.get(FDM.onGround) > 0.5;
    if (this.prevOnGround && !onGround) this.clearRunUp();
    this.prevOnGround = onGround;

    // ---------------------------------------------------------------- STBY BATT TEST (Starting Engine 3a)
    const sb = Math.round(v.get(C172.stbyBatt));
    if (sb === STBY_BATT.test && v.get(C172.stbyTestLamp) > 0.5) {
      this.testHeldS += dt;
      if (this.testHeldS >= STBY_TEST_S) v.set(C172G_PROC.stbyTestOk, 1);
    } else this.testHeldS = 0;
    const secured = sb === STBY_BATT.off && v.get(C172.masterBat) < 0.5;
    this.securedS = secured ? this.securedS + dt : 0;
    if (this.securedS > 5 && sb !== STBY_BATT.test) v.set(C172G_PROC.stbyTestOk, 0);

    // ---------------------------------------------------------------- autopilot preflight (Before Takeoff 13-15)
    this.sinceDiscS += dt;
    const engaged = v.get('ap.engaged') > 0.5;
    if (onGround && engaged) {
      this.groundEngaged = true;
      if (Math.abs(v.get(INPUT.pitch)) > OVERPOWER_INPUT) this.pitchOver = true;
      if (Math.abs(v.get(INPUT.roll)) > OVERPOWER_INPUT) this.rollOver = true;
    }
    if (this.prevEngaged && !engaged && onGround && this.groundEngaged) {
      // Disengaged: by A/P TRIM DISC (event within the window, or the button still held)?
      this.discPending = this.sinceDiscS <= DISC_WINDOW_S || v.get(C172G.apDisc) > 0.5 ? 0 : -1;
    }
    this.prevEngaged = engaged;
    if (this.discPending >= 0) {
      this.discPending += dt;
      // The aural alert / flashing AP annunciation of a manual disconnect (CRG §6.4).
      if (v.get('ap.disc_warn') > 0.5) {
        v.set(C172G_PROC.apDiscTest, 1);
        this.discPending = -1;
      } else if (this.discPending > DISC_WINDOW_S) this.discPending = -1;
    }

    // ---------------------------------------------------------------- magneto check (Before Takeoff 18a)
    const mag = Math.round(v.get(C172.magneto));
    const rpm = v.get(ENG.rpm(1));
    if (mag !== this.magPos) {
      this.magPos = mag;
      this.magPosS = 0;
      this.magMin = rpm;
    } else this.magPosS += dt;
    if (onGround && v.get(ENG.running(1)) > 0.5) {
      if (mag === MAG.both) {
        // Reference: BOTH, steady within the run-up band for the settle time.
        if (rpm >= MAG_CHECK.refLoRpm && rpm <= MAG_CHECK.refHiRpm) {
          this.magRefS += dt;
          if (this.magRefS >= MAG_CHECK.settleS) this.magRef = rpm;
        } else this.magRefS = 0;
      } else if ((mag === MAG.right || mag === MAG.left) && this.magRef > 0) {
        if (rpm < this.magMin) this.magMin = rpm;
        if (this.magPosS >= MAG_CHECK.settleS) {
          const drop = Math.max(0, this.magRef - this.magMin);
          if (mag === MAG.right) this.dropR = drop;
          else this.dropL = drop;
        }
      }
    }

    this.publish();
  }

  private publish(): void {
    const v = this.ctx.vars;
    v.set(C172G_PROC.apGroundEngaged, this.groundEngaged ? 1 : 0);
    v.set(C172G_PROC.apOverpowered, this.pitchOver && this.rollOver ? 1 : 0);
    v.set(C172G_PROC.magDropR, this.dropR);
    v.set(C172G_PROC.magDropL, this.dropL);
    const ok =
      this.dropR >= 0 &&
      this.dropL >= 0 &&
      this.dropR <= MAG_CHECK.maxDropRpm &&
      this.dropL <= MAG_CHECK.maxDropRpm &&
      Math.abs(this.dropR - this.dropL) <= MAG_CHECK.maxDiffRpm;
    v.set(C172G_PROC.magCheckOk, ok ? 1 : 0);
    // PFD annunciations: CAS window entries, the AFCS status annunciation (PTRM, AFCS, PFT ...), and the
    // PFD1 / MFD1 COOLING advisories.
    let n = this.cas().list.length;
    if (v.getString(G1K.afcsStatus) !== '') n++;
    if (v.get(C172G.pfdCooling) > 0.5) n++;
    if (v.get(C172G.mfdCooling) > 0.5) n++;
    v.set(C172G_PROC.annunciations, n);
  }
}
