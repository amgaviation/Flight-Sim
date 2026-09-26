/**
 * Gulfstream G800 airframe and flight-deck geometry (body metres: x fwd, y
 * right, z down, from the datum = empty-weight CG, fdm.ts). Shared by every
 * cockpit file, the exterior (exterior.ts) and the overhead / side-console
 * builders (cockpit/overhead/**, cockpit/side/**) through the mount frames
 * below.
 *
 * Anchors (fdm.ts / dossier docs/aircraft/g800.md §1, §9.0):
 *  - nose tip x +15.5 m, overall length 30.41 m (TCDS) -> tail end x -14.91 m;
 *  - fuselage 2.74 m wide at the constant section (TCDS), centreline at the
 *    datum height, ~2.9 m above the ramp (fdm.ts eyeHeightOnGround / GEAR_Z);
 *  - flight-deck floor z +0.48 (dossier §9.0), crew seats y +-0.55 (fdm.ts
 *    stations), design eye (12.55, +-0.55, -0.78) (dossier §9.0, 1.26 m above
 *    the floor).
 * Everything else is EST from G500/G600/G700/G800 flight-deck and exterior
 * photographs, scaled from the 14-in DU-1310 display units (EPIC_HW).
 */
import { FuselageProfile, type FuselageStation } from '../../_test/loft';
import type { BodyVec } from '../../../cockpit/frame';

/** Section from its top and bottom skin heights (body z) and half-width. */
function st(x: number, zTop: number, zBot: number, ry: number): FuselageStation {
  return { x, cz: (zTop + zBot) / 2, rz: (zBot - zTop) / 2, ry };
}

/**
 * Outer-skin cross-sections. Constant section 2.74 m wide (TCDS) x 2.93 m
 * tall (EST: the GVI-family cabin is 8 ft 2 in wide x 6 ft 5 in tall inside,
 * GAC; the section is slightly taller than wide, flat-floored ~0.5 m below
 * the centreline). The nose drops steeply ahead of the windshield (Gulfstream
 * "droop" radome, EST from side views) so the over-the-nose view is ~12 deg.
 * Tail cone upswept to the tail-strike point (fdm.ts 'Tail cone').
 */
export const G800_FUSELAGE = new FuselageProfile([
  st(15.5, 0.14, 0.22, 0.03),
  st(15.4, -0.02, 0.4, 0.24),
  st(15.1, -0.22, 0.68, 0.5),
  st(14.6, -0.42, 0.95, 0.78),
  st(14.1, -0.56, 1.12, 0.97),
  st(13.72, -0.66, 1.22, 1.08),
  st(13.45, -1.02, 1.3, 1.18),
  st(13.2, -1.28, 1.36, 1.26),
  st(12.7, -1.4, 1.42, 1.32),
  st(11.8, -1.46, 1.47, 1.37),
  st(-4.0, -1.46, 1.47, 1.37),
  st(-6.5, -1.44, 1.32, 1.3),
  st(-9.0, -1.38, 0.95, 1.1),
  st(-11.5, -1.26, 0.55, 0.76),
  st(-13.5, -1.12, 0.0, 0.42),
  st(-14.91, -1.0, -0.66, 0.07),
]);

/** Skin inset of the cockpit interior shell (EST 45 mm: skin, frames, insulation, trim). */
export const SHELL_INSET = 0.045;

export const FLOOR_Z = 0.48;
/** Aft end of the flight deck (cockpit door bulkhead, dossier §9.0). */
export const X_AFT = 11.4;

/** Pilot / copilot design eye (dossier §9.0). */
export const EYE_L: [number, number, number] = [12.55, -0.55, -0.78];
export const EYE_R: [number, number, number] = [12.55, 0.55, -0.78];

/**
 * Glazing in side-view terms (x, z) (EST from G500/G600/G700 photographs):
 *  - windshield: two large wrap-around panes above the glareshield line
 *    (z < baseZ) and below the header (z > headerZ), forward of the
 *    A-pillar line, split by a narrow centre post (dossier §9.0);
 *  - forward side window (DV): bounded by the A-pillar and a swept-back aft
 *    edge (BJT500: "the pilots' side windows are swept back"), sill below the
 *    shoulder line;
 *  - aft side window: smaller, rounded, swept like the forward one.
 */
export const GLAZING = {
  baseZ: -0.64,
  headerZ: -1.26,
  postHalf: 0.035,
  /** A-pillar (windshield aft edge) line: x at z = baseZ and at z = headerZ. */
  aPillar: { xBase: 13.16, xTop: 12.9, width: 0.075 },
  fwdSide: { sillZ: -0.43, roofZ: -1.14, aftBase: 12.45, aftTop: 12.27, corner: 0.06 },
  aftSide: { sillZ: -0.52, roofZ: -1.08, fwdBase: 12.34, fwdTop: 12.15, aftBase: 11.84, aftTop: 11.7, corner: 0.12 },
} as const;

