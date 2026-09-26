/**
 * Game controller profiles: which physical axis/button drives what, plus
 * per-axis calibration and shaping. Profiles are keyed by the Gamepad API
 * `id` string (e.g. "Logitech Extreme 3D (Vendor: 046d Product: c215)") and
 * persisted, so a device keeps its setup across sessions and USB ports.
 */
import type { ActionId } from './actions';
import { DEFAULT_CALIBRATION, DEFAULT_SHAPE, type AxisCalibration, type AxisShape } from './axisMath';

export type AxisTarget =
  | 'none'
  | 'pitch'
  | 'roll'
  | 'yaw'
  | 'tiller'
  | 'throttle' // all levers
  | 'throttle1'
  | 'throttle2'
  | 'throttle3'
  | 'throttle4'
  | 'mixture' // all levers
  | 'mixture1'
  | 'mixture2'
  | 'brakes' // both toe brakes
  | 'brake_left'
  | 'brake_right'
  | 'pitch_trim' // trim rate from a spring-centred axis / rocker
  | 'look_x'
  | 'look_y'
  | 'hat_look'; // POV hat reported as one axis (Chromium DirectInput convention)

export const AXIS_TARGETS: { id: AxisTarget; label: string; unipolar: boolean }[] = [
  { id: 'none', label: 'Not used', unipolar: false },
  { id: 'pitch', label: 'Elevator (pitch)', unipolar: false },
  { id: 'roll', label: 'Ailerons (roll)', unipolar: false },
  { id: 'yaw', label: 'Rudder (yaw)', unipolar: false },
  { id: 'tiller', label: 'Nosewheel tiller', unipolar: false },
  { id: 'throttle', label: 'Throttle (all engines)', unipolar: true },
  { id: 'throttle1', label: 'Throttle 1', unipolar: true },
  { id: 'throttle2', label: 'Throttle 2', unipolar: true },
  { id: 'throttle3', label: 'Throttle 3', unipolar: true },
  { id: 'throttle4', label: 'Throttle 4', unipolar: true },
  { id: 'mixture', label: 'Mixture (all)', unipolar: true },
  { id: 'mixture1', label: 'Mixture 1', unipolar: true },
  { id: 'mixture2', label: 'Mixture 2', unipolar: true },
  { id: 'brakes', label: 'Brakes (both)', unipolar: true },
  { id: 'brake_left', label: 'Left toe brake', unipolar: true },
  { id: 'brake_right', label: 'Right toe brake', unipolar: true },
  { id: 'pitch_trim', label: 'Pitch trim (rate)', unipolar: false },
  { id: 'look_x', label: 'View pan (left/right)', unipolar: false },
  { id: 'look_y', label: 'View pan (up/down)', unipolar: false },
  { id: 'hat_look', label: 'POV hat (look around)', unipolar: false },
];

export function isUnipolar(t: AxisTarget): boolean {
  return AXIS_TARGETS.find((a) => a.id === t)?.unipolar ?? false;
}

export interface AxisBinding {
  target: AxisTarget;
  cal: AxisCalibration;
  shape: AxisShape;
}

export interface DeviceProfile {
  /** Gamepad API id string. */
  id: string;
  /** Axis index -> binding. */
  axes: Record<number, AxisBinding>;
  /** Button index -> action (analog buttons such as triggers may also drive axes via `buttonAxes`). */
  buttons: Record<number, ActionId>;
  /** Analog button (e.g. gamepad triggers) index -> unipolar axis binding. */
  buttonAxes: Record<number, AxisBinding>;
  /** Profile schema version. */
  version: 1;
}

/** Minimal Gamepad description used to pick defaults (a real Gamepad satisfies it). */
export interface GamepadInfo {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly unknown[];
}

function axis(target: AxisTarget, shape: Partial<AxisShape> = {}): AxisBinding {
  return { target, cal: { ...DEFAULT_CALIBRATION }, shape: { ...DEFAULT_SHAPE, ...shape } };
}

/** Device class heuristics from the id string. */
export function classifyDevice(g: GamepadInfo): 'gamepad' | 'pedals' | 'throttle' | 'yoke' | 'joystick' {
  const id = g.id.toLowerCase();
  if (g.mapping === 'standard' || /xbox|xinput|dualsense|dualshock|wireless controller|gamepad/.test(id)) return 'gamepad';
  if (/rudder|pedal/.test(id)) return 'pedals';
  if (/throttle|quadrant|tq\b|tq6|tca q/.test(id)) return 'throttle';
  if (/yoke/.test(id)) return 'yoke';
  return 'joystick';
}

/**
 * Sensible starting profile for a newly seen device (the user refines it in
 * Controls settings). Heuristics per device class; EST, device conventions vary.
 */
