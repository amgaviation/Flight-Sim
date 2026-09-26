/**
 * InputManager: keyboard, game controllers (Gamepad API), mouse yoke and the
 * cockpit's drag controls merged into the standard `input.*` SimVars.
 *
 * Call `poll(realDt)` once per animation frame (SimLoop `input` callback).
 *
 * Priority per primary axis (pitch, roll, yaw):
 *   1. the 3D yoke / rudder pedals while dragged (`cockpit.yoke_active`, ...),
 *   2. mouse-yoke mode,
 *   3. a keyboard key for that axis while held,
 *   4. a bound hardware axis,
 *   5. the keyboard value springing back to centre.
 * Brakes are the max of keyboard/button, hardware toe brakes and the 3D
 * pedal toes. Hardware throttle/mixture axes write `input.throttle<i>` /
 * `input.mixture<i>` and set `input.throttle_axis_bound` (cockpit levers
 * with an axis binding then follow the hardware).
 *
 * Writes: input.pitch, input.roll, input.yaw, input.tiller,
 * input.brake_left/right, input.pitch_trim_rate, input.ap_disc, input.toga,
 * input.throttle1..4, input.throttle_axis_bound, input.mixture1..2,
 * input.mixture_axis_bound, input.throttle_rate, input.mixture_rate,
 * input.mouse_yoke. Emits the `event` of every press action (actions.ts).
 */
import type { SimVars } from '../core/SimVars';
import type { EventBus } from '../core/EventBus';
import type { AudioApi } from '../core/SimContext';
import { INPUT } from '../core/vars';
import { COCKPIT_VARS } from '../cockpit/types';
import type { KeyValueStore } from '../platform/storage';
import { ACTIONS, actionDef, chordMatches, DEFAULT_KEY_BINDINGS, INPUT_EVENTS, type ActionId, type KeyBinding, type KeyChord } from './actions';
import { processBipolar, processUnipolar, rampKeyAxis } from './axisMath';
import { decodeHat, defaultProfile, isUnipolar, sanitizeProfile, type AxisTarget, type DeviceProfile, type GamepadInfo } from './devices';
import { CommandRouter } from './CommandRouter';
import { MouseYoke } from './MouseYoke';

/** Keyboard control ramp rates (per second). EST: about 0.5 s to full deflection, 0.3 s spring back. */
export const KEY_AXIS_RATE = 2.0;
export const KEY_AXIS_RETURN_RATE = 3.2;
/** Keyboard rudder ramps faster (pedals are pushed quickly). */
export const KEY_YAW_RATE = 2.8;

/** Standard input vars appended by the app (documented in docs/modules/app.md). */
export const APP_INPUT_VARS = {
  mixtureBound: 'input.mixture_axis_bound',
  throttleRate: 'input.throttle_rate',
  mixtureRate: 'input.mixture_rate',
  mouseYoke: 'input.mouse_yoke',
} as const;

/** Live device information for the controls UI. */
export interface DeviceStatus {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: number[];
  profile: DeviceProfile;
}

/** Actions still accepted while a menu has keyboard focus (`enabled = false`). */
const ALWAYS_ALLOWED = new Set<ActionId>(['ui.menu', 'ui.fullscreen', 'ui.debug']);

export interface InputManagerOptions {
  vars: SimVars;
  events: EventBus;
  /** Element the 3D view is drawn in (mouse yoke reference). */
  viewElement: HTMLElement;
  /** Persistent store for key bindings and device profiles (namespace e.g. 'input'). */
  storage: KeyValueStore;
  audio?: AudioApi | null;
  /** Key event source (default `window`). */
  keyTarget?: Window | HTMLElement | null;
  /** Gamepad source (default `navigator.getGamepads`). */
  getGamepads?: () => readonly (Gamepad | null)[];
}

