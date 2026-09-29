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

/** Main instrument panel (display band): face tilted 12 deg back (dossier §9.0). Just wider than the four DUs. */
export const MAIN_PANEL = {
  center_m: [13.36, 0, -0.35] as BodyVec,
  tiltDeg: 12,
  width: 1.34,
  height: 0.29,
};
/**
 * DU centres on the main panel (u m from the panel centre). The four DUs form one continuous band with ~1 cm between
 * bezels (G600 BL7C0704 / BL7C0705: DU1 178-340 px, DU2 347-515, DU3 522-688, DU4 697-863): pitch = bezel width
 * (0.282 + 2 x 0.016 m) + 0.011 m. The PFD centres (y +-0.49) stay within 6 cm of each pilot's eye line (y +-0.55).
 */
export const DU_U = [-0.4875, -0.1625, 0.1625, 0.4875] as const;
/**
 * Outboard TSCs: directly outboard of DU1 / DU4 on the DU centreline, toed in toward each pilot (G600 BL7C0704 /
 * BL7C0705; BJT500 "one each outboard"). Portrait units (fix round 1 L01): tall tablets raked toward the pilots
 * (G800 demonstrator flight-deck photograph; G600 BL7C0705 crop p_pedmid), pages laid out 480 x 800.
 */
export const OUTBOARD_TSC = { y: 0.755, x: 13.335, z: -0.35, yawDeg: 20, tiltDeg: 12 };

/**
 * Glareshield pod (G600 BL7C0704 g600_gp.jpg): one rounded pod standing proud of the stitched glareshield, holding
 * (outboard to inboard each side) a column of three stacked switchlights, the SFD with its MENU button and BARO
 * knob, and the guidance-panel core. EST 0.92 m wide x 0.105 m tall, scaled from the DU band in the photograph.
 */
export const GLARE_FACE = {
  center_m: [13.222, 0, -0.586] as BodyVec,
  tiltDeg: 24,
  width: 0.92,
  height: 0.105,
};
/** Pod layout (panel u, m): end switchlight columns, SFD centres, SFD bezel controls, GP core width. */
export const GLARE_POD = { endU: 0.41, sfdU: 0.3, bezelU: 0.214, coreW: 0.37 };
export const GLARE_HOOD = { browX: 13.2, topZ: -0.636 };

/**
 * Centre pedestal (G600 BL7C0704 / BL7C0705, G500 BL7C0670 c_ped): a narrow centre channel (power levers, FUEL
 * CONTROL, speed brake, flaps, trims) flanked by raised wings carrying the two pedestal TSCs (forward) and the CCD
 * grips (aft); parking brake in its own recess aft-left, a storage bin aft-right, two cupholders and a brushed
 * bumper across the aft end.
 */
export const PEDESTAL = {
  width: 0.44,
  /**
   * Sloped forward face carrying the two pedestal TSCs on the wings, tilted up toward the crew. [x, z]
   * Long enough for the portrait TSC units (fix round 1 L01: 0.152 m active + bezels).
   */
  fwdTop: [13.29, -0.115] as [number, number],
  fwdBottom: [13.12, -0.03] as [number, number],
  /** Top surface, sloping down aft. */
  topFwd: [13.12, -0.03] as [number, number],
  topAft: [12.18, 0.05] as [number, number],
  /** Centre channel half-width and wing TSC centre (u). */
  channelHalf: 0.05,
  tscU: 0.14,
};

/**
 * Lower centre panel between the DU band and the pedestal TSC wings (G600 BL7C0704 g600_center, BL7C0705 crop
 * g6_lowctr): L / R engine fire handles at the ends, the red lit EMER LDG GEAR handle left of centre, the landing
 * gear handle with its green lights and LOCK RELEASE right of centre. Faces aft, 10 deg back.
 */
export const LOWER_CTR = { center_m: [13.345, 0, -0.158] as BodyVec, tiltDeg: 10, width: 0.46, height: 0.095 };

/** Side consoles (outboard of each seat): top surface height and extent (dossier §9.0). */
export const CONSOLE = { topZ: 0.02, yIn: 0.8, xFwd: 13.12, xAft: 12.05 };
/**
 * Sidesticks: at the forward end of each ledge right beside the outboard TSC, in a square silver bezel, with the
 * armrest (TILT ADJ) aft of it (G600 BL7C0704 p_stick).
 */
export const STICK_L: [number, number, number] = [12.98, -0.93, CONSOLE.topZ];
export const STICK_R: [number, number, number] = [12.98, 0.93, CONSOLE.topZ];
/** Sidestick module plate (pod) on each console, from the forward end to the armrest. */
export const STICK_POD = { xFwd: 13.1, xAft: 12.56, y: 0.94, width: 0.2 };

/** Rudder pedal pivots: floor-hinged pedals (G600 BL7C0705 p_leftlow). */
export const PEDALS_L: [number, number, number] = [13.4, -0.55, FLOOR_Z - 0.02];
export const PEDALS_R: [number, number, number] = [13.4, 0.55, FLOOR_Z - 0.02];

/** Crew seat reference (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [12.8, -0.55, FLOOR_Z];
export const SEAT_R: [number, number, number] = [12.8, 0.55, FLOOR_Z];

/**
 * HUD combiner (pilot side, G700/G800 HUD / EFVS; FSB App. 4 HUD rocker; G600 BL7C0704 shows the combiner deployed
 * in front of the pilot). EST 0.27 m ahead of the design eye, 30 x 24 deg field of view (HGS-class).
 */
export const HUD = { eyeDist: 0.27, fovHDeg: 30, fovVDeg: 24 };

/**
 * Mount frames for the builders (contract in context.ts).
 * Overhead: from the windshield header to x ~12.2 (dossier §9.0), forward end lower.
 * Side consoles: the console tops aft of the sidestick pods (tiller, oxygen masks), x 12.05 -> 12.55.
 */
export const MOUNTS = {
  overhead: { center_m: [12.49, 0, -1.3] as BodyVec, facing: 'down' as const, tiltDeg: -8, width: 0.55, height: 0.74 },
  sideLeft: { center_m: [12.3, -0.99, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.48 },
  sideRight: { center_m: [12.3, 0.99, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.48 },
};
