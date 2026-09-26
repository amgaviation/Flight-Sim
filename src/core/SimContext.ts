import type { SimVars } from './SimVars';
import type { EventBus } from './EventBus';
import type { WorldQuery } from '../world/types';
import type { NavDatabase } from '../nav/types';

/** Minimal audio surface the aircraft/systems use. Implemented by `audio/AudioEngine.ts`. */
export interface AudioApi {
  /** One-shot sample or synthesized sound by id (e.g. 'switch.toggle', 'gear.up'). */
  play(id: string, opts?: { volume?: number; rate?: number; position?: [number, number, number] }): void;
  /** Continuous loop whose gain/rate are driven every frame; returns handle. */
  loop(id: string): { setGain(g: number): void; setRate(r: number): void; stop(): void };
  /** Aural alert / voice callout ("MINIMUMS", "FIVE HUNDRED", "TRAFFIC"), prioritized and non-overlapping. */
  callout(text: string, priority?: number): void;
  /** Continuous alert tones (stall horn, overspeed clacker, AP disconnect cavalry charge, master warning chime). */
  tone(id: string, on: boolean): void;
}

/** Aircraft-independent handle on the flight model for systems that need it. */
export interface FlightModelHandle {
  /** Reposition (lat/lon deg, alt ft MSL or on ground, heading true deg, IAS kt). */
  reposition(opts: { lat: number; lon: number; altFtMsl?: number; onGround?: boolean; headingTrue: number; iasKt?: number }): void;
  /** Freeze/unfreeze position (slew). */
  setFrozen(frozen: boolean): void;
  /** Payload (kg per station) changes from the weight & balance page. */
  setStationMass(index: number, kg: number): void;
}

export interface SimContext {
  vars: SimVars;
  events: EventBus;
  world: WorldQuery;
  nav: NavDatabase;
  audio: AudioApi;
  fdm: FlightModelHandle;
  /** Aircraft-local persistent storage (settings like display brightness, FMS routes). */
  storage: {
    get<T>(key: string, fallback: T): T;
    set<T>(key: string, value: T): void;
  };
}