export function defaultProfile(g: GamepadInfo): DeviceProfile {
  const p: DeviceProfile = { id: g.id, axes: {}, buttons: {}, buttonAxes: {}, version: 1 };
  const n = g.axes.length;
  switch (classifyDevice(g)) {
    case 'gamepad':
      // W3C standard mapping: axes 0/1 left stick, 2/3 right stick; buttons 6/7 analog triggers, 12-15 d-pad.
      p.axes[0] = axis('roll', { deadzone: 0.08, curve: 0.35 });
      p.axes[1] = axis('pitch', { deadzone: 0.08, curve: 0.35 });
      if (n > 2) p.axes[2] = axis('yaw', { deadzone: 0.1, curve: 0.3 });
      Object.assign(p.buttons, {
        0: 'brakes',
        1: 'spoilers.toggle',
        2: 'flaps.down',
        3: 'flaps.up',
        4: 'trim.nose_down',
        5: 'trim.nose_up',
        6: 'throttle.dec',
        7: 'throttle.inc',
        8: 'view.external',
        9: 'ui.menu',
        10: 'view.reset',
        11: 'ap.disconnect',
        12: 'view.look_up',
        13: 'view.look_down',
        14: 'view.look_left',
        15: 'view.look_right',
      } satisfies Record<number, ActionId>);
      break;
    case 'pedals':
      // Logitech/Saitek/Thrustmaster pedals: X = left toe brake, Y = right toe brake, Rz (axis 2 or 5) = rudder.
      if (n > 0) p.axes[0] = axis('brake_left', { deadzone: 0.02 });
      if (n > 1) p.axes[1] = axis('brake_right', { deadzone: 0.02 });
      p.axes[n > 5 ? 5 : Math.min(2, n - 1)] = axis('yaw', { deadzone: 0.02 });
      break;
    case 'throttle':
      for (let i = 0; i < Math.min(n, 4); i++) p.axes[i] = axis(`throttle${i + 1}` as AxisTarget, { invert: true, deadzone: 0.02 });
      break;
    case 'yoke':
      p.axes[0] = axis('roll', { deadzone: 0.02 });
      p.axes[1] = axis('pitch', { deadzone: 0.02 });
      if (n > 2) p.axes[2] = axis('throttle', { invert: true, deadzone: 0.02 });
      if (n > 9) p.axes[9] = axis('hat_look');
      Object.assign(p.buttons, { 0: 'ap.disconnect', 1: 'trim.nose_down', 2: 'trim.nose_up' } satisfies Record<number, ActionId>);
      break;
    case 'joystick':
      p.axes[0] = axis('roll', { deadzone: 0.03, curve: 0.2 });
      p.axes[1] = axis('pitch', { deadzone: 0.03, curve: 0.2 });
      if (n > 2) p.axes[2] = axis(n > 5 ? 'yaw' : 'throttle', n > 5 ? { deadzone: 0.05, curve: 0.2 } : { invert: true, deadzone: 0.02 });
      if (n > 5) p.axes[6] = axis('throttle', { invert: true, deadzone: 0.02 });
      else if (n > 3) p.axes[3] = axis('yaw', { deadzone: 0.05, curve: 0.2 });
      if (n > 9) p.axes[9] = axis('hat_look');
      Object.assign(p.buttons, { 0: 'brakes', 1: 'ap.disconnect', 2: 'view.cockpit', 3: 'view.external', 4: 'flaps.up', 5: 'flaps.down', 6: 'gear.toggle' } satisfies Record<number, ActionId>);
      break;
  }
  return p;
}

/**
 * Decodes a POV hat reported as a single axis (Chromium on Windows/Linux:
 * value = -1 + dir * 2/7 for dir 0..7 clockwise from up; > 1 when centred).
 * Returns the look direction or null when centred.
 */
export function decodeHat(v: number): { x: number; y: number } | null {
  if (!Number.isFinite(v) || Math.abs(v) > 1.05) return null;
  const dir = Math.round(((v + 1) * 7) / 2);
  if (dir < 0 || dir > 7) return null;
  const a = (dir * Math.PI) / 4;
  const x = Math.round(Math.sin(a) * 100) / 100;
  const y = Math.round(Math.cos(a) * 100) / 100;
  return { x, y };
}

/** Validates and fills a profile loaded from storage (older/corrupt data never crashes the input module). */
export function sanitizeProfile(p: unknown, g: GamepadInfo): DeviceProfile {
  const base = defaultProfile(g);
  if (!p || typeof p !== 'object') return base;
  const q = p as Partial<DeviceProfile>;
  if (q.version !== 1) return base;
  const fixAxis = (b: unknown): AxisBinding | null => {
    if (!b || typeof b !== 'object') return null;
    const a = b as Partial<AxisBinding>;
    if (typeof a.target !== 'string' || !AXIS_TARGETS.some((t) => t.id === a.target)) return null;
    const cal = { ...DEFAULT_CALIBRATION, ...(a.cal ?? {}) };
    const shape = { ...DEFAULT_SHAPE, ...(a.shape ?? {}) };
    if (![cal.min, cal.center, cal.max, shape.deadzone, shape.curve, shape.sensitivity].every(Number.isFinite)) return null;
    return { target: a.target as AxisTarget, cal, shape };
  };
  const out: DeviceProfile = { id: g.id, axes: {}, buttons: {}, buttonAxes: {}, version: 1 };
  for (const [k, v] of Object.entries(q.axes ?? {})) {
    const a = fixAxis(v);
    if (a) out.axes[Number(k)] = a;
  }
  for (const [k, v] of Object.entries(q.buttonAxes ?? {})) {
    const a = fixAxis(v);
    if (a) out.buttonAxes[Number(k)] = a;
  }
  for (const [k, v] of Object.entries(q.buttons ?? {})) if (typeof v === 'string') out.buttons[Number(k)] = v as ActionId;
  return out;
}
