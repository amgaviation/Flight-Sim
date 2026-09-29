/**
 * Input actions and the default keyboard layout.
 *
 * An *action* is anything a key or a joystick button can trigger. `hold`
 * actions are active while the key/button is down (control deflection, trim,
 * throttle slew, brakes, momentary AP-disconnect / TO-GA); `press` actions
 * fire once on the down edge (gear, flaps step, views, pause ...).
 *
 * Press actions reach the rest of the app as EventBus events (`event`), so
 * any module can react; `CommandRouter` additionally applies the aircraft's
 * `inputMap` (src/aircraft/types.ts). Keys are `KeyboardEvent.code` values
 * (physical keys, independent of the keyboard layout).
 */

export type ActionKind = 'hold' | 'press';

export interface ActionDef {
  id: ActionId;
  label: string;
  group: 'Flight controls' | 'Engines' | 'Configuration' | 'Autoflight' | 'Views' | 'Simulation';
  kind: ActionKind;
  /** EventBus event emitted on press (press actions) or on the down edge (hold actions, when set). */
  event?: string;
}

/**
 * Events emitted by the input module. Aircraft may subscribe to any of them;
 * those covered by an `AircraftInputMap` are also applied automatically.
 */
export const INPUT_EVENTS = {
  gearToggle: 'input.gear_toggle',
  flapsUp: 'input.flaps_up', // retract one detent
  flapsDown: 'input.flaps_down', // extend one detent
  flapsFullUp: 'input.flaps_full_up',
  flapsFullDown: 'input.flaps_full_down',
  spoilersToggle: 'input.spoilers_toggle', // stowed <-> fully extended
  spoilersArm: 'input.spoilers_arm',
  spoilersRetract: 'input.spoilers_retract', // one position toward stowed
  spoilersExtend: 'input.spoilers_extend', // one position toward extended
  parkingBrakeToggle: 'input.parking_brake_toggle',
  throttleIdle: 'input.throttle_idle',
  throttleFull: 'input.throttle_full',
  reverseToggle: 'input.reverse_toggle',
  mixtureRich: 'input.mixture_rich',
  mixtureCutoff: 'input.mixture_cutoff',
  apToggle: 'input.ap_toggle',
  atDisconnect: 'input.at_disconnect',
  centerControls: 'input.center_controls',
  mouseYokeToggle: 'input.mouse_yoke_toggle',
} as const;

/** App-level events (camera, simulation, UI). `sim.*` are handled by SimLoop. */
export const APP_EVENTS = {
  viewCockpit: 'view.cockpit', // pilot eye; again = next cockpit preset view
  viewNext: 'view.next',
  viewPrev: 'view.prev',
  viewExternal: 'view.external', // cycle external cameras
  viewReset: 'view.reset',
  pauseToggle: 'sim.pause_toggle',
  rateInc: 'sim.rate_inc',
  rateDec: 'sim.rate_dec',
  menu: 'ui.menu',
  help: 'ui.help',
  checklist: 'ui.checklist',
  debug: 'ui.debug',
  fullscreen: 'ui.fullscreen',
} as const;

export type ActionId =
  | 'pitch.down'
  | 'pitch.up'
  | 'roll.left'
  | 'roll.right'
  | 'yaw.left'
  | 'yaw.right'
  | 'controls.center'
  | 'trim.nose_down'
  | 'trim.nose_up'
  | 'brakes'
  | 'brake.left'
  | 'brake.right'
  | 'parkbrake.toggle'
  | 'throttle.inc'
  | 'throttle.dec'
  | 'throttle.idle'
  | 'throttle.full'
  | 'reverse.toggle'
  | 'mixture.inc'
  | 'mixture.dec'
  | 'mixture.rich'
  | 'mixture.cutoff'
  | 'flaps.up'
  | 'flaps.down'
  | 'flaps.full_up'
  | 'flaps.full_down'
  | 'gear.toggle'
  | 'spoilers.toggle'
  | 'spoilers.arm'
  | 'ap.toggle'
  | 'ap.disconnect'
  | 'at.disconnect'
  | 'toga'
  | 'view.cockpit'
  | 'view.next'
  | 'view.prev'
  | 'view.external'
  | 'view.reset'
  | 'view.look_left'
  | 'view.look_right'
  | 'view.look_up'
  | 'view.look_down'
  | 'view.zoom_in'
  | 'view.zoom_out'
  | 'sim.pause'
  | 'sim.rate_inc'
  | 'sim.rate_dec'
  | 'ui.menu'
  | 'ui.help'
  | 'ui.checklist'
  | 'ui.debug'
  | 'ui.fullscreen'
  | 'input.mouse_yoke';

