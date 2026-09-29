import type * as THREE from 'three';
import type { FdmConfig } from '../physics/types';
import type { SimContext } from '../core/SimContext';
import type { CockpitBuild } from '../cockpit/types';

export type InitialState = 'cold_dark' | 'ready_to_taxi' | 'takeoff' | 'cruise' | 'approach';

export interface AircraftMeta {
  id: string; // e.g. 'citation-m2'
  name: string; // e.g. 'Cessna Citation M2 (525)'
  manufacturer: string;
  icaoType: string; // e.g. 'C25M'
  engines: number;
  engineType: 'piston' | 'turbofan';
  avionics: string; // e.g. 'Garmin G3000'
  description: string;
  /** Typical speeds for initial states & UI (kt IAS / ft). */
  typical: {
    cruiseAltFt: number;
    cruiseKtas: number;
    approachKias: number;
    rotateKias: number;
    maxAltFt: number;
  };
  /** Camera distance for external chase view (m). */
  chaseDistance_m: number;
}

/**
 * A subsystem updated at the systems rate (60 Hz). Order matters: the host
 * updates in array order, so electrical sources come before consumers.
 */
export interface Subsystem {
  readonly name: string;
  update(dt: number): void;
  /** Reset internal state to match current SimVars (after state load/reposition). */
  reset?(): void;
  dispose?(): void;
}

export interface Checklist {
  title: string;
  phase: string;
  items: { challenge: string; response: string; /** optional auto-check against vars */ check?: (vars: SimContext['vars']) => boolean }[];
}

export interface AircraftInstance {
  systems: Subsystem[];
  cockpit: CockpitBuild;
  exterior: THREE.Object3D;
  /** Animate exterior (gear, flaps, control surfaces, lights, reversers) from vars. */
  updateExterior?(dt: number): void;
  /** Put every switch/system into a named state (cold & dark, ready to taxi, ...). */
  applyState(state: InitialState): void;
  checklists?: Checklist[];
  dispose(): void;
}

export interface AircraftModule {
  meta: AircraftMeta;
  fdm: FdmConfig;
  create(ctx: SimContext): Promise<AircraftInstance> | AircraftInstance;
}

// ---------------------------------------------------------------------------
// Appended by the app shell (append-only; see CLAUDE.md shared contracts).
// Reference: docs/modules/app.md ("Input" and "Aircraft integration").
// ---------------------------------------------------------------------------

/**
 * Optional mapping from the simulator's generic keyboard/joystick commands
 * (throttle up/down, flaps step, gear, speedbrake, parking brake, AP) to the
 * aircraft's own cockpit vars. The app's `CommandRouter` writes these vars
 * (the cockpit controls follow external writes and animate). Every field is
 * optional; commands with no mapping are still emitted as `input.*` events
 * (see `INPUT_EVENTS` in `src/input/actions.ts`) that an aircraft may handle
 * itself.
 */
export interface AircraftInputMap {
  /** Thrust/power lever vars, one per lever in engine order. */
  throttles?: string[];
  /** Values at idle and full forward thrust (default [0, 1]). */
  throttleRange?: [number, number];
  /**
   * Reverse thrust: `{ value }` = integral reverse range on the same lever
   * (value written at full reverse, e.g. -0.3 or -1); `{ vars, full }` =
   * separate reverse levers (737 piggy-back levers, 0 = stowed).
   */
  reverse?: { value: number } | { vars: string[]; full: number };
  /** Mixture/condition lever vars and their [cutoff, full rich] values (default [0, 1]). */
  mixtures?: string[];
  mixtureRange?: [number, number];
  /** Flap lever var and its detent values in retract -> extend order. */
  flaps?: { var: string; detents: number[] };
  /** Gear handle var and its UP / DOWN values. */
  gear?: { var: string; up: number; down: number };
  /** Speedbrake lever var and its positions in stowed -> fully extended order; `armed` = ARM detent value (optional). */
  speedbrake?: { var: string; positions: number[]; armed?: number };
  /** Parking brake var and its set / released values. */
  parkingBrake?: { var: string; on: number; off: number };
  /** Events emitted for the AP engage toggle and the A/T disconnect key (e.g. the aircraft's MCP button events). */
  apToggleEvent?: string;
  atDisconnectEvent?: string;
}

// Declaration merging: the optional map becomes part of AircraftInstance.
export interface AircraftInstance {
  inputMap?: AircraftInputMap;
}
