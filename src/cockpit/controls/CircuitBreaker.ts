/**
 * Push/pull thermal circuit breaker (Klixon 7274/7277 type).
 *
 * The button sits in a threaded collar; when pulled or tripped it stands
 * out ~4 mm and shows the white band on its stem. Klixon 7274: mounts in a
 * 7/16 in panel hole (Aircraft Spruce 7274 catalogue page); button diameter
 * and pop-out travel are EST from photographs.
 *
 * Mouse: left or right click toggles (pull when in, push/reset when out).
 * Push-to-reset-only breakers (`pullable: false`) cannot be pulled.
 *
 * Vars: `var` = 1 when the breaker is in (circuit closed), 0 when out.
 * Systems trip a breaker by writing `var` = 0 and `trippedVar` = 1; pushing
 * it back in writes var = 1 and trippedVar = 0 (the system re-trips it if
 * the fault persists).
 *
 * Draw calls: the collar is static (consolidated), the cap and its rating
 * text are moving parts drawn as instances of all breakers of the cockpit
 * (instancing.ts), and the white band - hidden inside the collar while the
 * breaker is in - is only drawn while the breaker is out (one call per
 * breaker that is out).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import { ControlBase, type ControlOptions } from './ControlBase';
import { CircuitBreakerLogic } from './logic/MiscLogic';
import { cylinderZ, hexPrism, revolve } from '../geometry/primitives';
import { smoothTo } from '../anim';
import { ControlInstances, markMovingPart } from '../instancing';

export interface CircuitBreakerOptions extends ControlOptions {
  var: string;
  trippedVar?: string;
  /** Rating in amps, printed on the cap. */
  rating?: number | string;
  /** Engraved name below the breaker (panel text); true = label. */
  name?: string | boolean;
  pullable?: boolean;
  /** Button diameter (m). Default 0.0095. */
  diameter?: number;
  /** Collar style: round knurled nut or hex nut. */
  collar?: 'round' | 'hex';
  /**
   * (Appended by g800, additive.) Painted ring around the collar at panel level: 'red' collar rings as on
   * the Gulfstream overhead CB panels (G600 BL7C0705 crop p_cb), 'yellow' for an INOP lockout collar.
   */
  ring?: 'red' | 'yellow';
}

const POP = 0.0042; // EST pop-out travel

export class CircuitBreaker extends ControlBase {
  readonly logic: CircuitBreakerLogic;
  private readonly o: CircuitBreakerOptions;
  private readonly button = new THREE.Group();
  private readonly band: THREE.Mesh;
  private out = 0;
  private appliedOut = -1;
  private hoverOn = false;

