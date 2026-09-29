/**
 * Applies generic keyboard/joystick commands to the loaded aircraft's own
 * cockpit vars through its `AircraftInputMap` (src/aircraft/types.ts):
 * throttle slew/idle/full/reverse, mixture, flap steps, gear, speedbrake,
 * parking brake and AP/A-T commands. Cockpit controls follow external
 * writes to their vars and animate, so a key press moves the 3D lever.
 *
 * Commands with no mapping are ignored here (the `input.*` events are still
 * on the bus for aircraft that handle them themselves).
 */
import type { SimVars } from '../core/SimVars';
import type { EventBus } from '../core/EventBus';
import type { AudioApi } from '../core/SimContext';
import { FDM } from '../core/vars';
import type { AircraftInputMap } from '../aircraft/types';
import { INPUT_EVENTS } from './actions';

/** Keyboard throttle slew: full travel in 2.5 s. EST, comfortable keyboard control. */
export const THROTTLE_SLEW_PER_S = 0.4;
/** Keyboard mixture slew: full travel in 5 s (vernier-like). */
export const MIXTURE_SLEW_PER_S = 0.2;

export class CommandRouter {
  private map: AircraftInputMap | null = null;
  private readonly offs: (() => void)[] = [];
  /** Hardware axis state supplied by InputManager each frame (NaN = not bound). */
  readonly hwThrottle: number[] = [NaN, NaN, NaN, NaN];
  readonly hwMixture: number[] = [NaN, NaN, NaN, NaN];
  /** -1/0/+1 slew commands from held keys/buttons. */
  throttleRate = 0;
  mixtureRate = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events: EventBus,
    private readonly audio: AudioApi | null = null,
  ) {
    const on = (name: string, fn: () => void) => this.offs.push(events.on(name, fn));
    on(INPUT_EVENTS.throttleIdle, () => this.throttleTo('idle'));
    on(INPUT_EVENTS.throttleFull, () => this.throttleTo('full'));
    on(INPUT_EVENTS.reverseToggle, () => this.toggleReverse());
    on(INPUT_EVENTS.mixtureRich, () => this.mixtureTo(1));
    on(INPUT_EVENTS.mixtureCutoff, () => this.mixtureTo(0));
    on(INPUT_EVENTS.flapsUp, () => this.flapStep(-1));
    on(INPUT_EVENTS.flapsDown, () => this.flapStep(1));
    on(INPUT_EVENTS.flapsFullUp, () => this.flapStep(-99));
    on(INPUT_EVENTS.flapsFullDown, () => this.flapStep(99));
    on(INPUT_EVENTS.gearToggle, () => this.gearToggle());
    on(INPUT_EVENTS.spoilersToggle, () => this.spoilers('toggle'));
    on(INPUT_EVENTS.spoilersArm, () => this.spoilers('arm'));
    on(INPUT_EVENTS.spoilersRetract, () => this.spoilers('retract'));
    on(INPUT_EVENTS.spoilersExtend, () => this.spoilers('extend'));
    on(INPUT_EVENTS.parkingBrakeToggle, () => this.parkingBrake());
    on(INPUT_EVENTS.apToggle, () => this.map?.apToggleEvent && this.events.emit(this.map.apToggleEvent));
    on(INPUT_EVENTS.atDisconnect, () => this.map?.atDisconnectEvent && this.events.emit(this.map.atDisconnectEvent));
  }

  setMap(map: AircraftInputMap | null | undefined): void {
    this.map = map ?? null;
  }

  get inputMap(): AircraftInputMap | null {
    return this.map;
  }

  /** Per frame (real dt): slews and hardware-axis following. */
  update(dt: number): void {
    const m = this.map;
    if (!m) return;
    const d = Math.min(0.1, Math.max(0, dt));
    if (m.throttles?.length) {
      const [idle, full] = m.throttleRange ?? [0, 1];
      const span = full - idle;
      for (let i = 0; i < m.throttles.length; i++) {
        const v = m.throttles[i];
        const hw = this.hwThrottle[i] ?? NaN;
        if (Number.isFinite(hw)) {
          // Hardware lever owns the forward range; keyboard reverse still works at idle detent.
          if (!this.inReverse(i)) this.vars.set(v, idle + hw * span);
          continue;
        }
        if (this.throttleRate === 0) continue;
        const cur = this.vars.get(v, idle);
        const rev = m.reverse;
        if (this.throttleRate < 0 && cur <= idle + 1e-6 && rev) {
          // Holding "decrease" at idle pulls into reverse (lever integral range or reverser lever).
          if ('value' in rev) this.vars.set(v, Math.max(rev.value, cur - THROTTLE_SLEW_PER_S * Math.abs(rev.value - idle) * d));
          else if (rev.vars[i]) this.vars.set(rev.vars[i], Math.min(rev.full, this.vars.get(rev.vars[i]) + THROTTLE_SLEW_PER_S * rev.full * d));
          continue;
        }
        if (this.throttleRate > 0 && rev) {
          // Coming out of reverse first: reverse -> idle before any forward thrust.
          if ('value' in rev && cur < idle - 1e-6) {
            this.vars.set(v, Math.min(idle, cur + THROTTLE_SLEW_PER_S * Math.abs(rev.value - idle) * d));
            continue;
          }
          if ('vars' in rev && rev.vars[i] && this.vars.get(rev.vars[i]) > 0) {
            this.vars.set(rev.vars[i], Math.max(0, this.vars.get(rev.vars[i]) - THROTTLE_SLEW_PER_S * rev.full * d));
            continue;
          }
        }
        const lo = Math.min(idle, full);
        const hi = Math.max(idle, full);
        this.vars.set(v, Math.min(hi, Math.max(lo, cur + this.throttleRate * THROTTLE_SLEW_PER_S * span * d)));
      }
    }
    if (m.mixtures?.length) {
      const [cut, rich] = m.mixtureRange ?? [0, 1];
      for (let i = 0; i < m.mixtures.length; i++) {
        const hw = this.hwMixture[i] ?? NaN;
        const v = m.mixtures[i];
        if (Number.isFinite(hw)) this.vars.set(v, cut + hw * (rich - cut));
        else if (this.mixtureRate !== 0) {
          const lo = Math.min(cut, rich);
          const hi = Math.max(cut, rich);
          this.vars.set(v, Math.min(hi, Math.max(lo, this.vars.get(v, rich) + this.mixtureRate * MIXTURE_SLEW_PER_S * (rich - cut) * d)));
        }
      }
    }
  }

  private inReverse(i: number): boolean {
    const m = this.map;
    const rev = m?.reverse;
    if (!m?.throttles || !rev) return false;
    const [idle] = m.throttleRange ?? [0, 1];
    if ('value' in rev) return this.vars.get(m.throttles[i], idle) < idle - 1e-6;
    return rev.vars[i] !== undefined && this.vars.get(rev.vars[i]) > 0;
  }

  private throttleTo(where: 'idle' | 'full'): void {
    const m = this.map;
    if (!m?.throttles) return;
    const [idle, full] = m.throttleRange ?? [0, 1];
    for (let i = 0; i < m.throttles.length; i++) {
      if (Number.isFinite(this.hwThrottle[i])) continue;
      this.vars.set(m.throttles[i], where === 'idle' ? idle : full);
    }
    const rev = m.reverse;
    if (rev && 'vars' in rev) for (const r of rev.vars) this.vars.set(r, 0);
  }

  private toggleReverse(): void {
    const m = this.map;
    const rev = m?.reverse;
    if (!m?.throttles || !rev) return;
    const [idle] = m.throttleRange ?? [0, 1];
    for (let i = 0; i < m.throttles.length; i++) {
      const cur = this.vars.get(m.throttles[i], idle);
      if ('value' in rev) {
        if (cur < idle - 1e-6) this.vars.set(m.throttles[i], idle);
        else if (cur <= idle + 0.02) this.vars.set(m.throttles[i], rev.value);
      } else if (rev.vars[i]) {
        const r = this.vars.get(rev.vars[i]);
        if (r > 0) this.vars.set(rev.vars[i], 0);
        else if (cur <= idle + 0.02) this.vars.set(rev.vars[i], rev.full);
      }
    }
  }

  private mixtureTo(frac: 0 | 1): void {
    const m = this.map;
    if (!m?.mixtures) return;
    const [cut, rich] = m.mixtureRange ?? [0, 1];
    for (const v of m.mixtures) this.vars.set(v, frac ? rich : cut);
  }

  private flapStep(dir: number): void {
    const f = this.map?.flaps;
    if (!f || f.detents.length === 0) return;
    const cur = this.vars.get(f.var, f.detents[0]);
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < f.detents.length; i++) {
      const d = Math.abs(f.detents[i] - cur);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    const next = Math.max(0, Math.min(f.detents.length - 1, idx + dir));
    if (next !== idx) this.vars.set(f.var, f.detents[next]);
  }

  private gearToggle(): void {
    const g = this.map?.gear;
    if (!g) return;
    const isDown = Math.abs(this.vars.get(g.var, g.down) - g.down) < 1e-6;
    if (isDown) {
      // Respect the ground lock (LandingGear handle-lock solenoid / squat switch), like the cockpit handle's interlock.
      if (this.vars.get('gear.handle_lock') !== 0 || this.vars.get(FDM.onGround) !== 0) {
        this.audio?.play('lever.gate', { volume: 0.6 });
        return;
      }
      this.vars.set(g.var, g.up);
    } else this.vars.set(g.var, g.down);
  }

  private spoilers(cmd: 'toggle' | 'arm' | 'retract' | 'extend'): void {
    const s = this.map?.speedbrake;
    if (!s || s.positions.length === 0) return;
    const stowed = s.positions[0];
    const cur = this.vars.get(s.var, stowed);
    if (cmd === 'arm') {
      if (s.armed !== undefined) this.vars.set(s.var, Math.abs(cur - s.armed) < 1e-6 ? stowed : s.armed);
      return;
    }
    if (cmd === 'toggle') {
      const extended = cur > stowed + 1e-6 && (s.armed === undefined || Math.abs(cur - s.armed) > 1e-6);
      this.vars.set(s.var, extended ? stowed : s.positions[s.positions.length - 1]);
      return;
    }
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < s.positions.length; i++) {
      const d = Math.abs(s.positions[i] - cur);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    const next = Math.max(0, Math.min(s.positions.length - 1, idx + (cmd === 'extend' ? 1 : -1)));
    this.vars.set(s.var, s.positions[next]);
  }

  private parkingBrake(): void {
    const p = this.map?.parkingBrake;
    if (!p) return;
    const set = Math.abs(this.vars.get(p.var, p.off) - p.on) < 1e-6;
    this.vars.set(p.var, set ? p.off : p.on);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
