/**
 * Shared plumbing of the CDS formats: the environment handed to every
 * format renderer and the renderer interface the display units call.
 */
import type { SimVars } from '../../../core/SimVars';
import type { AudioApi } from '../../../core/SimContext';
import type { NavDatabase } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { Ctx2D } from '../../common/draw/context';
import type { B737TrafficSource, NdWeatherOverlay, ResolvedB737Config } from '../config';
import type { EfisPanels } from './EfisPanels';
import type { Side } from '../vars';

/** A FIX INFO page entry drawn on the ND (green dashed circles / radials). */
export interface NdFixInfo {
  ident: string;
  lat: number;
  lon: number;
  /** Magnetic variation at the fix (deg, + east) for radial conversion. */
  magVar: number;
  /** Radials (deg magnetic) and distances (nm) entered on FIX INFO; NaN = empty. */
  radials: number[];
  distancesNm: number[];
}

/** FMC data the displays need beyond the `fms.*` vars (implemented by the FMC). */
export interface FmcDisplayData {
  readonly fixes: readonly NdFixInfo[];
  /** Predicted top of climb / top of descent / end of descent positions (NaN lat = none). */
  readonly toc: { lat: number; lon: number };
  readonly tod: { lat: number; lon: number };
  /** Selected PLN-mode centre waypoint index in the displayed plan (-1 = active waypoint). */
  readonly planCenterIndex: number;
  /** Takeoff / approach reference speeds for the PFD (NaN = none). */
  readonly v1: number;
  readonly vr: number;
  readonly v2: number;
  readonly vref: number;
  /** Gross weight (kg) for flap maneuver speeds; NaN = unknown. */
  readonly grossWeightKg: number;
  /** True once V-speeds have been selected (PFD shows NO VSPD while false on the ground). */
  readonly vSpeedsSet: boolean;
  /** Landing runway / destination elevation (ft) for the landing altitude bar, NaN = unknown. */
  readonly landingElevFt: number;
  /** Approach runway true course (deg) and the ILS course for the rising runway alignment, NaN = none. */
  readonly approachCourseTrue: number;
}

export interface CdsEnv {
  vars: SimVars;
  cfg: ResolvedB737Config;
  efis: EfisPanels;
  fms: Fms | null;
  fmc: FmcDisplayData | null;
  nav: NavDatabase | null;
  world: Pick<WorldQuery, 'elevationAt'> | null;
  audio: AudioApi | null;
  traffic: B737TrafficSource | null;
  weather: NdWeatherOverlay | null;
}

/** One CDS format drawn inside a DU (800 x 800 logical px). */
export interface CdsFormatRenderer {
  /** Update state for the data side `side` (1 captain, 2 F/O; engine formats ignore it). */
  update(dt: number, side: Side): void;
  draw(ctx: Ctx2D): void;
  /** Called when the format (re)appears on a DU (filters and timers restart). */
  reset?(): void;
}

/** DU design size (logical px). The 737NG DU active area is square (b737.org.uk / FCOM figures). */
export const DU_SIZE = 800;
