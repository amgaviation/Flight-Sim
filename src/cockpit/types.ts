import type * as THREE from 'three';

/**
 * Interactive cockpit controls. Implementations live in `cockpit/controls/`
 * (switches, knobs, levers, buttons, guarded switches, circuit breakers, ...).
 * Aircraft cockpit builders instantiate them and register them with the
 * CockpitInteraction manager, which raycasts pointer events onto `hitTargets`.
 *
 * Mouse model (consistent across every control):
 *   - left click: primary action (toggle / press / step clockwise-or-up)
 *   - right click: secondary action (step counter-clockwise-or-down, or inner knob)
 *   - wheel: rotate knobs / step switches; with Shift = inner knob of concentric pair
 *   - left drag: levers, yokes, thumbwheels, analogue knobs
 *   - middle click: push knob (e.g. HDG SYNC, BARO STD, CRS DIRECT)
 */
export interface ControlPointer {
  button: 0 | 1 | 2;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** World-space hit point and the specific mesh hit (for multi-zone controls). */
  point: THREE.Vector3;
  object: THREE.Object3D;
}

export interface CockpitControl {
  readonly id: string;
  /** Root object placed in the cockpit scene graph. */
  readonly object: THREE.Object3D;
  /** Meshes that receive pointer hits (may be invisible hit boxes). */
  readonly hitTargets: THREE.Object3D[];
  /** Human-readable name + current state, shown on hover. */
  tooltip(): string;
  onPointerDown?(p: ControlPointer): void;
  onPointerUp?(p: ControlPointer): void;
  /** Pixel deltas while dragging with the button held. */
  onDrag?(dx: number, dy: number, p: ControlPointer): void;
  /** +1 per wheel notch up (clockwise). */
  onWheel?(delta: number, p: ControlPointer): void;
  /** Called every render frame; animate from SimVars here. */
  update?(dt: number): void;
  dispose?(): void;
}

/**
 * A glass display or electromechanical gauge face rendered to a canvas that is
 * mapped onto cockpit geometry. Implementations live in `avionics/`.
 */
export interface CockpitDisplay {
  readonly id: string;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Width/height in pixels of the canvas. */
  readonly width: number;
  readonly height: number;
  /** Target refresh rate (Hz); the display manager throttles `render`. */
  readonly refreshHz: number;
  /** Draw the current frame. Return false if nothing changed (skip texture upload). */
  render(dt: number): boolean;
  /**
   * Touch/click on the display surface in canvas pixel coordinates (for
   * touchscreen controllers such as Garmin GTC, Symmetry touch displays).
   */
  onPointer?(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta?: number): void;
  /** 0..1 brightness from the dimming system; displays black when unpowered. */
  setBrightness?(b: number): void;
  dispose?(): void;
}

export interface CockpitLightingZone {
  id: string;
  /** SimVar holding 0..1 intensity (driven by panel/flood light knobs and power). */
  intensityVar: string;
  color: THREE.ColorRepresentation;
}

