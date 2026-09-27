/**
 * Cessna 172S tyre deflation failures, so the POH Section 3 "Abnormal landings" checklists
 * ("Landing with a flat main tire", "Landing with a flat nose tire") have a trigger. The failure
 * deflates the tyre over a few seconds and drives the ground-contact model's GEAR.tireFlat input
 * (the wheel runs lower on its rim with a large rolling drag: the airplane pulls toward the flat
 * main, or sits nose-low on a flat nosewheel).
 *
 * Gear indices (c172s-common fdm.ts): 0 nose, 1 left main, 2 right main.
 * SCOPE: no tyre-pressure indication exists in the 172 (the pilot notices the pull / attitude), no
 * blow-out noise, and the tyre stays flat until the failure is cleared (re-inflated on the ramp).
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { GEAR } from '../../../core/vars';

export const C172_TIRE_FAIL = {
  nose: 'c172.tire_nose',
  left: 'c172.tire_left',
  right: 'c172.tire_right',
} as const;

/** EST deflation time constant (s): a punctured tyre goes flat within a few seconds of load. */
const DEFLATE_TAU_S = 1.5;

export class C172Tires implements Subsystem {
  readonly name = 'c172-tires';
  private readonly failVars = [`fail.${C172_TIRE_FAIL.nose}`, `fail.${C172_TIRE_FAIL.left}`, `fail.${C172_TIRE_FAIL.right}`];
  private readonly outVars = [GEAR.tireFlat(0), GEAR.tireFlat(1), GEAR.tireFlat(2)];
  private readonly flat = [0, 0, 0];

  constructor(private readonly vars: SimContext['vars']) {
    this.reset();
  }

  failures(): FailureDef[] {
    const c = 'landing gear';
    return [
      { id: C172_TIRE_FAIL.nose, name: 'Flat nose tire', category: c, description: 'Nosewheel tyre deflated (POH Sec 3 "Landing with a flat nose tire").' },
      { id: C172_TIRE_FAIL.left, name: 'Flat left main tire', category: c, description: 'Left main tyre deflated: pulls left on the ground (POH Sec 3 "Landing with a flat main tire").' },
      { id: C172_TIRE_FAIL.right, name: 'Flat right main tire', category: c, description: 'Right main tyre deflated: pulls right on the ground (POH Sec 3 "Landing with a flat main tire").' },
    ];
  }

  reset(): void {
    for (let i = 0; i < 3; i++) {
      this.flat[i] = this.vars.get(this.failVars[i]) !== 0 ? 1 : 0;
      this.vars.set(this.outVars[i], this.flat[i]);
    }
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt / DEFLATE_TAU_S);
    for (let i = 0; i < 3; i++) {
      const failed = this.vars.get(this.failVars[i]) !== 0;
      // Deflates gradually; clearing the failure (ramp service) re-inflates at once.
      this.flat[i] = failed ? this.flat[i] + (1 - this.flat[i]) * k : 0;
      this.vars.set(this.outVars[i], this.flat[i]);
    }
  }
}
