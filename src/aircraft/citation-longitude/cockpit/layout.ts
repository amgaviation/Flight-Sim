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

/**
 * Main instrument panel (display band): three GDU 1400W. Face tilted 10 deg back (dossier §7.0). Layout-audit fix
 * (L01/L13): the display band sits 80 mm lower than the first build so that the second panel tier (display
 * controllers, MASTER lights, standby) and the GMC tier fit above it without hiding the top of the PFDs (AOPA 2021
 * pilot-seat photograph a21_004: the whole PFD, FMA row included, is visible from the seat). The PFD GTCs moved to
 * the outboard wedge panels (GTC_WEDGE).
 */
export const MAIN_PANEL = {
  center_m: [8.34, 0, -0.085] as BodyVec,
  tiltDeg: 10,
  width: 1.6,
  height: 0.25,
};

/** GDU 1400W: 14.1 in 16:10 active area 302 x 189 mm (canvas 1280 x 800); bezel 354 x 237 mm (UNIT_SIZE_MM). */
export const GDU = { screenW: 0.302, screenH: 0.189, bezelW: 0.354, bezelH: 0.237 };
/** GTC 570 portrait: 7 in 3:4 active area (canvas 480 x 640) ~107 x 143 mm; face 150 x 215 mm (UNIT_SIZE_MM). */
export const GTC = { screenW: 0.107, screenH: 0.143, faceW: 0.15, faceH: 0.215, screenTopMm: 12 };

/**
 * Display centres on the main panel (u metres from the panel centre). PFD_U from the Textron flight-deck photograph
 * (PFD centre / MFD width = 282 / 245 px -> 0.41 m); bezel gap PFD-MFD 56 mm.
 */
export const PFD_U = 0.41;
/** @deprecated first-build coplanar GTC position (the PFD GTCs are on GTC_WEDGE now). */
export const GTC_U = 0.755;

/** Point on an aft-facing panel plane: centre + v along the (tilted) reading-up direction. */
function alongUp(c: readonly [number, number, number], tiltDeg: number, v: number): BodyVec {
  const t = (tiltDeg * Math.PI) / 180;
  return [c[0] + v * Math.sin(t), c[1], c[2] - v * Math.cos(t)];
}

/**
 * Second panel tier ("lower glareshield tier") between the displays and the GMC tier, coplanar with the display band
 * so it can never shade the screens (L01/L02). Carries the display controllers, MASTER CAUTION / WARNING RESET, MAX
 * AIRSPEED LIMITS placard, POWER RESERVE, the standby display and the registration placard (AOPA 2021 c_top21;
 * Textron panel photograph). Height fits the ~84 mm standby unit (c_top21: standby 1.4 x the controller height).
 */
export const UPPER_TIER = {
  center_m: alongUp(MAIN_PANEL.center_m, MAIN_PANEL.tiltDeg, MAIN_PANEL.height / 2 + 0.044),
  tiltDeg: MAIN_PANEL.tiltDeg,
  width: 1.6,
  height: 0.088,
};
const TIER_TOP = alongUp(MAIN_PANEL.center_m, MAIN_PANEL.tiltDeg, MAIN_PANEL.height / 2 + UPPER_TIER.height);

/** Glareshield front face (GMC tier: ENG FIRE L, GMC 710, ENG FIRE R, APU FIRE; c_gs21), rising from the tier top. */
export const GLARE_FACE = {
  center_m: alongUp(TIER_TOP, 20, 0.04),
  tiltDeg: 20,
  width: 1.6,
  height: 0.08,
};
const FACE_TOP = alongUp(TIER_TOP, 20, 0.08);
/**
 * Glareshield hood: the brow's 30 mm rolled lip ends at the face top. Over-the-nose sight line from the design eye
 * over the brow ~9.6 deg (EST; the first build's 11.5 deg came from a face that overhung the displays).
 */
export const GLARE_HOOD = { aftX: FACE_TOP[0] + 0.03, topZ: FACE_TOP[2] - 0.03, frontZ: -0.33, frontX: 8.63 };

/** Lower sub-panels under the PFDs (dossier §7.3 / §7.4): inboard system panel + outboard dimmer strip (L21). */
export const LOWER_PANEL = {
  x: 8.345,
  zTop: 0.045,
  zBottom: 0.225,
  /** Inboard / outboard edges (|y|) of the whole lower band. */
  yIn: 0.185,
  yOut: 0.9,
  /** Inboard system sub-panel (electrical L / gear + ice R): c_lowL21 ~250 x 180 mm, under the inboard half of the PFD. */
  sysY: 0.315,
  sysW: 0.26,
  /** Outboard dimmer strip (PFD GTC DIM, MAP LIGHT), beside the yoke column. */
  dimY: 0.64,
  dimW: 0.13,
};

/**
 * Outboard PFD GTC wedges (L13, Textron panel photograph / c_lcon): each PFD GTC 570 sits on an angled panel below
 * and outboard of its PFD, turned ~25 deg toward its pilot. Centre EST from the photographs.
 */
export const GTC_WEDGE = { x: 8.27, y: 0.8, z: 0.15, yawDeg: 25, tiltDeg: 12, width: 0.2, height: 0.26 };

/** Centre pedestal: sloped forward face with the two MFD GTCs, then the flat top (dossier §7.5 / §7.6). */
export const PEDESTAL = {
  width: 0.36,
  /** Forward face from the MFD bottom edge down/aft to the top surface. */
  fwdTop: [8.33, 0.045] as [number, number], // [x, z]
  fwdBottom: [8.11, 0.115] as [number, number],
  /** Top surface. */
  topFwd: [8.11, 0.115] as [number, number],
  topAft: [7.28, 0.165] as [number, number],
};

/**
 * Control wheels: hub positions (L48, Textron panel photograph / a21_004: the hub sits at about the PFD bottom edge,
 * the grip tops reach the PFD mid-height; wheels centred under the PFDs, EST).
 */
export const YOKE_HUB_L: [number, number, number] = [8.05, -0.45, 0.04];
export const YOKE_HUB_R: [number, number, number] = [8.05, 0.45, 0.04];
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

/**
 * Left-console tiller (built by the main cockpit; the side-console builder must leave this spot free). L50: a small
 * finger-grip knob set in the forward left console top, just aft of the PFD GTC wedge (c_lcon; AOPA "tiller knob").
 */
export const TILLER = { center_m: [7.9, -0.9, 0.2] as BodyVec };

/** Windshield frame stations (shared by the shell and the exterior glazing). */
export const WINDSHIELD = {
  /** Base (at the glareshield) and header stations. */
  baseX: 8.64,
  headerX: 8.02,
  /** Half-angle of the glazed arc around the nose (rad from the top). */
  halfAngle: 1.17,
  /** Centre post half-width (rad). L53: ~65 mm post in the a18_002 / Textron photographs (0.018 rad x ~1.8 m radius). */
  postHalf: 0.018,
};
/** Side windows: forward and aft panes, angular band on the section (rad from the top). */
export const SIDE_WINDOWS = {
  fwd: { x0: 7.42, x1: 8.0 },
  aft: { x0: 6.98, x1: 7.36 },
  roof: 0.62,
  sill: 1.3,
};
