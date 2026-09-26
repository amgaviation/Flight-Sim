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
