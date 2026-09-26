/**
 * Small allocation-free animation helpers used by control `update(dt)`.
 */

/** Exponential approach of `current` toward `target` with time constant `tau` (s). Snaps when within `eps`. */
export function smoothTo(current: number, target: number, dt: number, tau: number, eps = 1e-5): number {
  if (tau <= 0 || dt <= 0) return dt <= 0 && tau > 0 ? current : target;
  const v = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(v - target) < eps ? target : v;
}

/** Moves `current` toward `target` by at most `rate * dt`. */
export function moveToward(current: number, target: number, rate: number, dt: number): number {
  const d = target - current;
  const m = rate * dt;
  if (Math.abs(d) <= m) return target;
  return current + Math.sign(d) * m;
}

/**
 * Snap-action motion for switch handles: fast exponential approach with a
 * minimum speed so the handle visibly "snaps" over centre (MS toggles throw
 * in a few tens of milliseconds).
 */
export function snapTo(current: number, target: number, dt: number, tau = 0.018, minRate = 2): number {
  const e = smoothTo(current, target, dt, tau);
  const lin = moveToward(current, target, minRate, dt);
  // Take whichever moved further toward the target.
  return Math.abs(target - e) < Math.abs(target - lin) ? e : lin;
}

/** Monotonic time in seconds (performance.now based; Date fallback). */
export function nowS(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now() / 1000;
  return Date.now() / 1000;
}
