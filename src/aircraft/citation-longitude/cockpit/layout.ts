/**
 * Citation Longitude flight-deck geometry (body metres: x fwd, y right, z
 * down, from the datum = empty-weight CG, see fdm.ts). Shared by every
 * cockpit file and by the overhead / side-console builders
 * (cockpit/overhead/**, cockpit/side/**), which mount on the frames below.
 *
 * Sources: dossier docs/aircraft/citation-longitude.md §7.0 (EST from
 * published flight-deck photographs and the Operators Guide figures);
 * Garmin unit sizes from src/avionics/garmin-g3000/controls.ts
 * (UNIT_SIZE_MM) and the GDU 1400W 14.1 in 16:10 active area. Everything
 * here is EST unless a source is named.
 *
 * Vertical reference: cockpit floor at z = +0.62 (cabin floor ~0.6 m below
 * the fuselage centreline, fdm.ts GEAR_Z comment). Design eye 1.17 m above
 * the floor (EST: ~0.40 m seat reference point + ~0.77 m seated eye height,
 * FAA AC 25.773-1 design-eye practice), 0.50 m either side of the centreline
 * (dossier §7.0 crew seats y +-0.50).
 */
import type { BodyVec } from '../../../cockpit/frame';

export const FLOOR_Z = 0.62;

/** Pilot / copilot design eye. */
export const EYE_L: [number, number, number] = [7.55, -0.5, -0.55];
export const EYE_R: [number, number, number] = [7.55, 0.5, -0.55];

/** Main instrument panel (display band): three GDU 1400W + two PFD GTC 570. Face tilted 10 deg back (dossier §7.0). */
export const MAIN_PANEL = {
  center_m: [8.34, 0, -0.165] as BodyVec,
  tiltDeg: 10,
  width: 1.8,
  height: 0.25,
};

/** GDU 1400W: 14.1 in 16:10 active area 302 x 189 mm (canvas 1280 x 800); bezel 354 x 237 mm (UNIT_SIZE_MM). */
export const GDU = { screenW: 0.302, screenH: 0.189, bezelW: 0.354, bezelH: 0.237 };
/** GTC 570 portrait: 7 in 3:4 active area (canvas 480 x 640) ~107 x 143 mm; face 150 x 215 mm (UNIT_SIZE_MM). */
export const GTC = { screenW: 0.107, screenH: 0.143, faceW: 0.15, faceH: 0.215, screenTopMm: 12 };

/** Display centres on the main panel (u metres from the panel centre). EST: dossier §7.2 (PFDs +-560 mm, GTCs +-830 mm) tightened so the three GDUs sit close together as in the photographs. */
export const PFD_U = 0.49;
export const GTC_U = 0.755;

/** Glareshield front face (GMC 710, display controllers, MASTER WARN/CAUTION, fire switchlights). */
export const GLARE_FACE = {
  center_m: [8.236, 0, -0.32] as BodyVec,
  tiltDeg: 25,
  width: 1.8,
  height: 0.09,
};
/** Glareshield hood: aft (brow) edge and top height; depth to the windshield base. */
export const GLARE_HOOD = { aftX: 8.285, topZ: -0.39, frontZ: -0.33, frontX: 8.63 };

/** Lower sub-panels under the PFDs (dossier §7.3 / §7.4). */
export const LOWER_PANEL = {
  x: 8.345,
  zTop: -0.04,
  zBottom: 0.16,
  /** Inboard / outboard edges (|y|). */
  yIn: 0.185,
  yOut: 0.9,
};

/** Centre pedestal: sloped forward face with the two MFD GTCs, then the flat top (dossier §7.5 / §7.6). */
export const PEDESTAL = {
  width: 0.36,
  /** Forward face from the MFD bottom edge down/aft to the top surface. */
  fwdTop: [8.33, -0.035] as [number, number], // [x, z]
  fwdBottom: [8.1, 0.095] as [number, number],
  /** Top surface. */
  topFwd: [8.1, 0.095] as [number, number],
  topAft: [7.28, 0.15] as [number, number],
};

/** Control wheels: hub positions (dossier §7.0: x ~7.95 m, y +-0.50 m, below the display band). */
export const YOKE_HUB_L: [number, number, number] = [7.99, -0.5, 0.065];
export const YOKE_HUB_R: [number, number, number] = [7.99, 0.5, 0.065];
/** Rudder pedal pivots (hanging pedals under the lower panel). */
export const PEDALS_L: [number, number, number] = [8.55, -0.5, 0.36];
export const PEDALS_R: [number, number, number] = [8.55, 0.5, 0.36];

/** Crew seat reference (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [7.78, -0.53, FLOOR_Z];
export const SEAT_R: [number, number, number] = [7.78, 0.53, FLOOR_Z];

/**
 * Mount frames for the builders owned by other agents (docs: cockpit/index.ts).
 * Overhead: a short console from the windshield header aft (dossier §7.0: x 8.2 -> 7.6, 0.45 m wide, 12 deg
 * down at the front). Side consoles: along each sidewall from the seat to the panel, top ~0.3 m above
 * the floor below the side-window sill (EST).
 */
export const MOUNTS = {
  overhead: { center_m: [7.8, 0, -1.07] as BodyVec, facing: 'down' as const, tiltDeg: -12, width: 0.45, height: 0.62 },
  sideLeft: { center_m: [7.55, -0.84, 0.2] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.2, height: 0.9 },
  sideRight: { center_m: [7.55, 0.84, 0.2] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.2, height: 0.9 },
};

/** Left-console tiller (built by the main cockpit; the side-console builder must leave this spot free). */
export const TILLER = { center_m: [7.9, -0.84, 0.19] as BodyVec };

/** Windshield frame stations (shared by the shell and the exterior glazing). */
export const WINDSHIELD = {
  /** Base (at the glareshield) and header stations. */
  baseX: 8.64,
  headerX: 8.02,
  /** Half-angle of the glazed arc around the nose (rad from the top). */
  halfAngle: 1.17,
  /** Centre post half-width (rad). EST 0.08 m post. */
  postHalf: 0.022,
};
/** Side windows: forward and aft panes, angular band on the section (rad from the top). */
export const SIDE_WINDOWS = {
  fwd: { x0: 7.42, x1: 8.0 },
  aft: { x0: 6.98, x1: 7.36 },
  roof: 0.62,
  sill: 1.3,
};