/** A-pillar x at height z (linear between the base and header points). */
export function aPillarX(z: number): number {
  const a = GLAZING.aPillar;
  const t = (z - GLAZING.baseZ) / (GLAZING.headerZ - GLAZING.baseZ);
  return a.xBase + (a.xTop - a.xBase) * t;
}

/** Linear edge helper: x at height z between (xAtSill, sillZ) and (xAtRoof, roofZ). */
export function edgeX(z: number, sillZ: number, roofZ: number, xAtSill: number, xAtRoof: number): number {
  const t = (z - sillZ) / (roofZ - sillZ);
  return xAtSill + (xAtRoof - xAtSill) * t;
}

/** Main instrument panel (display band): face tilted 12 deg back (dossier §9.0). */
export const MAIN_PANEL = {
  center_m: [13.36, 0, -0.35] as BodyVec,
  tiltDeg: 12,
  width: 1.56,
  height: 0.29,
};
/** DU centres on the main panel (u m from the panel centre): MFDs nearly abutting at the centre, PFDs ahead of each pilot (EST). */
export const DU_U = [-0.575, -0.19, 0.19, 0.575] as const;
/** Outboard TSCs: on the panel wings outboard of the PFDs, yawed toward each pilot (BJT500 "one each outboard"). */
export const OUTBOARD_TSC = { y: 0.86, x: 13.3, z: -0.34, yawDeg: 28, tiltDeg: 14 };

/** Glareshield: GP-700 / SFD face under the brow and the hood top (see shell.ts). */
export const GLARE_FACE = {
  center_m: [13.222, 0, -0.586] as BodyVec,
  tiltDeg: 24,
  width: 1.7,
  height: 0.1,
};
export const GLARE_HOOD = { browX: 13.2, topZ: -0.636 };

/** Centre pedestal (dossier §9.0: 0.40 m wide; BJT500: TSCs forward, CCDs on the pedestal). */
export const PEDESTAL = {
  width: 0.4,
  /** Sloped forward face carrying the two pedestal TSCs, from under the MFDs down/aft to the top surface. [x, z] */
  fwdTop: [13.31, -0.2] as [number, number],
  fwdBottom: [13.13, -0.03] as [number, number],
  /** Top surface, sloping down aft (dossier §9.0: 8 deg EST, kept shallow here for the quadrant). */
  topFwd: [13.13, -0.03] as [number, number],
  topAft: [12.18, 0.05] as [number, number],
};

/** Knee panels either side of the pedestal under the MFDs (gear handle right, CAS scroll left). */
export const KNEE_PANEL = { x: 13.33, zTop: -0.215, zBottom: 0.02, yIn: 0.205, yOut: 0.4, tiltDeg: 6 };

/** Side consoles (outboard of each seat): top surface height and extent (dossier §9.0). */
export const CONSOLE = { topZ: 0.02, yIn: 0.8, xFwd: 13.12, xAft: 12.05 };
/** Sidesticks: on the forward part of each console (dossier §9.0 / §9.3). */
export const STICK_L: [number, number, number] = [12.78, -0.93, CONSOLE.topZ];
export const STICK_R: [number, number, number] = [12.78, 0.93, CONSOLE.topZ];
/** Sidestick module plate (armrest pod) on each console, from the forward end to just aft of the stick. */
export const STICK_POD = { xFwd: 13.02, xAft: 12.56, y: 0.94, width: 0.2 };

/** Rudder pedal pivots (hanging pedals under the panel). */
export const PEDALS_L: [number, number, number] = [13.42, -0.55, 0.2];
export const PEDALS_R: [number, number, number] = [13.42, 0.55, 0.2];

/** Crew seat reference (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [12.8, -0.55, FLOOR_Z];
export const SEAT_R: [number, number, number] = [12.8, 0.55, FLOOR_Z];

/**
 * Engine / APU fire handles: a strip at the forward edge of the overhead just aft of the windshield header
 * (GVI family arrangement, G650ER overhead photograph as in docs/aircraft/g650.md §9; EST for the G800).
 */
export const FIRE_STRIP = { center_m: [12.9, 0, -1.3] as BodyVec, tiltDeg: -14, width: 0.42, height: 0.085 };

/**
 * Mount frames for the builders owned by other agents (contract in context.ts).
 * Overhead: from just aft of the fire-handle strip to x ~12.25 (dossier §9.0), 0.55 m wide, forward end lower.
 * Side consoles: the console tops aft of the sidestick pods (tiller, oxygen masks), x 12.05 -> 12.55.
 */
export const MOUNTS = {
  overhead: { center_m: [12.49, 0, -1.3] as BodyVec, facing: 'down' as const, tiltDeg: -8, width: 0.55, height: 0.74 },
  sideLeft: { center_m: [12.3, -0.99, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.48 },
  sideRight: { center_m: [12.3, 0.99, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.48 },
};
