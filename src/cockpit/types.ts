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