export const ACTIONS: readonly ActionDef[] = [
  { id: 'pitch.down', label: 'Elevator: nose down', group: 'Flight controls', kind: 'hold' },
  { id: 'pitch.up', label: 'Elevator: nose up', group: 'Flight controls', kind: 'hold' },
  { id: 'roll.left', label: 'Ailerons: roll left', group: 'Flight controls', kind: 'hold' },
  { id: 'roll.right', label: 'Ailerons: roll right', group: 'Flight controls', kind: 'hold' },
  { id: 'yaw.left', label: 'Rudder: left', group: 'Flight controls', kind: 'hold' },
  { id: 'yaw.right', label: 'Rudder: right', group: 'Flight controls', kind: 'hold' },
  { id: 'controls.center', label: 'Center ailerons and rudder', group: 'Flight controls', kind: 'press', event: INPUT_EVENTS.centerControls },
  { id: 'trim.nose_down', label: 'Pitch trim: nose down', group: 'Flight controls', kind: 'hold' },
  { id: 'trim.nose_up', label: 'Pitch trim: nose up', group: 'Flight controls', kind: 'hold' },
  { id: 'brakes', label: 'Wheel brakes (both)', group: 'Flight controls', kind: 'hold' },
  { id: 'brake.left', label: 'Left brake', group: 'Flight controls', kind: 'hold' },
  { id: 'brake.right', label: 'Right brake', group: 'Flight controls', kind: 'hold' },
  { id: 'parkbrake.toggle', label: 'Parking brake set/release', group: 'Flight controls', kind: 'press', event: INPUT_EVENTS.parkingBrakeToggle },
  { id: 'throttle.inc', label: 'Throttle: increase', group: 'Engines', kind: 'hold' },
  { id: 'throttle.dec', label: 'Throttle: decrease (hold at idle for reverse)', group: 'Engines', kind: 'hold' },
  { id: 'throttle.idle', label: 'Throttle: idle', group: 'Engines', kind: 'press', event: INPUT_EVENTS.throttleIdle },
  { id: 'throttle.full', label: 'Throttle: full', group: 'Engines', kind: 'press', event: INPUT_EVENTS.throttleFull },
  { id: 'reverse.toggle', label: 'Thrust reversers: toggle', group: 'Engines', kind: 'press', event: INPUT_EVENTS.reverseToggle },
  { id: 'mixture.inc', label: 'Mixture: richer', group: 'Engines', kind: 'hold' },
  { id: 'mixture.dec', label: 'Mixture: leaner', group: 'Engines', kind: 'hold' },
  { id: 'mixture.rich', label: 'Mixture: full rich', group: 'Engines', kind: 'press', event: INPUT_EVENTS.mixtureRich },
  { id: 'mixture.cutoff', label: 'Mixture: idle cutoff', group: 'Engines', kind: 'press', event: INPUT_EVENTS.mixtureCutoff },
  { id: 'flaps.up', label: 'Flaps: retract one step', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.flapsUp },
  { id: 'flaps.down', label: 'Flaps: extend one step', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.flapsDown },
  { id: 'flaps.full_up', label: 'Flaps: fully retract', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.flapsFullUp },
  { id: 'flaps.full_down', label: 'Flaps: fully extend', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.flapsFullDown },
  { id: 'gear.toggle', label: 'Landing gear up/down', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.gearToggle },
  { id: 'spoilers.toggle', label: 'Speedbrake: extend/retract', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.spoilersToggle },
  { id: 'spoilers.arm', label: 'Ground spoilers: arm', group: 'Configuration', kind: 'press', event: INPUT_EVENTS.spoilersArm },
  { id: 'ap.toggle', label: 'Autopilot engage/disengage', group: 'Autoflight', kind: 'press', event: INPUT_EVENTS.apToggle },
  { id: 'ap.disconnect', label: 'Autopilot disconnect (yoke button, hold)', group: 'Autoflight', kind: 'hold' },
  { id: 'at.disconnect', label: 'Autothrottle disconnect', group: 'Autoflight', kind: 'press', event: INPUT_EVENTS.atDisconnect },
  { id: 'toga', label: 'TO/GA (hold)', group: 'Autoflight', kind: 'hold' },
  { id: 'view.cockpit', label: 'Cockpit view / next cockpit view', group: 'Views', kind: 'press', event: APP_EVENTS.viewCockpit },
  { id: 'view.next', label: 'Next view', group: 'Views', kind: 'press', event: APP_EVENTS.viewNext },
  { id: 'view.prev', label: 'Previous view', group: 'Views', kind: 'press', event: APP_EVENTS.viewPrev },
  { id: 'view.external', label: 'External view / next external camera', group: 'Views', kind: 'press', event: APP_EVENTS.viewExternal },
  { id: 'view.reset', label: 'Reset view', group: 'Views', kind: 'press', event: APP_EVENTS.viewReset },
  { id: 'view.look_left', label: 'Look left', group: 'Views', kind: 'hold' },
  { id: 'view.look_right', label: 'Look right', group: 'Views', kind: 'hold' },
  { id: 'view.look_up', label: 'Look up', group: 'Views', kind: 'hold' },
  { id: 'view.look_down', label: 'Look down', group: 'Views', kind: 'hold' },
  { id: 'view.zoom_in', label: 'Zoom in', group: 'Views', kind: 'hold' },
  { id: 'view.zoom_out', label: 'Zoom out', group: 'Views', kind: 'hold' },
  { id: 'sim.pause', label: 'Pause', group: 'Simulation', kind: 'press', event: APP_EVENTS.pauseToggle },
  { id: 'sim.rate_inc', label: 'Sim rate faster', group: 'Simulation', kind: 'press', event: APP_EVENTS.rateInc },
  { id: 'sim.rate_dec', label: 'Sim rate slower', group: 'Simulation', kind: 'press', event: APP_EVENTS.rateDec },
  { id: 'ui.menu', label: 'Pause menu', group: 'Simulation', kind: 'press', event: APP_EVENTS.menu },
  { id: 'ui.help', label: 'Keyboard help', group: 'Simulation', kind: 'press', event: APP_EVENTS.help },
  { id: 'ui.checklist', label: 'Checklists', group: 'Simulation', kind: 'press', event: APP_EVENTS.checklist },
  { id: 'ui.debug', label: 'Debug HUD', group: 'Simulation', kind: 'press', event: APP_EVENTS.debug },
  { id: 'ui.fullscreen', label: 'Full screen', group: 'Simulation', kind: 'press', event: APP_EVENTS.fullscreen },
  { id: 'input.mouse_yoke', label: 'Mouse yoke mode on/off', group: 'Flight controls', kind: 'press', event: INPUT_EVENTS.mouseYokeToggle },
];