export interface CockpitBuild {
  root: THREE.Group;
  /** Default pilot eye position in cockpit (body axes: x fwd, y right, z down, metres from datum). */
  eyePosition_m: [number, number, number];
  /** Optional preset views (e.g. overhead, pedestal, FMS, copilot) in body metres + yaw/pitch deg. */
  views?: { name: string; position_m: [number, number, number]; yawDeg: number; pitchDeg: number; fovDeg?: number }[];
  controls: CockpitControl[];
  displays: { display: CockpitDisplay; mesh: THREE.Mesh }[];
  lighting?: CockpitLightingZone[];
  /** Per-frame hook for anything not covered by controls (e.g. yoke animation). */
  update?(dt: number): void;
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Appended by the cockpit module (append-only; see CLAUDE.md shared contracts).
// Implementations: src/cockpit/*. Reference: docs/modules/cockpit.md.
// ---------------------------------------------------------------------------

/**
 * Optional capabilities a control may expose to the interaction manager
 * (declaration-merged into CockpitControl; every member is optional so
 * existing implementations keep compiling).
 */
export interface CockpitControl {
  /** Request pointer lock while this control is being dragged (yokes, levers). */
  readonly pointerLock?: boolean;
  /** CSS cursor shown while hovering this control (default 'pointer'). */
  cursor?(p: ControlPointer): string;
  /**
   * Keyboard input while this control has focus (focus is given by clicking a
   * control that implements onKey, e.g. a CDU keypad). Return true when the
   * key was consumed (the manager then calls preventDefault).
   */
  onKey?(key: string, code: string, down: boolean, shift: boolean): boolean;
  /** Called by the interaction manager when hover starts/ends (optional extra feedback). */
  onHover?(hovered: boolean): void;
  /** Called when the drag / press ends because the pointer was lost (window blur, pointer cancel). */
  onCancel?(): void;
  /** When false the manager ignores the control (hover and clicks pass through to what is behind). */
  readonly enabled?: boolean;
}

/** Extra, optional data on a CockpitBuild produced by `CockpitBuilder`. */
export interface CockpitBuild {
  /**
   * Non-interactive cockpit geometry that must block pointer rays (yoke
   * columns, seats, glareshield) so controls behind it cannot be clicked.
   */
  occluders?: THREE.Object3D[];
}

/** SimVars written by the cockpit module (in addition to each control's own bindings). */
export const COCKPIT_VARS = {
  /** 1 while the pilot drags the 3D yoke with the mouse. Input module: use yoke_pitch/roll as the pitch/roll source while 1. */
  yokeActive: 'cockpit.yoke_active',
  /** -1..1, + = yoke aft (nose up). Same sign as input.pitch. */
  yokePitch: 'cockpit.yoke_pitch',
  /** -1..1, + = right roll. Same sign as input.roll. */
  yokeRoll: 'cockpit.yoke_roll',
  /** 1 while the pilot drags the 3D rudder pedals. */
  pedalsActive: 'cockpit.pedals_active',
  /** -1..1, + = right pedal forward. Same sign as input.yaw. */
  pedalsYaw: 'cockpit.pedals_yaw',
  /** 0..1 toe brake applied by clicking and holding the 3D pedal toe. Input module: max() with input.brake_*. */
  toeBrakeLeft: 'cockpit.toe_brake_left',
  toeBrakeRight: 'cockpit.toe_brake_right',
} as const;

/** Per-display power/brightness vars read by `DisplayManager` (defaults: powered, full brightness when unset). */
export const DISPLAY_VARS = {
  /** 0 = unpowered (black screen), 1 = powered. Missing var = powered. */
  power: (id: string) => `display.${id}.power`,
  /** 0..1 brightness (dimming system). Missing var = 1. */
  brightness: (id: string) => `display.${id}.brt`,
  /** Written by DisplayManager: 1 once the boot splash has finished after power-up. */
  ready: (id: string) => `display.${id}.ready`,
} as const;

/**
 * Sound ids played through `AudioApi.play(id, { volume, position })` when a
 * cockpit control actuates. `position` is the control's location in body
 * metres (x fwd, y right, z down) from the aircraft datum.
 */
export const COCKPIT_SOUNDS = {
  toggle: 'switch.toggle', // light toggle / bat-handle switch
  toggleHeavy: 'switch.toggle_heavy', // lever-lock / large toggles, battery switches
  rocker: 'switch.rocker',
  guardOpen: 'switch.guard_open',
  guardClose: 'switch.guard_close',
  buttonPress: 'button.press',
  buttonRelease: 'button.release',
  key: 'key.press', // CDU / keyboard key
  knobDetent: 'knob.detent', // encoder click
  knobSelector: 'knob.selector', // heavier rotary selector detent
  knobPush: 'knob.push',
  leverDetent: 'lever.detent',
  leverGate: 'lever.gate', // lever stopped at / lifted over a gate
  leverSlide: 'lever.slide',
  gearHandle: 'gear.handle',
  cbPull: 'cb.pull',
  cbPush: 'cb.push',
  cbTrip: 'cb.trip',
  handlePull: 'handle.pull', // T-handles, fire handles, push-pull knobs
  handlePush: 'handle.push',
  handleRotate: 'handle.rotate',
  fuelSelector: 'fuel.selector',
  trimWheel: 'trim.wheel', // one clack per spoke passing (spinning trim wheels)
  yokeButton: 'yoke.button',
} as const;