interface HwState {
  pitch: number;
  roll: number;
  yaw: number;
  tiller: number;
  brakeL: number;
  brakeR: number;
  trim: number;
  lookX: number;
  lookY: number;
  throttleAll: number;
  mixtureAll: number;
  throttle: number[];
  mixture: number[];
}

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class InputManager {
  readonly router: CommandRouter;
  readonly mouseYoke: MouseYoke;
  /** false while a UI panel owns the keyboard (flight keys ignored). */
  enabled = true;

  private readonly vars: SimVars;
  private readonly events: EventBus;
  private readonly storage: KeyValueStore;
  private readonly keyTarget: Window | HTMLElement | null;
  private readonly getPads: () => readonly (Gamepad | null)[];
  private bindings: KeyBinding[];
  private readonly held = new Map<ActionId, number>();
  private readonly keyActions = new Map<string, ActionId[]>();
  private readonly profiles = new Map<string, DeviceProfile>();
  private readonly buttonState = new Map<string, boolean[]>();
  private readonly buttonActions = new Map<string, (ActionId | null)[]>();
  private capture: ((c: KeyChord) => void) | null = null;
  private kbPitch = 0;
  private kbRoll = 0;
  private kbYaw = 0;
  private readonly hw: HwState = {
    pitch: NaN,
    roll: NaN,
    yaw: NaN,
    tiller: NaN,
    brakeL: 0,
    brakeR: 0,
    trim: 0,
    lookX: 0,
    lookY: 0,
    throttleAll: NaN,
    mixtureAll: NaN,
    throttle: [NaN, NaN, NaN, NaN],
    mixture: [NaN, NaN],
  };
  /** View pan rates (-1..1) and zoom rate from keys, hat or axes; read by the camera system. */
  lookX = 0;
  lookY = 0;
  zoomRate = 0;
  private readonly offs: (() => void)[] = [];
  private lastPads: readonly (Gamepad | null)[] = [];

  constructor(o: InputManagerOptions) {
    this.vars = o.vars;
    this.events = o.events;
    this.storage = o.storage;
    this.keyTarget = o.keyTarget === undefined ? (typeof window !== 'undefined' ? window : null) : o.keyTarget;
    this.getPads =
      o.getGamepads ??
      (() => {
        try {
          return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
        } catch {
          return [];
        }
      });
    this.router = new CommandRouter(o.vars, o.events, o.audio ?? null);
    this.mouseYoke = new MouseYoke(o.viewElement);
    this.bindings = this.loadBindings();
    if (this.keyTarget) {
      const t = this.keyTarget as Window;
      t.addEventListener('keydown', this.onKeyDown);
      t.addEventListener('keyup', this.onKeyUp);
      if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
    }
    this.offs.push(this.events.on(INPUT_EVENTS.mouseYokeToggle, () => this.setMouseYoke(!this.mouseYoke.active)));
    this.offs.push(this.events.on(INPUT_EVENTS.centerControls, () => {
      this.kbRoll = 0;
      this.kbYaw = 0;
    }));
    for (const v of [INPUT.pitch, INPUT.roll, INPUT.yaw, INPUT.tiller, INPUT.brakeLeft, INPUT.brakeRight, INPUT.pitchTrimRate, INPUT.apDisconnect, INPUT.toga, INPUT.throttleBound]) {
      if (!this.vars.has(v)) this.vars.set(v, 0);
    }
  }

  // ------------------------------------------------------------------ keyboard

  get keyBindings(): readonly KeyBinding[] {
    return this.bindings;
  }

  setKeyBindings(list: KeyBinding[]): void {
    this.bindings = list.slice();
    this.storage.set('keys', this.bindings);
    this.releaseAll();
  }

  resetKeyBindings(): void {
    this.bindings = DEFAULT_KEY_BINDINGS.slice();
    this.storage.remove('keys');
    this.releaseAll();
  }

  /** The next key chord is delivered to `cb` instead of triggering actions (rebinding UI). Escape cancels (cb not called). */
  captureNextKey(cb: ((c: KeyChord) => void) | null): void {
    this.capture = cb;
  }

  private loadBindings(): KeyBinding[] {
    const saved = this.storage.get<KeyBinding[] | null>('keys', null);
    if (Array.isArray(saved) && saved.every((b) => b && typeof b.code === 'string' && actionDef(b.action))) return saved;
    return DEFAULT_KEY_BINDINGS.slice();
  }

  /** Actions bound to a chord (exact modifier match). */
  resolveKey(code: string, ctrl: boolean, shift: boolean, alt: boolean): ActionId[] {
    const out: ActionId[] = [];
    for (const b of this.bindings) if (chordMatches(b, code, ctrl, shift, alt)) out.push(b.action);
    return out;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.capture) {
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      const cb = this.capture;
      this.capture = null;
      if (e.code !== 'Escape') cb({ code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
      return;
    }
    if (e.defaultPrevented || editable(e.target)) return;
    const actions = this.resolveKey(e.code, e.ctrlKey || e.metaKey, e.shiftKey, e.altKey);
    if (actions.length === 0) return;
    const allowed = this.enabled ? actions : actions.filter((a) => ALWAYS_ALLOWED.has(a));
    if (allowed.length === 0) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keyActions.set(e.code, allowed);
    for (const a of allowed) this.press(a);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const actions = this.keyActions.get(e.code);
    if (!actions) return;
    this.keyActions.delete(e.code);
    for (const a of actions) this.release(a);
  };

  private readonly onBlur = (): void => this.releaseAll();

  /** Starts an action (key or button down). Press actions emit their event. */
  press(a: ActionId): void {
    const def = actionDef(a);
    if (!def) return;
    if (def.kind === 'press') {
      if (def.event) this.events.emit(def.event);
      return;
    }
    this.held.set(a, (this.held.get(a) ?? 0) + 1);
    if (def.event) this.events.emit(def.event);
  }

  release(a: ActionId): void {
    const n = this.held.get(a);
    if (n === undefined) return;
    if (n <= 1) this.held.delete(a);
    else this.held.set(a, n - 1);
  }

  releaseAll(): void {
    this.held.clear();
    this.keyActions.clear();
    for (const s of this.buttonState.values()) s.fill(false);
  }

  isHeld(a: ActionId): boolean {
    return (this.held.get(a) ?? 0) > 0;
  }

  private dir(neg: ActionId, pos: ActionId): -1 | 0 | 1 {
    const n = this.isHeld(neg);
    const p = this.isHeld(pos);
    return n === p ? 0 : p ? 1 : -1;
  }

  // ------------------------------------------------------------------ mouse yoke

  setMouseYoke(on: boolean): void {
    this.mouseYoke.setActive(on);
    this.vars.set(APP_INPUT_VARS.mouseYoke, on ? 1 : 0);
  }

  // ------------------------------------------------------------------ devices

  profileFor(g: GamepadInfo): DeviceProfile {
    let p = this.profiles.get(g.id);
    if (!p) {
      p = sanitizeProfile(this.storage.child('devices').get<unknown>(storageKey(g.id), null), g);
      this.profiles.set(g.id, p);
    }
    return p;
  }

  saveProfile(p: DeviceProfile): void {
    this.profiles.set(p.id, p);
    this.buttonActions.delete(p.id);
    this.storage.child('devices').set(storageKey(p.id), p);
  }

  resetProfile(g: GamepadInfo): DeviceProfile {
    const p = defaultProfile(g);
    this.storage.child('devices').remove(storageKey(g.id));
    this.profiles.set(g.id, p);
    this.buttonActions.delete(g.id);
    return p;
  }

  /** Connected controllers with raw values (for the controls UI live preview). */
  devices(): DeviceStatus[] {
    const out: DeviceStatus[] = [];
    const pads = this.lastPads.length ? this.lastPads : this.getPads();
    for (const g of pads) {
      if (!g) continue;
      out.push({
        index: g.index,
        id: g.id,
        mapping: g.mapping,
        connected: g.connected,
        axes: g.axes,
        buttons: g.buttons.map((b) => b.value || (b.pressed ? 1 : 0)),
        profile: this.profileFor(g),
      });
    }
    return out;
  }

  private pollDevices(): void {
    const hw = this.hw;
    hw.pitch = hw.roll = hw.yaw = hw.tiller = NaN;
    hw.throttleAll = hw.mixtureAll = NaN;
    hw.throttle.fill(NaN);
    hw.mixture.fill(NaN);
    hw.brakeL = hw.brakeR = hw.trim = hw.lookX = hw.lookY = 0;
    const pads = this.getPads();
    this.lastPads = pads;
    for (const g of pads) {
      if (!g || !g.connected) continue;
      const p = this.profileFor(g);
      for (const k in p.axes) {
        const i = Number(k);
        if (i < g.axes.length) this.applyAxis(p.axes[i].target, g.axes[i], p.axes[i]);
      }
      for (const k in p.buttonAxes) {
        const i = Number(k);
        const b = g.buttons[i];
        if (b) this.applyAxis(p.buttonAxes[i].target, b.value * 2 - 1, p.buttonAxes[i]);
      }
      // Buttons -> actions (edge detected).
      let state = this.buttonState.get(g.id);
      if (!state || state.length !== g.buttons.length) {
        state = new Array<boolean>(g.buttons.length).fill(false);
        this.buttonState.set(g.id, state);
      }
      let acts = this.buttonActions.get(g.id);
      if (!acts || acts.length !== g.buttons.length) {
        acts = g.buttons.map((_, i) => (p.buttonAxes[i] ? null : (p.buttons[i] ?? null)));
        this.buttonActions.set(g.id, acts);
      }
      for (let i = 0; i < g.buttons.length; i++) {
        const a = acts[i];
        if (!a) continue;
        const b = g.buttons[i];
        const down = b.pressed || b.value > 0.5;
        if (down === state[i]) continue;
        state[i] = down;
        if (down) {
          if (this.enabled || ALWAYS_ALLOWED.has(a)) this.press(a);
        } else this.release(a);
      }
    }
  }

  private applyAxis(target: AxisTarget, raw: number, b: DeviceProfile['axes'][number]): void {
    if (target === 'none') return;
    const hw = this.hw;
    if (target === 'hat_look') {
      const h = decodeHat(raw);
      if (h) {
        hw.lookX = h.x;
        hw.lookY = h.y;
      }
      return;
    }
    const v = isUnipolar(target) ? processUnipolar(raw, b.cal, b.shape) : processBipolar(raw, b.cal, b.shape);
    switch (target) {
      case 'pitch':
        hw.pitch = v;
        break;
      case 'roll':
        hw.roll = v;
        break;
      case 'yaw':
        hw.yaw = v;
        break;
      case 'tiller':
        hw.tiller = v;
        break;
      case 'brakes':
        hw.brakeL = Math.max(hw.brakeL, v);
        hw.brakeR = Math.max(hw.brakeR, v);
        break;
      case 'brake_left':
        hw.brakeL = Math.max(hw.brakeL, v);
        break;
      case 'brake_right':
        hw.brakeR = Math.max(hw.brakeR, v);
        break;
      case 'pitch_trim':
        hw.trim = Math.abs(v) > 0.5 ? Math.sign(v) : 0;
        break;
      case 'look_x':
        hw.lookX = v;
        break;
      case 'look_y':
        hw.lookY = -v;
        break;
      case 'throttle':
        hw.throttleAll = v;
        break;
      case 'mixture':
        hw.mixtureAll = v;
        break;
      default:
        if (target.startsWith('throttle')) hw.throttle[Number(target.slice(8)) - 1] = v;
        else if (target.startsWith('mixture')) hw.mixture[Number(target.slice(7)) - 1] = v;
    }
  }

  // ------------------------------------------------------------------ frame

  /** Once per animation frame: devices, keyboard ramps, merge, write input vars. */
  poll(dt: number): void {
    const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const v = this.vars;
    this.pollDevices();
    const hw = this.hw;

    const pDir = this.dir('pitch.down', 'pitch.up');
    const rDir = this.dir('roll.left', 'roll.right');
    const yDir = this.dir('yaw.left', 'yaw.right');
    this.kbPitch = rampKeyAxis(this.kbPitch, pDir, d, KEY_AXIS_RATE, KEY_AXIS_RETURN_RATE);
    this.kbRoll = rampKeyAxis(this.kbRoll, rDir, d, KEY_AXIS_RATE, KEY_AXIS_RETURN_RATE);
    this.kbYaw = rampKeyAxis(this.kbYaw, yDir, d, KEY_YAW_RATE, KEY_AXIS_RETURN_RATE);

    const yoke3d = v.get(COCKPIT_VARS.yokeActive) !== 0;
    const pedals3d = v.get(COCKPIT_VARS.pedalsActive) !== 0;
    const my = this.mouseYoke.active;
    const pick = (keyDir: number, kb: number, hwv: number): number => (keyDir !== 0 ? kb : Number.isFinite(hwv) ? hwv : kb);
    const pitch = yoke3d ? v.get(COCKPIT_VARS.yokePitch) : my ? this.mouseYoke.pitch : pick(pDir, this.kbPitch, hw.pitch);
    const roll = yoke3d ? v.get(COCKPIT_VARS.yokeRoll) : my ? this.mouseYoke.roll : pick(rDir, this.kbRoll, hw.roll);
    const yaw = pedals3d ? v.get(COCKPIT_VARS.pedalsYaw) : pick(yDir, this.kbYaw, hw.yaw);
    v.set(INPUT.pitch, clamp1(pitch));
    v.set(INPUT.roll, clamp1(roll));
    v.set(INPUT.yaw, clamp1(yaw));
    v.set(INPUT.tiller, Number.isFinite(hw.tiller) ? hw.tiller : 0);

    const kbBoth = this.isHeld('brakes') ? 1 : 0;
    const bl = Math.max(kbBoth, this.isHeld('brake.left') ? 1 : 0, hw.brakeL, v.get(COCKPIT_VARS.toeBrakeLeft));
    const br = Math.max(kbBoth, this.isHeld('brake.right') ? 1 : 0, hw.brakeR, v.get(COCKPIT_VARS.toeBrakeRight));
    v.set(INPUT.brakeLeft, Math.min(1, bl));
    v.set(INPUT.brakeRight, Math.min(1, br));

    const trim = this.dir('trim.nose_down', 'trim.nose_up');
    v.set(INPUT.pitchTrimRate, trim !== 0 ? trim : hw.trim);
    v.set(INPUT.apDisconnect, this.isHeld('ap.disconnect') ? 1 : 0);
    v.set(INPUT.toga, this.isHeld('toga') ? 1 : 0);

    // Hardware levers.
    let tBound = false;
    for (let i = 0; i < 4; i++) {
      const t = Number.isFinite(hw.throttle[i]) ? hw.throttle[i] : hw.throttleAll;
      this.router.hwThrottle[i] = t;
      if (Number.isFinite(t)) {
        v.set(INPUT.throttle(i + 1), t);
        tBound = true;
      }
    }
    v.set(INPUT.throttleBound, tBound ? 1 : 0);
    let mBound = false;
    for (let i = 0; i < 2; i++) {
      const m = Number.isFinite(hw.mixture[i]) ? hw.mixture[i] : hw.mixtureAll;
      this.router.hwMixture[i] = m;
      if (Number.isFinite(m)) {
        v.set(INPUT.mixture(i + 1), m);
        mBound = true;
      }
    }
    v.set(APP_INPUT_VARS.mixtureBound, mBound ? 1 : 0);

    const tr = this.dir('throttle.dec', 'throttle.inc');
    const mr = this.dir('mixture.dec', 'mixture.inc');
    this.router.throttleRate = tr;
    this.router.mixtureRate = mr;
    v.set(APP_INPUT_VARS.throttleRate, tr);
    v.set(APP_INPUT_VARS.mixtureRate, mr);
    this.router.update(d);

    // View control rates.
    const lx = this.dir('view.look_left', 'view.look_right');
    const ly = this.dir('view.look_down', 'view.look_up');
    this.lookX = lx !== 0 ? lx : hw.lookX;
    this.lookY = ly !== 0 ? ly : hw.lookY;
    this.zoomRate = this.dir('view.zoom_out', 'view.zoom_in');
  }

  /** Every action with its current key chords (help overlay / settings). */
  actionTable(): { id: ActionId; label: string; group: string; keys: KeyChord[] }[] {
    return ACTIONS.map((a) => ({ id: a.id, label: a.label, group: a.group, keys: this.bindings.filter((b) => b.action === a.id) }));
  }

  dispose(): void {
    if (this.keyTarget) {
      const t = this.keyTarget as Window;
      t.removeEventListener('keydown', this.onKeyDown);
      t.removeEventListener('keyup', this.onKeyUp);
      if (typeof window !== 'undefined') window.removeEventListener('blur', this.onBlur);
    }
    for (const o of this.offs) o();
    this.offs.length = 0;
    this.router.dispose();
    this.mouseYoke.dispose();
  }
}

function clamp1(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : Number.isFinite(x) ? x : 0;
}

function storageKey(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 120);
}