  constructor(env: CockpitEnv, o: CircuitBreakerOptions) {
    super(env, o);
    this.o = o;
    this.logic = new CircuitBreakerLogic({ pullable: o.pullable });
    this.initVar(o.var, 1);
    if (o.trippedVar) this.initVar(o.trippedVar, 0);
    this.logic.sync(env.vars.get(o.var), o.trippedVar ? env.vars.get(o.trippedVar) : 0);
    this.out = this.logic.closed ? 0 : 1;
    const d = o.diameter ?? 0.0095;
    const r = d / 2;
    // Collar (static).
    const collarG =
      o.collar === 'hex'
        ? this.geo(`cb.hex.${d}`, () => hexPrism(d * 1.45, 0, 0.0026, 0.2))
        : this.geo(`cb.collar.${d}`, () =>
            revolve(
              [
                [r * 1.05, 0.0028],
                [r * 1.05, 0.0028],
                [r * 1.42, 0.0026],
                [r * 1.5, 0.0012],
                [r * 1.5, 0],
              ],
              36,
              { count: 36, depth: 0.03, zMin: 0.0004, zMax: 0.0022, kind: 'ridge' },
            ),
          );
    this.mesh(collarG, 'steel', this.object, true);
    if (o.ring) {
      // Painted collar ring at panel level (additive option; static, consolidated).
      const ring = this.mesh(this.geo(`cb.ring.${d}`, () => new THREE.RingGeometry(r * 1.55, r * 2.05, 28)), o.ring === 'red' ? 'paintRed' : 'paintYellow', this.object, true);
      ring.position.z = 0.0002;
    }
    this.object.add(this.button);
    // White band on the stem (hidden inside the collar when in).
    const band = this.mesh(this.geo(`cb.band.${d}`, () => cylinderZ(r * 0.8, r * 0.8, -POP, 0.0028, 20)), 'paintWhite', this.button);
    band.name = 'cbWhiteBand';
    this.band = band;
    // Cap.
    const cap = this.mesh(
      this.geo(`cb.cap.${d}`, () =>
        revolve(
          [
            [0, 0.0024],
            [r * 0.98, 0.0024],
            [r, 0.0034],
            [r, 0.0068],
            [r * 0.92, 0.0074],
            [r * 0.92, 0.0074],
            [0, 0.0076],
          ],
          28,
        ),
      ),
      'plasticBlack',
      this.button,
    );
    markMovingPart(cap, this.button);
    if (o.rating !== undefined) {
      const l = this.engrave(String(o.rating), 0, 0, { height: r * 0.62, zone: null, color: '#e8e8e2', weight: 700 }, this.button, true);
      l.position.z = 0.0077;
      markMovingPart(l, this.button);
    }
    if (o.name) this.engrave(typeof o.name === 'string' ? o.name : this.label, 0, -(r * 1.5 + 0.0035), { height: 0.0021 });
    this.addHitBox(d * 1.6, d * 1.6, 0.014, 0, 0, 0.006);
    this.applyVisual();
  }

  protected stateText(): string {
    const rating = this.o.rating !== undefined ? ` ${this.o.rating}A` : '';
    const st = this.logic.state === 'in' ? 'IN' : this.logic.state === 'tripped' ? 'TRIPPED' : 'PULLED';
    return `${st}${rating}`;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    this.toggle();
  }

  /** Pulls the breaker when in, pushes (resets) it when out. */
  toggle(): void {
    const r = this.logic.toggle();
    if (r === 'none') return;
    this.env.vars.set(this.o.var, this.logic.closed ? 1 : 0);
    if (this.o.trippedVar) this.env.vars.set(this.o.trippedVar, 0);
    this.baseOpts.onChange?.(this.logic.closed ? 1 : 0);
    this.playSound(r === 'pulled' ? COCKPIT_SOUNDS.cbPull : COCKPIT_SOUNDS.cbPush);
  }

  onWheel(delta: number, _p?: ControlPointer): void {
    // Wheel up pushes in, down pulls out.
    if (!this.enabled || delta === 0) return;
    if ((delta > 0) === this.logic.closed) return;
    this.toggle();
  }

  onHover(h: boolean): void {
    this.hoverOn = h;
  }

  override update(dt: number): void {
    const ev = this.logic.sync(this.env.vars.get(this.o.var), this.o.trippedVar ? this.env.vars.get(this.o.trippedVar) : 0);
    if (ev === 'tripped') this.playSound(COCKPIT_SOUNDS.cbTrip);
    this.out = smoothTo(this.out, this.logic.closed ? 0 : 1, dt, this.logic.tripped ? 0.008 : 0.02, 1e-4);
    const inst = ControlInstances.of(this.object);
    inst?.sync(this.hoverOn);
    if (this.applyVisual()) inst?.moved(this.button);
  }

  /** Places the button; returns true when it moved. */
  private applyVisual(): boolean {
    // The white band sits inside the collar while the breaker is in: not drawn then.
    this.band.visible = this.out > 1e-3;
    if (this.out === this.appliedOut) return false;
    this.appliedOut = this.out;
    this.button.position.z = this.out * POP;
    return true;
  }
}
