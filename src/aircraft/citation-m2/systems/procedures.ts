/**
 * Citation M2 procedure monitor: latches the outcome of checklist items that are an action sequence rather than a
 * switch position (system tests run, CVR / mask tests, after-start electrical check, trim check, autopilot disconnect
 * test) and whether every circuit breaker is in, so the checklists can auto-check them from vars (checklists.ts).
 * Sources: M2 flows (cockpit preparation SYS TEST ALL ITEMS / CVR TEST, ELECTRICAL CHECK, TRIM CHECKS, before taxi
 * AUTOPILOT DISCONNECT TEST, 18K MASKS CHECKED) and 525AFM-06 p.3-89.1 (electric trim check).
 * Allocation-free per update (the breaker list is gathered on reset / first update only).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import { ENG } from '../../../core/vars';
import { M2, TEST_SEL } from '../vars';
import { M2_SIDE_VARS } from '../cockpit/side/services';

/** A GTC system test counts once it has run this long with its indications powered (s). EST: one lamp / aural cycle. */
export const SYS_TEST_MIN_S = 1;

export class M2ProcedureMonitor implements Subsystem {
  readonly name = 'm2.procedures';
  private breakers: string[] = [];
  private scanned = false;
  private testS = 0;
  private testSel = 0;
  private apWasOnGround = false;

  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}

  update(dt: number): void {
    const v = this.ctx.vars;
    if (!this.scanned) this.scan();

    // ---- SYSTEM TESTS (GTC): latched per test once it ran for SYS_TEST_MIN_S with the EMER bus powered.
    const sel = v.get(M2.testSel);
    if (sel !== this.testSel) {
      this.testSel = sel;
      this.testS = 0;
    }
    if (sel !== TEST_SEL.off && v.get('elec.emer_powered') !== 0) {
      this.testS += dt;
      if (this.testS >= SYS_TEST_MIN_S) v.set(M2.sysTestsDone, v.get(M2.sysTestsDone) | (1 << sel));
    }

    // ---- CVR TEST light seen.
    if (v.get('ac.m2.cvr_test_lt') !== 0) v.set(M2.cvrTested, 1);

    // ---- Crew masks: PRESS TO TEST with oxygen flowing (flow indicator).
    for (const n of [1, 2]) {
      if (v.get(M2_SIDE_VARS.maskTest(n)) !== 0 && v.get(`oxy.crew${n}_flowing`) !== 0) v.set(M2.maskTested, v.get(M2.maskTested) | n);
    }

    // ---- Circuit breakers.
    let allIn = 1;
    for (let i = 0; i < this.breakers.length; i++) {
      if (v.get(this.breakers[i], 1) === 0) {
        allIn = 0;
        break;
      }
    }
    v.set(M2.cbAllIn, allIn);

    // ---- After-start electrical check: each generator switched OFF while the other carries the load.
    if (v.get(ENG.running(1)) !== 0 && v.get(ENG.running(2)) !== 0) {
      if (v.get(M2.genSw(1)) === 0 && v.get('elec.sg2_online') !== 0) v.set(M2.elecCheck, v.get(M2.elecCheck) | 1);
      if (v.get(M2.genSw(2)) === 0 && v.get('elec.sg1_online') !== 0) v.set(M2.elecCheck, v.get(M2.elecCheck) | 2);
    }

    // ---- Trim check: a split-switch half alone commands no trim; AP/TRIM DISC interrupts a valid command.
    for (const sd of [1, 2]) {
      const dir = v.get(M2.yokeTrim(sd));
      const arm = v.get(M2.yokeTrimArm(sd));
      if ((dir !== 0) !== (arm !== 0) && v.get(M2.yokeTrimCmd) === 0) v.set(M2.trimCheck, v.get(M2.trimCheck) | 1);
    }
    if (v.get(M2.yokeTrimCmd) !== 0 && (v.get(M2.apTrimDisc(1)) !== 0 || v.get(M2.apTrimDisc(2)) !== 0)) v.set(M2.trimCheck, v.get(M2.trimCheck) | 2);

    // ---- Autopilot disconnect test on the ground: AP engaged, then AP/TRIM DISC -> disengaged.
    const onGround = v.get('gear.air_ground') !== 0;
    const ap = v.get('ap.engaged') !== 0;
    if (onGround && ap) this.apWasOnGround = true;
    if (!onGround) this.apWasOnGround = false;
    if (this.apWasOnGround && !ap && (v.get(M2.apTrimDisc(1)) !== 0 || v.get(M2.apTrimDisc(2)) !== 0)) v.set(M2.apDiscTested, 1);
  }

  /** Clears every latch (applyState) and re-reads the breaker list. */
  reset(): void {
    const v = this.ctx.vars;
    for (const k of [M2.sysTestsDone, M2.cvrTested, M2.maskTested, M2.elecCheck, M2.trimCheck, M2.apDiscTested]) v.set(k, 0);
    this.testS = 0;
    this.testSel = v.get(M2.testSel);
    this.apWasOnGround = false;
    this.scanned = false;
  }

  private scan(): void {
    this.breakers = [];
    for (const k of this.ctx.vars.keys()) if (k.startsWith('cb.') && !k.endsWith('_tripped')) this.breakers.push(k);
    this.scanned = this.breakers.length > 0;
  }
}