const ACTION_MAP = new Map<string, ActionDef>(ACTIONS.map((a) => [a.id, a]));

export function actionDef(id: string): ActionDef | undefined {
  return ACTION_MAP.get(id);
}

export interface KeyChord {
  /** `KeyboardEvent.code`, e.g. 'KeyG', 'ArrowUp', 'Numpad8', 'F1', 'Period'. */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBinding extends KeyChord {
  action: ActionId;
}

/**
 * Default keyboard layout (documented in docs/modules/app.md and the in-sim
 * help overlay). Loosely follows common desktop-simulator conventions:
 * numpad/arrows for the primary controls, F1-F4 throttle, F5-F8 flaps,
 * G gear, '.' brakes, Ctrl+'.' parking brake, P pause, R / Shift+R sim rate.
 */
export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = [
  // Primary flight controls (keyboard values ramp in and spring back to centre).
  { action: 'pitch.down', code: 'ArrowUp' },
  { action: 'pitch.down', code: 'Numpad8' },
  { action: 'pitch.up', code: 'ArrowDown' },
  { action: 'pitch.up', code: 'Numpad2' },
  { action: 'roll.left', code: 'ArrowLeft' },
  { action: 'roll.left', code: 'Numpad4' },
  { action: 'roll.right', code: 'ArrowRight' },
  { action: 'roll.right', code: 'Numpad6' },
  { action: 'yaw.left', code: 'KeyQ' },
  { action: 'yaw.left', code: 'Numpad0' },
  { action: 'yaw.right', code: 'KeyE' },
  { action: 'yaw.right', code: 'NumpadEnter' },
  { action: 'controls.center', code: 'Numpad5' },
  { action: 'trim.nose_down', code: 'Numpad7' },
  { action: 'trim.nose_down', code: 'Home' },
  { action: 'trim.nose_up', code: 'Numpad1' },
  { action: 'trim.nose_up', code: 'End' },
  { action: 'brakes', code: 'Period' },
  { action: 'brake.left', code: 'Comma' },
  { action: 'brake.right', code: 'Slash', shift: true },
  { action: 'parkbrake.toggle', code: 'Period', ctrl: true },
  // Engines
  { action: 'throttle.idle', code: 'F1' },
  { action: 'throttle.dec', code: 'F2' },
  { action: 'throttle.inc', code: 'F3' },
  { action: 'throttle.full', code: 'F4' },
  { action: 'throttle.inc', code: 'Numpad9' },
  { action: 'throttle.dec', code: 'Numpad3' },
  { action: 'reverse.toggle', code: 'F2', shift: true },
  { action: 'mixture.cutoff', code: 'F1', ctrl: true },
  { action: 'mixture.dec', code: 'F2', ctrl: true },
  { action: 'mixture.inc', code: 'F3', ctrl: true },
  { action: 'mixture.rich', code: 'F4', ctrl: true },
  // Configuration
  { action: 'flaps.full_up', code: 'F5' },
  { action: 'flaps.up', code: 'F6' },
  { action: 'flaps.down', code: 'F7' },
  { action: 'flaps.full_down', code: 'F8' },
  { action: 'flaps.up', code: 'BracketLeft' },
  { action: 'flaps.down', code: 'BracketRight' },
  { action: 'gear.toggle', code: 'KeyG' },
  { action: 'spoilers.toggle', code: 'Slash' },
  { action: 'spoilers.arm', code: 'Slash', ctrl: true },
  // Autoflight
  { action: 'ap.toggle', code: 'KeyZ' },
  { action: 'ap.disconnect', code: 'KeyZ', shift: true },
  { action: 'at.disconnect', code: 'KeyT', shift: true },
  { action: 'toga', code: 'KeyT' },
  // Views
  { action: 'view.cockpit', code: 'KeyC' },
  { action: 'view.external', code: 'KeyV' },
  { action: 'view.next', code: 'KeyV', shift: true },
  { action: 'view.prev', code: 'KeyC', shift: true },
  { action: 'view.reset', code: 'Space' },
  { action: 'view.look_left', code: 'ArrowLeft', shift: true },
  { action: 'view.look_right', code: 'ArrowRight', shift: true },
  { action: 'view.look_up', code: 'ArrowUp', shift: true },
  { action: 'view.look_down', code: 'ArrowDown', shift: true },
  { action: 'view.zoom_in', code: 'Equal' },
  { action: 'view.zoom_out', code: 'Minus' },
  { action: 'view.zoom_in', code: 'NumpadAdd' },
  { action: 'view.zoom_out', code: 'NumpadSubtract' },
  // Simulation
  { action: 'sim.pause', code: 'KeyP' },
  { action: 'sim.rate_inc', code: 'KeyR' },
  { action: 'sim.rate_dec', code: 'KeyR', shift: true },
  { action: 'ui.menu', code: 'Escape' },
  { action: 'ui.help', code: 'KeyH' },
  { action: 'ui.checklist', code: 'KeyK' },
  { action: 'ui.debug', code: 'Backquote' },
  { action: 'ui.fullscreen', code: 'F11' },
  { action: 'input.mouse_yoke', code: 'KeyY' },
];

/** Human-readable chord, e.g. 'Ctrl+.' or 'Shift+F2'. */
export function chordLabel(c: KeyChord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  parts.push(codeLabel(c.code));
  return parts.join('+');
}

const CODE_LABELS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Space: 'Space',
  Escape: 'Esc',
  NumpadEnter: 'Num Enter',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
};

export function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** True when the chord's modifiers match the event state exactly. */
export function chordMatches(c: KeyChord, code: string, ctrl: boolean, shift: boolean, alt: boolean): boolean {
  return c.code === code && !!c.ctrl === ctrl && !!c.shift === shift && !!c.alt === alt;
}
