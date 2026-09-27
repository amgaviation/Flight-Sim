/**
 * Inner lining surface of the M2 cockpit (shared by the overhead and sidewall
 * builders): the cockpit shell (shell.ts) lofts its linings from the exterior
 * fuselage profile inset by 45 mm, so fittings mounted on the walls and the
 * headliner use the same profile to sit on the lining.
 */
import { M2_FUSELAGE } from '../../exterior';

/** Lining inset from the outer skin (m); same value as shell.ts INSET. */
export const LINING_INSET = 0.045;

/** Half-width (m) of the lining at station x and height z (body). */
export function wallY(x: number, z: number): number {
  return M2_FUSELAGE.halfWidth(x, z, LINING_INSET);
}

/**
 * Body z of the headliner (upper lining) above lateral offset y at station x: the upper-half solution of
 * halfWidth(x, z) = |y| (bisection, setup code only).
 */
export function headlinerZ(x: number, y: number): number {
  const s = M2_FUSELAGE.at(x);
  let hi = s.cz; // widest (|y| inside)
  let lo = s.cz - (s.rz - LINING_INSET) + 1e-4; // top (width 0)
  const ay = Math.abs(y);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (wallY(x, m) > ay) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
